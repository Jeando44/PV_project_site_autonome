// "Petit champ solaire" — construction RAPIDE d'un champ entier pour la vue 3D du calepinage
// (cible : ~25 000 panneaux). Les générateurs des 4 modèles (modele_*.js) créent une boîte Babylon
// par panneau, poteau, panne, bracon… : des dizaines de milliers d'objets à créer puis à dessiner,
// et autant à reconstruire à chaque action. Ici :
//   1. chaque table DISTINCTE (modèle + paramètres + longueur) est construite UNE fois par les
//      générateurs existants (même géométrie qu'avant), puis réduite à des tableaux de sommets
//      (« gabarit », mémorisé d'une reconstruction à l'autre) ;
//   2. chaque table du champ recopie son gabarit, tourné et calé sur le terrain par la règle
//      commune (CalepinageMaison3DTerrain.poserTablesPetitChamp) : les tables suivent le relief ;
//   3. les poteaux sont recréés VERTICAUX, de la traverse jusqu'au sol exact sous chacun d'eux :
//      rien n'est dessiné sous le sol (un plot de fondation éventuel est posé sur le sol, couleur
//      de la structure) ;
//   4. tout le champ tient en 2 maillages : panneaux et structure (2 matériaux partagés).
// Repère de travail : celui de la racine (TransformNode positionné et tourné par le viewer), sans
// passer par les matrices monde de Babylon.

const PETIT_CHAMP_NOM_POTEAU = /post|poteau/i;
const PETIT_CHAMP_NOM_PLOT = /anchor/i;
const PETIT_CHAMP_PORTEE_PLOT_M = 0.35;
const PETIT_CHAMP_POTEAU_MIN_M = 0.02;
const petitChampGabarits = new Map();   // clé -> gabarit (mémorisé entre reconstructions)

/** Sommets d'un gabarit en cours d'extraction (convertis en tableaux typés à la fin). */
function petitChampAccumulateur() {
    return { pos: [], nor: [], idx: [] };
}

/** Clé d'un gabarit : modèle + paramètres de LA table (sans la liste des tables du champ). */
function petitChampCleGabarit(model, shedParams) {
    const copie = Object.assign({}, shedParams);
    delete copie.shedLayout;
    return model + '|' + JSON.stringify(copie);
}

/**
 * Construit une table avec le générateur de son modèle et la réduit à des sommets dans le repère
 * de la table (pivot) : panneaux et structure rigide d'un côté, poteaux et plots décrits par leur
 * emprise (ils sont recréés au sol, table par table).
 */
