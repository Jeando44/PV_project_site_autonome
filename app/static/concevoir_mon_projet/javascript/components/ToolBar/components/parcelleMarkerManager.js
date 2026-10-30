import { CUSTOM_EVENTS, STYLES } from "../../DrawingControl/constants.js";

/**
 * ParcelleMarkerManager
 * Gestionnaire des marqueurs de parcelles manuels
 * 
 * Permet à l'utilisateur d'ajouter des marqueurs sur la carte pour identifier
 * des parcelles cadastrales supplémentaires indépendamment des zones dessinées.
 */
class ParcelleMarkerManager {
  constructor(options) {
    this.map = options.map;
    this.errorModal = options.errorModal;
    this.AdvancedMarkerElement = options.getAdvancedMarkerElement;
    
    // État du manager
    this.isActive = false;
    this.markers = new Map(); // Map<id, marker>
    this.nextMarkerNumber = 1;
    this.mapClickListener = null;
    this.keydownListener = null;
    this.markersVisible = true; // État de visibilité des marqueurs
    
    // Charger les marqueurs existants depuis localStorage
    this._loadMarkersFromStorage();
    
    // Écouter les événements de dessin pour désactiver automatiquement le mode parcelle
    this._setupDrawingModeListeners();
  }

  /**
   * Active ou désactive le mode ajout de marqueur
   * @returns {boolean} Nouvel état du mode
   */
  toggleMode() {
    // Si on active le mode parcelle, désactiver tous les modes de dessin
    if (!this.isActive) {
      this._deactivateAllDrawingModes();
    }
    
    this.isActive = !this.isActive;
    
    if (this.isActive) {
      this._activateMode();
    } else {
      this._deactivateMode();
    }
    
    return this.isActive;
  }

