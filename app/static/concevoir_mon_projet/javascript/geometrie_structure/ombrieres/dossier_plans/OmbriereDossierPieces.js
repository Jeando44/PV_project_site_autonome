import {
  FORMATS, contentZone, addPage, drawFrame, numeroterPages, fitImage, placeholder, projector, echelleReelle,
  withClip, drawOutline, drawScaleBar, drawPanels, drawCotation, text, MUTED, MARGIN, INK, ACCENT,
} from '../../../declaration_prealable/DpLayout.js?v=2';
import {
  nombreFr, avecUnite, tableau, paragraphes, mapPage, cercleLocalisation, barreEchelle, ECHELLES_PLAN, planVectoriel,
  pageReglementation, hauteurAvertissements, dessinerAvertissements, espacementsGarde, ligneBordereau,
} from '../../petit_champ_solaire/dossier_plans/DossierPieces.js?v=13';
import { echelleAjustee } from '../../petit_champ_solaire/dossier_plans/DossierVectoriel.js?v=5';
import { LIBELLES_FORMAT, codesPieces, ECHELLE_SITUATION_PROCHE, champsAvecPlans } from './OmbriereDossierState.js?v=9';
import { SECTIONS_REGLEMENTATION } from './reglementation_modele.js?v=5';
import { dessinerPieceDevis, titreDossierPlans } from '../../dossier_devis.js?v=4';

/**
 * Phase d'ASSEMBLAGE du dossier de plans « projet entier » (profil ombrières, toitures ou mixte :
 * libellés et pièces lus dans st.profil / st.pieces) : captures (OmbriereDossierCaptures.js) +
 * réglages -> pages jsPDF. Même gabarit et même cartouche que le dossier du petit champ solaire
 * (DpLayout.js), mêmes helpers (tableaux, pages carte, plans vectoriels). Rapide et sans effet de
 * bord : rejouée pour le PDF complet, chaque PDF du ZIP ou une pièce seule.
 */
const BLEU = [37, 99, 235];
const VERT = [22, 163, 74];

function page(code, titre, sousTitre, echelle) {
  return { code, titre, sousTitre, echelle };
}

const libelleChamp = (c, resume) => [c.sourceId, (resume && resume.type) || c.libelleType, resume && resume.modele ? `« ${resume.modele} »` : '']
  .filter(Boolean).join(' - ');

/** Étiquette PVn au centre de chaque champ du dossier (plans sur fond de carte). */
function etiquettesChamps(pdf, ctx, project) {
  const ids = new Set(ctx.champsDossier.map((c) => c.sourceId));
  ctx.champs.filter((champ) => ids.has(champ.sourceId) && champ.contour.length >= 3).forEach((champ) => {
    const pts = champ.contour.map(project);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(cx - 6, cy - 2.6, 12, 4.4, 1, 1, 'F');
    text(pdf, champ.sourceId, cx, cy + 0.8, { size: 7, bold: true, align: 'center', color: BLEU });
  });
}

/** Tableau à colonnes (libellé + une colonne par valeur) ; renvoie l'ordonnée sous le tableau. */
function grille(pdf, x, y, largeurs, entetes, lignes, { hLigne = 6.2, hEntete = 8 } = {}) {
  const w = largeurs.reduce((a, b) => a + b, 0);
  pdf.setFillColor(241, 245, 249);
  pdf.rect(x, y, w, hEntete, 'F');
  let cx = x;
  entetes.forEach((t, i) => {
    text(pdf, t, cx + (i === 0 ? 2 : largeurs[i] / 2), y + hEntete - 2.6,
      { size: 8.5, bold: true, align: i === 0 ? 'left' : 'center', maxWidth: largeurs[i] - 3 });
    cx += largeurs[i];
  });
  y += hEntete;
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.2);
  lignes.forEach((ligne, n) => {
    if (n % 2 === 1) { pdf.setFillColor(248, 250, 252); pdf.rect(x, y, w, hLigne, 'F'); }
    let lx = x;
    ligne.forEach((v, i) => {
      const val = v === '' || v == null ? '-' : String(v);
      text(pdf, val, lx + (i === 0 ? 2 : largeurs[i] / 2), y + hLigne - 2,
        { size: i === 0 ? 8 : 8.5, color: i === 0 ? MUTED : INK, bold: i > 0, align: i === 0 ? 'left' : 'center', maxWidth: largeurs[i] - 3 });
      lx += largeurs[i];
    });
    y += hLigne;
    pdf.line(x, y, x + w, y);
  });
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.3);
  pdf.rect(x, y - lignes.length * hLigne - hEntete, w, lignes.length * hLigne + hEntete);
  return y + 5;
}

