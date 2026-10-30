import { GET_PVGIS_DATA } from '../../API/API.js';
import { CUSTOM_EVENTS, TYPE_COUVERTURE_MAP, PANEL_DIMENSIONS } from './DrawingControl/constants.js';
import FormHandler from './DrawingControl/handlers/FormHandler.js';
import * as CalculationUtils from './DrawingControl/utils/CalculationUtils.js';
export default class TabManager {
    constructor() {
        this.tabsHeader = document.getElementById('pvTabs');
        this.tabsContent = document.getElementById('pvForms');
        this.formContainer = document.querySelector('.form-container');
        this.mapContainer = document.querySelector('.map-container');
        this.tabs = new Map();
        this.isHidden = false;
        this.activeTab = null;
        this.isInternalActivation = false;
        this.oldCenter = null;
        this.lastAPICall = 0;
        this.minAPICallInterval = 1000;
        this.createEmptyStateMessage();
        this.solarDataQueue = [];
        this.solarDataTimeout = null;
        this.solarDataProcessingDelay = 100; // ms
        
        this.emptyStateMessage.classList.add('visible');

        document.addEventListener(CUSTOM_EVENTS.FORM_DIMENSIONS_CHANGED, (e) => {
            const { pvId, dimensions } = e.detail;
            document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.UPDATE_MAP_SHAPE, {
                detail: { pvId, dimensions }
            }));
        });

        // NOUVEAU: Écouter la demande de création d'onglet avant dessin
        document.addEventListener('requestNewTab', () => {
            const newPvId = this.generateNewPvId();
            if (window.drawingControl) {
                window.drawingControl.activePendingPvId = newPvId;
            }
            this.createTab(newPvId);
        });
    }

    createEmptyStateMessage() {
        this.emptyStateMessage = document.createElement('div');
        this.emptyStateMessage.className = 'empty-state-message';
        this.emptyStateMessage.innerHTML = `
            <img src="/static/concevoir_mon_projet/medias/icons/solar-panel.svg" alt="Dessiner une forme" style="height: 24px; width: 24px; margin-bottom: 10px;">
            <p>Dessinez une forme sur la carte pour commencer</p>
        `;
        this.formContainer.appendChild(this.emptyStateMessage);
    }

    generateNewPvId() {
        let id = 1;
        while (this.tabs.has(`PV${id}`) || (window.drawingControl && window.drawingControl.usedIds.has(`PV${id}`))) {
            id++;
        }
        return `PV${id}`;
    }

    updateFormVisibility() {
        if (this.tabs.size === 0) {
            this.emptyStateMessage.classList.add('visible');
        } else {
            this.emptyStateMessage.classList.remove('visible');
        }
    }

    createTab(pvId) {
        if (this.tabs.has(pvId)) return;

        if (this.isHidden) {
            this.showFormContainer();
        }

        const tabButton = document.createElement('button');
        tabButton.className = 'tab-button';
        tabButton.textContent = pvId;
        tabButton.onclick = () => this.activateTab(pvId, true);

        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';
        tabContent.id = `form-${pvId}`;

        const formTemplate = document.getElementById('calepinageTemplate');
        const formClone = formTemplate.content.cloneNode(true);
        
        this.updateFormIdsAfterFirstLoad(formClone, pvId);
        
        tabContent.appendChild(formClone);

        const formFields = ['inclinaison', 'azimuth', 'typeSysteme', 'perteSysteme', 'puissancePanneau'];
        formFields.forEach(fieldId => {
            const input = tabContent.querySelector(`#${fieldId}-${pvId}`);
            if (input) {
                input.addEventListener('input', () => {
                    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.REQUEST_SHAPE_CENTER, {
                        detail: { pvId }
                    }));
                });
            }
        });

        const noPanneauInput = tabContent.querySelector(`#noPanneau-${pvId}`);
        if (noPanneauInput) {
            const panneauNumber = pvId.replace('PV', '');
            noPanneauInput.value = panneauNumber;
            noPanneauInput.setAttribute('data-pv-id', pvId);
        }

        const modePosePortraitInput = tabContent.querySelector(`#modePosePortrait-${pvId}`);
        const modePosePortraitLabel = tabContent.querySelector(`#modePosePortraitLabel-${pvId}`);
        if (modePosePortraitInput) {
            modePosePortraitInput.checked = true;
            modePosePortraitLabel.style.backgroundColor = "#c7c7c7";
        }

        // Ajouter les éléments
        this.tabsHeader.appendChild(tabButton);
        this.tabsContent.appendChild(tabContent);

        this.tabs.set(pvId, {
            button: tabButton,
            content: tabContent
        });

        this.activateTab(pvId, false);

        // "Type de calepinage" / "Géométrie de la toiture" de ce nouvel onglet : mis en accord avec
        // l'état du champ PV correspondant (cf. Calepinage_mainson/calepinage_maison_form_pro.js).
        if (window.CalepinageMaisonFormPro) window.CalepinageMaisonFormPro.synchroniser(pvId);

        this.updateFormVisibility();
    }

    /**
     * UNIFICATION DU CALEPINAGE (demande explicite : "le calepinage de tous les projets est basé
     * sur le module de calepinage résidentiel ; on n'utilisera plus les anciens codes et données de
     * calepinage rectangulaire et polygonale").
     *
     * Un champ PV tracé sur la carte avec le module résidentiel (MaisonPolygonManager) doit avoir
     * SON onglet dans le formulaire PRO / Grand projet, portant le MÊME identifiant. Sans ce lien,
     * `form-PVn` et le champ `PVn` du module résidentiel étaient deux mondes séparés :
     *   - le formulaire affichait "Ce champ PV n'a pas encore de calepinage" alors qu'un rectangle
     *     était bien tracé (l'onglet était un onglet vide créé au chargement, cf. index.js) ;
     *   - les modales de géométrie (ombrière métal / bois / Solumbra) recevaient un pvId qui ne
     *     correspondait à aucun champ du module résidentiel, donc aucune dimension injectée
     *     (cf. geometrieModal.js -> CalepinageMaisonDimensionsOmbriere.injecterDansModal).
     *
     * Appelée à la création, à la suppression et à la renumérotation d'un champ PV de la carte, et
     * une fois au chargement (les contours sont restaurés en différé par polygon_maison.js).
     */
    synchroniserOngletsAvecChampsMaison(options) {
        const ids = TabManager.listerChampsMaison();
        if (!ids) return; // module résidentiel pas encore prêt : on retentera au prochain événement

        ids.forEach((pvId) => { if (!this.tabs.has(pvId)) this.createTab(pvId); });

        // `retirerOrphelins` n'est vrai que lorsqu'on réagit à un ÉVÉNEMENT du module résidentiel
        // (contour supprimé, champs renumérotés) : là, la liste des champs fait autorité. Pendant le
        // rattrapage périodique du chargement, elle ne fait PAS autorité — les formes du projet et
        // les contours arrivent de façon asynchrone, et un passage trop tôt fermerait des onglets
        // parfaitement légitimes.
        if (!options || !options.retirerOrphelins) return;

        // Onglets devenus orphelins : uniquement ceux que le module résidentiel connaissait (un
        // onglet d'une forme "grands projets" encore présente sur la carte n'est pas concerné).
        Array.from(this.tabs.keys()).forEach((pvId) => {
            if (ids.includes(pvId)) return;
            const formeProjet = window.drawingControl && window.drawingControl.drawnShapes
                && window.drawingControl.drawnShapes.some((f) => f.pvId === pvId);
            if (!formeProjet) this.removeTab(pvId);
        });
    }

    /**
     * Identifiants des champs PV tracés sur la carte, dans l'ordre d'affichage, ou null si le module
     * résidentiel n'est pas encore chargé. La liste des polygones vivants fait foi (source unique,
     * déjà restaurée depuis localStorage/base par polygon_maison.js) : `listerChampsCarte()` force
     * en plus le chargement de TOUS les états, inutile ici.
     */
    static listerChampsMaison() {
        const mgr = window.MaisonPolygonManagerInstance;
        if (!mgr || !Array.isArray(mgr.polygons)) return null;
        return mgr.polygons.map((p) => p.maisonId).filter(Boolean);
    }

    /*
     * RETIRÉ (demande explicite : "corriger l'emplacement d'affichage des champs PV ; supprimer les
     * listes déroulantes qui affichent actuellement les champs PV1...") : le sélecteur
     * #pvTabsSelect, ajouté précédemment dans la barre d'onglets, faisait doublon avec les
     * pastilles d'onglets elles-mêmes ("PV1", "PV2"...), qui restent le SEUL affichage du numéro de
     * champ PV. `refreshChampPvSelectors()` et ses 3 points d'appel (createTab / removeTab /
     * activateTab) ont donc été supprimés avec lui — rien d'autre ne le lisait.
     */

    removeTab(pvId) {
        const tab = this.tabs.get(pvId);
        if (!tab) return;

        tab.button.remove();
        tab.content.remove();
        this.tabs.delete(pvId);

        if (this.tabs.size > 0) {
            const nextPvId = this.tabs.keys().next().value;
            this.activateTab(nextPvId);
        }

        document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.TAB_REMOVED, {
            detail: { pvId: pvId }
        }));

        this.updateFormVisibility();
    }

    /**
     * Retire TOUS les onglets, sans émettre d'événement (aucune sauvegarde ni recentrage déclenché),
     * au changement de projet sans rechargement de page (cf. parametreProjetFormManager.js::
     * selectAndLoadProject).
     *
     * CORRECTIF (bug rapporté : "à l'ouverture d'un projet n'ayant que PV1, le formulaire affiche PV1
     * et un PV2 vide ; il faut actualiser la page") : les onglets de l'ANCIEN projet n'étaient jamais
     * retirés — la synchronisation de fin de restauration ne fait qu'ajouter les onglets manquants.
     * Les onglets du nouveau projet sont recréés à la fin de son chargement ('maisonShapesRestored',
     * formes "grands projets" via SHAPE_ADDED).
     */
    viderOnglets() {
        this.tabs.forEach((tab) => {
            tab.button.remove();
            tab.content.remove();
        });
        this.tabs.clear();
        this.activeTab = null;
        this.updateFormVisibility();
    }

    activateTab(pvId, isUserClick = false) {
        if (this.isInternalActivation) return;

        if (this.activeTab) {
            const oldTab = this.tabs.get(this.activeTab);
            if (oldTab) {
                oldTab.button.classList.remove('active');
                oldTab.content.classList.remove('active');
            }
        }

        const newTab = this.tabs.get(pvId);
        if (newTab) {
            newTab.button.classList.add('active');
            newTab.content.classList.add('active');
            this.activeTab = pvId;

            this.isInternalActivation = true;
            document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.TAB_SELECTED, {
                detail: { pvId: pvId }
            }));
            
            if (isUserClick) {
                document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.CENTER_ON_SHAPE, {
                    detail: { pvId: pvId }
                }));
            }
            
            this.isInternalActivation = false;
        }
    }

    updateFormIdsAfterFirstLoad(formElement, pvId) {
        const elements = formElement.querySelectorAll('[id], [name], [for]');
        elements.forEach(element => {
            if (element.id) {
                element.id = `${element.id}-${pvId}`;
            }
            if (element.name) {
                element.name = `${element.name}-${pvId}`;
            }
            if (element.getAttribute('for')) {
                element.setAttribute('for', `${element.getAttribute('for')}-${pvId}`);
            }
        });

        const typeCouverture = formElement.querySelector(`[id^="typeCouverture"]`);
        const si = formElement.querySelector(`[id^="referenceSI"]`);
        const avis = formElement.querySelector(`[id^="avisCertification"]`);

        if (typeCouverture && si && avis) {


            typeCouverture.addEventListener('change', () => {
                const type = typeCouverture.value;
                const config = TYPE_COUVERTURE_MAP[type] || { options: [['none', 'Pas disponible']], avis: "" };
                
                si.innerHTML = config.options
                    .map(([value, text]) => `<option value="${value}">${text}</option>`)
                    .join('');
                avis.value = config.avis;
            });

            typeCouverture.value = 'ombr_iab';
            typeCouverture.dispatchEvent(new Event('change'));
        }

        // Ajouter la gestion des dimensions de panneaux
        const dimensionsPanneauxSelect = formElement.querySelector(`[id^="dimensionsPanneaux"]`);
        const divAutresDimensions = formElement.querySelector(`[class^="autresDimensionsPanneau"]`);
        
        if (dimensionsPanneauxSelect) {
            dimensionsPanneauxSelect.addEventListener('change', function() {
                if (this.value === 'Autres_dimensions') {
                    divAutresDimensions.classList.remove('hidden');
                } else {
                    divAutresDimensions.classList.add('hidden');
                    
                    // Extraire les dimensions de la valeur sélectionnée
                    const [longueur, largeur, epaisseur] = this.value
                        .replace('mm', '')
                        .split('x')
                        .map(Number);

                    // Mettre à jour les champs cachés
                    const longueurInput = formElement.querySelector(`#longueurPanneau-${pvId}`);
                    const largeurInput = formElement.querySelector(`#largeurPanneau-${pvId}`);
                    const epaisseurInput = formElement.querySelector(`#epaisseurPanneau-${pvId}`);

                    if (longueurInput && largeurInput && epaisseurInput) {
                        longueurInput.value = longueur;
                        largeurInput.value = largeur;
                        epaisseurInput.value = epaisseur;
                    }
                }
            });
        }
        // Valeur par défaut pour l'espacement entre panneaux au chargement du tab pour la première fois
        // CORRECTIF : ce clonage (déclenché à chaque nouvelle forme/onglet PV, y compris pour
        // draw-polygon-button et draw-polygon-sheds-button qui passent tous deux par createTab()) écrasait
        // systématiquement le défaut Jinja (20mm) avec PANEL_DIMENSIONS.MIN_SPACING (0), ce qui annulait
        // silencieusement tout défaut d'espacement dès qu'une nouvelle forme était dessinée.
        const espacementPanneauIdentiquesInput = formElement.querySelector(`#espacementPanneauxIdentiques-${pvId}`);
        const espacementPanneauXInput = formElement.querySelector(`#espacementPanneauxX-${pvId}`);
        const espacementPanneauYInput = formElement.querySelector(`#espacementPanneauxY-${pvId}`);
        if (espacementPanneauIdentiquesInput) {
            espacementPanneauIdentiquesInput.value = PANEL_DIMENSIONS.DEFAULT_SPACING_MM;
        }
        if (espacementPanneauXInput) {
            espacementPanneauXInput.value = PANEL_DIMENSIONS.DEFAULT_SPACING_MM;
        }
        if (espacementPanneauYInput) {
            espacementPanneauYInput.value = PANEL_DIMENSIONS.DEFAULT_SPACING_MM;
        }
    }

    showFormContainer() {
        this.isHidden = false;
        this.formContainer.classList.remove('hidden');
        this.mapContainer.style.width = '75%';
        this.formContainer.style.width = '25%';
    }

    hideFormContainer() {
        this.isHidden = true;
        this.formContainer.classList.add('hidden');
        this.mapContainer.style.width = '100%';
    }


    updateMapFromForm(pvId) {
        const tab = this.tabs.get(pvId);
        if (!tab) return;

        const form = tab.content;
        const longueurInput = form.querySelector(`#longueur-${pvId}`);
        const largeurInput = form.querySelector(`#largeur-${pvId}`);

        if (longueurInput && largeurInput) {
            const length = parseFloat(longueurInput.value);
            const width = parseFloat(largeurInput.value);

            if (!isNaN(length) && !isNaN(width) && length > 0 && width > 0) {
                document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.FORM_DIMENSIONS_CHANGED, {
                    detail: {
                        pvId: pvId,
                        dimensions: {
                            length: length,
                            width: width
                        }
                    }
                }));
            }
        }
    }

    getSolarData(pvId, center) {
        // Ajouter la demande à la file d'attente
        // Vérifier si une demande pour ce pvId est déjà en file d'attente
        const existingRequest = this.solarDataQueue.find(req => req.pvId === pvId);
        if (existingRequest) {
            // Mettre à jour le centre si nécessaire
            existingRequest.center = center;
        } else {
            this.solarDataQueue.push({ pvId, center });
        }

        // Annuler le minuteur précédent pour le réinitialiser
        if (this.solarDataTimeout) {
            clearTimeout(this.solarDataTimeout);
        }

        // Démarrer un nouveau minuteur pour traiter la file d'attente
        this.solarDataTimeout = setTimeout(() => {
            this.processSolarDataQueue();
        }, this.solarDataProcessingDelay);
    }

    async processSolarDataQueue() {
        if (this.solarDataQueue.length === 0) {
            return;
        }

        // Copier et vider la file d'attente pour ce cycle de traitement
        const queue = [...this.solarDataQueue];
        this.solarDataQueue = [];
        this.solarDataTimeout = null;

        try {
            const promises = queue.map(async ({ pvId, center }) => {
                const tab = this.tabs.get(pvId);
                if (!tab) {
                    return { pvId, error: `Tab non trouvé pour ${pvId}` };
                }

                const formValues = await this.attendreValeursPanneaux(pvId);
                if (!formValues) {
                    return { pvId, error: `Impossible d'obtenir les valeurs valides pour ${pvId}` };
                }

                const { angle, aspect, mountingPlace, loss, peakPower } = formValues;
                
                // Recharger les données du projet
                const currentSavedData = localStorage.getItem('solarProjectData');
                const currentProjectData = currentSavedData ? JSON.parse(currentSavedData) : { shapes: {}, formData: {} };
                
                // Obtenir le vrai nombre de panneaux
                const totalNbPanneaux = CalculationUtils.getAccuratePanelCount(pvId, currentProjectData);
                
                // Vérifier que le nombre de panneaux est valide
                if (totalNbPanneaux === 0) {
                    return { pvId, error: `Nombre de panneaux invalide pour ${pvId}` };
                }
                
                const totalPeakPower = peakPower * totalNbPanneaux;

                // Gérer le centre : peut être un objet {lat, lng} ou un LatLng Google Maps
                const centerLat = typeof center.lat === 'function' ? center.lat() : center.lat;
                const centerLng = typeof center.lng === 'function' ? center.lng() : center.lng;

                // Tâche 3.1 : Découpage par sous-champs pour l'API PVGIS
                const fullFormValues = currentProjectData.formData[pvId] || {};
                const panelCountByPan = CalculationUtils.getPanelCountByPan(pvId, currentProjectData);
                const subFields = CalculationUtils.getSubFieldsData(pvId, fullFormValues, panelCountByPan);

                if (!subFields || subFields.length <= 1) {
                    // Cas Monopente ou normal (1 seul appel global)
                    const solarData = await GET_PVGIS_DATA(
                        centerLat,
                        centerLng,
                        totalPeakPower,
                        mountingPlace,
                        loss,
                        angle,
                        aspect
                    );
                    return { pvId, solarData };
                } else {
                    // Cas Multipans (Bipente symétrique, asymétrique, Multipente)
                    const pansData = {};
                    let aggregatedSolarData = null;

                    // Diviser et envoyer les requêtes simultanément pour chaque pan
                    const panPromises = subFields.map(async (subField) => {
                        const panPeakPower = peakPower * subField.panelCount;
                        // Ne pas envoyer de requête s'il n'y a aucun panneau sur ce pan
                        if (panPeakPower <= 0) return { panIndex: subField.panIndex, data: null };

                        const panAngle = subField.tilt !== undefined ? subField.tilt : angle;
                        const panAspect = subField.azimuth !== undefined ? subField.azimuth : aspect;

                        try {
                            const data = await GET_PVGIS_DATA(
                                centerLat, centerLng, panPeakPower, mountingPlace, loss, panAngle, panAspect
                            );
                            return { panIndex: subField.panIndex, data };
                        } catch (err) {
                            console.error("Erreur PVGIS pour pan " + subField.panIndex, err);
                            return { panIndex: subField.panIndex, data: null };
                        }
                    });

                    const panResults = await Promise.all(panPromises);

                    // Variables d'agrégation d'énergie
                    let totalAnnuelProduction = 0;
                    const aggregatedMensuel = {};

                    panResults.forEach(res => {
                        if (res.data) {
                            pansData[res.panIndex] = res.data;
                            if (res.data.annuel && res.data.annuel.productionTotale !== undefined) {
                                totalAnnuelProduction += Number(res.data.annuel.productionTotale);
                            }
                            if (res.data.mensuel) {
                                Object.keys(res.data.mensuel).forEach(month => {
                                    if (!aggregatedMensuel[month]) {
                                        aggregatedMensuel[month] = { ...res.data.mensuel[month] };
                                        // Initialiser les valeurs énergétiques à 0 pour cumuler
                                        aggregatedMensuel[month].E_d = 0;
                                        aggregatedMensuel[month].E_m = 0;
                                    }
                                    // Addition des énergies quotidiennes/mensuelles
                                    aggregatedMensuel[month].E_d += Number(res.data.mensuel[month].E_d || 0);
                                    aggregatedMensuel[month].E_m += Number(res.data.mensuel[month].E_m || 0);
                                });
                            }
                        }
                    });

                    const firstValidPan = panResults.find(r => r.data);
                    if (firstValidPan) {
                        // Construire le résultat agrégé basé sur la première réponse valide
                        aggregatedSolarData = JSON.parse(JSON.stringify(firstValidPan.data));
                        
                        if (aggregatedSolarData.annuel) {
                            aggregatedSolarData.annuel.productionTotale = totalAnnuelProduction;
                        }
                        if (aggregatedSolarData.mensuel) {
                            Object.keys(aggregatedMensuel).forEach(month => {
                                if (aggregatedSolarData.mensuel[month]) {
                                    aggregatedSolarData.mensuel[month].E_d = aggregatedMensuel[month].E_d;
                                    aggregatedSolarData.mensuel[month].E_m = aggregatedMensuel[month].E_m;
                                }
                            });
                        }
                        // Intégrer les données brutes par pan pour le SummaryModal / PDF
                        aggregatedSolarData.pans = pansData;
                    }

                    return { pvId, solarData: aggregatedSolarData };
                }
            });

            const results = await Promise.all(promises);

            // Lire le localStorage UNE SEULE FOIS
            const savedData = localStorage.getItem('solarProjectData');
           
           // Ajout JJD pour JRC
            let solarProjectData = savedData ? JSON.parse(savedData) : {};

            // S'assurer que solarData existe
            if (!solarProjectData.solarData) {
                solarProjectData.solarData = {};
            }

            // Mettre à jour avec TOUS les résultats
            results.forEach(({ pvId, solarData, error }) => {
                if (error) {
                    console.error(`Erreur lors de la récupération des données pour ${pvId}: ${error}`);
                } else if (solarData) {
                    solarProjectData.solarData[pvId] = solarData;
                }
            });

            // Écrire dans le localStorage UNE SEULE FOIS
            localStorage.setItem('solarProjectData', JSON.stringify(solarProjectData));

            // Envoyer un seul événement de mise à jour groupé
            document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SOLAR_DATA_BATCH_UPDATED, {
                detail: { results }
            }));

        } catch (error) {
            console.error("Erreur lors du traitement de la file d'attente des données solaires:", error);
        }
    }

    /**
     * Attend que les valeurs des panneaux soient disponibles et valides dans le formulaire
     * @param {string} pvId - Identifiant du PV
     * @returns {Promise<Object|null>} - Résout avec les valeurs des panneaux ou null en cas d'échec
     */
    attendreValeursPanneaux(pvId, maxRetries = 10) {
        return new Promise((resolve) => {
            let tentatives = 0;
            
            const verifierValeurs = () => {
                tentatives++;
                if (tentatives > maxRetries) {
                    resolve(null);
                    return;
                }
                
                const form = document.querySelector(`#form-${pvId}`);
                if (!form) {
                    setTimeout(verifierValeurs, 500);
                    return;
                }
                
                try {
                    const angle = form.querySelector(`#inclinaison-${pvId}`).value;
                    const aspect = form.querySelector(`#azimuth-${pvId}`).value;
                    // NOUVEAU: 4 types de montage possibles côté UI (free/terrasse/sur_imposition/building),
                    // mais l'API PVGIS n'accepte que 'free' ou 'building' pour son modèle thermique : les
                    // montages peu ou pas ventilés (sur_imposition, building) sont assimilés à 'building',
                    // les autres (free, terrasse) à 'free'.
                    const typeSystemeValue = form.querySelector(`#typeSysteme-${pvId}`).value;
                    const mountingPlace = (typeSystemeValue === 'sur_imposition' || typeSystemeValue === 'building') ? 'building' : 'free';
                    const loss = form.querySelector(`#perteSysteme-${pvId}`).value;
                    const peakPower = parseFloat(form.querySelector(`#puissancePanneau-${pvId}`).value);
                    const nbColonne = parseInt(form.querySelector(`#nbColonne-${pvId}`)?.value) || 0;
                    const nbLigne = parseInt(form.querySelector(`#nbLigne-${pvId}`)?.value) || 0;
                    
                    // Vérifier si les valeurs sont valides
                    if (isNaN(peakPower) || peakPower <= 0) {
                 
                        setTimeout(verifierValeurs, 500);
                        return;
                    }
               
                    
          
                    
                    resolve({ 
                        angle, 
                        aspect, 
                        mountingPlace, 
                        loss, 
                        peakPower, 
                        nbColonne, 
                        nbLigne, 
                    });
                } catch (error) {
                    setTimeout(verifierValeurs, 500);
                }
            };
            
            verifierValeurs();
        });
    }

}

