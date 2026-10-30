"""
Modèle ProjetRevision - Sauvegarde historique des variantes/indices d'un projet
"""
from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant

class ProjetRevision(db.Model):
    """Modèle pour stocker un instantané (snapshot) complet d'un indice/variante de projet"""
    __tablename__ = 'projets_revisions'
    # Une seule copie par lettre et par projet (deux créations simultanées ne doivent pas produire deux B).
    __table_args__ = (db.UniqueConstraint('projet_id', 'indice', name='uq_projets_revisions_projet_indice'),)

    id = db.Column(db.Integer, primary_key=True)
    
    # Liaison One-to-Many avec le projet parent
    projet_id = db.Column(
        db.Integer, 
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_projets_revisions_projet_id'), 
        nullable=False,
        index=True
    )
    
    # 'A', 'B', 'C', 'D'
    indice = db.Column(db.String(10), nullable=False, index=True)
    description = db.Column(db.String(255), nullable=True)
    
    # Copie complète de l'état de conception (format 2, cf. app/services/variantes_projet.py :
    # calepinage résidentiel, géométries, IRVE, éco, chiffrage, pompage, petit champ, ombrières).
    # Seule source lue à l'ouverture d'une variante. NULL = copie d'avant le format 2, non restaurable.
    donnees = db.Column(db.JSON, nullable=True)

    # Ancien format (avant 2026-10-09) : sans calepinage résidentiel, conservé en lecture seule.
    calepinage_data = db.Column(db.JSON, nullable=True)
    geometrie_plans_data = db.Column(db.JSON, nullable=True)
    irve_data = db.Column(db.JSON, nullable=True)
    etude_economique_data = db.Column(db.JSON, nullable=True)
    # Module Pompage solaire : {saisies, resultats} (cf. PompageSolaireConfig).
    pompage_solaire_data = db.Column(db.JSON, nullable=True)
    
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    @property
    def restaurable(self):
        from app.services.variantes_projet import copie_restaurable
        return copie_restaurable(self.donnees)

    def to_dict(self):
        return {
            'id': self.id,
            'projet_id': self.projet_id,
            'indice': self.indice,
            'description': self.description,
            'restaurable': self.restaurable,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }