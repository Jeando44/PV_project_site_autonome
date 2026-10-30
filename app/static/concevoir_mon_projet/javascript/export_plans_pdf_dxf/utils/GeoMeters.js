/**
 * Conversion lon/lat (WGS84) <-> mètres réels locaux (approximation plan tangent,
 * repère Y vers le nord), partagée par tous les plans exportés (situation, masse).
 *
 * IMPORTANT - deux conventions coexistent dans l'application, et il faut relire chaque
 * géométrie avec CELLE qui l'a produite, sinon l'aller-retour local -> lat/lng -> local
 * introduit une erreur d'échelle de 111111/111320 = -0,19 % :
 *  - DEFAULT (111111) : DrawingControl/constants.js::METERS_PER_LAT_DEGREE, utilisé par le
 *    calepinage « grand projet » (drawingControl.drawnShapes, lineToPolygon, polygonPanels,
 *    solarRectangle) ;
 *  - CALEPINAGE (111320) : calepinage_maison_calculs.js::latLngToLocal/localToLatLng, repère
 *    du calepinage sur canevas — c'est DANS CE REPÈRE que l'utilisateur saisit les dimensions
 *    (panneau, espacements, entraxe de shed), donc c'est lui qui fait foi dans les cotations.
 *
 * Bug corrigé (DXF plan de masse) : tout était relu en 111111, un panneau 1762x1134 posé en
 * portrait sur 15° de pente ressortait 1,6988 x 1,1319 m au lieu de 1,702 x 1,134, et un
 * entraxe de shed saisi à 2,50 m ressortait 2,4953 m.
 */
const METERS_PER_LAT_DEGREE = 111111;
const CALEPINAGE_METERS_PER_LAT_DEGREE = 111320;

/**
 * Précision d'écriture du fond cadastral en DXF : le millimètre (unités DXF = mètres). Ne sert
 * qu'à couper le bruit flottant de la reprojection de parcelles dont la précision réelle est
 * décimétrique. La géométrie COTÉE (implantation, panneaux) n'est jamais arrondie : caler un
 * panneau sur le millimètre décalerait d'autant l'entraxe des rangées (cf. PanelsExtent).
 */
const DXF_DECIMALS = 3;

export default class GeoMeters {
  static METERS_PER_LAT_DEGREE = METERS_PER_LAT_DEGREE;
  static CALEPINAGE_METERS_PER_LAT_DEGREE = CALEPINAGE_METERS_PER_LAT_DEGREE;
  static DXF_DECIMALS = DXF_DECIMALS;

  /** Point (lon,lat) -> mètres réels locaux, origine = (lat0, lng0). */
  static lonLatToLocalMeters(lon, lat, lat0, lng0, metersPerLat = METERS_PER_LAT_DEGREE) {
    const x = (lon - lng0) * metersPerLat * Math.cos((lat0 * Math.PI) / 180);
    const y = (lat - lat0) * metersPerLat;
    return { x, y };
  }

  /** Offset réel (mètres) de `to` par rapport à `from`, deux points {lat,lng}. */
  static offsetMeters(from, to, metersPerLat = METERS_PER_LAT_DEGREE) {
    return this.lonLatToLocalMeters(to.lng, to.lat, from.lat, from.lng, metersPerLat);
  }

  /**
   * Arrondi « commercial » (moitié vers le haut en valeur absolue, comme attendu sur les
   * cotations : >= 5 à la décimale suivante -> unité supérieure) — Math.round() seul arrondit
   * -0,0005 vers 0 et casserait la symétrie d'un panneau à cheval sur l'origine du repère.
   */
  static roundHalfUp(value, decimals = DXF_DECIMALS) {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** decimals;
    return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  }

  /** Arrondit un contour [{x,y}] à la précision d'écriture DXF (fond cadastral uniquement). */
  static roundPolygon(points, decimals = DXF_DECIMALS) {
    return points.map((p) => ({
      x: this.roundHalfUp(p.x, decimals),
      y: this.roundHalfUp(p.y, decimals),
    }));
  }
}
