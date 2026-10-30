/**
 * Mention « période d'essai gratuite » sur les documents générés dans le navigateur (jsPDF)
 * et sur les impressions HTML.
 *
 * Miroir de app/services/mention_essai.py (même texte, même mise en page) : texte vertical lu de
 * bas en haut, centré sur la hauteur de CHAQUE page, ligne de base à 3 mm du bord droit, donc dans
 * la marge — le contenu existant n'est ni recouvert ni déplacé.
 *
 * Chargé par le partiel templates/concevoir_mon_projet/components/mention_essai.html, à inclure
 * JUSTE APRÈS la balise <script> de jsPDF, qui fournit window.SOCALTS_MENTION_ESSAI
 * ({ active, texte }, décidé côté serveur : permission mention_periode_essai, jamais pour un admin).
 *
 * Point unique : quand la mention est active, le constructeur window.jspdf.jsPDF est enveloppé
 * pour que applyTrialWatermark(doc) s'exécute avant chaque doc.save()/doc.output(). Tous les
 * générateurs (rapport projet, DP, dossiers de plans, calepinage, câblage, pompage, hybride...)
 * construisent leur document via window.jspdf.jsPDF au moment de l'export : aucun ne peut
 * l'oublier, y compris un générateur ajouté plus tard. applyTrialWatermark est aussi exposée sur
 * window pour un appel explicite. Idempotente : une page déjà marquée ne l'est pas deux fois.
 */
(function () {
  'use strict';

  const MARGE_DROITE_MM = 3;
  const TAILLE_POLICE_PT = 6.5;
  const GRIS = 115; // 0,45 × 255, comme GRIS dans mention_essai.py

  function config() {
    if (window.SOCALTS_MENTION_ESSAI) return window.SOCALTS_MENTION_ESSAI;
    try {
      // Iframe dont le template n'inclurait pas le partiel : même origine, on reprend le parent.
      if (window.parent && window.parent !== window) return window.parent.SOCALTS_MENTION_ESSAI || {};
    } catch (e) { /* origine différente */ }
    return {};
  }

  function mentionActive() {
    const c = config();
    return Boolean(c.active && c.texte);
  }

  // Pages déjà marquées : on identifie une page par son tableau de contenu interne, ce qui reste
  // juste si le générateur réordonne ou supprime des pages (movePage/deletePage) entre deux sorties.
  const pagesMarquees = new WeakSet();

  function applyTrialWatermark(doc) {
    if (!mentionActive() || !doc || typeof doc.getNumberOfPages !== 'function') return doc;
    const texte = config().texte;
    const pages = doc.internal && doc.internal.pages;
    const nbPages = doc.getNumberOfPages();

    const pageCourante = doc.getCurrentPageInfo().pageNumber;
    const police = doc.getFont();
    const taille = doc.getFontSize();
    const couleur = doc.getTextColor();
    const mmVersUnite = 72 / 25.4 / doc.internal.scaleFactor;

    for (let i = 1; i <= nbPages; i++) {
      const contenu = pages && pages[i];
      if (contenu && pagesMarquees.has(contenu)) continue;
      doc.setPage(i);
      // Taille lue page par page : un même document mêle portrait et paysage (A4/A3).
      const largeur = doc.internal.pageSize.getWidth();
      const hauteur = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(TAILLE_POLICE_PT);
      doc.setTextColor(GRIS);
      const longueur = doc.getTextWidth(texte);
      // angle 90 : le texte monte depuis (x, y) ; on part sous le milieu pour le centrer.
      doc.text(texte, largeur - MARGE_DROITE_MM * mmVersUnite, (hauteur + longueur) / 2, { angle: 90 });
      if (contenu) pagesMarquees.add(contenu);
    }

    doc.setFont(police.fontName, police.fontStyle);
    doc.setFontSize(taille);
    doc.setTextColor(couleur);
    doc.setPage(pageCourante);
    return doc;
  }

  function instrumenter(doc) {
    ['save', 'output'].forEach((nom) => {
      const original = doc[nom];
      if (typeof original !== 'function') return;
      doc[nom] = function () {
        applyTrialWatermark(this);
        return original.apply(this, arguments);
      };
    });
    return doc;
  }

  function installer() {
    const ns = window.jspdf;
    if (!ns || typeof ns.jsPDF !== 'function') return false;
    if (ns.jsPDF.__mentionEssai) return true;
    const Original = ns.jsPDF;
    function jsPDF() {
      return instrumenter(new Original(...arguments));
    }
    // Même prototype (instanceof, plugins type autoTable posés sur jsPDF.API) et mêmes membres
    // statiques (API, version...) que le constructeur d'origine.
    jsPDF.prototype = Original.prototype;
    Object.getOwnPropertyNames(Original).forEach((cle) => {
      if (['prototype', 'length', 'name', 'arguments', 'caller'].includes(cle)) return;
      try { jsPDF[cle] = Original[cle]; } catch (e) { /* propriété non modifiable */ }
    });
    jsPDF.__mentionEssai = true;
    ns.jsPDF = jsPDF;
    if (ns.default === Original) ns.default = jsPDF;
    if (window.jsPDF === Original) window.jsPDF = jsPDF;
    return true;
  }

  // Impressions HTML (window.print) : bandeau fixe, répété par le navigateur sur chaque page
  // imprimée, invisible à l'écran.
  const CSS_IMPRESSION =
    '#socalts-mention-essai{display:none}' +
    '@media print{#socalts-mention-essai{display:block;position:fixed;right:1mm;top:50%;' +
    'transform:translateY(-50%) rotate(180deg);writing-mode:vertical-rl;white-space:nowrap;' +
    'font:6.5pt Helvetica,Arial,sans-serif;color:#737373;z-index:2147483647}}';

  function installerImpression() {
    if (document.getElementById('socalts-mention-essai')) return;
    const style = document.createElement('style');
    style.textContent = CSS_IMPRESSION;
    const bandeau = document.createElement('div');
    bandeau.id = 'socalts-mention-essai';
    bandeau.textContent = config().texte;
    document.head.appendChild(style);
    document.body.appendChild(bandeau);
  }

  // Même bandeau, en HTML, pour une page écrite dans une nouvelle fenêtre (document.write) avant
  // impression (ex. Irve/analyse_eco_irve.js). Chaîne vide si la mention ne s'applique pas.
  function trialWatermarkPrintHtml() {
    if (!mentionActive()) return '';
    const echappe = document.createElement('div');
    echappe.textContent = config().texte;
    return '<style>' + CSS_IMPRESSION + '</style><div id="socalts-mention-essai">' + echappe.innerHTML + '</div>';
  }

  window.applyTrialWatermark = applyTrialWatermark;
  window.trialWatermarkPrintHtml = trialWatermarkPrintHtml;
  // À rappeler par un module qui charge jsPDF dynamiquement (ex. repli de main_autoconso.js).
  window.installTrialWatermark = function () { return mentionActive() && installer(); };
  if (!mentionActive()) return;

  if (!installer()) {
    // jsPDF chargé après ce script : on réessaie une fois le document analysé.
    document.addEventListener('DOMContentLoaded', installer);
  }
  if (document.body) installerImpression();
  else document.addEventListener('DOMContentLoaded', installerImpression);
})();
