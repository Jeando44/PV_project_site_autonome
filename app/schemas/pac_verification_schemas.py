"""
Schémas de la vérification des calculs PAC / climatiseur (routes/pac_verification.py).
=====================================================================================
BORNES = MIROIR de la table REGLES (et BORNES_POINTS, BORNES_PIECE, REGLES_ECO) de
Irve/pac_climatisation/pac_section.js, plus les mêmes contrôles de cohérence que violations() :
une saisie incohérente est REJETÉE (400) au lieu d'être calculée. Toute borne modifiée l'est des
deux côtés.
"""
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

Strict = ConfigDict(extra='forbid')
Souple = ConfigDict(extra='ignore')
MAX_SURFACE_TOTALE_M2 = 2000


def _f(lo, hi, **kw):
    return Field(ge=lo, le=hi, **kw)


# --------------------------------------------------------------------------------------------
# Simulation
# --------------------------------------------------------------------------------------------
class Meteo(BaseModel):
    model_config = Souple
    lat: float = _f(-90, 90)
    lon: float = _f(-180, 180)
    pas_minutes: Literal[10, 15, 30, 60]
    annee: int = _f(2020, 2050)


class Usages(BaseModel):
    model_config = Strict
    chauffage: bool
    froid: bool
    ecs: bool


# BORNES_POINTS de pac_section.js
BORNES_POINTS = {
    'chaud': {'a': (-30, 45), 'w_eau': (20, 80), 'w_air': (15, 30), 'p_kw': (0.3, 200), 'r': (1, 10)},
    'froid': {'a': (15, 55), 'w_eau': (4, 30), 'w_air': (18, 35), 'p_kw': (0.3, 200), 'r': (1, 12)},
}
PLAGES_FONCTIONNEMENT = {'chaud': ((-30, 10), (15, 45)), 'froid': ((-15, 30), (30, 55))}


class Point(BaseModel):
    model_config = Souple
    a: float
    w: float
    p_kw: Optional[float] = None
    cop: Optional[float] = None
    eer: Optional[float] = None


class ModeleCfg(BaseModel):
    model_config = Souple
    mode: Literal['chaud', 'froid']
    systeme: Literal['air_eau', 'air_air']
    points: List[Point] = Field(min_length=1, max_length=20)
    inclutDegivrage: bool = False
    tExtMin: float
    tExtMax: float
    perteLiaisonsPct: float = _f(0, 30)
    modulationMinPct: float = _f(5, 100)
    cd: float = _f(0.5, 1)

    @model_validator(mode='after')
    def _coherence(self):
        b = BORNES_POINTS[self.mode]
        bw = b['w_air'] if self.systeme == 'air_air' else b['w_eau']
        nom = 'Chauffage' if self.mode == 'chaud' else 'Froid'
        cle = 'cop' if self.mode == 'chaud' else 'eer'
        for i, p in enumerate(self.points, 1):
            r = getattr(p, cle)
            for v, (lo, hi), lib in ((p.a, b['a'], 'A'), (p.w, bw, 'W'), (p.p_kw, b['p_kw'], 'puissance'), (r, b['r'], cle.upper())):
                if v is None or not (lo <= v <= hi):
                    raise ValueError(f"{nom}, point {i} : {lib} manquant ou hors plage ({lo} – {hi}).")
        (mn_lo, mn_hi), (mx_lo, mx_hi) = PLAGES_FONCTIONNEMENT[self.mode]
        if not (mn_lo <= self.tExtMin <= mn_hi) or not (mx_lo <= self.tExtMax <= mx_hi):
            raise ValueError(f"{nom} : plage de fonctionnement hors bornes.")
        if self.tExtMin >= self.tExtMax:
            raise ValueError(f"{nom} : la plage de fonctionnement est vide.")
        return self


class Modeles(BaseModel):
    model_config = Strict
    chaud: Optional[ModeleCfg] = None
    froid: Optional[ModeleCfg] = None


