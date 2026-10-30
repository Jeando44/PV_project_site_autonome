/**
 * Inclinaison et pertes partagées entre le pompage solaire et le calepinage résidentiel.
 * ======================================================================================
 * « Inclinaison des panneaux (°) » et « Pertes du système (%) » du pompage solaire (modale
 * Consommation d'énergie, section 2, en iframe) <-> « Pente toiture 1 (°) » (state.penteDeg) et
 * « Pertes système (%) » (state.perteSysteme) des champs PV du calepinage : une seule saisie.
 *
 * Le pompage est en général renseigné AVANT le calepinage : ses valeurs sont donc gardées par projet
 * (localStorage, complété depuis la base du pompage sur un autre navigateur) et un champ PV qui naît
 * les reprend (createDefaultState, orchestrateur). Ensuite, toute saisie d'un côté est reportée de
 * l'autre :
 *  - pompage -> calepinage : appliquerParametresPompage(), appelé par l'iframe du pompage ;
 *  - calepinage -> pompage : signalerSaisieParametre() (formulaire résidentiel) met à jour les
 *    valeurs du projet et prévient l'iframe si elle est chargée ; sinon le pompage relit les champs PV
 *    à son ouverture (lireParametresPompage()).
 *
 * Champs PV liés : ceux dont la case « Pompage solaire » est cochée, à défaut tous les champs.
 *
 * Dernière saisie gagnante : chaque saisie est datée, côté champ PV (state.parametresProductionSaisis,
 * persisté avec le champ) et côté pompage (saisiLe des valeurs du projet). À la synchronisation, le
 * pompage reprend la valeur du calepinage seulement si celui-ci a été modifié après lui.
 */
