import ScaleAlignedCapture from './utils/ScaleAlignedCapture.js';
import CaptureVeil from './utils/CaptureVeil.js';
import MapLayerSwitcher from './utils/MapLayerSwitcher.js?v=2';
import CartoucheData from './utils/CartoucheData.js';
import PanelsExtent from './utils/PanelsExtent.js?v=3';
import PdfCartouche from './utils/PdfCartouche.js?v=2';
import PdfScaleBar from './utils/PdfScaleBar.js';
import GeoMeters from './utils/GeoMeters.js';
import { GET_CODE_INSEE_BY_COORDINATES, GET_CADASTRE_DATA } from '../../API/API.js';

const { VIEWPORT_W_MM, VIEWPORT_H_MM, MARGIN_MM } = PdfCartouche;
const DEFAULT_SCALE = 500;
const EXTENT_PADDING = 1.25; // 25% de marge autour de la zone d'implantation (page 2, échelle auto)
const NICE_SCALES = [100, 150, 200, 250, 500, 750, 1000, 1500, 2000, 2500, 5000, 7500, 10000];

function pickNiceScale(neededScale) {
  const fit = NICE_SCALES.find((s) => s >= neededScale);
  if (fit) return fit;
  return Math.ceil(neededScale / 500) * 500;
}

/**
 * Génération du Plan de masse (PDF + DXF) :
 * page 1 (Géoportail + Cadastre, 1/500 fixe), page 2 (fond blanc + Cadastre
 * Géoportail, échelle calculée automatiquement pour cadrer toute la zone
 * d'implantation des panneaux), et - PDF uniquement - page 3 (fond blanc +
 * Cadastre cadastre.gouv.fr, la "2e option" du menu Cadastre, même échelle que
 * la page 2). Toutes centrées sur la zone d'implantation.
 *
 * Page "outil capture libre" : pas encore implémentée (Phase 3).
 */
export default class PlanDeMasseExporter {
  static async _ensureContext(indice) {
    // Calepinage sur canevas : panneaux remis à jour sur la carte avant capture (cf.
    // calepinage_maison_carte_plans.js), pour qu'ils figurent sur les pages PDF.
    try {
      if (window.CalepinageMaisonPlans) window.CalepinageMaisonPlans.synchroniser();
    } catch (e) {
      console.warn('[PlanDeMasse] Report des panneaux du calepinage sur la carte impossible:', e);
    }
    const cartouche = await CartoucheData.build({ nomPlan: 'Plan de masse', indice, scale: null });
    if (!cartouche) {
      throw new Error('Projet introuvable. Sélectionnez un projet avant l\'export.');
    }
    const extent = PanelsExtent.getExtentMeters();
    if (!extent) {
      throw new Error("Aucune implantation de panneaux dessinée : le plan de masse nécessite au moins une forme de calepinage.");
    }
    Object.assign(cartouche, await this._totauxPanneaux());
    return { cartouche, extent };
  }

  /**
   * Cases « Nbre PV » et « Puissance projet » du cartouche (demande explicite) : panneaux réellement
   * dessinés sur le plan. Calepinage sur canevas : même résumé que les dossiers de plans et la barre
   * d'outils (CM.getAllPvFieldSummaries). Panneaux posés par l'ancien calepinage « grand projet »
   * (DrawingControl) : comptés un par un, mais leur puissance unitaire n'est pas connue ici — la
   * puissance du projet vient alors du serveur (même route que le devis). Inconnue : case omise.
   * @returns {Promise<{nb_pv:number|null, puissance_kwc:number|null}>}
   */
  static async _totauxPanneaux() {
    let nb = 0;
    let kwc = 0;
    try {
      const CM = window.CalepinageMaisonIndiv;
      const resumes = CM && typeof CM.getAllPvFieldSummaries === 'function' ? CM.getAllPvFieldSummaries() : [];
      resumes.forEach((r) => {
        nb += Number(r && r.panelCount) || 0;
        kwc += Number(r && r.peakPower) || 0;
      });
    } catch (e) {
      console.warn('[PlanDeMasse] Résumé des champs PV indisponible:', e);
    }
    let nbGrandProjet = 0;
    try {
      nbGrandProjet = PanelsExtent._getDrawingControlPanelsLatLng().length;
    } catch (e) {
      nbGrandProjet = 0;
    }
    if (nbGrandProjet > 0) {
      nb += nbGrandProjet;
      kwc = await this._puissanceProjetServeurKwc();
    }
    return {
      nb_pv: nb > 0 ? nb : null,
      puissance_kwc: kwc > 0 ? Math.round(kwc * 1000) / 1000 : null,
    };
  }

