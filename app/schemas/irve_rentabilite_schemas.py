"""
Section « 3. Rentabilité économique du projet IRVE » — bornes des saisies et schémas.
====================================================================================
BORNES = miroir de la table REGLES de Irve/rentabilite_irve/rentabilite_irve_section.js (mêmes
identifiants, mêmes minimum/maximum, mêmes règles d'affichage `si`) : changer les deux. Un champ
masqué (non utilisé par le modèle choisi) n'est pas contrôlé sur ses bornes, comme dans le navigateur.
"""
import math
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PLAGES = ('BASE', 'HP', 'HC', 'P', 'HPH', 'HCH', 'HPE', 'HCE')
PLAGES_PAR_TARIF = {
    'C5_BASE': ('BASE',),
    'C5_HPHC': ('HP', 'HC'),
    'C4': ('HPH', 'HCH', 'HPE', 'HCE'),
    'C3': ('P', 'HPH', 'HCH', 'HPE', 'HCE'),
}

# cle -> (min, max, entier)
BORNES = {f'prix_{k}': (0.01, 1.5, False) for k in PLAGES}
BORNES.update({
    'capex_bornes': (0, 5_000_000, False),
    'capex_installation': (0, 5_000_000, False),
    'capex_raccordement': (0, 5_000_000, False),
    'capex_gc': (0, 5_000_000, False),
    'capex_etudes': (0, 5_000_000, False),
    'aide_advenir': (0, 5_000_000, False),
    'aide_autres': (0, 5_000_000, False),
    'capex_pv': (0, 10_000_000, False),
    'opex_pv': (0, 1_000_000, False),
    'prix_surplus': (0, 1, False),
    'opex_maintenance': (0, 1_000_000, False),
    'opex_supervision': (0, 1_000_000, False),
    'opex_abonnement': (0, 1_000_000, False),
    'prix_vente': (0.05, 2, False),
    'commission': (0, 50, False),
    'prix_reference': (0.05, 2, False),
    'evol_vente': (-5, 15, False),
    'conso_ve': (8, 40, False),
    'conso_th': (2, 20, False),
    'prix_carburant': (0.5, 5, False),
    'evol_carburant': (-5, 15, False),
    'entretien_evite': (0, 1_000_000, False),
    'rendement': (50, 100, False),
    'evol_elec': (-5, 15, False),
    'inflation': (0, 10, False),
    'actualisation': (0, 15, False),
    'degradation': (0, 2, False),
    'duree_vie': (5, 20, True),
    'remplacement': (0, 150, False),
})
CLES_CAPEX = ('capex_bornes', 'capex_installation', 'capex_raccordement', 'capex_gc', 'capex_etudes')


def champ_utilise(cle, etat):
    """Miroir des règles `si` de REGLES : le champ est affiché, contrôlé et utilisé."""
    if cle.startswith('prix_') and cle[5:] in PLAGES:
        return cle[5:] in PLAGES_PAR_TARIF.get(etat['tarif'], ())
    if cle in ('capex_pv', 'opex_pv'):
        return etat['pv_financement'] == 'a_financer'
    if cle == 'prix_surplus':
        return etat['surplus'] == 'vente'
    if cle in ('prix_vente', 'commission'):
        return etat['modele'] == 'payante'
    if cle == 'prix_reference':
        return etat['modele'] == 'flotte'
    if cle == 'evol_vente':
        return etat['modele'] in ('payante', 'flotte')
    if cle in ('conso_ve', 'conso_th', 'prix_carburant', 'evol_carburant', 'entretien_evite'):
        return etat['modele'] == 'thermique'
    return True


def verifier_valeur(cle, valeur):
    """Message d'erreur si `valeur` (nombre) sort des bornes de `cle`, sinon None."""
    b_min, b_max, entier = BORNES[cle]
    if valeur is None or not math.isfinite(valeur):
        return f"{cle} : valeur numérique requise."
    if valeur < b_min or valeur > b_max:
        return f"{cle} : valeur attendue entre {b_min} et {b_max}."
    if entier and not float(valeur).is_integer():
        return f"{cle} : nombre entier attendu."
    return None


