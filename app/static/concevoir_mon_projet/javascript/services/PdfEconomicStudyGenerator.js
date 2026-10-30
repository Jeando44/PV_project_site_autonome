/**
 * PdfEconomicStudyGenerator - Génère l'étude économique
 * Récupère les tableaux et données de Etudes_Economique.html
 */

import PdfUtilities from './PdfUtilities.js';

export default class PdfEconomicStudyGenerator {
  constructor() {
    this.marginTop = 35;
    this.marginBottom = 35; // Marge pour éviter les pieds de page
  }

  /**
   * Ajoute l'étude économique au PDF
   * Format similaire au PDF généré dans etudes_economique_content.html
   */
  async addEconomicStudy(doc) {
    console.log('💰 Ajout de l\'Étude Économique...');

    // SÉCURITÉ : VÉRIFICATION DES DONNÉES FALSIFIÉES AVANT EXPORT GLOBAL
    if (typeof window.verifyWithBackend === 'function') {
      const isValid = await window.verifyWithBackend();
      // SÉCURITÉ DÉSACTIVÉE TEMPORAIREMENT
      // if (!isValid) {
      //   alert("⚠️ Sécurité : Falsification des données économiques détectée ! La génération du rapport a été bloquée.");
      //   throw new Error("Sécurité : Falsification des données économiques détectée");
      // }
    }

    // Vérifier si les données économiques sont disponibles
    const hasEconomicData = this.checkEconomicDataAvailable();

    if (!hasEconomicData) {
      console.warn('⚠️ Données économiques non disponibles - étude non ajoutée');
      return;
    }

    // --- PAGE 1: Résultats (A4 Portrait) ---
    doc.addPage('a4', 'portrait');
    let yPos = this.marginTop + 10; // 45mm pour éviter l'en-tête

    // Titre
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Résultats', 15, yPos);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    yPos += 10;

    // Texte d'introduction
    const horizon = this.getFieldValue('horizon') || '20';
    doc.text(`La modélisation financière du projet est réalisée sur une durée de ${horizon} ans.`, 15, yPos);
    yPos += 15;

    // 1. Tableau CAPEX
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text("Tableau du CAPEX (Coûts d'investissement)", 15, yPos);
    doc.setFont('helvetica', 'normal');
    yPos += 5;

    const capexData = this.getCapexDataFromDOM();
    if (capexData.length > 0) {
      doc.autoTable({
        startY: yPos,
        head: [['Désignation', 'Montant (k€)']],
        body: capexData,
        theme: 'grid',
        styles: { fontSize: 10, halign: 'center' },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' },
        columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' } },
        margin: { left: 15, right: 15, top: this.marginTop, bottom: this.marginBottom }
      });
      yPos = doc.lastAutoTable.finalY + 15;
    }

    // 2. Tableau OPEX
    yPos = this.checkSpace(doc, yPos, 60);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text("Tableau des OPEX (Charges d'exploitations)", 15, yPos);
    doc.setFont('helvetica', 'normal');
    yPos += 5;

    const opexData = this.getOpexDataFromDOM();
    if (opexData.length > 0) {
      doc.autoTable({
        startY: yPos,
        head: [['Désignation', 'Montant (k€/an)']],
        body: opexData,
        theme: 'grid',
        styles: { fontSize: 10, halign: 'center' },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' },
        columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' } },
        margin: { left: 15, right: 15, top: this.marginTop, bottom: this.marginBottom }
      });
      yPos = doc.lastAutoTable.finalY + 15;
    }

    // --- NOUVEAU TABLEAU: FACTURATION OU REVENTE ---
    yPos = this.checkSpace(doc, yPos, 60);
    const tauxAutoValue = parseFloat(this.getFieldValue('taux_autoconsommation')) || 0;

    if (tauxAutoValue > 0) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Tableau donnée de facturation d’électricité réseau', 15, yPos);
      doc.setFont('helvetica', 'normal');
      yPos += 5;

      const resultatPondereEl = document.getElementById('resultat_tarif_pondere');
      const tarifPondere = resultatPondereEl ? resultatPondereEl.innerText : (this.getFieldValue('prix_achat_elec') || "0");

      const facturationRows = [
        ['Tarif de soutirage HP Hiver (€/MWh)', this.getFieldValue('tarif_hiver_input') || "0"],
        ['Tarif de soutirage HP Été (€/MWh)', this.getFieldValue('tarif_ete_input') || "0"],
        ['Tarif pondéré calculé (€/MWh)', tarifPondere],
        ['Indexation facture élec. (%/an)', this.getFieldValue('indexation_achat') || "0"]
      ];
      if (typeof window.lignesBatterieVirtuellePdf === 'function') facturationRows.push(...window.lignesBatterieVirtuellePdf());
      doc.autoTable({ startY: yPos, head: [['Indicateurs', 'Valeur/Montant']], body: facturationRows, theme: 'grid', styles: { fontSize: 10, halign: 'center' }, headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' }, columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' } }, margin: { left: 15, right: 15, top: this.marginTop, bottom: this.marginBottom } });
      yPos = doc.lastAutoTable.finalY + 15;
    } else {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Tableau donnée de revente en injection réseau', 15, yPos);
      doc.setFont('helvetica', 'normal');
      yPos += 5;

      const reventeRows = [
        ['Tarif Vente Totale (€/MWh)', this.getFieldValue('pal_t_1') || "0"]
      ];
      doc.autoTable({ startY: yPos, head: [['Indicateurs', 'Valeur/Montant']], body: reventeRows, theme: 'grid', styles: { fontSize: 10, halign: 'center' }, headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' }, columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' } }, margin: { left: 15, right: 15, top: this.marginTop, bottom: this.marginBottom } });
      yPos = doc.lastAutoTable.finalY + 15;
    }

    // --- PAGE 2: Financement et Indicateurs (A4 Portrait) ---
    doc.addPage('a4', 'portrait');
    yPos = this.marginTop + 10;

    // 3. Tableau du financement
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Tableau du financement du projet', 15, yPos);
    doc.setFont('helvetica', 'normal');
    yPos += 5;

    const financeData = this.getFinanceDataFromDOM();
    if (financeData.length > 0) {
      doc.autoTable({
        startY: yPos,
        head: [['Indicateur', 'Valeur']],
        body: financeData,
        theme: 'grid',
        styles: { fontSize: 10, halign: 'center' },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' },
        columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' } },
        margin: { left: 15, right: 15, top: this.marginTop, bottom: this.marginBottom }
      });
      yPos = doc.lastAutoTable.finalY + 15;
    }

    // 4. Données clés des résultats
    yPos = this.checkSpace(doc, yPos, 60);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Données clés des résultats du projet', 15, yPos);
    doc.setFont('helvetica', 'normal');
    yPos += 5;

    const indicatorsData = this.getIndicatorsDataFromDOM();
    if (indicatorsData.length > 0) {
      doc.autoTable({
        startY: yPos,
        head: [['Indicateur', 'Valeur']],
        body: indicatorsData,
        theme: 'grid',
        styles: { fontSize: 10, halign: 'center' },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' },
        columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' } },
        margin: { left: 15, right: 15, top: this.marginTop, bottom: this.marginBottom }
      });
      yPos = doc.lastAutoTable.finalY + 10;
    }

    // --- PAGE 3: Graphiques et flux (A3 Paysage) ---
    await this.addFluxPage(doc);

    console.log('✅ Étude Économique ajoutée');
  }

  /**
   * Vérifie si les données économiques sont disponibles
   */
  checkEconomicDataAvailable() {
    // Méthode 1: Vérifier dans le DOM
    const totalCapex = document.getElementById('total_capex_display');
    if (totalCapex && totalCapex.textContent && totalCapex.textContent.trim() !== '') {
      console.log('✅ Données CAPEX trouvées dans le DOM');

      // Vérifier et afficher la dégradation
      this.checkDegradationValue();

      return true;
    }

    // Méthode 2: Vérifier dans localStorage
    try {
      const savedData = localStorage.getItem('solarProjectData');
      if (savedData) {
        const projectData = JSON.parse(savedData);
        if (projectData.economicData && projectData.economicData.capex) {
          console.log('✅ Données CAPEX trouvées dans localStorage');

          // Vérifier et afficher la dégradation
          this.checkDegradationValue();

          return true;
        }
      }
    } catch (error) {
      console.warn('⚠️ Erreur lors de la vérification dans localStorage:', error);
    }

    console.warn('⚠️ Données CAPEX non disponibles (ni dans DOM, ni dans localStorage)');
    return false;
  }

  /**
   * Vérifie et affiche la valeur de dégradation récupérée
   */
  checkDegradationValue() {
    let degradationFound = false;

    // Vérifier depuis le champ HTML
    const degradationField = document.getElementById('degradation');
    if (degradationField && degradationField.value) {
      console.log(`✅ Dégradation (depuis DOM) = ${degradationField.value}%`);
      degradationFound = true;
    }

    // Vérifier depuis localStorage
    try {
      const savedData = localStorage.getItem('solarProjectData');
      if (savedData) {
        const projectData = JSON.parse(savedData);

        // Vérifier plusieurs emplacements possibles
        if (projectData.projectInfo && projectData.projectInfo.coefficientDegradation) {
          console.log(`✅ Dégradation (depuis localStorage.projectInfo) = ${projectData.projectInfo.coefficientDegradation}%`);
          degradationFound = true;
        } else if (projectData.formData) {
          // Vérifier dans formData (premier PV)
          const firstPvId = Object.keys(projectData.formData)[0];
          if (firstPvId && projectData.formData[firstPvId].coefficientDegradation) {
            console.log(`✅ Dégradation (depuis formData.${firstPvId}) = ${projectData.formData[firstPvId].coefficientDegradation}%`);
            degradationFound = true;
          }
        }

        // Vérifier aussi dans totals si disponible
        if (projectData.totals) {
          console.log('📊 Totaux disponibles:', {
            totalPower: projectData.totals.totalPower,
            avgProductible: projectData.totals.avgProductible
          });
        }

        if (!degradationFound) {
          console.log('ℹ️ Dégradation non trouvée dans localStorage (ce paramètre est optionnel)');
        }
      }
    } catch (error) {
      console.warn('⚠️ Erreur lors de la vérification de la dégradation dans localStorage:', error);
    }
  }

  /**
   * Ajoute le tableau CAPEX
   */
  async addCapexTable(doc, yPos) {
    try {
      // Titre CAPEX
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('1. CAPEX (Coûts d\'investissement)', 20, yPos);
      doc.setTextColor('#000000');
      doc.setFont('helvetica', 'normal');
      yPos += 8;

      // Récupérer les données CAPEX
      const capexRows = this.getCapexData();

      if (capexRows.length > 0) {
        doc.autoTable({
          startY: yPos,
          head: [['Désignation', 'Montant (k€)']],
          body: capexRows,
          theme: 'grid',
          styles: {
            fontSize: 10,
            font: 'helvetica',
            cellPadding: 3,
            textColor: [0, 0, 0],
            halign: 'center',
          },
          headStyles: {
            fillColor: [240, 240, 240],
            textColor: [0, 0, 0],
            halign: 'center',
            fontStyle: 'bold',
          },
          columnStyles: {
            0: { halign: 'left' },
            1: { halign: 'right' },
          },
        });

        yPos = doc.lastAutoTable.finalY + 15;
        console.log('✅ Tableau CAPEX ajouté');
      }

      return yPos;
    } catch (error) {
      console.error('❌ Erreur lors de l\'ajout du tableau CAPEX:', error);
      return yPos;
    }
  }

  /**
   * Méthodes utilitaires pour la gestion de l'espace et des pages
   */
  getFieldValue(fieldId) {
    const element = document.getElementById(fieldId);
    return element ? element.value : '';
  }

  checkSpace(doc, currentY, requiredSpace) {
    // Utiliser marginBottom pour éviter la superposition avec le pied de page
    if (currentY + requiredSpace > doc.internal.pageSize.height - this.marginBottom) {
      doc.addPage();
      return this.marginTop + 10; // Retourner une position avec marge suffisante
    }
    return currentY;
  }

  getCurrentY(_doc, yPos) {
    return yPos;
  }

  /**
   * Récupère les données CAPEX depuis le DOM (pour le PDF)
   */
  getCapexDataFromDOM() {
    const rows = [];
    const totalCapex = document.getElementById('total_capex_display');
    const ratioCapex = document.getElementById('ratio_capex_display');

    if (totalCapex && totalCapex.textContent) {
      rows.push(['Total CAPEX', totalCapex.textContent.trim()]);
    }
    if (ratioCapex && ratioCapex.textContent) {
      rows.push(['Ratio €/Wc', ratioCapex.textContent.trim()]);
    }

    return rows;
  }

  /**
   * Récupère les données OPEX depuis le DOM (pour le PDF)
   */
  getOpexDataFromDOM() {
    const rows = [];
    const totalOpex = document.getElementById('total_opex_display');
    const ratioOpex = document.getElementById('ratio_opex_display');

    if (totalOpex && totalOpex.textContent) {
      rows.push(['Total OPEX', totalOpex.textContent.trim()]);
    }
    if (ratioOpex && ratioOpex.textContent) {
      rows.push(['Ratio €/Wc/an', ratioOpex.textContent.trim()]);
    }

    return rows;
  }

  /**
   * Récupère les données de financement depuis le DOM
   */
  getFinanceDataFromDOM() {
    const rows = [];
    const fpPct = this.getFieldValue('fp_pct');

    if (fpPct) {
      rows.push(['Fonds propres (%)', fpPct]);
    }

    // Vérifier si la dette est activée
    const detteToggle = document.querySelector('input[name="dette_toggle"]:checked');
    if (detteToggle && detteToggle.value === 'oui') {
      const tauxDette = this.getFieldValue('taux_dette');
      const maturite = this.getFieldValue('maturite_dette');
      const interet = this.getFieldValue('res_int_annuel');
      const annuite = this.getFieldValue('res_annuite_est');

      if (tauxDette) rows.push(['Taux d\'intérêt (%)', tauxDette]);
      if (maturite) rows.push(['Maturité (ans)', maturite]);
      if (interet) rows.push(['Intérêt annuel estimé (k€)', interet]);
      if (annuite) rows.push(['Annuité estimée (k€)', annuite]);
    }

    return rows;
  }

  /**
   * Récupère les indicateurs financiers depuis le DOM
   */
  getIndicatorsDataFromDOM() {
    const rows = [];
    
    const indicatorsPart1 = [
      { id: 'res_van', label: 'VAN projet' },
      { id: 'res_tri_p', label: 'TRI projet' },
      { id: 'res_tri_fp', label: 'TRI fonds propres' },
      { id: 'res_total_opex', label: 'Total OPEX' },
      { id: 'res_lcoe', label: 'LCOE production' }
    ];

    indicatorsPart1.forEach(indicator => {
      const element = document.getElementById(indicator.id);
      if (element && element.innerText) {
        let val = element.innerText.trim();
        if (indicator.id === 'res_lcoe' && val !== '-' && !val.includes('€/MWh')) val += ' €/MWh';
        rows.push([indicator.label, val]);
      }
    });

    const tauxAutoValue = parseFloat(this.getFieldValue('taux_autoconsommation')) || 0;
    const cardLcoeFacture = document.getElementById('card_lcoe_facture');
    const lcoeFactureEl = document.getElementById('res_lcoe_facture');

    if ((cardLcoeFacture && cardLcoeFacture.style.display !== 'none') || tauxAutoValue > 0) {
      let val = lcoeFactureEl ? lcoeFactureEl.innerText.trim() : '-';
      if (val !== '-' && !val.includes('€/MWh')) val += ' €/MWh';
      rows.push(['LCOE Soutirage', val]);
    }

    const indicatorsPart2 = [
      { id: 'res_pb_brut', label: 'Payback brut fonds propres' },
      { id: 'res_pb_act', label: 'Payback actualisé fonds propre' },
      { id: 'res_gains_act_final', label: 'Gain cumulés actualisé' },
      { id: 'res_gains_non_act', label: 'Gains nets non actualisés' }
    ];

    indicatorsPart2.forEach(indicator => {
      const element = document.getElementById(indicator.id);
      if (element && element.innerText) {
        rows.push([indicator.label, element.innerText.trim()]);
      }
    });

    // NOUVEAU (demande explicite, non calculé jusqu'ici dans ce rapport — c'est CE générateur,
    // pas EtudesEconomiqueLogic.js::exportPDF(), qui alimente réellement "Données clés des
    // résultats du projet" ici, via ExportService.js::addEconomicStudy()) :
    // Gain annuel moyen (€ HT/an) = Gain cumulés actualisé (k€) / Horizon du projet (années).
    const gainsCumActEl = document.getElementById('res_gains_act_final');
    const gainsCumActNum = gainsCumActEl ? parseFloat(gainsCumActEl.innerText) || 0 : 0;
    const horizonAns = parseFloat(this.getFieldValue('horizon')) || 0;
    if (gainsCumActEl && horizonAns > 0) {
      const gainAnnuelMoyen = ((gainsCumActNum * 1000) / horizonAns).toFixed(2) + ' €';
      rows.push(['Gain annuel moyen (€ HT/an)', gainAnnuelMoyen]);
    }

    return rows;
  }

  /**
   * Ajoute la page des flux (A3 paysage)
   */
  async addFluxPage(doc) {
    try {
      doc.addPage('a3', 'landscape');

      // Utiliser une marge appropriée pour la page A3 paysage
      const startY = this.marginTop + 15; // ~40mm pour éviter l'en-tête

      doc.setFontSize(22);
      doc.setTextColor(0, 0, 0);
      doc.text('Graphique des flux financiers', 15, startY);
      doc.setTextColor(0, 0, 0);

      // Ajouter les graphiques côte à côte
      const tauxAuto = parseFloat(this.getFieldValue('taux_autoconsommation')) || 0;

      let xImg = 15;
      let graphY = startY + 12;
      
      const fcfActChartImg = window.getChartImageData('fcfActChart');
      if (fcfActChartImg) {
        doc.addImage(fcfActChartImg, 'PNG', xImg, graphY, 190, 85);
      }

      if (tauxAuto > 0) {
        const factureChartImg = window.getChartImageData('factureChart');
        if (factureChartImg) doc.addImage(factureChartImg, 'PNG', xImg + 200, graphY, 190, 85);
      }

      const cumFlowChartImg = window.getChartImageData('cumFlowChart');
      if (cumFlowChartImg) {
        doc.addImage(cumFlowChartImg, 'PNG', 115, graphY + 90, 190, 85);
      }

      // Ajouter le tableau annuel
      let tableY = graphY + 230; // Position du titre après les 2 rangées de graphiques
      
      if (tableY + 120 > doc.internal.pageSize.getHeight() - this.marginBottom) {
        doc.addPage('a3', 'landscape');
        tableY = this.marginTop + 15;
      }

      doc.setFontSize(16);
      doc.setTextColor(0, 0, 0);
      doc.text('Tableau annuel des flux (k€)', 15, tableY);

      const resultsTable = document.getElementById('results-table');
      if (resultsTable) {
        doc.autoTable({
          html: '#results-table',
          startY: tableY + 8, // Commencer le tableau après le titre
          styles: { fontSize: 8, halign: 'center' },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0] },
          margin: { left: 15, right: 15, top: this.marginTop, bottom: this.marginBottom },
          pageBreak: 'avoid',
          // Callback pour gérer les nouvelles pages automatiques
          didDrawPage: (data) => {
            // S'assurer que sur les nouvelles pages, le contenu commence après l'en-tête
            if (data.pageNumber > 1 && data.cursor) {
              data.cursor.y = Math.max(data.cursor.y, this.marginTop);
            }
          }
        });
        console.log('✅ Tableau des flux ajouté');
      }
    } catch (error) {
      console.error('❌ Erreur lors de l\'ajout de la page des flux:', error);
    }
  }

  /**
   * Récupère les données CAPEX (ancienne méthode - conservée pour compatibilité)
   */
  getCapexData() {
    const rows = [];

    // Liste des éléments CAPEX à récupérer
    const capexItems = [
      { id: 'panneaux_display', label: 'Panneaux photovoltaïques', key: 'panneaux' },
      { id: 'onduleurs_display', label: 'Onduleurs', key: 'onduleurs' },
      { id: 'structure_display', label: 'Structure de support', key: 'structure' },
      { id: 'electricite_display', label: 'Équipements électriques', key: 'electricite' },
      { id: 'etudes_display', label: 'Études et ingénierie', key: 'etudes' },
      { id: 'installation_display', label: 'Installation et main d\'œuvre', key: 'installation' },
      { id: 'raccordement_display', label: 'Raccordement réseau', key: 'raccordement' },
      { id: 'autres_capex_display', label: 'Autres coûts', key: 'autres' },
    ];

    // Essayer de récupérer depuis le DOM d'abord
    let hasDataFromDOM = false;
    capexItems.forEach(item => {
      const element = document.getElementById(item.id);
      if (element && element.textContent && element.textContent.trim() !== '') {
        rows.push([item.label, element.textContent.trim()]);
        hasDataFromDOM = true;
      }
    });

    // Si pas de données dans le DOM, essayer localStorage
    if (!hasDataFromDOM) {
      try {
        const savedData = localStorage.getItem('solarProjectData');
        if (savedData) {
          const projectData = JSON.parse(savedData);
          if (projectData.economicData && projectData.economicData.capex) {
            const capexData = projectData.economicData.capex;
            capexItems.forEach(item => {
              if (capexData[item.key]) {
                rows.push([item.label, capexData[item.key]]);
              }
            });
            console.log('📋 Données CAPEX chargées depuis localStorage');
          }
        }
      } catch (error) {
        console.warn('⚠️ Erreur lors du chargement CAPEX depuis localStorage:', error);
      }
    }

    // Total CAPEX et ratio
    const totalCapex = document.getElementById('total_capex_display');
    const ratioCapex = document.getElementById('ratio_capex_display');

    if (totalCapex && totalCapex.textContent) {
      rows.push(['Total CAPEX', totalCapex.textContent.trim()]);
    } else {
      // Essayer depuis localStorage
      try {
        const savedData = localStorage.getItem('solarProjectData');
        if (savedData) {
          const projectData = JSON.parse(savedData);
          if (projectData.economicData && projectData.economicData.capex) {
            if (projectData.economicData.capex.total) {
              rows.push(['Total CAPEX', projectData.economicData.capex.total]);
            }
            if (projectData.economicData.capex.ratio) {
              rows.push(['Ratio €/Wc', projectData.economicData.capex.ratio]);
            }
          }
        }
      } catch (error) {
        console.warn('⚠️ Erreur lors du chargement totaux CAPEX depuis localStorage:', error);
      }
    }

    if (ratioCapex && ratioCapex.textContent) {
      rows.push(['Ratio €/Wc', ratioCapex.textContent.trim()]);
    }

    return rows;
  }

  /**
   * Ajoute le tableau OPEX
   */
  async addOpexTable(doc, yPos) {
    try {
      // Vérifier si on a assez de place
      const pageHeight = doc.internal.pageSize.getHeight();
      if (yPos > pageHeight - this.marginBottom - 60) {
        doc.addPage();
        yPos = this.marginTop;
      }

      // Titre OPEX
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('2. OPEX (Coûts d\'exploitation)', 20, yPos);
      doc.setTextColor('#000000');
      doc.setFont('helvetica', 'normal');
      yPos += 8;

      // Récupérer les données OPEX
      const opexRows = this.getOpexData();

      if (opexRows.length > 0) {
        doc.autoTable({
          startY: yPos,
          head: [['Désignation', 'Montant (k€/an)']],
          body: opexRows,
          theme: 'grid',
          styles: {
            fontSize: 10,
            font: 'helvetica',
            cellPadding: 3,
            textColor: [0, 0, 0],
            halign: 'center',
          },
          headStyles: {
            fillColor: [240, 240, 240],
            textColor: [0, 0, 0],
            halign: 'center',
            fontStyle: 'bold',
          },
          columnStyles: {
            0: { halign: 'left' },
            1: { halign: 'right' },
          },
        });

        yPos = doc.lastAutoTable.finalY + 15;
        console.log('✅ Tableau OPEX ajouté');
      }

      return yPos;
    } catch (error) {
      console.error('❌ Erreur lors de l\'ajout du tableau OPEX:', error);
      return yPos;
    }
  }

  /**
   * Récupère les données OPEX
   */
  getOpexData() {
    const rows = [];

    // Liste des éléments OPEX à récupérer
    const opexItems = [
      { id: 'maintenance_display', label: 'Maintenance préventive', key: 'maintenance' },
      { id: 'assurance_display', label: 'Assurance', key: 'assurance' },
      { id: 'monitoring_display', label: 'Monitoring et gestion', key: 'monitoring' },
      { id: 'loyer_display', label: 'Loyer / redevance', key: 'loyer' },
      { id: 'autres_opex_display', label: 'Autres coûts annuels', key: 'autres' },
    ];

    // Essayer de récupérer depuis le DOM d'abord
    let hasDataFromDOM = false;
    opexItems.forEach(item => {
      const element = document.getElementById(item.id);
      if (element && element.textContent && element.textContent.trim() !== '') {
        rows.push([item.label, element.textContent.trim()]);
        hasDataFromDOM = true;
      }
    });

    // Si pas de données dans le DOM, essayer localStorage
    if (!hasDataFromDOM) {
      try {
        const savedData = localStorage.getItem('solarProjectData');
        if (savedData) {
          const projectData = JSON.parse(savedData);
          if (projectData.economicData && projectData.economicData.opex) {
            const opexData = projectData.economicData.opex;
            opexItems.forEach(item => {
              if (opexData[item.key]) {
                rows.push([item.label, opexData[item.key]]);
              }
            });
            console.log('📋 Données OPEX chargées depuis localStorage');
          }
        }
      } catch (error) {
        console.warn('⚠️ Erreur lors du chargement OPEX depuis localStorage:', error);
      }
    }

    // Total OPEX et ratio
    const totalOpex = document.getElementById('total_opex_display');
    const ratioOpex = document.getElementById('ratio_opex_display');

    if (totalOpex && totalOpex.textContent) {
      rows.push(['Total OPEX', totalOpex.textContent.trim()]);
    } else {
      // Essayer depuis localStorage
      try {
        const savedData = localStorage.getItem('solarProjectData');
        if (savedData) {
          const projectData = JSON.parse(savedData);
          if (projectData.economicData && projectData.economicData.opex) {
            if (projectData.economicData.opex.total) {
              rows.push(['Total OPEX', projectData.economicData.opex.total]);
            }
            if (projectData.economicData.opex.ratio) {
              rows.push(['Ratio €/Wc/an', projectData.economicData.opex.ratio]);
            }
          }
        }
      } catch (error) {
        console.warn('⚠️ Erreur lors du chargement totaux OPEX depuis localStorage:', error);
      }
    }

    if (ratioOpex && ratioOpex.textContent) {
      rows.push(['Ratio €/Wc/an', ratioOpex.textContent.trim()]);
    }

    return rows;
  }

  /**
   * Ajoute les indicateurs financiers
   */
  async addFinancialIndicators(doc, yPos) {
    try {
      // Vérifier si on a assez de place
      const pageHeight = doc.internal.pageSize.getHeight();
      if (yPos > pageHeight - this.marginBottom - 60) {
        doc.addPage();
        yPos = this.marginTop;
      }

      // Titre
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('3. Indicateurs financiers', 20, yPos);
      doc.setTextColor('#000000');
      doc.setFont('helvetica', 'normal');
      yPos += 8;

      // Récupérer les indicateurs
      const indicators = this.getFinancialIndicators();

      if (indicators.length > 0) {
        doc.autoTable({
          startY: yPos,
          head: [['Indicateur', 'Valeur']],
          body: indicators,
          theme: 'grid',
          styles: {
            fontSize: 10,
            font: 'helvetica',
            cellPadding: 3,
            textColor: [0, 0, 0],
            halign: 'center',
          },
          headStyles: {
            fillColor: [240, 240, 240],
            textColor: [0, 0, 0],
            halign: 'center',
            fontStyle: 'bold',
          },
          columnStyles: {
            0: { halign: 'left' },
            1: { halign: 'right' },
          },
        });

        yPos = doc.lastAutoTable.finalY + 15;
        console.log('✅ Indicateurs financiers ajoutés');
      }

      return yPos;
    } catch (error) {
      console.error('❌ Erreur lors de l\'ajout des indicateurs financiers:', error);
      return yPos;
    }
  }

  /**
   * Récupère les indicateurs financiers
   */
  getFinancialIndicators() {
    const rows = [];

    // Liste des indicateurs à récupérer
    const indicators = [
      { id: 'van_display', label: 'VAN (Valeur Actuelle Nette)', key: 'van' },
      { id: 'tri_display', label: 'TRI (Taux de Rentabilité Interne)', key: 'tri' },
      { id: 'pri_display', label: 'PRI (Période de Retour sur Investissement)', key: 'pri' },
      { id: 'lcoe_display', label: 'LCOE (Coût actualisé de l\'énergie)', key: 'lcoe' },
    ];

    // Essayer de récupérer depuis le DOM d'abord
    let hasDataFromDOM = false;
    indicators.forEach(item => {
      const element = document.getElementById(item.id);
      if (element && element.textContent && element.textContent.trim() !== '') {
        rows.push([item.label, element.textContent.trim()]);
        hasDataFromDOM = true;
      }
    });

    // Si pas de données dans le DOM, essayer localStorage
    if (!hasDataFromDOM) {
      try {
        const savedData = localStorage.getItem('solarProjectData');
        if (savedData) {
          const projectData = JSON.parse(savedData);
          if (projectData.economicData && projectData.economicData.indicators) {
            const indicatorsData = projectData.economicData.indicators;
            indicators.forEach(item => {
              if (indicatorsData[item.key]) {
                rows.push([item.label, indicatorsData[item.key]]);
              }
            });
            console.log('📋 Indicateurs financiers chargés depuis localStorage');
          }
        }
      } catch (error) {
        console.warn('⚠️ Erreur lors du chargement des indicateurs depuis localStorage:', error);
      }
    }

    return rows;
  }

  /**
   * Ajoute le graphique de rentabilité (si disponible)
   */
  async addRentabilityChart(doc, yPos) {
    // Chercher le canvas du graphique de rentabilité
    const rentabilityChart = document.getElementById('rentabilityChart');
    if (!rentabilityChart) {
      console.warn('⚠️ Graphique de rentabilité non trouvé');
      return yPos;
    }

    try {
      // Vérifier si on a assez de place
      const pageHeight = doc.internal.pageSize.getHeight();
      if (yPos > pageHeight - this.marginBottom - 90) {
        doc.addPage();
        yPos = this.marginTop;
      }

      // Titre
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('4. Graphique de rentabilité', 20, yPos);
      doc.setTextColor('#000000');
      doc.setFont('helvetica', 'normal');
      yPos += 10;

      const chartImage = rentabilityChart.toDataURL('image/png', 1.0);
      const chartWidth = 170;
      const chartHeight = (rentabilityChart.height * chartWidth) / rentabilityChart.width;

      doc.addImage(chartImage, 'PNG', 20, yPos, chartWidth, chartHeight);

      console.log('✅ Graphique de rentabilité ajouté');
      return yPos + chartHeight;
    } catch (error) {
      console.error('❌ Erreur lors de l\'ajout du graphique de rentabilité:', error);
      return yPos;
    }
  }
}
