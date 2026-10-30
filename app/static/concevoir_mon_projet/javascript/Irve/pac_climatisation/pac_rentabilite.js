/**
 * Module PAC / climatiseur — étude de rentabilité (phase 3).
 * ==========================================================
 * Fonctions pures (window.PacRentabilite, ou require sous Node). Comparaison de la PAC simulée avec
 * un système de référence qui fournirait EXACTEMENT la même énergie utile (chaleur de chauffage,
 * chaleur d'ECS entrée dans le ballon, froid), pas de temps par pas de temps :
 *
 *   énergie finale de référence = énergie utile / rendement saisonnier de génération (PCI)
 *   gaz facturé (PCS)           = énergie PCI × (PCS / PCI)
 *   fioul (L)                   = énergie PCI / PCI du fioul par litre
 *
 * Les convecteurs suivent le profil horaire du chauffage simulé ; le chauffe-eau électrique de
 * référence chauffe en heures creuses ; le climatiseur de référence suit le profil du froid (÷ SEER).
 * Pertes du ballon : comprises dans la chaleur d'ECS des deux côtés (même ballon supposé).
 *
 * Flux annuels (année t = 1..N, indices de prix idx_t = (1 + évolution)^(t-1)) :
 *   Coût PAC_t   = (Σ_p E_PAC,p × prix_p − PV_t × prix moyen PAC) × idxÉlec_t
 *                  + PV_t × prix de vente du surplus (manque à gagner, non indexé)
 *                  + surcoût d'abonnement électrique × idxÉlec_t + entretien PAC × idxInfl_t
 *   PV_t         = min(E_PAC, PV consommé par la PAC × (1 − dégradation)^(t-1))
 *                  valorisé au prix moyen du kWh PAC (hypothèse : la répartition du PV entre plages
 *                  tarifaires n'est pas connue ici)
 *   Coût réf._t  = Σ_p E_réf,p × prix_p × idxÉlec_t + gaz PCS × prix gaz × idxGaz_t
 *                  + abonnement gaz résilié × idxGaz_t + fioul × prix fioul × idxFioul_t
 *                  + entretien de référence × idxInfl_t
 *   Rempl._t     = matériel PAC × % de remplacement × idxInfl_t, aux années multiples de la durée de
 *                  vie strictement inférieures à l'horizon
 *   Flux_0       = −(matériel + travaux − aides − remplacement évité du système existant)
 *   Flux_t       = Coût réf._t − Coût PAC_t − Rempl._t
 *
 * Indicateurs : VAN, TRI, temps de retour simple et actualisé (outils financiers communs,
 * PompageSolaireCalculs), coût global actualisé de chaque solution, émissions de CO2 de l'année 1.
 * Miroir Python et test de parité : étape suivante du plan (non faits).
 */
