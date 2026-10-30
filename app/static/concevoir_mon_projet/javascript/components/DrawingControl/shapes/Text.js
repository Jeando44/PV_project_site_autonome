import { DRAWING_CONSTANTS, STYLES, CUSTOM_EVENTS } from '../constants.js';

/**
 * Classe gérant les textes sur la carte
 */
class Text {
  /**
   * Constructeur
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   */
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.drawnTexts = [];
    this.selectedText = null;
    this.usedTextIds = new Set();
    this.textLabels = new Map();
  }

  /**
   * Crée un nouveau texte sur la carte
   * @param {google.maps.LatLng} position - Position du texte
   * @returns {google.maps.marker.AdvancedMarkerElement} - Le marqueur de texte créé
   */
  async createText(position) {
    const textId = this.generateTextId();
    const defaultText = 'Double-cliquez pour éditer';

    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.textContent = defaultText;
    Object.assign(div.style, STYLES.DEFAULT_TEXT);

    const marker = new this.drawingControl.AdvancedMarkerElement({
      map: this.drawingControl.map,
      position: position,
      content: div,
      draggable: true,
      title: 'Double-cliquez pour éditer'
    });

    marker.textId = textId;
    this.drawnTexts.push(marker);
    this.usedTextIds.add(textId);

    // Configurer les écouteurs d'événements
    this.setupTextListeners(marker, div);

    // Sauvegarder le texte
    this.saveTextData(marker);

    // Déclencher l'événement d'ajout
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.TEXT_ADDED, {
      detail: { textId, position }
    }));
    // Sélectionner le texte
    this.setTextSelection(marker);
    return marker;
  }

  /**
   * Configure les écouteurs d'événements pour un texte
   * @param {google.maps.marker.AdvancedMarkerElement} marker - Marqueur du texte
   * @param {HTMLElement} div - Élément DOM du texte
   */
  setupTextListeners(marker, div) {
    // Sélection du texte
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setTextSelection(marker);
    });

    // Édition du texte
    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      div.innerHTML = '';
      div.focus();
    });

    // Suppression si texte vide et sauvegarde si texte non vide
    div.addEventListener('blur', () => {
      if (div.textContent.trim() === '') {
        this.deleteSelectedText();
      } else {
        this.saveTextData(marker);
      }
    });

    // Sauvegarde après déplacement
    marker.addListener('dragend', () => {
      this.saveTextData(marker);
    });

    // Gestion améliorée des événements de clavier
    div.addEventListener('keydown', (e) => {
      e.stopPropagation();
      
      // Sauvegarder avec Enter
      if (e.key === 'Enter') {
        e.preventDefault();
        div.blur(); // Déclenchera l'événement blur qui sauvegarde
      }
      
      // Supprimer avec Delete ou Backspace
      if (e.key === 'Delete' || e.key ==='Backspace') {
        if (div.textContent.trim() === '') {
          e.preventDefault();
          this.deleteSelectedText();
        }
      }
    });

    // Ajouter un gestionnaire global pour la touche Delete
    const handleTextDeleteKeydown = (e) => {
      const offsetModalOpen = this.drawingControl?.offsetModal?.isOpen?.();
      if (offsetModalOpen && (e.key === 'Delete' || e.key === 'Backspace')) {
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedText) {
        e.preventDefault();
        this.deleteSelectedText();
      }
    };
    // Ajouter l'écouteur pour le clic droit
    google.maps.event.addListener(marker, 'rightclick', () => {
      if(this.selectedText) {
        this.deleteSelectedText();
      }
    });
    // Ajouter l'écouteur global
    document.addEventListener('keydown', handleTextDeleteKeydown);


    // Stocker la référence à l'écouteur pour pouvoir le supprimer plus tard
    if (!marker._listeners) marker._listeners = [];
    marker._listeners.push({ type: 'keydown', listener: handleTextDeleteKeydown, element: document });

    // Nettoyer l'écouteur global lors de la suppression du texte
    marker.addListener('remove', () => {
      document.removeEventListener('keydown', handleTextDeleteKeydown);
    });
  }

  /**
   * Définit la sélection d'un texte
   * @param {google.maps.marker.AdvancedMarkerElement} text - Texte à sélectionner
   */
  setTextSelection(text) {
    if(!text) {
      this.selectedText = null;
      return;
    }
    // Désélectionner le texte précédent
    if (this.selectedText && this.selectedText !== text) {
      Object.assign(this.selectedText.content.style, STYLES.DEFAULT_TEXT);
    }

    // Désélectionner les autres types d'éléments
    this.drawingControl.clearSelection();
    
    this.selectedText = text;
    const div = text.content;
    Object.assign(div.style, { ...STYLES.DEFAULT_TEXT, ...STYLES.SELECTED_TEXT });
    
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.TEXT_SELECTED, {
      detail: { textId: text.textId }
    }));
  }

  /**
   * Supprime le texte sélectionné
   */
  deleteSelectedText() {
    if (this.selectedText) {
      const textId = this.selectedText.textId;
      
      // Supprimer le marqueur de la carte
      this.selectedText.map = null;
      
      // Supprimer de la liste des textes
      this.drawnTexts = this.drawnTexts.filter(text => text !== this.selectedText);
      this.usedTextIds.delete(textId);
      
      // Déclencher l'événement de suppression
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.TEXT_REMOVED, {
        detail: { textId }
      }));
      
      this.selectedText = null;
    }
  }

  /**
   * Génère un nouvel ID unique pour un texte
   * @returns {string} ID unique pour le texte
   */
  generateTextId() {
    let counter = 1;
    let textId;
    do {
      textId = `${DRAWING_CONSTANTS.TEXT_ID_PREFIX}${counter}`;
      counter++;
    } while (this.usedTextIds.has(textId));
    return textId;
  }

  /**
   * Sauvegarde les données d'un texte
   * @param {google.maps.marker.AdvancedMarkerElement} text - Texte à sauvegarder
   */
  saveTextData(text) {
    if (text._saveTimeout) {
      clearTimeout(text._saveTimeout);
    }

    text._saveTimeout = setTimeout(() => {
      window.storageManager.savePageData();
    }, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT);
  }

  /**
   * Collecte les données des textes pour la sauvegarde
   * @returns {Object} Données des textes
   */
  collectTextsData() {
    const textsData = {};
    this.drawnTexts.forEach(text => {
      if (!text.textId) return;
      
      const position = text.position;
      textsData[text.textId] = {
        content: text.content.textContent,
        position: {
          lat: typeof position.lat === 'function' ? position.lat() : position.lat,
          lng: typeof position.lng === 'function' ? position.lng() : position.lng
        }
      };
    });
    return textsData;
  }

  /**
   * Charge les textes depuis les données
   * @param {Object} textsData - Données des textes
   */
  async loadTextsFromData(textsData) {
    if (!textsData) return;
    
    for (const textId in textsData) {
      if (textsData.hasOwnProperty(textId)) {
        const textData = textsData[textId];
        const position = new google.maps.LatLng(
          textData.position.lat,
          textData.position.lng
        );
        
        const marker = await this.createText(position);
        marker.content.textContent = textData.content;
      }
    }
  }

  /**
   * Nettoie toutes les ressources lors de la suppression
   */
  onRemove() {
    // Supprimer tous les textes
    this.drawnTexts.forEach(text => {
      if (text._listeners) {
        text._listeners.forEach(listener => {
          (listener.element || document).removeEventListener(listener.type, listener.listener);
        });
      }
      text.map = null;
    });
    
    this.drawnTexts = [];
    this.usedTextIds.clear();
    this.selectedText = null;
    
    if (this.textLabels) {
      this.textLabels.forEach(label => {
        label.setMap(null);
      });
      this.textLabels.clear();
    }
  }
  clearAllTexts() {
    this.drawnTexts.forEach(text => {
      text.setMap(null);
    });
    this.drawnTexts = [];
    this.usedTextIds.clear();
  }
}

export default Text;
