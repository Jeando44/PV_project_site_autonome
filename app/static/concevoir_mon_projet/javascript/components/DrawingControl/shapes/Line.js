import { DRAWING_CONSTANTS, STYLES, CUSTOM_EVENTS } from '../constants.js';

/**
 * Classe gérant les lignes sur la carte
 */
class Line {
  /**
   * Constructeur
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   */
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.drawnLines = [];
    this.selectedLine = null;
    this.usedLineIds = new Set();
    this.lineLabels = new Map();
    this.labelsVisible = true;
  }

  /**
   * Calcule la longueur d'une ligne en mètres
   * @param {google.maps.Polyline} line - La ligne à mesurer
   * @returns {number} Longueur en mètres
   */
  calculateLineLength(line) {
    const path = line.getPath();
    let length = 0;
    
    for (let i = 0; i < path.getLength() - 1; i++) {
      const point1 = path.getAt(i);
      const point2 = path.getAt(i + 1);
      length += google.maps.geometry.spherical.computeDistanceBetween(point1, point2);
    }
    
    return length;
  }

  /**
   * Met à jour le label d'une ligne avec debounce
   * @param {google.maps.Polyline} line - La ligne dont le label doit être mis à jour
   */
  updateLineLabel(line) {
    try {
      if (!line || !line.lineId) return;
      
      // Utiliser le debounce pour éviter les mises à jour trop fréquentes
      if (line._updateTimeout) {
        clearTimeout(line._updateTimeout);
      }

      // Calculer la longueur de la ligne et si trop courte, return
      const length = this.calculateLineLength(line);
      if (length < 1){
        // Supprimer la ligne de la carte
        line.setMap(null);
        // Supprimer la ligne de la liste des lignes dessinées
        this.drawnLines = this.drawnLines.filter(l => l !== line);
        // Supprimer l'ID de la liste des IDs utilisés
        this.usedLineIds.delete(line.lineId);
        // Supprimer le label associé
        const label = this.lineLabels.get(line.lineId);
        if (label) {
          label.map = null;
          this.lineLabels.delete(line.lineId);
        }
        // Afficher l'erreur
        this.drawingControl.errorModal.show('La ligne est trop courte. Elle doit être supérieure à 1m.');
        return;
      }

      line._updateTimeout = setTimeout(() => {
        // Vérifier si la ligne est toujours sur la carte
        if (!line.getMap()) return;

        // Supprimer l'ancien label s'il existe
        const existingLabel = this.lineLabels.get(line.lineId);
        if (existingLabel) {
          existingLabel.map = null;
        }

        // Calculer le centre de la ligne pour positionner le label
        const path = line.getPath();
        const bounds = new google.maps.LatLngBounds();
        path.forEach(point => bounds.extend(point));
        const center = bounds.getCenter();

        // Créer le contenu du label
        const labelContent = document.createElement('div');
        labelContent.className = 'line-label';
        labelContent.style.cssText = STYLES.LINE_LABEL;
        const lengthText = length < 1000 ? 
        `${Math.round(length * 100) / 100}m` : 
        `${Math.round(length / 10) / 100}km`;
        labelContent.innerHTML = `${line.lineId}<br>${lengthText}`;

        // Créer le label avec AdvancedMarkerElement
        const label = new this.drawingControl.AdvancedMarkerElement({
          map: this.labelsVisible ? this.drawingControl.map : null,
          position: center,
          content: labelContent,
          collisionBehavior: 'REQUIRED_AND_HIDES_OPTIONAL'
        });

        // Stocker le label dans la Map
        this.lineLabels.set(line.lineId, label);
      }, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT);

    } catch (error) {
      console.error('Erreur lors de la mise à jour du label de ligne:', error);
    }
  }

  /**
   * Gère la création d'une nouvelle ligne
   * @param {google.maps.Polyline} line - La ligne créée
   */
  handleLineComplete(line) {
    const lineId = this.generateLineId();
    line.lineId = lineId;
    this.drawnLines.push(line);
    this.usedLineIds.add(lineId);
    
    // Configurer les écouteurs d'événements pour la ligne
    this.setupLineListeners(line);
    
    // Ajouter le label permanent
    this.updateLineLabel(line);
    // Sélectionner la ligne
    this.setLineSelection(line);
    // Déclencher l'événement de création de ligne
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.LINE_ADDED, {
      detail: { lineId }
    }));
    // Sélectionner la ligne
    this.setLineSelection(line);
    return line;
  }

  /**
   * Configure les écouteurs d'événements pour une ligne
   * @param {google.maps.Polyline} line - La ligne à configurer
   */
  setupLineListeners(line) {
    // Écouteur pour la sélection
    google.maps.event.addListener(line, 'click', () => {
      this.setLineSelection(line);
    });

    // Écouteur pour le début du déplacement
    google.maps.event.addListener(line, 'dragstart', () => {
      // Cacher temporairement le label pendant le déplacement
      const label = this.lineLabels.get(line.lineId);
      if (label) {
        label.map = null;
      }
    });

    // Écouteur pour la fin du déplacement
    google.maps.event.addListener(line, 'dragend', () => {
      this.updateLineLabel(line);
      this.saveLineData(line);
    });

    // Écouteur pour les modifications du chemin
    const pathListeners = ['insert_at', 'remove_at', 'set_at'];
    pathListeners.forEach(eventName => {
      google.maps.event.addListener(line.getPath(), eventName, () => {
        this.updateLineLabel(line);
        this.saveLineData(line);
      });
    });
    
    // Écouteur pour supprimer la ligne avec la touche Delete ou Backspace
    const handleLineDeleteKeydown = (e) => {
      const offsetModalOpen = this.drawingControl?.offsetModal?.isOpen?.();
      if (offsetModalOpen && (e.key === 'Delete' || e.key === 'Backspace')) {
        return;
      }
      if(e.key === 'Delete' || e.key === 'Backspace'){
        if(this.selectedLine){
          e.preventDefault();
          this.deleteSelectedLine();
        }
      }
    };
    // Ajouter l'écouteur pour le clic droit
    google.maps.event.addListener(line, 'rightclick', () => {
      if(this.selectedLine){
        this.deleteSelectedLine();
      }
    });
    document.addEventListener('keydown', handleLineDeleteKeydown);
    // Stocker la référence à l'écouteur pour pouvoir le supprimer plus tard
    if (!line._listeners) line._listeners = [];
    line._listeners.push({ type: 'keydown', listener: handleLineDeleteKeydown });
  }

  /**
   * Génère un nouvel ID unique pour une ligne
   * @returns {string} ID unique pour la ligne
   */
  generateLineId() {
    let counter = 1;
    let lineId;
    
    // Construction directe de l'ID avant vérification
    lineId = `${DRAWING_CONSTANTS.LINE_ID_PREFIX}${counter}`;
    
    // Tant que l'ID existe déjà, incrémenter et réessayer
    while (this.usedLineIds.has(lineId)) {
      counter++;
      lineId = `${DRAWING_CONSTANTS.LINE_ID_PREFIX}${counter}`;
    }
    
    return lineId;
  }

  setLabelsVisibility(show) {
    this.labelsVisible = show;
    this.lineLabels.forEach((label) => {
      if (label) {
        label.map = show ? this.drawingControl.map : null;
      }
    });
  }

  /**
   * Définit la ligne sélectionnée
   * @param {google.maps.Polyline} line - Ligne à sélectionner
   */
  setLineSelection(line) {
    if (this.selectedLine) {
      this.selectedLine.setOptions(STYLES.DEFAULT_LINE);
    }

    // Désélectionner les autres types d'éléments
    this.drawingControl.clearSelection();

    this.selectedLine = line;
    
    if (line) {
      line.setOptions(STYLES.SELECTED_LINE);
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.LINE_SELECTED, {
        detail: { lineId: line.lineId }
      }));
    }
  }

  /**
   * Supprime la ligne sélectionnée
   */
  deleteSelectedLine() {
    if (this.selectedLine) {
      const lineId = this.selectedLine.lineId;
      
      // Supprimer le label
      const label = this.lineLabels.get(lineId);
      if (label) {
        label.map = null;
        this.lineLabels.delete(lineId);
      }
      
      this.selectedLine.setMap(null);
      this.drawnLines = this.drawnLines.filter(line => line !== this.selectedLine);
      this.usedLineIds.delete(lineId);
      this.selectedLine = null;
      
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.LINE_REMOVED, {
        detail: { lineId }
      }));
    }
  }

  /**
   * Sauvegarde les données d'une ligne avec debounce
   * @param {google.maps.Polyline} line - Ligne à sauvegarder
   */
  saveLineData(line) {
    if (line._saveTimeout) {
      clearTimeout(line._saveTimeout);
    }

    line._saveTimeout = setTimeout(() => {
      const path = line.getPath();
      const points = [];
      for (let i = 0; i < path.getLength(); i++) {
        const point = path.getAt(i);
        points.push({
          lat: point.lat(),
          lng: point.lng()
        });
      }
      
      // Déclencher la sauvegarde via le StorageManager
      window.storageManager.savePageData();
    }, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT);
  }

  /**
   * Collecte les données de toutes les lignes
   * @returns {Object} Données des lignes
   */
  collectLinesData() {
    try {
      const linesData = {};
      
      this.drawnLines.forEach(line => {
        try {
          if (!line || !line.lineId || !line.getPath) {
            console.warn('Ligne invalide détectée:', line);
            return;
          }

          const path = line.getPath();
          if (!path) {
            console.warn(`Chemin invalide pour la ligne ${line.lineId}`);
            return;
          }

          const points = [];
          for (let i = 0; i < path.getLength(); i++) {
            const point = path.getAt(i);
            points.push({
              lat: point.lat(),
              lng: point.lng()
            });
          }

          if (points.length > 0) {
            linesData[line.lineId] = {
              points: points
            };
          }
        } catch (error) {
          console.error(`Erreur lors de la collecte des données de la ligne ${line?.lineId}:`, error);
        }
      });

      return linesData;
    } catch (error) {
      console.error('Erreur lors de la collecte des données des lignes:', error);
      return {};
    }
  }

  /**
   * Charge les lignes depuis les données sauvegardées
   * @param {Object} linesData - Données des lignes à charger
   */
  loadLinesFromData(linesData) {
    try {
      if (!linesData || typeof linesData !== 'object') {
        console.warn('Données de lignes invalides:', linesData);
        return;
      }

      // Vérifier qu'il y a des lignes à charger
      if (Object.keys(linesData).length === 0) {
        return;
      }

      Object.entries(linesData).forEach(([lineId, data]) => {
        try {
          // Lignes de cotation (même clé `lines`) : rechargées par CotationLine.
          if (data && data.cotation) return;
          if (!data.points || !Array.isArray(data.points)) {
            console.warn(`Points invalides pour la ligne ${lineId}:`, data);
            return;
          }

          // Créer la ligne avec les options par défaut
          const line = new google.maps.Polyline({
            path: data.points.map(point => new google.maps.LatLng(point.lat, point.lng)),
            ...STYLES.DEFAULT_LINE,
            map: this.drawingControl.map
          });
          
          // Assigner l'ID et configurer les écouteurs
          line.lineId = lineId;
          this.drawnLines.push(line);
          this.usedLineIds.add(lineId);
          this.setupLineListeners(line);
          
          // Ajouter le label permanent
          this.updateLineLabel(line);

        } catch (error) {
          console.error(`Erreur lors du chargement de la ligne ${lineId}:`, error);
        }
      });
    } catch (error) {
      console.error('Erreur lors du chargement des lignes:', error);
    }
  }

  /**
   * Supprime toutes les lignes de la carte
   */
  clearAllLines() {
    // Avant de supprimer les lignes, enregistrer leurs IDs
    const lineIds = this.drawnLines.map(line => line.lineId);
    
    this.drawnLines.forEach(line => {
      line.setMap(null);
      // Supprimer les labels associés
      const label = this.lineLabels.get(line.lineId);
      if (label) {
        label.map = null;
      }
    });
    
    // Déclencher les événements de suppression pour chaque ligne
    lineIds.forEach(lineId => {
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.LINE_REMOVED, {
        detail: { lineId }
      }));
    });
    
    this.drawnLines = [];
    this.usedLineIds.clear();
    this.selectedLine = null;
    this.lineLabels.clear();
  }

  /**
   * Nettoie toutes les ressources lors de la suppression
   */
  onRemove() {
    // Nettoyer les labels de lignes
    this.lineLabels.forEach(label => {
      label.map = null;
    });
    this.lineLabels.clear();
    
    // Supprimer toutes les lignes
    this.clearAllLines();
  }
}

export default Line;
