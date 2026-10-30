"""Vérification GÉODÉSIQUE (pyproj + Shapely) du calepinage résidentiel — indépendante de la
projection lat/lng -> mètres locaux déjà faite par le frontend.

Pourquoi ce module existe en plus de residentiel_engine.py : ce dernier reçoit `pan.points` déjà
convertis en mètres locaux par le frontend (CalepinageMaisonIndiv.latLngToLocal(), une
approximation équirectangulaire — échelle constante `metersPerLat=111320`, `metersPerLng` corrigée
par cos(latitude) UNE SEULE FOIS à l'ouverture du modal). Si CETTE conversion contient une erreur
(précision dégradée sur une grande toiture, cas limite de latitude...), residentiel_engine.py la
reproduit fidèlement plutôt que de la détecter, puisque JS et Python partent alors de la même
source (déjà projetée) pour calculer le nombre de panneaux — un bug de projection serait donc
invisible aux deux. Demande explicite : "s'il y a une erreur au niveau de la conversion du front,
le backend ne le détectera[it] pas car ils dépendent de la même source."

Ce module re-projette CHAQUE sommet de pan et CHAQUE centre d'obstacle depuis leurs coordonnées
géographiques réelles (lat/lng, transmises en plus des mètres locaux — cf.
calepinage_maison_verif_test.js::buildVerifPayload, qui les calcule via
CalepinageMaisonIndiv.localToLatLng(state.roofLocalOrigin, pt)), en utilisant pyproj/une projection
azimutale équidistante (AEQD) centrée sur la maison — même outil, même fichier
(app/models/calepinage_systeme/projection.py) que la vérification déjà en place pour le calepinage
Pro/Grand-projet, réutilisé tel quel plutôt que dupliqué. Le nombre de panneaux est ensuite
recalculé par le MÊME moteur de calepinage (residentiel_engine.compute_candidate_panel_slots) sur
cette géométrie indépendamment reprojetée — seule la source des coordonnées change, jamais
l'algorithme de remplissage lui-même (déjà vérifié bit à bit contre calepinage_maison_calculs.js).

Limite assumée : un pan/obstacle sans coordonnées géographiques (maison basée sur une image
importée, cf. calepinage_image_source.js — CM.state.roofLocalOrigin y vaut null, aucune référence
géographique n'existe) ne peut PAS être vérifié ainsi ; `verify_maison_state_geodesic` le signale
explicitement plutôt que d'improviser une projection arbitraire.

L'angle (`pan.angle`, `obstacle.angle`) n'est PAS reprojeté : latLngToLocal() (frontend) construit
un repère X=Est/Y=Nord non tourné (juste une mise à l'échelle), et une projection AEQD centrée sur
la zone produit, à l'échelle d'une maison, un repère local dont les axes X/Y restent alignés
Est/Nord à l'identique — seules l'échelle et l'origine diffèrent entre les deux repères, jamais la
rotation. Les angles restent donc valables tels quels dans le repère reprojeté.
"""
from app.models.calepinage_systeme.projection import build_local_transformer_pair, project_points
from .residentiel_engine import pack_panels_for_pan, _build_ctx, SUPPORTED_POSE_MODES


def _reproject_points(points_latlng, transformer):
    projected = project_points(points_latlng, transformer)
    return [{'x': x, 'y': y} for x, y in projected]


def _collect_all_latlng_points(state):
    """Rassemble tous les points géoréférencés connus (sommets de pans + centres d'obstacles) —
    sert à construire UN SEUL repère local (même origine/échelle) pour toute la maison, pour que
    pans et obstacles restent mutuellement cohérents une fois reprojetés (comme ils le sont déjà
    dans le repère local du frontend). Un centre d'obstacle manquant est ignoré (pas fatal — cf.
    _reproject_obstacles) ; SEULS les sommets de pans sont indispensables pour construire le repère,
    puisqu'un pan sans coordonnées est de toute façon marqué 'skipped' individuellement plus bas."""
    points = []
    for pan in state.get('pans') or []:
        pts = pan.get('pointsLatLng')
        if pts:
            points.extend(pts)
    for obstacle in state.get('obstaclesLatLng') or []:
        if obstacle:
            points.append(obstacle)
    return points or None


