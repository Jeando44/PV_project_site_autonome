"""
Quota de génération des dossiers « Toitures » et « Mixte » : un compteur PAR TYPE de dossier et par
projet (limite = limites.json des ombrières > dossier.generationsParProjet, soit 5), illimité pour
un administrateur. Même principe que app/services/ombrieres_dossier/quota.py.
"""
from __future__ import annotations

from typing import Optional, Tuple

from app.extensions import db
from app.models.dossier_plans import DossierPlansQuota
from app.services.dossier_plans import TYPES_DOSSIER
from app.services.ombrieres_dossier.quota import limite_generations


def _quota(projet_id: int, type_dossier: str, creer: bool) -> Optional[DossierPlansQuota]:
    quota = db.session.get(DossierPlansQuota, (projet_id, type_dossier))
    if quota is None and creer:
        quota = DossierPlansQuota(projet_id=projet_id, type_dossier=type_dossier, generation_count=0)
        db.session.add(quota)
    return quota


def verifier_et_enregistrer(user: dict, projet_id: int, type_dossier: str) -> Tuple[bool, Optional[str]]:
    """(autorisé, message d'erreur). N'incrémente rien en cas de refus."""
    if user and user.get("is_admin"):
        return True, None
    limite = limite_generations()
    quota = _quota(projet_id, type_dossier, creer=True)
    if quota.generation_count >= limite:
        db.session.rollback()
        return False, (
            f"Quota atteint : {limite} générations du {TYPES_DOSSIER[type_dossier]} par projet. "
            "Les dossiers déjà générés restent téléchargeables tant que la page n'est pas rechargée."
        )
    quota.generation_count += 1
    db.session.commit()
    return True, None


def etat(user: dict, projet_id: int, type_dossier: str) -> dict:
    limite = None if (user and user.get("is_admin")) else limite_generations()
    quota = _quota(projet_id, type_dossier, creer=False)
    utilisees = quota.generation_count if quota else 0
    return {
        "limite": limite,
        "utilisees": utilisees,
        "restantes": None if limite is None else max(0, limite - utilisees),
    }
