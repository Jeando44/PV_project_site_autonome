export class ShareManager2 {
    constructor() {
        this.init();
    }

    init() {
        console.log("🔗 ShareManager initialisé");
        this.injectStyles();
    }

    injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .share-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                animation: fadeIn 0.3s ease;
            }

            .share-modal-content {
                background: white;
                border-radius: 8px;
                max-width: 600px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                animation: slideUp 0.3s ease;
            }

            .detail-modal-content {
                max-width: 900px;
            }

            .share-modal-header {
                background: linear-gradient(135deg, var(--dark-gray) 0%, #2a2a2a 100%);
                color: white;
                height: 60px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-shrink: 0;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                padding: 0 15px;
                position: sticky;
                top: 0;
                z-index: 10;
            }

            .share-modal-header h4 {
                margin: 0;
                font-size: 18px;
                font-weight: 600;
                color: white;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .share-modal-header h4 i {
                color: var(--secondary-color);
                font-size: 20px;
            }

            .share-modal-header .btn,
            .share-modal-header button {
                background: none;
                border: none;
                color: white;
                font-size: 20px;
                cursor: pointer;
                width: 35px;
                height: 35px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: all 0.2s ease;
                padding: 0;
            }

            .share-modal-header .btn:hover,
            .share-modal-header button:hover {
                background-color: rgba(222, 0, 0, 0.2);
                color: var(--secondary-color);
                transform: scale(1.1);
            }

            .share-modal-body {
                padding: 20px;
            }

            .share-modal-footer {
                padding: 15px 20px;
                border-top: 1px solid #dee2e6;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }

            .share-option {
                padding: 15px;
                border: 2px solid #e0e0e0;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.3s;
                margin-bottom: 10px;
            }

            .share-option:hover {
                border-color: #667eea;
                background: #f8f9fa;
            }

            .share-option.selected {
                border-color: #667eea;
                background: #e7eaf6;
            }

            .share-link-container {
                display: flex;
                gap: 10px;
                margin-top: 15px;
            }

            .share-link-input {
                flex: 1;
                padding: 10px;
                border: 1px solid #ced4da;
                border-radius: 4px;
                font-family: monospace;
            }

            .detail-section {
                margin-bottom: 20px;
                padding: 15px;
                background: #f8f9fa;
                border-radius: 8px;
                border-left: 4px solid #de0000;
            }

            .detail-label {
                font-weight: bold;
                color: #495057;
                margin-bottom: 5px;
            }

            .detail-value {
                color: #212529;
            }

            .confirm-icon {
                font-size: 48px;
                color: #dc3545;
                text-align: center;
                margin-bottom: 20px;
            }

            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }

            @keyframes slideUp {
                from { transform: translateY(50px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }

            .permission-badge {
                display: inline-block;
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 0.85em;
                font-weight: 600;
                margin: 2px;
            }

            .permission-view { background: #d1ecf1; color: #0c5460; }
            .permission-edit { background: #fff3cd; color: #856404; }
            .permission-admin { background: #f8d7da; color: #721c24; }

            /* Validation des champs */
            .form-control.is-valid {
                border-color: #28a745;
                background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'%3e%3cpath fill='%2328a745' d='M2.3 6.73L.6 4.53c-.4-1.04.46-1.4 1.1-.8l1.1 1.4 3.4-3.8c.6-.63 1.6-.27 1.2.7l-4 4.6c-.43.5-.8.4-1.1.1z'/%3e%3c/svg%3e");
                background-repeat: no-repeat;
                background-position: right calc(0.375em + 0.1875rem) center;
                background-size: calc(0.75em + 0.375rem) calc(0.75em + 0.375rem);
                padding-right: calc(1.5em + 0.75rem);
            }

            .form-control.is-invalid {
                border-color: #dc3545;
                background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' width='12' height='12' fill='none' stroke='%23dc3545'%3e%3ccircle cx='6' cy='6' r='4.5'/%3e%3cpath stroke-linejoin='round' d='M5.8 3.6h.4L6 6.5z'/%3e%3ccircle cx='6' cy='8.2' r='.6' fill='%23dc3545' stroke='none'/%3e%3c/svg%3e");
                background-repeat: no-repeat;
                background-position: right calc(0.375em + 0.1875rem) center;
                background-size: calc(0.75em + 0.375rem) calc(0.75em + 0.375rem);
                padding-right: calc(1.5em + 0.75rem);
            }

            .form-control.is-valid:focus {
                border-color: #28a745;
                box-shadow: 0 0 0 0.2rem rgba(40, 167, 69, 0.25);
            }

            .form-control.is-invalid:focus {
                border-color: #dc3545;
                box-shadow: 0 0 0 0.2rem rgba(220, 53, 69, 0.25);
            }

            #share-create-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            /* Bouton Options avancées */
            .btn-advanced-options {
                color: white !important;
                border-color: white !important;
                background-color: transparent;
                transition: all 0.3s ease;
            }

            .btn-advanced-options:hover {
                background-color: #313131 !important;
                color: #313131 !important;
                border-color: white !important;
            }

            .btn-advanced-options:focus {
                box-shadow: 0 0 0 0.2rem rgba(255, 255, 255, 0.25);
            }

            /* Bouton de fermeture */
            .close-button {
                background: none;
                border: none;
                color: white;
                font-size: 20px;
                cursor: pointer;
                width: 35px;
                height: 35px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: all 0.2s ease;
            }

            .close-button:hover {
                background-color: rgba(222, 0, 0, 0.2);
                color: var(--secondary-color);
                transform: scale(1.1);
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // MODAL DE DÉTAILS DU PROJET
    // ==========================================

    async viewProjectDetails(projectId) {
        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}`);
            const data = await response.json();

            if (data.success) {
                this.showProjectDetailsModal(data.projet);
            } else {
                this.showError('Impossible de charger les détails du projet');
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Erreur de connexion');
        }
    }

    showProjectDetailsModal(projet) {
        const adresse = this.parseAdresse(projet.adresse_projet);
        console.log("projet detaill,::" , projet);

        const modalHtml = `
            <div class="share-modal-overlay" id="detail-modal">
                <div class="share-modal-content detail-modal-content">
                    <div class="share-modal-header">
                        <h4><i class="fas fa-info-circle"></i> Détails du projet</h4>
                        <button class="close-button" onclick="window.shareManager2.closeDetailModal()">
                            <i class="fas fa-times" ></i>
                        </button>
                    </div>
                    <div class="share-modal-body">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="detail-section">
                                    <div class="detail-label">Nom du projet</div>
                                    <div class="detail-value">${this.escapeHtml(projet.nom_projet)}</div>
                                </div>
                                <div class="detail-section">
                                    <div class="detail-label">Type de connexion projet</div>
                                    <div class="detail-value">${this.escapeHtml(projet.type_de_projet || 'Non défini')}</div>
                                </div>
                                <div class="detail-section">
                                    <div class="detail-label">Type d'ouvrage</div>
                                    <div class="detail-value">${this.escapeHtml(projet.type_ouvrage || 'Non défini')}</div>
                                </div>
                                <div class="detail-section">
                                    <div class="detail-label">Mode de valorisation</div>
                                    <div class="detail-value">${this.escapeHtml(projet.mode_de_valorisation || 'Non défini')}</div>
                                </div>
                                ${projet.option_reseau ? `
                                <div class="detail-section">
                                    <div class="detail-label">Option réseau</div>
                                    <div class="detail-value">${this.escapeHtml(projet.option_reseau)}</div>
                                </div>
                                ` : ''}
                                 ${projet.type_projet ? `
                                    <div class="detail-section">
                                        <div class="detail-label">Type de projet</div>
                                        <div class="detail-value">${this.escapeHtml(projet.type_projet)}</div>
                                    </div>
                                    ` : ''}
                                     
                            </div>
                            <div class="col-md-6">
                                <div class="detail-section">
                                    <div class="detail-label">Localisation</div>
                                    <div class="detail-value">${this.escapeHtml(adresse)}</div>
                                </div>
                                <div class="detail-section">
                                    <div class="detail-label">Pays</div>
                                    <div class="detail-value">${this.escapeHtml(projet.pays || 'Non défini')}</div>
                                </div>
                                <div class="detail-section">
                                    <div class="detail-label">Zone de vent</div>
                                    <div class="detail-value">${this.escapeHtml(projet.zone_de_vent || 'Non défini')}</div>
                                </div>
                                <div class="detail-section">
                                    <div class="detail-label">Catégorie de terrain</div>
                                    <div class="detail-value">${this.escapeHtml(projet.categorie_de_terrain || 'Non défini')}</div>
                                </div>
                                <div class="detail-section">
                                    <div class="detail-label">Zone de neige</div>
                                    <div class="detail-value">${this.escapeHtml(projet.zone_de_neige || 'Non défini')}</div>
                                </div>
                                <div class="detail-section">
                                    <div class="detail-label">Zone sismique</div>
                                    <div class="detail-value">${this.escapeHtml(projet.zone_sismique || 'Non défini')}</div>
                                </div>
                                  ${projet.norme_calcul?.type_etude ? `
                                        <div class="detail-section">
                                            <div class="detail-label">Type d'etude</div>
                                            <div class="detail-value">${this.escapeHtml(projet.norme_calcul.type_etude)}</div>
                                        </div>
                                        ` : ''}
                            </div>
                        </div>
                        
                        <div class="detail-section">
                            <div class="detail-label">Niveau kéraunique</div>
                            <div class="detail-value">${this.escapeHtml(projet.niveau_keraunique != null ? String(projet.niveau_keraunique) : 'Non défini')}</div>
                        </div>
                        
                        <div class="detail-section">
                            <div class="detail-label">Date de création</div>
                            <div class="detail-value">${this.formatDate(projet.created_at)}</div>
                        </div>
                        
                        <div class="detail-section">
                            <div class="detail-label">Dernière modification</div>
                            <div class="detail-value">${this.formatDate(projet.updated_at)}</div>
                        </div>
                        
                        <div class="detail-section">
                            <div class="detail-label">Créé par</div>
                            <div class="detail-value">${this.escapeHtml(projet.created_by_email || 'Inconnu')}</div>
                        </div>

                        ${this.renderNormeCalculSection(projet.norme_calcul)}

                        ${this.renderCalepinageSection(projet.calepinage_data)}
                    </div>
                    <div class="share-modal-footer">
                        <button class="btn" onclick="window.dataManager.editProject(${projet.id})" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 400; border-radius: 6px; padding: 5px 10px;">
                            <i class="fas fa-edit"></i> Modifier
                        </button>
                        ${projet.calepinage_data ? `
                        <button class="btn" onclick="window.dataManager.loadCalepinageData(${projet.id})" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 400; border-radius: 6px; padding: 5px 10px;">
                            <i class="fas fa-download"></i> Charger le calepinage
                        </button>
                        ` : ''}
                        <button class="btn" onclick="window.shareManager2.closeDetailModal()" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 400; border-radius: 6px; padding: 5px 10px;">
                            Fermer
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    closeDetailModal() {
        const modal = document.getElementById('detail-modal');
        if (modal) modal.remove();
    }

    /**
     * Rendu de la section Norme de Calcul
     */
    renderNormeCalculSection(norme) {
        if (!norme || !norme.nom) {
            return `
                <div class="detail-section mt-4">
                    <h5 class="detail-section-title">
                        <i class="fas fa-calculator"></i> Norme de Calcul
                    </h5>
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle"></i> Aucune norme de calcul associée
                    </div>
                </div>
            `;
        }

        return `
            <div class="detail-section mt-4">
                <h5 class="detail-section-title">
                    <i class="fas fa-calculator"></i> Norme de Calcul
                </h5>
                <div class="row">
                    <div class="col-md-6">
                        <div class="detail-subsection">
                            <div class="detail-label">Nom de la norme</div>
                            <div class="detail-value"><strong>${this.escapeHtml(norme.nom)}</strong></div>
                        </div>
                        ${norme.type_etude ? `
                        <div class="detail-subsection">
                            <div class="detail-label">Type d'étude</div>
                            <div class="detail-value">${this.escapeHtml(norme.type_etude)}</div>
                        </div>
                        ` : ''}
                        ${norme.type_tension ? `
                        <div class="detail-subsection">
                            <div class="detail-label">Type de tension</div>
                            <div class="detail-value">${this.escapeHtml(norme.type_tension)}</div>
                        </div>
                        ` : ''}
                        ${norme.normes_electriques && norme.normes_electriques.length > 0 ? `
                        <div class="detail-subsection">
                            <div class="detail-label">Normes électriques</div>
                            <div class="detail-value">
                                ${norme.normes_electriques.map(n =>
                                    `<span class="badge bg-secondary">${this.escapeHtml(n)}</span>`
                                ).join(' ')}
                            </div>
                        </div>
                        ` : ''}
                    </div>
                    <div class="col-md-6">
                        ${norme.chute_tension_pv ? `
                        <div class="detail-subsection">
                            <div class="detail-label">Chute de tension PV</div>
                            <div class="detail-value">${norme.chute_tension_pv}%</div>
                        </div>
                        ` : ''}
                        ${norme.temperature_minimale ? `
                        <div class="detail-subsection">
                            <div class="detail-label">Température minimale</div>
                            <div class="detail-value">${norme.temperature_minimale}°C</div>
                        </div>
                        ` : ''}
                        ${norme.temperature_maximale ? `
                        <div class="detail-subsection">
                            <div class="detail-label">Température maximale</div>
                            <div class="detail-value">${norme.temperature_maximale}°C</div>
                        </div>
                        ` : ''}
                        ${norme.cosinus_phi ? `
                        <div class="detail-subsection">
                            <div class="detail-label">Cos(φ)</div>
                            <div class="detail-value">${norme.cosinus_phi}</div>
                        </div>
                        ` : ''}
                    </div>
                </div>
                ${norme.description ? `
                <div class="detail-subsection mt-2">
                    <div class="detail-label">Description</div>
                    <div class="detail-value">${this.escapeHtml(norme.description)}</div>
                </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Rendu de la section Données de Calepinage
     */
    renderCalepinageSection(calepinageData) {
        if (!calepinageData) {
            return `
                <div class="detail-section mt-4">
                    <h5 class="detail-section-title">
                        <i class="fas fa-solar-panel"></i> Données de Calepinage
                    </h5>
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle"></i> Aucune donnée de calepinage enregistrée
                    </div>
                </div>
            `;
        }

        let data;
        try {
            data = typeof calepinageData === 'string' ? JSON.parse(calepinageData) : calepinageData;
        } catch (e) {
            return `
                <div class="detail-section mt-4">
                    <h5 class="detail-section-title">
                        <i class="fas fa-solar-panel"></i> Données de Calepinage
                    </h5>
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-triangle"></i> Erreur de lecture des données
                    </div>
                </div>
            `;
        }

        const shapes = data.shapes || {};
        const formData = data.formData || {};
        const solarData = data.solarData || {};
        const shapeCount = Object.keys(shapes).length;

        let totalPanels = 0;
        let totalArea = 0;
        let totalProduction = 0;

        // Calculer les totaux
        Object.entries(shapes).forEach(([pvId, shape]) => {
            if (shape.gridInfo) {
                totalPanels += shape.gridInfo.panelCount || 0;
                totalArea += shape.gridInfo.totalPanelArea || 0;
            }
            if (solarData[pvId] && solarData[pvId].outputs && solarData[pvId].outputs.totals) {
                totalProduction += solarData[pvId].outputs.totals.fixed?.['E_y'] || 0;
            }
        });

        return `
            <div class="detail-section mt-4">
                <h5 class="detail-section-title">
                    <i class="fas fa-solar-panel"></i> Données de Calepinage
                </h5>
                <div class="calepinage-summary">
                    <div class="row">
                        <div class="col-md-3">
                            <div class="summary-card">
                                <div class="summary-icon"><i class="fas fa-layer-group"></i></div>
                                <div class="summary-value">${shapeCount}</div>
                                <div class="summary-label">Zone${shapeCount > 1 ? 's' : ''} PV</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="summary-card">
                                <div class="summary-icon"><i class="fas fa-th"></i></div>
                                <div class="summary-value">${totalPanels.toLocaleString()}</div>
                                <div class="summary-label">Panneau${totalPanels > 1 ? 'x' : ''}</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="summary-card">
                                <div class="summary-icon"><i class="fas fa-ruler-combined"></i></div>
                                <div class="summary-value">${totalArea.toFixed(1)} m²</div>
                                <div class="summary-label">Surface totale</div>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="summary-card">
                                <div class="summary-icon"><i class="fas fa-bolt"></i></div>
                                <div class="summary-value">${totalProduction > 0 ? (totalProduction/1000).toFixed(1) + ' MWh' : 'N/A'}</div>
                                <div class="summary-label">Production/an</div>
                            </div>
                        </div>
                    </div>
                </div>

                ${shapeCount > 0 ? `
                <div class="mt-3">
                    <h6 class="mb-3"><i class="fas fa-list"></i> Détails par zone</h6>
                    ${Object.entries(shapes).map(([pvId, shape]) => {
                        const form = formData[pvId] || {};
                        const solar = solarData[pvId] || {};
                        const gridInfo = shape.gridInfo || {};
                        const production = solar.outputs?.totals?.fixed?.['E_y'] || 0;

                        return `
                        <div class="zone-detail-card">
                            <div class="zone-header">
                                <strong>${pvId}</strong>
                                <span class="badge bg-primary">${gridInfo.panelCount || 0} panneaux</span>
                            </div>
                            <div class="row mt-2">
                                <div class="col-md-6">
                                    <small class="text-muted">Dimensions:</small>
                                    <div>${shape.dimensions?.length?.toFixed(1) || 'N/A'} m × ${shape.dimensions?.width?.toFixed(1) || 'N/A'} m</div>
                                </div>
                                <div class="col-md-6">
                                    <small class="text-muted">Configuration:</small>
                                    <div>${gridInfo.numCols || 0} × ${gridInfo.numRows || 0} (${form.modePose || 'N/A'})</div>
                                </div>
                            </div>
                            <div class="row mt-2">
                                <div class="col-md-6">
                                    <small class="text-muted">Inclinaison / Azimuth:</small>
                                    <div>${form.inclinaison || 'N/A'}° / ${form.azimuth || shape.azimuth || 'N/A'}°</div>
                                </div>
                                <div class="col-md-6">
                                    <small class="text-muted">Production annuelle:</small>
                                    <div class="text-success"><strong>${production > 0 ? (production/1000).toFixed(2) + ' MWh' : 'N/A'}</strong></div>
                                </div>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
                ` : ''}
            </div>

            <style>
                .detail-section-title {
                    color: #2c3e50;
                    border-bottom: 2px solid #3498db;
                    padding-bottom: 8px;
                    margin-bottom: 15px;
                }
                .detail-subsection {
                    margin-bottom: 10px;
                }
                .calepinage-summary {
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 8px;
                    margin-bottom: 15px;
                }
                .summary-card {
                    background: white;
                    padding: 15px;
                    border-radius: 8px;
                    text-align: center;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .summary-icon {
                    font-size: 24px;
                    color: #3498db;
                    margin-bottom: 8px;
                }
                .summary-value {
                    font-size: 24px;
                    font-weight: bold;
                    color: #2c3e50;
                }
                .summary-label {
                    font-size: 12px;
                    color: #7f8c8d;
                    text-transform: uppercase;
                }
                .zone-detail-card {
                    background: white;
                    border: 1px solid #dee2e6;
                    border-radius: 8px;
                    padding: 15px;
                    margin-bottom: 10px;
                }
                .zone-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                    padding-bottom: 10px;
                    border-bottom: 1px solid #e9ecef;
                }
            </style>
        `;
    }

    // ==========================================
    // MODAL DE CONFIRMATION DE SUPPRESSION
    // ==========================================

    showDeleteConfirmation(projectId, projectName) {
        const modalHtml = `
            <div class="share-modal-overlay" id="delete-confirm-modal">
                <div class="share-modal-content" style="max-width: 450px;">
                    <div class="share-modal-header">
                        <h4><i class="fas fa-exclamation-triangle"></i> Confirmer la suppression</h4>
                        <button class="close-button" onclick="window.shareManager2.closeDeleteModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="share-modal-body text-center">
                        <div class="confirm-icon">
                            <i class="fas fa-trash-alt"></i>
                        </div>
                        <h5>Êtes-vous sûr de vouloir supprimer ce projet ?</h5>
                        <p class="text-muted mt-3">
                            <strong>${this.escapeHtml(projectName)}</strong>
                        </p>
                        <div class="alert alert-warning mt-3">
                            <i class="fas fa-exclamation-circle"></i>
                            Cette action est irréversible. Toutes les données du projet seront définitivement perdues.
                        </div>
                    </div>
                    <div class="share-modal-footer">
                        <button class="btn" onclick="window.shareManager2.closeDeleteModal()" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 400; border-radius: 6px; padding: 10px 20px;">
                            <i class="fas fa-times"></i> Annuler
                        </button>
                        <button id="delete-confirm-btn" class="btn" onclick="window.shareManager2.confirmDelete(${projectId})" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 400; border-radius: 6px; padding: 10px 20px;">
                            <i class="fas fa-trash"></i> Supprimer
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    async confirmDelete(projectId) {
        // Récupérer le bouton et afficher le loading
        const deleteBtn = document.getElementById('delete-confirm-btn');
        const originalContent = deleteBtn.innerHTML;

        deleteBtn.disabled = true;
        deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Suppression...';

        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();

            if (data.success) {
                // Changer le bouton en succès
                deleteBtn.innerHTML = '<i class="fas fa-check"></i> Supprimé !';

                this.showSuccess('Projet supprimé avec succès');

                // Fermer le modal après 1 seconde
                setTimeout(() => {
                    this.closeDeleteModal();

                    // Recharger la liste des projets
                    if (window.dataManager && typeof window.dataManager.loadProjects === 'function') {
                        window.dataManager.loadProjects();
                    }
                }, 1000);
            } else {
                // Réactiver le bouton en cas d'erreur
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = originalContent;

                this.showError(data.message || 'Erreur lors de la suppression');
            }
        } catch (error) {
            console.error('Erreur:', error);

            // Réactiver le bouton en cas d'erreur
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = originalContent;

            this.showError('Erreur de connexion');
        }
    }

    closeDeleteModal() {
        const modal = document.getElementById('delete-confirm-modal');
        if (modal) modal.remove();
    }

    // ==========================================
    // MODAL DE PARTAGE
    // ==========================================

    async openShareModal(projectId) {
        try {
            // Charger les informations du projet
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}`);
            const data = await response.json();

            if (data.success) {
                this.showShareModal(data.projet);
            } else {
                this.showError('Impossible de charger les informations du projet');
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Erreur de connexion');
        }
    }

    showShareModal(projet) {
        const modalHtml = `
            <div class="share-modal-overlay" id="share-modal">
                <div class="share-modal-content" style="max-width: 650px;">
                    <div class="share-modal-header">
                        <h4><i class="fas fa-share-alt"></i> Partager le projet</h4>
                        <button class="close-button" onclick="window.shareManager2.closeShareModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="share-modal-body">
                        <!-- En-tête du projet -->
                        <div class="alert alert-light border mb-4" style="border-left: 4px solid #de0000 !important;">
                            <div class="d-flex align-items-center">
                                <i class="fas fa-folder-open me-3" style="font-size: 24px; color: #de0000;"></i>
                                <div>
                                    <small class="text-muted d-block">Projet à partager</small>
                                    <strong style="font-size: 1.1em;">${this.escapeHtml(projet.nom_projet)}</strong>
                                </div>
                            </div>
                        </div>

                        <form id="share-form">
                            <!-- Section Destinataire -->
                            <div class="mb-4">
                                <label class="form-label fw-bold">
                                    <i class="fas fa-envelope me-1" style="color: #de0000;"></i>
                                    Destinataire <span class="text-danger">*</span>
                                </label>
                                <input type="email" class="form-control form-control-lg" id="share-email"
                                       placeholder="email@example.com" required>
                                <small class="text-muted">
                                    <i class="fas fa-info-circle"></i> L'email est requis pour créer un partage
                                </small>
                            </div>

                            <!-- Section Niveau d'accès -->
                            <div class="mb-4">
                                <label class="form-label fw-bold">
                                    <i class="fas fa-lock me-1" style="color: #de0000;"></i>
                                    Niveau d'accès
                                </label>
                                <div class="row g-2">
                                    <div class="col-6">
                                        <div class="share-option" data-permission="view" style="height: 100%;">
                                            <div class="text-center">
                                                <i class="fas fa-eye mb-2" style="font-size: 32px; color: #17a2b8;"></i>
                                                <div>
                                                    <strong class="d-block">Lecture seule</strong>
                                                    <small class="text-muted">Consultation uniquement</small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-6">
                                        <div class="share-option" data-permission="edit" style="height: 100%;">
                                            <div class="text-center">
                                                <i class="fas fa-edit mb-2" style="font-size: 32px; color: #ffc107;"></i>
                                                <div>
                                                    <strong class="d-block">Modification</strong>
                                                    <small class="text-muted">Lecture et modification</small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <!-- ACCÈS ADMIN COMMENTÉ
                                    <div class="col-4">
                                        <div class="share-option" data-permission="admin" style="height: 100%;">
                                            <div class="text-center">
                                                <i class="fas fa-user-shield mb-2" style="font-size: 32px; color: #dc3545;"></i>
                                                <div>
                                                    <strong class="d-block">Administration</strong>
                                                    <small class="text-muted">Contrôle total</small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    -->
                                </div>
                                <input type="hidden" id="share-permission" value="view">
                            </div>

                            <!-- Options avancées -->
                            <div class="mb-3">
                                <hr>
                                <button type="button" class="btn btn-sm btn-outline-secondary btn-advanced-options"
                                        onclick="document.getElementById('advanced-options').classList.toggle('d-none')">
                                    <i class="fas fa-cog"></i> Options avancées
                                </button>

                                <div id="advanced-options" class="d-none mt-3 p-3 bg-light rounded">
                                    <div class="row">
                                        <!-- Colonne gauche -->
                                        <div class="col-md-6">
                                            <!-- Expiration -->
                                            <div class="mb-3">
                                                <label class="form-label fw-bold small">
                                                    <i class="fas fa-calendar me-1"></i> Date d'expiration
                                                </label>
                                                <input type="datetime-local" class="form-control" id="share-expires">
                                                <small class="text-muted">Optionnel</small>
                                            </div>

                                            <!-- Protection par mot de passe -->
                                            <div class="mb-3">
                                                <div class="form-check">
                                                    
                                                    <label class="form-check-label fw-bold small" for="share-require-password">
                                                        <i class="fas fa-key me-1"></i> Protéger par mot de passe
                                                    </label>
                                                    <input class="form-check-input" type="checkbox" id="share-require-password">
                                                </div>
                                                <div id="password-section" class="mt-2 d-none">
                                                    <input type="password" class="form-control" id="share-password"
                                                           placeholder="Entrez le mot de passe">
                                                </div>
                                            </div>
                                        </div>

                                        <!-- Colonne droite -->
                                        <div class="col-md-6">
                                            <!-- Limite de vues -->
                                            <div class="mb-3">
                                                <label class="form-label fw-bold small">
                                                    <i class="fas fa-eye me-1"></i> Limite de vues
                                                </label>
                                                <input type="number" class="form-control" id="share-max-views"
                                                       placeholder="Illimité" min="1">
                                                <small class="text-muted">Nombre max d'accès</small>
                                            </div>

                                            <!-- Options de partage -->
                                            <div class="mb-3">
                                                <label class="form-label fw-bold small">
                                                     <i class="fas fa-sliders-h me-1"></i> Autorisations
                                                 </label>
                                                <div class="form-check">
                                                    
                                                    <label class="form-check-label small" for="share-allow-download">
                                                        Autoriser le téléchargement
                                                    </label>
                                                    <input class="form-check-input" type="checkbox" id="share-allow-download" checked>
                                                </div>
                                                <div class="form-check">
                                                    
                                                    <label class="form-check-label small" for="share-allow-copy">
                                                        Autoriser la copie
                                                    </label>
                                                    <input class="form-check-input" type="checkbox" id="share-allow-copy">
                                                </div>
                                                <!-- NOTIFICATION D'ACCÈS COMMENTÉE
                                                <div class="form-check">
                                                    <input class="form-check-input" type="checkbox" id="share-notify-access">
                                                    <label class="form-check-label small" for="share-notify-access">
                                                        Me notifier lors des accès
                                                    </label>
                                                </div>
                                                -->
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Note personnelle (pleine largeur) -->
                                    <div class="mt-2">
                                        <label class="form-label fw-bold small">
                                            <i class="fas fa-sticky-note me-1"></i> Note personnelle
                                        </label>
                                        <textarea class="form-control" id="share-note" rows="2"
                                                  placeholder="Ajoutez une note pour ce partage (optionnel)..."></textarea>
                                    </div>
                                </div>
                            </div>

                            <input type="hidden" id="share-project-id" value="${projet.id}">
                        </form>

                        <!-- Zone de lien généré -->
                        <div id="share-link-section" class="d-none mt-4">
                            <div class="alert alert-success border-success">
                                <div class="d-flex align-items-center mb-2">
                                    <i class="fas fa-check-circle me-2" style="font-size: 20px;"></i>
                                    <strong>Lien de partage créé avec succès !</strong>
                                </div>
                            </div>
                            <div class="share-link-container">
                                <input type="text" class="share-link-input" id="share-link" readonly>
                                <button class="btn" onclick="window.shareManager2.copyShareLink()" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 400; border-radius: 6px; padding: 10px 20px;">
                                    <i class="fas fa-copy"></i> Copier
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="share-modal-footer bg-light">
                        <button class="btn" onclick="window.shareManager2.closeShareModal()" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 400; border-radius: 6px; padding: 10px 20px;">
                            <i class="fas fa-times"></i> Annuler
                        </button>
                        <button id="share-create-btn" class="btn" onclick="window.shareManager2.createShare()" disabled style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 400; border-radius: 6px; padding: 10px 20px;">
                            <i class="fas fa-share-alt"></i> Créer le partage
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.attachShareModalEvents();
    }

    attachShareModalEvents() {
        // Sélection du type de permission
        document.querySelectorAll('.share-option').forEach(option => {
            option.addEventListener('click', function () {
                document.querySelectorAll('.share-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');
                document.getElementById('share-permission').value = this.dataset.permission;
            });
        });

        // Sélectionner "view" par défaut
        document.querySelector('.share-option[data-permission="view"]')?.classList.add('selected');

        // Toggle du mot de passe
        const passwordCheckbox = document.getElementById('share-require-password');
        if (passwordCheckbox) {
            passwordCheckbox.addEventListener('change', function () {
                document.getElementById('password-section').classList.toggle('d-none', !this.checked);
            });
        }

        // Validation de l'email pour activer/désactiver le bouton de soumission
        const emailInput = document.getElementById('share-email');
        const submitBtn = document.getElementById('share-create-btn');

        if (emailInput && submitBtn) {
            // Fonction de validation d'email
            const validateEmail = (email) => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return emailRegex.test(email);
            };

            // Fonction pour mettre à jour l'état du bouton
            const updateSubmitButton = () => {
                const email = emailInput.value.trim();
                const isValid = validateEmail(email);

                submitBtn.disabled = !isValid;

                // Ajouter un feedback visuel
                if (email.length > 0) {
                    if (isValid) {
                        emailInput.classList.remove('is-invalid');
                        emailInput.classList.add('is-valid');
                    } else {
                        emailInput.classList.remove('is-valid');
                        emailInput.classList.add('is-invalid');
                    }
                } else {
                    emailInput.classList.remove('is-valid', 'is-invalid');
                }
            };

            // Écouter les changements dans le champ email
            emailInput.addEventListener('input', updateSubmitButton);
            emailInput.addEventListener('blur', updateSubmitButton);

            // Vérifier l'état initial
            updateSubmitButton();
        }
    }

    async createShare() {
        const projectId = document.getElementById('share-project-id').value;
        const createBtn = document.getElementById('share-create-btn');

        // Récupérer le contenu original du bouton
        const originalContent = createBtn.innerHTML;

        // Désactiver le bouton et afficher le loading
        createBtn.disabled = true;
        createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création en cours...';

        // ✅ Récupération sécurisée des champs (certains peuvent être commentés)
        const notifyAccessElement = document.getElementById('share-notify-access');

        const shareData = {
            project_id: projectId,
            shared_with_email: document.getElementById('share-email').value || null,
            permission_type: document.getElementById('share-permission').value,
            expires_at: document.getElementById('share-expires').value || null,
            require_password: document.getElementById('share-require-password').checked,
            password: document.getElementById('share-password')?.value || null,
            max_views: document.getElementById('share-max-views').value || null,
            allow_download: document.getElementById('share-allow-download').checked,
            allow_copy: document.getElementById('share-allow-copy').checked,
            // ✅ Vérifier si l'élément existe avant d'accéder à sa propriété
            notify_on_access: notifyAccessElement ? notifyAccessElement.checked : false,
            note: document.getElementById('share-note').value || null
        };

        try {
            const response = await fetch('/concevoir_mon_projet/share-project', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(shareData)
            });

            const data = await response.json();

            if (data.success) {
                // Afficher le lien de partage
                const linkSection = document.getElementById('share-link-section');
                const linkInput = document.getElementById('share-link');

                if (linkSection && linkInput) {
                    linkInput.value = `${window.location.origin}${data.share_url}`;
                    linkSection.classList.remove('d-none');
                }

                // Changer le bouton en succès
                createBtn.innerHTML = '<i class="fas fa-check"></i> Partage créé !';
                createBtn.classList.remove('btn-primary');
                createBtn.classList.add('btn-success');

                this.showSuccess('Partage créé avec succès');

                // Masquer le bouton après 2 secondes (le lien est généré)
                setTimeout(() => {
                    createBtn.style.display = 'none';
                }, 2000);
            } else {
                // Réactiver le bouton en cas d'erreur
                createBtn.disabled = false;
                createBtn.innerHTML = originalContent;

                this.showError(data.message || 'Erreur lors de la création du partage');
            }
        } catch (error) {
            console.error('Erreur:', error);

            // Réactiver le bouton en cas d'erreur
            createBtn.disabled = false;
            createBtn.innerHTML = originalContent;

            this.showError('Erreur de connexion');
        }
    }

    copyShareLink() {
        const linkInput = document.getElementById('share-link');
        if (linkInput) {
            linkInput.select();
            document.execCommand('copy');
            this.showSuccess('Lien copié dans le presse-papier');
        }
    }

    closeShareModal() {
        const modal = document.getElementById('share-modal');
        if (modal) modal.remove();
    }

    // ==========================================
    // MODAL DE COPIE DE PROJET
    // ==========================================

    async showCopyProjectModal(projectId) {
        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}`);
            const data = await response.json();

            if (data.success) {
                this.displayCopyModal(data.projet);
                window.dataManager.loadProjects();
            } else {
                this.showError('Impossible de charger le projet');
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Erreur de connexion');
        }
    }

    displayCopyModal(projet) {
        const modalHtml = `
            <div class="share-modal-overlay" id="copy-modal">
                <div class="share-modal-content">
                    <div class="share-modal-header">
                        <h4><i class="fas fa-copy"></i> Copier le projet</h4>
                        <button class="close-button" onclick="window.shareManager2.closeCopyModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="share-modal-body">
                        <div class="alert alert-info">
                            <i class="fas fa-info-circle"></i>
                            Vous allez créer une copie du projet : <strong>${this.escapeHtml(projet.nom_projet)}</strong>
                        </div>

                        <form id="copy-form">
                            <div class="mb-3">
                                <label class="form-label">Nouveau nom du projet</label>
                                <input type="text" class="form-control" id="copy-project-name" 
                                       value="Copie de ${this.escapeHtml(projet.nom_projet)}" required>
                            </div>

                            <div class="mb-3">
                                <label class="form-label">Options de copie</label>
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" id="copy-with-norme" checked>
                                    <label class="form-check-label" for="copy-with-norme">
                                        Copier les normes de calcul associées
                                    </label>
                                </div>
                                <div class="form-check">
                                    <input class="form-check-input" type="checkbox" id="copy-with-parameters" checked>
                                    <label class="form-check-label" for="copy-with-parameters">
                                        Copier tous les paramètres techniques
                                    </label>
                                </div>
                            </div>

                            <input type="hidden" id="original-project-id" value="${projet.id}">
                        </form>
                    </div>
                    <div class="share-modal-footer">
                        <button class="btn" onclick="window.shareManager2.closeCopyModal()" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 400; border-radius: 6px; padding: 10px 20px;">
                            Annuler
                        </button>
                        <button id="copy-confirm-btn" class="btn" onclick="window.shareManager2.confirmCopy()" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 400; border-radius: 6px; padding: 10px 20px;">
                            <i class="fas fa-copy"></i> Créer la copie
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    async confirmCopy() {
        const projectId = document.getElementById('original-project-id').value;
        const newName = document.getElementById('copy-project-name').value;
        const withNorme = document.getElementById('copy-with-norme').checked;
        const withParameters = document.getElementById('copy-with-parameters').checked;

        if (!newName.trim()) {
            this.showError('Veuillez entrer un nom pour le nouveau projet');
            return;
        }

        // Récupérer le bouton et afficher le loading
        const copyBtn = document.getElementById('copy-confirm-btn');
        const originalContent = copyBtn.innerHTML;

        copyBtn.disabled = true;
        copyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Copie en cours...';

        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}/copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    new_name: newName,
                    copy_norme: withNorme,
                    copy_parameters: withParameters
                })
            });

            const data = await response.json();

            if (data.success) {
                // Changer le bouton en succès
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copie créée !';
                copyBtn.classList.remove('btn-info');
                copyBtn.classList.add('btn-success');

                this.showSuccess('Projet copié avec succès');

                // Fermer le modal après 1 seconde
                setTimeout(() => {
                    this.closeCopyModal();

                    // Recharger la liste des projets
                    if (window.dataManager && typeof window.dataManager.loadProjects === 'function') {
                        window.dataManager.loadProjects();
                    }
                }, 1000);
            } else {
                // Réactiver le bouton en cas d'erreur
                copyBtn.disabled = false;
                copyBtn.innerHTML = originalContent;

                this.showError(data.message || 'Erreur lors de la copie');
            }
        } catch (error) {
            console.error('Erreur:', error);

            // Réactiver le bouton en cas d'erreur
            copyBtn.disabled = false;
            copyBtn.innerHTML = originalContent;

            this.showError('Erreur de connexion');
        }
    }

    closeCopyModal() {
        const modal = document.getElementById('copy-modal');
        if (modal) modal.remove();
    }

    // ==========================================
    // UTILITAIRES
    // ==========================================

    parseAdresse(adresseProjet) {
        if (!adresseProjet) return 'Non renseignée';

        let current = adresseProjet;
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            attempts++;

            if (typeof current === 'string' && current.trim().startsWith('{')) {
                try {
                    current = JSON.parse(current);
                } catch (e) {
                    break;
                }
            } else if (typeof current === 'string') {
                return current.replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
            } else if (typeof current === 'object' && current !== null) {
                if (current.adresse) {
                    current = current.adresse;
                } else if (current.adresse_projet) {
                    current = current.adresse_projet;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        return 'Adresse non spécifiée';
    }

    escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.toString().replace(/[&<>"']/g, m => map[m]);
    }

    formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `alert alert-${type === 'success' ? 'success' : 'danger'} alert-dismissible fade show`;
        notification.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 10001; min-width: 300px; animation: slideInRight 0.3s ease;';
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            ${message}
            <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
        `;
        document.body.appendChild(notification);

        setTimeout(() => notification.remove(), 5000);
    }
}

// Export et initialisation
export default ShareManager2;