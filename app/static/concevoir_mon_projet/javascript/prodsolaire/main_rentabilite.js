// Fichier dédié à l'affichage de l'analyse de rentabilité pour l'ACC

let economicCharts = [];

const DASHBOARD_DEFAULTS = {
    'eco-section-assumptions': false,
    'eco-section-bilan': true,
    'eco-section-indicators': true,
    'eco-section-comparison': true,
    'eco-section-producer-doughnut': true,
    'eco-section-financial-table': true,
    'eco-section-cashflows': true,
    'eco-section-debt-equity': false,
    'eco-section-revenue-breakdown': false,
};

export function applyDashboardVisibility() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('dashboardVisibility') || '{}'); } catch (e) {}
    const config = { ...DASHBOARD_DEFAULTS, ...stored };
    Object.entries(config).forEach(([id, visible]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    });
    setTimeout(() => economicCharts.forEach(c => { try { c.resize(); } catch (e) {} }), 50);
}

export function resizeAllEconomicCharts() {
    economicCharts.forEach(c => { try { c.resize(); } catch (e) {} });
}

/**
 * Génère les graphiques pour l'analyse économique de l'ACC.
 * @param {object} ecoData - L'objet contenant les résultats économiques.
 */
function renderEconomicCharts(ecoData) {
    // Nettoyer les anciens graphiques
    economicCharts.forEach(c => c.destroy());
    economicCharts = [];

    const participantLabels = Object.keys(ecoData).filter(k => k !== 'producteur');
    const coutSansAcc = participantLabels.map(k => ecoData[k].cout_sans_acc);
    const coutAvecAcc = participantLabels.map(k => ecoData[k].cout_avec_acc);

    // 1. Graphique de comparaison des factures
    const comparisonCtx = document.getElementById('eco-comparison-chart')?.getContext('2d');
    if (comparisonCtx) {
        const comparisonChart = new Chart(comparisonCtx, {
            type: 'bar',
            data: {
                labels: participantLabels,
                datasets: [
                    {
                        label: 'Facture SANS projet PV',
                        data: coutSansAcc,
                        backgroundColor: 'rgba(239, 68, 68, 0.7)',
                        borderColor: 'rgba(239, 68, 68, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Facture AVEC projet PV',
                        data: coutAvecAcc,
                        backgroundColor: 'rgba(34, 197, 94, 0.7)',
                        borderColor: 'rgba(34, 197, 94, 1)',
                        borderWidth: 1
                    }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: 'Coût Annuel (€)' } } } }
        });
        economicCharts.push(comparisonChart);
    }

    // 2. Graphique des revenus du producteur
    const producerCtx = document.getElementById('eco-producer-chart')?.getContext('2d');
    if (producerCtx && ecoData.producteur) {
        const producerChart = new Chart(producerCtx, {
            type: 'doughnut',
            data: {
                labels: ['Vente interne ACC', 'Vente surplus réseau'],
                datasets: [{
                    data: [ecoData.producteur.revenu_vente_interne, ecoData.producteur.revenu_vente_surplus],
                    backgroundColor: ['#3b82f6', '#f97316'],
                    borderWidth: 2
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });
        economicCharts.push(producerChart);
    }

    // 3. NOUVEAU: Graphique des flux de trésorerie du projet
    const cashflowCtx = document.getElementById('cashflow-chart')?.getContext('2d');
    if (cashflowCtx && ecoData.producteur && ecoData.producteur.cash_flows_projet) {
        const cashFlows = ecoData.producteur.cash_flows_projet;
        const cashflowChart = new Chart(cashflowCtx, {
            type: 'bar',
            data: {
                labels: cashFlows.map((_, i) => `An ${i}`),
                datasets: [{
                    label: 'Flux de trésorerie',
                    data: cashFlows,
                    backgroundColor: cashFlows.map(v => v < 0 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(34, 197, 94, 0.7)'),
                    borderColor: cashFlows.map(v => v < 0 ? 'rgba(239, 68, 68, 1)' : 'rgba(34, 197, 94, 1)'),
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false } // La couleur est suffisante
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Flux de trésorerie (€)' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
        economicCharts.push(cashflowChart);
    }

    // 4. NOUVEAU: Graphique des flux de trésorerie CUMULÉS
    const cumulativeCashflowCtx = document.getElementById('cumulative-cashflow-chart')?.getContext('2d');
    if (cumulativeCashflowCtx && ecoData.producteur && ecoData.producteur.cumulative_cash_flows) {
        const cumulativeFlows = ecoData.producteur.cumulative_cash_flows; // Flux nominaux
        const cumulativeDiscountedFlows = ecoData.producteur.cumulative_discounted_cash_flows; // Flux actualisés

        const cumulativeCashflowChart = new Chart(cumulativeCashflowCtx, {
            type: 'line',
            data: {
                labels: cumulativeFlows.map((_, i) => `An ${i}`),
                datasets: [
                    {
                        label: 'Flux de trésorerie cumulés (nominaux)',
                        data: cumulativeFlows,
                        fill: false,
                        borderColor: 'rgba(107, 114, 128, 1)', // Gris
                        pointBackgroundColor: 'rgba(107, 114, 128, 1)',
                        tension: 0.1
                    },
                    {
                        label: 'Flux de trésorerie cumulés (actualisés)',
                        data: cumulativeDiscountedFlows,
                        fill: true,
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        borderColor: 'rgba(59, 130, 246, 1)', // Bleu
                        pointBackgroundColor: 'rgba(59, 130, 246, 1)',
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top' }
                },
                scales: {
                    y: {
                        title: { display: true, text: 'Flux cumulés (€)' },
                        grid: {
                            color: (context) => context.tick.value === 0 ? 'rgba(239, 68, 68, 0.7)' : 'rgba(0, 0, 0, 0.1)',
                            lineWidth: (context) => context.tick.value === 0 ? 2 : 1,
                        }
                    }
                }
            }
        });
        economicCharts.push(cumulativeCashflowChart);
    }

    // 5. NOUVEAU: Graphique de l'évolution de la dette et des fonds propres
    const debtEquityCtx = document.getElementById('debt-equity-chart')?.getContext('2d');
    if (debtEquityCtx && ecoData.producteur && ecoData.producteur.debt_evolution) {
        const debtData = ecoData.producteur.debt_evolution;
        const equityData = ecoData.producteur.cumulative_equity_flows;

        const debtEquityChart = new Chart(debtEquityCtx, {
            type: 'line',
            data: {
                labels: debtData.map((_, i) => `An ${i}`),
                datasets: [
                    {
                        label: 'Solde de la dette',
                        data: debtData,
                        borderColor: 'rgba(239, 68, 68, 1)',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        fill: true,
                        tension: 0.1
                    },
                    {
                        label: 'Flux de trésorerie cumulés (Fonds Propres)',
                        data: equityData,
                        borderColor: 'rgba(34, 197, 94, 1)',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        fill: true,
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top' }
                },
                scales: { y: { title: { display: true, text: 'Montant (€)' } } }
            }
        });
        economicCharts.push(debtEquityChart);
    }

    // 6. NOUVEAU: Graphique de la répartition des revenus annuels
    const revenueBreakdownCtx = document.getElementById('revenue-breakdown-chart')?.getContext('2d');
    if (revenueBreakdownCtx && ecoData.producteur && ecoData.producteur.revenus_internes_annuels) {
        const internalRevenue = ecoData.producteur.revenus_internes_annuels;
        const surplusRevenue = ecoData.producteur.revenus_surplus_annuels;

        const revenueBreakdownChart = new Chart(revenueBreakdownCtx, {
            type: 'bar',
            data: {
                labels: internalRevenue.map((_, i) => `An ${i + 1}`),
                datasets: [
                    {
                        label: 'Vente interne ACC',
                        data: internalRevenue,
                        backgroundColor: 'rgba(59, 130, 246, 0.8)', // Bleu
                    },
                    {
                        label: 'Vente surplus réseau',
                        data: surplusRevenue,
                        backgroundColor: 'rgba(249, 115, 22, 0.8)', // Orange
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top' }
                },
                scales: {
                    x: { stacked: true },
                    y: { stacked: true, title: { display: true, text: 'Revenu Annuel (€)' } }
                }
            }
        });
        economicCharts.push(revenueBreakdownChart);
    }
}


/**
 * Calcule la rentabilité d'un projet d'ACC pour chaque participant (Année 1)
 * et réalise une analyse financière complète pour le producteur sur l'horizon du projet.
 * C'est la transposition de la logique Python en JavaScript.
 * @param {object} energeticResults - Les résultats de l'analyse énergétique.
 * @param {object} economicParams - Les paramètres économiques saisis par l'utilisateur.
 * @returns {object} Les résultats économiques calculés.
 */
function calculateEconomicAnalysisJS(energeticResults, economicParams) {
    const prix_vente_surplus = economicParams.prix_vente_surplus || 0.10;
    const participant_prices = economicParams.participants || {};
    const inflation_grid_prices_by_profile = economicParams.inflation_grid_price || {};

    const economic_results = {};
    let total_revenu_producteur = 0;
    // CORRECTIF (inflation_grid_price collectée dans l'UI mais jamais appliquée) : les données brutes
    // de chaque consommateur sont conservées ici pour la projection pluriannuelle de la PARTIE 2
    // (économie Année 1 → économie sur tout l'horizon, avec inflation du prix réseau par profil).
    const consumerRawData = [];

    // --- PARTIE 1: Calcul des économies pour les consommateurs (Année 1) ---
    for (const [site_key, site_data] of Object.entries(energeticResults.sites)) {
        if (site_key === 'Global') continue;

        const prices = participant_prices[site_key] || {};
        const prix_achat_reseau = prices.prix_achat || 0.25;
        const profil = prices.profil || 'Résidentiel';
        const prix_vente_interne_acc = prices.prix_vente_interne || 0.18;

        const cons_total_kwh = site_data.summary.consumption_mwh * 1000;
        const pv_consumed_kwh = site_data.summary.pv_consumed_mwh * 1000;
        const grid_import_kwh = cons_total_kwh - pv_consumed_kwh;

        const cout_sans_acc = cons_total_kwh * prix_achat_reseau;
        const cout_avec_acc = (grid_import_kwh * prix_achat_reseau) + (pv_consumed_kwh * prix_vente_interne_acc);
        const economie_consommateur = cout_sans_acc - cout_avec_acc;

        const revenu_par_consommateur = pv_consumed_kwh * prix_vente_interne_acc;
        total_revenu_producteur += revenu_par_consommateur;

        economic_results[site_key] = {
            cout_sans_acc,
            cout_avec_acc,
            economie_annuelle: economie_consommateur,
            part_facture_reseau: grid_import_kwh * prix_achat_reseau,
            part_facture_acc: pv_consumed_kwh * prix_vente_interne_acc,
            economie_totale_horizon: 0, // rempli par la PARTIE 2 (boucle sur l'horizon)
        };

        consumerRawData.push({
            site_key, cons_total_kwh, pv_consumed_kwh,
            prix_achat_reseau, prix_vente_interne_acc,
            inflation_grid_rate: inflation_grid_prices_by_profile[profil] ?? 2.5,
        });
    }

    // --- PARTIE 2: Analyse financière pluriannuelle pour le producteur ---
    const horizon = parseInt(economicParams.horizon, 10) || 20;
    const total_peak_power_kw = energeticResults.sites['Global'].summary.peak_power_kw;
    const total_peak_power_wc = total_peak_power_kw * 1000;
    const capex_wc = parseFloat(economicParams.capex_wc) || 1.2;
    const investment_subsidy = parseFloat(economicParams.investment_subsidy) || 0;
    const opex_projet_wc = parseFloat(economicParams.opex_projet_wc) || 0.015;
    const opex_gestion_acc_wc = parseFloat(economicParams.opex_gestion_acc_wc) || 0.005;
    const loyer_annuel = parseFloat(economicParams.loyer) || 0;

    const capex_brut = capex_wc * total_peak_power_wc;
    const capex = capex_brut - investment_subsidy;
    const opex_an_1 = (opex_projet_wc + opex_gestion_acc_wc) * total_peak_power_wc + loyer_annuel;
    const discount_rate = (parseFloat(economicParams.discount_rate) || 4.0) / 100;
    const tax_rate = (parseFloat(economicParams.tax_rate) || 25.0) / 100;
    const equity_share = (parseFloat(economicParams.equity_share) || 20.0) / 100;
    const loan_interest = (parseFloat(economicParams.loan_interest) || 3.5) / 100;
    const loan_maturity = parseInt(economicParams.loan_maturity, 10) || 15;
    const depreciation_period = parseInt(economicParams.depreciation_period, 10) || 10;
    // NOUVEAU: Paramètres d'amortissement
    const depreciation_method = economicParams.depreciation_method || 'linear';
    const declining_coefficient = parseFloat(economicParams.declining_coefficient) || 1.75;

    const inverter_replacement_enabled = economicParams.inverter_replacement_enabled || false;
    const inverter_replacement_year = parseInt(economicParams.inverter_replacement_year, 10) || 11;
    const inverter_replacement_cost_wc = parseFloat(economicParams.inverter_replacement_cost_wc) || 0.15;
    const inverter_replacement_cost = inverter_replacement_enabled ? inverter_replacement_cost_wc * total_peak_power_wc : 0;

    const inflation_opex = 1 + (parseFloat(economicParams.inflation_opex) || 2.0) / 100; // prettier-ignore
    const inflation_surplus = 1 + (parseFloat(economicParams.inflation_surplus_price) || 1.0) / 100;
    const pv_degradation_rate = (parseFloat(economicParams.pv_degradation_rate) || 0.5) / 100;

    const equity = capex * equity_share;
    const debt = capex * (1 - equity_share);

    const surplus_global_kwh = energeticResults.sites['Global'].summary.surplus_mwh * 1000;
    const revenu_vente_interne = total_revenu_producteur;
    const revenu_vente_surplus = surplus_global_kwh * prix_vente_surplus;

    const cash_flows_projet = [-capex];
    const cash_flows_equity = [-equity];
    const revenus_annuels = [];
    const revenus_internes_annuels = [];
    const revenus_surplus_annuels = [];
    const discounted_cash_flows = [-capex];
    const financial_table_data = [];
    const debt_evolution = [debt];
    
    // NOUVEAU: Pour le calcul du DSCR
    const dscr_values = [];
    let total_discounted_opex = 0;
    let total_discounted_production_kwh = 0;

    // NOUVEAU: Pour l'amortissement dégressif
    let vnc = capex_brut; // Valeur Nette Comptable
    const taux_lineaire = depreciation_period > 0 ? 1 / depreciation_period : 0;
    const taux_degressif = taux_lineaire * declining_coefficient;

    let solde_pret = debt;
    for (let n = 1; n <= horizon; n++) {
        const degradation_factor = Math.pow(1 - pv_degradation_rate, n - 1);
        const inflation_acc_price_rate = 1 + (parseFloat(economicParams.inflation_acc_price) || 1.5) / 100;

        // CORRECTIF (inflation_grid_price appliquée) : projection de l'économie de chaque
        // participant pour l'année n — même dégradation PV que le producteur (la part de PV
        // autoconsommée par ce participant décroît avec la production), prix d'achat réseau
        // inflaté selon le profil du participant, prix de vente interne ACC inflaté au même taux
        // que côté producteur (un seul taux global, pas de champ dédié par participant).
        consumerRawData.forEach((c) => {
            const pv_consumed_n = c.pv_consumed_kwh * degradation_factor;
            const grid_import_n = c.cons_total_kwh - pv_consumed_n;
            const prix_achat_n = c.prix_achat_reseau * Math.pow(1 + c.inflation_grid_rate / 100, n - 1);
            const prix_vente_interne_n = c.prix_vente_interne_acc * Math.pow(inflation_acc_price_rate, n - 1);
            const cout_sans_acc_n = c.cons_total_kwh * prix_achat_n;
            const cout_avec_acc_n = (grid_import_n * prix_achat_n) + (pv_consumed_n * prix_vente_interne_n);
            economic_results[c.site_key].economie_totale_horizon += cout_sans_acc_n - cout_avec_acc_n;
        });

        const revenu_interne_n = revenu_vente_interne * Math.pow(inflation_acc_price_rate, n - 1) * degradation_factor;
        const revenu_surplus_n = revenu_vente_surplus * Math.pow(inflation_surplus, n - 1) * degradation_factor;
        const revenu_total_n = revenu_interne_n + revenu_surplus_n;
        revenus_internes_annuels.push(revenu_interne_n);
        revenus_surplus_annuels.push(revenu_surplus_n);
        revenus_annuels.push(revenu_total_n);

        const opex_n = opex_an_1 * Math.pow(inflation_opex, n - 1);
        // NOUVEAU: Pour le calcul du LCOE
        total_discounted_opex += opex_n / Math.pow(1 + discount_rate, n);
        total_discounted_production_kwh += (energeticResults.sites['Global'].summary.production_mwh * 1000 * degradation_factor) / Math.pow(1 + discount_rate, n);

        // NOUVEAU: Calcul de l'amortissement
        let amortissement_n = 0;
        if (n <= depreciation_period && vnc > 0) {
            if (depreciation_method === 'linear') {
                amortissement_n = capex_brut / depreciation_period;
            } else { // 'declining'
                const amort_degressif = vnc * taux_degressif;
                const annees_restantes = depreciation_period - (n - 1);
                const amort_lineaire_restant = annees_restantes > 0 ? vnc / annees_restantes : 0;
                // On passe en linéaire quand le taux dégressif devient inférieur au taux linéaire sur la durée restante
                amortissement_n = Math.max(amort_degressif, amort_lineaire_restant);
            }
            amortissement_n = Math.min(vnc, amortissement_n); // Ne pas amortir plus que la VNC
            vnc -= amortissement_n;
        }
        const capex_additionnel_n = (inverter_replacement_enabled && n === inverter_replacement_year) ? inverter_replacement_cost : 0;

        let interet_n = 0;
        let remboursement_principal_n = 0;
        if (n <= loan_maturity && debt > 0) {
            const annuite = loan_interest > 0 ? debt * (loan_interest * Math.pow(1 + loan_interest, loan_maturity)) / (Math.pow(1 + loan_interest, loan_maturity) - 1) : debt / loan_maturity;
            interet_n = solde_pret * loan_interest;
            remboursement_principal_n = annuite - interet_n;
            solde_pret -= remboursement_principal_n;
        }
        debt_evolution.push(solde_pret);

        const ebitda = revenu_total_n - opex_n;
        const ebit = ebitda - amortissement_n;
        const ebt = ebit - interet_n;
        const impot = Math.max(0, ebt * tax_rate);

        // NOUVEAU: Calcul du DSCR pour l'année n (déplacé après le calcul de l'impôt)
        const service_dette_n = remboursement_principal_n + interet_n;
        if (service_dette_n > 0) {
            const cash_flow_for_dscr = ebitda - impot; // EBITDA - Impôts
            dscr_values.push(cash_flow_for_dscr / service_dette_n);
        }
        const flux_projet_n = ebitda - impot - capex_additionnel_n;
        cash_flows_projet.push(flux_projet_n);

        const flux_projet_actualise_n = flux_projet_n / Math.pow(1 + discount_rate, n);
        discounted_cash_flows.push(flux_projet_actualise_n);

        financial_table_data.push({
            annee: n, revenu: revenu_total_n, opex: opex_n, capex_additionnel: capex_additionnel_n,
            ebitda, amortissement: amortissement_n, interets: interet_n, impot,
            flux_projet: flux_projet_n, flux_projet_actualise: flux_projet_actualise_n
        });

        const flux_equity_n = flux_projet_n - interet_n - remboursement_principal_n;
        cash_flows_equity.push(flux_equity_n);
    }

    const npv = (rate, values) => values.reduce((acc, val, i) => acc + val / Math.pow(1 + rate, i), 0);
    
    /**
     * CORRECTIF (TRI parfois faux/à 0%) : l'ancienne implémentation (Newton-Raphson, un seul essai
     * initial à 10%) pouvait ne pas converger — notamment avec le remplacement d'onduleur activé, qui
     * introduit un 2e flux négatif en cours d'horizon (problème classique des TRI multiples/non-
     * conventionnels) — et retournait alors silencieusement 0%, indiscernable d'un vrai TRI nul.
     * Remplacé par une bissection sur le NPV(taux) : robuste tant qu'il existe un changement de signe
     * dans la plage testée (-99% à +1000%, largement suffisant pour un projet ACC réel) ; retourne
     * `null` (affiché "N/A" par formatPercent) plutôt qu'un chiffre fabriqué si aucune racine n'est
     * trouvée dans cette plage.
     * @param {number[]} values - Un tableau de flux de trésorerie (l'investissement est négatif).
     * @returns {number|null} Le TRI en pourcentage, ou null si non déterminable.
     */
    const calculateIRR = (values) => {
        const npvAt = (rate) => values.reduce((acc, val, i) => acc + val / Math.pow(1 + rate, i), 0);
        let low = -0.99, high = 10;
        let npvLow = npvAt(low), npvHigh = npvAt(high);
        if (!isFinite(npvLow) || !isFinite(npvHigh) || npvLow * npvHigh > 0) {
            return null; // pas de changement de signe détecté : aucune racine trouvable dans la plage
        }
        for (let i = 0; i < 100; i++) {
            const mid = (low + high) / 2;
            const npvMid = npvAt(mid);
            if (Math.abs(npvMid) < 1e-6 || (high - low) < 1e-9) return mid * 100;
            if ((npvLow < 0) === (npvMid < 0)) { low = mid; npvLow = npvMid; }
            else { high = mid; npvHigh = npvMid; }
        }
        return ((low + high) / 2) * 100;
    };

    const van_projet = npv(discount_rate, cash_flows_projet);
    const tri_projet = calculateIRR(cash_flows_projet);
    const tri_equity = calculateIRR(cash_flows_equity);
    const cumulative_cash_flows = cash_flows_projet.map((sum => value => sum += value)(0));
    const cumulative_discounted_cash_flows = discounted_cash_flows.map((sum => value => sum += value)(0));
    const cumulative_equity_flows = cash_flows_equity.map((sum => value => sum += value)(0));

    // NOUVEAU: Calcul des nouveaux indicateurs
    const dscr_moyen = dscr_values.length > 0 ? dscr_values.reduce((a, b) => a + b, 0) / dscr_values.length : null;
    const lcoe_production = total_discounted_production_kwh > 0 ? ((capex + total_discounted_opex) / (total_discounted_production_kwh / 1000)) : null; // en €/MWh

    let temps_retour_brut = null;
    for (let i = 1; i < cumulative_cash_flows.length; i++) {
        if (cumulative_cash_flows[i] >= 0) {
            temps_retour_brut = (i - 1) + (-cumulative_cash_flows[i-1] / (cumulative_cash_flows[i] - cumulative_cash_flows[i-1]));
            break;
        }
    }

    let temps_retour = null;
    for (let i = 1; i < cumulative_discounted_cash_flows.length; i++) {
        if (cumulative_discounted_cash_flows[i] >= 0) {
            const last_neg = cumulative_discounted_cash_flows[i - 1];
            const first_pos = cumulative_discounted_cash_flows[i];
            temps_retour = (i - 1) + (-last_neg / (first_pos - last_neg));
            break;
        }
    }

    economic_results['producteur'] = {
        revenu_vente_interne,
        revenu_vente_surplus,
        revenu_total_annuel: revenu_vente_interne + revenu_vente_surplus,
        revenu_total_horizon: revenus_annuels.reduce((a, b) => a + b, 0),
        van_projet,
        tri_projet: tri_projet,
        tri_equity: tri_equity,
        temps_retour_actualise: temps_retour,
        temps_retour_brut: temps_retour_brut,
        dscr_moyen: dscr_moyen,
        lcoe_production: lcoe_production,
        cash_flows_projet,
        cumulative_cash_flows,
        cumulative_discounted_cash_flows,
        revenus_internes_annuels,
        revenus_surplus_annuels,
        debt_evolution,
        cumulative_equity_flows,
        financial_table: financial_table_data,
        assumptions: economicParams
    };

    return economic_results;
}

/**
 * Affiche les résultats de l'analyse de rentabilité pour l'ACC.
 * @param {object} results - Les résultats complets de la simulation.
 */

export function renderEconomicAnalysis(energeticResults, economicParams) {
    const container = document.getElementById('economic-results-container');
    if (!container) return;

    // NOUVEAU: Lancer le calcul économique en JavaScript
    const ecoResults = calculateEconomicAnalysisJS(energeticResults, economicParams);
    // Stocker les résultats calculés pour l'export PDF
    energeticResults.economic_results = ecoResults;


    const producerData = ecoResults.producteur; // Pour un accès plus facile
    const formatCurrency = (val) => (val !== null && val !== undefined) ? val.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : 'N/A';
    // NOUVEAU: Formateurs pour les pourcentages et les années
    const formatPercent = (val) => (val !== null && val !== undefined) ? `${val.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %` : 'N/A';
    const formatRatio = (val) => (val !== null && val !== undefined) ? val.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A';
    const formatYears = (val) => (val !== null && val !== undefined) ? `${val.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ans` : 'N/A';

    let economicResultsHtml = `
        <div class="seasonal-analysis-container" style="margin-top: 0;">
     <h3>Analyse de Rentabilité (ACC)</h3>
    `;

    // NOUVEAU: Tableau récapitulatif des hypothèses financières
    if (producerData.assumptions) {
        const assumptions = producerData.assumptions;
        const inflationGrid = assumptions.inflation_grid_price || {};

        economicResultsHtml += `
            <div id="eco-section-assumptions">
            <h4 class="modal-category-title" style="margin-top: 2rem; margin-bottom: 1rem;">Hypothèses Financières Utilisées</h4>
            <div class="table-responsive">
                <table class="seasonal-table assumptions-table">
                    <tbody>
                        <tr><th>Horizon d'étude</th><td>${assumptions.horizon} ans</td><th>Taux d'actualisation</th><td>${formatPercent(assumptions.discount_rate)}</td></tr>
                        <tr><th>Taux d'imposition</th><td>${formatPercent(assumptions.tax_rate)}</td><th>Dégradation PV annuelle</th><td>${formatPercent(assumptions.pv_degradation_rate)}</td></tr>
                        
                        <tr><th colspan="4" class="table-subheader">Investissement & Coûts</th></tr>
                        <tr><th>CAPEX</th><td>${assumptions.capex_wc} €/Wc</td><th>OPEX Projet</th><td>${assumptions.opex_projet_wc} €/Wc/an</td></tr>
                        <tr><th>OPEX Gestion ACC</th><td>${assumptions.opex_gestion_acc_wc} €/Wc/an</td><th>Loyer Annuel</th><td>${formatCurrency(assumptions.loyer)}</td></tr>
                        <tr>
                            <th>Amortissement</th><td colspan="3">${assumptions.depreciation_method === 'linear' ? 'Linéaire' : 'Dégressif'} sur ${assumptions.depreciation_period} ans 
                            ${assumptions.depreciation_method === 'declining' ? `(coeff. ${assumptions.declining_coefficient})` : ''}
                            </td>
                        </tr>
                        
                        <tr><th colspan="4" class="table-subheader">Remplacement Onduleur</th></tr>
                        <tr><th>Remplacement activé</th><td>${assumptions.inverter_replacement_enabled ? 'Oui' : 'Non'}</td>
                            ${assumptions.inverter_replacement_enabled ? `<th>Année de remplacement</th><td>${assumptions.inverter_replacement_year}</td>` : '<td colspan="2"></td>'}
                        </tr>
                        ${assumptions.inverter_replacement_enabled ? `<tr><th>Coût de remplacement</th><td colspan="3">${assumptions.inverter_replacement_cost_wc} €/Wc</td></tr>` : ''}

                        <tr><th colspan="4" class="table-subheader">Financement</th></tr>
                        <tr><th>Part de fonds propres</th><td>${formatPercent(assumptions.equity_share)}</td><th>Taux d'intérêt du prêt</th><td>${formatPercent(assumptions.loan_interest)}</td></tr>
                        <tr><th>Maturité du prêt</th><td colspan="3">${assumptions.loan_maturity} ans</td></tr>

                        <tr><th colspan="4" class="table-subheader">Hypothèses d'Inflation Annuelle</th></tr>
                        <tr><th>Inflation OPEX</th><td>${formatPercent(assumptions.inflation_opex)}</td><th>Inflation prix vente interne</th><td>${formatPercent(assumptions.inflation_acc_price)}</td></tr>
                        <tr><th>Inflation prix vente surplus</th><td>${formatPercent(assumptions.inflation_surplus_price)}</td><th>Inflation réseau (Résidentiel)</th><td>${formatPercent(inflationGrid['Résidentiel'])}</td></tr>
                        <tr><th>Inflation réseau (Tertiaire)</th><td>${formatPercent(inflationGrid['Tertiaire'])}</td><th>Inflation réseau (Industriel)</th><td>${formatPercent(inflationGrid['Industriel'])}</td></tr>
                    </tbody>
                </table>
            </div>
            </div>
        `;
    }

    economicResultsHtml += `
            <div id="eco-section-bilan">
            <h4 class="modal-category-title" style="margin-top: 2rem; margin-bottom: 1rem;">Bilan Économique des Consommateurs</h4>
            <div class="table-responsive">
                <table class="seasonal-table">
                    <thead>
                        <tr>
                            <th>Participant</th>
                            <th>Facture SANS projet PV (An 1)</th>
                            <th>Facture AVEC projet PV (An 1)</th>
                            <th>Économie annuelle (An 1)</th>
                            <th>Économie totale sur l'horizon</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    Object.keys(ecoResults).forEach(key => {
        if (key !== 'producteur') {
            const data = ecoResults[key];
            economicResultsHtml += `
                <tr>
                    <td>${key}</td>
                    <td>${formatCurrency(data.cout_sans_acc)}</td>
                    <td>${formatCurrency(data.cout_avec_acc)}</td>
                    <td style="font-weight: bold; color: var(--success-color);">${formatCurrency(data.economie_annuelle)}</td>
                    <td style="font-weight: bold; color: var(--success-color);">${formatCurrency(data.economie_totale_horizon)}</td>
                </tr>
            `;
        }
    });

    economicResultsHtml += `</tbody></table></div></div>`;

    // NOUVEAU: Remplacement de l'ancien bloc par la nouvelle grille de statistiques
    economicResultsHtml += `
        <div id="eco-section-indicators">
        <h4 class="modal-category-title" style="margin-top: 2rem; margin-bottom: 1rem;">Indicateurs Financiers</h4>
        <div class="financial-stats-grid">
            <div class="stat-card"><div class="label">VAN Projet</div><div class="value">${formatCurrency(producerData.van_projet)}</div></div>
            <div class="stat-card"><div class="label">TRI Projet</div><div class="value">${formatPercent(producerData.tri_projet)}</div></div>
            <div class="stat-card"><div class="label">TRI Fonds Propres</div><div class="value">${formatPercent(producerData.tri_equity)}</div></div>
            <div class="stat-card"><div class="label">Temps de Retour Brut</div><div class="value">${formatYears(producerData.temps_retour_brut)}</div></div>
            <div class="stat-card"><div class="label">Temps de Retour Actualisé</div><div class="value">${formatYears(producerData.temps_retour_actualise)}</div></div>
            <div class="stat-card"><div class="label">DSCR moyen</div><div class="value">${formatRatio(producerData.dscr_moyen)}</div></div>
            <div class="stat-card"><div class="label">LCOE Production</div><div class="value">${formatCurrency(producerData.lcoe_production)} / MWh</div></div>
            <div class="stat-card"><div class="label">Revenu Annuel (An 1)</div><div class="value">${formatCurrency(producerData.revenu_total_annuel)}</div></div>
            <div class="stat-card"><div class="label">Revenu Total sur l'Horizon</div><div class="value">${formatCurrency(producerData.revenu_total_horizon)}</div></div>
        </div>
        </div>
    `;

    // NOUVEAU: Tableau détaillé des flux financiers
    if (producerData.financial_table) {
        const totals = { revenu: 0, opex: 0, ebitda: 0, amortissement: 0, interets: 0, impot: 0, flux_projet: 0, flux_projet_actualise: 0 };
        let tableRows = '';
        producerData.financial_table.forEach(row => {
            // Mise à jour des totaux
            Object.keys(totals).forEach(key => totals[key] += row[key] || 0);

            tableRows += `
                <tr>
                    <td>${row.annee}</td>
                    <td>${formatCurrency(row.revenu)}</td>
                    <td>${formatCurrency(row.opex)}</td>
                    <td>${formatCurrency(row.ebitda)}</td>
                    <td>${formatCurrency(row.amortissement)}</td>
                    <td>${formatCurrency(row.interets)}</td>
                    <td>${formatCurrency(row.impot)}</td>
                    <td style="font-weight: bold;">${formatCurrency(row.flux_projet)}</td>
                    <td style="font-weight: bold; color: var(--accent-primary);">${formatCurrency(row.flux_projet_actualise)}</td>
                </tr>
            `;
        });

        // NOUVEAU: Ajout de la ligne de total
        const totalRow = `
            <tr class="total-row">
                <td>Total</td>
                <td>${formatCurrency(totals.revenu)}</td><td>${formatCurrency(totals.opex)}</td><td>${formatCurrency(totals.ebitda)}</td>
                <td>${formatCurrency(totals.amortissement)}</td><td>${formatCurrency(totals.interets)}</td><td>${formatCurrency(totals.impot)}</td>
                <td>${formatCurrency(totals.flux_projet)}</td><td>${formatCurrency(totals.flux_projet_actualise)}</td>
            </tr>
        `;

        economicResultsHtml += `
            <div id="eco-section-financial-table">
            <h4 class="modal-category-title" style="margin-top: 2rem; margin-bottom: 1rem;">Tableau des Flux Financiers Annuels</h4>
            <div class="table-responsive">
                <table class="seasonal-table">
                    <thead>
                        <tr>
                            <th>Année</th><th>Revenus</th><th>OPEX</th><th>EBITDA</th><th>Amort.</th><th>Intérêts</th><th>Impôts</th><th>Flux Projet</th><th>Flux Projet Actualisé</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                    <tfoot>${totalRow}</tfoot>
                </table>
            </div>
            </div>
        `;
    }

    economicResultsHtml += `
        <div style="display: flex; flex-wrap: wrap; gap: 2rem; margin-top: 2rem; padding-top: 2rem; border-top: 1px solid var(--border-color);">
            <div id="eco-section-comparison" style="flex: 2; min-width: 300px;">
                <h4>Comparaison des factures annuelles (€)</h4>
                <div class="main-chart-container" style="height: 300px;">
                    <canvas id="eco-comparison-chart"></canvas>
                </div>
            </div>
            <div id="eco-section-producer-doughnut" style="flex: 1; min-width: 220px;">
                <h4>Répartition des revenus du producteur</h4>
                <div class="chart-item" style="max-width: 280px; margin: auto;">
                    <canvas id="eco-producer-chart"></canvas>
                </div>
            </div>
        </div>

        <div id="eco-section-cashflows" class="charts-container" style="margin-top: 2rem;">
            <h4>Évolution des Flux de Trésorerie Cumulés du Projet (€)</h4>
            <div class="main-chart-container" style="height: 300px;">
                <canvas id="cumulative-cashflow-chart"></canvas>
            </div>
            <h4 style="margin-top: 1.5rem;">Évolution des Flux de Trésorerie du Projet (€)</h4>
            <div class="main-chart-container" style="height: 300px; margin-top: 0.5rem;">
                <canvas id="cashflow-chart"></canvas>
            </div>
        </div>

        <div id="eco-section-debt-equity" class="charts-container" style="margin-top: 2rem;">
            <h4>Évolution de la Dette et des Fonds Propres (€)</h4>
            <div class="main-chart-container" style="height: 300px;">
                <canvas id="debt-equity-chart"></canvas>
            </div>
        </div>

        <div id="eco-section-revenue-breakdown" class="charts-container" style="margin-top: 2rem;">
            <h4>Répartition des Revenus Annuels du Producteur (€)</h4>
            <div class="main-chart-container" style="height: 300px;">
                <canvas id="revenue-breakdown-chart"></canvas>
            </div>
        </div>
    </div>`;

    container.innerHTML = economicResultsHtml;
    renderEconomicCharts(ecoResults);
    applyDashboardVisibility();
}