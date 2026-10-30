"""
Service : commande de données (`Order`) et récupération des résultats.

Endpoints v0 :
    POST /integration/enedis/order
    GET  /integration/enedis/order/{orderId}
    GET  /integration/enedis/request/{requestId}/data   (uniquement pour R63 / R63_SYNC)

Limité volontairement, pour ce projet, aux types retenus : C68 et R63.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .client import SwitchgridClient
from .exceptions import SwitchgridDataNotReadyError, SwitchgridLoadcurveNotActivatedError

ALLOWED_TYPES = {"C68", "R63"}

# Statuts "terminaux" d'une request individuelle au sein d'un order.
TERMINAL_REQUEST_STATUSES = {"SUCCESS", "FAILED"}
TERMINAL_ORDER_STATUSES = {"SUCCESS", "SOME_REQUESTS_FAILED"}

LOADCURVE_NOT_ACTIVATED_MARKER = "aucun service souscrit de courbe de charge"


def _build_request(
    request_type: str,
    prms: List[str],
    direction: str = "SOUTIRAGE",
    since: Optional[str] = None,
    until: Optional[str] = None,
    retry_after_activation: bool = False,
) -> Dict[str, Any]:
    if request_type not in ALLOWED_TYPES:
        raise ValueError(
            f"Type de requête '{request_type}' non supporté dans ce projet "
            f"(types autorisés : {sorted(ALLOWED_TYPES)})."
        )
    req: Dict[str, Any] = {"type": request_type, "prms": prms}
    if request_type == "R63":
        req["direction"] = direction
        if retry_after_activation:
            req["enedisRetryAfterLoadcurveActivation"] = True
    if since:
        req["since"] = since
    if until:
        req["until"] = until
    return req


def create_order(
    client: SwitchgridClient,
    prms: List[str],
    include_c68: bool = True,
    include_r63: bool = True,
    r63_since: Optional[str] = None,
    r63_until: Optional[str] = None,
    retry_after_loadcurve_activation: bool = True,
) -> Dict[str, Any]:
    """
    Crée une commande combinant C68 (données contractuelles) et R63 (courbe
    de charge) pour une ou plusieurs PRM, après consentement signé.

    `retry_after_loadcurve_activation=True` par défaut : très recommandé,
    car la première demande R63 sur une PRM échoue presque systématiquement
    si la collecte n'a jamais été activée chez Enedis ; ce flag déclenche
    une relance automatique côté Switchgrid après activation.
    """
    requests_payload: List[Dict[str, Any]] = []
    if include_c68:
        requests_payload.append(_build_request("C68", prms))
    if include_r63:
        requests_payload.append(
            _build_request(
                "R63",
                prms,
                since=r63_since,
                until=r63_until,
                retry_after_activation=retry_after_loadcurve_activation,
            )
        )

    response = client.post(
        "/integration/enedis/order", json_body={"requests": requests_payload}
    )
    return response.json()


def get_order(client: SwitchgridClient, order_id: str) -> Dict[str, Any]:
    """
    Consulte le statut global d'un order et de chacune de ses requests.
    À appeler :
      - en polling de secours si aucun webhook n'est reçu sous un délai donné
      - immédiatement après réception d'un webhook order.request_success/failed
        (le webhook ne contient pas la donnée elle-même, seulement les ids)
    """
    response = client.get(f"/integration/enedis/order/{order_id}")
    return response.json()


def get_request_status(order_payload: Dict[str, Any], request_type: str) -> Optional[Dict[str, Any]]:
    """Extrait, depuis un payload d'order, la sous-requête correspondant à un type donné."""
    for req in order_payload.get("requests", []):
        if req.get("type") == request_type:
            return req
    return None


def assert_request_ready_or_raise(request_payload: Dict[str, Any]) -> None:
    """
    Lève une exception métier explicite selon l'état d'une request, plutôt
    que de laisser l'appelant interpréter des strings de statut à la main.
    """
    status = request_payload.get("status")
    if status not in TERMINAL_REQUEST_STATUSES:
        raise SwitchgridDataNotReadyError(
            f"La donnée n'est pas encore disponible (status={status})."
        )
    if status == "FAILED":
        error_message = request_payload.get("errorMessage") or ""
        if LOADCURVE_NOT_ACTIVATED_MARKER in error_message:
            raise SwitchgridLoadcurveNotActivatedError(error_message)
        from .exceptions import SwitchgridError

        raise SwitchgridError(
            f"La requête Switchgrid a échoué : {error_message}",
            payload=request_payload,
        )


