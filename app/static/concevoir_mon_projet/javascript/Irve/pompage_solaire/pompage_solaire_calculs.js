/**
 * Pompage solaire — dimensionnement. FONCTIONS PURES, aucun accès au DOM, aucun appel réseau.
 * ======================================================================================
 * MIROIR EXACT de `process_simulation` (app/models/calcul_pompage_solaire.py), moins la
 * récupération de l'irradiation : celle-ci reste au serveur (PVGIS via le modèle Python, mémoïsé),
 * et lui est passée ici en entrée. C'est le seul aller-retour réseau de la fonctionnalité — tout le
 * dimensionnement se fait dans le navigateur (demande explicite : « on fait au maximum des calculs
 * côté front pour optimiser le serveur »).
 *
 * Le Python reste l'IMPLÉMENTATION DE RÉFÉRENCE et la parité des deux est vérifiée par
 * tests/pompage_solaire/test_parite_pompage.py sur un jeu de cas. Toute évolution d'une formule
 * doit être faite des DEUX côtés : sans cela le test échoue, ce qui est exactement son rôle — deux
 * implémentations d'un même calcul divergent silencieusement sinon.
 *
 * Point d'entrée : window.PompageSolaireCalculs.dimensionner(entrees, irradiationJournaliere)
 */
(function () {
    'use strict';

    const JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    /** Miroir de safe_float() : une saisie vide ou illisible retombe sur la valeur par défaut. */
    function nombreSur(valeur, defaut) {
        if (valeur === null || valeur === undefined || String(valeur).trim() === '') return defaut;
        const n = parseFloat(String(valeur).replace(',', '.'));
        return Number.isFinite(n) ? n : defaut;
    }

    /** Miroir de generate_recommendations(). Mêmes seuils, même ordre, mêmes libellés. */
    function recommandations(hmt, reqPv, debitM3h, radMin, radMoy) {
        const recs = [];
        if (hmt > 100) recs.push('HMT élevée : privilégier une pompe immergée haute pression');
        if (reqPv > 5000) recs.push('Puissance élevée : envisager un système triphasé avec onduleur adapté');
        if (debitM3h > 10) recs.push('Débit important : vérifier le diamètre des conduites (min. 50mm recommandé)');
        if (radMin < 4.5) recs.push('Faible irradiation en saison basse : prévoir un stockage tampon ou réduire les besoins');
        if ((radMoy - radMin) > 1.5) recs.push('Forte variation saisonnière : dimensionner sur le pire mois');
        recs.push('Installer un contrôleur MPPT pour optimiser la production');
        recs.push('Prévoir une protection contre la marche à sec');
        return recs;
    }

    // Type de système de pompage solaire — MIROIR de SYSTEMES_POMPAGE (calcul_pompage_solaire.py),
    // qui documente le modèle : fil du soleil (déficit non pompé), groupe d'appoint (pompe le déficit),
    // batteries de secours (toute l'énergie PV transite par la batterie, rendement aller-retour à la
    // place du coefficient de réduction ; capacité = énergie journalière x autonomie / (DoD x √rendement)).
    const SYSTEMES_POMPAGE = ['fil_soleil', 'groupe', 'batteries'];
    const JOURS_RESERVOIR = { fil_soleil: 3, groupe: 1, batteries: 1 };
    const MARGE_DEMARRAGE_GE = 1.5;
    const COS_PHI_GE = 0.8;
    const AUTONOMIE_BATTERIE_DEFAUT_J = 1.0;
    const DOD_BATTERIE_DEFAUT_PCT = 80.0;
    const RENDEMENT_BATTERIE_DEFAUT_PCT = 90.0;
    const COEF_SURDIMENSIONNEMENT_DEFAUT = 1.10;

    function systemePompage(v, defaut) {
        return SYSTEMES_POMPAGE.includes(v) ? v : (defaut || 'fil_soleil');
    }

    /** Miroir de recommandations_systeme() (format « {:.Nf} » de Python). */
    function recommandationsSysteme(systeme, volumeReservoir, jours, puissanceGeKva, capaciteBatterieKwh) {
        const f = (v, d) => Number(v).toFixed(d);
        if (systeme === 'groupe') {
            return [
                `Groupe électrogène d'appoint : ${f(puissanceGeKva, 1)} kVA au moins, avec un inverseur de source solaire / groupe compatible avec le contrôleur de la pompe`,
                `Réservoir de stockage conseillé : ${f(volumeReservoir, 0)} m³ (${jours} jour(s) de besoin)`,
            ];
        }
        if (systeme === 'batteries') {
            return [
                `Batteries de secours : ${f(capaciteBatterieKwh, 1)} kWh nominaux, avec régulateur de charge (protection contre la décharge profonde) et local ventilé`,
                `Réservoir de stockage conseillé : ${f(volumeReservoir, 0)} m³ (${jours} jour(s) de besoin)`,
            ];
        }
        return [`Pompage au fil du soleil : réservoir de stockage d'au moins ${f(volumeReservoir, 0)} m³ (${jours} jours de besoin) pour la nuit et les jours couverts`];
    }

    /**
     * Arrondi à N décimales, aligné sur `round()` de Python pour les valeurs que les deux
     * implémentations comparent. L'écart entre l'arrondi « banquier » de Python et celui de
     * JavaScript ne porte que sur les demis exacts, que le test de parité tolère.
     */
    function arrondi(valeur, decimales) {
        const f = Math.pow(10, decimales);
        return Math.round(valeur * f) / f;
    }

    /**
     * @param {object} e  Saisies du formulaire (chaînes acceptées, cf. nombreSur).
     * @param {number[]} irradiationJournaliere  12 moyennes journalières (kWh/m²/jour), du serveur.
     * @returns {object} Mêmes clés que la réponse de /calcul.
     */
    function dimensionner(e, irradiationJournaliere) {
        e = e || {};
        const vJour = nombreSur(e.daily_need, 0);
        const hAsp = nombreSur(e.h_aspiration, 0);
        const hTank = nombreSur(e.h_tank, 0);
        const pertesConduitePct = nombreSur(e.losses_pipe, 0);
        const rendPompe = nombreSur(e.pump_efficiency, 0.6);
        const pvInstalleKw = nombreSur(e.puissance_reelle_installee_kwc, 0);

        const perteSysteme = nombreSur(e.perte_systeme, 14);
        const rendSysteme = 1.0 - (perteSysteme / 100.0); // PR
        const coefReductionPomp = nombreSur(e.coef_reduction_pomp, 0.95);
        // Marge appliquée à la puissance PV nécessaire (1 à 2, défaut 1,10) — miroir Python.
        const coefSurdimensionnement = nombreSur(e.coef_surdimensionnement, COEF_SURDIMENSIONNEMENT_DEFAUT);
        const systeme = systemePompage(e.systeme);
        // Sans groupe électrogène (fil du soleil, batteries) : carburant et émissions de groupe à 0 (miroir Python).
        const avecGroupe = systeme === 'groupe';
        const consoSpecifiqueGe = avecGroupe ? nombreSur(e.conso_specifique_ge, 0.5) : 0; // L/kWh
        const facteurCo2 = avecGroupe ? nombreSur(e.facteur_emission_co2, 0.58) : 0; // kgCO2/kWh

        const avecBatteries = systeme === 'batteries';
        const rendBatterie = avecBatteries ? nombreSur(e.rendement_batterie_pct, RENDEMENT_BATTERIE_DEFAUT_PCT) / 100.0 : 1.0;
        const dodBatterie = nombreSur(e.dod_batterie_pct, DOD_BATTERIE_DEFAUT_PCT) / 100.0;
        const autonomieBatterie = nombreSur(e.autonomie_batterie_j, AUTONOMIE_BATTERIE_DEFAUT_J);
        // Seuil de démarrage (fil du soleil) ou rendement aller-retour de la batterie.
        const coefVolume = avecBatteries ? rendBatterie : coefReductionPomp;

        // Production mensuelle RÉELLE du calepinage (kWh AC, 12 valeurs : ombrage proche 3D, PR,
        // écrêtage compris), issue du calcul « vente en totalité » du module Production solaire.
        // Utilisée à la place de l'estimation kWc x irradiation x PR, seulement avec une puissance
        // installée (celle du calepinage).
        const prodReelle = (Array.isArray(e.production_mensuelle_kwh) && e.production_mensuelle_kwh.length === 12)
            ? e.production_mensuelle_kwh.map((v) => nombreSur(v, 0)) : null;
        const avecProdReelle = !!prodReelle && pvInstalleKw > 0;

        const hGeo = hAsp + hTank;
        const hmt = hGeo * (1 + pertesConduitePct / 100.0);

        const irr = Array.isArray(irradiationJournaliere) && irradiationJournaliere.length === 12
            ? irradiationJournaliere.map((v) => nombreSur(v, 0)) : null;
        if (!irr) return { error: "Irradiation indisponible (12 valeurs mensuelles attendues)" };

        const radPireMois = Math.min.apply(null, irr);
        const radMoyen = irr.reduce((s, v) => s + v, 0) / irr.length;

        // P_PV = (1000 * 9.81 * HMT * V_jour) / (3600 * H_min * PR * rendement_pompe [* rendement_batterie])
        const reqPv = (radPireMois > 0 && rendSysteme > 0 && rendPompe > 0 && rendBatterie > 0)
            ? (1000 * 9.81 * hmt * vJour) / (3600 * radPireMois * rendSysteme * rendPompe * rendBatterie) * coefSurdimensionnement
            : 0;

        // Priorité au design personnalisé pour les volumes pompés.
        const pvPourHydraulique = pvInstalleKw > 0 ? pvInstalleKw : (reqPv / 1000.0);
        const debitMoyen = vJour / 6.0; // 6 h de pompage solaire effectif

        const pompeW = rendPompe > 0 ? (1000 * 9.81 * hmt * (debitMoyen / 3600.0)) / rendPompe : 0;

        const energieElecJourKwh = rendPompe > 0 ? (9.81 * hmt * vJour) / (3600 * rendPompe) : 0;
        const energiePompageMwhAn = (energieElecJourKwh * 365) / 1000.0;

        let solaireTotalKwh = 0;
        let irradiationAnnuelle = 0;
        let prodDesignKwh = 0;
        const besoinsMensuels = [];
        const pompesMensuels = [];
        const manquesMensuels = [];

        irr.forEach((journalier, i) => {
            const radMensuel = journalier * JOURS_PAR_MOIS[i];
            solaireTotalKwh += (reqPv / 1000.0) * radMensuel * rendSysteme;
            irradiationAnnuelle += radMensuel;

            const besoinMois = vJour * JOURS_PAR_MOIS[i];
            besoinsMensuels.push(besoinMois);

            // V = (E_elec_kWh * 3600 * rendement_pompe) / (9.81 * HMT)
            const eElecMois = avecProdReelle ? prodReelle[i] : pvPourHydraulique * journalier * rendSysteme * JOURS_PAR_MOIS[i];
            const pompeMois = (hmt > 0 ? (eElecMois * 3600 * rendPompe) / (9.81 * hmt) : 0) * coefVolume;
            pompesMensuels.push(pompeMois);
            manquesMensuels.push(Math.max(0, besoinMois - pompeMois));

            if (pvInstalleKw > 0) prodDesignKwh += avecProdReelle ? prodReelle[i] : pvInstalleKw * radMensuel * rendSysteme;
        });

        const energieSolaireMwhAn = solaireTotalKwh / 1000.0;
        const besoinEauAnnuelM3 = vJour * 365;

        // Le volume pompé UTILE est plafonné au besoin du mois : pomper plus que nécessaire en
        // saison favorable ne compense pas un déficit d'une autre saison.
        let pompeUtileM3 = 0;
        pompesMensuels.forEach((v, i) => { pompeUtileM3 += Math.min(v, besoinsMensuels[i]); });
        let tauxSatisfaction = besoinEauAnnuelM3 > 0 ? (pompeUtileM3 / besoinEauAnnuelM3 * 100) : 0;

        const eHydKwh = (9.81 * hmt * pompeUtileM3) / 3600.0;
        const eElecEquivKwh = rendPompe > 0 ? eHydKwh / rendPompe : 0;
        const economieCarburantL = eElecEquivKwh * consoSpecifiqueGe;
        // Carburant qu'un groupe électrogène brûlerait pour pomper TOUT le besoin, et ce qu'il reste à
        // lui faire pomper avec le solaire (déficit des mois peu ensoleillés). Base de l'analyse éco.
        const carburantSansSolaireL = energieElecJourKwh * 365 * consoSpecifiqueGe;
        const carburantResiduelL = Math.max(0, carburantSansSolaireL - economieCarburantL);

        const deficitM3 = manquesMensuels.reduce((s, v) => s + v, 0);
        const joursReservoir = JOURS_RESERVOIR[systeme];
        const volumeReservoirM3 = vJour * joursReservoir;
        const puissanceGeKva = systeme === 'groupe' ? (pompeW / 1000.0) * MARGE_DEMARRAGE_GE / COS_PHI_GE : 0;
        const capaciteUtileKwh = avecBatteries ? energieElecJourKwh * autonomieBatterie : 0;
        const capaciteNominaleKwh = (avecBatteries && dodBatterie > 0 && rendBatterie > 0)
            ? capaciteUtileKwh / (dodBatterie * Math.sqrt(rendBatterie)) : 0;

        let energieSolaireDesignMwhAn = 0;
        let tauxSatisfactionDesign = 0;

        if (pvInstalleKw > 0) {
            energieSolaireDesignMwhAn = prodDesignKwh / 1000.0;
            // La boucle ci-dessus a utilisé la puissance INSTALLÉE : le taux qu'elle a produit est
            // donc celui du design. Le taux « théorique » (sur la puissance requise) est recalculé
            // ici pour que les deux puissent être affichés côte à côte.
            tauxSatisfactionDesign = tauxSatisfaction;
            let utileTheoM3 = 0;
            irr.forEach((journalier, i) => {
                const eElecTheo = (reqPv / 1000.0) * journalier * rendSysteme;
                const vTheo = hmt > 0 ? (eElecTheo * 3600 * rendPompe) / (9.81 * hmt) : 0;
                utileTheoM3 += Math.min(vTheo * JOURS_PAR_MOIS[i] * coefVolume, besoinsMensuels[i]);
            });
            tauxSatisfaction = besoinEauAnnuelM3 > 0 ? (utileTheoM3 / besoinEauAnnuelM3 * 100) : 0;
        }
        // CO2 évité : électricité que le groupe aurait produite pour le MÊME volume utile (miroir Python).
        const co2EviteTonnes = (eElecEquivKwh * facteurCo2) / 1000.0;

        return {
            success: true,
            systeme,
            production_reelle: avecProdReelle,
            hmt: arrondi(hmt, 2),
            h_geo: arrondi(hGeo, 2),
            req_pv_w: arrondi(reqPv, 2),
            debit_moyen_m3h: arrondi(debitMoyen, 2),
            pump_power_w: arrondi(pompeW, 2),
            pump_power_kw: arrondi(pompeW / 1000.0, 2),
            // 1 CV (cheval-vapeur) = 735,5 W — pas 745,7 W, qui est le HP mécanique.
            pump_power_cv: arrondi(pompeW / 735.5, 2),
            energy_pumping_mwh_yr: arrondi(energiePompageMwhAn, 2),
            energy_solar_mwh_yr: arrondi(energieSolaireMwhAn, 2),
            solar_coverage: arrondi(tauxSatisfaction, 2),
            worst_month_rad: arrondi(radPireMois, 2),
            energy_solar_design_mwh_yr: arrondi(energieSolaireDesignMwhAn, 2),
            solar_coverage_design: arrondi(tauxSatisfactionDesign, 2),
            daily_irradiation: irr,
            total_annual_irradiation: arrondi(irradiationAnnuelle, 2),
            monthly_needs: besoinsMensuels,
            monthly_pumped: pompesMensuels,
            monthly_missing: manquesMensuels,
            fuel_savings_liters: arrondi(economieCarburantL, 0),
            fuel_without_solar_liters: arrondi(carburantSansSolaireL, 2),
            fuel_residual_liters: arrondi(carburantResiduelL, 2),
            annual_water_need_m3: arrondi(besoinEauAnnuelM3, 2),
            co2_avoided_tonnes: arrondi(co2EviteTonnes, 2),
            besoin_non_couvert_m3: systeme !== 'groupe' ? arrondi(deficitM3, 2) : 0,
            volume_groupe_m3_an: systeme === 'groupe' ? arrondi(deficitM3, 2) : 0,
            puissance_groupe_kva: arrondi(puissanceGeKva, 2),
            capacite_batterie_utile_kwh: arrondi(capaciteUtileKwh, 2),
            capacite_batterie_nominale_kwh: arrondi(capaciteNominaleKwh, 2),
            rendement_batterie_pct: avecBatteries ? arrondi(rendBatterie * 100, 2) : null,
            volume_reservoir_m3: arrondi(volumeReservoirM3, 2),
            jours_reservoir: joursReservoir,
            recommendations: recommandations(hmt, reqPv, debitMoyen, radPireMois, radMoyen)
                .concat(recommandationsSysteme(systeme, volumeReservoirM3, joursReservoir, puissanceGeKva, capaciteNominaleKwh)),
        };
    }

    /**
     * Pertes de charge d'une conduite (Hazen-Williams), pour la calculatrice du formulaire.
     * hf = 10.67 * L * Q^1.852 / (C^1.852 * D^4.87), majorée d'un coefficient d'accessoires.
     * @returns {{vitesse:number, pertesM:number}} vitesse en m/s, pertes en mètres de colonne d'eau.
     */
    function pertesDeCharge(coefC, longueurM, diametreMm, debitM3h, coefAccessoires) {
        const D = nombreSur(diametreMm, 0) / 1000;
        const Q = nombreSur(debitM3h, 0) / 3600;
        const C = nombreSur(coefC, 0);
        const L = nombreSur(longueurM, 0);
        const acc = nombreSur(coefAccessoires, 1);
        if (!(D > 0) || !(C > 0)) return { vitesse: 0, pertesM: 0 };
        const vitesse = Q / (Math.PI * Math.pow(D, 2) / 4);
        const hf = 10.67 * L * Math.pow(Q, 1.852) / (Math.pow(C, 1.852) * Math.pow(D, 4.87));
        return { vitesse: vitesse, pertesM: hf * acc };
    }

    // ---------------------------------------------------------------------------------------
    // Analyse économique : pompage solaire vs pompage au groupe électrogène seul
    // ---------------------------------------------------------------------------------------
    // MIROIR EXACT de analyse_economique() (app/models/calcul_pompage_solaire.py), qui documente le
    // modèle ; vérifié par le même test de parité.
    //
    // Évolution dans le temps (commune au plan d'affaires) : besoin x evolution_besoins^(t-1) dès
    // l'année 2, pompage solaire x (1 - dégradation)^(t-1) ; le groupe pompe le déficit.
    // Scénario SANS solaire : le groupe pompe tout le besoin -> carburant indexé + Opex du groupe +
    // remplacement l'année ANNEE_REMPLACEMENT_GE. Scénario AVEC solaire : Capex en année 0, Opex de la
    // centrale indexé, remplacement de l'onduleur / contrôleur l'année ANNEE_REMPLACEMENT_ONDULEUR,
    // carburant du déficit ; Opex et remplacement du groupe proratisés sur sa part résiduelle de l'année.

    const DUREE_ANALYSE_ANS = 20;
    const DUREE_VIE_BATTERIE_DEFAUT = 10;
    const ANNEE_REMPLACEMENT_GE = 10;
    const ANNEE_REMPLACEMENT_ONDULEUR = 10;
    const EVOLUTION_BESOINS_DEFAUT = 1.10;
    const DEGRADATION_PV_DEFAUT = 0.3;

    /** VAN des flux [f0, f1, ...] au taux `taux` (fraction). */
    function van(flux, taux) {
        return flux.reduce((s, f, t) => s + f / Math.pow(1 + taux, t), 0);
    }

    /** TRI par dichotomie sur [-99 %, 1000 %] ; null si la VAN ne change pas de signe. */
    function tri(flux) {
        let bas = -0.99;
        let haut = 10;
        let vBas = van(flux, bas);
        const vHaut = van(flux, haut);
        if (!(Number.isFinite(vBas) && Number.isFinite(vHaut)) || vBas * vHaut > 0) return null;
        for (let i = 0; i < 200; i++) {
            const milieu = (bas + haut) / 2;
            const vMilieu = van(flux, milieu);
            if (vMilieu === 0) return milieu;
            if (vBas * vMilieu < 0) { haut = milieu; } else { bas = milieu; vBas = vMilieu; }
        }
        return (bas + haut) / 2;
    }

    /** Année (fractionnaire) où le cumul `cle` redevient positif ; null si jamais sur l'horizon. */
    function anneeRetour(lignes, cle, cleGain) {
        if (lignes.length && lignes[0][cle] >= 0) return 0; // investissement financé dès l'année 0
        for (let i = 1; i < lignes.length; i++) {
            if (lignes[i][cle] >= 0) {
                const avant = lignes[i - 1][cle];
                const gain = lignes[i][cleGain];
                return gain > 0 ? (i - 1) + (-avant / gain) : i;
            }
        }
        return null;
    }

    /** Miroir de annees_remplacement_batterie() : multiples de la durée de vie, dans l'horizon, avant l'année 20. */
    function anneesRemplacementBatterie(dureeVie, horizon) {
        const d = Math.trunc(dureeVie || 0);
        const annees = [];
        if (!(d > 0)) return annees;
        for (let t = d; t <= Math.min(Math.trunc(horizon), DUREE_ANALYSE_ANS - 1); t += d) annees.push(t);
        return annees;
    }

    /** Miroir de profil_pompage() : [pompé mensuel, besoin mensuel, litres par m³ au groupe]. */
    function profilPompage(r) {
        r = r || {};
        const carbSans = nombreSur(r.fuel_without_solar_liters, 0);
        if (Array.isArray(r.monthly_pumped) && Array.isArray(r.monthly_needs)
            && r.monthly_pumped.length === 12 && r.monthly_needs.length === 12) {
            const p = r.monthly_pumped.map((v) => Math.max(0, nombreSur(v, 0)));
            const b = r.monthly_needs.map((v) => Math.max(0, nombreSur(v, 0)));
            const total = b.reduce((s, v) => s + v, 0);
            return [p, b, total > 0 ? carbSans / total : 0];
        }
        const carbResid = nombreSur(r.fuel_residual_liters, 0);
        return [[Math.max(0, carbSans - carbResid)], [carbSans], 1];
    }

    /** Miroir de volumes_annee() : [besoin, volume solaire utile] en m³ l'année t >= 1. */
    function volumesAnnee(pompes, besoins, t, evolution, degradation) {
        const g = Math.pow(evolution, t - 1);
        const d = Math.pow(1 - degradation, t - 1);
        let besoin = 0, utile = 0;
        for (let i = 0; i < besoins.length; i++) {
            besoin += besoins[i] * g;
            if (i < pompes.length) utile += Math.min(pompes[i] * d, besoins[i] * g);
        }
        return [besoin, utile];
    }

    /**
     * @param {object} r  Résultat de dimensionner() (volumes mensuels, carburant sans solaire).
     * @param {object} p  Hypothèses : capex, opex_pv, opex_ge, remplacement_ge, prix_carburant,
     *                    inflation_carburant (%), taux_actualisation (%), indexation_opex_pv (%),
     *                    remplacement_onduleur, evolution_besoins, degradation_pv (%/an).
     */
    function analyseEconomique(r, p) {
        p = p || {};
        const [pompes, besoins, litresM3] = profilPompage(r);
        const capex = nombreSur(p.capex, 0);
        const opexPv = nombreSur(p.opex_pv, 0);
        let opexGe = nombreSur(p.opex_ge, 1000);
        let remplGe = nombreSur(p.remplacement_ge, 7000);
        let prix = nombreSur(p.prix_carburant, 0);
        const infl = nombreSur(p.inflation_carburant, 3) / 100.0;
        const taux = nombreSur(p.taux_actualisation, 3) / 100.0;
        const indexOpexPv = nombreSur(p.indexation_opex_pv, 3) / 100.0;
        const remplOnduleur = nombreSur(p.remplacement_onduleur, 2000);
        const evolution = nombreSur(p.evolution_besoins, EVOLUTION_BESOINS_DEFAUT);
        const degradation = nombreSur(p.degradation_pv, DEGRADATION_PV_DEFAUT) / 100.0;
        const systeme = systemePompage(p.systeme, 'groupe');
        const appoint = systeme === 'groupe';
        const avecBatteries = systeme === 'batteries';
        const capexBatterie = avecBatteries ? nombreSur(p.capex_batterie, 0) : 0;
        const remplBatterie = avecBatteries ? nombreSur(p.remplacement_batterie, 0) : 0;
        const anneesBatterie = avecBatteries
            ? anneesRemplacementBatterie(Math.trunc(nombreSur(p.duree_vie_batterie, DUREE_VIE_BATTERIE_DEFAUT)), DUREE_ANALYSE_ANS) : [];
        const invest = capex + capexBatterie;
        // Sans groupe électrogène : Opex, remplacement et carburant du groupe à 0, quelles que soient les saisies.
        if (!appoint) { opexGe = 0; remplGe = 0; prix = 0; }
        let coutGlobalAct = invest;
        let volumeAct = 0;
        let volumeTotal = 0;

        const lignes = [{
            annee: 0, besoin_m3: 0, non_couvert_m3: 0, carburant_sans_l: 0, carburant_avec_l: 0,
            cout_carburant_sans: 0, cout_sans: 0, cout_carburant_avec: 0,
            cout_avec: invest, opex_pv: 0, remplacement_batterie: 0, gain: -invest, cumul: -invest,
            gain_actualise: -invest, cumul_actualise: -invest,
        }];
        const flux = [-invest];
        let cumul = -invest;
        let cumulAct = -invest;
        let totalSans = 0;
        let totalAvec = invest;
        let totalGains = 0;
        let carbEconomise = 0;
        let partAnnee1 = 0;
        let nonCouvert1 = 0;
        // Volume solaire utile perdu par la dégradation des panneaux (écart avec des panneaux sans
        // dégradation) : nul tant que le surplus de capacité des mois ensoleillés absorbe la baisse.
        let perteDegradation = 0;
        let anneeEffetDegradation = null;

        for (let t = 1; t <= DUREE_ANALYSE_ANS; t++) {
            const [besoin, utile] = volumesAnnee(pompes, besoins, t, evolution, degradation);
            const perte = volumesAnnee(pompes, besoins, t, evolution, 0)[1] - utile;
            perteDegradation += perte;
            if (anneeEffetDegradation === null && perte > 1e-9) anneeEffetDegradation = t;
            // Sans appoint : comparaison à volume d'eau égal (le groupe de référence pompe le volume utile du solaire).
            const carbSans = litresM3 * (appoint ? besoin : utile);
            const carbResid = appoint ? litresM3 * Math.max(0, besoin - utile) : 0;
            const nonCouvert = appoint ? 0 : Math.max(0, besoin - utile);
            const part = carbSans > 0 ? Math.min(1, carbResid / carbSans) : 0;
            if (t === 1) { partAnnee1 = part; nonCouvert1 = nonCouvert; }
            const indexCarb = Math.pow(1 + infl, t - 1);
            const remplacement = t === ANNEE_REMPLACEMENT_GE ? remplGe : 0;
            const carburantSans = carbSans * prix * indexCarb;
            const coutSans = carburantSans + opexGe + remplacement;
            const carburantAvec = carbResid * prix * indexCarb;
            const opexPvAnnee = opexPv * Math.pow(1 + indexOpexPv, t - 1);
            const remplacementOnduleur = t === ANNEE_REMPLACEMENT_ONDULEUR ? remplOnduleur : 0;
            const remplacementBatt = anneesBatterie.includes(t) ? remplBatterie : 0;
            const coutAvec = opexPvAnnee + remplacementOnduleur + remplacementBatt + carburantAvec + (opexGe + remplacement) * part;
            const gain = coutSans - coutAvec;
            const gainAct = gain / Math.pow(1 + taux, t);
            cumul += gain;
            cumulAct += gainAct;
            const servi = appoint ? besoin : utile;
            volumeTotal += servi;
            volumeAct += servi / Math.pow(1 + taux, t);
            coutGlobalAct += coutAvec / Math.pow(1 + taux, t);
            totalSans += coutSans;
            totalAvec += coutAvec;
            totalGains += gain;
            carbEconomise += carbSans - carbResid;
            flux.push(gain);
            lignes.push({
                annee: t,
                besoin_m3: arrondi(besoin, 2),
                non_couvert_m3: arrondi(nonCouvert, 2),
                remplacement_batterie: arrondi(remplacementBatt, 2),
                carburant_sans_l: arrondi(carbSans, 2),
                carburant_avec_l: arrondi(carbResid, 2),
                cout_carburant_sans: arrondi(carburantSans, 2),
                cout_sans: arrondi(coutSans, 2),
                cout_carburant_avec: arrondi(carburantAvec, 2),
                opex_pv: arrondi(opexPvAnnee, 2),
                cout_avec: arrondi(coutAvec, 2),
                gain: arrondi(gain, 2),
                cumul: arrondi(cumul, 2),
                gain_actualise: arrondi(gainAct, 2),
                cumul_actualise: arrondi(cumulAct, 2),
            });
        }

        const taux_ = tri(flux);
        const retour = anneeRetour(lignes, 'cumul', 'gain');
        const retourAct = anneeRetour(lignes, 'cumul_actualise', 'gain_actualise');
        return {
            success: true,
            systeme,
            capex_batterie: arrondi(capexBatterie, 2),
            annees_remplacement_batterie: anneesBatterie,
            besoin_non_couvert_an1_m3: arrondi(nonCouvert1, 2),
            duree_ans: DUREE_ANALYSE_ANS,
            annee_remplacement_ge: ANNEE_REMPLACEMENT_GE,
            annee_remplacement_onduleur: ANNEE_REMPLACEMENT_ONDULEUR,
            evolution_besoins: evolution,
            degradation_pv_pct: arrondi(degradation * 100, 4),
            volume_perdu_degradation_m3: arrondi(perteDegradation, 2),
            annee_effet_degradation: anneeEffetDegradation,
            part_residuelle_ge_pct: arrondi(partAnnee1 * 100, 2),
            van: arrondi(cumulAct, 2),
            tri_pct: taux_ === null ? null : arrondi(taux_ * 100, 2),
            retour_simple_ans: retour === null ? null : arrondi(retour, 2),
            retour_actualise_ans: retourAct === null ? null : arrondi(retourAct, 2),
            gains_totaux: arrondi(totalGains, 2),
            cout_total_sans: arrondi(totalSans, 2),
            cout_total_avec: arrondi(totalAvec, 2),
            gain_annee_1: lignes[1].gain,
            carburant_economise_total_l: arrondi(carbEconomise, 2),
            volume_servi_total_m3: arrondi(volumeTotal, 2),
            cout_global_actualise: arrondi(coutGlobalAct, 2),
            cout_actualise_m3: volumeAct > 0 ? arrondi(coutGlobalAct / volumeAct, 4) : null,
            tableau: lignes,
        };
    }

    // ---------------------------------------------------------------------------------------
    // Plan d'affaires : vente de l'eau
    // ---------------------------------------------------------------------------------------
    // MIROIR de plan_affaires() (app/models/calcul_pompage_solaire.py), qui documente le modèle et
    // reste la SOURCE DE VÉRITÉ : le résultat calculé ici est affiché tout de suite, puis comparé à
    // celui du serveur (numpy-financial) ; en cas d'écart (ecartPlanAffaires) le serveur l'emporte.

    const HORIZONS_PLAN_AFFAIRES = [5, 10, 15, 20];
    const ANNEE_REMPLACEMENT_PLAN = 10;
    const TRI_MIN = -0.99;
    const TRI_MAX = 10;
    const VERSION_PLAN_AFFAIRES = 2;

    /** Miroir de echeancier_emprunt() : [[intérêts, capital remboursé]] des années 1..horizon. */
    function echeancierEmprunt(capital, taux, duree, horizon) {
        const lignes = [];
        if (!(capital > 0) || !(duree > 0)) { for (let t = 0; t < horizon; t++) lignes.push([0, 0]); return lignes; }
        let restant = capital;
        const annuite = taux === 0 ? capital / duree : capital * taux / (1 - Math.pow(1 + taux, -duree));
        for (let t = 1; t <= horizon; t++) {
            let interets = 0, principal = 0;
            if (t <= duree && restant > 0) {
                interets = restant * taux;
                principal = t === duree ? restant : Math.min(restant, annuite - interets);
            }
            if (t === horizon) principal = restant; // solde du capital restant dû à l'horizon
            restant -= principal;
            lignes.push([interets, principal]);
        }
        return lignes;
    }

    /** Miroir de dotations_amortissement(). */
    function dotationsAmortissement(base, methode, duree, montant, horizon) {
        const lignes = [];
        let cumul = 0;
        for (let t = 1; t <= horizon; t++) {
            let d = methode === 'constant' ? montant : (duree > 0 && t <= duree ? base / duree : 0);
            d = Math.max(0, Math.min(d, base - cumul));
            cumul += d;
            lignes.push(d);
        }
        return lignes;
    }

    function preparerPlan(p) {
        const hybride = !!p.hybride;
        const stockage = !!p.stockage;
        const impots = !!p.impots;
        const vrActive = !!p.valeur_residuelle;
        const lots = {
            materiel_pompage: nombreSur(p.capex_materiel_pompage, 0),
            genie_civil_pose: nombreSur(p.capex_genie_civil_pose, 0),
            transport: nombreSur(p.capex_transport, 0),
            terrain: Math.max(0, nombreSur(p.capex_terrain, 0)),
            pv: (hybride || stockage) ? nombreSur(p.capex_pv, 0) : 0,
            groupe_electrogene: hybride ? nombreSur(p.capex_ge, 0) : 0,
            batterie: stockage ? nombreSur(p.capex_batterie, 0) : 0,
        };
        const capex = Object.values(lots).reduce((s, v) => s + v, 0);
        let horizon = Math.trunc(nombreSur(p.horizon, 20));
        if (!HORIZONS_PLAN_AFFAIRES.includes(horizon)) horizon = 20;
        const subvention = Math.max(0, nombreSur(p.subvention, 0));
        const emprunt = Math.max(0, nombreSur(p.emprunt, 0));
        const tauxEmprunt = nombreSur(p.taux_emprunt, 5) / 100.0;
        const dureeEmprunt = Math.trunc(nombreSur(p.duree_emprunt, 10));
        const idxEntretien = nombreSur(p.indexation_entretien, 3) / 100.0;
        const entretien = nombreSur(p.entretien, 200);
        const entretienGe = hybride ? nombreSur(p.entretien_ge, 0) : 0;
        const prixCarb = hybride ? nombreSur(p.prix_carburant, 0) : 0;
        const inflCarb = nombreSur(p.inflation_carburant, 3) / 100.0;
        const evolution = nombreSur(p.evolution_besoins, EVOLUTION_BESOINS_DEFAUT);
        const degradation = nombreSur(p.degradation_pv, DEGRADATION_PV_DEFAUT) / 100.0;
        const pertes = nombreSur(p.part_pertes, 10) / 100.0;
        const remplacement = nombreSur(p.remplacement_onduleur, 2000)
            + (hybride ? nombreSur(p.remplacement_ge, 0) : 0);
        const remplBatterie = stockage ? nombreSur(p.remplacement_batterie, 0) : 0;
        const anneesBatterie = stockage
            ? anneesRemplacementBatterie(Math.trunc(nombreSur(p.duree_vie_batterie, DUREE_VIE_BATTERIE_DEFAUT)), horizon) : [];
        const methode = p.methode_amortissement === 'constant' ? 'constant' : 'lineaire';
        // Le terrain ne s'amortit pas : hors base d'amortissement, conservé dans la valeur résiduelle.
        const baseAmortissable = capex - lots.terrain;
        const dotations = (impots || vrActive)
            ? dotationsAmortissement(baseAmortissable, methode, Math.trunc(nombreSur(p.duree_amortissement, 20)), nombreSur(p.amortissement_annuel, 0), horizon)
            : new Array(horizon).fill(0);
        const vr = vrActive ? Math.max(0, baseAmortissable - dotations.reduce((s, v) => s + v, 0)) + lots.terrain : 0;

        const pompes = (Array.isArray(p.monthly_pumped) ? p.monthly_pumped : []).slice(0, 12).map((v) => Math.max(0, nombreSur(v, 0)));
        const besoins = (Array.isArray(p.monthly_needs) ? p.monthly_needs : []).slice(0, 12).map((v) => Math.max(0, nombreSur(v, 0)));
        const totalBesoin = besoins.reduce((s, v) => s + v, 0);
        const litresM3 = totalBesoin > 0 ? nombreSur(p.carburant_sans_solaire_l, 0) / totalBesoin : 0;

        const dette = echeancierEmprunt(emprunt, tauxEmprunt, dureeEmprunt, horizon);
        const annees = [];
        for (let t = 1; t <= horizon; t++) {
            const [besoin, utile] = volumesAnnee(pompes, besoins, t, evolution, degradation);
            const groupe = hybride ? Math.max(0, besoin - utile) : 0;
            const pompe = utile + groupe;
            const ie = Math.pow(1 + idxEntretien, t - 1);
            annees.push({
                annee: t,
                besoin_m3: besoin,
                volume_solaire_m3: utile,
                volume_groupe_m3: groupe,
                volume_pompe_m3: pompe,
                volume_facture_m3: pompe * (1 - pertes),
                entretien: entretien * ie,
                entretien_ge: entretienGe * ie,
                carburant_l: litresM3 * groupe,
                carburant: litresM3 * groupe * prixCarb * Math.pow(1 + inflCarb, t - 1),
                remplacements: (t === ANNEE_REMPLACEMENT_PLAN ? remplacement : 0) + (anneesBatterie.includes(t) ? remplBatterie : 0),
                dotation: dotations[t - 1],
                interets: dette[t - 1][0],
                principal: dette[t - 1][1],
                valeur_residuelle: t === horizon ? vr : 0,
            });
        }
        return {
            hybride, stockage, impots, vrActive,
            tauxImpot: impots ? nombreSur(p.taux_impot, 10) / 100.0 : 0,
            lots, capex, horizon, subvention, emprunt,
            taux: nombreSur(p.taux_actualisation, 3) / 100.0,
            idxTarif: nombreSur(p.indexation_tarif, 3) / 100.0,
            methode, valeurResiduelle: vr, annees, anneesBatterie,
        };
    }

    function fluxPlan(c, tarif, idxTarif) {
        const flux0 = -c.capex + c.subvention + c.emprunt;
        const lignes = [];
        const flux = [flux0];
        c.annees.forEach((a) => {
            const tarifT = tarif * Math.pow(1 + idxTarif, a.annee - 1);
            const recettes = a.volume_facture_m3 * tarifT;
            const charges = a.entretien + a.entretien_ge + a.carburant + a.remplacements;
            const resultat = recettes - charges - a.dotation - a.interets;
            const impot = resultat > 0 ? c.tauxImpot * resultat : 0;
            const f = recettes - charges - impot - a.interets - a.principal + a.valeur_residuelle;
            flux.push(f);
            lignes.push(Object.assign({}, a, { tarif_m3: tarifT, recettes, resultat_imposable: resultat, impot, flux: f }));
        });
        return [lignes, flux];
    }

    function tarifEquilibre(c, idxTarif) {
        if (!(c.annees.reduce((s, a) => s + a.volume_facture_m3, 0) > 0)) return null;
        const v = (x) => van(fluxPlan(c, x, idxTarif)[1], c.taux);
        if (v(0) >= 0) return 0;
        let haut = 1;
        let trouve = false;
        for (let i = 0; i < 80; i++) {
            if (v(haut) >= 0) { trouve = true; break; }
            haut *= 2;
        }
        if (!trouve) return null;
        let bas = 0;
        for (let i = 0; i < 100; i++) {
            const milieu = (bas + haut) / 2;
            if (v(milieu) >= 0) haut = milieu; else bas = milieu;
        }
        return haut;
    }

    function changementsDeSigne(flux) {
        const signes = flux.filter((f) => f !== 0).map((f) => f > 0);
        let n = 0;
        for (let i = 1; i < signes.length; i++) if (signes[i] !== signes[i - 1]) n++;
        return n;
    }

    function planAffaires(p) {
        p = p || {};
        const c = preparerPlan(p);
        const tarif = nombreSur(p.tarif_m3, 5);
        const [lignesBrutes, flux] = fluxPlan(c, tarif, c.idxTarif);
        const flux0 = flux[0];
        const lignes = [{
            annee: 0, besoin_m3: 0, volume_solaire_m3: 0, volume_groupe_m3: 0, volume_pompe_m3: 0,
            volume_facture_m3: 0, tarif_m3: 0, recettes: 0, entretien: 0, entretien_ge: 0,
            carburant_l: 0, carburant: 0, remplacements: 0, dotation: 0, interets: 0, principal: 0,
            impot: 0, valeur_residuelle: 0, investissement: arrondi(c.capex, 2),
            financement: arrondi(c.subvention + c.emprunt, 2),
            flux: arrondi(flux0, 2), cumul: arrondi(flux0, 2), flux_actualise: arrondi(flux0, 2),
            cumul_actualise: arrondi(flux0, 2),
        }];
        const CLES = ['besoin_m3', 'volume_solaire_m3', 'volume_groupe_m3', 'volume_pompe_m3', 'volume_facture_m3',
            'recettes', 'entretien', 'entretien_ge', 'carburant_l', 'carburant', 'remplacements', 'dotation',
            'interets', 'principal', 'impot', 'valeur_residuelle'];
        let cumul = flux0;
        let cumulAct = flux0;
        lignesBrutes.forEach((a, i) => {
            const f = flux[i + 1];
            const fAct = f / Math.pow(1 + c.taux, a.annee);
            cumul += f;
            cumulAct += fAct;
            const ligne = {};
            CLES.forEach((k) => { ligne[k] = arrondi(a[k], 2); });
            Object.assign(ligne, {
                annee: a.annee, tarif_m3: arrondi(a.tarif_m3, 4), investissement: 0, financement: 0,
                flux: arrondi(f, 2), cumul: arrondi(cumul, 2), flux_actualise: arrondi(fAct, 2),
                cumul_actualise: arrondi(cumulAct, 2),
            });
            lignes.push(ligne);
        });

        const vanPlan = van(flux, c.taux);
        const ambigu = changementsDeSigne(flux) > 1;
        let triPlan = tri(flux);
        if (triPlan !== null && !(triPlan >= TRI_MIN && triPlan <= TRI_MAX)) triPlan = null;
        const prixEq = tarifEquilibre(c, c.idxTarif);
        const coutRevient = tarifEquilibre(c, 0);
        const retour = anneeRetour(lignes, 'cumul', 'flux');
        const retourAct = anneeRetour(lignes, 'cumul_actualise', 'flux_actualise');
        const somme = (fn) => arrondi(lignesBrutes.reduce((s, a) => s + fn(a), 0), 2);
        const a1 = lignes[1];
        const lotsArrondis = {};
        Object.keys(c.lots).forEach((k) => { lotsArrondis[k] = arrondi(c.lots[k], 2); });
        return {
            success: true,
            version: VERSION_PLAN_AFFAIRES,
            horizon: c.horizon,
            hybride: c.hybride,
            stockage: c.stockage,
            impots: c.impots,
            valeur_residuelle_active: c.vrActive,
            annee_remplacement: ANNEE_REMPLACEMENT_PLAN,
            annees_remplacement_batterie: c.anneesBatterie,
            capex_lots: lotsArrondis,
            capex_total: arrondi(c.capex, 2),
            subvention: arrondi(c.subvention, 2),
            emprunt: arrondi(c.emprunt, 2),
            fonds_propres: arrondi(c.capex - c.subvention - c.emprunt, 2),
            besoin_m3_an1: a1.besoin_m3,
            volume_pompe_m3_an1: a1.volume_pompe_m3,
            volume_groupe_m3_an1: a1.volume_groupe_m3,
            volume_facture_m3_an1: a1.volume_facture_m3,
            carburant_l_an1: a1.carburant_l,
            van: arrondi(vanPlan, 2),
            tri_pct: triPlan === null ? null : arrondi(triPlan * 100, 2),
            tri_ambigu: ambigu,
            retour_simple_ans: retour === null ? null : arrondi(retour, 2),
            retour_actualise_ans: retourAct === null ? null : arrondi(retourAct, 2),
            prix_equilibre_m3: prixEq === null ? null : arrondi(prixEq, 4),
            cout_revient_m3: coutRevient === null ? null : arrondi(coutRevient, 4),
            volume_facture_total_m3: somme((a) => a.volume_facture_m3),
            recettes_totales: somme((a) => a.recettes),
            entretien_total: somme((a) => a.entretien + a.entretien_ge),
            carburant_total: somme((a) => a.carburant),
            remplacements_total: somme((a) => a.remplacements),
            impots_total: somme((a) => a.impot),
            service_dette_total: somme((a) => a.interets + a.principal),
            valeur_residuelle: arrondi(c.valeurResiduelle, 2),
            flux_annee_1: a1.flux,
            tableau: lignes,
        };
    }

    // Écart toléré entre le navigateur et le serveur avant de basculer sur les valeurs du serveur :
    // 1 unité (monnaie, m³, L) ; 0,01 pour les % et les années ; 0,0002 pour les prix au m³
    // (arrondis à 4 décimales : l'écart d'arrondi Python / JS est toléré).
    const TOLERANCES_PLAN = {
        capex_total: 1, fonds_propres: 1, besoin_m3_an1: 1, volume_pompe_m3_an1: 1, volume_facture_m3_an1: 1,
        carburant_l_an1: 1, van: 1, volume_facture_total_m3: 1, recettes_totales: 1, entretien_total: 1,
        carburant_total: 1, remplacements_total: 1, impots_total: 1, service_dette_total: 1,
        valeur_residuelle: 1, flux_annee_1: 1,
        tri_pct: 0.01, retour_simple_ans: 0.01, retour_actualise_ans: 0.01,
        prix_equilibre_m3: 0.0002, cout_revient_m3: 0.0002,
    };
    const TOLERANCES_LIGNE_PLAN = {
        besoin_m3: 1, volume_pompe_m3: 1, volume_groupe_m3: 1, volume_facture_m3: 1, tarif_m3: 0.0002,
        recettes: 1, entretien: 1, entretien_ge: 1, carburant: 1, remplacements: 1, dotation: 1,
        interets: 1, principal: 1, impot: 1, valeur_residuelle: 1, investissement: 1, financement: 1,
        flux: 1, cumul: 1, flux_actualise: 1, cumul_actualise: 1,
    };

    /** Liste des écarts navigateur / serveur (vide : résultats concordants). */
    function ecartPlanAffaires(front, back) {
        const ecarts = [];
        const absent = (v) => v === null || v === undefined;
        const comparer = (lib, a, b, tol) => {
            if (absent(a) || absent(b)) {
                if (absent(a) !== absent(b)) ecarts.push(`${lib} : ${a} / ${b}`);
                return;
            }
            if (!(Math.abs(Number(a) - Number(b)) < tol)) ecarts.push(`${lib} : ${a} / ${b}`);
        };
        if (!front || !back) return ['résultat absent'];
        Object.keys(TOLERANCES_PLAN).forEach((k) => comparer(k, front[k], back[k], TOLERANCES_PLAN[k]));
        if (!!front.tri_ambigu !== !!back.tri_ambigu) ecarts.push('tri_ambigu');
        const tf = front.tableau || [], tb = back.tableau || [];
        if (tf.length !== tb.length) ecarts.push(`tableau : ${tf.length} / ${tb.length} lignes`);
        else tf.forEach((l, i) => Object.keys(TOLERANCES_LIGNE_PLAN)
            .forEach((k) => comparer(`année ${i} ${k}`, l[k], tb[i][k], TOLERANCES_LIGNE_PLAN[k])));
        return ecarts;
    }

    // ---------------------------------------------------------------------------------------
    // Pompes à courbes de performance (gamme SQFlex) : suggestion et montage série / parallèle
    // ---------------------------------------------------------------------------------------
    // MIROIR EXACT de evaluer_montage() / suggerer_pompes() (app/models/calcul_pompage_solaire.py),
    // qui documente le modèle : courbes Q = f(P1) interpolées entre hauteurs, journée type en
    // demi-sinusoïde de 12 h, PR = (1 - pertes) x FACTEUR_TEMPERATURE (calé sur la plage de
    // performance Grundfos), montage parallèle (HMT complète, besoin / n) ou série (HMT / n, besoin
    // complet), un générateur PV par pompe.

    const DUREE_JOUR_H = 12.0;
    const PAS_PROFIL_JOUR = 48;
    const FACTEUR_TEMPERATURE = 0.88;
    const PV_MAX_PAR_POMPE_WC = 3000.0;
    const NB_POMPES_MAX = 4;
    const MONTAGES = ['unique', 'parallele', 'serie'];

    function prPompe(perteSystemePct) {
        return (1.0 - nombreSur(perteSystemePct, 14) / 100.0) * FACTEUR_TEMPERATURE;
    }

    /** [{h, pts: [[P1, Q], ...]}] par hauteur croissante (marqué `normalisees` : pas retrié). */
    function courbesTriees(courbes) {
        if (courbes && courbes.normalisees) return courbes;
        const sortie = (Array.isArray(courbes) ? courbes : [])
            .map((c) => ({
                h: Number(c && c.hmt_m),
                pts: ((c && c.points) || []).filter((p) => p && p.length >= 2)
                    .map((p) => [Number(p[0]), Number(p[1])]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
            }))
            .filter((c) => c.pts.length >= 2 && Number.isFinite(c.h))
            .sort((a, b) => a.h - b.h);
        sortie.normalisees = true;
        return sortie;
    }

    function interp(x, pts) {
        if (x <= pts[0][0]) return pts[0][1];
        const n = pts.length;
        if (x >= pts[n - 1][0]) return pts[n - 1][1];
        for (let i = 1; i < n; i++) {
            if (x <= pts[i][0]) {
                const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
                return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]);
            }
        }
        return pts[n - 1][1];
    }

    function pointCourbe(pts, p1) {
        if (p1 < pts[0][0]) return [0, 0];
        const pAbs = Math.min(p1, pts[pts.length - 1][0]);
        return [interp(pAbs, pts), pAbs];
    }

    function plagePompe(courbes) {
        const c = courbesTriees(courbes);
        if (!c.length) return null;
        let qMax = 0, pMin = Infinity, pMax = 0;
        c.forEach((x) => {
            x.pts.forEach((p) => { qMax = Math.max(qMax, p[1]); });
            pMin = Math.min(pMin, x.pts[0][0]);
            pMax = Math.max(pMax, x.pts[x.pts.length - 1][0]);
        });
        return {
            hmt_min_m: c[0].h, hmt_max_m: c[c.length - 1].h, debit_max_m3h: arrondi(qMax, 3),
            p1_demarrage_min_w: arrondi(pMin, 1), p1_max_w: arrondi(pMax, 1),
        };
    }

    /** [Q m³/h, P1 absorbée W] à la hauteur `hmt` pour `p1` W disponibles ; null hors plage. */
    function debitPompe(courbes, hmt, p1) {
        const c = courbesTriees(courbes);
        if (!c.length || hmt > c[c.length - 1].h + 1e-9) return null;
        if (hmt <= c[0].h) return pointCourbe(c[0].pts, p1);
        for (let i = 1; i < c.length; i++) {
            if (hmt <= c[i].h) {
                const a = c[i - 1].pts, b = c[i].pts;
                const t = (hmt - c[i - 1].h) / (c[i].h - c[i - 1].h);
                if (p1 < a[0][0] + t * (b[0][0] - a[0][0])) return [0, 0];
                const pa = pointCourbe(a, p1), pb = pointCourbe(b, p1);
                return [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])];
            }
        }
        return null;
    }

    /** [volume m³/j, énergie absorbée kWh/j] d'UNE pompe sur la journée type. */
    function volumeJournalier(courbes, hmt, pvWc, irradiationJour, pr) {
        const c = courbesTriees(courbes);
        if (!c.length || hmt > c[c.length - 1].h + 1e-9 || !(pvWc > 0) || !(irradiationJour > 0) || !(pr > 0)) return [0, 0];
        const gMax = Math.PI * irradiationJour / (2 * DUREE_JOUR_H);
        const dt = DUREE_JOUR_H / PAS_PROFIL_JOUR;
        let volume = 0, energie = 0;
        for (let k = 0; k < PAS_PROFIL_JOUR; k++) {
            const g = gMax * Math.sin(Math.PI * (k + 0.5) / PAS_PROFIL_JOUR);
            const r = debitPompe(c, hmt, pvWc * g * pr);
            volume += r[0] * dt;
            energie += r[1] * dt / 1000.0;
        }
        return [volume, energie];
    }

    function pvRequise(courbes, hmt, volumeJour, irradiationJour, pr) {
        if (volumeJour <= 0) return 0;
        if (volumeJournalier(courbes, hmt, PV_MAX_PAR_POMPE_WC, irradiationJour, pr)[0] < volumeJour) return null;
        let bas = 0, haut = PV_MAX_PAR_POMPE_WC;
        for (let i = 0; i < 40; i++) {
            const milieu = (bas + haut) / 2;
            if (volumeJournalier(courbes, hmt, milieu, irradiationJour, pr)[0] >= volumeJour) haut = milieu;
            else bas = milieu;
        }
        return haut;
    }

    /** Note de dimensionnement d'un montage de `nombre` pompes identiques (cf. evaluer_montage). */
    function evaluerMontage(courbesBrutes, montageDemande, nombre, hmt, besoinJour, irradiation, pr, pvInstalleWc) {
        const montage = MONTAGES.includes(montageDemande) ? montageDemande : 'unique';
        const n = montage === 'unique' ? 1 : Math.max(2, Math.min(NB_POMPES_MAX, parseInt(nombre, 10) || 2));
        const hPompe = montage === 'serie' ? hmt / n : hmt;
        const vPompe = montage === 'parallele' ? besoinJour / n : besoinJour;
        const irr = (Array.isArray(irradiation) ? irradiation : []).slice(0, 12).map((x) => nombreSur(x, 0));
        const irrMin = irr.length === 12 ? Math.min.apply(null, irr) : 0;
        const courbes = courbesTriees(courbesBrutes);
        const plage = plagePompe(courbes);
        const res = {
            montage, nombre: n, hmt_par_pompe_m: arrondi(hPompe, 2), volume_par_pompe_m3j: arrondi(vPompe, 2),
            plage, faisable: false, motif: null, pv_par_pompe_wc: null, pv_totale_wc: null,
            rendement_global_pct: null, volume_max_m3j: null, pv_utilisee_wc: null,
            volumes_journaliers_m3: [], couverture_pct: null,
        };
        if (!plage || !(irrMin > 0)) { res.motif = 'donnees'; return res; }
        if (hPompe > plage.hmt_max_m) { res.motif = 'hmt'; return res; }
        const multiple = montage === 'parallele' ? n : 1;
        res.volume_max_m3j = arrondi(volumeJournalier(courbes, hPompe, PV_MAX_PAR_POMPE_WC, irrMin, pr)[0] * multiple, 2);
        const pv = pvRequise(courbes, hPompe, vPompe, irrMin, pr);
        if (pv === null) { res.motif = 'debit'; return res; }
        res.faisable = true;
        res.pv_par_pompe_wc = arrondi(pv, 1);
        res.pv_totale_wc = arrondi(pv * n, 1);
        const [vMin, eMin] = volumeJournalier(courbes, hPompe, pv, irrMin, pr);
        if (eMin > 0) res.rendement_global_pct = arrondi(9.81 * hPompe * vMin / 3600.0 / eMin * 100, 1);

        const pvCalcul = pvInstalleWc > 0 ? pvInstalleWc : pv * n;
        res.pv_utilisee_wc = arrondi(pvCalcul, 1);
        let utile = 0;
        irr.forEach((hJour, i) => {
            const v = volumeJournalier(courbes, hPompe, pvCalcul / n, hJour, pr)[0] * multiple;
            res.volumes_journaliers_m3.push(arrondi(v, 3));
            utile += Math.min(v, besoinJour) * JOURS_PAR_MOIS[i];
        });
        res.couverture_pct = besoinJour > 0 ? arrondi(utile / (besoinJour * 365) * 100, 2) : 0;
        return res;
    }

    const cleTri = (e) => String(e.id);

    /** pompes : [{id, courbes}] -> {uniques, combinaisons} (cf. suggerer_pompes). */
    function suggererPompes(pompes, hmt, besoinJour, irradiation, pr, pvInstalleWc) {
        const uniques = [];
        let combinaisons = [];
        pompes.forEach((p) => {
            const ev = evaluerMontage(p.courbes, 'unique', 1, hmt, besoinJour, irradiation, pr, pvInstalleWc);
            if (ev.faisable) uniques.push(Object.assign(ev, { id: p.id }));
        });
        uniques.sort((a, b) => a.pv_totale_wc - b.pv_totale_wc || (cleTri(a) < cleTri(b) ? -1 : cleTri(a) > cleTri(b) ? 1 : 0));
        if (!uniques.length) {
            for (let n = 2; n <= NB_POMPES_MAX; n++) {
                ['parallele', 'serie'].forEach((montage) => {
                    pompes.forEach((p) => {
                        const ev = evaluerMontage(p.courbes, montage, n, hmt, besoinJour, irradiation, pr, pvInstalleWc);
                        if (ev.faisable) combinaisons.push(Object.assign(ev, { id: p.id }));
                    });
                });
                if (combinaisons.length) break;
            }
            combinaisons.sort((a, b) => a.nombre - b.nombre || a.pv_totale_wc - b.pv_totale_wc
                || (cleTri(a) < cleTri(b) ? -1 : cleTri(a) > cleTri(b) ? 1 : 0));
            combinaisons = combinaisons.slice(0, 6);
        }
        return { uniques, combinaisons };
    }

    window.PompageSolaireCalculs = {
        dimensionner, pertesDeCharge, analyseEconomique, nombreSur, JOURS_PAR_MOIS,
        planAffaires, ecartPlanAffaires, HORIZONS_PLAN_AFFAIRES, ANNEE_REMPLACEMENT_PLAN, VERSION_PLAN_AFFAIRES,
        profilPompage, volumesAnnee, echeancierEmprunt, dotationsAmortissement,
        EVOLUTION_BESOINS_DEFAUT, DEGRADATION_PV_DEFAUT,
        SYSTEMES_POMPAGE, JOURS_RESERVOIR, DUREE_VIE_BATTERIE_DEFAUT, anneesRemplacementBatterie, systemePompage,
        DUREE_ANALYSE_ANS, ANNEE_REMPLACEMENT_GE, ANNEE_REMPLACEMENT_ONDULEUR,
        prPompe, plagePompe, debitPompe, volumeJournalier, pvRequise, evaluerMontage, suggererPompes,
        courbesTriees, FACTEUR_TEMPERATURE, PV_MAX_PAR_POMPE_WC, NB_POMPES_MAX, DUREE_JOUR_H,
        // Outils financiers génériques, réutilisés par la section Rentabilité IRVE.
        van, tri, anneeRetour,
    };
})();
