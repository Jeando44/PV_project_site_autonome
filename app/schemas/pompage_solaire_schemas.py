"""
Schémas Pydantic de validation stricte du module Pompage solaire (modale de consommation).

Même principe que irve_schemas.py : les bornes sont celles de la spec métier, et le front
(pompage_solaire_section.js, table REGLES) applique LES MÊMES — toute évolution d'une borne se fait
des deux côtés. La ressource solaire reprend les bornes de l'« Analyse d'autonomie énergétique »
(irve_schemas.AutonomieParams : inclinaison 0-90, azimut -90/180, pertes 8-20 %).

Le dimensionnement est calculé dans le navigateur ; le seul appel serveur (irradiation PVGIS) reçoit
toutes les saisies et les valide ici avant de répondre, y compris les hypothèses économiques quand
l'analyse économique est demandée.
"""
import re
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Lettres (accents compris), chiffres, tiret et espace ; 30 caractères maximum.
MOTIF_REFERENCE_POMPE = re.compile(r"^[A-Za-zÀ-ÖØ-öø-ÿ0-9\- ]{1,30}$")

# Profondeur du niveau dynamique (forage) / hauteur d'aspiration (surface), selon le type de pompage.
BORNES_H_ASPIRATION = {'forage': (0.1, 100.0), 'surface': (1.0, 7.0)}

# Type de système de pompage solaire (section 1), cf. calcul_pompage_solaire.SYSTEMES_POMPAGE.
SystemePompage = Literal['fil_soleil', 'groupe', 'batteries']

# Plafond des montants selon la devise. Les bornes monétaires sont exprimées en euros ; elles sont
# multipliées par ce facteur (arrondi large du taux de change) : sans lui, le plafond d'un Capex
# (1 000 000) valait 1 500 EUR en francs CFA, et une installation réelle ne pouvait pas être saisie.
# Les minimums ne sont pas convertis (ils ne servent qu'à écarter les valeurs absurdes).
# Miroir de FACTEUR_BORNES_DEVISE (pompage_solaire_section.js).
FACTEUR_BORNES_DEVISE = {'EUR': 1, 'USD': 1, 'HTG': 150, 'XOF': 700}

# Plafonds en euros des montants (miroir des `max` des règles `monnaie: true` du front).
PLAFONDS_ECO_EUR = {
    'capex': 1_000_000, 'opex_pv': 50_000, 'remplacement_onduleur': 10_000, 'opex_ge': 10_000,
    'remplacement_ge': 15_000, 'capex_batterie': 100_000, 'remplacement_batterie': 100_000,
}
PLAFONDS_PLAN_EUR = {
    'capex_pompe': 1_000_000, 'capex_materiel_pompage': 1_000_000, 'capex_genie_civil_pose': 500_000,
    'capex_transport': 200_000, 'capex_terrain': 50_000, 'capex_pv': 1_000_000, 'capex_ge': 100_000, 'capex_batterie': 100_000,
    'entretien_ge': 10_000, 'remplacement_ge': 100_000, 'remplacement_batterie': 100_000,
    'entretien': 5000, 'remplacement_onduleur': 10_000, 'subvention': 999_999.99, 'emprunt': 999_999.99,
    'amortissement_annuel': 1_000_000,
}


def verifier_plafonds_devise(modele, plafonds):
    """Plafonds des montants convertis dans la devise du modèle ou selon le taux de conversion actif (champs None ignorés)."""
    taux_conv = getattr(modele, 'taux_conversion', None)
    if taux_conv is not None:
        if not (0 < taux_conv < 1000):
            raise ValueError("Le taux de conversion doit être strictement compris entre 0 et 1000.")
        facteur = float(taux_conv)
    else:
        facteur = FACTEUR_BORNES_DEVISE.get(getattr(modele, 'devise', 'EUR'), 1)
    for champ, plafond in plafonds.items():
        valeur = getattr(modele, champ, None)
        if valeur is not None and valeur > plafond * facteur:
            raise ValueError(f"{champ} : doit être inférieur ou égal à {plafond * facteur:,.2f} {modele.devise}".replace(',', ' '))


