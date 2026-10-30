"""
Nettoyage, standardisation et enrichissement des courbes de charge Enedis (R63)
récupérées via Switchgrid, en amont du calcul d'autoconsommation.

Entrée : un CourbeChargeNormalisee (app.services.switchgrid.mapping), déjà parsé
depuis le JSON brut Enedis par ce module-là — celui-ci ne fait aucun accès réseau
ni base de données (même contrat que calcul_autoconso.py / calcul_prodsolaire.py).

Règles appliquées :
  - standardisation à un nombre exact de valeurs (8760 / 17520 / 35040) par année civile
    à 365 jours (le 29 février est retiré) ;
  - reconstitution d'une "année type" par jonction de deux années civiles partielles qui
    se chevauchent, avec un lissage au point de jonction pour éviter un saut brutal ;
  - comblement des trous, avec une stratégie qui dépend de leur durée :
      * < 5h            : interpolation linéaire entre les bornes du trou ;
      * 5h à 14 jours    : remplacement jour par jour par un jour équivalent (même jour de
                           semaine, jours fériés français, respect de la séparation
                           semaine/week-end pour les segments professionnels) ;
      * > 14 jours       : priorité à l'historique N-1 (aligné sur les jours de semaine),
                           sinon clonage des 2 à 4 dernières semaines complètes disponibles.
        Un trou de cette taille est signalé via has_large_gap / large_gap_ranges.
  - agrégats pour l'affichage (mensuel, saisonnier, KPIs) et génération d'une courbe
    "moyenne des années" si plusieurs années sont disponibles.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from dateutil.easter import easter

from app.services.switchgrid.mapping import CourbeChargeNormalisee
from app.models.calcul_prodsolaire.calcul_acc import aggregate_to_monthly
from app.models.calcul_prodsolaire.calage_horaire import heure_locale_vers_utc1


# Convention assumée en l'absence d'une table de correspondance Enedis officielle dans ce
# projet : tout segment client autre que "C5" (résidentiel générique) est traité comme
# "professionnel" (Tertiaire/Industriel), pour lequel semaine et week-end ne doivent jamais
# être interchangés lors du comblement de trous.
SEGMENTS_PROFESSIONNELS = {"C1", "C2", "C3", "C4"}

# Saison météo par mois, utilisée pour le repli des jours fériés manquants et pour les
# courbes journalières saisonnières du front-end.
SAISON_METEO = {
    12: 'hiver', 1: 'hiver', 2: 'hiver',
    3: 'mi_saison', 4: 'mi_saison', 5: 'mi_saison',
    6: 'ete', 7: 'ete', 8: 'ete',
    9: 'mi_saison', 10: 'mi_saison', 11: 'mi_saison',
}


# --------------------------------------------------------------------------- #
# Construction de la série de base
# --------------------------------------------------------------------------- #

def _est_segment_professionnel(segment_client_code: Optional[str]) -> bool:
    return (segment_client_code or '').strip().upper() in SEGMENTS_PROFESSIONNELS


def _jours_feries_france(annee: int) -> set:
    """Jours fériés français fixes + mobiles (calculés depuis Pâques, cf. dateutil.easter)."""
    paques = easter(annee)
    fixes = [
        date(annee, 1, 1), date(annee, 5, 1), date(annee, 5, 8),
        date(annee, 7, 14), date(annee, 8, 15), date(annee, 11, 1),
        date(annee, 11, 11), date(annee, 12, 25),
    ]
    mobiles = [
        paques + timedelta(days=1),   # Lundi de Pâques
        paques + timedelta(days=39),  # Ascension
        paques + timedelta(days=50),  # Lundi de Pentecôte
    ]
    return set(fixes + mobiles)


def _pas_natif_minutes(serie: pd.Series, courbe: CourbeChargeNormalisee) -> int:
    """
    Déduit le pas de temps natif réel de l'écart médian entre points consécutifs de la
    série, plutôt que de la seule métadonnée déclarée par le dernier point lu (courbe
    .pas_de_temps_secondes) : Enedis peut mélanger des résolutions différentes dans
    l'historique d'un même PRM (changement de compteur, etc.), auquel cas se fier
    uniquement à la métadonnée du dernier point construit une grille de reconstruction
    mal calée — la plupart des points réels tombent alors hors grille (traités comme des
    trous), ce qui fausse fortement le total d'énergie calculé.
    """
    if len(serie) >= 2:
        deltas_min = serie.index.to_series().diff().dropna().dt.total_seconds() / 60.0
        deltas_min = deltas_min[deltas_min > 0]
        if not deltas_min.empty:
            pas = int(round(deltas_min.median()))
            if pas > 0:
                return pas
    return max(1, round(courbe.pas_de_temps_secondes / 60))


def detecter_pas_natif_minutes(courbe: CourbeChargeNormalisee) -> int:
    """
    Détecte le pas de temps natif (minutes) de la courbe brute, indépendamment de tout
    pas de temps cible — utilisé par la route pour proposer par défaut à l'utilisateur
    le pas auquel les données ont réellement été reçues (cf. preparer_courbes, qui refait
    cette détection en interne pour ses propres besoins de reconstruction de grille).
    """
    serie = _retirer_29_fevrier(_serie_depuis_courbe(courbe))
    return _pas_natif_minutes(serie, courbe)


def _serie_depuis_courbe(courbe: CourbeChargeNormalisee) -> pd.Series:
    """Série pandas (index datetime naïf, valeurs en W) à partir d'un CourbeChargeNormalisee."""
    if not courbe.points:
        return pd.Series(dtype=float)
    idx = pd.DatetimeIndex([p.horodatage for p in courbe.points])
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    serie = pd.Series([p.puissance_w for p in courbe.points], index=idx, dtype=float)
    serie = serie[~serie.index.duplicated(keep='first')].sort_index()
    return serie


