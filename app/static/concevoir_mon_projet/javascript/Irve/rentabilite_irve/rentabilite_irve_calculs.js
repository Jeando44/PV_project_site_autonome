/**
 * Calculs de la section « Rentabilité IRVE » (modale de consommation d'énergie, app_irve_v1.16.html).
 * ======================================================================================
 * Fonctions pures (aucun accès au DOM) :
 *  - classement d'un pas de temps dans une plage horosaisonnière (C5 Base / HP-HC, C4, C3) :
 *    reprise de la ventilation « Analyse consommation horosaisonnière » de Socalts
 *    (routes/calcul_irve.py::calculate_horosaisonnier) — hiver = novembre à mars, pointe en
 *    décembre/janvier/février hors dimanche — avec des heures creuses et de pointe désormais
 *    modifiables (frises de la modale horosaisonnière, window.horoConfig) ;
 *  - ventilation d'une courbe annuelle par plage, en heure murale (courbe IRVE de calcul_irve.js)
 *    ou en UTC+1 fixe (résultats de l'autoconsommation, cf. calage_horaire.py) ;
 *  - contrôle de cohérence avec le bilan énergétique IRVE (miroir de irve_controle.py) ;
 *  - flux annuels et indicateurs (VAN, TRI, temps de retour, coût actualisé du kWh rechargé). VAN,
 *    TRI et temps de retour réutilisent les fonctions du pompage solaire (PompageSolaireCalculs).
 *
 * Point d'entrée : window.RentabiliteIrveCalculs
 * Calcul de référence Python et test de parité : 2e étape (non faits).
 */