function petitChampExtraireGabarit(scene, model, shedParams) {
    const racine = buildOnePetitChampShed(scene, model, shedParams);
    const g = { panneaux: petitChampAccumulateur(), structure: petitChampAccumulateur(), poteaux: [], plots: [] };
    try {
        // Matrices monde recalculées parent avant enfant (la racine est le repère de la table).
        racine.computeWorldMatrix(true);
        racine.getDescendants(false).forEach((n) => { if (typeof n.computeWorldMatrix === 'function') n.computeWorldMatrix(true); });
        const v = new BABYLON.Vector3();
        racine.getChildMeshes(false).forEach((m) => {
            if (!m.isVisible || !(m.getTotalVertices() > 0)) return;
            const wm = m.getWorldMatrix();
            const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            const nor = m.getVerticesData(BABYLON.VertexBuffer.NormalKind);
            const idx = m.getIndices();
            if (!pos || !idx) return;
            const nom = m.name || '';
            const pts = [];
            for (let i = 0; i < pos.length; i += 3) {
                BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], wm, v);
                pts.push(v.x, v.y, v.z);
            }
            const droit = !m.rotationQuaternion && Math.abs(m.rotation.x) < 1e-9 && Math.abs(m.rotation.z) < 1e-9;
            if ((PETIT_CHAMP_NOM_POTEAU.test(nom) || PETIT_CHAMP_NOM_PLOT.test(nom)) && droit) {
                let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
                for (let i = 0; i < pts.length; i += 3) {
                    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
                    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
                    z0 = Math.min(z0, pts[i + 2]); z1 = Math.max(z1, pts[i + 2]);
                }
                const emprise = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, demiX: (x1 - x0) / 2, demiZ: (z1 - z0) / 2, haut: y1, h: y1 - y0 };
                if (PETIT_CHAMP_NOM_PLOT.test(nom) && !PETIT_CHAMP_NOM_POTEAU.test(nom)) g.plots.push(emprise);
                else g.poteaux.push(emprise);
                return;
            }
            const cible = /Panel/.test(nom) ? g.panneaux : g.structure;
            const base = cible.pos.length / 3;
            for (let i = 0; i < pts.length; i++) cible.pos.push(pts[i]);
            if (nor) {
                for (let i = 0; i < nor.length; i += 3) {
                    BABYLON.Vector3.TransformNormalFromFloatsToRef(nor[i], nor[i + 1], nor[i + 2], wm, v);
                    v.normalize();
                    cible.nor.push(v.x, v.y, v.z);
                }
            } else {
                for (let i = 0; i < pts.length; i++) cible.nor.push(0);
            }
            for (let i = 0; i < idx.length; i++) cible.idx.push(base + idx[i]);
        });
    } finally {
        // Matériaux partagés (petitChampMaterials) conservés : seuls les maillages sont libérés.
        racine.dispose(false, false);
    }
    [g.panneaux, g.structure].forEach((a) => {
        a.pos = new Float32Array(a.pos);
        a.nor = new Float32Array(a.nor);
        a.idx = new Uint32Array(a.idx);
    });
    return g;
}

function petitChampGabarit(scene, model, shedParams) {
    const cle = petitChampCleGabarit(model, shedParams);
    let g = petitChampGabarits.get(cle);
    if (!g) {
        if (petitChampGabarits.size > 400) petitChampGabarits.clear();
        g = petitChampExtraireGabarit(scene, model, shedParams);
        petitChampGabarits.set(cle, g);
    }
    return g;
}

/** Tableaux finaux préalloués (remplis par position d'écriture nv / ni). */
function petitChampTampon(nbSommets, nbIndices) {
    return { pos: new Float32Array(nbSommets * 3), nor: new Float32Array(nbSommets * 3), idx: new Uint32Array(nbIndices), nv: 0, ni: 0 };
}

const PETIT_CHAMP_BOITE_SOMMETS = 20;   // 4 côtés + dessus (le dessous, posé sur le sol, est omis)
const PETIT_CHAMP_BOITE_INDICES = 30;

function petitChampSommet(t, x, y, z, nx, ny, nz) {
    const o = t.nv * 3;
    t.pos[o] = x; t.pos[o + 1] = y; t.pos[o + 2] = z;
    t.nor[o] = nx; t.nor[o + 1] = ny; t.nor[o + 2] = nz;
    t.nv++;
}

/** Boîte verticale (repère de la racine) : centre (cx, cz), de yBas à yHaut, tournée de `lacet`. */
function petitChampBoiteVerticale(t, cx, cz, yBas, yHaut, demiX, demiZ, lacet) {
    const c = Math.cos(lacet), s = Math.sin(lacet);
    // Rotation Babylon autour de Y : x' = x cos + z sin, z' = -x sin + z cos.
    const p = [[-demiX, -demiZ], [demiX, -demiZ], [demiX, demiZ], [-demiX, demiZ]]
        .map(([lx, lz]) => [cx + lx * c + lz * s, cz - lx * s + lz * c]);
    const quad = (pts, nx, ny, nz) => {
        const base = t.nv;
        pts.forEach((q) => petitChampSommet(t, q[0], q[1], q[2], nx, ny, nz));
        t.idx[t.ni++] = base; t.idx[t.ni++] = base + 1; t.idx[t.ni++] = base + 2;
        t.idx[t.ni++] = base; t.idx[t.ni++] = base + 2; t.idx[t.ni++] = base + 3;
    };
    for (let k = 0; k < 4; k++) {
        const a = p[k], b = p[(k + 1) % 4];
        const nx = b[1] - a[1], nz = -(b[0] - a[0]);
        const n = Math.hypot(nx, nz) || 1;
        quad([[a[0], yBas, a[1]], [b[0], yBas, b[1]], [b[0], yHaut, b[1]], [a[0], yHaut, a[1]]], nx / n, 0, nz / n);
    }
    quad(p.map((a) => [a[0], yHaut, a[1]]), 0, 1, 0);
}

