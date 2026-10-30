"""
Modèles des dossiers de plans « Toitures » et « Mixte » (parcours Chiffrage) : réglages du dossier
(un par projet ET par type de dossier) et quota de génération.

Même modal et mêmes réglages que le dossier des ombrières (app/models/ombriere_dossier.py), mais un
compteur de générations PROPRE à chaque type de dossier (décision du 2026-10-10 : quota séparé,
5 par projet pour les toitures, 5 pour le mixte). `type_dossier` ∈ TYPES_DOSSIER
(app/services/dossier_plans).
"""
from datetime import datetime
from app.utils.dates import utc_maintenant

from app.extensions import db


class DossierPlans(db.Model):
    """Réglages du dossier (indice, maître d'ouvrage, pièces, champs exclus, Réglementation)."""
    __tablename__ = "dossier_plans"

    projet_id = db.Column(
        db.Integer, db.ForeignKey("parametres_projet.id", ondelete="CASCADE"), primary_key=True,
    )
    type_dossier = db.Column(db.String(20), primary_key=True)
    dossier = db.Column(db.JSON, nullable=False)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)


class DossierPlansQuota(db.Model):
    """Nombre de générations par projet et par type de dossier."""
    __tablename__ = "dossier_plans_quotas"

    projet_id = db.Column(
        db.Integer, db.ForeignKey("parametres_projet.id", ondelete="CASCADE"), primary_key=True,
    )
    type_dossier = db.Column(db.String(20), primary_key=True)
    generation_count = db.Column(db.Integer, nullable=False, default=0)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)
