// "Petit champ solaire" — modèle "Bipente" (ex "Toiture Y") : un poteau central, 2 bras symétriques
// en forme de V inversé (faîtage au poteau, égouts plus bas — cf. correctifs successifs du moteur
// 2D pour ce modèle). Port de la logique y_shape de petit_champ_solaire.js :
// - beamLength (par bras) = panelWidth + espacement entre panneaux - porte-à-faux (correctif
//   "traverse trop courte / panne faîtière hors traverse").
// - bracon : fixé À 70% de la tête (poteau) vers l'égout (bord de toiture), sur la face AVANT
//   (dessous) de la traverse (correctif "bracon 70%").
// - pannes : 2 par panneau, à [porte-à-faux%, 100-porte-à-faux%] de sa propre dimension.

function buildPetitChampBipente(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances, postWidth = 0.10,
        beamHeight = 0.10, beamWidth = 0.15, purlinWidth = 0.02, purlinHeight = 0.10,
        panelThickness = 0.03, heightUnderBrace = 0.4, braceWidth = 0.05, braceFixPercentage = 70,
        structureColor = '#8c929a', panelColor = '#1e293b', showAnchors = false,
        pvCols = 6, hidePanels = false, reinforcementType = 'bracons'
    } = params;

    const root = new BABYLON.TransformNode('petitBipenteRoot', scene);
    const geo = computePetitChampCommon(params);
    // FIX: Traverse Bipente — longueur = largeur champ PV + espacement entre panneaux - porte-à-faux
    // (un seul, pas deux : chaque bras n'a qu'UN égout), pas panelWidth/2 comme les autres modèles.
    const beamLength = Math.max(0.2, geo.panelWidth + geo.panelSpacingM - geo.overhangM);

    const yLowestBeamPointRel = beamLength * Math.sin(geo.roofSlopeRad) + (beamHeight / 2) * Math.cos(geo.roofSlopeRad);
    const postHeight = geo.passageHeight + yLowestBeamPointRel;

    // getTopY/getPointAt : u=0 à la tête (poteau), u=beamLength à l'égout ; Y DESCEND avec u (V
    // inversé/faîtage au poteau), Z avance de u*cos(pente) dans le sens du bras (sign=±1).
    const getTopY = (u) => postHeight - u * Math.sin(geo.roofSlopeRad);
    const getPointAt = (sign) => (u) => ({ y: getTopY(u), z: sign * u * Math.cos(geo.roofSlopeRad) });

    // 2 matériaux partagés par tout le champ (petit_champ_solaire_shared.js) : les plots de
    // fondation posés au sol prennent la couleur de la structure.
    const { structureMat, panelMat } = petitChampMaterials(scene, structureColor, panelColor);
    const anchorMat = structureMat;

    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);

    // Poteau central (Z=0), un par entraxe — atteint le dessous de la traverse au faîtage.
    const postBoxHeight = Math.max(0.1, postHeight - beamHeight + metalOverlapAllowance(postWidth, 0, 1, geo.roofSlopeRad));
    postPositions.forEach((x, i) => {
        const { height: h, baseY } = applyGroundAnchorVertical(scene, root, `petitBipenteAnchor_${i}`, x, 0, postBoxHeight, showAnchors, anchorMat);
        const post = BABYLON.MeshBuilder.CreateBox(`petitBipentePost_${i}`, { width: postWidth, depth: postWidth, height: h }, scene);
        post.position.set(x, baseY + h / 2, 0);
        post.material = structureMat;
        post.parent = root;
    });

    // Panneaux/pannes : identiques sur les 2 bras (mêmes panelEdges, mêmes pannes), juste reflétés
    // en Z. Les panneaux commencent à la tête (u=0) — cf. en-tête pour pourquoi cela suffit à faire
    // tomber la panne faîtière sur la traverse sans qu'elle soit exactement à son extrémité.
    const panelEdges = computePetitChampPanelEdges(0, geo.nbPanels, geo.dimAlongRampantM, geo.panelSpacingM, 1);
    const purlinUs = [];
    panelEdges.forEach(edge => petitChampPurlinPositionsForEdge(edge, geo.overhangFrac).forEach(u => purlinUs.push(u)));
    const panelBays = computePetitChampFacadeBays(0, facadeLength, pvCols);

    [-1, 1].forEach(sign => {
        const getPoint = getPointAt(sign);

        // Traverse : boîte inclinée de la tête (poteau) à l'égout, dans le plan Y-Z.
        postPositions.forEach((x, i) => {
            const pStart = getPoint(0), pEnd = getPoint(beamLength);
            const midY = (pStart.y + pEnd.y) / 2 - beamHeight / 2, midZ = (pStart.z + pEnd.z) / 2;
            const traverse = BABYLON.MeshBuilder.CreateBox(`petitBipenteTraverse_${i}_${sign}`, {
                width: beamWidth, height: beamHeight, depth: beamLength
            }, scene);
            traverse.rotation.x = sign * geo.roofSlopeRad;
            traverse.position.set(x, midY, midZ);
            traverse.material = structureMat;
            traverse.parent = root;
        });

        buildPetitChampPurlins(scene, root, {
            purlinUs, getPointAt: getPoint, facadeStart: 0, facadeLength, purlinWidth, purlinHeight,
            material: structureMat, namePrefix: `petitBipentePurlin_${sign}`
        });
        if (!hidePanels) {
            buildPetitChampPanels(scene, root, {
                panelEdges, panelBays, getPointAt: getPoint, purlinHeight, panelThickness,
                material: panelMat, namePrefix: `petitBipentePanel_${sign}`
            });
        }

        // FIX: Bracon 70% — un seul bracon par bras, de la tête (poteau) vers l'égout, interpolé à
        // braceFixPercentage% (70% par défaut), sur la face AVANT (dessous) de la traverse.
        const effectiveHeightUnderBrace = Math.min(heightUnderBrace, postHeight * 0.9);
        if (effectiveHeightUnderBrace > 0.05 && reinforcementType === 'bracons') {
            const headFront = { y: getPoint(0).y - beamHeight, z: getPoint(0).z };
            const egoutFront = { y: getPoint(beamLength).y - beamHeight, z: getPoint(beamLength).z };
            const t = braceFixPercentage / 100;
            const target = { y: headFront.y + t * (egoutFront.y - headFront.y), z: headFront.z + t * (egoutFront.z - headFront.z) };
            postPositions.forEach((x, i) => {
                const p1 = { y: effectiveHeightUnderBrace, z: sign * postWidth / 2 };
                buildPetitChampBrace(scene, root, `petitBipenteBrace_${i}_${sign}`, x, p1, target, braceWidth, braceWidth, structureMat);
            });
        }
    });

    root.position.x -= facadeLength / 2;
    root.shedStats = { postPositions, postHeight, beamLength, panelWidth: geo.panelWidth, facadeLength, beamTopY: postHeight, slopeLength: geo.panelWidth };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildPetitChampBipente = buildPetitChampBipente;
}
