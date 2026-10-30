/**
 * Base de données "Favoris Panneaux" du calepinage.
 *
 * Gère la modale #favoritesPanneauxModal (cf. app/templates/concevoir_mon_projet/pages/calepinage.html) :
 * ouverture/déplacement de la modale, chargement/sauvegarde des favoris via localStorage,
 * validation électrique/dimensionnelle et remplissage (+ verrouillage) des champs du formulaire
 * principal de panneau lorsqu'un favori est choisi.
 *
 * Extrait de calepinage.html (qui mélangeait ce code avec d'autres fonctionnalités de la page)
 * pour isoler la logique "panneaux" dans un fichier dédié. Les fonctions restent attachées à
 * `window` (comme avant l'extraction) car elles sont appelées depuis des attributs onclick="..."
 * inline dans le HTML de la modale ; le tableau HTML des favoris (5 lignes, dont 2 pré-remplies :
 * DMEGC DM-470-G12RT et Longi LR7-54HVH) reste inchangé dans calepinage.html.
 */

window.openFavoritesModal = function (btn) {
  let suffix = '';

  // Trouver le conteneur principal du formulaire
  const container = btn && btn.closest('.tab-content, .tab-pane, form, .form-container') || document.body;

  const ref = container.querySelector('[id^="referencePanneau"]');
  if (ref && ref.id.includes('-')) {
    suffix = ref.id.substring(ref.id.indexOf('-'));
  }

  // 1. Chercher par ID exact (fonctionne même si déplacée dans le body)
  let modal = document.getElementById('favoritesPanneauxModal' + suffix);

  // 2. Chercher dans le conteneur d'origine (1ère ouverture)
  if (!modal) {
    modal = container.querySelector('[id^="favoritesPanneauxModal"]');
    // Mettre à jour l'ID pour la retrouver facilement après son déplacement dans le body
    if (modal && suffix && !modal.id.endsWith(suffix)) {
      modal.id = 'favoritesPanneauxModal' + suffix;
    }
  }

  // 3. Cas de secours global
  if (!modal) {
    const allModals = document.querySelectorAll('[id^="favoritesPanneauxModal"]');
    modal = Array.from(allModals).find(m => m.id.endsWith(suffix)) || allModals[0];
  }

  if (modal) {
    // Load saved data if available
    const savedData = localStorage.getItem('favoritePanels_savedData');
    if (savedData) {
      try {
        const panels = JSON.parse(savedData);
        const tbody = modal.querySelector('tbody');
        const rows = tbody.querySelectorAll('tr');
        panels.forEach((p, i) => {
          if (rows[i]) {
            rows[i].cells[1].querySelector('input').value = p.fab || '';
            rows[i].cells[2].querySelector('input').value = p.ref || '';
            rows[i].cells[3].querySelector('input').value = p.power || '';
            rows[i].cells[4].querySelector('input').value = p.dim || '';
            rows[i].cells[5].querySelector('input').value = p.impp || '';
            rows[i].cells[6].querySelector('input').value = p.isc || '';
            rows[i].cells[7].querySelector('input').value = p.vmpp || '';
            rows[i].cells[8].querySelector('input').value = p.voc || '';
            rows[i].cells[9].querySelector('input').value = p.coef_voc ? Math.abs(parseFloat(p.coef_voc)) : '';
            rows[i].cells[10].querySelector('input').value = p.coef_isc || '';
            rows[i].cells[11].querySelector('input').value = p.coef ? Math.abs(parseFloat(p.coef)) : '';
            rows[i].cells[12].querySelector('select').value = p.type || 'Monofacial';
            // NOUVEAU: repli sur des valeurs connues si l'ancienne sauvegarde ne contient pas
            // encore ce champ (fabricants déjà présents par défaut : DMEGC=96, Longi=108).
            const defaultNbCells = p.fab === 'DMEGC' ? 96 : (p.fab === 'Longi' ? 108 : '');
            rows[i].cells[13].querySelector('input').value = p.nbre_cells || defaultNbCells;
          }
        });
      } catch (e) {
        console.error('Erreur lors du chargement des favoris', e);
      }
    }
    // Complète le tableau (5 lignes statiques dans calepinage.html) avec les références déjà
    // présentes en base (catalogue DB, cf. plan Phase 2) et absentes de ces lignes, puis ajoute le
    // bouton "+ détails" sur toutes les lignes (statiques et ajoutées dynamiquement).
    syncPanelCatalogRows(modal);
    fetchPanelCatalog();

    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }

    // Rendre le modal déplaçable
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

    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('z-index', '999999', 'important');
  } else {
    console.error("La modale favoritesPanneauxModal est introuvable.");
  }
}

