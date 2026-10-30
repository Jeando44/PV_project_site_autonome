/**
 * PdfGeometryPlansGenerator - Génère les pages de plans de géométrie
 * (Coupe, façade, implantation)
 */

export default class PdfGeometryPlansGenerator {
  constructor() {
    this.marginTop = 35; // Marge pour A4 paysage
  }

  /**
   * Vérifie si une image PNG est valide
   */
  isValidPNG(imgData) {
    if (!imgData || typeof imgData !== 'string') {
      return false;
    }

    // Vérifier que c'est bien une image base64 PNG
    if (!imgData.startsWith('data:image/png;base64,')) {
      return false;
    }

    // Une image vide fait environ 100-200 caractères
    if (imgData.length < 500) {
      console.warn('Image PNG trop petite, probablement vide');
      return false;
    }

    return true;
  }

  /**
   * Ajoute les plans de géométrie au PDF (en format A4 paysage)
   * Crée une page par PV si plusieurs formes existent
   * Affiche le plan de coupe et le plan de façade côte à côte (ou un seul centré si l'autre manque)
   */
  async addGeometryPlansPages(doc) {
    // Récupérer la liste des PV depuis les données du projet
    let pvList = [];
    try {
      const savedData = localStorage.getItem('solarProjectData');
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (projectData.formData) {
          pvList = Object.keys(projectData.formData);
          console.log(`📋 ${pvList.length} PV trouvé(s):`, pvList);
        }
      }
    } catch (error) {
      console.warn('⚠️ Erreur lors de la récupération de la liste des PV:', error);
    }

    // Si aucun PV trouvé, créer une page par défaut
    if (pvList.length === 0) {
      pvList = ['default'];
    }

