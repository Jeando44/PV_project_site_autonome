// ============================================================================================
// Modèle de poteaux "Bipente" (y_shape) — activation du bouton #modelYShape.
// ============================================================================================
// Extrait de petit_champ_solaire.js. S'appuie sur window.__petitChampSolaireModelSwitch (helpers
// partagés exposés par le fichier principal, dont rememberTraverseBeforeYShape qui mémorise la
// position de traverse/l'inversion de pente avant d'entrer en Bipente, pour les restaurer en
// ressortant vers un autre modèle) et sur window.appState (déjà exposé globalement). Doit être
// chargé APRÈS petit_champ_solaire_poteau_utilities.js et AVANT petit_champ_solaire.js.

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('modelYShape');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
        const shared = window.__petitChampSolaireModelSwitch;
        // Garde défensive : cf. petit_champ_solaire_poteau_centre.js (même raison).
        if (!shared) return;
        shared.rememberTraverseBeforeYShape();

        appState.postModel = 'y_shape';
        document.getElementById('postEccentricity').value = 0;

        // Petit champ solaire : la toiture Y est inversée par rapport à l'ombrière standard.
        appState.invertSlope = true;
        document.getElementById('toolInvertSlope').classList.add('active');

        appState.traversePosition = 'side';
        document.getElementById('toolPosTraverseSide').classList.add('active');
        document.getElementById('toolPosTraverseTop').classList.remove('active');

        appState.reinforcementType = 'bracons';
        shared.heightUnderBraceInput.value = "0.0";
        shared.heightUnderBraceInput.readOnly = false;

        // Espacement entre shed par défaut : 0.50m pour Bipente (contre 2.50m pour Centrés/Excentrés/
        // Double Poteaux).
        document.getElementById('shedSpacing').value = "0.50";

        appState.overhangType = 'sym';
        shared.setupToggleButton(document.getElementById('overhangSym'), document.querySelectorAll('.controls-container .toggle-btn-group button[id^="overhang"]'), document.getElementById('overhangSymContainer'), document.getElementById('overhangAsymContainer'));
        shared.setOverhangControlsEnabled(false);

        // Masquer le bouton de porte-à-faux asymétrique
        if (shared.overhangAsymBtn) shared.overhangAsymBtn.style.display = 'none';

        shared.setupToggleButton(e.currentTarget, shared.allModelButtons, document.getElementById('offsetBraceControls'), [document.getElementById('doublePostControls'), document.getElementById('offsetPostControls')]);
        shared.updateLinkedAndDoubleSharedControls();
        shared.scheduleUpdate().then(shared.adjustCanvasHeights);
    });
});
