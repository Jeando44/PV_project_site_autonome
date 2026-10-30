// Générateur paramétrique Babylon.js — modèle "Poteaux inclinés" (monopente).
// Reprend la toiture (traverse, pannes, rails, panneaux) du modèle "poteaux centrés"
// (model_single_post.js) ; seuls les poteaux changent : à chaque entraxe, DEUX poteaux
// inclinés (dans le plan Y-Z, perpendiculaire à la façade), distants au sol de
// "postSpacingInclined" mètres (#postSpacingInclined "Entraxe (m)" dans ombriere.html) et
// inclinés de "postInclinationInclined" degrés par rapport à l'horizontale (#postInclinationInclined
// "Inclinaison (°)"), s'écartant du centre en montant, jusqu'à rejoindre le dessous de la traverse
// — port direct de la géométrie par intersection de drawThePosts (case "isInclined") dans
// ombriere_v2.js, adapté en 3D.
//
// Simplification volontaire : pas de renforts (bracons/jarrets) pour ce modèle, comme dans
// ombriere_v2.js ("Pas de renforts dans le modèle actuel pour poteaux inclinés"). Une barre de
// liaison au sol entre les deux poteaux est en revanche toujours dessinée (dans ombriere.html
// elle est optionnelle via une case à cocher non reprise ici, cf. le champ non demandé).
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildInclinedPostShed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances,
        postWidth, lowPointHeight, panelWidth, roofSlope,
        beamHeight, beamWidth, purlinHeight, purlinCount,
        panelThickness, integrationSystemHeight, integrationSystemWidth = 0.06, invertSlope = false,
        pvLayout = '7LX40C', structureColor = '#8c929a', panelColor = '#1e293b', hideRails = false,
        hidePanels = false, overhangType = 'sym', overhangSym = 0.5, overhangF = 0.2, overhangG = 0.6,
        postSpacingInclined = 2.0, postInclinationInclined = 65, showAnchors = false
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
    const beamBottomAt = (z) => (beamTopY - beamHeight) + (z - traverseEccentricityZ) * Math.tan(slopeRad);

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

    // Direction (unitaire) du poteau incliné dans le plan Y-Z, s'écartant du centre en montant —
    // port de "angleFromVertical"/"vx"/"vy" dans drawThePosts (case isInclined). dyDir/dzDir sont
    // déjà en repère "Y monde positif vers le haut" (contrairement au canvas 2D où Y négatif = haut).
    const angleFromVertical = (90 - postInclinationInclined) * Math.PI / 180;
    const dyDir = Math.cos(angleFromVertical);
    const halfSpacing = postSpacingInclined / 2;

    // rotation.x à appliquer à une box (dont l'axe "depth" porte la longueur) pour aligner son axe
    // local Z sur la direction (dzDir, dyDir) — même convention que "traverse.rotation.x = -slopeRad"
    // dans model_single_post.js (vérifiée par la formule des pannes qui en dérive).
    const rotationXFor = (dzDir) => Math.atan2(-dyDir, dzDir);

    postPositions.forEach((x, i) => {
        const baseBySign = {};
        [-1, 1].forEach(sign => {
            const postZ = traverseEccentricityZ + sign * halfSpacing;
            const dzDir = sign * Math.sin(angleFromVertical);
            // Intersection de la droite du poteau (issue du sol) avec le dessous de la traverse
            // (droite sloped en Y-Z) : voir dérivation en tête de fichier / commit history.
            const rhs = (beamTopY - beamHeight) + (postZ - traverseEccentricityZ) * Math.tan(slopeRad);
            const denom = dyDir - dzDir * Math.tan(slopeRad);
            const t = Math.abs(denom) > 1e-6 ? rhs / denom : 0;
            // Rallongé (metalOverlapAllowance) pour une intersection pleine avec le dessous de la
            // traverse — ce modèle n'avait jusqu'ici AUCUN correctif d'about, contrairement aux
            // poteaux verticaux des autres modèles (correctif ciblé).
            const length = Math.max(0.1, t + metalOverlapAllowance(postWidth, dzDir, dyDir, slopeRad));

            const topY = length * dyDir;
            const topZ = postZ + length * dzDir;

            // Ancrage sol optionnel (#showAnchors) : raccourcit le poteau incliné pour que son pied
            // remonte à METAL_ANCHOR_HEIGHT (le sommet, à la traverse, ne bouge pas), plot posé à
            // l'aplomb du nouveau pied. baseBySign retient le nouveau pied pour la barre de liaison
            // au sol ci-dessous (qui doit suivre le même décalage, pas rester plaquée à Y=0/postZ).
            const adj = applyGroundAnchorInclined(scene, root, `anchorInclined_${i}_${sign}`, x, topY, topZ, dzDir, dyDir, length, showAnchors, anchorMat);
            baseBySign[sign] = { y: adj.baseY, z: adj.baseZ };
            const midY = (adj.baseY + topY) / 2;
            const midZ = (adj.baseZ + topZ) / 2;

            const post = BABYLON.MeshBuilder.CreateBox(`postInclined_${i}_${sign}`, {
                width: postWidth, height: postWidth, depth: adj.length
            }, scene);
            post.rotation.x = rotationXFor(dzDir);
            post.position.set(x, midY, midZ);
            post.material = steelMat;
            post.parent = root;
        });

        // Barre de liaison au sol entre les bords intérieurs des deux poteaux (toujours affichée ici,
        // cf. commentaire d'en-tête — pas de case à cocher dans cette page de test). Suit le pied
        // réel des poteaux (baseBySign), qui remonte de METAL_ANCHOR_HEIGHT si l'ancrage est actif.
        const innerLow = baseBySign[-1].z + postWidth / 2;
        const innerHigh = baseBySign[1].z - postWidth / 2;
        const innerSpan = innerHigh - innerLow;
        const groundBarY = Math.max(baseBySign[-1].y, baseBySign[1].y);
        if (innerSpan > 0.01) {
            const groundBar = BABYLON.MeshBuilder.CreateBox(`inclinedGroundBar_${i}`, {
                width: postWidth, height: postWidth, depth: innerSpan
            }, scene);
            groundBar.position.set(x, groundBarY, (innerLow + innerHigh) / 2);
            groundBar.material = steelMat;
            groundBar.parent = root;
        }
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
    root.shedStats = { postPositions, beamTopY, postHeight: beamTopY, facadeLength, slopeLength };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildInclinedPostShed = buildInclinedPostShed;
}
