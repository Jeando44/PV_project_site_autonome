"""
Validation serveur du configurateur « Petit champ solaire » et du dossier de plans.

Les bornes viennent de limites.json, le même fichier que celui injecté dans le template pour la
validation front (window.PETIT_CHAMP_LIMITES, cf. dossier_plans/validation_parametres.js) : une
borne modifiée l'est des deux côtés à la fois.

Rejet strict, jamais de correction silencieuse : chaque fonction renvoie (données nettoyées,
erreurs) et l'appelant refuse la requête dès qu'une erreur est présente.
"""
from __future__ import annotations

import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

LIMITES_PATH = Path(__file__).with_name("limites.json")
LIGNES_MAX_DEFAUT = 80

# Garde-fous de taille (un paramétrage fait quelques Ko ; au-delà, ce n'est pas une saisie).
MAX_CHAMPS = 200
MAX_BOUTONS_ACTIFS = 60
MAX_LONGUEUR_TEXTE = 200
ID_CHAMP = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
PV_ID = re.compile(r"^[A-Za-z0-9_-]{1,50}$")

_PV_LAYOUT = re.compile(
    r"^\s*(?:(?P<l1>\d+)\s*L\s*[x×]\s*(?P<c1>\d+)\s*C|(?P<c2>\d+)\s*C\s*[x×]\s*(?P<l2>\d+)\s*L|(?P<l3>\d+)\s*[x×]\s*(?P<c3>\d+))\s*$",
    re.IGNORECASE,
)
_NOMBRE = re.compile(r"^-?\d+(?:[.,]\d+)?$")


@lru_cache(maxsize=1)
def charger_limites() -> Dict[str, Any]:
    with LIMITES_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def valider_pv_id(pv_id: Any) -> bool:
    return isinstance(pv_id, str) and bool(PV_ID.match(pv_id))


def _nombre(valeur: Any) -> Optional[float]:
    if isinstance(valeur, bool):
        return None
    if isinstance(valeur, (int, float)):
        v = float(valeur)
    elif isinstance(valeur, str) and _NOMBRE.match(valeur.strip()):
        v = float(valeur.strip().replace(",", "."))
    else:
        return None
    return v if math.isfinite(v) else None


def analyser_pv_layout(texte: Any) -> Tuple[Optional[Tuple[int, int]], Optional[str]]:
    """« 2L x 6C », « 6C x 2L » ou « 2x6 » -> (lignes, colonnes), bornes de limites.json."""
    fmt = charger_limites()["formats"]["pvLayout"]
    if not isinstance(texte, str) or len(texte) > 40:
        return None, f"{fmt['libelle']} : format attendu « 2L x 6C »."
    m = _PV_LAYOUT.match(texte)
    if not m:
        return None, f"{fmt['libelle']} : format attendu « 2L x 6C » (L = lignes, C = colonnes)."
    lignes = int(m.group("l1") or m.group("l2") or m.group("l3"))
    colonnes = int(m.group("c1") or m.group("c2") or m.group("c3"))
    if not fmt["lignesMin"] <= lignes <= fmt["lignesMax"]:
        return None, f"{fmt['libelle']} : {lignes} ligne(s), attendu entre {fmt['lignesMin']} et {fmt['lignesMax']}."
    if not fmt["colonnesMin"] <= colonnes <= fmt["colonnesMax"]:
        return None, f"{fmt['libelle']} : {colonnes} colonne(s), attendu entre {fmt['colonnesMin']} et {fmt['colonnesMax']}."
    return (lignes, colonnes), None


def _verifier_borne(valeur: float, regle: Dict[str, Any]) -> Optional[str]:
    if regle.get("entier") and not float(valeur).is_integer():
        return f"{regle['libelle']} : un nombre entier est attendu."
    if valeur < regle["min"] or valeur > regle["max"]:
        return f"{regle['libelle']} : la valeur {valeur:g} doit être comprise entre {regle['min']:g} et {regle['max']:g}."
    return None


