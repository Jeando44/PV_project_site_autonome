/**
 * Vue PRO / Grand projet du modal Études Économiques.
 *
 * Actif quand le projet ne suit PAS le parcours résidentiel (window.isResidentialPath()) — le
 * parcours résidentiel a sa propre vue (residentiel/ResidentielEtudeEcoView.js).
 *
 * - Affichage vertical : les 3 onglets (Production, Chiffrage & Financement, Résultats) sont
 *   empilés dans #etudes-eco-standard-view (classe .eco-vertical, cf. etudes_economique_content.html),
 *   sans barre d'onglets ni boutons Suivant / Précédent. Ordre, champs et moteur inchangés.
 * - CAPEX : le tableau « Chiffrage CAPEX (Devis) » du résidentiel (ResidentielCapexTable.js, profil
 *   'pro') remplace l'ancien CAPEX simple / détaillé (#capex_legacy_section, masqué mais conservé
 *   dans le DOM : le moteur et l'export PDF relisent encore #total_capex_display). L'OPEX PRO reste
 *   celui du formulaire standard.
 * - Devis PDF détaillé / synthétique et Favoris chiffrage (grille 100/250/500 kWc) : mêmes
 *   composants que le résidentiel.
 */
(function () {
    'use strict';

    let initDone = false;

    function init() {
        if (initDone) return;
        if (typeof window.isResidentialPath === 'function' && window.isResidentialPath()) return;

        const RC = window.ResidentielChiffrage || {};
        const standardView = document.getElementById('etudes-eco-standard-view');
        const container = document.getElementById('pro-capex-container');
        if (!standardView || !container || !RC.Capex) return;
        initDone = true;

        // Avant Capex.init() : fixe les bornes, les cartes et la TVA par défaut (Rules.getProfil()).
        RC.profil = 'pro';
        standardView.classList.add('eco-vertical');

        const legacy = document.getElementById('capex_legacy_section');
        if (legacy) legacy.style.display = 'none';

        RC.Capex.init(container);
        if (window.ResidentielEtudeEcoView && typeof window.ResidentielEtudeEcoView.mountDevisControls === 'function') {
            window.ResidentielEtudeEcoView.mountDevisControls();
        }

        if (RC.DB) {
            RC.DB.loadAndApply().finally(() => RC.DB.setupAutosave());
        }

        // Le calepinage (type de structure par champ PV) peut être chargé ou modifié après
        // l'initialisation : relu à chaque ouverture du modal.
        const modal = document.getElementById('etudes-economique-modal');
        if (modal) {
            new MutationObserver(() => {
                if (modal.style.display !== 'none') RC.Capex.refreshTypesStructure();
            }).observe(modal, { attributes: true, attributeFilter: ['style'] });
        }
    }

    window.addEventListener('load', () => {
        // Même délai que la vue résidentielle : EtudesEconomiqueLogic.js (window.onload) d'abord.
        setTimeout(init, 650);
    });

    window.ProEtudeEcoView = { ensureInit: init };
})();
