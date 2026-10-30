// Générateur paramétrique Babylon.js — modèle bois "Gd. Monopan (12m)" (id HTML modelInclinedPost,
// commentaire 2D "Modèle W 6 rangées Sud"). Port de la branche "postModel === 'inclinedPost'" de
// drawCoupe (model_simple.js) : une traverse monopente PLEINE LARGEUR (comme model_single_post.js,
// PAS raccourcie/décentrée par poteau comme le modèle métal "offset"), portée à chaque entraxe par
// DEUX poteaux inclinés symétriques penchant vers l'EXTÉRIEUR (outward=true, cf. "forceOutward"
// dans drawInclinedPoleExact — un poteau penche à droite, l'autre à gauche, PAS l'inverse), angle
// par rapport à l'HORIZONTALE #postInclinationBois (défaut 65°), espacés de "postSpacingInclined"
// (#postSpacingInclinedContainer, verrouillé/lecture-seule pour ce modèle, valeur fixe 2.30m),
// chacun accompagné d'une entretoise VERTICALE à son pied (même Z que sa base, montant jusqu'au
// dessous de la traverse) — port de "drawObliqueBar(x, base_y, x, yAtX)" qui, malgré son nom, est
// ici un montant vertical, pas oblique. Un poteau central (option "Masquer le poteau central",
// #hideCentralPost) peut aussi être affiché, masqué par défaut. Contreventement longitudinal
// (le long de la façade, #postBracePercent/#purlinBracePercent) sur la file F1 (poteaux "bas",
// Z=baseZLow) et/ou F2 (poteaux "haut", Z=baseZHigh) selon #contreventementF1/F2.
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildInclinedPostBoisShed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances, postWidth,
        postSpacingInclined = 2.30, postInclination = 65,
        hideCentralPost = true, braceThickness = 25,
        contreventementF1 = true, contreventementF2 = true, showAnchors = false
    } = params;

    const root = new BABYLON.TransformNode('shedRootBois', scene);
    const geo = computeWoodMonopenteGeometry(params);
    const materials = makeWoodMaterials(scene, params);
    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);
    const footThickness = braceThickness / 100;

    const halfEntraxe = postSpacingInclined / 2;
    const baseZLow = geo.traverseCenterZ - halfEntraxe;
    const baseZHigh = geo.traverseCenterZ + halfEntraxe;
    let heightF1 = 0.1, heightF2 = 0.1;

    postPositions.forEach((x, i) => {
        const { topY: topYLow } = buildInclinedWoodPost(scene, root, `poleLow_${i}`, x, baseZLow, geo.traverseCenterZ, geo, postWidth, materials.steelMat, postInclination, true, showAnchors, materials.anchorMat);
        const { topY: topYHigh } = buildInclinedWoodPost(scene, root, `poleHigh_${i}`, x, baseZHigh, geo.traverseCenterZ, geo, postWidth, materials.steelMat, postInclination, true, showAnchors, materials.anchorMat);
        heightF1 = topYLow;
        heightF2 = topYHigh;

        // Montant vertical au pied de chaque poteau incliné (même Z que la base), jusqu'au
        // dessous de la traverse À CETTE MÊME POSITION Z (pas jusqu'au point de jonction du
        // poteau incliné, qui lui s'écarte du centre) — port fidèle de drawObliqueBar appelé
        // avec x1===x2 dans le 2D d'origine. Jonction nette (verticalWoodPostHeight) pour ne
        // jamais dépasser le dessous de la traverse.
        buildObliqueWoodBrace(scene, root, `footLow_${i}`, x, 0, baseZLow, verticalWoodPostHeight(geo, baseZLow, footThickness), baseZLow, footThickness, materials.steelMat);
        buildObliqueWoodBrace(scene, root, `footHigh_${i}`, x, 0, baseZHigh, verticalWoodPostHeight(geo, baseZHigh, footThickness), baseZHigh, footThickness, materials.steelMat);

        if (!hideCentralPost) {
            const fullHeight = verticalWoodPostHeight(geo, geo.traverseCenterZ, postWidth);
            const { height: centralHeight, baseY } = applyWoodGroundAnchor(scene, root, `anchorCentral_${i}`, x, geo.traverseCenterZ, fullHeight, showAnchors, materials.anchorMat);
            const centralPost = BABYLON.MeshBuilder.CreateBox(`postCentral_${i}`, {
                width: postWidth, depth: postWidth, height: centralHeight
            }, scene);
            centralPost.position.set(x, baseY + centralHeight / 2, geo.traverseCenterZ);
            centralPost.material = materials.steelMat;
            centralPost.parent = root;
        }
    });

    if (contreventementF1) buildLongitudinalFacadeBracing(scene, root, params, geo, postPositions, heightF1, materials, baseZLow);
    if (contreventementF2) buildLongitudinalFacadeBracing(scene, root, params, geo, postPositions, heightF2, materials, baseZHigh);
    buildWoodRoof(scene, root, params, geo, postPositions, materials);

    root.position.x -= facadeLength / 2;
    root.shedStats = {
        postPositions, beamTopY: geo.beamTopY, postHeight: geo.beamTopY, facadeLength,
        slopeLength: params.panelWidth / Math.cos(geo.slopeRad)
    };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildInclinedPostBoisShed = buildInclinedPostBoisShed;
}
