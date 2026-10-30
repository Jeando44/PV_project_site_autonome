import { GOOGLE_ELEVATION_CONFIG, MESSAGES } from '../constants.js';

/**
 * Service pour interagir avec l'API Google Maps Elevation
 * @class GoogleElevationAPIService
 */
class GoogleElevationAPIService {
  /**
   * Récupère le profil altimétrique pour une ligne de coordonnées
   * @param {Array<{lat: number, lng: number}>} coordinates - Tableau de coordonnées
   * @param {google.maps.Map} map - Instance de la carte Google Maps
   * @param {Object} options - Options de la requête
   * @param {number} options.sampling - Nombre de points d'échantillonnage
   * @returns {Promise<Object>} Données altimétriques formatées
   */
  static async getElevationLine(coordinates, map, options = {}) {
    if (!coordinates || coordinates.length < 2) {
      throw new Error(MESSAGES.MIN_POINTS_ERROR);
    }

    if (!map) {
      throw new Error('Instance de la carte Google Maps non disponible.');
    }

    if (!google || !google.maps || !google.maps.ElevationService) {
      throw new Error('API Google Maps Elevation non disponible.');
    }

    const {
      sampling = GOOGLE_ELEVATION_CONFIG.DEFAULT_SAMPLING
    } = options;

    try {
      const elevationService = new google.maps.ElevationService();
      
      const path = coordinates.map(coord => ({
        lat: coord.lat,
        lng: coord.lng
      }));

      const result = await Promise.race([
        this._getPathElevation(elevationService, path, sampling),
        this._timeout(GOOGLE_ELEVATION_CONFIG.TIMEOUT)
      ]);

      // Formater la réponse pour correspondre au format de l'API Géoportail
      return this._formatResponse(result, coordinates);

    } catch (error) {
      if (error.message === 'Timeout') {
        throw new Error(MESSAGES.TIMEOUT_ERROR);
      }
      if (error.message.includes('OVER_QUERY_LIMIT')) {
        throw new Error('Limite de quota Google Maps atteinte. Veuillez réessayer plus tard.');
      }
      if (error.message.includes('REQUEST_DENIED')) {
        throw new Error('Requête refusée par l\'API Google Maps. Vérifiez la configuration de l\'API.');
      }
      throw new Error(MESSAGES.API_ERROR + ': ' + error.message);
    }
  }

  /**
   * Effectue la requête à l'API Elevation avec une promesse
   * @private
   * @param {google.maps.ElevationService} service - Service d'élévation
   * @param {Array} path - Chemin des coordonnées
   * @param {number} samples - Nombre d'échantillons
   * @returns {Promise<Array>} Résultats d'élévation
   */
  static _getPathElevation(service, path, samples) {
    return new Promise((resolve, reject) => {
      service.getElevationAlongPath({
        path: path,
        samples: Math.min(samples, GOOGLE_ELEVATION_CONFIG.MAX_SAMPLES_PER_REQUEST)
      }, (results, status) => {
        if (status === 'OK') {
          resolve(results);
        } else {
          reject(new Error(status));
        }
      });
    });
  }

  /**
   * Crée une promesse de timeout
   * @private
   * @param {number} ms - Durée en millisecondes
   * @returns {Promise} Promesse qui rejette après le timeout
   */
  static _timeout(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), ms);
    });
  }

  /**
   * Formate la réponse Google Maps pour correspondre au format Géoportail
   * @private
   * @param {Array} results - Résultats de l'API Google Maps
   * @param {Array} originalCoordinates - Coordonnées d'origine
   * @returns {Object} Données formatées
   */
  static _formatResponse(results, originalCoordinates) {
    if (!results || results.length === 0) {
      throw new Error('Aucune donnée d\'élévation reçue');
    }

    const elevations = results.map(result => ({
      lon: result.location.lng(),
      lat: result.location.lat(),
      z: result.elevation,
      acc: null // Précision non disponible chez Google Maps, contrairement à Géoportail
    }));

    return {
      elevations: elevations
    };
  }
}

export default GoogleElevationAPIService;

