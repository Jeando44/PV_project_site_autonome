"""
Validation serveur des réglages du dossier de plans « Ombrières » (miroir de
OmbriereDossierModal._erreursDossier côté navigateur). Bornes : limites.json, source unique.

Le dossier couvre TOUT le projet (toutes les ombrières) : pas de paramètres de configurateur à
valider ici, ils le sont déjà par chaque configurateur ; seuls les réglages du dossier (indice,
textes, pièces, champs exclus, page Réglementation) sont contrôlés.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

LIMITES_PATH = Path(__file__).with_name("limites.json")
LIGNES_MAX_DEFAUT = 80

PIECES_CONNUES = {
    "garde", "presentation", "aper", "reglementation", "situation", "calepinage_carte",
    # "vue_3d" (une vue 3D par ombrière) n'est plus proposée : gardée ici pour ne pas refuser des
    # réglages enregistrés avant son retrait (le navigateur l'écarte au chargement).
    "calepinage_canevas", "vue_3d_projet", "vue_3d", "geometrie", "coupe", "facade",
    # Pièce « Devis » (dernière page) : proposée seulement aux projets Chiffrage (navigateur).
    "devis",
}
# Même motif que le petit champ solaire (validation.py) : « PV1 », « PV12 »...
PV_ID = re.compile(r"^[A-Za-z0-9_.\-]{1,50}$")
TEXTES = {"maitreOuvrage": ("Maître d'ouvrage", 120), "adresse": ("Adresse des travaux", 200)}


def charger_limites() -> Dict[str, Any]:
    with LIMITES_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _controle(texte: str, multiligne: bool) -> bool:
    """True si le texte contient un caractère de contrôle interdit."""
    autorises = {"\n", "\t"} if multiligne else set()
    return any(ord(c) < 32 and c not in autorises for c in texte)


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
    """Page « Réglementation » : {inclure: bool, sections: {urbanisme|sdis|contraintes: texte}}."""
    regles = charger_limites()["reglementation"]["sections"]
    if payload is None:
        return {"inclure": False, "sections": {}}, []
    if not isinstance(payload, dict):
        return {}, ["Réglementation : objet attendu."]
    inclure = payload.get("inclure", False)
    if not isinstance(inclure, bool):
        return {}, ["Réglementation : l'option d'inclusion est invalide."]
    sections = payload.get("sections") or {}
    if not isinstance(sections, dict) or any(k not in regles for k in sections):
        return {}, ["Réglementation : sections invalides."]
    erreurs: List[str] = []
    propres: Dict[str, str] = {}
    for cle, regle in regles.items():
        texte = sections.get(cle, "")
        if not isinstance(texte, str):
            erreurs.append(f"{regle['libelle']} : texte attendu.")
            continue
        texte = texte.replace("\r\n", "\n").strip()
        if inclure and len(texte) < regle["min"]:
            erreurs.append(f"{regle['libelle']} : au moins {regle['min']} caractères (actuellement {len(texte)}).")
        if len(texte) > regle["max"]:
            erreurs.append(f"{regle['libelle']} : au plus {regle['max']} caractères (actuellement {len(texte)}).")
        if _controle(texte, multiligne=True):
            erreurs.append(f"{regle['libelle']} : caractères de contrôle interdits.")
        lignes_max = regle.get("lignesMax", LIGNES_MAX_DEFAUT)
        if texte and texte.count("\n") + 1 > lignes_max:
            erreurs.append(f"{regle['libelle']} : au plus {lignes_max} lignes (actuellement {texte.count(chr(10)) + 1}).")
        hors_pdf = caracteres_non_imprimables(texte)
        if hors_pdf:
            erreurs.append(f"{regle['libelle']} : caractères impossibles à imprimer dans le PDF ({' '.join(hors_pdf)}).")
        propres[cle] = texte
    return {"inclure": inclure, "sections": propres}, erreurs


def valider_dossier(dossier: Any) -> Tuple[Dict[str, Any], List[str]]:
    """Réglages complets du dossier -> (réglages nettoyés, erreurs)."""
    if not isinstance(dossier, dict):
        return {}, ["Réglages du dossier invalides."]
    limites = charger_limites()["dossier"]
    erreurs: List[str] = []

    indice = dossier.get("indice", "A")
    if not isinstance(indice, str) or not re.match(limites["indicePattern"], indice):
        erreurs.append("Indice de révision invalide (ex. « A », « B », « A1 »).")
        indice = "A"

    pieces = dossier.get("pieces", {})
    if not isinstance(pieces, dict) or any(k not in PIECES_CONNUES or not isinstance(v, bool) for k, v in pieces.items()):
        erreurs.append("Sélection des pièces invalide.")
        pieces = {}

    exclus = dossier.get("champsExclus", [])
    if (not isinstance(exclus, list) or len(exclus) > limites["champsMax"]
            or any(not isinstance(p, str) or not PV_ID.match(p) for p in exclus)):
        erreurs.append("Liste des champs PV exclus invalide.")
        exclus = []

    reglementation, erreurs_reg = valider_reglementation(dossier.get("reglementation"))
    erreurs.extend(erreurs_reg)

    textes = {}
    for cle, (libelle, maxi) in TEXTES.items():
        valeur = dossier.get(cle, "")
        if not isinstance(valeur, str) or len(valeur.strip()) > maxi or _controle(valeur, multiligne=False):
            erreurs.append(f"{libelle} : texte de {maxi} caractères au plus, sur une ligne.")
            valeur = ""
        textes[cle] = valeur.strip()

    # Pièce « Devis » : détaillé (lignes) ou synthétique (postes). Absent = synthétique.
    devis_detaille = dossier.get("devisDetaille", False)
    if not isinstance(devis_detaille, bool):
        erreurs.append("Choix du devis (détaillé / synthétique) invalide.")
        devis_detaille = False

    propres = {
        "indice": indice, "pieces": pieces, "champsExclus": sorted(set(exclus)),
        "reglementation": reglementation, "devisDetaille": devis_detaille, **textes,
    }
    return propres, erreurs


def valider_champs_generes(
    champs: Any,
    message_aucun: str = "Aucune ombrière à mettre dans le dossier : tracez un champ PV de type ombrière.",
) -> List[str]:
    """Champs PV effectivement mis dans le dossier (au moins un, identifiants valides)."""
    limites = charger_limites()["dossier"]
    if not isinstance(champs, list) or not champs:
        return [message_aucun]
    if len(champs) > limites["champsMax"] or any(not isinstance(p, str) or not PV_ID.match(p) for p in champs):
        return ["Liste des champs PV du dossier invalide."]
    return []