window.closeFavoritesModal = function (arg) {
  if (arg && arg.nodeType) {
    const modal = arg.closest('[id^="favoritesPanneauxModal"]');
    if (modal) modal.style.setProperty('display', 'none', 'important');
  }
}

// Fonction de Validation des données électriques et dimensionnelles du Favori
window.validateFavoritePanelData = function (panelData) {
  if (!panelData.fab || panelData.fab.trim() === '' || panelData.fab.length > 50) return "Le fabricant doit être renseigné (max 50 caractères).";
  if (!panelData.ref || panelData.ref.trim() === '' || panelData.ref.length > 50) return "La référence doit être renseignée (max 50 caractères).";

  const p = parseFloat(panelData.power);
  const i_mpp = parseFloat(panelData.impp);
  const i_sc = parseFloat(panelData.isc);
  const v_mpp = parseFloat(panelData.vmpp);
  const v_oc = parseFloat(panelData.voc);
  // L'utilisateur saisit en positif, on s'assure d'avoir la valeur absolue pour le contrôle
  const c_voc = Math.abs(parseFloat(panelData.coef_voc));
  const c_isc = parseFloat(panelData.coef_isc);
  const c_pmax = Math.abs(parseFloat(panelData.coef));

  if (isNaN(p) || p <= 100 || p >= 1500) return "La puissance doit être > 100 et < 1500 Wc.";
  if (isNaN(i_mpp) || i_mpp <= 0 || i_mpp >= 60) return "Impp doit être > 0 et < 60 A.";
  if (isNaN(i_sc) || i_sc <= 0 || i_sc >= 100) return "Isc doit être > 0 et < 100 A.";
  if (isNaN(v_mpp) || v_mpp <= 0 || v_mpp >= 100) return "Vmpp doit être > 0 et < 100 V.";
  if (isNaN(v_oc) || v_oc <= 0 || v_oc >= 120) return "Voc doit être > 0 et < 120 V.";

  if (isNaN(c_voc) || c_voc <= 0 || c_voc >= 0.5) return "Coef Voc doit être > 0 et < 0.5 %/°C.";
  if (isNaN(c_isc) || c_isc <= 0 || c_isc >= 0.3) return "Coef Isc doit être > 0 et < 0.3 %/°C.";
  if (isNaN(c_pmax) || c_pmax <= 0 || c_pmax >= 0.5) return "Coef Pmax doit être > 0 et < 0.5 %/°C.";

  const dims = panelData.dim.split(/[xX*]/).map(d => parseFloat(d.trim()));
  if (dims.length !== 3 || dims.some(isNaN)) return "Dimensions invalides. Format attendu: LxlxE en mm.";
  const [l, w, e] = dims;
  if (l <= 0 || l >= 4000) return "La longueur doit être > 0 et < 4000 mm.";
  if (w <= 0 || w >= 3000) return "La largeur doit être > 0 et < 3000 mm.";
  if (e <= 0 || e >= 50) return "L'épaisseur doit être > 0 et < 50 mm.";

  // Test 1: Puissance (Impp * Vmpp)
  const calcP = i_mpp * v_mpp;
  if (Math.abs(calcP - p) > 1.0) {
    return "Donnée non conforme";
  }

  // Test 2: Ratio d'intensité (Impp / Isc)
  const currentRatio = i_mpp / i_sc;
  if (currentRatio <= 0.80 || currentRatio >= 1) {
    return "Donnée non conforme";
  }

  return null;
};

