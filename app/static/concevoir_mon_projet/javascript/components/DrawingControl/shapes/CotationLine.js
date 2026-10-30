import Line from './Line.js';
import { DRAWING_CONSTANTS } from '../constants.js';

/**
 * Lignes de cotation de la carte (Déclaration préalable : distances entre panneaux, aux limites
 * de propriété, aux obstacles...). Duplication adaptée de l'outil « ligne simple » (Line.js) :
 *  - une flèche à chaque extrémité (icônes natives de google.maps.Polyline) ;
 *  - un segment droit : seuls le premier et le dernier point du tracé sont conservés ;
 *  - étiquette réduite à la longueur (« 3,25 m »), sans l'identifiant, orientée parallèlement au
 *    trait (lisible de gauche à droite, recalée si la carte est pivotée) ;
 *  - longueur minimale de 10 cm (au lieu de 1 m pour une ligne simple : une cotation entre deux
 *    rangées de panneaux fait souvent moins d'un mètre).
 *
 * Persistance : même clé `lines` de solarProjectData que les lignes simples, avec le drapeau
 * `cotation: true` (cf. collectLinesData / Line.loadLinesFromData qui les ignore) — aucune
 * modification du StorageManager ni du schéma de sauvegarde en base.
 */
export const COTATION_ID_PREFIX = 'Cote-';

export const COTATION_STYLE = {
  strokeColor: '#111827',
  strokeWeight: 2,
  strokeOpacity: 1,
  zIndex: 120, // au-dessus des champs PV (cf. STYLES.DEFAULT_LINE)
  editable: true,
  draggable: true,
  geodesic: false,
};

const COTATION_SELECTED_STYLE = { strokeColor: '#dc2626', strokeWeight: 3 };

const COTATION_LABEL_CSS = `
  background: rgba(255,255,255,0.92);
  border: 1px solid #111827;
  border-radius: 3px;
  color: #111827;
  font: 600 11px Arial, sans-serif;
  padding: 1px 5px;
  white-space: nowrap;
`;

/**
 * Angle écran (degrés, sens horaire depuis l'horizontale) du segment a -> b, ramené dans
 * ]-90°, 90°] pour que le texte ne soit jamais à l'envers. Mercator étant conforme, le cap
 * géographique suffit (cap 90° = trait horizontal) ; on retranche le cap de la carte si elle est
 * pivotée. L'inclinaison (tilt) n'est pas compensée.
 */
function labelAngleDeg(a, b, mapHeading = 0) {
  let angle = google.maps.geometry.spherical.computeHeading(a, b) - 90 - (mapHeading || 0);
  angle = ((angle % 360) + 360) % 360; // [0, 360[
  if (angle > 180) angle -= 360;       // ]-180, 180]
  if (angle > 90) angle -= 180;
  else if (angle <= -90) angle += 180;
  return angle;
}

/**
 * L'AdvancedMarkerElement ancre le bas-centre du contenu sur le milieu du trait : on recentre
 * l'étiquette sur ce point (translateY(50%)), on la tourne autour de son centre, puis on la décale
 * perpendiculairement au trait pour ne pas masquer la ligne ni ses flèches.
 */
function labelTransform(angleDeg) {
  return `translateY(50%) rotate(${angleDeg.toFixed(2)}deg) translateY(-75%)`;
}

function arrowIcons(color) {
  const symbol = (path) => ({
    path, scale: 3, strokeColor: color, strokeWeight: 1.5, fillColor: color, fillOpacity: 1,
  });
  return [
    { icon: symbol(google.maps.SymbolPath.BACKWARD_CLOSED_ARROW), offset: '0%' },
    { icon: symbol(google.maps.SymbolPath.FORWARD_CLOSED_ARROW), offset: '100%' },
  ];
}

export function formatCotation(lengthM) {
  return `${lengthM.toFixed(2).replace('.', ',')} m`;
}

class CotationLine extends Line {
  constructor(drawingControl) {
    super(drawingControl);
    this.visible = true;
  }

  /** Style complet (trait + flèches) d'une cotation, sélectionnée ou non. */
  applyStyle(line, selected = false) {
    const color = selected ? COTATION_SELECTED_STYLE.strokeColor : COTATION_STYLE.strokeColor;
    line.setOptions({
      ...COTATION_STYLE,
      ...(selected ? COTATION_SELECTED_STYLE : {}),
      icons: arrowIcons(color),
    });
  }

  generateLineId() {
    let counter = 1;
    while (this.usedLineIds.has(`${COTATION_ID_PREFIX}${counter}`)) counter++;
    return `${COTATION_ID_PREFIX}${counter}`;
  }

  /** Réduit un tracé multi-points à son segment premier -> dernier point. */
  straighten(line) {
    const path = line.getPath();
    if (path.getLength() <= 2) return;
    const first = path.getAt(0);
    const last = path.getAt(path.getLength() - 1);
    line.setPath([first, last]);
  }

  handleLineComplete(line) {
    this.straighten(line);
    line.isCotation = true;
    this.applyStyle(line);
    return super.handleLineComplete(line);
  }