/** Champs du dossier répartis selon la source de leur production (pvlib avec ombrage / repli PVGIS). */
function sourcesProduction(ctx, cap) {
  const pvlib = [];
  const pvgis = [];
  ctx.champsDossier.forEach((c) => {
    const p = (cap.parChamp[c.sourceId] || {}).production;
    if (p) (p.source === 'pvgis' ? pvgis : pvlib).push(c.sourceId);
  });
  return { pvlib, pvgis };
}

/** Source de la production, en quelques mots (paragraphe de présentation). */
function libelleSourceProduction(ctx, cap) {
  const { pvlib, pvgis } = sourcesProduction(ctx, cap);
  if (pvlib.length && !pvgis.length) return "calcul avec perte d'ombrage proche";
  if (pvlib.length) return "calcul avec perte d'ombrage proche, complété par une estimation brute sans ombrage";
  return 'estimation brute sans ombrage, nette des pertes système';
}

/** Note de source sous le tableau géométrie. */
function noteSourceProduction(ctx, cap) {
  const { pvlib, pvgis } = sourcesProduction(ctx, cap);
  const morceaux = [];
  if (pvlib.length) morceaux.push(`${pvlib.join(', ')} : calcul du bouton « Calculer et visualiser », nette des pertes système et de la perte d'ombrage proche (scène 3D)`);
  if (pvgis.length) morceaux.push(`${pvgis.join(', ')} : estimation brute sans ombrage, qui n'engage pas Solakvan (lancez « Calculer et visualiser » pour tenir compte de l'ombrage)`);
  return morceaux.length ? `Production - ${morceaux.join(' ; ')}.` : 'Production non calculée.';
}

/** Production annuelle totale (kWh/an), ou null si un champ n'a pas pu être calculé. */
function productionProjet(ctx, cap) {
  const prods = ctx.champsDossier.map((c) => (cap.parChamp[c.sourceId] || {}).production);
  return prods.length && prods.every(Boolean) ? prods.reduce((s, p) => s + p.productionKwhAn, 0) : null;
}

