// Générateur paramétrique Babylon.js — modèle bois "Modèle Est-Ouest" (id HTML modelYShape).
// Poteaux positionnés comme model_inclined_post_bois.js ("Gd. Monopan") : W-truss à 2 poteaux
// inclinés penchant vers l'EXTÉRIEUR (outward=true), espacés de "postSpacingInclined" (défaut
// 2.54m, éditable pour ce modèle contrairement à "Gd. Monopan"). La toiture, elle, est en V
// (comme la "Toiture Y" de l'ombrière MÉTAL, cf. model_y_shape.js) : le point bas commun aux 2
// bras est au sommet du couple de poteaux (Z=0), chaque bras MONTE vers l'extérieur jusqu'à
// l'égout — panneaux inclinés (rotation.x = armRotX) suivant la pente, pas posés à plat.
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildYShapeBoisShed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances, postWidth, roofSlope, invertSlope = false,
        beamHeight, purlinHeight, purlinWidth = 0.10, purlinCount, panelThickness,
        integrationSystemHeight, integrationSystemWidth = 0.06, panelWidth,
        overhangSym = 0.5, passageHeight = 2.60, pvLayout = '7LX40C', hideRails = false, hidePanels = false,
        postSpacingInclined = 2.54, postInclination = 65,
        braceThickness = 25, contreventementF1 = true, contreventementF2 = true, showAnchors = false
    } = params;

    const root = new BABYLON.TransformNode('shedRootBoisY', scene);
    const materials = makeWoodMaterials(scene, params);
    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);
    const footThickness = braceThickness / 100;

    const slopeRad = ((roofSlope * Math.PI) / 180) * (invertSlope ? -1 : 1);
    const armSlopeLength = Math.max(0.2, panelWidth / 2);
    const traverseLengthArm = Math.max(0.2, armSlopeLength - overhangSym);
    // Point bas commun aux 2 bras (au sommet du couple de poteaux, Z=0) : contrairement au
    // modèle monopente (computeWoodMonopenteGeometry), pas de terme de "remontée" à ajouter
    // puisque Z=0 EST le point le plus bas de la toiture (les 2 bras montent depuis là) — cf.
    // tête de fichier.
    const apexY = passageHeight + (beamHeight / 2) * Math.cos(slopeRad);
    const halfEntraxe = postSpacingInclined / 2;

    const { rows: pvRows, cols: pvCols } = parsePvLayoutSimple(pvLayout, 1, 1);
    const cellGap = 0.02;
    const cellWidth = Math.max(0.01, (facadeLength - cellGap * (pvCols + 1)) / pvCols);

    let heightF1 = 0.1, heightF2 = 0.1;

    [-1, 1].forEach(sign => {
        // Géométrie de CE bras (toiture en V, cf. model_y_shape.js métal) : dUnitY/dUnitZ =
        // direction "le long du bras, vers l'extérieur-et-vers-le-haut" ; hUnitY/hUnitZ =
        // perpendiculaire, toujours vers le dessus de la toiture.
        const armRotX = -Math.atan2(Math.sin(slopeRad), sign * Math.cos(slopeRad));
        const dUnitY = Math.sin(slopeRad), dUnitZ = sign * Math.cos(slopeRad);
        const hUnitY = Math.cos(slopeRad), hUnitZ = -sign * Math.sin(slopeRad);
        const Yin = apexY - beamHeight / 2;
        const toWorld = (h, d) => ({ y: Yin + d * dUnitY + h * hUnitY, z: d * dUnitZ + h * hUnitZ });

        // Poteau incliné de ce bras : base à ±halfEntraxe, penchant vers l'EXTÉRIEUR (outward),
        // rejoint le dessous de CE bras (pente signée sign*slopeRad, ligne passant par l'apex).
        const baseZ = sign * halfEntraxe;
        const armGeo = {
            slopeRad: sign * slopeRad,
            beamBottomAt: (z) => Yin + z * Math.tan(sign * slopeRad)
        };
        postPositions.forEach((x, i) => {
            const { topY } = buildInclinedWoodPost(scene, root, `pole_${sign}_${i}`, x, baseZ, 0, armGeo, postWidth, materials.steelMat, postInclination, true, showAnchors, materials.anchorMat);
            // Jonction nette (verticalWoodPostHeight, cf. ombriere_bois_shared.js) : le montant ne
            // dépasse jamais le dessous de CE bras.
            buildObliqueWoodBrace(scene, root, `foot_${sign}_${i}`, x, 0, baseZ, verticalWoodPostHeight(armGeo, baseZ, footThickness), baseZ, footThickness, materials.steelMat);
            if (sign < 0) heightF1 = topY; else heightF2 = topY;
        });

        // Traverse (une par poteau de façade) : largeur alignée sur la panne (cf. buildWoodRoof).
        postPositions.forEach((x, i) => {
            const c = toWorld(-beamHeight / 2, traverseLengthArm / 2);
            const traverse = BABYLON.MeshBuilder.CreateBox(`traverseBoisY_${sign}_${i}`, {
                width: purlinHeight, height: beamHeight, depth: traverseLengthArm
            }, scene);
            traverse.rotation.x = armRotX;
            traverse.position.set(x, c.y, c.z);
            traverse.material = materials.steelMat;
            traverse.parent = root;
        });

        // Pannes (une fois pour toute la façade, petites boîtes non inclinées individuellement).
        const purlinCountArm = Math.max(2, Math.ceil(purlinCount / 2));
        for (let i = 0; i < purlinCountArm; i++) {
            const t = purlinCountArm === 1 ? 0.5 : i / (purlinCountArm - 1);
            let d = t * traverseLengthArm;
            if (i === 0) d = purlinWidth / 2;
            if (i === purlinCountArm - 1) d = traverseLengthArm - purlinWidth / 2;
            const p = toWorld(purlinHeight / 2, d);
            const purlin = BABYLON.MeshBuilder.CreateBox(`purlinBoisY_${sign}_${i}`, {
                width: facadeLength, height: purlinHeight, depth: purlinWidth
            }, scene);
            purlin.position.set(facadeLength / 2, p.y, p.z);
            purlin.material = materials.steelMat;
            purlin.parent = root;
        }

        if (!hideRails) {
            const railCenter = toWorld(purlinHeight + integrationSystemHeight / 2, armSlopeLength / 2);
            for (let c = 0; c <= pvCols; c++) {
                const railX = c * (cellWidth + cellGap) + cellGap / 2;
                const rail = BABYLON.MeshBuilder.CreateBox(`integrationRailBoisY_${sign}_${c}`, {
                    width: integrationSystemWidth, height: integrationSystemHeight, depth: armSlopeLength
                }, scene);
                rail.rotation.x = armRotX;
                rail.position.set(railX, railCenter.y, railCenter.z);
                rail.material = materials.integrationMat;
                rail.parent = root;
            }
        }

        // Panneaux : inclinés (rotation.x = armRotX) pour suivre la pente — demande explicite
        // "les panneaux doivent être posés comme la toiture Y de l'ombrière métal" (cf.
        // model_y_shape.js, section "Panneaux").
        if (!hidePanels) {
            const cellDepth = Math.max(0.01, (armSlopeLength - cellGap * (pvRows + 1)) / pvRows);
            const panelH = purlinHeight + integrationSystemHeight + panelThickness / 2;
            for (let r = 0; r < pvRows; r++) {
                const lz = cellGap + cellDepth / 2 + r * (cellDepth + cellGap);
                const p = toWorld(panelH, lz);
                for (let c = 0; c < pvCols; c++) {
                    const lx = -facadeLength / 2 + cellGap + cellWidth / 2 + c * (cellWidth + cellGap);
                    const cell = BABYLON.MeshBuilder.CreateBox(`pvCellBoisY_${sign}_${r}_${c}`, {
                        width: cellWidth, height: panelThickness, depth: cellDepth
                    }, scene);
                    cell.rotation.x = armRotX;
                    cell.position.set(facadeLength / 2 + lx, p.y, p.z);
                    cell.material = materials.panelMat;
                    cell.parent = root;
                }
            }
        }
    });

    // beamBottomAt ici doit suivre la toiture en V (monte avec |z|, cf. armGeo plus haut), pas
    // rester plate à hauteur d'apex, sans quoi le contreventement F1/F2 (à z=±halfEntraxe, PAS à
    // l'apex) viserait un point de toiture trop bas.
    const flatGeo = { traverseCenterZ: 0, beamBottomAt: (z) => (apexY - beamHeight / 2) + Math.abs(z) * Math.abs(Math.tan(slopeRad)) };
    if (contreventementF1) buildLongitudinalFacadeBracing(scene, root, params, flatGeo, postPositions, heightF1, materials, -halfEntraxe);
    if (contreventementF2) buildLongitudinalFacadeBracing(scene, root, params, flatGeo, postPositions, heightF2, materials, halfEntraxe);

    root.position.x -= facadeLength / 2;
    root.shedStats = { postPositions, beamTopY: apexY, postHeight: Math.max(heightF1, heightF2), facadeLength, slopeLength: armSlopeLength * 2 };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildYShapeBoisShed = buildYShapeBoisShed;
}
