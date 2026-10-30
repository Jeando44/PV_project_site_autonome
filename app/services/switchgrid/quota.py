"""
Quota Switchgrid — limite le nombre de requêtes de courbe de charge Enedis (création d'un Order
C68+R63, cf. switchgrid_routes.py::route_create_order / route_workflow_finalize) qu'un utilisateur
peut effectuer.

La limite effective (max_monthly_calls) vient de la licence SSO (session['licence_switchgrid'],
alimentée par Solakvan_Projet à la connexion — cf.
app/middleware/auth_middleware.py::handle_sso_login), pas d'une config locale : quota global par
défaut (SiteSettings.switch_grid_default_monthly_quota côté Solakvan_Projet) avec surcharge
possible par utilisateur, déjà résolus en un seul nombre par Solakvan_Projet avant l'envoi.
`SWITCHGRID_TRIAL_QUOTA` (config.py) n'est plus la source de la limite ; conservé uniquement pour
compatibilité de config existante, non lu ici.

Compteur remis à zéro chaque mois calendaire (`current_period`, format 'YYYY-MM') plutôt qu'un
total à vie — cf. `_get_or_reset_quota`. `first_request_at` reste conservé à titre informatif
seulement (support, futurs messages d'UI ; cf. trial_end_date, non modifié).

Seules les requêtes réellement effectuées (orders créés) consomment le quota. Une demande lancée
mais pas encore signée par le client ne réserve plus de place : c'était la cause des refus « quota
atteint » dès la première demande (liens de signature non signés, relances sur le même PRM). Le
quota est à la place revérifié au moment où l'order est créé, y compris côté serveur sans session
(webhook ask.accepted), à partir du dernier quota de licence mémorisé — cf.
verifier_quota_creation_order.

`is_licensed` (accès illimité) est une bascule manuelle en base — PV_project n'a aujourd'hui aucun
accès à un vrai signal d'abonnement depuis l'application principale (le payload SSO ne transporte
que id/email/is_admin/permissions). Les utilisateurs admin (g.user['is_admin']) sont exemptés de
la limite pour ne pas gêner les tests internes.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from app.utils.dates import utc_maintenant
from typing import Optional, Tuple

from flask import current_app, session

from app.extensions import db
from app.models.switchgrid import SwitchgridUsageQuota

class QuotaSwitchgridAtteint(ValueError):
    """Levée à la création d'un order quand le quota du créateur du consentement est épuisé."""


def _current_period() -> str:
    return utc_maintenant().strftime("%Y-%m")


def _get_or_reset_quota(user_id: str) -> SwitchgridUsageQuota:
    """Récupère le quota de l'utilisateur, en le remettant à zéro si on a changé de mois."""
    period = _current_period()
    quota = SwitchgridUsageQuota.query.get(user_id)
    if quota is None:
        quota = SwitchgridUsageQuota(
            user_id=user_id, first_request_at=utc_maintenant(), request_count=0, current_period=period
        )
        db.session.add(quota)
        db.session.commit()
    elif quota.current_period != period:
        quota.current_period = period
        quota.request_count = 0
        db.session.add(quota)
        db.session.commit()
    return quota


def _memoriser_quota_licence(quota: SwitchgridUsageQuota, max_monthly_calls: Optional[int]) -> None:
    """Mémorise le quota de licence courant (None = illimité) pour les contrôles sans session."""
    if quota.quota_licence_maj_le is not None and quota.quota_licence_max == max_monthly_calls:
        return
    quota.quota_licence_max = max_monthly_calls
    quota.quota_licence_maj_le = utc_maintenant()
    db.session.add(quota)
    db.session.commit()


def _message_quota_atteint(max_monthly_calls: int) -> str:
    return (
        f"Quota mensuel Switch Grid atteint : {max_monthly_calls} requête(s) de courbe de "
        "charge Enedis autorisée(s) par mois."
    )


