// Générateurs Babylon.js pour les modèles "Petit champ solaire" — helpers et calculs de géométrie
// partagés entre les 4 modèles (Centrés, Excentrés, Double Poteaux, Bipente). Port direct des
// formules de static/js/petit_champ_solaire.js (moteur 2D), pas de nouvelle logique inventée.
//
// Repère Babylon (Y-up) : X = le long de la façade, Y = hauteur, Z = profondeur (sens de la pente).
// Réutilise SANS les redéfinir parsePostDistancesSimple / buildJarretGusset / applyGroundAnchorVertical
// (déjà exposés sur window par ombriere_metal/model_single_post.js, chargé avant dans test_3d.html).

/**
 * Les 2 seuls matériaux d'un petit champ : structure et panneaux, PARTAGÉS par toutes les tables de
 * la scène (un jeu par table empêchait toute fusion des maillages et multipliait les changements
 * d'état du rendu). Les plots de fondation posés au sol prennent la couleur de la structure ; rien
 * n'est représenté sous le sol. Un matériau libéré avec une structure précédente (dispose(false,
 * true) du viewer) n'est plus dans scene.materials : il est alors recréé.
 */
function petitChampMaterials(scene, structureColor, panelColor) {
    const cache = scene.__petitChampMats || (scene.__petitChampMats = {});
    const obtenir = (nom, hex) => {
        const cle = nom + '|' + hex;
        let m = cache[cle];
        if (!m || scene.materials.indexOf(m) === -1) {
            m = new BABYLON.StandardMaterial(nom, scene);
            m.diffuseColor = BABYLON.Color3.FromHexString(hex);
            cache[cle] = m;
        }
        return m;
    };
    return {
        structureMat: obtenir('petitStructureMat', structureColor),
        panelMat: obtenir('petitPanelMat', panelColor),
    };
}

/**
 * Calcule toutes les grandeurs géométriques communes aux modèles "petit champ solaire", à partir
 * des mêmes formules que calculateOmbriereMetalLocal (petit_champ_solaire.js) :
 * - dimAlongRampantM : dimension d'UN panneau le long de la pente (portrait -> longueur, paysage -> largeur).
 * - panelWidth : largeur totale du champ PV le long de la pente (nbPanelsRampant panneaux + espacements).
 * - overhangM : porte-à-faux en mètres = (overhangPct/100) * dimAlongRampantM (UN seul panneau, pas la somme).
 * - beamLength : longueur de la traverse (modèles non-Bipente) = panelWidth - 2*overhangM.
 * - passageHeight : hauteur libre sous la traverse, déduite de lowPointHeight (hauteur bas structure,
 *   saisie utilisateur) moins l'épaisseur du paquet traverse+panne+panneau, plus la remontée due au
 *   porte-à-faux sur la pente.
 */
function computePetitChampCommon(params) {
    const {
        nbPanelsRampant = 2, petitPanelLengthMm = 2382, petitPanelWidthMm = 1134,
        panelSpacingYMm = 20, isPaysage = false, overhangPct = 20,
        roofSlope: roofSlopeDeg = 14, lowPointHeight = 0.5, beamHeight = 0.10, purlinHeight = 0.10,
        panelThickness = 0.03
    } = params;

    const dimAlongRampantM = (isPaysage ? petitPanelWidthMm : petitPanelLengthMm) / 1000;
    const nbPanels = Math.max(1, Math.round(nbPanelsRampant));
    const panelSpacingM = (panelSpacingYMm || 0) / 1000;
    const panelWidth = nbPanels * dimAlongRampantM + (nbPanels - 1) * panelSpacingM;

    const overhangFrac = Math.min(0.5, Math.max(0, (overhangPct || 0) / 100));
    const overhangM = overhangFrac * dimAlongRampantM;

    const roofSlopeRad = roofSlopeDeg * Math.PI / 180;

    const lowPointThicknessStack = beamHeight + purlinHeight + panelThickness;
    const passageHeight = lowPointHeight - lowPointThicknessStack + overhangM * Math.sin(roofSlopeRad);

    return { dimAlongRampantM, nbPanels, panelSpacingM, panelWidth, overhangFrac, overhangM, roofSlopeRad, passageHeight };
}

/**
 * Bords de chaque panneau le long de la pente (repère LOCAL 1D, avant rotation/translation), en
 * partant de localStart et progressant par pas de (dimAlongRampantM + panelSpacingM) — même
 * construction que panelEdges dans drawRoofStructure (petit_champ_solaire.js). Retourne un tableau
 * de {start, end} en mètres, chacun représentant un panneau.
 */
function computePetitChampPanelEdges(localStart, nbPanels, dimAlongRampantM, panelSpacingM, dir = 1) {
    const edges = [];
    let cursor = localStart;
    for (let i = 0; i < nbPanels; i++) {
        const start = cursor;
        const end = cursor + dir * dimAlongRampantM;
        edges.push({ start, end });
        cursor += dir * (dimAlongRampantM + panelSpacingM);
    }
    return edges;
}

