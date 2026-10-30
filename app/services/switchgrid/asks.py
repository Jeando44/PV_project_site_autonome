"""
Service : gestion des consentements (`Ask`) Enedis.

Endpoints v0 :
    POST   /ask
    GET    /ask/{askId}
    GET    /ask                (liste, filtrable par status / prm)
    POST   /ask/{askId}/revoke
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from .client import SwitchgridClient
from .exceptions import SwitchgridValidationError

# Durée de consentement par défaut, alignée sur le besoin de dimensionnement PV
# (analyse de consommation historique + suivi post-installation).
DEFAULT_CONSENT_DURATION = "3 years"
DEFAULT_PURPOSE = "SOLAR_INSTALLATION_SIZING"


def build_electricity_contract_from_search(contract_uuid: str) -> str:
    """Cas recommandé : on a un uuid issu de GET search_contract."""
    return contract_uuid


def build_electricity_contract_manual(
    prm: str,
    holder_full_name: Optional[str] = None,
    holder_company_name: Optional[str] = None,
    holder_siren: Optional[str] = None,
    address_rue: str = "",
    address_code_postal: str = "",
    address_commune: str = "",
) -> Dict[str, Any]:
    """
    Cas de repli : aucun résultat fiable depuis search_contract (nom orthographié
    différemment chez Enedis, raison sociale tronquée, etc.). On décrit alors
    le contrat manuellement. Soit holder_full_name (personne physique),
    soit holder_company_name (personne morale), pas les deux.
    """
    if not prm or len(prm) != 14 or not prm.isdigit():
        raise SwitchgridValidationError("Le PRM doit être un identifiant à 14 chiffres.")

    if holder_company_name:
        holder = {"_tag": "LegalEntity", "name": holder_company_name}
        if holder_siren:
            holder["siren"] = holder_siren
    elif holder_full_name:
        holder = {"_tag": "NaturalPerson", "fullName": holder_full_name}
    else:
        raise SwitchgridValidationError(
            "Il faut fournir holder_full_name ou holder_company_name."
        )

    return {
        "_energyType": "electricity",
        "deliveryPointId": prm,
        "holder": holder,
        "address": {
            "rueEtNumero": address_rue,
            "codePostal": address_code_postal,
            "commune": address_commune,
        },
    }


def create_ask(
    client: SwitchgridClient,
    contracts: List[Union[str, Dict[str, Any]]],
    signer_first_name: str,
    signer_last_name: str,
    purposes: Optional[List[str]] = None,
    consent_duration: str = DEFAULT_CONSENT_DURATION,
    redirect_to: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Crée une demande de consentement (`Ask`).

    `contracts` est une liste d'uuid (issus de search_contract, recommandé)
    et/ou de dicts (build_electricity_contract_manual).

    Retourne le payload Switchgrid contenant notamment :
        - id (askId)
        - status ("PENDING_USER_ACTION" typiquement à la création)
        - consentCollectionDetails.userUrl  (lien de signature à transmettre au client)

    `redirect_to`, si fourni, est ajouté en query param à `userUrl` côté
    présentation (pas dans ce payload) — voir routes/switchgrid_routes.py.
    """
    if not contracts:
        raise SwitchgridValidationError("Il faut au moins un contrat dans 'contracts'.")

    body: Dict[str, Any] = {
        "contracts": contracts,
        "signer": {"firstName": signer_first_name, "lastName": signer_last_name},
        "purposes": purposes or [DEFAULT_PURPOSE],
        "consentDuration": consent_duration,
    }

    response = client.post("/ask", json_body=body)
    data = response.json()

    if redirect_to and data.get("consentCollectionDetails", {}).get("userUrl"):
        sep = "&" if "?" in data["consentCollectionDetails"]["userUrl"] else "?"
        data["consentCollectionDetails"]["userUrl"] += f"{sep}redirectTo={redirect_to}"

    return data


def get_ask(client: SwitchgridClient, ask_id: str) -> Dict[str, Any]:
    """Consulte le statut d'un Ask et la liste des Consents associés."""
    response = client.get(f"/ask/{ask_id}")
    return response.json()


def list_asks(
    client: SwitchgridClient,
    status: Optional[str] = None,
    prm: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Liste les Asks, filtrable par statut et/ou PRM."""
    params: Dict[str, str] = {}
    if status:
        params["status"] = status
    if prm:
        params["prm"] = prm
    response = client.get("/ask", params=params or None)
    data = response.json()
    return data.get("results", data) if isinstance(data, dict) else data


def revoke_ask(client: SwitchgridClient, ask_id: str) -> Dict[str, Any]:
    """
    Révoque un Ask (et tous les consentements associés). Non partiellement
    réversible : impossible de ne révoquer qu'un sous-ensemble de PRM.
    """
    response = client.post(f"/ask/{ask_id}/revoke")
    return response.json()