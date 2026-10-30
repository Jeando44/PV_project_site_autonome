/**
 * Calepinage résidentiel — tables de petit champ solaire face au TERRAIN réel : calage, garde au
 * sol, pentes. UN SEUL calcul (analyserTable) lu par :
 *   - la carte principale et le canevas du calepinage (couleur des tables, synthèse, légende) ;
 *   - la 3D (calepinage_maison_3d_terrain.js::poserTablesPetitChamp : hauteur, inclinaison et
 *     couleur de chaque table).
 * Chaque vue fournit sa fonction de sol ; la règle de pose, la garde et les seuils sont ici.
 *
 * ── Règle de pose (petit champ solaire) ────────────────────────────────────────────────────────
 * Structure identique d'une table à l'autre : la table SUIT LA PENTE le long de la rangée, droite
 * entre le premier et le dernier poteau, et se cale sur le poteau le plus contraint (même règle que
 * les plans 2D, terrain_plans.js::calerTable, dont calerTable() ci-dessous est le miroir). Sur un
 * terrain régulier tous les poteaux ont la même longueur ; c'est la garde sous le bord bas qui
 * varie avec le relief (bosse sous la table, pente en travers de la rangée).
 * Poteaux VERTICAUX, pied posé sur le sol local ; la partie ENTERRÉE (ancrage, seuils.ancrageM) est
 * la même pour tous les poteaux du champ, quelle que soit la pente : seule la partie hors sol varie
 * (calage.hauteursPoteaux = allongement hors sol ; poteaux = hors sol, ancrage, longueur totale).
 *
 * ── Repère d'une table ─────────────────────────────────────────────────────────────────────────
 * u : le long de la rangée (égout), uRel ∈ [-L/2, L/2] depuis le centre de la table ;
 * d : distance HORIZONTALE depuis le bord BAS (avant, côté où regardent les panneaux) vers
 *     l'arrière, d ∈ [0, D]. Poteaux sur l'axe central (d = D/2).
 * Hauteurs au-dessus du niveau des pieds de poteaux (géométrie des plans et de la 3D :
 * « Hauteur bas PV » hBas = dessus des panneaux au bord bas ; bipente : d -> min(d, D - d)) :
 *   dessous des panneaux  hPV(d) = hBas + d · tan − eP          sur toute la profondeur ;
 *   dessous de la traverse hS(d) = hBas + d · tan − eS          pour pf ≤ d ≤ D − pf
 *   (eS = traverse + panne + panneau ; pf = porte-à-faux horizontal).
 * Deux GARDES, chacune jugée sur sa hauteur prévue :
 *   - garde PV : sous le dessous des panneaux (le bord bas touche en premier quand le terrain monte
 *     vers l'avant), rapportée à la hauteur bas PV hBas ;
 *   - garde structure : sous la traverse, rapportée à la « hauteur de passage » du configurateur
 *     (bout de la traverse sur terrain plat : hBas − eS + pf · tan).
 *
 * ── Statuts et SEUILS (réglables par champ : state.terrainSeuils, légende de la carte) ─────────
 * garde : 'enfoncee' (< 0, tolérance 2 cm), 'faible' (garde PV < gardePct % de hBas OU garde
 *         structure < gardePct % de la hauteur de passage ; défaut 50 %), 'ok'.
 * pente du terrain sous la table : ≤ 3 % ok, 3 % - pentePct 'attention', > pentePct (défaut 5 %)
 *         'alerte'.
 * niveau (couleur) : enfoncee > pente_forte > garde_faible > pente_moyenne > ok. Les trois premiers
 * sont « hors seuils » : candidats au retrait ou à l'ajustement (proposerAjustement).
 *
 * ── Ajustement ─────────────────────────────────────────────────────────────────────────────────
 * Une table hors seuils n'est pas forcément à retirer en entier : on cherche, colonne de panneaux
 * par colonne, la plus grande partie à GARDER (un ou plusieurs tronçons contigus d'au moins
 * MIN_COLONNES_TABLE colonnes) dont chaque tronçon, recalé sur le terrain, respecte les seuils.
 * Les panneaux posés restent sur la grille du calepinage : une table est raccourcie ou scindée,
 * jamais déplacée hors grille.
 *
 * Point d'entrée : window.CalepinageMaisonTerrainTables (alias CM.terrainTables)
 */
