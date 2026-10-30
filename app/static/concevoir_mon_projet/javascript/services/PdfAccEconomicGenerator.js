/**
 * PdfAccEconomicGenerator - Étude économique de l'autoconsommation collective (ACC) dans le rapport
 * projet. Remplace PdfEconomicStudyGenerator (étude éco Grand projet, non utilisée en ACC) quand le
 * projet est en autoconsommation collective (cf. ExportService.isProjetAcc).
 *
 * Source : localStorage.solarProjectData.economicDataACC, écrit par le modal Résultats
 * (prodsolaire/main_autoconso.js::persisterIndicateursEcoAcc) à chaque analyse économique ACC
 * valide — même calcul que l'écran (prodsolaire/main_rentabilite.js), aucun recalcul ici.
 */

import PdfUtilities from './PdfUtilities.js';

const ENTETE_TABLEAU = { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' };

// toLocaleString('fr-FR') produit des espaces insécables (U+202F/U+00A0) que la police helvetica de
// jsPDF n'affiche pas : remplacés par une espace simple (même correctif que PdfAutoconsoGenerator).
const nb = (v, dec = 0) => (v === null || v === undefined || !isFinite(Number(v)))
  ? 'N/A'
  : Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).replace(/[  ]/g, ' ');
const euros = (v) => (nb(v) === 'N/A' ? 'N/A' : `${nb(v)} €`);
const pct = (v) => (nb(v, 2) === 'N/A' ? 'N/A' : `${nb(v, 2)} %`);
const ans = (v) => (v === null || v === undefined || !isFinite(Number(v)) || Number(v) <= 0 ? 'Non atteint' : `${nb(v, 1)} ans`);

export default class PdfAccEconomicGenerator {
  constructor() {
    this.marginTop = 35;
    this.marginBottom = 35; // Marge pour éviter les pieds de page
  }

  lireDonnees() {
    try {
      const data = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
      const acc = data.economicDataACC;
      return acc && acc.resultats && acc.resultats.producteur ? acc : null;
    } catch (e) {
      console.warn('⚠️ Étude économique ACC illisible :', e);
      return null;
    }
  }

  checkSpace(doc, currentY, requiredSpace) {
    if (currentY + requiredSpace > doc.internal.pageSize.height - this.marginBottom) {
      doc.addPage('a4', 'portrait');
      return this.marginTop + 10;
    }
    return currentY;
  }

