import requests
import datetime
import hashlib
import math
import threading
import pytz
import pandas as pd
import pvlib
from timezonefinder import TimezoneFinder
import logging

from .calcul_ombrage_proche import (
    compute_field_near_shading, parse_active_area_ratio, prepare_near_shading_scene,
)

# Cache global en mémoire pour limiter les appels PVGIS (Simule une BDD Météo).
# Clé : "<lat>_<lon>_<usehorizon>_<pv_version>" (pv_version contient lui-même un "_", ex. v5_3).
# Les coordonnées RÉELLES du téléchargement PVGIS sont conservées dans TMY_CACHE_META ; une entrée
# sans métadonnées (ancienne clé arrondie, entrée injectée par les tests) est localisée par sa clé.
TMY_CACHE = {}
TMY_CACHE_META = {}
# Le serveur tourne en multi-thread (gunicorn --threads 8) : parcours et écritures du cache sous verrou
# (un dict modifié pendant son parcours lève RuntimeError). Le téléchargement PVGIS se fait HORS verrou.
_TMY_CACHE_LOCK = threading.RLock()

# Rayon d'utilisation AUTOMATIQUE d'une base locale (sans choix de l'utilisateur) : au-delà, PVGIS
# est interrogé pour le site exact.
TMY_CACHE_RAYON_AUTO_KM = 5.0
# Rayon maximal des bases proposées dans la liste déroulante, et pouvant être imposées par
# l'utilisateur pour le calcul.
TMY_CACHE_RAYON_MAX_KM = 10.0


def _distance_km(lat1, lon1, lat2, lon2):
    """Distance orthodromique (Haversine, sphère de 6371 km) entre deux points, en km."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2.0) ** 2
    return 6371.0 * 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def _tmy_cache_id(key):
    """Identifiant opaque d'une entrée du cache : la clé contient les coordonnées exactes d'un autre
    projet, elle n'est donc jamais envoyée au navigateur."""
    return hashlib.sha1(key.encode('utf-8')).hexdigest()[:16]


def _tmy_cache_entry_info(key):
    """(lat, lon, usehorizon, pv_version, created_at) d'une entrée du cache, ou None si la clé est
    illisible. À appeler sous _TMY_CACHE_LOCK."""
    meta = TMY_CACHE_META.get(key)
    if meta:
        return meta['lat'], meta['lon'], meta['usehorizon'], meta['pv_version'], meta.get('created_at')
    parts = key.split('_', 3)
    if len(parts) != 4:
        return None
    try:
        return float(parts[0]), float(parts[1]), parts[2], parts[3], None
    except ValueError:
        return None


def list_cached_tmy(lat, lon, usehorizon='1', pv_version='v5_3', max_km=TMY_CACHE_RAYON_MAX_KM):
    """Bases météo en cache compatibles (même horizon, même version PVGIS) situées à max_km au plus
    du site, triées de la plus proche à la plus éloignée. La plus proche, si elle est à
    TMY_CACHE_RAYON_AUTO_KM au plus, est marquée 'auto' : c'est celle qu'utilise le calcul sans choix
    explicite de l'utilisateur."""
    usehorizon, pv_version = str(usehorizon), str(pv_version)
    entries = []
    with _TMY_CACHE_LOCK:
        for key in TMY_CACHE:
            info = _tmy_cache_entry_info(key)
            if not info:
                continue
            e_lat, e_lon, e_horizon, e_version, created_at = info
            if e_horizon != usehorizon or e_version != pv_version:
                continue
            dist = _distance_km(lat, lon, e_lat, e_lon)
            if dist <= max_km:
                entries.append({
                    'id': _tmy_cache_id(key),
                    'key': key,
                    'distance_km': round(dist, 2),
                    'usehorizon': e_horizon,
                    'pv_version': e_version,
                    'created_at': created_at,
                })
    entries.sort(key=lambda e: e['distance_km'])
    for i, e in enumerate(entries):
        e['auto'] = (i == 0 and e['distance_km'] <= TMY_CACHE_RAYON_AUTO_KM)
    return entries


def get_cached_tmy_list(lat=None, lon=None, usehorizon='1', pv_version='v5_3'):
    """Bases météo en cache à TMY_CACHE_RAYON_MAX_KM au plus du site, SANS la clé interne
    (coordonnées exactes d'autres projets) : liste prête à être renvoyée au navigateur. Site
    inconnu -> liste vide."""
    if lat is None or lon is None:
        return []
    return [{k: v for k, v in e.items() if k != 'key'}
            for e in list_cached_tmy(lat, lon, usehorizon, pv_version)]


def delete_cached_tmy(entry_id):
    """Supprime l'entrée du cache d'identifiant entry_id (cf. _tmy_cache_id). True si supprimée."""
    with _TMY_CACHE_LOCK:
        for key in list(TMY_CACHE):
            if _tmy_cache_id(key) == entry_id:
                TMY_CACHE.pop(key, None)
                TMY_CACHE_META.pop(key, None)
                logging.info("Base météo locale %s supprimée du cache.", key)
                return True
    return False


