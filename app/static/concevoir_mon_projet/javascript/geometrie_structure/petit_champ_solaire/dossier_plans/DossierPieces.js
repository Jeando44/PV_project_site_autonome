import {
  FORMATS, contentZone, addPage, drawFrame, numeroterPages, fitImage, placeholder, projector, echelleReelle,
  withClip, drawPanels, drawOutline, drawCotation, drawLocalisation, drawScaleBar, text, texteImprimable, MUTED, MARGIN, INK, ACCENT,
} from '../../../declaration_prealable/DpLayout.js?v=2';
import { PIECES, LIBELLES_FORMAT, codesPieces, ECHELLE_SITUATION_PROCHE } from './DossierState.js?v=8';
import { SECTIONS_REGLEMENTATION } from './reglementation_modele.js';
import { dessinerPieceDevis, titreDossierPlans } from '../../dossier_devis.js?v=4';
import { emprise, placement, dessinerEntites, decouperEntites, echelleAjustee } from './DossierVectoriel.js';

/**
 * Phase d'ASSEMBLAGE du dossier de plans « Petit champ solaire » : captures (DossierCaptures.js) +
 * réglages -> pages jsPDF. Gabarit et cartouche de la Déclaration préalable (DpLayout.js) sur toutes
 * les pages, A4 et A3 paysage. Rapide et sans effet de bord : rejouée pour le PDF complet, chaque
 * PDF du ZIP ou une pièce seule.
 */
const SOUS_TITRE = 'Petit champ solaire au sol';

// Espaces des milliers de toLocaleString (U+202F / U+00A0) remplacées par une espace simple : la
// police standard de jsPDF ne connaît pas U+202F (« 1/611,16 kWc » et texte étiré sur la page).
export const nombreFr = (v, dec = 2) => {
  if (v === '' || v == null) return '';
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n.toLocaleString('fr-FR', { maximumFractionDigits: dec }).replace(/[\u202F\u00A0]/g, ' ') : '';
};
export const avecUnite = (v, unite, dec = 2) => (v === '' || v == null || nombreFr(v, dec) === '' ? '' : `${nombreFr(v, dec)} ${unite}`);

function page(code, titre, sousTitre, echelle) {
  return { code, titre, sousTitre, echelle };
}

/** Tableau libellé / valeur ; renvoie l'ordonnée sous le tableau. Les lignes sans valeur sont omises. */
export function tableau(pdf, x, y, w, lignes, { titre = null, colLibelle = 0.45, hLigne = 6.4 } = {}) {
  const lignesUtiles = lignes.filter(([, v]) => v !== '' && v != null);
  if (!lignesUtiles.length) return y;
  if (titre) {
    text(pdf, titre, x, y, { size: 11, bold: true });
    y += 3;
  }
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.2);
  lignesUtiles.forEach(([libelle, valeur], i) => {
    if (i % 2 === 0) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(x, y, w, hLigne, 'F');
    }
    pdf.line(x, y + hLigne, x + w, y + hLigne);
    text(pdf, libelle, x + 2, y + hLigne - 2, { size: 8.5, color: MUTED, maxWidth: w * colLibelle - 4 });
    text(pdf, valeur, x + w * colLibelle, y + hLigne - 2, { size: 9, bold: true, maxWidth: w * (1 - colLibelle) - 2 });
    y += hLigne;
  });
  pdf.line(x, y - lignesUtiles.length * hLigne, x + w, y - lignesUtiles.length * hLigne);
  return y + 6;
}

/**
 * Ligne justifiée : mots posés un à un, l'espace restant réparti entre eux. Fait à la main :
 * align 'justify' de jsPDF 2.5 ignore les lignes déjà découpées et gère mal les longs mots.
 */
function ligneJustifiee(pdf, ligne, x, y, largeur) {
  const mots = ligne.trim().split(/\s+/);
  if (mots.length < 2) { pdf.text(ligne, x, y); return; }
  const largeurs = mots.map((m) => pdf.getTextWidth(m));
  const espace = (largeur - largeurs.reduce((a, b) => a + b, 0)) / (mots.length - 1);
  // Ligne très courte (mot insécable renvoyé à la ligne) : pas d'étirement disgracieux.
  if (espace > pdf.getTextWidth(' ') * 4) { pdf.text(ligne, x, y); return; }
  let cx = x;
  mots.forEach((m, i) => {
    pdf.text(m, cx, y);
    cx += largeurs[i] + espace;
  });
}

// etat (facultatif) : etat.tronque passe à true si une ligne ne tient pas avant yMax.
export function paragraphes(pdf, texteBrut, x, y, largeur, yMax, taille = 10, etat = null) {
  const lineH = taille * 0.3528 * 1.45;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(taille);
  pdf.setTextColor(...INK);
  String(texteBrut || '').split(/\n\s*\n|\n/).map((p) => p.trim()).forEach((para) => {
    if (!para) { y += lineH * 0.5; return; }
    const lignes = pdf.splitTextToSize(texteImprimable(para), largeur);
    lignes.forEach((l, i) => {
      if (y > yMax) { if (etat) etat.tronque = true; return; }
      // Texte justifié : toutes les lignes sauf la dernière du paragraphe.
      if (i < lignes.length - 1) ligneJustifiee(pdf, l, x, y, largeur);
      else pdf.text(l, x, y);
      y += lineH;
    });
    y += lineH * 0.3;
  });
  return y;
}

// ---------------------------------------------------------------------------------------------
// Avertissements de la page de garde (demande explicite) : dossiers ombrières et champs solaires.
// Altimétrie : IGN en France (projet sans pays = France, comme calepinage_maison_terrain.js).
// ---------------------------------------------------------------------------------------------
const TAILLE_AVERTISSEMENT = 7.5;

