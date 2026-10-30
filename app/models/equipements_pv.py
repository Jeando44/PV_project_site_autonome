"""
Modèles Panneau / Onduleur / Batterie - Bases de données matériel calepinage_systeme

Remplace la saisie manuelle des fiches techniques (panneaux/onduleurs/batteries) par une
sélection dans une vraie table SQL par type d'équipement. L'import PDF de fiche technique
(import_donnee_ft_pv.js / import_donnee_ft_ond.js) reste disponible en parallèle comme outil
d'amorçage/ajout de références (usage développeur), mais l'utilisateur final choisit désormais
une référence déjà en base plutôt que d'importer un PDF.
"""
import json

from app.extensions import db
from datetime import datetime
from app.utils.dates import utc_maintenant


class Panneau(db.Model):
    """Fiche technique d'un modèle de panneau photovoltaïque"""
    __tablename__ = 'panneaux'

    id = db.Column(db.Integer, primary_key=True)

    fabricant = db.Column(db.String(100), nullable=False)
    reference = db.Column(db.String(150), unique=True, nullable=False, index=True)

    puissance_wc = db.Column(db.Float, nullable=False)
    longueur_mm = db.Column(db.Float)
    largeur_mm = db.Column(db.Float)
    epaisseur_mm = db.Column(db.Float)

    i_mpp = db.Column(db.Float)
    i_sc = db.Column(db.Float)
    v_mpp = db.Column(db.Float)
    v_oc = db.Column(db.Float)
    coef_voc_pct_c = db.Column(db.Float)
    coef_isc_pct_c = db.Column(db.Float)
    coef_pmax_pct_c = db.Column(db.Float)

    type_module = db.Column(db.String(100))
    nb_cellules = db.Column(db.Integer)

    # Tension système max admissible (nécessaire à StringSizingUtils.calculateStringSizing)
    tension_systeme_max = db.Column(db.Float, default=1500)

    # NOUVEAU (demande explicite, mise à jour BD matériels) : éligibilité TVA réduite (5.5%) et
    # distributeur(s) connus pour cette référence (chaîne libre, plusieurs distributeurs possibles
    # séparés par une virgule — ex. "Krannich Solar France, Bayware").
    eligible_tva = db.Column(db.Boolean, nullable=True)
    distributeurs = db.Column(db.String(255), nullable=True)

    is_active = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'fabricant': self.fabricant,
            'reference': self.reference,
            'puissance_wc': self.puissance_wc,
            'longueur_mm': self.longueur_mm,
            'largeur_mm': self.largeur_mm,
            'epaisseur_mm': self.epaisseur_mm,
            'i_mpp': self.i_mpp,
            'i_sc': self.i_sc,
            'v_mpp': self.v_mpp,
            'v_oc': self.v_oc,
            'coef_voc_pct_c': self.coef_voc_pct_c,
            'coef_isc_pct_c': self.coef_isc_pct_c,
            'coef_pmax_pct_c': self.coef_pmax_pct_c,
            'type_module': self.type_module,
            'nb_cellules': self.nb_cellules,
            'tension_systeme_max': self.tension_systeme_max,
            'eligible_tva': self.eligible_tva,
            'distributeurs': self.distributeurs,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class Onduleur(db.Model):
    """Fiche technique d'un modèle d'onduleur"""
    __tablename__ = 'onduleurs'

    id = db.Column(db.Integer, primary_key=True)

    fabricant = db.Column(db.String(100), nullable=False)
    reference = db.Column(db.String(150), unique=True, nullable=False, index=True)

    puissance_max_dc_kw = db.Column(db.Float, nullable=True)
    p_nominale_kva = db.Column(db.Float)
    p_apparente_max_kva = db.Column(db.Float)

    # Ex: 10 entrées MPPT à 2 entrées/MPPT -> to_dict() reconstruit l'affichage "10 / 2"
    nb_entrees_mppt = db.Column(db.Integer)
    nb_mppt_par_entree = db.Column(db.Integer)

    tension_max_dc = db.Column(db.Float)
    tension_min_dc = db.Column(db.Float)
    plage_mppt_min = db.Column(db.Float)
    plage_mppt_max = db.Column(db.Float)
    courant_max_mppt = db.Column(db.Float)
    # NOUVEAU (bug rapporté : "erreur dans le calcul du nombre de chaînes par MPPT" — méthodologie
    # NF C 15-712/IEC 62548 : le nombre de chaînes pouvant être mises EN PARALLÈLE sur un même MPPT se
    # détermine en comparant le courant de court-circuit du panneau DÉRATÉ (Isc × 1,25) au courant de
    # COURT-CIRCUIT max admissible par le MPPT (I_sc,max — cette colonne), PAS au courant max
    # d'ENTRÉE/fonctionnement du MPPT (courant_max_mppt ci-dessus, une limite différente, plus basse en
    # général — d'où le calcul erroné qui plafonnait à 1 chaîne au lieu de 2 sur l'exemple SUN2000-
    # 100KTL-M2 + DM-470-G12RT : 30A "fonctionnement" vs 40A "court-circuit"). Colonne Excel source :
    # "Courant_Court_Circuit_Isc (A)" — jusqu'ici non importée (absente du modèle).
    courant_cc_max_mppt = db.Column(db.Float, nullable=True)

    rendement_max_pct = db.Column(db.Float)
    rendement_europeen_pct = db.Column(db.Float)
    courant_max_sortie_ac = db.Column(db.Float)

    type_tension = db.Column(db.String(50))  # 'Monophasé' | 'Triphasé'
    # Chaîne car un onduleur peut légitimement annoncer plusieurs tensions (ex: "400V, 480V")
    tension_nominale_ac = db.Column(db.String(100))

    compat_optimiseur = db.Column(db.Boolean, default=False)
    hybride = db.Column(db.Boolean, default=False)
    poids_kg = db.Column(db.Float)

    # NOUVEAU (demande explicite, ajout matériels BD : Onduleurs/Optimiseurs/Batteries/Pompage solaire) :
    # `technologie` pilote le branchement du dimensionnement côté JS (chaîne classique vs micro-onduleur
    # vs hybride) — ex. "Onduleur de chaîne" / "Micro-onduleur" / "Hybride" / "Onduleur batterie (AC)"
    # (valeurs de la colonne "Technologie" de Materiels_BD.xlsx). `type_connexion` est le filtre général
    # "connecté au réseau / off-grid" demandé ("Général : Type de connexion onduleur, connecté au
    # réseau. Cela permettra de faire le filtre pour un projet connecté au réseau et off-grid.").
    technologie = db.Column(db.String(100), nullable=True)
    type_connexion = db.Column(db.String(30), nullable=True)  # 'Connecté au réseau' | 'Off-grid'

    # Réservé aux micro-onduleurs (demande explicite) : reste `None` pour tout autre type d'onduleur,
    # exactement comme dans la source Excel (colonnes "Tension de fonctionnement minimale/maximale",
    # vides sauf pour les lignes "Micro-onduleur").
    tension_fonctionnement_min = db.Column(db.Float, nullable=True)
    tension_fonctionnement_max = db.Column(db.Float, nullable=True)

    # Dimensionnement micro-onduleurs par phase (demande explicite : "il faut tenir compte du nombre de
    # micro-onduleur à mettre sur phase monophasé ou tri phasé, voir fiche technique") — 2 contraintes
    # distinctes documentées par les fiches Enphase IQ8 : nb max d'unités par circuit 20A (L+N mono /
    # 3L+N tri) ET nb max d'unités par section de câble AC (souvent plus restrictif) ; la plus
    # contraignante des deux s'applique en pratique (cf. calculateMicroOnduleurSizing,
    # string_sizing_utils.js). Toutes `None` pour un onduleur non micro.
    nb_max_unites_mono_20a = db.Column(db.Integer, nullable=True)
    nb_max_unites_tri_20a = db.Column(db.Integer, nullable=True)
    nb_max_unites_cable_mono = db.Column(db.Integer, nullable=True)
    nb_max_unites_cable_poly = db.Column(db.Integer, nullable=True)

    is_active = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'fabricant': self.fabricant,
            'reference': self.reference,
            'puissance_max_dc_kw': self.puissance_max_dc_kw,
            'p_nominale_kva': self.p_nominale_kva,
            'p_apparente_max_kva': self.p_apparente_max_kva,
            'nb_entrees_mppt': self.nb_entrees_mppt,
            'nb_mppt_par_entree': self.nb_mppt_par_entree,
            'nb_entrees_mppt_affichage': (
                f"{self.nb_entrees_mppt} / {self.nb_mppt_par_entree}"
                if self.nb_entrees_mppt is not None and self.nb_mppt_par_entree is not None
                else None
            ),
            'tension_max_dc': self.tension_max_dc,
            'tension_min_dc': self.tension_min_dc,
            'plage_mppt_min': self.plage_mppt_min,
            'plage_mppt_max': self.plage_mppt_max,
            'courant_max_mppt': self.courant_max_mppt,
            'courant_cc_max_mppt': self.courant_cc_max_mppt,
            'rendement_max_pct': self.rendement_max_pct,
            'rendement_europeen_pct': self.rendement_europeen_pct,
            'courant_max_sortie_ac': self.courant_max_sortie_ac,
            'type_tension': self.type_tension,
            'tension_nominale_ac': self.tension_nominale_ac,
            'compat_optimiseur': self.compat_optimiseur,
            'hybride': self.hybride,
            'poids_kg': self.poids_kg,
            'technologie': self.technologie,
            'type_connexion': self.type_connexion,
            'tension_fonctionnement_min': self.tension_fonctionnement_min,
            'tension_fonctionnement_max': self.tension_fonctionnement_max,
            'nb_max_unites_mono_20a': self.nb_max_unites_mono_20a,
            'nb_max_unites_tri_20a': self.nb_max_unites_tri_20a,
            'nb_max_unites_cable_mono': self.nb_max_unites_cable_mono,
            'nb_max_unites_cable_poly': self.nb_max_unites_cable_poly,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class Batterie(db.Model):
    """Fiche technique d'un modèle de batterie"""
    __tablename__ = 'batteries'

    id = db.Column(db.Integer, primary_key=True)

    fabricant = db.Column(db.String(100), nullable=False)
    reference = db.Column(db.String(150), unique=True, nullable=False, index=True)

    chimie = db.Column(db.String(50))
    capacite_nominale_kwh = db.Column(db.Float)
    capacite_utilisable_kwh = db.Column(db.Float)
    compatibilite_systeme = db.Column(db.String(100))  # ex: "Monophasé et Triphasé"
    type_couplage = db.Column(db.String(20))  # 'DC' | 'AC'

    soc_min_pct = db.Column(db.Float, default=0)
    soc_max_pct = db.Column(db.Float, default=100)

    puissance_charge_kw = db.Column(db.Float)
    puissance_decharge_kw = db.Column(db.Float)
    round_trip_efficiency_pct = db.Column(db.Float)

    courant_max_sortie_triphase_ac = db.Column(db.Float, nullable=True)
    tension_nominale_ac = db.Column(db.String(50), nullable=True)
    tension_fonctionnement_triphase = db.Column(db.String(50), nullable=True)
    tension_fonctionnement_monophase = db.Column(db.String(50), nullable=True)
    conso_aux_monophase_kw = db.Column(db.Float, nullable=True)
    conso_veille_w = db.Column(db.Float, nullable=True)
    dimensions_mm = db.Column(db.String(100), nullable=True)

    # ------------------------------------------------------------------------------------------
    # Colonnes présentes dans Materiels_BD.xlsx mais jamais importées jusqu'ici (l'onglet source a
    # été restructuré sans que read_batteries() suive). Cf. app/utils/materiels_normalisation.py
    # pour les règles de lecture, et scripts/controle_coherence_batteries.py pour le rapport
    # préalable à tout import.
    # ------------------------------------------------------------------------------------------

    # Profondeur de décharge maximale constructeur (colonne DoD_Max). Distincte de soc_min/soc_max,
    # qui restent la représentation interne utilisée par le calcul.
    dod_max_pct = db.Column(db.Float, nullable=True)

    # Raccordement système ('Connecté au réseau' / 'Site isolé'). Cette valeur alimentait par erreur
    # `compatibilite_systeme`, qui est censé porter le monophasé/triphasé : toutes les batteries
    # étaient donc rangées en « triphasé » par repli côté frontend (compatibiliteFromApi).
    raccordement_systeme = db.Column(db.String(100), nullable=True)

    # Tension nominale DC, texte brut de la source (ex. '450 V Mono/ 600 V TRI').
    tension_nominale_dc = db.Column(db.String(100), nullable=True)

    # Tension système retenue PAR PHASE (demande explicite) : moyenne de la plage de fonctionnement
    # quand elle distingue les phases, sinon tension nominale DC par phase, sinon moyenne de la
    # plage unique. NULL = donnée absente de la source, affichée « NA ».
    tension_systeme_mono_v = db.Column(db.Float, nullable=True)
    tension_systeme_tri_v = db.Column(db.Float, nullable=True)

    # Courant maximal de charge/décharge (colonne Courant_Max_Charge_Decharge). Distinct de
    # courant_max_sortie_triphase_ac, qui ne concerne que la sortie triphasée AC.
    courant_max_charge_decharge_a = db.Column(db.Float, nullable=True)

    # État de santé (SoH, % de la capacité d'origine) en fin de vie garantie — ex. 60 % pour les
    # Huawei LUNA2000-S1. NULL = non renseigné : le calcul de vieillissement retient 60 %
    # (cf. app/models/calcul_prodsolaire/vieillissement_stockage.py).
    soh_fin_vie_pct = db.Column(db.Float, nullable=True)

    # Évolutivité STRUCTURÉE (le texte libre `evolutivite_max` ne permet aucun contrôle) : nombre
    # d'unités de CETTE référence montables en série dans une branche (min/max) et nombre de branches
    # en parallèle (max). NULL = non renseigné : le montage n'est pas vérifié, un avertissement le dit
    # (cf. app/models/calcul_prodsolaire/configuration_parc_batteries.py).
    nb_serie_min = db.Column(db.Integer, nullable=True)
    nb_serie_max = db.Column(db.Integer, nullable=True)
    nb_parallele_max = db.Column(db.Integer, nullable=True)

    poids_kg = db.Column(db.Float, nullable=True)
    evolutivite_max = db.Column(db.String(200), nullable=True)
    lien_fiche_technique = db.Column(db.String(500), nullable=True)

    is_active = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'fabricant': self.fabricant,
            'reference': self.reference,
            'chimie': self.chimie,
            'capacite_nominale_kwh': self.capacite_nominale_kwh,
            'capacite_utilisable_kwh': self.capacite_utilisable_kwh,
            'compatibilite_systeme': self.compatibilite_systeme,
            'type_couplage': self.type_couplage,
            'soc_min_pct': self.soc_min_pct,
            'soc_max_pct': self.soc_max_pct,
            'puissance_charge_kw': self.puissance_charge_kw,
            'puissance_decharge_kw': self.puissance_decharge_kw,
            'round_trip_efficiency_pct': self.round_trip_efficiency_pct,
            'courant_max_sortie_triphase_ac': self.courant_max_sortie_triphase_ac,
            'tension_nominale_ac': self.tension_nominale_ac,
            'tension_fonctionnement_triphase': self.tension_fonctionnement_triphase,
            'tension_fonctionnement_monophase': self.tension_fonctionnement_monophase,
            'conso_aux_monophase_kw': self.conso_aux_monophase_kw,
            'conso_veille_w': self.conso_veille_w,
            'dimensions_mm': self.dimensions_mm,
            'dod_max_pct': self.dod_max_pct,
            'raccordement_systeme': self.raccordement_systeme,
            'tension_nominale_dc': self.tension_nominale_dc,
            'tension_systeme_mono_v': self.tension_systeme_mono_v,
            'tension_systeme_tri_v': self.tension_systeme_tri_v,
            'courant_max_charge_decharge_a': self.courant_max_charge_decharge_a,
            'soh_fin_vie_pct': self.soh_fin_vie_pct,
            'nb_serie_min': self.nb_serie_min,
            'nb_serie_max': self.nb_serie_max,
            'nb_parallele_max': self.nb_parallele_max,
            'poids_kg': self.poids_kg,
            'evolutivite_max': self.evolutivite_max,
            'lien_fiche_technique': self.lien_fiche_technique,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class Optimiseur(db.Model):
    """Fiche technique d'un modèle d'optimiseur de puissance (NOUVEAU, demande explicite : ajout
    matériels BD onduleurs/optimiseurs/batteries/pompage solaire — n'existait pas du tout avant).
    Compatibilité avec des modèles d'onduleurs précis (bornes de longueur de chaîne + puissance PV
    max, qui varient PAR PAIRE optimiseur/onduleur dans la fiche source) : cf. OptimiseurOnduleurCompat
    ci-dessous, volontairement PAS un champ sur ce modèle (une même référence d'optimiseur a des bornes
    différentes selon le modèle d'onduleur associé, cf. Materiels_BD.xlsx, onglet Optimiseurs)."""
    __tablename__ = 'optimiseurs'

    id = db.Column(db.Integer, primary_key=True)

    fabricant = db.Column(db.String(100), nullable=False)
    reference = db.Column(db.String(150), unique=True, nullable=False, index=True)

    puissance_dc_nominale_wc = db.Column(db.Float, nullable=True)
    puissance_module_max_wc = db.Column(db.Float, nullable=True)
    tension_entree_max_dc = db.Column(db.Float, nullable=True)
    plage_mppt_min = db.Column(db.Float, nullable=True)
    plage_mppt_max = db.Column(db.Float, nullable=True)
    courant_entree_max = db.Column(db.Float, nullable=True)
    courant_cc_max = db.Column(db.Float, nullable=True)
    tension_sortie_max = db.Column(db.Float, nullable=True)
    courant_sortie_max = db.Column(db.Float, nullable=True)
    rendement_max_pct = db.Column(db.Float, nullable=True)
    rendement_pondere_pct = db.Column(db.Float, nullable=True)

    is_active = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def to_dict(self):
        return {
            'id': self.id,
            'fabricant': self.fabricant,
            'reference': self.reference,
            'puissance_dc_nominale_wc': self.puissance_dc_nominale_wc,
            'puissance_module_max_wc': self.puissance_module_max_wc,
            'tension_entree_max_dc': self.tension_entree_max_dc,
            'plage_mppt_min': self.plage_mppt_min,
            'plage_mppt_max': self.plage_mppt_max,
            'courant_entree_max': self.courant_entree_max,
            'courant_cc_max': self.courant_cc_max,
            'tension_sortie_max': self.tension_sortie_max,
            'courant_sortie_max': self.courant_sortie_max,
            'rendement_max_pct': self.rendement_max_pct,
            'rendement_pondere_pct': self.rendement_pondere_pct,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class PompeSolaire(db.Model):
    """Fiche technique d'une pompe solaire (NOUVEAU, demande explicite — n'existait pas du tout avant :
    le formulaire résidentiel n'avait qu'une case à cocher + référence texte libre, cf.
    calepinage_maison_formulaires.js #cmPompageSolaireRef)."""
    __tablename__ = 'pompes_solaires'

    id = db.Column(db.Integer, primary_key=True)

    fabricant = db.Column(db.String(100), nullable=False)
    reference = db.Column(db.String(150), unique=True, nullable=False, index=True)

    type_installation = db.Column(db.String(150), nullable=True)
    technologie_hydraulique = db.Column(db.String(150), nullable=True)
    architecture_systeme = db.Column(db.String(150), nullable=True)
    moteur = db.Column(db.String(200), nullable=True)
    alimentation_electrique = db.Column(db.String(150), nullable=True)
    tension_entree_solaire = db.Column(db.String(100), nullable=True)
    puissance_kw = db.Column(db.Float, nullable=True)
    hmt_max_m = db.Column(db.Float, nullable=True)
    debit_nominal_m3h = db.Column(db.String(150), nullable=True)
    diametre_forage_min = db.Column(db.String(100), nullable=True)
    materiaux = db.Column(db.String(255), nullable=True)
    protections = db.Column(db.String(255), nullable=True)
    indice_ip = db.Column(db.String(50), nullable=True)
    communication = db.Column(db.String(255), nullable=True)

    # Gamme SQFlex (livret technique Grundfos, cf. scripts/extraire_pompes_sqflex.py) :
    # - applications : installations compatibles, une par ligne ;
    # - courbes_performance : JSON {source, axe_x, axe_y, p1_max_w, validite, courbes: [{hmt_m,
    #   points: [[P1_W, Q_m3h], ...]}]} — débit en fonction de la puissance absorbée, par hauteur.
    #   Exploité par le dimensionnement (suggestion, montage série/parallèle) du pompage solaire ;
    # - rendement_hydraulique_pct : rendement de la partie hydraulique seule (hors moteur), publié
    #   pour les pompes centrifuges.
    applications = db.Column(db.Text, nullable=True)
    courbes_performance = db.Column(db.Text, nullable=True)
    rendement_hydraulique_pct = db.Column(db.Float, nullable=True)
    code_article = db.Column(db.String(50), nullable=True)
    raccord_refoulement = db.Column(db.String(50), nullable=True)

    is_active = db.Column(db.Boolean, default=True, index=True)
    created_at = db.Column(db.DateTime, default=utc_maintenant)
    updated_at = db.Column(db.DateTime, default=utc_maintenant, onupdate=utc_maintenant)

    def courbes_dict(self):
        """Courbes de performance décodées (None si absentes ou illisibles)."""
        if not self.courbes_performance:
            return None
        try:
            valeur = json.loads(self.courbes_performance)
        except (TypeError, ValueError):
            return None
        return valeur if isinstance(valeur, dict) else None

    def to_dict(self):
        return {
            'id': self.id,
            'fabricant': self.fabricant,
            'reference': self.reference,
            'type_installation': self.type_installation,
            'technologie_hydraulique': self.technologie_hydraulique,
            'architecture_systeme': self.architecture_systeme,
            'moteur': self.moteur,
            'alimentation_electrique': self.alimentation_electrique,
            'tension_entree_solaire': self.tension_entree_solaire,
            'puissance_kw': self.puissance_kw,
            'hmt_max_m': self.hmt_max_m,
            'debit_nominal_m3h': self.debit_nominal_m3h,
            'diametre_forage_min': self.diametre_forage_min,
            'materiaux': self.materiaux,
            'protections': self.protections,
            'indice_ip': self.indice_ip,
            'communication': self.communication,
            'applications': [a.strip() for a in (self.applications or '').split('\n') if a.strip()],
            'courbes_performance': self.courbes_dict(),
            'rendement_hydraulique_pct': self.rendement_hydraulique_pct,
            'code_article': self.code_article,
            'raccord_refoulement': self.raccord_refoulement,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class OptimiseurOnduleurCompat(db.Model):
    """Compatibilité Optimiseur <-> modèle d'onduleur (NOUVEAU, demande explicite : "il faut tenir
    compte du type d'optimiseur par modèle d'onduleur ... le nombre d'optimiseurs MIN_MAX par chaine et
    la puissance PV"). Une même référence d'optimiseur peut avoir des bornes DIFFÉRENTES selon le modèle
    d'onduleur associé (jusqu'à 5 profils dans Materiels_BD.xlsx, onglet Optimiseurs) — d'où une table de
    compatibilité par PAIRE plutôt que des bornes globales sur Optimiseur (confirmé avec l'utilisateur)."""
    __tablename__ = 'optimiseur_onduleur_compat'
    __table_args__ = (
        db.UniqueConstraint('optimiseur_id', 'onduleur_id', name='uq_optimiseur_onduleur'),
    )

    id = db.Column(db.Integer, primary_key=True)
    optimiseur_id = db.Column(db.Integer, db.ForeignKey('optimiseurs.id'), nullable=False, index=True)
    onduleur_id = db.Column(db.Integer, db.ForeignKey('onduleurs.id'), nullable=False, index=True)

    chaine_min = db.Column(db.Integer, nullable=True)
    chaine_max = db.Column(db.Integer, nullable=True)
    puissance_max_w = db.Column(db.Float, nullable=True)

    optimiseur = db.relationship('Optimiseur', backref=db.backref('compat_onduleurs', lazy='dynamic'))
    onduleur = db.relationship('Onduleur', backref=db.backref('compat_optimiseurs', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': self.id,
            'optimiseur_id': self.optimiseur_id,
            'onduleur_id': self.onduleur_id,
            'chaine_min': self.chaine_min,
            'chaine_max': self.chaine_max,
            'puissance_max_w': self.puissance_max_w,
        }


class BatterieOnduleurCompat(db.Model):
    """Compatibilité Batterie <-> modèle d'onduleur hybride (NOUVEAU, demande explicite : "il faut
    tenir compte du type de batterie par modèle d'onduleur hybride"). Simple lien (pas de bornes
    numériques : une batterie est compatible ou ne l'est pas avec un modèle d'onduleur donné,
    contrairement aux optimiseurs qui ont des bornes de dimensionnement par paire)."""
    __tablename__ = 'batterie_onduleur_compat'
    __table_args__ = (
        db.UniqueConstraint('batterie_id', 'onduleur_id', name='uq_batterie_onduleur'),
    )

    id = db.Column(db.Integer, primary_key=True)
    batterie_id = db.Column(db.Integer, db.ForeignKey('batteries.id'), nullable=False, index=True)
    onduleur_id = db.Column(db.Integer, db.ForeignKey('onduleurs.id'), nullable=False, index=True)

    batterie = db.relationship('Batterie', backref=db.backref('compat_onduleurs', lazy='dynamic'))
    onduleur = db.relationship('Onduleur', backref=db.backref('compat_batteries', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': self.id,
            'batterie_id': self.batterie_id,
            'onduleur_id': self.onduleur_id,
        }
