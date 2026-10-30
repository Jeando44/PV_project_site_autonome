// === EXPORT & REPORT GENERATION MODULE ===

/**
 * Construit l'objet projetInfo pour le PDF.
 * Priorité : header mémorisé (window.getProjetHeader) > champs DOM.
 * Cela garantit les bonnes valeurs même quand LOAD_HEADER_INTO_FORM = false.
 */
function _buildProjetInfoForPDF(typeBatText, etatProjText, projectMapImage) {
    const h = (typeof window.getProjetHeader === 'function') ? window.getProjetHeader() : {};
    return {
        nom:             h.nom_projet     || document.getElementById('projet_nom')?.value            || '',
        client:          h.nom_client     || document.getElementById('projet_client')?.value          || '',
        charge_affaires: h.charge_affaires|| document.getElementById('projet_charge_affaires')?.value || '',
        lat:             (h.adresse?.latitude  ?? document.getElementById('lat')?.value)  || '',
        lon:             (h.adresse?.longitude ?? document.getElementById('lon')?.value)  || '',
        date:            h.date_projet    || new Date().toLocaleDateString('fr-FR'),
        adresse:         h.adresse?.adresse || document.getElementById('project_addr_search')?.value || '',
        type_batiment:   typeBatText,
        etat_projet:     etatProjText,
        projectMapImage: projectMapImage,
    };
}

function ensureCalculation(pasTemps, button) {
    // If data exists, use it. If not, we might need to trigger calculation via API (async issue here with sync return)
    // For migration context, we assume user must click Calculate first.
    let data = simulationResults[pasTemps];
    if (!data) {
        showMessage(`Veuillez lancer le calcul pour ${pasTemps} min d'abord.`, 'error', 3000, button);
        return null;
    }
    return data;
}

