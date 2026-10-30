// Générateur paramétrique Babylon.js — modèle "Toiture Y" (un seul poteau central, toiture en
// V vu en coupe : les deux pans montent depuis le poteau vers l'extérieur — l'ensemble
// poteau + toiture + panneaux dessine ainsi un Y).
//
// Port 3D de la logique "isYShapeArm" de drawRoofStructure/drawThePosts/drawReinforcement dans
// ombriere_v2.js : le poteau est UNIQUE et centré (Z=0) ; "panelWidth" représente ici la largeur
// TOTALE couverte par les deux bras réunis (chaque bras couvre panelWidth/2, comme
// "effectiveWidthForHeight = panelWidth/2" côté 2D) ; le porte-à-faux est toujours symétrique
// pour ce modèle (comme "overhangH = overhangL = overhangSymValue" pour postModel==="y_shape").
//
// Convention géométrique (dérivée, pas recopiée du 2D qui utilise une variable "passageHeight"
// absente de cette page de test simplifiée) : la ligne de référence (dessus de traverse) part du
// point bas commun aux deux bras, au sommet du poteau (Z = ±postWidth/2, Y = centerY -
// beamHeight/2), et MONTE vers l'extérieur en suivant la pente (toiture en V, pas en toit à deux
// pans classique) — même relation lowPointHeight -> hauteur que model_single_post.js (inversée),
// appliquée à la longueur pente d'un bras complet (armSlopeLength = post -> bord de toiture
// extérieur, qui est ici le point le PLUS HAUT du bras).
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildYShapeShed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances,
        postWidth, lowPointHeight, panelWidth, roofSlope,
        beamHeight, beamWidth, purlinHeight, purlinCount,
        panelThickness, integrationSystemHeight, integrationSystemWidth = 0.06, invertSlope = false,
        heightUnderBrace = 2.80, braceWidth = 0.10, braceFixPercentage = 70,
        pvLayout = '7LX40C', structureColor = '#8c929a', panelColor = '#1e293b', hideRails = false,
        hidePanels = false, overhangSym = 0.5, reinforcementType = 'bracons', showAnchors = false
    } = params;

    const root = new BABYLON.TransformNode('shedRoot', scene);
    const slopeRad = ((roofSlope * Math.PI) / 180) * (invertSlope ? -1 : 1);

    const armSlopeLength = Math.max(0.2, (panelWidth / 2) / Math.cos(slopeRad));
    const traverseLengthArm = Math.max(0.2, armSlopeLength - overhangSym);
    // centerY est le point BAS commun aux deux bras (au sommet du poteau) : la toiture "en V" monte
    // vers l'extérieur, contrairement à un toit à deux pans classique (d'où le signe "-" ci-dessous,
    // inversé par rapport à un calcul de type "ridge" qui serait le point le plus haut).
    const centerY = lowPointHeight - armSlopeLength * Math.sin(slopeRad);
    const postHeight = Math.max(0.1, centerY - beamHeight);

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
        const { height: h, baseY } = applyGroundAnchorVertical(scene, root, `anchor_${i}`, x, 0, postHeight, showAnchors, anchorMat);
        const post = BABYLON.MeshBuilder.CreateBox(`post_${i}`, {
            width: postWidth, depth: postWidth, height: h
        }, scene);
        post.position.set(x, baseY + h / 2, 0);
        post.material = steelMat;
        post.parent = root;
    });

    const { rows: pvRows, cols: pvCols } = parsePvLayoutSimple(pvLayout, 1, 1);
    const cellGap = 0.02;
    const cellWidth = Math.max(0.01, (facadeLength - cellGap * (pvCols + 1)) / pvCols);

    [-1, 1].forEach(sign => {
        // Repère local du bras : origine au sommet du poteau (Zin, Yin). "d" (le long du bras,
        // vers l'extérieur) et "h" (perpendiculaire au bras, vers le dessus de la toiture) sont
        // combinés via deux vecteurs unitaires calculés directement (PAS via cos/sin d'un angle de
        // rotation.x unique) : pour le bras sign=-1, l'angle qui alignerait une box tournée sur la
        // direction "vers l'extérieur" est proche de 180° (il faut à la fois pointer vers -Z et
        // monter en Y) — cos(angle proche de 180°) ≈ -1, donc réutiliser ce cos/sin pour calculer
        // "h" (la direction perpendiculaire, censée toujours pointer vers le HAUT) inversait le
        // sens de "h" pour ce bras, plaçant pannes/rails/panneaux sous la structure au lieu du
        // dessus. armRotX (ci-dessous) reste correct pour incliner une simple box symétrique
        // (traverse, rail) autour de son propre axe, mais ne doit plus servir au calcul de position.
        const armRotX = -Math.atan2(Math.sin(slopeRad), sign * Math.cos(slopeRad));
        const dUnitY = Math.sin(slopeRad);              // le long du bras : monte vers l'extérieur (toiture en V)
        const dUnitZ = sign * Math.cos(slopeRad);        // le long du bras : s'écarte du poteau
        const hUnitY = Math.cos(slopeRad);               // perpendiculaire au bras : TOUJOURS vers le haut
        const hUnitZ = -sign * Math.sin(slopeRad);       // perpendiculaire au bras : dérive latérale
        const Zin = sign * postWidth / 2;
        const Yin = centerY - beamHeight / 2;
        const toWorld = (h, d) => ({ y: Yin + d * dUnitY + h * hUnitY, z: Zin + d * dUnitZ + h * hUnitZ });

        // Traverse (une par poteau).
        postPositions.forEach((x, i) => {
            const c = toWorld(-beamHeight / 2, traverseLengthArm / 2);
            const traverse = BABYLON.MeshBuilder.CreateBox(`traverseY_${sign}_${i}`, {
                width: beamWidth, height: beamHeight, depth: traverseLengthArm
            }, scene);
            traverse.rotation.x = armRotX;
            traverse.position.set(x, c.y, c.z);
            traverse.material = steelMat;
            traverse.parent = root;
        });

        // Bracon : du poteau (hauteur heightUnderBrace) au dessous de la traverse, à
        // braceFixPercentage % de la longueur du bras depuis le poteau (toujours dessiné pour ce
        // modèle, cf. "appState.postModel === 'y_shape'" forçant l'affichage des 2 côtés en 2D).
        const effectiveHeightUnderBrace = Math.min(heightUnderBrace, postHeight * 0.9);
        if (effectiveHeightUnderBrace > 0.05) {
            const attachLz = traverseLengthArm * (braceFixPercentage / 100);
            const end = toWorld(-beamHeight, attachLz);
            if (reinforcementType === 'jarrets') {
                // Jarret : équerre triangulaire pleine à l'angle poteau/traverse (cf. commentaire
                // détaillé dans model_single_post.js). Le point de jonction poteau/traverse est
                // toWorld(-beamHeight, 0) (dessous de la traverse, à l'aplomb du poteau) ; le jarret
                // part d'un point 0.35m plus bas VERTICALEMENT (pas perpendiculairement au bras,
                // comme jarretAttachY dans ombriere_v2.js qui est un simple décalage canvas-Y).
                const jarretHeight = 0.35;
                const junction = toWorld(-beamHeight, 0);
                postPositions.forEach((x, i) => {
                    const p1 = { y: junction.y - jarretHeight, z: junction.z };
                    const p2 = { y: end.y, z: end.z };
                    const p3 = { y: junction.y, z: junction.z };
                    const gusset = buildJarretGusset(scene, `jarretY_${sign}_${i}`, p1, p2, p3, x, braceWidth, steelMat);
                    gusset.parent = root;
                });
            } else {
                // Rallonge le point d'ancrage (end) pour une intersection pleine avec le dessous de
                // la traverse — pente EFFECTIVE de ce bras (pas "slopeRad" brut, qui ne vaut que pour
                // le bras sign=+1) : la tangente du bras est (dUnitZ,dUnitY) = (cos,sin)(-armRotX).
                const armEffectiveSlope = -armRotX;
                const ext = extendBraceToTraverse(effectiveHeightUnderBrace, Zin, end.y, end.z, braceWidth, armEffectiveSlope);
                postPositions.forEach((x, i) => {
                    const dz = ext.z - Zin, dy = ext.y - effectiveHeightUnderBrace;
                    const length = Math.sqrt(dz * dz + dy * dy);
                    if (length < 1e-6) return;
                    const brace = BABYLON.MeshBuilder.CreateBox(`braceY_${sign}_${i}`, {
                        width: braceWidth, height: braceWidth, depth: length
                    }, scene);
                    brace.rotation.x = -Math.atan2(dy, dz);
                    brace.position.set(x, (effectiveHeightUnderBrace + ext.y) / 2, (Zin + ext.z) / 2);
                    brace.material = steelMat;
                    brace.parent = root;
                });
            }
        }

        // Pannes (une fois pour toute la façade, comme model_single_post.js) : petites boîtes non
        // inclinées individuellement (approximation acceptable vu leur épaisseur "beamWidth").
        const purlinCountArm = Math.max(2, Math.ceil(purlinCount / 2));
        for (let i = 0; i < purlinCountArm; i++) {
            const t = purlinCountArm === 1 ? 0.5 : i / (purlinCountArm - 1);
            let lz = t * traverseLengthArm;
            if (i === 0) lz = beamWidth / 2;
            if (i === purlinCountArm - 1) lz = traverseLengthArm - beamWidth / 2;
            const p = toWorld(purlinHeight / 2, lz);
            const purlin = BABYLON.MeshBuilder.CreateBox(`purlinY_${sign}_${i}`, {
                width: facadeLength, height: purlinHeight, depth: beamWidth
            }, scene);
            purlin.position.set(facadeLength / 2, p.y, p.z);
            purlin.material = steelMat;
            purlin.parent = root;
        }

        // Rails du système d'intégration : longues bandes inclinées le long de la pente, une par
        // limite de colonne de panneaux (comme model_single_post.js).
        if (!hideRails) {
            const railCenter = toWorld(purlinHeight + integrationSystemHeight / 2, armSlopeLength / 2);
            for (let c = 0; c <= pvCols; c++) {
                const railX = c * (cellWidth + cellGap) + cellGap / 2;
                const rail = BABYLON.MeshBuilder.CreateBox(`integrationRailY_${sign}_${c}`, {
                    width: integrationSystemWidth, height: integrationSystemHeight, depth: armSlopeLength
                }, scene);
                rail.rotation.x = armRotX;
                rail.position.set(railX, railCenter.y, railCenter.z);
                rail.material = integrationMat;
                rail.parent = root;
            }
        }

        // Panneaux : chaque cellule est inclinée (rotation.x = armRotX) pour suivre la pente de la
        // toiture ("Pente toiture (°)"), mais reste positionnée directement via toWorld() plutôt
        // que via un groupe-parent incliné avec enfants à décalage local — cf. commentaire détaillé
        // plus haut sur pourquoi armRotX ne doit servir qu'à l'orientation d'une boîte terminale
        // (sans enfants), jamais au calcul de la position elle-même.
        if (!hidePanels) {
            const cellDepth = Math.max(0.01, (armSlopeLength - cellGap * (pvRows + 1)) / pvRows);
            const panelH = purlinHeight + integrationSystemHeight + panelThickness / 2;
            for (let r = 0; r < pvRows; r++) {
                const lz = cellGap + cellDepth / 2 + r * (cellDepth + cellGap);
                const p = toWorld(panelH, lz);
                for (let c = 0; c < pvCols; c++) {
                    const lx = -facadeLength / 2 + cellGap + cellWidth / 2 + c * (cellWidth + cellGap);
                    const cell = BABYLON.MeshBuilder.CreateBox(`pvCellY_${sign}_${r}_${c}`, {
                        width: cellWidth, height: panelThickness, depth: cellDepth
                    }, scene);
                    cell.rotation.x = armRotX;
                    cell.position.set(facadeLength / 2 + lx, p.y, p.z);
                    cell.material = panelMat;
                    cell.parent = root;
                }
            }
        }
    });

    root.position.x -= facadeLength / 2;
    root.shedStats = { postPositions, beamTopY: centerY, postHeight, facadeLength, slopeLength: armSlopeLength * 2 };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildYShapeShed = buildYShapeShed;
}
