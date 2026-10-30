/**
 * Module PAC / climatiseur — modèle de performances (COP, EER, puissance disponible).
 * ===================================================================================
 * Fonctions pures, sans DOM : utilisables dans la page (window.PacModeleCop) et sous Node (tests).
 * Les valeurs par défaut viennent de donnees/equipements.json (bloc `ref` passé en paramètre).
 *
 * Méthode (physique publique, aucune donnée propriétaire) :
 *  - COP de Carnot en chaud : COPc = Tcond / (Tcond − Tevap), températures en K, avec
 *    Tevap = T_ext − pincement évaporateur et Tcond = T_départ (ou air intérieur) + pincement condenseur.
 *    EER de Carnot en froid : EERc = Tevap / (Tcond − Tevap), Tevap = T_départ froid (ou air intérieur)
 *    − pincement, Tcond = T_ext + pincement.
 *  - « Carnot corrigé » : COP = η × COPc. On n'interpole PAS le COP lui-même entre les points de la
 *    fiche technique, mais le rendement η = COP_mesuré / COPc de chaque point : la dépendance
 *    physique à la température extérieure et à la température de départ reste portée par Carnot, et
 *    l'extrapolation hors des points (ex. W45 à partir de W35 et W55) reste réaliste. η est
 *    interpolé linéairement en T_ext pour chaque température de départ, puis entre températures de
 *    départ ; il est maintenu constant hors de la plage des points.
 *  - Puissance disponible : interpolée entre les points ; hors plage (ou sans point), variation
 *    linéaire de x %/K autour de la valeur connue, bornée (hypothèse documentée dans le JSON).
 *  - Charge partielle : sous le taux de modulation minimal, cyclage marche/arrêt avec
 *    COP_cyclage = COP × CR / (Cd × CR + 1 − Cd), CR = charge / puissance minimale.
 *  - Dégivrage (chaud seulement) : perte triangulaire autour de +2 °C pondérée par l'humidité, si
 *    les performances saisies ne l'incluent pas déjà.
 *  - Liaisons frigorifiques : perte appliquée à la puissance utile ET au COP (même consommation
 *    électrique pour moins de chaleur livrée).
 */
