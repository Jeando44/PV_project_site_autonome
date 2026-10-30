"""Schémas Pydantic du module PAC / climatiseur (Irve/pac_climatisation/)."""
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PacMeteoRequest(BaseModel):
    """POST /api/pac/meteo : séries météo du site au pas de la courbe de charge."""
    model_config = ConfigDict(extra="ignore")

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    pas_minutes: Literal[10, 15, 30, 60]
    # Même plage que le champ « Année de simulation » de la modale IRVE (#export_annee).
    annee: int = Field(ge=2020, le=2050)
    cache_id: Optional[str] = Field(default=None, max_length=64)


class PacAltitudeRequest(BaseModel):
    """POST /api/pac/altitude : altitude du terrain au point de l'adresse du projet."""
    model_config = ConfigDict(extra="ignore")

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


USAGES_RESUME = ('eChauffage', 'eFroid', 'eEcs', 'eAppoint', 'eAuxiliaires')


class PacResume(BaseModel):
    """Résumé affiché côté autoconsommation (pas de calcul serveur sur ces valeurs)."""
    model_config = ConfigDict(extra="ignore")

    equipement: str = Field(default='', max_length=200)
    type: Literal['air_eau', 'air_air', 'clim']
    usages_kwh: Dict[Literal[USAGES_RESUME], float] = Field(default_factory=dict)
    pointe_kw: float = Field(ge=0, le=10000)
    plage_ecs: Optional[Literal['permanente', 'nuit', 'solaire', 'perso']] = None
    froid: bool = False

    @field_validator('usages_kwh')
    @classmethod
    def _energies_positives(cls, v):
        for cle, kwh in v.items():
            if not (0 <= kwh <= 1e8):
                raise ValueError(f"Énergie hors bornes pour {cle}.")
        return v


class PacCurveSchema(BaseModel):
    """POST .../pac/save-curve : courbe PAC (kW, heure murale, 365 jours) et son bilan."""
    model_config = ConfigDict(extra="ignore")

    pas_temps_min: Literal[10, 15, 30, 60]
    annee: int = Field(ge=2020, le=2050)
    pac: List[float]
    bilan_pac_kwh: float = Field(ge=0, le=1e8)
    # Variante « ECS produite aux heures solaires », pour mesurer le gain d'autoconsommation.
    pac_ecs_solaire: Optional[List[float]] = None
    bilan_pac_ecs_solaire_kwh: Optional[float] = Field(default=None, ge=0, le=1e8)
    resume: PacResume