  /**
   * Active le mode ajout de marqueur
   * @private
   */
  _activateMode() {
    // Changer le curseur de la carte
    this.map.setOptions({ draggableCursor: 'crosshair' });
    
    // Ajouter l'écouteur de clic sur la carte
    this.mapClickListener = this.map.addListener('click', (event) => {
      this._handleMapClick(event.latLng);
    });
    
    // Ajouter l'écouteur de la touche Échap
    this.keydownListener = (event) => {
      if (event.key === 'Escape') {
        this.toggleMode();
      }
    };
    document.addEventListener('keydown', this.keydownListener);
    
    // Émettre l'événement d'activation
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.PARCELLE_MARKER_MODE_ACTIVATED));
  }

  /**
   * Désactive le mode ajout de marqueur
   * @private
   */
  _deactivateMode() {
    // Restaurer le curseur par défaut
    this.map.setOptions({ draggableCursor: null });
    
    // Retirer les écouteurs
    if (this.mapClickListener) {
      google.maps.event.removeListener(this.mapClickListener);
      this.mapClickListener = null;
    }
    
    if (this.keydownListener) {
      document.removeEventListener('keydown', this.keydownListener);
      this.keydownListener = null;
    }
    
    // Émettre l'événement de désactivation
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.PARCELLE_MARKER_MODE_DEACTIVATED));
  }

  /**
   * Configure les écouteurs pour désactiver le mode parcelle quand un mode de dessin est activé
   * @private
   */
  _setupDrawingModeListeners() {
    // Écouter les clics sur les boutons de dessin via un délai pour s'assurer que les boutons existent
    setTimeout(() => {
      // Écouter les clics sur tous les boutons de dessin
      document.addEventListener('click', (e) => {
        const button = e.target.closest('[id*="draw-"], [id*="button"]');
        if (!button) return;
        
        // Vérifier si c'est un bouton de dessin (mais pas le bouton parcelle)
        const isDrawingButton = button.id && (
          button.id.includes('draw-') || 
          button.id.includes('simple-rectangle') ||
          button.id.includes('simple-polygon') ||
          button.id.includes('line-to-polygon')
        );
        
        if (isDrawingButton && this.isActive) {
          // Un bouton de dessin a été cliqué et le mode parcelle est actif
          // Désactiver le mode parcelle
          this.toggleMode();
        }
      }, true); // Utiliser capture pour intercepter avant les autres handlers
    }, 1000);
  }

  /**
   * Désactive tous les modes de dessin actifs
   * @private
   */
  _deactivateAllDrawingModes() {
    if (!window.drawingControl) return;
    
    const drawingControl = window.drawingControl;
    
    // Désactiver le DrawingManager
    if (drawingControl.drawingManager) {
      drawingControl.drawingManager.setDrawingMode(null);
    }
    
    // Désactiver les modes spéciaux
    if (drawingControl.simpleRectangleMode && drawingControl.simpleRectangleButton) {
      drawingControl.toggleSimpleRectangleMode(drawingControl.simpleRectangleButton);
    }
    
    if (drawingControl.simplePolygonMode && drawingControl.simplePolygonButton) {
      drawingControl.toggleSimplePolygonMode(drawingControl.simplePolygonButton);
    }
    
    if (drawingControl.lineToPolygon?.isActive && drawingControl.lineToPolygonButton) {
      drawingControl.lineToPolygon.toggleMode(drawingControl.lineToPolygonButton);
    }
    
    // Désactiver le mode paste
    if (drawingControl.isPasteMode) {
      drawingControl.isPasteMode = false;
      drawingControl.map.setOptions({ draggableCursor: null });
      if (drawingControl.copyButton) {
        drawingControl.copyButton.classList.remove("selected");
        const STYLES = drawingControl.STYLES || {};
        drawingControl.copyButton.style.backgroundColor = 
          STYLES.DEFAULT_BUTTON?.backgroundColor || '#fff';
      }
    }
    
    // Réinitialiser le bouton actif et le curseur
    if (drawingControl.activeButton) {
      drawingControl.activeButton.classList.remove("selected");
      const STYLES = drawingControl.STYLES || {};
      drawingControl.activeButton.style.backgroundColor = 
        STYLES.DEFAULT_BUTTON?.backgroundColor || '#fff';
      drawingControl.activeButton = null;
    }
    
    drawingControl.map.setOptions({ draggableCursor: null });
  }

  /**
   * Gère le clic sur la carte pour créer un marqueur
   * @param {google.maps.LatLng} latLng - Position du clic
   * @private
   */
  async _handleMapClick(latLng) {
    try {
       // Vérifier si un mode de dessin est actif avant de créer un marqueur
    // Cela évite la création accidentelle de marqueurs lors du dessin de formes
    if (this._isDrawingModeActive()) {
      return; // Ignorer le clic si un mode de dessin est actif
    }
      const lat = latLng.lat();
      const lng = latLng.lng();
      
      // Vérifier si le point est dans une zone existante
      if (this._isInExistingShape(lat, lng)) {
        if (this.errorModal) {
          this.errorModal.show(
            "⚠️ Attention : Ce point se trouve dans une zone déjà dessinée. " +
            "Le marqueur de parcelle sera créé mais pourrait être redondant."
          );
        }
      }
      
      // Récupérer les données cadastrales
      const cadastreData = await this._fetchCadastreData(lat, lng);
      
      if (!cadastreData || !cadastreData.numero) {
        if (this.errorModal) {
          this.errorModal.show(
            "❌ Impossible de récupérer les données cadastrales pour ce point. " +
            "Veuillez cliquer sur un emplacement avec des données cadastrales disponibles."
          );
        }
        return;
      }
      
      // Vérifier si la parcelle existe déjà dans le tableau
      if (this._isDuplicateParcelle(cadastreData)) {
        if (this.errorModal) {
          this.errorModal.show(
            `❌ La parcelle ${cadastreData.section} ${cadastreData.numero} est déjà présente dans le tableau.`
          );
        }
        return;
      }
      
      // Créer le marqueur
      await this._createMarker(lat, lng, cadastreData);
      
    } catch (error) {
      console.error("Erreur lors de la création du marqueur de parcelle:", error);
      if (this.errorModal) {
        this.errorModal.show("Une erreur est survenue lors de la création du marqueur de parcelle.");
      }
    }
  }

  /**
   * Vérifie si un mode de dessin est actif
   * @returns {boolean} True si un mode de dessin est actif
   * @private
   */
  _isDrawingModeActive() {
    // Vérifier si window.drawingControl existe
    if (!window.drawingControl || !window.drawingControl.drawingManager) {
      return false;
    }
    
    const drawingControl = window.drawingControl;
    
    // Vérifier si le DrawingManager a un mode de dessin actif
    const drawingMode = drawingControl.drawingManager.getDrawingMode();
    if (drawingMode !== null) {
      return true; // Un mode de dessin est actif
    }
    
    // Vérifier les autres modes actifs qui n'utilisent pas directement le DrawingManager
    if (drawingControl.isPasteMode || 
        drawingControl.simpleRectangleMode || 
        drawingControl.simplePolygonMode ||
        (drawingControl.lineToPolygon && drawingControl.lineToPolygon.isActive)) {
      return true;
    }
    
    return false;
  }

  /**
   * Vérifie si une parcelle avec les mêmes données cadastrales existe déjà
   * @param {Object} cadastreData - Données cadastrales à vérifier
   * @returns {boolean} True si la parcelle existe déjà
   * @private
   */
  _isDuplicateParcelle(cadastreData) {
    try {
      const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
      const section = cadastreData.section;
      const numero = cadastreData.numero;
      
      // Vérifier dans les shapes existantes
      if (savedData.shapes) {
        for (const [shapeId, shapeData] of Object.entries(savedData.shapes)) {
          if (shapeData.parcelleData) {
            const { section: shapeSection, numero: shapeNumero } = shapeData.parcelleData;
            if (shapeSection === section && shapeNumero === numero) {
              return true;
            }
          }
        }
      }
      
      // Vérifier dans les marqueurs de parcelles manuelles existants
      if (savedData.manualParcelles) {
        for (const [markerId, markerData] of Object.entries(savedData.manualParcelles)) {
          if (markerData.cadastreData) {
            const { section: markerSection, numero: markerNumero } = markerData.cadastreData;
            if (markerSection === section && markerNumero === numero) {
              return true;
            }
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error("Erreur lors de la vérification des doublons de parcelles:", error);
      return false;
    }
  }

  /**
   * Vérifie si un point est dans une zone existante
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {boolean} True si le point est dans une zone existante
   * @private
   */
  _isInExistingShape(lat, lng) {
    try {
      const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
      if (!savedData.shapes) return false;
      
      // Vérifier chaque shape
      for (const [shapeId, shapeData] of Object.entries(savedData.shapes)) {
        if (shapeData.coordinates && Array.isArray(shapeData.coordinates)) {
          // Utiliser l'algorithme ray-casting pour point-dans-polygon
          if (this._isPointInPolygon(lat, lng, shapeData.coordinates)) {
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      console.error("Erreur lors de la vérification de la zone:", error);
      return false;
    }
  }

  /**
   * Algorithme ray-casting pour déterminer si un point est dans un polygone
   * @param {number} lat - Latitude du point
   * @param {number} lng - Longitude du point
   * @param {Array} polygon - Tableau de coordonnées du polygone [{lat, lng}, ...]
   * @returns {boolean} True si le point est dans le polygone
   * @private
   */
  _isPointInPolygon(lat, lng, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng;
      const yi = polygon[i].lat;
      const xj = polygon[j].lng;
      const yj = polygon[j].lat;

      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Récupère les données cadastrales pour une position
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @returns {Promise<Object|null>} Données cadastrales ou null
   * @private
   */
  async _fetchCadastreData(lat, lng) {
    try {
      const response = await fetch(`/concevoir_mon_projet/api/cadastre-geoportail?lat=${lat}&lng=${lng}`);
      if (!response.ok) {
        throw new Error(`Erreur API: ${response.status}`);
      }
      const data = await response.json();
      return data && data.numero ? data : null;
    } catch (error) {
      console.error("Erreur lors de la récupération des données cadastrales:", error);
      return null;
    }
  }

  /**
   * Crée un marqueur de parcelle
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {Object} cadastreData - Données cadastrales
   * @private
   */
  async _createMarker(lat, lng, cadastreData) {
    const markerId = `parcelle-${this.nextMarkerNumber}`;
    const markerNumber = this.nextMarkerNumber;
    this.nextMarkerNumber++;
    
    // Créer le nom de parcelle pour le label (ex: "AS 188")
    const parcelleName = cadastreData ? `${cadastreData.section} ${cadastreData.numero}` : `Parcelle ${markerNumber}`;
    
    // Créer le conteneur pour le marqueur et le label
    const markerContainer = document.createElement('div');
    markerContainer.style.cssText = `
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
    `;
    
    // Créer le marqueur standard Google Maps (pin bleu)
    const pinElement = document.createElement('div');
    pinElement.innerHTML = `
      <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0C8.925 0 4 4.925 4 11c0 8.25 11 24 11 24s11-15.75 11-24c0-6.075-4.925-11-11-11z" 
              fill="#2196F3" stroke="#1565C0" stroke-width="1"/>
        <circle cx="15" cy="11" r="4" fill="white"/>
      </svg>
    `;
    pinElement.style.cssText = `
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
      cursor: pointer;
    `;
    
    // Créer le label
    const labelDiv = document.createElement('div');
    labelDiv.style.cssText = STYLES.PARCELLE_MARKER_LABEL;
    labelDiv.textContent = parcelleName;
    labelDiv.style.marginTop = '-5px';
    
    // Assembler le conteneur
    markerContainer.appendChild(pinElement);
    markerContainer.appendChild(labelDiv);
    
    // Créer le marqueur avec AdvancedMarkerElement
    const AdvancedMarkerElementClass = this.AdvancedMarkerElement();
    if (!AdvancedMarkerElementClass) {
      console.error("AdvancedMarkerElement n'est pas encore chargé");
      return;
    }
    
    const marker = new AdvancedMarkerElementClass({
      map: this.markersVisible ? this.map : null,
      position: { lat, lng },
      content: markerContainer,
      title: parcelleName,
    });
    
    // Ajouter un écouteur de clic pour supprimer le marqueur
    marker.addListener('click', () => {
      this._removeMarker(markerId);
    });
    
    // Stocker le marqueur
    const markerData = {
      id: markerId,
      number: markerNumber,
      position: { lat, lng },
      cadastreData: cadastreData,
      marker: marker,
      createdAt: new Date().toISOString()
    };
    
    this.markers.set(markerId, markerData);
    
    // Sauvegarder dans localStorage
    this._saveToStorage();
    
    // Émettre l'événement
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.PARCELLE_MARKER_ADDED, {
      detail: {
        markerId,
        markerNumber,
        position: { lat, lng },
        cadastreData
      }
    }));
  }

  /**
   * Supprime un marqueur de parcelle
   * @param {string} markerId - ID du marqueur à supprimer
   * @private
   */
  _removeMarker(markerId) {
    const markerData = this.markers.get(markerId);
    if (!markerData) return;
    
    // Retirer le marqueur de la carte
    markerData.marker.map = null;
    
    // Retirer de la Map
    this.markers.delete(markerId);
    
    // Sauvegarder dans localStorage
    this._saveToStorage();
    
    // Émettre l'événement
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.PARCELLE_MARKER_REMOVED, {
      detail: { markerId }
    }));
  }

  /**
   * Sauvegarde les marqueurs dans localStorage
   * @private
   */
  _saveToStorage() {
    try {
      const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
      
      // Convertir la Map en objet simple (sans la référence marker)
      const markersToSave = {};
      this.markers.forEach((markerData, markerId) => {
        markersToSave[markerId] = {
          id: markerData.id,
          number: markerData.number,
          position: markerData.position,
          cadastreData: markerData.cadastreData,
          createdAt: markerData.createdAt
        };
      });
      
      savedData.manualParcelles = markersToSave;
      
      // Mettre à jour nextMarkerNumber
      savedData.nextParcelleMarkerNumber = this.nextMarkerNumber;
      
      // Sauvegarder l'état de visibilité
      savedData.parcelleMarkersVisible = this.markersVisible;
      
      localStorage.setItem("solarProjectData", JSON.stringify(savedData));
    } catch (error) {
      console.error("Erreur lors de la sauvegarde des marqueurs de parcelles:", error);
    }
  }

  /**
   * Charge les marqueurs depuis localStorage
   * @private
   */
  async _loadMarkersFromStorage() {
    try {
      const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
      
      if (!savedData.manualParcelles) return;
      
      // Restaurer nextMarkerNumber
      if (savedData.nextParcelleMarkerNumber) {
        this.nextMarkerNumber = savedData.nextParcelleMarkerNumber;
      }
      
      // Restaurer l'état de visibilité (par défaut true si non défini)
      if (typeof savedData.parcelleMarkersVisible === 'boolean') {
        this.markersVisible = savedData.parcelleMarkersVisible;
      }
      
      // Attendre que AdvancedMarkerElement soit chargé
      const waitForMarkerElement = () => {
        return new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (this.AdvancedMarkerElement()) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        });
      };
      
      await waitForMarkerElement();
      
      // Recréer les marqueurs
      for (const [markerId, markerData] of Object.entries(savedData.manualParcelles)) {
        await this._recreateMarker(markerData);
      }
      
    } catch (error) {
      console.error("Erreur lors du chargement des marqueurs de parcelles:", error);
    }
  }

  /**
   * Recrée un marqueur depuis les données sauvegardées
   * @param {Object} markerData - Données du marqueur
   * @private
   */
  async _recreateMarker(markerData) {
    try {
      // Créer le nom de parcelle pour le label (ex: "AS 188")
      const cadastreData = markerData.cadastreData;
      const parcelleName = cadastreData ? `${cadastreData.section} ${cadastreData.numero}` : `Parcelle ${markerData.number}`;
      
      // Créer le conteneur pour le marqueur et le label
      const markerContainer = document.createElement('div');
      markerContainer.style.cssText = `
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
      `;
      
      // Créer le marqueur standard Google Maps (pin bleu)
      const pinElement = document.createElement('div');
      pinElement.innerHTML = `
        <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 0C8.925 0 4 4.925 4 11c0 8.25 11 24 11 24s11-15.75 11-24c0-6.075-4.925-11-11-11z" 
                fill="#2196F3" stroke="#1565C0" stroke-width="1"/>
          <circle cx="15" cy="11" r="4" fill="white"/>
        </svg>
      `;
      pinElement.style.cssText = `
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        cursor: pointer;
      `;
      
      // Créer le label
      const labelDiv = document.createElement('div');
      labelDiv.style.cssText = STYLES.PARCELLE_MARKER_LABEL;
      labelDiv.textContent = parcelleName;
      labelDiv.style.marginTop = '-5px';
      
      // Assembler le conteneur
      markerContainer.appendChild(pinElement);
      markerContainer.appendChild(labelDiv);
      
      // Créer le marqueur
      const AdvancedMarkerElementClass = this.AdvancedMarkerElement();
      if (!AdvancedMarkerElementClass) {
        console.error("AdvancedMarkerElement n'est pas encore chargé pour la recréation");
        return;
      }
      
      const marker = new AdvancedMarkerElementClass({
        map: this.markersVisible ? this.map : null,
        position: markerData.position,
        content: markerContainer,
        title: parcelleName,
      });
      
      // Ajouter l'écouteur de clic
      marker.addListener('click', () => {
        this._removeMarker(markerData.id);
      });
      
      // Stocker le marqueur
      this.markers.set(markerData.id, {
        ...markerData,
        marker: marker
      });
      
      // Émettre l'événement (pour mettre à jour l'UI)
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.PARCELLE_MARKER_ADDED, {
        detail: {
          markerId: markerData.id,
          markerNumber: markerData.number,
          position: markerData.position,
          cadastreData: markerData.cadastreData,
          isReload: true // Indicateur que c'est un rechargement
        }
      }));
      
    } catch (error) {
      console.error("Erreur lors de la recréation d'un marqueur:", error);
    }
  }

  /**
   * Nettoie toutes les ressources
   */
  cleanup() {
    // Désactiver le mode si actif
    if (this.isActive) {
      this._deactivateMode();
    }
    
    // Supprimer tous les marqueurs de la carte
    this.markers.forEach((markerData) => {
      if (markerData.marker) {
        markerData.marker.map = null;
      }
    });
    
    this.markers.clear();
  }

  /**
   * Obtient tous les marqueurs
   * @returns {Map} Map des marqueurs
   */
  getMarkers() {
    return this.markers;
  }

  /**
   * Obtient l'état actif du mode
   * @returns {boolean} True si le mode est actif
   */
  isActiveMode() {
    return this.isActive;
  }

  /**
   * Bascule la visibilité de tous les marqueurs de parcelles
   * @returns {boolean} Nouvel état de visibilité (true = visible, false = caché)
   */
  toggleMarkersVisibility() {
    this.markersVisible = !this.markersVisible;
    
    // Appliquer la visibilité à tous les marqueurs
    this.markers.forEach((markerData) => {
      if (markerData.marker) {
        markerData.marker.map = this.markersVisible ? this.map : null;
      }
    });
    
    // Sauvegarder l'état dans localStorage
    this._saveToStorage();
    
    return this.markersVisible;
  }

  /**
   * Obtient l'état de visibilité des marqueurs
   * @returns {boolean} True si les marqueurs sont visibles
   */
  areMarkersVisible() {
    return this.markersVisible;
  }
}

export default ParcelleMarkerManager;

