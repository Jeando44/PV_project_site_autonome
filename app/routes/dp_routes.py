"""
Routes internes : appelees par le frontend de PV_project (DpModal.js) avant de generer un dossier
de Declaration Prealable, pour appliquer le quota/permission defini cote Solakvan_Projet
(session['licence_dp'] - cf. app/services/dp/quota.py).

Comme pour /api/switchgrid, ces routes n'ont pas besoin d'un @login_required local - le middleware
SSO global (app/middleware/auth_middleware.py: SSOAuth.check_auth, before_request sur toute
l'application) bloque deja toute requete sans session valide. g.user est donc garanti deja peuple
ici par ce middleware.
"""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from app.models.parametre_projet import ParametreProjet
from app.services.dp.quota import check_and_register_dp, dp_status

dp_bp = Blueprint("dp", __name__, url_prefix="/api/dp")


def _verify_project_ownership(project_id):
    """Verifie que project_id appartient bien a l'utilisateur actuellement connecte (ou admin)."""
    user = getattr(g, "user", None)
    if not user or not user.get("id"):
        return None
    if user.get("is_admin"):
        return ParametreProjet.query.filter_by(id=project_id).first()
    return ParametreProjet.query.filter_by(id=project_id, created_by=user["id"]).first()


@dp_bp.route("/check-and-register", methods=["POST"])
def route_check_and_register():
    """
    Verifie le quota/permission DP de l'utilisateur pour le projet donne et, si autorise,
    incremente immediatement son compteur mensuel. A appeler juste avant la generation effective
    du dossier (DpModal.js::_generer()).

    Body attendu: { "project_id": <id> }
    """
    payload = request.get_json(force=True) or {}
    project_id = payload.get("project_id")
    if not project_id:
        return jsonify({"error": "project_id est requis."}), 400

    projet = _verify_project_ownership(project_id)
    if not projet:
        return jsonify({"error": "Projet introuvable ou vous n'y avez pas acces."}), 403

    allowed, message = check_and_register_dp(g.user, projet.puissance_maison_kwc)
    if not allowed:
        return jsonify({"error": message, "quota_exceeded": True}), 403

    return jsonify({"success": True})


@dp_bp.route("/status", methods=["GET"])
def route_status():
    """Etat actuel du quota DP de l'utilisateur connecte (pour affichage/desactivation proactive)."""
    return jsonify(dp_status(g.user))
