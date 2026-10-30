"""
Modèles du configurateur « Petit champ solaire » : paramétrage persistant par champ PV et quota de
génération du dossier de plans de conception.

Table dédiée plutôt que GeometrieProjet : la sauvegarde globale du calepinage
(concevoir_mon_projet.py, synchronisation de geometriePlansData) SUPPRIME puis recrée toutes les
lignes de GeometrieProjet du projet ; un paramétrage rangé là serait effacé à chaque sauvegarde.
"""
from datetime import datetime
from app.utils.dates import utc_maintenant

from app.extensions import db


class PetitChampParametres(db.Model):
    """Saisies du configurateur (format GeometrieStructureStorageManager.collectData()), validées."""
    __tablename__ = "petit_champ_parametres"
    __table_args__ = (db.UniqueConstraint("projet_id", "pv_id", name="uq_petit_champ_parametres_projet_pv"),)

    id = db.Column(db.Integer, primary_key=True)
    projet_id = db.Column(
        db.Integer, db.ForeignKey("parametres_projet.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    pv_id = db.Column(db.String(50), nullable=False)
    parametres = db.Column(db.JSON, nullable=False)
    # Réglages du dossier de plans (indice, pièces, page Réglementation) : partagés par le projet,
    # rangés sur la ligne du champ PV concerné.
    dossier = db.Column(db.JSON, nullable=True)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            "projet_id": self.projet_id,
            "pv_id": self.pv_id,
            "parametres": self.parametres,
            "dossier": self.dossier,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class PetitChampDossierQuota(db.Model):
    """
    Nombre de générations du dossier de plans par projet (demande : 3 par projet). Une génération
    couvre tous les téléchargements qui la suivent (PDF complet, ZIP, pièce seule) tant que les
    saisies ne changent pas ; modifier puis regénérer consomme une nouvelle génération.
    """
    __tablename__ = "petit_champ_dossier_quotas"

    projet_id = db.Column(
        db.Integer, db.ForeignKey("parametres_projet.id", ondelete="CASCADE"), primary_key=True,
    )
    generation_count = db.Column(db.Integer, nullable=False, default=0)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)
