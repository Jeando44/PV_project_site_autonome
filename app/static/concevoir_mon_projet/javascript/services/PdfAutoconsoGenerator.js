/**
 * PdfAutoconsoGenerator - Génère le rapport d'autoconsommation
 * Récupère les données simulées depuis le localStorage (solar_sim_data)
 * Affichage conditionnel : uniquement si mode de valorisation != "vente totale" ET != "marché libre"
 */

import PdfUtilities from './PdfUtilities.js';

export default class PdfAutoconsoGenerator {
  constructor() {
    this.marginTop = 35;
    this.marginBottom = 35; // Marge pour éviter les pieds de page
  }

  /**
   * Vérifie si le rapport d'autoconsommation (dans son ensemble, pages 2+) doit être ajouté.
   * "Marché libre" exclut tout. "Vente en totalité"/"vente totale" n'excluent plus que les pages
   * 2+ (Synthèse des Taux, Tableaux d'Analyse, Stockage) — la page 1 reste affichée dans ce cas,
   * cf. addAutoconsoReport() (demande explicite : "afficher tout le contenu de la page Analyse
   * d'autoconsommation [renommée Analyse de production] en vente en totalité, mais pas le reste").
   */
  shouldAddReport(projectData) {
    const mode = projectData?.modeDeValorisation?.toLowerCase().trim() || '';
    const shouldAdd = mode !== 'marché libre';
    console.log(`🔋 Rapport d'Autoconsommation: ${shouldAdd ? 'OUI' : 'NON'} (mode: ${mode})`);
    return shouldAdd;
  }

  /**
   * "Vente en totalité"/"vente totale" : seule la page 1 (renommée "Analyse de production")
   * reste affichée, tout le reste du rapport d'autoconsommation (Synthèse des Taux, Tableaux
   * d'Analyse, Stockage) reste masqué, comme c'était déjà le cas avant ce correctif.
   */
  isVenteEnTotalite(projectData) {
    const mode = projectData?.modeDeValorisation?.toLowerCase().trim() || '';
    return mode === 'vente en totalité' || mode === 'vente totale';
  }

  /**
   * solar_sim_data ne contient que les taux PV SEULS (le stockage n'y est jamais écrit) : sans cette
   * correction, le rapport gardait l'autoproduction/autoconsommation sans batterie. Applique le
   * résultat de stockage (solar_storage_data, effacé quand le stockage est retiré ou périmé) comme
   * main_autoconso.js::getStorageOverriddenSummary — mêmes clés de site, mêmes formules. Renvoie une
   * copie ; les participants ACC individuels restent inchangés (stockage = dispositif du site).
   */
  appliquerStockage(simData) {
    let sto = window.storageResults;
    if (!sto?.outputs) {
      try { sto = JSON.parse(localStorage.getItem('solar_storage_data') || 'null'); } catch (e) { sto = null; }
    }
    const o = sto?.outputs;
    if (!o || sto.errorMessage || o.taux_combine == null) return simData;

    const remplacerPart = (pie, tauxOrigine, nouveauTaux) => {
      if (!pie || !Array.isArray(pie.data) || pie.data.length !== 2) return pie;
      const idx = Math.abs(pie.data[0] - tauxOrigine) <= Math.abs(pie.data[1] - tauxOrigine) ? 0 : 1;
      const data = [...pie.data];
      data[idx] = nouveauTaux;
      data[1 - idx] = Math.max(0, 100 - nouveauTaux);
      return { ...pie, data };
    };

    const sites = { ...simData.sites };
    Object.keys(sites).forEach((cle) => {
      const site = sites[cle];
      const s = site?.summary;
      if (!s) return;
      const production = s.production_mwh || 0;
      let tauxAutoconso, pvConsomme;
      if (cle === 'Global' || cle === 'Cons. Totale') {
        tauxAutoconso = o.taux_combine; pvConsomme = o.sto_prod_autoconsommee;
      } else if (cle === 'Cons. existante') {
        tauxAutoconso = o.taux_ext; pvConsomme = production * (o.taux_ext / 100);
      } else if (cle === 'Cons. IRVE') {
        tauxAutoconso = o.taux_irve; pvConsomme = production * (o.taux_irve / 100);
      } else if (cle === 'Cons. PAC' && o.taux_pac != null) {
        tauxAutoconso = o.taux_pac; pvConsomme = production * (o.taux_pac / 100);
      } else {
        return;
      }
      if (tauxAutoconso == null || pvConsomme == null) return;
      const conso = s.consumption_mwh || 0;
      const tauxAutoprod = conso > 0 ? (pvConsomme / conso) * 100 : s.autoproduction_rate;
      const charts = site.charts || {};
      sites[cle] = {
        ...site,
        summary: {
          ...s,
          autoconsumption_rate: tauxAutoconso,
          autoproduction_rate: tauxAutoprod,
          pv_consumed_mwh: pvConsomme,
          surplus_mwh: Math.max(0, production - pvConsomme),
        },
        charts: {
          ...charts,
          pie_autoprod: remplacerPart(charts.pie_autoprod, s.autoproduction_rate, tauxAutoprod),
          pie_autocons: remplacerPart(charts.pie_autocons, s.autoconsumption_rate, tauxAutoconso),
        },
      };
    });
    return { ...simData, sites };
  }

