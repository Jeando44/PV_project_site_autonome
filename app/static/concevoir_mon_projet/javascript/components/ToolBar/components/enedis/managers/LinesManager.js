/**
 * Gestionnaire pour l'affichage des lignes Enedis sur la carte
 * Gère le chargement, le cache, et l'affichage des marqueurs
 */

import LinesAPIService from '../services/LinesAPIService.js';
import { LINES_CONFIG, API_ERROR_MESSAGES, ENEDIS_COLORS } from '../constants.js';

/**
 * Gestionnaire des lignes Enedis
 * @class LinesManager
 */
class LinesManager {
  /**
   * @param {Object} options - Options de configuration
   * @param {google.maps.Map} options.map - Instance de la carte Google Maps
   * @param {Function} options.showSpinner - Fonction pour afficher le spinner
   * @param {Function} options.hideSpinner - Fonction pour masquer le spinner
   * @param {Object} options.errorModal - Instance du modal d'erreur
   */
  constructor(options) {
    this.map = options.map;
    this.type = options.type; // Type de ligne (LIGNE_AERIENNE_HTA, LIGNE_AERIENNE_BT, LIGNE_SOUTERRAINE_HTA, LIGNE_SOUTERRAINE_BT)
    this.showSpinner = options.showSpinner;
    this.hideSpinner = options.hideSpinner;
    this.errorModal = options.errorModal;

    // Stockage des lignes
    this.lines = [];
    // Cache des données par bounding box
    this.cache = new Map();
    // Écouteur de mouvement/zoom
    this.moveListener = null;
    
    // État de chargement
    this.isLoading = false;
  }
  /**
   * Active l'affichage des lignes
   */
  async enable() {
    if (!this.map) {
      return;
    }

    if (this.moveListener) {
      return; // Déjà activé
    }
    
    // Vérifier que google.maps.Polyline est disponible
    if (typeof google.maps.Polyline === 'undefined') {
      if (this.errorModal) {
        this.errorModal.show('Erreur : La bibliothèque Google Maps n\'est pas correctement chargée');
      }
      return;
    }
    
    this._setupLocationListener();
    this.updateLines();
  }

  /**
   * Désactive l'affichage des lignes et nettoie le cache
   */
  disable() {
    this._removeLocationListener();
    this.clearLines();
    this.cache.clear();
  }

  /**
   * Configure l'écouteur de mouvement et zoom avec debounce
   * @private
   */
  _setupLocationListener() {
    if (!this.map) {
      return;
    }

    this._removeLocationListener();

    this.moveListener = this.map.addListener('idle', () => {
      this.updateLines();
    });
  }

  /**
   * Supprime l'écouteur de mouvement
   * @private
   */
  _removeLocationListener() {


    if (this.moveListener) {
      google.maps.event.removeListener(this.moveListener);
      this.moveListener = null;
    }
  }

  /**
   * Génère une clé de cache incluant le zoom
   * Le zoom doit déjà être arrondi avant l'appel de cette méthode
   * @param {google.maps.LatLngBounds} bounds - Limites géographiques
   * @param {number|null} zoom - Niveau de zoom (déjà arrondi)
   * @returns {string} Clé de cache
   * @private
   */
  _getCacheKey(bounds, zoom) {
    return LinesAPIService.getCacheKey(bounds, zoom, this.type);
  }

  /**
   * Met à jour l'affichage des lignes selon la zone visible
   */
  async updateLines() {
    if (!this.map) {
      return;
    }

    if (this.isLoading) {
      return; // Éviter les requêtes simultanées
    }

    const bounds = this.map.getBounds();
    if (!bounds) {
      return;
    }

    const rawZoom = this.map.getZoom();
    // Arrondir le zoom à l'entier inférieur pour créer des zones de cache cohérentes
    // et garantir la cohérence entre la clé de cache et l'appel API
    const zoom = rawZoom !== null && rawZoom !== undefined ? Math.floor(rawZoom) : null;

    // Vérifier le cache (incluant le zoom)
    const cacheKey = this._getCacheKey(bounds, zoom);
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < LINES_CONFIG.CACHE_TTL) {
      // Utiliser les données en cache
      this._displayLines(cached.data, this.type);
      return;
    }

