import GeoMeters from '../export_plans_pdf_dxf/utils/GeoMeters.js';

/**
 * Mise en page A4 des pièces du dossier DP (jsPDF, unités mm).
 *
 * Gabarit commun à toutes les pages :
 *   ┌───────────────────────────────────────────────┐
 *   │ DPx  Titre de la pièce        Échelle · Indice │  bandeau titre (HEADER_H)
 *   ├───────────────────────────────────────────────┤
 *   │                                               │
 *   │               zone de contenu                 │  contentZone()
 *   │                                               │
 *   ├──────────────┬──────────┬──────────────────┬──────┤
 *   │ projet/adr.  │ demandeur│ établi par (logo │ date │  cartouche (FOOTER_H)
 *   │              │          │ + nom, tél, mail)│ page │
 *   └──────────────┴──────────┴──────────────────┴──────┘
 * Le cartouche est une bande sous le contenu (et non un bloc posé dans un angle, comme sur les
 * plans A3) : sur un A4, un bloc de 90 x 45 mm masquerait un cinquième de la carte.
 */
export const FORMATS = {
  landscape: { w: 297, h: 210 },
  portrait: { w: 210, h: 297 },
  // A3 paysage : plans techniques du dossier « Petit champ solaire » (dossier_plans/).
  a3: { w: 420, h: 297 },
};
// format -> [papier jsPDF, orientation]
const PAPIERS = { landscape: ['a4', 'landscape'], portrait: ['a4', 'portrait'], a3: ['a3', 'landscape'] };
const MARGIN = 8;
const HEADER_H = 12;
const FOOTER_H = 18;
const GAP = 2;

const INK = [17, 24, 39];
const MUTED = [100, 116, 139];
const ACCENT = [220, 38, 38];

export function contentZone(format) {
  const { w, h } = FORMATS[format];
  const y = MARGIN + HEADER_H + GAP;
  return { x: MARGIN, y, w: w - 2 * MARGIN, h: h - 2 * MARGIN - HEADER_H - FOOTER_H - 2 * GAP };
}

/** Ajoute une page (ou réutilise la première page vierge du document). */
export function addPage(builder, format) {
  const [papier, orientation] = PAPIERS[format];
  if (!builder.pdf) {
    const { jsPDF } = window.jspdf;
    builder.pdf = new jsPDF({ orientation, unit: 'mm', format: papier, compress: true });
  } else {
    builder.pdf.addPage(papier, orientation);
  }
  return builder.pdf;
}

/**
 * Texte compatible avec les polices standard de jsPDF (encodage WinAnsi). toLocaleString('fr-FR')
 * sépare les milliers par une espace fine insécable (U+202F), absente de cet encodage : jsPDF
 * bascule alors TOUTE la chaîne en codage 16 bits, ce qui imprimait « 1/611,16 » et étirait
 * chaque lettre de la ligne. Ces espaces deviennent des espaces simples.
 */
export function texteImprimable(value) {
  return String(value == null ? '' : value).replace(/[     ]/g, ' ');
}

function text(pdf, value, x, y, { size = 8, bold = false, color = INK, align = 'left', maxWidth } = {}) {
  pdf.setFont('helvetica', bold ? 'bold' : 'normal');
  pdf.setFontSize(size);
  pdf.setTextColor(...color);
  pdf.text(texteImprimable(value), x, y, { align, maxWidth });
}

/**
 * Cadre + bandeau titre + cartouche.
 * @param {Object} page {code, titre, sousTitre, echelle, puissanceKwc} — puissanceKwc : case
 *   « Puissance » ajoutée au cartouche (plans de calepinage des dossiers de plans)
 * @param {Object} ctx  contexte d'export (cartouche, demandeur, indice)
 */
