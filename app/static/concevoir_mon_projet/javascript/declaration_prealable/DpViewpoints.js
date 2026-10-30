/**
 * Points de vue des photographies DP7 (environnement proche) et DP8 (environnement lointain).
 *
 * Placement en deux clics sur la carte principale : 1er clic = position du photographe, 2e clic =
 * direction visée. Les clics sont captés par un calque transparent posé sur la carte (et non par
 * l'événement 'click' de la carte, que les contours, panneaux et marqueurs interceptent), puis
 * convertis en lat/lng par la projection d'un OverlayView.
 *
 * Sur la carte, un aperçu n'est affiché que pendant que le modal DP est ouvert. Dans le PDF, le
 * symbole est redessiné en vectoriel (DpLayout.drawViewpoint) : il n'apparaît donc jamais en double
 * sur les captures.
 */
const LABELS = { proche: 'DP7', lointain: 'DP8' };

function symbolSvg(bearing, label) {
  return `
    <div style="transform:translate(0,50%);display:flex;flex-direction:column;align-items:center;pointer-events:none;">
      <svg width="46" height="46" viewBox="-23 -23 46 46" style="transform:rotate(${bearing}deg);overflow:visible">
        <circle r="3.2" fill="#111827" stroke="#fff" stroke-width="1"/>
        ${[-40, -20, 0, 20, 40].map((d) => `<line x1="0" y1="-7" x2="0" y2="-19" stroke="#111827" stroke-width="3.2"
          stroke-linecap="round" transform="rotate(${d})" style="paint-order:stroke" />`).join('')}
      </svg>
      <span style="background:#fff;border:1px solid #111827;border-radius:3px;font:700 11px Arial;padding:0 4px;margin-top:-6px">${label}</span>
    </div>`;
}

export default class DpViewpoints {
  constructor(state) {
    this.state = state;
    this.markers = {};
    this.previewVisible = false;
    this._overlay = null;
  }

  get map() {
    return window.map;
  }

  async _markerClass() {
    if (!this._AdvancedMarker) {
      const lib = await google.maps.importLibrary('marker');
      this._AdvancedMarker = lib.AdvancedMarkerElement;
    }
    return this._AdvancedMarker;
  }

  _projection() {
    if (!this._overlay) {
      this._overlay = new google.maps.OverlayView();
      this._overlay.onAdd = () => {};
      this._overlay.draw = () => {};
      this._overlay.onRemove = () => {};
      this._overlay.setMap(this.map);
    }
    return this._overlay.getProjection();
  }

  /** Aperçu des deux points de vue sur la carte (modal ouvert) ou retrait (modal fermé). */
  async showPreview(visible) {
    this.previewVisible = visible;
    for (const type of Object.keys(LABELS)) await this._renderMarker(type);
  }

  async _renderMarker(type) {
    const vp = this.state.data.pointsDeVue[type];
    const existing = this.markers[type];
    if (existing) { existing.map = null; delete this.markers[type]; }
    if (!vp || !this.previewVisible || !this.map) return;
    const AdvancedMarker = await this._markerClass();
    const content = document.createElement('div');
    content.innerHTML = symbolSvg(vp.bearing || 0, LABELS[type]);
    this.markers[type] = new AdvancedMarker({ map: this.map, position: { lat: vp.lat, lng: vp.lng }, content, zIndex: 900 });
  }

  /** Masque temporairement l'aperçu (captures) ; renvoie la restauration. */
  hideForCapture() {
    const hidden = Object.values(this.markers);
    hidden.forEach((m) => { m.map = null; });
    return () => hidden.forEach((m) => { m.map = this.map; });
  }

  remove(type) {
    this.state.data.pointsDeVue[type] = null;
    this.state.save();
    return this._renderMarker(type);
  }

  /**
   * Placement interactif en 2 clics.
   * @returns {Promise<boolean>} true si le point de vue a été placé, false si annulé (Échap)
   */
  place(type) {
    const map = this.map;
    if (!map) return Promise.reject(new Error('Carte non initialisée.'));
    const mapDiv = map.getDiv();
    this._projection(); // l'OverlayView n'a de projection qu'après son premier dessin : on l'amorce dès maintenant

    return new Promise((resolve) => {
      const layer = document.createElement('div');
      layer.className = 'dp-viewpoint-layer';
      const banner = document.createElement('div');
      banner.className = 'dp-viewpoint-banner';
      const setBanner = (msg) => {
        banner.innerHTML = `<strong>${LABELS[type]} — ${type === 'proche' ? 'photo environnement proche' : 'photo environnement lointain'}</strong><br>${msg}<br><small>Échap pour annuler · molette pour zoomer</small>`;
      };
      setBanner('1. Cliquez à l\'emplacement du photographe.');
      mapDiv.appendChild(layer);
      mapDiv.appendChild(banner);

      let origin = null;
      let guide = null;
      const toLatLng = (evt) => {
        const rect = mapDiv.getBoundingClientRect();
        const projection = this._projection();
        if (!projection) return null;
        return projection.fromContainerPixelToLatLng(new google.maps.Point(evt.clientX - rect.left, evt.clientY - rect.top));
      };

      const cleanup = (placed) => {
        layer.remove();
        banner.remove();
        if (guide) guide.setMap(null);
        document.removeEventListener('keydown', onKey, true);
        resolve(placed);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); cleanup(false); }
      };
      document.addEventListener('keydown', onKey, true);

      // La molette reste utile pour zoomer pendant le placement : on la transmet à la carte.
      layer.addEventListener('wheel', (e) => {
        e.preventDefault();
        map.setZoom(map.getZoom() + (e.deltaY < 0 ? 1 : -1));
      }, { passive: false });

      layer.addEventListener('mousemove', (e) => {
        if (!origin) return;
        const ll = toLatLng(e);
        if (!ll) return;
        if (!guide) {
          guide = new google.maps.Polyline({
            map, clickable: false, strokeColor: '#dc2626', strokeWeight: 2,
            icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3 }, offset: '100%' }],
          });
        }
        guide.setPath([origin, ll]);
      });

      layer.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ll = toLatLng(e);
        if (!ll) return;
        if (!origin) {
          origin = ll;
          setBanner('2. Cliquez dans la direction visée par la photo.');
          return;
        }
        const bearing = google.maps.geometry.spherical.computeHeading(origin, ll);
        this.state.data.pointsDeVue[type] = {
          lat: origin.lat(), lng: origin.lng(), bearing: Math.round(((bearing % 360) + 360) % 360),
        };
        this.state.save();
        cleanup(true);
      });
    });
  }
}