class CalculatricePertesParams(BaseModel):
    """Onglet « Calcul des pertes de charge » (transmis seulement s'il a été ouvert)."""
    model_config = ConfigDict(extra="ignore")

    longueur_m: float = Field(ge=1, le=5000)
    diametre_mm: float = Field(ge=0.1, le=500)
    debit_m3h: float = Field(ge=1, le=50)
    coef_accessoires: float = Field(ge=1.1, le=1.7)


class ChoixPompeParams(BaseModel):
    """Pompe retenue : aucune (fabricant par défaut), une référence du catalogue ou une saisie libre."""
    model_config = ConfigDict(extra="ignore")

    catalogue_id: Optional[int] = Field(default=None, ge=1)
    reference_personnalisee: Optional[str] = None

    @field_validator('reference_personnalisee')
    @classmethod
    def _reference(cls, v):
        if v is None or v.strip() == '':
            return None
        v = v.strip()
        if not MOTIF_REFERENCE_POMPE.match(v):
            raise ValueError("lettres, chiffres, tirets et espaces uniquement, 30 caractères maximum")
        return v


class AnalyseEconomiqueParams(BaseModel):
    """Section « Analyse économique »."""
    model_config = ConfigDict(extra="ignore")

    devise: Literal['EUR', 'USD', 'HTG', 'XOF']
    taux_conversion: Optional[float] = None
    conversion_devise: Optional[dict] = None
    # Montants : plafonds selon la devise (PLAFONDS_ECO_EUR), vérifiés par _plafonds.
    capex: float = Field(ge=1)
    opex_pv: float = Field(ge=0)
    indexation_opex_pv: float = Field(ge=1, le=15)
    remplacement_onduleur: float = Field(ge=500)
    # Groupe électrogène et carburant : type de système 'groupe' seulement (exigés par
    # PompageSolaireRequest) ; sans groupe, absents et comptés à 0 par le calcul.
    opex_ge: Optional[float] = Field(default=None, ge=100)
    remplacement_ge: Optional[float] = Field(default=None, ge=500)
    prix_carburant: Optional[float] = Field(default=None, ge=0.1, le=5000)
    inflation_carburant: Optional[float] = Field(default=None, ge=1, le=15)
    taux_actualisation: float = Field(ge=1, le=10)
    # Évolution dans le temps, commune au plan d'affaires.
    evolution_besoins: float = Field(default=1.10, ge=1, le=2)
    degradation_pv: float = Field(default=0.3, ge=0.1, le=5)
    # Batteries de secours (système 'batteries' seulement, exigées par PompageSolaireRequest).
    capex_batterie: Optional[float] = Field(default=None, ge=100)
    remplacement_batterie: Optional[float] = Field(default=None, ge=100)
    duree_vie_batterie: Optional[int] = Field(default=None, ge=3, le=15)

    @model_validator(mode='after')
    def _plafonds(self):
        verifier_plafonds_devise(self, PLAFONDS_ECO_EUR)
        return self


# Écart toléré (en unité monétaire) entre la somme des lots du Capex et le Capex de la pompe solaire.
TOLERANCE_SOMME_LOTS_CAPEX = 1.0


