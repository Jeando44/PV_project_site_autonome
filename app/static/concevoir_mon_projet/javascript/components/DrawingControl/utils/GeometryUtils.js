import { METERS_PER_LAT_DEGREE, SHAPE_TYPES, CUSTOM_EVENTS, TYPE_COUVERTURE_MAP } from "../constants.js";

// --- Support pour attachManualPathDrag (voir plus bas) ---
// Overlay invisible partagé, dont le seul rôle est d'exposer une MapCanvasProjection pour
// convertir des pixels DOM natifs en LatLng (google.maps.event.addListener(map, ...) ne suffit
// pas ici : voir le commentaire détaillé sur attachManualPathDrag).
let _sharedProjectionOverlay = null;
let _sharedProjectionMap = null;

function _getProjectionForMap(map) {
  if (_sharedProjectionOverlay && _sharedProjectionMap === map) {
    return _sharedProjectionOverlay.getProjection() || null;
  }
  if (_sharedProjectionOverlay) {
    _sharedProjectionOverlay.setMap(null);
  }
  _sharedProjectionOverlay = new google.maps.OverlayView();
  _sharedProjectionOverlay.onAdd = () => {};
  _sharedProjectionOverlay.draw = () => {};
  _sharedProjectionOverlay.onRemove = () => {};
  _sharedProjectionOverlay.setMap(map);
  _sharedProjectionMap = map;
  return _sharedProjectionOverlay.getProjection() || null;
}

function _domEventToLatLng(domEvent, map) {
  const projection = _getProjectionForMap(map);
  if (!projection) return null;
  const rect = map.getDiv().getBoundingClientRect();
  const point = new google.maps.Point(domEvent.clientX - rect.left, domEvent.clientY - rect.top);
  return projection.fromDivPixelToLatLng(point);
}

/**
 * Utilitaires pour les calculs géométriques
 */
export default class GeometryUtils {
  /**
   * Convertit des degrés en radians
   * @param {number} deg - Angle en degrés
   * @returns {number} Angle en radians
   */
  static degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  /**
   * Récupère les coordonnées (lat/lng) de l'adresse du projet, déjà géocodée lors de la création du
   * projet — cf. #parametre_project_hidden / localStorage "solarProjectData", même source que
   * PolygonPanelsManager.getProjectLatitude() — mais sans repli sur le centre de la carte : pour la
   * restriction géographique (cf. Config.PROJECT_RADIUS_LIMIT_KM), l'absence d'adresse doit désactiver
   * le contrôle plutôt que de le baser sur une position arbitraire.
   * @returns {{lat: number, lng: number}|null}
   */
  static getProjectAddressLatLng() {
    const parseFromJson = (raw) => {
      if (!raw) return null;
      try {
        let data = JSON.parse(raw);
        if (typeof data === 'string') data = JSON.parse(data);
        const lat = parseFloat(data?.latitude);
        const lng = parseFloat(data?.longitude);
        return (isNaN(lat) || isNaN(lng)) ? null : { lat, lng };
      } catch (e) {
        return null;
      }
    };

    const hiddenInput = document.getElementById('parametre_project_hidden');
    const fromHiddenInput = hiddenInput ? parseFromJson(hiddenInput.value) : null;
    if (fromHiddenInput) return fromHiddenInput;

    try {
      const stored = JSON.parse(localStorage.getItem('solarProjectData') || 'null');
      const fromStorage = parseFromJson(stored?.projectInfo?.adresseProjet);
      if (fromStorage) return fromStorage;
    } catch (e) {
      // Ignoré : aucune adresse disponible.
    }

    return null;
  }

  /**
   * Vérifie qu'un point (ex: centre d'une forme dessinée) reste dans le rayon d'action maximal
   * autorisé autour de l'adresse du projet (cf. Config.PROJECT_RADIUS_LIMIT_KM, injecté côté backend
   * dans window.PROJECT_RADIUS_LIMIT_KM — cf. app/routes/main.py:index()). Si l'adresse du projet
   * n'est pas encore disponible ou que la limite n'est pas configurée, le contrôle est ignoré
   * (fail-open) plutôt que de bloquer l'utilisateur sur une donnée absente.
   * @param {google.maps.LatLng} point - Point à vérifier (ex: centre d'une forme)
   * @returns {{allowed: boolean, distanceKm: number|null, limitKm: number|null}}
   */
  static checkWithinProjectRadius(point) {
    const limitKm = typeof window.PROJECT_RADIUS_LIMIT_KM === 'number' && !isNaN(window.PROJECT_RADIUS_LIMIT_KM)
      ? window.PROJECT_RADIUS_LIMIT_KM
      : null;
    const projectLatLng = GeometryUtils.getProjectAddressLatLng();

    if (!point || !projectLatLng || limitKm === null) {
      return { allowed: true, distanceKm: null, limitKm };
    }

    const projectPoint = new google.maps.LatLng(projectLatLng.lat, projectLatLng.lng);
    const distanceKm = google.maps.geometry.spherical.computeDistanceBetween(projectPoint, point) / 1000;

    return { allowed: distanceKm <= limitKm, distanceKm, limitKm };
  }

