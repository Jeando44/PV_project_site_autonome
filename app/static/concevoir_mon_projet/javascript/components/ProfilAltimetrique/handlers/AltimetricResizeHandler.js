/**
 * Gestionnaire de redimensionnement horizontal pour le composant ProfilAltimetrique
 * @class AltimetricResizeHandler
 */
class AltimetricResizeHandler {
  /**
   * @param {HTMLElement} container - Container à redimensionner
   * @param {Object} options - Options de configuration
   * @param {Function} options.onResize - Callback appelé lors du redimensionnement
   * @param {number} options.minWidth - Largeur minimale en pixels (obligatoire)
   * @param {number} options.maxWidth - Largeur maximale en pixels (optionnel, calculée dynamiquement si non fournie)
   * @param {number} options.defaultWidth - Largeur par défaut en pixels (obligatoire)
   * @param {google.maps.Map} options.map - Instance de la carte Google Maps (optionnel, utilisé pour calculer maxWidth)
   */
  constructor(container, options = {}) {
    this.container = container;
    this.onResize = options.onResize || null;
    this.map = options.map || null;
    
    // Les valeurs minWidth et defaultWidth sont obligatoires
    if (typeof options.minWidth !== 'number') {
      throw new Error('minWidth est obligatoire et doit être un nombre');
    }
    if (typeof options.defaultWidth !== 'number') {
      throw new Error('defaultWidth est obligatoire et doit être un nombre');
    }
    
    this.minWidth = options.minWidth;
    this.defaultWidth = options.defaultWidth;
    
    // Calculer maxWidth dynamiquement basé sur la largeur de la carte Google Maps
    // Si maxWidth est fourni dans les options, l'utiliser, sinon calculer dynamiquement
    if (typeof options.maxWidth === 'number') {
      this.maxWidth = options.maxWidth;
    } else {
      // Calculer maxWidth basé sur la largeur du conteneur de la carte
      this.maxWidth = this._calculateMaxWidthFromMap();
    }
    
    // Écouter les changements de taille de fenêtre pour mettre à jour maxWidth
    this._setupWindowResizeListener();
    
    this.isResizing = false;
    this.startX = 0;
    this.startWidth = 0;
    
    this.resizeHandle = null;
    
    // Créer une référence liée pour _preventSelection pour permettre sa suppression correcte
    this._preventSelectionBound = this._preventSelection.bind(this);
    
    this._createResizeHandle();
    this._attachEventListeners();
    this._loadSavedWidth();
  }

  /**
   * Calcule la largeur maximale basée sur la largeur du conteneur de la carte Google Maps
   * @private
   * @returns {number} Largeur maximale en pixels
   */
  _calculateMaxWidthFromMap() {
    if (!this.map) {
      // Fallback si la carte n'est pas disponible : utiliser 80% de la largeur de l'écran
      return Math.floor(window.innerWidth * 0.9);
    }
    
    try {
      const mapDiv = this.map.getDiv();
      if (!mapDiv) {
        return Math.floor(window.innerWidth * 0.9);
      }
      
      const mapWidth = mapDiv.offsetWidth || mapDiv.getBoundingClientRect().width;
      if (!mapWidth || mapWidth === 0) {
        return Math.floor(window.innerWidth * 0.9);
      }
      
      return mapWidth;
    } catch (error) {
      console.warn('[AltimetricResizeHandler] Erreur lors du calcul de la largeur de la carte:', error);
      return Math.floor(window.innerWidth * 0.9);
    }
  }

  /**
   * Met à jour la référence de la carte Google Maps
   * @param {google.maps.Map} map - Instance de la carte
   */
  updateMap(map) {
    this.map = map;
    // Recalculer maxWidth avec la nouvelle référence de carte
    const newMaxWidth = this._calculateMaxWidthFromMap();
    
    // Si la largeur actuelle dépasse le nouveau maxWidth, la réduire
    const currentWidth = this.container.offsetWidth;
    if (currentWidth > newMaxWidth) {
      this._updateWidth(newMaxWidth);
      this._saveWidth();
    }
    
    this.maxWidth = newMaxWidth;
  }

  /**
   * Configure l'écouteur pour les changements de taille de fenêtre
   * @private
   */
  _setupWindowResizeListener() {
    this._windowResizeHandler = () => {
      // Recalculer maxWidth basé sur la largeur actuelle de la carte
      const newMaxWidth = this._calculateMaxWidthFromMap();
      
      // Si la largeur actuelle dépasse le nouveau maxWidth, la réduire
      const currentWidth = this.container.offsetWidth;
      if (currentWidth > newMaxWidth) {
        this._updateWidth(newMaxWidth);
        this._saveWidth();
      }
      
      this.maxWidth = newMaxWidth;
    };
    
    window.addEventListener('resize', this._windowResizeHandler);
  }

