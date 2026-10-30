import { STYLES } from '../constants.js';

/**
 * Cycle de vie de Terra Draw (adapter Google Maps + un ensemble de modes nommés).
 *
 * Ce moteur ne connaît rien du métier des outils qui l'utilisent : à chaque tracé terminé, il
 * convertit la feature Terra Draw (GeoJSON) en forme google.maps.* native (Polygon/Rectangle/
 * Circle/Polyline selon le mode) puis la retire du store Terra Draw, avant de la transmettre au
 * callback fourni à start(modeName, callback). Terra Draw ne sert donc qu'à capter le tracé — la
 * forme persistée redevient une forme google.maps.* 100% standard, exactement comme avant la
 * migration (cf. StorageManager.js, ShapeHandler.js, ObstaclePanelsManager.js...), pour bénéficier
 * sans adaptation de tout l'écosystème existant (obstacles, formulaire, sauvegarde, export PDF/DXF).
 *
 * Modes enregistrés (un par outil, pour que Terra Draw sache nativement pour quel usage un tracé a
 * été démarré — remplace les flags obstacleMode/simpleRectangleMode/simplePolygonMode utilisés par
 * l'ancien google.maps.drawing.DrawingManager, qui ne pouvait avoir qu'un seul mode actif à la fois
 * de toute façon) :
 *   - 'pv-poly', 'obstacle-polygon', 'simple-polygon',
 *     'aper-surface', 'aper-exclusion', 'maison-polygon' → TerraDrawPolygonMode   → google.maps.Polygon
 *   - 'obstacle-rectangle', 'simple-rectangle'          → TerraDrawRectangleMode → google.maps.Rectangle
 *   - 'obstacle-circle', 'simple-circle'                → TerraDrawCircleMode    → google.maps.Circle
 *   - 'simple-line'                                     → TerraDrawLineStringMode → google.maps.Polyline
 */
export default class TerraDrawEngine {
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.map = null;
    this.draw = null;
    this.ready = false;
    this._readyPromise = null;
    this._onFeatureComplete = null; // callback(nativeShape) fourni par start()
    this._activeMode = null;

