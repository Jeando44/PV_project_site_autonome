"""
Modèle ResultatProdSolaire - Résultats du dernier calcul ProSolaire (autoconsommation / vente en
totalité / ACC, et stockage) d'un projet, enregistrés PAR LE SERVEUR au moment du calcul.

Source unique des données reprises par la modale « Études économiques » : puissance installée,
productible spécifique, taux d'autoconsommation initial et parts hiver/été de la production
autoconsommée (cf. app/services/resultats_prodsolaire.py). Elles transitaient auparavant par le
localStorage du navigateur, commun à tous les projets et souvent périmé.
"""
from datetime import datetime
from app.utils.dates import utc_maintenant

from app.extensions import db


class ResultatProdSolaire(db.Model):
    __tablename__ = 'resultats_prodsolaire'

    id = db.Column(db.Integer, primary_key=True)
    projet_id = db.Column(
        db.Integer,
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_resultats_prodsolaire_projet_id'),
        nullable=False,
        unique=True,
        index=True,
    )

    # 'aci' | 'acc' | 'vente_totalite'
    type_etude = db.Column(db.String(20), nullable=False)
    # 'calcul' (production calculée à partir du calepinage) | 'fichier' (production importée)
    source_production = db.Column(db.String(20), nullable=False, default='calcul')

    puissance_kwc = db.Column(db.Float, nullable=True)
    productible_kwh_kwc = db.Column(db.Float, nullable=True)
    # Taux d'autoconsommation du PV seul (sans batterie), en %.
    taux_autoconso_pct = db.Column(db.Float, nullable=True)
    part_hiver_pct = db.Column(db.Float, nullable=True)
    part_ete_pct = db.Column(db.Float, nullable=True)
    # Empreinte des courbes horaires (production + consommations) du calcul : un résultat de
    # stockage n'est retenu que s'il a été calculé sur ces mêmes courbes.
    empreinte_courbes = db.Column(db.String(64), nullable=True)
    calcule_le = db.Column(db.DateTime, nullable=True)

    # Stockage (dernier calcul de batterie) : {taux_combine_pct, part_hiver_pct, part_ete_pct,
    # empreinte_courbes, calcule_le}. NULL : aucun stockage pris en compte.
    stockage = db.Column(db.JSON, nullable=True)

    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)


class AutonomieSite(db.Model):
    """
    Pré-dimensionnement « site isolé » (modal Consommation d'énergie) enregistré PAR LE SERVEUR au
    calcul (/api/consommation/calculer_autonomie) : consommation annuelle du site reprise par
    l'étude économique d'un projet Site autonome / Hybride, et base du taux de couverture PV.
    Remplace le résumé que le navigateur gardait en localStorage et recopiait dans le payload IRVE.
    """
    __tablename__ = 'autonomies_site'

    id = db.Column(db.Integer, primary_key=True)
    projet_id = db.Column(
        db.Integer,
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE', name='fk_autonomies_site_projet_id'),
        nullable=False,
        unique=True,
        index=True,
    )
    besoin_journalier_kwh = db.Column(db.Float, nullable=True)
    consommation_annuelle_kwh = db.Column(db.Float, nullable=True)
    puissance_pv_necessaire_kwc = db.Column(db.Float, nullable=True)
    calcule_le = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)
