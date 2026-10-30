// Fichier dédié à la logique de l'Autoconsommation Collective (ACC)

import { saveAccState, loadAccState, clearAccState } from './main_session_manager.js';
import {
    saveFileToIDB, deleteFileFromIDB, getIDBEntriesByPrefix, saveToLS, loadFromLS,
    saveAccFileToDB, renameAccFileInDB, deleteAccFileFromDB, restoreAccFilesFromDBIfMissing, listAccFileNamesInDB,
    signalerCourbesConsommationModifiees
} from './persistence.js';
import { detecterPasDeTempsCourbe } from './pas_de_temps_courbe.js';
// Sélecteur de pas de temps de la page hôte (#time-step-select sur la page Autoconsommation, #pas_temps
// sur l'IRVE), mémorisé par renderAccConsumersInput pour les appels qui ne le reçoivent pas.
let _accTimeStepSelect = null;
const _pasDeTempsCourant = () => parseInt((_accTimeStepSelect || document.getElementById('time-step-select'))?.value, 10) || 60;

// Pas de temps (min) du fichier, déduit de ses dates (cf. pas_de_temps_courbe.js) : la consommation
// annuelle affichée et le pas déclaré au serveur ne dépendent plus du sélecteur. Le seul nombre de
// lignes confondait une demi-année au pas de 30 min avec une année horaire et ignorait le pas de 5 min.
const _pasParFichier = new WeakMap(); // File -> pas détecté par calculateAnnualConsumption
const _erreurParFichier = new WeakMap(); // File -> motif d'échec de calculateAnnualConsumption (infobulle "Erreur")

// "Affectation prod. hors ACC" (%) : même valeur que le tableau "Paramètres Généraux de Production"
// du résumé calepinage (SummaryModal, solarProjectData.totals.gridLossPercent) et que #pv_grid_loss,
// lu par le calcul ACC (main_autoconso.js -> grid_loss_percent).
function _affectationHorsAccCourante() {
    try {
        const t = JSON.parse(localStorage.getItem('solarProjectData') || '{}').totals;
        if (t && t.gridLossPercent !== undefined) return t.gridLossPercent;
    } catch (_) {}
    return parseFloat(document.getElementById('pv_grid_loss')?.value) || 0;
}

