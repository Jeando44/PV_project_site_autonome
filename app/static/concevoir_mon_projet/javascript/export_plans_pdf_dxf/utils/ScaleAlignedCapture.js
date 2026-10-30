import ScaleCalculator from '../../components/ScaleControl/utils/ScaleCalculator.js';
import { SCALE_CONSTANTS } from '../../components/ScaleControl/constants.js';
import CaptureVeil from './CaptureVeil.js';

/**
 * Capture d'une zone de carte à une échelle d'impression garantie mathématiquement.
 *
 * Principe (voir plan) : on découple la taille physique sur le papier (mm, fixée
 * par la mise en page) de la résolution de capture (pixels, qui ne détermine que
 * la netteté). D'après le standard OGC (0.28 mm/pixel, déjà utilisé par
 * ScaleCalculator), la fenêtre de capture en pixels CSS ne dépend QUE du format
 * papier visé (Wmm/Hmm), pas de l'échelle demandée :
 *   captureWidthPx  = Wmm / PIXEL_SIZE_MM
 *   captureHeightPx = Hmm / PIXEL_SIZE_MM
 * L'échelle (1/500, 1/10000, ...) ne détermine, elle, que le NIVEAU DE ZOOM de la
 * carte (via ScaleCalculator.calculateZoomForScale) - c'est-à-dire combien de
 * mètres réels sont visibles dans cette fenêtre de taille fixe. Le placement de
 * l'image capturée dans le PDF se fait ensuite avec pdf.addImage(img, x, y, Wmm,
 * Hmm) - la taille mm est fixée à l'étape 1, indépendante du nombre de pixels
 * capturés (qui ne sert qu'à choisir le DPI d'impression via l'option `scale` de
 * html2canvas).
 */
export default class ScaleAlignedCapture {
  static capturePixelSize(printWidthMm, printHeightMm) {
    const pixelSizeMm = SCALE_CONSTANTS.PIXEL_SIZE_MM;
    return {
      widthPx: Math.round(printWidthMm / pixelSizeMm),
      heightPx: Math.round(printHeightMm / pixelSizeMm),
    };
  }

