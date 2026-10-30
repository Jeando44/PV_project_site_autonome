"""
Modèle IrveConfig - Configuration et sauvegarde de l'étude IRVE du projet
"""
from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant

class IrveConfig(db.Model):
    """Modèle pour stocker la configuration et les résultats de la modale IRVE"""
    __tablename__ = 'irve_configs'

    id = db.Column(db.Integer, primary_key=True)
    
    # Liaison One-to-One avec le Projet (un seul paramétrage par projet)
    projet_id = db.Column(
        db.Integer, 
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_irve_configs_projet_id'), 
        nullable=False,
        unique=True,
        index=True
    )
    
    # Stockage complet des valeurs de la page IRVE (inputs, radios, checkboxes, tables)
    data = db.Column(db.JSON, nullable=False, default=dict)

    # Courbe de charge IRVE calculée (résolution native au pas de temps choisi), séparée de `data`
    # qui reste l'état brut du formulaire : {pas_temps_min, existing[], irve[], total[], has_existing}.
    # Remplace la synchronisation par localStorage (stagedIrveData/sharedIrveData), peu fiable.
    load_curve = db.Column(db.JSON, nullable=True)

    # Saisies de la section « 3. Rentabilité économique du projet IRVE » et frises heures creuses /
    # de pointe : {v, etat, champs, horo}. Validées par RentabiliteIrveSauvegarde (irve_schemas.py).
    rentabilite = db.Column(db.JSON, nullable=True)

    # Courbe de consommation du module PAC / climatiseur (heure murale, 365 jours, pas natif) :
    # {pas_temps_min, annee, pac[], pac_ecs_solaire[]|None, bilan_pac_kwh, resume, enregistre_le,
    # autoconso_pac}. Colonne séparée de load_curve, que save-curve IRVE remplace en entier. Pas
    # reprise dans to_dict() : GET .../irve/load (relu à chaque ouverture de la modale) n'en a pas
    # besoin — cf. GET .../pac/curve-info.
    courbe_pac = db.Column(db.JSON, nullable=True)

    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'projet_id': self.projet_id,
            'data': self.data,
            'load_curve': self.load_curve,
            'rentabilite': self.rentabilite
        }