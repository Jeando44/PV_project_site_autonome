// Générateur paramétrique Babylon.js — modèle "Poteaux centrés liaisonnés" (monopente).
// Port 3D de ombriere_liasonnee.js (drawOmbriereLiasonee) : "linkedPanelsCount" ombrières
// "poteaux centrés" (model_single_post.js) IDENTIQUES, chaînées le long de la pente (axe Z),
// espacées de "postSpacing" mètres entre leurs centres (#postSpacing "Entraxe (m)" dans
// ombriere.html — même champ que le modèle "Double poteaux"), puis reliées entre elles par une
// petite entretoise à chaque poteau de façade.
//
// Simplification volontaire par rapport à ombriere_liasonnee.js : la version 2D prolonge la
// traverse de chaque ombrière (à partir de la 2e) du porte-à-faux gauche pour venir affleurer le
// bord de toiture de l'ombrière précédente, puis relie les 2 bords (potentiellement à des
// hauteurs différentes) par un quadrilatère quelconque. Ici, chaque ombrière reste un clone
// EXACT et non modifié de model_single_post.js ; la liaison entre deux ombrières consécutives
// est une simple entretoise droite (section traverse) reliant le bord "loin" de l'une au bord
// "près" de la suivante, quelle que soit la différence de hauteur — un pont visuel simple plutôt
// qu'un raccord de toiture parfaitement continu.

function buildLinkedPostShed(scene, params) {
    const {
        facadeLength, postWidth, lowPointHeight, panelWidth, roofSlope,
        beamHeight, beamWidth, invertSlope = false,
        overhangType = 'sym', overhangSym = 0.5, overhangF = 0.2, overhangG = 0.6,
        postSpacing = 15.0, linkedPanelsCount = 2,
        structureColor = '#8c929a'
    } = params;

    const panelCount = Math.max(2, Math.round(linkedPanelsCount));

    const slopeRad = ((roofSlope * Math.PI) / 180) * (invertSlope ? -1 : 1);
    const slopeLength = panelWidth / Math.cos(slopeRad);
    const isSymOverhang = overhangType !== 'asym';
    const ohF = isSymOverhang ? overhangSym : overhangF;
    const ohG = isSymOverhang ? overhangSym : overhangG;
    const traverseLength = Math.max(0.2, slopeLength - ohF - ohG);
    const traverseEccentricity = (ohG - ohF) / 2;
    const traverseEccentricityZ = traverseEccentricity * Math.cos(slopeRad);
    const beamTopY = lowPointHeight + (traverseEccentricity + slopeLength / 2) * Math.sin(slopeRad);

    // Entraxe minimal anti-chevauchement (empreinte au sol d'une ombrière), même règle que
    // getMinLinkedSpacing/validateLinkedSpacing dans ombriere_liasonnee.js.
    const minSpacing = panelWidth * Math.cos(Math.abs(((roofSlope || 0) * Math.PI) / 180));
    const safePostSpacing = postSpacing > minSpacing ? postSpacing : minSpacing + 0.01;

    const totalWidth = (panelCount - 1) * safePostSpacing;
    const startZ = -totalWidth / 2;

    const root = new BABYLON.TransformNode('linkedShedRoot', scene);
    const unitCenters = [];

    for (let i = 0; i < panelCount; i++) {
        const unit = buildSinglePostShed(scene, params);
        const centerZ = startZ + i * safePostSpacing;
        unit.position.z += centerZ;
        unit.parent = root;
        unitCenters.push(centerZ);
    }

    // Entretoises de liaison entre ombrières consécutives, à chaque poteau de façade.
    const steelMat = new BABYLON.StandardMaterial('linkSteelMat', scene);
    steelMat.diffuseColor = BABYLON.Color3.FromHexString(structureColor);

    const farZLocal = traverseEccentricityZ + traverseLength / 2;
    const nearZLocal = traverseEccentricityZ - traverseLength / 2;
    const yAt = (zLocal) => beamTopY - beamHeight / 2 + (zLocal - traverseEccentricityZ) * Math.tan(slopeRad);
    const yFar = yAt(farZLocal);
    const yNear = yAt(nearZLocal);

    const postPositions = parsePostDistancesSimple(params.postDistances, params.leftOverhang);
    // Les positions X des poteaux issues de chaque unité sont décalées de -facadeLength/2 par
    // buildSinglePostShed (cf. root.position.x -= facadeLength/2 en fin de fonction) : on applique
    // le même décalage ici pour placer les entretoises exactement à l'aplomb des poteaux.
    postPositions.forEach((x, i) => {
        const worldX = x - facadeLength / 2;
        for (let u = 0; u < panelCount - 1; u++) {
            const z1 = unitCenters[u] + farZLocal;
            const z2 = unitCenters[u + 1] + nearZLocal;
            const dz = z2 - z1, dy = yNear - yFar;
            const length = Math.sqrt(dz * dz + dy * dy);
            if (length < 1e-6) continue;
            const link = BABYLON.MeshBuilder.CreateBox(`linkedBrace_${i}_${u}`, {
                width: beamWidth, height: beamHeight, depth: length
            }, scene);
            link.rotation.x = -Math.atan2(dy, dz);
            link.position.set(worldX, (yFar + yNear) / 2, (z1 + z2) / 2);
            link.material = steelMat;
            link.parent = root;
        }
    });

    root.shedStats = {
        postPositions: postPositions.map(x => x - facadeLength / 2),
        beamTopY, postHeight: beamTopY, facadeLength, slopeLength,
        linkedPanelsCount: panelCount, postSpacing: safePostSpacing
    };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildLinkedPostShed = buildLinkedPostShed;
}
