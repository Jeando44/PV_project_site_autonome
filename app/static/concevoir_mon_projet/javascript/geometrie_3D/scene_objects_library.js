// Bibliothèque d'objets 3D Babylon.js pour peupler une scène d'ombrage (arbres, bâtiments,
// mobilier urbain). Chaque générateur retourne un TransformNode racine, exporté en GLB par le
// même pipeline que les générateurs d'ombrière (static/js/geometreie_ombriere_3D/, voir
// regenerateSceneObject dans test_3d.html) puis
// ancré sur Google Maps 3D via Model3DElement.
//
// Géométries volontairement simples (pas de découpe fine) : l'objectif est de fournir un jeu
// d'objets de contexte pour des scènes d'ombrage, pas des modèles architecturaux détaillés.

function makeYZPanel(scene, root, mat, xLen, thickness, y1, z1, y2, z2, name) {
    const dz = z2 - z1, dy = y2 - y1;
    const length = Math.sqrt(dz * dz + dy * dy);
    const panel = BABYLON.MeshBuilder.CreateBox(name, { width: xLen, height: thickness, depth: length }, scene);
    panel.rotation.x = -Math.atan2(dy, dz);
    panel.position.set(0, (y1 + y2) / 2, (z1 + z2) / 2);
    panel.material = mat;
    panel.parent = root;
    return panel;
}

/**
 * Prolonge un segment de pente (p1 -> p2, dans le plan Y-Z) au-delà de chacune de ses
 * extrémités, d'une distance donnée (débord de toit), en conservant l'angle de pente.
 * overhang1 prolonge au-delà de p1, overhang2 au-delà de p2 (0 = pas de prolongement).
 */
function extendSlopeEnds(y1, z1, y2, z2, overhang1, overhang2) {
    const dz = z2 - z1, dy = y2 - y1;
    const len = Math.sqrt(dz * dz + dy * dy) || 1e-6;
    const uz = dz / len, uy = dy / len;
    return {
        y1: y1 - uy * overhang1, z1: z1 - uz * overhang1,
        y2: y2 + uy * overhang2, z2: z2 + uz * overhang2
    };
}

function buildTree(scene, p) {
    const { trunkHeight = 4, crownRadius = 2.5 } = p;
    const root = new BABYLON.TransformNode('treeRoot', scene);
    const trunkMat = new BABYLON.StandardMaterial('trunkMat', scene);
    trunkMat.diffuseColor = new BABYLON.Color3(0.4, 0.26, 0.13);
    const crownMat = new BABYLON.StandardMaterial('crownMat', scene);
    crownMat.diffuseColor = new BABYLON.Color3(0.18, 0.45, 0.2);

    const trunk = BABYLON.MeshBuilder.CreateCylinder('trunk', { height: trunkHeight, diameter: Math.max(0.1, trunkHeight * 0.12) }, scene);
    trunk.position.y = trunkHeight / 2;
    trunk.material = trunkMat;
    trunk.parent = root;

    const crown = BABYLON.MeshBuilder.CreateSphere('crown', { diameter: crownRadius * 2, segments: 8 }, scene);
    crown.position.y = trunkHeight + crownRadius * 0.7;
    crown.scaling.y = 1.2;
    crown.material = crownMat;
    crown.parent = root;
    return root;
}

/**
 * Arbre conifère (sapin / pin) : houppier TRIANGULAIRE — large à la base, pointu au sommet — posé
 * sur un tronc simple. Demande explicite ; géométrie écrite ici avec les primitives de Babylon.js
 * (cylindres dont le diamètre supérieur est nul = cônes), sans modèle ni texture externe : aucun
 * droit tiers en jeu.
 *
 * Le houppier est un empilement de `tiers` cônes qui se chevauchent (silhouette de sapin en
 * étages) ; tiers = 1 donne un cône unique. Chaque étage est plus étroit que le précédent, et
 * l'enveloppe reste inscrite dans le triangle base `crownDiameter` / hauteur `crownHeight` :
 * l'ombre portée correspond donc aux dimensions saisies.
 *
 * Paramètres (m) : trunkHeight (tronc visible sous le houppier), trunkDiameter, crownHeight,
 * crownDiameter (largeur à la base du houppier), tiers (nombre d'étages, 1 à 6).
 */
function buildConiferTree(scene, p) {
    const num = (v, d, min, max) => {
        const n = Number(v);
        return Math.min(max, Math.max(min, isFinite(n) ? n : d));
    };
    const trunkHeight = num(p.trunkHeight, 1.5, 0.1, 30);
    const trunkDiameter = num(p.trunkDiameter, 0.35, 0.05, 3);
    const crownHeight = num(p.crownHeight, 7, 0.5, 60);
    const crownDiameter = num(p.crownDiameter, 4, 0.3, 30);
    const tiers = Math.round(num(p.tiers, 3, 1, 6));

    const root = new BABYLON.TransformNode('coniferRoot', scene);
    const trunkMat = new BABYLON.StandardMaterial('coniferTrunkMat', scene);
    trunkMat.diffuseColor = new BABYLON.Color3(0.36, 0.23, 0.12);
    const crownMat = new BABYLON.StandardMaterial('coniferCrownMat', scene);
    crownMat.diffuseColor = new BABYLON.Color3(0.1, 0.33, 0.17);

    // Tronc : prolongé jusqu'au milieu du 1er étage pour ne jamais laisser de jour sous le houppier.
    const trunkLen = trunkHeight + crownHeight * 0.25;
    const trunk = BABYLON.MeshBuilder.CreateCylinder('coniferTrunk', {
        height: trunkLen, diameterTop: trunkDiameter * 0.8, diameterBottom: trunkDiameter, tessellation: 12,
    }, scene);
    trunk.position.y = trunkLen / 2;
    trunk.material = trunkMat;
    trunk.parent = root;

    // Étages : l'étage i (0 = bas) démarre à baseY_i et monte jusqu'au sommet commun apex pour le
    // dernier ; les autres s'arrêtent plus bas (chevauchement de 40 %). Diamètre de base de chaque
    // étage = largeur du grand triangle à cette hauteur, légèrement évasée pour marquer les étages.
    const apex = trunkHeight + crownHeight;
    const pas = crownHeight / tiers;
    for (let i = 0; i < tiers; i++) {
        const baseY = trunkHeight + i * pas;
        const topY = i === tiers - 1 ? apex : Math.min(apex, baseY + pas * 1.4);
        const largeurTriangle = crownDiameter * (apex - baseY) / crownHeight;
        const diamBase = i === 0 ? crownDiameter : Math.min(crownDiameter, largeurTriangle * 1.12);
        const h = topY - baseY;
        const cone = BABYLON.MeshBuilder.CreateCylinder('coniferCrown' + i, {
            height: h, diameterTop: 0, diameterBottom: diamBase, tessellation: 16,
        }, scene);
        cone.position.y = baseY + h / 2;
        cone.material = crownMat;
        cone.parent = root;
    }
    return root;
}

function buildHouseMono(scene, p) {
    // overhangRampant : débord aux pignons (extrémités, le long de X). overhangLongpan : débord
    // à l'égout/au faîtage (le long de Z, dans le sens de la pente).
    const { length = 8, width = 6, height = 3, slope = 15, overhangRampant = 0.30, overhangLongpan = 0.30 } = p;
    const root = new BABYLON.TransformNode('houseRoot', scene);
    const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.85, 0.8, 0.7);
    const roofMat = new BABYLON.StandardMaterial('roofMat', scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.5, 0.2, 0.15);

    const walls = BABYLON.MeshBuilder.CreateBox('walls', { width: length, height, depth: width }, scene);
    walls.position.y = height / 2;
    walls.material = wallMat;
    walls.parent = root;

    const slopeRad = slope * Math.PI / 180;
    const rise = width * Math.tan(slopeRad);
    const ext = extendSlopeEnds(height, -width / 2, height + rise, width / 2, overhangLongpan, overhangLongpan);
    makeYZPanel(scene, root, roofMat, length + 2 * overhangRampant, 0.1, ext.y1, ext.z1, ext.y2, ext.z2, 'roof');
    return root;
}

