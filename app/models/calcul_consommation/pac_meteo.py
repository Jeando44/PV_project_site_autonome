"""
Données météo du module PAC / climatiseur (modale de consommation, Irve/pac_climatisation/).

Réutilise la série météo de la production PV (_get_hourly_solar_series : année type, cache local
5/10 km, pas de 10/15/30/60 min) et la remet sur la grille de la courbe IRVE : 365 jours (29 février
retiré), heure MURALE, position i = 1er janvier 00:00 locale + i pas. La courbe PAC simulée sur cette
grille est ensuite recalée en UTC+1 par le serveur exactement comme la courbe IRVE
(heure_locale_vers_utc1) : la météo retombe alors sur la même référence que la production PV
(utc_vers_utc1), cf. calage_horaire.py.

Sources et méthodes :
  - irradiation sur plan vertical : modèle de ciel isotrope (Liu & Jordan, 1963), albédo 0,2 —
    pvlib.irradiance.get_total_irradiance (pvlib, licence BSD-3) ;
  - températures de base : minimum (hiver) et maximum (été) de la moyenne glissante sur 3 h de la
    série du site, plus le centile 0,4 % / 99,6 % à titre indicatif (définition statistique usuelle
    des températures de conception). Une année type lisse les extrêmes : la valeur reste modifiable
    par l'utilisateur.
"""
import numpy as np
import pandas as pd
import pvlib

from app.models.calcul_prodsolaire.calage_horaire import FUSEAU_LOCAL
from app.models.calcul_prodsolaire.calcul_prodsolaire import _get_hourly_solar_series

PAS_AUTORISES = (10, 15, 30, 60)
ALBEDO_SOL = 0.2
# Azimuts des façades, convention pvlib (0 = nord, 90 = est, 180 = sud, 270 = ouest).
FACADES = {'N': 0.0, 'E': 90.0, 'S': 180.0, 'O': 270.0}


def jours_grille(annee: int):
    """Les 365 jours de la grille annuelle (29 février retiré), comme calcul_irve.js."""
    jours = pd.date_range(pd.Timestamp(year=int(annee), month=1, day=1), periods=366, freq='D')
    jours = jours[~((jours.month == 2) & (jours.day == 29))]
    return jours[:365]


def positions_utc_pour_grille_murale(annee: int, pas_minutes: int) -> np.ndarray:
    """Pour chaque pas de la grille murale (365 j), position dans une série UTC de 365 j au même pas.

    Heure murale t -> UTC = t - décalage (1 h en hiver, 2 h en été). Le créneau inexistant de mars
    est décalé vers l'avant ; le créneau vécu deux fois en octobre est pris en heure d'été. Le jour
    de l'année est conservé (une année type n'a pas de jour de semaine propre).

    Les dates de changement d'heure suivent la MÊME convention que heure_locale_vers_utc1, qui
    recalera la courbe PAC : position i = 1er janvier + i pas, en continu. Ainsi l'aller-retour
    météo -> heure murale -> UTC+1 retombe exactement sur utc_vers_utc1 (production PV), y compris
    en année bissextile."""
    pas = int(pas_minutes)
    n = 365 * 24 * 60 // pas
    murale = pd.date_range(pd.Timestamp(year=int(annee), month=1, day=1), periods=n, freq=f'{pas}min')
    localise = murale.tz_localize(FUSEAU_LOCAL, ambiguous=np.ones(len(murale), dtype=bool),
                                  nonexistent='shift_forward')
    decalage_min = np.array([d.total_seconds() / 60.0 for d in localise.map(lambda t: t.utcoffset())])
    return ((np.arange(n) - np.round(decalage_min / pas).astype(int)) % n).astype(int)


