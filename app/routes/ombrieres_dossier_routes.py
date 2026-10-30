"""
Routes du dossier de plans de conception « Ombrières » (un dossier par projet, toutes les ombrières).

  GET  /api/ombrieres/dossier/limites                 bornes (limites.json)
  GET  /api/ombrieres/dossier/<projet_id>             réglages enregistrés (ou null)
  PUT  /api/ombrieres/dossier/<projet_id>             enregistre les réglages après validation
  GET  /api/ombrieres/dossier/<projet_id>/quota       état du quota de génération
  POST /api/ombrieres/dossier/<projet_id>/generer     revalide puis consomme 1 génération

Même cadre que /api/petit_champ : pas de @login_required local (le middleware SSO global garantit
g.user), vérification que le projet appartient à l'utilisateur, vérification d'origine globale.
Le navigateur appelle ces routes préfixées par /concevoir_mon_projet (cookie de session limité à
ce chemin, cf. app/middleware/prefix_alias.py).
"""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from app.extensions import db
from app.models.ombriere_dossier import OmbriereDossier
from app.models.parametre_projet import ParametreProjet
from app.services.ombrieres_dossier import quota as quota_service
from app.services.ombrieres_dossier.validation import charger_limites, valider_champs_generes, valider_dossier

ombrieres_dossier_bp = Blueprint("ombrieres_dossier", __name__, url_prefix="/api/ombrieres/dossier")

MAX_CORPS_OCTETS = 128 * 1024


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


def _refus_projet(projet_id):
    if not _projet_de_l_utilisateur(projet_id):
        return _refus("Projet introuvable ou vous n'y avez pas accès.", 403)
    return None


def _enregistrer(projet_id, dossier):
    ligne = db.session.get(OmbriereDossier, projet_id)
    if ligne is None:
        ligne = OmbriereDossier(projet_id=projet_id, dossier=dossier)
        db.session.add(ligne)
    else:
        ligne.dossier = dossier
    db.session.commit()


@ombrieres_dossier_bp.route("/limites", methods=["GET"])
def route_limites():
    return jsonify(charger_limites())


@ombrieres_dossier_bp.route("/<int:projet_id>", methods=["GET"])
def route_lire(projet_id):
    refus = _refus_projet(projet_id)
    if refus:
        return refus
    ligne = db.session.get(OmbriereDossier, projet_id)
    return jsonify({"success": True, "dossier": ligne.dossier if ligne else None})


@ombrieres_dossier_bp.route("/<int:projet_id>", methods=["PUT"])
def route_enregistrer(projet_id):
    refus = _refus_projet(projet_id)
    if refus:
        return refus
    payload, refus = _corps_json()
    if refus:
        return refus
    propres, erreurs = valider_dossier(payload.get("dossier"))
    if erreurs:
        return _refus("Réglages du dossier refusés.", 422, erreurs=erreurs)
    _enregistrer(projet_id, propres)
    return jsonify({"success": True})


@ombrieres_dossier_bp.route("/<int:projet_id>/quota", methods=["GET"])
def route_quota(projet_id):
    refus = _refus_projet(projet_id)
    if refus:
        return refus
    return jsonify(quota_service.etat(g.user, projet_id))


@ombrieres_dossier_bp.route("/<int:projet_id>/generer", methods=["POST"])
def route_generer(projet_id):
    """
    Dernier contrôle avant génération : réglages du dossier et liste des champs revalidés ici (le
    navigateur a pu être contourné), enregistrés, puis une génération est consommée. Rien n'est
    consommé si la validation échoue.
    """
    refus = _refus_projet(projet_id)
    if refus:
        return refus
    payload, refus = _corps_json()
    if refus:
        return refus
    dossier, erreurs = valider_dossier(payload.get("dossier"))
    erreurs.extend(valider_champs_generes(payload.get("champs")))
    if not any(dossier.get("pieces", {}).values()) and not dossier.get("reglementation", {}).get("inclure"):
        erreurs.append("Sélectionnez au moins une pièce.")
    if erreurs:
        return _refus("Dossier refusé : corrigez les saisies.", 422, erreurs=erreurs)

    autorise, message = quota_service.verifier_et_enregistrer(g.user, projet_id)
    if not autorise:
        return _refus(message, 403, quota_atteint=True)
    _enregistrer(projet_id, dossier)
    return jsonify({"success": True, "quota": quota_service.etat(g.user, projet_id)})