(function () {
    'use strict';

    const MS_HEURE = 3600000;
    const MINUTES_PAR_AN_365 = 525600;

    /** Libellés des plages tarifaires. */
    const PLAGES = {
        BASE: 'Base (tarif unique)',
        HP: 'Heures pleines (HP)',
        HC: 'Heures creuses (HC)',
        P: 'Pointe (P)',
        HPH: 'Heures pleines hiver (HPH)',
        HCH: 'Heures creuses hiver (HCH)',
        HPE: 'Heures pleines été (HPE)',
        HCE: 'Heures creuses été (HCE)',
    };

    /** Plages de chaque option tarifaire (ordre d'affichage). */
    const PLAGES_PAR_TARIF = {
        C5_BASE: ['BASE'],
        C5_HPHC: ['HP', 'HC'],
        C4: ['HPH', 'HCH', 'HPE', 'HCE'],
        C3: ['P', 'HPH', 'HCH', 'HPE', 'HCE'],
    };

    /** Mois de pointe (0 = janvier) : décembre, janvier, février — définition existante du code. */
    const MOIS_POINTE = [11, 0, 1];
    /** Heures de pointe par défaut : 08h-10h et 18h-20h (calcul horosaisonnier existant), modifiables. */
    const HEURES_POINTE_DEFAUT = [8, 9, 18, 19];

    function frisePointeDefaut() {
        const f = Array(24).fill(false);
        HEURES_POINTE_DEFAUT.forEach((h) => { f[h] = true; });
        return f;
    }

    /** Frise HC par défaut : celle de Turpe7Manager (23h-04h + 12h-15h) si chargé, sinon la même en dur. */
    function friseHcDefaut() {
        if (window.Turpe7Manager && typeof window.Turpe7Manager.generateDefaultTurpe7Config === 'function') {
            return window.Turpe7Manager.generateDefaultTurpe7Config();
        }
        const f = Array(24).fill(false);
        [23, 0, 1, 2, 3, 12, 13, 14].forEach((h) => { f[h] = true; });
        return f;
    }

    /** Hiver tarifaire : novembre à mars (même définition que Turpe7Manager.getSaison). */
    function estHiver(mois) {
        return mois >= 10 || mois <= 2;
    }

    /**
     * Plage tarifaire d'un instant en heure murale.
     * @param {string} tarif        C5_BASE | C5_HPHC | C4 | C3
     * @param {number} mois         0-11
     * @param {number} jourSemaine  0 (dimanche) - 6
     * @param {number} heure        0-23
     * @param {{hc_hours: boolean[], pointe_hours: boolean[]}} config  frises HC et pointe
     */
    function classerPlage(tarif, mois, jourSemaine, heure, config) {
        if (tarif === 'C5_BASE') return 'BASE';
        const hc = !!(config && config.hc_hours && config.hc_hours[heure]);
        if (tarif === 'C5_HPHC') return hc ? 'HC' : 'HP';
        if (tarif === 'C3') {
            const pointeHeure = !!(config && config.pointe_hours && config.pointe_hours[heure]);
            if (pointeHeure && MOIS_POINTE.includes(mois) && jourSemaine !== 0) return 'P';
        }
        if (estHiver(mois)) return hc ? 'HCH' : 'HPH';
        return hc ? 'HCE' : 'HPE';
    }

    /** Instant (ms UTC) du changement d'heure UE : dernier dimanche du mois, 01:00 UTC (miroir de rapport.js). */
    function dernierDimancheUtc(annee, mois) {
        const d = new Date(Date.UTC(annee, mois + 1, 0, 1, 0));
        d.setUTCDate(d.getUTCDate() - d.getUTCDay());
        return d.getTime();
    }

    /**
     * Fabrique « index de pas -> {mois, jourSemaine, heure} en heure murale ».
     * - utc1 = false : la série est en heure murale (position i = 01/01 00:00 + i pas) ;
     * - utc1 = true  : la série est en UTC+1 fixe (autoconsommation) ; pendant l'heure d'été,
     *   l'instant UTC+1 t est vécu à t + 1 h (cf. heure_locale_vers_utc1, calage_horaire.py).
     */
    function horlogeMurale(annee, pasMin, utc1) {
        const origine = Date.UTC(annee, 0, 1);
        const debutEte = dernierDimancheUtc(annee, 2);
        const finEte = dernierDimancheUtc(annee, 9);
        return function (i) {
            let t = origine + i * pasMin * 60000;
            if (utc1) {
                const instantUtc = t - MS_HEURE;
                t = instantUtc + ((instantUtc >= debutEte && instantUtc < finEte) ? 2 : 1) * MS_HEURE;
            }
            const d = new Date(t);
            return { mois: d.getUTCMonth(), jourSemaine: d.getUTCDay(), heure: d.getUTCHours() };
        };
    }

    /**
     * Ventile des séries de puissance (kW, même grille) par plage tarifaire, en kWh.
     * @param {Object<string, number[]>} series  ex. { irve: [...], pv: [...] }
     * @param {{annee:number, pasMin:number, utc1:boolean, tarif:string, config:Object}} opts
     * @returns {{plages: string[], kwh: Object<string, Object<string, number>>, totaux: Object<string, number>}}
     *          kwh[plage][nomSerie] ; totaux[nomSerie]
     */
    function ventiler(series, opts) {
        const plages = PLAGES_PAR_TARIF[opts.tarif] || PLAGES_PAR_TARIF.C5_BASE;
        const noms = Object.keys(series);
        const kwh = {};
        plages.forEach((p) => { kwh[p] = {}; noms.forEach((n) => { kwh[p][n] = 0; }); });
        const totaux = {};
        noms.forEach((n) => { totaux[n] = 0; });
        const n = noms.length ? Math.max(...noms.map((k) => series[k].length)) : 0;
        const dt = opts.pasMin / 60;
        const horloge = horlogeMurale(opts.annee, opts.pasMin, !!opts.utc1);
        for (let i = 0; i < n; i++) {
            const m = horloge(i);
            const plage = classerPlage(opts.tarif, m.mois, m.jourSemaine, m.heure, opts.config);
            for (const nom of noms) {
                const e = (Number(series[nom][i]) || 0) * dt;
                kwh[plage][nom] += e;
                totaux[nom] += e;
            }
        }
        return { plages, kwh, totaux };
    }

    // -----------------------------------------------------------------------------------------
    // Contrôle de cohérence avec le bilan énergétique IRVE (miroir de app/services/irve_controle.py)
    // -----------------------------------------------------------------------------------------

    const TOLERANCE_ABSOLUE_KWH = 0.1;
    const TOLERANCE_RELATIVE = 1e-6;

    /** Vrai si `calculeKwh` est égal au bilan `bilanKwh` (arrondis flottants seulement). */
    function ecartAdmis(calculeKwh, bilanKwh) {
        const a = Number(calculeKwh), b = Number(bilanKwh);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
        return Math.abs(a - b) <= Math.max(TOLERANCE_ABSOLUE_KWH, Math.abs(b) * TOLERANCE_RELATIVE);
    }

    function energieKwh(valeurs, pasMin) {
        let s = 0;
        for (let i = 0; i < valeurs.length; i++) s += Number(valeurs[i]) || 0;
        return s * pasMin / 60;
    }

    // -----------------------------------------------------------------------------------------
    // Étude économique
    // -----------------------------------------------------------------------------------------

    function finance() {
        const F = window.PompageSolaireCalculs;
        if (!F || typeof F.van !== 'function' || typeof F.tri !== 'function' || typeof F.anneeRetour !== 'function') {
            throw new Error('outils financiers indisponibles');
        }
        return F;
    }

    function arrondi(v, d) {
        const k = Math.pow(10, d);
        return Math.round(v * k) / k;
    }

    /**
     * Flux annuels et indicateurs de rentabilité du projet IRVE.
     *
     * Notations (par plage p, année t = 1..N) :
     *   PV_p,t     = PV_p x (1 - dégradation)^(t-1)            énergie PV consommée par les bornes
     *   Rés_p,t    = IRVE_p - PV_p,t                            énergie soutirée au réseau
     *   idxÉlec_t  = (1 + évolution prix élec)^(t-1)
     *   Coût réseau_t   = Σ Rés_p,t x prix_p x idxÉlec_t
     *   Économie PV_t   = Σ PV_p,t x prix_p x idxÉlec_t         facture réseau évitée grâce au PV
     *   Manque surplus_t = PV_t x prix de vente du surplus       (option « vente de surplus » : le kWh
     *                      consommé par les bornes n'est plus vendu ; tarif contractuel, non indexé)
     *   E utile    = IRVE x rendement de recharge               kWh délivrés aux véhicules
     *   Valeur_t   : - recharge payante : E utile x prix de vente x idxVente_t x (1 - commission)
     *                - flotte interne   : E utile x prix de la recharge de référence x idxVente_t
     *                - sans recharge payante : carburant évité (km = E utile / conso VE) x idxCarburant_t
     *                                          + entretien évité x idxInflation_t
     *   Charges_t  = OPEX bornes x idxInflation_t (+ OPEX PV si le PV est à financer)
     *   Rempl._t   = CAPEX bornes x % remplacement x idxInflation_t, aux années multiples de la durée de
     *                vie strictement inférieures à l'horizon
     *   Flux_0     = -(CAPEX - aides) [- CAPEX PV si le PV est à financer]
     *   Flux_t     = Valeur_t - Coût réseau_t - Manque surplus_t - Charges_t - Rempl._t
     *
     * Indicateurs : VAN au taux d'actualisation, TRI, temps de retour simple et actualisé, coût
     * actualisé du kWh rechargé = (investissement net + Σ coûts actualisés) / Σ E utile actualisée.
     *
     * @param {Object} p        paramètres validés (cf. REGLES de rentabilite_irve_section.js)
     * @param {{plages:string[], irve:Object<string,number>, pv:Object<string,number>}} energie  kWh/an année 1
     */
    function calculerRentabilite(p, energie) {
        const F = finance();
        const N = p.horizon;
        const pct = (v) => (Number(v) || 0) / 100;
        const plages = energie.plages;
        const irveTotal = plages.reduce((s, k) => s + (energie.irve[k] || 0), 0);
        const pvTotal1 = plages.reduce((s, k) => s + (energie.pv[k] || 0), 0);
        const eUtile = irveTotal * pct(p.rendement);
        const pvAFinancer = p.pv_financement === 'a_financer';
        const venteSurplus = p.surplus === 'vente';

        const capexBornes = p.capex_bornes;
        const capexTotal = p.capex_bornes + p.capex_installation + p.capex_raccordement + p.capex_gc + p.capex_etudes;
        const aides = p.aide_advenir + p.aide_autres;
        const investissement = capexTotal - aides + (pvAFinancer ? p.capex_pv : 0);
        const opexBornes = p.opex_maintenance + p.opex_supervision + p.opex_abonnement;
        const taux = pct(p.actualisation);

        const lignes = [{
            annee: 0, valeur: 0, cout_reseau: 0, economie_pv: 0, manque_surplus: 0, charges: 0, remplacement: 0,
            flux: -investissement, cumul: -investissement, flux_actualise: -investissement, cumul_actualise: -investissement,
            pv_kwh: 0, reseau_kwh: 0,
        }];
        const flux = [-investissement];
        let coutsActualises = 0;
        let energieActualisee = 0;

        for (let t = 1; t <= N; t++) {
            const facteurPv = Math.pow(1 - pct(p.degradation), t - 1);
            const idxElec = Math.pow(1 + pct(p.evol_elec), t - 1);
            const idxVente = Math.pow(1 + pct(p.evol_vente), t - 1);
            const idxInfl = Math.pow(1 + pct(p.inflation), t - 1);
            const idxCarb = Math.pow(1 + pct(p.evol_carburant), t - 1);

            let coutReseau = 0, economiePv = 0, pvKwh = 0, reseauKwh = 0;
            plages.forEach((k) => {
                const pvK = (energie.pv[k] || 0) * facteurPv;
                const resK = Math.max(0, (energie.irve[k] || 0) - pvK);
                const prix = p.prix[k] * idxElec;
                coutReseau += resK * prix;
                economiePv += pvK * prix;
                pvKwh += pvK;
                reseauKwh += resK;
            });
            const manqueSurplus = venteSurplus ? pvKwh * p.prix_surplus : 0;

            let valeur;
            if (p.modele === 'payante') {
                valeur = eUtile * p.prix_vente * idxVente * (1 - pct(p.commission));
            } else if (p.modele === 'flotte') {
                valeur = eUtile * p.prix_reference * idxVente;
            } else {
                const km = p.conso_ve > 0 ? eUtile / p.conso_ve * 100 : 0;
                valeur = km * p.conso_th / 100 * p.prix_carburant * idxCarb + p.entretien_evite * idxInfl;
            }

            const charges = opexBornes * idxInfl + (pvAFinancer ? p.opex_pv * idxInfl : 0);
            const remplacement = (t % p.duree_vie === 0 && t < N) ? capexBornes * pct(p.remplacement) * idxInfl : 0;
            const f = valeur - coutReseau - manqueSurplus - charges - remplacement;
            const actu = Math.pow(1 + taux, t);
            const precedente = lignes[t - 1];
            lignes.push({
                annee: t, valeur, cout_reseau: coutReseau, economie_pv: economiePv, manque_surplus: manqueSurplus,
                charges, remplacement, flux: f, cumul: precedente.cumul + f,
                flux_actualise: f / actu, cumul_actualise: precedente.cumul_actualise + f / actu,
                pv_kwh: pvKwh, reseau_kwh: reseauKwh,
            });
            flux.push(f);
            coutsActualises += (coutReseau + manqueSurplus + charges + remplacement) / actu;
            energieActualisee += eUtile / actu;
        }

        const tri = F.tri(flux);
        const retour = F.anneeRetour(lignes, 'cumul', 'flux');
        const retourActualise = F.anneeRetour(lignes, 'cumul_actualise', 'flux_actualise');
        const a1 = lignes[1] || {};
        return {
            lignes,
            indicateurs: {
                horizon: N,
                capex_total: capexTotal,
                aides,
                investissement,
                irve_kwh: irveTotal,
                pv_kwh: pvTotal1,
                reseau_kwh: Math.max(0, irveTotal - pvTotal1),
                utile_kwh: eUtile,
                couverture_pv_pct: irveTotal > 0 ? pvTotal1 / irveTotal * 100 : 0,
                economie_pv_an1: (a1.economie_pv || 0) - (a1.manque_surplus || 0),
                flux_an1: a1.flux || 0,
                cumul_final: lignes[N].cumul,
                van: arrondi(F.van(flux, taux), 2),
                tri_pct: tri === null ? null : tri * 100,
                retour_ans: retour,
                retour_actualise_ans: retourActualise,
                cout_kwh_recharge: energieActualisee > 0 ? (investissement + coutsActualises) / energieActualisee : null,
            },
        };
    }

    /**
     * Clé localStorage propre à l'utilisateur ET au projet actif vérifiés par le serveur (même
     * principe que le système hybride) ; null sans projet actif (persistance inactive).
     */
    function cleStockageProjet(prefixe) {
        let projet = window.ACTIVE_PROJECT_ID_VERIFIE;
        if (!projet) {
            try { projet = localStorage.getItem('current_projet_id'); } catch (e) { projet = null; }
        }
        if (!projet) return null;
        const u = window.ACTIVE_USER_ID;
        const utilisateur = u === null || u === undefined || u === '' ? 'anonyme' : String(u).replace(/[^A-Za-z0-9-]/g, '');
        return `${prefixe}${utilisateur}_${String(projet).replace(/[^A-Za-z0-9-]/g, '')}`;
    }

    window.RentabiliteIrveCalculs = {
        PLAGES, PLAGES_PAR_TARIF, MOIS_POINTE, HEURES_POINTE_DEFAUT,
        friseHcDefaut, frisePointeDefaut, estHiver, classerPlage, horlogeMurale, ventiler,
        ecartAdmis, energieKwh, calculerRentabilite, cleStockageProjet,
    };
})();