(function (racine) {
    'use strict';

    const USAGES_PAC = ['eChauffage', 'eFroid', 'eEcs', 'eAppoint', 'eAuxiliaires'];

    const trouver = (liste, id) => (liste || []).find((x) => x.id === id) || null;
    const pct = (v) => (Number(v) || 0) / 100;

    function finance() {
        const F = racine.PompageSolaireCalculs;
        if (!F || typeof F.van !== 'function' || typeof F.tri !== 'function' || typeof F.anneeRetour !== 'function') {
            throw new Error('outils financiers indisponibles');
        }
        return F;
    }

    /**
     * Puissance électrique de la PAC sur le périmètre comparé (kW par pas). Climatisation exclue :
     * seule sa consommation propre (eFroid) est retirée, les auxiliaires restent comptés.
     */
    function seriePac(sim, froidCompare) {
        const n = sim.eChauffage.length;
        const sortie = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            let t = 0;
            USAGES_PAC.forEach((k) => { if (k !== 'eFroid' || froidCompare) t += sim[k][i]; });
            sortie[i] = t;
        }
        return sortie;
    }

    /**
     * Consommation du système de référence pour la même énergie utile.
     * @param {Object} sim     sortie de PacSimulation.simuler (kW par pas)
     * @param {number} pasMin
     * @param {{chauffage:string, ecs:string, froid:string, seer:number, rendementChauffage?:number, rendementEcs?:number}} choix
     *        froid : 'exclu' (climatisation hors comparaison) | 'clim' (climatiseur existant, SEER)
     * @param {Object} ref     donnees/rentabilite.json
     */
    function consommationReference(sim, pasMin, choix, ref) {
        const dtH = pasMin / 60;
        const sys = trouver(ref.systemes_chauffage, choix.chauffage) || ref.systemes_chauffage[0];
        const etaCh = choix.rendementChauffage > 0 ? choix.rendementChauffage : sys.rendement;
        // Sans chaudière de référence, l'ECS est forcément électrique.
        const ecsElec = sys.energie === 'elec' || choix.ecs === 'electrique';
        const sysEcs = trouver(ref.systemes_ecs, ecsElec ? 'electrique' : 'chaudiere');
        const etaEcs = !ecsElec && choix.rendementEcs > 0 ? choix.rendementEcs : sysEcs.rendement;
        const seer = choix.froid === 'clim' && choix.seer > 0 ? choix.seer : null;

        const n = sim.eChauffage.length;
        const elecSerie = new Float64Array(n);
        const utile = { chauffage: 0, ecs: 0, froid: 0 };
        let combustibleCh = 0; let combustibleEcs = 0; let elecEcsKwh = 0; let elecChKwh = 0; let elecFroidKwh = 0;
        for (let i = 0; i < n; i++) {
            const qCh = sim.qChauffagePac[i] + sim.qChauffageAppoint[i];
            const qEcs = sim.qEcsPac[i] + sim.qEcsResistance[i];
            const qFr = sim.qFroid[i];
            utile.chauffage += qCh * dtH;
            utile.ecs += qEcs * dtH;
            utile.froid += qFr * dtH;
            if (sys.energie === 'elec') { elecSerie[i] += qCh / etaCh; elecChKwh += qCh / etaCh * dtH; } else combustibleCh += qCh / etaCh * dtH;
            if (ecsElec) elecEcsKwh += qEcs / etaEcs * dtH; else combustibleEcs += qEcs / etaEcs * dtH;
            if (seer) { elecSerie[i] += qFr / seer; elecFroidKwh += qFr / seer * dtH; }
        }
        const pciKwh = combustibleCh + combustibleEcs;
        const conv = ref.conversions;
        return {
            systeme: sys,
            ecsElectrique: ecsElec,
            rendements: { chauffage: etaCh, ecs: etaEcs, seer },
            utile,
            elecSerie,          // convecteurs + climatiseur, au profil simulé (kW)
            elecEcsKwh,         // chauffe-eau électrique, placé en heures creuses
            elecChKwh,
            elecFroidKwh,
            combustiblePciKwh: { chauffage: combustibleCh, ecs: combustibleEcs, total: pciKwh },
            gazPcsKwh: sys.energie === 'gaz' ? pciKwh * conv.pcs_sur_pci_gaz_naturel : 0,
            fioulLitres: sys.energie === 'fioul' ? pciKwh / conv.fioul_kwh_pci_par_litre : 0,
            energie: sys.energie,
        };
    }

    /**
     * Émissions de CO2 de l'année 1 (kg). PAC : électricité soutirée au réseau seulement, par usage ;
     * le PV consommé par la PAC réduit chaque usage au prorata.
     * @param {Object} annuel   synthese(sim).annuel (kWh)
     * @param {number} partReseau  part de la consommation PAC (périmètre comparé) achetée au réseau, 0-1
     */
    function emissions(annuel, consoRef, froidCompare, partReseau, facteurs) {
        const pacCh = annuel.eChauffage + annuel.qChauffageAppoint + annuel.eAuxiliaires;
        const pacEcs = annuel.eEcs + annuel.qEcsResistance;
        const pacFr = froidCompare ? annuel.eFroid : 0;
        const pac = (pacCh * facteurs.elec_chauffage + pacEcs * facteurs.elec_ecs + pacFr * facteurs.elec_froid) * partReseau;
        const comb = consoRef.energie === 'gaz' ? facteurs.gaz : consoRef.energie === 'fioul' ? facteurs.fioul : 0;
        const ref = consoRef.elecChKwh * facteurs.elec_chauffage + consoRef.elecEcsKwh * facteurs.elec_ecs
            + consoRef.elecFroidKwh * facteurs.elec_froid + consoRef.combustiblePciKwh.total * comb;
        return { pac, ref, evite: ref - pac };
    }

    function arrondi(v, d) {
        const k = Math.pow(10, d);
        return Math.round(v * k) / k;
    }

    /**
     * Flux annuels et indicateurs (cf. en-tête).
     * @param {Object} p  paramètres validés : prix {plage: €/kWh}, prix_gaz, abonnement_gaz, resiliation_gaz,
     *                    prix_fioul, prix_surplus, surcout_abonnement, entretien_pac, entretien_ref,
     *                    capex_materiel, capex_travaux, aides, cout_evite, horizon, duree_vie, remplacement,
     *                    evol_elec, evol_gaz, evol_fioul, inflation, actualisation, degradation
     * @param {{plages:string[], pac:Object<string,number>, ref_elec:Object<string,number>, pv_kwh:number,
     *          gaz_pcs_kwh:number, fioul_litres:number, gaz:boolean}} e  énergies de l'année 1
     */
    function calculerRentabilite(p, e) {
        const F = finance();
        const N = p.horizon;
        const plages = e.plages;
        const somme = (o) => plages.reduce((s, k) => s + (o[k] || 0), 0);
        const coutPlages = (o) => plages.reduce((s, k) => s + (o[k] || 0) * (p.prix[k] || 0), 0);
        const pacKwh = somme(e.pac);
        const pacBrut = coutPlages(e.pac);
        const prixMoyPac = pacKwh > 0 ? pacBrut / pacKwh : 0;
        const refElecKwh = somme(e.ref_elec);
        const refElecCout = coutPlages(e.ref_elec);
        const investissement = p.capex_materiel + p.capex_travaux - p.aides - p.cout_evite;
        const taux = pct(p.actualisation);
        const abonnementGaz = e.gaz && p.resiliation_gaz ? p.abonnement_gaz : 0;

        const lignes = [{
            annee: 0, cout_ref: 0, cout_pac: 0, economie_pv: 0, remplacement: 0,
            flux: -investissement, cumul: -investissement, flux_actualise: -investissement, cumul_actualise: -investissement,
        }];
        const flux = [-investissement];
        let refActualise = 0;
        let pacActualise = investissement;

        for (let t = 1; t <= N; t++) {
            const idxElec = Math.pow(1 + pct(p.evol_elec), t - 1);
            const idxGaz = Math.pow(1 + pct(p.evol_gaz), t - 1);
            const idxFioul = Math.pow(1 + pct(p.evol_fioul), t - 1);
            const idxInfl = Math.pow(1 + pct(p.inflation), t - 1);
            const pvT = Math.min(pacKwh, (e.pv_kwh || 0) * Math.pow(1 - pct(p.degradation), t - 1));
            const economiePv = pvT * prixMoyPac * idxElec;
            const detail = {
                pac_energie: pacBrut * idxElec - economiePv,
                pac_surplus: pvT * p.prix_surplus,
                pac_abonnement: p.surcout_abonnement * idxElec,
                pac_entretien: p.entretien_pac * idxInfl,
                ref_energie: refElecCout * idxElec + e.gaz_pcs_kwh * p.prix_gaz * idxGaz + e.fioul_litres * p.prix_fioul * idxFioul,
                ref_abonnement: abonnementGaz * idxGaz,
                ref_entretien: p.entretien_ref * idxInfl,
            };
            const coutPac = detail.pac_energie + detail.pac_surplus + detail.pac_abonnement + detail.pac_entretien;
            const coutRef = detail.ref_energie + detail.ref_abonnement + detail.ref_entretien;
            const remplacement = (t % p.duree_vie === 0 && t < N) ? p.capex_materiel * pct(p.remplacement) * idxInfl : 0;
            const f = coutRef - coutPac - remplacement;
            const actu = Math.pow(1 + taux, t);
            const prec = lignes[t - 1];
            lignes.push({
                annee: t, cout_ref: coutRef, cout_pac: coutPac, economie_pv: economiePv, remplacement, ...detail,
                flux: f, cumul: prec.cumul + f, flux_actualise: f / actu, cumul_actualise: prec.cumul_actualise + f / actu,
                pv_kwh: pvT, reseau_kwh: pacKwh - pvT,
            });
            flux.push(f);
            refActualise += coutRef / actu;
            pacActualise += (coutPac + remplacement) / actu;
        }

        const tri = F.tri(flux);
        const a1 = lignes[1] || {};
        return {
            lignes,
            indicateurs: {
                horizon: N,
                investissement,
                pac_kwh: pacKwh,
                pv_kwh: Math.min(pacKwh, e.pv_kwh || 0),
                reseau_kwh: Math.max(0, pacKwh - (e.pv_kwh || 0)),
                prix_moyen_pac: prixMoyPac,
                ref_elec_kwh: refElecKwh,
                ref_gaz_pcs_kwh: e.gaz_pcs_kwh,
                ref_fioul_litres: e.fioul_litres,
                cout_ref_an1: a1.cout_ref || 0,
                cout_pac_an1: a1.cout_pac || 0,
                economie_an1: (a1.cout_ref || 0) - (a1.cout_pac || 0),
                economie_pv_an1: a1.economie_pv || 0,
                cumul_final: lignes[N].cumul,
                cout_global_ref: refActualise,
                cout_global_pac: pacActualise,
                van: arrondi(F.van(flux, taux), 2),
                tri_pct: tri === null ? null : tri * 100,
                retour_ans: F.anneeRetour(lignes, 'cumul', 'flux'),
                retour_actualise_ans: F.anneeRetour(lignes, 'cumul_actualise', 'flux_actualise'),
            },
        };
    }

    /** Investissement indicatif selon le type et le nombre d'unités intérieures (donnees/rentabilite.json). */
    function investissementDefaut(type, nbUnites, ref) {
        const d = ref.investissement_defaut;
        const n = Math.max(1, Math.round(Number(nbUnites) || 1));
        if (type === 'air_eau') return d.air_eau;
        if (type === 'clim') return d.clim_premiere_unite + (n - 1) * d.clim_unite_supplementaire;
        return d.air_air_premiere_unite + (n - 1) * d.air_air_unite_supplementaire;
    }

    const api = { seriePac, consommationReference, emissions, calculerRentabilite, investissementDefaut };
    racine.PacRentabilite = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
