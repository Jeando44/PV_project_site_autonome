# -*- coding: utf-8 -*-
"""
Validation des paramètres de POST /calculate_shed_shading_terrain (perte d'ombrage entre sheds en
tenant compte du relief, cf. app/models/calcul_prodsolaire/calcul_shed_shading_terrain.py).

La géométrie n'est pas saisie directement par l'utilisateur : elle est dérivée côté navigateur des
tables posées et de la grille d'altitudes (calepinage_maison_terrain_tables.js::geometrieOmbrage).
Les bornes ci-dessous sont donc des bornes de VRAISEMBLANCE physique (une pente de terrain de 45°
ou un pas de 200 m n'ont pas de sens pour un petit champ solaire) et de CHARGE (nombre de
géométries distinctes à simuler sur une année horaire), pas des bornes de saisie.
"""

from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_GROUPES = 50
MAX_COUPLES_PAR_GROUPE = 2000
MAX_COUPLES_TOTAL = 3000
# Tolérance sur « somme des poids des couples <= panneaux du groupe » : les poids sont des
# fractions de recouvrement arrondies côté navigateur.
TOLERANCE_POIDS = 1e-3


class CoupleOmbrage(BaseModel):
    """Table ombrée / table(s) qui la précèdent : une géométrie 2D en coupe."""
    model_config = ConfigDict(extra='forbid')

    pitch: float = Field(gt=0, le=200, description="Pas horizontal entre axes (m)")
    cross_axis_slope: float = Field(ge=-45, le=45, description="Pente de la droite des axes, > 0 : rangée de devant plus basse (°)")
    poids: float = Field(gt=0, le=200000, description="Panneaux de la table ombrée x fraction recouverte")


class GroupeOmbrage(BaseModel):
    """Tables de même orientation (pan) : orientation nominale + inclinaison de l'axe."""
    model_config = ConfigDict(extra='forbid')

    tilt: float = Field(ge=0, le=90, description="Inclinaison de la table en travers (°)")
    surface_azimuth: float = Field(ge=0, lt=360, description="Azimut de la table (180 = Sud)")
    axis_tilt: float = Field(ge=-45, le=45, description="Pente de l'axe le long de la rangée, > 0 : descend vers azimut - 90 (°)")
    panneaux: float = Field(gt=0, le=200000, description="Panneaux du groupe (poids de la référence)")
    couples: List[CoupleOmbrage] = Field(default_factory=list, max_length=MAX_COUPLES_PAR_GROUPE)

    @model_validator(mode='after')
    def _poids_coherents(self):
        somme = sum(c.poids for c in self.couples)
        if somme > self.panneaux * (1 + TOLERANCE_POIDS) + TOLERANCE_POIDS:
            raise ValueError("Géométrie d'ombrage incohérente : plus de panneaux ombrés que de panneaux dans le groupe.")
        return self


class ShedShadingTerrainParams(BaseModel):
    model_config = ConfigDict(extra='ignore')

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    collector_width: float = Field(gt=0, le=30, description="Profondeur d'une table le long de la pente (m)")
    height: float = Field(default=0.5, ge=0, le=20, description="Hauteur du bord bas (m)")
    albedo: float = Field(default=0.2, ge=0, le=1)
    groupes: List[GroupeOmbrage] = Field(min_length=1, max_length=MAX_GROUPES)

    usehorizon: Optional[str] = '1'
    pv_version: Optional[str] = 'v5_3'
    time_step: int = 60
    force_api: bool = False
    tmy_cache_id: Optional[str] = None

    @model_validator(mode='after')
    def _charge(self):
        if sum(len(g.couples) for g in self.groupes) > MAX_COUPLES_TOTAL:
            raise ValueError(
                "Champ trop découpé pour le calcul d'ombrage avec terrain (plus de %d géométries distinctes)."
                % MAX_COUPLES_TOTAL)
        return self


LIBELLES = {
    'lat': 'Latitude', 'lon': 'Longitude',
    'collector_width': 'Profondeur de shed (m)', 'height': 'Hauteur bas PV (m)',
    'albedo': 'Albédo', 'groupes': "Géométrie d'ombrage",
}


def message_erreur_lisible(erreur):
    """Première erreur Pydantic en phrase lisible (même principe que stockage_schemas)."""
    premiere = erreur.errors()[0] if erreur.errors() else None
    if not premiere:
        return "Paramètres d'ombrage invalides."
    message = str(premiere.get('msg', '')).replace('Value error, ', '')
    if not premiere.get('loc'):
        return message
    champ = str(premiere['loc'][0])
    return "%s : %s" % (LIBELLES.get(champ, champ), message)
