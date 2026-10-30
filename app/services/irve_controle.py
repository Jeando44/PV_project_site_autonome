"""
Contrôle de cohérence de la consommation IRVE (source de vérité : le bilan énergétique IRVE).
=============================================================================================
La consommation annuelle des bornes affichée par le bilan énergétique du module IRVE doit être
IDENTIQUE à celle utilisée par l'analyse d'autoconsommation (tableau récapitulatif), quelle que soit
la source de la courbe :
  - courbe IRVE enregistrée en base (POST .../irve/save-curve, lue par le serveur au calcul — elle ne
    transite plus par le navigateur) ;
  - colonne « Cons. IRVE » d'un fichier de consommation importé (Excel/CSV).

Règles :
  1. À l'enregistrement, la courbe doit couvrir exactement 365 jours et sa somme (kW x pas) doit
     égaler le total du bilan transmis (`bilan_irve_kwh`) ; sinon elle est refusée.
  2. Avant chaque calcul d'autoconsommation, la somme de la consommation IRVE utilisée est comparée
     au bilan enregistré ; tout écart bloque le calcul.
  3. Le calage UTC+1 (heure d'été) déplace les valeurs dans le temps : il ne doit ni créer ni
     détruire d'énergie (créneau de mars supprimé, créneau d'octobre doublé) — l'énergie est
     conservée par une remise à l'échelle de chaque courbe.
"""
import math
from datetime import datetime, timezone

JOURS_PAR_AN = 365
# Écart admis : arrondis flottants seulement (valeurs exportées en pleine précision).
TOLERANCE_ABSOLUE_KWH = 0.1
TOLERANCE_RELATIVE = 1e-6


class IncoherenceIrve(ValueError):
    """Consommation IRVE différente du bilan énergétique : le calcul doit être bloqué."""


def tolerance_kwh(reference_kwh: float) -> float:
    return max(TOLERANCE_ABSOLUE_KWH, abs(reference_kwh) * TOLERANCE_RELATIVE)


def energie_kwh(valeurs, pas_minutes: float) -> float:
    """Énergie (kWh) d'une série de puissances (kW) au pas donné."""
    return float(sum(valeurs)) * pas_minutes / 60.0


def longueur_annuelle(pas_minutes: int) -> int:
    return JOURS_PAR_AN * 24 * 60 // int(pas_minutes)


def _format_kwh(v: float) -> str:
    return f"{v:,.2f}".replace(',', ' ').replace('.', ',')


def ecart_admis(calcule_kwh: float, bilan_kwh: float) -> bool:
    return abs(calcule_kwh - bilan_kwh) <= tolerance_kwh(bilan_kwh)


def verifier_courbe_a_enregistrer(curve: dict) -> float:
    """
    Règle 1. `curve` = IrveCurveSchema.model_dump(). Renvoie l'énergie IRVE recalculée (kWh).
    Lève ValueError si la courbe n'est pas enregistrable.
    """
    pas = int(curve['pas_temps_min'])
    if pas not in (10, 15, 30, 60):
        raise ValueError(f"Pas de temps non supporté : {pas} min.")
    irve, existing, total = curve.get('irve') or [], curve.get('existing') or [], curve.get('total') or []
    if not irve:
        # Courbe vide : invalidation volontaire (plus aucune borne).
        return 0.0
    attendu = longueur_annuelle(pas)
    for nom, serie in (('irve', irve), ('existing', existing), ('total', total)):
        if len(serie) != attendu:
            raise ValueError(f"La courbe '{nom}' contient {len(serie)} valeurs ({attendu} attendues pour 365 jours au pas de {pas} min).")
        for v in serie:
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v < 0:
                raise ValueError(f"La courbe '{nom}' contient une valeur invalide ({v!r}).")
    for i, (e, r, t) in enumerate(zip(existing, irve, total)):
        if abs((e + r) - t) > 1e-6 * max(1.0, abs(t)):
            raise ValueError(f"Courbe totale incohérente au pas {i} (existant + IRVE ≠ total).")
    bilan = curve.get('bilan_irve_kwh')
    if bilan is None:
        raise ValueError("Total du bilan énergétique IRVE manquant : recalculez la consommation dans le module IRVE.")
    calcule = energie_kwh(irve, pas)
    if not ecart_admis(calcule, float(bilan)):
        raise ValueError(
            f"Courbe IRVE refusée : sa somme ({_format_kwh(calcule)} kWh) diffère du bilan énergétique "
            f"({_format_kwh(float(bilan))} kWh). Recalculez la consommation dans le module IRVE."
        )
    return calcule


def horodatage() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def conserver_energie(avant: list, apres: list) -> list:
    """Règle 3 : remet `apres` (série calée) à l'énergie de `avant` (même pas de temps)."""
    s_avant, s_apres = float(sum(avant)), float(sum(apres))
    if s_apres <= 0 or s_avant <= 0:
        return list(apres)
    facteur = s_avant / s_apres
    return [v * facteur for v in apres]


def controler_consommation(calcule_kwh: float, bilan_kwh, source: str) -> dict:
    """
    Règle 2. Lève IncoherenceIrve si la consommation IRVE utilisée diffère du bilan.
    `source` : libellé de l'origine de la courbe, pour le message.
    """
    if bilan_kwh is None:
        raise IncoherenceIrve(
            "Calcul bloqué : aucun bilan énergétique IRVE enregistré pour ce projet, la consommation "
            f"IRVE {source} ne peut pas être contrôlée. Lancez « calculer la consommation » dans le module IRVE."
        )
    bilan_kwh = float(bilan_kwh)
    if not ecart_admis(calcule_kwh, bilan_kwh):
        raise IncoherenceIrve(
            f"Calcul bloqué : la consommation IRVE {source} ({_format_kwh(calcule_kwh)} kWh) diffère du "
            f"bilan énergétique IRVE ({_format_kwh(bilan_kwh)} kWh). Recalculez la consommation dans le "
            "module IRVE, puis réexportez ou réimportez la courbe."
        )
    return {
        'bilan_kwh': bilan_kwh,
        'calcul_kwh': calcule_kwh,
        'ecart_kwh': calcule_kwh - bilan_kwh,
        'source': source,
        'conforme': True,
    }