  /**
   * Déplace un point selon des coordonnées cartésiennes en mètres
   * @param {google.maps.LatLng} point - Point d'origine
   * @param {number} xMeters - Déplacement en mètres sur l'axe X (E-O)
   * @param {number} yMeters - Déplacement en mètres sur l'axe Y (N-S)
   * @returns {google.maps.LatLng} Nouveau point déplacé
   */
  static offsetPointInMeters(point, xMeters, yMeters) {
    // Facteurs de conversion
    const metersPerLat = METERS_PER_LAT_DEGREE;
    const metersPerLng = metersPerLat * Math.cos((point.lat() * Math.PI) / 180);

    // Conversion des mètres en degrés
    const deltaLat = yMeters / metersPerLat;
    const deltaLng = xMeters / metersPerLng;

    // Création du nouveau point
    return new google.maps.LatLng(
      point.lat() + deltaLat,
      point.lng() + deltaLng
    );
  }

  /**
   * Calcule la largeur d'un rectangle en mètres
   * @param {google.maps.LatLngBounds} bounds - Limites du rectangle
   * @returns {number} Largeur en mètres
   */
  static calculateWidth(bounds) {
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const width = Math.abs(ne.lat() - sw.lat()) * METERS_PER_LAT_DEGREE; // N-S
    return width;
  }

  /**
   * Calcule la longueur d'un rectangle en mètres
   * @param {google.maps.LatLngBounds} bounds - Limites du rectangle
   * @returns {number} Longueur en mètres
   */
  static calculateLength(bounds) {
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const metersPerLng =
      METERS_PER_LAT_DEGREE * Math.cos((ne.lat() * Math.PI) / 180);
    const length = Math.abs(ne.lng() - sw.lng()) * metersPerLng; // E-O
    return length;
  }
  /**
   * Calcule les dimensions d'un polygone roté sans prendre en compte la courbure de la Terre
   * @param {google.maps.Polygon} polygon - Polygone
   * @returns {Object} {width: number, length: number} Dimensions du polygone
   */
  static calculateDimensionsForRotatedPolygon(polygon) {
    const path = polygon.getPath().getArray();
    if (path.length < 4) {
      return { width: 0, length: 0 };
    }

    const bounds = new google.maps.LatLngBounds();
    path.forEach((point) => bounds.extend(point));
    const center = bounds.getCenter();

    const metersPerLat = METERS_PER_LAT_DEGREE;
    const metersPerLng =
      metersPerLat * Math.cos((center.lat() * Math.PI) / 180);

    const distanceBetween = (start, end) => {
      const dLat = (end.lat() - start.lat()) * metersPerLat;
      const dLng = (end.lng() - start.lng()) * metersPerLng;
      return Math.sqrt(dLat * dLat + dLng * dLng);
    };

    const length1 = distanceBetween(path[0], path[1]);
    const length2 = distanceBetween(path[2], path[3]);
    const width1 = distanceBetween(path[1], path[2]);
    const width2 = distanceBetween(path[3], path[0]);

    return {
      length: (length1 + length2) / 2,
      width: (width1 + width2) / 2,
    };
  }
  /**
   * Calcule l'aire d'un polygone en mètres carrés
   * @param {Array<google.maps.LatLng>} path - Points du polygone
   * @returns {number} Aire en mètres carrés
   */
  static calculateArea(path) {
    if (path.length < 3) return 0;

    // Pour les rectangles (4 points)
    if (path.length === 4) {
      // Vérifier si la forme a des dimensions stockées
      if (path[0].shape && path[0].shape._originalDimensions) {
        const { width, length } = path[0].shape._originalDimensions;
        return width * length;
      }

      // Calculer le centre pour obtenir les facteurs de conversion
      const center = GeometryUtils.calculateCenter(path);
      const metersPerLat = METERS_PER_LAT_DEGREE;
      const metersPerLng =
        metersPerLat * Math.cos((center.lat() * Math.PI) / 180);

      // Calculer les distances en mètres entre les points adjacents
      const sides = [];
      for (let i = 0; i < path.length; i++) {
        const j = (i + 1) % path.length;
        const dx = (path[j].lng() - path[i].lng()) * metersPerLng;
        const dy = (path[j].lat() - path[i].lat()) * metersPerLat;
        sides.push(Math.sqrt(dx * dx + dy * dy));
      }

      // Trier les côtés pour identifier la largeur et la longueur
      sides.sort((a, b) => a - b);
      const width = sides[0];
      const length = sides[2]; // Prendre le côté opposé

      // Aire = longueur × largeur
      return width * length;
    }

    // Pour les polygones non rectangulaires, utiliser une méthode euclidienne
    // Formule du shoelace (ou formule de l'aire de Gauss)
    let area = 0;
    const center = GeometryUtils.calculateCenter(path);
    const metersPerLat = METERS_PER_LAT_DEGREE;
    const metersPerLng =
      metersPerLat * Math.cos((center.lat() * Math.PI) / 180);

    for (let i = 0; i < path.length; i++) {
      const j = (i + 1) % path.length;

      // Convertir les coordonnées en mètres par rapport au centre
      const xi = (path[i].lng() - center.lng()) * metersPerLng;
      const yi = (path[i].lat() - center.lat()) * metersPerLat;
      const xj = (path[j].lng() - center.lng()) * metersPerLng;
      const yj = (path[j].lat() - center.lat()) * metersPerLat;

      area += xi * yj - xj * yi;
    }

    return Math.abs(area / 2);
  }

  /**
   * Calcule le centre d'un polygone
   * @param {Array<google.maps.LatLng>} path - Points du polygone
   * @returns {google.maps.LatLng} Centre du polygone
   */
  static calculateCenter(path) {
    const bounds = new google.maps.LatLngBounds();
    path.forEach((point) => bounds.extend(point));
    return bounds.getCenter();
  }