(function (racine) {
    'use strict';

    const ZERO_K = 273.15;

    function interpLin(xs, ys, x) {
        const n = xs.length;
        if (n === 0) return NaN;
        if (n === 1 || x <= xs[0]) return ys[0];
        if (x >= xs[n - 1]) return ys[n - 1];
        for (let i = 1; i < n; i++) {
            if (x <= xs[i]) {
                const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
                return ys[i - 1] + t * (ys[i] - ys[i - 1]);
            }
        }
        return ys[n - 1];
    }

    /** COP de Carnot en chaud (te = air extérieur, tw = départ d'eau ou air intérieur, °C). */
    function carnotChaud(te, tw, systeme, carnot) {
        const pCond = systeme === 'air_air' ? carnot.pincement_condenseur_air_k : carnot.pincement_condenseur_eau_k;
        const tCond = tw + pCond + ZERO_K;
        const tEvap = te - carnot.pincement_evaporateur_air_k + ZERO_K;
        return tCond / Math.max(carnot.ecart_minimal_k, tCond - tEvap);
    }

    /** EER de Carnot en froid (te = air extérieur, tw = départ d'eau glacée ou air intérieur, °C). */
    function carnotFroid(te, tw, systeme, carnot) {
        const pEvap = systeme === 'air_air' ? carnot.pincement_evaporateur_air_interieur_k : carnot.pincement_evaporateur_eau_k;
        const tEvap = tw - pEvap + ZERO_K;
        const tCond = te + carnot.pincement_condenseur_air_exterieur_k + ZERO_K;
        return tEvap / Math.max(carnot.ecart_minimal_k, tCond - tEvap);
    }

    /** Regroupe les points par température de départ (arrondie au degré), triés en T_ext. */
    function grouperParDepart(points) {
        const groupes = new Map();
        points.forEach((p) => {
            const w = Math.round(p.w);
            if (!groupes.has(w)) groupes.set(w, []);
            groupes.get(w).push(p);
        });
        return Array.from(groupes.entries())
            .map(([w, pts]) => ({ w, pts: pts.slice().sort((a, b) => a.a - b.a) }))
            .sort((x, y) => x.w - y.w);
    }

    /**
     * Interpolation bilinéaire « par groupes » d'une grandeur portée par les points.
     * valeur(p) : grandeur du point ; horsPlageT(groupe, te) : valeur hors de la plage en T_ext.
     */
    function interpGroupes(groupes, te, tw, valeur, horsPlageT) {
        const parGroupe = groupes.map((g) => {
            const xs = g.pts.map((p) => p.a);
            if (te < xs[0] || te > xs[xs.length - 1]) return horsPlageT(g, te);
            return interpLin(xs, g.pts.map(valeur), te);
        });
        return interpLin(groupes.map((g) => g.w), parGroupe, tw);
    }

    /** Facteur de dégivrage (1 = aucune perte). */
    function facteurDegivrage(te, hr, deg) {
        if (!deg || te <= deg.t_min || te >= deg.t_max) return 1;
        const tri = te <= deg.t_pic
            ? (te - deg.t_min) / (deg.t_pic - deg.t_min)
            : (deg.t_max - te) / (deg.t_max - deg.t_pic);
        const h = Math.max(0, Math.min(1, ((hr ?? 80) - deg.humidite_debut_pct) / (deg.humidite_pleine_pct - deg.humidite_debut_pct)));
        return 1 - (deg.perte_max_pct / 100) * tri * h;
    }

    /** Cyclage sous le taux de modulation minimal. plr = charge / puissance maximale disponible. */
    function facteurChargePartielle(plr, modulationMin, cd) {
        if (!(plr > 0) || plr >= modulationMin || modulationMin <= 0) return 1;
        const cr = plr / modulationMin;
        return cr / (cd * cr + 1 - cd);
    }

    /** Perte des liaisons frigorifiques par défaut (%), si le constructeur ne la donne pas. */
    function perteLiaisonsDefaut(l, ref) {
        const r = ref.liaisons_frigorifiques;
        const pct = Math.max(0, (l.longueur || 0) - r.longueur_reference_m) * r.pct_par_m
            + Math.abs(l.denivele || 0) * r.pct_par_m_denivele
            + (l.coudes90 || 0) * r.pct_par_coude_90
            + (l.coudes180 || 0) * r.pct_par_coude_180;
        return Math.min(r.perte_max_pct, pct);
    }

    /**
     * Modèle d'un mode de fonctionnement (chaud ou froid).
     * cfg : {
     *   mode: 'chaud'|'froid', systeme: 'air_eau'|'air_air',
     *   points: [{a, w, p_kw, cop|eer}], puissanceNominaleKw (si aucun point de puissance),
     *   tExtMin, tExtMax (plage de fonctionnement), inclutDegivrage, perteLiaisonsPct,
     *   modulationMinPct, cd
     * }
     */
    function creerModele(cfg, ref) {
        const chaud = cfg.mode === 'chaud';
        const carnot = ref.modele_carnot;
        const carnotFn = chaud ? carnotChaud : carnotFroid;
        const cleRendement = chaud ? 'cop' : 'eer';
        const pente = (chaud ? ref.puissance_selon_temperature.chaud_pct_par_k : ref.puissance_selon_temperature.froid_pct_par_k) / 100;
        const bornes = ref.puissance_selon_temperature;
        // En chaud, la puissance baisse quand il fait plus froid ; en froid, quand il fait plus chaud.
        const sens = chaud ? 1 : -1;
        const tRefPuissance = chaud ? 7 : 35;

        const pointsValides = (cfg.points || []).filter((p) => Number.isFinite(p.a) && Number.isFinite(p.w));
        const pointsRendement = pointsValides.filter((p) => p[cleRendement] > 0)
            .map((p) => ({ a: p.a, w: p.w, eta: p[cleRendement] / carnotFn(p.a, p.w, cfg.systeme, carnot) }));
        const pointsPuissance = pointsValides.filter((p) => p.p_kw > 0);
        const groupesEta = grouperParDepart(pointsRendement);
        const groupesP = grouperParDepart(pointsPuissance);
        const etaDefaut = chaud ? carnot.eta_chaud_defaut : carnot.eta_froid_defaut;

        const facteurPente = (dt) => Math.max(bornes.borne_min, Math.min(bornes.borne_max, 1 + sens * pente * dt));

        function eta(te, tw) {
            if (!groupesEta.length) return etaDefaut;
            return interpGroupes(groupesEta, te, tw, (p) => p.eta, (g, t) => (t < g.pts[0].a ? g.pts[0].eta : g.pts[g.pts.length - 1].eta));
        }

        function puissanceBruteKw(te, tw) {
            if (!groupesP.length) return (cfg.puissanceNominaleKw || 0) * facteurPente(te - tRefPuissance);
            return interpGroupes(groupesP, te, tw, (p) => p.p_kw, (g, t) => {
                const bord = t < g.pts[0].a ? g.pts[0] : g.pts[g.pts.length - 1];
                return bord.p_kw * facteurPente(t - bord.a);
            });
        }

        const fLiaisons = 1 - Math.max(0, Math.min(100, cfg.perteLiaisonsPct || 0)) / 100;
        const modMin = Math.max(0, Math.min(100, cfg.modulationMinPct ?? ref.charge_partielle.modulation_min_pct)) / 100;
        const cd = cfg.cd ?? ref.charge_partielle.cd;
        const deg = chaud && !cfg.inclutDegivrage ? ref.degivrage : null;

        return {
            mode: cfg.mode,
            systeme: cfg.systeme,
            modulationMin: modMin,
            enPlage(te) {
                return (!Number.isFinite(cfg.tExtMin) || te >= cfg.tExtMin) && (!Number.isFinite(cfg.tExtMax) || te <= cfg.tExtMax);
            },
            /** Puissance utile maximale (kW) livrée aux émetteurs. */
            capaciteKw(te, tw, hr) {
                if (!this.enPlage(te)) return 0;
                return Math.max(0, puissanceBruteKw(te, tw)) * fLiaisons * facteurDegivrage(te, hr, deg);
            },
            /** COP (chaud) ou EER (froid) utile, à la charge partielle plr (0-1, relative à capaciteKw). */
            rendement(te, tw, hr, plr) {
                const pleineCharge = eta(te, tw) * carnotFn(te, tw, cfg.systeme, carnot);
                return pleineCharge * fLiaisons * facteurDegivrage(te, hr, deg) * facteurChargePartielle(plr, modMin, cd);
            },
            /** Rendement η et COP de Carnot (affichage / contrôle). */
            detail(te, tw) {
                return { eta: eta(te, tw), carnot: carnotFn(te, tw, cfg.systeme, carnot) };
            },
        };
    }

    /**
     * Loi d'eau linéaire : départ = departBase à tBase, departDoux à tNonChauffage, borné entre les
     * deux et plafonné par la température de départ maximale de la PAC.
     */
    function loiDeau(te, l) {
        const { tBase, departBase, tNonChauffage, departDoux, departMax } = l;
        let t;
        if (te <= tBase) t = departBase;
        else if (te >= tNonChauffage) t = departDoux;
        else t = departBase + (departDoux - departBase) * (te - tBase) / (tNonChauffage - tBase);
        return Number.isFinite(departMax) ? Math.min(t, departMax) : t;
    }

    /** Températures d'eau froide mensuelles (°C) — modèle documenté dans donnees/ecs.json. */
    function eauFroideMensuelle(tMoyMens, tAn, ecsRef) {
        const ef = ecsRef.eau_froide;
        return tMoyMens.map((_, m) => {
            const precedent = tMoyMens[(m + 11) % 12];
            const t = tAn + ef.amortissement * (precedent - tAn);
            return Math.max(ef.min_c, Math.min(ef.max_c, t));
        });
    }

    const api = {
        carnotChaud, carnotFroid, facteurDegivrage, facteurChargePartielle, perteLiaisonsDefaut,
        creerModele, loiDeau, eauFroideMensuelle, interpLin,
    };
    racine.PacModeleCop = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
