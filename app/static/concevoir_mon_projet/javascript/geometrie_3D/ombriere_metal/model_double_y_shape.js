// Générateur paramétrique Babylon.js — modèle "Double toiture Y".
// "doubleYShapePanelsCount" structures "Toiture Y" chaînées le long de la pente (axe Z), espacées
// de "postSpacing" mètres entre leurs poteaux (#postSpacing "Entraxe (m)" dans ombriere.html).
//
// Port de drawDoubleYShapeOmbriere (ombriere_liasonnee.js) : contrairement à model_y_shape.js
// (2 bras symétriques standards), le bras qui fait face à un poteau voisin ("bras de jonction")
// est étiré jusqu'au point milieu exact entre les 2 poteaux — traverse ET panneau, sans porte-à-
// faux supplémentaire sur ce bras — pour que les 2 ombrières se rejoignent exactement au niveau
// du faîtage/traverse, sans entretoise de liaison séparée. Le bras extérieur (sans voisin, aux 2
// bouts de la chaîne) reste standard, identique à model_y_shape.js (porte-à-faux normal inclus).
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildDoubleYShapeShed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances,
        postWidth, lowPointHeight, panelWidth, roofSlope,
        beamHeight, beamWidth, purlinHeight, purlinCount,
        panelThickness, integrationSystemHeight, integrationSystemWidth = 0.06, invertSlope = false,
        heightUnderBrace = 2.80, braceWidth = 0.10, braceFixPercentage = 70,
        pvLayout = '7LX40C', structureColor = '#8c929a', panelColor = '#1e293b', hideRails = false,
        hidePanels = false, overhangSym = 0.5,
        postSpacing = 12.40, doubleYShapePanelsCount = 2, reinforcementType = 'bracons', showAnchors = false
    } = params;

    const panelCount = Math.max(2, Math.round(doubleYShapePanelsCount));
    const slopeRad = ((roofSlope * Math.PI) / 180) * (invertSlope ? -1 : 1);
    // Garde-fou minimal (poteaux qui se chevaucheraient) : pas de plafond "empreinte au sol d'une
    // ombrière" ici, contrairement à une version antérieure — l'entraxe est désormais justement
    // censé pouvoir être ÉGAL (ou proche) à la largeur du champ PV pour que les bras de jonction
    // rejoignent exactement les bras standards (cf. tête de fichier).
    const safePostSpacing = Math.max(postWidth + 0.2, postSpacing);

    const armSlopeLengthStandard = Math.max(0.2, (panelWidth / 2) / Math.cos(slopeRad));
    const traverseLengthArmStandard = Math.max(0.2, armSlopeLengthStandard - overhangSym);
    const centerY = lowPointHeight - armSlopeLengthStandard * Math.sin(slopeRad);
    const postHeight = Math.max(0.1, centerY - beamHeight);

    // Longueur (traverse ET panneau, le long de la pente) d'un bras de JONCTION : atteint
    // exactement le point milieu entre les 2 poteaux voisins (même formule que
    // "innerArmLengthScaled" dans drawDoubleYShapeOmbriere).
    const junctionArmLength = Math.max(0.2, ((safePostSpacing - postWidth) / 2) / Math.cos(slopeRad));

    const totalWidth = (panelCount - 1) * safePostSpacing;
    const startZ = -totalWidth / 2;

    const root = new BABYLON.TransformNode('doubleYShapeRoot', scene);
    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);

    const makeMat = (name, r, g, b) => {
        const m = new BABYLON.StandardMaterial(name, scene);
        m.diffuseColor = new BABYLON.Color3(r, g, b);
        return m;
    };
    const steelMat = new BABYLON.StandardMaterial('steelMatDY', scene);
    steelMat.diffuseColor = BABYLON.Color3.FromHexString(structureColor);
    const panelMat = new BABYLON.StandardMaterial('panelMatDY', scene);
    panelMat.diffuseColor = BABYLON.Color3.FromHexString(panelColor);
    const integrationMat = makeMat('integrationMatDY', 0.82, 0.84, 0.86);
    const anchorMat = makeMat('anchorMatDY', 0.61, 0.64, 0.68);

    const { rows: pvRows, cols: pvCols } = parsePvLayoutSimple(pvLayout, 1, 1);
    const cellGap = 0.02;
    const cellWidth = Math.max(0.01, (facadeLength - cellGap * (pvCols + 1)) / pvCols);

    for (let u = 0; u < panelCount; u++) {
        const centerZ = startZ + u * safePostSpacing;
        const hasLeftNeighbor = u > 0;
        const hasRightNeighbor = u < panelCount - 1;

        postPositions.forEach((x, i) => {
            const worldX = x - facadeLength / 2;
            const { height: h, baseY } = applyGroundAnchorVertical(scene, root, `anchorDY_${u}_${i}`, worldX, centerZ, postHeight, showAnchors, anchorMat);
            const post = BABYLON.MeshBuilder.CreateBox(`postDY_${u}_${i}`, {
                width: postWidth, depth: postWidth, height: h
            }, scene);
            post.position.set(worldX, baseY + h / 2, centerZ);
            post.material = steelMat;
            post.parent = root;
        });

        [-1, 1].forEach(sign => {
            const hasNeighbor = sign === -1 ? hasLeftNeighbor : hasRightNeighbor;
            // Bras de jonction : traverse ET panneau étirés à l'identique jusqu'au point milieu
            // (pas de porte-à-faux supplémentaire). Bras standard : comme model_y_shape.js.
            const traverseLen = hasNeighbor ? junctionArmLength : traverseLengthArmStandard;
            const panelLen = hasNeighbor ? junctionArmLength : armSlopeLengthStandard;

            // Mêmes vecteurs unitaires (calculés directement, pas via cos/sin d'un angle de
            // rotation.x unique) que model_y_shape.js — voir le commentaire détaillé dans ce
            // dernier sur pourquoi un angle proche de 180° pour le bras sign=-1 inverserait le
            // sens "vers le haut" si on l'utilisait pour les positions au lieu des vecteurs directs.
            const armRotX = -Math.atan2(Math.sin(slopeRad), sign * Math.cos(slopeRad));
            const dUnitY = Math.sin(slopeRad), dUnitZ = sign * Math.cos(slopeRad);
            const hUnitY = Math.cos(slopeRad), hUnitZ = -sign * Math.sin(slopeRad);
            const Zin = centerZ + sign * postWidth / 2;
            const Yin = centerY - beamHeight / 2;
            const toWorld = (h, d) => ({ y: Yin + d * dUnitY + h * hUnitY, z: Zin + d * dUnitZ + h * hUnitZ });

            postPositions.forEach((x, i) => {
                const worldX = x - facadeLength / 2;
                const c = toWorld(-beamHeight / 2, traverseLen / 2);
                const traverse = BABYLON.MeshBuilder.CreateBox(`traverseDY_${u}_${sign}_${i}`, {
                    width: beamWidth, height: beamHeight, depth: traverseLen
                }, scene);
                traverse.rotation.x = armRotX;
                traverse.position.set(worldX, c.y, c.z);
                traverse.material = steelMat;
                traverse.parent = root;
            });

            // Bracon : identique à model_y_shape.js, attaché à braceFixPercentage % de LA
            // longueur réelle du bras (donc du bras de jonction étiré, s'il y a lieu).
            const effectiveHeightUnderBrace = Math.min(heightUnderBrace, postHeight * 0.9);
            if (effectiveHeightUnderBrace > 0.05) {
                const attachD = traverseLen * (braceFixPercentage / 100);
                const end = toWorld(-beamHeight, attachD);
                if (reinforcementType === 'jarrets') {
                    // Jarret : équerre triangulaire pleine à l'angle poteau/traverse (cf.
                    // commentaire détaillé dans model_single_post.js / model_y_shape.js).
                    const jarretHeight = 0.35;
                    const junction = toWorld(-beamHeight, 0);
                    postPositions.forEach((x, i) => {
                        const worldX = x - facadeLength / 2;
                        const p1 = { y: junction.y - jarretHeight, z: junction.z };
                        const p2 = { y: end.y, z: end.z };
                        const p3 = { y: junction.y, z: junction.z };
                        const gusset = buildJarretGusset(scene, `jarretDY_${u}_${sign}_${i}`, p1, p2, p3, worldX, braceWidth, steelMat);
                        gusset.parent = root;
                    });
                } else {
                    // Rallonge le point d'ancrage (end) pour une intersection pleine — pente
                    // EFFECTIVE de ce bras (cf. model_y_shape.js), pas "slopeRad" brut.
                    const armEffectiveSlope = -armRotX;
                    const ext = extendBraceToTraverse(effectiveHeightUnderBrace, Zin, end.y, end.z, braceWidth, armEffectiveSlope);
                    postPositions.forEach((x, i) => {
                        const worldX = x - facadeLength / 2;
                        const dz = ext.z - Zin, dy = ext.y - effectiveHeightUnderBrace;
                        const length = Math.sqrt(dz * dz + dy * dy);
                        if (length < 1e-6) return;
                        const brace = BABYLON.MeshBuilder.CreateBox(`braceDY_${u}_${sign}_${i}`, {
                            width: braceWidth, height: braceWidth, depth: length
                        }, scene);
                        brace.rotation.x = -Math.atan2(dy, dz);
                        brace.position.set(worldX, (effectiveHeightUnderBrace + ext.y) / 2, (Zin + ext.z) / 2);
                        brace.material = steelMat;
                        brace.parent = root;
                    });
                }
            }

            // Pannes : petites boîtes non inclinées individuellement, comme model_y_shape.js.
            const purlinCountArm = Math.max(2, Math.ceil(purlinCount / 2));
            for (let i = 0; i < purlinCountArm; i++) {
                const t = purlinCountArm === 1 ? 0.5 : i / (purlinCountArm - 1);
                let d = t * traverseLen;
                if (i === 0) d = beamWidth / 2;
                if (i === purlinCountArm - 1) d = traverseLen - beamWidth / 2;
                const p = toWorld(purlinHeight / 2, d);
                const purlin = BABYLON.MeshBuilder.CreateBox(`purlinDY_${u}_${sign}_${i}`, {
                    width: facadeLength, height: purlinHeight, depth: beamWidth
                }, scene);
                purlin.position.set(0, p.y, p.z);
                purlin.material = steelMat;
                purlin.parent = root;
            }

            if (!hideRails) {
                const railCenter = toWorld(purlinHeight + integrationSystemHeight / 2, panelLen / 2);
                for (let c = 0; c <= pvCols; c++) {
                    const railX = c * (cellWidth + cellGap) + cellGap / 2 - facadeLength / 2;
                    const rail = BABYLON.MeshBuilder.CreateBox(`integrationRailDY_${u}_${sign}_${c}`, {
                        width: integrationSystemWidth, height: integrationSystemHeight, depth: panelLen
                    }, scene);
                    rail.rotation.x = armRotX;
                    rail.position.set(railX, railCenter.y, railCenter.z);
                    rail.material = integrationMat;
                    rail.parent = root;
                }
            }

            // Panneaux : chaque cellule est inclinée (rotation.x = armRotX) pour suivre la pente de
            // la toiture, tout en restant positionnée via toWorld() (jamais de groupe-parent
            // incliné avec enfants à décalage local — cf. model_y_shape.js).
            if (!hidePanels) {
                const cellDepth = Math.max(0.01, (panelLen - cellGap * (pvRows + 1)) / pvRows);
                const panelH = purlinHeight + integrationSystemHeight + panelThickness / 2;
                for (let r = 0; r < pvRows; r++) {
                    const d = cellGap + cellDepth / 2 + r * (cellDepth + cellGap);
                    const p = toWorld(panelH, d);
                    for (let c = 0; c < pvCols; c++) {
                        const lx = -facadeLength / 2 + cellGap + cellWidth / 2 + c * (cellWidth + cellGap);
                        const cell = BABYLON.MeshBuilder.CreateBox(`pvCellDY_${u}_${sign}_${r}_${c}`, {
                            width: cellWidth, height: panelThickness, depth: cellDepth
                        }, scene);
                        cell.rotation.x = armRotX;
                        cell.position.set(lx, p.y, p.z);
                        cell.material = panelMat;
                        cell.parent = root;
                    }
                }
            }
        });
    }

    root.shedStats = {
        postPositions: postPositions.map(x => x - facadeLength / 2),
        beamTopY: centerY, postHeight, facadeLength, slopeLength: armSlopeLengthStandard * 2,
        doubleYShapePanelsCount: panelCount, postSpacing: safePostSpacing
    };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildDoubleYShapeShed = buildDoubleYShapeShed;
}
