"""
Modèle PersonnalisationRapport - Profil de personnalisation du rapport PDF (par utilisateur)

Remplace/étend l'ancien mécanisme localStorage-only (clé 'skv_company_info', jamais persistée
côté serveur) — utilisé pour personnaliser la page de garde et les pages additionnelles du
rapport PDF des projets de typologie Résidentielle (cf. PdfResidentialReportGenerator.js).

Pas de table `User` locale dans cette application (authentification externe/SSO) : `user_id`
mirrore le pattern déjà utilisé par `ParametreProjet.created_by` (chaîne, pas de clé étrangère).
"""
from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant


class PersonnalisationRapport(db.Model):
    """Profil de personnalisation du rapport (identité, branding, textes, statistiques)"""
    __tablename__ = 'personnalisation_rapport'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(36), nullable=False, unique=True, index=True)

    # Identité / branding
    logo_base64 = db.Column(db.Text, nullable=True)
    nom_entreprise = db.Column(db.String(200), nullable=True)
    telephone = db.Column(db.String(50), nullable=True)
    adresse = db.Column(db.String(300), nullable=True)
    email = db.Column(db.String(200), nullable=True)
    site_web = db.Column(db.String(300), nullable=True)
    # Prénom & nom du/de la chargé(e) d'affaires (page de garde, devis, page « Passez à l'action »).
    charge_affaires = db.Column(db.String(100), nullable=True)

    # Contenu de la page "Notre entreprise" (Résidentielle uniquement) — bornage (mots/valeurs)
    # appliqué côté app (client ET serveur), pas au niveau de la colonne.
    mission_text = db.Column(db.String(400), nullable=True)
    services_text = db.Column(db.String(400), nullable=True)
    stat_installations = db.Column(db.Integer, nullable=True)
    stat_annees_experience = db.Column(db.Integer, nullable=True)
    stat_clients_satisfaits_pct = db.Column(db.Integer, nullable=True)

    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'logo_base64': self.logo_base64,
            'nom_entreprise': self.nom_entreprise,
            'telephone': self.telephone,
            'adresse': self.adresse,
            'email': self.email,
            'site_web': self.site_web,
            'charge_affaires': self.charge_affaires,
            'mission_text': self.mission_text,
            'services_text': self.services_text,
            'stat_installations': self.stat_installations,
            'stat_annees_experience': self.stat_annees_experience,
            'stat_clients_satisfaits_pct': self.stat_clients_satisfaits_pct,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
