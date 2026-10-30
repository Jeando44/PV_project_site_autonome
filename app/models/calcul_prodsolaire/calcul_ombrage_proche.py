"""
Ombrage proche issu de la scène 3D du projet (arbres, blocs, bâtiments, acrotères, autres champs PV).

Principe (même démarche que PVsyst, "Near shadings : shading factor table") :
  1. La scène arrive du navigateur sous forme de TRIANGLES dans un repère métrique commun
     (x = Est, y = haut, z = Nord), cf. calepinage_maison_ombrage_scene.js. Chaque groupe de
     triangles porte un facteur de transmission (0 = opaque ; houppier d'arbre : 0,1 à 0,7) et, le
     cas échéant, le champ PV auquel il appartient.
  2. Pour chaque champ PV, on échantillonne des points sur la SURFACE ACTIVE des panneaux (surface
     brute dessinée réduite par le ratio de surface active, cf. plus bas) et on lance un rayon de
     chaque point vers le soleil. La fraction éclairée (pondérée par la transmission du feuillage)
     est calculée sur une grille de positions solaires (azimut x hauteur), puis interpolée
     bilinéairement pour chaque pas de temps : le coût ne dépend donc pas du pas de temps (60, 30,
     15 ou 10 min) et la table est mise en cache pour les appels suivants (exports Excel...).
  3. Le diffus isotrope est ombré par un facteur CONSTANT (fraction de la voûte céleste vue par le
     plan des panneaux qui est masquée, pondérée par le cosinus d'incidence), comme le "facteur
     d'ombrage sur le diffus" de PVsyst. La composante circumsolaire du modèle de Perez suit
     l'ombrage du direct.

Modèle "linéaire" : la perte d'irradiance est proportionnelle à la fraction de surface active à
l'ombre. C'est une borne BASSE de la perte électrique réelle (une cellule ombrée peut faire basculer
une diode de bypass et couper tout un sous-string) — un facteur "électrique" par chaînes pourra être
ajouté ensuite sans changer la scène.

Le champ propre n'est jamais un obstacle pour lui-même : ses panneaux sont coplanaires (aucun
ombrage possible) ou disposés en sheds, dont l'ombrage mutuel est déjà compté par
calcul_shed_shading.py (inclus dans les pertes du champ) — le compter ici le doublerait.

Pas de dépendance à Flask : module pur numpy/pandas, testable isolément.
"""

import hashlib
import json
import logging
import math
from collections import OrderedDict

import numpy as np
import pandas as pd

# Grille des positions solaires de la table d'ombrage (degrés). PVsyst utilise 10° x 10° par
# défaut ; un pas plus fin limite l'erreur d'interpolation sur les bords d'ombre nets.
AZIMUTH_STEP_DEG = 5.0
ELEVATION_STEP_DEG = 2.5
# Directions de la voûte céleste pour le facteur d'ombrage sur le diffus.
SKY_ELEVATION_STEP_DEG = 6.0
SKY_AZIMUTH_STEP_DEG = 10.0

# Nombre maximal de points d'échantillonnage par champ (direct) et pour le diffus.
MAX_POINTS_BEAM = 400
MAX_POINTS_DIFFUSE = 120
# Décalage des points au-dessus du plan du panneau (m) et distance minimale d'impact : évite qu'un
# rayon ne "touche" le panneau d'où il part ou la couverture juste en dessous.
NORMAL_OFFSET_M = 0.02
MIN_HIT_DISTANCE_M = 1e-3
# Taille des blocs pour le test rayon/triangle vectorisé (points x triangles).
CHUNK_PAIRS = 1_500_000

# Ratio surface active / surface brute du module (cellules / encombrement cadre compris).
# Valeur usuelle des modules cristallins actuels : 0,85 à 0,93.
DEFAULT_ACTIVE_AREA_RATIO = 0.90
ACTIVE_AREA_RATIO_RANGE = (0.50, 1.00)

_TABLE_CACHE = OrderedDict()
_TABLE_CACHE_MAX = 32

