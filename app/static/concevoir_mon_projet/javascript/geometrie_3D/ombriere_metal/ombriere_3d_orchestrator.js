// Orchestrateur des modèles d'ombrière 3D — point d'entrée UNIQUE utilisé par test_3d.html.
// Route vers le bon générateur (un fichier par modèle dans ce même dossier) selon
// params.postModel, avec les mêmes valeurs internes que ombriere_v2.js/ombriere.html :
// 'single' | 'offset' | 'double' | 'inclinedPost' | 'linked' | 'y_shape' | 'doubleYShape'.
//
// Chaque modèle "PAS ENCORE IMPLÉMENTÉ" retombe sur buildSinglePostShed en attendant (voir le
// fichier du modèle concerné) : le rendu reste correct (pas de plantage/écran vide), seuls les
// champs spécifiques au modèle (excentrement, entraxe double poteaux, etc.) sont ignorés jusqu'à
// implémentation.

const OMBRIERE_3D_BUILDERS = {
    single: () => buildSinglePostShed,
    offset: () => buildOffsetPostShed,
    double: () => buildDoublePostShed,
    inclinedPost: () => buildInclinedPostShed,
    linked: () => buildLinkedPostShed,
    y_shape: () => buildYShapeShed,
    doubleYShape: () => buildDoubleYShapeShed,
};

/**
 * Construit le mesh 3D d'une ombrière dans la scène Babylon donnée, quel que soit le modèle
 * de poteaux sélectionné (params.postModel). Retourne le TransformNode racine, comme chacun
 * des générateurs par modèle.
 */
function buildOmbriere3D(scene, params) {
    const model = params && params.postModel ? params.postModel : 'single';
    const getBuilder = OMBRIERE_3D_BUILDERS[model];
    if (!getBuilder) {
        console.warn(`[ombriere3D] Modèle de poteaux "${model}" inconnu — utilisation du modèle "poteaux centrés" par défaut.`);
        return buildSinglePostShed(scene, params);
    }
    return getBuilder()(scene, params);
}

if (typeof window !== 'undefined') {
    window.buildOmbriere3D = buildOmbriere3D;
}
