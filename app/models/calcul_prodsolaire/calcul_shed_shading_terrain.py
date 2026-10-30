"""
Perte d'ombrage entre sheds EN TENANT COMPTE DU TERRAIN (petit champ solaire au sol).

Complète calcul_shed_shading.py (rangées infinies sur terrain plat, inchangé) sans le modifier : le
navigateur ne bascule sur ce calcul que si la case « prendre en compte le terrain » est cochée.

── Modèle : une coupe 2D par COUPLE de rangées voisines ─────────────────────────────────────────
Le navigateur (calepinage_maison_terrain_tables.js::geometrieOmbrage) relit les tables réellement
posées et la grille d'altitudes déjà chargée, puis envoie, par groupe de tables de même orientation :
  - tilt              inclinaison de la table EN TRAVERS de la rangée (réglage du champ, β) ;
  - surface_azimuth   azimut pvlib de la table (direction horizontale vers laquelle elle regarde) ;
  - axis_tilt         pente de l'axe de la table le long de la rangée (la table suit la pente, poteaux
                      verticaux) ; convention pvlib : > 0 quand l'axe descend vers azimut - 90 ;
  - couples           pour chaque table ombrée, la (les) table(s) de la rangée de devant qui la
                      recouvrent : pas horizontal entre axes, pente de la droite des axes
                      (cross_axis_slope = atan(Δz / pas), > 0 quand la rangée de devant est plus
                      basse) et poids = panneaux de la table ombrée x fraction recouverte.
Une table sans table devant elle (1re rangée, bout de rangée) n'est pas ombrée : elle reçoit
l'irradiance de référence.

Orientation RÉELLE d'une table : rotation β autour d'un axe incliné de α (convention des trackers,
pvlib.tracking.calc_surface_orientation) -> β' = acos(cos β · cos α), azimut + δ avec
δ = atan2(cos β · sin α, sin β). La RÉFÉRENCE de chaque groupe est une rangée isolée de cette même
orientation réelle : la perte ne mesure que l'ombrage, pas le changement d'orientation (qui est
porté par la production, via l'inclinaison/azimut réels).

Irradiance d'une table ombrée, heure par heure :
  - directe   : DNI · cos(AOI réel) · (1 - fs), fs = pvlib.shading.shaded_fraction1d (pente de
                l'axe ET pente en travers prises en compte) ;
  - diffuse ciel + réfléchie sol : pvlib infinite_sheds sur l'orientation réelle, avec un pas
                ÉQUIVALENT plat qui donne le même angle de masquage (bord bas de la table ombrée ->
                bord haut de la table de devant) que la géométrie réelle. Sur terrain plat, pas
                équivalent = pas réel : on retrouve exactement infinite_sheds.
Perte = 1 - Σ POA ombrée / Σ POA de référence, sommées sur l'année et pondérées par les panneaux.

Test de parité (tests/ombrage_sheds_terrain/) : terrain plat, toutes les tables ombrées -> perte de
calcul_shed_shading.py ; avec N rangées, ≈ cette perte x (N-1)/N (1re rangée non ombrée).

PAS le moteur 3D calcul_ombrage_proche.py : trop lent à 25 000 panneaux x 5 configurations
d'optimisation. Les géométries identiques sont regroupées côté navigateur (arrondi) et les appels
infinite_sheds identiques sont mis en cache ici (≈ 4 ms par géométrie distincte sur 8760 h).
"""

import logging
import math

import numpy as np
import pvlib

from .calcul_prodsolaire import _get_hourly_solar_series
from .calcul_shed_shading import REFERENCE_PITCH_FACTOR

# Hauteur passée à infinite_sheds : même convention que calcul_shed_shading.py (hauteur du bord bas
# saisie), pour que terrain plat = résultat actuel.


def orientation_reelle(tilt, surface_azimuth, axis_tilt):
    """(β', azimut') d'une table inclinée de `tilt` en travers sur un axe de pente `axis_tilt`."""
    o = pvlib.tracking.calc_surface_orientation(tilt, axis_tilt, (surface_azimuth - 90) % 360)
    return float(np.asarray(o['surface_tilt'])), float(np.asarray(o['surface_azimuth']).ravel()[0]) % 360


def pitch_equivalent(collector_width, tilt, pitch, cross_axis_slope):
    """
    Pas horizontal sur terrain PLAT donnant le même angle de masquage du ciel que la géométrie réelle
    (bord bas de la table ombrée -> bord haut de la table de devant, en coupe).
    Δz = altitude de l'axe de devant - axe ombré = -pas · tan(cross_axis_slope).
    tan ψ = (W sin β + Δz) / (pas - W cos β) ; plat : W sin β / (p_eq - W cos β) = tan ψ.
    Rangée de devant entièrement sous l'horizon du bord bas -> plus de masquage : pas « infini »
    (celui de la référence).
    """
    w, b = collector_width, math.radians(tilt)
    haut = w * math.sin(b)
    if haut <= 1e-9 or abs(cross_axis_slope) < 1e-9:
        return pitch
    libre = pitch - w * math.cos(b)
    if libre <= 1e-9:
        return pitch
    dz = -pitch * math.tan(math.radians(cross_axis_slope))
    if haut + dz <= 1e-9:
        return pitch * REFERENCE_PITCH_FACTOR
    return w * math.cos(b) + haut * libre / (haut + dz)


