"""
Modèle PompageSolaireConfig - Saisies et dernier calcul du module Pompage solaire, par projet.

Remplace la clé localStorage globale `solarPumpData`, partagée par TOUS les projets d'un même
navigateur : un dimensionnement saisi sur un projet réapparaissait dans les autres. La ligne est
rattachée au projet (unique, suppression en cascade) ; l'appartenance du projet à l'utilisateur
est vérifiée par chaque route (cf. _get_project_with_permission).
"""
from datetime import datetime
from app.utils.dates import utc_maintenant

from app.extensions import db


class PompageSolaireConfig(db.Model):
    __tablename__ = 'pompage_solaire_configs'

    id = db.Column(db.Integer, primary_key=True)
    projet_id = db.Column(
        db.Integer,
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_pompage_solaire_configs_projet_id'),
        nullable=False,
        unique=True,
        index=True,
    )
    # {"champs": {id_champ: valeur}, "integration_calepinage": bool} — validé par
    # app/schemas/pompage_solaire_schemas.py::PompageSolaireSauvegarde.
    saisies = db.Column(db.JSON, nullable=False, default=dict)
    # Dernier calcul (dimensionnement, analyse économique, production du calepinage), réaffiché à la
    # réouverture du projet. Recalculé côté navigateur : sert à l'affichage, jamais de référence.
    resultats = db.Column(db.JSON, nullable=True)
    # Utilisateur ayant fait la dernière sauvegarde (traçabilité ; le propriétaire reste
    # parametres_projet.created_by).
    updated_by = db.Column(db.String(36), nullable=True)

    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'projet_id': self.projet_id,
            'saisies': self.saisies or {},
            'resultats': self.resultats,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
