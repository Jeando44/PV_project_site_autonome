import numpy as np
import numpy_financial as npf

def calculate_economic_analysis(energetic_results, economic_params):
    """
    Calcule la rentabilité d'un projet d'ACC pour chaque participant (Année 1)
    et réalise une analyse financière complète pour le producteur sur l'horizon du projet.
    """
    
    # Prix global pour la vente du surplus au réseau
    prix_vente_surplus = economic_params.get('prix_vente_surplus', 0.10)
    
    # Dictionnaire des tarifs par participant
    participant_prices = economic_params.get('participants', {})
    
    # Dictionnaire des taux d'inflation du prix réseau par profil
    inflation_grid_prices_by_profile = economic_params.get('inflation_grid_price', {})

    economic_results = {}
    total_revenu_producteur = 0
    # CORRECTIF (inflation_grid_price collectée mais jamais utilisée) : conservé pour la projection
    # pluriannuelle de la PARTIE 2 (économie Année 1 -> économie sur tout l'horizon, avec inflation du
    # prix réseau propre au profil de chaque participant). Miroir exact de main_rentabilite.js
    # (calculateEconomicAnalysisJS), qui est la version réellement utilisée en production pour la
    # réactivité de l'UI — ce fichier Python sert de vérification indépendante avant impression du
    # rapport ACC, les deux DOIVENT rester alignés.
    consumer_raw_data = []

    # --- PARTIE 1: Calcul des économies pour les consommateurs (Année 1) ---

    for site_key, site_data in energetic_results['sites'].items():
        if site_key == 'Global':
            continue

        # Récupérer les tarifs spécifiques à ce participant, avec des valeurs par défaut
        prices = participant_prices.get(site_key, {})
        prix_achat_reseau = prices.get('prix_achat', 0.25)
        profil = prices.get('profil', 'Résidentiel') # Récupérer le profil du participant
        prix_vente_interne_acc = prices.get('prix_vente_interne', 0.18)

        # Récupérer le taux d'inflation spécifique au profil, avec une valeur par défaut
        inflation_grid_rate = inflation_grid_prices_by_profile.get(profil, 2.5)

        # Récupérer les données énergétiques en kWh
        cons_total_kwh = site_data['summary']['consumption_mwh'] * 1000
        pv_consumed_kwh = site_data['summary']['pv_consumed_mwh'] * 1000
        # La consommation depuis le réseau est la différence
        grid_import_kwh = cons_total_kwh - pv_consumed_kwh

        # Coût de la consommation sans le projet ACC
        cout_sans_acc = cons_total_kwh * prix_achat_reseau

        # Coût de la consommation avec le projet ACC
        cout_avec_acc = (grid_import_kwh * prix_achat_reseau) + (pv_consumed_kwh * prix_vente_interne_acc)

        # Économie réalisée par le consommateur
        economie_consommateur = cout_sans_acc - cout_avec_acc

        # Revenu généré pour le producteur par ce consommateur
        revenu_par_consommateur = pv_consumed_kwh * prix_vente_interne_acc
        total_revenu_producteur += revenu_par_consommateur

        economic_results[site_key] = {
            'cout_sans_acc': cout_sans_acc,
            'cout_avec_acc': cout_avec_acc,
            'economie_annuelle': economie_consommateur,
            'part_facture_reseau': grid_import_kwh * prix_achat_reseau,
            'part_facture_acc': pv_consumed_kwh * prix_vente_interne_acc,
            'economie_totale_horizon': 0.0, # rempli par la PARTIE 2 (boucle sur l'horizon)
        }

        consumer_raw_data.append({
            'site_key': site_key,
            'cons_total_kwh': cons_total_kwh,
            'pv_consumed_kwh': pv_consumed_kwh,
            'prix_achat_reseau': prix_achat_reseau,
            'prix_vente_interne_acc': prix_vente_interne_acc,
            'inflation_grid_rate': inflation_grid_rate,
        })

    # --- PARTIE 2: Analyse financière pluriannuelle pour le producteur ---

    # Paramètres financiers
    horizon = economic_params.get('horizon', 20)
    # NOUVEAU: Calcul du CAPEX et OPEX à partir des valeurs en €/Wc
    total_peak_power_kw = energetic_results['sites']['Global']['summary']['peak_power_kw']
    total_peak_power_wc = total_peak_power_kw * 1000
    capex_wc = economic_params.get('capex_wc', 1.2)
    investment_subsidy = economic_params.get('investment_subsidy', 0)
    opex_projet_wc = economic_params.get('opex_projet_wc', 0.015)
    opex_gestion_acc_wc = economic_params.get('opex_gestion_acc_wc', 0.005)
    loyer_annuel = economic_params.get('loyer', 0)

    capex_brut = capex_wc * total_peak_power_wc
    capex = capex_brut - investment_subsidy # CAPEX net après subvention
    opex_an_1 = (opex_projet_wc + opex_gestion_acc_wc) * total_peak_power_wc + loyer_annuel
    discount_rate = economic_params.get('discount_rate', 4.0) / 100
    tax_rate = economic_params.get('tax_rate', 25.0) / 100
    equity_share = economic_params.get('equity_share', 20.0) / 100
    loan_interest = economic_params.get('loan_interest', 3.5) / 100
    loan_maturity = economic_params.get('loan_maturity', 15)
    depreciation_period = economic_params.get('depreciation_period', 10)
    # NOUVEAU: Paramètres d'amortissement
    depreciation_method = economic_params.get('depreciation_method', 'linear')
    declining_coefficient = economic_params.get('declining_coefficient', 1.75)

    
    # NOUVEAU: Paramètres de remplacement de l'onduleur
    inverter_replacement_enabled = economic_params.get('inverter_replacement_enabled', False)
    inverter_replacement_year = economic_params.get('inverter_replacement_year', 11)
    inverter_replacement_cost_wc = economic_params.get('inverter_replacement_cost_wc', 0.15)
    inverter_replacement_cost = inverter_replacement_cost_wc * total_peak_power_wc if inverter_replacement_enabled else 0

    # Taux d'inflation
    inflation_opex = 1 + (economic_params.get('inflation_opex', 2.0) / 100)
    inflation_surplus = 1 + (economic_params.get('inflation_surplus_price', 1.0) / 100) # prettier-ignore
    pv_degradation_rate = economic_params.get('pv_degradation_rate', 0.5) / 100

    # Calculs initiaux
    equity = capex * equity_share
    debt = capex * (1 - equity_share)

    # Année 1 revenus
    surplus_global_kwh = energetic_results['sites']['Global']['summary']['surplus_mwh'] * 1000
    revenu_vente_interne = total_revenu_producteur
    revenu_vente_surplus = surplus_global_kwh * prix_vente_surplus

    # Construction des flux de trésorerie (cash flows) sur l'horizon
    cash_flows_projet = [-capex]
    cash_flows_equity = [-equity]
    revenus_annuels = []
    # NOUVEAU: Pour le tableau financier détaillé
    # NOUVEAU: Pour le graphique de répartition des revenus
    revenus_internes_annuels = []
    revenus_surplus_annuels = []
    discounted_cash_flows = [-capex]
    # NOUVEAU: Pour le tableau financier détaillé et les totaux
    financial_table_data = []
    # NOUVEAU: Pour le graphique dette/fonds propres
    debt_evolution = [debt] # Start with the initial debt

    # NOUVEAU: Pour le calcul du DSCR et du LCOE
    dscr_values = []
    total_discounted_opex = 0
    total_discounted_production_kwh = 0

    # NOUVEAU: Pour l'amortissement dégressif
    vnc = capex_brut # Valeur Nette Comptable
    taux_lineaire = 1 / depreciation_period if depreciation_period > 0 else 0
    taux_degressif = taux_lineaire * declining_coefficient

    solde_pret = debt
    inflation_acc_price_rate = 1 + economic_params.get('inflation_acc_price', 1.5) / 100
    for n in range(1, horizon + 1):
        # Dégradation de la production PV
        degradation_factor = (1 - pv_degradation_rate) ** (n - 1)

        # CORRECTIF (inflation_grid_price appliquée) : projection de l'économie de chaque participant
        # pour l'année n — même dégradation PV que le producteur, prix d'achat réseau inflaté selon le
        # profil du participant, prix de vente interne ACC inflaté au même taux que côté producteur
        # (un seul taux global, pas de champ dédié par participant). Miroir de main_rentabilite.js.
        for c in consumer_raw_data:
            pv_consumed_n = c['pv_consumed_kwh'] * degradation_factor
            grid_import_n = c['cons_total_kwh'] - pv_consumed_n
            prix_achat_n = c['prix_achat_reseau'] * ((1 + c['inflation_grid_rate'] / 100) ** (n - 1))
            prix_vente_interne_n = c['prix_vente_interne_acc'] * (inflation_acc_price_rate ** (n - 1))
            cout_sans_acc_n = c['cons_total_kwh'] * prix_achat_n
            cout_avec_acc_n = (grid_import_n * prix_achat_n) + (pv_consumed_n * prix_vente_interne_n)
            economic_results[c['site_key']]['economie_totale_horizon'] += cout_sans_acc_n - cout_avec_acc_n

        # Revenus avec inflation et dégradation
        # Note: l'inflation sur le prix de vente interne est déjà gérée dans le calcul consommateur
        # Ici, on l'applique au revenu global pour la projection.
        revenu_interne_n = revenu_vente_interne * (inflation_acc_price_rate ** (n - 1)) * degradation_factor
        revenu_surplus_n = revenu_vente_surplus * (inflation_surplus**(n-1)) * degradation_factor
        revenu_total_n = revenu_interne_n + revenu_surplus_n
        revenus_internes_annuels.append(revenu_interne_n)
        revenus_surplus_annuels.append(revenu_surplus_n)
        revenus_annuels.append(revenu_total_n)

        # Coûts
        opex_n = opex_an_1 * (inflation_opex**(n-1))
        # NOUVEAU: Pour le calcul du LCOE
        total_discounted_opex += opex_n / ((1 + discount_rate)**n)
        production_an_n_kwh = energetic_results['sites']['Global']['summary']['production_mwh'] * 1000 * degradation_factor
        total_discounted_production_kwh += production_an_n_kwh / ((1 + discount_rate)**n)

        # NOUVEAU: Calcul de l'amortissement
        amortissement_n = 0
        if n <= depreciation_period and vnc > 0:
            if depreciation_method == 'linear':
                amortissement_n = capex_brut / depreciation_period
            else: # 'declining'
                amort_degressif = vnc * taux_degressif
                annees_restantes = depreciation_period - (n - 1)
                amort_lineaire_restant = vnc / annees_restantes if annees_restantes > 0 else 0
                # On passe en linéaire quand le taux dégressif devient inférieur au taux linéaire sur la durée restante
                amortissement_n = max(amort_degressif, amort_lineaire_restant)
            
            amortissement_n = min(vnc, amortissement_n) # Ne pas amortir plus que la VNC
            vnc -= amortissement_n

        
        # NOUVEAU: Coût de remplacement de l'onduleur (considéré comme un CAPEX additionnel)
        capex_additionnel_n = 0
        if inverter_replacement_enabled and n == inverter_replacement_year:
            capex_additionnel_n = inverter_replacement_cost

        # Calcul du prêt
        interet_n = 0
        remboursement_principal_n = 0
        if n <= loan_maturity and debt > 0:
            annuite = debt * (loan_interest * (1 + loan_interest)**loan_maturity) / ((1 + loan_interest)**loan_maturity - 1) if loan_interest > 0 else debt / loan_maturity
            interet_n = solde_pret * loan_interest
            remboursement_principal_n = annuite - interet_n
            solde_pret -= remboursement_principal_n
        
        # NOUVEAU: Stocker le solde de la dette à la fin de l'année
        debt_evolution.append(solde_pret)

        # Flux de trésorerie pour le projet (FCFF - Free Cash Flow to Firm)
        ebitda = revenu_total_n - opex_n
        ebit = ebitda - amortissement_n # Résultat d'exploitation
        ebt = ebit - interet_n # Résultat avant impôt
        impot = max(0, ebt * tax_rate)

        # NOUVEAU: Calcul du DSCR pour l'année n (déplacé après le calcul de l'impôt)
        service_dette_n = remboursement_principal_n + interet_n
        if service_dette_n > 0:
            # Le flux de trésorerie disponible pour le service de la dette est l'EBITDA moins les impôts
            cash_flow_for_dscr = ebitda - impot
            dscr_values.append(cash_flow_for_dscr / service_dette_n)
        # Le flux de trésorerie du projet est l'EBITDA moins les impôts et les investissements additionnels
        flux_projet_n = ebitda - impot - capex_additionnel_n
        cash_flows_projet.append(flux_projet_n)
        
        # NOUVEAU: Calcul du flux de trésorerie actualisé
        flux_projet_actualise_n = flux_projet_n / ((1 + discount_rate)**n)
        discounted_cash_flows.append(flux_projet_actualise_n)

        # NOUVEAU: Ajout des données pour le tableau financier
        financial_table_data.append({
            'annee': n,
            'revenu': revenu_total_n,
            'opex': opex_n,
            'capex_additionnel': capex_additionnel_n,
            'ebitda': ebitda,
            'amortissement': amortissement_n,
            'interets': interet_n,
            'impot': impot,
            'flux_projet': flux_projet_n,
            'flux_projet_actualise': flux_projet_actualise_n
        })

        # Flux de trésorerie pour les fonds propres
        flux_equity_n = flux_projet_n - interet_n - remboursement_principal_n
        cash_flows_equity.append(flux_equity_n)

    # Calcul des indicateurs financiers
    van_projet = npf.npv(discount_rate, cash_flows_projet)
    # NOUVEAU: Calcul des flux cumulés
    cumulative_cash_flows = np.cumsum(cash_flows_projet).tolist() # Flux nominaux cumulés
    cumulative_discounted_cash_flows = np.cumsum(discounted_cash_flows).tolist() # Flux actualisés cumulés
    cumulative_equity_flows = np.cumsum(cash_flows_equity).tolist() # NOUVEAU: Flux de fonds propres cumulés
    tri_projet = npf.irr(cash_flows_projet) * 100 if len(cash_flows_projet) > 1 else 0
    tri_equity = npf.irr(cash_flows_equity) * 100 if len(cash_flows_equity) > 1 else 0

    # NOUVEAU: Calcul des nouveaux indicateurs
    dscr_moyen = np.mean(dscr_values) if dscr_values else None
    lcoe_production = (capex + total_discounted_opex) / (total_discounted_production_kwh / 1000) if total_discounted_production_kwh > 0 else None # en €/MWh

    temps_retour_brut = None
    if cumulative_cash_flows[0] < 0:
        positive_flux_indices = np.where(np.array(cumulative_cash_flows) >= 0)[0]
        if len(positive_flux_indices) > 0:
            first_positive_idx = positive_flux_indices[0]
            if first_positive_idx > 0:
                last_neg_flux = cumulative_cash_flows[first_positive_idx - 1]
                temps_retour_brut = (first_positive_idx - 1) - (last_neg_flux / (cumulative_cash_flows[first_positive_idx] - last_neg_flux))

    # Calcul du temps de retour actualisé
    flux_cumules_actualises = 0
    temps_retour = float('inf')
    for i, flux in enumerate(cash_flows_projet):
        if i == 0: continue # Ignorer l'investissement initial
        flux_actualise = flux / ((1 + discount_rate)**i)
        if flux_cumules_actualises < capex:
            flux_cumules_actualises += flux_actualise
            if flux_cumules_actualises >= capex:
                temps_retour = (i - 1) + (capex - (flux_cumules_actualises - flux_actualise)) / flux_actualise

    # CORRECTION: Remplacer 'inf' par None pour une sérialisation JSON valide et gérer les NaN
    if temps_retour == float('inf'):
        temps_retour = None
    if temps_retour is not None and np.isnan(temps_retour):
        temps_retour = None
        
    van_projet = 0.0 if np.isnan(van_projet) else van_projet
    tri_projet = 0.0 if np.isnan(tri_projet) else tri_projet
    tri_equity = 0.0 if np.isnan(tri_equity) else tri_equity
    dscr_moyen = None if dscr_moyen is None or np.isnan(dscr_moyen) else float(dscr_moyen)
    lcoe_production = None if lcoe_production is None or np.isnan(lcoe_production) else float(lcoe_production)
    temps_retour_brut = None if temps_retour_brut is None or np.isnan(temps_retour_brut) else float(temps_retour_brut)




    # --- PARTIE 3: Assemblage des résultats pour le producteur ---
    economic_results['producteur'] = {
        # Année 1
        'revenu_vente_interne': revenu_vente_interne,
        'revenu_vente_surplus': revenu_vente_surplus,
        'revenu_total_annuel': revenu_vente_interne + revenu_vente_surplus,
        'revenu_total_horizon': sum(revenus_annuels),
        # Indicateurs financiers sur l'horizon
        'van_projet': van_projet,
        'tri_projet': tri_projet,
        'tri_equity': tri_equity,
        'temps_retour_actualise': temps_retour,
        'temps_retour_brut': temps_retour_brut,
        'dscr_moyen': dscr_moyen,
        'lcoe_production': lcoe_production,
        # NOUVEAU: Ajout des flux de trésorerie pour le graphique
        'cash_flows_projet': cash_flows_projet,
        'cumulative_cash_flows': cumulative_cash_flows,
        'cumulative_discounted_cash_flows': cumulative_discounted_cash_flows,
        'revenus_internes_annuels': revenus_internes_annuels,
        'revenus_surplus_annuels': revenus_surplus_annuels,
        'debt_evolution': debt_evolution,
        'cumulative_equity_flows': cumulative_equity_flows,
        'financial_table': financial_table_data,
        # NOUVEAU: Ajout des hypothèses pour le récapitulatif
        'assumptions': economic_params
    }

    return economic_results