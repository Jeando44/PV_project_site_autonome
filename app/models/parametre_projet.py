"""
Modèle ParametreProjet - Gestion des paramètres de projet
"""
import unicodedata

from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant

# Valeurs exactes produites par les 3 cartes de sélection de typologie (parametre.html).
TYPOLOGIES_PROJET_VALIDES = ('Résidentielle', 'Professionnelle (C&I)', 'Grand projet')


def _cle_typologie(valeur):
    """Clé de comparaison : sans accents, sans casse, espaces normalisés."""
    texte = unicodedata.normalize('NFD', str(valeur or ''))
    texte = ''.join(c for c in texte if unicodedata.category(c) != 'Mn')
    return ' '.join(texte.lower().split())


def normaliser_typologie(valeur):
    """
    Typologie ramenée à sa forme canonique (« Residentielle », « résidentielle », « Résidentielle »
    -> « Résidentielle »). Valeur inconnue : renvoyée nettoyée, telle quelle ; vide : ''.

    CORRECTIF (bug rapporté : palette d'outils complète réaffichée au rechargement d'un projet
    résidentiel) : la variante sans accent « Residentielle », présente en base, n'était corrigée
    qu'à l'écriture ; à la lecture, elle partait telle quelle vers le frontend, dont la comparaison
    stricte à « Résidentielle » basculait le projet sur la palette Pro/Grand projet.
    """
    if not valeur or not str(valeur).strip():
        return ''
    cle = _cle_typologie(valeur)
    for canonique in TYPOLOGIES_PROJET_VALIDES:
        if _cle_typologie(canonique) == cle:
            return canonique
    return str(valeur).strip()


# Types d'étude stockés (colonne texte libre). « Étude technico-économique » remplace l'ancienne
# valeur « Pré-étude de faisabilité » (affichée « Offre commerciale ») — cf. migration
# d4a7e2c9f150. L'ancienne valeur peut encore arriver d'un navigateur au JS en cache.
TYPE_ETUDE_TECHNICO_ECO = 'Étude technico-économique'
TYPE_ETUDE_ANCIENNE_PRE_ETUDE = 'Pré-étude de faisabilité'


def normaliser_type_etude(valeur):
    """Ramène l'ancienne valeur « Pré-étude de faisabilité » à « Étude technico-économique »."""
    if not valeur or not str(valeur).strip():
        return valeur
    texte = str(valeur).strip()
    if 'pre-etude' in _cle_typologie(texte) or 'preetude' in _cle_typologie(texte):
        return TYPE_ETUDE_TECHNICO_ECO
    return texte


