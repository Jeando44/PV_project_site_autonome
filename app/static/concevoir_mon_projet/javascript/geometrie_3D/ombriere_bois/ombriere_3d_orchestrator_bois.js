// Orchestrateur des modèles d'ombrière BOIS — point d'entrée unique côté "Ombrière bois" du
// sélecteur "Type de structure" dans test_3d.html, symétrique de
// ombriere_metal/ombriere_3d_orchestrator.js. Route vers le bon générateur selon
// params.postModel, avec les mêmes valeurs internes que appState.postModel dans model_simple.js
// (ombriere_bois.html) : 'inclinedPost' | 'y_shape' | 'double' | 'offset' | 'simple_azelan' |
// 'simple_travolta' | 'simple_travolta_2'.

const OMBRIERE_3D_BOIS_BUILDERS = {
    inclinedPost: () => buildInclinedPostBoisShed,
    y_shape: () => buildYShapeBoisShed,
    double: () => buildDoublePostBoisShed,
    offset: () => buildOffsetPostBoisShed,
    simple_azelan: () => buildSimpleAzelanShed,
    simple_travolta: () => buildSimpleTravoltaShed,
    simple_travolta_2: () => buildSimpleTravolta2Shed,
};

/**
 * Construit le mesh 3D d'une ombrière bois dans la scène Babylon donnée, quel que soit le modèle
 * de poteaux sélectionné (params.postModel). Retourne le TransformNode racine, comme chacun des
 * générateurs par modèle.
 */
function buildOmbriereBois3D(scene, params) {
    const model = params && params.postModel ? params.postModel : 'inclinedPost';
    const getBuilder = OMBRIERE_3D_BOIS_BUILDERS[model];
    if (!getBuilder) {
        console.warn(`[ombriereBois3D] Modèle de poteaux "${model}" inconnu — utilisation du modèle "Gd. Monopan" par défaut.`);
        return buildInclinedPostBoisShed(scene, params);
    }
    return getBuilder()(scene, params);
}

if (typeof window !== 'undefined') {
    window.buildOmbriereBois3D = buildOmbriereBois3D;
}
