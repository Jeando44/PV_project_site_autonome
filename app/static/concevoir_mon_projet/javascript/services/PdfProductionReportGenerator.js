/**
 * PdfProductionReportGenerator - Génère le rapport de production solaire
 * Récupère les graphiques et informations de production depuis PDFGenerator.js
 * Affichage conditionnel : uniquement si mode de valorisation = "vente totale" OU "marché libre"
 */

import PdfUtilities from './PdfUtilities.js';
import GraphModal from '../components/GraphModal.js';

export default class PdfProductionReportGenerator {
  constructor() {
    this.marginTop = 35;
    this.graphModal = new GraphModal();
  }

  /**
   * Vérifie si le rapport de production doit être ajouté
   */
  shouldAddReport(projectData) {
    const mode = projectData?.modeDeValorisation?.toLowerCase() || '';
    const shouldAdd = mode === 'vente totale' || mode === 'marché libre';
    console.log(`📊 Rapport de Production Solaire: ${shouldAdd ? 'OUI' : 'NON'} (mode: ${mode})`);
    return shouldAdd;
  }

  /**
   * Ajoute le rapport de production solaire au PDF
   */
  async addProductionReport(doc, projectData) {
    // Vérifier si le rapport doit être ajouté
    if (!this.shouldAddReport(projectData)) {
      console.log('⏭️ Rapport de production ignoré (mode de valorisation différent)');
      return;
    }

    console.log('📊 Ajout du Rapport de Production Solaire...');

    // Afficher le graphique modal pour capturer les graphiques
    await this.graphModal.showGraph();
    // Attendre que les graphiques soient rendus
    await new Promise(resolve => setTimeout(resolve, 800));

    doc.addPage();
    let yPos = this.marginTop;

    // Titre de la section
    doc.setTextColor(0, 0, 0);
    yPos = PdfUtilities.centeredText(doc, yPos, 'RAPPORT DE PRODUCTION SOLAIRE', 17, 15);
    doc.setTextColor('#000000');

    // Description
    yPos = PdfUtilities.centeredText(
      doc,
      yPos,
      'Les graphiques présentés ci-dessous offrent une visualisation détaillée du rendement global ainsi que de la performance énergétique de la centrale photovoltaïque durant sa phase d\'exploitation.',
      14,
      15
    );

    // Récupérer les éléments des graphiques
    const p50ChartBox = document.querySelector('.chart-container:nth-of-type(1)');
    const p90ChartBox = document.querySelector('.chart-container:nth-of-type(2)');

    // Fonction pour capturer et ajouter un graphique
    const captureAndAddChart = async (element, yPos) => {
      if (!element) {
        console.warn('⚠️ Élément graphique non trouvé');
        return;
      }

      try {
        // Attendre un peu pour s'assurer que le graphique est rendu
        await new Promise(resolve => setTimeout(resolve, 100));

        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: false,
          logging: false,
          backgroundColor: '#ffffff'
        });

        // Vérifier que le canvas n'est pas vide
        if (!canvas || canvas.width === 0 || canvas.height === 0) {
          console.error('❌ Canvas vide ou invalide');
          return;
        }

        const imgData = canvas.toDataURL('image/png');

        // Vérifier que l'image est valide
        if (!imgData || imgData.length < 100) {
          console.error('❌ Image PNG invalide ou vide');
          return;
        }

        doc.addImage(imgData, 'PNG', 15, yPos, 180, 90);
        console.log('✅ Graphique ajouté avec succès');
      } catch (error) {
        console.error('❌ Erreur lors de la capture du graphique:', error);
        // Ajouter un message d'erreur dans le PDF
        doc.setFontSize(12);
        doc.setTextColor(255, 0, 0);
        doc.text('Erreur: Impossible de capturer le graphique', 15, yPos);
        doc.setTextColor(0, 0, 0);
      }
    };

    // Graphique P50
    if (p50ChartBox) {
      yPos -= 10;
      await captureAndAddChart(p50ChartBox, yPos);
      yPos += 95;
    } else {
      console.warn('⚠️ Graphique P50 non trouvé');
    }

    // Graphique P90
    if (p90ChartBox) {
      // Vérifier s'il faut ajouter une nouvelle page
      if (yPos + 95 > 270) {
        doc.addPage();
        yPos = this.marginTop;

        // Titre de continuation
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(17);
        doc.setFont('helvetica', 'bold');
        doc.text('RAPPORT DE PRODUCTION SOLAIRE (suite)', 105, yPos, { align: 'center' });
        doc.setTextColor('#000000');
        doc.setFont('helvetica', 'normal');
        yPos += 15;
      }

      await captureAndAddChart(p90ChartBox, yPos);
    } else {
      console.warn('⚠️ Graphique P90 non trouvé');
    }

    // Fermer le modal des graphiques
    await this.graphModal.closeGraph();

    console.log('✅ Rapport de Production Solaire ajouté');
  }
}