class Facade(BaseModel):
    model_config = Strict
    orientation: Literal['N', 'E', 'S', 'O', '']
    longueur: float = _f(0, 60)


class Piece(BaseModel):
    model_config = Souple
    nom: str = Field(default='', max_length=40)
    surface: float = _f(1, 500)
    hauteur: float = _f(2, 8)
    facades: List[Facade] = Field(max_length=2)
    vitragePct: float = _f(0, 90)
    sousToiture: bool
    surSol: bool


class Enveloppe(BaseModel):
    model_config = Strict
    u_mur: float = _f(0.08, 3)
    u_toit: float = _f(0.08, 4)
    u_sol: float = _f(0.08, 3)
    u_fenetre: float = _f(0.5, 6)
    g_fenetre: float = _f(0.2, 0.9)
    ponts_thermiques_pct: float = _f(0, 40)
    n50: float = _f(0.3, 20)


class Ventilation(BaseModel):
    model_config = Strict
    renouvellement_vol_h: float = _f(0, 3)
    rendement_recuperation: float = _f(0, 0.95)


class Batiment(BaseModel):
    model_config = Strict
    methode: Literal['aucun', 'simplifie', 'detaille', 'deduit']
    inertie_id: Optional[str] = Field(default=None, max_length=40)
    surface: Optional[float] = _f(10, 2000, default=None)
    hauteur: Optional[float] = _f(2, 6, default=None)
    vitrage_pct: Optional[float] = _f(0, 60, default=None)
    g_fenetre: Optional[float] = _f(0.2, 0.9, default=None)
    g: Optional[float] = _f(0.1, 4, default=None)
    niveau_id: Optional[str] = Field(default=None, max_length=40)
    ventilation_id: Optional[str] = Field(default=None, max_length=40)
    taux_dim: Optional[float] = _f(50, 150, default=None)
    consigne_chauffage: Optional[float] = _f(16, 24, default=None)
    pieces: Optional[List[Piece]] = Field(default=None, max_length=50)
    env: Optional[Enveloppe] = None
    ventilation: Optional[Ventilation] = None

    @model_validator(mode='after')
    def _champs_requis(self):
        requis = {
            'simplifie': ('surface', 'hauteur', 'vitrage_pct', 'g_fenetre', 'niveau_id', 'ventilation_id', 'inertie_id'),
            'deduit': ('surface', 'hauteur', 'vitrage_pct', 'g_fenetre', 'taux_dim', 'inertie_id', 'consigne_chauffage'),
            'detaille': ('pieces', 'env', 'ventilation', 'inertie_id'),
            'aucun': (),
        }[self.methode]
        manquants = [c for c in requis if getattr(self, c) is None]
        if manquants:
            raise ValueError(f"Bâtiment : champs manquants ({', '.join(manquants)}).")
        if self.methode == 'detaille':
            if not self.pieces:
                raise ValueError('Méthode détaillée : ajoutez au moins une pièce.')
            if sum(p.surface for p in self.pieces) > MAX_SURFACE_TOTALE_M2:
                raise ValueError(f"Surface totale des pièces supérieure à {MAX_SURFACE_TOTALE_M2} m².")
        return self


class LoiDeau(BaseModel):
    model_config = Strict
    tBase: float = _f(-35, 15)
    departBase: float = _f(25, 75)
    tNonChauffage: float = _f(10, 22)
    departDoux: float = _f(20, 60)
    departMax: float = _f(35, 80)

    @model_validator(mode='after')
    def _coherence(self):
        if self.departDoux > self.departBase:
            raise ValueError("Le départ à la température de non-chauffage doit être inférieur ou égal au départ à la température de base.")
        if self.tNonChauffage <= self.tBase:
            raise ValueError("La température de non-chauffage doit dépasser la température de base hiver.")
        return self


class Apports(BaseModel):
    model_config = Souple
    appareilsWm2: float = _f(0, 20)