const tabManager = new TabManager();
window.tabManager = tabManager;
document.addEventListener(CUSTOM_EVENTS.SHAPE_ADDED, (e) => {
    const { pvId, center, dimensions, shape } = e.detail;
    
    // Ne recréer l'onglet que s'il n'existe pas déjà (cas du pré-remplissage)
    if (!tabManager.tabs.has(pvId)) {
        tabManager.createTab(pvId);
    } else {
        tabManager.activateTab(pvId);
    }
    
    const resolvedShape = shape || window.drawingControl?.drawnShapes?.find(s => s.pvId === pvId);
    if (dimensions && resolvedShape) {
        FormHandler.updateFormShapeDimensions(resolvedShape, pvId, dimensions);
    } else if (dimensions && !resolvedShape) {
        console.warn(`TabsManager: shape introuvable pour ${pvId}, impossible de mettre à jour les dimensions.`);
    }
    // PVGIS n'est plus interrogé ici (demande explicite : appel systématique à chaque dessin/
    // déplacement de forme, alors que la donnée n'est utile qu'au moment du calcul). L'appel se
    // fait désormais uniquement au clic sur "Système"/"Calculer et Visualiser", via
    // showSummary()::getSolarDataForMultiplePvIds() (SummaryModal.js) qui interroge déjà
    // window.tabManager.getSolarData() pour chaque pvId — rien à ajouter côté bouton pour ça.
    // Les consommateurs isolés (ex. StorageManager.js::getProductionAnnuelleKWh) gardent leur
    // propre repli à la demande si la donnée n'est pas encore en cache.
});