def _resolve_cached_tmy(lat, lon, usehorizon, pv_version, cache_id=None):
    """Choisit la base locale à utiliser : celle imposée par l'utilisateur (cache_id) si elle existe
    encore et reste à TMY_CACHE_RAYON_MAX_KM au plus, sinon la plus proche à TMY_CACHE_RAYON_AUTO_KM
    au plus. Retourne (key, distance_km, df_copie, mode, avertissement) ; df None = aucune base."""
    warning = None
    entries = list_cached_tmy(lat, lon, usehorizon, pv_version)
    chosen, mode = None, None
    if cache_id:
        chosen = next((e for e in entries if e['id'] == cache_id), None)
        if chosen:
            mode = 'selection'
        else:
            warning = ("La base météo locale sélectionnée n'est plus disponible (supprimée, serveur "
                       f"redémarré ou située à plus de {TMY_CACHE_RAYON_MAX_KM:g} km du site) : "
                       "sélection automatique appliquée.")
            logging.warning("Base météo locale %s introuvable pour (%s, %s) : sélection automatique.",
                            cache_id, lat, lon)
    if not chosen and entries and entries[0]['auto']:
        chosen, mode = entries[0], 'auto'
    if not chosen:
        return None, None, None, None, warning
    with _TMY_CACHE_LOCK:
        df = TMY_CACHE.get(chosen['key'])
        df = df.copy() if df is not None else None
    if df is None:  # supprimée entre-temps par un administrateur
        return None, None, None, None, warning
    return chosen['key'], chosen['distance_km'], df, mode, warning


def _clearsky_ghi(times, lat, lon, apparent_zenith):
    """GHI ciel clair (modèle Ineichen, turbidité de Linke climatologique pvlib) pour une série de dates."""
    dni_extra = pvlib.irradiance.get_extra_radiation(times)
    airmass_rel = pvlib.atmosphere.get_relative_airmass(apparent_zenith)
    airmass_abs = pvlib.atmosphere.get_absolute_airmass(airmass_rel)
    linke_turbidity = pvlib.clearsky.lookup_linke_turbidity(times, lat, lon)
    clearsky = pvlib.clearsky.ineichen(apparent_zenith, airmass_abs, linke_turbidity, dni_extra=dni_extra)
    return clearsky['ghi']