/** Maillage final, enfant de la racine (repère local = celui de la racine). */
function petitChampMaillage(scene, racine, nom, t, materiau, nbTables) {
    if (!t.ni) return null;
    const vd = new BABYLON.VertexData();
    vd.positions = t.pos.subarray(0, t.nv * 3);
    vd.normals = t.nor.subarray(0, t.nv * 3);
    vd.indices = t.idx.subarray(0, t.ni);
    const mesh = new BABYLON.Mesh(nom, scene);
    vd.applyToMesh(mesh, false);
    mesh.material = materiau;
    mesh.parent = racine;
    // Sous-maillages par blocs de tables (consécutives = voisines) : la sélection au clic et le
    // rendu écartent d'un coup les blocs hors du rayon ou de l'écran.
    const blocs = Math.max(1, Math.min(256, Math.round(nbTables / 4)));
    if (blocs > 1 && typeof mesh.subdivide === 'function') {
        try { mesh.subdivide(blocs); } catch (e) { /* un seul bloc */ }
    }
    return mesh;
}

// Champs déjà assemblés (mêmes paramètres, même pose de la racine, même terrain, mêmes seuils) : la
// scène est reconstruite après CHAQUE action (sélection, bouton…) ; le calage de ~1000 tables sur le
// terrain et l'assemblage ne sont refaits que si le champ a réellement changé.
const petitChampChamps = new Map();     // clé -> { panneaux, structure, nbTables, synthese }
const petitChampIdsTerrain = new WeakMap();
let petitChampProchainIdTerrain = 1;

function petitChampCleChamp(racine, params, opts) {
    let terrain = 0;
    if (typeof opts.altitudeScene === 'function') {
        const ref = opts.terrainRef;
        if (!ref || typeof ref !== 'object') return null;   // terrain non identifiable : pas de mémo
        if (!petitChampIdsTerrain.has(ref)) petitChampIdsTerrain.set(ref, petitChampProchainIdTerrain++);
        terrain = petitChampIdsTerrain.get(ref);
    }
    try {
        return JSON.stringify([params, racine.position.x, racine.position.y, racine.position.z, racine.rotation.y || 0,
            terrain, typeof opts.poserTables === 'function', opts.seuils || null]);
    } catch (e) {
        return null;
    }
}

/**
 * Construit tout le champ sous `racine` (déjà positionnée et tournée dans la scène).
 * options.altitudeScene(x, z) : altitude du terrain en coordonnées de scène (null = sol plat à 0) ;
 * options.terrainRef : objet qui identifie ce terrain (mémo du champ assemblé) ;
 * options.poserTables(maitre, params, altitudeEn, seuils) : règle de calage commune (null = tables
 * à plat) ; options.seuils : seuils du champ.
 * -> { nbTables, synthese } (synthese : celle de poserTables, ou null).
 */
