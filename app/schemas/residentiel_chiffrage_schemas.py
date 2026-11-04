"""
Schémas Pydantic de validation stricte pour le CAPEX du "Chiffrage & Devis Résidentiel"
(POST .../parametre-projet/<id>/residentiel-chiffrage/save).

Contrairement aux autres schémas de ce dossier (cf. irve_schemas.py, extra="ignore" mais
coercition "lax" par défaut), ce module applique `strict=True` : demande explicite de
l'utilisateur ("ne jamais modifier, tronquer ou corriger silencieusement les données") — une
valeur numérique reçue sous forme de chaîne JSON (ex. "5" au lieu de 5) est REJETÉE plutôt que
coercée, plutôt que d'être silencieusement convertie comme le ferait Pydantic par défaut.

Les bornes de quantité/PU HT dépendent du SOUS-TYPE de chaque ligne (`line.key`, cf.
ResidentielValidationRules.js::buildDefaultPostes()), pas seulement du poste — la validation
"métier" (quantité/PU HT) n'est donc pas exprimée en champs Pydantic déclaratifs (la borne
dépendrait d'un champ frère dynamique) mais dans la fonction `validate_capex_business_rules()`
ci-dessous, appelée après la validation Pydantic (qui, elle, garantit déjà la forme/le type de
chaque champ). Un seul message d'erreur est renvoyé, sur le premier écart trouvé — même
convention que la gestion de pydantic.ValidationError déjà en place dans concevoir_mon_projet.py
(field = chemin exact, message = raison précise).
"""
from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# TVA autorisées : mêmes valeurs que le <select> côté frontend (ResidentielValidationRules.js::TVA_RATES).
TVA_RATES_AUTORISEES = (0, 5.5, 10, 20)
# Modes de saisie de la TVA du chiffrage — miroir de TVA_MODES (ResidentielValidationRules.js).
# 'par_ligne' : chaque taux modifiable (défaut, chiffrages existants) ; 'unique' : une TVA globale
# appliquée à toutes les lignes.
TVA_MODES = ('par_ligne', 'unique')
# Prix cible et marge cible du chiffrage — miroir de PRIX_CIBLE_RULES / MARGE_CIBLE_RULE
# (ResidentielValidationRules.js). Prix en €/Wc (x puissance du projet) ou prix de vente fixe.
PRIX_CIBLE_BORNES = {'wc': (0.3, 10.0), 'fixe': (500.0, 15_000_000.0)}
MARGE_CIBLE_BORNES = (1.0, 100.0)
TAUX_CONVERSION_MIN_EXCLUSIF = 0.0
TAUX_CONVERSION_MAX_EXCLUSIF = 1000.0


def valider_taux_conversion(taux, nom_champ: str = "tauxConversion") -> float:
    """Valide strictement le taux de conversion : 0 < taux < 1000."""
    if taux is None:
        return 1.0
    if isinstance(taux, bool):
        raise ValueError(f"{nom_champ} : valeur booléenne interdite.")
    try:
        val = float(taux)
    except (TypeError, ValueError):
        raise ValueError(f"{nom_champ} : valeur numérique attendue.")
    import math
    if not math.isfinite(val) or val <= TAUX_CONVERSION_MIN_EXCLUSIF or val >= TAUX_CONVERSION_MAX_EXCLUSIF:
        raise ValueError(
            f"{nom_champ} : le taux de conversion doit être strictement compris entre 0 et 1000 (0 < taux < 1000), reçu {taux}."
        )
    return val


def extraire_taux_conversion(data_blob: dict, capex_payload: Optional[dict] = None) -> float:
    """Extrait et valide le taux de conversion depuis le payload de sauvegarde."""
    if not isinstance(data_blob, dict):
        return 1.0
    conv = data_blob.get("conversionDevise")
    if not isinstance(conv, dict) and isinstance(capex_payload, dict):
        conv = capex_payload.get("conversionDevise")
    if isinstance(conv, dict) and conv.get("active"):
        raw = conv.get("rawRate", conv.get("rate"))
        if raw in (None, ""):
            raise ValueError("tauxConversion : le taux de conversion est obligatoire lorsque la conversion est activée.")
        return valider_taux_conversion(raw, "tauxConversion")
    raw_top = data_blob.get("tauxConversion")
    if raw_top is None and isinstance(capex_payload, dict):
        raw_top = capex_payload.get("tauxConversion")
    if raw_top not in (None, "", 1, 1.0):
        return valider_taux_conversion(raw_top, "tauxConversion")
    return 1.0

