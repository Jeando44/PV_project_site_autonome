"""
Routes de diagnostic Switchgrid.

Blueprint SÉPARÉ, monté sur /api/switchgrid/debug.

⚠️  SÉCURITÉ : ce blueprint expose des informations techniques sensibles.
Il doit être :
  - désactivé en production (conditionnel sur app.config['DEBUG'])
  - ou protégé par un rôle admin strict

La vérification de désactivation est faite dans chaque route via
`_check_debug_allowed()`, et le blueprint lui-même peut être omis
du `register_blueprint()` en prod.
"""
from __future__ import annotations

import time
from typing import Any, Dict

from flask import Blueprint, current_app, jsonify

from app.services.switchgrid import get_switchgrid_client
from app.services.switchgrid.exceptions import (
    SwitchgridAuthError,
    SwitchgridConnectionError,
    SwitchgridError,
    SwitchgridTimeoutError,
)

switchgrid_debug_bp = Blueprint(
    "switchgrid_debug", __name__, url_prefix="/api/switchgrid/debug"
)


def _check_debug_allowed():
    """Bloque l'accès si l'app n'est pas en mode DEBUG."""
    if not current_app.config.get("DEBUG", False):
        return jsonify({"error": "Les routes de debug sont désactivées en production."}), 403
    return None


# ------------------------------------------------------------------ #
# 1. Test de connexion API + validation de la clé
# ------------------------------------------------------------------ #

@switchgrid_debug_bp.route("/ping", methods=["GET"])
def debug_ping():
    """
    Vérifie que :
      - La clé API est configurée dans l'environnement
      - Le client Switchgrid peut être instancié
      - L'API répond (GET /ask avec limit=1, requête légère)
      - Les headers envoyés sont corrects

    Retourne un rapport de diagnostic complet en JSON.

    Appel depuis le navigateur : GET /api/switchgrid/debug/ping
    Appel depuis le terminal   : curl http://localhost:5000/api/switchgrid/debug/ping
    """
    block = _check_debug_allowed()
    if block:
        return block

    report: Dict[str, Any] = {
        "step_1_config": {},
        "step_2_client_init": {},
        "step_3_api_call": {},
        "step_4_headers": {},
        "overall_status": "UNKNOWN",
    }

    # --- Étape 1 : Variables de configuration -------------------------
    api_key = current_app.config.get("SWITCHGRID_API_KEY")
    webhook_token = current_app.config.get("SWITCHGRID_WEBHOOK_PATH_TOKEN")

    report["step_1_config"] = {
        "SWITCHGRID_API_KEY_present": bool(api_key),
        "SWITCHGRID_API_KEY_length": len(api_key) if api_key else 0,
        "SWITCHGRID_API_KEY_preview": f"{api_key[:6]}..." if api_key and len(api_key) > 6 else "MANQUANTE",
        "SWITCHGRID_BASE_URL": current_app.config.get("SWITCHGRID_BASE_URL"),
        "SWITCHGRID_API_VERSION": current_app.config.get("SWITCHGRID_API_VERSION"),
        "SWITCHGRID_TEST_ENV": current_app.config.get("SWITCHGRID_TEST_ENV"),
        "SWITCHGRID_WEBHOOK_PATH_TOKEN_present": bool(webhook_token),
        "status": "OK" if api_key else "ERREUR — SWITCHGRID_API_KEY manquante dans .env",
    }

    if not api_key:
        report["overall_status"] = "FAILED — clé API manquante"
        return jsonify(report), 500

    # --- Étape 2 : Instanciation du client ----------------------------
    try:
        client = get_switchgrid_client()
        report["step_2_client_init"] = {"status": "OK", "client_class": type(client).__name__}
    except Exception as exc:
        report["step_2_client_init"] = {"status": f"ERREUR : {exc}"}
        report["overall_status"] = "FAILED — impossible d'instancier SwitchgridClient"
        return jsonify(report), 500

    # --- Étape 3 : Appel API réel (GET /ask?limit=1) ------------------
    t0 = time.monotonic()
    try:
        response = client.get("/ask", params={"limit": 1})
        latency_ms = round((time.monotonic() - t0) * 1000)

        report["step_3_api_call"] = {
            "status": "OK",
            "http_status": response.status_code,
            "latency_ms": latency_ms,
            "response_preview": str(response.json())[:300],
        }
    except SwitchgridAuthError as exc:
        report["step_3_api_call"] = {
            "status": "ERREUR AUTH (401/403)",
            "detail": str(exc),
            "cause_probable": "Clé API invalide, expirée, ou format Bearer incorrect.",
        }
        report["overall_status"] = "FAILED — authentification refusée"
        return jsonify(report), 401
    except SwitchgridTimeoutError as exc:
        report["step_3_api_call"] = {
            "status": "TIMEOUT",
            "detail": str(exc),
            "cause_probable": "API Switchgrid injoignable depuis ce réseau (firewall, proxy ?).",
        }
        report["overall_status"] = "FAILED — timeout"
        return jsonify(report), 504
    except SwitchgridConnectionError as exc:
        report["step_3_api_call"] = {
            "status": "ERREUR CONNEXION",
            "detail": str(exc),
            "cause_probable": "DNS non résolu ou connexion TCP refusée.",
        }
        report["overall_status"] = "FAILED — connexion impossible"
        return jsonify(report), 503
    except SwitchgridError as exc:
        report["step_3_api_call"] = {
            "status": f"ERREUR HTTP {exc.status_code}",
            "detail": str(exc),
            "payload": exc.payload,
        }
        report["overall_status"] = f"FAILED — erreur API HTTP {exc.status_code}"
        return jsonify(report), 502

    # --- Étape 4 : Headers envoyés ------------------------------------
    sent_headers = dict(client._session.headers)
    # Masquer la valeur réelle de l'Authorization pour la sécurité du rapport
    if "Authorization" in sent_headers:
        auth_val = sent_headers["Authorization"]
        sent_headers["Authorization"] = (
            auth_val[:15] + "..." if len(auth_val) > 15 else auth_val
        )
    report["step_4_headers"] = {
        "sent_to_switchgrid": sent_headers,
        "test_env_active": "switchgrid-test-env" in sent_headers,
    }

    report["overall_status"] = "OK — API Switchgrid joignable et clé valide ✓"
    return jsonify(report), 200


