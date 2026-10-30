import io
import re
from datetime import date, datetime

import pandas as pd
from .rate_utils import clamp_rate_pct
from .calage_horaire import est_cale_utc1, heure_locale_vers_utc1
from app.services.irve_controle import conserver_energie

# Version du moteur de calcul d'autoconsommation, renvoyée avec chaque résultat (« version_moteur ») :
# même valeur que VERSION_MOTEUR_AUTOCONSO de main_autoconso.js, à changer ensemble à chaque
# correction du calcul (2026-10-13 : pas de temps des courbes, dates R63, production sous-horaire ;
# 2026-10-25 : énergie du fichier conservée avec la courbe IRVE ajoutée, totale reconstituée).
VERSION_MOTEUR_AUTOCONSO = '2026-10-25'

def parse_val(v):
    """Parsage robuste des valeurs récupérées depuis les fichiers Excel/CSV."""
    if pd.isna(v) or v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(',', '.').strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0

def read_to_df(file):
    """Lit un FileStorage de Flask en DataFrame Pandas selon l'extension."""
    filename = file.filename.lower()
    if filename.endswith('.xlsx'):
        return pd.read_excel(file, header=None, skiprows=4)
    else:
        try:
            return pd.read_csv(file, header=None, skiprows=4, sep=';')
        except UnicodeDecodeError:
            file.seek(0)
            return pd.read_csv(file, header=None, skiprows=4, sep=';', encoding='latin1')

def read_header_rows(file, nrows=4):
    """Lignes d'en-tête (avant les données) d'un fichier de courbe, pour y lire le marqueur UTC+1."""
    try:
        if file.filename.lower().endswith('.xlsx'):
            df = pd.read_excel(file, header=None, nrows=nrows)
        else:
            texte = _decoder_texte(file.read())
            df = pd.DataFrame([ligne.split(';') for ligne in texte.splitlines()[:nrows]])
        return df.fillna('').values.tolist()
    except Exception:
        return []
    finally:
        file.seek(0)


def _decoder_texte(contenu):
    try:
        return contenu.decode('utf-8-sig')
    except UnicodeDecodeError:
        return contenu.decode('latin1')


_DATE_DEBUT_LIGNE = re.compile(r'^\s*\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}')


def _est_ligne_de_donnees(ligne):
    """Première colonne = date (texte ou date Excel), deuxième = nombre."""
    if len(ligne) < 2:
        return False
    horodatage, valeur = ligne[0], ligne[1]
    if not (isinstance(horodatage, (datetime, date)) or _DATE_DEBUT_LIGNE.match(str(horodatage))):
        return False
    if isinstance(valeur, (int, float)) and not pd.isna(valeur):
        return True
    try:
        float(str(valeur).replace(',', '.').strip())
        return True
    except ValueError:
        return False


def _lignes_production(file):
    """Lignes de données d'un fichier de production, quel que soit le nombre de lignes d'en-tête.

    Un export horaire PVsyst (*_HourlyRes_*.CSV) compte 13 lignes d'en-tête et non 4 : lues comme
    des données, elles décalaient toute la production de 9 heures. La 1re ligne de données est la
    première dont la 1re colonne est une date et la 2e un nombre ; sans date (ancien format), on
    retombe sur les 4 lignes d'en-tête historiques.
    """
    if file.filename.lower().endswith('.xlsx'):
        lignes = pd.read_excel(file, header=None).values.tolist()
    else:
        lignes = [ligne.split(';') for ligne in _decoder_texte(file.read()).splitlines()]
    debut = next((i for i, ligne in enumerate(lignes) if _est_ligne_de_donnees(ligne)), None)
    return lignes[4:] if debut is None else lignes[debut:]


def extract_values_from_file(file, expected_length):
    values = [parse_val(ligne[1]) if len(ligne) > 1 else 0.0 for ligne in _lignes_production(file)]
    if len(values) < expected_length:
        raise ValueError(f"Le fichier PV contient {len(values)} valeurs ({expected_length} attendues).")
    return values[:expected_length]

_DATE_ISO = re.compile(r'^\s*\d{4}-\d{1,2}-\d{1,2}')


def _lire_dates(colonne_dates):
    """Dates d'une colonne de fichier, sans fuseau.

    ISO (AAAA-MM-JJ, courbes R63 Enedis) lu comme tel : `dayfirst=True` y inverserait jour et mois.
    Les R63 sont suffixées « +00:00 » mais écrites en heure murale (saut 02:00 -> 03:00 en mars,
    02:xx répété en octobre) : le suffixe est retiré sans conversion, les valeurs murales sont
    ensuite calées en UTC+1 comme toute autre date."""
    echantillon = colonne_dates.dropna().astype(str).head(50)
    if len(echantillon) and echantillon.str.match(_DATE_ISO).mean() > 0.5:
        dates = pd.to_datetime(colonne_dates.astype(str), errors='coerce', format='ISO8601', utc=False)
    else:
        dates = pd.to_datetime(colonne_dates, errors='coerce', dayfirst=True)
    if isinstance(dates.dtype, pd.DatetimeTZDtype):
        dates = dates.dt.tz_localize(None)
    return dates


