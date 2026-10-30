/**
 * PdfGraphReportGenerator - Génère le rapport de production solaire (graphiques P50/P90)
 * Format A4 paysage
 */

export default class PdfGraphReportGenerator {
  constructor() {
    this.marginTop = 35; // Marge pour A4 paysage
  }

  /**
   * Capture un élément DOM et le convertit en image base64
   */
  async captureElement(elementId) {
    return new Promise(async (resolve) => {
      try {
        const element = document.getElementById(elementId);

        if (!element) {
          console.warn(`⚠️ Élément ${elementId} non trouvé`);
          resolve(null);
          return;
        }

        // Vérifier que html2canvas est disponible
        if (typeof html2canvas === 'undefined') {
          console.warn('⚠️ html2canvas non disponible');
          resolve(null);
          return;
        }

        // Capturer l'élément
        const canvas = await html2canvas(element, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: 'white',
          logging: false
        });

        const imgData = canvas.toDataURL('image/png');
        console.log(`✅ Élément ${elementId} capturé avec succès`);
        resolve(imgData);
      } catch (error) {
        console.error(`❌ Erreur lors de la capture de l'élément ${elementId}:`, error);
        resolve(null);
      }
    });
  }

  /**
   * Ajoute le rapport de production solaire (graphiques) au PDF
   */
  async addGraphReport(doc) {
    // Essayer de récupérer les graphiques depuis localStorage ou depuis les éléments DOM
    let p50GraphImg = null;
    let p90GraphImg = null;

    // Méthode 1: Essayer depuis localStorage
    try {
      const savedGraphs = localStorage.getItem('graphReportData');
      if (savedGraphs) {
        const graphData = JSON.parse(savedGraphs);
        p50GraphImg = graphData.p50Graph || null;
        p90GraphImg = graphData.p90Graph || null;
        console.log('✅ Graphiques récupérés depuis localStorage');
      }
    } catch (error) {
      console.warn('⚠️ Erreur lors de la récupération des graphiques depuis localStorage:', error);
    }

    // Méthode 2: Capturer depuis les éléments DOM si non disponibles
    if (!p50GraphImg) {
      p50GraphImg = await this.captureElement('chart-container-p50');
    }
    if (!p90GraphImg) {
      p90GraphImg = await this.captureElement('chart-container-p90');
    }

    // Vérifier qu'au moins un graphique est disponible
    if (!p50GraphImg && !p90GraphImg) {
      console.warn('⚠️ Aucun graphique disponible - page non ajoutée');
      return;
    }

    console.log('✅ Ajout du rapport de production solaire au PDF');

    // Ajouter une page A4 paysage
    doc.addPage('a4', 'landscape');

    const marginLeft = 15;
    const marginRight = 15;
    const marginBottom = 25;
    let yPos = this.marginTop;

    // Titre
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0); // Noir au lieu de bleu
    doc.setFont('helvetica', 'bold');
    doc.text('4. Analyse de production solaire', marginLeft, yPos);
    yPos += 10;

    // Description    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    const descText = doc.splitTextToSize(
      'Cette section présente l\'analyse de la production solaire attendue sur la durée de vie du projet, incluant les projections P50 (production médiane) et P90 (production avec un niveau de confiance de 90%).',
      267
    );
    const lineHeight = 12 * 1.5; // 12pt * facteur 1.5
    doc.text(descText, marginLeft, yPos, { lineHeightFactor: 1.5 });
    yPos += descText.length + 20 ;

    // Calculer les dimensions disponibles
    const availableWidth = 297 - marginLeft - marginRight; // 267mm pour A4 paysage
    const availableHeight = 210 - yPos - marginBottom;

    /**
     * Fonction helper pour ajouter une image en conservant son ratio d'aspect
     */
    const addImageWithAspectRatio = (imgData, xPos, yPos, maxW, maxH, title) => {
      return new Promise((resolve) => {
        // Créer une image temporaire pour obtenir ses dimensions
        const img = new Image();

        img.onload = () => {
          try {
            // Vérifier que les dimensions sont valides
            if (!img.width || !img.height || img.width <= 0 || img.height <= 0) {
              console.warn(`⚠️ Dimensions invalides pour ${title}: ${img.width}x${img.height}`);
              doc.text(`[Erreur: ${title} non disponible]`, xPos + 10, yPos + 20);
              resolve(0);
              return;
            }

            // Calculer les dimensions en conservant le ratio
            const aspectRatio = img.height / img.width;
            let imgW = maxW;
            let imgH = imgW * aspectRatio;

            // Si l'image est trop haute, ajuster
            if (imgH > maxH) {
              imgH = maxH;
              imgW = imgH / aspectRatio;
            }

            // Centrer horizontalement
            const xOffset = (maxW - imgW) / 2;

            // Vérifier que toutes les valeurs sont valides avant d'ajouter l'image
            if (isNaN(xPos + xOffset) || isNaN(yPos) || isNaN(imgW) || isNaN(imgH) ||
                imgW <= 0 || imgH <= 0) {
              console.error(`❌ Coordonnées invalides pour ${title}:`, { xPos: xPos + xOffset, yPos, imgW, imgH });
              doc.text(`[Erreur: ${title} non disponible]`, xPos + 10, yPos + 20);
              resolve(0);
              return;
            }

            doc.addImage(imgData, 'PNG', xPos + xOffset, yPos, imgW, imgH, undefined, 'FAST');
            resolve(imgH);
          } catch (error) {
            console.error(`❌ Erreur lors de l'ajout du ${title}:`, error);
            doc.text(`[Erreur: ${title} non disponible]`, xPos + 10, yPos + 20);
            resolve(0);
          }
        };

        img.onerror = () => {
          console.error(`❌ Erreur de chargement de l'image pour ${title}`);
          doc.text(`[Erreur: ${title} non disponible]`, xPos + 10, yPos + 20);
          resolve(0);
        };

        img.src = imgData;
      });
    };

    // Si les deux graphiques sont disponibles, les afficher côte à côte
    if (p50GraphImg && p90GraphImg) {
      const spacing = 10;
      const imgWidth = (availableWidth - spacing) / 2;

      // Graphique P50 (à gauche)
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('Production solaire P50 mensuelle', marginLeft + imgWidth / 2, yPos, { align: 'center' });
      yPos += 8;

      const p50Height = await addImageWithAspectRatio(p50GraphImg, marginLeft, yPos, imgWidth, availableHeight - 8, 'Graphique P50');

      // Graphique P90 (à droite)
      const p90XPos = marginLeft + imgWidth + spacing;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('Projection Production P90', p90XPos + imgWidth / 2, yPos - 8, { align: 'center' });

      await addImageWithAspectRatio(p90GraphImg, p90XPos, yPos, imgWidth, availableHeight - 8, 'Graphique P90');

    } else {
      // Afficher uniquement le graphique disponible (pleine largeur)
      if (p50GraphImg) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Production solaire P50 mensuelle', marginLeft, yPos);
        yPos += 8;

        await addImageWithAspectRatio(p50GraphImg, marginLeft, yPos, availableWidth, availableHeight - 8, 'Graphique P50');
      } else if (p90GraphImg) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Projection Production P90', marginLeft, yPos);
        yPos += 8;

        await addImageWithAspectRatio(p90GraphImg, marginLeft, yPos, availableWidth, availableHeight - 8, 'Graphique P90');
      }
    }

    doc.setTextColor(0, 0, 0);
  }

  /**
   * Sauvegarde les graphiques dans localStorage (à appeler depuis GraphModal)
   */
  static async saveGraphsToLocalStorage() {
    console.log('🔄 Sauvegarde des graphiques...');

    const p50Container = document.getElementById('chart-container-p50');
    const p90Container = document.getElementById('chart-container-p90');

    if (!p50Container || !p90Container) {
      console.warn('⚠️ Conteneurs de graphiques non trouvés');
      return false;
    }

    try {
      // Capturer les graphiques
      const p50Canvas = await html2canvas(p50Container, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: 'white',
        logging: false
      });

      const p90Canvas = await html2canvas(p90Container, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: 'white',
        logging: false
      });

      const graphData = {
        p50Graph: p50Canvas.toDataURL('image/png'),
        p90Graph: p90Canvas.toDataURL('image/png'),
        savedAt: new Date().toISOString()
      };

      localStorage.setItem('graphReportData', JSON.stringify(graphData));
      console.log('✅ Graphiques sauvegardés dans localStorage');
      return true;
    } catch (error) {
      console.error('❌ Erreur lors de la sauvegarde des graphiques:', error);
      return false;
    }
  }
}
