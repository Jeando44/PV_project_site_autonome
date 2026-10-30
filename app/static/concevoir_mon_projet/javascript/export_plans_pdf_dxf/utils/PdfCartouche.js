/**
 * Cadre (3mm de retrait) + cartouche (angle inférieur droit) communs à tous les
 * plans PDF (A3 paysage) - nom projet, nom plan, indice, échelle, date, adresse,
 * logo entreprise. Factorisé pour que tous les plans partagent exactement la même
 * mise en page et la même logique d'import du logo.
 */
const PAGE_W_MM = 420;
const PAGE_H_MM = 297;
const MARGIN_MM = 3;
const VIEWPORT_W_MM = PAGE_W_MM - 2 * MARGIN_MM;
const VIEWPORT_H_MM = PAGE_H_MM - 2 * MARGIN_MM;
const CARTOUCHE_W_MM = 90;
const CARTOUCHE_H_MM = 45;

export default class PdfCartouche {
  static PAGE_W_MM = PAGE_W_MM;
  static PAGE_H_MM = PAGE_H_MM;
  static MARGIN_MM = MARGIN_MM;
  static VIEWPORT_W_MM = VIEWPORT_W_MM;
  static VIEWPORT_H_MM = VIEWPORT_H_MM;
  // NOUVEAU (demande explicite, schéma unifilaire : "il ne faut pas que les dessins tombent sur le
  // cartouche — remonter tout le bloc du dessin s'il n'y a plus d'espace") : exposées pour que
  // l'appelant puisse calculer lui-même si son contenu chevauche la zone du cartouche AVANT de le
  // dessiner, sans dupliquer ces valeurs (risque de désynchronisation si drawCartouche change un
  // jour de taille).
  static CARTOUCHE_W_MM = CARTOUCHE_W_MM;
  static CARTOUCHE_H_MM = CARTOUCHE_H_MM;

