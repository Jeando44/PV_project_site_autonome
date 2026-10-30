// Générateur paramétrique Babylon.js — modèle "Poteaux excentrés" (monopente).
// Reprend la toiture (traverse, bracons, pannes, rails, panneaux) telle quelle du modèle
// "poteaux centrés" (model_single_post.js) : seul change l'emplacement du POTEAU, décalé le
// long de la pente (axe Z) de "postEccentricity" mètres par rapport au centre de la traverse
// qu'il supporte (traverseEccentricityZ) — comme #postEccentricity dans ombriere.html. La
// hauteur du poteau est recalculée par intersection avec le dessous de la traverse à sa
// nouvelle position, exactement comme le fait drawThePosts/getBeamLine côté 2D (ombriere_v2.js).
//
// Simplification volontaire par rapport à ombriere.html : pas de sélecteur "Côté Bas/Haut"
// (offsetPostSide) dans test_3d.html — seul le champ "Excentrement (m)" a été demandé. Un
// excentrement positif déplace le poteau vers le faîtage (Z+), négatif vers l'égout (Z-).
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildOffsetPostShed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances,
        postWidth, lowPointHeight, panelWidth, roofSlope,
        beamHeight, beamWidth, purlinHeight, purlinCount,
        panelThickness, integrationSystemHeight, integrationSystemWidth = 0.06, invertSlope = false,
        heightUnderBrace = 2.80, braceWidth = 0.10, braceFixPercentage = 70,
        pvLayout = '7LX40C', structureColor = '#8c929a', panelColor = '#1e293b', hideRails = false,
        hidePanels = false, overhangType = 'sym', overhangSym = 0.5, overhangF = 0.2, overhangG = 0.6,
        postEccentricity = 2.0, reinforcementType = 'bracons', showAnchors = false
    } = params;

    const root = new BABYLON.TransformNode('shedRoot', scene);
    const slopeRad = ((roofSlope * Math.PI) / 180) * (invertSlope ? -1 : 1);
    const slopeLength = panelWidth / Math.cos(slopeRad);

    const isSymOverhang = overhangType !== 'asym';
    const ohF = isSymOverhang ? overhangSym : overhangF;
    const ohG = isSymOverhang ? overhangSym : overhangG;
    const traverseLength = Math.max(0.2, slopeLength - ohF - ohG);
    const traverseEccentricity = (ohG - ohF) / 2;
    const traverseEccentricityZ = traverseEccentricity * Math.cos(slopeRad);

    const beamTopY = lowPointHeight + (traverseEccentricity + slopeLength / 2) * Math.sin(slopeRad);

    // Poteau décalé le long de Z (pas cos(pente) : postEccentricity est déjà une distance horizontale
    // projetée, comme dans le formulaire ombriere.html — cf. drawThePosts: "postCenterX = basePostX +
    // values.postEccentricity * scale", où scale s'applique uniformément aux deux axes du plan de coupe).
    const postZ = traverseEccentricityZ + postEccentricity;
    const beamBottomAt = (z) => (beamTopY - beamHeight) + (z - traverseEccentricityZ) * Math.tan(slopeRad);
    const postTopY = beamBottomAt(postZ);
    // Rallongé (metalOverlapAllowance) pour une intersection pleine avec le dessous de la traverse,
    // pas seulement par un coin de la section du poteau — correctif ciblé.
    const postHeight = Math.max(0.1, postTopY + metalOverlapAllowance(postWidth, 0, 1, slopeRad));

    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);

    const makeMat = (name, r, g, b) => {
        const m = new BABYLON.StandardMaterial(name, scene);
        m.diffuseColor = new BABYLON.Color3(r, g, b);
        return m;
    };
    const steelMat = new BABYLON.StandardMaterial('steelMat', scene);
    steelMat.diffuseColor = BABYLON.Color3.FromHexString(structureColor);
    const panelMat = new BABYLON.StandardMaterial('panelMat', scene);
    panelMat.diffuseColor = BABYLON.Color3.FromHexString(panelColor);
    const integrationMat = makeMat('integrationMat', 0.82, 0.84, 0.86);
    const anchorMat = makeMat('anchorMat', 0.61, 0.64, 0.68);

    postPositions.forEach((x, i) => {
        const { height: h, baseY } = applyGroundAnchorVertical(scene, root, `anchor_${i}`, x, postZ, postHeight, showAnchors, anchorMat);
        const post = BABYLON.MeshBuilder.CreateBox(`post_${i}`, {
            width: postWidth, depth: postWidth, height: h
        }, scene);
        post.position.set(x, baseY + h / 2, postZ);
        post.material = steelMat;
        post.parent = root;
    });

    postPositions.forEach((x, i) => {
        const traverse = BABYLON.MeshBuilder.CreateBox(`traverse_${i}`, {
            width: beamWidth, height: beamHeight, depth: traverseLength
        }, scene);
        traverse.rotation.x = -slopeRad;
        traverse.position.set(x, beamTopY - beamHeight / 2, traverseEccentricityZ);
        traverse.material = steelMat;
        traverse.parent = root;
    });

    // Bracons : ancrés sur le poteau excentré (postZ), pas sur le centre de la traverse — sinon
    // ils partiraient dans le vide si l'excentrement est important.
    const effectiveHeightUnderBrace = Math.min(heightUnderBrace, postHeight * 0.9);
    if (effectiveHeightUnderBrace > 0.05) {
        const reachZ = (traverseLength / 2) * (braceFixPercentage / 100) * Math.cos(slopeRad);
        const addBraceYZ = (x, y1, z1, y2, z2, name) => {
            const ext = extendBraceToTraverse(y1, z1, y2, z2, braceWidth, slopeRad);
            const dz = ext.z - z1, dy = ext.y - y1;
            const length = Math.sqrt(dz * dz + dy * dy);
            if (length < 1e-6) return;
            const brace = BABYLON.MeshBuilder.CreateBox(name, {
                width: braceWidth, height: braceWidth, depth: length
            }, scene);
            brace.rotation.x = -Math.atan2(dy, dz);
            brace.position.set(x, (y1 + ext.y) / 2, (z1 + ext.z) / 2);
            brace.material = steelMat;
            brace.parent = root;
        };
        // Jarret : équerre triangulaire pleine à l'angle poteau/traverse (cf. commentaire détaillé
        // dans model_single_post.js). Le poteau étant excentré, le "point poteau" est pris à postZ
        // (pas au centre de la traverse), comme pour les bracons ci-dessus.
        const jarretHeight = 0.35;
        const addJarret = (x, postZEdge, outerZ, name) => {
            const postY = beamBottomAt(postZEdge);
            const outerY = beamBottomAt(outerZ);
            const p1 = { y: postY - jarretHeight, z: postZEdge };
            const p2 = { y: outerY, z: outerZ };
            const p3 = { y: postY, z: postZEdge };
            const gusset = buildJarretGusset(scene, name, p1, p2, p3, x, braceWidth, steelMat);
            gusset.parent = root;
        };
        postPositions.forEach((x, i) => {
            const outerZLow = traverseEccentricityZ - reachZ;
            const outerZHigh = traverseEccentricityZ + reachZ;
            if (reinforcementType === 'jarrets') {
                addJarret(x, postZ - postWidth / 2, outerZLow, `jarret_${i}_low`);
                addJarret(x, postZ + postWidth / 2, outerZHigh, `jarret_${i}_high`);
            } else {
                addBraceYZ(x, effectiveHeightUnderBrace, postZ - postWidth / 2, beamBottomAt(outerZLow), outerZLow, `brace_${i}_low`);
                addBraceYZ(x, effectiveHeightUnderBrace, postZ + postWidth / 2, beamBottomAt(outerZHigh), outerZHigh, `brace_${i}_high`);
            }
        });
    }

    const purlinCountSafe = Math.max(2, Math.round(purlinCount));
    const purlinHalfSpanZ = (traverseLength / 2) * Math.cos(slopeRad);
    for (let i = 0; i < purlinCountSafe; i++) {
        const t = purlinCountSafe === 1 ? 0.5 : i / (purlinCountSafe - 1);
        let z = traverseEccentricityZ - purlinHalfSpanZ + t * (2 * purlinHalfSpanZ);
        if (i === 0) z = traverseEccentricityZ - purlinHalfSpanZ + beamWidth / 2;
        if (i === purlinCountSafe - 1) z = traverseEccentricityZ + purlinHalfSpanZ - beamWidth / 2;
        const traverseTopAt = beamTopY + (z - traverseEccentricityZ) * Math.tan(slopeRad);
        const purlin = BABYLON.MeshBuilder.CreateBox(`purlin_${i}`, {
            width: facadeLength, height: purlinHeight, depth: beamWidth
        }, scene);
        purlin.position.set(facadeLength / 2, traverseTopAt + purlinHeight / 2, z);
        purlin.material = steelMat;
        purlin.parent = root;
    }

    const { rows: pvRows, cols: pvCols } = parsePvLayoutSimple(pvLayout, 1, 1);
    const cellGap = 0.02;
    const cellDepth = Math.max(0.01, (slopeLength - cellGap * (pvRows + 1)) / pvRows);
    const cellWidth = Math.max(0.01, (facadeLength - cellGap * (pvCols + 1)) / pvCols);
    const cellPitch = cellWidth + cellGap;

    const integrationY0 = beamTopY + purlinHeight;
    if (!hideRails) {
        for (let c = 0; c <= pvCols; c++) {
            const railX = c * cellPitch + cellGap / 2;
            const rail = BABYLON.MeshBuilder.CreateBox(`integrationRail_${c}`, {
                width: integrationSystemWidth, height: integrationSystemHeight, depth: slopeLength
            }, scene);
            rail.rotation.x = -slopeRad;
            rail.position.set(railX, integrationY0 + integrationSystemHeight / 2, 0);
            rail.material = integrationMat;
            rail.parent = root;
        }
    }

    const panelOffsetY = integrationY0 + integrationSystemHeight;
    const panelGroup = new BABYLON.TransformNode('panelGroup', scene);
    panelGroup.rotation.x = -slopeRad;
    panelGroup.position.set(facadeLength / 2, panelOffsetY + panelThickness / 2, 0);
    panelGroup.parent = root;

    if (!hidePanels) {
        for (let r = 0; r < pvRows; r++) {
            const cz = -slopeLength / 2 + cellGap + cellDepth / 2 + r * (cellDepth + cellGap);
            for (let c = 0; c < pvCols; c++) {
                const cx = -facadeLength / 2 + cellGap + cellWidth / 2 + c * (cellWidth + cellGap);
                const cell = BABYLON.MeshBuilder.CreateBox(`pvCell_${r}_${c}`, {
                    width: cellWidth, height: panelThickness, depth: cellDepth
                }, scene);
                cell.position.set(cx, 0, cz);
                cell.material = panelMat;
                cell.parent = panelGroup;
            }
        }
    }

    root.position.x -= facadeLength / 2;
    root.shedStats = { postPositions, beamTopY, postHeight, facadeLength, slopeLength };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildOffsetPostShed = buildOffsetPostShed;
}
