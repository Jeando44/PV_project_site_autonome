"""
Pré-dimensionnement d'autonomie énergétique pour site isolé (off-grid) — port Python de
autonomyCalculator.js (app/static/concevoir_mon_projet/javascript/Irve/), pour validation croisée.
Appelle directement calculate_pv_data() (app/models/calcul_prodsolaire/calcul_prodsolaire.py),
la même fonction utilisée par l'API solaire côté JS (/calculate_pv), pour bénéficier de la même
simulation PVGIS/pvlib et de la même irradiation POA journalière réelle (daily_poa_kwh_m2).
"""

from app.models.calcul_prodsolaire.calcul_prodsolaire import calculate_pv_data


def build_autonomy_pv_params(autonomie_params, lat, lon):
    """Payload minimal : un seul champ de référence de 1 kWc, mêmes valeurs par défaut que
    buildAutonomyPvParams() côté JS (autonomyCalculator.js)."""
    return {
        'lat': lat,
        'lon': lon,
        'fields': [{
            'id': 'AUTONOMIE_REF',
            'panel_ref': 'N/A',
            'peak_power': 1,
            'losses': autonomie_params.get('pertes', 10),
            'tech': 'crystSi',
            'pv_type': 'monofacial',
            'albedo': 0.2,
            'bifaciality': 0.7,
            'cells_in_series': 60,
            'mount': autonomie_params.get('mount', 'free'),
            'track': '0',
            'angle': str(autonomie_params.get('inclinaison', 30)),
            'aspect': str(autonomie_params.get('azimut', 0)),
            'tempcoeff': '0.29',
            'tempcoeff_voc': -0.27,
            'tempcoeff_isc': 0.04,
            'inv_limit': 0,
            'inv_cons': 0,
            'inv_eff': 0,
            'vmp': 31.0,
            'imp': 12.9,
            'voc': 37.1,
            'isc': 13.7,
            'plant_id': '1'
        }],
        'pv_version': 'v5_3',
        'aux_cons': 0,
        'usehorizon': autonomie_params.get('usehorizon', '1'),
        'raddb': 'PVGIS-SARAH3',
        'startyear': '2005',
        'endyear': '2023',
        'time_step': 60,
        'force_api': False,
        'advanced_sim': {'enabled': False}
    }


def compute_autonomy(besoin_journalier_kwh, puissance_max_simultanee_kw, autonomie_params, lat, lon):
    """
    Calcule les résultats de pré-dimensionnement (PV kWc, batterie kWh, onduleur kVA) à partir d'un
    appel direct à calculate_pv_data() (irradiation POA réelle, PR réel — pas de reconstruction
    approximative à partir d'un PR annuel moyen).

    Ensoleillement min./max. : moyenne journalière du mois le moins/plus ensoleillé (12 valeurs,
    `monthly_avg_daily_poa_kwh_m2`) plutôt qu'un min/max sur les 365 jours individuels — un unique
    jour anormal (ciel exceptionnellement clair en hiver, très couvert en été) fausserait sinon
    fortement le résultat, contrairement à la convention des tables PVGIS "Monthly irradiation"
    auxquelles ces valeurs sont comparées.

    Productible annuel (kWh/kWc/an, après PR) : renvoyé pour permettre une vérification de
    cohérence visuelle rapide côté frontend (valeur typique ~900-1200 kWh/kWc/an en France).
    """
    pv_params = build_autonomy_pv_params(autonomie_params, lat, lon)
    result = calculate_pv_data(pv_params)  # lève une exception en cas d'échec (cf. calculate_pv_data)

    field = result['fields'][0]
    monthly_poa = field.get('monthly_avg_daily_poa_kwh_m2') or []
    if not monthly_poa:
        raise ValueError("Irradiation POA mensuelle manquante dans la réponse de calculate_pv_data().")

    ensoleillement_min = min(monthly_poa)
    ensoleillement_max = max(monthly_poa)
    productible_annuel_kwh_kwc = field.get('specific_production', 0)
    pr = result['summary']['performance_ratio']
    pr_fraction = pr / 100.0
    if pr_fraction <= 0:
        raise ValueError("Performance Ratio nul ou invalide, impossible de dimensionner.")

    cible_pct = autonomie_params.get('cible_autonomie_pct', 100)
    coeff_evolution = autonomie_params.get('coeff_evolution', 1.25)
    nb_jours = autonomie_params.get('nb_jours_autonomie', 2)
    rendement_batterie = autonomie_params.get('rendement_batterie', 0.90)
    dod = autonomie_params.get('dod', 0.80)

    # Formule 1 : Puissance PV nécessaire (kWc)
    puissance_pv_kwc = (coeff_evolution * (cible_pct / 100.0) * besoin_journalier_kwh) / (pr_fraction * ensoleillement_min)
    # Formule 2 : Capacité batterie nécessaire (kWh)
    capacite_batterie_kwh = (besoin_journalier_kwh * nb_jours) / (rendement_batterie * dod)
    # Formule 3 : Puissance onduleur nécessaire (kVA) = puissance max simultanée du site x coefficient d'évolution
    puissance_onduleur_kva = puissance_max_simultanee_kw * coeff_evolution

    return {
        'besoin_journalier_kwh': besoin_journalier_kwh,
        # Consommation annuelle du site (hors IRVE) : le besoin journalier moyen ramene a l'annee.
        # Expose ici plutot que recalcule par chaque appelant, pour que le modal de consommation et
        # l'etude economique ("Consommation annuelle d'energie du site") affichent strictement la
        # meme valeur, issue du meme calcul.
        'consommation_annuelle_kwh': besoin_journalier_kwh * 365,
        # Renvoyee telle quelle : 'puissance_pv_kwc' ci-dessous est la puissance necessaire POUR
        # CETTE CIBLE (100 % par defaut). Le taux de couverture reel calcule cote frontend
        # (PV installee / PV necessaire) se lit donc toujours par rapport a cette base.
        'cible_autonomie_pct': cible_pct,
        # Puissance max simultanee du site (hors IRVE, avant foisonnement) : deja recue en entree,
        # renvoyee telle quelle pour que le frontend puisse l'afficher dans la carte de resultats du
        # calepinage sans la recalculer de son cote (elle vient soit du pic avant foisonnement de la
        # Methode 1, soit du max du profil journalier).
        'puissance_max_simultanee_kw': puissance_max_simultanee_kw,
        'pr': pr,
        'productible_annuel_kwh_kwc': productible_annuel_kwh_kwc,
        'ensoleillement_min': ensoleillement_min,
        'ensoleillement_max': ensoleillement_max,
        'puissance_pv_kwc': puissance_pv_kwc,
        'capacite_batterie_kwh': capacite_batterie_kwh,
        'puissance_onduleur_kva': puissance_onduleur_kva
    }