class Consignes(BaseModel):
    model_config = Strict
    chauffage: float = _f(16, 24)
    reduit: float = _f(10, 22)
    reduitDebut: int = _f(0, 23)
    reduitFin: int = _f(0, 23)
    froid: float = _f(20, 99)
    occupants: int = _f(0, 50)
    absenceSemaine: bool
    absenceDebut: int = _f(0, 23)
    absenceFin: int = _f(0, 23)
    reduitEnAbsence: bool
    froidSeulementPresence: bool


class Appoint(BaseModel):
    model_config = Strict
    puissanceKw: float = _f(0, 18)
    tBivalence: float = _f(-99, 10)


class Aux(BaseModel):
    model_config = Strict
    circulateurW: float = _f(0, 300)
    veilleW: float = _f(0, 100)
    carterW: float = _f(0, 150)
    carterSeuilC: float = _f(-10, 20)
    ventilateurW: float = _f(0, 200)
    nbUnitesInterieures: int = _f(1, 12)
    horsTensionHorsSaison: bool


class PlageHoraire(BaseModel):
    model_config = Strict
    debut: int = _f(0, 23)
    fin: int = _f(0, 23)


class Antilegionelle(BaseModel):
    model_config = Souple
    actif: bool
    jourSemaine: int = _f(0, 6)
    heure: int = _f(0, 23)


class Ecs(BaseModel):
    model_config = Strict
    litresJour: float = _f(1, 7500)
    profil_id: str = Field(max_length=40)
    tUsage: float = _f(35, 45)
    consigne: float = _f(45, 65)
    hysteresis: float = _f(2, 15)
    volume: float = _f(50, 1000)
    pertesKwh24h: Optional[float] = _f(0.2, 6, default=None)
    tAmbiance: float = _f(5, 25)
    resistanceKw: float = _f(0, 6)
    tEauMaxPac: float = _f(30, 75)
    plage: Optional[PlageHoraire] = None
    antilegionelle: Antilegionelle
    priorite: bool

    @model_validator(mode='after')
    def _coherence(self):
        if self.consigne < self.tUsage + 5:
            raise ValueError("La consigne du ballon doit dépasser d'au moins 5 °C la température d'usage.")
        return self


class EntreesSimulation(BaseModel):
    model_config = Strict
    meteo: Meteo
    altitude_site_m: Optional[float] = _f(-50, 3500, default=None)
    type: Literal['air_eau', 'air_air', 'clim']
    systeme: Literal['air_eau', 'air_air']
    usages: Usages
    tbase_hiver: float = _f(-35, 15)
    tbase_ete: Optional[float] = _f(20, 50, default=None)
    batiment: Batiment
    modeles: Modeles
    loi_deau: Optional[LoiDeau] = None
    puits_chaud: float = _f(5, 30)
    depart_froid: float = _f(5, 30)
    apports: Apports
    consignes: Consignes
    appoint: Appoint
    aux: Aux
    ecs: Optional[Ecs] = None

    @model_validator(mode='after')
    def _coherence(self):
        u = self.usages
        if not (u.chauffage or u.froid or u.ecs):
            raise ValueError('Aucun usage choisi.')
        if self.type == 'clim' and (u.chauffage or u.ecs):
            raise ValueError('Un climatiseur ne produit que du froid.')
        if u.ecs and self.systeme != 'air_eau':
            raise ValueError("L'eau chaude sanitaire n'est possible qu'avec une PAC air-eau.")
        if (u.chauffage or u.ecs) and self.type != 'clim' and self.modeles.chaud is None:
            raise ValueError('Chauffage : saisissez au moins un point de fonctionnement.')
        if u.froid and self.modeles.froid is None:
            raise ValueError('Froid : saisissez au moins un point de fonctionnement.')
        avec_espace = u.chauffage or u.froid
        if avec_espace == (self.batiment.methode == 'aucun'):
            raise ValueError('Description du bâtiment incohérente avec les usages.')
        if self.batiment.methode == 'deduit' and not u.chauffage:
            raise ValueError("Le bâtiment ne peut être déduit de la puissance que si l'équipement chauffe.")
        if u.froid and self.tbase_ete is None:
            raise ValueError('Température de base été manquante.')
        c = self.consignes
        if u.chauffage and c.reduit > c.chauffage:
            raise ValueError('La consigne réduite doit être inférieure ou égale à la consigne de chauffage.')
        if u.froid and not (20 <= c.froid <= 30):
            raise ValueError('Consigne de rafraîchissement hors plage (20 – 30 °C).')
        if u.chauffage and u.froid and c.froid < c.chauffage + 2:
            raise ValueError('Laissez au moins 2 °C entre la consigne de chauffage et celle de rafraîchissement.')
        if self.systeme == 'air_eau' and u.chauffage:
            if self.loi_deau is None:
                raise ValueError("Loi d'eau manquante.")
            if self.loi_deau.departBase > self.loi_deau.departMax:
                raise ValueError("Le départ à la température de base dépasse la température d'eau maximale de la PAC.")
            if abs(self.loi_deau.tBase - self.tbase_hiver) > 1e-9:
                raise ValueError("Loi d'eau : température de base différente de la température de base hiver.")
        if u.ecs:
            if self.ecs is None:
                raise ValueError('Eau chaude sanitaire : saisies manquantes.')
            if c.occupants < 1:
                raise ValueError("Nombre d'occupants : au moins 1 avec l'eau chaude sanitaire.")
        if self.appoint.puissanceKw > 0 and not (0.5 <= self.appoint.puissanceKw and -20 <= self.appoint.tBivalence):
            raise ValueError('Appoint : puissance ou température de bivalence hors plage.')
        return self


