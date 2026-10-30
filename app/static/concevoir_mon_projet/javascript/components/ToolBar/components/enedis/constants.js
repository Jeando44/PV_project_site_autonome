/**
 * Constantes de configuration pour l'affichage des points Enedis
 */

export const POINTS_CONFIG = {
  
  // Nombre maximum de points affichés simultanément sur la carte (fallback si zoom non disponible)
  MAX_MARKERS: 1000,
  
  // Limites de résultats selon le niveau de zoom
  // Format: { zoom_level: max_results }
  // Utilisé pour limiter le nombre de résultats récupérés depuis l'API
  ZOOM_LIMITS: {
    6: 500,      // Zoom très faible (vue très large) : 500 marqueurs max
    8: 600,     // Zoom faible : 600 marqueurs max
    10: 900,    // Zoom moyen-faible : 900 marqueurs max
    12: 1200,    // Zoom moyen : 1200 marqueurs max
    14: 1500,    // Zoom élevé : 1500 marqueurs max
    16: 6000,   // Zoom très élevé : 6000 marqueurs max
    18: 10000,    // Zoom maximum : 10000 marqueurs max
    20: 12000    // Zoom maximum : 12000 marqueurs max
  },
  
  // Nombre de résultats par page (limité par l'API Data Fair à 1000)
  RESULTS_PER_PAGE: 1000,
  
  // Durée de validité du cache (1 heure en ms)
  CACHE_TTL: 3600000,
  
  
  // Utiliser le paramètre select pour ne récupérer que la géométrie (améliore les performances)
  // L'API Data Fair Enedis supporte select=geometry
  USE_SELECT_GEOMETRY: true,
  
  // Nom du champ géométrique à utiliser dans le select (geometry pour Data Fair)
  GEOMETRY_FIELD_NAME: 'geometry',
  
  // Taille du marqueur de point (augmentée pour meilleure visibilité)
  MARKER_SIZE: 14,
  
};
/**
 * Constantes de configuration pour l'affichage des lignes Enedis
 */

export const LINES_CONFIG = {
  
  // Nombre maximum de lignes affichées simultanément sur la carte (fallback si zoom non disponible)
  MAX_LINES: 1000,
  
  // Limites de résultats selon le niveau de zoom
  // Format: { zoom_level: max_results }
  // Utilisé pour limiter le nombre de résultats récupérés depuis l'API
  ZOOM_LIMITS: {
    6: 500,      // Zoom très faible (vue très large) : 500 lignes max
    8: 600,     // Zoom faible : 600 lignes max
    10: 900,    // Zoom moyen-faible : 900 lignes max
    12: 1200,    // Zoom moyen : 1200 lignes max
    14: 1500,    // Zoom élevé : 1500 lignes max
    16: 6000,   // Zoom très élevé : 6000 lignes max
    18: 10000,    // Zoom maximum : 10000 lignes max
    20: 12000    // Zoom maximum : 12000 lignes max
  },
  
  // Nombre de résultats par page (limité par l'API Data Fair à 1000)
  RESULTS_PER_PAGE: 1000,
  
  // Durée de validité du cache (1 heure en ms)
  CACHE_TTL: 3600000,
  
  
  // Utiliser le paramètre select pour ne récupérer que la géométrie (améliore les performances)
  // L'API Data Fair Enedis supporte select=geometry
  USE_SELECT_GEOMETRY: true,
  
  // Nom du champ géométrique à utiliser dans le select (geometry pour Data Fair)
  GEOMETRY_FIELD_NAME: 'geometry',
  
  // Taille de la ligne (augmentée pour meilleure visibilité)
  LINE_SIZE: 14,
  
};


export const API_ERROR_MESSAGES = {
  NETWORK_ERROR: 'Erreur de connexion à l\'API Enedis',
  API_ERROR: 'Erreur lors de la récupération des données Enedis',
  TIMEOUT_ERROR: 'Délai d\'attente dépassé pour l\'API Enedis',
  INVALID_RESPONSE: 'Réponse invalide de l\'API Enedis',
  TOO_MANY_RESULTS: 'Trop de points dans cette zone. Veuillez zoomer davantage.'
};

export const ENEDIS_DATASOURCE_TYPES = {
  LIGNE_AERIENNE_HTA: 'LIGNE_AERIENNE_HTA',
  LIGNE_AERIENNE_BT: 'LIGNE_AERIENNE_BT',
  LIGNE_SOUTERRAINE_HTA: 'LIGNE_SOUTERRAINE_HTA',
  LIGNE_SOUTERRAINE_BT: 'LIGNE_SOUTERRAINE_BT',
  POSTE_SOURCE_POINT: 'POSTE_SOURCE_POINT',
  POSTE_HTA_BT_POINT: 'POSTE_HTA_BT_POINT',
  POTEAU_POINT: 'POTEAU_POINT'
};

// Constantes pour les couleurs des indicateurs visuels
export const ENEDIS_COLORS = {
  LIGNE_AERIENNE_HTA: '#FF0000',           // Rouge pour HTA ligne aérienne
  LIGNE_AERIENNE_BT: '#87CEEB',            // Bleu clair pour BT ligne aérienne
  LIGNE_SOUTERRAINE_HTA: '#9370DB',        // Violet clair pour HTA ligne souterraine
  LIGNE_SOUTERRAINE_BT: '#00008B',          // Bleu foncé pour BT ligne souterraine
  POSTE_SOURCE_POINT: '#FF0000',            // Rouge pour point "Postes sources ou HTA/HTA"
  POSTE_HTA_BT_POINT: '#0000FF',           // Bleu pour point "Postes HTA/BT"
  POTEAU_POINT: '#CC7722'                  // Jaune ocre pour point "Poteaux HTA ou BT"
};

export const API_URLS = {
  LIGNE_AERIENNE_HTA: 'https://opendata.enedis.fr/data-fair/api/v1/datasets/reseau-hta/lines',
  LIGNE_AERIENNE_BT: 'https://opendata.enedis.fr/data-fair/api/v1/datasets/reseau-bt/lines',
  LIGNE_SOUTERRAINE_HTA: 'https://opendata.enedis.fr/data-fair/api/v1/datasets/reseau-souterrain-hta/lines',
  LIGNE_SOUTERRAINE_BT: 'https://opendata.enedis.fr/data-fair/api/v1/datasets/reseau-souterrain-bt/lines',
  POSTE_SOURCE_POINT: 'https://opendata.enedis.fr/data-fair/api/v1/datasets/poste-source/lines',
  POSTE_HTA_BT_POINT: 'https://opendata.enedis.fr/data-fair/api/v1/datasets/poste-electrique/lines',
  POTEAU_POINT: 'https://opendata.enedis.fr/data-fair/api/v1/datasets/position-geographique-des-poteaux-hta-et-bt/lines'
};