import { EARTH_RADIUS } from '../constants.js';

/**
 * Utilitaires de calcul pour les profils altimétriques
 * @class CalculationUtils
 */
class CalculationUtils {
  /**
   * Calcule la distance entre deux points avec la formule de Haversine
   * @param {Object} point1 - Premier point {lat, lng}
   * @param {Object} point2 - Deuxième point {lat, lng}
   * @returns {number} Distance en mètres
   */
  static calculateDistance(point1, point2) {
    const lat1Rad = this._toRadians(point1.lat);
    const lat2Rad = this._toRadians(point2.lat);
    const deltaLat = this._toRadians(point2.lat - point1.lat);
    const deltaLng = this._toRadians(point2.lng - point1.lng);

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1Rad) * Math.cos(lat2Rad) *
              Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS * c;
  }

  /**
   * Calcule la distance totale et les distances cumulatives
   * @param {Array<Object>} elevations - Points avec {lat, lon, z}
   * @returns {Array<number>} Distances cumulatives en mètres
   */
  static calculateCumulativeDistances(elevations) {
    const distances = [0];
    let totalDistance = 0;

    for (let i = 1; i < elevations.length; i++) {
      const point1 = { lat: elevations[i - 1].lat, lng: elevations[i - 1].lon };
      const point2 = { lat: elevations[i].lat, lng: elevations[i].lon };
      
      const segmentDistance = this.calculateDistance(point1, point2);
      totalDistance += segmentDistance;
      distances.push(totalDistance);
    }

    return distances;
  }

  /**
   * Calcule la pente entre deux points
   * @param {number} elevation1 - Altitude du point 1 (m)
   * @param {number} elevation2 - Altitude du point 2 (m)
   * @param {number} distance - Distance horizontale (m)
   * @returns {number} Pente en pourcentage
   */
  static calculateSlope(elevation1, elevation2, distance) {
    if (distance === 0) return 0;
    const elevationDiff = elevation2 - elevation1;
    return (elevationDiff / distance) * 100;
  }

  /**
   * Calcule le dénivelé positif total
   * @param {Array<number>} elevations - Altitudes
   * @returns {number} Dénivelé positif en mètres
   */
  static calculatePositiveElevationGain(elevations) {
    let gain = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff > 0) {
        gain += diff;
      }
    }
    return gain;
  }

  /**
   * Calcule le dénivelé négatif total
   * @param {Array<number>} elevations - Altitudes
   * @returns {number} Dénivelé négatif en mètres (valeur positive)
   */
  static calculateNegativeElevationGain(elevations) {
    let loss = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff < 0) {
        loss += Math.abs(diff);
      }
    }
    return loss;
  }

  /**
   * Calcule la pente moyenne sur tout le profil
   * @param {Array<Object>} points - Points avec distance et altitude
   * @returns {number} Pente moyenne en pourcentage
   */
  static calculateAverageSlope(points) {
    if (points.length < 2) return 0;
    
    const totalDistance = points[points.length - 1].distance;
    const elevationDiff = points[points.length - 1].altitude - points[0].altitude;
    
    if (totalDistance === 0) return 0;
    return (elevationDiff / totalDistance) * 100;
  }

  /**
   * Trouve la pente maximale (en valeur absolue)
   * @param {Array<Object>} points - Points avec distance et altitude
   * @returns {number} Pente maximale en pourcentage
   */
  static calculateMaxSlope(points) {
    let maxSlope = 0;
    
    for (let i = 1; i < points.length; i++) {
      const distance = points[i].distance - points[i - 1].distance;
      const slope = this.calculateSlope(
        points[i - 1].altitude,
        points[i].altitude,
        distance
      );
      
      if (Math.abs(slope) > Math.abs(maxSlope)) {
        maxSlope = slope;
      }
    }
    
    return maxSlope;
  }

  /**
   * Formate les données de l'API en format utilisable
   * @param {Object} apiResponse - Réponse de l'API IGN
   * @returns {Object} Données formatées avec statistiques
   */
  static formatProfileData(apiResponse) {
    const { elevations } = apiResponse;
    
    // Calculer les distances cumulatives
    const distances = this.calculateCumulativeDistances(elevations);
    
    // Créer les points formatés
    const points = elevations.map((point, index) => ({
      lat: point.lat,
      lon: point.lon,
      altitude: point.z,
      distance: distances[index],
      slope: index > 0 
        ? this.calculateSlope(
            elevations[index - 1].z,
            point.z,
            distances[index] - distances[index - 1]
          )
        : 0
    }));

    // Calculer les statistiques
    const altitudes = elevations.map(e => e.z);
    const totalDistance = distances[distances.length - 1];
    const positiveElevation = this.calculatePositiveElevationGain(altitudes);
    const negativeElevation = this.calculateNegativeElevationGain(altitudes);
    const averageSlope = this.calculateAverageSlope(points);
    const maxSlope = this.calculateMaxSlope(points);

    return {
      points,
      stats: {
        totalDistance,
        positiveElevation,
        negativeElevation,
        averageSlope,
        maxSlope,
        minAltitude: Math.min(...altitudes),
        maxAltitude: Math.max(...altitudes)
      }
    };
  }

  /**
   * Convertit des degrés en radians
   * @private
   * @param {number} degrees - Angle en degrés
   * @returns {number} Angle en radians
   */
  static _toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }
}

export default CalculationUtils;

