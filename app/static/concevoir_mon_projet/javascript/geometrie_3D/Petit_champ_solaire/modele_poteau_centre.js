// "Petit champ solaire" — modèle "Centrés" (poteau au centre de la traverse, Z=0).
// Port du modèle 'single' de petit_champ_solaire.js (traversePosition='side', le cas par défaut).
// Réutilise parsePostDistancesSimple / metalOverlapAllowance / applyGroundAnchorVertical (déjà
// exposés par ombriere_metal/model_single_post.js) et les helpers de petit_champ_solaire_shared.js.

function buildPetitChampCentre(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances, postWidth = 0.10,
        beamHeight = 0.10, beamWidth = 0.15, purlinWidth = 0.02, purlinHeight = 0.10,
        panelThickness = 0.03, heightUnderBrace = 0.4, braceWidth = 0.05, braceFixPercentage = 70,
        structureColor = '#8c929a', panelColor = '#1e293b', showAnchors = false,
        pvCols = 6, hidePanels = false, reinforcementType = 'bracons'
    } = params;

    const root = new BABYLON.TransformNode('petitCentreRoot', scene);
    const geo = computePetitChampCommon(params);
    const beamLength = Math.max(0.2, geo.panelWidth - 2 * geo.overhangM);
    const postHeight = computePetitChampStraightPostHeight(geo, beamLength, beamHeight);

    // 2 matériaux partagés par tout le champ (petit_champ_solaire_shared.js) : les plots de
    // fondation posés au sol prennent la couleur de la structure.
    const { structureMat, panelMat } = petitChampMaterials(scene, structureColor, panelColor);
    const anchorMat = structureMat;

    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);

    // Poteaux : un par entraxe, centré sur la traverse (Z=0). Le pied touche le dessous de la
    // traverse (convention "poteau porte la traverse"), rallongé pour une intersection pleine.
    const postBoxHeight = Math.max(0.1, postHeight - beamHeight + metalOverlapAllowance(postWidth, 0, 1, geo.roofSlopeRad));
    postPositions.forEach((x, i) => {
        const { height: h, baseY } = applyGroundAnchorVertical(scene, root, `petitCentreAnchor_${i}`, x, 0, postBoxHeight, showAnchors, anchorMat);
        const post = BABYLON.MeshBuilder.CreateBox(`petitCentrePost_${i}`, { width: postWidth, depth: postWidth, height: h }, scene);
        post.position.set(x, baseY + h / 2, 0);
        post.material = structureMat;
        post.parent = root;
    });

    // Traverse + pannes + panneaux (partagé avec Excentrés/Double Poteaux : toujours centrés sur
    // Z=0, indépendamment de la position du/des poteau(x)).
    buildPetitChampStraightRoof(scene, root, {
        xPositions: postPositions, postHeight, beamLength, roofSlopeRad: geo.roofSlopeRad,
        beamHeight, beamWidth, geo, purlinWidth, purlinHeight, panelThickness,
        facadeStart: 0, facadeLength, cols: pvCols, structureMat, panelMat, hidePanels
    });

    // Bracons : 2 par poteau (de part et d'autre, plan Y-Z), de heightUnderBrace sur le poteau
    // jusqu'à braceFixPercentage% de la demi-portée de la traverse, visant son MILIEU (pas sa face
    // avant — cette règle est spécifique à la Bipente, cf. modele_bipente.js).
    const effectiveHeightUnderBrace = Math.min(heightUnderBrace, postHeight * 0.9);
    if (effectiveHeightUnderBrace > 0.05 && reinforcementType === 'bracons') {
        const reachZ = (beamLength / 2) * (braceFixPercentage / 100);
        const midY = (z) => postHeight + z * Math.tan(geo.roofSlopeRad) - beamHeight / 2;
        postPositions.forEach((x, i) => {
            [-1, 1].forEach(sign => {
                const p1 = { y: effectiveHeightUnderBrace, z: sign * postWidth / 2 };
                const p2 = { y: midY(sign * reachZ), z: sign * reachZ };
                buildPetitChampBrace(scene, root, `petitCentreBrace_${i}_${sign}`, x, p1, p2, braceWidth, braceWidth, structureMat);
            });
        });
    }

    root.position.x -= facadeLength / 2;
    // facadeLength/beamTopY/slopeLength : alias attendus par le message de statut générique de
    // test_3d.html (regenerateAll), commun à toutes les familles de générateurs 3D.
    root.shedStats = { postPositions, postHeight, beamLength, panelWidth: geo.panelWidth, facadeLength, beamTopY: postHeight, slopeLength: geo.panelWidth };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildPetitChampCentre = buildPetitChampCentre;
}