def _retirer_29_fevrier(serie: pd.Series) -> pd.Series:
    """Partie 1.2 : base stricte de 365 jours, le 29 février est purement supprimé."""
    if serie.empty:
        return serie
    mask = (serie.index.month == 2) & (serie.index.day == 29)
    return serie[~mask]


JOURS_MIN_PAR_ANNEE = 7


def _detecter_annees_disponibles(serie: pd.Series) -> list:
    """
    Années proposées au choix de l'utilisateur. Une année n'est retenue que si elle contient au moins
    JOURS_MIN_PAR_ANNEE jours de mesures : les horodatages Enedis marquent la FIN du pas, donc une
    courbe arrêtée au 31/12 se termine par un point « 01/01 00:00 » de l'année suivante — sans ce
    seuil, cette année d'un seul point était proposée (entièrement reconstituée) et faussait la
    « Moyenne des années ».
    """
    if serie.empty:
        return []
    jours_par_annee = pd.Series(serie.index.normalize()).drop_duplicates().dt.year.value_counts()
    annees = sorted(int(a) for a, n in jours_par_annee.items() if n >= JOURS_MIN_PAR_ANNEE)
    return annees or sorted(set(serie.index.year.tolist()))


def _grille_annuelle(annee: int, pas_minutes: int) -> pd.DatetimeIndex:
    """Index cible d'une année civile à 365 jours pile, à la résolution demandée."""
    steps_per_hour = 60 // pas_minutes if pas_minutes <= 60 else 1
    periods = 365 * 24 * steps_per_hour
    return pd.date_range(start=pd.Timestamp(year=annee, month=1, day=1), periods=periods, freq=f"{pas_minutes}min")


# --------------------------------------------------------------------------- #
# Partie 1.3 : reconstitution d'année type (stitching) + lissage
# --------------------------------------------------------------------------- #

