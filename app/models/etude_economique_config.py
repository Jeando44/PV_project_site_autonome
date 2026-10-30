"""
Modèle EtudeEconomiqueConfig - Configuration et sauvegarde de l'étude économique du projet
"""
from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant

class EtudeEconomiqueConfig(db.Model):
    """Modèle pour stocker la configuration de l'étude économique"""
    __tablename__ = 'etudes_economiques_configs'

    id = db.Column(db.Integer, primary_key=True)
    
    # Liaison One-to-One avec le Projet (un seul paramétrage par projet)
    projet_id = db.Column(
        db.Integer, 
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_etudes_economiques_configs_projet_id'), 
        nullable=False,
        unique=True,
        index=True
    )
    
    # Stockage complet des valeurs du formulaire (inputs, radios, checkboxes, tableaux dynamiques)
    data = db.Column(db.JSON, nullable=False, default=dict)
    
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'projet_id': self.projet_id,
            'data': self.data
        }