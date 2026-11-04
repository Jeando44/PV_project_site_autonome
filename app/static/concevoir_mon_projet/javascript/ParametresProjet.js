/*
  NOTES JS (CORRIGÉES V2) :
  - Bug de redimensionnement (Tâche 2.2) :
    - `isResizing` et `isDragging` ont été déplacés du scope local de 'initModalDragResize'
      vers des propriétés de la classe UIManager (`this.isResizing`).
    - 'handleBackdropClick' vérifie maintenant `this.isResizing` et `this.isDragging`
      avant de fermer le modal, ce qui corrige le bug de fermeture au premier clic
      sur la poignée de redimensionnement.
  - 'setupCardSelections' (Tâche 3.2) : Logique de multi-sélection (max 3) pour
    '.option-card' conservée.
*/

// Renvoie la date de création du projet (indice A) : si elle a déjà été persistée (projet existant
// rouvert un autre jour), on la restaure telle quelle plutôt que de la réécraser avec la date du
// jour — sinon la date de création "dérivait" à chaque rechargement de page/ouverture de la modale
// Indices, et c'est cette date erronée qui finissait par être envoyée dans le rapport (StorageManager.js
// relit ensuite cette cellule du DOM à chaque sauvegarde via getIndicesRevisionFromTable()).
function getOrInitFirstIndiceDate() {
    try {
        const projectData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        const indices = projectData.indicesRevision;
        if (Array.isArray(indices) && indices.length > 0 && indices[0] && indices[0].date) {
            return indices[0].date;
        }
    } catch (e) { }
    return new Date().toLocaleDateString('fr-FR'); // Nouveau projet : date de création = date du jour
}

// Affiche le message "Vous devez créer ou sélectionner un projet avant de continuer." au centre
// du modal (cf. .active-project-required-message dans ParametresProjet.css), à la place d'un
// alert() natif. Exposée sur window pour être réutilisable depuis d'autres scripts (ex.
// menu_list.js / EtudesEconomiqueModal.js pour le blocage du lien "Étude économique").
let activeProjectRequiredMessageTimer = null;
function showActiveProjectRequiredMessage(text) {
    const msg = document.getElementById('active-project-required-message');
    if (!msg) {
        alert(text || 'Vous devez créer ou sélectionner un projet avant de continuer.');
        return;
    }
    const textEl = msg.querySelector('span');
    if (textEl && text) textEl.textContent = text;

    msg.classList.add('show');
    clearTimeout(activeProjectRequiredMessageTimer);
    activeProjectRequiredMessageTimer = setTimeout(() => {
        msg.classList.remove('show');
    }, 3000);
}
window.showActiveProjectRequiredMessage = showActiveProjectRequiredMessage;

// ============================================================================================
// VARIANTES DE PROJET (A, B, C, D) — reprise 2026-10-09
// ============================================================================================
// Avant la génération du rapport, la configuration est enregistrée dans une variante : la 1re fois
// dans A, ensuite dans la variante active, ou dans une nouvelle variante (« Créer une variante à
// partir du projet ») ; le cartouche du rapport porte sa lettre (ExportService.exportPDF). Le serveur choisit toujours la lettre et capture l'état complet depuis la base
// (app/services/variantes_projet.py) : le navigateur doit donc tout enregistrer avant
// (syncAllProjectDataToDatabase). Ouverture d'une variante : pastilles A-D de « Mes projets »
// (parametreProjetFormManager.js).

// Libellé court d'une variante (A-D) : même limite que le serveur (projets_revisions.libelle,
// app/services/variantes_projet.py::nettoyer_libelle).
export const LIBELLE_VARIANTE_MAX = 30;

export class UIManager {
    constructor() {
        this.currentSection = 'mes_projets';
        this.justResizedOrDragged = false; // Flag pour le bug de resize/close

        // CORRECTION : Déplacer les états de drag/resize au niveau de la classe
        this.isDragging = false;
        this.isResizing = false;
        this.isVersioningModalOpen = false;

        this.init();
        this.initModalDragResize();
        this.setupCustomEvents();
        // NOTE : l'ancienne interception générique de clic (setupVersioningInterception, cf. historique
        // git) a été retirée — ses sélecteurs (#close-modal-btn, [data-action="close-modal"],
        // .tab-button/.tab-link/.nav-link) sont réutilisés par une quinzaine de modales sans rapport avec
        // le rapport (IRVE, ombrière métal/bois/solumbra, liste de matériels...), ce qui déclenchait la
        // modale de versioning n'importe où dans l'application. Le déclenchement se fait maintenant
        // directement et explicitement depuis navigation-modales.js (ModalNavigator.executeStep), qui
        // sait précisément quand l'utilisateur quitte l'étape "Rapport".
    }

    init() {
        this.setupNavigation();
        this.setupUIInteractions();
        this.setupModals();
        // this.loadProjects();
        this.setupStudyTypeSelection();
        this.setupIRVEAndValorisation();
    }

    /**
     * Pousse en base TOUTES les sources de données vivantes du projet (calepinage, étude
     * économique, IRVE) avant qu'un indice ne soit figé/mis à jour.
     *
     * CORRECTIF (bug "copies identiques"/"indice parent non sauvegardé") : save_project_revision
     * (backend) construit l'instantané d'un indice à partir des colonnes ACTUELLEMENT en base
     * (ParametreProjet.calepinage_data, GeometrieProjet, IrveConfig, EtudeEconomiqueConfig) — jamais
     * d'un payload envoyé à ce moment-là. Or les routes /etude-economique/save et /irve/save
     * existaient côté backend mais n'étaient appelées par AUCUN code frontend : les données
     * économiques et IRVE ne quittaient donc jamais localStorage, et chaque nouvel indice
     * capturait des colonnes IrveConfig/EtudeEconomiqueConfig vides ou obsolètes — ce qui, combiné
     * à un calepinage lui aussi obsolète (cf. saveToDatabase ci-dessous), donnait l'impression que
     * tous les indices étaient des copies identiques (aucune des trois sources n'était jamais à
     * jour au moment de la capture).
     * @param {string|number} projectId
     */
    async syncAllProjectDataToDatabase(projectId) {
        // Liste unique des sources (Paramètres du projet, calepinages, Loi APER, devis CAPEX/OPEX,
        // étude économique) : services/sauvegarde_projet.js, partagé avec l'icône « Sauvegarder » et
        // le changement de projet. Tout échec bloque la variante et le rapport (décision 2026-10-17 :
        // un rapport ne doit jamais décrire un état absent de la base).
        if (window.SauvegardeProjet && typeof window.SauvegardeProjet.enregistrerDonnees === 'function') {
            const res = await window.SauvegardeProjet.enregistrerDonnees();
            if (!res.ok) return { ok: false, message: res.message || "Le projet n'a pas pu être enregistré." };
            return { ok: true };
        }
        console.warn('[UIManager] services/sauvegarde_projet.js absent : données non synchronisées pour le projet', projectId);
        return { ok: false, message: "Enregistrement du projet indisponible : rechargez la page." };
    }

