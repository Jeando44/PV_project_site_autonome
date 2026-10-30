/**
 * Barre d'échelle graphique + rose des vents, dessinées en bas à gauche de la
 * zone imprimée. La rose des vents est un dessin 100% vectoriel (jsPDF), pas une
 * image externe - évite toute question de licence ("libre de droit") tout en
 * restant fidèle visuellement (aiguille nord/sud + label "N").
 *
 * Longueur de la barre : valeurs données explicitement pour les échelles
 * utilisées par les plans (1/10000 -> 50m, 1/1000 -> 20m, 1/500 -> 10m) ; pour
 * toute autre échelle (ex: page auto-adaptée du Plan de masse), une longueur
 * "propre" (1/2/5 x 10^n) visant ~20mm sur le papier est calculée automatiquement.
 */
const KNOWN_BAR_LENGTHS_M = {
  10000: 50,
  1000: 20,
  500: 10,
};

function niceBarLengthMeters(scale) {
  if (KNOWN_BAR_LENGTHS_M[scale]) return KNOWN_BAR_LENGTHS_M[scale];
  const targetM = scale * 0.02; // vise ~20mm de barre sur le papier
  const magnitude = Math.pow(10, Math.floor(Math.log10(targetM)));
  const normalized = targetM / magnitude;
  let nice;
  if (normalized < 1.5) nice = 1;
  else if (normalized < 3.5) nice = 2;
  else if (normalized < 7.5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

export default class PdfScaleBar {
  /**
   * @param {Object} pdf - instance jsPDF
   * @param {Object} options
   * @param {number} options.scale - dénominateur d'échelle (ex: 1000 pour 1/1000)
   * @param {number} options.pageHmm - hauteur totale de la page (mm)
   * @param {number} options.marginMm - marge du cadre (mm)
   */
  static draw(pdf, { scale, pageHmm, marginMm }) {
    const barLengthM = niceBarLengthMeters(scale);
    const barLengthMm = (barLengthM * 1000) / scale;

    const x0 = marginMm + 8;
    const yBar = pageHmm - marginMm - 8;

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.35);
    pdf.line(x0, yBar, x0 + barLengthMm, yBar);
    pdf.line(x0, yBar - 1, x0, yBar + 1);
    pdf.line(x0 + barLengthMm, yBar - 1, x0 + barLengthMm, yBar + 1);

    pdf.setFontSize(7);
    pdf.setTextColor(0, 0, 0);
    pdf.text(`${barLengthM} m`, x0 + barLengthMm / 2, yBar + 4.5, { align: 'center' });

    // Rose des vents juste au-dessus de la barre.
    const compassRadius = 5;
    const compassCx = x0 + Math.min(barLengthMm, 16) / 2;
    const compassCy = yBar - 10;
    this._drawCompassRose(pdf, compassCx, compassCy, compassRadius);
  }

  static _drawCompassRose(pdf, cx, cy, radius) {
    pdf.setDrawColor(60, 60, 60);
    pdf.setLineWidth(0.2);
    pdf.circle(cx, cy, radius, 'S');
    pdf.line(cx - radius, cy, cx + radius, cy);

    const halfWidth = radius * 0.28;
    pdf.setFillColor(30, 30, 30);
    pdf.triangle(cx, cy - radius, cx - halfWidth, cy, cx + halfWidth, cy, 'F');
    pdf.setFillColor(215, 215, 215);
    pdf.triangle(cx, cy + radius, cx - halfWidth, cy, cx + halfWidth, cy, 'F');
    pdf.setDrawColor(60, 60, 60);
    pdf.setLineWidth(0.15);
    pdf.triangle(cx, cy - radius, cx - halfWidth, cy, cx + halfWidth, cy, 'S');
    pdf.triangle(cx, cy + radius, cx - halfWidth, cy, cx + halfWidth, cy, 'S');

    pdf.setFontSize(6);
    pdf.setTextColor(20, 20, 20);
    pdf.text('N', cx, cy - radius - 1.5, { align: 'center' });
  }
}
