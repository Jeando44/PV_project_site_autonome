/**
 * Core JavaScript pour les modals de géométrie
 * Gestion du mode embedded et communication avec le parent
 */

/**
 * Classe de base pour les modals de géométrie
 */
class GeometrieModalCore {
    constructor() {
        // Initialiser le logger si disponible
        this.logger = window.logger || {
            info: console.log.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
            debug: console.log.bind(console),
            start: console.log.bind(console),
            end: console.log.bind(console),
            fail: console.error.bind(console),
            event: console.log.bind(console),
            message: console.log.bind(console),
            state: console.log.bind(console),
            checkElement: (id) => document.getElementById(id)
        };

        this.logger.start('Initialisation de GeometrieModalCore');

        // Détection du mode embedded
        this.isEmbedded = window.parent !== window;
        this.logger.info('Mode détecté', { embedded: this.isEmbedded });

        // Vérifier l'environnement
        this.checkEnvironment();

        this.modalElement = null;
        this.modalOverlay = null;
        this.welcomeOverlay = null;
        this.closeButton = null;

        // Valeurs par défaut pour maximiser l'affichage
        this.defaultPosition = {
            width: '95vw',
            maxWidth: '1700px',
            height: '95vh',
            maxHeight: '95vh'
        };

        this.init();
    }

    /**
     * Vérifier l'environnement et afficher des warnings si nécessaire
     */
    checkEnvironment() {
        // Warning pour Tailwind CDN en production
        const tailwindScript = document.querySelector('script[src*="cdn.tailwindcss.com"]');
        if (tailwindScript) {
            this.logger.warn('⚠️ Tailwind CDN détecté - Ne pas utiliser en production!', {
                recommendation: 'Installer Tailwind via PostCSS ou CLI',
                docs: 'https://tailwindcss.com/docs/installation'
            });
        }

        // Vérifier que le logger est bien chargé
        if (!window.logger) {
            console.warn('[GeometrieModalCore] Logger non chargé - utilisation des fallbacks');
        }

        this.logger.debug('Environnement vérifié');
    }

    /**
     * Initialisation du modal
     */
    init() {
        this.logger.start('Initialisation du modal');

        // Appliquer le mode embedded si nécessaire
        if (this.isEmbedded) {
            try {
                document.body.classList.add('embedded-mode');
                this.logger.state('Mode embedded appliqué', 'standalone', 'embedded');
            } catch (error) {
                this.logger.error('Erreur lors de l\'application du mode embedded', error);
            }
        }

        // Attendre que le DOM soit chargé
        if (document.readyState === 'loading') {
            this.logger.info('DOM en cours de chargement - attente de DOMContentLoaded');
            document.addEventListener('DOMContentLoaded', () => {
                this.logger.info('DOMContentLoaded déclenché');
                this.setupElements();
            });
        } else {
            this.logger.info('DOM déjà chargé - configuration immédiate');
            this.setupElements();
        }

        this.logger.end('Initialisation du modal');
    }

    /**
     * Configuration des éléments du DOM
     */
    setupElements() {
        this.logger.start('Configuration des éléments DOM');

        // Vérifier et récupérer les éléments critiques
        this.modalElement = this.logger.checkElement('app-modal', true);
        this.modalOverlay = this.logger.checkElement('modal-overlay', false);
        this.welcomeOverlay = this.logger.checkElement('welcome-modal-overlay', false);
        this.closeButton = this.logger.checkElement('close-modal-btn', true);

        if (!this.modalElement) {
            this.logger.error('❌ Élément #app-modal introuvable - le modal ne peut pas fonctionner!');
            return;
        }

        // Configurer les event listeners
        if (this.closeButton) {
            this.closeButton.addEventListener('click', (e) => {
                this.logger.event('click', this.closeButton, 'Fermeture demandée');
                this.handleClose(e);
            });
            this.logger.debug('✓ Event listener ajouté: close-modal-btn');
        } else {
            this.logger.warn('Bouton de fermeture introuvable - la fermeture peut être impossible');
        }

        // Gérer le bouton de lancement si présent
        const launchButton = this.logger.checkElement('launch-btn', false);
        if (launchButton) {
            launchButton.addEventListener('click', () => {
                this.logger.event('click', launchButton, 'Lancement demandé');
                this.handleLaunch();
            });
            this.logger.debug('✓ Event listener ajouté: launch-btn');
        }

        // Si en mode embedded, ouvrir automatiquement le modal
        if (this.isEmbedded) {
            this.logger.info('Mode embedded détecté - ouverture automatique du modal');
            // Petite délai pour s'assurer que tout est chargé
            setTimeout(() => {
                this.openModal();
            }, 100);
        }

        this.logger.end('Configuration des éléments DOM');
    }

