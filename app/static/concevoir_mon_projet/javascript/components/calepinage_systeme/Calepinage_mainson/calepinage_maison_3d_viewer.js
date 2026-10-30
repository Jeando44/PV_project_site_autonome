/**
 * Calepinage résidentiel — visionneuse 3D Babylon.js (Phase 1).
 *
 * Le bouton "Basculer 2D/3D" de #cmToolbar (#cmView2D3DBtn, cf. calepinage_maison_toolbar_config.js)
 * appelle CM.toggle3DView(). En 3D :
 *  - un 2e <canvas> (WebGL) est créé À LA MÊME PLACE que #calepinageMaisonCanvas dans #cmRightPanel
 *    et affiché en alternance (el.hidden) — pas de nouvelle modale. Un même <canvas> ne pouvant
 *    porter qu'un seul type de contexte (2D OU WebGL) à vie, on ne réutilise pas le canevas 2D.
 *  - Babylon.js est chargé à la demande depuis le CDN, VERSION FIGÉE (pas "latest" : le POC existant
 *    geometrie_3D/test_3d.html utilisait "latest", non reproductible — corrigé ici).
 *  - la géométrie vient de CM.buildResidential3DModel() (calepinage_maison_3d_geometry.js).
 *
 * Licence Babylon.js : Apache-2.0 (open source, non breveté — conforme à la demande).
 */