function _enregistrerAffectationHorsAcc(val) {
    const gridLossEl = document.getElementById('pv_grid_loss');
    if (gridLossEl) {
        gridLossEl.value = val;
        // Rafraîchit la synthèse des paramètres PV (écouteurs 'change' de #pvForm).
        gridLossEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    try {
        const saved = localStorage.getItem('solarProjectData');
        if (!saved) return;
        const projectData = JSON.parse(saved);
        if (!projectData.totals) projectData.totals = {};
        projectData.totals.gridLossPercent = val;
        localStorage.setItem('solarProjectData', JSON.stringify(projectData));
    } catch (error) {
        console.error("Erreur lors de la sauvegarde de l'affectation prod. hors ACC:", error);
    }
}

// Valeur modifiée ailleurs (résumé calepinage dans la page hôte) : resynchroniser le champ affiché.
window.addEventListener('storage', (e) => {
    if (e.key !== 'solarProjectData') return;
    const input = document.getElementById('acc-prod-hors-acc');
    if (input && document.activeElement !== input) {
        input.value = _affectationHorsAccCourante();
        input.dataset.lastValid = input.value;
    }
});

// Map pour stocker les fichiers des consommateurs en ACC
// La structure est maintenant : Map<original_filename, {file: File, customName: string, annualConsumption: number | null}>
export const accConsFiles = new Map();

/**
 * Affiche l'interface pour importer plusieurs fichiers de consommateurs.
 * @param {HTMLElement} container - Le conteneur où injecter le HTML.
 * @param {Function} showMessage - Référence à la fonction pour afficher les messages.
 * @param {HTMLSelectElement} timeStepSelect - Le sélecteur de pas de temps.
 * @param {Object} [options]
 * @param {boolean} [options.masquerParametresEconomiques=false] - n'affiche pas le bloc "Paramètres
 *   Économiques" (ses 3 boutons ouvrent des modals propres à la page Autoconsommation ; demande
 *   explicite : inutile dans le modal de consommation d'énergie de l'IRVE).
 */
export function renderAccConsumersInput(container, showMessage, timeStepSelect, options = {}) {
    if (timeStepSelect) _accTimeStepSelect = timeStepSelect;
    const savedState = loadAccState();
    const blocParametresEconomiques = options.masquerParametresEconomiques ? '' : `
        <div class="input-group" style="margin-top: 1.5rem;">
            <h4>Paramètres Économiques</h4>
            <button id="open-eco-modal-btn" class="btn-secondary" style="width: 100%; margin-bottom: 0.5rem;">Gérer les paramètres économiques par participant</button>
            <button id="open-advanced-eco-modal-btn" class="btn-secondary" style="width: 100%; margin-bottom: 0.5rem;">📊 Gérer l'analyse financière avancée</button>
            <button id="open-dashboard-modal-btn" class="btn-secondary" style="width: 100%;">🎛️ Personnaliser le tableau de bord</button>
        </div>`;
    // "Affectation prod. hors ACC" : seulement sur la page Autoconsommation, où #pv_grid_loss (lu par
    // le calcul ACC, cf. main_autoconso.js) existe — absent de l'IRVE.
    const blocAffectationHorsAcc = document.getElementById('pv_grid_loss') ? `
            <div style="margin-bottom: 0.75rem;">
                <label for="acc-prod-hors-acc">Affectation prod. hors ACC (%)</label>
                <input type="number" id="acc-prod-hors-acc" class="eco-input" min="0" max="15" step="0.1" value="${_affectationHorsAccCourante()}" style="width: 100%;">
            </div>` : '';
    container.innerHTML = `
        <div class="file-buttons">
            <label for="acc-cons-files-hidden" class="btn-primary" style="display: flex; align-items: center; justify-content: center; width: 100%; cursor: pointer;">+ Ajouter un ou plusieurs consommateurs</label>
            <input type="file" id="acc-cons-files-hidden" accept=".xlsx, .csv, .txt" multiple style="display: none;">
        </div>
        <div id="acc-consumer-list" class="table-card" style="margin-top: 1rem; background-color: var(--bg-panel);">
            <!-- Le tableau sera injecté ici -->
        </div>
        <div id="session-restore-info" class="input-group" style="font-size: 0.9rem; color: var(--text-secondary); text-align: center; margin-top: 1rem; ${savedState ? '' : 'display: none;'}">
            ${savedState ? `Une session précédente avec ${savedState.participants.length} participant(s) a été trouvée. Ré-importez les fichiers pour restaurer la configuration.` : ''}
        </div>
        <div class="input-group" style="margin-top: 1.5rem; border-top: 1px solid var(--border-color); padding-top: 1.5rem;">
            <h4>Paramètres de l'opération ACC</h4>
            ${blocAffectationHorsAcc}
            <div>
                <label>Méthode de répartition de la production</label>
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <label style="cursor: pointer;"><input type="radio" name="acc_repartition_method" value="dynamic" checked> Dynamique (au prorata de la consommation instantanée)</label>
                    <label style="cursor: pointer;"><input type="radio" name="acc_repartition_method" value="fixed"> Clés de répartition fixes (%)</label>
                    <label style="cursor: pointer;"><input type="radio" name="acc_repartition_method" value="priority"> Ordre de priorité (glisser-déposer)</label>
                </div>
            </div>
        </div>
        ${blocParametresEconomiques}
        <div id="acc-fixed-keys-container" class="acc-keys-section-container" style="display: none; margin-top: 1rem;">
            <!-- Le total des clés sera injecté ici -->
        </div>
    `;

    document.getElementById('acc-cons-files-hidden').addEventListener('change', async function (e) {
        const newFiles = Array.from(e.target.files);
        const maxFiles = 30;
        if (accConsFiles.size + newFiles.length > maxFiles) {
            showMessage(`Vous ne pouvez pas dépasser ${maxFiles} fichiers de consommation.`, 'error');
            return;
        }

        const savedState = loadAccState();

        for (const file of newFiles) {
            // Ré-import d'un fichier resté en "Erreur" : remplacé (auparavant ignoré, l'erreur restait figée).
            if (!accConsFiles.has(file.name) || accConsFiles.get(file.name).annualConsumption === null) {
                const annualConsumption = await calculateAnnualConsumption(file, showMessage, timeStepSelect);
                let customName = file.name.replace(/\.(xlsx|csv|txt)$/i, ''); // Nom par défaut

                // Si un état sauvegardé existe, on cherche une correspondance
                if (savedState) {
                    const savedParticipant = savedState.participants.find(p => p.originalName === file.name);
                    if (savedParticipant) {
                        customName = savedParticipant.customName;
                    }
                }

                accConsFiles.set(file.name, {
                    file: file,
                    customName: customName,
                    annualConsumption: annualConsumption // peut être null si erreur
                });
                saveFileToIDB('accFile_' + file.name, file);
                // Copie de référence en base, rattachée au projet actif et au compte (cf.
                // persistence.js::saveAccFileToDB) — l'IndexedDB seule ne survivait ni à un vidage de
                // cache ni à un changement de navigateur, et n'était liée à aucun projet.
                if (annualConsumption !== null) {
                    saveAccFileToDB(file, {
                        originalName: file.name, customName, source: 'import',
                        timeStep: _pasParFichier.get(file) || parseInt(timeStepSelect?.value, 10) || _pasDeTempsCourant(),
                    }, showMessage);
                }
            }
        }
        updateAccConsumerList();
        saveAccFileMeta();
        if (newFiles.length) signalerCourbesConsommationModifiees(); // résultats affichés remis à 0
        this.value = ''; // Vider l'input pour permettre de ré-importer le même fichier
    });

    const affectationInput = document.getElementById('acc-prod-hors-acc');
    if (affectationInput) {
        affectationInput.dataset.lastValid = affectationInput.value;
        affectationInput.addEventListener('change', () => {
            const val = parseFloat(affectationInput.value);
            if (affectationInput.value === '' || isNaN(val) || val < 0 || val > 15) {
                showMessage("L'affectation de la production hors ACC doit être comprise entre 0 % et 15 %.", 'error');
                affectationInput.value = affectationInput.dataset.lastValid;
                return;
            }
            affectationInput.dataset.lastValid = affectationInput.value;
            _enregistrerAffectationHorsAcc(val);
        });
    }

    document.querySelectorAll('input[name="acc_repartition_method"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            saveCurrentAccState(); // Sauvegarder l'état immédiatement après le changement.
            saveAccFileMeta();
            const fixedKeysContainer = document.getElementById('acc-fixed-keys-container');
            fixedKeysContainer.style.display = e.target.value === 'fixed' ? 'block' : 'none';
            // NOUVEAU: Afficher un message pour la méthode prioritaire
            const priorityMessage = document.getElementById('acc-priority-message');
            if (priorityMessage) priorityMessage.style.display = e.target.value === 'priority' ? 'block' : 'none';
            updateAccConsumerList();
        });
    });

    updateAccConsumerList();
}

