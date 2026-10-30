// Générateur paramétrique Babylon.js — modèle bois "Simple Travolta (6m)" (id HTML
// modelSimpleTravolta). Port de la branche "postModel === 'simple_travolta'" de drawCoupe : une
// traverse monopente pleine largeur portée par DEUX poteaux "couplés" (vertical + incliné
// superposés, comme model_simple_azelan.js) penchant l'un vers l'autre (A-frame symétrique),
// espacés de "postSpacingTravolta" (défaut 1.92m). Correctifs ciblés :
// - Les 2 poteaux sont EXCENTRÉS par rapport à la traverse (#postOffsetTravolta = distance directe
//   du porte-à-faux, défaut 1.0m entre le poteau extérieur et l'extrémité de la traverse).
// - Plus de contreventement horizontal entre les 2 poteaux (supprimé) : le contreventement est
//   assuré par les 2 poteaux inclinés convergents eux-mêmes.
// Porte-à-faux asymétrique activé par défaut pour ce modèle (0.5m de chaque côté) — cf. le clic
// sur modelSimpleTravolta dans model_simple.js.
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildSimpleTravoltaShed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances, postWidth,
        postSpacingTravolta = 1.92, postOffsetTravolta = 1.0,
        postInclination = 65,
        contreventementF1 = true, contreventementF2 = true, showAnchors = false
    } = params;

    const root = new BABYLON.TransformNode('shedRootBoisTravolta', scene);
    const geo = computeWoodMonopenteGeometry(params);
    const materials = makeWoodMaterials(scene, params);
    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);

    const beamLength = geo.beamLength;
    // Porte-à-faux (correctif ciblé) : "postOffsetTravolta" représente DIRECTEMENT la distance
    // souhaitée entre le poteau extérieur (côté Z croissant) et l'extrémité de la traverse — ~1m
    // par défaut, demande explicite ("il doit y avoir une distance d'environ 1 mètre entre le
    // dernier poteau et l'extrémité de la traverse"). Contrairement aux autres modèles bois
    // (offset/azélan/travolta-2), pas de sélecteur Bas/Centré/Haut pour ce modèle (masqué dans
    // l'UI) : la paire est toujours excentrée du même côté, seule l'ampleur du porte-à-faux
    // (postOffsetTravolta) est réglable.
    let ecc = postOffsetTravolta + postSpacingTravolta / 2 - (beamLength / 2);
    const clampMargin = postSpacingTravolta / 2 + postWidth / 2;
    const maxEcc = Math.max(0, beamLength / 2 - clampMargin);
    ecc = Math.max(-maxEcc, Math.min(maxEcc, ecc));

    const centerZ = geo.traverseCenterZ - ecc;
    const leftZ = centerZ - postSpacingTravolta / 2;
    const rightZ = centerZ + postSpacingTravolta / 2;

    let heightF1 = 0.1, heightF2 = 0.1;
    postPositions.forEach((x, i) => {
        const fullLeftHeight = verticalWoodPostHeight(geo, leftZ, postWidth);
        heightF1 = fullLeftHeight;
        const { height: leftHeight, baseY: leftBaseY } = applyWoodGroundAnchor(scene, root, `anchorLeft_${i}`, x, leftZ, fullLeftHeight, showAnchors, materials.anchorMat);
        const leftVert = BABYLON.MeshBuilder.CreateBox(`postLeftVert_${i}`, {
            width: postWidth, depth: postWidth, height: leftHeight
        }, scene);
        leftVert.position.set(x, leftBaseY + leftHeight / 2, leftZ);
        leftVert.material = materials.steelMat;
        leftVert.parent = root;
        buildInclinedWoodPost(scene, root, `postLeftIncl_${i}`, x, leftZ, rightZ, geo, postWidth, materials.steelMat, postInclination, false, showAnchors, materials.anchorMat);

        const fullRightHeight = verticalWoodPostHeight(geo, rightZ, postWidth);
        heightF2 = fullRightHeight;
        const { height: rightHeight, baseY: rightBaseY } = applyWoodGroundAnchor(scene, root, `anchorRight_${i}`, x, rightZ, fullRightHeight, showAnchors, materials.anchorMat);
        const rightVert = BABYLON.MeshBuilder.CreateBox(`postRightVert_${i}`, {
            width: postWidth, depth: postWidth, height: rightHeight
        }, scene);
        rightVert.position.set(x, rightBaseY + rightHeight / 2, rightZ);
        rightVert.material = materials.steelMat;
        rightVert.parent = root;
        buildInclinedWoodPost(scene, root, `postRightIncl_${i}`, x, rightZ, leftZ, geo, postWidth, materials.steelMat, postInclination, false, showAnchors, materials.anchorMat);
        // Nettoyage structurel (correctif ciblé) : plus de barre horizontale entre les 2 poteaux —
        // le contreventement de ce modèle est assuré par les 2 poteaux inclinés convergents
        // eux-mêmes (postLeftIncl/postRightIncl), qui s'ancrent désormais correctement dans la
        // traverse grâce au correctif de buildInclinedWoodPost (ombriere_bois_shared.js).
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
    window.buildSimpleTravoltaShed = buildSimpleTravoltaShed;
}