    this._converters = {
      'pv-poly': (feature) => this._polygonToNative(feature),
      'obstacle-polygon': (feature) => this._polygonToNative(feature),
      'simple-polygon': (feature) => this._polygonToNative(feature),
      // Loi APER (surfaces "+ Surface" / exclusions "- Exclusion", cf. polygone_aper.js) : même
      // conversion que les autres polygones, la forme native résultante reste un google.maps.Polygon
      // standard sur lequel AperPolygonManager::_initPolygon applique ensuite son propre style/JSTS.
      'aper-surface': (feature) => this._polygonToNative(feature),
      'aper-exclusion': (feature) => this._polygonToNative(feature),
      // Calepinage résidentiel (contour de maison, cf. polygon_maison.js) : même conversion générique
      // — MaisonPolygonManager::startDraw() applique ensuite son propre style (bleu) et réactive
      // editable/draggable via setOptions(), exactement comme AperPolygonManager ci-dessus. Remplace
      // l'ancien google.maps.drawing.DrawingManager dédié à ce gestionnaire (bibliothèque "drawing"
      // dépréciée par Google, cf. STYLES/commentaires du reste de ce moteur).
      'maison-polygon': (feature) => this._polygonToNative(feature),
      'obstacle-rectangle': (feature) => this._rectangleToNative(feature),
      'simple-rectangle': (feature) => this._rectangleToNative(feature),
      'obstacle-circle': (feature) => this._circleToNative(feature),
      'simple-circle': (feature) => this._circleToNative(feature),
      'simple-line': (feature) => this._linestringToNative(feature),
    };
  }

  /**
   * Initialise l'instance Terra Draw sur la carte fournie, avec tous les modes ci-dessus déjà
   * enregistrés. Idempotent : les appels suivants réutilisent la même initialisation.
   * @param {google.maps.Map} map
   */
  async init(map) {
    if (this._readyPromise) return this._readyPromise;
    this.map = map;

    this._readyPromise = (async () => {
      this._ensureLibraryLoaded();

      // CORRECTIF : DrawingControl.onAdd(map) (donc cet init()) est appelé très tôt dans le cycle
      // de vie de la carte Google — avant que sa structure DOM interne ne soit stabilisée. Sans
      // attendre 'idle', l'adaptateur Terra Draw plante systématiquement au tout premier chargement
      // de la page (TypeError: Cannot read properties of null (reading 'addEventListener') au sein
      // même de la librairie, lors de draw.start()) : terraDrawEngine.ready reste alors bloqué à
      // false pour toute la session, quel que soit le nombre de clics sur les boutons de dessin.
      // Même précaution que terra_draw/main_calepinage.js::attachToMainMap (attente de 'idle').
      await this._waitForMapIdle();

      const adapter = new window.terraDrawGoogleMapsAdapter.TerraDrawGoogleMapsAdapter({
        map: this.map,
        lib: google.maps
      });

      const polygonModes = ['pv-poly', 'obstacle-polygon', 'simple-polygon', 'aper-surface', 'aper-exclusion', 'maison-polygon'];
      const rectangleModes = ['obstacle-rectangle', 'simple-rectangle'];
      const circleModes = ['obstacle-circle', 'simple-circle'];
      const lineModes = ['simple-line'];

      const polygonStyles = {
        fillColor: STYLES.DEFAULT_SHAPE.fillColor,
        fillOpacity: 0.45,
        outlineColor: '#FF9800',
        outlineWidth: 2
      };
      const lineStyles = {
        lineStringColor: STYLES.DEFAULT_LINE.strokeColor,
        lineStringWidth: STYLES.DEFAULT_LINE.strokeWeight,
        lineStringOpacity: STYLES.DEFAULT_LINE.strokeOpacity
      };

      // Aucun de ces modes n'est éditable via la propre sélection de Terra Draw : la forme
      // convertie (google.maps.*) gère elle-même déplacement/redimensionnement/rotation ensuite
      // (ShapeHandler, GeometryUtils.attachManualPathDrag...), comme avant la migration.
      const noEditFlags = { feature: { draggable: false, coordinates: { midpoints: false, draggable: false, deletable: false } } };
      const selectFlags = {};
      [...polygonModes, ...rectangleModes, ...circleModes, ...lineModes].forEach((modeName) => {
        selectFlags[modeName] = noEditFlags;
      });

      const modes = [
        ...polygonModes.map((modeName) => new window.terraDraw.TerraDrawPolygonMode({ modeName, styles: polygonStyles })),
        ...rectangleModes.map((modeName) => new window.terraDraw.TerraDrawRectangleMode({ modeName, styles: polygonStyles })),
        ...circleModes.map((modeName) => new window.terraDraw.TerraDrawCircleMode({ modeName, styles: polygonStyles })),
        ...lineModes.map((modeName) => new window.terraDraw.TerraDrawLineStringMode({ modeName, styles: lineStyles })),
        new window.terraDraw.TerraDrawSelectMode({ flags: selectFlags }),
        new window.terraDraw.TerraDrawRenderMode({ modeName: 'render' })
      ];

      this.draw = new window.terraDraw.TerraDraw({ adapter, modes });

      this.draw.start();
      this.draw.setMode('select');
      this._wireEvents();
      this.ready = true;
    })();

    return this._readyPromise;
  }

  /**
   * Attend que la carte ait émis 'idle' au moins une fois (rendu/DOM interne stabilisés) avant de
   * laisser Terra Draw s'attacher dessus. Se résout immédiatement si la carte est déjà "idle" au
   * moment de l'appel (cas des activations ultérieures, après le premier chargement).
   */
  _waitForMapIdle() {
    return new Promise((resolve) => {
      if (!this.map) {
        resolve();
        return;
      }
      if (window.google && google.maps && google.maps.event && google.maps.event.addListenerOnce) {
        google.maps.event.addListenerOnce(this.map, 'idle', resolve);
      } else {
        // Filet de sécurité si l'API 'event' n'est pas disponible pour une raison quelconque.
        setTimeout(resolve, 1000);
      }
    });
  }

  _ensureLibraryLoaded() {
    if (typeof window.terraDraw === 'undefined' || typeof window.terraDrawGoogleMapsAdapter === 'undefined') {
      throw new Error(
        "Terra Draw n'est pas chargé. Vérifiez que vendor/terra-draw.umd.js et " +
        "vendor/terra-draw-google-maps-adapter.umd.js sont bien inclus dans headLinks.html, avant GoogleMaps.js."
      );
    }
  }

  _wireEvents() {
    this.draw.on('finish', (id) => {
      const snapshot = this.draw.getSnapshot();
      const feature = snapshot.find((f) => f.id === id);
      if (!feature) return;

      const modeName = feature.properties && feature.properties.mode;
      const converter = this._converters[modeName];
      if (!converter) {
        // Mode inconnu de ce moteur (ex: un futur outil de mesure générique) — rien à faire ici.
        return;
      }

      try {
        this.draw.removeFeatures([id]);
      } catch (error) {
        console.warn('[TerraDrawEngine] Impossible de retirer la feature Terra Draw après conversion:', error);
      }

      // CORRECTIF (bug : après le tracé d'un rectangle ou d'un polygone simple, plus aucun champ PV
      // ni forme simple ne se déplaçait jusqu'au rechargement ; le cercle n'était pas touché) :
      // 'finish' est émis PENDANT le pointerup du dernier clic, et ce clic tombe sur un sommet de la
      // forme (coin du rectangle, 1er point du polygone). La forme native, rendue éditable aussitôt
      // par l'appelant, posait donc une poignée de sommet sous le pointeur au milieu du geste : Google
      // Maps en gardait un état de glissé incohérent, qui bloquait tous les déplacements. Le cercle
      // n'a pas de poignée au point du dernier clic. La forme native n'est donc créée qu'une fois le
      // geste entièrement terminé (mouseup + click traités, image suivante rendue).
      const callback = this._onFeatureComplete;
      const terminer = () => {
        let nativeShape = null;
        try {
          nativeShape = converter(feature);
        } catch (error) {
          console.error(`[TerraDrawEngine] Erreur de conversion pour le mode '${modeName}':`, error);
        }
        if (!nativeShape || typeof callback !== 'function') return;
        try {
          callback(nativeShape);
        } catch (error) {
          // Sans ça, l'appelant n'atteignait jamais sa fin de session : le moteur restait en mode
          // tracé et captait les gestes de la carte (même blocage des déplacements).
          console.error(`[TerraDrawEngine] Erreur après le tracé '${modeName}':`, error);
          if (typeof this.drawingControl?.finishDrawingSession === 'function') {
            this.drawingControl.finishDrawingSession();
          } else {
            this.stop();
          }
        }
      };
      requestAnimationFrame(() => setTimeout(terminer, 0));
    });
  }

  /**
   * Convertit un anneau GeoJSON ([lng, lat], refermé sur lui-même) en tableau de
   * google.maps.LatLng, sans le point de fermeture dupliqué.
   * @param {Array<[number, number]>} ring
   * @returns {google.maps.LatLng[]}
   */
  _ringToLatLngPoints(ring) {
    const points = ring.slice(0, -1);
    return points.map(([lng, lat]) => new google.maps.LatLng(lat, lng));
  }

  _polygonToNative(feature) {
    const path = this._ringToLatLngPoints(feature.geometry.coordinates[0]);
    if (!path || path.length < 3) return null;
    return new google.maps.Polygon({
      paths: path,
      map: this.map,
      fillColor: STYLES.DEFAULT_SHAPE.fillColor,
      fillOpacity: STYLES.DEFAULT_SHAPE.fillOpacity,
      strokeWeight: STYLES.DEFAULT_SHAPE.strokeWeight,
      strokeColor: STYLES.DEFAULT_SHAPE.strokeColor,
      strokeOpacity: STYLES.DEFAULT_SHAPE.strokeOpacity,
      editable: false,
      draggable: true
    });
  }

  _rectangleToNative(feature) {
    const points = this._ringToLatLngPoints(feature.geometry.coordinates[0]);
    if (!points || points.length < 3) return null;
    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    return new google.maps.Rectangle({
      bounds,
      map: this.map,
      fillColor: STYLES.DEFAULT_SHAPE.fillColor,
      fillOpacity: STYLES.DEFAULT_SHAPE.fillOpacity,
      strokeWeight: STYLES.DEFAULT_SHAPE.strokeWeight,
      strokeColor: STYLES.DEFAULT_SHAPE.strokeColor,
      strokeOpacity: STYLES.DEFAULT_SHAPE.strokeOpacity,
      editable: false,
      draggable: true
    });
  }

  _circleToNative(feature) {
    const points = this._ringToLatLngPoints(feature.geometry.coordinates[0]);
    if (!points || points.length < 1) return null;
    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    const center = bounds.getCenter();

    // TerraDrawCircleMode expose le rayon en km via feature.properties.radiusKilometers ; à défaut
    // (propriété absente/renommée dans une future version), on retombe sur la distance centre→premier
    // sommet du polygone approximant le cercle.
    const radiusKm = feature.properties && typeof feature.properties.radiusKilometers === 'number'
      ? feature.properties.radiusKilometers
      : null;
    const radius = radiusKm !== null
      ? radiusKm * 1000
      : google.maps.geometry.spherical.computeDistanceBetween(center, points[0]);

    return new google.maps.Circle({
      center,
      radius,
      map: this.map,
      fillColor: STYLES.DEFAULT_CIRCLE.fillColor,
      fillOpacity: STYLES.DEFAULT_CIRCLE.fillOpacity,
      strokeWeight: STYLES.DEFAULT_CIRCLE.strokeWeight,
      strokeColor: STYLES.DEFAULT_CIRCLE.strokeColor,
      strokeOpacity: STYLES.DEFAULT_CIRCLE.strokeOpacity,
      editable: false,
      draggable: true
    });
  }

  _linestringToNative(feature) {
    const coords = feature.geometry.coordinates || [];
    const path = coords.map(([lng, lat]) => new google.maps.LatLng(lat, lng));
    if (path.length < 2) return null;
    return new google.maps.Polyline({
      path,
      map: this.map,
      strokeColor: STYLES.DEFAULT_LINE.strokeColor,
      strokeWeight: STYLES.DEFAULT_LINE.strokeWeight,
      strokeOpacity: STYLES.DEFAULT_LINE.strokeOpacity,
      editable: false,
      draggable: true,
      geodesic: STYLES.DEFAULT_LINE.geodesic
    });
  }

  /**
   * Active un mode de dessin Terra Draw nommé.
   * @param {string} modeName - Un des modes enregistrés dans init() (ex: 'obstacle-circle').
   * @param {(nativeShape: google.maps.Polygon|google.maps.Rectangle|google.maps.Circle|google.maps.Polyline) => void} onFeatureComplete
   *   Appelé avec la forme native une fois chaque tracé terminé.
   */
  async start(modeName, onFeatureComplete) {
    if (!this._converters[modeName]) {
      console.error(`[TerraDrawEngine] Mode inconnu: '${modeName}'`);
      return;
    }
    if (!this.ready) {
      await this.init(this.map || this.drawingControl.map);
    }
    this._onFeatureComplete = onFeatureComplete;
    this._activeMode = modeName;
    this.draw.setMode(modeName);
  }

  /**
   * Désactive le mode de dessin (repasse en 'select', arrête de capter les tracés).
   */
  stop() {
    this._activeMode = null;
    this._onFeatureComplete = null;
    if (!this.ready || !this.draw) return;
    try {
      this.draw.setMode('select');
    } catch (error) {
      // Terra Draw peut ne pas être démarré si aucun dessin n'a encore eu lieu
    }
    // L'adaptateur Google Maps de Terra Draw coupe le glissé de la carte (draggable:false) pendant
    // ses propres gestes et ne le rétablit qu'au pointerup reçu sur son élément : un pointerup
    // manqué laissait la carte, et avec elle le déplacement natif des formes, bloquée.
    if (this.map) this.map.setOptions({ draggable: true });
  }

  get isActive() {
    return this._activeMode !== null;
  }

  /**
   * Nom du mode actuellement actif (ex: 'aper-surface'), ou null si aucun. Permet à un appelant de
   * distinguer "mon propre mode est actif" de "un AUTRE outil utilise le moteur partagé en ce
   * moment" (cf. AperPolygonManager::_isOtherDrawingModeActive).
   */
  get activeModeName() {
    return this._activeMode;
  }
}
