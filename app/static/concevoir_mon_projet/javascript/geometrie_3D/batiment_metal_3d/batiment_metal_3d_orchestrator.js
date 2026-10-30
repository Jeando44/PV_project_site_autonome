// Orchestrateur des modèles de bâtiment métal 3D — point d'entrée UNIQUE utilisé par test_3d.html.
// Route vers le bon générateur (un fichier par modèle dans ce même dossier) selon params.postModel :
// 'bipente' | 'monopente' | 'asymetrique' | 'multipente'. Même patron exact que
// ombriere_metal/ombriere_3d_orchestrator.js.

const BATIMENT_METAL_3D_BUILDERS = {
    bipente: () => buildBipenteMetalShed,
    monopente: () => buildMonopenteMetalShed,
    asymetrique: () => buildAsymetriqueMetalShed,
    multipente: () => buildMultipenteMetalShed,
};

/**
 * Construit le mesh 3D d'un bâtiment métal dans la scène Babylon donnée, quelle que soit la forme
 * de toiture (params.postModel). Retourne le TransformNode racine, comme chacun des générateurs
 * par modèle.
 */
function buildBatimentMetal3D(scene, params) {
    const model = params && params.postModel ? params.postModel : 'bipente';
    const getBuilder = BATIMENT_METAL_3D_BUILDERS[model];
    if (!getBuilder) {
        console.warn(`[batimentMetal3D] Forme de toiture "${model}" inconnue — utilisation du modèle "bipente" par défaut.`);
        return buildBipenteMetalShed(scene, params);
    }
    return getBuilder()(scene, params);
}

if (typeof window !== 'undefined') {
    window.buildBatimentMetal3D = buildBatimentMetal3D;
}