# Longueur/nombre de mots maximum pour tout champ "Désignation"/"Référence" (règle de texte globale).
TEXTE_MAX_CARACTERES = 30
TEXTE_MAX_MOTS = 5


def _valider_texte_court(v: str, nom_champ: str) -> str:
    """Règle de texte globale : chaîne, max 30 caractères ET max 5 mots. Lève ValueError avec un
    message précisant lequel des deux critères a échoué (jamais de troncature silencieuse)."""
    if len(v) > TEXTE_MAX_CARACTERES:
        raise ValueError(
            f"{nom_champ} : {len(v)} caractères saisis, maximum {TEXTE_MAX_CARACTERES} autorisés."
        )
    nb_mots = len(v.split())
    if nb_mots > TEXTE_MAX_MOTS:
        raise ValueError(
            f"{nom_champ} : {nb_mots} mots saisis, maximum {TEXTE_MAX_MOTS} autorisés."
        )
    return v


class ResidentielLigneSchema(BaseModel):
    """Une ligne (Désignation/Référence/Qté/PU HT/TVA) d'un poste CAPEX résidentiel."""
    model_config = ConfigDict(extra="ignore", strict=True)

    # CORRECTIF (découvert par le script de vérification, cas réel : "Pilotage énergétique /
    # Domotique" fait 32 caractères, seed non éditable du poste 'pilotage') : lockedDesignation est
    # déclaré AVANT designation pour que le field_validator de ce dernier puisse le lire via
    # info.data (Pydantic v2 : seuls les champs déjà validés, dans l'ordre de déclaration, sont
    # disponibles dans info.data) — nécessaire pour obtenir un `loc` d'erreur précis
    # ("...lines.N.designation") plutôt qu'un model_validator moins précis.
    lockedDesignation: bool = False
    designation: str
    reference: str
    qte: float
    puHt: float
    tvaPct: float
    # Identifiant stable de sous-type (ex. "panneaux_solaires", "cable_dc") — absent/None pour une
    # ligne ajoutée en freeform via "+ Ajouter une ligne" (validate_capex_business_rules() applique
    # alors le repli par poste). Purement informatif ici, aucune contrainte de forme.
    key: Optional[str] = None
    tvaManual: bool = False

    @field_validator('designation')
    @classmethod
    def _valider_designation_si_editable(cls, v: str, info) -> str:
        # La règle de texte globale vise à borner la SAISIE UTILISATEUR — elle n'a aucun sens (et
        # casserait définitivement l'enregistrement de ce poste) appliquée à une désignation
        # verrouillée (lockedDesignation=True), fixée par buildDefaultPostes() et jamais éditable
        # côté UI (cf. ResidentielCapexTable.js::attachEvents(), écouteur non attaché si
        # lockedDesignation). Seule une désignation ÉDITABLE (ligne freeform ajoutée via "+ Ajouter
        # une ligne") est contrainte.
        if info.data.get('lockedDesignation'):
            return v
        return _valider_texte_court(v, 'Désignation')

    @field_validator('reference')
    @classmethod
    def _valider_reference(cls, v: str) -> str:
        # La colonne "Référence" est masquée pour certains postes (hideReference: true côté JS) et
        # la ligne peut alors n'avoir jamais reçu de référence : une chaîne vide reste valide, la
        # règle de longueur/mots ne s'applique qu'à un texte réellement saisi.
        if not v:
            return v
        return _valider_texte_court(v, 'Référence')

    @field_validator('tvaPct')
    @classmethod
    def _valider_tva(cls, v: float) -> float:
        if v not in TVA_RATES_AUTORISEES:
            raise ValueError(
                f"TVA : {v}% n'est pas un taux autorisé ({', '.join(str(t) for t in TVA_RATES_AUTORISEES)})."
            )
        return v


class ResidentielPosteSchema(BaseModel):
    """Un poste CAPEX (ex. 'materiels_pv') et ses lignes."""
    model_config = ConfigDict(extra="ignore", strict=True)

    key: str
    # Liste vide acceptée : le tableau laisse supprimer toutes les lignes d'un poste (bouton ×) — le
    # poste vaut alors 0, comme le gèrent déjà le devis PDF (poste vide non imprimé) et les totaux.
    lines: List[ResidentielLigneSchema] = Field(default_factory=list)


class PrixCibleSchema(BaseModel):
    """Prix cible : mode ('wc' | 'fixe') et valeur (absente tant qu'elle n'est pas saisie)."""
    model_config = ConfigDict(extra="ignore", strict=True)

    mode: Literal['wc', 'fixe']
    valeur: Optional[float] = None


