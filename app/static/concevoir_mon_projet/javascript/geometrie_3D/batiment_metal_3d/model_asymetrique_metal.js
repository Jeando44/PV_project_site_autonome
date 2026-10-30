// Générateur Babylon.js — bâtiment métal "Bipente asymétrique" (2 pans d'inclinaisons différentes,
// faîtage décentré selon asymmetryPct). Fine enveloppe autour de buildBatimentMetal3DCommon
// (batiment_metal_shared.js) qui porte toute la géométrie commune.

function buildAsymetriqueMetalShed(scene, params) {
    return buildBatimentMetal3DCommon(scene, Object.assign({}, params, { postModel: 'asymetrique' }));
}

if (typeof window !== 'undefined') {
    window.buildAsymetriqueMetalShed = buildAsymetriqueMetalShed;
}
