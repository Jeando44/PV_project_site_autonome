"""
Contrôle de cohérence de la consommation PAC / climatiseur — même logique que l'IRVE (irve_controle.py).
======================================================================================================
Source de vérité : le bilan énergétique affiché par le module PAC (consommation annuelle simulée).

  1. À l'enregistrement (POST .../pac/save-curve), la courbe doit couvrir exactement 365 jours au pas
     déclaré, ne contenir que des puissances finies et positives, et sa somme (kW x pas) doit égaler
     le bilan transmis ; sinon elle est refusée. Idem pour la variante « ECS aux heures solaires ».
  2. Avant chaque calcul d'autoconsommation, la consommation PAC utilisée est comparée au bilan
     enregistré ; tout écart bloque le calcul.
  3. Le calage UTC+1 conserve l'énergie (cf. irve_controle.conserver_energie).
"""
import math

from app.services.irve_controle import (
    _format_kwh, ecart_admis, energie_kwh, horodatage, longueur_annuelle,
)


class IncoherencePac(ValueError):
    """Consommation PAC différente du bilan du module PAC : le calcul doit être bloqué."""


PAS_SUPPORTES = (10, 15, 30, 60)


def _verifier_serie(nom, serie, attendu):
    if len(serie) != attendu:
        raise ValueError(f"La courbe PAC '{nom}' contient {len(serie)} valeurs ({attendu} attendues pour 365 jours).")
    for v in serie:
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v < 0:
            raise ValueError(f"La courbe PAC '{nom}' contient une valeur invalide ({v!r}).")


def verifier_courbe_pac(courbe: dict) -> float:
    """Règle 1. `courbe` = PacCurveSchema.model_dump(). Renvoie l'énergie annuelle recalculée (kWh)."""
    pas = int(courbe['pas_temps_min'])
    if pas not in PAS_SUPPORTES:
        raise ValueError(f"Pas de temps non supporté : {pas} min.")
    attendu = longueur_annuelle(pas)
    _verifier_serie('pac', courbe['pac'], attendu)
    calcule = energie_kwh(courbe['pac'], pas)
    bilan = float(courbe['bilan_pac_kwh'])
    if not ecart_admis(calcule, bilan):
        raise ValueError(
            f"Courbe PAC refusée : sa somme ({_format_kwh(calcule)} kWh) diffère du bilan du module PAC "
            f"({_format_kwh(bilan)} kWh). Relancez le calcul dans le module PAC / Climatiseur.")
    variante = courbe.get('pac_ecs_solaire')
    if variante is not None:
        _verifier_serie('pac_ecs_solaire', variante, attendu)
        bilan_v = courbe.get('bilan_pac_ecs_solaire_kwh')
        if bilan_v is None or not ecart_admis(energie_kwh(variante, pas), float(bilan_v)):
            raise ValueError("Variante « ECS aux heures solaires » incohérente avec son bilan : relancez le calcul PAC.")
    return calcule


def controler_consommation_pac(calcule_kwh: float, bilan_kwh, source: str) -> dict:
    """Règle 2. Lève IncoherencePac si la consommation PAC utilisée diffère du bilan."""
    if bilan_kwh is None:
        raise IncoherencePac(
            f"Calcul bloqué : aucun bilan PAC enregistré pour ce projet, la consommation PAC {source} ne peut pas "
            "être contrôlée. Lancez le calcul dans le module PAC / Climatiseur.")
    bilan_kwh = float(bilan_kwh)
    if not ecart_admis(calcule_kwh, bilan_kwh):
        raise IncoherencePac(
            f"Calcul bloqué : la consommation PAC {source} ({_format_kwh(calcule_kwh)} kWh) diffère du bilan du "
            f"module PAC ({_format_kwh(bilan_kwh)} kWh). Relancez le calcul PAC, puis réexportez ou réimportez la courbe.")
    return {'bilan_kwh': bilan_kwh, 'calcul_kwh': calcule_kwh, 'ecart_kwh': calcule_kwh - bilan_kwh,
            'source': source, 'conforme': True}


__all__ = ['IncoherencePac', 'verifier_courbe_pac', 'controler_consommation_pac', 'horodatage']