/**
 * Position des 2 pannes d'un panneau (bords {start,end}) à [overhangFrac, 1-overhangFrac] de sa
 * PROPRE dimension — même règle que le correctif "pannes" du moteur 2D (pas aux bords 0%/100%).
 * Les pannes du 1er et du dernier panneau tombent alors exactement sur les extrémités de la
 * traverse, par construction (même proportion que le porte-à-faux).
 */
function petitChampPurlinPositionsForEdge(edge, overhangFrac) {
    const a = edge.start + overhangFrac * (edge.end - edge.start);
    const b = edge.start + (1 - overhangFrac) * (edge.end - edge.start);
    return [a, b];
}

/**
 * Construit un bracon RECTANGULAIRE (bouts à 90°, perpendiculaires à son propre axe — pas de coupe
 * oblique suivant le poteau ou la traverse) entre 2 points {y,z} dans le plan Y-Z, extrudé le long
 * de X (thickness). Même principe que le correctif "barre rectangulaire" du moteur 2D
 * (drawReinforcement/drawDoublePostReinforcement), porté en 3D comme une simple boîte orientée.
 */
function buildPetitChampBrace(scene, root, name, x, p1, p2, thickness, width, material) {
    const dy = p2.y - p1.y, dz = p2.z - p1.z;
    const length = Math.hypot(dy, dz);
    if (length < 1e-6) return null;
    const brace = BABYLON.MeshBuilder.CreateBox(name, { width: width, height: length, depth: thickness }, scene);
    // FIX: bracons mal positionnés — la boîte est créée verticale (hauteur = length le long de
    // l'axe Y local) puis inclinée pour aligner cet axe Y local sur la direction p1->p2 dans le
    // plan Y-Z (rotation autour de X). Pour un point local (0,1,0), la rotation X donne
    // (cosθ, sinθ) en (Y,Z) : il faut donc θ = atan2(dz, dy) SANS décalage de -π/2 (l'ancien code
    // avait ce décalage en trop, ce qui faisait pointer chaque bracon à 90° de sa direction voulue
    // — il ne touchait alors ni le poteau ni la traverse comme sur les plans 2D).
    brace.rotation.x = Math.atan2(dz, dy);
    brace.position.set(x, (p1.y + p2.y) / 2, (p1.z + p2.z) / 2);
    brace.material = material;
    brace.parent = root;
    return brace;
}

/**
 * Construit les pannes (horizontales, le long de X, par-dessus la pente) pour une liste d'abscisses
 * "u" le long de la pente (repère local 1D, cf. computePetitChampPanelEdges) — une occurrence par
 * abscisse, sur toute la portée de façade donnée. getPointAt(u) renvoie {y,z} pour cette abscisse
 * (incluant la rotation propre du bras, utile pour la Bipente dont les 2 bras sont inclinés).
 */
function buildPetitChampPurlins(scene, root, { purlinUs, getPointAt, facadeStart, facadeLength, purlinWidth, purlinHeight, material, namePrefix = 'petitPurlin' }) {
    purlinUs.forEach((u, i) => {
        const p = getPointAt(u);
        const purlin = BABYLON.MeshBuilder.CreateBox(`${namePrefix}_${i}`, {
            width: facadeLength, height: purlinHeight, depth: purlinWidth
        }, scene);
        purlin.position.set(facadeStart + facadeLength / 2, p.y + purlinHeight / 2, p.z);
        purlin.material = material;
        purlin.parent = root;
    });
}

/**
 * Construit les panneaux individuels d'UN bras/traverse : panelEdges (le long de la pente) x
 * panelBays (le long de la façade, {start,width} par module). Chaque panneau est une boîte
 * individuelle avec sa vraie dimension mm, pas une dalle continue ni une grille décorative —
 * cf. la représentation "petit champ solaire" du moteur 2D. getPointAt(u) comme buildPetitChampPurlins.
 */
function buildPetitChampPanels(scene, root, { panelEdges, panelBays, getPointAt, purlinHeight, panelThickness, material, namePrefix = 'petitPanel' }) {
    panelBays.forEach((bay, xi) => {
        panelEdges.forEach((edge, pi) => {
            const pStart = getPointAt(edge.start);
            const pEnd = getPointAt(edge.end);
            const midY = (pStart.y + pEnd.y) / 2, midZ = (pStart.z + pEnd.z) / 2;
            const panelLen = Math.hypot(pEnd.y - pStart.y, pEnd.z - pStart.z);
            const panel = BABYLON.MeshBuilder.CreateBox(`${namePrefix}_${xi}_${pi}`, {
                width: bay.width, height: panelThickness, depth: panelLen
            }, scene);
            panel.rotation.x = Math.atan2(pEnd.z - pStart.z, pEnd.y - pStart.y) - Math.PI / 2;
            panel.position.set(bay.start + bay.width / 2, midY + purlinHeight + panelThickness / 2, midZ);
            panel.material = material;
            panel.parent = root;
        });
    });
}