/**
 * Récupère l'état actuel de l'interface ACC et le sauvegarde en session.
 * Centralise la lecture du DOM pour la sauvegarde.
 */
function saveCurrentAccState() {
    const repartitionMethod = document.querySelector('input[name="acc_repartition_method"]:checked')?.value || 'dynamic';
    const participants = [];
    const priorityOrder = [];

    // Construire une map des clés de répartition depuis les inputs visibles (dans fixedKeysContainer)
    const keyInputMap = {};
    document.querySelectorAll('.acc-key-input').forEach(input => {
        if (input.dataset.consumerKey) {
            keyInputMap[input.dataset.consumerKey] = parseFloat(input.value) || 0;
        }
    });

    // L'ordre des participants est déterminé par l'ordre des lignes dans le tableau
    document.querySelectorAll('#acc-consumer-list tbody tr').forEach(row => {
        const originalName = row.dataset.originalName;
        const data = accConsFiles.get(originalName);
        if (data) {
            const hasKey = data.customName in keyInputMap;
            participants.push({
                originalName: originalName,
                customName: data.customName,
                repartitionKey: hasKey ? keyInputMap[data.customName] : null
            });
            priorityOrder.push(data.customName);
        }
    });

    saveAccState({
        repartitionMethod,
        participants,
        priorityOrder
    });
}

function saveAccFileMeta() {
    const repartitionMethod = document.querySelector('input[name="acc_repartition_method"]:checked')?.value || 'dynamic';
    const files = {};
    accConsFiles.forEach((data, originalName) => {
        const keyInput = document.querySelector(`.acc-key-input[data-consumer-key="${data.customName}"]`);
        files[originalName] = {
            customName: data.customName,
            repartitionKey: keyInput ? (parseFloat(keyInput.value) || null) : null
        };
    });
    saveToLS('accFileMeta', { repartitionMethod, files });
}