(function () {
    const CM = (window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {});

    const SEUIL_PENTE_ATTENTION_PCT = 3;
    const SEUIL_PENTE_ALERTE_PCT = 5;
    const TOLERANCE_ENFONCEMENT_M = 0.02;
    const SEUILS_DEFAUT = { gardePct: 50, pentePct: 5, ancrageM: 1.0 };
    const MIN_COLONNES_TABLE = 2;
    const MAX_COLONNES_AJUSTEMENT = 40;
    const HORS_SEUILS = ['enfoncee', 'pente_forte', 'garde_faible'];
    const PAS_U_M = 1.0;
    const PAS_D_M = 0.5;
    const MARGE_GRILLE_M = 10;

    const NIVEAUX = {
        enfoncee: { rang: 4, couleur: '#7c3aed', libelle: 'Enfoncée dans le sol' },
        pente_forte: { rang: 3, couleur: '#dc2626', libelle: 'Pente au-delà du seuil' },
        garde_faible: { rang: 2, couleur: '#f59e0b', libelle: 'Garde au sol sous le seuil' },
        pente_moyenne: { rang: 1, couleur: '#f97316', libelle: `Pente entre ${SEUIL_PENTE_ATTENTION_PCT} % et le seuil` },
        ok: { rang: 0, couleur: null, libelle: 'Conforme' },
    };

    // ── Calculs purs (tests/terrain/test_terrain_tables.js) ────────────────────────────────────

    /** Poteaux d'une table de longueur L, abscisses depuis son DÉBUT (miroir de
     *  petit_champ_solaire_3d_orchestrator.js::petitChampPostsForLength + parsePostDistancesSimple). */
    function postesPourLongueur(L) {
        const debord = Math.min(0.6, L * 0.15);
        const portee = Math.max(0.1, L - 2 * debord);
        const travees = Math.max(1, Math.round(portee / 6));
        const entraxe = Math.round((portee / travees) * 1000) / 1000;
        const xs = [];
        for (let k = 0; k <= travees; k++) xs.push(debord + k * entraxe);
        return xs;
    }

    /** Miroir de terrain_plans.js::calerTable (table rigide sur pieds de poteaux). */
    function calerTable(postes, mode, hauteurMin) {
        const p = postes.filter((q) => Number.isFinite(q.zSol)).sort((a, b) => a.x - b.x);
        if (!p.length) return null;
        const premier = p[0], dernier = p[p.length - 1];
        const pente = mode === 'pente' && dernier.x > premier.x
            ? (dernier.zSol - premier.zSol) / (dernier.x - premier.x)
            : 0;
        const decalage = Math.max.apply(null, p.map((q) => q.zSol - pente * q.x)) + hauteurMin;
        const zTable = (x) => decalage + pente * x;
        return { zTable, pente, hauteurs: postes.map((q) => zTable(q.x) - q.zSol) };
    }

    /** Seuils bornés (garde en % de la hauteur prévue, pente en %) + profondeur d'ancrage (m). */
    function normaliserSeuils(seuils) {
        const s = Object.assign({}, SEUILS_DEFAUT, seuils || {});
        const g = Number(s.gardePct), p = Number(s.pentePct), a = Number(s.ancrageM);
        return {
            gardePct: Number.isFinite(g) ? Math.min(100, Math.max(0, g)) : SEUILS_DEFAUT.gardePct,
            pentePct: Number.isFinite(p) ? Math.min(30, Math.max(0.5, p)) : SEUILS_DEFAUT.pentePct,
            ancrageM: s.ancrageM !== null && s.ancrageM !== '' && Number.isFinite(a) ? Math.min(5, Math.max(0, a)) : SEUILS_DEFAUT.ancrageM,
        };
    }

    function seuilsDuChamp(state) {
        return normaliserSeuils(state && state.terrainSeuils);
    }

    function niveauPente(pct, seuils) {
        const s = normaliserSeuils(seuils);
        if (!Number.isFinite(pct)) return 'inconnu';
        if (pct > s.pentePct) return 'alerte';
        if (pct > Math.min(SEUIL_PENTE_ATTENTION_PCT, s.pentePct)) return 'attention';
        return 'ok';
    }

    /**
     * Statut de garde et niveau d'une analyse selon les seuils (sans rééchantillonner le sol).
     * Garde PV et garde structure comparées chacune à gardePct % de SA hauteur prévue ; garde.critere
     * = celle qui est la plus entamée ('pv' | 'structure'). Met aussi à jour les longueurs de poteaux
     * (ancrage du champ).
     */
    function classer(a, hBas, seuils) {
        const s = normaliserSeuils(seuils);
        const g = a.garde;
        const parties = [g.pv, g.structure].filter((p) => p && Number.isFinite(p.minM) && p.refM > 0);
        if (!parties.length) parties.push({ cle: 'pv', minM: g.minM, refM: hBas });
        parties.forEach((p) => { p.ratio = p.minM / p.refM; });
        const critique = parties.reduce((m, p) => (p.ratio < m.ratio ? p : m));
        g.critere = critique.cle;
        g.statut = g.minM < -TOLERANCE_ENFONCEMENT_M ? 'enfoncee'
            : parties.some((p) => p.ratio < s.gardePct / 100) ? 'faible' : 'ok';
        if (a.poteaux) {
            a.poteaux.ancrageM = s.ancrageM;
            a.poteaux.longueurM = a.poteaux.horsSolM.map((h) => h + s.ancrageM);
        }
        a.pentes.niveau = niveauPente(a.pentes.totalePct, s);
        let niveau = 'ok';
        if (a.garde.statut === 'enfoncee') niveau = 'enfoncee';
        else if (a.pentes.niveau === 'alerte') niveau = 'pente_forte';
        else if (a.garde.statut === 'faible') niveau = 'garde_faible';
        else if (a.pentes.niveau === 'attention') niveau = 'pente_moyenne';
        a.niveau = niveau;
        return niveau;
    }

    /**
     * Analyse d'une table posée sur le terrain.
     * geo = { longueurM, profondeurM (horizontale), hBasM, tanInclinaison, porteAFauxM (horizontal),
     *         epaisseurPanneauM, epaisseurStructureM (traverse + panne + panneau), bipente,
     *         mode ('pente' | 'horizontal'), postesU (abscisses depuis le DÉBUT, défaut postesPourLongueur) }
     * sol(uRel, d) -> altitude (m) ou null. seuils = { gardePct, pentePct, ancrageM } (défaut 50 / 5 / 1).
     * -> null si le sol est inconnu sous les poteaux, sinon
     *    { calage: { zCentre, pente, hauteursPoteaux }, garde: { minM, uRel, d, statut, critere,
     *        pv: { minM, refM, uRel, d, ratio }, structure: { … } | null },
     *      poteaux: { horsSolM: [], ancrageM, longueurM: [] },
     *      pentes: { longPct, traversPct, totalePct, niveau }, niveau }
     */
    function analyserTable(geo, sol, seuils) {
        const L = geo.longueurM, D = geo.profondeurM;
        const xs = geo.postesU || postesPourLongueur(L);
        const postes = xs.map((x) => ({ x: x - L / 2, zSol: sol(x - L / 2, D / 2) }));
        const cal = calerTable(postes, geo.mode || 'pente', 0);
        if (!cal) return null;
        const t = geo.tanInclinaison || 0;
        const hBas = geo.hBasM || 0;
        const pf = Math.max(0, geo.porteAFauxM || 0);
        const eP = Math.max(0, geo.epaisseurPanneauM || 0), eS = Math.max(eP, geo.epaisseurStructureM || 0);
        const dd = (d) => (geo.bipente ? Math.min(d, D - d) : d);
        const hPV = (d) => hBas + dd(d) * t - eP;
        const aTraverse = pf < D / 2;
        const surTraverse = (d) => aTraverse && d >= pf - 1e-9 && d <= D - pf + 1e-9;
        const hS = (d) => hBas + dd(d) * t - eS;

        const nu = Math.max(1, Math.ceil(L / PAS_U_M));
        const nd = Math.max(1, Math.ceil(D / PAS_D_M));
        // Profondeurs mesurées : pas régulier + bouts de la traverse (point le plus bas en plat).
        const ds = [];
        for (let j = 0; j <= nd; j++) ds.push((D * j) / nd);
        if (pf > 0 && pf < D) ds.push(pf, D - pf);
        ds.sort((a, b) => a - b);
        let gPV = null, gS = null;
        let sommeTravers = 0, nTravers = 0;
        for (let i = 0; i <= nu; i++) {
            const u = -L / 2 + (L * i) / nu;
            for (const d of ds) {
                const z = sol(u, d);
                if (!Number.isFinite(z)) continue;
                const base = cal.zTable(u) - z;
                const g1 = base + hPV(d);
                if (!gPV || g1 < gPV.minM) gPV = { cle: 'pv', minM: g1, uRel: u, d };
                if (surTraverse(d)) {
                    const g2 = base + hS(d);
                    if (!gS || g2 < gS.minM) gS = { cle: 'structure', minM: g2, uRel: u, d };
                }
            }
            const avant = sol(u, 0), arriere = sol(u, D);
            if (D > 0 && Number.isFinite(avant) && Number.isFinite(arriere)) {
                sommeTravers += (avant - arriere) / D;
                nTravers++;
            }
        }
        if (!gPV) return null;
        const refs = gardesPlat(geo);
        gPV.refM = refs.pv;
        if (gS) gS.refM = refs.structure;
        const pire = gS && gS.minM < gPV.minM ? gS : gPV;
        const garde = { minM: pire.minM, uRel: pire.uRel, d: pire.d, pv: gPV, structure: gS };

        // Pente du terrain le long de la rangée : entre les extrémités de la table sur l'axe des
        // poteaux (la table, elle, est droite entre son premier et son dernier poteau).
        const zG = sol(-L / 2, D / 2), zD = sol(L / 2, D / 2);
        const long = L > 0 && Number.isFinite(zG) && Number.isFinite(zD) ? (zD - zG) / L : cal.pente;
        // En travers : positif = le terrain MONTE vers l'avant (bord bas des panneaux).
        const travers = nTravers ? sommeTravers / nTravers : 0;
        const totale = Math.hypot(long, travers) * 100;
        const pentes = { longPct: long * 100, traversPct: travers * 100, totalePct: totale };
        // Poteaux : partie hors sol = hauteur nominale (dessous de la traverse sur l'axe) + allongement.
        const hNominale = Math.max(0, hBas + dd(D / 2) * t - eS);
        const poteaux = { horsSolM: cal.hauteurs.map((h) => (Number.isFinite(h) ? hNominale + h : NaN)), ancrageM: 0, longueurM: [] };
        const a = { calage: { zCentre: cal.zTable(0), pente: cal.pente, hauteursPoteaux: cal.hauteurs }, garde, poteaux, pentes };
        classer(a, hBas, seuils);
        return a;
    }

    /**
     * Hauteurs prévues sur terrain plat : pv = hauteur bas PV (hBas, saisie) ; structure = bout de la
     * traverse (« hauteur de passage »), null sans traverse.
     */
    function gardesPlat(geo) {
        const pf = Math.max(0, geo.porteAFauxM || 0), t = geo.tanInclinaison || 0;
        const eP = Math.max(0, geo.epaisseurPanneauM || 0), eS = Math.max(eP, geo.epaisseurStructureM || 0);
        const D = geo.profondeurM || 0;
        return { pv: geo.hBasM || 0, structure: pf < D / 2 || !(D > 0) ? geo.hBasM - eS + pf * t : null };
    }

    /** Garde sur terrain plat : point le plus bas de la structure (bout de la traverse en général). */
    function gardePlat(geo) {
        const pf = Math.max(0, geo.porteAFauxM || 0), t = geo.tanInclinaison || 0;
        const eP = Math.max(0, geo.epaisseurPanneauM || 0), eS = Math.max(eP, geo.epaisseurStructureM || 0);
        return Math.min(geo.hBasM - eP, geo.hBasM - eS + pf * t);
    }

    // ── Tables d'un champ (même découpe que la 3D) ─────────────────────────────────────────────

    /** Bascule CM.state le temps d'un appel (packPanelsForPan lit l'état global). */
    function avecEtat(state, fn) {
        const precedent = CM.state;
        CM.state = state;
        try { return fn(); } finally { CM.state = precedent; }
    }

    /**
     * Tables shed posées d'un champ (pans en pose 'shed'), dans le repère LOCAL du champ (mètres).
     * Découpe : module de « Nb. PV par shed » rangées, puis colonnes contiguës le long de la rangée
     * (une travée plus large qu'un panneau + espacement ouvre une nouvelle table). C'est la découpe
     * de la 3D (calepinage_maison_3d_objects.js::computePetitChampShedLayout s'appuie dessus).
     * -> [{ index, panId, module, u: {x, y}, centre: {x, y} (moyenne des colonnes), longueurM,
     *       profondeurM, vAvant, nbColonnes, panneaux: [idxKey], coins: [4 x {x, y}] }]
     */
    function tablesDuChamp(state) {
        const st = state || CM.state;
        if (!st || typeof CM.packPanelsForPan !== 'function') return [];
        return avecEtat(st, () => {
            const pans = (st.pans || []).filter((pan) => pan && pan.poseMode === 'shed');
            const groupSize = Math.max(1, Math.min(15, Number(st.shedPanelsPerGroup) || 1));
            const spacingX = (Number(st.panelSpacingXMm) || 0) / 1000;
            const tables = [];
            pans.forEach((pan) => {
                let panels = [];
                try { panels = CM.packPanelsForPan(pan) || []; } catch (e) { panels = []; }
                if (!panels.length) return;
                const a = panels[0].angle || 0;
                let u = { x: Math.cos(a), y: Math.sin(a) };
                let n = { x: -u.y, y: u.x };            // normale : côté BAS (avant) du shed
                // L'AVANT (côté bas, vers lequel regardent les panneaux) est donné par l'AZIMUT du
                // pan, pas par l'angle de la grille : « Inverser l'azimut » retourne pan.azimuth sans
                // toucher à la grille, et un contour rectangle prend l'angle de son arête p0 -> p1,
                // dans un sens ou dans l'autre. Repère retourné (u et n) s'il regarde à l'opposé :
                // garde au sol, pentes, ombrage et 3D jugent alors le bon bord bas.
                if (Number.isFinite(Number(pan.azimuth))) {
                    const cap = ((Number(pan.azimuth) + 180) * Math.PI) / 180;   // Sud = 0 -> cap 180°
                    if (Math.sin(cap) * n.x + Math.cos(cap) * n.y < 0) {
                        u = { x: -u.x, y: -u.y };
                        n = { x: -n.x, y: -n.y };
                    }
                }
                const w = panels[0].w;
                const modules = new Map();
                panels.forEach((p) => {
                    const parts = String(p.panelIndex || '').split('-');
                    const jx = parseInt(parts[0], 10), jy = parseInt(parts[1], 10);
                    if (!isFinite(jx) || !isFinite(jy)) return;
                    const key = Math.floor(jy / groupSize);
                    if (!modules.has(key)) modules.set(key, new Map());
                    const cols = modules.get(key);
                    if (!cols.has(jx)) cols.set(jx, []);
                    cols.get(jx).push(p);
                });
                modules.forEach((cols, moduleKey) => {
                    const colList = [];
                    cols.forEach((list) => {
                        const cx = list.reduce((s, p) => s + p.cx, 0) / list.length;
                        const cy = list.reduce((s, p) => s + p.cy, 0) / list.length;
                        colList.push({ cx, cy, s: cx * u.x + cy * u.y, list });
                    });
                    colList.sort((c1, c2) => c1.s - c2.s);
                    const maxStep = w + spacingX + 0.05;
                    let run = [];
                    const flush = () => {
                        if (!run.length) return;
                        tables.push(Object.assign(construireTable(run, u, n, w),
                            { index: tables.length, panId: pan.id, module: moduleKey }));
                        run = [];
                    };
                    colList.forEach((c) => {
                        if (run.length && (c.s - run[run.length - 1].s) > maxStep) flush();
                        run.push(c);
                    });
                    flush();
                });
            });
            return tables;
        });
    }

    /**
     * Table formée d'un tronçon de colonnes contiguës ({cx, cy, s, list}) : emprise, centre,
     * panneaux. Sert à la découpe ET à l'ajustement (sous-tronçons d'une table).
     */
    function construireTable(run, u, n, w) {
        const cx = run.reduce((s, c) => s + c.cx, 0) / run.length;
        const cy = run.reduce((s, c) => s + c.cy, 0) / run.length;
        const longueur = (run[run.length - 1].s - run[0].s) + w;
        const panneaux = [];
        let vMin = Infinity, vMax = -Infinity;
        run.forEach((c) => c.list.forEach((p) => {
            panneaux.push(p.panelIndex);
            const v = p.cx * n.x + p.cy * n.y;
            vMin = Math.min(vMin, v - p.l / 2);
            vMax = Math.max(vMax, v + p.l / 2);
        }));
        // Centre géométrique de l'emprise (u au milieu de la table, v au milieu de la profondeur) :
        // c'est là que la 3D place l'axe des poteaux.
        const uMil = (run[0].s + run[run.length - 1].s) / 2;
        const vMil = (vMin + vMax) / 2;
        const C = { x: u.x * uMil + n.x * vMil, y: u.y * uMil + n.y * vMil };
        const coin = (du, dv) => ({ x: C.x + u.x * du + n.x * dv, y: C.y + u.y * du + n.y * dv });
        const hL = longueur / 2, hD = (vMax - vMin) / 2;
        return {
            u, n, largeurPanneauM: w,
            centre: { x: cx, y: cy }, centreEmprise: C,
            longueurM: longueur, profondeurM: vMax - vMin, nbColonnes: run.length,
            colonnes: run, panneaux,
            coins: [coin(-hL, hD), coin(hL, hD), coin(hL, -hD), coin(-hL, -hD)],
        };
    }

    /** Géométrie d'analyse d'une table du calepinage (réglages du champ). */
    function geoTable(table, state, pan) {
        let penteDeg = 0;
        if (typeof CM.effectivePenteDegForPan === 'function' && pan) {
            avecEtat(state, () => { penteDeg = CM.effectivePenteDegForPan(pan, state) || 0; });
        }
        // Porte-à-faux (même règle que la 3D, computePetitChampCommon) : % d'UN panneau dans le rampant.
        const pctPorteAFaux = Number((state.petitChampParams || {}).overhangPct);
        const dimRampantM = ((state.panelOrientation === 'paysage' ? state.panelWidthMm : state.panelLengthMm) || 0) / 1000;
        const fraction = Math.min(0.5, Math.max(0, (Number.isFinite(pctPorteAFaux) ? pctPorteAFaux : 20) / 100));
        const reglages = Object.assign({}, typeof CM.getPetitChampDefaults === 'function' ? CM.getPetitChampDefaults() : {},
            state.petitChampParams || {});
        const nombre = (v, defaut) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : defaut);
        const ePanneau = nombre(state.panelThicknessMm, NaN) > 0 ? state.panelThicknessMm / 1000 : nombre(reglages.panelThickness, 0.03);
        const eStructure = nombre(reglages.beamHeight, 0.10) + nombre(reglages.purlinHeight, 0.10) + ePanneau;
        return {
            longueurM: table.longueurM,
            profondeurM: table.profondeurM,
            hBasM: Number(state.petitChampLowPointHeightM) || 0.8,
            tanInclinaison: Math.tan((penteDeg * Math.PI) / 180),
            porteAFauxM: fraction * dimRampantM * Math.cos((penteDeg * Math.PI) / 180),
            epaisseurPanneauM: ePanneau,
            epaisseurStructureM: eStructure,
            bipente: state.petitChampModel === 'bipente',
            mode: 'pente',
        };
    }

    /**
     * Analyse synchrone de toutes les tables d'un champ. solLocal(x, y) = altitude (m) au point du
     * repère local du champ, ou null.
     */
    /** Analyse d'UNE table (du calepinage ou sous-tronçon) sur un sol du repère local du champ. */
    function analyserTableLocale(t, state, pan, solLocal, seuils) {
        const geo = geoTable(t, state, pan);
        const C = t.centreEmprise;
        // d depuis le bord bas (avant, +n) : v = D/2 - d autour du centre.
        const sol = (uRel, d) => solLocal(
            C.x + t.u.x * uRel + t.n.x * (geo.profondeurM / 2 - d),
            C.y + t.u.y * uRel + t.n.y * (geo.profondeurM / 2 - d));
        const a = analyserTable(geo, sol, seuils);
        return Object.assign({}, t, { geo, analyse: a, niveau: a ? a.niveau : 'inconnu' });
    }

    function analyserChampAvecSol(state, solLocal) {
        const tables = tablesDuChamp(state);
        const pans = new Map((state.pans || []).map((p) => [p.id, p]));
        const seuils = seuilsDuChamp(state);
        const resultats = tables.map((t) => analyserTableLocale(t, state, pans.get(t.panId), solLocal, seuils));
        return { tables: resultats, synthese: synthese(resultats), seuils };
    }

    /**
     * Meilleure partie à garder d'une table hors seuils : tronçons contigus (≥ MIN_COLONNES_TABLE
     * colonnes, séparés d'au moins une colonne retirée) qui respectent chacun les seuils, en
     * maximisant le nombre de colonnes gardées. Programmation dynamique sur les colonnes.
     * -> { troncons: [[i, j]], colonnesGardees, panneauxRetires: [idxKey], tablesGardees: [analyse] }
     */
    function ajusterTable(t, state, pan, solLocal, seuils) {
        const cols = t.colonnes || [];
        const n = cols.length;
        const vide = { troncons: [], colonnesGardees: 0, panneauxRetires: t.panneaux.slice(), tablesGardees: [] };
        if (!n || n > MAX_COLONNES_AJUSTEMENT) return vide;
        const cache = new Map();
        const valide = (i, j) => {
            const cle = i + ':' + j;
            if (!cache.has(cle)) {
                const sous = construireTable(cols.slice(i, j + 1), t.u, t.n, t.largeurPanneauM);
                const r = analyserTableLocale(sous, state, pan, solLocal, seuils);
                cache.set(cle, r.analyse && !HORS_SEUILS.includes(r.niveau) ? r : null);
            }
            return cache.get(cle);
        };
        // meilleur[k] = colonnes gardées au mieux parmi les k premières ; choix[k] = début du
        // tronçon qui finit en k - 1 (null : colonne k - 1 retirée).
        const meilleur = new Array(n + 1).fill(0), choix = new Array(n + 1).fill(null);
        for (let k = 1; k <= n; k++) {
            meilleur[k] = meilleur[k - 1];
            choix[k] = null;
            for (let i = 0; i <= k - MIN_COLONNES_TABLE; i++) {
                const avant = i >= 1 ? meilleur[i - 1] : 0;
                const total = avant + (k - i);
                if (total > meilleur[k] && valide(i, k - 1)) { meilleur[k] = total; choix[k] = i; }
            }
        }
        const troncons = [];
        for (let k = n; k > 0;) {
            if (choix[k] === null) { k--; continue; }
            troncons.unshift([choix[k], k - 1]);
            k = choix[k] - 1;
        }
        const gardes = new Set();
        troncons.forEach(([i, j]) => cols.slice(i, j + 1).forEach((c) => c.list.forEach((p) => gardes.add(p.panelIndex))));
        return {
            troncons,
            colonnesGardees: meilleur[n],
            panneauxRetires: t.panneaux.filter((k) => !gardes.has(k)),
            tablesGardees: troncons.map(([i, j]) => valide(i, j)),
        };
    }

    function synthese(tables) {
        const s = { nbTables: tables.length, nbAnalysees: 0, parNiveau: {}, penteMaxPct: null, gardeMinM: null };
        Object.keys(NIVEAUX).forEach((k) => { s.parNiveau[k] = 0; });
        tables.forEach((t) => {
            if (!t.analyse) return;
            s.nbAnalysees++;
            s.parNiveau[t.niveau] = (s.parNiveau[t.niveau] || 0) + 1;
            const p = t.analyse.pentes.totalePct, g = t.analyse.garde.minM;
            if (s.penteMaxPct === null || p > s.penteMaxPct) s.penteMaxPct = p;
            if (s.gardeMinM === null || g < s.gardeMinM) s.gardeMinM = g;
        });
        // Niveau du champ = celui de sa table la plus critique.
        s.niveauChamp = Object.keys(NIVEAUX)
            .filter((k) => s.parNiveau[k] > 0)
            .reduce((max, k) => (NIVEAUX[k].rang > NIVEAUX[max].rang ? k : max), 'ok');
        return s;
    }

    // ── Ombrage entre sheds avec le terrain : géométrie envoyée au backend ─────────────────────
    // Calcul : app/models/calcul_prodsolaire/calcul_shed_shading_terrain.py (POST
    // /calculate_shed_shading_terrain). Ici, rien que de la géométrie, sans réseau ni DOM.
    //
    // Orientation RÉELLE d'une table : la table suit la pente le long de la rangée (poteaux
    // verticaux) ; sa rotation β en travers se fait autour d'un axe incliné de α (convention des
    // trackers, pvlib.tracking.calc_surface_orientation) : β' = acos(cos β · cos α),
    // azimut' = azimut − δ, δ = atan2(cos β · sin α, sin β), α > 0 quand l'axe descend vers
    // azimut − 90° (pvlib). Valeurs DÉRIVÉES : jamais écrites dans state.penteDeg / pan.azimuth.
    // La pente en travers ne change pas l'orientation d'une table, seulement Δz entre rangées.

    const SEUIL_DISPERSION_DEG = 3;
    const MAX_GROUPES_OMBRAGE = 50;
    const MAX_COUPLES_OMBRAGE = 3000;
    const RAD = Math.PI / 180;

    /** Orientation réelle (convention pvlib : azimut 180 = Sud). */
    function orientationReelle(tiltDeg, azimutPvlibDeg, axisTiltDeg) {
        const b = tiltDeg * RAD, a = axisTiltDeg * RAD;
        const tilt = Math.acos(Math.min(1, Math.max(-1, Math.cos(b) * Math.cos(a)))) / RAD;
        const delta = Math.atan2(Math.cos(b) * Math.sin(a), Math.sin(b)) / RAD;
        return { tilt, azimut: (((azimutPvlibDeg - delta) % 360) + 360) % 360 };
    }

    function normale(tiltDeg, azimutDeg) {
        const b = tiltDeg * RAD, z = azimutDeg * RAD;
        return { x: Math.sin(b) * Math.sin(z), y: Math.sin(b) * Math.cos(z), z: Math.cos(b) };
    }

    /**
     * Orientation équivalente d'un ensemble de tables : moyenne des normales pondérée par les
     * panneaux. dispersionDeg = plus grand écart angulaire entre une table et cette moyenne.
     * liste = [{ tilt, azimut, poids }] (pvlib) -> { tilt, azimut, dispersionDeg } ou null.
     */
    function orientationEquivalente(liste) {
        const s = { x: 0, y: 0, z: 0 };
        let total = 0;
        liste.forEach((o) => {
            const nn = normale(o.tilt, o.azimut);
            s.x += nn.x * o.poids; s.y += nn.y * o.poids; s.z += nn.z * o.poids;
            total += o.poids;
        });
        const norme = Math.hypot(s.x, s.y, s.z);
        if (!(total > 0) || !(norme > 0)) return null;
        const m = { x: s.x / norme, y: s.y / norme, z: s.z / norme };
        const tilt = Math.acos(Math.min(1, m.z)) / RAD;
        const azimut = Math.hypot(m.x, m.y) < 1e-12 ? 180 : (((Math.atan2(m.x, m.y) / RAD) % 360) + 360) % 360;
        let dispersionDeg = 0;
        liste.forEach((o) => {
            const nn = normale(o.tilt, o.azimut);
            const c = Math.min(1, Math.max(-1, nn.x * m.x + nn.y * m.y + nn.z * m.z));
            dispersionDeg = Math.max(dispersionDeg, Math.acos(c) / RAD);
        });
        return { tilt, azimut, dispersionDeg };
    }

    /** pvlib (Sud = 180) -> convention des pans / PVGIS (Sud = 0, Ouest = +90), dans ]-180, 180]. */
    function azimutPvgis(azimutPvlib) {
        let a = azimutPvlib - 180;
        while (a <= -180) a += 360;
        while (a > 180) a -= 360;
        return a;
    }

    /** Profondeur d'un shed le long de la pente (m) : même règle que sheds_actions.evaluer. */
    function largeurCapteurM(state) {
        const n = Math.max(1, Math.min(15, Math.round(Number(state.shedPanelsPerGroup) || 1)));
        const rampantMm = state.panelOrientation === 'paysage' ? (state.panelWidthMm || 0) : (state.panelLengthMm || 0);
        return (n * rampantMm + (n - 1) * (state.panelSpacingYMm || 0)) / 1000;
    }

    const arrondiPas = (v, pas) => Math.round(v / pas) * pas;

    /**
     * Géométrie d'ombrage d'un champ sur son terrain (synchrone, pur).
     * solLocal(x, y) -> altitude (m) dans le repère local du champ (x = Est, y = Nord), ou null.
     * options.analyse : résultat d'analyserChampAvecSol déjà calculé (sinon calculé ici).
     * ->
     *   requete : { collector_width, groupes: [{ tilt, surface_azimuth, axis_tilt, panneaux,
     *               couples: [{ pitch, cross_axis_slope, poids }] }] }   (POST du backend)
     *   pans : [{ panId, panneaux, tiltDeg, azimutDeg, tiltReelDeg, azimutReelDeg, dispersionDeg }]
     *   equivalent : { tiltReelDeg, azimutReelDeg, dispersionDeg, alerteDispersion }
     *   nbTables, nbTablesOmbrees, nbTablesSansSol, panneaux
     * Azimuts renvoyés hors requête : convention des pans (Sud = 0, Ouest = +90).
     * null si le champ n'a aucune table.
     */
    function geometrieOmbrage(state, solLocal, options) {
        const opts = options || {};
        const r = opts.analyse || analyserChampAvecSol(state, solLocal);
        const tables = (r && r.tables) || [];
        if (!tables.length) return null;

        // Table : position en (s le long de la rangée, v vers l'avant), orientation, axe sur le sol.
        const infos = tables.map((t) => {
            const C = t.centreEmprise;
            const cal = t.analyse ? t.analyse.calage : null;
            const pente = cal && Number.isFinite(cal.pente) ? cal.pente : 0;
            const tilt = Math.atan((t.geo && t.geo.tanInclinaison) || 0) / RAD;
            // AVANT de la table = n (orienté selon l'azimut du pan par tablesDuChamp).
            const avant = t.n;
            // Direction vers laquelle la table regarde (x = Est, y = Nord) -> azimut pvlib.
            const az = (((Math.atan2(avant.x, avant.y) / RAD) % 360) + 360) % 360;
            // Axe pvlib a = (−avant.y, avant.x) (azimut − 90°) ; α > 0 quand l'axe DESCEND vers a.
            // cal.pente = dz/du le long de u, donc pente vers a = pente · (a · u).
            const aU = -avant.y * t.u.x + avant.x * t.u.y;
            const axisTilt = -Math.atan(pente * aU) / RAD;
            return {
                t, panId: t.panId, s: C.x * t.u.x + C.y * t.u.y, v: C.x * avant.x + C.y * avant.y,
                L: t.longueurM, D: t.profondeurM, panneaux: t.panneaux.length, tilt, az, axisTilt,
                zAxe: cal && Number.isFinite(cal.zCentre) ? (uRel) => cal.zCentre + pente * uRel : null,
                reelle: orientationReelle(tilt, az, axisTilt),
            };
        });

        // Couples : pour chaque table, la rangée de devant la plus proche qui la recouvre (même pan).
        let nbTablesOmbrees = 0;
        infos.forEach((b) => {
            b.couples = [];
            const devant = infos.filter((f) => f !== b && f.panId === b.panId && (f.v - b.v) > 0.5 * b.D)
                .map((f) => {
                    const debut = Math.max(b.s - b.L / 2, f.s - f.L / 2), fin = Math.min(b.s + b.L / 2, f.s + f.L / 2);
                    return { f, dv: f.v - b.v, debut, fin };
                })
                .filter((c) => c.fin - c.debut > 1e-6);
            if (!devant.length) return;
            const dvMin = Math.min.apply(null, devant.map((c) => c.dv));
            let fractionTotale = 0;
            devant.filter((c) => c.dv <= dvMin + 0.5 * b.D).forEach((c) => {
                const fraction = Math.min((c.fin - c.debut) / b.L, 1 - fractionTotale);
                if (!(fraction > 0)) return;
                fractionTotale += fraction;
                const sMil = (c.debut + c.fin) / 2;
                const dz = b.zAxe && c.f.zAxe ? c.f.zAxe(sMil - c.f.s) - b.zAxe(sMil - b.s) : 0;
                b.couples.push({ pitch: c.dv, cross: Math.atan2(-dz, c.dv) / RAD, poids: b.panneaux * fraction });
            });
            if (b.couples.length) nbTablesOmbrees++;
        });

        // Regroupement : groupes (pan, pente d'axe arrondie), couples (pas, pente en travers
        // arrondis), avec arrondis élargis tant que le backend refuserait la charge.
        let pasAxe = 0.5, pasPitch = 0.05, pasPente = 0.1, groupes = [];
        for (let essai = 0; essai < 8; essai++) {
            const parGroupe = new Map();
            infos.forEach((i) => {
                const cle = i.panId + '|' + arrondiPas(i.axisTilt, pasAxe).toFixed(3);
                if (!parGroupe.has(cle)) parGroupe.set(cle, { infos: [], couples: new Map() });
                const g = parGroupe.get(cle);
                g.infos.push(i);
                i.couples.forEach((c) => {
                    const p = Math.max(pasPitch, arrondiPas(c.pitch, pasPitch)), x = arrondiPas(c.cross, pasPente);
                    const k = p.toFixed(3) + '|' + x.toFixed(3);
                    const e = g.couples.get(k)
                        || { pitch: +p.toFixed(3), cross_axis_slope: +Math.max(-45, Math.min(45, x)).toFixed(3), poids: 0 };
                    e.poids += c.poids;
                    g.couples.set(k, e);
                });
            });
            groupes = Array.from(parGroupe.values()).map((g) => {
                const panneaux = g.infos.reduce((n, i) => n + i.panneaux, 0);
                const moy = (cle) => g.infos.reduce((s, i) => s + i[cle] * i.panneaux, 0) / panneaux;
                return {
                    tilt: +moy('tilt').toFixed(4),
                    surface_azimuth: (+g.infos[0].az.toFixed(4)) % 360,
                    axis_tilt: +moy('axisTilt').toFixed(4),
                    panneaux,
                    couples: Array.from(g.couples.values()).map((c) => Object.assign(c, { poids: Math.min(c.poids, panneaux) })),
                };
            });
            const nbCouples = groupes.reduce((n, g) => n + g.couples.length, 0);
            if (groupes.length <= MAX_GROUPES_OMBRAGE && nbCouples <= MAX_COUPLES_OMBRAGE) break;
            pasAxe *= 2; pasPitch *= 2; pasPente *= 2;
        }

        // Orientation équivalente par pan, puis du champ (option a, alerte si dispersion > 3°).
        const parPan = new Map();
        infos.forEach((i) => {
            if (!parPan.has(i.panId)) parPan.set(i.panId, []);
            parPan.get(i.panId).push(i);
        });
        const pans = Array.from(parPan.entries()).map(([panId, liste]) => {
            const eq = orientationEquivalente(liste.map((i) => ({ tilt: i.reelle.tilt, azimut: i.reelle.azimut, poids: i.panneaux })));
            return {
                panId, panneaux: liste.reduce((n, i) => n + i.panneaux, 0),
                tiltDeg: liste[0].tilt, azimutDeg: azimutPvgis(liste[0].az),
                tiltReelDeg: eq.tilt, azimutReelDeg: azimutPvgis(eq.azimut), dispersionDeg: eq.dispersionDeg,
            };
        });
        const eqChamp = orientationEquivalente(infos.map((i) => ({ tilt: i.reelle.tilt, azimut: i.reelle.azimut, poids: i.panneaux })));
        return {
            requete: { collector_width: largeurCapteurM(state), groupes },
            pans,
            equivalent: {
                tiltReelDeg: eqChamp.tilt, azimutReelDeg: azimutPvgis(eqChamp.azimut),
                dispersionDeg: eqChamp.dispersionDeg, alerteDispersion: eqChamp.dispersionDeg > SEUIL_DISPERSION_DEG,
            },
            nbTables: infos.length, nbTablesOmbrees,
            nbTablesSansSol: infos.filter((i) => !i.zAxe).length,
            panneaux: infos.reduce((n, i) => n + i.panneaux, 0),
        };
    }

    // ── Analyse des champs de la carte (grille partagée avec les plans et la 3D) ───────────────

    const resultatsParSource = new Map();   // sourceId -> { signature, source, tables, synthese }
    const enCours = new Map();

    function plat(ll) {
        return { lat: typeof ll.lat === 'function' ? ll.lat() : ll.lat, lng: typeof ll.lng === 'function' ? ll.lng() : ll.lng };
    }

    function champ(sourceId) {
        if (typeof CM.listerChampsCarte !== 'function') return null;
        try {
            return CM.listerChampsCarte().find((c) => c.sourceId === sourceId) || null;
        } catch (e) {
            return null;
        }
    }

    function signature(tables, state) {
        return JSON.stringify([
            state.petitChampLowPointHeightM, state.petitChampModel, seuilsDuChamp(state),
            tables.map((t) => [t.panId, t.coins.map((c) => [c.x.toFixed(2), c.y.toFixed(2)])]),
        ]);
    }

    /**
     * Analyse d'un champ PV de la carte (async : charge la grille de terrain). Champ sans table shed
     * -> null. Résultat mis en cache tant que les tables et les réglages ne changent pas.
     */
    async function analyserChamp(sourceId) {
        const c = champ(sourceId);
        if (!c || !c.origin) return null;
        const T = window.CalepinageMaisonTerrain;
        // Petit champ solaire AU SOL seulement : des sheds sur toiture terrasse ne reposent pas sur le terrain.
        const tm = typeof CM.normalizeTypeMontage === 'function' ? CM.normalizeTypeMontage(c.state.typeMontage) : c.state.typeMontage;
        const tables = tm === 'champ_solaire' ? tablesDuChamp(c.state) : [];
        if (!tables.length || !T) {
            resultatsParSource.delete(sourceId);
            return null;
        }
        const sig = signature(tables, c.state);
        const connu = resultatsParSource.get(sourceId);
        if (connu && connu.signature === sig) return connu;
        if (enCours.has(sourceId) && enCours.get(sourceId).signature === sig) return enCours.get(sourceId).promesse;

        const promesse = (async () => {
            const coins = [];
            tables.forEach((t) => t.coins.forEach((p) => coins.push(plat(CM.localToLatLng(c.origin, p)))));
            const grille = await T.grillePourPoints(coins, { margeM: MARGE_GRILLE_M });
            const solLocal = (x, y) => {
                const ll = plat(CM.localToLatLng(c.origin, { x, y }));
                return grille.altitude(ll.lat, ll.lng);
            };
            const r = analyserChampAvecSol(c.state, solLocal);
            const resultat = Object.assign(r, { sourceId, signature: sig, source: grille.source, attribution: grille.attribution });
            // Gardés pour la carte des pentes et l'ajustement (pas de nouveau chargement).
            Object.defineProperty(resultat, 'solLocal', { value: solLocal, enumerable: false });
            Object.defineProperty(resultat, 'grille', { value: grille, enumerable: false });
            resultatsParSource.set(sourceId, resultat);
            document.dispatchEvent(new CustomEvent('terrainTablesAnalysees', { detail: { sourceId } }));
            return resultat;
        })();
        enCours.set(sourceId, { signature: sig, promesse });
        try {
            return await promesse;
        } finally {
            if (enCours.get(sourceId) && enCours.get(sourceId).promesse === promesse) enCours.delete(sourceId);
        }
    }

    /**
     * Géométrie d'ombrage avec terrain d'un état de champ (async). `state` peut être une COPIE
     * modifiée (configurations d'Optimisation) : la grille est chargée sur le CONTOUR du champ (+
     * marge), pas sur les tables actuelles, pour couvrir des configurations plus étendues ; la
     * grille déjà en mémoire est réutilisée (CalepinageMaisonTerrain.grillePourPoints).
     * -> geometrieOmbrage(...) + { source }, ou null (pas un petit champ au sol, aucune table).
     * Lève l'erreur du terrain (service indisponible…) : à l'appelant de décider.
     */
    async function geometrieOmbrageChamp(sourceId, state) {
        const c = champ(sourceId);
        const T = window.CalepinageMaisonTerrain;
        if (!c || !c.origin || !T || !state) return null;
        const tm = typeof CM.normalizeTypeMontage === 'function' ? CM.normalizeTypeMontage(state.typeMontage) : state.typeMontage;
        if (tm !== 'champ_solaire') return null;
        const points = [];
        (state.pans || []).forEach((pan) => (pan.points || []).forEach((p) => points.push(plat(CM.localToLatLng(c.origin, p)))));
        if (!points.length) return null;
        const grille = await T.grillePourPoints(points, { margeM: MARGE_GRILLE_M });
        const solLocal = (x, y) => {
            const ll = plat(CM.localToLatLng(c.origin, { x, y }));
            return grille.altitude(ll.lat, ll.lng);
        };
        const g = geometrieOmbrage(state, solLocal);
        return g ? Object.assign(g, { source: grille.source }) : null;
    }

    /** Dernier résultat connu (synchrone, pour les rendus). */
    function resultat(sourceId) {
        return resultatsParSource.get(sourceId) || null;
    }

    /** Niveau de la table qui contient un panneau (pan, idxKey) ; null si inconnu. */
    function niveauPanneau(sourceId, panId, idxKey) {
        const r = resultatsParSource.get(sourceId);
        if (!r) return null;
        if (!r._index) {
            r._index = new Map();
            r.tables.forEach((t) => t.panneaux.forEach((k) => r._index.set(t.panId + '|' + k, t)));
        }
        const t = r._index.get(panId + '|' + idxKey);
        return t ? t.niveau : null;
    }

    // Planification (après recalcul / resynchronisation de la carte) : une analyse par champ, groupée.
    const aPlanifier = new Set();
    let minuterie = null;
    function planifier(sourceId) {
        if (!sourceId) return;
        aPlanifier.add(sourceId);
        clearTimeout(minuterie);
        minuterie = setTimeout(() => {
            const ids = Array.from(aPlanifier);
            aPlanifier.clear();
            ids.forEach((id) => analyserChamp(id).catch((e) => {
                // Pas de terrain (service indisponible, mer…) : pas de coloration, pas d'erreur bloquante.
                resultatsParSource.delete(id);
                if (e && e.code) console.info('[TerrainTables] analyse impossible pour', id, ':', e.code);
                else console.warn('[TerrainTables] analyse impossible pour', id, e);
                document.dispatchEvent(new CustomEvent('terrainTablesAnalysees', { detail: { sourceId: id } }));
            }));
        }, 400);
    }

    // ── Retrait / restauration des tables signalées ────────────────────────────────────────────

    function appliquerModification(sourceId, state) {
        if (CM.state && CM.state.sourceId === sourceId && typeof CM.recomputeResults === 'function') {
            CM.recomputeResults();
            if (typeof CM.render === 'function') CM.render();
        }
        if (typeof CM.persisterEtatChamp === 'function') CM.persisterEtatChamp(sourceId, 'terrainTablesRetirees');
        if (typeof CM.synchroniserPanneauxCarte === 'function') CM.synchroniserPanneauxCarte(sourceId);
    }

    /**
     * Supprime des panneaux [[panId, idxKey]] en les notant dans state.terrainTablesRetirees.
     * `ajoutes` (facultatif) reçoit les panneaux réellement supprimés (pas ceux qui l'étaient déjà).
     */
    function supprimerPanneaux(sourceId, st, liste, ajoutes) {
        if (!(st.deletedPanelIndicesByPan instanceof Map)) st.deletedPanelIndicesByPan = new Map();
        const retirees = Array.isArray(st.terrainTablesRetirees) ? st.terrainTablesRetirees.slice() : [];
        let n = 0;
        liste.forEach(([panId, k]) => {
            if (!st.deletedPanelIndicesByPan.has(panId)) st.deletedPanelIndicesByPan.set(panId, new Set());
            const set = st.deletedPanelIndicesByPan.get(panId);
            if (set.has(k)) return;
            set.add(k);
            retirees.push([panId, k]);
            if (ajoutes) ajoutes.push([panId, k]);
            n++;
        });
        if (!n) return 0;
        st.terrainTablesRetirees = retirees;
        appliquerModification(sourceId, st);
        return n;
    }

    /**
     * Retire (supprime les panneaux) des tables dont le niveau est dans `niveaux` (défaut : hors
     * seuils). Réversible : les panneaux retirés sont notés dans state.terrainTablesRetirees.
     * -> nombre de tables retirées.
     */
    function retirerTables(sourceId, niveaux) {
        const r = resultatsParSource.get(sourceId);
        const c = champ(sourceId);
        if (!r || !c) return 0;
        const cibles = r.tables.filter((t) => (niveaux || HORS_SEUILS).includes(t.niveau));
        const liste = [];
        cibles.forEach((t) => t.panneaux.forEach((k) => liste.push([t.panId, k])));
        return supprimerPanneaux(sourceId, c.state, liste) ? cibles.length : 0;
    }

    /** Seuils du champ (lecture). */
    function seuils(sourceId) {
        const c = champ(sourceId);
        return seuilsDuChamp(c && c.state);
    }

    /**
     * Change les seuils d'un champ : reclasse aussitôt les tables (sans recharger le terrain),
     * persiste, et prévient la carte / le canevas / la 3D.
     */
    function definirSeuils(sourceId, nouveaux) {
        const c = champ(sourceId);
        if (!c) return null;
        const s = normaliserSeuils(Object.assign({}, seuilsDuChamp(c.state), nouveaux || {}));
        c.state.terrainSeuils = s;
        const r = resultatsParSource.get(sourceId);
        if (r) {
            r.tables.forEach((t) => { if (t.analyse) t.niveau = classer(t.analyse, t.geo.hBasM, s); });
            r.synthese = synthese(r.tables);
            r.seuils = s;
            r.signature = signature(tablesDuChamp(c.state), c.state);
            r._index = null;
        }
        if (typeof CM.persisterEtatChamp === 'function') CM.persisterEtatChamp(sourceId, 'terrainSeuils');
        document.dispatchEvent(new CustomEvent('terrainTablesAnalysees', { detail: { sourceId, seuils: true } }));
        return s;
    }

    /**
     * Proposition d'ajustement des tables hors seuils : pour chacune, la meilleure partie à garder
     * (raccourcie ou scindée). -> { sourceId, tables: [{ index, panId, troncons, panneauxRetires,
     * colonnesGardees, nbColonnes, table }], panneauxRetires, panneauxSiRetraitComplet }
     */
    function proposerAjustement(sourceId) {
        const r = resultatsParSource.get(sourceId);
        const c = champ(sourceId);
        if (!r || !c || typeof r.solLocal !== 'function') return null;
        const pans = new Map((c.state.pans || []).map((p) => [p.id, p]));
        const s = seuilsDuChamp(c.state);
        const tables = r.tables.filter((t) => HORS_SEUILS.includes(t.niveau)).map((t) => {
            const aj = ajusterTable(t, c.state, pans.get(t.panId), r.solLocal, s);
            return Object.assign({ index: t.index, panId: t.panId, nbColonnes: t.nbColonnes, table: t }, aj);
        });
        return {
            sourceId, tables,
            panneauxRetires: tables.reduce((n, t) => n + t.panneauxRetires.length, 0),
            panneauxSiRetraitComplet: tables.reduce((n, t) => n + t.table.panneaux.length, 0),
        };
    }

    /** Applique une proposition d'ajustement (réversible par restaurerTables). */
    function appliquerAjustement(proposition) {
        if (!proposition) return 0;
        const c = champ(proposition.sourceId);
        if (!c) return 0;
        const liste = [];
        proposition.tables.forEach((t) => t.panneauxRetires.forEach((k) => liste.push([t.panId, k])));
        return supprimerPanneaux(proposition.sourceId, c.state, liste);
    }

    /** Remet les panneaux retirés par retirerTables (pas ceux supprimés à la main). */
    function restaurerTables(sourceId) {
        const c = champ(sourceId);
        if (!c) return 0;
        const st = c.state;
        const retirees = Array.isArray(st.terrainTablesRetirees) ? st.terrainTablesRetirees : [];
        if (!retirees.length) return 0;
        retirees.forEach(([panId, k]) => {
            const set = st.deletedPanelIndicesByPan instanceof Map ? st.deletedPanelIndicesByPan.get(panId) : null;
            if (set) set.delete(k);
        });
        st.terrainTablesRetirees = [];
        historiqueSuppressions.delete(sourceId);
        appliquerModification(sourceId, st);
        return retirees.length;
    }

    // ── Suppression manuelle d'une table ou d'une rangée de sheds (mode activé dans la légende) ──
    // Même mécanisme que le retrait des tables hors seuils (state.terrainTablesRetirees : réversible
    // par « Restaurer ») ; l'historique de la session permet en plus d'annuler la dernière.
    const historiqueSuppressions = new Map();   // sourceId -> [[[panId, idxKey]]]

    /** Tables posées d'un champ de la carte (ne demande pas de terrain). */
    function tablesPosees(sourceId) {
        const c = champ(sourceId);
        return c ? tablesDuChamp(c.state) : [];
    }

    /** Tables visées : la table seule, ou toute sa rangée (même pan, même module de sheds). */
    function tablesVisees(tables, table, portee) {
        if (!table) return [];
        if (portee !== 'rangee') return [table];
        return tables.filter((t) => t.panId === table.panId && t.module === table.module);
    }

    /** Supprime une table (portee 'table') ou sa rangée ('rangee'). -> nombre de panneaux supprimés. */
    function supprimerTable(sourceId, table, portee) {
        const c = champ(sourceId);
        if (!c || !table) return 0;
        const liste = [];
        tablesVisees(tablesDuChamp(c.state), table, portee).forEach((t) => t.panneaux.forEach((k) => liste.push([t.panId, k])));
        const ajoutes = [];
        supprimerPanneaux(sourceId, c.state, liste, ajoutes);
        if (ajoutes.length) {
            if (!historiqueSuppressions.has(sourceId)) historiqueSuppressions.set(sourceId, []);
            historiqueSuppressions.get(sourceId).push(ajoutes);
        }
        return ajoutes.length;
    }

    function nbSuppressionsAnnulables(sourceId) {
        return (historiqueSuppressions.get(sourceId) || []).length;
    }

    /** Remet les panneaux de la dernière suppression manuelle. -> nombre de panneaux remis. */
    function annulerDerniereSuppression(sourceId) {
        const pile = historiqueSuppressions.get(sourceId);
        const c = champ(sourceId);
        if (!pile || !pile.length || !c) return 0;
        const derniere = pile.pop();
        const st = c.state;
        const cles = new Set(derniere.map(([panId, k]) => panId + '|' + k));
        derniere.forEach(([panId, k]) => {
            const set = st.deletedPanelIndicesByPan instanceof Map ? st.deletedPanelIndicesByPan.get(panId) : null;
            if (set) set.delete(k);
        });
        st.terrainTablesRetirees = (Array.isArray(st.terrainTablesRetirees) ? st.terrainTablesRetirees : [])
            .filter(([panId, k]) => !cles.has(panId + '|' + k));
        appliquerModification(sourceId, st);
        return derniere.length;
    }

    const api = {
        SEUIL_PENTE_ATTENTION_PCT, SEUIL_PENTE_ALERTE_PCT, SEUILS_DEFAUT, NIVEAUX, HORS_SEUILS, MIN_COLONNES_TABLE,
        postesPourLongueur, calerTable, niveauPente, normaliserSeuils, seuilsDuChamp, classer, analyserTable, gardePlat, gardesPlat,
        tablesDuChamp, construireTable, analyserChampAvecSol, ajusterTable, synthese,
        analyserChamp, resultat, niveauPanneau, planifier, retirerTables, restaurerTables,
        seuils, definirSeuils, proposerAjustement, appliquerAjustement,
        tablesPosees, tablesVisees, supprimerTable, annulerDerniereSuppression, nbSuppressionsAnnulables,
        SEUIL_DISPERSION_DEG, orientationReelle, orientationEquivalente, azimutPvgis, geometrieOmbrage, geometrieOmbrageChamp,
    };
    window.CalepinageMaisonTerrainTables = api;
    CM.terrainTables = api;
})();
