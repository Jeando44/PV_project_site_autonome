import { texteImprimable } from '../../../declaration_prealable/DpLayout.js?v=2';

/**
 * Tracé VECTORIEL (jsPDF) des entités de coupe / façade du petit champ solaire : les mêmes entités
 * que les exports PDF A3 et DXF existants (plan_coupe_petit_champ_solaire.js, en mètres, Y vers le
 * haut), mises à l'échelle dans une zone de page. Même règle d'échelle que le générateur ReportLab
 * (pdf_generators/petit_champ_solaire_pdf.py::_echelle_ajustee), pour des plans identiques.
 *
 * Le dessin reste vectoriel : netteté à toute échelle d'impression, texte sélectionnable.
 */

const PADDING_MM = 3;
const MIN_FONT_PT = 4;
const PT_PAR_MM = 2.83464566;

/** Plus petite échelle 1/N >= besoin, par pas fins (copie de _echelle_ajustee). */
export function echelleAjustee(besoin) {
  const n = Math.max(Number(besoin) || 1, 1);
  const pas = n <= 20 ? 1 : n <= 100 ? 5 : n <= 200 ? 10 : n <= 500 ? 25 : n <= 1000 ? 50 : 100;
  return Math.ceil(n / pas) * pas;
}

export function emprise(entites) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  entites.forEach((e) => {
    const pts = e.type === 'LWPOLYLINE' ? e.points : [{ x: e.x, y: e.y }];
    pts.forEach((p) => {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
  });
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
}

// ---- Découpe d'un segment par un rectangle (Liang-Barsky) ----
function decouperSegment(a, b, r) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const tests = [[-dx, a.x - r.minX], [dx, r.maxX - a.x], [-dy, a.y - r.minY], [dy, r.maxY - a.y]];
  for (const [p, q] of tests) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [{ x: a.x + t0 * dx, y: a.y + t0 * dy }, { x: a.x + t1 * dx, y: a.y + t1 * dy }];
}

function interieur(p, r) {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

/**
 * Entités restreintes à une fenêtre (mètres) : une polyligne entièrement dedans est gardée telle
 * quelle (remplissage compris), sinon ses segments visibles deviennent des traits ouverts ; un texte
 * n'est gardé que si son point d'ancrage est dans la fenêtre.
 */
export function decouperEntites(entites, fenetre) {
  const out = [];
  entites.forEach((e) => {
    if (e.type !== 'LWPOLYLINE') {
      if (interieur(e, fenetre)) out.push(e);
      return;
    }
    const pts = e.points;
    if (pts.every((p) => interieur(p, fenetre))) { out.push(e); return; }
    const n = e.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const seg = decouperSegment(pts[i], pts[(i + 1) % pts.length], fenetre);
      if (seg) out.push({ type: 'LWPOLYLINE', closed: false, layer: e.layer, color: e.color, fill: null, points: seg });
    }
  });
  return out;
}

/**
 * Choisit l'échelle et renvoie la projection mètres -> mm papier, contenu centré dans `zone`.
 * @param {number[]} [echellesPreferees] échelles « propres » essayées d'abord (ex. [10, 20]).
 */
export function placement(boite, zone, echellesPreferees = null) {
  const w = Math.max(boite.maxX - boite.minX, 0.01);
  const h = Math.max(boite.maxY - boite.minY, 0.01);
  const zw = zone.w - 2 * PADDING_MM;
  const zh = zone.h - 2 * PADDING_MM;
  const besoin = Math.max((w * 1000) / zw, (h * 1000) / zh);
  const n = (echellesPreferees || []).find((s) => s >= besoin) || echelleAjustee(besoin);
  const k = 1000 / n; // mm papier par mètre
  const gauche = zone.x + (zone.w - w * k) / 2;
  const haut = zone.y + (zone.h - h * k) / 2;
  return {
    echelle: n,
    k,
    versMm: (x, y) => ({ x: gauche + (x - boite.minX) * k, y: haut + (boite.maxY - y) * k }),
  };
}

/**
 * Dessine les entités ; renvoie rien (l'échelle est connue par `placement`).
 * @param {number} [maxFontPt] plafond de taille des textes : à grande échelle (détail au 1/20), la
 *   hauteur réelle des textes du canevas donnerait des cotes de 15 pt et plus.
 */
export function dessinerEntites(pdf, entites, { versMm, k }, { maxFontPt = Infinity } = {}) {
  pdf.setLineDashPattern([], 0);
  entites.forEach((e) => {
    const [r, g, b] = e.color || [0, 0, 0];
    if (e.type === 'LWPOLYLINE') {
      const pts = e.points.map((p) => versMm(p.x, p.y));
      if (pts.length < 2) return;
      pdf.setDrawColor(r, g, b);
      // Trait fin (même valeur que le générateur ReportLab) : à petite échelle, un trait plus épais
      // noircit les panneaux et hachures serrés.
      pdf.setLineWidth(0.12);
      const deltas = [];
      for (let i = 1; i < pts.length; i++) deltas.push([pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y]);
      let style = 'S';
      if (e.fill && e.closed) {
        pdf.setFillColor(...e.fill);
        style = 'FD';
      }
      pdf.lines(deltas, pts[0].x, pts[0].y, [1, 1], style, !!e.closed);
      return;
    }
    // TEXT : taille réelle (m) -> mm papier -> points, avec un plancher de lisibilité.
    const p = versMm(e.x, e.y);
    const taillePt = Math.min(Math.max((Number(e.height) || 0.15) * k * PT_PAR_MM, MIN_FONT_PT), maxFontPt);
    const texte = texteImprimable(e.text);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(taillePt);
    pdf.setTextColor(r, g, b);
    const angle = Number(e.rotationDeg) || 0;
    // Alignement fait à la main : jsPDF 2.5 ignore la rotation pour align:'center'/'right'.
    const decalage = e.align === 'center' ? 0.5 : (e.align === 'right' || e.align === 'end') ? 1 : 0;
    const tw = pdf.getTextWidth(texte) * decalage;
    const rad = (angle * Math.PI) / 180;
    pdf.text(texte, p.x - tw * Math.cos(rad), p.y + tw * Math.sin(rad), { angle });
  });
}
