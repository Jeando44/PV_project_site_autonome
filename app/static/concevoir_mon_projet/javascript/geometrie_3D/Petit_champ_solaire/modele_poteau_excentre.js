// "Petit champ solaire" — modèle "Excentrés" (poteau décalé de postEccentricity par rapport au
// centre de la traverse). Port du modèle 'offset' de petit_champ_solaire.js. La traverse/les
// pannes/panneaux restent IDENTIQUES au modèle "Centrés" (toujours centrés sur Z=0, comme en 2D où
// beamLength/panelWidth ne dépendent pas de postEccentricity) — seule la position du poteau change.

function buildPetitChampExcentre(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances, postWidth = 0.10,
        beamHeight = 0.10, beamWidth = 0.15, purlinWidth = 0.02, purlinHeight = 0.10,
        panelThickness = 0.03, heightUnderBrace = 0.4, braceWidth = 0.05, braceFixPercentage = 70,
        structureColor = '#8c929a', panelColor = '#1e293b', showAnchors = false,
        pvCols = 6, hidePanels = false, reinforcementType = 'bracons', postEccentricityPetit: postEccentricity = 2.0
    } = params;

    const root = new BABYLON.TransformNode('petitExcentreRoot', scene);
    const geo = computePetitChampCommon(params);
    const beamLength = Math.max(0.2, geo.panelWidth - 2 * geo.overhangM);
    const postHeight = computePetitChampStraightPostHeight(geo, beamLength, beamHeight);

    // Excentrement borné à la demi-portée de la traverse (le poteau doit rester dessous).
    const zPost = Math.max(-beamLength / 2 + postWidth, Math.min(beamLength / 2 - postWidth, postEccentricity));

    // 2 matériaux partagés par tout le champ (petit_champ_solaire_shared.js) : les plots de
    // fondation posés au sol prennent la couleur de la structure.
    const { structureMat, panelMat } = petitChampMaterials(scene, structureColor, panelColor);
    const anchorMat = structureMat;

    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);

    const postTopY = (z) => postHeight + z * Math.tan(geo.roofSlopeRad);
    const postBoxHeight = Math.max(0.1, postTopY(zPost) - beamHeight + metalOverlapAllowance(postWidth, 0, 1, geo.roofSlopeRad));
    postPositions.forEach((x, i) => {
        const { height: h, baseY } = applyGroundAnchorVertical(scene, root, `petitExcentreAnchor_${i}`, x, zPost, postBoxHeight, showAnchors, anchorMat);
        const post = BABYLON.MeshBuilder.CreateBox(`petitExcentrePost_${i}`, { width: postWidth, depth: postWidth, height: h }, scene);
        post.position.set(x, baseY + h / 2, zPost);
        post.material = structureMat;
        post.parent = root;
    });

    buildPetitChampStraightRoof(scene, root, {
        xPositions: postPositions, postHeight, beamLength, roofSlopeRad: geo.roofSlopeRad,
        beamHeight, beamWidth, geo, purlinWidth, purlinHeight, panelThickness,
        facadeStart: 0, facadeLength, cols: pvCols, structureMat, panelMat, hidePanels
    });

    // Bracons : mêmes règles que "Centrés", mais la prise sur le poteau et l'ancrage sur la
    // traverse sont mesurés à partir de la position RÉELLE du poteau (zPost), pas de Z=0.
    const postTopAtZPost = postTopY(zPost);
    const effectiveHeightUnderBrace = Math.min(heightUnderBrace, postTopAtZPost * 0.9);
    if (effectiveHeightUnderBrace > 0.05 && reinforcementType === 'bracons') {
        const reachZ = (beamLength / 2) * (braceFixPercentage / 100);
        const midY = (z) => postHeight + z * Math.tan(geo.roofSlopeRad) - beamHeight / 2;
        postPositions.forEach((x, i) => {
            [-1, 1].forEach(sign => {
                const targetZ = Math.max(-beamLength / 2, Math.min(beamLength / 2, zPost + sign * reachZ));
                const p1 = { y: effectiveHeightUnderBrace, z: zPost + sign * postWidth / 2 };
                const p2 = { y: midY(targetZ), z: targetZ };
                buildPetitChampBrace(scene, root, `petitExcentreBrace_${i}_${sign}`, x, p1, p2, braceWidth, braceWidth, structureMat);
            });
        });
    }

    root.position.x -= facadeLength / 2;
    root.shedStats = { postPositions, postHeight, beamLength, zPost, panelWidth: geo.panelWidth, facadeLength, beamTopY: postHeight, slopeLength: geo.panelWidth };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildPetitChampExcentre = buildPetitChampExcentre;
}