document.addEventListener(CUSTOM_EVENTS.SHAPE_REMOVED, (e) => {
    tabManager.removeTab(e.detail.pvId);
});

// UNIFICATION DU CALEPINAGE : les champs PV du module résidentiel pilotent eux aussi les onglets
// (cf. synchroniserOngletsAvecChampsMaison). 'maisonShapeAdded'/'maisonShapeRemoved' sont émis par
// polygon_maison.js, 'maisonShapesRenumbered' par l'orchestrateur après un renumérotage PV1/PV2/…
['maisonShapeAdded', 'maisonShapeRemoved', 'maisonShapesRenumbered'].forEach((nom) => {
    document.addEventListener(nom, () => tabManager.synchroniserOngletsAvecChampsMaison({ retirerOrphelins: true }));
});

// Les contours sont restaurés en différé au chargement (carte + hydratation base -> localStorage ->
// polygones), sans émettre 'maisonShapeAdded'. CORRECTIF (bug rapporté : "les fonctionnalités
// nécessitent un premier tracé ou un rafraîchissement") : on rattrapait ici par 12 essais espacés de
// 500 ms — au-delà de 6 s (base lente, carte longue à charger), les champs restaurés n'avaient JAMAIS
// d'onglet jusqu'au tracé suivant. polygon_maison.js signale désormais la fin de restauration
// ('maisonShapesRestored') ; l'appel immédiat couvre le cas où elle a déjà eu lieu.
tabManager.synchroniserOngletsAvecChampsMaison();
document.addEventListener('maisonShapesRestored', () => tabManager.synchroniserOngletsAvecChampsMaison());

document.addEventListener(CUSTOM_EVENTS.SHAPE_SELECTED, (e) => {
    if (!tabManager.isInternalActivation) {
        tabManager.activateTab(e.detail.pvId);
    }
});

// SHAPE_CENTER_UPDATED ne déclenche plus PVGIS automatiquement (même motif que ci-dessus) —
// écouteur retiré : il ne servait qu'à ça.
