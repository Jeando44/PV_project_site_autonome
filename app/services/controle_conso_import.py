"""
Contrôle de cohérence : consommation lue à l'import (onglet « Import courbe de charge ») = consommation
du tableau récapitulatif d'autoconsommation (ACI).
==================================================================================================
Le navigateur lit lui-même le fichier importé (prodsolaire/energie_courbe_import.js) et affiche
l'énergie de chaque courbe sous le nom du fichier. Cette lecture est envoyée avec le calcul
(`conso_lue_kwh`) et comparée ici, courbe par courbe, à la consommation du tableau récapitulatif
(hors consommation nocturne des onduleurs, ajoutée au tableau au prorata). Tout écart bloque l'étude :
le résultat n'est ni renvoyé ni enregistré.

Courbes comparées : celles qui viennent du fichier. Une courbe IRVE ou PAC du projet ajoutée par-dessus
remplace la colonne correspondante du fichier et change la totale : seule la consommation existante
(et la colonne PAC conservée) est alors comparée.
"""
from app.services.irve_controle import ecart_admis, _format_kwh

TOTALE = 'Cons. Totale'


class IncoherenceConsoImport(ValueError):
    """Consommation du tableau récapitulatif différente de celle lue à l'import : étude bloquée."""


def _lecture_valide(conso_lue):
    if not isinstance(conso_lue, dict):
        return None
    energies = conso_lue.get('energies')
    if not isinstance(energies, dict):
        return None
    propres = {}
    for label, v in energies.items():
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            propres[str(label)] = float(v)
    return propres


def courbes_a_comparer(energies_lues, irve_ajoute, pac_ajoute):
    """{libellé du tableau -> énergie lue (kWh)} des courbes qui doivent sortir telles quelles du fichier."""
    usages = {k: v for k, v in energies_lues.items() if k != TOTALE and v > 0}
    if irve_ajoute:
        usages.pop('Cons. IRVE', None)
    if pac_ajoute:
        usages.pop('Cons. PAC', None)
    attendu = dict(usages)
    if not irve_ajoute and not pac_ajoute:
        totale = energies_lues.get(TOTALE)
        if totale is None or totale <= 0:
            totale = sum(v for k, v in energies_lues.items() if k != TOTALE and v > 0)
        if totale > 0:
            attendu['Global'] = totale
    return attendu


def consommation_tableau_kwh(results, label):
    """Consommation du tableau récapitulatif (kWh) d'une courbe, hors part des onduleurs."""
    resume = (((results or {}).get('sites') or {}).get(label) or {}).get('summary') or {}
    conso = float(resume.get('consumption_mwh') or 0.0)
    onduleur = float(resume.get('conso_onduleur_mwh') or 0.0)
    return (conso - onduleur) * 1000.0


def controler_conso_import(conso_lue, results, irve_ajoute=False, pac_ajoute=False):
    """
    Compare la lecture de l'import aux consommations du tableau récapitulatif. Renvoie le détail
    {conforme, courbes: [{label, lue_kwh, tableau_kwh}]} ; lève IncoherenceConsoImport en cas d'écart.
    `conso_lue` absent (ancien navigateur, pas de fichier) : None, rien n'est contrôlé.
    """
    energies = _lecture_valide(conso_lue)
    if energies is None:
        return None
    courbes, ecarts = [], []
    for label, lue in courbes_a_comparer(energies, irve_ajoute, pac_ajoute).items():
        tableau = consommation_tableau_kwh(results, label)
        courbes.append({'label': label, 'lue_kwh': lue, 'tableau_kwh': tableau})
        if not ecart_admis(tableau, lue):
            nom = 'Consommation totale' if label == 'Global' else label
            ecarts.append(f"{nom} : {_format_kwh(lue)} kWh lus à l'import, {_format_kwh(tableau)} kWh dans le tableau")
    if ecarts:
        raise IncoherenceConsoImport(
            "Étude bloquée : la consommation du tableau récapitulatif ne correspond pas à celle lue dans "
            "le fichier importé (" + " ; ".join(ecarts) + "). Réimportez la courbe de charge puis relancez le calcul.")
    return {'conforme': True, 'courbes': courbes}