def _get_hourly_solar_series(lat, lon, usehorizon='1', pv_version='v5_3', time_step=60, force_api=False,
                             cache_id=None, source_info=None, series_extra=None):
    """
    Récupère (TMY PVGIS, avec cache module TMY_CACHE) et prépare la série annuelle ghi/dni/dhi +
    position solaire (+ dni_extra) pour un site donné, à la résolution demandée. Factorisé depuis
    calculate_pv_data() pour être réutilisé par d'autres calculs (ex: perte d'ombrage shed,
    calcul_shed_shading.py) sans dupliquer la logique de cache/fetch PVGIS ni la décomposition
    Erbs sous-horaire.

    Base météo : force_api=True -> toujours PVGIS ; sinon la base locale choisie par l'utilisateur
    (cache_id, à TMY_CACHE_RAYON_MAX_KM au plus) ou, à défaut, la plus proche à TMY_CACHE_RAYON_AUTO_KM
    au plus ; sinon PVGIS (le résultat est alors mis en cache). source_info (dict optionnel) reçoit
    le détail de la source retenue (mode, distance, avertissement, altitude de la donnée météo
    'elevation_m' quand elle est connue). series_extra (dict optionnel) reçoit les séries
    supplémentaires à la même résolution : 'RH' (humidité relative, %), utilisée par le module
    PAC (dégivrage). Le tuple renvoyé est inchangé.

    Retourne (index, ghi, dni, dhi, solpos, dni_extra, temp_air, wind_speed, used_cache).
    """
    usehorizon, pv_version = str(usehorizon), str(pv_version)
    source = {'used_cache': False, 'mode': 'pvgis', 'distance_km': None, 'forced': bool(force_api),
              'rayon_auto_km': TMY_CACHE_RAYON_AUTO_KM, 'rayon_max_km': TMY_CACHE_RAYON_MAX_KM,
              'warning': None}

    df = None
    if not force_api:
        key, dist, df, mode, warning = _resolve_cached_tmy(lat, lon, usehorizon, pv_version, cache_id)
        source['warning'] = warning
        if df is not None:
            logging.info(f"Utilisation du cache TMY météo local {key} ({mode}, {dist} km)")
            source.update({'used_cache': True, 'mode': mode, 'distance_km': dist})
            with _TMY_CACHE_LOCK:
                source['elevation_m'] = (TMY_CACHE_META.get(key) or {}).get('elevation_m')

    if df is None:
        cache_key = f"{lat:.4f}_{lon:.4f}_{usehorizon}_{pv_version}"
        logging.info(f"Appel API PVGIS pour la zone {cache_key}")
        tmy_url = f"https://re.jrc.ec.europa.eu/api/{pv_version}/tmy?lat={lat:.6f}&lon={lon:.6f}&usehorizon={usehorizon}&outputformat=json"
        resp = requests.get(tmy_url, timeout=30)
        resp.raise_for_status()

        tmy_json = resp.json()
        tmy_data = tmy_json['outputs']['tmy_hourly']
        df = pd.DataFrame(tmy_data)
        # Altitude de la donnée météo (m) : sert à la correction d'altitude des températures (PAC).
        elevation_m = ((tmy_json.get('inputs') or {}).get('location') or {}).get('elevation')
        source['elevation_m'] = float(elevation_m) if elevation_m is not None else None

        # Reconstruction d'un index chronologique continu
        times = df['time(UTC)'].str.extract(r'\d{4}(\d{2})(\d{2}):(\d{2})(\d{2})')
        df['datetime'] = pd.to_datetime('2023' + times[0] + times[1] + times[2] + times[3], format='%Y%m%d%H%M')
        df = df.set_index('datetime').tz_localize('UTC')
        df = df.drop(columns=['time(UTC)'])
        with _TMY_CACHE_LOCK:
            TMY_CACHE[cache_key] = df.copy()
            TMY_CACHE_META[cache_key] = {
                'lat': float(lat), 'lon': float(lon), 'usehorizon': usehorizon, 'pv_version': pv_version,
                'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
                'elevation_m': source['elevation_m'],
            }

    if source_info is not None:
        source_info.update(source)
    used_cache = source['used_cache']

    solpos_native = pvlib.solarposition.get_solarposition(df.index, lat, lon)

    # Sécurisation nocturne à la résolution native, AVANT toute interpolation.
    night_mask_native = solpos_native['apparent_zenith'] >= 90
    for col in ['G(h)', 'Gb(n)', 'Gd(h)']:
        df[col] = df[col].clip(lower=0)
        df.loc[night_mask_native, col] = 0.0

    if time_step < 60:
        steps_per_hour = 60 // time_step
        target_index = pd.date_range(df.index[0], periods=len(df) * steps_per_hour, freq=f"{time_step}min")

        sub_df = pd.DataFrame({'T2m': df['T2m'], 'WS10m': df['WS10m'],
                               'RH': df['RH'] if 'RH' in df.columns else 70.0})
        sub_df = sub_df.reindex(sub_df.index.union(target_index)).interpolate(method='linear', limit_direction='both').reindex(target_index)

        # Un sous-pas étiqueté t couvre [t, t + pas[ (comme les consommations, moyennées par bloc) :
        # position du soleil et ciel clair évalués au milieu du sous-pas.
        centres = target_index + pd.Timedelta(minutes=time_step / 2)
        solpos = pvlib.solarposition.get_solarposition(centres, lat, lon)
        ghi_clearsky_sub = _clearsky_ghi(centres, lat, lon, solpos['apparent_zenith'])
        solpos.index = target_index
        night_mask = solpos['apparent_zenith'] >= 90
        ghi_clearsky_sub = pd.Series(ghi_clearsky_sub.to_numpy(), index=target_index).fillna(0.0).clip(lower=0)
        ghi_clearsky_sub[night_mask] = 0.0

        # La valeur horaire G(h) est la moyenne de HH:00 à HH:59 (pas une mesure à HH:00) : indice de
        # clarté horaire = G(h) / ciel clair moyen de l'heure, placé au milieu de l'heure (HH:30)
        # puis interpolé aux milieux des sous-pas. Placé à HH:00, il avançait la production de la
        # journée de 14 à 25 min selon le pas (autoconsommation surestimée).
        heures = target_index.floor('h')
        ghi_clearsky_h = ghi_clearsky_sub.groupby(heures).mean().reindex(df.index).fillna(0.0)
        kt_h = pvlib.irradiance.clearsky_index(df['G(h)'], ghi_clearsky_h, max_clearsky_index=2.0)
        kt_h = pd.Series(kt_h.to_numpy(), index=df.index + pd.Timedelta(minutes=30))
        kt_sub = (kt_h.reindex(kt_h.index.union(centres)).interpolate(method='linear', limit_direction='both')
                  .reindex(centres))
        ghi = pd.Series(kt_sub.clip(lower=0).to_numpy(), index=target_index) * ghi_clearsky_sub

        # Conservation par heure : la moyenne des sous-pas de chaque heure redonne G(h), d'où la
        # même énergie horaire qu'au pas de 60 min.
        moyenne_h = ghi.groupby(heures).mean().reindex(df.index)
        facteur = (df['G(h)'] / moyenne_h).where(moyenne_h > 0, 0.0).fillna(0.0)
        ghi = (ghi * facteur.reindex(heures).to_numpy()).clip(lower=0)
        ghi[night_mask] = 0.0

        decomp = pvlib.irradiance.erbs(ghi, solpos['apparent_zenith'], target_index)
        dni = decomp['dni'].clip(lower=0)
        dhi = decomp['dhi'].clip(lower=0)
        dni[night_mask] = 0.0
        dhi[night_mask] = 0.0

        temp_air, wind_speed = sub_df['T2m'], sub_df['WS10m']
        if series_extra is not None:
            series_extra['RH'] = sub_df['RH']
        index = target_index
    else:
        solpos = solpos_native
        ghi, dni, dhi = df['G(h)'], df['Gb(n)'], df['Gd(h)']
        temp_air, wind_speed = df['T2m'], df['WS10m']
        if series_extra is not None:
            series_extra['RH'] = df['RH'] if 'RH' in df.columns else pd.Series(70.0, index=df.index)
        index = df.index

    dni_extra = pvlib.irradiance.get_extra_radiation(index)

    return index, ghi, dni, dhi, solpos, dni_extra, temp_air, wind_speed, used_cache

# Bornes des "Simulations avancées" (carte dédiée de prodsolaire_body.html) : mêmes intervalles
# imposés côté HTML (min/max) et JS (clampAdvancedInput), reproduits ici en défense en profondeur
# puisque ce payload peut être construit/modifié côté client.
BRIDAGE_PERCENT_RANGE = (0.0, 100.0)
TEMPCOEFF_PMAX_RANGE = (-0.40, -0.15)

def _clamp(value, bounds):
    lo, hi = bounds
    return max(lo, min(hi, value))