/**
 * Découpe la portée [facadeStart, facadeStart+facadeLength] en "cols" modules égaux (avec un petit
 * joint esthétique, comme cellGap dans model_single_post.js) — utilisé pour répartir les panneaux le
 * long de la façade indépendamment des entraxes de poteaux (mêmes conventions que pvCols/cellWidth).
 */
function computePetitChampFacadeBays(facadeStart, facadeLength, cols) {
    const cellGap = 0.02;
    const n = Math.max(1, Math.round(cols));
    const cellWidth = Math.max(0.01, (facadeLength - cellGap * (n + 1)) / n);
    const pitch = cellWidth + cellGap;
    const bays = [];
    for (let c = 0; c < n; c++) {
        bays.push({ start: facadeStart + cellGap + c * pitch, width: cellWidth });
    }
    return bays;
}

/**
 * Hauteur (Y) du dessus de la traverse à Z=0 (position du poteau central), pour les modèles à
 * traverse DROITE (Centrés/Excentrés/Double Poteaux). Port de la relation 2D
 * (traversePosition='side', le cas par défaut désormais) : postHeight = passageHeight +
 * yLowestBeamPointRel, où yLowestBeamPointRel est la chute du dessus de la traverse entre son
 * centre (Z=0) et son extrémité (Z=±beamLength/2).
 */
function computePetitChampStraightPostHeight(geo, beamLength, beamHeight) {
    const yLowestBeamPointRel = (beamLength / 2) * Math.sin(geo.roofSlopeRad) + (beamHeight / 2) * Math.cos(geo.roofSlopeRad);
    return geo.passageHeight + yLowestBeamPointRel;
}

/**
 * Construit UNE traverse droite (Centrés/Excentrés/Double Poteaux — la traverse est TOUJOURS centrée
 * sur Z=0 et couvre panelWidth entier via ses pannes/panneaux, quelle que soit l'excentrement du
 * poteau qui la porte, exactement comme en 2D où beamLength/panelWidth ne dépendent pas de
 * postEccentricity) + ses pannes/panneaux, pour la liste de positions X données (une par entraxe de
 * façade). postHeight = hauteur (Y) du DESSUS de la traverse à Z=0.
 */
function buildPetitChampStraightRoof(scene, root, {
    xPositions, postHeight, beamLength, roofSlopeRad, beamHeight, beamWidth,
    geo, purlinWidth, purlinHeight, panelThickness, facadeStart, facadeLength, cols,
    structureMat, panelMat, hidePanels
}) {
    const getPointAt = (z) => ({ y: postHeight + z * Math.tan(roofSlopeRad), z });

    xPositions.forEach((x, i) => {
        const traverse = BABYLON.MeshBuilder.CreateBox(`petitTraverse_${i}`, {
            width: beamWidth, height: beamHeight, depth: beamLength
        }, scene);
        traverse.rotation.x = -roofSlopeRad;
        traverse.position.set(x, postHeight - beamHeight / 2, 0);
        traverse.material = structureMat;
        traverse.parent = root;
    });

    const halfPanelWidth = geo.panelWidth / 2;
    const purlinUs = [];
    const panelEdges = computePetitChampPanelEdges(-halfPanelWidth, geo.nbPanels, geo.dimAlongRampantM, geo.panelSpacingM, 1);
    panelEdges.forEach(edge => petitChampPurlinPositionsForEdge(edge, geo.overhangFrac).forEach(u => purlinUs.push(u)));

    buildPetitChampPurlins(scene, root, {
        purlinUs, getPointAt, facadeStart, facadeLength, purlinWidth, purlinHeight, material: structureMat
    });

    if (!hidePanels) {
        const panelBays = computePetitChampFacadeBays(facadeStart, facadeLength, cols);
        buildPetitChampPanels(scene, root, {
            panelEdges, panelBays, getPointAt, purlinHeight, panelThickness, material: panelMat
        });
    }

    return { getPointAt, halfPanelWidth };
}

if (typeof window !== 'undefined') {
    window.computePetitChampCommon = computePetitChampCommon;
    window.computePetitChampPanelEdges = computePetitChampPanelEdges;
    window.petitChampPurlinPositionsForEdge = petitChampPurlinPositionsForEdge;
    window.buildPetitChampBrace = buildPetitChampBrace;
    window.buildPetitChampPurlins = buildPetitChampPurlins;
    window.buildPetitChampPanels = buildPetitChampPanels;
    window.computePetitChampFacadeBays = computePetitChampFacadeBays;
    window.buildPetitChampStraightRoof = buildPetitChampStraightRoof;
    window.computePetitChampStraightPostHeight = computePetitChampStraightPostHeight;
}