def _lisser_jonction(valeurs: pd.Series, seam_ts: pd.Timestamp, fenetre_pas: int = 8) -> pd.Series:
    """
    Atténue le saut de niveau au point de jonction : la correction est maximale (annule le
    saut) juste après le seam, puis décroît linéairement à zéro sur `fenetre_pas` points —
    la forme intra-journée réelle n'est pas aplatie, seul le niveau moyen est raccordé en douceur.
    """
    idx = valeurs.index
    pos = idx.searchsorted(seam_ts)
    if pos <= 0 or pos >= len(valeurs):
        return valeurs
    valeur_avant, valeur_apres = valeurs.iloc[pos - 1], valeurs.iloc[pos]
    saut = valeur_apres - valeur_avant
    if pd.isna(saut) or saut == 0:
        return valeurs
    n = min(fenetre_pas, len(valeurs) - pos)
    rampe = np.linspace(1.0, 0.0, n)
    valeurs = valeurs.copy()
    valeurs.iloc[pos:pos + n] = valeurs.iloc[pos:pos + n].values - saut * rampe
    return valeurs


def _construire_annee_civile(serie: pd.Series, annee_cible: int, pas_minutes: int):
    """
    Retourne (valeurs, stitched) : la série de l'année cible sur une grille de 365 jours
    pile. Si l'année cible n'est pas intégralement couverte, tente de combler les dates
    manquantes (typiquement en début d'année) avec les données de l'année suivante,
    ramenées sur le même calendrier (mêmes mois/jour) — Partie 1.3.
    """
    grille = _grille_annuelle(annee_cible, pas_minutes)
    donnees_annee = serie[serie.index.year == annee_cible]
    valeurs = donnees_annee.reindex(grille)

    stitched = False
    manquants = valeurs.isna()
    if manquants.any():
        donnees_annee_suivante = serie[serie.index.year == annee_cible + 1]
        if not donnees_annee_suivante.empty:
            index_translate = donnees_annee_suivante.index.map(lambda d: d.replace(year=annee_cible))
            candidat = pd.Series(donnees_annee_suivante.values, index=index_translate)
            candidat = candidat[~candidat.index.duplicated(keep='first')]
            apport = candidat.reindex(grille)
            comble = manquants & apport.notna()
            if comble.any():
                valeurs = valeurs.copy()
                valeurs[comble] = apport[comble]
                stitched = True
                seam_ts = grille[comble.values][0]
                valeurs = _lisser_jonction(valeurs, seam_ts)

    return valeurs, stitched


# --------------------------------------------------------------------------- #
# Partie 2 + 5 : détection et comblement des trous
# --------------------------------------------------------------------------- #

def _classifier_trous(valeurs: pd.Series) -> list:
    """Détecte les runs contigus de NaN. Retourne [{start_pos, end_pos, start, end}]."""
    mask = valeurs.isna().to_numpy()
    idx = valeurs.index
    trous = []
    i, n = 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            trous.append({'start_pos': i, 'end_pos': j - 1, 'start': idx[i], 'end': idx[j - 1]})
            i = j
        else:
            i += 1
    return trous


def _combler_trou_court(valeurs: pd.Series, trou: dict) -> None:
    """Partie 2, < 5h : interpolation linéaire entre les bornes du trou (en place)."""
    i, j = trou['start_pos'], trou['end_pos']
    if i == 0 or j >= len(valeurs) - 1:
        return  # trou en bord de série : pas de borne des deux côtés, laissé au filet de sécurité
    v_avant, v_apres = valeurs.iloc[i - 1], valeurs.iloc[j + 1]
    n = j - i + 1
    valeurs.iloc[i:j + 1] = np.linspace(v_avant, v_apres, n + 2)[1:-1]


def _copier_jour(valeurs: pd.Series, source_date: date, cible_date: date) -> bool:
    src_mask = valeurs.index.normalize() == pd.Timestamp(source_date)
    dst_mask = valeurs.index.normalize() == pd.Timestamp(cible_date)
    src_vals = valeurs[src_mask]
    if len(src_vals) == 0 or src_vals.isna().any() or len(src_vals) != int(dst_mask.sum()):
        return False
    valeurs[dst_mask] = src_vals.values
    return True


