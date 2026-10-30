import { SCALE_CONSTANTS, SCALE_STYLES } from './constants.js';
import ScaleCalculator from './utils/ScaleCalculator.js';

/**
 * Contrôle d'échelle personnalisable pour Google Maps
 * Affiche l'échelle actuelle de la carte et permet à l'utilisateur de la modifier
 */
export default class ScaleControl {
  /**
   * @param {Object} options - Options de configuration
   * @param {boolean} options.editable - Si true, l'utilisateur peut modifier l'échelle (défaut: true)
   * @param {Function} options.onChange - Callback appelé quand l'échelle change
   * @param {boolean} options.autoZoom - Si true, ajuste le zoom quand l'utilisateur change l'échelle (défaut: false)
   */
  constructor(options = {}) {
    this.map = null;
    this.container = null;
    this.input = null;
    this.currentScale = SCALE_CONSTANTS.DEFAULT_SCALE;
    this.debounceTimer = null;

    // CORRECTIF (bug rapporté : "je saisis une échelle 1/500, un simple clic sur la carte la fait
    // passer à 1/387") : une fois l'échelle définie manuellement (autoZoom), la carte peut faire
    // dériver le zoom réel sans intention de zoom de l'utilisateur (ex. arrondi interne au zoom
    // entier le plus proche déclenché par la moindre interaction) — zoom_changed/center_changed
    // recalculaient alors l'échelle affichée à partir de ce zoom dérivé, écrasant la valeur saisie.
    // isLocked/lockedScale gèlent l'échelle affichée sur la dernière valeur saisie par l'utilisateur
    // tant qu'il ne zoome pas volontairement à la molette (cf. handleWheel, seul déclencheur de
    // déverrouillage — la fonctionnalité demandée à conserver).
    this.isLocked = false;
    this.lockedScale = null;
    this._recentWheelUntil = 0;
    this._programmaticZoomChange = false;
    this._correctingZoom = false;

    // Options
    this.editable = options.editable !== false;
    this.autoZoom = options.autoZoom || false;
    this.onChange = options.onChange || null;

    // Binding des méthodes
    this.handleZoomChanged = this.handleZoomChanged.bind(this);
    this.handleCenterChanged = this.handleCenterChanged.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleInputChange = this.handleInputChange.bind(this);
    this.handleInputKeypress = this.handleInputKeypress.bind(this);
    this.handleInputFocus = this.handleInputFocus.bind(this);
    this.handleInputBlur = this.handleInputBlur.bind(this);
  }

  /**
   * Ajoute le contrôle à la carte
   * @param {google.maps.Map} map - Instance de la carte Google Maps
   * @returns {HTMLElement} Élément DOM du contrôle
   */
  onAdd(map) {
    this.map = map;
    this.container = this.createContainer();
    
    // Écouter les changements de zoom et de centre
    this.map.addListener('zoom_changed', this.handleZoomChanged);
    this.map.addListener('center_changed', this.handleCenterChanged);

    // NOUVEAU : détecte un zoom molette volontaire (cf. isLocked ci-dessus) — seul déclencheur de
    // déverrouillage de l'échelle figée.
    this._mapDiv = this.map.getDiv ? this.map.getDiv() : null;
    if (this._mapDiv) {
      this._mapDiv.addEventListener('wheel', this.handleWheel, { passive: true });
    }

    // Mise à jour initiale
    this.updateScale();

    return this.container;
  }

  /**
   * Retire le contrôle de la carte
   */
  onRemove() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    // Nettoyer les listeners
    if (this.map) {
      google.maps.event.clearInstanceListeners(this.map);
    }
    if (this._mapDiv) {
      this._mapDiv.removeEventListener('wheel', this.handleWheel);
    }
    this._mapDiv = null;