export function drawFrame(pdf, format, page, ctx) {
  const { w, h } = FORMATS[format];
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.35);
  pdf.rect(MARGIN, MARGIN, w - 2 * MARGIN, h - 2 * MARGIN);

  // Bandeau titre
  const yHeader = MARGIN + HEADER_H;
  pdf.line(MARGIN, yHeader, w - MARGIN, yHeader);
  let xTitre = MARGIN + 3;
  if (page.code) {
    const codeW = Math.max(16, page.code.length * 2.6 + 6);
    pdf.setFillColor(...ACCENT); // rouge, assorti au logo (demande du 21/09/2026)
    pdf.rect(MARGIN, MARGIN, codeW, HEADER_H, 'F');
    text(pdf, page.code, MARGIN + codeW / 2, MARGIN + 7.8, { size: 11, bold: true, color: [255, 255, 255], align: 'center' });
    xTitre = MARGIN + codeW + 4;
  }
  text(pdf, page.titre, xTitre, MARGIN + 5.6, { size: 11, bold: true });
  if (page.sousTitre) text(pdf, page.sousTitre, xTitre, MARGIN + 9.8, { size: 7.5, color: MUTED });
  const droite = [page.echelle ? `Échelle : ${page.echelle}` : null, `Indice : ${ctx.indice || 'A'}`].filter(Boolean);
  text(pdf, droite.join('   ·   '), w - MARGIN - 3, MARGIN + 7.6, { size: 8, align: 'right' });

  drawCartouche(pdf, format, ctx, page);
}

function drawCartouche(pdf, format, ctx, page) {
  const { w, h } = FORMATS[format];
  const y0 = h - MARGIN - FOOTER_H;
  const x0 = MARGIN;
  const totalW = w - 2 * MARGIN;
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.35);
  pdf.line(x0, y0, x0 + totalW, y0);

  const c = ctx.cartouche || {};
  const ent = ctx.entreprise || { nom: c.company_name, telephone: c.company_phone, email: '', logo: c.company_logo };
  const dateW = 30;
  const etabliW = format === 'portrait' ? 66 : 92;
  const demandeurW = format === 'portrait' ? 40 : 58;
  const puissance = page && page.puissanceKwc > 0
    ? `${page.puissanceKwc.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWc`
    : null;
  const puissanceW = puissance ? 28 : 0;
  const projetW = totalW - dateW - etabliW - demandeurW - puissanceW;
  const cols = [];
  let x = x0;
  cols.push({ x, w: projetW, titre: 'Projet', lignes: [c.nom_projet, ctx.adresse || c.adresse] }); x += projetW;
  if (puissance) { cols.push({ x, w: puissanceW, titre: 'Puissance', lignes: [puissance] }); x += puissanceW; }
  cols.push({ x, w: demandeurW, titre: ctx.titreDemandeur || 'Demandeur', lignes: [ctx.demandeurLibelle] }); x += demandeurW;
  cols.push({ x, w: etabliW, titre: 'Établi par', lignes: [ent.nom, ent.telephone, ent.email], logo: ent.logo }); x += etabliW;
  cols.push({ x, w: dateW, titre: 'Date', lignes: [c.date, '{PAGE}'] });

  cols.forEach((col, i) => {
    if (i > 0) pdf.line(col.x, y0, col.x, y0 + FOOTER_H);
    text(pdf, col.titre.toUpperCase(), col.x + 2, y0 + 4, { size: 5.5, bold: true, color: MUTED });
    let xt = col.x + 2;
    let wt = col.w - 4;
    if (col.logo) {
      // Logo à gauche de la case, dans un cadre de 24 x 12 mm, proportions conservées.
      try {
        const props = pdf.getImageProperties(col.logo);
        const fmt = /image\/jpe?g/i.test(col.logo) ? 'JPEG' : 'PNG';
        const boxW = 24, boxH = FOOTER_H - 6;
        const ratio = props.width / props.height;
        let lw = boxW, lh = boxW / ratio;
        if (lh > boxH) { lh = boxH; lw = boxH * ratio; }
        pdf.addImage(col.logo, fmt, col.x + 2 + (boxW - lw) / 2, y0 + 5 + (boxH - lh) / 2, lw, lh, 'logo_entreprise');
        xt = col.x + boxW + 5;
        wt = col.x + col.w - xt - 2;
      } catch (e) {
        console.warn('[DP] Logo entreprise illisible :', e);
      }
    }
    let yl = y0 + 8.2;
    col.lignes.filter(Boolean).forEach((ligne, k) => {
      if (ligne === '{PAGE}') {
        // Numéro de page posé après coup (numeroterPages), quand le total est connu.
        pdf.__dpPageSlots = pdf.__dpPageSlots || {};
        pdf.__dpPageSlots[pdf.getCurrentPageInfo().pageNumber] = { x: xt, y: yl };
        return;
      }
      const lignes = pdf.setFont('helvetica', k === 0 ? 'bold' : 'normal').setFontSize(7.5)
        .splitTextToSize(String(ligne), wt).slice(0, k === 0 && !col.logo ? 1 : 2);
      lignes.forEach((l) => {
        if (yl > y0 + FOOTER_H - 1) return;
        text(pdf, l, xt, yl, { size: 7.5, bold: k === 0 });
        yl += 3.4;
      });
    });
  });
}

