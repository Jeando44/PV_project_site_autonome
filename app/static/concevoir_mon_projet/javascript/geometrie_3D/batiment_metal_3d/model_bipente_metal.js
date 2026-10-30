// Générateur Babylon.js — bâtiment métal "Bipente" (toiture 2 pans symétriques, faîtage centré).
// Fine enveloppe autour de buildBatimentMetal3DCommon (batiment_metal_shared.js) qui porte toute la
// géométrie commune ; ce fichier ne fait que forcer postModel='bipente'.

function buildBipenteMetalShed(scene, params) {
    return buildBatimentMetal3DCommon(scene, Object.assign({}, params, { postModel: 'bipente' }));
}

if (typeof window !== 'undefined') {
    window.buildBipenteMetalShed = buildBipenteMetalShed;
}
