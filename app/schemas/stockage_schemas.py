# -*- coding: utf-8 -*-
"""
Validation des paramètres de simulation du stockage batterie (POST /calculate_storage).

Principe « aucune confiance dans la saisie » (demande explicite) : jusqu'ici la route faisait
`float(params.get('sto_cap', 0))` sans la moindre borne. Une capacité nulle, une profondeur de
décharge négative ou un nombre de cycles absurde partaient directement dans PySAM, qui répondait par
une exception de précheck remontée en HTTP 500 — sans indiquer à l'utilisateur quel champ corriger.

Chaque borne ci-dessous reprend celles de la spécification. Elles sont MÉTIER, pas défensives : une
valeur hors plage n'est pas une erreur technique mais une saisie à corriger, et le message renvoyé
doit le dire.

Les séries horaires (production, consommation) ne sont volontairement PAS validées ici : elles ne
viennent pas d'une saisie mais du calcul de production, et leur cohérence est déjà contrôlée par
calculate_storage_data (message explicite si elles manquent).
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Chimies acceptées par PySAM (BatteryTools.battery_model_change_chemistry) et proposées à
# l'utilisateur. 'lmolto' existe côté PySAM mais n'est pas proposé : hors périmètre métier.
CHIMIES = ('lfpgraphite', 'nmcgraphite', 'leadacid')

# Rendement aller-retour : l'enveloppe dépend de la technologie. Un plomb-acide ne dépasse pas
# ~0,60, un lithium ne descend pas sous ~0,70 — une valeur à l'intersection serait forcément une
# erreur de saisie ou de chimie.
RTE_BORNES_PAR_CHIMIE = {
    'lfpgraphite': (0.70, 0.95),
    'nmcgraphite': (0.70, 0.95),
    'leadacid': (0.30, 0.60),
}

# Tensions système normalisées des installations plomb hors réseau (sites isolés). Hors de cette
# liste, la plage générale 12-1500 V s'applique.
TENSIONS_PLOMB_HORS_RESEAU = (12, 24, 48, 96)

MONTAGES = ('serie', 'parallele', 'serie-parallele')


class StorageParams(BaseModel):
    """Caractéristiques batterie et planification, telles que saisies dans le modal de stockage."""

    model_config = ConfigDict(extra="ignore")

    # --- Caractéristiques techniques ---------------------------------------------------------
    sto_cap: float = Field(ge=1, le=5000, description="Capacité batterie (kWh)")
    sto_charge_power: float = Field(ge=0.5, le=2500, description="Puissance de charge (kW)")
    sto_discharge_power: float = Field(ge=0.5, le=2500, description="Puissance de décharge (kW)")
    sto_dod: float = Field(ge=10, le=100, description="Profondeur de décharge (%)")
    sto_rte: float = Field(default=0.90, gt=0, le=1, description="Rendement aller-retour (fraction)")
    sto_cycles: float = Field(ge=500, le=10000, description="Nombre de cycles")
    sto_degrad_cal: float = Field(ge=1, le=10, description="Dégradation calendaire annuelle (%)")
    sto_soh_fin_vie: float = Field(default=60, ge=50, le=99, description="État de santé en fin de vie (%)")
    sto_chemistry: Literal[CHIMIES] = 'lfpgraphite'  # type: ignore[valid-type]
    sto_voltage: float = Field(default=400, ge=12, le=1500, description="Tension système (V)")

    # --- Configuration du parc (cf. configuration_parc_batteries.py) --------------------------
    # Les caractéristiques ci-dessus sont celles d'UNE batterie ; le parc en découle. 0 batterie est
    # accepté ici (borne de saisie 0-100) mais refusé par le calcul, avec un message explicite.
    sto_nb_batteries: int = Field(default=1, ge=0, le=100, description="Nombre de batteries")
    sto_montage: Literal[MONTAGES] = 'serie'  # type: ignore[valid-type]
    sto_nb_serie: Optional[int] = Field(default=None, ge=1, le=100, description="Batteries en série par branche")
    # Évolutivité constructeur et courant max (catalogue) : facultatifs, contrôles faits s'ils sont connus.
    sto_nb_serie_min: Optional[int] = Field(default=None, ge=1, le=100)
    sto_nb_serie_max: Optional[int] = Field(default=None, ge=1, le=100)
    sto_nb_parallele_max: Optional[int] = Field(default=None, ge=1, le=100)
    sto_courant_max_a: Optional[float] = Field(default=None, gt=0, le=10000)

    # --- Couplage ----------------------------------------------------------------------------
    # AC : RTE de fiche AC -> AC. DC (onduleur hybride) : RTE de fiche DC -> DC, rendement européen
    # de l'onduleur et puissance nominale (plafond de décharge) issus du catalogue onduleurs.
    sto_couplage: Literal['AC', 'DC'] = 'AC'
    sto_rendement_onduleur: float = Field(default=0.97, ge=0.8, le=1.0, description="Rendement onduleur hybride (fraction)")
    sto_puissance_onduleur_kw: Optional[float] = Field(default=None, gt=0, le=100000)
    sto_onduleur_hybride: Optional[bool] = None
    sto_onduleur_compatible: Optional[bool] = None

    # --- Contexte et planification (non bornés : issus du calcul, pas d'une saisie) -----------
    sto_prod_totale_mwh: float = 0
    sto_pr_init: float = 0
    sto_restitution_toggle: Optional[str] = None
    sto_recharge_hours: List[int] = Field(default_factory=list)
    sto_decharge_hours: List[int] = Field(default_factory=list)
    time_step: int = Field(default=60, ge=1, le=1440)

    @field_validator('sto_rte', mode='before')
    @classmethod
    def _accepter_pourcentage(cls, valeur):
        """
        Tolère une saisie en pourcentage (90) comme en fraction (0,90).

        Aucun rendement aller-retour réel ne dépasse 100 % : au-delà de 1, la valeur ne peut être
        qu'un pourcentage. Cette tolérance évite de rejeter une saisie parfaitement compréhensible.
        """
        if valeur in (None, ''):
            return 0.90
        nombre = float(valeur)
        return nombre / 100.0 if nombre > 1.0 else nombre

    @field_validator('sto_rendement_onduleur', mode='before')
    @classmethod
    def _rendement_onduleur_pourcentage(cls, valeur):
        """Rendement onduleur saisi en % (97,5) ou en fraction (0,975) ; vide -> 0,97."""
        if valeur in (None, ''):
            return 0.97
        nombre = float(valeur)
        return nombre / 100.0 if nombre > 1.0 else nombre

    @field_validator('sto_couplage', mode='before')
    @classmethod
    def _couplage(cls, valeur):
        """'DC (via StorEdge / HD-Wave)' et variantes -> 'DC' ; vide -> 'AC'."""
        return 'DC' if str(valeur or '').strip().upper().startswith('DC') else 'AC'

    @field_validator('sto_nb_serie', 'sto_nb_serie_min', 'sto_nb_serie_max', 'sto_nb_parallele_max',
                     'sto_courant_max_a', 'sto_puissance_onduleur_kw', mode='before')
    @classmethod
    def _vide_en_none(cls, valeur):
        """Champ facultatif laissé vide ou à 0 -> non renseigné."""
        return None if valeur in (None, '', 0, '0') else valeur

    @field_validator('sto_recharge_hours', 'sto_decharge_hours', mode='before')
    @classmethod
    def _heures_valides(cls, valeur):
        """Heures de recharge / décharge : entiers 0-23, doublons et valeurs aberrantes écartés."""
        if not valeur:
            return []
        heures = {int(h) for h in valeur if str(h).strip() != ''}
        return sorted(h for h in heures if 0 <= h <= 23)

    @model_validator(mode='after')
    def _coherence_metier(self):
        """
        Contrôles qui font intervenir PLUSIEURS champs — impossibles à exprimer champ par champ.
        """
        bornes = RTE_BORNES_PAR_CHIMIE.get(self.sto_chemistry)
        if bornes and not (bornes[0] <= self.sto_rte <= bornes[1]):
            raise ValueError(
                "Rendement aller-retour %.2f incompatible avec la chimie choisie : "
                "attendu entre %.2f et %.2f." % (self.sto_rte, bornes[0], bornes[1]))

        # Plomb-acide : les installations hors réseau utilisent des tensions de bus normalisées.
        # Contrôle informatif plutôt que bloquant sur les autres chimies, où 12-1500 V suffit.
        if self.sto_chemistry == 'leadacid' and self.sto_voltage < 100:
            if int(self.sto_voltage) not in TENSIONS_PLOMB_HORS_RESEAU:
                raise ValueError(
                    "Tension système %g V invalide pour une batterie plomb-acide : "
                    "les valeurs normalisées sont %s V."
                    % (self.sto_voltage, ', '.join(str(v) for v in TENSIONS_PLOMB_HORS_RESEAU)))

        if self.sto_discharge_power > self.sto_cap * 10:
            raise ValueError(
                "Puissance de décharge (%g kW) disproportionnée face à la capacité (%g kWh) : "
                "au-delà de 10 C, le dimensionnement n'a pas de sens physique."
                % (self.sto_discharge_power, self.sto_cap))

        return self


def message_erreur_lisible(erreur):
    """
    Transforme une ValidationError Pydantic en une phrase utilisable par l'utilisateur.

    Les erreurs de modèle (`model_validator`) portent déjà un message métier complet : il est repris
    tel quel. Les erreurs de champ sont préfixées du libellé du champ, plus parlant que son nom
    technique.
    """
    LIBELLES = {
        'sto_cap': 'Capacité batterie (kWh)',
        'sto_charge_power': 'Puissance de charge (kW)',
        'sto_discharge_power': 'Puissance de décharge (kW)',
        'sto_dod': 'DOD (%)',
        'sto_rte': 'Rendement aller-retour',
        'sto_cycles': 'Nombre de cycles',
        'sto_degrad_cal': 'Dégradation calendaire annuelle (%)',
        'sto_chemistry': 'Chimie de la batterie',
        'sto_voltage': 'Tension système (V)',
        'sto_nb_batteries': 'Nombre de batteries',
        'sto_montage': 'Type de montage',
    }
    premiere = erreur.errors()[0] if erreur.errors() else None
    if not premiere:
        return "Paramètres de stockage invalides."

    if not premiere.get('loc'):  # erreur de cohérence inter-champs
        return str(premiere.get('msg', '')).replace('Value error, ', '')

    champ = str(premiere['loc'][0])
    message = str(premiere.get('msg', '')).replace('Value error, ', '')
    return "%s : %s" % (LIBELLES.get(champ, champ), message)
