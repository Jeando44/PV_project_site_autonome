"""
Calculs liés à la consommation du site (hors bornes IRVE) — port Python, pour validation croisée
avec l'implémentation JavaScript existante (app/static/concevoir_mon_projet/javascript/Irve/calcul_irve.js).
"""

SAISONS = ['Hiver', 'Printemps', 'Été', 'Automne']


def compute_average_existing_hourly(seasonal_hourly_data):
    """
    Port de calculateAverageExistingData() (calcul_irve.js) : moyenne des profils saisonniers
    présents (chacun 24 valeurs horaires, kW) en un profil "jour moyen annuel" de 24 valeurs.
    """
    existing_hourly = [0.0] * 24
    seasons_present = [s for s in SAISONS if seasonal_hourly_data.get(s)]
    if not seasons_present:
        return existing_hourly

    for h in range(24):
        total = 0.0
        for season in seasons_present:
            values = seasonal_hourly_data.get(season) or []
            total += values[h] if h < len(values) else 0.0
        existing_hourly[h] = total / len(seasons_present)
    return existing_hourly


def compute_besoin_journalier_kwh(existing_hourly):
    """Somme des 24 valeurs horaires (kW, 1h/valeur) = énergie journalière moyenne (kWh)."""
    return float(sum(existing_hourly))


def compute_puissance_max_simultanee_kw(existing_hourly):
    """Puissance max. simultanée du site (hors IRVE) sur le profil journalier moyen (kW)."""
    return float(max(existing_hourly)) if existing_hourly else 0.0
