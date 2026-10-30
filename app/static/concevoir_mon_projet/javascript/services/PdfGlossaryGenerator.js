/**
 * PdfGlossaryGenerator - Génère la page de glossaire du rapport PDF
 */

import PdfUtilities from './PdfUtilities.js';

export default class PdfGlossaryGenerator {
  constructor() {
    this.marginTop = 35;
    this.glossaryTerms = [
      {
        term: 'kWc (kilowatt-crête)',
        definition: 'Puissance électrique maximale que peut produire un panneau solaire dans des conditions d\'ensoleillement standard (1000 W/m², 25°C, AM 1.5).'
      },
      {
        term: 'MWh (mégawattheure)',
        definition: 'Unité de mesure de l\'énergie équivalente à 1000 kWh. Utilisée pour quantifier la production annuelle d\'électricité.'
      },
      {
        term: 'kWh/kWc/an',
        definition: 'Productible spécifique annuel. Indique la production énergétique annuelle par kilowatt-crête installé. Permet de comparer l\'efficacité de différentes installations.'
      },
      {
        term: 'Azimut',
        definition: 'Angle d\'orientation des panneaux solaires par rapport au sud géographique. 0° = plein sud, 90° = ouest, -90° = est.'
      },
      {
        term: 'Inclinaison',
        definition: 'Angle d\'inclinaison des panneaux solaires par rapport à l\'horizontale, exprimé en degrés (0° = horizontal, 90° = vertical).'
      },
      {
        term: 'Surface projetée',
        definition: 'Projection au sol de la surface des panneaux photovoltaïques, tenant compte de leur inclinaison.'
      },
      {
        term: 'Vente totale',
        definition: 'Mode de valorisation où toute l\'électricité produite est vendue au réseau. Aucune autoconsommation.'
      },
      {
        term: 'Autoconsommation',
        definition: 'Mode de valorisation où l\'électricité produite est consommée directement sur site. Le surplus peut être vendu ou non.'
      },
      {
        term: 'Marché libre',
        definition: 'Mode de vente de l\'électricité produite sur le marché spot ou via un contrat PPA (Power Purchase Agreement).'
      },
      {
        term: 'BT (Basse Tension)',
        definition: 'Tension électrique inférieure ou égale à 1000V en alternatif. Raccordement typique pour installations < 250 kWc.'
      },
      {
        term: 'HTA (Haute Tension A)',
        definition: 'Tension électrique entre 1kV et 50kV. Raccordement typique pour installations > 250 kWc.'
      },
      {
        term: 'NF C 15-100',
        definition: 'Norme française régissant les installations électriques basse tension en France.'
      },
      {
        term: 'UTE C 15-712-1',
        definition: 'Guide pratique pour la réalisation des installations photovoltaïques raccordées au réseau public de distribution.'
      },
      {
        term: 'Zone de vent',
        definition: 'Classification du territoire selon l\'intensité des vents (zone 1 à 4) pour le dimensionnement des structures.'
      },
      {
        term: 'Zone de neige',
        definition: 'Classification du territoire selon les charges de neige (A1, A2, B, C, D, E) pour le dimensionnement des structures.'
      },
      {
        term: 'Zone sismique',
        definition: 'Classification du risque sismique (1: très faible, 2: faible, 3: modérée, 4: moyenne, 5: forte).'
      },
      {
        term: 'Niveau kéraunique',
        definition: 'Nombre moyen de jours d\'orage par an. Détermine le niveau de protection foudre requis (Nk).'
      },
      {
        term: 'Onduleur',
        definition: 'Équipement convertissant le courant continu (DC) produit par les panneaux en courant alternatif (AC) compatible avec le réseau.'
      },
      {
        term: 'Ratio de performance (PR)',
        definition: 'Rapport entre la production réelle et la production théorique d\'une installation photovoltaïque. Indique l\'efficacité globale du système.'
      },
      {
        term: 'P50 / P90',
        definition: 'Probabilités de production. P50 = production avec 50% de probabilité d\'être dépassée. P90 = 90% de probabilité (scénario conservateur).'
      }
    ];
  }

  /**
   * Ajoute la page de glossaire au PDF (sur une seule page)
   */
  async addGlossaryPage(doc) {
    doc.addPage('a4', 'portrait');
    let yPos = 45; // Titre plus bas

    // Titre
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('GLOSSAIRE', 105, yPos, { align: 'center' });

    yPos += 8;

    // Description
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    const introText = 'Ce glossaire définit les termes techniques utilisés dans ce rapport.';
    doc.text(introText, 105, yPos, { align: 'center' });
    doc.setFont('helvetica', 'normal');

    yPos += 10;

    // Disposition en 2 colonnes pour tenir sur une page
    doc.setFontSize(9);
    const margin = 15;
    const columnWidth = 85; // Largeur d'une colonne
    const columnGap = 10; // Espacement entre les colonnes
    const leftColumnX = margin;
    const rightColumnX = margin + columnWidth + columnGap;

    let currentColumn = 0; // 0 = gauche, 1 = droite
    let columnY = yPos;
    const itemsPerColumn = Math.ceil(this.glossaryTerms.length / 2);

    for (let i = 0; i < this.glossaryTerms.length; i++) {
      const item = this.glossaryTerms[i];

      // Changer de colonne après la moitié des items
      if (i === itemsPerColumn) {
        currentColumn = 1;
        columnY = yPos;
      }

      const xPos = currentColumn === 0 ? leftColumnX : rightColumnX;

      // Terme (en gras)
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(`• ${item.term}`, xPos, columnY);

      // Définition (normal, en retrait)
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 50);
      const lines = doc.splitTextToSize(item.definition, columnWidth - 5);
      doc.text(lines, xPos + 3, columnY + 4);

      // Espace après chaque entrée (réduit pour tenir sur une page)
      columnY += 4 + (lines.length * 3.5) + 2;
    }

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
  }
}
