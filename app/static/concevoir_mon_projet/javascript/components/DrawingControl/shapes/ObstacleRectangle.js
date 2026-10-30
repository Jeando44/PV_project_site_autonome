import { STYLES } from '../constants.js';
import GeometryUtils from '../utils/GeometryUtils.js';

/**
 * Obstacle rectangle. Représenté en interne par un google.maps.Polygon à 4 points (et non un
 * google.maps.Rectangle natif) : le Rectangle natif de l'API Google Maps ne supporte pas la
 * rotation (toujours aligné sur les axes lat/lng), ce qui empêchait tout pivot. Le dessin
 * initial (EventHandler -> drawingManager RECTANGLE) produit toujours un google.maps.Rectangle
 * natif ; il est converti en polygone dès sa finalisation (cf. handleObstacleRectangleComplete),
 * exactement comme SolarRectangle.js le fait déjà pour les rectangles PV.
 */
class ObstacleRectangle {
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.drawnObstacleRectangles = [];
    this.selectedObstacleRectangle = null;
    this.usedObstacleIds = new Set();
    this.infoWindow = new google.maps.InfoWindow();
  }

  /**
   * Génère un nouvel ID unique pour un obstacle rectangle
   * @returns {string} ID unique pour l'obstacle rectangle
   */
  generateObstacleId() {
    let counter = 1;
    let obstacleId;
    do {
      obstacleId = `obstacle_rectangle_${counter}`;
      counter++;
    } while (this.usedObstacleIds.has(obstacleId));
    this.usedObstacleIds.add(obstacleId);
    return obstacleId;
  }

  /**
   * Affiche/actualise le contour pointillé représentant la zone tampon réelle autour du
   * rectangle (cf. GeometryUtils.bufferPolygonOutward — exact pour un rectangle, y compris roté).
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
   * Convertit le rectangle natif Google (dessiné par le DrawingManager, non rotatable) en
   * polygone à 4 points et finalise l'obstacle.
   * @param {google.maps.Rectangle} rectangle - Rectangle natif temporaire
   * @returns {google.maps.Polygon} Le polygone obstacle créé
   */
  handleObstacleRectangleComplete(rectangle) {
    const bounds = rectangle.getBounds();
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const nw = new google.maps.LatLng(ne.lat(), sw.lng());
    const se = new google.maps.LatLng(sw.lat(), ne.lng());
    const points = [nw, ne, se, sw];

    // Supprimer le rectangle natif temporaire, remplacé par le polygone ci-dessous
    rectangle.setMap(null);

    const polygon = new google.maps.Polygon({
      paths: points,
      ...STYLES.OBSTACLE_RECTANGLE,
      // Drag natif désactivé : peu fiable pour Polygon/Polyline sur carte vectorielle (mapId),
      // remplacé par un déplacement manuel du path (cf. GeometryUtils.attachManualPathDrag).
      draggable: false,
      editable: false,
      map: this.drawingControl.map
    });

    polygon.isObstacle = true;
    polygon.isObstacleRectangle = true;
    polygon.obstacleId = this.generateObstacleId();

    this.drawnObstacleRectangles.push(polygon);
    this.setupObstacleRectangleListeners(polygon);
    this.setObstacleRectangleSelection(polygon);
    this.updateBufferVisual(polygon);
    if (this.drawingControl.obstaclePanels) {
      this.drawingControl.obstaclePanels.requestRefresh();
    }
    return polygon;
  }

  setupObstacleRectangleListeners(polygon) {
    google.maps.event.addListener(polygon, 'click', () => {
      this.setObstacleRectangleSelection(polygon);

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
      if (this.selectedObstacleRectangle === polygon) {
        this.deleteSelectedObstacleRectangle();
      }
    });
  }

  setObstacleRectangleSelection(polygon) {
    if (this.selectedObstacleRectangle) {
      this.selectedObstacleRectangle.setOptions(STYLES.OBSTACLE_RECTANGLE);
    }

    this.drawingControl.clearSelection();
    this.selectedObstacleRectangle = polygon;

    if (polygon) {
      polygon.setOptions(STYLES.SELECTED_OBSTACLE_RECTANGLE);
    }
  }

  deleteSelectedObstacleRectangle() {
    if (this.selectedObstacleRectangle) {
      if (this.selectedObstacleRectangle._bufferOverlay) {
        this.selectedObstacleRectangle._bufferOverlay.setMap(null);
      }
      this.selectedObstacleRectangle.setMap(null);
      this.drawnObstacleRectangles = this.drawnObstacleRectangles.filter(r => r !== this.selectedObstacleRectangle);
      this.selectedObstacleRectangle = null;
      if (this.infoWindow) {
          this.infoWindow.close();
      }
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    }
  }

  clearAllObstacleRectangles() {
    this.drawnObstacleRectangles.forEach(polygon => {
      if (polygon._bufferOverlay) polygon._bufferOverlay.setMap(null);
      polygon.setMap(null);
    });
    this.drawnObstacleRectangles = [];
    this.selectedObstacleRectangle = null;
    if (this.infoWindow) {
        this.infoWindow.close();
    }
  }

  /**
   * Collecte les données de tous les obstacles rectangles
   * @returns {Object} Données des obstacles rectangles
   */
  collectObstacleRectanglesData() {
    try {
      const rectanglesData = {};

      this.drawnObstacleRectangles.forEach((polygon, index) => {
        try {
          if (!polygon || typeof polygon.getPath !== 'function') {
            console.warn('Rectangle obstacle invalide détecté:', polygon);
            return;
          }

          const path = polygon.getPath();
          if (!path) return;

          const obstacleId = polygon.obstacleId || `obstacle_rectangle_${index}`;
          const points = path.getArray().map(point => ({
            lat: point.lat(),
            lng: point.lng()
          }));

          rectanglesData[obstacleId] = {
            points: points,
            bufferDistance: polygon.bufferDistance || 0
          };
        } catch (error) {
          console.error(`Erreur lors de la collecte des données du rectangle obstacle:`, error);
        }
      });

      return rectanglesData;
    } catch (error) {
      console.error('Erreur lors de la collecte des données des rectangles obstacles:', error);
      return {};
    }
  }

  /**
   * Charge les obstacles rectangles depuis les données sauvegardées
   * @param {Object} rectanglesData - Données des obstacles rectangles à charger
   */
  loadObstacleRectanglesFromData(rectanglesData) {
    try {
      if (!rectanglesData || typeof rectanglesData !== 'object') {
        console.warn('Données de rectangles obstacles invalides:', rectanglesData);
        return;
      }

      if (Object.keys(rectanglesData).length === 0) {
        return;
      }

      Object.entries(rectanglesData).forEach(([obstacleId, data]) => {
        try {
          let points;
          if (data.points && Array.isArray(data.points)) {
            points = data.points.map(point => new google.maps.LatLng(point.lat, point.lng));
          } else if (data.bounds) {
            // Rétrocompatibilité : anciennes données sauvegardées sous forme de bounds
            // axis-aligned (avant la conversion en polygone rotatable).
            const ne = new google.maps.LatLng(data.bounds.north, data.bounds.east);
            const sw = new google.maps.LatLng(data.bounds.south, data.bounds.west);
            points = [
              new google.maps.LatLng(ne.lat(), sw.lng()),
              ne,
              new google.maps.LatLng(sw.lat(), ne.lng()),
              sw
            ];
          } else {
            console.warn(`Données invalides pour le rectangle obstacle ${obstacleId}:`, data);
            return;
          }

          const polygon = new google.maps.Polygon({
            paths: points,
            ...STYLES.OBSTACLE_RECTANGLE,
            draggable: false,
            editable: false,
            map: this.drawingControl.map
          });

          polygon.isObstacle = true;
          polygon.isObstacleRectangle = true;
          polygon.bufferDistance = data.bufferDistance || 0;
          polygon.obstacleId = obstacleId;
          this.usedObstacleIds.add(obstacleId);
          this.drawnObstacleRectangles.push(polygon);
          this.setupObstacleRectangleListeners(polygon);
          this.updateBufferVisual(polygon);

        } catch (error) {
          console.error(`Erreur lors du chargement du rectangle obstacle ${obstacleId}:`, error);
        }
      });

      // Rafraîchir les panneaux après chargement
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    } catch (error) {
      console.error('Erreur lors du chargement des rectangles obstacles:', error);
    }
  }
}

export default ObstacleRectangle;
