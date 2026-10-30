/**
 * Service pour interagir avec l'API Data Fair Enedis
 * Gère la récupération des données de lignes Enedis via l'API Data Fair
 */

import { LINES_CONFIG, API_ERROR_MESSAGES, API_URLS } from '../constants.js';

/**
 * Service pour les appels API des lignes Enedis
 * @class LinesAPIService
 */
class LinesAPIService {
  /**
   * Obtient la limite maximale de résultats selon le niveau de zoom
   * @param {number|null} zoom - Niveau de zoom de la carte
   * @returns {number} Limite maximale de résultats
   * @private
   */
  static _getMaxResultsForZoom(zoom) {
    if (!zoom || typeof zoom !== 'number') {
      return LINES_CONFIG.MAX_LINES;
    }

    const zoomLimits = LINES_CONFIG.ZOOM_LIMITS;
    const zoomLevels = Object.keys(zoomLimits).map(Number).sort((a, b) => a - b);

    // Trouver la limite correspondante au zoom actuel
    // Si le zoom est inférieur au plus petit niveau défini, utiliser la plus petite limite
    if (zoom < zoomLevels[0]) {
      return zoomLimits[zoomLevels[0]];
    }

    // Trouver le niveau de zoom le plus proche inférieur ou égal au zoom actuel
    let selectedLimit = zoomLimits[zoomLevels[0]];
    for (const level of zoomLevels) {
      if (zoom >= level) {
        selectedLimit = zoomLimits[level];
      } else {
        break;
      }
    }

    return selectedLimit;
  }

  /**
   * Récupère les lignes dans une bounding box donnée avec pagination automatique
   * Limite le nombre de résultats selon le niveau de zoom pour optimiser les performances
   * @param {google.maps.LatLngBounds} bounds - Limites géographiques de la zone
   * @param {number|null} zoom - Niveau de zoom de la carte (optionnel)
   * @param {string} type - Type de ligne (LIGNE_AERIENNE_HTA, LIGNE_AERIENNE_BT, LIGNE_SOUTERRAINE_HTA, LIGNE_SOUTERRAINE_BT)
   * @returns {Promise<Object>} Format API Data Fair : { total: number, next: string|null, results: Array }
   */
  static async getLinesInBounds(bounds, zoom = null, type) {
    if (!bounds) {
      throw new Error('Bounds requis pour récupérer les lignes');
    }

    if (!type || !API_URLS[type]) {
      throw new Error(`Type de ligne invalide: ${type}`);
    }

    const url = API_URLS[type]; // URL de l'API Data Fair Enedis pour le type de ligne

    // Obtenir la limite maximale selon le zoom
    const maxResults = this._getMaxResultsForZoom(zoom);

    const allResults = [];
    let after = null;
    let pageCount = 0;
    let totalCount = null;

    try {
      while (true) {
        const pageData = await this._fetchSinglePage(bounds, url, after);
        
        if (!pageData || !pageData.results || pageData.results.length === 0) {
          break;
        }

        allResults.push(...pageData.results);
        pageCount++;

        // Stocker le total si disponible
        if (pageData.total !== null && pageData.total !== undefined) {
          totalCount = pageData.total;
        }

        // Arrêter si on a atteint la limite maximale selon le zoom
        if (allResults.length >= maxResults) {
          break;
        }

        // Vérifier si on a récupéré tous les résultats disponibles
        if (totalCount !== null && allResults.length >= totalCount) {
          break;
        }

        // La pagination continue tant qu'il y a un lien "next"
        if (!pageData.next) {
          break;
        }

        // Extraire le paramètre "after" de l'URL next pour la pagination
        try {
          const nextUrl = new URL(pageData.next);
          after = nextUrl.searchParams.get('after');
          
          if (!after) {
            break;
          }
        } catch (urlError) {
          break;
        }
      }

      // Limiter les résultats à maxResults (au cas où on aurait dépassé)
      const limitedResults = allResults.slice(0, maxResults);

      return {
        total: totalCount || limitedResults.length,
        next: null, // Tous les résultats demandés ont été récupérés
        results: limitedResults
      };

    } catch (error) {
      // Si une erreur survient mais qu'on a déjà récupéré des résultats, les retourner
      if (allResults.length > 0) {
        const limitedResults = allResults.slice(0, maxResults);
        return {
          total: totalCount || limitedResults.length,
          next: null,
          results: limitedResults
        };
      }
      throw error;
    }
  }