class ResidentielCapexSchema(BaseModel):
    """Payload complet `data.capex` de POST .../residentiel-chiffrage/save."""
    model_config = ConfigDict(extra="ignore", strict=True)

    postes: List[ResidentielPosteSchema] = Field(min_length=1)
    viewMode: Optional[str] = None
    # Type de matériel de conversion choisi dans le poste "Matériels photovoltaïques" (cf.
    # CONVERSION_LOCKS plus bas). Absent sur un chiffrage enregistré avant l'ajout du sélecteur.
    conversionType: Optional[Literal['chaine', 'optimiseurs', 'micro']] = None
    # Profil PRO : lignes conditionnelles masquées pour le type de structure du projet (cf.
    # LIGNES_CONDITIONNELLES) — hors totaux, donc non contrôlées. Seules les clés de
    # LIGNES_CONDITIONNELLES sont prises en compte, une autre clé ne dispense d'aucun contrôle.
    lignesExclues: Optional[List[str]] = None
    # TVA globale (absents sur un chiffrage antérieur = mode 'par_ligne', comportement inchangé).
    tvaMode: Optional[Literal['par_ligne', 'unique']] = None
    tvaGlobale: Optional[float] = None
    # Prix cible et marge cible (absents sur un chiffrage antérieur : défauts côté navigateur).
    prixCible: Optional[PrixCibleSchema] = None
    margeCible: Optional[float] = None
    # Poste « Main-d'œuvre » compté dans le devis. False : poste à 0, hors totaux et hors contrôle de
    # bornes (cf. poste_hors_devis). Absent (chiffrage antérieur à la case) : compté, comme avant.
    inclureMainOeuvre: Optional[bool] = None
    tauxConversion: Optional[float] = None
    # Mode de chiffrage du CAPEX et saisies simples (absents sur un chiffrage antérieur : détaillé).
    # Bornes contrôlées par valider_capex_simple() (la tranche du CAPEX total dépend de la puissance
    # du projet, connue du serveur seulement).
    capexMode: Optional[Literal['wc', 'fixe', 'detaille']] = None
    capexPrixWc: Optional[float] = None
    capexFixeK: Optional[float] = None

    @field_validator('margeCible')
    @classmethod
    def _valider_marge_cible(cls, v: Optional[float]) -> Optional[float]:
        mini, maxi = MARGE_CIBLE_BORNES
        if v is not None and not mini <= v <= maxi:
            raise ValueError(f"Marge cible : entre {mini:g} et {maxi:g} % (saisie : {v:g}).")
        return v

    @field_validator('tvaGlobale')
    @classmethod
    def _valider_tva_globale(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v not in TVA_RATES_AUTORISEES:
            raise ValueError(
                f"TVA globale : {v}% n'est pas un taux autorisé ({', '.join(str(t) for t in TVA_RATES_AUTORISEES)})."
            )
        return v

    @model_validator(mode='after')
    def _valider_tva_unique(self):
        # Mode TVA unique : toutes les lignes portent la TVA globale (le navigateur l'applique à
        # chaque modification) — un écart signale un payload incohérent, refusé sans correction.
        if self.tvaMode != 'unique':
            return self
        if self.tvaGlobale is None:
            raise ValueError("TVA globale manquante alors que le mode « TVA unique » est choisi.")
        for poste in self.postes:
            for ligne in poste.lines:
                if ligne.tvaPct != self.tvaGlobale:
                    raise ValueError(
                        f"TVA de la ligne « {ligne.designation} » ({ligne.tvaPct}%) différente de la "
                        f"TVA globale ({self.tvaGlobale}%) en mode « TVA unique »."
                    )
        return self

    @model_validator(mode='after')
    def _valider_prix_cible_avec_taux(self):
        facteur = valider_taux_conversion(self.tauxConversion) if self.tauxConversion is not None else 1.0
        if self.prixCible and self.prixCible.valeur is not None:
            base_min, base_max = PRIX_CIBLE_BORNES[self.prixCible.mode]
            mini = round(base_min * facteur, 4) if facteur < 1.0 else base_min
            maxi = round(base_max * facteur, 2)
            if not mini <= self.prixCible.valeur <= maxi:
                unite = '/Wc' if self.prixCible.mode == 'wc' else ''
                raise ValueError(
                    f"Prix cible : entre {mini:g} et {maxi:g} {unite} (saisi : {self.prixCible.valeur:g})."
                )
        return self


# Modes de chiffrage du CAPEX simplifiés — miroir de CAPEX_PRIX_WC_RULE / CAPEX_FIXE_TRANCHES
# (ResidentielValidationRules.js). Saisies sur la base du moteur (HT en PRO, TTC en résidentiel).
CAPEX_MODES_SIMPLES = ('wc', 'fixe')
CAPEX_PRIX_WC_BORNES = (0.1, 5.0)  # €/Wc
# (puissance min incluse, puissance max exclue — incluse pour la dernière —, CAPEX min, CAPEX max en k€)
CAPEX_FIXE_TRANCHES = (
    (0.0, 3.0, 0.1, 10.0, 'moins de 3 kWc'),
    (3.0, 9.0, 3.0, 30.0, 'de 3 à 9 kWc'),
    (9.0, 100.0, 9.0, 180.0, 'de 9 à 100 kWc'),
    (100.0, 500.0, 50.0, 800.0, 'de 100 à 500 kWc'),
    (500.0, 5000.0, 200.0, 10000.0, 'de 500 à 5 000 kWc'),
)
# CAPEX total enregistré pour un mode inactif : seulement l'enveloppe de toutes les tranches (la
# puissance a pu changer depuis la saisie).
CAPEX_FIXE_ENVELOPPE = (0.1, 10000.0)


def _bornes_converties(mini: float, maxi: float, facteur: float) -> Tuple[float, float]:
    # Convention de cette édition (cf. PrixCibleSchema / validate_capex_business_rules) : min réduit
    # seulement si facteur < 1 (arrondi au 1/10 000), max arrondi au centime.
    return (round(mini * facteur, 4) if facteur < 1.0 else mini), round(maxi * facteur, 2)


def tranche_capex_fixe(puissance_kwc, facteur: float = 1.0):
    """(min, max, libellé) du CAPEX total (k€) pour la puissance du projet, ou None hors 0-5 000 kWc.
    Puissance arrondie au centième, comme le champ « Puissance installée » lu par le navigateur."""
    if puissance_kwc is None or isinstance(puissance_kwc, bool):
        return None
    try:
        p = round(float(puissance_kwc), 2)
    except (TypeError, ValueError):
        return None
    if p <= 0:
        return None
    for i, (p_min, p_max, c_min, c_max, libelle) in enumerate(CAPEX_FIXE_TRANCHES):
        derniere = i == len(CAPEX_FIXE_TRANCHES) - 1
        if p >= p_min and (p <= p_max if derniere else p < p_max):
            mini, maxi = _bornes_converties(c_min, c_max, facteur)
            return mini, maxi, libelle
    return None


def valider_capex_simple(capex: 'ResidentielCapexSchema', puissance_kwc, taux_conversion: Optional[float] = None) -> None:
    """Contrôle des saisies « Prix au Wc » (€/Wc) et « CAPEX total » (k€) avant enregistrement —
    miroir de ResidentielCapexTable.js::erreursValidation. Valeur absente acceptée (pas encore
    saisie : le calcul de rentabilité l'exige côté navigateur). Prix au Wc toujours borné ; CAPEX total
    borné selon la tranche de puissance s'il est le mode actif, sinon par l'enveloppe des tranches.
    Lève ResidentielRuleError (jamais de correction)."""
    facteur = valider_taux_conversion(taux_conversion) if taux_conversion is not None else 1.0
    if capex.capexPrixWc is not None:
        mini, maxi = _bornes_converties(*CAPEX_PRIX_WC_BORNES, facteur)
        if not mini <= capex.capexPrixWc <= maxi:
            raise ResidentielRuleError(
                'capexPrixWc', f"Prix au Wc : entre {mini:g} et {maxi:g} devise/Wc (saisi : {capex.capexPrixWc:g}).")
    if capex.capexFixeK is None:
        return
    if capex.capexMode != 'fixe':
        mini, maxi = _bornes_converties(*CAPEX_FIXE_ENVELOPPE, facteur)
        if not mini <= capex.capexFixeK <= maxi:
            raise ResidentielRuleError(
                'capexFixeK', f"CAPEX total : entre {mini:g} et {maxi:g} k devise (saisi : {capex.capexFixeK:g}).")
        return
    tranche = tranche_capex_fixe(puissance_kwc, facteur)
    if tranche is None:
        raise ResidentielRuleError(
            'capexFixeK',
            "CAPEX total : puissance du projet inconnue ou hors du domaine prévu (jusqu'à 5 000 kWc) — "
            "lancez d'abord le calcul de production.")
    mini, maxi, libelle = tranche
    if not mini <= capex.capexFixeK <= maxi:
        raise ResidentielRuleError(
            'capexFixeK',
            f"CAPEX total, puissance {libelle} : entre {mini:g} et {maxi:g} k devise (saisi : {capex.capexFixeK:g}).")


# NOUVEAU (demande explicite : "validation stricte des données d'entrée pour les Charges annuelles
# (OPEX)") : bornes par charge — DOIT rester identique à OPEX_RULES dans
# ResidentielValidationRules.js (double-vérifié à la main).
OPEX_RULES = {
    'assurances': (0, 100),
    'communication': (0, 200),
    'visiteTechnique': (0, 200),
    'autres': (0, 200),
}


class ResidentielOpexSchema(BaseModel):
    """Payload `data.opex.charges` de POST .../residentiel-chiffrage/save — 4 charges annuelles
    fixes (TTC €/an), chacune bornée individuellement (cf. OPEX_RULES ci-dessus)."""
    model_config = ConfigDict(extra="ignore", strict=True)

    assurances: float
    communication: float
    visiteTechnique: float
    autres: float
    tauxConversion: Optional[float] = None

    @model_validator(mode='after')
    def _valider_bornes_opex(self):
        facteur = valider_taux_conversion(self.tauxConversion) if self.tauxConversion is not None else 1.0
        for cle, (b_min, b_max) in OPEX_RULES.items():
            val = getattr(self, cle)
            mini = round(b_min * facteur, 4) if facteur < 1.0 else b_min
            maxi = round(b_max * facteur, 2)
            if val < mini or val > maxi:
                raise ValueError(f"{cle} ({val}) doit être compris entre {mini} et {maxi}.")
        return self


class ResidentielRuleError(Exception):
    """Levée par validate_capex_business_rules() sur le premier écart de règle métier trouvé
    (quantité/PU HT hors plage pour le sous-type ou le poste concerné)."""

    def __init__(self, field: str, message: str):
        self.field = field
        self.message = message
        super().__init__(f"{field}: {message}")


# Règle par sous-type (line.key) : {qte: (min, max), puHt: (min, max)} — GLOBALE, pas dupliquée
# par poste : un même sous-type (ex. "onduleurs") a la même règle où qu'il apparaisse (cf.
# spec métier : "Onduleurs" cité à la fois pour Matériels photovoltaïques et Matériels
# électriques, avec la même plage 1-10). Doit rester rigoureusement identique à SUBTYPE_RULES
# dans ResidentielValidationRules.js (double-vérifié à la main, pas de génération partagée).
SUBTYPE_RULES = {
    'offre_commerciale': {'qte': (1, 1), 'puHt': (0, 5000)},
    'dp_mairie': {'qte': (1, 1), 'puHt': (0, 5000)},
    'demande_raccordement': {'qte': (1, 1), 'puHt': (0, 5000)},
    'consuel_mise_service': {'qte': (1, 1), 'puHt': (0, 5000)},

    'systeme_integration': {'qte': (1, 1), 'puHt': (0, 20000)},
    'onduleurs': {'qte': (0, 10), 'puHt': (0, 20000)},
    # Quantité imposée par le calepinage (lecture seule dans le tableau) : même plafond qu'en PRO.
    'panneaux_solaires': {'qte': (1, 50000), 'puHt': (0, 20000)},
    'optimiseurs': {'qte': (0, 100), 'puHt': (0, 20000)},
    'micro_onduleurs': {'qte': (0, 100), 'puHt': (0, 20000)},

    'coffret_dc': {'qte': (0, 2), 'puHt': (0, 20000)},
    'coffret_ac': {'qte': (1, 2), 'puHt': (0, 20000)},
    'coffret_consuel': {'qte': (1, 1), 'puHt': (0, 20000)},
    # Câbles : quantité en mètres, PU HT au mètre linéaire (0-200 €/ml) — override du PU HT
    # "général" (0-20000) du poste materiels_elec.
    'cable_dc': {'qte': (0, 2000), 'puHt': (0, 200)},
    'cable_ac': {'qte': (0, 100), 'puHt': (0, 200)},
    'cable_terre': {'qte': (0, 500), 'puHt': (0, 200)},

    'batterie': {'qte': (0, 10), 'puHt': (0, 20000)},
    # Frais d'activation batterie virtuelle : quantité 1 si elle est retenue, 0 sinon ; 50-500 €.
    'frais_activation_bv': {'qte': (0, 1), 'puHt': (50, 500)},
    'borne_recharge': {'qte': (0, 10), 'puHt': (0, 20000)},

    'pilotage': {'qte': (1, 1), 'puHt': (0, 3000)},

    'main_oeuvre': {'qte': (1, 1), 'puHt': (0, 50000)},

    'pompage_solaire': {'qte': (0, 20), 'puHt': (0, 3000)},
    'autres_generaux': {'qte': (0, 20), 'puHt': (0, 3000)},

    'aides_primes': {'qte': (1, 1), 'puHt': (0, 50000)},
}

# Repli par poste (line.key absent — ligne freeform — ou clé de sous-type non reconnue, ex.
# 'autres' du poste materiels_elec pour lequel le spec métier ne donne pas de plage de quantité
# explicite : repli sur le garde-fou générique déjà en place côté frontend, CAPEX_QTE_RULE
# (0-999) — cf. plan approuvé). Doit rester identique à POSTE_DEFAULT_RULES en JS.
POSTE_DEFAULT_RULES = {
    'etudes': {'qte': (1, 1), 'puHt': (0, 5000)},
    'materiels_pv': {'qte': (0, 999), 'puHt': (0, 20000)},
    'materiels_elec': {'qte': (0, 999), 'puHt': (0, 20000)},
    'stockage': {'qte': (0, 10), 'puHt': (0, 20000)},
    'borne': {'qte': (0, 10), 'puHt': (0, 20000)},
    'pilotage': {'qte': (1, 1), 'puHt': (0, 3000)},
    'main_oeuvre': {'qte': (1, 1), 'puHt': (0, 50000)},
    'autres': {'qte': (0, 20), 'puHt': (0, 3000)},
    'aides': {'qte': (1, 1), 'puHt': (0, 50000)},
}


# Profil PRO / Grand projet (même tableau, installations de 100 kWc à plusieurs MWc) : bornes
# élargies + cartes Structure / Génie civil / Gestion des eaux pluviales. 'zero': True -> 0 est aussi
# accepté (« non concerné ») pour la quantité comme pour le PU HT, sinon la valeur doit tenir dans la
# plage. Doit rester identique à SUBTYPE_RULES_PRO / POSTE_DEFAULT_RULES_PRO en JS.
SUBTYPE_RULES_PRO = {
    'offre_commerciale': {'qte': (1, 1), 'puHt': (0, 50000)},
    'dp_mairie': {'qte': (1, 1), 'puHt': (0, 50000)},
    'demande_raccordement': {'qte': (1, 1), 'puHt': (0, 50000)},
    'consuel_mise_service': {'qte': (1, 1), 'puHt': (0, 50000)},

    'panneaux_solaires': {'qte': (1, 50000), 'puHt': (0, 20000)},
    'onduleurs': {'qte': (0, 500), 'puHt': (0, 200000)},
    'micro_onduleurs': {'qte': (0, 50000), 'puHt': (0, 20000)},
    'optimiseurs': {'qte': (0, 50000), 'puHt': (0, 20000)},

    'coffret_dc': {'qte': (0, 200), 'puHt': (0, 200000)},
    'coffret_ac': {'qte': (1, 50), 'puHt': (0, 200000)},
    'coffret_consuel': {'qte': (1, 10), 'puHt': (0, 20000)},
    'cable_dc': {'qte': (0, 100000), 'puHt': (0, 500)},
    'cable_ac': {'qte': (0, 20000), 'puHt': (0, 500)},
    'cable_terre': {'qte': (0, 50000), 'puHt': (0, 500)},

    'structure_porteuse': {'qte': (1, 100), 'puHt': (200, 1000000), 'zero': True},
    'pannes': {'qte': (1, 500), 'puHt': (200, 500000), 'zero': True},
    'systeme_integration': {'qte': (1, 100), 'puHt': (100, 500000), 'zero': True},

    'fondations': {'qte': (1, 500), 'puHt': (500, 1000000), 'zero': True},
    'fourreaux': {'qte': (1, 5000), 'puHt': (500, 1000000), 'zero': True},
    'regard': {'qte': (1, 100), 'puHt': (100, 1000000), 'zero': True},
    'chambre_tirage': {'qte': (1, 100), 'puHt': (100, 1000000), 'zero': True},
    'autres_genie_civil': {'qte': (1, 100), 'puHt': (1000, 1000000), 'zero': True},
    'reprise_enrobe': {'qte': (1, 500), 'puHt': (100, 1000000), 'zero': True},

    'ouvrage_ep': {'qte': (1, 50), 'puHt': (1000, 1000000), 'zero': True},
    'regard_grille_ep': {'qte': (1, 200), 'puHt': (100, 1000000), 'zero': True},
    'tranchee_ep': {'qte': (1, 1000), 'puHt': (100, 1000000), 'zero': True},
    'tuyau_pvc': {'qte': (1, 5000), 'puHt': (100, 1000000), 'zero': True},

    'batterie': {'qte': (0, 100), 'puHt': (0, 1000000)},
    'frais_activation_bv': {'qte': (0, 1), 'puHt': (50, 500)},
    'borne_recharge': {'qte': (0, 500), 'puHt': (0, 100000)},
    'pilotage': {'qte': (1, 1), 'puHt': (0, 100000)},
    'main_oeuvre': {'qte': (1, 1), 'puHt': (0, 2000000)},
    'pompage_solaire': {'qte': (0, 50), 'puHt': (0, 200000)},
    'autres_generaux': {'qte': (0, 50), 'puHt': (0, 500000)},
    'aides_primes': {'qte': (1, 1), 'puHt': (0, 2000000)},
}

POSTE_DEFAULT_RULES_PRO = {
    'etudes': {'qte': (1, 1), 'puHt': (0, 50000)},
    'materiels_pv': {'qte': (0, 50000), 'puHt': (0, 200000)},
    'materiels_elec': {'qte': (0, 9999), 'puHt': (0, 200000)},
    'structure': {'qte': (0, 500), 'puHt': (0, 1000000)},
    'genie_civil': {'qte': (0, 5000), 'puHt': (0, 1000000)},
    'eaux_pluviales': {'qte': (0, 5000), 'puHt': (0, 1000000)},
    'stockage': {'qte': (0, 100), 'puHt': (0, 1000000)},
    'borne': {'qte': (0, 500), 'puHt': (0, 100000)},
    'pilotage': {'qte': (1, 1), 'puHt': (0, 100000)},
    'main_oeuvre': {'qte': (1, 1), 'puHt': (0, 2000000)},
    'autres': {'qte': (0, 50), 'puHt': (0, 500000)},
    'aides': {'qte': (1, 1), 'puHt': (0, 2000000)},
}

# Lignes PRO affichées selon le type de structure (structure porteuse : ombrière métal et petit champ
# solaire ; pannes : ombrière métal). Doit rester identique à LIGNES_CONDITIONNELLES en JS.
LIGNES_CONDITIONNELLES = {
    'structure_porteuse': ('ombriere_metal', 'champ_solaire'),
    'pannes': ('ombriere_metal',),
}


# Lignes dont la quantité doit être 0 selon le type de conversion (lignes non utilisées : évite
# qu'une quantité par défaut soit multipliée par un prix). Doit rester identique à CONVERSION_LOCKS
# dans ResidentielValidationRules.js.
CONVERSION_LOCKS = {
    'chaine': ('micro_onduleurs', 'optimiseurs'),
    'optimiseurs': ('micro_onduleurs',),
    'micro': ('onduleurs', 'optimiseurs', 'coffret_dc'),
}


def _resoudre_regle(poste_key: str, line_key: Optional[str], profil: str = 'residentiel') -> dict:
    """Résout la règle applicable à une ligne : d'abord par sous-type (line_key), sinon par
    repli poste. Repli ultime (poste inconnu) : garde-fou générique CAPEX_QTE_RULE/CAPEX_PU_HT_RULE
    déjà utilisé côté frontend pour tout ce qui n'est pas explicitement couvert par le spec métier."""
    sous_types, postes_defaut = (
        (SUBTYPE_RULES_PRO, POSTE_DEFAULT_RULES_PRO) if profil == 'pro' else (SUBTYPE_RULES, POSTE_DEFAULT_RULES)
    )
    if line_key and line_key in sous_types:
        return sous_types[line_key]
    return postes_defaut.get(poste_key, {'qte': (0, 999), 'puHt': (0, 99999)})


def _hors_plage(valeur, bornes, zero_accepte: bool) -> bool:
    if valeur is None:
        return True
    if zero_accepte and valeur == 0:
        return False
    return valeur < bornes[0] or valeur > bornes[1]


POSTE_MAIN_OEUVRE = 'main_oeuvre'


def poste_hors_devis(poste_key: Optional[str], inclure_main_oeuvre: Optional[bool]) -> bool:
    """Poste « Main-d'œuvre » avec la case « Inclure la main-d'œuvre » décochée : vaut 0 et
    n'apparaît pas sur le devis. Miroir de ResidentielCapexTable.js::posteExclu() et de
    DevisPdfGenerator.js::postesAffiches()."""
    return poste_key == POSTE_MAIN_OEUVRE and inclure_main_oeuvre is False


def validate_capex_business_rules(postes: List[dict], conversion_type: Optional[str] = None,
                                  profil: str = 'residentiel', lignes_exclues=(),
                                  inclure_main_oeuvre: Optional[bool] = None,
                                  taux_conversion: float = 1.0) -> None:
    """Valide qte/puHt de chaque ligne selon la règle de son sous-type (ou le repli de son poste).
    Lève ResidentielRuleError au PREMIER écart trouvé (field = chemin exact, ex.
    "postes[1].lines[2].qte") — jamais de correction silencieuse, la requête entière est rejetée.
    Suppose que `postes` a déjà passé la validation de forme ResidentielCapexSchema (qte/puHt sont
    donc déjà garantis être des float). Si `conversion_type` est fourni, les lignes que ce type
    rend inutilisées (CONVERSION_LOCKS) doivent en plus avoir une quantité nulle.
    `profil` ('residentiel' | 'pro') choisit les tables de bornes ; en PRO, les lignes de
    `lignes_exclues` qui sont conditionnelles (LIGNES_CONDITIONNELLES) sont hors totaux et ignorées.
    Le poste « Main-d'œuvre » non inclus (`inclure_main_oeuvre` False) est ignoré lui aussi.
    """
    lignes_bloquees = CONVERSION_LOCKS.get(conversion_type, ())
    ignorees = (set(lignes_exclues or ()) & set(LIGNES_CONDITIONNELLES)) if profil == 'pro' else set()
    for poste_idx, poste in enumerate(postes):
        poste_key = poste.get('key')
        if poste_hors_devis(poste_key, inclure_main_oeuvre):
            continue
        for line_idx, line in enumerate(poste.get('lines') or []):
            if line.get('key') in ignorees:
                continue
            regle = _resoudre_regle(poste_key, line.get('key'), profil)
            zero_accepte = bool(regle.get('zero'))
            path = f"postes[{poste_idx}].lines[{line_idx}]"

            qte_min, qte_max = regle['qte']
            qte = line.get('qte')
            if line.get('key') in lignes_bloquees and qte != 0:
                raise ResidentielRuleError(
                    f"{path}.qte",
                    f"Quantité ({qte}) invalide pour '{line.get('designation', '?')}' — doit être 0 "
                    f"avec le type de conversion '{conversion_type}'."
                )
            if _hors_plage(qte, regle['qte'], zero_accepte):
                raise ResidentielRuleError(
                    f"{path}.qte",
                    f"Quantité ({qte}) invalide pour '{line.get('designation', '?')}' — doit être "
                    f"comprise entre {qte_min} et {qte_max}{' (ou 0)' if zero_accepte else ''}."
                )

            facteur = valider_taux_conversion(taux_conversion)
            raw_pu_min, raw_pu_max = regle['puHt']
            pu_min = round(raw_pu_min * facteur, 4) if facteur < 1.0 else raw_pu_min
            pu_max = round(raw_pu_max * facteur, 2)
            pu_ht = line.get('puHt')
            if _hors_plage(pu_ht, (pu_min, pu_max), zero_accepte):
                raise ResidentielRuleError(
                    f"{path}.puHt",
                    f"Prix unitaire HT ({pu_ht}) invalide pour '{line.get('designation', '?')}' — "
                    f"doit être compris entre {pu_min} et {pu_max}{' (ou 0)' if zero_accepte else ''}."
                )


# Vérification serveur des totaux du devis avant son impression (dossier de plans, parcours
# Chiffrage) : écart toléré entre les totaux calculés par le navigateur et ceux recalculés ici.
TOLERANCE_TOTAUX_EUR = 0.01


def calculer_totaux_capex(capex: dict) -> Tuple[float, float]:
    """Totaux (HT, TTC) du devis tels qu'imprimés — miroir de DevisPdfGenerator.js::totauxDevis()
    (= postesAffiches + grandCapexTotals) : lignes de `lignesExclues` retirées, postes `deduction`
    soustraits, poste « Main-d'œuvre » retiré si `inclureMainOeuvre` vaut False, quantité / PU / TVA
    absents comptés à 0."""
    exclues = set(capex.get('lignesExclues') or [])
    inclure_main_oeuvre = capex.get('inclureMainOeuvre')
    total_ht = total_ttc = 0.0
    for poste in capex.get('postes') or []:
        if poste_hors_devis(poste.get('key'), inclure_main_oeuvre):
            continue
        signe = -1 if poste.get('deduction') else 1
        for ligne in poste.get('lines') or []:
            if ligne.get('key') in exclues:
                continue
            ht = (float(ligne.get('qte') or 0)) * (float(ligne.get('puHt') or 0))
            total_ht += signe * ht
            total_ttc += signe * ht * (1 + float(ligne.get('tvaPct') or 0) / 100)
    return total_ht, total_ttc
