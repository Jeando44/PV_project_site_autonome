/**
 * Gestionnaire pour l'affichage des Points Enedis sur la carte
 * Gère le chargement, le cache, et l'affichage des marqueurs
 */

import PointsAPIService from '../services/PointsAPIService.js';
import { POINTS_CONFIG, API_ERROR_MESSAGES, ENEDIS_COLORS } from '../constants.js';

/**
 * Gestionnaire des points Enedis
 * @class PointsManager
 */
class PointsManager {
  /**
   * @param {Object} options - Options de configuration
   * @param {google.maps.Map} options.map - Instance de la carte Google Maps
   * @param {Function} options.showSpinner - Fonction pour afficher le spinner
   * @param {Function} options.hideSpinner - Fonction pour masquer le spinner
   * @param {Object} options.errorModal - Instance du modal d'erreur
   */
  constructor(options) {
    this.map = options.map;
    this.type = options.type; // Type de point (LIGNE_AERIENNE_HTA, LIGNE_AERIENNE_BT, LIGNE_SOUTERRAINE_HTA, LIGNE_SOUTERRAINE_BT, POSTE_SOURCE_POINT, POSTE_HTA_BT_POINT, POTEAU_POINT)
    this.showSpinner = options.showSpinner;
    this.hideSpinner = options.hideSpinner;
    this.errorModal = options.errorModal;

    // Stockage des marqueurs
    this.markers = [];
    
    // Cache des données par bounding box
    this.cache = new Map();
    
    // Écouteur de mouvement/zoom
    this.moveListener = null;
    
    // État de chargement
    this.isLoading = false;
    
    // Bibliothèque marker (chargée de manière asynchrone)
    this.markerLibraryLoaded = false;
    this.markerLibraryPromise = null;
  }

  /**
   * Charge la bibliothèque marker si nécessaire
   * @returns {Promise<void>}
   * @private
   */
  async _ensureMarkerLibrary() {
    if (this.markerLibraryLoaded) {
      return;
    }

    if (this.markerLibraryPromise) {
      return this.markerLibraryPromise;
    }

    this.markerLibraryPromise = (async () => {
      try {
        const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

        this.AdvancedMarkerElement = AdvancedMarkerElement;
        this.markerLibraryLoaded = true;
      } catch (error) {
        throw error;
      }
    })();

    return this.markerLibraryPromise;
  }

  /**
   * Active l'affichage des Points
   */
  async enable() {
    if (!this.map) {
      return;
    }

    if (this.moveListener) {
      return; // Déjà activé
    }
    
    // S'assurer que la bibliothèque marker est chargée
    try {
      await this._ensureMarkerLibrary();
    } catch (error) {
      if (this.errorModal) {
        this.errorModal.show('Erreur lors du chargement de la bibliothèque de marqueurs Google Maps');
      }
      return;
    }
    
    this._setupLocationListener();
    this.updatePoints();
  }

  /**
   * Désactive l'affichage des Points et nettoie le cache
   */
  disable() {
    this._removeLocationListener();
    this.clearPoints();
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
      this.updatePoints();
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
    return PointsAPIService.getCacheKey(bounds, zoom, this.type);
  }