    // Charger depuis l'API avec limite selon le zoom (arrondi pour cohérence avec le cache)
    try {
      this.isLoading = true;
      if (this.showSpinner) {
        this.showSpinner();
      }

      const apiData = await LinesAPIService.getLinesInBounds(bounds, zoom, this.type);

      if (!apiData || !apiData.results || apiData.results.length === 0) {
        this.clearLines();
        return;
      }

      // Mettre en cache
      this.cache.set(cacheKey, {
        data: apiData,
        timestamp: Date.now()
      });

      // Afficher les lignes avec viewport culling
        this._displayLines(apiData, this.type);

    } catch (error) {
      if (this.errorModal) {
        this.errorModal.show(error.message || API_ERROR_MESSAGES.API_ERROR);
      }
    } finally {
      this.isLoading = false;
      if (this.hideSpinner) {
        this.hideSpinner();
      }
    }
  }

  /**
   * Obtient les bounds visibles exacts du viewport (plus précis que getBounds())
   * @returns {google.maps.LatLngBounds|null} Bounds du viewport visible
   * @private
   */
  _getVisibleBounds() {
    if (!this.map) {
      return null;
    }

    const bounds = this.map.getBounds();
    if (!bounds) {
      return null;
    }

    // getBounds() retourne déjà les bounds visibles, mais on peut les utiliser directement
    // Pour plus de précision, on pourrait utiliser getDiv() et calculer les coordonnées
    // mais getBounds() est généralement suffisant et performant
    return bounds;
  } 

  /**
   * Parse la géométrie d'un résultat API et extrait les coordonnées complètes
   * Gère les types LineString, Polygon, etc.
   * @param {string} geometryString - Chaîne JSON de la géométrie
   * @returns {Array<Object>|null} Array de positions {lat, lng} ou null si invalide
   * @private
   */
  _parseGeometryCoordinates(geometryString) {
    if (!geometryString || typeof geometryString !== 'string') {
      return null;
    }

    try {
      const geometryObj = JSON.parse(geometryString);
      
      if (!geometryObj || !geometryObj.type || !geometryObj.coordinates) {
        return null;
      }

      const { type, coordinates } = geometryObj;

      // Gérer les différents types de géométries GeoJSON
      switch (type) {

        case 'LineString':
          // Retourner toutes les coordonnées de la ligne
          if (!Array.isArray(coordinates) || coordinates.length === 0) {
            return null;
          }
          return coordinates
            .filter(point => Array.isArray(point) && point.length >= 2)
            .map(point => ({
              lat: point[1],
              lng: point[0]
            }));

        default:
          // Type de géométrie non supporté (GeometryCollection, etc.)
          console.warn(`Type de géométrie non supporté: ${type}`);
          return null;
      }
    } catch (parseError) {
      console.warn('Erreur lors du parsing de la géométrie:', parseError);
      return null;
    }
  }

  /**
   * Affiche les lignes sur la carte avec viewport culling
   * N'affiche que les lignes visibles dans le viewport actuel
   * @param {Object} apiData - Format API Data Fair : { total: number, next: string|null, results: Array }
   * @param {string} type - Type de ligne (LIGNE_AERIENNE_HTA, LIGNE_AERIENNE_BT, LIGNE_SOUTERRAINE_HTA, LIGNE_SOUTERRAINE_BT)
   * @private
   */
  _displayLines(apiData, type) {
    // Nettoyer les lignes existantes
    this.clearLines();

    if (!apiData || !apiData.results || apiData.results.length === 0) {
      return;
    }

    const visibleBounds = this._getVisibleBounds();
    if (!visibleBounds) {
      return;
    }

    // Parser les coordonnées et filtrer les lignes qui intersectent le viewport
    const resultsWithCoordinates = apiData.results
      .map((result) => {
        const coordinates = this._parseGeometryCoordinates(result.geometry);
        return coordinates && coordinates.length > 0 ? { result, coordinates } : null;
      })
      .filter((item) => {
        if (!item) {
          return false;
        }

        // Vérifier si au moins un point de la ligne est dans les bounds visibles
        return item.coordinates.some(coord => {
          const latLng = new google.maps.LatLng(coord.lat, coord.lng);
          return visibleBounds.contains(latLng);
        });
      });

    // Créer uniquement les lignes visibles
    resultsWithCoordinates.forEach(({ coordinates }) => {
      const line = this._createLine(coordinates, type);
      if (line) {
        this.lines.push(line);
      }
    });
  }

  /**
   * Crée une polyline pour une ligne
   * @param {Array<Object>} coordinates - Array de positions {lat, lng}
   * @param {string} type - Type de ligne (LIGNE_AERIENNE_HTA, LIGNE_AERIENNE_BT, LIGNE_SOUTERRAINE_HTA, LIGNE_SOUTERRAINE_BT)
   * @returns {google.maps.Polyline} Ligne créée
   * @private
   */
  _createLine(coordinates, type) {
    try {
      if (!this.map) {
        return null;
      }

      // Vérifier que google.maps.Polyline est disponible
      if (typeof google.maps.Polyline === 'undefined') {
        return null;
      }

      if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
        return null;
      }

      // Convertir les coordonnées en array de LatLng
      const path = coordinates.map(coord => 
        new google.maps.LatLng(coord.lat, coord.lng)
      );

      // Créer la polyline avec le path complet
      const line = new google.maps.Polyline({
        path: path,
        map: this.map,
        strokeColor: ENEDIS_COLORS[type],
        strokeWeight: 3,
        strokeOpacity: 1.0,
      });

      return line;

    } catch (error) {
      console.error('Erreur lors de la création de la ligne:', error);
      return null;
    }
  }

  /**
   * Supprime toutes les lignes de la carte
   */
  clearLines() {
    this.lines.forEach(line => {
      if (line) {
        line.setMap(null);
      }
    });
    this.lines = [];
  }

  /**
   * Nettoie le cache (utile pour libérer la mémoire)
   * @param {number} maxAge - Âge maximum en ms (défaut: CACHE_TTL)
   */
  clearCache(maxAge = LINES_CONFIG.CACHE_TTL) {
    const now = Date.now();
    const keysToDelete = [];

    this.cache.forEach((value, key) => {
      if (now - value.timestamp > maxAge) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Nettoie toutes les ressources
   */
  destroy() {
    this.disable();
    this.clearLines();
  }
}

export default LinesManager;