  /**
   * Récupère une seule page de résultats depuis l'API
   * @param {google.maps.LatLngBounds} bounds - Limites géographiques de la zone
   * @param {string} url - URL de l'API à interroger
   * @param {string|null} after - Paramètre de pagination pour la page suivante
   * @returns {Promise<Object>} Format API Data Fair : { total: number, next: string|null, results: Array }
   * @private
   */
  static async _fetchSinglePage(bounds, url, after = null) {
    // Calculer la bounding box au format API Data Fair (minLon, minLat, maxLon, maxLat)
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const bbox = `${sw.lng()},${sw.lat()},${ne.lng()},${ne.lat()}`;

    // Construire l'URL de l'API Data Fair Enedis
    const apiUrl = new URL(url);
    
    // Paramètres de filtrage géographique pour l'API Data Fair
    apiUrl.searchParams.set('bbox', `${bbox}`);
    
    // Nombre de résultats par page (1000 maximum par page)
    apiUrl.searchParams.set('size', LINES_CONFIG.RESULTS_PER_PAGE.toString());
    
    // Ne récupérer que la géométrie (améliore les performances)
    apiUrl.searchParams.set('select', LINES_CONFIG.GEOMETRY_FIELD_NAME);
    
    // Paramètre de pagination (Data Fair utilise "after" pour la pagination)
    if (after) {
      apiUrl.searchParams.set('after', after);
    }

    try {
      // Requête avec timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 secondes timeout

      const response = await fetch(apiUrl.toString(), {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `Erreur HTTP ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.message) {
            errorMessage = errorData.message;
          } else if (errorData.error_code) {
            errorMessage = `${errorData.error_code}: ${errorData.message || 'Erreur inconnue'}`;
          }
        } catch (parseError) {
          // Si la réponse n'est pas du JSON, utiliser le texte brut
          const errorText = await response.text();
          errorMessage = errorText.substring(0, 200);
        }
        throw new Error(`Erreur HTTP: ${response.status} - ${errorMessage}`);
      }

      const data = await response.json();

      // L'API Data Fair retourne directement le format : { total: ..., next: "...", results: [...] }
      if (!data || typeof data !== 'object') {
        throw new Error(API_ERROR_MESSAGES.INVALID_RESPONSE);
      }

      // Valider que results est un tableau
      if (!data.results || !Array.isArray(data.results)) {
        throw new Error(API_ERROR_MESSAGES.INVALID_RESPONSE);
      }

      return {
        total: data.total || null,
        next: data.next || null,
        results: data.results
      };

    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(API_ERROR_MESSAGES.TIMEOUT_ERROR);
      }
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error(API_ERROR_MESSAGES.NETWORK_ERROR);
      }
      throw error;
    }
  }

  /**
   * Génère une clé de cache à partir d'une bounding box , un niveau de zoom et un type de ligne
   * @param {google.maps.LatLngBounds} bounds - Limites géographiques
   * @param {number|null} zoom - Niveau de zoom
   * @param {string} type - Type de ligne (LIGNE_AERIENNE_HTA, LIGNE_AERIENNE_BT, LIGNE_SOUTERRAINE_HTA, LIGNE_SOUTERRAINE_BT)
   * @returns {string} Clé de cache
   */
  static getCacheKey(bounds, zoom = null, type) {
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    // Arrondir à 4 décimales pour créer des zones de cache cohérentes
    const precision = 4;
    const boundsKey = `${sw.lng().toFixed(precision)},${sw.lat().toFixed(precision)},${ne.lng().toFixed(precision)},${ne.lat().toFixed(precision)}`;
    return zoom !== null ? `${boundsKey}_z${zoom}_${type}` : `${boundsKey}_${type}`;
  }
}

export default LinesAPIService;
