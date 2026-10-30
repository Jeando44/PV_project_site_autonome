/**
 * Composant pour afficher un indicateur de chargement
 * Utilisé pour les opérations longues (génération PDF, sauvegarde, calculs, etc.)
 */
class LoadingIndicator {
    constructor() {
        this.overlay = null;
        this.container = null;
        this.messageElement = null;
        this.createIndicator();
    }

    createIndicator() {
        // Créer l'overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'loading-indicator-overlay';
        this.overlay.style.cssText = `
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 1040000; /* au-dessus du modal universel (100000), laissé ouvert pendant le rapport */
            backdrop-filter: blur(3px);
        `;

        // Créer le conteneur principal
        this.container = document.createElement('div');
        this.container.className = 'loading-indicator-container';
        this.container.style.cssText = `
            display: none;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            z-index: 1040001;
            text-align: center;
            min-width: 300px;
        `;

        // Créer le spinner
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        spinner.innerHTML = `
            <svg width="60" height="60" viewBox="0 0 50 50" style="margin: 0 auto 20px;">
                <circle cx="25" cy="25" r="20" fill="none" stroke="#e0e0e0" stroke-width="4"/>
                <circle cx="25" cy="25" r="20" fill="none" stroke="#de0000" stroke-width="4"
                        stroke-dasharray="80" stroke-dashoffset="0" stroke-linecap="round"
                        style="animation: loading-spin 1.4s ease-in-out infinite;">
                    <animateTransform attributeName="transform" type="rotate"
                                      from="0 25 25" to="360 25 25"
                                      dur="1.4s" repeatCount="indefinite"/>
                </circle>
            </svg>
        `;

        // Créer le message
        this.messageElement = document.createElement('div');
        this.messageElement.className = 'loading-message';
        this.messageElement.style.cssText = `
            font-size: 16px;
            color: #333;
            margin-bottom: 10px;
            font-weight: 500;
        `;
        this.messageElement.textContent = 'Traitement en cours...';

        // Créer le sous-message
        const submessage = document.createElement('div');
        submessage.className = 'loading-submessage';
        submessage.style.cssText = `
            font-size: 13px;
            color: #888;
        `;
        submessage.textContent = 'Veuillez patienter';

        // Assembler
        this.container.appendChild(spinner);
        this.container.appendChild(this.messageElement);
        this.container.appendChild(submessage);

        // Ajouter les animations CSS
        const style = document.createElement('style');
        style.textContent = `
            @keyframes loading-spin {
                0% {
                    stroke-dashoffset: 80;
                    transform: rotate(0deg);
                }
                50% {
                    stroke-dashoffset: 0;
                    transform: rotate(180deg);
                }
                100% {
                    stroke-dashoffset: -80;
                    transform: rotate(360deg);
                }
            }

            @keyframes loading-fade-in {
                from {
                    opacity: 0;
                }
                to {
                    opacity: 1;
                }
            }

            .loading-indicator-overlay,
            .loading-indicator-container {
                animation: loading-fade-in 0.2s ease-out;
            }
        `;
        document.head.appendChild(style);

        // Ajouter au DOM
        document.body.appendChild(this.overlay);
        document.body.appendChild(this.container);
    }

    /**
     * Affiche l'indicateur de chargement
     * @param {string} message - Message à afficher
     */
    show(message = 'Traitement en cours...') {
        this.messageElement.textContent = message;
        this.overlay.style.display = 'block';
        this.container.style.display = 'block';
        console.log('🔄 [LoadingIndicator] Affichage:', message);
    }

    /**
     * Masque l'indicateur de chargement
     */
    hide() {
        this.overlay.style.display = 'none';
        this.container.style.display = 'none';
        console.log('✅ [LoadingIndicator] Masqué');
    }

    /**
     * Met à jour le message de l'indicateur
     * @param {string} message - Nouveau message
     */
    updateMessage(message) {
        this.messageElement.textContent = message;
    }

    /**
     * Masque temporairement l'indicateur visuellement (pour captures d'écran)
     * Sans changer l'état interne
     */
    hideTemporarily() {
        if (this.overlay) {
            this.overlay.style.visibility = 'hidden';
        }
        if (this.container) {
            this.container.style.visibility = 'hidden';
        }
        console.log('🔄 [LoadingIndicator] Masqué temporairement pour capture');
    }

    /**
     * Restaure la visibilité de l'indicateur après une capture
     */
    restoreVisibility() {
        if (this.overlay && this.overlay.style.display === 'block') {
            this.overlay.style.visibility = 'visible';
        }
        if (this.container && this.container.style.display === 'block') {
            this.container.style.visibility = 'visible';
        }
        console.log('🔄 [LoadingIndicator] Visibilité restaurée après capture');
    }
}

// Créer une instance globale
if (typeof window !== 'undefined') {
    window.loadingIndicator = new LoadingIndicator();
}

export default LoadingIndicator;