def _parse_advanced_sim_params(params):
    """
    Lit la configuration optionnelle 'advanced_sim' (case "Appliquer ces paramètres avancés" de
    la carte "Simulations avancées") : {enabled, tempcoeff_pmax, monthly:[{month,
    bridage_percent}, ...]}. Le coefficient de température Pmax est une valeur UNIQUE pour toute
    l'année (pas un réglage par mois) ; seul le bridage onduleur varie mois par mois.
    Retourne (enabled, tempcoeff_pmax, {mois(1-12): bridage_percent}), valeurs bornées aux
    intervalles autorisés.
    """
    advanced_sim = params.get('advanced_sim') or {}
    enabled = bool(advanced_sim.get('enabled'))
    tempcoeff_pmax = _clamp(float(advanced_sim.get('tempcoeff_pmax', -0.29) or -0.29), TEMPCOEFF_PMAX_RANGE)
    monthly_bridage = {}
    for entry in (advanced_sim.get('monthly') or []):
        try:
            month = int(entry.get('month'))
            if month < 1 or month > 12:
                continue
            bridage_percent = _clamp(float(entry.get('bridage_percent', 0.0)), BRIDAGE_PERCENT_RANGE)
        except (TypeError, ValueError):
            continue
        monthly_bridage[month] = bridage_percent
    return enabled, tempcoeff_pmax, monthly_bridage

