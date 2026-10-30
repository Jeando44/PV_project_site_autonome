/**
 * PdfSystemPageGenerator - Génère la page système du rapport PDF
 * Intègre le contenu du fichier "Page système.pdf"
 */

import PdfUtilities from './PdfUtilities.js';

export default class PdfSystemPageGenerator {
  constructor() {
    this.marginTop = 35;
    this.marginSide = 15;
    // this.pdfPath = '/static/concevoir_mon_projet/docs/Page système.pdf';
    this.imagePath = '/static/concevoir_mon_projet/medias/img/Image_page_système.png';
  }

  // ─────────────────────────────────────────────
  // Utilitaires
  // ─────────────────────────────────────────────
 
  /**
   * Récupère l'option réseau depuis le localStorage ou le DOM.
   */
  getOptionReseau() {
    try {
      const savedData = localStorage.getItem('solarProjectData');
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (
          projectData.projectInfo?.optionReseau &&
          projectData.projectInfo.optionReseau !== 'N/A'
        ) {
          return projectData.projectInfo.optionReseau;
        }
      }
    } catch (e) {
      // ignore
    }
    const el = document.getElementById('option_reseau');
    return el?.value || null;
  }

  /**
   * Récupère le pays du projet depuis le localStorage ou le DOM (repli 'France', valeur par
   * défaut du champ #pays dans Paramètres projet — cf. même convention que getOptionReseau()).
   */
  getPays() {
    return PdfUtilities.getPays();
  }

  /**
   * Charge une image depuis une URL et retourne sa représentation base64.
   * @param {string} url
   * @returns {Promise<string|null>}
   */
  async loadImageAsBase64(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`⚠️ Impossible de charger l'image : ${url} (${response.status})`);
        return null;
      }
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn(`⚠️ Erreur lors du chargement de l'image : ${url}`, err);
      return null;
    }
  }
 
  /**
   * Retourne la hauteur approximative d'un bloc de lignes jsPDF (en mm).
   * @param {number} lineCount
   * @param {number} fontSize  taille en pt
   * @param {number} lineHeightFactor  multiplicateur inter-ligne (défaut 1.5)
   */
  _lineHeight(lineCount, fontSize, lineHeightFactor = 1.5) {
    // 1 pt ≈ 0.3528 mm
    return lineCount * fontSize * 0.3528 * lineHeightFactor;
  }
 
  /**
   * Écrit la phrase « option réseau » sur la page courante.
   * @param {object} doc
   * @param {number} yPos
   * @param {string} optionReseau
   * @returns {number} nouveau yPos après le texte
   */
  _writeOptionReseauPhrase(doc, yPos, optionReseau) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const usableWidth = pageWidth - this.marginSide * 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    doc.setTextColor(60, 60, 60);
    const phrase = `•  Le projet a été conçu selon le schéma de raccordement suivant : ${optionReseau}.`;
    const lines = doc.splitTextToSize(phrase, usableWidth);
    doc.text(lines, this.marginSide, yPos);
    doc.setTextColor(0, 0, 0);
    return yPos + this._lineHeight(lines.length, 11) + 2;
  }
 
  /**
   * Méthode conservée pour compatibilité avec ExportService.
   * L'option réseau est désormais écrite directement dans addSystemPage.
   */
  addNetworkOptionPage(doc) {
    // no-op : géré dans addSystemPage
  }

  /**
   * Ajoute la page système au PDF.
   * Sur la première page, la phrase option réseau (si définie) est ajoutée
   * au-dessus du contenu du PDF système.
   */
  async addSystemPage(doc) {
    console.log('📄 Tentative d\'ajout de la page système depuis PDF...');

    try {
      // ── Préchargement de l'image ──────────────────────────────────────
      const imgBase64 = await this.loadImageAsBase64(this.imagePath);
      let imgNaturalWidth  = 0;
      let imgNaturalHeight = 0;

      if (imgBase64) {
        await new Promise((resolve) => {
          const tmpImg = new Image();
          tmpImg.onload = () => {
            imgNaturalWidth  = tmpImg.naturalWidth;
            imgNaturalHeight = tmpImg.naturalHeight;
            resolve();
          };
          tmpImg.onerror = resolve; // on continue même si erreur
          tmpImg.src = imgBase64;
        });
      }

      // ── Paramètres de page ────────────────────────────────────────────
      doc.addPage('a4', 'portrait');
 
      const pageWidth    = doc.internal.pageSize.getWidth();   // 210 mm
      const pageHeight   = doc.internal.pageSize.getHeight();  // 297 mm
      const ml           = this.marginSide;                    // 15 mm
      const usableW      = pageWidth - ml * 2;                 // 180 mm
      const marginBottom = 20;

      let y = this.marginTop; // curseur vertical courant

      // ── Helper : vérifier et ajouter une page si débordement ─────────
      const checkPageBreak = (neededHeight) => {
        if (y + neededHeight > pageHeight - marginBottom) {
          doc.addPage('a4', 'portrait');
          y = this.marginTop;
        }
      };

      // ═══════════════════════════════════════════════════════════════════
      // 1. TITRE PRINCIPAL 
      // ═══════════════════════════════════════════════════════════════════
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(0, 0, 0);
 
      const titre = 'Le solaire photovoltaïque : Comment ça marche ?';
      const titreLines = doc.splitTextToSize(titre, usableW);
      checkPageBreak(this._lineHeight(titreLines.length, 16) + 4);
      doc.text(titreLines, ml, y);
      y += this._lineHeight(titreLines.length, 16);
 
      // Ligne de séparation décorative
      // doc.setDrawColor(230, 150, 0);
      // doc.setLineWidth(0.6);
      // doc.line(ml, y, pageWidth - ml, y);
      // y += 5;
      // const optionReseau = this.getOptionReseau();

      // ═══════════════════════════════════════════════════════════════════
      // 2. PARAGRAPHE DE DESCRIPTION
      // ═══════════════════════════════════════════════════════════════════
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 40);
 
      const desc =
        "Le principe est simple : vos panneaux photovoltaïques captent l'énergie du soleil " +
        "et la transforment en électricité utilisable pour votre maison ou votre entreprise.";
      const descLines = doc.splitTextToSize(desc, usableW);
      checkPageBreak(this._lineHeight(descLines.length, 12) + 6);
      doc.text(descLines, ml, y);
      y += this._lineHeight(descLines.length, 12) + 6;

      // ═══════════════════════════════════════════════════════════════════
      // 3. LE FONCTIONNEMENT EN 3 ÉTAPES
      // ═══════════════════════════════════════════════════════════════════
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(0, 0, 0);
 
      const sousTitre1 = 'Le fonctionnement en 3 étapes :';
      checkPageBreak(this._lineHeight(1, 13) + 4);
      doc.text(sousTitre1, ml, y);
      y += this._lineHeight(1, 13) + 3;
 
      // ── Étapes (liste numérotée avec label en gras) ──────────────────
      const etapes = [
        {
          label: 'Captation',
          suite: 'les panneaux solaires captent les rayons du soleil.',
        },
        {
          label: 'Conversion',
          suite: "l'onduleur transforme le courant continu en courant alternatif.",
        },
        {
          label: 'Utilisation',
          suite:
            "L'électricité alimente votre entreprise/votre habitation ou la totalité est revendue au gestionnaire du réseau électrique.",
        },
      ];
 
      const etapeNumW    = 6;  // mm réservé au numéro
      const etapeTextW   = usableW - etapeNumW - 2;
 
      etapes.forEach((etape, idx) => {
        doc.setFontSize(11);
 
        // Estimation hauteur pour checkPageBreak
        const fullStr  = `${etape.label} ${etape.suite}`;
        const estLines = doc.splitTextToSize(fullStr, etapeTextW);
        checkPageBreak(this._lineHeight(estLines.length, 11) + 2);
 
        // Numéro coloré
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(230, 150, 0);
        doc.text(`${idx + 1}.`, ml, y);
 
        // Label en gras
        const xText = ml + etapeNumW;
        doc.setTextColor(0, 0, 0);
        doc.text(etape.label, xText, y);
        const labelW = doc.getTextWidth(etape.label + ' ');
 
        // Suite en normal sur la même ligne (avec wrap)
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(40, 40, 40);
        const suiteLines = doc.splitTextToSize(etape.suite, etapeTextW - labelW);
        doc.text(suiteLines[0], xText + labelW, y);
 
        if (suiteLines.length > 1) {
          for (let l = 1; l < suiteLines.length; l++) {
            y += this._lineHeight(1, 11);
            doc.text(suiteLines[l], xText, y);
          }
        }
 
        y += this._lineHeight(1, 11) + 2;
      });
 
      y += 4;

      // ═══════════════════════════════════════════════════════════════════
      // 4. IMAGE
      // ═══════════════════════════════════════════════════════════════════
      if (imgBase64 && imgNaturalWidth > 0) {
        const imgDisplayW = Math.min(140, usableW);
        const imgDisplayH = (imgNaturalHeight / imgNaturalWidth) * imgDisplayW;
 
        checkPageBreak(imgDisplayH + 6);
 
        const imgX = (pageWidth - imgDisplayW) / 2;
        doc.addImage(imgBase64, 'PNG', imgX, y, imgDisplayW, imgDisplayH, undefined, 'FAST');
        y += imgDisplayH + 8;
        console.log('✅ Image insérée dans la page système');
      } else {
        console.warn('⚠️ Image non disponible, elle sera omise.');
        y += 4;
      }
      y+=10;

      // NOUVEAU (demande explicite : "masquer les sections Contexte réglementaire/Synthèse des
      // options de valorisation si le pays est différent de la France, ce cadre réglementaire
      // (arrêté tarifaire S21) concerne uniquement la France") : le titre "Exemples de modèle de
      // valorisation économique" n'introduit plus que ce contenu France-spécifique — masqué avec
      // lui pour un autre pays, plutôt que de laisser un titre sans rien en dessous.
      const pays = this.getPays();
      if (pays === 'France') {
      // ═══════════════════════════════════════════════════════════════════
      // 5. TITRE : EXEMPLE DE MODÈLE DE VALORISATION ÉCONOMIQUE
      // ═══════════════════════════════════════════════════════════════════
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);

      const titreValo = 'Exemples de modèle de valorisation économique :';
      const titreValoLines = doc.splitTextToSize(titreValo, usableW);
      checkPageBreak(this._lineHeight(titreValoLines.length, 13) + 6);
      doc.text(titreValoLines, ml, y);
      y += this._lineHeight(titreValoLines.length, 13) + 5;

      // ═══════════════════════════════════════════════════════════════════
      // 6. CONTEXTE RÉGLEMENTAIRE + SYNTHÈSE DES OPTIONS DE VALORISATION
      // (remplace l'ancien tableau AUTOCONSOMMATION / REVENTE TOTALE — demande explicite)
      // ═══════════════════════════════════════════════════════════════════

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 40);
      const introValo = "L'optimisation de la rentabilité d'un projet photovoltaïque repose sur le choix stratégique du mode de valorisation de l'électricité produite. Ce choix s'inscrit dans un cadre réglementaire précis qu'il convient de bien appréhender avant de définir la taille de l'installation.";
      const introValoLines = doc.splitTextToSize(introValo, usableW);
      checkPageBreak(this._lineHeight(introValoLines.length, 12) + 6);
      doc.text(introValoLines, ml, y);
      y += this._lineHeight(introValoLines.length, 12) + 6;

      // -- 1. Contexte réglementaire --
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(0, 0, 0);
      const sousTitreReglement = "1. Contexte réglementaire : Évolutions de l'arrêté tarifaire S21";
      const sousTitreReglementLines = doc.splitTextToSize(sousTitreReglement, usableW);
      checkPageBreak(this._lineHeight(sousTitreReglementLines.length, 13) + 4);
      doc.text(sousTitreReglementLines, ml, y);
      y += this._lineHeight(sousTitreReglementLines.length, 13) + 3;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 40);
      const introReglement = 'Depuis le 5 juin 2026, de nouvelles règles régissent les tarifs de rachat photovoltaïque. Les principaux changements à prendre en compte pour la structuration financière des projets sont les suivants :';
      const introReglementLines = doc.splitTextToSize(introReglement, usableW);
      checkPageBreak(this._lineHeight(introReglementLines.length, 12) + 4);
      doc.text(introReglementLines, ml, y);
      y += this._lineHeight(introReglementLines.length, 12) + 4;

      const reglementBullets = [
        { label: 'Nouveau tarif de rachat', suite: "Pour les nouvelles demandes concernant des installations de 0 à 100 kWc, le tarif d'achat (surplus et injection) est désormais fixé à 1,1 c€/kWh HT." },
        { label: 'Indexation', suite: "Ce tarif bénéficie d'une indexation annuelle de 2 %." },
        { label: "Prime à l'autoconsommation", suite: "Elle est supprimée pour les installations d'une puissance inférieure à 9 kWc." },
        { label: "Condition d'éligibilité", suite: "Les projets de moins de 9 kWc ne sont aujourd'hui éligibles qu'au modèle exclusif de l'autoconsommation couplée à la vente du surplus." },
      ];
      const bulletIndent = 5;
      const bulletTextW = usableW - bulletIndent;
      reglementBullets.forEach((b) => {
        doc.setFontSize(11);
        const fullStr = `${b.label} : ${b.suite}`;
        const estLines = doc.splitTextToSize(fullStr, bulletTextW);
        checkPageBreak(this._lineHeight(estLines.length, 11) + 2);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('•', ml, y);
        const labelText = `${b.label} : `;
        doc.text(labelText, ml + bulletIndent, y);
        const labelW = doc.getTextWidth(labelText);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(40, 40, 40);
        const suiteLines = doc.splitTextToSize(b.suite, bulletTextW - labelW);
        doc.text(suiteLines[0], ml + bulletIndent + labelW, y);
        if (suiteLines.length > 1) {
          for (let l = 1; l < suiteLines.length; l++) {
            y += this._lineHeight(1, 11);
            doc.text(suiteLines[l], ml + bulletIndent, y);
          }
        }
        y += this._lineHeight(1, 11) + 3;
      });
      y += 3;

      // -- 2. Synthèse des options de valorisation --
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(0, 0, 0);
      const sousTitreSynthese = "2. Synthèse des options de valorisation de l'électricité";
      checkPageBreak(this._lineHeight(1, 13) + 4);
      doc.text(sousTitreSynthese, ml, y);
      y += this._lineHeight(1, 13) + 3;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 40);
      const introSynthese = 'Le choix du modèle économique adéquat dépend intrinsèquement de la puissance de la centrale solaire et du profil de consommation du site.';
      const introSyntheseLines = doc.splitTextToSize(introSynthese, usableW);
      checkPageBreak(this._lineHeight(introSyntheseLines.length, 12) + 6);
      doc.text(introSyntheseLines, ml, y);
      y += this._lineHeight(introSyntheseLines.length, 12) + 6;

      // Tableau des modes de valorisation — vert clair (demande explicite : même couleur que la
      // page "Vos Garanties", également reprise pour le bandeau "Contactez-nous" de "Passez à
      // l'action", cf. PdfResidentialReportGenerator.js).
      checkPageBreak(20);
      doc.autoTable({
        startY: y,
        head: [['Mode de valorisation', 'Cible (Puissance)', 'Description et Recommandation']],
        body: [
          ['Autoconsommation', 'Petites installations (0 - 100 kWc)', 'Modèle économique à privilégier pour réduire directement la facture énergétique sur site.'],
          ['Autoconsommation individuelle et collective', 'Plus grosses puissances', "Permet de partager et de valoriser l'énergie produite entre plusieurs points de consommation locaux."],
          ["Appel d'offres (OA)", 'Grandes installations (> 100 kWc)', "Mécanisme de vente régi par les appels d'offres de l'État, soumis au respect strict du calendrier gouvernemental."],
          ['Marché Libre / PPA', 'Gros consommateurs', "Contrat de vente d'énergie de gré à gré (Power Purchase Agreement) fixant le prix et la durée librement entre le producteur et l'acheteur final."],
        ],
        theme: 'grid',
        margin: { left: ml, right: ml },
        styles: { fontSize: 10, font: 'helvetica', cellPadding: 3, textColor: [0, 0, 0], lineColor: [200, 200, 200], lineWidth: 0.2 },
        headStyles: { fillColor: [220, 252, 231], textColor: [22, 101, 52], fontStyle: 'bold', halign: 'center' },
        columnStyles: { 0: { fontStyle: 'bold' } },
        showHead: 'everyPage',
      });
      y = doc.lastAutoTable.finalY + 6;
      } // fin if (pays === 'France')


      // ═══════════════════════════════════════════════════════════════════
      // 7. OPTION RÉSEAU (si définie)
      // ═══════════════════════════════════════════════════════════════════
      const optionReseau = this.getOptionReseau();
      if (optionReseau && optionReseau !== 'N/A') {
        y += 4;
        checkPageBreak(12);
        y = this._writeOptionReseauPhrase(doc, y, optionReseau);
      }
      
      // for (let i = 0; i < pdfPages.length; i++) {
      //   const pageImage = pdfPages[i];
      //   doc.addPage('a4', 'portrait');

      //   const pageWidth = doc.internal.pageSize.getWidth();
      //   const pageHeight = doc.internal.pageSize.getHeight();
      //   const marginBottom = 25;
      //   const marginLeft = 15;
      //   const marginRight = 15;

      //   const topOffset = this.marginTop;

      //   // Sur la première page, réserver de l'espace en bas pour l'option réseau
      //   let bottomReserve = 0;
      //   if (i === 0 && optionReseau && optionReseau !== 'N/A') {
      //     const usableWidth = pageWidth - this.marginSide * 2;
      //     doc.setFontSize(12);
      //     const phrase = `•  Le projet a été conçu selon le schéma de raccordement suivant : ${optionReseau}.`;
      //     const lines = doc.splitTextToSize(phrase, usableWidth);
      //     bottomReserve = lines.length * (12 * 0.35) * 2.5 + 8;
      //   }

      //   const availableWidth = pageWidth - marginLeft - marginRight;
      //   const availableHeight = pageHeight - topOffset - marginBottom - bottomReserve;

      //   const img = new Image();
      //   await new Promise((resolve, reject) => {
      //     img.onload = resolve;
      //     img.onerror = reject;
      //     img.src = pageImage;
      //   });

      //   const aspectRatio = img.height / img.width;
      //   let imgWidth = availableWidth;
      //   let imgHeight = imgWidth * aspectRatio;

      //   if (imgHeight > availableHeight) {
      //     imgHeight = availableHeight;
      //     imgWidth = imgHeight / aspectRatio;
      //   }

      //   const xPos = (pageWidth - imgWidth) / 2;
      //   const yPos = topOffset + (availableHeight - imgHeight) / 2;

      //   doc.addImage(pageImage, 'PNG', xPos, yPos, imgWidth, imgHeight, undefined, 'FAST');

      //   // Sur la première page, écrire l'option réseau en bas de page
      //   if (i === 0 && optionReseau && optionReseau !== 'N/A') {
      //     const textY = pageHeight - marginBottom - bottomReserve + 4;
      //     this._writeOptionReseauPhrase(doc, textY, optionReseau);
      //   }

      //   console.log(`✅ Page système ${i + 1}/${pdfPages.length} ajoutée au PDF`);
      // }

    } catch (error) {
      console.error('❌ Erreur lors de l\'ajout de la page système:', error);
    }
  }

  /**
   * Charge un fichier PDF et le convertit en images (une par page)
   * Utilise pdf.js pour le rendu
   */
  // async loadPdfAsImages(pdfPath) {
  //   try {
  //     // Vérifier que pdf.js est chargé
  //     if (typeof pdfjsLib === 'undefined') {
  //       console.error('❌ pdf.js n\'est pas chargé');
  //       console.warn('   Ajoutez <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script> dans votre HTML');
  //       return null;
  //     }

  //     // Charger le PDF
  //     const loadingTask = pdfjsLib.getDocument(pdfPath);
  //     const pdf = await loadingTask.promise;

  //     console.log(`📄 PDF chargé: ${pdf.numPages} page(s)`);

  //     const pages = [];

  //     // Parcourir toutes les pages et les convertir en images
  //     for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
  //       const page = await pdf.getPage(pageNum);

  //       // Définir l'échelle pour une bonne qualité
  //       const scale = 2.0;
  //       const viewport = page.getViewport({ scale: scale });

  //       // Créer un canvas pour le rendu
  //       const canvas = document.createElement('canvas');
  //       const context = canvas.getContext('2d');
  //       canvas.width = viewport.width;
  //       canvas.height = viewport.height;

  //       // Rendre la page sur le canvas
  //       const renderContext = {
  //         canvasContext: context,
  //         viewport: viewport
  //       };

  //       await page.render(renderContext).promise;

  //       // Convertir le canvas en image base64
  //       const imageData = canvas.toDataURL('image/png');
  //       pages.push(imageData);

  //       console.log(`✅ Page ${pageNum} rendue`);
  //     }

  //     return pages;

  //   } catch (error) {
  //     console.error('❌ Erreur lors du chargement du PDF:', error);
  //     return null;
  //   }
  // }
}