class PlanAffairesRequest(BaseModel):
    """Payload de POST /api/pompage_solaire/plan_affaires (plan d'affaires : vente d'eau).

    Bornes miroir de REGLES_PLAN (pompage_solaire_section.js). Les données du dimensionnement
    (volumes mensuels, carburant d'un pompage tout au groupe) viennent du dernier calcul du navigateur ;
    l'évolution des besoins et la dégradation des panneaux, de l'analyse économique.
    """
    model_config = ConfigDict(extra="ignore")

    devise: Literal['EUR', 'USD', 'HTG', 'XOF'] = 'EUR'
    taux_conversion: Optional[float] = None
    conversion_devise: Optional[dict] = None
    # Capex de la pompe solaire (analyse économique) et ses trois lots, dont la somme doit l'égaler.
    # Montants : plafonds selon la devise (PLAFONDS_PLAN_EUR), vérifiés dans _coherence.
    capex_pompe: float = Field(ge=1)
    capex_materiel_pompage: float = Field(ge=1)
    capex_genie_civil_pose: float = Field(ge=0)
    capex_transport: float = Field(ge=0)
    # Acquisition du terrain : hors lots de la pompe solaire, non amortie (valeur résiduelle).
    capex_terrain: float = Field(default=0, ge=0)

    # hybride = système 'groupe', stockage = système 'batteries' (type de système de la section 1).
    hybride: bool = False
    stockage: bool = False
    capex_pv: Optional[float] = Field(default=None, ge=0)
    capex_ge: Optional[float] = Field(default=None, ge=300)
    capex_batterie: Optional[float] = Field(default=None, ge=100)
    entretien_ge: Optional[float] = Field(default=None, ge=100)
    remplacement_ge: Optional[float] = Field(default=None, ge=300)
    remplacement_batterie: Optional[float] = Field(default=None, ge=100)
    duree_vie_batterie: int = Field(default=10, ge=3, le=15)
    carburant_sans_solaire_l: float = Field(default=0, ge=0, le=1e9)
    prix_carburant: Optional[float] = Field(default=None, ge=0.1, le=5000)
    inflation_carburant: Optional[float] = Field(default=None, ge=1, le=15)

    # Évolution dans le temps (saisies de l'analyse économique, communes aux deux études).
    evolution_besoins: float = Field(ge=1, le=2)
    degradation_pv: float = Field(ge=0.1, le=5)

    entretien: float = Field(ge=100)
    indexation_entretien: float = Field(ge=1, le=10)
    remplacement_onduleur: float = Field(ge=500)
    tarif_m3: float = Field(ge=0.1, le=300_000)
    indexation_tarif: float = Field(ge=1, le=10)
    part_pertes: float = Field(ge=2, le=50)
    taux_actualisation: float = Field(ge=1, le=10)
    horizon: Literal[5, 10, 15, 20] = 20

    # Financement : montants positifs, inférieurs à 1 000 000.
    subvention: float = Field(default=0, ge=0)
    emprunt: float = Field(default=0, ge=0)
    taux_emprunt: Optional[float] = Field(default=None, ge=0, le=20)
    duree_emprunt: Optional[int] = Field(default=None, ge=1, le=30)

    # Fiscalité et valeur résiduelle (options) ; amortissement linéaire ou montant constant par an.
    impots: bool = False
    taux_impot: Optional[float] = Field(default=None, ge=1, le=50)
    valeur_residuelle: bool = False
    methode_amortissement: Literal['lineaire', 'constant'] = 'lineaire'
    duree_amortissement: Optional[int] = Field(default=None, ge=1, le=40)
    amortissement_annuel: Optional[float] = Field(default=None, ge=1)

    monthly_pumped: List[float] = Field(min_length=12, max_length=12)
    monthly_needs: List[float] = Field(min_length=12, max_length=12)

    @field_validator('monthly_pumped', 'monthly_needs')
    @classmethod
    def _volumes(cls, v):
        if any((x < 0 or x > 1e9) for x in v):
            raise ValueError("volume mensuel hors bornes (0 à 1e9 m³)")
        return v

    def capex_total(self):
        return (self.capex_pompe + self.capex_terrain + ((self.capex_pv or 0) if (self.hybride or self.stockage) else 0)
                + ((self.capex_ge or 0) if self.hybride else 0) + ((self.capex_batterie or 0) if self.stockage else 0))

    @model_validator(mode='after')
    def _coherence(self):
        verifier_plafonds_devise(self, PLAFONDS_PLAN_EUR)
        if self.hybride and self.stockage:
            raise ValueError("un seul type de système : groupe électrogène d'appoint OU batteries de secours")
        somme = self.capex_materiel_pompage + self.capex_genie_civil_pose + self.capex_transport
        if abs(somme - self.capex_pompe) > TOLERANCE_SOMME_LOTS_CAPEX:
            raise ValueError(f"la somme des trois lots ({somme:g}) doit être égale au Capex de la pompe solaire ({self.capex_pompe:g})")
        if (self.hybride or self.stockage) and self.capex_pv is None:
            raise ValueError("Capex de l'installation PV requis (cas hybride ou avec stockage)")
        if self.hybride and None in (self.capex_ge, self.prix_carburant, self.inflation_carburant,
                                     self.entretien_ge, self.remplacement_ge):
            raise ValueError("cas hybride : Capex, entretien et remplacement du groupe, prix et indexation du carburant requis")
        if self.stockage and None in (self.capex_batterie, self.remplacement_batterie):
            raise ValueError("stockage : prix et remplacement de la batterie requis")
        if self.emprunt > 0 and None in (self.taux_emprunt, self.duree_emprunt):
            raise ValueError("emprunt : taux et durée requis")
        if self.subvention + self.emprunt > self.capex_total() + TOLERANCE_SOMME_LOTS_CAPEX:
            raise ValueError(f"subvention + emprunt ({self.subvention + self.emprunt:g}) dépassent le Capex total ({self.capex_total():g})")
        if self.impots and self.taux_impot is None:
            raise ValueError("impôts : taux requis")
        if self.impots or self.valeur_residuelle:
            if self.methode_amortissement == 'lineaire' and self.duree_amortissement is None:
                raise ValueError("amortissement linéaire : durée requise")
            if self.methode_amortissement == 'constant' and self.amortissement_annuel is None:
                raise ValueError("amortissement constant : montant annuel requis")
        return self


