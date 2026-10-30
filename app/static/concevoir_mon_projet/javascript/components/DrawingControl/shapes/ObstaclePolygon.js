import { STYLES } from '../constants.js';
import GeometryUtils from '../utils/GeometryUtils.js';

class ObstaclePolygon {
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.drawnObstaclePolygons = [];
    this.selectedObstaclePolygon = null;
    this.usedObstacleIds = new Set();
    this.infoWindow = new google.maps.InfoWindow();
  }

  /**
   * Affiche/actualise le contour pointillé représentant la zone tampon réelle autour du polygone
   * (cf. GeometryUtils.bufferPolygonOutward).
   * @param {google.maps.Polygon} polygon
   */
  updateBufferVisual(polygon) {
    if (polygon._bufferOverlay) {
      polygon._bufferOverlay.setMap(null);
      polygon._bufferOverlay = null;
    }
    const buffer = polygon.bufferDistance || 0;
    if (buffer <= 0) return;

    const path = polygon.getPath();
    if (!path || path.getLength() < 3) return;

    const bufferedPath = GeometryUtils.bufferPolygonOutward(path, buffer);
    polygon._bufferOverlay = new google.maps.Polyline({
      path: [...bufferedPath, bufferedPath[0]],
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
   * Génère un nouvel ID unique pour un obstacle polygone
   * @returns {string} ID unique pour l'obstacle polygone
   */
  generateObstacleId() {
    let counter = 1;
    let obstacleId;
    do {
      obstacleId = `obstacle_polygon_${counter}`;
      counter++;
    } while (this.usedObstacleIds.has(obstacleId));
    this.usedObstacleIds.add(obstacleId);
    return obstacleId;
  }

  handleObstaclePolygonComplete(polygon) {
    polygon.isObstacle = true;
    polygon.obstacleId = this.generateObstacleId();
    polygon.setOptions({
      ...STYLES.OBSTACLE_POLYGON,
      // Drag natif désactivé : peu fiable pour Polygon sur carte vectorielle (mapId), remplacé par
      // un déplacement manuel du path (cf. GeometryUtils.attachManualPathDrag).
      draggable: false,
      editable: false
    });

    this.drawnObstaclePolygons.push(polygon);
    this.setupObstaclePolygonListeners(polygon);
    this.setObstaclePolygonSelection(polygon);
    this.updateBufferVisual(polygon);
    if (this.drawingControl.obstaclePanels) {
      this.drawingControl.obstaclePanels.requestRefresh();
    }
    return polygon;
  }

  setupObstaclePolygonListeners(polygon) {
    google.maps.event.addListener(polygon, 'click', () => {
      this.setObstaclePolygonSelection(polygon);
      
      // Interface popover pour la Zone Tampon (Buffer)
      const content = document.createElement('div');
      content.innerHTML = `
          <div style="padding: 4px; font-family: var(--font-family, sans-serif); color: #333;">
              <label style="font-size:12px; font-weight:bold;">Zone tampon (m) :</label>
              <input type="number" min="0" step="0.5" value="${polygon.bufferDistance || 0}"
                     style="width: 60px; margin-left:5px; padding:2px; border:1px solid #ccc; border-radius:3px;">
          </div>
      `;
      const input = content.querySelector('input');
      input.addEventListener('input', (ev) => {
          polygon.bufferDistance = parseFloat(ev.target.value) || 0;
          this.updateBufferVisual(polygon);
          if (this.drawingControl.obstaclePanels) {
              this.drawingControl.obstaclePanels.requestRefresh();
          }
          if (window.storageManager && typeof window.storageManager.savePageData === "function") {
              window.storageManager.savePageData();
          }
      });
      this.infoWindow.setContent(content);
      this.infoWindow.setPosition(polygon.getPath().getAt(0));
      this.infoWindow.open(this.drawingControl.map);
    });

    // Déplacement manuel (drag natif désactivé, cf. draggable:false ci-dessus) : translate le path
    // et déclenche les mêmes effets de bord que l'ancien 'drag'/'dragend' natif.
    GeometryUtils.attachManualPathDrag(polygon, this.drawingControl.map, {
      onDrag: () => {
        this.updateBufferVisual(polygon);
        if (this.drawingControl.obstaclePanels) {
          this.drawingControl.obstaclePanels.requestRefresh();
        }
      },
      onDragEnd: () => {
        this.updateBufferVisual(polygon);
        if (this.drawingControl.obstaclePanels) {
          this.drawingControl.obstaclePanels.requestRefresh();
        }
        if (window.storageManager && typeof window.storageManager.savePageData === 'function') {
          window.storageManager.savePageData();
        }
      },
    });

    google.maps.event.addListener(polygon, 'rightclick', () => {
      if (this.selectedObstaclePolygon === polygon) {
        this.deleteSelectedObstaclePolygon();
      }
    });
  }

  setObstaclePolygonSelection(polygon) {
    if (this.selectedObstaclePolygon) {
      this.selectedObstaclePolygon.setOptions(STYLES.OBSTACLE_POLYGON);
    }
    
    this.drawingControl.clearSelection();
    this.selectedObstaclePolygon = polygon;
    
    if (polygon) {
      polygon.setOptions(STYLES.SELECTED_OBSTACLE_POLYGON);
    }
  }

  deleteSelectedObstaclePolygon() {
    if (this.selectedObstaclePolygon) {
      if (this.selectedObstaclePolygon._bufferOverlay) {
        this.selectedObstaclePolygon._bufferOverlay.setMap(null);
      }
      this.selectedObstaclePolygon.setMap(null);
      this.drawnObstaclePolygons = this.drawnObstaclePolygons.filter(p => p !== this.selectedObstaclePolygon);
      this.selectedObstaclePolygon = null;
      if (this.infoWindow) {
          this.infoWindow.close();
      }
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    }
  }

  clearAllObstaclePolygons() {
    this.drawnObstaclePolygons.forEach(polygon => {
      if (polygon._bufferOverlay) polygon._bufferOverlay.setMap(null);
      polygon.setMap(null);
    });
    this.drawnObstaclePolygons = [];
    this.selectedObstaclePolygon = null;
    if (this.infoWindow) {
        this.infoWindow.close();
    }
  }

  /**
   * Collecte les données de tous les obstacles polygones
   * @returns {Object} Données des obstacles polygones
   */
  collectObstaclePolygonsData() {
    try {
      const polygonsData = {};
      
      this.drawnObstaclePolygons.forEach((polygon, index) => {
        try {
          if (!polygon) {
            console.warn('Polygone obstacle invalide détecté:', polygon);
            return;
          }

          const path = polygon.getPath();
          if (!path) return;

          const obstacleId = polygon.obstacleId || `obstacle_polygon_${index}`;
          const points = path.getArray().map(point => ({
            lat: point.lat(),
            lng: point.lng()
          }));

          polygonsData[obstacleId] = {
            points: points,
            bufferDistance: polygon.bufferDistance || 0
          };
        } catch (error) {
          console.error(`Erreur lors de la collecte des données du polygone obstacle:`, error);
        }
      });

      return polygonsData;
    } catch (error) {
      console.error('Erreur lors de la collecte des données des polygones obstacles:', error);
      return {};
    }
  }

  /**
   * Charge les obstacles polygones depuis les données sauvegardées
   * @param {Object} polygonsData - Données des obstacles polygones à charger
   */
  loadObstaclePolygonsFromData(polygonsData) {
    try {
      if (!polygonsData || typeof polygonsData !== 'object') {
        console.warn('Données de polygones obstacles invalides:', polygonsData);
        return;
      }

      if (Object.keys(polygonsData).length === 0) {
        return;
      }

      Object.entries(polygonsData).forEach(([obstacleId, data]) => {
        try {
          if (!data.points || !Array.isArray(data.points)) {
            console.warn(`Données invalides pour le polygone obstacle ${obstacleId}:`, data);
            return;
          }

          const paths = data.points.map(point => new google.maps.LatLng(point.lat, point.lng));

          const polygon = new google.maps.Polygon({
            paths: paths,
            ...STYLES.OBSTACLE_POLYGON,
            draggable: false,
            editable: false,
            map: this.drawingControl.map
          });
          
          polygon.isObstacle = true;
          polygon.bufferDistance = data.bufferDistance || 0;
          polygon.obstacleId = obstacleId;
          this.usedObstacleIds.add(obstacleId);
          this.drawnObstaclePolygons.push(polygon);
          this.setupObstaclePolygonListeners(polygon);
          this.updateBufferVisual(polygon);

        } catch (error) {
          console.error(`Erreur lors du chargement du polygone obstacle ${obstacleId}:`, error);
        }
      });

      // Rafraîchir les panneaux après chargement
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    } catch (error) {
      console.error('Erreur lors du chargement des polygones obstacles:', error);
    }
  }
}

export default ObstaclePolygon;