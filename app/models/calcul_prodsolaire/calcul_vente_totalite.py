import numpy as np
import json
from .calcul_acc import aggregate_to_monthly # Réutilisation de l'agrégateur mensuel

def process_vente_totalite_data(raw_pv_data, time_step_minutes, p90_params_json):
    """
    Traite les données pour une analyse en "Vente en Totalité".
    Simule une consommation nulle pour utiliser la structure de résultats existante.
    """
    dt = time_step_minutes / 60.0
    expected_length = 8760 * (60 // time_step_minutes)
    p90_params = json.loads(p90_params_json)
    z_score_p90 = 1.282 # Z-score pour une probabilité de 90%

    # Assurer que les données PV sont un tableau numpy
    pv_prod = np.array(raw_pv_data)
    if pv_prod.size < expected_length:
        raise ValueError(f"Les données PV contiennent {pv_prod.size} valeurs, mais {expected_length} sont attendues.")
    pv_prod = pv_prod[:expected_length]

    # Calcul de la puissance crête à partir du pic de production
    total_peak_power_kw = float(np.max(pv_prod)) if pv_prod.size > 0 else 0.0

    # Simulation d'une consommation nulle
    total_cons_kwh = 0
    pv_consumed_kwh = 0
    
    # Toute la production est du surplus
    surplus_kwh = np.sum(pv_prod) * dt
    total_prod_kwh = surplus_kwh

    # Calcul des taux (seront 0% ou 100% pour le surplus)
    autoconsumption_rate = (pv_consumed_kwh / total_prod_kwh * 100) if total_prod_kwh > 0 else 0
    autoproduction_rate = 0 # Pas de consommation, donc pas d'autoproduction

    # Résumé global
    global_summary = {
        'production_mwh': total_prod_kwh / 1000,
        'consumption_mwh': total_cons_kwh / 1000,
        'pv_consumed_mwh': pv_consumed_kwh / 1000,
        'surplus_mwh': surplus_kwh / 1000,
        'autoconsumption_rate': autoconsumption_rate,
        'autoproduction_rate': autoproduction_rate,
        'peak_power_kw': total_peak_power_kw
    }

    # Données mensuelles pour les graphiques
    months = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin', 'Jui', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec']
    monthly_prod = [val / 1000 for val in aggregate_to_monthly(pv_prod, time_step_minutes)]
    monthly_cons = [0.0] * 12
    monthly_pv_consumed = [0.0] * 12

    # NOUVEAU: Calcul des séries P50 et P90 sur l'horizon
    horizon = p90_params.get('horizon', 20)
    degradation_rate = p90_params.get('degradation', 0.5) / 100.0 # ex: 0.5% -> 0.005
    incertitude_prod_rate = p90_params.get('incertitude_production', 3.5) / 100.0
    incertitude_meteo_rate = p90_params.get('incertitude_meteo', 2.5) / 100.0
    # Combinaison quadratique des incertitudes indépendantes
    total_incertitude_rate = (incertitude_prod_rate**2 + incertitude_meteo_rate**2)**0.5

    p50_series_mwh = []
    p90_series_mwh = []
    for year in range(horizon):
        # P50 est la production attendue, qui se dégrade chaque année
        p50_year = total_prod_kwh * ((1 - degradation_rate) ** year)
        p50_series_mwh.append(p50_year / 1000)

        # P90 est la production P50 réduite par l'incertitude
        p90_year = p50_year * (1 - z_score_p90 * total_incertitude_rate)
        p90_series_mwh.append(p90_year / 1000)

    # Formatage de la sortie pour correspondre à ce que le front-end attend
    final_output = {
        'site_keys': ['Global'],
        'sites': {
            'Global': {
                'summary': global_summary,
                'monthly_data': {
                    'pv_production': monthly_prod,
                    'total_consumption': monthly_cons,
                    'pv_consumed': monthly_pv_consumed
                },
                'charts': {
                    'pie_autoprod': {
                        'title': "Taux d'autoproduction (Global)",
                        'labels': ['Part Solaire', 'Part Réseau'],
                        'data': [0, 100],
                        'colors': ['#FFC107', '#424242']
                    },
                    'pie_autocons': {
                        'title': "Taux d'autoconsommation (Global)",
                        'labels': ['PV Autoconsommé', 'Surplus (Vente totale)'],
                        'data': [0, 100],
                        'colors': ['#1E8449', '#E74C3C']
                    },
                    'monthly_bar': {'labels': months, 'datasets': [{'label': 'Production PV (Année 1)', 'data': monthly_prod, 'backgroundColor': 'rgba(255, 215, 0, 0.7)', 'borderRadius': 6}]}
                }
            }
        },
        # NOUVEAU: Ajout des données P50/P90 pour les nouveaux graphiques
        'p50_p90_data': {
            'labels': [f'An {i+1}' for i in range(horizon)],
            'p50': p50_series_mwh,
            'p90': p90_series_mwh
        }
    }

    return final_output