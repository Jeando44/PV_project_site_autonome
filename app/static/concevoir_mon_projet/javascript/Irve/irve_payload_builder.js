// Script IRVE &Autoconsommation
        (function() {
            let lastSavedState = null;

            function getProjetId() {
                return localStorage.getItem('current_projet_id');
            }

            // Collecte de manière exhaustive l'intégralité des données d'interface de la modale IRVE
            function serializeIrveForm() {
                const payload = {
                    simpleInputs: {},
                    radios: {},
                    checkboxes: {},
                    tables: {
                        bornes: [],
                        equipments: [],
                        seasonal: [],
                        planning: []
                    },
                    uiState: {
                        consoMode: null,
                        generationMethod: null,
                        sectionsCollapsed: {}
                    },
                    // CORRECTIF : la consommation existante importée (.xlsx/.csv, mode "Importation")
                    // n'était jusqu'ici jamais sauvegardée — seuls les champs de formulaire l'étaient,
                    // pas les points de données lus depuis le fichier (window.importedData, cf.
                    // calcul_irve.js). Sans ça, réouvrir la modale perdait le fichier importé même
                    // si tout le reste de l'état était restauré.
                    importedConsumption: {
                        useImportedData: !!window.useImportedData,
                        importedPasTemps: window.importedPasTemps || 60,
                        importedData: Array.isArray(window.importedData) ? window.importedData : null
                    },
                    // Resultat du pre-dimensionnement site isole (cf. autonomyCalculator.js) : ce
                    // n'est pas un champ de formulaire, il ne serait donc jamais capture par le
                    // balayage DOM ci-dessous. Il doit pourtant survivre au-dela du navigateur
                    // courant : la carte "Total" du calepinage maison et le modal Etudes economiques
                    // en ont besoin (taux de couverture reel, consommation annuelle du site) alors
                    // qu'ils vivent dans une autre page, potentiellement sur une autre machine.
                    autonomySummary: window.SITE_AUTONOMY_SUMMARY || null
                };

                // La section PAC / Climatiseur aura sa propre persistance (cf. docs/pac_climatisation_plan.md) :
                // ses champs ne sont ni enregistrés ni restaurés avec l'IRVE.
                const horsPac = (el) => !el.closest('#pac-section-content');

                // 1. Inputs text, number, select, textarea standard
                document.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]):not([type="file"]), select, textarea').forEach(el => {
                    if (!el.id || !horsPac(el)) return;
                    payload.simpleInputs[el.id] = el.value;
                });

                // 2. Radios par nom
                document.querySelectorAll('input[type="radio"]').forEach(el => {
                    if (el.checked && horsPac(el)) {
                        payload.radios[el.name] = el.value;
                    }
                });

                // 3. Checkboxes par ID
                document.querySelectorAll('input[type="checkbox"]').forEach(el => {
                    if (el.id && horsPac(el)) {
                        payload.checkboxes[el.id] = el.checked;
                    }
                });

                // 4. Tableau de choix des bornes (#irve-selection-table tbody tr)
                document.querySelectorAll('#irve-selection-table tbody tr').forEach(row => {
                    const selects = row.querySelectorAll('select');
                    const inputs = row.querySelectorAll('input');
                    if (selects.length >= 3 && inputs.length >= 3) {
                        payload.tables.bornes.push({
                            fabricant: selects[0].value || '',
                            type: selects[1].value || '',
                            tension: selects[2].value || '',
                            puissance: inputs[0].value || '',
                            pdc: inputs[1].value || '',
                            quantite: inputs[2].value || ''
                        });
                    }
                });

                // 5. Tableau de modélisation par équipement (Bottom-Up)
                document.querySelectorAll('#equipment-table-body tr').forEach(row => {
                    const inputs = row.querySelectorAll('input');
                    if (inputs.length >= 8) {
                        payload.tables.equipments.push({
                            name: inputs[0].value || '',
                            power: inputs[1].value || '',
                            qty: inputs[2].value || '',
                            cosphi: inputs[3].value || '',
                            start: inputs[4].value || '',
                            end: inputs[5].value || '',
                            activeDays: inputs[6].value || '',
                            activeSeasons: inputs[7].value || ''
                        });
                    }
                });

                // 6. Tableau de saisie manuelle / Saisons (#seasonal-consumption-table)
                document.querySelectorAll('#seasonal-consumption-table input').forEach(el => {
                    const key = el.id || el.dataset.coord;
                    if (key) {
                        payload.tables.seasonal.push({ key: key, value: el.value || '' });
                    }
                });

                // 7. Tableau de planification de la recharge (#planning-detail-tbody tr)
                document.querySelectorAll('#planning-detail-tbody tr').forEach((row, idx) => {
                    const groupCell = row.cells[0];
                    if (!groupCell || row.cells.length < 4) return;
                    
                    const groupName = groupCell.textContent.trim();
                    const select = row.querySelector('select');
                    
                    const selectedHours = [];
                    row.querySelectorAll('.segment.selected').forEach(seg => {
                        const hour = parseInt(seg.dataset.hour);
                        if (!isNaN(hour)) selectedHours.push(hour);
                    });

                    const rowInputs = [];
                    row.querySelectorAll('input[type="number"], input[type="text"]').forEach(inp => {
                        rowInputs.push({ id: inp.id, value: inp.value || '' });
                    });

                    payload.tables.planning.push({
                        groupName: groupName,
                        rowIndex: idx,
                        strategy: select ? select.value : null,
                        selectedHours: selectedHours,
                        inputs: rowInputs
                    });
                });

                // 8. Capture de l'état de l'interface utilisateur
                const activeConsoMode = document.querySelector('input[name="conso_mode"]:checked');
                payload.uiState.consoMode = activeConsoMode ? activeConsoMode.value : null;

                const bottomupVisible = document.getElementById('bottomup-panel') && document.getElementById('bottomup-panel').style.display !== 'none';
                const topdownVisible = document.getElementById('topdown-panel') && document.getElementById('topdown-panel').style.display !== 'none';
                payload.uiState.generationMethod = bottomupVisible ? 'bottomup' : (topdownVisible ? 'topdown' : null);

                ['section1-content', 'autonomy-section-content', 'section3-content', 'section4-content'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        payload.uiState.sectionsCollapsed[id] = el.style.display === 'none';
                    }
                });

                return payload;
            }

            // Restaure l'état complet à partir de l'objet sauvegardé
            function deserializeIrveForm(payload) {
                if (!payload) return;

                // 1. Restaurer les inputs standard, selects, textareas
                if (payload.simpleInputs) {
                    for (const [id, val] of Object.entries(payload.simpleInputs)) {
                        const el = document.getElementById(id);
                        if (el) {
                            el.value = val;
                        }
                    }
                }

                // 2. Restaurer les checkboxes
                if (payload.checkboxes) {
                    for (const [id, val] of Object.entries(payload.checkboxes)) {
                        const el = document.getElementById(id);
                        if (el) {
                            el.checked = val;
                        }
                    }
                }

                // 3. Restaurer les radios de manière synchrone
                if (payload.radios) {
                    for (const [name, val] of Object.entries(payload.radios)) {
                        const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
                        if (el) {
                            el.checked = true;
                        }
                    }
                }

                // 4. Recréer et restaurer le tableau dynamique des bornes
                if (payload.tables && payload.tables.bornes && payload.tables.bornes.length > 0) {
                    const tbody = document.querySelector('#irve-selection-table tbody');
                    if (tbody) {
                        tbody.innerHTML = '';
                        payload.tables.bornes.forEach(borne => {
                            if (typeof addRow === 'function') {
                                addRow(document.getElementById('irve-selection-table-container'));
                                const lastRow = tbody.lastElementChild;
                                if (lastRow) {
                                    const selects = lastRow.querySelectorAll('select');
                                    const inputs = lastRow.querySelectorAll('input');
                                    if (selects.length >= 3 && inputs.length >= 3) {
                                        selects[0].value = borne.fabricant;
                                        selects[0].dispatchEvent(new Event('change', { bubbles: true }));
                                        selects[1].value = borne.type;
                                        selects[1].dispatchEvent(new Event('change', { bubbles: true }));
                                        selects[2].value = borne.tension;
                                        inputs[0].value = borne.puissance;
                                        inputs[1].value = borne.pdc;
                                        inputs[2].value = borne.quantite;
                                    }
                                }
                            }
                        });
                    }
                }

                // 5. Recréer et restaurer le tableau dynamique par équipement (Bottom-Up)
                if (payload.tables && payload.tables.equipments && payload.tables.equipments.length > 0) {
                    const tbody = document.getElementById('equipment-table-body');
                    if (tbody) {
                        tbody.innerHTML = '';
                        payload.tables.equipments.forEach(eq => {
                            if (typeof addEquipmentRow === 'function') {
                                addEquipmentRow();
                                const lastRow = tbody.lastElementChild;
                                if (lastRow) {
                                    const inputs = lastRow.querySelectorAll('input');
                                    if (inputs.length >= 8) {
                                        inputs[0].value = eq.name;
                                        inputs[1].value = eq.power;
                                        inputs[2].value = eq.qty;
                                        inputs[3].value = eq.cosphi;
                                        inputs[4].value = eq.start;
                                        inputs[5].value = eq.end;
                                        inputs[6].value = eq.activeDays;
                                        inputs[7].value = eq.activeSeasons;
                                    }
                                }
                            }
                        });
                    }
                }

                // 6. Restaurer le tableau de saisie manuelle / Saisons
                if (payload.tables && payload.tables.seasonal && payload.tables.seasonal.length > 0) {
                    payload.tables.seasonal.forEach(item => {
                        const el = document.getElementById(item.key) || document.querySelector(`input[data-coord="${item.key}"]`);
                        if (el) {
                            el.value = item.value;
                        }
                    });
                }

                // Déclencher les événements de recalcul et de synchronisation des inputs
                document.querySelectorAll('input, select, textarea').forEach(el => {
                    if (el.closest('#pac-section-content')) return;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });

                // 7. Restaurer l'état visuel et structurel de l'interface
                if (payload.uiState) {
                    if (payload.uiState.consoMode) {
                        const r = document.querySelector(`input[name="conso_mode"][value="${payload.uiState.consoMode}"]`);
                        if (r) {
                            r.checked = true;
                            if (typeof toggleConsoMode === 'function') toggleConsoMode(payload.uiState.consoMode);
                        }
                    }
                    if (payload.uiState.generationMethod) {
                        if (typeof selectGenerationMethod === 'function') selectGenerationMethod(payload.uiState.generationMethod);
                    }
                    if (payload.uiState.sectionsCollapsed) {
                        for (const [id, collapsed] of Object.entries(payload.uiState.sectionsCollapsed)) {
                            const el = document.getElementById(id);
                            const btn = document.getElementById(id.replace('content', 'toggle-btn')) || document.querySelector(`[onclick*="${id}"]`);
                            if (el) {
                                el.style.display = collapsed ? 'none' : 'block';
                                if (btn) btn.textContent = collapsed ? 'afficher' : 'masquer';
                            }
                        }
                    }
                }

                // 7bis. CORRECTIF : restaurer la consommation existante importée (window.importedData,
                // cf. calcul_irve.js::importExistingData) — le mode ("import") est déjà réappliqué par
                // le bloc uiState ci-dessus (affiche la section, mais sans les données du fichier).
                if (payload.importedConsumption && payload.importedConsumption.useImportedData && Array.isArray(payload.importedConsumption.importedData)) {
                    window.useImportedData = true;
                    window.importedPasTemps = payload.importedConsumption.importedPasTemps || 60;
                    window.importedData = payload.importedConsumption.importedData;
                    const statusEl = document.getElementById('import-data-status');
                    if (statusEl) {
                        statusEl.textContent = `Statut : ${window.importedData.length} points restaurés (fichier précédemment importé, pas de ${window.importedPasTemps} min).`;
                    }
                    if (typeof renderSiteConsumptionCharts === 'function') renderSiteConsumptionCharts();
                }

                // 8. Restaurer la planification de recharge par ligne (Attendre s'il y a un calcul asynchrone)
                if (payload.tables && payload.tables.planning && payload.tables.planning.length > 0) {
                    const applyPlanning = () => {
                        let matched = false;
                        document.querySelectorAll('#planning-detail-tbody tr').forEach(row => {
                            const groupCell = row.cells[0];
                            if (!groupCell) return;
                            const name = groupCell.textContent.trim();
                            const saved = payload.tables.planning.find(p => p.groupName === name);
                            if (saved) {
                                matched = true;
                                const select = row.querySelector('select');
                                if (select && saved.strategy) {
                                    select.value = saved.strategy;
                                    select.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                                if (saved.inputs) {
                                    saved.inputs.forEach(inp => {
                                        const el = row.querySelector(`#${inp.id}`) || document.getElementById(inp.id);
                                        if (el) {
                                            el.value = inp.value;
                                            el.dispatchEvent(new Event('input', { bubbles: true }));
                                        }
                                    });
                                }
                                if (saved.selectedHours) {
                                    row.querySelectorAll('.segment').forEach(seg => {
                                        const hr = parseInt(seg.dataset.hour);
                                        if (saved.selectedHours.includes(hr)) {
                                            seg.classList.add('selected');
                                        } else {
                                            seg.classList.remove('selected');
                                        }
                                    });
                                }
                            }
                        });
                        return matched;
                    };

                    if (!applyPlanning()) {
                        let retry = 0;
                        const task = setInterval(() => {
                            retry++;
                            if (applyPlanning() || retry > 20) clearInterval(task);
                        }, 400);
                    }
                }
            }

            async function saveIrveToDatabase() {
                const projetId = getProjetId();
                if (!projetId) return;

                const data = serializeIrveForm();
                const currentStateStr = JSON.stringify(data);

                if (lastSavedState === currentStateStr) {
                    console.log("💾 [IRVE] Pas de modification détectée. Sauvegarde réseau ignorée.");
                    return;
                }

                try {
                    const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/irve/save`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data: data })
                    });
                    const res = await response.json();
                    if (res.success) {
                        lastSavedState = currentStateStr;
                        console.log("💾 [IRVE] Données sauvegardées en base SQLite.");
                    }
                } catch (e) {
                    console.warn("⚠️ Échec de la sauvegarde automatique IRVE :", e);
                }
            }

            /**
             * Remet en place le resume d'autonomie persiste en base : variable globale (lue par
             * serializeIrveForm ci-dessus, pour ne pas le perdre a la prochaine sauvegarde) et cache
             * localStorage scope projet (lu par les ecrans d'une AUTRE page : carte "Total" du
             * calepinage maison, modal Etudes economiques).
             */
            function restoreAutonomySummary(data) {
                const summary = data && data.autonomySummary;
                if (!summary) return;
                window.SITE_AUTONOMY_SUMMARY = summary;
                try {
                    const projectId = localStorage.getItem('current_projet_id') || 'no-project';
                    localStorage.setItem('skv_site_autonomy_summary_' + projectId, JSON.stringify(summary));
                } catch (e) {
                    console.warn("[IRVE] Résumé d'autonomie non mis en cache :", e);
                }
            }

            // Expose la sauvegarde : calculateAutonomy() (autonomyCalculator.js) la declenche
            // immediatement apres un calcul, pour que le resume soit persiste sans attendre l'un des
            // declencheurs d'autosave ci-dessous.
            window.saveIrveDataToServer = saveIrveToDatabase;

            // La requête part dès que possible ; la restauration du formulaire, elle, attend toujours
            // `delaiMs` (délai historique laissé aux autres initialisations de la page).
            // sans_courbe=1 : la courbe de charge n'est pas utile ici (cf. irve/load côté serveur).
            async function loadIrveFromDatabase(delaiMs = 0) {
                const projetId = getProjetId();
                const attente = new Promise(resolve => setTimeout(resolve, delaiMs));
                try {
                    if (!projetId) return;
                    const requete = fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/irve/load?sans_courbe=1`)
                        .then(response => response.json());
                    const [res] = await Promise.all([requete, attente]);
                    if (res.success && res.config_exists) {
                        console.log("📋 [IRVE] Données restaurées depuis la base SQLite.");
                        deserializeIrveForm(res.config.data);
                        restoreAutonomySummary(res.config.data);
                        lastSavedState = JSON.stringify(res.config.data);
                    }
                } catch (e) {
                    console.warn("⚠️ Échec du chargement automatique IRVE :", e);
                } finally {
                    document.dispatchEvent(new CustomEvent('irveDonneesRestaurees'));
                }
            }

            // CORRECTIF : la sauvegarde en base ne se déclenche plus sur CHAQUE input/change (évite
            // le bombardement de requêtes constaté), mais reste déclenchée sur les actions qui
            // représentent une vraie perte de configuration si elles ne sont pas persistées : le clic
            // sur "Calculer la consommation" (état complet + courbe calculée, cf. calcul_irve.js),
            // le changement de pas de temps de recharge (#pas_temps — sinon il retombe à 60 min par
            // défaut à la prochaine ouverture), et la sélection des plages de recharge (clic sur un
            // ".segment" de planification) — sans quoi la planification saisie par l'utilisateur
            // n'était jamais sauvegardée tant qu'il ne relançait pas un calcul complet.
            document.addEventListener('click', function(e) {
                if (e.target.getAttribute('onclick')?.includes('calculateEnergie')) {
                    setTimeout(saveIrveToDatabase, 1000);
                }
                if (e.target.classList.contains('segment') || e.target.closest('.segment')) {
                    setTimeout(saveIrveToDatabase, 200);
                }
            });

            document.addEventListener('change', function(e) {
                if (e.target.id === 'pas_temps') {
                    saveIrveToDatabase();
                }
            });

            // Restauration asynchrone au montage du document
            document.addEventListener('DOMContentLoaded', function() {
                loadIrveFromDatabase(800);
            });
        })();
    