export async function restoreAccFilesFromIDB(showMessage) {
    // IndexedDB vide (ou appartenant à un autre projet) : rechargement depuis la base du projet actif.
    await restoreAccFilesFromDBIfMissing();
    const entries = await getIDBEntriesByPrefix('accFile_');
    // Entrées retirées de l'IndexedDB (changement de projet) : on les retire aussi de l'affichage.
    const clesPresentes = new Set(entries.map(e => e.key.replace('accFile_', '')));
    for (const nom of [...accConsFiles.keys()]) {
        if (!clesPresentes.has(nom)) accConsFiles.delete(nom);
    }
    if (entries.length === 0) { updateAccConsumerList(); return; }
    if (entries.length === 0) return;

    const meta = loadFromLS('accFileMeta') || {};

    for (const { key, file } of entries) {
        const originalName = key.replace('accFile_', '');
        const dejaCharge = accConsFiles.get(originalName);
        // Un fichier en "Erreur" (ex. lu par une version antérieure du lecteur) est relu plutôt que figé.
        if (!dejaCharge || dejaCharge.annualConsumption === null) {
            const annualConsumption = await calculateAnnualConsumption(file, showMessage || (() => {}), _accTimeStepSelect);
            const customName = dejaCharge?.customName ?? meta.files?.[originalName]?.customName ?? originalName.replace(/\.(xlsx|csv|txt)$/i, '');
            accConsFiles.set(originalName, { file, customName, annualConsumption });
            // Jamais enregistré en base à l'import (échec de lecture) : rattrapage maintenant qu'il est lisible.
            if (dejaCharge && annualConsumption !== null) {
                saveAccFileToDB(file, {
                    originalName, customName, source: 'import',
                    timeStep: _pasParFichier.get(file) || _pasDeTempsCourant(),
                }, showMessage);
            }
        }
    }

    const method = meta.repartitionMethod || 'dynamic';

    // Reconstruire acc_session_state pour que updateAccConsumerList puisse restaurer les clés de répartition
    const participants = [];
    const priorityOrder = [];
    accConsFiles.forEach((data, originalName) => {
        const fileMeta = meta.files?.[originalName];
        participants.push({ originalName, customName: data.customName, repartitionKey: fileMeta?.repartitionKey ?? null });
        priorityOrder.push(data.customName);
    });
    saveAccState({ repartitionMethod: method, participants, priorityOrder });

    const radio = document.querySelector(`input[name="acc_repartition_method"][value="${method}"]`);
    if (radio) {
        radio.checked = true;
        const fixedKeysContainer = document.getElementById('acc-fixed-keys-container');
        if (fixedKeysContainer) fixedKeysContainer.style.display = method === 'fixed' ? 'block' : 'none';
    }

    updateAccConsumerList();

    // Rattrapage : courbes lisibles présentes dans l'IndexedDB mais absentes de la base du projet
    // (ex. importées alors que leur lecture échouait — elles n'étaient alors pas enregistrées en
    // base). La base alimente la carte des participants (page calepinage) et la restauration sur un
    // autre poste.
    const enBase = await listAccFileNamesInDB();
    if (enBase) {
        accConsFiles.forEach((data, originalName) => {
            if (data.annualConsumption !== null && !enBase.has(originalName)) {
                saveAccFileToDB(data.file, {
                    originalName, customName: data.customName, source: 'import',
                    timeStep: _pasParFichier.get(data.file) || _pasDeTempsCourant(),
                }, showMessage);
            }
        });
    }

    // Masquer le message "ré-importez les fichiers" puisque la restauration est automatique
    const restoreInfo = document.getElementById('session-restore-info');
    if (restoreInfo) restoreInfo.style.display = 'none';
}

/**
 * Ajoute (ou remplace, à original_name identique) un participant ACC à partir d'un fichier construit
 * par programme — ex. une courbe Enedis préparée puis validée dans le modal de préparation
 * (Irve/switchgrid_data.js). Même effet qu'un import manuel : Map accConsFiles, IndexedDB, métadonnées
 * localStorage, base de données, tableau des participants.
 * @returns {Promise<{success: boolean, annualConsumption: number|null, message?: string}>}
 */
export async function addAccConsumerFile(file, { customName, source = 'import', timeStep, prm, annee, showMessage } = {}) {
    const notify = typeof showMessage === 'function' ? showMessage : () => {};
    const originalName = file.name;
    const existant = accConsFiles.get(originalName);
    if (!existant && accConsFiles.size >= 30) {
        return { success: false, annualConsumption: null, message: 'Vous ne pouvez pas dépasser 30 fichiers de consommation.' };
    }
    const pas = parseInt(timeStep, 10) || _pasDeTempsCourant();
    const annualConsumption = await calculateAnnualConsumption(file, notify, { value: String(pas) });
    if (annualConsumption === null) {
        return { success: false, annualConsumption: null, message: `Courbe illisible : ${originalName}` };
    }
    const nom = existant?.customName || customName || originalName.replace(/\.(xlsx|csv|txt)$/i, '');
    accConsFiles.set(originalName, { file, customName: nom, annualConsumption });
    await saveFileToIDB('accFile_' + originalName, file);
    signalerCourbesConsommationModifiees();
    saveAccFileMeta();
    updateAccConsumerList();
    // saveCurrentAccState lit l'ordre des lignes du tableau : sans tableau affiché, il écraserait la
    // session ACC avec une liste vide.
    if (document.querySelector('#acc-consumer-list tbody')) saveCurrentAccState();
    const db = await saveAccFileToDB(file, { originalName, customName: nom, source, timeStep: pas, prm, annee }, notify);
    return { success: true, annualConsumption, enBase: db.success, message: db.success ? undefined : db.message };
}

/**
 * Met à jour le tableau de gestion des consommateurs.
 */
