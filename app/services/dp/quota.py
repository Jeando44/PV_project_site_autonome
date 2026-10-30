"""
Quota mensuel de Declaration Prealable (DP) - limite le nombre de generations de dossiers de
Declaration Prealable qu'un utilisateur standard peut effectuer par mois calendaire, ainsi que la
puissance max du projet pour lequel le DP est genere. Ces deux limites viennent de la licence SSO
(session['licence_dp'], alimentee par Solakvan_Projet a la connexion - cf.
app/middleware/auth_middleware.py::handle_sso_login), pas d'une config locale.

session['licence_dp'] est None si l'utilisateur n'a pas la permission 'dp'. Pour un admin ou un
utilisateur sans limite explicite, max_power_kwc / max_per_month valent None (illimite).

Contrairement a Switch Grid (qui appelle une API externe payante, donc check puis register separes
apres succes), la generation DP est 100% locale : check et incrementation se font en un seul appel
atomique (check_and_register_dp), pas de risque de consommer le quota sur un appel qui echoue.
"""
from __future__ import annotations

from datetime import datetime
from app.utils.dates import utc_maintenant
from typing import Optional, Tuple

from flask import session

from app.extensions import db
from app.models.dp_quota import DpUsageQuota


def _current_period() -> str:
    return utc_maintenant().strftime("%Y-%m")


def _get_or_reset_quota(user_id: str) -> DpUsageQuota:
    """Recupere le quota de l'utilisateur, en le remettant a zero si on a change de mois."""
    period = _current_period()
    quota = DpUsageQuota.query.get(user_id)
    if quota is None:
        quota = DpUsageQuota(user_id=user_id, period=period, request_count=0)
        db.session.add(quota)
    elif quota.period != period:
        quota.period = period
        quota.request_count = 0
    return quota


def check_and_register_dp(user: dict, puissance_maison_kwc: Optional[float]) -> Tuple[bool, Optional[str]]:
    """
    Verifie ET, si autorise, incremente immediatement le quota mensuel de DP de `user` (g.user, doit
    contenir 'id'). Retourne (allowed, message) : message est None si allowed est True, sinon un
    message d'erreur pret a etre renvoye au frontend. N'incremente rien si refuse.
    """
    user_id = user.get("id") if user else None
    if not user_id:
        return False, "Utilisateur non authentifie."

    if user.get("is_admin"):
        return True, None

    licence_dp = session.get("licence_dp")
    if not licence_dp:
        return False, "Vous n'avez pas acces a la generation de Declaration Prealable."

    max_power_kwc = licence_dp.get("max_power_kwc")
    if max_power_kwc is not None and puissance_maison_kwc is not None and puissance_maison_kwc > max_power_kwc:
        return False, (
            f"Puissance du projet ({puissance_maison_kwc} kWc) superieure a la limite autorisee "
            f"({max_power_kwc} kWc) pour la generation de Declaration Prealable."
        )

    max_per_month = licence_dp.get("max_per_month")
    quota = _get_or_reset_quota(user_id)
    if max_per_month is not None and quota.request_count >= max_per_month:
        return False, (
            f"Quota mensuel de Declaration Prealable atteint : {max_per_month} generation(s) "
            "autorisee(s) par mois."
        )

    quota.request_count += 1
    db.session.commit()
    return True, None


def dp_status(user: dict) -> dict:
    """Etat actuel du quota DP pour l'UI (GET /api/dp/status)."""
    user_id = user.get("id") if user else None
    licence_dp = session.get("licence_dp")

    if user and user.get("is_admin"):
        return {"allowed": True, "max_power_kwc": None, "max_per_month": None, "used_this_month": 0}

    if not user_id or not licence_dp:
        return {"allowed": False, "max_power_kwc": None, "max_per_month": None, "used_this_month": 0}

    quota = DpUsageQuota.query.get(user_id)
    used = quota.request_count if (quota and quota.period == _current_period()) else 0
    max_per_month = licence_dp.get("max_per_month")
    return {
        "allowed": max_per_month is None or used < max_per_month,
        "max_power_kwc": licence_dp.get("max_power_kwc"),
        "max_per_month": max_per_month,
        "used_this_month": used,
    }
