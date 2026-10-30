"""
Schémas Pydantic de validation stricte pour le module IRVE (bornes de recharge +
dimensionnement autoconsommation/autonomie). Bornes reprises telles quelles de la spec
métier validée par l'utilisateur.

Tous les modèles utilisent extra="ignore" : les payloads envoyés par le front (notamment
`serializeIrveForm()`) contiennent de nombreux champs d'état d'interface non pertinents pour
le calcul — on ne borne strictement que les champs cités dans la spec, sans exiger une
correspondance 1:1 exhaustive avec tout ce que le JS peut envoyer.
"""
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class AutonomieParams(BaseModel):
    """Section 2 — Analyse d'autonomie énergétique (Off-grid)."""
    model_config = ConfigDict(extra="ignore")

    cible_autonomie_pct: float = Field(ge=1, le=100)
    nb_jours_autonomie: int = Field(ge=1, le=5)
    inclinaison: float = Field(ge=0, le=90)
    azimut: float = Field(ge=-90, le=180)
    mount: str
    usehorizon: str
    pertes: float = Field(ge=8, le=20)
    coeff_evolution: float = Field(ge=1, le=2)
    rendement_batterie: float = Field(ge=0.4, le=1)
    dod: float = Field(ge=0.5, le=1)


class IrveBorneItem(BaseModel):
    """Section 3 — une ligne du tableau des bornes de recharge."""
    model_config = ConfigDict(extra="ignore")

    puissance: float = Field(gt=0)
    pdc: int = Field(ge=1, le=4)
    quantite: int = Field(ge=1, le=50)
    type: Literal['AC', 'DC']
    tension: str
    customTension: Optional[float] = None


class BilanParams(BaseModel):
    """Section 3 — coefficients du bilan de puissance."""
    model_config = ConfigDict(extra="ignore")

    ks: float = Field(ge=0, le=1)
    kmono: float = Field(ge=0, le=1)
    ktri: float = Field(ge=0, le=1)
    kdc: float = Field(ge=0, le=1)
    cosphi_ac: float = Field(ge=0, le=1)
    cosphi_dc: float = Field(ge=0, le=1)
    puissance_aux: float = Field(ge=0, le=10)


class SystemeHybrideProductibleRequest(BaseModel):
    """POST /api/systeme_hybride/productible : productible spécifique du site (section Système
    hybride). Mêmes bornes d'orientation/pertes que l'Analyse d'autonomie (AutonomieParams)."""
    model_config = ConfigDict(extra="ignore")

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    inclinaison: float = Field(ge=0, le=90)
    azimut: float = Field(ge=-90, le=180)
    pertes: float = Field(ge=8, le=20)


class CalculerAutonomieRequest(BaseModel):
    """Payload complet de POST /api/consommation/calculer_autonomie."""
    model_config = ConfigDict(extra="ignore")

    seasonal_hourly_data: dict
    # Profil journalier moyen du site (24 valeurs horaires, kW) deja calcule cote frontend.
    # Quand il est fourni, il PRIME sur la reconstruction a partir de seasonal_hourly_data : c'est la
    # seule source correcte lorsque la consommation provient d'un import de courbe de charge
    # (.xlsx/.csv) plutot que de la saisie saisonniere, cas ou seasonal_hourly_data est vide alors
    # que le site a bien une consommation. Longueur libre (validee cote route) pour rester tolerant.
    existing_hourly_data: Optional[List[float]] = None
    autonomie_params: AutonomieParams
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    puissance_max_avant_foisonnement_kw: Optional[float] = Field(default=None, gt=0)
    irve_data: Optional[List[IrveBorneItem]] = None
    bilan_params: Optional[BilanParams] = None


class IrveCurveSchema(BaseModel):
    """Payload de POST .../irve/save-curve (courbe de charge IRVE calculée)."""
    model_config = ConfigDict(extra="ignore")

    pas_temps_min: int = Field(ge=1, le=1440)
    existing: list
    irve: list
    total: list
    has_existing: bool
    # Année de simulation (dates du passage heure d'été/hiver pour le calage UTC+1, cf. calage_horaire.py).
    annee: Optional[int] = Field(default=None, ge=1900, le=2200)
    # Consommation IRVE annuelle affichée par le bilan énergétique (kWh) : la somme de `irve` doit
    # lui être égale (cf. app/services/irve_controle.py). Absent seulement pour une courbe vide.
    bilan_irve_kwh: Optional[float] = Field(default=None, ge=0, le=1e9)


class IrveConfigDataSchema(BaseModel):
    """
    Validation ALLÉGÉE des sous-champs numériques connus du blob `data` de POST .../irve/save
    (Section 1). Le reste du blob (tables, uiState, etc.) reste un instantané libre de l'état du
    formulaire : ce schéma ne fait que borner ce qui est explicitement cité dans la spec métier,
    tout en tolérant leur absence (autosave partiel possible selon l'onglet actif).
    """
    model_config = ConfigDict(extra="ignore")

    bu_foisonnement: Optional[float] = Field(default=None, gt=50, le=100)
    coeff_saison_hiver: Optional[float] = Field(default=None, ge=0, le=2)
    coeff_saison_printemps: Optional[float] = Field(default=None, ge=0, le=2)
    coeff_saison_ete: Optional[float] = Field(default=None, ge=0, le=2)
    coeff_saison_automne: Optional[float] = Field(default=None, ge=0, le=2)
    coeff_semaine: Optional[float] = Field(default=None, ge=1, le=2)
    coeff_weekend: Optional[float] = Field(default=None, ge=1, le=2)
    nb_jours_non_ouvres: Optional[int] = Field(default=None, ge=0, le=200)