class VerificationSimulationRequest(BaseModel):
    model_config = Souple
    entrees: EntreesSimulation
    navigateur: dict


# --------------------------------------------------------------------------------------------
# Rentabilité (bornes = REGLES_ECO de pac_section.js)
# --------------------------------------------------------------------------------------------
class ParametresEco(BaseModel):
    model_config = Strict
    prix: Dict[Literal['BASE', 'HP', 'HC'], float]
    prix_gaz: float = _f(0, 0.6)
    abonnement_gaz: float = _f(0, 3000)
    resiliation_gaz: bool
    prix_fioul: float = _f(0, 4)
    prix_surplus: float = _f(0, 1)
    surcout_abonnement: float = _f(0, 5000)
    entretien_pac: float = _f(0, 5000)
    entretien_ref: float = _f(0, 5000)
    capex_materiel: float = _f(0, 1_000_000)
    capex_travaux: float = _f(0, 1_000_000)
    aides: float = _f(0, 1_000_000)
    cout_evite: float = _f(0, 1_000_000)
    horizon: int = _f(5, 30)
    duree_vie: int = _f(5, 30)
    remplacement: float = _f(0, 150)
    evol_elec: float = _f(-5, 15)
    evol_gaz: float = _f(-5, 15)
    evol_fioul: float = _f(-5, 15)
    inflation: float = _f(0, 10)
    actualisation: float = _f(0, 15)
    degradation: float = _f(0, 2)

    @model_validator(mode='after')
    def _coherence(self):
        for k, v in self.prix.items():
            if not (0.01 <= v <= 1.5):
                raise ValueError(f"Prix de l'électricité ({k}) hors plage (0,01 – 1,5 €/kWh).")
        if self.aides > self.capex_materiel + self.capex_travaux:
            raise ValueError("Les aides dépassent l'investissement.")
        return self