    /**
     * Choix de la variante AVANT la génération du rapport (ExportService.exportPDF) : enregistre la
     * configuration et renvoie {indice} (lettre à imprimer dans le cartouche), ou null si
     * l'utilisateur annule ou si l'enregistrement échoue (le rapport n'est alors pas généré).
     * Sans projet actif : {indice: null} (rapport généré sans variante).
     */
    async demanderVarianteRapport() {
        const projectId = window.calepinageService && window.calepinageService.getCurrentProjetId();
        if (!projectId) return { indice: null };

        let etat;
        try {
            // Pousser toutes les données vivantes en base AVANT la capture (faite côté serveur).
            const synchro = await this.syncAllProjectDataToDatabase(projectId);
            if (synchro && synchro.ok === false) {
                this.showSuccessNotification(`${synchro.message} Rapport non généré.`, 'danger');
                return null;
            }
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}/revisions`);
            etat = await response.json();
        } catch (error) {
            console.error('Lecture des variantes impossible :', error);
            etat = null;
        }
        if (!etat || !etat.success) {
            this.showSuccessNotification((etat && etat.message) || 'Impossible de lire les variantes du projet : rapport non généré.', 'danger');
            return null;
        }

        const choix = await new Promise((resolve) => this.showVersioningModal(etat, resolve, 'rapport'));
        if (!choix || choix.skip) return null;
        const res = await this.enregistrerVariante(projectId, choix.action, choix);
        return res ? { indice: res.active_indice } : null;
    }

    /**
     * Icône « Sauvegarder » (services/sauvegarde_projet.js) : choix de la variante à enregistrer quand
     * le projet en a déjà au moins une. Renvoie {action, indice, libelle}, null si l'utilisateur
     * annule, {aucune: true} si le projet n'a pas encore de variante (rien à choisir).
     * @param {{revisions: Array, active_indice: ?string, next_suggested: ?string}} etat - réponse de /revisions
     */
    async choisirVarianteSauvegarde(etat) {
        if (!etat || !Array.isArray(etat.revisions) || etat.revisions.length === 0) return { aucune: true };
        const choix = await new Promise((resolve) => this.showVersioningModal(etat, resolve, 'sauvegarde'));
        return (!choix || choix.skip) ? null : choix;
    }

    /**
     * Enregistre l'état du projet (déjà en base) dans une variante.
     * @param {'enregistrer'|'creer_variante'|'ecraser'} action - 'enregistrer' : A s'il n'existe aucune
     *   variante, sinon la variante active ; 'creer_variante' : lettre libre suivante (si A existe) ;
     *   'ecraser' : variante existante `options.indice`, qui devient la variante ouverte.
     * @param {{indice?: string, libelle?: string}} [options] - libelle absent = libellé inchangé.
     * @returns {Promise<object|null>} réponse du serveur, null en cas d'échec (déjà signalé).
     */
    async enregistrerVariante(projectId, action, options = {}) {
        try {
            const corps = { action };
            if (action === 'ecraser') corps.indice = options.indice;
            if (typeof options.libelle === 'string') corps.libelle = options.libelle;
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}/revision/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corps)
            });
            const res = await response.json();
            if (!res.success) {
                this.showSuccessNotification(res.message || "La variante n'a pas pu être enregistrée.", 'danger');
                return null;
            }
            this.showSuccessNotification(res.message);
            document.dispatchEvent(new CustomEvent('varianteActiveChangee', {
                detail: { projetId: String(projectId), indice: res.active_indice }
            }));
            return res;
        } catch (err) {
            console.error("Erreur lors de l'enregistrement de la variante :", err);
            this.showSuccessNotification("Erreur de connexion : la variante n'a pas été enregistrée.", 'danger');
            return null;
        }
    }

    /**
     * Fenêtre de choix de la variante à enregistrer (fermer = annuler).
     *  - mode 'rapport' : avant la génération du rapport (aucune variante -> la variante A est créée) ;
     *  - mode 'sauvegarde' : icône « Sauvegarder » (seulement si le projet a déjà une variante).
     * Liste toutes les variantes : la variante ouverte est présélectionnée (mise à jour) ; en choisir une
     * autre l'ÉCRASE (confirmation dans la fenêtre) et l'ouvre ; ou créer la lettre libre suivante.
     * Libellé court facultatif (LIBELLE_VARIANTE_MAX caractères, contrôlé aussi par le serveur).
     * @param {{revisions: Array, active_indice: ?string, next_suggested: ?string}} etat - réponse de /revisions
     * @param {function({skip: boolean, action?: string, indice?: string, libelle?: string})} onChoice
     * @param {'rapport'|'sauvegarde'} [mode]
     */
    showVersioningModal(etat, onChoice, mode = 'rapport') {
        if (this.isVersioningModalOpen) {
            onChoice({ skip: true });
            return;
        }
        this.isVersioningModalOpen = true;
        const LIBELLE_MAX = LIBELLE_VARIANTE_MAX;
        const NOUVELLE = '__nouvelle__';

        if (!document.getElementById('versioning-modal-styles')) {
            const style = document.createElement('style');
            style.id = 'versioning-modal-styles';
            style.textContent = `
                .versioning-modal-overlay {
                    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                    background-color: rgba(0, 0, 0, 0.5); display: flex;
                    align-items: center; justify-content: center; z-index: 2147483647;
                    backdrop-filter: blur(3px); font-family: 'Inter', sans-serif;
                }
                .versioning-modal-box {
                    background: #fff; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.15);
                    width: 540px; max-width: 92%; max-height: 92vh; overflow: auto; border-top: 5px solid #dc2626;
                    animation: slideDownVersioning 0.3s ease-out;
                }
                @keyframes slideDownVersioning {
                    from { transform: translateY(-20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                .versioning-modal-header {
                    padding: 15px 20px; border-bottom: 1px solid #e5e7eb;
                    display: flex; justify-content: space-between; align-items: center;
                }
                .versioning-modal-header h4 { margin: 0; color: #1f2937; font-size: 1.15rem; font-weight: 600; }
                .versioning-modal-close { background: none; border: none; font-size: 24px; cursor: pointer; color: #9ca3af; }
                .versioning-modal-body { padding: 18px 20px; color: #374151; font-size: 0.95rem; line-height: 1.5; text-align: left; }
                .versioning-modal-body > p { margin: 0 0 10px; }
                .versioning-options { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
                .versioning-section-titre { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #6b7280; margin: 6px 0 0; }
                .versioning-option-card {
                    border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px;
                    display: flex; align-items: flex-start; gap: 10px; cursor: pointer;
                    transition: border-color 0.2s, background-color 0.2s;
                }
                .versioning-option-card:hover { border-color: #dc2626; background-color: #fef2f2; }
                .versioning-option-card.selectionnee { border-color: #dc2626; background-color: #fef2f2; }
                .versioning-option-card.disabled { opacity: 0.5; cursor: not-allowed; }
                .versioning-option-card.disabled:hover { border-color: #e5e7eb; background-color: transparent; }
                .versioning-option-card input[type="radio"] { margin-top: 4px; accent-color: #dc2626; cursor: pointer; }
                .versioning-option-card.disabled input[type="radio"] { cursor: not-allowed; }
                .versioning-option-card label { cursor: pointer; display: flex; flex-direction: column; gap: 2px; flex-grow: 1; margin: 0; }
                .versioning-option-card.disabled label { cursor: not-allowed; }
                .versioning-option-card label strong { color: #1f2937; }
                .versioning-option-card label span { font-size: 0.82rem; color: #6b7280; }
                .versioning-option-card label em { font-style: normal; color: #374151; }
                .versioning-pastille { display: inline-block; min-width: 22px; text-align: center; background: #dc2626; color: #fff; border-radius: 4px; padding: 0 6px; margin-right: 6px; font-weight: 700; }
                .versioning-ouverte { font-size: 0.72rem; font-weight: 700; color: #166534; background: #dcfce7; border-radius: 10px; padding: 1px 8px; margin-left: 6px; }
                .versioning-libelle { margin-top: 14px; }
                .versioning-libelle label { display: block; font-weight: 600; font-size: 0.88rem; margin-bottom: 4px; color: #1f2937; }
                .versioning-libelle-ligne { display: flex; gap: 8px; align-items: center; }
                .versioning-libelle input { flex: 1; border: 1px solid #d1d5db; border-radius: 4px; padding: 7px 9px; font-size: 0.92rem; }
                .versioning-libelle input.invalide { border-color: #dc2626; outline-color: #dc2626; }
                .versioning-compteur { font-size: 0.8rem; color: #6b7280; min-width: 44px; text-align: right; }
                .versioning-compteur.invalide { color: #dc2626; font-weight: 700; }
                .versioning-erreur { display: none; margin-top: 6px; font-size: 0.82rem; color: #991b1b; }
                .versioning-confirmation { display: none; margin-top: 14px; padding: 10px 12px; border-radius: 6px; background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; font-size: 0.88rem; }
                .versioning-modal-footer { padding: 15px 20px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; display: flex; justify-content: flex-end; gap: 10px; }
                .versioning-modal-footer .btn { padding: 8px 16px; border: none; border-radius: 4px; font-weight: 500; font-size: 0.9rem; cursor: pointer; }
                .versioning-modal-footer .btn-primary { background-color: #dc2626; color: white; font-weight: 600; }
                .versioning-modal-footer .btn-primary:hover { background-color: #b91c1c; }
                .versioning-modal-footer .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
                .versioning-modal-footer .btn-secondary { background-color: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
                .versioning-modal-footer .btn-secondary:hover { background-color: #e5e7eb; }
            `;
            document.head.appendChild(style);
        }

        const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const longueur = (v) => Array.from(v || '').length;
        const dateCourte = (iso) => {
            if (!iso) return '';
            const d = new Date(iso);
            return isNaN(d) ? '' : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        };

        const revisions = (Array.isArray(etat.revisions) ? etat.revisions : [])
            .slice().sort((a, b) => String(a.indice).localeCompare(String(b.indice)));
        const aucuneVariante = revisions.length === 0;
        const indices = revisions.map(r => r.indice);
        // Même repli que le serveur (save_project_revision) quand la variante active est inconnue.
        const active = indices.includes(etat.active_indice) ? etat.active_indice
            : (indices.includes('A') ? 'A' : indices[0]);
        const prochaine = etat.next_suggested || null;
        const creationPossible = !aucuneVariante && indices.includes('A') && !!prochaine;
        const parIndice = Object.fromEntries(revisions.map(r => [r.indice, r]));

        const carteVariante = (rev) => {
            const estActive = rev.indice === active;
            const date = dateCourte(rev.updated_at);
            const libelle = rev.libelle ? `<em>« ${esc(rev.libelle)} »</em>` : '<span>Sans libellé</span>';
            const detail = estActive
                ? `Mettre à jour la variante ouverte avec la configuration actuelle.${date ? ` Dernier enregistrement : ${esc(date)}.` : ''}`
                : `Écraser cette variante par la configuration actuelle ; elle deviendra la variante ouverte.${date ? ` Dernier enregistrement : ${esc(date)}.` : ''}`;
            return `
                <div class="versioning-option-card${estActive ? ' selectionnee' : ''}" data-choix="${esc(rev.indice)}">
                    <input type="radio" name="versioning-choice" id="choice-variante-${esc(rev.indice)}" value="${esc(rev.indice)}" ${estActive ? 'checked' : ''}>
                    <label for="choice-variante-${esc(rev.indice)}">
                        <strong><span class="versioning-pastille">${esc(rev.indice)}</span>Variante ${esc(rev.indice)}${estActive ? '<span class="versioning-ouverte">ouverte</span>' : ''}</strong>
                        ${libelle}
                        <span>${detail}</span>
                    </label>
                </div>`;
        };

        const optionsHtml = aucuneVariante ? `
                <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 12px 15px; color: #1e3a8a;">
                    <i class="fas fa-info-circle" style="color: #2563eb; margin-right: 8px;"></i>
                    Le projet va être enregistré dans la <strong>variante A</strong>. Vous pourrez ensuite
                    créer des variantes B, C et D à partir de lui.
                </div>` : `
                <div class="versioning-options">
                    <p class="versioning-section-titre">Variantes du projet</p>
                    ${revisions.map(carteVariante).join('')}
                    <p class="versioning-section-titre">Nouvelle variante</p>
                    <div class="versioning-option-card ${creationPossible ? '' : 'disabled'}" data-choix="${NOUVELLE}">
                        <input type="radio" name="versioning-choice" id="choice-create" value="${NOUVELLE}" ${creationPossible ? '' : 'disabled'}>
                        <label for="choice-create">
                            <strong>${creationPossible ? `<span class="versioning-pastille">${esc(prochaine)}</span>Créer la variante ${esc(prochaine)}` : 'Créer une nouvelle variante'}</strong>
                            <span>${creationPossible
                                ? `La configuration actuelle devient la variante ${esc(prochaine)}, qui sera ouverte. La variante ${esc(active)} reste inchangée.`
                                : 'Limite atteinte : les variantes A à D existent déjà. Écrasez l\'une d\'elles.'}</span>
                        </label>
                    </div>
                </div>`;

        const titre = mode === 'sauvegarde' ? '💾 Enregistrer le projet' : '📄 Génération du rapport';
        const intro = mode === 'sauvegarde'
            ? 'Choisissez la variante dans laquelle enregistrer la configuration actuelle du projet.'
            : 'La configuration du projet va être enregistrée, et le rapport portera la lettre de cette variante.';
        const libelleBouton = mode === 'sauvegarde' ? 'Enregistrer' : 'Enregistrer et générer le rapport';

        const overlay = document.createElement('div');
        overlay.className = 'versioning-modal-overlay';
        overlay.id = 'versioning-modal-overlay';
        overlay.innerHTML = `
            <div class="versioning-modal-box" role="dialog" aria-modal="true" aria-labelledby="versioning-modal-titre">
                <div class="versioning-modal-header">
                    <h4 id="versioning-modal-titre">${titre}</h4>
                    <button type="button" class="versioning-modal-close" id="btn-close-versioning-modal" aria-label="Fermer">&times;</button>
                </div>
                <div class="versioning-modal-body">
                    <p>${intro}</p>
                    ${optionsHtml}
                    <div class="versioning-libelle">
                        <label for="versioning-libelle-input" id="versioning-libelle-label">Libellé de la variante (facultatif)</label>
                        <div class="versioning-libelle-ligne">
                            <input type="text" id="versioning-libelle-input" maxlength="${LIBELLE_MAX}" autocomplete="off"
                                   placeholder="Ex. : Toiture sud seule">
                            <span class="versioning-compteur" id="versioning-libelle-compteur">0/${LIBELLE_MAX}</span>
                        </div>
                        <div class="versioning-erreur" id="versioning-libelle-erreur"></div>
                    </div>
                    <div class="versioning-confirmation" id="versioning-confirmation" role="alert"></div>
                </div>
                <div class="versioning-modal-footer">
                    <button type="button" class="btn btn-secondary" id="btn-cancel-versioning">Annuler</button>
                    <button type="button" class="btn btn-primary" id="btn-confirm-versioning">${libelleBouton}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const champ = overlay.querySelector('#versioning-libelle-input');
        const compteur = overlay.querySelector('#versioning-libelle-compteur');
        const erreur = overlay.querySelector('#versioning-libelle-erreur');
        const etiquette = overlay.querySelector('#versioning-libelle-label');
        const confirmation = overlay.querySelector('#versioning-confirmation');
        const boutonOk = overlay.querySelector('#btn-confirm-versioning');
        let saisieModifiee = false;
        let ecrasementConfirme = false;

        const choixCourant = () => {
            if (aucuneVariante) return 'A';
            const radio = overlay.querySelector('input[name="versioning-choice"]:checked');
            return radio ? radio.value : active;
        };
        const lettreChoisie = (choix) => (choix === NOUVELLE ? prochaine : choix);

        const majCompteur = () => {
            const n = longueur(champ.value);
            const invalide = n > LIBELLE_MAX;
            compteur.textContent = `${n}/${LIBELLE_MAX}`;
            compteur.classList.toggle('invalide', invalide);
            champ.classList.toggle('invalide', invalide);
            erreur.style.display = invalide ? 'block' : 'none';
            erreur.textContent = invalide ? `Le libellé ne doit pas dépasser ${LIBELLE_MAX} caractères.` : '';
            boutonOk.disabled = invalide;
            return !invalide;
        };

        const majBouton = () => {
            const choix = choixCourant();
            const ecrase = !aucuneVariante && choix !== NOUVELLE && choix !== active;
            if (ecrase && ecrasementConfirme) boutonOk.textContent = `Confirmer : écraser la variante ${choix}`;
            else boutonOk.textContent = libelleBouton;
            confirmation.style.display = ecrase && ecrasementConfirme ? 'block' : 'none';
        };

        const surChangementChoix = () => {
            const choix = choixCourant();
            overlay.querySelectorAll('.versioning-option-card').forEach((c) => c.classList.toggle('selectionnee', c.dataset.choix === choix));
            etiquette.textContent = `Libellé de la variante ${lettreChoisie(choix) || ''} (facultatif)`;
            if (!saisieModifiee) {
                champ.value = (choix !== NOUVELLE && parIndice[choix] && parIndice[choix].libelle) || '';
            }
            ecrasementConfirme = false;
            majCompteur();
            majBouton();
        };

        overlay.querySelectorAll('.versioning-option-card').forEach((carte) => {
            const radio = carte.querySelector('input[type="radio"]');
            if (!radio || radio.disabled) return;
            carte.addEventListener('click', () => {
                if (!radio.checked) radio.checked = true;
                surChangementChoix();
            });
            radio.addEventListener('change', surChangementChoix);
        });
        champ.addEventListener('input', () => { saisieModifiee = true; majCompteur(); });
        surChangementChoix();

        const fermer = (choix) => {
            document.removeEventListener('keydown', clavier, true);
            overlay.remove();
            this.isVersioningModalOpen = false;
            onChoice(choix);
        };
        const clavier = (e) => { if (e.key === 'Escape') { e.preventDefault(); fermer({ skip: true }); } };
        document.addEventListener('keydown', clavier, true);

        const valider = () => {
            if (!majCompteur()) { champ.focus(); return; }
            const libelle = champ.value.replace(/\s+/g, ' ').trim();
            const choix = choixCourant();
            if (aucuneVariante) { fermer({ skip: false, action: 'enregistrer', libelle }); return; }
            if (choix === NOUVELLE) { fermer({ skip: false, action: 'creer_variante', libelle }); return; }
            if (choix === active) { fermer({ skip: false, action: 'enregistrer', libelle }); return; }
            // Écrasement d'une autre variante : confirmation explicite dans la fenêtre.
            if (!ecrasementConfirme) {
                ecrasementConfirme = true;
                confirmation.innerHTML = `<strong>Écraser la variante ${esc(choix)} ?</strong><br>
                    Son contenu actuel sera remplacé par la configuration en cours, sans retour possible.
                    La variante ${esc(choix)} deviendra la variante ouverte ; la variante ${esc(active)} garde
                    sa dernière version enregistrée.`;
                majBouton();
                return;
            }
            fermer({ skip: false, action: 'ecraser', indice: choix, libelle });
        };

        overlay.addEventListener('click', (e) => {
            if (e.target.id === 'btn-close-versioning-modal' || e.target.id === 'btn-cancel-versioning' || e.target === overlay) {
                e.preventDefault();
                e.stopPropagation();
                fermer({ skip: true });
            } else if (e.target.id === 'btn-confirm-versioning') {
                e.preventDefault();
                e.stopPropagation();
                valider();
            }
        });
        champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); valider(); } });
        boutonOk.focus();
    }

    /**
     * Notification de succès pour la sauvegarde
     */
    showSuccessNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `alert alert-${type} alert-dismissible fade show`;
        notification.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 250000; min-width: 300px;';
        // Jamais dans les captures d'écran (rapport, plans) : elle s'affiche juste avant la génération.
        notification.setAttribute('data-html2canvas-ignore', 'true');
        notification.innerHTML = `
            ${message}
            <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
        `;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
    }

    setupNavigation() {
        // FUSION DES ONGLETS (demande explicite) : « Données d'irradiation » n'est plus un onglet — son
        // contenu (#mode_et_normes) est intégré à #parametre_projet (« Informations projet & Données
        // d'irradiation »). #mode_et_normes ne doit donc plus figurer parmi les sections masquées à chaque
        // bascule ; les appels historiques à 'button_mode_et_normes' ouvrent l'onglet fusionné.
        this.tabMap = {
            'button_mes_projets': 'mes_projets',
            'button_parametre_projet': 'parametre_projet'
        };
        this.aliasOnglets = { 'button_mode_et_normes': 'button_parametre_projet' };

        Object.keys(this.tabMap).forEach(buttonId => {
            const button = document.getElementById(buttonId);
            if (button) {
                // CORRECTIF (bug "désélection des champs en changeant d'onglet") : un simple clic
                // sur un onglet ne doit JAMAIS purger le formulaire — cf. commentaire sur
                // purgeForNewProject plus bas. On ne transmet donc plus e.isTrusted ici.
                button.addEventListener('click', () => {
                    this.switchToSection(buttonId);
                });
            }
        });

        const navButtons = [
            // "goto_parametre_projet" (bouton "Suivant" de l'onglet "Mes projets") retiré : la case
            // "Actif" est désormais l'unique façon d'ouvrir un projet depuis cet onglet.
            // goto_mode_from_params / goto_params_from_mode retirés avec la fusion des onglets.
            { id: 'goto_mes_projets_from_params', target: 'button_mes_projets' }
        ];

        navButtons.forEach(nav => {
            const btn = document.getElementById(nav.id);
            if (btn) {
                // CORRECTIF (bug "désélection des champs en changeant d'onglet") : ces boutons
                // ("Suivant"/"← Précédent") sont utilisés pour naviguer DANS le formulaire en cours
                // de remplissage — ce ne sont pas des demandes de "nouveau projet vierge", donc pas
                // de purge ici non plus (cf. purgeForNewProject plus bas).
                btn.addEventListener('click', () => {
                    // Message de création au centre (cf. afficherConfirmationCreation) : retiré.
                    const message = document.getElementById('form-message');
                    if (message && message.dataset.centre === '1' && window.dataManager
                        && typeof window.dataManager.masquerMessage === 'function') window.dataManager.masquerMessage();
                    this.switchToSection(nav.target);
                });
            }
        });

        this.switchToSection('button_mes_projets');
    }

    async switchToSection(buttonId, purgeForNewProject = false) {
        buttonId = (this.aliasOnglets && this.aliasOnglets[buttonId]) || buttonId;
        const sectionId = this.tabMap[buttonId];
        // Nouveau projet demandé alors que le formulaire est déjà affiché (bug 2026-11-04) : la purge
        // doit quand même avoir lieu — auparavant, ce retour anticipé la sautait.
        const purgeDemandee = buttonId === 'button_parametre_projet' && purgeForNewProject;
        if (!sectionId || (sectionId === this.currentSection && !purgeDemandee)) return;

        // Les onglets "Créer un projet" et "Données d'irradiation" sont masqués par défaut (cf.
        // #create-project-btn dans parametre.html) et ne doivent apparaître dans la barre d'onglets
        // qu'une fois qu'on y accède réellement — que ce soit via le bouton "Créer un projet", via
        // l'édition d'un projet existant (editProject()) ou via les boutons de navigation internes
        // (goto_mode_from_params, goto_params_from_mode...). Révéler ici, au niveau de la bascule
        // d'onglet elle-même, couvre TOUS ces chemins d'un coup plutôt que d'avoir à dupliquer cette
        // logique à chaque point d'entrée. "Mes projets" est exclu : son onglet reste définitivement
        // masqué, son libellé ayant été déplacé dans #mes-projets-btn (rangée d'actions).
        // Demande explicite : le formulaire du projet n'est plus un onglet du modal « Mes projets »
        // mais la page « Paramètres projet » du menu horizontal — la barre d'onglets (#myTab) reste
        // donc masquée ; seuls le titre du modal et l'étape mise en évidence dans le menu suivent la
        // vue affichée.
        const estFormulaire = buttonId !== 'button_mes_projets';
        const titre = document.getElementById('parametres-modal-title');
        if (titre) {
            titre.innerHTML = estFormulaire
                ? '<i class="fa fa-cogs"></i> Paramètres projet'
                : '<i class="fas fa-folder-open"></i> Mes projets';
        }
        const modalOuvert = document.getElementById('parametres-modal');
        if (modalOuvert && modalOuvert.style.display !== 'none' && modalOuvert.classList.contains('show')
            && typeof window.setActiveMainNavStep === 'function') {
            window.setActiveMainNavStep(estFormulaire ? 'parametres' : 'mes-projets');
        }

        // TICKET 1 : Purger le state à la création d'un nouveau projet.
        // CORRECTIF (bug "désélection des champs/onglets en changeant d'onglet pendant la
        // création") : cette purge doit être réservée à l'intention explicite "démarrer un projet
        // vierge" (clic sur #create-project-btn, cf. parametre.html), et non à n'importe quel clic
        // humain sur cet onglet — auparavant basé sur isTrusted (e.isTrusted), elle se déclenchait
        // aussi bien sur un simple clic d'onglet que sur les boutons de navigation internes
        // "Suivant"/"← Précédent" (goto_mode_from_params/goto_params_from_mode), effaçant les
        // champs qu'on venait de saisir à chaque aller-retour entre les onglets du formulaire de
        // création. purgeForNewProject est maintenant un booléen passé explicitement par
        // l'appelant, vrai uniquement pour #create-project-btn.
        // On garde en plus le garde-fou !isEditingExistingProject : ce clic sur l'onglet est aussi
        // emprunté quand on ÉDITE un projet existant (editProject() bascule sur cet onglet pour
        // afficher le formulaire pré-rempli) — il ne faut jamais purger l'état (shapes,
        // localStorage) d'un projet en cours d'édition, même par erreur d'appel futur.
        const projetIdEditEl = document.getElementById('projet_id_edit');
        const isEditingExistingProject = !!(projetIdEditEl && projetIdEditEl.value);
        if (purgeDemandee && isEditingExistingProject) {
            // Ne doit plus arriver : DataManager.ouvrirFormulaireCreationVierge retire #projet_id_edit avant.
            console.warn('Purge « nouveau projet » refusée : formulaire en modification du projet', projetIdEditEl.value);
        }

        if (purgeDemandee && !isEditingExistingProject) {
            // CORRECTIF (bug "perte de données en créant un nouveau projet") : cette purge effaçait
            // solarProjectData/current_projet_id du projet ACTUELLEMENT actif SANS jamais le sauvegarder
            // en base au préalable — tout calepinage dessiné/calculé mais pas encore explicitement
            // sauvegardé disparaissait silencieusement dès qu'on cliquait sur "Paramètre Projet" pour
            // créer un nouveau projet. On sauvegarde maintenant le projet courant avant de purger.
            if (window.calepinageService && typeof window.calepinageService.saveToDatabase === 'function') {
                try {
                    await window.calepinageService.saveToDatabase();
                } catch (err) {
                    console.warn('Sauvegarde du projet courant avant purge (nouveau projet) impossible :', err);
                }
            }
            try {
                localStorage.removeItem('sharedIrveData');
                localStorage.removeItem('stagedIrveData');
                // NOUVEAU: session complète du modal IRVE (matériels, bilan de puissance, planification,
                // courbe de charge saisie/importée — cf. IrveStorageManager.js) ; sans cette purge, un
                // nouveau projet héritait de la courbe de charge et des bornes du projet précédent.
                localStorage.removeItem('skv_irve_session_data');
                // NOUVEAU: saisie/choix utilisateur des modals de géométrie (ombrières métal/bois/
                // solumbra, bâtiment métal — cf. storage_manager_geometrie_structure.js) ; sans
                // cette purge, un nouveau projet héritait de la configuration du projet précédent.
                // Réglages rangés PAR PROJET (clé skv_geometrie_structure_data:<projet>) : un nouveau projet
                // n'en hérite plus ; seuls ceux saisis sans projet actif sont purgés. Ceux des autres projets,
                // l'ancienne clé commune (reprise à la 1re ouverture) et les copies orphelines sont conservés.
                localStorage.removeItem('skv_geometrie_structure_data:sans_projet');
                localStorage.removeItem('sharedSolarProduction');
                localStorage.removeItem('solar_sim_data');
                localStorage.removeItem('solar_storage_data');
                localStorage.removeItem('solarProjectData');
                localStorage.removeItem('solarProjectData_owner_id');
                localStorage.removeItem('geometriePlansData');
                // Système hybride (modale de consommation) : données du projet précédent.
                Object.keys(localStorage).filter((k) => k.startsWith('skv_systeme_hybride_')).forEach((k) => localStorage.removeItem(k));
                // PAC / climatiseur : saisies conservées dans le navigateur, purgées à la création d'un projet.
                Object.keys(localStorage).filter((k) => k.startsWith('skv_pac_')).forEach((k) => localStorage.removeItem(k));

                // CORRECTIF (bug majeur "un nouveau projet écrase les données d'un autre projet
                // existant") : un simple localStorage.removeItem('current_projet_id') ne suffit PAS —
                // getCurrentProjetId() (CalepinageDataService) priorise this.currentProjetId (propriété
                // EN MÉMOIRE de l'instance) sur le localStorage. Cette propriété n'était jamais remise à
                // null ici, et le minuteur de sauvegarde automatique (setInterval, 120s) n'était jamais
                // arrêté : il continuait de tourner, toujours lié à l'ANCIEN projet via cette propriété
                // devenue périmée. Pendant tout le temps que l'utilisateur passait à remplir le
                // formulaire du NOUVEAU projet (souvent largement plus de 120s), ce minuteur fantôme
                // pouvait se déclencher et écrire — sous l'identité de l'ANCIEN projet — tout contenu
                // présent entre-temps dans solarProjectData. Le marqueur de propriété (owner) étant lui
                // aussi effacé ci-dessus, le garde-fou de saveToDatabase() ne bloquait pas ce cas
                // (owner absent = non vérifié). clearCurrentProjet() remet cette propriété à null ET
                // arrête ce minuteur, supprimant la source du problème plutôt que son seul symptôme.
                if (window.calepinageService && typeof window.calepinageService.clearCurrentProjet === 'function') {
                    window.calepinageService.clearCurrentProjet();
                } else {
                    localStorage.removeItem('current_projet_id'); // Assure qu'on démarre un projet vierge
                }
                // NOUVEAU: empreintes/paramètres de calcul du module prodsolaire — propres à chaque
                // projet ; sans cette purge, un nouveau projet héritait des données du précédent
                // (fausse détection de "calepinage modifié" dès l'ouverture du modal autoconsommation).
                localStorage.removeItem('solar_sim_pv_signature');
                localStorage.removeItem('solar_sim_signature');
                localStorage.removeItem('vente_totalite_options');
                localStorage.removeItem('sharedDegradationRate');
                localStorage.removeItem('economicParamsACC');
                localStorage.removeItem('advancedEconomicParams');
                localStorage.removeItem('studyType');
                // NOUVEAU: 'default' est la clé de repli utilisée par setupIRVEAndValorisation() tant
                // qu'un projet n'a pas encore d'ID réel (nouveau projet en cours de création) — sans
                // cette purge, un précédent brouillon "Couplage IRVE" cochée pouvait être restauré ici.
                localStorage.removeItem('irve_status_default');
                localStorage.removeItem('val_status_default');
                sessionStorage.removeItem('activeAutoconsoRate');
                sessionStorage.removeItem('seasonalAutoconsoShares');
                sessionStorage.removeItem('openModalState');

                if (window.drawingControl && typeof window.drawingControl.clearAllShapes === 'function') {
                    window.drawingControl.clearAllShapes();
                }

                // CORRECTIF (bug rapporté : type de projet « Ombrière » au lieu de « Toiture » pour un nouveau
                // projet Résidentielle) : pvForm/tmyForm ne sont plus des <form> mais des <div> (correctif des
                // formulaires imbriqués, cf. parametre.html) — form.reset() levait « form.reset is not a
                // function », ce qui interrompait TOUTE la suite de cette purge : cartes non désélectionnées,
                // adresse non effacée et surtout valeurs par défaut du nouveau projet jamais posées. Leurs champs
                // sont de toute façon remis à zéro par le reset de form_parametre_projet, qui les contient.
                ['form_parametre_projet', 'pvForm', 'tmyForm'].forEach(formId => {
                    const form = document.getElementById(formId);
                    if (form && typeof form.reset === 'function') form.reset();
                });

                // CORRECTIF (bug "l'adresse de l'ancien projet actif réapparaît en créant un nouveau
                // projet") : #parametre_project_hidden a une valeur PAR DÉFAUT pré-remplie côté serveur
                // (l'adresse du dernier projet actif au moment du rendu de la page, cf. main.py:index()),
                // donc form.reset() ci-dessus le restaure vers CETTE MÊME adresse au lieu de le vider —
                // il faut donc l'écraser explicitement après coup. Le marqueur Leaflet de la mini-carte
                // n'est de toute façon jamais touché par form.reset() (ce n'est pas un élément de
                // formulaire), d'où clearParametreMarker() qui s'en charge en plus.
                if (window.parametreProjetManager && typeof window.parametreProjetManager.clearParametreMarker === 'function') {
                    window.parametreProjetManager.clearParametreMarker();
                } else {
                    const hiddenAddressInput = document.getElementById('parametre_project_hidden');
                    if (hiddenAddressInput) hiddenAddressInput.value = '';
                    const addressSearchInput = document.getElementById('parametreProjectSearch');
                    if (addressSearchInput) addressSearchInput.value = '';
                }

                // CORRECTIF : les "cartes" cliquables (type de projet, mode de valorisation, étude,
                // tension, normes, option réseau — cf. setupCardSelections) pilotent un champ caché via
                // une classe CSS ".selected" qui n'est PAS retirée par form.reset() (ce n'est pas un
                // état natif de formulaire) — sans ceci, la carte du projet précédent restait visuellement
                // surlignée pour un nouveau projet, même si le champ cache lui, était bien vidé.
                document.querySelectorAll(
                    '.connexion-projet.selected, .typologie-projet.selected, .mode-de-valorisation.selected, ' +
                    '.etude-option.selected, .mode-de-tension.selected, .option-card.selected, ' +
                    '.option-reseau-card.selected'
                ).forEach(card => card.classList.remove('selected'));
                // Type d'études : form.reset() vient de rétablir #type_etude sur sa valeur par défaut
                // (« Étude technico-économique ») — sa carte doit apparaître sélectionnée,
                // sans quoi aucun type d'étude ne semblait choisi alors qu'une valeur est bien enregistrée.
                const typeEtudeDefaut = document.getElementById('type_etude');
                if (typeEtudeDefaut && typeEtudeDefaut.value) {
                    document.querySelectorAll('.etude-option').forEach((card) => {
                        card.classList.toggle('selected', card.dataset.value === typeEtudeDefaut.value);
                    });
                }

                // NOUVEAU: garantir explicitement le décochage (l'utilisateur doit cocher lui-même),
                // au cas où le reset natif du formulaire ne suffirait pas à retirer la coche visuelle.
                const irveCheckboxOnNewProject = document.getElementById('couplage_irve_oui');
                if (irveCheckboxOnNewProject) irveCheckboxOnNewProject.checked = false;

                // NOUVEAU (demande explicite) : valeurs par défaut du nouveau projet — connecté au
                // réseau, typologie Résidentielle (et ses propres défauts). Posées APRÈS la remise à
                // zéro ci-dessus, qui sinon les effacerait.
                if (window.dataManager && typeof window.dataManager.applyNewProjectDefaults === 'function') {
                    window.dataManager.applyNewProjectDefaults();
                }
            } catch (error) {
                console.error("Erreur lors de la purge du nouveau projet :", error);
            }
        }

        // CORRECTION : Recharger la liste des projets à chaque fois qu'on affiche cet onglet
        if (buttonId === 'button_mes_projets' && window.dataManager) {
            console.log("🔄 Rechargement de la liste des projets...");
            window.dataManager.loadProjects();
        }

        Object.values(this.tabMap).forEach(secId => {
            const element = document.getElementById(secId);
            if (element) {
                element.style.display = 'none';
                element.classList.remove('active');
            }
        });

        Object.keys(this.tabMap).forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.style.color = '#232323';
                btn.classList.remove('active');
            }
        });

        const targetSection = document.getElementById(sectionId);
        const targetButton = document.getElementById(buttonId);

        if (targetSection) {
            // "Mes projets" en flex colonne : la barre de pagination (#projects-list-controls) y
            // est poussée en bas de la fenêtre (margin-top: auto, cf. ParametresProjet.css).
            targetSection.style.display = sectionId === 'mes_projets' ? 'flex' : 'block';
            targetSection.classList.add('active');
            this.currentSection = sectionId;
        }

        if (targetButton) {
            targetButton.style.color = '#DE0000';
            targetButton.classList.add('active');
        }

        const modalBody = document.getElementById('modal-body');
        if (modalBody) {
            modalBody.scrollTop = 0;
        }

        // Forcer le redimensionnement de la carte Leaflet lors de l'affichage de l'onglet
        if (sectionId === 'parametre_projet' && window.parametreProjetManager) {
            window.parametreProjetManager.resizeMap();
        }
    }

    setupUIInteractions() {
        const modalBody = document.getElementById('modal-body');
        ['scrollToTopBtn', 'scrollToTopBtn1'].forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn && modalBody) {
                btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    modalBody.scrollTo({ top: 0, behavior: 'smooth' });
                });
            }
        });

        this.setupConditionalFields();
        this.setupCardSelections();
        this.setupMeteoDataPersistence();
    }

    setupCustomEvents() {
        document.addEventListener('navigateToNormes', (e) => {
            console.log('Navigation vers normes demandée depuis:', e.detail.source);
            // Onglet fusionné : ouverture puis défilement jusqu'à la section irradiation.
            Promise.resolve(this.switchToSection('button_parametre_projet')).then(() => {
                const section = document.getElementById('mode_et_normes');
                if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    setupStudyTypeSelection() {
        // « Type d'études à réaliser » est désormais en tête de #parametre_projet (fusion des onglets).
        const studyOptions = document.querySelectorAll('#form_parametre_projet .etude-option');
        const hiddenInput = document.getElementById('type_etude');

        if (!hiddenInput || studyOptions.length === 0) return;

        studyOptions.forEach(option => {
            option.addEventListener('click', () => {
                const newValue = option.dataset.value;
                if (hiddenInput.value !== newValue) {
                    hiddenInput.value = newValue;
                    console.log("Type d'étude sélectionné:", hiddenInput.value);

                    studyOptions.forEach(opt => opt.classList.remove('selected'));
                    option.classList.add('selected');
                }
            });
        });

        const selectedOption = document.querySelector('#form_parametre_projet .etude-option.selected');
        if (selectedOption) {
            hiddenInput.value = selectedOption.dataset.value;
        }
    }

    setupCardSelections() {
        const cardGroups = [
            '.connexion-projet',
            '.mode-de-valorisation',
            '.etude-option',
            '.mode-de-tension',
            '.option-card', // For normes
            '.option-reseau-card'
        ];
        const self = this; // Store context

        cardGroups.forEach(selector => {
            const cards = document.querySelectorAll(selector);
            cards.forEach(card => {
                card.removeEventListener('click', handleCardClick); // Prevent duplicates
                card.addEventListener('click', handleCardClick);
            });
        });

        // --- CORRECTION (Tâche 3.2) : Modification de 'handleCardClick' ---
        // Cette fonction est redéfinie pour inclure la logique de multi-sélection
        function handleCardClick(event) {
            const card = event.currentTarget;
            const selector = card.classList.contains('connexion-projet') ? '.connexion-projet' :
                card.classList.contains('mode-de-valorisation') ? '.mode-de-valorisation' :
                    card.classList.contains('etude-option') ? '.etude-option' :
                        card.classList.contains('mode-de-tension') ? '.mode-de-tension' :
                            card.classList.contains('option-card') ? '.option-card' :
                                card.classList.contains('option-reseau-card') ? '.option-reseau-card' : null;

            if (!selector) return;

            // --- NOUVELLE LOGIQUE POUR LES NORMES (Multi-select max 3) ---
            if (selector === '.option-card') {
                const parentRow = card.closest('.row'); // Cherche le conteneur .row
                if (!parentRow) return;

                const selectedCards = parentRow.querySelectorAll('.option-card.selected');

                if (card.classList.contains('selected')) {
                    // Si déjà sélectionné, on le désélectionne
                    card.classList.remove('selected');
                } else {
                    // Si non sélectionné, on vérifie la limite
                    if (selectedCards.length < 3) {
                        card.classList.add('selected');
                    } else {
                        // Limite atteinte, on ne fait rien (ou on alerte)
                        console.warn("Limite de 3 normes atteinte.");
                    }
                }

                // Mettre à jour le champ caché avec les normes sélectionnées
                const hiddenInput = document.getElementById('normes_electriques');
                if (hiddenInput) {
                    const updatedSelectedCards = parentRow.querySelectorAll('.option-card.selected');
                    const selectedNormes = Array.from(updatedSelectedCards).map(c => {
                        const h5 = c.querySelector('h5');
                        return h5 ? h5.textContent.trim() : '';
                    });
                    hiddenInput.value = selectedNormes.join(';'); // Utilise un séparateur
                }
                return; // On arrête ici pour ne pas exécuter la logique de sélection unique
            }
            // --- FIN DE LA MODIFICATION ---


            // Logique existante pour la sélection unique (pour les autres types)
            const parentRow = card.closest('.row');
            if (!parentRow) return;
            const siblings = parentRow.querySelectorAll(selector);
            siblings.forEach(sibling => sibling.classList.remove('selected'));
            card.classList.add('selected');

            // Specific Logic
            if (selector === '.mode-de-tension') {
                self.handleModeDeTensionSelection(card);
            } else if (selector === '.connexion-projet') {
                self.handleConnexionProjetSelection(card);
            } else if (selector === '.mode-de-valorisation') {
                self.handleModeValorisationSelection(card);
            } else if (selector === '.option-reseau-card') {
                self.handleOptionReseauSelection(card);
            } else if (selector === '.etude-option') {
                // This is already handled by setupStudyTypeSelection,
                // but we ensure visual sync if called from here
                const hiddenInput = document.getElementById('type_etude');
                if (hiddenInput) hiddenInput.value = card.dataset.value;
            }
            // Add handlers for other types if needed
        }

        // --- Zone Buttons Logic ---
        const zoneButtonGroups = ['.zone_de_vent', '.categorie_de_terrain', '.zone_de_neige', '.zone_sismique'];
        zoneButtonGroups.forEach(groupSelector => {
            const buttons = document.querySelectorAll(`${groupSelector} .btn_reset_parametre`);
            buttons.forEach(button => {
                button.removeEventListener('click', handleZoneButtonClick); // Prevent duplicates
                button.addEventListener('click', handleZoneButtonClick);
            });
        });

        function handleZoneButtonClick(event) {
            const button = event.currentTarget;
            const groupSelector = button.closest('.zone_de_vent') ? '.zone_de_vent' :
                button.closest('.categorie_de_terrain') ? '.categorie_de_terrain' :
                    button.closest('.zone_de_neige') ? '.zone_de_neige' :
                        button.closest('.zone_sismique') ? '.zone_sismique' : null;

            if (!groupSelector) return;

            // Remove active class from siblings in the group
            const siblings = button.closest('.btn-group').querySelectorAll('.btn_reset_parametre');
            siblings.forEach(btn => btn.classList.remove('btn_reset_parametre_js'));
            button.classList.add('btn_reset_parametre_js');

            // Update hidden input
            let hiddenInputId = '';
            if (groupSelector === '.zone_de_vent') hiddenInputId = 'input_zone_de_vent';
            else if (groupSelector === '.categorie_de_terrain') hiddenInputId = 'input_categorie_de_terrain';
            else if (groupSelector === '.zone_de_neige') hiddenInputId = 'input_zone_de_neige';
            else if (groupSelector === '.zone_sismique') hiddenInputId = 'input_zone_sismique';

            const hiddenInput = document.getElementById(hiddenInputId);
            if (hiddenInput) {
                hiddenInput.value = button.value;
                console.log(`${hiddenInputId} set to:`, hiddenInput.value);
            }
        }
    }

    // Helper function for mode de tension logic
    handleModeDeTensionSelection(selectedCard) {
        const otherTensionDiv = document.getElementById('div_autre_tension');
        const otherTensionInput = document.getElementById('preciser_autre_tension');
        const tensionHiddenInput = document.getElementById('mode_de_tension');

        if (otherTensionDiv) {
            otherTensionDiv.style.display = (selectedCard.id === 'autre_tension') ? 'block' : 'none';
            if (selectedCard.id !== 'autre_tension' && otherTensionInput) {
                otherTensionInput.value = '';
            }
        }
        if (tensionHiddenInput) {
            if (selectedCard.id === 'autre_tension') {
                tensionHiddenInput.value = 'Autres';
            } else {
                const pElement = selectedCard.querySelector('p');
                tensionHiddenInput.value = pElement ? pElement.textContent.trim() : selectedCard.querySelector('h5').textContent.trim();
            }
            console.log("Mode de tension sélectionné:", tensionHiddenInput.value);
        }
    }
    // Helper function for type de connexion logic
    handleConnexionProjetSelection(selectedCard) {
        const typeHiddenInput = document.getElementById('type_de_projet');
        const val = selectedCard.dataset.type; // Récupère "connecte" ou "hors-ligne"

        if (typeHiddenInput) {
            typeHiddenInput.value = val;
        }

        // Récupération des deux blocs d'options
        const sectionReseau = document.getElementById('options_reseau');
        const sectionHorsLigne = document.getElementById('options_hors_ligne');

        // 1. On commence par TOUT cacher pour réinitialiser l'affichage
        if (sectionReseau) sectionReseau.classList.add('d-none');
        if (sectionHorsLigne) sectionHorsLigne.classList.add('d-none');

        // 2. On affiche le bloc correspondant au choix actuel
        if (val === 'connecte') {
            if (sectionReseau) sectionReseau.classList.remove('d-none');
        }
        else if (val === 'hors-ligne') {
            if (sectionHorsLigne) sectionHorsLigne.classList.remove('d-none');
        }
    }


    // Helper function for mode de valorisation logic
    handleModeValorisationSelection(selectedCard) {
        const valHiddenInput = document.getElementById('mode_de_valorisation');
        if (valHiddenInput) {
            const h5Element = selectedCard.querySelector('h5');
            valHiddenInput.value = h5Element ? h5Element.textContent.trim() : 'N/A';
            console.log("Mode de valorisation sélectionné:", valHiddenInput.value);

            const projectId = localStorage.getItem('current_projet_id') || 'default';
            localStorage.setItem(`val_status_${projectId}`, valHiddenInput.value);

            try {
                let savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                if (!savedData.projectInfo) savedData.projectInfo = {};
                savedData.projectInfo.mode_de_valorisation = valHiddenInput.value;
                localStorage.setItem('solarProjectData', JSON.stringify(savedData));
                window.dispatchEvent(new CustomEvent('solarProjectDataSaved'));
            } catch (e) { }
        }
    }

    // Helper function for options réseau logic
    handleOptionReseauSelection(selectedCard) {
        const optionReseauInput = document.getElementById('option_reseau');
        if (optionReseauInput) {
            const h5Element = selectedCard.querySelector('h5');
            optionReseauInput.value = h5Element ? h5Element.textContent.trim() : 'N/A';
            console.log("Option réseau sélectionnée:", optionReseauInput.value);
        }
    }


    setupConditionalFields() {
        const fields = [
            { selectId: 'type_projet', divId: 'div_autre_type_projet', triggerValue: 'Autres' },
            { selectId: 'nature_des_traveaux', divId: 'div_autre_nature_des_traveaux', triggerValue: 'Autres' }
        ];

        fields.forEach(field => {
            const select = document.getElementById(field.selectId);
            const div = document.getElementById(field.divId);
            if (select && div) {
                const checkVisibility = () => {
                    const shouldBeVisible = (select.value === field.triggerValue);
                    div.style.display = shouldBeVisible ? 'block' : 'none';
                    const input = div.querySelector('input[type="text"]');
                    if (!shouldBeVisible && input) {
                        input.value = '';
                        input.required = false; // Make not required if hidden
                    } else if (shouldBeVisible && input) {
                        input.required = true; // Make required if visible again
                    }

                    // Sauvegarder la valeur dans le localStorage
                    const projectData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                    if (projectData.projectInfo) projectData.projectInfo.type_ouvrage = select.value;
                };
                const listener = () => checkVisibility();
                select.removeEventListener('change', listener);
                select.addEventListener('change', listener);
                checkVisibility();
            } else {
                console.warn(`Conditional field setup failed for select: ${field.selectId} or div: ${field.divId}`);
            }
        });
    }

    setupMeteoDataPersistence() {
        // NOTE : ces champs vivent dans parametre.html (section "Base de données d'irradiation").
        // La clé de stockage dédiée est `pvgisSettings` (et NON `meteoData`, qui est réservée par
        // StorageManager.js aux zones climatiques vent/terrain/neige/sismique/keraunique) afin
        // d'éviter que savePageData() n'écrase les réglages PVGIS à chaque action de dessin.
        const meteoFields = [
            { id: 'pv_raddb', key: 'raddb' },
            { id: 'pv_version', key: 'version' },
            { id: 'pv_start', key: 'startyear' },
            { id: 'pv_end', key: 'endyear' },
            { id: 'pv_usehorizon', key: 'usehorizon' }
        ];

        // BUGFIX : restaurer les valeurs déjà sauvegardées AVANT toute sauvegarde, sinon
        // le premier appel à saveData() (ci-dessous) écrase silencieusement pvgisSettings
        // avec les valeurs par défaut du HTML à chaque chargement de page/projet, et les choix
        // de l'utilisateur (Base d'irradiance, Horizon, Version API) ne sont jamais reportés
        // sur la page prodsolaire.
        const restoreData = () => {
            try {
                const projectData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                const saved = projectData.pvgisSettings;
                if (!saved) return;

                meteoFields.forEach(({ id, key }) => {
                    const el = document.getElementById(id);
                    if (el && saved[key] !== undefined) {
                        if (el.type === 'checkbox') el.checked = saved[key];
                        else el.value = saved[key];
                    }
                });

                if (saved.database) {
                    const dbEl = document.querySelector(`input[name="meteo_database"][value="${saved.database}"]`);
                    if (dbEl) dbEl.checked = true;
                }
            } catch (e) { console.error("Erreur restauration des paramètres PVGIS:", e); }
        };
        restoreData();

        const saveData = () => {
            try {
                let projectData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                if (!projectData.pvgisSettings) projectData.pvgisSettings = {};

                meteoFields.forEach(({ id, key }) => {
                    const el = document.getElementById(id);
                    if (el) projectData.pvgisSettings[key] = (el.type === 'checkbox' ? el.checked : el.value);
                });

                const irradiationDbEl = document.querySelector('input[name="meteo_database"]:checked');
                projectData.pvgisSettings.database = irradiationDbEl ? irradiationDbEl.value : 'PVGIS';

                localStorage.setItem('solarProjectData', JSON.stringify(projectData));
                window.dispatchEvent(new CustomEvent('solarProjectDataSaved'));
            } catch (e) { console.error("Erreur sauvegarde des paramètres PVGIS:", e); }
        };

        meteoFields.forEach(({ id }) => document.getElementById(id)?.addEventListener('change', saveData));
        document.querySelectorAll('input[name="meteo_database"]').forEach(el => el.addEventListener('change', saveData));

        // Sauvegarde initiale pour que pvgisSettings existe dès l'ouverture (valeurs par défaut du formulaire)
        saveData();
    }

    setupModals() {
        const mainModal = document.getElementById('parametres-modal');
        const mainCloseBtn = document.getElementById('close-modal');
        const gotoConsoBtn = document.getElementById('goto_conso_from_params');
        const self = this; // Store context for listeners

        this.openMainModal = () => {
            if (mainModal) {
                self.justResizedOrDragged = false;
                mainModal.style.display = 'flex';
                // Classe .show, comme initialisationMap.js::openModal : sans elle, l'échelle d'animation de
                // menu_list.css (.modal-container { transform: scale(0.8) }) restait appliquée et le modal
                // s'affichait réduit à 80 % (ouverture automatique sans projet actif, retour sans projet).
                mainModal.classList.add('show');
                mainModal.style.justifyContent = 'center';
                mainModal.style.alignItems = 'center';
                const container = mainModal.querySelector('.modal-container');
                container.style.top = ''; // Reset position
                container.style.left = '';
                self.switchToSection('button_mes_projets'); // Ensure first tab
            }
        }

        const closeMainModal = () => {
            if (mainModal) {
                // Obligation de projet actif (cf. app/middleware/auth_middleware.py:active_project_required) :
                // ce modal héberge la création/sélection de projet par-dessus la carte de calepinage.
                // Interdire sa fermeture tant qu'aucun projet n'est actif, sinon l'utilisateur se
                // retrouve sur la carte sans jamais avoir créé/sélectionné de projet.
                const currentProjetId = localStorage.getItem('current_projet_id');
                if (!currentProjetId) {
                    showActiveProjectRequiredMessage();
                    return;
                }

                // CORRECTIF (demande explicite : "les onglets Créer un projet/Données d'irradiation
                // restent affichés après fermeture, il faut recharger la page pour les faire
                // disparaître") : cette fonction est le point de fermeture RÉEL de ce modal (bouton X
                // #close-modal ET bouton "Fermer" #close-modal-from-mode de l'onglet "Données
                // d'irradiation" y sont tous deux reliés, cf. mainCloseBtn/closeModalBtnTab3 ci-dessus)
                // — mais ne remettait jamais à zéro l'état d'édition/les onglets révélés par
                // switchToSection(). cancelEditAndReturnToMesProjets() (DataManager,
                // parametreProjetFormManager.js) décharge le formulaire et re-masque ces onglets, pour
                // qu'une réouverture ultérieure retombe proprement sur "Mes projets" sans recharger la
                // page.
                if (window.dataManager && typeof window.dataManager.cancelEditAndReturnToMesProjets === 'function') {
                    window.dataManager.cancelEditAndReturnToMesProjets();
                }

                mainModal.style.display = 'none';
                const container = mainModal.querySelector('.modal-container');
                container.style.top = '';
                container.style.left = '';
                mainModal.style.justifyContent = 'center';
                mainModal.style.alignItems = 'center';
                self.justResizedOrDragged = false;

                // CORRECTIF (bug rapporté : "on ferme le modal Paramètres, on retombe sur Calepinage
                // mais le menu reste en évidence sur Paramètres") : ce point de fermeture (bouton X /
                // clic sur le fond, cf. mainCloseBtn/closeModalBtnTab3/handleBackdropClick plus bas)
                // ne remettait jamais à jour la mise en évidence du menu horizontal, contrairement à
                // initialisationMap.js::closeModal() — un mécanisme de fermeture distinct pour ce même
                // modal (cf. commentaire plus haut sur les onglets restés affichés). Ajouté ici aussi
                // pour que la mise en évidence soit correcte quel que soit le chemin de fermeture emprunté.
                if (typeof window.restorePreviousMainNavStep === 'function') window.restorePreviousMainNavStep();
                else if (typeof window.setActiveMainNavStep === 'function') window.setActiveMainNavStep('calepinage');

                // --- CORRECTION : Fermer toutes les modales enfants et popups ---
                // 1. Modales Bootstrap natives
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    document.querySelectorAll('.modal.show').forEach(m => {
                        if (m.id !== 'parametres-modal') {
                            const bModal = bootstrap.Modal.getInstance(m);
                            if (bModal) bModal.hide();
                        }
                    });
                } else if (typeof jQuery !== 'undefined') {
                    jQuery('.modal.show').not('#parametres-modal').modal('hide');
                }

                // 2. Modales SweetAlert2
                if (typeof Swal !== 'undefined' && Swal.isVisible()) {
                    Swal.close();
                }

                // 3. Modales secondaires personnalisées
                ['indice-modal', 'reglement-modal', 'information-modal'].forEach(id => {
                    const m = document.getElementById(id);
                    if (m) m.style.display = 'none';
                });
            }
        };

        if (mainCloseBtn) {
            mainCloseBtn.removeEventListener('mousedown', closeMainModalHandler); // Prevent duplicates
            mainCloseBtn.addEventListener('mousedown', closeMainModalHandler);
        }
        function closeMainModalHandler(e) {
            e.stopPropagation();
            closeMainModal();
        }

        // Parcours (demande explicite) : « Suivant » (ex-« Fermer ») ferme le modal comme le faisait
        // « Fermer », puis ouvre « Profil de consommation » — ou le Calepinage pour le parcours
        // Chiffrage, qui n'a pas d'étape de consommation (cf. navigation-modales.js).
        if (gotoConsoBtn && !gotoConsoBtn.dataset.navBound) {
            gotoConsoBtn.dataset.navBound = 'true';
            gotoConsoBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                // Juste après la création d'un projet (demande 2026-11-04 : l'utilisateur reste sur
                // le formulaire) : le projet créé n'est pas encore chargé dans la page. « Suivant »
                // l'ouvre (rechargement sur ce projet, puis Consommation d'énergie / Calepinage) au
                // lieu de fermer le modal sur l'état du projet précédent.
                const dm = window.dataManager;
                if (dm && dm.pendingProjectOpen && typeof dm.ouvrirProjetCree === 'function') {
                    if (gotoConsoBtn.disabled) return;
                    gotoConsoBtn.disabled = true;
                    let ouvert = false;
                    try { ouvert = await dm.ouvrirProjetCree(); } finally { if (!ouvert) gotoConsoBtn.disabled = false; }
                    if (ouvert || dm.pendingProjectOpen) return;
                }
                closeMainModal();
                if (mainModal && mainModal.style.display !== 'none') return; // Aucun projet actif
                if (typeof window.isChiffrageProject === 'function' && window.isChiffrageProject()) {
                    if (typeof window.allerAuCalepinage === 'function') window.allerAuCalepinage();
                } else if (typeof window.openBDMateriels === 'function') {
                    window.openBDMateriels(new Event('click'));
                }
            });
        }

        // Indices modal
        const indiceModal = document.getElementById('indice-modal');
        const indiceProjetBtn = document.getElementById('indice-projet-btn');

        if (indiceProjetBtn) {
            const openIndiceHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Restaure la date de création déjà persistée (projet existant), ou l'initialise à
                // aujourd'hui uniquement s'il s'agit réellement d'un nouveau projet.
                const firstDateElement = document.getElementById('firstDateIndice');
                if (firstDateElement) {
                    firstDateElement.textContent = getOrInitFirstIndiceDate();
                }

                self.openModal(indiceModal);
            };
            indiceProjetBtn.removeEventListener('mousedown', openIndiceHandler); // Prevent duplicates
            indiceProjetBtn.addEventListener('mousedown', openIndiceHandler);
        }

        const addIndiceRowBtn = document.getElementById('add-indice-row-btn');
        if (addIndiceRowBtn) {
            const addRowHandler = () => self.addIndiceRow();
            addIndiceRowBtn.removeEventListener('mousedown', addRowHandler); // Prevent duplicates
            addIndiceRowBtn.addEventListener('mousedown', addRowHandler);
        }

        // Règlements modal
        const reglementModal = document.getElementById('reglement-modal');
        const lesReglements = document.getElementById('les_reglements');

        if (lesReglements) {
            const openReglementHandler = () => self.openModal(reglementModal);
            lesReglements.removeEventListener('mousedown', openReglementHandler); // Prevent duplicates
            lesReglements.addEventListener('mousedown', openReglementHandler);
        }

        this.setupCharacterCounters();

        // Close buttons (pour les modals secondaires)
        const closeButtons = document.querySelectorAll('[data-close-modal]');
        closeButtons.forEach(button => {
            const handleSecondaryClose = (event) => {
                const modalId = button.dataset.closeModal;
                if (modalId) {
                    self.closeModal(document.getElementById(modalId));
                }
            };
            button.removeEventListener('mousedown', handleSecondaryClose);
            button.addEventListener('mousedown', handleSecondaryClose);
        });


        // --- Backdrop Click Listener (MODIFIED) ---
        const handleBackdropClick = (e) => {
            // Use a very short timeout to ensure this runs after mouseup/drag events complete
            setTimeout(() => {
                // CORRECTION : Vérifier les flags de classe (isResizing/isDragging)
                // pour empêcher la fermeture pendant ces actions.
                if (self.justResizedOrDragged || self.isResizing || self.isDragging) {
                    self.justResizedOrDragged = false; // Reset flag after check
                    return;
                }
                // Close secondary modals on backdrop click
                if (e.target.classList.contains('modal-backdrop')) {
                    self.closeModal(e.target);
                }
                // Close main modal on overlay click
                if (e.target.id === 'parametres-modal') {
                    closeMainModal();
                }
            }, 0);
        };
        // Remove existing listener before adding a new one
        window.removeEventListener('mousedown', handleBackdropClick);
        window.addEventListener('mousedown', handleBackdropClick);
        // --- End Backdrop Click Listener ---

        // Set initial date for indice modal (restaure la date de création si déjà persistée)
        const firstDateElement = document.getElementById('firstDateIndice');
        if (firstDateElement) {
            firstDateElement.textContent = getOrInitFirstIndiceDate();
        } else {
            console.warn("Element with ID 'firstDateIndice' not found.");
        }
    }

    setupModalZIndexFix() {
        const moveModalsToBody = () => {
            // Liste des IDs de vos modales secondaires
            const secondaryModals = ['indice-modal', 'reglement-modal', 'information-modal'];

            secondaryModals.forEach(id => {
                const modal = document.getElementById(id);
                // Si la modale existe et n'est pas déjà directement dans le body
                if (modal && modal.parentNode !== document.body) {
                    document.body.appendChild(modal);
                }
            });
        };

        // Exécuter immédiatement
        moveModalsToBody();

        // Gestion spécifique pour Bootstrap ou chargements dynamiques
        document.addEventListener('show.bs.modal', (event) => {
            const modalElement = event.target;
            if (modalElement.id !== 'parametres-modal') {
                modalElement.style.setProperty('z-index', '10001', 'important');

                // Ajuster le backdrop qui vient d'être créé par Bootstrap
                setTimeout(() => {
                    const backdrops = document.querySelectorAll('.modal-backdrop');
                    if (backdrops.length > 0) {
                        backdrops[backdrops.length - 1].style.setProperty('z-index', '10000', 'important');
                    }
                }, 10);
            }
        });
    }

    setupIRVEAndValorisation() {
        const irveCheckbox = document.getElementById('couplage_irve_oui');
        let savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        const projectId = localStorage.getItem('current_projet_id') || 'default';
        const irveKey = `irve_status_${projectId}`;
        const valKey = `val_status_${projectId}`;

        if (irveCheckbox) {
            const cachedIrve = localStorage.getItem(irveKey);

            if (cachedIrve !== null) {
                irveCheckbox.checked = (cachedIrve === 'true');
            } else if (savedData.projectInfo && savedData.projectInfo.irve !== undefined) {
                irveCheckbox.checked = savedData.projectInfo.irve === true;
            } else {
                if (!savedData.projectInfo) savedData.projectInfo = {};
                savedData.projectInfo.irve = irveCheckbox.checked;
                localStorage.setItem('solarProjectData', JSON.stringify(savedData));
            }

            irveCheckbox.addEventListener('change', (e) => {
                const isOui = e.target.checked;
                localStorage.setItem(`irve_status_${localStorage.getItem('current_projet_id') || 'default'}`, isOui);

                let data = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                if (!data.projectInfo) data.projectInfo = {};
                data.projectInfo.irve = isOui;
                localStorage.setItem('solarProjectData', JSON.stringify(data));

                // TICKET 3 : Désynchronisation IRVE si option passe à NON
                if (!isOui) {
                    localStorage.removeItem('sharedIrveData');
                    localStorage.removeItem('stagedIrveData');
                }

                window.dispatchEvent(new CustomEvent('solarProjectDataSaved'));
            });
        }

        const cachedVal = localStorage.getItem(valKey);
        if (cachedVal) {
            const valHiddenInput = document.getElementById('mode_de_valorisation');
            if (valHiddenInput) valHiddenInput.value = cachedVal;
        } else if (savedData.projectInfo && savedData.projectInfo.mode_de_valorisation) {
            const valHiddenInput = document.getElementById('mode_de_valorisation');
            if (valHiddenInput) valHiddenInput.value = savedData.projectInfo.mode_de_valorisation;
        }
    }

    setupCharacterCounters() {
        const fields = [
            { id: 'reglement_urbanisme', counter: '#reglement_urbanisme_counter' },
            { id: 'contraintes_specifiques', counter: '#contraintes_specifiques_counter' },
            { id: 'hypotheses_de_conception', counter: '#hypotheses_de_conception_counter' }
        ];

        fields.forEach(field => {
            const element = document.getElementById(field.id);
            const counterElement = document.querySelector(field.counter);

            if (element && counterElement) {
                const updateCounterListener = () => {
                    const maxLength = 600;
                    let text = element.value;
                    if (text.length > maxLength) {
                        element.value = text.substring(0, maxLength);
                        text = element.value;
                    }
                    counterElement.textContent = text.length;
                };

                element.removeEventListener('input', updateCounterListener);
                element.addEventListener('input', updateCounterListener);
                updateCounterListener();
            } else {
                console.warn(`Counter setup failed for field: ${field.id} or counter: ${field.counter}`);
            }
        });
    }


    addIndiceRow() {
        const indiceTableBody = document.querySelector('#indice-table tbody');
        if (!indiceTableBody) return;

        const newRow = indiceTableBody.insertRow();
        const dataRows = indiceTableBody.querySelectorAll('tr');
        const lastDataRow = dataRows.length > 0 ? dataRows[dataRows.length - 1] : null;

        let nextIndex = 'A';

        if (lastDataRow) {
            const lastIndexCell = lastDataRow.cells[0];
            if (lastIndexCell) {
                const lastIndex = lastIndexCell.textContent.trim();
                if (lastIndex && lastIndex.length === 1 && lastIndex >= 'A' && lastIndex < 'Z') {
                    nextIndex = String.fromCharCode(lastIndex.charCodeAt(0) + 1);
                } else {
                    nextIndex = String.fromCharCode('A'.charCodeAt(0) + dataRows.length);
                    if (nextIndex > 'Z') nextIndex = `I${dataRows.length + 1}`;
                }
            }
        } // No else needed, default is 'A'

        const cellIndex = newRow.insertCell(0);
        const cellDate = newRow.insertCell(1);
        const cellDesc = newRow.insertCell(2);
        const cellAction = newRow.insertCell(3);

        cellIndex.textContent = nextIndex;
        cellDate.textContent = new Date().toLocaleDateString('fr-FR');
        cellDesc.innerHTML = '<input type="text" placeholder="Description de l\'indice" style="width: 100%; border: 1px solid #ccc; padding: 5px;">';

        cellAction.innerHTML = '<button type="button" class="btn-delete-indice" title="Supprimer la ligne"><i class="fas fa-trash text-danger"></i></button>';

        const deleteBtn = cellAction.querySelector('.btn-delete-indice');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function () {
                this.closest('tr').remove();
            });
        }
    }


    async loadProjects() {
        const tableBody = document.getElementById('projects-table-body');
        if (!tableBody) return;

        try {
            // Using simulated data as placeholder
            const simulatedData = {
                success: true,
                projets: [
                    { id: 1, nom: "Projet Alpha", adresse: "1 Rue Principale, 75001 Paris", date_edition: "25/10/2025", auteur: "Admin", type_etude: "Pré-étude" },
                    { id: 2, nom: "Projet Beta", adresse: "2 Avenue Foch, 69006 Lyon", date_edition: "24/10/2025", auteur: "User1", type_etude: "Études détaillée" },
                    { id: 3, nom: "Projet Gamma", adresse: "3 Boulevard Victor Hugo, 06000 Nice", date_edition: "23/10/2025", auteur: "User2", type_etude: "Pré-étude" }
                ]
            };

            const data = simulatedData;

            if (data.success && data.projets && data.projets.length > 0) {
                this.allProjects = data.projets;
                this.displayProjects(this.allProjects);
                this.setupSearch();
            } else {
                tableBody.innerHTML = '<tr><td colspan="7" class="text-center">Aucun projet trouvé.</td></tr>';
            }
        } catch (error) {
            console.error('Erreur:', error);
            tableBody.innerHTML = '<tr><td colspan="7" class="text-center">Erreur de chargement.</td></tr>';
        }
    }

    setupSearch() {
        const searchInput = document.getElementById('searchInput');
        if (!searchInput) return;

        let searchTimeout;
        const handleSearchInput = () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const term = searchInput.value.toLowerCase().trim();
                if (!this.allProjects) return;
                const filtered = this.allProjects.filter(p =>
                    p.nom?.toLowerCase().includes(term) ||
                    p.adresse?.toLowerCase().includes(term) ||
                    p.date_edition?.toLowerCase().includes(term) ||
                    p.auteur?.toLowerCase().includes(term) ||
                    (p.type_etude && p.type_etude.toLowerCase().includes(term))
                );
                this.displayProjects(filtered);
            }, 300);
        }

        searchInput.removeEventListener('input', handleSearchInput);
        searchInput.addEventListener('input', handleSearchInput);
    }

    displayProjects(projects) {
        const tbody = document.querySelector('#projects-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (!projects || projects.length === 0) {
            tbody.innerHTML = '<tr class="fade-in"><td colspan="7" class="text-center">Aucun projet trouvé.</td></tr>';
            return;
        }

        projects.forEach((project, index) => {
            const formattedAddress = project.adresse ? project.adresse.replace(',', '<br>') : 'N/A';
            let typeEtudeDisplay = project.type_etude || project.statut || 'N/A';
            const typeEtudeMin = typeEtudeDisplay.toLowerCase();
            if (typeEtudeMin.includes('pré-étude') || typeEtudeMin.includes('technico')) {
                typeEtudeDisplay = 'Étude technico-économique';
            } else if (typeEtudeMin.includes('détaillée') || typeEtudeMin.includes('conception')) {
                typeEtudeDisplay = 'Étude de conception';
            }

            const row = document.createElement('tr');
            row.classList.add('fade-in');
            row.style.animationDelay = `${index * 50}ms`;

            row.innerHTML = `
                <td class="text-center">${project.id || 'N/A'}</td>
                <td class="text-center">${project.nom || 'N/A'}</td>
                <td class="text-center">${formattedAddress}</td>
                <td class="text-center">${project.date_edition || 'N/A'}</td>
                <td class="text-center">${project.auteur || 'N/A'}</td>
                <td class="text-center">${typeEtudeDisplay}</td>
                <td class="text-center bouton_mes_projets">
                    <i class="fa fa-edit text-primary" title="Éditer"></i>
                    <i class="fa fa-copy text-info" title="Copier"></i>
                    <i class="fa fa-trash text-danger" title="Supprimer"></i>
                    <i class="fa fa-share text-secondary" title="Partager"></i>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    openModal(modal) {
        if (modal) {
            // Éviter le blocage par le contexte d'empilement du parent
            if (modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            modal.style.display = 'flex';
            modal.style.setProperty('z-index', '105000', 'important');
        }
    }

    closeModal(modal) {
        if (modal) modal.style.display = 'none';
    }


    initModalDragResize() {
        const modal = document.getElementById('parametres-modal');
        if (!modal) return;

        const modalContainer = modal.querySelector('.modal-container');
        const header = document.getElementById('modal-header-draggable');
        const resizeHandle = document.getElementById('modal-resize-handle');
        const resetBtn = document.getElementById('reset-modal-size');

        if (!modalContainer || !header || !resizeHandle || !resetBtn) return;

        // CORRECTION : `isDragging` et `isResizing` sont maintenant `this.isDragging`
        // et `this.isResizing` (définis dans le constructeur).
        // On garde `offset` et `lastMousePos` locaux car ils ne sont utilisés
        // que par les fonctions de cet scope.
        let offset = { x: 0, y: 0 };
        let lastMousePos = { x: 0, y: 0 };

        const initialSize = {
            width: modalContainer.offsetWidth,
            height: modalContainer.offsetHeight
        };
        const initialStyleWidth = modalContainer.style.width || window.getComputedStyle(modalContainer).width;
        const initialStyleHeight = modalContainer.style.height || window.getComputedStyle(modalContainer).height;


        const minWidth = 600;
        const minHeight = 480;
        const self = this;

        // --- DRAG ---
        const dragMouseDown = (e) => {
            if (e.target.closest('.modal-header-btn, .modal-close')) return;

            self.isDragging = true;
            self.isResizing = false;
            self.justResizedOrDragged = false;

            const rect = modalContainer.getBoundingClientRect();
            const currentTop = parseFloat(modalContainer.style.top) || rect.top;
            const currentLeft = parseFloat(modalContainer.style.left) || rect.left;

            modalContainer.style.top = currentTop + 'px';
            modalContainer.style.left = currentLeft + 'px';

            offset.x = e.clientX - currentLeft;
            offset.y = e.clientY - currentTop;

            modal.style.justifyContent = ''; // Remove centering
            modal.style.alignItems = '';

            document.body.style.userSelect = 'none';
            header.style.cursor = 'grabbing';

            // Attach move/up listeners to document
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        };
        header.removeEventListener('mousedown', dragMouseDown); // Prevent duplicates
        header.addEventListener('mousedown', dragMouseDown);


        // --- RESIZE ---
        const resizeMouseDown = (e) => {
            e.stopPropagation(); // Prevent header drag
            self.isResizing = true;
            self.isDragging = false;
            self.justResizedOrDragged = false;
            lastMousePos.x = e.clientX;
            lastMousePos.y = e.clientY;
            document.body.style.userSelect = 'none';

            // Attach move/up listeners to document
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        };
        resizeHandle.removeEventListener('mousedown', resizeMouseDown); // Prevent duplicates
        resizeHandle.addEventListener('mousedown', resizeMouseDown);


        // --- MOUSEMOVE (Global Listener Logic) ---
        const handleMouseMove = (e) => {
            if (self.isDragging) {
                e.preventDefault();
                let newTop = e.clientY - offset.y;
                let newLeft = e.clientX - offset.x;

                const parentRect = modal.getBoundingClientRect(); // Overlay rect
                const containerRect = modalContainer.getBoundingClientRect(); // Current modal size

                // Constrain within viewport (relative to overlay origin at 0,0)
                if (newTop < 0) newTop = 0;
                if (newLeft < 0) newLeft = 0;
                if (newTop + containerRect.height > window.innerHeight) newTop = window.innerHeight - containerRect.height;
                if (newLeft + containerRect.width > window.innerWidth) newLeft = window.innerWidth - containerRect.width;

                modalContainer.style.left = newLeft + 'px';
                modalContainer.style.top = newTop + 'px';
            }

            if (self.isResizing) {
                e.preventDefault();
                const dx = e.clientX - lastMousePos.x;
                // const dy = e.clientY - lastMousePos.y; // Keep dy if needed for different resize logic

                const rect = modalContainer.getBoundingClientRect();
                let newWidth = rect.width + dx;
                // let newHeight = rect.height + dy; // Alternative: resize based on vertical drag too

                // Get current position for max width/height calculation
                const currentTop = parseFloat(modalContainer.style.top) || rect.top;
                const currentLeft = parseFloat(modalContainer.style.left) || rect.left;

                const maxWidth = window.innerWidth - currentLeft - 10; // Max width considering position
                const maxHeight = window.innerHeight - currentTop - 10; // Max height

                // Apply min constraints first
                if (newWidth < minWidth) newWidth = minWidth;

                // Calculate height based on width and ratio
                let newHeight = newWidth * 0.8;

                // Check min height AFTER ratio calculation
                if (newHeight < minHeight) {
                    newHeight = minHeight;
                    newWidth = newHeight / 0.8; // Recalculate width
                }

                // Apply max constraints, recalculating the other dimension to keep ratio
                if (newWidth > maxWidth) {
                    newWidth = maxWidth;
                    newHeight = newWidth * 0.8;
                    if (newHeight < minHeight) newHeight = minHeight; // Re-check min height
                }
                if (newHeight > maxHeight) {
                    newHeight = maxHeight;
                    newWidth = newHeight / 0.8;
                    if (newWidth < minWidth) newWidth = minWidth; // Re-check min width
                    // Re-check max width after height adjustment
                    if (newWidth > maxWidth) {
                        newWidth = maxWidth;
                        newHeight = newWidth * 0.8; // Final height adjustment
                    }
                }


                modalContainer.style.width = newWidth + 'px';
                modalContainer.style.height = newHeight + 'px';

                lastMousePos.x = e.clientX;
                lastMousePos.y = e.clientY;

                // Recalculer la taille de la carte Leaflet
                if (window.parametreProjetManager) {
                    window.parametreProjetManager.resizeMap();
                }
            }
        };

        // --- MOUSEUP (Global Listener Logic) ---
        const handleMouseUp = () => {
            if (self.isDragging || self.isResizing) {
                self.justResizedOrDragged = true;
                setTimeout(() => { self.justResizedOrDragged = false; }, 50);
            }

            if (self.isDragging) {
                header.style.cursor = 'move'; // Reset cursor
            }

            self.isDragging = false;
            self.isResizing = false;
            document.body.style.userSelect = 'auto'; // Re-enable text selection

            // Remove global listeners ONLY when drag/resize ends
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };


        // --- RESET ---
        const handleResetClick = () => {
            // Use the stored initial style values (could be vw/px)
            modalContainer.style.width = initialStyleWidth;
            modalContainer.style.height = initialStyleHeight;
            modalContainer.style.top = ''; // Reset position
            modalContainer.style.left = '';

            modal.style.display = 'flex'; // Re-apply centering
            modal.style.justifyContent = 'center';
            modal.style.alignItems = 'center';
            self.justResizedOrDragged = false;

            if (window.parametreProjetManager) {
                window.parametreProjetManager.resizeMap();
            }
        };

        resetBtn.removeEventListener('click', handleResetClick);
        resetBtn.addEventListener('click', handleResetClick);
    }
}

// Initialisation au chargement du DOM
if (!window.uiManagerInstance) {
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.uiManagerInstance) {
            window.uiManagerInstance = new UIManager();
            console.log("UIManager initialized.");

            // Example opener (Adapt this ID)
            const openBtn = document.getElementById('open-params-btn');
            if (openBtn) {
                openBtn.removeEventListener('click', openModalHandler); // Prevent duplicates
                openBtn.addEventListener('click', openModalHandler);
                function openModalHandler() {
                    if (window.uiManagerInstance) {
                        window.uiManagerInstance.openMainModal();
                    }
                }
            } else {
                // console.warn("Button with id 'open-params-btn' not found.");
            }

            // Obligation de projet actif (cf. app/middleware/auth_middleware.py:active_project_required) :
            // couvre à la fois l'arrivée directe sur la page de calepinage (aucun projet en
            // localStorage) et le retour depuis une page protégée (Système, Export, Géométrie,
            // Autoconsommation, Étude économique, modales) qui a redirigé ici faute de projet actif
            // en session. Dans les deux cas, on force l'ouverture du modal "Mes projets"/"Créer un
            // projet" plutôt que de laisser l'utilisateur sur une carte vide sans explication.
            try {
                const params = new URLSearchParams(window.location.search);
                const redirectedForNoProject = params.get('no_active_project') === '1';
                let currentProjetId = localStorage.getItem('current_projet_id');

                // CORRIGÉ (bug "flash de la carte de calepinage puis retour au modal Paramètres") :
                // selectAndLoadProject() (parametreProjetFormManager.js) écrit déjà current_projet_id
                // en localStorage avant cette redirection plein page, mais cette vérification s'exécute
                // parfois avant que cette valeur ne soit disponible ici. Le paramètre d'URL
                // 'activated_project' porte le même ID de façon fiable à travers la navigation : on
                // s'en sert en priorité, on le recopie en localStorage par sécurité, et on ne déclenche
                // JAMAIS la réouverture automatique du modal quand il est présent.
                const activatedProjectId = params.get('activated_project');
                if (activatedProjectId) {
                    currentProjetId = activatedProjectId;
                    localStorage.setItem('current_projet_id', activatedProjectId);
                }

                if (!currentProjetId) {
                    window.uiManagerInstance.openMainModal();
                    if (redirectedForNoProject) {
                        showActiveProjectRequiredMessage('Vous devez créer ou sélectionner un projet pour accéder au reste de l\'application.');
                    }
                }

                // « Créer un nouveau projet » (DataManager.demarrerNouveauProjet) : projet quitté déjà
                // enregistré et retiré de la session ; la page rechargée ouvre le formulaire vierge.
                // apresRechargement : jamais de second rechargement (pas de boucle).
                const nouveauProjet = params.get('nouveau_projet') === '1';
                if (nouveauProjet && !activatedProjectId) {
                    const debut = Date.now();
                    const ouvrirCreation = () => {
                        const dm = window.dataManager;
                        if (dm && typeof dm.demarrerNouveauProjet === 'function') {
                            Promise.resolve(dm.demarrerNouveauProjet({ apresRechargement: true }))
                                .catch((e) => console.warn('Ouverture du formulaire de création :', e));
                        } else if (Date.now() - debut < 15000) {
                            setTimeout(ouvrirCreation, 100);
                        }
                    };
                    setTimeout(ouvrirCreation, 0);
                }

                if (redirectedForNoProject || activatedProjectId || nouveauProjet) {
                    // Nettoyer l'URL pour éviter de rouvrir le message/rejouer l'activation à chaque
                    // rechargement manuel
                    params.delete('no_active_project');
                    params.delete('activated_project');
                    params.delete('nouveau_projet');
                    const cleanQuery = params.toString();
                    const cleanUrl = window.location.pathname + (cleanQuery ? `?${cleanQuery}` : '');
                    window.history.replaceState({}, '', cleanUrl);
                }
            } catch (error) {
                console.warn('Erreur lors du traitement de no_active_project:', error);
            }
        }
    });
}

// Ajout CSS paramètres projets section Personalisation rapport avec logo utilisateur

// Placeholder pour la variable globale issue de l'environnement source
let companyLogoBase64 = null;

/**
 * Fonction d'initialisation et de gestion des paramètres d'entreprise
 * Totalement autonome et isolée.
 */
function initCompanySettings() {
    const logoInput = document.getElementById('company_logo');
    const nameInput = document.getElementById('company_name');
    const phoneInput = document.getElementById('company_phone');
    const addrInput = document.getElementById('company_address');
    const saveCheckbox = document.getElementById('save_company_info');

    // Éléments de prévisualisation ajoutés pour l'extraction autonome
    const logoPreviewContainer = document.getElementById('logo-preview-container');
    const logoPreview = document.getElementById('logo-preview');

    if (!logoInput || !nameInput) return; // Sécurité si le HTML n'est pas chargé

    // 1. Chargement des données sauvegardées (Local Storage)
    const savedData = JSON.parse(localStorage.getItem('skv_company_info') || '{}');

    if (savedData.save) {
        if (savedData.name) nameInput.value = savedData.name;
        if (savedData.phone) phoneInput.value = savedData.phone;
        if (savedData.address) addrInput.value = savedData.address;

        if (savedData.logo) {
            companyLogoBase64 = savedData.logo;
            // Restauration de l'aperçu du logo
            logoPreview.src = companyLogoBase64;
            logoPreviewContainer.style.display = 'flex';
        }
        saveCheckbox.checked = true;
    }

    // 2. Fonction de sauvegarde
    const saveData = () => {
        if (saveCheckbox.checked) {
            const data = {
                save: true,
                name: nameInput.value,
                phone: phoneInput.value,
                address: addrInput.value,
                logo: companyLogoBase64
            };
            localStorage.setItem('skv_company_info', JSON.stringify(data));
            console.log("Paramètres d'entreprise sauvegardés.");
        } else {
            localStorage.removeItem('skv_company_info');
            console.log("Paramètres d'entreprise supprimés du cache local.");
        }
    };

    // 3. Listeners sur les champs texte et checkbox
    [nameInput, phoneInput, addrInput, saveCheckbox].forEach(el => {
        el.addEventListener('change', saveData);
        el.addEventListener('input', () => {
            // Optionnel : sauvegarde en temps réel si la case est cochée
            if (saveCheckbox.checked) saveData();
        });
    });

    // 4. Listener sur l'upload d'image avec encodage en Base64
    logoInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (evt) {
            // Stockage de la chaine Base64
            companyLogoBase64 = evt.target.result;

            // Mise à jour de l'UI d'aperçu
            logoPreview.src = companyLogoBase64;
            logoPreviewContainer.style.display = 'flex';

            // Sauvegarde immédiate si l'option est cochée
            saveData();
        };
        reader.readAsDataURL(file);
    });
}

// Lancement de l'initialisation dès que le DOM est prêt
document.addEventListener('DOMContentLoaded', initCompanySettings);

// Synchronisation en direct des champs Latitude/Longitude PVGIS (carte "Localisation projet",
// onglet "Mode de calcul et Normes") dès qu'une adresse est choisie ou qu'un marqueur est
// placé/déplacé sur la carte (onglet "Créer un nouveau projet"). Événement émis par
// parametreProjetMap/initialisationMap.js:addOrUpdateParametreMarker(). Enregistré ici au
// niveau module (et non dans un DOMContentLoaded) pour être actif avant toute restauration
// d'un marqueur existant au chargement de la carte.
document.addEventListener('projectLocationUpdated', (e) => {
    const { lat, lng } = e.detail || {};
    if (lat === undefined || lng === undefined || lat === null || lng === null) return;
    const latEl = document.getElementById('pv_lat');
    const lonEl = document.getElementById('pv_lon');
    if (latEl) latEl.value = Number(lat).toFixed(6);
    if (lonEl) lonEl.value = Number(lng).toFixed(6);
});