  updateLineLabel(line) {
    if (!line || !line.lineId) return;
    if (line._updateTimeout) clearTimeout(line._updateTimeout);

    const length = this.calculateLineLength(line);
    if (length < 0.1) {
      this.selectedLine = line;
      this.deleteSelectedLine();
      this.drawingControl.errorModal?.show('La cotation est trop courte (minimum 10 cm).');
      return;
    }

    line._updateTimeout = setTimeout(() => {
      if (!line.getMap()) return;
      const existing = this.lineLabels.get(line.lineId);
      if (existing) existing.map = null;

      const path = line.getPath();
      const a = path.getAt(0);
      const b = path.getAt(path.getLength() - 1);
      const center = new google.maps.LatLng((a.lat() + b.lat()) / 2, (a.lng() + b.lng()) / 2);

      const content = document.createElement('div');
      content.className = 'cotation-label';
      content.style.cssText = COTATION_LABEL_CSS;
      content.textContent = formatCotation(length);
      content.style.transform = labelTransform(labelAngleDeg(a, b, this._mapHeading()));

      const label = new this.drawingControl.AdvancedMarkerElement({
        map: this.labelsVisible && this.visible ? this.drawingControl.map : null,
        position: center,
        content,
        collisionBehavior: 'REQUIRED',
      });
      this.lineLabels.set(line.lineId, label);
      this._watchMapHeading();
    }, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT);
  }

  _mapHeading() {
    const map = this.drawingControl.map;
    return map && typeof map.getHeading === 'function' ? (map.getHeading() || 0) : 0;
  }

  /** Carte pivotée (rotateControl) : réoriente les étiquettes existantes, une seule écoute. */
  _watchMapHeading() {
    const map = this.drawingControl.map;
    if (this._headingListener || !map) return;
    this._headingListener = google.maps.event.addListener(map, 'heading_changed', () => {
      const heading = this._mapHeading();
      this.drawnLines.forEach((line) => {
        const label = this.lineLabels.get(line.lineId);
        const path = line.getPath && line.getPath();
        if (!label || !label.content || !path || path.getLength() < 2) return;
        const a = path.getAt(0);
        const b = path.getAt(path.getLength() - 1);
        label.content.style.transform = labelTransform(labelAngleDeg(a, b, heading));
      });
    });
  }

  setupLineListeners(line) {
    super.setupLineListeners(line);
    // Un sommet déplacé à la main garde un segment droit (l'éditeur natif propose des points
    // intermédiaires « fantômes » : on les absorbe).
    google.maps.event.addListener(line.getPath(), 'insert_at', () => this.straighten(line));
  }

  setLineSelection(line) {
    if (this.selectedLine && this.selectedLine !== line) this.applyStyle(this.selectedLine, false);
    this.drawingControl.clearSelection();
    this.selectedLine = line;
    if (line) this.applyStyle(line, true);
  }

  // Line.deleteSelectedLine appelle label.setMap(null), qui n'existe pas sur un
  // AdvancedMarkerElement : on retire l'étiquette par la propriété `map`.
  deleteSelectedLine() {
    const line = this.selectedLine;
    if (!line) return;
    const label = this.lineLabels.get(line.lineId);
    if (label) label.map = null;
    this.lineLabels.delete(line.lineId);
    line.setMap(null);
    this.drawnLines = this.drawnLines.filter((l) => l !== line);
    this.usedLineIds.delete(line.lineId);
    this.selectedLine = null;
    document.dispatchEvent(new CustomEvent('lineRemoved', { detail: { lineId: line.lineId } }));
  }

  /** Désélection appelée par DrawingControl.clearSelection(). */
  deselect() {
    if (this.selectedLine) this.applyStyle(this.selectedLine, false);
    this.selectedLine = null;
  }

  collectLinesData() {
    const data = super.collectLinesData();
    Object.values(data).forEach((entry) => { entry.cotation = true; });
    return data;
  }

  loadLinesFromData(linesData) {
    if (!linesData || typeof linesData !== 'object') return;
    Object.entries(linesData).forEach(([lineId, data]) => {
      if (!data || !data.cotation || !Array.isArray(data.points) || data.points.length < 2) return;
      if (this.usedLineIds.has(lineId)) return;
      const first = data.points[0];
      const last = data.points[data.points.length - 1];
      const line = new google.maps.Polyline({
        path: [first, last].map((p) => new google.maps.LatLng(p.lat, p.lng)),
        map: this.visible ? this.drawingControl.map : null,
      });
      line.lineId = lineId;
      line.isCotation = true;
      this.applyStyle(line);
      this.drawnLines.push(line);
      this.usedLineIds.add(lineId);
      this.setupLineListeners(line);
      this.updateLineLabel(line);
    });
  }

  /** Cotations en coordonnées : [{id, a:{lat,lng}, b:{lat,lng}, lengthM}] (exports PDF). */
  getCotations() {
    return this.drawnLines
      .filter((line) => line && line.getPath && line.getPath().getLength() >= 2)
      .map((line) => {
        const path = line.getPath();
        const a = path.getAt(0);
        const b = path.getAt(path.getLength() - 1);
        return {
          id: line.lineId,
          a: { lat: a.lat(), lng: a.lng() },
          b: { lat: b.lat(), lng: b.lng() },
          lengthM: this.calculateLineLength(line),
        };
      });
  }

  /**
   * Affiche/masque toutes les cotations (traits + étiquettes). Les exports DP les masquent le
   * temps de la capture et les redessinent en vectoriel dans le PDF.
   * @returns {Function} restauration de l'état précédent
   */
  setAllVisible(visible) {
    const previous = this.visible;
    this.visible = visible;
    const map = visible ? this.drawingControl.map : null;
    this.drawnLines.forEach((line) => line.setMap(map));
    this.lineLabels.forEach((label) => { if (label) label.map = visible && this.labelsVisible ? map : null; });
    return () => this.setAllVisible(previous);
  }
}

export default CotationLine;
