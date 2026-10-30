"""
GraphModal.py - Modèle de génération de graphiques pour l'analyse de production solaire
Reproduit exactement la logique de showContents() du JS
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from io import BytesIO
import base64
from typing import Dict, List, Tuple
import logging

logger = logging.getLogger(__name__)


# ============================================================
#  RÈGLES DE VALIDATION — source de vérité unique côté backend
#  Doit rester synchronisé avec INPUT_RULES dans GraphModal.js
# ============================================================
PARAM_RULES = {
    "p50_adjustment": {
        "type": float,
        "min": -100.0,
        "max":  100.0,
        "label": "Ajustement P50",
    },
    "uncertainty": {
        "type": float,
        "min": 0.2,
        "max": 5.0,
        "label": "Incertitude",
    },
    "degradation": {
        "type": float,
        "min": 0.25,
        "max": 10.0,
        "label": "Dégradation",
    },
    "duration": {
        "type": int,
        "allowed": {20, 25, 30},
        "label": "Durée",
    },
}


class ValidationError(ValueError):
    """
    Levée quand un paramètre entrant ne respecte pas les règles.
    Le message est directement utilisable dans la réponse HTTP 400.
    """
    pass


def validate_params(
    p50_adjustment: float,
    uncertainty: float,
    degradation: float,
    duration: int,
) -> None:
    """
    Valide l'ensemble des paramètres de calcul.

    Raises:
        ValidationError: avec un message explicite si un paramètre est invalide.
    """
    # ── p50_adjustment ───────────────────────────────────────────
    try:
        p50_adj = float(p50_adjustment)
    except (TypeError, ValueError):
        raise ValidationError(
            f"'{PARAM_RULES['p50_adjustment']['label']}' doit être un nombre "
            f"(reçu : {p50_adjustment!r})."
        )
    if not (PARAM_RULES["p50_adjustment"]["min"] <= p50_adj <= PARAM_RULES["p50_adjustment"]["max"]):
        raise ValidationError(
            f"'{PARAM_RULES['p50_adjustment']['label']}' doit être compris entre "
            f"{PARAM_RULES['p50_adjustment']['min']} et {PARAM_RULES['p50_adjustment']['max']} "
            f"(reçu : {p50_adj})."
        )

    # ── uncertainty ──────────────────────────────────────────────
    try:
        unc = float(uncertainty)
    except (TypeError, ValueError):
        raise ValidationError(
            f"'{PARAM_RULES['uncertainty']['label']}' doit être un nombre "
            f"(reçu : {uncertainty!r})."
        )
    if not (PARAM_RULES["uncertainty"]["min"] <= unc <= PARAM_RULES["uncertainty"]["max"]):
        raise ValidationError(
            f"'{PARAM_RULES['uncertainty']['label']}' doit être compris entre "
            f"{PARAM_RULES['uncertainty']['min']} et {PARAM_RULES['uncertainty']['max']} "
            f"(reçu : {unc})."
        )

    # ── degradation ───────────────────────────────────────────────
    try:
        deg = float(degradation)
    except (TypeError, ValueError):
        raise ValidationError(
            f"'{PARAM_RULES['degradation']['label']}' doit être un nombre "
            f"(reçu : {degradation!r})."
        )
    if not (PARAM_RULES["degradation"]["min"] <= deg <= PARAM_RULES["degradation"]["max"]):
        raise ValidationError(
            f"'{PARAM_RULES['degradation']['label']}' doit être compris entre "
            f"{PARAM_RULES['degradation']['min']} et {PARAM_RULES['degradation']['max']} "
            f"(reçu : {deg})."
        )

    # ── duration ─────────────────────────────────────────────────
    try:
        dur = int(duration)
    except (TypeError, ValueError):
        raise ValidationError(
            f"'{PARAM_RULES['duration']['label']}' doit être un entier "
            f"(reçu : {duration!r})."
        )
    if dur not in PARAM_RULES["duration"]["allowed"]:
        allowed_str = ", ".join(str(v) for v in sorted(PARAM_RULES["duration"]["allowed"]))
        raise ValidationError(
            f"'{PARAM_RULES['duration']['label']}' doit être l'une des valeurs suivantes : "
            f"{allowed_str} (reçu : {dur})."
        )


class GraphModalModel:
    """
    Calculs métier et génération de graphiques matplotlib
    pour l'analyse de production solaire P50/P90.
    """

    YELLOW_COLOR = '#f1c40f'
    BLACK_COLOR  = '#333333'
    FIGURE_BG    = '#ffffff'

    # ==========================================
    # FONCTIONS UTILITAIRES (répliques de CalculationUtils.js)
    # ==========================================

    @staticmethod
    def convert_kwh_to_mwh(value_kwh: float) -> float:
        """Équivalent de CalculationUtils.convertKWhToMWh"""
        return value_kwh / 1000.0

    @staticmethod
    def calculate_puissance_pv_kwc(panel_count: int, puissance_panneau: float) -> float:
        """Équivalent de CalculationUtils.calculatePuissancePVKwc"""
        return (panel_count * puissance_panneau) / 1000.0

    @staticmethod
    def calculate_productible_kwh_kwc(production_totale_mwh: float, puissance_pv_kwc: float) -> float:
        """Équivalent de CalculationUtils.calculateProductibleKwhKwc"""
        if puissance_pv_kwc == 0:
            return 0.0
        return production_totale_mwh / puissance_pv_kwc

    # ==========================================
    # AGRÉGATION DES DONNÉES (réplique exacte de showContents)
    # ==========================================

    def aggregate_solar_data(
        self,
        solar_data: Dict,
        shapes: Dict,
        form_data: Dict
    ) -> Dict:
        """
        Reproduit exactement la boucle Object.entries(data.solarData).forEach(...)
        du JS showContents().
        """
        p50_monthly_data = [0.0] * 12
        total_power = 0.0
        total_productible_mwh = 0.0
        total_moyenne_productible_p50 = []

        for pv_id, pv_solar in solar_data.items():
            if pv_id not in shapes or not shapes[pv_id].get('gridInfo'):
                logger.warning(f"Pas de gridInfo pour {pv_id}, on passe au suivant")
                continue

            mensuel = pv_solar.get('mensuel', [])
            for i in range(min(12, len(mensuel))):
                production_kwh = float(mensuel[i].get('production', 0))
                p50_monthly_data[i] += self.convert_kwh_to_mwh(production_kwh)

            panel_count     = int(shapes[pv_id]['gridInfo'].get('panelCount', 0))
            puissance_panneau = float(form_data.get(pv_id, {}).get('puissancePanneau', 0))
            puissance_pv_kwc  = self.calculate_puissance_pv_kwc(panel_count, puissance_panneau)
            total_power      += puissance_pv_kwc

            production_totale_kwh = float(pv_solar.get('annuel', {}).get('productionTotale', 0))
            production_totale_mwh = self.convert_kwh_to_mwh(production_totale_kwh)
            total_moyenne_productible_p50.append(
                self.calculate_productible_kwh_kwc(production_totale_mwh, puissance_pv_kwc)
            )
            total_productible_mwh += production_totale_mwh

        production_total = round(total_productible_mwh / 1000, 2)

        return {
            'p50_monthly_data': p50_monthly_data,
            'total_power':      round(total_power, 2),
            'productible_p50':  0.0,   # recalculé dans process()
            'production_total': production_total,
        }

    # ==========================================
    # CALCUL P90
    # ==========================================

    def calculate_p90_projection(
        self,
        production_total: float,
        uncertainty: float = 4.9,
        degradation: float = 0.25,
        duration: int = 20
    ) -> Tuple[List[float], float]:
        production_p90 = production_total * ((100 - uncertainty) / 100)

        energie_totale_annee = [0.0] * 31
        energie_totale_annee[0] = production_p90

        for i in range(1, 31):
            energie_totale_annee[i] = energie_totale_annee[i - 1] * ((100 - degradation) / 100)

        chart_data     = energie_totale_annee[:duration]
        somme_total_p90 = sum(chart_data)

        return chart_data, round(somme_total_p90, 2)

    # ==========================================
    # CALCUL P50 CORRIGÉ
    # ==========================================

    def calculate_p50_totals(
        self,
        p50_monthly_data: List[float],
        p50_adjustment: float = 0.0
    ) -> Tuple[float, float]:
        initial_p50_total = sum(p50_monthly_data)
        corrected_p50     = initial_p50_total * (1 + p50_adjustment / 100)
        return initial_p50_total, corrected_p50

    # ==========================================
    # GÉNÉRATION GRAPHIQUE P50
    # ==========================================

    def generate_p50_chart(
        self, monthly_data: List[float],
        width: int = 20, height: int = 10, dpi: int = 100
    ) -> str:
        fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)
        fig.patch.set_facecolor(self.FIGURE_BG)
        ax.set_facecolor(self.FIGURE_BG)

        months  = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
                   'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc']
        x_pos   = np.arange(len(months))
        display_data = [v / 1000 for v in monthly_data]

        ax.bar(x_pos, display_data, color=self.YELLOW_COLOR, edgecolor='none', width=0.8)
        ax.set_xlabel('Mois', fontsize=30, color=self.BLACK_COLOR, weight='bold')
        ax.set_ylabel('Production (MWh)', fontsize=30, color=self.BLACK_COLOR, weight='bold')
        ax.set_xticks(x_pos)
        ax.set_xticklabels(months, fontsize=24, color=self.BLACK_COLOR)
        ax.tick_params(axis='y', colors=self.BLACK_COLOR, labelsize=24)
        ax.yaxis.grid(True, linestyle='--', alpha=0.3, color='gray')
        ax.set_axisbelow(True)

        for spine in ax.spines.values():
            spine.set_edgecolor('#cccccc')
            spine.set_linewidth(1)

        plt.tight_layout()
        return self._fig_to_base64(fig)

    # ==========================================
    # GÉNÉRATION GRAPHIQUE P90
    # ==========================================

    def generate_p90_chart(
        self, yearly_data: List[float], duration: int,
        width: int = 20, height: int = 10, dpi: int = 100
    ) -> str:
        fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)
        fig.patch.set_facecolor(self.FIGURE_BG)
        ax.set_facecolor(self.FIGURE_BG)

        years = list(range(1, duration + 1))
        x_pos = np.arange(len(years))

        ax.bar(x_pos, yearly_data, color=self.YELLOW_COLOR, edgecolor='none', width=0.8)
        ax.set_xlabel('Année', fontsize=30, color=self.BLACK_COLOR, weight='bold')
        ax.set_ylabel('Énergie (MWh)', fontsize=30, color=self.BLACK_COLOR, weight='bold')
        ax.set_xticks(x_pos)
        ax.set_xticklabels(years, fontsize=24, color=self.BLACK_COLOR)
        ax.tick_params(axis='y', colors=self.BLACK_COLOR, labelsize=24)
        ax.yaxis.grid(True, linestyle='--', alpha=0.3, color='gray')
        ax.set_axisbelow(True)

        for spine in ax.spines.values():
            spine.set_edgecolor('#cccccc')
            spine.set_linewidth(1)

        plt.tight_layout()
        return self._fig_to_base64(fig)

    # ==========================================
    # UTILITAIRE : figure → base64
    # ==========================================

    def _fig_to_base64(self, fig) -> str:
        buffer = BytesIO()
        fig.savefig(buffer, format='png', bbox_inches='tight', facecolor=self.FIGURE_BG)
        buffer.seek(0)
        image_b64 = base64.b64encode(buffer.read()).decode('utf-8')
        plt.close(fig)
        return f"data:image/png;base64,{image_b64}"

    # ==========================================
    # POINT D'ENTRÉE PRINCIPAL
    # ==========================================

    def process(
        self,
        solar_data:    Dict,
        shapes:        Dict,
        form_data:     Dict,
        p50_adjustment: float = 0.0,
        uncertainty:    float = 4.9,
        degradation:    float = 0.25,
        duration:       int   = 20,
    ) -> Dict:
        """
        Point d'entrée unique.

        Valide d'abord les paramètres, puis effectue les calculs et génère
        les graphiques. Lève ValidationError si un paramètre est invalide
        (à intercepter dans la route Flask/FastAPI pour renvoyer un HTTP 400).
        """
        # ── Validation en profondeur ─────────────────────────────────
        # Lève ValidationError si quelque chose est invalide.
        # La route doit attraper cette exception et renvoyer HTTP 400.
        validate_params(p50_adjustment, uncertainty, degradation, duration)

        # ── Conversion explicite après validation ────────────────────
        p50_adjustment = float(p50_adjustment)
        uncertainty    = float(uncertainty)
        degradation    = float(degradation)
        duration       = int(duration)

        # ── Calculs ──────────────────────────────────────────────────
        aggregated = self.aggregate_solar_data(solar_data, shapes, form_data)

        initial_p50_total, corrected_p50 = self.calculate_p50_totals(
            aggregated['p50_monthly_data'], p50_adjustment
        )

        total_power = aggregated['total_power']
        productible_p50 = round(corrected_p50 / total_power, 2) if total_power > 0 else 0.0

        p90_chart_data, somme_total_p90 = self.calculate_p90_projection(
            aggregated['production_total'], uncertainty, degradation, duration
        )

        p50_chart = self.generate_p50_chart(aggregated['p50_monthly_data'])
        p90_chart = self.generate_p90_chart(p90_chart_data, duration)

        return {
            'success':   True,
            'p50_chart': p50_chart,
            'p90_chart': p90_chart,
            'data': {
                'p50': {
                    'monthly_production':      [round(v, 6) for v in aggregated['p50_monthly_data']],
                    'initial_total':           round(initial_p50_total, 6),
                    'corrected_total':         round(corrected_p50, 6),
                    'initial_total_display':   round(initial_p50_total / 1000, 2),
                    'corrected_total_display': round(corrected_p50 / 1000, 2),
                },
                'p90': {
                    'yearly_production': [round(v, 6) for v in p90_chart_data],
                    'total':         somme_total_p90,
                    'total_display': round(somme_total_p90, 2),
                },
                'projet': {
                    'puissance_kwc':   aggregated['total_power'],
                    'productible_p50': productible_p50,
                    'production_total': aggregated['production_total'],
                },
            },
        }


# Fonction helper (inchangée — conserve la compatibilité avec le code existant)
def generate_solar_production_charts(
    solar_data:     Dict,
    shapes:         Dict,
    form_data:      Dict,
    p50_adjustment: float = 0.0,
    uncertainty:    float = 4.9,
    degradation:    float = 0.25,
    duration:       int   = 20,
) -> Dict:
    """Fonction helper pour appel direct depuis les routes."""
    model = GraphModalModel()
    return model.process(
        solar_data, shapes, form_data,
        p50_adjustment, uncertainty, degradation, duration,
    )