"""
Calage horaire des courbes de production et de consommation pour l'autoconsommation (ACI/ACC).

Référence commune : UTC+1 FIXE (heure d'hiver toute l'année, sans changement d'heure), début de
pas, grille de 365 jours démarrant le 1er janvier 00:00 — c'est la convention des fichiers horaires
PVsyst ("heure légale" sans heure d'été). Toute courbe est ramenée sur cette grille avant que
process_data()/process_acc_data() ne les comparent position par position :

  - production PVsyst importée : déjà en UTC+1, lue ligne à ligne ;
  - production PVGIS (calculate_pv_data) : indexée en UTC -> décalée d'une heure (utc_vers_utc1) ;
  - consommation en heure locale "murale" (profil IRVE par heure de la journée, courbe Enedis) :
    heure d'été retirée du 29/03 au 25/10 (heure_locale_vers_utc1) ;
  - fichiers de consommation générés par l'application : déjà calés, ils portent le marqueur
    MARQUEUR_UTC1 dans leurs lignes d'en-tête (cf. extract_consumption, est_cale_utc1).
"""
import numpy as np
import pandas as pd

FUSEAU_LOCAL = 'Europe/Paris'
MARQUEUR_UTC1 = 'UTC+1'
LIBELLE_FUSEAU_UTC1 = "UTC+1 fixe (heure d'hiver, sans changement d'heure)"


def _pas_par_heure(pas_minutes: int) -> int:
    return max(1, 60 // int(pas_minutes))


def utc_vers_utc1(valeurs, pas_minutes: int) -> list:
    """Série indexée en UTC (PVGIS) -> UTC+1 fixe : valeur UTC+1 à t = valeur UTC à t - 1 h.

    Le dernier pas de l'année (31/12 23:00 UTC, nuit) revient en tête : la grille reste annuelle.
    """
    return np.roll(np.asarray(valeurs, dtype=float), _pas_par_heure(pas_minutes)).tolist()


def heure_locale_vers_utc1(valeurs, annee: int, pas_minutes: int) -> list:
    """Série en heure locale murale (position i = 01/01 00:00 locale + i pas) -> UTC+1 fixe.

    Pendant l'heure d'été, l'instant UTC+1 t correspond à l'heure murale t + 1 h : on y lit la valeur
    murale suivante. Le créneau inexistant de mars (02:00) disparaît, celui d'octobre (02:00 vécu
    deux fois) est répété — comme dans la réalité.
    """
    valeurs = np.asarray(valeurs, dtype=float)
    n = len(valeurs)
    if n == 0:
        return []
    pas = pd.Timedelta(minutes=int(pas_minutes))
    grille = pd.date_range(pd.Timestamp(year=int(annee), month=1, day=1), periods=n, freq=pas)
    murale = (grille - pd.Timedelta(hours=1)).tz_localize('UTC').tz_convert(FUSEAU_LOCAL).tz_localize(None)
    positions = np.clip(((murale - grille[0]) // pas).to_numpy(dtype=np.int64), 0, n - 1)
    return valeurs[positions].tolist()


def est_cale_utc1(lignes_entete) -> bool:
    """True si une cellule des lignes d'en-tête porte le marqueur des fichiers déjà calés en UTC+1."""
    for ligne in lignes_entete:
        for cellule in ligne:
            if isinstance(cellule, str) and MARQUEUR_UTC1 in cellule.upper():
                return True
    return False
