/**
 * Constantes pour le module ProfilAltimetrique
 * @module ProfilAltimetrique/constants
 */

/**
 * Fournisseurs de données altimétriques
 */
export const ELEVATION_PROVIDERS = {
  GEOPORTAIL: 'geoportail',
  GOOGLE: 'google_maps'
};

/**
 * Labels des providers pour affichage
 */
export const PROVIDER_LABELS = {
  [ELEVATION_PROVIDERS.GEOPORTAIL]: 'Géoportail',
  [ELEVATION_PROVIDERS.GOOGLE]: 'Google Maps Elevation'
};

/**
 * Configuration de l'API IGN Géoportail Altimétrie
 */
export const IGN_API_CONFIG = {
  BASE_URL: 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevationLine.json',
  DEFAULT_RESOURCE: 'ign_rge_alti_wld',
  DEFAULT_DELIMITER: '|',
  DEFAULT_SAMPLING: 100,
  MIN_SAMPLING: 2,
  MAX_SAMPLING: 5000,
  PROFILE_MODE: {
    SIMPLE: 'simple',
    ACCURATE: 'accurate'
  },
  TIMEOUT: 30000 // 30 secondes
};

/**
 * Configuration de l'API Google Maps Elevation
 */
export const GOOGLE_ELEVATION_CONFIG = {
  MAX_SAMPLES_PER_REQUEST: 512,
  DEFAULT_SAMPLING: 100,
  TIMEOUT: 30000 // 30 secondes
};

/**
 * Événements personnalisés du module
 */
export const PROFIL_EVENTS = {
  DRAWING_STARTED: 'profil:drawing:started',
  POINT_ADDED: 'profil:point:added',
  DRAWING_COMPLETED: 'profil:drawing:completed',
  DRAWING_CANCELLED: 'profil:drawing:cancelled',
  DATA_LOADED: 'profil:data:loaded',
  SAVED: 'profil:saved',
  SELECTED: 'profil:selected',
  DELETED: 'profil:deleted',
  EXPORTED: 'profil:exported',
  RENAMED: 'profil:renamed',
  MODE_ACTIVATED: 'profil:mode:activated',
  MODE_DEACTIVATED: 'profil:mode:deactivated'
};

/**
 * Styles pour les lignes de dessin - Géoportail (bleu)
 */
export const DRAWING_STYLES = {
  POLYLINE: {
    strokeColor: '#2196F3',
    strokeOpacity: 0.8,
    strokeWeight: 3,
    zIndex: 1000
  },
  TEMPORARY_LINE: {
    strokeColor: '#2196F3',
    strokeOpacity: 0.4,
    strokeWeight: 2,
    zIndex: 999
  },
  MARKER: {
    fillColor: '#2196F3',
    fillOpacity: 1,
    strokeColor: '#FFFFFF',
    strokeWeight: 2,
    scale: 6,
    zIndex: 1001
  },
  HOVER_MARKER: {
    fillColor: '#FF5722',
    fillOpacity: 1,
    strokeColor: '#FFFFFF',
    strokeWeight: 3,
    scale: 8,
    zIndex: 10000
  }
};

/**
 * Styles pour les lignes de dessin - Google Maps (vert)
 */
export const GOOGLE_DRAWING_STYLES = {
  POLYLINE: {
    strokeColor: '#4CAF50',
    strokeOpacity: 0.8,
    strokeWeight: 3,
    zIndex: 1000
  },
  TEMPORARY_LINE: {
    strokeColor: '#4CAF50',
    strokeOpacity: 0.4,
    strokeWeight: 2,
    zIndex: 999
  },
  MARKER: {
    fillColor: '#4CAF50',
    fillOpacity: 1,
    strokeColor: '#FFFFFF',
    strokeWeight: 2,
    scale: 6,
    zIndex: 1001
  },
  HOVER_MARKER: {
    fillColor: '#FF5722',
    fillOpacity: 1,
    strokeColor: '#FFFFFF',
    strokeWeight: 3,
    scale: 8,
    zIndex: 10000
  }
};

/**
 * Configuration du stockage localStorage
 */
export const STORAGE_CONFIG = {
  KEY: 'altimetric_profiles',
  MAX_PROFILES: 20
};

/**
 * Configuration du nommage des profils
 */
export const NAMING_CONFIG = {
  PREFIX: 'Alti-PV',
  MAX_LENGTH: 50
};

/**
 * Messages utilisateur
 */
export const MESSAGES = {
  DRAWING_HELP: 'Cliquez sur la carte pour ajouter des points. Clic droit pour terminer.',
  MIN_POINTS_ERROR: 'Vous devez dessiner au moins 2 points pour créer un profil altimétrique.',
  API_ERROR: 'Erreur lors de la récupération des données altimétriques.',
  NETWORK_ERROR: 'Erreur réseau. Vérifiez votre connexion internet.',
  TIMEOUT_ERROR: 'La requête a pris trop de temps. Veuillez réessayer.',
  STORAGE_FULL: 'Espace de stockage saturé. Supprimez des profils anciens.',
  DELETE_CONFIRMATION: 'Êtes-vous sûr de vouloir supprimer ce profil ?',
  LOADING: 'Récupération du profil altimétrique...'
};

/**
 * Configuration du graphique
 */
export const CHART_CONFIG = {
  TITLE: 'Profil Altimétrique',
  X_AXIS_LABEL: 'Distance (m)',
  Y_AXIS_LABEL: 'Altitude (m)',
  LINE_COLOR: '#2196F3',
  AREA_OPACITY: 0.3,
  CURVE_TYPE: 'function'
};

/**
 * Couleurs pour les onglets selon le provider
 */
export const TAB_COLORS = {
  [ELEVATION_PROVIDERS.GEOPORTAIL]: {
    active: '#2196F3',
    inactive: '#e0e0e0',
    text: '#333'
  },
  [ELEVATION_PROVIDERS.GOOGLE]: {
    active: '#4CAF50',
    inactive: '#e0e0e0',
    text: '#333'
  }
};

/**
 * Couleurs pour les graphiques selon le provider
 */
export const CHART_COLORS = {
  [ELEVATION_PROVIDERS.GEOPORTAIL]: '#2196F3',
  [ELEVATION_PROVIDERS.GOOGLE]: '#4CAF50'
};

/**
 * Obtient les styles de dessin selon le provider
 * @param {string} provider - Provider (geoportail ou google_maps)
 * @returns {Object} Styles de dessin
 */
export function getDrawingStylesForProvider(provider) {
  return provider === ELEVATION_PROVIDERS.GOOGLE ? GOOGLE_DRAWING_STYLES : DRAWING_STYLES;
}

/**
 * Constantes de calcul (formule de Haversine)
 */
export const EARTH_RADIUS = 6371000; // en mètres

/**
 * Configuration du redimensionnement horizontal
 * Note: maxWidth est calculé dynamiquement à 80% de la largeur d'écran dans AltimetricResizeHandler
 */
export const RESIZE_CONFIG = {
  MIN_WIDTH: 300,      // Largeur minimale en pixels
  DEFAULT_WIDTH: 500  // Largeur par défaut en pixels
};