class ParametreProjet(db.Model):
    """Modèle pour les paramètres de projet"""
    __tablename__ = 'parametres_projet'

    id = db.Column(db.Integer, primary_key=True)

    # Informations générales
    nom_projet = db.Column(db.String(200), nullable=False)
    type_de_projet = db.Column(db.String(50))
    typologie_projet = db.Column(db.String(50))

    # Libellé "projet + adresse" (≤10 mots) affiché sur la page de garde personnalisée du rapport
    # PDF pour les projets Résidentielle (cf. PdfResidentialReportGenerator.js) — propre à ce
    # projet, distinct du profil de personnalisation par utilisateur (PersonnalisationRapport).
    rapport_cover_label = db.Column(db.String(150))

    # Chargé(e) d'études (≤30 caractères, Paramètres projet > Informations générales) : nom affiché
    # dans la colonne « Étude réalisée par » de la page de garde du rapport PRO/Grand projet
    # (ExportService.addCoverPage) — le créateur n'a pas de nom en base, seulement son email.
    charge_etudes = db.Column(db.String(30))

    # Planning de réalisation (rapport PDF résidentiel, page "Planning de Réalisation") — durée
    # estimée (jours) de chaque étape. DÉPLACÉ (demande explicite) depuis le calepinage résidentiel
    # (CalepinageMaison, un état par maison) vers ce modèle : propre au PROJET (comme
    # rapport_cover_label ci-dessus), pas par utilisateur (PersonnalisationRapport) ni par maison —
    # l'installateur le règle une fois par projet, dans "Paramètres du projet", sans risquer de
    # l'oublier au moment de générer le rapport. Bornage 1-365 appliqué côté app (client ET
    # serveur, cf. _clamp_number), jamais au niveau de la colonne.
    planning_j_visite_technique = db.Column(db.Integer, nullable=True)
    planning_j_demarches = db.Column(db.Integer, nullable=True)
    planning_j_installation = db.Column(db.Integer, nullable=True)
    planning_j_mise_en_service = db.Column(db.Integer, nullable=True)
    mode_de_valorisation = db.Column(db.String(100))
    option_reseau = db.Column(db.String(200))
    type_projet = db.Column(db.String(100))
    autre_type_projet = db.Column(db.String(200))
    type_ouvrage = db.Column(db.String(100))
    autre_type_ouvrage = db.Column(db.String(200))
    nature_des_traveaux = db.Column(db.String(100))
    date_livrable = db.Column(db.Date)

    # Type d'étude choisi par l'utilisateur (Chiffrage / Étude technico-économique / Étude de
    # faisabilité détaillée — affichée « Étude de conception »), cf. normaliser_type_etude().
    # Champ direct sur le projet, indépendant de la liaison norme_calcul_id (qui reste optionnelle
    # et n'est renseignée que si l'utilisateur associe une norme de calcul au projet).
    type_etude = db.Column(db.String(100))

    # Localisation
    adresse_projet = db.Column(db.Text)
    pays = db.Column(db.String(100))
    environnement_salin = db.Column(db.Boolean, default=False)

    # Zones climatiques
    zone_de_vent = db.Column(db.String(10))
    categorie_de_terrain = db.Column(db.String(10))
    zone_de_neige = db.Column(db.String(10))
    zone_sismique = db.Column(db.String(50))
    niveau_keraunique = db.Column(db.Float)

    # Indices et règlements
    indices_projet = db.Column(db.Text)
    reglement_urbanisme = db.Column(db.Text)
    contraintes_specifiques = db.Column(db.Text)
    hypotheses_de_conception = db.Column(db.Text)

    # Données de calepinage (stockage JSON du localStorage solarProjectData)
    calepinage_data = db.Column(db.Text)

    # Puissance totale (kWc) du calepinage résidentiel (toiture multi-typologie, cf.
    # CalepinageMaison/calepinage_maison_persistence_db.js) — module volontairement indépendant du
    # calepinage rectangulaire/polygonale/shed ci-dessus (calepinage_data), donc pas de puissance
    # équivalente pour ce système dans ce même champ. Recalculée et sauvegardée à chaque
    # "Calculer et Visualiser" (même geste que calepinage_data), utilisée par
    # computeProjectKwc() (parametreProjetFormManager.js) pour la colonne "P. projet (kWc)" de
    # l'onglet "Mes projets", qui restait vide pour un projet fait uniquement en calepinage maison.
    puissance_maison_kwc = db.Column(db.Float)

    # Surface projetée au sol (m²) des panneaux du calepinage résidentiel enregistré, calculée par
    # le moteur de calepinage pour les champs envoyés à chaque sauvegarde (même geste et même source
    # que puissance_maison_kwc). Lue par le calculateur Loi APER (« Surface projetée champ PV »,
    # app/services/loi_aper.py). NULL = inconnue (calepinage enregistré avant cette colonne).
    surface_projetee_maison_m2 = db.Column(db.Float, nullable=True)

    # Indice de la variante actuellement chargée/active dans les tables de travail
    # (mis à jour par save_project_revision et load_project_revision, cf. concevoir_mon_projet.py)
    active_indice = db.Column(db.String(1), nullable=True)

    # Puissance totale du projet en kWc, extraite de calepinage_data.totals.totalPower
    # à chaque sauvegarde (voir save_calepinage_data) — colonne numérique dédiée pour
    # pouvoir sommer/filtrer en SQL (le JSON de calepinage_data ne l'est pas).
    # Utilisée pour appliquer le quota de licence max_kwc (voir creer_parametre_projet).
    puissance_totale_kwc = db.Column(db.Float, nullable=True)

    # Puissance projet (kWc) affichée dans « Mes projets » : figée UNIQUEMENT par « Calculer et
    # visualiser », un export (rapport, dossier de plans, DP) ou « Sauvegarder le projet » (route
    # valider_puissance_projet), à partir du calepinage enregistré. NULL = jamais calculé ni exporté
    # -> tiret. Si le calepinage enregistré a changé depuis, la liste invite à cliquer sur Calculer.
    puissance_projet_kwc = db.Column(db.Float, nullable=True)
    puissance_projet_maj_le = db.Column(db.DateTime, nullable=True)
    puissance_projet_source = db.Column(db.String(20), nullable=True)

    # Entreprise (compte partagé) à laquelle ce projet est rattaché, si le créateur
    # appartenait à une entreprise au moment de la création. Référence "molle" (pas de
    # ForeignKey) vers Solakvan_V7.companies.id, même style que created_by.
    company_id = db.Column(db.String(36), nullable=True, index=True)

    # Archivage / Suppression logique pour le respect strict des quotas de licence :
    # Un projet supprimé ne libère pas de place dans le quota et reste tracé.
    is_deleted = db.Column(db.Boolean, default=False, nullable=True, index=True)
    deleted_at = db.Column(db.DateTime, nullable=True)

    # Statut
    statut_prestation = db.Column(db.String(50), default='En cours')

    # Relation avec norme de calcul (avec SET NULL si norme supprimée)
    norme_calcul_id = db.Column(
        db.Integer,
        db.ForeignKey('normes_calcul.id', ondelete='SET NULL'),
        nullable=True
    )

    # Métadonnées
    created_by = db.Column(db.String(36), nullable=False)
    created_by_email = db.Column(db.String(200))
    created_by_name = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    # Relations avec CASCADE DELETE pour les partages
    shares = db.relationship(
        'ProjectShare',
        backref='project',
        lazy='dynamic',
        cascade='all, delete-orphan',
        passive_deletes=True
    )

    calepinages = db.relationship(
        'Calepinage',
        backref='project',
        lazy='dynamic',
        cascade='all, delete-orphan',
        passive_deletes=True
    )

    geometries = db.relationship(
        'GeometrieProjet',
        backref='project',
        lazy='dynamic',
        cascade='all, delete-orphan',
        passive_deletes=True
    )

    irve_config = db.relationship(
        'IrveConfig',
        backref='project',
        uselist=False,
        cascade='all, delete-orphan',
        passive_deletes=True
    )

    etude_economique_config = db.relationship(
        'EtudeEconomiqueConfig',
        backref='project',
        uselist=False,
        cascade='all, delete-orphan',
        passive_deletes=True
    )

    # NOUVEAU (chiffrage résidentiel / Devis) : même pattern 1:1 que etude_economique_config
    # ci-dessus — un blob JSON unique (CAPEX 9 postes + OPEX + TVA par ligne), utilisé uniquement
    # pour les projets de typologie Résidentielle (cf. ResidentielEtudeEcoView.js) mais sans
    # contrainte de typologie au niveau DB.
    residentiel_chiffrage_config = db.relationship(
        'ResidentielChiffrageConfig',
        backref='project',
        uselist=False,
        cascade='all, delete-orphan',
        passive_deletes=True
    )

    revisions = db.relationship(
        'ProjetRevision',
        backref='project',
        lazy='dynamic',
        cascade='all, delete-orphan',
        passive_deletes=True
    )

    def to_dict(self, include_norme=False):
        """Convertir en dictionnaire pour JSON"""
        data = {
            'id': self.id,
            'nom_projet': self.nom_projet,
            'type_de_projet': self.type_de_projet,
            'typologie_projet': normaliser_typologie(self.typologie_projet) or None,
            'rapport_cover_label': self.rapport_cover_label,
            'charge_etudes': self.charge_etudes,
            'planning_j_visite_technique': self.planning_j_visite_technique,
            'planning_j_demarches': self.planning_j_demarches,
            'planning_j_installation': self.planning_j_installation,
            'planning_j_mise_en_service': self.planning_j_mise_en_service,
            'mode_de_valorisation': self.mode_de_valorisation,
            'option_reseau': self.option_reseau,
            'type_projet': self.type_projet,
            'autre_type_projet': self.autre_type_projet,
            'type_ouvrage': self.type_ouvrage,
            'autre_type_ouvrage': self.autre_type_ouvrage,
            'nature_des_traveaux': self.nature_des_traveaux,
            'date_livrable': self.date_livrable.isoformat() if self.date_livrable else None,
            'type_etude': normaliser_type_etude(self.type_etude),
            'adresse_projet': self.adresse_projet,
            'pays': self.pays,
            'environnement_salin': self.environnement_salin,
            'zone_de_vent': self.zone_de_vent,
            'categorie_de_terrain': self.categorie_de_terrain,
            'zone_de_neige': self.zone_de_neige,
            'zone_sismique': self.zone_sismique,
            'niveau_keraunique': self.niveau_keraunique,
            'indices_projet': self.indices_projet,
            'reglement_urbanisme': self.reglement_urbanisme,
            'contraintes_specifiques': self.contraintes_specifiques,
            'hypotheses_de_conception': self.hypotheses_de_conception,
            'calepinage_data': self.calepinage_data,
            'puissance_maison_kwc': self.puissance_maison_kwc,
            'active_indice': self.active_indice,
            'puissance_totale_kwc': self.puissance_totale_kwc,
            'puissance_projet_kwc': self.puissance_projet_kwc,
            'puissance_projet_maj_le': self.puissance_projet_maj_le.isoformat() if self.puissance_projet_maj_le else None,
            'puissance_projet_source': self.puissance_projet_source,
            'company_id': self.company_id,
            'statut_prestation': self.statut_prestation,
            'norme_calcul_id': self.norme_calcul_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'created_by_email': self.created_by_email,
            'created_by_name': self.created_by_name,
        }

        if include_norme and self.norme:
            data['norme_calcul'] = self.norme.to_dict()

        data['is_deleted'] = bool(self.is_deleted)
        data['deleted_at'] = self.deleted_at.isoformat() if self.deleted_at else None

        return data


class ProjectQuotaCounter(db.Model):
    """Compteur irréversible des projets créés pour le respect strict des quotas de licence.
    Un projet supprimé ne libère PAS de place dans le quota : tout projet créé reste
    comptabilisé dans le nombre total de projets consommés par l'utilisateur / l'entreprise."""
    __tablename__ = 'project_quota_counters'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(36), index=True, nullable=False)
    company_id = db.Column(db.String(36), index=True, nullable=True)
    total_projects_created = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'company_id': self.company_id,
            'total_projects_created': self.total_projects_created,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

