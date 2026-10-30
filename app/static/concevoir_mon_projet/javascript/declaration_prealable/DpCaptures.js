import ScaleAlignedCapture from '../export_plans_pdf_dxf/utils/ScaleAlignedCapture.js';
import CaptureVeil from '../export_plans_pdf_dxf/utils/CaptureVeil.js';
import MapLayerSwitcher from '../export_plans_pdf_dxf/utils/MapLayerSwitcher.js?v=2';
import CartoucheData from '../export_plans_pdf_dxf/utils/CartoucheData.js';
import PanelVisibility from '../export_plans_pdf_dxf/utils/PanelVisibility.js?v=2';
import PanelsExtent from '../export_plans_pdf_dxf/utils/PanelsExtent.js?v=3';
import GeoMeters from '../export_plans_pdf_dxf/utils/GeoMeters.js';
import { GET_CODE_INSEE_BY_COORDINATES, GET_CADASTRE_DATA } from '../../API/API.js';
import { contentZone } from './DpLayout.js?v=2';
import { canvasToJpeg, dataUrlToJpeg } from './DpImages.js';
import { chargerEntreprise } from './DpEntreprise.js';

/**
 * Phase de CAPTURE du dossier DP (la seule coûteuse) : fonds de carte à l'échelle, plans de
 * toiture du canevas, coupe, vues 3D. Exécutée une fois par génération ; l'assemblage des PDF
 * (DpPieces.js) réutilise ensuite ces images autant de fois que nécessaire (PDF complet, ZIP,
 * pièce seule) sans rien recapturer.
 *
 * Les fonds de carte sont capturés SANS aucun élément dessiné (panneaux, contours, cotations,
 * étiquettes) : ces éléments sont redessinés en vectoriel dans le PDF, à l'échelle exacte. Un seul
 * fond sert aux deux plans de masse (avant / projet).
 */
const MAP_ZONE = contentZone('landscape');
// Échelles d'un plan de masse DP (cahier des charges : 1/250, 1/500 ou 1/750), puis échelles
// réduites pour qu'une grande parcelle tienne ENTIÈRE dans la page (adaptation automatique).
const MASSE_SCALES = [250, 500, 750];
const MASSE_SCALES_REDUITES = [1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000];
// Au-delà, les panneaux ne font plus qu'un point : cadrage sur l'implantation.
const MASSE_SCALE_MAX = 5000;
const MASSE_MARGIN = 1.15; // 15 % d'air autour de la parcelle et de l'implantation
const MAP_PIXEL_DENSITY = 2.5; // ~230 dpi sur la zone carte A4 : net à l'impression, PDF raisonnable

// ---------------------------------------------------------------------------------------------
// Contexte : projet, demandeur, champs PV, parcelle, cotations
// ---------------------------------------------------------------------------------------------
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Parcelle cadastrale contenant `center` (Etalab, déjà utilisé par les plans existants). */
export async function fetchParcelle(center) {
  try {
    const codeInsee = await GET_CODE_INSEE_BY_COORDINATES(center.lat, center.lng);
    if (!codeInsee) return null;
    const { parcelles } = await GET_CADASTRE_DATA(codeInsee);
    if (!parcelles || !Array.isArray(parcelles.features)) return null;
    for (const feature of parcelles.features) {
      const g = feature.geometry;
      if (!g) continue;
      const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : [];
      const ring = rings.find((r) => pointInRing(center.lng, center.lat, r));
      if (ring) {
        const props = feature.properties || {};
        return {
          ring: ring.map(([lng, lat]) => ({ lat, lng })),
          reference: [props.section, props.numero].filter(Boolean).join(' '),
        };
      }
    }
  } catch (e) {
    console.warn('[DP] Parcelle cadastrale indisponible :', e);
  }
  return null;
}

function demandeurLibelle(d) {
  if (d.typeDemandeur === 'societe') return d.societe ? `Société ${d.societe}` : '';
  return [d.civilite, d.nom].filter(Boolean).join(' ');
}

function boundsMeters(center, pointLists) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pointLists.forEach((pts) => pts.forEach((p) => {
    const m = GeoMeters.offsetMeters(center, p);
    minX = Math.min(minX, m.x); maxX = Math.max(maxX, m.x);
    minY = Math.min(minY, m.y); maxY = Math.max(maxY, m.y);
  }));
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function metersToLatLng(center, x, y) {
  return {
    lat: center.lat + y / GeoMeters.METERS_PER_LAT_DEGREE,
    lng: center.lng + x / (GeoMeters.METERS_PER_LAT_DEGREE * Math.cos((center.lat * Math.PI) / 180)),
  };
}

