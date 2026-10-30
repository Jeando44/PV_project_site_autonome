import { STYLES } from '../constants.js';

class ObstacleCircle {
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.drawnObstacleCircles = [];
    this.selectedObstacleCircle = null;
    this.usedObstacleIds = new Set();
    this.infoWindow = new google.maps.InfoWindow();
  }

  /**
   * Affiche/actualise le contour pointillé représentant la zone tampon réelle (rayon + buffer)
   * autour du cercle, pour vérifier visuellement que le buffer s'applique bien depuis le périmètre
   * (et non depuis le centre). google.maps.Circle ne supporte pas les traits pointillés nativement :
   * le contour est donc approximé par une Polyline fermée suivant la circonférence.
   * @param {google.maps.Circle} circle
   */
  updateBufferVisual(circle) {
    if (circle._bufferOverlay) {
      circle._bufferOverlay.setMap(null);
      circle._bufferOverlay = null;
    }
    const buffer = circle.bufferDistance || 0;
    if (buffer <= 0) return;

    const center = circle.getCenter();
    const totalRadius = circle.getRadius() + buffer;
    if (!center || !totalRadius) return;

    const points = [];
    for (let deg = 0; deg <= 360; deg += 10) {
      points.push(google.maps.geometry.spherical.computeOffset(center, totalRadius, deg));
    }

    circle._bufferOverlay = new google.maps.Polyline({
      path: points,
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
   * Génère un nouvel ID unique pour un obstacle cercle
   * @returns {string} ID unique pour l'obstacle cercle
   */
  generateObstacleId() {
    let counter = 1;
    let obstacleId;
    do {
      obstacleId = `obstacle_circle_${counter}`;
      counter++;
    } while (this.usedObstacleIds.has(obstacleId));
    this.usedObstacleIds.add(obstacleId);
    return obstacleId;
  }

  handleObstacleCircleComplete(circle) {
    circle.isObstacle = true;
    circle.obstacleId = this.generateObstacleId();
    circle.setOptions({
      ...STYLES.OBSTACLE_CIRCLE,
      draggable: true,
      editable: false
    });
    
    this.drawnObstacleCircles.push(circle);
    this.setupObstacleCircleListeners(circle);
    this.setObstacleCircleSelection(circle);
    this.updateBufferVisual(circle);
    if (this.drawingControl.obstaclePanels) {
      this.drawingControl.obstaclePanels.requestRefresh();
    }
    return circle;
  }

  setupObstacleCircleListeners(circle) {
    google.maps.event.addListener(circle, 'click', () => {
      this.setObstacleCircleSelection(circle);
      
      // Interface popover pour la Zone Tampon (Buffer)
      const content = document.createElement('div');
      content.innerHTML = `
          <div style="padding: 4px; font-family: var(--font-family, sans-serif); color: #333;">
              <label style="font-size:12px; font-weight:bold;">Zone tampon (m) :</label>
              <input type="number" min="0" step="0.5" value="${circle.bufferDistance || 0}"
                     style="width: 60px; margin-left:5px; padding:2px; border:1px solid #ccc; border-radius:3px;">
          </div>
      `;
      const input = content.querySelector('input');
      input.addEventListener('input', (ev) => {
          circle.bufferDistance = parseFloat(ev.target.value) || 0;
          this.updateBufferVisual(circle);
          if (this.drawingControl.obstaclePanels) {
              this.drawingControl.obstaclePanels.requestRefresh();
          }
          if (window.storageManager && typeof window.storageManager.savePageData === "function") {
              window.storageManager.savePageData();
          }
      });
      this.infoWindow.setContent(content);
      this.infoWindow.setPosition(circle.getCenter());
      this.infoWindow.open(this.drawingControl.map);
    });

    // Mettre à jour les panneaux sous l'obstacle lors des déplacements
    google.maps.event.addListener(circle, 'drag', () => {
      this.updateBufferVisual(circle);
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    });

    google.maps.event.addListener(circle, 'dragend', () => {
      this.updateBufferVisual(circle);
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    });

    google.maps.event.addListener(circle, 'rightclick', () => {
      if (this.selectedObstacleCircle === circle) {
        this.deleteSelectedObstacleCircle();
      }
    });
  }

  setObstacleCircleSelection(circle) {
    if (this.selectedObstacleCircle) {
      this.selectedObstacleCircle.setOptions(STYLES.OBSTACLE_CIRCLE);
    }
    
    this.drawingControl.clearSelection();
    this.selectedObstacleCircle = circle;
    
    if (circle) {
      circle.setOptions(STYLES.SELECTED_OBSTACLE_CIRCLE);
    }
  }

  deleteSelectedObstacleCircle() {
    if (this.selectedObstacleCircle) {
      if (this.selectedObstacleCircle._bufferOverlay) {
        this.selectedObstacleCircle._bufferOverlay.setMap(null);
      }
      this.selectedObstacleCircle.setMap(null);
      this.drawnObstacleCircles = this.drawnObstacleCircles.filter(c => c !== this.selectedObstacleCircle);
      this.selectedObstacleCircle = null;
      if (this.infoWindow) {
          this.infoWindow.close();
      }
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    }
  }

  clearAllObstacleCircles() {
    this.drawnObstacleCircles.forEach(circle => {
      if (circle._bufferOverlay) circle._bufferOverlay.setMap(null);
      circle.setMap(null);
    });
    this.drawnObstacleCircles = [];
    this.selectedObstacleCircle = null;
    if (this.infoWindow) {
        this.infoWindow.close();
    }
  }

  /**
   * Collecte les données de tous les obstacles cercles
   * @returns {Object} Données des obstacles cercles
   */
  collectObstacleCirclesData() {
    try {
      const circlesData = {};
      
      this.drawnObstacleCircles.forEach((circle, index) => {
        try {
          if (!circle) {
            console.warn('Cercle obstacle invalide détecté:', circle);
            return;
          }

          const center = circle.getCenter();
          const radius = circle.getRadius();
          const obstacleId = circle.obstacleId || `obstacle_circle_${index}`;

          circlesData[obstacleId] = {
            center: {
              lat: center.lat(),
              lng: center.lng()
            },
            radius: radius,
            bufferDistance: circle.bufferDistance || 0
          };
        } catch (error) {
          console.error(`Erreur lors de la collecte des données du cercle obstacle:`, error);
        }
      });

      return circlesData;
    } catch (error) {
      console.error('Erreur lors de la collecte des données des cercles obstacles:', error);
      return {};
    }
  }

  /**
   * Charge les obstacles cercles depuis les données sauvegardées
   * @param {Object} circlesData - Données des obstacles cercles à charger
   */
  loadObstacleCirclesFromData(circlesData) {
    try {
      if (!circlesData || typeof circlesData !== 'object') {
        console.warn('Données de cercles obstacles invalides:', circlesData);
        return;
      }

      if (Object.keys(circlesData).length === 0) {
        return;
      }

      Object.entries(circlesData).forEach(([obstacleId, data]) => {
        try {
          if (!data.center || !data.radius) {
            console.warn(`Données invalides pour le cercle obstacle ${obstacleId}:`, data);
            return;
          }

          const circle = new google.maps.Circle({
            center: new google.maps.LatLng(data.center.lat, data.center.lng),
            radius: data.radius,
            ...STYLES.OBSTACLE_CIRCLE,
            draggable: true,
            editable: false,
            map: this.drawingControl.map
          });
          
          circle.isObstacle = true;
          circle.bufferDistance = data.bufferDistance || 0;
          circle.obstacleId = obstacleId;
          this.usedObstacleIds.add(obstacleId);
          this.drawnObstacleCircles.push(circle);
          this.setupObstacleCircleListeners(circle);
          this.updateBufferVisual(circle);

        } catch (error) {
          console.error(`Erreur lors du chargement du cercle obstacle ${obstacleId}:`, error);
        }
      });

      // Rafraîchir les panneaux après chargement
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    } catch (error) {
      console.error('Erreur lors du chargement des cercles obstacles:', error);
    }
  }
}

export default ObstacleCircle;