  static _waitForIdle(map, timeoutMs = 8000) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const listener = window.google.maps.event.addListenerOnce(map, 'idle', finish);
      setTimeout(() => {
        if (!done) {
          window.google.maps.event.removeListener(listener);
          finish();
        }
      }, timeoutMs);
    });
  }

  /**
   * L'évènement 'idle' de la carte ne garantit pas que les tuiles des couches
   * ImageMapType (OSM/Géoportail/Cadastre, chargées comme de simples <img>) ont fini
   * de charger - seulement que le rendu propre à Google Maps s'est stabilisé. Pire,
   * lors d'un changement de mapTypeId (ex: hybrid -> roadmap+OSM), Google conserve les
   * anciennes tuiles affichées le temps que les nouvelles arrivent (pour éviter un
   * flash blanc) : un simple "toutes les <img> actuelles sont chargées" peut donc
   * être vrai alors que de NOUVELLES <img> vont encore être insérées juste après,
   * laissant apparaître un mélange ancien/nouveau fond de carte sur la capture.
   * On exige donc que le nombre ET l'état des <img> restent stables sur plusieurs
   * vérifications consécutives avant de considérer le rendu terminé.
   */
  static async _waitForTileImages(mapDiv, { timeoutMs = 10000, pollMs = 300, stableChecksRequired = 3 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let stableCount = 0;
    let lastCount = -1;
    while (Date.now() < deadline) {
      const imgs = mapDiv.querySelectorAll('img');
      const allLoaded = Array.from(imgs).every((img) => img.complete && img.naturalWidth > 0);
      if (allLoaded && imgs.length === lastCount) {
        stableCount += 1;
        if (stableCount >= stableChecksRequired) return;
      } else {
        stableCount = 0;
      }
      lastCount = imgs.length;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  /**
   * Attend que la carte ait FINI de se re-rendre (evenement 'idle' + tuiles
   * chargees et stables). A utiliser apres avoir restaure la carte en fin
   * d'export, juste avant de lever le voile de capture : sans cette attente, le
   * voile disparait pendant que le fond de carte d'origine se recharge encore,
   * et l'utilisateur voit malgre tout la carte « se remettre en place ».
   */
  static async waitUntilSettled(map, { idleTimeoutMs = 1500, tilesTimeoutMs = 2500 } = {}) {
    await this._waitForIdle(map, idleTimeoutMs);
    await this._waitForTileImages(map.getDiv(), {
      timeoutMs: tilesTimeoutMs,
      pollMs: 150,
      stableChecksRequired: 2,
    });
  }

  /**
   * Masque le contrôle natif de rotation/inclinaison (la « boussole ») de Google Maps le temps de la
   * capture, puis le restaure.
   *
   * Ce contrôle est activé sur la carte principale (rotateControl: true, cf. GoogleMaps.js) et
   * apparaît donc en surimpression sur les plans exportés. Contrairement aux contrôles natifs
   * historiques (zoom, plein écran), il n'est PAS rendu dans un conteneur `.gmnoprint` sur une carte
   * vectorielle (mapId défini, nécessaire ici pour tiltInteractionEnabled/rotateControl) : la liste
   * noire de sélecteurs de defaultIgnoreElements() ne l'attrape donc pas.
   *
   * On le désactive par l'API plutôt que d'ajouter un sélecteur CSS de plus : les noms de classes
   * internes de ces contrôles ne sont pas contractuels et changent d'une version de l'API à l'autre,
   * alors que l'option `rotateControl` l'est. La capture étant déjà cachée derrière le voile
   * (CaptureVeil) et suivie d'une attente de rendu, ce retrait/remise en place reste invisible.
   */
  static _hideNativeRotateControl(map) {
    const previous = map.get('rotateControl');
    map.setOptions({ rotateControl: false });
    return () => {
      // `undefined` signifie que l'option n'a jamais été lue explicitement : on remet `true`, la
      // valeur de la carte principale (GoogleMaps.js), plutôt que de laisser le contrôle disparu.
      map.setOptions({ rotateControl: previous === undefined ? true : previous });
    };
  }

  /**
   * Masque le cercle bleu de 3km (window._projectAddressCircle) + sa croix
   * (window._projectAddressMarker), affichés par défaut sur la carte principale
   * (cf. GoogleMaps.js) - sans ça, toute capture est teintée de bleu par ce cercle
   * semi-transparent. Retourne une fonction de restauration à appeler après capture.
   */
  static _hideProjectAddressCircle() {
    const circle = window._projectAddressCircle;
    const marker = window._projectAddressMarker;
    const wasCircleVisible = !!(circle && circle.getMap());
    const wasMarkerVisible = !!(marker && marker.getMap());
    if (wasCircleVisible) circle.setMap(null);
    if (wasMarkerVisible) marker.setMap(null);
    return () => {
      if (wasCircleVisible) circle.setMap(window.map);
      if (wasMarkerVisible) marker.setMap(window.map);
    };
  }

  /**
   * Masque tout ce qui n'est pas le fond de carte + les éléments dessinés dessus :
   * boutons de la toolbar/DrawingControl, panneaux de recherche/résumé, contrôles
   * natifs Google (gmnoprint/fullscreen). Repris tel quel du blacklist déjà utilisé
   * (et éprouvé) par ExportService.captureByCoordinates.
   */
  static defaultIgnoreElements(node) {
    return (node.id && node.id === 'export-plans-capture-veil') ||
      (node.className && node.className === 'form-container') || (node.className && node.className === 'sidebar') ||
      (node.className && node.className === 'demo-nav') || (node.className && node.className === 'custom-map-control') ||
      (node.className && node.classList.contains('gmnoprint')) || (node.className && node.classList.contains('custom-map-control-button')) ||
      (node.className && node.classList.contains('gm-fullscreen-control')) || (node.className && node.classList.contains('drawing-control')) ||
      (node.className && node.classList.contains('resize-handle')) ||
      (node.className && node.classList.contains('loading-spinner')) ||
      (node.className && node.classList.contains('loading-indicator-overlay')) ||
      (node.className && node.classList.contains('loading-indicator-container')) ||
      (node.id && node.id === 'page-navigator') ||
      (node.classList && node.classList.contains('page-navigator')) ||
      (node.id && node.id === 'modal-navigator-palette') ||
      (node.classList && node.classList.contains('map-pv-settings-btn')) ||
      // post-axes-settings-btn / btn-post-axes : sélecteurs historiques (ExportService.js),
      // obsolètes - le contrôle "Configurer les axes des poteaux" est aujourd'hui un
      // google.maps.Marker (poteaux.js), rendu comme une simple <img src="...ancrage.svg">.
      (node.classList && node.classList.contains('post-axes-settings-btn')) ||
      (node.id && node.id === 'btn-post-axes') ||
      (node.tagName === 'IMG' && node.src && node.src.includes('ancrage.svg')) ||
      // Poignée de rotation des contours du calepinage résidentiel (demande explicite : "masquer
      // le symbole de rotation" sur les captures) : un google.maps.Marker rendu comme une simple
      // <img src="...sync.svg">, cf. polygon_maison.js::_ensureRotationHandle — même nature que
      // le marqueur d'ancrage ci-dessus, donc même filtre. C'est un outil d'édition, il n'a rien
      // à faire sur un plan exporté.
      (node.tagName === 'IMG' && node.src && node.src.includes('sync.svg')) ||
      // Label d'échelle affiché sur la carte (composants/ScaleControl) - distinct de
      // l'échelle du cartouche, qui elle doit rester.
      (node.classList && node.classList.contains('scale-control')) ||
      // Note : ExportService.js utilise `node.name === 'BUTTON'` (ne matche quasiment
      // jamais, `name` n'étant pas renseigné sur un <button>) ; corrigé ici en
      // `tagName` pour masquer VRAIMENT tous les boutons (toolbar, DrawingControl,
      // recherche...), quel que soit leur conteneur - c'est tout l'objet de cette capture.
      node.tagName === 'BUTTON';
  }

  /**
   * Capture le fond de carte affiché en window.map à une échelle 1/targetScale
   * garantie, sur une zone équivalente à printWidthMm x printHeightMm imprimés.
   *
   * @param {Object} options
   * @param {google.maps.Map} options.map
   * @param {{lat:number,lng:number}} options.center - centre réel visé (mètres réels du modelspace, ici en lat/lng)
   * @param {number} options.targetScale - dénominateur d'échelle (ex: 500 pour 1/500)
   * @param {number} options.printWidthMm - largeur imprimée de la zone carte (mm)
   * @param {number} options.printHeightMm - hauteur imprimée de la zone carte (mm)
   * @param {number} [options.pixelDensity=3] - multiplicateur html2canvas (qualité d'impression, sans effet sur l'échelle)
   * @param {Function} [options.ignoreElements] - callback html2canvas ignoreElements (masque UI hors carte)
   * @returns {Promise<{canvas: HTMLCanvasElement, widthMm: number, heightMm: number, georef: Object}>}
   *   georef : {center:{lat,lng}, zoom, heading, widthPx, heightPx} — état réel de la carte capturée.
   */
  static async captureAtScale({
    map,
    center,
    targetScale,
    printWidthMm,
    printHeightMm,
    pixelDensity = 3,
    ignoreElements,
  }) {
    const mapDiv = map.getDiv();
    let { widthPx, heightPx } = this.capturePixelSize(printWidthMm, printHeightMm);
    const zoom = ScaleCalculator.calculateZoomForScale(targetScale, center.lat);

    // Voile opaque AVANT toute manipulation : ce qui suit redimensionne,
    // recentre et re-zoome la carte reellement affichee - l'utilisateur ne doit
    // rien en voir (cf. CaptureVeil).
    await CaptureVeil.show();

    const originalStyle = {
      position: mapDiv.style.position,
      top: mapDiv.style.top,
      left: mapDiv.style.left,
      width: mapDiv.style.width,
      height: mapDiv.style.height,
      zIndex: mapDiv.style.zIndex,
    };
    const originalCenter = map.getCenter();
    const originalZoom = map.getZoom();
    const restoreAddressCircle = this._hideProjectAddressCircle();
    const restoreRotateControl = this._hideNativeRotateControl(map);
    // Carte vectorielle orientable/inclinable (GoogleMaps.js) : une vue tournée ou inclinée par
    // l'utilisateur ne serait plus un plan nord en haut à l'échelle -> remise à plat le temps de
    // la capture, puis restaurée.
    const originalHeading = typeof map.getHeading === 'function' ? map.getHeading() : 0;
    const originalTilt = typeof map.getTilt === 'function' ? map.getTilt() : 0;
    let georef = null;

    try {
      mapDiv.style.position = 'fixed';
      mapDiv.style.top = '0';
      mapDiv.style.left = '0';
      mapDiv.style.width = `${widthPx}px`;
      mapDiv.style.height = `${heightPx}px`;
      mapDiv.style.zIndex = '2050';

      window.google.maps.event.trigger(map, 'resize');
      if (originalHeading && typeof map.setHeading === 'function') map.setHeading(0);
      if (originalTilt && typeof map.setTilt === 'function') map.setTilt(0);
      map.setCenter(center);
      map.setZoom(zoom);
      await this._waitForIdle(map);
      // Échelle GARANTIE même si l'API a arrondi le zoom demandé (carte raster, bornes de zoom) :
      // la fenêtre est agrandie/réduite du rapport 2^(zoom réel - zoom visé), elle couvre donc
      // exactement le terrain de la zone imprimée à 1/targetScale. L'image, posée ensuite sur
      // printWidthMm, reste à l'échelle demandée (au lieu d'une échelle « réelle » voisine).
      const zoomReel = map.getZoom();
      if (Number.isFinite(zoomReel) && Math.abs(zoomReel - zoom) > 1e-6) {
        const f = Math.pow(2, zoomReel - zoom);
        widthPx = Math.round(widthPx * f);
        heightPx = Math.round(heightPx * f);
        mapDiv.style.width = `${widthPx}px`;
        mapDiv.style.height = `${heightPx}px`;
        window.google.maps.event.trigger(map, 'resize');
        map.setCenter(center);
        await this._waitForIdle(map);
      }
      // Un second recentrage : le trigger 'resize' peut décaler le centre visible.
      map.setCenter(center);
      await this._waitForTileImages(mapDiv);
      // Marge de sécurité : laisse le temps au dernier lot de tuiles de finir de
      // peindre après leur évènement 'load' (décodage/composite navigateur).
      await new Promise((resolve) => setTimeout(resolve, 400));

      // État RÉEL de la carte au moment de la capture (centre, zoom éventuellement arrondi par
      // l'API) : permet de superposer des tracés vectoriels exactement sur le fond capturé.
      const c = map.getCenter();
      georef = {
        center: { lat: c.lat(), lng: c.lng() },
        zoom: map.getZoom(),
        heading: typeof map.getHeading === 'function' ? (map.getHeading() || 0) : 0,
        widthPx,
        heightPx,
      };

      const canvas = await window.html2canvas(mapDiv, {
        scale: pixelDensity,
        useCORS: true,
        allowTaint: true,
        logging: false,
        width: widthPx,
        height: heightPx,
        ignoreElements: ignoreElements || this.defaultIgnoreElements,
      });

      return { canvas, widthMm: printWidthMm, heightMm: printHeightMm, georef };
    } finally {
      mapDiv.style.position = originalStyle.position;
      mapDiv.style.top = originalStyle.top;
      mapDiv.style.left = originalStyle.left;
      mapDiv.style.width = originalStyle.width;
      mapDiv.style.height = originalStyle.height;
      mapDiv.style.zIndex = originalStyle.zIndex;
      window.google.maps.event.trigger(map, 'resize');
      if (originalHeading && typeof map.setHeading === 'function') map.setHeading(originalHeading);
      if (originalTilt && typeof map.setTilt === 'function') map.setTilt(originalTilt);
      map.setCenter(originalCenter);
      map.setZoom(originalZoom);
      restoreAddressCircle();
      restoreRotateControl();
      // Le voile ne se leve qu'une fois la carte revenue a son etat initial ET
      // re-rendue. Si d'autres captures du meme export suivent (CaptureVeil garde
      // le compte), inutile d'attendre ici : le voile reste en place de toute facon.
      if (CaptureVeil.isLastLevel()) {
        try {
          await this.waitUntilSettled(map);
        } catch (e) {
          console.warn('[ScaleAlignedCapture] Stabilisation de la carte interrompue:', e);
        }
      }
      CaptureVeil.hide();
    }
  }
}