    this.map = null;
    this.container = null;
    this.input = null;
  }

  /**
   * Crée le conteneur du contrôle
   * @returns {HTMLElement} Conteneur
   */
  createContainer() {
    const container = document.createElement('div');
    container.className = 'scale-control';
    
    // Appliquer les styles
    Object.assign(container.style, SCALE_STYLES.container);
    
    // Créer le label "Échelle:"
    const label = document.createElement('span');
    label.textContent = 'Échelle:';
    Object.assign(label.style, SCALE_STYLES.label);
    
    // Créer le préfixe "1 /"
    const prefix = document.createElement('span');
    prefix.textContent = '1 /';
    Object.assign(prefix.style, SCALE_STYLES.label);
    
    // Créer l'input
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.value = Math.round(this.currentScale);
    this.input.readOnly = !this.editable;
    Object.assign(this.input.style, SCALE_STYLES.input);
    
    if (this.editable) {
      // Ajouter les écouteurs d'événements pour l'input
      this.input.addEventListener('input', this.handleInputChange);
      this.input.addEventListener('keypress', this.handleInputKeypress);
      this.input.addEventListener('focus', this.handleInputFocus);
      this.input.addEventListener('blur', this.handleInputBlur);
      this.input.title = 'Cliquez pour modifier l\'échelle';
    } else {
      this.input.style.cursor = 'default';
      this.input.style.backgroundColor = '#f5f5f5';
    }
    
    // Assembler les éléments
    container.appendChild(label);
    container.appendChild(prefix);
    container.appendChild(this.input);
    
    return container;
  }

  /**
   * Détecte un zoom molette volontaire (seul moyen de déverrouiller une échelle figée, cf.
   * constructeur) — fenêtre de tolérance de 500ms largement suffisante entre l'évènement DOM natif
   * 'wheel' et le zoom_changed correspondant de Google Maps.
   */
  handleWheel() {
    this._recentWheelUntil = Date.now() + 500;
  }

  /**
   * Rétablit le zoom correspondant à l'échelle figée (lockedScale) à la latitude courante, sans
   * jamais modifier l'affichage — utilisé quand la carte dérive du zoom voulu par l'utilisateur
   * (ex. arrondi interne au zoom entier le plus proche après un simple clic) sans intention réelle
   * de zoomer.
   */
  reassertLockedZoom() {
    if (!this.map || this.lockedScale === null) return;
    const center = this.map.getCenter();
    if (!center) return;

    const latitude = center.lat();
    const correctZoom = ScaleCalculator.calculateZoomForScale(this.lockedScale, latitude);
    const currentZoom = this.map.getZoom() || 0;

    if (Math.abs(currentZoom - correctZoom) < 0.001) return; // déjà correct

    this._correctingZoom = true;
    this.map.setZoom(correctZoom);
  }

  /**
   * Gère les changements de zoom
   */
  handleZoomChanged() {
    // Changement de zoom que NOUS avons déclenché (saisie d'échelle ou correction de dérive
    // ci-dessous) : déjà traité, ne pas relancer de recalcul/écraser l'affichage.
    if (this._programmaticZoomChange) {
      this._programmaticZoomChange = false;
      return;
    }
    if (this._correctingZoom) {
      this._correctingZoom = false;
      return;
    }

    // CORRECTIF (bug rapporté) : tant qu'une échelle a été figée par l'utilisateur, seul un zoom
    // molette volontaire (handleWheel) doit la faire évoluer — toute autre variation de zoom (ex.
    // dérive/arrondi déclenché par un simple clic) est ignorée pour l'affichage et immédiatement
    // corrigée pour rester sur l'échelle figée.
    if (this.isLocked) {
      const isWheelZoom = Date.now() < this._recentWheelUntil;
      if (!isWheelZoom) {
        this.reassertLockedZoom();
        return;
      }
      // Zoom molette volontaire : on déverrouille, l'échelle redevient dynamique.
      this.isLocked = false;
      this.lockedScale = null;
    }

    // Utiliser un petit délai pour éviter trop de mises à jour
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.updateScale();
    }, 50);
  }

  /**
   * Gère les changements de centre (latitude)
   */
  handleCenterChanged() {
    // CORRECTIF (bug rapporté) : idem handleZoomChanged — une échelle figée par l'utilisateur ne
    // doit pas dériver au grè d'un déplacement/clic sur la carte (la résolution mètres/pixel dépend
    // aussi de la latitude via cos(latitude)). On garde juste le zoom cohérent avec l'échelle figée
    // à la nouvelle latitude, sans jamais toucher à l'affichage.
    if (this.isLocked) {
      this.reassertLockedZoom();
      return;
    }

    // Mettre à jour l'échelle car elle dépend de la latitude
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.updateScale();
    }, 100);
  }

  /**
   * Met à jour l'échelle affichée en fonction du zoom actuel
   */
  updateScale() {
    if (!this.map) return;

    // CORRECTIF (bug rapporté) : garde-fou de dernier recours — tant que l'échelle est figée
    // (isLocked), aucun appel à updateScale() (ex. un debounceTimer déjà programmé avant la saisie,
    // qui se déclencherait après coup) ne doit écraser l'affichage/currentScale. Seul
    // handleZoomChanged (zoom molette détecté) déverrouille avant d'appeler updateScale().
    if (this.isLocked) return;

    const zoom = this.map.getZoom();
    const center = this.map.getCenter();
    const latitude = center.lat();
    
    this.currentScale = ScaleCalculator.calculateScale(zoom, latitude);
    
    // Mettre à jour l'input seulement s'il n'a pas le focus
    if (document.activeElement !== this.input) {
      this.input.value = Math.round(this.currentScale);
    }
    
    // Appeler le callback si défini
    if (this.onChange) {
      this.onChange(this.currentScale);
    }
  }

  /**
   * Gère les changements dans l'input
   * @param {Event} event - Événement input
   */
  handleInputChange(event) {
    // Filtrer pour ne garder que les chiffres
    let value = event.target.value;
    const numbersOnly = value.replace(/\D/g, '');
    
    // Si la valeur a changé après filtrage, la mettre à jour
    if (value !== numbersOnly) {
      event.target.value = numbersOnly;
      return;
    }
    
    // Débounce pour éviter trop de mises à jour
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(() => {
      this.applyScaleChange(numbersOnly);
    }, SCALE_CONSTANTS.DEBOUNCE_DELAY);
  }

  /**
   * Gère la touche Entrée dans l'input
   * @param {KeyboardEvent} event - Événement clavier
   */
  handleInputKeypress(event) {
    // Si Entrée est pressée, appliquer immédiatement
    if (event.key === 'Enter') {
      event.preventDefault();
      this.input.blur();
      
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      
      this.applyScaleChange(this.input.value);
    }
    
    // Bloquer les caractères non numériques
    if (!/\d/.test(event.key) && event.key !== 'Enter') {
      event.preventDefault();
    }
  }

  /**
   * Gère le focus sur l'input
   */
  handleInputFocus() {
    Object.assign(this.input.style, SCALE_STYLES.inputFocused);
    this.input.select();
  }

  /**
   * Gère la perte de focus sur l'input
   */
  handleInputBlur() {
    this.input.style.borderColor = '#ddd';
    this.input.style.boxShadow = 'none';
    
    // Appliquer le changement si nécessaire
    const scale = ScaleCalculator.parseScale(this.input.value);
    if (scale) {
      this.applyScaleChange(this.input.value);
    } else {
      // Restaurer la valeur actuelle si invalide
      this.input.value = Math.round(this.currentScale);
    }
  }

  /**
   * Applique un changement d'échelle
   * @param {string} value - Nouvelle valeur d'échelle
   */
  applyScaleChange(value) {
    const scale = ScaleCalculator.parseScale(value);
    
    if (!scale) {
      // Valeur invalide, restaurer l'échelle actuelle
      this.input.value = Math.round(this.currentScale);
      return;
    }
    
    this.currentScale = scale;

    // Si autoZoom est activé, ajuster le zoom de la carte
    if (this.autoZoom && this.map) {
      const center = this.map.getCenter();
      const latitude = center.lat();
      const newZoom = ScaleCalculator.calculateZoomForScale(scale, latitude);

      // CORRECTIF (bug rapporté) : fige l'échelle sur cette valeur saisie par l'utilisateur — cf.
      // handleZoomChanged/handleCenterChanged, qui la maintiennent tant qu'aucun zoom molette
      // volontaire n'a lieu.
      this.isLocked = true;
      this.lockedScale = scale;
      this._programmaticZoomChange = true;
      this.map.setZoom(newZoom);
    } else {
      // Sinon, juste mettre à jour l'affichage
      this.input.value = Math.round(scale);
    }
    
    // Appeler le callback si défini
    if (this.onChange) {
      this.onChange(scale);
    }
  }

  /**
   * Obtient l'échelle actuelle
   * @returns {number} Échelle actuelle
   */
  getScale() {
    return this.currentScale;
  }

  /**
   * Définit une nouvelle échelle
   * @param {number} scale - Nouvelle échelle
   * @param {boolean} updateZoom - Si true, ajuste le zoom (défaut: false)
   */
  setScale(scale, updateZoom = false) {
    if (!ScaleCalculator.isValidScale(scale)) {
      console.warn('Échelle invalide:', scale);
      return;
    }
    
    this.currentScale = scale;
    this.input.value = Math.round(scale);

    if (updateZoom && this.map) {
      const center = this.map.getCenter();
      const latitude = center.lat();
      const newZoom = ScaleCalculator.calculateZoomForScale(scale, latitude);

      // CORRECTIF (bug rapporté) : même verrouillage que applyScaleChange ci-dessus.
      this.isLocked = true;
      this.lockedScale = scale;
      this._programmaticZoomChange = true;
      this.map.setZoom(newZoom);
    }
  }
}