// `type` : 'champ' (petit champ solaire : altimétrie + tables), 'ombriere' (altimétrie + poteaux)
// ou 'mixte' (ombrières et petits champs : les trois messages).
export function textesAvertissement(type = 'champ') {
  const pays = String(window.ACTIVE_PROJECT_PAYS || '').trim();
  const source = !pays || pays === 'France' ? 'de l’IGN' : 'd’un modèle numérique de terrain public';
  const textes = [
    `Les données altimétriques utilisées pour modéliser le terrain proviennent ${source} et peuvent différer de l’altimétrie réelle du terrain. Elles sont fournies à titre indicatif et ne constituent pas des éléments d’exécution. Un relevé altimétrique réalisé par un géomètre est nécessaire pour confirmer l’altimétrie réelle du terrain en phase d’exécution du projet. En cas d’utilisation de ces valeurs sur les plans d’exécution, Solakvan décline toute responsabilité quant aux erreurs et aux aléas de construction qui pourraient en découler.`,
  ];
  if (type !== 'ombriere') textes.push('L’utilisateur doit s’assurer que les entraxes des tables, la pente et la configuration PV (rampant × long pan) des tables solaires sont conformes aux données du fabricant.');
  if (type !== 'champ') textes.push('Les entraxes des poteaux sont donnés à titre indicatif. Ils peuvent être modifiés en raison de la présence éventuelle de réseaux souterrains ou d’autres contraintes qui seront identifiées sur site.');
  return textes;
}

const RETRAIT_PUCE = 4;
const hLigneAvertissement = (taille) => taille * 0.3528 * 1.45;

/** Hauteur (mm) du bloc d'avertissements dessiné par dessinerAvertissements(). */
export function hauteurAvertissements(pdf, largeur, taille = TAILLE_AVERTISSEMENT, type = 'champ') {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(taille);
  const textes = textesAvertissement(type);
  const lignes = textes
    .reduce((n, t) => n + pdf.splitTextToSize(texteImprimable(t), largeur - RETRAIT_PUCE).length, 0);
  return 6 + lignes * hLigneAvertissement(taille) + textes.length * 1.2 + 3;
}

/** Cadre « Avertissements » (titre et puces justifiées) ; renvoie l'ordonnée sous le cadre. */
export function dessinerAvertissements(pdf, x, y, largeur, taille = TAILLE_AVERTISSEMENT, type = 'champ') {
  const h = hauteurAvertissements(pdf, largeur, taille, type);
  pdf.setFillColor(255, 251, 235);
  pdf.setDrawColor(217, 119, 6);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(x - 3, y - 4, largeur + 6, h, 1.5, 1.5, 'FD');
  text(pdf, 'Avertissements', x, y, { size: 9, bold: true });
  let cy = y + 5;
  textesAvertissement(type).forEach((t) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(taille);
    pdf.setTextColor(...INK);
    pdf.text('•', x, cy);
    cy = paragraphes(pdf, t, x + RETRAIT_PUCE, cy, largeur - RETRAIT_PUCE, Infinity, taille) + 1.2 - hLigneAvertissement(taille) * 0.3;
  });
  return y - 4 + h;
}

/**
 * Taille de police (de `max` à `min` pt) à laquelle `texte` tient sur une ligne de `largeur` mm :
 * titres longs du bordereau des pièces, qui passaient à la ligne et chevauchaient la ligne suivante.
 */
export function tailleSurUneLigne(pdf, texte, largeur, max = 10, min = 7.5) {
  pdf.setFont('helvetica', 'normal');
  let taille = max;
  for (; taille > min; taille -= 0.25) {
    pdf.setFontSize(taille);
    if (pdf.getTextWidth(texteImprimable(texte)) <= largeur) return taille;
  }
  return min;
}

/** Ligne du bordereau : code, titre (réduit pour tenir sur une ligne) et format calé à droite. */
export function ligneBordereau(pdf, w, y, code, titre, format) {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  const xFormat = w - MARGIN - 17;
  const largeurTitre = xFormat - pdf.getTextWidth(texteImprimable(format)) - 4 - (MARGIN + 40);
  text(pdf, code, MARGIN + 17, y, { size: 10, bold: true });
  text(pdf, titre, MARGIN + 40, y, { size: tailleSurUneLigne(pdf, titre, largeurTitre), maxWidth: largeurTitre });
  text(pdf, format, xFormat, y, { size: 8.5, color: MUTED, align: 'right' });
}

/**
 * Espacements de la page de garde : normaux, ou resserrés quand le bordereau et les avertissements
 * ne tiendraient pas au-dessus du cartouche (dossier avec beaucoup de pièces).
 */
export function espacementsGarde(nbInfos, nbPieces, hAvertissements, disponible) {
  const normal = { haut: 22, apresSousTitre: 18, info: 8, avantBordereau: 10, piece: [6.5, 2.5] };
  const serre = { haut: 12, apresSousTitre: 11, info: 6.5, avantBordereau: 6, piece: [5.4, 1.8] };
  const besoin = (e) => e.haut + 15 + e.apresSousTitre + nbInfos * e.info + e.avantBordereau + 4
    + nbPieces * (e.piece[0] + e.piece[1]) + 8 + hAvertissements;
  return besoin(normal) <= disponible ? normal : serre;
}

/**
 * Contenu de la page « Réglementation » (A4 portrait), commun aux dossiers du petit champ solaire et
 * des ombrières : titre puis une section par entrée de `sections` ({id, titre}), textes lus dans
 * `textes`. Le texte qui ne tient pas sur la page n'est pas dessiné.
 * @returns {boolean} true si du texte a été coupé (cf. reglementationDeborde)
 */