# --- Validation de la scène reçue (défense en profondeur : le navigateur borne déjà les saisies) ---
# Versions de format acceptées.
SCENE_VERSIONS = {1}
# Plafonds : une scène résidentielle/PRO en est très loin ; au-delà, la scène est refusée (calcul
# sans ombrage proche) plutôt que de saturer le serveur.
MAX_FIELDS = 200
MAX_PANELS_PER_FIELD = 20_000
MAX_PANELS_TOTAL = 50_000
MAX_OCCLUDERS = 5_000
MAX_TRIANGLES_TOTAL = 300_000
# Bornes des coordonnées (m) dans le repère de la scène : les champs d'un projet tiennent dans
# DISTANCE_MAX_CALEPINAGE (2 km) ; altitude = hauteurs d'objets (≤ 50 m) + relief éventuel.
COORD_HORIZ_MAX_M = 5_000.0
COORD_Y_MIN_M = -200.0
COORD_Y_MAX_M = 500.0
# Aire minimale d'un triangle (m²) : en dessous, triangle dégénéré ignoré.
MIN_TRIANGLE_AREA_M2 = 1e-8
MAX_LABEL_CHARS = 120
MAX_IGNORED_OBJECTS = 200


def _clamp(value, lo, hi):
    return max(lo, min(hi, value))


def parse_active_area_ratio(value):
    """Ratio de surface active borné ; accepte une fraction (0,9) ou un pourcentage (90)."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return DEFAULT_ACTIVE_AREA_RATIO
    if not math.isfinite(v) or v <= 0:
        return DEFAULT_ACTIVE_AREA_RATIO
    if v > 1.0:
        v = v / 100.0
    return _clamp(v, *ACTIVE_AREA_RATIO_RANGE)


def _sun_vector(azimuth_deg, elevation_deg):
    """Direction vers le soleil dans le repère (x=Est, y=haut, z=Nord) ; azimut pvlib (0=Nord, 90=Est)."""
    az = np.radians(azimuth_deg)
    el = np.radians(elevation_deg)
    return np.stack([np.sin(az) * np.cos(el), np.sin(el), np.cos(az) * np.cos(el)], axis=-1)


def _as_float_array(flat):
    """Liste JSON de nombres -> tableau float 1D ; ValueError si la liste contient autre chose."""
    if not isinstance(flat, (list, tuple)):
        raise ValueError("liste de coordonnées attendue")
    return np.asarray(flat, dtype=float).reshape(-1)


def _points_valides(arr):
    """Masque des éléments (…, k, 3) dont tous les sommets sont finis et dans les bornes de la scène."""
    finis = np.all(np.isfinite(arr), axis=(-2, -1))
    x, y, z = arr[..., 0], arr[..., 1], arr[..., 2]
    with np.errstate(invalid='ignore'):
        dans = (np.all(np.abs(x) <= COORD_HORIZ_MAX_M, axis=-1) & np.all(np.abs(z) <= COORD_HORIZ_MAX_M, axis=-1)
                & np.all(y >= COORD_Y_MIN_M, axis=-1) & np.all(y <= COORD_Y_MAX_M, axis=-1))
    return finis & dans


def _as_triangles(flat):
    """
    Triangles valides (finis, dans les bornes, non dégénérés) et nombre de triangles INVALIDES
    écartés (coordonnées non finies ou hors bornes). Les triangles d'aire nulle sont écartés sans
    être comptés : la géométrie du bâtiment en produit légitimement (jupe d'égout de hauteur nulle,
    cf. buildOneBuilding) et ils n'ombrent rien.
    """
    arr = _as_float_array(flat)
    n = arr.size // 9
    if n == 0:
        return np.zeros((0, 3, 3)), 0
    tris = arr[:n * 9].reshape(n, 3, 3)
    valides = _points_valides(tris)
    aire = np.zeros(n)
    aire[valides] = 0.5 * np.linalg.norm(np.cross(tris[valides, 1] - tris[valides, 0], tris[valides, 2] - tris[valides, 0]), axis=1)
    return tris[valides & (aire > MIN_TRIANGLE_AREA_M2)], int(n - valides.sum())


def _as_quads(flat):
    """Panneaux (4 coins) valides et nombre de panneaux écartés."""
    arr = _as_float_array(flat)
    n = arr.size // 12
    if n == 0:
        return np.zeros((0, 4, 3)), 0
    quads = arr[:n * 12].reshape(n, 4, 3)
    ok = _points_valides(quads)
    return quads[ok], int(n - ok.sum())


def _quads_to_triangles(quads):
    if not len(quads):
        return np.zeros((0, 3, 3))
    return np.concatenate([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]], axis=0)


class _Group:
    __slots__ = ('triangles', 'owner', 'transmission', 'transmission_winter', 'label')

    def __init__(self, triangles, owner, transmission, transmission_winter, label):
        self.triangles = triangles
        self.owner = owner
        self.transmission = transmission
        self.transmission_winter = transmission_winter
        self.label = label


class NearShadingScene:
    """Scène d'ombrage prête au calcul (triangles numpy), construite une fois par requête."""

    def __init__(self, receivers, groups, signature, ignored_objects, warnings=None):
        self.receivers = receivers          # {field_id: quads (N,4,3)}
        self.groups = groups                # [_Group]
        self.signature = signature
        self.ignored_objects = ignored_objects
        self.warnings = list(warnings or [])

    def has_field(self, field_id):
        quads = self.receivers.get(str(field_id))
        return quads is not None and len(quads) > 0

    @property
    def object_count(self):
        return sum(1 for g in self.groups if g.owner is None)