def _combler_jour_unique(valeurs: pd.Series, jour_manquant: date, segment_pro: bool,
                          jours_feries_par_an: dict) -> bool:
    """
    Partie 2, jour/semaine/férié manquant : cherche un jour de remplacement.
      - jour férié manquant  -> un autre jour férié, sinon un dimanche de la même saison météo ;
      - jour normal manquant -> même jour de semaine, recherche ±7j, ±14j, ... jusqu'à 8 semaines ;
      - pour un segment professionnel, jamais semaine <-> week-end.
    """
    annee = jour_manquant.year
    est_ferie = jour_manquant in jours_feries_par_an.get(annee, set())
    candidats = []

    if est_ferie:
        autres_feries = sorted(
            (f for feries in jours_feries_par_an.values() for f in feries if f != jour_manquant),
            key=lambda f: abs((f - jour_manquant).days),
        )
        candidats.extend(autres_feries)
        saison = SAISON_METEO[jour_manquant.month]
        dimanches = sorted(
            (d.date() for d in pd.unique(valeurs.index.normalize())
             if pd.Timestamp(d).weekday() == 6 and SAISON_METEO[pd.Timestamp(d).month] == saison),
            key=lambda d: abs((d - jour_manquant).days),
        )
        candidats.extend(dimanches)
    else:
        for semaines in range(1, 9):
            for signe in (1, -1):
                candidats.append(jour_manquant + timedelta(days=7 * semaines * signe))

    if segment_pro:
        est_weekend_cible = jour_manquant.weekday() >= 5
        candidats = [c for c in candidats if (c.weekday() >= 5) == est_weekend_cible]

    for candidat in candidats:
        if _copier_jour(valeurs, candidat, jour_manquant):
            return True
    return False


def _combler_periode_jour_par_jour(valeurs: pd.Series, trou: dict, segment_pro: bool,
                                    jours_feries_par_an: dict) -> None:
    """Applique _combler_jour_unique jour par jour sur toute la durée du trou (5h à 14 jours)."""
    debut = valeurs.index[trou['start_pos']].normalize()
    fin = valeurs.index[trou['end_pos']].normalize()
    for jour in pd.date_range(debut, fin, freq='D'):
        _combler_jour_unique(valeurs, jour.date(), segment_pro, jours_feries_par_an)


def _trouver_bloc_clonable(valeurs: pd.Series, avant_pos: int, steps_per_day: int, semaines_max: int = 4):
    """Cherche, juste avant `avant_pos`, le plus grand bloc de N semaines complètes (1 à N) sans trou."""
    steps_semaine = steps_per_day * 7
    for n_semaines in range(semaines_max, 0, -1):
        taille = steps_semaine * n_semaines
        debut = avant_pos - taille
        if debut < 0:
            continue
        segment = valeurs.iloc[debut:avant_pos]
        if not segment.isna().any():
            return segment.to_numpy()
    return None


def _combler_trou_grand(valeurs: pd.Series, trou: dict, pas_minutes: int, serie_brute: pd.Series,
                         annee_cible: int) -> bool:
    """
    Partie 5, trou > 14 jours. Priorité 1 : historique N-1, aligné sur les jours de semaine
    (décalage en semaines entières, pas en jours calendaires bruts). Priorité 2 (fallback) :
    clonage des 2 à 4 dernières semaines complètes disponibles, en respectant l'alignement
    jour-de-semaine (le clonage se fait par blocs de semaines entières).
    Retourne True si comblé via l'historique N-1 (Priorité 1), False si comblé par clonage.
    """
    i, j = trou['start_pos'], trou['end_pos']
    start_ts = valeurs.index[i]

    donnees_n1 = serie_brute[serie_brute.index.year == annee_cible - 1]
    if not donnees_n1.empty:
        un_an_avant = start_ts - pd.DateOffset(years=1)
        decalage_semaines = round((start_ts - un_an_avant).days / 7)
        offset = pd.DateOffset(weeks=decalage_semaines)
        source_index = valeurs.index[i:j + 1] - offset
        apport = donnees_n1.reindex(source_index)
        if apport.notna().mean() > 0.8:
            valeurs.iloc[i:j + 1] = apport.to_numpy()
            return True

    steps_per_day = 24 * 60 // pas_minutes
    bloc = _trouver_bloc_clonable(valeurs, i, steps_per_day)
    if bloc is not None:
        n = j - i + 1
        valeurs.iloc[i:j + 1] = np.resize(bloc, n)
    return False


