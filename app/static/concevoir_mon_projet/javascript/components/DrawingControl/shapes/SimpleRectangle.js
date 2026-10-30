import { DRAWING_CONSTANTS, STYLES, CUSTOM_EVENTS, METERS_PER_LAT_DEGREE } from '../constants.js';
import ErrorModal from '../../ErrorModal.js';

const ROTATION_HANDLE_ICON = '/static/concevoir_mon_projet/medias/icons/sync.svg';

/**
 * Classe gérant les rectangles simples sur la carte.
 *
 * Un rectangle simple est représenté par un google.maps.Polygon à 4 sommets (et non par un
 * google.maps.Rectangle, toujours aligné nord-sud et donc impossible à faire pivoter) — même choix
 * que ObstacleRectangle.js. Ordre des sommets : [0]→[1] = largeur, [1]→[2] = hauteur ; un rectangle
 * tracé à l'écran part donc de [nw, ne, se, sw].
 *
 * Rotation : poignée « sync.svg » 26x26, la même que celle du calepinage rectangulaire
 * (polygon_maison.js::_ensureRotationHandle), affichée tant que le rectangle est sélectionné. Les
 * deux rotations sont indépendantes : une poignée par rectangle simple, aucun état partagé avec le
 * calepinage.
 *
 * Édition des coins : le coin opposé à celui tiré reste fixe et les deux coins voisins glissent sur
 * leur axe (même principe que polygon_maison.js::squareRectangleFromCorner) — la forme reste un
 * rectangle quelle que soit son orientation.
 */