function exportEnergyData(pasTemps, button) {
    const data = ensureCalculation(pasTemps, button);
    if (!data) return;

    // Reconstruction of time-series for Excel from Hourly Avg (Approximation based on backend return)
    // Ideally, backend should return the full CSV string, but to respect "Zero Refactoring" of visual output...
    // We will build the Excel here using the hourly arrays provided by backend.
    
    const annualDataPoints = [];
    const simulationYear = parseInt(document.getElementById('export_annee').value) || 2024;
    let currentDate = new Date(simulationYear, 0, 1, 0, 0);
    const validPasTemps = pasTemps > 0 ? pasTemps : 60;
    const minutesPerSegment = validPasTemps;
    const daysInYear = (simulationYear % 4 === 0) ? 366 : 365;
    const totalSegments = daysInYear * 24 * (60 / validPasTemps);
    const segmentsInHour = 60 / validPasTemps;
    
    const rdtAc = parseFloat(document.getElementById('rendement_borne_ac')?.value) || 0.90;
    const rdtDc = parseFloat(document.getElementById('rendement_borne_dc')?.value) || 0.95;

    const hourlyIRVE_Avg = data.hourlyIRVE;
    const getInstantaneousIRVEPower = (hour, daySegment) => {
        let activeSegmentsCount = 0;
        let isActive = false;
        let theoreticalNominalPowerSegment = 0;
        let theoreticalGridPowerSegment = 0;
        let totalTheoreticalNominalEnergyHour = 0;

        if (window.irveGroups && window.irveChargingPlan && window.irveData) {
            const hourSegmentStart = hour * segmentsInHour;
            for (let s = hourSegmentStart; s < hourSegmentStart + segmentsInHour; s++) {
                let segNominalPwr = 0;
                let segGridPwr = 0;
                let segActive = false;

                for (const group of window.irveGroups) {
                    if (window.irveChargingPlan[group.key] && window.irveChargingPlan[group.key][s]) {
                        segActive = true;
                        if (group.irveIds) {
                            group.irveIds.forEach(id => {
                                const item = window.irveData.find(i => i.id === id);
                                if (item) {
                                    const pwr = item.puissance * item.quantite * item.pdc;
                                    segNominalPwr += pwr;
                                    segGridPwr += (item.type === 'DC') ? (pwr / rdtDc) : (pwr / rdtAc);
                                }
                            });
                        }
                    }
                }
                if (segActive) activeSegmentsCount++;
                totalTheoreticalNominalEnergyHour += segNominalPwr * (validPasTemps / 60);

                if (s === daySegment) {
                    isActive = segActive;
                    theoreticalNominalPowerSegment = segNominalPwr;
                    theoreticalGridPowerSegment = segGridPwr;
                }
            }
        }

        const energyPerHour = hourlyIRVE_Avg[hour] || 0;
        
        if (activeSegmentsCount > 0 && isActive) {
            if (totalTheoreticalNominalEnergyHour > 0) {
                const ratio = energyPerHour / totalTheoreticalNominalEnergyHour;
                return theoreticalGridPowerSegment * ratio;
            }
        }
        
        if (energyPerHour > 0) {
            if (activeSegmentsCount > 0 && isActive) return (energyPerHour / rdtAc) / (activeSegmentsCount * (validPasTemps / 60));
            if (activeSegmentsCount === 0) return (energyPerHour / rdtAc);
        }
        return 0;
    };

    for (let i = 0; i < totalSegments; i++) {
        let daySegment = i % (24 * segmentsInHour);
        let hourIndex = Math.floor(daySegment / segmentsInHour);
        let val = getInstantaneousIRVEPower(hourIndex, daySegment);
        
        annualDataPoints.push([formatDateTime(currentDate), val.toFixed(2)]);
        currentDate.setMinutes(currentDate.getMinutes() + minutesPerSegment);
    }

    const ws_data = [
        ["Rapport de Consommation Annuelle Détaillée IRVE (Simulé)"],
        ["Année:", simulationYear],
        ["Pas de temps:", `${pasTemps} minutes`, ...FUSEAU_EXPORT_CDC],
        ["Date", "Puissance IRVE (kVA)"]
    ];
    ws_data.push(...calerExportUtc1(annualDataPoints, simulationYear, validPasTemps));

    const ws = XLSX.utils.aoa_to_sheet(ws_data, { skipHeader: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Conso_IRVE_${pasTemps}min`);
    XLSX.writeFile(wb, `Consommation_IRVE_Detail_${pasTemps}min.xlsx`);
}

function exportTotalConsumption(pasTemps, button) {
    const data = ensureCalculation(pasTemps, button);
    if (!data) return;

    // Définition locale des fonctions pour éviter les erreurs de référence
    const isLeapYearLocal = (year) => (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const getInactiveDaysLocal = (year) => {
        const inactive = new Set();
        const joursFeriesInput = document.getElementById('jours_feries')?.value || '';
        const parts = joursFeriesInput.split(',').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
            if (part.includes('-')) {
                const [startStr, endStr] = part.split('-');
                const [dStart, mStart] = startStr.split('/').map(Number);
                const [dEnd, mEnd] = endStr.split('/').map(Number);
                let current = new Date(year, mStart - 1, dStart);
                let end = new Date(year, mEnd - 1, dEnd);
                if (mStart > mEnd) end = new Date(year + 1, mEnd - 1, dEnd);
                while (current <= end) {
                    if (current.getDay() !== 0 && current.getDay() !== 6) {
                        inactive.add(`${String(current.getDate()).padStart(2, '0')}/${String(current.getMonth() + 1).padStart(2, '0')}`);
                    }
                    current.setDate(current.getDate() + 1);
                }
            } else if (part.includes('/')) {
                const [d, m] = part.split('/').map(Number);
                const dateObj = new Date(year, m - 1, d);
                if (dateObj.getDay() !== 0 && dateObj.getDay() !== 6) {
                    inactive.add(`${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`);
                }
            }
        }
        return inactive;
    };

    const simulationYear = parseInt(document.getElementById('export_annee').value) || 2024;
    const daysInYear = isLeapYearLocal(simulationYear) ? 366 : 365;
    const validPasTemps = pasTemps > 0 ? pasTemps : 60;
    const minutesPerSegment = validPasTemps;
    const segmentsPerDay = 24 * (60 / validPasTemps);

    const annualDataPoints = [];
    let currentDate = new Date(simulationYear, 0, 1, 0, 0);

    const hourlyIRVE_Avg = data.hourlyIRVE;
    const hourlyExisting = data.hourlyTotal ? data.hourlyTotal.map((tot, i) => Math.max(0, tot - (data.hourlyIRVE[i] || 0))) : Array(24).fill(0);

    const segmentsInHour = 60 / validPasTemps;
    const inactiveDays = getInactiveDaysLocal(simulationYear);

    const rdtAc = parseFloat(document.getElementById('rendement_borne_ac')?.value) || 0.90;
    const rdtDc = parseFloat(document.getElementById('rendement_borne_dc')?.value) || 0.95;

    const getInstantaneousIRVEPower = (hour, daySegment) => {
        let activeSegmentsCount = 0;
        let isActive = false;
        let theoreticalNominalPowerSegment = 0;
        let theoreticalGridPowerSegment = 0;
        let totalTheoreticalNominalEnergyHour = 0;

        if (window.irveGroups && window.irveChargingPlan && window.irveData) {
            const hourSegmentStart = hour * segmentsInHour;
            for (let s = hourSegmentStart; s < hourSegmentStart + segmentsInHour; s++) {
                let segNominalPwr = 0;
                let segGridPwr = 0;
                let segActive = false;

                for (const group of window.irveGroups) {
                    if (window.irveChargingPlan[group.key] && window.irveChargingPlan[group.key][s]) {
                        segActive = true;
                        if (group.irveIds) {
                            group.irveIds.forEach(id => {
                                const item = window.irveData.find(i => i.id === id);
                                if (item) {
                                    const pwr = item.puissance * item.quantite * item.pdc;
                                    segNominalPwr += pwr;
                                    segGridPwr += (item.type === 'DC') ? (pwr / rdtDc) : (pwr / rdtAc);
                                }
                            });
                        }
                    }
                }
                if (segActive) activeSegmentsCount++;
                totalTheoreticalNominalEnergyHour += segNominalPwr * (validPasTemps / 60);

                if (s === daySegment) {
                    isActive = segActive;
                    theoreticalNominalPowerSegment = segNominalPwr;
                    theoreticalGridPowerSegment = segGridPwr;
                }
            }
        }

        const energyPerHour = hourlyIRVE_Avg[hour] || 0;
        
        if (activeSegmentsCount > 0 && isActive) {
            if (totalTheoreticalNominalEnergyHour > 0) {
                const ratio = energyPerHour / totalTheoreticalNominalEnergyHour;
                return theoreticalGridPowerSegment * ratio;
            }
        }
        
        if (energyPerHour > 0) {
            if (activeSegmentsCount > 0 && isActive) return (energyPerHour / rdtAc) / (activeSegmentsCount * (validPasTemps / 60));
            if (activeSegmentsCount === 0) return (energyPerHour / rdtAc);
        }
        return 0;
    };

    const getInstantaneousExistingPower = (day, hour, daySegment) => {
        if (window.useImportedData && window.importedData && window.importedData.length > 0) {
            const totalSegments = daysInYear * segmentsPerDay;
            if (window.importedData.length === totalSegments) {
                return window.importedData[day * segmentsPerDay + daySegment]?.kva || 0;
            } else if (window.importedData.length === daysInYear * 24) {
                return window.importedData[day * 24 + hour]?.kva || 0;
            } else {
                const ratio = window.importedData.length / totalSegments;
                return window.importedData[Math.floor((day * segmentsPerDay + daySegment) * ratio)]?.kva || 0;
            }
        } else if (window.seasonalHourlyData && window.seasonalHourlyData['Hiver']) {
            const startIdx = Math.floor((daySegment * validPasTemps) / 15);
            const endIdx = Math.max(startIdx + 1, Math.floor(((daySegment + 1) * validPasTemps) / 15));
            let sum = 0; let count = 0;
            for (let i = startIdx; i < endIdx && i < 96; i++) {
                sum += window.seasonalHourlyData['Hiver'][i] || 0;
                count++;
            }
            return count > 0 ? sum / count : 0;
        }
        return hourlyExisting[hour] || 0;
    };

    for (let day = 0; day < daysInYear; day++) {
        for (let segmentIndex = 0; segmentIndex < segmentsPerDay; segmentIndex++) {

            const hour = Math.floor(segmentIndex / segmentsInHour);

            const powerIRVE = getInstantaneousIRVEPower(hour, segmentIndex);
            const powerExisting = getInstantaneousExistingPower(day, hour, segmentIndex);

            // Check holidays
            const jourSimule = new Date(simulationYear, 0, 1 + day);
            const dayKey = `${jourSimule.getDate().toString().padStart(2, '0')}/${(jourSimule.getMonth() + 1).toString().padStart(2, '0')}`;

            let finalPowerIRVE = powerIRVE;
            if (inactiveDays.has(dayKey)) finalPowerIRVE = 0;

            annualDataPoints.push([
                formatDateTime(currentDate),
                powerExisting.toFixed(2),
                finalPowerIRVE.toFixed(2),
                (powerExisting + finalPowerIRVE).toFixed(2)
            ]);

            currentDate.setMinutes(currentDate.getMinutes() + minutesPerSegment);
        }
    }

    const ws_data = [
        ["Rapport de Consommation Annuelle Détaillée (Simulé)"],
        ["Pas de temps de simulation:", `${pasTemps} minutes`, ...FUSEAU_EXPORT_CDC],
        ["Puissance Max IRVE (Contrainte):", data.puissanceIRVE_DPM.toFixed(2)],
        ["Date", "Conso existante", "Conso IRVE", "Conso Totale"]
    ];
    ws_data.push(...calerExportUtc1(annualDataPoints, simulationYear, validPasTemps));

    const ws = XLSX.utils.aoa_to_sheet(ws_data, { skipHeader: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Conso_Totale_Site_${pasTemps}min`);
    XLSX.writeFile(wb, `Consommation_IRVE_Totale_Site_${pasTemps}min.xlsx`);

    showMessage(`Export Excel total généré pour ${pasTemps} minutes (${annualDataPoints.length} points, début A5).`, 'info', 3000, button);
}

// --- Utilitaire de chargement d'image ---
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = url;
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
    });
}

