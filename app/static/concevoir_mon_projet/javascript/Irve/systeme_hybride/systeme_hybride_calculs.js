/**
 * Système hybride — calculs (sans DOM).
 * ======================================================================================
 * Reprise du simulateur autonome « HybridSim Pro » (systeme_hybride.js, page HTML complète), pour
 * les deux architectures hybrides :
 *  - « pv_gen »      : Hybride PV + Groupe électrogène ;
 *  - « pv_gen_bess » : Hybride PV + Batteries (BESS) + Groupe électrogène.
 *
 * Corrections apportées au code d'origine :
 *  - kVA / kW : la charge minimale du groupe et le plafond d'injection PV étaient calculés en % de la
 *    puissance APPARENTE (kVA) puis comparés à des puissances ACTIVES (kW). Tout est désormais en kW,
 *    via cos φ = 0,8 (le facteur déjà implicite dans la limite de soutirage 1,10 x 0,8 x kVA).
 *  - Pas de temps : une courbe importée au pas 30 ou 15 min était sommée comme des kWh horaires
 *    (énergies x2 ou x4) et le planning du groupe (24 cases horaires) indexé par i % 24 au lieu de
 *    l'heure réelle. Les énergies sont maintenant multipliées par la durée du pas.
 *  - Carburant : consommation linéaire en charge (modèle de Willans : à vide + marginale), au lieu
 *    de 0,265 L/kWh fixe. La référence « groupe seul » ne compte plus les heures où le groupe est
 *    arrêté (les charges critiques n'y sont pas servies par du gasoil).
 *  - CO₂ évité : carburant économisé x facteur d'émission du gasoil (kgCO₂/L). L'ancienne formule
 *    soustrayait des émissions diesel (kg/L) d'une référence en kg/kWh.
 *  - « Énergie bridée » : on n'y retranche plus un « déficit des charges critiques récupéré par
 *    l'UPS » ; l'énergie non servie est affichée à part.
 *  - Batteries : l'original chargeait/déchargeait sans rendement ni limite de puissance du
 *    convertisseur, démarrait à 60 % de SoC arbitraire, et injectait tout le surplus du groupe dans la
 *    batterie sans vérifier la place disponible. Ici : rendement aller-retour, SoC minimal, puissance
 *    du convertisseur, SoC initial en régime établi (journée type répétée jusqu'à convergence).
 *  - Taux de couverture : part de la consommation servie SANS le groupe (PV direct + batterie), et
 *    non plus « PV injecté / demande », qui comptait la recharge de la batterie comme consommée.
 *  - Analyse économique : horizon fixe de 20 ans, indépendant de la maturité de la dette ; annuité
 *    payée sur la seule maturité ; TRI par dichotomie (Newton divergeait ou renvoyait 0 % sans
 *    prévenir) ; chaque année est re-simulée avec le PV et la batterie dégradés (la dégradation
 *    n'était appliquée qu'à l'économie de carburant, de façon proportionnelle, et pas à la batterie).
 *  - « Cible taux de couverture » : n'intervenait dans aucun calcul. Elle sert désormais au
 *    prédimensionnement : puissance PV nécessaire pour l'atteindre, ou couverture maximale atteignable.
 */
