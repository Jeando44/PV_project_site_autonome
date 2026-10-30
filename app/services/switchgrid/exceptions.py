"""
Exceptions métier pour l'intégration Switchgrid.

Le but est que les couches au-dessus (routes, services métier PV) ne dépendent
jamais directement de `requests.exceptions.*`. Toute la traduction HTTP -> métier
se fait dans client.py.
"""
from __future__ import annotations

from typing import Any, Optional


class SwitchgridError(Exception):
    """Exception de base pour toute erreur liée à Switchgrid."""

    def __init__(self, message: str, *, status_code: Optional[int] = None,
                 payload: Optional[Any] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.payload = payload

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(message={self.message!r}, status_code={self.status_code})"


class SwitchgridAuthError(SwitchgridError):
    """Token invalide, expiré, ou absent (401/403)."""


class SwitchgridNotFoundError(SwitchgridError):
    """Ressource introuvable (404) : ask, order, request inexistant."""


class SwitchgridValidationError(SwitchgridError):
    """Requête mal formée, rejetée par Switchgrid (400/422)."""


class SwitchgridRateLimitError(SwitchgridError):
    """Trop de requêtes (429)."""


class SwitchgridServerError(SwitchgridError):
    """Erreur côté Switchgrid (5xx)."""


class SwitchgridTimeoutError(SwitchgridError):
    """Timeout réseau ou de lecture lors de l'appel à Switchgrid."""


class SwitchgridConnectionError(SwitchgridError):
    """Impossible de joindre l'API Switchgrid (DNS, TCP, TLS...)."""


class SwitchgridDataNotReadyError(SwitchgridError):
    """
    Cas métier spécifique : l'order/request existe mais les données ne sont
    pas encore disponibles (status PENDING / QUEUED / NOT_STARTED).
    Ce n'est pas une erreur HTTP, donc on la distingue volontairement.
    """


class SwitchgridLoadcurveNotActivatedError(SwitchgridError):
    """
    Cas métier très fréquent en première demande R63 :
    "aucun service souscrit de courbe de charge n'est présent..."
    Switchgrid active alors automatiquement la collecte Enedis ;
    il faut réessayer plus tard (idéalement via enedisRetryAfterLoadcurveActivation=True).
    """