(function () {
    const CM = window.CalepinageMaisonIndiv;
    if (!CM) return;

    // Version FIGÉE (dernière release 6.x, très stable ; Phase 1 n'utilise rien de spécifique à 7.x —
    // pas de "latest", contrairement au POC geometrie_3D/test_3d.html). cdnjs d'abord (déjà utilisé
    // partout dans l'app : html2canvas, jspdf, bootstrap...), repli sur le CDN officiel Babylon.
    // Pour mettre à jour : changer le seul numéro de version dans les 2 URL.
    const BABYLON_CDN_URLS = [
        'https://cdnjs.cloudflare.com/ajax/libs/babylonjs/6.49.0/babylon.js',
        'https://cdn.babylonjs.com/v6.49.0/babylon.js',
    ];

    let babylonLoading = null;
    let canvas3D = null;
    let controlsBar = null;
    let objectPalette = null;    // popup de la bibliothèque d'objets
    let shadowPalette = null;    // popup "Analyse d'ombrage"
    let objectModal = null;      // modale centrée d'édition d'un objet posé
    let engine = null;
    let scene = null;
    let camera = null;
    let sunLight = null;
    let onResize = null;
    let active = false;

    // --- Interaction objets 3D sur le canevas ---
    let modelCenter = { x: 0, z: 0 };      // recentrage repère local <-> monde (cf. buildResidential3DModel)
    const objRootById = {};                // id -> TransformNode (reconstruit à chaque buildScene)
    let selectedObj3DId = null;
    let highlightLayer = null;
    // Surbrillance de sélection : ambre discret (demande explicite : "réduire le jaune, trop vif").
    const SELECTION_HL_COLOR = () => new BABYLON.Color3(0.80, 0.62, 0.30);
    let rotationMode = false;
    let rotationGizmo = null;
    let gizmoLayer = null;
    let dragState = null;                  // { id, startGround:{x,z}, startPos:{x,z} } pendant un déplacement

    // Couleur par défaut des panneaux 3D — demande explicite : celle des panneaux sur la carte et le
    // canevas 2D (#1e293b, cf. calepinage_maison_carte_plans.js) au lieu de l'ancien bleu (#172957).
    const DEFAULT_PANEL_COLOR_3D = '#1e293b';
    // Choix du menu « Toit » (cf. texturePhotoToits) — défini ici car utilisé dès la barre de contrôle.
    // « auto » = photo de la vue en plan si une capture de carte couvre le pan, sinon texture type
    // du bâtiment (terrasse -> membrane, bâtiment incliné -> bac acier, résidentiel -> tuile).
    const ROOF_TEXTURES_3D = [
        { value: 'auto', label: 'Toit : auto (photo / type)' },
        { value: 'ardoise', label: 'Toit : ardoise' },
        { value: 'tuile', label: 'Toit : tuile' },
        { value: 'bac_acier', label: 'Toit : bac acier' },
        { value: 'membrane', label: 'Toit : membrane bitumineuse' },
        { value: 'gravillons', label: 'Toit : gravillons' },
        { value: 'uni', label: 'Toit : couleur unie' },
    ];

    // --- Analyse d'ombrage ---
    let shadowsOn = true; // ombres actives par défaut (demande explicite), décochables dans la palette soleil
    let shadowGen = null;
    let shadowHour = 13;                   // 6..20
    let shadowMonth = (new Date().getMonth() + 1); // 1..12

    // CORRECTIF (bug rapporté : "la génération du rapport tourne en boucle sans jamais se terminer")
    // : un CDN injoignable derrière un proxy qui absorbe la requête ne déclenche NI `onload` NI
    // `onerror`. La promesse restait donc pendante pour toujours, et tout appelant qui l'attendait
    // avec `await` restait bloqué avec elle — ce qui, depuis l'ajout de la capture 3D au rapport,
    // signifiait un rapport qui ne se termine jamais. Délai maximal explicite.
    const DELAI_MAX_CHARGEMENT_MS = 15000;
    function loadScript(url) {
        return new Promise((resolve, reject) => {
            let regle = false;
            const finir = (fn, arg) => { if (!regle) { regle = true; clearTimeout(minuteur); fn(arg); } };
            const minuteur = setTimeout(
                () => finir(reject, new Error('Délai dépassé (' + DELAI_MAX_CHARGEMENT_MS + ' ms) : ' + url)),
                DELAI_MAX_CHARGEMENT_MS,
            );
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = () => finir(resolve);
            s.onerror = () => finir(reject, new Error('Échec : ' + url));
            document.head.appendChild(s);
        });
    }

    /**
     * Borne l'attente d'une promesse. Renvoie `valeurParDefaut` si le délai est dépassé, sans jamais
     * rejeter : une capture qui échoue ne doit pas empêcher un export de se terminer.
     */
    function avecDelaiMax(promesse, ms, valeurParDefaut, libelle) {
        return new Promise((resolve) => {
            let regle = false;
            const finir = (v) => { if (!regle) { regle = true; resolve(v); } };
            const minuteur = setTimeout(() => {
                console.warn('[Calepinage maison 3D] Délai dépassé (' + ms + ' ms) : ' + (libelle || 'opération'));
                finir(valeurParDefaut);
            }, ms);
            Promise.resolve(promesse)
                .then((v) => { clearTimeout(minuteur); finir(v); })
                .catch((e) => {
                    clearTimeout(minuteur);
                    console.warn('[Calepinage maison 3D] Échec : ' + (libelle || 'opération'), e);
                    finir(valeurParDefaut);
                });
        });
    }

    function loadBabylon() {
        if (window.BABYLON) return Promise.resolve();
        if (babylonLoading) return babylonLoading;
        babylonLoading = BABYLON_CDN_URLS.reduce(
            (chain, url) => chain.catch(() => loadScript(url).then(() => {
                if (!window.BABYLON) throw new Error('Babylon chargé mais global absent');
            })),
            Promise.reject(new Error('init')),
        ).catch((err) => { babylonLoading = null; throw err; });
        return babylonLoading;
    }

    function ensureDom() {
        if (canvas3D) return;
        const rightPanel = CM.modalBody && CM.modalBody.querySelector('#cmRightPanel');
        const canvas2D = CM.modalBody && CM.modalBody.querySelector('#calepinageMaisonCanvas');
        if (!rightPanel || !canvas2D) return;

        // Barre de contrôle : TOUT sur une seule ligne (demande explicite), défilement horizontal si
        // ça déborde. display piloté par style.display (pas l'attribut [hidden], neutralisé par un
        // display inline).
        // CORRECTIF (bug rapporté : « les boutons du menu 3D ne s'affichent pas » sur un écran plus
        // petit) : #cmRightPanel est un flex en colonne ; avec overflow-x:auto, la hauteur minimale
        // automatique de la barre tombe à 0 et elle se faisait écraser par le canevas 3D (boutons
        // rognés). flex-shrink:0 lui garde sa hauteur quelle que soit la taille de l'écran.
        controlsBar = document.createElement('div');
        controlsBar.id = 'cm3DControlsBar';
        controlsBar.style.cssText = 'display:none; flex-wrap:nowrap; flex-shrink:0; gap:6px; align-items:center; margin-bottom:8px; overflow-x:auto; overflow-y:hidden; padding-bottom:2px;';
        controlsBar.innerHTML = `
            <button id="cm3DBackTo2DBtn" class="cm-btn" type="button" style="flex-shrink:0; background:#dc2626; color:#fff; border-color:#dc2626;">Retour au plan 2D</button>
            <button id="cm3DPaletteToggleBtn" class="cm-btn" type="button" style="flex-shrink:0;" title="Bibliothèque d'objets 3D">📦 Objets 3D</button>
            <button id="cm3DDrawBuildingBtn" class="cm-btn cm-icon-btn" type="button" style="flex-shrink:0;" title="Dessiner un bâtiment : cliquer les sommets de sa forme au sol, double-clic (ou clic sur le 1er point) pour terminer, puis saisir sa hauteur"><img src="/static/concevoir_mon_projet/medias/icons/polygon.svg" alt="" style="width:16px; height:16px;"></button>
            <button id="cm3DOmbriereFormBtn" class="cm-btn" type="button" style="flex-shrink:0; display:none;" title="Personnaliser l'ombrière (modèle + paramètres)">⛺ Ombrière</button>
            <button id="cm3DPetitChampBtn" class="cm-btn" type="button" style="flex-shrink:0; display:none;" title="Personnaliser le petit champ solaire (modèle + paramètres)">🔆 Petit champ solaire</button>
            <button id="cm3DShadowToggleBtn" class="cm-btn" type="button" style="flex-shrink:0;" title="Outils d'analyse d'ombrage">☀️ Ombrage</button>
            <button id="cm3DRotateBtn" class="cm-btn cm-icon-btn" type="button" style="flex-shrink:0;" title="Rotation de l'objet sélectionné"><img src="/static/concevoir_mon_projet/medias/icons/rotate-right.svg" alt="" style="width:16px; height:16px;"></button>
            <button id="cm3DDeleteBtn" class="cm-btn cm-icon-btn" type="button" style="flex-shrink:0;" title="Supprimer l'objet 3D sélectionné (touche Suppr) — les panneaux du champ PV ne sont jamais supprimés"><i class="fas fa-trash-alt"></i></button>
            <button id="cm3DPanBtn" class="cm-btn cm-icon-btn" type="button" style="flex-shrink:0;" title="Main : cliquer-glisser pour déplacer le dessin"><i class="fas fa-hand-paper"></i></button>
            <button id="cm3DMeasureBtn" class="cm-btn cm-icon-btn" type="button" style="flex-shrink:0;" title="Règle : cliquer 2 points de la scène pour mesurer leur distance (un 3e clic recommence)"><img src="/static/concevoir_mon_projet/medias/icons/cotations.svg" alt="" style="width:16px; height:16px;"></button>
            <label id="cm3DPanelColorBtn" class="cm-btn cm-icon-btn" style="flex-shrink:0; position:relative; display:inline-flex; align-items:center; gap:4px; width:auto; padding:0 6px; cursor:pointer; margin:0;" title="Couleur des panneaux (clic droit : couleur par défaut)">
                <i class="fas fa-palette"></i>
                <span id="cm3DPanelColorSwatch" style="display:inline-block; width:12px; height:12px; border-radius:2px; border:1px solid #9ca3af; background:${DEFAULT_PANEL_COLOR_3D};"></span>
                <input id="cm3DPanelColorInput" type="color" value="${DEFAULT_PANEL_COLOR_3D}" style="position:absolute; left:0; top:0; width:100%; height:100%; opacity:0; cursor:pointer; border:0; padding:0;">
            </label>
            <select id="cm3DRoofTextureSelect" class="cm-btn" style="flex-shrink:0; width:auto; padding:0 4px; margin:0;" title="Texture des toits (auto : photo de la vue en plan si une capture de carte est affichée)">
                ${ROOF_TEXTURES_3D.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}
            </select>
            <span style="flex-shrink:0; width:1px; align-self:stretch; background:#e5e7eb;"></span>
            <button class="cm-btn cm3d-view-btn" type="button" data-view="plan" style="flex-shrink:0;" title="Vue en plan (dessus)">Plan</button>
            <button class="cm-btn cm3d-view-btn" type="button" data-view="x" style="flex-shrink:0;" title="Élévation selon l'axe X">X</button>
            <button class="cm-btn cm3d-view-btn" type="button" data-view="y" style="flex-shrink:0;" title="Élévation selon l'axe Y">Y</button>
            <button class="cm-btn cm3d-view-btn" type="button" data-view="iso" style="flex-shrink:0;" title="Vue isométrique">Iso</button>
            <button id="cm3DCaptureBtn" class="cm-btn cm-icon-btn" type="button" style="flex-shrink:0;" title="Capturer la vue 3D pour le rapport (remplace la vue Iso automatique) — clic droit : supprimer la capture"><img src="/static/concevoir_mon_projet/medias/icons/camera.svg" alt="" style="width:16px; height:16px;"></button>
            <button id="cm3DZoomMaxBtn" class="cm-btn cm-icon-btn" type="button" style="flex-shrink:0;" title="Zoom maximal : cadrer au plus serré sur le bâtiment, les panneaux et les objets 3D (angle de vue conservé)"><i class="fas fa-search-plus"></i></button>
            <button id="cm3DResetViewBtn" class="cm-btn" type="button" style="flex-shrink:0;">Réinitialiser</button>
            <span id="cm3DStatus" style="flex-shrink:0; font-size:0.72rem; color:#6b7280; white-space:nowrap;"></span>
        `;

        // Popups flottants sous la barre (même principe que le sous-menu Obstacles de la barre 2D :
        // position:absolute, z-index, ne décale rien — la barre et ses icônes restent visibles).
        const popupCss = 'display:none; position:absolute; left:0; right:0; z-index:60; gap:8px; align-items:center; min-height:52px; padding:8px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; box-shadow:0 6px 18px rgba(0,0,0,0.18); overflow-x:auto; font-size:0.8rem;';
        objectPalette = document.createElement('div');
        objectPalette.id = 'cm3DObjectPalette';
        objectPalette.style.cssText = popupCss;
        shadowPalette = document.createElement('div');
        shadowPalette.id = 'cm3DShadowPalette';
        // Popup ANCRÉ À GAUCHE, largeur = son contenu (pas une barre pleine largeur), TOUT sur une
        // seule ligne (demande explicite : gagner de la hauteur pour le canevas). right:auto/width:auto
        // écrasent le left:0;right:0 de popupCss (dernière déclaration gagnante dans le style inline).
        shadowPalette.style.cssText = popupCss + ' right:auto; width:auto; max-width:98%; min-height:0; gap:14px; justify-content:flex-start; flex-wrap:nowrap;';
        const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
        const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
        shadowPalette.innerHTML = `
            <span style="flex-shrink:0; display:flex; align-items:center; gap:6px;">
                <label style="display:flex; align-items:center; gap:4px; white-space:nowrap;">
                    <input type="checkbox" id="cm3DShadowOn" checked> <span>Ombres</span>
                </label>
                <span id="cm3DShadowMonths" style="display:flex; gap:2px;">
                    ${MONTH_LETTERS.map((L, i) => `<button type="button" data-month="${i + 1}" title="${MONTH_NAMES[i]}" class="cm-btn" style="flex-shrink:0; width:22px; height:24px; padding:0; font-size:0.72rem;">${L}</button>`).join('')}
                </span>
            </span>
            <label style="flex-shrink:0; display:flex; align-items:center; gap:6px; white-space:nowrap;">
                <span>Heure</span>
                <input type="range" id="cm3DShadowHour" min="6" max="20" step="0.5" value="13" style="width:120px;">
                <span id="cm3DShadowHourVal" style="width:34px; text-align:right;">13h</span>
            </label>
            <select id="cm3DShadowMoment" style="flex-shrink:0; padding:2px 4px;" title="Positions solaires remarquables">
                <option value="">Repère…</option>
                <option value="3">Équinoxe</option>
                <option value="6">Solstice d'été</option>
                <option value="12">Solstice d'hiver</option>
            </select>
        `;

        // Modale centrée d'édition d'un objet posé (ouverte à la pose et au clic droit sur l'objet).
        objectModal = document.createElement('div');
        objectModal.id = 'cm3DObjectModal';
        objectModal.style.cssText = 'display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); z-index:1000000; width:340px; max-width:92vw; background:#fff; border:2px solid #dc2626; border-radius:8px; box-shadow:0 12px 40px rgba(0,0,0,0.35); font-family:sans-serif; font-size:14px; color:#111;';

        canvas3D = creerCanvas3D();

        // #cmRightPanel doit être position:relative pour ancrer les popups.
        try { rightPanel.style.position = rightPanel.style.position || 'relative'; } catch (e) { /* noop */ }
        canvas2D.parentNode.insertBefore(controlsBar, canvas2D);
        canvas2D.parentNode.insertBefore(objectPalette, canvas2D);
        canvas2D.parentNode.insertBefore(shadowPalette, canvas2D);
        canvas2D.parentNode.insertBefore(canvas3D, canvas2D.nextSibling);
        document.body.appendChild(objectModal);

        // Tous les popups ancrés sous la barre + le bouton qui les pilote.
        const POPUPS = [
            { el: objectPalette, btn: 'cm3DPaletteToggleBtn' },
            { el: shadowPalette, btn: 'cm3DShadowToggleBtn' },
        ];

        // Ouvre/ferme un popup ancré sous la barre ; ferme tous les autres ; colore les boutons.
        function togglePopup(popupEl, btnId, onOpen) {
            const btn = controlsBar.querySelector('#' + btnId);
            POPUPS.forEach(({ el, btn: bid }) => {
                if (!el || el === popupEl) return;
                el.style.display = 'none';
                const b = controlsBar.querySelector('#' + bid);
                if (b) { b.style.background = '#f5f5f5'; b.style.color = '#333'; }
            });
            const show = popupEl.style.display === 'none';
            if (show) {
                popupEl.style.top = (controlsBar.offsetTop + controlsBar.offsetHeight + 4) + 'px';
                if (onOpen) onOpen();
                popupEl.style.display = 'flex';
            } else {
                popupEl.style.display = 'none';
            }
            if (btn) { btn.style.background = show ? '#dc2626' : '#f5f5f5'; btn.style.color = show ? '#fff' : '#333'; }
        }

        controlsBar.querySelector('#cm3DBackTo2DBtn').addEventListener('click', () => close3DView());
        controlsBar.querySelector('#cm3DResetViewBtn').addEventListener('click', () => frameCamera());
        // Zoom maximal : même cadrage serré que les vues 3D du dossier de plans (sol exclu).
        controlsBar.querySelector('#cm3DZoomMaxBtn').addEventListener('click', () => {
            if (!cadrerCameraSurBati(1.04)) setStatus('Rien à cadrer : la scène ne contient que le sol.');
        });
        controlsBar.querySelector('#cm3DPanBtn').addEventListener('click', () => setPanMode(!panMode));
        controlsBar.querySelector('#cm3DMeasureBtn').addEventListener('click', () => setMeasureMode(!measureMode));
        controlsBar.querySelector('#cm3DDrawBuildingBtn').addEventListener('click', () => setDrawMode(!drawMode));
        controlsBar.querySelector('#cm3DDeleteBtn').addEventListener('click', () => supprimerSelection3D());
        // Clavier de la vue 3D, en phase de CAPTURE sur window (avant tout autre écouteur).
        // CORRECTIF (bug rapporté : « Supprimer depuis la vue 3D efface les panneaux de la carte et
        // du canevas 2D ») : Suppr / Retour arrière remontaient jusqu'au raccourci de la carte
        // (ButtonControl.clearSelection), qui supprimait le CONTOUR du champ PV sélectionné sur la
        // carte — donc tous ses panneaux —, et jusqu'au raccourci du plan 2D (obstacle sélectionné).
        // En vue 3D, ces touches n'agissent que sur la sélection 3D.
        window.addEventListener('keydown', (e) => {
            if (!active || !canvas3D || canvas3D.style.display === 'none') return;
            const t = e.target;
            const saisie = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
            const effacement = e.key === 'Delete' || e.key === 'Backspace';
            if (saisie) {
                // Le champ garde son effacement de texte (action par défaut), mais la touche ne
                // doit déclencher aucune suppression de la carte ni du plan 2D.
                if (effacement) e.stopPropagation();
                return;
            }
            if (effacement) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (drawMode) retirerDernierSommet();
                else if (e.key === 'Delete') supprimerSelection3D();
                return;
            }
            // Tracé d'un bâtiment : Échap annule, Entrée termine.
            if (!drawMode) return;
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setDrawMode(false); setStatus('Tracé annulé.'); }
            else if (e.key === 'Enter') { e.preventDefault(); terminerTrace(); }
        }, true);
        // Capture d'écran utilisateur pour le rapport (clic) / suppression de la capture (clic droit).
        const captureBtn = controlsBar.querySelector('#cm3DCaptureBtn');
        captureBtn.addEventListener('click', () => { captureEcranUtilisateur3D(); });
        captureBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!CM.state || !CM.state.sourceId || !getCapture3DUtilisateur(CM.state.sourceId)) {
                setStatus('Aucune capture enregistrée : la vue Iso automatique sera utilisée.');
                return;
            }
            supprimerCapture3DUtilisateur(CM.state.sourceId);
            updateCaptureButtonUI();
            setStatus('Capture supprimée : la vue Iso automatique sera utilisée dans le rapport.');
        });
        // Palette de couleur des panneaux : aperçu en direct ('input'), enregistrement au 'change'.
        const colorInput = controlsBar.querySelector('#cm3DPanelColorInput');
        colorInput.addEventListener('input', (e) => { appliquerCouleurPanneaux3D(e.target.value, false); });
        colorInput.addEventListener('change', (e) => { appliquerCouleurPanneaux3D(e.target.value, true); });
        controlsBar.querySelector('#cm3DPanelColorBtn').addEventListener('contextmenu', (e) => {
            e.preventDefault();
            appliquerCouleurPanneaux3D(null, true);
        });
        controlsBar.querySelector('#cm3DRoofTextureSelect').addEventListener('change', (e) => appliquerTextureToits3D(e.target.value));
        controlsBar.querySelector('#cm3DRotateBtn').addEventListener('click', () => setRotationMode(!rotationMode));
        controlsBar.querySelector('#cm3DPaletteToggleBtn').addEventListener('click', () => togglePopup(objectPalette, 'cm3DPaletteToggleBtn', renderObjectPalette));
        controlsBar.querySelector('#cm3DShadowToggleBtn').addEventListener('click', () => togglePopup(shadowPalette, 'cm3DShadowToggleBtn', null));
        controlsBar.querySelector('#cm3DOmbriereFormBtn').addEventListener('click', () => {
            const has = typeof CM.getFormOmbriereObject === 'function' && CM.getFormOmbriereObject();
            if (has) openObjectEditor(CM.FORM_OMBRIERE_ID);
            else setStatus('Choisissez « Ombrière métal » ou « Ombrière bois » dans le type de structure.');
        });
        controlsBar.querySelector('#cm3DPetitChampBtn').addEventListener('click', () => {
            const has = typeof CM.getFormPetitChampObject === 'function' && CM.getFormPetitChampObject();
            if (has) openObjectEditor(CM.FORM_PETITCHAMP_ID);
            else setStatus('Choisissez « Petit champ solaire » dans le type de structure.');
        });
        controlsBar.querySelectorAll('.cm3d-view-btn').forEach((b) => {
            b.addEventListener('click', () => setCameraView(b.dataset.view));
        });

        // Wiring palette d'ombrage.
        shadowPalette.querySelector('#cm3DShadowOn').addEventListener('change', (e) => {
            shadowsOn = !!e.target.checked; applyShadows();
        });
        shadowPalette.querySelector('#cm3DShadowHour').addEventListener('input', (e) => {
            shadowHour = parseFloat(e.target.value) || 13;
            const v = shadowPalette.querySelector('#cm3DShadowHourVal');
            if (v) v.textContent = (Number.isInteger(shadowHour) ? shadowHour : shadowHour.toFixed(1)) + 'h';
            applySun();
        });
        function highlightShadowMonth() {
            shadowPalette.querySelectorAll('#cm3DShadowMonths button[data-month]').forEach((b) => {
                const on = parseInt(b.dataset.month, 10) === shadowMonth;
                b.style.background = on ? '#dc2626' : '#f5f5f5';
                b.style.color = on ? '#fff' : '#333';
            });
        }
        shadowPalette.querySelectorAll('#cm3DShadowMonths button[data-month]').forEach((b) => {
            b.addEventListener('click', () => {
                shadowMonth = parseInt(b.dataset.month, 10) || 6;
                const mo = shadowPalette.querySelector('#cm3DShadowMoment');
                if (mo) mo.value = '';
                highlightShadowMonth(); applySun();
            });
        });
        shadowPalette.querySelector('#cm3DShadowMoment').addEventListener('change', (e) => {
            const m = parseInt(e.target.value, 10);
            if (m) { shadowMonth = m; highlightShadowMonth(); applySun(); }
        });
        highlightShadowMonth();

        brancherCanvas3D(canvas3D);
    }

    /**
     * Canevas de la vue 3D, soustrait à html2canvas (attribut data-html2canvas-ignore).
     *
     * CORRECTIF (bug rapporté : « Erreur d'initialisation 3D : WebGL not supported », vue 3D vide et
     * « Vue 3D indisponible » dans le dossier de plans) : html2canvas clone TOUT le document, pas
     * seulement l'élément capturé, et appelle getContext('2d') sur chaque <canvas> rencontré. Un
     * canevas 3D déjà créé mais dont le moteur Babylon n'était pas encore démarré recevait ainsi un
     * contexte 2D définitif : WebGL ne pouvait plus jamais y être obtenu. Toute capture de la carte
     * (plans, DP, reprise du fond de carte de la 3D) faite à ce moment-là cassait la 3D de la session.
     */
    function creerCanvas3D() {
        const c = document.createElement('canvas');
        c.id = 'calepinageMaisonCanvas3D';
        c.setAttribute('data-html2canvas-ignore', 'true');
        c.style.cssText = 'width:100%; background:#eef1f5; border:1px solid #d1d5db; border-radius:6px; display:none; touch-action:none;';
        return c;
    }

    /**
     * Canevas neuf à la place d'un canevas inutilisable pour WebGL (contexte 2D déjà posé dessus) :
     * mêmes dimensions, même style, mêmes écouteurs. Le contexte d'un canevas ne se change pas.
     */
    function remplacerCanvas3D() {
        const ancien = canvas3D;
        const neuf = creerCanvas3D();
        neuf.style.cssText = ancien.style.cssText;
        neuf.width = ancien.width;
        neuf.height = ancien.height;
        if (ancien.parentNode) ancien.parentNode.replaceChild(neuf, ancien);
        canvas3D = neuf;
        brancherCanvas3D(neuf);
    }

    function brancherCanvas3D(c) {
        // Glisser-déposer d'un objet de la palette sur le canevas.
        c.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        c.addEventListener('drop', (e) => {
            e.preventDefault();
            const key = e.dataTransfer.getData('text/cm3d-type');
            const obstacleType = e.dataTransfer.getData('text/cm3d-obstacle');
            if (!key && !obstacleType) return;
            const gp = groundPointFromClient(e.clientX, e.clientY);
            const pos = gp ? { x: gp.x + modelCenter.x, z: gp.z + modelCenter.z } : null;
            if (obstacleType) {
                const obst = (typeof CM.addObstacleFrom3D === 'function') ? CM.addObstacleFrom3D(obstacleType, pos) : null;
                if (obst) openObstacle3DModal(obst.id);
                return;
            }
            const obj = (typeof CM.addSceneObject3D === 'function') ? CM.addSceneObject3D(key, pos) : null;
            if (obj) { selectedObj3DId = obj.id; openObjectEditor(obj.id); }
        });
        // Double-clic pendant le tracé d'un bâtiment : termine la forme.
        c.addEventListener('dblclick', (e) => {
            if (!drawMode) return;
            e.preventDefault();
            terminerTrace();
        });
        // Clic droit sur un objet posé -> édition.
        c.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (drawMode) return; // pendant le tracé, le clic droit reste à la caméra
            const id = pickObjectIdAt(e.clientX, e.clientY);
            if (id) { selectedObj3DId = id; applySelectionVisual(); openObjectEditor(id); return; }
            const obstId = pickObstacleIdAt(e.clientX, e.clientY);
            if (obstId) openObstacle3DModal(obstId);
        });
    }

    // Construit la bande horizontale de la bibliothèque : une icône par objet (taille fixe), le
    // libellé sous l'icône + en infobulle native (title) + affiché dans la zone "hint" au survol /
    // clic / focus (demande explicite : "le descriptif doit apparaître quand on clique ou passe la
    // souris sur une icône"). Chaque item est déplaçable vers le canevas.
    function renderObjectPalette() {
        if (!objectPalette || typeof CM.getSceneObjectCatalog !== 'function') return;
        const cat = CM.getSceneObjectCatalog();
        const obs = (typeof CM.obstacleTypes === 'function') ? CM.obstacleTypes() : [];
        const HINT_DEFAULT = 'Glissez un objet ou un obstacle sur la scène 3D.';
        objectPalette.innerHTML = cat.map((c) =>
            `<button type="button" draggable="true" data-typekey="${c.key}" title="${c.label} — glisser sur la scène" class="cm-btn"
                 style="flex-shrink:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; width:58px; height:44px; padding:2px; cursor:grab;">
                <span style="font-size:20px; line-height:1;">${c.icon}</span>
                <span style="font-size:0.56rem; line-height:1; max-width:54px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.label}</span>
             </button>`).join('')
            // Obstacles du plan 2D (vélux, cheminée, forme libre...) : disponibles aussi en 3D, pour tous
            // les types de champ (toiture, ombrière, petit champ solaire). Posés sur la toiture si on
            // les dépose sur un pan, sinon au sol ; ils apparaissent aussi dans le plan 2D.
            + (obs.length ? `<span style="flex-shrink:0; width:1px; align-self:stretch; background:#e5e7eb; margin:0 4px;"></span>
                <span style="flex-shrink:0; font-size:0.7rem; font-weight:700; color:#374151;">Obstacles :</span>` : '')
            + obs.map((o) =>
                `<button type="button" draggable="true" data-obstacle="${o.key}" title="${o.label} (obstacle du plan) — glisser sur la scène" class="cm-btn"
                     style="flex-shrink:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; width:58px; height:44px; padding:2px; cursor:grab;">
                    <span style="display:inline-block; width:18px; height:14px; border-radius:2px; background:${o.color}; border:1px solid rgba(0,0,0,0.25);"></span>
                    <span style="font-size:0.56rem; line-height:1; max-width:54px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${o.label}</span>
                 </button>`).join('')
            + `<span id="cm3DPaletteHint" style="flex-shrink:0; margin-left:8px; font-size:0.75rem; color:#374151; white-space:nowrap;">${HINT_DEFAULT}</span>`;
        const hint = objectPalette.querySelector('#cm3DPaletteHint');
        objectPalette.querySelectorAll('button[data-typekey]').forEach((btn) => {
            const c = cat.find((x) => x.key === btn.dataset.typekey);
            const showDesc = () => { if (hint && c) hint.textContent = c.icon + ' ' + c.label; };
            btn.addEventListener('mouseenter', showDesc);
            btn.addEventListener('focus', showDesc);
            btn.addEventListener('click', showDesc);
            btn.addEventListener('mouseleave', () => { if (hint) hint.textContent = HINT_DEFAULT; });
            btn.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/cm3d-type', btn.dataset.typekey);
                e.dataTransfer.effectAllowed = 'copy';
            });
        });
        objectPalette.querySelectorAll('button[data-obstacle]').forEach((btn) => {
            const o = obs.find((x) => x.key === btn.dataset.obstacle);
            const showDesc = () => { if (hint && o) hint.textContent = `${o.label} : sur un pan -> toiture, ailleurs -> au sol`; };
            btn.addEventListener('mouseenter', showDesc);
            btn.addEventListener('click', showDesc);
            btn.addEventListener('mouseleave', () => { if (hint) hint.textContent = HINT_DEFAULT; });
            btn.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/cm3d-obstacle', btn.dataset.obstacle);
                e.dataTransfer.effectAllowed = 'copy';
            });
        });
    }

    // --- Modale centrée d'édition d'un objet posé ---
    function openObject3DModal(id) {
        const o = (CM.state.sceneObjects3D || []).find((x) => x.id === id);
        if (!o || !objectModal) return;
        const def = (window.OBJECT_LIBRARY || {})[o.typeKey] || { label: o.typeKey, icon: '📦', fields: [] };
        // Libellé = <div> (pas <label>, pour esquiver tout CSS global ciblant <label>/<span>), en
        // pixels (immunisé contre un font-size racine douteux), au-dessus du champ. Sans espace de
        // template entre les balises (les nœuds texte parasites décalaient/masquaient le libellé).
        // Bornes de saisie (fields[].min/max de la bibliothèque, position ±250 m, rotation 0-360°) :
        // rappelées dans l'infobulle et appliquées à l'enregistrement (CM.updateSceneObject3D).
        const row = (label, key, val, step, min, max) => {
            const bornes = (min != null ? ` min="${min}"` : '') + (max != null ? ` max="${max}"` : '');
            const titre = (min != null && max != null) ? ` title="Valeur entre ${min} et ${max}"` : '';
            return `<div style="display:flex; flex-direction:column;"><div style="font-size:12px; font-weight:700; color:#374151; margin-bottom:3px;">${label}</div><input type="number" step="${step || 0.1}"${bornes}${titre} data-field="${key}" value="${val}" style="width:100%; box-sizing:border-box; padding:5px 7px; border:1px solid #d1d5db; border-radius:4px; font-size:14px; color:#111;"></div>`;
        };
        const posMax = (CM.SCENE_LIMITES && CM.SCENE_LIMITES.positionMaxM) || 250;
        const paramRows = (def.fields || []).map((f) =>
            row(f.l, 'param:' + f.k, (o.params && o.params[f.k] != null ? o.params[f.k] : ''), f.step || 0.1, f.min, f.max)).join(''); // pas propre au champ (ex. nombre d'étages : 1)
        objectModal.innerHTML = `
            <div style="background:#dc2626; color:#fff; padding:10px 14px; border-radius:6px 6px 0 0; display:flex; justify-content:space-between; align-items:center;">
                <strong style="font-size:14px;">${def.icon || '📦'} ${def.label}</strong>
                <button type="button" data-cm3d="close" style="background:none; border:none; color:#fff; font-size:20px; line-height:1; cursor:pointer;">&times;</button>
            </div>
            <div style="padding:14px; display:grid; grid-template-columns:1fr 1fr; gap:10px 12px; max-height:66vh; overflow-y:auto;">
                ${row('X (m)', 'x', Number(o.x || 0).toFixed(2), 0.25, -posMax, posMax)}
                ${row('Z (m)', 'z', Number(o.z || 0).toFixed(2), 0.25, -posMax, posMax)}
                ${row('Rotation (°)', 'rotationDeg', Number(o.rotationDeg || 0), 5, 0, 360)}
                ${paramRows}
            </div>
            <div style="padding:0 14px 14px; display:flex; justify-content:space-between;">
                <button type="button" data-cm3d="delete" class="cm-btn" style="background:#fef2f2; color:#991b1b; border-color:#fecaca;">Supprimer</button>
                <button type="button" data-cm3d="close" class="cm-btn" style="background:#dc2626; color:#fff; border-color:#dc2626;">Fermer</button>
            </div>
        `;
        objectModal.dataset.objid = id;
        objectModal.style.display = 'block';
        makeModalDraggable(objectModal, objectModal.querySelector('div')); // en-tête = 1er <div>
        objectModal.querySelectorAll('[data-cm3d="close"]').forEach((b) => b.addEventListener('click', closeObject3DModal));
        objectModal.querySelector('[data-cm3d="delete"]').addEventListener('click', () => {
            if (typeof CM.removeSceneObject3D === 'function') CM.removeSceneObject3D(id);
            selectedObj3DId = null;
            closeObject3DModal();
        });
        objectModal.querySelectorAll('input[data-field]').forEach((inp) => {
            inp.addEventListener('input', () => {
                const field = inp.dataset.field;
                const v = parseFloat(String(inp.value).replace(',', '.'));
                if (isNaN(v) || typeof CM.updateSceneObject3D !== 'function') return;
                if (field.indexOf('param:') === 0) CM.updateSceneObject3D(id, { params: { [field.slice(6)]: v } });
                else CM.updateSceneObject3D(id, { [field]: v });
            });
            // En sortie de champ : affiche la valeur réellement retenue (ramenée dans ses bornes).
            inp.addEventListener('change', () => {
                const field = inp.dataset.field;
                const maj = (CM.state.sceneObjects3D || []).find((x) => x.id === id);
                if (!maj) return;
                const retenue = field.indexOf('param:') === 0 ? (maj.params || {})[field.slice(6)] : maj[field];
                if (retenue != null && isFinite(retenue)) inp.value = Math.round(Number(retenue) * 1000) / 1000;
            });
        });
    }
    function closeObject3DModal() {
        if (objectModal) {
            objectModal.style.display = 'none';
            objectModal.dataset.objid = '';
            objectModal.style.width = '340px';
            // Recentre pour la prochaine ouverture (annule un éventuel déplacement).
            objectModal.style.transform = 'translate(-50%,-50%)';
            objectModal.style.left = '50%';
            objectModal.style.top = '50%';
        }
    }

    // Rend une modale déplaçable en glissant sa poignée (l'en-tête). Bascule du centrage par
    // transform vers un positionnement left/top explicite au 1er glisser.
    function makeModalDraggable(modalEl, handleEl) {
        if (!modalEl || !handleEl) return;
        handleEl.style.cursor = 'move';
        let sx = 0, sy = 0, sl = 0, st = 0, dragging = false;
        const onMove = (e) => {
            if (!dragging) return;
            modalEl.style.left = (sl + e.clientX - sx) + 'px';
            modalEl.style.top = (st + e.clientY - sy) + 'px';
        };
        const onUp = () => {
            dragging = false;
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        };
        handleEl.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return; // ne pas démarrer un drag depuis un bouton
            const r = modalEl.getBoundingClientRect();
            sl = r.left; st = r.top; sx = e.clientX; sy = e.clientY;
            modalEl.style.transform = 'none';
            modalEl.style.left = sl + 'px';
            modalEl.style.top = st + 'px';
            dragging = true;
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            e.preventDefault();
        });
    }

    // Aiguillage de l'éditeur d'un objet posé : fenêtre complète pour les ombrières métal/bois
    // (calepinage_maison_3d_ombriere_form.js), modale numérique générique sinon.
    function openObjectEditor(id) {
        let o = (CM.state.sceneObjects3D || []).find((x) => x.id === id);
        if (!o && id === CM.FORM_OMBRIERE_ID && typeof CM.getFormOmbriereObject === 'function') o = CM.getFormOmbriereObject();
        if (!o && id === CM.FORM_PETITCHAMP_ID && typeof CM.getFormPetitChampObject === 'function') o = CM.getFormPetitChampObject();
        if (!o) return;

        const onDelete = (oid) => {
            if (typeof CM.removeSceneObject3D === 'function') CM.removeSceneObject3D(oid);
            selectedObj3DId = null;
            closeObject3DModal();
        };

        if (typeof CM.isOmbriereFamilyKey === 'function' && CM.isOmbriereFamilyKey(o.typeKey)
            && typeof CM.renderOmbriereForm === 'function') {
            if (!objectModal) return;
            objectModal.style.width = '460px';
            objectModal.dataset.objid = id;
            objectModal.style.display = 'block';
            CM.renderOmbriereForm(objectModal, id, { onClose: closeObject3DModal, onDelete: onDelete });
            makeModalDraggable(objectModal, objectModal.querySelector('.cmOmb-head'));
            return;
        }
        if (typeof CM.isPetitChampFamilyKey === 'function' && CM.isPetitChampFamilyKey(o.typeKey)
            && typeof CM.renderPetitChampForm === 'function') {
            if (!objectModal) return;
            objectModal.style.width = '440px';
            objectModal.dataset.objid = id;
            objectModal.style.display = 'block';
            CM.renderPetitChampForm(objectModal, id, { onClose: closeObject3DModal, onDelete: onDelete });
            makeModalDraggable(objectModal, objectModal.querySelector('.cmOmb-head'));
            return;
        }
        openObject3DModal(id);
    }

    // Mode "main" : le glisser gauche déplace la forme (pan) au lieu de l'orbiter. ArcRotateCamera
    // gère le pan via panningMouseButton (2 = clic droit par défaut) — on le passe à 0 (clic gauche)
    // en mode main, et on rétablit à 2 sinon.
    let panMode = false;
    const PANNING_SENSIBILITY_DEFAUT = 40; // valeur d'origine (startEngine), rétablie hors mode main
    // NOUVEAU (demande explicite : "une main pour déplacer le dessin rapidement") : avec une
    // sensibilité fixe, le glisser était très lent dès que la caméra est loin (grand champ PV). En
    // mode main, la sensibilité est recalculée à chaque prise en main pour que le dessin suive la
    // souris : déplacement monde par pixel = hauteur visible au niveau de la cible / hauteur du canevas,
    // en tenant compte de l'inertie de pan de Babylon (cumul ≈ 1 / (1 - panningInertia)).
    function ajusterSensibilitePanMain() {
        if (!camera || !canvas3D) return;
        try {
            const hPx = canvas3D.clientHeight || canvas3D.height || 600;
            const visibleM = 2 * Math.max(0.5, camera.radius) * Math.tan((camera.fov || 0.8) / 2);
            const cumulInertie = 1 / Math.max(0.05, 1 - (camera.panningInertia != null ? camera.panningInertia : 0.9));
            camera.panningSensibility = Math.max(0.5, Math.min(2000, cumulInertie * hPx / visibleM));
        } catch (e) { /* noop */ }
    }
    function setPanMode(on) {
        panMode = !!on;
        if (panMode && measureMode) setMeasureMode(false); // main et règle s'excluent
        if (panMode && drawMode) setDrawMode(false);
        try {
            const p = camera && camera.inputs && camera.inputs.attached && camera.inputs.attached.pointers;
            if (p) p.panningMouseButton = panMode ? 0 : 2;
            // Babylon 6 lit le bouton de pan sur la caméra (ArcRotateCameraPointersInput.onButtonDown
            // compare evt.button à camera._panningMouseButton) : on le positionne aussi, sans quoi le
            // clic gauche continuait d'orbiter au lieu de déplacer le dessin.
            if (camera && '_panningMouseButton' in camera) camera._panningMouseButton = panMode ? 0 : 2;
            if (camera) {
                if (panMode) ajusterSensibilitePanMain();
                else camera.panningSensibility = PANNING_SENSIBILITY_DEFAUT;
            }
        } catch (e) { /* noop */ }
        const btn = controlsBar && controlsBar.querySelector('#cm3DPanBtn');
        if (btn) {
            btn.style.background = panMode ? '#dc2626' : '#f5f5f5';
            btn.style.color = panMode ? '#fff' : '#333';
        }
        if (canvas3D) canvas3D.style.cursor = panMode ? 'grab' : 'default';
    }

    // Masque / réaffiche la barre d'outils (#cmToolbar) et la carte de résultats (#cmResultsWrapper)
    // + synchronise leurs boutons bascule d'en-tête (#cmToggleToolbarBtn / #cmToggleResultsBtn), pour
    // laisser toute la place au canevas 3D et TOUT réafficher au retour en 2D (demande explicite).
    function setModalChrome(visible) {
        const root = CM.modal || document;
        [['#cmToggleToolbarBtn', '#cmToolbar'], ['#cmToggleResultsBtn', '#cmResultsWrapper']].forEach((pair) => {
            const btn = root.querySelector(pair[0]);
            const tgt = (CM.modalBody || document).querySelector(pair[1]);
            if (tgt) {
                if (!visible) {
                    // Mémorise le display INLINE d'origine (#cmToolbar a "display:flex" inline) avant
                    // de le masquer — le remettre à '' cassait la mise en page (retour à 'block',
                    // icônes désalignées, cf. bug rapporté).
                    if (tgt.dataset.cm3dPrevDisplay === undefined) tgt.dataset.cm3dPrevDisplay = tgt.style.display || '';
                    tgt.style.display = 'none';
                } else {
                    tgt.style.display = (tgt.dataset.cm3dPrevDisplay !== undefined) ? tgt.dataset.cm3dPrevDisplay : '';
                    delete tgt.dataset.cm3dPrevDisplay;
                }
            }
            if (btn) btn.classList.toggle('cm-header-toggle-off', !visible);
        });
    }

    // --- Palette de couleur des panneaux ---------------------------------------------------------
    function hexValide(hex) {
        return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex);
    }

    // Couleur choisie pour la maison active, en composantes 0..1, ou null (couleur par défaut).
    function couleurPanneaux3D() {
        const hex = CM.state && CM.state.panelColor3D;
        if (!hexValide(hex)) return null;
        return {
            r: parseInt(hex.slice(1, 3), 16) / 255,
            g: parseInt(hex.slice(3, 5), 16) / 255,
            b: parseInt(hex.slice(5, 7), 16) / 255,
        };
    }

    // Synchronise le sélecteur/pastille de la barre avec l'état de la maison active.
    function updatePanelColorUI() {
        if (!controlsBar) return;
        const hex = (CM.state && hexValide(CM.state.panelColor3D)) ? CM.state.panelColor3D : DEFAULT_PANEL_COLOR_3D;
        const input = controlsBar.querySelector('#cm3DPanelColorInput');
        const swatch = controlsBar.querySelector('#cm3DPanelColorSwatch');
        if (input && document.activeElement !== input) input.value = hex;
        if (swatch) swatch.style.background = hex;
    }

    /**
     * NOUVEAU (demande explicite : "palette de couleur dans le menu pour modifier la couleur des
     * panneaux"). `hex` null = retour à la couleur par défaut.
     * - commit=false (glisser dans le sélecteur) : aperçu immédiat, en recolorant les matériaux de
     *   panneaux déjà présents dans la scène — pas de reconstruction à chaque mouvement de souris ;
     * - commit=true : écrit CM.state.panelColor3D puis recalcule (persistance + reconstruction 3D).
     */
    function appliquerCouleurPanneaux3D(hex, commit) {
        const valeur = hexValide(hex) ? hex : null;
        const swatch = controlsBar && controlsBar.querySelector('#cm3DPanelColorSwatch');
        if (swatch) swatch.style.background = valeur || DEFAULT_PANEL_COLOR_3D;
        if (!commit) {
            if (!scene || !valeur) return;
            const c = BABYLON.Color3.FromHexString(valeur);
            (scene.materials || []).forEach((m) => {
                if (!m || !m.name || !/panel/i.test(m.name) || !m.diffuseColor) return;
                m.diffuseColor = c;
                if (m.name === 'panelMat' && m.emissiveColor) m.emissiveColor = c.scale(0.33);
            });
            return;
        }
        if (!CM.state) return;
        CM.state.panelColor3D = valeur;
        updatePanelColorUI();
        if (typeof CM.recomputeResults === 'function') CM.recomputeResults();
        else refresh3DView();
        setStatus(valeur ? 'Couleur des panneaux modifiée.' : 'Couleur des panneaux par défaut rétablie.');
    }

    function setStatus(msg) {
        const el = controlsBar && controlsBar.querySelector('#cm3DStatus');
        if (el) el.textContent = msg || '';
    }

    // --- Accumulateur de maillage : positions/indices bruts, normales calculées à la fin. ---
    // `uvDe(p)` (optionnelle) : coordonnées de texture {u, v} de chaque sommet {x, y, z} — photo de
    // la vue en plan ou texture type des toits. addPolygon/addQuad acceptent aussi leur propre
    // fonction (repère propre à chaque pan). Un accumulateur texturé doit en fournir une à CHAQUE ajout.
    function meshAccumulator(uvDe) {
        const positions = [];
        const indices = [];
        const uvs = [];
        const pousser = (x, y, z, uvFn) => {
            positions.push(x, y, z);
            const f = uvFn || uvDe;
            if (f) { const t = f({ x, y, z }); uvs.push(t.u, t.v); }
        };
        return {
            addPolygon(pts, uvFn) {
                if (!pts || pts.length < 3) return;
                let cx = 0, cy = 0, cz = 0;
                pts.forEach((p) => { cx += p.x; cy += p.y; cz += p.z; });
                cx /= pts.length; cy /= pts.length; cz /= pts.length;
                const centerIdx = positions.length / 3;
                pousser(cx, cy, cz, uvFn);
                const start = positions.length / 3;
                pts.forEach((p) => pousser(p.x, p.y, p.z, uvFn));
                for (let i = 0; i < pts.length; i++) {
                    indices.push(centerIdx, start + i, start + ((i + 1) % pts.length));
                }
            },
            addQuad(q, uvFn) {
                if (!q || q.length !== 4) return;
                const base = positions.length / 3;
                q.forEach((p) => pousser(p.x, p.y, p.z, uvFn));
                indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            },
            toMesh(name, material) {
                if (!indices.length) return null;
                const normals = [];
                BABYLON.VertexData.ComputeNormals(positions, indices, normals);
                const vd = new BABYLON.VertexData();
                vd.positions = positions;
                vd.indices = indices;
                vd.normals = normals;
                if (uvs.length) vd.uvs = uvs;
                const mesh = new BABYLON.Mesh(name, scene);
                vd.applyToMesh(mesh);
                mesh.material = material;
                return mesh;
            },
        };
    }

    function mat(name, r, g, b, opts) {
        const m = new BABYLON.StandardMaterial(name, scene);
        m.diffuseColor = new BABYLON.Color3(r, g, b);
        m.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
        m.backFaceCulling = false;
        if (opts && opts.emissive) m.emissiveColor = new BABYLON.Color3(opts.emissive[0], opts.emissive[1], opts.emissive[2]);
        return m;
    }

    let sceneModel = null;
    let sceneJunk = []; // meshes/matériaux/textures créés au dernier buildScene(), à libérer au suivant.
    // Terrain réel sous la scène (même grille d'altitudes que les plans 2D, cf.
    // calepinage_maison_3d_terrain.js) : null tant qu'il n'est pas chargé, ou hors zone couverte.
    let solTerrain = null;
    let terrainDemande = false;
    let terrainPromesse = null;   // chargement en cours (cf. majTerrain), attendu par les captures

    function disposeSceneJunk() {
        // dispose(false, true) : pour un mesh/TransformNode -> libère aussi les enfants + matériaux
        // (nécessaire pour les objets de librairie, qui sont des hiérarchies) ; pour un
        // matériau/texture, les arguments en trop sont ignorés — inoffensif.
        sceneJunk.forEach((o) => { try { o.dispose(false, true); } catch (e) { try { o.dispose(); } catch (e2) { /* noop */ } } });
        sceneJunk = [];
    }

    // Rotation Y de l'objet autour de son origine locale (= point d'ancrage au sol des objets de la
    // bibliothèque, généralement centré). Volontairement SIMPLE (pas de pivot "autour du centre
    // d'emprise") : le gizmo de rotation Babylon tourne lui aussi autour de l'origine du nœud —
    // build-time et gizmo-time restent ainsi cohérents (pas de "saut" au relâchement du gizmo).
    function rotateNodeAroundCenter(node, angleY) {
        node.rotation.y = angleY || 0;
    }

    // Objets de contexte 3D (Phase A) : arbre, bâtiment voisin, mât... maillés par la bibliothèque
    // partagée window.OBJECT_LIBRARY (geometrie_3D/scene_objects_library.js). Chaque def.build()
    // retourne un BABYLON.TransformNode, posé au sol (origine 0,0,0), construit vers +Y.
    /** Altitude du terrain (m) sous un point de la scène ; 0 tant qu'aucun terrain n'est chargé. */
    function altitudeTerrain(x, z) {
        if (!solTerrain) return 0;
        const v = solTerrain.altitudeEn(x, z);
        return Number.isFinite(v) ? v : 0;
    }

    /**
     * (Re)pose les tables d'un petit champ sur le terrain avec les seuils du champ affiché, puis
     * allonge les poteaux. Appelé à la construction et pendant un glisser-déposer.
     */
    function poserTablesSurTerrain(root, avecStatut) {
        const T3D = window.CalepinageMaison3DTerrain;
        if (!root || !root.__poseParTable || !T3D) return;
        try {
            const TT = window.CalepinageMaisonTerrainTables;
            const seuils = TT && typeof TT.seuilsDuChamp === 'function' ? TT.seuilsDuChamp(CM.state) : null;
            const r = T3D.poserTablesPetitChamp(root, root.__poseParTable, (x, z) => altitudeTerrain(x, z), seuils);
            if (r && avecStatut) setStatus(messageTerrainTables(r.synthese));
        } catch (e) {
            try { console.warn('[cm3D] calage des tables sur le terrain impossible', e); } catch (e2) { /* noop */ }
        }
    }

    /**
     * Rien n'est représenté sous le sol (demande explicite : fondations, pieux et vis enterrés
     * alourdissaient la scène sans rien montrer) : chaque poteau s'arrête au niveau du terrain.
     * L'ancrage du champ reste pris en compte dans l'analyse des tables (seuils), pas dans le dessin.
     */
    function optionsPoteaux() {
        return { ancrageM: 0 };
    }

    /** Ligne de statut 3D après calage des tables sur le terrain. */
    function messageTerrainTables(s) {
        if (!s || !s.nbAnalysees) return '';
        const p = s.parNiveau || {};
        const morceaux = [];
        if (p.enfoncee) morceaux.push(p.enfoncee + ' table(s) enfoncée(s)');
        if (p.pente_forte) morceaux.push(p.pente_forte + ' table(s) en pente au-delà du seuil');
        if (p.garde_faible) morceaux.push(p.garde_faible + ' garde(s) au sol sous le seuil');
        if (p.pente_moyenne) morceaux.push(p.pente_moyenne + ' en pente entre 3 % et le seuil');
        const garde = Number.isFinite(s.gardeMinM) ? ' — garde min ' + s.gardeMinM.toFixed(2) + ' m' : '';
        return 'Terrain : ' + (morceaux.length ? morceaux.join(', ') : 'toutes les tables conformes') + garde + '.';
    }

    // Pendant un glisser-déposer : tables recalées et poteaux réallongés au plus une fois par image
    // (le dépôt reconstruit ensuite la scène, cf. updateSceneObject3D -> recomputeResults).
    let recalageGlisserEnAttente = null;
    function planifierRecalageGlisser(root) {
        // Petit champ fusionné : plus de tables ni de poteaux séparés à recaler, le champ glisse
        // d'un bloc et se recale au dépôt (reconstruction de la scène).
        if (!solTerrain || recalageGlisserEnAttente || (root && root.__fusionne)) return;
        const lancer = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
        recalageGlisserEnAttente = lancer(() => {
            recalageGlisserEnAttente = null;
            if (root.__poseParTable) poserTablesSurTerrain(root, false);
            const T3D = window.CalepinageMaison3DTerrain;
            if (T3D && typeof T3D.poserPoteauxSurTerrain === 'function') {
                try { T3D.poserPoteauxSurTerrain(root, (x, z) => altitudeTerrain(x, z), optionsPoteaux(root)); } catch (e) { /* noop */ }
            }
        });
    }

    function buildSceneObjects(model) {
        if (rotationGizmo) { try { rotationGizmo.attachedNode = null; } catch (e) { /* noop */ } }
        if (highlightLayer) { try { highlightLayer.removeAllMeshes(); } catch (e) { /* noop */ } }
        Object.keys(objRootById).forEach((k) => delete objRootById[k]);
        modelCenter = (model && model.center) ? { x: model.center.x, z: model.center.z } : { x: 0, z: 0 };
        const lib = window.OBJECT_LIBRARY;
        const list = (model && model.sceneObjects) || [];
        if (!lib || !list.length) return;
        list.forEach((o) => {
            const isOmb = typeof CM.isOmbriereFamilyKey === 'function' && CM.isOmbriereFamilyKey(o.typeKey);
            const isPc = typeof CM.isPetitChampFamilyKey === 'function' && CM.isPetitChampFamilyKey(o.typeKey);
            const def = lib[o.typeKey];
            if (!isOmb && !isPc && (!def || typeof def.build !== 'function')) return;
            // Petit champ : construction rapide (gabarits recopiés, 2 maillages, poteaux jusqu'au sol).
            const rapide = isPc && typeof window.construirePetitChamp3DRapide === 'function';
            try {
                let root;
                if (isOmb) {
                    // Ombrières : générateurs Babylon existants (geometrie_3D/ombriere_*), pilotés par
                    // o.params.structureType + o.params.postModel (instantané complet du formulaire porté).
                    const st = (o.params && o.params.structureType)
                        || (o.typeKey.indexOf('bois_') === 0 ? 'bois' : 'metal');
                    const fn = st === 'bois' ? window.buildOmbriereBois3D : window.buildOmbriere3D;
                    if (typeof fn !== 'function') return;
                    root = fn(scene, o.params || {});
                } else if (isPc && rapide) {
                    // Petit champ solaire : racine vide, le champ est construit APRÈS sa pose (cf.
                    // construirePetitChamp3DRapide plus bas, qui a besoin de la position finale).
                    root = new BABYLON.TransformNode('petitChampLayoutRoot', scene);
                } else if (isPc) {
                    // Repli : générateur d'origine (geometrie_3D/Petit_champ_solaire/, une boîte par pièce).
                    if (typeof window.buildPetitChampSolaire3D !== 'function') return;
                    root = window.buildPetitChampSolaire3D(scene, o.params || {});
                } else {
                    root = def.build(scene, o.params || {});
                }
                if (!root) return;
                // Garde-fou : une position NaN (bbox/centroïde dégénérés) rendrait la structure
                // invisible. On la ramène à l'origine et on prévient.
                if (isOmb || isPc) {
                    if (!isFinite(root.position.x)) root.position.x = 0;
                    if (!isFinite(root.position.z)) root.position.z = 0;
                }
                // Les générateurs d'ombrière / champ solaire POSITIONNENT eux-mêmes leur racine
                // (auto-centrage `root.position.x -= facadeLength/2`, etc.) — on AJOUTE notre offset au
                // lieu de l'écraser (sinon la structure est décentrée d'une demi-longueur => "se
                // déplace de sa position", bug rapporté). Les objets simples sont construits autour de 0.
                if (isOmb || isPc) {
                    // Structure tournée (ombrière calée sur l'azimut du champ, cf. ombriereFrame) :
                    // le nœud pivote autour de SON origine, décalée du centre par le générateur — ce
                    // décalage tourne avec la structure pour qu'elle pivote autour de son centre
                    // (rotation Babylon autour de Y : x' = x cos + z sin, z' = -x sin + z cos).
                    const th = ((Number(o.rotationDeg) || 0) * Math.PI) / 180;
                    const offX = root.position.x, offZ = root.position.z;
                    root.position.x = (Number(o.x) || 0) + offX * Math.cos(th) + offZ * Math.sin(th);
                    root.position.z = (Number(o.z) || 0) - offX * Math.sin(th) + offZ * Math.cos(th);
                } else {
                    root.position.x = o.x;
                    root.position.z = o.z;
                }
                // Posée sur le terrain réel : la structure garde sa géométrie, elle est seulement
                // remontée/descendue au niveau du sol sous sa position (même règle que le plan de
                // coupe, où chaque shed suit le sol local).
                // Petit champ posé table par table (calepinage réel) : chaque table est calée sur
                // SON terrain par la règle commune à la carte (calepinage_maison_terrain_tables.js),
                // au lieu d'un seul calage du champ entier au sol de son centre (tables enfoncées
                // côté amont, bug rapporté).
                const T3D = window.CalepinageMaison3DTerrain;
                const parTable = rapide || (isPc && solTerrain && T3D && typeof T3D.aDesTables === 'function' && T3D.aDesTables(root));
                if (!parTable) root.position.y += altitudeTerrain(root.position.x, root.position.z);
                rotateNodeAroundCenter(root, (o.rotationDeg || 0) * Math.PI / 180);
                if (rapide) {
                    // Tables calées une à une sur le terrain (elles suivent le relief), poteaux
                    // verticaux jusqu'au sol exact, rien sous le sol. Le champ glisse ensuite d'un
                    // bloc et se recale au dépôt (__fusionne : pas de recalage pendant le glisser).
                    root.__poseParTable = o.params || {};
                    root.__fusionne = true;
                    const TT = window.CalepinageMaisonTerrainTables;
                    const r = window.construirePetitChamp3DRapide(scene, root, o.params || {}, {
                        altitudeScene: solTerrain ? (x, z) => altitudeTerrain(x, z) : null,
                        terrainRef: solTerrain,   // même terrain -> champ assemblé réutilisé
                        poserTables: T3D && typeof T3D.poserTablesPetitChamp === 'function' ? T3D.poserTablesPetitChamp : null,
                        seuils: TT && typeof TT.seuilsDuChamp === 'function' ? TT.seuilsDuChamp(CM.state) : null,
                    });
                    if (r && r.synthese) setStatus(messageTerrainTables(r.synthese));
                } else if (parTable) {
                    root.__poseParTable = o.params || {};
                    poserTablesSurTerrain(root, true);
                }
                // Poteaux de longueur variable : chacun descend jusqu'au sol sous SA position
                // (après la rotation, qui change leurs x/z). Même résultat qu'en plan de coupe.
                if (!rapide && solTerrain && window.CalepinageMaison3DTerrain
                    && typeof window.CalepinageMaison3DTerrain.poserPoteauxSurTerrain === 'function') {
                    try {
                        window.CalepinageMaison3DTerrain.poserPoteauxSurTerrain(
                            root, (x, z) => altitudeTerrain(x, z), optionsPoteaux(root));
                    } catch (e) { /* les poteaux gardent leur longueur nominale */ }
                }
                // Métadonnée de sélection : n'importe quelle partie de l'objet renvoie son id.
                root.metadata = { cm3dObjId: o.id };
                root.getChildMeshes().forEach((m) => { m.metadata = { cm3dObjId: o.id }; m.isPickable = true; });
                objRootById[o.id] = root;
                sceneJunk.push(root);
            } catch (e) {
                // Un objet fautif ne casse pas la scène — mais on le signale pour les structures
                // principales (ombrière / petit champ solaire), sinon le canevas semble juste "vide".
                if (isOmb || isPc) {
                    try { console.warn('[cm3D] échec génération structure', o.typeKey, e); } catch (e2) { /* noop */ }
                    setStatus('Impossible de générer la structure 3D (voir console).');
                }
            }
        });
        applySelectionVisual();
    }

    // --- Picking / sélection / déplacement / rotation des objets sur le canevas ---

    // Point du plan de sol (y=0) sous un pixel écran (coord. client), en repère MONDE Babylon.
    function groundPointFromClient(clientX, clientY) {
        if (!scene || !canvas3D) return null;
        const r = canvas3D.getBoundingClientRect();
        const x = clientX - r.left, y = clientY - r.top;
        const ray = scene.createPickingRay(x, y, BABYLON.Matrix.Identity(), camera);
        // Intersection avec le plan Y=0.
        if (Math.abs(ray.direction.y) < 1e-6) return null;
        const t = -ray.origin.y / ray.direction.y;
        if (t < 0) return null;
        return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
    }

    // id de l'objet posé sous un pixel écran, ou null.
    function pickObjectIdAt(clientX, clientY) {
        if (!scene || !canvas3D) return null;
        const r = canvas3D.getBoundingClientRect();
        const pick = scene.pick(clientX - r.left, clientY - r.top,
            (m) => m && m.isPickable && m.metadata && m.metadata.cm3dObjId);
        return (pick && pick.hit && pick.pickedMesh && pick.pickedMesh.metadata)
            ? pick.pickedMesh.metadata.cm3dObjId : null;
    }

    // id de l'obstacle 2D (vélux, cheminée...) sous un pixel écran, ou null.
    function pickObstacleIdAt(clientX, clientY) {
        if (!scene || !canvas3D) return null;
        const r = canvas3D.getBoundingClientRect();
        const pick = scene.pick(clientX - r.left, clientY - r.top,
            (m) => m && m.isPickable && m.metadata && m.metadata.cm3dObstacleId);
        return (pick && pick.hit && pick.pickedMesh && pick.pickedMesh.metadata)
            ? pick.pickedMesh.metadata.cm3dObstacleId : null;
    }

    // Modale d'édition d'un obstacle 2D depuis la 3D (mêmes grandeurs que le panneau du plan 2D).
    function openObstacle3DModal(id) {
        const o = (CM.state.obstacles || []).find((x) => x.id === id);
        if (!o || !objectModal) return;
        const def = (CM.OBSTACLE_TYPES && CM.OBSTACLE_TYPES[o.type]) || { label: o.type };
        const row = (label, key, val, step, min, max) =>
            `<div style="display:flex; flex-direction:column;"><div style="font-size:12px; font-weight:700; color:#374151; margin-bottom:3px;">${label}</div><input type="number" step="${step}" min="${min}" max="${max}" title="Valeur entre ${min} et ${max}" data-obst="${key}" value="${val}" style="width:100%; box-sizing:border-box; padding:5px 7px; border:1px solid #d1d5db; border-radius:4px; font-size:14px; color:#111;"></div>`;
        const L = CM.SCENE_LIMITES || { positionMaxM: 250, obstacleDimMinM: 0.05, obstacleDimMaxM: 50, obstacleHauteurMinM: 0.02, obstacleHauteurMaxM: 50 };
        const hMin = def.minElevationM != null ? def.minElevationM : L.obstacleHauteurMinM;
        const hMax = def.maxElevationM != null ? def.maxElevationM : L.obstacleHauteurMaxM;
        const f2 = (v) => (Number(v) || 0).toFixed(2);
        const surToiture = !!o.panId;
        objectModal.innerHTML = `
            <div style="background:#dc2626; color:#fff; padding:10px 14px; border-radius:6px 6px 0 0; display:flex; justify-content:space-between; align-items:center;">
                <strong style="font-size:14px;">🧱 ${def.label} <span style="font-weight:400; font-size:12px;">(${surToiture ? 'sur la toiture' : 'au sol'})</span></strong>
                <button type="button" data-cm3d="close" style="background:none; border:none; color:#fff; font-size:20px; line-height:1; cursor:pointer;">&times;</button>
            </div>
            <div style="padding:14px; display:grid; grid-template-columns:1fr 1fr; gap:10px 12px;">
                ${row('X (m)', 'x', f2(o.x), 0.25, -L.positionMaxM, L.positionMaxM)}
                ${row('Z (m)', 'z', f2(o.y), 0.25, -L.positionMaxM, L.positionMaxM)}
                ${row('Largeur (m)', 'w', f2(o.w), 0.05, L.obstacleDimMinM, L.obstacleDimMaxM)}
                ${row('Longueur (m)', 'h', f2(o.h), 0.05, L.obstacleDimMinM, L.obstacleDimMaxM)}
                ${row(`Hauteur (m) ${hMin}-${hMax}`, 'elevationM', f2(o.elevationM), 0.05, hMin, hMax)}
                ${row('Rotation (°)', 'angleDeg', ((((Number(o.angle) || 0) * 180 / Math.PI) % 360 + 360) % 360).toFixed(1), 5, 0, 360)}
            </div>
            <div style="padding:0 14px 14px; display:flex; justify-content:space-between;">
                <button type="button" data-cm3d="delete" class="cm-btn" style="background:#fef2f2; color:#991b1b; border-color:#fecaca;">Supprimer</button>
                <button type="button" data-cm3d="close" class="cm-btn" style="background:#dc2626; color:#fff; border-color:#dc2626;">Fermer</button>
            </div>
        `;
        objectModal.dataset.objid = '';
        objectModal.style.display = 'block';
        makeModalDraggable(objectModal, objectModal.querySelector('div'));
        objectModal.querySelectorAll('[data-cm3d="close"]').forEach((b) => b.addEventListener('click', closeObject3DModal));
        objectModal.querySelector('[data-cm3d="delete"]').addEventListener('click', () => {
            if (typeof CM.removeObstacle3D === 'function') CM.removeObstacle3D(id);
            closeObject3DModal();
        });
        objectModal.querySelectorAll('input[data-obst]').forEach((inp) => {
            // 'change' (et non 'input') : chaque modification relance le calepinage (panneaux retirés
            // sous l'obstacle) et la sauvegarde, inutile à chaque frappe.
            inp.addEventListener('change', () => {
                const v = parseFloat(String(inp.value).replace(',', '.'));
                if (isNaN(v) || typeof CM.updateObstacle3D !== 'function') return;
                CM.updateObstacle3D(id, { [inp.dataset.obst]: v });
                // Valeur réellement retenue (bornes appliquées par CM.updateObstacle3D).
                const maj = (CM.state.obstacles || []).find((x) => x.id === id);
                if (!maj) return;
                const k = inp.dataset.obst;
                if (k === 'x') inp.value = f2(maj.x);
                else if (k === 'z') inp.value = f2(maj.y);
                else if (k === 'angleDeg') inp.value = ((maj.angle || 0) * 180 / Math.PI).toFixed(1);
                else if (maj[k] != null) inp.value = f2(maj[k]);
            });
        });
    }

    // Surbrillance de l'objet sélectionné + (dé)placement du gizmo de rotation.
    function applySelectionVisual() {
        try {
            if (highlightLayer) highlightLayer.removeAllMeshes();
            const root = selectedObj3DId && objRootById[selectedObj3DId];
            if (root && highlightLayer) {
                root.getChildMeshes().forEach((m) => {
                    try { highlightLayer.addMesh(m, SELECTION_HL_COLOR()); } catch (e) { /* mesh sans géométrie */ }
                });
            }
            if (rotationGizmo) rotationGizmo.attachedNode = (rotationMode && root) ? root : null;
        } catch (e) { /* noop */ }
    }

    function setSelectedObject3D(id) {
        selectedObj3DId = id || null;
        applySelectionVisual();
    }

    /**
     * Supprime l'objet 3D sélectionné (bouton poubelle de la barre 3D, touche Suppr, bouton
     * « Supprimer » de la carte tant que la vue 3D est ouverte). Ne touche JAMAIS aux panneaux, au
     * contour du champ PV ni au plan 2D : seuls les objets posés dans la scène sont supprimables.
     */
    function supprimerSelection3D() {
        const id = selectedObj3DId;
        if (!id) { setStatus('Sélectionnez un objet 3D (clic dessus) puis Supprimer.'); return false; }
        if (id === CM.FORM_OMBRIERE_ID || id === CM.FORM_PETITCHAMP_ID) {
            setStatus('La structure du champ PV ne se supprime pas ici : changez le type de structure dans le formulaire.');
            return false;
        }
        const existe = (CM.state && CM.state.sceneObjects3D || []).some((o) => o.id === id);
        if (!existe) {
            setStatus('Cet objet appartient à un autre champ PV : ouvrez ce champ pour le supprimer.');
            return false;
        }
        if (objectModal && objectModal.dataset.objid === id) closeObject3DModal();
        if (rotationMode) setRotationMode(false);
        setSelectedObject3D(null);
        if (typeof CM.removeSceneObject3D === 'function') CM.removeSceneObject3D(id);
        setStatus('Objet 3D supprimé.');
        return true;
    }

    /** Vrai tant que la vue 3D du calepinage est affichée (cf. ButtonControl.clearSelection). */
    function is3DViewActive() {
        return !!(active && canvas3D && canvas3D.style.display !== 'none');
    }

    // Bouton "Rotation" : active/désactive le gizmo de rotation (anneau Y) sur l'objet sélectionné.
    function setRotationMode(on) {
        rotationMode = !!on;
        const btn = controlsBar && controlsBar.querySelector('#cm3DRotateBtn');
        if (btn) {
            btn.style.background = rotationMode ? '#dc2626' : '#f5f5f5';
            btn.style.color = rotationMode ? '#fff' : '#333';
        }
        if (rotationMode && !selectedObj3DId) {
            setStatus('Sélectionnez un objet 3D puis activez la rotation.');
        }
        applySelectionVisual();
    }

    // --- Règle de mesure (bouton « cotations » de la barre 3D) ---------------------------------------
    // Clic sur 2 points de la scène (toiture, panneau, objet, sol ou relief) : ligne + distance 3D,
    // détaillée en horizontal / dénivelé. Un 3e clic recommence une mesure. Un clic-glisser continue
    // d'orbiter (le point n'est posé que si la souris n'a presque pas bougé). Les maillages de mesure
    // ne sont ni cliquables, ni projecteurs d'ombre, et survivent aux reconstructions de la scène.
    const MESURE_PREFIX = 'cm3DMesure';
    let measureMode = false;
    let mesurePoints = [];
    let mesureMeshes = [];
    let mesureLabel = null;
    let mesureDown = null;
    let mesureObserver = null;

    function effacerMesure() {
        mesureMeshes.forEach((m) => { try { m.dispose(false, true); } catch (e) { /* noop */ } });
        mesureMeshes = [];
        mesurePoints = [];
        if (mesureLabel) mesureLabel.style.display = 'none';
    }

    function setMeasureMode(on) {
        measureMode = !!on;
        const btn = controlsBar && controlsBar.querySelector('#cm3DMeasureBtn');
        if (btn) {
            btn.style.background = measureMode ? '#dc2626' : '#f5f5f5';
            btn.style.color = measureMode ? '#fff' : '#333';
        }
        if (measureMode) {
            if (panMode) setPanMode(false);
            if (drawMode) setDrawMode(false);
            if (selectedObj3DId) setSelectedObject3D(null);
            setStatus('Règle : cliquez le 1er point.');
        } else {
            effacerMesure();
        }
        if (canvas3D) canvas3D.style.cursor = measureMode ? 'crosshair' : (panMode ? 'grab' : 'default');
    }

    function pointMesureDepuisClient(clientX, clientY) {
        if (!scene || !canvas3D) return null;
        const r = canvas3D.getBoundingClientRect();
        const pick = scene.pick(clientX - r.left, clientY - r.top, (m) => m && m.isPickable
            && m.isEnabled() && m.isVisible && !(m.name || '').startsWith(MESURE_PREFIX));
        if (pick && pick.hit && pick.pickedPoint) return pick.pickedPoint.clone();
        const g = groundPointFromClient(clientX, clientY);
        return g ? new BABYLON.Vector3(g.x, altitudeTerrain(g.x, g.z), g.z) : null;
    }

    function tailleMarqueur() {
        const rayon = camera && isFinite(camera.radius) ? camera.radius : 40;
        return Math.min(1, Math.max(0.06, rayon * 0.008));
    }

    function ajouterMarqueurMesure(p) {
        const s = BABYLON.MeshBuilder.CreateSphere(MESURE_PREFIX + 'Pt', { diameter: tailleMarqueur(), segments: 8 }, scene);
        const mat = new BABYLON.StandardMaterial(MESURE_PREFIX + 'PtMat', scene);
        mat.diffuseColor = new BABYLON.Color3(0.86, 0.15, 0.15);
        mat.emissiveColor = new BABYLON.Color3(0.86, 0.15, 0.15);
        s.material = mat;
        s.position = p.clone();
        s.isPickable = false;
        s.renderingGroupId = 1; // toujours visible, même derrière une surface
        mesureMeshes.push(s);
    }

    function afficherEtiquetteMesure() {
        if (!mesureLabel || mesurePoints.length !== 2 || !scene || !camera || !canvas3D) return;
        const milieu = mesurePoints[0].add(mesurePoints[1]).scale(0.5);
        const vp = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
        const proj = BABYLON.Vector3.Project(milieu, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), vp);
        if (!(proj.z > 0 && proj.z < 1)) { mesureLabel.style.display = 'none'; return; }
        const echelle = canvas3D.clientWidth / (engine.getRenderWidth() || 1);
        mesureLabel.style.left = (canvas3D.offsetLeft + proj.x * echelle) + 'px';
        mesureLabel.style.top = (canvas3D.offsetTop + proj.y * echelle) + 'px';
        mesureLabel.style.display = 'block';
    }

    function ajouterPointMesure(clientX, clientY) {
        const p = pointMesureDepuisClient(clientX, clientY);
        if (!p) { setStatus('Règle : aucun point sous le curseur.'); return; }
        if (mesurePoints.length >= 2) effacerMesure();
        mesurePoints.push(p);
        ajouterMarqueurMesure(p);
        if (mesurePoints.length === 1) { setStatus('Règle : cliquez le 2e point.'); return; }

        const [a, b] = mesurePoints;
        const ligne = BABYLON.MeshBuilder.CreateLines(MESURE_PREFIX + 'Ligne', { points: [a, b] }, scene);
        ligne.color = new BABYLON.Color3(0.86, 0.15, 0.15);
        ligne.isPickable = false;
        ligne.renderingGroupId = 1;
        mesureMeshes.push(ligne);

        const d = BABYLON.Vector3.Distance(a, b);
        const horiz = Math.hypot(b.x - a.x, b.z - a.z);
        const dz = b.y - a.y;
        const f = (v) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (!mesureLabel) {
            mesureLabel = document.createElement('div');
            mesureLabel.id = 'cm3DMesureLabel';
            mesureLabel.style.cssText = 'display:none; position:absolute; z-index:55; transform:translate(-50%,-130%); pointer-events:none; background:#dc2626; color:#fff; font:600 12px sans-serif; padding:3px 7px; border-radius:4px; white-space:nowrap; box-shadow:0 2px 6px rgba(0,0,0,0.3);';
            canvas3D.parentNode.insertBefore(mesureLabel, canvas3D.nextSibling);
        }
        mesureLabel.textContent = `${f(d)} m`;
        mesureLabel.title = `Horizontal ${f(horiz)} m — dénivelé ${f(dz)} m`;
        setStatus(`Distance ${f(d)} m (horizontal ${f(horiz)} m, dénivelé ${f(dz)} m) — 3e clic : nouvelle mesure.`);
        if (!mesureObserver) mesureObserver = scene.onAfterRenderObservable.add(afficherEtiquetteMesure);
        afficherEtiquetteMesure();
    }

    // --- Tracé d'un bâtiment (bouton « polygone » de la barre 3D) -----------------------------------
    // Clics successifs au sol = sommets de l'emprise ; double-clic, Entrée ou clic sur le 1er sommet
    // termine ; une fenêtre demande alors la hauteur (0,1-100 m, 3 m par défaut) et le bâtiment est
    // posé comme un objet 3D (CM.addBatimentDessine3D -> CM.state.sceneObjects3D) : même persistance,
    // même édition (clic droit), même prise en compte dans l'ombrage proche que les autres objets.
    // Les maillages du tracé portent le préfixe de la règle : ni cliquables, ni projecteurs d'ombre.
    const TRACE_PREFIX = MESURE_PREFIX + 'Trace';
    const TRACE_FERMETURE_PX = 12;     // clic à moins de 12 px du 1er sommet = fermeture
    const TRACE_MAX_SOMMETS = 200;
    let drawMode = false;
    let traceSommets = [];             // BABYLON.Vector3 monde, posés sur le sol
    let traceMarqueurs = [];
    let traceLigne = null;
    let traceDown = null;

    function effacerLigneTrace() {
        if (traceLigne) { try { traceLigne.dispose(false, true); } catch (e) { /* noop */ } }
        traceLigne = null;
    }

    function effacerTrace() {
        traceMarqueurs.forEach((m) => { try { m.dispose(false, true); } catch (e) { /* noop */ } });
        traceMarqueurs = [];
        effacerLigneTrace();
        traceSommets = [];
        traceDown = null;
    }

    function setDrawMode(on) {
        drawMode = !!on;
        effacerTrace();
        const btn = controlsBar && controlsBar.querySelector('#cm3DDrawBuildingBtn');
        if (btn) {
            btn.style.background = drawMode ? '#dc2626' : '#f5f5f5';
            btn.style.color = drawMode ? '#fff' : '#333';
        }
        if (drawMode) {
            if (measureMode) setMeasureMode(false);
            if (panMode) setPanMode(false);
            if (rotationMode) setRotationMode(false);
            if (selectedObj3DId) setSelectedObject3D(null);
            // Vue de dessus : le point cliqué est exactement le point du sol sous le curseur.
            setCameraView('plan');
            setStatus('Bâtiment : cliquez les sommets au sol — double-clic, Entrée ou clic sur le 1er point pour terminer, Retour arrière : dernier point, Échap : annuler.');
        }
        if (canvas3D) canvas3D.style.cursor = drawMode ? 'crosshair' : (panMode ? 'grab' : 'default');
    }

    function pointTraceDepuisClient(clientX, clientY) {
        const g = groundPointFromClient(clientX, clientY);
        return g ? new BABYLON.Vector3(g.x, altitudeTerrain(g.x, g.z) + 0.05, g.z) : null;
    }

    // Position écran (coordonnées client) d'un point de la scène, ou null s'il est hors champ.
    function ecranDe(p) {
        if (!scene || !camera || !engine || !canvas3D) return null;
        const vp = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
        const proj = BABYLON.Vector3.Project(p, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), vp);
        if (!(proj.z > 0 && proj.z < 1)) return null;
        const r = canvas3D.getBoundingClientRect();
        const echelle = r.width / (engine.getRenderWidth() || 1);
        return { x: r.left + proj.x * echelle, y: r.top + proj.y * echelle };
    }

    function dessinerMarqueursTrace() {
        traceMarqueurs.forEach((m) => { try { m.dispose(false, true); } catch (e) { /* noop */ } });
        traceMarqueurs = [];
        traceSommets.forEach((p, i) => {
            const s = BABYLON.MeshBuilder.CreateSphere(TRACE_PREFIX + 'Pt', { diameter: tailleMarqueur() * (i === 0 ? 1.6 : 1), segments: 8 }, scene);
            const m = new BABYLON.StandardMaterial(TRACE_PREFIX + 'PtMat', scene);
            // 1er sommet en vert : c'est lui qu'on reclique pour fermer la forme.
            const c = i === 0 ? new BABYLON.Color3(0.09, 0.64, 0.29) : new BABYLON.Color3(0.86, 0.15, 0.15);
            m.diffuseColor = c;
            m.emissiveColor = c;
            s.material = m;
            s.position = p.clone();
            s.isPickable = false;
            s.renderingGroupId = 1;
            traceMarqueurs.push(s);
        });
    }

    // Ligne du tracé : sommets posés + segment élastique jusqu'au curseur + retour au 1er sommet.
    function dessinerLigneTrace(curseur) {
        effacerLigneTrace();
        const pts = traceSommets.slice();
        if (curseur) pts.push(curseur);
        if (pts.length < 2) return;
        if (pts.length >= 3) pts.push(pts[0]);
        traceLigne = BABYLON.MeshBuilder.CreateLines(TRACE_PREFIX + 'Ligne', { points: pts }, scene);
        traceLigne.color = new BABYLON.Color3(0.86, 0.15, 0.15);
        traceLigne.isPickable = false;
        traceLigne.renderingGroupId = 1;
    }

    function suivreCurseurTrace(clientX, clientY) {
        if (!traceSommets.length) return;
        dessinerLigneTrace(pointTraceDepuisClient(clientX, clientY));
    }

    function ajouterSommetTrace(clientX, clientY) {
        const p = pointTraceDepuisClient(clientX, clientY);
        if (!p) { setStatus('Bâtiment : aucun point du sol sous le curseur.'); return; }
        if (traceSommets.length >= 3) {
            const e0 = ecranDe(traceSommets[0]);
            if (e0 && Math.hypot(e0.x - clientX, e0.y - clientY) <= TRACE_FERMETURE_PX) { terminerTrace(); return; }
        }
        const dernier = traceSommets[traceSommets.length - 1];
        if (dernier && Math.hypot(dernier.x - p.x, dernier.z - p.z) < 0.01) return; // 2e clic d'un double-clic
        if (traceSommets.length >= TRACE_MAX_SOMMETS) {
            setStatus(`Bâtiment : ${TRACE_MAX_SOMMETS} sommets au plus — double-clic ou Entrée pour terminer.`);
            return;
        }
        traceSommets.push(p);
        dessinerMarqueursTrace();
        dessinerLigneTrace(null);
        const n = traceSommets.length;
        setStatus(n < 3
            ? `Bâtiment : ${n} sommet(s) — au moins 3 pour fermer la forme.`
            : `Bâtiment : ${n} sommets — double-clic, Entrée ou clic sur le 1er point (vert) pour terminer.`);
    }

    function retirerDernierSommet() {
        if (!traceSommets.length) return;
        traceSommets.pop();
        dessinerMarqueursTrace();
        dessinerLigneTrace(null);
        setStatus(`Bâtiment : ${traceSommets.length} sommet(s).`);
    }

    function terminerTrace() {
        if (!drawMode) return;
        // Repère local du champ (celui de CM.state.sceneObjects3D) = monde + centre du modèle.
        const contour = traceSommets.map((p) => ({ x: p.x + modelCenter.x, z: p.z + modelCenter.z }));
        if (contour.length < 3) { setStatus('Bâtiment : placez au moins 3 sommets.'); return; }
        if (typeof CM.contourAutoIntersecte === 'function' && CM.contourAutoIntersecte(contour)) {
            setStatus('Bâtiment : les côtés de la forme se croisent — Retour arrière pour retirer le dernier point.');
            return;
        }
        setDrawMode(false);
        openHauteurBatimentModal(contour);
    }

    // Fenêtre de saisie de la hauteur, ouverte à la fin du tracé. Annuler = forme abandonnée.
    function openHauteurBatimentModal(contour) {
        if (!objectModal) return;
        const H = CM.BATIMENT_DESSINE_HAUTEUR || { min: 0.1, max: 100, defaut: 3 };
        objectModal.innerHTML = `
            <div style="background:#dc2626; color:#fff; padding:10px 14px; border-radius:6px 6px 0 0; display:flex; justify-content:space-between; align-items:center;">
                <strong style="font-size:14px;">⬠ Hauteur du bâtiment</strong>
                <button type="button" data-cm3d="cancel" style="background:none; border:none; color:#fff; font-size:20px; line-height:1; cursor:pointer;">&times;</button>
            </div>
            <div style="padding:14px;">
                <div style="font-size:12px; font-weight:700; color:#374151; margin-bottom:3px;">Hauteur (m) — entre ${H.min} et ${H.max}</div>
                <input type="number" data-cm3d="hauteur" step="0.1" min="${H.min}" max="${H.max}" value="${H.defaut}" title="Valeur entre ${H.min} et ${H.max} m" style="width:100%; box-sizing:border-box; padding:5px 7px; border:1px solid #d1d5db; border-radius:4px; font-size:14px; color:#111;">
                <div data-cm3d="erreur" style="display:none; margin-top:6px; font-size:12px; color:#b91c1c;"></div>
            </div>
            <div style="padding:0 14px 14px; display:flex; justify-content:space-between;">
                <button type="button" data-cm3d="cancel" class="cm-btn" style="background:#f5f5f5; color:#333;">Annuler</button>
                <button type="button" data-cm3d="ok" class="cm-btn" style="background:#dc2626; color:#fff; border-color:#dc2626;">Valider</button>
            </div>
        `;
        objectModal.dataset.objid = '';
        objectModal.style.display = 'block';
        makeModalDraggable(objectModal, objectModal.querySelector('div'));
        const input = objectModal.querySelector('[data-cm3d="hauteur"]');
        const erreur = objectModal.querySelector('[data-cm3d="erreur"]');
        const annuler = () => { closeObject3DModal(); setStatus('Bâtiment abandonné.'); };
        const valider = () => {
            const h = parseFloat(String(input.value).replace(',', '.'));
            if (!isFinite(h) || h < H.min || h > H.max) {
                erreur.textContent = `Saisissez une hauteur entre ${H.min} et ${H.max} m.`;
                erreur.style.display = 'block';
                input.focus();
                return;
            }
            closeObject3DModal();
            const obj = (typeof CM.addBatimentDessine3D === 'function') ? CM.addBatimentDessine3D(contour, h) : null;
            if (!obj) { setStatus('Bâtiment : forme invalide, rien n\'a été ajouté.'); return; }
            setSelectedObject3D(obj.id);
            setStatus(`Bâtiment ajouté (${h.toLocaleString('fr-FR')} m) — clic droit dessus pour le modifier ou le supprimer.`);
        };
        objectModal.querySelectorAll('[data-cm3d="cancel"]').forEach((b) => b.addEventListener('click', annuler));
        objectModal.querySelector('[data-cm3d="ok"]').addEventListener('click', valider);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); valider(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); annuler(); }
        });
        input.addEventListener('input', () => { erreur.style.display = 'none'; });
        try { input.focus(); input.select(); } catch (e) { /* noop */ }
    }

    function ensureGizmo() {
        if (rotationGizmo || !window.BABYLON || !scene) return;
        try {
            gizmoLayer = new BABYLON.UtilityLayerRenderer(scene);
            rotationGizmo = new BABYLON.RotationGizmo(gizmoLayer);
            // Anneau Y uniquement (rotation "à plat", comme la poignée de rotation d'un polygone).
            if (rotationGizmo.xGizmo) rotationGizmo.xGizmo.isEnabled = false;
            if (rotationGizmo.zGizmo) rotationGizmo.zGizmo.isEnabled = false;
            rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
            rotationGizmo.attachedNode = null;
            const commit = () => {
                const root = selectedObj3DId && objRootById[selectedObj3DId];
                if (!root || typeof CM.updateSceneObject3D !== 'function') return;
                let deg = root.rotation.y * 180 / Math.PI;
                deg = ((deg % 360) + 360) % 360;
                CM.updateSceneObject3D(selectedObj3DId, { rotationDeg: Math.round(deg * 10) / 10 });
            };
            if (rotationGizmo.yGizmo && rotationGizmo.yGizmo.dragBehavior) {
                rotationGizmo.yGizmo.dragBehavior.onDragEndObservable.add(commit);
            }
        } catch (e) { rotationGizmo = null; }
    }

    // Déplacement d'un objet : glisser la souris après l'avoir sélectionné (demande explicite).
    function wireCanvasObjectDrag() {
        if (!scene) return;
        scene.onPointerObservable.add((pi) => {
            const ev = pi.event;
            if (pi.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                if (ev.button !== 0) return; // seul le clic gauche
                // Règle : le clic pose un point au relâchement (cf. POINTERUP) ; aucune sélection ni
                // déplacement d'objet, la caméra reste libre d'orbiter pendant la mesure.
                if (measureMode) { mesureDown = { x: ev.clientX, y: ev.clientY }; return; }
                // Tracé d'un bâtiment : le sommet est posé au relâchement (cf. POINTERUP), un
                // cliquer-glisser continue d'orbiter ; aucun objet n'est sélectionné ni déplacé.
                if (drawMode) { traceDown = { x: ev.clientX, y: ev.clientY }; return; }
                // Mode main : le clic gauche déplace le dessin, il ne sélectionne/déplace aucun objet.
                if (panMode) {
                    ajusterSensibilitePanMain();
                    if (canvas3D) canvas3D.style.cursor = 'grabbing';
                    return;
                }
                const id = pi.pickInfo && pi.pickInfo.hit && pi.pickInfo.pickedMesh
                    && pi.pickInfo.pickedMesh.metadata && pi.pickInfo.pickedMesh.metadata.cm3dObjId;
                if (!id) {
                    // Clic dans le vide -> désélectionne l'objet courant (demande explicite), SAUF si
                    // on saisit la poignée de rotation (gizmo sur la couche utilitaire).
                    let onGizmo = false;
                    if (rotationMode && gizmoLayer && gizmoLayer.utilityLayerScene && scene) {
                        try {
                            const gpick = gizmoLayer.utilityLayerScene.pick(scene.pointerX, scene.pointerY);
                            onGizmo = !!(gpick && gpick.hit);
                        } catch (e) { /* noop */ }
                    }
                    if (!onGizmo && selectedObj3DId) setSelectedObject3D(null);
                    return; // laisser la caméra orbiter
                }
                setSelectedObject3D(id);
                const root = objRootById[id];
                const stateObj = (CM.state.sceneObjects3D || []).find((o) => o.id === id);
                const gp = groundPointFromClient(ev.clientX, ev.clientY);
                if (root && gp && stateObj) {
                    // startPos = position AFFICHÉE (compensée par rotateNodeAroundCenter si tourné) ;
                    // logicalStart = position LOGIQUE stockée (repère local). Un déplacement est le même
                    // vecteur dans les 2 repères -> on l'ajoute à chacun.
                    dragState = {
                        id, startGround: gp,
                        startPos: { x: root.position.x, z: root.position.z },
                        // Terrain : on mémorise l'altitude de départ pour que l'objet reste posé
                        // sur le relief pendant tout le déplacement.
                        startY: root.position.y,
                        startAlt: altitudeTerrain(root.position.x, root.position.z),
                        logicalStart: { x: Number(stateObj.x) || 0, z: Number(stateObj.z) || 0 },
                        lastDelta: { x: 0, z: 0 },
                    };
                    if (camera) { try { camera.detachControl(); } catch (e) { camera.detachControl(canvas3D); } }
                    if (canvas3D) canvas3D.style.cursor = 'move';
                }
            } else if (pi.type === BABYLON.PointerEventTypes.POINTERMOVE) {
                if (drawMode && !dragState) { suivreCurseurTrace(ev.clientX, ev.clientY); return; }
                if (!dragState) return;
                const gp = groundPointFromClient(ev.clientX, ev.clientY);
                const root = objRootById[dragState.id];
                if (gp && root) {
                    const dx = gp.x - dragState.startGround.x, dz = gp.z - dragState.startGround.z;
                    root.position.x = dragState.startPos.x + dx;
                    root.position.z = dragState.startPos.z + dz;
                    dragState.lastDelta = { x: dx, z: dz };
                    if (root.__poseParTable) {
                        // Petit champ : la racine garde sa hauteur, chaque table se recale sur SON
                        // terrain (même règle qu'à la construction).
                        root.position.y = dragState.startY;
                    } else {
                        root.position.y = dragState.startY + altitudeTerrain(root.position.x, root.position.z) - dragState.startAlt;
                    }
                    planifierRecalageGlisser(root);
                }
            } else if (pi.type === BABYLON.PointerEventTypes.POINTERUP) {
                if (drawMode && !dragState) {
                    const down = traceDown;
                    traceDown = null;
                    if (ev.button === 0 && down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5) {
                        ajouterSommetTrace(ev.clientX, ev.clientY);
                    }
                    return;
                }
                if (measureMode && !dragState) {
                    const down = mesureDown;
                    mesureDown = null;
                    if (ev.button === 0 && down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5) {
                        ajouterPointMesure(ev.clientX, ev.clientY);
                    }
                    return;
                }
                if (panMode && !dragState) { if (canvas3D) canvas3D.style.cursor = 'grab'; return; }
                if (!dragState) return;
                const d = dragState.lastDelta;
                if ((Math.abs(d.x) > 1e-4 || Math.abs(d.z) > 1e-4) && typeof CM.updateSceneObject3D === 'function') {
                    CM.updateSceneObject3D(dragState.id, {
                        x: dragState.logicalStart.x + d.x,
                        z: dragState.logicalStart.z + d.z,
                    });
                }
                dragState = null;
                if (camera) camera.attachControl(canvas3D, true);
                if (canvas3D) canvas3D.style.cursor = panMode ? 'grab' : 'default';
            }
        });
    }

    // --- Texture des toits (menu 3D, CM.state.roofTexture3D, cf. ROOF_TEXTURES_3D) ---------------
    // Choix PAR BÂTIMENT (b.roofTexture3D, chaque champ PV a le sien) ; résolution pan par pan dans
    // calepinage_maison_3d_textures_toit.js::resoudreTexture.
    const TOLERANCE_UV_CAPTURE = 0.002;

    function choixTextureToits() {
        const v = CM.state && CM.state.roofTexture3D;
        return ROOF_TEXTURES_3D.some((t) => t.value === v) ? v : 'auto';
    }

    /**
     * Photo des toits : la capture de carte (celle drapée au sol), projetée verticalement sur chaque
     * pan — la photo est une vue de dessus, donc (x, z) suffit, quelle que soit la pente ou
     * l'altitude. Renvoie null sans capture affichée.
     * { uvDe(p), couvre(poly), materiau() } — matériau créé au premier pan qui l'utilise.
     */
    function texturePhotoToits(model) {
        const image = model && model.groundImage && model.groundImage.url ? model.groundImage : null;
        const T3D = window.CalepinageMaison3DTerrain;
        if (!image || !T3D || typeof T3D.texteurDepuisQuad !== 'function') return null;
        const uvPlan = T3D.texteurDepuisQuad(image.corners);
        if (!uvPlan) return null;
        const uvDe = (p) => uvPlan(p.x, p.z);
        const dans = (t) => t.u >= -TOLERANCE_UV_CAPTURE && t.u <= 1 + TOLERANCE_UV_CAPTURE
            && t.v >= -TOLERANCE_UV_CAPTURE && t.v <= 1 + TOLERANCE_UV_CAPTURE;
        const couvre = (poly) => (poly || []).every((p) => dans(uvDe(p)));
        let materiau = null;
        return { uvDe, couvre, materiau: () => materiau || (materiau = materiauPhotoToits(image, T3D)) };
    }

    function materiauPhotoToits(image, T3D) {
        // Même texture que le relief (capture bordée de blanc, CLAMP) : même rendu, mêmes UV.
        const texture = (typeof T3D.textureCaptureBordee === 'function' && T3D.textureCaptureBordee(BABYLON, scene, image))
            || new BABYLON.Texture(image.url, scene);
        texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        const materiau = new BABYLON.StandardMaterial('roofPhotoMat', scene);
        materiau.diffuseTexture = texture;
        // Émissif partiel : couleurs proches de la photo, mais les pans gardent un peu de modelé
        // selon leur orientation au soleil (sinon toiture « plate » en vue iso).
        materiau.emissiveTexture = texture;
        materiau.emissiveColor = new BABYLON.Color3(0.40, 0.40, 0.40);
        materiau.specularColor = new BABYLON.Color3(0.03, 0.03, 0.03);
        materiau.backFaceCulling = false;
        sceneJunk.push(materiau, texture);
        return materiau;
    }

    /**
     * Répartit les pans de toiture par texture puis construit un maillage par texture.
     * - Pans : photo (UV = projection verticale sur la capture), texture type (UV = repère du pan,
     *   en carreaux de tailleU x tailleV m), ou couleur unie (roofMat).
     * - Pignons / bords de toit (skirtQuads) : ajoutés aux MURS (`murs`, même matériau) — ce sont
     *   des faces du bâtiment, pas de la couverture.
     */
    function toitsParTexture(photo, roofMat, murs) {
        const TT = window.CalepinageMaison3DTexturesToit;
        const pans = {};    // clé -> accumulateur
        const acc = (table, cle, uv) => table[cle] || (table[cle] = meshAccumulator(uv));
        return {
            ajouterBatiment(b, monter) {
                const choix = b.roofTexture3D || null;
                b.roofPolys.forEach((poly) => {
                    const pts = monter(poly);
                    // Photo seulement si le pan est ENTIÈREMENT dans la capture (un pan à cheval
                    // afficherait le blanc de la bordure hors capture).
                    const couvert = !!(photo && choix !== 'uni' && photo.couvre(poly));
                    const cle = TT ? TT.resoudreTexture(choix, b.typeMontage, couvert) : (couvert ? 'photo' : 'uni');
                    if (cle === 'photo') {
                        acc(pans, cle, photo.uvDe).addPolygon(pts);
                        return;
                    }
                    const def = TT && TT.TEXTURES[cle];
                    const repere = def ? TT.repereDePan(pts) : null;
                    if (!repere) { acc(pans, 'uni').addPolygon(pts); return; }
                    acc(pans, cle).addPolygon(pts, (p) => {
                        const r = repere(p);
                        return { u: r.u / def.tailleU, v: r.v / def.tailleV };
                    });
                });
                b.skirtQuads.forEach((q) => murs.addQuad(monter(q)));
            },
            construire() {
                Object.keys(pans).forEach((cle) => {
                    if (cle === 'uni') { pousserMesh(pans[cle].toMesh('roofs', roofMat)); return; }
                    if (cle === 'photo') { pousserMesh(pans[cle].toMesh('roofsPhoto', photo.materiau())); return; }
                    // Matériau partagé et mis en cache (texture dessinée une seule fois) : on détache
                    // le maillage de son matériau avant de le libérer, sinon disposeSceneJunk()
                    // (dispose(false, true)) détruirait aussi le matériau.
                    const m = TT.materiauTexture(BABYLON, scene, cle);
                    const mesh = pans[cle].toMesh('roofs_' + cle, m);
                    if (mesh) sceneJunk.push({ dispose() { mesh.material = null; mesh.dispose(); } });
                });
            },
        };
        function pousserMesh(mesh) { if (mesh) sceneJunk.push(mesh); }
    }

    function updateRoofTextureUI() {
        const sel = controlsBar && controlsBar.querySelector('#cm3DRoofTextureSelect');
        if (sel && document.activeElement !== sel) sel.value = choixTextureToits();
    }

    function appliquerTextureToits3D(valeur) {
        if (!CM.state) return;
        const v = ROOF_TEXTURES_3D.some((t) => t.value === valeur) ? valeur : 'auto';
        CM.state.roofTexture3D = v === 'auto' ? null : v;
        updateRoofTextureUI();
        if (typeof CM.recomputeResults === 'function') CM.recomputeResults();
        else refresh3DView();
        const capture = !!(sceneModel && sceneModel.groundImage && sceneModel.groundImage.url);
        if (v === 'auto' && !capture) setStatus('Aucune capture de carte affichée : texture selon le type de toiture.');
        else setStatus('Texture des toits modifiée.');
    }

    function buildImageGround(groundImage) {
        // Quad texturé posé à plat (y=0) exactement sur l'emprise couverte par la capture — mêmes
        // coins (mètres locaux) que le fond 2D, donc À LA MÊME ÉCHELLE que le bâtiment.
        const q = groundImage.corners;
        const positions = [];
        [q[0], q[1], q[2], q[3]].forEach((c) => positions.push(c.x, 0, c.z));
        const indices = [0, 1, 2, 0, 2, 3];
        // Pixel (0,0) = haut-gauche de l'image -> UV (0,1) ; (w,h) = bas-droite -> UV (1,0).
        const uvs = [0, 1, 1, 1, 1, 0, 0, 0];
        const normals = [];
        BABYLON.VertexData.ComputeNormals(positions, indices, normals);
        const vd = new BABYLON.VertexData();
        vd.positions = positions; vd.indices = indices; vd.normals = normals; vd.uvs = uvs;
        const mesh = new BABYLON.Mesh('groundImage', scene);
        vd.applyToMesh(mesh);
        const m = new BABYLON.StandardMaterial('groundImageMat', scene);
        const tex = new BABYLON.Texture(groundImage.url, scene);
        m.diffuseTexture = tex;
        m.emissiveTexture = tex;          // rendu quasi "non éclairé" : couleurs fidèles à la capture
        m.emissiveColor = new BABYLON.Color3(0.55, 0.55, 0.55);
        m.specularColor = new BABYLON.Color3(0, 0, 0);
        m.backFaceCulling = false;
        mesh.material = m;
        mesh.position.y = 0;
        sceneJunk.push(mesh, m, tex);
    }

    // Boutons "⛺ Ombrière" / "🔆 Petit champ solaire" : visibles seulement si le type de structure
    // courant produit la structure autoportée correspondante.
    function updateStructureButtons() {
        const set = (id, has) => {
            const b = controlsBar && controlsBar.querySelector('#' + id);
            if (b) b.style.display = has ? '' : 'none';
        };
        set('cm3DOmbriereFormBtn', typeof CM.getFormOmbriereObject === 'function' && !!CM.getFormOmbriereObject());
        set('cm3DPetitChampBtn', typeof CM.getFormPetitChampObject === 'function' && !!CM.getFormPetitChampObject());
        // Palette + appareil photo reflètent le champ PV affiché (appelé à chaque buildScene).
        updatePanelColorUI();
        updateRoofTextureUI();
        updateCaptureButtonUI();
    }

    /**
     * Charge (une fois par champ/emprise) le terrain réel et reconstruit la scène à son arrivée.
     * Silencieux si le service n'est pas là, hors couverture IGN, ou déjà chargé.
     */
    function majTerrain(model) {
        const T3D = window.CalepinageMaison3DTerrain;
        if (!T3D || !model || terrainDemande) return;
        terrainDemande = true;
        terrainPromesse = T3D.charger(model, model.sourceId || (CM.state && CM.state.sourceId))
            .then((sol) => {
                terrainDemande = false;
                if (sol === solTerrain) return;      // rien de neuf : pas de reconstruction
                solTerrain = sol;
                try { buildScene(); } catch (e) { /* la scène reste sur son sol plat */ }
            })
            .catch(() => { terrainDemande = false; });
    }

    /**
     * Captures hors écran (dossiers de plans, rapport) : le relief arrive de façon asynchrone et
     * reconstruit la scène à son arrivée. Une photo prise avant montrait un sol encore provisoire, et
     * une arrivée PENDANT la photo détruisait le sol en cours de rendu (vue aérienne absente). On
     * attend donc la fin du chargement — borné ; buildScene() peut en relancer un (autre emprise).
     */
    async function attendreTerrain(delaiMaxMs) {
        const fin = Date.now() + delaiMaxMs;
        while (terrainDemande && terrainPromesse && Date.now() < fin) {
            await avecDelaiMax(terrainPromesse, Math.max(0, fin - Date.now()), null, 'chargement du relief');
        }
    }

    // Obstacles 2D posés au sol (ombrière, petit champ, hors pan) : suivent le relief sous leur centre.
    function obstaclesAuSolItems(model) {
        return ((model && model.groundObstacleGroups) || []).map((g) => {
            const top = g.quads[4] || [];
            const cx = top.reduce((s2, p) => s2 + p.x, 0) / (top.length || 1);
            const cz = top.reduce((s2, p) => s2 + p.z, 0) / (top.length || 1);
            const dy = altitudeTerrain(cx, cz);
            return { g, monter: (q) => q.map((p) => ({ x: p.x, y: p.y + dy, z: p.z })) };
        });
    }

    // Un maillage par obstacle (metadata.cm3dObstacleId -> clic droit = édition), matériau partagé
    // par couleur. `repli` : matériau si la couleur est illisible (murs du bâtiment, sinon gris).
    function construireMaillagesObstacles(items, repli) {
        const matParCouleur = new Map();
        items.forEach(({ g, monter }, i) => {
            let obsMat = matParCouleur.get(g.color);
            if (!obsMat) {
                try {
                    obsMat = new BABYLON.StandardMaterial('obstacleMat_' + g.color, scene);
                    obsMat.diffuseColor = BABYLON.Color3.FromHexString(g.color);
                    obsMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
                    sceneJunk.push(obsMat);
                } catch (e) { obsMat = repli || mat('obstacleMatRepli', 0.42, 0.45, 0.5); if (!repli) sceneJunk.push(obsMat); }
                matParCouleur.set(g.color, obsMat);
            }
            const acc = meshAccumulator();
            g.quads.forEach((q) => acc.addQuad(monter(q)));
            const mesh = acc.toMesh('obstacle_' + (g.id || i), obsMat);
            if (!mesh) return;
            if (g.id && !g.autreChamp) {
                mesh.metadata = { cm3dObstacleId: g.id };
                mesh.isPickable = true;
            }
            sceneJunk.push(mesh);
        });
    }

    function buildScene() {
        let model = null;
        try { model = CM.buildResidential3DModel(); } catch (e) { model = null; }
        sceneModel = model;
        disposeSceneJunk();

        const span = (model && model.span) ? model.span : 20;
        majTerrain(model);
        const T3D = window.CalepinageMaison3DTerrain;
        let terrainPose = false;
        if (solTerrain && T3D && model) {
            // Relief réel : un seul maillage, avec la capture de carte drapée dessus.
            try {
                T3D.construireMaillage(BABYLON, scene, solTerrain, model, { aJeter: sceneJunk });
                terrainPose = true;
            } catch (e) {
                terrainPose = false;
            }
        }
        if (!terrainPose) {
            const groundMat = mat('groundMat', 0.82, 0.84, 0.80);
            const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: span * 3, height: span * 3 }, scene);
            ground.material = groundMat;
            ground.position.y = -0.05;
            sceneJunk.push(ground, groundMat);

            if (model && model.groundImage && model.groundImage.url) {
                try { buildImageGround(model.groundImage); } catch (e) { /* image au sol optionnelle */ }
            }
        }

        if (!model || !model.buildings.length) {
            // Pas de volume "maison" : soit rien de dessiné, soit une structure autoportée
            // (ombrière / petit champ solaire) qui EST dans model.sceneObjects.
            buildSceneObjects(model);
            if (model) construireMaillagesObstacles(obstaclesAuSolItems(model), null);
            applyShadows();
            updateStructureButtons();
            const nObj = (model && model.sceneObjects || []).length;
            setStatus(nObj ? `${nObj} structure(s) 3D` : 'Aucune emprise de toiture à afficher.');
            cadrerSiNecessaire();
            return;
        }

        const wallMat = mat('wallMat', 0.90, 0.87, 0.80);
        const roofMat = mat('roofMat', 0.70, 0.38, 0.30);
        // Couleur des panneaux : palette du menu 3D (CM.state.panelColor3D), sinon couleur d'origine.
        const pc = couleurPanneaux3D();
        const panelMat = pc
            ? mat('panelMat', pc.r, pc.g, pc.b, { emissive: [pc.r * 0.33, pc.g * 0.33, pc.b * 0.33] })
            : mat('panelMat', 0x1e / 255, 0x29 / 255, 0x3b / 255,
                { emissive: [0x1e / 255 * 0.33, 0x29 / 255 * 0.33, 0x3b / 255 * 0.33] });
        sceneJunk.push(wallMat, roofMat, panelMat);

        const walls = meshAccumulator();
        const panels = meshAccumulator();
        // Toitures : un maillage par texture (photo de la vue en plan, ardoise, tuile...), cf.
        // toitsParTexture() ; roofMat = couleur unie historique. Pignons et bords de toit : couleur des
        // murs (demande explicite : toutes les faces du bâtiment de la même couleur, distincte du toit).
        const toits = toitsParTexture(texturePhotoToits(model), roofMat, walls);
        // Obstacles 2D en 3D : un maillage PAR obstacle (sélectionnable, clic droit = édition) et un
        // matériau par COULEUR (donc par type — vélux/lanterneau bleu, cheminée rouge...).
        const obstacleItems = [];

        model.buildings.forEach((b) => {
            const fp = b.footprint;
            // Bâtiment posé sur le terrain : décalage vertical constant = altitude sous le centre de
            // son emprise (le bâtiment de la maison active est au centre du modèle, donc à 0).
            const centreB = fp.reduce((acc, p) => ({ x: acc.x + p.x / fp.length, z: acc.z + p.z / fp.length }), { x: 0, z: 0 });
            const dy = altitudeTerrain(centreB.x, centreB.z);
            const monter = (q) => q.map((p) => ({ x: p.x, y: p.y + dy, z: p.z }));
            for (let i = 0; i < fp.length; i++) {
                const a = fp[i], c = fp[(i + 1) % fp.length];
                walls.addQuad([
                    { x: a.x, y: dy, z: a.z },
                    { x: c.x, y: dy, z: c.z },
                    { x: c.x, y: b.wallHeight + dy, z: c.z },
                    { x: a.x, y: b.wallHeight + dy, z: a.z },
                ]);
            }
            toits.ajouterBatiment(b, monter);
            (b.parapetQuads || []).forEach((q) => walls.addQuad(monter(q))); // acrotère (toiture terrasse)
            b.panelQuads.forEach((q) => panels.addQuad(monter(q)));
            (b.obstacleGroups || []).forEach((g) => obstacleItems.push({ g, monter }));
        });

        [walls.toMesh('walls', wallMat), panels.toMesh('panels', panelMat)]
            .forEach((mesh) => { if (mesh) sceneJunk.push(mesh); });
        toits.construire();
        construireMaillagesObstacles(obstacleItems.concat(obstaclesAuSolItems(model)), wallMat);

        buildSceneObjects(model);
        applyShadows(); // (ré)enregistre les meshes reconstruits comme projecteurs d'ombre

        updateStructureButtons();

        const nObj = (model.sceneObjects || []).length;
        setStatus(`${model.buildings.length} bâtiment(s)` + (nObj ? ` — ${nObj} objet(s)` : ''));
        cadrerSiNecessaire();
    }

    // Vues préréglées de la caméra (demande explicite : X, Y, plan, isométrique).
    function setCameraView(mode) {
        if (!camera || !sceneModel) return;
        const span = sceneModel.span || 15;
        const h = sceneModel.maxHeight || 3;
        camera.setTarget(new BABYLON.Vector3(0, h * 0.35, 0));
        camera.radius = span * 2.2 + 14;
        if (mode === 'plan') { camera.alpha = -Math.PI / 2; camera.beta = 0.001; }          // dessus
        else if (mode === 'x') { camera.alpha = Math.PI; camera.beta = Math.PI / 2 - 0.001; } // élévation regard selon X
        else if (mode === 'y') { camera.alpha = -Math.PI / 2; camera.beta = Math.PI / 2 - 0.001; } // élévation regard selon Z (axe "Y" côté utilisateur)
        else { camera.alpha = -Math.PI / 4; camera.beta = Math.PI / 3.4; }                  // iso
    }

    /**
     * CORRECTIF (bug rapporté, capture à l'appui : "dans la vue 3D il y a encore plein d'espace vide
     * qu'on peut utiliser, on a de l'espace perdu à gauche, à droite, en haut et en bas") : le calcul
     * précédent cadrait la SPHERE englobante du bâti, c'est-à-dire sa demi-diagonale. Pour un
     * bâtiment très allongé, un hangar de 60 m sur 17 par exemple, cette diagonale dépasse de loin la
     * hauteur réellement occupée à l'écran : la caméra reculait bien plus que nécessaire et laissait
     * la moitié de l'image en ciel.
     *
     * Ce calcul mesure l'encombrement de la boîte DANS LE REPERE DE LA CAMERA : largeur et hauteur
     * apparentes, et profondeur. Le rayon retenu est le plus contraignant des deux axes de l'image,
     * augmenté de la demi-profondeur pour que la face la plus proche ne sorte pas du cadre. Les 4
     * bords sont donc serrés ensemble, et non plus seulement la hauteur.
     *
     * Fonction PURE (aucune dépendance à Babylon ni à la scène) : c'est de la géométrie, et elle est
     * couverte par tests/calepinage_maison/test_cadrage_3d.js.
     *
     * @param {{min:Object, max:Object, alpha:number, beta:number, fov:number, aspect:number,
     *          marge:number}} p coins de la boîte englobante, angles de la caméra, champ et ratio
     * @returns {Object|null} { centre, radius } ou null si la boîte est dégénérée
     */
    function calculerCadrageCamera(p) {
        const min = p.min, max = p.max;
        if (!min || !max) return null;
        const centre = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };

        // Direction cible vers caméra (convention ArcRotateCamera de Babylon), puis repère image.
        const versCamera = {
            x: Math.cos(p.alpha) * Math.sin(p.beta),
            y: Math.cos(p.beta),
            z: Math.sin(p.alpha) * Math.sin(p.beta),
        };
        const avant = { x: -versCamera.x, y: -versCamera.y, z: -versCamera.z };
        const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
        const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
        const norm = (v) => {
            const n = Math.hypot(v.x, v.y, v.z);
            return n < 1e-9 ? null : { x: v.x / n, y: v.y / n, z: v.z / n };
        };
        // Vue strictement à l'aplomb : le produit vectoriel dégénère, on prend un axe arbitraire.
        const droite = norm(cross(avant, { x: 0, y: 1, z: 0 })) || { x: 1, y: 0, z: 0 };
        const haut = norm(cross(droite, avant)) || { x: 0, y: 1, z: 0 };

        const tanV = Math.tan((p.fov || 0.8) / 2);       // champ VERTICAL (mode par défaut de Babylon)
        const tanH = tanV * (p.aspect || 1.45);

        // Contrainte exacte, coin par coin. La caméra étant à `radius` du centre, un coin situé à la
        // profondeur `pf` (comptée le long de l'axe de visée, positif = plus loin) se trouve à
        // `radius + pf` de l'objectif : il reste dans le cadre tant que
        //   |décalage latéral| <= (radius + pf) x tangente du demi-champ.
        // D'où le rayon minimal que ce coin impose. On retient le plus contraignant des 8.
        //
        // Prendre séparément le plus grand décalage et la plus grande profondeur, puis les
        // additionner, surestimait le recul : le sujet n'occupait alors que 53 à 87 % du cadre selon
        // sa forme, d'où l'espace perdu sur les 4 bords signalé par l'utilisateur.
        let rayonMini = 0, aDesCoins = false;
        [min.x, max.x].forEach((x) => [min.y, max.y].forEach((y) => [min.z, max.z].forEach((z) => {
            const v = { x: x - centre.x, y: y - centre.y, z: z - centre.z };
            const pf = dot(v, avant);
            aDesCoins = true;
            rayonMini = Math.max(
                rayonMini,
                Math.abs(dot(v, haut)) / tanV - pf,
                Math.abs(dot(v, droite)) / tanH - pf,
            );
        })));
        if (!aDesCoins || !(rayonMini > 0)) return null;

        return { centre: centre, radius: rayonMini * (p.marge || 1.04) };
    }

    /**
     * NOUVEAU (demande explicite : "pousser le zoom au maximum sur les vues 3D, on ne voit pas bien
     * les panneaux ; zoom maximum pour voir le contour du bâtiment ou des objets 3D présents dans
     * la scène").
     *
     * Cadre la caméra au plus serré sur ce qu'il y a à voir : bâtiment, panneaux et objets 3D posés.
     * Le sol est volontairement EXCLU du calcul — le quad texturé avec la capture de carte couvre
     * toute l'emprise de l'écran capturé, souvent des dizaines de fois le bâtiment : le prendre en
     * compte, comme le faisait le cadrage par défaut (rayon = 2,2 fois l'envergure du modèle),
     * réduisait la maison à une vignette au centre de l'image.
     *
     * Le rayon est déduit de la sphère englobante et de l'angle de champ VERTICAL de la caméra, qui
     * est le côté limitant pour une image en paysage.
     *
     * @param {number} [marge=1.06] facteur de respiration autour du sujet (1 = il touche les bords)
     * @param {number} [aspect] largeur/hauteur de l'image visée — celle de la CAPTURE, qui n'est pas
     *   forcément celle du canvas à l'écran
     * @returns {boolean} false si la scène ne contient rien d'autre que son sol
     */
    function cadrerCameraSurBati(marge, aspect) {
        if (!camera || !scene) return false;
        // Tous les sols exclus, y compris le relief du terrain automatique ('terrainMNT') : pris en
        // compte, il faisait cadrer tout le terrain et les ombrières restaient une vignette au centre
        // de la vue 3D du dossier (bug rapporté).
        const sujets = scene.meshes.filter((m) => m
            && !SOLS_NON_PROJECTEURS.has(m.name)
            && typeof m.getTotalVertices === 'function' && m.getTotalVertices() > 0
            && m.isEnabled && m.isEnabled());
        if (!sujets.length) return false;

        let min = null, max = null;
        sujets.forEach((m) => {
            try {
                m.computeWorldMatrix(true);
                const bb = m.getBoundingInfo().boundingBox;
                min = min ? BABYLON.Vector3.Minimize(min, bb.minimumWorld) : bb.minimumWorld.clone();
                max = max ? BABYLON.Vector3.Maximize(max, bb.maximumWorld) : bb.maximumWorld.clone();
            } catch (e) { /* mesh sans géométrie exploitable : ignoré */ }
        });
        if (!min || !max) return false;

        const ratio = aspect || (engine ? engine.getAspectRatio(camera) : 1.45) || 1.45;
        const cadrage = calculerCadrageCamera({
            min: { x: min.x, y: min.y, z: min.z },
            max: { x: max.x, y: max.y, z: max.z },
            alpha: camera.alpha, beta: camera.beta,
            fov: camera.fov || 0.8, aspect: ratio, marge: marge,
        });
        if (!cadrage) return false;

        // CORRECTIF (bug rapporté, capture à l'appui : "il faut encore zoomer, il y a plein d'espace
        // vide perdu") : ArcRotateCamera.setTarget() ne se contente pas de déplacer la cible — sauf à
        // le lui demander, il RECALCULE alpha, beta et radius à partir de la position courante de la
        // caméra. L'angle de vue posé juste avant par setCameraView() était donc écrasé, et le rayon
        // calculé ici s'appliquait à une orientation qui n'était plus celle prévue : le cadrage
        // tombait à côté, d'où l'image qui restait large malgré le calcul. On repose donc les angles
        // voulus APRÈS la cible.
        const alphaVoulu = camera.alpha, betaVoulu = camera.beta;
        camera.setTarget(new BABYLON.Vector3(cadrage.centre.x, cadrage.centre.y, cadrage.centre.z));
        camera.alpha = alphaVoulu;
        camera.beta = betaVoulu;
        camera.radius = cadrage.radius;
        return true;
    }

    /**
     * CORRECTIF (bug rapporté : "quand on clique sur un objet de la scène 3D ou un bouton, la vue
     * revient toujours à la vue par défaut") : la scène est reconstruite après CHAQUE action
     * (sélection, déplacement, modification d'un objet, bouton...) et buildScene() recadrait
     * systématiquement la caméra. On ne cadre plus qu'à l'ouverture de la vue 3D et au changement de
     * champ PV affiché ; sinon la caméra garde l'angle et le zoom choisis par l'utilisateur. Le
     * bouton « Vue par défaut » (frameCamera) reste disponible.
     */
    let cameraACadrer = true;
    let sourceCadree = null;
    function cadrerSiNecessaire() {
        const source = (CM.state && CM.state.sourceId) || null;
        if (!cameraACadrer && source === sourceCadree) return;
        frameCamera();
        cameraACadrer = false;
        sourceCadree = source;
    }

    function frameCamera() {
        if (!camera || !sceneModel) return;
        const span = sceneModel.span || 15;
        const h = sceneModel.maxHeight || 3;
        camera.setTarget(new BABYLON.Vector3(0, h * 0.35, 0));
        camera.alpha = -Math.PI / 2;
        camera.beta = Math.PI / 3.1;
        camera.radius = span * 2.2 + 14;
    }

    // Latitude du site (source Google Maps) sinon ~centre France.
    function siteLatitude() {
        try {
            const o = CM.state.roofLocalOrigin;
            if (o && typeof o.lat === 'function') { const v = o.lat(); if (isFinite(v)) return v; }
        } catch (e) { /* noop */ }
        return 46;
    }

    // --- Analyse d'ombrage : position du soleil + générateur d'ombres ---
    // Modèle simple (hémisphère nord, soleil au Sud à midi) : l'heure balaie l'azimut Est->Sud->Ouest,
    // l'élévation suit un arc dont le maximum (à midi solaire) dépend du MOIS via la déclinaison
    // solaire et de la latitude du site : elevMidi = 90 - latitude + déclinaison.
    function applySun() {
        if (!sunLight) return;
        const hourFrac = Math.max(0, Math.min(1, (shadowHour - 6) / 14)); // 0 à 6h, 1 à 20h
        const azDeg = 90 + hourFrac * 180;           // 90=Est, 180=Sud, 270=Ouest (azimut depuis le Nord)
        const dayOfYear = (Math.max(1, Math.min(12, shadowMonth)) - 0.5) * 30.44;
        const declDeg = 23.45 * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365);
        const maxElev = Math.max(6, 90 - siteLatitude() + declDeg);
        const elevDeg = Math.max(2, maxElev * Math.sin(hourFrac * Math.PI));
        const az = azDeg * Math.PI / 180, el = elevDeg * Math.PI / 180;
        // Vecteur VERS le soleil (repère Babylon : +X Est, +Y haut, +Z Nord).
        const toSun = new BABYLON.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
        const R = rayonCarteOmbres();
        const dist = 2 * R + 20;
        sunLight.position = toSun.scale(dist);
        cadrerCarteOmbres(dist, R);
        // setDirectionToTarget (plutôt qu'une assignation directe de .direction) passe par l'API qui
        // invalide la matrice de projection de la carte d'ombres -> les ombres suivent l'heure.
        if (typeof sunLight.setDirectionToTarget === 'function') {
            sunLight.setDirectionToTarget(BABYLON.Vector3.Zero());
        } else {
            sunLight.direction = toSun.scale(-1);
        }
        // Force le recalcul de l'emprise ortho + un nouveau rendu de la carte d'ombres.
        if (shadowGen && typeof shadowGen.getShadowMap === 'function') {
            const sm = shadowGen.getShadowMap();
            if (sm && typeof sm.resetRefreshCounter === 'function') sm.resetRefreshCounter();
        }
    }

    /**
     * CORRECTIF (bug rapporté à nouveau : "on ne voit plus l'ombre portée d'un objet 3D sur les
     * panneaux") : le rayon était déduit de sceneModel.span, qui inclut les coins de la capture de
     * carte au sol (groundImage, souvent des centaines de mètres) — la dilution que l'emprise fixe
     * devait justement éviter. On le déduit désormais des seuls maillages projecteurs (bâtiment,
     * panneaux, structures, objets, obstacles ; sols et règle exclus) : sphère centrée sur l'origine
     * (cible du soleil) qui les contient tous. Repli sur span tant que la scène est vide.
     */
    function rayonCarteOmbres() {
        let rayon = 0;
        (scene && scene.meshes ? scene.meshes : []).forEach((m) => {
            if (!m || !m.name || SOLS_NON_PROJECTEURS.has(m.name) || m.name.startsWith(MESURE_PREFIX)) return;
            if (!m.getTotalVertices || m.getTotalVertices() === 0 || (m.isEnabled && !m.isEnabled())) return;
            try {
                m.computeWorldMatrix(true);
                const bb = m.getBoundingInfo().boundingBox;
                const a = bb.minimumWorld, b = bb.maximumWorld;
                [a.x, b.x].forEach((x) => [a.y, b.y].forEach((y) => [a.z, b.z].forEach((z) => {
                    rayon = Math.max(rayon, Math.hypot(x, y, z));
                })));
            } catch (e) { /* mesh sans géométrie exploitable : ignoré */ }
        });
        if (rayon > 0 && isFinite(rayon)) return rayon * 1.05 + 2;
        const span = (sceneModel && sceneModel.span) ? sceneModel.span : 30;
        const hMax = (sceneModel && sceneModel.maxHeight) ? sceneModel.maxHeight : 5;
        return span * 1.3 + hMax * 2 + 5;
    }

    /**
     * CORRECTIF (bug rapporté : "les ombres portées ne s'affichent plus sur les panneaux") : emprise
     * de la carte d'ombres FIXÉE sur la scène du champ au lieu d'être déduite à chaque rendu des
     * boîtes englobantes de tous les projecteurs (autoUpdateExtends). Avec le calcul automatique, un
     * seul maillage étendu ou excentré (relief, structure, objet lointain) suffisait à étaler les 2048
     * texels de la carte sur une zone immense : l'ombre d'un arbre ou d'un obstacle devenait
     * sous-texel et disparaissait, sans aucune erreur. Le soleil vise toujours l'origine de la scène
     * (setDirectionToTarget(0)) : une emprise carrée de rayon R autour d'elle convient à toute heure.
     * @param {number} dist distance soleil -> origine (cf. applySun)
     * @param {number} R demi-côté de l'emprise (cf. rayonCarteOmbres)
     */
    function cadrerCarteOmbres(dist, R) {
        if (!sunLight) return;
        sunLight.autoUpdateExtends = false;
        if ('autoCalcShadowZBounds' in sunLight) sunLight.autoCalcShadowZBounds = false;
        sunLight.orthoLeft = -R;
        sunLight.orthoRight = R;
        sunLight.orthoBottom = -R;
        sunLight.orthoTop = R;
        sunLight.shadowMinZ = Math.max(0.5, dist - 1.5 * R);
        sunLight.shadowMaxZ = dist + 1.5 * R;
        // Les bornes ortho n'invalident pas d'elles-mêmes la projection mise en cache.
        if (typeof sunLight.forceProjectionMatrixCompute === 'function') sunLight.forceProjectionMatrixCompute();
    }

    /**
     * Diagnostic des ombres, à lancer dans la console du navigateur : CM3DDiagnosticOmbres().
     * Renvoie l'état réel (générateur créé ?, WebGL, position/direction du soleil, emprise de la
     * carte d'ombres, projecteurs/récepteurs) pour localiser une absence d'ombre sans deviner.
     */
    function diagnosticOmbres() {
        const v = (x) => (x ? { x: +x.x.toFixed(2), y: +x.y.toFixed(2), z: +x.z.toFixed(2) } : null);
        const sm = shadowGen && typeof shadowGen.getShadowMap === 'function' ? shadowGen.getShadowMap() : null;
        const info = {
            vue3DActive: !!active,
            ombresCochees: !!shadowsOn,
            generateur: !!shadowGen,
            webGL: engine ? engine.webGLVersion : null,
            filtrage: shadowGen ? (shadowGen.usePercentageCloserFiltering ? 'PCF' : (shadowGen.usePoissonSampling ? 'Poisson' : 'autre')) : null,
            heure: shadowHour, mois: shadowMonth,
            soleilPosition: sunLight ? v(sunLight.position) : null,
            soleilDirection: sunLight ? v(sunLight.direction) : null,
            emprise: sunLight ? {
                ortho: [sunLight.orthoLeft, sunLight.orthoRight, sunLight.orthoBottom, sunLight.orthoTop].map((n) => +Number(n).toFixed(1)),
                minZ: sunLight.shadowMinZ, maxZ: sunLight.shadowMaxZ, auto: sunLight.autoUpdateExtends,
            } : null,
            projecteurs: sm && sm.renderList ? sm.renderList.length : 0,
            recepteurs: scene ? (scene.meshes || []).filter((m) => m.receiveShadows).length : 0,
            panneauxRecepteurs: scene ? (scene.meshes || []).filter((m) => /panel|pvCell/i.test(m.name || '') && m.receiveShadows).length : 0,
            camera: camera ? { alpha: +camera.alpha.toFixed(3), beta: +camera.beta.toFixed(3), radius: +camera.radius.toFixed(1), cible: v(camera.target) } : null,
        };
        console.table ? console.table(info) : console.log(info);
        return info;
    }
    window.CM3DDiagnosticOmbres = diagnosticOmbres;

    // Maillages de sol : récepteurs d'ombre uniquement (plan neutre, capture de carte, relief MNT).
    const SOLS_NON_PROJECTEURS = new Set(['ground', 'groundImage', 'terrainMNT']);

    // Active/désactive les ombres et (ré)enregistre tous les meshes de la scène comme projecteurs.
    function applyShadows() {
        if (!scene || !sunLight) return;
        if (shadowsOn && !shadowGen) {
            try {
                shadowGen = new BABYLON.ShadowGenerator(2048, sunLight);
                // PCF plutôt qu'ESM : l'exponential shadow map "fuit" aux angles rasants (soleil bas
                // en début/fin de journée) et l'ombre disparaissait alors complètement (bug rapporté).
                shadowGen.useExponentialShadowMap = false;
                shadowGen.useBlurExponentialShadowMap = false;
                if ('usePercentageCloserFiltering' in shadowGen) {
                    shadowGen.usePercentageCloserFiltering = true;
                    shadowGen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
                } else {
                    shadowGen.usePoissonSampling = true;
                }
                shadowGen.bias = 0.0009;
                shadowGen.normalBias = 0.02;
                shadowGen.darkness = 0.35;
            } catch (e) {
                // Échec jusqu'ici SILENCIEUX : lumière visible mais aucune ombre, sans explication.
                console.warn('[Calepinage maison 3D] Générateur d\'ombres impossible à créer :', e);
                setStatus('Ombres indisponibles (voir console).');
                shadowGen = null;
            }
        }
        if (!shadowsOn && shadowGen) {
            try { shadowGen.dispose(); } catch (e) { /* noop */ }
            shadowGen = null;
        }
        // Sol + bâtiments/objets reçoivent les ombres ; tout maillage géométrique les projette.
        (scene.meshes || []).forEach((m) => {
            if (!m || !m.name || !m.getTotalVertices || m.getTotalVertices() === 0) return;
            m.receiveShadows = shadowsOn;
        });
        if (shadowGen) {
            const sm = shadowGen.getShadowMap();
            if (sm) {
                // CORRECTIF (bug rapporté : "les ombres portées n'apparaissent plus sur les panneaux,
                // comme auparavant") : le sol REÇOIT les ombres mais n'en projette pas. Le maillage du
                // relief réel ('terrainMNT', arrivé avec le terrain automatique) n'était pas exclu
                // comme 'ground'/'groundImage' : devenu projecteur, il élargissait l'emprise auto de
                // la carte d'ombres (autoUpdateExtends) à tout le terrain drapé — quelques centaines
                // de mètres pour 2048 texels — et les ombres d'un arbre ou d'un bloc se diluaient
                // jusqu'à disparaître sur le champ PV.
                sm.renderList = (scene.meshes || []).filter((m) =>
                    m && m.name && !SOLS_NON_PROJECTEURS.has(m.name) && !m.name.startsWith(MESURE_PREFIX)
                    && m.getTotalVertices && m.getTotalVertices() > 0);
                if (typeof sm.resetRefreshCounter === 'function') sm.resetRefreshCounter();
                // Diagnostic (console) : projecteurs et récepteurs réellement enregistrés.
                try {
                    const recepteurs = (scene.meshes || []).filter((m) => m.receiveShadows).length;
                    console.info(`[Calepinage maison 3D] Ombres : ${sm.renderList.length} projecteur(s), ${recepteurs} récepteur(s).`);
                } catch (e) { /* noop */ }
            }
        }
        applySun();
    }

    function startEngine() {
        // Options prudentes : pas de preserveDrawingBuffer/stencil (coût mémoire). Le contexte WebGL
        // Babylon est créé UNE SEULE FOIS et JAMAIS détruit ensuite (canvas3D reste dans le DOM même
        // modal fermé) : on évite ainsi le cycle créer/détruire/recréer qui faisait perdre son
        // contexte à la carte Google (WebGL aussi) -> "menu horizontal disparu, F5 nécessaire".
        const creerMoteur = () => new BABYLON.Engine(canvas3D, true, {
            preserveDrawingBuffer: false, stencil: false, antialias: true,
            failIfMajorPerformanceCaveat: false, doNotHandleContextLost: false,
        }, false);
        try {
            engine = creerMoteur();
        } catch (e) {
            // Canevas déjà doté d'un contexte 2D (cf. creerCanvas3D) : un canevas neuf, une seule fois.
            console.warn('[Calepinage maison 3D] Canevas 3D inutilisable pour WebGL, remplacement.', e);
            remplacerCanvas3D();
            engine = creerMoteur();
        }
        canvas3D.addEventListener('webglcontextlost', (ev) => {
            ev.preventDefault();
            setStatus('Contexte 3D perdu — repassez en 2D puis re-basculez.');
        }, false);

        scene = new BABYLON.Scene(engine);
        scene.clearColor = new BABYLON.Color4(0.92, 0.93, 0.95, 1);
        // Pas de recherche de l'objet sous la souris à CHAQUE mouvement (aucun survol n'est utilisé ;
        // le clic garde sa détection, et les modes règle/tracé font leur propre scene.pick).
        scene.skipPointerMovePicking = true;

        camera = new BABYLON.ArcRotateCamera('cam3D', -Math.PI / 2, Math.PI / 3.1, 60, new BABYLON.Vector3(0, 1, 0), scene);
        camera.attachControl(canvas3D, true);
        camera.wheelPrecision = 18;
        camera.lowerRadiusLimit = 2;
        camera.upperRadiusLimit = 6000;
        camera.panningSensibility = 40;

        const hemi = new BABYLON.HemisphericLight('hemi3D', new BABYLON.Vector3(0.2, 1, 0.12), scene);
        hemi.intensity = 0.85;
        sunLight = new BABYLON.DirectionalLight('sun3D', new BABYLON.Vector3(-0.4, -0.82, -0.35), scene);
        sunLight.position = new BABYLON.Vector3(60, 140, 60);
        sunLight.intensity = 1.15;
        // Emprise de la carte d'ombres : fixée sur la scène par applySun() -> cadrerCarteOmbres()
        // (plus d'autoUpdateExtends, cf. le correctif qui y est décrit).
        applySun();

        try {
            highlightLayer = new BABYLON.HighlightLayer('hl3D', scene);
            highlightLayer.innerGlow = false;
            highlightLayer.outerGlow = true;
            // Halo plus resserré et moins lumineux (demande explicite : la sélection gênait la vision).
            highlightLayer.blurHorizontalSize = 0.6;
            highlightLayer.blurVerticalSize = 0.6;
        } catch (e) { highlightLayer = null; }
        ensureGizmo();
        wireCanvasObjectDrag();

        buildScene();
        startRenderLoop();
        engine.resize();

        onResize = () => { try { if (engine) engine.resize(); } catch (e) { /* noop */ } };
        window.addEventListener('resize', onResize);
    }

    let renderLoopRunning = false;
    function startRenderLoop() {
        if (!engine || renderLoopRunning) return;
        engine.runRenderLoop(() => {
            try { if (scene) scene.render(); } catch (e) { /* une frame ratée ne doit rien casser */ }
        });
        renderLoopRunning = true;
    }
    function stopRenderLoop() {
        if (!engine || !renderLoopRunning) return;
        try { engine.stopRenderLoop(); } catch (e) { /* noop */ }
        renderLoopRunning = false;
    }

    // Arrêt "doux" : on stoppe le rendu et on libère les meshes, mais on GARDE le moteur/contexte
    // WebGL (canvas3D persiste dans le DOM) pour ne jamais recréer de contexte.
    // NB : on NE déclenche PLUS de google.maps 'resize' ici — sur une carte masquée derrière le modal
    // cela corrompait sa projection et cassait la capture d'écran suivante (fond démesuré).
    function suspendEngine() {
        stopRenderLoop();
        try { disposeSceneJunk(); } catch (e) { /* noop */ }
    }

    function sizeCanvasToPlan() {
        if (!canvas3D) return;
        // canvas3D est déjà visible (width:100%) quand cette fonction est appelée -> on part de SA
        // largeur rendue. Le canevas 2D est masqué à ce moment (getBoundingClientRect().height = 0),
        // donc on reconstitue la hauteur via le ratio natif du canevas 2D (1080x760).
        const w = canvas3D.clientWidth || (canvas3D.parentNode ? canvas3D.parentNode.clientWidth : 0);
        const hPx = Math.max(320, Math.round((w || 800) * 760 / 1080));
        canvas3D.style.height = hPx + 'px';
        if (engine) engine.resize();
    }

    /**
     * CORRECTIF (demande explicite : « plusieurs ombrières, bâtiments... dessinés sur la carte : en
     * passant à la vue 3D, tous les éléments doivent s'afficher automatiquement ») : la 3D n'ajoute
     * les autres champs PV qu'en vue combinée (CM.multiHouseViewActive, cf. buildResidential3DModel),
     * désactivée par défaut — il fallait revenir au plan 2D et cliquer « Afficher toutes les maisons
     * connues ». Elle est désormais activée d'office à l'ouverture de la 3D dès que la carte porte
     * plusieurs champs ; le bouton de la barre d'outils permet toujours de la désactiver.
     */
    function activerVueTousLesChamps() {
        if (CM.multiHouseViewActive) return false;
        const mgr = window.MaisonPolygonManagerInstance;
        const nbChamps = mgr && Array.isArray(mgr.polygons) ? mgr.polygons.filter(Boolean).length : 0;
        if (nbChamps < 2) return false;
        CM.multiHouseViewActive = true;
        if (typeof CM.updateMultiHouseViewUI === 'function') CM.updateMultiHouseViewUI();
        try { if (typeof CM.computeFit === 'function') CM.computeFit(); } catch (e) { /* plan 2D recadré au retour */ }
        // Fond de carte (sol de la 3D) élargi aux autres champs, puis scène reconstruite.
        if (typeof CM.assurerFondCarteVueMulti === 'function') {
            CM.assurerFondCarteVueMulti()
                .then((recapture) => { if (recapture) refresh3DView(); })
                .catch((err) => console.warn('[Calepinage 3D] Fond de carte vue multi-champs', err));
        }
        return true;
    }

    function open3DView() {
        try {
            ensureDom();
            if (!canvas3D) return;
            activerVueTousLesChamps();
            const canvas2D = CM.modalBody.querySelector('#calepinageMaisonCanvas');
            active = true;
            CM.state.view3DMode = true;
            cameraACadrer = true; // ouverture de la vue : cadrage par défaut (cf. cadrerSiNecessaire)
            setStatus('Chargement du moteur 3D…');
            controlsBar.style.display = 'flex';
            [objectPalette, shadowPalette].forEach((p) => { if (p) p.style.display = 'none'; });
            ['cm3DPaletteToggleBtn', 'cm3DShadowToggleBtn'].forEach((bid) => {
                const b = controlsBar.querySelector('#' + bid);
                if (b) { b.style.background = '#f5f5f5'; b.style.color = '#333'; }
            });
            canvas3D.style.display = 'block';
            if (canvas2D) canvas2D.style.display = 'none';
            setModalChrome(false); // masque barre d'outils + carte de résultats
            sizeCanvasToPlan();
            if (typeof CM.updateView2D3DUI === 'function') CM.updateView2D3DUI();

            loadBabylon().then(() => {
                if (!active) return;
                try {
                    sizeCanvasToPlan();
                    if (engine) {
                        // Moteur déjà créé (toggle précédent) : on relance simplement le rendu.
                        buildScene();
                        startRenderLoop();
                        engine.resize();
                    } else {
                        startEngine();
                    }
                    setPanMode(false); // repart en mode orbite
                } catch (e) {
                    setStatus('Erreur d\'initialisation 3D : ' + (e && e.message ? e.message : e));
                }
            }).catch((err) => {
                setStatus('Impossible de charger le moteur 3D (réseau ?). ' + (err && err.message ? err.message : ''));
            });
        } catch (e) {
            // Un échec de la 3D ne doit JAMAIS casser le formulaire 2D / l'app.
            active = false;
            try { close3DView(); } catch (e2) { /* noop */ }
        }
    }

    function close3DView() {
        active = false;
        CM.state.view3DMode = false;
        try { suspendEngine(); } catch (e) { /* noop */ }
        const canvas2D = CM.modalBody && CM.modalBody.querySelector('#calepinageMaisonCanvas');
        if (canvas3D) canvas3D.style.display = 'none';
        if (controlsBar) controlsBar.style.display = 'none';
        [objectPalette, shadowPalette].forEach((p) => { if (p) p.style.display = 'none'; });
        closeObject3DModal();
        selectedObj3DId = null;
        if (rotationMode) setRotationMode(false);
        if (measureMode) setMeasureMode(false);
        if (drawMode) setDrawMode(false);
        try { applySelectionVisual(); } catch (e) { /* noop */ }
        if (canvas2D) canvas2D.style.display = '';
        try { setModalChrome(true); } catch (e) { /* noop */ } // réaffiche barre d'outils + résultats
        if (typeof CM.updateView2D3DUI === 'function') CM.updateView2D3DUI();
        try { if (typeof CM.render === 'function') CM.render(); } catch (e) { /* noop */ }
    }

    function toggle3DView() {
        if (active) close3DView();
        else open3DView();
    }

    // Rebâtit la scène si la 3D est ouverte (appelé après CHAQUE action discrète — cf.
    // recomputeResults). Encapsulé : une erreur de reconstruction 3D ne doit pas remonter dans le 2D.
    function refresh3DView() {
        if (!(active && engine && scene)) return;
        try { buildScene(); } catch (e) { setStatus('Erreur de reconstruction 3D.'); }
    }

    /**
     * NOUVEAU (demande explicite, capture à l'appui : "il manque une partie de la carte") : plus
     * grand rectangle de l'image ne contenant AUCUN pixel de fond, et passant par le centre.
     *
     * Le sol de la scène 3D est un rectangle texturé avec la capture de la carte : vu en
     * perspective, il devient un trapèze. Rogner sur la simple boîte englobante du contenu, comme on
     * le faisait, conservait donc les coins vides de ce trapèze — d'où les zones blanches et cette
     * impression de carte coupée. On cherche ici un rectangle entièrement rempli : l'image finale
     * n'a plus aucun vide, au prix d'un peu de carte sur les bords.
     *
     * Le rectangle est contraint à contenir le centre de l'image, là où la caméra a cadré le
     * bâtiment : sans cette contrainte, le plus grand rectangle plein pourrait se trouver dans un
     * coin de carte, loin du sujet.
     *
     * Algorithme classique du plus grand rectangle dans une matrice binaire : pour chaque ligne, une
     * pile parcourt l'histogramme des hauteurs pleines. Coût linéaire en nombre de pixels.
     *
     * Fonction PURE : couverte par tests/calepinage_maison/test_rognage_image.js.
     *
     * @param {Uint8ClampedArray|Array} px pixels RGBA
     * @param {number} w largeur
     * @param {number} h hauteur
     * @param {number} [tolerance=10] écart admis par canal pour considérer un pixel comme du fond
     * @returns {Object|null} { minX, minY, maxX, maxY } ou null si aucun rectangle plein ne convient
     */
    function calculerRectanglePlein(px, w, h, tolerance) {
        if (!px || !w || !h) return null;
        const fond = [px[0], px[1], px[2]];
        const tol = tolerance != null ? tolerance : 10;
        const cx = Math.floor(w / 2), cy = Math.floor(h / 2);

        const hauteurs = new Int32Array(w);       // pixels pleins consécutifs au-dessus de la ligne
        let meilleur = null, meilleureAire = 0;
        const pile = new Int32Array(w + 1);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const estFond = Math.abs(px[i] - fond[0]) <= tol
                    && Math.abs(px[i + 1] - fond[1]) <= tol
                    && Math.abs(px[i + 2] - fond[2]) <= tol;
                hauteurs[x] = estFond ? 0 : hauteurs[x] + 1;
            }
            // Rectangles maximaux de l'histogramme de cette ligne.
            let sommet = 0;
            for (let x = 0; x <= w; x++) {
                const hauteurCourante = x < w ? hauteurs[x] : 0;
                while (sommet > 0 && hauteurs[pile[sommet - 1]] >= hauteurCourante) {
                    const hautRect = hauteurs[pile[--sommet]];
                    const gauche = sommet > 0 ? pile[sommet - 1] + 1 : 0;
                    const droite = x - 1;
                    if (hautRect <= 0) continue;
                    const bas = y, haut = y - hautRect + 1;
                    // Contrainte : le rectangle doit englober le centre de l'image (le sujet).
                    if (cx < gauche || cx > droite || cy < haut || cy > bas) continue;
                    const aire = (droite - gauche + 1) * hautRect;
                    if (aire > meilleureAire) {
                        meilleureAire = aire;
                        meilleur = { minX: gauche, minY: haut, maxX: droite, maxY: bas };
                    }
                }
                pile[sommet++] = x;
            }
        }
        return meilleur;
    }

    /**
     * Boîte des pixels qui ne sont pas du fond, dans un tableau RGBA.
     *
     * La couleur de fond est lue au coin haut-gauche : dans une vue 3D, ce coin est toujours du ciel.
     * Une marge de garde de 2 pixels est ajoutée pour ne pas raser le contour du sujet.
     *
     * Fonction PURE : couverte par tests/calepinage_maison/test_rognage_image.js.
     *
     * @param {Uint8ClampedArray|Array} px pixels RGBA, 4 octets par pixel
     * @param {number} w largeur en pixels
     * @param {number} h hauteur en pixels
     * @param {number} [tolerance=10] écart admis par canal pour considérer un pixel comme du fond
     * @returns {Object|null} { minX, minY, maxX, maxY }, ou null si tout est du fond
     */
    function calculerBoiteContenu(px, w, h, tolerance) {
        if (!px || !w || !h) return null;
        const fond = [px[0], px[1], px[2]];
        const tol = tolerance != null ? tolerance : 10;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                if (Math.abs(px[i] - fond[0]) <= tol
                    && Math.abs(px[i + 1] - fond[1]) <= tol
                    && Math.abs(px[i + 2] - fond[2]) <= tol) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < 0 || maxY < 0) return null;
        const garde = 2;
        return {
            minX: Math.max(0, minX - garde),
            minY: Math.max(0, minY - garde),
            maxX: Math.min(w - 1, maxX + garde),
            maxY: Math.min(h - 1, maxY + garde),
        };
    }

    /**
     * NOUVEAU (demande explicite : "rogner l'image vers l'extérieur aussi, pour supprimer tous les
     * espaces blancs et augmenter le zoom de la vue 3D").
     *
     * Retire les bandes de fond uni qui entourent le rendu. Même cadrée au plus juste, une vue 3D
     * garde du ciel : le sujet est une boîte en perspective, jamais un rectangle plein. Ce ciel est
     * de la couleur d'effacement de la scène, un gris très clair qui, une fois posé dans le PDF, se
     * confond avec la page et donne l'impression d'une image minuscule perdue dans du blanc.
     *
     * On repère la boîte des pixels qui s'écartent de la couleur des coins, et on recadre dessus.
     * L'image en ressort sans marge, donc occupe toute la place qu'on lui donne dans la page.
     *
     * @param {string} dataUrl image rendue
     * @param {number} [tolerance=10] écart admis par canal (0-255) pour considérer un pixel comme fond
     * @param {boolean} [rectanglePlein=true] false : rognage sur la seule boîte du contenu, sans
     *   jamais couper le sujet (le rectangle plein inscrit coupe les bords d'un grand champ vu en
     *   perspective — dossier de plans du petit champ solaire)
     * @returns {Promise<string>} image rognée, ou l'image d'origine si le rognage n'a rien à retirer
     */
    function rognerImageSurContenu(dataUrl, tolerance, rectanglePlein) {
        return new Promise((resolve) => {
            if (!dataUrl) { resolve(dataUrl); return; }
            const img = new Image();
            img.onerror = () => resolve(dataUrl);
            img.onload = () => {
                try {
                    const w = img.naturalWidth, h = img.naturalHeight;
                    if (!w || !h) { resolve(dataUrl); return; }
                    const c = document.createElement('canvas');
                    c.width = w; c.height = h;
                    const ctx = c.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0);
                    const px = ctx.getImageData(0, 0, w, h).data;

                    // Rectangle entièrement rempli d'abord (aucun vide dans l'image finale), repli
                    // sur la boîte englobante du contenu s'il est trop petit pour être exploitable.
                    // Seuil à 25 % : un sol vu en forte perspective donne un trapèze étroit, dont le
                    // plus grand rectangle inscrit ne fait qu'un tiers de la boîte englobante — il
                    // reste préférable à une image trouée. En dessous, l'image est trop morcelée pour
                    // qu'un rectangle inscrit ait du sens.
                    const boite = calculerBoiteContenu(px, w, h, tolerance);
                    if (!boite) { resolve(dataUrl); return; }              // image entièrement unie
                    const plein = rectanglePlein === false ? null : calculerRectanglePlein(px, w, h, tolerance);
                    if (plein) {
                        const airePlein = (plein.maxX - plein.minX + 1) * (plein.maxY - plein.minY + 1);
                        const aireBoite = (boite.maxX - boite.minX + 1) * (boite.maxY - boite.minY + 1);
                        if (airePlein >= aireBoite * 0.25) {
                            boite.minX = plein.minX; boite.minY = plein.minY;
                            boite.maxX = plein.maxX; boite.maxY = plein.maxY;
                        } else {
                            console.warn('[Calepinage maison 3D] Rectangle plein trop petit ('
                                + Math.round((airePlein / aireBoite) * 100) + '% du contenu) : rognage simple.');
                        }
                    }
                    const largeur = boite.maxX - boite.minX + 1;
                    const hauteur = boite.maxY - boite.minY + 1;
                    if (largeur >= w && hauteur >= h) { resolve(dataUrl); return; }  // rien à retirer

                    const sortie = document.createElement('canvas');
                    sortie.width = largeur; sortie.height = hauteur;
                    sortie.getContext('2d').drawImage(c, boite.minX, boite.minY, largeur, hauteur, 0, 0, largeur, hauteur);
                    console.log('[Calepinage maison 3D] Image rognée : ' + w + 'x' + h + ' -> '
                        + largeur + 'x' + hauteur);
                    resolve(sortie.toDataURL('image/png'));
                } catch (e) {
                    console.warn('[Calepinage maison 3D] Rognage impossible, image conservée telle quelle.', e);
                    resolve(dataUrl);
                }
            };
            img.src = dataUrl;
        });
    }

    // ==========================================================================================
    // Capture d'écran 3D choisie par l'utilisateur (bouton appareil photo de la barre 3D)
    // ==========================================================================================
    // NOUVEAU (demande explicite : "une icône caméra après la vue Iso pour prendre une capture et la
    // mettre dans le rapport ; elle remplace la vue Iso si elle est prise ; on conserve la capture Iso
    // automatique si l'utilisateur oublie ; insérer aussi la capture dans le plan de calepinage").
    //
    // Stockage : mémoire de session + localStorage dans une clé DÉDIÉE, par projet puis par champ PV.
    // Volontairement HORS de CM.state / calepinage_maison_v1 : une image pèse des centaines de Ko, et
    // un dépassement de quota ferait échouer la sauvegarde de TOUT l'état du calepinage (cf.
    // calepinage_persistence.js::writeStore). Ici, un échec d'écriture ne perd que la capture sur
    // disque (elle reste disponible pendant la session).
    const CAPTURE_STORE_KEY = 'calepinage_maison_captures3d_v1';
    const CAPTURE_LARGEUR = 1600, CAPTURE_HAUTEUR = 1100; // même format que la vue Iso automatique
    const capturesMemoire = new Map();                   // 'projet|sourceId' -> { dataUrl, takenAt }

    function projetCourantId() {
        try { return localStorage.getItem('current_projet_id') || 'sans_projet'; } catch (e) { return 'sans_projet'; }
    }
    function lireStoreCaptures() {
        try { return JSON.parse(localStorage.getItem(CAPTURE_STORE_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function getCapture3DUtilisateur(sourceId) {
        if (!sourceId) return null;
        const projet = projetCourantId();
        const cle = projet + '|' + sourceId;
        if (capturesMemoire.has(cle)) return capturesMemoire.get(cle);
        const entree = (lireStoreCaptures()[projet] || {})[sourceId];
        if (entree && typeof entree.dataUrl === 'string' && entree.dataUrl.indexOf('data:image/') === 0) {
            capturesMemoire.set(cle, entree);
            return entree;
        }
        return null;
    }
    /**
     * Implantation photographiée par une capture : chaque champ de la carte (contour au sol à ~0,1 m,
     * type de structure, modèle, azimut). Bug rapporté : « dans les dossiers de plans, la vue 3D place
     * mal les ombrières quand le projet en comporte plusieurs » — la capture de l'utilisateur, prioritaire
     * sur le rendu automatique, avait été prise avant un déplacement ou un ajout d'ombrière (ou sans
     * afficher tous les champs) et n'était jamais invalidée. null si l'implantation est illisible.
     */
    function signatureImplantation3D() {
        if (typeof CM.listerChampsCarte !== 'function' || typeof CM.localToLatLng !== 'function') return null;
        try {
            return CM.listerChampsCarte().map((c) => {
                const st = c.state;
                const contour = (st.roofLocal || []).map((pt) => {
                    const ll = CM.localToLatLng(c.origin, pt);
                    return ll.lat().toFixed(6) + ',' + ll.lng().toFixed(6);
                }).join(';');
                const pan = (st.pans || [])[0] || {};
                // Sans le nom du champ : une renumérotation (PV2 -> PV1) ne déplace rien.
                return [st.typeMontage, st.ombriereMetalModel, st.ombriereBoisModel, st.petitChampModel,
                    pan.azimuth, contour].join('|');
            }).sort().join('#');
        } catch (e) {
            return null;
        }
    }
    function nbChampsCarte() {
        try { return typeof CM.listerChampsCarte === 'function' ? CM.listerChampsCarte().length : 0; } catch (e) { return 0; }
    }

    /**
     * Capture de l'utilisateur encore fidèle au plan 2D (dossiers de plans), ou null : implantation
     * inchangée depuis la prise de vue, et tous les champs affichés à ce moment-là. Une capture
     * antérieure à ce contrôle (sans signature) n'est pas vérifiable : elle est écartée.
     */
    function getCapture3DUtilisateurAJour(sourceId) {
        const cap = getCapture3DUtilisateur(sourceId);
        if (!cap || !cap.implantation || !cap.tousLesChamps) return null;
        return cap.implantation === signatureImplantation3D() ? cap : null;
    }

    // Renvoie true si la capture a aussi pu être écrite sur disque (localStorage).
    function enregistrerCapture3DUtilisateur(sourceId, dataUrl) {
        if (!sourceId || !dataUrl) return false;
        const projet = projetCourantId();
        const entree = {
            dataUrl: dataUrl, takenAt: Date.now(),
            implantation: signatureImplantation3D(),
            tousLesChamps: !!CM.multiHouseViewActive || nbChampsCarte() < 2,
        };
        capturesMemoire.set(projet + '|' + sourceId, entree);
        try {
            // Seules les captures du projet courant sont conservées sur disque (taille maîtrisée).
            const store = lireStoreCaptures();
            const nouveau = {};
            nouveau[projet] = Object.assign({}, store[projet] || {});
            nouveau[projet][sourceId] = entree;
            localStorage.setItem(CAPTURE_STORE_KEY, JSON.stringify(nouveau));
            return true;
        } catch (e) {
            console.warn('[Calepinage maison 3D] Capture conservée pour la session seulement (quota localStorage ?).', e);
            return false;
        }
    }
    function supprimerCapture3DUtilisateur(sourceId) {
        if (!sourceId) return;
        const projet = projetCourantId();
        capturesMemoire.delete(projet + '|' + sourceId);
        try {
            const store = lireStoreCaptures();
            if (store[projet] && store[projet][sourceId]) {
                delete store[projet][sourceId];
                localStorage.setItem(CAPTURE_STORE_KEY, JSON.stringify(store));
            }
        } catch (e) { /* noop */ }
    }

    // Renumérotation des champs PV (orchestrateur::renumeroterChampsPV) : chaque capture suit son champ.
    function renommerCaptures3DUtilisateur(correspondance) {
        if (!correspondance || !Object.keys(correspondance).length) return;
        const projet = projetCourantId();
        const renommer = (id) => (Object.prototype.hasOwnProperty.call(correspondance, id) ? correspondance[id] : id);
        const memoire = Array.from(capturesMemoire.entries()).filter(([cle]) => cle.indexOf(projet + '|') === 0);
        memoire.forEach(([cle]) => capturesMemoire.delete(cle));
        memoire.forEach(([cle, val]) => capturesMemoire.set(projet + '|' + renommer(cle.slice(projet.length + 1)), val));
        try {
            const store = lireStoreCaptures();
            if (!store[projet]) return;
            const renomme = {};
            Object.keys(store[projet]).forEach((id) => { renomme[renommer(id)] = store[projet][id]; });
            store[projet] = renomme;
            localStorage.setItem(CAPTURE_STORE_KEY, JSON.stringify(store));
        } catch (e) { /* noop */ }
    }

    // Bouton appareil photo : vert quand une capture est enregistrée pour le champ PV affiché.
    function updateCaptureButtonUI() {
        const btn = controlsBar && controlsBar.querySelector('#cm3DCaptureBtn');
        if (!btn) return;
        const cap = CM.state && getCapture3DUtilisateur(CM.state.sourceId);
        // Orange : capture qui ne correspond plus à l'implantation (écartée des dossiers de plans).
        const perimee = !!cap && !getCapture3DUtilisateurAJour(CM.state.sourceId);
        btn.style.background = cap ? (perimee ? '#ffedd5' : '#dcfce7') : '#f5f5f5';
        btn.style.borderColor = cap ? (perimee ? '#ea580c' : '#16a34a') : '';
        btn.title = cap
            ? 'Capture enregistrée le ' + new Date(cap.takenAt).toLocaleString('fr-FR')
              + (perimee
                  ? " — elle ne correspond plus à l'implantation des champs PV (ou ne les montrait pas tous) : les dossiers de plans utilisent le rendu automatique"
                  : ' (utilisée à la place de la vue Iso)')
              + ' — clic : reprendre la capture, clic droit : la supprimer'
            : 'Capturer la vue 3D pour le rapport (remplace la vue Iso automatique) — clic droit : supprimer la capture';
    }

    /**
     * Met une capture au format du rapport : retire les bandes de fond uni autour du rendu (même
     * détection que la vue Iso automatique, sans le rognage "rectangle plein" qui couperait le cadrage
     * choisi par l'utilisateur), puis ramène l'image EXACTEMENT au format 1600 x 1100 :
     *  - ratio proche (± 25 %) : recadrage centré (rogner) ;
     *  - ratio très différent : image entière réduite et centrée sur fond blanc (rien n'est coupé).
     * Sortie JPEG (poids ~5 à 10 fois inférieur au PNG, indispensable pour le stockage local).
     *
     * @param {string} dataUrl rendu brut
     * @returns {Promise<string>} data URL JPEG 1600 x 1100 (ou l'image d'origine en cas d'échec)
     */
    function preparerImageRapport(dataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onerror = () => resolve(dataUrl);
            img.onload = () => {
                try {
                    const w = img.naturalWidth, h = img.naturalHeight;
                    if (!w || !h) { resolve(dataUrl); return; }
                    const src = document.createElement('canvas');
                    src.width = w; src.height = h;
                    const sctx = src.getContext('2d', { willReadFrequently: true });
                    sctx.drawImage(img, 0, 0);
                    const boite = calculerBoiteContenu(sctx.getImageData(0, 0, w, h).data, w, h, 10)
                        || { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 };
                    const cadre = calculerCadreRapport(
                        boite.maxX - boite.minX + 1, boite.maxY - boite.minY + 1, CAPTURE_LARGEUR, CAPTURE_HAUTEUR,
                    );
                    const out = document.createElement('canvas');
                    out.width = CAPTURE_LARGEUR; out.height = CAPTURE_HAUTEUR;
                    const octx = out.getContext('2d');
                    octx.fillStyle = '#ffffff';
                    octx.fillRect(0, 0, CAPTURE_LARGEUR, CAPTURE_HAUTEUR);
                    octx.imageSmoothingQuality = 'high';
                    octx.drawImage(src,
                        boite.minX + cadre.sx, boite.minY + cadre.sy, cadre.sw, cadre.sh,
                        cadre.dx, cadre.dy, cadre.dw, cadre.dh);
                    resolve(out.toDataURL('image/jpeg', 0.9));
                } catch (e) {
                    console.warn('[Calepinage maison 3D] Mise au format de la capture impossible.', e);
                    resolve(dataUrl);
                }
            };
            img.src = dataUrl;
        });
    }

    /**
     * Géométrie pure du recadrage d'une image (w x h) vers un format cible (W x H) — cf.
     * preparerImageRapport. Couverte par tests/calepinage_maison/test_capture_3d_utilisateur.js.
     * @returns {{sx,sy,sw,sh,dx,dy,dw,dh,mode:'rogner'|'reduire'}} source (dans l'image) -> destination
     */
    function calculerCadreRapport(w, h, W, H) {
        const rSrc = w / h, rDst = W / H;
        if (Math.abs(rSrc / rDst - 1) <= 0.25) {
            // Rogner : on garde la plus grande zone centrée au ratio cible.
            let sw = w, sh = h;
            if (rSrc > rDst) sw = h * rDst; else sh = w / rDst;
            return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh, dx: 0, dy: 0, dw: W, dh: H, mode: 'rogner' };
        }
        // Réduire : l'image entière tient dans le cadre, centrée.
        const s = Math.min(W / w, H / h);
        const dw = w * s, dh = h * s;
        return { sx: 0, sy: 0, sw: w, sh: h, dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh, mode: 'reduire' };
    }

    /**
     * Vue aérienne sous les panneaux (demande explicite : « il manque la vue aérienne en dessous des
     * panneaux » sur la vue 3D du dossier de plans). Le sol de la scène est texturé avec la capture
     * de carte du champ (buildGroundImage), qui n'est jamais sauvegardée : après un rechargement, ou
     * si le fond a été masqué dans le plan 2D, la 3D sortait sur un sol blanc. On reprend ici la
     * capture à la demande (CM.ensureMapBackground) et on force son affichage le temps de la capture.
     * @returns {Promise<{ajoute:boolean, restaurer:Function}>} ajoute : le sol vient d'être rendu
     *   disponible (la scène affichée doit être reconstruite pour le montrer)
     */
    // tousLesChamps : vue d'ensemble (dossier des ombrières) — le fond est RECAPTURÉ en couvrant tous
    // les champs de la carte (CM.multiHouseViewActive doit être posé par l'appelant), puis le fond
    // serré du champ est rétabli par restaurer() : le plan 2D n'en garde aucune trace.
    async function preparerSolAerien(sourceId, tousLesChamps) {
        const state = typeof CM.getHouseStateById === 'function' ? CM.getHouseStateById(sourceId) : null;
        if (!state) return { ajoute: false, restaurer: () => {} };
        // Lu AVANT la reprise du fond : ensureMapBackground() coche lui-même l'affichage du fond, qui
        // restait sinon actif dans la fenêtre 3D après la capture.
        const affichageAvant = state.showBackgroundImage;
        const avaitFond = !!(state.mapScreenshotImgObj && affichageAvant);
        const fondAvant = { img: state.mapScreenshotImgObj, ref: state.mapScreenshotRef };
        let fondRemplace = false;
        if (tousLesChamps && typeof CM.ensureMapBackground === 'function') {
            const ok = await avecDelaiMax(
                CM.ensureMapBackground(sourceId, { cadrageSerre: true, forcer: true }), 45000, false, 'fond de carte de tous les champs',
            );
            fondRemplace = !!ok && state.mapScreenshotImgObj !== fondAvant.img;
        } else if (!state.mapScreenshotImgObj && typeof CM.ensureMapBackground === 'function') {
            // Carte recadrée sur le champ : fond serré, jamais une vue dézoomée de plusieurs km.
            // Délai porté à 45 s : attente des tuiles allongée + nouveaux essais si la carte est vide.
            await avecDelaiMax(CM.ensureMapBackground(sourceId, { cadrageSerre: true }), 45000, false, 'fond de carte de la vue 3D');
        }
        const restaurer = () => {
            if (fondRemplace) {
                state.mapScreenshotToken = (state.mapScreenshotToken || 0) + 1;
                state.mapScreenshotImgObj = fondAvant.img;
                state.mapScreenshotRef = fondAvant.ref;
            }
            state.showBackgroundImage = affichageAvant;
            if (CM.state === state && typeof CM.updateVisibilityToggleButtonsUI === 'function') {
                try { CM.updateVisibilityToggleButtonsUI(); } catch (e) { /* noop */ }
            }
        };
        const utilisable = fondAerienProportionne(state, tousLesChamps);
        state.showBackgroundImage = utilisable ? true : affichageAvant;
        return { ajoute: (!avaitFond || fondRemplace) && utilisable, restaurer };
    }

    /**
     * Fond de carte d'une taille raisonnable par rapport au champ : un fond pris sur une carte très
     * dézoomée agrandit le sol 3D (et le recul de la caméra) jusqu'à rendre le champ invisible.
     */
    function fondAerienProportionne(state, tousLesChamps) {
        const img = state.mapScreenshotImgObj;
        const ref = state.mapScreenshotRef;
        if (!img || !ref || !ref.p1 || !ref.p2 || !ref.m1 || !ref.m2) return false;
        const px = Math.hypot(ref.p2.x - ref.p1.x, ref.p2.y - ref.p1.y);
        const m = Math.hypot(ref.m2.x - ref.m1.x, ref.m2.y - ref.m1.y);
        if (!(px > 0) || !(m > 0)) return false;
        const etendueFondM = Math.max(img.naturalWidth || img.width || 0, img.naturalHeight || img.height || 0) * (m / px);
        let pts = state.roofLocal || [];
        if (!pts.length) return false;
        if (tousLesChamps && CM.state === state && typeof CM.getOtherHouseContoursReprojected === 'function') {
            try { CM.getOtherHouseContoursReprojected().forEach((c) => { pts = pts.concat(c.roofLocal); }); } catch (e) { /* champ seul */ }
        }
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const etendueChampM = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
        return etendueFondM <= etendueChampM * 6 + 50;
    }

    let captureEnCours = false;
    async function captureEcranUtilisateur3D() {
        if (captureEnCours) return;
        if (!active || !engine || !scene || !camera || !canvas3D) {
            setStatus('La vue 3D doit être affichée pour prendre une capture.');
            return;
        }
        const sourceId = CM.state && CM.state.sourceId;
        if (!sourceId) { setStatus('Aucun champ PV actif : capture impossible.'); return; }

        captureEnCours = true;
        const btn = controlsBar && controlsBar.querySelector('#cm3DCaptureBtn');
        if (btn) btn.disabled = true;
        setStatus('Capture en cours…');
        // La surbrillance de sélection et le gizmo ne doivent pas apparaître dans le rapport.
        const selectionPrecedente = selectedObj3DId;
        if (selectionPrecedente) setSelectedObject3D(null);
        let sol = null;
        try {
            // Le rapport doit montrer la vue aérienne sous les panneaux : fond repris si besoin et
            // scène reconstruite pour l'afficher (la caméra, elle, n'est pas touchée).
            sol = await preparerSolAerien(sourceId);
            if (sol.ajoute && !scene.getMeshByName('groundImage')) buildScene();
            await avecDelaiMax(scene.whenReadyAsync(), 8000, null, 'préparation de la scène 3D');
            // Même ratio que le canevas affiché : l'image reproduit exactement le cadrage à l'écran.
            const cw = canvas3D.width || CAPTURE_LARGEUR, ch = canvas3D.height || CAPTURE_HAUTEUR;
            const largeur = CAPTURE_LARGEUR;
            const hauteur = Math.max(200, Math.round(largeur * ch / cw));
            const brute = await avecDelaiMax(
                BABYLON.Tools.CreateScreenshotUsingRenderTargetAsync(
                    engine, camera, { width: largeur, height: hauteur }, 'image/png', 1, true,
                ),
                15000, null, 'capture utilisateur de la vue 3D',
            );
            if (!brute) { setStatus('Capture impossible (voir console).'); return; }
            const finale = await avecDelaiMax(preparerImageRapport(brute), 8000, null, 'mise au format de la capture');
            if (!finale) { setStatus('Capture impossible (voir console).'); return; }
            const surDisque = enregistrerCapture3DUtilisateur(sourceId, finale);
            setStatus(surDisque
                ? '📷 Capture enregistrée : elle remplace la vue Iso dans le rapport et le plan de calepinage.'
                : '📷 Capture enregistrée pour cette session (stockage local plein).');
            if (canvas3D) {
                canvas3D.style.transition = 'opacity 0.12s';
                canvas3D.style.opacity = '0.4';
                setTimeout(() => { if (canvas3D) canvas3D.style.opacity = '1'; }, 130);
            }
        } catch (e) {
            console.warn('[Calepinage maison 3D] Capture utilisateur impossible.', e);
            setStatus('Capture impossible (voir console).');
        } finally {
            // Drapeau d'affichage rendu tel quel ; la scène garde son sol jusqu'au prochain rendu.
            if (sol) sol.restaurer();
            if (selectionPrecedente && objRootById[selectionPrecedente]) setSelectedObject3D(selectionPrecedente);
            if (btn) btn.disabled = false;
            captureEnCours = false;
            updateCaptureButtonUI();
        }
    }

    /**
     * NOUVEAU (rapport PDF résidentiel, demande explicite : "remplacer les captures d'écran par une
     * vue 3D ISO du projet" et "la vue 3D prise sous un autre angle").
     *
     * Rend la maison `sourceId` en 3D HORS ÉCRAN et renvoie l'image, sans jamais ouvrir le modal ni
     * perturber ce qui est affiché. Même contrat que captureRoofDiagramImage() (calepinage_maison_
     * dessin.js) pour le diagramme 2D : bascule temporaire de CM.state, restaurée dans le `finally`.
     *
     * La capture passe par une cible de rendu dédiée plutôt que par le canvas : le moteur est créé
     * sans `preserveDrawingBuffer` (choix d'origine, pour la mémoire), donc lire le canvas
     * directement renverrait une image vide. La cible de rendu impose en prime sa propre résolution,
     * indépendante de la taille du canvas à l'écran — qui vaut zéro quand le modal est masqué.
     *
     * @param {string} sourceId maison à rendre (ex. "PV1")
     * @param {{mode?: 'iso'|'iso-oppose'|'plan'|'x'|'y', width?: number, height?: number,
     *   entier?: boolean}} [options] entier : tout le sujet garanti visible (cadrage avec une marge
     *   plus large, rognage qui ne coupe jamais le contenu) — dossier de plans du petit champ solaire ;
     *   sansSol : aucune reprise du fond de carte (repli)
     * @returns {Promise<string|null>} image PNG en data URL, ou null si la 3D est indisponible
     */
    /**
     * @param {Object} [options] {mode, width, height, entier, sansSol, ignorerCaptureUtilisateur,
     *   tousLesChamps} — tousLesChamps : vue d'ensemble du projet (tous les champs PV de la carte,
     *   comme la vue combinée), pour la page « Visualisation 3D du projet » du dossier des ombrières.
     */
    async function captureVue3DImage(sourceId, options) {
        const opts = options || {};
        const largeur = opts.width || 1600;
        const hauteur = opts.height || 1100;

        // Capture prise par l'utilisateur (bouton appareil photo) : elle REMPLACE la vue Iso
        // automatique partout où celle-ci est demandée (rapport + PDF du plan de calepinage). Sans
        // capture, le rendu Iso automatique ci-dessous reste le repli. Les autres angles
        // ('iso-oppose', 'plan', 'x', 'y') ne sont pas concernés.
        if ((opts.mode || 'iso') === 'iso' && !opts.ignorerCaptureUtilisateur && !opts.tousLesChamps) {
            const capture = getCapture3DUtilisateur(sourceId);
            if (capture && capture.dataUrl) return capture.dataUrl;
        }

        if (typeof CM.getHouseStateById !== 'function') return null;
        const state = CM.getHouseStateById(sourceId);
        if (!state) return null;

        // Le canvas 3D vit dans le modal : il faut donc que celui-ci existe (il reste masqué).
        if (!CM.modal && typeof CM.createModal === 'function') CM.createModal();
        ensureDom();
        if (!canvas3D) return null;

        const babylonPret = await avecDelaiMax(
            loadBabylon().then(() => true), 32000, false, 'chargement du moteur 3D',
        );
        if (!babylonPret || !window.BABYLON) return null;

        // Le canvas d'un modal masqué a une taille nulle : le contexte WebGL refuserait de démarrer.
        // On lui impose la résolution de capture le temps du rendu (l'ouverture réelle de la vue 3D
        // rappelle sizeCanvasToPlan(), qui reprendra la main sur ces dimensions).
        const tailleCanvasSauvee = { w: canvas3D.width, h: canvas3D.height };
        if (!canvas3D.width || !canvas3D.height) {
            canvas3D.width = largeur;
            canvas3D.height = hauteur;
        }

        // Vue aérienne sous les panneaux (cf. preparerSolAerien), avant de reconstruire la scène.
        // opts.sansSol : repli du dossier de plans si la capture avec le fond a échoué.
        const etatPrecedent = CM.state;
        const etaitActive = active;
        const vueMultiAvant = CM.multiHouseViewActive;
        let fondSansSol = null;
        let cameraSauvee = null;
        let sol = { ajoute: false, restaurer: () => {} };
        try {
            // Vue multi posée AVANT la reprise du fond : captureMapView() cadre alors la carte sur
            // tous les champs (sommetsACapturer).
            if (opts.tousLesChamps) CM.multiHouseViewActive = true;
            if (!opts.sansSol) {
                CM.state = state;
                sol = await preparerSolAerien(sourceId, !!opts.tousLesChamps);
            }
            CM.state = state;
            // Vue d'ensemble sans sol : la capture de carte d'UN champ ne couvrirait qu'une partie de
            // la scène (patch aérien sous un seul champ) — fond masqué le temps de la capture.
            if (opts.sansSol) { fondSansSol = state.showBackgroundImage; state.showBackgroundImage = false; }
            if (!engine) startEngine(); else buildScene();
            if (!camera || !scene) return null;
            // Relief en cours de chargement : la scène est reconstruite à son arrivée (cf. attendreTerrain).
            await attendreTerrain(15000);

            cameraSauvee = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone() };

            // Le cadrage serré est appliqué APRÈS setCameraView() ci-dessous, qui pose l'angle de
            // vue mais aussi un rayon très large.
            if (opts.mode === 'iso-oppose') {
                // Même hauteur de regard que l'isométrique, mais depuis l'autre côté du bâtiment :
                // les faces cachées par la première vue deviennent visibles (demande explicite,
                // "la vue 3D prise sous un autre angle").
                setCameraView('iso');
                camera.alpha += Math.PI;
            } else {
                setCameraView(opts.mode || 'iso');
            }
            // Dossiers de plans (entier / tousLesChamps) : zoom quasi maximal sur les structures
            // (demande explicite). Le cadrage coin par coin garantit que rien n'est coupé.
            cadrerCameraSurBati((opts.entier || opts.tousLesChamps) ? 1.03 : 1.04, largeur / hauteur);

            // La capture par cible de rendu a besoin que la scène soit effectivement dessinée. Or la
            // boucle de rendu est à l'arrêt tant que la vue 3D n'a pas été ouverte : sans elle, la
            // promesse de capture ne se résolvait jamais (cause du rapport qui tournait sans fin).
            // On fait donc tourner la boucle le temps de la capture, et on borne l'attente.
            startRenderLoop();
            // CORRECTIF (bug rapporté : "j'ai dû cliquer 2 fois pour avoir la capture d'écran dans les
            // plans") : le sol de la scène 3D est un quad texturé avec la capture de carte, et une
            // texture Babylon se charge de façon asynchrone. Capturer sans attendre donnait une vue
            // dont le sol n'était pas encore peint. whenReadyAsync() attend que meshes et textures
            // soient prêts ; l'attente est bornée pour ne jamais retenir un export.
            await avecDelaiMax(scene.whenReadyAsync(), 12000, null, 'préparation de la scène 3D');
            // Quelques images de plus : textures (vue aérienne au sol) effectivement envoyées au GPU
            // avant la photo, même quand whenReadyAsync() rend la main très tôt.
            await new Promise((resolve) => setTimeout(resolve, 400));
            scene.render();
            const brute = await avecDelaiMax(
                BABYLON.Tools.CreateScreenshotUsingRenderTargetAsync(
                    engine, camera, { width: largeur, height: hauteur }, 'image/png', 1, true,
                ),
                20000, null, 'capture de la vue 3D',
            );
            if (!brute) return null;
            // Rognage sur le contenu : supprime le ciel qui entoure le sujet (demande explicite).
            return await avecDelaiMax(rognerImageSurContenu(brute, 10, !opts.entier), 8000, brute, 'rognage de la vue 3D');
        } catch (e) {
            console.warn('[Calepinage maison 3D] Capture hors écran impossible.', e);
            return null;
        } finally {
            sol.restaurer();
            CM.state = etatPrecedent;
            CM.multiHouseViewActive = vueMultiAvant;
            if (fondSansSol !== null) state.showBackgroundImage = fondSansSol;
            if (cameraSauvee && camera) {
                camera.alpha = cameraSauvee.alpha;
                camera.beta = cameraSauvee.beta;
                camera.radius = cameraSauvee.radius;
                camera.setTarget(cameraSauvee.target);
            }
            if (!etaitActive) {
                // Vue 3D fermée : on ne laisse pas tourner la boucle de rendu pour une scène invisible.
                try { stopRenderLoop(); } catch (e2) { /* noop */ }
                canvas3D.width = tailleCanvasSauvee.w;
                canvas3D.height = tailleCanvasSauvee.h;
            } else {
                // Vue 3D affichée : la scène vient d'être reconstruite pour une autre maison, on la
                // remet sur celle réellement ouverte — sans recadrer : la caméra de l'utilisateur
                // vient d'être restaurée juste au-dessus.
                cameraACadrer = false;
                sourceCadree = (CM.state && CM.state.sourceId) || null;
                try { buildScene(); } catch (e2) { /* noop */ }
            }
        }
    }

    Object.assign(CM, {
        open3DView, close3DView, toggle3DView, refresh3DView, captureVue3DImage,
        is3DViewActive, supprimerSelection3D, setSelectedObject3D,
        getCapture3DUtilisateur, getCapture3DUtilisateurAJour, supprimerCapture3DUtilisateur, renommerCaptures3DUtilisateur,
        // Exportées pour les tests : géométrie pure du cadrage et détection du contenu utile d'une
        // image, cf. tests/calepinage_maison/.
        calculerCadrageCamera, calculerBoiteContenu, calculerRectanglePlein, calculerCadreRapport,
    });
})();