function updateAccConsumerList() {
    const listContainer = document.getElementById('acc-consumer-list');
    const fixedKeysContainer = document.getElementById('acc-fixed-keys-container');
    const showFixedKeys = document.querySelector('input[name="acc_repartition_method"][value="fixed"]:checked') !== null;
    const isPriorityMode = document.querySelector('input[name="acc_repartition_method"][value="priority"]:checked') !== null;

    if (!listContainer) return;

    if (accConsFiles.size === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary); font-size: 0.9rem;">Aucun consommateur importé.</p>';
        if (fixedKeysContainer) fixedKeysContainer.style.display = 'none';
        clearAccState(); // Nettoyer la session si tous les participants sont supprimés
        return;
    }

    const savedState = loadAccState();
    let tableRowsHtml = '';
    let participantRowsHtml = '';

    // NOUVEAU: Ordonner l'affichage si un ordre de priorité est sauvegardé
    const orderedFiles = new Map();
    if (isPriorityMode && savedState?.priorityOrder) {
        savedState.priorityOrder.forEach(name => {
            const originalName = [...accConsFiles].find(([key, val]) => val.customName === name)?.[0];
            if (originalName) orderedFiles.set(originalName, accConsFiles.get(originalName));
        });
        // Ajouter les fichiers restants qui ne sont pas dans l'ordre de priorité
        accConsFiles.forEach((data, key) => {
            if (!orderedFiles.has(key)) orderedFiles.set(key, data);
        });
    } else {
        accConsFiles.forEach((data, key) => orderedFiles.set(key, data));
    }

    orderedFiles.forEach((data, originalName) => {
        const annualConsumptionMWh = data.annualConsumption !== null ? (data.annualConsumption / 1000).toFixed(2) : 'Erreur';
        const savedParticipant = savedState?.participants?.find(p => p.originalName === originalName);
        const savedKeyValue = (showFixedKeys && savedParticipant && savedParticipant.repartitionKey !== null) ? savedParticipant.repartitionKey : '';
        const valueAttr = savedKeyValue !== '' ? `value="${savedKeyValue}"` : '';

        tableRowsHtml += `
            <tr data-original-name="${originalName}">
                ${isPriorityMode ? '<td class="drag-handle" title="Glisser pour réordonner">☰</td>' : ''}
                <td style="font-size: 0.8rem; color: var(--text-secondary); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${originalName}">${originalName}</td>
                <td><input type="text" class="eco-input custom-name-input" value="${data.customName}" style="text-align: left; padding: 4px 8px; font-size: 0.9rem;"></td>
                <td style="text-align: right; padding-right: 1rem;"${data.annualConsumption === null ? ` title="${String(_erreurParFichier.get(data.file) || 'Fichier illisible').replace(/"/g, '&quot;')}"` : ''}>${annualConsumptionMWh} MWh</td>
                <td><button class="btn-danger remove-consumer-btn" style="padding: 4px 8px; font-size: 0.8rem;">✕</button></td>
            </tr>
        `;

        if (showFixedKeys) {
            participantRowsHtml += `
                <div class="acc-key-input-row">
                    <span class="acc-key-label">${data.customName}</span>
                    <div class="acc-key-input-wrapper">
                        <input type="number" class="acc-key-input" data-consumer-key="${data.customName}" min="0" max="100" step="0.1" placeholder="0.0" ${valueAttr}>
                        <span>%</span>
                    </div>
                </div>
            `;
        }
    });

    listContainer.innerHTML = `
        <div class="table-responsive">
            <table class="seasonal-table" style="background-color: #fff;">
                <thead>
                    <tr>
                        ${isPriorityMode ? '<th style="width: 30px;"></th>' : ''}
                        <th>Fichier Original</th>
                        <th>Nom Personnalisé</th>
                        <th style="text-align: right; padding-right: 1rem;">Conso. Annuelle</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>${tableRowsHtml}</tbody>
            </table>
        </div>
        <p id="acc-priority-message" style="font-size: 0.85rem; color: var(--text-secondary); text-align: center; margin-top: 0.5rem; display: ${isPriorityMode ? 'block' : 'none'};">
            Glissez-déposez les lignes pour définir l'ordre de priorité (le premier de la liste est servi en premier).
        </p>
    `;

    // Gestion de l'affichage du total des clés
    // CORRECTION : Ne restaurer la méthode de répartition que si la liste est vide (premier chargement).
    if (accConsFiles.size === 0 && savedState?.repartitionMethod) {
        const radioToCheck = document.querySelector(`input[name="acc_repartition_method"][value="${savedState.repartitionMethod}"]`);
        if (radioToCheck) {
            radioToCheck.checked = true;
        }
    }
    if (showFixedKeys) {
        fixedKeysContainer.style.display = 'block';
        fixedKeysContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <h5 style="margin: 0; color: var(--text-primary);">Clés de répartition fixes</h5>
                <div style="text-align: right; font-weight: bold;">
                    Total : <span id="acc-keys-total">0.00</span> %
                </div>
            </div>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0.5rem 0 0;">Attribuez un pourcentage de la production PV à chaque consommateur. La somme doit être égale à 100%.</p>
            ${participantRowsHtml}
        `;
        updateKeysTotal();
    } else {
        fixedKeysContainer.style.display = 'none';
        fixedKeysContainer.innerHTML = '';
    }

    // Attacher les écouteurs d'événements pour les nouveaux éléments
    attachConsumerTableEvents();

    // NOUVEAU: Activer le glisser-déposer si en mode priorité
    if (isPriorityMode) {
        makeTableSortable();
    }
}

/**
 * Attache les écouteurs d'événements pour le tableau des consommateurs.
 */
function attachConsumerTableEvents() {
    document.querySelectorAll('.remove-consumer-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const originalName = this.closest('tr').dataset.originalName;
            accConsFiles.delete(originalName);
            deleteFileFromIDB('accFile_' + originalName);
            deleteAccFileFromDB(originalName);
            saveAccFileMeta();
            updateAccConsumerList();
            signalerCourbesConsommationModifiees();
        });
    });

    document.querySelectorAll('.custom-name-input').forEach(input => {
        input.addEventListener('change', function () {
            const originalName = this.closest('tr').dataset.originalName;
            const newCustomName = this.value.trim();

            // Vérifier si le nouveau nom n'est pas déjà utilisé par un autre
            for (const [key, value] of accConsFiles.entries()) {
                if (key !== originalName && value.customName === newCustomName) {
                    alert(`Le nom "${newCustomName}" est déjà utilisé. Veuillez choisir un nom unique.`);
                    this.value = accConsFiles.get(originalName).customName; // Rétablir l'ancien nom
                    return;
                }
            }

            if (accConsFiles.has(originalName)) {
                const oldCustomName = accConsFiles.get(originalName).customName;
                accConsFiles.get(originalName).customName = newCustomName;
                // Mettre à jour le data-consumer-key de l'input de clé de répartition dans fixedKeysContainer
                const keyInput = [...document.querySelectorAll('.acc-key-input')].find(el => el.dataset.consumerKey === oldCustomName);
                if (keyInput) {
                    keyInput.dataset.consumerKey = newCustomName;
                }
                saveCurrentAccState();
                saveAccFileMeta();
                renameAccFileInDB(originalName, newCustomName);
            }
        });
    });

    // Attacher les écouteurs pour les inputs des clés de répartition
    document.querySelectorAll('.acc-key-input').forEach(input => {
        input.addEventListener('input', () => { saveCurrentAccState(); saveAccFileMeta(); updateKeysTotal(); });
    });


}

/**
 * NOUVEAU: Rend le tableau des consommateurs triable par glisser-déposer.
 */
function makeTableSortable() {
    const tableBody = document.querySelector('#acc-consumer-list tbody');
    if (!tableBody) return;

    let draggingEle;
    let placeholder;
    let isDragging = false;

    const swap = function (nodeA, nodeB) {
        const parentA = nodeA.parentNode;
        const siblingA = nodeA.nextSibling === nodeB ? nodeA : nodeA.nextSibling;
        nodeB.parentNode.insertBefore(nodeA, nodeB);
        parentA.insertBefore(nodeB, siblingA);
    };

    tableBody.addEventListener('mousedown', function (e) {
        if (!e.target.classList.contains('drag-handle')) return;

        const row = e.target.closest('tr');
        if (!row) return;

        draggingEle = row;
        isDragging = true;
        draggingEle.classList.add('dragging');
        document.body.style.cursor = 'grabbing';
    });

    tableBody.addEventListener('mousemove', function (e) {
        if (!isDragging) return;
        const targetRow = e.target.closest('tr');
        if (targetRow && targetRow !== draggingEle) {
            swap(draggingEle, targetRow);
        }
    });

    document.addEventListener('mouseup', function () {
        if (!isDragging) return;
        isDragging = false;
        draggingEle.classList.remove('dragging');
        draggingEle = null;
        document.body.style.cursor = '';
        saveCurrentAccState(); // Sauvegarder le nouvel ordre
    });
}

/**
 * Calcule la consommation annuelle d'un fichier côté client.
 * @param {File} file - Le fichier à analyser.
 * @param {Function} showMessage - La fonction pour afficher les messages.
 * @param {HTMLSelectElement} [timeStepSelect] - Sélecteur de pas de temps à utiliser. À défaut,
 *   recherche #time-step-select dans le document (absent sur certaines pages hôtes, ex. l'IRVE —
 *   cf. renderAccConsumersInput, qui reçoit déjà ce sélecteur en paramètre et doit le transmettre ici
 *   plutôt que de laisser cette fonction le rechercher elle-même par id fixe).
 * @returns {Promise<number|null>} La consommation annuelle en kWh, ou null en cas d'erreur.
 */