export function pageReglementation(pdf, sections, textes) {
  const zone = contentZone('portrait');
  const x = zone.x + 10;
  const largeur = zone.w - 20;
  const yMax = zone.y + zone.h - 6;
  const etat = { tronque: false };
  let y = zone.y + 12;
  text(pdf, 'Réglementation applicable', zone.x + zone.w / 2, y, { size: 14, bold: true, align: 'center' });
  y += 10;
  sections.forEach((s) => {
    const contenu = typeof (textes || {})[s.id] === 'string' ? textes[s.id] : '';
    if (y > yMax - 20) { if (contenu.trim()) etat.tronque = true; return; }
    pdf.setFillColor(...ACCENT);
    pdf.rect(x, y - 4, 1.4, 5.5, 'F');
    text(pdf, s.titre, x + 4, y, { size: 11.5, bold: true });
    y += 7;
    y = paragraphes(pdf, contenu, x, y, largeur, yMax, 9.5, etat);
    y += 5;
  });
  return etat.tronque;
}

/**
 * Le texte de la Réglementation tient-il sur sa page A4 ? Mise en page réelle sur un PDF de brouillon
 * (jsPDF), pour prévenir l'utilisateur AVANT la génération au lieu de couper son texte sans le dire.
 * @returns {boolean|null} true s'il déborde, null si jsPDF n'est pas disponible
 */
let _mesureReglementation = { cle: null, resultat: null };
export function reglementationDeborde(sections, textes) {
  if (!window.jspdf || !window.jspdf.jsPDF) return null;
  const cle = JSON.stringify(sections.map((s) => [s.id, s.titre, (textes || {})[s.id]]));
  if (_mesureReglementation.cle === cle) return _mesureReglementation.resultat;
  let resultat = null;
  try {
    const brouillon = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    resultat = pageReglementation(brouillon, sections, textes);
  } catch (e) {
    console.warn('[Dossier de plans] Mesure de la page Réglementation impossible :', e);
    resultat = null;
  }
  _mesureReglementation = { cle, resultat };
  return resultat;
}

export function mapPage(builder, pg, ctx, cap, overlay) {
  const pdf = addPage(builder, 'landscape');
  const zone = contentZone('landscape');
  const reelle = cap ? echelleReelle(zone, cap.georef) : null;
  // ScaleAlignedCapture garantit l'échelle demandée ; l'échelle réelle n'est affichée que si elle
  // s'en écarte (> 0,5 %), pour ne jamais imprimer une échelle fausse.
  const echelle = cap ? (reelle && Math.abs(reelle / cap.scale - 1) > 0.005 ? Math.round(reelle) : cap.scale) : null;
  if (cap && cap.image) {
    pdf.addImage(cap.image.dataUrl, 'JPEG', zone.x, zone.y, zone.w, zone.h, `pcs_carte_${cap.scale}_${cap.center.lat.toFixed(6)}`, 'NONE');
    const project = projector(zone, cap.center, cap.scale, cap.georef);
    withClip(pdf, zone, () => overlay && overlay(pdf, project, zone, cap));
    drawScaleBar(pdf, zone, echelle);
  } else {
    placeholder(pdf, zone, 'Fond de carte indisponible.');
  }
  drawFrame(pdf, 'landscape', { ...pg, echelle: cap ? `1/${echelle}` : null }, ctx);
}

export function cercleLocalisation(pdf, ctx, project, zone, rayonMin) {
  const implantation = ctx.champs.flatMap((c) => c.contour).map(project);
  if (!implantation.length) {
    drawLocalisation(pdf, project(ctx.implantation), rayonMin, zone);
    return;
  }
  const cx = implantation.reduce((s, p) => s + p.x, 0) / implantation.length;
  const cy = implantation.reduce((s, p) => s + p.y, 0) / implantation.length;
  const r = Math.max(...implantation.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  drawLocalisation(pdf, { x: cx, y: cy }, Math.min(0.42 * Math.min(zone.w, zone.h), Math.max(rayonMin, r * 1.3)), zone);
}

/**
 * Barre d'échelle graphique (sans flèche nord : plans en coupe, canevas éventuellement tourné).
 * 4 segments alternés, longueur « ronde » d'environ 40 mm papier.
 */
export function barreEchelle(pdf, x, y, echelle) {
  const cible = (echelle * 40) / 1000; // mètres pour ~40 mm
  const mag = Math.pow(10, Math.floor(Math.log10(cible)));
  const longueurM = [1, 2, 5, 10].map((k) => k * mag).filter((v) => v <= cible).pop() || mag;
  const longueurMm = (longueurM * 1000) / echelle;
  const pas = longueurMm / 4;
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.2);
  for (let i = 0; i < 4; i++) {
    pdf.setFillColor(...(i % 2 === 0 ? INK : [255, 255, 255]));
    pdf.rect(x + i * pas, y - 1.2, pas, 1.2, 'FD');
  }
  const libelle = (m) => (m < 1 ? `${nombreFr(m * 100, 1)} cm` : `${nombreFr(m, 2)} m`);
  text(pdf, '0', x, y + 3, { size: 6, align: 'center' });
  text(pdf, libelle(longueurM), x + longueurMm, y + 3, { size: 6, align: 'center' });
  text(pdf, `1/${echelle}`, x + longueurMm + 6, y, { size: 6.5, bold: true });
}

// Échelles « propres » d'un plan (1/N) : la plus grande où le dessin tient est retenue.
export const ECHELLES_PLAN = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000];
// Détail de coupe (demande explicite : 1/20 ou 1/30), puis repli progressif.
const ECHELLES_DETAIL = [20, 25, 30, 40, 50];
const PADDING_PLAN = 3; // mm, cf. DossierVectoriel.placement

export function planVectoriel(builder, pg, ctx, entites, vide) {
  const pdf = addPage(builder, 'a3');
  const zone = contentZone('a3');
  if (!entites || !entites.length) {
    placeholder(pdf, zone, vide);
    drawFrame(pdf, 'a3', pg, ctx);
    return;
  }
  const pl = placement(emprise(entites), zone);
  dessinerEntites(pdf, entites, pl);
  drawFrame(pdf, 'a3', { ...pg, echelle: `1/${pl.echelle}` }, ctx);
}

