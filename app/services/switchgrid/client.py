"""
Client HTTP bas niveau pour l'API Switchgrid (v0).

Ce module ne contient AUCUNE logique métier PV. Il sait uniquement :
- s'authentifier
- envoyer des requêtes avec les bons headers
- gérer timeouts / retries
- traduire les erreurs HTTP en exceptions métier Switchgrid

Toute la logique métier (search_contract, create_ask, create_order, ...)
est dans les modules contracts.py / asks.py / orders.py qui utilisent
une instance partagée de SwitchgridClient.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .exceptions import (
    SwitchgridAuthError,
    SwitchgridConnectionError,
    SwitchgridError,
    SwitchgridNotFoundError,
    SwitchgridRateLimitError,
    SwitchgridServerError,
    SwitchgridTimeoutError,
    SwitchgridValidationError,
)

logger = logging.getLogger("switchgrid.client")

DEFAULT_BASE_URL = "https://api.switchgrid.tech"
DEFAULT_API_VERSION = "v0"
DEFAULT_CONNECT_TIMEOUT = 5  # secondes
DEFAULT_READ_TIMEOUT = 30  # secondes — C68 répond en <10s, mais on laisse de la marge
MAX_RETRIES = 3
BACKOFF_FACTOR = 1.5


class SwitchgridClient:
    """
    Wrapper HTTP pour l'API Switchgrid.

    Usage:
        client = SwitchgridClient(api_key="...", test_env=False)
        response = client.request("GET", "/integration/enedis/search_contract", params={...})

    Le client est conçu pour être instancié une fois (singleton applicatif via
    `get_switchgrid_client()` dans __init__.py) et réutilisé : `requests.Session`
    gère le keep-alive des connexions.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        api_version: str = DEFAULT_API_VERSION,
        test_env: bool = False,
        connect_timeout: int = DEFAULT_CONNECT_TIMEOUT,
        read_timeout: int = DEFAULT_READ_TIMEOUT,
        max_retries: int = MAX_RETRIES,
    ):
        if not api_key:
            raise ValueError("SwitchgridClient nécessite une api_key non vide.")

        self.base_url = base_url.rstrip("/")
        self.api_version = api_version
        self.test_env = test_env
        self.timeout = (connect_timeout, read_timeout)

        self._session = requests.Session()
        self._session.headers.update(self._build_default_headers(api_key))

        # Retries automatiques uniquement sur erreurs réseau/5xx/429,
        # jamais sur 4xx métier (qui doivent être traitées explicitement).
        retry_strategy = Retry(
            total=max_retries,
            backoff_factor=BACKOFF_FACTOR,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=frozenset(["GET", "POST", "DELETE", "PUT", "PATCH"]),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self._session.mount("https://", adapter)
        self._session.mount("http://", adapter)

    def _build_default_headers(self, api_key: str) -> Dict[str, str]:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "x-api-version": self.api_version,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if self.test_env:
            # Ce header n'a d'effet documenté que sur POST /ask : il n'est PAS
            # un remplacement de l'API key et ne dispense pas de l'Authorization.
            headers["switchgrid-test-env"] = "true"
        return headers

    # ------------------------------------------------------------------ #
    # Méthode générique
    # ------------------------------------------------------------------ #

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Any]] = None,
        extra_headers: Optional[Dict[str, str]] = None,
        expected_status: Optional[set] = None,
    ) -> requests.Response:
        """
        Effectue une requête HTTP vers l'API Switchgrid et lève une exception
        métier appropriée en cas d'erreur. Retourne la `requests.Response` brute
        en cas de succès (laisse l'appelant décider du parsing).
        """
        url = f"{self.base_url}{path}"
        log_ctx = {"method": method, "path": path}

        start = time.monotonic()
        try:
            response = self._session.request(
                method=method,
                url=url,
                params=params,
                json=json_body if files is None else None,
                data=json_body if files is not None else None,
                files=files,
                headers=extra_headers,
                timeout=self.timeout,
            )
        except requests.exceptions.Timeout as exc:
            logger.warning("Timeout Switchgrid %s", log_ctx)
            raise SwitchgridTimeoutError(
                f"Timeout lors de l'appel à Switchgrid ({method} {path})"
            ) from exc
        except requests.exceptions.ConnectionError as exc:
            logger.error("Erreur de connexion Switchgrid %s", log_ctx)
            raise SwitchgridConnectionError(
                f"Impossible de joindre l'API Switchgrid ({method} {path})"
            ) from exc
        finally:
            duration_ms = round((time.monotonic() - start) * 1000)
            logger.info("Switchgrid %s %s -> %sms", method, path, duration_ms)

        self._raise_for_status(response, expected_status=expected_status)
        return response

    def get(self, path: str, **kwargs) -> requests.Response:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs) -> requests.Response:
        return self.request("POST", path, **kwargs)

    def delete(self, path: str, **kwargs) -> requests.Response:
        return self.request("DELETE", path, **kwargs)

    # ------------------------------------------------------------------ #
    # Téléchargement de données (dataUrl signées, hors domaine api.switchgrid.tech)
    # ------------------------------------------------------------------ #

    def download_data_url(self, data_url: str) -> requests.Response:
        """
        Télécharge le contenu d'une URL signée (`dataUrl` / `dataUrls`) renvoyée
        par GET /order/{id}. Ces URLs sont auto-suffisantes (signature dans
        la query string) : on n'y rajoute PAS les headers d'auth Switchgrid.
        """
        try:
            response = requests.get(data_url, timeout=self.timeout)
        except requests.exceptions.Timeout as exc:
            raise SwitchgridTimeoutError(
                "Timeout lors du téléchargement des données Switchgrid"
            ) from exc
        except requests.exceptions.ConnectionError as exc:
            raise SwitchgridConnectionError(
                "Impossible de télécharger les données Switchgrid"
            ) from exc

        if response.status_code >= 400:
            raise SwitchgridError(
                f"Échec du téléchargement des données (HTTP {response.status_code})",
                status_code=response.status_code,
            )
        return response

    # ------------------------------------------------------------------ #
    # Gestion des erreurs
    # ------------------------------------------------------------------ #

    @staticmethod
    def _raise_for_status(response: requests.Response, expected_status: Optional[set]) -> None:
        if expected_status and response.status_code in expected_status:
            return
        if response.status_code < 400:
            return

        try:
            payload = response.json()
        except ValueError:
            payload = {"raw": response.text}

        status = response.status_code
        message = (
            payload.get("message")
            or payload.get("error")
            or f"Erreur Switchgrid HTTP {status}"
            if isinstance(payload, dict)
            else f"Erreur Switchgrid HTTP {status}"
        )

        if status in (401, 403):
            raise SwitchgridAuthError(message, status_code=status, payload=payload)
        if status == 404:
            raise SwitchgridNotFoundError(message, status_code=status, payload=payload)
        if status == 422 or status == 400:
            raise SwitchgridValidationError(message, status_code=status, payload=payload)
        if status == 429:
            raise SwitchgridRateLimitError(message, status_code=status, payload=payload)
        if status >= 500:
            raise SwitchgridServerError(message, status_code=status, payload=payload)

        raise SwitchgridError(message, status_code=status, payload=payload)