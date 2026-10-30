// ============================================================================================
// Modèle de poteaux "Excentrés" — activation du bouton #modelOffsetPost.
// ============================================================================================
// Extrait de petit_champ_solaire.js (ex-forEach partagé avec Centrés/Double Poteaux). S'appuie sur
// window.__petitChampSolaireModelSwitch (helpers partagés exposés par le fichier principal) et sur
// window.appState (déjà exposé globalement). Doit être chargé APRÈS
// petit_champ_solaire_poteau_utilities.js et AVANT petit_champ_solaire.js.

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('modelOffsetPost');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
        const shared = window.__petitChampSolaireModelSwitch;
        // Garde défensive : cf. petit_champ_solaire_poteau_centre.js (même raison).
        if (!shared) return;
        shared.restoreTraversePositionIfNeeded();
        appState.postModel = 'offset';
        appState.offsetPostSide = 'low'; // Force la position sur Bas par défaut
        document.getElementById('offsetPosLow').classList.add('active');
        document.getElementById('offsetPosHigh').classList.remove('active');

        // Hauteur sous renfort par défaut : 0.2m (identique Centrés/Excentrés/Double Poteaux, contre
        // 0.00m pour Bipente).
        shared.heightUnderBraceInput.value = "0.2";
        shared.heightUnderBraceInput.readOnly = false;

        // Espacement entre shed par défaut : 2.50m (identique Centrés/Excentrés/Double Poteaux,
        // contre 0.50m pour Bipente).
        document.getElementById('shedSpacing').value = "2.50";

        document.getElementById('postEccentricity').value = 2.0;
        shared.setupToggleButton(e.currentTarget, shared.allModelButtons, [document.getElementById('offsetPostControls'), document.getElementById('offsetBraceControls')], [document.getElementById('doublePostControls')]);

        shared.setOverhangControlsEnabled(true);
        shared.updateLinkedAndDoubleSharedControls();
        shared.scheduleUpdate().then(shared.adjustCanvasHeights);
    });
});
