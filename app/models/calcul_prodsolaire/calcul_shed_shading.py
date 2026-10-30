"""
Calcul de la perte d'ombrage inter-rangées ("sheds") — délégué à pvlib
(pvlib.bifacial.infinite_sheds.get_irradiance_poa), qui simule l'irradiance POA reçue heure par
heure sur toute une année TMY compte tenu de la géométrie réelle des rangées (hauteur, pas,
inclinaison, azimut), puis compare cette irradiance annuelle cumulée à celle d'une rangée isolée
(sans ombrage mutuel) pour obtenir une perte d'énergie annuelle pondérée par l'irradiance — la même
convention que PVsyst.

Root cause de l'ancien calcul JS (PolygonPanelsManager.computeShedShading) : il évaluait un critère
géométrique ponctuel ("pas d'ombre à midi solaire au solstice d'hiver", sun_elevation =
90 - |lat| - 23.45) puis en déduisait une "perte %" linéaire (1 - distance_réelle/distance_optimale)
qui retombe exactement à 0% au-delà d'un seuil. Une perte annuelle pondérée par l'irradiance ne peut
structurellement pas être reproduite par une formule fermée ponctuelle : elle nécessite d'intégrer
la position solaire et l'irradiance sur (au moins) une année complète, ce que fait cette fonction via
la série TMY déjà utilisée pour le calcul de production (_get_hourly_solar_series, réutilisée telle
quelle, sans nouvel appel PVGIS).
"""

import logging
import math

import pvlib

from .calcul_prodsolaire import _get_hourly_solar_series

DEFAULT_ALBEDO = 0.2
# Hauteur du bord bas de rangée au-dessus du sol (garde au sol) : non fournie par l'utilisateur,
# valeur par défaut usuelle pour un shed/ombrière au sol. Paramétrable via 'height' si besoin.
DEFAULT_HEIGHT_M = 0.5
# Facteur multiplicatif de pitch utilisé pour simuler un cas de référence "sans ombrage mutuel"
# (GCR quasi nul) avec le même modèle infinite_sheds plutôt qu'un calcul d'irradiance POA distinct
# (garantit que seule la géométrie inter-rangées diffère entre les deux simulations).
REFERENCE_PITCH_FACTOR = 100


def calculate_shed_shading_data(params):
    """
    Params attendus (JSON) :
      lat, lon (float, requis)
      tilt (float, degrés) : inclinaison des panneaux du shed
      gap (float, m) : espace libre entre le bord arrière d'une rangée et le bord avant de la
        suivante ("Esp. entre sheds" / shedsColSpacing, TEL QUE SAISI par l'utilisateur — PAS le
        pas centre-à-centre attendu par pvlib, cf. note ci-dessous)
      collector_width (float, m) : profondeur du shed le long de la pente (shedsCols * length +
        (shedsCols-1) * spacingX)
      azimuth (float, degrés, défaut 180) : orientation du shed en convention pvlib (180 = Sud)
      albedo (float, défaut 0.2)
      height (float, m, défaut 0.5) : hauteur du bord bas de rangée au-dessus du sol
      usehorizon, pv_version, time_step, force_api, tmy_cache_id : mêmes options que /calculate_pv (cache TMY partagé)

    Retourne {'lossPercent': float} ou {'error': str} en cas d'échec.

    CORRECTIF IMPORTANT : "Esp. entre sheds" (gap) est l'espace LIBRE entre deux rangées (cf. son
    nom : "espacement ENTRE sheds"), alors que le paramètre `pitch` attendu par
    pvlib.bifacial.infinite_sheds.get_irradiance_poa est le pas centre-à-centre (ou bord-à-bord
    équivalent), qui inclut EN PLUS l'empreinte au sol de la rangée elle-même
    (collector_width * cos(tilt)). Confondre les deux (utiliser `gap` directement comme `pitch`)
    sous-estime fortement le pas réel, gonfle artificiellement le GCR (collector_width/pitch) et
    donc la perte d'ombrage calculée — c'est ce qui produisait des pertes aberrantes (~80% pour un
    espacement de 50cm, alors qu'une valeur réaliste est de l'ordre de 10%).
    """
    try:
        lat = float(params.get('lat'))
        lon = float(params.get('lon'))
        tilt = float(params.get('tilt', 0))
        # 'gap' est le nom correct ; 'pitch' est conservé en repli pour compatibilité avec d'anciens
        # appels, mais est TOUJOURS interprété comme un espace libre, jamais comme un pas pvlib direct.
        gap = float(params.get('gap', params.get('pitch', 0)))
        collector_width = float(params.get('collector_width', 0))
        azimuth = float(params.get('azimuth', 180))
        albedo = float(params.get('albedo', DEFAULT_ALBEDO))
        height = float(params.get('height', DEFAULT_HEIGHT_M))

        usehorizon = params.get('usehorizon', '1')
        pv_version = params.get('pv_version', 'v5_3')
        time_step = int(params.get('time_step', 60))
        force_api = params.get('force_api', False)
        tmy_cache_id = str(params.get('tmy_cache_id') or '')[:32] or None

        if gap <= 0 or collector_width <= 0:
            return {'error': "L'espacement entre sheds et la profondeur de shed doivent être strictement positifs."}

        ground_projected_depth = collector_width * math.cos(math.radians(tilt))
        pitch = gap + ground_projected_depth
        gcr = collector_width / pitch

        _, ghi, dni, dhi, solpos, dni_extra, _, _, _ = _get_hourly_solar_series(
            lat, lon, usehorizon=usehorizon, pv_version=pv_version, time_step=time_step, force_api=force_api,
            cache_id=tmy_cache_id
        )

        common_kwargs = dict(
            surface_tilt=tilt,
            surface_azimuth=azimuth,
            solar_zenith=solpos['apparent_zenith'],
            solar_azimuth=solpos['azimuth'],
            height=height,
            ghi=ghi,
            dhi=dhi,
            dni=dni,
            albedo=albedo,
            dni_extra=dni_extra,
            model='isotropic',
        )

        shaded = pvlib.bifacial.infinite_sheds.get_irradiance_poa(gcr=gcr, pitch=pitch, **common_kwargs)
        reference = pvlib.bifacial.infinite_sheds.get_irradiance_poa(
            gcr=gcr / REFERENCE_PITCH_FACTOR, pitch=pitch * REFERENCE_PITCH_FACTOR, **common_kwargs
        )

        poa_shaded_sum = float(shaded['poa_global'].sum())
        poa_reference_sum = float(reference['poa_global'].sum())

        if poa_reference_sum <= 0:
            return {'error': "Irradiance de référence nulle — vérifiez la latitude/longitude du projet."}

        loss_percent = max(0.0, (1 - poa_shaded_sum / poa_reference_sum) * 100)

        return {'lossPercent': round(loss_percent, 2)}
    except Exception as e:
        logging.exception("Erreur calcul_shed_shading_data")
        return {'error': str(e)}
