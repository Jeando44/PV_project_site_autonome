// Générateur paramétrique Babylon.js — modèle "Double poteaux" (monopente).
// Reprend la toiture (traverse, pannes, rails, panneaux) du modèle "poteaux centrés"
// (model_single_post.js) ; seuls poteaux et contreventement changent : à chaque entraxe, DEUX
// poteaux verticaux distants de "postSpacing" mètres (#postSpacing "Entraxe (m)" dans
// ombriere.html, ici le long de l'axe Z / pente — même axe que postCenterX dans drawThePosts
// côté 2D), chacun monté jusqu'au dessous de la traverse à sa propre position Z (sauf V6, cf.
// ci-dessous).
//
// Port des 6 variantes de contreventement de drawDoublePostReinforcementSet (ombriere_v2.js) :
// - Barre horizontale de liaison (bord intérieur des poteaux) : V1, V2, V5, V6.
// - Bracons diagonaux extérieurs (poteau -> dessous de traverse) : TOUTES les variantes.
// - Bracon diagonal intérieur asymétrique (coin de la barre -> jonction poteau haut/traverse) : V2 seul.
// - Bracons diagonaux intérieurs (poteau -> centre de la traverse, un de chaque côté) : V4, V5.
// - V6 : les poteaux s'arrêtent à "heightUnderBrace" (pas de jonction avec la traverse) ; la barre
//   et les bracons extérieurs partent de l'axe du poteau (pas de son bord) à cette hauteur.
// "showDoubleBracing" (#showDoubleBracing dans ombriere.html) masque tout le contreventement.
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildDoublePostShed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances,
        postWidth, lowPointHeight, panelWidth, roofSlope,
        beamHeight, beamWidth, purlinHeight, purlinCount,
        panelThickness, integrationSystemHeight, integrationSystemWidth = 0.06, invertSlope = false,
        heightUnderBrace = 2.80, braceWidth = 0.10, braceFixPercentage = 70,
        pvLayout = '7LX40C', structureColor = '#8c929a', panelColor = '#1e293b', hideRails = false,
        hidePanels = false, overhangType = 'sym', overhangSym = 0.5, overhangF = 0.2, overhangG = 0.6,
        postSpacing = 15.0, doublePostBracing = 'v1', showDoubleBracing = true,
        reinforcementType = 'bracons', showAnchors = false
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

    // Distance entre les deux poteaux plafonnée à la portée de la traverse pour qu'ils restent
    // sous celle-ci (même esprit que le plafonnement de postSpacing dans calculateOmbriereMetalLocal
    // côté 2D, simplifié ici sans le message d'erreur dédié).
    const maxSpacing = Math.max(0.2, traverseLength - postWidth);
    const halfSpacingZ = Math.min(postSpacing, maxSpacing) / 2;
    const postZLow = traverseEccentricityZ - halfSpacingZ;
    const postZHigh = traverseEccentricityZ + halfSpacingZ;

    // V6 : les poteaux ne montent pas jusqu'à la traverse, ils s'arrêtent à "heightUnderBrace"
    // (cf. "V6: Les deux poteaux sont limités à l'intersection avec le bracon" en 2D). Rallongés
    // (metalOverlapAllowance) pour une intersection pleine avec le dessous de la traverse dans les
    // autres variantes — correctif ciblé (sans effet si le plafond V6 s'applique ensuite).
    let postHeightLow = beamBottomAt(postZLow) + metalOverlapAllowance(postWidth, 0, 1, slopeRad);
    let postHeightHigh = beamBottomAt(postZHigh) + metalOverlapAllowance(postWidth, 0, 1, slopeRad);
    if (doublePostBracing === 'v6') {
        postHeightLow = Math.min(postHeightLow, heightUnderBrace);
        postHeightHigh = Math.min(postHeightHigh, heightUnderBrace);
    }
    postHeightLow = Math.max(0.1, postHeightLow);
    postHeightHigh = Math.max(0.1, postHeightHigh);

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
    // Ancrage sol : désactivé en V6 (les poteaux s'arrêtent déjà en l'air à heightUnderBrace, sans
    // toucher le sol de façon structurelle qui justifierait un plot) — actif pour les autres variantes.
    const anchorsActiveDouble = showAnchors && doublePostBracing !== 'v6';

    postPositions.forEach((x, i) => {
        const low = applyGroundAnchorVertical(scene, root, `anchorLow_${i}`, x, postZLow, postHeightLow, anchorsActiveDouble, anchorMat);
        const postLow = BABYLON.MeshBuilder.CreateBox(`postLow_${i}`, {
            width: postWidth, depth: postWidth, height: low.height
        }, scene);
        postLow.position.set(x, low.baseY + low.height / 2, postZLow);
        postLow.material = steelMat;
        postLow.parent = root;

        const high = applyGroundAnchorVertical(scene, root, `anchorHigh_${i}`, x, postZHigh, postHeightHigh, anchorsActiveDouble, anchorMat);
        const postHigh = BABYLON.MeshBuilder.CreateBox(`postHigh_${i}`, {
            width: postWidth, depth: postWidth, height: high.height
        }, scene);
        postHigh.position.set(x, high.baseY + high.height / 2, postZHigh);
        postHigh.material = steelMat;
        postHigh.parent = root;
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

    if (showDoubleBracing) {
        const hasTieBar = ['v1', 'v2', 'v5', 'v6'].includes(doublePostBracing);
        const hasInnerToCenter = doublePostBracing === 'v4' || doublePostBracing === 'v5';
        const isV2 = doublePostBracing === 'v2';
        const isV6 = doublePostBracing === 'v6';

        // Hauteur d'attache : pour V6, exactement heightUnderBrace (posts déjà clampés à cette
        // hauteur) ; pour les autres, une petite marge de sécurité sous le sommet du poteau.
        const attachY = isV6 ? heightUnderBrace : Math.min(heightUnderBrace, Math.min(postHeightLow, postHeightHigh) * 0.9);

        if (attachY > 0.05) {
            // Jarret (double poteaux) : dans ombriere_v2.js, "jarrets" pour ce modèle ne dessine
            // pas d'équerre triangulaire (contrairement aux autres modèles) mais un simple TRAIT
            // fin (ctx.stroke(), pas de rectangle rempli) — cf. drawDoublePostBracingBar /
            // drawDoublePostReinforcement, branche "if (appState.reinforcementType === 'jarrets')".
            // Port ici en une tige fine (section réduite) plutôt que la section pleine "braceWidth".
            const crossSection = reinforcementType === 'jarrets' ? 0.03 : braceWidth;
            // Barre de liaison (horizontale, entre les 2 poteaux) : PAS d'extension traverse, elle
            // ne touche jamais la traverse — seule sa propre longueur poteau-à-poteau compte.
            const addBraceYZ = (x, y1, z1, y2, z2, name) => {
                const dz = z2 - z1, dy = y2 - y1;
                const length = Math.sqrt(dz * dz + dy * dy);
                if (length < 1e-6) return;
                const brace = BABYLON.MeshBuilder.CreateBox(name, {
                    width: crossSection, height: crossSection, depth: length
                }, scene);
                brace.rotation.x = -Math.atan2(dy, dz);
                brace.position.set(x, (y1 + y2) / 2, (z1 + z2) / 2);
                brace.material = steelMat;
                brace.parent = root;
            };
            // Bracons qui rejoignent la traverse (extérieurs, V2 intérieur, V4/V5 vers le centre) :
            // le point (y2,z2) est rallongé pour une intersection pleine — correctif ciblé.
            const addBraceToTraverseYZ = (x, y1, z1, y2, z2, name) => {
                const ext = extendBraceToTraverse(y1, z1, y2, z2, crossSection, slopeRad);
                const dz = ext.z - z1, dy = ext.y - y1;
                const length = Math.sqrt(dz * dz + dy * dy);
                if (length < 1e-6) return;
                const brace = BABYLON.MeshBuilder.CreateBox(name, {
                    width: crossSection, height: crossSection, depth: length
                }, scene);
                brace.rotation.x = -Math.atan2(dy, dz);
                brace.position.set(x, (y1 + ext.y) / 2, (z1 + ext.z) / 2);
                brace.material = steelMat;
                brace.parent = root;
            };
            const reachZ = (traverseLength / 2) * (braceFixPercentage / 100) * Math.cos(slopeRad);

            // V6 : les points d'attache (barre + bracons extérieurs) sont sur l'AXE du poteau,
            // pas sur son bord (les poteaux, plus courts, n'ont plus de jonction à dégager).
            const innerLowX = isV6 ? postZLow : postZLow + postWidth / 2;
            const innerHighX = isV6 ? postZHigh : postZHigh - postWidth / 2;
            const outerLowX = isV6 ? postZLow : postZLow - postWidth / 2;
            const outerHighX = isV6 ? postZHigh : postZHigh + postWidth / 2;

            postPositions.forEach((x, i) => {
                if (hasTieBar) {
                    addBraceYZ(x, attachY, innerLowX, attachY, innerHighX, `tie_${i}`);
                }

                // Bracons diagonaux extérieurs : présents dans toutes les variantes.
                addBraceToTraverseYZ(x, attachY, outerLowX, beamBottomAt(traverseEccentricityZ - reachZ), traverseEccentricityZ - reachZ, `braceOuterLow_${i}`);
                addBraceToTraverseYZ(x, attachY, outerHighX, beamBottomAt(traverseEccentricityZ + reachZ), traverseEccentricityZ + reachZ, `braceOuterHigh_${i}`);

                if (isV2) {
                    // Bracon diagonal intérieur asymétrique : du coin de la barre horizontale
                    // (côté bas) jusqu'à la jonction du poteau haut avec la traverse.
                    addBraceToTraverseYZ(x, attachY, innerLowX, beamBottomAt(postZHigh), postZHigh, `braceInnerV2_${i}`);
                }

                if (hasInnerToCenter) {
                    // Bracons diagonaux intérieurs (V4/V5) : de chaque poteau vers le centre de la traverse.
                    addBraceToTraverseYZ(x, attachY, innerLowX, beamBottomAt(traverseEccentricityZ), traverseEccentricityZ, `braceInnerLow_${i}`);
                    addBraceToTraverseYZ(x, attachY, innerHighX, beamBottomAt(traverseEccentricityZ), traverseEccentricityZ, `braceInnerHigh_${i}`);
                }
            });
        }
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
    root.shedStats = { postPositions, beamTopY, postHeight: Math.max(postHeightLow, postHeightHigh), facadeLength, slopeLength };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildDoublePostShed = buildDoublePostShed;
}
