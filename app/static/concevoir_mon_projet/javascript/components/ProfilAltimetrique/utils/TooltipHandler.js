/**
 * Gestionnaire de tooltips pour les polylines sur la carte
 * @class TooltipHandler
 */
class TooltipHandler {
  /**
   * Ajoute un tooltip interactif à une polyline
   * @param {google.maps.Polyline} polyline - La polyline à laquelle ajouter le tooltip
   * @param {google.maps.Map} map - Instance de la carte
   * @param {Array<Object>} points - Points du profil avec {distance, altitude, slope, lat, lon}
   * @param {string} profilAltimetriqueName - Nom du profil altimétrique
   * @returns {Object} Objet contenant les listeners pour nettoyage
   */
  static addTooltipToPolyline(polyline, map, points, profilAltimetriqueName) {
    if (!polyline || !map || !points || points.length < 2) {
      return null;
    }

    // Créer l'InfoWindow pour le tooltip
    const infoWindow = new google.maps.InfoWindow({
      disableAutoPan: true,
      pixelOffset: new google.maps.Size(0, -10)
    });

    // Événement au survol de la polyline
    const mouseoverListener = polyline.addListener('mouseover', (event) => {
      const mouseLatLng = event.latLng;
      
      // Trouver le segment le plus proche
      const segmentInfo = this._findNearestSegment(mouseLatLng, points);
      
      if (segmentInfo) {
        // Créer le contenu du tooltip
        const content = this._createTooltipContent(segmentInfo, profilAltimetriqueName);
        
        infoWindow.setContent(content);
        infoWindow.setPosition(mouseLatLng);
        infoWindow.open(map);

        // Dispatcher un événement pour afficher le tooltip sur le graphique
        document.dispatchEvent(new CustomEvent('profil:polyline:hover', {
          detail: {
            segmentIndex: segmentInfo.segmentIndex,
            point: segmentInfo.endPoint
          }
        }));
      }
    });

    // Événement au déplacement de la souris sur la polyline
    const mousemoveListener = polyline.addListener('mousemove', (event) => {
      const mouseLatLng = event.latLng;
      
      // Trouver le segment le plus proche
      const segmentInfo = this._findNearestSegment(mouseLatLng, points);
      
      if (segmentInfo) {
        // Mettre à jour le contenu du tooltip
        const content = this._createTooltipContent(segmentInfo, profilAltimetriqueName);
        
        infoWindow.setContent(content);
        infoWindow.setPosition(mouseLatLng);

        // Dispatcher un événement pour mettre à jour le tooltip sur le graphique
        document.dispatchEvent(new CustomEvent('profil:polyline:hover', {
          detail: {
            segmentIndex: segmentInfo.segmentIndex,
            point: segmentInfo.endPoint
          }
        }));
      }
    });

    // Événement quand la souris quitte la polyline
    const mouseoutListener = polyline.addListener('mouseout', () => {
      infoWindow.close();

      // Dispatcher un événement pour masquer le tooltip sur le graphique
      document.dispatchEvent(new CustomEvent('profil:polyline:hoverout'));
    });

    // Retourner les listeners pour permettre le nettoyage
    return {
      infoWindow,
      listeners: [mouseoverListener, mousemoveListener, mouseoutListener],
      cleanup: () => {
        google.maps.event.removeListener(mouseoverListener);
        google.maps.event.removeListener(mousemoveListener);
        google.maps.event.removeListener(mouseoutListener);
        infoWindow.close();
      }
    };
  }

  /**
   * Trouve le segment le plus proche d'une position
   * @private
   * @param {google.maps.LatLng} mouseLatLng - Position de la souris
   * @param {Array<Object>} points - Points du profil
   * @returns {Object|null} Informations du segment le plus proche
   */
  static _findNearestSegment(mouseLatLng, points) {
    let minDistance = Infinity;
    let nearestSegment = null;

    for (let i = 0; i < points.length - 1; i++) {
      const point1 = points[i];
      const point2 = points[i + 1];
      
      const p1 = new google.maps.LatLng(point1.lat, point1.lon);
      const p2 = new google.maps.LatLng(point2.lat, point2.lon);
      
      // Calculer la distance de la souris au segment
      const distance = this._distanceToSegment(mouseLatLng, p1, p2);
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestSegment = {
          startPoint: point1,
          endPoint: point2,
          segmentIndex: i,
          // Calculer les valeurs moyennes pour le segment
          altitude: (point1.altitude + point2.altitude) / 2,
          distance: point2.distance, // Distance cumulée jusqu'à ce point
          slope: point2.slope // Pente de ce segment
        };
      }
    }

    return nearestSegment;
  }

  /**
   * Calcule la distance d'un point à un segment de ligne
   * @private
   * @param {google.maps.LatLng} point - Point à tester
   * @param {google.maps.LatLng} segmentStart - Début du segment
   * @param {google.maps.LatLng} segmentEnd - Fin du segment
   * @returns {number} Distance en degrés (approximation)
   */
  static _distanceToSegment(point, segmentStart, segmentEnd) {
    const x = point.lat();
    const y = point.lng();
    const x1 = segmentStart.lat();
    const y1 = segmentStart.lng();
    const x2 = segmentEnd.lat();
    const y2 = segmentEnd.lng();

    // Calcul de la distance perpendiculaire au segment
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let xx, yy;

    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;

    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Crée le contenu HTML du tooltip
   * @private
   * @param {Object} segmentInfo - Informations du segment
   * @param {string} profilAltimetriqueName - Nom du profil altimétrique
   * @returns {string} Contenu HTML
   */
  static _createTooltipContent(segmentInfo, profilAltimetriqueName) {
    const {altitude, distance, slope } = segmentInfo;
    
    return `
      <div style="
        padding: 8px;
        font-family: Arial, sans-serif;
        font-size: 12px;
        line-height: 1.6;
        min-width: 150px;
      ">
          <span style="font-weight: bold; color: #333;"> ${profilAltimetriqueName}</span>

        <div style="display: flex; justify-content: space-between; margin: 4px 0;">
          <span style="color: #666;">Distance:</span>
          <span style="font-weight: bold; color: #333;">${distance.toFixed(2)} m</span>
        </div>
                <div style="display: flex; justify-content: space-between; margin: 4px 0;">
          <span style="color: #666;">Altitude:</span>
          <span style="font-weight: bold; color: #333;">${altitude.toFixed(2)} m</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin: 4px 0;">
          <span style="color: #666;">Pente:</span>
          <span style="font-weight: bold; color: ${this._getSlopeColor(slope)};">${slope.toFixed(2)}%</span>
        </div>
      </div>
    `;
  }

  /**
   * Retourne une couleur en fonction de la pente
   * @private
   * @param {number} slope - Pente en pourcentage
   * @returns {string} Couleur CSS
   */
  static _getSlopeColor(slope) {
    const absSlope = Math.abs(slope);
    
    if (absSlope < 5) return '#4CAF50'; // Vert pour pente faible
    if (absSlope < 10) return '#FF9800'; // Orange pour pente moyenne
    return '#f44336'; // Rouge pour pente forte
  }
}

export default TooltipHandler;

