
        // Détection du mode "embedded" (dans une iframe)
        document.addEventListener('DOMContentLoaded', function () {
            const params = new URLSearchParams(window.location.search);
            if (params.get('autoOpen') === 'true' || window.self !== window.top) {
                document.body.classList.add('embedded-mode');
            }
        });




        document.addEventListener('DOMContentLoaded', () => {
            const LOCAL_STORAGE_KEY = 'photovoltaicProjectData_v27_distribution';
            const PANEL_DB_KEY = 'photovoltaicCustomPanels_v27_distribution';
            const INVERTER_DB_KEY = 'photovoltaicCustomInverters_v27_distribution';
            const TRANSFORMER_DB_KEY = 'photovoltaicCustomTransformers_v27_distribution';

            let panelDatabase = [
                { isDefault: true, fabricant: "DEMEGC", reference: "DM450M10RT-B54HBT", puissance_wc: "480", type_module: "Biface", pv_vmpp: 33.95, pv_voc: 40.25, i_mpp: 14.64, pv_isc: 15.59, pv_k_voc: -0.25, pv_k_p: -0.29, rendement: "23.15", pv_tension_systeme: 1500, protection: "30A", dimensions: "1762*1134*30", poids: 25 },
                { isDefault: true, fabricant: "JASOLAR", reference: "JAM54S30-415-MR", puissance_wc: "415", type_module: "Biface", pv_vmpp: 31.45, pv_voc: 37.55, i_mpp: 13.20, pv_isc: 14.05, pv_k_voc: -0.27, pv_k_p: -0.35, rendement: "21.3", pv_tension_systeme: 1500, protection: "25A", dimensions: "1722*1134*30", poids: 21.5 }
            ];
            let inverterDatabase = [
                { isDefault: true, fabricant: "Huawei", reference: "SUN2000-100KTL-M2", p_nominale_kva: 100, p_apparente_kva: 110, mppt_inputs: "10 / 2", ond_tension_max_dc: 1100, ond_tension_min_dc: 200, ond_plage_mppt_min: 200, ond_plage_mppt_max: 1000, ond_imax_mppt: 40, rendement_max: 98.6, courant_max_ac: 160.4, type_tension: "Triphasé", tension_nominale_ac: "400V, 480V", compat_optimiseur: "Non", hybride: "Oui", poids: 25 },
                { isDefault: true, fabricant: "Sungrow", reference: "SG125CX-P2", p_nominale_kva: 125, p_apparente_kva: 125, mppt_inputs: "12 / 2", ond_tension_max_dc: 1100, ond_tension_min_dc: 180, ond_plage_mppt_min: 180, ond_plage_mppt_max: 1000, ond_imax_mppt: 40, rendement_max: 98.6, courant_max_ac: 181.1, type_tension: "Triphasé", tension_nominale_ac: "400V", compat_optimiseur: "Non", hybride: "Non", poids: 89 }
            ];
            let transformerDatabase = [
                { isDefault: true, fabricant: "Schneider Electric", reference: "Trihal 800kVA", integrateur: "Ardelec Energie", sn_kva: 800, tension_primaire_secondaire: "21 kV/410V", type_couplage: "Triangle-Étoile /Dyn11", dielectrique: "Sec (AN)", perte_a_vide_po: 1350, perte_en_charge_pk: 7800, ucc_percent: 6, courant_a_vide_i0_percent: 0.2, courant_enclenchement: "10-12 In", niveau_isolement_hta: "24 kV", niveau_isolement_bt: "1.1 kV", ku_percent: 80 }
            ];

            let projectInverters = [];
            let projectTransformersProduction = [];
            let projectTransformersSoutirage = [];
            let editingInverterIndex = null;
            let editingTransformer = { index: null, section: '' };

            const cosPhiInput = document.getElementById('cosPhi');
            const minTempInput = document.getElementById('minTemp');
            const funcTempInput = document.getElementById('temp_de_fonctionnement');
            const maxTempInput = document.getElementById('temp_max_absolue');
            const panelManufacturerSelect = document.getElementById('panelManufacturer');
            const panelTableBody = document.querySelector('#panelSelectionTable tbody');
            const showPanelInfoBtn = document.getElementById('showPanelInfo');
            const addPanelBtn = document.getElementById('addPanelBtn');
            const detailsModal = document.getElementById('detailsModal');
            const addModal = document.getElementById('addModal');
            const inverterModal = document.getElementById('inverterModal');
            const addInverterBtn = document.getElementById('addInverterBtn');
            const transformerModal = document.getElementById('transformerModal');
            const voltageInfoModal = document.getElementById('voltageInfoModal');
            const connectionModeButtons = document.querySelector('.choice-buttons[data-save-group="connectionMode"]');
            const soutirageInfoSection = document.getElementById('soutirageInfoSection');
            const transformerProdSection = document.getElementById('transformerProdSection');
            const transformerSoutirageSection = document.getElementById('transformerSoutirageSection');
            const inverterCardContainer = document.getElementById('inverterCardContainer');
            const inverterTotalsCard = document.getElementById('inverterTotalsCard');
            const transformerCardContainerProduction = document.getElementById('transformerCardContainerProduction');
            const transformerCardContainerSoutirage = document.getElementById('transformerCardContainerSoutirage');

            function updateVisibility(mode) {
                soutirageInfoSection.style.display = 'none';
                transformerProdSection.style.display = 'none';
                transformerSoutirageSection.style.display = 'none';
                switch (mode) {
                    case 'HTA': transformerProdSection.style.display = 'block'; break;
                    case 'BT_CONSO_BT': soutirageInfoSection.style.display = 'block'; break;
                    case 'BT_CONSO_HTA': soutirageInfoSection.style.display = 'block'; transformerSoutirageSection.style.display = 'block'; break;
                    case 'HTA_CONSO_HTA': soutirageInfoSection.style.display = 'block'; transformerProdSection.style.display = 'block'; transformerSoutirageSection.style.display = 'block'; break;
                }
                renderInverters();
            }

            // --- FONCTIONS DE CALCUL ---
            // Extraites vers string_sizing_utils.js (chargé avant ce fichier, cf. app_systeme_elec.html)
            // pour être réutilisées par la modale "Chaînes / Onduleur / Batterie" du calepinage —
            // comportement inchangé, ce ne sont que des alias vers window.StringSizingUtils.
            const {
                calculateStringSizing,
                calculateOptimalStrings,
                parseUserStringConfig,
                parseUserStringConfigForStrings,
            } = window.StringSizingUtils;

            // --- GESTION DES ONDULEURS ---
            function renderInverters() {
                inverterCardContainer.innerHTML = "";
                const isProdTransformerVisible = transformerProdSection.style.display !== 'none';

                projectInverters.forEach((inv, index) => {
                    const card = document.createElement('div');
                    card.className = 'data-card';
                    card.dataset.index = index;
                    const dbInv = inverterDatabase.find(db => db.reference === inv.reference) || {};
                    inv.pApparenteKva = inv.pApparenteKva || dbInv.p_apparente_kva || 0;

                    let transfoOptions = projectTransformersProduction.map((t, i) => `<option value="${i}">Transfo ${i + 1}</option>`).join('');
                    if (projectTransformersProduction.length === 0) {
                        transfoOptions = '<option value="">Aucun</option>';
                    }

                    const transformerAssignmentHTML = isProdTransformerVisible ? `
                    <div class="card-field"><label>Assigné à</label><select class="transformer-assignment">${transfoOptions}</select></div>
                ` : '';

                    card.innerHTML = `
                    <div class="card-header">
                        <div class="card-title">${index + 1}. 
                            <span class="main-title">${inv.fabricant || 'Onduleur à choisir'}</span>
                            <span class="ref">${inv.reference || ''}</span>
                            <button class="btn btn-secondary btn-small" data-action="select" style="margin-left: 10px;">Choisir</button>
                        </div>
                        <div class="card-actions">
                             <button class="action-btn" data-action="voltage-graph" title="Analyse des tensions">📊</button>
                             <button class="action-btn" data-action="details" title="Détails">ℹ️</button>
                             <button class="action-btn" data-action="copy" title="Copier">📄</button>
                             <button class="action-btn" data-action="delete" title="Supprimer">❌</button>
                        </div>
                    </div>
                    <div class="card-content-grid">
                        <div class="card-field"><label>Qté. Ond</label><input type="number" class="nb-ond" value="${inv.nbOnd || 1}" min="1"></div>
                        <div class="card-field"><label>N° sous champ</label><input type="text" class="sous-champ-pv" value="${inv.sousChampPV || ''}"></div>
                        <div class="card-field"><label>Nb panneaux</label><input type="number" class="nb-panneaux" value="${inv.nbPanneaux || 0}"></div>
                        <div class="card-field"><label>Config. auto</label><div class="value config-auto-cell nb-chaine-pv">N/A</div></div>
                        <div class="card-field"><label>Config. utilisateur</label><input type="text" class="config-pv-user" value="${inv.configPvUser || ''}" placeholder="ex: 2x15+1x14"></div>
                        <div class="card-field"><label>P. PV (kWc)</label><div class="value p-pv calculated-cell">0.00</div></div>
                        <div class="card-field"><label>P.App (kVA)</label><input type="number" class="p-app-kva" value="${inv.pApparenteKva}"></div>
                        <div class="card-field"><label>Bridage (%)</label><input type="number" class="bridage" min="0" max="100" value="${inv.bridage || 0}"></div>
                        <div class="card-field"><label>P. Active (kW)</label><div class="value p-active calculated-cell">0.00</div></div>
                        <div class="card-field"><label>P. Réactive (kVAr)</label><div class="value p-reactive calculated-cell">0.00</div></div>
                        <div class="card-field"><label>Nb PV/chaîne (Sys)</label><div class="value pv-per-string-system">N/A</div></div>
                        <div class="card-field"><label>Nb PV opt./chaîne</label><div class="value pv-optimal-per-string">N/A</div></div>
                        <div class="card-field"><label>Ch. max/MPPT</label><div class="value max-strings-per-mppt">N/A</div></div>
                        <div class="card-field"><label>Ratio DC/AC</label><div class="value ratio-dc-ac calculated-cell">0.00</div></div>
                        <div class="card-field"><label>Ratio AC/DC</label><div class="value ratio-ac-dc calculated-cell">0.00</div></div>
                        ${transformerAssignmentHTML}
                    </div>
                `;
                    if (isProdTransformerVisible) {
                        card.querySelector('.transformer-assignment').value = inv.transformerId || '0';
                    }
                    inverterCardContainer.appendChild(card);
                });
                attachInverterRowListeners();
                recalculateAllInverterRows();
            }
            function attachInverterRowListeners() {
                inverterCardContainer.querySelectorAll('.data-card').forEach(card => {
                    const index = parseInt(card.dataset.index, 10);
                    const inv = projectInverters[index];

                    const update = (prop, val, needsRecalc = true) => {
                        inv[prop] = val;
                        if (needsRecalc) {
                            recalculateInverterRow(card);
                            recalculateAllTransformerRows();
                        }
                        saveData();
                    };

                    card.querySelector('[data-action="select"]').addEventListener('click', () => openInverterModal(index));
                    card.querySelector('[data-action="copy"]').addEventListener('click', () => copyInverter(index));
                    card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteInverter(index));
                    card.querySelector('[data-action="voltage-graph"]').addEventListener('click', () => showVoltageInfo(index));
                    card.querySelector('[data-action="details"]').addEventListener('click', () => {
                        const dbInv = inverterDatabase.find(db => db.reference === inv.reference);
                        if (dbInv) showDetailsModal(`Détails onduleur: ${dbInv.reference}`, dbInv);
                    });

                    card.querySelector('.nb-ond').addEventListener('input', e => update('nbOnd', parseInt(e.target.value, 10) || 1));
                    card.querySelector('.sous-champ-pv').addEventListener('input', e => update('sousChampPV', e.target.value, false));
                    card.querySelector('.bridage').addEventListener('input', e => update('bridage', parseFloat(e.target.value)));
                    card.querySelector('.p-app-kva').addEventListener('input', e => update('pApparenteKva', parseFloat(e.target.value)));

                    const transformerAssignmentSelect = card.querySelector('.transformer-assignment');
                    if (transformerAssignmentSelect) {
                        transformerAssignmentSelect.addEventListener('change', e => update('transformerId', e.target.value));
                    }

                    const nbPanneauxInput = card.querySelector('.nb-panneaux');
                    const configPvUserInput = card.querySelector('.config-pv-user');

                    nbPanneauxInput.addEventListener('input', e => {
                        configPvUserInput.value = '';
                        update('configPvUser', '');
                        update('nbPanneaux', parseInt(e.target.value, 10));
                    });
                    configPvUserInput.addEventListener('input', e => {
                        const userConfig = e.target.value;
                        const panelCount = parseUserStringConfig(userConfig);
                        if (panelCount > 0) nbPanneauxInput.value = panelCount;
                        update('nbPanneaux', panelCount);
                        update('configPvUser', userConfig);
                    });
                });
            }
            function recalculateAllInverterRows() {
                inverterCardContainer.querySelectorAll('.data-card').forEach(recalculateInverterRow);
            }
            function recalculateInverterRow(card) {
                const index = parseInt(card.dataset.index, 10);
                if (isNaN(index)) return;

                const inv = projectInverters[index];
                const dbInv = inverterDatabase.find(db => db.reference === inv.reference);
                const panel = getSelectedPanelData();

                if (dbInv && panel) {
                    const globalSettings = { tempMin: parseFloat(minTempInput.value), tempMax: parseFloat(maxTempInput.value), tempFunc: parseFloat(funcTempInput.value) };
                    const sizingResults = calculateStringSizing(panel, dbInv, globalSettings);
                    card.querySelector('.pv-per-string-system').textContent = sizingResults.nbPvParChaine;
                    card.querySelector('.pv-optimal-per-string').textContent = sizingResults.nbPvRendOptimal;
                    card.querySelector('.max-strings-per-mppt').textContent = sizingResults.nbChaineMaxParMppt;
                    const [minPv, maxPv] = sizingResults.nbPvParChaine.split(' / ').map(Number);
                    const nbPanneaux = parseInt(inv.nbPanneaux, 10) || 0;
                    const stringConfig = calculateOptimalStrings(nbPanneaux, minPv, maxPv);
                    card.querySelector('.nb-chaine-pv').textContent = stringConfig.displayText;
                    inv.nbChainePV = stringConfig.totalStrings;
                } else {
                    ['.pv-per-string-system', '.nb-chaine-pv', '.pv-optimal-per-string', '.max-strings-per-mppt'].forEach(cls => card.querySelector(cls).textContent = 'N/A');
                    inv.nbChainePV = 0;
                }

                if (!dbInv) { updateInverterTotals(); return; }

                const pApparente_per_inverter = parseFloat(inv.pApparenteKva) || 0;
                const bridage = inv.bridage || 0;
                const cosPhi = parseFloat(cosPhiInput.value) || 0.944;
                const pActive = (1 - (bridage / 100)) * pApparente_per_inverter * cosPhi;

                let pReactive = 0;
                if (pApparente_per_inverter * pApparente_per_inverter >= pActive * pActive) {
                    pReactive = Math.sqrt(Math.pow(pApparente_per_inverter, 2) - Math.pow(pActive, 2));
                }

                let pPv_total_for_card = 0;
                if (panel) {
                    const pWc = parseFloat(panel.puissance_wc);
                    if (!isNaN(pWc)) pPv_total_for_card = (inv.nbPanneaux * pWc) / 1000;
                }

                const nbOnd = inv.nbOnd || 1;
                const pPv_per_inverter = pPv_total_for_card / nbOnd;

                const ratioDcAc = pApparente_per_inverter > 0 ? (pPv_per_inverter / pApparente_per_inverter).toFixed(2) : '∞';
                const ratioAcDc = pPv_per_inverter > 0 ? (pApparente_per_inverter / pPv_per_inverter).toFixed(2) : '∞';

                card.querySelector('.p-active').textContent = pActive.toFixed(2);
                card.querySelector('.p-reactive').textContent = pReactive.toFixed(2);
                card.querySelector('.p-pv').textContent = pPv_total_for_card.toFixed(2);
                card.querySelector('.ratio-dc-ac').textContent = ratioDcAc;
                card.querySelector('.ratio-ac-dc').textContent = ratioAcDc;

                updateInverterTotals();
            }
            function addInverter() {
                const newInv = { nbPanneaux: 0, bridage: 0, nbOnd: 1, transformerId: '0' };
                projectInverters.push(newInv);
                renderInverters();
                openInverterModal(projectInverters.length - 1);
            }
            function deleteInverter(index) { projectInverters.splice(index, 1); renderInverters(); saveData(); }
            function copyInverter(index) { projectInverters.splice(index + 1, 0, JSON.parse(JSON.stringify(projectInverters[index]))); renderInverters(); saveData(); }

            // --- GESTION DES TOTAUX ---
            function updateInverterTotals() {
                let totalNbPanneaux = 0, totalPApp = 0, totalPActive = 0, totalPPV = 0;
                let totalOnduleurs = 0, totalChaines = 0, totalUserChaines = 0;

                projectInverters.forEach(inv => {
                    const nbOnd = inv.nbOnd || 1;
                    totalOnduleurs += nbOnd;
                    totalChaines += (inv.nbChainePV || 0) * nbOnd;
                    totalUserChaines += parseUserStringConfigForStrings(inv.configPvUser) * nbOnd;

                    const nbPanneauxOnRow = inv.nbPanneaux || 0;
                    totalNbPanneaux += nbPanneauxOnRow;

                    const pApparente_per_inverter = parseFloat(inv.pApparenteKva) || 0;
                    totalPApp += pApparente_per_inverter * nbOnd;

                    const bridage = inv.bridage || 0;
                    const cosPhi = parseFloat(cosPhiInput.value) || 0.944;
                    const pActive_per_inverter = (1 - (bridage / 100)) * pApparente_per_inverter * cosPhi;
                    totalPActive += pActive_per_inverter * nbOnd;

                    const panel = getSelectedPanelData();
                    if (panel) {
                        const pWc = parseFloat(panel.puissance_wc);
                        if (!isNaN(pWc)) {
                            totalPPV += (nbPanneauxOnRow * pWc / 1000);
                        }
                    }
                });

                const ratioAcDcTotal = totalPPV > 0 ? (totalPApp / totalPPV).toFixed(2) : "0.00";
                const ratioDcAcTotal = totalPApp > 0 ? (totalPPV / totalPApp).toFixed(2) : "0.00";

                renderTotalsCard({
                    totalOnduleurs,
                    totalChaines,
                    totalUserChaines,
                    totalPApp,
                    totalPActive,
                    totalPPV,
                    ratioAcDcTotal,
                    ratioDcAcTotal
                });
                checkCalepinageTotals(totalNbPanneaux, totalPPV);
                recalculateAllTransformerRows();
            }
            function renderTotalsCard(totals) {
                inverterTotalsCard.innerHTML = `
                <div class="card-header"><div class="card-title">Totaux</div></div>
                <div class="card-content-grid" style="grid-template-columns: repeat(8, 1fr);">
                    <div class="card-field"><label>Total Onduleurs</label><div class="value">${totals.totalOnduleurs}</div></div>
                    <div class="card-field"><label>Total Chaînes PV.Auto</label><div class="value">${totals.totalChaines}</div></div>
                    <div class="card-field"><label>Total Chaînes PV.User</label><div class="value">${totals.totalUserChaines}</div></div>
                    <div class="card-field"><label>P. Apparente Totale</label><div class="value calculated-cell">${totals.totalPApp.toFixed(2)} kVA</div></div>
                    <div class="card-field"><label>P. Active Totale</label><div class="value calculated-cell">${totals.totalPActive.toFixed(2)} kW</div></div>
                    <div class="card-field"><label>P. PV (kWc) Total</label><div class="value calculated-cell">${totals.totalPPV.toFixed(2)} kWc</div></div>
                    <div class="card-field"><label>Ratio DC/AC Total</label><div class="value">${totals.ratioDcAcTotal}</div></div>
                    <div class="card-field"><label>Ratio AC/DC Total</label><div class="value">${totals.ratioAcDcTotal}</div></div>
                </div>
            `;
            }
            function checkCalepinageTotals(totalCalculatedPanels, totalCalculatedPower) {
                const errorContainer = document.getElementById('calepinageError');
                const installedPowerInput = document.getElementById('installedPower');
                const nbPanneauxInput = document.getElementById('nbre_pv_calepinage');
                const calepinagePower = parseFloat(installedPowerInput.value) || 0;
                const calepinagePanels = parseInt(nbPanneauxInput.value, 10) || 0;
                if (calepinagePower === 0 && calepinagePanels === 0) { errorContainer.style.display = 'none'; return; }
                const powerMatch = Math.abs(calepinagePower - totalCalculatedPower) < 0.01;
                const panelMatch = calepinagePanels === totalCalculatedPanels;
                errorContainer.style.display = (powerMatch && panelMatch) ? 'none' : 'block';
            }

            // --- GESTION DES TRANSFORMATEURS ---
            function addTransformer(section) {
                const dataArray = section === 'production' ? projectTransformersProduction : projectTransformersSoutirage;
                dataArray.push({});
                if (section === 'production') { renderInverters(); }
                renderTransformers(section);
                openTransformerModal(section, dataArray.length - 1);
            }
            function deleteTransformer(section, index) {
                const dataArray = section === 'production' ? projectTransformersProduction : projectTransformersSoutirage;
                dataArray.splice(index, 1);
                if (section === 'production') {
                    projectInverters.forEach(inv => {
                        if (inv.transformerId == index) inv.transformerId = '0';
                        if (inv.transformerId > index) inv.transformerId = (parseInt(inv.transformerId) - 1).toString();
                    });
                    renderInverters();
                }
                renderTransformers(section);
                saveData();
            }
            function copyTransformer(section, index) {
                const dataArray = section === 'production' ? projectTransformersProduction : projectTransformersSoutirage;
                dataArray.splice(index + 1, 0, JSON.parse(JSON.stringify(dataArray[index])));
                if (section === 'production') { renderInverters(); }
                renderTransformers(section);
                saveData();
            }
            function renderTransformers(section) {
                const container = section === 'production' ? transformerCardContainerProduction : transformerCardContainerSoutirage;
                container.innerHTML = "";
                const data = section === 'production' ? projectTransformersProduction : projectTransformersSoutirage;
                data.forEach((transfo, index) => {
                    const card = document.createElement('div');
                    card.className = 'data-card';
                    card.dataset.index = index;
                    card.dataset.section = section;
                    card.innerHTML = `
                     <div class="card-header">
                        <div class="card-title">${index + 1}. 
                            <span class="main-title">${transfo.fabricant || 'Transfo à choisir'}</span>
                            <span class="ref">${transfo.reference || ''}</span>
                            <button class="btn btn-secondary btn-small" data-action="select" style="margin-left: 10px;">Choisir</button>
                        </div>
                        <div class="card-actions">
                            <button class="action-btn" data-action="details" title="Détails">ℹ️</button>
                            <button class="action-btn" data-action="copy" title="Copier">📄</button>
                            <button class="action-btn" data-action="delete" title="Supprimer">❌</button>
                        </div>
                    </div>
                    <div class="card-content-grid" style="grid-template-columns: repeat(6, 1fr);">
                        <div class="card-field"><label>Intégrateur</label><div class="value">${transfo.integrateur || 'N/A'}</div></div>
                        <div class="card-field"><label>Sn (kVA)</label><div class="value">${transfo.sn_kva || 'N/A'}</div></div>
                        <div class="card-field"><label>Σ P.App Onduleurs</label><div class="value sum-p-app-inverters calculated-cell">0.00 kVA</div></div>
                        <div class="card-field"><label>Ucc (%)</label><div class="value">${transfo.ucc_percent || 'N/A'}</div></div>
                        <div class="card-field"><label>Ku (%)</label><input type="number" class="ku-percent" value="${transfo.ku_percent || 0}"></div>
                        <div class="card-field"><label>Ku (Dim)</label><div class="value ku-dim calculated-cell">0.00</div></div>
                    </div>
                    <div class="ku-dim-error" style="color: red; display: none; text-align: center; font-size: 0.9em; padding-top: 10px; grid-column: 1 / -1;"></div>
                `;
                    container.appendChild(card);
                });
                attachTransformerRowListeners(section);
                recalculateAllTransformerRows();
            }
            function attachTransformerRowListeners(section) {
                const container = section === 'production' ? transformerCardContainerProduction : transformerCardContainerSoutirage;
                container.querySelectorAll('.data-card').forEach(card => {
                    const index = parseInt(card.dataset.index, 10);
                    const dataArray = section === 'production' ? projectTransformersProduction : projectTransformersSoutirage;
                    card.querySelector('[data-action="select"]').addEventListener('click', () => openTransformerModal(section, index));
                    card.querySelector('[data-action="details"]').addEventListener('click', () => {
                        const dbTransfo = transformerDatabase.find(t => t.reference === dataArray[index].reference);
                        if (dbTransfo) showDetailsModal(`Détails transformateur: ${dbTransfo.reference}`, dbTransfo);
                    });
                    card.querySelector('[data-action="copy"]').addEventListener('click', () => copyTransformer(section, index));
                    card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteTransformer(section, index));
                    card.querySelector('.ku-percent').addEventListener('input', e => {
                        dataArray[index].ku_percent = parseFloat(e.target.value);
                        recalculateAllTransformerRows();
                        saveData();
                    });
                });
            }
            function recalculateAllTransformerRows() {
                const prodContainer = document.getElementById('transformerCardContainerProduction');
                projectTransformersProduction.forEach((transfo, index) => {
                    const pAppForThisTransfo = projectInverters
                        .filter(inv => inv.transformerId == index)
                        .reduce((sum, inv) => sum + (parseFloat(inv.pApparenteKva) || 0) * (inv.nbOnd || 1), 0);

                    const transfoPower = parseFloat(transfo.sn_kva) || 0;
                    const kuDim = transfoPower > 0 ? (pAppForThisTransfo / transfoPower) : 0;

                    const card = prodContainer.querySelector(`.data-card[data-index="${index}"]`);
                    if (card) {
                        card.querySelector('.ku-dim').textContent = kuDim.toFixed(2);
                        card.querySelector('.sum-p-app-inverters').textContent = `${pAppForThisTransfo.toFixed(2)} kVA`;
                        const errorEl = card.querySelector('.ku-dim-error');
                        if (kuDim > 1) {
                            errorEl.textContent = 'Veuillez augmenter la puissance du transformateur ou réduire la puissance des onduleurs';
                            errorEl.style.display = 'block';
                        } else {
                            errorEl.style.display = 'none';
                        }
                    }
                });
            }

            // --- GESTION DES MODALES ---
            function openAddModal(type) {
                document.getElementById('addPanelContainer').style.display = type === 'panel' ? 'block' : 'none';
                document.getElementById('addInverterContainer').style.display = type === 'inverter' ? 'block' : 'none';
                document.getElementById('addTransformerContainer').style.display = type === 'transformer' ? 'block' : 'none';

                let title = '';
                if (type === 'panel') title = 'Ajouter un panneau personnalisé';
                if (type === 'inverter') title = 'Ajouter un onduleur personnalisé';
                if (type === 'transformer') title = 'Ajouter un transformateur personnalisé';
                document.getElementById('addModalTitle').textContent = title;
                addModal.style.display = 'block';
            }
            function showVoltageInfo(index) {
                const inv = projectInverters[index];
                const dbInv = inverterDatabase.find(db => db.reference === inv.reference);
                const panel = getSelectedPanelData();
                if (!dbInv || !panel) { alert("Veuillez sélectionner un onduleur et un panneau."); return; }

                const globalSettings = { tempMin: parseFloat(minTempInput.value), tempMax: parseFloat(maxTempInput.value), tempFunc: parseFloat(funcTempInput.value) };
                const sizing = calculateStringSizing(panel, dbInv, globalSettings);

                const vSysMin = dbInv.ond_tension_min_dc || 0;
                const vSysMax = dbInv.ond_tension_max_dc || 0;
                const vMpptMin = dbInv.ond_plage_mppt_min || 0;
                const vMpptMax = dbInv.ond_plage_mppt_max || 0;
                const vOptimal = sizing.optimalVoltage || 0;
                const overallMax = Math.ceil(Math.max(vSysMax, vMpptMax, vOptimal) / 100) * 100;

                const svgWidth = 600, svgHeight = 150;
                const p = { top: 20, right: 20, bottom: 40, left: 40 };
                const chartWidth = svgWidth - p.left - p.right;
                const toX = (v) => p.left + (v / overallMax) * chartWidth;

                let ticks = '';
                for (let i = 0; i <= overallMax; i += Math.round(overallMax / 6 / 50) * 50) {
                    ticks += `<g transform="translate(${toX(i)}, 0)">
                    <line y1="${svgHeight - p.bottom}" y2="${svgHeight - p.bottom + 5}" stroke="#888"></line>
                    <text y="${svgHeight - p.bottom + 20}" x="0" text-anchor="middle" font-size="10">${i}</text>
                </g>`;
                }

                document.getElementById('voltageGraph').innerHTML = `
                <svg width="100%" viewBox="0 0 ${svgWidth} ${svgHeight}" style="overflow: visible;">
                    <line x1="${p.left}" y1="${svgHeight - p.bottom}" x2="${svgWidth - p.right}" y2="${svgHeight - p.bottom}" stroke="#333"></line>
                    <text x="${p.left + chartWidth / 2}" y="${svgHeight - 5}" text-anchor="middle" font-weight="bold" font-size="12">Tension (V)</text>
                    ${ticks}
                    
                    <rect x="${toX(vSysMin)}" y="10" width="${toX(vSysMax) - toX(vSysMin)}" height="25" fill="#6c757d" opacity="0.8"></rect>
                    <text x="${toX(vSysMin) + (toX(vSysMax) - toX(vSysMin)) / 2}" y="27" fill="white" font-size="10" text-anchor="middle">Plage Système (${vSysMin}V - ${vSysMax}V)</text>
                    
                    <rect x="${toX(vMpptMin)}" y="60" width="${toX(vMpptMax) - toX(vMpptMin)}" height="25" fill="${'var(--primary-color)'}"></rect>
                    <text x="${toX(vMpptMin) + (toX(vMpptMax) - toX(vMpptMin)) / 2}" y="77" fill="white" font-size="10" text-anchor="middle">Plage MPPT (${vMpptMin}V - ${vMpptMax}V)</text>
                    
                    ${vOptimal > 0 ? `
                        <line x1="${toX(vOptimal)}" y1="50" x2="${toX(vOptimal)}" y2="95" stroke="${'var(--title-red-color)'}" stroke-width="2"></line>
                        <text x="${toX(vOptimal)}" y="45" fill="${'var(--title-red-color)'}" font-size="10" text-anchor="middle" font-weight="bold">V. Optimale (${vOptimal.toFixed(1)}V)</text>
                    ` : ''}
                </svg>
            `;

                document.getElementById('voltageInfoTable').innerHTML = `
                <tr><td>Tension système min/max</td><td>${vSysMin}V / ${vSysMax}V</td></tr>
                <tr><td>Plage MPPT min/max</td><td>${vMpptMin}V / ${vMpptMax}V</td></tr>
                <tr><td>Nb PV optimal / chaîne</td><td>${sizing.nbPvRendOptimal}</td></tr>
                <tr><td>Tension de fonctionnement optimale</td><td>${vOptimal.toFixed(1)}V</td></tr>
            `;
                voltageInfoModal.querySelector('#voltageInfoModalTitle').textContent = `Analyse des tensions pour ${dbInv.reference}`;
                voltageInfoModal.style.display = 'block';
            }
            function getSelectedPanelData() {
                const selectedRow = panelTableBody.querySelector('tr.selected');
                return selectedRow ? panelDatabase.find(p => p.reference === selectedRow.dataset.ref) : null;
            }
            const showDetailsModal = (title, dataObject) => {
                detailsModal.querySelector('#detailsModalTitle').textContent = title;
                const tableBody = detailsModal.querySelector('#detailsModalTable');
                tableBody.innerHTML = Object.entries(dataObject)
                    .filter(([key]) => key !== 'isDefault' && key !== 'plage_mppt')
                    .map(([key, value]) => `<tr><td style="text-transform: capitalize; text-align: left;">${key.replace(/_/g, ' ')}</td><td style="text-align: left;">${value}</td></tr>`)
                    .join('');
                detailsModal.style.display = 'block';
            };
            function populateInverterSelectionTable() {
                const tbody = inverterModal.querySelector('#inverterSelectionTable tbody');
                const activeFilters = [...document.querySelectorAll('#inverterFilters .filter-btn.active')].map(btn => btn.dataset.filter);

                let filteredInverters = inverterDatabase;
                if (activeFilters.length > 0) {
                    filteredInverters = inverterDatabase.filter(inv => {
                        return activeFilters.every(filter => {
                            if (filter === 'triphase') return inv.type_tension === 'Triphasé';
                            if (filter === 'monophase') return inv.type_tension === 'Monophasé';
                            if (filter === 'hybride') return inv.hybride === 'Oui';
                            if (filter === 'optimiseur') return inv.compat_optimiseur === 'Oui';
                            return true;
                        });
                    });
                }

                tbody.innerHTML = filteredInverters.map(dbInv => `<tr>
                <td>${dbInv.fabricant}</td>
                <td>${dbInv.reference}</td>
                <td>${dbInv.p_nominale_kva} kVA</td>
                <td>${dbInv.type_tension}</td>
                <td>
                    <button class="btn btn-small btn-secondary" data-action="details" data-ref="${dbInv.reference}">Détails</button> 
                    <button class="btn btn-small" data-action="select" data-ref="${dbInv.reference}">Choisir</button>
                </td>
            </tr>`).join('');
            }
            function openInverterModal(index) {
                editingInverterIndex = index;
                populateInverterSelectionTable();
                inverterModal.style.display = 'block';
            }
            function openTransformerModal(section, index) {
                editingTransformer = { index, section };
                populateTransformerSelectionTable();
                transformerModal.style.display = 'block';
            }
            function populateTransformerSelectionTable() {
                const tbody = transformerModal.querySelector('#transformerSelectionTable tbody');
                tbody.innerHTML = transformerDatabase.map(t => `<tr>
                <td>${t.fabricant}</td>
                <td>${t.reference}</td>
                <td>${t.sn_kva} kVA</td>
                <td>${t.tension_primaire_secondaire}</td>
                <td>
                    <button class="btn btn-small btn-secondary" data-action="details" data-ref="${t.reference}">Détails</button>
                    <button class="btn btn-small" data-action="select" data-ref="${t.reference}">Choisir</button>
                </td>
            </tr>`).join('');
            }

            // --- SAUVEGARDE ET CHARGEMENT ---
            function saveData() {
                const dataToSave = {
                    globalSettings: { cosPhi: cosPhiInput.value, minTemp: minTempInput.value, maxTemp: maxTempInput.value, funcTemp: funcTempInput.value },
                    selectedPanelRef: getSelectedPanelData()?.reference,
                    projectInverters,
                    projectTransformersProduction,
                    projectTransformersSoutirage,
                    calepinageInfo: {
                        power: document.getElementById('installedPower').value,
                        panels: document.getElementById('nbre_pv_calepinage').value,
                        productible: document.getElementById('productible').value,
                        structures: document.getElementById('nbStructure').value,
                    },
                    connectionMode: document.querySelector('.choice-btn.active')?.dataset.value,
                    soutirageInfo: {
                        prm: document.getElementById('prm').value,
                        puissanceSouscrite: document.getElementById('puissanceSouscrite').value,
                        puissanceRaccordement: document.getElementById('puissanceRaccordement').value
                    }
                };
                const dataString = JSON.stringify(dataToSave);
                localStorage.setItem(LOCAL_STORAGE_KEY, dataString);
                sessionStorage.setItem(LOCAL_STORAGE_KEY, dataString);
            }
            function loadData() {
                panelDatabase.push(...JSON.parse(localStorage.getItem(PANEL_DB_KEY) || '[]'));
                inverterDatabase.push(...JSON.parse(localStorage.getItem(INVERTER_DB_KEY) || '[]'));
                transformerDatabase.push(...JSON.parse(localStorage.getItem(TRANSFORMER_DB_KEY) || '[]'));

                const savedData = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY));
                if (savedData) {
                    if (savedData.globalSettings) {
                        cosPhiInput.value = savedData.globalSettings.cosPhi || 0.944;
                        minTempInput.value = savedData.globalSettings.minTemp || 45;
                        funcTempInput.value = savedData.globalSettings.funcTemp || 20;
                        maxTempInput.value = savedData.globalSettings.maxTemp || 45;
                    }
                    projectInverters = savedData.projectInverters || [];
                    projectTransformersProduction = savedData.projectTransformersProduction || [];
                    projectTransformersSoutirage = savedData.projectTransformersSoutirage || [];

                    if (savedData.calepinageInfo) {
                        document.getElementById('installedPower').value = savedData.calepinageInfo.power || '';
                        document.getElementById('nbre_pv_calepinage').value = savedData.calepinageInfo.panels || '';
                        document.getElementById('productible').value = savedData.calepinageInfo.productible || '';
                        document.getElementById('nbStructure').value = savedData.calepinageInfo.structures || '';
                    }

                    if (savedData.soutirageInfo) {
                        document.getElementById('prm').value = savedData.soutirageInfo.prm || '';
                        document.getElementById('puissanceSouscrite').value = savedData.soutirageInfo.puissanceSouscrite || '';
                        document.getElementById('puissanceRaccordement').value = savedData.soutirageInfo.puissanceRaccordement || '';
                    }

                    const selectedMode = savedData.connectionMode || 'BT';
                    connectionModeButtons.querySelectorAll('.choice-btn').forEach(btn => btn.classList.remove('active'));
                    document.querySelector(`.choice-btn[data-value="${selectedMode}"]`)?.classList.add('active');
                    updateVisibility(selectedMode);

                    setTimeout(() => {
                        if (savedData.selectedPanelRef) {
                            const savedRow = panelTableBody.querySelector(`tr[data-ref="${savedData.selectedPanelRef}"]`);
                            if (savedRow) { savedRow.classList.add('selected'); showPanelInfoBtn.disabled = false; }
                        }
                        renderInverters();
                        renderTransformers('production');
                        renderTransformers('soutirage');
                    }, 0);

                } else {
                    projectInverters = [{ ...inverterDatabase[0], nbPanneaux: 22, bridage: 0, nbOnd: 1, transformerId: '0' }];
                    projectTransformersProduction = [{ ...transformerDatabase[0] }];
                    updateVisibility('BT');
                    renderInverters();
                    renderTransformers('production');
                    renderTransformers('soutirage');
                }
            }

            // --- ÉCOUTEURS D'ÉVÉNEMENTS ---
            connectionModeButtons.addEventListener('click', e => {
                if (e.target.classList.contains('choice-btn')) {
                    const selectedMode = e.target.dataset.value;
                    connectionModeButtons.querySelectorAll('.choice-btn').forEach(btn => btn.classList.remove('active'));
                    e.target.classList.add('active');
                    updateVisibility(selectedMode);
                    saveData();
                }
            });
            inverterModal.querySelector('#inverterFilters').addEventListener('click', e => {
                if (e.target.classList.contains('filter-btn')) {
                    e.target.classList.toggle('active');
                    populateInverterSelectionTable();
                }
            });
            inverterModal.querySelector('#inverterSelectionTable').addEventListener('click', e => {
                const button = e.target.closest('button');
                if (!button) return;
                const { action, ref } = button.dataset;
                if (!action || !ref) return;
                const selectedDbInv = inverterDatabase.find(i => i.reference === ref);
                if (!selectedDbInv) return;
                if (action === 'details') {
                    showDetailsModal(`Détails onduleur: ${selectedDbInv.reference}`, selectedDbInv);
                } else if (action === 'select' && editingInverterIndex !== null) {
                    const currentInv = projectInverters[editingInverterIndex];
                    projectInverters[editingInverterIndex] = { ...currentInv, ...selectedDbInv, pApparenteKva: selectedDbInv.p_apparente_kva };
                    renderInverters();
                    saveData();
                    inverterModal.style.display = 'none';
                    editingInverterIndex = null;
                }
            });
            transformerModal.querySelector('#transformerSelectionTable').addEventListener('click', e => {
                const button = e.target.closest('button');
                if (!button) return;
                const { action, ref } = button.dataset;
                if (!action || !ref) return;
                const selectedDbTransfo = transformerDatabase.find(t => t.reference === ref);
                if (!selectedDbTransfo) return;
                if (action === 'details') {
                    showDetailsModal(`Détails transformateur: ${selectedDbTransfo.reference}`, selectedDbTransfo);
                } else if (action === 'select' && editingTransformer.index !== null) {
                    const { section, index } = editingTransformer;
                    const dataArray = section === 'production' ? projectTransformersProduction : projectTransformersSoutirage;
                    const currentKu = dataArray[index] ? dataArray[index].ku_percent : undefined;
                    dataArray[index] = { ku_percent: currentKu, ...selectedDbTransfo };
                    renderTransformers(section);
                    if (section === 'production') { renderInverters(); }
                    saveData();
                    transformerModal.style.display = 'none';
                    editingTransformer = { index: null, section: '' };
                }
            });

            addInverterBtn.addEventListener('click', addInverter);
            addPanelBtn.addEventListener('click', () => openAddModal('panel'));
            document.querySelectorAll('.add-transformer-btn').forEach(btn => btn.addEventListener('click', () => addTransformer(btn.dataset.section)));

            document.getElementById('resetCalcBtn').addEventListener('click', () => {
                if (confirm("Êtes-vous sûr de vouloir réinitialiser tous les calculs et les données du projet ?")) {
                    localStorage.removeItem(LOCAL_STORAGE_KEY);
                    localStorage.removeItem(PANEL_DB_KEY);
                    localStorage.removeItem(INVERTER_DB_KEY);
                    localStorage.removeItem(TRANSFORMER_DB_KEY);
                    location.reload();
                }
            });

            // Handle form submissions for adding new items
            function handleAddForm(form, db, dbKey, refreshFn) {
                const formData = new FormData(form);
                const newEntry = {};
                for (let [key, value] of formData.entries()) {
                    newEntry[key] = value;
                }

                if (newEntry.integrateur === 'Autres' && newEntry.integrateur_autre) {
                    newEntry.integrateur = newEntry.integrateur_autre;
                }
                delete newEntry.integrateur_autre;

                db.push(newEntry);
                localStorage.setItem(dbKey, JSON.stringify(db.filter(p => !p.isDefault)));
                addModal.style.display = 'none';
                form.reset();
                if (refreshFn) refreshFn();

                document.getElementById('integrateurAutreContainer').style.display = 'none';
                const transfoForm = document.getElementById('addTransformerForm');
                transfoForm.querySelector('select[name="dielectrique"]').disabled = false;
            }
            document.getElementById('addPanelForm').addEventListener('submit', (e) => {
                e.preventDefault();
                handleAddForm(e.target, panelDatabase, PANEL_DB_KEY, () => {
                    populateManufacturersFilter();
                    populatePanelTable();
                });
            });
            document.getElementById('addInverterForm').addEventListener('submit', (e) => {
                e.preventDefault();
                handleAddForm(e.target, inverterDatabase, INVERTER_DB_KEY);
            });
            document.getElementById('addTransformerForm').addEventListener('submit', (e) => {
                e.preventDefault();
                handleAddForm(e.target, transformerDatabase, TRANSFORMER_DB_KEY);
            });

            document.querySelectorAll('.modal .close-btn').forEach(btn => btn.addEventListener('click', (e) => e.target.closest('.modal').style.display = 'none'));
            window.addEventListener('click', (event) => { if (event.target.classList.contains('modal')) event.target.style.display = "none"; });

            function populateManufacturersFilter() {
                const manufacturers = ['all', ...new Set(panelDatabase.map(p => p.fabricant).sort())];
                panelManufacturerSelect.innerHTML = manufacturers.map(m => `<option value="${m}">${m === 'all' ? 'Tous les fabricants' : m}</option>`).join('');
            }
            function populatePanelTable() {
                const filter = panelManufacturerSelect.value;
                panelTableBody.innerHTML = '';
                const panelsToShow = (filter === 'all') ? panelDatabase : panelDatabase.filter(p => p.fabricant === filter);
                const groupedByManufacturer = panelsToShow.reduce((acc, panel) => { (acc[panel.fabricant] = acc[panel.fabricant] || []).push(panel); return acc; }, {});
                for (const manufacturer in groupedByManufacturer) {
                    const headerRow = panelTableBody.insertRow();
                    headerRow.className = 'manufacturer-header';
                    headerRow.innerHTML = `<td colspan="3">${manufacturer}</td>`;
                    groupedByManufacturer[manufacturer].forEach(panel => {
                        const row = panelTableBody.insertRow();
                        row.className = 'panel-row';
                        row.dataset.ref = panel.reference;
                        row.innerHTML = `<td></td><td>${panel.reference}</td><td>${panel.puissance_wc} Wc</td>`;
                    });
                }
            }
            panelManufacturerSelect.addEventListener('change', populatePanelTable);
            panelTableBody.addEventListener('click', (e) => {
                const clickedRow = e.target.closest('tr.panel-row');
                if (!clickedRow) return;
                panelTableBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
                clickedRow.classList.add('selected');
                showPanelInfoBtn.disabled = false;
                recalculateAllInverterRows();
                saveData();
            });
            showPanelInfoBtn.addEventListener('click', () => {
                const panel = getSelectedPanelData();
                if (panel) showDetailsModal('Détails du panneau', panel);
            });

            // --- NOUVEAUX ÉCOUTEURS D'ÉVÉNEMENTS POUR CORRECTIONS ---
            const transfoForm = document.getElementById('addTransformerForm');
            const transfoFabricantSelect = transfoForm.querySelector('select[name="fabricant"]');
            const transfoDielectriqueSelect = transfoForm.querySelector('select[name="dielectrique"]');
            const integrateurSelect = transfoForm.querySelector('select[name="integrateur"]');
            const integrateurAutreContainer = document.getElementById('integrateurAutreContainer');

            transfoFabricantSelect.addEventListener('change', (e) => {
                if (e.target.value === 'Schneider Electric') {
                    transfoDielectriqueSelect.value = 'Sec (AN)';
                    transfoDielectriqueSelect.disabled = true;
                } else {
                    transfoDielectriqueSelect.disabled = false;
                }
            });

            integrateurSelect.addEventListener('change', (e) => {
                if (e.target.value === 'Autres') {
                    integrateurAutreContainer.style.display = 'block';
                } else {
                    integrateurAutreContainer.style.display = 'none';
                }
            });

            document.getElementById('addNewInverterFromPopupBtn').addEventListener('click', () => openAddModal('inverter'));
            document.getElementById('addNewTransformerFromPopupBtn').addEventListener('click', () => openAddModal('transformer'));


            // --- INITIALISATION ---
            populateManufacturersFilter();
            populatePanelTable();
            loadData();
        });