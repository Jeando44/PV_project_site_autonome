// ============================================================================================
// Modèle de poteaux "Centrés" — activation du bouton #modelSinglePost.
// ============================================================================================
// Extrait de petit_champ_solaire.js (ex-forEach partagé avec Excentrés/Double Poteaux). S'appuie
// sur window.__petitChampSolaireModelSwitch (helpers partagés exposés par le fichier principal :
// setupToggleButton, listes de boutons/contrôles, mémoire de position de traverse avant Bipente,
// etc.) et sur window.appState (déjà exposé globalement). Doit être chargé APRÈS
// petit_champ_solaire_poteau_utilities.js et AVANT petit_champ_solaire.js.

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('modelSinglePost');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
        const shared = window.__petitChampSolaireModelSwitch;
        // Garde défensive : selon l'ordre de chargement des scripts, un .click() programmatique très
        // précoce (avant que petit_champ_solaire.js n'ait fini d'exposer ses helpers partagés) doit
        // rester un no-op inoffensif, comme c'était déjà le cas avant cette extraction.
        if (!shared) return;
        shared.restoreTraversePositionIfNeeded();
        appState.postModel = 'single';

        // Hauteur sous renfort par défaut : 0.2m (identique Centrés/Excentrés/Double Poteaux, contre
        // 0.00m pour Bipente).
        shared.heightUnderBraceInput.value = "0.2";
        shared.heightUnderBraceInput.readOnly = false;

        // Espacement entre shed par défaut : 2.50m (identique Centrés/Excentrés/Double Poteaux,
        // contre 0.50m pour Bipente).
        document.getElementById('shedSpacing').value = "2.50";

        document.getElementById('postEccentricity').value = 0;
        shared.setupToggleButton(e.currentTarget, shared.allModelButtons, null, [...shared.allModelControls, document.getElementById('offsetBraceControls')]);

        shared.setOverhangControlsEnabled(true);
        shared.updateLinkedAndDoubleSharedControls();
        shared.scheduleUpdate().then(shared.adjustCanvasHeights);
    });
});
