document.addEventListener("DOMContentLoaded", function () {
  // Éléments du modal
  const modal = document.getElementById("parametres-modal");
  const openModalBtn = document.getElementById("open-modal");
  const closeModalBtn = document.getElementById("close-modal");

  // Variables pour suivre les sélections
  let projetType = null;
  let optionSelected = null;

  // CORRECTIF (bug rapporté : "après création/ouverture d'un projet, en fermant le modal Cons.
  // Énergie on retombe sur le modal Paramètres") : ce bloc ouvrait INCONDITIONNELLEMENT ce modal à
  // CHAQUE chargement de page, sans jamais vérifier si un projet était déjà actif — écrasant ainsi
  // la logique correcte, consciente du projet actif, déjà présente dans
  // parametreProjetMap/initialisationMap.js (ParametreProjetManager.setupModal(), qui n'ouvre ce
  // même modal que si aucun projet n'est sélectionné). Résultat concret : même quand un projet
  // venait d'être créé/ouvert avec succès, ce modal réapparaissait systématiquement à chaque
  // rechargement — resté masqué SOUS le modal "Consommation d'énergie" auto-ouvert par le nouveau
  // workflow, donc invisible jusqu'à la fermeture de ce dernier, où il refaisait surface. Les
  // gestionnaires ouverture/fermeture ci-dessous (déjà dupliqués dans initialisationMap.js) restent
  // en place, seule cette ouverture automatique inconditionnelle est supprimée.

  // Ouvrir le modal
  if (openModalBtn) {
    openModalBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (modal) {
        modal.classList.add("show");
        document.body.style.overflow = "hidden";
      }
    });
  }

  // Fermer le modal
  function closeModal() {
    if (modal) {
      modal.classList.remove("show");
      document.body.style.overflow = "";

      // CORRECTIF (bug rapporté : "on ferme le modal Paramètres, on retombe sur Calepinage mais le
      // menu reste en évidence sur Paramètres") : ce modal a plusieurs mécanismes de fermeture
      // indépendants (cf. initialisationMap.js::closeModal, ParametresProjet.js::closeMainModal) —
      // ajouté ici aussi pour que la mise en évidence du menu horizontal soit correcte quel que soit
      // celui réellement déclenché.
      if (typeof window.restorePreviousMainNavStep === 'function') window.restorePreviousMainNavStep();
      else if (typeof window.setActiveMainNavStep === 'function') window.setActiveMainNavStep('calepinage');
    }
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", closeModal);
  }

  // Fermer en cliquant en dehors du modal
  if (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target === modal) {
        closeModal();
      }
    });
  }

  // Fermer avec la touche Échap
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal && modal.classList.contains("show")) {
      closeModal();
    }
  });
});

// ========== FONCTIONS GLOBALES POUR LES MODALS ==========

/**
 * Ouvre le modal de géométrie
 */
function openModalGeometrie() {
  console.log('🔧 [Menu] Ouverture du modal de géométrie');

  // Vérifier si geometrieModal existe
  if (typeof geometrieModal !== 'undefined' && geometrieModal) {
    // Récupérer le type de structure sélectionné depuis l'onglet actif
    // Les IDs sont dynamiques (type_de_structure-PV1, type_de_structure-PV2, etc.)
    const activeTab = document.querySelector('.tab-content.active');
    let typeStructureSelect = null;

    if (activeTab) {
      typeStructureSelect = activeTab.querySelector('select[id^="type_de_structure"], select[name^="type_de_structure"]');
    }

    // Si aucun onglet actif, chercher le premier select disponible
    if (!typeStructureSelect) {
      typeStructureSelect = document.querySelector('select[id^="type_de_structure"], select[name^="type_de_structure"]');
    }

    // Si toujours pas trouvé, afficher un message
    if (!typeStructureSelect) {
      console.warn('⚠️ [Menu] Aucun select type_de_structure trouvé - Aucune forme dessinée');
      alert('Il faut dessiner une forme sur la carte avant de configurer la géométrie.');
      return;
    }

    const selectedStructure = typeStructureSelect.value || 'Ombrière métal';
    console.log('🔧 [Menu] Type de structure sélectionné:', selectedStructure);

    // Vérifier si STRUCTURE_MODAL_MAPPING existe
    if (typeof STRUCTURE_MODAL_MAPPING !== 'undefined') {
      const modalConfig = STRUCTURE_MODAL_MAPPING[selectedStructure] || STRUCTURE_MODAL_MAPPING['Ombrière métal'];

      // Vérifier si la fonctionnalité est disponible
      if (modalConfig.available === false) {
        console.log('⚠️ [Menu] Fonctionnalité non disponible - affichage du modal d\'information');
        if (typeof initFeatureUnavailableModal === 'function') {
          const unavailableModal = initFeatureUnavailableModal();
          unavailableModal.show(modalConfig.title);
        } else {
          alert('Cette fonctionnalité est en cours de développement.');
        }
        return;
      }

      // Récupérer le pvId depuis l'onglet actif (form-PV1 → PV1)
      const activeTabEl = document.querySelector('.tab-content.active');
      const pvId = activeTabEl?.id?.startsWith('form-') ? activeTabEl.id.replace('form-', '') : null;
      console.log('🔧 [Menu] pvId extrait:', pvId);

      geometrieModal.open(modalConfig.url, modalConfig.title, pvId);
    } else {
      console.error('❌ [Menu] STRUCTURE_MODAL_MAPPING non défini');
      alert('Erreur : Configuration des modals non trouvée');
    }
  } else {
    console.error('❌ [Menu] geometrieModal non défini');
    alert('Erreur : Le gestionnaire de modal de géométrie n\'est pas disponible');
  }
}

