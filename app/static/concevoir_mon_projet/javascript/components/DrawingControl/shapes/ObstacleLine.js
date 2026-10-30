import { STYLES, DRAWING_CONSTANTS } from '../constants.js';
import GeometryUtils from '../utils/GeometryUtils.js';

class ObstacleLine {
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.drawnObstacleLines = [];
    this.selectedObstacleLine = null;
    this.usedObstacleIds = new Set();
    this.infoWindow = new google.maps.InfoWindow();

    // Propriétés pour le mode de dessin personnalisé
    this.isActive = false;
    this.points = [];
    this.tempLine = null;
    this._clickListener = null;
    this._mouseMoveListener = null;
    this._isProcessingClick = false;
  }

  /**
   * Affiche/actualise le contour pointillé du corridor de zone tampon (ligne à 2 points décalée
   * perpendiculairement de "buffer" de chaque côté) — correspond exactement à la distance
   * point-segment utilisée par ObstaclePanelsManager pour le masquage des panneaux.
   * @param {google.maps.Polyline} polyline
   */
  updateBufferVisual(polyline) {
    if (polyline._bufferOverlay) {
      polyline._bufferOverlay.setMap(null);
      polyline._bufferOverlay = null;
    }
    const buffer = polyline.bufferDistance || 0;
    const path = polyline.getPath();
    if (buffer <= 0 || !path || path.getLength() < 2) return;

    const corridor = GeometryUtils.bufferLineCorridor(path.getAt(0), path.getAt(1), buffer);
    if (corridor.length < 4) return;

    polyline._bufferOverlay = new google.maps.Polyline({
      path: [...corridor, corridor[0]],
      strokeOpacity: 0,
      clickable: false,
      zIndex: 14,
      icons: [{
        icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: '#D32F2F', scale: 3 },
        offset: '0',
        repeat: '10px'
      }],
      map: this.drawingControl.map
    });
  }

  /**
   * Active le mode de dessin personnalisé pour les obstacles lignes (limité à 2 points)
   */
  startCustomDrawing() {
    const dc = this.drawingControl;
    
    // Vérifier si le niveau de zoom est suffisant
    if (dc.map && dc.map.getZoom() < DRAWING_CONSTANTS.MIN_ZOOM_LEVEL) {
      dc.errorModal.show(
        `Zoom minimum requis: ${DRAWING_CONSTANTS.MIN_ZOOM_LEVEL}`
      );
      return;
    }
    
    this.isActive = true;
    this.points = [];
    
    // Désactiver le DrawingManager
    dc.drawingManager.setDrawingMode(null);
    
    // Nettoyer les écouteurs précédents
    if (this._clickListener) {
      google.maps.event.removeListener(this._clickListener);
      this._clickListener = null;
    }
    
    if (this._mouseMoveListener) {
      google.maps.event.removeListener(this._mouseMoveListener);
      this._mouseMoveListener = null;
    }
    
    // Ajouter l'écouteur de clic
    this._clickListener = google.maps.event.addListener(
      dc.map,
      "mousedown",
      (e) => {
        if (this.isActive) {
          setTimeout(() => {
            this.handleClick(e.latLng);
          }, 50);
        }
      }
    );
    
    // Appliquer le curseur en croix
    dc.map.setOptions({ draggableCursor: "crosshair" });
  }
  
  /**
   * Désactive le mode de dessin personnalisé
   */
  stopCustomDrawing() {
    this.isActive = false;
    this.clearTemp();
    
    if (this._clickListener) {
      google.maps.event.removeListener(this._clickListener);
      this._clickListener = null;
    }
    
    if (this._mouseMoveListener) {
      google.maps.event.removeListener(this._mouseMoveListener);
      this._mouseMoveListener = null;
    }
    
    if (this.drawingControl.map) {
      this.drawingControl.map.setOptions({ draggableCursor: null });
    }
  }
  
  /**
   * Nettoie les éléments temporaires
   */
  clearTemp() {
    if (this.tempLine) {
      this.tempLine.setMap(null);
      this.tempLine = null;
    }
    this.points = [];
  }
  
  /**
   * Gère les clics sur la carte pour le dessin d'obstacle ligne (2 points max)
   * @param {google.maps.LatLng} latLng - Position du clic
   */
  handleClick(latLng) {
    const dc = this.drawingControl;
    
    // Vérifier si le niveau de zoom est suffisant
    if (dc.map && dc.map.getZoom() < DRAWING_CONSTANTS.MIN_ZOOM_LEVEL) {
      dc.errorModal.show(
        `Zoom minimum requis: ${DRAWING_CONSTANTS.MIN_ZOOM_LEVEL}`
      );
      return;
    }
    
    // Ajouter un verrouillage pour éviter les clics multiples
    if (this._isProcessingClick) {
      return;
    }
    
    // Activer le verrouillage
    this._isProcessingClick = true;
    
    try {
      if (this.points.length === 0) {
        this.handleFirstClick(latLng);
      } else if (this.points.length === 1) {
        this.handleSecondClick(latLng);
      }
    } catch (error) {
      console.error("Erreur lors de la création d'obstacle ligne:", error);
      this.clearTemp();
      this.stopCustomDrawing();
    } finally {
      // Toujours désactiver le verrouillage à la fin
      this._isProcessingClick = false;
    }
  }
  
  /**
   * Gère le premier clic - création de la ligne temporaire
   * @param {google.maps.LatLng} latLng - Position du premier clic
   */
  handleFirstClick(latLng) {
    const dc = this.drawingControl;
    
    // Stocker le premier point
    this.points.push(latLng);
    
    // Créer une ligne temporaire
    this.tempLine = new google.maps.Polyline({
      path: [latLng, latLng], // Deux points identiques au début
      strokeColor: STYLES.OBSTACLE_LINE.strokeColor,
      strokeWeight: STYLES.OBSTACLE_LINE.strokeWeight,
      strokeOpacity: STYLES.OBSTACLE_LINE.strokeOpacity || 0.8,
      map: dc.map,
      zIndex: 1000,
      clickable: false,
    });
    
    // Nettoyer l'écouteur de mouvement précédent s'il existe
    if (this._mouseMoveListener) {
      google.maps.event.removeListener(this._mouseMoveListener);
    }
    
    // Écouteur de mouvement pour mettre à jour le deuxième point
    this._mouseMoveListener = google.maps.event.addListener(
      dc.map,
      "mousemove",
      (e) => {
        if (this.tempLine && this.points.length === 1) {
          const path = this.tempLine.getPath();
          path.setAt(1, e.latLng);
        }
      }
    );
  }
  
  /**
   * Gère le deuxième clic - finalisation de la ligne
   * @param {google.maps.LatLng} latLng - Position du deuxième clic
   */
  handleSecondClick(latLng) {
    const dc = this.drawingControl;
    
    // Calculer la distance
    const distance = google.maps.geometry.spherical.computeDistanceBetween(
      this.points[0],
      latLng
    );
    
    // Vérifier que la distance est suffisante
    if (distance < DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION) {
      dc.errorModal.show(
        "La ligne doit être d'au moins " +
        DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION +
        " mètres."
      );
      return;
    }
    
    // Stocker le deuxième point
    this.points.push(latLng);
    
    // Fixer la ligne temporaire
    if (this.tempLine) {
      this.tempLine.setPath([this.points[0], this.points[1]]);
    }
    
    // Nettoyer les écouteurs
    if (this._mouseMoveListener) {
      google.maps.event.removeListener(this._mouseMoveListener);
      this._mouseMoveListener = null;
    }
    
    if (this._clickListener) {
      google.maps.event.removeListener(this._clickListener);
      this._clickListener = null;
    }
    
    // Créer la polyligne finale
    const polyline = new google.maps.Polyline({
      path: [this.points[0], this.points[1]],
      ...STYLES.OBSTACLE_LINE,
      draggable: false,
      editable: false,
      map: dc.map
    });
    
    // Finaliser l'obstacle ligne
    this.handleObstacleLineComplete(polyline);
    
    // Nettoyer les éléments temporaires
    this.clearTemp();
    
    // Désactiver le mode de dessin
    this.stopCustomDrawing();
    
    // Réinitialiser le mode obstacle
    dc.obstacleMode = null;
  }

  /**
   * Génère un nouvel ID unique pour un obstacle ligne
   * @returns {string} ID unique pour l'obstacle ligne
   */
  generateObstacleId() {
    let counter = 1;
    let obstacleId;
    do {
      obstacleId = `obstacle_line_${counter}`;
      counter++;
    } while (this.usedObstacleIds.has(obstacleId));
    this.usedObstacleIds.add(obstacleId);
    return obstacleId;
  }

  handleObstacleLineComplete(polyline) {
    polyline.isObstacle = true;
    polyline.obstacleId = this.generateObstacleId();
    polyline.setOptions({
      ...STYLES.OBSTACLE_LINE,
      // Drag natif désactivé : peu fiable pour Polyline sur carte vectorielle (mapId), remplacé
      // par un déplacement manuel du path (cf. GeometryUtils.attachManualPathDrag).
      draggable: false,
      editable: false
    });
    
    this.drawnObstacleLines.push(polyline);
    this.setupObstacleLineListeners(polyline);
    this.setObstacleLineSelection(polyline);
    this.updateBufferVisual(polyline);
    if (this.drawingControl.obstaclePanels) {
      this.drawingControl.obstaclePanels.requestRefresh();
    }
    return polyline;
  }

  setupObstacleLineListeners(polyline) {
    google.maps.event.addListener(polyline, 'click', () => {
      this.setObstacleLineSelection(polyline);
      
      // Interface popover pour la Zone Tampon (Buffer)
      const content = document.createElement('div');
      content.innerHTML = `
          <div style="padding: 4px; font-family: var(--font-family, sans-serif); color: #333;">
              <label style="font-size:12px; font-weight:bold;">Zone tampon (m) :</label>
              <input type="number" min="0" step="0.5" value="${polyline.bufferDistance || 0}"
                     style="width: 60px; margin-left:5px; padding:2px; border:1px solid #ccc; border-radius:3px;">
          </div>
      `;
      const input = content.querySelector('input');
      input.addEventListener('input', (ev) => {
          polyline.bufferDistance = parseFloat(ev.target.value) || 0;
          this.updateBufferVisual(polyline);
          if (this.drawingControl.obstaclePanels) {
              this.drawingControl.obstaclePanels.requestRefresh();
          }
          if (window.storageManager && typeof window.storageManager.savePageData === "function") {
              window.storageManager.savePageData();
          }
      });
      this.infoWindow.setContent(content);
      this.infoWindow.setPosition(polyline.getPath().getAt(0));
      this.infoWindow.open(this.drawingControl.map);
    });

    // Déplacement manuel (drag natif désactivé, cf. draggable:false ci-dessus) : translate le path
    // et déclenche les mêmes effets de bord que l'ancien 'drag'/'dragend' natif.
    GeometryUtils.attachManualPathDrag(polyline, this.drawingControl.map, {
      onDrag: () => {
        this.updateBufferVisual(polyline);
        if (this.drawingControl.obstaclePanels) {
          this.drawingControl.obstaclePanels.requestRefresh();
        }
      },
      onDragEnd: () => {
        this.updateBufferVisual(polyline);
        if (this.drawingControl.obstaclePanels) {
          this.drawingControl.obstaclePanels.requestRefresh();
        }
        if (window.storageManager && typeof window.storageManager.savePageData === 'function') {
          window.storageManager.savePageData();
        }
      },
    });

    // Mettre à jour les panneaux lors des modifications de la ligne
    google.maps.event.addListener(polyline.getPath(), 'set_at', () => {
      this.updateBufferVisual(polyline);
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    });

    google.maps.event.addListener(polyline.getPath(), 'insert_at', () => {
      this.updateBufferVisual(polyline);
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    });

    google.maps.event.addListener(polyline.getPath(), 'remove_at', () => {
      this.updateBufferVisual(polyline);
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    });

    google.maps.event.addListener(polyline, 'rightclick', () => {
      if (this.selectedObstacleLine === polyline) {
        this.deleteSelectedObstacleLine();
      }
    });
  }

  setObstacleLineSelection(polyline) {
    if (this.selectedObstacleLine) {
      this.selectedObstacleLine.setOptions(STYLES.OBSTACLE_LINE);
    }
    
    this.drawingControl.clearSelection();
    this.selectedObstacleLine = polyline;
    
    if (polyline) {
      polyline.setOptions(STYLES.SELECTED_OBSTACLE_LINE);
    }
  }

  deleteSelectedObstacleLine() {
    if (this.selectedObstacleLine) {
      if (this.selectedObstacleLine._bufferOverlay) {
        this.selectedObstacleLine._bufferOverlay.setMap(null);
      }
      this.selectedObstacleLine.setMap(null);
      this.drawnObstacleLines = this.drawnObstacleLines.filter(l => l !== this.selectedObstacleLine);
      this.selectedObstacleLine = null;
      if (this.infoWindow) {
          this.infoWindow.close();
      }
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    }
  }

  clearAllObstacleLines() {
    this.drawnObstacleLines.forEach(polyline => {
      if (polyline._bufferOverlay) polyline._bufferOverlay.setMap(null);
      polyline.setMap(null);
    });
    this.drawnObstacleLines = [];
    this.selectedObstacleLine = null;
    if (this.infoWindow) {
        this.infoWindow.close();
    }
  }

  /**
   * Collecte les données de tous les obstacles lignes
   * @returns {Object} Données des obstacles lignes
   */
  collectObstacleLinesData() {
    try {
      const linesData = {};
      
      this.drawnObstacleLines.forEach((polyline, index) => {
        try {
          if (!polyline) {
            console.warn('Ligne obstacle invalide détectée:', polyline);
            return;
          }

          const path = polyline.getPath();
          if (!path) return;

          const obstacleId = polyline.obstacleId || `obstacle_line_${index}`;
          const points = path.getArray().map(point => ({
            lat: point.lat(),
            lng: point.lng()
          }));

          linesData[obstacleId] = {
            points: points,
            bufferDistance: polyline.bufferDistance || 0
          };
        } catch (error) {
          console.error(`Erreur lors de la collecte des données de la ligne obstacle:`, error);
        }
      });

      return linesData;
    } catch (error) {
      console.error('Erreur lors de la collecte des données des lignes obstacles:', error);
      return {};
    }
  }

  /**
   * Charge les obstacles lignes depuis les données sauvegardées
   * @param {Object} linesData - Données des obstacles lignes à charger
   */
  loadObstacleLinesFromData(linesData) {
    try {
      if (!linesData || typeof linesData !== 'object') {
        console.warn('Données de lignes obstacles invalides:', linesData);
        return;
      }

      if (Object.keys(linesData).length === 0) {
        return;
      }

      Object.entries(linesData).forEach(([obstacleId, data]) => {
        try {
          if (!data.points || !Array.isArray(data.points)) {
            console.warn(`Données invalides pour la ligne obstacle ${obstacleId}:`, data);
            return;
          }

          const path = data.points.map(point => new google.maps.LatLng(point.lat, point.lng));

          const polyline = new google.maps.Polyline({
            path: path,
            ...STYLES.OBSTACLE_LINE,
            draggable: false,
            editable: false,
            map: this.drawingControl.map
          });
          
          polyline.isObstacle = true;
          polyline.bufferDistance = data.bufferDistance || 0;
          polyline.obstacleId = obstacleId;
          this.usedObstacleIds.add(obstacleId);
          this.drawnObstacleLines.push(polyline);
          this.setupObstacleLineListeners(polyline);
          this.updateBufferVisual(polyline);

        } catch (error) {
          console.error(`Erreur lors du chargement de la ligne obstacle ${obstacleId}:`, error);
        }
      });

      // Rafraîchir les panneaux après chargement
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    } catch (error) {
      console.error('Erreur lors du chargement des lignes obstacles:', error);
    }
  }
}

export default ObstacleLine;
