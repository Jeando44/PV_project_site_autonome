"""
Loi APER (calculateur « Résultats Loi APER », calcul_APER.js) : saisies et polygones enregistrés en
base, par projet et par variante. Remplace les clés localStorage `aperPolygonsData` (polygones) et
les valeurs par défaut des champs « % Solarisable » (perdues à chaque rechargement).

Tables propres à la variante (registre de app/services/variantes_projet.py) : les tables de travail
portent la variante ACTIVE ; `indice_projet` est la lettre de cette variante (None tant que le
projet n'a aucune variante enregistrée), réécrite par le registre à chaque enregistrement ou
ouverture de variante.

La « Surface projetée champ PV » n'est pas stockée ici : elle découle du calepinage enregistré
(app/services/loi_aper.py).
"""
from datetime import datetime
from app.utils.dates import utc_maintenant

from app.extensions import db

TYPES_POLYGONE_APER = ('surface', 'exclusion')

# Libellés affichés par le calculateur, enregistrés avec la valeur (repli si le client n'en envoie pas).
LIBELLE_SOLARISABLE_APER = '% Solarisable APER'
LIBELLE_SOLARISABLE_HUWART = '% Solarisable Huwart'


class AperConfig(db.Model):
    """Variables du calculateur APER (une ligne par projet)."""
    __tablename__ = 'aper_configs'

    id = db.Column(db.Integer, primary_key=True)
    projet_id = db.Column(
        db.Integer,
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_aper_configs_projet_id'),
        nullable=False,
        unique=True,
        index=True,
    )
    indice_projet = db.Column(db.String(1), nullable=True)

    pourcent_solarisable_aper = db.Column(db.Float, nullable=True)
    libelle_solarisable_aper = db.Column(db.String(100), nullable=True)
    pourcent_solarisable_huwart = db.Column(db.Float, nullable=True)
    libelle_solarisable_huwart = db.Column(db.String(100), nullable=True)

    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'indiceProjet': self.indice_projet,
            'solarisableAper': {
                'valeur': self.pourcent_solarisable_aper,
                'libelle': self.libelle_solarisable_aper or LIBELLE_SOLARISABLE_APER,
            },
            'solarisableHuwart': {
                'valeur': self.pourcent_solarisable_huwart,
                'libelle': self.libelle_solarisable_huwart or LIBELLE_SOLARISABLE_HUWART,
            },
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class AperPolygone(db.Model):
    """Un polygone APER (surface assujettie « + » ou exclusion « - ») d'un projet."""
    __tablename__ = 'aper_polygones'

    id = db.Column(db.Integer, primary_key=True)
    projet_id = db.Column(
        db.Integer,
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_aper_polygones_projet_id'),
        nullable=False,
        index=True,
    )
    indice_projet = db.Column(db.String(1), nullable=True)

    # 'surface' ou 'exclusion' (TYPES_POLYGONE_APER), ordre de tracé conservé (numéro d'exclusion).
    type_polygone = db.Column(db.String(20), nullable=False)
    ordre = db.Column(db.Integer, nullable=False, default=0)
    # Contour extérieur : liste de {lat, lng} (non refermée), même format que la carte Google.
    coordonnees = db.Column(db.JSON, nullable=False)

    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)