/** Échelle minimale (dénominateur) pour faire tenir une emprise dans la zone carte. */
function echelleNecessaire(b) {
  return Math.max(
    ((b.maxX - b.minX) * MASSE_MARGIN * 1000) / MAP_ZONE.w,
    ((b.maxY - b.minY) * MASSE_MARGIN * 1000) / MAP_ZONE.h,
    1,
  );
}

/**
 * Échelle et centre du plan de masse en mode automatique : toute la parcelle + l'implantation à la
 * plus grande échelle où elles tiennent (1/250, 1/500, 1/750, puis 1/1000... 1/5000 pour une grande
 * parcelle). Seule une parcelle encore trop grande au 1/5000 (exploitation, zone d'activité...) est
 * cadrée sur l'IMPLANTATION (`repli` : contours des champs, panneaux, cotations).
 * @returns {{center, scale, parcelleEntiere:boolean, reduite:boolean}}
 */
export function cadrageMasse(center, pointLists, echelleChoisie, repli = null) {
  const b = boundsMeters(center, pointLists);
  if (!b) return { center, scale: Number(echelleChoisie) || 500, parcelleEntiere: false, reduite: false };
  const cadre = metersToLatLng(center, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  const need = echelleNecessaire(b);
  if (echelleChoisie && echelleChoisie !== 'auto') {
    return { center: cadre, scale: Number(echelleChoisie), parcelleEntiere: need <= Number(echelleChoisie), reduite: false };
  }
  const fit = MASSE_SCALES.find((s) => s >= need);
  if (fit) return { center: cadre, scale: fit, parcelleEntiere: true, reduite: false };
  const reduite = MASSE_SCALES_REDUITES.find((s) => s >= need);
  if (reduite) return { center: cadre, scale: reduite, parcelleEntiere: true, reduite: true };
  const br = repli ? boundsMeters(center, repli) : null;
  if (br) {
    const needR = echelleNecessaire(br);
    const scale = [...MASSE_SCALES, ...MASSE_SCALES_REDUITES].find((s) => s >= needR) || Math.ceil(needR / 500) * 500;
    return { center: metersToLatLng(center, (br.minX + br.maxX) / 2, (br.minY + br.maxY) / 2), scale, parcelleEntiere: false, reduite: scale > 750 };
  }
  // Pas d'implantation connue : toute la parcelle, quitte à descendre sous le 1/5000.
  return { center: cadre, scale: Math.ceil(need / 500) * 500, parcelleEntiere: true, reduite: true };
}

export function champDuDossier(ctx, champId) {
  return ctx.champs.find((c) => c.sourceId === champId)
    || ctx.champs.find((c) => c.panneaux.length)
    || ctx.champs[0] || null;
}

export async function buildContext(dpState) {
  const d = dpState.data;
  try {
    if (window.CalepinageMaisonPlans) window.CalepinageMaisonPlans.synchroniser();
  } catch (e) { /* le report des panneaux sur la carte est un confort, pas un prérequis */ }

  const cartouche = await CartoucheData.build({ nomPlan: '', indice: d.indice || 'A', scale: null });
  if (!cartouche) throw new Error('Aucun projet actif : ouvrez un projet avant de générer la DP.');

  const projectLatLng = cartouche.project_latitude != null
    ? { lat: cartouche.project_latitude, lng: cartouche.project_longitude } : null;
  let champs = [];
  try { champs = window.CalepinageMaisonPlans ? window.CalepinageMaisonPlans.getChamps() : []; } catch (e) { champs = []; }
  const panneaux = PanelsExtent.getPanelsLatLng();
  const implantation = PanelsExtent.getCenter() || projectLatLng;
  if (!implantation) throw new Error("Localisation du projet introuvable : renseignez l'adresse dans Paramètres projet.");

  const [parcelle, entreprise] = await Promise.all([fetchParcelle(implantation), chargerEntreprise()]);
  const cotations = (window.drawingControl && window.drawingControl.cotationManager)
    ? window.drawingControl.cotationManager.getCotations() : [];

  return {
    cartouche,
    indice: d.indice || 'A',
    adresse: d.adresse || cartouche.adresse,
    demandeurLibelle: demandeurLibelle(d),
    projectLatLng,
    implantation,
    champs,
    panneaux,
    parcelle,
    cotations,
    entreprise,
  };
}

// ---------------------------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------------------------

/** Retire de la carte tout ce qui est dessiné (redessiné ensuite en vectoriel). */
function masquerDessinsCarte(viewpoints) {
  const restaurations = [];
  const CM = window.CalepinageMaisonIndiv;
  if (CM && typeof CM.masquerElementsCarteCalepinage === 'function') {
    restaurations.push(CM.masquerElementsCarteCalepinage());
  }
  const hidden = PanelVisibility.hideAll();
  restaurations.push(() => PanelVisibility.restore(hidden));

  const mgr = window.MaisonPolygonManagerInstance;
  if (mgr) {
    const polys = (mgr.polygons || []).filter((p) => p && typeof p.getMap === 'function' && p.getMap());
    polys.forEach((p) => p.setMap(null));
    if (typeof mgr.setAllRoofVisualsVisible === 'function') mgr.setAllRoofVisualsVisible(false);
    if (typeof mgr.setAllDimensionLabelsVisible === 'function') mgr.setAllDimensionLabelsVisible(false);
    restaurations.push(() => {
      polys.forEach((p) => p.setMap(window.map));
      if (typeof mgr.setAllRoofVisualsVisible === 'function') mgr.setAllRoofVisualsVisible(true);
      if (typeof mgr.setAllDimensionLabelsVisible === 'function') mgr.setAllDimensionLabelsVisible(true);
    });
  }
  const cot = window.drawingControl && window.drawingControl.cotationManager;
  if (cot) restaurations.push(cot.setAllVisible(false));
  // Surfaces / exclusions de la loi APER (calcul_APER.js) : jamais dans un plan DP ; le dossier des
  // ombrières les redessine en vectoriel sur sa page APER.
  const aper = window.calculateurAPERInstance && window.calculateurAPERInstance.polygonManager;
  if (aper) {
    const polysAper = [...(aper.surfacePolygons || []), ...(aper.exclusionPolygons || []), ...(aper.helperPolygons || [])]
      .filter((p) => p && typeof p.getMap === 'function' && p.getMap());
    const cartes = polysAper.map((p) => p.getMap());
    polysAper.forEach((p) => p.setMap(null));
    restaurations.push(() => polysAper.forEach((p, i) => p.setMap(cartes[i])));
  }
  if (viewpoints) restaurations.push(viewpoints.hideForCapture());
  return () => restaurations.reverse().forEach((fn) => { try { fn(); } catch (e) { /* noop */ } });
}

async function captureMap(map, { center, scale, layer }) {
  let restoreOsm = null;
  if (layer === 'osm') restoreOsm = MapLayerSwitcher.setOsmForExport();
  else MapLayerSwitcher.setGeoportailWithCadastre();
  try {
    const { canvas, georef } = await ScaleAlignedCapture.captureAtScale({
      map, center, targetScale: scale,
      printWidthMm: MAP_ZONE.w, printHeightMm: MAP_ZONE.h,
      pixelDensity: MAP_PIXEL_DENSITY,
    });
    return { image: canvasToJpeg(canvas, { maxSide: 4000, quality: 0.88 }), center, scale, georef };
  } finally {
    if (restoreOsm) restoreOsm();
  }
}

// Marge autour du contour (m) : les cotations du canevas sont tracées 1 m à l'extérieur, plus leur
// étiquette. 2 m les gardent entières quelle que soit la taille du toit.
const TOITURE_MARGE_M = 2;
// Une cotation de la carte est reportée sur le plan de toiture du champ le plus proche si l'une de
// ses extrémités est à moins de cette distance du contour (cotation toit -> limite de propriété).
const COTATION_TOITURE_DISTANCE_M = 20;

function distancePointSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance (m) d'un point lat/lng à un contour lat/lng (0 à l'intérieur). */
function distanceAuContour(point, contour) {
  if (!contour || contour.length < 3) return Infinity;
  const o = contour[0];
  const ring = contour.map((q) => GeoMeters.offsetMeters(o, q));
  const p = GeoMeters.offsetMeters(o, point);
  if (pointInRing(p.x, p.y, ring.map((q) => [q.x, q.y]))) return 0;
  let d = Infinity;
  ring.forEach((a, i) => { d = Math.min(d, distancePointSegment(p, a, ring[(i + 1) % ring.length])); });
  return d;
}