# --------------------------------------------------------------------------- #
# Orchestration par année + agrégats d'affichage
# --------------------------------------------------------------------------- #

def _nettoyer_annee(serie_sans_bissextile: pd.Series, annee_cible: int, pas_minutes: int,
                     segment_client_code: Optional[str]):
    valeurs, stitched = _construire_annee_civile(serie_sans_bissextile, annee_cible, pas_minutes)
    segment_pro = _est_segment_professionnel(segment_client_code)
    jours_feries_par_an = {a: _jours_feries_france(a) for a in (annee_cible - 1, annee_cible, annee_cible + 1)}

    has_large_gap = False
    large_gap_ranges = []

    # Du plus court au plus long : maximise les chances de trouver, pour les trous longs,
    # des journées sources déjà réparées par les passes précédentes.
    trous = sorted(_classifier_trous(valeurs), key=lambda t: t['end_pos'] - t['start_pos'])
    for trou in trous:
        duree_h = (trou['end_pos'] - trou['start_pos'] + 1) * pas_minutes / 60.0
        if duree_h < 5:
            _combler_trou_court(valeurs, trou)
        elif duree_h <= 14 * 24:
            _combler_periode_jour_par_jour(valeurs, trou, segment_pro, jours_feries_par_an)
        else:
            large_gap_ranges.append({'start': trou['start'].isoformat(), 'end': trou['end'].isoformat()})
            has_large_gap = True
            _combler_trou_grand(valeurs, trou, pas_minutes, serie_sans_bissextile, annee_cible)

    # Filet de sécurité : cas résiduels sans aucune source valide trouvée.
    valeurs = valeurs.interpolate(method='linear', limit_direction='both').fillna(0.0)

    return valeurs, stitched, has_large_gap, large_gap_ranges


def _reechantillonner(valeurs: pd.Series, pas_natif: int, time_step_minutes: int) -> pd.Series:
    if pas_natif == time_step_minutes:
        return valeurs
    annee = valeurs.index[0].year
    cible = _grille_annuelle(annee, time_step_minutes)
    if time_step_minutes < pas_natif:
        # Sur-échantillonnage (ex: 30 -> 15 min) : même technique robuste que calcul_prodsolaire.py
        # (reindex sur l'union puis interpolate) — resample().interpolate() seul ne couvre pas la
        # toute fin de la série.
        fusion = valeurs.reindex(valeurs.index.union(cible)).interpolate(method='linear', limit_direction='both')
        return fusion.reindex(cible)
    # Sous-échantillonnage (ex: 15 -> 60 min) : moyenne par bloc, cohérente avec une puissance moyenne.
    return valeurs.resample(f"{time_step_minutes}min").mean().reindex(cible).interpolate(limit_direction='both')


def _kpis_et_agregats(valeurs_w: pd.Series, pas_minutes: int) -> dict:
    """Partie 3 : KPIs (pic, énergie totale), histogramme mensuel, courbes journalières saisonnières."""
    pas_h = pas_minutes / 60.0
    valeurs_kw = valeurs_w / 1000.0

    pic_kw = float(valeurs_kw.max()) if len(valeurs_kw) else 0.0
    energie_totale_kwh = float((valeurs_kw * pas_h).sum())
    monthly_kwh = aggregate_to_monthly(valeurs_kw.tolist(), pas_minutes)

    seasonal = {}
    for saison in ('hiver', 'mi_saison', 'ete'):
        mois_saison = [m for m, s in SAISON_METEO.items() if s == saison]
        sous_serie = valeurs_kw[valeurs_kw.index.month.isin(mois_saison)]
        if sous_serie.empty:
            seasonal[saison] = []
        else:
            moyenne_jour = sous_serie.groupby([sous_serie.index.hour, sous_serie.index.minute]).mean()
            seasonal[saison] = [round(float(v), 4) for v in moyenne_jour.tolist()]

    return {
        'kpis': {'pic_kw': round(pic_kw, 3), 'energie_totale_kwh': round(energie_totale_kwh, 1)},
        'monthly_kwh': [round(float(v), 1) for v in monthly_kwh],
        'seasonal_kw': seasonal,
    }


