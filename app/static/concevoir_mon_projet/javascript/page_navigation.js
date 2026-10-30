/**
 * Navigation flottante entre les pages
 * Version optimisée pour navigation entre pages réelles uniquement
 */

(function() {
    'use strict';

    // Configuration des pages réelles - Uniquement Calepinage, Système, Partager/Exporter
    const PAGES = [
        { path: '/', name: 'Calepinage' },
        { path: '/concevoir_mon_projet/systeme', name: 'Système' },
        { path: '/concevoir_mon_projet/export', name: 'Partager/Exporter' }
    ];

    // Configuration des modaux associés à chaque page
    const PAGE_MODALS = {
        '/': ['Géométrie', 'Autoconsommation'],
        '/concevoir_mon_projet/systeme': [],
        '/concevoir_mon_projet/export': ['Étude Économique']
    };

    // Clés localStorage
    const STORAGE_KEYS = {
        position: 'page_navigator_position',
        minimized: 'page_navigator_minimized'
    };

    class PageNavigator {
        constructor() {
            this.navigator = document.getElementById('page-navigator');
            if (!this.navigator) return;

            this.header = this.navigator.querySelector('.navigator-header');
            this.body = this.navigator.querySelector('.navigator-body');
            this.toggleBtn = this.navigator.querySelector('.navigator-toggle');
            this.prevBtn = document.getElementById('nav-prev');
            this.nextBtn = document.getElementById('nav-next');

            this.currentPageIndex = this.getCurrentPageIndex();
            this.isDragging = false;
            this.currentX = 0;
            this.currentY = 0;
            this.initialX = 0;
            this.initialY = 0;
            this.xOffset = 0;
            this.yOffset = 0;

            this.init();
        }

        init() {
            this.updateNavigationButtons();
            this.setupToggle();
            this.setupDragAndDrop();
            this.loadSavedState();
            this.addKeyboardShortcuts();
            this.addModalIndicators();
            this.checkTypeEtudeVisibility();
        }

        // Détermine l'index de la page actuelle
        getCurrentPageIndex() {
            const currentPath = window.location.pathname;
            return PAGES.findIndex(page => {
                if (page.path === '/') {
                    return currentPath === '/' || window.estPageAccueil(currentPath);
                }
                return currentPath.includes(page.path);
            });
        }

        // Met à jour l'état des boutons de navigation
        updateNavigationButtons() {
            if (this.currentPageIndex === -1) {
                this.prevBtn.disabled = true;
                this.nextBtn.disabled = true;
                return;
            }

            // Bouton Précédent
            if (this.currentPageIndex > 0) {
                this.prevBtn.disabled = false;
                this.prevBtn.onclick = () => this.navigateTo(this.currentPageIndex - 1);
                this.updateButtonText(this.prevBtn, PAGES[this.currentPageIndex - 1].name);
            } else {
                this.prevBtn.disabled = true;
            }

            // Bouton Suivant
            if (this.currentPageIndex < PAGES.length - 1) {
                this.nextBtn.disabled = false;
                this.nextBtn.onclick = () => this.navigateTo(this.currentPageIndex + 1);
                this.updateButtonText(this.nextBtn, PAGES[this.currentPageIndex + 1].name);
            } else {
                this.nextBtn.disabled = true;
            }
        }

        // Met à jour le texte du bouton
        updateButtonText(button, pageName) {
            const textSpan = button.querySelector('.nav-text');
            if (textSpan && window.innerWidth > 768) {
                const shortName = pageName.length > 15 ? pageName.substring(0, 12) + '...' : pageName;
                textSpan.textContent = shortName;
            }
        }

        // Navigation vers une page
        navigateTo(pageIndex) {
            if (pageIndex >= 0 && pageIndex < PAGES.length) {
                // Sauvegarder les données avant de naviguer
                if (typeof sauvegarder === 'function') {
                    sauvegarder();
                }
                window.location.href = PAGES[pageIndex].path;
            }
        }

        // Ajoute des indicateurs de modaux disponibles
        addModalIndicators() {
            const currentPath = window.estPageAccueil() ? '/' : window.location.pathname;
            const modals = PAGE_MODALS[currentPath];

            // if (modals && modals.length > 0 && this.body) {
            //     const indicator = document.createElement('div');
            //     indicator.className = 'modal-indicators';
            //     indicator.innerHTML = `
            //         <small style="color: rgba(255,255,255,0.7); font-size: 11px; margin-top: 8px; display: block; text-align: center;">
            //             Outils disponibles: ${modals.join(', ')}
            //         </small>
            //     `;
            //     this.body.appendChild(indicator);
            // }
        }

        // Gestion de la minimisation
        setupToggle() {
            this.toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMinimize();
            });
        }

        toggleMinimize() {
            this.navigator.classList.toggle('minimized');
            const isMinimized = this.navigator.classList.contains('minimized');
            localStorage.setItem(STORAGE_KEYS.minimized, isMinimized);
        }

        // Gestion du Drag & Drop - Tout le corps de la navigation est maintenant draggable
        setupDragAndDrop() {
            // Permettre le drag sur tout le navigateur
            this.navigator.addEventListener('mousedown', this.dragStart.bind(this));
            document.addEventListener('mousemove', this.drag.bind(this));
            document.addEventListener('mouseup', this.dragEnd.bind(this));

            this.navigator.addEventListener('touchstart', this.dragStart.bind(this), { passive: false });
            document.addEventListener('touchmove', this.drag.bind(this), { passive: false });
            document.addEventListener('touchend', this.dragEnd.bind(this));
        }

        dragStart(e) {
            // Empêcher le drag si on clique sur un bouton de navigation ou le bouton toggle
            if (e.target.closest('.navigator-toggle') ||
                e.target.closest('button') ||
                e.target.tagName === 'BUTTON') {
                return;
            }

            if (e.type === 'touchstart') {
                this.initialX = e.touches[0].clientX - this.xOffset;
                this.initialY = e.touches[0].clientY - this.yOffset;
            } else {
                this.initialX = e.clientX - this.xOffset;
                this.initialY = e.clientY - this.yOffset;
            }

            this.isDragging = true;
            this.navigator.classList.add('dragging');
        }

        drag(e) {
            if (!this.isDragging) return;
            e.preventDefault();

            if (e.type === 'touchmove') {
                this.currentX = e.touches[0].clientX - this.initialX;
                this.currentY = e.touches[0].clientY - this.initialY;
            } else {
                this.currentX = e.clientX - this.initialX;
                this.currentY = e.clientY - this.initialY;
            }

            this.xOffset = this.currentX;
            this.yOffset = this.currentY;
            this.setPosition(this.currentX, this.currentY);
        }

        dragEnd() {
            if (!this.isDragging) return;
            this.isDragging = false;
            this.navigator.classList.remove('dragging');
            this.savePosition();
        }

        setPosition(x, y) {
            this.navigator.style.right = 'auto';
            this.navigator.style.bottom = 'auto';
            this.navigator.style.left = `${x}px`;
            this.navigator.style.top = `${y}px`;
        }

        savePosition() {
            const position = { x: this.xOffset, y: this.yOffset };
            localStorage.setItem(STORAGE_KEYS.position, JSON.stringify(position));
        }

        loadSavedState() {
            const savedPosition = localStorage.getItem(STORAGE_KEYS.position);
            if (savedPosition) {
                try {
                    const position = JSON.parse(savedPosition);
                    this.xOffset = position.x;
                    this.yOffset = position.y;
                    this.setPosition(position.x, position.y);
                } catch (e) {
                    console.warn('Impossible de charger la position sauvegardée');
                }
            }

            const isMinimized = localStorage.getItem(STORAGE_KEYS.minimized) === 'true';
            if (isMinimized) {
                this.navigator.classList.add('minimized');
            }
        }

        addKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                if (e.altKey && e.key === 'ArrowLeft' && !this.prevBtn.disabled) {
                    e.preventDefault();
                    this.prevBtn.click();
                }

                if (e.altKey && e.key === 'ArrowRight' && !this.nextBtn.disabled) {
                    e.preventDefault();
                    this.nextBtn.click();
                }

                if (e.altKey && e.key.toLowerCase() === 'm') {
                    e.preventDefault();
                    this.toggleMinimize();
                }
            });
        }

        // Vérifie le type d'étude et masque la navigation si ce n'est pas "Études de conception détaillée"
        checkTypeEtudeVisibility() {
            try {
                const savedData = localStorage.getItem('solarProjectData');
                if (!savedData) return;

                const projectData = JSON.parse(savedData);
                const typeEtude = projectData.projectInfo?.typeEtude?.toLowerCase() || '';

                // Masquer la navigation sauf pour "Études de conception détaillée"
                if (!typeEtude.includes('conception détaillée') && !typeEtude.includes('faisabilité détaillée')) {
                    this.navigator.style.display = 'none';
                } else {
                    this.navigator.style.display = 'block';
                }

                // NOUVEAU : Gérer la visibilité du module IRVE dans le menu de navigation
                const projectId = localStorage.getItem('current_projet_id') || 'default';
                const cachedIrve = localStorage.getItem(`irve_status_${projectId}`);
                let isIRVE = false;
                
                if (cachedIrve !== null) {
                    isIRVE = (cachedIrve === 'true');
                } else {
                    isIRVE = projectData.projectInfo?.irve === true;
                }
                
                const irveLink = document.getElementById('bd-materiels-link');
                if (irveLink) {
                    const parentLi = irveLink.closest('li');
                    if (parentLi) parentLi.style.display = isIRVE ? 'block' : 'none';
                }
            } catch (error) {
                console.warn('Erreur lors de la vérification du type d\'étude:', error);
            }
        }
    }

    // Initialiser le navigateur
    let navigatorInstance = null;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            navigatorInstance = new PageNavigator();
        });
    } else {
        navigatorInstance = new PageNavigator();
    }

    // Écouter les changements dans le localStorage pour mettre à jour la visibilité
    window.addEventListener('storage', () => {
        if (navigatorInstance) {
            navigatorInstance.checkTypeEtudeVisibility();
        }
    });

    document.addEventListener('solarProjectDataSaved', () => {
        if (navigatorInstance) {
            navigatorInstance.checkTypeEtudeVisibility();
        }
    });

})();