  /**
   * Charge Chart.js à la volée si la librairie n'est pas trouvée
   */
  async loadChartJs() {
    if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') return true;
    
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.onload = () => {
        const pluginScript = document.createElement('script');
        pluginScript.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0';
        pluginScript.onload = () => {
          Chart.register(ChartDataLabels);
          // Enregistrement global : sans ce défaut, toutes les courbes de la page
          // (étude éco, etc.) afficheraient leurs valeurs brutes.
          Chart.defaults.plugins.datalabels.display = false;
          resolve(true);
        };
        pluginScript.onerror = () => resolve(false);
        document.head.appendChild(pluginScript);
      };
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  /**
   * Rend un graphique Pie en image Data URL de façon isolée
   */
  async renderPieChartToImage(chartData) {
    const canvas = document.createElement('canvas');
    canvas.width = 400; 
    canvas.height = 400;
    
    const container = document.createElement('div');
    container.style.width = '400px'; 
    container.style.height = '400px';
    container.style.position = 'fixed'; 
    container.style.left = '-9999px';
    container.appendChild(canvas);
    document.body.appendChild(container);

    const formattedLabels = chartData.data.map((val, i) => `${chartData.labels[i]} (${val.toFixed(2)}%)`);
    
    const chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: formattedLabels,
        datasets: [{ data: chartData.data, backgroundColor: chartData.colors, borderWidth: 2 }]
      },
      options: {
        responsive: false, 
        animation: false, 
        cutout: '60%',
        plugins: {
          legend: { display: true, position: 'bottom', labels: { font: { size: 10 } } },
          datalabels: { display: true, color: '#fff', font: { weight: 'bold' }, formatter: v => v > 5 ? v.toFixed(2) + '%' : '' }
        }
      }
    });
    
    return new Promise(resolve => {
      setTimeout(() => {
        const img = canvas.toDataURL('image/png');
        chart.destroy();
        document.body.removeChild(container);
        resolve(img);
      }, 300);
    });
  }

  /**
   * Rend un graphique Bar en image Data URL de façon isolée
   */
  async renderBarChartToImage(barData) {
    const canvas = document.createElement('canvas');
    canvas.width = 800; 
    canvas.height = 400;
    
    const container = document.createElement('div');
    container.style.width = '800px'; 
    container.style.height = '400px';
    container.style.position = 'fixed'; 
    container.style.left = '-9999px';
    container.appendChild(canvas);
    document.body.appendChild(container);

    const chart = new Chart(canvas, {
      type: 'bar',
      data: { labels: barData.labels, datasets: barData.datasets },
      options: {
        responsive: false, 
        animation: false,
        plugins: { 
          legend: { display: true, position: 'top' },
          datalabels: { display: false } // Bloque l'affichage des chiffres parasites sur les barres
        },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Énergie (MWh)' } },
          x: { grid: { display: false } }
        }
      }
    });
    
    return new Promise(resolve => {
      setTimeout(() => {
        const img = canvas.toDataURL('image/png');
        chart.destroy();
        document.body.removeChild(container);
        resolve(img);
      }, 300);
    });
  }

  /**
   * Ajoute le rapport d'autoconsommation au PDF
   */
  async addAutoconsoReport(doc, projectData, { projetAcc = false } = {}) {
    if (!this.shouldAddReport(projectData)) {
      console.log('⏭️ Rapport d\'autoconsommation ignoré (mode de valorisation non concerné)');
      return;
    }

    console.log('🔋 Ajout du Rapport d\'Autoconsommation...');
    const rawData = localStorage.getItem('solar_sim_data');
    
    if (!rawData) {
      console.warn('⚠️ Données d\'autoconsommation non disponibles - rapport non ajouté. Veuillez effectuer le calcul dans l\'analyseur.');
      return;
    }

    const simDataPvSeul = JSON.parse(rawData);
    if (!simDataPvSeul.site_keys || !simDataPvSeul.sites) {
      console.warn('⚠️ Format des données d\'autoconsommation invalide.');
      return;
    }
    // Taux avec batterie si un stockage a été calculé (cf. appliquerStockage).
    const simData = this.appliquerStockage(simDataPvSeul);

    const isVenteEnTotalite = this.isVenteEnTotalite(projectData);

    doc.addPage('a4', 'portrait');
    let yPos = this.marginTop + 10;

    await this.loadChartJs();
    const globalSite = simData.sites['Global'];

    // ==========================================
    // PAGE 1 : Analyse Mensuelle (MWh)
    // ==========================================

    doc.setTextColor(0, 0, 0);
    // NOUVEAU (demande explicite) : "Analyse de production" en vente en totalité, "Analyse
    // d'autoconsommation" pour les modes d'autoconsommation classiques — même page (texte,
    // tableaux, graphique), seul le titre change.
    const titrePage1 = isVenteEnTotalite ? 'Analyse de production' : "Analyse d'autoconsommation";
    yPos = PdfUtilities.addTextPosition(doc, titrePage1, yPos, 'bold', 17, 'left', 20);
    doc.setTextColor('#000000');
    yPos += 10;

    const introText = "Ce graphique présente l'analyse de la production solaire attendue sur la première année du projet, incluant la projection P50 (production médiane) versus la consommation existante du site.";
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(introText, 20, yPos, { align: 'justify', maxWidth: 170 });
    const introLines = doc.splitTextToSize(introText, 170); // Uniquement pour calculer le saut de ligne
    yPos += introLines.length * 6 + 10;

    // === NOUVEAUX TABLEAUX DE SYNTHÈSE ===
    doc.setFontSize(12); 
    doc.setFont('helvetica', 'bold'); 
    doc.text('Résultats de simulation production versus consommation (P50)', 105, yPos, { align: 'center' });
    yPos += 6;

    // Récupération des données réelles de production solaire (P50) envoyées par Python
    let sharedSolarStr = localStorage.getItem('sharedSolarProduction');
    let sharedSolar = sharedSolarStr ? JSON.parse(sharedSolarStr) : null;
    let puissanceProjet = sharedSolar?.summary?.peak_power_kw || projectData?.totals?.totalPower || 0;
    let productible = sharedSolar?.summary?.specific_production || projectData?.totals?.avgProductible || 0;

    // Récupération du PR initial réel
    let prValue = sharedSolar?.summary?.performance_ratio || (100 - (Number(projectData?.perteSysteme) || 14));

    let isStorageEnabled = false;
    if (projectData && projectData.contientStockage === true) {
        isStorageEnabled = true;
    } else if (simData && (simData.has_storage === true || simData.stockage_actif === true)) {
        isStorageEnabled = true;
    } else {
        const checkedInputs = document.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked, select');
        for (const input of checkedInputs) {
            const name = (input.name || '').toLowerCase();
            const id = (input.id || '').toLowerCase();
            const val = (input.value || '').toLowerCase();
            if ((name.includes('stocka') || id.includes('stocka') || name.includes('batt')) && 
                (val === 'oui' || val === 'true' || val === '1' || val === 'on')) {
                isStorageEnabled = true; break;
            }
        }
    }
    
    if (isStorageEnabled) {
        // Extraction de la valeur réelle envoyée par Python au lieu du calcul manuel
        if (window.storageResults?.outputs?.pr_final !== undefined) {
            prValue = window.storageResults.outputs.pr_final;
        } else if (simData?.storage_results?.outputs?.pr_final !== undefined) {
            prValue = simData.storage_results.outputs.pr_final;
        }
    }

    const maxPvHourly = globalSite?.summary?.max_hourly_pv_kw || Math.max(...(simData.hourly_data?.pv || [0]));
    
    // Fonction utilitaire pour formater les nombres en toute sécurité pour jsPDF
    // Remplace les espaces insécables (\u202F ou \u00A0) par un espace standard pour éviter les caractères parasites (/)
    const formatSafePDF = (val) => {
        return (Number(val) || 0).toLocaleString('fr-FR', {maximumFractionDigits:2}).replace(/[\u202F\u00A0\s]/g, ' ');
    };

    const table1Body = [
        ['Puissance projet', `${formatSafePDF(puissanceProjet)} kWc`],
        ['Production totale annuelle', `${formatSafePDF(globalSite?.summary?.production_mwh)} MWh`],
        ['Productible', `${formatSafePDF(productible)} kWh/kWc`],
        ['Pic de production horaire', `${formatSafePDF(maxPvHourly)} kWc`],
        ['Performance Ratio (PR)', `${formatSafePDF(prValue)} %`]
    ];

    const table2Body = [
        ['Énergie PV autoconsommée', `${formatSafePDF(globalSite?.summary?.pv_consumed_mwh)} MWh`],
        ['Excédent d\'énergie (Global)', `${formatSafePDF(globalSite?.summary?.surplus_mwh)} MWh`],
        ['Consommation totale', `${formatSafePDF(globalSite?.summary?.consumption_mwh)} MWh`],
        ['Taux d\'autoconsommation global', `${formatSafePDF(globalSite?.summary?.autoconsumption_rate)} %`],
        ['Taux d\'autoproduction global', `${formatSafePDF(globalSite?.summary?.autoproduction_rate)} %`]
    ];

    doc.autoTable({
        head: [['Indicateur', 'Valeur']],
        body: table1Body,
        startY: yPos,
        theme: 'grid',
        tableWidth: 85,
        margin: { left: 15 },
        styles: { fontSize: 9, cellPadding: 2, textColor: [0, 0, 0], halign: 'center', valign: 'middle' },
        headStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' }
    });
    const finalYTable1 = doc.lastAutoTable.finalY;

    doc.autoTable({
        head: [['Bilan d\'autoconsommation', 'Valeur']],
        body: table2Body,
        startY: yPos,
        theme: 'grid',
        tableWidth: 85,
        margin: { left: 110 },
        styles: { fontSize: 9, cellPadding: 2, textColor: [0, 0, 0], halign: 'center', valign: 'middle' },
        headStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' }
    });
    const finalYTable2 = doc.lastAutoTable.finalY;
    
    yPos = Math.max(finalYTable1, finalYTable2) + 20;

    
    // === FIN NOUVEAUX TABLEAUX ===

    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text('Analyse mensuelle (MWh)', 20, yPos);
    yPos += 10;

    if (globalSite && globalSite.charts) {
        const barImg = await this.renderBarChartToImage(globalSite.charts.monthly_bar);
        if (barImg) doc.addImage(barImg, 'PNG', 15, yPos, 180, 80);
    }

    // NOUVEAU (demande explicite) : en vente en totalité, seule la page 1 ci-dessus ("Analyse de
    // production") est affichée — Synthèse des Taux/Tableaux d'Analyse/Stockage restent masqués,
    // comme c'était déjà le cas avant ce correctif (shouldAddReport() ne bloquait auparavant pas
    // seulement ces pages-là, mais la totalité du rapport, y compris cette 1re page).
    if (isVenteEnTotalite) {
      console.log('⏭️ Pages 2+ du rapport d\'autoconsommation ignorées (vente en totalité)');
      return;
    }

    // ==========================================
    // PAGE 2 : Synthèse des Taux
    // ==========================================
    doc.addPage('a4', 'portrait');
    yPos = this.marginTop + 10;
    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('Synthèse des Taux', 20, yPos);
    yPos += 15;

    doc.setFontSize(14); doc.text('Tableau récapitulatif', 20, yPos);
    yPos += 8;

    try {
      const formatNum = (n) => (n != null ? n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00') + ' MWh';
      const formatPercent = (n) => (n != null ? n.toFixed(2) : '0.00') + ' %';

      const siteKeys = simData.site_keys.filter(k => k !== 'Global' && k !== 'Rés. Globaux');
      const headers = ['Indicateur', ...siteKeys];
      const sites = siteKeys.map(k => simData.sites[k]);

      const body = [
          ["Taux d'autoconsommation", ...sites.map(s => formatPercent(s.summary.autoconsumption_rate))],
          ["Taux d'autoproduction", ...sites.map(s => formatPercent(s.summary.autoproduction_rate))],
          ["Consommation totale", ...sites.map(s => formatNum(s.summary.consumption_mwh))],
          ["Énergie PV consommée", ...sites.map(s => formatNum(s.summary.pv_consumed_mwh))],
          ["Excédent d'énergie non consommé", ...sites.map(s => formatNum(s.summary.surplus_mwh))]
      ];

      doc.autoTable({
        head: [headers],
        body: body,
        startY: yPos,
        theme: 'grid',
        margin: { left: 20, right: 20 },
        styles: { fontSize: 10, font: 'helvetica', cellPadding: 3, textColor: [0, 0, 0], halign: 'center' },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' },
        // Colonne « Indicateur » à la largeur de son plus long libellé : titres et contenus sur une ligne.
        columnStyles: { 0: { cellWidth: 'wrap', halign: 'left' } },
        pageBreak: 'avoid'
      });
      yPos = doc.lastAutoTable.finalY + 15;
    } catch (error) {
      console.error('❌ Erreur lors de l\'ajout du tableau d\'autoconsommation:', error);
    }

    if (globalSite && globalSite.charts) {
        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.text('Analyse des taux (Autoproduction / Autoconsommation)', 20, yPos);
        yPos += 10;
        
        const pieAutoprodImg = await this.renderPieChartToImage(globalSite.charts.pie_autoprod);
        const pieAutoconsImg = await this.renderPieChartToImage(globalSite.charts.pie_autocons);

        doc.setFontSize(10); doc.setFont('helvetica', 'normal');
        doc.text(globalSite.charts.pie_autoprod.title, 55, yPos, {align: 'center'});
        doc.text(globalSite.charts.pie_autocons.title, 145, yPos, {align: 'center'});
        yPos += 5;

        if (pieAutoprodImg) doc.addImage(pieAutoprodImg, 'PNG', 20, yPos, 70, 70);
        if (pieAutoconsImg) doc.addImage(pieAutoconsImg, 'PNG', 110, yPos, 70, 70);
    }

    // ==========================================
    // PAGE 3 : Tableaux d'Analyse (masquée en autoconsommation collective : la page ne contenait
    // que son titre, demande explicite)
    // ==========================================
    if (!projetAcc) {
        doc.addPage('a4', 'portrait');
        yPos = this.marginTop + 10;
        doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('Tableaux d\'Analyse', 20, yPos);
        yPos += 15;

        const seasonalSection = document.getElementById('seasonal-analysis-section');
        if (seasonalSection) {
            const seasonalTables = seasonalSection.querySelectorAll('.seasonal-table');
            if (seasonalTables.length > 0) {
                const titles = ["Analyse mensuelle", "Analyse saisonnière consommation", "Analyse saisonnière production"];
            
                seasonalTables.forEach((table, index) => {
                    if (yPos > 240) { doc.addPage('a4', 'portrait'); yPos = this.marginTop + 10; }
                
                    doc.setFontSize(12); doc.setFont('helvetica', 'bold');
                    doc.text(titles[index] || "Analyse", 105, yPos, { align: 'center' });
                    yPos += 5;
                
                    doc.autoTable({
                        html: table,
                        startY: yPos,
                        theme: 'grid',
                        margin: { left: 20, right: 20 },
                        styles: { fontSize: 9, halign: 'center' },
                        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' },
                        pageBreak: 'avoid'
                    });
                    yPos = doc.lastAutoTable.finalY + 15;
                });
            } else {
                yPos = this.generateSeasonalTablesFromData(doc, simData, yPos);
            }
        } else {
            yPos = this.generateSeasonalTablesFromData(doc, simData, yPos);
        }
    }

    // ==========================================
    // PAGES 4 & 5 : Gestion du Stockage
    // ==========================================
    const storageContainer = document.getElementById('storage-results-container');
    const hasStorageContent = storageContainer && storageContainer.innerHTML.trim() !== '';

    const storageTable = storageContainer ? storageContainer.querySelector('.results-table') : null;
    const grids = storageContainer ? storageContainer.querySelectorAll('.grid.section-box') : [];
    const hasActualResults = (storageTable !== null) || (grids.length > 0);

    // Si le conteneur a de vrais résultats (ex: tableau généré), on force l'inclusion du stockage
    const shouldIncludeStorage = (isStorageEnabled && hasStorageContent) || hasActualResults;

    if (shouldIncludeStorage && storageContainer) {
        doc.addPage('a4', 'portrait');
        yPos = this.marginTop + 10;
        doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('Gestion du Stockage', 20, yPos);
        yPos += 15;

        grids.forEach((grid) => {
            const titleEl = grid.previousElementSibling;
            if (titleEl && titleEl.tagName === 'H4') {
                if (yPos > 240) { doc.addPage('a4', 'portrait'); yPos = this.marginTop + 10; }
                doc.setFontSize(12); doc.setFont('helvetica', 'bold');
                doc.text(titleEl.innerText, 105, yPos, { align: 'center' });
                yPos += 5;
            }
            
            const storageGroups = grid.querySelectorAll('.form-group');
            if (storageGroups.length > 0) {
                const storageData = [];
                storageGroups.forEach(group => {
                    const labelEl = group.querySelector('label');
                    const valEl = group.querySelector('input, select, .value, span:not(.label)');
                    if (labelEl && valEl) {
                        const val = (valEl.tagName === 'INPUT' || valEl.tagName === 'SELECT') ? valEl.value : valEl.textContent.trim();
                        if (val) {
                            storageData.push([labelEl.textContent.trim(), val]);
                        }
                    }
                });
                
                if (storageData.length > 0) {
                    doc.autoTable({
                        head: [['Caractéristique', 'Valeur']],
                        body: storageData,
                        startY: yPos,
                        theme: 'grid',
                        margin: { left: 20, right: 20 },
                        styles: { fontSize: 9, halign: 'center' },
                        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' },
                        pageBreak: 'avoid'
                    });
                    yPos = doc.lastAutoTable.finalY + 15;
                }
            }
        });

        // Bilan énergétique and Chart
        const stoChart = document.getElementById('storageResultChart');

        if (yPos > 180) { doc.addPage('a4', 'portrait'); yPos = this.marginTop + 10; }

        if (storageTable) {
            doc.setFontSize(12); doc.setFont('helvetica', 'bold');
            doc.text("Bilan énergétique", 105, yPos, { align: 'center' });
            yPos += 5;
            
            // Extraction manuelle pour contourner le bug d'autoTable avec les éléments cachés (display: none)
            const headRows = [];
            const bodyRows = [];
            const trs = storageTable.querySelectorAll('tr');
            
            trs.forEach((tr, index) => {
                const cells = Array.from(tr.querySelectorAll('th, td')).map(td => td.textContent.trim());
                if (cells.length > 0) {
                    if (tr.querySelector('th') || index === 0) headRows.push(cells);
                    else bodyRows.push(cells);
                }
            });

            if (headRows.length > 0 || bodyRows.length > 0) {
                doc.autoTable({
                    head: headRows,
                    body: bodyRows,
                    startY: yPos,
                    theme: 'grid',
                    margin: { left: 20, right: 20 },
                    styles: { fontSize: 9, halign: 'center' },
                    headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' },
                    pageBreak: 'avoid'
                });
                yPos = doc.lastAutoTable.finalY + 15;
            }
        }

        if (stoChart) {
            if (yPos > 150) { doc.addPage('a4', 'portrait'); yPos = this.marginTop + 10; }
            try {
                if (stoChart.width > 0 && stoChart.height > 0) {
                    const stoChartImg = stoChart.toDataURL('image/png', 1.0);
                    doc.addImage(stoChartImg, 'PNG', 65, yPos, 80, 80);
                    yPos += 85;
                }
            } catch (e) {
                console.error("Erreur capture chart stockage", e);
            }
        }
    }

    console.log('✅ Rapport d\'Autoconsommation ajouté');
  }

  /**
   * Génère les tableaux d'analyse saisonnière manuellement si la section DOM n'est pas remplie.
   */
  generateSeasonalTablesFromData(doc, simData, yPos) {
      const siteLabel = document.getElementById('site-filter-dropdown')?.value || 'Global';
      const siteData = simData.sites[siteLabel];
      if (!siteData || !siteData.monthly_data) return yPos;
      
      const mData = siteData.monthly_data;
      const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
      
      let annProd = 0, annCons = 0, annPvCons = 0;
      let sumHiverCons = 0, sumHiverProd = 0, sumHiverPvCons = 0;
      let sumEteCons = 0, sumEteProd = 0, sumEtePvCons = 0;

      const table1Body = [];
      for (let i = 0; i < 12; i++) {
          const prod = mData.pv_production[i];
          const cons = mData.total_consumption[i];
          const pvCons = mData.pv_consumed[i];
          const autoRate = prod > 0 ? (pvCons / prod) * 100 : 0;

          annProd += prod;
          annCons += cons;
          annPvCons += pvCons;

          if ([0, 1, 2, 10, 11].includes(i)) {
              sumHiverCons += cons; sumHiverProd += prod; sumHiverPvCons += pvCons;
          } else {
              sumEteCons += cons; sumEteProd += prod; sumEtePvCons += pvCons;
          }

          table1Body.push([months[i], prod.toFixed(2), cons.toFixed(2), autoRate.toFixed(2) + ' %']);
      }
      const avgAutoRate = annProd > 0 ? (annPvCons / annProd) * 100 : 0;
      table1Body.push(['Total / Moyenne', annProd.toFixed(2), annCons.toFixed(2), avgAutoRate.toFixed(2) + ' %']);

      doc.setFontSize(12); doc.setFont('helvetica', 'bold');
      doc.text("Analyse mensuelle", 105, yPos, { align: 'center' });
      yPos += 5;
      doc.autoTable({
          head: [['Mois', 'Production (MWh)', 'Consommation (MWh)', "Taux d'autoconsommation (%)"]],
          body: table1Body,
          startY: yPos,
          theme: 'grid',
          margin: { left: 20, right: 20 },
          styles: { fontSize: 9, halign: 'center' },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' },
          pageBreak: 'avoid'
      });
      yPos = doc.lastAutoTable.finalY + 15;

      // Table 2a
      if (yPos > 240) { doc.addPage('a4', 'portrait'); yPos = this.marginTop + 10; }
      const pctHiverCons = annCons > 0 ? (sumHiverCons / annCons) * 100 : 0;
      const pctEteCons = annCons > 0 ? (sumEteCons / annCons) * 100 : 0;
      
      doc.setFontSize(12); doc.setFont('helvetica', 'bold');
      doc.text("Analyse saisonnière consommation", 105, yPos, { align: 'center' });
      yPos += 5;
      doc.autoTable({
          head: [['Saison', 'Somme Consommation (MWh)', 'Part Consommation Annuelle (%)']],
          body: [
              ['Hiver (Nov à Mars)', sumHiverCons.toFixed(2), pctHiverCons.toFixed(2) + ' %'],
              ['Été (Avril à Oct)', sumEteCons.toFixed(2), pctEteCons.toFixed(2) + ' %']
          ],
          startY: yPos,
          theme: 'grid',
          margin: { left: 20, right: 20 },
          styles: { fontSize: 9, halign: 'center' },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' },
          pageBreak: 'avoid'
      });
      yPos = doc.lastAutoTable.finalY + 15;

      // Table 2b
      if (yPos > 240) { doc.addPage('a4', 'portrait'); yPos = this.marginTop + 10; }
      const pctHiverPvCons = annPvCons > 0 ? (sumHiverPvCons / annPvCons) * 100 : 0;
      const pctEtePvCons = annPvCons > 0 ? (sumEtePvCons / annPvCons) * 100 : 0;
      
      doc.setFontSize(12); doc.setFont('helvetica', 'bold');
      doc.text("Analyse saisonnière production", 105, yPos, { align: 'center' });
      yPos += 5;
      doc.autoTable({
          head: [['Saison', 'Somme Prod. Autoconsommée (MWh)', 'Part Prod. Autoconsommée Annuelle (%)']],
          body: [
              ['Hiver (Nov à Mars)', sumHiverPvCons.toFixed(2), pctHiverPvCons.toFixed(2) + ' %'],
              ['Été (Avril à Oct)', sumEtePvCons.toFixed(2), pctEtePvCons.toFixed(2) + ' %']
          ],
          startY: yPos,
          theme: 'grid',
          margin: { left: 20, right: 20 },
          styles: { fontSize: 9, halign: 'center' },
          headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], halign: 'center', fontStyle: 'bold' },
          pageBreak: 'avoid'
      });
      yPos = doc.lastAutoTable.finalY + 15;
      
      return yPos;
  }
}
