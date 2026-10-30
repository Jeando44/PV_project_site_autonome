"""
Endpoint webhook : reçoit les notifications Switchgrid
(ask.accepted, order.request_success, order.request_failed, ...).

Sécurité — point d'attention :
La documentation Switchgrid ne décrit, à ce jour, AUCUN mécanisme de
signature HMAC pour vérifier l'authenticité d'un webhook entrant. Le
payload ne contient de toute façon que des identifiants (jamais de donnée
de consommation), donc l'enjeu n'est pas la confidentialité mais
l'intégrité du déclenchement. Mitigations appliquées ici :

  1. L'URL du webhook doit être gardée secrète (générée avec un slug
     aléatoire, ex: /webhooks/switchgrid/<token>, et non /webhooks/switchgrid).
  2. Idempotence stricte en base (contrainte unique) : un évènement reçu
     plusieurs fois (retry Switchgrid, ou rejoué par un tiers) n'est traité
     qu'une fois.
  3. Le webhook ne déclenche JAMAIS d'action irréversible directement: il
     déclenche un rappel à l'API Switchgrid (get_order/get_ask) pour
     obtenir/confirmer l'état réel avant tout traitement. Un attaquant qui
     rejouerait un payload ne peut donc pas falsifier les données, il peut
     au mieux déclencher un appel API supplémentaire inoffensif.
  4. Limiter, si l'infra le permet, l'accès à cette route par IP allowlist
     (Switchgrid peut fournir ses IP sortantes sur demande) en plus du token.
"""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from app.extensions import db
from app.models.switchgrid import (
    SwitchgridConsent,
    SwitchgridOrder,
    SwitchgridRawDataset,
    SwitchgridRequest,
    SwitchgridWebhookEvent,
)
from app.services.switchgrid import get_switchgrid_client
from app.services.switchgrid.exceptions import SwitchgridDataNotReadyError, SwitchgridError
from app.services.switchgrid.orders import download_request_data, get_order, get_request_status
from app.services.switchgrid.suivi import synchroniser_consent

switchgrid_webhooks_bp = Blueprint("switchgrid_webhooks", __name__, url_prefix="/webhooks")

# Le token doit être un secret long, généré une fois, stocké en config
# (SWITCHGRID_WEBHOOK_PATH_TOKEN) et configuré côté dashboard Switchgrid
# dans l'URL du webhook : https://votre-domaine/webhooks/switchgrid/<token>


@switchgrid_webhooks_bp.route("/switchgrid/<path_token>", methods=["POST"])
def receive_webhook(path_token: str):
    expected_token = current_app.config.get("SWITCHGRID_WEBHOOK_PATH_TOKEN")
    if not expected_token or path_token != expected_token:
        current_app.logger.warning("Webhook Switchgrid reçu avec un token invalide.")
        # 404 plutôt que 401/403 : on ne révèle pas que l'URL "existe" partiellement.
        return jsonify({"error": "not found"}), 404

    body = request.get_json(silent=True) or {}
    current_app.logger.info(
        "🔔 Webhook Switchgrid reçu — tag=%s orderId=%s requestType=%s",
        body.get("event", {}).get("_tag"),
        body.get("event", {}).get("orderId"),
        body.get("event", {}).get("requestType"),
    )
    event = body.get("event", {})
    event_tag = event.get("_tag")

    if not event_tag:
        return jsonify({"error": "payload invalide"}), 400

    # --- Idempotence ---------------------------------------------------- #
    existing = SwitchgridWebhookEvent.query.filter_by(
        event_tag=event_tag,
        ask_id=event.get("askId"),
        order_id=event.get("orderId"),
        request_id=event.get("requestId"),
    ).first()

    if existing:
        # Déjà traité (ou en cours) : on répond 2xx immédiatement pour éviter
        # un nouveau retry Switchgrid, sans retraiter.
        return jsonify({"status": "already_processed"}), 200

    webhook_event = SwitchgridWebhookEvent(
        event_tag=event_tag,
        ask_id=event.get("askId"),
        order_id=event.get("orderId"),
        request_id=event.get("requestId"),
        request_type=event.get("requestType"),
        payload=body,
    )
    db.session.add(webhook_event)
    db.session.commit()  # on persiste avant traitement pour garantir l'idempotence

    try:
        _dispatch_event(event_tag, event)
        webhook_event.processed_at = db.func.now()
    except Exception as exc:  # noqa: BLE001 — on veut tout capturer pour ne pas perdre l'event
        current_app.logger.exception("Erreur lors du traitement du webhook %s", event_tag)
        webhook_event.processing_error = str(exc)
        db.session.commit()
        # On renvoie tout de même 200 : Switchgrid n'a pas vocation à retenter
        # indéfiniment un échec de traitement métier de notre côté. Le suivi
        # se fait via `processing_error` + alerting interne, pas via le retry
        # webhook (qui ne résoudrait pas un bug applicatif).
        return jsonify({"status": "received_with_processing_error"}), 200

    db.session.commit()
    return jsonify({"status": "processed"}), 200


def _dispatch_event(event_tag: str, event: dict) -> None:
    handlers = {
        "ask.accepted": _handle_ask_accepted,
        "ask.revoked": _handle_ask_revoked,
        "order.request_success": _handle_request_success,
        "order.request_failed": _handle_request_failed,
    }
    handler = handlers.get(event_tag)
    if handler is None:
        current_app.logger.info("Évènement webhook Switchgrid ignoré: %s", event_tag)
        return
    handler(event)