function buildHouseBi(scene, p) {
    // Débords : à l'égout de chaque pan (overhangLongpan), pas au faîtage (arête intérieure),
    // et aux pignons (overhangRampant) — même logique que buildHouseAsym (dont bipente est le
    // cas particulier symétrique).
    const { length = 8, width = 6, height = 3, slope = 25, overhangRampant = 0.30, overhangLongpan = 0.30 } = p;
    const root = new BABYLON.TransformNode('houseRoot', scene);
    const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.85, 0.8, 0.7);
    const roofMat = new BABYLON.StandardMaterial('roofMat', scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.5, 0.2, 0.15);

    const walls = BABYLON.MeshBuilder.CreateBox('walls', { width: length, height, depth: width }, scene);
    walls.position.y = height / 2;
    walls.material = wallMat;
    walls.parent = root;

    const slopeRad = slope * Math.PI / 180;
    const halfW = width / 2;
    const rise = halfW * Math.tan(slopeRad);
    const extL = extendSlopeEnds(height, -halfW, height + rise, 0, overhangLongpan, 0);
    const extR = extendSlopeEnds(height + rise, 0, height, halfW, 0, overhangLongpan);
    makeYZPanel(scene, root, roofMat, length + 2 * overhangRampant, 0.1, extL.y1, extL.z1, extL.y2, extL.z2, 'roofL');
    makeYZPanel(scene, root, roofMat, length + 2 * overhangRampant, 0.1, extR.y1, extR.z1, extR.y2, extR.z2, 'roofR');
    return root;
}

/**
 * Pyramide à base rectangulaire (4 faces triangulaires), construite explicitement à partir des
 * dimensions length (X) / width (Z) : alignement garanti avec le bâtiment, sans dépendre d'une
 * astuce de rotation/mise à l'échelle sur un cylindre à faible tessellation (source de l'ancien
 * bug d'orientation : la mise à l'échelle s'appliquait dans le repère local PRÉ-rotation, ce qui
 * déformait/désalignait la base au lieu de simplement l'étirer selon X).
 */
function buildRectPyramidRoof(scene, length, width, apexHeight, mat, name) {
    const hl = length / 2, hw = width / 2;
    const positions = [
        -hl, 0, -hw, hl, 0, -hw, hl, 0, hw, -hl, 0, hw, // 4 coins de base
        0, apexHeight, 0 // sommet
    ];
    const indices = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4];
    const normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    const vertexData = new BABYLON.VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    const mesh = new BABYLON.Mesh(name, scene);
    vertexData.applyToMesh(mesh);
    mesh.material = mat;
    return mesh;
}

function buildHouseMulti(scene, p) {
    // Toit à 4 pans (croupes) = pyramide à base rectangulaire, alignée par construction sur la
    // longueur/largeur du bâtiment (voir buildRectPyramidRoof). overhangRampant agrandit la base
    // dans le sens de la longueur, overhangLongpan dans le sens de la largeur.
    const { length = 8, width = 6, height = 3, slope = 25, overhangRampant = 0.30, overhangLongpan = 0.30 } = p;
    const root = new BABYLON.TransformNode('houseRoot', scene);
    const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.85, 0.8, 0.7);
    const roofMat = new BABYLON.StandardMaterial('roofMat', scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.5, 0.2, 0.15);

    const walls = BABYLON.MeshBuilder.CreateBox('walls', { width: length, height, depth: width }, scene);
    walls.position.y = height / 2;
    walls.material = wallMat;
    walls.parent = root;

    const slopeRad = slope * Math.PI / 180;
    const rise = (width / 2) * Math.tan(slopeRad);
    const baseWidth = width + 2 * overhangLongpan;
    const baseLength = length + 2 * overhangRampant;
    const roof = buildRectPyramidRoof(scene, baseLength, baseWidth, rise, roofMat, 'roof');
    roof.position.y = height;
    roof.parent = root;
    return root;
}

function buildHouseAsym(scene, p) {
    // Toiture asymétrique : deux pentes différentes de chaque côté ; le faîtage se positionne
    // là où les deux plans se rencontrent (pas nécessairement centré sur la largeur).
    // Débords : uniquement à l'égout de chaque pan (overhangLongpan) — pas au faîtage, qui est
    // une arête intérieure — et aux pignons (overhangRampant), comme les autres toitures.
    const { length = 8, width = 6, height = 3, slopeLeft = 20, slopeRight = 40,
        overhangRampant = 0.30, overhangLongpan = 0.30 } = p;
    const root = new BABYLON.TransformNode('houseRoot', scene);
    const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.85, 0.8, 0.7);
    const roofMat = new BABYLON.StandardMaterial('roofMat', scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.5, 0.2, 0.15);

    const walls = BABYLON.MeshBuilder.CreateBox('walls', { width: length, height, depth: width }, scene);
    walls.position.y = height / 2;
    walls.material = wallMat;
    walls.parent = root;

    const halfW = width / 2;
    const sL = slopeLeft * Math.PI / 180;
    const sR = slopeRight * Math.PI / 180;
    const zRidge = halfW * (Math.tan(sR) - Math.tan(sL)) / (Math.tan(sL) + Math.tan(sR));
    const hRidge = height + (zRidge + halfW) * Math.tan(sL);

    const extL = extendSlopeEnds(height, -halfW, hRidge, zRidge, overhangLongpan, 0);
    const extR = extendSlopeEnds(hRidge, zRidge, height, halfW, 0, overhangLongpan);
    makeYZPanel(scene, root, roofMat, length + 2 * overhangRampant, 0.1, extL.y1, extL.z1, extL.y2, extL.z2, 'roofL');
    makeYZPanel(scene, root, roofMat, length + 2 * overhangRampant, 0.1, extR.y1, extR.z1, extR.y2, extR.z2, 'roofR');
    return root;
}

function buildHouseHip(scene, p) {
    // Toiture 4 pentes symétrique = bâtiment industriel multi-pente "en V inversé" répété :
    // deux toitures bipente identiques et PARALLÈLES (même orientation de faîtage), accolées
    // le long de la longueur — PAS un pavillon/croupe (faîtages perpendiculaires). Profil vu
    // de face (le long de la longueur) : /\/\ — deux pans par section x 2 sections = 4 pans.
    // Débords : overhangRampant = pignons (le long de Z, sens du faîtage de chaque section) ;
    // overhangLongpan = égouts de chaque section (le long de X, sens de la pente) — appliqué aux
    // deux égouts de chaque section (dont celui qui touche la section voisine), comme les autres
    // toitures de la bibliothèque, sans traitement spécial pour la simplicité du modèle.
    const { length = 10, width = 6, height = 3, slope = 25, overhangRampant = 0.30, overhangLongpan = 0.30 } = p;
    const root = new BABYLON.TransformNode('houseRoot', scene);
    const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.85, 0.8, 0.7);
    const roofMat = new BABYLON.StandardMaterial('roofMat', scene);
    roofMat.diffuseColor = new BABYLON.Color3(0.5, 0.2, 0.15);

    const walls = BABYLON.MeshBuilder.CreateBox('walls', { width: length, height, depth: width }, scene);
    walls.position.y = height / 2;
    walls.material = wallMat;
    walls.parent = root;

    const slopeRad = slope * Math.PI / 180;
    const sectionLength = length / 2;
    const halfSection = sectionLength / 2;
    const rise = halfSection * Math.tan(slopeRad);

    // Chaque section est une toiture bipente identique (même makeYZPanel, faîtage le long de Z,
    // pente sur la longueur de la section), répétée deux fois côte à côte le long de X.
    [-1, 1].forEach(side => {
        const group = new BABYLON.TransformNode('roofSection' + side, scene);
        group.rotation.y = Math.PI / 2;
        group.position.x = side * halfSection;
        group.parent = root;
        const extA = extendSlopeEnds(height, -halfSection, height + rise, 0, overhangLongpan, 0);
        const extB = extendSlopeEnds(height + rise, 0, height, halfSection, 0, overhangLongpan);
        makeYZPanel(scene, group, roofMat, width + 2 * overhangRampant, 0.1, extA.y1, extA.z1, extA.y2, extA.z2, 'roofA' + side);
        makeYZPanel(scene, group, roofMat, width + 2 * overhangRampant, 0.1, extB.y1, extB.z1, extB.y2, extB.z2, 'roofB' + side);
    });
    return root;
}