function getLatestData() {
    return {
        irveData: window.irveData || [],
        simulationResults: window.simulationResults || {}
    };
}

/**
 * Collects data from the "Chiffrage" (quoting) table in the DOM.
 * @returns {Array} An array of rows for the chiffrage table.
 */
function collectChiffrageData() {
    const chiffrageRows = [];
    
    // Ensure the chiffrage tab is up-to-date before reading
    if (typeof window.updateChiffrageTab === 'function') {
        window.updateChiffrageTab();
    }

    // 1. Matériels IRVE (from global data, with prices from DOM)
    chiffrageRows.push([{ content: "Matériels IRVE", colSpan: 4, styles: { fontStyle: 'bold', fillColor: [243, 244, 246] } }]);
    const domMatRows = document.querySelectorAll('#tbody-materiels tr:not(.section-title-quote)');
    (window.irveData || []).forEach((item, idx) => {
        const designation = `Borne ${item.fabricant || 'N/A'} ${item.type || 'N/A'} ${item.puissance || 0}kW (${item.pdc || 1} PdC)`;
        const qty = item.quantite || 0;
        const domPriceInput = domMatRows[idx]?.querySelector('.price-input');
        const pu = parseFloat(domPriceInput?.value) || (item.type === 'DC' ? 15000 : 1200);
        const total = (qty * pu).toFixed(2);
        chiffrageRows.push([designation, String(qty), pu.toFixed(2), total]);
    });

    // 2. Other sections (Câblage, Civil, Certif) from DOM
    const sections = [
        { id: 'tbody-cablage', title: "Câblage & Protection" },
        { id: 'tbody-civil', title: "Génie Civil" },
        { id: 'tbody-certif', title: "Certification & Mise en service" }
    ];

    sections.forEach(sec => {
        chiffrageRows.push([{ content: sec.title, colSpan: 4, styles: { fontStyle: 'bold', fillColor: [243, 244, 246] } }]);
        const tbody = document.getElementById(sec.id);
        if (tbody) {
            const rows = tbody.querySelectorAll('tr:not(.section-title-quote)');
            rows.forEach(tr => {
                const cells = tr.querySelectorAll('td');
                if (cells.length >= 4) {
                    const des = cells[0].textContent.trim();
                    const qtyInput = cells[1].querySelector('input');
                    const puInput = cells[2].querySelector('input');
                    const totalCell = cells[3];

                    const qty = qtyInput ? qtyInput.value : cells[1].textContent.trim();
                    const pu = puInput ? puInput.value : cells[2].textContent.trim();
                    const total = totalCell.textContent.trim().replace(' €', '');
                    
                    chiffrageRows.push([des, qty, pu, total]);
                }
            });
        }
    });

    return chiffrageRows;
}