def _pas_fichier_minutes(colonne_dates, pas_defaut):
    """Pas de temps d'un fichier (minutes), déduit de l'écart le plus fréquent entre deux dates.

    Détection seulement : tout pas qui divise l'heure est reconnu (5 min des courbes R63 Enedis
    compris), alors que le pas de simulation reste 10/15/30/60 min — une courbe plus fine est
    ramenée au pas de simulation par moyenne (cf. extract_consumption)."""
    try:
        dates = _lire_dates(colonne_dates)
        ecarts = dates.diff().dropna().dt.total_seconds() / 60.0
        if len(ecarts):
            pas = float(ecarts.round().mode().iloc[0])
            if 0 < pas <= 60 and 60 % pas == 0:
                return pas
    except Exception:
        pass
    # Dates illisibles : pas déduit du nombre de lignes d'une année (même tolérance que
    # detecterPasDeTempsCourbe côté navigateur : année bissextile, changements d'heure).
    n = len(colonne_dates)
    for pas in (5, 10, 15, 30, 60):
        if abs(n - 525600 / pas) <= 2 * 60 / pas * 25:
            return float(pas)
    return float(pas_defaut)


LIBELLES_POSITIONNELS = {1: 'Cons. existante', 2: 'Cons. IRVE', 3: 'Cons. Totale'}


def libelles_colonnes(lignes_entete):
    """
    Colonne -> courbe d'un fichier de consommation. Format historique (sans colonne PAC) : position
    B/C/D = existante / IRVE / totale. Format à 5 colonnes (export du module PAC) : colonnes repérées
    par leur intitulé dans les lignes d'en-tête — « PAC » ou « clim » -> 'Cons. PAC', « IRVE »,
    « total », « exist ». Sans intitulé PAC reconnu, le format historique s'applique (aucune
    régression sur les fichiers existants).
    """
    for ligne in lignes_entete or []:
        cellules = [str(c).strip().upper() if c is not None else '' for c in ligne]
        if not any('PAC' in c or 'CLIM' in c for c in cellules[1:]):
            continue
        libelles = {}
        for k, c in enumerate(cellules):
            if k == 0 or not c:
                continue
            if 'PAC' in c or 'CLIM' in c:
                libelles[k] = 'Cons. PAC'
            elif 'IRVE' in c:
                libelles[k] = 'Cons. IRVE'
            elif 'TOTAL' in c:
                libelles[k] = 'Cons. Totale'
            elif 'EXIST' in c:
                libelles[k] = 'Cons. existante'
        if 'Cons. PAC' in libelles.values():
            return libelles
    return dict(LIBELLES_POSITIONNELS)


