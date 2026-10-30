// Générateur paramétrique Babylon.js — modèle bois "Simple Azélan" (id HTML modelSimpleAzelan).
// Port de la branche "postModel === 'simple_azelan'" de drawCoupe : une traverse monopente pleine
// largeur portée par un poteau "couplé" (un poteau vertical ET un poteau incliné superposés à la
// même position, penchant vers le second poteau — port fidèle de "drawInclinedPoleExact(coupledX,
// ...) puis drawPostRect(coupledX)" dans le 2D d'origine, qui dessine les deux formes à la même
// position) et un second poteau "autonome" (vertical seul), espacés de "postSpacingAzelan" (défaut
// 1.92m), le poteau autonome étant toujours orienté vers le centre de la traverse. Position
// (#offset-position-group Bas/Haut) fixée sur "Bas" par défaut pour ce modèle. PAS de barre
// horizontale entre les 2 poteaux (correctif ciblé : supprimée) ; jonctions poteau/traverse
// pleines (verticalWoodPostHeight / miterOverlapAllowance dans buildInclinedWoodPost), les
// poteaux intersectent toujours la traverse par-dessous. F1 = poteau couplé, F2 = poteau autonome.
//
// Repère Babylon (Y-up, comme glTF) : X = le long de la façade, Y = hauteur, Z = profondeur (pente).

function buildSimpleAzelanShed(scene, params) {
    const {
        facadeLength, leftOverhang, postDistances, postWidth, invertSlope = false,
        postSpacingAzelan = 1.92, offsetPostSide = 'low', postInclination = 65,
        contreventementF1 = true, contreventementF2 = true, showAnchors = false
    } = params;

    const root = new BABYLON.TransformNode('shedRootBoisAzelan', scene);
    const geo = computeWoodMonopenteGeometry(params);
    const materials = makeWoodMaterials(scene, params);
    const postPositions = parsePostDistancesSimple(postDistances, leftOverhang);

    const offsetVal = postWidth / 2.0;
    const beamLength = geo.beamLength;
    const isLow = offsetPostSide === 'low';
    const ecc = (invertSlope ? isLow : !isLow) ? -(beamLength / 2) + offsetVal : (beamLength / 2) - offsetVal;
    const coupledZ = geo.traverseCenterZ - ecc;
    const sign = coupledZ < geo.traverseCenterZ ? 1 : -1; // oriente le poteau autonome vers le centre
    const standaloneZ = coupledZ + sign * postSpacingAzelan;
    let heightF1 = 0.1, heightF2 = 0.1;

    postPositions.forEach((x, i) => {
        // Poteau "couplé" : vertical + incliné à la même position (bundle), penchant vers le
        // poteau autonome. Jonctions pleines (verticalWoodPostHeight / miterOverlapAllowance
        // interne à buildInclinedWoodPost) : les deux intersectent bien la traverse par-dessous.
        const fullCoupledHeight = verticalWoodPostHeight(geo, coupledZ, postWidth);
        heightF1 = fullCoupledHeight;
        const { height: coupledHeight, baseY: coupledBaseY } = applyWoodGroundAnchor(scene, root, `anchorCoupled_${i}`, x, coupledZ, fullCoupledHeight, showAnchors, materials.anchorMat);
        const coupledPost = BABYLON.MeshBuilder.CreateBox(`postCoupled_${i}`, {
            width: postWidth, depth: postWidth, height: coupledHeight
        }, scene);
        coupledPost.position.set(x, coupledBaseY + coupledHeight / 2, coupledZ);
        coupledPost.material = materials.steelMat;
        coupledPost.parent = root;
        buildInclinedWoodPost(scene, root, `postCoupledIncl_${i}`, x, coupledZ, standaloneZ, geo, postWidth, materials.steelMat, postInclination, false, showAnchors, materials.anchorMat);

        const fullStandaloneHeight = verticalWoodPostHeight(geo, standaloneZ, postWidth);
        heightF2 = fullStandaloneHeight;
        const { height: standaloneHeight, baseY: standaloneBaseY } = applyWoodGroundAnchor(scene, root, `anchorStandalone_${i}`, x, standaloneZ, fullStandaloneHeight, showAnchors, materials.anchorMat);
        const standalonePost = BABYLON.MeshBuilder.CreateBox(`postStandalone_${i}`, {
            width: postWidth, depth: postWidth, height: standaloneHeight
        }, scene);
        standalonePost.position.set(x, standaloneBaseY + standaloneHeight / 2, standaloneZ);
        standalonePost.material = materials.steelMat;
        standalonePost.parent = root;

        // PAS de barre horizontale entre les 2 poteaux — correctif ciblé demandé explicitement
        // (supprimée par rapport aux versions précédentes de ce fichier).
    });

    if (contreventementF1) buildLongitudinalFacadeBracing(scene, root, params, geo, postPositions, heightF1, materials, coupledZ);
    if (contreventementF2) buildLongitudinalFacadeBracing(scene, root, params, geo, postPositions, heightF2, materials, standaloneZ);
    buildWoodRoof(scene, root, params, geo, postPositions, materials);

    root.position.x -= facadeLength / 2;
    root.shedStats = {
        postPositions, beamTopY: geo.beamTopY, postHeight: geo.beamTopY, facadeLength,
        slopeLength: params.panelWidth / Math.cos(geo.slopeRad)
    };
    return root;
}

if (typeof window !== 'undefined') {
    window.buildSimpleAzelanShed = buildSimpleAzelanShed;
}
