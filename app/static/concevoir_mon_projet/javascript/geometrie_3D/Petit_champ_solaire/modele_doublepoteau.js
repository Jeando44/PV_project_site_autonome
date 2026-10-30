// "Petit champ solaire" — modèle "Double Poteaux" (2 poteaux à ±postSpacing/2), variantes de
// contreventement V1/V2/V3. Port direct de drawDoublePostReinforcementSet/drawDoublePostReinforcement
// (petit_champ_solaire.js, correctif "bracing V1/V2/V3") :
//   V1 : barre de liaison horizontale entre les 2 poteaux + UN seul bracon, sur le poteau le plus
//        haut, réorienté vers le milieu de la traverse (Z=0).
//   V2 : aucun contreventement.
//   V3 : aucune barre de liaison ; un seul bracon, du PIED (sol) du poteau le plus haut au milieu
//        de la traverse.
//   V4 : contreventement en W — 2 bracons intérieurs (pied de chaque poteau -> milieu de la
//        traverse) + 2 bracons extérieurs (pied -> extrémité de la traverse de son côté).
// La traverse/les pannes/panneaux sont identiques aux modèles Centrés/Excentrés (toujours centrés
// sur Z=0, indépendamment de la position des poteaux — même formule beamLength/panelWidth qu'en 2D).

function buildPetitChampDoublePoteau(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances, postWidth = 0.10,
        beamHeight = 0.10, beamWidth = 0.15, purlinWidth = 0.02, purlinHeight = 0.10,
        panelThickness = 0.03, heightUnderBrace = 0.4, braceWidth = 0.05,
        structureColor = '#8c929a', panelColor = '#1e293b', showAnchors = false,
        pvCols = 6, hidePanels = false, postSpacingPetit: postSpacing = 3.0, doublePostBracingVariant = 'v1'
    } = params;

    const root = new BABYLON.TransformNode('petitDoubleRoot', scene);
    const geo = computePetitChampCommon(params);
    const beamLength = Math.max(0.2, geo.panelWidth - 2 * geo.overhangM);
    const postHeight = computePetitChampStraightPostHeight(geo, beamLength, beamHeight);
    const getTopY = (z) => postHeight + z * Math.tan(geo.roofSlopeRad);
    const getMidY = (z) => getTopY(z) - beamHeight / 2;

    // 2 matériaux partagés par tout le champ (petit_champ_solaire_shared.js) : les plots de
    // fondation posés au sol prennent la couleur de la structure.
    const { structureMat, panelMat } = petitChampMaterials(scene, structureColor, panelColor);
    const anchorMat = structureMat;

    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);
    const spacing = Math.min(postSpacing / 2, beamLength / 2 - postWidth);
    // Poteau le plus haut : celui dont le dessus de traverse (à sa position Z) est le plus élevé —
    // déterminé par comparaison réelle (comme en 2D), pas par une hypothèse fixe sur le signe de pente.
    const tallSign = getTopY(spacing) >= getTopY(-spacing) ? 1 : -1;

    // Poteaux : 2 par entraxe, à Z=±spacing.
    postPositions.forEach((x, i) => {
        [-1, 1].forEach(sign => {
            const z = sign * spacing;
            const boxHeight = Math.max(0.1, getTopY(z) - beamHeight + metalOverlapAllowance(postWidth, 0, 1, geo.roofSlopeRad));
            const { height: h, baseY } = applyGroundAnchorVertical(scene, root, `petitDoubleAnchor_${i}_${sign}`, x, z, boxHeight, showAnchors, anchorMat);
            const post = BABYLON.MeshBuilder.CreateBox(`petitDoublePost_${i}_${sign}`, { width: postWidth, depth: postWidth, height: h }, scene);
            post.position.set(x, baseY + h / 2, z);
            post.material = structureMat;
            post.parent = root;
        });
    });

    buildPetitChampStraightRoof(scene, root, {
        xPositions: postPositions, postHeight, beamLength, roofSlopeRad: geo.roofSlopeRad,
        beamHeight, beamWidth, geo, purlinWidth, purlinHeight, panelThickness,
        facadeStart: 0, facadeLength, cols: pvCols, structureMat, panelMat, hidePanels
    });

    // Contreventement V1/V2/V3 — cf. en-tête de fichier pour le détail de chaque variante.
    const variant = String(doublePostBracingVariant || 'v1').toLowerCase();
    if (variant !== 'v2') {
        postPositions.forEach((x, i) => {
            if (variant === 'v1') {
                // Barre de liaison horizontale entre bords intérieurs des 2 poteaux, à hauteur
                // heightUnderBrace.
                const innerHalfSpan = spacing - postWidth / 2;
                const tie = BABYLON.MeshBuilder.CreateBox(`petitDoubleTie_${i}`, {
                    width: braceWidth, height: braceWidth, depth: innerHalfSpan * 2
                }, scene);
                tie.position.set(x, heightUnderBrace, 0);
                tie.material = structureMat;
                tie.parent = root;

                // Un seul bracon, sur le poteau le plus haut, réorienté vers le milieu de la
                // traverse (Z=0) — le bracon du petit poteau est supprimé.
                const p1 = { y: heightUnderBrace, z: tallSign * (spacing + postWidth / 2) };
                const p2 = { y: getMidY(0), z: 0 };
                buildPetitChampBrace(scene, root, `petitDoubleBraceV1_${i}`, x, p1, p2, braceWidth, braceWidth, structureMat);
            } else if (variant === 'v4') {
                // V4 : contreventement en W — pour chaque poteau, un bracon intérieur (pied -> milieu
                // de la traverse) et un bracon extérieur (pied -> extrémité de la traverse de son côté).
                const zEnd = (beamLength / 2) * Math.cos(geo.roofSlopeRad) * 0.95;
                [-1, 1].forEach(sign => {
                    const pInner = { y: 0, z: sign * (spacing - postWidth / 2) };
                    buildPetitChampBrace(scene, root, `petitDoubleBraceV4in_${i}_${sign}`, x, pInner, { y: getMidY(0), z: 0 }, braceWidth, braceWidth, structureMat);
                    const pOuter = { y: 0, z: sign * (spacing + postWidth / 2) };
                    buildPetitChampBrace(scene, root, `petitDoubleBraceV4out_${i}_${sign}`, x, pOuter, { y: getMidY(sign * zEnd), z: sign * zEnd }, braceWidth, braceWidth, structureMat);
                });
            } else { // v3
                const p1 = { y: 0, z: tallSign * (spacing + postWidth / 2) };
                const p2 = { y: getMidY(0), z: 0 };
                buildPetitChampBrace(scene, root, `petitDoubleBraceV3_${i}`, x, p1, p2, braceWidth, braceWidth, structureMat);
            }
        });
    }

    root.position.x -= facadeLength / 2;
    root.shedStats = { postPositions, postHeight, beamLength, spacing, tallSign, variant, panelWidth: geo.panelWidth, facadeLength, beamTopY: postHeight, slopeLength: geo.panelWidth };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildPetitChampDoublePoteau = buildPetitChampDoublePoteau;
}