def check_trial_quota(user: dict, inclure_consentements_en_attente: bool = False) -> Tuple[bool, Optional[str]]:
    """
    Vérifie si `user` (g.user, doit contenir 'id') est autorisé à effectuer une nouvelle requête de
    courbe de charge Enedis. N'incrémente PAS le compteur — cf. register_switchgrid_request(), à
    appeler uniquement après le succès de la requête Switchgrid, pour ne pas consommer le quota
    d'un utilisateur sur un appel qui a échoué.

    Retourne (allowed, message) : message est None si allowed est True, sinon un message d'erreur
    prêt à être renvoyé au frontend.

    `inclure_consentements_en_attente` : conservé pour compatibilité des appels, sans effet. Les
    demandes non encore signées ne sont plus comptées (cf. docstring du module) ; le quota est
    revérifié à la création de l'order (verifier_quota_creation_order).
    """
    user_id = user.get("id") if user else None
    if not user_id:
        return False, "Utilisateur non authentifié."

    quota = _get_or_reset_quota(user_id)

    if user.get("is_admin"):
        _memoriser_quota_licence(quota, None)
        return True, None

    if quota.is_licensed:
        return True, None

    licence_switchgrid = session.get("licence_switchgrid")
    if not licence_switchgrid:
        _memoriser_quota_licence(quota, 0)
        return False, "Vous n'avez pas accès à la récupération de courbe de charge Enedis (Switch Grid)."

    max_monthly_calls = licence_switchgrid.get("max_monthly_calls")
    _memoriser_quota_licence(quota, max_monthly_calls)
    if max_monthly_calls is not None and quota.request_count >= max_monthly_calls:
        return False, _message_quota_atteint(max_monthly_calls)

    return True, None


def verifier_quota_creation_order(user_id: Optional[str]) -> Tuple[bool, Optional[str]]:
    """
    Contrôle du quota au moment de créer un order (la requête facturée), utilisable SANS session
    (webhook ask.accepted) : s'appuie sur le dernier quota de licence mémorisé par check_trial_quota
    / quota_status. Ne commit pas (appelé sous verrou dans suivi.creer_order_pour_consent).

    Autorise si aucun quota n'a encore été mémorisé pour cet utilisateur (comportement antérieur).
    """
    if not user_id:
        return True, None
    quota = SwitchgridUsageQuota.query.get(user_id)
    if quota is None or quota.is_licensed or quota.quota_licence_maj_le is None:
        return True, None
    if quota.quota_licence_max is None:
        return True, None
    used = quota.request_count if quota.current_period == _current_period() else 0
    if used >= quota.quota_licence_max:
        return False, _message_quota_atteint(quota.quota_licence_max)
    return True, None


def register_switchgrid_request(user_id: str) -> None:
    """À appeler uniquement après la création réussie d'un Order Switchgrid (C68+R63)."""
    quota = _get_or_reset_quota(user_id)
    quota.request_count += 1
    db.session.add(quota)
    db.session.commit()


def quota_status(user: dict) -> dict:
    """État actuel du quota Switch Grid pour l'UI (GET /api/switchgrid/quota-status)."""
    if user and user.get("is_admin"):
        if user.get("id"):
            _memoriser_quota_licence(_get_or_reset_quota(user["id"]), None)
        return {"allowed": True, "max_monthly_calls": None, "used_this_month": 0, "message": None}

    user_id = user.get("id") if user else None
    licence_switchgrid = session.get("licence_switchgrid") if user else None
    if user_id:
        # Rafraîchit le quota mémorisé à chaque ouverture de la section : un quota relevé par
        # l'admin débloque ainsi les orders en attente (cf. verifier_quota_creation_order).
        _memoriser_quota_licence(
            _get_or_reset_quota(user_id),
            licence_switchgrid.get("max_monthly_calls") if licence_switchgrid else 0,
        )
    if not user_id or not licence_switchgrid:
        return {
            "allowed": False,
            "max_monthly_calls": None,
            "used_this_month": 0,
            "message": "Vous n'avez pas accès à la récupération de courbe de charge Enedis (Switch Grid).",
        }

    quota = SwitchgridUsageQuota.query.get(user_id)
    used = quota.request_count if (quota and quota.current_period == _current_period()) else 0
    if quota and quota.is_licensed:
        return {"allowed": True, "max_monthly_calls": None, "used_this_month": used, "message": None}

    max_monthly_calls = licence_switchgrid.get("max_monthly_calls")
    allowed = max_monthly_calls is None or used < max_monthly_calls
    message = None if allowed else _message_quota_atteint(max_monthly_calls)
    return {
        "allowed": allowed,
        "max_monthly_calls": max_monthly_calls,
        "used_this_month": used,
        "message": message,
    }


def trial_end_date(user_id: str) -> Optional[datetime]:
    """Date informative de fin d'essai (première requête + SWITCHGRID_TRIAL_DAYS). Usage UI/support."""
    quota = SwitchgridUsageQuota.query.get(user_id)
    if quota is None:
        return None
    trial_days = current_app.config.get("SWITCHGRID_TRIAL_DAYS", 7)
    return quota.first_request_at + timedelta(days=trial_days)
