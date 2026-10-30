import {
  FORMATS, contentZone, addPage, drawFrame, numeroterPages, fitImage, placeholder, projector, echelleReelle, withClip,
  drawPanels, drawOutline, drawCotation, drawLocalisation, drawViewpoint, drawScaleBar, twoColumnTable,
  text, MUTED, MARGIN,
} from './DpLayout.js?v=2';
import { PIECES } from './DpState.js';
import { formatCotation } from '../components/DrawingControl/shapes/CotationLine.js';

/**
 * Phase d'ASSEMBLAGE : transforme les captures (DpCaptures.js) et les réglages en pages jsPDF.
 * Rapide et sans effet de bord : rejouée pour le PDF complet, pour chaque PDF du ZIP ou pour une
 * pièce seule, sans recapturer la carte ni la 3D.
 *
 * Ordre du dossier : numérotation officielle des pièces jointes au Cerfa 13703 (DP1, DP2, DP3,
 * DP4, DP6, DP7-DP8, DP11) — l'ordre attendu par le service instructeur.
 */
const LOCALISATION_RADIUS_10000_MM = 7;

function mapPage(builder, page, ctx, cap, overlay) {
  const pdf = addPage(builder, 'landscape');
  const zone = contentZone('landscape');
  // Échelle affichée : celle demandée, sauf si l'API a dû arrondir le zoom (écart > 2 %).
  const reelle = cap ? echelleReelle(zone, cap.georef) : null;
  const echelle = cap ? (reelle && Math.abs(reelle / cap.scale - 1) > 0.02 ? Math.round(reelle) : cap.scale) : null;
  if (cap && cap.image) {
    pdf.addImage(cap.image.dataUrl, 'JPEG', zone.x, zone.y, zone.w, zone.h, `carte_${cap.scale}_${cap.center.lat.toFixed(6)}`, 'NONE');
    const project = projector(zone, cap.center, cap.scale, cap.georef);
    withClip(pdf, zone, () => overlay && overlay(pdf, project, zone, cap));
    drawScaleBar(pdf, zone, echelle);
  } else {
    placeholder(pdf, zone, 'Fond de carte indisponible.');
  }
  drawFrame(pdf, 'landscape', { ...page, echelle: cap ? `1/${echelle}` : null }, ctx);
}

function parcelleMm(ctx, project) {
  return ctx.parcelle ? ctx.parcelle.ring.map(project) : null;
}

function rayonParcelleMm(pts) {
  if (!pts || !pts.length) return null;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const r = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  return { c: { x: cx, y: cy }, r };
}

/**
 * Cercle « Localisation projet » autour de la parcelle ; si la parcelle ne tient pas dans la page
 * (grand terrain), autour de l'implantation (contours des champs PV) — sinon le cercle, plus grand
 * que la carte, était invisible et seul son trait de rappel traversait la page.
 */
function localisation(pdf, ctx, project, zone, cap, rayonMinMm) {
  const rayonMax = 0.42 * Math.min(zone.w, zone.h);
  const pts = parcelleMm(ctx, project);
  let cercle = rayonParcelleMm(pts);
  if (cercle) cercle = { c: cercle.c, r: cercle.r * 1.12 };
  if (!cercle || cercle.r > rayonMax) {
    const implantation = ctx.champs.flatMap((c) => c.contour).map(project);
    const autour = rayonParcelleMm(implantation);
    cercle = autour ? { c: autour.c, r: Math.min(rayonMax, autour.r * 1.3) } : { c: project(ctx.implantation), r: rayonMinMm };
  }
  if (pts && cap.scale <= 1000) drawOutline(pdf, pts, { width: 0.5, dash: [2, 1] });
  drawLocalisation(pdf, cercle.c, Math.max(rayonMinMm, cercle.r), zone);
}

function drawCotations(pdf, ctx, project) {
  ctx.cotations.forEach((c) => drawCotation(pdf, project(c.a), project(c.b), formatCotation(c.lengthM)));
}

/**
 * Plan de toiture : limite de parcelle (pointillé, comme sur le plan de masse) et cotations de la
 * carte rattachées à ce toit, placées dans le repère du plan capturé.
 */
