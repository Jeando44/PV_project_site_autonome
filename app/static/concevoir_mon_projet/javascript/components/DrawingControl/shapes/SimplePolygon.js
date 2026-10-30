import { DRAWING_CONSTANTS, STYLES, CUSTOM_EVENTS } from '../constants.js';
import GeometryUtils from '../utils/GeometryUtils.js';
import ErrorModal from '../../ErrorModal.js';

/**
 * Classe gérant les polygones simples sur la carte
 */
class SimplePolygon {
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.drawnSimplePolygons = [];
    this.selectedSimplePolygon = null;
    this.usedSimplePolygonIds = new Set();
    this.simplePolygonLabels = new Map();
    this.labelsVisible = true;
    this.errorModal = new ErrorModal();
  }

  /**
   * Calcule la surface d'un polygone simple
   * @param {google.maps.Polygon} simplePolygon - Le polygone à calculer
   * @returns {number} La surface du polygone en mètres carrés
   */
  calculateSimplePolygonArea(simplePolygon) {
    try {
      // Obtenir le chemin du polygone
      const path = simplePolygon.getPath().getArray();
      if (!path || path.length < 3) return 0;
      
      // Utiliser GeometryUtils pour calculer la surface
      return GeometryUtils.calculateArea(path);
    } catch (error) {
      console.error("Erreur lors du calcul de l'aire du polygone:", error);
      return 0;
    }
  }

  /**
   * Met à jour le label d'un polygone simple avec debounce
   * @param {google.maps.Polygon} simplePolygon - Le polygone à mettre à jour
   */
  updateSimplePolygonLabel(simplePolygon) {
    try {
      if (!simplePolygon || !simplePolygon.simplePolygonId) return;

      // Utiliser le debounce pour éviter les mises à jour trop fréquentes
      if (simplePolygon._updateTimeout) {
        clearTimeout(simplePolygon._updateTimeout);
      }

      simplePolygon._updateTimeout = setTimeout(() => {
        // Vérifier si le polygone est toujours sur la carte
        if (!simplePolygon.getMap()) return;

        // Supprimer l'ancien label s'il existe
        const existingLabel = this.simplePolygonLabels.get(simplePolygon.simplePolygonId);
        if (existingLabel) {
          existingLabel.map = null;
        }

        const area = this.calculateSimplePolygonArea(simplePolygon);
        // Calculer le centre du polygone
        const path = simplePolygon.getPath().getArray();
        const center = GeometryUtils.calculateCenter(path);
        
        if(area < 1){
          simplePolygon.setMap(null);
          this.drawnSimplePolygons = this.drawnSimplePolygons.filter(p => p !== simplePolygon);
          this.usedSimplePolygonIds.delete(simplePolygon.simplePolygonId);
          this.simplePolygonLabels.delete(simplePolygon.simplePolygonId);
          this.drawingControl.errorModal.show('La surface du polygone est trop petite. Elle doit être supérieure à 1 m².');
          return;
        }
        
        const labelContent = document.createElement('div');
        labelContent.className = 'simplePolygon-label';
        labelContent.style.cssText = STYLES.SIMPLE_POLYGON_LABEL;
        
        // --- ANCIENNE LOGIQUE CONSERVÉE EN COMMENTAIRE ---
        /*
        const roundedValue = area < 1000 ? Math.round(area * 100) / 100 : Math.round(area / 10) / 100;
        const isKm = area >= 1000;
        const areaText = `${roundedValue}${isKm ? 'km²' : 'm²'}`;
        
        // NOUVEAU: Stocker la surface affichée (convertie en m²) en mémoire pour le Calculateur APER
        simplePolygon.aperDisplayedArea = isKm ? roundedValue * 1000 : roundedValue;
        */

        // --- NOUVELLE LOGIQUE : 100% m² et 2 décimales strictes ---
        // On force l'affichage en m² peu importe la taille de la surface calculée.
        const areaText = area.toFixed(2) + ' m²';
        
        // Mise à jour pour le Calculateur APER avec la valeur exacte (et strictement la même que celle affichée)
        simplePolygon.aperDisplayedArea = parseFloat(area.toFixed(2));
        
        labelContent.innerHTML = `${simplePolygon.simplePolygonId}<br>Surface: ${areaText}`;

        // Mettre à jour le label
        const label = new this.drawingControl.AdvancedMarkerElement({
          map: this.labelsVisible ? this.drawingControl.map : null,
          position: center,
          content: labelContent,
          collisionBehavior: 'REQUIRED_AND_HIDES_OPTIONAL'
        });
        this.simplePolygonLabels.set(simplePolygon.simplePolygonId, label);
      }, 100);
    } catch (error) {
      console.error('Erreur lors de la mise à jour du label du polygone:', error);
    }
  }

  /**
   * Gère la création d'un nouveau polygone simple
   * @param {google.maps.Polygon} simplePolygon - Le polygone créé
   * @returns {google.maps.Polygon} Le polygone créé avec ses propriétés configurées
   */
  handleSimplePolygonComplete(simplePolygon) {
    console.log("[SimplePolygon] handleSimplePolygonComplete exécuté.");
    const simplePolygonId = this.generateSimplePolygonId();
    simplePolygon.simplePolygonId = simplePolygonId;
    
    // Configurer le style et les options du polygone
    simplePolygon.setOptions({
      editable: true,
      ...STYLES.DEFAULT_SIMPLE_POLYGON
    });
    
    this.drawnSimplePolygons.push(simplePolygon);
    this.usedSimplePolygonIds.add(simplePolygonId);

    // Configurer les écouteurs d'événements pour le polygone
    this.setupSimplePolygonListeners(simplePolygon);

    // Ajouter le label permanent
    this.updateSimplePolygonLabel(simplePolygon);

    // Déclencher l'événement de création de polygone
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SIMPLE_POLYGON_ADDED, {
      detail: { simplePolygonId }
    }));
    // Sélectionner le polygone
    this.setSimplePolygonSelection(simplePolygon);
    
    return simplePolygon;
  }

  /**
   * Configure les écouteurs d'événements pour un polygone simple
   * @param {google.maps.Polygon} simplePolygon - Le polygone à configurer
   */
  setupSimplePolygonListeners(simplePolygon) {
    // Écouteur pour la sélection
    google.maps.event.addListener(simplePolygon, 'click', () => {
      this.setSimplePolygonSelection(simplePolygon);
    });

    // Écouteur pour le début du déplacement
    google.maps.event.addListener(simplePolygon, 'dragstart', () => {
      // Cacher temporairement le label pendant le déplacement
      const label = this.simplePolygonLabels.get(simplePolygon.simplePolygonId);
      if (label) {
        label.map = null;
      }
    });

    // Écouteur pour la fin du déplacement
    google.maps.event.addListener(simplePolygon, 'dragend', () => {
      this.updateSimplePolygonLabel(simplePolygon);
      this.saveSimplePolygonData(simplePolygon);
    });

    // Écouteur pour le changement de forme, le getPath() est important pour bien sélectionner l'événement dans une polygon!!!
    google.maps.event.addListener(simplePolygon.getPath(), 'set_at', () => {
      this.updateSimplePolygonLabel(simplePolygon);
      this.saveSimplePolygonData(simplePolygon);
    });



    // Écouteur pour supprimer le polygone avec la touche Delete ou Backspace
    const handleSimplePolygonDeleteKeydown = (e) => {
      const offsetModalOpen = this.drawingControl?.offsetModal?.isOpen?.();
      if (offsetModalOpen && (e.key === 'Delete' || e.key === 'Backspace')) {
        return;
      }
      if(e.key === 'Delete' || e.key === 'Backspace') {
        if(this.selectedSimplePolygon === simplePolygon) {
          e.preventDefault();
          this.deleteSelectedSimplePolygon();
        }
      }
    };

    // Ajouter l'écouteur pour le clic droit
    google.maps.event.addListener(simplePolygon, 'rightclick', () => {
      if(this.selectedSimplePolygon === simplePolygon) {
        this.deleteSelectedSimplePolygon();
      }
    });

    document.addEventListener('keydown', handleSimplePolygonDeleteKeydown);

    // Stocker la référence à l'écouteur pour pouvoir le supprimer plus tard
    if (!simplePolygon._listeners) simplePolygon._listeners = [];
    simplePolygon._listeners.push({ type: 'keydown', listener: handleSimplePolygonDeleteKeydown });
  }

  /**
   * Définit le polygone sélectionné
   * @param {google.maps.Polygon} simplePolygon - Le polygone sélectionné
   */
  setSimplePolygonSelection(simplePolygon) {
    // Réinitialiser le polygone précédemment sélectionné
    if (this.selectedSimplePolygon) {
      this.selectedSimplePolygon.setOptions(STYLES.DEFAULT_SIMPLE_POLYGON);
    }
    
    // Désélectionner les autres types d'éléments via le drawingControl
    this.drawingControl.clearSelection();

    this.selectedSimplePolygon = simplePolygon;
    
    if (simplePolygon) {
      simplePolygon.setOptions(STYLES.SELECTED_SIMPLE_POLYGON);
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SIMPLE_POLYGON_SELECTED, {
        detail: { simplePolygonId: simplePolygon.simplePolygonId }
      }));
    }
  }

  /**
   * Génère un nouvel ID unique pour un polygone
   * @returns {string} L'ID unique du polygone
   */
  generateSimplePolygonId() {
    let counter = 1;
    let simplePolygonId;
    do {
      simplePolygonId = `${DRAWING_CONSTANTS.SIMPLE_POLYGON_ID_PREFIX}${counter}`;
      counter++;
    } while (this.usedSimplePolygonIds.has(simplePolygonId));
    return simplePolygonId;
  }

  /**
   * Supprime le polygone sélectionné
   */
  deleteSelectedSimplePolygon() {
    if(this.selectedSimplePolygon) {
      const simplePolygonId = this.selectedSimplePolygon.simplePolygonId;
      
      // Supprimer le label
      const label = this.simplePolygonLabels.get(simplePolygonId);
      if (label) {
        label.map = null;
        this.simplePolygonLabels.delete(simplePolygonId);
      }
      
      // Supprimer les écouteurs d'événements
      if (this.selectedSimplePolygon._listeners) {
        this.selectedSimplePolygon._listeners.forEach(({ type, listener }) => {
          document.removeEventListener(type, listener);
        });
      }
      
      this.selectedSimplePolygon.setMap(null);
      this.drawnSimplePolygons = this.drawnSimplePolygons.filter(p => p !== this.selectedSimplePolygon);
      this.usedSimplePolygonIds.delete(simplePolygonId);
      this.selectedSimplePolygon = null;
      
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SIMPLE_POLYGON_REMOVED, {
        detail: { simplePolygonId }
      }));
    }
  }

  /**
   * Sauvegarde les données d'un polygone avec debounce 
   * @param {google.maps.Polygon} simplePolygon - Polygone à sauvegarder
   */
  saveSimplePolygonData(simplePolygon) {
    if(simplePolygon._saveTimeout) {
      clearTimeout(simplePolygon._saveTimeout);
    }

    simplePolygon._saveTimeout = setTimeout(() => {
      // Déclencher la sauvegarde via le StorageManager
      window.storageManager.savePageData();
    }, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT);
  }

  /**
   * Collecte les données de tous les polygones simples
   * @returns {Object} Les données collectées
   */
  collectSimplePolygonsData() {
    try {
      const simplePolygonsData = {};    
      
      this.drawnSimplePolygons.forEach(simplePolygon => {
        try {
          if(!simplePolygon || !simplePolygon.simplePolygonId) {
            console.warn('Polygone invalide détecté:', simplePolygon);
            return;
          }
          
          const path = simplePolygon.getPath().getArray();
          const area = this.calculateSimplePolygonArea(simplePolygon);
          
          // Stocker les coordonnées des sommets
          const vertices = path.map(point => ({
            lat: point.lat(),
            lng: point.lng()
          }));

          simplePolygonsData[simplePolygon.simplePolygonId] = {
            vertices: vertices,
            area: area
          };
        } catch (error) {
          console.error(`Erreur lors de la collecte des données du polygone ${simplePolygon?.simplePolygonId}:`, error);
        }
      });
      return simplePolygonsData;
    } catch (error) {
      console.error('Erreur lors de la collecte des données des polygones:', error);
      return {};
    }
  }

  /**
   * Charge les polygones depuis les données sauvegardées
   * @param {Object} simplePolygonsData - Les données des polygones à charger
   */
  loadSimplePolygonsFromData(simplePolygonsData) {
    try {
      if (!simplePolygonsData || typeof simplePolygonsData !== 'object') {
        console.warn('Données de polygones invalides:', simplePolygonsData);
        return;
      }

      Object.entries(simplePolygonsData).forEach(([simplePolygonId, data]) => {
        try {
          if (!data.vertices || !Array.isArray(data.vertices) || data.vertices.length < 3) {
            console.warn(`Données invalides pour le polygone ${simplePolygonId}:`, data);
            return;
          }

          // Créer le chemin du polygone à partir des sommets sauvegardés
          const path = data.vertices.map(vertex => 
            new google.maps.LatLng(vertex.lat, vertex.lng)
          );
          
          // Créer le polygone
          const simplePolygon = new google.maps.Polygon({
            paths: path,
            ...STYLES.DEFAULT_SIMPLE_POLYGON,
            map: this.drawingControl.map
          });

          // Assigner l'ID et configurer les écouteurs
          simplePolygon.simplePolygonId = simplePolygonId;
          this.drawnSimplePolygons.push(simplePolygon);
          this.usedSimplePolygonIds.add(simplePolygonId);
          this.setupSimplePolygonListeners(simplePolygon);
          
          // Ajouter le label permanent
          this.updateSimplePolygonLabel(simplePolygon);
        } catch (error) {
          console.error(`Erreur lors du chargement du polygone ${simplePolygonId}:`, error);
        }
      });
    } catch (error) {
      console.error('Erreur lors du chargement des polygones:', error);
    }
  }

  /**
   * Supprime tous les polygones de la carte
   */
  clearAllSimplePolygons() {
    this.drawnSimplePolygons.forEach(simplePolygon => {
      // Supprimer les labels
      const label = this.simplePolygonLabels.get(simplePolygon.simplePolygonId);
      if (label) {
        label.map = null;
      }
      
      // Supprimer les écouteurs d'événements
      if (simplePolygon._listeners) {
        simplePolygon._listeners.forEach(({ type, listener }) => {
          document.removeEventListener(type, listener);
        });
      }
      
      simplePolygon.setMap(null);
    });
    
    this.drawnSimplePolygons = [];
    this.usedSimplePolygonIds.clear();
    this.simplePolygonLabels.clear();
    this.selectedSimplePolygon = null;
  }

  setLabelsVisibility(show) {
    this.labelsVisible = show;
    this.simplePolygonLabels.forEach((label) => {
      if (label) {
        label.map = show ? this.drawingControl.map : null;
      }
    });
  }

  /**
   * Nettoie toutes les ressources lors de la suppression
   */
  onRemove() {
    this.clearAllSimplePolygons();
  }
}

export default SimplePolygon; 