  /**
   * Met à jour l'affichage des Points selon la zone visible
   */
  async updatePoints() {
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
    
    if (cached && Date.now() - cached.timestamp < POINTS_CONFIG.CACHE_TTL) {
      // Utiliser les données en cache
      this._displayPoints(cached.data, this.type);
      return;
    }

    // Charger depuis l'API avec limite selon le zoom (arrondi pour cohérence avec le cache)
    try {
      this.isLoading = true;
      if (this.showSpinner) {
        this.showSpinner();
      }

      const apiData = await PointsAPIService.getPointsInBounds(bounds, zoom, this.type);

      if (!apiData || !apiData.results || apiData.results.length === 0) {
        this.clearPoints();
        return;
      }

      // Mettre en cache
      this.cache.set(cacheKey, {
        data: apiData,
        timestamp: Date.now()
      });

      // Afficher les Points avec viewport culling
      this._displayPoints(apiData, this.type);

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
   * Parse la géométrie d'un résultat API et extrait une position
   * Gère les types Point, MultiPoint, Polygon, LineString, etc.
   * Pour les géométries complexes, extrait le centroïde ou le premier point
   * @param {string} geometryString - Chaîne JSON de la géométrie
   * @returns {Object|null} Position {lat, lng} ou null si invalide
   * @private
   */
  _parseGeometry(geometryString) {
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
        case 'Point':
          if (!Array.isArray(coordinates) || coordinates.length < 2) {
            return null;
          }
          return {
            lat: coordinates[1],
            lng: coordinates[0]
          };

        case 'MultiPoint':
          // Prendre le premier point du MultiPoint
          if (!Array.isArray(coordinates) || coordinates.length === 0) {
            return null;
          }
          const firstPoint = coordinates[0];
          if (!Array.isArray(firstPoint) || firstPoint.length < 2) {
            return null;
          }
          return {
            lat: firstPoint[1],
            lng: firstPoint[0]
          };

        case 'LineString':
          // Prendre le point médian de la ligne
          if (!Array.isArray(coordinates) || coordinates.length === 0) {
            return null;
          }
          const midIndex = Math.floor(coordinates.length / 2);
          const midPoint = coordinates[midIndex];
          if (!Array.isArray(midPoint) || midPoint.length < 2) {
            return null;
          }
          return {
            lat: midPoint[1],
            lng: midPoint[0]
          };

        case 'Polygon':
          // Extraire le centroïde du premier ring (exterior ring)
          if (!Array.isArray(coordinates) || coordinates.length === 0) {
            return null;
          }
          const exteriorRing = coordinates[0];
          if (!Array.isArray(exteriorRing) || exteriorRing.length === 0) {
            return null;
          }
          // Calculer le centroïde simple (moyenne des coordonnées)
          let latSum = 0;
          let lngSum = 0;
          let pointCount = 0;
          exteriorRing.forEach(point => {
            if (Array.isArray(point) && point.length >= 2) {
              lngSum += point[0];
              latSum += point[1];
              pointCount++;
            }
          });
          if (pointCount === 0) {
            return null;
          }
          return {
            lat: latSum / pointCount,
            lng: lngSum / pointCount
          };

        case 'MultiPolygon':
        case 'MultiLineString':
          // Prendre le centroïde du premier élément
          if (!Array.isArray(coordinates) || coordinates.length === 0) {
            return null;
          }
          // Récurser sur le premier élément (qui sera un Polygon ou LineString)
          const firstElement = coordinates[0];
          const tempGeometry = { type: type === 'MultiPolygon' ? 'Polygon' : 'LineString', coordinates: firstElement };
          return this._parseGeometry(JSON.stringify(tempGeometry));

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
   * Affiche les Points sur la carte avec viewport culling
   * N'affiche que les marqueurs visibles dans le viewport actuel
   * @param {Object} apiData - Format API Data Fair : { total: number, next: string|null, results: Array }
   * @param {string} type - Type de point (LIGNE_AERIENNE_HTA, LIGNE_AERIENNE_BT, LIGNE_SOUTERRAINE_HTA, LIGNE_SOUTERRAINE_BT, POSTE_SOURCE_POINT, POSTE_HTA_BT_POINT, POTEAU_POINT)
   * @private
   */
  _displayPoints(apiData, type) {
    // Nettoyer les marqueurs existants
    this.clearPoints();

    if (!apiData || !apiData.results || apiData.results.length === 0) {
      return;
    }

    const visibleBounds = this._getVisibleBounds();
    if (!visibleBounds) {
      return;
    }

    // Parser et filtrer en une seule passe pour optimiser les performances
    // Stocker les positions parsées avec leurs résultats pour éviter le double parsing
    const resultsWithPositions = apiData.results
      .map((result) => {
        const position = this._parseGeometry(result.geometry);
        return position ? { result, position } : null;
      })
      .filter((item) => {
        if (!item) {
          return false;
        }

        // Vérifier si le point est dans les bounds visibles
        const latLng = new google.maps.LatLng(item.position.lat, item.position.lng);
        return visibleBounds.contains(latLng);
      });

    // Créer uniquement les marqueurs visibles (position déjà parsée)
    resultsWithPositions.forEach(({ position }) => {
      const marker = this._createMarker(position, type);
      if (marker) {
        this.markers.push(marker);
      }
    });
  }

  /**
   * Crée un marqueur AdvancedMarkerElement pour un poteau
   * @param {Object} position - Position {lat, lng}
   * @param {string} type - Type de point (LIGNE_AERIENNE_HTA, LIGNE_AERIENNE_BT, LIGNE_SOUTERRAINE_HTA, LIGNE_SOUTERRAINE_BT, POSTE_SOURCE_POINT, POSTE_HTA_BT_POINT, POTEAU_POINT)
   * @returns {google.maps.marker.AdvancedMarkerElement} Marqueur créé
   * @private
   */
  _createMarker(position, type) {
    try {
      if (!this.map) {
        return null;
      }

      // Vérifier que google.maps.marker est disponible
      if (!this.AdvancedMarkerElement) {
        return null;
      }

      // Créer un élément DOM rond simple pour le marqueur
      const markerDiv = document.createElement('div');
      markerDiv.setAttribute('data-marker-type', type);
      markerDiv.style.cssText = `
        width: ${POINTS_CONFIG.MARKER_SIZE}px;
        height: ${POINTS_CONFIG.MARKER_SIZE}px;
        border-radius: 50%;
        background-color: ${ENEDIS_COLORS[type]};
        border: 2px solid white;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
        cursor: pointer;
        display: block;
      `;

      // Créer un LatLng pour AdvancedMarkerElement
      const latLng = new google.maps.LatLng(position.lat, position.lng);

      // Créer le marqueur AdvancedMarkerElement avec l'élément DOM rond
      const marker = new this.AdvancedMarkerElement({
        position: latLng,
        content: markerDiv,
        map: this.map,
        title: `${type} Enedis`
      });

      return marker;

    } catch (error) {
      return null;
    }
  }

  /**
   * Supprime tous les marqueurs de la carte
   */
  clearPoints() {
    this.markers.forEach(marker => {
      if (marker && marker.map) {
        marker.map = null;
      }
    });
    this.markers = [];
  }

  /**
   * Nettoie le cache (utile pour libérer la mémoire)
   * @param {number} maxAge - Âge maximum en ms (défaut: CACHE_TTL)
   */
  clearCache(maxAge = POINTS_CONFIG.CACHE_TTL) {
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
    this.clearPoints();
  }
}

export default PointsManager;