def calculate_pv_data(params):
    try:
        lat = float(params.get('lat', 0))
        lon = float(params.get('lon', 0))
        usehorizon = params.get('usehorizon', '1')
        pv_version = params.get('pv_version', 'v5_3')
        time_step = int(params.get('time_step', 60))
        force_api = bool(params.get('force_api', False))
        # Base météo locale imposée par l'utilisateur (identifiant opaque, cf. get_cached_tmy_list).
        tmy_cache_id = str(params.get('tmy_cache_id') or '')[:32] or None
        # On récupère la valeur, même si elle n'est pas utilisée directement dans ce calcul
        aux_cons_kw = float(params.get('aux_cons', 3.5)) / 1000.0

        # "Simulations avancées" (carte dédiée, cf. prodsolaire_body.html) : bridage onduleur
        # défini mois par mois + un coefficient de température Pmax UNIQUE pour toute l'année
        # (pas un coefficient par mois), tous deux pilotés par l'utilisateur plutôt que le
        # coefficient fixe de la fiche technique du panneau. Désactivé par défaut (comportement
        # DeSoto/PVWatts existant inchangé, cf. section 5 plus bas).
        advanced_sim_enabled, advanced_tempcoeff_pmax, advanced_monthly_bridage = _parse_advanced_sim_params(params)

        fields = params.get('fields', [])
        if not fields:
            raise ValueError("Aucun champ PV configuré.")

        # 1-2. Vecteurs Météo & Solaire (TMY PVGIS avec cache, position solaire, GHI/DNI/DHI à la
        # résolution demandée) : factorisé dans _get_hourly_solar_series(), réutilisé tel quel par
        # calcul_shed_shading.py pour éviter un second appel PVGIS/une seconde logique de cache.
        meteo_source = {}
        index, ghi, dni, dhi, solpos, dni_extra, temp_air, wind_speed, used_cache = _get_hourly_solar_series(
            lat, lon, usehorizon=usehorizon, pv_version=pv_version, time_step=time_step, force_api=force_api,
            cache_id=tmy_cache_id, source_info=meteo_source
        )
        df = pd.DataFrame(index=index)

        field_results = []
        production_by_plant = {} # Dictionnaire pour stocker les séries par centrale
        total_clipping_loss_series = pd.Series(0.0, index=df.index)
        total_peak = 0.0
        
        dt_factor = time_step / 60.0
        
        # 5. Calcul de la variabilité annuelle de l'irradiation globale (GHI)
        daily_ghi_kwh = (ghi * dt_factor).resample('D').sum() / 1000.0
        site_variability_kwh = float(daily_ghi_kwh.std() * (365 ** 0.5))
        site_mean_kwh = float(daily_ghi_kwh.sum())
        site_variability_percent = float((site_variability_kwh / site_mean_kwh * 100) if site_mean_kwh > 0 else 0)

        # Scène 3D d'ombrage proche (arbres, blocs, bâtiments, acrotères, autres champs PV), construite
        # côté navigateur (calepinage_maison_ombrage_scene.js). Absente ou illisible -> calcul sans
        # ombrage proche, comme avant (cf. calcul_ombrage_proche.py).
        # Avertissements (scène refusée par la route : autre projet/compte, trop volumineuse ; éléments
        # de géométrie écartés par la validation) renvoyés dans summary.near_shading_warnings.
        near_warnings = [params['shading_scene_rejet']] if params.get('shading_scene_rejet') else []
        near_scene = prepare_near_shading_scene(params.get('shading_scene'), near_warnings)
        near_loss_weighted_sum = 0.0
        near_loss_weight = 0.0

        for field in fields:
            plant_id = field.get('plant_id', '1')
            peak_power_kw = float(field.get('peak_power', 1))
            total_peak += peak_power_kw
            tilt = float(field.get('angle', lat * 0.76 + 3.1))
            
            # PVGIS Azimuth (0=South, -90=East) -> pvlib Azimuth (180=South, 90=East)
            az_pvgis = float(field.get('aspect', 0.0))
            az_pvlib = (az_pvgis + 180) % 360

            # 3. Transposition Perez
            poa = pvlib.irradiance.get_total_irradiance(
                surface_tilt=tilt,
                surface_azimuth=az_pvlib,
                solar_zenith=solpos['apparent_zenith'],
                solar_azimuth=solpos['azimuth'],
                dni=dni, ghi=ghi, dhi=dhi,
                dni_extra=dni_extra,
                model='perez'
            )
            poa_global = poa['poa_global']
            # Irradiance du plan AVANT ombrage proche : référence du PR (CEI 61724-1, comme la
            # "GlobInc" de PVsyst) — l'ombrage proche est une perte du système, il doit donc faire
            # baisser le PR au lieu de disparaître dans son dénominateur.
            poa_reference = poa_global

            # 3.a Ombrage proche de la scène 3D. Direct + circumsolaire (Perez) : facteur d'ombrage
            # du pas de temps (table par position solaire) ; diffus isotrope + bande d'horizon :
            # facteur constant par saison ; composante réfléchie par le sol : non ombrée.
            field_id = str(field.get('id', 'PV'))
            active_area_ratio = parse_active_area_ratio(field.get('active_area_ratio'))
            near_shading_loss_percent = None
            near = None
            if near_scene is not None and near_scene.has_field(field_id):
                try:
                    near = compute_field_near_shading(
                        near_scene, field_id, solpos['azimuth'], solpos['apparent_zenith'],
                        active_area_ratio=active_area_ratio, lat=lat
                    )
                except Exception as e:
                    logging.warning("Champ PV %s : ombrage proche 3D non calculé (%s).", field_id, e)
                    near = None
            if near is not None:
                airmass = pvlib.atmosphere.get_relative_airmass(solpos['apparent_zenith'])
                perez = pvlib.irradiance.perez(
                    tilt, az_pvlib, dhi, dni, dni_extra,
                    solpos['apparent_zenith'], solpos['azimuth'], airmass, return_components=True
                )
                circumsolar = perez['poa_circumsolar'].fillna(0).clip(lower=0)
                beam_like = poa['poa_direct'].fillna(0).clip(lower=0) + circumsolar
                diffuse_other = (poa['poa_sky_diffuse'].fillna(0) - circumsolar).clip(lower=0)
                lost = beam_like * near['beam_shading'] + diffuse_other * near['diffuse_shading']
                poa_front = poa['poa_global'].fillna(0)
                poa_global = (poa_front - lost).clip(lower=0)
                front_sum = float(poa_front.sum())
                near_shading_loss_percent = (float(lost.sum()) / front_sum * 100.0) if front_sum > 0 else 0.0
                near_loss_weighted_sum += near_shading_loss_percent * front_sum * peak_power_kw
                near_loss_weight += front_sum * peak_power_kw

            # 3.b Irradiance Arrière si Bifacial (Modèle Perez dos au soleil)
            pv_type = field.get('pv_type', 'monofacial')
            if pv_type == 'bifacial':
                logging.warning("Calcul bifacial : Utilisation d'une méthode empirique simplifiée (inversion de tilt). Paramètres avancés manquants.")
                
                # CONTRAT D'INTERFACE : Le paramètre 'albedo' (ainsi que 'bifaciality') ne 
                # doit être récupéré et exposé que si le type de panneau est 'bifacial'.
                albedo = float(field.get('albedo', 0.2))
                bifaciality = float(field.get('bifaciality', 0.7))
                
                poa_rear = pvlib.irradiance.get_total_irradiance(
                    surface_tilt=180 - tilt,
                    surface_azimuth=(az_pvlib + 180) % 360,
                    solar_zenith=solpos['apparent_zenith'],
                    solar_azimuth=solpos['azimuth'],
                    dni=dni, ghi=ghi, dhi=dhi,
                    dni_extra=dni_extra,
                    albedo=albedo,
                    model='perez'
                )
                # Le facteur 0.8 simule de manière très empirique le facteur de vue (structure/ombre)
                rear_contribution = poa_rear['poa_global'] * bifaciality * 0.8
                poa_global = poa_global + rear_contribution
                poa_reference = poa_reference + rear_contribution

            # 4. Modèle Thermique SAPM
            mount = field.get('mount', 'free')
            sapm_params = pvlib.temperature.TEMPERATURE_MODEL_PARAMETERS['sapm']
            
            if mount == 'building':
                # 4. Intégré bâti / BIPV (Non ventilé) - Paramètres accentuant la rétention de chaleur
                temp_params = sapm_params.get('insulated_back_glass_polymer', {'a': -2.81, 'b': -0.0455, 'deltaT': 29})
            elif mount == 'sur_imposition':
                # 3. Panneaux sur bac acier (Faible ventilation)
                temp_params = sapm_params.get('roof_mount_glass_polymer', {'a': -2.98, 'b': -0.0471, 'deltaT': 1})
            elif mount == 'terrasse':
                # 2. Toit terrasse (Aération moyenne)
                temp_params = sapm_params.get('open_rack_glass_polymer', {'a': -3.47, 'b': -0.0594, 'deltaT': 3})
            else:
                # 1. Au sol (Très bien ventilé) - Fallback par défaut ('free')
                temp_params = sapm_params.get('open_rack_glass_glass', {'a': -3.47, 'b': -0.0594, 'deltaT': 3})
            
            cell_temp = pvlib.temperature.sapm_cell(poa_global, temp_air, wind_speed, **temp_params)

            # 5. Modèle de Performance DeSoto à 5 Paramètres
            vmp = float(field.get('vmp', 31.0))
            imp = float(field.get('imp', 12.9))
            voc = float(field.get('voc', 37.1))
            isc = float(field.get('isc', 13.7))
            gamma_pdc = float(field.get('tempcoeff', 0.29)) 
            if gamma_pdc > 0: gamma_pdc = -gamma_pdc # Assurer le signe négatif
            gamma_pdc = gamma_pdc / 100.0

            tempcoeff_voc = float(field.get('tempcoeff_voc', -0.27))
            if tempcoeff_voc > 0: tempcoeff_voc = -tempcoeff_voc # Assurer le signe négatif
            tempcoeff_isc = float(field.get('tempcoeff_isc', 0.04))

            # Conversion des %/°C vers A/°C (alpha_sc) et V/°C (beta_voc)
            alpha_sc = (tempcoeff_isc / 100.0) * isc
            beta_voc = (tempcoeff_voc / 100.0) * voc
            cells_in_series = int(field.get('cells_in_series', 60))

            model_used = 'desoto'
            if advanced_sim_enabled:
                # "Simulations avancées" : modèle PVWatts avec un coefficient Pmax UNIQUE saisi
                # par l'utilisateur (cf. carte "Simulations avancées" de prodsolaire_body.html),
                # au lieu du coefficient fixe de la fiche technique du panneau (gamma_pdc). Seul
                # le bridage onduleur (ci-dessous, après le calcul AC) varie mois par mois. DeSoto
                # n'est pas utilisé dans ce mode : sa formulation à 5 paramètres ne prend
                # justement pas ce coefficient en entrée (la sensibilité de Pmax à la température
                # y est un résultat émergent d'alpha_sc/beta_voc, pas un paramètre réglable
                # indépendamment).
                pdc0 = vmp * imp
                gamma_advanced = advanced_tempcoeff_pmax / 100.0
                p_dc_module = pvlib.pvsystem.pvwatts_dc(poa_global, cell_temp, pdc0, gamma_advanced)
                model_used = 'pvwatts_advanced'
            else:
                try:
                    from pvlib.ivtools.sdm import fit_desoto
                    # 5.a Modèle 5-paramètres (Paramètres STC de référence) - Appel scalaire UNIQUE
                    I_L_ref, I_o_ref, R_s, R_sh_ref, a_ref, _ = fit_desoto(
                        v_mp=vmp, i_mp=imp, v_oc=voc, i_sc=isc,
                        alpha_sc=alpha_sc, beta_voc=beta_voc, cells_in_series=cells_in_series
                    )

                    # 5.b Application dynamique (Vectorisée) sur les 8760h de l'irradiation (poa_global) et de la température
                    photocurrent, saturation_current, resistance_series, resistance_shunt, nNsVth = pvlib.pvsystem.calcparams_desoto(
                        effective_irradiance=poa_global, temp_cell=cell_temp, alpha_sc=alpha_sc,
                        a_ref=a_ref, I_L_ref=I_L_ref, I_o_ref=I_o_ref, R_sh_ref=R_sh_ref, R_s=R_s
                    )

                    diode_params = pvlib.pvsystem.singlediode(
                        photocurrent, saturation_current, resistance_series, resistance_shunt, nNsVth
                    )
                    p_dc_module = diode_params['p_mp']
                except Exception as e:
                    # Fallback robuste au modèle PVWatts en cas d'incohérence mathématique des inputs
                    # utilisateurs — ce chemin utilise bien le coefficient Pmax FIXE de la fiche
                    # technique du panneau (gamma_pdc), contrairement au modèle DeSoto nominal
                    # ci-dessus : on le journalise pour pouvoir le distinguer d'un calcul DeSoto normal.
                    logging.warning(
                        "Champ PV %s : ajustement DeSoto impossible (%s) — repli sur le modèle PVWatts "
                        "avec le coefficient Pmax fixe de la fiche technique.",
                        field.get('id', '?'), e
                    )
                    pdc0 = vmp * imp
                    p_dc_module = pvlib.pvsystem.pvwatts_dc(poa_global, cell_temp, pdc0, gamma_pdc)
                    model_used = 'pvwatts_fallback'

            p_dc_module = p_dc_module.fillna(0).clip(lower=0)

            # Scalabilité à la puissance crête désirée
            pmp_module_w = vmp * imp
            num_modules = (peak_power_kw * 1000) / pmp_module_w
            losses = float(field.get('losses', 14)) / 100.0

            p_dc_total = p_dc_module * num_modules * (1 - losses)

            # 6. Conversion AC, Rendement de l'Onduleur et Écrêtage (Clipping)
            inv_limit_kw = float(field.get('inv_limit', 0))
            inv_cons_w = float(field.get('inv_cons', 0))
            inv_eff = float(field.get('inv_eff', 0))

            if inv_eff > 0:
                # Applique le rendement fixe configuré par l'utilisateur
                if inv_limit_kw > 0:
                    inv_limit_w = inv_limit_kw * 1000
                    dc_limit_w = inv_limit_w / (inv_eff / 100.0)
                    clipping_loss = (p_dc_total - dc_limit_w).clip(lower=0)
                    p_dc_converted = p_dc_total.clip(upper=dc_limit_w)
                    p_ac = p_dc_converted * (inv_eff / 100.0)
                else:
                    p_ac = p_dc_total * (inv_eff / 100.0)
                    clipping_loss = pd.Series(0.0, index=df.index)
            else:
                # Utilise le modèle d'onduleur PVWatts par défaut de pvlib (rendement dynamique nominal ~96%)
                pdc0_inverter = (inv_limit_kw * 1000 / 0.96) if inv_limit_kw > 0 else (peak_power_kw * 1000)
                p_ac_uncapped = pvlib.inverter.pvwatts(p_dc_total, pdc0_inverter).fillna(0)

                if inv_limit_kw > 0:
                    inv_limit_w = inv_limit_kw * 1000
                    p_ac = p_ac_uncapped.clip(upper=inv_limit_w) # Sécurité additionnelle
                    dc_limit_w = inv_limit_w / 0.96
                    clipping_loss = (p_dc_total - dc_limit_w).clip(lower=0)
                else:
                    p_ac = p_ac_uncapped
                    clipping_loss = pd.Series(0.0, index=df.index)

            p_ac = (p_ac - inv_cons_w).clip(lower=0)
            p_ac_kw = p_ac / 1000.0
            clipping_loss_kw = clipping_loss / 1000.0

            if advanced_sim_enabled:
                # Bridage onduleur mensuel ("Simulations avancées") : un pourcentage de RÉDUCTION,
                # pas de puissance autorisée — bridage 0% = aucune limitation, bridage 100% =
                # onduleur totalement éteint ce mois-là (production nulle). Plafond additionnel,
                # propre à chaque mois, appliqué en sortie d'onduleur — distinct du plafond annuel
                # fixe inv_limit déjà pris en compte ci-dessus. La perte d'énergie induite est
                # ajoutée à clipping_loss_kw pour que les KPIs de pertes par écrêtage restent cohérents.
                bridage_ref_kw = inv_limit_kw if inv_limit_kw > 0 else peak_power_kw
                months_of_year = p_ac_kw.index.month
                for month in range(1, 13):
                    month_mask = (months_of_year == month)
                    if not month_mask.any():
                        continue
                    bridage_percent = advanced_monthly_bridage.get(month, 0.0)
                    cap_kw = bridage_ref_kw * (1.0 - bridage_percent / 100.0)
                    bridage_loss = (p_ac_kw[month_mask] - cap_kw).clip(lower=0)
                    clipping_loss_kw.loc[month_mask] = clipping_loss_kw[month_mask] + bridage_loss
                    p_ac_kw.loc[month_mask] = p_ac_kw[month_mask].clip(upper=cap_kw)

            field_prod_kwh = float(p_ac_kw.sum() * dt_factor)

            # Norme CEI 61724-1: PR = E_AC / (P_STC * (H_POA / G_STC)), H_POA avant ombrage proche.
            h_poa_kwh_m2 = float(poa_reference.sum() * dt_factor) / 1000.0
            ideal_prod_kwh = peak_power_kw * (h_poa_kwh_m2 / 1.0) # G_STC = 1 kW/m2
            pr = (field_prod_kwh / ideal_prod_kwh * 100) if ideal_prod_kwh > 0 else 0

            # Irradiation POA (plan des panneaux), avant toute perte système/onduleur, agrégée PAR
            # MOIS CALENDAIRE puis ramenée à une moyenne journalière (kWh/m2/jour) — même convention
            # que les tables PVGIS "Monthly irradiation" (H(i)_m) auxquelles ces valeurs sont
            # comparées. Une première version agrégeait par JOUR CALENDAIRE individuel et prenait le
            # min/max sur toute l'année : un unique jour anormal (ciel exceptionnellement clair en
            # hiver, ou couvert en été) faussait alors fortement le résultat (valeurs observées
            # 0.27/8.74 au lieu de ~1.7/~5 attendus) — la moyenne mensuelle lisse cet effet.
            monthly_poa_sum = (poa_reference * dt_factor).resample('ME').sum() / 1000.0  # kWh/m2 par mois
            days_in_month = monthly_poa_sum.index.days_in_month
            monthly_avg_daily_poa_kwh_m2 = (monthly_poa_sum / days_in_month).round(4).tolist()

            field_results.append({
                'id': field.get('id', 'PV'),
                'peak_power': peak_power_kw,
                'total_production_kwh': field_prod_kwh,
                'specific_production': field_prod_kwh / peak_power_kw if peak_power_kw > 0 else 0,
                'performance_ratio': pr,
                # Perte d'irradiance due à l'ombrage proche de la scène 3D (% de l'irradiation du
                # plan) ; None = champ absent de la scène (non calculé, à distinguer de 0 %).
                'near_shading_loss_percent': (round(near_shading_loss_percent, 2)
                                              if near_shading_loss_percent is not None else None),
                'active_area_ratio': active_area_ratio,
                'monthly_avg_daily_poa_kwh_m2': monthly_avg_daily_poa_kwh_m2,
                'inv_limit': inv_limit_kw,
                'inv_cons': inv_cons_w,
                'model': model_used
            })

            # Agrégation par centrale
            if plant_id not in production_by_plant:
                production_by_plant[plant_id] = pd.Series(0.0, index=df.index)
            production_by_plant[plant_id] += p_ac_kw

            total_clipping_loss_series += clipping_loss_kw

        # Calcul de la production totale pour la rétrocompatibilité et les KPIs globaux
        total_ac_series = sum(production_by_plant.values())

        # Consommation auxiliaire nocturne/diurne globale
        net_ac_series = (total_ac_series - aux_cons_kw).clip(lower=0)

        # Détection dynamique du fuseau horaire
        tf = TimezoneFinder()
        tz_str = tf.timezone_at(lng=lon, lat=lat) or 'UTC'
        local_idx = net_ac_series.index.tz_convert(tz_str)

        # Structure de production par centrale pour l'ACC
        production_data_for_acc = {
            plant_id: series.tolist() for plant_id, series in production_by_plant.items()
        }

        # Données horaires agrégées pour l'affichage simple et la rétrocompatibilité
        aggregated_hourly = [
            {'time': dt.isoformat(), 'P_kW': round(float(p_kw), 4)}
            for dt, p_kw in zip(local_idx, net_ac_series.values)
        ]
        # Enrichissement des données horaires avec la production par centrale
        for i, _ in enumerate(aggregated_hourly):
            aggregated_hourly[i]['plants'] = {pid: pdata[i] for pid, pdata in production_data_for_acc.items()}

        total_net_prod = float(net_ac_series.sum() * dt_factor)
        total_clip = float(total_clipping_loss_series.sum() * dt_factor)

        global_specific = total_net_prod / total_peak if total_peak > 0 else 0
        global_pr = sum(f['performance_ratio'] * f['peak_power'] for f in field_results) / total_peak if total_peak > 0 else 0

        # Aggregate production to monthly totals for the report
        net_ac_series_kwh = net_ac_series * dt_factor
        monthly_production_kwh = net_ac_series_kwh.resample('ME').sum().tolist()

        # Calcul des journées types pour le rapport PDF
        net_ac_series_local = pd.Series(net_ac_series.values, index=local_idx)
        summer_months = [6, 7, 8]
        winter_months = [12, 1, 2]

        summer_profile = net_ac_series_local[net_ac_series_local.index.month.isin(summer_months)]
        winter_profile = net_ac_series_local[net_ac_series_local.index.month.isin(winter_months)]

        # Groupement par heure et calcul de la moyenne
        avg_summer_day = pd.Series(0, index=range(24))
        if not summer_profile.empty:
            avg_summer_day = summer_profile.groupby(summer_profile.index.hour).mean().reindex(range(24), fill_value=0)
        avg_winter_day = pd.Series(0, index=range(24))
        if not winter_profile.empty:
            avg_winter_day = winter_profile.groupby(winter_profile.index.hour).mean().reindex(range(24), fill_value=0)

        typical_days_data = {
            'summer': avg_summer_day.tolist(),
            'winter': avg_winter_day.tolist(),
            'hours': list(range(24))
        }

        # 7. Agrégation des KPIs par centrale pour affichage front-end
        plants_summary = {}
        for field in field_results:
            plant_id = field.get('plant_id', '1')
            if plant_id not in plants_summary:
                plants_summary[plant_id] = {'peak_power': 0, 'total_prod': 0, 'weighted_pr_sum': 0}
            
            plants_summary[plant_id]['peak_power'] += field['peak_power']
            plants_summary[plant_id]['total_prod'] += field['total_production_kwh']
            plants_summary[plant_id]['weighted_pr_sum'] += field['performance_ratio'] * field['peak_power']

        final_plants_summary = []
        for plant_id, data in sorted(plants_summary.items()):
            total_power = data['peak_power']
            total_prod = data['total_prod']
            final_plants_summary.append({
                'id': plant_id,
                'peak_power': total_power,
                'specific_yield': (total_prod / total_power) if total_power > 0 else 0,
                'performance_ratio': (data['weighted_pr_sum'] / total_power) if total_power > 0 else 0
            })


        return {
            'summary': {
                'lat': lat,
                'lon': lon,
                'peak_power_kw': total_peak,
                'total_production_kwh': total_net_prod,
                'max_production_kw': float(net_ac_series.max()),
                'hours_count': len(net_ac_series),
                'specific_production': global_specific,
                'performance_ratio': global_pr,
                'clipping_loss_kwh': total_clip,
                'irradiation_variability_kwh': site_variability_kwh,
                'irradiation_variability_percent': site_variability_percent,
                'bifacial_method': 'empirical_simplified' if any(f.get('pv_type') == 'bifacial' for f in fields) else 'none',
                'used_cache': used_cache,
                'meteo_source': meteo_source,
                'advanced_sim_enabled': advanced_sim_enabled,
                # Moyenne pondérée (irradiation du plan x puissance) des champs présents dans la scène.
                'near_shading_loss_percent': (round(near_loss_weighted_sum / near_loss_weight, 2)
                                              if near_loss_weight > 0 else None),
                'near_shading_objects': near_scene.object_count if near_scene is not None else 0,
                'near_shading_ignored_objects': near_scene.ignored_objects if near_scene is not None else [],
                'near_shading_warnings': near_warnings
            },
            'fields': field_results,
            'plants_summary': final_plants_summary, # NOUVEAU: KPIs par centrale
            'hourly': aggregated_hourly,
            'monthly_production_kwh': monthly_production_kwh,
            'production_by_plant': production_data_for_acc, # Ajout crucial pour l'ACC
            'typical_days': typical_days_data # Ajout pour le rapport PDF
        }
        
    except requests.exceptions.RequestException as e:
        # Message affiché à l'utilisateur : sans outil ni source de calcul (règle de confidentialité) ;
        # le détail reste dans la cause chaînée (traces serveur).
        raise Exception("Erreur de connexion au service de données d'ensoleillement. Réessayez dans quelques instants.") from e
    except Exception as e:
        raise Exception("Erreur lors de la simulation de la production.") from e