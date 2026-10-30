/**
 * Point d'entrée du module ProfilAltimetrique
 * @module ProfilAltimetrique
 */

// Core
export { default as ProfilAltimetriqueControl } from './core/ProfilAltimetriqueControl.js';
export { default as ProfilAltimetriqueManager } from './core/ProfilAltimetriqueManager.js';

// Handlers
export { default as DrawingHandler } from './handlers/DrawingHandler.js';
export { default as ChartHandler } from './handlers/ChartHandler.js';
export { default as AltimetricResizeHandler } from './handlers/AltimetricResizeHandler.js';

// Utils
export { default as CalculationUtils } from './utils/CalculationUtils.js';
export { default as GeometryUtils } from './utils/GeometryUtils.js';
export { default as DOMUtils } from './utils/DOMUtils.js';

// Services
export { default as AltimetrieAPIService } from './services/AltimetrieAPIService.js';
export { default as GoogleElevationAPIService } from './services/GoogleElevationAPIService.js';

// Constants
export * from './constants.js';