async function exportPDF_Python(button) {
    const { irveData: currentIrveData } = getLatestData();
    if (!currentIrveData || currentIrveData.length === 0) {
        showMessage("Aucune donnée matérielle à exporter. Veuillez ajouter au moins une borne.", "error", 4000, button);
        return;
    }

    showMessage("Génération du rapport PDF en cours, veuillez patienter...", "info", 5000, button);
    
    // Ensure latest calculations are done
    if (window.calcChiffrage) await window.calcChiffrage();
    if (window.API && window.API.calculateBilanPuissance) await window.API.calculateBilanPuissance(true);
    
    const pas = document.getElementById('pas_temps')?.value || 60;
    if (window.API && window.API.calculateEnergie && (!window.simulationResults || !window.simulationResults[pas])) {
        await window.API.calculateEnergie(null);
    }
    
    const chartCanvas = document.getElementById('annual-load-chart');
    const chartImage = chartCanvas ? chartCanvas.toDataURL('image/png') : '';
    const chart2Canvas = document.getElementById('monthly-consumption-chart');
    const chartImage2 = chart2Canvas ? chart2Canvas.toDataURL('image/png') : '';
    const chart3Canvas = document.getElementById('energy-distribution-chart');
    const chartImage3 = chart3Canvas ? chart3Canvas.toDataURL('image/png') : '';
    
    const finChartCanvas = document.getElementById('financial-chart');
    const finChartImage = finChartCanvas ? finChartCanvas.toDataURL('image/png') : '';

    // Chargement dynamique de html2canvas si absent
    if (typeof html2canvas === 'undefined') {
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        } catch (e) { console.warn("Impossible de charger html2canvas"); }
    }

    let projectMapImage = '';
    let mapImage = '';
    const previousTab = window.activeTab;
    let previousSubTab = '';
    
    // Sauvegarde du sous-onglet actif si on est sur "parametres"
    if (previousTab === 'parametres') {
         const activeSubBtn = document.querySelector('#parametres .tab-menu .tab-button.active');
         if (activeSubBtn) previousSubTab = activeSubBtn.getAttribute('data-subtab') || (activeSubBtn.getAttribute('onclick') || '').match(/'([^']+)'/)?.[1];
    }

    // 1. Capture de la carte Leaflet (Présentation)
    if (window.switchTab) {
        window.switchTab('parametres');
        if (window.openSubTab) {
            window.openSubTab(null, 'subtab-nouveau-projet');
            await new Promise(r => setTimeout(r, 600)); // Attente du rendu Leaflet
        }
    }
    const projectMapElement = document.getElementById('project-map');
    if (projectMapElement && typeof html2canvas !== 'undefined') {
        try {
            const leafletControl = projectMapElement.querySelector('.leaflet-control-container');
            if (leafletControl) leafletControl.style.display = 'none'; // Cacher les boutons +/- de la carte
            const canvasProjectMap = await html2canvas(projectMapElement, { useCORS: true, allowTaint: true });
            projectMapImage = canvasProjectMap.toDataURL('image/jpeg', 0.9);
            if (leafletControl) leafletControl.style.display = '';
        } catch (e) { console.warn("Erreur capture project map", e); }
    }

    // 2. Capture de la carte Google Maps (Localisation)
    if (window.switchTab) {
        window.switchTab('localisation');
        await new Promise(r => setTimeout(r, 600)); // Attente du rendu Google Maps
    }
    const mapElement = document.getElementById('map');
    if (mapElement && typeof html2canvas !== 'undefined') {
        try {
            // --- FILTRAGE DES ICÔNES POUR LE PDF ---
            // Cacher les bornes IRVE et les lignes de câblage
            (window.markers || []).forEach(m => m.setVisible(false));
            (window.drawnLines || []).forEach(l => l.line.setVisible(false));
            // S'assurer que les organes de coupure sont visibles
            (window.organeCoupureMarkers || []).forEach(m => m.setVisible(true));

            const controlsElement = document.getElementById('map-interaction-buttons');
            if (controlsElement) controlsElement.style.display = 'none';
            const viewButton = document.getElementById('toggle-map-view-btn');
            if(viewButton) viewButton.style.display = 'none';

            const canvasMap = await html2canvas(mapElement, { useCORS: true, allowTaint: true });
            mapImage = canvasMap.toDataURL('image/jpeg', 0.9);

            if (controlsElement) controlsElement.style.display = 'flex';
            if(viewButton) viewButton.style.display = 'flex';

            // --- RESTAURATION DE LA VISIBILITÉ ---
            (window.markers || []).forEach(m => m.setVisible(window.isIrveVisible));
            (window.drawnLines || []).forEach(l => l.line.setVisible(window.areCablesVisible !== false));

        } catch (e) { console.warn("Erreur capture map", e); }
    }
    
    // Restauration de l'onglet initial
    if (window.switchTab) {
        window.switchTab(previousTab);
        if (previousTab === 'parametres' && previousSubTab && window.openSubTab) {
             const btnToClick = document.querySelector(`#parametres .tab-menu .tab-button[data-subtab="${previousSubTab}"]`) || document.querySelector(`#parametres .tab-menu .tab-button[onclick*="${previousSubTab}"]`);
             window.openSubTab(btnToClick, previousSubTab);
        }
    }

    // Récupération des Paramètres & Bilan
    const getRadioLabel = (name) => document.querySelector(`input[name="${name}"]:checked`)?.parentElement?.textContent?.trim() || 'N/A';
    const getVal = (id) => document.getElementById(id)?.value || 'N/A';
    const bilanParams = [
        ['Mode de raccordement du site', getRadioLabel('mode_raccordement')],
        ['Source d\'alimentation électrique', getRadioLabel('source_alim')],
        ['Limitation de puissance (kVA)', getVal('limitation_puissance')],
        ['Gestion dynamique de puissance', getRadioLabel('gestion_puissance')],
        ['Coefficient de simultanéité (Ks)', getVal('ks')],
        ['Puissance auxiliaire (kVA)', getVal('puissance_aux')],
        ['Réserve de puissance (%)', getVal('reserve_puissance')],
        ['Nbre total de bornes (Projet)', getVal('info_nb_bornes')],
        ['Nbre total places pré-équipées', getVal('info_nb_preequip')]
    ];

    const bilanResults = [
        ['Puissance active totale (P)', document.getElementById('res-Ptot')?.textContent || '0.00', 'kW'],
        ['Puissance réactive totale (Q)', document.getElementById('res-Qtot')?.textContent || '0.00', 'kVAR'],
        ['Puissance apparente totale (S)', document.getElementById('res-Stot')?.textContent || '0.00', 'kVA'],
        ['Puissance de raccordement', document.getElementById('res-Praccord')?.textContent || '0.00', 'kVA'],
        ['Courant nominal Ib total', document.getElementById('res-Ib')?.textContent || '0.00', 'A']
    ];

    // Récupération Énergie
    const energyResults = [
        ['Énergie Consommée IRVE', document.getElementById('res-irve-energy')?.textContent || '0.00', 'kWh'],
        ['Énergie Consommée Site', document.getElementById('res-site-energy')?.textContent || '0.00', 'kWh'],
        ['Énergie Totale Consommée', document.getElementById('res-total-energy')?.textContent || '0.00', 'kWh'],
        ['Fraction IRVE', document.getElementById('res-irve-fraction')?.textContent || '0.00', '%'],
        ['Fraction Site', document.getElementById('res-site-fraction')?.textContent || '0.00', '%']
    ];

    // Synthèse Financière
    const financeSummary = [
        ['Total Projet HT', document.getElementById('chiffrage-total-ht')?.textContent || "0.00 €"],
        ['Total TVA', document.getElementById('chiffrage-total-tva')?.textContent || "0.00 €"],
        ['Total Projet TTC', document.getElementById('chiffrage-total-ttc')?.textContent || "0.00 €"],
        ['Total Aides & Subventions', document.getElementById('sum-total-aides')?.textContent || "0.00 €"],
        ['Investissement Réel (Net TTC)', document.getElementById('sum-reste-charge')?.textContent || "0.00 €"]
    ];

    // Récupération des libellés (et non des valeurs techniques) pour la présentation
    const typeBatSelect = document.getElementById('type_batiment');
    const typeBatText = typeBatSelect ? typeBatSelect.options[typeBatSelect.selectedIndex]?.text : '';
    const etatProjSelect = document.getElementById('etat_projet');
    const etatProjText = etatProjSelect ? etatProjSelect.options[etatProjSelect.selectedIndex]?.text : '';

    const organeCoupureDataForPdf = (window.organeCoupureMarkers || [])
    .map(marker => ({
        type: marker.customData.subType,
        title: marker.customData.title,
        color: marker.customData.color 
    }));

    const fullData = {
        irveData: window.irveData,
        chiffrage: collectChiffrageData(),
        charts: {
            loadChart: chartImage,
            monthlyChart: chartImage2,
            distributionChart: chartImage3,
            financialChart: finChartImage,
            mapImage: mapImage,
            viewMode: window.mapViewState === 1 ? 'split' : (window.mapViewState === 2 ? 'total' : 'standard')
        },
        companyInfo: {
            name: document.getElementById('company_name')?.value || '',
            phone: document.getElementById('company_phone')?.value || '',
            address: document.getElementById('company_address')?.value || '',
            logo: window.companyLogoBase64 || (typeof companyLogoBase64 !== 'undefined' ? companyLogoBase64 : null)
        },
        projetInfo: _buildProjetInfoForPDF(typeBatText, etatProjText, projectMapImage),
        conformite: {
            visible: document.getElementById('resultat_lom')?.style.display !== 'none',
            message: (document.getElementById('lom_message_text')?.textContent || "").replace(/<\/?b>/g, ''), // Strip bold tags
            statut: (document.getElementById('lom_statut_materiel')?.textContent || "").replace(/❌|✅|⚠️|⚖️/g, '').trim()
        },
        bilanParams,
        bilanResults,
        energyResults,
        financeSummary,
        simulation: window.simulationResults ? window.simulationResults[pas] : null,
        organeCoupureMarkers: organeCoupureDataForPdf
    };

    try {
        const response = await fetch('/concevoir_mon_projet/api/calcul_irve/generate_pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fullData)
        });

        if (!response.ok) {
            throw new Error(`Erreur du serveur: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "Rapport_Etude_IRVE.pdf";
        document.body.appendChild(a);
        a.click();
        
        // Clean up
        window.URL.revokeObjectURL(url);
        a.remove();

        showMessage("Export PDF généré avec succès.", "info", 3000);

    } catch (error) {
        console.error("Erreur lors de la génération du PDF via le backend:", error);
        showMessage(`Erreur de génération PDF: ${error.message}`, "error", 5000, button);
    }
}


// --- Fonctions Entête et Pied de Page (OBSOLETE pour la génération backend, mais gardé pour d'autres exports potentiels)---
async function ajouterHeaderRapport(doc) {
    try {
        const pageWidth = doc.internal.pageSize.getWidth();
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, pageWidth, 30, 'F');
        const imgLogoUrl = "static/img/Logo_Solakvan.png";
        try {
            const imgLogo = await loadImage(imgLogoUrl);
            doc.addImage(imgLogo, 'PNG', 15, 6, 20, 18);
        } catch (e) { console.warn("Logo manquant ou inaccessible :", e.message); }
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.setFont("helvetica", "normal");
        doc.text("Études . Ingénierie · Conseils · Formation", pageWidth / 2, 16, { align: "center" });
        doc.text("Socalts_OSA_V1.0", pageWidth - 15, 16, { align: "right" });
        doc.setDrawColor(220, 38, 38);
        doc.setLineWidth(0.4);
        doc.line(15, 26, pageWidth - 15, 26);
    } catch (e) {
        console.warn("Erreur non fatale dans l'en-tête du rapport :", e.message);
    }
}

function ajouterFooterRapport(doc) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const footerY = pageHeight - 8;
    const formattedDate = new Date().toLocaleDateString('fr-FR');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.setFont("helvetica", 'normal');
    doc.text(`Le : ${formattedDate}`, margin, footerY);
    const cName = document.getElementById('company_name')?.value;
    const cPhone = document.getElementById('company_phone')?.value;
    const cAddr = document.getElementById('company_address')?.value;
    let footerText = "Solakvan BET - Études . Ingénierie · Conseils · Formation";
    if (cName || cPhone || cAddr) {
        footerText = [cName, cPhone, cAddr].filter(Boolean).join(' / ');
    }
    doc.text(footerText, pageWidth / 2, footerY, { align: 'center' });
    const pageNumber = doc.internal.getCurrentPageInfo().pageNumber;
    doc.text(`Page ${pageNumber}`, pageWidth - margin, footerY, { align: 'right' });
}

async function exportDevisPDF(button) {
    const { irveData: currentIrveData } = getLatestData();
    if (!currentIrveData || currentIrveData.length === 0) {
        showMessage("Aucune donnée matérielle à exporter. Veuillez ajouter au moins une borne.", "error", 4000, button);
        return;
    }

    showMessage("Génération du Devis PDF en cours, veuillez patienter...", "info", 5000, button);

    if (typeof window.updateChiffrageTab === 'function') window.updateChiffrageTab();
    
    if (window.calcChiffrage) await window.calcChiffrage();
    if (window.API && window.API.calculateBilanPuissance) {
        await window.API.calculateBilanPuissance(true);
    }

    const pas = document.getElementById('pas_temps')?.value || 60;
    if (window.API && window.API.calculateEnergie && (!window.simulationResults || !window.simulationResults[pas])) {
        await window.API.calculateEnergie(null);
    }

    // Chargement dynamique de html2canvas si absent
    if (typeof html2canvas === 'undefined') {
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        } catch (e) { console.warn("Impossible de charger html2canvas"); }
    }

    let projectMapImage = '';
    const previousTab = window.activeTab;
    let previousSubTab = '';
    
    if (previousTab === 'parametres') {
         const activeSubBtn = document.querySelector('#parametres .tab-menu .tab-button.active');
         if (activeSubBtn) previousSubTab = activeSubBtn.getAttribute('data-subtab') || (activeSubBtn.getAttribute('onclick') || '').match(/'([^']+)'/)?.[1];
    }

    // 1. Capture de la carte Leaflet (Présentation)
    if (window.switchTab) {
        window.switchTab('parametres');
        if (window.openSubTab) {
            window.openSubTab(null, 'subtab-nouveau-projet');
            await new Promise(r => setTimeout(r, 600)); // Attente du rendu Leaflet
        }
    }
    const projectMapElement = document.getElementById('project-map');
    if (projectMapElement && typeof html2canvas !== 'undefined') {
        try {
            const leafletControl = projectMapElement.querySelector('.leaflet-control-container');
            if (leafletControl) leafletControl.style.display = 'none'; // Cacher les boutons +/- de la carte
            const canvasProjectMap = await html2canvas(projectMapElement, { useCORS: true, allowTaint: true });
            projectMapImage = canvasProjectMap.toDataURL('image/jpeg', 0.9);
            if (leafletControl) leafletControl.style.display = '';
        } catch (e) { console.warn("Erreur capture project map", e); }
    }

    if (window.switchTab) {
        window.switchTab(previousTab);
        if (previousTab === 'parametres' && previousSubTab && window.openSubTab) {
             const btnToClick = document.querySelector(`#parametres .tab-menu .tab-button[data-subtab="${previousSubTab}"]`) || document.querySelector(`#parametres .tab-menu .tab-button[onclick*="${previousSubTab}"]`);
             window.openSubTab(btnToClick, previousSubTab);
        }
    }

    const typeBatSelect = document.getElementById('type_batiment');
    const typeBatText = typeBatSelect ? typeBatSelect.options[typeBatSelect.selectedIndex]?.text : '';
    const etatProjSelect = document.getElementById('etat_projet');
    const etatProjText = etatProjSelect ? etatProjSelect.options[etatProjSelect.selectedIndex]?.text : '';

    const summaryFinance = [
        ['Total Projet HT', document.getElementById('chiffrage-total-ht')?.textContent || "0.00 €"],
        ['Total TVA', document.getElementById('chiffrage-total-tva')?.textContent || "0.00 €"],
        ['Total Projet TTC', document.getElementById('chiffrage-total-ttc')?.textContent || "0.00 €"],
        ['Total Aides & Subventions', document.getElementById('sum-total-aides')?.textContent || "0.00 €"],
        ['Investissement Réel (Net TTC)', document.getElementById('sum-reste-charge')?.textContent || "0.00 €"]
    ];

    const fullData = {
        is_devis: true,
        irveData: window.irveData,
        chiffrage: collectChiffrageData(),
        companyInfo: {
            name: document.getElementById('company_name')?.value || '',
            phone: document.getElementById('company_phone')?.value || '',
            address: document.getElementById('company_address')?.value || '',
            logo: window.companyLogoBase64 || (typeof companyLogoBase64 !== 'undefined' ? companyLogoBase64 : null)
        },
        projetInfo: _buildProjetInfoForPDF(typeBatText, etatProjText, projectMapImage),
        financeSummary: summaryFinance
    };

    try {
        const response = await fetch('/concevoir_mon_projet/api/calcul_irve/generate_pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fullData)
        });

        if (!response.ok) {
            throw new Error(`Erreur du serveur: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "Devis_Installation_IRVE.pdf";
        document.body.appendChild(a);
        a.click();
        
        window.URL.revokeObjectURL(url);
        a.remove();

        showMessage("Devis PDF généré avec succès.", "info", 3000);

    } catch (error) {
        console.error("Erreur lors de la génération du devis PDF via le backend:", error);
        showMessage(`Erreur de génération devis PDF: ${error.message}`, "error", 5000, button);
    }
}

// Block de code gestion information entreprise
let companyLogoBase64 = null; 

/**
 * Fonction d'initialisation et de gestion des paramètres d'entreprise
 * Totalement autonome et isolée.
 */
function initCompanySettings() {
    const logoInput = document.getElementById('company_logo');
    const nameInput = document.getElementById('company_name');
    const phoneInput = document.getElementById('company_phone');
    const addrInput = document.getElementById('company_address');
    const saveCheckbox = document.getElementById('save_company_info');
    
    const logoPreviewContainer = document.getElementById('logo-preview-container');
    const logoPreview = document.getElementById('logo-preview');

    if (!logoInput || !nameInput) return; // Sécurité si le HTML n'est pas chargé

    // 1. Chargement des données sauvegardées (Local Storage)
    const savedData = JSON.parse(localStorage.getItem('skv_company_info') || '{}');

    if (savedData.save) {
        if (savedData.name) nameInput.value = savedData.name;
        if (savedData.phone) phoneInput.value = savedData.phone;
        if (savedData.address) addrInput.value = savedData.address;
        
        if (savedData.logo) {
            companyLogoBase64 = savedData.logo;
            logoPreview.src = companyLogoBase64;
            logoPreviewContainer.style.display = 'flex';
        }
        saveCheckbox.checked = true;
    }

    // 2. Fonction de sauvegarde
    const saveData = () => {
        if (saveCheckbox.checked) {
            const data = {
                save: true,
                name: nameInput.value,
                phone: phoneInput.value,
                address: addrInput.value,
                logo: companyLogoBase64
            };
            localStorage.setItem('skv_company_info', JSON.stringify(data));
        } else {
            localStorage.removeItem('skv_company_info');
        }
    };

    // 3. Listeners sur les champs texte et checkbox
    [nameInput, phoneInput, addrInput, saveCheckbox].forEach(el => {
        el.addEventListener('change', saveData);
        el.addEventListener('input', () => {
            if (saveCheckbox.checked) saveData(); 
        });
    });

    // 4. Listener sur l'upload d'image avec encodage en Base64
    logoInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function (evt) {
            companyLogoBase64 = evt.target.result;
            window.companyLogoBase64 = companyLogoBase64;
            logoPreview.src = companyLogoBase64;
            logoPreviewContainer.style.display = 'flex';
            saveData();
        };
        reader.readAsDataURL(file);
    });
}

// Lancement de l'initialisation dès que le DOM est prêt
document.addEventListener('DOMContentLoaded', initCompanySettings);

function formatDateTime(date) {
    const pad = (num) => num.toString().padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    return `${day}.${month}.${year} ${hour}:${minute}`;
}

// ─── Calage horaire des exports de courbes de charge ────────────────────────────────────────────
// Les courbes sont simulées par heure de la journée (heure murale, plan de charge). La production
// (PVsyst, PVGIS recalé côté serveur) est en UTC+1 fixe, sans heure d'été : les exports sont calés
// sur cette référence, sur 365 jours, avec des dates continues. Le marqueur "UTC+1" de l'en-tête dit à
// extract_consumption (calcul_autoconso.py) de les lire tels quels. Miroir de
// heure_locale_vers_utc1 (calage_horaire.py).
const FUSEAU_EXPORT_CDC = ["Fuseau horaire:", "UTC+1 fixe (heure d'hiver, sans changement d'heure)"];

/** Instant (ms UTC) du changement d'heure UE : dernier dimanche du mois, 01:00 UTC. */
function _dernierDimancheUtc(annee, mois) {
    const d = new Date(Date.UTC(annee, mois + 1, 0, 1, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime();
}

function _formatDateTimeUtc(date) {
    const pad = (num) => num.toString().padStart(2, '0');
    return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/**
 * @param {Array<Array>} lignes - [date, valeurs...] : une ligne par pas, année civile en heure murale
 * @returns {Array<Array>} lignes calées en UTC+1 fixe (29 février retiré), dates régénérées
 */
function calerExportUtc1(lignes, annee, pasMin) {
    const parJour = 24 * 60 / pasMin;
    const bissextile = lignes.length === 366 * parJour;
    const source = bissextile ? lignes.slice(0, 59 * parJour).concat(lignes.slice(60 * parJour)) : lignes;
    const debutEte = _dernierDimancheUtc(annee, 2);
    const finEte = _dernierDimancheUtc(annee, 9);
    const decalage = 60 / pasMin;
    return source.map((_, i) => {
        const jour = Math.floor(i / parJour);
        const jourCivil = bissextile && jour >= 59 ? jour + 1 : jour;
        const etiquette = Date.UTC(annee, 0, 1 + jourCivil) + (i % parJour) * pasMin * 60000;
        // Heure d'été : l'instant UTC+1 t correspond à l'heure murale t + 1 h.
        const instantUtc = etiquette - 3600000;
        const j = (instantUtc >= debutEte && instantUtc < finEte) ? Math.min(i + decalage, source.length - 1) : i;
        return [_formatDateTimeUtc(new Date(etiquette)), ...source[j].slice(1)];
    });
}

function exportPVsyst(button) {
    // Simplified CSV export logic similar to Excel but text format
    // Logic remains client-side transformation of data
    exportEnergyData(60, button); // Re-use logic or adapt specific CSV format
}

function exportPowerCurve(button) {
    const pasTempsStr = document.getElementById('pas_temps')?.value || "60";
    const pasTemps = parseInt(pasTempsStr, 10) || 60;
    const data = ensureCalculation(pasTemps, button);
    if (!data) return;

    const isLeapYearLocal = (year) => (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const getInactiveDaysLocal = (year) => {
        const inactive = new Set();
        const joursFeriesInput = document.getElementById('jours_feries')?.value || '';
        const parts = joursFeriesInput.split(',').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
            if (part.includes('-')) {
                const [startStr, endStr] = part.split('-');
                const [dStart, mStart] = startStr.split('/').map(Number);
                const [dEnd, mEnd] = endStr.split('/').map(Number);
                let current = new Date(year, mStart - 1, dStart);
                let end = new Date(year, mEnd - 1, dEnd);
                if (mStart > mEnd) end = new Date(year + 1, mEnd - 1, dEnd);
                while (current <= end) {
                    if (current.getDay() !== 0 && current.getDay() !== 6) {
                        inactive.add(`${String(current.getDate()).padStart(2, '0')}/${String(current.getMonth() + 1).padStart(2, '0')}`);
                    }
                    current.setDate(current.getDate() + 1);
                }
            } else if (part.includes('/')) {
                const [d, m] = part.split('/').map(Number);
                const dateObj = new Date(year, m - 1, d);
                if (dateObj.getDay() !== 0 && dateObj.getDay() !== 6) {
                    inactive.add(`${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`);
                }
            }
        }
        return inactive;
    };

    const simulationYear = parseInt(document.getElementById('export_annee').value) || 2024;
    const daysInYear = isLeapYearLocal(simulationYear) ? 366 : 365;
    const validPasTemps = pasTemps > 0 ? pasTemps : 60;
    const minutesPerSegment = validPasTemps;
    const segmentsPerDay = 24 * (60 / validPasTemps);

    const annualDataPoints = [];
    let currentDate = new Date(simulationYear, 0, 1, 0, 0);

    const hourlyIRVE_Avg = data.hourlyIRVE;
    const hourlyExisting = data.hourlyTotal ? data.hourlyTotal.map((tot, i) => Math.max(0, tot - (data.hourlyIRVE[i] || 0))) : Array(24).fill(0);
    const segmentsInHour = 60 / validPasTemps;
    const inactiveDays = getInactiveDaysLocal(simulationYear);

    const rdtAc = parseFloat(document.getElementById('rendement_borne_ac')?.value) || 0.90;
    const rdtDc = parseFloat(document.getElementById('rendement_borne_dc')?.value) || 0.95;

    const getInstantaneousIRVEPower = (hour, daySegment) => {
        let activeSegmentsCount = 0;
        let isActive = false;
        let theoreticalNominalPowerSegment = 0;
        let theoreticalGridPowerSegment = 0;
        let totalTheoreticalNominalEnergyHour = 0;

        if (window.irveGroups && window.irveChargingPlan && window.irveData) {
            const hourSegmentStart = hour * segmentsInHour;
            for (let s = hourSegmentStart; s < hourSegmentStart + segmentsInHour; s++) {
                let segNominalPwr = 0;
                let segGridPwr = 0;
                let segActive = false;

                for (const group of window.irveGroups) {
                    if (window.irveChargingPlan[group.key] && window.irveChargingPlan[group.key][s]) {
                        segActive = true;
                        if (group.irveIds) {
                            group.irveIds.forEach(id => {
                                const item = window.irveData.find(i => i.id === id);
                                if (item) {
                                    const pwr = item.puissance * item.quantite * item.pdc;
                                    segNominalPwr += pwr;
                                    segGridPwr += (item.type === 'DC') ? (pwr / rdtDc) : (pwr / rdtAc);
                                }
                            });
                        }
                    }
                }
                if (segActive) activeSegmentsCount++;
                totalTheoreticalNominalEnergyHour += segNominalPwr * (validPasTemps / 60);

                if (s === daySegment) {
                    isActive = segActive;
                    theoreticalNominalPowerSegment = segNominalPwr;
                    theoreticalGridPowerSegment = segGridPwr;
                }
            }
        }

        const energyPerHour = hourlyIRVE_Avg[hour] || 0;
        
        if (activeSegmentsCount > 0 && isActive) {
            if (totalTheoreticalNominalEnergyHour > 0) {
                const ratio = energyPerHour / totalTheoreticalNominalEnergyHour;
                return theoreticalGridPowerSegment * ratio;
            }
        }
        
        if (energyPerHour > 0) {
            if (activeSegmentsCount > 0 && isActive) return (energyPerHour / rdtAc) / (activeSegmentsCount * (validPasTemps / 60));
            if (activeSegmentsCount === 0) return (energyPerHour / rdtAc);
        }
        return 0;
    };

    const getInstantaneousExistingPower = (day, hour, daySegment) => {
        if (window.useImportedData && window.importedData && window.importedData.length > 0) {
            const totalSegments = daysInYear * segmentsPerDay;
            if (window.importedData.length === totalSegments) {
                return window.importedData[day * segmentsPerDay + daySegment]?.kva || 0;
            } else if (window.importedData.length === daysInYear * 24) {
                return window.importedData[day * 24 + hour]?.kva || 0;
            } else {
                const ratio = window.importedData.length / totalSegments;
                return window.importedData[Math.floor((day * segmentsPerDay + daySegment) * ratio)]?.kva || 0;
            }
        } else if (window.seasonalHourlyData && window.seasonalHourlyData['Hiver']) {
            const startIdx = Math.floor((daySegment * validPasTemps) / 15);
            const endIdx = Math.max(startIdx + 1, Math.floor(((daySegment + 1) * validPasTemps) / 15));
            let sum = 0; let count = 0;
            for (let i = startIdx; i < endIdx && i < 96; i++) {
                sum += window.seasonalHourlyData['Hiver'][i] || 0;
                count++;
            }
            return count > 0 ? sum / count : 0;
        }
        return hourlyExisting[hour] || 0;
    };

    for (let day = 0; day < daysInYear; day++) {
        for (let segmentIndex = 0; segmentIndex < segmentsPerDay; segmentIndex++) {

            const hour = Math.floor(segmentIndex / segmentsInHour);
            const powerIRVE = getInstantaneousIRVEPower(hour, segmentIndex);
            const powerExisting = getInstantaneousExistingPower(day, hour, segmentIndex);

            const jourSimule = new Date(simulationYear, 0, 1 + day);
            const dayKey = `${jourSimule.getDate().toString().padStart(2, '0')}/${(jourSimule.getMonth() + 1).toString().padStart(2, '0')}`;

            let finalPowerIRVE = powerIRVE;
            if (inactiveDays.has(dayKey)) finalPowerIRVE = 0;

            annualDataPoints.push([
                formatDateTime(currentDate),
                powerExisting.toFixed(2),
                finalPowerIRVE.toFixed(2),
                (powerExisting + finalPowerIRVE).toFixed(2)
            ]);

            currentDate.setMinutes(currentDate.getMinutes() + minutesPerSegment);
        }
    }

    const ws_data = [
        ["Courbe de charge des Bornes (kW)"],
        ["Année:", simulationYear],
        ["Pas de temps:", `${pasTemps} minutes`, ...FUSEAU_EXPORT_CDC],
        ["Date", "Conso existante", "Conso IRVE", "Conso Totale"]
    ];
    ws_data.push(...calerExportUtc1(annualDataPoints, simulationYear, validPasTemps));

    const ws = XLSX.utils.aoa_to_sheet(ws_data, { skipHeader: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Courbe_Charge_${pasTemps}min`);
    XLSX.writeFile(wb, `Courbe_Charge_Bornes_${pasTemps}min.xlsx`);

    showMessage(`Export de la courbe de charge généré pour ${pasTemps} minutes (${annualDataPoints.length} valeurs).`, 'info', 3000, button);
}

window.exportPDF = exportPDF_Python;


window.exportTotalConsumption = exportTotalConsumption;
window.exportPVsyst = exportPVsyst;
window.exportPowerCurve = exportPowerCurve;