const R = {
  // Parcours Chiffrage : devis saisi dans l'application, même trame que le devis seul.
  devis(builder, ctx, cap) {
    dessinerPieceDevis(builder, addPage, cap.devis);
  },

  garde(builder, ctx, cap, st, codes, ids) {
    const pdf = addPage(builder, 'portrait');
    const { w } = FORMATS.portrait;
    const zone = contentZone('portrait');
    const d = st.data;
    const piecesListees = PIECES.filter((p) => p.id !== 'garde' && ids.includes(p.id));
    const largeurAv = w - 2 * MARGIN - 28;
    const hAv = hauteurAvertissements(pdf, largeurAv);
    const bas = zone.y + zone.h - 3;

    const lignes = [
      ['Projet', ctx.cartouche.nom_projet],
      ['Adresse des travaux', ctx.adresse],
      ['Référence cadastrale', ctx.parcelle && ctx.parcelle.reference],
      ["Maître d'ouvrage", d.maitreOuvrage],
      ['Nombre de panneaux', ctx.nbPanneaux ? String(ctx.nbPanneaux) : null],
      ['Puissance crête', ctx.puissanceKwc ? `${nombreFr(ctx.puissanceKwc)} kWc` : null],
      ['Dossier établi par', (ctx.entreprise && ctx.entreprise.nom) || ctx.cartouche.company_name],
      ['Date', ctx.cartouche.date],
      ['Indice', d.indice || 'A'],
    ].filter(([, v]) => v);
    const e = espacementsGarde(lignes.length, piecesListees.length, hAv, bas - zone.y);

    let y = zone.y + e.haut;
    text(pdf, titreDossierPlans(), w / 2, y, { size: 20, bold: true, align: 'center', maxWidth: w - 2 * MARGIN - 20 }); y += 9;
    text(pdf, SOUS_TITRE, w / 2, y, { size: 12, align: 'center', color: MUTED }); y += 6;
    text(pdf, `Champ photovoltaïque ${ctx.pvId}`, w / 2, y, { size: 9, align: 'center', color: MUTED }); y += e.apresSousTitre;

    lignes.forEach(([k, v]) => {
      text(pdf, k, MARGIN + 14, y, { size: 9, color: MUTED });
      text(pdf, v, MARGIN + 62, y, { size: 10, bold: true, maxWidth: w - 2 * MARGIN - 76 });
      y += e.info;
    });

    y += e.avantBordereau;
    text(pdf, 'Bordereau des pièces', MARGIN + 14, y, { size: 12, bold: true }); y += 4;
    pdf.setDrawColor(...INK); pdf.setLineWidth(0.3);
    piecesListees.forEach((p) => {
      pdf.line(MARGIN + 14, y, w - MARGIN - 14, y);
      y += e.piece[0];
      ligneBordereau(pdf, w, y, codes[p.id], p.titre, LIBELLES_FORMAT[p.format]);
      y += e.piece[1];
    });
    pdf.line(MARGIN + 14, y, w - MARGIN - 14, y);
    // Avertissements en bas de la page de garde (au-dessus du cartouche).
    dessinerAvertissements(pdf, MARGIN + 14, Math.max(y + 12, bas - hAv + 4), largeurAv);
    drawFrame(pdf, 'portrait', page('PCS', 'Page de garde', `${titreDossierPlans()} - ${SOUS_TITRE.toLowerCase()}`), ctx);
  },

  presentation(builder, ctx, cap, st, codes) {
    const pdf = addPage(builder, 'portrait');
    const zone = contentZone('portrait');
    const r = cap.resume || { valeurs: {} };
    const v = r.valeurs || {};
    const res = cap.resultats && !cap.resultats.vide ? cap.resultats.resultat : null;
    const prod = cap.resultats && cap.resultats.production;
    const nbPanneaux = (res && res.nbPanneaux) || ctx.nbPanneaux;
    const puissance = (res && res.puissanceKwc) || ctx.puissanceKwc;
    const x = zone.x + 10;
    const largeur = zone.w - 20;
    const hLigne = 5.8;
    let y = zone.y + 12;
    text(pdf, 'Présentation du projet', zone.x + zone.w / 2, y, { size: 14, bold: true, align: 'center' });
    y += 11;
    const morceaux = [
      `Le projet consiste à réaliser un petit champ solaire au sol (champ ${ctx.pvId})${ctx.adresse ? `, ${ctx.adresse}` : ''}.`,
      nbPanneaux ? `Il comprend ${nbPanneaux} panneaux photovoltaïques${puissance ? `, pour une puissance crête de ${nombreFr(puissance)} kWc` : ''}.` : '',
      v.nbShed ? `Les panneaux sont posés en ${v.nbShed} shed(s)${v.roofSlope !== '' ? ` inclinés à ${nombreFr(v.roofSlope, 1)}°` : ''}${r.modele ? `, sur une structure à poteaux « ${r.modele} »` : ''}${r.ancrage ? ` ancrée par ${r.ancrage.toLowerCase()}` : ''}.` : '',
      v.lowPointHeight !== '' && v.lowPointHeight != null ? `Le point bas des panneaux est à ${nombreFr(v.lowPointHeight)} m du terrain naturel.` : '',
      res && res.surfacePolygoneM2 ? `Le terrain d'implantation couvre ${nombreFr(res.surfacePolygoneM2, 0)} m² ; les panneaux en occupent ${nombreFr(res.surfaceProjeteeM2, 0)} m² au sol (ratio de couverture de ${nombreFr(res.ratioCouverture, 1)} %).` : '',
      prod ? `La production annuelle nette est estimée à ${nombreFr(prod.productionNette, 0)} kWh/an, soit ${nombreFr(prod.productibleNet, 0)} kWh/kWc/an, après ${nombreFr(prod.perteSysteme, 1)} % de pertes système${prod.perteOmbrageCalculee ? ` et ${nombreFr(prod.perteOmbrage, 1)} % de perte d'ombrage entre sheds${prod.ombrageAvecTerrain ? ' en tenant compte de la pente du terrain' : ''}` : ''}.` : '',
      res && res.terrainApplicable && res.penteReelleDeg != null
        ? `Les tables suivant la pente du terrain, leur inclinaison réelle est de ${nombreFr(res.penteReelleDeg, 1)}° et leur azimut réel de ${nombreFr(res.azimutReelDeg, 1)}° (saisis : ${nombreFr(res.penteDeg, 1)}° et ${nombreFr(res.azimutDeg, 1)}°)${prod && prod.ombrageAvecTerrain ? ' ; ces valeurs réelles sont retenues pour la production' : ''}.` : '',
    ].filter(Boolean).join(' ');
    y = paragraphes(pdf, morceaux, x, y, largeur, zone.y + zone.h - 10);
    y += 3;
    y = tableau(pdf, x, y, largeur, [
      ['Projet', ctx.cartouche.nom_projet],
      ['Adresse', ctx.adresse],
      ['Référence cadastrale', ctx.parcelle && ctx.parcelle.reference],
      ["Maître d'ouvrage", st.data.maitreOuvrage],
    ], { titre: 'Identification', hLigne });
    y = tableau(pdf, x, y, largeur, [
      ['Surface du terrain (polygone)', res ? avecUnite(res.surfacePolygoneM2, 'm²') : ''],
      ['Surface du champ PV (panneaux projetés au sol)', res ? avecUnite(res.surfaceProjeteeM2, 'm²') : ''],
      ['Ratio de couverture', res ? avecUnite(res.ratioCouverture, '%', 1) : ''],
      ['Nombre de sheds', res ? res.nbSheds : ''],
      ['Nombre de panneaux', nbPanneaux ? String(nbPanneaux) : ''],
      ['Puissance crête', puissance ? `${nombreFr(puissance)} kWc` : ''],
      ['Production annuelle nette', prod ? `${nombreFr(prod.productionNette, 0)} kWh/an` : ''],
      ['Productible spécifique net', prod ? `${nombreFr(prod.productibleNet, 0)} kWh/kWc/an` : ''],
    ], { titre: 'Chiffres clés', hLigne });
    tableau(pdf, x, y, largeur, [
      ['Dimensions d\'un panneau (L x l x e)', v.petitPanelLengthMm ? `${v.petitPanelLengthMm} x ${v.petitPanelWidthMm} x ${v.petitPanelThicknessMm} mm` : ''],
      ['Orientation des panneaux', r.orientationPanneaux],
      ['Disposition (lignes x colonnes)', v.pvLayout],
      ['Panneaux en rampant', v.nbPanelsRampant],
      ['Groupes de shed en longueur', v.nbShedGroups],
      ['Espacement entre sheds', avecUnite(v.shedSpacing, 'm')],
      ['Pente des panneaux', avecUnite(v.roofSlope, '°', 1)],
      ['Hauteur du point bas', avecUnite(v.lowPointHeight, 'm')],
      ['Hauteur libre de passage', avecUnite(v.passageHeight, 'm')],
      ['Hauteur des poteaux', avecUnite(v.postHeight, 'm')],
      ['Largeur du champ (rampant)', avecUnite(v.panelWidth, 'm')],
      ['Longueur de façade', avecUnite(v.facadeLength, 'm')],
      ['Entraxe maximal entre poteaux', avecUnite(v.facadeEntraxe, 'm')],
      ['Modèle de poteaux', r.modele],
      ["Type d'ancrage", [r.ancrage, r.anchorSystem === 'beton' ? [r.configurationBeton, r.positionBeton].filter(Boolean).join(', ') : ''].filter(Boolean).join(' - ')],
    ], { titre: 'Caractéristiques de la structure', hLigne });
    drawFrame(pdf, 'portrait', page(codes.presentation, 'Présentation du projet', SOUS_TITRE), ctx);
  },

  reglementation(builder, ctx, cap, st, codes) {
    const pdf = addPage(builder, 'portrait');
    pageReglementation(pdf, SECTIONS_REGLEMENTATION, st.data.reglementation.sections);
    drawFrame(pdf, 'portrait', page(codes.reglementation, 'Réglementation', 'Urbanisme, sécurité incendie (SDIS) et installations classées (ICPE)'), ctx);
  },

  situation(builder, ctx, cap, st, codes) {
    const c = cap.carte || {};
    mapPage(builder, page(codes.situation, 'Plan de situation', "Vue d'ensemble - fond OpenStreetMap"), ctx, c.situation10000,
      (pdf, project, zone) => cercleLocalisation(pdf, ctx, project, zone, 7));
    mapPage(builder, page(codes.situation, 'Plan de situation', 'Vue rapprochée - fond Géoportail et cadastre'), ctx, c[`situation${ECHELLE_SITUATION_PROCHE}`],
      (pdf, project, zone) => {
        if (ctx.parcelle) drawOutline(pdf, ctx.parcelle.ring.map(project), { width: 0.5, dash: [2, 1] });
        cercleLocalisation(pdf, ctx, project, zone, 8);
      });
  },

  calepinage_carte(builder, ctx, cap, st, codes) {
    const c = cap.carte || {};
    mapPage(builder, { ...page(codes.calepinage_carte, 'Plan de calepinage', 'Implantation des panneaux sur fond cadastral'), puissanceKwc: ctx.puissanceKwc }, ctx, c.masse,
      (pdf, project) => {
        if (ctx.parcelle) drawOutline(pdf, ctx.parcelle.ring.map(project), { width: 0.5, dash: [2, 1] });
        ctx.champs.forEach((champ) => {
          if (champ.contour.length >= 3) drawOutline(pdf, champ.contour.map(project), { color: [37, 99, 235], width: 0.4 });
        });
        const panneaux = ctx.panneaux.length ? ctx.panneaux : ctx.champs.flatMap((champ) => champ.panneaux);
        drawPanels(pdf, panneaux.map((p) => p.map(project)));
        ctx.cotations.forEach((cot) => drawCotation(pdf, project(cot.a), project(cot.b), `${nombreFr(cot.lengthM)} m`));
      });
  },

  calepinage_canevas(builder, ctx, cap, st, codes) {
    const pdf = addPage(builder, 'a3');
    const zone = contentZone('a3');
    const img = cap.canevas;
    let echelle = 'sans échelle';
    if (img && img.pxParM > 0) {
      // Canevas posé à une échelle exacte : sa taille réelle (m) vient de ses pixels par mètre.
      const mW = img.width / img.pxParM;
      const mH = img.height / img.pxParM;
      const utile = { w: zone.w - 8, h: zone.h - 14 }; // place de la barre d'échelle en bas
      const besoin = Math.max((mW * 1000) / utile.w, (mH * 1000) / utile.h);
      const n = ECHELLES_PLAN.find((e) => e >= besoin) || echelleAjustee(besoin);
      const w = (mW * 1000) / n;
      const h = (mH * 1000) / n;
      pdf.addImage(img.dataUrl, 'JPEG', zone.x + (zone.w - w) / 2, zone.y + 2 + (utile.h - h) / 2, w, h, 'pcs_canevas', 'NONE');
      barreEchelle(pdf, zone.x + 6, zone.y + zone.h - 5, n);
      echelle = `1/${n}`;
    } else if (img) {
      fitImage(pdf, img, zone, { padding: 4, alias: 'pcs_canevas' });
    } else {
      placeholder(pdf, zone, 'Plan de calepinage indisponible.');
    }
    drawFrame(pdf, 'a3', { ...page(codes.calepinage_canevas, 'Plan de calepinage', 'Disposition des panneaux - cotes en mètres', echelle), puissanceKwc: ctx.puissanceKwc }, ctx);
  },

  vue_3d(builder, ctx, cap, st, codes) {
    const pdf = addPage(builder, 'a3');
    const zone = contentZone('a3');
    if (cap.vue3d) fitImage(pdf, cap.vue3d, zone, { padding: 2, alias: 'pcs_3d' });
    else placeholder(pdf, zone, 'Vue 3D indisponible : ouvrez la vue 3D du calepinage puis regénérez.');
    drawFrame(pdf, 'a3', page(codes.vue_3d, 'Visualisation 3D du calepinage', 'Vue isométrique', 'sans échelle'), ctx);
  },

  resultats(builder, ctx, cap, st, codes) {
    const pdf = addPage(builder, 'portrait');
    const zone = contentZone('portrait');
    const x = zone.x + 10;
    const largeur = zone.w - 20;
    let hLigne = 6.1;
    let y = zone.y + 12;
    text(pdf, 'Résultats et optimisation du calepinage', zone.x + zone.w / 2, y, { size: 14, bold: true, align: 'center' });
    y += 10;
    const res = cap.resultats;
    if (!res || res.vide || !res.resultat) {
      placeholder(pdf, { x: zone.x, y, w: zone.w, h: 60 }, 'Aucun résultat : le champ doit être un calepinage « Shed » avec des panneaux posés.');
    } else {
      const r = res.resultat;
      const p = res.production;
      // Petit champ au sol : pente / azimut saisis ET réels (tables qui suivent le terrain).
      const terrain = !!r.terrainApplicable;
      if (terrain) hLigne = 5.5; // 36 lignes au plus : la note doit tenir au-dessus du cartouche
      const groupes = (r.rangees || []).map((g) => g.nbGroupes).filter((n) => n > 0);
      const gMin = groupes.length ? Math.min(...groupes) : null;
      const gMax = groupes.length ? Math.max(...groupes) : null;
      y = tableau(pdf, x, y, largeur, [
        ['Surface du terrain (polygone)', avecUnite(r.surfacePolygoneM2, 'm²')],
        ['Surface du champ PV (panneaux projetés au sol)', avecUnite(r.surfaceProjeteeM2, 'm²')],
        ['Surface des panneaux inclinés', avecUnite(r.surfaceInclineeM2, 'm²')],
        ['Ratio de couverture', avecUnite(r.ratioCouverture, '%', 1)],
        ['Pente des panneaux (saisie)', avecUnite(r.penteDeg, '°', 1)],
        ['Azimut saisi ou calculé (Sud = 0°, Ouest = +90°)', avecUnite(r.azimutDeg, '°', 1)],
        ...(terrain ? [
          ['Pente réelle des panneaux avec le terrain', r.penteReelleDeg == null ? 'non calculée' : avecUnite(r.penteReelleDeg, '°', 1)],
          ['Azimut réel avec le terrain (Sud = 0°, Ouest = +90°)', r.azimutReelDeg == null ? 'non calculé' : avecUnite(r.azimutReelDeg, '°', 1)],
        ] : []),
        ['Nombre de sheds', r.nbSheds],
        ['Nb. de rangées de shed', r.nbRangees],
        ['Groupes de shed par rangée', gMin == null ? '' : (gMin === gMax ? String(gMin) : `${gMin} à ${gMax}`)],
        ['Nb. PV en largeur (rampant)', r.nbPvLargeur],
        ['Nb. PV en long. par shed', r.nbPvLongueurParShed > 0 ? r.nbPvLongueurParShed : (r.nbPvLongueurParShed === 0 ? '0 (remplissage maximal)' : '')],
        ['Esp. entre sheds (mm)', nombreFr(r.espacementShedsMm, 0)],
        ['Esp. groupe de shed (mm)', nombreFr(r.espacementGroupesMm, 0)],
        ['Esp. bordure (mm)', r.espacementBordureMm == null ? '' : nombreFr(r.espacementBordureMm, 0)],
        ["Dimensions d'un shed", r.dimensionsShed],
        ["Surface d'un groupe de shed", avecUnite(r.surfaceGroupeM2, 'm²')],
        ['Nbre de PV calepinage (L x C)', r.pvCalepinage],
      ], { titre: 'Terrain, géométrie et surfaces', hLigne });
      y = tableau(pdf, x, y, largeur, [
        ['Nombre de panneaux', r.nbPanneaux],
        ['Dimensions des panneaux', r.panneauDimensions],
        ['Puissance unitaire des panneaux', avecUnite(r.panneauPuissanceWc, 'Wc', 0)],
        ['Puissance crête', avecUnite(r.puissanceKwc, 'kWc', 3)],
        ['Irradiation annuelle dans le plan des panneaux', p ? avecUnite(p.irradiation, 'kWh/m²/an', 0) : ''],
        ['Production annuelle brute (avant pertes)', p ? avecUnite(p.productionBrute, 'kWh/an', 0) : ''],
        ['Pertes système', p ? avecUnite(p.perteSysteme, '%', 1) : avecUnite(r.perteSysteme, '%', 1)],
        ["% Perte d'ombrage entre sheds (terrain plat)", r.perteOmbrage == null ? 'non calculée' : avecUnite(r.perteOmbrage, '%', 1)],
        ...(terrain ? [["% Perte d'ombrage avec terrain", r.perteOmbrageTerrain == null ? 'non calculée' : avecUnite(r.perteOmbrageTerrain, '%', 1)]] : []),
        ...(terrain && p ? [['Ombrage retenu pour la production', p.ombrageAvecTerrain
          ? `avec terrain (pente ${nombreFr(p.penteProduction, 1)}°, azimut ${nombreFr(p.azimutProduction, 1)}°)`
          : 'terrain plat (pente et azimut saisis)']] : []),
        ['Pertes totales (système et ombrage)', p ? avecUnite(p.perteTotale, '%', 1) : ''],
        ['Production annuelle nette', p ? avecUnite(p.productionNette, 'kWh/an', 0) : 'non calculée'],
        ['Productible spécifique net', p ? avecUnite(p.productibleNet, 'kWh/kWc/an', 0) : ''],
      ], { titre: 'Puissance et production', hLigne });
      const note = p
        ? `Production brute calculée sans perte système, puis nette = brute x (1 - pertes système) x (1 - perte d'ombrage entre sheds${p.ombrageAvecTerrain ? ' avec le relief du terrain ; pente et azimut réels des tables' : ''}). Valeurs du bouton « Calculer » du calepinage shed.`
        : "Valeurs du bouton « Calculer » du calepinage shed. Productible indisponible (service d'ensoleillement indisponible ou adresse non géolocalisée).";
      text(pdf, note, x, Math.min(y, zone.y + zone.h - 8), { size: 7.5, color: MUTED, maxWidth: largeur });
    }
    drawFrame(pdf, 'portrait', page(codes.resultats, 'Résultats et optimisation', 'Tableau des résultats du bouton « Calculer » et productible'), ctx);
  },

  coupe(builder, ctx, cap, st, codes) {
    const orientation = cap.resume && cap.resume.modele ? `Modèle « ${cap.resume.modele} »` : SOUS_TITRE;
    const pg = page(codes.coupe, 'Plan de coupe', orientation);
    const plans = cap.plans || {};
    const detail = plans.coupeDetail;
    if (!plans.coupe || !plans.coupe.length || !detail) {
      planVectoriel(builder, pg, ctx, plans.coupe, 'Plan de coupe indisponible : ouvrez le configurateur et affichez le plan de coupe.');
      return;
    }
    // Coupe d'ensemble (existante, toutes les rangées) en haut ; détail d'un shed en dessous, au
    // 1/20 ou 1/30 (demande explicite), pour lire la structure, les cotes et l'ancrage.
    const pdf = addPage(builder, 'a3');
    const zone = contentZone('a3');
    const TITRE_H = 7;
    const f = detail.fenetre;
    const fw = f.maxX - f.minX;
    const fh = f.maxY - f.minY;
    const hDetailMax = zone.h * 0.62 - TITRE_H;
    const tient = (n) => (fh * 1000) / n + 2 * PADDING_PLAN <= hDetailMax && (fw * 1000) / n + 2 * PADDING_PLAN <= zone.w;
    const nDetail = ECHELLES_DETAIL.find(tient)
      || echelleAjustee(Math.max((fh * 1000) / (hDetailMax - 2 * PADDING_PLAN), (fw * 1000) / (zone.w - 2 * PADDING_PLAN)));
    const hDetail = (fh * 1000) / nDetail + 2 * PADDING_PLAN;
    const zoneDetail = { x: zone.x, y: zone.y + zone.h - hDetail, w: zone.w, h: hDetail };
    const zoneEnsemble = { x: zone.x, y: zone.y + TITRE_H, w: zone.w, h: zoneDetail.y - TITRE_H - 3 - (zone.y + TITRE_H) };

    const plEnsemble = placement(emprise(plans.coupe), zoneEnsemble);
    dessinerEntites(pdf, plans.coupe, plEnsemble);
    text(pdf, "Coupe d'ensemble - toutes les rangées", zone.x + 4, zone.y + 5, { size: 9.5, bold: true });
    barreEchelle(pdf, zone.x + zone.w - 70, zone.y + 5, plEnsemble.echelle);

    const ySep = zoneDetail.y - TITRE_H - 1.5;
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.3);
    pdf.line(zone.x + 2, ySep, zone.x + zone.w - 2, ySep);
    text(pdf, "Détail d'un shed - structure, cotes et ancrage", zone.x + 4, ySep + 5, { size: 9.5, bold: true });
    barreEchelle(pdf, zone.x + zone.w - 70, ySep + 5, nDetail);
    const plDetail = placement(f, zoneDetail, [nDetail]);
    const entitesDetail = decouperEntites(detail.entites, f);
    withClip(pdf, zoneDetail, () => dessinerEntites(pdf, entitesDetail, plDetail, { maxFontPt: 10 }));

    drawFrame(pdf, 'a3', { ...pg, echelle: `1/${plEnsemble.echelle} et 1/${nDetail} (détail)` }, ctx);
  },

  facade(builder, ctx, cap, st, codes) {
    planVectoriel(builder, page(codes.facade, 'Plan de façade', 'Élévation longitudinale, terrain et altimétrie'), ctx,
      cap.plans && cap.plans.facade, 'Plan de façade indisponible : ouvrez le configurateur et affichez le plan de façade.');
  },

  fondations(builder, ctx, cap, st, codes) {
    const pdf = addPage(builder, 'portrait');
    const zone = contentZone('portrait');
    const f = cap.plans && cap.plans.fondation;
    const r = cap.resume || { valeurs: {} };
    const v = r.valeurs || {};
    const zoneDessin = { x: zone.x, y: zone.y + 4, w: zone.w, h: zone.h * 0.62 };
    let echelle = null;
    if (f) {
      const a = f.ancrage;
      // Fenêtre : l'ancrage, le pied du poteau au-dessus, un peu de terrain autour.
      const fenetre = { minX: a.minX - 0.45, maxX: a.maxX + 0.45, minY: a.minY - 0.3, maxY: a.maxY + 0.7 };
      const entites = decouperEntites(f.entites, fenetre);
      const pl = placement(fenetre, zoneDessin, [10, 20]);
      echelle = pl.echelle;
      withClip(pdf, zoneDessin, () => dessinerEntites(pdf, entites, pl));
      // Cotes de l'ancrage (emprise dessinée), lisibles à cette échelle.
      const bas = pl.versMm(a.minX, a.minY);
      const haut = pl.versMm(a.maxX, a.maxY);
      drawCotation(pdf, { x: bas.x, y: bas.y + 6 }, { x: haut.x, y: bas.y + 6 }, `${nombreFr(a.maxX - a.minX)} m`);
      drawCotation(pdf, { x: haut.x + 6, y: bas.y }, { x: haut.x + 6, y: haut.y }, `${nombreFr(a.maxY - a.minY)} m`);
    } else {
      placeholder(pdf, zoneDessin, "Aucun ancrage dessiné : choisissez le type d'ancrage dans le configurateur.");
    }
    const ancrage = r.anchorSystem || 'beton';
    const lignes = [
      ["Type d'ancrage", r.ancrage],
      ['Configuration', ancrage === 'beton' ? r.configurationBeton : ''],
      ['Position', ancrage === 'beton' ? r.positionBeton : ''],
      ['Longueur du massif', ancrage === 'beton' ? avecUnite(v.foundationLength, 'm') : ''],
      ['Largeur du massif', ancrage === 'beton' ? avecUnite(v.foundationWidth, 'm') : ''],
      ['Hauteur du massif', ancrage === 'beton' ? avecUnite(v.foundationDepth, 'm') : ''],
      ['Débord de chaque côté', ancrage === 'beton' ? avecUnite(v.foundationOverhang, 'm') : ''],
      ["Niveau d'enfouissement", ancrage === 'beton' && /enterr/i.test(r.positionBeton || '') ? avecUnite(v.foundationBuryLevel, 'm') : ''],
      ['Profondeur vis / micropieu', ancrage !== 'beton' ? avecUnite(v.visDepth, 'm') : ''],
      ["Profondeur d'ancrage du poteau", avecUnite(v.anchorDepth, 'm')],
    ];
    const y = tableau(pdf, zone.x + 10, zoneDessin.y + zoneDessin.h + 8, zone.w - 20, lignes, { titre: "Caractéristiques de l'ancrage" });
    text(pdf, "Détail d'un ancrage type (premier poteau du plan de coupe). Dimensionnement à confirmer par l'étude de sol et la note de calcul.",
      zone.x + 10, Math.min(y, zone.y + zone.h - 4), { size: 7.5, color: MUTED, maxWidth: zone.w - 20 });
    drawFrame(pdf, 'portrait', page(codes.fondations, 'Détail des fondations', 'Coupe et zoom sur un ancrage', echelle ? `1/${echelle}` : null), ctx);
  },
};

