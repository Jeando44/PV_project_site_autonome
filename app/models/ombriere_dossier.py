"""
Modèles du dossier de plans de conception « Ombrières » : réglages du dossier (un par projet, il
couvre toutes les ombrières) et quota de génération.

Tables dédiées plutôt que GeometrieProjet : la sauvegarde globale du calepinage supprime puis
recrée toutes les lignes de GeometrieProjet du projet (cf. app/models/petit_champ_solaire.py).
"""
from datetime import datetime
from app.utils.dates import utc_maintenant

from app.extensions import db


class OmbriereDossier(db.Model):
    """Réglages du dossier (indice, maître d'ouvrage, pièces, champs exclus, Réglementation)."""
    __tablename__ = "ombriere_dossiers"

    projet_id = db.Column(
        db.Integer, db.ForeignKey("parametres_projet.id", ondelete="CASCADE"), primary_key=True,
    )
    dossier = db.Column(db.JSON, nullable=False)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)


class OmbriereDossierQuota(db.Model):
    """Nombre de générations du dossier par projet (3 par projet, compteur distinct du petit champ)."""
    __tablename__ = "ombriere_dossier_quotas"

    projet_id = db.Column(
        db.Integer, db.ForeignKey("parametres_projet.id", ondelete="CASCADE"), primary_key=True,
    )
    generation_count = db.Column(db.Integer, nullable=False, default=0)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)