/** Écrit « Page n / N » dans chaque cartouche, une fois toutes les pages créées. */
export function numeroterPages(pdf) {
  const slots = pdf.__dpPageSlots || {};
  const total = pdf.getNumberOfPages();
  Object.entries(slots).forEach(([page, pos]) => {
    pdf.setPage(Number(page));
    text(pdf, `Page ${page} / ${total}`, pos.x, pos.y, { size: 7.5 });
  });
  pdf.setPage(total);
}

/** Place une image en « contain » centrée dans une zone ; renvoie le rectangle occupé. */
export function fitImage(pdf, image, zone, { alias, padding = 0 } = {}) {
  const zw = zone.w - 2 * padding;
  const zh = zone.h - 2 * padding;
  const ratio = image.width / image.height;
  let w = zw, h = zw / ratio;
  if (h > zh) { h = zh; w = zh * ratio; }
  const x = zone.x + padding + (zw - w) / 2;
  const y = zone.y + padding + (zh - h) / 2;
  pdf.addImage(image.dataUrl, 'JPEG', x, y, w, h, alias, 'NONE');
  return { x, y, w, h };
}

export function placeholder(pdf, zone, message) {
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineDashPattern([1.5, 1.5], 0);
  pdf.rect(zone.x + 4, zone.y + 4, zone.w - 8, zone.h - 8, 'FD');
  pdf.setLineDashPattern([], 0);
  text(pdf, message, zone.x + zone.w / 2, zone.y + zone.h / 2, { size: 9, color: MUTED, align: 'center', maxWidth: zone.w - 20 });
}

// ---------------------------------------------------------------------------------------------
// Géoréférencement : une capture de carte à l'échelle 1/scale, centrée sur `center`, remplit
// exactement `zone` (cf. ScaleAlignedCapture). Un point lat/lng se place donc par simple
// conversion mètres -> mm papier.
// ---------------------------------------------------------------------------------------------
const EARTH_CIRCUMFERENCE_M = 40075017;

