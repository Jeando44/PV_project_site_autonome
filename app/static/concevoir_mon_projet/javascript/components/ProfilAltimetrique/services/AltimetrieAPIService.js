import { IGN_API_CONFIG, MESSAGES } from '../constants.js';

/**
 * Service pour interagir avec l'API IGN Géoportail Altimétrie
 * @class AltimetrieAPIService
 */
class AltimetrieAPIService {
  /**
   * Récupère le profil altimétrique pour une ligne de coordonnées
   * @param {Array<{lat: number, lng: number}>} coordinates - Tableau de coordonnées
   * @param {Object} options - Options de la requête
   * @param {number} options.sampling - Nombre de points d'échantillonnage (2-5000)
   * @param {string} options.profileMode - Mode de profil ('simple' ou 'accurate')
   * @returns {Promise<Object>} Données altimétriques
   */
  static async getElevationLine(coordinates, options = {}) {
    // Validation
    if (!coordinates || coordinates.length < 2) {
      throw new Error(MESSAGES.MIN_POINTS_ERROR);
    }

    if (coordinates.length > IGN_API_CONFIG.MAX_SAMPLING) {
      throw new Error(`Le nombre maximum de points est ${IGN_API_CONFIG.MAX_SAMPLING}.`);
    }

    const {
      sampling = IGN_API_CONFIG.DEFAULT_SAMPLING,
      profileMode = IGN_API_CONFIG.PROFILE_MODE.ACCURATE
    } = options;

    // Construction de l'URL
    const url = this._buildURL(coordinates, sampling, profileMode);

    try {
      // Requête avec timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), IGN_API_CONFIG.TIMEOUT);

      const response = await fetch(url, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Erreur HTTP: ${response.status}`);
      }

      const data = await response.json();
      
      // Validation de la réponse
      if (!data || !data.elevations || !Array.isArray(data.elevations)) {
        throw new Error('Format de réponse invalide');
      }

      return data;

    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(MESSAGES.TIMEOUT_ERROR);
      }
      if (error.message.includes('HTTP')) {
        throw new Error(MESSAGES.API_ERROR);
      }
      if (error.message.includes('Failed to fetch')) {
        throw new Error(MESSAGES.NETWORK_ERROR);
      }
      throw error;
    }
  }

  /**
   * Construit l'URL de l'API avec les paramètres
   * @private
   * @param {Array<{lat: number, lng: number}>} coordinates - Coordonnées
   * @param {number} sampling - Échantillonnage
   * @param {string} profileMode - Mode de profil
   * @returns {string} URL complète
   */
  static _buildURL(coordinates, sampling, profileMode) {
    const lons = coordinates.map(coord => coord.lng).join(IGN_API_CONFIG.DEFAULT_DELIMITER);
    const lats = coordinates.map(coord => coord.lat).join(IGN_API_CONFIG.DEFAULT_DELIMITER);

    const params = new URLSearchParams({
      lon: lons,
      lat: lats,
      resource: IGN_API_CONFIG.DEFAULT_RESOURCE,
      delimiter: IGN_API_CONFIG.DEFAULT_DELIMITER,
      sampling: sampling.toString(),
      profile_mode: profileMode
    });

    return `${IGN_API_CONFIG.BASE_URL}?${params.toString()}`;
  }
}

export default AltimetrieAPIService;

