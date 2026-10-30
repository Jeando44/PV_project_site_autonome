/**
 * navigation-modales.js
 * "Menu post-calcul" : palette flottante regroupant les onglets de restitution affichés après le
 * clic sur "Calculer et Visualiser" (Résultats/Autoconsommation, Étude Économique, Rapport). Les
 * étapes de configuration en amont (Paramètres, Consommation d'énergie, Calepinage, Dimensionnement)
 * vivent dans le menu horizontal (cf. menu_list.html, window.setActiveMainNavStep).
 */
window.ModalNavigator = {
    currentSequence: [],
    currentIndex: 0,
    paletteElement: null,
    autoconsoCalculated: false, // Flag pour éviter les recalculs inutiles

    init() {
        this.createPalette();
    },

    createPalette() {
        // 1. Création du style CSS dynamique pour la palette (Positionnée à droite, en colonne)
        const style = document.createElement('style');
        style.textContent = `
            #modal-navigator-palette {
                position: fixed;
                top: 50%;
                right: 25px;
                --nav-drag-x: 0px;
                --nav-drag-y: 0px;
                    transform: translateY(-50%) translate(var(--nav-drag-x), var(--nav-drag-y)) translateX(calc(100% + 25px));
                background: #ffffff;
                border: 2px solid #dc2626;
                border-radius: 20px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.2);
                display: none; /* Masqué par défaut à l'ouverture de l'application */
                flex-direction: column;
                align-items: center;
                padding: 15px 12px;
                z-index: 1060000; /* Strictement au-dessus des modales */
                gap: 8px;
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            #modal-navigator-palette.dragging {
                transition: none; /* Pas de latence pendant le déplacement actif */
            }
            #modal-navigator-palette.visible {
                transform: translateY(-50%) translate(var(--nav-drag-x), var(--nav-drag-y)) translateX(0);
            }
            /* Poignée de déplacement (drag), au-dessus des étapes de navigation */
            .nav-drag-handle {
                width: 100%;
                height: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: grab;
                gap: 3px;
                margin-bottom: 2px;
            }
            .nav-drag-handle:active {
                cursor: grabbing;
            }
            .nav-drag-handle span {
                width: 4px;
                height: 4px;
                border-radius: 50%;
                background: #d1d5db;
            }
            .nav-drag-handle:hover span {
                background: #dc2626;
            }
            /* Tâche 1: Style de la poignée de bascule */
            #modal-navigator-handle {
                position: absolute;
                bottom: -32px; /* Positionné en dessous de la palette */
                left: 50%; /* Centré sur la largeur */
                transform: translateX(-50%);
                width: 70px;
                height: 32px;
                background-color: #dc2626;
                border: 2px solid #dc2626;
                border-top: none;
                border-radius: 0 0 15px 15px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                box-shadow: -4px 4px 10px rgba(0,0,0,0.15);
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            #modal-navigator-handle:hover {
                background-color: #b91c1c;
            }
            /* Transformation de la poignée sur le côté gauche quand le modal est "masqué" */
            #modal-navigator-palette:not(.visible):not(.closing) #modal-navigator-handle {
                bottom: 15px;
                left: -32px;
                transform: translateX(0);
                width: 32px;
                height: 70px;
                border-top: 2px solid #dc2626;
                border-right: none;
                border-radius: 15px 0 0 15px;
            }
            .nav-step-btn {
                background: transparent;
                border: 2px solid transparent;
                padding: 10px 15px;
                border-radius: 12px;
                font-weight: 600;
                color: #6b7280;
                cursor: pointer;
                transition: all 0.2s ease;
                white-space: nowrap;
                font-size: 0.9rem;
                width: 100%;
                text-align: center;
            }
            .nav-step-btn:hover:not(.active) {
                background: #f3f4f6;
                color: #374151;
            }
            .nav-step-btn.active {
                background: #dc2626;
                color: #ffffff;
                box-shadow: 0 4px 10px rgba(220, 38, 38, 0.3);
            }
            .nav-step-arrow {
                color: #9ca3af;
                font-size: 1.2rem;
                display: flex;
                align-items: center;
                transform: rotate(90deg); /* La flèche pointe vers le bas */
            }
            .nav-close-btn {
                background: #f3f4f6;
                color: #374151;
                border: none;
                border-radius: 50%;
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                margin-top: 10px;
                transition: all 0.2s ease;
            }
            .nav-close-btn:hover {
                background: #fee2e2;
                color: #dc2626;
            }
            #modal-navigator-handle i {
                transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                transform: rotate(0deg);
            }
            /* Rotation de l'icône quand la palette est masquée par le poignet (pointe vers la gauche) */
            #modal-navigator-palette:not(.visible):not(.closing) #modal-navigator-handle i {
                transform: rotate(90deg);
            }
        `;
        document.head.appendChild(style);

        // 2. Création de l'élément DOM
        this.paletteElement = document.createElement('div');
        this.paletteElement.id = 'modal-navigator-palette';

        // Tâche 1: Ajout de la poignée
        this.toggleHandle = document.createElement('div');
        this.toggleHandle.id = 'modal-navigator-handle';
        this.toggleHandle.title = 'Afficher/Masquer la navigation';
        this.toggleHandle.innerHTML = '<i class="fas fa-chevron-down"></i>';
        this.toggleHandle.onclick = (e) => {
            e.stopPropagation(); // Empêche la propagation d'événements qui pourraient fermer le modal
            this.togglePalette();
        };
        this.paletteElement.appendChild(this.toggleHandle);

        // NOUVEAU: Poignée de déplacement (drag), pour rendre la palette déplaçable sans toucher
        // au reste de son fonctionnement (étapes, poignée d'affichage, fermeture...).
        this.dragHandle = document.createElement('div');
        this.dragHandle.className = 'nav-drag-handle';
        this.dragHandle.title = 'Déplacer';
        this.dragHandle.innerHTML = '<span></span><span></span><span></span><span></span>';
        this.dragHandle.addEventListener('mousedown', (e) => this.startDrag(e));
        this.paletteElement.appendChild(this.dragHandle);

        // Position de déplacement courante (offset additif appliqué par-dessus le positionnement
        // CSS existant via les variables --nav-drag-x/--nav-drag-y, sans le modifier).
        this.dragX = 0;
        this.dragY = 0;
        this.isDragging = false;
        document.addEventListener('mousemove', (e) => this.onDrag(e));
        document.addEventListener('mouseup', () => this.endDrag());

        document.body.appendChild(this.paletteElement);
    },

    startDrag(e) {
        e.preventDefault();
        e.stopPropagation();
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragStartOffsetX = this.dragX;
        this.dragStartOffsetY = this.dragY;
        this.paletteElement.classList.add('dragging');
    },

    onDrag(e) {
        if (!this.isDragging) return;
        this.dragX = this.dragStartOffsetX + (e.clientX - this.dragStartX);
        this.dragY = this.dragStartOffsetY + (e.clientY - this.dragStartY);
        this.paletteElement.style.setProperty('--nav-drag-x', `${this.dragX}px`);
        this.paletteElement.style.setProperty('--nav-drag-y', `${this.dragY}px`);
    },

    endDrag() {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.paletteElement.classList.remove('dragging');
    },

    // NOUVEAU WORKFLOW (demande explicite : deux flux de navigation distincts) : cette palette ne
    // regroupe plus désormais que les onglets de RESTITUTION post-calcul (Résultats, Études Éco,
    // Rapport) — les étapes de configuration (Paramètres, Consommation d'énergie, Calepinage,
    // Dimensionnement) vivent exclusivement dans le menu horizontal (cf. menu_list.html,
    // window.setActiveMainNavStep). Construit currentSequence (labels + actions) sans rien afficher
    // ni exécuter — appelée uniquement par startSequence(), déclenchée par le clic sur "Calculer et
    // Visualiser".
    buildSequence() {
        this.currentSequence = [];
        this.autoconsoCalculated = false; // Réinitialise le calcul au (re)lancement complet de la boucle

        // CORRECTIF (bug rapporté : « après Calculer et visualiser, la palette s'affiche sans le
        // modal Résultats ; il faut rouvrir le projet en modification et l'enregistrer sans rien
        // changer pour que ça remarche ») : le mode de valorisation était lu dans val_status_<projet>
        // et solarProjectData, écrits UNIQUEMENT au clic sur une carte du formulaire Paramètres —
        // vides ou périmés pour un projet simplement ouvert (autre navigateur, cache purgé au
        // changement de projet). Source autoritaire : le context processor (main.py), vérifié en
        // base ; le localStorage et le champ du formulaire ne sont plus que des replis.
        let valMode = window.ACTIVE_PROJECT_MODE_VALORISATION || '';
        if (!valMode) {
            const projectId = localStorage.getItem('current_projet_id') || 'default';
            try {
                const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                valMode = localStorage.getItem(`val_status_${projectId}`)
                    || (savedData.projectInfo && savedData.projectInfo.mode_de_valorisation) || '';
            } catch (e) {}
        }
        if (!valMode) {
            const domMode = document.getElementById('mode_de_valorisation');
            if (domMode && domMode.value) valMode = domMode.value;
        }

        let stepNum = 1;

        // « Résultats » est TOUJOURS proposé (demande explicite : toutes les pages du parcours
        // doivent s'ouvrir selon les paramètres du projet) : le modal d'autoconsommation dérive
        // lui-même son type d'étude de chaque mode de valorisation (ACI, ACC, et « vente en
        // totalité » pour Vente en totalité / Marché libre / options hors ligne, cf.
        // main_autoconso.js MODE_DE_VALORISATION_TO_STUDY_TYPE) — un mode inconnu ou vide ne doit
        // donc plus faire disparaître l'étape.
        this.currentSequence.push({
            id: 'autoconso',
            // NOUVEAU: renommé (auparavant "Autoconsommation", puis "Rés. Energétique")
            label: `${stepNum}. Résultats`,
            action: (ev) => {
                if (!this.autoconsoCalculated) {
                    // 1er passage : on force le calcul
                    localStorage.setItem('autoRunAutoconso', 'true');
                    if (typeof window.openPrestations === 'function') window.openPrestations(ev);

                    this.autoconsoCalculated = true; // Empêcher les prochains recalculs

                    // Déclencheur du calcul automatisé (délai le temps que l'iframe s'ouvre)
                    setTimeout(() => window.dispatchEvent(new CustomEvent('startAutomatedAutoconso')), 400);
                } else {
                    // Retours ultérieurs : ouverture simple de la modale en lecture
                    localStorage.setItem('autoRunAutoconso', 'false');
                    if (typeof window.openPrestations === 'function') window.openPrestations(ev);
                }
            }
        });
        stepNum++;

        // FIN DU WORKFLOW. "Études Éco" (modal Grand projet) masqué pour l'autoconsommation collective
        // (tout mode contenant « collective ») : l'ACC a sa propre étude économique dans le modal
        // Résultats, condition d'accès au rapport (cf. ExportService.isProjetAcc).
        const isAcc = (window.ACTIVE_PROJECT_MODE_VALORISATION || valMode).toLowerCase().includes('collective');

        // « Rapport » sans fermer le modal Résultats (demande explicite) : ACC, ACI et vente en
        // totalité, typologies Grand projet et Professionnelle. L'export ignore déjà ce modal dans sa
        // capture de la carte (cf. ExportService, ignoreElements).
        const typologie = window.ACTIVE_PROJECT_TYPOLOGIE || '';
        this.rapportGardeModalOuvert = !!typologie && typologie !== (window.TYPOLOGIE_RESIDENTIELLE || 'Résidentielle');
        if (!isAcc) {
            this.currentSequence.push({
                id: 'eco',
                label: `${stepNum}. Études Éco`,
                action: () => typeof window.openEtudesEconomiqueModal === 'function' && window.openEtudesEconomiqueModal()
            });
            stepNum++;
        }

        this.currentSequence.push({
            id: 'export',
            label: `${stepNum}. Rapport`,
            action: (ev) => typeof window.triggerProjectExport === 'function' && window.triggerProjectExport(ev)
        });
    },

    // NOUVEAU WORKFLOW (demande explicite) : cette palette ("menu post-calcul") ne doit s'afficher
    // qu'après le clic sur "Calculer et Visualiser" (ButtonControl.js) — jamais automatiquement au
    // chargement de la page.
    startSequence(e) {
        if (e) e.preventDefault();
        if (!this.paletteElement) this.init();

        this.buildSequence();
        this.currentIndex = 0;
        this.renderPalette();
        this.showPalette();
        this.executeStep(0);
    },

    renderPalette() {
        this.paletteElement.innerHTML = '';

        // Ré-attacher la poignée de déplacement en premier (avant les étapes)
        if (this.dragHandle) {
            this.paletteElement.appendChild(this.dragHandle);
        }

        this.currentSequence.forEach((step, index) => {
            const btn = document.createElement('button');
            btn.className = 'nav-step-btn';
            btn.textContent = step.label;
            
            // Naviguer au clic sur l'étape
            btn.onclick = (e) => {
                e.preventDefault();
                this.executeStep(index);
            };
            
            this.paletteElement.appendChild(btn);

            if (index < this.currentSequence.length - 1) {
                const arrow = document.createElement('div');
                arrow.className = 'nav-step-arrow';
                arrow.innerHTML = '&#10142;'; // Icône flèche
                this.paletteElement.appendChild(arrow);
            }
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'nav-close-btn';
        closeBtn.innerHTML = '&#10005;'; // Icône Croix
        closeBtn.title = 'Quitter le mode navigation';
        closeBtn.onclick = (e) => { e.preventDefault(); this.closePalette(); };
        this.paletteElement.appendChild(closeBtn);

        // Ré-attacher la poignée après avoir vidé l'innerHTML
        if (this.toggleHandle) {
            this.paletteElement.appendChild(this.toggleHandle);
        }
    },

    updatePaletteUI() {
        const buttons = this.paletteElement.querySelectorAll('.nav-step-btn');
        buttons.forEach((btn, index) => {
            if (index === this.currentIndex) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    },

    executeStep(index) {
        if (index < 0 || index >= this.currentSequence.length) return;

        // Quitter l'étape « Rapport » ne demande plus de variante : elle est choisie et enregistrée
        // avant la génération du rapport (ExportService.exportPDF).
        const proceed = () => {
            this.currentIndex = index;
            this.updatePaletteUI();

            // 1. On ferme tout l'existant proprement — sauf le modal Résultats quand on lance le
            // rapport d'un projet concerné (cf. rapportGardeModalOuvert dans buildSequence()).
            const etape = this.currentSequence[index];
            if (etape.id === 'export' && this.rapportGardeModalOuvert) {
                if (this._executeStepTimer) clearTimeout(this._executeStepTimer);
                this._executeStepTimer = null;
                if (window.summaryModalInstance && typeof window.summaryModalInstance.hide === 'function') {
                    window.summaryModalInstance.hide();
                }
                etape.action(new Event('click'));
                return;
            }
            this.closeAllModals();

            // CORRECTIF (bug "il faut cliquer une dizaine de fois, le contenu apparaît puis disparaît
            // instantanément") : un clic répété (ex. sur "Calculer et Visualiser" ou sur une étape de
            // la palette) avant l'écoulement des 350ms ci-dessous programmait un NOUVEAU setTimeout
            // sans jamais annuler le(s) précédent(s) — chaque clic supplémentaire ajoutait donc un
            // fermer/(re)ouvrir en attente, et ces callbacks s'exécutaient ensuite tous à la file :
            // ouverture du clic N, immédiatement fermée par le closeAllModals() du clic N+1 déjà
            // programmé, etc. Seul le DERNIER clic "survivait" une fois l'utilisateur arrêté de
            // cliquer assez longtemps — d'où l'impression de devoir cliquer plusieurs fois. On annule
            // donc systématiquement le timer en attente avant d'en programmer un nouveau.
            if (this._executeStepTimer) clearTimeout(this._executeStepTimer);

            // 2. On attend la fin de l'animation CSS des modales avant d'ouvrir la suivante (350ms)
            this._executeStepTimer = setTimeout(() => {
                this._executeStepTimer = null;
                const step = this.currentSequence[this.currentIndex];
                const dummyEvent = new Event('click');
                step.action(dummyEvent);

                // Tâche 2: Le code qui masquait la palette lors de l'export a été supprimé.
            }, 350);
        };

        proceed();
    },

    showPalette() { 
        this.paletteElement.style.display = 'flex';
        this.paletteElement.offsetHeight; // Force le recalcul du navigateur pour que l'animation fonctionne
        this.paletteElement.classList.add('visible'); 
    },
    
    hidePalette() { this.paletteElement.classList.remove('visible'); },
    closePalette() {
        this.paletteElement.classList.add('closing');
        this.hidePalette();
        // On laisse l'animation de glissement se terminer (400ms) avant de masquer complètement l'entité
        setTimeout(() => {
            if (!this.paletteElement.classList.contains('visible')) {
                this.paletteElement.style.display = 'none';
                this.paletteElement.classList.remove('closing');
            }
        }, 400); 
    },
    togglePalette() {
        this.paletteElement.classList.toggle('visible');
    },
    closeAllModals() {
        // CORRECTIF : la courbe de charge IRVE est désormais sauvegardée directement en base de
        // données par calcul_irve.js (POST .../irve/save-curve) — plus besoin de promouvoir
        // stagedIrveData -> sharedIrveData ici. Cette promotion tournait de toute façon sur CHAQUE
        // clic de navigation entre étapes (pas seulement IRVE/ACI), ce qui donnait l'impression
        // trompeuse qu'ouvrir n'importe quel outil "lançait une sauvegarde".

        // 1. Modales Universelles (IRVE, Autoconsommation, Geocoding)
        if (typeof window.closeUniversalModal === 'function') window.closeUniversalModal();

        // 2. Modale Étude Économique
        const ecoModal = document.getElementById('etudes-economique-modal');
        const ecoBackdrop = document.getElementById('etudes-economique-backdrop');
        if (ecoModal) ecoModal.style.display = 'none';
        if (ecoBackdrop) ecoBackdrop.style.display = 'none';

        // 3. Modale Liste de matériels (Sécurité complémentaire)
        const lmModal = document.getElementById('mainAppModal');
        const lmBackdrop = document.getElementById('liste-materiels-backdrop');
        if (lmModal && lmModal.id !== 'app-modal') lmModal.style.display = 'none';
        if (lmBackdrop) lmBackdrop.style.display = 'none';

        // 4. Modale de synthèse calepinage (Sécurité complémentaire) : si elle est restée ouverte
        // (ex. rafraîchissement des données solaires avant le calcul), on la ferme systématiquement
        // avant chaque étape de la navigation, sinon elle reste visible par-dessus la page et se
        // retrouve capturée dans la capture d'écran du calepinage à l'étape "Rapport".
        if (window.summaryModalInstance && typeof window.summaryModalInstance.hide === 'function') {
            window.summaryModalInstance.hide();
        }

        // 5. Modale Paramètres projet : NOUVEAU depuis que "Paramètres" fait partie des étapes de
        // cette palette (cf. buildSequence()) — sans ceci, passer de l'étape "Paramètres" à une
        // autre étape (ex. "Calepinage") la laissait ouverte par-dessus la page. Fermeture directe
        // (comme les autres modales ci-dessus) plutôt que via closeModal() (initialisationMap.js) :
        // cette dernière déclenche une sauvegarde asynchrone en base à chaque appel, inutile ici pour
        // une simple transition entre étapes de navigation.
        const paramModal = document.getElementById('parametres-modal');
        if (paramModal) {
            paramModal.classList.remove('show');
            paramModal.style.display = 'none';
        }
    }
};

// Auto-init au chargement de l'application principale
document.addEventListener('DOMContentLoaded', () => {
    window.ModalNavigator.init();
    // NOUVEAU WORKFLOW (demande explicite : deux flux de navigation distincts) : cette palette
    // ("menu post-calcul") ne s'affiche plus automatiquement au chargement — uniquement au clic sur
    // "Calculer et Visualiser" (cf. startSequence()). Les étapes de configuration (Paramètres,
    // Consommation d'énergie, Calepinage, Dimensionnement) sont désormais exclusivement mises en
    // évidence dans le menu horizontal (cf. menu_list.html, window.setActiveMainNavStep).

    // NOUVEAU WORKFLOW (demande explicite) : à la création d'un nouveau projet ou à l'ouverture d'un
    // projet existant, le modal "Consommation d'énergie" doit s'ouvrir automatiquement — AVANT même
    // que l'utilisateur n'aille sur le Calepinage. Le flag est posé par parametreProjetFormManager.js
    // (submitParametreProjet() pour une création, selectAndLoadProject() pour une ouverture) juste
    // avant le rechargement/redirection vers cette page — un flag one-shot (sessionStorage, retiré
    // immédiatement) pour ne jamais se redéclencher sur un simple rechargement manuel ultérieur de la
    // page.
    // Parcours (demande explicite) : Mes projets -> Paramètres projet -> Profil de consommation ->
    // Calepinage. L'ouverture d'un projet avec rechargement de page (cf. selectAndLoadProject(),
    // parametreProjetFormManager.js) enchaîne sur « Paramètres projet » ; son enregistrement pose
    // ensuite autoOpenConsEnergie ci-dessous. Délai : window.parametreProjetManager et
    // window.dataManager sont créés après DOMContentLoaded (cf. initialisationMap.js).
    if (sessionStorage.getItem('autoOpenParametresProjet') === 'true') {
        sessionStorage.removeItem('autoOpenParametresProjet');
        setTimeout(() => {
            if (typeof window.openParametresProjet === 'function' && window.parametreProjetManager) {
                window.openParametresProjet();
            }
        }, 300);
        return;
    }

    if (sessionStorage.getItem('autoOpenConsEnergie') === 'true') {
        sessionStorage.removeItem('autoOpenConsEnergie');
        // Parcours Chiffrage : pas de Consommation d'énergie, on arrive sur le Calepinage.
        if (typeof window.isChiffrageProject === 'function' && window.isChiffrageProject()) {
            if (typeof window.setActiveMainNavStep === 'function') window.setActiveMainNavStep('calepinage');
            return;
        }
        setTimeout(() => {
            // openBDMateriels() appelle event.preventDefault() sans garde de nullité : lui passer un
            // Event factice (même technique que ModalNavigator.executeStep ci-dessus) plutôt que rien.
            // Elle met elle-même en évidence "Consommation d'énergie" dans le menu horizontal (cf.
            // menu.html, window.setActiveMainNavStep).
            if (typeof window.openBDMateriels === 'function') window.openBDMateriels(new Event('click'));
        }, 300);
    }
});