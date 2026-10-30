// Générateur paramétrique Babylon.js — modèle bois "Simple Travolta-2 (6m)" (id HTML
// modelSimpleTravolta2). Port de la branche "postModel === 'simple_travolta_2'" de drawCoupe :
// une traverse monopente pleine largeur portée par DEUX poteaux VERTICAUX (contrairement à
// "Simple Travolta", pas de poteaux inclinés ici), reliés par un contreventement en CROIX (2
// entretoises obliques croisées) — port de "drawObliqueBar(leftBase, botY, rightBase, topY)" +
// son symétrique. Entraxe "postSpacingOffset" (même champ que le modèle "offset", réutilisé tel
// quel dans le 2D d'origine — cf. données "post_spacing_offset"), défaut 1.92m ; excentrement
// "postEccentricity" (défaut 0), position "Centré" par défaut (#offsetPosCenter).
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildSimpleTravolta2Shed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances, postWidth, invertSlope = false,
        postSpacingOffset = 1.92, postEccentricity = 0, offsetPostSide = 'center',
        bracingPosition = 80, braceThickness = 25,
        contreventementF1 = true, contreventementF2 = true, showAnchors = false
    } = params;

    const root = new BABYLON.TransformNode('shedRootBoisTravolta2', scene);
    const geo = computeWoodMonopenteGeometry(params);
    const materials = makeWoodMaterials(scene, params);
    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);
    const footThickness = braceThickness / 100;

    const beamLength = geo.beamLength;
    let ecc;
    if (offsetPostSide === 'center') {
        ecc = postEccentricity;
    } else {
        const isLow = offsetPostSide === 'low';
        ecc = (invertSlope ? isLow : !isLow)
            ? (beamLength / 2) - postEccentricity - (postSpacingOffset / 2)
            : -(beamLength / 2) + postEccentricity + (postSpacingOffset / 2);
    }
    const clampMargin = postSpacingOffset / 2 + postWidth / 2;
    const maxEcc = Math.max(0, beamLength / 2 - clampMargin);
    ecc = Math.max(-maxEcc, Math.min(maxEcc, ecc));

    const centerZ = geo.traverseCenterZ - ecc;
    const leftZ = centerZ - postSpacingOffset / 2;
    const rightZ = centerZ + postSpacingOffset / 2;
    const bracingFrac = bracingPosition / 100;

    let heightF1 = 0.1, heightF2 = 0.1;
    postPositions.forEach((x, i) => {
        const fullLeftHeight = verticalWoodPostHeight(geo, leftZ, postWidth);
        heightF1 = fullLeftHeight;
        const { height: leftHeight, baseY: leftBaseY } = applyWoodGroundAnchor(scene, root, `anchorLeft_${i}`, x, leftZ, fullLeftHeight, showAnchors, materials.anchorMat);
        const leftPost = BABYLON.MeshBuilder.CreateBox(`postLeft_${i}`, {
            width: postWidth, depth: postWidth, height: leftHeight
        }, scene);
        leftPost.position.set(x, leftBaseY + leftHeight / 2, leftZ);
        leftPost.material = materials.steelMat;
        leftPost.parent = root;

        const fullRightHeight = verticalWoodPostHeight(geo, rightZ, postWidth);
        heightF2 = fullRightHeight;
        const { height: rightHeight, baseY: rightBaseY } = applyWoodGroundAnchor(scene, root, `anchorRight_${i}`, x, rightZ, fullRightHeight, showAnchors, materials.anchorMat);
        const rightPost = BABYLON.MeshBuilder.CreateBox(`postRight_${i}`, {
            width: postWidth, depth: postWidth, height: rightHeight
        }, scene);
        rightPost.position.set(x, rightBaseY + rightHeight / 2, rightZ);
        rightPost.material = materials.steelMat;
        rightPost.parent = root;

        // Contreventement en croix : topY = hauteur du poteau le plus court, botY = son reflet
        // par rapport à crossY (= topY * bracingFrac), plafonné au pied réel des poteaux (0, ou
        // WOOD_ANCHOR_HEIGHT si l'ancrage est actif) — port de "shortestY"/"crossY"/"botY" du 2D.
        const topY = Math.min(fullLeftHeight, fullRightHeight);
        const floorY = showAnchors ? WOOD_ANCHOR_HEIGHT : 0;
        const crossY = floorY + (topY - floorY) * bracingFrac;
        const botY = Math.max(floorY, 2 * crossY - topY);
        buildObliqueWoodBrace(scene, root, `braceCrossA_${i}`, x, botY, leftZ, topY, rightZ, footThickness, materials.steelMat);
        buildObliqueWoodBrace(scene, root, `braceCrossB_${i}`, x, botY, rightZ, topY, leftZ, footThickness, materials.steelMat);
    });

    if (contreventementF1) buildLongitudinalFacadeBracing(scene, root, params, geo, postPositions, heightF1, materials, leftZ);
    if (contreventementF2) buildLongitudinalFacadeBracing(scene, root, params, geo, postPositions, heightF2, materials, rightZ);
    buildWoodRoof(scene, root, params, geo, postPositions, materials);

    root.position.x -= facadeLength / 2;
    root.shedStats = {
        postPositions, beamTopY: geo.beamTopY, postHeight: geo.beamTopY, facadeLength,
        slopeLength: params.panelWidth / Math.cos(geo.slopeRad)
    };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildSimpleTravolta2Shed = buildSimpleTravolta2Shed;
}
