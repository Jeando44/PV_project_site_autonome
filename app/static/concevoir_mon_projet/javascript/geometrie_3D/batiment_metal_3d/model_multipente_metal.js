// Générateur Babylon.js — bâtiment métal "Multipente" (toiture en sheds répétés, postCount poteaux
// également répartis, un mini-faîtage entre chaque paire de poteaux adjacents). Fine enveloppe
// autour de buildBatimentMetal3DCommon (batiment_metal_shared.js) qui porte toute la géométrie
// commune.

function buildMultipenteMetalShed(scene, params) {
    return buildBatimentMetal3DCommon(scene, Object.assign({}, params, { postModel: 'multipente' }));
}

if (typeof window !== 'undefined') {
    window.buildMultipenteMetalShed = buildMultipenteMetalShed;
}
