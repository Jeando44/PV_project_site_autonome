"""
Routes des dossiers de plans « Toitures » et « Mixte » (parcours Chiffrage), un dossier par projet
et par type (<type_dossier> ∈ toitures | mixte).

  GET  /api/dossier_plans/<type>/<projet_id>             réglages enregistrés (ou null)
  PUT  /api/dossier_plans/<type>/<projet_id>             enregistre les réglages après validation
  GET  /api/dossier_plans/<type>/<projet_id>/quota       état du quota de ce type de dossier
  POST /api/dossier_plans/<type>/<projet_id>/generer     revalide puis consomme 1 génération

Les bornes sont celles du dossier des ombrières (GET /api/ombrieres/dossier/limites) : même modal,
mêmes réglages, même validation. Seul le quota est séparé (un compteur par type de dossier).
Même cadre de sécurité que ombrieres_dossier_routes.py (middleware SSO, contrôle du propriétaire du
projet, vérification d'origine globale ; appels préfixés par /concevoir_mon_projet).
"""
from __future__ import annotations

from flask import Blueprint, g, jsonify

from app.extensions import db
from app.models.dossier_plans import DossierPlans
from app.routes.ombrieres_dossier_routes import _corps_json, _refus, _refus_projet
from app.services.dossier_plans import TYPES_DOSSIER
from app.services.dossier_plans import quota as quota_service
from app.services.ombrieres_dossier.validation import valider_champs_generes, valider_dossier

dossier_plans_bp = Blueprint("dossier_plans", __name__, url_prefix="/api/dossier_plans")

AUCUN_CHAMP = "Aucun champ PV à mettre dans le dossier : tracez au moins un champ PV de ce type."


def _refus_requete(type_dossier, projet_id):
    if type_dossier not in TYPES_DOSSIER:
        return _refus("Type de dossier inconnu.", 404)
    return _refus_projet(projet_id)


def _enregistrer(projet_id, type_dossier, dossier):
    ligne = db.session.get(DossierPlans, (projet_id, type_dossier))
    if ligne is None:
        ligne = DossierPlans(projet_id=projet_id, type_dossier=type_dossier, dossier=dossier)
        db.session.add(ligne)
    else:
        ligne.dossier = dossier
    db.session.commit()


@dossier_plans_bp.route("/<type_dossier>/<int:projet_id>", methods=["GET"])
def route_lire(type_dossier, projet_id):
    refus = _refus_requete(type_dossier, projet_id)
    if refus:
        return refus
    ligne = db.session.get(DossierPlans, (projet_id, type_dossier))
    return jsonify({"success": True, "dossier": ligne.dossier if ligne else None})


@dossier_plans_bp.route("/<type_dossier>/<int:projet_id>", methods=["PUT"])
def route_enregistrer(type_dossier, projet_id):
    refus = _refus_requete(type_dossier, projet_id)
    if refus:
        return refus
    payload, refus = _corps_json()
    if refus:
        return refus
    propres, erreurs = valider_dossier(payload.get("dossier"))
    if erreurs:
        return _refus("Réglages du dossier refusés.", 422, erreurs=erreurs)
    _enregistrer(projet_id, type_dossier, propres)
    return jsonify({"success": True})


@dossier_plans_bp.route("/<type_dossier>/<int:projet_id>/quota", methods=["GET"])
def route_quota(type_dossier, projet_id):
    refus = _refus_requete(type_dossier, projet_id)
    if refus:
        return refus
    return jsonify(quota_service.etat(g.user, projet_id, type_dossier))


@dossier_plans_bp.route("/<type_dossier>/<int:projet_id>/generer", methods=["POST"])
def route_generer(type_dossier, projet_id):
    """Réglages et champs revalidés, enregistrés, puis une génération consommée (rien en cas de refus)."""
    refus = _refus_requete(type_dossier, projet_id)
    if refus:
        return refus
    payload, refus = _corps_json()
    if refus:
        return refus
    dossier, erreurs = valider_dossier(payload.get("dossier"))
    erreurs.extend(valider_champs_generes(payload.get("champs"), AUCUN_CHAMP))
    if not any(dossier.get("pieces", {}).values()) and not dossier.get("reglementation", {}).get("inclure"):
        erreurs.append("Sélectionnez au moins une pièce.")
    if erreurs:
        return _refus("Dossier refusé : corrigez les saisies.", 422, erreurs=erreurs)

    autorise, message = quota_service.verifier_et_enregistrer(g.user, projet_id, type_dossier)
    if not autorise:
        return _refus(message, 403, quota_atteint=True)
    _enregistrer(projet_id, type_dossier, dossier)
    return jsonify({"success": True, "quota": quota_service.etat(g.user, projet_id, type_dossier)})