class EnergiesEco(BaseModel):
    model_config = Strict
    plages: List[Literal['BASE', 'HP', 'HC']] = Field(min_length=1, max_length=2)
    pac: Dict[Literal['BASE', 'HP', 'HC'], float]
    ref_elec: Dict[Literal['BASE', 'HP', 'HC'], float]
    pv_kwh: float = _f(0, 1e8)
    gaz_pcs_kwh: float = _f(0, 1e8)
    fioul_litres: float = _f(0, 1e7)
    gaz: bool

    @model_validator(mode='after')
    def _coherence(self):
        if self.plages not in (['BASE'], ['HP', 'HC']):
            raise ValueError('Plages tarifaires inconnues.')
        for nom, d in (('PAC', self.pac), ('référence', self.ref_elec)):
            if set(d) != set(self.plages) or any(not (0 <= v <= 1e8) for v in d.values()):
                raise ValueError(f"Énergies {nom} par plage incohérentes.")
        return self


class ConsoReference(BaseModel):
    model_config = Strict
    energie: Literal['elec', 'gaz', 'fioul']
    elecChKwh: float = _f(0, 1e8)
    elecEcsKwh: float = _f(0, 1e8)
    elecFroidKwh: float = _f(0, 1e8)
    combustiblePciKwh: float = _f(0, 1e8)


class EntreesRentabilite(BaseModel):
    model_config = Strict
    p: ParametresEco
    e: EnergiesEco
    annuel: Dict[Literal['eChauffage', 'eFroid', 'eEcs', 'eAppoint', 'eAuxiliaires', 'qChauffagePac',
                         'qChauffageAppoint', 'qFroid', 'qEcsPac', 'qEcsResistance'], float]
    conso_ref: ConsoReference
    froid_compare: bool

    @model_validator(mode='after')
    def _coherence(self):
        if self.p.prix.keys() != set(self.e.plages):
            raise ValueError('Prix et plages tarifaires incohérents.')
        if any(not (0 <= v <= 1e8) for v in self.annuel.values()):
            raise ValueError('Énergies annuelles hors bornes.')
        return self


class VerificationRentabiliteRequest(BaseModel):
    model_config = Souple
    entrees: EntreesRentabilite
    navigateur: dict