/** sourceId -> ids des cotations de la carte à reporter sur son plan de toiture. */
export function cotationsParToiture(cotations, champs) {
  const res = {};
  cotations.forEach((c) => {
    let best = null;
    champs.forEach((champ) => {
      const d = Math.min(distanceAuContour(c.a, champ.contour), distanceAuContour(c.b, champ.contour));
      if (d <= COTATION_TOITURE_DISTANCE_M && (!best || d < best.d)) best = { d, id: champ.sourceId };
    });
    if (best) (res[best.id] ||= []).push(c.id);
  });
  return res;
}

function origineChamp(CM, sourceId) {
  try {
    const champ = (CM.listerChampsCarte() || []).find((c) => c.sourceId === sourceId);
    const o = champ && champ.origin;
    if (!o) return null;
    return typeof o.lat === 'function' ? o : new google.maps.LatLng(o.lat, o.lng);
  } catch (e) {
    return null;
  }
}

/**
 * @param {Object[]} cotations cotations de la carte à garder dans le cadre (reportées ensuite en
 *   vectoriel dans le PDF, avec la limite de parcelle)
 * @returns {{image, versPx:Function|null, largeurPx:number, hauteurPx:number}|null}
 *   versPx : lat/lng -> pixels de l'image (null si le repère est inconnu)
 */