def _transmission(value, defaut):
    """Transmission bornée à [0, 1] ; `defaut` si absente ou illisible."""
    if value is None:
        return defaut
    try:
        v = float(value)
    except (TypeError, ValueError):
        return defaut
    return _clamp(v, 0.0, 1.0) if math.isfinite(v) else defaut


def prepare_near_shading_scene(scene, warnings=None):
    """
    Valide et convertit la scène JSON envoyée par le navigateur. Retourne None si elle est absente,
    vide, illisible ou hors plafonds (le calcul de production se fait alors sans ombrage proche,
    comme avant) ; chaque écart est décrit dans `warnings` (liste complétée si fournie) et dans
    `scene.warnings`, repris dans summary.near_shading_warnings.

    Format (version 1) :
      {version: 1, projet_id,
       receivers: {<id champ>: {panels: [x,y,z x 4 coins, ...]}},
       occluders: [{label, owner: <id champ>|null, transmission: 0..1,
                    transmission_winter: 0..1|null, triangles: [x,y,z x 3 sommets, ...]}],
       ignored_objects: [{typeKey, label, reason}]}
    Validation : version connue ; nombres de champs/panneaux/obstacles/triangles plafonnés ;
    coordonnées finies et dans les bornes de la scène ; triangles dégénérés écartés ; transmissions
    bornées à [0, 1] ; libellés tronqués.
    """
    avert = [] if warnings is None else warnings
    if scene is None:
        return None
    if not isinstance(scene, dict):
        avert.append("Scène d'ombrage 3D ignorée : format invalide.")
        return None
    try:
        version = scene.get('version', 1)
        if version not in SCENE_VERSIONS:
            avert.append(f"Scène d'ombrage 3D ignorée : version de format {version!r} inconnue.")
            return None

        raw_receivers = scene.get('receivers') or {}
        if not isinstance(raw_receivers, dict):
            avert.append("Scène d'ombrage 3D ignorée : champs PV illisibles.")
            return None
        if len(raw_receivers) > MAX_FIELDS:
            avert.append(f"Scène d'ombrage 3D ignorée : {len(raw_receivers)} champs PV (maximum {MAX_FIELDS}).")
            return None

        receivers = {}
        ecartes = 0
        total_panneaux = 0
        for field_id, rec in raw_receivers.items():
            try:
                quads, rejet = _as_quads(rec.get('panels') or [] if isinstance(rec, dict) else [])
            except (TypeError, ValueError):
                avert.append(f"Scène d'ombrage 3D ignorée : coordonnées de panneaux non numériques "
                             f"(champ {str(field_id)[:40]}).")
                return None
            ecartes += rejet
            if len(quads) > MAX_PANELS_PER_FIELD:
                avert.append(f"Scène d'ombrage 3D ignorée : champ {str(field_id)[:40]} avec {len(quads)} panneaux "
                             f"(maximum {MAX_PANELS_PER_FIELD}).")
                return None
            total_panneaux += len(quads)
            if len(quads):
                receivers[str(field_id)[:MAX_LABEL_CHARS]] = quads
        if total_panneaux > MAX_PANELS_TOTAL:
            avert.append(f"Scène d'ombrage 3D ignorée : {total_panneaux} panneaux (maximum {MAX_PANELS_TOTAL}).")
            return None
        if ecartes:
            avert.append(f"{ecartes} panneau(x) aux coordonnées invalides écarté(s) de l'ombrage proche.")
        if not receivers:
            return None

        raw_occluders = scene.get('occluders') or []
        if not isinstance(raw_occluders, list):
            raw_occluders = []
        if len(raw_occluders) > MAX_OCCLUDERS:
            avert.append(f"Scène d'ombrage 3D ignorée : {len(raw_occluders)} volumes masquants (maximum {MAX_OCCLUDERS}).")
            return None

        groups = []
        # Les panneaux de chaque champ sont aussi des obstacles pour les AUTRES champs.
        for field_id, quads in receivers.items():
            groups.append(_Group(_quads_to_triangles(quads), field_id, 0.0, None, 'panneaux ' + field_id))
        total_triangles = sum(len(g.triangles) for g in groups)
        tri_ecartes = 0
        for occ in raw_occluders:
            if not isinstance(occ, dict):
                continue
            try:
                tris, rejet = _as_triangles(occ.get('triangles') or [])
            except (TypeError, ValueError):
                tri_ecartes += 1
                continue
            tri_ecartes += rejet
            if not len(tris):
                continue
            total_triangles += len(tris)
            if total_triangles > MAX_TRIANGLES_TOTAL:
                avert.append(f"Scène d'ombrage 3D ignorée : plus de {MAX_TRIANGLES_TOTAL} triangles.")
                return None
            tau = _transmission(occ.get('transmission'), 0.0)
            tau_w = _transmission(occ.get('transmission_winter'), None)
            if tau >= 1.0 and (tau_w is None or tau_w >= 1.0):
                continue  # totalement transparent : sans effet
            owner = occ.get('owner')
            groups.append(_Group(tris, str(owner)[:MAX_LABEL_CHARS] if owner else None, tau, tau_w,
                                 str(occ.get('label') or '')[:MAX_LABEL_CHARS]))
        if tri_ecartes:
            avert.append(f"{tri_ecartes} élément(s) de géométrie invalide(s) écarté(s) de l'ombrage proche.")

        signature = hashlib.sha1(json.dumps(scene, sort_keys=True, default=str).encode('utf-8')).hexdigest()
        ignored = []
        for o in (scene.get('ignored_objects') or [])[:MAX_IGNORED_OBJECTS]:
            if isinstance(o, dict):
                ignored.append({k: str(o.get(k) or '')[:MAX_LABEL_CHARS] for k in ('typeKey', 'label', 'champ', 'reason')})
        return NearShadingScene(receivers, groups, signature, ignored, avert)
    except Exception:
        logging.exception("Scène d'ombrage 3D illisible : calcul sans ombrage proche.")
        avert.append("Scène d'ombrage 3D illisible : calcul sans ombrage proche.")
        return None


