/**
 * Calepinage résidentiel — SCÈNE D'OMBRAGE PROCHE pour le calcul de production.
 *
 * Rassemble, pour TOUS les champs PV dessinés sur la carte, la géométrie qui sert au calcul
 * d'ombrage côté serveur (app/models/calcul_prodsolaire/calcul_ombrage_proche.py) :
 *   - receivers : les panneaux de chaque champ PV (un champ = un pan, même identifiant que
 *     getAllPvFieldSummaries : `${sourceId}_${pan.id}` sans espaces), 4 coins 3D par panneau ;
 *   - occluders : triangles des volumes qui portent ombre — toitures, pignons, murs, acrotères,
 *     obstacles de toiture (cheminée, vélux...) et objets 3D posés (arbres, blocs...), chacun avec
 *     sa transmission lumineuse (0 = opaque ; feuillage : cf. scene_objects_library.js).
 * Les panneaux d'un champ sont aussi des obstacles pour les autres champs (ombrières voisines,
 * champs sur plusieurs pans...) : le serveur les ajoute lui-même depuis `receivers`.
 *
 * Repère : mètres, x = Est, y = altitude, z = Nord, origine = repère local du 1er champ de la carte.
 * Chaque champ est ramené dans ce repère par une simple translation (même règle que la vue 3D
 * combinée, cf. getOtherHousesReprojected). Sol plat (le relief MNT n'est pas encore pris en compte).
 *
 * Persistance : aucune donnée nouvelle — tout est recalculé depuis l'état déjà persisté de chaque
 * champ (contour, pans, obstacles, sceneObjects3D : localStorage calepinage_maison_v1 + base au clic
 * « Calculer et visualiser »). La scène est seulement recopiée dans solarProjectData.shadingScene au
 * moment où les champs PV y sont écrits (SummaryModal / ResidentielAutoconsoEmbed), pour que le
 * module de calcul (iframe index_autoconso.html) l'envoie avec les champs à /calculate_pv.
 *
 * Ajouter un nouveau type d'objet au calcul : lui écrire un descripteur `shading(params)` dans
 * scene_objects_library.js (boîte, cylindre, cône, ellipsoïde) — rien à changer ici ni côté serveur.
 */
