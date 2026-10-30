/**
 * Module PAC / climatiseur — bâtiment, déperditions et dimensionnement.
 * =====================================================================
 * Fonctions pures (window.PacDimensionnement, ou require sous Node). Les données de référence sont
 * passées en paramètre (donnees/batiment.json -> `bat`, donnees/ecs.json -> `ecs`).
 *
 * Formules (physique publique ; NF EN 12831 et ISO 13790 / ISO 52016-1 servent seulement de
 * référence méthodologique, aucun de leurs tableaux n'est repris) :
 *  - transmission : H_tr = Σ U·A (parois opaques majorées des ponts thermiques en %) + U_fen·A_fen ;
 *  - renouvellement d'air : H_ve = ρ·c·V·(n_ventilation·(1 − η_récupération) + n_infiltration),
 *    ρ·c de l'air = 0,34 Wh/(m³·K) (1,2 kg/m³ × 1005 J/(kg·K) / 3600) ;
 *    infiltrations n_inf = n50 / 20 (Sherman, LBNL 1987) ;
 *  - puissance de chauffage à la température de base (méthode conventionnelle, sans apports) :
 *    P = (H_tr + H_ve) × (T_int − T_base) ;
 *  - méthode simplifiée : P = G × V × ΔT, G (W/(m³·K)) DÉDUIT du niveau d'isolation par le calcul
 *    ci-dessus appliqué à la maison de référence du JSON (G n'est donc pas une valeur tabulée) ;
 *    les deux méthodes alimentent le même modèle dynamique 5R1C (cf. pac_simulation.js) ;
 *  - ECS : E = V × 1,163 Wh/(L·K) × (T_usage − T_eau_froide).
 */
