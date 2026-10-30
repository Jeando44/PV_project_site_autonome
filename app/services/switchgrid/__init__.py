"""
Point d'entrée du package services.switchgrid.

Expose `get_switchgrid_client()` qui retourne une instance partagée du client,
construite à partir de la config Flask (current_app.config), pour éviter
de recréer une session HTTP (et ses connexions TCP) à chaque appel.
"""
from __future__ import annotations

from flask import current_app, g

from .client import SwitchgridClient

__all__ = ["SwitchgridClient", "get_switchgrid_client"]


def get_switchgrid_client() -> SwitchgridClient:
    """
    Retourne une instance de SwitchgridClient, créée une seule fois par
    contexte de requête Flask (via `flask.g`), configurée depuis
    `current_app.config`.

    Nécessite dans la config :
        SWITCHGRID_API_KEY
        SWITCHGRID_BASE_URL        (optionnel, défaut api.switchgrid.tech)
        SWITCHGRID_API_VERSION     (optionnel, défaut "v0")
        SWITCHGRID_TEST_ENV        (bool, optionnel, défaut False)
    """
    if "switchgrid_client" not in g:
        api_key = current_app.config.get("SWITCHGRID_API_KEY")
        if not api_key:
            raise RuntimeError(
                "SWITCHGRID_API_KEY n'est pas configurée. "
                "Vérifiez votre fichier .env et app/config.py."
            )

        g.switchgrid_client = SwitchgridClient(
            api_key=api_key,
            base_url=current_app.config.get(
                "SWITCHGRID_BASE_URL", "https://api.switchgrid.tech"
            ),
            api_version=current_app.config.get("SWITCHGRID_API_VERSION", "v0"),
            test_env=current_app.config.get("SWITCHGRID_TEST_ENV", False),
        )
    return g.switchgrid_client