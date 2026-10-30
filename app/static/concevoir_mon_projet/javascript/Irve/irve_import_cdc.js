// =========================================================================
// SECTION "IMPORT CDC" — courbe de production PV + courbe de consommation (ACI/ACC)
// =========================================================================
// Câble la section "Import CdC" de app_irve_v1.16.html sur les fonctions partagées de
// irve_consumption_import.js (déplacées depuis main_autoconso.js, Phase 4 du refactor "menu
// horizontal + centralisation des imports/Switchgrid"). Le mode individuelle/collective n'est pas
// re-sélectionné ici : il est lu depuis le mode de valorisation déjà choisi pour le projet
// (window.sgGetValorisationMode(), exposé par switchgrid_workflow.js — même règle que la section
// "Enedis", pas de duplication de la lecture localStorage).
//
// Les boutons "Générer une courbe de charge" (PVGIS) et "Optimisation HC/HP - Sans PV" ne sont pas
// affichés ici : ils déclenchent respectivement le modal PVGIS et un calcul direct, tous deux propres
// à main_autoconso.js/index_autoconso.html (absents de cette page).

import { renderPvInput, renderAciConsumerInput, renderAccConsumersInput, restoreAccFilesFromIDB, afficherMessageImport } from './irve_consumption_import.js?v=8';

function renderConsumptionSection(mode) {
    const container = document.getElementById('irve-cons-input-content');
    const note = document.getElementById('irve-cons-mode-note');
    if (!container) return;

    // CORRECTIF (demande explicite : "vous n'avez mis qu'un seul bouton d'import [production] —
    // assurez-vous que les données sont téléchargées depuis des boutons") : cette section masquait
    // entièrement le bouton d'import de consommation dès que le mode de valorisation du projet n'était
    // pas explicitement individuelle/collective (projet non configuré, vente en totalité, etc.), ne
    // laissant alors QUE le bouton de production visible. Le bouton d'import de la courbe de charge
    // doit désormais rester disponible en toutes circonstances : seul un mode explicitement
    // "collective" bascule sur l'UI multi-fichiers (ACC) ; tout le reste (individuelle, non déterminé,
    // vente en totalité...) retombe sur l'import ACI (fichier unique), pour qu'un bouton fonctionnel
    // soit toujours proposé.
    if (mode.includes('collective')) {
        if (note) {
            note.style.display = 'block';
            note.textContent = 'Mode collectif (ACC) : importez un fichier par consommateur.';
        }
        // window.showMessage n'existe pas sur cette page : sans repli, une erreur de lecture d'un
        // fichier consommateur (colonne introuvable, valeur non numérique...) passait sous silence.
        const showMessage = typeof window.showMessage === 'function' ? window.showMessage : afficherMessageImport;
        // #pas_temps (cf. renderAciConsumerInput ci-dessous) : sans lui, calculateAnnualConsumption()
        // (main_acc.js) retombait sur #time-step-select, absent de cette page, et échouait sur
        // CHAQUE fichier importé (Cannot read properties of null). Corrigé aussi côté main_acc.js
        // (le paramètre timeStepSelect n'était pas transmis), mais on le fournit explicitement ici.
        renderAccConsumersInput(container, showMessage, document.getElementById('pas_temps'),
            { masquerParametresEconomiques: true });
        // Restaure les fichiers ACC déjà importés (IndexedDB) pour qu'ils réapparaissent en
        // rouvrant la modale, comme sur la page Autoconsommation (cf. initPersistence()).
        restoreAccFilesFromIDB(showMessage);
    } else {
        if (note) { note.style.display = 'none'; }
        // #pas_temps est le sélecteur de pas de temps propre à cette page (équivalent de
        // #time-step-select sur la page Autoconsommation) : on l'indique explicitement pour que
        // l'alignement automatique sur le pas de la courbe IRVE synchronisée fonctionne ici aussi.
        renderAciConsumerInput(container, { timeStepSelect: document.getElementById('pas_temps') });
    }
}

function initImportCdc() {
    const pvContainer = document.getElementById('irve-pv-input-content');
    if (pvContainer) {
        // Demande explicite : bouton d'import de la courbe de production en jaune doré, pour bien le
        // distinguer du bouton d'import de la/les courbe(s) de charge (consommation) juste en dessous.
        renderPvInput(pvContainer, { showPvgisButton: false, showSansPvButton: false, goldButton: true });
    }

    const mode = typeof window.sgGetValorisationMode === 'function' ? window.sgGetValorisationMode() : '';
    renderConsumptionSection(mode);
}

document.addEventListener('DOMContentLoaded', initImportCdc);
