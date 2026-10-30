"""
Modèle ResidentielChiffrageConfig - Chiffrage CAPEX/OPEX résidentiel (Devis) du projet.

Calque exact de EtudeEconomiqueConfig (app/models/etude_economique_config.py) : un blob JSON
unique par projet plutôt que des colonnes normalisées par poste — les 9 postes CAPEX (chacun avec
ses sous-lignes {poste, designation, reference, qte, puHt, tvaPct}), les 4 charges OPEX annuelles
et le mode d'affichage (synthétique/détaillé) sont susceptibles d'évoluer, comme pour l'étude
économique existante.

Réservé aux projets de typologie Résidentielle (cf. ResidentielEtudeEcoView.js), mais la table
elle-même n'impose aucune contrainte de typologie — elle reste simplement vide/inutilisée pour les
projets Professionnelle/Grand projet.
"""
from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant


class ResidentielChiffrageConfig(db.Model):
    """Modèle pour stocker la configuration du chiffrage résidentiel (CAPEX/OPEX/TVA) du projet"""
    __tablename__ = 'residentiel_chiffrage_configs'

    id = db.Column(db.Integer, primary_key=True)

    # Liaison One-to-One avec le Projet (un seul chiffrage résidentiel par projet)
    projet_id = db.Column(
        db.Integer,
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE',
                       name='fk_residentiel_chiffrage_configs_projet_id'),
        nullable=False,
        unique=True,
        index=True
    )

    # Stockage complet des valeurs du formulaire résidentiel : capexLines (9 postes + sous-lignes,
    # chacune avec Qté/PU HT/TVA%), opexCharges (4 charges annuelles), viewMode
    # ('synthetique'|'detaille').
    data = db.Column(db.JSON, nullable=False, default=dict)

    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'projet_id': self.projet_id,
            'data': self.data
        }
