"""
Routes internes du configurateur « Petit champ solaire » et de son dossier de plans de conception.

  GET  /api/petit_champ/limites                               bornes (limites.json)
  POST /api/petit_champ/copie-locale/proprietaire             projet d'origine d'une copie locale ?
  GET  /api/petit_champ/<projet_id>/<pv_id>/parametres        paramétrage enregistré (ou null)
  PUT  /api/petit_champ/<projet_id>/<pv_id>/parametres        enregistre après validation stricte
  PUT  /api/petit_champ/<projet_id>/<pv_id>/dossier           réglages du dossier (réglementation...)
  GET  /api/petit_champ/<projet_id>/dossier/quota             état du quota de génération
  POST /api/petit_champ/<projet_id>/<pv_id>/dossier/generer   valide TOUT puis consomme 1 génération

Comme /api/dp, pas de @login_required local : le middleware SSO global (auth_middleware.py) bloque
toute requête sans session, g.user est donc garanti. Chaque route vérifie en plus que le projet
appartient à l'utilisateur connecté. La vérification d'origine (requêtes mutantes) s'applique déjà
à toute l'application.
"""
from __future__ import annotations

import json

from flask import Blueprint, g, jsonify, request

from app.extensions import db
from app.models.parametre_projet import ParametreProjet
from app.models.petit_champ_solaire import PetitChampParametres
from app.services.petit_champ_solaire import quota as quota_service
from app.services.petit_champ_solaire.validation import (
    charger_limites, valider_indice, valider_parametres, valider_pv_id, valider_reglementation,
)

petit_champ_bp = Blueprint("petit_champ", __name__, url_prefix="/api/petit_champ")

# Un paramétrage fait quelques Ko : au-delà, la requête n'est pas une saisie légitime.
MAX_CORPS_OCTETS = 256 * 1024
PIECES_CONNUES = {
    "garde", "situation", "presentation", "calepinage_carte", "calepinage_canevas", "vue_3d",
    "resultats", "reglementation", "coupe", "facade", "fondations",
    # Pièce « Devis » (dernière page) : proposée seulement aux projets Chiffrage (navigateur).
    "devis",
}


def _projet_de_l_utilisateur(projet_id):
    user = getattr(g, "user", None)
    if not user or not user.get("id"):
        return None
    if user.get("is_admin"):
        return ParametreProjet.query.filter_by(id=projet_id).first()
    return ParametreProjet.query.filter_by(id=projet_id, created_by=user["id"]).first()


def _refus(message, code=400, **extra):
    return jsonify({"error": message, **extra}), code


def _corps_json():
    if request.content_length and request.content_length > MAX_CORPS_OCTETS:
        return None, _refus("Requête trop volumineuse.", 413)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return None, _refus("Corps JSON attendu.")
    return payload, None


def _controles(projet_id, pv_id=None):
    if pv_id is not None and not valider_pv_id(pv_id):
        return None, _refus("Identifiant de champ PV invalide.")
    projet = _projet_de_l_utilisateur(projet_id)
    if not projet:
        return None, _refus("Projet introuvable ou vous n'y avez pas accès.", 403)
    return projet, None


def _ligne(projet_id, pv_id, creer=False):
    ligne = PetitChampParametres.query.filter_by(projet_id=projet_id, pv_id=pv_id).first()
    if ligne is None and creer:
        ligne = PetitChampParametres(projet_id=projet_id, pv_id=pv_id, parametres={"fields": {}, "activeButtons": []})
        db.session.add(ligne)
    return ligne


def _valider_dossier(dossier):
    """Réglages du dossier : indice, pièces choisies, page Réglementation."""
    if not isinstance(dossier, dict):
        return {}, ["Réglages du dossier invalides."]
    erreurs = []
    indice = dossier.get("indice", "A")
    erreur = valider_indice(indice)
    if erreur:
        erreurs.append(erreur)
    pieces = dossier.get("pieces", {})
    if not isinstance(pieces, dict) or any(k not in PIECES_CONNUES or not isinstance(v, bool) for k, v in pieces.items()):
        erreurs.append("Sélection des pièces invalide.")
        pieces = {}
    reglementation, erreurs_reg = valider_reglementation(dossier.get("reglementation"))
    erreurs.extend(erreurs_reg)
    textes = {}
    for cle, (libelle, maxi) in {"maitreOuvrage": ("Maître d'ouvrage", 120), "adresse": ("Adresse des travaux", 200)}.items():
        valeur = dossier.get(cle, "")
        if not isinstance(valeur, str) or len(valeur.strip()) > maxi or any(ord(c) < 32 for c in valeur):
            erreurs.append(f"{libelle} : texte de {maxi} caractères au plus, sur une ligne.")
            valeur = ""
        textes[cle] = valeur.strip()
    # Pièce « Devis » : détaillé (lignes) ou synthétique (postes). Absent = synthétique.
    devis_detaille = dossier.get("devisDetaille", False)
    if not isinstance(devis_detaille, bool):
        erreurs.append("Choix du devis (détaillé / synthétique) invalide.")
        devis_detaille = False
    return {"indice": indice, "pieces": pieces, "reglementation": reglementation,
            "devisDetaille": devis_detaille, **textes}, erreurs


@petit_champ_bp.route("/limites", methods=["GET"])
def route_limites():
    return jsonify(charger_limites())