class PompageSolaireRequest(BaseModel):
    """Payload de POST /api/pompage_solaire/irradiation (et de la route de référence /calcul)."""
    model_config = ConfigDict(extra="ignore")

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)

    # Ressource solaire (mêmes bornes que l'Analyse d'autonomie énergétique)
    angle: float = Field(ge=0, le=90)
    aspect: float = Field(ge=-90, le=180)
    perte_systeme: float = Field(ge=8, le=20)

    # Type de système (section 1) ; paramètres des batteries exigés pour 'batteries'.
    systeme: SystemePompage = 'fil_soleil'
    autonomie_batterie_j: Optional[float] = Field(default=None, ge=0.5, le=5)
    dod_batterie_pct: Optional[float] = Field(default=None, ge=30, le=95)
    rendement_batterie_pct: Optional[float] = Field(default=None, ge=70, le=98)

    # Hydraulique
    pump_type: Literal['forage', 'surface'] = 'forage'
    h_aspiration: float
    h_tank: float = Field(ge=0, le=2000)
    daily_need: float = Field(ge=5, le=2000)
    losses_pipe: float = Field(ge=1, le=15)
    pump_efficiency: float = Field(ge=0.3, le=0.8)

    # Installation envisagée (facultatif : vide ou 0 = non renseignée)
    puissance_reelle_installee_kwc: Optional[float] = None
    # Seuil de démarrage : sans objet avec batteries (remplacé par leur rendement), exigé sinon.
    coef_reduction_pomp: Optional[float] = Field(default=None, ge=0.8, le=0.97)
    # Marge sur la puissance PV nécessaire (puissance calculée x coefficient).
    coef_surdimensionnement: float = Field(default=1.1, ge=1, le=2)
    # Groupe électrogène : type 'groupe' seulement (sans groupe, carburant et CO2 du groupe à 0).
    conso_specifique_ge: Optional[float] = Field(default=None, ge=0.5, le=2)
    facteur_emission_co2: Optional[float] = Field(default=None, ge=0.1, le=2)

    # Intégration du calepinage : production mensuelle réelle (kWh AC) du calcul « vente en totalité ».
    integration_calepinage: bool = False
    production_mensuelle_kwh: Optional[List[float]] = Field(default=None, min_length=12, max_length=12)

    calculatrice_pertes: Optional[CalculatricePertesParams] = None
    pompe: Optional[ChoixPompeParams] = None
    economie: Optional[AnalyseEconomiqueParams] = None

    @field_validator('puissance_reelle_installee_kwc')
    @classmethod
    def _puissance_installee(cls, v):
        if v is None or v == 0:
            return None
        if not (0.1 <= v <= 1000):
            raise ValueError("doit être comprise entre 0.1 et 1000 kWc (ou laissée vide)")
        return v

    @field_validator('production_mensuelle_kwh')
    @classmethod
    def _production(cls, v):
        if v is not None and any((x < 0 or x > 1e9) for x in v):
            raise ValueError("production mensuelle hors bornes (0 à 1e9 kWh)")
        return v

    @model_validator(mode='after')
    def _h_aspiration_selon_type(self):
        bas, haut = BORNES_H_ASPIRATION[self.pump_type]
        if not (bas <= self.h_aspiration <= haut):
            libelle = ("Profondeur niveau dynamique" if self.pump_type == 'forage'
                       else "Hauteur d'aspiration")
            raise ValueError(f"{libelle} : doit être comprise entre {bas:g} et {haut:g} m")
        return self

    @model_validator(mode='after')
    def _selon_systeme(self):
        if self.systeme == 'batteries':
            if None in (self.autonomie_batterie_j, self.dod_batterie_pct, self.rendement_batterie_pct):
                raise ValueError("batteries de secours : autonomie, profondeur de décharge et rendement requis")
            if self.economie is not None and None in (self.economie.capex_batterie, self.economie.remplacement_batterie,
                                                      self.economie.duree_vie_batterie):
                raise ValueError("batteries de secours : Capex, remplacement et durée de vie des batteries requis")
        elif self.coef_reduction_pomp is None:
            raise ValueError("coef_reduction_pomp : champ requis")
        if self.systeme == 'groupe':
            if None in (self.conso_specifique_ge, self.facteur_emission_co2):
                raise ValueError("groupe électrogène : consommation spécifique et facteur d'émission requis")
            if self.economie is not None and None in (self.economie.opex_ge, self.economie.remplacement_ge,
                                                      self.economie.prix_carburant, self.economie.inflation_carburant):
                raise ValueError("groupe électrogène : Opex, remplacement, prix et inflation du carburant requis")
        return self