class EtatRentabilite(BaseModel):
    model_config = ConfigDict(extra='ignore')
    profil: Literal['entreprise', 'collectivite', 'particulier']
    modele: Literal['payante', 'flotte', 'thermique']
    tarif: Literal['C5_BASE', 'C5_HPHC', 'C4', 'C3']
    horizon: Literal[5, 10, 15, 20]
    pv_financement: Literal['finance', 'a_financer']
    surplus: Literal['sans', 'vente']
    masque: bool = False

    @model_validator(mode='after')
    def _particulier(self):
        # Particulier : tarif C5 seul, pas de recharge payante (même contrainte que le navigateur).
        if self.profil == 'particulier' and (not self.tarif.startswith('C5') or self.modele == 'payante'):
            raise ValueError("Un particulier ne peut avoir que le tarif C5 et pas de recharge payante.")
        return self


class FrisesHoro(BaseModel):
    hc_hours: List[bool] = Field(min_length=24, max_length=24)
    pointe_hours: List[bool] = Field(min_length=24, max_length=24)

    @model_validator(mode='after')
    def _disjointes(self):
        if any(h and p for h, p in zip(self.hc_hours, self.pointe_hours)):
            raise ValueError("Une heure ne peut pas être à la fois creuse et de pointe.")
        return self


def _nombre(texte):
    try:
        v = float(str(texte).strip().replace(',', '.'))
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


class RentabiliteIrveSauvegarde(BaseModel):
    """Saisies enregistrées en base (IrveConfig.rentabilite). `champs` : identifiant DOM -> texte saisi."""
    model_config = ConfigDict(extra='ignore')
    v: Literal[1]
    etat: EtatRentabilite
    champs: Dict[str, str]
    horo: Optional[FrisesHoro] = None

    @model_validator(mode='after')
    def _champs(self):
        etat = self.etat.model_dump()
        for ident, texte in self.champs.items():
            cle = ident[3:] if ident.startswith('ri_') else None
            if cle not in BORNES:
                raise ValueError(f"Champ inconnu : {ident}")
            if len(texte) > 32:
                raise ValueError(f"{ident} : valeur trop longue.")
            if not champ_utilise(cle, etat):
                continue   # champ masqué : conservé tel quel, non utilisé
            erreur = verifier_valeur(cle, _nombre(texte))
            if erreur:
                raise ValueError(erreur)
        capex = sum(_nombre(self.champs.get(f'ri_{k}', '0')) or 0 for k in CLES_CAPEX)
        aides = sum(_nombre(self.champs.get(f'ri_{k}', '0')) or 0 for k in ('aide_advenir', 'aide_autres'))
        if aides > capex:
            raise ValueError("Les aides dépassent l'investissement des bornes.")
        return self


class ParametresRentabilite(BaseModel):
    """Paramètres effectifs du calcul (objet `params` de lireParametres côté navigateur)."""
    model_config = ConfigDict(extra='ignore')
    horizon: Literal[5, 10, 15, 20]
    modele: Literal['payante', 'flotte', 'thermique']
    pv_financement: Literal['finance', 'a_financer']
    surplus: Literal['sans', 'vente']
    prix: Dict[str, float]
    capex_bornes: float
    capex_installation: float
    capex_raccordement: float
    capex_gc: float
    capex_etudes: float
    aide_advenir: float
    aide_autres: float
    capex_pv: float
    opex_pv: float
    prix_surplus: float
    opex_maintenance: float
    opex_supervision: float
    opex_abonnement: float
    prix_vente: float
    commission: float
    prix_reference: float
    evol_vente: float
    conso_ve: float
    conso_th: float
    prix_carburant: float
    evol_carburant: float
    entretien_evite: float
    rendement: float
    evol_elec: float
    inflation: float
    actualisation: float
    degradation: float
    duree_vie: float
    remplacement: float


class VerificationRentabiliteRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')
    projet_id: int = Field(gt=0)
    tarif: Literal['C5_BASE', 'C5_HPHC', 'C4', 'C3']
    params: ParametresRentabilite
    horo: FrisesHoro
    js: dict

    @model_validator(mode='after')
    def _bornes(self):
        p = self.params.model_dump()
        etat = {'tarif': self.tarif, 'modele': p['modele'], 'pv_financement': p['pv_financement'], 'surplus': p['surplus']}
        for cle in BORNES:
            if not champ_utilise(cle, etat):
                continue
            valeur = p['prix'].get(cle[5:]) if cle.startswith('prix_') and cle[5:] in PLAGES else p.get(cle)
            erreur = verifier_valeur(cle, valeur)
            if erreur:
                raise ValueError(erreur)
        if p['aide_advenir'] + p['aide_autres'] > sum(p[k] for k in CLES_CAPEX):
            raise ValueError("Les aides dépassent l'investissement des bornes.")
        return self


# ------------------------------------------------------------------ autres vérifications IRVE

class BorneBilan(BaseModel):
    model_config = ConfigDict(extra='ignore')
    id: Optional[int] = None
    puissance: float = Field(gt=0, le=1000)
    pdc: int = Field(ge=1, le=20)
    quantite: int = Field(ge=1, le=10000)
    type: Literal['AC', 'DC']
    tension: str = Field(max_length=20)
    customTension: Optional[float] = Field(default=None, ge=0, le=100000)


class VerificationBilanRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')
    bornes: List[BorneBilan] = Field(min_length=1, max_length=500)
    params: Dict[str, float]
    js: dict


class GroupeEnergie(BaseModel):
    model_config = ConfigDict(extra='ignore')
    key: str = Field(max_length=50)
    irve_id: int
    target_kwh: float = Field(default=0, ge=0, le=1e7)
    segments: List[bool] = Field(max_length=144)


class VerificationEnergieRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')
    pas_temps_min: Literal[10, 15, 30, 60]
    bornes: List[BorneBilan] = Field(min_length=1, max_length=500)
    groupes: List[GroupeEnergie] = Field(max_length=500)
    cosphi_ac: float = Field(gt=0, le=1)
    cosphi_dc: float = Field(gt=0, le=1)
    rendement_ac: float = Field(gt=0, le=1)
    rendement_dc: float = Field(gt=0, le=1)
    # None = non renseignée / pas de limitation ; une valeur fournie doit être strictement positive.
    puissance_souscrite: Optional[float] = Field(default=None, gt=0, le=100000)
    puissance_max_irve: Optional[float] = Field(default=None, gt=0, le=100000)
    existing_hourly: List[float] = Field(min_length=24, max_length=24)
    annee: int = Field(ge=1900, le=2200)
    nb_jours_non_ouvres: int = Field(ge=0, le=366)
    js: dict


class VerificationBatterieRequest(BaseModel):
    model_config = ConfigDict(extra='ignore')
    entrees: Dict[str, object]
    js: dict

    @field_validator('entrees')
    @classmethod
    def _entrees(cls, e):
        numeriques = ('cap_batterie', 'soc_init_pct', 'soc_fin_pct', 'p_borne_kw', 'rdt_ac', 'rdt_dc', 'dist_jour_km',
                      'conso_ev_base', 'temp_ext', 'prix_elec', 'conso_th_base', 'prix_carburant', 'prix_achat_ev_k',
                      'subvention_ev_k', 'prix_achat_th_k', 'entretien_ev', 'entretien_th')
        for k in numeriques:
            v = e.get(k)
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or abs(v) > 1e9:
                raise ValueError(f"{k} : valeur numérique requise.")
        if e.get('type') not in ('AC', 'DC') or e.get('parcours') not in ('ville', 'mixte', 'autoroute'):
            raise ValueError("Type de borne ou de parcours invalide.")
        if not isinstance(e.get('modele', 'custom'), str):
            raise ValueError("Modèle de véhicule invalide.")
        return e
