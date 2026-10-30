/**
 * Constantes pour le contrôle d'échelle
 */

export const SCALE_CONSTANTS = {
  // Configuration de l'échelle
  DEFAULT_SCALE: 500,
  
  // Unités
  METERS_PER_PIXEL_AT_ZOOM_0: 156543.03392, // Mètres par pixel au niveau de zoom 0 à l'équateur
  EARTH_CIRCUMFERENCE: 40075017, // Circonférence de la Terre en mètres
  
  // Résolution d'écran pour calcul d'échelle
  // Standard OGC (Open Geospatial Consortium) pour WMS : 0.28 mm/pixel
  PIXEL_SIZE_MM: 0.28, // Taille d'un pixel en millimètres (standard OGC)
  MM_PER_INCH: 25.4,   // Millimètres par pouce
  
  // Style
  CONTAINER_MARGIN: '0.2em',
  INPUT_WIDTH: '120px',
  
  // Validation
  DEBOUNCE_DELAY: 300, // Délai en ms pour le debounce de l'input
};

export const SCALE_STYLES = {
  container: {
    backgroundColor: '#fff',
    border: '2px solid #fff',
    borderRadius: '4px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
    cursor: 'pointer',
    margin: '0.2em',
    marginBottom: '1em',
    padding: '0.1em',
    display: 'flex',
    alignItems: 'center',
    gap: '0.1em',
    fontFamily: 'Roboto, Arial, sans-serif',
    fontSize: '14px',
    transition: 'all 0.3s ease',
  },
  
  label: {
    fontWeight: '700',
    color: '#333',
    userSelect: 'none',
  },
  
  input: {
    border: '1px solid #ddd',
    borderRadius: '3px',
    padding: '0.1em',
    fontSize: '14px',
    width: '3em',
    height: '0.5em',
    textAlign: 'center',
    outline: 'none',
    transition: 'border-color 0.2s ease',
  },
  
  inputFocused: {
    borderColor: '#4285f4',
    boxShadow: '0 0 0 2px rgba(66, 133, 244, 0.1)',
  },
};

