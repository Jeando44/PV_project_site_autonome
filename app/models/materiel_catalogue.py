"""
Modèle MaterielCatalogue - Catalogue des équipements techniques
"""
from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant

class MaterielCatalogue(db.Model):
    """Modèle pour stocker les matériels et équipements techniques (Panneaux, Onduleurs, Batteries, Bornes)"""
    __tablename__ = 'materiels_catalogue'

    id = db.Column(db.Integer, primary_key=True)
    
    # 'panneau' | 'onduleur' | 'batterie' | 'borne_recharge'
    type_equipement = db.Column(db.String(50), nullable=False, index=True)
    
    fabricant = db.Column(db.String(100), nullable=False)
    reference = db.Column(db.String(150), unique=True, nullable=False, index=True)
    
    # Caractéristiques techniques spécifiques au format JSON (ex: {puissance_wc: 400, vmp: 31.0, etc.})
    caracteristiques_techniques = db.Column(db.JSON, nullable=False, default=dict)
    
    prix_ht = db.Column(db.Float, nullable=True, default=0.0)
    is_active = db.Column(db.Boolean, default=True, index=True)
    
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        """Convertir en dictionnaire pour JSON"""
        return {
            'id': self.id,
            'type_equipement': self.type_equipement,
            'fabricant': self.fabricant,
            'reference': self.reference,
            'caracteristiques_techniques': self.caracteristiques_techniques,
            'prix_ht': self.prix_ht,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }