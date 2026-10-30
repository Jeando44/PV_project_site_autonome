// =========================================================================
// IMPORT DES COURBES DE CHARGE (consommation ACI + production PV)
// =========================================================================
// Déplacé (pas copié) depuis main_autoconso.js dans le cadre du refactor "menu horizontal +
// centralisation des imports/Switchgrid" (Phase 4) : ce module est désormais la SEULE implémentation
// du rendu des zones d'import consommation individuelle (ACI) et production PV, partagée entre
// app_irve_v1.16.html (nouvelle section "Import CdC", cf. irve_import_cdc.js) et main_autoconso.js/
// index_autoconso.html (import existant, mode ACI). Le mode ACC continue d'utiliser directement
// renderAccConsumersInput exporté par main_acc.js (déjà un module séparé, pas de duplication
// nécessaire) — réexporté ici par simple confort d'import pour les deux pages hôtes.
//
// Aucune variable module-scope ne duplique consFileObject/pvFileObject : chaque sélection de fichier
// est persistée immédiatement dans IndexedDB (persistence.js, clés 'consFile'/'pvFile'), qui reste le
// seul pont vers calculateInternal() (main_autoconso.js, via initPersistence() au chargement de page).
// Les appelants qui ont besoin d'une référence synchrone immédiate (ex. calculateInternal(), qui lit
// un objet File en mémoire plutôt que de relire IndexedDB à chaque calcul) fournissent un callback
// onFileSelected/onFileRemoved pour maintenir leur propre état, sans que ce module en ait besoin.

import { saveFileToIDB, getFileFromIDB, deleteFileFromIDB, saveConsFileToIDBAndDB, deleteConsFileFromDB, restoreConsFileFromDBIfMissing } from '../prodsolaire/persistence.js';
import { renderAccConsumersInput, restoreAccFilesFromIDB } from '../prodsolaire/main_acc.js?v=2';
import { detecterPasDeTempsCourbe } from '../prodsolaire/pas_de_temps_courbe.js';
import { lireEnergiesCourbeAci, texteEnergiesLues } from '../prodsolaire/energie_courbe_import.js';

export { renderAccConsumersInput, restoreAccFilesFromIDB, showMessage as afficherMessageImport };

// ─── Message minimal ───────────────────────────────────────────────────────────
// Implémentation propre à ce module (même convention que switchgrid_data.js) : ne dépend pas d'un
// showMessage global défini différemment selon la page hôte (signatures différentes entre
// main_autoconso.js et calcul_irve.js). Les deux pages hôtes possèdent déjà un #message-area au même
// gabarit CSS.
let _messageAreaTimeout = null;
function showMessage(text, type = 'info', duration = 3000) {
    const messageArea = document.getElementById('message-area');
    if (!messageArea) return;
    if (_messageAreaTimeout) { clearTimeout(_messageAreaTimeout); _messageAreaTimeout = null; }
    messageArea.textContent = text;
    messageArea.className = type === 'error' ? 'error' : '';
    messageArea.classList.add('visible');
    messageArea.style.display = 'block';
    _messageAreaTimeout = setTimeout(() => {
        messageArea.classList.remove('visible');
        messageArea.style.display = 'none';
    }, duration);
}

// ─── Courbe IRVE synchronisée (proposée comme consommation par défaut en mode ACI) ────────────────
let _sharedIrveCurveCache = null;

/**
 * Lit la courbe de charge IRVE déjà calculée pour ce projet (base de données), pour l'utiliser comme
 * consommation par défaut (ou à combiner) en mode ACI. Également utilisée directement par
 * calculateInternal() (main_autoconso.js) au moment du calcul, pour une lecture fraîche.
 */
export async function fetchSharedIrveCurve() {
    const projetId = localStorage.getItem('current_projet_id');
    if (!projetId) { _sharedIrveCurveCache = null; return null; }

    try {
        const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/irve/load`);
        const res = await response.json();
        const curve = res.success && res.config_exists ? res.config.load_curve : null;
        if (curve && Array.isArray(curve.existing) && curve.existing.length > 0) {
            _sharedIrveCurveCache = {
                pasTempsMin: curve.pas_temps_min || 60,
                existing: curve.existing,
                irve: curve.irve,
                total: curve.total,
                hasExisting: !!curve.has_existing,
                annee: curve.annee || null,
                // Empreinte de la courbe enregistrée (bilan + date) : change à chaque nouveau calcul IRVE.
                bilanIrveKwh: curve.bilan_irve_kwh ?? null,
                enregistreLe: curve.enregistre_le || null
            };
            return _sharedIrveCurveCache;
        }
    } catch (e) {
        console.warn('[IrveImport] Erreur lecture de la courbe IRVE en base de données', e);
    }
    _sharedIrveCurveCache = null;
    return null;
}

/**
 * Supprime la courbe IRVE synchronisée du projet actif (base de données), pour qu'elle ne soit plus
 * reprise au calcul (demande explicite : une courbe supprimée ne doit pas réapparaître). Utilisée
 * par le bouton ✕ de l'import de consommation et par le module IRVE quand il ne reste plus de borne.
 * @param {string|number} [projetIdOverride] - projet visé (défaut : projet actif)
 * @returns {Promise<boolean>} true si la suppression a abouti
 */
export async function deleteSharedIrveCurve(projetIdOverride) {
    _sharedIrveCurveCache = null;
    const projetId = projetIdOverride || localStorage.getItem('current_projet_id');
    if (!projetId) return false;
    try {
        const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/irve/curve`, { method: 'DELETE' });
        const res = await response.json().catch(() => ({}));
        return response.ok && !!res.success;
    } catch (e) {
        console.warn('[IrveImport] Erreur suppression de la courbe IRVE en base de données', e);
        return false;
    }
}

// ─── Courbe PAC / climatiseur (module Irve/pac_climatisation/, enregistrée en base) ─────────────────
let _sharedPacCurveCache = null;
const clePacCombine = (projetId) => `pac_combine_${projetId}`;

/**
 * Description de la courbe PAC enregistrée pour le projet (sans les séries) : le serveur la lit en
 * base au calcul, comme la courbe IRVE. null si aucune.
 */
export async function fetchSharedPacCurve() {
    const projetId = localStorage.getItem('current_projet_id');
    if (!projetId) { _sharedPacCurveCache = null; return null; }
    try {
        const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/pac/curve-info`);
        const res = await response.json();
        const c = res.success ? res.courbe : null;
        _sharedPacCurveCache = c ? {
            pasTempsMin: c.pas_temps_min,
            annee: c.annee,
            bilanPacKwh: c.bilan_pac_kwh,
            enregistreLe: c.enregistre_le,
            resume: c.resume || {},
            varianteEcsSolaire: !!c.variante_ecs_solaire,
        } : null;
    } catch (e) {
        console.warn('[IrveImport] Lecture de la courbe PAC impossible', e);
        _sharedPacCurveCache = null;
    }
    return _sharedPacCurveCache;
}

export async function deleteSharedPacCurve() {
    _sharedPacCurveCache = null;
    const projetId = localStorage.getItem('current_projet_id');
    if (!projetId) return false;
    try {
        const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/pac/curve`, { method: 'DELETE' });
        const res = await response.json().catch(() => ({}));
        return response.ok && !!res.success;
    } catch (e) {
        return false;
    }
}

/** Case « Ajouter la courbe PAC » : cochée par défaut, choix mémorisé par projet. */
export function pacCombineeChoisie() {
    const caseEl = document.getElementById('cons-combine-pac');
    return !!(caseEl && caseEl.checked);
}

// Courbe supprimée par le module IRVE (plus aucune borne, cf. calcul_irve.js::removeRow) : la zone
// d'import déjà affichée sur la page ne doit plus la présenter. Un seul écouteur (module chargé une
// fois), qui retrouve les éléments par id à chaque événement — ils sont recréés à chaque rendu.
document.addEventListener('irveCourbeSupprimee', () => {
    _sharedIrveCurveCache = null;
    const display = document.getElementById('cons-filename-display');
    if (display && display.textContent.includes('IRVE')) {
        display.textContent = 'Aucun fichier';
        display.style.color = '';
        const conteneur = document.getElementById('cons-filename-display-container');
        if (conteneur) conteneur.style.display = 'none';
    }
    const combine = document.getElementById('cons-combine-irve');
    if (combine) combine.checked = false;
    const label = document.getElementById('cons-combine-irve-label');
    if (label) label.style.display = 'none';
});

// ─── Détection du pas de temps d'une courbe importée ─────────────────────────────────────────────
// Règle commune à tous les imports (dates d'abord, nombre de lignes en dernier recours), cf.
// prodsolaire/pas_de_temps_courbe.js.
export { detecterPasDeTempsCourbe };

/** Lit un fichier Excel/CSV de courbe (4 lignes d'en-tête, comme le serveur) et en déduit le pas. */
export async function lirePasDeTempsFichier(file) {
    try {
        if (!file || typeof XLSX === 'undefined') return null;
        const classeur = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
        const feuille = classeur.Sheets[classeur.SheetNames[0]];
        const lignes = XLSX.utils.sheet_to_json(feuille, { header: 1, raw: true, defval: '' }).slice(4);
        return detecterPasDeTempsCourbe(lignes);
    } catch (e) {
        console.warn('[IrveImport] Pas de temps du fichier non détecté', e);
        return null;
    }
}

// ─── Import consommation (mode ACI : fichier Excel unique, 3 courbes) ─────────────────────────────
/**
 * @param {HTMLElement} container - conteneur où injecter le HTML (ex. #cons-input-container)
 * @param {Object} [options]
 * @param {(file: File) => void} [options.onFileSelected] - appelé après sauvegarde IDB, sur sélection utilisateur
 * @param {() => void} [options.onFileRemoved] - appelé après suppression du fichier
 * @param {HTMLSelectElement|null} [options.timeStepSelect] - select de pas de temps à aligner sur la courbe IRVE (déduit de #time-step-select si absent)
 */
export function renderAciConsumerInput(container, options = {}) {
    if (!container) return;
    const { onFileSelected = null, onFileRemoved = null, timeStepSelect: timeStepSelectOverride = null } = options;

    container.innerHTML = `
        <div class="file-buttons">
            <label for="cons-file-hidden" class="btn-primary" style="display: flex; align-items: center; justify-content: center; width: 100%;">Importer fichier Excel (3 courbes)</label>
            <input type="file" id="cons-file-hidden" accept=".xlsx" style="display: none;">
        </div>
        <div id="cons-filename-display-container" style="display: none; justify-content: space-between; align-items: center; padding: 0.5rem 0.8rem; border: 1px dashed var(--border-color); border-radius: var(--border-radius-md);">
            <span id="cons-filename-display">Aucun fichier</span>
            <button type="button" id="cons-remove-btn" class="btn-danger" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">✕</button>
        </div>
        <div id="cons-energie-lue" style="display: none; margin-top: 0.35rem; font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);"></div>
        <label id="cons-combine-irve-label" style="display: none; align-items: center; gap: 0.5rem; margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary); cursor: pointer;">
            <input type="checkbox" id="cons-combine-irve" style="width: auto; height: auto;">
            Ajouter la courbe de charge IRVE synchronisée à cette consommation existante (Enedis)
        </label>
        <label id="cons-combine-pac-label" style="display: none; align-items: center; gap: 0.5rem; margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary); cursor: pointer;">
            <input type="checkbox" id="cons-combine-pac" style="width: auto; height: auto;">
            <span id="cons-combine-pac-texte">Ajouter la consommation PAC / climatiseur simulée</span>
        </label>
    `;

    const display = document.getElementById('cons-filename-display');
    const displayContainer = document.getElementById('cons-filename-display-container');

    // Somme de la consommation lue dans le fichier importé (comme l'ACC) : c'est elle que le tableau
    // récapitulatif doit afficher, tout écart bloquant l'étude (cf. energie_courbe_import.js).
    const energieLue = document.getElementById('cons-energie-lue');
    let lectureEnCours = 0;
    const afficherEnergieLue = async (file) => {
        const jeton = ++lectureEnCours;
        if (!energieLue) return;
        if (!file) { energieLue.style.display = 'none'; energieLue.textContent = ''; return; }
        const selectPas = timeStepSelectOverride || document.getElementById('time-step-select');
        try {
            const lecture = await lireEnergiesCourbeAci(file, parseInt(selectPas?.value, 10) || 60);
            if (jeton !== lectureEnCours) return;
            energieLue.textContent = texteEnergiesLues(lecture);
            energieLue.style.color = 'var(--text-secondary)';
        } catch (e) {
            if (jeton !== lectureEnCours) return;
            energieLue.textContent = `Consommation illisible : ${e.message}`;
            energieLue.style.color = 'var(--danger-color)';
        }
        energieLue.style.display = 'block';
    };

    document.getElementById('cons-file-hidden')?.addEventListener('change', async function () {
        if (this.files.length > 0) {
            const file = this.files[0];
            // Pas de temps aligné sur celui de la courbe importée (10/15/30/60 min) AVANT la
            // sauvegarde, dont le serveur revalide la longueur avec ce pas : calculer à un pas plus
            // grossier moyennerait la courbe (pics lissés, autoconsommation et stockage faussés), à
            // un pas plus fin il l'interpolerait sans rien apporter.
            const selectPas = timeStepSelectOverride || document.getElementById('time-step-select');
            const pasFichier = await lirePasDeTempsFichier(file);
            if (selectPas && pasFichier && String(pasFichier) !== selectPas.value
                && Array.from(selectPas.options).some(o => o.value === String(pasFichier))) {
                selectPas.value = String(pasFichier);
                selectPas.dispatchEvent(new Event('change'));
                showMessage(`Pas de temps aligné automatiquement sur la courbe importée (${pasFichier} min).`, 'info', 5000);
            } else if (pasFichier === 5) {
                showMessage(`Courbe au pas de 5 min : elle sera ramenée par moyenne au pas de simulation choisi (${selectPas?.value || 60} min).`, 'info', 6000);
            }
            // NOUVEAU (persistance CDC en base) : la CDC importée manuellement est désormais aussi
            // sauvegardée côté serveur, associée au projet actif (source='import') — en plus de
            // l'IndexedDB locale (inchangé). Le pas de temps déclaré ici sert au serveur à revalider
            // la longueur attendue du fichier.
            const timeStepSelect = timeStepSelectOverride || document.getElementById('time-step-select');
            saveConsFileToIDBAndDB(file, 'import', showMessage, timeStepSelect?.value);
            display.textContent = file.name;
            display.style.color = '';
            displayContainer.style.display = 'flex';
            afficherEnergieLue(file);
            this.value = '';
            onFileSelected?.(file);
        }
    });

    // CORRECTIF (bug rapporté : « je supprime la courbe IRVE synchronisée, elle réapparaît au
    // calcul ») : le ✕ supprime ce qui est affiché. Un fichier importé est supprimé (IndexedDB +
    // base) ; s'il reste une courbe IRVE en base, elle est alors affichée (et non masquée en
    // silence, puisque le calcul la reprendrait) — un second ✕ la supprime à son tour, en base,
    // donc aussi pour l'autre page (modal IRVE / autoconsommation).
    document.getElementById('cons-remove-btn')?.addEventListener('click', async () => {
        const fichier = await getFileFromIDB('consFile');
        if (fichier) {
            await deleteFileFromIDB('consFile');
            await deleteConsFileFromDB();
            afficherEnergieLue(null);
            display.textContent = 'Aucun fichier';
            displayContainer.style.display = 'none';
            onFileRemoved?.();
            showMessage('Fichier de consommation supprimé.');
            const courbe = await fetchSharedIrveCurve();
            if (courbe) {
                display.textContent = '✅ Courbes IRVE synchronisées';
                display.style.color = 'var(--success-color)';
                displayContainer.style.display = 'flex';
            }
            return;
        }
        if (!(await fetchSharedIrveCurve()) && await fetchSharedPacCurve()) {
            // Seule la courbe PAC était affichée : c'est elle que le ✕ supprime.
            const okPac = await deleteSharedPacCurve();
            display.textContent = 'Aucun fichier';
            display.style.color = '';
            displayContainer.style.display = 'none';
            const labelPac = document.getElementById('cons-combine-pac-label');
            if (labelPac) labelPac.style.display = 'none';
            onFileRemoved?.();
            showMessage(okPac ? 'Courbe PAC / climatiseur supprimée.' : 'Échec de la suppression de la courbe PAC.', okPac ? 'info' : 'error');
            return;
        }
        const ok = await deleteSharedIrveCurve();
        display.textContent = 'Aucun fichier';
        display.style.color = '';
        displayContainer.style.display = 'none';
        const combine = document.getElementById('cons-combine-irve');
        if (combine) combine.checked = false;
        const label = document.getElementById('cons-combine-irve-label');
        if (label) label.style.display = 'none';
        onFileRemoved?.();
        showMessage(ok ? 'Courbe de charge IRVE synchronisée supprimée.' : 'Échec de la suppression de la courbe IRVE.', ok ? 'info' : 'error');
    });

    // Affiche le fichier déjà présent en IndexedDB, le cas échéant (persistant entre deux rendus/pages) —
    // remplace l'ancien contrôle synchrone sur une variable module-scope par une lecture IndexedDB unique,
    // réutilisée ensuite pour décider si la courbe IRVE doit se proposer en remplacement (ci-dessous).
    // La CDC du projet actif enregistrée en base est d'abord restaurée si l'IndexedDB est vide ou
    // appartient à un autre projet (cf. persistence.js::restoreConsFileFromDBIfMissing).
    const consFilePromise = restoreConsFileFromDBIfMissing().then(() => getFileFromIDB('consFile'));
    consFilePromise.then((file) => {
        if (file) {
            display.textContent = file.name;
            displayContainer.style.display = 'flex';
        }
        afficherEnergieLue(file);
    });

    // CORRECTIF (un seul appel réseau, au lieu de deux fetchSharedIrveCurve() redondants) : gère à
    // la fois l'affichage "✅ Courbes IRVE synchronisées" (si aucun fichier importé), la case à
    // cocher "Ajouter la courbe IRVE" (combinaison avec Enedis), et la sélection AUTOMATIQUE du pas
    // de temps ACI sur celui de la courbe IRVE.
    const applyIrveCurveToUI = async (curve) => {
        if (!curve) return;
        const existing = await consFilePromise;
        if (!existing) {
            display.textContent = '✅ Courbes IRVE synchronisées';
            display.style.color = 'var(--success-color)';
            displayContainer.style.display = 'flex';
        }
        const label = document.getElementById('cons-combine-irve-label');
        if (label) label.style.display = 'flex';

        const timeStepSelect = timeStepSelectOverride || document.getElementById('time-step-select');
        if (timeStepSelect && String(curve.pasTempsMin) !== timeStepSelect.value) {
            timeStepSelect.value = String(curve.pasTempsMin);
            showMessage(`Pas de temps aligné automatiquement sur la courbe IRVE synchronisée (${curve.pasTempsMin} min).`, 'info', 4000);
        }
    };
    if (_sharedIrveCurveCache) applyIrveCurveToUI(_sharedIrveCurveCache);
    const irvePromise = fetchSharedIrveCurve().then((c) => { applyIrveCurveToUI(c); return c; });

    // Courbe PAC du projet : case « Ajouter » (cochée par défaut, choix mémorisé par projet) ; si
    // c'est la seule consommation disponible, elle est affichée comme la courbe IRVE et utilisée.
    fetchSharedPacCurve().then(async (pac) => {
        const label = document.getElementById('cons-combine-pac-label');
        const caseEl = document.getElementById('cons-combine-pac');
        if (!pac || !label || !caseEl) return;
        const projetId = localStorage.getItem('current_projet_id');
        const memo = projetId ? localStorage.getItem(clePacCombine(projetId)) : null;
        caseEl.checked = memo === null ? true : memo === '1';
        caseEl.addEventListener('change', () => { if (projetId) localStorage.setItem(clePacCombine(projetId), caseEl.checked ? '1' : '0'); });
        const kwh = Math.round(pac.bilanPacKwh || 0).toLocaleString('fr-FR');
        const texte = document.getElementById('cons-combine-pac-texte');
        if (texte) texte.textContent = `Ajouter la consommation PAC / climatiseur simulée (${kwh} kWh/an, pas de ${pac.pasTempsMin} min)`;
        label.style.display = 'flex';
        const [fichier, irve] = await Promise.all([consFilePromise, irvePromise]);
        if (!fichier && !irve) {
            display.textContent = '✅ Courbe PAC / climatiseur synchronisée';
            display.style.color = 'var(--success-color)';
            displayContainer.style.display = 'flex';
            const timeStepSelect = timeStepSelectOverride || document.getElementById('time-step-select');
            if (timeStepSelect && String(pac.pasTempsMin) !== timeStepSelect.value) {
                timeStepSelect.value = String(pac.pasTempsMin);
                showMessage(`Pas de temps aligné automatiquement sur la courbe PAC (${pac.pasTempsMin} min).`, 'info', 4000);
            }
        }
    });
}