def _handle_ask_accepted(event: dict) -> None:
    ask_id = event.get("askId")
    consent = SwitchgridConsent.query.filter_by(switchgrid_ask_id=ask_id).first()
    if not consent:
        current_app.logger.warning("ask.accepted reçu pour un ask inconnu: %s", ask_id)
        return

    # On ne fait pas confiance au webhook seul : on confirme via l'API (get_ask), puis on crée
    # l'order C68+R63 CÔTÉ SERVEUR — la demande aboutit ainsi même si l'utilisateur a fermé
    # l'application ou changé de projet avant la signature du client (auparavant seul le polling
    # du navigateur créait l'order). Idempotent : si le navigateur l'a déjà créé, rien n'est refait.
    sg_client = get_switchgrid_client()
    order, cree = synchroniser_consent(sg_client, consent)
    if cree:
        current_app.logger.info(
            "Order Switchgrid %s créé côté serveur à la signature (ask %s, projet %s).",
            order.switchgrid_order_id, ask_id, consent.project_id,
        )


def _handle_ask_revoked(event: dict) -> None:
    ask_id = event.get("askId")
    consent = SwitchgridConsent.query.filter_by(switchgrid_ask_id=ask_id).first()
    if consent:
        consent.status = "REVOKED"
        consent.revoked_at = db.func.now()
        db.session.add(consent)


def _handle_request_success(event: dict) -> None:
    _sync_request_and_maybe_download(event, expect_success=True)


def _handle_request_failed(event: dict) -> None:
    _sync_request_and_maybe_download(event, expect_success=False)


def _sync_request_and_maybe_download(event: dict, expect_success: bool) -> None:
    order_switchgrid_id = event.get("orderId")
    request_type = event.get("requestType")

    order = SwitchgridOrder.query.filter_by(switchgrid_order_id=order_switchgrid_id).first()
    if not order:
        current_app.logger.warning("order inconnu en base pour orderId=%s", order_switchgrid_id)
        return

    sg_client = get_switchgrid_client()
    order_data = get_order(sg_client, order_switchgrid_id)
    order.status = order_data.get("status", order.status)
    db.session.add(order)

    sg_request_payload = get_request_status(order_data, request_type)
    if sg_request_payload is None:
        return

    # Multi-PRM (ACC) : une seule request Switchgrid par type couvre TOUS les PRM de l'order, donc un
    # seul fichier à télécharger — on le télécharge une fois (et non une fois par PRM) et on le range
    # sous chaque SwitchgridRequest locale ; le filtrage par PRM se fait au mapping (idPrm / point).
    local_requests = order.requests.filter_by(request_type=request_type).all()
    raw_cache = {}
    for local_request in local_requests:
        local_request.status = sg_request_payload.get("status", local_request.status)
        local_request.error_message = sg_request_payload.get("errorMessage")
        db.session.add(local_request)

        if expect_success and local_request.status == "SUCCESS":
            _download_and_store(sg_client, order_data, local_request, request_type, raw_cache)


def _download_and_store(sg_client, order_data, local_request: SwitchgridRequest, request_type: str,
                        raw_cache: dict = None) -> None:
    try:
        if raw_cache is not None and "bytes" in raw_cache:
            raw_bytes = raw_cache["bytes"]
        else:
            raw_bytes = download_request_data(sg_client, order_data, request_type)
            if raw_cache is not None:
                raw_cache["bytes"] = raw_bytes
    except SwitchgridDataNotReadyError:
        # Webhook reçu mais get_order pas encore cohérent (race condition rare) :
        # on laisse le polling de secours (route_get_order_status) rattraper plus tard.
        current_app.logger.info(
            "Donnée pas encore prête pour request_type=%s order=%s, sera rattrapé par polling.",
            request_type, order_data.get("id"),
        )
        return
    except SwitchgridError:
        current_app.logger.exception("Échec du téléchargement de la donnée Switchgrid")
        return

    from app.services.switchgrid.donnees_brutes import charger_json_compact, preparer_pour_stockage

    if raw_cache is not None and "contenu" in raw_cache:
        content_json = raw_cache["contenu"]  # multi-PRM : décodé/compressé une seule fois
    else:
        try:
            # Décodage compact + stockage compressé : une R63 5 min pluriannuelle (~56 Mo)
            # saturait la mémoire du conteneur et dépassait la taille de paquet MySQL.
            content_json = preparer_pour_stockage(charger_json_compact(raw_bytes))
        except (ValueError, UnicodeDecodeError):
            content_json = {"raw_base64": raw_bytes.decode("latin-1", errors="replace")}
        if raw_cache is not None:
            raw_cache["contenu"] = content_json

    existing_dataset = SwitchgridRawDataset.query.filter_by(request_id=local_request.id).first()
    if existing_dataset:
        existing_dataset.content_json = content_json
    else:
        db.session.add(SwitchgridRawDataset(request_id=local_request.id, content_json=content_json))

    # NOTE: c'est ICI qu'on déclencherait, par exemple via une tâche async
    # (Celery/RQ) plutôt qu'en synchrone dans la requête webhook, le mapping
    # vers les calculs PV (voir app/services/switchgrid/mapping.py) puis la
    # mise à jour de l'étude de dimensionnement concernée.