class SimpleRectangle {
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.drawnSimpleRectangles = [];
    this.selectedSimpleRectangle = null;
    this.usedSimpleRectangleIds = new Set();
    this.simpleRectangleLabels = new Map();
    this.rotationHandles = new Map();
    this.labelsVisible = true;
    this.errorModal = new ErrorModal();
  }

  // --- Géométrie -----------------------------------------------------------------------------

  /** Style de base (rectangle « intérieur » issu d'un décalage, ou standard). */
  baseStyle(simpleRectangle) {
    return simpleRectangle && simpleRectangle.solak_isInbound
      ? STYLES.INBOUND_SIMPLE_RECTANGLE
      : STYLES.DEFAULT_SIMPLE_RECTANGLE;
  }

  /**
   * Coins d'un rectangle orienté.
   * @param {google.maps.LatLng} center
   * @param {number} widthM - longueur du côté [0]→[1]
   * @param {number} heightM - longueur du côté [1]→[2]
   * @param {number} headingDeg - cap du côté [0]→[1] (90 = vers l'est)
   * @returns {google.maps.LatLng[]}
   */
  static rectanglePoints(center, widthM, heightM, headingDeg) {
    const sph = google.maps.geometry.spherical;
    const corner = (su, sv) => {
      const p = sph.computeOffset(center, su * widthM / 2, headingDeg);
      return sph.computeOffset(p, sv * heightM / 2, headingDeg + 90);
    };
    return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  }

  /**
   * Dimensions, orientation et centre d'un rectangle simple.
   * @returns {{center: google.maps.LatLng, width: number, height: number, heading: number}}
   */
  measure(simpleRectangle) {
    const sph = google.maps.geometry.spherical;
    const path = simpleRectangle.getPath();
    const p0 = path.getAt(0), p1 = path.getAt(1), p2 = path.getAt(2);
    return {
      center: sph.interpolate(p0, p2, 0.5),
      width: sph.computeDistanceBetween(p0, p1),
      height: sph.computeDistanceBetween(p1, p2),
      heading: sph.computeHeading(p0, p1)
    };
  }

  getCenter(simpleRectangle) {
    const bounds = new google.maps.LatLngBounds();
    simpleRectangle.getPath().forEach((p) => bounds.extend(p));
    return bounds.getCenter();
  }

  /**
   * Redresse le rectangle après le déplacement d'un coin : le coin opposé reste l'ancre, les deux
   * coins voisins glissent sur leur propre axe. Calcul en mètres locaux (aller-retour avec la même
   * constante : aucune dérive).
   * @returns {google.maps.LatLng[]|null} null si dégénéré
   */
  static squareFromCorner(points, draggedIndex) {
    if (!points || points.length !== 4) return null;
    const origin = points[0];
    const mLat = METERS_PER_LAT_DEGREE;
    const mLng = mLat * Math.cos((origin.lat() * Math.PI) / 180);
    const toLocal = (p) => ({ x: (p.lng() - origin.lng()) * mLng, y: (p.lat() - origin.lat()) * mLat });
    const toLatLng = (p) => new google.maps.LatLng(origin.lat() + p.y / mLat, origin.lng() + p.x / mLng);

    const local = points.map(toLocal);
    const k = ((draggedIndex % 4) + 4) % 4;
    const anchorIdx = (k + 2) % 4, adj1Idx = (k + 1) % 4, adj2Idx = (k + 3) % 4;
    const anchor = local[anchorIdx];
    const unit = (p) => {
      const dx = p.x - anchor.x, dy = p.y - anchor.y;
      const len = Math.hypot(dx, dy);
      return len < 1e-6 ? null : { x: dx / len, y: dy / len };
    };
    const axis1 = unit(local[adj1Idx]);
    const axis2 = unit(local[adj2Idx]);
    if (!axis1 || !axis2) return null;

    const rel = { x: local[k].x - anchor.x, y: local[k].y - anchor.y };
    const len1 = rel.x * axis1.x + rel.y * axis1.y;
    const len2 = rel.x * axis2.x + rel.y * axis2.y;
    const result = new Array(4);
    result[anchorIdx] = anchor;
    result[adj1Idx] = { x: anchor.x + axis1.x * len1, y: anchor.y + axis1.y * len1 };
    result[adj2Idx] = { x: anchor.x + axis2.x * len2, y: anchor.y + axis2.y * len2 };
    result[k] = { x: anchor.x + axis1.x * len1 + axis2.x * len2, y: anchor.y + axis1.y * len1 + axis2.y * len2 };
    return result.map(toLatLng);
  }

  /**
   * Remplace les sommets EN PLACE (setAt) — jamais setPath(), qui créerait un nouveau MVCArray et
   * ferait perdre les écouteurs set_at/insert_at posés sur le chemin.
   */
  setRectanglePath(simpleRectangle, points, { silent = false } = {}) {
    const path = simpleRectangle.getPath();
    simpleRectangle._suppressPathEvents = true;
    try {
      while (path.getLength() > points.length) path.pop();
      points.forEach((p, i) => {
        if (i < path.getLength()) path.setAt(i, p);
        else path.push(p);
      });
    } finally {
      simpleRectangle._suppressPathEvents = false;
    }
    this.updateRotationHandle(simpleRectangle);
    if (!silent) {
      this.updateSimpleRectangleLabel(simpleRectangle);
      this.saveSimpleRectangleData(simpleRectangle);
    }
  }

  /**
   * Calcule la surface d'un rectangle simple
   * @param {google.maps.Polygon} simpleRectangle
   * @returns {number} La surface en mètres carrés
   */
  calculateSimpleRectangleArea(simpleRectangle) {
    try {
      return google.maps.geometry.spherical.computeArea(simpleRectangle.getPath());
    } catch (error) {
      console.error("Erreur lors du calcul de l'aire du rectangle:", error);
      return 0;
    }
  }

  // --- Étiquette -----------------------------------------------------------------------------

  /**
   * Met à jour le label d'un rectangle simple avec debounce
   * @param {google.maps.Polygon} simpleRectangle
   */
  updateSimpleRectangleLabel(simpleRectangle) {
    try {
      if (!simpleRectangle || !simpleRectangle.simpleRectangleId) return;

      if (simpleRectangle._updateTimeout) {
        clearTimeout(simpleRectangle._updateTimeout);
      }

      simpleRectangle._updateTimeout = setTimeout(() => {
        if (!simpleRectangle.getMap()) return;

        const existingLabel = this.simpleRectangleLabels.get(simpleRectangle.simpleRectangleId);
        if (existingLabel) {
          existingLabel.map = null;
        }

        const area = this.calculateSimpleRectangleArea(simpleRectangle);
        if (area < 1) {
          this.removeSimpleRectangle(simpleRectangle);
          this.drawingControl.errorModal.show('La surface du rectangle est trop petite. Elle doit être supérieure à 1 m².');
          return;
        }
        const labelContent = document.createElement('div');
        labelContent.className = 'simpleRectangle-label';
        labelContent.style.cssText = STYLES.SIMPLE_RECTANGLE_LABEL;
        const areaText = area < 1000 ?
          `${Math.round(area * 100) / 100}m²` :
          `${Math.round(area / 10) / 100}km²`;
        labelContent.innerHTML = `${simpleRectangle.simpleRectangleId}<br>Surface: ${areaText}`;

        const label = new this.drawingControl.AdvancedMarkerElement({
          map: this.labelsVisible ? this.drawingControl.map : null,
          position: this.getCenter(simpleRectangle),
          content: labelContent,
          collisionBehavior: 'REQUIRED_AND_HIDES_OPTIONAL'
        });
        this.simpleRectangleLabels.set(simpleRectangle.simpleRectangleId, label);
      }, 100);
    } catch (error) {
      console.error('Erreur lors de la mise à jour du label du simpleRectangle:', error);
    }
  }

  // --- Poignée de rotation -------------------------------------------------------------------

  /** Milieu du côté [0]→[1], comme la poignée du calepinage rectangulaire. */
  _rotationHandleAnchor(simpleRectangle) {
    const path = simpleRectangle.getPath();
    if (path.getLength() < 2) return null;
    return google.maps.geometry.spherical.interpolate(path.getAt(0), path.getAt(1), 0.5);
  }

  showRotationHandle(simpleRectangle) {
    const anchor = this._rotationHandleAnchor(simpleRectangle);
    if (!anchor) return;
    let handle = this.rotationHandles.get(simpleRectangle.simpleRectangleId);
    if (!handle) {
      handle = new google.maps.Marker({
        position: anchor,
        icon: {
          url: ROTATION_HANDLE_ICON,
          scaledSize: new google.maps.Size(26, 26),
          anchor: new google.maps.Point(13, 13)
        },
        title: 'Faire pivoter le rectangle',
        draggable: true,
        cursor: 'grab',
        zIndex: 1050
      });
      this.rotationHandles.set(simpleRectangle.simpleRectangleId, handle);
      this._attachRotationHandleDrag(simpleRectangle, handle);
    }
    handle.setPosition(anchor);
    handle.setMap(this.drawingControl.map);
  }

  hideRotationHandle(simpleRectangle) {
    const handle = simpleRectangle && this.rotationHandles.get(simpleRectangle.simpleRectangleId);
    if (handle) handle.setMap(null);
  }

  updateRotationHandle(simpleRectangle) {
    const handle = this.rotationHandles.get(simpleRectangle.simpleRectangleId);
    if (handle && handle.getMap()) handle.setPosition(this._rotationHandleAnchor(simpleRectangle));
  }

  _removeRotationHandle(simpleRectangle) {
    const handle = this.rotationHandles.get(simpleRectangle.simpleRectangleId);
    if (handle) {
      google.maps.event.clearInstanceListeners(handle);
      handle.setMap(null);
      this.rotationHandles.delete(simpleRectangle.simpleRectangleId);
    }
  }

  /**
   * Glisser-pivoter autour du centre du rectangle : rotation « live » par mutation du chemin
   * pendant le geste, étiquette et sauvegarde une seule fois à la fin.
   */
  _attachRotationHandleDrag(simpleRectangle, handle) {
    const sph = google.maps.geometry.spherical;
    let center = null;
    let lastHeading = 0;

    handle.addListener('dragstart', () => {
      center = this.getCenter(simpleRectangle);
      lastHeading = sph.computeHeading(center, handle.getPosition());
      const label = this.simpleRectangleLabels.get(simpleRectangle.simpleRectangleId);
      if (label) label.map = null;
    });

    handle.addListener('drag', (e) => {
      if (!center) return;
      const heading = sph.computeHeading(center, e.latLng);
      let delta = heading - lastHeading;
      if (delta > 180) delta -= 360;
      else if (delta < -180) delta += 360;
      lastHeading = heading;
      const points = simpleRectangle.getPath().getArray().map((p) =>
        sph.computeOffset(center, sph.computeDistanceBetween(center, p), sph.computeHeading(center, p) + delta));
      this.setRectanglePath(simpleRectangle, points, { silent: true });
    });

    handle.addListener('dragend', () => {
      center = null;
      this.updateRotationHandle(simpleRectangle);
      this.updateSimpleRectangleLabel(simpleRectangle);
      this.saveSimpleRectangleData(simpleRectangle);
    });
  }

  // --- Création / écouteurs ------------------------------------------------------------------

  /**
   * Gère la création d'un nouveau rectangle simple. Accepte un google.maps.Rectangle (tracé Terra
   * Draw / ancien DrawingManager), converti ici en polygone à 4 sommets, ou un polygone déjà construit.
   * @param {google.maps.Rectangle|google.maps.Polygon} shape
   * @param {boolean} [isInbound]
   * @returns {google.maps.Polygon} Le rectangle simple créé
   */
  handleSimpleRectangleComplete(shape, isInbound) {
    let simpleRectangle = shape;
    if (typeof shape.getPath !== 'function' && typeof shape.getBounds === 'function') {
      const bounds = shape.getBounds();
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      simpleRectangle = new google.maps.Polygon({
        paths: [
          new google.maps.LatLng(ne.lat(), sw.lng()),
          ne,
          new google.maps.LatLng(sw.lat(), ne.lng()),
          sw
        ],
        map: this.drawingControl.map
      });
      simpleRectangle.solak_isInbound = shape.solak_isInbound;
      shape.setMap(null);
    }
    if (isInbound) simpleRectangle.solak_isInbound = true;

    const simpleRectangleId = this.generateSimpleRectangleId();
    simpleRectangle.simpleRectangleId = simpleRectangleId;
    simpleRectangle.setOptions({ ...this.baseStyle(simpleRectangle), editable: true, draggable: true });

    this.drawnSimpleRectangles.push(simpleRectangle);
    this.usedSimpleRectangleIds.add(simpleRectangleId);
    this.setupSimpleRectangleListeners(simpleRectangle);
    this.updateSimpleRectangleLabel(simpleRectangle);

    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SIMPLE_RECTANGLE_ADDED, {
      detail: { simpleRectangleId }
    }));

    this.setSimpleRectangleSelection(simpleRectangle);
    return simpleRectangle;
  }

  /**
   * Configure les écouteurs d'événements pour un rectangle simple
   * @param {google.maps.Polygon} simpleRectangle
   */
  setupSimpleRectangleListeners(simpleRectangle) {
    let isDragging = false;

    google.maps.event.addListener(simpleRectangle, 'click', () => {
      if (isDragging) return;
      this.setSimpleRectangleSelection(simpleRectangle);
    });

    google.maps.event.addListener(simpleRectangle, 'dragstart', () => {
      isDragging = true;
      const label = this.simpleRectangleLabels.get(simpleRectangle.simpleRectangleId);
      if (label) label.map = null;
    });

    google.maps.event.addListener(simpleRectangle, 'drag', () => {
      this.updateRotationHandle(simpleRectangle);
    });

    google.maps.event.addListener(simpleRectangle, 'dragend', () => {
      // Un 'click' peut suivre immédiatement 'dragend' : on l'ignore encore un court instant.
      setTimeout(() => { isDragging = false; }, 50);
      this.updateRotationHandle(simpleRectangle);
      this.updateSimpleRectangleLabel(simpleRectangle);
      this.saveSimpleRectangleData(simpleRectangle);
    });

    // Coin déplacé à la main : on garde un rectangle (cf. squareFromCorner).
    const path = simpleRectangle.getPath();
    google.maps.event.addListener(path, 'set_at', (index) => {
      if (simpleRectangle._suppressPathEvents || isDragging) {
        this.updateRotationHandle(simpleRectangle);
        return;
      }
      const squared = SimpleRectangle.squareFromCorner(path.getArray(), index);
      if (squared) this.setRectanglePath(simpleRectangle, squared);
    });
    // Point « fantôme » de milieu d'arête tiré : un rectangle garde exactement 4 sommets.
    google.maps.event.addListener(path, 'insert_at', (index) => {
      if (simpleRectangle._suppressPathEvents) return;
      simpleRectangle._suppressPathEvents = true;
      path.removeAt(index);
      simpleRectangle._suppressPathEvents = false;
    });

    const handleSimpleRectangleDeleteKeydown = (e) => {
      const offsetModalOpen = this.drawingControl?.offsetModal?.isOpen?.();
      if (offsetModalOpen && (e.key === 'Delete' || e.key === 'Backspace')) {
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedSimpleRectangle) {
          e.preventDefault();
          this.deleteSelectedSimpleRectangle();
        }
      }
    };
    google.maps.event.addListener(simpleRectangle, 'rightclick', () => {
      if (this.selectedSimpleRectangle) {
        this.deleteSelectedSimpleRectangle();
      }
    });

    document.addEventListener('keydown', handleSimpleRectangleDeleteKeydown);

    if (!simpleRectangle._listeners) simpleRectangle._listeners = [];
    simpleRectangle._listeners.push({ type: 'keydown', listener: handleSimpleRectangleDeleteKeydown });
  }

  // --- Sélection / suppression ---------------------------------------------------------------

  /**
   * Définit le rectangle simple sélectionné
   * @param {google.maps.Polygon|null} simpleRectangle
   */
  setSimpleRectangleSelection(simpleRectangle) {
    if (this.selectedSimpleRectangle && this.selectedSimpleRectangle !== simpleRectangle) {
      this.deselect();
    }

    this.drawingControl.clearSelection();

    this.selectedSimpleRectangle = simpleRectangle;

    if (simpleRectangle) {
      simpleRectangle.setOptions(STYLES.SELECTED_SIMPLE_RECTANGLE);
      this.showRotationHandle(simpleRectangle);
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SIMPLE_RECTANGLE_SELECTED, {
        detail: { simpleRectangleId: simpleRectangle.simpleRectangleId }
      }));
    }
  }

  /**
   * Désélection (appelée par DrawingControl.clearSelection) : poignées d'édition et de rotation
   * retirées, le rectangle reste déplaçable.
   */
  deselect() {
    const simpleRectangle = this.selectedSimpleRectangle;
    if (!simpleRectangle) return;
    simpleRectangle.setOptions({ ...this.baseStyle(simpleRectangle), editable: false, draggable: true });
    this.hideRotationHandle(simpleRectangle);
    this.selectedSimpleRectangle = null;
  }

  /**
   * Génère un nouvel ID unique pour un rectangle simple
   * @returns {string}
   */
  generateSimpleRectangleId() {
    let counter = 1;
    let simpleRectangleId;
    do {
      simpleRectangleId = `${DRAWING_CONSTANTS.SIMPLE_RECTANGLE_ID_PREFIX}${counter}`;
      counter++;
    } while (this.usedSimpleRectangleIds.has(simpleRectangleId));
    return simpleRectangleId;
  }

  /** Retire un rectangle de la carte et des registres (sans événement de suppression). */
  removeSimpleRectangle(simpleRectangle) {
    const simpleRectangleId = simpleRectangle.simpleRectangleId;
    const label = this.simpleRectangleLabels.get(simpleRectangleId);
    if (label) label.map = null;
    this.simpleRectangleLabels.delete(simpleRectangleId);
    this._removeRotationHandle(simpleRectangle);
    simpleRectangle.setMap(null);
    this.drawnSimpleRectangles = this.drawnSimpleRectangles.filter(r => r !== simpleRectangle);
    this.usedSimpleRectangleIds.delete(simpleRectangleId);
    if (this.selectedSimpleRectangle === simpleRectangle) this.selectedSimpleRectangle = null;
  }

  /**
   * Supprime le rectangle simple sélectionné
   */
  deleteSelectedSimpleRectangle() {
    if (this.selectedSimpleRectangle) {
      const simpleRectangleId = this.selectedSimpleRectangle.simpleRectangleId;
      this.removeSimpleRectangle(this.selectedSimpleRectangle);

      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SIMPLE_RECTANGLE_REMOVED, {
        detail: { simpleRectangleId }
      }));
    }
  }

  /**
   * Sauvegarde les données d'un rectangle simple avec debounce
   * @param {google.maps.Polygon} simpleRectangle
   */
  saveSimpleRectangleData(simpleRectangle) {
    if (simpleRectangle._saveTimeout) {
      clearTimeout(simpleRectangle._saveTimeout);
    }

    simpleRectangle._saveTimeout = setTimeout(() => {
      window.storageManager.savePageData();
    }, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT);
  }

  // --- Persistance ---------------------------------------------------------------------------

  /**
   * Collecte les données de tous les rectangles simples. `points` (4 sommets) porte l'orientation ;
   * `bounds` (emprise nord-sud) est conservé pour la compatibilité des données déjà enregistrées.
   * @returns {Object}
   */
  collectSimpleRectanglesData() {
    try {
      const simpleRectanglesData = {};

      this.drawnSimpleRectangles.forEach(simpleRectangle => {
        try {
          if (!simpleRectangle || !simpleRectangle.simpleRectangleId) {
            console.warn('simpleRectangle invalide détecté:', simpleRectangle);
            return;
          }
          const points = simpleRectangle.getPath().getArray();
          const bounds = new google.maps.LatLngBounds();
          points.forEach((p) => bounds.extend(p));
          const ne = bounds.getNorthEast();
          const sw = bounds.getSouthWest();

          simpleRectanglesData[simpleRectangle.simpleRectangleId] = {
            points: points.map((p) => ({ lat: p.lat(), lng: p.lng() })),
            bounds: {
              lat: bounds.getCenter().lat(),
              lng: bounds.getCenter().lng(),
              width: ne.lng() - sw.lng(),
              height: ne.lat() - sw.lat()
            },
            area: this.calculateSimpleRectangleArea(simpleRectangle),
            solak_isInbound: simpleRectangle.solak_isInbound
          };
        } catch (error) {
          console.error(`Erreur lors de la collecte des données du simpleRectangle ${simpleRectangle?.simpleRectangleId}:`, error);
        }
      });
      return simpleRectanglesData;
    } catch (error) {
      console.error('Erreur lors de la collecte des données des simpleRectangles:', error);
      return {};
    }
  }

  /**
   * Charge les rectangles simples depuis les données sauvegardées (format `points`, ou ancien
   * format `bounds` seul : rectangle nord-sud).
   * @param {Object} simpleRectanglesData
   */
  loadSimpleRectanglesFromData(simpleRectanglesData) {
    try {
      if (!simpleRectanglesData || typeof simpleRectanglesData !== 'object') {
        console.warn('Données de simpleRectangles invalides:', simpleRectanglesData);
        return;
      }

      Object.entries(simpleRectanglesData).forEach(([simpleRectangleId, data]) => {
        try {
          if (!data || this.usedSimpleRectangleIds.has(simpleRectangleId)) return;

          let points = null;
          if (Array.isArray(data.points) && data.points.length === 4) {
            points = data.points.map((p) => new google.maps.LatLng(p.lat, p.lng));
          } else if (data.bounds) {
            const { lat, lng, width, height } = data.bounds;
            points = [
              new google.maps.LatLng(lat + height / 2, lng - width / 2),
              new google.maps.LatLng(lat + height / 2, lng + width / 2),
              new google.maps.LatLng(lat - height / 2, lng + width / 2),
              new google.maps.LatLng(lat - height / 2, lng - width / 2)
            ];
          }
          if (!points) {
            console.warn(`Données invalides pour le simpleRectangle ${simpleRectangleId}:`, data);
            return;
          }

          const simpleRectangle = new google.maps.Polygon({
            paths: points,
            ...(data.solak_isInbound ? STYLES.INBOUND_SIMPLE_RECTANGLE : STYLES.DEFAULT_SIMPLE_RECTANGLE),
            editable: false,
            draggable: true,
            map: this.drawingControl.map
          });
          simpleRectangle.solak_isInbound = data.solak_isInbound;
          simpleRectangle.simpleRectangleId = simpleRectangleId;
          this.drawnSimpleRectangles.push(simpleRectangle);
          this.usedSimpleRectangleIds.add(simpleRectangleId);
          this.setupSimpleRectangleListeners(simpleRectangle);
          this.updateSimpleRectangleLabel(simpleRectangle);
        } catch (error) {
          console.error(`Erreur lors du chargement du simpleRectangle ${simpleRectangleId}:`, error);
        }
      });
    } catch (error) {
      console.error('Erreur lors du chargement des simpleRectangles:', error);
    }
  }

  /**
   * Supprime tous les rectangles simples de la carte
   */
  clearAllSimpleRectangles() {
    [...this.drawnSimpleRectangles].forEach((r) => this.removeSimpleRectangle(r));
    this.drawnSimpleRectangles = [];
    this.usedSimpleRectangleIds.clear();
    this.selectedSimpleRectangle = null;
  }

  setLabelsVisibility(show) {
    this.labelsVisible = show;
    this.simpleRectangleLabels.forEach((label) => {
      if (label) {
        label.map = show ? this.drawingControl.map : null;
      }
    });
  }

  /**
   * Nettoie toutes les ressources lors de la suppression
   */
  onRemove() {
    this.clearAllSimpleRectangles();
  }
}

export default SimpleRectangle;