function buildFlatRoofTerrace(scene, p) {
    // Toit-terrasse : murs + dalle plate + acrotère (muret périphérique en 4 segments).
    const { length = 8, width = 6, height = 3, acrotereHeight = 0.5, acrotereThickness = 0.15 } = p;
    const root = new BABYLON.TransformNode('terraceRoot', scene);
    const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.85, 0.8, 0.7);
    const slabMat = new BABYLON.StandardMaterial('slabMat', scene);
    slabMat.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.6);
    const acrotereMat = new BABYLON.StandardMaterial('acrotereMat', scene);
    acrotereMat.diffuseColor = new BABYLON.Color3(0.8, 0.78, 0.72);

    const walls = BABYLON.MeshBuilder.CreateBox('walls', { width: length, height, depth: width }, scene);
    walls.position.y = height / 2;
    walls.material = wallMat;
    walls.parent = root;

    const slabThickness = 0.15;
    const slab = BABYLON.MeshBuilder.CreateBox('roofSlab', { width: length, height: slabThickness, depth: width }, scene);
    slab.position.y = height + slabThickness / 2;
    slab.material = slabMat;
    slab.parent = root;

    const topY = height + slabThickness;
    const halfL = length / 2, halfW = width / 2;
    const makeParapetWall = (w, d, x, z, name) => {
        const wall = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: acrotereHeight, depth: d }, scene);
        wall.position.set(x, topY + acrotereHeight / 2, z);
        wall.material = acrotereMat;
        wall.parent = root;
    };
    makeParapetWall(length, acrotereThickness, 0, -halfW + acrotereThickness / 2, 'acrotereFront');
    makeParapetWall(length, acrotereThickness, 0, halfW - acrotereThickness / 2, 'acrotereBack');
    makeParapetWall(acrotereThickness, width - 2 * acrotereThickness, -halfL + acrotereThickness / 2, 0, 'acrotereLeft');
    makeParapetWall(acrotereThickness, width - 2 * acrotereThickness, halfL - acrotereThickness / 2, 0, 'acrotereRight');
    return root;
}

function buildRectRoof(scene, p) {
    // Toiture rectangulaire seule (sans murs) : un plan/auvent incliné, utile comme élément
    // d'ombrage ou pour représenter une toiture existante isolée dans la scène. "height" est la
    // hauteur du bord bas (égout) au-dessus du sol ; "slope" incline le plan vers le bord haut.
    const { length = 6, width = 4, thickness = 0.15, height = 2.5, slope = 10 } = p;
    const root = new BABYLON.TransformNode('rectRoofRoot', scene);
    const mat = new BABYLON.StandardMaterial('rectRoofMat', scene);
    mat.diffuseColor = new BABYLON.Color3(0.5, 0.2, 0.15);
    const slopeRad = slope * Math.PI / 180;
    const rise = width * Math.tan(slopeRad);
    makeYZPanel(scene, root, mat, length, thickness, height, -width / 2, height + rise, width / 2, 'rectRoofSlab');
    return root;
}

function buildBox(scene, p) {
    const { length = 2, width = 2, height = 2 } = p;
    const root = new BABYLON.TransformNode('boxRoot', scene);
    const mat = new BABYLON.StandardMaterial('boxMat', scene);
    mat.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.62);
    const box = BABYLON.MeshBuilder.CreateBox('block', { width: length, height, depth: width }, scene);
    box.position.y = height / 2;
    box.material = mat;
    box.parent = root;
    return root;
}

// --- Bâtiment dessiné (outil « polygone » de la vue 3D du calepinage) ---------------------------
// Contour libre (convexe ou non) tracé au sol, extrudé verticalement sur `height`. `points` est
// exprimé dans le repère de l'objet (x = Est, z = Nord, origine = centre de l'emprise) : le
// déplacement et la rotation de l'objet restent ceux des autres objets de la bibliothèque.
const BATIMENT_DESSINE_MAX_SOMMETS = 200;
const BATIMENT_DESSINE_COORD_MAX = 250;   // m, depuis le centre de l'emprise
const BATIMENT_DESSINE_AIRE_MIN = 0.01;   // m²
const BATIMENT_DESSINE_CONTOUR_DEFAUT = [{ x: -3, z: -3 }, { x: 3, z: -3 }, { x: 3, z: 3 }, { x: -3, z: 3 }];

function aireSigneeContour(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        a += p.x * q.z - q.x * p.z;
    }
    return a / 2;
}

/**
 * Contour d'un bâtiment dessiné, nettoyé : sommets numériques bornés à ±250 m, doublons consécutifs
 * (< 1 cm) et point de fermeture retirés, 200 sommets au plus. Contour inutilisable (moins de 3
 * sommets, aire nulle) -> carré de 6 m par défaut. Accepte des sommets {x, z} ou [x, z].
 */
function contourBatimentDessine(points) {
    const borne = (v) => Math.min(BATIMENT_DESSINE_COORD_MAX, Math.max(-BATIMENT_DESSINE_COORD_MAX, v));
    const out = [];
    (Array.isArray(points) ? points : []).forEach((p) => {
        const x = Number(Array.isArray(p) ? p[0] : p && p.x);
        const z = Number(Array.isArray(p) ? p[1] : p && p.z);
        if (!isFinite(x) || !isFinite(z)) return;
        const s = { x: Math.round(borne(x) * 1000) / 1000, z: Math.round(borne(z) * 1000) / 1000 };
        const prec = out[out.length - 1];
        if (prec && Math.hypot(prec.x - s.x, prec.z - s.z) < 0.01) return;
        out.push(s);
    });
    while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].z - out[out.length - 1].z) < 0.01) out.pop();
    const contour = out.slice(0, BATIMENT_DESSINE_MAX_SOMMETS);
    if (contour.length < 3 || Math.abs(aireSigneeContour(contour)) < BATIMENT_DESSINE_AIRE_MIN) {
        return BATIMENT_DESSINE_CONTOUR_DEFAUT.map((p) => ({ x: p.x, z: p.z }));
    }
    return contour;
}

/**
 * Triangulation (oreilles) d'un contour plan {x, z}, convexe ou non : triplets d'indices. Même
 * découpage pour le rendu Babylon et le volume d'ombrage, donc même toit dans les deux.
 */
function triangulerContour(pts) {
    const n = pts.length;
    if (n < 3) return [];
    const sens = aireSigneeContour(pts) >= 0 ? 1 : -1;
    const cross = (a, b, c) => ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) * sens;
    const dedans = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
    const idx = pts.map((_, i) => i);
    const tris = [];
    let garde = n * n;
    while (idx.length > 3 && garde-- > 0) {
        let coupe = false;
        for (let k = 0; k < idx.length; k++) {
            const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
            const a = pts[ia], b = pts[ib], c = pts[ic];
            if (cross(a, b, c) <= 1e-12) continue; // sommet rentrant ou aligné
            if (idx.some((j) => j !== ia && j !== ib && j !== ic && dedans(pts[j], a, b, c))) continue;
            tris.push([ia, ib, ic]);
            idx.splice(k, 1);
            coupe = true;
            break;
        }
        if (!coupe) break; // contour dégénéré : repli en éventail sur le reste
    }
    for (let k = 1; k + 1 < idx.length; k++) tris.push([idx[0], idx[k], idx[k + 1]]);
    return tris;
}