def download_request_data(
    client: SwitchgridClient,
    order_payload: Dict[str, Any],
    request_type: str,
) -> bytes:
    """
    Télécharge le contenu brut associé à une request terminée avec succès.
    Gère le cas `dataUrl` unique et le cas `dataUrls` (liste, pour les
    réponses volumineuses scindées par Enedis) — dans ce dernier cas,
    concatène les contenus JSON en une liste, ou retourne le premier
    fragment pour les formats non concatenables (à affiner selon le format
    réellement observé en prod sur vos PRM).
    """
    request_payload = get_request_status(order_payload, request_type)
    if request_payload is None:
        raise ValueError(f"Aucune request de type {request_type} dans cet order.")

    assert_request_ready_or_raise(request_payload)

    data_url = request_payload.get("dataUrl")
    data_urls = request_payload.get("dataUrls")

    if data_url:
        return client.download_data_url(data_url).content

    if data_urls:
        chunks = [client.download_data_url(url).content for url in data_urls]
        return merge_json_chunks(chunks)

    raise SwitchgridDataNotReadyError(
        f"Aucune dataUrl disponible pour la request {request_type} "
        f"(status={request_payload.get('status')})."
    )


def merge_json_chunks(chunks: List[bytes]) -> bytes:
    """
    Fusionne les fragments d'une réponse `dataUrls` en UN SEUL document JSON valide.

    Cas fréquent en ACC : une request Switchgrid couvre TOUS les PRM de l'order (cf.
    _build_request, champ `prms`), et une réponse volumineuse (plusieurs PRM, plusieurs mois de
    R63) est scindée en plusieurs fichiers. L'ancienne concaténation brute (b"\\n".join) produisait
    un texte non parsable dès 2 fragments : json.loads échouait, la donnée était perdue (route
    export/courbes-préparées) ou stockée en {"raw_base64": ...} inexploitable (webhook).

      - fragments R63 {"header", "mesures": [...]} -> un seul document, mesures concaténées ;
      - fragments listes -> liste concaténée ;
      - autres documents (ex. un C68 {"point": ...} par PRM) -> liste des documents, que
        mapping.map_c68_to_contrat sait parcourir pour retrouver le PRM demandé.
    Si un fragment n'est pas du JSON, on retombe sur l'ancien comportement (concaténation brute).
    """
    import json

    from .donnees_brutes import charger_json_compact

    try:
        # Décodage compact : une R63 5 min pluriannuelle découpée en fragments dépasse sinon la
        # mémoire du conteneur (cf. donnees_brutes).
        docs = [charger_json_compact(chunk) for chunk in chunks]
    except (ValueError, UnicodeDecodeError):
        return b"\n".join(chunks)

    if len(docs) == 1:
        merged: Any = docs[0]
    elif all(isinstance(d, dict) and isinstance(d.get("mesures"), list) for d in docs):
        merged = dict(docs[0])
        merged["mesures"] = [m for d in docs for m in d["mesures"]]
    elif all(isinstance(d, list) for d in docs):
        merged = [item for d in docs for item in d]
    else:
        merged = docs
    return json.dumps(merged).encode("utf-8")


def download_loadcurve_normalized(
    client: SwitchgridClient,
    request_id: str,
    period: str = "PT1800S",
    fmt: str = "json",
    since: Optional[str] = None,
    until: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Alternative à `download_request_data` pour R63 : utilise
    GET /integration/enedis/request/{requestId}/data, qui renvoie une courbe
    normalisée à intervalle constant (par défaut 1h, ici on demande 30 min
    via PT1800S car c'est l'intervalle natif Linky le plus courant).

    Recommandé pour l'injection directe dans les calculs PV (pas besoin de
    re-normaliser le pas de temps côté PV_project).
    """
    params: Dict[str, Any] = {"period": period, "format": fmt}
    if since:
        params["since"] = since
    if until:
        params["until"] = until

    response = client.get(
        f"/integration/enedis/request/{request_id}/data", params=params
    )
    return response.json()