# ---------------------------------------------------------------------------------------------
# Persistance en base (POST /concevoir_mon_projet/parametre-projet/<id>/pompage-solaire/save)
# ---------------------------------------------------------------------------------------------
# Les saisies sont un BROUILLON : une valeur hors bornes ou vide est acceptée (elle est ramenée à la
# valeur par défaut à la restauration, cf. restaurer() côté front) ; seules la liste des champs, leur
# type et leur longueur sont contraints. Miroir de CHAMPS_PERSISTES (pompage_solaire_section.js).
CHAMPS_NUMERIQUES_POMPAGE = frozenset({
    'ps_h_aspiration', 'ps_h_tank', 'ps_daily_need', 'ps_losses_pipe', 'ps_pump_efficiency',
    'ps_angle', 'ps_aspect', 'ps_perte_systeme', 'ps_conso_specifique_ge', 'ps_facteur_emission_co2',
    'ps_coef_reduction_pomp', 'ps_coef_surdimensionnement', 'ps_puissance_reelle_installee_kwc',
    'ps_eco_capex', 'ps_eco_opex_pv', 'ps_eco_opex_ge', 'ps_eco_remplacement_ge',
    'ps_eco_prix_carburant', 'ps_eco_inflation', 'ps_eco_taux', 'ps_eco_indexation_opex_pv',
    'ps_eco_remplacement_onduleur', 'ps_eco_evolution_besoins', 'ps_eco_degradation_pv',
    'ps_m_length', 'ps_m_diam', 'ps_m_flow', 'ps_m_acc',
    'ps_pompe_nombre',  # nombre de pompes du montage série / parallèle
    # Batteries de secours (système 'batteries')
    'ps_bat_autonomie', 'ps_bat_dod', 'ps_bat_rendement',
    'ps_eco_capex_batterie', 'ps_eco_remplacement_batterie', 'ps_eco_duree_vie_batterie',
    # Plan d'affaires (vente d'eau)
    'ps_pa_capex_materiel', 'ps_pa_capex_genie_civil', 'ps_pa_capex_transport', 'ps_pa_capex_terrain', 'ps_pa_capex_pv',
    'ps_pa_capex_ge', 'ps_pa_capex_batterie', 'ps_pa_entretien', 'ps_pa_indexation_entretien',
    'ps_pa_tarif_m3', 'ps_pa_indexation_tarif', 'ps_pa_taux', 'ps_pa_part_pertes', 'ps_pa_entretien_ge',
    'ps_pa_rempl_onduleur', 'ps_pa_rempl_ge', 'ps_pa_rempl_batterie', 'ps_pa_subvention', 'ps_pa_emprunt',
    'ps_pa_taux_emprunt', 'ps_pa_duree_emprunt', 'ps_pa_taux_impot', 'ps_pa_duree_amortissement',
    'ps_pa_amortissement_annuel',
    'ps_conv_taux',
})
CHAMPS_TEXTE_POMPAGE = {
    'ps_systeme': re.compile(r"^(fil_soleil|groupe|batteries)?$"),
    'ps_pump_type': re.compile(r"^(forage|surface)?$"),
    'ps_eco_devise': re.compile(r"^(EUR|USD|HTG|XOF)?$"),
    'ps_conv_option': re.compile(r"^(EUR_FCFA|USD_FCFA|USD_HTG|EUR_HTG|CUSTOM)?$"),
    'ps_conv_source': re.compile(r"^(EUR|USD|FCFA|HTG|XOF)?$"),
    'ps_conv_cible': re.compile(r"^(EUR|USD|FCFA|HTG|XOF)?$"),
    'ps_reference_pompe_installee': re.compile(r"^[A-Za-zÀ-ÖØ-öø-ÿ0-9\- ]{0,30}$"),
    # Identifiant catalogue (entier) ou choix « référence personnalisée ».
    'ps_pompe_choix': re.compile(r"^(\d{1,10}|__perso__)?$"),
    'ps_pompe_filtre_fabricant': re.compile(r"^[^<>\x00-\x1f]{0,120}$"),
    'ps_pompe_montage': re.compile(r"^(unique|parallele|serie)?$"),
    'ps_m_material': re.compile(r"^(\d{1,4})?$"),  # coefficient de Hazen-Williams
    'ps_pa_horizon': re.compile(r"^(5|10|15|20)?$"),
    # Anciennes cases « hybride » / « stockage » du plan d'affaires, remplacées par ps_systeme : encore
    # acceptées (sauvegardes et variantes antérieures), relues une fois pour en déduire le type de système.
    'ps_pa_hybride': re.compile(r"^(0|1)?$"),   # cases à cocher : '1' cochée, '0' décochée
    'ps_pa_stockage': re.compile(r"^(0|1)?$"),
    'ps_pa_impots': re.compile(r"^(0|1)?$"),
    'ps_pa_valeur_residuelle': re.compile(r"^(0|1)?$"),
    'ps_pa_methode_amortissement': re.compile(r"^(lineaire|constant)?$"),
}
def _est_nombre(valeur):
    """Nombre fini, tel qu'un <input type="number"> peut le produire (« 0.6 », « 1e3 »...)."""
    if len(valeur) > 24:
        return False
    try:
        x = float(valeur.replace(',', '.'))
    except ValueError:
        return False
    return x == x and x not in (float('inf'), float('-inf'))