/** Coordonnées « monde » Web Mercator (pixels CSS au zoom donné), celles de Google Maps. */
function worldPx(latLng, zoom) {
  const size = 256 * Math.pow(2, zoom);
  const siny = Math.min(Math.max(Math.sin((latLng.lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: size * (0.5 + latLng.lng / 360),
    y: size * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
  };
}

/**
 * Échelle réelle d'une capture géoréférencée (le zoom demandé a pu être arrondi par l'API).
 * @returns {number|null} dénominateur d'échelle
 */
export function echelleReelle(zone, georef) {
  if (!georef || !georef.widthPx) return null;
  const metresParPx = (EARTH_CIRCUMFERENCE_M * Math.cos((georef.center.lat * Math.PI) / 180)) / Math.pow(2, georef.zoom + 8);
  return metresParPx / (zone.w / georef.widthPx / 1000);
}

/**
 * Projection lat/lng -> mm papier. Avec `georef` (état réel de la carte lu au moment de la
 * capture) : projection Web Mercator exacte, identique à celle du fond de carte — le tracé tombe
 * sur les limites cadastrales affichées. Sans : approximation plan tangent à l'échelle demandée.
 */
export function projector(zone, center, scale, georef = null) {
  const cx = zone.x + zone.w / 2;
  const cy = zone.y + zone.h / 2;
  if (georef && georef.widthPx && Number.isFinite(georef.zoom)) {
    const c = worldPx(georef.center, georef.zoom);
    const k = zone.w / georef.widthPx; // mm par pixel CSS de la carte capturée
    return (latLng) => {
      const p = worldPx(latLng, georef.zoom);
      return { x: cx + (p.x - c.x) * k, y: cy + (p.y - c.y) * k };
    };
  }
  return (latLng) => {
    const m = GeoMeters.offsetMeters(center, latLng);
    return { x: cx + (m.x * 1000) / scale, y: cy - (m.y * 1000) / scale };
  };
}

export function withClip(pdf, zone, draw) {
  pdf.saveGraphicsState();
  // Style `null` OBLIGATOIRE : sans lui, jsPDF trace le rectangle (opérateur S) avant `W n`, et le
  // découpage ne s'applique à rien -> tout ce qui dépasse de la carte s'imprimait sur la page.
  pdf.rect(zone.x, zone.y, zone.w, zone.h, null);
  pdf.clip();
  pdf.discardPath();
  try { draw(); } finally { pdf.restoreGraphicsState(); }
}

function polygonPath(pdf, points, style) {
  if (points.length < 3) return;
  const deltas = [];
  for (let i = 1; i < points.length; i++) {
    deltas.push([points[i].x - points[i - 1].x, points[i].y - points[i - 1].y]);
  }
  pdf.lines(deltas, points[0].x, points[0].y, [1, 1], style, true);
}

/** Panneaux PV en vectoriel (net à toutes les échelles, indépendant du rendu WebGL de la carte). */
export function drawPanels(pdf, panelsMm) {
  pdf.setFillColor(30, 41, 82);
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.08);
  panelsMm.forEach((pts) => polygonPath(pdf, pts, 'FD'));
}

export function drawOutline(pdf, pointsMm, { color = ACCENT, width = 0.35, dash = null } = {}) {
  pdf.setDrawColor(...color);
  pdf.setLineWidth(width);
  if (dash) pdf.setLineDashPattern(dash, 0);
  polygonPath(pdf, pointsMm, 'S');
  if (dash) pdf.setLineDashPattern([], 0);
}

function arrowHead(pdf, tip, from, size) {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  const a1 = ang + Math.PI - 0.38;
  const a2 = ang + Math.PI + 0.38;
  pdf.triangle(
    tip.x, tip.y,
    tip.x + size * Math.cos(a1), tip.y + size * Math.sin(a1),
    tip.x + size * Math.cos(a2), tip.y + size * Math.sin(a2),
    'F',
  );
}

/** Ligne de cotation : trait, flèche à chaque extrémité, valeur au milieu (parallèle au trait). */
export function drawCotation(pdf, a, b, label) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 0.5) return;
  const head = Math.min(2, len / 4);
  pdf.setDrawColor(...INK);
  pdf.setFillColor(...INK);
  pdf.setLineWidth(0.25);
  pdf.line(a.x, a.y, b.x, b.y);
  arrowHead(pdf, a, b, head);
  arrowHead(pdf, b, a, head);

  let ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI; // texte jamais à l'envers
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const off = 1.2; // décalé au-dessus du trait
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(...INK);
  // Centrage à la main : jsPDF 2.5 applique `align:'center'` horizontalement, sans tenir
  // compte de la rotation.
  const tw = pdf.getTextWidth(label);
  const tx = mid.x + off * Math.sin(ang) - (Math.cos(ang) * tw) / 2;
  const ty = mid.y - off * Math.cos(ang) - (Math.sin(ang) * tw) / 2;
  pdf.text(label, tx, ty, { angle: (-ang * 180) / Math.PI });
}

/** Cercle « Localisation projet » + étiquette. */
export function drawLocalisation(pdf, center, radiusMm, zone) {
  pdf.setDrawColor(...ACCENT);
  pdf.setLineWidth(0.6);
  pdf.circle(center.x, center.y, radiusMm, 'S');
  const lx = Math.min(center.x + radiusMm + 3, zone.x + zone.w - 34);
  const ly = Math.max(center.y - radiusMm - 2, zone.y + 6);
  const ax = center.x + radiusMm * Math.cos(-Math.PI / 4);
  const ay = center.y + radiusMm * Math.sin(-Math.PI / 4);
  pdf.setLineWidth(0.3);
  pdf.line(ax, ay, lx, ly + 1);
  pdf.setFillColor(255, 255, 255);
  pdf.rect(lx - 0.8, ly - 3.4, 31, 5, 'F');
  text(pdf, 'Localisation projet', lx, ly, { size: 8, bold: true, color: ACCENT });
}

/**
 * Symbole de prise de vue (point + faisceau de 5 traits orientés), comme sur le modèle DP7/DP8.
 * @param {number} bearingDeg direction visée (0 = nord, sens horaire)
 */
