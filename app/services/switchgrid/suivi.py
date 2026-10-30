"""
Suivi d'une demande de courbe de charge Enedis INDÉPENDANT du navigateur.

Avant ce module, la création de la commande C68+R63 (étape « consentement signé → order ») n'était
déclenchée QUE par le navigateur (polling de la signature dans switchgrid_workflow.js, 5 min max) :
si l'utilisateur fermait l'application ou changeait de projet avant la signature du client, aucune
commande n'était jamais créée et la courbe de charge n'arrivait jamais. De même, le statut d'un
order n'était rafraîchi que par le webhook ou par le polling du navigateur.

Ce module regroupe les opérations appelables depuis n'importe quel point d'entrée (webhook
ask.accepted, route de finalisation du navigateur, route de reprise à l'ouverture du projet,
routes d'export) :

  - creer_order_pour_consent : idempotent, UN order par consentement (le premier arrivé du webhook
    ou du navigateur le crée, l'autre le retrouve) ; compte la requête dans le quota du créateur
    du consentement (consent.user_id), pas de l'utilisateur courant (le webhook n'en a pas) ;
  - synchroniser_consent : relit le statut de l'Ask chez Switchgrid et crée l'order s'il est signé ;
  - rafraichir_order : relit le statut de l'order chez Switchgrid s'il n'est pas terminé.

Le contrôle d'accès reste à la charge des appelants (routes : _verify_*_ownership ; webhook :
token d'URL + relecture systématique chez Switchgrid).
"""
from __future__ import annotations

from datetime import datetime
from app.utils.dates import utc_maintenant
from typing import Any, Dict, List, Optional, Tuple

from app.extensions import db
from app.models.switchgrid import SwitchgridConsent, SwitchgridOrder, SwitchgridRequest

from .asks import get_ask
from .client import SwitchgridClient
from .orders import create_order, get_order, get_request_status
from .quota import QuotaSwitchgridAtteint, register_switchgrid_request, verifier_quota_creation_order

# Statuts locaux d'un order à partir desquels les données sont exploitables (cf. routes export /
# courbes-preparees, qui utilisent la même liste).
STATUTS_ORDER_TERMINAUX = ("SUCCESS", "SOME_REQUESTS_FAILED", "COMPLETED")

# Statuts d'un Ask pour lesquels aucune commande ne sera jamais créée.
STATUTS_CONSENT_REFUSES = ("NOT_VALID", "REVOKED")


def _parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def order_du_consent(consent: SwitchgridConsent) -> Optional[SwitchgridOrder]:
    return consent.orders.order_by(SwitchgridOrder.created_at.desc()).first()


def creer_order_pour_consent(
    sg_client: SwitchgridClient,
    consent: SwitchgridConsent,
    prms: Optional[List[str]] = None,
) -> Tuple[SwitchgridOrder, bool]:
    """
    Crée l'order C68+R63 d'un consentement signé, sauf s'il existe déjà.

    Retourne (order, cree). Le quota du créateur du consentement est vérifié ici, juste avant l'appel
    facturé (quota.verifier_quota_creation_order, sans session) : lève QuotaSwitchgridAtteint s'il est
    épuisé — le consentement reste signé sans order et sera repris (ouverture du projet) une fois le
    quota relevé. Il est incrémenté ici, une seule fois, uniquement quand l'order est effectivement créé.
    """
    # Verrou sur la ligne du consentement (MySQL) : sérialise un webhook ask.accepted et une
    # finalisation navigateur arrivés en même temps, pour ne pas créer (et facturer) 2 orders.
    consent = (
        SwitchgridConsent.query.filter_by(id=consent.id).with_for_update().one()
    )
    existant = order_du_consent(consent)
    if existant is not None:
        db.session.commit()  # libère le verrou
        return existant, False

    prms = list(prms or consent.prms or [])
    if not prms:
        db.session.commit()
        raise ValueError("Aucun PDL rattaché à ce consentement : impossible de créer la commande.")

    quota_ok, quota_message = verifier_quota_creation_order(consent.user_id)
    if not quota_ok:
        db.session.commit()  # libère le verrou
        raise QuotaSwitchgridAtteint(quota_message)

    order_response = create_order(sg_client, prms=prms)

    order = SwitchgridOrder(
        consent_id=consent.id,
        project_id=consent.project_id,
        user_id=consent.user_id,
        switchgrid_order_id=order_response["id"],
        status=order_response.get("status", "CREATED"),
    )
    db.session.add(order)
    db.session.flush()

    for req in order_response.get("requests", []):
        for prm in prms:
            db.session.add(SwitchgridRequest(
                order_id=order.id,
                request_type=req["type"],
                prm=prm,
                status=req.get("status", "NOT_STARTED"),
                ordered_at=_parse_dt(req.get("orderedAt")),
            ))
    db.session.commit()

    if consent.user_id:
        register_switchgrid_request(consent.user_id)

    return order, True


def synchroniser_consent(
    sg_client: SwitchgridClient,
    consent: SwitchgridConsent,
    creer_order: bool = True,
) -> Tuple[Optional[SwitchgridOrder], bool]:
    """
    Relit le statut de l'Ask chez Switchgrid (source de vérité), le persiste, puis crée l'order si
    le consentement est signé et qu'aucun order n'existe encore. Retourne (order|None, cree).
    """
    ask_data = get_ask(sg_client, consent.switchgrid_ask_id)
    consent.status = ask_data.get("status", consent.status)
    if consent.status == "ACCEPTED" and not consent.signed_at:
        consent.signed_at = utc_maintenant()
    elif consent.status == "REVOKED" and not consent.revoked_at:
        consent.revoked_at = utc_maintenant()
    db.session.add(consent)
    db.session.commit()

    if consent.status != "ACCEPTED":
        return None, False
    if not creer_order:
        return order_du_consent(consent), False
    return creer_order_pour_consent(sg_client, consent)


def rafraichir_order(sg_client: SwitchgridClient, order: SwitchgridOrder) -> Optional[Dict[str, Any]]:
    """
    Relit le statut d'un order non terminé chez Switchgrid (statut global + statut de chaque
    request locale) et le persiste. Ne fait AUCUN appel si l'order est déjà terminé en base.
    Retourne le payload Switchgrid de l'order, ou None si aucun appel n'a été fait.
    """
    if order.status in STATUTS_ORDER_TERMINAUX:
        return None

    order_data = get_order(sg_client, order.switchgrid_order_id)
    order.status = order_data.get("status", order.status)
    db.session.add(order)

    for local_request in order.requests.all():
        payload = get_request_status(order_data, local_request.request_type)
        if payload is None:
            continue
        local_request.status = payload.get("status", local_request.status)
        local_request.error_message = payload.get("errorMessage")
        db.session.add(local_request)

    db.session.commit()
    return order_data
