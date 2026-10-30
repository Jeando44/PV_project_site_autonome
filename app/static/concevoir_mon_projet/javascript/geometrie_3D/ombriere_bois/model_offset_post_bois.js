// Générateur paramétrique Babylon.js — modèle bois "Simple 2 poteaux (7m)" (id HTML
// modelOffsetPost, commentaire 2D "Modèle N 3 rangées (Poteaux excentrés)" — bouton masqué dans
// ombriere_bois.html mais modèle pleinement fonctionnel, conservé pour cohérence avec le 2D).
// Port de la branche "postModel === 'offset'" de drawCoupe : même "N-truss" que
// model_double_post_bois.js (poteau vertical + poteau incliné + entretoise oblique, poteau
// incliné penchant vers l'EXTÉRIEUR — "forceOutward" inclut aussi 'offset'), mais l'excentrement
// du poteau vertical est piloté par "Excentrement (m)" (#postEccentricity, défaut 2.0) et
// "Position Poteau" (#offset-position-group, Bas/Haut), pas par la constante fabricant "1.45" du
// modèle "double". Entraxe par défaut 1.80m (#postSpacingOffset).
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildOffsetPostBoisShed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances, postWidth, panelWidth, invertSlope = false,
        postSpacingOffset = 1.80, postEccentricity = 2.0, offsetPostSide = 'low',
        doublePostBracing = 'v1', postInclination = 65,
        bracingPosition = 100, braceThickness = 25,
        contreventementF1 = true, contreventementF2 = true, showAnchors = false
    } = params;

    const root = new BABYLON.TransformNode('shedRootBoisOffset', scene);
    const geo = computeWoodMonopenteGeometry(params);
    const materials = makeWoodMaterials(scene, params);
    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);
    const footThickness = braceThickness / 100;

    const beamLength = geo.beamLength;
    const isLow = offsetPostSide === 'low';
    const ecc = (invertSlope ? isLow : !isLow) ? (beamLength / 2) - postEccentricity : -(beamLength / 2) + postEccentricity;
    const postZ = geo.traverseCenterZ - ecc;
    const sign = doublePostBracing === 'v2' ? -1 : 1;
    const baseZ = postZ + sign * postSpacingOffset;
    const bracingFrac = bracingPosition / 100;
    let heightF1 = 0.1, heightF2 = 0.1;

    postPositions.forEach((x, i) => {
        const fullHeight = verticalWoodPostHeight(geo, postZ, postWidth);
        heightF1 = fullHeight;
        const { height: postHeight, baseY } = applyWoodGroundAnchor(scene, root, `anchorVert_${i}`, x, postZ, fullHeight, showAnchors, materials.anchorMat);
        const post = BABYLON.MeshBuilder.CreateBox(`postVert_${i}`, {
            width: postWidth, depth: postWidth, height: postHeight
        }, scene);
        post.position.set(x, baseY + postHeight / 2, postZ);
        post.material = materials.steelMat;
        post.parent = root;

        const { topY: baseTopY } = buildInclinedWoodPost(scene, root, `poleIncl_${i}`, x, baseZ, postZ, geo, postWidth, materials.steelMat, postInclination, true, showAnchors, materials.anchorMat);
        heightF2 = baseTopY;

        const shortestY = Math.min(fullHeight, baseTopY);
        const attachY = shortestY * bracingFrac;
        buildObliqueWoodBrace(scene, root, `brace_${i}`, x, attachY, postZ, attachY, baseZ, footThickness, materials.steelMat);
    });

    if (contreventementF1) buildLongitudinalFacadeBracing(scene, root, params, geo, postPositions, heightF1, materials, postZ);
    if (contreventementF2) buildLongitudinalFacadeBracing(scene, root, params, geo, postPositions, heightF2, materials, baseZ);
    buildWoodRoof(scene, root, params, geo, postPositions, materials);

    root.position.x -= facadeLength / 2;
    root.shedStats = {
        postPositions, beamTopY: geo.beamTopY, postHeight: geo.beamTopY, facadeLength,
        slopeLength: panelWidth / Math.cos(geo.slopeRad)
    };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildOffsetPostBoisShed = buildOffsetPostBoisShed;
}