const R = {
  garde(builder, ctx, cap, st, codes, ids) {
    const pdf = addPage(builder, 'portrait');
    const { w } = FORMATS.portrait;
    const d = st.data;
    const sousTitre = st.profil.sousTitre;
    const zone = contentZone('portrait');
    const piecesListees = st.pieces.filter((p) => p.id !== 'garde' && ids.includes(p.id));
    // Avertissements : ombrières (altimétrie, entraxes des poteaux) et mixte (+ tables des petits
    // champs), pas pour un dossier de toitures seules.
    const avecAvertissements = st.profil.id !== 'toitures';
    const typeAv = st.profil.id === 'mixte' ? 'mixte' : 'ombriere';
    const largeurAv = w - 2 * MARGIN - 28;
    const hAv = avecAvertissements ? hauteurAvertissements(pdf, largeurAv, undefined, typeAv) : 0;
    const bas = zone.y + zone.h - 3;
    const infos = [
      ['Projet', ctx.cartouche.nom_projet],
      ['Adresse des travaux', ctx.adresse],
      ['Référence cadastrale', ctx.parcelle && ctx.parcelle.reference],
      ["Maître d'ouvrage", d.maitreOuvrage],
      [st.profil.nombre, String(ctx.champsDossier.length)],
      ['Nombre de panneaux', ctx.nbPanneaux ? String(ctx.nbPanneaux) : null],
      ['Puissance crête', ctx.puissanceKwc ? `${nombreFr(ctx.puissanceKwc)} kWc` : null],
      ['Dossier établi par', (ctx.entreprise && ctx.entreprise.nom) || ctx.cartouche.company_name],
      ['Date', ctx.cartouche.date],
      ['Indice', d.indice || 'A'],
    ].filter(([, v]) => v);
    const e = espacementsGarde(infos.length, piecesListees.length, hAv, bas - zone.y);

    let y = zone.y + e.haut;
    text(pdf, titreDossierPlans(), w / 2, y, { size: 20, bold: true, align: 'center', maxWidth: w - 2 * MARGIN - 20 }); y += 9;
    text(pdf, sousTitre, w / 2, y, { size: 12, align: 'center', color: MUTED }); y += 6;
    text(pdf, `Champs photovoltaïques ${ctx.champsDossier.map((c) => c.sourceId).join(', ')}`, w / 2, y,
      { size: 9, align: 'center', color: MUTED, maxWidth: w - 2 * MARGIN - 20 }); y += e.apresSousTitre;

    infos.forEach(([k, v]) => {
      text(pdf, k, MARGIN + 14, y, { size: 9, color: MUTED });
      text(pdf, v, MARGIN + 62, y, { size: 10, bold: true, maxWidth: w - 2 * MARGIN - 76 });
      y += e.info;
    });

    y += e.avantBordereau;
    text(pdf, 'Bordereau des pièces', MARGIN + 14, y, { size: 12, bold: true }); y += 4;
    pdf.setDrawColor(...INK); pdf.setLineWidth(0.3);
    const nbAvecPlans = champsAvecPlans(ctx.champsDossier).length;
    piecesListees.forEach((p) => {
      pdf.line(MARGIN + 14, y, w - MARGIN - 14, y);
      y += e.piece[0];
      const nb = p.parChamp ? ` (${p.plans ? nbAvecPlans : ctx.champsDossier.length} p.)` : '';
      ligneBordereau(pdf, w, y, codes[p.id], p.titre, `${LIBELLES_FORMAT[p.format]}${nb}`);
      y += e.piece[1];
    });
    pdf.line(MARGIN + 14, y, w - MARGIN - 14, y);
    // Avertissements en bas de la page de garde (au-dessus du cartouche).
    if (avecAvertissements) dessinerAvertissements(pdf, MARGIN + 14, Math.max(y + 12, bas - hAv + 4), largeurAv, undefined, typeAv);
    drawFrame(pdf, 'portrait', page('PCO', 'Page de garde', `${titreDossierPlans()} - ${sousTitre.toLowerCase()}`), ctx);
  },

  presentation(builder, ctx, cap, st, codes) {
    const pdf = addPage(builder, 'portrait');
    const zone = contentZone('portrait');
    const x = zone.x + 10;
    const largeur = zone.w - 20;
    const hLigne = 5.8;
    const n = ctx.champsDossier.length;
    const resume = (c) => (cap.parChamp[c.sourceId] || {}).resume;
    const types = [...new Set(ctx.champsDossier.map((c) => (resume(c) && resume(c).type) || c.libelleType))];
    const aper = cap.aper && cap.aper.aDesSurfaces ? cap.aper : null;
    const productionTotale = productionProjet(ctx, cap);
    let y = zone.y + 12;
    text(pdf, 'Présentation du projet', zone.x + zone.w / 2, y, { size: 14, bold: true, align: 'center' });
    y += 11;
    const objet = st.profil.id === 'ombrieres'
      ? `réaliser ${n} ombrière${n > 1 ? 's' : ''} photovoltaïque${n > 1 ? 's' : ''}`
      : `installer ${n} champ${n > 1 ? 's' : ''} photovoltaïque${n > 1 ? 's' : ''}`;
    const morceaux = [
      `Le projet consiste à ${objet} (${types.join(', ').toLowerCase()})${ctx.adresse ? `, ${ctx.adresse}` : ''}.`,
      ctx.nbPanneaux ? `L'ensemble comprend ${ctx.nbPanneaux} panneaux photovoltaïques${ctx.puissanceKwc ? `, pour une puissance crête de ${nombreFr(ctx.puissanceKwc)} kWc` : ''}.` : '',
      ctx.surfaceProjeteeM2 ? `Les panneaux couvrent ${nombreFr(ctx.surfaceProjeteeM2, 0)} m² au sol (surface projetée).` : '',
      productionTotale != null ? `La production annuelle est estimée à ${nombreFr(productionTotale, 0)} kWh/an (${libelleSourceProduction(ctx, cap)}).` : '',
      aper ? `Au titre de la loi APER, la surface assujettie est de ${nombreFr(aper.surfaceAssujettie, 0)} m² ; l'objectif de ${nombreFr(aper.percentHuwart, 1)} % représente ${nombreFr(aper.surfaceSolarisableHuwart, 0)} m², ${aper.isConforme ? 'atteint' : 'non atteint'} par le projet.` : '',
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
      [st.profil.nombre, String(n)],
      ['Nombre de panneaux', ctx.nbPanneaux ? String(ctx.nbPanneaux) : ''],
      ['Puissance crête', ctx.puissanceKwc ? `${nombreFr(ctx.puissanceKwc)} kWc` : ''],
      ['Surface des panneaux', avecUnite(ctx.surfacePanneauxM2, 'm²', 0)],
      ['Surface projetée au sol', avecUnite(ctx.surfaceProjeteeM2, 'm²', 0)],
      ['Production annuelle estimée', productionTotale != null ? `${nombreFr(productionTotale, 0)} kWh/an` : ''],
    ], { titre: 'Chiffres clés', hLigne });
    tableau(pdf, x, y, largeur, ctx.champsDossier.map((c) => [
      libelleChamp(c, resume(c)),
      `${c.nbPanneaux} panneaux - ${nombreFr(c.puissanceKwc)} kWc`,
    ]), { titre: st.profil.champs, hLigne, colLibelle: 0.62 });
    drawFrame(pdf, 'portrait', page(codes.presentation, 'Présentation du projet', st.profil.sousTitre), ctx);
  },

  aper(builder, ctx, cap, st, codes) {
    const pdf = addPage(builder, 'portrait');
    const zone = contentZone('portrait');
    const x = zone.x + 10;
    const largeur = zone.w - 20;
    const a = cap.aper;
    let y = zone.y + 12;
    text(pdf, 'Résultats de la loi APER', zone.x + zone.w / 2, y, { size: 14, bold: true, align: 'center' });
    y += 10;
    if (!a || !a.aDesSurfaces) {
      placeholder(pdf, { x: zone.x, y, w: zone.w, h: 60 }, 'Aucune surface APER tracée : utilisez les outils « Loi APER » de la carte, puis regénérez.');
      drawFrame(pdf, 'portrait', page(codes.aper, 'Loi APER', 'Assujettissement et objectif de solarisation'), ctx);
      return;
    }
    const exclusions = (a.individualSubs || []).map((s) => [`Exclusion ${s.id}`, `- ${nombreFr(s.val, 2)} m²`]);
    y = tableau(pdf, x, y, largeur, [
      ['Surfaces totales (+)', avecUnite(a.baseArea, 'm²')],
      ...exclusions,
      ['Surfaces exclues (total)', a.subArea ? `- ${nombreFr(a.subArea, 2)} m²` : '0 m²'],
      ['Surface assujettie', avecUnite(a.surfaceAssujettie, 'm²')],
      [`Surface solarisable APER (${nombreFr(a.percentAPER, 1)} %)`, avecUnite(a.surfaceSolarisableAPER, 'm²')],
      [`Surface solarisable Huwart (${nombreFr(a.percentHuwart, 1)} %)`, avecUnite(a.surfaceSolarisableHuwart, 'm²')],
      ['Surface projetée des champs PV', avecUnite(a.surfaceProjeteeTotale, 'm²')],
      ['Taux de couverture de l\'objectif Huwart', a.surfaceSolarisableHuwart > 0 ? `${nombreFr((100 * a.surfaceProjeteeTotale) / a.surfaceSolarisableHuwart, 1)} %` : ''],
    ], { titre: 'Surfaces et objectifs', hLigne: 6 });
    // Verdict
    const ok = !!a.isConforme;
    pdf.setFillColor(...(ok ? [220, 252, 231] : [254, 226, 226]));
    pdf.setDrawColor(...(ok ? VERT : ACCENT));
    pdf.setLineWidth(0.3);
    pdf.roundedRect(x, y - 2, largeur, 9, 1.5, 1.5, 'FD');
    text(pdf, ok ? 'Conformité loi APER : objectif atteint' : 'Conformité loi APER : objectif non atteint',
      x + largeur / 2, y + 4, { size: 10, bold: true, align: 'center', color: ok ? VERT : ACCENT });
    y += 12;

    // Vue carte : même cadrage qu'un plan de masse, réduite à la largeur de la page.
    const c = cap.carte && cap.carte.aper;
    const pleine = contentZone('landscape');
    const w = largeur;
    const h = Math.min((w * pleine.h) / pleine.w, zone.y + zone.h - y - 4);
    const zc = { x, y, w: (h * pleine.w) / pleine.h, h };
    zc.x = x + (largeur - zc.w) / 2;
    let echelle = null;
    if (c && c.image) {
      pdf.addImage(c.image.dataUrl, 'JPEG', zc.x, zc.y, zc.w, zc.h, `omb_aper_${c.scale}`, 'NONE');
      const project = projector(zc, c.center, c.scale, c.georef);
      const reelle = echelleReelle(zc, c.georef);
      echelle = Math.round(reelle || (c.scale * pleine.w) / zc.w);
      withClip(pdf, zc, () => {
        a.surfaces.forEach((ring) => drawOutline(pdf, ring.map(project), { color: VERT, width: 0.5 }));
        a.exclusions.forEach((ring) => drawOutline(pdf, ring.map(project), { color: ACCENT, width: 0.5, dash: [1.5, 1] }));
        const ids = new Set(ctx.champsDossier.map((o) => o.sourceId));
        ctx.champs.filter((ch) => ids.has(ch.sourceId) && ch.contour.length >= 3)
          .forEach((ch) => drawOutline(pdf, ch.contour.map(project), { color: BLEU, width: 0.4 }));
      });
      drawScaleBar(pdf, zc, echelle);
      pdf.setDrawColor(...INK); pdf.setLineWidth(0.2); pdf.rect(zc.x, zc.y, zc.w, zc.h);
      const ly = zc.y + zc.h + 3.5;
      [[VERT, 'Surfaces assujetties'], [ACCENT, 'Exclusions'], [BLEU, st.profil.champs]].forEach(([col, lib], i) => {
        const lx = zc.x + i * 48;
        pdf.setDrawColor(...col); pdf.setLineWidth(0.6); pdf.line(lx, ly - 1, lx + 6, ly - 1);
        text(pdf, lib, lx + 8, ly, { size: 7.5, color: MUTED });
      });
    } else {
      placeholder(pdf, zc, 'Vue des surfaces APER indisponible.');
    }
    drawFrame(pdf, 'portrait', page(codes.aper, 'Loi APER', 'Assujettissement et objectif de solarisation', echelle ? `1/${echelle}` : null), ctx);
  },

  reglementation(builder, ctx, cap, st, codes) {
    const pdf = addPage(builder, 'portrait');
    pageReglementation(pdf, SECTIONS_REGLEMENTATION, st.data.reglementation.sections);
    drawFrame(pdf, 'portrait', page(codes.reglementation, 'Réglementation', 'Urbanisme, SDIS & sécurité, contraintes spécifiques du site'), ctx);
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
    mapPage(builder, { ...page(codes.calepinage_carte, 'Plan de calepinage', `Implantation ${st.profil.des} sur fond cadastral`), puissanceKwc: ctx.puissanceKwc }, ctx, c.masse,
      (pdf, project) => {
        if (ctx.parcelle) drawOutline(pdf, ctx.parcelle.ring.map(project), { width: 0.5, dash: [2, 1] });
        ctx.champs.forEach((champ) => {
          if (champ.contour.length >= 3) drawOutline(pdf, champ.contour.map(project), { color: BLEU, width: 0.4 });
        });
        const panneaux = ctx.panneaux.length ? ctx.panneaux : ctx.champs.flatMap((champ) => champ.panneaux);
        drawPanels(pdf, panneaux.map((p) => p.map(project)));
        ctx.cotations.forEach((cot) => drawCotation(pdf, project(cot.a), project(cot.b), `${nombreFr(cot.lengthM)} m`));
        etiquettesChamps(pdf, ctx, project);
      });
  },

  calepinage_canevas(builder, ctx, cap, st, codes) {
    ctx.champsDossier.forEach((c) => {
      const pc = cap.parChamp[c.sourceId] || {};
      const pdf = addPage(builder, 'a3');
      const zone = contentZone('a3');
      const img = pc.canevas;
      let echelle = 'sans échelle';
      if (img && img.pxParM > 0) {
        // Canevas posé à une échelle exacte : sa taille réelle (m) vient de ses pixels par mètre.
        const mW = img.width / img.pxParM;
        const mH = img.height / img.pxParM;
        const utile = { w: zone.w - 8, h: zone.h - 14 };
        const besoin = Math.max((mW * 1000) / utile.w, (mH * 1000) / utile.h);
        const n = ECHELLES_PLAN.find((e) => e >= besoin) || echelleAjustee(besoin);
        const w = (mW * 1000) / n;
        const h = (mH * 1000) / n;
        pdf.addImage(img.dataUrl, 'JPEG', zone.x + (zone.w - w) / 2, zone.y + 2 + (utile.h - h) / 2, w, h, `omb_canevas_${c.sourceId}`, 'NONE');
        barreEchelle(pdf, zone.x + 6, zone.y + zone.h - 5, n);
        echelle = `1/${n}`;
      } else if (img) {
        fitImage(pdf, img, zone, { padding: 4, alias: `omb_canevas_${c.sourceId}` });
      } else {
        placeholder(pdf, zone, `Plan de calepinage ${c.sourceId} indisponible.`);
      }
      drawFrame(pdf, 'a3', { ...page(codes.calepinage_canevas, `Plan de calepinage - ${c.sourceId}`, 'Disposition des panneaux - cotes en mètres', echelle), puissanceKwc: c.puissanceKwc }, ctx);
    });
  },

  vue_3d_projet(builder, ctx, cap, st, codes) {
    const pdf = addPage(builder, 'a3');
    const zone = contentZone('a3');
    if (cap.vue3dProjet) fitImage(pdf, cap.vue3dProjet, zone, { padding: 2, alias: 'omb_3d_projet' });
    else placeholder(pdf, zone, "Vue 3D du projet indisponible : ouvrez la vue 3D (bouton 3D de la carte), prenez une capture avec l'appareil photo, puis regénérez.");
    drawFrame(pdf, 'a3', page(codes.vue_3d_projet, 'Visualisation 3D du projet',
      `Ensemble ${st.profil.des} (${ctx.champsDossier.map((c) => c.sourceId).join(', ')}) - vue isométrique`, 'sans échelle'), ctx);
  },

  geometrie(builder, ctx, cap, st, codes) {
    // Une colonne par champ (5 au plus par page), une colonne Total sur la dernière page.
    const PAR_PAGE = 5;
    const lots = [];
    for (let i = 0; i < ctx.champsDossier.length; i += PAR_PAGE) lots.push(ctx.champsDossier.slice(i, i + PAR_PAGE));
    if (!lots.length) lots.push([]);
    const m = (v, dec = 2) => nombreFr(v, dec);
    const prod = (c) => (cap.parChamp[c.sourceId] || {}).production;
    // Total seulement si TOUS les champs ont leur production (un total partiel serait faux).
    const productionTotale = productionProjet(ctx, cap);
    const LIGNES = [
      ['Type de structure', (c, r) => (r && r.type) || c.libelleType],
      ['Modèle de poteaux', (c, r) => r && r.modele],
      ['Disposition des panneaux (L x C)', (c, r) => (r && r.valeurs.pvLayout) || c.pans.map((p) => p.disposition).filter(Boolean).join(' + ')],
      ['Longueur de façade (m)', (c, r) => r && m(r.valeurs.facadeLength)],
      ['Largeur du champ PV, rampant (m)', (c, r) => r && m(r.valeurs.panelWidth)],
      ['Pente des panneaux (°)', (c, r) => (r && r.valeurs.roofSlope !== '' ? m(r.valeurs.roofSlope, 1) : c.pans.map((p) => m(p.penteDeg, 1)).join(' / '))],
      ['Azimut (Sud = 0°, Ouest = +90°)', (c) => c.pans.map((p) => m(p.azimutDeg, 1)).join(' / ')],
      ['Hauteur structure à l\'égout (m)', (c, r) => r && m(r.valeurs.lowPointHeight)],
      ['Hauteur libre de passage (m)', (c, r) => r && m(r.valeurs.passageHeight)],
      ['Hauteur des poteaux (m)', (c, r) => r && m(r.valeurs.postHeight)],
      ['Porte-à-faux gauche / droit (m)', (c, r) => r && [r.valeurs.leftOverhang, r.valeurs.rightOverhang].every((v) => v != null && v !== '') ? `${m(r.valeurs.leftOverhang)} / ${m(r.valeurs.rightOverhang)}` : ''],
      ['Entraxes des poteaux (m)', (c, r) => r && (r.valeurs.postDistances || (r.entraxes || []).map((e) => m(e)).join(' + '))],
      ['Nombre de travées', (c, r) => r && r.nbTravees],
      ['Nombre de panneaux', (c) => c.nbPanneaux, (t) => t.nbPanneaux],
      ['Puissance crête (kWc)', (c) => m(c.puissanceKwc, 2), (t) => m(t.puissanceKwc, 2)],
      ['Surface des panneaux (m²)', (c) => m(c.surfacePanneauxM2, 1), (t) => m(t.surfacePanneauxM2, 1)],
      ['Surface projetée au sol (m²)', (c) => m(c.surfaceProjeteeM2, 1), (t) => m(t.surfaceProjeteeM2, 1)],
      ['Production annuelle (kWh/an)', (c) => { const p = prod(c); return p ? m(p.productionKwhAn, 0) : ''; },
        () => (productionTotale == null ? '' : m(productionTotale, 0))],
      ['Productible (kWh/kWc/an)', (c) => { const p = prod(c); return p ? m(p.productibleKwhKwc, 0) : ''; },
        (t) => (productionTotale == null || !(t.puissanceKwc > 0) ? '' : m(productionTotale / t.puissanceKwc, 0))],
      ["Perte d'ombrage proche (%)", (c) => { const p = prod(c); return p && p.perteOmbragePct != null ? m(p.perteOmbragePct, 1) : ''; }],
    ];
    // Lignes lues dans un configurateur (r) : sans aucun champ configurable (dossier toitures), retirées.
    const avecPlans = champsAvecPlans(ctx.champsDossier);
    const LIGNES_CONFIGURATEUR = new Set(['Modèle de poteaux', 'Longueur de façade (m)', 'Largeur du champ PV, rampant (m)',
      "Hauteur structure à l'égout (m)", 'Hauteur libre de passage (m)', 'Hauteur des poteaux (m)',
      'Porte-à-faux gauche / droit (m)', 'Entraxes des poteaux (m)', 'Nombre de travées']);
    const lignesRetenues = avecPlans.length ? LIGNES : LIGNES.filter(([lib]) => !LIGNES_CONFIGURATEUR.has(lib));
    lots.forEach((lot, k) => {
      const pdf = addPage(builder, 'landscape');
      const zone = contentZone('landscape');
      const dernier = k === lots.length - 1;
      const cols = lot.length + (dernier && ctx.champsDossier.length > 1 ? 1 : 0);
      const wLib = 72;
      const wCol = Math.min(48, (zone.w - 8 - wLib) / Math.max(cols, 1));
      const largeurs = [wLib, ...Array(cols).fill(wCol)];
      const entetes = ['', ...lot.map((c) => c.sourceId), ...(cols > lot.length ? ['Total'] : [])];
      const lignes = lignesRetenues.map(([lib, f, total]) => [
        lib,
        ...lot.map((c) => f(c, (cap.parChamp[c.sourceId] || {}).resume)),
        ...(cols > lot.length ? [total ? total(ctx) : ''] : []),
      ]);
      let y = zone.y + 8;
      const x = zone.x + (zone.w - largeurs.reduce((a, b) => a + b, 0)) / 2;
      y = grille(pdf, x, y, largeurs, entetes, lignes, { hLigne: 6.0 });
      const manquants = champsAvecPlans(lot).filter((c) => !(cap.parChamp[c.sourceId] || {}).resume).map((c) => c.sourceId);
      const sansConfigurateur = lot.filter((c) => !champsAvecPlans([c]).length).map((c) => c.sourceId);
      const note = [
        manquants.length
          ? `Valeurs du configurateur indisponibles pour ${manquants.join(', ')} : seules les données du calepinage sont reprises.`
          : (avecPlans.length ? 'Valeurs de structure lues dans le configurateur de chaque champ (dimensions issues du calepinage).' : ''),
        sansConfigurateur.length && avecPlans.length ? `${sansConfigurateur.join(', ')} : toiture, sans configurateur de structure.` : '',
        'Surfaces et puissances issues du calepinage.',
      ].filter(Boolean).join(' ');
      const noteProduction = noteSourceProduction(ctx, cap);
      text(pdf, note, x, Math.min(y, zone.y + zone.h - 8), { size: 7.5, color: MUTED, maxWidth: zone.w - 20 });
      text(pdf, noteProduction, x, Math.min(y + 4, zone.y + zone.h - 4), { size: 7.5, color: MUTED, maxWidth: zone.w - 20 });
      const suite = lots.length > 1 ? ` (${k + 1}/${lots.length})` : '';
      drawFrame(pdf, 'landscape', page(codes.geometrie, `Tableau géométrie${suite}`, `Caractéristiques géométriques ${st.profil.des}`), ctx);
    });
  },

  coupe(builder, ctx, cap, st, codes) {
    champsAvecPlans(ctx.champsDossier).forEach((c) => {
      const pc = cap.parChamp[c.sourceId] || {};
      planVectoriel(builder, page(codes.coupe, `Plan de coupe - ${c.sourceId}`, libelleChamp(c, pc.resume)), ctx,
        pc.plans && pc.plans.coupe, `Plan de coupe ${c.sourceId} indisponible : ouvrez son configurateur une fois puis regénérez.`);
    });
  },

  // Parcours Chiffrage : devis saisi dans l'application, même trame que le devis seul.
  devis(builder, ctx, cap) {
    dessinerPieceDevis(builder, addPage, cap.devis);
  },

  facade(builder, ctx, cap, st, codes) {
    champsAvecPlans(ctx.champsDossier).forEach((c) => {
      const pc = cap.parChamp[c.sourceId] || {};
      planVectoriel(builder, page(codes.facade, `Plan de façade - ${c.sourceId}`, `${libelleChamp(c, pc.resume)} - élévation, terrain et altimétrie`), ctx,
        pc.plans && pc.plans.facade, `Plan de façade ${c.sourceId} indisponible : ouvrez son configurateur une fois puis regénérez.`);
    });
  },
};