    /**
     * Ouvrir le modal
     */
    openModal() {
        this.logger.start('Ouverture du modal');

        try {
            if (this.modalElement) {
                this.modalElement.classList.remove('hidden');
                this.logger.debug('Modal visible');
            } else {
                this.logger.error('Impossible d\'ouvrir le modal - élément introuvable');
                return;
            }

            if (this.modalOverlay && !this.isEmbedded) {
                this.modalOverlay.classList.remove('hidden');
                this.logger.debug('Overlay visible');
            }

            if (this.welcomeOverlay) {
                this.welcomeOverlay.style.display = 'none';
                this.logger.debug('Welcome overlay masqué');
            }

            this.logger.end('Ouverture du modal');
        } catch (error) {
            this.logger.fail('Ouverture du modal', error);
        }
    }

    /**
     * Gérer le clic sur le bouton de lancement
     */
    handleLaunch() {
        this.logger.info('🚀 Lancement du configurateur');
        this.openModal();
    }

    /**
     * Gérer la fermeture du modal
     */
    handleClose(e) {
        this.logger.start('Fermeture du modal');

        try {
            if (this.isEmbedded) {
                // En mode embedded, informer le parent
                this.logger.message('sent', 'closeModal', { origin: window.location.origin });
                window.parent.postMessage({ action: 'closeModal' }, '*');
                this.logger.info('Message de fermeture envoyé au parent');
            } else {
                // En mode standalone, masquer le modal
                if (this.modalElement) {
                    this.modalElement.classList.add('hidden');
                    this.logger.debug('Modal masqué');
                }

                if (this.modalOverlay) {
                    this.modalOverlay.classList.add('hidden');
                    this.logger.debug('Overlay masqué');
                }

                if (this.welcomeOverlay) {
                    this.welcomeOverlay.style.display = 'flex';
                    this.logger.debug('Welcome overlay affiché');
                }
            }

            this.logger.end('Fermeture du modal');
        } catch (error) {
            this.logger.fail('Fermeture du modal', error);
        }
    }

    /**
     * Synchroniser un champ avec la page parent (calepinage)
     * @param {string} fieldName - Nom du champ à synchroniser
     * @param {any} value - Valeur à synchroniser
     */
    syncFieldToParent(fieldName, value) {
        this.logger.start('Synchronisation du champ', { fieldName, value });

        try {
            // Sauvegarder dans localStorage
            const data = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
            const oldValue = data[fieldName];
            
            // Bloquer l'envoi de données redondantes pour casser net les boucles infinies de postMessage
            const isSame = (String(oldValue) === String(value)) || 
                           (!isNaN(oldValue) && !isNaN(value) && oldValue !== null && value !== null && Number(oldValue) === Number(value));
            
            if (isSame && oldValue !== undefined) {
                this.logger.end('Synchronisation du champ (ignorée : valeur identique ou équivalente)');
                return;
            }

            data[fieldName] = value;
            localStorage.setItem('solarProjectData', JSON.stringify(data));

            this.logger.debug('localStorage mis à jour', {
                fieldName,
                oldValue,
                newValue: value
            });

            // Envoyer un message au parent si en mode embedded
            if (this.isEmbedded) {
                const message = {
                    action: 'updateCalepinageField',
                    fieldName: fieldName,
                    value: value
                };
                window.parent.postMessage(message, '*');
                this.logger.message('sent', 'updateCalepinageField', { fieldName, value });
            } else {
                this.logger.warn('Mode standalone - synchronisation limitée au localStorage');
            }

            this.logger.end('Synchronisation du champ');
        } catch (error) {
            this.logger.fail('Synchronisation du champ', error);
        }
    }

    /**
     * Gérer le drag & drop du modal (si non embedded)
     */
    setupDragging() {
        if (this.isEmbedded || !this.modalElement) {
            return;
        }

        const header = document.getElementById('modal-header');
        if (!header) {
            return;
        }

        let isDragging = false;
        let offsetX, offsetY;

        header.addEventListener('mousedown', (e) => {
            if (e.target === header || header.contains(e.target)) {
                isDragging = true;
                const rect = this.modalElement.getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
                header.style.cursor = 'grabbing';
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging && this.modalElement) {
                const x = e.clientX - offsetX;
                const y = e.clientY - offsetY;

                this.modalElement.style.left = `${x}px`;
                this.modalElement.style.top = `${y}px`;
                this.modalElement.style.transform = 'none';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                if (header) {
                    header.style.cursor = 'move';
                }
            }
        });
    }

    /**
     * Ajuster la taille du canvas lors du redimensionnement
     */
    scheduleCanvasUpdate(updateCallback) {
        if (!this.updateScheduled) {
            this.updateScheduled = true;
            requestAnimationFrame(() => {
                if (typeof updateCallback === 'function') {
                    updateCallback();
                }
                this.updateScheduled = false;
            });
        }
    }

    /**
     * Gérer le redimensionnement de la fenêtre
     */
    setupResizeHandler(callback) {
        window.addEventListener('resize', () => {
            this.scheduleCanvasUpdate(callback);
        });
    }
}

// Exporter pour utilisation dans les autres modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GeometrieModalCore;
}
