import pandas as pd
import numpy as np
from .calcul_autoconso import extract_consumption # On réutilise l'extracteur de consommation
from .time_step_utils import expected_length_for
from .rate_utils import clamp_rate_pct

def aggregate_to_monthly(hourly_data, time_step_minutes):
    """
    Agrège un tableau de données horaires (ou infra-horaires) en 12 totaux mensuels.
    """
    step_duration_hours = time_step_minutes / 60.0
    steps_per_day = 24 * (60 // time_step_minutes)
    days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    
    monthly_totals = [0.0] * 12
    current_step = 0
    
    for month_idx, days in enumerate(days_in_month):
        steps_in_month = days * steps_per_day
        month_end_step = current_step + steps_in_month
        
        if current_step < len(hourly_data):
            month_slice = hourly_data[current_step:month_end_step]
            # Correction pour éviter les erreurs sur les tableaux vides
            monthly_totals[month_idx] = np.sum(month_slice) * step_duration_hours if len(month_slice) > 0 else 0.0
        
        current_step = month_end_step
        
    return monthly_totals

def process_acc_data(raw_pv_data, cons_files, time_step, repartition_method='dynamic', repartition_keys=None, grid_loss_percent=0, custom_names=None, priority_order=None, true_peak_power_kw=None):
    """
    Logique principale pour le calcul de l'autoconsommation collective (ACC).
    """
    expected_length = expected_length_for(time_step)
    dt = time_step / 60.0

    if repartition_keys is None:
        repartition_keys = {}
    if custom_names is None:
        custom_names = {}
    if priority_order is None:
        priority_order = []

    # CORRECTIF : la méthode de répartition "fixed" ne garantit rien côté client — un appel API
    # direct (ou un bug JS) pourrait envoyer des clés dont la somme dépasse 100%, ce qui rendrait
    # remaining_pv négatif plus bas (physiquement impossible : on distribuerait plus de PV que ce
    # qui est produit). Revalidé ici, côté serveur, indépendamment du garde-fou déjà présent côté
    # client (main_autoconso.js).
    if repartition_method == 'fixed':
        total_keys = sum(repartition_keys.values())
        if abs(total_keys - 100) > 0.5:
            raise ValueError(
                f"La somme des clés de répartition fixes doit être égale à 100% (actuellement {total_keys:.2f}%)."
            )

    # 0. Agréger la production de toutes les centrales
    # raw_pv_data est maintenant un dictionnaire {'1': [...], '2': [...]}
    if isinstance(raw_pv_data, dict):
        total_pv_prod_series = [np.array(p) for p in raw_pv_data.values()]
        pv_prod_brute = np.sum(total_pv_prod_series, axis=0)
    else: # Rétrocompatibilité si on reçoit une simple liste
        pv_prod_brute = np.array(raw_pv_data)

    # CORRECTIF (dimensionnement CAPEX/OPEX faussé) : max(pv_prod_brute) n'est PAS la puissance
    # crête installée (nameplate/STC) — c'est le pic de la courbe de production réelle, toujours
    # inférieur au nameplate (PR<100%, écrêtage onduleur, irradiance rarement à 1000 W/m²). C'est
    # l'équivalent de "max_production_kw" dans calcul_prodsolaire.py, pas de son "peak_power_kw".
    # Quand la production vient de PVGIS (true_peak_power_kw fourni par la route, somme des
    # puissances crêtes STC de chaque champ), on utilise cette vraie valeur nameplate pour le
    # dimensionnement financier. En import manuel d'un fichier de production (pas de config de
    # champs disponible), aucune puissance nameplate n'est connue : on retombe sur l'ancienne
    # approximation (pic de la courbe), documentée comme telle plutôt que mal nommée.
    max_production_kw = float(np.max(pv_prod_brute)) if pv_prod_brute.size > 0 else 0.0
    total_peak_power_kw = float(true_peak_power_kw) if true_peak_power_kw is not None else max_production_kw

    # Application des pertes de transit
    pv_prod = pv_prod_brute * (1 - grid_loss_percent / 100.0)

    # 1. Extraire et valider les courbes de chaque consommateur
    consumers_data = []
    fichiers_ignores = []
    for file in cons_files:
        try:
            curves = extract_consumption(file, expected_length)
            if curves:
                # On prend la courbe "Cons. existante" de chaque fichier. extract_consumption écarte les
                # courbes entièrement nulles : un export "Courbe_Charge_Bornes" sans consommation existante
                # (bornes seules) n'a plus que "Cons. IRVE"/"Cons. Totale" — sans repli, le participant
                # était ignoré sans message.
                cons_curve = next((c for label in ('Cons. existante', 'Cons. Totale', 'Cons. IRVE')
                                   for c in curves if c['label'] == label), None)
                if cons_curve:
                    # Utiliser le nom personnalisé s'il existe, sinon le nom de fichier
                    custom_name = custom_names.get(file.filename, file.filename)
                    consumers_data.append({
                        'name': file.filename,
                        'custom_name': custom_name,
                        'consumption': np.array(cons_curve['data'])
                    })
                    continue
            fichiers_ignores.append(file.filename)
        except Exception as e:
            print(f"Avertissement: Impossible de lire le fichier {file.filename}. Erreur: {e}")
            fichiers_ignores.append(file.filename)

    if not consumers_data:
        raise ValueError("Aucune courbe de consommation valide n'a pu être extraite.")

    # 2. Préparation des tableaux numpy pour le calcul
    all_cons = np.array([c['consumption'] for c in consumers_data])
    total_cons_per_step = np.sum(all_cons, axis=0)

    # Initialisation des résultats pour chaque consommateur
    for consumer in consumers_data:
        consumer['results'] = {
            'pv_consumed': np.zeros(expected_length),
            'surplus': np.zeros(expected_length),
            'grid_import': np.zeros(expected_length)
        }

    # 3. Boucle de calcul principale
    remaining_pv = np.copy(pv_prod)

    if repartition_method == 'priority':
        # NOUVEAU: Logique de répartition par priorité
        # Ordonner les consommateurs selon la liste `priority_order`
        ordered_consumers = sorted(consumers_data, key=lambda c: priority_order.index(c['custom_name']) if c['custom_name'] in priority_order else float('inf'))
        
        for i in range(expected_length):
            pv_at_step = pv_prod[i]
            if pv_at_step <= 0:
                # S'il n'y a pas de production, tout le monde importe du réseau
                for consumer in ordered_consumers:
                    consumer['results']['grid_import'][i] = consumer['consumption'][i]
                continue

            # Servir les consommateurs dans l'ordre de priorité
            for consumer in ordered_consumers:
                cons_at_step = consumer['consumption'][i]
                pv_consumed = min(cons_at_step, pv_at_step)
                
                consumer['results']['pv_consumed'][i] = pv_consumed
                consumer['results']['grid_import'][i] = cons_at_step - pv_consumed
                
                pv_at_step -= pv_consumed # Réduire le PV disponible pour les suivants
            
            # Le PV restant à ce pas de temps est le surplus global
            remaining_pv[i] = pv_at_step

    else: # Logique existante pour 'dynamic' et 'fixed'
        for i in range(expected_length):
            total_cons_at_step = total_cons_per_step[i]
            
            if total_cons_at_step > 0:
                # Répartir la production PV au prorata de la consommation de chacun
                for consumer in consumers_data:
                    # La clé pour la répartition est le nom personnalisé
                    repartition_key_name = consumer['custom_name']
                    if repartition_method == 'fixed':
                        # Clé de répartition fixe (en %)
                        key_percent = repartition_keys.get(repartition_key_name, 0)
                        repartition_coeff = key_percent / 100.0
                    else: # 'dynamic'
                        # Coefficient de répartition dynamique
                        cons_at_step = consumer['consumption'][i]
                        repartition_coeff = cons_at_step / total_cons_at_step
                    
                    # Part de PV allouée à ce consommateur
                    pv_allocated = pv_prod[i] * repartition_coeff
                    cons_at_step = consumer['consumption'][i]
                    
                    # L'énergie autoconsommée est le minimum entre sa conso et le PV qui lui est alloué
                    pv_consumed_by_consumer = min(cons_at_step, pv_allocated)
                    
                    consumer['results']['pv_consumed'][i] = pv_consumed_by_consumer
                    consumer['results']['grid_import'][i] = consumer['consumption'][i] - pv_consumed_by_consumer
                    
                    # On soustrait ce qui a été consommé du PV total disponible
                    remaining_pv[i] -= pv_consumed_by_consumer

    # Le surplus est le même pour tous les participants (ce qui reste après que tout le monde se soit servi)
    surplus_global = remaining_pv

    # 4. Agrégation des résultats et formatage pour le front-end
    sites = {}
    global_summary = {
        'production_mwh': 0, 'consumption_mwh': 0, 'pv_consumed_mwh': 0, 
        'surplus_mwh': 0, 'autoconsumption_rate': 0, 'autoproduction_rate': 0
    }

    # Calculs pour chaque consommateur individuel
    for consumer in consumers_data:
        name = consumer['custom_name'] # Utiliser le nom personnalisé pour les résultats
        res = consumer['results']
        
        total_prod_kwh = np.sum(pv_prod) * dt
        total_cons_kwh = np.sum(consumer['consumption']) * dt
        pv_consumed_kwh = np.sum(res['pv_consumed']) * dt
        
        summary = {
            'production_mwh': total_prod_kwh / 1000,
            'consumption_mwh': total_cons_kwh / 1000,
            'pv_consumed_mwh': pv_consumed_kwh / 1000,
            'surplus_mwh': (np.sum(surplus_global) * dt) / 1000, # Le surplus est global
            # CORRECTIF (sécurité) : un taux >100% est physiquement impossible et trahit une donnée
            # d'entrée invalide (ex. clés de répartition ACC mal formées) — refuser plutôt qu'afficher.
            'autoconsumption_rate': clamp_rate_pct((pv_consumed_kwh / total_prod_kwh * 100) if total_prod_kwh > 0 else 0, f"Taux d'autoconsommation ({name})"),
            'autoproduction_rate': clamp_rate_pct((pv_consumed_kwh / total_cons_kwh * 100) if total_cons_kwh > 0 else 0, f"Taux d'autoproduction ({name})"),
        }
        sites[name] = {'summary': summary, 'charts': {}} # Charts à ajouter plus tard

        # Agrégation pour le résumé global
        global_summary['consumption_mwh'] += summary['consumption_mwh']
        global_summary['pv_consumed_mwh'] += summary['pv_consumed_mwh']

    # Finalisation du résumé global
    global_summary['production_mwh'] = (np.sum(pv_prod) * dt) / 1000
    global_summary['peak_power_kw'] = total_peak_power_kw # Puissance nameplate (STC) si connue, sinon pic de courbe (cf. commentaire plus haut)
    global_summary['max_production_kw'] = max_production_kw # Pic réel de la courbe de production, toujours <= peak_power_kw
    global_summary['surplus_mwh'] = (np.sum(surplus_global) * dt) / 1000
    if global_summary['production_mwh'] > 0:
        global_summary['autoconsumption_rate'] = clamp_rate_pct((global_summary['pv_consumed_mwh'] / global_summary['production_mwh']) * 100, "Taux d'autoconsommation global")
    if global_summary['consumption_mwh'] > 0:
        global_summary['autoproduction_rate'] = clamp_rate_pct((global_summary['pv_consumed_mwh'] / global_summary['consumption_mwh']) * 100, "Taux d'autoproduction global")

    sites['Global'] = {'summary': global_summary, 'charts': {}}

    # 5. Calcul des données mensuelles pour les graphiques
    months = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin', 'Jui', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec']
    
    # Données mensuelles globales
    monthly_global_prod = [val / 1000 for val in aggregate_to_monthly(pv_prod, time_step)]
    monthly_global_cons = [val / 1000 for val in aggregate_to_monthly(total_cons_per_step, time_step)]
    monthly_global_surplus = [val / 1000 for val in aggregate_to_monthly(surplus_global, time_step)]
    monthly_global_pv_consumed = [p - s for p, s in zip(monthly_global_prod, monthly_global_surplus)]
    
    # Préparation des datasets pour le graphique global
    global_datasets = []
    
    # Si les données PV sont structurées par centrale, on crée un dataset pour chacune
    if isinstance(raw_pv_data, dict) and len(raw_pv_data) > 1:
        plant_colors = ['rgba(255, 215, 0, 0.7)', 'rgba(251, 146, 60, 0.7)'] # Jaune pour C1, Orange pour C2
        for i, (plant_id, plant_prod_series) in enumerate(raw_pv_data.items()):
            monthly_plant_prod = [val / 1000 for val in aggregate_to_monthly(plant_prod_series, time_step)]
            global_datasets.append({
                'label': f'Production Centrale {plant_id}',
                'data': monthly_plant_prod,
                'backgroundColor': plant_colors[i % len(plant_colors)],
                'borderRadius': 6
            })
    else:
        # Comportement par défaut : une seule barre pour la production totale
        global_datasets.append({'label': 'Production PV Totale', 'data': monthly_global_prod, 'backgroundColor': 'rgba(255, 215, 0, 0.7)', 'borderRadius': 6})

    # Ajout des autres datasets globaux
    global_datasets.extend([
        {'label': 'Consommation Totale', 'data': monthly_global_cons, 'backgroundColor': 'rgba(239, 68, 68, 1)', 'borderRadius': 6},
        {'label': 'PV Autoconsommé (Global)', 'data': monthly_global_pv_consumed, 'backgroundColor': 'rgba(30, 132, 73, 0.8)', 'borderRadius': 6},
        {'label': 'Excédent Global', 'data': monthly_global_surplus, 'backgroundColor': 'rgba(107, 114, 128, 0.7)', 'borderRadius': 6}
    ])
    
    sites['Global']['charts'] = {
        'monthly_bar': { 'labels': months, 'datasets': global_datasets }
    }

    # Données mensuelles pour chaque consommateur
    for consumer in consumers_data:
        name = consumer['custom_name'] # Utiliser le nom personnalisé
        monthly_cons = [val / 1000 for val in aggregate_to_monthly(consumer['consumption'], time_step)]
        monthly_pv_consumed = [val / 1000 for val in aggregate_to_monthly(consumer['results']['pv_consumed'], time_step)]
        sites[name]['charts'] = {
            'monthly_bar': {
                'labels': months,
                'datasets': [
                    {'label': 'Consommation du site', 'data': monthly_cons, 'backgroundColor': 'rgba(239, 68, 68, 1)', 'borderRadius': 6},
                    {'label': 'PV Autoconsommé par le site', 'data': monthly_pv_consumed, 'backgroundColor': 'rgba(30, 132, 73, 0.8)', 'borderRadius': 6}
                ]
            }
        }

    # Préparation des données pour les graphiques (simplifié pour l'instant)
    # CORRECTIF (camembert "autoconsommation" par participant incohérent) : summary['autoconsumption_rate']
    # est pv_consumed_kwh / production TOTALE DU PROJET (la même valeur pour tous les sites, cf. plus
    # haut) — un vrai "taux d'autoconsommation" n'a de sens qu'au niveau de la centrale (Global) : un
    # participant ne "possède" pas de production propre. Pour un site individuel, ce nombre reste
    # correct mathématiquement (part de la production totale que CE site a consommée), mais l'intitulé
    # "Taux d'autoconsommation" est trompeur (laisse croire à une mesure d'autoconsommation propre au
    # site). Il est donc reformulé pour les participants, sans toucher au calcul ni à Global (où le
    # terme est standard et correct).
    for site_name, site_data in sites.items():
        is_global = site_name == 'Global'
        autocons_title = f"Taux d'autoconsommation ({site_name})" if is_global else f"Part de la production totale consommée par {site_name}"
        autocons_labels = ['PV Autoconsommé', 'Surplus'] if is_global else ['Part consommée par ce site', 'Reste de la production du projet']
        # On fusionne les données des camemberts avec les données de l'histogramme déjà calculées
        site_data['charts'].update({
            'pie_autoprod': {
                'title': f"Taux d'autoproduction ({site_name})",
                'labels': ['Part Solaire', 'Part Réseau'],
                'data': [site_data['summary']['autoproduction_rate'], 100 - site_data['summary']['autoproduction_rate']],
                'colors': ['#FFC107', '#424242']
            },
            'pie_autocons': {
                'title': autocons_title,
                'labels': autocons_labels,
                'data': [site_data['summary']['autoconsumption_rate'], 100 - site_data['summary']['autoconsumption_rate']],
                'colors': ['#1E8449', '#E74C3C']
            }
        })

    # 6. Préparation des données horaires pour l'export Excel
    hourly_data = {
        'pv_production': pv_prod.tolist(),
        'total_consumption': total_cons_per_step.tolist(),
        'global_surplus': surplus_global.tolist(),
        'consumers': {}
    }

    for consumer in consumers_data:
        name = consumer['custom_name'] # Utiliser le nom personnalisé pour l'export
        hourly_data['consumers'][name] = {
            'consumption': consumer['consumption'].tolist(),
            'pv_consumed': consumer['results']['pv_consumed'].tolist(),
            'grid_import': consumer['results']['grid_import'].tolist()
        }

    return {
        "site_keys": ['Global'] + [c['custom_name'] for c in consumers_data],
        "sites": sites,
        "hourly_data": hourly_data,
        # Fichiers sans courbe exploitable (illisibles ou entièrement nuls), signalés côté front.
        "fichiers_ignores": fichiers_ignores
    }