function buildBatimentDessine(scene, p) {
    const pts = contourBatimentDessine(p.points);
    const h = Number(p.height) > 0 ? Number(p.height) : 3;
    const root = new BABYLON.TransformNode('batimentDessineRoot', scene);
    const positions = [];
    const indices = [];
    // Murs : un quadrilatère par côté (sommets propres à chaque face -> arêtes vives à l'éclairage).
    pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length];
        const base = positions.length / 3;
        positions.push(a.x, 0, a.z, b.x, 0, b.z, b.x, h, b.z, a.x, h, a.z);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const murs = new BABYLON.VertexData();
    murs.positions = positions;
    murs.indices = indices;
    murs.normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, murs.normals);
    const mursMesh = new BABYLON.Mesh('batimentDessineMurs', scene);
    murs.applyToMesh(mursMesh);
    const mursMat = new BABYLON.StandardMaterial('batimentDessineMursMat', scene);
    mursMat.diffuseColor = new BABYLON.Color3(0.82, 0.78, 0.70);
    mursMat.backFaceCulling = false;
    mursMesh.material = mursMat;
    mursMesh.parent = root;

    // Toit plat à la hauteur du bâtiment.
    const toitPos = [];
    pts.forEach((s) => toitPos.push(s.x, h, s.z));
    const toitIdx = [];
    triangulerContour(pts).forEach((t) => toitIdx.push(t[0], t[1], t[2]));
    const toit = new BABYLON.VertexData();
    toit.positions = toitPos;
    toit.indices = toitIdx;
    toit.normals = [];
    BABYLON.VertexData.ComputeNormals(toitPos, toitIdx, toit.normals);
    const toitMesh = new BABYLON.Mesh('batimentDessineToit', scene);
    toit.applyToMesh(toitMesh);
    const toitMat = new BABYLON.StandardMaterial('batimentDessineToitMat', scene);
    toitMat.diffuseColor = new BABYLON.Color3(0.55, 0.55, 0.58);
    toitMat.backFaceCulling = false;
    toitMesh.material = toitMat;
    toitMesh.parent = root;
    return root;
}

function buildLightMast(scene, p) {
    const { height = 8 } = p;
    const root = new BABYLON.TransformNode('mastRoot', scene);
    const mat = new BABYLON.StandardMaterial('mastMat', scene);
    mat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.32);
    const pole = BABYLON.MeshBuilder.CreateCylinder('pole', { height, diameter: 0.25 }, scene);
    pole.position.y = height / 2;
    pole.material = mat;
    pole.parent = root;

    const headMat = new BABYLON.StandardMaterial('headMat', scene);
    headMat.diffuseColor = new BABYLON.Color3(0.9, 0.9, 0.75);
    const head = BABYLON.MeshBuilder.CreateBox('head', { width: 0.6, height: 0.2, depth: 0.3 }, scene);
    head.position.set(0.3, height, 0);
    head.material = headMat;
    head.parent = root;
    return root;
}

// --- Structures complexes (ombrières métal/bois, bâtiment métal, petit champ solaire) réutilisées
// comme objets de bibliothèque plaçables. Objectif : pouvoir placer PLUSIEURS structures, de modèles
// différents, dans la même scène — le panneau de paramètres à gauche ne pilote qu'UNE seule
// structure "principale" à la fois, ce qui ne permettait pas de mélanger par exemple une ombrière
// "Poteaux centrés" et une "Poteaux excentrés" simultanément. S'appuie sur les mêmes générateurs 3D
// que la structure principale (buildOmbriere3D/buildOmbriereBois3D/buildBatimentMetal3D/
// buildPetitChampSolaire3D, chargés avant ce fichier — cf. l'ordre des <script> dans test_3d.html) et
// sur `readParams()` (définie dans test_3d.html, disponible en global seulement au moment de
// l'appel, pas au chargement de CE fichier) comme base de valeurs par défaut (matériaux, couleurs,
// dimensions courantes du formulaire) — seuls les quelques champs exposés dans `fields` sont figés
// par instance à la pose (valeur du formulaire à cet instant, cf. structureDefaultsFor), modifiables
// ensuite via le panneau de l'objet (bouton "Modifier" dans "Objets 3D de la scène").
//
// window.LIBRARY_STRUCTURE_FAMILIES : consommé par test_3d.html pour construire le sous-menu par
// famille dans la bibliothèque (boutons "Ombrière Métal"/"Ombrière Bois"/"Bâtiment métal"/"Petit
// champ solaire", chacun listant ses modèles de poteaux/toiture).
window.LIBRARY_STRUCTURE_FAMILIES = {
    metal: {
        label: 'Ombrière Métal', structureType: 'metal',
        models: [
            { key: 'single', label: 'Centrés' },
            { key: 'offset', label: 'Excentrés' },
            { key: 'double', label: 'Double Poteaux' },
            { key: 'inclinedPost', label: 'Poteaux Inclinés' },
            { key: 'linked', label: 'Centrés liaisonnés' },
            { key: 'y_shape', label: 'Toiture Y' },
            { key: 'doubleYShape', label: 'Double toiture Y' }
        ]
    },
    bois: {
        label: 'Ombrière Bois', structureType: 'bois',
        models: [
            { key: 'inclinedPost', label: 'Gd. Monopan' },
            { key: 'y_shape', label: 'Est-Ouest' },
            { key: 'double', label: '2 poteaux (5m)' },
            { key: 'simple_azelan', label: 'Azélan' },
            { key: 'simple_travolta', label: 'Travolta' },
            { key: 'simple_travolta_2', label: 'Travolta-2' }
        ]
    },
    batiment_metal: {
        label: 'Bâtiment métal', structureType: 'batiment_metal',
        models: [
            { key: 'bipente', label: 'Bipente' },
            { key: 'monopente', label: 'Monopente' },
            { key: 'asymetrique', label: 'Asymétrique' },
            { key: 'multipente', label: 'Multipente' }
        ]
    },
    petit_champ_solaire: {
        label: 'Petit champ solaire', structureType: 'petit_champ_solaire',
        models: [
            { key: 'centre', label: 'Centrés' },
            { key: 'excentre', label: 'Excentrés' },
            { key: 'double', label: 'Double Poteaux' },
            { key: 'bipente', label: 'Bipente' }
        ]
    }
};

