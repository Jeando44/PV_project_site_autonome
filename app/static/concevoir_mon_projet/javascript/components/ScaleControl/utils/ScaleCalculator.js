import { SCALE_CONSTANTS } from '../constants.js';

/**
 * Utilitaire pour calculer l'échelle de la carte
 */
export default class ScaleCalculator {
  /**
   * Calcule le dénominateur de l'échelle en fonction du niveau de zoom et de la latitude
   * @param {number} zoom - Niveau de zoom de la carte
   * @param {number} latitude - Latitude du centre de la carte
   * @returns {number} Le dénominateur de l'échelle (ex: 366 pour 1/366)
   */
  static calculateScale(zoom, latitude) {
    // Résolution en mètres par pixel au niveau de zoom donné
    const metersPerPixel = this.getMetersPerPixel(zoom, latitude);
    
    // Utilisation du standard OGC (Open Geospatial Consortium) pour les cartes
    // Standard OGC : 0.28 mm par pixel (comme utilisé par Géoportail, IGN, etc.)
    const pixelSizeMeters = SCALE_CONSTANTS.PIXEL_SIZE_MM / 1000; // Convertir mm en mètres
    
    // Calcul de l'échelle
    // Échelle = (distance réelle en mètres) / (distance sur écran en mètres)
    const scale = Math.round(metersPerPixel / pixelSizeMeters);
    
    return scale;
  }

  /**
   * Calcule les mètres par pixel pour un niveau de zoom et une latitude donnés
   * @param {number} zoom - Niveau de zoom
   * @param {number} latitude - Latitude
   * @returns {number} Mètres par pixel
   */
  static getMetersPerPixel(zoom, latitude) {
    const metersPerPixel = 
      (SCALE_CONSTANTS.EARTH_CIRCUMFERENCE * Math.cos(latitude * Math.PI / 180)) / 
      Math.pow(2, zoom + 8);
    
    return metersPerPixel;
  }

  /**
   * Calcule le niveau de zoom nécessaire pour obtenir une échelle donnée
   * @param {number} targetScale - Échelle cible (dénominateur, ex: 500 pour 1/500)
   * @param {number} latitude - Latitude du centre de la carte
   * @returns {number} Niveau de zoom nécessaire (avec décimales pour plus de précision)
   */
  static calculateZoomForScale(targetScale, latitude) {
    // Utilisation du standard OGC
    const pixelSizeMeters = SCALE_CONSTANTS.PIXEL_SIZE_MM / 1000; // Convertir mm en mètres
    
    // Mètres par pixel cible (inverse de la formule de calculateScale)
    const targetMetersPerPixel = targetScale * pixelSizeMeters;
    
    // Calcul du zoom nécessaire
    const zoom = Math.log2(
      (SCALE_CONSTANTS.EARTH_CIRCUMFERENCE * Math.cos(latitude * Math.PI / 180)) /
      (targetMetersPerPixel * 256)
    );
    
    // Retourner le zoom avec décimales pour permettre des échelles précises
    // Google Maps supporte les zooms fractionnaires jusqu'à 25
    return Math.max(0, Math.min(25, zoom));
  }

  /**
   * Valide une valeur d'échelle
   * @param {number} scale - Valeur d'échelle à valider
   * @returns {boolean} True si la valeur est valide
   */
  static isValidScale(scale) {
    return (
      typeof scale === 'number' &&
      !isNaN(scale) &&
      scale > 0 // Accepte toutes les échelles positives
    );
  }

  /**
   * Formate une valeur d'échelle pour l'affichage
   * @param {number} scale - Valeur d'échelle
   * @returns {string} Échelle formatée (ex: "1/366")
   */
  static formatScale(scale) {
    return `1/${Math.round(scale)}`;
  }

  /**
   * Parse une valeur d'échelle depuis une chaîne
   * @param {string} value - Valeur à parser
   * @returns {number|null} Valeur d'échelle ou null si invalide
   */
  static parseScale(value) {
    // Supprimer les espaces et le préfixe "1/" si présent
    const cleaned = String(value).trim().replace(/^1\//, '');
    
    // Extraire uniquement les chiffres
    const numbers = cleaned.match(/\d+/);
    if (!numbers) return null;
    
    const scale = parseInt(numbers[0], 10);
    
    return this.isValidScale(scale) ? scale : null;
  }
}