    // Créer une page de géométrie pour chaque PV
    for (let i = 0; i < pvList.length; i++) {
      const pvId = pvList[i];
      console.log(`📄 Génération de la page de géométrie pour ${pvId}...`);

      await this.addGeometryPageForPV(doc, pvId, i + 1, pvList.length);
    }
  }

  /**
   * Ajoute une page de géométrie pour un PV spécifique
   * Layout : Plan de coupe (haut) + Plan de façade (bas)
   */
  async addGeometryPageForPV(doc, pvId, pageNumber, totalPages) {
    let coupeImg = null;
    let facadeImg = null;
    let pvParams = null;

    // Récupérer les paramètres du PV
    try {
      const savedData = localStorage.getItem('solarProjectData');
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (projectData.formData?.[pvId]) {
          const formValues = projectData.formData[pvId];
          const modePoseDisplay = formValues.modePose === 'paysage' ? 'Portrait' : 'Paysage';
          pvParams = {
            inclinaison: formValues.inclinaison || 'N/A',
            azimuth: formValues.azimuth || 'N/A',
            disposition: modePoseDisplay,
            puissance: formValues.puissancePanneau || 'N/A',
            systemeInt: formValues.referenceSI || 'N/A'
          };
        }
      }
    } catch (error) {
      console.warn('⚠️ Erreur lors de la récupération des paramètres du PV:', error);
    }

    // Récupérer les images depuis localStorage
    try {
      const savedPlans = localStorage.getItem('geometriePlansData');
      if (savedPlans) {
        const plansData = JSON.parse(savedPlans);

        if (plansData[pvId]) {
          coupeImg = plansData[pvId].coupe || null;
          facadeImg = plansData[pvId].facade || null;
          console.log(`✅ Plans récupérés pour ${pvId}`);
        } else if (plansData.coupe) {
          // Format global (fallback)
          coupeImg = plansData.coupe || null;
          facadeImg = plansData.facade || null;
          console.log(`⚠️ Plans globaux utilisés pour ${pvId}`);
        } else {
          console.warn(`⚠️ Aucun plan trouvé pour ${pvId}`);
        }
      } else {
        console.warn('⚠️ Aucune donnée geometriePlansData dans localStorage');
      }
    } catch (error) {
      console.error('❌ Erreur lors de la récupération des plans:', error);
    }

    // Fallback: capturer depuis les canvas de l'iframe si localStorage vide
    if (!this.isValidPNG(coupeImg)) {
      const captureCanvas = (canvasId) => new Promise((resolve) => {
        let canvas = document.getElementById(canvasId);
        if (!canvas) {
          const iframe = document.getElementById('geometrie-modal-iframe');
          if (iframe?.contentWindow?.document) {
            canvas = iframe.contentWindow.document.getElementById(canvasId);
          }
        }
        if (!canvas || canvas.width === 0 || canvas.height === 0) { resolve(null); return; }
        try { resolve(canvas.toDataURL('image/png')); } catch (e) { resolve(null); }
      });
      coupeImg = await captureCanvas('coupeCanvas');
    }

    const hasValidCoupe = this.isValidPNG(coupeImg);
    const hasValidFacade = this.isValidPNG(facadeImg);

    if (!hasValidCoupe && !hasValidFacade) {
      console.warn(`⚠️ Aucun plan valide pour ${pvId} - page non ajoutée`);
      return;
    }

    console.log(`✅ Ajout des plans pour ${pvId}: coupe=${hasValidCoupe}, facade=${hasValidFacade}`);

    // Page A4 paysage
    doc.addPage('a4', 'landscape');

    const pageWidth = 297;
    const pageHeight = 210;
    const marginLeft = 15;
    const marginRight = 15;
    const marginBottom = 25;
    let yPos = this.marginTop;

    // Titre section (18pt bold – référence)
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    const title = totalPages > 1 ? `3. Plans de géométrie - ${pvId}` : '3. Plans de géométrie';
    doc.text(title, marginLeft, yPos);
    yPos += 18 * 0.8 + 3;

    // Paramètres du PV (12pt normal – référence corps de texte)
    if (pvParams) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
      const paramsText = `Inclinaison ${pvParams.inclinaison}°  |  Azimut ${pvParams.azimuth}°  |  Mode ${pvParams.disposition}  |  Puissance ${pvParams.puissance} W  |  Système ${pvParams.systemeInt}`;
      doc.text(paramsText, marginLeft, yPos);
      yPos += 12 * 0.8 + 4;
    }

    // Zone disponible pour les images (disposition verticale : coupe en haut, façade en bas)
    const availableWidth = pageWidth - marginLeft - marginRight; // 267mm
    const availableHeight = pageHeight - yPos - marginBottom;
    const titleHeight = 7; // hauteur pour les sous-titres
    const spacing = 6; // espacement vertical entre les deux blocs

    // Si les deux plans sont disponibles : 2 lignes verticales
    // Sinon : 1 seul plan centré
    const validCount = [hasValidCoupe, hasValidFacade].filter(Boolean).length;
    let blockHeight, block1Y, block2Y;

    if (validCount === 2) {
      blockHeight = (availableHeight - titleHeight * 2 - spacing) / 2;
      block1Y = yPos;
      block2Y = yPos + titleHeight + blockHeight + spacing;
    } else {
      blockHeight = availableHeight - titleHeight;
      block1Y = yPos;
      block2Y = yPos; // non utilisé
    }

    /**
     * Helper: dessiner une image en conservant le ratio dans un espace donné
     */
    const addImageWithAspectRatio = (imgData, xArea, yArea, maxW, maxH, label) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            if (!img.width || !img.height) { resolve(); return; }
            const ratio = img.height / img.width;
            let imgW = maxW;
            let imgH = imgW * ratio;
            if (imgH > maxH) { imgH = maxH; imgW = imgH / ratio; }
            const xOff = (maxW - imgW) / 2;
            const yOff = (maxH - imgH) / 2;
            doc.addImage(imgData, 'PNG', xArea + xOff, yArea + yOff, imgW, imgH, undefined, 'FAST');
            resolve();
          } catch (e) {
            doc.text(`[${label} non disponible]`, xArea + 5, yArea + 10);
            resolve();
          }
        };
        img.onerror = () => { doc.text(`[${label} non disponible]`, xArea + 5, yArea + 10); resolve(); };
        img.src = imgData;
      });
    };

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');

    if (validCount === 1) {
      // Un seul plan centré
      const singleImg = hasValidCoupe ? coupeImg : facadeImg;
      const singleLabel = hasValidCoupe ? 'Plan de coupe' : 'Plan de façade';
      doc.text(singleLabel, marginLeft + availableWidth / 2, block1Y, { align: 'center' });
      await addImageWithAspectRatio(singleImg, marginLeft, block1Y + titleHeight, availableWidth, blockHeight, singleLabel);
    } else {
      // Plan de coupe — haut
      doc.text('Plan de coupe', marginLeft + availableWidth / 2, block1Y, { align: 'center' });
      await addImageWithAspectRatio(coupeImg, marginLeft, block1Y + titleHeight, availableWidth, blockHeight, 'Plan de coupe');

      // Plan de façade — bas
      doc.text('Plan de façade', marginLeft + availableWidth / 2, block2Y, { align: 'center' });
      await addImageWithAspectRatio(facadeImg, marginLeft, block2Y + titleHeight, availableWidth, blockHeight, 'Plan de façade');
    }
  }

  /**
   * Force la sauvegarde des plans depuis l'iframe du modal
   */
  async forceSavePlansFromModal() {
    return new Promise((resolve) => {
      console.log('🔄 Tentative de forçage de la sauvegarde des plans...');

      // Essayer de récupérer l'iframe du modal de géométrie
      const iframe = document.getElementById('geometrie-modal-iframe');

      if (!iframe || !iframe.contentWindow) {
        console.log('⚠️ Iframe du modal de géométrie non trouvé');
        resolve(false);
        return;
      }

      // Envoyer un message à l'iframe pour déclencher la sauvegarde
      try {
        iframe.contentWindow.postMessage({
          action: 'savePlans'
        }, '*');

        // Attendre un peu pour laisser le temps à l'iframe de sauvegarder
        setTimeout(() => {
          console.log('✅ Message de sauvegarde envoyé à l\'iframe');
          resolve(true);
        }, 1500);
      } catch (error) {
        console.error('❌ Erreur lors de l\'envoi du message à l\'iframe:', error);
        resolve(false);
      }
    });
  }
}