def valider_parametres(payload: Any) -> Tuple[Dict[str, Any], List[str]]:
    """
    Paramétrage du configurateur, au format de GeometrieStructureStorageManager.collectData() :
      {"fields": {id: {"type": "number"|"text"|"checkbox"|..., "value": ...}}, "activeButtons": [id, ...]}
    Renvoie (données nettoyées, erreurs). Un champ inconnu de limites.json est conservé s'il est
    anodin (texte court, case à cocher) : le formulaire évolue plus vite que les règles, et le
    rejeter bloquerait toute sauvegarde ; il reste borné en taille.
    """
    erreurs: List[str] = []
    limites = charger_limites()
    regles = {**limites["champs"], **{k: v for k, v in limites["champsCalcules"].items() if not k.startswith("_")}}

    if not isinstance(payload, dict):
        return {}, ["Paramètres invalides : objet attendu."]
    champs = payload.get("fields")
    boutons = payload.get("activeButtons", [])
    if not isinstance(champs, dict) or len(champs) > MAX_CHAMPS:
        return {}, ["Paramètres invalides : liste de champs absente ou trop longue."]
    if not isinstance(boutons, list) or len(boutons) > MAX_BOUTONS_ACTIFS:
        return {}, ["Paramètres invalides : liste de choix absente ou trop longue."]

    propres: Dict[str, Any] = {}
    valeurs: Dict[str, float] = {}
    for cle, info in champs.items():
        if not isinstance(cle, str) or not ID_CHAMP.match(cle):
            erreurs.append(f"Identifiant de champ invalide : {str(cle)[:40]!r}.")
            continue
        if not isinstance(info, dict) or "value" not in info:
            erreurs.append(f"{cle} : valeur absente.")
            continue
        type_ = info.get("type", "text")
        valeur = info.get("value")
        if type_ == "checkbox":
            if not isinstance(valeur, bool):
                erreurs.append(f"{cle} : case à cocher invalide.")
                continue
            propres[cle] = {"type": "checkbox", "value": valeur}
            continue
        if valeur is None or valeur == "":
            continue  # champ vide : non restauré (cf. storage manager), rien à valider
        if not isinstance(valeur, (str, int, float)) or isinstance(valeur, bool) or len(str(valeur)) > MAX_LONGUEUR_TEXTE:
            erreurs.append(f"{cle} : valeur invalide.")
            continue

        if cle in regles:
            nombre = _nombre(valeur)
            if nombre is None:
                erreurs.append(f"{regles[cle]['libelle']} : valeur numérique attendue.")
                continue
            erreur = _verifier_borne(nombre, regles[cle])
            if erreur:
                erreurs.append(erreur)
                continue
            valeurs[cle] = nombre
        elif cle == "pvLayout":
            _, erreur = analyser_pv_layout(valeur)
            if erreur:
                erreurs.append(erreur)
                continue
        elif type_ == "number" and _nombre(valeur) is None:
            erreurs.append(f"{cle} : valeur numérique attendue.")
            continue
        propres[cle] = {"type": str(type_)[:20], "value": valeur if not isinstance(valeur, str) else valeur.strip()}

    boutons_propres = []
    for b in boutons:
        if not isinstance(b, str) or not ID_CHAMP.match(b):
            erreurs.append("Choix de bouton invalide.")
            continue
        boutons_propres.append(b)

    choix = payload.get("activeChoices", [])
    choix_propres = []
    if not isinstance(choix, list) or len(choix) > MAX_BOUTONS_ACTIFS:
        erreurs.append("Liste des choix de groupes invalide.")
        choix = []
    for c in choix:
        ok = (
            isinstance(c, dict) and isinstance(c.get("group"), str) and ID_CHAMP.match(c["group"])
            and isinstance(c.get("index"), int) and not isinstance(c.get("index"), bool) and 0 <= c["index"] < 20
        )
        if not ok:
            erreurs.append("Choix de groupe invalide.")
            continue
        choix_propres.append({"group": c["group"], "index": c["index"]})

    erreurs.extend(_regles_croisees(valeurs, propres))
    propres_payload = {"fields": propres, "activeButtons": boutons_propres, "activeChoices": choix_propres}
    saved_at = payload.get("savedAt")
    if isinstance(saved_at, (int, float)) and not isinstance(saved_at, bool) and math.isfinite(saved_at):
        propres_payload["savedAt"] = int(saved_at)
    return propres_payload, erreurs