function overlayToiture(pdf, ctx, plan, rect, cotationIds) {
  const kx = rect.w / plan.largeurPx;
  const ky = rect.h / plan.hauteurPx;
  const project = (ll) => {
    const p = plan.versPx(ll);
    return { x: rect.x + p.x * kx, y: rect.y + p.y * ky };
  };
  const pts = parcelleMm(ctx, project);
  if (pts) drawOutline(pdf, pts, { width: 0.5, dash: [2, 1] });
  const ids = new Set(cotationIds || []);
  ctx.cotations.filter((c) => ids.has(c.id))
    .forEach((c) => drawCotation(pdf, project(c.a), project(c.b), formatCotation(c.lengthM)));
}

/** Point de vue hors cadre : ramené sur le bord, avec la mention « hors plan ». */
function drawViewpoints(pdf, d, project, zone) {
  [['proche', 'DP7'], ['lointain', 'DP8']].forEach(([type, label]) => {
    const vp = d.pointsDeVue[type];
    if (!vp) return;
    let p = project(vp);
    const inside = p.x >= zone.x + 4 && p.x <= zone.x + zone.w - 4 && p.y >= zone.y + 4 && p.y <= zone.y + zone.h - 4;
    if (!inside) {
      // Marge suffisante pour que le symbole ET l'étiquette « DPx (hors plan) » restent dans le cadre.
      p = { x: Math.min(Math.max(p.x, zone.x + 20), zone.x + zone.w - 20), y: Math.min(Math.max(p.y, zone.y + 12), zone.y + zone.h - 14) };
    }
    drawViewpoint(pdf, p.x, p.y, vp.bearing, inside ? label : `${label} (hors plan)`);
  });
}

