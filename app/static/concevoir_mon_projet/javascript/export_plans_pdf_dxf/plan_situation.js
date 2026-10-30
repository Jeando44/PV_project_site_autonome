import ScaleAlignedCapture from './utils/ScaleAlignedCapture.js';
import CaptureVeil from './utils/CaptureVeil.js';
import MapLayerSwitcher from './utils/MapLayerSwitcher.js?v=2';
import CartoucheData from './utils/CartoucheData.js';
import PanelVisibility from './utils/PanelVisibility.js?v=2';
import PanelsExtent from './utils/PanelsExtent.js?v=3';
import PdfCartouche from './utils/PdfCartouche.js';
import PdfScaleBar from './utils/PdfScaleBar.js';
import GeoMeters from './utils/GeoMeters.js';
import { GET_CODE_INSEE_BY_COORDINATES, GET_CADASTRE_DATA } from '../../API/API.js';

// A3 paysage, cadre en retrait de 3mm (cf. plan - "Cartouche et Mise en page")
const { PAGE_W_MM, PAGE_H_MM, MARGIN_MM, VIEWPORT_W_MM, VIEWPORT_H_MM } = PdfCartouche;
const LOCATION_RADIUS_M = 3000; // même rayon que le cercle "3km" déjà utilisé dans l'app
const PARCELLES_SEARCH_RADIUS_M = 300; // marge confortable autour de la page 1/1000 (~414 x 291 m, demi-diagonale ~253m)

const PAGES = [
  { name: 'Situation_1_10000_OSM', label: 'Situation 1/10000 - OSM', scale: 10000, layer: 'osm', hidePanels: true },
  { name: 'Situation_1_1000_Geoportail_Cadastre', label: 'Situation 1/1000 - Géoportail + Cadastre', scale: 1000, layer: 'geoportail_cadastre', centerOnPanels: true },
];

/**
 * Génération du Plan de situation projet (PDF + DXF) :
 * page 1 (OSM, 1/10000, sans les panneaux) et page 2 (Géoportail + Cadastre,
 * 1/1000, centrée sur l'implantation des panneaux), avec un marqueur + cercle
 * "Localisation projet" positionné selon l'adresse du projet sur chaque page.
 */
export default class PlanSituationExporter {
  static async _ensureContext(indice) {
    // Calepinage sur canevas : panneaux remis à jour sur la carte avant capture (page 2).
    try {
      if (window.CalepinageMaisonPlans) window.CalepinageMaisonPlans.synchroniser();
    } catch (e) {
      console.warn('[PlanSituation] Report des panneaux du calepinage sur la carte impossible:', e);
    }
    const cartouche = await CartoucheData.build({ nomPlan: 'Plan de situation projet', indice, scale: null });
    if (!cartouche || cartouche.project_latitude == null || cartouche.project_longitude == null) {
      throw new Error("Localisation du projet introuvable : renseignez l'adresse dans Paramètres projet.");
    }
    return cartouche;
  }

  static async _fetchParcellesLocalMeters(lat, lng) {
    try {
      const codeInsee = await GET_CODE_INSEE_BY_COORDINATES(lat, lng);
      if (!codeInsee) return [];
      const { parcelles } = await GET_CADASTRE_DATA(codeInsee);
      if (!parcelles || !Array.isArray(parcelles.features)) return [];

      const polygons = [];
      parcelles.features.forEach((feature) => {
        const geom = feature.geometry;
        if (!geom) return;
        const rings = geom.type === 'Polygon' ? [geom.coordinates[0]]
          : geom.type === 'MultiPolygon' ? geom.coordinates.map((poly) => poly[0])
          : [];
        rings.forEach((ring) => {
          const points = ring.map(([lon, latPt]) => GeoMeters.lonLatToLocalMeters(lon, latPt, lat, lng));
          const withinRange = points.some((p) => Math.hypot(p.x, p.y) <= PARCELLES_SEARCH_RADIUS_M);
          if (withinRange) {
            polygons.push(points.map((p) => ({ x: p.x, y: p.y })));
          }
        });
      });
      return polygons;
    } catch (e) {
      console.warn('[PlanSituation] Parcelles cadastrales indisponibles:', e);
      return [];
    }
  }

  /**
   * Marqueur + cercle "Localisation projet", positionné à son décalage réel
   * (mètres -> mm à l'échelle de la page) par rapport au centre de la vue
   * capturée - qui peut différer du point projet lui-même (page 2, centrée sur
   * les panneaux). N'affiche le pin que s'il tombe dans la page imprimée.
   */
  static _drawLocationMarker(pdf, scale, viewCenter, markerLatLng) {
    const offset = GeoMeters.offsetMeters(viewCenter, markerLatLng);
    const offsetXMm = (offset.x * 1000) / scale;
    const offsetYMm = (offset.y * 1000) / scale;
    const cx = MARGIN_MM + VIEWPORT_W_MM / 2 + offsetXMm;
    const cy = MARGIN_MM + VIEWPORT_H_MM / 2 - offsetYMm; // Y papier vers le bas, Y nord vers le haut
    const radiusMm = (LOCATION_RADIUS_M * 1000) / scale;

    pdf.saveGraphicsState();
    // Style `null` : sans lui jsPDF trace le rectangle avant `W n` et le découpage est sans effet
    // (le cercle de 3 km débordait du cadre).
    pdf.rect(MARGIN_MM, MARGIN_MM, VIEWPORT_W_MM, VIEWPORT_H_MM, null);
    pdf.clip();
    pdf.discardPath();
    if (radiusMm > 0.5) {
      pdf.setDrawColor(0, 170, 255);
      pdf.setLineWidth(0.4);
      pdf.circle(cx, cy, radiusMm, 'S');
    }
    pdf.restoreGraphicsState();

    const withinPage = cx >= MARGIN_MM && cx <= PAGE_W_MM - MARGIN_MM && cy >= MARGIN_MM && cy <= PAGE_H_MM - MARGIN_MM;
    if (!withinPage) return;

    pdf.setFillColor(220, 38, 38);
    pdf.circle(cx, cy, 1.4, 'F');
    pdf.setDrawColor(220, 38, 38);
    pdf.setLineWidth(0.3);
    pdf.line(cx, cy, cx, cy - 4);
    pdf.setFontSize(7);
    pdf.setTextColor(220, 38, 38);
    pdf.text('Localisation projet', cx + 2, cy - 3);
  }

