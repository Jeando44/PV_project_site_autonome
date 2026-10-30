"""
Modèle NormeCalcul - Gestion des normes et modes de calcul
"""
from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant


class NormeCalcul(db.Model):
    """Modèle pour les normes et modes de calcul"""
    __tablename__ = 'normes_calcul'

    id = db.Column(db.Integer, primary_key=True)

    # Informations de base
    nom = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    type_etude = db.Column(db.String(100))

    # Caractéristiques réseau
    type_tension = db.Column(db.String(100))
    tension_personnalisee = db.Column(db.String(200))

    # Normes électriques
    normes_electriques = db.Column(db.Text)

    # Paramètres techniques
    chute_tension_pv = db.Column(db.Float, default=3.0)
    chute_tension_soutirage = db.Column(db.Float, default=8.0)
    temperature_minimale = db.Column(db.Float, default=-10.0)
    temperature_maximale = db.Column(db.Float, default=50.0)
    cosinus_phi = db.Column(db.Float, default=0.94)
    ratio_surdimensionnement = db.Column(db.Float, default=0.80)
    coefficient_degradation = db.Column(db.Float, default=0.25)
    incertitude_p90 = db.Column(db.Float, default=4.90)

    # Métadonnées
    is_public = db.Column(db.Boolean, default=False)
    created_by = db.Column(db.String(36), nullable=False)
    created_by_email = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    # Relations
    parametres_projets = db.relationship(
        'ParametreProjet',
        backref='norme',
        lazy='dynamic',
        foreign_keys='ParametreProjet.norme_calcul_id'
    )

    def to_dict(self):
        """Convertir en dictionnaire pour JSON"""
        return {
            'id': self.id,
            'nom': self.nom,
            'description': self.description,
            'type_etude': self.type_etude,
            'type_tension': self.type_tension,
            'tension_personnalisee': self.tension_personnalisee,
            'normes_electriques': self.normes_electriques.split(',') if self.normes_electriques else [],
            'chute_tension_pv': self.chute_tension_pv,
            'chute_tension_soutirage': self.chute_tension_soutirage,
            'temperature_minimale': self.temperature_minimale,
            'temperature_maximale': self.temperature_maximale,
            'cosinus_phi': self.cosinus_phi,
            'ratio_surdimensionnement': self.ratio_surdimensionnement,
            'coefficient_degradation': self.coefficient_degradation,
            'incertitude_p90': self.incertitude_p90,
            'is_public': self.is_public,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
