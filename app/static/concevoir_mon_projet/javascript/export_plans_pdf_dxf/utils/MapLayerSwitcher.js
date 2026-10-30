/**
 * Bascule les fonds de carte (OSM / Géoportail / Cadastre) avant capture d'un
 * plan, en pilotant directement l'instance MapViewsControl déjà exposée par
 * GoogleMaps.js (window.mapViewsControl) - aucune logique de couche dupliquée
 * ici, seulement l'orchestration des méthodes existantes
 * (_switchPlanView / _switchSatelliteView / toggleCadastreLayer).
 */
export default class MapLayerSwitcher {
  static _getControl() {
    const control = window.mapViewsControl;
    if (!control) {
      throw new Error("La carte n'est pas encore initialisée (window.mapViewsControl manquant).");
    }
    return control;
  }

  /** Capture l'état actuel des fonds de carte pour restauration ultérieure. */
  static snapshot() {
    const control = this._getControl();
    return {
      // Fond réellement affiché ('googleMaps' | 'geoportail' | 'osm' | 'blank').
      baseLayer: control.currentBaseLayer,
      // Dernier choix de chaque menu (Satellite, Plan), affiché comme sélection dans ces menus.
      satelliteView: control.currentSatelliteView,
      planView: control.currentPlanView,
      cadastreVisible: !!(control.toolbarContext && control.toolbarContext.isLayerVisible),
      cadastreWMSVisible: !!control.isCadastreWMSVisible,
    };
  }

  /**
   * Remet la carte sur le fond choisi par l'utilisateur avant l'export.
   *
   * CORRECTIF (la carte ne revenait souvent pas sur sa couche initiale) : l'ancienne version
   * rejouait la vue satellite PUIS la vue plan mémorisée — la dernière l'emportait, donc un
   * utilisateur en satellite Google qui avait affiché OSM auparavant finissait sur OSM. On rejoue
   * désormais le fond réellement affiché (currentBaseLayer), puis on réécrit l'état mémorisé
   * (sessionStorage), écrasé par chaque bascule faite pendant la capture.
   */
  static async restore(snapshot) {
    if (!snapshot) return;
    const control = this._getControl();
    if (control.isCadastreWMSVisible && !snapshot.cadastreWMSVisible) {
      await control.toggleCadastreWMS(false);
    }
    const base = snapshot.baseLayer
      || (snapshot.satelliteView === 'geoportail' ? 'geoportail' : 'googleMaps'); // instantané ancien format
    if (base === 'osm' || base === 'blank') control._switchPlanView(base);
    else control._switchSatelliteView(base === 'geoportail' ? 'geoportail' : 'googleMaps');
    if (snapshot.satelliteView) control.currentSatelliteView = snapshot.satelliteView;
    if (snapshot.planView) control.currentPlanView = snapshot.planView;
    control.toggleCadastreLayer(snapshot.cadastreVisible);
    if (snapshot.cadastreWMSVisible && !control.isCadastreWMSVisible) {
      await control.toggleCadastreWMS(true);
    }
    if (typeof control._saveLayersState === 'function') control._saveLayersState();
    if (typeof control.updateButtonSelection === 'function') control.updateButtonSelection();
  }

  /**
   * Fond OpenStreetMap, sans cadastre (Plan de situation, page 1).
   *
   * Route les tuiles via /api/osm-tile-proxy/<z>/<x>/<y> au lieu de
   * tile.openstreetmap.fr en direct : ce serveur externe ne renvoie pas d'en-têtes
   * CORS, ce qui empêche html2canvas de lire les tuiles pour produire l'image du
   * PDF (canvas "tainted", carte vide à l'export). Le proxy backend (main.py) sert
   * les mêmes tuiles en same-origin. Ce remplacement de `getTileUrl` n'affecte QUE
   * la couche partagée `osmLayer` le temps de la capture - appeler le callback
   * retourné juste après pour restaurer l'URL d'origine, et ne pas dégrader la
   * navigation normale (qui n'a pas ce problème, l'affichage interactif ne servant
   * jamais de <canvas>).
   * @returns {Function} à appeler après la capture pour restaurer l'URL d'origine.
   */
  static setOsmForExport() {
    const control = this._getControl();
    const osmLayer = control.osmLayer;
    const originalGetTileUrl = osmLayer.getTileUrl;
    osmLayer.getTileUrl = (coord, zoom) => {
      if (zoom < osmLayer.minZoom || zoom > osmLayer.maxZoom) return null;
      return `/concevoir_mon_projet/api/osm-tile-proxy/${zoom}/${coord.x}/${coord.y}`;
    };
    control._switchPlanView('osm');
    control.toggleCadastreLayer(false);
    return () => {
      osmLayer.getTileUrl = originalGetTileUrl;
    };
  }

  /** Fond OpenStreetMap, sans cadastre (Plan de situation, page 1) - navigation normale. */
  static setOsm() {
    const control = this._getControl();
    control._switchPlanView('osm');
    control.toggleCadastreLayer(false);
  }

  /** Fond Géoportail (orthophoto) + couche cadastrale Géoportail par-dessus. */
  static setGeoportailWithCadastre() {
    const control = this._getControl();
    control._switchSatelliteView('geoportail');
    control.toggleCadastreLayer(true);
  }

  /** Fond blanc neutre + couche cadastrale Géoportail (Plan de masse, page 2). */
  static setBlankWithCadastre() {
    const control = this._getControl();
    control._switchPlanView('blank');
    control.toggleCadastreLayer(true);
  }

  /**
   * Fond blanc neutre + couche cadastrale cadastre.gouv.fr (Plan de masse, page 3).
   * C'est la 2e option du menu déroulant "Cadastre" (mapViews.js: _createCadastreMenu,
   * label "Cadastre" / toggleCadastreWMS) - PAS "Cadastre Géoportail" (1re option,
   * setBlankWithCadastre ci-dessus). toggleCadastreWMS résout le code INSEE à partir
   * du centre ACTUEL de la carte (this.map.getCenter()) : on le positionne donc sur
   * `center` avant l'appel.
   * @param {{lat:number,lng:number}} center
   */
  static async setBlankWithCadastreWMS(center) {
    const control = this._getControl();
    control._switchPlanView('blank');
    if (center) {
      control.map.setCenter(new window.google.maps.LatLng(center.lat, center.lng));
    }
    await control.toggleCadastreWMS(true);
  }
}