window.selectFavoritePanel = function (btn) {
  const row = btn.closest('tr');
  if (!row) return;

  // 1. Récupérer les valeurs depuis les inputs de la ligne du modal
  const fab = row.cells[1].querySelector('input').value;
  const ref = row.cells[2].querySelector('input').value;
  const power = row.cells[3].querySelector('input').value;
  const dimsString = row.cells[4].querySelector('input').value;
  const impp = row.cells[5].querySelector('input').value;
  const isc = row.cells[6].querySelector('input').value;
  const vmpp = row.cells[7].querySelector('input').value;
  const voc = row.cells[8].querySelector('input').value;
  const coef_voc = row.cells[9].querySelector('input').value;
  const coef_isc = row.cells[10].querySelector('input').value;
  const coef = row.cells[11].querySelector('input').value;
  const type = row.cells[12].querySelector('select').value;
  const nbre_cells = row.cells[13].querySelector('input').value;

  const dims = dimsString.split(/[xX]/).map(d => parseInt(d.trim(), 10));
  const [length, width, thickness] = dims;

  // Validation des données avec la fonction métier
  const panelData = { fab, ref, power, dim: dimsString, impp, isc, vmpp, voc, coef_voc, coef_isc, coef, type, nbre_cells };
  const errorMsg = window.validateFavoritePanelData(panelData);
  if (errorMsg) {
    window.showValidationAlert(`Erreur sélection : ${errorMsg}`);
    return;
  }

  // Cocher la case de la ligne
  const cb = row.querySelector('.fav-checkbox');
  if (cb) cb.checked = true;

  // Extraire le suffixe dynamique (ex: "-pvId") pour cibler les bons inputs du bon onglet
  const modal = btn.closest('[id^="favoritesPanneauxModal"]');
  let suffix = "";
  if (modal && modal.id.includes('-')) {
    suffix = modal.id.substring(modal.id.indexOf('-'));
  }

  // Utiliser un sélecteur robuste pour trouver le conteneur du formulaire principal
  const formContainer = btn.closest('.tab-pane') || (modal ? modal.parentElement : document.body);

  // Helper pour trouver un input soit par son ID exact (avec suffixe), soit par son préfixe
  const getField = (baseId) => {
    return document.getElementById(baseId + suffix) || formContainer.querySelector('[id^="' + baseId + '"]');
  };

  // 3. Remplir les champs du formulaire principal et les VÉROUILLER (ReadOnly)
  const updateAndLockField = (baseId, val) => {
    const el = getField(baseId);
    if (el) {
      if (baseId === 'puissancePanneau') {
        const origSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (origSet) {
          delete el.dataset.manual;
          origSet.call(el, val);
          el.dataset.manual = 'true';
        } else {
          el.value = val;
        }
      } else {
        el.value = val;
      }
      el.readOnly = true;
      el.style.backgroundColor = '#e9ecef';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  updateAndLockField('fabricantPanneau', fab);
  updateAndLockField('referencePanneau', ref);
  updateAndLockField('puissancePanneau', power);

  // 4. Forcer le mode "dimensions personnalisées"
  const dimSelect = getField('dimensionsPanneaux');
  if (dimSelect) {
    dimSelect.value = 'custom';
    dimSelect.dispatchEvent(new Event('change', { bubbles: true }));
    dimSelect.disabled = true; // Verrouiller le select
  }

  // 5. Afficher le conteneur des dimensions personnalisées et remplir les valeurs
  setTimeout(() => {
    const customContainer = getField('customDimensionsContainer');
    if (customContainer) {
      customContainer.style.display = 'block';
      customContainer.classList.remove('hidden');

      updateAndLockField('longueurPanneauCustom', length);
      updateAndLockField('largeurPanneauCustom', width);
      updateAndLockField('epaisseurPanneauCustom', thickness);
    }
  }, 100);

  // Sauvegarder dans le localStorage pour persistance globale
  const panelConfig = {
    fab, ref, power, length, width, thickness, impp, isc, vmpp, voc, coef_voc, coef_isc, coef, type, nbre_cells
  };
  localStorage.setItem('preferredPanelConfig', JSON.stringify(panelConfig));

  // Notifie la modale "Chaînes / Onduleur / Batterie" (chaines_pertes_modal.js, Phase 4) du panneau
  // choisi pour ce PV, avec toutes les caractéristiques électriques nécessaires à
  // StringSizingUtils.calculateStringSizing (dont tension_systeme_max, absent des champs hôte
  // verrouillés ci-dessus, complété depuis le catalogue DB quand la référence y est connue).
  // pvId dérivé du suffixe de la modale (ex: "-PV1"), pas de btn.closest('[id^="form-"]') : la
  // modale a déjà été détachée de son onglet d'origine et rattachée à document.body plus haut dans
  // ce fichier (cf. openFavoritesModal), ce lookup échouerait systématiquement.
  if (suffix) {
    const dbMatch = (window.panelCatalogFromApi || []).find((p) => p.reference === ref);
    document.dispatchEvent(new CustomEvent('pvEquipementSelected', {
      detail: {
        type: 'panneau',
        pvId: suffix.substring(1),
        data: {
          fab, ref,
          power: parseFloat(power) || 0,
          impp: parseFloat(impp) || 0,
          isc: parseFloat(isc) || 0,
          vmpp: parseFloat(vmpp) || 0,
          voc: parseFloat(voc) || 0,
          // Le tableau affiche coef_voc/coef (Pmax) en magnitude positive à côté d'un signe "-"
          // décoratif séparé (cf. saveFavoritePanels() qui applique la même négation avant
          // sauvegarde) : calculateStringSizing attend le coefficient de température SIGNÉ
          // (négatif), sans quoi voc_T/vmpp_T sont calculés dans le mauvais sens avec la
          // température (Voc/Vmpp augmentent par temps froid, pas l'inverse).
          coef_voc: -Math.abs(parseFloat(coef_voc) || 0),
          coef_isc: parseFloat(coef_isc) || 0,
          coef: -Math.abs(parseFloat(coef) || 0),
          tension_systeme_max: dbMatch ? dbMatch.tension_systeme_max : 1500,
        },
      },
    }));
  }

  // 6. Fermer la modale
  setTimeout(() => closeFavoritesModal(btn), 250);
}

window.saveFavoritePanels = function (btn) {
  const modal = btn.closest('.modal-content');
  const tbody = modal.querySelector('tbody');
  const rows = tbody.querySelectorAll('tr');
  const panels = [];
  let hasError = false;

  rows.forEach(row => {
    const p = {
      fab: row.cells[1].querySelector('input').value,
      ref: row.cells[2].querySelector('input').value,
      power: row.cells[3].querySelector('input').value,
      dim: row.cells[4].querySelector('input').value,
      impp: row.cells[5].querySelector('input').value,
      isc: row.cells[6].querySelector('input').value,
      vmpp: row.cells[7].querySelector('input').value,
      voc: row.cells[8].querySelector('input').value,
      coef_voc: row.cells[9].querySelector('input').value,
      coef_isc: row.cells[10].querySelector('input').value,
      coef: row.cells[11].querySelector('input').value,
      type: row.cells[12].querySelector('select').value,
      nbre_cells: row.cells[13].querySelector('input').value
    };

    // Exécuter les tests de validité de puissance et format
    if (p.ref && p.power) {
      const err = window.validateFavoritePanelData(p);
      if (err) {
        hasError = true;
        window.showValidationAlert(`Erreur sur la ligne ${p.ref} : ${err}`);
      }
    }

    // Convertir les coefficients en valeurs négatives pour le stockage comme requis
    p.coef_voc = p.coef_voc ? (-Math.abs(parseFloat(p.coef_voc))).toString() : '';
    p.coef = p.coef ? (-Math.abs(parseFloat(p.coef))).toString() : '';

    panels.push(p);
  });

  if (hasError) return; // Empêcher la sauvegarde si erreur

  localStorage.setItem('favoritePanels_savedData', JSON.stringify(panels));
  if (window.showToastNotification) window.showToastNotification('Favoris enregistrés avec succès !');
};

// ---------------------------------------------------------------------------------------------
// Source de données : catalogue DB (table `panneaux`, cf. plan "Modale Chaînes PV / Onduleur /
// Batterie + Pertes système détaillées", Phase 2). Le tableau HTML statique de calepinage.html (5
// lignes, dont DMEGC DM-470-G12RT et Longi LR7-54HVH pré-remplies) reste la 1ère source affichée ;
// toute référence présente en base et absente de ces lignes est ajoutée dynamiquement en fin de
// tableau. Aucune déclaration top-level const/let ici, comme le reste de ce fichier (cf. en-tête).
// ---------------------------------------------------------------------------------------------
window.panelCatalogFromApi = window.panelCatalogFromApi || [];

function fetchPanelCatalog() {
  return fetch('/concevoir_mon_projet/catalogue/panneaux')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((data) => {
      if (!data || !data.success || !Array.isArray(data.panneaux)) return;
      window.panelCatalogFromApi = data.panneaux;
      document.querySelectorAll('[id^="favoritesPanneauxModal"]').forEach((modal) => {
        if (modal.style.display === 'none') return;
        syncPanelCatalogRows(modal);
      });
    })
    .catch((e) => console.error('Erreur lors du chargement du catalogue panneaux (BD)', e));
}

function buildPanelRowFromApi(p) {
  const tr = document.createElement('tr');
  const dims = [p.longueur_mm, p.largeur_mm, p.epaisseur_mm].filter((v) => v !== null && v !== undefined).join('x');
  const type = p.type_module === 'Bifacial' ? 'Bifacial' : 'Monofacial';
  tr.innerHTML = `
    <td class="col-sel">
      <button type="button" class="btn btn-sm btn-import-fiche" onclick="triggerImportFicheTechnique(this)"
        title="Importer une fiche technique PDF et remplir les champs automatiquement">
        <i class="fas fa-file-upload"></i>
      </button>
      <input type="checkbox" class="form-check-input fav-checkbox" />
    </td>
    <td class="col-fab"><input type="text" class="form-control form-control-sm" value="${p.fabricant || ''}" /></td>
    <td class="col-ref"><input type="text" class="form-control form-control-sm" value="${p.reference || ''}" /></td>
    <td class="col-puis"><input type="number" class="form-control form-control-sm" value="${p.puissance_wc != null ? p.puissance_wc : ''}" /></td>
    <td class="col-dim"><input type="text" class="form-control form-control-sm" value="${dims}" placeholder="LxlxE" /></td>
    <td><input type="number" class="form-control form-control-sm" value="${p.i_mpp != null ? p.i_mpp : ''}" step="0.01" /></td>
    <td><input type="number" class="form-control form-control-sm" value="${p.i_sc != null ? p.i_sc : ''}" step="0.01" /></td>
    <td><input type="number" class="form-control form-control-sm" value="${p.v_mpp != null ? p.v_mpp : ''}" step="0.01" /></td>
    <td><input type="number" class="form-control form-control-sm" value="${p.v_oc != null ? p.v_oc : ''}" step="0.01" /></td>
    <td>
      <div class="input-group input-group-sm flex-nowrap">
        <span class="input-group-text px-1">-</span>
        <input type="number" class="form-control form-control-sm" value="${p.coef_voc_pct_c != null ? Math.abs(p.coef_voc_pct_c) : ''}" step="0.001" min="0" />
        <span class="input-group-text px-1">%</span>
      </div>
    </td>
    <td>
      <div class="input-group input-group-sm flex-nowrap">
        <span class="input-group-text px-1">+</span>
        <input type="number" class="form-control form-control-sm" value="${p.coef_isc_pct_c != null ? p.coef_isc_pct_c : ''}" step="0.001" min="0" />
        <span class="input-group-text px-1">%</span>
      </div>
    </td>
    <td>
      <div class="input-group input-group-sm flex-nowrap">
        <span class="input-group-text px-1">-</span>
        <input type="number" class="form-control form-control-sm" value="${p.coef_pmax_pct_c != null ? Math.abs(p.coef_pmax_pct_c) : ''}" step="0.001" min="0" />
        <span class="input-group-text px-1">%</span>
      </div>
    </td>
    <td>
      <select class="form-select form-select-sm">
        <option value="Monofacial"${type === 'Monofacial' ? ' selected' : ''}>Monofacial</option>
        <option value="Bifacial"${type === 'Bifacial' ? ' selected' : ''}>Bifacial</option>
      </select>
    </td>
    <td class="col-nbcells"><input type="number" class="form-control form-control-sm" value="${p.nb_cellules != null ? p.nb_cellules : ''}" min="0" step="1" /></td>
    <td><button type="button" class="btn btn-sm btn-choisir-fav" onclick="selectFavoritePanel(this)">Choisir</button></td>
  `;
  return tr;
}

function enhancePanelActionCell(row, tensionSystemeMax) {
  const actionCell = row.cells[row.cells.length - 1];
  if (!actionCell || actionCell.querySelector('.btn-panel-details')) return;
  const details = {};
  if (tensionSystemeMax !== undefined && tensionSystemeMax !== null && tensionSystemeMax !== '') {
    details['Tension système max (V)'] = tensionSystemeMax;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-sm btn-panel-details';
  btn.textContent = '+ détails';
  btn.style.cssText = 'margin-top:4px; display:block; width:100%; font-size:0.75rem;';
  btn.dataset.details = JSON.stringify(details);
  btn.addEventListener('click', () => window.toggleDetailRow(btn));
  actionCell.appendChild(btn);
}

function syncPanelCatalogRows(modal) {
  if (!modal) return;
  const tbody = modal.querySelector('tbody');
  if (!tbody) return;

  const existingRefs = new Set(
    Array.from(tbody.querySelectorAll('tr'))
      .map((r) => (r.cells[2] && r.cells[2].querySelector('input') ? r.cells[2].querySelector('input').value : ''))
      .filter(Boolean)
  );

  window.panelCatalogFromApi.forEach((p) => {
    if (!p.reference || existingRefs.has(p.reference)) return;
    tbody.appendChild(buildPanelRowFromApi(p));
    existingRefs.add(p.reference);
  });

  tbody.querySelectorAll('tr').forEach((row) => {
    const refInput = row.cells[2] && row.cells[2].querySelector('input');
    const ref = refInput ? refInput.value : '';
    const dbEntry = window.panelCatalogFromApi.find((p) => p.reference === ref);
    enhancePanelActionCell(row, dbEntry ? dbEntry.tension_systeme_max : null);
  });
}

fetchPanelCatalog();