  /**
   * Calcule le contour d'un polygone "gonflé" vers l'extérieur d'une distance donnée (buffer),
   * par la méthode standard du "miter join" (décalage de chaque sommet le long de la bissectrice
   * de ses deux arêtes adjacentes). Exact pour un rectangle (angles à 90°, y compris après
   * rotation) ; approximation raisonnable pour un polygone convexe quelconque. Utilisé uniquement
   * pour le rendu visuel de la zone tampon des obstacles (cf. Obstacle*.js) — le calcul de masquage
   * réel des panneaux (ObstaclePanelsManager.js) reste basé sur des distances point-segment exactes.
   * @param {Array<google.maps.LatLng>} path - Sommets du polygone (dans l'ordre)
   * @param {number} bufferMeters - Distance de la zone tampon, en mètres
   * @returns {Array<google.maps.LatLng>} Sommets du contour gonflé
   */
  static bufferPolygonOutward(path, bufferMeters) {
    const points = Array.isArray(path) ? path : path.getArray();
    const n = points.length;
    if (n < 3 || !bufferMeters || bufferMeters <= 0) return points.slice();

    const centroid = GeometryUtils.calculateCenter(points);
    const metersPerLat = METERS_PER_LAT_DEGREE;
    const metersPerLng = metersPerLat * Math.cos((centroid.lat() * Math.PI) / 180);
    const toXY = (p) => ({
      x: (p.lng() - centroid.lng()) * metersPerLng,
      y: (p.lat() - centroid.lat()) * metersPerLat,
    });
    const xy = points.map(toXY);

    // Sens de parcours (aire signée) pour orienter les normales vers l'extérieur
    let signedArea = 0;
    for (let i = 0; i < n; i += 1) {
      const a = xy[i];
      const b = xy[(i + 1) % n];
      signedArea += a.x * b.y - b.x * a.y;
    }
    const ccw = signedArea > 0;

    const normalize = (v) => {
      const len = Math.hypot(v.x, v.y) || 1;
      return { x: v.x / len, y: v.y / len };
    };
    const outwardNormal = (v) => (ccw ? { x: v.y, y: -v.x } : { x: -v.y, y: v.x });

    const offsetXY = xy.map((curr, i) => {
      const prev = xy[(i - 1 + n) % n];
      const next = xy[(i + 1) % n];

      const n1 = outwardNormal(normalize({ x: curr.x - prev.x, y: curr.y - prev.y }));
      const n2 = outwardNormal(normalize({ x: next.x - curr.x, y: next.y - curr.y }));

      let bisector = { x: n1.x + n2.x, y: n1.y + n2.y };
      const bisectorLen = Math.hypot(bisector.x, bisector.y);
      bisector = bisectorLen < 1e-6 ? n1 : { x: bisector.x / bisectorLen, y: bisector.y / bisectorLen };

      const cosHalfAngle = bisector.x * n1.x + bisector.y * n1.y;
      // Évite les pointes extrêmes sur des angles très aigus (bevel implicite)
      const miterLength = bufferMeters / Math.max(cosHalfAngle, 0.2);

      return { x: curr.x + bisector.x * miterLength, y: curr.y + bisector.y * miterLength };
    });

    return offsetXY.map((p) => new google.maps.LatLng(
      centroid.lat() + p.y / metersPerLat,
      centroid.lng() + p.x / metersPerLng
    ));
  }

  /**
   * Calcule le contour rectangulaire (corridor) formé par le décalage perpendiculaire d'une ligne
   * à 2 points d'une distance "buffer" de part et d'autre — correspond exactement à la distance
   * point-segment utilisée par ObstaclePanelsManager pour le masquage des panneaux (pas d'arrondi
   * aux extrémités, cohérent avec l'algorithme réel).
   * @param {google.maps.LatLng} pointA - Premier point de la ligne
   * @param {google.maps.LatLng} pointB - Second point de la ligne
   * @param {number} bufferMeters - Distance de la zone tampon, en mètres
   * @returns {Array<google.maps.LatLng>} Sommets du corridor (polygone à 4 points)
   */
  static bufferLineCorridor(pointA, pointB, bufferMeters) {
    if (!bufferMeters || bufferMeters <= 0) return [pointA, pointB];
    const heading = google.maps.geometry.spherical.computeHeading(pointA, pointB);
    const a1 = google.maps.geometry.spherical.computeOffset(pointA, bufferMeters, heading + 90);
    const a2 = google.maps.geometry.spherical.computeOffset(pointA, bufferMeters, heading - 90);
    const b1 = google.maps.geometry.spherical.computeOffset(pointB, bufferMeters, heading + 90);
    const b2 = google.maps.geometry.spherical.computeOffset(pointB, bufferMeters, heading - 90);
    return [a1, b1, b2, a2];
  }