/**
 * Ouvre le modal d'autoconsommation
 */
function openModalAutoconso() {
  console.log('🔧 [Menu] Ouverture du modal d\'autoconsommation');
  window.location.href = '/concevoir_mon_projet/autoconsommation';
}

/**
 * Ouvre le modal des études économiques
 */
function openEtudesEconomiqueModal() {
  console.log('🔧 [Menu] Ouverture du modal des études économiques');

  // Obligation de projet actif (cf. app/middleware/auth_middleware.py:active_project_required) :
  // ce modal est un simple toggle CSS côté client (pas de route serveur), donc non couvert par le
  // guard de navigation — on le bloque ici explicitement.
  if (!localStorage.getItem('current_projet_id')) {
    if (typeof window.showActiveProjectRequiredMessage === 'function') {
      window.showActiveProjectRequiredMessage();
    } else {
      alert('Vous devez créer ou sélectionner un projet avant de continuer.');
    }
    return;
  }

  // CORRECTIF (bug rapporté : "bloque la génération du rapport, ne reconnaît pas le calepinage
  // de maison individuelle") : cette condition n'acceptait que le calepinage grands-projets
  // (solarProjectData.shapes) et bloquait donc systématiquement l'accès aux études économiques
  // pour tout projet fait uniquement en calepinage maison résidentiel (stockage totalement
  // distinct, cf. Calepinage_mainson/). Supprimée plutôt qu'étendue : le seul pré-requis réel
  // reste d'avoir un projet actif (déjà vérifié ci-dessus).

  // Utiliser la classe EtudesEconomiqueModal si elle existe
  if (window.etudesEconomiqueModal && typeof window.etudesEconomiqueModal.open === 'function') {
    window.etudesEconomiqueModal.open();
    console.log('✅ [Menu] Modal ouvert via EtudesEconomiqueModal class');
    return;
  }

  // Sinon, ouvrir le modal directement
  const modal = document.getElementById('etudes-economique-modal');
  const backdrop = document.getElementById('etudes-economique-backdrop');

  if (modal && backdrop) {
    modal.style.display = 'flex';
    backdrop.style.display = 'block';
    console.log('✅ [Menu] Modal des études économiques ouvert avec succès');
  } else {
    console.error('❌ [Menu] Modal des études économiques non trouvé');
    alert('Erreur : Le modal des études économiques n\'est pas disponible');
  }
}

/**
 * Ouvre le modal BD Matériels
 */
// function openBDMateriels() {
//   console.log('🔧 [Menu] Ouverture du modal BD Matériels');
//   alert('Le module BD Matériels est en cours de développement');
// }

// /**
//  * Ouvre le modal Prestations
//  */
// function openPrestations() {
//   console.log('🔧 [Menu] Ouverture du modal Prestations');
//   alert('Le module Prestations est en cours de développement');
// }

// /**
//  * Ouvre le modal Pré-études
//  */
// function openPreEtudes() {
//   console.log('🔧 [Menu] Ouverture du modal Pré-études');
//   alert('Le module Pré-études est en cours de développement');
// }

/**
 * Ouvre l'interface d'administration des matériels dans une iframe plein écran, même principe que
 * ButtonControl.openSchemaUnifilaireModal() (Schéma unifilaire) : le contenu (en-tête, styles,
 * positionnement du modal) est entièrement géré par la page chargée dans l'iframe
 * (admin_materiels.html) — le conteneur créé ici n'est qu'un cadre transparent plein écran, sans
 * second arrière-plan ni second en-tête. On reste ainsi sur la page calepinage (aucune navigation),
 * comme les autres modals de l'application. Fermeture pilotée par modal_header_unified.html via
 * postMessage({action:'closeModal'}).
 */
function openAdminMaterielsModal(event) {
  if (event) event.preventDefault();

  let container = document.getElementById('admin-materiels-modal-container');
  if (container) {
    container.style.display = 'flex';
    return;
  }

  container = document.createElement('div');
  container.id = 'admin-materiels-modal-container';
  container.style.cssText = `
    display: flex;
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    z-index: 9999;
  `;

  const iframe = document.createElement('iframe');
  iframe.id = 'admin-materiels-modal-iframe';
  iframe.src = '/concevoir_mon_projet/admin-materiels';
  iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
  container.appendChild(iframe);
  document.body.appendChild(container);

  if (!window._adminMaterielsCloseListenerAttached) {
    window.addEventListener('message', (e) => {
      if (e.data && e.data.action === 'closeModal') {
        const c = document.getElementById('admin-materiels-modal-container');
        if (c) c.style.display = 'none';
      }
    });
    window._adminMaterielsCloseListenerAttached = true;
  }
}

// Rendre les fonctions disponibles globalement
window.openModalGeometrie = openModalGeometrie;
window.openModalAutoconso = openModalAutoconso;
window.openEtudesEconomiqueModal = openEtudesEconomiqueModal;
window.openBDMateriels = openBDMateriels;
window.openAdminMaterielsModal = openAdminMaterielsModal;
window.openPrestations = openPrestations;
window.openPreEtudes = openPreEtudes;