# Résultats du dernier calcul : arbre JSON réaffiché tel quel. Contraintes génériques (profondeur,
# taille, chaînes sans balisage) : une valeur stockée ne doit jamais pouvoir injecter du HTML à la
# réouverture (y compris chez un administrateur qui consulte le projet).
PROFONDEUR_MAX_RESULTATS = 8
LONGUEUR_MAX_CHAINE_RESULTATS = 500
ELEMENTS_MAX_RESULTATS = 20_000
TAILLE_MAX_SAUVEGARDE_POMPAGE = 512 * 1024


def _verifier_arbre_resultats(valeur, profondeur=0, compteur=None):
    compteur = compteur if compteur is not None else [0]
    compteur[0] += 1
    if compteur[0] > ELEMENTS_MAX_RESULTATS:
        raise ValueError("résultats trop volumineux")
    if profondeur > PROFONDEUR_MAX_RESULTATS:
        raise ValueError("résultats trop imbriqués")
    if valeur is None or isinstance(valeur, bool):
        return
    if isinstance(valeur, (int, float)):
        if valeur != valeur or valeur in (float('inf'), float('-inf')):
            raise ValueError("nombre non fini dans les résultats")
        return
    if isinstance(valeur, str):
        if len(valeur) > LONGUEUR_MAX_CHAINE_RESULTATS or re.search(r"[<>\x00-\x08\x0b-\x1f]", valeur):
            raise ValueError("texte non autorisé dans les résultats")
        return
    if isinstance(valeur, list):
        for v in valeur:
            _verifier_arbre_resultats(v, profondeur + 1, compteur)
        return
    if isinstance(valeur, dict):
        for k, v in valeur.items():
            if not isinstance(k, str) or len(k) > 80 or re.search(r"[<>\x00-\x1f]", k):
                raise ValueError("clé non autorisée dans les résultats")
            _verifier_arbre_resultats(v, profondeur + 1, compteur)
        return
    raise ValueError("type de valeur non autorisé dans les résultats")


