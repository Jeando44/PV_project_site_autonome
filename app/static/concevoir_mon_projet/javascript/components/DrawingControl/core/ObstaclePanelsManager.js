import { DRAWING_CONSTANTS } from "../constants.js";

/**
 * Gère l'impact visuel des obstacles sur les panneaux solaires
 * des surfaces LineToPolygon (masquage dynamique des panneaux touchés).
 *
 * IMPORTANT : ce gestionnaire ne modifie PAS les états de suppression
 * persistants (DeletedPanelsStorage). Il masque simplement les panneaux
 * encore existants lorsqu'ils sont recouverts par un obstacle.
 */
class ObstaclePanelsManager {
  /**
   * @param {DrawingControl} drawingControl
   */
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.refreshTimeout = null;
  }

  /**
   * Demande un recalcul (avec debounce) du masquage des panneaux.
   */
  requestRefresh() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = setTimeout(() => {
      this.refreshTimeout = null;
      try {
        this.refreshPanelsMask();
      } catch (error) {
        console.error("[ObstaclePanelsManager] Erreur lors du rafraîchissement des panneaux sous obstacles:", error);
      }
    }, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT);
  }

  /**
   * Recalcule, pour toutes les surfaces LineToPolygon,
   * quels panneaux doivent être masqués ou visibles en fonction
   * de la position actuelle des obstacles.
   */
  refreshPanelsMask() {
    const dc = this.drawingControl;
    const lineToPolygon = dc.lineToPolygon;
    const polygonPanels = dc.polygonPanels;
    const solarRectangle = dc.solarRectangle;
    const shedPolygon = dc.shedPolygon;

    const circles = dc.obstacleCircleManager?.drawnObstacleCircles || [];
    const rectangles = dc.obstacleRectangleManager?.drawnObstacleRectangles || [];
    const polygons = dc.obstaclePolygonManager?.drawnObstaclePolygons || [];
    const lines = dc.obstacleLineManager?.drawnObstacleLines || [];

    const hasObstacles =
      (circles && circles.length > 0) ||
      (rectangles && rectangles.length > 0) ||
      (polygons && polygons.length > 0) ||
      (lines && lines.length > 0);

    // Aucun obstacle : s'assurer que tous les panneaux non supprimés sont visibles
    if (!hasObstacles) {
      this.refreshPanelsMaskForManager({
        dc,
        panelsManager: lineToPolygon,
        createdPanelsByShape: lineToPolygon?.createdPanelsByShape,
        getDeletedIndexSet: (pvId) => lineToPolygon?.getDeletedIndexSet?.(pvId) || new Set(),
        hiddenByToggle: lineToPolygon?.hiddenByToggle,
        shapeTypeLabel: "LineToPolygon",
      });

      this.refreshPanelsMaskForManager({
        dc,
        panelsManager: polygonPanels,
        createdPanelsByShape: polygonPanels?.createdPanelsByShape,
        getDeletedIndexSet: (pvId) => polygonPanels?.getDeletedIndexSet?.(pvId) || new Set(),
        hiddenByToggle: polygonPanels?.hiddenByToggle,
        shapeTypeLabel: "Polygon",
      });

      this.refreshPanelsMaskForManager({
        dc,
        panelsManager: solarRectangle,
        createdPanelsByShape: solarRectangle?.createdPanelsByShape,
        getDeletedIndexSet: (pvId) => solarRectangle?.getDeletedIndexSet?.(pvId) || new Set(),
        hiddenByToggle: solarRectangle?.hiddenByToggle,
        shapeTypeLabel: "SolarRectangle",
      });

      // Sheds : pas de suppression individuelle de panneau (getDeletedIndexSet renvoie toujours un
      // Set vide) — seul le masquage global par toggle (hiddenByToggle) existe pour ce type.
      this.refreshPanelsMaskForManager({
        dc,
        panelsManager: shedPolygon,
        createdPanelsByShape: shedPolygon?.createdPanels,
        getDeletedIndexSet: () => new Set(),
        hiddenByToggle: shedPolygon?.hiddenByToggle,
        shapeTypeLabel: "ShedPolygon",
      });
      return;
    }

    // Il y a des obstacles : recalcul pour chaque panneau
    this.refreshPanelsMaskForManager({
      dc,
      panelsManager: lineToPolygon,
      createdPanelsByShape: lineToPolygon?.createdPanelsByShape,
      getDeletedIndexSet: (pvId) => lineToPolygon?.getDeletedIndexSet?.(pvId) || new Set(),
      hiddenByToggle: lineToPolygon?.hiddenByToggle,
      shapeTypeLabel: "LineToPolygon",
      obstacles: { circles, rectangles, polygons, lines },
    });

    this.refreshPanelsMaskForManager({
      dc,
      panelsManager: polygonPanels,
      createdPanelsByShape: polygonPanels?.createdPanelsByShape,
      getDeletedIndexSet: (pvId) => polygonPanels?.getDeletedIndexSet?.(pvId) || new Set(),
      hiddenByToggle: polygonPanels?.hiddenByToggle,
      shapeTypeLabel: "Polygon",
      obstacles: { circles, rectangles, polygons, lines },
    });

    this.refreshPanelsMaskForManager({
      dc,
      panelsManager: solarRectangle,
      createdPanelsByShape: solarRectangle?.createdPanelsByShape,
      getDeletedIndexSet: (pvId) => solarRectangle?.getDeletedIndexSet?.(pvId) || new Set(),
      hiddenByToggle: solarRectangle?.hiddenByToggle,
      shapeTypeLabel: "SolarRectangle",
      obstacles: { circles, rectangles, polygons, lines },
    });

    this.refreshPanelsMaskForManager({
      dc,
      panelsManager: shedPolygon,
      createdPanelsByShape: shedPolygon?.createdPanels,
      getDeletedIndexSet: () => new Set(),
      hiddenByToggle: shedPolygon?.hiddenByToggle,
      shapeTypeLabel: "ShedPolygon",
      obstacles: { circles, rectangles, polygons, lines },
    });
  }

  /**
   * Applique le masquage obstacle pour un gestionnaire de panneaux (LineToPolygon, PolygonPanelsManager, SolarRectangle).
   * @param {Object} args
   * @param {DrawingControl} args.dc
   * @param {*} args.panelsManager
   * @param {Map<string, google.maps.Polygon[]>|undefined} args.createdPanelsByShape
   * @param {(pvId:string)=>Set<string>} args.getDeletedIndexSet
   * @param {Set<string>|undefined} args.hiddenByToggle
   * @param {string} args.shapeTypeLabel
   * @param {{circles:any[],rectangles:any[],polygons:any[],lines:any[]}|undefined} args.obstacles
   */
  refreshPanelsMaskForManager({
    dc,
    createdPanelsByShape,
    getDeletedIndexSet,
    hiddenByToggle,
    shapeTypeLabel,
    obstacles,
  }) {
    if (!createdPanelsByShape || typeof createdPanelsByShape.forEach !== "function") {
      return;
    }

    const hiddenSet = hiddenByToggle || new Set();
    const circles = obstacles?.circles || [];
    const rectangles = obstacles?.rectangles || [];
    const polygons = obstacles?.polygons || [];
    const lines = obstacles?.lines || [];
    const hasObstacles = Boolean(obstacles);

    const changedPvIds = new Set();

    createdPanelsByShape.forEach((panels, pvId) => {
      const deletedIndexes = getDeletedIndexSet(pvId);
      const isHidden = hiddenSet.has(pvId);

      (panels || []).forEach((panel) => {
        // Ne pas traiter les overlays non-panneaux (ex: marge)
        if (!panel || !panel.isPanelSolaire) {
          return;
        }

        if (isHidden) {
          const wasMasked = Boolean(panel._maskedByObstacle);
          panel.setMap(null);
          panel._maskedByObstacle = false;
          if (wasMasked) changedPvIds.add(pvId);
          return;
        }

        // Respecter les suppressions persistantes
        if (deletedIndexes && deletedIndexes.has && deletedIndexes.has(panel.panelIndex)) {
          const wasMasked = Boolean(panel._maskedByObstacle);
          panel.setMap(null);
          panel._maskedByObstacle = false;
          if (wasMasked) changedPvIds.add(pvId);
          return;
        }

        if (!hasObstacles) {
          const wasMasked = Boolean(panel._maskedByObstacle);
          if (!panel.getMap()) {
            panel.setMap(dc.map);
          }
          panel._maskedByObstacle = false;
          if (wasMasked) changedPvIds.add(pvId);
          return;
        }

        const panelCorners = this.getPanelCorners(panel);
        const center = this.getPolygonCenter(panel);
        const isCovered = this.isPanelCoveredByObstacle(
          panel,
          center,
          panelCorners,
          circles,
          rectangles,
          polygons,
          lines
        );

        if (isCovered) {
          const wasMasked = Boolean(panel._maskedByObstacle);
          if (panel.getMap()) {
            panel.setMap(null);
          }
          panel._maskedByObstacle = true;
          if (!wasMasked) changedPvIds.add(pvId);
          return;
        }

        const wasMasked = Boolean(panel._maskedByObstacle);
        if (!panel.getMap()) {
          panel.setMap(dc.map);
        }
        panel._maskedByObstacle = false;
        if (wasMasked) changedPvIds.add(pvId);
      });
    });

    // Forcer le rafraîchissement des résumés uniquement si un masque a changé
    if (changedPvIds.size > 0) {
      const { CUSTOM_EVENTS } = dc || {};
      changedPvIds.forEach((pvId) => {
        try {
          if (CUSTOM_EVENTS?.LAYOUT_UPDATED) {
            document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.LAYOUT_UPDATED, { detail: { pvId } }));
          }
          if (CUSTOM_EVENTS?.UPDATE_RESUME_CONTAINER) {
            document.dispatchEvent(new Event(CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER));
          }
          if (window.storageManager && typeof window.storageManager.savePageData === "function") {
            Promise.resolve().then(() => window.storageManager.savePageData()).catch(() => {});
          }
        } catch (_) {}
      });
    }
  }

  /**
   * Calcule un centroïde simple d'un polygone (moyenne des sommets).
   * @param {google.maps.Polygon} polygon
   * @returns {google.maps.LatLng}
   */
  getPolygonCenter(polygon) {
    try {
      if (typeof polygon.getPath !== "function") {
        return null;
      }
      const path = polygon.getPath();
      const len = path.getLength();
      if (!len) {
        return null;
      }

      let sumLat = 0;
      let sumLng = 0;
      for (let i = 0; i < len; i += 1) {
        const point = path.getAt(i);
        sumLat += point.lat();
        sumLng += point.lng();
      }

      return new google.maps.LatLng(sumLat / len, sumLng / len);
    } catch (error) {
      console.error("[ObstaclePanelsManager] Erreur lors du calcul du centre de panneau:", error);
      return null;
    }
  }

  /**
   * Récupère les coins d'un polygone panneau (arrêt rapide sur 4 sommets).
   * @param {google.maps.Polygon} polygon
   * @returns {google.maps.LatLng[]}
   */
  getPanelCorners(polygon) {
    try {
      if (!polygon || typeof polygon.getPath !== "function") {
        return [];
      }
      const path = polygon.getPath();
      const len = Math.min(path.getLength(), 10); // limiter
      const corners = [];
      for (let i = 0; i < len; i += 1) {
        corners.push(path.getAt(i));
      }
      return corners;
    } catch (_) {
      return [];
    }
  }

  /**
   * Indique si un panneau est couvert par au moins un obstacle.
   * @param {google.maps.Polygon} panel
   * @param {google.maps.LatLng|null} center
   * @param {google.maps.LatLng[]} corners
   * @param {google.maps.Circle[]} circles
   * @param {google.maps.Rectangle[]} rectangles
   * @param {google.maps.Polygon[]} polygons
   * @param {google.maps.Polyline[]} lines
   * @returns {boolean}
   */
  isPanelCoveredByObstacle(panel, center, corners, circles, rectangles, polygons, lines) {
    const safeCorners = corners || [];

    // Cercles obstacles
    if (Array.isArray(circles)) {
      for (let i = 0; i < circles.length; i += 1) {
        const circle = circles[i];
        if (!circle || typeof circle.getCenter !== "function") continue;
        const cCenter = circle.getCenter();
        const radius = circle.getRadius();
        const buffer = circle.bufferDistance || 0;
        if (this.isPanelIntersectingCircle(panel, center, safeCorners, cCenter, radius, buffer)) {
          return true;
        }
      }
    }

    // Rectangles obstacles : représentés en interne par un google.maps.Polygon à 4 points (pour
    // permettre la rotation, cf. ObstacleRectangle.js) — même test d'intersection que les
    // polygones obstacles, y compris pour le buffer.
    if (Array.isArray(rectangles)) {
      for (let i = 0; i < rectangles.length; i += 1) {
        const rectangle = rectangles[i];
        if (!rectangle || typeof rectangle.getPath !== "function") continue;
        if (this.isPanelIntersectingPolygon(panel, center, safeCorners, rectangle)) {
          return true;
        }
      }
    }

    // Polygones obstacles
    if (Array.isArray(polygons)) {
      for (let i = 0; i < polygons.length; i += 1) {
        const obstaclePolygon = polygons[i];
        if (!obstaclePolygon) continue;
        if (this.isPanelIntersectingPolygon(panel, center, safeCorners, obstaclePolygon)) {
          return true;
        }
      }
    }

    // Lignes obstacles
    if (Array.isArray(lines)) {
      for (let i = 0; i < lines.length; i += 1) {
        const obstacleLine = lines[i];
        if (!obstacleLine) continue;
        if (this.isPanelIntersectingLine(panel, center, safeCorners, obstacleLine)) {
          return true;
        }
      }
    }

    return false;
  }

  isPanelIntersectingCircle(panel, center, corners, circleCenter, radius, buffer = 0) {
    if (!circleCenter || !radius) return false;
    const totalRadius = radius + buffer;

    // 1) centre du panneau dans le cercle
    if (center) {
      const distCenter = google.maps.geometry.spherical.computeDistanceBetween(circleCenter, center);
      if (distCenter <= totalRadius) return true;
    }

    // 2) un coin du panneau dans le cercle
    for (let i = 0; i < corners.length; i += 1) {
      const dist = google.maps.geometry.spherical.computeDistanceBetween(circleCenter, corners[i]);
      if (dist <= totalRadius) return true;
    }

    // 3) le centre du cercle est dans le panneau
    try {
      if (panel && google.maps.geometry.poly.containsLocation(circleCenter, panel)) {
        return true;
      }
    } catch (_) {}

    // 4) intersection cercle / arête du panneau
    const segments = this.getPanelSegments(corners);
    for (let i = 0; i < segments.length; i += 1) {
      const { start, end } = segments[i];
      const dist = this.distancePointToSegmentMeters(circleCenter, start, end);
      if (dist <= totalRadius) {
        return true;
      }
    }
    return false;
  }


  isPanelIntersectingPolygon(panel, center, corners, obstaclePolygon) {
    try {
      // 1) centre du panneau dans le polygone obstacle
      if (center && google.maps.geometry.poly.containsLocation(center, obstaclePolygon)) {
        return true;
      }

      // 2) un coin du panneau dans le polygone obstacle
      for (let i = 0; i < corners.length; i += 1) {
        if (google.maps.geometry.poly.containsLocation(corners[i], obstaclePolygon)) {
          return true;
        }
      }

      // 3) un sommet de l'obstacle dans le panneau
      const obstaclePath = obstaclePolygon.getPath();
      if (obstaclePath) {
        for (let i = 0; i < obstaclePath.getLength(); i += 1) {
          const vertex = obstaclePath.getAt(i);
          if (panel && google.maps.geometry.poly.containsLocation(vertex, panel)) {
            return true;
          }
        }
      }
      
      // Intégration du Buffer : Vérifier si le panneau est à proximité des bords du polygone
      const buffer = obstaclePolygon.bufferDistance || 0;
      if (buffer > 0 && obstaclePath) {
          const obsCorners = [];
          for (let i = 0; i < obstaclePath.getLength(); i += 1) obsCorners.push(obstaclePath.getAt(i));
          const obsSegments = this.getPanelSegments(obsCorners);
          const panelSegments = this.getPanelSegments(corners);
          
          for (let i = 0; i < corners.length; i += 1) {
              for (let j = 0; j < obsSegments.length; j += 1) {
                  if (this.distancePointToSegmentMeters(corners[i], obsSegments[j].start, obsSegments[j].end) <= buffer) return true;
              }
          }
          for (let i = 0; i < obsCorners.length; i += 1) {
              for (let j = 0; j < panelSegments.length; j += 1) {
                  if (this.distancePointToSegmentMeters(obsCorners[i], panelSegments[j].start, panelSegments[j].end) <= buffer) return true;
              }
          }
          if (center) {
              for (let j = 0; j < obsSegments.length; j += 1) {
                  if (this.distancePointToSegmentMeters(center, obsSegments[j].start, obsSegments[j].end) <= buffer) return true;
              }
          }
      }
    } catch (error) {
      console.error("[ObstaclePanelsManager] Erreur lors du test d'intersection avec un polygone obstacle:", error);
    }
    return false;
  }

  isPanelIntersectingLine(panel, center, corners, obstacleLine) {
    try {
      if (!obstacleLine || typeof obstacleLine.getPath !== "function") {
        return false;
      }

      const linePath = obstacleLine.getPath();
      if (!linePath || linePath.getLength() < 2) {
        return false;
      }

      // 1) un point de la ligne est dans le panneau
      for (let i = 0; i < linePath.getLength(); i += 1) {
        const linePoint = linePath.getAt(i);
        if (panel && google.maps.geometry.poly.containsLocation(linePoint, panel)) {
          return true;
        }
      }

      // 2) un coin du panneau est proche de la ligne (distance < seuil)
      // CORRECTIF : un seuil fixe de 0.5m était systématiquement ajouté au buffer saisi par
      // l'utilisateur, même pour un buffer=0 — la ligne obstacle avait donc toujours 0.5m de zone
      // tampon "cachée", contrairement au cercle/rectangle/polygone où buffer=0 signifie zéro
      // tolérance. Retiré pour un comportement cohérent et précis sur les 4 formes.
      const buffer = obstacleLine.bufferDistance || 0;
      const thresholdMeters = buffer;
      for (let i = 0; i < corners.length; i += 1) {
        const corner = corners[i];
        // Vérifier la distance à chaque segment de la ligne
        for (let j = 0; j < linePath.getLength() - 1; j += 1) {
          const lineStart = linePath.getAt(j);
          const lineEnd = linePath.getAt(j + 1);
          const dist = this.distancePointToSegmentMeters(corner, lineStart, lineEnd);
          if (dist <= thresholdMeters) {
            return true;
          }
        }
      }

      // 3) le centre du panneau est proche de la ligne
      if (center) {
        for (let j = 0; j < linePath.getLength() - 1; j += 1) {
          const lineStart = linePath.getAt(j);
          const lineEnd = linePath.getAt(j + 1);
          const dist = this.distancePointToSegmentMeters(center, lineStart, lineEnd);
          if (dist <= thresholdMeters) {
            return true;
          }
        }
      }

      // 4) intersection entre la ligne et les segments du panneau
      const panelSegments = this.getPanelSegments(corners);
      for (let i = 0; i < panelSegments.length; i += 1) {
        const { start: segStart, end: segEnd } = panelSegments[i];
        for (let j = 0; j < linePath.getLength() - 1; j += 1) {
          const lineStart = linePath.getAt(j);
          const lineEnd = linePath.getAt(j + 1);
          if (this.segmentsIntersect(segStart, segEnd, lineStart, lineEnd)) {
            return true;
          }
        }
      }
    } catch (error) {
      console.error("[ObstaclePanelsManager] Erreur lors du test d'intersection avec une ligne obstacle:", error);
    }
    return false;
  }

  segmentsIntersect(p1, p2, p3, p4) {
    try {
      // Vérifier si deux segments de ligne se croisent
      // Utilise une approche basée sur l'orientation
      const orientation = (p, q, r) => {
        const val = (q.lat() - p.lat()) * (r.lng() - q.lng()) - (q.lng() - p.lng()) * (r.lat() - q.lat());
        if (val === 0) return 0; // colinéaire
        return val > 0 ? 1 : 2; // sens horaire ou anti-horaire
      };

      const onSegment = (p, q, r) => {
        return q.lat() <= Math.max(p.lat(), r.lat()) &&
               q.lat() >= Math.min(p.lat(), r.lat()) &&
               q.lng() <= Math.max(p.lng(), r.lng()) &&
               q.lng() >= Math.min(p.lng(), r.lng());
      };

      const o1 = orientation(p1, p2, p3);
      const o2 = orientation(p1, p2, p4);
      const o3 = orientation(p3, p4, p1);
      const o4 = orientation(p3, p4, p2);

      // Cas général
      if (o1 !== o2 && o3 !== o4) return true;

      // Cas spéciaux : colinéarité
      if (o1 === 0 && onSegment(p1, p3, p2)) return true;
      if (o2 === 0 && onSegment(p1, p4, p2)) return true;
      if (o3 === 0 && onSegment(p3, p1, p4)) return true;
      if (o4 === 0 && onSegment(p3, p2, p4)) return true;

      return false;
    } catch (_) {
      return false;
    }
  }

  getPanelSegments(corners) {
    const segments = [];
    if (!Array.isArray(corners) || corners.length === 0) return segments;
    for (let i = 0; i < corners.length; i += 1) {
      const start = corners[i];
      const end = corners[(i + 1) % corners.length];
      segments.push({ start, end });
    }
    return segments;
  }

  distancePointToSegmentMeters(point, start, end) {
    try {
      if (!point || !start || !end) return Infinity;
      // Convertir en coordonnées locales (mètres) par rapport au point de test
      const ref = point;
      const toMeters = (target) => {
        const latPoint = new google.maps.LatLng(target.lat(), ref.lng());
        const lngPoint = new google.maps.LatLng(ref.lat(), target.lng());
        const deltaY = google.maps.geometry.spherical.computeDistanceBetween(ref, latPoint);
        const deltaX = google.maps.geometry.spherical.computeDistanceBetween(ref, lngPoint);
        return {
          x: target.lng() >= ref.lng() ? deltaX : -deltaX,
          y: target.lat() >= ref.lat() ? deltaY : -deltaY,
        };
      };

      const p = { x: 0, y: 0 };
      const a = toMeters(start);
      const b = toMeters(end);

      const ab = { x: b.x - a.x, y: b.y - a.y };
      const ap = { x: p.x - a.x, y: p.y - a.y };
      const abLen2 = ab.x * ab.x + ab.y * ab.y;
      if (abLen2 === 0) {
        return Math.hypot(ap.x, ap.y);
      }
      const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y) / abLen2));
      const proj = { x: a.x + t * ab.x, y: a.y + t * ab.y };
      return Math.hypot(p.x - proj.x, p.y - proj.y);
    } catch (_) {
      return Infinity;
    }
  }
}

export default ObstaclePanelsManager;