function construirePetitChamp3DRapide(scene, racine, params, options) {
    const opts = options || {};
    const mats = petitChampMaterials(scene, params.structureColor || '#8c929a', params.panelColor || '#1e293b');
    // Faces des poteaux/plots recréés ici : visibles des deux côtés, éclairage par leurs normales.
    mats.structureMat.backFaceCulling = false;
    const cle = petitChampCleChamp(racine, params, opts);
    let champ = cle !== null ? petitChampChamps.get(cle) : null;
    if (!champ) {
        champ = petitChampAssembler(scene, racine, params, opts);
        if (cle !== null) {
            if (petitChampChamps.size >= 4) petitChampChamps.delete(petitChampChamps.keys().next().value);
            petitChampChamps.set(cle, champ);
        }
    }
    petitChampMaillage(scene, racine, 'petitChampPanneaux', champ.panneaux, mats.panelMat, champ.nbTables);
    petitChampMaillage(scene, racine, 'petitChampStructure', champ.structure, mats.structureMat, champ.nbTables);
    return { nbTables: champ.nbTables, synthese: champ.synthese };
}

function petitChampAssembler(scene, racine, params, opts) {
    const model = params.postModelPetit || 'centre';
    const layout = Array.isArray(params.shedLayout) ? params.shedLayout : [];
    const sansLayout = Object.assign({}, params);
    delete sansLayout.shedLayout;
    const descripteurs = [];
    if (layout.length) {
        layout.forEach((t, i) => {
            const posts = petitChampPostsForLength(t.facadeLength);
            descripteurs.push({
                i, x: t.x, z: t.z, lacet: t.rotationY || 0,
                shedParams: Object.assign({}, sansLayout, posts, { facadeLength: t.facadeLength, pvCols: t.pvCols, nbShedPetit: 1 }),
            });
        });
    } else {
        const nbShed = Math.max(1, Math.round(params.nbShedPetit) || 1);
        const geo = computePetitChampCommon(params);
        const pas = geo.panelWidth * Math.cos(geo.roofSlopeRad) + (params.shedSpacingPetit || 0);
        for (let i = 0; i < nbShed; i++) descripteurs.push({ i, x: 0, z: i * pas, lacet: 0, shedParams: sansLayout });
    }

    // Calage des tables sur le terrain (règle commune avec la carte) : hauteur + inclinaison le long
    // de la rangée. Nœuds factices : seule leur pose est lue/écrite.
    const pivots = descripteurs.map((d) => ({
        name: 'petitChampTable_' + d.i,
        position: { x: d.x, y: 0, z: d.z }, rotation: { x: 0, y: d.lacet, z: 0 },
        getChildMeshes: () => [],
    }));
    const altitudeScene = typeof opts.altitudeScene === 'function' ? opts.altitudeScene : null;
    let synthese = null;
    if (altitudeScene && typeof opts.poserTables === 'function') {
        const maitre = {
            position: racine.position, rotation: racine.rotation,
            getChildren: () => pivots, getScene: () => null,
        };
        try {
            const r = opts.poserTables(maitre, params, altitudeScene, opts.seuils || null);
            synthese = r ? r.synthese : null;
        } catch (e) {
            try { console.warn('[petit champ 3D] calage des tables impossible', e); } catch (e2) { /* noop */ }
        }
    }
    // Sol sous un point du repère de la racine (repère de la racine -> scène : lacet + translation).
    const ry = racine.rotation.y || 0, cr = Math.cos(ry), sr = Math.sin(ry);
    const solLocal = (x, z) => {
        if (!altitudeScene) return 0;
        const sx = racine.position.x + x * cr + z * sr;
        const sz = racine.position.z - x * sr + z * cr;
        const a = altitudeScene(sx, sz);
        return (Number.isFinite(a) ? a : 0) - (racine.position.y || 0);
    };

    // 1er passage : gabarits et tailles exactes des tableaux finaux.
    const gabarits = descripteurs.map((d) => petitChampGabarit(scene, model, d.shedParams));
    let nvP = 0, niP = 0, nvS = 0, niS = 0;
    gabarits.forEach((g) => {
        nvP += g.panneaux.pos.length / 3;
        niP += g.panneaux.idx.length;
        const boites = g.poteaux.length + g.plots.length;
        nvS += g.structure.pos.length / 3 + boites * PETIT_CHAMP_BOITE_SOMMETS;
        niS += g.structure.idx.length + boites * PETIT_CHAMP_BOITE_INDICES;
    });
    const panneaux = petitChampTampon(nvP, niP), structure = petitChampTampon(nvS, niS);

    // 2e passage : recopie de chaque gabarit, tourné et calé.
    descripteurs.forEach((d, k) => {
        const g = gabarits[k];
        const pv = pivots[k];
        const px = pv.position.x, py = pv.position.y - (altitudeScene ? (racine.position.y || 0) : 0), pz = pv.position.z;
        const cl = Math.cos(d.lacet), sl = Math.sin(d.lacet);
        const roulis = pv.rotation.z || 0, cz = Math.cos(roulis), sz = Math.sin(roulis);
        // Repère de la table -> racine : roulis (Z, pente le long de la rangée), lacet (Y), translation.
        const versRacine = (x, y, z) => {
            const x1 = x * cz - y * sz;
            return [px + x1 * cl + z * sl, py + x * sz + y * cz, pz - x1 * sl + z * cl];
        };
        const recopier = (src, t) => {
            const base = t.nv;
            const sp = src.pos, sn = src.nor;
            for (let i = 0; i < sp.length; i += 3) {
                const x = sp[i], y = sp[i + 1], z = sp[i + 2];
                const x1 = x * cz - y * sz;
                const nx = sn[i], ny = sn[i + 1], nz = sn[i + 2];
                const n1x = nx * cz - ny * sz;
                petitChampSommet(t, px + x1 * cl + z * sl, py + x * sz + y * cz, pz - x1 * sl + z * cl,
                    n1x * cl + nz * sl, nx * sz + ny * cz, -n1x * sl + nz * cl);
            }
            const si = src.idx;
            for (let i = 0; i < si.length; i++) t.idx[t.ni++] = base + si[i];
        };
        recopier(g.panneaux, panneaux);
        recopier(g.structure, structure);

        // Plots de fondation : posés SUR le sol sous leur position (couleur de la structure).
        // Dessus à la hauteur du plot au-dessus du sol en son centre ; dessous au coin le plus bas,
        // pour qu'aucun jour n'apparaisse côté aval sur une pente.
        const plots = g.plots.map((p) => {
            const c = versRacine(p.cx, 0, p.cz);
            const sol = solLocal(c[0], c[2]);
            const coins = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) =>
                solLocal(c[0] + a * p.demiX * cl + b * p.demiZ * sl, c[2] - a * p.demiX * sl + b * p.demiZ * cl));
            petitChampBoiteVerticale(structure, c[0], c[2], Math.min(sol, ...coins), sol + p.h, p.demiX, p.demiZ, d.lacet);
            return { x: c[0], z: c[2], dessus: sol + p.h };
        });
        // Poteaux : verticaux, de la tête (sous la traverse, suit la table) jusqu'au sol exact sous
        // chacun — ou jusqu'au dessus de son plot. Une tête sous le sol : poteau non dessiné.
        g.poteaux.forEach((p) => {
            const tete = versRacine(p.cx, p.haut, p.cz);
            const plot = plots.find((q) => Math.hypot(q.x - tete[0], q.z - tete[2]) <= PETIT_CHAMP_PORTEE_PLOT_M);
            const bas = plot ? plot.dessus : solLocal(tete[0], tete[2]);
            if (tete[1] - bas < PETIT_CHAMP_POTEAU_MIN_M) return;
            petitChampBoiteVerticale(structure, tete[0], tete[2], bas, tete[1], p.demiX, p.demiZ, d.lacet);
        });
    });
    return { panneaux, structure, nbTables: descripteurs.length, synthese };
}

if (typeof window !== 'undefined') {
    window.construirePetitChamp3DRapide = construirePetitChamp3DRapide;
}