def extract_consumption(file, expected_length, energies_brutes=None, reechelonner=True):
    """
    Courbes 'Cons. existante' / 'Cons. IRVE' / 'Cons. PAC' / 'Cons. Totale' d'un fichier, calées en UTC+1.
    `energies_brutes` (dict, optionnel) : rempli avec l'énergie (kWh) de chaque courbe telle
    qu'écrite dans le fichier, AVANT calage — c'est elle qui est comparée au bilan énergétique IRVE ;
    le calage conserve ensuite cette énergie (cf. irve_controle.py, règle 3), sauf `reechelonner=False`
    (énergies seulement relevées, courbes laissées telles que calées).
    """
    entete = read_header_rows(file)
    deja_cale_utc1 = est_cale_utc1(entete)
    libelles = libelles_colonnes(entete)
    df = read_to_df(file)
    
    datetime_col = df.columns[0]
    freq_map = {52560: '10min', 35040: '15min', 17520: '30min', 8760: '60min'}
    freq = freq_map.get(expected_length, '60min')
    pas_simulation = 525600 // expected_length
    pas_fichier = _pas_fichier_minutes(df[datetime_col], pas_simulation)
    
    # --- ORDRE DES OPERATIONS : Conversion numérique d'abord ---
    # Conversion préalable des valeurs string en numérique pour l'interpolation mathématique
    for col in df.columns[1:]:
        # Toute colonne non numérique (object, ou str depuis pandas 3 : `dtype == object` y est faux et
        # les virgules décimales d'un CSV n'étaient plus converties — courbe entière lue à 0).
        if not pd.api.types.is_numeric_dtype(df[col]):
            df[col] = df[col].astype(str).str.replace(',', '.', regex=False)
        df[col] = pd.to_numeric(df[col], errors='coerce')
    sommes_brutes = {libelles[k]: float(df.iloc[:, k].fillna(0).sum()) * pas_fichier / 60.0
                     for k in libelles if k < df.shape[1]}
        
    # --- NORMALISATION UTC+1 FIXE ET ROBUSTESSE ---
    # Fichiers générés par l'application (export IRVE, courbe Enedis nettoyée) : valeurs déjà calées
    # en UTC+1 fixe sur 365 jours (cf. calage_horaire.py) — les relocaliser en heure de Paris les
    # décalerait une seconde fois d'une heure pendant l'heure d'été. Lus ligne à ligne.
    if deja_cale_utc1:
        df = df.drop(columns=[datetime_col]).reset_index(drop=True).fillna(0)
        if pas_fichier != pas_simulation:
            # Courbe préparée à un autre pas que celui du calcul (ex. courbe Enedis préparée à 30 min,
            # autoconsommation à 60 min) : lue ligne à ligne, elle était tronquée à la moitié de
            # l'année. Grille UTC+1 continue de 365 jours : ramenée au pas de simulation par position,
            # moyenne par bloc si elle est plus fine, interpolation si elle est plus grossière.
            pas_f = int(pas_fichier)
            df = df.iloc[:525600 // pas_f]
            df.index = pd.date_range('2001-01-01', periods=len(df), freq=f'{pas_f}min')
            if pas_f < pas_simulation:
                df = df.resample(f'{pas_simulation}min').mean()
            grille = pd.date_range('2001-01-01', periods=expected_length, freq=f'{pas_simulation}min')
            df = df.reindex(grille).interpolate(method='linear', limit_direction='both').fillna(0).reset_index(drop=True)
        df = df.iloc[:expected_length].reset_index(drop=True)
        df.insert(0, datetime_col, range(len(df)))
    else:
        try:
            # Formats FR (31/12/2023) et ISO des R63 Enedis (« +00:00 » = heure murale), cf. _lire_dates.
            parsed_dates = _lire_dates(df[datetime_col])

            if parsed_dates.notna().mean() > 0.5:
                df[datetime_col] = parsed_dates
                df = df.dropna(subset=[datetime_col])
            
                # 1 & 2. Localiser en heure Europe/Paris (gestion auto été/hiver)
                df = df.set_index(datetime_col)
            
                # Calibrage de l'Index : Récupérer l'année dominante pour forcer le début au 1er Janvier 00:00
                target_year = df.index.year.value_counts().idxmax()
            
                try:
                    df.index = df.index.tz_localize('Europe/Paris', ambiguous='infer', nonexistent='shift_forward')
                except Exception:
                    # Fallback si l'inférence échoue (ex: données partielles)
                    df.index = df.index.tz_localize('Europe/Paris', ambiguous='NaT', nonexistent='NaT')
            
                # 3. Convertir en UTC+1 fixe
                df.index = df.index.tz_convert('UTC').tz_localize(None) + pd.Timedelta(hours=1)
            
                # Nettoyage des index invalides et des doublons générés par le changement d'heure d'automne
                df = df.loc[df.index.notnull()]
                df = df[~df.index.duplicated(keep='first')]
            
                # 4. Rééchantillonnage et Interpolation depuis le 1er Janvier 00:00
                start_date = pd.Timestamp(year=target_year, month=1, day=1, hour=0, minute=0)
                expected_index = pd.date_range(start=start_date, periods=expected_length, freq=freq)

                # Courbe plus fine que le pas de simulation (ex. R63 Enedis à 5 min) : puissance
                # moyenne de chaque bloc [HH:00, HH:00 + pas[, comme calcul_courbe_enedis._reechantillonner
                # (garder la seule valeur de HH:00 fausserait l'énergie et les pointes). Les pas
                # égaux ou plus longs sont, comme avant, recalés puis interpolés.
                if pas_fichier < pas_simulation:
                    df = df.resample(f'{pas_simulation}min').mean()
            
                df = df.reindex(expected_index)
                df = df.interpolate(method='linear').fillna(0)
            
                df = df.reset_index()
            else:
                raise ValueError("Dates illisibles ou manquantes dans la première colonne.")
            
        except Exception as e:
            # Lecture ligne à ligne : valable seulement si le fichier est au pas de simulation —
            # sinon la courbe serait tronquée ou étirée sur l'année.
            if pas_fichier != pas_simulation:
                raise ValueError(
                    f"Dates du fichier de consommation illisibles ({e}) : impossible de ramener sa courbe "
                    f"au pas de {pas_simulation} min depuis {pas_fichier:g} min. Vérifiez la 1re colonne "
                    f"(dates) ou importez un fichier au pas de {pas_simulation} min.") from e
            print(f"Avertissement : Échec de la normalisation UTC+1 ({e}). Génération d'un index par défaut.")
            target_year = pd.Timestamp.now().year
            start_date = pd.Timestamp(year=target_year, month=1, day=1, hour=0, minute=0)
            default_index = pd.date_range(start=start_date, periods=expected_length, freq=freq)
        
            df = df.drop(columns=[datetime_col], errors='ignore')
            # Garantir la bonne longueur et réindexer numériquement
            df = df.reindex(range(expected_length)).fillna(0)
            df.index = default_index
            df = df.reset_index()
    # -------------------------------------------------------------------

    if len(df) < expected_length:
        raise ValueError(f"Le fichier de consommation contient moins de {expected_length} lignes.")
    
    num_cols = df.shape[1]
    curves = []
    # Ordre canonique (existante, IRVE, PAC, totale) quelle que soit la place des colonnes.
    for label in ('Cons. existante', 'Cons. IRVE', 'Cons. PAC', 'Cons. Totale'):
        k = next((col for col, lib in libelles.items() if lib == label), None)
        if k is not None and k < num_cols:
            curves.append({'label': label, 'data': df.iloc[:, k].apply(parse_val).tolist()[:expected_length]})
    
    valid_curves = [c for c in curves if any(v > 0 for v in c['data'])]
    if energies_brutes is not None:
        pas_minutes = 525600 // expected_length
        for c in valid_curves:
            brute = sommes_brutes.get(c['label'])
            energies_brutes[c['label']] = brute
            calee = sum(c['data']) * pas_minutes / 60.0
            if reechelonner and brute and calee > 0:
                c['data'] = [v * brute / calee for v in c['data']]
    # Fichier à plusieurs usages sans colonne totale : sans elle, le « Global » du tableau ne reprenait
    # que la dernière courbe (process_data prend la totale, à défaut la dernière courbe).
    usages = [c for c in valid_curves if c['label'] in SOUS_COURBES]
    if len(usages) >= 2 and not any(c['label'] == 'Cons. Totale' for c in valid_curves):
        valid_curves.append({'label': 'Cons. Totale', 'data': [sum(v) for v in zip(*(c['data'] for c in usages))]})
    return valid_curves


def extract_consumption_from_json(curve_dict, expected_length):
    """
    Construit les courbes de consommation (même structure que extract_consumption()) directement à
    partir de la courbe IRVE envoyée en JSON par le front-end (cf. main_autoconso.js,
    formData 'irve_curve_json', alimentée par calcul_irve.js -> POST .../irve/save-curve) — pas de
    parsing Excel : les données sont déjà numériques et déjà alignées au bon pas de temps.
    """
    existing = curve_dict.get('existing') or []
    irve = curve_dict.get('irve') or []
    total = curve_dict.get('total') or []

    if len(existing) < expected_length or len(irve) < expected_length or len(total) < expected_length:
        raise ValueError(
            f"La courbe IRVE synchronisée contient moins de {expected_length} valeurs "
            f"(existante: {len(existing)}, IRVE: {len(irve)}, totale: {len(total)})."
        )

    pas_minutes = 525600 // expected_length
    annee = int(curve_dict.get('annee') or pd.Timestamp.now().year)
    curves = [
        {'label': 'Cons. existante', 'data': [parse_val(v) for v in existing[:expected_length]]},
        {'label': 'Cons. IRVE', 'data': [parse_val(v) for v in irve[:expected_length]]},
        {'label': 'Cons. Totale', 'data': [parse_val(v) for v in total[:expected_length]]},
    ]
    # La courbe IRVE est construite par heure de la journée (heure murale, plan de charge) : calée
    # en UTC+1 fixe comme les fichiers de consommation et la production (cf. calage_horaire.py).
    # Le calage est un déplacement horaire : l'énergie de chaque courbe est conservée.
    for curve in curves:
        curve['data'] = conserver_energie(curve['data'], heure_locale_vers_utc1(curve['data'], annee, pas_minutes))
    return curves


def irve_curve_vers_utc1(curve_dict, expected_length):
    """Composante 'irve' seule de la courbe IRVE JSON, calée en UTC+1 (combinaison avec un fichier)."""
    irve = [parse_val(v) for v in (curve_dict.get('irve') or [])[:expected_length]]
    annee = int(curve_dict.get('annee') or pd.Timestamp.now().year)
    return conserver_energie(irve, heure_locale_vers_utc1(irve, annee, 525600 // expected_length))


def courbe_murale_vers_utc1(valeurs, annee, expected_length):
    """Série en heure murale (grille IRVE de 365 jours) calée en UTC+1, énergie conservée."""
    serie = [parse_val(v) for v in (valeurs or [])[:expected_length]]
    return conserver_energie(serie, heure_locale_vers_utc1(serie, int(annee), 525600 // expected_length))


SOUS_COURBES = ('Cons. existante', 'Cons. IRVE', 'Cons. PAC')


def avec_courbe_pac(charge_curves, pac_data):
    """
    Ajoute 'Cons. PAC' aux courbes de consommation (déjà calées en UTC+1) et recalcule
    'Cons. Totale' comme somme des usages. Refuse un fichier qui contient déjà une colonne PAC.
    """
    if any(c['label'] == 'Cons. PAC' for c in charge_curves):
        raise ValueError("Le fichier de consommation contient déjà une colonne PAC : décochez « Ajouter la courbe PAC » ou importez un fichier sans cette colonne.")
    usages = [c for c in charge_curves if c['label'] in SOUS_COURBES]
    usages.append({'label': 'Cons. PAC', 'data': list(pac_data)})
    n = len(pac_data)
    total = [sum(c['data'][i] for c in usages) for i in range(n)]
    return usages + [{'label': 'Cons. Totale', 'data': total}]

# Règles d'affectation de la production PV entre usages ('none' = au prorata des consommations).
ORDRES_PRIORITE = {
    'existante': ['Cons. existante', 'Cons. IRVE', 'Cons. PAC'],
    'irve': ['Cons. IRVE', 'Cons. existante', 'Cons. PAC'],
    'pac': ['Cons. PAC', 'Cons. existante', 'Cons. IRVE'],
}


def ordre_priorite(priority_mode, priority_order=None):
    """Liste ordonnée des usages servis en premier, ou None pour le partage au prorata.

    'ordre' : ordre personnalisé `priority_order` (libellés de SOUS_COURBES, chacun une fois) ;
    les usages absents de la liste sont servis ensuite, dans l'ordre par défaut."""
    if priority_mode == 'ordre':
        ordre = [x for x in (priority_order or []) if x in SOUS_COURBES]
        if len(set(ordre)) != len(ordre) or not ordre:
            raise ValueError("Ordre de priorité invalide : chaque usage doit apparaître une seule fois.")
        return ordre + [x for x in SOUS_COURBES if x not in ordre]
    if priority_mode in ORDRES_PRIORITE:
        return list(ORDRES_PRIORITE[priority_mode])
    if priority_mode in (None, '', 'none'):
        return None
    raise ValueError(f"Règle d'affectation inconnue : {priority_mode}.")


def process_data(raw_pv_data, charge_curves, time_step_minutes, priority_mode='none', priority_order=None):
    data_length = len(raw_pv_data)
    
    # Validation de la longueur attendue de la courbe PV
    expected_length = int(365 * 24 * (60 / time_step_minutes))
    if data_length < expected_length:
        raise ValueError(f"Les donnees de production solaires contiennent {data_length} valeurs, mais {expected_length} sont attendues pour un pas de {time_step_minutes} min.")

    step_duration = time_step_minutes / 60.0

    inverter_total_consumption = 0.0
    pv_data = []
    for val in raw_pv_data:
        if val < 0:
            inverter_total_consumption += abs(val) * step_duration
            pv_data.append(0.0)
        else:
            pv_data.append(val)
            
    total_pv_production = sum(pv_data) * step_duration
    
    results = {'individual': [], 'global': {}, 'monthlyData': {}}
    
    for curve in charge_curves:
        results['individual'].append({
            'label': curve['label'], 'pvConsumed': 0.0,
            'totalConsumption': sum(curve['data']) * step_duration,
            'hourlyConsumption': curve['data'],
            'hourlyPVConsumed': [0.0] * data_length,
            'hourlySurplus': [0.0] * data_length, 'totalSurplus': 0.0
        })
        
    ordre = ordre_priorite(priority_mode, priority_order)
    usages = [r for r in results['individual'] if r['label'] in SOUS_COURBES]
    if ordre is not None:
        usages_ordonnes = sorted(usages, key=lambda r: ordre.index(r['label']))
    total_curve = next((r for r in results['individual'] if r['label'] == 'Cons. Totale'), None)
    repartir = len(usages) >= 2

    for i in range(data_length):
        pv = pv_data[i]

        for res in results['individual']:
            consumption = res['hourlyConsumption'][i]
            consumed = min(pv, consumption)
            hourly_surplus = max(0, pv - consumption)
            
            res['hourlyPVConsumed'][i] = consumed
            res['hourlySurplus'][i] = hourly_surplus
            res['pvConsumed'] += consumed * step_duration
            res['totalSurplus'] += hourly_surplus * step_duration
            
        if not repartir:
            continue
        if ordre is not None:
            # Priorité : chaque usage, dans l'ordre, prend ce que le PV restant peut couvrir.
            reste = pv
            for r in usages_ordonnes:
                consomme = min(reste, r['hourlyConsumption'][i])
                r['hourlyPVConsumed'][i] = consomme
                reste = max(0.0, reste - consomme)
                r['hourlySurplus'][i] = reste
        elif total_curve:
            # Sans priorité : PV consommé et excédent partagés au prorata des consommations.
            c_total = total_curve['hourlyConsumption'][i]
            if c_total > 0:
                pv_consumed_total, surplus_total = min(pv, c_total), max(0, pv - c_total)
                for r in usages:
                    part = r['hourlyConsumption'][i] / c_total
                    r['hourlyPVConsumed'][i] = pv_consumed_total * part
                    r['hourlySurplus'][i] = surplus_total * part
            else:
                for r in usages:
                    r['hourlyPVConsumed'][i], r['hourlySurplus'][i] = 0.0, 0.0

    if repartir:
        for res in usages:
            res['pvConsumed'] = sum(res['hourlyPVConsumed']) * step_duration
            res['totalSurplus'] = sum(res['hourlySurplus']) * step_duration

    if repartir and ordre is None and total_curve:
        total_curve['pvConsumed'] = sum(r['pvConsumed'] for r in usages)
        total_curve['totalSurplus'] = sum(r['totalSurplus'] for r in usages)
        for i in range(data_length):
            total_curve['hourlyPVConsumed'][i] = sum(r['hourlyPVConsumed'][i] for r in usages)
            total_curve['hourlySurplus'][i] = sum(r['hourlySurplus'][i] for r in usages)

    total_scenario = next((r for r in results['individual'] if r['label'] == 'Cons. Totale'), results['individual'][-1])
    total_pv_consumed, total_original_consumption = total_scenario['pvConsumed'], total_scenario['totalConsumption']
    
    for res in results['individual']:
        proportion = res['totalConsumption'] / total_original_consumption if total_original_consumption > 0 else 1.0
        res['attributedInverterConsumption'] = inverter_total_consumption * proportion
        res['totalConsumption'] += res['attributedInverterConsumption']
        res['autoconsumptionRate'] = (res['pvConsumed'] / total_pv_production * 100.0) if total_pv_production > 0 else 0.0
        res['autoproductionRate'] = (res['pvConsumed'] / res['totalConsumption'] * 100.0) if res['totalConsumption'] > 0 else 0.0

    results['global'] = {
        'autoconsumptionRate': (total_pv_consumed / total_pv_production * 100.0) if total_pv_production > 0 else 0.0,
        'autoproductionRate': (total_pv_consumed / total_scenario['totalConsumption'] * 100.0) if total_scenario['totalConsumption'] > 0 else 0.0,
        'surplus': total_pv_production - total_pv_consumed,
        'totalConsumption': total_scenario['totalConsumption'],
        'totalPVProduction': total_pv_production,
        'totalPVConsumed': total_pv_consumed,
        'inverterTotalConsumption': inverter_total_consumption,
        'hourlyPV': pv_data
    }
    
    months = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec']
    days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    
    results['monthlyData'] = {'labels': months, 'Global': {'pvProduction': [0.0]*12, 'totalConsumption': [0.0]*12, 'surplus': [0.0]*12}}
    for res in results['individual']:
        results['monthlyData'][res['label']] = {'pvProduction': [0.0]*12, 'pvConsumed': [0.0]*12, 'totalConsumption': [0.0]*12, 'surplus': [0.0]*12}
        
    hour_of_year = 0
    steps_per_hour = int(60 / time_step_minutes)
    
    for m in range(12):
        for d in range(days_in_month[m]):
            for h in range(24):
                for s in range(steps_per_hour):
                    if hour_of_year < data_length:
                        results['monthlyData']['Global']['pvProduction'][m] += pv_data[hour_of_year] * step_duration
                        results['monthlyData']['Global']['totalConsumption'][m] += total_scenario['hourlyConsumption'][hour_of_year] * step_duration
                        results['monthlyData']['Global']['surplus'][m] += total_scenario['hourlySurplus'][hour_of_year] * step_duration
                        
                        for res in results['individual']:
                            results['monthlyData'][res['label']]['pvProduction'][m] += pv_data[hour_of_year] * step_duration
                            results['monthlyData'][res['label']]['pvConsumed'][m] += res['hourlyPVConsumed'][hour_of_year] * step_duration
                            results['monthlyData'][res['label']]['totalConsumption'][m] += res['hourlyConsumption'][hour_of_year] * step_duration
                            results['monthlyData'][res['label']]['surplus'][m] += res['hourlySurplus'][hour_of_year] * step_duration
                        hour_of_year += 1
                        
    # Formatage standardise JSON pour le frontend et le rapport
    COLOR_PV_CONSOMMEE = 'rgba(255, 215, 0, 0.7)'
    COLOR_CONSO_AUTRES = 'rgba(251, 191, 36, 0.7)'
    COLOR_CONSO_TOTALE = 'rgba(239, 68, 68, 1)'
    COLOR_EXCEDENT = 'rgba(107, 114, 128, 0.7)'

    final_output = {
        'site_keys': ['Global'] + [r['label'] for r in results['individual']],
        'sites': {},
        'version_moteur': VERSION_MOTEUR_AUTOCONSO,
    }

    global_surplus_rate = (total_pv_production - total_pv_consumed) / total_pv_production * 100 if total_pv_production > 0 else 0
    # CORRECTIF (sécurité) : un taux d'autoconsommation/autoproduction >100% est physiquement
    # impossible et trahit une donnée d'entrée invalide — refuser plutôt qu'afficher/enregistrer.
    global_autocons_rate = clamp_rate_pct((total_pv_consumed / total_pv_production * 100) if total_pv_production > 0 else 0, "Taux d'autoconsommation global")
    global_autoprod_rate = clamp_rate_pct((total_pv_consumed / total_scenario['totalConsumption'] * 100) if total_scenario['totalConsumption'] > 0 else 0, "Taux d'autoproduction global")

    global_pv_prod = [v / 1000 for v in results['monthlyData']['Global']['pvProduction']]
    global_tot_cons = [v / 1000 for v in results['monthlyData']['Global']['totalConsumption']]
    global_surplus = [v / 1000 for v in results['monthlyData']['Global']['surplus']]
    global_pv_cons = [p - s for p, s in zip(global_pv_prod, global_surplus)]

    final_output['sites']['Global'] = {
        'label': 'Global',
        'summary': {
            'production_mwh': total_pv_production / 1000,
            'consumption_mwh': total_scenario['totalConsumption'] / 1000,
            # Part de la consommation nocturne des onduleurs comprise dans consumption_mwh.
            'conso_onduleur_mwh': total_scenario['attributedInverterConsumption'] / 1000,
            'pv_consumed_mwh': total_pv_consumed / 1000,
            'surplus_mwh': (total_pv_production - total_pv_consumed) / 1000,
            'autoconsumption_rate': global_autocons_rate,
            'autoproduction_rate': global_autoprod_rate
        },
        'monthly_data': {
            'pv_production': global_pv_prod,
            'total_consumption': global_tot_cons,
            'pv_consumed': global_pv_cons
        },
        'charts': {
            'pie_autoprod': {
                'title': 'Taux d\'Autoproduction Global',
                'labels': ['Part PV (Autoprod)', 'Part Réseau (Manquant)'],
                'data': [global_autoprod_rate, max(0, 100 - global_autoprod_rate)],
                'colors': [COLOR_PV_CONSOMMEE, COLOR_CONSO_TOTALE]
            },
            'pie_autocons': {
                'title': 'Taux d\'Autoconsommation Global',
                'labels': ['Excédent d\'énergie', 'PV Autoconsommée'],
                'data': [global_surplus_rate, global_autocons_rate],
                'colors': [COLOR_EXCEDENT, COLOR_PV_CONSOMMEE]
            },
            'monthly_bar': {
                'labels': months,
                'datasets': [
                    {'label': 'Production PV Totale', 'data': [v / 1000 for v in results['monthlyData']['Global']['pvProduction']], 'backgroundColor': COLOR_PV_CONSOMMEE, 'borderRadius': 6},
                    {'label': 'Consommation Totale', 'data': [v / 1000 for v in results['monthlyData']['Global']['totalConsumption']], 'backgroundColor': COLOR_CONSO_TOTALE, 'borderRadius': 6},
                    {'label': 'Excédent Global', 'data': [v / 1000 for v in results['monthlyData']['Global']['surplus']], 'backgroundColor': COLOR_EXCEDENT, 'borderRadius': 6}
                ]
            }
        }
    }

    for res in results['individual']:
        label = res['label']
        autoprod_rate = clamp_rate_pct((res['pvConsumed'] / res['totalConsumption'] * 100) if res['totalConsumption'] > 0 else 0, f"Taux d'autoproduction ({label})")
        site_surplus_rate = res['totalSurplus'] / total_pv_production * 100 if total_pv_production > 0 else 0
        site_autocons_rate = clamp_rate_pct((res['pvConsumed'] / total_pv_production * 100) if total_pv_production > 0 else 0, f"Taux d'autoconsommation ({label})")
        
        pie_autocons_data = []
        pie_autocons_labels = []
        pie_autocons_colors = []
        
        sum_rates = site_surplus_rate + site_autocons_rate
        if sum_rates < 100:
            pie_autocons_data.append(100 - sum_rates)
            pie_autocons_labels.append('Consommée par autres sites')
            pie_autocons_colors.append(COLOR_CONSO_AUTRES)
            
        pie_autocons_data.extend([site_surplus_rate, site_autocons_rate])
        pie_autocons_labels.extend(['Excédent d\'énergie', 'PV Autoconsommée'])
        pie_autocons_colors.extend([COLOR_EXCEDENT, COLOR_PV_CONSOMMEE])

        site_pv_prod = [v / 1000 for v in results['monthlyData'][label]['pvProduction']]
        site_tot_cons = [v / 1000 for v in results['monthlyData'][label]['totalConsumption']]
        site_pv_cons = [v / 1000 for v in results['monthlyData'][label]['pvConsumed']]

        final_output['sites'][label] = {
            'label': label,
            'summary': {
                'production_mwh': total_pv_production / 1000,
                'consumption_mwh': res['totalConsumption'] / 1000,
                'conso_onduleur_mwh': res['attributedInverterConsumption'] / 1000,
                'pv_consumed_mwh': res['pvConsumed'] / 1000,
                'surplus_mwh': res['totalSurplus'] / 1000,
                'autoconsumption_rate': site_autocons_rate,
                'autoproduction_rate': autoprod_rate
            },
            'monthly_data': {
                'pv_production': site_pv_prod,
                'total_consumption': site_tot_cons,
                'pv_consumed': site_pv_cons
            },
            'charts': {
                'pie_autoprod': {
                    'title': f'Taux d\'Autoproduction {label}',
                    'labels': ['Part PV (Autoprod)', 'Part Réseau (Manquant)'],
                    'data': [autoprod_rate, max(0, 100 - autoprod_rate)],
                    'colors': [COLOR_PV_CONSOMMEE, COLOR_CONSO_TOTALE]
                },
                'pie_autocons': {
                    'title': f'Taux d\'Autoconsommation {label}',
                    'labels': pie_autocons_labels,
                    'data': pie_autocons_data,
                    'colors': pie_autocons_colors
                },
                'monthly_bar': {
                    'labels': months,
                    'datasets': [
                        {'label': 'PV Consommée par le site', 'data': [v / 1000 for v in results['monthlyData'][label]['pvConsumed']], 'backgroundColor': COLOR_PV_CONSOMMEE, 'borderRadius': 6},
                        {'label': 'Consommation Totale du site', 'data': [v / 1000 for v in results['monthlyData'][label]['totalConsumption']], 'backgroundColor': COLOR_CONSO_TOTALE, 'borderRadius': 6},
                        {'label': 'Excédent non consommé (Site)', 'data': [v / 1000 for v in results['monthlyData'][label]['surplus']], 'backgroundColor': COLOR_EXCEDENT, 'borderRadius': 6}
                    ]
                }
            }
        }
        
    exist = next((r for r in results['individual'] if r['label'] == 'Cons. existante'), None)
    irve_node = next((r for r in results['individual'] if r['label'] == 'Cons. IRVE'), None)
    pac_node = next((r for r in results['individual'] if r['label'] == 'Cons. PAC'), None)
    tot_node = next((r for r in results['individual'] if r['label'] == 'Cons. Totale'), None)
    final_output['hourly_data'] = {
        'pv': pv_data,
        'cons_existante': exist['hourlyConsumption'] if exist else [0.0]*data_length,
        'cons_irve': irve_node['hourlyConsumption'] if irve_node else [0.0]*data_length,
        'cons_totale': tot_node['hourlyConsumption'] if tot_node else [0.0]*data_length,
        # Part PV consommée par les bornes, pas par pas (UTC+1, même grille que 'pv') : lue par la
        # section Rentabilité IRVE pour valoriser le PV plage tarifaire par plage. Arrondie (kW,
        # 4 décimales) pour limiter le poids du cache solar_sim_data au pas 10 min.
        'pv_consumed_irve': [round(v, 4) for v in irve_node['hourlyPVConsumed']] if irve_node else [0.0]*data_length
    }
    if pac_node:
        # Module PAC / climatiseur : consommation et part PV consommée, pas par pas (UTC+1).
        final_output['hourly_data']['cons_pac'] = pac_node['hourlyConsumption']
        final_output['hourly_data']['pv_consumed_pac'] = [round(v, 4) for v in pac_node['hourlyPVConsumed']]
        
    return final_output