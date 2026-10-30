// Générateur Babylon.js — bâtiment métal "Monopente" (toiture 1 seul pan, bas d'un côté, faîtage
// de l'autre — invertSlope inverse le côté). Fine enveloppe autour de buildBatimentMetal3DCommon
// (batiment_metal_shared.js) qui porte toute la géométrie commune.

function buildMonopenteMetalShed(scene, params) {
    return buildBatimentMetal3DCommon(scene, Object.assign({}, params, { postModel: 'monopente' }));
}

if (typeof window !== 'undefined') {
    window.buildMonopenteMetalShed = buildMonopenteMetalShed;
}