def _regles_croisees(valeurs: Dict[str, float], propres: Dict[str, Any]) -> List[str]:
    # NB : « Entraxes poteaux » (#postDistances) n'est volontairement PAS contrôlé : champ masqué et
    # résiduel du configurateur, dont les poteaux sont recalculés depuis #facadeEntraxe (cf.
    # petit_champ_solaire.js) — sa valeur peut être périmée sans que le plan soit faux.
    erreurs: List[str] = []
    passage = valeurs.get("passageHeight")
    renfort = valeurs.get("heightUnderBrace")
    if passage is not None and renfort is not None and renfort > 0 and renfort >= passage:
        erreurs.append("La hauteur sous renfort doit être inférieure à la hauteur libre de passage.")

    return erreurs


# Espaces fines que le navigateur remplace par une espace simple avant jsPDF (texteImprimable).
_ESPACES_FINES = {"\u202f", "\u2009", "\u2007", "\u200a", "\u2008"}


def caracteres_non_imprimables(texte: str) -> List[str]:
    """
    Caractères que les polices standard de jsPDF (codage WinAnsi = cp1252) ne savent pas imprimer :
    émojis, symboles (≥, →), alphabets non latins, et demi-paires UTF-16 isolées — ces dernières
    feraient en plus échouer l'encodage UTF-8 à l'enregistrement en base. Miroir de
    dossier_reglementation_validation.js (caracteresNonImprimables). 5 au plus, sans doublon.
    """
    trouves: List[str] = []
    for c in texte:
        if c in "\t\n\r" or c in _ESPACES_FINES:
            continue
        try:
            imprimable = ord(c) >= 32 and ord(c) != 127 and len(c.encode("cp1252")) == 1
        except UnicodeEncodeError:
            imprimable = False
        if not imprimable:
            libelle = f"U+{ord(c):04X}" if 0xD800 <= ord(c) <= 0xDFFF else c
            if libelle not in trouves:
                trouves.append(libelle)
            if len(trouves) >= 5:
                break
    return trouves


def valider_reglementation(payload: Any) -> Tuple[Dict[str, Any], List[str]]:
    """Page « Réglementation » du dossier : {inclure: bool, sections: {urbanisme|sdis|icpe: texte}}."""
    regles = charger_limites()["reglementation"]
    if payload is None:
        return {"inclure": False, "sections": {}}, []
    if not isinstance(payload, dict):
        return {}, ["Réglementation : objet attendu."]
    inclure = payload.get("inclure", False)
    if not isinstance(inclure, bool):
        return {}, ["Réglementation : l'option d'inclusion est invalide."]
    sections = payload.get("sections") or {}
    if not isinstance(sections, dict):
        return {}, ["Réglementation : sections invalides."]

    erreurs: List[str] = []
    propres: Dict[str, str] = {}
    for cle, regle in regles["sections"].items():
        texte = sections.get(cle, "")
        if not isinstance(texte, str):
            erreurs.append(f"{regle['libelle']} : texte attendu.")
            continue
        texte = texte.replace("\r\n", "\n").strip()
        if inclure and len(texte) < regle["min"]:
            erreurs.append(f"{regle['libelle']} : au moins {regle['min']} caractères (actuellement {len(texte)}).")
        if len(texte) > regle["max"]:
            erreurs.append(f"{regle['libelle']} : au plus {regle['max']} caractères (actuellement {len(texte)}).")
        if any(ord(c) < 32 and c not in "\n\t" for c in texte):
            erreurs.append(f"{regle['libelle']} : caractères de contrôle interdits.")
        lignes_max = regle.get("lignesMax", LIGNES_MAX_DEFAUT)
        if texte and texte.count("\n") + 1 > lignes_max:
            erreurs.append(f"{regle['libelle']} : au plus {lignes_max} lignes (actuellement {texte.count(chr(10)) + 1}).")
        hors_pdf = caracteres_non_imprimables(texte)
        if hors_pdf:
            erreurs.append(f"{regle['libelle']} : caractères impossibles à imprimer dans le PDF ({' '.join(hors_pdf)}).")
        propres[cle] = texte
    inconnues = set(sections) - set(regles["sections"])
    if inconnues:
        erreurs.append("Réglementation : section(s) inconnue(s).")
    return {"inclure": inclure, "sections": propres}, erreurs


def valider_indice(indice: Any) -> Optional[str]:
    motif = charger_limites()["dossier"]["indicePattern"]
    if not isinstance(indice, str) or not re.match(motif, indice):
        return "Indice de révision invalide (ex. « A », « B », « A1 »)."
    return None