(function (racine) {
    'use strict';

    const RHO_C_AIR = 0.34; // Wh/(m³·K)
    const ORIENTATIONS = ['N', 'E', 'S', 'O'];

    function trouver(liste, id) {
        return (liste || []).find((x) => x.id === id) || null;
    }

    /** Renouvellement d'air équivalent (vol/h) : ventilation (après récupération) + infiltrations. */
    function renouvellementEquivalent(ventilation, n50, bat) {
        const nVent = ventilation ? ventilation.renouvellement_vol_h * (1 - (ventilation.rendement_recuperation || 0)) : 0;
        return nVent + (n50 || 0) / bat.infiltration.diviseur_n50;
    }

    /**
     * Coefficient G (W/(m³·K)) d'un niveau d'isolation, calculé sur la maison de référence.
     * Renvoie aussi le détail (H_tr, H_ve) pour l'affichage.
     */
    function gDepuisNiveau(niveau, ventilation, bat) {
        const r = bat.maison_reference;
        const v = r.surface_m2 * r.hauteur_m;
        const aFen = r.surface_m2 * r.part_vitree_surface_pct / 100;
        const aMur = r.perimetre_m * r.hauteur_m - aFen;
        const hOpaque = (niveau.u_mur * aMur + niveau.u_toit * r.surface_m2 + niveau.u_sol * r.surface_m2)
            * (1 + niveau.ponts_thermiques_pct / 100);
        const hTr = hOpaque + niveau.u_fenetre * aFen;
        const hVe = RHO_C_AIR * v * renouvellementEquivalent(ventilation, niveau.n50, bat);
        return { G: (hTr + hVe) / v, hTr, hVe, volume: v };
    }

    /** Gains solaires effectifs d'un vitrage : surface × part vitrée × facteur solaire × ombrage. */
    function surfaceSolaireEffective(aFenetre, gFenetre, bat) {
        return aFenetre * bat.vitrages.part_vitree_cadre * gFenetre * bat.vitrages.facteur_ombrage_hiver;
    }

    /** Paramètres communs du réseau 5R1C (masse, surfaces intérieures, coefficients d'échange). */
    function parametres5R1C(surface, capaciteKjM2K, bat) {
        const m = bat.modele_5r1c;
        return {
            Cm: capaciteKjM2K * 1000 * surface, // J/K
            aM: m.ratio_surface_masse * surface,
            aT: m.ratio_surfaces_interieures * surface,
            hIs: m.h_is_w_m2k,
            hMs: m.h_ms_w_m2k,
        };
    }

    // Répartition de H quand le bâtiment est déduit de la puissance de l'équipement (composition
    // inconnue) : hypothèse d'une maison courante — renouvellement d'air 25 %, vitrages 20 %, parois
    // opaques le reste.
    const REPARTITION_H_DEDUITE = { ve: 0.25, fenetres: 0.2 };

    /**
     * Paramètres de l'option SIMPLIFIÉE. Les déperditions totales viennent de G (H = G × V) ; elles
     * sont réparties entre renouvellement d'air, vitrages et parois opaques pour alimenter le MÊME
     * modèle dynamique 5R1C que l'option détaillée (un modèle à un seul nœud air + masse
     * surestimerait la durée de relance après un réduit : l'air y monte au rythme de la masse).
     * e : { surface, hauteur, G, capaciteKjM2K, partVitreePct, gFenetre,
     *       uFenetre, renouvellementVolH (vol/h, ventilation après récupération + infiltrations) }
     * Sans uFenetre / renouvellementVolH (bâtiment déduit) : REPARTITION_H_DEDUITE.
     * Les vitrages sont répartis à parts égales sur les 4 orientations (orientation inconnue).
     */
    function batimentSimplifie(e, bat) {
        const volume = e.surface * e.hauteur;
        const H = e.G * volume;
        const aFen = e.surface * e.partVitreePct / 100;
        const connu = Number.isFinite(e.uFenetre) && Number.isFinite(e.renouvellementVolH);
        let hVe = connu ? RHO_C_AIR * volume * e.renouvellementVolH : REPARTITION_H_DEDUITE.ve * H;
        let hTrW = connu ? e.uFenetre * aFen : REPARTITION_H_DEDUITE.fenetres * H;
        // G saisi plus faible que ventilation + vitrages : on réduit ces deux postes à proportion
        // pour garder au moins 10 % de parois opaques (H total = G × V reste exact).
        const plafond = 0.9 * H;
        if (hVe + hTrW > plafond) { const k = plafond / (hVe + hTrW); hVe *= k; hTrW *= k; }
        const hTrOp = H - hVe - hTrW;
        const aSol = surfaceSolaireEffective(aFen, e.gFenetre, bat);
        const vitrages = {};
        ORIENTATIONS.forEach((o) => { vitrages[o] = aSol / 4; });
        return Object.assign({
            modele: '5r1c',
            surface: e.surface,
            volume,
            H,
            hTrOp,
            hTrW,
            hVe,
            vitrages,
        }, parametres5R1C(e.surface, e.capaciteKjM2K, bat));
    }

    /**
     * Paramètres de l'option DÉTAILLÉE (modèle 5R1C) et déperditions par pièce.
     * pieces : [{ nom, surface, hauteur, facades: [{orientation, longueur}], vitragePct,
     *            sousToiture, surSol, occupants }]
     * env : { u_mur, u_toit, u_sol, u_fenetre, g_fenetre, ponts_thermiques_pct, n50 }
     * ventilation : { renouvellement_vol_h, rendement_recuperation }
     */
    function batimentDetaille(pieces, env, ventilation, capaciteKjM2K, bat) {
        const nEq = renouvellementEquivalent(ventilation, env.n50, bat);
        const fPt = 1 + env.ponts_thermiques_pct / 100;
        const vitrages = { N: 0, E: 0, S: 0, O: 0 };
        let surface = 0; let volume = 0; let hOp = 0; let hW = 0;
        const detail = pieces.map((p) => {
            let aMurBrut = 0; let aFen = 0;
            (p.facades || []).forEach((f) => {
                if (!ORIENTATIONS.includes(f.orientation) || !(f.longueur > 0)) return;
                const brut = f.longueur * p.hauteur;
                const fen = brut * (p.vitragePct || 0) / 100;
                aMurBrut += brut;
                aFen += fen;
                vitrages[f.orientation] += surfaceSolaireEffective(fen, env.g_fenetre, bat);
            });
            const aMur = aMurBrut - aFen;
            const aToit = p.sousToiture ? p.surface : 0;
            const aSol = p.surSol ? p.surface : 0;
            const hOpPiece = (env.u_mur * aMur + env.u_toit * aToit + env.u_sol * aSol) * fPt;
            const hWPiece = env.u_fenetre * aFen;
            const vPiece = p.surface * p.hauteur;
            const hVePiece = RHO_C_AIR * vPiece * nEq;
            surface += p.surface; volume += vPiece; hOp += hOpPiece; hW += hWPiece;
            return { nom: p.nom, surface: p.surface, volume: vPiece, hTr: hOpPiece + hWPiece, hVe: hVePiece, H: hOpPiece + hWPiece + hVePiece };
        });
        const hVe = RHO_C_AIR * volume * nEq;
        return Object.assign({
            modele: '5r1c',
            surface,
            volume,
            H: hOp + hW + hVe,
            hTrOp: hOp,
            hTrW: hW,
            hVe,
            vitrages,
            pieces: detail,
        }, parametres5R1C(surface, capaciteKjM2K, bat));
    }

    /** Puissance de chauffage conventionnelle à la température de base (W), sans apports. */
    function puissanceChauffageBase(H, tInt, tBase) {
        return Math.max(0, H * (tInt - tBase));
    }

    /**
     * Gamme de puissance calorifique recommandée (kW) autour du besoin à la température de base.
     * Règle d'usage (hypothèse documentée, modifiable plus tard) : avec appoint, couvrir 80 à 110 %
     * du besoin (point de bivalence quelques degrés au-dessus de la base) ; sans appoint, 100 à 120 %.
     */
    function gammeChauffage(besoinKw, avecAppoint) {
        return avecAppoint ? { min: 0.8 * besoinKw, max: 1.1 * besoinKw } : { min: besoinKw, max: 1.2 * besoinKw };
    }

    /** Gamme frigorifique (kW) : 100 à 120 % de la pointe de froid simulée. */
    function gammeFroid(pointeKw) {
        return { min: pointeKw, max: 1.2 * pointeKw };
    }

    /** Énergie journalière d'ECS (kWh) pour une température d'eau froide donnée. */
    function besoinEcsJourKwh(occupants, litresParPersonne, tUsage, tEauFroide, ecs) {
        return occupants * litresParPersonne * ecs.chaleur_massique_wh_l_k * Math.max(0, tUsage - tEauFroide) / 1000;
    }

    /** Pertes par défaut d'un ballon (kWh/24 h) d'après son volume (interpolation du JSON). */
    function pertesBallonDefaut(volume, ecs) {
        const t = ecs.pertes_ballon_defaut_kwh_24h;
        const xs = t.map((x) => x.volume_l);
        const ys = t.map((x) => x.pertes);
        if (volume <= xs[0]) return ys[0] * volume / xs[0];
        for (let i = 1; i < xs.length; i++) {
            if (volume <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (volume - xs[i - 1]) / (xs[i] - xs[i - 1]);
        }
        return ys[ys.length - 1] * volume / xs[xs.length - 1];
    }

    /** Correction d'altitude des températures : gradient de l'atmosphère standard (−0,65 °C / 100 m). */
    function correctionAltitude(altitudeSite, altitudeMeteo) {
        if (!Number.isFinite(altitudeSite) || !Number.isFinite(altitudeMeteo)) return 0;
        return -0.0065 * (altitudeSite - altitudeMeteo);
    }

    const api = {
        RHO_C_AIR, ORIENTATIONS, REPARTITION_H_DEDUITE, trouver, renouvellementEquivalent, gDepuisNiveau, batimentSimplifie,
        batimentDetaille, puissanceChauffageBase, gammeChauffage, gammeFroid, besoinEcsJourKwh,
        pertesBallonDefaut, correctionAltitude,
    };
    racine.PacDimensionnement = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