async function captureRoof(sourceId, withPanels, cotations = []) {
  const CM = window.CalepinageMaisonIndiv;
  if (!CM || typeof CM.captureRoofDiagramImage !== 'function') return null;
  const state = CM.getHouseStateById(sourceId);
  if (!state) return null;
  // Avant travaux : la toiture existante sur son fond de carte. Ce fond n'est jamais sauvegardé
  // (cf. dessin.js::ensureMapBackground) : il est repris à la demande après un rechargement.
  let avecFond = false;
  if (!withPanels && typeof CM.ensureMapBackground === 'function') {
    try { avecFond = await CM.ensureMapBackground(sourceId); } catch (e) { avecFond = false; }
  }
  const origine = typeof CM.latLngToLocal === 'function' ? origineChamp(CM, sourceId) : null;
  const versLocal = origine ? (ll) => CM.latLngToLocal(origine, new google.maps.LatLng(ll.lat, ll.lng)) : null;
  const pointsLocaux = versLocal ? cotations.flatMap((c) => [versLocal(c.a), versLocal(c.b)]) : [];

  const keys = ['showPanels', 'showBackgroundImage', 'showOrientationCard', 'showStructure', 'showCotations'];
  const saved = {};
  keys.forEach((k) => { saved[k] = state[k]; });
  // Plan de toiture : la toiture seule (ni photo aérienne, ni carte d'orientation, ni structure).
  Object.assign(state, {
    showPanels: withPanels, showBackgroundImage: avecFond, showOrientationCard: false, showStructure: false, showCotations: true,
  });
  try {
    // 1600 x 1000 : les étiquettes du canevas (11 px) restent lisibles (~2 mm) une fois en A4.
    const canvas = await CM.captureRoofDiagramImage(sourceId, 1600, 1000, { margeMetres: TOITURE_MARGE_M, pointsLocaux });
    if (!canvas) return null;
    const largeurPx = canvas.width;
    const hauteurPx = canvas.height;
    const versPx = versLocal && typeof canvas.localVersPixels === 'function'
      ? (ll) => canvas.localVersPixels(versLocal(ll)) : null;
    return { image: canvasToJpeg(canvas, { maxSide: 1600 }), versPx, largeurPx, hauteurPx };
  } finally {
    Object.assign(state, saved);
  }
}

/**
 * Plan de coupe du calepinage, rendu hors écran en haute définition : renderCoupe() dessine pour
 * un canvas de 560 x 330 px (tailles de police et de trait en px) ; on lui présente un canvas de
 * ces dimensions « logiques » dont le contexte est agrandi 3 fois.
 */
async function captureCoupe(sourceId) {
  const CM = window.CalepinageMaisonIndiv;
  if (!CM || typeof CM.renderCoupe !== 'function') return null;
  const state = CM.getHouseStateById(sourceId);
  if (!state || !state.pans || !state.pans.length) return null;
  const S = 3;
  const real = document.createElement('canvas');
  real.width = 560 * S;
  real.height = 330 * S;
  const ctx2d = real.getContext('2d');
  const logique = { width: 560, height: 330, getContext: () => { ctx2d.setTransform(S, 0, 0, S, 0, 0); return ctx2d; } };

  const prev = { canvas: CM.coupeCanvas, state: CM.state };
  const saved = { coupePanIndex: state.coupePanIndex, showStructure: state.showStructure, showCotations: state.showCotations };
  CM.state = state;
  try {
    const idx = state.pans.findIndex((p) => CM.packPanelsForPan(p).length > 0);
    Object.assign(state, { coupePanIndex: Math.max(0, idx), showStructure: true, showCotations: true });
    CM.coupeCanvas = logique;
    CM.renderCoupe();
  } finally {
    CM.coupeCanvas = prev.canvas;
    CM.state = prev.state;
    Object.assign(state, saved);
  }
  return canvasToJpeg(real, { maxSide: 1680 });
}