const RENDERERS = {
  garde(builder, ctx, cap, st, pieceIds) {
    const pdf = addPage(builder, 'portrait');
    const { w } = FORMATS.portrait;
    const zone = contentZone('portrait');
    let y = zone.y + 22;
    text(pdf, 'Déclaration préalable de travaux', w / 2, y, { size: 20, bold: true, align: 'center' }); y += 9;
    text(pdf, 'Installation de panneaux photovoltaïques en toiture', w / 2, y, { size: 12, align: 'center', color: MUTED }); y += 6;
    text(pdf, 'Pièces jointes au formulaire Cerfa n° 13703 (maison individuelle)', w / 2, y, { size: 9, align: 'center', color: MUTED }); y += 18;

    const d = st.data;
    const lignes = [
      ['Projet', ctx.cartouche.nom_projet],
      ['Adresse des travaux', ctx.adresse],
      ['Référence cadastrale', ctx.parcelle && ctx.parcelle.reference],
      ['Demandeur', ctx.demandeurLibelle],
      ['Nombre de panneaux', d.nbPanneaux ? String(d.nbPanneaux) : null],
      ['Dossier établi par', (ctx.entreprise && ctx.entreprise.nom) || ctx.cartouche.company_name],
      ['Date', ctx.cartouche.date],
    ].filter(([, v]) => v);
    lignes.forEach(([k, v]) => {
      text(pdf, k, MARGIN + 14, y, { size: 9, color: MUTED });
      text(pdf, v, MARGIN + 62, y, { size: 10, bold: true, maxWidth: w - 2 * MARGIN - 76 });
      y += 8;
    });

    y += 10;
    text(pdf, 'Bordereau des pièces', MARGIN + 14, y, { size: 12, bold: true }); y += 4;
    pdf.setDrawColor(17, 24, 39); pdf.setLineWidth(0.3);
    PIECES.filter((p) => p.id !== 'garde' && pieceIds.includes(p.id)).forEach((p) => {
      pdf.line(MARGIN + 14, y, w - MARGIN - 14, y);
      y += 6.5;
      text(pdf, p.code, MARGIN + 17, y, { size: 10, bold: true });
      text(pdf, p.titre, MARGIN + 50, y, { size: 10 });
      y += 2.5;
    });
    pdf.line(MARGIN + 14, y, w - MARGIN - 14, y);
    drawFrame(pdf, 'portrait', { code: 'DP', titre: 'Page de garde', sousTitre: 'Déclaration préalable - toiture photovoltaïque' }, ctx);
  },

  dp1(builder, ctx, cap) {
    mapPage(builder, { code: 'DP1', titre: 'Plan de situation', sousTitre: 'Vue d\'ensemble - fond OpenStreetMap' }, ctx, cap.situation10000,
      (pdf, project, zone, c) => localisation(pdf, ctx, project, zone, c, LOCALISATION_RADIUS_10000_MM));
    mapPage(builder, { code: 'DP1', titre: 'Plan de situation', sousTitre: 'Vue rapprochée - fond Géoportail et cadastre' }, ctx, cap.situation500,
      (pdf, project, zone, c) => localisation(pdf, ctx, project, zone, c, 8));
  },

  dp2(builder, ctx, cap, st) {
    const d = st.data;
    const masse = cap.masse;
    const pieceAvant = (pdf, project) => {
      const pts = parcelleMm(ctx, project);
      if (pts) drawOutline(pdf, pts, { width: 0.5, dash: [2, 1] });
      if (d.cotationsAvant) drawCotations(pdf, ctx, project);
    };
    mapPage(builder, { code: 'DP2', titre: 'Plan de masse - état actuel', sousTitre: 'Avant-projet, sans panneaux photovoltaïques' }, ctx, masse,
      (pdf, project) => pieceAvant(pdf, project));
    mapPage(builder, { code: 'DP2', titre: 'Plan de masse - projet', sousTitre: 'Implantation des panneaux photovoltaïques et points de vue des photographies' }, ctx, masse,
      (pdf, project, zone) => {
        const pts = parcelleMm(ctx, project);
        if (pts) drawOutline(pdf, pts, { width: 0.5, dash: [2, 1] });
        // Contour de chaque champ PV (implantation lisible même à petite échelle), puis panneaux.
        ctx.champs.forEach((c) => { if (c.contour.length >= 3) drawOutline(pdf, c.contour.map(project), { color: [37, 99, 235], width: 0.4 }); });
        const panneaux = ctx.panneaux.length ? ctx.panneaux : ctx.champs.flatMap((c) => c.panneaux);
        drawPanels(pdf, panneaux.map((panel) => panel.map(project)));
        if (d.cotationsProjet) drawCotations(pdf, ctx, project);
        drawViewpoints(pdf, d, project, zone);
      });
  },

  dp3(builder, ctx, cap, st) {
    const pdf = addPage(builder, 'landscape');
    const zone = contentZone('landscape');
    const [gauche, droite] = twoColumnTable(pdf, zone, ['Coupe de principe - pose des modules', 'Vue de la maison (3D)'], 0.55);
    const coupe = st.images.coupe || cap.coupe;
    const vue = st.images.vueX || cap.vueX;
    if (coupe) fitImage(pdf, coupe, gauche, { padding: 4, alias: 'dp3_coupe' }); else placeholder(pdf, gauche, 'Coupe indisponible : importez une image.');
    if (vue) fitImage(pdf, vue, droite, { padding: 4, alias: 'dp3_vue' }); else placeholder(pdf, droite, 'Vue 3D indisponible : importez une image.');
    drawFrame(pdf, 'landscape', { code: 'DP3', titre: 'Plan de coupe', sousTitre: 'Pose en surimposition - sans modification du volume bâti', echelle: 'sans échelle' }, ctx);
  },

  dp4(builder, ctx, cap, st) {
    const d = st.data;
    const ids = Object.keys(cap.toiture);
    if (!ids.length) {
      const pdf = addPage(builder, 'landscape');
      placeholder(pdf, contentZone('landscape'), 'Aucun champ PV avec panneaux dans le calepinage.');
      drawFrame(pdf, 'landscape', { code: 'DP4', titre: 'Plan de toiture' }, ctx);
      return;
    }
    ids.forEach((id) => {
      const plusieurs = ids.length > 1 ? ` - ${id}` : '';
      [['avant', 'avant travaux', 'Toiture existante'], ['apres', 'après travaux', 'Implantation des panneaux photovoltaïques']].forEach(([k, titre, sous]) => {
        const pdf = addPage(builder, 'landscape');
        const zone = contentZone('landscape');
        const plan = cap.toiture[id][k];
        if (plan && plan.image) {
          const rect = fitImage(pdf, plan.image, zone, { padding: 4, alias: `dp4_${id}_${k}` });
          const avecCotations = k === 'avant' ? d.cotationsAvant : d.cotationsProjet;
          if (plan.versPx) withClip(pdf, rect, () => overlayToiture(pdf, ctx, plan, rect, avecCotations ? cap.toiture[id].cotationIds : []));
        } else {
          placeholder(pdf, zone, 'Plan de toiture indisponible.');
        }
        drawFrame(pdf, 'landscape', { code: 'DP4', titre: `Plan de toiture ${titre}${plusieurs}`, sousTitre: `${sous} - cotes en mètres`, echelle: 'sans échelle' }, ctx);
      });
    });
  },

  dp6(builder, ctx, cap, st) {
    const pdf = addPage(builder, 'landscape');
    const zone = contentZone('landscape');
    const img = st.images.insertion || cap.iso;
    if (img) fitImage(pdf, img, zone, { padding: 2, alias: 'dp6' }); else placeholder(pdf, zone, 'Insertion indisponible : importez une image ou ouvrez la vue 3D.');
    drawFrame(pdf, 'landscape', {
      code: 'DP6', titre: 'Insertion paysagère',
      sousTitre: st.images.insertion ? 'Photomontage du projet dans son environnement' : 'Vue 3D isométrique du projet dans son environnement',
    }, ctx);
  },

  dp78(builder, ctx, cap, st) {
    const pdf = addPage(builder, 'landscape');
    const zone = contentZone('landscape');
    const cells = twoColumnTable(pdf, zone, ['DP7 - Photographie environnement proche', 'DP8 - Photographie environnement lointain']);
    [['proche', 'DP7'], ['lointain', 'DP8']].forEach(([slot, label], i) => {
      const cell = cells[i];
      const imgZone = { x: cell.x, y: cell.y, w: cell.w, h: cell.h - 18 };
      const img = st.images[slot];
      if (img) fitImage(pdf, img, imgZone, { padding: 4, alias: `dp78_${slot}` }); else placeholder(pdf, imgZone, 'Photo à importer.');
      const vp = st.data.pointsDeVue[slot];
      drawViewpoint(pdf, cell.x + 14, cell.y + cell.h - 9, vp ? vp.bearing : 0, null, { size: 6 });
      text(pdf, vp ? `Point de vue ${label} repéré sur le plan de masse (DP2)` : 'Point de vue non placé sur le plan de masse',
        cell.x + 24, cell.y + cell.h - 8, { size: 8, color: MUTED });
    });
    drawFrame(pdf, 'landscape', { code: 'DP7 - DP8', titre: 'Environnement proche et lointain', sousTitre: 'Photographies permettant de situer le terrain' }, ctx);
  },

  dp11(builder, ctx, cap, st) {
    const page = { code: 'DP11', titre: 'Notice descriptive du projet' };
    const zone = contentZone('portrait');
    const x = zone.x + 12;
    const width = zone.w - 24;
    const lineH = 5.2;
    const police = (p) => { p.setFont('helvetica', 'normal'); p.setFontSize(10.5); p.setTextColor(17, 24, 39); };
    let pdf = addPage(builder, 'portrait');
    let y = zone.y + 14;
    text(pdf, 'Notice descriptive du projet', zone.x + zone.w / 2, y, { size: 14, bold: true, align: 'center' });
    y += 12;
    String(st.data.noticeTexte || '').split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).forEach((para) => {
      police(pdf);
      const lignes = pdf.splitTextToSize(para, width);
      if (y + lignes.length * lineH > zone.y + zone.h - 6) {
        // Texte allongé à la main : suite sur une nouvelle page (le texte type tient sur ~60 % d'une page).
        drawFrame(pdf, 'portrait', page, ctx);
        pdf = addPage(builder, 'portrait');
        y = zone.y + 10;
        police(pdf);
      }
      pdf.text(lignes, x, y, { align: 'justify', maxWidth: width, lineHeightFactor: lineH / (10.5 * 0.3528) });
      y += lignes.length * lineH + 3.5;
    });
    drawFrame(pdf, 'portrait', page, ctx);
  },
};

/** Liste ordonnée des pièces effectivement demandées. */
export function piecesOrdonnees(pieceIds) {
  return PIECES.filter((p) => pieceIds.includes(p.id)).map((p) => p.id);
}

/** PDF regroupant plusieurs pièces (dossier complet). */
export function buildPdf(pieceIds, ctx, captures, dpState, bordereauIds = null) {
  const builder = { pdf: null };
  const ordre = piecesOrdonnees(pieceIds);
  // bordereauIds : liste complète du dossier, pour la page de garde d'un PDF isolé (ZIP).
  ordre.forEach((id) => RENDERERS[id](builder, ctx, captures, dpState, bordereauIds || ordre));
  if (!builder.pdf) throw new Error('Aucune pièce sélectionnée.');
  numeroterPages(builder.pdf);
  return builder.pdf;
}

export const NOMS_FICHIERS = {
  garde: '00_page_de_garde', dp1: 'DP1_plan_de_situation', dp2: 'DP2_plan_de_masse', dp3: 'DP3_plan_de_coupe',
  dp4: 'DP4_plan_de_toiture', dp6: 'DP6_insertion_paysagere', dp78: 'DP7_DP8_environnement', dp11: 'DP11_notice_descriptive',
};