def _sample_points(quads, active_area_ratio, max_points):
    """
    Points d'échantillonnage sur la surface ACTIVE des panneaux : chaque panneau est réduit
    homothétiquement autour de son centre (facteur sqrt(ratio) sur chaque côté, soit une surface
    réduite de `ratio`) — le cadre et les bords non actifs ne comptent pas. Grille régulière par
    panneau, plus dense sur les petits champs ; au-delà de `max_points`, un panneau sur k est retenu.
    Retourne (points (P,3) décalés le long de la normale, normale moyenne unitaire orientée vers le haut).
    """
    n_panels = len(quads)
    if n_panels > max_points:
        quads = quads[np.linspace(0, n_panels - 1, max_points).round().astype(int)]
        n_panels = len(quads)
    per_panel = max(1, max_points // max(1, n_panels))
    k_w = max(1, int(math.sqrt(per_panel / 2.0)))
    k_l = max(1, min(per_panel // k_w, 2 * k_w))

    scale = math.sqrt(active_area_ratio)
    su = (np.arange(k_w) + 0.5) / k_w
    sv = (np.arange(k_l) + 0.5) / k_l
    uu, vv = np.meshgrid(su, sv, indexing='ij')
    uu = 0.5 + (uu.reshape(-1) - 0.5) * scale
    vv = 0.5 + (vv.reshape(-1) - 0.5) * scale

    c0, c1, c3 = quads[:, 0], quads[:, 1], quads[:, 3]
    e_u = c1 - c0
    e_v = c3 - c0
    pts = c0[:, None, :] + uu[None, :, None] * e_u[:, None, :] + vv[None, :, None] * e_v[:, None, :]

    normals = np.cross(e_u, e_v)
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.where(norms > 1e-9, normals / np.maximum(norms, 1e-9), np.array([0.0, 1.0, 0.0]))
    normals = np.where(normals[:, 1:2] < 0, -normals, normals)  # orientées vers le ciel
    pts = pts + NORMAL_OFFSET_M * normals[:, None, :]

    mean_normal = normals.mean(axis=0)
    mean_normal = mean_normal / (np.linalg.norm(mean_normal) or 1.0)
    return pts.reshape(-1, 3), mean_normal


def _projection_basis(direction):
    """Base orthonormée (a, b) du plan perpendiculaire à `direction`."""
    ref = np.array([0.0, 1.0, 0.0]) if abs(direction[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    a = np.cross(direction, ref)
    a /= np.linalg.norm(a)
    return a, np.cross(direction, a)


def _any_hit(points, direction, tris):
    """
    Vrai pour chaque point dont le rayon (point -> direction) coupe au moins un triangle.

    Projection orthogonale le long du rayon : le rayon issu de P coupe le triangle si la projection
    de P tombe dans la projection du triangle (coordonnées barycentriques 2D) ET si le point
    d'impact est devant P (profondeur interpolée > profondeur de P). Équivalent à Möller–Trumbore,
    mais en 2D : aucun produit vectoriel sur les tableaux (points x triangles).
    """
    hit = np.zeros(len(points), dtype=bool)
    if not len(tris) or not len(points):
        return hit
    a, b = _projection_basis(direction)
    pu, pv, pd = points @ a, points @ b, points @ direction
    tu, tv, td = tris @ a, tris @ b, tris @ direction          # (M, 3) chacun

    # Élimination rapide : l'ombre projetée du triangle doit recouvrir l'emprise des points, et le
    # triangle doit être (au moins en partie) devant eux le long du rayon.
    keep = ((tu.max(axis=1) >= pu.min()) & (tu.min(axis=1) <= pu.max())
            & (tv.max(axis=1) >= pv.min()) & (tv.min(axis=1) <= pv.max())
            & (td.max(axis=1) > pd.min()))
    if not keep.any():
        return hit
    tu, tv, td = tu[keep], tv[keep], td[keep]

    # Inverse de la transformation affine (λ1, λ2) -> point projeté, par triangle.
    x1, y1 = tu[:, 1] - tu[:, 0], tv[:, 1] - tv[:, 0]
    x2, y2 = tu[:, 2] - tu[:, 0], tv[:, 2] - tv[:, 0]
    det = x1 * y2 - x2 * y1
    ok = np.abs(det) > 1e-10                                    # triangle vu par la tranche : ignoré
    if not ok.any():
        return hit
    inv = 1.0 / det[ok]
    u0, v0 = tu[ok, 0], tv[ok, 0]
    x1, y1, x2, y2 = x1[ok], y1[ok], x2[ok], y2[ok]
    d0, dd1, dd2 = td[ok, 0], td[ok, 1] - td[ok, 0], td[ok, 2] - td[ok, 0]

    chunk = max(1, CHUNK_PAIRS // max(1, len(points)))
    for s in range(0, len(u0), chunk):
        sl = slice(s, s + chunk)
        du = pu[:, None] - u0[None, sl]
        dv = pv[:, None] - v0[None, sl]
        l1 = (du * y2[None, sl] - dv * x2[None, sl]) * inv[None, sl]
        l2 = (dv * x1[None, sl] - du * y1[None, sl]) * inv[None, sl]
        inside = (l1 >= 0) & (l2 >= 0) & (l1 + l2 <= 1)
        if not inside.any():
            continue
        depth = d0[None, sl] + l1 * dd1[None, sl] + l2 * dd2[None, sl] - pd[:, None]
        hit |= np.any(inside & (depth > MIN_HIT_DISTANCE_M), axis=1)
        if hit.all():
            break
    return hit


class _FieldTracer:
    """Obstacles pertinents pour UN champ, avec élimination rapide par direction."""

    def __init__(self, scene, field_id, points):
        self.points = points
        min_y = float(points[:, 1].min()) if len(points) else 0.0
        opaque, transparent = [], []
        for g in scene.groups:
            if g.owner == field_id:
                continue
            tris = g.triangles
            # Un triangle entièrement sous le point le plus bas ne peut pas masquer un soleil levé.
            tris = tris[tris[:, :, 1].max(axis=1) > min_y - 1e-6]
            if not len(tris):
                continue
            if g.transmission <= 0.0 and (g.transmission_winter is None or g.transmission_winter <= 0.0):
                opaque.append(tris)
            else:
                transparent.append((tris, g.transmission,
                                    g.transmission if g.transmission_winter is None else g.transmission_winter))
        self.opaque = np.concatenate(opaque, axis=0) if opaque else np.zeros((0, 3, 3))
        self.transparent = transparent

    @property
    def empty(self):
        return not len(self.opaque) and not self.transparent

    def lit_fraction(self, direction, points=None):
        """(fraction éclairée saison feuillée, fraction éclairée hiver) pour une direction solaire."""
        pts = self.points if points is None else points
        if not len(pts):
            return 1.0, 1.0
        blocked = _any_hit(pts, direction, self.opaque)
        lit_s = (~blocked).astype(float)
        lit_w = lit_s.copy()
        for tris, tau_s, tau_w in self.transparent:
            idx = np.nonzero(~blocked)[0]
            if not len(idx):
                break
            sub = pts[idx]
            hit = _any_hit(sub, direction, tris)
            if hit.any():
                lit_s[idx[hit]] *= tau_s
                lit_w[idx[hit]] *= tau_w
        return float(lit_s.mean()), float(lit_w.mean())


def _winter_mask(index, lat):
    """Mois sans feuilles des arbres caducs : novembre-mars (hémisphère nord), mai-septembre (sud)."""
    months = index.month
    if lat >= 0:
        return np.isin(months, [11, 12, 1, 2, 3])
    return np.isin(months, [5, 6, 7, 8, 9])


def compute_field_near_shading(scene, field_id, solar_azimuth, apparent_zenith, surface_normal_hint=None,
                               active_area_ratio=DEFAULT_ACTIVE_AREA_RATIO, lat=45.0):
    """
    Facteurs d'ombrage proche d'un champ PV pour chaque pas de temps.

    Retourne None si le champ n'a pas de géométrie dans la scène, sinon un dict :
      beam_shading   : pd.Series (0..1) fraction du DIRECT (et du circumsolaire) perdue par l'ombrage ;
      diffuse_shading: pd.Series (0..1) fraction du diffus isotrope perdue (constante par saison) ;
      points, obstacles : informations de traçabilité.
    """
    field_id = str(field_id)
    if scene is None or not scene.has_field(field_id):
        return None
    ratio = parse_active_area_ratio(active_area_ratio)
    index = solar_azimuth.index
    zeros = pd.Series(0.0, index=index)

    points, normal = _sample_points(scene.receivers[field_id], ratio, MAX_POINTS_BEAM)
    tracer = _FieldTracer(scene, field_id, points)
    if tracer.empty:
        return {'beam_shading': zeros, 'diffuse_shading': zeros.copy(), 'points': len(points), 'obstacles': 0}

    cache_key = (scene.signature, field_id, round(ratio, 4))
    table = _TABLE_CACHE.get(cache_key)
    if table is None:
        table = {'beam': {}, 'diffuse': None}
        _TABLE_CACHE[cache_key] = table
        while len(_TABLE_CACHE) > _TABLE_CACHE_MAX:
            _TABLE_CACHE.popitem(last=False)
    else:
        _TABLE_CACHE.move_to_end(cache_key)

    # --- Direct : table (azimut, hauteur) -> fraction éclairée, interpolation bilinéaire ---------
    elevation = 90.0 - np.asarray(apparent_zenith, dtype=float)
    azimuth = np.mod(np.asarray(solar_azimuth, dtype=float), 360.0)
    day = np.isfinite(elevation) & (elevation > 0)

    lit_s = np.ones(len(index))
    lit_w = np.ones(len(index))
    if day.any():
        a = azimuth[day] / AZIMUTH_STEP_DEG
        e = np.clip(elevation[day], 0.0, 90.0) / ELEVATION_STEP_DEG
        a0 = np.floor(a).astype(int)
        e0 = np.floor(e).astype(int)
        fa = a - a0
        fe = e - e0
        n_az = int(round(360.0 / AZIMUTH_STEP_DEG))
        n_el = int(round(90.0 / ELEVATION_STEP_DEG))
        corners = []
        for da, de, w in ((0, 0, (1 - fa) * (1 - fe)), (1, 0, fa * (1 - fe)),
                          (0, 1, (1 - fa) * fe), (1, 1, fa * fe)):
            corners.append(((a0 + da) % n_az, np.minimum(e0 + de, n_el), w))

        needed = set()
        for ia, ie, _ in corners:
            needed.update(zip(ia.tolist(), ie.tolist()))
        beam_table = table['beam']
        for node in needed:
            if node not in beam_table:
                d = _sun_vector(node[0] * AZIMUTH_STEP_DEG, node[1] * ELEVATION_STEP_DEG)
                beam_table[node] = tracer.lit_fraction(d)

        acc_s = np.zeros(int(day.sum()))
        acc_w = np.zeros(int(day.sum()))
        for ia, ie, w in corners:
            vals = np.array([beam_table[(i, j)] for i, j in zip(ia.tolist(), ie.tolist())])
            acc_s += w * vals[:, 0]
            acc_w += w * vals[:, 1]
        lit_s[day] = acc_s
        lit_w[day] = acc_w

    # --- Diffus isotrope : voûte céleste vue par le plan, pondérée par cos(incidence) ------------
    if table['diffuse'] is None:
        n = normal if surface_normal_hint is None else np.asarray(surface_normal_hint, dtype=float)
        sky_points = points
        if len(points) > MAX_POINTS_DIFFUSE:
            sky_points = points[np.linspace(0, len(points) - 1, MAX_POINTS_DIFFUSE).round().astype(int)]
        num_s = num_w = den = 0.0
        for el in np.arange(SKY_ELEVATION_STEP_DEG / 2, 90.0, SKY_ELEVATION_STEP_DEG):
            for az in np.arange(0.0, 360.0, SKY_AZIMUTH_STEP_DEG):
                d = _sun_vector(az, el)
                cos_inc = float(d @ n)
                if cos_inc <= 0:
                    continue
                weight = cos_inc * math.cos(math.radians(el))  # angle solide de la cellule ∝ cos(hauteur)
                ls, lw = tracer.lit_fraction(d, sky_points)
                num_s += weight * (1.0 - ls)
                num_w += weight * (1.0 - lw)
                den += weight
        table['diffuse'] = (num_s / den, num_w / den) if den > 0 else (0.0, 0.0)
    diff_s, diff_w = table['diffuse']

    winter = _winter_mask(index, lat)
    beam_shading = pd.Series(1.0 - np.where(winter, lit_w, lit_s), index=index).clip(0.0, 1.0)
    diffuse_shading = pd.Series(np.where(winter, diff_w, diff_s), index=index).clip(0.0, 1.0)
    obstacles = len(tracer.opaque) + sum(len(t[0]) for t in tracer.transparent)
    return {'beam_shading': beam_shading, 'diffuse_shading': diffuse_shading,
            'points': int(len(points)), 'obstacles': int(obstacles)}
