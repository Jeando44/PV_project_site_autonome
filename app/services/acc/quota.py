"""
Quota mensuel de calcul ACC (Autoconsommation Collective) - limite le nombre d'etudes ACC qu'un
utilisateur standard peut mener par mois calendaire. La limite vient de la licence SSO
(session['licence_acc'], alimentee par Solakvan_Projet a la connexion et a chaque revalidation -
cf. app/middleware/auth_middleware.py), pas d'une config locale.

session['licence_acc'] est None si l'utilisateur n'a pas la permission 'acc'. Pour un admin ou un
utilisateur sans limite explicite, max_studies_per_month vaut None (illimite).

Une etude = un projet distinct par mois : le calcul ACC est relance a chaque ajustement (cles de
repartition, pertes, participants...), le compter a chaque appel epuiserait le quota en quelques
minutes. Sans projet actif, chaque calcul compte pour une etude.

Comme pour Switch Grid : verification AVANT le calcul (check_acc_quota) et enregistrement seulement
APRES un calcul reussi (register_acc_study), pour ne pas consommer une etude sur un calcul en erreur.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from app.utils.dates import utc_maintenant
from typing import Optional, Tuple

from flask import session

from app.extensions import db
from app.models.acc_quota import AccStudyUsage

NO_ACCESS_MESSAGE = "Vous n'avez pas acces au calcul d'Autoconsommation Collective (ACC)."


def _current_period() -> str:
    return utc_maintenant().strftime("%Y-%m")


def _used_this_month(user_id: str) -> int:
    return AccStudyUsage.query.filter_by(user_id=user_id, period=_current_period()).count()


def _already_counted(user_id: str, projet_id) -> bool:
    if projet_id is None:
        return False
    return AccStudyUsage.query.filter_by(
        user_id=user_id, period=_current_period(), projet_key=str(projet_id)
    ).first() is not None


def _quota_message(max_per_month: int) -> str:
    return (
        f"Quota mensuel d'etudes ACC atteint : {max_per_month} etude(s) (projets distincts) "
        "autorisee(s) par mois. Les recalculs sur un projet deja etudie ce mois-ci restent possibles."
    )


def check_acc_quota(user: dict, projet_id=None) -> Tuple[bool, Optional[str]]:
    """
    Verifie si `user` (g.user, doit contenir 'id') peut lancer un calcul ACC sur `projet_id`.
    N'enregistre rien - cf. register_acc_study(), a appeler apres le succes du calcul.
    Retourne (allowed, message) : message est None si allowed est True.
    """
    user_id = user.get("id") if user else None
    if not user_id:
        return False, "Utilisateur non authentifie."

    if user.get("is_admin"):
        return True, None

    licence_acc = session.get("licence_acc")
    if not licence_acc:
        return False, NO_ACCESS_MESSAGE

    max_per_month = licence_acc.get("max_studies_per_month")
    if max_per_month is None or _already_counted(user_id, projet_id):
        return True, None

    if _used_this_month(user_id) >= max_per_month:
        return False, _quota_message(max_per_month)

    return True, None


def register_acc_study(user: dict, projet_id=None) -> None:
    """A appeler uniquement apres un calcul ACC reussi. Sans effet si le projet est deja compte."""
    user_id = user.get("id") if user else None
    if not user_id or user.get("is_admin"):
        return
    if _already_counted(user_id, projet_id):
        return
    projet_key = str(projet_id) if projet_id is not None else f"sans-projet-{uuid.uuid4().hex}"
    db.session.add(AccStudyUsage(user_id=user_id, period=_current_period(), projet_key=projet_key))
    try:
        db.session.commit()
    except Exception:
        # Double calcul simultane sur le meme projet : la contrainte d'unicite a joue, l'etude
        # est deja comptee - rien a faire.
        db.session.rollback()


def acc_status(user: dict, projet_id=None) -> dict:
    """Etat actuel du quota ACC pour l'UI (GET /api/acc/status)."""
    if user and user.get("is_admin"):
        return {"allowed": True, "max_studies_per_month": None, "used_this_month": 0, "message": None}

    user_id = user.get("id") if user else None
    licence_acc = session.get("licence_acc") if user else None
    if not user_id or not licence_acc:
        return {"allowed": False, "max_studies_per_month": None, "used_this_month": 0,
                "message": NO_ACCESS_MESSAGE}

    allowed, message = check_acc_quota(user, projet_id)
    return {
        "allowed": allowed,
        "max_studies_per_month": licence_acc.get("max_studies_per_month"),
        "used_this_month": _used_this_month(user_id),
        "message": message,
    }
