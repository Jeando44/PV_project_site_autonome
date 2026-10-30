import { DRAWING_STYLES, ELEVATION_PROVIDERS, getDrawingStylesForProvider } from '../constants.js';
import TooltipHandler from './TooltipHandler.js';

/**
 * Utilitaires pour créer et gérer les éléments géométriques sur Google Maps
 * @class GeometryUtils
 */
class GeometryUtils {
  /**
   * Crée une polyline sur la carte
   * @param {Array<{lat: number, lng: number}>} coordinates - Coordonnées de la ligne
   * @param {google.maps.Map} map - Instance de la carte
   * @param {boolean} isTemporary - Si c'est une ligne temporaire
   * @param {Array<Object>} profilePoints - Points du profil pour le tooltip (optionnel)
   * @param {string} profilAltimetriqueName - Nom du profil altimétrique
   * @param {string} provider - Provider de données (geoportail ou google_maps)
   * @returns {Object} Objet contenant {polyline, tooltipHandler}
   */
  static createPolyline(coordinates, map, isTemporary = false, profilePoints = null, profilAltimetriqueName = null, provider = ELEVATION_PROVIDERS.GEOPORTAIL) {
    const path = coordinates.map(coord => ({
      lat: coord.lat,
      lng: coord.lng
    }));

    // Obtenir les styles selon le provider
    const providerStyles = getDrawingStylesForProvider(provider);
    const styles = isTemporary 
      ? providerStyles.TEMPORARY_LINE 
      : providerStyles.POLYLINE;

    const polyline = new google.maps.Polyline({
      path,
      map,
      ...styles
    });

    // Ajouter le tooltip si des points de profil sont fournis et que ce n'est pas une ligne temporaire
    let tooltipHandler = null;
    if (!isTemporary && profilePoints && profilePoints.length > 0) {
      tooltipHandler = TooltipHandler.addTooltipToPolyline(polyline, map, profilePoints, profilAltimetriqueName);
    }

    // Retourner un objet pour compatibilité ascendante
    return {
      polyline,
      tooltipHandler
    };
  }

  /**
   * Crée un marker circulaire sur la carte
   * @param {Object} position - Position {lat, lng}
   * @param {google.maps.Map} map - Instance de la carte
   * @param {number|string} label - Label du marker (numéro)
   * @param {string} provider - Provider de données (geoportail ou google_maps)
   * @returns {google.maps.Marker} Marker créé
   */
  static createMarker(position, map, label = null, provider = ELEVATION_PROVIDERS.GEOPORTAIL) {
    // Obtenir les styles selon le provider
    const providerStyles = getDrawingStylesForProvider(provider);
    
    const markerOptions = {
      position,
      map,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        ...providerStyles.MARKER
      }
    };

    if (label !== null) {
      markerOptions.label = {
        text: label.toString(),
        color: '#FFFFFF',
        fontSize: '10px',
        fontWeight: 'bold'
      };
    }

    return new google.maps.Marker(markerOptions);
  }

  /**
   * Nettoie une polyline et ses markers
   * @param {google.maps.Polyline|Object} polyline - Polyline ou objet {polyline, tooltipHandler} à supprimer
   * @param {Array<google.maps.Marker>} markers - Markers à supprimer
   * @param {Object} tooltipHandler - Handler de tooltip à nettoyer (optionnel)
   */
  static clearDrawing(polyline, markers, tooltipHandler = null) {
    // Gérer le cas où polyline est un objet {polyline, tooltipHandler}
    let actualPolyline = polyline;
    let actualTooltipHandler = tooltipHandler;

    if (polyline && typeof polyline === 'object' && polyline.polyline) {
      actualPolyline = polyline.polyline;
      actualTooltipHandler = polyline.tooltipHandler || tooltipHandler;
    }

    // Nettoyer le tooltip handler
    if (actualTooltipHandler && actualTooltipHandler.cleanup) {
      actualTooltipHandler.cleanup();
    }

    // Nettoyer la polyline
    if (actualPolyline) {
      actualPolyline.setMap(null);
    }

    // Nettoyer les markers
    if (markers && Array.isArray(markers)) {
      markers.forEach(marker => {
        if (marker) {
          marker.setMap(null);
        }
      });
    }
  }

  /**
   * Met à jour le chemin d'une polyline
   * @param {google.maps.Polyline|Object} polyline - Polyline ou objet {polyline, tooltipHandler} à mettre à jour
   * @param {Array<{lat: number, lng: number}>} coordinates - Nouvelles coordonnées
   */
  static updatePolylinePath(polyline, coordinates) {
    // Gérer le cas où polyline est un objet {polyline, tooltipHandler}
    const actualPolyline = (polyline && polyline.polyline) ? polyline.polyline : polyline;
    
    if (!actualPolyline) return;

    const path = coordinates.map(coord => ({
      lat: coord.lat,
      lng: coord.lng
    }));

    actualPolyline.setPath(path);
  }

  /**
   * Affiche ou masque une polyline
   * @param {google.maps.Polyline|Object} polyline - Polyline ou objet {polyline, tooltipHandler} à afficher/masquer
   * @param {boolean} visible - Visible ou non
   */
  static setPolylineVisibility(polyline, visible) {
    // Gérer le cas où polyline est un objet {polyline, tooltipHandler}
    const actualPolyline = (polyline && polyline.polyline) ? polyline.polyline : polyline;
    
    if (!actualPolyline) return;
    actualPolyline.setVisible(visible);
  }

  /**
   * Affiche ou masque un ensemble de markers
   * @param {Array<google.maps.Marker>} markers - Markers à afficher/masquer
   * @param {boolean} visible - Visible ou non
   */
  static setMarkersVisibility(markers, visible) {
    if (!markers || !Array.isArray(markers)) return;
    
    markers.forEach(marker => {
      if (marker) {
        marker.setVisible(visible);
      }
    });
  }
}

export default GeometryUtils;