  static async exportPdf({ indice = 'A', onProgress } = {}) {
    const cartouche = await this._ensureContext(indice);
    const map = window.map;
    if (!map) throw new Error('Carte non initialisée.');
    const projectCenter = { lat: cartouche.project_latitude, lng: cartouche.project_longitude };
    const panelsCenter = PanelsExtent.getCenter();

    const snapshot = MapLayerSwitcher.snapshot();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

    // Voile pose sur TOUTE la duree de l'export, et pas seulement autour de chaque
    // capture : les bascules de fond de carte entre les pages (OSM -> Geoportail +
    // cadastre) sont elles aussi visibles a l'ecran sans lui.
    const progress = (msg) => {
      CaptureVeil.setMessage(msg);
      if (onProgress) onProgress(msg);
    };
    await CaptureVeil.show('Préparation de la capture…');

    try {
      for (let i = 0; i < PAGES.length; i++) {
        const page = PAGES[i];
        progress(`Capture ${page.label}...`);
        const pageCenter = (page.centerOnPanels && panelsCenter) ? panelsCenter : projectCenter;

        let restoreOsmTileUrl = null;
        if (page.layer === 'osm') {
          restoreOsmTileUrl = MapLayerSwitcher.setOsmForExport();
        } else {
          MapLayerSwitcher.setGeoportailWithCadastre();
        }

        const hiddenPanels = page.hidePanels ? PanelVisibility.hideAll() : null;

        let canvas, widthMm, heightMm;
        try {
          ({ canvas, widthMm, heightMm } = await ScaleAlignedCapture.captureAtScale({
            map,
            center: pageCenter,
            targetScale: page.scale,
            printWidthMm: VIEWPORT_W_MM,
            printHeightMm: VIEWPORT_H_MM,
            pixelDensity: 3,
          }));
        } finally {
          if (restoreOsmTileUrl) restoreOsmTileUrl();
          if (hiddenPanels) PanelVisibility.restore(hiddenPanels);
        }

        if (i > 0) pdf.addPage('a3', 'landscape');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN_MM, MARGIN_MM, widthMm, heightMm);
        this._drawLocationMarker(pdf, page.scale, pageCenter, projectCenter);
        PdfCartouche.drawCadre(pdf);
        PdfCartouche.drawCartouche(pdf, cartouche, page.scale);
        PdfScaleBar.draw(pdf, { scale: page.scale, pageHmm: PAGE_H_MM, marginMm: MARGIN_MM });
      }
    } finally {
      CaptureVeil.setMessage('Restauration de la carte…');
      await MapLayerSwitcher.restore(snapshot);
      // On ne leve le voile qu'une fois le fond de carte d'origine re-affiche.
      try {
        await ScaleAlignedCapture.waitUntilSettled(map);
      } catch (e) {
        console.warn('[PlanSituation] Stabilisation de la carte interrompue:', e);
      }
      CaptureVeil.hide();
    }

    return { blob: pdf.output('blob'), filename: 'plan_situation.pdf' };
  }

  static async exportDxf({ indice = 'A', onProgress } = {}) {
    const cartouche = await this._ensureContext(indice);
    if (onProgress) onProgress('Récupération des parcelles cadastrales...');
    const projectLatLng = { lat: cartouche.project_latitude, lng: cartouche.project_longitude };
    const parcelles = await this._fetchParcellesLocalMeters(projectLatLng.lat, projectLatLng.lng);
    const panelsCenter = PanelsExtent.getCenter();
    const panelsOffset = panelsCenter ? GeoMeters.offsetMeters(projectLatLng, panelsCenter) : { x: 0, y: 0 };

    const payload = {
      cartouche: {
        nom_projet: cartouche.nom_projet,
        nom_plan: cartouche.nom_plan,
        indice: cartouche.indice,
        date: cartouche.date,
        adresse: cartouche.adresse,
        company_name: cartouche.company_name,
        company_logo: cartouche.company_logo,
      },
      paper: { format: 'A3', orientation: 'landscape' },
      location_marker: { radius_m: LOCATION_RADIUS_M, label: 'Localisation projet' },
      parcelles,
      pages: PAGES.map((p) => ({
        name: p.name,
        scale: p.scale,
        view_center: p.centerOnPanels ? { x: panelsOffset.x, y: panelsOffset.y } : { x: 0, y: 0 },
      })),
    };

    if (onProgress) onProgress('Génération du DXF...');
    const res = await fetch('/concevoir_mon_projet/api/export_dxf/situation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Échec de la génération DXF (HTTP ${res.status})`);
    }
    return { blob: await res.blob(), filename: 'plan_situation_dxf.zip' };
  }
}