  titreSection(doc, texte, yPos) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(texte, 15, yPos);
    doc.setFont('helvetica', 'normal');
    return yPos + 5;
  }

  tableau(doc, yPos, head, body, columnStyles = {}) {
    doc.autoTable({
      startY: yPos,
      head: [head],
      body,
      theme: 'grid',
      styles: { fontSize: 9, halign: 'center' },
      headStyles: ENTETE_TABLEAU,
      columnStyles,
      margin: { left: 15, right: 15, top: this.marginTop, bottom: this.marginBottom },
    });
    return doc.lastAutoTable.finalY + 12;
  }

  async addAccEconomicStudy(doc) {
    console.log('💰 Ajout de l\'Étude Économique ACC...');
    const acc = this.lireDonnees();
    if (!acc) {
      console.warn('⚠️ Étude économique ACC non réalisée - section non ajoutée');
      return;
    }
    const prod = acc.resultats.producteur;
    const participants = acc.resultats.participants || {};
    const p = acc.parametres || {};
    const e = acc.energie || {};
    const horizon = parseInt(p.horizon, 10) || (prod.financial_table || []).length || 20;

    // --- PAGE 1 : synthèse, hypothèses, indicateurs producteur ---
    doc.addPage('a4', 'portrait');
    let yPos = this.marginTop + 10;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Étude économique - Autoconsommation collective', 15, yPos);
    yPos += 10;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const intro = `La modélisation financière de l'opération d'autoconsommation collective est réalisée sur ${horizon} ans, `
      + `pour ${Object.keys(participants).length} participant(s). Le producteur vend l'énergie partagée aux participants au prix `
      + `de vente interne ACC et le surplus au réseau.`;
    doc.text(intro, 15, yPos, { maxWidth: 180, align: 'justify' });
    yPos += doc.splitTextToSize(intro, 180).length * 5 + 8;

    yPos = this.titreSection(doc, "Bilan énergétique de l'opération (année 1)", yPos);
    yPos = this.tableau(doc, yPos, ['Indicateur', 'Valeur'], [
      ['Puissance crête', e.puissance_kwc != null ? `${nb(e.puissance_kwc, 2)} kWc` : 'N/A'],
      ['Production PV', `${nb(e.production_mwh, 2)} MWh`],
      ['Consommation des participants', `${nb(e.consommation_mwh, 2)} MWh`],
      ['Production autoconsommée (partagée)', `${nb(e.pv_consomme_mwh, 2)} MWh`],
      ['Surplus injecté', `${nb(e.surplus_mwh, 2)} MWh`],
      ["Taux d'autoconsommation", pct(e.taux_autoconsommation)],
      ["Taux d'autoproduction", pct(e.taux_autoproduction)],
    ]);

    yPos = this.checkSpace(doc, yPos, 70);
    yPos = this.titreSection(doc, 'Indicateurs financiers du producteur', yPos);
    yPos = this.tableau(doc, yPos, ['Indicateur', 'Valeur'], [
      ['VAN projet', euros(prod.van_projet)],
      ['TRI projet', pct(prod.tri_projet)],
      ['TRI fonds propres', pct(prod.tri_equity)],
      ['Temps de retour brut', ans(prod.temps_retour_brut)],
      ['Temps de retour actualisé', ans(prod.temps_retour_actualise)],
      ['DSCR moyen', nb(prod.dscr_moyen, 2)],
      ['LCOE production', prod.lcoe_production != null ? `${nb(prod.lcoe_production, 2)} €/MWh` : 'N/A'],
      ['Revenu annuel (an 1)', euros(prod.revenu_total_annuel)],
      [`Revenu total sur ${horizon} ans`, euros(prod.revenu_total_horizon)],
    ]);

    yPos = this.checkSpace(doc, yPos, 90);
    yPos = this.titreSection(doc, 'Hypothèses financières', yPos);
    const amort = p.depreciation_method === 'declining'
      ? `Dégressif sur ${p.depreciation_period} ans (coeff. ${p.declining_coefficient})`
      : `Linéaire sur ${p.depreciation_period} ans`;
    const onduleur = p.inverter_replacement_enabled
      ? `Année ${p.inverter_replacement_year}, ${nb(p.inverter_replacement_cost_wc, 2)} €/Wc` : 'Non inclus';
    const ig = p.inflation_grid_price || {};
    yPos = this.tableau(doc, yPos, ['Hypothèse', 'Valeur', 'Hypothèse', 'Valeur'], [
      ["Horizon d'étude", `${horizon} ans`, "Taux d'actualisation", pct(p.discount_rate)],
      ['CAPEX', `${nb(p.capex_wc, 2)} €/Wc`, "Subvention d'investissement", euros(p.investment_subsidy)],
      ['OPEX projet', `${nb(p.opex_projet_wc, 3)} €/Wc/an`, 'OPEX gestion ACC', `${nb(p.opex_gestion_acc_wc, 3)} €/Wc/an`],
      ['Loyer annuel', euros(p.loyer), "Taux d'imposition", pct(p.tax_rate)],
      ['Amortissement', amort, 'Remplacement onduleur', onduleur],
      ['Part de fonds propres', pct(p.equity_share), 'Prêt', `${pct(p.loan_interest)} sur ${p.loan_maturity} ans`],
      ['Dégradation PV', `${nb(p.pv_degradation_rate, 2)} %/an`, 'Inflation OPEX', pct(p.inflation_opex)],
      ['Inflation prix interne ACC', pct(p.inflation_acc_price), 'Inflation prix surplus', pct(p.inflation_surplus_price)],
      ['Prix de vente du surplus', `${nb(p.prix_vente_surplus, 3)} €/kWh`, 'Inflation prix réseau',
        Object.entries(ig).filter(([k]) => k !== 'Collectivité').map(([k, v]) => `${k} ${nb(v, 1)} %`).join(', ') || 'N/A'],
    ], { 0: { halign: 'left' }, 2: { halign: 'left' } });

    // Le « Périmètre de l'opération » n'est plus ici : ExportService l'insère juste avant le plan de
    // calepinage (cf. addPerimetre).

    // --- PAGE 2 : bilan des participants ---
    doc.addPage('a4', 'portrait');
    yPos = this.marginTop + 10;
    yPos = this.titreSection(doc, 'Bilan économique des participants (année 1)', yPos);
    const lignes = Object.entries(participants).map(([nom, r]) => [
      nom, r.profil || '-',
      r.prix_achat != null ? nb(r.prix_achat, 3) : '-', r.prix_vente_interne != null ? nb(r.prix_vente_interne, 3) : '-',
      `${nb(r.consommation_mwh, 1)}`, pct(r.taux_autoproduction),
      euros(r.cout_sans_acc), euros(r.cout_avec_acc), euros(r.economie_annuelle), euros(r.economie_totale_horizon),
    ]);
    const total = (k) => Object.values(participants).reduce((s, r) => s + (Number(r[k]) || 0), 0);
    lignes.push(['Total', '', '', '', nb(total('consommation_mwh'), 1), '',
      euros(total('cout_sans_acc')), euros(total('cout_avec_acc')), euros(total('economie_annuelle')), euros(total('economie_totale_horizon'))]);
    yPos = this.tableau(doc, yPos,
      ['Participant', 'Profil', 'Achat réseau (€/kWh)', 'Vente interne (€/kWh)', 'Conso. (MWh)', 'Autoprod.',
        'Facture sans ACC', 'Facture avec ACC', 'Économie an 1', `Économie ${horizon} ans`],
      lignes, { 0: { halign: 'left' } });
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text("Facture avec ACC = énergie soutirée au réseau au prix d'achat réseau + énergie partagée au prix de vente interne ACC.", 15, yPos - 6, { maxWidth: 180 });
    doc.setTextColor(0, 0, 0);

    const img = await this.graphiqueFactures(participants);
    if (img) {
      yPos = this.checkSpace(doc, yPos, 95);
      yPos = this.titreSection(doc, 'Comparaison des factures annuelles (€)', yPos);
      PdfUtilities.safeAddImage(doc, img, 'PNG', 15, yPos, 180, 85);
      yPos += 95;
    }

    // --- PAGE 3 : flux financiers ---
    const flux = prod.financial_table || [];
    if (flux.length) {
      doc.addPage('a4', 'portrait');
      yPos = this.marginTop + 10;
      yPos = this.titreSection(doc, 'Tableau des flux financiers annuels du producteur', yPos);
      yPos = this.tableau(doc, yPos,
        ['Année', 'Revenus', 'OPEX', 'EBITDA', 'Amort.', 'Intérêts', 'Impôt', 'Flux projet', 'Flux actualisé'],
        flux.map((f) => [f.annee, nb(f.revenu), nb(f.opex), nb(f.ebitda), nb(f.amortissement), nb(f.interets), nb(f.impot), nb(f.flux_projet), nb(f.flux_projet_actualise)]));
      doc.setFontSize(9);
      doc.setTextColor(90, 90, 90);
      doc.text('Montants en euros.', 15, yPos - 6);
      doc.setTextColor(0, 0, 0);

      const imgFlux = await this.graphiqueTresorerie(prod);
      if (imgFlux) {
        yPos = this.checkSpace(doc, yPos, 95);
        yPos = this.titreSection(doc, 'Évolution des flux de trésorerie cumulés du projet (€)', yPos);
        PdfUtilities.safeAddImage(doc, imgFlux, 'PNG', 15, yPos, 180, 85);
      }
    }
  }

  /**
   * Page « Périmètre de l'opération » : plan de situation des participants et contrôle réglementaire,
   * depuis solarProjectData.accPerimetre (carte des participants de la page calepinage,
   * components/acc_participants/acc_participants_carte.js). Plan vectoriel dessiné à partir des
   * coordonnées (pas de capture des tuiles Google, bloquée par CORS).
   */
  async addPerimetre(doc) {
    let per = null;
    try { per = JSON.parse(localStorage.getItem('solarProjectData') || '{}').accPerimetre || null; } catch (e) { /* ignoré */ }
    if (!per || !per.producteur) return;
    const participants = (per.participants || []);
    doc.addPage('a4', 'portrait');
    let yPos = this.marginTop + 10;
    yPos = this.titreSection(doc, "Périmètre de l'opération d'autoconsommation collective", yPos) + 3;

    // Carte sur fond orthophoto IGN ; repli sur le plan vectoriel si les tuiles sont indisponibles
    // (hors couverture IGN, réseau, CORS).
    const carte = await this.carteOrthophoto(per);
    const img = carte || this.planSituation(per);
    if (img) {
      PdfUtilities.safeAddImage(doc, img, carte ? 'JPEG' : 'PNG', 25, yPos, 160, 128);
      yPos += 134;
    }
    const conf = (v) => (v === null || v === undefined ? 'Non vérifiable' : v ? 'Conforme' : 'Non conforme');
    yPos = this.tableau(doc, yPos, ['Critère', 'Valeur'], [
      ["Type d'opération", `${per.libelle || '-'}${per.derogation ? ' (sur dérogation)' : ''}`],
      ['Plus grande distance entre participants', per.distanceMaxKm != null
        ? `${nb(per.distanceMaxKm, 2)} km${per.paireMax ? ` (${per.paireMax.join(' - ')})` : ''}` : 'N/A'],
      ['Limite de distance', per.distanceLimiteKm ? `${per.distanceLimiteKm} km - ${conf(per.conformeDistance)}` : "Territoire de l'EPCI - non vérifiable"],
      ['Puissance crête', per.puissanceKwc != null ? `${nb(per.puissanceKwc, 1)} kWc - limite < ${per.puissanceLimiteMw} MW - ${conf(per.conformePuissance)}` : 'N/A'],
      ['Participants non localisés', String(per.nonLocalises || 0)],
    ], { 0: { halign: 'left' }, 1: { halign: 'left' } });

    const dist = (p) => {
      if (p.lat == null || p.lng == null) return 'non localisé';
      const R = 6371008.8, rad = Math.PI / 180, a = per.producteur;
      const h = Math.sin((p.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(p.lat * rad) * Math.sin((p.lng - a.lng) * rad / 2) ** 2;
      return `${nb(2 * R * Math.asin(Math.sqrt(h)) / 1000, 2)} km`;
    };
    if (participants.length) {
      yPos = this.checkSpace(doc, yPos, 40);
      this.tableau(doc, yPos, ['N°', 'Participant', 'Adresse', 'Distance au producteur'],
        [['P', 'Producteur', per.producteur.adresse || '-', '-'],
          ...participants.map((p, i) => [String(i + 1), p.nom, p.adresse || '-', dist(p)])],
        { 1: { halign: 'left' }, 2: { halign: 'left' } });
    }
  }

  /**
   * Carte des participants sur fond orthophoto IGN (Géoplateforme, WMTS Web Mercator, CORS ouvert —
   * data.geopf.fr est déjà autorisé par la CSP), cadrée sur les participants, avec cercles 2 / 10 / 20 km, plus grande distance, échelle, nord et attribution.
   * @returns {Promise<string|null>} image JPEG (data URL), ou null si le fond n'a pas pu être chargé.
   */
  async carteOrthophoto(per) {
    const L = 1000, H = 800, TUILE = 256, CIRC = 40075016.686;
    const o = per.producteur;
    const pts = (per.participants || []).map((p, i) => ({ ...p, i })).filter((p) => p.lat != null && p.lng != null);
    const versPx = (lat, lng, z) => {
      const n = TUILE * 2 ** z, s = Math.sin(lat * Math.PI / 180);
      return { x: (lng + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
    };
    const distM = (a, b) => {
      const R = 6371008.8, rad = Math.PI / 180;
      const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    // Demi-largeur visible (m) : cadrage sur les participants (le plus éloigné + marge, 400 m au
    // moins) pour que les pastilles restent lisibles ; les cercles sortent du cadre au besoin.
    const demi = Math.max(400, ...pts.map((p) => distM(o, p) * 1.35));
    const mParPxZ0 = CIRC * Math.cos(o.lat * Math.PI / 180) / TUILE;
    const z = Math.max(5, Math.min(18, Math.floor(Math.log2(mParPxZ0 * (Math.min(L, H) / 2) / demi))));
    const mParPx = mParPxZ0 / 2 ** z;
    const centre = versPx(o.lat, o.lng, z);
    const x0 = centre.x - L / 2, y0 = centre.y - H / 2;

    const canvas = document.createElement('canvas');
    canvas.width = L; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e5e7eb'; ctx.fillRect(0, 0, L, H);

    const chargerTuile = (tx, ty) => new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const minuterie = setTimeout(() => resolve(null), 8000);
      img.onload = () => { clearTimeout(minuterie); resolve(img); };
      img.onerror = () => { clearTimeout(minuterie); resolve(null); };
      img.src = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
        + '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg'
        + `&TILEMATRIX=${z}&TILEROW=${ty}&TILECOL=${tx}`;
    });
    const taches = [];
    for (let tx = Math.floor(x0 / TUILE); tx <= Math.floor((x0 + L) / TUILE); tx++) {
      for (let ty = Math.floor(y0 / TUILE); ty <= Math.floor((y0 + H) / TUILE); ty++) {
        taches.push(chargerTuile(tx, ty).then((img) => {
          if (img) ctx.drawImage(img, tx * TUILE - x0, ty * TUILE - y0, TUILE, TUILE);
          return !!img;
        }));
      }
    }
    const charges = (await Promise.all(taches)).filter(Boolean).length;
    if (charges < taches.length / 2) return null;

    const ecran = (p) => { const q = versPx(p.lat, p.lng, z); return { x: q.x - x0, y: q.y - y0 }; };
    const P = ecran(o);
    const couleurs = { 2000: '#22c55e', 10000: '#f59e0b', 20000: '#ef4444' };
    ctx.font = 'bold 20px Helvetica, Arial, sans-serif';
    [2000, 10000, 20000].forEach((r) => {
      const rp = r / mParPx;
      if (rp > Math.hypot(L, H)) return; // cercle entièrement hors du cadre
      ctx.beginPath(); ctx.arc(P.x, P.y, rp, 0, 2 * Math.PI);
      ctx.lineWidth = 4; ctx.strokeStyle = couleurs[r]; ctx.stroke();
      const lx = P.x + rp * 0.7, ly = P.y - rp * 0.7;
      if (lx > 0 && lx < L - 70 && ly > 20 && ly < H) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(lx + 4, ly - 20, 66, 26);
        ctx.fillStyle = couleurs[r]; ctx.fillText(`${r / 1000} km`, lx + 10, ly);
      }
    });
    if (per.paireMax && per.paireMax.length === 2) {
      const trouver = (nom) => (nom === 'Producteur' ? o : pts.find((p) => p.nom === nom));
      const a = trouver(per.paireMax[0]), b = trouver(per.paireMax[1]);
      if (a && b) {
        const A = ecran(a), B = ecran(b);
        ctx.setLineDash([14, 9]); ctx.lineWidth = 4;
        ctx.strokeStyle = per.conformeDistance === false ? '#ef4444' : '#ffffff';
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
        const texte = `${String(per.distanceMaxKm).replace('.', ',')} km`;
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        ctx.fillStyle = 'rgba(17,24,39,0.85)'; ctx.fillRect(mx + 8, my - 30, ctx.measureText(texte).width + 16, 30);
        ctx.fillStyle = '#ffffff'; ctx.fillText(texte, mx + 16, my - 8);
      }
    }
    const pastille = (x, y, texte, couleur) => {
      ctx.beginPath(); ctx.arc(x, y, 17, 0, 2 * Math.PI); ctx.fillStyle = couleur; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 18px Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(texte, x, y);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = 'bold 20px Helvetica, Arial, sans-serif';
    };
    pts.forEach((p) => { const e = ecran(p); pastille(e.x, e.y, String(p.i + 1), '#2563eb'); });
    pastille(P.x, P.y, 'P', '#ef4444');

    // Échelle (longueur « ronde » ~1/5 de la largeur), nord, attribution.
    const cible = (L / 5) * mParPx;
    const pas = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].reduce((m, v) => (v <= cible ? v : m), 100);
    const lp = pas / mParPx;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(16, H - 66, lp + 28, 50);
    ctx.fillStyle = '#111827'; ctx.fillRect(30, H - 32, lp, 7);
    ctx.font = 'bold 18px Helvetica, Arial, sans-serif';
    ctx.fillText(pas >= 1000 ? `${pas / 1000} km` : `${pas} m`, 30, H - 42);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(L - 66, 14, 50, 82);
    ctx.fillStyle = '#111827';
    ctx.beginPath(); ctx.moveTo(L - 41, 22); ctx.lineTo(L - 54, 58); ctx.lineTo(L - 28, 58); ctx.closePath(); ctx.fill();
    ctx.fillText('N', L - 48, 86);
    ctx.font = '14px Helvetica, Arial, sans-serif';
    const attribution = '© IGN - Géoplateforme (orthophotographies)';
    const la = ctx.measureText(attribution).width;
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(L - la - 18, H - 24, la + 18, 24);
    ctx.fillStyle = '#111827'; ctx.fillText(attribution, L - la - 9, H - 7);

    try {
      return canvas.toDataURL('image/jpeg', 0.9);
    } catch (e) {
      console.warn('⚠️ Carte ACC : fond non exportable (CORS), repli sur le plan :', e);
      return null;
    }
  }

  planSituation(per) {
    try {
      const L = 1000, H = 800, canvas = document.createElement('canvas');
      canvas.width = L; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const o = per.producteur, rad = Math.PI / 180;
      const versXY = (p) => ({ x: (p.lng - o.lng) * 111320 * Math.cos(o.lat * rad), y: (p.lat - o.lat) * 110574 }); // mètres
      const pts = (per.participants || []).map((p, i) => ({ ...p, i })).filter((p) => p.lat != null && p.lng != null);
      const rayons = [2000, 10000, 20000];
      const portee = Math.max(...pts.map((p) => Math.hypot(versXY(p).x, versXY(p).y)), 1000);
      // Échelle : tous les participants visibles, et les cercles jusqu'au premier rayon qui les englobe.
      const rayonMax = rayons.find((r) => r >= portee) || Math.max(portee, 20000);
      const echelle = (Math.min(L, H) / 2 - 40) / rayonMax;
      const cx = L / 2, cy = H / 2;
      const ecran = (p) => { const m = versXY(p); return { x: cx + m.x * echelle, y: cy - m.y * echelle }; };

      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, L, H);
      ctx.strokeStyle = '#e5e7eb'; ctx.strokeRect(0.5, 0.5, L - 1, H - 1);
      const couleurs = { 2000: '#16a34a', 10000: '#f59e0b', 20000: '#dc2626' };
      ctx.font = '18px Helvetica, Arial, sans-serif';
      rayons.filter((r) => r <= rayonMax).forEach((r) => {
        ctx.beginPath(); ctx.arc(cx, cy, r * echelle, 0, 2 * Math.PI);
        ctx.strokeStyle = couleurs[r]; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = couleurs[r]; ctx.fillText(`${r / 1000} km`, cx + r * echelle * 0.72 + 6, cy - r * echelle * 0.72 - 6);
      });
      if (per.paireMax && per.paireMax.length === 2) {
        const trouver = (nom) => (nom === 'Producteur' ? o : pts.find((p) => p.nom === nom));
        const a = trouver(per.paireMax[0]), b = trouver(per.paireMax[1]);
        if (a && b) {
          const A = ecran(a), B = ecran(b);
          ctx.setLineDash([12, 8]); ctx.strokeStyle = per.conformeDistance === false ? '#dc2626' : '#111827'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#111827'; ctx.fillText(`${String(per.distanceMaxKm).replace('.', ',')} km`, (A.x + B.x) / 2 + 8, (A.y + B.y) / 2 - 8);
        }
      }
      const pastille = (x, y, texte, couleur) => {
        ctx.beginPath(); ctx.arc(x, y, 15, 0, 2 * Math.PI); ctx.fillStyle = couleur; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 16px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(texte, x, y); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = '18px Helvetica, Arial, sans-serif';
      };
      pts.forEach((p) => { const e = ecran(p); pastille(e.x, e.y, String(p.i + 1), '#2563eb'); });
      pastille(cx, cy, 'P', '#ef4444');
      // Barre d'échelle (1 km, ou 5 km si l'échelle est large) et nord.
      const pas = rayonMax > 5000 ? 5000 : 1000;
      ctx.fillStyle = '#111827'; ctx.fillRect(30, H - 40, pas * echelle, 6);
      ctx.fillText(`${pas / 1000} km`, 30, H - 50);
      ctx.beginPath(); ctx.moveTo(L - 40, 30); ctx.lineTo(L - 52, 62); ctx.lineTo(L - 28, 62); ctx.closePath(); ctx.fill();
      ctx.fillText('N', L - 46, 84);
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('⚠️ Plan de situation ACC non généré :', e);
      return null;
    }
  }

  async chargerChartJs() {
    if (typeof Chart !== 'undefined') return true;
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  async rendreGraphique(config) {
    if (!(await this.chargerChartJs())) return null;
    const conteneur = document.createElement('div');
    conteneur.style.cssText = 'width:900px;height:430px;position:fixed;left:-9999px;';
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 430;
    conteneur.appendChild(canvas);
    document.body.appendChild(conteneur);
    try {
      config.options = Object.assign({ responsive: false, animation: false }, config.options || {});
      config.options.plugins = Object.assign({ datalabels: { display: false } }, config.options.plugins || {});
      const chart = new Chart(canvas, config);
      await new Promise((r) => setTimeout(r, 300));
      const img = canvas.toDataURL('image/png');
      chart.destroy();
      return img;
    } catch (err) {
      console.warn('⚠️ Graphique ACC non généré :', err);
      return null;
    } finally {
      document.body.removeChild(conteneur);
    }
  }

  graphiqueFactures(participants) {
    const noms = Object.keys(participants);
    if (!noms.length) return null;
    return this.rendreGraphique({
      type: 'bar',
      data: {
        labels: noms,
        datasets: [
          { label: 'Facture sans ACC', data: noms.map((n) => participants[n].cout_sans_acc || 0), backgroundColor: 'rgba(239, 68, 68, 0.8)' },
          { label: 'Facture avec ACC', data: noms.map((n) => participants[n].cout_avec_acc || 0), backgroundColor: 'rgba(30, 132, 73, 0.8)' },
        ],
      },
      options: { plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true, title: { display: true, text: '€ / an' } } } },
    });
  }

  graphiqueTresorerie(prod) {
    const cumul = prod.cumulative_cash_flows || [];
    if (!cumul.length) return null;
    const datasets = [{ label: 'Flux cumulés', data: cumul, borderColor: 'rgba(37, 99, 235, 1)', backgroundColor: 'rgba(37, 99, 235, 0.15)', fill: true, tension: 0.2 }];
    if ((prod.cumulative_discounted_cash_flows || []).length) {
      datasets.push({ label: 'Flux cumulés actualisés', data: prod.cumulative_discounted_cash_flows, borderColor: 'rgba(245, 158, 11, 1)', fill: false, tension: 0.2 });
    }
    return this.rendreGraphique({
      type: 'line',
      data: { labels: cumul.map((_, i) => `An ${i}`), datasets },
      options: { plugins: { legend: { position: 'top' } }, scales: { y: { title: { display: true, text: '€' } } } },
    });
  }
}