async function calculateAnnualConsumption(file, showMessage, timeStepSelect) {
    if (typeof XLSX === 'undefined') {
        showMessage("La librairie d'analyse Excel (XLSX) n'est pas chargée.", "error");
        return null;
    }
    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];

        // Lire les 4 premières lignes pour trouver l'en-tête.
        const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        let headerRowIndex = -1;
        let consIndex = -1;

        for (let i = 0; i < Math.min(4, allRows.length); i++) {
            const header = allRows[i].map(h => (typeof h === 'string' ? h.trim() : '').toLowerCase());
            // Recherche flexible de la colonne de consommation : "Cons. existante", "Conso. Existant (kW/kVA)",
            // "Conso existante" (export Courbe_Charge_Bornes de l'IRVE, sans point)...
            consIndex = header.findIndex(h => /\bconso?\.?\s*existant/.test(h));
            if (consIndex !== -1) {
                headerRowIndex = i;
                break;
            }
        }

        if (headerRowIndex === -1) {
            throw new Error("La colonne 'Cons. existante' ou 'Conso. existant' est introuvable dans les 4 premières lignes. Veuillez vérifier l'en-tête de votre fichier.");
        }

        // Conserver uniquement les lignes de données après l'en-tête
        const dataRows = allRows.slice(headerRowIndex + 1).filter(row => row.some(cell => cell !== ""));
        if (dataRows.length === 0) return 0; // Pas de données

        const tsSelect = timeStepSelect || document.getElementById('time-step-select');
        const pasDetecte = detecterPasDeTempsCourbe(dataRows);
        // 5 min (R63) n'est pas un pas de simulation : le serveur ramène la courbe au pas du sélecteur,
        // seul pas déclaré accepté ; l'énergie, elle, est sommée au pas réel du fichier.
        if (pasDetecte && pasDetecte !== 5) _pasParFichier.set(file, pasDetecte);
        const timeStepMinutes = pasDetecte || parseInt(tsSelect?.value) || 60;
        const dt = timeStepMinutes / 60.0;

        // Même lecture que le serveur (calcul_autoconso.parse_val) : virgule décimale acceptée, cellule
        // vide ou non numérique comptée 0. Auparavant UNE seule cellule invalide (vide, "NaN"...) faisait
        // échouer tout le fichier ("Erreur MWh") alors que le calcul ACC l'acceptait.
        const sommeColonne = (idx) => dataRows.reduce((acc, row) => {
            const brut = row[idx];
            const v = typeof brut === 'number' ? brut : parseFloat(String(brut).replace(',', '.').trim());
            if (Number.isFinite(v)) { acc.somme += v; acc.valides++; }
            return acc;
        }, { somme: 0, valides: 0 });

        const existante = sommeColonne(consIndex);
        if (existante.somme === 0) {
            // Même repli que le calcul ACC (calcul_acc.py) : export "Courbe_Charge_Bornes" sans conso
            // existante -> colonne Totale (existante + 2), puis IRVE (existante + 1).
            for (const idx of [consIndex + 2, consIndex + 1]) {
                const { somme } = sommeColonne(idx);
                if (somme > 0) return somme * dt;
            }
        }
        if (existante.valides === 0) {
            throw new Error("La colonne de consommation ne contient aucune valeur numérique.");
        }
        return existante.somme * dt;
    } catch (error) {
        console.error("Erreur de lecture du fichier de consommation:", error);
        _erreurParFichier.set(file, error.message);
        showMessage(`Erreur sur ${file.name}: ${error.message}`, "error");
        return null;
    }
}

/**
 * Met à jour le total des clés de répartition affiché.
 */
export function updateKeysTotal() {
    const totalSpan = document.getElementById('acc-keys-total');
    if (!totalSpan) return;

    let total = 0;
    document.querySelectorAll('.acc-key-input').forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    totalSpan.textContent = total.toFixed(2);
    totalSpan.style.color = Math.abs(total - 100) > 0.01 ? 'var(--danger-color)' : 'var(--success-color)';
    totalSpan.style.fontWeight = 'bold'; // Toujours en gras pour la visibilité
}

// Déclaration des constantes de profil à un niveau supérieur pour être accessibles par plusieurs fonctions
const profiles = ['Résidentiel', 'Tertiaire', 'Industriel', 'Collectivité', 'Agriculteur'];
const originalDefaultPrices = {
    'Résidentiel': { achat: 0.25, vente: 0.18 },
    'Tertiaire': { achat: 0.22, vente: 0.17 },
    'Industriel': { achat: 0.18, vente: 0.15 },
    'Collectivité': { achat: 0.20, vente: 0.16 },
    'Agriculteur': { achat: 0.19, vente: 0.16 },
};
let defaultPrices = JSON.parse(JSON.stringify(originalDefaultPrices));

/**
 * Réinitialise les prix par défaut du modal ACC à leurs valeurs d'origine.
 */
