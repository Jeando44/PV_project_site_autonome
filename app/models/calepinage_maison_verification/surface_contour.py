"""Surface maximale d'un contour de calepinage maison — filet de sécurité backend.

Le frontend refuse déjà tout contour dont la surface dépasse la limite de son outil de tracé
(polygon_maison.js / calepinage_maison_dessin.js) ; ce module revérifie à la sauvegarde
(/calepinage-maison/save) et au calcul de vérification (/calepinage-maison/verify), au cas où ce
verrou serait contourné (frontend modifié, requête forgée, ancien navigateur en cache).

Limites lues dans config.py : CALEPINAGE_SURFACE_MAX_RECT_M2 (rectangle) et
CALEPINAGE_SURFACE_MAX_POLYGONE_M2 (polygone libre). Une marge de tolérance (MARGE_TOLERANCE) évite
de rejeter un contour admis par le frontend pour un simple écart de projection (sphère de Google
Maps côté frontend, projection locale ici).

Les contours issus du bouton de décalage de parcelles cadastrales (`origineParcelles`) suivent la
limite du polygone, quel que soit le mode transmis.
"""
import math

# Rayon de la sphère utilisée par google.maps.geometry.spherical.computeArea (frontend).
RAYON_TERRE_M = 6378137.0
MARGE_TOLERANCE = 0.01

SURFACE_MAX_RECT_DEFAUT_M2 = 25000.0
SURFACE_MAX_POLYGONE_DEFAUT_M2 = 50000.0


class SurfaceContourError(ValueError):
    """Contour dont la surface dépasse la limite de son mode de tracé."""


def _point_lat_lng(p):
    if isinstance(p, dict):
        return float(p['lat']), float(p['lng'])
    return float(p[0]), float(p[1])


def surface_lat_lng_m2(coordonnees):
    """Surface (m²) d'un contour [{lat, lng}] — projection équirectangulaire locale autour du
    centre du contour (écart négligeable à l'échelle d'un calepinage, quelques centaines de mètres)."""
    pts = [_point_lat_lng(p) for p in (coordonnees or [])]
    if len(pts) < 3:
        return 0.0
    lat0 = sum(p[0] for p in pts) / len(pts)
    lng0 = sum(p[1] for p in pts) / len(pts)
    k = math.pi / 180.0 * RAYON_TERRE_M
    cos0 = math.cos(math.radians(lat0))
    xy = [((lng - lng0) * k * cos0, (lat - lat0) * k) for lat, lng in pts]
    return _surface_lacet(xy)


def surface_locale_m2(points):
    """Surface (m²) d'un contour en mètres locaux [{x, y}]."""
    xy = [(float(p['x']), float(p['y'])) for p in (points or []) if isinstance(p, dict)]
    return _surface_lacet(xy) if len(xy) >= 3 else 0.0


def _surface_lacet(xy):
    somme = 0.0
    for i, (x1, y1) in enumerate(xy):
        x2, y2 = xy[(i + 1) % len(xy)]
        somme += x1 * y2 - x2 * y1
    return abs(somme) / 2.0


def _deduire_mode(coordonnees):
    """Repli quand le mode n'est pas transmis : 4 sommets à angles droits = rectangle (même
    principe que polygon_maison.js::inferModeFromPath)."""
    try:
        pts = [_point_lat_lng(p) for p in (coordonnees or [])]
    except (KeyError, TypeError, ValueError, IndexError):
        return 'polygon'
    if len(pts) != 4:
        return 'polygon'
    cos0 = math.cos(math.radians(sum(p[0] for p in pts) / 4))
    xy = [(lng * cos0, lat) for lat, lng in pts]
    for i in range(4):
        ax, ay = xy[i - 1]
        bx, by = xy[i]
        cx, cy = xy[(i + 1) % 4]
        u, v = (ax - bx, ay - by), (cx - bx, cy - by)
        n1, n2 = math.hypot(*u), math.hypot(*v)
        if n1 == 0 or n2 == 0:
            return 'polygon'
        cos_angle = (u[0] * v[0] + u[1] * v[1]) / (n1 * n2)
        if abs(cos_angle) > math.cos(math.radians(85)):
            return 'polygon'
    return 'rect'


def surface_max_m2(config, mode):
    if mode == 'polygon':
        return float(config.get('CALEPINAGE_SURFACE_MAX_POLYGONE_M2', SURFACE_MAX_POLYGONE_DEFAUT_M2))
    return float(config.get('CALEPINAGE_SURFACE_MAX_RECT_M2', SURFACE_MAX_RECT_DEFAUT_M2))


def verifier_surface(surface_m2, mode, config, libelle):
    """Lève SurfaceContourError si `surface_m2` dépasse la limite (avec tolérance) du mode."""
    mode = 'polygon' if mode == 'polygon' else 'rect'
    max_m2 = surface_max_m2(config, mode)
    if surface_m2 > max_m2 * (1 + MARGE_TOLERANCE):
        outil = 'polygonal' if mode == 'polygon' else 'rectangulaire'
        fmt = lambda v: f"{v:,.0f}".replace(',', ' ')  # noqa: E731
        raise SurfaceContourError(
            f"{libelle} : le contour {outil} mesure {fmt(surface_m2)} m², au-delà de la surface "
            f"maximale autorisée pour un calepinage {outil} ({fmt(max_m2)} m²). "
            "Veuillez reprendre le dessin."
        )


def verifier_surface_maison(maison_info, config, libelle):
    """Contrôle d'une maison du payload de /calepinage-maison/save :
    { coordonnees: [{lat, lng}], mode, state: {roofLocal, contourMode, ...}, origineParcelles }."""
    if not isinstance(maison_info, dict):
        return
    state = maison_info.get('state') or {}
    coordonnees = maison_info.get('coordonnees') or []
    mode = maison_info.get('mode') or state.get('contourMode')
    if maison_info.get('origineParcelles'):
        mode = 'polygon'
    elif mode not in ('rect', 'polygon'):
        mode = _deduire_mode(coordonnees)
    try:
        if len(coordonnees) >= 3:
            surface = surface_lat_lng_m2(coordonnees)
        else:
            # Source image importée : aucune coordonnée géographique, contour en mètres calibrés.
            surface = surface_locale_m2(state.get('roofLocal'))
    except (KeyError, TypeError, ValueError) as e:
        raise SurfaceContourError(f"{libelle} : contour illisible ({e}).")
    verifier_surface(surface, mode, config, libelle)


def verifier_surface_etat_verification(state, config):
    """Contrôle de l'état envoyé à /calepinage-maison/verify : surface = somme des pans (les pans
    partitionnent le contour)."""
    mode = 'polygon' if state.get('origineParcelles') else state.get('contourMode')
    surface = sum(surface_locale_m2(p.get('points')) for p in (state.get('pans') or []) if isinstance(p, dict))
    verifier_surface(surface, mode, config, 'Calepinage')