(function () {
    'use strict';

    const CM = window.CalepinageMaisonIndiv;
    if (!CM) return;

    const PARAMETRES = ['penteDeg', 'perteSysteme'];
    // Bornes du calepinage (formulaire résidentiel).
    const BORNES = { penteDeg: { min: 0, max: 90 }, perteSysteme: { min: 6, max: 30 } };
    // Valeurs qu'un champ reçoit sans saisie : défauts de createDefaultState et pentes posées à la
    // bascule du type de structure (toiture terrasse 3°, ombrière métal 8°).
    const VALEURS_NON_SAISIES = { penteDeg: [15, 3, 8], perteSysteme: [10] };
    const cle = (projetId) => `pompage_parametres_production:${projetId}`;
    const urlPompage = (projetId) => `/concevoir_mon_projet/parametre-projet/${encodeURIComponent(projetId)}/pompage-solaire/load`;

    function projetCourant() {
        try { return localStorage.getItem('current_projet_id') || null; } catch (e) { return null; }
    }

    const valide = (p, v) => Number.isFinite(v) && v >= BORNES[p].min && v <= BORNES[p].max;

    function lireProjet() {
        const projetId = projetCourant();
        if (!projetId) return null;
        let v = null;
        try { v = JSON.parse(localStorage.getItem(cle(projetId)) || 'null'); } catch (e) { v = null; }
        return v && typeof v === 'object' ? v : null;
    }

    /** Valeurs du projet (dernière saisie, pompage ou calepinage) ; null : pas de pompage dans ce projet. */
    function valeursProjet() {
        const v = lireProjet();
        if (!v) return null;
        const res = {};
        PARAMETRES.forEach((p) => { const n = Number(v[p]); if (valide(p, n)) res[p] = n; });
        return Object.keys(res).length ? res : null;
    }

    /** Date (ms) de la dernière saisie de `p` dans le pompage ; 0 si inconnue. */
    function dateSaisiePompage(p) {
        const v = lireProjet();
        const t = v && v.saisiLe && Number(v.saisiLe[p]);
        return Number.isFinite(t) ? t : 0;
    }

    /**
     * @param {object} valeurs  {penteDeg?, perteSysteme?}
     * @param {string[]} [saisis] paramètres que l'utilisateur vient de saisir dans le pompage (datés)
     */
    function ecrireValeursProjet(valeurs, saisis) {
        const projetId = projetCourant();
        if (!projetId || !valeurs) return;
        const res = Object.assign({}, valeursProjet());
        const saisiLe = Object.assign({}, (lireProjet() || {}).saisiLe);
        PARAMETRES.forEach((p) => {
            const n = Number(valeurs[p]);
            if (!valide(p, n)) return;
            res[p] = n;
            if (saisis && saisis.includes(p)) saisiLe[p] = Date.now();
        });
        if (!Object.keys(res).length) return;
        try { localStorage.setItem(cle(projetId), JSON.stringify(Object.assign(res, { saisiLe, majLe: new Date().toISOString() }))); } catch (e) { /* noop */ }
    }

    /** Pour createDefaultState : valeurs à donner à un champ PV qui naît ({} sans pompage). */
    function valeursPompageInitiales() {
        const v = valeursProjet();
        if (!v) { completerDepuisBase(); return {}; }
        return v;
    }

    /** Champs PV liés au pompage : ceux dont la case « Pompage solaire » est cochée, à défaut tous. */
    function champsPompage() {
        const champs = typeof CM.listerChampsCarte === 'function' ? CM.listerChampsCarte() : [];
        const avecPompage = champs.filter((c) => c.state.pompageSolaireActif);
        return avecPompage.length ? avecPompage : champs;
    }

    /** Saisie datée (ms) : la plus récente, du pompage ou d'un champ PV, l'emporte à la synchronisation. */
    function marquerParametreSaisi(state, p) {
        if (!state || !PARAMETRES.includes(p)) return;
        state.parametresProductionSaisis = Object.assign({}, state.parametresProductionSaisis, { [p]: Date.now() });
    }

    /** Date (ms) de la saisie de `p` dans ce champ ; 0 si jamais saisi ou marqué avant la datation (true). */
    function dateSaisieChamp(state, p) {
        const t = (state.parametresProductionSaisis || {})[p];
        return typeof t === 'number' && Number.isFinite(t) ? t : 0;
    }

    const estNonSaisi = (state, p) => !(state.parametresProductionSaisis || {})[p]
        && VALEURS_NON_SAISIES[p].includes(Number(state[p]));

    /**
     * Inclinaison et pertes des champs PV liés au pompage. `valeur` : celle du champ saisi en dernier
     * (à défaut du premier) ; `parDefaut` : aucun de ces champs n'a de valeur saisie (le pompage impose
     * alors la sienne) ; `uniforme` : même valeur partout ; `saisiLe` / `saisiLePompage` : dates (ms)
     * de la dernière saisie dans un champ PV / dans le pompage.
     */
    function lireParametresPompage() {
        const champs = champsPompage();
        const res = { nbChamps: champs.length };
        if (!champs.length) return res;
        PARAMETRES.forEach((p) => {
            const valeurs = champs.map((c) => Number(c.state[p]));
            const dates = champs.map((c) => dateSaisieChamp(c.state, p));
            const iDernier = dates.indexOf(Math.max(...dates));
            res[p] = {
                valeur: valeurs[iDernier],
                uniforme: valeurs.every((v) => v === valeurs[0]),
                parDefaut: champs.every((c) => estNonSaisi(c.state, p)),
                saisiLe: dates[iDernier],
                saisiLePompage: dateSaisiePompage(p),
            };
        });
        return res;
    }

    /** Inclinaison et pertes de chaque champ PV lié, pour le contrôle serveur au calcul de production. */
    function parametresChampsPompage() {
        return champsPompage().map(({ sourceId, state }) => ({
            source_id: sourceId, pente_deg: Number(state.penteDeg), perte_systeme: Number(state.perteSysteme),
        }));
    }

    /** Champ PV ouvert dans le formulaire résidentiel : saisies et rendu remis à jour. */
    function rafraichirChampOuvert(state) {
        if (state !== CM.state || !CM.modal || CM.modal.style.display === 'none' || !CM.modalBody) return;
        const pente = CM.modalBody.querySelector('#calepinageMaisonPenteInput');
        if (pente) pente.value = state.penteDeg;
        const perte = CM.modalBody.querySelector('#cmPerteSysteme');
        if (perte) perte.value = state.perteSysteme;
        CM.render(); CM.recomputeResults();
        if (CM.coupeModal && CM.coupeModal.style.display !== 'none') CM.renderCoupe();
    }

    /**
     * Écrit des valeurs dans les champs PV liés (état, localStorage + base, formulaire du champ ouvert).
     * La pente change la profondeur des rangées : le nombre de panneaux, donc la puissance, peut changer.
     * @param {{penteDeg?:number, perteSysteme?:number}} valeurs
     * @param {{seulementNonSaisis?:boolean}} [options] ne pas toucher aux valeurs déjà saisies
     * @returns {number} nombre de champs PV modifiés
     */
    function appliquerAuxChamps(valeurs, options) {
        const seulementNonSaisis = !!(options && options.seulementNonSaisis);
        let modifies = 0;
        champsPompage().forEach(({ sourceId, state }) => {
            let ecrit = false, change = false;
            PARAMETRES.forEach((p) => {
                const v = Number(valeurs && valeurs[p]);
                if (!valide(p, v) || (seulementNonSaisis && !estNonSaisi(state, p))) return;
                if (Number(state[p]) !== v) { state[p] = v; change = true; }
                marquerParametreSaisi(state, p);
                ecrit = true;
            });
            if (!ecrit) return;
            if (typeof CM.persisterEtatChamp === 'function') CM.persisterEtatChamp(sourceId, 'parametresPompage');
            if (!change) return;
            modifies += 1;
            rafraichirChampOuvert(state);
        });
        return modifies;
    }

    /** Saisie dans le pompage : valeurs du projet et champs PV liés mis à jour. */
    function appliquerParametresPompage(valeurs) {
        ecrireValeursProjet(valeurs);
        return appliquerAuxChamps(valeurs);
    }

    /**
     * Valeurs du pompage gardées pour le projet (champs PV dessinés ensuite, synchronisation suivante).
     * `saisis` : paramètres que l'utilisateur vient de saisir dans le pompage (datés).
     */
    function memoriserParametresPompage(valeurs, saisis) {
        ecrireValeursProjet(valeurs, saisis);
    }

    /**
     * Saisie de la pente ou des pertes dans le formulaire résidentiel. Champ lié dans un projet avec
     * pompage : valeur du projet mise à jour, iframe du pompage prévenue (si elle est chargée).
     */
    function signalerSaisieParametre(state, p) {
        marquerParametreSaisi(state, p);
        if (!valeursProjet() || !champsPompage().some((c) => c.state === state)) return;
        ecrireValeursProjet({ [p]: state[p] });
        document.dispatchEvent(new CustomEvent('calepinageParametresPompageChanged', {
            detail: { sourceId: state.sourceId, champ: p },
        }));
    }

    /** Projet avec pompage : la bascule de type de structure ne remplace pas la pente partagée. */
    const penteImposeeParPompage = () => !!(valeursProjet() && valeursProjet().penteDeg !== undefined);

    // Autre navigateur (localStorage vide) : valeurs relues dans la base du pompage, une fois par projet,
    // puis données aux champs PV encore sans saisie.
    const projetsInterroges = new Set();
    async function completerDepuisBase() {
        const projetId = projetCourant();
        if (!projetId || projetsInterroges.has(projetId)) return;
        projetsInterroges.add(projetId);
        try {
            const reponse = await fetch(urlPompage(projetId), { credentials: 'same-origin' });
            const res = await reponse.json().catch(() => ({}));
            const champs = res && res.success && res.config_exists && res.config && res.config.saisies && res.config.saisies.champs;
            if (!champs || projetCourant() !== projetId || valeursProjet()) return;
            const valeurs = { penteDeg: Number(champs.ps_angle), perteSysteme: Number(champs.ps_perte_systeme) };
            ecrireValeursProjet(valeurs);
            if (valeursProjet()) appliquerAuxChamps(valeurs, { seulementNonSaisis: true });
        } catch (e) {
            console.warn('[CalepinageMaisonIndiv] Paramètres du pompage solaire indisponibles :', e);
        }
    }

    // ─── Extrait du calepinage ouvert depuis le pompage solaire ──────────────────────────────────────
    // Bouton de la section 2 du pompage (demande explicite) : le formulaire du champ PV lui-même, réduit
    // à la pente, au panneau, à l'onduleur et aux pertes système. Même état, même enregistrement que le
    // calepinage complet : aucune copie à tenir synchronisée. Pente et pertes repartent vers le pompage
    // par signalerSaisieParametre ; à la fermeture, 'calepinageExtraitPompageFerme' lui fait tout relire.

    const CLASSE_EXTRAIT = 'cm-extrait-pompage';
    // Blocs gardés (avec leurs descendants et leurs ancêtres) ; tout le reste du formulaire est masqué.
    const CONSERVES_EXTRAIT = ['#cmExtraitPompageAide', '#calepinageMaisonPenteWrapper', '#calepinageMaisonPente2Wrapper',
        '#cmMaterielPanneauSection', '#cmMaterielSystemeSection', '#cmPerteSystemeWrapper'].join(', ');
    const TITRE_EXTRAIT = 'Calepinage — pente, matériels et pertes (pompage solaire)';

    let extraitActif = false;
    let ouvertureExtrait = false;
    let sectionsOuvertes = [];
    let titreOrigine = null;

    function installerStyleExtrait() {
        if (document.getElementById('cmExtraitPompageStyle')) return;
        const style = document.createElement('style');
        style.id = 'cmExtraitPompageStyle';
        // Le modal reste au-dessus de la modale Consommation d'énergie (z-index 999998), en panneau à
        // droite. :is() pour les blocs gardés ; les <summary> restent : titres des sections ouvertes.
        style.textContent = `
            #calepinageMaisonModal.${CLASSE_EXTRAIT} { width: min(440px, calc(100vw - 16px)) !important; max-width: calc(100vw - 16px) !important; left: auto !important; right: 8px !important; }
            .${CLASSE_EXTRAIT} #cmRightPanel, .${CLASSE_EXTRAIT} #cmHeaderToggles { display: none !important; }
            .${CLASSE_EXTRAIT} #cmLeftPanel { width: 100% !important; border-left: none !important; padding-left: 0 !important; }
            .${CLASSE_EXTRAIT} #cmLeftPanel *:not(:is(${CONSERVES_EXTRAIT})):not(:is(${CONSERVES_EXTRAIT}) *):not(:has(:is(${CONSERVES_EXTRAIT}))):not(summary):not(summary *) { display: none !important; }
            .${CLASSE_EXTRAIT} #cmExtraitPompageAide { display: block !important; }
        `;
        document.head.appendChild(style);
    }

    function titreModal() {
        const h2 = CM.modal && CM.modal.querySelector('.modal-header-maison h2');
        return h2 ? Array.from(h2.childNodes).reverse().find((n) => n.nodeType === 3 && n.textContent.trim()) : null;
    }

    function entrerModeExtrait() {
        if (!CM.modal || !CM.modalBody) return;
        installerStyleExtrait();
        const panneau = CM.modalBody.querySelector('#cmLeftPanel');
        if (panneau && !panneau.querySelector('#cmExtraitPompageAide')) {
            panneau.insertAdjacentHTML('afterbegin', '<p id="cmExtraitPompageAide" style="display:none; margin:0 0 10px; padding:6px 8px; font-size:0.75rem; color:#1e3a8a; background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px;">'
                + "Saisies enregistrées dans le calepinage du champ PV et reprises par le pompage solaire. Fermez (×) pour revenir au pompage.</p>");
        }
        CM.modal.classList.add(CLASSE_EXTRAIT);
        // Sections repliables qui contiennent les blocs gardés : ouvertes, état d'origine rendu à la sortie.
        const sections = new Set(Array.from(CM.modalBody.querySelectorAll(CONSERVES_EXTRAIT))
            .map((el) => el.closest('details')).filter(Boolean));
        if (!extraitActif) sectionsOuvertes = Array.from(sections).map((d) => [d, d.open]);
        sections.forEach((d) => { d.open = true; });
        const titre = titreModal();
        if (titre && titreOrigine === null) { titreOrigine = titre.textContent; titre.textContent = ` ${TITRE_EXTRAIT}`; }
        extraitActif = true;
    }

    /** Sortie du mode extrait (fermeture du modal, ou ouverture normale du calepinage). */
    function quitterExtraitPompage() {
        if (!extraitActif) return;
        extraitActif = false;
        if (CM.modal) CM.modal.classList.remove(CLASSE_EXTRAIT);
        sectionsOuvertes.forEach(([d, ouverte]) => { d.open = ouverte; });
        sectionsOuvertes = [];
        const titre = titreModal();
        if (titre && titreOrigine !== null) titre.textContent = titreOrigine;
        titreOrigine = null;
        document.dispatchEvent(new CustomEvent('calepinageExtraitPompageFerme'));
    }

    /**
     * Ouvre l'extrait sur un champ PV lié au pompage : le dernier ouvert, à défaut celui sélectionné
     * sur la carte, à défaut le premier.
     * @returns {{ok:boolean, message?:string}}
     */
    function ouvrirExtraitPompage() {
        const champs = champsPompage();
        if (!champs.length) {
            return { ok: false, message: "Aucun champ PV sur la carte : tracez d'abord le champ PV (calepinage), puis revenez ici pour régler pente, matériels et pertes." };
        }
        const mgr = window.MaisonPolygonManagerInstance;
        let dernier = null;
        try { dernier = sessionStorage.getItem('calepinage_maison_lastOpenSourceId'); } catch (e) { /* noop */ }
        const selection = mgr && mgr.selected && mgr.selected.maisonId;
        const champ = champs.find((c) => c.sourceId === dernier) || champs.find((c) => c.sourceId === selection) || champs[0];
        const poly = mgr && (mgr.polygons || []).find((p) => p && p.maisonId === champ.sourceId);
        if (!poly || typeof mgr._notifyReady !== 'function') {
            return { ok: false, message: 'Champ PV introuvable sur la carte : ouvrez le calepinage depuis la carte.' };
        }
        ouvertureExtrait = true;
        try { mgr._notifyReady(poly); } finally { ouvertureExtrait = false; }
        entrerModeExtrait();
        return { ok: true };
    }

    // Calepinage ouvert normalement (carte, palette, « Revenir au calepinage 2D ») : formulaire complet.
    const ouvrirModalOrigine = window.openCalepinageMaisonModal;
    if (typeof ouvrirModalOrigine === 'function') {
        window.openCalepinageMaisonModal = function (...args) {
            if (!ouvertureExtrait) quitterExtraitPompage();
            return ouvrirModalOrigine.apply(this, args);
        };
    }

    Object.assign(CM, {
        valeursPompageInitiales, lireParametresPompage, parametresChampsPompage, appliquerParametresPompage, memoriserParametresPompage,
        signalerSaisieParametre, marquerParametreSaisi, penteImposeeParPompage, ouvrirExtraitPompage, quitterExtraitPompage,
    });
})();
