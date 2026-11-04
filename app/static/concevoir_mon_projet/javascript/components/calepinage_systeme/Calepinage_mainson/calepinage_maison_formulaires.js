/**
 * Calepinage résidentiel — Formulaires : construction DOM du modal principal (+ sous-modaux Plan de
 * coupe / Détails structure) et câblage des champs, synchronisation UI <-> état.
 *
 * 3e fichier de la scission de calepinage_maison_indiv.js — cf. calepinage_maison_calculs.js pour
 * le contexte général du namespace partagé window.CalepinageMaisonIndiv (CM).
 *
 * Possède toutes les références DOM partagées (CM.modal, CM.canvas, CM.modalBody, etc.) : peuplées
 * une seule fois ici (createModal/createCoupeModal/createStructureDetailsModal), lues depuis
 * dessin.js et orchestrateur.js.
 */
(function () {
    window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};
    const CM = window.CalepinageMaisonIndiv;

    // Références DOM (peuplées par createModal()/createCoupeModal()/createStructureDetailsModal()).
    CM.modal = null;
    CM.backdrop = null;
    CM.modalBody = null;
    CM.canvas = null;
    CM.previewImg = null;
    CM.azimuthListEl = null;
    CM.resultsEl = null;
    CM.ridgeBtn = null;
    CM.drawRectBtn = null;
    CM.drawPolygonBtn = null;
    CM.sourceSelectEl = null;
    CM.viewToggleBtn = null;
    CM.panToolBtn = null;
    CM.contourDimsWrapper = null;
    CM.contourLengthInput = null;
    CM.contourWidthInput = null;
    CM.polygonAzimuthWrapper = null;
    CM.polygonAzimuthInput = null;
    CM.coupeModal = null;
    CM.coupeCanvas = null;
    CM.coupePanSelect = null;
    CM.structureModal = null;
    CM.structureTableBody = null;

    // --------------------------------------------------------------------------------------
    // UI (modal)
    // --------------------------------------------------------------------------------------
    function updateRidgeButtonUI() {
        CM.ridgeBtn.style.background = CM.state.tracingRidge ? '#dc2626' : '#f5f5f5';
        CM.ridgeBtn.style.color = CM.state.tracingRidge ? '#fff' : '#333';
        CM.ridgeBtn.textContent = CM.state.tracingRidge ? 'Cliquez 2 points sur le contour…' : 'Tracer le faîtage';
    }

    // Toggle des 2 boutons de tracé de contour (rectangle/polygone) — pur style, aucun
    // canvas/2D-context : déplacé ici (fichier formulaires) depuis "dessin" pour rester cohérent
    // avec les autres update*UI, cf. plan de scission.
    // REFONTE (demande explicite : "boutons icônes SVG") : ces 2 boutons sont désormais icône-seule
    // au repos — mais drawRectBtn/drawPolygonBtn affichaient jusqu'ici une INSTRUCTION texte
    // (pas juste un libellé d'état) pendant le tracé ("Cliquez le 1er coin…", "Cliquez pour ajouter
    // un sommet (N)…") : perdre ce texte serait une régression fonctionnelle, pas seulement
    // esthétique. Compromis conservé : icône (rectangle.svg/polygon.svg) au repos, remplacée par le
    // texte d'instruction PENDANT le tracé actif (l'utilisateur a alors besoin de le lire, pas
    // seulement d'un tooltip au survol) — via innerHTML, pas textContent, pour rester cohérent avec
    // le rendu icône généré par cmToolbarButtonHTML().
    function updateContourDrawButtonsUI() {
        // Filet de sécurité (bug rapporté : "dessiner un rectangle / polygone libre ne fonctionne
        // plus, rien ne s'affiche quand je clique dessus") : cette fonction lit la LONGUEUR des
        // tableaux de tracé en cours. Sur un état qui en serait dépourvu, elle levait sur un
        // `.length` d'`undefined` — et comme elle est appelée AVANT toute mise à jour visuelle, son
        // exception avortait le gestionnaire de clic entier : les deux boutons paraissaient morts,
        // sans le moindre message. Normalisé sur place plutôt que délégué à CM.normalizeDrawingState()
        // pour ne dépendre d'aucun ordre de chargement entre les fichiers du module.
        const rectPoints = Array.isArray(CM.state.contourRectPoints)
            ? CM.state.contourRectPoints : (CM.state.contourRectPoints = []);
        const polygonPoints = Array.isArray(CM.state.contourPolygonPoints)
            ? CM.state.contourPolygonPoints : (CM.state.contourPolygonPoints = []);

        if (CM.drawRectBtn) {
            const active = CM.state.tracingContourRect;
            CM.drawRectBtn.style.background = active ? '#dc2626' : '#f5f5f5';
            CM.drawRectBtn.style.color = active ? '#fff' : '#333';
            // 3 clics (cf. rectFromThreePointsLocal) : origine, direction/longueur, profondeur.
            const etape = rectPoints.length;
            const stepLabel = active
                ? (etape === 0 ? 'Cliquez le 1er coin…' : etape === 1 ? 'Cliquez la direction…' : 'Cliquez la profondeur…')
                : '';
            CM.drawRectBtn.title = stepLabel || 'Dessiner un rectangle (contour)';
            CM.drawRectBtn.innerHTML = stepLabel
                ? `<span style="font-size:0.68rem; white-space:nowrap; padding:0 2px;">${stepLabel}</span>`
                : '<img src="/static/concevoir_mon_projet/medias/icons/rectangle.svg" alt="" style="width:18px; height:18px; vertical-align:middle;">';
        }
        if (CM.drawPolygonBtn) {
            const active = CM.state.drawingContourPolygon;
            CM.drawPolygonBtn.style.background = active ? '#dc2626' : '#f5f5f5';
            CM.drawPolygonBtn.style.color = active ? '#fff' : '#333';
            // Le bouton "Terminer le contour" a été retiré (demande explicite) : l'instruction doit
            // donc dire elle-même comment refermer, dès que c'est possible (3 sommets minimum).
            const nbSommets = polygonPoints.length;
            const stepLabel = active
                ? (nbSommets >= 3
                    ? `Cliquez le 1er sommet pour fermer (${nbSommets})…`
                    : `Cliquez pour ajouter un sommet (${nbSommets})…`)
                : '';
            CM.drawPolygonBtn.title = stepLabel || 'Dessiner un polygone libre (contour)';
            CM.drawPolygonBtn.innerHTML = stepLabel
                ? `<span style="font-size:0.68rem; white-space:nowrap; padding:0 2px;">${stepLabel}</span>`
                : '<img src="/static/concevoir_mon_projet/medias/icons/polygon.svg" alt="" style="width:18px; height:18px; vertical-align:middle;">';
        }
    }

    // NOUVEAU (demande explicite : bouton ligne déplacé dans ce modal) : même principe que
    // updateContourDrawButtonsUI ci-dessus pour drawRectBtn/drawPolygonBtn — icône au repos, texte
    // d'instruction pendant le tracé actif.
    function updateFreeLineButtonUI() {
        if (!CM.drawLineBtn) return;
        const active = CM.state.tracingFreeLine;
        CM.drawLineBtn.style.background = active ? '#dc2626' : '#f5f5f5';
        CM.drawLineBtn.style.color = active ? '#fff' : '#333';
        const stepLabel = active ? (CM.state.freeLineTemp ? 'Cliquez le 2e point…' : 'Cliquez le 1er point…') : '';
        CM.drawLineBtn.title = stepLabel || 'Dessiner une ligne (trait libre) — clic droit sur une ligne pour la supprimer';
        CM.drawLineBtn.innerHTML = stepLabel
            ? `<span style="font-size:0.68rem; white-space:nowrap; padding:0 2px;">${stepLabel}</span>`
            : '<img src="/static/concevoir_mon_projet/medias/icons/line.svg" alt="" style="width:18px; height:18px; vertical-align:middle;">';
    }

    // REFONTE : plus de swap de texte ("Vue en plan"/"Vue Nord-Sud") — icône fixe
    // (north-arrow-n-svgrepo-com.svg), l'état actif se lit désormais via la couleur de fond + le
    // tooltip (comme demandé : "tous les boutons disposent d'un tooltip accessible au survol").
    function updateViewToggleUI() {
        if (!CM.viewToggleBtn) return;
        const aligned = CM.state.viewMode === 'aligned';
        CM.viewToggleBtn.style.background = aligned ? '#dc2626' : '#f5f5f5';
        CM.viewToggleBtn.style.color = aligned ? '#fff' : '#333';
        CM.viewToggleBtn.title = aligned ? 'Vue en plan (cliquer pour revenir à la vue Nord-Sud)' : 'Vue Nord-Sud';
    }

    // NOUVEAU (demande explicite) : sélecteur "Vue 2D/3D" — bascule le canevas 2D vers la
    // visionneuse 3D Babylon (calepinage_maison_3d_viewer.js). Icône fixe (3D.svg), état porté par la
    // couleur de fond + le tooltip.
    function updateView2D3DUI() {
        const btn = CM.modalBody ? CM.modalBody.querySelector('#cmView2D3DBtn') : null;
        if (!btn) return;
        const is3D = !!CM.state.view3DMode;
        btn.style.background = is3D ? '#dc2626' : '#f5f5f5';
        btn.style.color = is3D ? '#fff' : '#333';
        btn.title = is3D
            ? 'Vue 3D active — cliquer pour revenir au plan 2D'
            : 'Basculer en vue 3D (bâtiment + panneaux)';
    }

    // NOUVEAU (demande explicite) : bouton bascule du mode d'affichage combiné (toutes les maisons).
    function updateMultiHouseViewUI() {
        const btn = CM.modalBody ? CM.modalBody.querySelector('#cmMultiHouseViewBtn') : null;
        if (!btn) return;
        btn.style.background = CM.multiHouseViewActive ? '#dc2626' : '#f5f5f5';
        btn.style.color = CM.multiHouseViewActive ? '#fff' : '#333';
    }

    function updatePanToolUI() {
        if (!CM.panToolBtn) return;
        CM.panToolBtn.style.background = CM.state.panToolActive ? '#dc2626' : '#f5f5f5';
        CM.panToolBtn.style.color = CM.state.panToolActive ? '#fff' : '#333';
        updateCanvasCursor();
    }

    function updateCanvasCursor() {
        if (!CM.canvas) return;
        if (CM.state.panToolActive) CM.canvas.style.cursor = 'grab';
        else if (CM.state.panelToolMode === 'move') CM.canvas.style.cursor = 'move';
        else if (CM.state.panelToolMode === 'delete') CM.canvas.style.cursor = 'crosshair';
        // 2026-10-09 : suppression par rectangle / déplacement du champ PV entier.
        else if (CM.state.panelToolMode === 'deleteRect') CM.canvas.style.cursor = 'crosshair';
        else if (CM.state.panelToolMode === 'moveField') CM.canvas.style.cursor = 'grab';
        else CM.canvas.style.cursor = 'default';
    }

    function updatePanelToolButtonsUI() {
        const moveBtn = CM.modalBody.querySelector('#cmMovePanelsBtn');
        const deleteBtn = CM.modalBody.querySelector('#cmDeletePanelsBtn');
        if (moveBtn) {
            moveBtn.style.background = CM.state.panelToolMode === 'move' ? '#dc2626' : '#f5f5f5';
            moveBtn.style.color = CM.state.panelToolMode === 'move' ? '#fff' : '#333';
        }
        if (deleteBtn) {
            deleteBtn.style.background = CM.state.panelToolMode === 'delete' ? '#dc2626' : '#f5f5f5';
            deleteBtn.style.color = CM.state.panelToolMode === 'delete' ? '#fff' : '#333';
        }
        // 2026-10-09 : mêmes couleurs d'état pour les deux nouveaux outils.
        [['#cmDeletePanelsRectBtn', 'deleteRect'], ['#cmMoveFieldBtn', 'moveField']].forEach(([sel, mode]) => {
            const btn = CM.modalBody.querySelector(sel);
            if (!btn) return;
            btn.style.background = CM.state.panelToolMode === mode ? '#dc2626' : '#f5f5f5';
            btn.style.color = CM.state.panelToolMode === mode ? '#fff' : '#333';
        });
        updateCanvasCursor();
    }

    function updateObstaclePropertiesPanel() {
        const section = CM.modalBody.querySelector('#cmObstaclePropsSection');
        if (!section) return;
        const o = CM.state.obstacles.find((ob) => ob.id === CM.state.selectedObstacleId);
        if (!o) {
            section.style.display = 'none';
            return;
        }
        section.style.display = 'block';
        const labelEl = CM.modalBody.querySelector('#cmObstaclePropsLabel');
        if (labelEl) labelEl.textContent = (CM.OBSTACLE_TYPES[o.type] || CM.OBSTACLE_TYPES.forme).label;

        const wEl = CM.modalBody.querySelector('#cmObstacleWidthInput');
        const hEl = CM.modalBody.querySelector('#cmObstacleHeightInput');
        const bEl = CM.modalBody.querySelector('#cmObstacleBufferInput');
        if (wEl && document.activeElement !== wEl) wEl.value = Math.round(o.w * 100);
        if (hEl && document.activeElement !== hEl) hEl.value = Math.round(o.h * 100);
        if (bEl && document.activeElement !== bEl) bEl.value = Math.round(o.buffer * 100);

        // NOUVEAU (demande explicite) : hauteur 3D — bornes min/max PROPRES au type d'obstacle
        // sélectionné (posées sur l'input à chaque sélection, pas figées dans le HTML).
        const def = CM.OBSTACLE_TYPES[o.type] || CM.OBSTACLE_TYPES.forme;
        const minEl = def.minElevationM != null ? def.minElevationM : 0.05;
        const maxEl = def.maxElevationM != null ? def.maxElevationM : 5;
        const elEl = CM.modalBody.querySelector('#cmObstacleElevationInput');
        if (elEl) {
            elEl.min = minEl; elEl.max = maxEl;
            if (document.activeElement !== elEl) {
                const current = o.elevationM != null ? o.elevationM : (def.defaultElevationM != null ? def.defaultElevationM : 0.3);
                elEl.value = current;
            }
        }
        const elHint = CM.modalBody.querySelector('#cmObstacleElevationHint');
        if (elHint) elHint.textContent = `Plage ${def.label} : ${minEl}–${maxEl} m`;
    }

    /**
     * Section "Pompage solaire" affichée ? (demande explicite) Masquée par défaut ; affichée si
     * l'option « Pompage solaire » a été choisie dans « Paramètres du projet », et toujours pour un
     * projet Site autonome — cf. window.isPompageSolaireProject (parametre.html), alimentée par le
     * projet actif vérifié en base.
     */
    function pompageSolaireVisible() {
        if (siteAutonomePompage()) return false;
        return typeof window.isPompageSolaireProject === 'function' && !!window.isPompageSolaireProject();
    }

    /**
     * Projet Site autonome dont le mode de valorisation est « Pompage solaire » (demande explicite) :
     * les sections « Borne de recharge » et « Pompage solaire », la puissance et la garantie de
     * l'onduleur et l'affectation centrale ne sont pas affichées (masquées seulement : valeurs
     * conservées dans l'état et toujours enregistrées). Type de
     * connexion lu sur le projet actif vérifié en base (jamais le formulaire ni le localStorage, qui
     * peuvent garder la valeur d'un autre projet).
     */
    function siteAutonomePompage() {
        const horsReseau = String(window.ACTIVE_PROJECT_TYPE_CONNEXION || '') === (window.TYPE_CONNEXION_HORS_LIGNE || 'hors-ligne');
        const mode = String(window.ACTIVE_PROJECT_MODE_VALORISATION || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        return horsReseau && mode.indexOf('pompage') !== -1;
    }

    // #cmPompageSolaireSection suit pompageSolaireVisible() (ci-dessus).
    const SECTIONS_MASQUEES_POMPAGE_AUTONOME = [
        'cmOnduleurPuissanceGarantieRow', 'cmBorneRechargeSection', 'cmAffectationCentraleWrapper',
    ];

    /**
     * Projet « Site autonome ou Projet PV Hybride » (demande explicite) : dans le formulaire
     * RÉSIDENTIEL seulement, la puissance et la garantie de l'onduleur et les sections « Batterie »,
     * « Borne de recharge » et « Pompage solaire » ne sont pas affichées (masquées seulement :
     * valeurs conservées dans l'état et toujours enregistrées).
     */
    const SECTIONS_MASQUEES_HORS_RESEAU_RESIDENTIEL = [
        'cmOnduleurPuissanceGarantieRow', 'cmBatterieSection', 'cmBorneRechargeSection', 'cmPompageSolaireSection',
    ];

    function projetHorsReseau() {
        return String(window.ACTIVE_PROJECT_TYPE_CONNEXION || '') === (window.TYPE_CONNEXION_HORS_LIGNE || 'hors-ligne');
    }

    /**
     * Applique le masquage ci-dessus dans le formulaire résidentiel ou dans un onglet du formulaire
     * PRO (clones repérés par data-cm-id). Le masquage hors réseau ne vaut que pour le résidentiel.
     */
    function appliquerMasquagePompageAutonome(racine, parDataCmId) {
        if (!racine) return;
        const masquer = siteAutonomePompage();
        SECTIONS_MASQUEES_POMPAGE_AUTONOME.forEach((id) => {
            const el = racine.querySelector(parDataCmId ? `[data-cm-id="${id}"]` : '#' + id);
            if (el) el.style.display = masquer ? 'none' : '';
        });
        if (parDataCmId) {
            // Le clone PRO recopie le display:none posé sur l'original résidentiel : rétabli ici
            // (les autres sections masquées ont déjà leur propre règle PRO).
            const batterie = racine.querySelector('[data-cm-id="cmBatterieSection"]');
            if (batterie) batterie.style.display = '';
            return;
        }
        if (!projetHorsReseau()) return;
        SECTIONS_MASQUEES_HORS_RESEAU_RESIDENTIEL.forEach((id) => {
            const el = racine.querySelector('#' + id);
            if (el) el.style.display = 'none';
        });
    }

    /**
     * NOUVEAU (demande explicite : « pour les projets de Typologie = Résidentielle, il ne faut pas
     * afficher les types de structure = Bâtiment incliné, ombrière et petit champ solaire ») :
     * valeurs de #cmTypeMontageSelect retirées du menu dans cette typologie. Restent donc proposées :
     * Toiture résidentielle, Toiture terrasse et Autres.
     *
     * Masquées, pas supprimées — même traitement que l'option héritée 'ombriere' : un champ déjà
     * enregistré sous l'une de ces valeurs (projet changé de typologie, ou réglé depuis le
     * formulaire PRO) continue de l'afficher et reste sélectionnable par programme.
     *
     * Liste de REPLI seulement : le parcours (window.SKV_PARCOURS.types_structure_masques_residentiel,
     * cf. app/utils/parcours.py) la remplace. Depuis le 2026-10-29, PV_project ne masque plus que
     * Bâtiment incliné en Résidentielle (ombrières pour les pergolas, petit champ solaire).
     */
    const TYPES_MONTAGE_MASQUES_RESIDENTIEL = [
        'toiture_inclinee',
        'ombriere', 'ombriere_metal', 'ombriere_bois', 'ombriere_solumbra',
        'champ_solaire',
    ];

    function appliquerVisibiliteTypeMontage(residentielle) {
        const select = CM.modalBody.querySelector('#cmTypeMontageSelect');
        if (!select) return;
        // Listes du parcours (app/utils/parcours.py) : en PV_project, la typologie Résidentielle garde
        // ombrières (pergolas) et petit champ solaire ; le Site autonome n'a aucune ombrière.
        const parcours = window.SKV_PARCOURS || {};
        const typesMasquesResidentiel = parcours.types_structure_masques_residentiel || TYPES_MONTAGE_MASQUES_RESIDENTIEL;
        const typesMasquesParcours = parcours.types_structure_masques || [];
        Array.from(select.options).forEach((opt) => {
            // Mémorisé au 1er passage : certaines options sont déjà masquées dans le gabarit
            // (valeur héritée 'ombriere'), elles ne doivent pas réapparaître hors typologie
            // Résidentielle en sortant de ce filtre.
            if (opt.dataset.cmMasqueGabarit === undefined) opt.dataset.cmMasqueGabarit = opt.hidden ? '1' : '0';
            const masque = opt.dataset.cmMasqueGabarit === '1'
                || (residentielle && typesMasquesResidentiel.indexOf(opt.value) !== -1)
                || typesMasquesParcours.indexOf(opt.value) !== -1;
            opt.hidden = masque;
            opt.style.display = masque ? 'none' : '';
        });
        rafraichirBoutonsTypeMontage();
    }

    /**
     * Boutons du "Type de structure" (demande explicite : boutons sélectionnables, 2 par rangée, à
     * la place de la liste déroulante). Un bouton par <option> de #cmTypeMontageSelect ; un clic
     * pose la valeur sur le <select> et émet 'change' — le traitement reste donc celui de son
     * écouteur, sans aucune règle dupliquée ici.
     */
    function construireBoutonsTypeMontage() {
        const select = CM.modalBody.querySelector('#cmTypeMontageSelect');
        const groupe = CM.modalBody.querySelector('#cmTypeMontageBoutons');
        if (!select || !groupe) return;
        groupe.innerHTML = '';
        Array.from(select.options).forEach((opt) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cm-btn';
            b.setAttribute('role', 'radio');
            b.setAttribute('data-cm-valeur', opt.value);
            // Icône + infobulle descriptive à la place du libellé (icones_structures.js) ; libellé
            // texte si le module d'icônes n'est pas chargé ou ne connaît pas la valeur.
            const libelle = String(opt.textContent || '').trim();
            if (!(window.SkvIcones && window.SkvIcones.decorerBouton(b, 'structure', opt.value, libelle))) {
                b.textContent = libelle;
            }
            groupe.appendChild(b);
        });
        groupe.addEventListener('click', (e) => {
            const b = e.target.closest('[data-cm-valeur]');
            if (!b || b.disabled) return;
            const valeur = b.getAttribute('data-cm-valeur');
            if (select.value === valeur) return;
            select.value = valeur;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        // Toute écriture accompagnée d'un 'change' (clic ci-dessus, formulaire PRO) se reflète ici ;
        // les écritures silencieuses depuis l'état passent par rafraichirBoutonsTypeMontage().
        select.addEventListener('change', rafraichirBoutonsTypeMontage);
        rafraichirBoutonsTypeMontage();
    }

    /** Bouton actif = valeur du <select> ; options masquées/désactivées reportées sur les boutons. */
    function rafraichirBoutonsTypeMontage() {
        if (!CM.modalBody) return;
        const select = CM.modalBody.querySelector('#cmTypeMontageSelect');
        const groupe = CM.modalBody.querySelector('#cmTypeMontageBoutons');
        if (!select || !groupe) return;
        Array.from(select.options).forEach((opt) => {
            const b = groupe.querySelector(`[data-cm-valeur="${opt.value}"]`);
            if (!b) return;
            const actif = select.value === opt.value;
            // Option masquée (valeur héritée, filtre de typologie) : bouton masqué, SAUF si c'est la
            // valeur courante d'un champ déjà enregistré — elle doit rester lisible.
            b.style.display = (opt.hidden && !actif) ? 'none' : '';
            b.disabled = opt.disabled;
            b.classList.toggle('on', actif);
            b.setAttribute('aria-checked', actif ? 'true' : 'false');
        });
    }

    /**
     * Règles d'affichage qui dépendent du PROJET actif et non du champ PV (demandes explicites) :
     *  - section "Pompage solaire" (cf. pompageSolaireVisible) ;
     *  - boutons "Calculer et visualiser" / "Télécharger le rapport" : réservés à la typologie
     *    Résidentielle (ils lancent l'étude d'autoconsommation et le rapport résidentiels ; en PRO /
     *    Grand projet ces étapes passent par le parcours Pro).
     *  - options du "Type de structure" (cf. appliquerVisibiliteTypeMontage, juste au-dessus).
     * Rejouées à chaque ouverture / changement de champ (updateEquipmentFieldsUI) : la typologie
     * peut changer sans rechargement (changement de projet actif).
     */
    /**
     * Case « batterie virtuelle » proposée (projets Résidentiel et PRO, cf. EtudesEconomiqueLogic.js),
     * quel que soit le type d'étude : en Chiffrage aussi (demande explicite), elle y commande la ligne
     * « Frais d'activation batterie virtuelle » du devis.
     */
    function batterieVirtuelleVisible() {
        return typeof window.batterieVirtuelleProposee === 'function' && window.batterieVirtuelleProposee();
    }

    /** État de la case : celui de l'étude économique du projet (#batterie_virtuelle_optin). */
    function batterieVirtuelleCochee() {
        return !!document.getElementById('batterie_virtuelle_optin')?.checked;
    }

    /**
     * Coche / décoche la batterie virtuelle de l'étude économique : son évènement 'change' l'affiche
     * dans la modale économique (majBatterieVirtuelle) et l'enregistre (localStorage + base).
     */
    function definirBatterieVirtuelle(cochee) {
        const caseEco = document.getElementById('batterie_virtuelle_optin');
        if (!caseEco || caseEco.checked === !!cochee) return;
        caseEco.checked = !!cochee;
        caseEco.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /** Visibilité et état de la case, ici et dans les clones du formulaire PRO. */
    function afficherBatterieVirtuelle() {
        const visible = batterieVirtuelleVisible();
        const cochee = batterieVirtuelleCochee();
        const section = CM.modalBody && CM.modalBody.querySelector('#cmBatterieVirtuelleSection');
        if (section) section.style.display = visible ? '' : 'none';
        const caseCm = CM.modalBody && CM.modalBody.querySelector('#cmBatterieVirtuelleOptin');
        if (caseCm) caseCm.checked = cochee;
        document.querySelectorAll('[data-cm-id="cmBatterieVirtuelleSection"]').forEach((el) => { el.style.display = visible ? '' : 'none'; });
        // Réglage du projet : modifiable même dans un onglet PRO dont le champ n'a pas de calepinage.
        document.querySelectorAll('[data-cm-id="cmBatterieVirtuelleOptin"]').forEach((el) => {
            el.checked = cochee;
            el.disabled = false;
        });
    }

    // Case cochée / décochée depuis la modale économique : reportée dans le calepinage.
    document.addEventListener('batterieVirtuelleChangee', () => afficherBatterieVirtuelle());

    function appliquerVisibiliteSelonProjet() {
        if (!CM.modalBody) return;
        const pompage = CM.modalBody.querySelector('#cmPompageSolaireSection');
        if (pompage) pompage.style.display = pompageSolaireVisible() ? '' : 'none';
        appliquerMasquagePompageAutonome(CM.modalBody, false);
        afficherBatterieVirtuelle();

        const typologie = typeof window.normaliserTypologie === 'function'
            ? window.normaliserTypologie(window.ACTIVE_PROJECT_TYPOLOGIE) : window.ACTIVE_PROJECT_TYPOLOGIE;
        const residentielle = typologie === (window.TYPOLOGIE_RESIDENTIELLE || 'Résidentielle');
        appliquerVisibiliteTypeMontage(residentielle);
        // Parcours Chiffrage (avant-projet) : ni étude d'autoconsommation ni rapport.
        const chiffrage = typeof window.isChiffrageProject === 'function' && window.isChiffrageProject();
        ['cmCalculerVisualiserBtn', 'cmTelechargerRapportBtn'].forEach((id) => {
            const btn = CM.modalBody.querySelector('#' + id);
            if (btn) btn.style.display = (residentielle && !chiffrage) ? '' : 'none';
        });
        const parcoursResi = typeof window.isResidentialPath === 'function' ? window.isResidentialPath() : residentielle;
        ['cmExporterPlanCablageBtn', 'cmExporterDevisDetailleBtn', 'cmExporterDevisSynthetiqueBtn'].forEach((id) => {
            const btn = CM.modalBody.querySelector('#' + id);
            if (btn) btn.style.display = parcoursResi ? '' : 'none';
        });
        // Déclaration préalable : même critère que l'entrée du menu horizontal (menu_list.html).
        const dpBtn = CM.modalBody.querySelector('#cmOpenDeclarationPrealableBtn');
        if (dpBtn) {
            const siteAutonome = typeof window.isSiteAutonomeProject === 'function' && window.isSiteAutonomeProject();
            const masqueParcours = typeof window.parcoursMasque === 'function' && window.parcoursMasque('dp');
            dpBtn.style.display = (!siteAutonome && !masqueParcours) ? '' : 'none';
        }
    }

    /**
     * Reporte dans les sections « Panneau » et « Système » les matériels enregistrés dans CM.state
     * (références, puissances, dimensions du panneau, garanties, listes du catalogue). AFFICHAGE
     * SEULEMENT : n'écrit jamais dans l'état et ne reconstruit aucune liste.
     *
     * CORRECTIF (bug rapporté : « après avoir sélectionné un panneau dans le formulaire PRO, à
     * l'actualisation ce sont les données par défaut qui s'affichent ») : le choix était bien
     * enregistré (état du champ, localStorage + base), mais la synchronisation du formulaire PRO
     * (calepinage_maison_form_pro.js::synchroniser) ne rejouait pour chaque onglet que les fonctions
     * d'affichage de la pose et de la géométrie — jamais celles des matériels. Le clone PRO
     * recopiait donc ce qu'affichait le modal résidentiel, c.-à-d. un état par défaut après
     * rechargement. updateEquipmentFieldsUI() ne convient pas là : elle reconstruit la liste des
     * batteries et EFFACE batteryRef quand le catalogue n'est pas encore chargé.
     * Dimensions du panneau ajoutées : elles n'étaient écrites qu'à la construction du modal, d'où le
     * même symptôme côté résidentiel en passant d'un champ PV à l'autre.
     */
    function afficherMaterielsDepuisEtat() {
        if (!CM.modalBody || !CM.state) return;
        [
            ['cmPanelRef', 'panelRef'], ['cmPanelPowerWc', 'panelPowerWc'],
            ['cmPanelLength', 'panelLengthMm'], ['cmPanelWidth', 'panelWidthMm'], ['cmPanelThickness', 'panelThicknessMm'],
            ['cmGarantiePanneauAns', 'garantiePanneauAns'],
            ['cmPerteSysteme', 'perteSysteme'], ['cmAffectationCentrale', 'affectationCentrale'],
            ['cmOnduleurPuissance', 'onduleurPuissanceKva'], ['cmOnduleurType', 'onduleurTechnologie'],
            ['cmOnduleurRendement', 'onduleurRendement'], ['cmOnduleurConso', 'onduleurConso'],
            ['cmGarantieOnduleurAns', 'garantieOnduleurAns'],
            ['cmBatteryRef', 'batteryRef'], ['cmBatteryCapacite', 'batteryCapaciteKwh'],
            ['cmGarantieBatterieAns', 'garantieBatterieAns'],
            ['cmOptimiseurRef', 'optimiseurRef'], ['cmGarantieOptimiseurAns', 'garantieOptimiseurAns'],
        ].forEach(([id, cle]) => {
            const el = CM.modalBody.querySelector('#' + id);
            if (!el || document.activeElement === el) return;
            const valeur = CM.state[cle];
            el.value = valeur == null ? '' : valeur;
        });
        if (typeof CM.restorePanelSelection === 'function') CM.restorePanelSelection();
        if (typeof CM.restoreOnduleurSelection === 'function') CM.restoreOnduleurSelection();
        if (typeof CM.restoreBatterySelection === 'function') CM.restoreBatterySelection();
    }

    // NOUVEAU : synchronise les champs "Équipements & production" avec CM.state à l'ouverture du
    // modal et à chaque changement de source (switchToSource) — même principe que les checkboxes
    // showPanels/showBackground déjà synchronisées à ces mêmes points d'entrée.
    function updateEquipmentFieldsUI() {
        if (!CM.modalBody) return;
        appliquerVisibiliteSelonProjet();
        const setVal = (id, value) => {
            const el = CM.modalBody.querySelector('#' + id);
            if (el && document.activeElement !== el) el.value = value;
        };
        setVal('cmPanelRef', CM.state.panelRef);
        setVal('cmPanelPowerWc', CM.state.panelPowerWc);
        setVal('cmPerteSysteme', CM.state.perteSysteme);
        setVal('cmAffectationCentrale', CM.state.affectationCentrale);
        setVal('cmOnduleurPuissance', CM.state.onduleurPuissanceKva);
        // Type d'onduleur : valeur mémorisée avec la maison, recalculée depuis le catalogue quand il
        // est disponible (une maison enregistrée avant l'ajout de ce champ n'en a pas).
        const selectionOnduleur = getOnduleurSelectionne();
        if (selectionOnduleur && selectionOnduleur.type) CM.state.onduleurTechnologie = selectionOnduleur.type;
        setVal('cmOnduleurType', CM.state.onduleurTechnologie || '');
        if (window.OnduleursHorsReseau) window.OnduleursHorsReseau.rafraichir();
        setVal('cmOnduleurRendement', CM.state.onduleurRendement);
        setVal('cmOnduleurConso', CM.state.onduleurConso);
        setVal('cmBatteryRef', CM.state.batteryRef);
        setVal('cmBatteryCapacite', CM.state.batteryCapaciteKwh);
        setVal('cmGarantiePanneauAns', CM.state.garantiePanneauAns);
        setVal('cmGarantieOnduleurAns', CM.state.garantieOnduleurAns);
        setVal('cmGarantieBatterieAns', CM.state.garantieBatterieAns);
        setVal('cmGarantieBorneAns', CM.state.garantieBorneAns);
        const pompageCheckbox = CM.modalBody.querySelector('#cmPompageSolaireActif');
        const pompageRefSelect = CM.modalBody.querySelector('#cmPompageSolaireCatalogSelect');
        const pompageGarantieInput = CM.modalBody.querySelector('#cmGarantiePompageAns');
        if (pompageCheckbox) pompageCheckbox.checked = !!CM.state.pompageSolaireActif;
        if (pompageRefSelect) {
            pompageRefSelect.disabled = !CM.state.pompageSolaireActif;
            if (document.activeElement !== pompageRefSelect) pompageRefSelect.value = CM.state.pompageSolaireRef || '';
        }
        if (pompageGarantieInput) {
            pompageGarantieInput.disabled = !CM.state.pompageSolaireActif;
            if (document.activeElement !== pompageGarantieInput) pompageGarantieInput.value = CM.state.garantiePompageAns;
        }
        setVal('cmOptimiseurRef', CM.state.optimiseurRef);
        setVal('cmGarantieOptimiseurAns', CM.state.garantieOptimiseurAns);
        if (typeof CM.updateOptimiseurCardVisibility === 'function') CM.updateOptimiseurCardVisibility();
        const siSelect = CM.modalBody.querySelector('#cmSystemeIntegrationSelect');
        // La liste dépend du type de structure du champ affiché : reconstruite avant d'y reporter
        // la référence de l'état.
        if (siSelect && typeof CM.remplirSelectSystemes === 'function') CM.remplirSelectSystemes(siSelect, CM.state);
        else if (siSelect && document.activeElement !== siSelect) siSelect.value = CM.state.systemeIntegrationRef || '';
        // "Largeur rail" (ombrières) : resynchronisée comme les autres champs à chaque changement de
        // champ PV — sa valeur est propre à chaque maison (cf. PERSISTED_STATE_FIELDS).
        setVal('cmRailWidth', CM.state.railWidthMm);
        setVal('cmPanelSpacingX', CM.state.panelSpacingXMm);
        setVal('cmPanelSpacingY', CM.state.panelSpacingYMm);
        setVal('cmJointDilatation', CM.state.jointDilatationMm);
        setVal('cmJointDilatationLimite', CM.state.jointDilatationLimiteM);
        const typeMontageSelect = CM.modalBody.querySelector('#cmTypeMontageSelect');
        if (typeMontageSelect && document.activeElement !== typeMontageSelect) typeMontageSelect.value = CM.normalizeTypeMontage(CM.state.typeMontage);
        rafraichirBoutonsTypeMontage();
        // CORRECTIF (onduleur non restauré après rechargement) : restaure la sélection du <select>
        // catalogue à chaque ouverture/changement de maison, comme siSelect/typeMontageSelect
        // ci-dessus — fonction assignée plus bas dans ce fichier (garde nécessaire : cette fonction-ci
        // est déjà appelée avant cette assignation lors de l'initialisation du modal).
        if (typeof CM.restoreOnduleurSelection === 'function') CM.restoreOnduleurSelection();
        // Panneau (liste du catalogue + dimensions) : cf. afficherMaterielsDepuisEtat.
        afficherMaterielsDepuisEtat();
        // NOUVEAU (demande explicite, filtre des batteries) : la liste des batteries proposées dépend
        // de l'onduleur de LA maison affichée — donc reconstruite à chaque ouverture/changement de
        // maison, au même titre que la sélection d'onduleur juste au-dessus. Jamais pendant que
        // l'utilisateur a le menu ouvert (reconstruire le fermerait sous son curseur). Ce passage
        // rattrape aussi le catalogue arrivé de la base APRÈS la construction du modal.
        const batterySelectEl = CM.modalBody.querySelector('#cmBatteryCatalogSelect');
        if (typeof CM.populateBatterySelect === 'function' && document.activeElement !== batterySelectEl) {
            CM.populateBatterySelect();
        }
        // NOUVEAU (demande explicite) : "Type de faîtage" 2 pans asymétrique — resynchronisé à
        // l'ouverture / au changement de maison (défaut 'sans').
        const faitageSel = CM.modalBody.querySelector('#calepinageMaisonFaitageAsymType');
        if (faitageSel && document.activeElement !== faitageSel) faitageSel.value = CM.state.faitageAsymType || 'sans';
        const acrotereInput = CM.modalBody.querySelector('#calepinageMaisonAcrotereInput');
        if (acrotereInput && document.activeElement !== acrotereInput && CM.state.acrotereHeightM != null) {
            acrotereInput.value = CM.state.acrotereHeightM;
        }
        // Pente toiture : le champ n'était jamais resynchronisé depuis l'état (valeur HTML figée) ->
        // affichait "15" alors que l'état pouvait valoir 3 (terrasse) ou une valeur enregistrée.
        const penteInput = CM.modalBody.querySelector('#calepinageMaisonPenteInput');
        if (penteInput && document.activeElement !== penteInput && CM.state.penteDeg != null) {
            penteInput.value = CM.state.penteDeg;
        }
        const pente2Input = CM.modalBody.querySelector('#calepinageMaisonPente2Input');
        if (pente2Input && document.activeElement !== pente2Input && CM.state.penteDeg2 != null) {
            pente2Input.value = CM.state.penteDeg2;
        }
        // Modèle d'ombrière (métal / bois) — resynchronisé depuis l'état (peut être modifié depuis
        // la vue 3D par clic droit, cf. calepinage_maison_3d_ombriere_form.js).
        const ombMetalSel = CM.modalBody.querySelector('#calepinageMaisonOmbriereMetalModel');
        if (ombMetalSel && document.activeElement !== ombMetalSel && CM.state.ombriereMetalModel) {
            ombMetalSel.value = CM.state.ombriereMetalModel;
        }
        const ombMetalVarSel = CM.modalBody.querySelector('#calepinageMaisonOmbriereMetalVariant');
        if (ombMetalVarSel && document.activeElement !== ombMetalVarSel) {
            ombMetalVarSel.value = CM.state.ombriereMetalBracingVariant || 'v1';
        }
        const ombBoisSel = CM.modalBody.querySelector('#calepinageMaisonOmbriereBoisModel');
        if (ombBoisSel && document.activeElement !== ombBoisSel && CM.state.ombriereBoisModel) {
            ombBoisSel.value = CM.state.ombriereBoisModel;
        }
        const petitChampSel = CM.modalBody.querySelector('#calepinageMaisonPetitChampModel');
        if (petitChampSel && document.activeElement !== petitChampSel && CM.state.petitChampModel) {
            petitChampSel.value = CM.state.petitChampModel;
        }
        const petitChampVariantSel = CM.modalBody.querySelector('#calepinageMaisonPetitChampVariant');
        if (petitChampVariantSel && document.activeElement !== petitChampVariantSel) {
            petitChampVariantSel.value = CM.state.petitChampBracingVariant || 'v1';
        }
        syncPetitChampFieldsToForm();
        remplirChampsGeometrieDepuisEtat();
        syncOmbriereDivision();
    }

    /**
     * Remet TOUS les champs de la section "Géométrie de la toiture" en accord avec CM.state.
     *
     * Deux besoins, une seule fonction :
     *  - changement de champ PV (switchToSource -> updateEquipmentFieldsUI, juste au-dessus) : seuls
     *    "Pente toiture 1/2", "Hauteur acrotère", "Type de faîtage" et 3 champs du petit champ
     *    solaire étaient resynchronisés — porte-à-faux, espacements, dômes, sheds, "Sheds réguliers"
     *    gardaient donc à l'écran les valeurs du champ PV PRÉCÉDENT (l'état, lui, était juste) ;
     *  - miroir de cette section dans le formulaire PRO / Grand projet, champ PV par champ PV
     *    (calepinage_maison_form_pro.js) : il bascule CM.state sur le champ voulu, appelle cette
     *    fonction, puis recopie les valeurs affichées dans son clone.
     *
     * Les conversions sont l'exact inverse de `unitDivisor` des wireCmValidatedInput correspondants
     * (état en mètres, saisie en mm ; 2000 pour "Largeur faîtage", dont l'état est la valeur PAR
     * CÔTÉ). Un champ en cours de saisie n'est jamais écrasé sous le curseur.
     */
    // "Hauteur bas PV (m)" du petit champ solaire (demande explicite) : défaut 0,5 m, bornes 0,3-5 m,
    // identiques à #lowPointHeight du configurateur petit_champ_solaire.html et à limites.json.
    const HAUTEUR_BAS_PV = { min: 0.3, max: 5, label: 'Hauteur bas PV' };

    // "Hauteur structure égout (m)" de l'ombrière métal (demande explicite : harmoniser le champ
    // "Hauteur bâtiment" avec celui de la modale de géométrie). Bornes reprises TELLES QUELLES de
    // #lowPointHeight dans ombriere_metal.html (min 2.5 / max 15 / step 0.01), pour qu'une valeur
    // saisie ici soit toujours acceptable par la modale, et réciproquement.
    // Ombrière BOIS / SOLUMBRA volontairement exclues : leur #lowPointHeight est un champ CALCULÉ
    // (readonly, déduit de la hauteur libre de passage) — rien à y synchroniser.
    const HAUTEUR_EGOUT_OMBRIERE = { min: 2.5, max: 15, label: 'Hauteur structure égout' };

    function estPetitChamp() {
        return !!CM.state && CM.normalizeTypeMontage(CM.state.typeMontage) === 'champ_solaire';
    }

    function estOmbriereMetal() {
        return !!CM.state && CM.normalizeTypeMontage(CM.state.typeMontage) === 'ombriere_metal';
    }

    /**
     * Titre de la section repliable, selon le type de structure (demande explicite) : une ombrière
     * n'a pas de toiture, un petit champ solaire non plus — il a des tables. Le <summary> porte un
     * <span> dédié pour que le chevron survive à la réécriture, et le clone du formulaire PRO le
     * recopie à chaque synchronisation (TEXTES_DYNAMIQUES, calepinage_maison_form_pro.js).
     */
    function appliquerTitreGeometrie() {
        if (!CM.modalBody || !CM.state) return;
        const titre = CM.modalBody.querySelector('#calepinageMaisonGeometrieTitre');
        if (!titre) return;
        const tm = CM.normalizeTypeMontage(CM.state.typeMontage) || '';
        titre.textContent = (tm.indexOf('ombriere') === 0) ? "Géométrie de l'ombrière"
            : (tm === 'champ_solaire' ? 'Géométrie de la table solaire' : 'Géométrie de la toiture');
    }

    /**
     * Petit champ solaire : #calepinageMaisonBatimentHeightInput (id conservé, repris tel quel dans
     * le formulaire PRO) devient « Hauteur bas PV (m) » et porte CM.state.petitChampLowPointHeightM
     * (même valeur que #calepinageMaisonPetitChampLowHeightInput, alors masqué pour ne pas afficher
     * deux fois la même saisie, et que #lowPointHeight du configurateur). Sinon : hauteur du bâtiment.
     */
    function appliquerChampHauteurBasPv() {
        if (!CM.modalBody) return;
        const pc = estPetitChamp();
        // Ombrière métal (demande explicite) : même champ, même valeur d'état (batimentHeightM),
        // libellé et bornes de la modale de géométrie — cf. HAUTEUR_EGOUT_OMBRIERE.
        const om = !pc && estOmbriereMetal();
        const label = CM.modalBody.querySelector('#calepinageMaisonBatimentHeightLabel');
        if (label) {
            label.textContent = pc ? 'Hauteur bas PV (m)'
                : (om ? 'Hauteur structure égout (m)' : 'Hauteur bâtiment (m)');
            // Le détail quitte le libellé (place en demi-colonne) mais reste accessible.
            label.title = pc ? 'Hauteur du point bas des panneaux au-dessus du sol (m)'
                : (om ? 'Hauteur de la structure au niveau de l\'égout (m)' : 'Hauteur du bâtiment, du sol à la gouttière (m)');
        }
        const input = CM.modalBody.querySelector('#calepinageMaisonBatimentHeightInput');
        if (input) {
            const bornes = pc ? HAUTEUR_BAS_PV : (om ? HAUTEUR_EGOUT_OMBRIERE : { min: 0.2, max: 25 });
            input.min = String(bornes.min);
            input.max = String(bornes.max);
            input.step = pc ? '0.05' : (om ? '0.01' : '0.1');
            if (document.activeElement !== input) {
                const v = pc ? CM.state.petitChampLowPointHeightM : CM.state.batimentHeightM;
                if (v != null && !Number.isNaN(v)) input.value = v;
            }
        }
        const lowW = CM.modalBody.querySelector('#calepinageMaisonPetitChampLowHeightWrapper');
        if (lowW) lowW.style.display = 'none';
    }

    function remplirChampsGeometrieDepuisEtat() {
        if (!CM.modalBody || !CM.state) return;
        const st = CM.state;
        const setIf = (id, v) => {
            const el = CM.modalBody.querySelector('#' + id);
            if (!el || document.activeElement === el) return;
            if (v == null || (typeof v === 'number' && Number.isNaN(v))) return;
            el.value = v;
        };
        const mm = (metres, diviseur) => (metres == null ? null : Math.round(metres * (diviseur || 1000)));

        setIf('calepinageMaisonPenteInput', st.penteDeg);
        setIf('calepinageMaisonPente2Input', st.penteDeg2);
        setIf('calepinageMaisonAcrotereInput', st.acrotereHeightM);
        setIf('calepinageMaisonBatimentHeightInput', estPetitChamp() ? st.petitChampLowPointHeightM : st.batimentHeightM);
        setIf('calepinageMaisonOverhangRampant', mm(st.overhangRampant));
        setIf('calepinageMaisonOverhangLongpan', mm(st.overhangLongpan));
        setIf('calepinageMaisonEdgeClearanceInput', mm(st.edgeClearanceM));
        setIf('calepinageMaisonRidgeClearanceInput', mm(st.ridgeClearanceEachSideM, 2000));
        setIf('calepinageMaisonShedSpacingInput', mm(st.shedSpacingM));
        setIf('calepinageMaisonShedGroupInput', st.shedPanelsPerGroup);
        setIf('calepinageMaisonShedPanelsPerRowInput', st.shedPanelsPerRow);
        setIf('calepinageMaisonShedRowGroupSpacingInput', mm(st.shedRowGroupSpacingM));
        setIf('calepinageMaisonDomeSpacingInput', mm(st.domeSpacingM));
        setIf('calepinageMaisonDomePanelSpacingInput', mm(st.domePanelSpacingM));
        setIf('calepinageMaisonDomeTiltInput', st.domeTiltDeg);
        setIf('calepinageMaisonDomePanelsPerRowInput', CM.domePanelsPerRow(st));
        setIf('calepinageMaisonAsymmetryInput', st.asymmetryPercent);
        setIf('calepinageMaisonPolygonAzimuthInput', st.polygonAzimuthDeg);
        setIf('calepinageMaisonFaitageAsymType', st.faitageAsymType || 'sans');
        setIf('calepinageMaisonRidgeWidthInput', Number(st.croupeRidgeWidthMm) > 0 ? st.croupeRidgeWidthMm : 2000);

        const shedRegular = CM.modalBody.querySelector('#calepinageMaisonShedRegularCheckbox');
        if (shedRegular) shedRegular.checked = !!st.shedRegularAlignment;
        // Variante Double Poteaux (ombrière métal) : modifiable aussi depuis la modale de géométrie
        // et la fenêtre 3D, qui ne passent que par cette fonction pour rafraîchir le formulaire.
        const varianteMetal = CM.modalBody.querySelector('#calepinageMaisonOmbriereMetalVariant');
        if (varianteMetal && document.activeElement !== varianteMetal) varianteMetal.value = st.ombriereMetalBracingVariant || 'v1';
        const varianteMetalW = CM.modalBody.querySelector('#calepinageMaisonOmbriereMetalVariantWrapper');
        if (varianteMetalW) {
            varianteMetalW.style.display = (CM.normalizeTypeMontage(st.typeMontage) === 'ombriere_metal'
                && st.ombriereMetalModel === 'double') ? '' : 'none';
        }

        // Entraxes poteaux : chaîne libre (pas de `setIf`, qui refuse null — or "vide" est ici une
        // valeur significative : entraxe automatique).
        const entraxeInput = CM.modalBody.querySelector('#calepinageMaisonOmbriereEntraxeInput');
        if (entraxeInput && document.activeElement !== entraxeInput) {
            entraxeInput.value = st.ombriereEntraxeExpr || '';
        }
        majPlaceholderEntraxeOmbriere();
        if (typeof CM.majChampsPoteauxUI === 'function') CM.majChampsPoteauxUI();
    }

    /**
     * Longueur de l'ombrière du champ PV courant, telle qu'elle est envoyée à la modale de
     * géométrie et à la 3D (en calepinage shed : la longueur d'UNE table). 0 si non mesurable.
     */
    function longueurOmbriereCourante() {
        const service = window.CalepinageMaisonDimensionsOmbriere;
        if (!service || typeof service.dimensionsOmbriere !== 'function') return 0;
        try {
            const d = service.dimensionsOmbriere(CM.state && CM.state.sourceId);
            return (d && d.facadeLength > 0) ? d.facadeLength : 0;
        } catch (e) {
            return 0;
        }
    }

    /**
     * Place-holder du champ "Entraxes poteaux" : rappelle ce qui s'appliquera si le champ reste
     * vide. Pas de valeur chiffrée — l'entraxe automatique dépend des porte-à-faux du formulaire
     * destinataire (modale de géométrie ou fenêtre 3D), qui ne sont pas les mêmes : un chiffre
     * précis ferait une promesse que les deux ne tiendraient pas à l'identique. Purement indicatif,
     * il n'écrit rien dans l'état.
     */
    function majPlaceholderEntraxeOmbriere() {
        if (!CM.modalBody) return;
        const input = CM.modalBody.querySelector('#calepinageMaisonOmbriereEntraxeInput');
        if (!input) return;
        const dispo = longueurOmbriereCourante();
        // Entraxes automatiques effectivement appliqués (règles par famille, cf.
        // CM.poteauxOmbriere.implantationLongitudinale) : les mêmes que la modale et la 3D.
        const P = CM.poteauxOmbriere;
        let imp = null;
        try { imp = (P && dispo > 0) ? P.implantationLongitudinale(Object.assign({}, CM.state, { ombriereEntraxeExpr: null }), dispo) : null; } catch (e) { imp = null; }
        input.placeholder = imp ? 'auto : ' + imp.expr
            : (dispo > 0 ? 'auto (travées ≈ 6 m sur ' + dispo.toFixed(2) + ' m)' : 'auto (travées ≈ 6 m)');
    }

    // Resynchronise les champs 2D du petit champ solaire depuis CM.state (le modal 3D peut les avoir
    // modifiés par clic droit — demande explicite : "synchroniser les valeurs des champs identiques
    // entre les 2 formulaires").
    function syncPetitChampFieldsToForm() {
        if (!CM.modalBody || !CM.state) return;
        const setIf = (id, v) => {
            const el = CM.modalBody.querySelector('#' + id);
            if (el && document.activeElement !== el && v != null && !Number.isNaN(v)) el.value = v;
        };
        setIf('calepinageMaisonPetitChampLowHeightInput', CM.state.petitChampLowPointHeightM);
        setIf('calepinageMaisonShedGroupInput', CM.state.shedPanelsPerGroup);   // "Nb. PV par shed"
        setIf('calepinageMaisonShedSpacingInput', (CM.state.shedSpacingM != null ? Math.round(CM.state.shedSpacingM * 1000) : null));
    }

    // Géométrie de toiture imposée par le MODÈLE d'ombrière (demande explicite) :
    //  - métal : y_shape / doubleYShape = bipente ; les 5 autres = monopente.
    //  - bois  : y_shape (Est-Ouest) = bipente ; les autres = monopente.
    function ombriereModelIsBipente(family, model) {
        if (family === 'metal') return model === 'y_shape' || model === 'doubleYShape';
        if (family === 'bois') return model === 'y_shape';
        return false;
    }
    /**
     * Listes « Modèle d'ombrière métal / bois » filtrées par la géométrie de toiture (demande
     * explicite : « Toiture Y » / « Double toiture Y » (métal) et « Est-Ouest » (bois) s'affichent
     * TOUJOURS et UNIQUEMENT pour « Diviser en 2 pans symétriques » ; les autres modèles, monopente,
     * uniquement hors de ce cas). Même règle que les configurateurs de structure
     * (ombriere_metal.html / ombriere_bois.html).
     *
     * La liste est RECONSTRUITE (et non masquée option par option) : le clone du formulaire PRO
     * (calepinage_maison_form_pro.js) ne recopie les <option> que si leurs valeurs changent.
     * Si le modèle retenu n'est plus proposé, le premier modèle compatible le remplace dans l'état du
     * champ — sans rappeler syncOmbriereDivision(), la géométrie étant justement celle qui décide.
     */
    const MODELES_OMBRIERE = [
        { famille: 'metal', select: '#calepinageMaisonOmbriereMetalModel', cle: 'ombriereMetalModel', typeMontage: 'ombriere_metal' },
        { famille: 'bois', select: '#calepinageMaisonOmbriereBoisModel', cle: 'ombriereBoisModel', typeMontage: 'ombriere_bois' },
    ];
    function filtrerModelesOmbriere() {
        if (!CM.modalBody || !CM.state) return;
        const bipenteSym = CM.state.divisionMode === '2pans' && CM.state.lastTwoPanKind === 'sym';
        const tm = CM.normalizeTypeMontage(CM.state.typeMontage);
        MODELES_OMBRIERE.forEach(({ famille, select: selecteur, cle, typeMontage }) => {
            const select = CM.modalBody.querySelector(selecteur);
            if (!select) return;
            if (!select.__toutesOptions) {
                select.__toutesOptions = Array.from(select.options).map((o) => ({ value: o.value, text: o.textContent }));
            }
            const retenues = select.__toutesOptions
                .filter((o) => ombriereModelIsBipente(famille, o.value) === bipenteSym);
            if (!retenues.length) return;
            const actuelles = Array.from(select.options).map((o) => o.value).join('|');
            if (actuelles !== retenues.map((o) => o.value).join('|')) {
                select.innerHTML = '';
                retenues.forEach((o) => {
                    const opt = document.createElement('option');
                    opt.value = o.value;
                    opt.textContent = o.text;
                    select.appendChild(opt);
                });
            }
            let modele = CM.state[cle];
            if (!retenues.some((o) => o.value === modele)) {
                modele = retenues[0].value;
                if (tm === typeMontage) {
                    CM.state[cle] = modele;
                    CM.state.ombriereParams = null; // surcharges 3D propres à l'ancien modèle
                }
            }
            if (document.activeElement !== select) select.value = modele;
        });
    }

    /**
     * Accorde modèle d'ombrière et géométrie de toiture.
     *
     * CORRECTIF (demande explicite : modèles Y « toujours et uniquement » pour « Diviser en 2 pans
     * symétriques ») : la GÉOMÉTRIE fait désormais autorité. Cette fonction est appelée à chaque
     * ouverture du modal / changement de champ (updateEquipmentFieldsUI) et au changement de type de
     * structure : elle imposait la géométrie du MODÈLE mémorisé — avec le modèle par défaut
     * (« Centrés »), une toiture divisée en 2 pans symétriques repassait en monopente et les modèles Y
     * n'étaient jamais proposés. Par défaut, c'est donc le modèle qui suit la géométrie
     * (filtrerModelesOmbriere). `options.suivreModele` : geste EXPLICITE de choix de modèle (liste
     * déroulante, vue 3D) — là seulement, la géométrie suit le modèle choisi, comme avant.
     */
    let _syncingOmbDiv = false;
    function syncOmbriereDivision(options) {
        if (!(options && options.suivreModele)) {
            filtrerModelesOmbriere();
            return;
        }
        if (_syncingOmbDiv || !CM.state) return;
        const tm = CM.normalizeTypeMontage(CM.state.typeMontage);
        const family = tm === 'ombriere_bois' ? 'bois' : (tm === 'ombriere_metal' ? 'metal' : null);
        if (!family) return;
        if (!CM.state.roofLocal || CM.state.roofLocal.length < 3) return;
        const model = family === 'bois'
            ? (CM.state.ombriereBoisModel || 'inclinedPost')
            : (CM.state.ombriereMetalModel || 'single');
        const wantBipente = ombriereModelIsBipente(family, model);
        const isBipente = CM.state.divisionMode === '2pans';
        if (wantBipente === isBipente) return;
        _syncingOmbDiv = true;
        try {
            if (wantBipente) CM.divideInto2PansSymmetric();
            else CM.resetDivision();
        } catch (e) { /* noop */ }
        _syncingOmbDiv = false;
    }

    // NOUVEAU (demande explicite : "ajouter la borne comme équipement, activer le champ de
    // garantie si une borne est sélectionnée dans Consommation d'énergie") : le choix/paramétrage
    // de la borne se fait dans le modal IRVE — une page Flask séparée (/concevoir_mon_projet/
    // bd-materiels-irve), sans variable globale partagée avec cette page — on interroge donc la
    // configuration IRVE persistée en base pour ce projet. simpleInputs (et non tables.bornes,
    // resté vide par un bug indépendant du nombre de <input> par ligne) capture chaque champ de
    // la table des bornes par son id DOM (qty-<n>, pwr-<n>...) : la présence d'au moins une clé
    // qty-* suffit à détecter qu'une borne existe.
    async function updateBorneEquipmentAvailability() {
        if (!CM.modalBody) return;
        const input = CM.modalBody.querySelector('#cmGarantieBorneAns');
        const hint = CM.modalBody.querySelector('#cmGarantieBorneHint');
        if (!input) return;

        let hasBorne = false;
        try {
            const projetId = localStorage.getItem('current_projet_id');
            if (projetId) {
                const res = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/irve/load`);
                const json = await res.json();
                const simpleInputs = json?.config?.data?.simpleInputs;
                hasBorne = !!(simpleInputs && Object.keys(simpleInputs).some((k) => /^qty-\d+$/.test(k)));
            }
        } catch (e) {
            console.warn('[CalepinageMaisonIndiv] Vérification de la borne IRVE impossible :', e);
        }

        input.disabled = !hasBorne;
        if (hint) hint.style.display = hasBorne ? 'none' : '';
        if (!hasBorne) {
            input.value = 0;
            CM.state.garantieBorneAns = 0;
        }
    }

    // NOUVEAU (bug rapporté : "je ne sais pas comment choisir les équipements") : câble 3 <select>
    // de catalogue (panneau/onduleur/batterie) réutilisant en LECTURE SEULE les catalogues déjà
    // chargés ailleurs dans l'application — window.panelCatalogFromApi (cf. bd_panneaux_pv.js,
    // peuplé par fetchPanelCatalog(), appelé ici directement), window.inverterDB (bd_onduleurs.js)
    // et window.batteryDB (bd_batteries.js). Choisir une entrée renseigne les champs manuels
    // existants (qui restent éditables/overridables ensuite), sans jamais ouvrir une modale du
    // calepinage rectangulaire/shed : ce module reste utilisable seul, sans ces autres outils.
    // NOUVEAU (demande explicite : "afficher un champ Type d'onduleur : Onduleur de chaîne,
    // Hybride ou Micro-onduleur ; ces données sont dans la colonne C du fichier Excel").
    //
    // La colonne C (« Technologie ») de Materiels_BD.xlsx ne contient pas ces 3 valeurs telles
    // quelles mais 13 formulations ("Onduleur de chaîne (Battery Ready)", "Onduleur hybride (Home
    // Hub, avec optimiseurs)", "Onduleur batterie (AC)"…). On les ramène donc aux 3 catégories
    // demandées, par mot-clé, dans cet ordre de priorité : micro, puis hybride, puis chaîne par
    // défaut. "Onduleur batterie (AC)" tombe ainsi côté chaîne, ce qui est aussi le bon
    // comportement pour le filtre des batteries (couplage AC).
    //
    // Repli sur le booléen `hybride` du catalogue quand la technologie est absente (entrées du
    // catalogue par défaut, antérieures à l'import Excel).
    const TYPE_ONDULEUR_CHAINE = 'Onduleur de chaîne';
    const TYPE_ONDULEUR_HYBRIDE = 'Hybride';
    const TYPE_ONDULEUR_MICRO = 'Micro-onduleur';
    // Appareils hors réseau (onduleurs_hors_reseau.js) : absents du catalogue réseau, ils ne
    // changent rien au classement des onduleurs existants.
    const TYPE_VARIATEUR_POMPAGE = 'Variateur de pompage';
    const TYPE_REGULATEUR_CHARGE = 'Régulateur de charge';

    function normaliserTypeOnduleur(technologie, hybrideFlag) {
        const t = String(technologie == null ? '' : technologie).toLowerCase();
        if (t.indexOf('variateur de pompage') !== -1) return TYPE_VARIATEUR_POMPAGE;
        if (t.indexOf('régulateur de charge') !== -1) return TYPE_REGULATEUR_CHARGE;
        if (t.indexOf('micro') !== -1) return TYPE_ONDULEUR_MICRO;
        if (t.indexOf('hybride') !== -1) return TYPE_ONDULEUR_HYBRIDE;
        if (t) return TYPE_ONDULEUR_CHAINE;
        // Technologie non renseignée : le booléen du catalogue reste une information valable.
        if (hybrideFlag === true || hybrideFlag === 'Oui') return TYPE_ONDULEUR_HYBRIDE;
        return '';
    }

    // Onduleur actuellement retenu pour cette maison, retrouvé dans le catalogue par sa référence
    // (CM.state.onduleurRef) — indépendant de l'état du <select>, qui peut ne pas encore être
    // repositionné au moment de l'appel (cf. restoreOnduleurSelection).
    function getOnduleurSelectionne() {
        const ref = CM.state.onduleurRef;
        if (!ref) return null;
        const db = window.inverterDB || {};
        for (const [fab, list] of Object.entries(db)) {
            const ond = (list || []).find((o) => o.ref === ref);
            if (ond) return { fabricant: fab, onduleur: ond, type: normaliserTypeOnduleur(ond.technologie, ond.hybride) };
        }
        return null;
    }

    const memeFabricant = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

    /**
     * NOUVEAU (demande explicite) : une batterie n'est proposée que si elle peut réellement se
     * raccorder à l'onduleur retenu.
     *   - onduleur HYBRIDE : la batterie se raccorde en courant continu sur l'onduleur lui-même,
     *     donc couplage DC ET même fabricant (les bus DC propriétaires ne sont pas interopérables
     *     d'une marque à l'autre) ;
     *   - onduleur de chaîne ou micro-onduleur : raccordement côté alternatif, donc couplage AC,
     *     tous fabricants confondus.
     * Tant qu'aucun onduleur n'est choisi (`selection` nulle), aucun filtre : rien ne permet de
     * trancher, et masquer tout le catalogue serait incompréhensible.
     *
     * @param {{type_couplage?: string}} bat entrée du catalogue batteries
     * @param {string} fabBatterie fabricant sous lequel elle est rangée
     * @param {{type: string, fabricant: string}|null} selection onduleur retenu
     */
    function batterieCompatibleAvecOnduleur(bat, fabBatterie, selection) {
        if (!selection || !selection.type) return true;
        // Variateur de pompage : pas de batterie raccordée -> aucun filtre.
        if (selection.type === TYPE_VARIATEUR_POMPAGE) return true;
        const couplage = (bat && bat.type_couplage) || null;
        // Régulateur de charge : charge une batterie en courant continu, tous fabricants.
        if (selection.type === TYPE_REGULATEUR_CHARGE) return couplage === 'DC';
        if (selection.type === TYPE_ONDULEUR_HYBRIDE) {
            return couplage === 'DC' && memeFabricant(fabBatterie, selection.fabricant);
        }
        return couplage === 'AC';
    }

    /**
     * Publie la batterie retenue (ou son retrait) sur le pont partagé avec le modal de stockage
     * (batterieSelection.js). Le catalogue fournit les champs absents de l'entrée d'affichage —
     * dont les tensions système par phase, qui décident de la tension retenue selon l'onduleur.
     */
    function publierBatterieVersStockage(batterie) {
        if (!window.BatterieSelection) return;
        if (!batterie) {
            window.BatterieSelection.publier(null);
            return;
        }
        const dbMatch = (window.batteryCatalogFromApi || [])
            .find((b) => b.reference === batterie.ref) || null;
        const onduleurData = (window.__chainesPertesGlobal
            && window.__chainesPertesGlobal.onduleur
            && window.__chainesPertesGlobal.onduleur.data) || null;
        // Batterie « Générique » (personnalisable) : modifiable dans le modal de stockage même si
        // elle figure au catalogue (cf. bd_batteries.js::estBatteriePersonnalisable).
        const estPersonnalisable = typeof window.estBatteriePersonnalisable === 'function'
            && window.estBatteriePersonnalisable(batterie.fabricant || (dbMatch && dbMatch.fabricant));
        window.BatterieSelection.publier(
            window.BatterieSelection.normaliser(batterie, dbMatch, { onduleurData, estGenerique: !dbMatch || estPersonnalisable })
        );
    }

    function setupEquipmentCatalogPickers() {
        const panelSelect = CM.modalBody.querySelector('#cmPanelCatalogSelect');
        const onduleurSelect = CM.modalBody.querySelector('#cmOnduleurCatalogSelect');
        const batterySelect = CM.modalBody.querySelector('#cmBatteryCatalogSelect');
        const siSelect = CM.modalBody.querySelector('#cmSystemeIntegrationSelect');

        // Catalogue par type de structure (calepinage_maison_systemes_integration.js, chargé avant ce
        // fichier) : la liste suit le type de structure du champ, et ce que le choix applique
        // (Espacement X/Y, Largeur rail, ou le nom seul) dépend de ce type — cf. REGLES.
        if (siSelect) {
            if (typeof CM.remplirSelectSystemes === 'function') CM.remplirSelectSystemes(siSelect, CM.state);
            siSelect.addEventListener('change', (e) => {
                if (typeof CM.appliquerSystemeIntegration !== 'function') return;
                CM.appliquerSystemeIntegration(CM.state, e.target.value);
                updateEquipmentFieldsUI();
                CM.render();
                CM.recomputeResults();
            });
        }
        const siInfoBtn = CM.modalBody.querySelector('#cmSystemeIntegrationInfoBtn');
        if (siInfoBtn) {
            // Fenêtre posée sur document.body : un clic rejoué depuis le clone PRO (modal fermé,
            // CM.state basculé sur le champ de l'onglet) l'affiche aussi.
            siInfoBtn.addEventListener('click', () => {
                if (typeof CM.afficherDonneesSystemes === 'function') CM.afficherDonneesSystemes();
            });
        }

        // CORRECTIF (bug rapporté : "impossible de choisir un panneau en résidentiel", cause racine
        // identifiée — la table panneaux était vide/l'appel API pouvait échouer sans qu'aucun repli
        // ne prévienne l'utilisateur, contrairement au Pro/Grand-projet dont le modal Favoris a des
        // lignes codées en dur) : si le catalogue est vide (BD vide OU appel échoué), afficher une
        // option désactivée explicite au lieu de laisser le menu déroulant silencieusement vide avec
        // seulement son option placeholder.
        const populatePanelSelect = () => {
            const catalog = window.panelCatalogFromApi || [];
            if (!catalog.length) {
                panelSelect.innerHTML = '<option value="">Sélectionner dans le catalogue…</option>'
                    + '<option value="" disabled>Catalogue panneaux indisponible — contactez le support</option>';
                return;
            }
            panelSelect.innerHTML = '<option value="">Sélectionner dans le catalogue…</option>' +
                catalog.map((p, i) => `<option value="${i}">${p.fabricant || ''} ${p.reference || ''} — ${p.puissance_wc != null ? p.puissance_wc : '?'} Wc</option>`).join('');
            CM.restorePanelSelection();
        };
        // CORRECTIF (bug rapporté : le panneau choisi dans les formulaires PRO/Résidentiel est perdu
        // au rechargement et à la réouverture du projet) : CM.state.panelRef est bien enregistré avec
        // la maison, mais la liste ci-dessus est reconstruite sans jamais être repositionnée sur lui —
        // elle revenait sur « Sélectionner dans le catalogue… » (et le clone du formulaire PRO,
        // recopié depuis cette liste, aussi). Même correctif que restoreOnduleurSelection ; repli en
        // suffixe pour les références héritées préfixées deux fois par la marque (cf.
        // chaines_pertes_modal.js::resolvePanelFromCatalog).
        CM.restorePanelSelection = () => {
            const ref = CM.state.panelRef;
            if (!ref) { panelSelect.value = ''; return; }
            const catalog = window.panelCatalogFromApi || [];
            let idx = catalog.findIndex((p) => p.reference === ref);
            if (idx === -1) idx = catalog.findIndex((p) => p.reference && ref.endsWith(p.reference));
            panelSelect.value = idx === -1 ? '' : String(idx);
        };
        populatePanelSelect();
        // Catalogue arrivé après la 1re synchronisation des onglets PRO : leurs listes clonées sont
        // réalignées sur le panneau enregistré de chaque champ (cf. afficherMaterielsDepuisEtat).
        const apresCatalogue = () => {
            populatePanelSelect();
            if (window.CalepinageMaisonFormPro && typeof window.CalepinageMaisonFormPro.synchroniserTous === 'function') {
                window.CalepinageMaisonFormPro.synchroniserTous();
            }
        };
        if (typeof window.fetchPanelCatalog === 'function') {
            window.fetchPanelCatalog().then(apresCatalogue).catch(apresCatalogue);
        }
        panelSelect.addEventListener('change', (e) => {
            if (!e.target.value) return;
            const p = (window.panelCatalogFromApi || [])[parseInt(e.target.value, 10)];
            if (!p) return;
            // CORRECTIF (bug rapporté : « Référence panneau "Longi Longi LR7-54HVH" introuvable
            // dans le catalogue BD », bloquant le Câblage DC) : p.reference contient déjà la marque
            // (ex. "Longi LR7-54HVH") — la concaténer avec p.fabricant doublait le nom de marque,
            // et la chaîne résultante ne correspondait plus jamais à aucune entrée du catalogue lors
            // du lookup strict `p.reference === field.panelReference` (chaines_pertes_modal.js::
            // computeFieldChainSizing). Même pattern déjà correct utilisé pour batteryRef plus bas
            // et pour referencePanneau dans bd_panneaux_pv.js : stocker p.reference seul.
            CM.state.panelRef = p.reference || '';
            CM.state.panelPowerWc = parseFloat(p.puissance_wc) || CM.state.panelPowerWc;
            if (p.longueur_mm) CM.state.panelLengthMm = parseFloat(p.longueur_mm) || CM.state.panelLengthMm;
            if (p.largeur_mm) CM.state.panelWidthMm = parseFloat(p.largeur_mm) || CM.state.panelWidthMm;
            if (p.epaisseur_mm) CM.state.panelThicknessMm = parseFloat(p.epaisseur_mm) || CM.state.panelThicknessMm;
            updateEquipmentFieldsUI();
            CM.modalBody.querySelector('#cmPanelLength').value = CM.state.panelLengthMm;
            CM.modalBody.querySelector('#cmPanelWidth').value = CM.state.panelWidthMm;
            CM.modalBody.querySelector('#cmPanelThickness').value = CM.state.panelThicknessMm;
            CM.render();
            CM.recomputeResults();
        });

        // NOUVEAU (demande explicite : "champ Fabricant après Onduleur, pour filtrer et avoir le
        // modèle d'un fabricant") : options générées dynamiquement depuis window.inverterDB, jamais
        // codées en dur — un futur ajout de fabricant à la BD onduleurs apparaît donc automatiquement.
        const onduleurFabricantSelect = CM.modalBody.querySelector('#cmOnduleurFabricantSelect');
        const populateOnduleurFabricantSelect = () => {
            if (!onduleurFabricantSelect) return;
            const db = window.inverterDB || {};
            const currentValue = onduleurFabricantSelect.value;
            let html = '<option value="">Fabricant</option>';
            Object.keys(db)
                // Projet hors réseau : « Générique hors réseau » seul ; projet raccordé : absent
                // (cf. onduleurs_hors_reseau.js).
                .filter((fab) => !window.OnduleursHorsReseau
                    || window.OnduleursHorsReseau.fabricantVisible(fab, CM.state.onduleurRef))
                .forEach((fab) => { html += `<option value="${fab}">${fab}</option>`; });
            onduleurFabricantSelect.innerHTML = html;
            // Conserve la sélection en cours (ex. après un rafraîchissement du catalogue en tâche de
            // fond) plutôt que de revenir silencieusement sur "Fabricant" (tous) à chaque appel.
            if (Array.from(onduleurFabricantSelect.options).some((o) => o.value === currentValue)) {
                onduleurFabricantSelect.value = currentValue;
            }
        };
        // NOUVEAU (demande explicite : "Type de connexion onduleur ... permettra de faire le filtre
        // pour un projet connecté au réseau et off-grid") : 2e filtre, même mécanique que le filtre
        // Fabricant — combinés (ET logique), tous deux optionnels.
        const onduleurConnexionSelect = CM.modalBody.querySelector('#cmOnduleurConnexionSelect');
        const populateOnduleurSelect = () => {
            const db = window.inverterDB || {};
            const fabFilter = onduleurFabricantSelect ? onduleurFabricantSelect.value : '';
            const connexionFilter = onduleurConnexionSelect ? onduleurConnexionSelect.value : '';
            let html = '<option value="">Sélectionner dans le catalogue…</option>';
            Object.entries(db).forEach(([fab, list]) => {
                if (fabFilter && fab !== fabFilter) return;
                // NOUVEAU (demande explicite : "afficher la puissance des onduleurs par ordre
                // croissant pour chaque fabricant") : tri sur la puissance AFFICHÉE (kVA), à
                // l'intérieur de chaque fabricant, l'ordre des fabricants restant celui du
                // catalogue. L'index d'origine est conservé dans la valeur de l'option : c'est lui
                // qui sert à retrouver l'entrée dans window.inverterDB au moment du choix, il ne
                // doit surtout pas suivre le nouvel ordre d'affichage.
                (list || [])
                    .map((ond, i) => ({ ond, i }))
                    .filter(({ ond }) => !(connexionFilter && ond.type_connexion !== connexionFilter))
                    // Projet hors réseau : appareils hors réseau seulement ; projet raccordé :
                    // appareils génériques hors réseau masqués (cf. onduleurs_hors_reseau.js).
                    .filter(({ ond }) => !window.OnduleursHorsReseau
                        || window.OnduleursHorsReseau.visibleDansListe(fab, ond, CM.state.onduleurRef))
                    .sort((a, b) => (parseFloat(a.ond.power) || 0) - (parseFloat(b.ond.power) || 0))
                    .forEach(({ ond, i }) => {
                        html += `<option value="${fab}|${i}">${fab} ${ond.ref} — ${ond.power} kVA</option>`;
                    });
            });
            onduleurSelect.innerHTML = html;
        };
        populateOnduleurFabricantSelect();
        populateOnduleurSelect();
        if (onduleurFabricantSelect) {
            onduleurFabricantSelect.addEventListener('change', () => {
                populateOnduleurSelect();
            });
        }
        if (onduleurConnexionSelect) {
            onduleurConnexionSelect.addEventListener('change', () => {
                populateOnduleurSelect();
            });
        }
        // CORRECTIF (bug rapporté : "en choisissant un onduleur et en actualisant la page, on ne le
        // retrouve plus") : populateOnduleurSelect() reconstruit inconditionnellement le <select>
        // (toujours "Sélectionner dans le catalogue…" au départ) et rien ne le repositionnait
        // ensuite sur l'entrée déjà choisie — contrairement à panelRef/batteryRef, aucune référence
        // n'était même stockée pour le retrouver. CM.state.onduleurRef (ci-dessous) + cette fonction
        // de restauration comblent les deux manques, appelée ici (juste après la reconstruction du
        // <select>) et depuis updateEquipmentFieldsUI() (à chaque ouverture/changement de maison).
        CM.restoreOnduleurSelection = () => {
            if (!CM.state.onduleurRef) { onduleurSelect.value = ''; return; }
            const db = window.inverterDB || {};
            for (const [fab, list] of Object.entries(db)) {
                const idx = (list || []).findIndex((o) => o.ref === CM.state.onduleurRef);
                if (idx !== -1) { onduleurSelect.value = `${fab}|${idx}`; return; }
            }
        };
        CM.restoreOnduleurSelection();
        onduleurSelect.addEventListener('change', (e) => {
            if (!e.target.value) return;
            const [fab, idxStr] = e.target.value.split('|');
            const list = (window.inverterDB && window.inverterDB[fab]) || [];
            const ond = list[parseInt(idxStr, 10)];
            if (!ond) return;
            CM.state.onduleurRef = ond.ref;
            CM.state.onduleurPuissanceKva = parseFloat(ond.power) || 0;
            CM.state.onduleurRendement = parseFloat(ond.rendement) || 0;
            CM.state.onduleurConso = parseFloat(ond.conso) || 0;
            // Type d'onduleur (colonne "Technologie" du catalogue, ramenée à 3 catégories) :
            // mémorisé avec la maison pour rester affiché même si le catalogue tarde à répondre.
            CM.state.onduleurTechnologie = normaliserTypeOnduleur(ond.technologie, ond.hybride);
            // Le jeu de batteries proposées dépend de ce type : reconstruit immédiatement.
            if (typeof CM.populateBatterySelect === 'function') CM.populateBatterySelect();
            // NOUVEAU (demande explicite) : un changement d'onduleur peut rendre l'optimiseur
            // précédemment choisi incompatible — jamais conservé silencieusement dans ce cas (filtre
            // strict, cf. updateOptimiseurCardVisibility/populateOptimiseurSelect).
            const stillCompatible = (window.optimiseurCatalogFromApi || [])
                .some((o) => o.reference === CM.state.optimiseurRef && (o.compatible_onduleurs || []).some((c) => c.reference === ond.ref));
            if (!stillCompatible) CM.state.optimiseurRef = null;
            updateEquipmentFieldsUI();
            if (window.OnduleursHorsReseau) window.OnduleursHorsReseau.surChoixOnduleur(fab, ond);
            CM.recomputeResults();
        });
        // Section « Architecture élec. système PV » des projets Site autonome (modale des caractéristiques),
        // insérée sous « Type d'onduleur » (onduleurs_hors_reseau.js).
        if (window.OnduleursHorsReseau) {
            window.OnduleursHorsReseau.monterDansFormulaire(CM, { populateOnduleurSelect });
        }

        // NOUVEAU (demande explicite) : une batterie n'est proposée que si elle peut réellement se
        // raccorder à l'onduleur retenu.
        //   - onduleur HYBRIDE : la batterie se raccorde en courant continu sur l'onduleur lui-même,
        //     donc couplage DC ET même fabricant que l'onduleur (les bus DC propriétaires ne sont pas
        //     interopérables entre marques) ;
        //   - onduleur de chaîne ou micro-onduleur : la batterie se raccorde côté alternatif, donc
        //     couplage AC, tous fabricants confondus.
        // Tant qu'aucun onduleur n'est choisi, aucun filtre n'est appliqué (rien ne permet de
        // trancher, et masquer tout le catalogue serait incompréhensible).
        const populateBatterySelect = () => {
            const db = window.batteryDB || {};
            const selection = getOnduleurSelectionne();
            let html = '<option value="">Aucune</option>';
            let proposees = 0;
            // Catalogue masqué pour l'instant (bd_batteries.js::BATTERIE_PERSONNALISABLE_SEULE) : seule
            // la batterie personnalisable est proposée, et toujours proposée — ses caractéristiques
            // (dont le couplage) se règlent dans le modal de stockage, le filtre onduleur ne s'y
            // applique donc pas (sinon la liste serait vide avec un onduleur hybride).
            const visible = (fab) => typeof window.batterieVisibleDansListes !== 'function' || window.batterieVisibleDansListes(fab);
            const personnalisable = (fab) => typeof window.estBatteriePersonnalisable === 'function' && window.estBatteriePersonnalisable(fab);
            Object.entries(db).forEach(([fab, list]) => {
                // Tri par capacité croissante à l'intérieur de chaque fabricant, même principe que
                // pour les onduleurs (index d'origine conservé dans la valeur de l'option).
                (list || [])
                    .map((bat, i) => ({ bat, i }))
                    // Une batterie masquée déjà retenue par un projet enregistré reste proposée pour
                    // ce projet : sinon elle serait effacée en silence à la réouverture.
                    .filter(({ bat }) => visible(fab) || (CM.state.batteryRef && bat.ref === CM.state.batteryRef))
                    .filter(({ bat }) => (window.BATTERIE_PERSONNALISABLE_SEULE && personnalisable(fab))
                        || batterieCompatibleAvecOnduleur(bat, fab, selection))
                    .sort((a, b) => (parseFloat(a.bat.capacite) || 0) - (parseFloat(b.bat.capacite) || 0))
                    .forEach(({ bat, i }) => {
                        const label = fab === 'Générique' ? bat.ref : `${fab} ${bat.ref}`;
                        html += `<option value="${fab}|${i}">${label} — ${bat.capacite} kWh</option>`;
                        proposees += 1;
                    });
            });
            if (selection && selection.type && !proposees) {
                // Explicite plutôt que silencieusement vide : sinon l'utilisateur croit à un bug.
                const raison = selection.type === TYPE_ONDULEUR_HYBRIDE
                    ? `Aucune batterie à couplage DC ${selection.fabricant} au catalogue`
                    : 'Aucune batterie à couplage AC au catalogue';
                html += `<option value="" disabled>${raison}</option>`;
            }
            batterySelect.innerHTML = html;

            // Une batterie devenue incompatible (changement d'onduleur) n'est jamais conservée
            // silencieusement — même règle que pour l'optimiseur, cf. le gestionnaire de
            // #cmOnduleurCatalogSelect plus haut.
            if (CM.state.batteryRef) {
                const encoreProposee = Array.from(batterySelect.options).some((o) => {
                    if (!o.value) return false;
                    const [f, idx] = o.value.split('|');
                    const b = ((window.batteryDB || {})[f] || [])[parseInt(idx, 10)];
                    return b && b.ref === CM.state.batteryRef;
                });
                if (!encoreProposee) {
                    CM.state.batteryRef = '';
                    CM.state.batteryCapaciteKwh = 0;
                }
            }
            CM.restoreBatterySelection();
        };

        // Repositionne le <select> sur la batterie retenue (même besoin que
        // restoreOnduleurSelection : le <select> est reconstruit à chaque filtrage).
        CM.restoreBatterySelection = () => {
            if (!CM.state.batteryRef) { batterySelect.value = ''; return; }
            const db = window.batteryDB || {};
            for (const [fab, list] of Object.entries(db)) {
                const idx = (list || []).findIndex((b) => b.ref === CM.state.batteryRef);
                if (idx !== -1) {
                    const valeur = `${fab}|${idx}`;
                    if (Array.from(batterySelect.options).some((o) => o.value === valeur)) {
                        batterySelect.value = valeur;
                    }
                    return;
                }
            }
        };
        CM.populateBatterySelect = populateBatterySelect;
        populateBatterySelect();
        batterySelect.addEventListener('change', (e) => {
            let batterieRetenue = null;
            if (!e.target.value) {
                CM.state.batteryRef = '';
                CM.state.batteryCapaciteKwh = 0;
            } else {
                const [fab, idxStr] = e.target.value.split('|');
                const list = (window.batteryDB && window.batteryDB[fab]) || [];
                const bat = list[parseInt(idxStr, 10)];
                if (!bat) return;
                CM.state.batteryRef = bat.ref;
                CM.state.batteryCapaciteKwh = parseFloat(bat.capacite) || 0;
                batterieRetenue = bat;
            }
            // NOUVEAU (demande explicite) : publie la sélection vers le modal de stockage. Ce point
            // d'entrée résidentiel n'émettait RIEN jusqu'ici — contrairement au calepinage PRO, qui
            // diffusait déjà `pvEquipementSelected` — de sorte qu'une batterie choisie ici restait
            // inconnue du reste de l'application.
            publierBatterieVersStockage(batterieRetenue);
            updateEquipmentFieldsUI();
            CM.recomputeResults();
        });
    }

    function updateOrientationUI() {
        const pBtn = CM.modalBody.querySelector('#cmOrientationPortrait');
        const lBtn = CM.modalBody.querySelector('#cmOrientationPaysage');
        if (!pBtn || !lBtn) return;
        pBtn.style.background = CM.state.panelOrientation === 'portrait' ? '#dc2626' : '#f5f5f5';
        pBtn.style.color = CM.state.panelOrientation === 'portrait' ? '#fff' : '#333';
        lBtn.style.background = CM.state.panelOrientation === 'paysage' ? '#dc2626' : '#f5f5f5';
        lBtn.style.color = CM.state.panelOrientation === 'paysage' ? '#fff' : '#333';
    }

    // Désactive la case "Sheds réguliers" (au lieu de la laisser cochable sans effet) tant que ses
    // préconditions ne sont pas réunies — même règle côté calcul, cf. computeCandidatePanelSlots()
    // (calepinage_maison_calculs.js), pour qu'un état déjà coché ne produise jamais d'effet si les
    // préconditions cessent d'être remplies après coup.
    function updateShedRegularAvailability() {
        if (!CM.modalBody) return;
        const checkbox = CM.modalBody.querySelector('#calepinageMaisonShedRegularCheckbox');
        const label = CM.modalBody.querySelector('#calepinageMaisonShedRegularLabel');
        const hint = CM.modalBody.querySelector('#calepinageMaisonShedRegularHint');
        if (!checkbox) return;
        // CORRECTIF (demande explicite, remplace les règles précédentes) : l'option ne s'applique
        // que si "Esp. groupe de shed (mm)" > 0 ET "Nb. PV en long. par shed" > 0 — règle unique
        // partagée avec le calcul (CM.shedRegulierApplicable, calepinage_maison_calculs.js). Elle
        // n'est plus neutralisée sur un polygone libre : c'est justement là que des tables tronquées
        // par le contour apparaissent. La case n'est plus décochée d'office : seulement inopérante.
        const ready = CM.shedRegulierApplicable(CM.state);
        checkbox.disabled = !ready;
        if (label) label.style.opacity = ready ? '1' : '0.5';
        if (hint) {
            hint.style.display = ready ? 'none' : 'block';
            hint.textContent = 'Réglez "Nb. PV en long. par shed" et "Esp. groupe de shed" à plus de 0 pour activer cette option.';
        }
    }

    /**
     * NOUVEAU (demande explicite : « ajouter un bouton pour inverser le faîtage ») : rejoue la
     * division ACTIVE après un changement d'axe de faîtage — aucune règle nouvelle, ce sont les
     * mêmes fonctions que les boutons de la section (elles relisent CM.state.ridgeAxisSwapped via
     * ridgeAxisDir(), calepinage_maison_calculs.js).
     *
     * "4 pans (croupe)" : la longueur du faîtage n'est PAS dans l'état (saisie relue dans le DOM par
     * son propre bouton, même convention reprise ici). Monopente : rien à refaire, il n'a pas de
     * faîtage.
     */
    function reappliquerDivisionCourante() {
        if (!CM.state) return;
        const mode = CM.state.divisionMode;
        if (mode === '2pans') {
            if (CM.state.lastTwoPanKind === 'asym') CM.divideInto2PansAsymmetric();
            else CM.divideInto2PansSymmetric();
        } else if (mode === '4pans') {
            const input = CM.modalBody && CM.modalBody.querySelector('#calepinageMaisonRidgeWidthInput');
            const mm = Number(CM.state.croupeRidgeWidthMm) > 0 ? Number(CM.state.croupeRidgeWidthMm) : (parseFloat(input && input.value) || 0);
            CM.divideInto4Pans(mm / 1000);
        } else if (mode === '4panssym') {
            CM.divideInto4PansSymmetric();
        }
    }

    /**
     * Bouton « Inverser le faîtage » : visible seulement sur une toiture divisée, allumé quand l'axe
     * est inversé. Style INLINE (et non une classe) : c'est ce que le clone du formulaire PRO
     * recopie (recopierDepuisOrigine, calepinage_maison_form_pro.js).
     */
    function updateInverserFaitageUI() {
        const btn = CM.modalBody && CM.modalBody.querySelector('#calepinageMaisonInverserFaitageBtn');
        if (!btn || !CM.state) return;
        btn.style.display = CM.state.divisionMode === 'none' ? 'none' : '';
        const actif = !!CM.state.ridgeAxisSwapped;
        btn.style.background = actif ? '#dc2626' : '#f5f5f5';
        btn.style.color = actif ? '#fff' : '#333';
    }

    /** Seuil de surface de panneaux (m²) au-delà duquel la toiture terrasse demande une séparation. */
    const SEUIL_SEPARATION_TERRASSE_M2 = 300;

    /**
     * Messages de la section "Système d'intégration", calculés depuis les panneaux posés de
     * CM.state : règle du type de structure, longueur du champ et nombre de joints de dilatation,
     * rappel de séparation physique en toiture terrasse (> 300 m² de panneaux). Les trois ids se
     * terminent par "Hint" : le clone PRO en recopie le texte (TEXTES_DYNAMIQUES, form_pro.js).
     */
    function majInfosSystemeIntegration() {
        if (!CM.modalBody || !CM.state) return;
        const tm = CM.normalizeTypeMontage(CM.state.typeMontage);
        // Liste et valeurs de la section remises sur CM.state : la synchronisation PRO ne rejoue
        // que updatePoseModeUI (pas updateEquipmentFieldsUI) pour le champ de chaque onglet.
        const siSelect = CM.modalBody.querySelector('#cmSystemeIntegrationSelect');
        if (siSelect && typeof CM.remplirSelectSystemes === 'function') CM.remplirSelectSystemes(siSelect, CM.state);
        [['cmPanelSpacingX', 'panelSpacingXMm'], ['cmPanelSpacingY', 'panelSpacingYMm'], ['cmRailWidth', 'railWidthMm'],
            ['cmJointDilatation', 'jointDilatationMm'], ['cmJointDilatationLimite', 'jointDilatationLimiteM'],
            ['cmTerrasseSeparation', 'terrasseSeparationMm']].forEach(([id, cle]) => {
            const el = CM.modalBody.querySelector('#' + id);
            if (el && document.activeElement !== el && CM.state[cle] !== undefined) el.value = CM.state[cle];
        });
        const jointSurLimite = CM.modalBody.querySelector('#cmJointDilatationSurLimite');
        if (jointSurLimite) jointSurLimite.checked = CM.state.jointDilatationRepartition === 'limite';
        const siHint = CM.modalBody.querySelector('#cmSystemeIntegrationHint');
        if (siHint) {
            const regle = typeof CM.regleSystemes === 'function' ? CM.regleSystemes(CM.state.typeMontage) : null;
            siHint.textContent = (regle && regle.message) || '';
            // Rappel masqué pour tout type de projet (demande explicite : « Toiture terrasse : seul
            // le nom du système est retenu… ») ; texte tenu à jour, réaffichable ici.
            siHint.style.display = 'none';
        }

        const avecJoints = CM.jointsDilatationApplicables(CM.state);
        const estTerrasse = tm === 'toiture_terrasse';
        const grilles = (avecJoints || estTerrasse)
            ? (CM.state.pans || []).map((pan) => CM.mesurerGrillePan(pan, CM.state)).filter(Boolean) : [];

        const jointHint = CM.modalBody.querySelector('#cmJointDilatationHint');
        if (jointHint) {
            let texte = '';
            if (avecJoints && grilles.length) {
                const plusLongue = grilles.reduce((a, g) => (g.longueurM > a.longueurM ? g : a), grilles[0]);
                const n = plusLongue.nbJointsDilatation || 0;
                // Ombrières : la largeur d'un rail s'ajoute à la longueur du champ (panneaux +
                // espacements + joints), comme dans dimensionsOmbriere et le configurateur.
                const railM = tm.indexOf('ombriere') === 0 ? (Number(CM.state.railWidthMm) || 0) / 1000 : 0;
                texte = `Longueur du champ PV : ${(plusLongue.longueurM + railM).toFixed(2)} m — `
                    + (n ? `${n} joint${n > 1 ? 's' : ''} de dilatation` : 'aucun joint (longueur limite non atteinte)');
            }
            jointHint.textContent = texte;
        }

        const terrasseWrapper = CM.modalBody.querySelector('#cmTerrasseSeparationWrapper');
        if (terrasseWrapper) terrasseWrapper.style.display = estTerrasse ? 'block' : 'none';
        const terrasseHint = CM.modalBody.querySelector('#cmTerrasseSeparationHint');
        if (terrasseHint) {
            const surface = estTerrasse ? grilles.reduce((s, g) => s + (g.surfacePanneauxM2 || 0), 0) : 0;
            const nbSeparations = estTerrasse ? grilles.reduce((n, g) => n + (g.nbJointsDilatation || 0), 0) : 0;
            const afficher = surface > SEUIL_SEPARATION_TERRASSE_M2 || nbSeparations > 0;
            const separation = estTerrasse ? CM.paramsJointDilatation(CM.state, null) : null;
            const largeurMm = separation ? Math.round(separation.largeurM * 1000) : 0;
            terrasseHint.textContent = !afficher ? ''
                : nbSeparations > 0
                    ? `Surface du champ PV : ${Math.round(surface)} m² — ${nbSeparations} séparation${nbSeparations > 1 ? 's' : ''} `
                        + `physique${nbSeparations > 1 ? 's' : ''} de ${largeurMm} mm intégrée${nbSeparations > 1 ? 's' : ''} `
                        + `(sections de ${SEUIL_SEPARATION_TERRASSE_M2} m² au plus).`
                    // Pose en shed / dôme : pas de séparation automatique, rappel seulement.
                    : `Surface du champ PV : ${Math.round(surface)} m² (> ${SEUIL_SEPARATION_TERRASSE_M2} m²). `
                        + 'Incluez une séparation physique du champ PV.';
            terrasseHint.style.display = afficher ? 'block' : 'none';
        }
    }

    function updatePoseModeUI() {
        if (!CM.modalBody) return;

        // NOUVEAU (demande explicite : "lier le type de structure supportant les panneaux aux
        // boutons de type de calepinage disponibles") : n'affiche que les modes pertinents pour le
        // typeMontage courant (cf. CM.getAllowedPoseModes, calepinage_maison_calculs.js). Si le mode
        // actif n'est plus autorisé (ex. maison existante en 'toiture_terrasse' avec poseMode
        // 'incline' hérité), bascule silencieusement sur le 1er mode autorisé — par MUTATION DIRECTE
        // de l'état (pas setPoseMode(), qui rappellerait cette même fonction) : le reste de la
        // fonction, plus bas, applique déjà la mise à jour visuelle sur cette valeur corrigée.
        const allowedPoseModes = CM.getAllowedPoseModes(CM.normalizeTypeMontage(CM.state.typeMontage));
        if (!allowedPoseModes.includes(CM.state.poseMode)) {
            CM.state.poseMode = allowedPoseModes[0];
            CM.state.pans.forEach((p) => { p.poseMode = allowedPoseModes[0]; });
        }
        ['incline', 'plat', 'shed', 'dome'].forEach((m) => {
            const btn = CM.modalBody.querySelector(`#calepinageMaisonPose_${m}`);
            if (btn) btn.style.display = allowedPoseModes.includes(m) ? '' : 'none';
        });

        const mode = CM.state.poseMode;
        ['incline', 'plat', 'shed', 'dome'].forEach((m) => {
            const btn = CM.modalBody.querySelector(`#calepinageMaisonPose_${m}`);
            if (btn) {
                btn.style.background = m === mode ? '#dc2626' : '#f5f5f5';
                btn.style.color = m === mode ? '#fff' : '#333';
            }
        });
        const shedSpacingWrapper = CM.modalBody.querySelector('#calepinageMaisonShedSpacingWrapper');
        if (shedSpacingWrapper) shedSpacingWrapper.style.display = mode === 'shed' ? 'block' : 'none';
        const shedGroupWrapper = CM.modalBody.querySelector('#calepinageMaisonShedGroupWrapper');
        if (shedGroupWrapper) shedGroupWrapper.style.display = mode === 'shed' ? 'block' : 'none';
        const shedPanelsPerRowWrapper = CM.modalBody.querySelector('#calepinageMaisonShedPanelsPerRowWrapper');
        if (shedPanelsPerRowWrapper) shedPanelsPerRowWrapper.style.display = mode === 'shed' ? 'block' : 'none';
        const shedRowGroupSpacingWrapper = CM.modalBody.querySelector('#calepinageMaisonShedRowGroupSpacingWrapper');
        if (shedRowGroupSpacingWrapper) shedRowGroupSpacingWrapper.style.display = mode === 'shed' ? 'block' : 'none';
        const domeWrapper = CM.modalBody.querySelector('#calepinageMaisonDomeWrapper');
        if (domeWrapper) domeWrapper.style.display = mode === 'dome' ? 'block' : 'none';
        // CORRECTIF (bug rapporté : "Sheds réguliers supprime tous les panneaux") : recentré sur le
        // mode 'shed' uniquement — le dôme n'a pas de notion de "module" (shedGroupSize y vaut
        // toujours 1, cf. calepinage_maison_calculs.js), le filtre y était donc un no-op silencieux
        // ; case retirée du mode dôme pour ne pas laisser croire qu'elle y fait quelque chose.
        const shedRegularWrapper = CM.modalBody.querySelector('#calepinageMaisonShedRegularWrapper');
        if (shedRegularWrapper) shedRegularWrapper.style.display = mode === 'shed' ? 'block' : 'none';
        updateShedRegularAvailability();
        // CORRECTIF (demande explicite : suspicion "le calcul est faussé pour le dôme aussi") : le
        // champ générique "Pente de la toiture (°)" (CM.state.penteDeg) n'a AUCUN effet en mode
        // dôme (seul CM.state.domeTiltDeg, réglé juste en dessous via domeWrapper ci-dessus,
        // compte — cf. getEffectiveInclinaisonDeg()/getEffectivePanelDims()) : le laisser visible et
        // modifiable prêtait à confusion (l'utilisateur croit régler l'inclinaison du dôme via ce
        // champ, sans effet). Masqué en mode dôme, comme les champs shed le sont déjà hors mode shed.
        const penteWrapper = CM.modalBody.querySelector('#calepinageMaisonPenteWrapper');
        if (penteWrapper) penteWrapper.style.display = mode === 'dome' ? 'none' : '';

        const showInclineOnly = mode === 'incline';
        const tm = CM.normalizeTypeMontage(CM.state.typeMontage);
        const isToitureTerrasse = tm === 'toiture_terrasse';
        const isOmbriere = tm.indexOf('ombriere') === 0; // 'ombriere' / 'ombriere_metal' / 'ombriere_bois' / 'ombriere_solumbra'
        const isPetitChamp = tm === 'champ_solaire';

        // Ordre et affichage des boutons de calepinage pour Petit champ solaire : Shed en 1er, Dôme en 2e
        const btnShed = CM.modalBody.querySelector('#calepinageMaisonPose_shed');
        const btnDome = CM.modalBody.querySelector('#calepinageMaisonPose_dome');
        if (btnShed) btnShed.style.order = isPetitChamp ? '1' : '';
        if (btnDome) btnDome.style.order = isPetitChamp ? '2' : '';

        // Boutons d'action spécifiques Petit Champ Solaire sous Portrait/Paysage
        const pcActionsWrapper = CM.modalBody.querySelector('#cmPetitChampActionsWrapper');
        if (pcActionsWrapper) pcActionsWrapper.style.display = isPetitChamp ? 'flex' : 'none';

        // "Largeur rail" (demande explicite) : n'a de sens que pour une ombrière — c'est le delta X
        // ajouté à la longueur transmise aux plans de coupe/façade (cf.
        // calepinage_maison_dimensions_ombriere.js).
        const railWidthWrapper = CM.modalBody.querySelector('#cmRailWidthWrapper');
        if (railWidthWrapper) railWidthWrapper.style.display = isOmbriere ? 'block' : 'none';
        // Joints de dilatation : ombrières métal / bois / Solumbra et bâtiment incliné.
        const jointWrapper = CM.modalBody.querySelector('#cmJointDilatationWrapper');
        if (jointWrapper) jointWrapper.style.display = CM.jointsDilatationApplicables(CM.state) ? 'block' : 'none';
        majInfosSystemeIntegration();
        // "Géométrie de la toiture" active :
        const is2PansAsym = CM.state.divisionMode === '2pans' && CM.state.lastTwoPanKind === 'asym';
        const isCroupe4Pans = CM.state.divisionMode === '4pans';

        // --- Boutons "Géométrie de la toiture" (options de division) ---
        // Monopente + "2 pans (Symétrique)" : masqués pour Petit champ solaire (demande explicite).
        const monopenteBtn = CM.modalBody.querySelector('#calepinageMaisonMonopenteBtn');
        if (monopenteBtn) monopenteBtn.style.display = isPetitChamp ? 'none' : '';
        const pans2SymBtn = CM.modalBody.querySelector('#calepinageMaison2PansSymBtn');
        if (pans2SymBtn) pans2SymBtn.style.display = isPetitChamp ? 'none' : '';

        // "2 pans (Asymétrique)" : mode incliné, jamais pour Ombrière ni Petit champ solaire.
        const asymBtn = CM.modalBody.querySelector('#calepinageMaison2PansAsymBtn');
        if (asymBtn) asymBtn.style.display = (showInclineOnly && !isOmbriere && !isPetitChamp) ? '' : 'none';
        // "4 pans (croupe)" : mode incliné OU Toiture terrasse (croupe basse pente) ; jamais Ombrière ni Petit champ solaire.
        const croupeBtn = CM.modalBody.querySelector('#calepinageMaison4PansBtn');
        if (croupeBtn) croupeBtn.style.display = (((showInclineOnly || isToitureTerrasse) && !isOmbriere) && !isPetitChamp) ? '' : 'none';
        // "4 pans (Symétrique)" : jamais pour Ombrière ni Petit champ solaire (demande explicite).
        const pansSymBtn = CM.modalBody.querySelector('#calepinageMaison4PansSymBtn');
        if (pansSymBtn) pansSymBtn.style.display = (isOmbriere || isPetitChamp) ? 'none' : '';
        // "Inverser le faîtage" : n'a de sens que sur une toiture DIVISÉE (un Monopente n'a pas de
        // faîtage — son orientation se règle avec "Tourner l'azimut", barre d'outils).
        updateInverserFaitageUI();

        // --- Champs dépendant de la géométrie / du type de structure ---
        // Porte-à-faux rampant/longpan : mode incliné, hors Toiture terrasse, hors Ombrière
        // (demande explicite : masqués pour Type de structure = Ombrière).
        ['calepinageMaisonOverhangRampantWrapper', 'calepinageMaisonOverhangLongpanWrapper'].forEach((id) => {
            const el = CM.modalBody.querySelector(`#${id}`);
            if (el) el.style.display = (showInclineOnly && !isToitureTerrasse && !isOmbriere) ? '' : 'none';
        });
        // "Hauteur acrotère" : uniquement Toiture terrasse.
        const acrotereWrapper = CM.modalBody.querySelector('#calepinageMaisonAcrotereWrapper');
        if (acrotereWrapper) acrotereWrapper.style.display = isToitureTerrasse ? '' : 'none';
        // "Asymétrie (% Pan 1)", "Type de faîtage (2 pans asymétrique, 3D)", "Pente toiture 2" :
        // UNIQUEMENT si la géométrie active est "2 pans asymétrique" (demande explicite).
        const asymWrapper = CM.modalBody.querySelector('#calepinageMaisonAsymmetryWrapper');
        if (asymWrapper) asymWrapper.style.display = is2PansAsym ? '' : 'none';
        const faitageAsymWrapper = CM.modalBody.querySelector('#calepinageMaisonFaitageAsymWrapper');
        if (faitageAsymWrapper) faitageAsymWrapper.style.display = is2PansAsym ? '' : 'none';
        const pente2Wrapper = CM.modalBody.querySelector('#calepinageMaisonPente2Wrapper');
        if (pente2Wrapper) pente2Wrapper.style.display = is2PansAsym ? '' : 'none';
        // "Largeur du faîtage (mm, 4 pans croupe)" : uniquement si 4 pans croupe actif.
        const ridgeWidthWrapper = CM.modalBody.querySelector('#calepinageMaisonRidgeWidthWrapper');
        if (ridgeWidthWrapper) ridgeWidthWrapper.style.display = isCroupe4Pans ? '' : 'none';
        // "Espacement bordure (mm)" : masqué pour Ombrière (demande explicite).
        const edgeClearanceWrapper = CM.modalBody.querySelector('#calepinageMaisonEdgeClearanceWrapper');
        if (edgeClearanceWrapper) edgeClearanceWrapper.style.display = isOmbriere ? 'none' : '';
        // "Entraxes poteaux" : n'a de sens que pour une ombrière (demande explicite). Le
        // place-holder rappelle l'entraxe automatique qui s'appliquera si le champ reste vide.
        const entraxeWrapper = CM.modalBody.querySelector('#calepinageMaisonOmbriereEntraxeWrapper');
        if (entraxeWrapper) entraxeWrapper.style.display = isOmbriere ? 'block' : 'none';
        if (isOmbriere) majPlaceholderEntraxeOmbriere();
        // Entraxes transversaux / excentrement / affichage des poteaux sur la carte (selon le modèle).
        if (typeof CM.majChampsPoteauxUI === 'function') CM.majChampsPoteauxUI();
        // "Modèle d'ombrière métal / bois" : visible selon le matériau choisi dans "Type de structure".
        const ombMetalW = CM.modalBody.querySelector('#calepinageMaisonOmbriereMetalModelWrapper');
        if (ombMetalW) ombMetalW.style.display = (tm === 'ombriere_metal') ? '' : 'none';
        const ombMetalVarW = CM.modalBody.querySelector('#calepinageMaisonOmbriereMetalVariantWrapper');
        if (ombMetalVarW) ombMetalVarW.style.display = (tm === 'ombriere_metal' && CM.state.ombriereMetalModel === 'double') ? '' : 'none';
        const ombBoisW = CM.modalBody.querySelector('#calepinageMaisonOmbriereBoisModelWrapper');
        if (ombBoisW) ombBoisW.style.display = (tm === 'ombriere_bois') ? '' : 'none';
        filtrerModelesOmbriere(); // modèles Y <-> "Diviser en 2 pans symétriques"
        // "Modèle de petit champ solaire" + "Hauteur bas structure" : visibles pour Type de structure
        // = "Petit champ solaire".
        const petitChampW = CM.modalBody.querySelector('#calepinageMaisonPetitChampModelWrapper');
        if (petitChampW) petitChampW.style.display = isPetitChamp ? '' : 'none';
        const petitChampVariantW = CM.modalBody.querySelector('#calepinageMaisonPetitChampVariantWrapper');
        if (petitChampVariantW) petitChampVariantW.style.display = (isPetitChamp && CM.state.petitChampModel === 'double') ? '' : 'none';
        // "Hauteur bas PV" : portée par le champ Hauteur bâtiment (cf. appliquerChampHauteurBasPv).
        appliquerChampHauteurBasPv();
        appliquerTitreGeometrie(); // "Géométrie de la toiture / de l'ombrière / de la table solaire"
        // "Largeur faîtage (mm)" (#calepinageMaisonRidgeClearanceInput) — demande explicite :
        //  - hors Ombrière : visible, libellé "Largeur faîtage (mm)" ;
        //  - Ombrière bipente (2 pans) : visible, libellé "Largeur faîtage / Noue (mm)" ;
        //  - Ombrière monopente / Petit champ solaire : masqué.
        const ridgeClearanceWrapper = CM.modalBody.querySelector('#calepinageMaisonRidgeClearanceWrapper');
        const ridgeClearanceLabel = CM.modalBody.querySelector('#calepinageMaisonRidgeClearanceLabel');
        if (ridgeClearanceWrapper) {
            const isBipente = CM.state.divisionMode === '2pans';
            const show = (!isOmbriere || isBipente) && !isPetitChamp;
            ridgeClearanceWrapper.style.display = show ? '' : 'none';
            if (ridgeClearanceLabel) {
                ridgeClearanceLabel.textContent = (isOmbriere && isBipente)
                    ? 'Largeur faîtage / Noue (mm)' : 'Largeur faîtage (mm)';
            }
        }
    }

    /**
     * "Tourner l'azimut de 90°" (Sud → Ouest → Nord → Est → Sud) sur le champ PV courant (CM.state).
     *
     * EXTRAIT du gestionnaire de #cmFlipAzimuthBtn (demande explicite : "remplacer le bouton
     * d'azimut de la carte par le bouton Tourner l'azimut de 90° de la modale multi-typologie") :
     * le bouton de la carte (GoogleMaps.js) doit déclencher exactement la même action, y compris
     * quand la modale est fermée — il bascule CM.state sur le champ sélectionné puis appelle cette
     * fonction. Aucune règle n'est dupliquée.
     *
     * Ne touche NI au canevas NI au DOM au-delà du champ d'azimut du polygone libre : c'est
     * l'appelant qui décide de redessiner (le bouton de la carte n'a pas forcément de canevas).
     * @returns {boolean} false si la rotation n'est pas applicable (toiture divisée).
     */
    function tournerAzimut90() {
        if (!CM.state || CM.state.divisionMode !== 'none' || (CM.state.pans || []).length !== 1) return false;
        let refAngle;
        if (CM.state.contourMode === 'polygon') {
            let newAz = (CM.state.polygonAzimuthDeg || 0) + 90;
            if (newAz > 180) newAz -= 360;
            CM.state.polygonAzimuthDeg = newAz;
            if (CM.polygonAzimuthInput) CM.polygonAzimuthInput.value = newAz;
            refAngle = CM.angleForAzimuth(newAz);
        } else {
            CM.state.rectAzimuthOffsetDeg = ((CM.state.rectAzimuthOffsetDeg || 0) + 90) % 360;
            refAngle = CM.angleReferenceStable(CM.state);
        }
        CM.state.pans.forEach((pan) => CM.applyReferenceAngleToPan(pan, refAngle));
        CM.render();
        CM.recomputeResults();
        return true;
    }

    function setPoseMode(mode) {
        CM.state.poseMode = mode;
        CM.state.pans.forEach((p) => { p.poseMode = mode; });
        updatePoseModeUI();
        CM.render();
        CM.recomputeResults();
    }

    // NOUVEAU (demande explicite : "valider les données d'entrée du champ calepinage... rejeter toute
    // valeur hors des plages limites avec un message") : ce formulaire n'avait jusqu'ici AUCUN helper
    // de validation générique (contrairement à window.ChainesPertesValidation utilisé par le modal
    // "Chaînes et pertes") — chaque champ faisait son propre clampage SILENCIEUX
    // (Math.max(min, Math.min(max, ...))), de façon incohérente (bornes hautes manquantes sur
    // plusieurs champs). Remplace ce pattern partout dans ce fichier : une valeur hors plage est
    // REJETÉE (jamais propagée à CM.state, jamais corrigée en silence) et affiche un message sous le
    // champ, jusqu'à correction par l'utilisateur.
    // `unitDivisor` : certains champs sont saisis dans une unité (mm) différente de celle stockée en
    // interne dans CM.state (toujours le mètre) — la valeur passée à `onValid` est déjà divisée.
    // `options` peut être une FONCTION renvoyant { min, max, ... } : bornes relues à chaque saisie,
    // pour un champ dont la signification dépend du type de structure (cf. Hauteur bâtiment / bas PV).
    function wireCmValidatedInput(inputId, errorId, options, onValid) {
        const input = CM.modalBody.querySelector(`#${inputId}`);
        const errorEl = errorId ? CM.modalBody.querySelector(`#${errorId}`) : null;
        if (!input) return;
        input.addEventListener('input', () => {
            const { min, max, integer, pair, label, unitDivisor = 1 } = (typeof options === 'function') ? options() : options;
            const raw = String(input.value).trim().replace(',', '.');
            const parsed = parseFloat(raw);
            let message = null;
            if (raw === '' || isNaN(parsed)) message = `${label} : valeur numérique requise.`;
            else if (integer && !Number.isInteger(parsed)) message = `${label} : doit être un nombre entier.`;
            else if (parsed < min || parsed > max) message = `${label} : doit être compris entre ${min} et ${max}.`;
            else if (pair && parsed % 2 !== 0) message = `${label} : doit être un nombre pair (${min}, ${min + 2} ... ${max}).`;
            input.style.borderColor = message ? '#dc3545' : '';
            if (errorEl) { errorEl.style.display = message ? 'block' : 'none'; errorEl.textContent = message || ''; }
            if (message) return;
            onValid(parsed / unitDivisor);
        });
    }

    // NOUVEAU (demande explicite : "remplacer les boutons textuels du menu par des boutons avec
    // icônes SVG optimisées, avec tooltips/textes descriptifs compacts") : génère le HTML d'un bouton
    // de #cmToolbar à partir d'une entrée de CalepinageMaisonToolbarConfig — icône seule (SVG ou
    // Font Awesome selon `iconType`) + `title` natif (tooltip). L'`id` et le comportement au clic
    // restent ceux déjà câblés ailleurs (calepinage_maison_dessin.js/orchestrateur.js) — cette
    // fonction ne fait QUE générer le HTML, jamais le câblage.
    function cmToolbarButtonHTML(btn) {
        const icon = btn.iconType === 'fa'
            ? `<i class="fas ${btn.icon}"></i>`
            : `<img src="/static/concevoir_mon_projet/medias/icons/${btn.icon}.svg" alt="" style="width:18px; height:18px; vertical-align:middle;">`;
        const extraStyle = btn.style ? ` ${btn.style}` : '';
        const disabledAttr = btn.disabled ? ' disabled' : '';
        return `<button id="${btn.id}" class="cm-btn cm-icon-btn" type="button" title="${btn.tooltip}" style="flex-shrink:0;${extraStyle}"${disabledAttr}>${icon}</button>`;
    }

    // NOUVEAU : sous-menu "Obstacles" — un seul déclencheur (icône obstacle.svg) qui bascule
    // l'affichage d'un panneau popup listant les 7 types d'obstacles, chacun icôné + tooltip. Reste
    // ouvert jusqu'au re-clic sur le déclencheur (cf. wireObstaclesMenuToggle ci-dessous) — même
    // principe que ButtonControl.js::toggleMatElecMenu/togglePolygoneAperMenu (calepinage
    // grand-projet), réimplémenté ici pour rester découplé (même isolation que le reste de ce
    // dossier). `data-obstacle-type` + le glissé-déposé (calepinage_maison_dessin.js::
    // setupPaletteDrag(), générique sur CM.modalBody.querySelectorAll('[data-obstacle-type]'))
    // restent strictement inchangés.
    function cmObstaclesMenuHTML() {
        const cfg = window.CalepinageMaisonToolbarConfig;
        if (!cfg) return '';
        const items = cfg.obstacles.items.map((it) => `
            <div data-obstacle-type="${it.type}" class="cm-obstacle-item" title="${it.label}">
                <img src="/static/concevoir_mon_projet/medias/icons/${it.icon}.svg" alt="${it.label}" style="width:18px; height:18px;">
            </div>
        `).join('');
        return `
            <div style="position:relative; flex-shrink:0;">
                <button id="${cfg.obstacles.triggerId}" class="cm-btn cm-icon-btn" type="button" title="${cfg.obstacles.triggerTooltip}" style="flex-shrink:0;">
                    <img src="/static/concevoir_mon_projet/medias/icons/${cfg.obstacles.triggerIcon}.svg" alt="" style="width:18px; height:18px; vertical-align:middle;">
                </button>
                <div id="cmObstaclesMenuPopup" style="display:none; position:absolute; top:38px; left:0; background:#fff; border:1px solid #e5e7eb; border-radius:6px; box-shadow:0 4px 14px rgba(0,0,0,0.15); padding:8px; gap:6px; z-index:1001;">
                    ${items}
                </div>
            </div>
        `;
    }

    // NOUVEAU : contenu complet de #cmToolbar (sous-menu Obstacles + groupes de boutons, séparés par
    // le séparateur vertical déjà utilisé), généré depuis CalepinageMaisonToolbarConfig.groups.
    function cmToolbarInnerHTML() {
        const cfg = window.CalepinageMaisonToolbarConfig;
        if (!cfg) return '';
        // CORRECTIF (demande explicite : "utiliser une couleur rouge pour séparation de groupe de
        // label") : séparateur gris -> rouge, cohérent avec le thème de l'app.
        const sep = '<span style="width:1px; align-self:stretch; background:#dc2626; flex-shrink:0;"></span>';
        const groupsHTML = cfg.groups.map((g) => g.buttons.map(cmToolbarButtonHTML).join('')).join(sep);
        // Matériels électriques + marqueur de coordonnées (calepinage_maison_annotations.js).
        const annotationsHTML = typeof CM.annotationsToolbarHTML === 'function' ? CM.annotationsToolbarHTML() : '';
        return `${cmObstaclesMenuHTML()}${annotationsHTML}${sep}${groupsHTML}`;
    }

    // NOUVEAU : bascule le popup du sous-menu Obstacles — reste ouvert jusqu'au re-clic sur le
    // déclencheur (aucune fermeture automatique au clic extérieur, demande explicite).
    function wireObstaclesMenuToggle() {
        const cfg = window.CalepinageMaisonToolbarConfig;
        if (!cfg) return;
        const trigger = CM.modalBody.querySelector(`#${cfg.obstacles.triggerId}`);
        const popup = CM.modalBody.querySelector('#cmObstaclesMenuPopup');
        if (!trigger || !popup) return;
        trigger.addEventListener('click', () => {
            popup.style.display = popup.style.display === 'none' ? 'flex' : 'none';
        });
    }

    // NOUVEAU (demande explicite : "placer 2 icônes pour Afficher les panneaux / Afficher le fond de
    // carte dans le menu horizontal") : #cmToggleShowPanelsBtn/#cmToggleShowBackgroundBtn pilotent
    // CM.state.showPanels/showBackgroundImage — les checkboxes d'origine restent dans le DOM (cachées,
    // cf. createModal()) pour ne rien casser du câblage existant ailleurs (orchestrateur.js,
    // calepinage_maison_dessin.js::captureMapView, qui lisent/écrivent encore leur .checked) : ces
    // boutons se contentent de garder la checkbox correspondante synchronisée en plus de CM.state.
    function wireVisibilityToggleButtons() {
        const panelsBtn = CM.modalBody.querySelector('#cmToggleShowPanelsBtn');
        const bgBtn = CM.modalBody.querySelector('#cmToggleShowBackgroundBtn');
        if (panelsBtn) {
            panelsBtn.addEventListener('click', () => {
                CM.state.showPanels = !CM.state.showPanels;
                const cb = CM.modalBody.querySelector('#calepinageMaisonShowPanelsCheckbox');
                if (cb) cb.checked = CM.state.showPanels;
                CM.updateVisibilityToggleButtonsUI();
                CM.render();
            });
        }
        if (bgBtn) {
            bgBtn.addEventListener('click', () => {
                CM.state.showBackgroundImage = !CM.state.showBackgroundImage;
                const cb = CM.modalBody.querySelector('#calepinageMaisonShowBackgroundCheckbox');
                if (cb) cb.checked = CM.state.showBackgroundImage;
                if (CM.previewImg.src) CM.previewImg.style.display = CM.state.showBackgroundImage ? 'block' : 'none';
                CM.updateVisibilityToggleButtonsUI();
                CM.render();
            });
        }
        // NOUVEAU (demande explicite : "remplacer le label Afficher la structure par une icône
        // dans le menu horizontal, après Détails structure") : même motif que panelsBtn/bgBtn
        // ci-dessus — pilote directement CM.state.showStructure, plus de checkbox à synchroniser.
        const structureBtn = CM.modalBody.querySelector('#cmToggleShowStructureBtn');
        if (structureBtn) {
            structureBtn.addEventListener('click', () => {
                CM.state.showStructure = !CM.state.showStructure;
                CM.updateVisibilityToggleButtonsUI();
                CM.render();
            });
        }
        // NOUVEAU (demande explicite) : masquer uniquement les cotations — même motif que structureBtn.
        const cotationsBtn = CM.modalBody.querySelector('#cmToggleShowCotationsBtn');
        if (cotationsBtn) {
            cotationsBtn.addEventListener('click', () => {
                CM.state.showCotations = CM.state.showCotations === false;
                CM.updateVisibilityToggleButtonsUI();
                CM.render();
                // Plan de coupe ouvert : sa cote du rampant suit le même réglage.
                if (CM.coupeModal && CM.coupeModal.style.display !== 'none') CM.renderCoupe();
            });
        }
        CM.updateVisibilityToggleButtonsUI();
    }

    // Exposé sur CM : appelé aussi depuis calepinage_maison_orchestrateur.js (synchronisation à
    // l'ouverture/changement de maison) et calepinage_maison_dessin.js::captureMapView() (coche
    // automatique de "fond de carte" après une capture), qui modifient CM.state.showPanels/
    // showBackgroundImage sans passer par un clic sur ces boutons.
    CM.updateVisibilityToggleButtonsUI = function updateVisibilityToggleButtonsUI() {
        if (!CM.modalBody) return;
        const panelsBtn = CM.modalBody.querySelector('#cmToggleShowPanelsBtn');
        const bgBtn = CM.modalBody.querySelector('#cmToggleShowBackgroundBtn');
        if (panelsBtn) {
            panelsBtn.style.background = CM.state.showPanels ? '#dc2626' : '#f5f5f5';
            panelsBtn.style.color = CM.state.showPanels ? '#fff' : '#333';
        }
        if (bgBtn) {
            bgBtn.style.background = CM.state.showBackgroundImage ? '#dc2626' : '#f5f5f5';
            bgBtn.style.color = CM.state.showBackgroundImage ? '#fff' : '#333';
        }
        const structureBtn = CM.modalBody.querySelector('#cmToggleShowStructureBtn');
        if (structureBtn) {
            structureBtn.style.background = CM.state.showStructure ? '#dc2626' : '#f5f5f5';
            structureBtn.style.color = CM.state.showStructure ? '#fff' : '#333';
        }
        const cotationsBtn = CM.modalBody.querySelector('#cmToggleShowCotationsBtn');
        if (cotationsBtn) {
            const visibles = CM.state.showCotations !== false;
            cotationsBtn.style.background = visibles ? '#dc2626' : '#f5f5f5';
            cotationsBtn.style.color = visibles ? '#fff' : '#333';
            cotationsBtn.setAttribute('aria-pressed', visibles ? 'true' : 'false');
            cotationsBtn.title = visibles ? 'Masquer les cotations' : 'Afficher les cotations';
        }
    };

    function createModal() {
        CM.backdrop = document.createElement('div');
        CM.backdrop.id = 'calepinageMaisonBackdrop';
        CM.backdrop.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background: transparent; pointer-events: none; z-index: 999997;';

        CM.modal = document.createElement('div');
        CM.modal.id = 'calepinageMaisonModal';
        // NOUVEAU (demande explicite : "agrandir le modal pour avoir la taille maximale de l'écran
        // tout en restant responsive") : plus de plafond fixe (max-width:1420px) — width/height en
        // calc(100v* - marge) occupent tout l'écran disponible sur n'importe quelle résolution, tout
        // en gardant une petite marge visible (8px) autour du modal.
        CM.modal.style.cssText = 'display:none; flex-direction:column; position:fixed; top:8px; left:8px; width:calc(100vw - 16px); max-width:calc(100vw - 16px); height:calc(100vh - 16px); max-height:calc(100vh - 16px); background:#ffffff; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.3); border:2px solid #dc2626; z-index:999998; overflow:hidden; font-family: sans-serif;';

        const header = document.createElement('div');
        header.className = 'modal-header-maison';
        // CORRECTIF (demande explicite : "réduire la largeur/hauteur de l'entête du modal, même
        // hauteur que l'entête du menu de l'application") : hauteur explicite calée sur celle de la
        // barre de menu principale (.demo-nav nav>ul { height:50px; } — cf. menu_list.css), au lieu
        // d'un padding vertical seul dont la hauteur réelle variait légèrement selon le rendu.
        header.style.cssText = 'background-color:#dc2626; color:white; height:50px; padding:0 20px; box-sizing:border-box; display:flex; justify-content:space-between; align-items:center; cursor:move; flex-shrink:0;';
        // NOUVEAU (demande explicite : "déplacer les toggles d'affichage dans l'en-tête persistant du
        // modal, sur une seule ligne") : ces 3 boutons restent visibles en permanence — contrairement
        // à #cmToolbar et #cmLeftPanel qu'ils pilotent, l'en-tête lui-même n'est jamais masquable.
        // Générés depuis CalepinageMaisonToolbarConfig.headerToggles (calepinage_maison_toolbar_
        // config.js) — câblage générique plus bas (recherche par CM.modal.querySelector).
        const headerTogglesHTML = (window.CalepinageMaisonToolbarConfig
            ? window.CalepinageMaisonToolbarConfig.headerToggles : []).map((t) => `
            <button id="${t.id}" class="cm-header-toggle-btn" type="button" title="${t.tooltip}"><i class="fas ${t.icon}"></i></button>
        `).join('');

        header.innerHTML = `
            <h2 style="margin:0; font-size:16px; font-weight:600; display:flex; align-items:center; gap:8px;">
                <img src="/static/concevoir_mon_projet/medias/icons/panneau-solaire.svg" alt="Calepinage multi typologie" style="height:20px; width:20px;"> Calepinage multi typologie
            </h2>
            <!-- Navigation (demande explicite) : mêmes étapes que le menu horizontal — Mes projets,
                 Paramètres projet, Consommation d'énergie (« Profil de consommation » en Site
                 autonome), Calepinage. Boutons générés par construireNavigationEntete(). -->
            <nav id="cmHeaderNav" aria-label="Navigation du projet" style="display:flex; align-items:center; gap:6px; margin:0 16px; flex:1 1 auto; min-width:0; overflow-x:auto; scrollbar-width:none;"></nav>
            <div style="display:flex; align-items:center; gap:10px;">
                <!-- Champs PV / images importées : un bouton par source (demande explicite : sélection sans
                     liste déroulante), placés à gauche des icônes d'affichage. Boutons générés par
                     orchestrateur::refreshSourceSelectOptions ; la liste déroulante reste dans le DOM, masquée,
                     pour le câblage existant. -->
                <div id="cmSourceButtons" role="tablist" aria-label="Champs PV" style="display:flex; align-items:center; gap:6px; max-width:45vw; overflow-x:auto; scrollbar-width:thin; padding:2px 0; margin-right:32px;"></div>
                <div id="cmHeaderToggles" style="display:flex; align-items:center; gap:14px; margin-right:12px;">${headerTogglesHTML}</div>
                <select id="calepinageMaisonSourceSelect" style="display:none;" title="Basculer entre les maisons tracées et les images importées"></select>
                <button id="closeCalepinageMaisonBtn" style="background:none; border:none; color:white; font-size:24px; cursor:pointer; line-height:1; padding:0;">&times;</button>
            </div>
        `;

        construireNavigationEntete(header);

        CM.modalBody = document.createElement('div');
        CM.modalBody.id = 'cmModalBody';
        CM.modalBody.style.cssText = 'display:flex; flex-direction:row; gap:16px; overflow:hidden; flex-grow:1; min-height:0; padding:16px 20px;';
        CM.modalBody.innerHTML = `
            <!-- NOUVEAU (demande explicite : "placer le formulaire à droite") : order:2 place ce
                 panneau après #cmRightPanel (order:1) visuellement, sans renommer les ids (utilisés
                 partout ailleurs dans ce fichier) ni changer l'ordre du DOM. Bordure/padding basculés
                 du côté gauche (au lieu de droite) puisque ce panneau est désormais adjacent au
                 canevas sur sa gauche plutôt que sur sa droite. -->
            <div id="cmLeftPanel" style="width:370px; flex-shrink:0; overflow-y:auto; padding-left:10px; border-left:1px solid #e5e7eb; order:2;">
                <!-- NOUVEAU (demande explicite) : reste TOUJOURS visible, en dehors des 3 sections
                     repliables ci-dessous. -->
                <!-- CORRECTIF (demande explicite : "utiliser le label Type de structure supportant
                     les panneaux pour cette liste déroulante et la placer avant Type de calepinage")
                     : #cmTypeMontageSelect déplacé ici depuis le <details> "Consommation d'énergie"
                     (où il vivait sous le label "Type de montage") — cf. wiring inchangé dans
                     updateEquipmentFieldsUI()/l'écouteur 'change', qui interrogent l'élément par son
                     id, indifférents à son emplacement dans le DOM. -->
                <!-- CORRECTIF (demande explicite : "Toiture résidentielle / Bâtiment incliné
                     (métal-bois) / Toiture terrasse / Ombrière / Champ solaire / Autres") :
                     "Ombrière, champ solaire" scindé en 2 options distinctes, "Toiture résidentielle"
                     ajoutée en tête (nouveau défaut, cf. createDefaultState() —
                     calepinage_maison_orchestrateur.js) — cf. TYPE_MONTAGE_VALUES/
                     TYPE_MONTAGE_LEGACY_MAP (calepinage_maison_calculs.js) pour la compatibilité
                     avec les projets déjà enregistrés sous l'ancienne valeur 'ombriere_champ'. -->
                <!-- NOUVEAU (demande explicite : « à la place de la liste déroulante, mettre des
                     boutons sélectionnables, 2 boutons par rangée ») : #cmTypeMontageBoutons est
                     rempli depuis les <option> par construireBoutonsTypeMontage(). Le <select>
                     reste dans le DOM, masqué : il demeure la seule porte d'entrée (écouteur
                     'change', synchronisation depuis l'état, formulaire PRO qui y rejoue son choix). -->
                <div style="margin-bottom:12px;">
                    <label class="cm-label">Type de structure supportant les panneaux</label>
                    <div id="cmTypeMontageBoutons" class="cm-boutons-2col" role="radiogroup" aria-label="Type de structure supportant les panneaux"></div>
                    <select id="cmTypeMontageSelect" class="cm-input" style="display:none; margin-bottom:0;" aria-hidden="true" tabindex="-1">
                        <!-- Ordre (demande explicite : « Ombrière métal en premier, à la place de
                             Bâtiment incliné ») : seul l'ordre des boutons change ; le défaut reste
                             'toiture_residentielle' (createDefaultState). En typologie Résidentielle,
                             l'ombrière est masquée : Toiture résidentielle y reste en tête. -->
                        <option value="ombriere_metal">Ombrière métal</option>
                        <option value="toiture_residentielle" selected>Toiture résidentielle</option>
                        <option value="toiture_terrasse">Toiture terrasse</option>
                        <!-- Ancienne valeur générique conservée (projets enregistrés avant la scission
                             par matériau) — masquée du menu mais sélectionnable programmatiquement. -->
                        <option value="ombriere" hidden>Ombrière</option>
                        <option value="toiture_inclinee">Bâtiment incliné (métal-bois)</option>
                        <option value="ombriere_bois">Ombrière bois</option>
                        <option value="ombriere_solumbra" disabled>Ombrière-Solumbra</option>
                        <option value="champ_solaire">Petit champ solaire</option>
                        <option value="mixte">Autres</option>
                    </select>
                </div>

                <!-- Modèle de petit champ solaire — mêmes options que test_3d.html. Visible quand
                     Type de structure = "Petit champ solaire". La 3D (calepinage shed) est générée à
                     partir de ce modèle ; modifiable aussi depuis la vue 3D (clic droit). -->
                <!-- id ajouté (demande explicite : "boutons de sélection des modèles de poteaux sous
                     Type de structure dans le formulaire PRO") : section CLONÉE dans
                     #cmProPetitChampModelHost par calepinage_maison_form_pro.js, qui y remplace les
                     deux <select> par des boutons. Les <select> restent la source unique. -->
                <div id="cmPetitChampModelSection">
                <div id="calepinageMaisonPetitChampModelWrapper" style="margin-bottom:12px; display:none;">
                    <label class="cm-label">Modèle de poteaux</label>
                    <select id="calepinageMaisonPetitChampModel" class="cm-input" style="margin-bottom:0;">
                        <option value="centre">Centrés</option>
                        <option value="excentre">Excentrés</option>
                        <option value="double">Double Poteaux</option>
                        <option value="bipente">Bipente</option>
                    </select>
                </div>
                <!-- Variante de contreventement du modèle "Double Poteaux" (mêmes variantes V1-V4 que le
                     configurateur 2D petit_champ_solaire.html). Visible seulement pour ce modèle. -->
                <div id="calepinageMaisonPetitChampVariantWrapper" style="margin-bottom:12px; display:none;">
                    <label class="cm-label">Variante Double Poteaux</label>
                    <select id="calepinageMaisonPetitChampVariant" class="cm-input" style="margin-bottom:0;">
                        <option value="v1">V1 - Barre de liaison + bracon</option>
                        <option value="v2">V2 - Sans contreventement</option>
                        <option value="v3">V3 - Bracon depuis le pied</option>
                        <option value="v4">V4 - Contreventement en W</option>
                    </select>
                </div>
                </div>
                <!-- Hauteur du point bas des panneaux du petit champ solaire (demande explicite :
                     « Hauteur bas PV (m) », défaut 0,5 m, bornes 0,3–5 m, mêmes que #lowPointHeight
                     du configurateur petit_champ_solaire.html et limites.json). MASQUÉ depuis que
                     #calepinageMaisonBatimentHeightInput porte cette valeur pour le petit champ
                     (cf. updatePoseModeUI) — gardé et synchronisé pour le modal 3D. -->
                <div id="calepinageMaisonPetitChampLowHeightWrapper" style="margin-bottom:12px; display:none;">
                    <label class="cm-label">Hauteur bas PV (m)</label>
                    <input id="calepinageMaisonPetitChampLowHeightInput" type="number" min="0.3" max="5" step="0.05" value="0.8" class="cm-input" />
                    <div id="calepinageMaisonPetitChampLowHeightInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                </div>

                <!-- id ajouté (demande explicite : ces deux sections sont REPRISES telles quelles
                     dans le formulaire PRO / Grand projet — cf. calepinage_maison_form_pro.js, qui
                     les clone par champ PV plutôt que de les redéclarer dans calepinage.html). -->
                <div id="calepinageMaisonPoseSection" style="margin-bottom:12px;">
                    <h4 class="cm-section-title">Type de calepinage</h4>
                    <div style="display:flex; gap:6px;">
                        <button id="calepinageMaisonPose_incline" class="cm-btn" style="flex:1;">Incliné</button>
                        <button id="calepinageMaisonPose_plat" class="cm-btn" style="flex:1;">À plat</button>
                        <button id="calepinageMaisonPose_shed" class="cm-btn" style="flex:1;">Shed</button>
                        <button id="calepinageMaisonPose_dome" class="cm-btn" style="flex:1;">Dôme</button>
                    </div>
                </div>

                <!-- NOUVEAU (demande explicite) : formulaire organisé en 3 sections repliables,
                     repliées par défaut — même pattern <details>/<summary> que calepinage.html
                     (.form-section-details), repris ici sous .cm-section-details pour que ce module
                     reste autonome (aucune dépendance sur le style de l'autre formulaire). -->
                <details id="calepinageMaisonGeometrieSection" class="cm-section-details">
                    <!-- Le libellé vit dans un <span> identifié (et non dans le <summary>) : il est
                         calculé selon le type de structure (cf. appliquerTitreGeometrie) et recopié tel
                         quel dans le clone du formulaire PRO (TEXTES_DYNAMIQUES,
                         calepinage_maison_form_pro.js). Écrire dans le <summary> lui-même effacerait
                         le chevron. -->
                    <summary><span id="calepinageMaisonGeometrieTitre">Géométrie de la toiture</span> <i class="fas fa-chevron-down"></i></summary>

                    <!-- DÉPLACÉ (demande explicite : « placer le champ Modèle d'ombrière métal à l'intérieur
                         du container Géométrie de l'ombrière » du formulaire PRO) : les deux listes vivent
                         désormais DANS cette section, que calepinage_maison_form_pro.js clone côté PRO —
                         mêmes libellés, mêmes options (filtrées par filtrerModelesOmbriere) que le modal
                         résidentiel et la fenêtre 3D (METAL_MODELS / BOIS_MODELS). -->
                    <!-- NOUVEAU (demande explicite) : modèle d'ombrière — mêmes options que le formulaire
                         3D (test_3d.html). Visible selon typeMontage (cf. updatePoseModeUI). La 3D est
                         générée à partir de ce modèle ; l'utilisateur peut aussi le changer depuis la vue
                         3D (clic droit -> fenêtre de personnalisation). -->
                    <div id="calepinageMaisonOmbriereMetalModelWrapper" style="margin-bottom:12px; display:none;">
                        <label class="cm-label">Modèle d'ombrière métal</label>
                        <select id="calepinageMaisonOmbriereMetalModel" class="cm-input" style="margin-bottom:0;">
                            <option value="single">Centrés</option>
                            <option value="offset">Excentrés</option>
                            <option value="double">Double Poteaux</option>
                            <option value="inclinedPost">Poteaux Inclinés</option>
                            <option value="linked">Centrés liaisonnés</option>
                            <option value="y_shape">Toiture Y</option>
                            <option value="doubleYShape">Double toiture Y</option>
                        </select>
                    </div>
                    <!-- Variante de contreventement du modèle métal « Double Poteaux » (demande explicite :
                         « faire apparaître les 6 variantes V1...V6 ») : mêmes variantes que la modale de
                         géométrie ombriere_metal.html (#bracing-variant-group) et la fenêtre 3D
                         (cmOmb_bracingVariantGroup). Visible seulement pour ce modèle. Affichée en
                         boutons dans le formulaire PRO (SELECTS_EN_BOUTONS, form_pro.js). -->
                    <div id="calepinageMaisonOmbriereMetalVariantWrapper" style="margin-bottom:12px; display:none;">
                        <label class="cm-label">Variante Double Poteaux</label>
                        <select id="calepinageMaisonOmbriereMetalVariant" class="cm-input" style="margin-bottom:0;">
                            <option value="v1">V1</option>
                            <option value="v2">V2</option>
                            <option value="v3">V3</option>
                            <option value="v4">V4</option>
                            <option value="v5">V5</option>
                            <option value="v6">V6</option>
                        </select>
                    </div>
                    <div id="calepinageMaisonOmbriereBoisModelWrapper" style="margin-bottom:12px; display:none;">
                        <label class="cm-label">Modèle d'ombrière bois</label>
                        <select id="calepinageMaisonOmbriereBoisModel" class="cm-input" style="margin-bottom:0;">
                            <option value="inclinedPost">Gd. Monopan</option>
                            <option value="y_shape">Est-Ouest</option>
                            <option value="double">2 poteaux (5m)</option>
                            <option value="simple_azelan">Azélan</option>
                            <option value="simple_travolta">Travolta</option>
                            <option value="simple_travolta_2">Travolta-2</option>
                        </select>
                    </div>

                    <!-- CORRECTIF (demande explicite : "masquer les labels Azimuts du contour /
                         Segment 1.../Segment 4...") : bloc masqué en entier (titre + liste des
                         segments + légende) plutôt que retiré du DOM — renderAzimuths() (formulaires.js)
                         continue de s'exécuter sans erreur, écrit simplement dans un conteneur caché ;
                         rien ailleurs ne relit son contenu ni sa visibilité (vérifié). -->
                    <div style="margin-bottom:12px; display:none;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                            <h4 class="cm-section-title" style="margin:0;">Azimuts du contour</h4>
                        </div>
                        <div id="calepinageMaisonAzimuths" style="display:flex; flex-wrap:wrap; gap:6px; font-size:0.85rem; margin-top:6px;"></div>
                        <p style="margin:6px 0 0 0; font-size:0.7rem; color:#6b7280;">Référentiel : Sud = 0°, Ouest = 90°, Est = -90°, Nord = ±180°.</p>
                    </div>

                    <div style="margin-bottom:12px;">
                        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
                            <button id="calepinageMaisonRidgeBtn" class="cm-btn">Tracer le faîtage</button>
                            <!-- NOUVEAU (demande explicite) : repasse en toiture Monopente (1 seul
                                 pan) depuis n'importe quelle division (Bipente/4 pans) — même effet
                                 que "Réinitialiser" (menu principal), libellé plus explicite ici, au
                                 même endroit que les autres choix de division. -->
                            <button id="calepinageMaisonMonopenteBtn" class="cm-btn">Monopente</button>
                            <button id="calepinageMaison2PansSymBtn" class="cm-btn">Diviser en 2 pans (Symétrique)</button>
                            <button id="calepinageMaison2PansAsymBtn" class="cm-btn">Diviser en 2 pans (Asymétrique)</button>
                            <button id="calepinageMaison4PansBtn" class="cm-btn">Diviser en 4 pans (croupe)</button>
                            <!-- NOUVEAU (demande explicite : "4 pans symétrique", faîtage ET noue au
                                 milieu — combinaison de 2 Bipente symétrique) : distinct de la croupe
                                 ci-dessus (1 faîtage central, arêtiers, jamais de noue) — cf.
                                 divideInto4PansSymmetric(), calepinage_maison_calculs.js. -->
                            <button id="calepinageMaison4PansSymBtn" class="cm-btn">Diviser en 4 pans (Symétrique)</button>
                            <!-- NOUVEAU (demande explicite : « ajouter un bouton pour inverser le
                                 faîtage... utiliser l'icône de rotation de la carte... placer l'icône
                                 à droite ») : même icône que le bouton « Tourner l'azimut » de la carte
                                 (GoogleMaps.js) et de la barre d'outils du modal
                                 (calepinage_maison_toolbar_config.js). La règle margin-left:auto le pousse
                                 à droite de cette rangée flex. L'état actif est rendu en style INLINE
                                 (comme les boutons de mode de pose) pour que le clone du formulaire
                                 PRO le recopie tel quel (recopierDepuisOrigine,
                                 calepinage_maison_form_pro.js). -->
                            <button id="calepinageMaisonInverserFaitageBtn" type="button" class="cm-btn cm-icon-btn" style="margin-left:auto;" title="Inverser le faîtage : le tracer sur l'autre axe du rectangle (la largeur du pan change, le calepinage est refait)"><img src="/static/concevoir_mon_projet/medias/icons/rotate-right.svg" alt="" style="width:16px; height:16px;"></button>
                        </div>
                        <div id="calepinageMaisonAsymmetryWrapper" style="margin-bottom:8px;">
                            <label class="cm-label" style="margin:0; white-space:nowrap;" title="Part de la toiture occupée par le pan 1 (%)">Asymétrie (% pan 1)</label>
                            <input id="calepinageMaisonAsymmetryInput" type="number" min="10" max="80" value="40" class="cm-input" style="max-width:80px;" />
                            <div id="calepinageMaisonAsymmetryInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                        <!-- NOUVEAU (demande explicite) : type de faîtage pour une toiture 2 pans
                             ASYMÉTRIQUE — effet sur le modèle 3D uniquement (cf.
                             calepinage_maison_3d_geometry.js). "Sans ouverture" (défaut) = V inversé ;
                             "Avec ouverture" = partie verticale au faîtage (bâtiments bois). -->
                        <div id="calepinageMaisonFaitageAsymWrapper" style="margin-bottom:8px;">
                            <label class="cm-label" title="Type de faîtage d'une toiture 2 pans asymétrique — effet sur le modèle 3D uniquement">Type de faîtage (3D)</label>
                            <select id="calepinageMaisonFaitageAsymType" class="cm-input" style="max-width:220px;">
                                <option value="sans">Sans ouverture (V inversé)</option>
                                <option value="avec">Avec ouverture (faîtage vertical)</option>
                            </select>
                        </div>
                        <!-- CORRECTIF (demande explicite : "placer le champ de saisie en dessous du
                             label, pas à côté") : empilé verticalement au lieu d'aligné en ligne.
                             Visible UNIQUEMENT quand "4 pans (croupe)" est sélectionné (cf. updatePoseModeUI). -->
                        <div id="calepinageMaisonRidgeWidthWrapper" style="margin-bottom:8px; display:none;">
                            <label class="cm-label" title="Largeur du faîtage, toiture 4 pans en croupe (mm)">Largeur faîtage croupe (mm)</label>
                            <input id="calepinageMaisonRidgeWidthInput" type="number" min="1" value="2000" class="cm-input" style="max-width:100px;" />
                            <div id="calepinageMaisonRidgeWidthInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                        <!-- RETIRÉ (demande explicite) : label + case "Afficher la structure
                             (pannes/chevrons/liteaux/rails)" — remplacés par l'icône
                             #cmToggleShowStructureBtn dans le menu horizontal, juste après "Détails
                             structure" (cf. calepinage_maison_toolbar_config.js), wiring dans
                             wireVisibilityToggleButtons() ci-dessous. -->
                    </div>

                    <div id="calepinageMaisonContourDimsWrapper" style="margin-bottom:12px; display:none;">
                        <h4 class="cm-section-title">Dimensions du contour (rectangle)</h4>
                        <div style="display:flex; gap:8px;">
                            <div style="flex:1;">
                                <label class="cm-label">Longueur (m)</label>
                                <input id="calepinageMaisonContourLengthInput" type="number" min="0.1" max="500" step="0.01" class="cm-input" />
                                <div id="calepinageMaisonContourLengthInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div style="flex:1;">
                                <label class="cm-label">Largeur (m)</label>
                                <input id="calepinageMaisonContourWidthInput" type="number" min="0.1" max="500" step="0.01" class="cm-input" />
                                <div id="calepinageMaisonContourWidthInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                        </div>
                    </div>

                    <!-- NOUVEAU (demande explicite : "champ azimut pour faire la rotation des
                         panneaux dans le cas du polygone libre") : visible uniquement en polygone
                         libre, Monopente (même restriction que "Changer l'azimut" ci-dessus, avec
                         lequel ce champ partage le rôle : ce dernier bascule ±180° une orientation
                         déjà dérivée, ce champ en choisit une arbitraire) — cf. updateContourDimsUI(). -->
                    <div id="calepinageMaisonPolygonAzimuthWrapper" style="margin-bottom:12px; display:none;">
                        <label class="cm-label" title="Sud = 0°, Ouest = 90°, Est = -90°, Nord = ±180°">Azimut des panneaux (°)</label>
                        <input id="calepinageMaisonPolygonAzimuthInput" type="number" min="-180" max="180" step="1" value="0" class="cm-input" />
                    </div>

                    <div style="margin-bottom:12px;">
                        <h4 class="cm-section-title">Mesures de la toiture</h4>
                        <!-- Demande explicite : "disposer les champs de la géométrie de toiture par 2 sur
                             une même ligne horizontale pour raccourcir la section". Grille à 2 colonnes au
                             lieu d'une colonne unique. Les champs qui ne tiennent pas en demi-largeur
                             (groupe de dôme, case à cocher, expression d'entraxes) portent .cm-pleine-ligne.
                             Les bascules style.display='block'/'none' de updatePoseModeUI restent valables :
                             un élément "block" reste un élément de grille. -->
                        <div class="cm-grille2">
                            <!-- CORRECTIF (demande explicite : "mettre les unités en mm pour éviter
                                 des confusions") : cm -> mm (CM.state.overhangRampant/overhangLongpan
                                 restent en mètres en interne, cf. calepinage_maison_calculs.js — seul
                                 le facteur de conversion à la saisie change, /100 -> /1000). -->
                            <div id="calepinageMaisonOverhangRampantWrapper">
                                <label class="cm-label" title="Porte-à-faux dans le rampant (mm)">P-à-f rampant (mm)</label>
                                <input id="calepinageMaisonOverhangRampant" type="number" min="0" max="5000" value="0" class="cm-input" />
                                <div id="calepinageMaisonOverhangRampantError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="calepinageMaisonOverhangLongpanWrapper">
                                <label class="cm-label" title="Porte-à-faux en long-pan (mm)">P-à-f longpan (mm)</label>
                                <input id="calepinageMaisonOverhangLongpan" type="number" min="0" max="5000" value="0" class="cm-input" />
                                <div id="calepinageMaisonOverhangLongpanError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <!-- NOUVEAU (demande explicite) : hauteur d'acrotère (garde-corps
                                 périphérique d'une toiture terrasse). Visible UNIQUEMENT si Type de
                                 structure = "Toiture terrasse" (cf. updatePoseModeUI). Pris en compte
                                 dans le modèle 3D (calepinage_maison_3d_geometry.js). -->
                            <div id="calepinageMaisonAcrotereWrapper" style="display:none;">
                                <label class="cm-label">Hauteur acrotère (m)</label>
                                <input id="calepinageMaisonAcrotereInput" type="number" min="0" max="5" step="0.05" value="1" class="cm-input" />
                                <div id="calepinageMaisonAcrotereInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <!-- Pente toiture 1 (CM.state.penteDeg, s'applique à toute la toiture) et
                                 Pente toiture 2 (CM.state.penteDeg2, seulement le 2e pan d'une toiture
                                 2 pans ASYMÉTRIQUE) — sur la même ligne (demande explicite). -->
                            <div id="calepinageMaisonPenteWrapper">
                                <label class="cm-label">Pente toiture 1 (°)</label>
                                <input id="calepinageMaisonPenteInput" type="number" min="0" max="90" value="15" class="cm-input" />
                                <div id="calepinageMaisonPenteInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="calepinageMaisonPente2Wrapper">
                                <label class="cm-label">Pente toiture 2 (°)</label>
                                <input id="calepinageMaisonPente2Input" type="number" min="0" max="90" value="25" class="cm-input" />
                                <div id="calepinageMaisonPente2InputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <!-- NOUVEAU (demande explicite, génération 3D) : hauteur sol -> gouttière
                                 (bas de pente). CM.state.batimentHeightM en mètres. Sert au module 3D
                                 (calepinage_maison_3d_geometry.js) — le faîtage est calculé au-dessus
                                 selon la pente.
                                 Petit champ solaire (demande explicite) : même champ (id conservé),
                                 libellé « Hauteur bas PV (m) », valeur = CM.state.petitChampLowPointHeightM,
                                 bornes 0,3–5 m — cf. appliquerChampHauteurBasPv(). -->
                            <div id="calepinageMaisonBatimentHeightWrapper">
                                <label id="calepinageMaisonBatimentHeightLabel" class="cm-label">Hauteur bâtiment (m, sol → gouttière)</label>
                                <input id="calepinageMaisonBatimentHeightInput" type="number" min="0.2" max="25" step="0.1" value="3" class="cm-input" />
                                <div id="calepinageMaisonBatimentHeightError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="calepinageMaisonShedSpacingWrapper" style="display:none;">
                                <!-- CORRECTIF (demande explicite : "mettre l'unité de ces champs en
                                     mm") : uniformise avec les autres champs d'espacement du
                                     formulaire (Esp. X/Y panneaux, Esp. groupe de shed, Espacement
                                     dôme...), tous en mm — valeur par défaut inchangée (2.5 m =
                                     2500 mm), seule la conversion vers CM.state.shedSpacingM
                                     (toujours en mètres en interne) change en conséquence, cf.
                                     l'écouteur 'input' plus bas. -->
                                <label class="cm-label">Esp. entre sheds (mm)</label>
                                <input id="calepinageMaisonShedSpacingInput" type="number" min="300" max="10000" step="50" value="2500" class="cm-input" />
                                <div id="calepinageMaisonShedSpacingInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="calepinageMaisonShedGroupWrapper" style="display:none;">
                                <label class="cm-label">Nb. PV par shed</label>
                                <input id="calepinageMaisonShedGroupInput" type="number" min="1" max="15" step="1" value="2" class="cm-input" />
                                <div id="calepinageMaisonShedGroupInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="calepinageMaisonShedPanelsPerRowWrapper" style="display:none;">
                                <label class="cm-label">Nb. PV en long. par shed</label>
                                <input id="calepinageMaisonShedPanelsPerRowInput" type="number" min="0" max="50" step="1" value="0" class="cm-input" />
                                <div id="calepinageMaisonShedPanelsPerRowInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="calepinageMaisonShedRowGroupSpacingWrapper" style="display:none;">
                                <label class="cm-label">Esp. groupe de shed (mm)</label>
                                <input id="calepinageMaisonShedRowGroupSpacingInput" type="number" min="0" max="2000" step="10" value="0" class="cm-input" />
                                <div id="calepinageMaisonShedRowGroupSpacingInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <!-- NOUVEAU (demande explicite : "ajouter un bouton pour afficher des
                                 shed réguliers", inspiré de la case "Sheds réguliers" du calepinage
                                 Pro/Grand-projet) : décochée par défaut (remplissage maximal) —
                                 cochée, ne garde que les tables COMPLÈTES : exactement "Nb. PV par
                                 shed" panneaux en largeur x "Nb. PV en long. par shed" en longueur
                                 (cf. computeCandidatePanelSlots, calepinage_maison_calculs.js). -->
                            <div id="calepinageMaisonShedRegularWrapper" class="cm-pleine-ligne" style="display:none;">
                                <label id="calepinageMaisonShedRegularLabel" style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:#374151; cursor:pointer;">
                                    <input id="calepinageMaisonShedRegularCheckbox" type="checkbox" style="width:auto; height:auto;" />
                                    Sheds réguliers
                                </label>
                                <!-- Règle d'activation : "Esp. groupe de shed (mm)" > 0 et "Nb. PV en
                                     long. par shed" > 0 (cf. CM.shedRegulierApplicable). -->
                                <div id="calepinageMaisonShedRegularHint" style="display:none; font-size:0.7rem; color:#b45309; margin-top:2px;">
                                    Réglez "Nb. PV en long. par shed" et "Esp. groupe de shed" à plus de 0 pour activer cette option.
                                </div>
                            </div>
                            <div id="calepinageMaisonDomeWrapper" class="cm-pleine-ligne" style="display:none;">
                                <div>
                                    <label class="cm-label">Esp. entre dômes (mm)</label>
                                    <input id="calepinageMaisonDomeSpacingInput" type="number" min="0" max="10000" value="20" class="cm-input" />
                                    <div id="calepinageMaisonDomeSpacingInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                                </div>
                                <div>
                                    <label class="cm-label" title="Espacement entre les 2 panneaux d'un même dôme (mm)">Esp. panneaux du dôme (mm)</label>
                                    <!-- CORRECTIF (demande explicite) : valeur par défaut 30 -> 20mm. -->
                                    <input id="calepinageMaisonDomePanelSpacingInput" type="number" min="10" max="300" value="20" class="cm-input" />
                                    <div id="calepinageMaisonDomePanelSpacingInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                                </div>
                                <div>
                                    <label class="cm-label">Inclinaison dôme (°)</label>
                                    <input id="calepinageMaisonDomeTiltInput" type="number" min="0" max="50" value="10" class="cm-input" />
                                    <div id="calepinageMaisonDomeTiltInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                                </div>
                                <div>
                                    <label class="cm-label" title="Nombre de panneaux d'une rangée de dôme, la moitié de chaque côté : 2, 4, 6, 8, 10, 12 ou 14">Nb. PV par rangée de dôme</label>
                                    <input id="calepinageMaisonDomePanelsPerRowInput" type="number" min="2" max="14" step="2" value="2" class="cm-input" />
                                    <div id="calepinageMaisonDomePanelsPerRowInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                                </div>
                            </div>
                            <div id="calepinageMaisonEdgeClearanceWrapper">
                                <!-- CORRECTIF (demande explicite : "mettre l'unité de ces champs en
                                     mm") : défaut 250 mm (900 mm en toiture terrasse, cf. CM.edgeClearanceDefautM) ; seule la
                                     conversion vers CM.state.edgeClearanceM change en conséquence.
                                     Masqué pour Type de structure = Ombrière (cf. updatePoseModeUI). -->
                                <label class="cm-label">Esp. bordure (mm)</label>
                                <input id="calepinageMaisonEdgeClearanceInput" type="number" min="0" max="10000" step="10" value="250" class="cm-input" />
                                <div id="calepinageMaisonEdgeClearanceInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="calepinageMaisonRidgeClearanceWrapper">
                                <!-- CORRECTIF (demande explicite) : libellé "Espacement bordure au
                                     niveau du faîtage" -> "Largeur faîtage (mm)" ; plage 20-600 ->
                                     20-2000mm ; défaut 20 -> 500mm (250mm de chaque côté, cf.
                                     unitDivisor 2000 ci-dessous — la valeur stockée en interne reste
                                     PAR CÔTÉ, en mètres). Pour Type de structure = Ombrière : masqué
                                     en monopente, visible + renommé "Largeur faîtage / Noue (mm)" en
                                     bipente (cf. updatePoseModeUI). -->
                                <label class="cm-label" id="calepinageMaisonRidgeClearanceLabel">Largeur faîtage (mm)</label>
                                <input id="calepinageMaisonRidgeClearanceInput" type="number" min="20" max="2000" value="500" class="cm-input" />
                                <div id="calepinageMaisonRidgeClearanceInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <!-- NOUVEAU (demande explicite) : entraxes des poteaux de l'ombrière.
                                 Même expression et même jeu de caractères que #postDistances des
                                 modales de géométrie (ombriere_metal.html) et que #cmOmb_postDistances
                                 du formulaire 3D : ce champ est désormais la SOURCE, les deux autres
                                 en sont alimentés (CM.state.ombriereEntraxeExpr). Visible uniquement
                                 pour une ombrière (cf. updatePoseModeUI). Laissé vide = entraxe
                                 déduit automatiquement de la longueur de façade (~6 m par travée). -->
                            <div id="calepinageMaisonOmbriereEntraxeWrapper" class="cm-pleine-ligne" style="display:none;">
                                <label class="cm-label" title="Expression des travées le long de la façade, en mètres. Ex. : 4*10.5 + 2*8">Entraxes poteaux longitudinaux (m)</label>
                                <input id="calepinageMaisonOmbriereEntraxeInput" type="text" inputmode="text"
                                       data-saisie-libre="entraxes"
                                       autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                                       placeholder="auto" title="Nombres, * et + uniquement. Ex. : 4*10.5 + 2*8"
                                       class="cm-input" />
                                <div id="calepinageMaisonOmbriereEntraxeInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <!-- NOUVEAU (demande explicite) : position des poteaux d'ombrière dans la largeur,
                                 et leurs axes / ancrages sur la carte (inspiré de DrawingControl/shapes/poteaux.js).
                                 Règles, câblage et dessin : calepinage_maison_poteaux_ombriere.js. Visibilité
                                 selon le modèle (CM.majChampsPoteauxUI) : entraxe transversal = Double
                                 poteaux, Centrés liaisonnés, Double toiture Y ; excentrement = Poteaux
                                 excentrés (ombrière métal) ; affichage = toutes les ombrières. Vide = valeur
                                 par défaut du modèle (celle de la modale de géométrie). -->
                            <div id="cmPoteauxEntraxeTransversalWrapper" style="display:none;">
                                <label class="cm-label" title="Distance entre les files de poteaux dans la largeur du champ, en mètres (#postSpacing de la modale de géométrie)">Entraxes poteaux transversaux (m)</label>
                                <input id="cmPoteauxEntraxeTransversalInput" type="number" min="0.5" max="30" step="0.01" placeholder="auto" class="cm-input" />
                                <div id="cmPoteauxEntraxeTransversalInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="cmPoteauxExcentrementWrapper" style="display:none;">
                                <label class="cm-label" title="Distance horizontale du bord bas (égout) à l'axe des poteaux, en mètres (#postEccentricity de la modale de géométrie)">Excentrement poteaux (m)</label>
                                <input id="cmPoteauxExcentrementInput" type="number" min="0" max="30" step="0.01" placeholder="auto" class="cm-input" />
                                <div id="cmPoteauxExcentrementInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <!-- NOUVEAU (demande explicite) : implantation longitudinale. Porte-à-faux gauche / droit
                                 synchronisés avec la modale de géométrie et la fenêtre 3D (vide = automatique,
                                 un seul des deux fait foi, l'autre s'en déduit) ; largeur de place de parking et
                                 place PMR (métal) pour le calcul automatique des entraxes ; position des pannes
                                 (bois). Règles : CM.poteauxOmbriere.implantationLongitudinale. -->
                            <div id="cmPoteauxPafGaucheWrapper" style="display:none;">
                                <label class="cm-label" title="Distance du bord gauche de l'ombrière au premier poteau, en mètres (vide = automatique, entre 0,10 et 1 m)">Porte-à-faux gauche (m)</label>
                                <input id="cmPoteauxPafGaucheInput" type="number" min="0" max="3" step="0.01" placeholder="auto" class="cm-input" />
                                <div id="cmPoteauxPafGaucheInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="cmPoteauxPafDroitWrapper" style="display:none;">
                                <label class="cm-label" title="Distance du dernier poteau au bord droit de l'ombrière, en mètres (vide = déduit de la longueur, des entraxes et du porte-à-faux gauche)">Porte-à-faux droit (m)</label>
                                <input id="cmPoteauxPafDroitInput" type="number" min="0" max="3" step="0.01" placeholder="auto" class="cm-input" />
                                <div id="cmPoteauxPafDroitInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="cmPoteauxLargeurPlaceWrapper" style="display:none;">
                                <label class="cm-label" title="Largeur d'une place de parking : les entraxes automatiques regroupent 3 ou 4 places (métal) / jusqu'à 3 places (bois)">Largeur place parking (m)</label>
                                <select id="cmPoteauxLargeurPlaceSelect" class="cm-input">
                                    <option value="2.30">2,30</option>
                                    <option value="2.35">2,35</option>
                                    <option value="2.40">2,40</option>
                                    <option value="2.45">2,45</option>
                                    <option value="2.50" selected>2,50</option>
                                    <option value="perso">Personnalisée</option>
                                </select>
                            </div>
                            <div id="cmPoteauxLargeurPlacePersoWrapper" style="display:none;">
                                <label class="cm-label" title="Largeur de place personnalisée, entre 2 et 5 m">Largeur personnalisée (m)</label>
                                <input id="cmPoteauxLargeurPlacePersoInput" type="number" min="2" max="5" step="0.01" placeholder="2 à 5 m" class="cm-input" />
                                <div id="cmPoteauxLargeurPlacePersoInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="cmPoteauxPmrNombreWrapper" style="display:none;">
                                <label class="cm-label" title="Places PMR à prévoir : chaque travée PMR vaut largeur PMR x places PMR + largeur standard x places standard (ex. 3,30 + 2 x 2,50 = 8,30 m)">Nombre de places PMR</label>
                                <input id="cmPoteauxPmrNombreInput" type="number" min="0" max="10" step="1" value="0" class="cm-input" />
                                <div id="cmPoteauxPmrNombreInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="cmPoteauxPmrLargeurWrapper" style="display:none;">
                                <label class="cm-label" title="Largeur d'une place PMR, entre 3 et 4 m (vide = 3,30 m)">Largeur place PMR (m)</label>
                                <input id="cmPoteauxPmrLargeurInput" type="number" min="3" max="4" step="0.01" placeholder="auto (3.30 m)" class="cm-input" />
                                <div id="cmPoteauxPmrLargeurInputError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div id="cmOmbriereBoisPannesWrapper" style="display:none;">
                                <label class="cm-label" title="Pannes encastrées sur le côté de la traverse, ou posées sur la traverse (la hauteur de l'ombrière augmente de l'épaisseur des pannes)">Position des pannes</label>
                                <select id="cmOmbriereBoisPannesSelect" class="cm-input">
                                    <option value="side">Côté</option>
                                    <option value="top">Sur traverse</option>
                                </select>
                            </div>
                            <div id="cmPoteauxAffichageWrapper" class="cm-pleine-ligne" style="display:none;">
                                <label class="cm-label" style="display:block; width:100%;">Poteaux sur la carte</label>
                                <div style="display:flex; flex-direction:column; align-items:flex-start; gap:4px; width:100%; box-sizing:border-box; margin-bottom:6px;">
                                    <label style="display:flex; align-items:center; justify-content:flex-start; gap:6px; width:100%; margin:0; text-align:left; white-space:nowrap; font-size:0.8rem; color:#374151; cursor:pointer;" title="Une ligne par file de poteaux, le long de la façade">
                                        <input id="cmPoteauxAxesLongCheckbox" type="checkbox" style="width:auto; height:auto; margin:0; flex:0 0 auto;" />
                                        Axes longitudinaux
                                    </label>
                                    <label style="display:flex; align-items:center; justify-content:flex-start; gap:6px; width:100%; margin:0; text-align:left; white-space:nowrap; font-size:0.8rem; color:#374151; cursor:pointer;" title="Une ligne par poteau, dans la largeur du champ">
                                        <input id="cmPoteauxAxesTransCheckbox" type="checkbox" style="width:auto; height:auto; margin:0; flex:0 0 auto;" />
                                        Axes transversaux
                                    </label>
                                    <label style="display:flex; align-items:center; justify-content:flex-start; gap:6px; width:100%; margin:0; text-align:left; white-space:nowrap; font-size:0.8rem; color:#374151; cursor:pointer;">
                                        <input id="cmPoteauxAncragesCheckbox" type="checkbox" style="width:auto; height:auto; margin:0; flex:0 0 auto;" />
                                        Ancrages
                                    </label>
                                </div>
                                <label class="cm-label">Type d'ancrage</label>
                                <select id="cmPoteauxFormeAncrageSelect" class="cm-input" style="margin-bottom:0;">
                                    <option value="circle">Cercle</option>
                                    <option value="square">Carré</option>
                                    <option value="rect">Rectangle</option>
                                </select>
                                <div id="cmPoteauxCarteHint" style="display:none; font-size:0.7rem; color:#b45309; margin-top:4px;"></div>
                            </div>
                        </div>
                    </div>

                    <!-- DÉPLACÉ ICI (demande explicite) : contextuel (obstacle sélectionné),
                         toggle JS inchangé (updateObstaclePropertiesPanel) — mais désormais à
                         l'intérieur de "Géométrie de la toiture", donc masquée avec le reste de la
                         section quand elle est repliée. -->
                    <div id="cmObstaclePropsSection" style="margin-bottom:12px; display:none; padding:10px; background:#fef2f2; border:1px solid #fecaca; border-radius:6px;">
                        <h4 class="cm-section-title" style="margin-bottom:8px;">Obstacle sélectionné : <span id="cmObstaclePropsLabel" style="text-transform:none; font-weight:600;"></span></h4>
                        <div style="display:flex; gap:6px; margin-bottom:8px;">
                            <div style="flex:1;">
                                <label class="cm-label">Largeur (cm)</label>
                                <input id="cmObstacleWidthInput" type="number" min="5" step="1" class="cm-input" />
                            </div>
                            <div style="flex:1;">
                                <label class="cm-label">Hauteur (cm)</label>
                                <input id="cmObstacleHeightInput" type="number" min="5" step="1" class="cm-input" />
                            </div>
                        </div>
                        <div>
                            <label class="cm-label">Zone de retrait / buffer (cm)</label>
                            <input id="cmObstacleBufferInput" type="number" min="0" step="1" class="cm-input" />
                        </div>
                        <!-- NOUVEAU (demande explicite) : hauteur PHYSIQUE de l'obstacle au-dessus du
                             toit — sert uniquement à son extrusion dans la vue 3D (aucun effet en 2D).
                             Bornes min/max posées dynamiquement selon le type (cf.
                             updateObstaclePropertiesPanel), différentes pour chaque type d'obstacle. -->
                        <div style="margin-top:8px;">
                            <label class="cm-label">Hauteur 3D (m)</label>
                            <input id="cmObstacleElevationInput" type="number" min="0.05" max="5" step="0.05" class="cm-input" />
                            <div id="cmObstacleElevationHint" style="font-size:0.68rem; color:#6b7280; margin-top:2px;"></div>
                        </div>
                    </div>
                </details>

                <details class="cm-section-details">
                    <summary>Matériels <i class="fas fa-chevron-down"></i></summary>

                    <!-- NOUVEAU (demande explicite : "les champs et labels du Système d'intégration,
                         des Panneaux solaires et du Système dans le formulaire PRO / Grand projet
                         doivent être identiques et afficher les mêmes données que le formulaire de
                         calepinage multi-typologie") : ces trois blocs sont désormais délimités par un
                         conteneur identifié, pour être CLONÉS tels quels dans les sections
                         correspondantes du formulaire PRO — cf. calepinage_maison_form_pro.js. Aucun
                         champ n'est déplacé ni modifié ici : seul le conteneur est nouveau. -->
                    <div id="cmMaterielPanneauSection">
                    <label class="cm-label cm-material-title">Panneau</label>
                    <select id="cmPanelCatalogSelect" class="cm-input" style="margin-bottom:6px;">
                        <option value="">Sélectionner dans le catalogue…</option>
                    </select>
                    <!-- CORRECTIF (demande explicite : "Référence panneau" seule sur sa propre
                         ligne, au-dessus de Puissance/Garantie") -->
                    <div style="margin-bottom:8px;">
                        <label class="cm-label">Référence</label>
                        <input id="cmPanelRef" type="text" placeholder="Ex: DMEGC DM-470-G12RT" class="cm-input" />
                    </div>
                    <div style="display:flex; gap:6px; margin-bottom:8px;">
                        <div style="flex:1;">
                            <label class="cm-label">Puissance (Wc)</label>
                            <input id="cmPanelPowerWc" type="number" min="100" max="1000" value="470" class="cm-input" />
                            <div id="cmPanelPowerWcError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                        <div style="flex:1;">
                            <label class="cm-label">Garantie (années)</label>
                            <input id="cmGarantiePanneauAns" type="number" min="0" max="20" step="1" value="20" class="cm-input" />
                            <div id="cmGarantiePanneauAnsError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                    </div>

                    <!-- NOUVEAU (demande explicite) : "Caractéristiques des panneaux" déplacé ici, juste
                         après le choix du panneau — l'utilisateur choisit d'abord le panneau, puis le
                         mode de pose (les dimensions Long./Larg./Ép. ci-dessus étant déjà pré-remplies
                         par la sélection catalogue, encore modifiables à la main). -->
                    <div style="display:flex; gap:6px; margin-bottom:8px;">
                        <div style="flex:1;">
                            <label class="cm-label">Long. (mm)</label>
                            <input id="cmPanelLength" type="number" min="1000" max="3500" value="1762" class="cm-input" />
                            <div id="cmPanelLengthError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                        <div style="flex:1;">
                            <label class="cm-label">Larg. (mm)</label>
                            <input id="cmPanelWidth" type="number" min="1000" max="3500" value="1134" class="cm-input" />
                            <div id="cmPanelWidthError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                        <div style="flex:1;">
                            <label class="cm-label">Ép. (mm)</label>
                            <input id="cmPanelThickness" type="number" min="20" max="50" value="30" class="cm-input" />
                            <div id="cmPanelThicknessError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                    </div>
                    <div style="display:flex; gap:6px; margin-bottom:8px;">
                        <button id="cmOrientationPortrait" class="cm-btn" style="flex:1;">Portrait</button>
                        <button id="cmOrientationPaysage" class="cm-btn" style="flex:1;">Paysage</button>
                    </div>
                    <!-- NOUVEAU (demande explicite : Petit champ solaire) : 3 boutons d'action sous Portrait et Paysage -->
                    <div id="cmPetitChampActionsWrapper" style="display:none; gap:6px; margin-bottom:8px;">
                        <button type="button" id="cmPetitChampCalculerBtn" class="cm-btn" style="flex:1; background:#005A9E; color:#fff; border-color:#005A9E;">
                            <i class="fas fa-calculator"></i> Calculer
                        </button>
                        <button type="button" id="cmPetitChampResultatsBtn" class="cm-btn" style="flex:1; background:#16a34a; color:#fff; border-color:#16a34a;">
                            <i class="fas fa-chart-bar"></i> Résultats
                        </button>
                        <button type="button" id="cmPetitChampOptimisationBtn" class="cm-btn" style="flex:1; background:#f59e0b; color:#fff; border-color:#f59e0b;">
                            <i class="fas fa-sliders-h"></i> Optimisation
                        </button>
                    </div>
                    </div>

                    <div id="cmMaterielIntegrationSection">
                    <!-- NOUVEAU (demande explicite) : liste déroulante "Système d'intégration" — cf.
                         calepinage_maison_systemes_integration.js (nouveau fichier, catalogue dédié à ce
                         module, distinct de TYPE_COUVERTURE_MAP utilisé par le calepinage rectangulaire).
                         Espacement X/Y placés juste en dessous, pré-remplis automatiquement au choix. -->
                    <label class="cm-label cm-material-title">Système d'intégration</label>
                    <!-- Liste remplie selon le type de structure (cf. calepinage_maison_systemes_
                         integration.js::remplirSelectSystemes) ; le bouton (i) affiche les données
                         de la base pour ce type. Largeur explicite (width:100%) : sans elle, une
                         feuille de style de la page PRO réduit cette ligne à 0 px et rejette liste et
                         bouton hors du panneau, à droite (même piège que les boutons de modèles). -->
                    <div style="display:flex; justify-content:flex-start; gap:6px; align-items:center; width:100%; box-sizing:border-box; margin-bottom:6px;">
                        <select id="cmSystemeIntegrationSelect" class="cm-input" style="flex:1; min-width:0; margin-bottom:0;">
                            <option value="">Autre / saisie manuelle</option>
                        </select>
                        <button type="button" id="cmSystemeIntegrationInfoBtn" class="cm-btn" title="Données des systèmes d'intégration (base)" style="flex:0 0 auto; padding:4px 8px;">
                            <i class="fas fa-info-circle"></i>
                        </button>
                    </div>
                    <div id="cmSystemeIntegrationHint" style="display:none; color:#475569; font-size:0.72rem; margin:-2px 0 6px;"></div>
                    <div style="display:flex; gap:8px; margin-bottom:8px;">
                        <div style="flex:1;">
                            <label class="cm-label">Espacement X (mm)</label>
                            <input id="cmPanelSpacingX" type="number" min="0" max="30" value="20" class="cm-input" />
                            <div id="cmPanelSpacingXError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                        <div style="flex:1;">
                            <label class="cm-label">Espacement Y (mm)</label>
                            <input id="cmPanelSpacingY" type="number" min="0" max="30" value="20" class="cm-input" />
                            <div id="cmPanelSpacingYError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                    </div>

                    <!-- NOUVEAU (demande explicite) : "Largeur rail" du système d'intégration —
                         delta X ajouté à la LONGUEUR de l'ombrière envoyée aux plans de coupe et de
                         façade (cf. calepinage_maison_dimensions_ombriere.js). Visible uniquement
                         pour un type de structure "Ombrière" (cf. updatePoseModeUI). -->
                    <div id="cmRailWidthWrapper" style="display:none; margin-bottom:8px;">
                        <label class="cm-label">Largeur rail (mm)</label>
                        <input id="cmRailWidth" type="number" min="100" max="250" step="1" value="180" class="cm-input" />
                        <div id="cmRailWidthError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                    </div>

                    <!-- Joints de dilatation (demande explicite) : ombrières métal / bois / Solumbra et
                         bâtiment incliné (cf. updatePoseModeUI). Le moteur de pose coupe le champ en
                         tronçons de longueur <= longueur limite, séparés par un joint dessiné sur le
                         canevas (cf. paramsJointDilatation, calepinage_maison_calculs.js). -->
                    <div id="cmJointDilatationWrapper" style="display:none; margin-bottom:8px;">
                        <div class="cm-grille2">
                            <div>
                                <label class="cm-label" title="Largeur du joint de dilatation entre deux tronçons du champ PV">Largeur joint de dilatation (mm)</label>
                                <input id="cmJointDilatation" type="number" min="10" max="300" step="1" value="100" class="cm-input" />
                                <div id="cmJointDilatationError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                            <div>
                                <label class="cm-label" title="Longueur du champ PV au-delà de laquelle un joint de dilatation est intégré">Longueur limite joint (m)</label>
                                <input id="cmJointDilatationLimite" type="number" min="50" max="100" step="1" value="65" class="cm-input" />
                                <div id="cmJointDilatationLimiteError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                            </div>
                        </div>
                        <!-- Répartition des joints (demande explicite) : tronçons égaux par défaut ;
                             cochée, le champ est coupé à la longueur limite (le reste en dernier). -->
                        <label class="cm-label" style="display:flex; align-items:center; gap:6px; margin-top:6px; cursor:pointer;"
                               title="Non coché : tronçons de longueur égale. Coché : tronçons coupés à la longueur limite, le reste en dernier.">
                            <input id="cmJointDilatationSurLimite" type="checkbox" style="margin:0;" />
                            Couper à la longueur limite (sinon tronçons égaux)
                        </label>
                        <div id="cmJointDilatationHint" style="color:#475569; font-size:0.72rem; margin-top:4px;"></div>
                    </div>

                    <!-- Toiture terrasse (demande explicite) : séparation physique posée
                         automatiquement tous les 300 m² de panneaux (largeur réglable, 90 cm par
                         défaut), cf. SEPARATION_TERRASSE (calculs.js) et majInfosSystemeIntegration. -->
                    <div id="cmTerrasseSeparationWrapper" style="display:none; margin-bottom:6px;">
                        <label class="cm-label" title="Séparation physique entre sections de 300 m² de panneaux au plus">Largeur séparation champ PV (mm)</label>
                        <input id="cmTerrasseSeparation" type="number" min="300" max="3000" step="10" value="900" class="cm-input" />
                        <div id="cmTerrasseSeparationError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                    </div>
                    <div id="cmTerrasseSeparationHint" style="display:none; color:#92400e; background:#fffbeb; border:1px solid #fcd34d; border-radius:6px; padding:6px 8px; font-size:0.74rem; margin-bottom:8px;"></div>
                    </div>

                    <div id="cmMaterielSystemeSection">
                    <label class="cm-label cm-material-title">Onduleur</label>
                    <!-- CORRECTIF (demande explicite : "label et 2 listes déroulantes mal positionnés
                         (Fabricant / Type de...) — décaler à gauche et les mettre sous le titre de
                         l'onduleur") : la mise en page à 2 colonnes (flex côte à côte) débordait dans
                         #cmLeftPanel (largeur limitée) et tronquait le libellé "Type de connexion" —
                         empilés verticalement en pleine largeur, alignés à gauche comme le reste du
                         formulaire, un champ par ligne. -->
                    <label class="cm-label">Fabricant</label>
                    <select id="cmOnduleurFabricantSelect" class="cm-input" style="margin-bottom:6px;">
                        <option value="">Fabricant</option>
                    </select>
                    <!-- NOUVEAU (demande explicite : "Type de connexion onduleur, connecté au
                         réseau. Cela permettra de faire le filtre pour un projet connecté au réseau
                         et off-grid.") -->
                    <!-- CORRECTIF (demande explicite : "masquer le type de connexion pour le moment, on
                         l'utilisera plus tard une fois les données des onduleurs off-grid ajoutées à la
                         BD") : masqué (display:none), pas retiré — le <select>/son filtre dans
                         populateOnduleurSelect() restent fonctionnels, prêts à être réaffichés en
                         retirant simplement ce style le jour venu. -->
                    <div style="display:none;">
                        <label class="cm-label">Type de connexion</label>
                        <select id="cmOnduleurConnexionSelect" class="cm-input" style="margin-bottom:6px;">
                            <option value="">Tous</option>
                            <option value="Connecté au réseau">Connecté au réseau</option>
                            <option value="Off-grid">Off-grid</option>
                        </select>
                    </div>
                    <select id="cmOnduleurCatalogSelect" class="cm-input" style="margin-bottom:6px;">
                        <option value="">Sélectionner dans le catalogue…</option>
                    </select>
                    <div id="cmOnduleurPuissanceGarantieRow" style="display:flex; gap:6px; margin-bottom:8px;">
                        <div style="flex:1;">
                            <label class="cm-label">Puissance onduleur (kVA)</label>
                            <input id="cmOnduleurPuissance" type="number" min="0.2" max="5000" step="0.1" value="0" class="cm-input" />
                            <div id="cmOnduleurPuissanceError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                        <div style="flex:1;">
                            <label class="cm-label">Garantie (années)</label>
                            <input id="cmGarantieOnduleurAns" type="number" min="0" max="20" step="1" value="0" class="cm-input" />
                            <div id="cmGarantieOnduleurAnsError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                        <!-- CORRECTIF (demande explicite : "afficher seulement la puissance et le champ
                             de garantie") : Rendement/Conso. restent en base (CM.state, moteur de
                             calcul de production — cf. onduleurRendement/onduleurConso plus bas dans ce
                             fichier) mais ne sont plus affichés ici — masqués (pas supprimés du DOM)
                             pour ne rien casser côté écouteurs/persistance, valeurs par défaut
                             (97%/0W) toujours appliquées automatiquement. -->
                        <div style="display:none;">
                            <label class="cm-label">Rendement onduleur (%)</label>
                            <input id="cmOnduleurRendement" type="number" min="0" max="100" step="0.1" value="97" class="cm-input" />
                        </div>
                        <div style="display:none;">
                            <label class="cm-label">Conso. onduleur (W)</label>
                            <input id="cmOnduleurConso" type="number" min="0" step="0.1" value="0" class="cm-input" />
                        </div>
                    </div>

                    <!-- NOUVEAU (demande explicite : "afficher un nouveau champ Type d'onduleur,
                         placé en dessous des labels Puissance onduleur (kVA) et Garantie (années)") :
                         en lecture seule, renseigné depuis la colonne "Technologie" du catalogue
                         (colonne C de Materiels_BD.xlsx), ramenée aux 3 catégories demandées — cf.
                         normaliserTypeOnduleur(). Pleine largeur, sous la ligne Puissance/Garantie.
                         C'est aussi ce type qui commande le filtre des batteries proposées. -->
                    <div style="margin-bottom:8px;">
                        <label class="cm-label">Type d'onduleur</label>
                        <input id="cmOnduleurType" type="text" class="cm-input" readonly
                               placeholder="Choisir un onduleur au catalogue" />
                    </div>

                    <!-- Conteneur masqué pour un projet Site autonome ou Projet PV Hybride (cf.
                         SECTIONS_MASQUEES_HORS_RESEAU_RESIDENTIEL), formulaire résidentiel seulement. -->
                    <div id="cmBatterieSection">
                    <label class="cm-label cm-material-title">Batterie</label>
                    <!-- Batterie virtuelle (projets Résidentiel et PRO), sous le titre « Batterie » : réglage du PROJET, enregistré
                         avec l'étude économique (#batterie_virtuelle_optin) — cette case n'en est que
                         l'accès depuis le calepinage (cf. definirBatterieVirtuelle).
                         CORRECTIF (bug rapporté : « je dois cliquer plusieurs fois ») : float/width/height/
                         line-height remis à zéro en ligne — Modele.css (label { float:left; height:30px }) et
                         Index.css (label { width:250px }) faisaient flotter le libellé, que le titre suivant
                         venait chevaucher et qui interceptait alors une partie des clics. En ligne pour valoir
                         aussi dans le clone du formulaire PRO ; clear:both pour passer sous le titre
                         « Batterie », lui aussi flottant dans ce clone. -->
                    <div id="cmBatterieVirtuelleSection" style="display:none; clear:both; margin-bottom:6px;">
                        <label style="display:flex; align-items:center; gap:6px; float:none; width:auto; height:auto; line-height:1.3; font-size:0.8rem; color:#374151; margin:0; cursor:pointer;">
                            <input id="cmBatterieVirtuelleOptin" type="checkbox" style="width:16px; height:16px; margin:0; flex:none; cursor:pointer;">
                            Intégration d’une batterie virtuelle
                        </label>
                    </div>
                    <select id="cmBatteryCatalogSelect" class="cm-input" style="margin-bottom:6px;">
                        <option value="">Aucune</option>
                    </select>
                    <!-- CORRECTIF (demande explicite : "Référence batterie" seule sur sa propre
                         ligne, au-dessus de Capacité/Garantie") -->
                    <div style="margin-bottom:8px;">
                        <label class="cm-label">Référence</label>
                        <input id="cmBatteryRef" type="text" class="cm-input" readonly />
                    </div>
                    <div style="display:flex; gap:6px; margin-bottom:8px;">
                        <div style="flex:1;">
                            <label class="cm-label">Capacité (kWh)</label>
                            <!-- Bornes 1-10000 kWh : validées côté backend uniquement (cf. plan) — champ
                                 readonly, alimenté par le catalogue (#cmBatteryCatalogSelect), pas de
                                 saisie libre à valider ici. -->
                            <input id="cmBatteryCapacite" type="number" min="1" max="10000" step="0.1" class="cm-input" readonly />
                        </div>
                        <div style="flex:1;">
                            <label class="cm-label">Garantie (années)</label>
                            <input id="cmGarantieBatterieAns" type="number" min="0" max="20" step="1" value="10" class="cm-input" />
                            <div id="cmGarantieBatterieAnsError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                    </div>
                    </div>

                    <!-- NOUVEAU (demande explicite, ajout matériels BD) : carte "Optimiseur", même
                         pattern que Batterie ci-dessus — visible seulement quand l'onduleur choisi est
                         compatible optimiseur (cf. updateOptimiseurCardVisibility()), liste filtrée aux
                         seules références compatibles avec CET onduleur (filtre strict, cf.
                         chaines_pertes_modal.js pour le même principe côté modale de dimensionnement). -->
                    <div id="cmOptimiseurCardContainer" style="display:none;">
                        <label class="cm-label cm-material-title">Optimiseur</label>
                        <select id="cmOptimiseurCatalogSelect" class="cm-input" style="margin-bottom:6px;">
                            <option value="">Aucun</option>
                        </select>
                        <div style="margin-bottom:8px;">
                            <label class="cm-label">Référence</label>
                            <input id="cmOptimiseurRef" type="text" class="cm-input" readonly />
                        </div>
                        <div style="max-width:160px; margin-bottom:8px;">
                            <label class="cm-label">Garantie (années)</label>
                            <input id="cmGarantieOptimiseurAns" type="number" min="0" max="20" step="1" value="0" class="cm-input" />
                            <div id="cmGarantieOptimiseurAnsError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                    </div>

                    <!-- NOUVEAU (rapport PDF résidentiel — page "Vos Garanties") : équipement Borne
                         de recharge. Le choix/paramétrage de la borne se fait dans le modal
                         "Consommation d'énergie" (IRVE) — ce champ n'est donc que la garantie,
                         désactivé tant qu'aucune borne n'y a été ajoutée (cf.
                         updateBorneEquipmentAvailability(), orchestrateur.js). -->
                    <!-- CORRECTIF (demande explicite : "positionner à gauche et en dessous des
                         labels les champs de borne de recharge et pompage solaire") : le champ
                         Garantie n'est plus étiré sur toute la largeur (flex:1 sur un unique enfant)
                         — largeur compacte fixe, aligné à gauche sous son propre label. -->
                    <!-- CORRECTIF (demande explicite, renforcement : "les champs sont mal
                         positionnés, tout à droite — il faut les mettre à gauche et en dessous de
                         leurs titres") : empilement vertical STRICT (une ligne par champ, pleine
                         largeur, sans regroupement flex-row) — élimine toute ambiguïté de
                         positionnement, quelle que soit la cause de la lecture précédente. -->
                    <!-- Conteneur masqué pour un projet Site autonome en Pompage solaire (cf.
                         SECTIONS_MASQUEES_POMPAGE_AUTONOME), aussi dans le formulaire PRO. -->
                    <div id="cmBorneRechargeSection">
                    <label class="cm-label cm-material-title">Borne de recharge</label>
                    <div style="margin-bottom:4px;">
                        <label class="cm-label">Garantie (années)</label>
                        <input id="cmGarantieBorneAns" type="number" min="0" max="20" step="1" value="1" class="cm-input" style="max-width:160px;" disabled />
                        <div id="cmGarantieBorneAnsError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                    </div>
                    <p id="cmGarantieBorneHint" style="margin:-4px 0 8px; font-size:0.7rem; color:#6b7280;">Ajoutez une borne de recharge dans "Consommation d'énergie" pour renseigner sa garantie.</p>
                    </div>

                    <!-- NOUVEAU (demande explicite) : équipement "Pompage solaire", synchronisé
                         ensuite vers le poste "Autres généraux" du chiffrage résidentiel (cf.
                         ResidentielCapexTable.js::syncFromCalepinage()). -->
                    <!-- Conteneur masqué par défaut (demande explicite) : affiché seulement si l'option
                         « Pompage solaire » a été choisie dans « Paramètres du projet », ou pour un
                         projet Site autonome (cf. appliquerVisibiliteSelonProjet). Son id est cloné en
                         data-cm-id dans le formulaire PRO, qui en recopie le display. -->
                    <div id="cmPompageSolaireSection" style="display:none;">
                    <label class="cm-label cm-material-title">Pompage solaire</label>
                    <label style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:#374151; margin:0 0 6px;">
                        <input id="cmPompageSolaireActif" type="checkbox" style="width:16px; height:16px; margin:0; cursor:pointer;">
                        Présent
                    </label>
                    <!-- CORRECTIF (demande explicite : "ajouter les données de pompage solaire aussi")
                         : référence libre -> sélecteur catalogue (même pattern que Batterie/Optimiseur
                         ci-dessus), lit /catalogue/pompes-solaires (cf. bd_pompes_solaires.js). -->
                    <div style="margin-bottom:4px;">
                        <label class="cm-label">Référence</label>
                        <select id="cmPompageSolaireCatalogSelect" class="cm-input" disabled>
                            <option value="">Sélectionner dans le catalogue…</option>
                        </select>
                    </div>
                    <div style="margin-bottom:8px;">
                        <label class="cm-label">Garantie (années)</label>
                        <input id="cmGarantiePompageAns" type="number" min="0" max="20" step="1" value="1" class="cm-input" style="max-width:160px;" disabled />
                        <div id="cmGarantiePompageAnsError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                    </div>
                    </div>

                    <!-- #cmTypeMontageSelect déplacé en haut de #cmLeftPanel (demande explicite, cf.
                         plus haut) — n'est plus dans ce <details>. -->
                    <div style="display:flex; gap:6px;">
                        <!-- id : bloc gardé dans l'extrait ouvert depuis le pompage solaire
                             (calepinage_maison_parametres_pompage.js). -->
                        <div id="cmPerteSystemeWrapper" style="flex:1;">
                            <label class="cm-label">Pertes système (%)</label>
                            <!-- CORRECTIF (demande explicite) : valeur par défaut 14 -> 10%, plage
                                 0-100 -> 6-30. -->
                            <input id="cmPerteSysteme" type="number" min="6" max="30" step="0.1" value="10" class="cm-input" />
                            <div id="cmPerteSystemeError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
                        </div>
                        <div id="cmAffectationCentraleWrapper" style="flex:1;">
                            <label class="cm-label">Affectation centrale</label>
                            <!-- CORRECTIF (demande explicite : "liste déroulante qui doit afficher
                                 soit la valeur 1 ou 2") : remplace le champ texte libre précédent. -->
                            <select id="cmAffectationCentrale" class="cm-input">
                                <option value="1" selected>1</option>
                                <option value="2">2</option>
                            </select>
                        </div>
                    </div>
                    </div>
                </details>

                <!-- CORRECTIF (demande explicite : "sortir le bouton Ouvrir le dimensionnement et
                     le placer après la carte Matériels, il doit être toujours visible") : déplacé
                     hors du <details> "Matériels" (n'apparaissait qu'une fois la section dépliée) —
                     sibling juste après, donc visible en permanence quel que soit l'état déplié/
                     replié de "Matériels". Ouvre DIRECTEMENT window.openChainesPertesModal() (le
                     vrai outil de dimensionnement des chaînes, chaines_pertes_modal.js) — plus
                     d'étape SummaryModal intermédiaire pour ce parcours résidentiel. Pas de
                     fermeture de ce modal nécessaire : chainesPertesModal a un z-index PLUS ÉLEVÉ
                     (999999 > 999998), il s'affiche déjà par-dessus sans conflit, et l'installateur
                     retrouve directement ce modal-ci en le fermant. -->
                <button type="button" id="cmOpenDimensionnementBtn" class="cm-btn" style="width:100%; margin-bottom:12px; background:#005A9E; color:#fff; border-color:#005A9E;">
                    <i class="fas fa-chart-line"></i> Ouvrir Dimensionnement
                </button>

                <!-- NOUVEAU (demande explicite : "simplifier le workflow résidentiel" — voir aussi
                     ResidentielAutoconsoEmbed.js) : lance directement le calcul d'autoconsommation et
                     affiche ses résultats (Analyse mensuelle, Analyse des taux, Tableau récapitulatif)
                     à l'intérieur du modal Études économiques, sans que l'installateur ait besoin
                     d'ouvrir séparément le modal Autoconsommation. Pas de fermeture de CE modal-ci
                     nécessaire dans la logique elle-même (cmOpenAutoconsoResults() s'en charge, car —
                     contrairement à chainesPertesModal juste au-dessus — le modal Études économiques a
                     un z-index PLUS BAS que ce modal-ci et s'afficherait donc dessous sans ça). -->
                <button type="button" id="cmCalculerVisualiserBtn" class="cm-btn" style="width:100%; margin-bottom:12px; background:var(--success-color, #16a34a); color:#fff; border-color:var(--success-color, #16a34a);">
                    <i class="fas fa-calculator"></i> Calculer et visualiser
                </button>

                <!-- NOUVEAU (demande explicite) : télécharge le rapport PDF d'autoconsommation
                     (exportToPDFJS() du modal Autoconsommation embarqué, cf.
                     ResidentielAutoconsoEmbed.js::window.cmDownloadAutoconsoRapport) — nécessite
                     qu'un calcul ait déjà été lancé au moins une fois via le bouton ci-dessus. -->
                <button type="button" id="cmTelechargerRapportBtn" class="cm-btn" style="width:100%; margin-bottom:8px; background:#fff; color:var(--success-color, #16a34a); border-color:var(--success-color, #16a34a);">
                    <i class="fas fa-file-pdf"></i> Télécharger le rapport
                </button>
                <button type="button" id="cmExporterPlanCablageBtn" class="cm-btn" style="width:100%; margin-bottom:8px; background:#fff; color:#005A9E; border-color:#005A9E;">
                    <i class="fas fa-project-diagram"></i> Exporter le plan de câblage
                </button>
                <button type="button" id="cmExporterDevisDetailleBtn" class="cm-btn" style="width:100%; margin-bottom:8px; background:#fff; color:#1E8449; border-color:#1E8449;">
                    <i class="fas fa-file-invoice-dollar"></i> Exporter le devis détaillé en PDF/Excel
                </button>
                <button type="button" id="cmExporterDevisSynthetiqueBtn" class="cm-btn" style="width:100%; margin-bottom:12px; background:#fff; color:#1E8449; border-color:#1E8449;">
                    <i class="fas fa-file-invoice"></i> Exporter le devis synthétique en PDF/Excel
                </button>

                <!-- RETIRÉ (demande explicite : "la carte Planning de réalisation doit être placée
                     dans le modal Paramètres du projet, section Personnalisation du rapport —
                     l'utilisateur oublie souvent de la renseigner s'il ne la voit qu'au moment de
                     télécharger le rapport") : déplacé vers parametre.html
                     (#planning-realisation-wrapper), sauvegardé/validé par projet (comme
                     rapport_cover_label) plutôt que par maison — cf. ParametreProjet.planning_j_*,
                     personnalisationRapport.js, PdfResidentialReportGenerator.js::addPlanningPage. -->

                <!-- RETIRÉ d'ici (demande explicite : "la carte obstacle s'affiche en dessous du
                     planning de réalisation, on ne peut plus la masquer — il faut qu'elle
                     apparaisse dans sa section géométrie de toiture, et que masquer le contenu de
                     la section masque tout") : #cmObstaclePropsSection vivait hors de tout
                     <details>, donc restait visible même section "Géométrie de la toiture"
                     repliée. Déplacée à l'intérieur de cette section (juste avant sa fermeture),
                     toggle JS inchangé (updateObstaclePropertiesPanel) — un <details> fermé masque
                     nativement tous ses descendants, quelle que soit leur propre valeur display. -->

                <details class="cm-section-details">
                    <summary>Gestion de visibilité <i class="fas fa-chevron-down"></i></summary>
                    <!-- CORRECTIF (demande explicite : "activer et afficher le bouton de l'import
                         d'une image pour la mise à l'échelle") : la fonctionnalité (calepinage_
                         image_source.js — import + calibration par 2 points + distance connue) est
                         déjà entièrement implémentée ; seul ce bouton restait désactivé/masqué comme
                         "bientôt disponible". Réactivé — cf. correctifs de précision apportés à la
                         calibration (onCanvasClick, calepinage_image_source.js) et à la projection
                         image->mètres locaux (imagePixelToLocalMeters, calepinage_maison_dessin.js). -->
                    <button id="calepinageMaisonImportImageBtn" class="cm-btn" style="width:100%; margin-bottom:8px;" title="Importer une photo/un plan de toiture et le calibrer à l'échelle">Importer une image (nouvelle source)</button>
                    <!-- REFONTE (demande explicite : "placer 2 icônes pour ces labels dans le menu
                         horizontal") : remplacées par #cmToggleShowPanelsBtn/#cmToggleShowBackgroundBtn
                         dans #cmToolbar — ces 2 checkboxes restent dans le DOM (display:none) car
                         plusieurs fichiers (orchestrateur.js, calepinage_maison_dessin.js) lisent/
                         écrivent encore leur .checked ; wireVisibilityToggleButtons() les garde
                         synchronisées avec les nouveaux boutons. -->
                    <label style="display:none;">
                        <input id="calepinageMaisonShowPanelsCheckbox" type="checkbox" checked style="width:auto; height:auto;" />
                        Afficher les panneaux
                    </label>
                    <label style="display:none;">
                        <input id="calepinageMaisonShowBackgroundCheckbox" type="checkbox" style="width:auto; height:auto;" />
                        Afficher le fond de carte (capture)
                    </label>
                    <img id="calepinageMaisonCapturePreview" alt="Capture de la vue en plan" style="width:100%; border-radius:6px; border:1px solid #ccc; display:none;" />
                </details>
            </div>

            <div id="cmRightPanel" style="flex:1; display:flex; flex-direction:column; min-width:0; padding-top:14px; order:1;">
                <!-- REFONTE (demande explicite : "remplacer les boutons textuels par des boutons
                     icônes SVG, regroupés par catégories logiques") : contenu généré depuis
                     CalepinageMaisonToolbarConfig (calepinage_maison_toolbar_config.js) — mêmes id/
                     comportements qu'avant, seuls l'icône/tooltip/regroupement changent. Voir
                     cmToolbarInnerHTML()/cmObstaclesMenuHTML() ci-dessus. -->
                <div id="cmToolbar" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; row-gap:8px; padding:6px 2px 12px; margin-bottom:8px; border-bottom:1px solid #e5e7eb;">
                    ${cmToolbarInnerHTML()}
                </div>

                <div id="cmResultsWrapper" style="margin-bottom:8px; padding:8px 12px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px;">
                    <div id="calepinageMaisonResults" style="font-size:0.85rem;"></div>
                </div>

                <canvas id="calepinageMaisonCanvas" width="1080" height="760" style="width:100%; height:auto; background:#f9fafb; border:1px solid #d1d5db; border-radius:6px; cursor:default; flex-shrink:0;"></canvas>
            </div>
        `;

        const style = document.createElement('style');
        style.textContent = `
            .cm-btn { padding:6px 10px; border-radius:4px; font-size:0.75rem; font-weight:600; cursor:pointer; background:#f5f5f5; color:#333; border:1px solid #ddd; white-space:nowrap; }
            .cm-btn:hover { filter: brightness(0.95); }
            /* REFONTE (boutons icônes SVG) : boutons de #cmToolbar rendus icône-seule — padding
               réduit/carré au lieu du padding rectangulaire pensé pour du texte. */
            .cm-icon-btn { width:32px; height:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; }
            .cm-obstacle-item { background:#f5f5f5; border:1px solid #ddd; border-radius:6px; width:32px; height:32px; padding:0; display:flex; align-items:center; justify-content:center; cursor:grab; user-select:none; flex-shrink:0; }
            .cm-obstacle-item:hover { filter: brightness(0.95); }
            .cm-obstacle-item:active { cursor:grabbing; }
            /* NOUVEAU : 3 toggles persistants de l'en-tête (Formulaire/Barre d'outils/Résultats). */
            .cm-header-toggle-btn { background:rgba(255,255,255,0.15); border:none; color:#fff; width:28px; height:28px; border-radius:4px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:13px; flex-shrink:0; }
            .cm-header-toggle-btn:hover { background:rgba(255,255,255,0.32); }
            .cm-header-toggle-off { opacity:0.5; }
            #cmHeaderNav::-webkit-scrollbar { display:none; }
            .cm-header-nav-btn { display:inline-flex; align-items:center; gap:6px; flex-shrink:0; background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.45); color:#fff; height:30px; padding:0 12px; border-radius:15px; font-size:12.5px; font-weight:500; cursor:pointer; white-space:nowrap; transition:background .15s, color .15s; }
            .cm-header-nav-btn:hover, .cm-header-nav-btn:focus-visible { background:#fff; color:#dc2626; outline:none; }
            .cm-header-nav-btn i { font-size:12px; }
            .cm-section-title { margin:0 0 6px 0; font-size:0.8rem; font-weight:700; color:#374151; }
            /* Type de structure en boutons, 2 par rangée (demande explicite). */
            /* CORRECTIF (bug rapporté : boutons du Type de structure invisibles) : Modele.css impose
               label { float:left; width:100% } — la grille, posée à côté du libellé flottant, était
               réduite à 0 px de large. clear + largeur explicite la renvoient sous le libellé. */
            .cm-boutons-2col { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:8px; clear:both; width:100%; box-sizing:border-box; }
            .cm-boutons-2col .cm-btn { white-space:normal; line-height:1.2; min-height:32px; }
            .cm-boutons-2col .cm-btn.on { background:#dc2626; color:#fff; border-color:#dc2626; }
            .cm-boutons-2col .cm-btn:disabled { opacity:0.5; cursor:not-allowed; }
            /* Boutons "Type de calepinage" : même hauteur que ceux du Type de structure (demande explicite). */
            #calepinageMaisonPoseSection .cm-btn { line-height:1.2; min-height:32px; }
            .cm-label { display:block; font-size:0.72rem; font-weight:600; color:#4b5563; margin-bottom:2px; }
            /* Isolation vis-à-vis des feuilles globales de la page (Modele.css : float/hauteur fixe,
               Index.css : largeur 250 px, etc.) — même principe que #dp-modal. */
            #calepinageMaisonModal .cm-label { float:none; width:auto; height:auto; line-height:1.3; background:none; padding:0; white-space:normal; }
            /* NOUVEAU (demande explicite) : champs de la géométrie de toiture par 2 sur une ligne.
               "align-items:start" évite qu'un champ en erreur (message sous le champ) n'étire sa
               voisine ; .cm-pleine-ligne rend sa largeur à un bloc qui ne tient pas en demi-colonne. */
            .cm-grille2 { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:8px 10px; align-items:start; }
            .cm-grille2 > .cm-pleine-ligne { grid-column:1 / -1; }
            /* NOUVEAU (demande explicite : "trait vertical rouge en dessous de chaque titre de
               matériels, pour les identifier rapidement") : classe additive (jamais à la place de
               .cm-label, qui reste partagée par tous les libellés du formulaire) posée UNIQUEMENT sur
               les 6 titres Panneau/Système d'intégration/Onduleur/Batterie/Borne de recharge/Pompage
               solaire. */
            .cm-material-title { position:relative; padding-left:9px; }
            .cm-material-title::before { content:''; position:absolute; left:0; top:1px; bottom:1px; width:3px; background:#dc2626; }
            /* CORRECTIF (titres collés au trait rouge) : « #calepinageMaisonModal .cm-label
               { padding:0 } », plus spécifique, annulait le retrait ci-dessus. */
            #calepinageMaisonModal .cm-label.cm-material-title,
            .cmPro-host .cm-label.cm-material-title { padding-left:12px; }
            .cm-input { width:100%; padding:4px 6px; border:1px solid #d1d5db; border-radius:4px; font-size:0.8rem; box-sizing:border-box; }

            /* NOUVEAU (demande explicite : formulaire en 3 sections repliables) : même principe
               visuel que .form-section-details (calepinage.html), repris sous un nom dédié pour que
               ce module reste autonome (aucune dépendance sur le style d'un autre formulaire).
               Repliées par défaut (pas d'attribut "open"), comme dans le formulaire calepinage. */
            .cm-section-details { margin-bottom:12px; background:#fff; border:1px solid #e5e7eb; border-radius:6px; padding:0 10px; }
            .cm-section-details summary { list-style:none; outline:none; cursor:pointer; padding:8px 0; margin-bottom:0; font-size:0.8rem; font-weight:700; color:#374151; display:flex; justify-content:space-between; align-items:center; }
            .cm-section-details summary::-webkit-details-marker { display:none; }
            .cm-section-details[open] summary i { transform: rotate(180deg); }
            .cm-section-details summary i { transition: transform 0.3s ease; }
            .cm-section-details > *:not(summary) { margin-bottom:12px; }
            .cm-section-details > *:last-child { margin-bottom:8px; }

            @media (max-width: 900px) {
                #cmModalBody { flex-direction: column !important; overflow-y: auto !important; }
                /* Formulaire à droite en écran large (cf. order sur #cmLeftPanel/#cmRightPanel) ;
                   empilé (canevas puis formulaire) en écran étroit, la bordure/le padding latéraux
                   n'ont donc plus lieu d'être ici. */
                #cmLeftPanel { width: 100% !important; max-height: 42vh !important; border-left: none !important; border-top: 1px solid #e5e7eb !important; padding-left: 0 !important; padding-top: 10px !important; margin-top: 10px !important; }
            }
        `;
        document.head.appendChild(style);

        CM.modal.appendChild(header);
        CM.modal.appendChild(CM.modalBody);
        document.body.appendChild(CM.backdrop);
        document.body.appendChild(CM.modal);

        // La croix et le clic sur le fond sont les 2 gestes de fermeture VOLONTAIRE (cf. requestCloseModal).
        header.querySelector('#closeCalepinageMaisonBtn').addEventListener('click', requestCloseModal);
        CM.backdrop.addEventListener('click', requestCloseModal);

        CM.sourceSelectEl = header.querySelector('#calepinageMaisonSourceSelect');
        CM.sourceSelectEl.addEventListener('change', (e) => CM.switchToSource(e.target.value));
        CM.sourceButtonsEl = header.querySelector('#cmSourceButtons');
        CM.sourceButtonsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-source-id]');
            if (btn) CM.switchToSource(btn.getAttribute('data-source-id'));
        });

        CM.canvas = CM.modalBody.querySelector('#calepinageMaisonCanvas');
        CM.previewImg = CM.modalBody.querySelector('#calepinageMaisonCapturePreview');
        CM.azimuthListEl = CM.modalBody.querySelector('#calepinageMaisonAzimuths');
        CM.resultsEl = CM.modalBody.querySelector('#calepinageMaisonResults');
        CM.ridgeBtn = CM.modalBody.querySelector('#calepinageMaisonRidgeBtn');
        CM.drawRectBtn = CM.modalBody.querySelector('#calepinageMaisonDrawRectBtn');
        CM.drawPolygonBtn = CM.modalBody.querySelector('#calepinageMaisonDrawPolygonBtn');
        CM.drawLineBtn = CM.modalBody.querySelector('#calepinageMaisonDrawLineBtn');

        CM.modalBody.querySelector('#calepinageMaisonCaptureBtn').addEventListener('click', CM.captureMapView);
        CM.modalBody.querySelector('#calepinageMaisonImportImageBtn').addEventListener('click', () => {
            if (typeof window.openCalepinageImageSourceModal === 'function') window.openCalepinageImageSourceModal();
        });
        // CORRECTIF (demande explicite : "un seul clic, pas de double clic via Summary") : ouvre
        // directement le modal de dimensionnement des chaînes avec les données de TOUTES les
        // maisons connues (CM.getPvFieldsForChainesPertes(), orchestrateur.js) — même fonction
        // globale que le bouton "Configuration des chaînes..." de SummaryModal (Pro/Grand projet),
        // simplement appelée directement ici plutôt qu'après un premier clic sur Summary.
        const dimensionnementBtn = CM.modalBody.querySelector('#cmOpenDimensionnementBtn');
        if (dimensionnementBtn) dimensionnementBtn.addEventListener('click', () => {
            if (typeof window.openChainesPertesModal === 'function') {
                window.openChainesPertesModal(CM.getPvFieldsForChainesPertes());
            }
        });

        // NOUVEAU (demande explicite : "simplifier le workflow résidentiel") : cf. commentaire sur le
        // bouton lui-même — délègue tout l'enchaînement (masquage de ce modal, ouverture d'Études
        // économiques, calcul d'autoconsommation) à ResidentielAutoconsoEmbed.js, chargé par
        // etudes_economique_content.html. closeModal()/showModalAfterHide() sont les fonctions
        // LOCALES de ce fichier (juste display:none/flex sur CM.modal/CM.backdrop, aucune perte
        // d'état du calepinage en cours) — showModalAfterHide est rappelée quand l'utilisateur ferme
        // le modal Études économiques (demande explicite : "revenir sur le modal du calepinage").
        const calculerVisualiserBtn = CM.modalBody.querySelector('#cmCalculerVisualiserBtn');
        if (calculerVisualiserBtn) calculerVisualiserBtn.addEventListener('click', () => {
            if (typeof window.checkPowerLicenceCompliance === 'function') {
                let totalPower = 0;
                try {
                    const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                    totalPower = Number(savedData?.totals?.totalPower || 0);
                } catch (_) {}
                const licenceCheck = window.checkPowerLicenceCompliance(totalPower);
                if (licenceCheck && (licenceCheck.allowed === false || licenceCheck.compliant === false)) {
                    alert(licenceCheck.message || '[Licence PV] Puissance autorisée dépassée.');
                    return;
                }
            }
            // CONTRÔLE DE COHÉRENCE GÉOGRAPHIQUE (Exigence 4 : Calepinage vs Adresse, seuil 2 km)
            if (typeof window.checkCalepinageGeographicCoherence === 'function') {
                const geoCheck = window.checkCalepinageGeographicCoherence();
                if (geoCheck && geoCheck.isWithinLimit === false) {
                    const distKm = (geoCheck.distance / 1000).toFixed(2);
                    const maxKm = ((geoCheck.maxAllowed || 2000) / 1000).toFixed(1);
                    alert(`[Incohérence géographique] Votre calepinage est situé à ${distKm} km de l'adresse du projet (distance maximale autorisée : ${maxKm} km). Les calculs de productible sont bloqués. Veuillez redessiner votre calepinage à l'emplacement exact de l'adresse du projet pour éviter toute erreur de saisie.`);
                    return;
                }
            }
            // Ratio DC/AC / P. max DC onduleur (cf. chaines_pertes_modal.js::verifierAvantCalcul).
            if (window.ChainesPertesControle && typeof window.ChainesPertesControle.verifierAvantCalcul === 'function') {
                const controleOnduleurs = window.ChainesPertesControle.verifierAvantCalcul(
                    typeof CM.getPvFieldsForChainesPertes === 'function' ? CM.getPvFieldsForChainesPertes() : undefined);
                if (!controleOnduleurs.ok) {
                    alert(controleOnduleurs.message);
                    return;
                }
            }
            if (typeof window.cmOpenAutoconsoResults === 'function') {
                window.cmOpenAutoconsoResults(closeModal, showModalAfterHide);
            } else {
                console.warn('[CalepinageMaison] cmOpenAutoconsoResults indisponible (ResidentielAutoconsoEmbed.js non chargé ?).');
            }
        });

        // NOUVEAU (demande explicite) : télécharge le rapport PDF du calcul d'autoconsommation déjà
        // lancé (bouton ci-dessus) — cf. commentaire sur le bouton lui-même.
        const telechargerRapportBtn = CM.modalBody.querySelector('#cmTelechargerRapportBtn');
        if (telechargerRapportBtn) telechargerRapportBtn.addEventListener('click', () => {
            if (typeof window.cmDownloadAutoconsoRapport === 'function') {
                window.cmDownloadAutoconsoRapport();
            } else {
                console.warn('[CalepinageMaison] cmDownloadAutoconsoRapport indisponible (ResidentielAutoconsoEmbed.js non chargé ?).');
            }
        });

        const exporterPlanCablageBtn = CM.modalBody.querySelector('#cmExporterPlanCablageBtn');
        if (exporterPlanCablageBtn) exporterPlanCablageBtn.addEventListener('click', () => {
            if (typeof window.exporterPlanCablageDcProjet !== 'function') {
                alert("Le plan de câblage n'est pas disponible sur cette page.");
                return;
            }
            const champs = typeof CM.getPvFieldsForChainesPertes === 'function' ? (CM.getPvFieldsForChainesPertes() || []) : [];
            if (!champs.length) {
                alert("Aucun champ PV calepiné : veuillez d'abord dessiner les panneaux sur la toiture.");
                return;
            }
            if (!window.exporterPlanCablageDcProjet(champs)) {
                alert("Aucun pan câblé : veuillez d'abord configurer les chaînes dans « Ouvrir Dimensionnement ».");
            }
        });

        const exporterDevisDetailleBtn = CM.modalBody.querySelector('#cmExporterDevisDetailleBtn');
        if (exporterDevisDetailleBtn) exporterDevisDetailleBtn.addEventListener('click', async () => {
            const PDF = window.ResidentielChiffrage && window.ResidentielChiffrage.PDF;
            if (!PDF || typeof PDF.previewAndExport !== 'function') {
                alert("Le module d'export de devis n'est pas disponible sur cette page.");
                return;
            }
            exporterDevisDetailleBtn.disabled = true;
            try {
                await PDF.previewAndExport({ detailed: true });
            } catch (err) {
                console.error('[cmExporterDevisDetailleBtn] Échec export devis détaillé :', err);
                alert(err.message || "Échec de l'export du devis détaillé.");
            } finally {
                exporterDevisDetailleBtn.disabled = false;
            }
        });

        const exporterDevisSynthetiqueBtn = CM.modalBody.querySelector('#cmExporterDevisSynthetiqueBtn');
        if (exporterDevisSynthetiqueBtn) exporterDevisSynthetiqueBtn.addEventListener('click', async () => {
            const PDF = window.ResidentielChiffrage && window.ResidentielChiffrage.PDF;
            if (!PDF || typeof PDF.previewAndExport !== 'function') {
                alert("Le module d'export de devis n'est pas disponible sur cette page.");
                return;
            }
            exporterDevisSynthetiqueBtn.disabled = true;
            try {
                await PDF.previewAndExport({ detailed: false });
            } catch (err) {
                console.error('[cmExporterDevisSynthetiqueBtn] Échec export devis synthétique :', err);
                alert(err.message || "Échec de l'export du devis synthétique.");
            } finally {
                exporterDevisSynthetiqueBtn.disabled = false;
            }
        });

        // NOUVEAU (demande explicite) : bouton "Export" — PDF canevas seul + canevas/carte, cf.
        // exportCanvasEtCartePdf() (calepinage_maison_dessin.js). État "Export en cours..." pendant
        // la génération (masque temporairement ce modal pour la capture de la carte).
        const exportBtn = CM.modalBody.querySelector('#calepinageMaisonExportBtn');
        if (exportBtn) exportBtn.addEventListener('click', async () => {
            exportBtn.disabled = true;
            const originalHtml = exportBtn.innerHTML;
            exportBtn.innerHTML = 'Export en cours...';
            try {
                await CM.exportCanvasEtCartePdf();
            } catch (err) {
                console.error('[calepinageMaisonExportBtn] Échec de l\'export PDF :', err);
            } finally {
                exportBtn.disabled = false;
                exportBtn.innerHTML = originalHtml;
            }
        });
        // NOUVEAU (demande explicite : "mettre l'icône du schéma unifilaire dans le menu horizontal
        // du calepinage résidentiel") : réutilise TEL QUEL le point d'entrée déjà existant de la barre
        // d'outils principale de la carte (bouton #schema-unifilaire-button, câblé par ButtonControl.js
        // — un module ES, donc PAS accessible via window.ButtonControl depuis ce script classique) :
        // on déclenche simplement un clic programmatique sur ce bouton déjà présent dans le DOM
        // (toujours rendu par la barre d'outils principale, même masqué visuellement) plutôt que de
        // dupliquer sa logique d'ouverture (iframe plein écran vers /concevoir_mon_projet/modal/
        // schema_unifilaire).
        const schemaUnifilaireBtn = CM.modalBody.querySelector('#cmOpenSchemaUnifilaireBtn');
        if (schemaUnifilaireBtn) schemaUnifilaireBtn.addEventListener('click', () => {
            const mainBtn = document.getElementById('schema-unifilaire-button');
            if (mainBtn) mainBtn.click();
        });
        // Déclaration préalable : même masquage TEMPORAIRE que pour les Études économiques
        // (display:none, rien n'est démonté, le drapeau de réouverture est conservé) — la DP a
        // besoin de la carte principale (cotations, points de vue, captures) — puis réaffichage
        // de ce modal à la fermeture de la DP.
        const dpBtn = CM.modalBody.querySelector('#cmOpenDeclarationPrealableBtn');
        if (dpBtn) dpBtn.addEventListener('click', () => {
            const dp = window.declarationPrealableModal;
            if (!dp) {
                window.alert("Le module Déclaration préalable n'est pas encore chargé. Réessayez dans un instant.");
                return;
            }
            if (CM.modal) CM.modal.style.setProperty('display', 'none', 'important');
            if (CM.backdrop) CM.backdrop.style.setProperty('display', 'none', 'important');
            dp.open({ onClose: showModalAfterHide });
        });
        CM.modalBody.querySelector('#calepinageMaisonShowPanelsCheckbox').addEventListener('change', (e) => {
            CM.state.showPanels = e.target.checked;
            CM.updateVisibilityToggleButtonsUI();
            CM.render();
        });
        CM.modalBody.querySelector('#calepinageMaisonShowBackgroundCheckbox').addEventListener('change', (e) => {
            CM.state.showBackgroundImage = e.target.checked;
            if (CM.previewImg.src) CM.previewImg.style.display = e.target.checked ? 'block' : 'none';
            CM.updateVisibilityToggleButtonsUI();
            CM.render();
        });
        wireVisibilityToggleButtons();

        CM.modalBody.querySelector('#calepinageMaisonPose_incline').addEventListener('click', () => setPoseMode('incline'));
        CM.modalBody.querySelector('#calepinageMaisonPose_plat').addEventListener('click', () => setPoseMode('plat'));
        CM.modalBody.querySelector('#calepinageMaisonPose_shed').addEventListener('click', () => setPoseMode('shed'));
        CM.modalBody.querySelector('#calepinageMaisonPose_dome').addEventListener('click', () => setPoseMode('dome'));

        CM.ridgeBtn.addEventListener('click', () => {
            CM.state.tracingRidge = !CM.state.tracingRidge;
            CM.state.ridgeTemp = null;
            updateRidgeButtonUI();
        });
        CM.drawRectBtn.addEventListener('click', () => {
            if (!CM.state.tracingContourRect) {
                if (typeof window.checkPowerLicenceCompliance === 'function' && typeof CM.computeAllHousesResultsSummary === 'function') {
                    const s = CM.computeAllHousesResultsSummary();
                    const currentPower = s ? (s.totalPowerKwc || 0) : 0;
                    const check = window.checkPowerLicenceCompliance(currentPower);
                    if (check && (check.allowed === false || check.compliant === false)) {
                        const maxAllowedKwc = check.maxAllowedKwc ?? check.max_allowed_kwc;
                        const maxAllowedStr = (typeof maxAllowedKwc === 'number') ? maxAllowedKwc.toFixed(2) : String(maxAllowedKwc || '');
                        const tol = check.tolerancePercent ?? check.tolerance_percent ?? 10;
                        alert(`[Licence PV] La puissance totale de votre projet (${Number(currentPower || 0).toFixed(2)} kWc) dépasse déjà le plafond maximal autorisé par votre licence (${maxAllowedStr} kWc avec tolérance de ${tol}%). Impossible de tracer un nouveau contour.`);
                        return;
                    }
                }
            }
            CM.state.tracingContourRect = !CM.state.tracingContourRect;
            CM.state.contourRectPoints = [];
            if (CM.state.tracingContourRect) {
                CM.state.drawingContourPolygon = false; CM.state.contourPolygonPoints = [];
                CM.state.tracingFreeLine = false; CM.state.freeLineTemp = null; updateFreeLineButtonUI();
            }
            updateContourDrawButtonsUI();
            CM.render();
        });
        CM.drawPolygonBtn.addEventListener('click', () => {
            if (!CM.state.drawingContourPolygon) {
                if (typeof window.checkPowerLicenceCompliance === 'function' && typeof CM.computeAllHousesResultsSummary === 'function') {
                    const s = CM.computeAllHousesResultsSummary();
                    const currentPower = s ? (s.totalPowerKwc || 0) : 0;
                    const check = window.checkPowerLicenceCompliance(currentPower);
                    if (check && (check.allowed === false || check.compliant === false)) {
                        const maxAllowedKwc = check.maxAllowedKwc ?? check.max_allowed_kwc;
                        const maxAllowedStr = (typeof maxAllowedKwc === 'number') ? maxAllowedKwc.toFixed(2) : String(maxAllowedKwc || '');
                        const tol = check.tolerancePercent ?? check.tolerance_percent ?? 10;
                        alert(`[Licence PV] La puissance totale de votre projet (${Number(currentPower || 0).toFixed(2)} kWc) dépasse déjà le plafond maximal autorisé par votre licence (${maxAllowedStr} kWc avec tolérance de ${tol}%). Impossible de tracer un nouveau contour.`);
                        return;
                    }
                }
            }
            CM.state.drawingContourPolygon = !CM.state.drawingContourPolygon;
            CM.state.contourPolygonPoints = [];
            if (CM.state.drawingContourPolygon) {
                CM.state.tracingContourRect = false; CM.state.contourRectPoints = [];
                CM.state.tracingFreeLine = false; CM.state.freeLineTemp = null; updateFreeLineButtonUI();
            }
            updateContourDrawButtonsUI();
            CM.render();
        });
        // NOUVEAU (demande explicite : bouton ligne déplacé dans ce modal, cf. ButtonControl.js) —
        // même toggle 2-clics que "Tracer le faîtage" (CM.ridgeBtn ci-dessus), mais accumule plusieurs
        // lignes (CM.state.freeLines) au lieu d'en remplacer une seule ; désactive les autres modes de
        // tracé de contour en cours, même geste que rect/polygon ci-dessus.
        CM.drawLineBtn.addEventListener('click', () => {
            CM.state.tracingFreeLine = !CM.state.tracingFreeLine;
            CM.state.freeLineTemp = null;
            if (CM.state.tracingFreeLine) {
                CM.state.tracingContourRect = false; CM.state.contourRectPoints = [];
                CM.state.drawingContourPolygon = false; CM.state.contourPolygonPoints = [];
                updateContourDrawButtonsUI();
            }
            updateFreeLineButtonUI();
            CM.render();
        });
        CM.modalBody.querySelector('#calepinageMaisonMonopenteBtn').addEventListener('click', () => {
            CM.resetDivision(); updatePoseModeUI(); CM.render(); CM.recomputeResults();
        });
        CM.modalBody.querySelector('#calepinageMaison2PansSymBtn').addEventListener('click', () => {
            CM.divideInto2PansSymmetric(); updatePoseModeUI(); CM.render(); CM.recomputeResults();
        });
        CM.modalBody.querySelector('#calepinageMaison2PansAsymBtn').addEventListener('click', () => {
            CM.divideInto2PansAsymmetric(); updatePoseModeUI(); CM.render(); CM.recomputeResults();
        });
        wireCmValidatedInput('calepinageMaisonAsymmetryInput', 'calepinageMaisonAsymmetryInputError',
            { min: 10, max: 80, label: 'Asymétrie (% Pan 1)' }, (value) => {
                CM.state.asymmetryPercent = value;
                if (CM.state.divisionMode === '2pans' && CM.state.lastTwoPanKind === 'asym') {
                    CM.divideInto2PansAsymmetric();
                }
                CM.render(); CM.recomputeResults();
            });
        // NOUVEAU (demande explicite) : "Type de faîtage" 2 pans asymétrique — effet 3D uniquement.
        const faitageAsymSelect = CM.modalBody.querySelector('#calepinageMaisonFaitageAsymType');
        if (faitageAsymSelect) {
            faitageAsymSelect.value = CM.state.faitageAsymType || 'sans';
            faitageAsymSelect.addEventListener('change', (e) => {
                CM.state.faitageAsymType = e.target.value === 'avec' ? 'avec' : 'sans';
                if (typeof CM.refresh3DView === 'function') CM.refresh3DView();
            });
        }
        CM.modalBody.querySelector('#calepinageMaison4PansBtn').addEventListener('click', () => {
            const ridgeWidthMm = parseFloat(CM.modalBody.querySelector('#calepinageMaisonRidgeWidthInput').value) || 0;
            if (ridgeWidthMm > 0) CM.state.croupeRidgeWidthMm = ridgeWidthMm; // persistée (cf. PERSISTED_STATE_FIELDS)
            CM.divideInto4Pans(ridgeWidthMm / 1000); updatePoseModeUI(); CM.render(); CM.recomputeResults();
        });
        // NOUVEAU (demande explicite : "Diviser en 4 pans symétrique") : pas de paramètre (bandes
        // toujours égales, contrairement à la croupe ci-dessus dont la largeur de faîtage est réglable).
        CM.modalBody.querySelector('#calepinageMaison4PansSymBtn').addEventListener('click', () => {
            CM.divideInto4PansSymmetric(); updatePoseModeUI(); CM.render(); CM.recomputeResults();
        });
        // NOUVEAU (demande explicite) : bascule l'axe du faîtage (arête la plus longue <-> sa
        // perpendiculaire) puis rejoue la division active — les pans, leur largeur et donc le
        // calepinage des panneaux sont recalculés par les fonctions existantes.
        CM.modalBody.querySelector('#calepinageMaisonInverserFaitageBtn').addEventListener('click', () => {
            if (!CM.state) return;
            CM.state.ridgeAxisSwapped = !CM.state.ridgeAxisSwapped;
            reappliquerDivisionCourante();
            updatePoseModeUI(); CM.render(); CM.recomputeResults();
        });
        // NOUVEAU (demande explicite : "Largeur du faîtage doit être inférieure à la longueur du
        // bâtiment", rejet + message plutôt que le clampage silencieux déjà présent dans
        // divideInto4Pans/calculs.js, conservé en filet de sécurité) : borne haute DYNAMIQUE, dérivée
        // à la volée de CM.state.roofLocal (mètres) — pas une constante, donc pas gérée par
        // wireCmValidatedInput (bornes fixes) ; validation écrite à la main sur le même modèle.
        CM.modalBody.querySelector('#calepinageMaisonRidgeWidthInput').addEventListener('input', (e) => {
            const input = e.target;
            const errorEl = CM.modalBody.querySelector('#calepinageMaisonRidgeWidthInputError');
            const raw = String(input.value).trim().replace(',', '.');
            const parsed = parseFloat(raw);
            const buildingLengthMm = CM.state.roofLocal && CM.state.roofLocal.length >= 2
                ? Math.max(...CM.state.roofLocal.map((p, i) => {
                    const q = CM.state.roofLocal[(i + 1) % CM.state.roofLocal.length];
                    return Math.hypot(q.x - p.x, q.y - p.y);
                })) * 1000
                : Infinity;
            let message = null;
            if (raw === '' || isNaN(parsed)) message = 'Largeur du faîtage : valeur numérique requise.';
            else if (parsed < 1) message = 'Largeur du faîtage : doit être ≥ 1 mm.';
            else if (parsed >= buildingLengthMm) message = `Largeur du faîtage : doit être inférieure à la longueur du bâtiment (${buildingLengthMm.toFixed(0)} mm).`;
            input.style.borderColor = message ? '#dc3545' : '';
            if (errorEl) { errorEl.style.display = message ? 'block' : 'none'; errorEl.textContent = message || ''; }
            if (message) return;
            CM.state.croupeRidgeWidthMm = parsed; // persistée (cf. PERSISTED_STATE_FIELDS)
            if (CM.state.divisionMode === '4pans') {
                CM.divideInto4Pans(parsed / 1000);
                CM.render(); CM.recomputeResults();
            }
        });
        CM.modalBody.querySelector('#calepinageMaisonResetDivisionBtn').addEventListener('click', () => {
            CM.resetDivision(); updatePoseModeUI(); CM.render(); CM.recomputeResults();
        });
        wireForceRealignButton();
        CM.modalBody.querySelector('#calepinageMaisonDeletePolygonBtn').addEventListener('click', () => {
            const sourceSupprimee = CM.state.sourceId;
            if (CM.state.sourceType === 'maps' && CM.state.currentPolygonRef && window.MaisonPolygonManagerInstance) {
                window.MaisonPolygonManagerInstance.removePolygon(CM.state.currentPolygonRef);
            }
            CM.removeSourceOption(sourceSupprimee);
            // État neutre AVANT toute bascule : switchToSource() commence par sauvegarder l'état
            // courant sous son propre sourceId — sans cette remise à zéro, il ressusciterait le champ
            // PV qu'on vient de supprimer.
            CM.state = CM.createDefaultState();

            // CORRECTIF (demande explicite : "supprimer un champ PV ne doit pas fermer le modal") :
            // on bascule sur un autre champ PV encore présent plutôt que de fermer — supprimer PV2
            // dans un projet qui en compte trois n'a aucune raison de faire sortir du calepinage.
            // Le modal n'est fermé que s'il ne reste AUCUN champ PV : il n'y aurait alors plus ni
            // contour, ni canevas, ni sélecteur à afficher.
            const sourceRestante = CM.getFirstKnownSourceId();
            if (sourceRestante) {
                CM.switchToSource(sourceRestante);
            } else {
                closeModal();
            }

            // Champs restants renumérotés sans trou (PV1, PV2, PV3…) — la renumérotation sauvegarde
            // elle-même en base quand des n° changent.
            const renumerotation = typeof CM.renumeroterChampsPV === 'function' ? CM.renumeroterChampsPV() : {};

            // NOUVEAU (persistance BD) : synchronise immédiatement la suppression en base — sans
            // ce signal explicite, le garde-fou anti-perte-de-données côté serveur ignorerait par
            // prudence toute sauvegarde ultérieure ne contenant plus cette maison (même logique que
            // explicitShapeDeletion pour le calepinage rectangulaire, cf. DrawingControl.js).
            if (!Object.keys(renumerotation).length
                && window.CalepinageMaisonPersistenceDB && typeof window.CalepinageMaisonPersistenceDB.saveToDatabase === 'function') {
                window.CalepinageMaisonPersistenceDB.saveToDatabase({ explicitDeletion: true }).catch(() => {});
            }
        });

        // NOUVEAU (demande explicite : "bouton pour masquer la carte Incl./Azim. dans le menu
        // horizontal") : même pattern que les checkboxes de visibilité existantes (showPanels/
        // showStructure), sous forme de bouton pour s'intégrer au menu horizontal comme demandé.
        // CORRECTIF (bug rapporté : "Incl./Azim. affiche encore du texte") : la refonte icône-seule
        // du round précédent avait bien changé le HTML initial du bouton, mais cette fonction
        // réécrivait son contenu en icône+texte à chaque appel — le bouton garde désormais son icône
        // fixe (posée à la création), seul le `title` (tooltip) porte l'état actif/inactif.
        const orientationCardBtn = CM.modalBody.querySelector('#cmToggleOrientationCardBtn');
        const updateOrientationCardBtnUI = () => {
            orientationCardBtn.title = CM.state.showOrientationCard !== false
                ? 'Masquer la carte Inclinaison/Azimut sur les panneaux'
                : 'Afficher la carte Inclinaison/Azimut sur les panneaux';
        };
        orientationCardBtn.addEventListener('click', () => {
            CM.state.showOrientationCard = CM.state.showOrientationCard === false;
            updateOrientationCardBtnUI();
            CM.render();
        });
        updateOrientationCardBtnUI();

        // CORRECTIF (demande explicite : "mettre le bouton Changer l'azimut également dans le menu
        // horizontal ; il doit faire un tour complet du cercle trigonométrique") : remplace l'ancien
        // flip ±180° par un pas de +90° par clic (Sud→Ouest→Nord→Est→Sud, 4 clics = un tour complet),
        // en conservant exactement la convention déjà documentée dans le formulaire (Sud=0°,
        // Ouest=90°, Est=-90°, Nord=±180°). Décision confirmée : uniquement pour le polygone libre
        // (CM.state.contourMode === 'polygon'), où l'azimut est déjà une référence constante,
        // indépendante de la géométrie (CM.state.polygonAzimuthDeg, champ du formulaire ajouté au
        // round précédent) — piloter le même état garde le bouton et le champ synchronisés. L'outil
        // rectangle n'est pas concerné : une rotation de 90° désalignerait la grille de panneaux des
        // bords physiques du toit (contrairement à l'ancien flip ±180°, qui ne changeait pas l'axe
        // de la grille).
        // CORRECTIF (demande explicite : "pour la toiture Monopente, ajoute la possibilité de faire
        // pivoter la flèche par paliers de 90°") : ce bouton gère désormais les DEUX modes de tracé.
        // Polygone libre : comportement inchangé (polygonAzimuthDeg, azimut = référence absolue).
        // Rectangle (nouveau) : rectAzimuthOffsetDeg, additif à computeLengthEdgeAngle() — une simple
        // réaffectation d'angle serait écrasée à la prochaine resynchronisation
        // (openCalepinageMaisonModal()/applyContourDims(), qui recalculent toujours pan.angle depuis
        // la géométrie du contour) ; l'offset additif, lui, survit puisqu'il est réappliqué à
        // chaque fois par ces mêmes fonctions (cf. calepinage_maison_calculs.js/orchestrateur.js).
        CM.modalBody.querySelector('#cmFlipAzimuthBtn').addEventListener('click', () => {
            if (!tournerAzimut90()) {
                alert("La rotation de l'azimut n'est disponible qu'en toiture Monopente.");
            }
        });

        CM.contourDimsWrapper = CM.modalBody.querySelector('#calepinageMaisonContourDimsWrapper');
        CM.contourLengthInput = CM.modalBody.querySelector('#calepinageMaisonContourLengthInput');
        CM.contourWidthInput = CM.modalBody.querySelector('#calepinageMaisonContourWidthInput');
        // NOUVEAU (demande explicite : validation 0-500m, rejet + message) : les 2 champs partagent
        // applyContourDims() (elle lit les deux à chaque appel) — on valide donc les deux avant de
        // l'appeler, quel que soit celui qui vient de changer.
        const validateContourDimInput = (input, errorId, label) => {
            const errorEl = CM.modalBody.querySelector(`#${errorId}`);
            const raw = String(input.value).trim().replace(',', '.');
            const parsed = parseFloat(raw);
            let message = null;
            if (raw === '' || isNaN(parsed)) message = `${label} : valeur numérique requise.`;
            else if (parsed < 0.1 || parsed > 500) message = `${label} : doit être compris entre 0.1 et 500.`;
            input.style.borderColor = message ? '#dc3545' : '';
            if (errorEl) { errorEl.style.display = message ? 'block' : 'none'; errorEl.textContent = message || ''; }
            return !message;
        };
        const onContourDimChange = () => {
            const lengthOk = validateContourDimInput(CM.contourLengthInput, 'calepinageMaisonContourLengthInputError', 'Longueur');
            const widthOk = validateContourDimInput(CM.contourWidthInput, 'calepinageMaisonContourWidthInputError', 'Largeur');
            if (lengthOk && widthOk) applyContourDims();
        };
        CM.contourLengthInput.addEventListener('change', onContourDimChange);
        CM.contourWidthInput.addEventListener('change', onContourDimChange);

        // NOUVEAU (demande explicite : "champ azimut pour faire la rotation des panneaux dans le cas
        // du polygone libre") : lit/écrit CM.state.polygonAzimuthDeg, recalcule angle/azimut de tous
        // les pans depuis cette référence constante (CM.angleForAzimuth) — même séquence
        // render()/recomputeResults() que le bouton "Changer l'azimut" existant (cmFlipAzimuthBtn).
        CM.polygonAzimuthWrapper = CM.modalBody.querySelector('#calepinageMaisonPolygonAzimuthWrapper');
        CM.polygonAzimuthInput = CM.modalBody.querySelector('#calepinageMaisonPolygonAzimuthInput');
        CM.polygonAzimuthInput.addEventListener('change', () => {
            let val = parseFloat(CM.polygonAzimuthInput.value);
            if (isNaN(val)) val = 0;
            val = Math.max(-180, Math.min(180, val));
            CM.polygonAzimuthInput.value = val;
            CM.state.polygonAzimuthDeg = val;
            const refAngle = CM.angleForAzimuth(val);
            CM.state.pans.forEach((pan) => CM.applyReferenceAngleToPan(pan, refAngle));
            CM.render();
            CM.recomputeResults();
        });

        // CORRECTIF (demande explicite : "mettre les unités en mm") : unitDivisor 1000 (mm -> m),
        // au lieu de 100 (cm -> m) — CM.state.overhangRampant/overhangLongpan restent en mètres.
        wireCmValidatedInput('calepinageMaisonOverhangRampant', 'calepinageMaisonOverhangRampantError',
            { min: 0, max: 5000, label: 'Porte-à-faux rampant', unitDivisor: 1000 }, (value) => {
                CM.state.overhangRampant = value;
                CM.render(); CM.recomputeResults();
            });
        wireCmValidatedInput('calepinageMaisonOverhangLongpan', 'calepinageMaisonOverhangLongpanError',
            { min: 0, max: 5000, label: 'Porte-à-faux longpan', unitDivisor: 1000 }, (value) => {
                CM.state.overhangLongpan = value;
                CM.render(); CM.recomputeResults();
            });

        CM.viewToggleBtn = CM.modalBody.querySelector('#calepinageMaisonViewToggleBtn');
        CM.viewToggleBtn.addEventListener('click', () => {
            CM.state.viewMode = CM.state.viewMode === 'aligned' ? 'real' : 'aligned';
            updateViewToggleUI();
            CM.computeFit();
            CM.render();
        });

        // NOUVEAU (demande explicite) : sélecteur "Vue 2D/3D" — bascule vers/depuis la visionneuse 3D
        // Babylon (2e canevas superposé en place, cf. calepinage_maison_3d_viewer.js). updateView2D3DUI()
        // est rappelé par open3DView()/close3DView() ; garde-fou si le module 3D n'est pas chargé.
        CM.modalBody.querySelector('#cmView2D3DBtn').addEventListener('click', () => {
            if (typeof CM.toggle3DView === 'function') {
                CM.toggle3DView();
            } else {
                CM.state.view3DMode = !CM.state.view3DMode;
                updateView2D3DUI();
            }
        });

        CM.panToolBtn = CM.modalBody.querySelector('#cmPanToolBtn');
        CM.panToolBtn.addEventListener('click', () => {
            CM.state.panToolActive = !CM.state.panToolActive;
            if (CM.state.panToolActive) { CM.state.panelToolMode = 'none'; updatePanelToolButtonsUI(); }
            updatePanToolUI();
        });
        CM.modalBody.querySelector('#cmMovePanelsBtn').addEventListener('click', () => {
            CM.state.panelToolMode = CM.state.panelToolMode === 'move' ? 'none' : 'move';
            if (CM.state.panelToolMode !== 'none') { CM.state.panToolActive = false; updatePanToolUI(); }
            updatePanelToolButtonsUI();
        });
        CM.modalBody.querySelector('#cmDeletePanelsBtn').addEventListener('click', () => {
            CM.state.panelToolMode = CM.state.panelToolMode === 'delete' ? 'none' : 'delete';
            if (CM.state.panelToolMode !== 'none') { CM.state.panToolActive = false; updatePanToolUI(); }
            updatePanelToolButtonsUI();
        });
        // 2026-10-09 : suppression par rectangle et déplacement du champ PV (cf. calepinage_maison_dessin.js).
        [['#cmDeletePanelsRectBtn', 'deleteRect'], ['#cmMoveFieldBtn', 'moveField']].forEach(([sel, mode]) => {
            const btn = CM.modalBody.querySelector(sel);
            if (!btn) return;
            btn.addEventListener('click', () => {
                CM.state.panelToolMode = CM.state.panelToolMode === mode ? 'none' : mode;
                if (CM.state.panelToolMode !== 'none') { CM.state.panToolActive = false; updatePanToolUI(); }
                updatePanelToolButtonsUI();
            });
        });
        CM.modalBody.querySelector('#cmZoomInBtn').addEventListener('click', () => {
            CM.state.zoomFactor = Math.min(5, CM.state.zoomFactor * 1.25);
            CM.render();
        });
        CM.modalBody.querySelector('#cmZoomOutBtn').addEventListener('click', () => {
            CM.state.zoomFactor = Math.max(0.25, CM.state.zoomFactor / 1.25);
            CM.render();
        });
        CM.modalBody.querySelector('#cmFitViewBtn').addEventListener('click', () => {
            CM.computeFit();
            CM.render();
        });

        // NOUVEAU (demande explicite : "voir tous les champs PV sur la même vue") : bascule le mode
        // d'affichage combiné (lecture seule) — CM.multiHouseViewActive n'est pas dans CM.state
        // (transverse, ne doit pas être réinitialisé en changeant de maison active).
        CM.modalBody.querySelector('#cmMultiHouseViewBtn').addEventListener('click', () => {
            CM.multiHouseViewActive = !CM.multiHouseViewActive;
            updateMultiHouseViewUI();
            if (!CM.multiHouseViewActive && typeof CM.restaurerFondAvantVueMulti === 'function') CM.restaurerFondAvantVueMulti();
            CM.computeFit();
            CM.render();
            // La capture de fond ne couvrait que le champ affiché : les autres champs tombaient hors de
            // l'image, qui paraissait alors décalée à côté des formes. Recapture si nécessaire.
            if (CM.multiHouseViewActive && typeof CM.assurerFondCarteVueMulti === 'function') {
                CM.assurerFondCarteVueMulti().catch((err) => console.warn('[Calepinage] Fond de carte vue multi-champs', err));
            }
            // La 3D suit la même règle d'affichage des autres champs PV (cf. buildResidential3DModel).
            if (typeof CM.refresh3DView === 'function') CM.refresh3DView();
        });

        // CORRECTIF (demande explicite : "déplacer les toggles d'affichage dans l'en-tête persistant
        // du modal") : Formulaire/Barre d'outils/Carte Résultats partagent tous le même comportement
        // (bascule display:none d'une cible) — un seul câblage générique piloté par
        // CalepinageMaisonToolbarConfig.headerToggles, au lieu d'un handler dédié par bouton. Ces 3
        // boutons vivent désormais dans `header` (jamais masqué), pas dans CM.modalBody — recherchés
        // via CM.modal (parent commun des deux). État ni persisté ni dans CM.state (purement visuel,
        // ne doit pas survivre à un changement de source ni être sauvegardé) — même principe que
        // l'ancien comportement de #cmToggleLeftPanelBtn.
        (window.CalepinageMaisonToolbarConfig ? window.CalepinageMaisonToolbarConfig.headerToggles : []).forEach((t) => {
            const btn = CM.modal.querySelector(`#${t.id}`);
            const target = CM.modal.querySelector(t.target);
            if (!btn || !target) return;
            // CORRECTIF (bug rapporté : icônes désalignées après masquage/réaffichage) : #cmToolbar a
            // "display:flex" en style INLINE — remettre display à '' le faisait retomber en 'block'.
            // On mémorise le display inline d'origine et on le restaure.
            const origDisplay = target.style.display || '';
            btn.addEventListener('click', () => {
                const nowHidden = target.style.display !== 'none';
                target.style.display = nowHidden ? 'none' : origDisplay;
                btn.classList.toggle('cm-header-toggle-off', nowHidden);
            });
        });
        wireObstaclesMenuToggle();
        if (typeof CM.wireAnnotationsToolbar === 'function') CM.wireAnnotationsToolbar();

        wireCmValidatedInput('calepinageMaisonPenteInput', 'calepinageMaisonPenteInputError',
            { min: 0, max: 90, label: 'Pente toiture 1' }, (value) => {
                CM.state.penteDeg = value;
                // Pente partagée avec le pompage solaire (cf. calepinage_maison_parametres_pompage.js).
                CM.signalerSaisieParametre(CM.state, 'penteDeg');
                CM.render(); CM.recomputeResults(); // recomputeResults() rebâtit aussi la 3D si ouverte
                if (CM.coupeModal && CM.coupeModal.style.display !== 'none') CM.renderCoupe();
            });
        // NOUVEAU (demande explicite) : pente du 2e pan (toiture 2 pans asymétrique), 0-90°.
        wireCmValidatedInput('calepinageMaisonPente2Input', 'calepinageMaisonPente2InputError',
            { min: 0, max: 90, label: 'Pente toiture 2' }, (value) => {
                CM.state.penteDeg2 = value;
                CM.render(); CM.recomputeResults();
                if (CM.coupeModal && CM.coupeModal.style.display !== 'none') CM.renderCoupe();
            });
        // NOUVEAU (demande explicite, génération 3D) : Hauteur bâtiment (sol -> gouttière), 0,2-25 m.
        // Petit champ solaire : le même champ porte la « Hauteur bas PV » (0,3-5 m), cf.
        // appliquerChampHauteurBasPv().
        wireCmValidatedInput('calepinageMaisonBatimentHeightInput', 'calepinageMaisonBatimentHeightError',
            () => (estPetitChamp() ? HAUTEUR_BAS_PV
                : (estOmbriereMetal() ? HAUTEUR_EGOUT_OMBRIERE : { min: 0.2, max: 25, label: 'Hauteur bâtiment' })), (value) => {
                if (estPetitChamp()) {
                    CM.state.petitChampLowPointHeightM = value;
                    CM.recomputeResults();
                    return;
                }
                CM.state.batimentHeightM = value;
                if (typeof CM.refresh3DView === 'function') CM.refresh3DView();
            });
        // NOUVEAU (demande explicite) : "Entraxes poteaux" de l'ombrière. Champ TEXTE (expression
        // "4*10.5 + 2*8"), donc hors wireCmValidatedInput qui ne traite que du numérique ; même
        // contrat néanmoins : la valeur est REJETÉE si elle est invalide (message sous le champ,
        // saisie conservée à l'écran, état inchangé), jamais corrigée en silence.
        // La validation est celle, partagée, de CM.validerEntraxeOmbriere (calculs.js) : le
        // formulaire 3D et les modales de géométrie acceptent donc exactement les mêmes saisies.
        const entraxeInputEl = CM.modalBody.querySelector('#calepinageMaisonOmbriereEntraxeInput');
        const entraxeErrorEl = CM.modalBody.querySelector('#calepinageMaisonOmbriereEntraxeInputError');
        if (entraxeInputEl) entraxeInputEl.addEventListener('input', () => {
            // Règles par famille (valeurs strictement positives, max 12,50 m métal / 7,80 m bois,
            // somme + porte-à-faux <= longueur) : CM.poteauxOmbriere.validerEntraxesLongitudinaux.
            const P = CM.poteauxOmbriere;
            const v = (P && typeof P.validerEntraxesLongitudinaux === 'function')
                ? P.validerEntraxesLongitudinaux(CM.state, entraxeInputEl.value, longueurOmbriereCourante())
                : CM.validerEntraxeOmbriere(entraxeInputEl.value);
            let message = v.message;
            // CORRECTIF (bug rapporté : « les poteaux s'affichent pour 4*10 mais plus dès que
            // j'ajoute +7 », un seul poteau restant à l'écran) : une somme d'entraxes plus longue que
            // l'ombrière rend négatif le porte-à-faux droit que la modale de géométrie en déduit
            // (`longueur - p-à-f gauche - somme`), et son dessin de façade s'effondre — sans le
            // moindre message. On le dit, avec la longueur disponible.
            if (v.ok && v.expr) {
                const dispo = longueurOmbriereCourante();
                const somme = CM.longueurEntraxeOmbriere(v.expr);
                if (dispo > 0 && somme > dispo + 0.01) {
                    message = 'Entraxes : la somme (' + somme.toFixed(2) + ' m) dépasse la longueur de '
                        + "l'ombrière (" + dispo.toFixed(2) + ' m).';
                }
            }
            const ok = v.ok && !message;
            entraxeInputEl.style.borderColor = ok ? '' : '#dc3545';
            if (entraxeErrorEl) {
                entraxeErrorEl.style.display = ok ? 'none' : 'block';
                entraxeErrorEl.textContent = message || '';
            }
            if (!ok) return;
            // Vide -> null : "entraxe automatique", et non "chaîne vide" (que la 3D lirait comme
            // une expression sans aucune travée).
            CM.state.ombriereEntraxeExpr = v.expr || null;
            CM.recomputeResults(); // persiste + rejoue la 3D si elle est ouverte
            // Porte-à-faux affichés (déduits de la somme des entraxes).
            if (typeof CM.majChampsPoteauxUI === 'function') CM.majChampsPoteauxUI();
        });
        // Entraxes transversaux, excentrement, axes / ancrages sur la carte
        // (calepinage_maison_poteaux_ombriere.js).
        if (typeof CM.brancherChampsPoteaux === 'function') CM.brancherChampsPoteaux();

        // NOUVEAU (demande explicite) : hauteur d'acrotère (toiture terrasse), 0-5 m. Effet 3D seul.
        wireCmValidatedInput('calepinageMaisonAcrotereInput', 'calepinageMaisonAcrotereInputError',
            { min: 0, max: 5, label: 'Hauteur acrotère' }, (value) => {
                CM.state.acrotereHeightM = value;
                if (typeof CM.refresh3DView === 'function') CM.refresh3DView();
            });
        // Bornes des champs shed = celles du serveur (calepinage_dimensionnement_schemas.py::
        // valider_champs_geometrie_toiture, qui fait référence — demande explicite) : Esp. entre
        // sheds 300-10000 mm, Nb. PV par shed 1-15, Nb. PV en long. 0-50, Esp. groupe 0-2000 mm.
        // Mêmes bornes dans le formulaire PRO (calepinage.html : #shedsColSpacing, #shedsCols,
        // #shedsRows, #shedsRowSpacing). Une valeur acceptée ici qui serait refusée par le serveur
        // ferait échouer TOUTE la sauvegarde en base du projet.
        // unitDivisor 1000 (mm -> m) : CM.state.shedSpacingM reste en mètres en interne (moteur de
        // calcul inchangé, calepinage_maison_calculs.js).
        wireCmValidatedInput('calepinageMaisonShedSpacingInput', 'calepinageMaisonShedSpacingInputError',
            { min: 300, max: 10000, label: 'Espacement entre shed', unitDivisor: 1000 }, (value) => {
                CM.state.shedSpacingM = value;
                CM.render(); CM.recomputeResults();
            });
        wireCmValidatedInput('calepinageMaisonShedGroupInput', 'calepinageMaisonShedGroupInputError',
            { min: 1, max: 15, integer: true, label: 'Nb. PV par shed' }, (value) => {
                CM.state.shedPanelsPerGroup = value;
                updateShedRegularAvailability();
                CM.render(); CM.recomputeResults();
            });
        wireCmValidatedInput('calepinageMaisonShedPanelsPerRowInput', 'calepinageMaisonShedPanelsPerRowInputError',
            { min: 0, max: 50, integer: true, label: 'Nb. PV en long. par shed' }, (value) => {
                CM.state.shedPanelsPerRow = value;
                updateShedRegularAvailability();
                CM.render(); CM.recomputeResults();
            });
        wireCmValidatedInput('calepinageMaisonShedRowGroupSpacingInput', 'calepinageMaisonShedRowGroupSpacingInputError',
            { min: 0, max: 2000, label: 'Esp. groupe de shed', unitDivisor: 1000 }, (value) => {
                CM.state.shedRowGroupSpacingM = value;
                updateShedRegularAvailability();
                CM.render(); CM.recomputeResults();
            });
        CM.modalBody.querySelector('#calepinageMaisonShedRegularCheckbox').addEventListener('change', (e) => {
            CM.state.shedRegularAlignment = e.target.checked;
            CM.render(); CM.recomputeResults();
        });
        // "Hauteur bas PV (m)" du petit champ solaire — 0,3–5 m (saisie en m, stockée en m).
        wireCmValidatedInput('calepinageMaisonPetitChampLowHeightInput', 'calepinageMaisonPetitChampLowHeightInputError',
            HAUTEUR_BAS_PV, (value) => {
                CM.state.petitChampLowPointHeightM = value;
                CM.recomputeResults();
            });
        wireCmValidatedInput('calepinageMaisonDomeSpacingInput', 'calepinageMaisonDomeSpacingInputError',
            { min: 0, max: 10000, label: 'Espacement entre dômes', unitDivisor: 1000 }, (value) => {
                CM.state.domeSpacingM = value;
                CM.render(); CM.recomputeResults();
            });
        wireCmValidatedInput('calepinageMaisonDomePanelSpacingInput', 'calepinageMaisonDomePanelSpacingInputError',
            { min: 10, max: 300, label: 'Espacement entre les 2 panneaux d\'un dôme', unitDivisor: 1000 }, (value) => {
                CM.state.domePanelSpacingM = value;
                CM.render(); CM.recomputeResults();
            });
        wireCmValidatedInput('calepinageMaisonDomeTiltInput', 'calepinageMaisonDomeTiltInputError',
            { min: 0, max: 50, label: 'Inclinaison du dôme' }, (value) => {
                CM.state.domeTiltDeg = value;
                CM.render(); CM.recomputeResults();
            });
        wireCmValidatedInput('calepinageMaisonDomePanelsPerRowInput', 'calepinageMaisonDomePanelsPerRowInputError',
            { min: 2, max: 14, integer: true, pair: true, label: 'Nb. PV par rangée de dôme' }, (value) => {
                CM.state.domePanelsPerRow = value;
                CM.render(); CM.recomputeResults();
            });
        // CORRECTIF (demande explicite : champ saisi en mm désormais, cf. le <label> ci-dessus) :
        // CM.state.edgeClearanceM reste en mètres en interne — conversion /1000 au lieu de /100.
        wireCmValidatedInput('calepinageMaisonEdgeClearanceInput', 'calepinageMaisonEdgeClearanceInputError',
            { min: 0, max: 10000, label: 'Espacement bordure', unitDivisor: 1000 }, (value) => {
                CM.state.edgeClearanceM = value;
                CM.render(); CM.recomputeResults();
            });
        // unitDivisor 2000 : la saisie est un TOTAL en mm cumulé sur 2 côtés (cf. commentaire HTML
        // ci-dessus) ; l'état stocke la valeur PAR CÔTÉ, en mètres — (total_mm / 2) / 1000 = total_mm
        // / 2000. CORRECTIF (demande explicite) : plage 20-600 -> 20-2000mm.
        wireCmValidatedInput('calepinageMaisonRidgeClearanceInput', 'calepinageMaisonRidgeClearanceInputError',
            { min: 20, max: 2000, label: 'Largeur faîtage', unitDivisor: 2000 }, (value) => {
                CM.state.ridgeClearanceEachSideM = value;
                CM.render(); CM.recomputeResults();
            });

        // RETIRÉ (demande explicite) : #calepinageMaisonStructureCheckbox — remplacé par
        // #cmToggleShowStructureBtn, câblé dans wireVisibilityToggleButtons() ci-dessous.

        CM.modalBody.querySelector('#calepinageMaisonCoupeBtn').addEventListener('click', openCoupeModal);
        CM.modalBody.querySelector('#calepinageMaisonStructureDetailsBtn').addEventListener('click', openStructureDetailsModal);

        CM.modalBody.querySelector('#cmPanelLength').value = CM.state.panelLengthMm;
        CM.modalBody.querySelector('#cmPanelWidth').value = CM.state.panelWidthMm;
        CM.modalBody.querySelector('#cmPanelThickness').value = CM.state.panelThicknessMm;
        CM.modalBody.querySelector('#cmPanelSpacingX').value = CM.state.panelSpacingXMm;
        CM.modalBody.querySelector('#cmPanelSpacingY').value = CM.state.panelSpacingYMm;
        CM.modalBody.querySelector('#cmRailWidth').value = CM.state.railWidthMm;

        wireCmValidatedInput('cmPanelLength', 'cmPanelLengthError',
            { min: 1000, max: 3500, label: 'Longueur du panneau' }, (value) => {
                CM.state.panelLengthMm = value;
                CM.render(); CM.recomputeResults();
            });
        wireCmValidatedInput('cmPanelWidth', 'cmPanelWidthError',
            { min: 1000, max: 3500, label: 'Largeur du panneau' }, (value) => {
                CM.state.panelWidthMm = value;
                CM.render(); CM.recomputeResults();
            });
        wireCmValidatedInput('cmPanelThickness', 'cmPanelThicknessError',
            { min: 20, max: 50, label: 'Épaisseur du panneau' }, (value) => {
                CM.state.panelThicknessMm = value;
            });
        // Borne basse 0 (et non plus 3) : plusieurs systèmes d'intégration de la base ont un
        // espacement inférieur à 3 mm (Mecosun 1 mm, Jorissolar RS-Park2 1,5 mm, Solumbra 0 mm en Y).
        wireCmValidatedInput('cmPanelSpacingX', 'cmPanelSpacingXError',
            { min: 0, max: 30, label: 'Espacement X' }, (value) => {
                CM.state.panelSpacingXMm = value;
                CM.render(); CM.recomputeResults();
            });
        wireCmValidatedInput('cmPanelSpacingY', 'cmPanelSpacingYError',
            { min: 0, max: 30, label: 'Espacement Y' }, (value) => {
                CM.state.panelSpacingYMm = value;
                CM.render(); CM.recomputeResults();
            });
        // NOUVEAU (demande explicite) : "Largeur rail" — n'entre dans AUCUN calcul de pose (les
        // panneaux ne bougent pas), seulement dans la longueur d'ombrière transmise aux plans de
        // coupe/façade : ni render() ni recalcul de grille ici, recomputeResults() suffit pour la
        // persistance.
        wireCmValidatedInput('cmRailWidth', 'cmRailWidthError',
            { min: 100, max: 250, label: 'Largeur rail' }, (value) => {
                CM.state.railWidthMm = value;
                CM.recomputeResults();
            });
        // Joints de dilatation : ils déplacent les panneaux (tronçons), d'où render() + recalcul.
        const J = CM.JOINT_DILATATION;
        CM.modalBody.querySelector('#cmJointDilatation').value = CM.state.jointDilatationMm;
        CM.modalBody.querySelector('#cmJointDilatationLimite').value = CM.state.jointDilatationLimiteM;
        wireCmValidatedInput('cmJointDilatation', 'cmJointDilatationError',
            { min: J.largeurMinMm, max: J.largeurMaxMm, label: 'Largeur joint de dilatation' }, (value) => {
                CM.state.jointDilatationMm = value;
                CM.render(); CM.recomputeResults();
            });
        const T = CM.SEPARATION_TERRASSE;
        CM.modalBody.querySelector('#cmTerrasseSeparation').value = CM.state.terrasseSeparationMm;
        wireCmValidatedInput('cmTerrasseSeparation', 'cmTerrasseSeparationError',
            { min: T.largeurMinMm, max: T.largeurMaxMm, label: 'Largeur séparation' }, (value) => {
                CM.state.terrasseSeparationMm = value;
                CM.render(); CM.recomputeResults();
            });
        const jointSurLimite = CM.modalBody.querySelector('#cmJointDilatationSurLimite');
        jointSurLimite.checked = CM.state.jointDilatationRepartition === 'limite';
        jointSurLimite.addEventListener('change', (e) => {
            CM.state.jointDilatationRepartition = e.target.checked ? 'limite' : 'egale';
            CM.render(); CM.recomputeResults();
        });
        wireCmValidatedInput('cmJointDilatationLimite', 'cmJointDilatationLimiteError',
            { min: J.limiteMinM, max: J.limiteMaxM, label: 'Longueur limite joint' }, (value) => {
                CM.state.jointDilatationLimiteM = value;
                CM.render(); CM.recomputeResults();
            });
        // NOUVEAU (branchement au calcul global de production, cf. orchestrateur.js::
        // getAllPvFieldSummaries) : champs minimaux du contrat PvFieldSummary — pas de recalcul
        // géométrique/rendu nécessaire (n'affectent ni les panneaux ni le contour), juste l'état +
        // la persistance (recomputeResults() la déclenche déjà en fin de fonction).
        CM.modalBody.querySelector('#cmPanelRef').addEventListener('input', (e) => {
            CM.state.panelRef = e.target.value;
            CM.recomputeResults();
        });
        wireCmValidatedInput('cmPanelPowerWc', 'cmPanelPowerWcError',
            { min: 100, max: 1000, label: 'Puissance du panneau' }, (value) => {
                CM.state.panelPowerWc = value;
                CM.recomputeResults();
            });
        wireCmValidatedInput('cmPerteSysteme', 'cmPerteSystemeError',
            { min: 6, max: 30, label: 'Pertes système' }, (value) => {
                CM.state.perteSysteme = value;
                CM.signalerSaisieParametre(CM.state, 'perteSysteme');
                CM.recomputeResults();
            });
        // CORRECTIF (demande explicite : "liste déroulante qui doit afficher soit la valeur 1 ou 2") :
        // remplace le champ texte libre — le <select> garantit nativement une valeur valide, plus
        // besoin de validation ici (change au lieu de input, comme les autres <select> du formulaire).
        CM.modalBody.querySelector('#cmAffectationCentrale').addEventListener('change', (e) => {
            CM.state.affectationCentrale = e.target.value;
            CM.recomputeResults();
        });
        construireBoutonsTypeMontage();
        CM.modalBody.querySelector('#cmTypeMontageSelect').addEventListener('change', (e) => {
            const wasTerrasse = CM.normalizeTypeMontage(CM.state.typeMontage) === 'toiture_terrasse';
            const prevType = CM.normalizeTypeMontage(CM.state.typeMontage);
            CM.state.typeMontage = e.target.value;
            // Changement de type -> les surcharges 3D (ombrière / petit champ) d'un type précédent ne valent plus.
            if (CM.normalizeTypeMontage(CM.state.typeMontage) !== prevType) {
                CM.state.ombriereParams = null;
                CM.state.petitChampParams = null;
            }
            // NOUVEAU (demande explicite) : en passant sur "Toiture terrasse", la pente par défaut
            // devient 3° (croupe basse pente). On ne le fait qu'à la BASCULE vers terrasse.
            // Projet avec pompage solaire : la pente reste celle du pompage (CM.penteImposeeParPompage).
            if (!wasTerrasse && CM.normalizeTypeMontage(CM.state.typeMontage) === 'toiture_terrasse' && !CM.penteImposeeParPompage()) {
                CM.state.penteDeg = 3;
                const penteInput = CM.modalBody.querySelector('#calepinageMaisonPenteInput');
                if (penteInput) penteInput.value = 3;
            }
            // Demande explicite : "Pente toiture 1" vaut 8° par défaut pour une ombrière métal. Même
            // règle que la terrasse : seulement à la BASCULE vers ce type (une pente saisie ensuite,
            // ou relue d'un projet enregistré, n'est jamais écrasée).
            if (prevType !== 'ombriere_metal' && CM.normalizeTypeMontage(CM.state.typeMontage) === 'ombriere_metal' && !CM.penteImposeeParPompage()) {
                CM.state.penteDeg = 8;
                const penteInput = CM.modalBody.querySelector('#calepinageMaisonPenteInput');
                if (penteInput) penteInput.value = 8;
            }
            // Demande explicite : « Esp. bordure » vaut 900 mm en toiture terrasse, 250 mm en toiture
            // résidentielle / bâtiment incliné. Remplacé à la bascule seulement si la valeur courante
            // est encore un défaut (une saisie de l'utilisateur n'est jamais écrasée).
            const edgeDefautNouveau = CM.edgeClearanceDefautM(CM.state.typeMontage);
            if (CM.normalizeTypeMontage(CM.state.typeMontage) !== prevType
                && CM.EDGE_CLEARANCE_DEFAUTS_M.some((d) => Math.abs((CM.state.edgeClearanceM || 0) - d) < 1e-6)
                && Math.abs(CM.state.edgeClearanceM - edgeDefautNouveau) > 1e-6) {
                CM.state.edgeClearanceM = edgeDefautNouveau;
                const edgeInput = CM.modalBody.querySelector('#calepinageMaisonEdgeClearanceInput');
                if (edgeInput) edgeInput.value = Math.round(edgeDefautNouveau * 1000);
            }
            // NOUVEAU (demande explicite : lier le type de structure aux boutons de calepinage
            // disponibles) : effet immédiat au changement de sélection, sans attendre une réouverture
            // du modal (updatePoseModeUI masque/affiche les boutons pertinents et rebascule le mode
            // actif si besoin).
            syncOmbriereDivision(); // ombrière : le modèle proposé suit la géométrie de toiture
            // Demande explicite : petit champ solaire orienté PLEIN SUD par défaut. Le type est choisi
            // APRÈS le tracé (le champ naît en 'toiture_residentielle', puis reçoit le type du
            // formulaire PRO) : l'orientation doit donc être re-dérivée à la bascule vers / depuis ce
            // type (cf. angleReferenceStable). Toiture non divisée seulement, comme le bouton azimut.
            const nouveauType = CM.normalizeTypeMontage(CM.state.typeMontage);
            if (nouveauType !== prevType && (nouveauType === 'champ_solaire' || prevType === 'champ_solaire')
                && CM.state.divisionMode === 'none' && (CM.state.pans || []).length === 1) {
                CM.applyReferenceAngleToPan(CM.state.pans[0], CM.angleReferenceStable(CM.state));
            }
            // La liste des systèmes d'intégration dépend du type : une référence absente de la
            // nouvelle liste est oubliée (les espacements déjà appliqués restent, modifiables).
            if (typeof CM.trouverSysteme === 'function' && CM.state.systemeIntegrationRef
                && !CM.trouverSysteme(CM.state.typeMontage, CM.state.systemeIntegrationRef)) {
                CM.state.systemeIntegrationRef = '';
            }
            updateEquipmentFieldsUI();
            updatePoseModeUI();
            CM.render();
            CM.recomputeResults();
        });
        // Modèle d'ombrière (métal / bois) : régénère la 3D à partir du modèle choisi. On efface les
        // surcharges 3D (ombriereParams) : elles étaient propres à l'ancien modèle (entraxes,
        // excentrement...) et faisaient diverger la 3D du modèle sélectionné (bug rapporté).
        const ombMetalSelEl = CM.modalBody.querySelector('#calepinageMaisonOmbriereMetalModel');
        if (ombMetalSelEl) ombMetalSelEl.addEventListener('change', (e) => {
            CM.state.ombriereMetalModel = e.target.value;
            CM.state.ombriereParams = null;
            syncOmbriereDivision({ suivreModele: true }); // choix explicite : la géométrie suit le modèle
            updatePoseModeUI();
            CM.render();
            CM.recomputeResults();
        });
        const ombMetalVarSelEl = CM.modalBody.querySelector('#calepinageMaisonOmbriereMetalVariant');
        if (ombMetalVarSelEl) ombMetalVarSelEl.addEventListener('change', (e) => {
            CM.state.ombriereMetalBracingVariant = e.target.value;
            CM.recomputeResults(); // persiste + rejoue la 3D (et la modale de géométrie) si ouvertes
        });
        const ombBoisSelEl = CM.modalBody.querySelector('#calepinageMaisonOmbriereBoisModel');
        if (ombBoisSelEl) ombBoisSelEl.addEventListener('change', (e) => {
            CM.state.ombriereBoisModel = e.target.value;
            CM.state.ombriereParams = null;
            syncOmbriereDivision({ suivreModele: true }); // choix explicite : la géométrie suit le modèle
            updatePoseModeUI();
            CM.render();
            CM.recomputeResults();
        });
        // Modèle de petit champ solaire : régénère la 3D (calepinage shed). Efface les surcharges 3D.
        const petitChampSelEl = CM.modalBody.querySelector('#calepinageMaisonPetitChampModel');
        if (petitChampSelEl) petitChampSelEl.addEventListener('change', (e) => {
            CM.state.petitChampModel = e.target.value;
            CM.state.petitChampParams = null;
            updatePoseModeUI(); // affiche/masque la variante Double Poteaux
            CM.recomputeResults();
        });
        const petitChampVariantSelEl = CM.modalBody.querySelector('#calepinageMaisonPetitChampVariant');
        if (petitChampVariantSelEl) petitChampVariantSelEl.addEventListener('change', (e) => {
            CM.state.petitChampBracingVariant = e.target.value;
            CM.recomputeResults();
        });
        wireCmValidatedInput('cmOnduleurPuissance', 'cmOnduleurPuissanceError',
            { min: 0.2, max: 5000, label: 'Puissance onduleur' }, (value) => {
                CM.state.onduleurPuissanceKva = value;
                CM.recomputeResults();
            });
        CM.modalBody.querySelector('#cmOnduleurRendement').addEventListener('input', (e) => {
            CM.state.onduleurRendement = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
            CM.recomputeResults();
        });
        CM.modalBody.querySelector('#cmOnduleurConso').addEventListener('input', (e) => {
            CM.state.onduleurConso = Math.max(0, parseFloat(e.target.value) || 0);
            CM.recomputeResults();
        });

        // NOUVEAU (rapport PDF résidentiel — page "Vos Garanties") : durée de garantie (années),
        // uniformisée 0-20 ans pour les 5 équipements (demande explicite — remplace les bornes
        // disparates précédentes : 0-50 panneau/batterie, 1-10 borne, 1-5 pompage).
        wireCmValidatedInput('cmGarantiePanneauAns', 'cmGarantiePanneauAnsError',
            { min: 0, max: 20, integer: true, label: 'Garantie panneau' }, (value) => {
                CM.state.garantiePanneauAns = value;
                CM.recomputeResults();
            });
        wireCmValidatedInput('cmGarantieOnduleurAns', 'cmGarantieOnduleurAnsError',
            { min: 0, max: 20, integer: true, label: 'Garantie onduleur' }, (value) => {
                CM.state.garantieOnduleurAns = value;
                CM.recomputeResults();
            });
        wireCmValidatedInput('cmGarantieBatterieAns', 'cmGarantieBatterieAnsError',
            { min: 0, max: 20, integer: true, label: 'Garantie batterie' }, (value) => {
                CM.state.garantieBatterieAns = value;
                CM.recomputeResults();
            });
        wireCmValidatedInput('cmGarantieBorneAns', 'cmGarantieBorneAnsError',
            { min: 0, max: 20, integer: true, label: 'Garantie borne de recharge' }, (value) => {
                CM.state.garantieBorneAns = value;
                CM.recomputeResults();
            });
        CM.modalBody.querySelector('#cmBatterieVirtuelleOptin').addEventListener('change', (e) => {
            definirBatterieVirtuelle(e.target.checked);
            afficherBatterieVirtuelle();
        });
        CM.modalBody.querySelector('#cmPompageSolaireActif').addEventListener('change', (e) => {
            CM.state.pompageSolaireActif = e.target.checked;
            const refSelect = CM.modalBody.querySelector('#cmPompageSolaireCatalogSelect');
            if (refSelect) refSelect.disabled = !e.target.checked;
            // NOUVEAU (demande explicite) : champ Garantie pompage solaire, même activation
            // conditionnelle que la Référence (case "Présent" cochée).
            const garantieInput = CM.modalBody.querySelector('#cmGarantiePompageAns');
            if (garantieInput) garantieInput.disabled = !e.target.checked;
            CM.recomputeResults();
        });
        // CORRECTIF (demande explicite : "ajouter les données de pompage solaire aussi") : référence
        // libre -> sélecteur catalogue (/catalogue/pompes-solaires, cf. bd_pompes_solaires.js).
        const pompageSelect = CM.modalBody.querySelector('#cmPompageSolaireCatalogSelect');
        const populatePompageSelect = () => {
            const catalog = window.pompeSolaireCatalogFromApi || [];
            const current = pompageSelect.value;
            pompageSelect.innerHTML = '<option value="">Sélectionner dans le catalogue…</option>' +
                catalog.map((p) => `<option value="${p.reference}">${p.fabricant || ''} ${p.reference || ''}</option>`).join('');
            if (current) pompageSelect.value = current;
        };
        populatePompageSelect();
        document.addEventListener('pompeSolaireCatalogLoaded', populatePompageSelect);
        pompageSelect.addEventListener('change', (e) => {
            CM.state.pompageSolaireRef = e.target.value;
            CM.recomputeResults();
        });

        // NOUVEAU (demande explicite, ajout matériels BD) : carte "Optimiseur" — liste filtrée aux
        // seules références compatibles avec l'onduleur choisi (filtre strict, cf. plan). Recalculée
        // à chaque changement d'onduleur (updateOptimiseurCardVisibility, appelée par
        // updateEquipmentFieldsUI ci-dessus) et dès que le catalogue optimiseurs arrive.
        const optimiseurSelect = CM.modalBody.querySelector('#cmOptimiseurCatalogSelect');
        const populateOptimiseurSelect = () => {
            const catalog = window.optimiseurCatalogFromApi || [];
            const onduleurRef = CM.state.onduleurRef;
            const compatibles = onduleurRef
                ? catalog.filter((o) => (o.compatible_onduleurs || []).some((c) => c.reference === onduleurRef))
                : [];
            const current = optimiseurSelect.value;
            optimiseurSelect.innerHTML = '<option value="">Aucun</option>' +
                compatibles.map((o) => `<option value="${o.reference}">${o.fabricant || ''} ${o.reference || ''}</option>`).join('');
            if (compatibles.some((o) => o.reference === current)) optimiseurSelect.value = current;
            else if (CM.state.optimiseurRef && compatibles.some((o) => o.reference === CM.state.optimiseurRef)) {
                optimiseurSelect.value = CM.state.optimiseurRef;
            }
        };
        CM.updateOptimiseurCardVisibility = () => {
            const container = CM.modalBody.querySelector('#cmOptimiseurCardContainer');
            const dbMatch = (window.onduleurCatalogFromApi || []).find((o) => o.reference === CM.state.onduleurRef);
            const compatible = !!(dbMatch && (dbMatch.compat_optimiseur || dbMatch.hybride));
            // Site autonome en Pompage solaire : carte masquée (demande explicite), cf. siteAutonomePompage.
            if (container) container.style.display = (compatible && !siteAutonomePompage()) ? '' : 'none';
            populateOptimiseurSelect();
        };
        document.addEventListener('optimiseurCatalogLoaded', () => CM.updateOptimiseurCardVisibility());
        optimiseurSelect.addEventListener('change', (e) => {
            CM.state.optimiseurRef = e.target.value || null;
            CM.modalBody.querySelector('#cmOptimiseurRef').value = CM.state.optimiseurRef || '';
            CM.recomputeResults();
        });
        wireCmValidatedInput('cmGarantieOptimiseurAns', 'cmGarantieOptimiseurAnsError',
            { min: 0, max: 20, integer: true, label: 'Garantie optimiseur' }, (value) => {
                CM.state.garantieOptimiseurAns = value;
                CM.recomputeResults();
            });
        // CORRECTIF (demande explicite) : garantie pompage solaire uniformisée 0-20 ans (au lieu de
        // 1-5), même règle que les 4 autres équipements ci-dessus.
        wireCmValidatedInput('cmGarantiePompageAns', 'cmGarantiePompageAnsError',
            { min: 0, max: 20, integer: true, label: 'Garantie pompage solaire' }, (value) => {
                CM.state.garantiePompageAns = value;
                CM.recomputeResults();
            });

        // RETIRÉ (demande explicite) : #cmPlanningJ* — déplacés vers parametre.html
        // (#planning-realisation-wrapper), cf. commentaire près de leur ancien emplacement HTML
        // plus haut dans ce fichier.

        // NOUVEAU (bug rapporté : "je ne sais pas comment choisir les équipements") : catalogues
        // panneaux/onduleurs/batteries déjà chargés ailleurs dans l'application (fetchPanelCatalog
        // -> window.panelCatalogFromApi, cf. bd_panneaux_pv.js ; window.inverterDB, cf.
        // bd_onduleurs.js ; window.batteryDB, cf. bd_batteries.js) — réutilisés en lecture seule ici
        // via de simples <select>, sans cloner les modales/formulaires du calepinage rectangulaire
        // (ce module reste utilisé de façon autonome, cf. demande explicite).
        setupEquipmentCatalogPickers();

        CM.modalBody.querySelector('#cmOrientationPortrait').addEventListener('click', () => {
            CM.state.panelOrientation = 'portrait';
            updateOrientationUI(); CM.render(); CM.recomputeResults();
        });
        CM.modalBody.querySelector('#cmOrientationPaysage').addEventListener('click', () => {
            CM.state.panelOrientation = 'paysage';
            updateOrientationUI(); CM.render(); CM.recomputeResults();
        });
        // Écouteurs pour les boutons d'action Petit champ solaire (traités par calepinage_maison_sheds_actions.js)
        const btnPcCalc = CM.modalBody.querySelector('#cmPetitChampCalculerBtn');
        if (btnPcCalc) {
            btnPcCalc.addEventListener('click', () => {
                console.log('🔘 [Petit Champ Solaire] Clic Calculer');
                window.dispatchEvent(new CustomEvent('petitChampCalculerClicked', { detail: { state: CM.state, pvId: CM.state.sourceId } }));
            });
        }
        const btnPcRes = CM.modalBody.querySelector('#cmPetitChampResultatsBtn');
        if (btnPcRes) {
            btnPcRes.addEventListener('click', () => {
                console.log('🔘 [Petit Champ Solaire] Clic Résultats');
                window.dispatchEvent(new CustomEvent('petitChampResultatsClicked', { detail: { state: CM.state, pvId: CM.state.sourceId } }));
            });
        }
        const btnPcOpt = CM.modalBody.querySelector('#cmPetitChampOptimisationBtn');
        if (btnPcOpt) {
            btnPcOpt.addEventListener('click', () => {
                console.log('🔘 [Petit Champ Solaire] Clic Optimisation');
                window.dispatchEvent(new CustomEvent('petitChampOptimisationClicked', { detail: { state: CM.state, pvId: CM.state.sourceId } }));
            });
        }
        updateOrientationUI();

        CM.modalBody.querySelector('#cmObstacleWidthInput').addEventListener('input', (e) => {
            const o = CM.state.obstacles.find((ob) => ob.id === CM.state.selectedObstacleId);
            if (!o) return;
            o.w = Math.max(0.05, (parseFloat(e.target.value) || 0) / 100);
            CM.render(); CM.recomputeResults();
        });
        CM.modalBody.querySelector('#cmObstacleHeightInput').addEventListener('input', (e) => {
            const o = CM.state.obstacles.find((ob) => ob.id === CM.state.selectedObstacleId);
            if (!o) return;
            o.h = Math.max(0.05, (parseFloat(e.target.value) || 0) / 100);
            CM.render(); CM.recomputeResults();
        });
        CM.modalBody.querySelector('#cmObstacleBufferInput').addEventListener('input', (e) => {
            const o = CM.state.obstacles.find((ob) => ob.id === CM.state.selectedObstacleId);
            if (!o) return;
            o.buffer = Math.max(0, (parseFloat(e.target.value) || 0) / 100);
            CM.render(); CM.recomputeResults();
        });
        // NOUVEAU (demande explicite) : hauteur 3D — bornée aux limites PROPRES au type d'obstacle
        // (cf. CM.OBSTACLE_TYPES), pas une plage générique. N'affecte que la vue 3D (recomputeResults
        // rappelle refresh3DView() en fin de fonction) — sans effet sur le rendu/calepinage 2D.
        CM.modalBody.querySelector('#cmObstacleElevationInput').addEventListener('input', (e) => {
            const o = CM.state.obstacles.find((ob) => ob.id === CM.state.selectedObstacleId);
            if (!o) return;
            const def = CM.OBSTACLE_TYPES[o.type] || CM.OBSTACLE_TYPES.forme;
            const minEl = def.minElevationM != null ? def.minElevationM : 0.05;
            const maxEl = def.maxElevationM != null ? def.maxElevationM : 5;
            const raw = parseFloat(e.target.value);
            if (isNaN(raw)) return;
            o.elevationM = Math.min(maxEl, Math.max(minEl, raw));
            CM.recomputeResults();
        });

        CM.setupPaletteDrag();
        CM.canvas.addEventListener('mousedown', CM.onCanvasMouseDown);
        CM.canvas.addEventListener('wheel', CM.onCanvasWheel, { passive: false });
        CM.canvas.addEventListener('contextmenu', CM.onCanvasContextMenu);
        document.addEventListener('mousemove', CM.onDocumentMouseMove);
        document.addEventListener('mouseup', CM.onDocumentMouseUp);
        document.addEventListener('keydown', (e) => {
            if (!CM.modal || CM.modal.style.display === 'none') return;
            if (e.key === 'Delete' && CM.state.selectedObstacleId) {
                CM.state.obstacles = CM.state.obstacles.filter((o) => o.id !== CM.state.selectedObstacleId);
                CM.state.selectedObstacleId = null;
                updateObstaclePropertiesPanel();
                CM.render();
                CM.recomputeResults();
            }
            if (e.key === 'Escape' && (CM.state.tracingContourRect || CM.state.drawingContourPolygon)) {
                CM.cancelContourDraw();
            }
        });

        makeDraggable(CM.modal, header);
        setPoseMode(CM.state.poseMode);
    }

    function makeDraggable(modalEl, headerEl) {
        let isDragging = false;
        let startX, startY, initialX, initialY;

        headerEl.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = modalEl.offsetLeft;
            initialY = modalEl.offsetTop;
            headerEl.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            modalEl.style.left = `${initialX + (e.clientX - startX)}px`;
            modalEl.style.top = `${initialY + (e.clientY - startY)}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                headerEl.style.cursor = 'move';
            }
        });
    }

    function renderAzimuths(azimuths) {
        CM.azimuthListEl.innerHTML = (azimuths || []).map((az, idx) => `
            <span style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:4px; padding:2px 8px; font-weight:600;">
                Segment ${idx + 1} : ${az}°
            </span>
        `).join('');
    }

    /**
     * NOUVEAU (demande explicite : "bouton de secours dans le menu pour forcer la réorganisation du
     * calepinage"). Filet de sécurité pour un calepinage rouvert désorienté — panneaux ayant perdu
     * l'azimut du contour (cf. le correctif de fond sur la persistance du mode de tracé, dans
     * calepinage_maison_persistence_db.js / polygon_maison.js).
     *
     * Ne supprime rien et ne touche pas à la division du toit : il re-déduit le mode de tracé depuis
     * la géométrie réelle du contour, le redescend sur le polygone de la carte, puis réaligne
     * l'orientation de TOUS les pans sur cette référence — exactement la même dérivation que celle
     * appliquée après un glissé de sommet (finalizeContourVertexDrag, calepinage_maison_dessin.js)
     * ou une saisie de dimensions (applyContourDims, plus bas).
     */
    function forceRealignCalepinage() {
        if (!CM.state.pans || !CM.state.pans.length) {
            window.alert("Aucun calepinage à réaligner : tracez d'abord un contour.");
            return;
        }

        // 1. Mode de tracé re-déduit de la géométrie : c'est lui qui décide si l'orientation suit le
        //    contour (rectangle) ou une constante plein sud (polygone libre).
        if (CM.state.sourceType === 'maps' && CM.state.currentPolygonRef && window.MaisonPolygonManager) {
            const detecte = window.MaisonPolygonManager.inferModeFromPath(
                CM.state.currentPolygonRef.getPath().getArray()
            );
            CM.state.contourMode = detecte;
            if (window.MaisonPolygonManagerInstance
                && typeof window.MaisonPolygonManagerInstance.setPolygonMode === 'function') {
                window.MaisonPolygonManagerInstance.setPolygonMode(CM.state.currentPolygonRef, detecte);
            }
        }

        // 2. Le pan unique suit le contour vivant (cas d'un toit non divisé), comme après une édition.
        if (CM.state.divisionMode === 'none') CM.state.pans[0].points = CM.state.roofLocal;

        // 3. Orientation re-dérivée puis appliquée à tous les pans.
        const refAngle = CM.angleReferenceStable(CM.state, CM.state.roofLocal);
        CM.state.refAngle = refAngle;
        CM.state.pans.forEach((pan) => CM.applyReferenceAngleToPan(pan, refAngle));

        CM.updateContourDimsUI();
        CM.render();
        CM.recomputeResults(); // persiste aussi l'état corrigé en localStorage
    }

    function wireForceRealignButton() {
        const btn = CM.modalBody && CM.modalBody.querySelector('#cmForceRealignBtn');
        if (btn) btn.addEventListener('click', forceRealignCalepinage);
    }

    /**
     * Boutons de navigation de l'en-tête (demande explicite) : reprennent les entrées du menu
     * horizontal (a[data-nav-step]) — libellé, icône et visibilité selon le parcours (« Profil de
     * consommation » en Site autonome, « Consommation d'énergie » masquée en Chiffrage...). Un clic
     * ferme le modal (état recopié dans le cache local, comme la croix) puis rejoue le clic sur
     * l'entrée du menu : c'est son gestionnaire qui ouvre l'onglet, aucune règle dupliquée ici.
     */
    function lienMenuNavigation(etape) {
        return document.querySelector(`.demo-nav a[data-nav-step="${etape}"]`)
            || document.querySelector(`a[data-nav-step="${etape}"]`);
    }

    function construireNavigationEntete(header) {
        const nav = header.querySelector('#cmHeaderNav');
        if (!nav) return;
        nav.innerHTML = '';
        // Libellés / icônes par défaut ; remplacés par ceux du menu quand il est présent.
        const NAVIGATION_ENTETE = [
            { etape: 'mes-projets', libelle: 'Mes projets', icone: 'fas fa-folder-open' },
            { etape: 'parametres', libelle: 'Paramètres projet', icone: 'fa fa-cogs' },
            { etape: 'cons-energie', libelle: "Consommation d'énergie", icone: 'bi bi-bar-chart-line-fill' },
            { etape: 'calepinage', libelle: 'Calepinage', icone: 'fas fa-solar-panel' },
        ];
        NAVIGATION_ENTETE.forEach(({ etape, libelle, icone }) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cm-header-nav-btn';
            b.setAttribute('data-cm-nav', etape);
            b.innerHTML = `<i class="${icone}" aria-hidden="true"></i><span></span>`;
            b.querySelector('span').textContent = libelle;
            nav.appendChild(b);
        });
        // L'en-tête sert de poignée de déplacement : un appui sur un bouton ne doit pas l'armer.
        nav.addEventListener('mousedown', (e) => e.stopPropagation());
        nav.addEventListener('click', (e) => {
            const b = e.target.closest('[data-cm-nav]');
            if (!b) return;
            e.preventDefault();
            const lien = lienMenuNavigation(b.getAttribute('data-cm-nav'));
            requestCloseModal();
            if (lien) lien.click();
        });
        // Libellés / visibilité relus sur le menu à chaque survol de l'en-tête (le menu peut être
        // rendu après le modal, et ses entrées masquées selon le parcours ou le type d'étude).
        header.addEventListener('mouseenter', () => rafraichirNavigationEntete(header));
        rafraichirNavigationEntete(header);
    }

    function rafraichirNavigationEntete(header) {
        const nav = header && header.querySelector('#cmHeaderNav');
        if (!nav) return;
        nav.querySelectorAll('[data-cm-nav]').forEach((b) => {
            const lien = lienMenuNavigation(b.getAttribute('data-cm-nav'));
            if (!lien) return; // menu absent de la page : libellé par défaut
            const texte = String(lien.textContent || '').replace(/\s+/g, ' ').trim();
            if (texte) b.querySelector('span').textContent = texte;
            const iconeMenu = lien.querySelector('i');
            if (iconeMenu) b.querySelector('i').className = iconeMenu.className;
            const li = lien.closest('li') || lien;
            const masque = window.getComputedStyle(li).display === 'none' || lien.hidden;
            b.style.display = masque ? 'none' : '';
            b.title = texte ? `Aller à « ${texte} »` : '';
        });
    }

    /**
     * Fermeture DEMANDÉE par l'utilisateur (croix du modal, ou clic sur le fond).
     *
     * Demande explicite : plus de dialogue « Fermer le calepinage / Voulez-vous sauvegarder votre
     * projet ? » — l'enregistrement en base se fait par les boutons « Calculer et visualiser » et
     * « Système ». L'état affiché est simplement recopié dans le cache local avant de fermer.
     * closeModal() reste la fermeture technique, appelée telle quelle par les autres chemins.
     */
    function requestCloseModal() {
        try { if (typeof CM.persistCurrentState === 'function') CM.persistCurrentState(); } catch (e) { /* noop */ }
        closeModal();
    }

    /**
     * NOUVEAU (demande explicite : "en fermant le modal, on doit tomber sur le zoom initial ou max
     * avec l'affichage du rectangle ou du polygone sur la carte, cela évitera de chercher le projet
     * sur la carte").
     *
     * Contexte : au chargement d'une page, la carte est cadrée sur le cercle de 3 km de l'adresse du
     * projet (cf. GoogleMaps.js), soit un zoom de l'ordre de 13-14, alors qu'un calepinage se fait
     * vers 19-20. En sortant du modal, l'utilisateur se retrouvait donc loin de sa maison, à la
     * chercher. On recadre ici sur le contour lui-même.
     *
     * Le plafond de zoom évite de coller au bâti pour un tout petit contour (un garage cadré plein
     * écran monterait au zoom maximal de la carte, 25, où l'imagerie satellite n'a plus de détail).
     */
    const ZOOM_MAX_FERMETURE = 21;
    function recadrerCarteSurContour() {
        try {
            const poly = CM.state && CM.state.currentPolygonRef;
            const map = window.map;
            if (!map || !poly || CM.state.sourceType !== 'maps') return;
            // Contour supprimé (bouton "Supprimer le polygone" — qui ne ferme ce modal que s'il ne
            // restait aucun autre champ PV) : plus rien à montrer, on laisse la carte où elle est.
            if (typeof poly.getMap === 'function' && !poly.getMap()) return;
            if (typeof poly.getPath !== 'function') return;

            const bounds = new google.maps.LatLngBounds();
            let count = 0;
            poly.getPath().forEach((pt) => { bounds.extend(pt); count += 1; });
            if (!count) return;

            // Le plafonnement se fait après coup : fitBounds recalcule le zoom de façon asynchrone
            // (même motif que la restauration d'adresse dans GoogleMaps.js).
            google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
                if (map.getZoom() > ZOOM_MAX_FERMETURE) map.setZoom(ZOOM_MAX_FERMETURE);
            });
            // Marge de 60 px : le contour ne touche pas les bords, on voit son environnement immédiat.
            map.fitBounds(bounds, 60);

            // Empêche le recadrage différé sur le cercle de 3 km de l'adresse du projet (posé par un
            // setTimeout de 500 ms au chargement de la page, cf. GoogleMaps.js) d'écraser ce cadrage
            // quand le modal est fermé très vite après un rechargement. Ne change rien au reste :
            // le cercle et son marqueur sont créés et affichés comme avant.
            window._calepinageMaisonASurchargeLeCadrage = true;
        } catch (e) {
            console.warn('[Calepinage maison] Recadrage de la carte sur le contour impossible.', e);
        }
    }

    function closeModal() {
        // Vue 3D ouverte (bouton « Vue 3D » de la palette, ou bascule 2D/3D) : refermée avec le modal,
        // boucle de rendu arrêtée ; la prochaine ouverture repart sur le plan 2D.
        if (CM.state && CM.state.view3DMode && typeof CM.close3DView === 'function') {
            try { CM.close3DView(); } catch (e) { /* noop */ }
        }
        if (CM.modal) CM.modal.style.setProperty('display', 'none', 'important');
        if (CM.backdrop) CM.backdrop.style.setProperty('display', 'none', 'important');
        // Extrait ouvert depuis le pompage solaire : formulaire complet rétabli, pompage resynchronisé.
        if (typeof CM.quitterExtraitPompage === 'function') CM.quitterExtraitPompage();
        // Un outil matériel électrique / marqueur de coordonnées ne survit pas à la fermeture.
        if (CM.modeAnnotationActif && typeof CM.desactiverModeAnnotation === 'function') CM.desactiverModeAnnotation();
        // Recadrage APRÈS le masquage : la carte redevient visible, l'utilisateur voit le mouvement
        // se faire et comprend où il atterrit.
        recadrerCarteSurContour();
        // NOUVEAU (cf. orchestrateur.js::openCalepinageMaisonModal) : fermeture VOLONTAIRE du modal —
        // efface le drapeau de réouverture automatique pour qu'un rechargement de page après cette
        // fermeture ne le rouvre pas de force. showModalAfterHide() (masquage TEMPORAIRE, ex. pendant
        // les Études économiques) n'y touche pas : le drapeau doit survivre à ces masquages transitoires.
        try { sessionStorage.removeItem('calepinage_maison_lastOpenSourceId'); } catch (e) { /* ignore */ }
    }

    // NOUVEAU (demande explicite : "en fermant le modal on doit revenir sur le modal principal du
    // calepinage") : réaffichage simple (même valeurs que le masquage temporaire déjà utilisé lors
    // d'une capture d'écran, cf. calepinage_maison_dessin.js) — aucun état perdu puisque closeModal()
    // ne fait que du display:none, jamais de démontage. Passé à cmOpenAutoconsoResults() pour être
    // rappelé quand l'utilisateur ferme le modal Études économiques (cf. ResidentielAutoconsoEmbed.js).
    // Exposée aussi sur CM (Object.assign plus bas) : réutilisée telle quelle par
    // ResidentielAutoconsoEmbed.js::window.cmDownloadAutoconsoRapport() pour rouvrir ce modal une
    // fois le rapport PDF généré (demande explicite similaire).
    function showModalAfterHide() {
        if (CM.modal) CM.modal.style.setProperty('display', 'flex', 'important');
        if (CM.backdrop) CM.backdrop.style.setProperty('display', 'block', 'important');
    }

    function updateContourDimsUI() {
        // NOUVEAU (demande explicite : "champ azimut pour polygone libre") : visible uniquement en
        // polygone libre, Monopente (même restriction que "Changer l'azimut" ci-dessous) — placé ici
        // (plutôt qu'une fonction séparée) car mutuellement exclusif avec le bloc "Dimensions du
        // contour (rectangle)" juste en dessous : un seul des deux a du sens selon le mode de tracé.
        if (CM.polygonAzimuthWrapper) {
            const showAzimuth = CM.state.contourMode === 'polygon' && CM.state.divisionMode === 'none';
            CM.polygonAzimuthWrapper.style.display = showAzimuth ? 'block' : 'none';
            if (showAzimuth && CM.polygonAzimuthInput && document.activeElement !== CM.polygonAzimuthInput) {
                CM.polygonAzimuthInput.value = CM.state.polygonAzimuthDeg || 0;
            }
        }

        if (!CM.contourDimsWrapper) return;
        // CORRECTIF (demande explicite : "le polygone libre ne doit jamais être forcé en rectangle") :
        // un contour à 4 sommets tracé en polygone libre (contourMode 'polygon') n'est pas
        // nécessairement un rectangle — ne JAMAIS proposer cet éditeur "Longueur/Largeur" dans ce cas
        // (applyContourDims() reconstruit le contour à angles droits depuis p0/p1/p3, ce qui
        // écraserait une forme quadrilatère non rectangulaire intentionnelle).
        const isRect = CM.state.roofLocal.length === 4 && CM.state.contourMode !== 'polygon';
        CM.contourDimsWrapper.style.display = isRect ? 'block' : 'none';
        if (!isRect) return;
        const p0 = CM.state.roofLocal[0], p1 = CM.state.roofLocal[1], p3 = CM.state.roofLocal[3];
        const length = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const width = Math.hypot(p3.x - p0.x, p3.y - p0.y);
        if (document.activeElement !== CM.contourLengthInput) CM.contourLengthInput.value = length.toFixed(2);
        if (document.activeElement !== CM.contourWidthInput) CM.contourWidthInput.value = width.toFixed(2);
    }

    function applyContourDims() {
        if (CM.state.roofLocal.length !== 4) return;
        const newLength = Math.max(0.1, parseFloat(CM.contourLengthInput.value) || 0);
        const newWidth = Math.max(0.1, parseFloat(CM.contourWidthInput.value) || 0);
        const p0 = CM.state.roofLocal[0], p1 = CM.state.roofLocal[1], p3 = CM.state.roofLocal[3];
        const dir1 = CM.normalize({ x: p1.x - p0.x, y: p1.y - p0.y });
        const dir2 = CM.normalize({ x: p3.x - p0.x, y: p3.y - p0.y });
        const newP1 = { x: p0.x + dir1.x * newLength, y: p0.y + dir1.y * newLength };
        const newP3 = { x: p0.x + dir2.x * newWidth, y: p0.y + dir2.y * newWidth };
        const newP2 = { x: newP1.x + dir2.x * newWidth, y: newP1.y + dir2.y * newWidth };
        // Surface maximale du contour : cotes refusées, champs remis aux dimensions actuelles.
        if (CM.refuserSurfaceContour([p0, newP1, newP2, newP3], CM.state.contourMode)) {
            CM.updateContourDimsUI();
            return;
        }
        CM.state.roofLocal = [p0, newP1, newP2, newP3];
        if (CM.state.divisionMode === 'none' && CM.state.pans.length) CM.state.pans[0].points = CM.state.roofLocal;

        // CORRECTIF (demande explicite : "les panneaux deviennent en biais quand on modifie les
        // arêtes... doivent toujours être parallèles à une face" + "la flèche de l'azimut doit
        // toujours être parallèle aux panneaux") : pan.angle (grille de panneaux) restait périmé
        // ici (jamais recalculé), et pan.azimuth (flèche) pouvait diverger de pan.angle au fil des
        // éditions — recalcule les deux, pour TOUS les pans (toit simple ou divisé), depuis une
        // référence stable. NB : ne retouche PAS les points/le tracé des pans divisés (2/4 pans) —
        // seule leur orientation (angle/azimut) est corrigée ici.
        // CORRECTIF (bug rapporté : "inversion paysage/portrait pour le Monopente") :
        // computeLengthEdgeAngle() (arête longueur) remplace computeWidthEdgeAngle() (arête
        // largeur, perpendiculaire — faisait échanger les axes X/Y locaux pour le Monopente
        // uniquement) + rectAzimuthOffsetDeg (rotation manuelle par paliers de 90°, additive).
        const refAngle = CM.angleReferenceStable(CM.state, CM.state.roofLocal);
        CM.state.pans.forEach((pan) => CM.applyReferenceAngleToPan(pan, refAngle));

        if (CM.state.sourceType === 'maps' && CM.state.currentPolygonRef && CM.state.roofLocalOrigin && window.MaisonPolygonManagerInstance) {
            const newLatLngs = CM.state.roofLocal.map((pt) => CM.localToLatLng(CM.state.roofLocalOrigin, pt));
            // { silent: true } : sans ça, setPolygonPath() appelle _notifyReady() →
            // openCalepinageMaisonModal(), c'est-à-dire une RÉOUVERTURE COMPLÈTE du modal — dont un
            // CM.computeFit() qui remet à zéro l'échelle, le recadrage, zoomFactor et panOffset du
            // canevas. D'où le bug rapporté : à chaque retouche d'arête, l'image de fond (la carte)
            // et le canevas sautaient brutalement à un autre cadrage. La vue doit rester fixe : ce
            // n'est qu'une retouche, pas un nouveau tracé. Le rafraîchissement utile (cotations,
            // résultats, persistance) est fait juste après par l'appelant.
            window.MaisonPolygonManagerInstance.setPolygonPath(CM.state.currentPolygonRef, newLatLngs, { silent: true });
        }
        CM.render();
        CM.recomputeResults();
    }

    // --------------------------------------------------------------------------------------
    // Modal "Plan de coupe" — coquille DOM (le rendu canvas vit dans dessin.js::renderCoupe)
    // --------------------------------------------------------------------------------------
    function createCoupeModal() {
        CM.coupeModal = document.createElement('div');
        CM.coupeModal.id = 'calepinageMaisonCoupeModal';
        CM.coupeModal.style.cssText = 'display:none; flex-direction:column; position:fixed; top:80px; left:120px; width:640px; max-width:96vw; max-height:80vh; background:#ffffff; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.3); border:2px solid #dc2626; z-index:999999; overflow:hidden; font-family: sans-serif;';

        const header = document.createElement('div');
        header.style.cssText = 'background-color:#dc2626; color:white; padding:12px 20px; display:flex; justify-content:space-between; align-items:center; cursor:move; flex-shrink:0;';
        header.innerHTML = `
            <h2 style="margin:0; font-size:16px; font-weight:600; display:flex; align-items:center; gap:8px;">
                <i class="fas fa-ruler-combined"></i> Plan de coupe
            </h2>
            <button id="closeCalepinageMaisonCoupeBtn" style="background:none; border:none; color:white; font-size:24px; cursor:pointer; line-height:1; padding:0;">&times;</button>
        `;

        const body = document.createElement('div');
        body.style.cssText = 'padding:16px 20px; overflow-y:auto; flex-grow:1;';
        body.innerHTML = `
            <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px;">
                <label style="font-size:0.8rem; font-weight:600; color:#4b5563;">Pan :</label>
                <select id="calepinageMaisonCoupePanSelect" style="flex:1; padding:4px 6px; border:1px solid #d1d5db; border-radius:4px; font-size:0.8rem;"></select>
            </div>
            <canvas id="calepinageMaisonCoupeCanvas" width="560" height="330" style="width:100%; height:auto; background:#f9fafb; border:1px solid #d1d5db; border-radius:6px;"></canvas>
        `;

        CM.coupeModal.appendChild(header);
        CM.coupeModal.appendChild(body);
        document.body.appendChild(CM.coupeModal);

        header.querySelector('#closeCalepinageMaisonCoupeBtn').addEventListener('click', () => {
            CM.coupeModal.style.setProperty('display', 'none', 'important');
        });

        CM.coupeCanvas = body.querySelector('#calepinageMaisonCoupeCanvas');
        CM.coupePanSelect = body.querySelector('#calepinageMaisonCoupePanSelect');
        CM.coupePanSelect.addEventListener('change', () => {
            CM.state.coupePanIndex = parseInt(CM.coupePanSelect.value, 10) || 0;
            CM.renderCoupe();
        });

        makeDraggable(CM.coupeModal, header);
    }

    function openCoupeModal() {
        if (!CM.coupeModal) createCoupeModal();
        CM.coupePanSelect.innerHTML = CM.state.pans.map((p, i) => `<option value="${i}">${p.id} (${p.azimuth}°)</option>`).join('');
        CM.state.coupePanIndex = Math.min(CM.state.coupePanIndex, Math.max(0, CM.state.pans.length - 1));
        CM.coupePanSelect.value = String(CM.state.coupePanIndex);
        CM.renderCoupe();
        CM.coupeModal.style.setProperty('display', 'flex', 'important');
    }

    // --------------------------------------------------------------------------------------
    // Modal "Détails structure" (pannes/chevrons/liteaux/rails)
    // --------------------------------------------------------------------------------------
    function renderStructureDetailsTable() {
        if (!CM.structureTableBody) return;
        CM.structureTableBody.innerHTML = CM.state.pans.map((pan) => {
            const c = CM.computeStructureCounts(pan);
            return `
                <tr>
                    <td style="padding:4px 8px; font-weight:600;">${pan.id} (${pan.azimuth}°)</td>
                    <td style="padding:4px 8px; text-align:center;">${c.chevrons}</td>
                    <td style="padding:4px 8px; text-align:center;">${c.pannes}</td>
                    <td style="padding:4px 8px; text-align:center;">${c.liteaux}</td>
                    <td style="padding:4px 8px; text-align:center;">${c.rails} <span style="color:#6b7280; font-size:0.7rem;">(entraxe ${c.railSpacingM.toFixed(2)} m)</span></td>
                </tr>
            `;
        }).join('') || '<tr><td colspan="5" style="padding:8px; color:#6b7280;">Aucun pan.</td></tr>';
    }

    function createStructureDetailsModal() {
        CM.structureModal = document.createElement('div');
        CM.structureModal.id = 'calepinageMaisonStructureModal';
        CM.structureModal.style.cssText = 'display:none; flex-direction:column; position:fixed; top:80px; left:120px; width:640px; max-width:96vw; max-height:80vh; background:#ffffff; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.3); border:2px solid #dc2626; z-index:999999; overflow:hidden; font-family: sans-serif;';

        const header = document.createElement('div');
        header.style.cssText = 'background-color:#dc2626; color:white; padding:12px 20px; display:flex; justify-content:space-between; align-items:center; cursor:move; flex-shrink:0;';
        header.innerHTML = `
            <h2 style="margin:0; font-size:16px; font-weight:600; display:flex; align-items:center; gap:8px;">
                <i class="fas fa-ruler-combined"></i> Détails structure (pannes/chevrons/liteaux/rails)
            </h2>
            <button id="closeCalepinageMaisonStructureBtn" style="background:none; border:none; color:white; font-size:24px; cursor:pointer; line-height:1; padding:0;">&times;</button>
        `;

        const body = document.createElement('div');
        body.style.cssText = 'padding:16px 20px; overflow-y:auto; flex-grow:1;';
        body.innerHTML = `
            <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
                <div>
                    <label class="cm-label">Entraxe chevrons (m)</label>
                    <input id="calepinageMaisonChevronSpacingInput" type="number" min="0.05" step="0.05" class="cm-input" style="max-width:100px;" />
                </div>
                <div>
                    <label class="cm-label">Entraxe pannes (m)</label>
                    <input id="calepinageMaisonPanneSpacingInput" type="number" min="0.05" step="0.05" class="cm-input" style="max-width:100px;" />
                </div>
                <div>
                    <label class="cm-label">Entraxe liteaux (m)</label>
                    <input id="calepinageMaisonLiteauSpacingInput" type="number" min="0.02" step="0.01" class="cm-input" style="max-width:100px;" />
                </div>
                <div>
                    <!-- NOUVEAU (demande explicite, génération 3D) : hauteur des rails / du système
                         d'intégration au-dessus de la couverture. Sert au module 3D à décoller les
                         panneaux du plan de toiture (calepinage_maison_3d_geometry.js). -->
                    <label class="cm-label">Hauteur système d'intégration (mm)</label>
                    <input id="calepinageMaisonRailHeightInput" type="number" min="0" step="1" class="cm-input" style="max-width:100px;" />
                </div>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.8rem;">
                <thead>
                    <tr style="background:#f3f4f6; text-align:center;">
                        <th style="padding:4px 8px; text-align:left;">Pan</th>
                        <th style="padding:4px 8px;">Chevrons</th>
                        <th style="padding:4px 8px;">Pannes</th>
                        <th style="padding:4px 8px;">Liteaux</th>
                        <th style="padding:4px 8px;">Rails</th>
                    </tr>
                </thead>
                <tbody id="calepinageMaisonStructureTableBody"></tbody>
            </table>
            <p style="margin:10px 0 0; font-size:0.7rem; color:#6b7280;">L'entraxe des rails dépend de l'orientation portrait/paysage et de la taille du panneau — non modifiable ici.</p>
        `;

        CM.structureModal.appendChild(header);
        CM.structureModal.appendChild(body);
        document.body.appendChild(CM.structureModal);

        header.querySelector('#closeCalepinageMaisonStructureBtn').addEventListener('click', () => {
            CM.structureModal.style.setProperty('display', 'none', 'important');
        });

        CM.structureTableBody = body.querySelector('#calepinageMaisonStructureTableBody');

        body.querySelector('#calepinageMaisonChevronSpacingInput').addEventListener('input', (e) => {
            CM.state.chevronSpacingM = Math.max(0.05, parseFloat(e.target.value) || 0.6);
            CM.render(); renderStructureDetailsTable();
        });
        body.querySelector('#calepinageMaisonPanneSpacingInput').addEventListener('input', (e) => {
            CM.state.panneSpacingM = Math.max(0.05, parseFloat(e.target.value) || 1.2);
            CM.render(); renderStructureDetailsTable();
        });
        body.querySelector('#calepinageMaisonLiteauSpacingInput').addEventListener('input', (e) => {
            CM.state.liteauSpacingM = Math.max(0.02, parseFloat(e.target.value) || 0.35);
            CM.render(); renderStructureDetailsTable();
        });
        body.querySelector('#calepinageMaisonRailHeightInput').addEventListener('input', (e) => {
            const raw = parseFloat(e.target.value);
            CM.state.railHeightMm = isNaN(raw) ? 0 : Math.max(0, raw);
            if (typeof CM.refresh3DView === 'function') CM.refresh3DView();
        });

        makeDraggable(CM.structureModal, header);
    }

    function openStructureDetailsModal() {
        if (!CM.structureModal) createStructureDetailsModal();
        CM.structureModal.querySelector('#calepinageMaisonChevronSpacingInput').value = CM.state.chevronSpacingM;
        CM.structureModal.querySelector('#calepinageMaisonPanneSpacingInput').value = CM.state.panneSpacingM;
        CM.structureModal.querySelector('#calepinageMaisonLiteauSpacingInput').value = CM.state.liteauSpacingM;
        CM.structureModal.querySelector('#calepinageMaisonRailHeightInput').value = CM.state.railHeightMm;
        renderStructureDetailsTable();
        CM.structureModal.style.setProperty('display', 'flex', 'important');
    }

    // Affiche/masque les fonctionnalités propres aux sources Google Maps ("Capturer" un fond de
    // carte) sans objet réel pour une source image.
    function updateSourceDependentUI() {
        if (!CM.modalBody) return;
        const isMaps = CM.state.sourceType === 'maps';
        const captureBtn = CM.modalBody.querySelector('#calepinageMaisonCaptureBtn');
        const deleteBtn = CM.modalBody.querySelector('#calepinageMaisonDeletePolygonBtn');
        if (captureBtn) captureBtn.style.display = isMaps ? '' : 'none';
        // CORRECTIF (bug rapporté : "Supprimer le polygone affiche encore du texte") : icône fixe
        // (clear.svg, posée à la création) — seul le tooltip reflète maps/image.
        if (deleteBtn) deleteBtn.title = isMaps ? 'Supprimer le polygone' : 'Supprimer cette image';
    }

    // CORRECTIF (demande explicite : "supprimer le bouton Angles 90°") : updateOrthoToggleUI()
    // retirée — le choix rectangle/polygone se fait désormais en amont du tracé (2 boutons distincts
    // de la palette principale, cf. ButtonControl.js + polygon_maison.js::startDraw(mode)).

    // NOUVEAU (demande explicite : "copier/coller un obstacle") : crée `count` copies de
    // `obstacle`, décalées en diagonale pour ne jamais se superposer exactement à l'original ni
    // entre elles. Appelée depuis showObstacleCopyPrompt() ci-dessous, une fois le nombre de
    // copies validé par l'utilisateur.
    function duplicateObstacle(obstacle, count) {
        const offsetStep = Math.max(obstacle.w, obstacle.h, 0.3) * 0.6;
        let lastId = obstacle.id;
        for (let i = 1; i <= count; i++) {
            const id = `obs_${Date.now()}_${i}`;
            CM.state.obstacles.push({
                id,
                type: obstacle.type,
                x: obstacle.x + offsetStep * i,
                y: obstacle.y + offsetStep * i,
                w: obstacle.w,
                h: obstacle.h,
                buffer: obstacle.buffer,
                angle: obstacle.angle,
                // NOUVEAU (demande explicite, hauteur 3D) : copiée avec le reste — sinon la copie
                // retombait implicitement à `undefined` (hauteur par défaut générique en 3D).
                elevationM: obstacle.elevationM,
            });
            lastId = id;
        }
        CM.state.selectedObstacleId = lastId;
        updateObstaclePropertiesPanel();
        CM.recomputeResults();
        if (typeof CM.render === 'function') CM.render();
    }

    /**
     * NOUVEAU (demande explicite : "copier/coller un obstacle") : petite fenêtre positionnée près
     * du curseur, demandant le nombre de copies à créer pour l'obstacle cliqué en clic droit (cf.
     * onCanvasContextMenu, dessin.js). Se ferme automatiquement quelques secondes après validation
     * (confirmation visuelle du nombre de copies créées) — Échap ou un clic en dehors annule sans
     * créer de copie.
     */
    function showObstacleCopyPrompt(obstacle, clientX, clientY) {
        const existing = document.getElementById('cmObstacleCopyPopup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.id = 'cmObstacleCopyPopup';
        popup.style.cssText = `
            position:fixed; z-index:1000001; background:#fff; border:1px solid #d1d5db;
            border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.18); padding:14px 16px;
            font-size:0.85rem; min-width:220px;
        `;
        const left = Math.max(8, Math.min(clientX, window.innerWidth - 240));
        const top = Math.max(8, Math.min(clientY, window.innerHeight - 160));
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;

        popup.innerHTML = `
            <div style="font-weight:700; margin-bottom:8px; color:#374151;">Copier cet obstacle</div>
            <label class="cm-label" for="cmObstacleCopyCount">Nombre de copies</label>
            <input type="number" id="cmObstacleCopyCount" class="cm-input" value="1" min="1" max="50" step="1" style="margin-bottom:10px;">
            <div style="display:flex; gap:6px;">
                <button type="button" id="cmObstacleCopyConfirm" class="cm-btn" style="flex:1; background:var(--success-color, #16a34a); color:#fff; border-color:var(--success-color, #16a34a);">Valider</button>
                <button type="button" id="cmObstacleCopyCancel" class="cm-btn" style="flex:1;">Annuler</button>
            </div>
        `;
        document.body.appendChild(popup);

        let outsideClickHandler = null;
        const closePopup = () => {
            if (outsideClickHandler) document.removeEventListener('mousedown', outsideClickHandler, true);
            popup.remove();
        };
        outsideClickHandler = (ev) => { if (!popup.contains(ev.target)) closePopup(); };
        // Armé après le tick courant : sinon le mousedown du clic droit qui vient d'ouvrir cette
        // fenêtre la refermerait instantanément sur certains navigateurs.
        setTimeout(() => document.addEventListener('mousedown', outsideClickHandler, true), 0);

        const input = popup.querySelector('#cmObstacleCopyCount');
        input.focus();
        input.select();

        popup.querySelector('#cmObstacleCopyCancel').addEventListener('click', closePopup);

        const confirmCopy = () => {
            const count = Math.max(1, Math.min(50, parseInt(input.value, 10) || 1));
            duplicateObstacle(obstacle, count);

            if (outsideClickHandler) document.removeEventListener('mousedown', outsideClickHandler, true);
            popup.innerHTML = `<div style="color:var(--success-color, #16a34a); font-weight:600;">✅ ${count} copie${count > 1 ? 's' : ''} créée${count > 1 ? 's' : ''}.</div>`;
            // Fermeture automatique quelques secondes après validation (demande explicite).
            setTimeout(closePopup, 1500);
        };
        popup.querySelector('#cmObstacleCopyConfirm').addEventListener('click', confirmCopy);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirmCopy(); }
            if (e.key === 'Escape') { e.preventDefault(); closePopup(); }
        });
    }

    // --------------------------------------------------------------------------------------
    // Export vers le namespace partagé (fonctions appelées depuis dessin.js / orchestrateur.js)
    // --------------------------------------------------------------------------------------
    Object.assign(CM, {
        createModal, updateRidgeButtonUI, updateContourDrawButtonsUI, updateFreeLineButtonUI, updateViewToggleUI,
        updatePanToolUI, updatePanelToolButtonsUI, updateObstaclePropertiesPanel, updatePoseModeUI,
        closeModal, requestCloseModal, forceRealignCalepinage,
        showModalAfterHide, updateContourDimsUI, updateSourceDependentUI,
        renderAzimuths, updateEquipmentFieldsUI, appliquerVisibiliteSelonProjet, pompageSolaireVisible, appliquerMasquagePompageAutonome,
        afficherBatterieVirtuelle, definirBatterieVirtuelle,
        updateView2D3DUI, updateMultiHouseViewUI,
        updateBorneEquipmentAvailability, showObstacleCopyPrompt, duplicateObstacle,
        syncOmbriereDivision, syncPetitChampFieldsToForm, remplirChampsGeometrieDepuisEtat, tournerAzimut90,
        appliquerTitreGeometrie, majInfosSystemeIntegration,
        updateOrientationUI,
        // Règles matériels (demande explicite : type d'onduleur + filtre batteries) — fonctions
        // pures, exportées pour être réutilisables et couvertes par
        // tests/calepinage_maison/test_filtre_materiels.js.
        normaliserTypeOnduleur, batterieCompatibleAvecOnduleur, getOnduleurSelectionne,
        TYPE_ONDULEUR_CHAINE, TYPE_ONDULEUR_HYBRIDE, TYPE_ONDULEUR_MICRO,
        afficherMaterielsDepuisEtat,
    });
})();