class PompageSolaireSaisies(BaseModel):
    model_config = ConfigDict(extra="forbid")

    champs: dict = Field(default_factory=dict)
    integration_calepinage: bool = True

    @field_validator('champs')
    @classmethod
    def _champs(cls, v):
        for cle, valeur in v.items():
            if not isinstance(valeur, str):
                raise ValueError(f"{cle} : valeur texte attendue")
            valeur = valeur.strip()
            if cle in CHAMPS_NUMERIQUES_POMPAGE:
                if valeur and not _est_nombre(valeur):
                    raise ValueError(f"{cle} : nombre attendu")
            elif cle in CHAMPS_TEXTE_POMPAGE:
                if not CHAMPS_TEXTE_POMPAGE[cle].match(valeur):
                    raise ValueError(f"{cle} : valeur non autorisée")
            else:
                raise ValueError(f"champ inconnu : {cle}")
        return {k: s.strip() for k, s in v.items()}


class PompageSolaireSauvegarde(BaseModel):
    """Corps de la sauvegarde en base : saisies (brouillon) + dernier calcul (facultatif).

    `resultats` absent = conserver le dernier calcul enregistré ; `null` explicite = l'effacer.
    """
    model_config = ConfigDict(extra="forbid")

    saisies: PompageSolaireSaisies
    resultats: Optional[dict] = None

    @field_validator('resultats')
    @classmethod
    def _resultats(cls, v):
        if v is not None:
            _verifier_arbre_resultats(v)
        return v
