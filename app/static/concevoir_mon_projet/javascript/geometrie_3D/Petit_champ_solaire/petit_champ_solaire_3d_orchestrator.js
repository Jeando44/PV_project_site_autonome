// "Petit champ solaire" — point d'entrée commun des 4 modèles, appelé depuis test_3d.html.
// Même patron que ombriere_3d_orchestrator.js / batiment_metal_3d_orchestrator.js.
//
// Répétition des sheds ("Nbre de shed" / "Espacement entre shed") : même principe que le Plan de
// coupe du moteur 2D (shedPitchMeters = largeur du champ PV projetée horizontalement + espacement
// saisi par l'utilisateur), une rangée de shed identique dupliquée le long de Z.

function buildOnePetitChampShed(scene, model, params) {
    switch (model) {
        case 'excentre': return buildPetitChampExcentre(scene, params);
        case 'double': return buildPetitChampDoublePoteau(scene, params);
        case 'bipente': return buildPetitChampBipente(scene, params);
        case 'centre':
        default: return buildPetitChampCentre(scene, params);
    }
}

// Entraxes de poteaux d'une table de longueur `length` : poteaux en retrait des extrémités (porte-à-
// faux de 15 % de la longueur, 0,6 m max), travées d'environ 6 m.
function petitChampPostsForLength(length) {
    const leftOverhang = Math.min(0.6, length * 0.15);
    const span = Math.max(0.1, length - 2 * leftOverhang);
    const bays = Math.max(1, Math.round(span / 6));
    return { leftOverhang, postDistances: bays + '*' + (Math.round((span / bays) * 1000) / 1000) };
}

// Calepinage réel (params.shedLayout, cf. calepinage_maison_3d_objects.js) : une table shed par
// entrée { x, z, rotationY, facadeLength, pvCols }, chacune à sa propre longueur et position,
// orientée selon l'azimut du calepinage 2D — au lieu de N sheds identiques sur la boîte englobante.
function buildPetitChampFromLayout(scene, model, params, layout) {
    const master = new BABYLON.TransformNode('petitChampLayoutRoot', scene);
    let firstStats = null;
    layout.forEach((t, i) => {
        const posts = petitChampPostsForLength(t.facadeLength);
        const shedParams = Object.assign({}, params, posts, {
            facadeLength: t.facadeLength, pvCols: t.pvCols, nbShedPetit: 1
        });
        const pivot = new BABYLON.TransformNode(`petitChampTable_${i}`, scene);
        pivot.position.set(t.x, 0, t.z);
        pivot.rotation.y = t.rotationY || 0;
        pivot.parent = master;
        const shedRoot = buildOnePetitChampShed(scene, model, shedParams);
        shedRoot.parent = pivot;
        if (i === 0) firstStats = shedRoot.shedStats;
    });
    master.shedStats = firstStats;
    return master;
}

function buildPetitChampSolaire3D(scene, params) {
    const model = params.postModelPetit || 'centre';
    if (Array.isArray(params.shedLayout) && params.shedLayout.length) {
        return buildPetitChampFromLayout(scene, model, params, params.shedLayout);
    }
    const nbShed = Math.max(1, Math.round(params.nbShedPetit) || 1);

    // Pas de répétition : largeur du champ PV (projetée horizontalement, comme en 2D) + espacement
    // saisi par l'utilisateur — le champ UI "Espacement entre shed" n'est pas écrasé, seul ce pas
    // de répétition (interne) l'additionne à la largeur projetée.
    const geo = computePetitChampCommon(params);
    const shedPitch = geo.panelWidth * Math.cos(geo.roofSlopeRad) + (params.shedSpacingPetit || 0);

    // Chaque shed sous un pivot `petitChampTable_i` centré sur la table (le générateur recentre déjà
    // son shed en X) : la 3D peut ainsi caler chaque table sur le terrain, comme pour le calepinage
    // réel (calepinage_maison_3d_terrain.js::poserTablesPetitChamp).
    const master = new BABYLON.TransformNode('petitChampShedsRoot', scene);
    let firstStats = null;
    for (let i = 0; i < nbShed; i++) {
        const pivot = new BABYLON.TransformNode(`petitChampTable_${i}`, scene);
        pivot.position.set(0, 0, i * shedPitch);
        pivot.parent = master;
        const shedRoot = buildOnePetitChampShed(scene, model, params);
        shedRoot.parent = pivot;
        if (i === 0) firstStats = shedRoot.shedStats;
    }
    master.shedStats = firstStats;
    return master;
}

if (typeof window !== 'undefined') {
    window.buildPetitChampSolaire3D = buildPetitChampSolaire3D;
}