// BUG CORRIGÉ (mélange de matériaux entre structures) : readParams() résout structureColor/
// panelColor en lisant le champ couleur du DOM correspondant à `currentStructureType` — une
// variable GLOBALE, partagée par TOUTES les structures de la scène, pas propre à celle qu'on est en
// train de construire ICI. Résultat : si l'onglet actif du formulaire était "Ombrière bois" au
// moment du rendu, toutes les structures de la scène (y compris une ombrière métal ou un bâtiment
// posés plus tôt) recevaient la couleur BOIS, `readParams()` étant rappelée à chaque construction
// dans la boucle de renderPreview sans jamais changer de résultat pour ce champ. Cette fonction
// résout les couleurs directement depuis les bons champs DOM, selon le `structureType` de CETTE
// structure précise (paramètre reçu, fixé par instance — jamais la variable globale), indépendamment
// de l'onglet actuellement affiché dans le formulaire.
function resolveStructureColors(structureType) {
    const val = (id, fallback) => {
        const el = document.getElementById(id);
        return el ? el.value : fallback;
    };
    if (structureType === 'batiment_metal') {
        return {
            structureColor: val('structureColorBatiment', '#8c929a'),
            panelColor: val('panelColorBatiment', '#1e293b'),
            bacAcierColor: val('bacAcierColor', '#c0c1c4')
        };
    }
    if (structureType === 'bois') {
        return {
            structureColor: val('structureColorBois', '#A0522D'),
            panelColor: val('panelColorBois', '#1e293b'),
            integrationColor: val('integrationColorBois', '#d1d5db')
        };
    }
    // 'metal' (ombrière) et 'petit_champ_solaire' partagent les mêmes champs couleur génériques
    // (#structureColor/#panelColor), déjà le cas dans readParams() — cf.
    // structureColorField/panelColorField, affichés pour isMetal ET isPetitChamp.
    return {
        structureColor: val('structureColor', '#8c929a'),
        panelColor: val('panelColor', '#1e293b')
    };
}
function buildStructureFamilyObject(scene, p, structureType, postModel) {
    // Ordre de priorité : base (repli, seulement si un champ manque totalement de p) < couleurs
    // résolues pour CE structureType (repli intermédiaire, cf. Tâche 1 précédente) < p = obj.params,
    // qui est désormais un instantané COMPLET du formulaire capturé à la pose ou à la dernière
    // modification via le formulaire principal pendant l'édition de cette instance (cf.
    // structureDefaultsFor et enterStructureEditMode/le routeur d'edition dans test_3d.html) — p a
    // donc TOUJOURS le dernier mot, ce qui garantit l'indépendance de l'instance vis-à-vis de l'état
    // courant, potentiellement différent, du formulaire partagé.
    const base = (typeof readParams === 'function') ? readParams() : {};
    const params = Object.assign({}, base, resolveStructureColors(structureType), p, { structureType });
    if (structureType === 'petit_champ_solaire') params.postModelPetit = postModel;
    else params.postModel = postModel;
    if (structureType === 'bois') return buildOmbriereBois3D(scene, params);
    if (structureType === 'batiment_metal') return buildBatimentMetal3D(scene, params);
    if (structureType === 'petit_champ_solaire') return buildPetitChampSolaire3D(scene, params);
    return buildOmbriere3D(scene, params);
}
// Champs exposés par famille (modifiables par instance, via le panneau de l'objet) : un sous-ensemble
// pratique des dizaines de champs du formulaire complet, propre à chaque famille de structure (les
// modèles bois utilisent des noms de champ d'entraxe différents selon le sous-modèle — cf.
// readParams() dans test_3d.html — donc non exposés ici pour rester simple).
function structureFieldsFor(structureType) {
    if (structureType === 'petit_champ_solaire') {
        return [
            { k: 'postSpacingPetit', l: 'Entraxe poteaux (m)' },
            { k: 'nbShedPetit', l: 'Nb de shed' },
            { k: 'shedSpacingPetit', l: 'Espacement shed (m)' }
        ];
    }
    if (structureType === 'batiment_metal') {
        return [
            { k: 'widthRoof', l: 'Largeur (m)' },
            { k: 'facadeLength', l: 'Longueur (m)' },
            { k: 'postCount', l: 'Nb poteaux' }
        ];
    }
    if (structureType === 'bois') {
        return [{ k: 'facadeLength', l: 'Longueur façade (m)' }];
    }
    return [
        { k: 'postSpacing', l: 'Entraxe poteaux (m)' },
        { k: 'facadeLength', l: 'Longueur façade (m)' },
        { k: 'roofSlope', l: 'Pente toiture (°)' }
    ];
}
// Valeurs par défaut à la pose = INSTANTANÉ COMPLET du formulaire à cet instant (fonction appelée à
// chaque pose, pas un objet figé une fois pour toutes) : corrige (a) le décalage entre une structure
// nouvellement posée et ce qui était saisi dans le formulaire au même moment, ET (b) le mélange
// d'état entre instances — en capturant TOUT (pas seulement les quelques champs de
// structureFieldsFor, qui ne servent plus qu'à la liste des champs modifiables dans le petit panneau
// d'objet), cette instance n'a plus jamais besoin de retomber sur le formulaire partagé (`base` dans
// buildStructureFamilyObject) pour son propre rendu, quoi qu'il arrive au formulaire ensuite.
function structureDefaultsFor(structureType) {
    return function () {
        const base = (typeof readParams === 'function') ? readParams() : {};
        return Object.assign({}, base);
    };
}

function buildElectricPole(scene, p) {
    const { height = 9 } = p;
    const root = new BABYLON.TransformNode('poleRoot', scene);
    const mat = new BABYLON.StandardMaterial('poleMat', scene);
    mat.diffuseColor = new BABYLON.Color3(0.42, 0.34, 0.24);
    const pole = BABYLON.MeshBuilder.CreateCylinder('pole', { height, diameterTop: 0.22, diameterBottom: 0.32 }, scene);
    pole.position.y = height / 2;
    pole.material = mat;
    pole.parent = root;

    const arm = BABYLON.MeshBuilder.CreateBox('crossarm', { width: 1.6, height: 0.12, depth: 0.12 }, scene);
    arm.position.set(0, height - 0.5, 0);
    arm.material = mat;
    arm.parent = root;
    return root;
}

/*
 * Volumes d'OMBRAGE des objets (calcul de l'ombrage proche sur les champs PV, cf.
 * calepinage_maison_ombrage_scene.js + app/models/calcul_prodsolaire/calcul_ombrage_proche.py).
 * `shading(params)` renvoie des primitives SIMPLES dans le repère local de l'objet (origine au sol,
 * y vers le haut, avant rotation/translation), chacune avec sa transmission lumineuse :
 *   { forme: 'boite', cx, cy, cz, longueur (x), hauteur (y), largeur (z) }
 *   { forme: 'cylindre', cx, cz, y0, y1, rayon }         (axe vertical)
 *   { forme: 'cone', cx, cz, y0, y1, rayon }              (base en y0, pointe en y1)
 *   { forme: 'ellipsoide', cx, cy, cz, rx, ry, rz }
 *   { forme: 'polyedre', faces: [[[x,y,z], ...], ...] }   (faces planes convexes : toitures, pignons)
 *   + transmission (0 = opaque, 1 = transparent) et transmissionHiver (arbres caducs, sans feuilles).
 * Chaque volume reprend les MÊMES formules que la fonction build* de l'objet (dimensions, pentes,
 * débords) : l'ombre calculée correspond à l'objet affiché. Les pignons (triangles sous la toiture),
 * ouverts dans le rendu Babylon, sont fermés ici : une vraie maison masque aussi par ses pignons.
 * Un objet SANS `shading` n'est pas pris en compte dans l'ombrage (il est signalé comme ignoré) :
 * pour ajouter un objet au calcul, il suffit de lui écrire ce descripteur.
 *
 * BORNES DE SAISIE (`fields[].min/max`) : appliquées à la saisie (fenêtre de l'objet), à
 * l'enregistrement (CM.updateSceneObject3D), au rendu 3D et au calcul d'ombrage — cf.
 * window.sanitizeSceneObjectParams ci-dessous. Une valeur absente ou invalide reprend la valeur par
 * défaut de l'objet ; une valeur hors bornes est ramenée à la borne. Le serveur revalide la géométrie
 * reçue (calcul_ombrage_proche.py).
 */
const ombrageNum = (v, d, min, max) => {
    const n = Number(v);
    return Math.min(max, Math.max(min, isFinite(n) ? n : d));
};
// Transmission du houppier (fraction du rayonnement qui le traverse). Ordres de grandeur usuels :
// feuillu en feuilles 0,1-0,3, feuillu sans feuilles 0,5-0,7 (branches), conifère 0,05-0,15.
const OMBRAGE_TRANSMISSION_FEUILLU_ETE = 0.2;
const OMBRAGE_TRANSMISSION_FEUILLU_HIVER = 0.6;
const OMBRAGE_TRANSMISSION_CONIFERE = 0.1;
// Hauteur maximale d'un volume (m) : borne « Hauteur 0,1-50 m » appliquée aussi au faîtage calculé
// (une pente de 89° sur 200 m de large donnerait sinon une toiture de plusieurs kilomètres).
const OMBRAGE_HAUTEUR_MAX = 50;
const OMBRAGE_PENTE_MAX_CALCUL = 89;