  /**
   * Crée la poignée de redimensionnement
   * @private
   */
  _createResizeHandle() {
    const handle = document.createElement('div');
    handle.classList.add('profil-resize-handle');
    handle.style.cssText = `
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background-color: transparent;
      cursor: ew-resize;
      z-index: 1000;
      transition: background-color 0.2s ease;
    `;

    // Ajouter un indicateur visuel au survol
    handle.addEventListener('mouseenter', () => {
      if (!this.isResizing) {
        handle.style.backgroundColor = '#2196F3';
      }
    });

    handle.addEventListener('mouseleave', () => {
      if (!this.isResizing) {
        handle.style.backgroundColor = 'transparent';
      }
    });

    this.resizeHandle = handle;
    this.container.style.position = 'relative';
    this.container.appendChild(handle);
  }

  /**
   * Attache les écouteurs d'événements pour le redimensionnement
   * @private
   */
  _attachEventListeners() {
    // Démarrer le redimensionnement
    this.resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      this.isResizing = true;
      this.startX = e.clientX;
      this.startWidth = this.container.offsetWidth;
      
      this.resizeHandle.style.backgroundColor = '#2196F3';
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      
      // Empêcher la sélection de texte pendant le redimensionnement
      document.addEventListener('selectstart', this._preventSelectionBound);
    });

    // Redimensionner pendant le mouvement
    document.addEventListener('mousemove', (e) => {
      if (!this.isResizing) return;

      const diff = e.clientX - this.startX;
      const newWidth = this.startWidth + diff;
      this._updateWidth(newWidth);
    });

    // Arrêter le redimensionnement
    document.addEventListener('mouseup', () => {
      if (!this.isResizing) return;
      
      this.isResizing = false;
      this.resizeHandle.style.backgroundColor = 'transparent';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      document.removeEventListener('selectstart', this._preventSelectionBound);
      
      // Sauvegarder la largeur
      this._saveWidth();
    });
  }

  /**
   * Empêche la sélection de texte pendant le redimensionnement
   * @private
   */
  _preventSelection(e) {
    e.preventDefault();
    return false;
  }

  /**
   * Met à jour la largeur du container
   * @private
   * @param {number} width - Nouvelle largeur en pixels
   */
  _updateWidth(width) {
    const clampedWidth = Math.min(Math.max(width, this.minWidth), this.maxWidth);
    
    // Forcer la suppression de max-width CSS qui pourrait bloquer
    if (this.container) {
      this.container.style.maxWidth = 'none';
      this.container.style.minWidth = `${this.minWidth}px`;
    }
    
    requestAnimationFrame(() => {
      if (!this.container) return;
      
      this.container.style.width = `${clampedWidth}px`;
      
      // Appeler le callback si fourni
      if (this.onResize) {
        this.onResize(clampedWidth);
      }
    });
  }

  /**
   * Charge la largeur sauvegardée depuis localStorage
   * @private
   */
  _loadSavedWidth() {
    try {
      const savedWidth = localStorage.getItem('profil_altimetrique_width');
      if (savedWidth) {
        const width = parseInt(savedWidth, 10);
        if (width >= this.minWidth && width <= this.maxWidth) {
          this._updateWidth(width);
        } else {
          this._updateWidth(this.defaultWidth);
        }
      } else {
        this._updateWidth(this.defaultWidth);
      }
    } catch (error) {
      console.warn('Erreur lors du chargement de la largeur sauvegardée:', error);
      this._updateWidth(this.defaultWidth);
    }
  }

  /**
   * Sauvegarde la largeur actuelle dans localStorage
   * @private
   */
  _saveWidth() {
    try {
      const currentWidth = this.container?.offsetWidth || 0;
      localStorage.setItem('profil_altimetrique_width', currentWidth.toString());
    } catch (error) {
      console.warn('Erreur lors de la sauvegarde de la largeur:', error);
    }
  }

  /**
   * Réinitialise la largeur à la valeur par défaut
   */
  resetWidth() {
    if (!this.container) return;
    
    // Forcer la suppression des contraintes CSS qui pourraient bloquer
    this.container.style.maxWidth = 'none';
    this.container.style.minWidth = `${this.minWidth}px`;
    
    // Réinitialiser à la largeur par défaut
    const targetWidth = Math.min(Math.max(this.defaultWidth, this.minWidth), this.maxWidth);
    
    // Appliquer directement la largeur sans passer par requestAnimationFrame pour une réponse immédiate
    this.container.style.width = `${targetWidth}px`;
    
    // Sauvegarder la nouvelle largeur
    this._saveWidth();
    
    // Appeler le callback si fourni
    if (this.onResize) {
      setTimeout(() => {
        this.onResize(targetWidth);
      }, 10);
    }
  }

  /**
   * Nettoie les ressources
   */
  destroy() {
    if (this.resizeHandle) {
      this.resizeHandle.remove();
      this.resizeHandle = null;
    }
    
    // Retirer l'écouteur de redimensionnement de fenêtre
    if (this._windowResizeHandler) {
      window.removeEventListener('resize', this._windowResizeHandler);
      this._windowResizeHandler = null;
    }
    
    // Retirer l'écouteur de sélection avec la référence liée
    if (this._preventSelectionBound) {
      document.removeEventListener('selectstart', this._preventSelectionBound);
      this._preventSelectionBound = null;
    }
    
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
}

export default AltimetricResizeHandler;

