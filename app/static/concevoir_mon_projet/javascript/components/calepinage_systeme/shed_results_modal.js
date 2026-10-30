/**
 * Modal "Résultats" du calepinage shed (#shedResultsModal, cf.
 * app/templates/concevoir_mon_projet/pages/calepinage.html).
 *
 * Contenu déplacé tel quel depuis l'ancien panneau inline #shedResultsPanel (mêmes champs, mêmes
 * ids, remplis par calepinage_correction_controller.js::updateShedFormFields) pour mieux le mettre
 * en évidence — ouvert automatiquement après un clic sur "Calculer", et réouvrable manuellement via
 * le bouton "Voir les résultats" resté dans le formulaire.
 *
 * Pattern d'ouverture/déplacement identique à bd_panneaux_pv.js::openFavoritesModal (modal cloné
 * par système PV via le <template id="calepinageTemplate"> de index.html, retrouvé/renommé par
 * suffixe -${pvId} au premier accès).
 */

window.openShedResultsModal = function (btnOrPvId) {
  let suffix = '';
  let container = document.body;

  if (typeof btnOrPvId === 'string') {
    // Appel direct avec un pvId (cf. calepinage_correction_controller.js après un calcul réussi).
    suffix = '-' + btnOrPvId;
  } else if (btnOrPvId && btnOrPvId.nodeType) {
    container = btnOrPvId.closest('.tab-content, .tab-pane, form, .form-container') || document.body;
    const ref = container.querySelector('[id^="nombreSheds"]');
    if (ref && ref.id.includes('-')) {
      suffix = ref.id.substring(ref.id.indexOf('-'));
    }
  }

  // 1. Chercher par ID exact (fonctionne même si déjà déplacée dans le body)
  let modal = document.getElementById('shedResultsModal' + suffix);

  // 2. Chercher dans le conteneur d'origine (1ère ouverture manuelle)
  if (!modal) {
    modal = container.querySelector('[id^="shedResultsModal"]');
    if (modal && suffix && !modal.id.endsWith(suffix)) {
      modal.id = 'shedResultsModal' + suffix;
    }
  }

  // 3. Cas de secours global
  if (!modal) {
    const allModals = document.querySelectorAll('[id^="shedResultsModal"]');
    modal = Array.from(allModals).find(m => m.id.endsWith(suffix)) || allModals[0];
  }

  if (!modal) {
    console.error("La modale shedResultsModal est introuvable.");
    return;
  }

  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  // Rendre le modal déplaçable (identique à bd_panneaux_pv.js::openFavoritesModal)
  const modalContent = modal.querySelector('.modal-content');
  const modalHeader = modal.querySelector('.modal-header');

  if (modalContent) {
    // Centrer à chaque ouverture pour une harmonisation correcte
    modalContent.style.transform = 'translate(0px, 0px)';
    modalContent.dataset.currentX = 0;
    modalContent.dataset.currentY = 0;
  }

  if (modalContent && modalHeader && !modalContent.dataset.draggableInit) {
    modalContent.dataset.draggableInit = 'true';

    let isDragging = false;
    let initialX;
    let initialY;

    modalHeader.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      isDragging = true;
      let currentX = parseFloat(modalContent.dataset.currentX || 0);
      let currentY = parseFloat(modalContent.dataset.currentY || 0);
      initialX = e.clientX - currentX;
      initialY = e.clientY - currentY;
      modalHeader.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      let currentX = e.clientX - initialX;
      let currentY = e.clientY - initialY;
      modalContent.dataset.currentX = currentX;
      modalContent.dataset.currentY = currentY;
      modalContent.style.transform = `translate(${currentX}px, ${currentY}px)`;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        modalHeader.style.cursor = 'move';
      }
    });
  }

  // Miroir en lecture seule de "Pente des panneaux en shed" (#pente_panneaux_shed) et "Azimut"
  // (#azimuth) — champs déjà existants ailleurs dans le formulaire, simplement recopiés ici pour
  // apparaître dans le tableau de résultats à chaque ouverture (valeurs toujours à jour).
  const penteSourceEl = document.querySelector(`#pente_panneaux_shed${suffix}`) || document.getElementById('pente_panneaux_shed');
  const penteTargetEl = document.querySelector(`#shedResultPente${suffix}`) || modal.querySelector('#shedResultPente' + suffix) || modal.querySelector('[id^="shedResultPente"]');
  if (penteTargetEl) penteTargetEl.value = penteSourceEl ? penteSourceEl.value : '';

  const azimutSourceEl = document.querySelector(`#azimuth${suffix}`) || document.getElementById('azimuth');
  const azimutTargetEl = document.querySelector(`#shedResultAzimut${suffix}`) || modal.querySelector('#shedResultAzimut' + suffix) || modal.querySelector('[id^="shedResultAzimut"]');
  if (azimutTargetEl) azimutTargetEl.value = azimutSourceEl ? azimutSourceEl.value : '';

  // NOUVEAU (demande explicite) : même principe de miroir pour "Nb. PV en largeur" (#shedsCols) et
  // "Esp. entre sheds" (#shedsColSpacing).
  const nbPvLargeurSourceEl = document.querySelector(`#shedsCols${suffix}`) || document.getElementById('shedsCols');
  const nbPvLargeurTargetEl = document.querySelector(`#shedResultNbPvLargeur${suffix}`) || modal.querySelector('#shedResultNbPvLargeur' + suffix) || modal.querySelector('[id^="shedResultNbPvLargeur"]');
  if (nbPvLargeurTargetEl) nbPvLargeurTargetEl.value = nbPvLargeurSourceEl ? nbPvLargeurSourceEl.value : '';

  const espEntreShedsSourceEl = document.querySelector(`#shedsColSpacing${suffix}`) || document.getElementById('shedsColSpacing');
  const espEntreShedsTargetEl = document.querySelector(`#shedResultEspEntreSheds${suffix}`) || modal.querySelector('#shedResultEspEntreSheds' + suffix) || modal.querySelector('[id^="shedResultEspEntreSheds"]');
  if (espEntreShedsTargetEl) espEntreShedsTargetEl.value = espEntreShedsSourceEl ? espEntreShedsSourceEl.value : '';

  // NOUVEAU (demande explicite) : miroirs des dimensions (#longueurPanneau/#largeurPanneau, mm) et
  // de la puissance (#puissancePanneau, Wc) du panneau sélectionné.
  const longueurPanneauSourceEl = document.querySelector(`#longueurPanneau${suffix}`) || document.getElementById('longueurPanneau');
  const largeurPanneauSourceEl = document.querySelector(`#largeurPanneau${suffix}`) || document.getElementById('largeurPanneau');
  const dimensionsTargetEl = document.querySelector(`#shedResultPanneauDimensions${suffix}`) || modal.querySelector('#shedResultPanneauDimensions' + suffix) || modal.querySelector('[id^="shedResultPanneauDimensions"]');
  if (dimensionsTargetEl) {
    const longueur = longueurPanneauSourceEl ? longueurPanneauSourceEl.value : '';
    const largeur = largeurPanneauSourceEl ? largeurPanneauSourceEl.value : '';
    dimensionsTargetEl.value = (longueur && largeur) ? `${longueur}mm X ${largeur}mm` : '';
  }

  const puissancePanneauSourceEl = document.querySelector(`#puissancePanneau${suffix}`) || document.getElementById('puissancePanneau');
  const puissancePanneauTargetEl = document.querySelector(`#shedResultPanneauPuissance${suffix}`) || modal.querySelector('#shedResultPanneauPuissance' + suffix) || modal.querySelector('[id^="shedResultPanneauPuissance"]');
  if (puissancePanneauTargetEl) puissancePanneauTargetEl.value = puissancePanneauSourceEl ? puissancePanneauSourceEl.value : '';

  modal.style.setProperty('display', 'flex', 'important');
  modal.style.setProperty('z-index', '999999', 'important');
};

window.closeShedResultsModal = function (arg) {
  if (arg && arg.nodeType) {
    const modal = arg.closest('[id^="shedResultsModal"]');
    if (modal) modal.style.setProperty('display', 'none', 'important');
  }
};
