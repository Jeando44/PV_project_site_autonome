"""
Modèles Calepinage et GeometrieProjet - Données de dessin et géométrie technique
"""
from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant

class Calepinage(db.Model):
    """Modèle pour sauvegarder les données structurées des polygones dessinés sur la carte"""
    __tablename__ = 'calepinages'

    id = db.Column(db.Integer, primary_key=True)
    
    # Liaison avec le projet parent
    projet_id = db.Column(
        db.Integer, 
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE'), 
        nullable=False,
        index=True
    )
    
    # Identifiant unique de la forme côté carte (ex: "PV1", "PV2")
    pv_id = db.Column(db.String(50), nullable=False, index=True)
    
    # Coordonnées géographiques du polygone au format JSON (liste de {lat, lng})
    coordonnees = db.Column(db.JSON, nullable=False)
    
    # Paramètres de toiture/calcul
    inclinaison = db.Column(db.Float, nullable=True, default=0.0)
    azimut = db.Column(db.Float, nullable=True, default=0.0)
    systeme_integration = db.Column(db.String(100), nullable=True)
    disposition = db.Column(db.String(50), nullable=True) # Ex: "3L x 10C"
    mode_pose = db.Column(db.String(50), nullable=True) # Ex: "Portrait" | "Paysage"
    
    # Paramètres de géométrie de toiture additionnels
    type_toiture = db.Column(db.String(100), nullable=True)
    esp_bordure = db.Column(db.Float, nullable=True, default=0.0)
    joint_dilatation = db.Column(db.Float, nullable=True, default=0.0)
    long_max = db.Column(db.Float, nullable=True, default=0.0)

    # Paramètres de la section Système
    type_montage = db.Column(db.String(100), nullable=True)
    perte_pourcent = db.Column(db.Float, nullable=True, default=0.0)
    affectation_centrale = db.Column(db.String(150), nullable=True)

    # Multiplicateurs de puissance onduleur (cf. SummaryModal.js : Puissance onduleur affichée =
    # P_max onduleur x nb_onduleurs x (fraction_repartition_onduleur / 100))
    nb_onduleurs = db.Column(db.Integer, nullable=True, default=1)
    fraction_repartition_onduleur = db.Column(db.Float, nullable=True, default=100.0)

    # Référence optionnelle au matériel du catalogue
    panneau_id = db.Column(
        db.Integer, 
        db.ForeignKey('materiels_catalogue.id', ondelete='SET NULL'), 
        nullable=True
    )
    onduleur_id = db.Column(
        db.Integer, 
        db.ForeignKey('materiels_catalogue.id', ondelete='SET NULL'), 
        nullable=True
    )
    batterie_id = db.Column(
        db.Integer, 
        db.ForeignKey('materiels_catalogue.id', ondelete='SET NULL'), 
        nullable=True
    )
    
    # Sauvegarde intégrale de l'état sérialisé de la forme pour flexibilité maximale
    donnees_completes = db.Column(db.JSON, nullable=True)
    
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    # Relations optionnelles
    panneau = db.relationship('MaterielCatalogue', foreign_keys=[panneau_id])
    onduleur = db.relationship('MaterielCatalogue', foreign_keys=[onduleur_id])
    batterie = db.relationship('MaterielCatalogue', foreign_keys=[batterie_id])

    def to_dict(self):
        return {
            'id': self.id,
            'projet_id': self.projet_id,
            'pv_id': self.pv_id,
            'coordonnees': self.coordonnees,
            'inclinaison': self.inclinaison,
            'azimut': self.azimut,
            'systeme_integration': self.systeme_integration,
            'disposition': self.disposition,
            'mode_pose': self.mode_pose,
            'type_toiture': self.type_toiture,
            'esp_bordure': self.esp_bordure,
            'joint_dilatation': self.joint_dilatation,
            'long_max': self.long_max,
            'type_montage': self.type_montage,
            'perte_pourcent': self.perte_pourcent,
            'affectation_centrale': self.affectation_centrale,
            'nb_onduleurs': self.nb_onduleurs,
            'fraction_repartition_onduleur': self.fraction_repartition_onduleur,
            'panneau_id': self.panneau_id,
            'onduleur_id': self.onduleur_id,
            'batterie_id': self.batterie_id,
            'donnees_completes': self.donnees_completes,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class CalepinageMaison(db.Model):
    """Calepinage résidentiel (toiture multi-typologie) — module volontairement indépendant du
    calepinage rectangulaire/polygonale/shed (cf. Calepinage ci-dessus) : table dédiée plutôt que
    réutilisation de `calepinages`, une maison n'ayant ni la même géométrie (pans multiples/libres)
    ni les mêmes champs équipements (pas de FK vers materiels_catalogue — cf. panneau_ref/
    batterie_ref ci-dessous, en valeurs simples, les catalogues onduleur/batterie de ce module
    n'étant pour l'instant pas adossés à cette table catalogue)."""
    __tablename__ = 'calepinages_maison'

    id = db.Column(db.Integer, primary_key=True)

    projet_id = db.Column(
        db.Integer,
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE'),
        nullable=False,
        index=True
    )

    # Identifiant de la maison (ex: "PV1", "PV2") — cf. polygon_maison.js::_initPolygon, qui réserve
    # désormais ce numéro dans le même pool que le calepinage rectangulaire/polygonale/shed
    # (DrawingControl.usedIds) pour rester unique même en usage combiné dans un même projet.
    maison_id = db.Column(db.String(50), nullable=False, index=True)

    # Tracé de la maison (liste de {lat, lng}) — cf. MaisonPolygonManager::_persistPolygons.
    coordonnees = db.Column(db.JSON, nullable=False)

    # Équipements (cf. section "Matériels" du formulaire, calepinage_maison_formulaires.js)
    panneau_ref = db.Column(db.String(200), nullable=True)
    panneau_puissance_wc = db.Column(db.Float, nullable=True)
    systeme_integration_ref = db.Column(db.String(100), nullable=True)
    onduleur_puissance_kva = db.Column(db.Float, nullable=True)
    onduleur_rendement = db.Column(db.Float, nullable=True)
    onduleur_conso = db.Column(db.Float, nullable=True)
    batterie_ref = db.Column(db.String(200), nullable=True)
    batterie_capacite_kwh = db.Column(db.Float, nullable=True)
    type_montage = db.Column(db.String(50), nullable=True)
    perte_pourcent = db.Column(db.Float, nullable=True, default=0.0)
    affectation_centrale = db.Column(db.String(150), nullable=True)

    # Sauvegarde intégrale de l'état sérialisé de la maison (pans/obstacles/dimensions/etc., même
    # format que calepinage_maison_v1 en localStorage) pour flexibilité maximale — même principe que
    # Calepinage.donnees_completes ci-dessus.
    donnees_completes = db.Column(db.JSON, nullable=True)

    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'projet_id': self.projet_id,
            'maison_id': self.maison_id,
            'coordonnees': self.coordonnees,
            'panneau_ref': self.panneau_ref,
            'panneau_puissance_wc': self.panneau_puissance_wc,
            'systeme_integration_ref': self.systeme_integration_ref,
            'onduleur_puissance_kva': self.onduleur_puissance_kva,
            'onduleur_rendement': self.onduleur_rendement,
            'onduleur_conso': self.onduleur_conso,
            'batterie_ref': self.batterie_ref,
            'batterie_capacite_kwh': self.batterie_capacite_kwh,
            'type_montage': self.type_montage,
            'perte_pourcent': self.perte_pourcent,
            'affectation_centrale': self.affectation_centrale,
            'donnees_completes': self.donnees_completes,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class GeometrieProjet(db.Model):
    """Modèle pour stocker les calculs et dimensions des plans de géométrie (ombrière, bâtiment, etc.)"""
    __tablename__ = 'geometries_projet'

    id = db.Column(db.Integer, primary_key=True)
    
    projet_id = db.Column(
        db.Integer, 
        db.ForeignKey('parametres_projet.id', ondelete='CASCADE'), 
        nullable=False,
        index=True
    )
    
    pv_id = db.Column(db.String(50), nullable=False, index=True)
    
    # 'métal' | 'bois' | 'solumbra' | 'batiment_metal'
    type_structure = db.Column(db.String(50), nullable=False, index=True)
    
    # Paramètres d'entrée et de sortie complets au format JSON
    parametres_calcul = db.Column(db.JSON, nullable=False)
    
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'projet_id': self.projet_id,
            'pv_id': self.pv_id,
            'type_structure': self.type_structure,
            'parametres_calcul': self.parametres_calcul,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }