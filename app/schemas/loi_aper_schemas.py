"""
Schéma Pydantic de validation stricte de la sauvegarde du calculateur Loi APER (calcul_APER.js).

Bornes miroir du front (champs « % Solarisable » : min 0, max 100 ; polygones de 3 points au
moins). Les plafonds de nombre de polygones / de sommets écartent les requêtes qui ne sont pas des
saisies légitimes (un contour fusionné JSTS dépasse rarement quelques centaines de sommets).
"""
import math
import re
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

NB_MAX_POLYGONES_PAR_TYPE = 200
NB_MAX_SOMMETS_PAR_POLYGONE = 5000

# Lettres (accents compris), chiffres, espace et % ( ) - ' . , : ; 100 caractères maximum.
MOTIF_LIBELLE = re.compile(r"^[A-Za-zÀ-ÖØ-öø-ÿ0-9 %()\-'.,:]{1,100}$")


class PointAper(BaseModel):
    model_config = ConfigDict(extra='ignore')

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)

    @field_validator('lat', 'lng')
    @classmethod
    def _fini(cls, v):
        if not math.isfinite(v):
            raise ValueError('coordonnée non finie')
        return v


Contour = List[PointAper]


class PolygonesAper(BaseModel):
    model_config = ConfigDict(extra='forbid')

    surface: List[Contour] = Field(default_factory=list, max_length=NB_MAX_POLYGONES_PAR_TYPE)
    exclusion: List[Contour] = Field(default_factory=list, max_length=NB_MAX_POLYGONES_PAR_TYPE)

    @field_validator('surface', 'exclusion')
    @classmethod
    def _contours(cls, contours):
        for contour in contours:
            if len(contour) < 3:
                raise ValueError('un polygone doit avoir au moins 3 sommets')
            if len(contour) > NB_MAX_SOMMETS_PAR_POLYGONE:
                raise ValueError(f'un polygone ne peut dépasser {NB_MAX_SOMMETS_PAR_POLYGONE} sommets')
        return contours


class VariableAper(BaseModel):
    model_config = ConfigDict(extra='forbid')

    valeur: float = Field(ge=0, le=100)
    libelle: Optional[str] = None

    @field_validator('valeur')
    @classmethod
    def _fini(cls, v):
        if not math.isfinite(v):
            raise ValueError('valeur non finie')
        return v

    @field_validator('libelle')
    @classmethod
    def _libelle(cls, v):
        if v is None:
            return None
        v = v.strip()
        if not MOTIF_LIBELLE.match(v):
            raise ValueError('libellé invalide')
        return v


class VariablesAper(BaseModel):
    model_config = ConfigDict(extra='forbid')

    solarisableAper: VariableAper
    solarisableHuwart: VariableAper


class AperSauvegarde(BaseModel):
    model_config = ConfigDict(extra='forbid')

    polygones: PolygonesAper
    variables: VariablesAper