/** Liste ordonnée des pièces effectivement demandées (pieces : liste du profil, st.pieces). */
export function piecesOrdonnees(pieces, ids) {
  return pieces.filter((p) => ids.includes(p.id)).map((p) => p.id);
}

/**
 * PDF regroupant plusieurs pièces.
 * @param {string[]} bordereauIds dossier complet (numérotation et bordereau d'un PDF isolé du ZIP)
 */
export function buildPdf(ids, ctx, captures, dossier, bordereauIds = null) {
  const builder = { pdf: null };
  const ordre = piecesOrdonnees(dossier.pieces, ids);
  const complet = piecesOrdonnees(dossier.pieces, bordereauIds || ordre);
  const codes = codesPieces(complet);
  ordre.forEach((id) => R[id](builder, ctx, captures, dossier, codes, complet));
  if (!builder.pdf) throw new Error('Aucune pièce sélectionnée.');
  numeroterPages(builder.pdf);
  return builder.pdf;
}

export const NOMS_FICHIERS = {
  garde: '00_page_de_garde', presentation: 'presentation', aper: 'loi_aper', reglementation: 'reglementation',
  situation: 'plan_de_situation', calepinage_carte: 'plan_de_calepinage_carte', calepinage_canevas: 'plans_de_calepinage',
  vue_3d_projet: 'vue_3d_projet', geometrie: 'tableau_geometrie', coupe: 'plans_de_coupe', facade: 'plans_de_facade',
  devis: 'devis',
};

export function nomFichier(id, codes) {
  return codes[id] ? `${codes[id]}_${NOMS_FICHIERS[id]}` : NOMS_FICHIERS[id];
}