def _temperatures_base(temp, pas_minutes):
    pas_par_heure = max(1, 60 // int(pas_minutes))
    glissante = pd.Series(temp).rolling(3 * pas_par_heure, min_periods=1, center=True).mean()
    return {
        'hiver_min_3h': float(glissante.min()),
        'ete_max_3h': float(glissante.max()),
        'hiver_centile_0_4': float(np.percentile(temp, 0.4)),
        'ete_centile_99_6': float(np.percentile(temp, 99.6)),
    }


def serie_meteo_pac(lat: float, lon: float, pas_minutes: int, annee: int, cache_id=None) -> dict:
    """Séries météo du site sur la grille murale de 365 jours, au pas demandé."""
    pas = int(pas_minutes)
    if pas not in PAS_AUTORISES:
        raise ValueError(f"Pas de temps non pris en charge : {pas} min.")
    source, extra = {}, {}
    index, ghi, dni, dhi, solpos, dni_extra, temp_air, _vent, _cache = _get_hourly_solar_series(
        lat, lon, time_step=pas, cache_id=cache_id, source_info=source, series_extra=extra)

    n_attendu = 365 * 24 * 60 // pas
    if len(index) < n_attendu:
        raise ValueError(f"Série météo incomplète ({len(index)} valeurs, {n_attendu} attendues).")
    sl = slice(0, n_attendu)

    irr = {'H': np.clip(np.asarray(ghi, dtype=float)[sl], 0, None)}
    for nom, azimut in FACADES.items():
        tot = pvlib.irradiance.get_total_irradiance(
            surface_tilt=90.0, surface_azimuth=azimut,
            solar_zenith=solpos['apparent_zenith'], solar_azimuth=solpos['azimuth'],
            dni=dni, ghi=ghi, dhi=dhi, dni_extra=dni_extra, albedo=ALBEDO_SOL, model='isotropic')
        irr[nom] = np.nan_to_num(np.clip(np.asarray(tot['poa_global'], dtype=float)[sl], 0, None))

    temp = np.asarray(temp_air, dtype=float)[sl]
    rh = np.asarray(extra.get('RH', np.full(n_attendu, 70.0)), dtype=float)[sl]

    pos = positions_utc_pour_grille_murale(annee, pas)
    temp_m, rh_m = temp[pos], np.clip(rh[pos], 0, 100)

    # Moyennes mensuelles (grille murale) : température d'eau froide de l'ECS.
    jours = jours_grille(annee)
    mois = np.repeat(jours.month.values, 24 * 60 // pas)
    moyennes_mensuelles = [float(temp_m[mois == m].mean()) for m in range(1, 13)]

    return {
        'pas_minutes': pas,
        'annee': int(annee),
        'n': int(n_attendu),
        'temperature': np.round(temp_m, 2).tolist(),
        'humidite': np.round(rh_m, 1).tolist(),
        'irradiation': {k: np.round(v[pos], 1).tolist() for k, v in irr.items()},
        'temperatures_base': _temperatures_base(temp, pas),
        'temperature_moyenne_annuelle': float(temp.mean()),
        'temperatures_moyennes_mensuelles': moyennes_mensuelles,
        'altitude_meteo_m': source.get('elevation_m'),
        'avertissement': source.get('warning'),
    }


def altitude_site(lat: float, lon: float, dossier_cache: str) -> dict:
    """Altitude du terrain au point de l'adresse du projet (champ « Altitude du site » de la PAC).

    Mêmes données libres que le relief des calepinages (app/services/terrain) : RGE ALTI de l'IGN
    (Licence Ouverte Etalab) en métropole et en Corse, puis Copernicus DEM GLO-30 (monde entier).
    Retourne {'altitude_m': float | None, 'source': 'ign' | 'copernicus' | None} ; aucune exception
    ne remonte (l'altitude reste alors à saisir).
    """
    import logging
    from app.services.terrain.grille_cache import dans_domaine_ign, grille_copernicus_pour_points
    from app.services.terrain.mnt import altitudes_points_ign

    journal = logging.getLogger(__name__)
    point = [(float(lat), float(lon))]
    if dans_domaine_ign(point):
        try:
            z = altitudes_points_ign(point)[0]
            if z is not None:
                return {'altitude_m': round(z, 1), 'source': 'ign'}
        except Exception as e:  # service indisponible : on tente la source mondiale
            journal.warning("Altitude IGN indisponible : %s", e)
    try:
        grille, _ = grille_copernicus_pour_points(point, 30.0, dossier_cache)
        z = grille.altitude(lat, lon)
        if z is not None:
            return {'altitude_m': round(float(z), 1), 'source': 'copernicus'}
    except Exception as e:
        journal.warning("Altitude Copernicus indisponible : %s", e)
    return {'altitude_m': None, 'source': None}