# ------------------------------------------------------------------ #
# 2. État de tous les orders en base
# ------------------------------------------------------------------ #

@switchgrid_debug_bp.route("/orders", methods=["GET"])
def debug_list_orders():
    """
    Liste tous les orders en base avec leur statut et leurs requests.
    Utile pour repérer rapidement un order bloqué en PENDING.

    Appel : GET /api/switchgrid/debug/orders
    """
    block = _check_debug_allowed()
    if block:
        return block

    from app.models.switchgrid import SwitchgridOrder

    orders = SwitchgridOrder.query.order_by(SwitchgridOrder.created_at.desc()).limit(20).all()
    result = []
    for order in orders:
        requests_info = [
            {
                "internal_id": r.id,
                "type": r.request_type,
                "prm": r.prm,
                "status": r.status,
                "has_data": r.raw_dataset is not None,
                "error": r.error_message,
            }
            for r in order.requests.all()
        ]
        result.append({
            "internal_id": order.id,
            "switchgrid_order_id": order.switchgrid_order_id,
            "status": order.status,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "requests": requests_info,
        })

    return jsonify({"orders": result, "count": len(result)})


# ------------------------------------------------------------------ #
# 3. Données brutes d'une request spécifique
# ------------------------------------------------------------------ #

@switchgrid_debug_bp.route("/raw/<request_id>", methods=["GET"])
def debug_raw_dataset(request_id: str):
    """
    Affiche le JSON brut stocké pour une SwitchgridRequest donnée.
    Permet de vérifier la structure réelle du JSON Enedis avant
    d'ajuster le mapping dans mapping.py.

    Appel : GET /api/switchgrid/debug/raw/<request_internal_id>
    """
    block = _check_debug_allowed()
    if block:
        return block

    from app.models.switchgrid import SwitchgridRawDataset

    dataset = SwitchgridRawDataset.query.filter_by(request_id=request_id).first_or_404()
    return jsonify({
        "request_id": request_id,
        "downloaded_at": dataset.downloaded_at.isoformat() if dataset.downloaded_at else None,
        "content_json": dataset.content_json,
    })