/** Liste ordonnée des pièces effectivement demandées. */
export function piecesOrdonnees(ids) {
  return PIECES.filter((p) => ids.includes(p.id)).map((p) => p.id);
}

/**
 * PDF regroupant plusieurs pièces.
 * @param {string[]} bordereauIds dossier complet (numérotation et bordereau d'un PDF isolé du ZIP)
 */
export function buildPdf(ids, ctx, captures, dossier, bordereauIds = null) {
  const builder = { pdf: null };
  const ordre = piecesOrdonnees(ids);
  const complet = piecesOrdonnees(bordereauIds || ordre);
  const codes = codesPieces(complet);
  ordre.forEach((id) => R[id](builder, ctx, captures, dossier, codes, complet));
  if (!builder.pdf) throw new Error('Aucune pièce sélectionnée.');
  numeroterPages(builder.pdf);
  return builder.pdf;
}

export const NOMS_FICHIERS = {
  garde: '00_page_de_garde', presentation: 'presentation', reglementation: 'reglementation',
  situation: 'plan_de_situation', calepinage_carte: 'plan_de_calepinage_carte', calepinage_canevas: 'plan_de_calepinage',
  vue_3d: 'vue_3d', resultats: 'resultats_optimisation', coupe: 'plan_de_coupe', facade: 'plan_de_facade', fondations: 'detail_fondations',
  devis: 'devis',
};

export function nomFichier(id, codes) {
  return codes[id] ? `${codes[id]}_${NOMS_FICHIERS[id]}` : NOMS_FICHIERS[id];
}
