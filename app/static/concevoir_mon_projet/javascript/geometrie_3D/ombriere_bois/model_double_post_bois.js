// Générateur paramétrique Babylon.js — modèle bois "Simple 2 poteaux (5m)" (id HTML
// modelDoublePost, commentaire 2D "Modèle N 4 rangées"). Port de la branche
// "postModel === 'double'" de drawCoupe : une traverse monopente PLEINE LARGEUR (comme
// model_single_post.js), portée à chaque entraxe par UN poteau VERTICAL (à l'aplomb décentré
// "postEccentricity", formule fixe -(panelWidth/2 - 1.45 - postWidth/2) — port littéral de
// calculateOmbriereBoisLocal, "1.45" étant une constante du fabricant, pas un champ du
// formulaire) et UN poteau INCLINÉ, penchant vers l'EXTÉRIEUR (outward=true, "forceOutward"
// inclut 'double' dans le 2D d'origine) — ("postSpacing", #postSpacing, par défaut 1.92m plus
// loin, côté déterminé par la variante V1/V2 #bracing-variant-group), reliés par une entretoise
// oblique à "bracingPosition" % de la hauteur (#bracingPosition, défaut 53%). Contreventement
// longitudinal (le long de la façade) optionnel entre poteaux adjacents.
//
// F1 = poteau vertical (Z=postZ), F2 = poteau incliné (Z=baseZ) — #contreventementF1/F2.
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildDoublePostBoisShed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances, postWidth, panelWidth, invertSlope = false,
        postSpacing = 1.92, doublePostBracing = 'v1', postInclination = 65,
        bracingPosition = 53, braceThickness = 25,
        contreventementF1 = true, contreventementF2 = true, showAnchors = false
    } = params;

    const root = new BABYLON.TransformNode('shedRootBoisDouble', scene);
    const geo = computeWoodMonopenteGeometry(params);
    const materials = makeWoodMaterials(scene, params);
    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);
    const footThickness = braceThickness / 100;

    const ecc = invertSlope
        ? -(panelWidth / 2) + 1.45 + (postWidth / 2)
        : (panelWidth / 2) - 1.45 - (postWidth / 2);
    const postZ = geo.traverseCenterZ - ecc; // postX = -ecc (2D) : -ecc côté "postX", relatif au centre
    // CORRECTIF (pente inversée : une rangée de poteaux se détachait de la traverse) : "ecc" est
    // mirroré par invertSlope (le poteau vertical passe d'un bord à l'autre du toit), mais "sign"
    // (le côté V1/V2 vers lequel le poteau incliné s'étend DEPUIS le poteau vertical) restait fixe
    // — sans le flip ci-dessous, baseZ pouvait alors sortir de la portée réelle du toit (le poteau
    // incliné s'étendant vers l'extérieur au lieu de vers le centre), d'où le décrochage constaté.
    const sign = (doublePostBracing === 'v2' ? -1 : 1) * (invertSlope ? -1 : 1);
    const baseZ = postZ + sign * postSpacing;
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

        // Entretoise INCLINÉE (correctif ciblé) : relie la TÊTE du poteau le plus bas au MILIEU
        // (bracingFrac, ~53% par défaut) du poteau le plus haut — plus une barre horizontale entre
        // les 2 poteaux à un même niveau relatif, qui ne reflétait pas une vraie diagonale de
        // contreventement.
        const postIsLower = postHeight <= baseTopY;
        const lowZ = postIsLower ? postZ : baseZ;
        const lowTopY = postIsLower ? postHeight : baseTopY;
        const highZ = postIsLower ? baseZ : postZ;
        const highTopY = postIsLower ? baseTopY : postHeight;
        buildObliqueWoodBrace(scene, root, `brace_${i}`, x, lowTopY, lowZ, highTopY * bracingFrac, highZ, footThickness, materials.steelMat);
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
    window.buildDoublePostBoisShed = buildDoublePostBoisShed;
}