  /**
   * Active un déplacement manuel (translation directe du path) d'un Polygon/Polyline via
   * mousedown + mousemove/mouseup sur la carte.
   *
   * Nécessaire car sur une carte vectorielle (mapId défini, cf. GoogleMaps.js) le déplacement
   * natif (draggable:true) de Polygon/Polyline n'est pas fiable, contrairement à Circle/Rectangle
   * natifs qui restent draggable sans problème — d'où le bug "seul le cercle obstacle est
   * déplaçable" (ObstacleRectangle/ObstaclePolygon/ObstacleLine sont tous les trois représentés en
   * interne par un Polygon ou une Polyline, cf. leurs commentaires d'en-tête). Le drag natif de
   * ces formes doit être désactivé (`draggable:false`) pour éviter tout conflit avec ce mécanisme.
   *
   * IMPORTANT : l'API `google.maps.event` route un mousedown/mousemove/mouseup soit vers l'overlay
   * cliquable situé sous le pointeur (ex: un panneau solaire), soit vers la carte — jamais les
   * deux à la fois. Écouter ces événements via `google.maps.event.addListener(map, ...)` ne
   * fonctionne donc QUE quand rien de cliquable n'est sous le curseur : dès qu'un panneau se
   * trouve au même endroit que l'obstacle, l'API les attribue au panneau et nos écouteurs sur la
   * carte ne sont jamais appelés. Pour contourner ça, on écoute les événements DOM natifs en
   * phase de CAPTURE sur le conteneur de la carte (`map.getDiv()`) : un événement DOM natif est
   * toujours vu par un ancêtre en phase de capture, avant même que l'API Maps ne décide à quel
   * overlay l'attribuer. On reconvertit alors nous-mêmes les pixels DOM en LatLng via une
   * projection (cf. _domEventToLatLng/_getProjectionForMap ci-dessus) pour faire notre propre
   * test géométrique (containsLocation pour un polygone, isLocationOnEdge avec tolérance pour une
   * ligne à 2 points) et démarrer le déplacement nous-mêmes si le clic tombe sur CETTE forme,
   * indépendamment de ce qui est superposé visuellement.
   *
   * Volontairement SANS `map.setOptions({draggable:false/true})` : une première version
   * désactivait ainsi le panoramique de la carte pendant le déplacement, mais si le "true" de
   * restauration ratait ne serait-ce qu'une fois (mouseup manqué dans un cas limite), la carte
   * restait bloquée en draggable:false — ce qui semble aussi couper le déplacement natif des
   * formes de calepinage (même pipeline de gestes que le panoramique de la carte sur une carte
   * vectorielle), d'où le bug remonté "plus aucune forme déplaçable après un moment". À la place,
   * on distingue un clic d'un glissement par un seuil de déplacement (quelques pixels) : tant que
   * le seuil n'est pas franchi, l'événement natif continue de se propager normalement (le 'click'
   * de synthèse de l'API Maps sur la forme, utilisé pour la popover "zone tampon", n'est donc pas
   * perturbé) ; une fois le seuil franchi, seuls les mousemove/mouseup SUIVANTS voient leur
   * propagation stoppée (empêchant le panoramique concurrent de la carte), sans jamais toucher à
   * une option globale et persistante de la carte.
   *
   * @param {google.maps.Polygon|google.maps.Polyline} shape - Forme dont le path sera translaté
   * @param {google.maps.Map} map
   * @param {{onDragStart?:Function, onDrag?:Function, onDragEnd?:Function}} [callbacks]
   */
  static attachManualPathDrag(shape, map, callbacks = {}) {
    const DRAG_THRESHOLD_PX = 3;
    let isPending = false;   // mousedown reçu sur la forme, en attente de confirmation (clic ou glissement ?)
    let isDragging = false;  // glissement confirmé (seuil franchi)
    let startClientX = 0;
    let startClientY = 0;
    let lastLatLng = null;

    // Tolérance de saisie pour une ligne (2 points, sans aire) : ~1.5 m de part et d'autre du
    // trait, convertie en degrés (même ordre de grandeur que les autres tolérances/offsets de
    // labels déjà utilisés ailleurs dans ce module).
    const LINE_GRAB_TOLERANCE_DEG = 1.5 / METERS_PER_LAT_DEGREE;

    const isPointOnShape = (latLng) => {
      try {
        const path = shape.getPath();
        if (path.getLength() >= 3) {
          // Polygone (obstacle rectangle/polygone) : toute la surface est "prenable".
          return google.maps.geometry.poly.containsLocation(latLng, shape);
        }
        // Ligne obstacle (2 points) : pas d'aire, tolérance autour du trait.
        return google.maps.geometry.poly.isLocationOnEdge(latLng, shape, LINE_GRAB_TOLERANCE_DEG);
      } catch (_e) {
        return false;
      }
    };

    const endGesture = () => {
      isPending = false;
      const wasDragging = isDragging;
      isDragging = false;
      lastLatLng = null;
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      if (wasDragging && typeof callbacks.onDragEnd === 'function') callbacks.onDragEnd();
    };

    const onMouseMove = (domEvent) => {
      if (!isPending) return;

      if (!isDragging) {
        const dx = domEvent.clientX - startClientX;
        const dy = domEvent.clientY - startClientY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // pas encore assez de mouvement : peut-être un simple clic
        // Seuil franchi : on prend la main sur la suite du geste.
        isDragging = true;
        lastLatLng = _domEventToLatLng(domEvent, map);
        if (typeof callbacks.onDragStart === 'function') callbacks.onDragStart();
      }

      domEvent.preventDefault();
      domEvent.stopPropagation();

      const latLng = _domEventToLatLng(domEvent, map);
      if (!latLng || !lastLatLng) return;
      const dLat = latLng.lat() - lastLatLng.lat();
      const dLng = latLng.lng() - lastLatLng.lng();
      const path = shape.getPath();
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        path.setAt(i, new google.maps.LatLng(p.lat() + dLat, p.lng() + dLng));
      }
      lastLatLng = latLng;
      if (typeof callbacks.onDrag === 'function') callbacks.onDrag();
    };