// Champs de saisie communs (bornes validées avec l'utilisateur).
const OMBRAGE_CHAMPS = {
    length: { k: 'length', l: 'Longueur (m)', min: 1, max: 500 },
    width: { k: 'width', l: 'Largeur (m)', min: 0.5, max: 200 },
    wallHeight: { k: 'height', l: 'Ht. murs (m)', min: 0.1, max: 15 },
    height: { k: 'height', l: 'Hauteur (m)', min: 0.1, max: 50 },
    slope: { k: 'slope', l: 'Pente (°)', min: 0, max: 90, step: 1 },
    slopeRoof: { k: 'slope', l: 'Pente toiture (°)', min: 0, max: 90, step: 1 },
    slopeLeft: { k: 'slopeLeft', l: 'Pente gauche (°)', min: 0, max: 90, step: 1 },
    slopeRight: { k: 'slopeRight', l: 'Pente droite (°)', min: 0, max: 90, step: 1 },
    overhangRampant: { k: 'overhangRampant', l: 'Débord toit rampant (m)', min: 0.1, max: 3 },
    overhangLongpan: { k: 'overhangLongpan', l: 'Débord toit longpan (m)', min: 0.1, max: 3 },
    thickness: { k: 'thickness', l: 'Épaisseur (m)', min: 0.1, max: 1, step: 0.05 },
    acrotereHeight: { k: 'acrotereHeight', l: 'Hauteur acrotère (m)', min: 0.1, max: 3 },
    acrotereThickness: { k: 'acrotereThickness', l: 'Épaisseur acrotère (m)', min: 0.1, max: 1, step: 0.05 },
    trunkHeight: { k: 'trunkHeight', l: 'Hauteur tronc (m)', min: 0.1, max: 30 },
    crownRadius: { k: 'crownRadius', l: 'Rayon houppier (m)', min: 0.1, max: 50 },
    trunkDiameter: { k: 'trunkDiameter', l: 'Diamètre tronc (m)', min: 0.1, max: 50 },
    crownHeight: { k: 'crownHeight', l: 'Hauteur houppier (m)', min: 0.1, max: 30 },
    crownDiameter: { k: 'crownDiameter', l: 'Largeur base houppier (m)', min: 0.1, max: 30 },
    tiers: { k: 'tiers', l: "Nombre d'étages (1-6)", min: 1, max: 6, step: 1, entier: true },
    transmission: { k: 'transmission', l: 'Transmission feuillage été (0-1)', min: 0, max: 1, step: 0.05 },
    transmissionConifere: { k: 'transmission', l: 'Transmission feuillage (0-1)', min: 0, max: 1, step: 0.05 },
    transmissionHiver: { k: 'transmissionHiver', l: 'Transmission hiver, sans feuilles (0-1)', min: 0, max: 1, step: 0.05 },
    // Bâtiment dessiné : bornes demandées 0,1-100 m (au-delà des 50 m des objets paramétriques).
    hauteurBatimentDessine: { k: 'height', l: 'Hauteur du bâtiment (m)', min: 0.1, max: 100 },
};
const MAISON_CHAMPS = [OMBRAGE_CHAMPS.length, OMBRAGE_CHAMPS.width, OMBRAGE_CHAMPS.wallHeight, OMBRAGE_CHAMPS.slope,
    OMBRAGE_CHAMPS.overhangRampant, OMBRAGE_CHAMPS.overhangLongpan];

// Valeur bornée d'un champ déclaré dans `fields` (défaut de l'objet si absente/invalide).
function ombrageVal(def, p, k) {
    const f = (def.fields || []).find((x) => x.k === k) || {};
    const d = (def.defaults || {})[k];
    const lo = f.min != null ? f.min : -Infinity, hi = f.max != null ? f.max : Infinity;
    let v = ombrageNum(p[k], d != null ? d : lo, lo, hi);
    if (f.entier) v = Math.round(v);
    return v;
}

const ombrageTan = (deg) => Math.tan((Math.min(OMBRAGE_PENTE_MAX_CALCUL, Math.max(0, deg)) * Math.PI) / 180);
// Faîtage : jamais au-delà de OMBRAGE_HAUTEUR_MAX au-dessus du sol.
const ombrageRise = (wallH, rise) => Math.max(0, Math.min(rise, OMBRAGE_HAUTEUR_MAX - wallH));

// Murs = pavé L (x) x H x W (z), posé au sol.
function ombrageMurs(L, W, H) {
    return { forme: 'boite', cx: 0, cy: H / 2, cz: 0, longueur: L, hauteur: H, largeur: W, transmission: 0 };
}
// Plaque de toiture (makeYZPanel, épaisseur négligée) : bande de longueur xLen sur X, du point
// (z1, y1) au point (z2, y2) du plan Y-Z.
function ombragePlaque(xLen, y1, z1, y2, z2) {
    const h = xLen / 2;
    return [[-h, y1, z1], [h, y1, z1], [h, y2, z2], [-h, y2, z2]];
}
// Pignons triangulaires aux deux extrémités x = ±L/2 : base (zA..zB) à la hauteur des murs, sommet
// (zS, yS).
function ombragePignons(L, H, zA, zB, zS, yS) {
    return [-1, 1].map((s) => [[s * L / 2, H, zA], [s * L / 2, H, zB], [s * L / 2, yS, zS]]);
}
function ombragePolyedre(faces) {
    return { forme: 'polyedre', faces, transmission: 0 };
}

// Toiture 2 pans (bipente / asymétrique) : faîtage en (zRidge, hRidge), débords comme buildHouseBi.
function ombrageDeuxPans(L, W, H, zRidge, hRidge, oR, oL) {
    const halfW = W / 2;
    const extL = extendSlopeEnds(H, -halfW, hRidge, zRidge, oL, 0);
    const extR = extendSlopeEnds(hRidge, zRidge, H, halfW, 0, oL);
    return [
        ombragePlaque(L + 2 * oR, extL.y1, extL.z1, extL.y2, extL.z2),
        ombragePlaque(L + 2 * oR, extR.y1, extR.z1, extR.y2, extR.z2),
    ].concat(ombragePignons(L, H, -halfW, halfW, zRidge, hRidge));
}