(function () {
    const CM = window.CalepinageMaisonIndiv;
    if (!CM) return;

    const SCENE_VERSION = 1;
    // Au-delà, la scène n'est pas recopiée dans solarProjectData (quota du localStorage) : le calcul
    // se fait alors sans ombrage proche, avec un avertissement en console.
    const TAILLE_MAX_SCENE = 1500000;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const borner = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    // Position d'un objet 3D ou d'un obstacle : à ±250 m au plus de l'origine du champ (x = Est,
    // z = Nord ; valeurs négatives = à l'ouest / au sud de l'origine).
    const POSITION_MAX_M = 250;

    // --- Maillage des primitives d'objets (repère local de l'objet) ---------------------------------
    function quad(tris, a, b, c, d) { tris.push(a, b, c, a, c, d); }

    function mailleBoite(p) {
        const hx = p.longueur / 2, hy = p.hauteur / 2, hz = p.largeur / 2;
        const v = (sx, sy, sz) => [p.cx + sx * hx, p.cy + sy * hy, p.cz + sz * hz];
        const t = [];
        quad(t, v(-1, -1, -1), v(1, -1, -1), v(1, 1, -1), v(-1, 1, -1));
        quad(t, v(1, -1, -1), v(1, -1, 1), v(1, 1, 1), v(1, 1, -1));
        quad(t, v(1, -1, 1), v(-1, -1, 1), v(-1, 1, 1), v(1, 1, 1));
        quad(t, v(-1, -1, 1), v(-1, -1, -1), v(-1, 1, -1), v(-1, 1, 1));
        quad(t, v(-1, 1, -1), v(1, 1, -1), v(1, 1, 1), v(-1, 1, 1));
        quad(t, v(-1, -1, -1), v(-1, -1, 1), v(1, -1, 1), v(1, -1, -1));
        return t;
    }

    // Cylindre (rayonHaut = rayon) ou cône (rayonHaut = 0), axe vertical, fermé en haut et en bas.
    function mailleRevolution(p, rayonHaut, n) {
        n = n || 12;
        const t = [];
        const anneau = (y, r) => Array.from({ length: n }, (_, i) => {
            const a = (2 * Math.PI * i) / n;
            return [p.cx + r * Math.cos(a), y, p.cz + r * Math.sin(a)];
        });
        const bas = anneau(p.y0, p.rayon);
        const centreBas = [p.cx, p.y0, p.cz], centreHaut = [p.cx, p.y1, p.cz];
        if (rayonHaut > 0) {
            const haut = anneau(p.y1, rayonHaut);
            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n;
                quad(t, bas[i], bas[j], haut[j], haut[i]);
                t.push(centreHaut, haut[i], haut[j]);
            }
        } else {
            for (let i = 0; i < n; i++) t.push(bas[i], bas[(i + 1) % n], centreHaut);
        }
        for (let i = 0; i < n; i++) t.push(centreBas, bas[(i + 1) % n], bas[i]);
        return t;
    }

    function mailleEllipsoide(p, nLat, nLon) {
        nLat = nLat || 6; nLon = nLon || 12;
        const pt = (i, j) => {
            const th = (Math.PI * i) / nLat, ph = (2 * Math.PI * j) / nLon;
            return [p.cx + p.rx * Math.sin(th) * Math.cos(ph), p.cy + p.ry * Math.cos(th), p.cz + p.rz * Math.sin(th) * Math.sin(ph)];
        };
        const t = [];
        for (let i = 0; i < nLat; i++) {
            for (let j = 0; j < nLon; j++) quad(t, pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j));
        }
        return t;
    }

    // Faces planes convexes (toitures, pignons, pyramide) -> éventail de triangles. Une face invalide
    // (moins de 3 sommets, coordonnée non numérique) est ignorée, pas tout l'objet.
    function maillePolyedre(faces) {
        if (!Array.isArray(faces)) return null;
        const t = [];
        faces.forEach((f) => {
            if (!Array.isArray(f) || f.length < 3) return;
            if (!f.every((v) => Array.isArray(v) && v.length === 3 && v.every((c) => isFinite(Number(c))))) return;
            for (let k = 1; k + 1 < f.length; k++) t.push(f[0], f[k], f[k + 1]);
        });
        return t.length ? t : null;
    }

    function maillePrimitive(p) {
        if (!p || typeof p !== 'object') return null;
        const ok = (...v) => v.every((x) => isFinite(Number(x)));
        switch (p.forme) {
            case 'boite': return ok(p.cx, p.cy, p.cz, p.longueur, p.hauteur, p.largeur) ? mailleBoite(p) : null;
            case 'cylindre': return ok(p.cx, p.cz, p.y0, p.y1, p.rayon) ? mailleRevolution(p, p.rayon) : null;
            case 'cone': return ok(p.cx, p.cz, p.y0, p.y1, p.rayon) ? mailleRevolution(p, 0) : null;
            case 'ellipsoide': return ok(p.cx, p.cy, p.cz, p.rx, p.ry, p.rz) ? mailleEllipsoide(p) : null;
            case 'polyedre': return maillePolyedre(p.faces);
            default: return null;
        }
    }

    // --- Triangulation d'un polygone de toiture (plan, jamais vertical) : oreilles en projection xz --
    function trianguler(poly) {
        const n = poly.length;
        if (n < 3) return [];
        if (n === 3) return [[poly[0], poly[1], poly[2]]];
        const aire2 = poly.reduce((s, p, i) => {
            const q = poly[(i + 1) % n];
            return s + (p.x * q.z - q.x * p.z);
        }, 0);
        const sens = aire2 >= 0 ? 1 : -1;
        const cross = (a, b, c) => ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) * sens;
        const dedans = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
        const idx = poly.map((_, i) => i);
        const tris = [];
        let garde = n * n;
        while (idx.length > 3 && garde-- > 0) {
            let coupe = false;
            for (let k = 0; k < idx.length; k++) {
                const a = poly[idx[(k + idx.length - 1) % idx.length]], b = poly[idx[k]], c = poly[idx[(k + 1) % idx.length]];
                if (cross(a, b, c) <= 1e-12) continue; // sommet rentrant ou aligné
                const autre = idx.some((j) => {
                    const p = poly[j];
                    return p !== a && p !== b && p !== c && dedans(p, a, b, c);
                });
                if (autre) continue;
                tris.push([a, b, c]);
                idx.splice(k, 1);
                coupe = true;
                break;
            }
            if (!coupe) break; // polygone dégénéré : repli en éventail sur le reste
        }
        for (let k = 1; k + 1 < idx.length; k++) tris.push([poly[idx[0]], poly[idx[k]], poly[idx[k + 1]]]);
        return tris;
    }

    // --- Construction de la scène -------------------------------------------------------------------
    function fieldIdOf(sourceId, pan, suffixe) {
        return `${sourceId}_${pan.id}${suffixe || ''}`.replace(/\s+/g, '');
    }

    /**
     * Écrit les récepteurs d'un pan : un seul champ, sauf en dôme où chaque côté des rangées est un
     * champ distinct (même découpage que getAllPvFieldSummaries, cf. CM.champsDuPan) — l'id doit
     * être celui du champ envoyé au calcul de production. `quads[i]` = 4 coins 3D du panneau i.
     */
    function ecrireRecepteurs(receivers, sourceId, pan, panels, quads, state) {
        const plat = (listeDePoints) => [].concat(...listeDePoints);
        const enDome = pan.poseMode === 'dome' || (!pan.poseMode && state.poseMode === 'dome');
        if (!enDome) {
            const liste = quads.filter(Boolean);
            if (liste.length) receivers[fieldIdOf(sourceId, pan)] = { panels: plat(liste) };
            return;
        }
        [0, 1].forEach((cote) => {
            const liste = quads.filter((q, i) => q && (CM.coteDomePanneau(panels[i].panelIndex, state) === 0 ? 0 : 1) === cote);
            if (liste.length) receivers[fieldIdOf(sourceId, pan, CM.SUFFIXES_CHAMP_DOME[cote])] = { panels: plat(liste) };
        });
    }

    function buildShadingScene() {
        const champs = (typeof CM.listerChampsCarte === 'function') ? CM.listerChampsCarte() : [];
        if (!champs.length) return null;
        const ref = champs[0].origin;
        const receivers = {};
        const occluders = [];
        const ignored = [];
        const lib = window.OBJECT_LIBRARY || {};

        champs.forEach(({ sourceId, state, origin }) => {
            let off;
            try { off = CM.latLngToLocal(ref, CM.localToLatLng(origin, { x: 0, y: 0 })); } catch (e) { return; }
            // Point de buildOneBuilding ({x, y: altitude, z} avec center = 0) -> repère commun.
            const W3 = (p) => [r3(p.x + off.x), r3(p.y), r3(p.z + off.y)];
            // Point planaire du calepinage ({x, y} local) + altitude -> repère commun.
            const W2 = (p, elev) => [r3(p.x + off.x), r3(elev), r3(p.y + off.y)];
            const plat = (listeDePoints) => [].concat(...listeDePoints);
            const ajouter = (label, triangles, transmission, transmissionHiver) => {
                if (!triangles.length) return;
                occluders.push({
                    label, owner: null,
                    transmission: transmission || 0,
                    transmission_winter: (transmissionHiver != null) ? transmissionHiver : null,
                    triangles: plat(triangles),
                });
            };
            const quadsEnTriangles = (quads) => {
                const t = [];
                (quads || []).forEach((q) => { if (q && q.length === 4) quad(t, W3(q[0]), W3(q[1]), W3(q[2]), W3(q[3])); });
                return t;
            };

            const precedent = CM.state;
            CM.state = state; // packPanelsForPan & co. lisent CM.state (même bascule que getAllPvFieldSummaries)
            try {
                const pans = state.pans || [];
                const panelsByPan = pans.map((pan) => { try { return CM.packPanelsForPan(pan) || []; } catch (e) { return []; } });
                let formOmbriere = null, formPetitChamp = null;
                try { if (typeof CM.getFormOmbriereObject === 'function') formOmbriere = CM.getFormOmbriereObject(); } catch (e) { formOmbriere = null; }
                try { if (typeof CM.getFormPetitChampObject === 'function') formPetitChamp = CM.getFormPetitChampObject(); } catch (e) { formPetitChamp = null; }

                if (formOmbriere || formPetitChamp) {
                    // Ombrière / petit champ solaire : pas de bâtiment, les panneaux sont portés par la
                    // structure à sa hauteur basse, inclinés à la pente du pan (sheds : par module).
                    const params = (formOmbriere || formPetitChamp).params || {};
                    const hauteurBasse = Number(params.lowPointHeight) || (formOmbriere ? Number(state.batimentHeightM) || 2.5 : 0.8);
                    pans.forEach((pan, i) => {
                        const panels = panelsByPan[i];
                        if (!panels.length) return;
                        const versQuad = (coins) => plat(coins.map((c) => W2(c, c.elev)));
                        let quads;
                        if (pan.poseMode === 'dome') {
                            // Dôme : chaque côté incliné à domeTiltDeg vers son propre azimut.
                            const azimuts = CM.azimutsCotesDome(pan, panels[0].angle);
                            quads = new Array(panels.length);
                            [0, 1].forEach((cote) => {
                                const idx = [];
                                panels.forEach((p, k) => { if ((CM.coteDomePanneau(p.panelIndex, state) === 0 ? 0 : 1) === cote) idx.push(k); });
                                if (!idx.length) return;
                                CM.liftPanelsTilted(idx.map((k) => panels[k]), {
                                    baseElevation: () => hauteurBasse,
                                    tiltDeg: Number(state.domeTiltDeg) || 0,
                                    azimuthDeg: azimuts[cote],
                                    groupSize: 1,
                                }).forEach((coins, j) => { quads[idx[j]] = versQuad(coins); });
                            });
                        } else {
                            quads = CM.liftPanelsTilted(panels, {
                                baseElevation: () => hauteurBasse,
                                tiltDeg: CM.effectivePenteDegForPan(pan, state),
                                azimuthDeg: pan.azimuth,
                                groupSize: pan.poseMode === 'shed' ? state.shedPanelsPerGroup : 0,
                            }).map(versQuad);
                        }
                        ecrireRecepteurs(receivers, sourceId, pan, panels, quads, state);
                    });
                    // Pas de toiture sous une structure autoportée : tous ses obstacles 2D sont au sol
                    // (même géométrie que la vue 3D, cf. CM.groundObstacleGroupsFor).
                    CM.groundObstacleGroupsFor(state.obstacles, { x: 0, z: 0 })
                        .forEach((g) => ajouter(`obstacle ${g.label} ${sourceId}`, quadsEnTriangles(g.quads)));
                } else {
                    const b = CM.buildOneBuilding({
                        sourceId,
                        footprint: state.roofLocal || [],
                        pans,
                        panelsByPan,
                        wallHeight: state.batimentHeightM,
                        railHeightMm: state.railHeightMm,
                        penteDeg: state.penteDeg,
                        penteDeg2: state.penteDeg2,
                        domeTiltDeg: state.domeTiltDeg,
                        overhangRampant: state.overhangRampant,
                        overhangLongpan: state.overhangLongpan,
                        divisionMode: state.divisionMode,
                        lastTwoPanKind: state.lastTwoPanKind,
                        faitageAsymType: state.faitageAsymType,
                        ridgeLines: state.ridgeLines,
                        typeMontage: state.typeMontage,
                        acrotereHeightM: state.acrotereHeightM,
                        obstacles: state.obstacles,
                        center: { x: 0, z: 0 },
                        dalleShedHorizontale: true,
                        panneauxShedInclines: true,
                        shedPanelsPerGroup: state.shedPanelsPerGroup,
                    });
                    pans.forEach((pan, i) => {
                        const quads = (b.panelQuadsByPan || [])[i] || [];
                        if (!quads.length) return;
                        ecrireRecepteurs(receivers, sourceId, pan, panelsByPan[i], quads.map((q) => plat(q.map(W3))), state);
                    });
                    const toiture = [];
                    (b.roofPolys || []).forEach((poly) => trianguler(poly).forEach((tri) => toiture.push(...tri.map(W3))));
                    ajouter(`toiture ${sourceId}`, toiture);
                    ajouter(`pignons et murs ${sourceId}`, quadsEnTriangles((b.skirtQuads || []).concat(b.wallQuads || [])));
                    ajouter(`acrotère ${sourceId}`, quadsEnTriangles(b.parapetQuads));
                    (b.obstacleGroups || []).forEach((g) => ajouter(`obstacle de toiture ${sourceId}`, quadsEnTriangles(g.quads)));
                    // Obstacles 2D hors de tout pan : posés au sol (cf. CM.groundObstacleGroupsFor).
                    (b.groundObstacleGroups || []).forEach((g) => ajouter(`obstacle ${g.label} ${sourceId}`, quadsEnTriangles(g.quads)));
                }

                // Objets 3D posés dans la scène de CE champ (repère local du champ, x = Est, z = Nord).
                (state.sceneObjects3D || []).forEach((o) => {
                    const def = o && lib[o.typeKey];
                    if (!def || typeof def.shading !== 'function') {
                        ignored.push({ typeKey: o && o.typeKey, label: (def && def.label) || (o && o.typeKey) || '?', champ: sourceId,
                            reason: "volume d'ombrage non défini pour ce type d'objet" });
                        return;
                    }
                    let primitives = [];
                    const params = (typeof window.sanitizeSceneObjectParams === 'function')
                        ? window.sanitizeSceneObjectParams(o.typeKey, o.params || {}) : (o.params || {});
                    try { primitives = def.shading(params) || []; } catch (e) { primitives = []; }
                    // Même rotation que le viewer (Babylon, rotation.y) : x' = x cos + z sin, z' = -x sin + z cos.
                    const th = ((((Number(o.rotationDeg) || 0) % 360) + 360) % 360 * Math.PI) / 180;
                    const cos = Math.cos(th), sin = Math.sin(th);
                    // Position bornée à ±POSITION_MAX_M de l'origine du champ (cf. CM.SCENE_LIMITES).
                    const ox = borner(Number(o.x) || 0, -POSITION_MAX_M, POSITION_MAX_M);
                    const oz = borner(Number(o.z) || 0, -POSITION_MAX_M, POSITION_MAX_M);
                    const placer = (v) => [
                        r3(ox + v[0] * cos + v[2] * sin + off.x),
                        r3(v[1]),
                        r3(oz - v[0] * sin + v[2] * cos + off.y),
                    ];
                    primitives.forEach((p) => {
                        const tris = maillePrimitive(p);
                        if (!tris) return;
                        ajouter(`${def.label} (${sourceId})`, tris.map(placer),
                            Math.min(1, Math.max(0, Number(p.transmission) || 0)),
                            p.transmissionHiver != null ? Math.min(1, Math.max(0, Number(p.transmissionHiver))) : null);
                    });
                });
            } catch (e) {
                console.warn(`[Ombrage proche] Champ ${sourceId} ignoré dans la scène d'ombrage :`, e);
            } finally {
                CM.state = precedent;
            }
        });

        if (!Object.keys(receivers).length) return null;
        // Rattachement au PROJET : le module de calcul (iframe) et le serveur refusent une scène dont
        // le projet n'est pas le projet actif (cf. getShadingScene, main_prodsolaire.js, et
        // _filtrer_scene_ombrage, main_prodsolaire.py — qui vérifie aussi que le projet appartient à
        // l'utilisateur connecté).
        let projetId = null;
        try { projetId = localStorage.getItem('current_projet_id'); } catch (e) { projetId = null; }
        return {
            version: SCENE_VERSION, projet_id: projetId || null, repere: 'x_est_y_haut_z_nord_m',
            receivers, occluders, ignored_objects: ignored,
        };
    }

    /**
     * Recopie la scène dans solarProjectData (objet déjà lu, écrit par l'appelant). Jamais bloquant :
     * en cas d'erreur ou de scène trop lourde, la clé est retirée et le calcul se fera sans ombrage proche.
     */
    function attachShadingSceneToProjectData(projectData) {
        if (!projectData || typeof projectData !== 'object') return;
        try {
            const scene = buildShadingScene();
            const taille = scene ? JSON.stringify(scene).length : 0;
            if (scene && taille <= TAILLE_MAX_SCENE) {
                projectData.shadingScene = scene;
                return;
            }
            if (scene) console.warn(`[Ombrage proche] Scène trop volumineuse (${taille} caractères) : calcul sans ombrage proche.`);
        } catch (e) {
            console.warn("[Ombrage proche] Construction de la scène d'ombrage impossible :", e);
        }
        delete projectData.shadingScene;
    }

    Object.assign(CM, { buildShadingScene, attachShadingSceneToProjectData });
})();