async function capture3D(sourceId, mode) {
  const CM = window.CalepinageMaisonIndiv;
  if (!CM || typeof CM.captureVue3DImage !== 'function') return null;
  const url = await CM.captureVue3DImage(sourceId, { mode, width: 1600, height: 1100 });
  return url ? dataUrlToJpeg(url, { maxSide: 1600 }) : null;
}

/**
 * @param {Object} ctx      contexte (buildContext)
 * @param {DpState} dpState réglages + images importées
 * @param {string[]} pieceIds pièces à produire
 * @param {Object} opts {onProgress(msg, ratio), isCancelled(), viewpoints}
 */
/**
 * @param {number} [opts.echelleSituationProche=500] échelle de la vue rapprochée Géoportail du plan de
 *   situation (DP : 1/500 ; dossier de plans du petit champ solaire : 1/1000). Capture rangée sous
 *   `situation<échelle>`.
 */
/**
 * @param {Object[]} [vuesSupplementaires] vues carte en plus des pièces DP (dossier des ombrières :
 *   page APER), chacune {key, label, pointLists: [[{lat,lng}]], layer}, cadrée comme le plan de
 *   masse (plus grande échelle où l'emprise tient) ; résultat dans captures[key].
 */
export async function captureAll(ctx, dpState, pieceIds, { onProgress, isCancelled, viewpoints, echelleSituationProche = 500, vuesSupplementaires = [] } = {}) {
  const d = dpState.data;
  const imgs = dpState.images;
  const want = new Set(pieceIds);
  const champ = champDuDossier(ctx, d.champId);
  const champsToiture = ctx.champs.filter((c) => c.panneaux.length);

  const parcelleRing = ctx.parcelle ? ctx.parcelle.ring : null;
  const implantationPts = [
    ...ctx.champs.map((c) => c.contour), ...ctx.panneaux, ...ctx.cotations.map((c) => [c.a, c.b]),
  ].filter((l) => l && l.length);
  const masse = cadrageMasse(ctx.implantation, [parcelleRing, ...implantationPts].filter((l) => l && l.length),
    d.echelleMasse, implantationPts.length ? implantationPts : null);
  // Situation rapprochée : centrée sur la parcelle si elle tient dans la page, sinon sur l'implantation.
  const b500 = parcelleRing ? boundsMeters(ctx.implantation, [parcelleRing]) : null;
  const centreParcelle = b500 && echelleNecessaire(b500) <= echelleSituationProche
    ? metersToLatLng(ctx.implantation, (b500.minX + b500.maxX) / 2, (b500.minY + b500.maxY) / 2)
    : (implantationPts.length ? cadrageMasse(ctx.implantation, implantationPts, 'auto').center : ctx.implantation);

  // Liste des étapes (pour une progression honnête)
  const mapJobs = [];
  if (want.has('dp1')) {
    mapJobs.push({ key: 'situation10000', label: 'Plan de situation 1/10000 (OSM)', center: centreParcelle, scale: 10000, layer: 'osm' });
    mapJobs.push({
      key: `situation${echelleSituationProche}`, label: `Plan de situation 1/${echelleSituationProche} (Géoportail)`,
      center: centreParcelle, scale: echelleSituationProche, layer: 'geoportail',
    });
  }
  if (want.has('dp2')) {
    mapJobs.push({ key: 'masse', label: `Plan de masse 1/${masse.scale}`, center: masse.center, scale: masse.scale, layer: 'geoportail' });
  }
  vuesSupplementaires.forEach((v) => {
    const pts = (v.pointLists || []).filter((l) => l && l.length);
    if (!pts.length) return;
    const cadrage = cadrageMasse(ctx.implantation, pts, 'auto', pts);
    mapJobs.push({ key: v.key, label: v.label, center: cadrage.center, scale: cadrage.scale, layer: v.layer || 'geoportail' });
  });
  const otherJobs = [];
  if (want.has('dp4')) {
    // Cotations de la carte (distances aux limites de propriété...) : toujours gardées dans le
    // cadre ; leur affichage (cases avant / projet) se décide à l'assemblage, sans recapture.
    const parToiture = cotationsParToiture(ctx.cotations, champsToiture);
    champsToiture.forEach((c) => {
      const ids = parToiture[c.sourceId] || [];
      const cots = ctx.cotations.filter((x) => ids.includes(x.id));
      const plan = (cap) => { cap.toiture[c.sourceId] ||= { cotationIds: ids }; return cap.toiture[c.sourceId]; };
      otherJobs.push({ label: `Plan de toiture ${c.sourceId} (avant travaux)`, run: async (cap) => { plan(cap).avant = await captureRoof(c.sourceId, false, cots); } });
      otherJobs.push({ label: `Plan de toiture ${c.sourceId} (après travaux)`, run: async (cap) => { plan(cap).apres = await captureRoof(c.sourceId, true, cots); } });
    });
  }
  if (want.has('dp3') && champ) {
    if (!imgs.coupe) otherJobs.push({ label: 'Plan de coupe', run: async (cap) => { cap.coupe = await captureCoupe(champ.sourceId); } });
    if (!imgs.vueX) otherJobs.push({ label: 'Vue 3D de la maison', run: async (cap) => { cap.vueX = await capture3D(champ.sourceId, 'x'); } });
  }
  if (want.has('dp6') && champ && !imgs.insertion) {
    otherJobs.push({ label: 'Vue 3D isométrique (insertion)', run: async (cap) => { cap.iso = await capture3D(champ.sourceId, 'iso'); } });
  }

  const total = mapJobs.length + otherJobs.length || 1;
  let done = 0;
  const progress = (label) => {
    CaptureVeil.setMessage(label);
    if (onProgress) onProgress(label, done / total);
  };
  const checkCancel = () => { if (isCancelled && isCancelled()) throw new Error('Génération annulée.'); };

  const captures = { masseCadrage: masse, champId: champ ? champ.sourceId : null, toiture: {}, warnings: [] };
  if (want.has('dp2') && !ctx.panneaux.length) captures.warnings.push('Plan de masse : aucun panneau trouvé dans le calepinage.');
  // Information seulement : la génération continue dans tous les cas.
  if (want.has('dp2') && parcelleRing && !masse.parcelleEntiere && (!d.echelleMasse || d.echelleMasse === 'auto')) {
    captures.warnings.push(`Plan de masse : parcelle trop grande même au 1/${MASSE_SCALE_MAX}, cadrage sur l'implantation au 1/${masse.scale}.`);
  }
  (ctx.entreprise && ctx.entreprise.alertes || []).forEach((a) => captures.warnings.push(`Établi par : ${a}.`));

  if (mapJobs.length) {
    const map = window.map;
    if (!map || !window.mapViewsControl) throw new Error('Carte non initialisée : ouvrez la page Calepinage.');
    const snapshot = MapLayerSwitcher.snapshot();
    await CaptureVeil.show('Préparation des captures…');
    const restaurerDessins = masquerDessinsCarte(viewpoints);
    try {
      for (const job of mapJobs) {
        checkCancel();
        progress(`Capture : ${job.label}`);
        // Même vue déjà capturée (ex. masse à 1/500 centrée comme la situation 1/500) : réutilisée.
        const same = mapJobs.find((j) => j !== job && captures[j.key] && j.scale === job.scale && j.layer === job.layer
          && Math.abs(j.center.lat - job.center.lat) < 1e-7 && Math.abs(j.center.lng - job.center.lng) < 1e-7);
        captures[job.key] = same ? captures[same.key] : await captureMap(map, job);
        done += 1;
      }
    } finally {
      restaurerDessins();
      CaptureVeil.setMessage('Restauration de la carte…');
      try { await MapLayerSwitcher.restore(snapshot); } catch (e) { console.warn('[DP] Restauration des fonds :', e); }
      try { await ScaleAlignedCapture.waitUntilSettled(map); } catch (e) { /* noop */ }
      CaptureVeil.hide();
    }
  }

  for (const job of otherJobs) {
    checkCancel();
    progress(job.label);
    try {
      await job.run(captures);
    } catch (e) {
      console.warn(`[DP] ${job.label} indisponible :`, e);
      captures.warnings.push(`${job.label} : capture impossible.`);
    }
    done += 1;
  }
  if (onProgress) onProgress('Captures terminées', 1);
  return captures;
}
