"""
Quota de génération du dossier de plans « Ombrières » : 3 générations par projet
(limites.json > dossier.generationsParProjet), illimité pour un administrateur. Compteur DISTINCT
de celui du petit champ solaire (demande explicite).

Même principe que le petit champ (app/services/petit_champ_solaire/quota.py) : vérification et
incrémentation en un seul appel, juste avant la génération ; les téléchargements d'une génération
déjà faite ne consomment rien.
"""
from __future__ import annotations

from typing import Optional, Tuple

from app.extensions import db
from app.models.ombriere_dossier import OmbriereDossierQuota
from app.services.ombrieres_dossier.validation import charger_limites


def limite_generations() -> int:
    return int(charger_limites()["dossier"]["generationsParProjet"])


def _quota(projet_id: int, creer: bool) -> Optional[OmbriereDossierQuota]:
    quota = db.session.get(OmbriereDossierQuota, projet_id)
    if quota is None and creer:
        quota = OmbriereDossierQuota(projet_id=projet_id, generation_count=0)
        db.session.add(quota)
    return quota


def verifier_et_enregistrer(user: dict, projet_id: int) -> Tuple[bool, Optional[str]]:
    """(autorisé, message d'erreur). N'incrémente rien en cas de refus."""
    if user and user.get("is_admin"):
        return True, None
    limite = limite_generations()
    quota = _quota(projet_id, creer=True)
    if quota.generation_count >= limite:
        db.session.rollback()
        return False, (
            f"Quota atteint : {limite} générations du dossier de plans des ombrières par projet. "
            "Les dossiers déjà générés restent téléchargeables tant que la page n'est pas rechargée."
        )
    quota.generation_count += 1
    db.session.commit()
    return True, None


def etat(user: dict, projet_id: int) -> dict:
    limite = None if (user and user.get("is_admin")) else limite_generations()
    quota = _quota(projet_id, creer=False)
    utilisees = quota.generation_count if quota else 0
    return {
        "limite": limite,
        "utilisees": utilisees,
        "restantes": None if limite is None else max(0, limite - utilisees),
    }
