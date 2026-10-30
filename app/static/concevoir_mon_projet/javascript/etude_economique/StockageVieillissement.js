/**
 * Vieillissement du stockage sur la durée de l'étude économique.
 *
 * MIROIR EXACT de app/models/calcul_prodsolaire/vieillissement_stockage.py (documentation complète du
 * modèle là-bas) : toute modification doit être reportée dans les deux fichiers —
 * tests/etude_economique/test_vieillissement_stockage_js_py.py compare leurs résultats.
 *
 * Expose window.StockageVieillissement (et module.exports sous Node, pour les tests).
 */
(function (racine) {
    'use strict';

    const SOH_FIN_VIE_DEFAUT_PCT = 60.0; // défaut sans donnée constructeur (miroir du Python)
    const FLUX = ['e_sol_restit_mwh', 'e_sol_charge_mwh', 'e_res_charge_mwh', 'e_res_restit_mwh', 'cycles_an'];
    const FLUX_SOLAIRES = ['e_sol_restit_mwh', 'e_sol_charge_mwh'];
    const MODES_REMPLACEMENT = ['auto', 'annee', 'aucun'];

    function sohFinVie(valeurPct) {
        let v = parseFloat(valeurPct);
        if (!isFinite(v) || v < 50 || v > 99) v = SOH_FIN_VIE_DEFAUT_PCT;
        return v / 100;
    }

    function interpoler(points, soh, cle) {
        const pts = (points || []).slice().sort((a, b) => a.soh - b.soh);
        if (!pts.length) return 0;
        if (pts.length === 1 || soh >= pts[pts.length - 1].soh) return Math.max(0, Number(pts[pts.length - 1][cle]));
        let a = pts[0], b = pts[1];
        if (soh > pts[0].soh) {
            for (let i = 1; i < pts.length; i++) {
                if (soh <= pts[i].soh) { a = pts[i - 1]; b = pts[i]; break; }
            }
        }
        if (b.soh === a.soh) return Math.max(0, Number(a[cle]));
        const k = (soh - a.soh) / (b.soh - a.soh);
        return Math.max(0, Number(a[cle]) + k * (Number(b[cle]) - Number(a[cle])));
    }

    function trajectoire(vieillissement, horizon, degradationPv, modeRemplacement, anneeRemplacement) {
        const v = vieillissement || {};
        const points = v.points || [];
        const eol = sohFinVie(v.soh_fin_vie_pct);
        const cal = Math.max(0, Number(v.degrad_cal_pct_an) || 0) / 100;
        const cyclesMax = Number(v.cycles_max) || 0;
        const mode = MODES_REMPLACEMENT.includes(modeRemplacement) ? modeRemplacement : 'auto';
        const annee = (anneeRemplacement === null || anneeRemplacement === undefined || anneeRemplacement === '')
            ? null : parseInt(anneeRemplacement, 10);
        const dPv = Number(degradationPv) || 0;

        let soh = 1.0;
        const annees = [];
        for (let t = 1; t <= parseInt(horizon, 10); t++) {
            let remplacement = false;
            if (t > 1 && ((mode === 'auto' && soh <= eol + 1e-9) || (mode === 'annee' && annee === t))) {
                soh = 1.0;
                remplacement = true;
            }
            const ligne = { t, soh_debut: soh, remplacement };
            if (soh <= eol + 1e-9) {
                ligne.soh_fin = soh;
                ligne.fraction_service = 0;
                FLUX.forEach(cle => { ligne[cle] = 0; });
                annees.push(ligne);
                continue;
            }
            const cycles = interpoler(points, soh, 'cycles_an');
            const perte = cal + (cyclesMax > 0 ? (1 - eol) * cycles / cyclesMax : 0);
            const sohFin = Math.max(0, soh - perte);
            let fraction, sohMoyen;
            if (perte > 0 && sohFin < eol) {
                fraction = (soh - eol) / perte;
                sohMoyen = (soh + eol) / 2;
            } else {
                fraction = 1;
                sohMoyen = (soh + sohFin) / 2;
            }
            const facteurPv = Math.pow(1 - dPv, t - 1);
            FLUX.forEach(cle => {
                const valeur = interpoler(points, sohMoyen, cle) * fraction;
                ligne[cle] = FLUX_SOLAIRES.includes(cle) ? valeur * facteurPv : valeur;
            });
            ligne.soh_fin = sohFin;
            ligne.fraction_service = fraction;
            annees.push(ligne);
            soh = sohFin;
        }
        return annees;
    }

    function dureeDeVieAns(vieillissement, plafond) {
        let total = 0;
        for (const ligne of trajectoire(vieillissement, plafond || 60, 0, 'aucun')) {
            if (ligne.fraction_service <= 0) break;
            total += ligne.fraction_service;
        }
        return total;
    }

    const api = { SOH_FIN_VIE_DEFAUT_PCT, sohFinVie, interpoler, trajectoire, dureeDeVieAns };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    racine.StockageVieillissement = api;
})(typeof window !== 'undefined' ? window : globalThis);
