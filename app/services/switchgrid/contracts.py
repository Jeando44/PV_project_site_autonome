"""
Service : recherche de contrat Enedis.

Endpoint v0 : POST /integration/enedis/search_contract
(le paramètre `name` doit faire >= 3 caractères, et au moins `address` ou `prm`)
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .client import SwitchgridClient
from .exceptions import SwitchgridValidationError


def search_contract(
    client: SwitchgridClient,
    name: str,
    address: Optional[str] = None,
    prm: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Recherche un contrat électrique Enedis à partir d'un nom et d'une adresse
    et/ou d'un PRM.

    Retourne la liste `results` de la réponse Switchgrid, chaque résultat
    contenant notamment :
        - id (uuid) à réutiliser tel quel dans POST /ask -> contracts
        - prm
        - nomClientFinalOuDenominationSociale
        - adresseInstallationNormalisee

    Lève SwitchgridValidationError si ni address ni prm n'est fourni, ou si
    name fait moins de 3 caractères (validation faite côté client pour
    échouer rapidement, avant l'appel réseau).
    """
    if not name or len(name.strip()) < 3:
        raise SwitchgridValidationError(
            "Le paramètre 'name' doit contenir au moins 3 caractères."
        )
    if not address and not prm:
        raise SwitchgridValidationError(
            "Il faut fournir au moins 'address' ou 'prm' pour rechercher un contrat."
        )

    body: Dict[str, Any] = {"name": name.strip()}
    if address:
        body["address"] = address.strip()
    if prm:
        body["prm"] = prm.strip()

    response = client.post("/integration/enedis/search_contract", json_body=body)
    data = response.json()
    return data.get("results", [])