export function resetAccDefaultPrices() {
    defaultPrices = JSON.parse(JSON.stringify(originalDefaultPrices));
}


/**
 * Remplit le modal des paramètres économiques avec les données actuelles.
 * Cette fonction est ici car elle a besoin de `accConsFiles`.
 */
export function populateEconomicModal() {
    let savedParams = {};
    try { savedParams = JSON.parse(localStorage.getItem('economicParamsACC') || '{}') || {}; } catch (e) { /* cache illisible */ }
    const renseigne = (v) => v !== undefined && v !== null && v !== '';

    // Restaurer les prix des profils (repartis des valeurs d'origine : jamais ceux d'un autre projet)
    defaultPrices = JSON.parse(JSON.stringify(originalDefaultPrices));
    if (savedParams.profile_prices) {
        Object.keys(savedParams.profile_prices).forEach(profil => {
            if (defaultPrices[profil]) {
                defaultPrices[profil].achat = savedParams.profile_prices[profil].achat;
                defaultPrices[profil].vente = savedParams.profile_prices[profil].vente;
            }
        });
    }

    const tableBody = document.querySelector('#eco-participants-table tbody');
    tableBody.innerHTML = '';
    accConsFiles.forEach((data) => {
        const savedParticipant = savedParams.custom_prices?.[data.customName] || {};
        const selectedProfile = savedParticipant.profil || 'Résidentiel';

        const profilOptions = profiles.map(p => `<option value="${p}" ${p === selectedProfile ? 'selected' : ''}>${p}</option>`).join('');
        
        const prixProfil = defaultPrices[selectedProfile] || defaultPrices['Résidentiel'];
        const prixAchat = renseigne(savedParticipant.prix_achat) ? savedParticipant.prix_achat : prixProfil.achat;
        const prixVente = renseigne(savedParticipant.prix_vente_interne) ? savedParticipant.prix_vente_interne : prixProfil.vente;

        const row = `
            <tr data-participant-name="${data.customName}">
                <td>${data.customName}</td>
                <td><select class="profil-select">${profilOptions}</select></td>
                <td><input type="number" class="prix-achat-input eco-input" value="${prixAchat}" step="0.01"></td>
                <td><input type="number" class="prix-vente-interne-input eco-input" value="${prixVente}" step="0.01"></td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });

    // Attacher les écouteurs après la création des lignes
    attachEcoModalEvents();

    // Restaurer le mode de tarification (profil par défaut)
    const mode = savedParams.tariff_mode === 'custom' ? 'custom' : 'profile';
    const radio = document.querySelector(`input[name="eco_tariff_mode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    // Mettre à jour l'état initial
    updateTariffInputsState();
}

/**
 * Met à jour l'état (activé/désactivé) des inputs de tarif personnalisé. En mode profil, ces
 * colonnes sont masquées (main_autoconso.js::majAffichageModeTarif) et leurs valeurs conservées
 * telles quelles : elles ne sont plus remplacées par les tarifs du profil, ce qui effaçait les
 * tarifs personnalisés saisis dès qu'on revenait au mode profil.
 */
function updateTariffInputsState() {
    const useCustom = document.querySelector('input[name="eco_tariff_mode"][value="custom"]').checked;
    document.querySelectorAll('#eco-participants-table tbody tr').forEach(row => {
        row.querySelectorAll('input.eco-input').forEach(input => {
            input.disabled = !useCustom;
            input.style.backgroundColor = useCustom ? '' : '#e9ecef';
        });
    });
}

/**
 * Attache les événements pour le modal économique.
 */
function attachEcoModalEvents() {

    const profilesContainer = document.getElementById('eco-profiles-container');
    profilesContainer.innerHTML = '';
    profiles.forEach(p => {
        profilesContainer.innerHTML += `
            <div class="form-group">
                <label>${p}</label>
                <div class="input-pair">
                    <input type="number" class="profil-prix-achat eco-input" data-profil="${p}" value="${defaultPrices[p].achat}" step="0.01" title="Prix d'achat réseau pour le profil ${p}" placeholder="Achat réseau">
                    <input type="number" class="profil-prix-vente eco-input" data-profil="${p}" value="${defaultPrices[p].vente}" step="0.01" title="Prix de vente interne ACC pour le profil ${p}" placeholder="Vente interne">
                </div>
            </div>
        `;
    });


    // Événement sur le changement de mode (profil vs custom)
    document.querySelectorAll('input[name="eco_tariff_mode"]').forEach(radio => {
        radio.addEventListener('change', updateTariffInputsState);
    });

    // Événement sur le changement de profil d'un participant
    document.querySelectorAll('.profil-select').forEach(select => {
        select.addEventListener('change', () => {
            // Met à jour les inputs si on est en mode "profil"
            updateTariffInputsState();
        });
    });
}