def preparer_courbes(courbe: CourbeChargeNormalisee, segment_client_code: Optional[str],
                      time_step_minutes: int) -> dict:
    """
    Point d'entrée principal. Retourne :
      { 'annees': { '2024': {...}, '2025': {...}, 'moyenne': {...} },
        'annees_disponibles': [...],
        'has_large_gap': bool, 'large_gap_ranges': [...] }
    Chaque entrée d'année contient : curve (liste de N valeurs en kW), kpis, monthly_kwh,
    seasonal_kw, stitched, has_large_gap, large_gap_ranges.
    """
    serie_brute = _serie_depuis_courbe(courbe)
    if serie_brute.empty:
        return {'annees': {}, 'annees_disponibles': [], 'has_large_gap': False, 'large_gap_ranges': []}

    serie_sans_bissextile = _retirer_29_fevrier(serie_brute)
    pas_natif = _pas_natif_minutes(serie_sans_bissextile, courbe)
    if getattr(courbe, 'horodatage_fin_de_pas', False):
        # R63 Enedis : horodatage de FIN de pas -> début de pas, convention de la production (PVGIS,
        # PVsyst) et du reste du calcul. Sans ce recalage, la consommation arrivait un pas trop tard.
        serie_debut = pd.Series(serie_brute.values, index=serie_brute.index - pd.Timedelta(minutes=pas_natif))
        serie_sans_bissextile = _retirer_29_fevrier(serie_debut)

    annees = _detecter_annees_disponibles(serie_sans_bissextile)
    resultats = {}
    has_large_gap_global = False
    large_gap_ranges_global = []

    for annee in annees:
        valeurs, stitched, has_large_gap, large_gap_ranges = _nettoyer_annee(
            serie_sans_bissextile, annee, pas_natif, segment_client_code
        )
        valeurs_cible = _reechantillonner(valeurs, pas_natif, time_step_minutes)
        agrege = _kpis_et_agregats(valeurs_cible, time_step_minutes)
        resultats[str(annee)] = {
            'curve': [round(float(v) / 1000.0, 4) for v in valeurs_cible.tolist()],  # kW, heure locale
            # Même courbe calée en UTC+1 fixe (sans heure d'été) : c'est elle qui alimente le fichier
            # de consommation de l'autoconsommation (cf. calage_horaire.py, switchgrid_data.js).
            'curve_utc1': [round(v / 1000.0, 4) for v in heure_locale_vers_utc1(valeurs_cible.to_numpy(), annee, time_step_minutes)],
            'stitched': stitched,
            'has_large_gap': has_large_gap,
            'large_gap_ranges': large_gap_ranges,
            **agrege,
        }
        if has_large_gap:
            has_large_gap_global = True
            large_gap_ranges_global.extend(large_gap_ranges)

    if len(resultats) > 1:
        courbes = [r['curve'] for r in resultats.values()]
        moyenne_curve = np.mean(courbes, axis=0)
        grille_ref = _grille_annuelle(annees[0], time_step_minutes)
        moyenne_serie_w = pd.Series(moyenne_curve * 1000.0, index=grille_ref)  # W, pour _kpis_et_agregats
        agrege_moy = _kpis_et_agregats(moyenne_serie_w, time_step_minutes)
        moyenne_utc1 = np.mean([r['curve_utc1'] for r in resultats.values()], axis=0)
        resultats['moyenne'] = {
            'curve': [round(float(v), 4) for v in moyenne_curve.tolist()],
            'curve_utc1': [round(float(v), 4) for v in moyenne_utc1.tolist()],
            'stitched': False, 'has_large_gap': False, 'large_gap_ranges': [],
            **agrege_moy,
        }

    return {
        'annees': resultats,
        'annees_disponibles': list(resultats.keys()),
        'has_large_gap': has_large_gap_global,
        'large_gap_ranges': large_gap_ranges_global,
    }
