import GeoMeters from './GeoMeters.js';

/**
 * Étendue (bounds/centre) des formes de calepinage dessinées (toitures/ombrières
 * portant les panneaux).
 *
 * Source primaire : les formes VIVANTES sur la carte (window.drawingControl.drawnShapes,
 * chaque forme étant un google.maps.Polygon avec .getPath()) - fiable immédiatement après
 * un dessin, sans dépendre du délai de l'auto-save localStorage (StorageManager, ~3s, ou
 * déclenché par évènement SHAPE_ADDED qui peut être en retard d'un cycle si le pvId n'est
 * pas encore assigné).
 * Repli : localStorage['solarProjectData'].shapes[pvId].points (StorageManager.
 * collectShapesData persiste sous la clé "points", PAS "coordinates").
 */
export default class PanelsExtent {
  /**
   * @returns {Array<Array<{lat:number,lng:number}>>} liste de contours (un par forme dessinée)
   *
   * Inclut les champs PV du calepinage sur canevas (résidentiel / professionnel,
   * window.CalepinageMaisonPlans) : absents de drawingControl.drawnShapes, ils étaient ignorés
   * (plan de masse refusé, plan de situation non centré sur les panneaux).
   */
  static getShapesLatLng() {
    const canevas = this._getCanvasFields().map((champ) => champ.contour).filter((points) => points.length >= 3);
    const live = this._getShapesFromLiveMap();
    if (live.length) return live.concat(canevas);
    return this._getShapesFromStorage().concat(canevas);
  }

  static _getCanvasFields() {
    try {
      const plans = window.CalepinageMaisonPlans;
      return plans && typeof plans.getChamps === 'function' ? plans.getChamps() : [];
    } catch (e) {
      console.warn('[PanelsExtent] Champs PV du calepinage sur canevas indisponibles:', e);
      return [];
    }
  }

  /**
   * Rectangles des panneaux (un tableau de 4 sommets {lat,lng} par panneau) : panneaux du calepinage
   * sur canevas + panneaux des formes grand projet déjà posés sur la carte.
   */
  static getPanelsLatLng() {
    const panneaux = [];
    this._getCanvasFields().forEach((champ) => panneaux.push(...champ.panneaux));
    return panneaux.concat(this._getDrawingControlPanelsLatLng());
  }

  /** Panneaux déjà posés sur la carte par le calepinage « grand projet » (convention DrawingControl). */
  static _getDrawingControlPanelsLatLng() {
    const panneaux = [];
    const dc = window.drawingControl;
    if (!dc) return panneaux;
    [dc.lineToPolygon, dc.polygonPanels, dc.solarRectangle].filter(Boolean).forEach((mgr) => {
      if (!mgr.createdPanelsByShape) return;
      mgr.createdPanelsByShape.forEach((overlays) => {
        (overlays || []).forEach((overlay) => {
          if (!overlay || typeof overlay.getPath !== 'function') return;
          const points = [];
          overlay.getPath().forEach((p) => points.push({ lat: p.lat(), lng: p.lng() }));
          if (points.length >= 3) panneaux.push(points);
        });
      });
    });
    return panneaux;
  }

  static _getShapesFromLiveMap() {
    const dc = window.drawingControl;
    if (!dc || !Array.isArray(dc.drawnShapes)) return [];
    const shapes = [];
    dc.drawnShapes.forEach((shape) => {
      if (!shape || typeof shape.getPath !== 'function') return;
      const path = shape.getPath();
      if (!path) return;
      const points = [];
      path.forEach((point) => points.push({ lat: point.lat(), lng: point.lng() }));
      if (points.length >= 3) shapes.push(points);
    });
    return shapes;
  }

  static _getShapesFromStorage() {
    try {
      const raw = localStorage.getItem('solarProjectData');
      if (!raw) return [];
      const data = JSON.parse(raw);
      if (!data.shapes) return [];
      return Object.values(data.shapes)
        .map((shape) => shape.points || [])
        .filter((points) => points.length >= 3);
    } catch (e) {
      console.warn('[PanelsExtent] Lecture de solarProjectData impossible:', e);
      return [];
    }
  }

  /**
   * Coins d'un panneau reconstruits depuis sa géométrie exacte du canevas ({cx, cy, w, l, angle},
   * mètres) — même convention de rotation que calepinage_maison_calculs.js::rotateAroundOrigin.
   *
   * AUCUN arrondi ici, volontairement : caler les cotes sur le millimètre rend bien le panneau
   * « rond » (1,702 m) mais décale alors l'entraxe des rangées du même reliquat (un espacement de
   * shed saisi à 2,50 m ressortait 2,5001 m), puisque pas de rangée = profondeur projetée +
   * espacement, et que la profondeur projetée (1762 x cos 15° = 1701,9613 mm) n'est pas un nombre
   * entier de millimètres. En gardant la valeur exacte, les DEUX se lisent juste : 1701,96 mm
   * (= 1702 mm au millimètre près) et 2,500000 m.
   */
  static _panelCornersFromLocal(panel, offsetX, offsetY) {
    const cx = panel.cx + offsetX;
    const cy = panel.cy + offsetY;
    const hw = panel.w / 2;
    const hl = panel.l / 2;
    const cosA = Math.cos(panel.angle || 0);
    const sinA = Math.sin(panel.angle || 0);
    return [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([x, y]) => ({
      x: cx + x * cosA - y * sinA,
      y: cy + x * sinA + y * cosA,
    }));
  }