export function drawViewpoint(pdf, x, y, bearingDeg, label, { size = 7 } = {}) {
  const b = ((bearingDeg || 0) * Math.PI) / 180;
  pdf.setFillColor(...INK);
  pdf.setDrawColor(...INK);
  pdf.circle(x, y, size * 0.16, 'F');
  pdf.setLineWidth(size * 0.11);
  [-0.7, -0.35, 0, 0.35, 0.7].forEach((d) => {
    const ang = b + d;
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    pdf.line(x + dx * size * 0.35, y + dy * size * 0.35, x + dx * size, y + dy * size);
  });
  if (label) {
    const lx = x - Math.sin(b) * size * 0.9;
    const ly = y + Math.cos(b) * size * 0.9 + 1.2;
    pdf.setFillColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    const tw = pdf.getTextWidth(label);
    pdf.rect(lx - tw / 2 - 1, ly - 3, tw + 2, 4, 'F');
    text(pdf, label, lx, ly, { size: 7.5, bold: true, align: 'center' });
  }
}

const KNOWN_BARS = { 10000: 200, 1000: 20, 750: 10, 500: 10, 250: 5 };

/** Barre d'échelle + flèche nord, sur fond blanc, en bas à gauche de la zone carte. */
export function drawScaleBar(pdf, zone, scale) {
  let barM = KNOWN_BARS[scale];
  if (!barM) {
    const target = scale * 0.03;
    const mag = Math.pow(10, Math.floor(Math.log10(target)));
    barM = [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= target * 0.7) || mag * 10;
  }
  const barMm = (barM * 1000) / scale;
  const x = zone.x + 5;
  const y = zone.y + zone.h - 6;
  pdf.setFillColor(255, 255, 255);
  pdf.rect(x - 2.5, y - 17, Math.max(barMm, 12) + 11, 22, 'F'); // + place pour l'étiquette « 200 m » centrée sur l'extrémité

  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.2);
  const half = barMm / 2;
  pdf.setFillColor(...INK);
  pdf.rect(x, y - 1, half, 1.2, 'FD');
  pdf.setFillColor(255, 255, 255);
  pdf.rect(x + half, y - 1, half, 1.2, 'FD');
  text(pdf, '0', x, y + 3, { size: 6, align: 'center' });
  text(pdf, `${barM} m`, x + barMm, y + 3, { size: 6, align: 'center' });

  // Flèche nord
  const nx = x + Math.max(barMm, 12) / 2;
  const ny = y - 9;
  pdf.setFillColor(...INK);
  pdf.triangle(nx, ny - 5, nx - 2, ny + 1.5, nx, ny, 'F');
  pdf.setFillColor(255, 255, 255);
  pdf.triangle(nx, ny - 5, nx + 2, ny + 1.5, nx, ny, 'FD');
  text(pdf, 'N', nx, ny - 6, { size: 7, bold: true, align: 'center' });
}

/** Tableau à 2 colonnes (modèles DP3 et DP7/DP8) ; renvoie les zones de contenu des cellules. */
export function twoColumnTable(pdf, zone, titres, ratio = 0.5) {
  const headerH = 7;
  const wLeft = zone.w * ratio;
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.3);
  pdf.rect(zone.x, zone.y, zone.w, zone.h);
  pdf.line(zone.x, zone.y + headerH, zone.x + zone.w, zone.y + headerH);
  pdf.line(zone.x + wLeft, zone.y, zone.x + wLeft, zone.y + zone.h);
  pdf.setFillColor(241, 245, 249);
  pdf.rect(zone.x + 0.15, zone.y + 0.15, zone.w - 0.3, headerH - 0.3, 'F');
  text(pdf, titres[0], zone.x + 2.5, zone.y + 4.8, { size: 8.5, bold: true });
  text(pdf, titres[1], zone.x + wLeft + 2.5, zone.y + 4.8, { size: 8.5, bold: true });
  const y = zone.y + headerH;
  const h = zone.h - headerH;
  return [
    { x: zone.x, y, w: wLeft, h },
    { x: zone.x + wLeft, y, w: zone.w - wLeft, h },
  ];
}

export { text, INK, MUTED, ACCENT, MARGIN };