// ─── Import production (courbe PV) ─────────────────────────────────────────────────────────────────
/**
 * @param {HTMLElement} container - conteneur où injecter le HTML (ex. #pv-input-group-content)
 * @param {Object} [options]
 * @param {(file: File) => void} [options.onFileSelected]
 * @param {() => void} [options.onFileRemoved]
 * @param {boolean} [options.showPvgisButton=true] - bouton "Générer une courbe de charge" (nécessite le modal PVGIS de la page hôte)
 * @param {() => void} [options.onPvgisClick]
 * @param {boolean} [options.showSansPvButton=true] - bouton "Optimisation HC/HP - Sans PV" (nécessite calculateInternal() de la page hôte)
 * @param {() => void} [options.onSansPvClick]
 * @param {boolean} [options.goldButton=false] - fond jaune doré pour le bouton "Importer un fichier"
 *   (demande explicite pour la section "Import CdC" de l'IRVE, afin de le distinguer visuellement du
 *   bouton d'import de la courbe de consommation) — n'affecte pas l'apparence par défaut (main_autoconso.js).
 */
export function renderPvInput(container, options = {}) {
    if (!container) return;
    const {
        onFileSelected = null,
        onFileRemoved = null,
        showPvgisButton = true,
        onPvgisClick = null,
        showSansPvButton = true,
        onSansPvClick = null,
        goldButton = false,
    } = options;

    const importBtnStyle = goldButton
        ? 'flex-grow: 1; text-align: center; background-color: #eab308; border-color: #ca8a04; color: #1f2937;'
        : 'flex-grow: 1; text-align: center;';

    container.innerHTML = `
        <div class="file-buttons">
            <label for="pv-file-hidden" class="btn-primary" style="${importBtnStyle}">Importer la courbe de production</label>
            ${showPvgisButton ? `<button type="button" id="open-pvgis-modal-btn" class="btn-secondary">Générer une courbe de charge</button>` : ''}
        </div>
        <input type="file" id="pv-file-hidden" accept=".csv, .txt, .xlsx" style="display: none;">
        <div id="pv-filename-display-container" style="display: none; justify-content: space-between; align-items: center; padding: 0.5rem 0.8rem; border: 1px dashed var(--border-color); border-radius: var(--border-radius-md);">
            <span id="pv-filename-display">Aucun fichier</span>
            <button type="button" id="pv-remove-btn" class="btn-danger" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">✕</button>
        </div>
        ${showSansPvButton ? `<button type="button" id="launch-sans-pv-btn" class="btn-secondary" style="width: 100%; border: 1px dashed var(--border-color); font-weight: 600;">🌙 Optimisation HC/HP - Sans PV</button>` : ''}
    `;

    const display = document.getElementById('pv-filename-display');
    const displayContainer = document.getElementById('pv-filename-display-container');

    getFileFromIDB('pvFile').then((file) => {
        if (file) {
            display.textContent = file.name;
            displayContainer.style.display = 'flex';
        }
    });

    document.getElementById('pv-file-hidden')?.addEventListener('change', function () {
        if (this.files.length > 0) {
            const file = this.files[0];
            saveFileToIDB('pvFile', file);
            display.textContent = file.name;
            displayContainer.style.display = 'flex';
            this.value = '';
            onFileSelected?.(file);
        }
    });

    document.getElementById('pv-remove-btn')?.addEventListener('click', async () => {
        await deleteFileFromIDB('pvFile');
        display.textContent = 'Aucun fichier';
        display.style.color = '';
        displayContainer.style.display = 'none';
        displayContainer.style.borderColor = '';
        const fileBtns = container.querySelector('.file-buttons');
        if (fileBtns) fileBtns.style.display = 'flex';
        onFileRemoved?.();
        showMessage('Fichier de production PV supprimé. La production sera recalculée automatiquement.');
    });

    if (showPvgisButton) {
        document.getElementById('open-pvgis-modal-btn')?.addEventListener('click', () => onPvgisClick?.());
    }
    if (showSansPvButton) {
        document.getElementById('launch-sans-pv-btn')?.addEventListener('click', () => onSansPvClick?.());
    }
}