  // CORRECTIF (réutilisation pour le schéma unifilaire, page A4 OU A3 au choix) : pageWMm/pageHMm/
  // marginMm sont désormais paramétrables, avec les mêmes valeurs par défaut qu'avant (A3 paysage,
  // 420x297, marge 3mm) — tous les appelants existants (plan_situation.js, plan_de_masse.js), qui
  // n'en passent aucun, gardent donc un comportement strictement identique.
  static drawCadre(pdf, pageWMm = PAGE_W_MM, pageHMm = PAGE_H_MM, marginMm = MARGIN_MM) {
    const viewportW = pageWMm - 2 * marginMm;
    const viewportH = pageHMm - 2 * marginMm;
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.3);
    pdf.rect(marginMm, marginMm, viewportW, viewportH);
  }

  // CORRECTIF (schéma unifilaire : logo à droite du texte plutôt qu'à gauche) : logoOnRight est
  // désormais paramétrable, avec 'false' par défaut — comportement STRICTEMENT inchangé pour tout
  // appelant existant (plan_situation.js, plan_de_masse.js...) qui n'en passe pas.
  static drawCartouche(pdf, cartouche, scale, pageWMm = PAGE_W_MM, pageHMm = PAGE_H_MM, marginMm = MARGIN_MM, logoOnRight = false) {
    const x0 = pageWMm - marginMm - CARTOUCHE_W_MM;
    const y0 = pageHMm - marginMm - CARTOUCHE_H_MM;
    pdf.setFillColor(255, 255, 255);
    pdf.rect(x0, y0, CARTOUCHE_W_MM, CARTOUCHE_H_MM, 'F');
    pdf.rect(x0, y0, CARTOUCHE_W_MM, CARTOUCHE_H_MM);

    let textX = x0 + 3;
    let textMaxWidth = pageWMm - marginMm - textX - 2;
    let textStartY = y0 + 6;
    const logoW = 20;

    const drawLogo = (logoX, logoY, maxH) => {
      try {
        // Même détection qu'utilisée avec succès par services/PdfUtilities.js
        // (addCompanyLogoBox) : par sous-chaîne plutôt que regex ancrée, et
        // getImageProperties() d'abord pour amorcer le cache interne de jsPDF.
        let format = 'PNG';
        if (cartouche.company_logo.includes('image/jpeg') || cartouche.company_logo.includes('image/jpg')) {
          format = 'JPEG';
        }
        const props = pdf.getImageProperties(cartouche.company_logo);
        const logoH = Math.min(maxH || 16, (logoW * props.height) / props.width);
        pdf.addImage(cartouche.company_logo, format, logoX, logoY, logoW, logoH);
      } catch (e) {
        console.error('[PdfCartouche] Échec import du logo entreprise:', e);
      }
    };

    // Largeur de texte propre aux lignes situées SOUS le logo (cf. logoOnRight ci-dessous) ; null =
    // même largeur pour toutes les lignes (comportement d'origine).
    let textMaxWidthBelowLogo = null;
    let logoBottomY = null;

    if (cartouche.company_logo) {
      if (logoOnRight) {
        // CORRECTIF (3e passe, demande explicite, emplacement dessiné sur la capture du schéma
        // unifilaire) : le logo occupe une zone fixe au milieu-haut du cartouche — de x0+41 à
        // x0+65 mm et de y0+6 à y0+26 mm —, entièrement libre à côté des lignes courtes (nom du
        // projet, nom du plan, indice, échelle, date). L'image est inscrite dans cette zone en
        // conservant ses proportions, puis centrée. Les lignes du haut s'arrêtent avant le logo ;
        // l'adresse, écrite plus bas, retrouve toute la largeur du cartouche.
        const zone = { x: x0 + 41, y: y0 + 6, w: 24, h: 20 };
        try {
          let format = 'PNG';
          if (cartouche.company_logo.includes('image/jpeg') || cartouche.company_logo.includes('image/jpg')) {
            format = 'JPEG';
          }
          const props = pdf.getImageProperties(cartouche.company_logo);
          const ratio = (props.width && props.height) ? props.width / props.height : zone.w / zone.h;
          let w = zone.w, h = zone.w / ratio;
          if (h > zone.h) { h = zone.h; w = zone.h * ratio; }
          pdf.addImage(cartouche.company_logo, format, zone.x + (zone.w - w) / 2, zone.y + (zone.h - h) / 2, w, h);
        } catch (e) {
          console.error('[PdfCartouche] Échec import du logo entreprise:', e);
        }
        textMaxWidthBelowLogo = textMaxWidth;
        textMaxWidth = zone.x - 2 - textX;
        logoBottomY = zone.y + zone.h;
      } else {
        drawLogo(x0 + 2, y0 + 2);
        textX = x0 + logoW + 5;
        textMaxWidth = pageWMm - marginMm - textX - 2;
      }
    }

    pdf.setFontSize(8);
    pdf.setTextColor(20, 20, 20);
    // CORRECTIF (schéma unifilaire) : une échelle non numérique (ex. "NA" — un schéma unifilaire
    // n'est pas dessiné à une échelle physique réelle, contrairement aux plans cartographiques) se
    // rend telle quelle ("Echelle : NA"), sans le préfixe "1:" prévu pour un vrai dénominateur
    // d'échelle numérique — comportement inchangé pour tout appelant existant (scale numérique).
    const echelleLine = (scale === null || scale === undefined || scale === '')
      ? null
      : (Number.isFinite(Number(scale)) ? `Echelle : 1:${scale}` : `Echelle : ${scale}`);
    // Nbre PV / Puissance projet (plan de masse) : facultatifs — absents, cartouche inchangé.
    const nbPvLine = Number(cartouche.nb_pv) > 0 ? `Nbre PV : ${Math.round(Number(cartouche.nb_pv))}` : null;
    const puissanceLine = Number(cartouche.puissance_kwc) > 0
      ? `Puissance projet : ${PdfCartouche.nombreFr(cartouche.puissance_kwc, 2)} kWc` : null;
    const lines = [
      cartouche.nom_projet,
      cartouche.nom_plan,
      `Indice : ${cartouche.indice}`,
      echelleLine,
      nbPvLine,
      puissanceLine,
      `Date : ${cartouche.date}`,
      cartouche.adresse,
    ].filter(Boolean);
    // Interligne resserré au-delà de 6 lignes : tout tient dans les 45 mm du cartouche.
    const interligne = lines.length > 6 ? 4.6 : 5.5;
    let y = textStartY;
    lines.forEach((line) => {
      // Ligne entièrement sous le logo (sommet du glyphe ≈ ligne de base - 3 mm) : pleine largeur.
      const width = (textMaxWidthBelowLogo !== null && y - 3 > logoBottomY) ? textMaxWidthBelowLogo : textMaxWidth;
      pdf.text(String(line), textX, y, { maxWidth: width });
      y += interligne;
    });
  }

  /**
   * Nombre à la française (virgule décimale, espace simple pour les milliers) : toLocaleString
   * insère une espace fine insécable (U+202F) que la police standard de jsPDF n'affiche pas.
   */
  static nombreFr(valeur, decimales) {
    const [entier, dec] = Number(valeur).toFixed(decimales).split('.');
    const milliers = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return dec ? `${milliers},${dec}` : milliers;
  }
}