def perte_ombrage_terrain(groupes, collector_width, height, albedo, ghi, dni, dhi, solpos, dni_extra):
    """
    Cœur du calcul, sans accès réseau (séries horaires fournies) : testable seul.
    groupes : liste de dicts (cf. ombrage_sheds_terrain_schemas.GroupeOmbrage).
    -> {'lossPercent', 'groupes': [{tilt_reel, azimut_reel, lossPercent, panneaux}], 'nbGeometries'}
    """
    zen = solpos['apparent_zenith']
    azi = solpos['azimuth']
    cache = {}

    def sheds(tilt_r, az_r, pas):
        cle = (round(tilt_r, 3), round(az_r, 3), round(pas, 3))
        if cle not in cache:
            cache[cle] = pvlib.bifacial.infinite_sheds.get_irradiance_poa(
                surface_tilt=tilt_r, surface_azimuth=az_r, solar_zenith=zen, solar_azimuth=azi,
                gcr=collector_width / pas, height=height, pitch=pas,
                ghi=ghi, dhi=dhi, dni=dni, albedo=albedo, dni_extra=dni_extra, model='isotropic')
        return cache[cle]

    somme_ombree = 0.0
    somme_reference = 0.0
    sorties = []
    for g in groupes:
        tilt, az, axis_tilt = float(g['tilt']), float(g['surface_azimuth']), float(g.get('axis_tilt', 0))
        panneaux = float(g['panneaux'])
        tilt_r, az_r = orientation_reelle(tilt, az, axis_tilt)
        # Pas de référence : même règle que calcul_shed_shading.py (rangée quasi isolée), à partir du
        # plus petit pas du groupe (ou d'une table seule si le groupe n'a aucun couple).
        pas_ref_base = min([c['pitch'] for c in g.get('couples', [])] or [collector_width * 2])
        reference = sheds(tilt_r, az_r, max(pas_ref_base, collector_width) * REFERENCE_PITCH_FACTOR)
        poa_ref = float(reference['poa_global'].sum())
        beam = np.asarray(pvlib.irradiance.beam_component(tilt_r, az_r, zen, azi, dni))

        poids_ombres = 0.0
        ombree = 0.0
        for c in g.get('couples', []):
            pas, pente, poids = float(c['pitch']), float(c['cross_axis_slope']), float(c['poids'])
            fs = np.asarray(pvlib.shading.shaded_fraction1d(
                zen, azi, (az - 90) % 360, tilt,
                collector_width=collector_width, pitch=pas, axis_tilt=axis_tilt, cross_axis_slope=pente))
            diffus = sheds(tilt_r, az_r, pitch_equivalent(collector_width, tilt, pas, pente))
            poa = float(np.nansum(beam * (1 - fs))) + float(diffus['poa_sky_diffuse'].sum()) \
                + float(diffus['poa_ground_diffuse'].sum())
            ombree += poids * poa
            poids_ombres += poids
        poids_ombres = min(poids_ombres, panneaux)
        ombree += (panneaux - poids_ombres) * poa_ref
        reference_groupe = panneaux * poa_ref

        somme_ombree += ombree
        somme_reference += reference_groupe
        perte_groupe = max(0.0, (1 - ombree / reference_groupe) * 100) if reference_groupe > 0 else None
        sorties.append({
            'tilt_reel': round(tilt_r, 2), 'azimut_reel': round(az_r, 2),
            'lossPercent': None if perte_groupe is None else round(perte_groupe, 2),
            'panneaux': panneaux,
        })

    if somme_reference <= 0:
        return {'error': "Irradiance de référence nulle — vérifiez la latitude/longitude du projet."}
    perte = max(0.0, (1 - somme_ombree / somme_reference) * 100)
    return {'lossPercent': round(perte, 2), 'groupes': sorties, 'nbGeometries': len(cache)}


def calculate_shed_shading_terrain_data(params):
    """params : dict validé par ShedShadingTerrainParams. -> résultat ou {'error': str}."""
    try:
        _, ghi, dni, dhi, solpos, dni_extra, _, _, _ = _get_hourly_solar_series(
            params['lat'], params['lon'], usehorizon=params.get('usehorizon') or '1',
            pv_version=params.get('pv_version') or 'v5_3', time_step=int(params.get('time_step') or 60),
            force_api=bool(params.get('force_api')),
            cache_id=str(params.get('tmy_cache_id') or '')[:32] or None,
        )
        return perte_ombrage_terrain(
            params['groupes'], params['collector_width'], params.get('height', 0.5), params.get('albedo', 0.2),
            ghi, dni, dhi, solpos, dni_extra)
    except Exception as e:
        logging.exception("Erreur calculate_shed_shading_terrain_data")
        return {'error': str(e)}
