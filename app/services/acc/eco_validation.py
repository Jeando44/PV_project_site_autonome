"""
Validation serveur des paramètres économiques ACC (modales « Paramètres économiques » et « Analyse
financière avancée » de index_autoconso.html). Bornes : eco_bornes.json, source unique, également
injectée dans la page (window.ACC_ECO_BORNES) et appliquée côté navigateur par
prodsolaire/acc_eco_validation.js — même algorithme, cf. tests/prodsolaire/test_acc_eco_validation.py.

Un champ absent n'est pas une erreur (le calcul applique sa valeur par défaut) ; un champ présent
doit être un nombre fini dans ses bornes.
"""
import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

BORNES_PATH = Path(__file__).with_name("eco_bornes.json")
MAX_PARTICIPANTS = 100
# Même motif que _nombre() de acc_eco_validation.js (float() accepterait aussi "1_000", "inf"...).
_NOMBRE = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")


@lru_cache(maxsize=1)
def charger_bornes() -> Dict[str, Any]:
    with BORNES_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _nombre(valeur: Any) -> Optional[float]:
    if isinstance(valeur, bool) or valeur is None:
        return None
    if isinstance(valeur, (int, float)):
        v = float(valeur)
    elif isinstance(valeur, str):
        s = valeur.strip().replace(",", ".", 1)
        if not _NOMBRE.match(s):
            return None
        v = float(s)
    else:
        return None
    return v if math.isfinite(v) else None


def _fmt(v: float) -> str:
    return f"{v:g}"


def _verifier(valeur: Any, regle: Dict[str, Any], libelle: str, max_effectif: Optional[float]) -> Optional[str]:
    v = _nombre(valeur)
    if v is None:
        return f"[{libelle}] doit être un nombre (saisie : {valeur!r})."
    if regle.get("entier") and v != int(v):
        return f"[{libelle}] doit être un nombre entier (saisie : {_fmt(v)})."
    mini = regle.get("min")
    min_incl = regle.get("minIncl", True)
    max_incl = regle.get("maxIncl", True)
    trop_bas = mini is not None and (v < mini if min_incl else v <= mini)
    trop_haut = max_effectif is not None and (v > max_effectif if max_incl else v >= max_effectif)
    if trop_bas or trop_haut:
        bornes = []
        if mini is not None:
            bornes.append(f"{'>=' if min_incl else '>'} {_fmt(mini)}")
        if max_effectif is not None:
            bornes.append(f"{'<=' if max_incl else '<'} {_fmt(max_effectif)}")
        return f"[{libelle}] doit être {' et '.join(bornes)} (saisie : {_fmt(v)})."
    return None


def verifier_parametres_eco_acc(params: Any, puissance_wc: Optional[float] = None) -> List[str]:
    """Retourne la liste des messages d'erreur (vide si les paramètres sont valides)."""
    return [message for _, message in verifier_parametres_eco_acc_detail(params, puissance_wc)]


def verifier_parametres_eco_acc_detail(params: Any, puissance_wc: Optional[float] = None) -> List[Tuple[str, str]]:
    """Comme verifier_parametres_eco_acc, avec la clé fautive : [(clé, message), ...]."""
    if not isinstance(params, dict):
        return [("params", "Paramètres économiques ACC invalides.")]
    bornes = charger_bornes()
    erreurs: List[Tuple[str, str]] = []
    puissance = _nombre(puissance_wc)
    puissance = puissance if puissance is not None and puissance > 0 else None

    for cle, regle in bornes["champs"].items():
        if cle not in params:
            continue
        if "siChamp" in regle and params.get(regle["siChamp"]) != regle["siValeur"]:
            continue
        max_effectif = regle.get("max")
        if "maxChamp" in regle:
            max_effectif = _nombre(params.get(regle["maxChamp"]))
        elif "maxParWc" in regle:
            if puissance is None:
                max_effectif = None
            else:
                facteur = regle["maxParWc"]
                facteur = _nombre(params.get(facteur)) if isinstance(facteur, str) else _nombre(facteur)
                max_effectif = facteur * puissance if facteur is not None else None
        erreur = _verifier(params[cle], regle, regle["libelle"], max_effectif)
        if erreur:
            erreurs.append((cle, erreur))

    inflation = params.get("inflation_grid_price")
    if inflation is not None:
        regle = bornes["inflation_grid_price"]
        if not isinstance(inflation, dict):
            erreurs.append(("inflation_grid_price", f"[{regle['libelle']}] format invalide."))
        else:
            for profil, valeur in inflation.items():
                erreur = _verifier(valeur, regle, f"{regle['libelle']} - {profil} (%)", regle["max"])
                if erreur:
                    erreurs.append((f"inflation_grid_price.{profil}", erreur))

    participants = params.get("participants")
    if participants is not None:
        regle = bornes["prix_participant"]
        if not isinstance(participants, dict) or len(participants) > MAX_PARTICIPANTS:
            erreurs.append(("participants", "[Participants] format invalide."))
        else:
            for nom, prix in participants.items():
                if not isinstance(prix, dict):
                    erreurs.append((f"participants.{nom}", f"[Participant {nom}] format invalide."))
                    continue
                for cle, intitule in (("prix_achat", "Prix d'achat réseau"),
                                      ("prix_vente_interne", "Prix de vente interne ACC")):
                    if cle in prix:
                        erreur = _verifier(prix[cle], regle, f"{intitule} - {nom} (€/kWh)", regle["max"])
                        if erreur:
                            erreurs.append((f"participants.{nom}.{cle}", erreur))
    return erreurs