  static async _puissanceProjetServeurKwc() {
    const projetId = localStorage.getItem('current_projet_id');
    if (!projetId) return null;
    try {
      const res = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/puissance-etude`);
      const json = await res.json();
      return json && json.success && json.puissance_kwc > 0 ? Number(json.puissance_kwc) : null;
    } catch (e) {
      console.warn('[PlanDeMasse] Puissance du projet indisponible:', e);
      return null;
    }
  }

  static _computeAutoScale(extent) {
    const scaleW = (extent.widthM * EXTENT_PADDING * 1000) / VIEWPORT_W_MM;
    const scaleH = (extent.heightM * EXTENT_PADDING * 1000) / VIEWPORT_H_MM;
    return pickNiceScale(Math.max(scaleW, scaleH, 1));
  }

  static _buildPages(autoScale) {
    return [
      { name: 'Masse_1_Geoportail_Cadastre', label: 'Plan de masse - Géoportail + Cadastre', scale: DEFAULT_SCALE, mode: 'geoportail_cadastre' },
      { name: 'Masse_2_Cadastre_Echelle_Auto', label: `Plan de masse - Cadastre (échelle 1:${autoScale} auto)`, scale: autoScale, mode: 'blank_cadastre' },
    ];
  }

  /**
   * Demi-emprise réelle (mètres) de la plus grande page imprimée : c'est exactement la portion de
   * territoire que le plan montre, à l'échelle `maxScale`.
   */
  static _pageHalfExtentMeters(maxScale) {
    const MARGE = 1.05; // une parcelle qui affleure le bord de page reste dessinée en entier
    return {
      halfW: ((VIEWPORT_W_MM * maxScale) / 1000 / 2) * MARGE,
      halfH: ((VIEWPORT_H_MM * maxScale) / 1000 / 2) * MARGE,
    };
  }

  /**
   * Parcelles cadastrales, en mètres réels relatifs à `origin`, LIMITÉES à celles visibles sur le
   * plan.
   *
   * GET_CADASTRE_DATA renvoie le cadastre de la COMMUNE entière : sans filtre, le DXF embarquait
   * des milliers de parcelles sans rapport avec le projet. On ne garde donc que celles dont
   * l'emprise recoupe le rectangle de la page (demande explicite : « juste les parcelles autour du
   * projet »).
   *
   * Le test porte sur la boîte englobante, et non plus sur « au moins un sommet dans un rayon » :
   * ce dernier écartait une grande parcelle qui CONTIENT le projet sans avoir aucun sommet à
   * proximité — précisément la parcelle d'implantation.
   *
   * Conversion avec la convention du calepinage (cf. GeoMeters) : le fond cadastral se superpose
   * ainsi au calque IMPLANTATION/PANNEAUX sans décalage d'échelle entre les deux.
   */
  static async _fetchParcellesLocalMeters(origin, halfW, halfH) {
    try {
      const codeInsee = await GET_CODE_INSEE_BY_COORDINATES(origin.lat, origin.lng);
      if (!codeInsee) return [];
      const { parcelles } = await GET_CADASTRE_DATA(codeInsee);
      if (!parcelles || !Array.isArray(parcelles.features)) return [];

      const mLat = GeoMeters.CALEPINAGE_METERS_PER_LAT_DEGREE;
      const polygons = [];
      parcelles.features.forEach((feature) => {
        const geom = feature.geometry;
        if (!geom) return;
        const rings = geom.type === 'Polygon' ? [geom.coordinates[0]]
          : geom.type === 'MultiPolygon' ? geom.coordinates.map((poly) => poly[0])
          : [];
        rings.forEach((ring) => {
          const points = ring.map(([lon, lat]) => GeoMeters.lonLatToLocalMeters(lon, lat, origin.lat, origin.lng, mLat));
          if (points.length < 3) return;
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          points.forEach((p) => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          });
          const horsCadre = minX > halfW || maxX < -halfW || minY > halfH || maxY < -halfH;
          if (!horsCadre) polygons.push(GeoMeters.roundPolygon(points));
        });
      });
      return polygons;
    } catch (e) {
      console.warn('[PlanDeMasse] Parcelles cadastrales indisponibles:', e);
      return [];
    }
  }

  static async exportPdf({ indice = 'A', onProgress } = {}) {
    const { cartouche, extent } = await this._ensureContext(indice);
    const map = window.map;
    if (!map) throw new Error('Carte non initialisée.');
    const center = extent.center;
    const autoScale = this._computeAutoScale(extent);
    const pages = this._buildPages(autoScale);
    // Page 3 (PDF uniquement) : même fond blanc + échelle auto que la page 2, mais
    // avec le cadastre cadastre.gouv.fr (2e option du menu "Cadastre") au lieu du
    // cadastre Géoportail (1re option).
    pages.push({
      name: 'Masse_3_Cadastre_WMS',
      label: `Plan de masse - Cadastre (option 2, échelle 1:${autoScale} auto)`,
      scale: autoScale,
      mode: 'blank_cadastre_wms',
    });

    const snapshot = MapLayerSwitcher.snapshot();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

    // Voile pose sur TOUTE la duree de l'export : il masque aussi les bascules de
    // fond de carte entre les pages (Geoportail + cadastre -> fond blanc + cadastre
    // -> cadastre WMS), visibles a l'ecran sans lui.
    const progress = (msg) => {
      CaptureVeil.setMessage(msg);
      if (onProgress) onProgress(msg);
    };
    await CaptureVeil.show('Préparation de la capture…');

    try {
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        progress(`Capture ${page.label}...`);

        if (page.mode === 'geoportail_cadastre') {
          MapLayerSwitcher.setGeoportailWithCadastre();
        } else if (page.mode === 'blank_cadastre_wms') {
          await MapLayerSwitcher.setBlankWithCadastreWMS(center);
        } else {
          MapLayerSwitcher.setBlankWithCadastre();
        }

        const { canvas, widthMm, heightMm } = await ScaleAlignedCapture.captureAtScale({
          map,
          center,
          targetScale: page.scale,
          printWidthMm: VIEWPORT_W_MM,
          printHeightMm: VIEWPORT_H_MM,
          pixelDensity: 3,
        });

        if (i > 0) pdf.addPage('a3', 'landscape');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN_MM, MARGIN_MM, widthMm, heightMm);
        PdfCartouche.drawCadre(pdf);
        PdfCartouche.drawCartouche(pdf, { ...cartouche, nom_plan: page.label }, page.scale);
        PdfScaleBar.draw(pdf, { scale: page.scale, pageHmm: PdfCartouche.PAGE_H_MM, marginMm: MARGIN_MM });
      }
    } finally {
      CaptureVeil.setMessage('Restauration de la carte…');
      await MapLayerSwitcher.restore(snapshot);
      // On ne leve le voile qu'une fois le fond de carte d'origine re-affiche.
      try {
        await ScaleAlignedCapture.waitUntilSettled(map);
      } catch (e) {
        console.warn('[PlanDeMasse] Stabilisation de la carte interrompue:', e);
      }
      CaptureVeil.hide();
    }

    // Calepinage sur canevas (résidentiel / professionnel) : une page « Plan de calepinage » par
    // champ PV, avec le dessin du canevas (panneaux, obstacles, cotations, matériels électriques).
    await this._addCanvasCalepinagePages(pdf, cartouche, progress);

    return { blob: pdf.output('blob'), filename: 'plan_de_masse.pdf' };
  }

  static async _addCanvasCalepinagePages(pdf, cartouche, progress) {
    const CM = window.CalepinageMaisonIndiv;
    const plans = window.CalepinageMaisonPlans;
    if (!CM || typeof CM.captureRoofDiagramImage !== 'function' || !plans) return;
    const champs = plans.getChamps().filter((champ) => champ.panneaux.length);
    const zoneW = VIEWPORT_W_MM - 8;
    const zoneH = VIEWPORT_H_MM - PdfCartouche.CARTOUCHE_H_MM - 8;
    for (const champ of champs) {
      if (progress) progress(`Plan de calepinage ${champ.sourceId}...`);
      const canvas = await this._captureCanevasAvecFond(CM, champ.sourceId);
      if (!canvas) continue;
      const ratio = canvas.width / canvas.height;
      let w = zoneW, h = zoneW / ratio;
      if (h > zoneH) { h = zoneH; w = zoneH * ratio; }
      pdf.addPage('a3', 'landscape');
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN_MM + (VIEWPORT_W_MM - w) / 2, MARGIN_MM + 4, w, h);
      PdfCartouche.drawCadre(pdf);
      // Vue du canevas : cadrage ajusté au champ PV, pas d'échelle d'impression garantie.
      PdfCartouche.drawCartouche(pdf, { ...cartouche, nom_plan: `Plan de calepinage - ${champ.sourceId}` }, 'NA');
    }
  }

  /**
   * Canevas d'un champ PV avec la vue aérienne en arrière-plan (bug rapporté : page « Plan de
   * calepinage » sortie sur fond noir). Le fond de carte n'est jamais sauvegardé : après un
   * rechargement, le champ n'en a pas tant que son modal n'a pas été rouvert. On le reprend ici à la
   * demande (CM.ensureMapBackground, comme la DP et le pompage solaire), sous le voile de capture
   * car la carte est recadrée le temps de la photo. Sans fond disponible : canevas seul, comme avant.
   */
  static async _captureCanevasAvecFond(CM, sourceId) {
    const state = typeof CM.getHouseStateById === 'function' ? CM.getHouseStateById(sourceId) : null;
    let avecFond = false;
    if (state && typeof CM.ensureMapBackground === 'function') {
      await CaptureVeil.show('Capture de la vue aérienne…');
      try {
        avecFond = await CM.ensureMapBackground(sourceId, { cadrageSerre: true });
      } catch (e) {
        console.warn(`[PlanDeMasse] Fond de carte du champ ${sourceId} indisponible:`, e);
        avecFond = false;
      } finally {
        CaptureVeil.hide();
      }
    }
    // Affichage du fond forcé le temps de la capture (l'utilisateur a pu le masquer dans le
    // canevas), puis rétabli : le plan 2D n'en garde aucune trace.
    const affichageAvant = state ? state.showBackgroundImage : null;
    if (state && avecFond) state.showBackgroundImage = true;
    try {
      return await CM.captureRoofDiagramImage(sourceId, 1600, 1000);
    } catch (e) {
      console.warn(`[PlanDeMasse] Canevas de calepinage ${sourceId} indisponible:`, e);
      return null;
    } finally {
      if (state && avecFond) state.showBackgroundImage = affichageAvant;
    }
  }

  static async exportDxf({ indice = 'A', onProgress } = {}) {
    const { cartouche, extent } = await this._ensureContext(indice);
    const autoScale = this._computeAutoScale(extent);
    const pages = this._buildPages(autoScale);

    if (onProgress) onProgress('Récupération des parcelles cadastrales...');
    const maxScale = Math.max(DEFAULT_SCALE, autoScale);
    const { halfW, halfH } = this._pageHalfExtentMeters(maxScale);
    const parcelles = await this._fetchParcellesLocalMeters(extent.center, halfW, halfH);
    const { implantation, panneaux } = PanelsExtent.getExportGeometryMeters(extent.center);

    const payload = {
      cartouche: {
        nom_projet: cartouche.nom_projet,
        nom_plan: 'Plan de masse',
        indice: cartouche.indice,
        date: cartouche.date,
        adresse: cartouche.adresse,
        company_name: cartouche.company_name,
        company_logo: cartouche.company_logo,
        nb_pv: cartouche.nb_pv,
        puissance_kwc: cartouche.puissance_kwc,
      },
      paper: { format: 'A3', orientation: 'landscape' },
      parcelles,
      implantation,
      panneaux,
      pages: pages.map((p) => ({ name: p.name, scale: p.scale, view_center: { x: 0, y: 0 } })),
    };

    if (onProgress) onProgress('Génération du DXF...');
    const res = await fetch('/concevoir_mon_projet/api/export_dxf/plan_de_masse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Échec de la génération DXF (HTTP ${res.status})`);
    }
    return { blob: await res.blob(), filename: 'plan_de_masse_dxf.zip' };
  }
}