def _empreinte_parametres(parametres):
    """Partie comparable d'un paramétrage (sans la date) : champs, boutons actifs, choix."""
    p = parametres if isinstance(parametres, dict) else {}
    return json.dumps({"fields": p.get("fields") or {}, "activeButtons": p.get("activeButtons") or [],
                       "activeChoices": p.get("activeChoices") or []}, sort_keys=True)


@petit_champ_bp.route("/copie-locale/proprietaire", methods=["POST"])
def route_proprietaire_copie_locale():
    """Copie locale d'origine inconnue (ancienne clé du navigateur, commune à tous les projets) :
    indique si elle est déjà enregistrée dans un projet de l'utilisateur (projet + champ), sans rien
    modifier. Seuls les projets de l'utilisateur connecté sont examinés (tous pour un administrateur)."""
    user = getattr(g, "user", None)
    if not user or not user.get("id"):
        return _refus("Connexion requise.", 401)
    payload, refus = _corps_json()
    if refus:
        return refus
    propres, erreurs = valider_parametres(payload.get("parametres"))
    if erreurs:
        return jsonify({"success": True, "projet_id": None, "pv_id": None, "valide": False})
    empreinte = _empreinte_parametres(propres)
    requete = PetitChampParametres.query.join(ParametreProjet, ParametreProjet.id == PetitChampParametres.projet_id)
    if not user.get("is_admin"):
        requete = requete.filter(ParametreProjet.created_by == user["id"])
    lignes = (requete
              .order_by(PetitChampParametres.updated_at.desc())
              .limit(2000).all())
    for ligne in lignes:
        if _empreinte_parametres(ligne.parametres) == empreinte:
            return jsonify({"success": True, "projet_id": ligne.projet_id, "pv_id": ligne.pv_id, "valide": True})
    return jsonify({"success": True, "projet_id": None, "pv_id": None, "valide": True})


@petit_champ_bp.route("/<int:projet_id>/<pv_id>/parametres", methods=["GET"])
def route_lire_parametres(projet_id, pv_id):
    _, refus = _controles(projet_id, pv_id)
    if refus:
        return refus
    ligne = _ligne(projet_id, pv_id)
    return jsonify({"success": True, "donnees": ligne.to_dict() if ligne else None})


@petit_champ_bp.route("/<int:projet_id>/<pv_id>/parametres", methods=["PUT"])
def route_enregistrer_parametres(projet_id, pv_id):
    _, refus = _controles(projet_id, pv_id)
    if refus:
        return refus
    payload, refus = _corps_json()
    if refus:
        return refus
    propres, erreurs = valider_parametres(payload.get("parametres"))
    if erreurs:
        return _refus("Paramètres refusés.", 422, erreurs=erreurs)
    ligne = _ligne(projet_id, pv_id, creer=True)
    ligne.parametres = propres
    db.session.commit()
    return jsonify({"success": True, "updated_at": ligne.updated_at.isoformat() if ligne.updated_at else None})


@petit_champ_bp.route("/<int:projet_id>/<pv_id>/dossier", methods=["PUT"])
def route_enregistrer_dossier(projet_id, pv_id):
    _, refus = _controles(projet_id, pv_id)
    if refus:
        return refus
    payload, refus = _corps_json()
    if refus:
        return refus
    propres, erreurs = _valider_dossier(payload.get("dossier"))
    if erreurs:
        return _refus("Réglages du dossier refusés.", 422, erreurs=erreurs)
    ligne = _ligne(projet_id, pv_id, creer=True)
    ligne.dossier = propres
    db.session.commit()
    return jsonify({"success": True})


@petit_champ_bp.route("/<int:projet_id>/dossier/quota", methods=["GET"])
def route_quota(projet_id):
    _, refus = _controles(projet_id)
    if refus:
        return refus
    return jsonify(quota_service.etat(g.user, projet_id))


@petit_champ_bp.route("/<int:projet_id>/<pv_id>/dossier/generer", methods=["POST"])
def route_generer(projet_id, pv_id):
    """
    Dernier contrôle avant génération : paramètres du configurateur ET réglages du dossier sont
    revalidés ici (le navigateur a pu être contourné), enregistrés, puis une génération est
    consommée. Rien n'est consommé si la validation échoue.
    """
    _, refus = _controles(projet_id, pv_id)
    if refus:
        return refus
    payload, refus = _corps_json()
    if refus:
        return refus

    parametres, erreurs = valider_parametres(payload.get("parametres"))
    dossier, erreurs_dossier = _valider_dossier(payload.get("dossier"))
    erreurs.extend(erreurs_dossier)
    if not any(dossier.get("pieces", {}).values()) and not dossier.get("reglementation", {}).get("inclure"):
        erreurs.append("Sélectionnez au moins une pièce.")
    if erreurs:
        return _refus("Dossier refusé : corrigez les saisies.", 422, erreurs=erreurs)

    autorise, message = quota_service.verifier_et_enregistrer(g.user, projet_id)
    if not autorise:
        return _refus(message, 403, quota_atteint=True)

    ligne = _ligne(projet_id, pv_id, creer=True)
    ligne.parametres = parametres
    ligne.dossier = dossier
    db.session.commit()
    return jsonify({"success": True, "quota": quota_service.etat(g.user, projet_id)})