(function (racine) {
    'use strict';

    const COS_PHI = 0.8;
    const SURCHARGE_ADMISSIBLE = 1.10;     // soutirage maximal = 110 % de la puissance active du groupe
    const DUREE_ANALYSE_ANS = 20;
    const ANNEE_REMPLACEMENT = 10;
    const ARCHITECTURES = {
        pv_gen: 'Hybride PV + Groupe électrogène',
        pv_gen_bess: 'Hybride PV + Batteries (BESS) + Groupe électrogène',
    };

    // Profil solaire d'une journée type (coefficients horaires, 0 h -> 23 h), mis à l'échelle du
    // productible spécifique : énergie journalière = productible / 365 par kWc.
    const PROFIL_SOLAIRE = [0, 0, 0, 0, 0, 0, 1.2, 5, 9.5, 12.5, 15, 16.5, 16, 13, 8.5, 4, 1.5, 0.8, 0, 0, 0, 0, 0, 0];
    const SOMME_PROFIL_SOLAIRE = PROFIL_SOLAIRE.reduce((a, b) => a + b, 0);

    // Répartition horaire de la consommation journalière (%, total 100).
    const PROFIL_CHARGE_DEFAUT = [2.2, 2.2, 2.2, 2.2, 2.2, 2.2, 3.6, 3.6, 6.9, 6.9, 6.9, 6.9, 4.8, 4.8, 6.2, 6.2, 6.2, 4.2, 4.2, 4.2, 2.8, 2.8, 2.8, 2.8];

    /** Pas par heure d'une courbe importée, déduit du nombre de points (1 an = 8 760 h). */
    function pasParHeure(nbPoints) {
        if (nbPoints > 18000) return 4;  // 15 min
        if (nbPoints > 9000) return 2;   // 30 min
        return 1;
    }

    function puissanceActiveGroupe(genKva) { return genKva * COS_PHI; }

    /** Soutirage maximal admissible par le groupe (kW). */
    function limiteSoutirage(genKva) { return SURCHARGE_ADMISSIBLE * puissanceActiveGroupe(genKva); }

    function productionHoraireParKwc(productible) {
        return PROFIL_SOLAIRE.map((c) => c * productible / (365 * SOMME_PROFIL_SOLAIRE));
    }

    /** Courbe de charge simulée (kW) : courbe importée, sinon profil horaire mis à l'échelle de la pointe. */
    function courbeDeCharge(p) {
        if (p.courbe && p.courbe.length) return p.courbe;
        const maxF = Math.max(...p.profilHoraire) || 1;
        return p.profilHoraire.map((f) => p.chargePointeKw * f / maxF);
    }

    /** Une passe de simulation sur la courbe, à partir d'un état de charge initial (kWh). */
    function passe(p, charge, pas, socInitial) {
        const dt = 1 / pas;
        const bess = p.architecture === 'pv_gen_bess' && p.batKwh > 0;
        const genKw = puissanceActiveGroupe(p.genKva);
        const geMax = limiteSoutirage(p.genKva);
        const pMin = (p.chargeMinPct / 100) * genKw;
        const pvMax = (1 - p.chargeMinPct / 100) * genKw;   // stabilité sans stockage : part PV maximale
        const prodKwc = productionHoraireParKwc(p.productible);
        const capacite = bess ? p.batKwh : 0;
        const socMin = capacite * (bess ? p.socMinPct / 100 : 0);
        const eta = bess ? Math.sqrt(p.rendementBatteriePct / 100) : 1;   // rendement par sens
        const pcs = bess ? p.pcsKw : 0;
        let soc = bess ? Math.min(capacite, Math.max(socMin, socInitial)) : 0;

        const charger = (kw) => {
            const place = Math.max(0, capacite - soc) / (eta * dt);
            const c = Math.max(0, Math.min(kw, pcs, place));
            soc += c * eta * dt;
            return c;
        };
        const decharger = (kw) => {
            const dispo = Math.max(0, soc - socMin) * eta / dt;
            const d = Math.max(0, Math.min(kw, pcs, dispo));
            soc -= d / eta * dt;
            return d;
        };

        const s = {
            pv: [], ge: [], bride: [], critique: [], demande: [], decharge: [], charge: [], soc: [],
            pas, dt, nbPoints: charge.length, bess, genKw, pMin, pvMax, geMax, capacite,
            energieDemandeeKwh: 0, energiePvPotentielleKwh: 0, energiePvUtileKwh: 0, energieGeKwh: 0,
            energieGeVersChargeKwh: 0, energieBrideeKwh: 0, energieNonServieKwh: 0, energieChargeeKwh: 0,
            energieDechargeeKwh: 0, carburantL: 0, carburantReferenceL: 0, heuresGe: 0, heuresSousCharge: 0,
            pointeKw: 0, socInitialKwh: soc,
        };

        for (let i = 0; i < charge.length; i++) {
            const h = Math.floor(i / pas) % 24;
            const geAutorise = p.etatGE[h] !== false;
            const pvPot = p.pvKwc * prodKwc[h];
            // Groupe arrêté (planning) : seules les charges critiques sont alimentées.
            const demande = geAutorise ? Math.max(0, Number(charge[i]) || 0) : p.chargeCritiqueKw;
            let pvUtile = 0; let ge = 0; let geVersCharge = 0; let nonServi = 0; let c = 0; let d = 0;

            if (!bess) {
                if (geAutorise) {
                    // Le PV ne peut ni faire descendre le groupe sous sa charge minimale, ni dépasser la
                    // part maximale assurant la stabilité de fréquence.
                    pvUtile = Math.max(0, Math.min(pvPot, demande - pMin, pvMax));
                    ge = demande - pvUtile;
                    if (ge > geMax) { nonServi = ge - geMax; ge = geMax; }
                    geVersCharge = ge;
                    if (demande < pMin) s.heuresSousCharge += dt;
                } else {
                    pvUtile = Math.min(pvPot, demande);
                    nonServi = demande - pvUtile;
                }
            } else if (pvPot >= demande) {
                // PV suffisant : surplus vers la batterie, reste bridé.
                c = charger(pvPot - demande);
                pvUtile = demande + c;
            } else {
                const besoin = demande - pvPot;
                pvUtile = pvPot;
                const socAvant = soc;
                d = decharger(besoin);
                if (besoin - d > 1e-9) {
                    if (geAutorise) {
                        // Le groupe doit démarrer : il suit la charge (au moins sa charge minimale), la
                        // batterie est préservée et ne couvre que ce qui dépasse la capacité du groupe.
                        soc = socAvant; d = 0;
                        ge = Math.min(Math.max(besoin, pMin), geMax);
                        if (ge < besoin) { d = decharger(besoin - ge); nonServi = besoin - ge - d; }
                        geVersCharge = Math.min(ge, besoin);
                        let surplus = ge - geVersCharge;
                        if (surplus > 0) {
                            c = charger(surplus);
                            surplus -= c;
                            // Surplus résiduel (charge minimale) : on bride le PV pour le résorber ; s'il
                            // n'y a plus de PV, il part en charge de dissipation (carburant compté).
                            pvUtile -= Math.min(surplus, pvUtile);
                        }
                    } else {
                        nonServi = besoin - d;
                    }
                }
            }

            if (ge > 0) {
                s.carburantL += (p.consoVide * genKw + p.consoMarginale * ge) * dt;
                s.heuresGe += dt;
            }
            if (geAutorise) {
                s.carburantReferenceL += (p.consoVide * genKw + p.consoMarginale * Math.min(demande, geMax)) * dt;
            }
            s.pv.push(pvUtile);
            s.ge.push(ge);
            s.bride.push(Math.max(0, pvPot - pvUtile));
            s.critique.push(geAutorise ? 0 : demande);
            s.demande.push(demande);
            s.decharge.push(d);
            s.charge.push(c);
            s.soc.push(capacite > 0 ? (soc / capacite) * 100 : 0);
            s.pointeKw = Math.max(s.pointeKw, demande);
            s.energieDemandeeKwh += demande * dt;
            s.energiePvPotentielleKwh += pvPot * dt;
            s.energiePvUtileKwh += pvUtile * dt;
            s.energieGeKwh += ge * dt;
            s.energieGeVersChargeKwh += geVersCharge * dt;
            s.energieBrideeKwh += Math.max(0, pvPot - pvUtile) * dt;
            s.energieNonServieKwh += nonServi * dt;
            s.energieChargeeKwh += c * dt;
            s.energieDechargeeKwh += d * dt;
        }
        s.socFinalKwh = soc;
        return s;
    }

    /**
     * Simulation au pas de la courbe (1 h pour le profil journalier).
     * p : { architecture, pvKwc, productible, genKva, chargeMinPct, chargePointeKw, profilHoraire[24],
     *       etatGE[24], chargeCritiqueKw, courbe (kW, facultatif), consoVide (L/h par kW nominal),
     *       consoMarginale (L/kWh), co2Gasoil (kgCO₂/L), batKwh, pcsKw, socMinPct, rendementBatteriePct }
     */
    function simuler(p) {
        const charge = courbeDeCharge(p);
        const importee = !!(p.courbe && p.courbe.length);
        const pas = importee ? pasParHeure(charge.length) : 1;
        const bess = p.architecture === 'pv_gen_bess' && p.batKwh > 0;
        // SoC initial en régime établi : la journée type (ou la période importée) est rejouée en
        // repartant du SoC final, jusqu'à ce qu'il se stabilise.
        // Le régime établi peut être un cycle de plusieurs jours (une nuit couverte par la batterie, la
        // suivante par le groupe) : les totaux sont alors la moyenne de 14 jours consécutifs.
        let soc = bess ? p.batKwh * (0.5 + p.socMinPct / 200) : 0;
        let s = passe(p, charge, pas, soc);
        let converge = !bess;
        for (let k = 0; bess && k < (importee ? 2 : 60); k++) {
            if (Math.abs(s.socFinalKwh - soc) < 1e-6 * Math.max(1, p.batKwh)) { converge = true; break; }
            soc = s.socFinalKwh;
            s = passe(p, charge, pas, soc);
        }
        if (!converge && !importee) {
            const JOURS = 14;
            const cles = Object.keys(s).filter((k) => /^(energie|carburant|heures)/.test(k));
            const somme = {};
            cles.forEach((k) => { somme[k] = s[k]; });
            for (let j = 1; j < JOURS; j++) {
                s = passe(p, charge, pas, s.socFinalKwh);
                cles.forEach((k) => { somme[k] += s[k]; });
            }
            cles.forEach((k) => { s[k] = somme[k] / JOURS; });
            s.joursMoyennes = JOURS;
        }

        s.importee = importee;
        s.architecture = bess ? 'pv_gen_bess' : 'pv_gen';
        s.heuresSimulees = s.nbPoints / pas;
        s.facteurAnnuel = importee ? 8760 / s.heuresSimulees : 365;
        const servie = s.energieDemandeeKwh - s.energieNonServieKwh;
        s.energieRenouvelableKwh = Math.max(0, servie - s.energieGeVersChargeKwh);
        s.tauxCouverturePct = s.energieDemandeeKwh > 0 ? (s.energieRenouvelableKwh / s.energieDemandeeKwh) * 100 : 0;
        s.tauxBridagePct = s.energiePvPotentielleKwh > 0 ? (s.energieBrideeKwh / s.energiePvPotentielleKwh) * 100 : 0;
        s.carburantEconomiseL = Math.max(0, s.carburantReferenceL - s.carburantL);
        s.co2EviteT = s.carburantEconomiseL * p.co2Gasoil / 1000;
        const utile = s.capacite * (1 - (p.socMinPct || 0) / 100);
        s.cyclesEquivalents = utile > 0 ? s.energieDechargeeKwh / utile : 0;
        const f = s.facteurAnnuel;
        s.annuel = {
            energieDemandeeKwh: s.energieDemandeeKwh * f,
            energiePvUtileKwh: s.energiePvUtileKwh * f,
            energieRenouvelableKwh: s.energieRenouvelableKwh * f,
            energieGeKwh: s.energieGeKwh * f,
            energieBrideeKwh: s.energieBrideeKwh * f,
            energieNonServieKwh: s.energieNonServieKwh * f,
            energieDechargeeKwh: s.energieDechargeeKwh * f,
            carburantL: s.carburantL * f,
            carburantEconomiseL: s.carburantEconomiseL * f,
            co2EviteT: s.co2EviteT * f,
            heuresGe: s.heuresGe * f,
            cyclesEquivalents: s.cyclesEquivalents * f,
        };
        return s;
    }

    /**
     * Puissance PV nécessaire pour atteindre la cible de couverture (dichotomie : la couverture croît
     * avec la puissance PV puis plafonne — charge minimale du groupe sans stockage, capacité de la
     * batterie avec stockage).
     */
    function puissancePourCible(p, ciblePct) {
        const couverture = (kwc) => simuler(Object.assign({}, p, { pvKwc: kwc })).tauxCouverturePct;
        const prodKwc = productionHoraireParKwc(p.productible).filter((v) => v > 0);
        const besoinMax = Math.max(limiteSoutirage(p.genKva), p.chargeCritiqueKw, 1);
        // Sans stockage, au-delà de kSaturation le PV dépasse la demande à toutes les heures
        // ensoleillées : la couverture ne bouge plus. Avec stockage, la batterie peut encore absorber
        // du surplus : on cherche plus loin.
        let kSaturation = prodKwc.length ? besoinMax / Math.min(...prodKwc) : 0;
        if (p.architecture === 'pv_gen_bess') kSaturation *= 10;
        const couvertureMaxPct = kSaturation > 0 ? couverture(kSaturation) : 0;
        if (ciblePct > couvertureMaxPct + 1e-6) {
            return { atteignable: false, couvertureMaxPct, pvKwc: null };
        }
        let bas = 0; let haut = kSaturation;
        for (let k = 0; k < 32; k++) {
            const mil = (bas + haut) / 2;
            if (couverture(mil) >= ciblePct) haut = mil; else bas = mil;
        }
        return { atteignable: true, couvertureMaxPct, pvKwc: Math.ceil(haut * 10) / 10 };
    }

    function van(taux, flux) {
        return flux.reduce((acc, f, t) => acc + f / Math.pow(1 + taux, t), 0);
    }

    /** TRI par dichotomie ; null si les flux ne changent pas de signe sur ]-99 % ; 1000 %]. */
    function tri(flux) {
        let bas = -0.99; let haut = 10;
        let vBas = van(bas, flux); const vHaut = van(haut, flux);
        if (!isFinite(vBas) || !isFinite(vHaut) || vBas * vHaut > 0) return null;
        for (let k = 0; k < 200; k++) {
            const mil = (bas + haut) / 2;
            const v = van(mil, flux);
            if (Math.abs(v) < 1e-7) return mil * 100;
            if (vBas * v < 0) haut = mil; else { bas = mil; vBas = v; }
        }
        return ((bas + haut) / 2) * 100;
    }

    /** Année (fractionnaire) où le cumul atteint l'investissement ; null au-delà de l'horizon. */
    function anneeRetour(cumuls, investissement) {
        let precedent = 0;
        for (let i = 0; i < cumuls.length; i++) {
            if (cumuls[i] >= investissement) {
                const pente = cumuls[i] - precedent;
                return i + (pente > 0 ? (investissement - precedent) / pente : 1);
            }
            precedent = cumuls[i];
        }
        return null;
    }

    /**
     * Analyse économique sur 20 ans. Gains : carburant économisé (indexé). Coûts : entretien PV
     * (indexé), remplacement des onduleurs PV et des batteries l'année 10. Chaque année est
     * re-simulée avec le PV dégradé (à partir de l'année 2) et la batterie vieillie (âge remis à zéro
     * après son remplacement).
     * p : paramètres de simuler() + degradationPct, degradationBatteriePct.
     * e : { capexWc, coutStockageKwh, maintenanceWc, remplacementWc, remplacementBatterieKwh,
     *       prixCarburant, indexCarburantPct, indexMaintenancePct, tauxActualisationPct, financement
     *       ('dette' | 'fonds_propres'), tauxInteretPct, partFondsPropresPct, maturiteAns }
     */
    function analyseEconomique(p, e) {
        const bess = p.architecture === 'pv_gen_bess' && p.batKwh > 0;
        const wc = p.pvKwc * 1000;
        const capexPv = wc * e.capexWc;
        const capexStockage = bess ? p.batKwh * e.coutStockageKwh : 0;
        const capex = capexPv + capexStockage;
        const r = e.tauxActualisationPct / 100;
        const dette = e.financement === 'dette';
        const fondsPropres = dette ? capex * e.partFondsPropresPct / 100 : capex;
        const pret = capex - fondsPropres;
        const ti = e.tauxInteretPct / 100;
        const maturite = dette ? Math.round(e.maturiteAns) : 0;
        let annuite = 0;
        if (pret > 0 && maturite > 0) annuite = ti > 0 ? pret * ti / (1 - Math.pow(1 + ti, -maturite)) : pret / maturite;

        const annees = [];
        const fluxProjet = [-capex];
        const fluxFondsPropres = [-fondsPropres];
        const cumulsSimples = [];
        const cumulsActualises = [];
        const cache = {};
        let cumul = 0; let cumulAct = 0; let coutsAct = 0; let energieActMwh = 0;

        for (let y = 1; y <= DUREE_ANALYSE_ANS; y++) {
            const fPv = Math.pow(1 - (p.degradationPct || 0) / 100, y - 1);
            const age = y <= ANNEE_REMPLACEMENT ? y - 1 : y - ANNEE_REMPLACEMENT - 1;
            const fBat = bess ? Math.pow(1 - (p.degradationBatteriePct || 0) / 100, age) : 1;
            const cle = `${fPv}|${fBat}`;
            const sim = cache[cle] || (cache[cle] = simuler(Object.assign({}, p, { pvKwc: p.pvKwc * fPv, batKwh: bess ? p.batKwh * fBat : 0 })));
            const carburantEconomiseL = sim.annuel.carburantEconomiseL;
            const gainCarburant = carburantEconomiseL * e.prixCarburant * Math.pow(1 + e.indexCarburantPct / 100, y - 1);
            const entretien = e.maintenanceWc * wc * Math.pow(1 + e.indexMaintenancePct / 100, y - 1);
            const remplacement = y === ANNEE_REMPLACEMENT ? e.remplacementWc * wc + (bess ? p.batKwh * e.remplacementBatterieKwh : 0) : 0;
            const net = gainCarburant - entretien - remplacement;
            const service = y <= maturite ? annuite : 0;
            const act = Math.pow(1 + r, -y);
            cumul += net;
            cumulAct += net * act;
            coutsAct += (entretien + remplacement) * act;
            energieActMwh += (sim.annuel.energieRenouvelableKwh / 1000) * act;
            fluxProjet.push(net);
            fluxFondsPropres.push(net - service);
            cumulsSimples.push(cumul);
            cumulsActualises.push(cumulAct);
            annees.push({
                annee: y, carburantEconomiseL, gainCarburant, entretien, remplacement, net,
                serviceDette: service, fluxFondsPropres: net - service, cumul, cumulActualise: cumulAct,
                tauxCouverturePct: sim.tauxCouverturePct,
            });
        }

        return {
            dureeAns: DUREE_ANALYSE_ANS,
            anneeRemplacement: ANNEE_REMPLACEMENT,
            capex, capexPv, capexStockage, fondsPropres, pret, annuite, interetAnnee1: pret * ti, maturite,
            van: cumulAct - capex,
            triProjetPct: tri(fluxProjet),
            triFondsPropresPct: dette ? (fondsPropres > 0 ? tri(fluxFondsPropres) : null) : tri(fluxProjet),
            retourSimpleAns: anneeRetour(cumulsSimples, capex),
            retourActualiseAns: anneeRetour(cumulsActualises, capex),
            economieNetteActualisee: cumulAct,
            opexActualise: coutsAct,
            lcoe: energieActMwh > 0 ? (capex + coutsAct) / energieActMwh : null,
            annees,
        };
    }

    /** Recommandations textuelles (sans balisage). */
    function recommandations(sim, p, cible) {
        const fr = (v, d) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
        const per = sim.importee ? 'période' : 'jour';
        const recos = [];
        if (cible) {
            if (!cible.atteignable) {
                recos.push(sim.bess
                    ? `La cible de couverture (${fr(p.ciblePct)} %) est hors de portée avec ce stockage (couverture maximale ${fr(cible.couvertureMaxPct, 1)} %) : augmenter la capacité des batteries ou la puissance du convertisseur.`
                    : `La cible de couverture (${fr(p.ciblePct)} %) est hors de portée sans stockage : la charge minimale du groupe limite la couverture à ${fr(cible.couvertureMaxPct, 1)} %. Envisager l'architecture avec batteries (BESS) ou réduire la cible.`);
            } else if (sim.tauxCouverturePct + 0.05 < p.ciblePct) {
                recos.push(`Couverture actuelle de ${fr(sim.tauxCouverturePct, 1)} % pour une cible de ${fr(p.ciblePct)} % : porter la puissance PV à environ ${fr(cible.pvKwc, 1)} kWc.`);
            } else {
                recos.push(`La cible de couverture (${fr(p.ciblePct)} %) est atteinte ; ${fr(cible.pvKwc, 1)} kWc suffiraient à l'atteindre.`);
            }
        }
        if (sim.tauxBridagePct > 20) {
            recos.push(sim.bess
                ? `${fr(sim.tauxBridagePct, 1)} % de la production PV est bridée (batteries pleines) : la capacité de stockage limite la valorisation du PV.`
                : `${fr(sim.tauxBridagePct, 1)} % de la production PV est bridée (charge minimale du groupe, stabilité) : la puissance PV est surdimensionnée pour un système sans stockage.`);
        }
        if (sim.heuresSousCharge > 0) {
            recos.push(`Le groupe fonctionne ${fr(sim.heuresSousCharge, 1)} h par ${per} sous sa charge minimale (${fr(sim.pMin, 1)} kW) : risque d'encrassement (« wet stacking »). Envisager un groupe plus petit, un délestage pilotable ou un stockage.`);
        }
        if (sim.pointeKw > 0 && sim.pointeKw < 0.4 * sim.genKw) {
            recos.push(`La pointe de consommation (${fr(sim.pointeKw, 1)} kW) est inférieure à 40 % de la puissance active du groupe (${fr(sim.genKw, 1)} kW) : groupe probablement surdimensionné.`);
        }
        if (sim.energieNonServieKwh > 0.0005) {
            recos.push(sim.bess
                ? `${fr(sim.energieNonServieKwh, 1)} kWh par ${per} ne sont pas servis (batteries vides groupe à l'arrêt, ou convertisseur / groupe insuffisant) : augmenter le stockage, la puissance du convertisseur ou les heures de marche du groupe.`
                : `${fr(sim.energieNonServieKwh, 1)} kWh par ${per} ne sont pas servis (charges critiques groupe à l'arrêt, ou dépassement de la capacité du groupe) : prévoir un onduleur formeur de réseau avec batterie (ou une alimentation sans interruption).`);
        }
        if (!sim.bess && p.etatGE.some((on) => on === false)) {
            recos.push("Groupe arrêté sur certaines plages : sans groupe ni batterie, le PV ne peut alimenter les charges critiques qu'avec un onduleur formeur de réseau.");
        }
        if (sim.bess) {
            recos.push(`Batteries : ${fr(sim.annuel.cyclesEquivalents)} cycles équivalents par an — à comparer à la durée de vie en cycles annoncée par le fabricant.`);
            if (sim.pointeKw > p.pcsKw) {
                recos.push(`La puissance du convertisseur (${fr(p.pcsKw, 1)} kW) est inférieure à la pointe (${fr(sim.pointeKw, 1)} kW) : le groupe doit démarrer à chaque pointe.`);
            }
        }
        recos.push(`Dimensionnement fondé sur un cos φ de ${fr(COS_PHI, 1)} (puissance active du groupe = ${fr(sim.genKw, 1)} kW) et une surcharge admissible de ${fr((SURCHARGE_ADMISSIBLE - 1) * 100)} %.`);
        return recos;
    }

    const api = {
        COS_PHI, SURCHARGE_ADMISSIBLE, DUREE_ANALYSE_ANS, ANNEE_REMPLACEMENT, ARCHITECTURES, PROFIL_SOLAIRE, PROFIL_CHARGE_DEFAUT,
        pasParHeure, puissanceActiveGroupe, limiteSoutirage, productionHoraireParKwc, courbeDeCharge,
        simuler, puissancePourCible, analyseEconomique, recommandations, tri, van,
    };
    racine.SystemeHybrideCalculs = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