  /**
   * Géométrie des plans EXPORTÉS (DXF), en mètres réels, dans un repère centré sur `origin`
   * ({lat, lng}), +x = Est, +y = Nord.
   *
   * Chaque source est relue avec LA convention lat/lng <-> mètres qui l'a produite (cf. GeoMeters) :
   * mélanger les deux introduisait une erreur d'échelle de -0,19 % sur toutes les cotes.
   * Pour le calepinage sur canevas on court-circuite même complètement l'aller-retour
   * géographique : les panneaux sont rebâtis depuis leurs dimensions exactes, seule la position
   * du champ passe par la conversion.
   *
   * @returns {{implantation: Array<Array<{x:number,y:number}>>, panneaux: Array<Array<{x:number,y:number}>>}}
   */
  static getExportGeometryMeters(origin) {
    const CALEP = GeoMeters.CALEPINAGE_METERS_PER_LAT_DEGREE;
    const implantation = [];
    const panneaux = [];

    this._getCanvasFields().forEach((champ) => {
      // Repli (module de calepinage plus ancien en cache) : l'aller-retour lat/lng reste correct
      // tant qu'il est relu avec la constante du calepinage.
      if (!champ.origin || !champ.contourLocal || !champ.panneauxLocaux) {
        if ((champ.contour || []).length >= 3) {
          implantation.push(champ.contour.map((c) => GeoMeters.offsetMeters(origin, c, CALEP)));
        }
        (champ.panneaux || []).forEach((coins) => {
          panneaux.push(coins.map((c) => GeoMeters.offsetMeters(origin, c, CALEP)));
        });
        return;
      }
      const offset = GeoMeters.offsetMeters(origin, champ.origin, CALEP);
      if (champ.contourLocal.length >= 3) {
        implantation.push(champ.contourLocal.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })));
      }
      champ.panneauxLocaux.forEach((panel) => {
        panneaux.push(this._panelCornersFromLocal(panel, offset.x, offset.y));
      });
    });

    // Calepinage « grand projet » : seuls des lat/lng existent, produits avec la convention
    // DrawingControl (111111) — relus avec la même, l'aller-retour est exact.
    const live = this._getShapesFromLiveMap();
    const formes = live.length ? live : this._getShapesFromStorage();
    formes.forEach((points) => {
      implantation.push(points.map((c) => GeoMeters.offsetMeters(origin, c)));
    });
    this._getDrawingControlPanelsLatLng().forEach((points) => {
      panneaux.push(points.map((c) => GeoMeters.offsetMeters(origin, c)));
    });

    return { implantation, panneaux };
  }

  static getBounds() {
    const shapes = this.getShapesLatLng();
    if (!shapes.length) return null;
    const bounds = new window.google.maps.LatLngBounds();
    let hasPoints = false;
    shapes.forEach((points) => {
      points.forEach((coord) => {
        if (coord.lat !== undefined && coord.lng !== undefined) {
          bounds.extend(new window.google.maps.LatLng(coord.lat, coord.lng));
          hasPoints = true;
        }
      });
    });
    return hasPoints ? bounds : null;
  }

  /** @returns {{lat:number,lng:number}|null} */
  static getCenter() {
    const bounds = this.getBounds();
    if (!bounds) return null;
    const center = bounds.getCenter();
    return { lat: center.lat(), lng: center.lng() };
  }

  /** Étendue réelle (mètres) de la zone d'implantation, pour le calcul d'échelle auto du Plan de masse. */
  static getExtentMeters() {
    const bounds = this.getBounds();
    if (!bounds) return null;
    const center = bounds.getCenter();
    const centerLatLng = { lat: center.lat(), lng: center.lng() };
    const ne = GeoMeters.offsetMeters(centerLatLng, { lat: bounds.getNorthEast().lat(), lng: bounds.getNorthEast().lng() });
    const sw = GeoMeters.offsetMeters(centerLatLng, { lat: bounds.getSouthWest().lat(), lng: bounds.getSouthWest().lng() });
    return {
      widthM: Math.abs(ne.x - sw.x),
      heightM: Math.abs(ne.y - sw.y),
      center: centerLatLng,
    };
  }
}