if (typeof window !== 'undefined') {
    window.OBJECT_LIBRARY = {
        tree: {
            label: 'Arbre', icon: '🌳', build: buildTree,
            defaults: { trunkHeight: 4, crownRadius: 2.5, transmission: OMBRAGE_TRANSMISSION_FEUILLU_ETE, transmissionHiver: OMBRAGE_TRANSMISSION_FEUILLU_HIVER },
            fields: [OMBRAGE_CHAMPS.trunkHeight, OMBRAGE_CHAMPS.crownRadius, OMBRAGE_CHAMPS.transmission, OMBRAGE_CHAMPS.transmissionHiver],
            // Même géométrie que buildTree : houppier = sphère étirée de 1,2 en hauteur.
            shading(p) {
                const trunkHeight = ombrageVal(this, p, 'trunkHeight');
                const r = ombrageVal(this, p, 'crownRadius');
                return [
                    { forme: 'cylindre', cx: 0, cz: 0, y0: 0, y1: trunkHeight, rayon: Math.max(0.1, trunkHeight * 0.12) / 2, transmission: 0 },
                    {
                        forme: 'ellipsoide', cx: 0, cy: trunkHeight + r * 0.7, cz: 0, rx: r, ry: r * 1.2, rz: r,
                        transmission: ombrageVal(this, p, 'transmission'),
                        transmissionHiver: ombrageVal(this, p, 'transmissionHiver'),
                    },
                ];
            },
        },
        treeConifer: {
            label: 'Arbre conifère (sapin, pin)', icon: '🌲', build: buildConiferTree,
            defaults: { trunkHeight: 1.5, trunkDiameter: 0.35, crownHeight: 7, crownDiameter: 4, tiers: 3, transmission: OMBRAGE_TRANSMISSION_CONIFERE },
            fields: [OMBRAGE_CHAMPS.trunkHeight, OMBRAGE_CHAMPS.trunkDiameter, OMBRAGE_CHAMPS.crownHeight,
                OMBRAGE_CHAMPS.crownDiameter, OMBRAGE_CHAMPS.tiers, OMBRAGE_CHAMPS.transmissionConifere],
            // Enveloppe du houppier = cône base crownDiameter / hauteur crownHeight (cf. buildConiferTree).
            shading(p) {
                const trunkHeight = ombrageVal(this, p, 'trunkHeight');
                const crownHeight = ombrageVal(this, p, 'crownHeight');
                return [
                    { forme: 'cylindre', cx: 0, cz: 0, y0: 0, y1: trunkHeight + crownHeight * 0.25, rayon: ombrageVal(this, p, 'trunkDiameter') / 2, transmission: 0 },
                    {
                        forme: 'cone', cx: 0, cz: 0, y0: trunkHeight, y1: trunkHeight + crownHeight,
                        rayon: ombrageVal(this, p, 'crownDiameter') / 2, transmission: ombrageVal(this, p, 'transmission'),
                    },
                ];
            },
        },
        houseMono: {
            label: 'Maison monopente', icon: '🏠', build: buildHouseMono,
            defaults: { length: 8, width: 6, height: 3, slope: 15, overhangRampant: 0.30, overhangLongpan: 0.30 },
            fields: MAISON_CHAMPS,
            // buildHouseMono : pente sur toute la largeur, du bas (z = -W/2) au haut (z = +W/2).
            shading(p) {
                const L = ombrageVal(this, p, 'length'), W = ombrageVal(this, p, 'width'), H = ombrageVal(this, p, 'height');
                const oR = ombrageVal(this, p, 'overhangRampant'), oL = ombrageVal(this, p, 'overhangLongpan');
                const rise = ombrageRise(H, W * ombrageTan(ombrageVal(this, p, 'slope')));
                const ext = extendSlopeEnds(H, -W / 2, H + rise, W / 2, oL, oL);
                const pignons = [-1, 1].map((s) => [[s * L / 2, H, -W / 2], [s * L / 2, H, W / 2], [s * L / 2, H + rise, W / 2]]);
                return [ombrageMurs(L, W, H), ombragePolyedre([ombragePlaque(L + 2 * oR, ext.y1, ext.z1, ext.y2, ext.z2)].concat(pignons))];
            },
        },
        houseBi: {
            label: 'Maison bipente', icon: '🏡', build: buildHouseBi,
            defaults: { length: 8, width: 6, height: 3, slope: 25, overhangRampant: 0.30, overhangLongpan: 0.30 },
            fields: MAISON_CHAMPS,
            shading(p) {
                const L = ombrageVal(this, p, 'length'), W = ombrageVal(this, p, 'width'), H = ombrageVal(this, p, 'height');
                const rise = ombrageRise(H, (W / 2) * ombrageTan(ombrageVal(this, p, 'slope')));
                return [ombrageMurs(L, W, H), ombragePolyedre(ombrageDeuxPans(L, W, H, 0, H + rise,
                    ombrageVal(this, p, 'overhangRampant'), ombrageVal(this, p, 'overhangLongpan')))];
            },
        },
        houseMulti: {
            label: 'Maison multipente', icon: '🏘️', build: buildHouseMulti,
            defaults: { length: 8, width: 6, height: 3, slope: 25, overhangRampant: 0.30, overhangLongpan: 0.30 },
            fields: MAISON_CHAMPS,
            // buildHouseMulti : pyramide sur base (L + 2 oR) x (W + 2 oL), sommet à H + W/2.tan(pente).
            shading(p) {
                const L = ombrageVal(this, p, 'length'), W = ombrageVal(this, p, 'width'), H = ombrageVal(this, p, 'height');
                const hl = L / 2 + ombrageVal(this, p, 'overhangRampant'), hw = W / 2 + ombrageVal(this, p, 'overhangLongpan');
                const yS = H + ombrageRise(H, (W / 2) * ombrageTan(ombrageVal(this, p, 'slope')));
                const b = [[-hl, H, -hw], [hl, H, -hw], [hl, H, hw], [-hl, H, hw]];
                const sommet = [0, yS, 0];
                const faces = b.map((c, i) => [c, b[(i + 1) % 4], sommet]).concat([b]);
                return [ombrageMurs(L, W, H), ombragePolyedre(faces)];
            },
        },
        houseAsym: {
            label: 'Maison toiture asymétrique', icon: '🏚️', build: buildHouseAsym,
            defaults: { length: 8, width: 6, height: 3, slopeLeft: 20, slopeRight: 40, overhangRampant: 0.30, overhangLongpan: 0.30 },
            fields: [OMBRAGE_CHAMPS.length, OMBRAGE_CHAMPS.width, OMBRAGE_CHAMPS.wallHeight, OMBRAGE_CHAMPS.slopeLeft,
                OMBRAGE_CHAMPS.slopeRight, OMBRAGE_CHAMPS.overhangRampant, OMBRAGE_CHAMPS.overhangLongpan],
            // buildHouseAsym : faîtage à l'intersection des deux pentes (pas forcément centré).
            shading(p) {
                const L = ombrageVal(this, p, 'length'), W = ombrageVal(this, p, 'width'), H = ombrageVal(this, p, 'height');
                const tL = ombrageTan(ombrageVal(this, p, 'slopeLeft')), tR = ombrageTan(ombrageVal(this, p, 'slopeRight'));
                const halfW = W / 2;
                const zRidge = (tL + tR) > 1e-9 ? halfW * (tR - tL) / (tL + tR) : 0;
                const hRidge = H + ombrageRise(H, (zRidge + halfW) * tL);
                return [ombrageMurs(L, W, H), ombragePolyedre(ombrageDeuxPans(L, W, H, zRidge, hRidge,
                    ombrageVal(this, p, 'overhangRampant'), ombrageVal(this, p, 'overhangLongpan')))];
            },
        },
        houseHip: {
            label: 'Maison toiture 4 pentes symétrique', icon: '🛖', build: buildHouseHip,
            defaults: { length: 10, width: 6, height: 3, slope: 25, overhangRampant: 0.30, overhangLongpan: 0.30 },
            fields: MAISON_CHAMPS,
            // buildHouseHip : deux bipentes accolées le long de X, faîtages parallèles à Z (groupe tourné
            // de 90° : x monde = centre de section + z local, z monde = -x local).
            shading(p) {
                const L = ombrageVal(this, p, 'length'), W = ombrageVal(this, p, 'width'), H = ombrageVal(this, p, 'height');
                const oR = ombrageVal(this, p, 'overhangRampant'), oL = ombrageVal(this, p, 'overhangLongpan');
                const hs = L / 4;
                const yS = H + ombrageRise(H, hs * ombrageTan(ombrageVal(this, p, 'slope')));
                const faces = [];
                [-1, 1].forEach((side) => {
                    const cx = side * hs;
                    const extA = extendSlopeEnds(H, -hs, yS, 0, oL, 0);
                    const extB = extendSlopeEnds(yS, 0, H, hs, 0, oL);
                    const hz = W / 2 + oR;
                    [extA, extB].forEach((e) => faces.push([
                        [cx + e.z1, e.y1, -hz], [cx + e.z1, e.y1, hz], [cx + e.z2, e.y2, hz], [cx + e.z2, e.y2, -hz]]));
                    [-1, 1].forEach((s) => faces.push([[cx - hs, H, s * W / 2], [cx + hs, H, s * W / 2], [cx, yS, s * W / 2]]));
                });
                return [ombrageMurs(L, W, H), ombragePolyedre(faces)];
            },
        },
        terrace: {
            label: 'Toiture terrasse', icon: '🏢', build: buildFlatRoofTerrace,
            defaults: { length: 8, width: 6, height: 3, acrotereHeight: 0.5, acrotereThickness: 0.15 },
            fields: [OMBRAGE_CHAMPS.length, OMBRAGE_CHAMPS.width, OMBRAGE_CHAMPS.wallHeight, OMBRAGE_CHAMPS.acrotereHeight, OMBRAGE_CHAMPS.acrotereThickness],
            // Vu de l'extérieur, le bâtiment (dalle 0,15 m) et son acrotère masquent comme un bloc plein.
            shading(p) {
                const h = ombrageVal(this, p, 'height') + 0.15 + ombrageVal(this, p, 'acrotereHeight');
                return [{ forme: 'boite', cx: 0, cy: h / 2, cz: 0, longueur: ombrageVal(this, p, 'length'), hauteur: h, largeur: ombrageVal(this, p, 'width'), transmission: 0 }];
            },
        },
        rectRoof: {
            label: 'Toiture rectangulaire', icon: '▬', build: buildRectRoof,
            defaults: { length: 6, width: 4, thickness: 0.15, height: 2.5, slope: 10 },
            fields: [OMBRAGE_CHAMPS.length, OMBRAGE_CHAMPS.width, OMBRAGE_CHAMPS.thickness, OMBRAGE_CHAMPS.height, OMBRAGE_CHAMPS.slopeRoof],
            // buildRectRoof : plan seul (auvent), bord bas à `height`, pente sur toute la largeur.
            shading(p) {
                const L = ombrageVal(this, p, 'length'), W = ombrageVal(this, p, 'width'), H = ombrageVal(this, p, 'height');
                const rise = ombrageRise(H, W * ombrageTan(ombrageVal(this, p, 'slope')));
                return [ombragePolyedre([ombragePlaque(L, H, -W / 2, H + rise, W / 2)])];
            },
        },
        box: {
            label: 'Bloc rectangulaire', icon: '◻️', build: buildBox,
            defaults: { length: 2, width: 2, height: 2 },
            fields: [OMBRAGE_CHAMPS.length, OMBRAGE_CHAMPS.width, OMBRAGE_CHAMPS.height],
            // Même volume que buildBox : longueur sur x, largeur sur z, posé au sol.
            shading(p) {
                const h = ombrageVal(this, p, 'height');
                return [{ forme: 'boite', cx: 0, cy: h / 2, cz: 0, longueur: ombrageVal(this, p, 'length'), hauteur: h, largeur: ombrageVal(this, p, 'width'), transmission: 0 }];
            },
        },
        // Tracé avec l'outil « polygone » de la vue 3D (pas de glisser-déposer : `dessine`, exclu de
        // la palette d'objets du calepinage). Même volume que buildBatimentDessine : murs + toit plat.
        batimentDessine: {
            label: 'Bâtiment (forme dessinée)', icon: '⬠', build: buildBatimentDessine, dessine: true,
            defaults: { height: 3, points: BATIMENT_DESSINE_CONTOUR_DEFAUT },
            fields: [OMBRAGE_CHAMPS.hauteurBatimentDessine],
            sanitize(p) { return { points: contourBatimentDessine(p.points) }; },
            shading(p) {
                const h = ombrageVal(this, p, 'height');
                const pts = contourBatimentDessine(p.points);
                const faces = pts.map((a, i) => {
                    const b = pts[(i + 1) % pts.length];
                    return [[a.x, 0, a.z], [b.x, 0, b.z], [b.x, h, b.z], [a.x, h, a.z]];
                });
                // Toit en triangles : un polygone concave n'est pas une face convexe (maillePolyedre
                // le découperait en éventail, faux pour un contour en L ou en U).
                triangulerContour(pts).forEach((t) => faces.push(t.map((i) => [pts[i].x, h, pts[i].z])));
                return [ombragePolyedre(faces)];
            },
        },
        lightMast: {
            label: "Mât d'éclairage", icon: '💡', build: buildLightMast,
            defaults: { height: 8 },
            fields: [OMBRAGE_CHAMPS.height],
            // buildLightMast : fût Ø 0,25 m + tête 0,6 x 0,2 x 0,3 m décalée de 0,3 m en tête de mât.
            shading(p) {
                const h = ombrageVal(this, p, 'height');
                return [
                    { forme: 'cylindre', cx: 0, cz: 0, y0: 0, y1: h, rayon: 0.125, transmission: 0 },
                    { forme: 'boite', cx: 0.3, cy: h, cz: 0, longueur: 0.6, hauteur: 0.2, largeur: 0.3, transmission: 0 },
                ];
            },
        },
        pole: {
            label: 'Poteau électrique', icon: '⚡', build: buildElectricPole,
            defaults: { height: 9 },
            fields: [OMBRAGE_CHAMPS.height],
            // buildElectricPole : fût Ø 0,22-0,32 m (moyenne 0,27) + traverse 1,6 x 0,12 x 0,12 m à h - 0,5.
            shading(p) {
                const h = ombrageVal(this, p, 'height');
                return [
                    { forme: 'cylindre', cx: 0, cz: 0, y0: 0, y1: h, rayon: 0.135, transmission: 0 },
                    { forme: 'boite', cx: 0, cy: Math.max(0.06, h - 0.5), cz: 0, longueur: 1.6, hauteur: 0.12, largeur: 0.12, transmission: 0 },
                ];
            },
        },
    };

    /**
     * Paramètres d'un objet ramenés dans les bornes de ses champs (`fields[].min/max`), SANS modifier
     * l'objet d'origine : valeur absente/invalide -> défaut de l'objet ; hors bornes -> borne.
     * Utilisée à l'enregistrement (CM.updateSceneObject3D), au rendu 3D et au calcul d'ombrage.
     */
    window.sanitizeSceneObjectParams = function (typeKey, params) {
        const def = window.OBJECT_LIBRARY[typeKey];
        const out = Object.assign({}, params || {});
        if (!def || !Array.isArray(def.fields)) return out;
        def.fields.forEach((f) => {
            if (f.min == null && f.max == null) return;
            out[f.k] = ombrageVal(def, params || {}, f.k);
        });
        // Paramètres non numériques propres à l'objet (contour d'un bâtiment dessiné).
        if (typeof def.sanitize === 'function') Object.assign(out, def.sanitize(out));
        return out;
    };

    // Génère une entrée OBJECT_LIBRARY par modèle de chaque famille de structure (cf.
    // window.LIBRARY_STRUCTURE_FAMILIES ci-dessus) — 7+6+4+4 = 21 entrées, préfixées par famille
    // (ex. "ombriereMetal_single") pour ne jamais entrer en collision avec les objets simples
    // ci-dessus. Exclues de la grille "simple" de la bibliothèque (cf. populateLibraryGrid dans
    // test_3d.html, qui filtre ce préfixe) : accessibles uniquement via les boutons de famille.
    Object.keys(window.LIBRARY_STRUCTURE_FAMILIES).forEach(familyKey => {
        const fam = window.LIBRARY_STRUCTURE_FAMILIES[familyKey];
        fam.models.forEach(m => {
            window.OBJECT_LIBRARY[familyKey + '_' + m.key] = {
                label: fam.label + ' - ' + m.label,
                icon: '🏗️',
                build: (scene, p) => buildStructureFamilyObject(scene, p, fam.structureType, m.key),
                defaults: structureDefaultsFor(fam.structureType),
                fields: structureFieldsFor(fam.structureType)
            };
        });
    });
}