# --------------------------------------------------------------------------------------------
# Messages d'erreur en français (libellés des champs de la section PAC)
# --------------------------------------------------------------------------------------------
LIBELLES = {
    'pas_minutes': 'Pas de temps de la simulation', 'annee': 'Année de simulation', 'lat': 'Latitude', 'lon': 'Longitude',
    'tbase_hiver': 'Température de base hiver', 'tbase_ete': 'Température de base été', 'altitude_site_m': 'Altitude du site',
    'chauffage': 'Consigne de chauffage', 'reduit': 'Consigne réduite', 'reduitDebut': 'Début du réduit', 'reduitFin': 'Fin du réduit',
    'froid': 'Consigne de rafraîchissement', 'occupants': "Nombre d'occupants", 'absenceDebut': "Début de l'absence", 'absenceFin': "Fin de l'absence",
    'surface': 'Surface', 'hauteur': 'Hauteur', 'vitrage_pct': 'Surface vitrée', 'g_fenetre': 'Facteur solaire des vitrages', 'g': 'Coefficient G',
    'taux_dim': 'Couverture du besoin à la température de base', 'consigne_chauffage': 'Consigne de chauffage', 'vitragePct': 'Vitrage',
    'longueur': 'Longueur de façade', 'u_mur': 'U des murs', 'u_toit': 'U de la toiture', 'u_sol': 'U du plancher bas', 'u_fenetre': 'U des fenêtres',
    'ponts_thermiques_pct': 'Majoration ponts thermiques', 'n50': "Perméabilité à l'air n50", 'renouvellement_vol_h': 'Renouvellement par la ventilation',
    'rendement_recuperation': 'Rendement de récupération', 'tBase': "Température de base (loi d'eau)", 'departBase': 'Départ à la température de base',
    'tNonChauffage': 'Température extérieure de non-chauffage', 'departDoux': 'Départ à la température de non-chauffage',
    'departMax': "Température d'eau maximale", 'puits_chaud': 'Température intérieure (chaud)', 'depart_froid': "Départ d'eau en froid",
    'appareilsWm2': 'Apports internes des appareils', 'puissanceKw': "Puissance de l'appoint", 'tBivalence': 'Température de bivalence',
    'circulateurW': 'Circulateur', 'veilleW': 'Veille', 'carterW': 'Résistance de carter', 'carterSeuilC': 'Seuil de la résistance de carter',
    'ventilateurW': 'Ventilateur par unité intérieure', 'nbUnitesInterieures': "Nombre d'unités intérieures",
    'litresJour': "Consommation d'eau chaude", 'tUsage': "Température d'usage", 'consigne': 'Consigne du ballon', 'hysteresis': 'Écart de relance',
    'volume': 'Volume du ballon', 'pertesKwh24h': 'Pertes du ballon', 'tAmbiance': 'Température du local du ballon', 'resistanceKw': 'Résistance du ballon',
    'tEauMaxPac': "Température d'eau maximale", 'heure': 'Heure', 'jourSemaine': 'Jour', 'debut': 'Début de la plage', 'fin': 'Fin de la plage',
    'perteLiaisonsPct': 'Perte de puissance des liaisons', 'modulationMinPct': 'Taux de modulation minimal', 'cd': 'Coefficient de dégradation au cyclage',
    'tExtMin': 'Température extérieure minimale', 'tExtMax': 'Température extérieure maximale', 'points': 'Points de fonctionnement',
    'pieces': 'Pièces', 'prix_gaz': 'Prix du gaz', 'abonnement_gaz': 'Abonnement gaz', 'prix_fioul': 'Prix du fioul',
    'prix_surplus': 'Prix de vente du surplus PV', 'surcout_abonnement': "Supplément d'abonnement électrique", 'entretien_pac': 'Entretien de la PAC',
    'entretien_ref': 'Entretien du système de référence', 'capex_materiel': 'Équipement posé', 'capex_travaux': 'Travaux annexes', 'aides': 'Aides et primes',
    'cout_evite': 'Remplacement évité', 'horizon': "Durée de l'étude", 'duree_vie': 'Durée de vie de la PAC', 'remplacement': 'Coût de remplacement',
    'evol_elec': "Évolution du prix de l'électricité", 'evol_gaz': 'Évolution du prix du gaz', 'evol_fioul': 'Évolution du prix du fioul',
    'inflation': 'Inflation des charges', 'actualisation': "Taux d'actualisation", 'degradation': 'Dégradation annuelle de la production PV',
}


def message_erreur(err):
    """Première erreur d'une ValidationError -> message français (libellé du champ + borne)."""
    errs = err.errors()
    if not errs:
        return 'saisie invalide.'
    e = errs[0]
    if e.get('type') == 'value_error':
        return str((e.get('ctx') or {}).get('error') or e.get('msg'))
    loc = [x for x in e.get('loc', ()) if isinstance(x, str) and x != 'entrees']
    champ = next((LIBELLES[x] for x in reversed(loc) if x in LIBELLES), '.'.join(loc) or 'champ')
    ctx = e.get('ctx') or {}
    t = e.get('type', '')

    def borne(v):
        try:
            v = float(v)
        except (TypeError, ValueError):
            return str(v)
        return f"{int(v):,}".replace(',', ' ') if v.is_integer() else f"{v:g}".replace('.', ',')
    if t in ('less_than_equal', 'less_than'):
        detail = f"valeur supérieure au maximum autorisé ({borne(ctx.get('le', ctx.get('lt')))})"
    elif t in ('greater_than_equal', 'greater_than'):
        detail = f"valeur inférieure au minimum autorisé ({borne(ctx.get('ge', ctx.get('gt')))})"
    elif t == 'missing':
        detail = 'valeur manquante'
    elif t in ('too_long', 'too_short'):
        detail = "nombre d'éléments hors limites"
    elif t.startswith('bool'):
        detail = 'oui / non attendu'
    elif t.startswith(('float', 'int')):
        detail = 'nombre attendu'
    elif t == 'literal_error':
        detail = 'valeur non reconnue'
    else:
        detail = 'valeur invalide'
    return f"{champ} : {detail}."