def _reproject_obstacles(obstacles, obstacles_latlng, transformer):
    """Reprojette le centre de chaque obstacle ayant des coordonnées géographiques ; un obstacle
    sans lat/lng (ou avec un centre manquant, ex. entrée None dans une liste par ailleurs alignée
    sur `obstacles`) est simplement omis du résultat plutôt que de faire échouer toute la
    vérification géodésique — une masse d'obstacles moins stricte reste préférable à aucune
    vérification du tout."""
    result = []
    for orig, latlng in zip(obstacles or [], obstacles_latlng or []):
        if not latlng:
            continue
        (x, y), = project_points([latlng], transformer)
        result.append({**orig, 'x': x, 'y': y})
    return result


def verify_maison_state_geodesic(state, include_positions=False):
    """Équivalent géodésique de residentiel_engine.verify_maison_state : mêmes résultats
    ({'pans': [...], 'totalPanelCount': int, 'anyUnsupported': bool}), mais calculés à partir
    d'une reprojection pyproj indépendante plutôt que des mètres locaux fournis par le frontend.

    Retourne {'available': False, 'reason': ...} si les coordonnées géographiques nécessaires sont
    absentes (maison basée sur une image importée, ou payload incomplet) — jamais une projection
    approximative de repli, qui donnerait une fausse impression de vérification indépendante.
    """
    all_points = _collect_all_latlng_points(state)
    if not all_points:
        return {
            'available': False,
            'reason': "Coordonnées géographiques indisponibles (maison basée sur une image importée, "
                      "ou source cartographique sans référence géographique) — vérification géodésique impossible.",
        }

    transformer, reverse_transformer = build_local_transformer_pair(all_points)

    ctx = _build_ctx(state)
    ctx['obstacles'] = _reproject_obstacles(state.get('obstacles'), state.get('obstaclesLatLng'), transformer)

    pans_result = []
    total = 0
    any_unsupported = False

    for pan in state.get('pans') or []:
        pose_mode = pan.get('poseMode', 'incline')
        pts_latlng = pan.get('pointsLatLng')
        if not pts_latlng:
            any_unsupported = True
            pans_result.append({
                'panId': pan.get('id'), 'poseMode': pose_mode,
                'skipped': True, 'reason': 'Sommets géoréférencés manquants pour ce pan.',
                'panelCount': None,
            })
            continue
        if pose_mode not in SUPPORTED_POSE_MODES:
            any_unsupported = True
            pans_result.append({
                'panId': pan.get('id'), 'poseMode': pose_mode,
                'skipped': True, 'reason': f"poseMode '{pose_mode}' non reconnu/non supporté",
                'panelCount': None,
            })
            continue
        try:
            reprojected_pan = dict(pan)
            reprojected_pan['points'] = _reproject_points(pts_latlng, transformer)
            panels = pack_panels_for_pan(reprojected_pan, ctx)
            count = len(panels) if panels is not None else 0
            pan_result = {'panId': pan.get('id'), 'poseMode': pose_mode, 'skipped': False, 'panelCount': count}
            if include_positions:
                # {lat, lng} et non {cx, cy} (contrairement à residentiel_engine.py) : ces centres
                # sont exprimés dans LE REPÈRE LOCAL GÉODÉSIQUE de CETTE fonction (origine/échelle
                # pyproj propres à cette maison), pas dans le repère local équirectangulaire du
                # frontend (CM.state.roofLocalOrigin) — les renvoyer en lat/lng (via
                # reverse_transformer, l'inverse exact de la projection appliquée plus haut) laisse
                # le frontend les reconvertir lui-même dans SON repère (CM.latLngToLocal), plutôt que
                # de risquer un mélange de repères. w/l/angle restent des grandeurs locales
                # (dimensions/rotation), invariantes de repère à cette échelle (cf. commentaire
                # d'en-tête du fichier) — jamais reprojetées.
                pan_result['panels'] = []
                for p in (panels or []):
                    lng, lat = reverse_transformer.transform(p['cx'], p['cy'])
                    pan_result['panels'].append({'lat': lat, 'lng': lng, 'w': p['w'], 'l': p['l'], 'angle': p['angle']})
            pans_result.append(pan_result)
            total += count
        except Exception as e:  # défensif : un pan malformé ne doit jamais faire échouer les autres
            pans_result.append({
                'panId': pan.get('id'), 'poseMode': pose_mode,
                'skipped': True, 'reason': f'Erreur de calcul : {e}', 'panelCount': None,
            })
            any_unsupported = True

    return {'available': True, 'pans': pans_result, 'totalPanelCount': total, 'anyUnsupported': any_unsupported}