    const onMouseUp = (domEvent) => {
      if (isDragging) {
        domEvent.preventDefault();
        domEvent.stopPropagation();
      }
      endGesture();
    };

    const onMouseDown = (domEvent) => {
      if (isPending || !shape.getMap()) return;
      const latLng = _domEventToLatLng(domEvent, map);
      if (!latLng || !isPointOnShape(latLng)) return;

      // Ne PAS empêcher la propagation ici : tant que le seuil n'est pas franchi (cf. onMouseMove),
      // on laisse l'API Maps traiter normalement ce mousedown, pour que son 'click' de synthèse
      // (popover "zone tampon") continue de fonctionner en cas de simple clic sans glissement.
      isPending = true;
      startClientX = domEvent.clientX;
      startClientY = domEvent.clientY;

      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mouseup', onMouseUp, true);
    };

    // Phase de capture, sur le conteneur DOM de la carte : voir la note ci-dessus.
    map.getDiv().addEventListener('mousedown', onMouseDown, true);
  }

  /**
   * Récupère les points d'un rectangle
   * @param {google.maps.Rectangle} rectangle - Rectangle
   * @returns {Array<google.maps.LatLng>} Points du rectangle
   */
  static getRectanglePoints(rectangle) {
    const bounds = rectangle.getBounds();
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const nw = new google.maps.LatLng(ne.lat(), sw.lng());
    const se = new google.maps.LatLng(sw.lat(), ne.lng());

    // Retourner les points dans le sens horaire en commençant par le coin nord-est
    return [ne, se, sw, nw];
  }

  /**
   * Fait pivoter un point autour d'un centre
   * @param {google.maps.LatLng} point - Point à pivoter
   * @param {google.maps.LatLng} center - Centre de rotation
   * @param {number} angle - Angle de rotation en degrés
   * @returns {google.maps.LatLng} Point pivoté
   */
  static rotatePoint(point, center, angle) {
    const rad = (angle * Math.PI) / 180;

    // Conversion en mètres pour les calculs
    const metersPerLat = METERS_PER_LAT_DEGREE;
    const metersPerLng =
      metersPerLat * Math.cos((center.lat() * Math.PI) / 180);

    // Conversion des coordonnées en mètres relatifs au centre
    const x = (point.lng() - center.lng()) * metersPerLng;
    const y = (point.lat() - center.lat()) * metersPerLat;

    // Rotation en mètres
    const newX = x * Math.cos(rad) - y * Math.sin(rad);
    const newY = x * Math.sin(rad) + y * Math.cos(rad);

    // Reconversion en lat/lng
    return new google.maps.LatLng(
      center.lat() + newY / metersPerLat,
      center.lng() + newX / metersPerLng
    );
  }

  /**
   * Calcule le score solaire en fonction de l'angle
   * @param {number} angle - Angle actuel
   * @param {number} optimalAzimuth - Azimuth optimal
   * @returns {number} Score entre 0 et 1
   */
  static calculateSolarScore(angle, optimalAzimuth) {
    // Normaliser les angles dans [-180,180]
    angle = GeometryUtils.convertAzimuthTo180Range(angle);
    optimalAzimuth = GeometryUtils.convertAzimuthTo180Range(optimalAzimuth);

    // Calculer la différence d'angle dans la plage [-180,180]
    let angleDiff = Math.abs(angle - optimalAzimuth);
    if (angleDiff > 180) {
      angleDiff = 360 - angleDiff;
    }

    // Plus le score est proche de 1, plus l'orientation est optimale
    return 1 - angleDiff / 180;
  }

  /**
   * Calcule la distance à plat entre deux points LatLng
   * @param {google.maps.LatLng} p1 - Premier point
   * @param {google.maps.LatLng} p2 - Deuxième point
   * @returns {number} Distance en mètres
   */
  static calculateFlatDistance(p1, p2) {
    if (!p1 || !p2) return 0;

    // Obtenir la latitude moyenne pour calculer la conversion lng en mètres
    const avgLat = (p1.lat() + p2.lat()) / 2;

    // Facteurs de conversion de degrés en mètres (constants à cette latitude)
    const metersPerLat = METERS_PER_LAT_DEGREE;
    const metersPerLng = metersPerLat * Math.cos((avgLat * Math.PI) / 180);

    // Calculer les différences en mètres
    const dLat = (p2.lat() - p1.lat()) * metersPerLat;
    const dLng = (p2.lng() - p1.lng()) * metersPerLng;

    // Théorème de Pythagore pour la distance à plat
    return Math.sqrt(dLat * dLat + dLng * dLng);
  }

  /**
   * Calcule le nombre de panneaux solaires que peut contenir une forme
   * @param {google.maps.Rectangle|Array<google.maps.LatLng>} shape - Rectangle ou polygone
   * @param {string} orientation - Orientation des panneaux ('paysage' ou 'portrait')
   * @returns {Object} {total: number, numCols: number, numRows: number} Nombre de panneaux solaires
   */
  static calculateNumberOfPanels(shape, orientation) {
    // Définir les dimensions du panneau avec espacement
    const form = document.querySelector(`#form-${shape.pvId}`);
    if (!form) {
      console.error("Form not found");
      return {
        total: 0,
        numCols: 0,
        numRows: 0,
        dimensions: {
          length: 0,
          width: 0,
        },
      };
    }
    if (!shape.pvId) {
      console.error("pvId not found");
      return {
        total: 0,
        numCols: 0,
        numRows: 0,
      };
    }

    // Check des values du selecteur de dimensions
    const dimensionsPanneauxSelect = form.querySelector(
      `#dimensionsPanneaux-${shape.pvId}`
    );
    if (!dimensionsPanneauxSelect) {
      console.error("dimensionsPanneauxSelect not found");
      return {
        total: 0,
        numCols: 0,
        numRows: 0,
      };
    }

    // Récupérer les dimensions du panneau
    let panelLength, panelWidth;

    if (dimensionsPanneauxSelect.value === "Autres_dimensions") {
      panelLength = Number(
        form.querySelector(`#longueurPanneau-${shape.pvId}`).value
      ); // valeur en millimètres
      panelWidth = Number(
        form.querySelector(`#largeurPanneau-${shape.pvId}`).value
      ); // valeur en millimètres
    } else {
      panelLength = Number(dimensionsPanneauxSelect.value.split("x")[0]); // valeur en millimètres
      panelWidth = Number(dimensionsPanneauxSelect.value.split("x")[1]); // valeur en millimètres
    }

    // Récupérer l'espacement entre les panneaux
    // Espacement X == espacement entre les panneaux en hauteur (N-S)
    // Espacement Y == espacement entre les panneaux en largeur (E-O)
    let espacementPanneauxX = Number(
      form.querySelector(`#espacementPanneauxX-${shape.pvId}`).value
    ); // valeur en millimètres
    let espacementPanneauxY = Number(
      form.querySelector(`#espacementPanneauxY-${shape.pvId}`).value
    ); // valeur en millimètres

    // Récupérer l'espacement avec les bords des formes
    let espacementBords = Number(
      form.querySelector(`#espacementBords-${shape.pvId}`)?.value || 0
    ); // valeur en millimètres

    // Ajouter l'espacement minimal aux dimensions du panneau
    let panelWithSpacingLength = panelLength + espacementPanneauxX;
    let panelWithSpacingWidth = panelWidth + espacementPanneauxY;

    // Utiliser les dimensions originales de la forme si disponibles
    let shapeLength, shapeWidth;

    if (shape._originalDimensions) {
      shapeLength = shape._originalDimensions.length.toFixed(2);
      shapeWidth = shape._originalDimensions.width.toFixed(2);
    } else {
      // Si pas de dimensions originales, calculer à partir de la bounding box
      const bounds = new google.maps.LatLngBounds();
      if (shape instanceof google.maps.Rectangle) {
        bounds.union(shape.getBounds());
      } else if (shape instanceof google.maps.Polygon) {
        shape.getPath().forEach((point) => bounds.extend(point));
      }
      shapeLength = GeometryUtils.calculateLength(bounds).toFixed(2);
      shapeWidth = GeometryUtils.calculateWidth(bounds).toFixed(2);
    }

    // Prendre en compte l'espacement avec les bords pour les dimensions disponibles
    let availableShapeLength = Math.max(0, shapeLength - (2 * espacementBords / 1000));
    let availableShapeWidth = Math.max(0, shapeWidth - (2 * espacementBords / 1000));

    // Déduction des deltas de la structure (Marge de sécurité)
    const typeCouvertureEl = form.querySelector(`#type_de_structure-${shape.pvId}`) || document.querySelector(`select[id^="type_de_structure"]`);
    const referenceSIEl = form.querySelector(`#referenceSI-${shape.pvId}`) || document.querySelector(`select[id^="referenceSI"]`);
    const typeCouverture = typeCouvertureEl ? typeCouvertureEl.value : null;
    const referenceSI = referenceSIEl ? referenceSIEl.value : null;

    let dX = 0;
    let dY = 0;
    if (typeCouverture && referenceSI && TYPE_COUVERTURE_MAP && TYPE_COUVERTURE_MAP[typeCouverture]) {
      const siData = TYPE_COUVERTURE_MAP[typeCouverture].find(s => s.id === referenceSI);
      if (siData) {
        dX = parseFloat(siData.dX || 0) / 1000;
        dY = parseFloat(siData.dY || 0) / 1000;
      }
    }

    if (availableShapeLength >= availableShapeWidth) {
      availableShapeLength = Math.max(0, availableShapeLength - dX);
      availableShapeWidth = Math.max(0, availableShapeWidth - dY);
    } else {
      availableShapeLength = Math.max(0, availableShapeLength - dY);
      availableShapeWidth = Math.max(0, availableShapeWidth - dX);
    }

    // Déduction de l'espace occupé par les joints de dilatation
    const jointDilatation = Number(form.querySelector(`#joint_dilatation-${shape.pvId}`)?.value || 0) / 1000;
    const limitDilatation = Number(form.querySelector(`#limit_dilatation_m-${shape.pvId}`)?.value || 0);

    const penteTypeSelect = form.querySelector(`#toiture_pente_type-${shape.pvId}`) || document.getElementById('toiture_pente_type');
    const penteType = penteTypeSelect ? penteTypeSelect.value : 'Monopente';
    const pente1Input = form.querySelector(`#pente-${shape.pvId}`) || document.getElementById('pente');
    const pente1 = pente1Input ? parseFloat(pente1Input.value) || 0 : 0;
    const pente2Input = form.querySelector(`#pente2-${shape.pvId}`) || document.getElementById('pente2');
    const pente2 = pente2Input ? parseFloat(pente2Input.value) || pente1 : pente1;
    const asymInput = form.querySelector(`#asymetrie_percent-${shape.pvId}`) || document.getElementById('asymetrie_percent');
    const asymetrie = asymInput ? parseFloat(asymInput.value) / 100 : 0.4;
    const faitageInput = form.querySelector(`#largeur_faitage_mm-${shape.pvId}`) || document.getElementById('largeur_faitage_mm');
    const fVal = faitageInput ? parseFloat(faitageInput.value) : NaN;
    const faitageMeters = !isNaN(fVal) ? fVal / 1000 : 0.5;

    let effLen = (orientation === "portrait" ? panelWidth : panelLength) / 1000; // Axe X (Largeur du panneau en portrait)
    let effWid = (orientation === "portrait" ? panelLength : panelWidth) / 1000; // Axe Y (Longueur du panneau en portrait)
    let spaceLen = espacementPanneauxX / 1000; // Espacement X
    let spaceWid = espacementPanneauxY / 1000; // Espacement Y

    const lengthIndices = shape._lengthIndices || [0, 2];
    const indicesInverted = !(lengthIndices.includes(0) && lengthIndices.includes(2));
    if (indicesInverted) {
      let tempEff = effLen; effLen = effWid; effWid = tempEff;
      let tempSp = spaceLen; spaceLen = spaceWid; spaceWid = tempSp;
      let tempD = dX; dX = dY; dY = tempD;
    }

    const angleRad = Math.abs(shape.panelsRotation || 0) * Math.PI / 180;
    const rotEffLen = Math.abs(effLen * Math.cos(angleRad)) + Math.abs(effWid * Math.sin(angleRad));
    const rotEffWid = Math.abs(effLen * Math.sin(angleRad)) + Math.abs(effWid * Math.cos(angleRad));

    const computeCount = (available, pSize, spacing, startMargin, endMargin, limitDil, jointDil) => {
      let usable = available - startMargin - endMargin;
      if (limitDil > 0) usable -= Math.floor(available / limitDil) * jointDil;
      return Math.max(0, Math.floor((Math.max(0, usable) + spacing) / (pSize + spacing)));
    };

    const numCols = computeCount(shapeLength, rotEffLen, spaceLen, (espacementBords / 1000) + dX / 2, (espacementBords / 1000) + dX / 2, limitDilatation, jointDilatation);

    let numRows = 0;
    let totalRealWidth = 0;
    const pans = [];
    if (penteType === 'Monopente') pans.push({ startFrac: 0, endFrac: 1, slope: pente1, startIsEave: true, endIsEave: true });
    else if (penteType === 'Bipente_symetrique') { pans.push({ startFrac: 0, endFrac: 0.5, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: 0.5, endFrac: 1, slope: pente1, startIsEave: false, endIsEave: true }); }
    else if (penteType === 'Bipente_asymetrique') { pans.push({ startFrac: 0, endFrac: asymetrie, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: asymetrie, endFrac: 1, slope: pente2, startIsEave: false, endIsEave: true }); }
    else if (penteType === 'Multipente') { pans.push({ startFrac: 0, endFrac: 0.25, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: 0.25, endFrac: 0.5, slope: pente1, startIsEave: false, endIsEave: false }); pans.push({ startFrac: 0.5, endFrac: 0.75, slope: pente1, startIsEave: false, endIsEave: false }); pans.push({ startFrac: 0.75, endFrac: 1, slope: pente1, startIsEave: false, endIsEave: true }); }

    pans.forEach(pan => {
      const panProjectedWidth = shapeWidth * (pan.endFrac - pan.startFrac);
      const cosSlope = Math.max(Math.cos(pan.slope * Math.PI / 180), 0.1);
      
      let panRealWidth;
      let currentEffWid;
      
      if (isFlat) { // Pente toiture = 0° (Toiture terrasse / Petit champ solaire)
        panRealWidth = panProjectedWidth; // La dimension du toit n'est pas modifiée
        currentEffWid = rotEffWid * cosSlope; // L'encombrement du panneau est sa projection au sol
      } else { // Pente toiture > 0°
        panRealWidth = panProjectedWidth / cosSlope;
        currentEffWid = rotEffWid;
      }
      
      totalRealWidth += panRealWidth;
      const startMargin = pan.startIsEave ? ((espacementBords / 1000) + dY / 2) : (faitageMeters / 2);
      const endMargin = pan.endIsEave ? ((espacementBords / 1000) + dY / 2) : (faitageMeters / 2);
      numRows += computeCount(panRealWidth, currentEffWid, spaceWid, startMargin, endMargin, limitDilatation, jointDilatation);
    });

    // Calcul exact des dimensions (Source de vérité unique)
    const Njx = limitDilatation > 0 ? Math.floor(shapeLength / limitDilatation) : 0;
    const Njy = limitDilatation > 0 ? Math.floor(totalRealWidth / limitDilatation) : 0;
    
    // L_champ = (l_pv * Nb_C) + ((Nb_C - 1) * X) + (N_joint * J_dilat)
    const L_champ = numCols > 0 ? (rotEffLen * numCols) + ((numCols - 1) * spaceLen) + (Njx * jointDilatation) : 0;
    
    const flatCosSlope = isFlat ? Math.max(Math.cos(pente1 * Math.PI / 180), 0.1) : 1;
    const effectiveRotEffWid = isFlat ? rotEffWid * flatCosSlope : rotEffWid;
    const W_champ = numRows > 0 ? (effectiveRotEffWid * numRows) + ((numRows - 1) * spaceWid) + (Njy * jointDilatation) : 0;

    // L_hors-tout = L_champ + Marge de fixation technique (dX/dY)
    let L_hors_tout = numCols > 0 ? L_champ + dX : 0;
    let W_hors_tout = numRows > 0 ? W_champ + dY : 0;

    // GARDE-FOU STRICT : Bloquer et ajuster si le calcul dépasse l'espace toiture
    let finalCols = numCols;
    let finalRows = numRows;

    if (L_hors_tout > shapeLength && finalCols > 0) {
        finalCols--;
        const new_Njx = limitDilatation > 0 ? Math.floor(shapeLength / limitDilatation) : 0;
        const new_L_champ = finalCols > 0 ? (rotEffLen * finalCols) + ((finalCols - 1) * spaceLen) + (new_Njx * jointDilatation) : 0;
        L_hors_tout = finalCols > 0 ? new_L_champ + dX : 0;
    }
    if (W_hors_tout > totalRealWidth && finalRows > 0) {
        finalRows--;
        const new_Njy = limitDilatation > 0 ? Math.floor(totalRealWidth / limitDilatation) : 0;
        const new_W_champ = finalRows > 0 ? (rotEffWid * finalRows) + ((finalRows - 1) * spaceWid) + (new_Njy * jointDilatation) : 0;
        W_hors_tout = finalRows > 0 ? new_W_champ + dY : 0;
    }

    // Arrondi strict à 2 décimales
    L_hors_tout = Math.round((L_hors_tout + Number.EPSILON) * 100) / 100;
    W_hors_tout = Math.round((W_hors_tout + Number.EPSILON) * 100) / 100;

    // Calculer la surface des panneaux
    const singlePanelArea = (panelLength * panelWidth) / 1000000;
    const totalPanelArea = singlePanelArea * (finalCols * finalRows);

    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER));
    return {
      total: Math.max(0, finalCols * finalRows),
      numCols: Math.max(0, finalCols),
      numRows: Math.max(0, finalRows),
      totalPanelLength: L_hors_tout.toFixed(2),
      totalPanelWidth: W_hors_tout.toFixed(2),
      totalPanelArea: totalPanelArea.toFixed(2),
      dimensions: {
        length: shapeLength,
        width: shapeWidth,
      },
    };
  }

  /**
   * Calcule l'angle d'orientation de la largeur d'un polygone
   * @param {google.maps.Polygon} polygon - Le polygone
   * @returns {number} L'angle en degrés
   */
  static getWidthAzimuth(polygon) {
    try {
      // Récupérer le chemin du polygone
      const path = polygon.getPath();
      if (!path || path.getLength() < 4)
        throw new Error("Polygon has less than 4 points");

      // Obtenir l'angle entre les points 0 et 1
      let heading = google.maps.geometry.spherical.computeHeading(
        path.getAt(0),
        path.getAt(1)
      );
      // Si le polygone est un LineToPolygon, on calcule l'angle entre les points 1 et 2, car les points ne sont pas dessinés dans le même ordre qu'une shape avec panneaux solaires
      if (polygon.type === SHAPE_TYPES.LINE_TO_POLYGON || polygon.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
        let point1 = path.getAt(0);
        let point2 = path.getAt(1);
        let point3 = path.getAt(2);
        let point4 = path.getAt(3);
        let distance_point1_2 = google.maps.geometry.spherical.computeDistanceBetween(point1, point2)
        let distance_point1_3 = google.maps.geometry.spherical.computeDistanceBetween(point1, point3)
        let distance_point1_4 = google.maps.geometry.spherical.computeDistanceBetween(point1, point4)
        if (distance_point1_2 <= distance_point1_3) {
          if (distance_point1_2 <= distance_point1_4) {
            heading = google.maps.geometry.spherical.computeHeading(
              point1,
              point2
            );
          } else {
            heading = google.maps.geometry.spherical.computeHeading(
              point1,
              point4
            );
          }
        } else {
          if (distance_point1_3 <= distance_point1_4) {
            heading = google.maps.geometry.spherical.computeHeading(
              point1,
              point3
            );
          } else {
            heading = google.maps.geometry.spherical.computeHeading(
              point1,
              point4
            );
          }
        }
        // heading = google.maps.geometry.spherical.computeHeading(
        //   path.getAt(1),
        //   path.getAt(2)
        // );
      }
      return heading;
    } catch (error) {
      console.error("Erreur lors du calcul de l'angle de largeur:", error);
      return 0;
    }
  }


  /**
   * Calcule l'aire d'un polygone à partir de coordonnées brutes [lng, lat]
   * @param {Array} coordinates - Tableau de coordonnées [lng, lat]
   * @returns {number} Aire en mètres carrés
   */
  static calculateAreaFromCoordinates(coordinates) {
    if (!coordinates || coordinates.length < 3) return 0;

    // Convertir les coordonnées [lng, lat] en google.maps.LatLng
    const latLngPath = coordinates.map(coord =>
      new google.maps.LatLng(coord[1], coord[0]) // [lat, lng]
    );

    // Utiliser la méthode existante
    return GeometryUtils.calculateArea(latLngPath);
  }
}