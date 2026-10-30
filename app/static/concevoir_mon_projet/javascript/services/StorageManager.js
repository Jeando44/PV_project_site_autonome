import ErrorModal from "../components/ErrorModal.js";
import MeasurementControl from "../components/DrawingControl/controls/MeasurementControl.js";
import DrawingControl from "../components/DrawingControl/DrawingControl.js";
import LineToPolygon from "../components/DrawingControl/shapes/LineToPolygon.js";
import FormHandler from "../components/DrawingControl/handlers/FormHandler.js";
import * as CalculationUtils from "../components/DrawingControl/utils/CalculationUtils.js";
import {
  FORM_FIELDS_MAPPING,
  STYLES,
} from "../components/DrawingControl/constants.js";
import { CUSTOM_EVENTS, SHAPE_TYPES } from "../components/DrawingControl/constants.js";
/**
 * Gestionnaire centralisé pour le stockage et le chargement des données
 */
export default class StorageManager {
  /**
   * Initialise le gestionnaire de stockage
   */
  constructor() {
    this.storageKey = "solarProjectData";
    this.autoSaveInterval = null;
    this.eventListeners = new Map();
    this.defaultData = {
      mapCenter: { lat: 48.8566, lng: 2.3522 }, // Paris
      mapZoom: 2,
      shapes: {},
      formData: {},
      solarData: {},
      lines: {},
      circles: {},
      texts: {},
      simpleRectangles: {},
      simplePolygons: {},
      removedPanels: {}, // { [pvId]: ["i,j", ...] }
      obstacleCircles: {},
      obstacleRectangles: {},
      obstaclePolygons: {},
      obstacleLines: {},
      lastSaveTime: Date.now(),
    };
    this.lastSaveTime = Date.now();

    // Initialiser l'instance globale
    if (!window.storageManager) {
      window.storageManager = this;
      this.setupAutoSave();
      this.setupEventListeners();
    }

    return window.storageManager;
  }

  /**
   * Configure les écouteurs d'événements globaux
   */
  setupEventListeners() {
    // Attendre que la carte soit initialisée avant de charger les données
    document.addEventListener("DOMContentLoaded", () => {
      this.loadPageData();
    });

    // Gérer l'ajout des formes
    const addingEvents = [
      { event: CUSTOM_EVENTS.SHAPE_ADDED },
      { event: CUSTOM_EVENTS.SIMPLE_RECTANGLE_ADDED },
      { event: CUSTOM_EVENTS.LINE_ADDED },
      { event: CUSTOM_EVENTS.CIRCLE_ADDED },
      { event: CUSTOM_EVENTS.TEXT_ADDED },
      { event: CUSTOM_EVENTS.SIMPLE_POLYGON_ADDED },
    ];
    addingEvents.forEach(({ event }) => {
      document.addEventListener(event, () => {
        this.savePageData();
      });
    });

    // Gérer la suppression des formes
    const removalEvents = [
      {
        event: CUSTOM_EVENTS.SHAPE_REMOVED,
        handler: "handleShapeRemoved",
        idProp: "pvId",
      },
      {
        event: CUSTOM_EVENTS.LINE_REMOVED,
        handler: "handleLineRemoved",
        idProp: "lineId",
      },
      {
        event: CUSTOM_EVENTS.CIRCLE_REMOVED,
        handler: "handleCircleRemoved",
        idProp: "circleId",
      },
      {
        event: CUSTOM_EVENTS.TEXT_REMOVED,
        handler: "handleTextRemoved",
        idProp: "textId",
      },
      {
        event: CUSTOM_EVENTS.SIMPLE_RECTANGLE_REMOVED,
        handler: "handleSimpleRectangleRemoved",
        idProp: "simpleRectangleId",
      },
      {
        event: CUSTOM_EVENTS.SIMPLE_POLYGON_REMOVED,
        handler: "handleSimplePolygonRemoved",
        idProp: "simplePolygonId",
      },
    ];

    removalEvents.forEach(({ event, handler, idProp }) => {
      document.addEventListener(event, (e) => {
        this[handler](e.detail[idProp]);
      });
    });

    // Sauvegarde immédiate de la pente/inclinaison de toiture ('pente', 'pente2',
    // 'inclinaison-top') dès la saisie, indépendamment de l'état "dessiné" de la forme. Ces champs
    // sont souvent renseignés avant que la forme ne soit finalisée sur la carte : tant qu'un pvId
    // n'apparaît pas dans drawingControl.drawnShapes, collectShapesData() ne le collecte pas, et
    // seule une écriture directe ici garantit que la valeur existe déjà en localStorage (cf. la
    // fusion de préservation ajoutée dans collectShapesData(), qui évite ensuite que l'autosave
    // suivant n'efface cette entrée tant que la forme n'est pas encore tracée).
    const PENTE_FIELD_REGEX = /^(inclinaison-top|pente2|pente)-(.+)$/;
    ["input", "change"].forEach((evtName) => {
      document.addEventListener(evtName, (e) => {
        const el = e.target;
        if (!el || !el.id) return;
        const match = el.id.match(PENTE_FIELD_REGEX);
        if (!match) return;
        const [, fieldName, pvId] = match;

        try {
          const raw = localStorage.getItem(this.storageKey);
          const data = raw ? JSON.parse(raw) : {};
          if (!data.formData) data.formData = {};
          if (!data.formData[pvId]) data.formData[pvId] = {};
          data.formData[pvId][fieldName] = el.value;
          localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (err) {
          console.error("Erreur lors de la sauvegarde immédiate pente/inclinaison", err);
        }
      });
    });
  }

  /**
   * Gère la suppression d'une forme
   * @param {string} pvId - Identifiant de la forme supprimée
   */
  async handleShapeRemoved(pvId) {
    try {
      const savedData = localStorage.getItem(this.storageKey);
      if (!savedData) return;

      const solarProjectData = JSON.parse(savedData);

      // Supprimer les données associées à cette forme
      if (solarProjectData.solarData) delete solarProjectData.solarData[pvId];
      if (solarProjectData.shapes) delete solarProjectData.shapes[pvId];
      if (solarProjectData.formData) delete solarProjectData.formData[pvId];

      // CORRECTIF (bug rapporté : une puissance kWc "fantôme" reste affichée/utilisable — ex. sur
      // la page Système, ou pour lancer un calcul de production — après suppression de la forme sur
      // la carte) : calculatedPvs est un CACHE DÉRIVÉ (tableau, pas un dict par pvId), entièrement
      // recalculé par SummaryModal.updateSummary() — mais SEULEMENT quand ce modal est rouvert après
      // la suppression. Sans ce nettoyage direct ICI, au moment même de la suppression, l'entrée
      // orpheline survit dans calculatedPvs et continue d'alimenter main_prodsolaire.js::
      // buildPvParams() (qui lit calculatedPvs, jamais shapes/formData directement), permettant un
      // calcul de production sur une forme qui n'existe plus. Un pan simple (Monopente) a
      // id === pvId ; un pan multi-versants (shed) a un id du type "pvId.panIndex" (cf.
      // DrawingControl/utils/CalculationUtils.js) — on retire donc aussi ces sous-entrées.
      if (Array.isArray(solarProjectData.calculatedPvs)) {
        solarProjectData.calculatedPvs = solarProjectData.calculatedPvs.filter(
          (pv) => pv && pv.id !== pvId && !String(pv.id).startsWith(`${pvId}.`)
        );
      }

      // Sauvegarder les données mises à jour
      localStorage.setItem(this.storageKey, JSON.stringify(solarProjectData));
    } catch (error) {
      console.error(
        "Erreur lors de la suppression des données de forme:",
        error
      );
    }
  }

  /**
   * Gère la suppression d'une ligne
   * @param {string} lineId - Identifiant de la ligne supprimée
   */
  async handleLineRemoved(lineId) {
    try {
      const savedData = localStorage.getItem(this.storageKey);
      if (!savedData) return;

      const solarProjectData = JSON.parse(savedData);

      // Supprimer les données associées à cette ligne
      if (solarProjectData.lines) delete solarProjectData.lines[lineId];

      // Sauvegarder les données mises à jour
      localStorage.setItem(this.storageKey, JSON.stringify(solarProjectData));
    } catch (error) {
      console.error(
        "Erreur lors de la suppression des données de ligne:",
        error
      );
    }
  }

  /**
   * Gère la suppression d'un cercle
   * @param {string} circleId - Identifiant du cercle supprimé
   */
  async handleCircleRemoved(circleId) {
    try {
      const savedData = localStorage.getItem(this.storageKey);
      if (!savedData) return;

      const solarProjectData = JSON.parse(savedData);

      // Supprimer les données associées à ce cercle
      if (solarProjectData.circles) delete solarProjectData.circles[circleId];
      // Sauvegarder les données mises à jour
      localStorage.setItem(this.storageKey, JSON.stringify(solarProjectData));
    } catch (error) {
      console.error(
        "Erreur lors de la suppression des données de cercle:",
        error
      );
    }
  }

  /**
   * Gère la suppression d'un texte
   * @param {string} textId - Identifiant du texte supprimé
   */
  async handleTextRemoved(textId) {
    try {
      const savedData = localStorage.getItem(this.storageKey);
      if (!savedData) return;

      const solarProjectData = JSON.parse(savedData);

      // Supprimer les données associées à ce texte
      if (solarProjectData.texts) delete solarProjectData.texts[textId];

      // Sauvegarder les données mises à jour
      localStorage.setItem(this.storageKey, JSON.stringify(solarProjectData));
    } catch (error) {
      console.error(
        "Erreur lors de la suppression des données de texte:",
        error
      );
    }
  }

  /**
   * Gère la suppression d'un rectangle simple
   * @param {string} simpleRectangleId - Identifiant du rectangle simple supprimé
   */
  async handleSimpleRectangleRemoved(simpleRectangleId) {
    try {
      const savedData = localStorage.getItem(this.storageKey);
      if (!savedData) return;

      const solarProjectData = JSON.parse(savedData);

      // Supprimer les données associées à ce rectangle simple
      if (solarProjectData.simpleRectangles)
        delete solarProjectData.simpleRectangles[simpleRectangleId];

      // Sauvegarder les données mises à jour
      localStorage.setItem(this.storageKey, JSON.stringify(solarProjectData));
    } catch (error) {
      console.error(
        "Erreur lors de la suppression des données de rectangle simple:",
        error
      );
    }
  }
  /**
   * Gère la suppression d'un polygone simple
   * @param {string} simplePolygonId - Identifiant du polygone simple supprimé
   */
  async handleSimplePolygonRemoved(simplePolygonId) {
    try {
      const savedData = localStorage.getItem(this.storageKey);
      if (!savedData) return;

      const solarProjectData = JSON.parse(savedData);

      // Supprimer les données associées à ce polygone simple
      if (solarProjectData.simplePolygons)
        delete solarProjectData.simplePolygons[simplePolygonId];

      // Sauvegarder les données mises à jour
      localStorage.setItem(this.storageKey, JSON.stringify(solarProjectData));
    } catch (error) {
      console.error(
        "Erreur lors de la suppression des données de polygone simple:",
        error
      );
    }
  }

  /**
   * Configure la sauvegarde automatique
   * @param {number} interval - Intervalle en millisecondes
   */
  setupAutoSave(interval = 3000) {
    // Nettoyer l'intervalle existant si présent
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    // Configurer le nouvel intervalle
    this.autoSaveInterval = setInterval(() => {
      this.savePageData();
    }, interval);

    // Ajouter un écouteur pour sauvegarder avant de quitter la page
    window.addEventListener("beforeunload", () => {
      this.savePageData();
    });
  }

  /**
   * Récupère les informations du projet depuis le formulaire
   * @returns {Object} Informations du projet
   */
  getProjectInfoFromForm() {
    const getElementValue = (id, defaultValue = "N/A") => {
      const element = document.getElementById(id);
      return element && element.value ? element.value : defaultValue;
    };

    return {
      nomProjet: getElementValue("nom_projet"),
      typeEtude: getElementValue("type_etude"),
      typeProjet: getElementValue("type_projet_select"),
      typeOuvrage: getElementValue("type_ouvrage"),
      modeDeValorisation: getElementValue("mode_de_valorisation"),
      optionReseau: getElementValue("option_reseau"),
      // IMPORTANT : on conserve le JSON brut (adresse + latitude + longitude), tel que stocké par
      // le champ de recherche d'adresse (#parametre_project_hidden). Les consommateurs (PDF,
      // main_prodsolaire.js, résumé parcelles...) parsent eux-mêmes ce JSON pour en extraire soit
      // le texte de l'adresse, soit les coordonnées — le tronquer ici casserait la latitude/longitude
      // envoyées à l'API PVGIS.
      adresseProjet: getElementValue("parametre_project_hidden") || getElementValue("adresse_projet") || getElementValue("address_search"),
      reglementUrbanisme: getElementValue("reglement_urbanisme"),
      contraintesSpecifiques: getElementValue("contraintes_specifiques"),
      hypothesesDeConception: getElementValue("hypotheses_de_conception"),
      typeDeProjet: getElementValue("type_de_projet"),
      modeDeTension: getElementValue("mode_de_tension"),
      autreTypeProjet: getElementValue("autre_type_projet_select"),
      autreTypeOuvrage: getElementValue("autre_type_ouvrage"),
      autreTension: getElementValue("autre_tension"),
    };
  }

  /**
   * Récupère les indices de révision depuis le tableau HTML
   * @returns {Array} Liste des indices de révision
   */
  getIndicesRevisionFromTable() {
    const indicesData = [];

    try {
      const rows = document.querySelectorAll("#indice-table tbody tr");

      if (!rows || rows.length === 0) {
        console.log('📋 Aucune ligne d\'indices trouvée dans le tableau');
        return [];
      }

      rows.forEach((row) => {
        const index = row.cells[0]?.textContent?.trim() || '';
        const date = row.cells[1]?.textContent?.trim() || '';
        const descInput = row.cells[2]?.querySelector("input");
        const description = descInput ? descInput.value.trim() : '';

        // Récupérer le nom du créateur depuis localStorage
        const savedData = localStorage.getItem(this.storageKey);
        let createdBy = 'N/A';
        if (savedData) {
          try {
            const projectData = JSON.parse(savedData);
            createdBy = projectData.projectInfo?.createdBy || 'N/A';
          } catch (e) {
            console.warn('⚠️ Erreur lors de la récupération du créateur:', e);
          }
        }

        indicesData.push({
          index,
          date,
          description,
          redigerPar: createdBy
        });
      });

      console.log('📋 Indices de révision récupérés:', indicesData);
    } catch (error) {
      console.error('❌ Erreur lors de la récupération des indices:', error);
    }

    return indicesData;
  }

  /**
   * Charge les indices de révision dans le tableau HTML depuis localStorage
   */
  loadIndicesRevisionToTable() {
    try {
      const savedData = localStorage.getItem(this.storageKey);
      if (!savedData) {
        console.log('📋 Aucune donnée d\'indices à charger');
        return;
      }

      const data = JSON.parse(savedData);
      if (!data.indicesRevision || data.indicesRevision.length === 0) {
        console.log('📋 Aucun indice de révision à charger');
        return;
      }

      const tableBody = document.querySelector('#indice-table tbody');
      if (!tableBody) {
        console.warn('⚠️ Tableau #indice-table non trouvé');
        return;
      }

      console.log('📋 Chargement des indices de révision dans le tableau:', data.indicesRevision);

      // Vider le tableau existant
      tableBody.innerHTML = '';

      // Charger chaque indice
      data.indicesRevision.forEach((indice, idx) => {
        const newRow = tableBody.insertRow();

        const cellIndex = newRow.insertCell(0);
        const cellDate = newRow.insertCell(1);
        const cellDesc = newRow.insertCell(2);
        const cellAction = newRow.insertCell(3);

        cellIndex.textContent = indice.index || 'A';
        cellDate.textContent = indice.date || new Date().toLocaleDateString('fr-FR');

        // Créer l'input avec la description
        cellDesc.innerHTML = `<input type="text" style="width: 100%; border: 1px solid #ccc; padding: 5px;"
                                    placeholder="${idx === 0 ? 'Création du projet' : 'Description de l\'indice'}"
                                    value="${indice.description || ''}">`;

        // Ajouter le bouton de suppression (sauf pour la première ligne)
        if (idx > 0) {
          cellAction.innerHTML = '<button type="button" class="btn-delete-indice" title="Supprimer la ligne"><i class="fas fa-trash text-danger"></i></button>';

          const deleteBtn = cellAction.querySelector('.btn-delete-indice');
          if (deleteBtn) {
            deleteBtn.addEventListener('click', function () {
              this.closest('tr').remove();
            });
          }
        }
      });

      console.log('✅ Indices de révision chargés dans le tableau');
    } catch (error) {
      console.error('❌ Erreur lors du chargement des indices dans le tableau:', error);
    }
  }

  /**
   * Charge les informations du projet dans les formulaires HTML depuis localStorage
   * Cette méthode devrait être appelée après le chargement d'un projet depuis la base de données
   */
  loadProjectInfoToForm() {
    try {
      const savedData = localStorage.getItem(this.storageKey);
      if (!savedData) {
        console.log('📋 Aucune donnée à charger dans les formulaires');
        return;
      }

      const data = JSON.parse(savedData);
      if (!data.projectInfo) {
        console.log('📋 Aucune information de projet à charger');
        return;
      }

      const projectInfo = data.projectInfo;
      console.log('📋 Chargement des informations du projet dans les formulaires:', projectInfo);

      // Fonction helper pour définir la valeur d'un élément
      const setElementValue = (id, value) => {
        const element = document.getElementById(id);
        if (element && value && value !== "N/A") {
          element.value = value;
        }
      };

      // Charger toutes les valeurs dans les formulaires
      setElementValue("nom_projet", projectInfo.nomProjet);
      setElementValue("type_etude", projectInfo.typeEtude);
      setElementValue("type_projet_select", projectInfo.typeProjet);
      setElementValue("type_ouvrage", projectInfo.typeOuvrage);
      setElementValue("mode_de_valorisation", projectInfo.modeDeValorisation);
      setElementValue("option_reseau", projectInfo.optionReseau);
      setElementValue("parametre_project_hidden", projectInfo.adresseProjet);
      if (projectInfo.adresseProjet && projectInfo.adresseProjet !== "N/A") {
        const searchInput = document.getElementById("parametreProjectSearch");
        if (searchInput && !searchInput.value) {
          try {
            const parsed = JSON.parse(projectInfo.adresseProjet);
            searchInput.value = parsed.adresse || projectInfo.adresseProjet;
          } catch (e) {
            searchInput.value = projectInfo.adresseProjet;
          }
        }
      }
      setElementValue("reglement_urbanisme", projectInfo.reglementUrbanisme);
      setElementValue("contraintes_specifiques", projectInfo.contraintesSpecifiques);
      setElementValue("hypotheses_de_conception", projectInfo.hypothesesDeConception);
      setElementValue("type_de_projet", projectInfo.typeDeProjet);
      setElementValue("mode_de_tension", projectInfo.modeDeTension);
      setElementValue("autre_type_projet_select", projectInfo.autreTypeProjet);
      setElementValue("autre_type_ouvrage", projectInfo.autreTypeOuvrage);
      setElementValue("autre_tension", projectInfo.autreTension);

      console.log('✅ Informations du projet chargées dans les formulaires');
    } catch (error) {
      console.error('❌ Erreur lors du chargement des informations dans les formulaires:', error);
    }
  }

  /**
   * Enregistre les données du projet
   * @returns {Promise<boolean>} Succès de l'opération
   */
  async savePageData() {
    try {
      // Récupérer les données existantes ou initialiser avec les valeurs par défaut
      const existingData = localStorage.getItem(this.storageKey);
      const data = existingData ? JSON.parse(existingData) : this.defaultData;

      // Mettre à jour l'horodatage
      this.lastSaveTime = Date.now();

      // Collecter les nouvelles données des composants
      const newData = {
        shapes: {},
        formData: {},
        lines: {},
        circles: {},
        texts: {},
        simpleRectangles: {},
        simplePolygons: {},
        removedPanels: {},
        obstacleCircles: {},
        obstacleRectangles: {},
        obstaclePolygons: {},
        obstacleLines: {},
      };

      // Déclencher l'événement de collecte de données
      this.dispatchEvent("collectData", newData);

      // Fusionner les nouvelles données avec les données existantes
      data.shapes = newData.shapes;
      data.formData = newData.formData;
      data.lines = newData.lines;
      data.circles = newData.circles;
      data.texts = newData.texts;
      data.simpleRectangles = newData.simpleRectangles;
      data.simplePolygons = newData.simplePolygons;
      data.removedPanels = newData.removedPanels;
      data.obstacleCircles = newData.obstacleCircles;
      data.obstacleRectangles = newData.obstacleRectangles;
      data.obstaclePolygons = newData.obstaclePolygons;
      data.obstacleLines = newData.obstacleLines;

      // Récupérer les données de la carte si disponibles
      if (window.map) {
        try {
          const center = window.map.getCenter();
          data.mapCenter = {
            lat: center.lat(),
            lng: center.lng(),
          };
          data.mapZoom = window.map.getZoom();
        } catch (error) {
          console.warn(
            "Erreur lors de la récupération des données de la carte:",
            error
          );
        }
      }

      // Sauvegarder les informations du projet depuis le formulaire
      // IMPORTANT : Ne pas écraser projectInfo s'il existe déjà et que les formulaires sont vides
      const newProjectInfo = this.getProjectInfoFromForm();

      // Vérifier si projectInfo existe déjà et si les nouvelles valeurs sont toutes "N/A"
      const allNAValues = Object.values(newProjectInfo).every(val => val === "N/A" || !val);

      if (!data.projectInfo || !allNAValues) {
        const existingProjectInfo = data.projectInfo || {};
        const existingCreatedBy = existingProjectInfo.createdBy;

        // Fusion champ par champ : conserver la valeur existante si la nouvelle est N/A ou vide
        data.projectInfo = { ...existingProjectInfo };
        for (const [key, newVal] of Object.entries(newProjectInfo)) {
          if (newVal && newVal !== 'N/A') {
            data.projectInfo[key] = newVal;
          }
          // sinon on garde la valeur existante (préserve adresseProjet, etc.)
        }

        // Restaurer le createdBy s'il existait
        if (existingCreatedBy && existingCreatedBy !== 'N/A') {
          data.projectInfo.createdBy = existingCreatedBy;
        }
      }

      // Sauvegarder les indices de révision depuis le tableau
      const indicesRevision = this.getIndicesRevisionFromTable();
      if (indicesRevision && indicesRevision.length > 0) {
        data.indicesRevision = indicesRevision;
      } else if (!data.indicesRevision) {
        // Si aucun indice dans le tableau et aucun dans les données, initialiser avec une valeur par défaut
        data.indicesRevision = [{
          index: 'A',
          date: new Date().toLocaleDateString('fr-FR'),
          description: 'Création du projet',
          redigerPar: data.projectInfo?.createdBy || 'N/A'
        }];
      }

      // Sauvegarder les zones climatiques réglementaires depuis le DOM.
      // IMPORTANT : clé `climateZones`, distincte de `pvgisSettings` (réglages PVGIS gérés par
      // ParametresProjet.js) — un ancien bug faisait cohabiter les deux sous la même clé `meteoData`,
      // ce qui provoquait l'écrasement des réglages PVGIS à chaque sauvegarde de page (dessin de panneaux).
      const climateZonesFromDOM = {
        vent: document.getElementById('input_zone_de_vent')?.value || null,
        terrain: document.getElementById('input_categorie_de_terrain')?.value || null,
        neige: document.getElementById('input_zone_de_neige')?.value || null,
        sismique: document.getElementById('input_zone_sismique')?.value || null,
        keraunique: document.getElementById('niv_keraunique')?.value || null,
      };
      const hasClimateValues = Object.values(climateZonesFromDOM).some(v => v && v.trim() !== '');
      if (hasClimateValues) {
        // Fusion champ par champ (et non un remplacement en bloc) : si un champ du DOM est vide
        // (ex. onglet climat non rempli au moment de cette sauvegarde précise), on conserve la
        // valeur précédemment enregistrée pour ce champ plutôt que de l'écraser à null — sinon un
        // champ resté vide effaçait silencieusement les autres champs déjà correctement saisis.
        const previousClimateZones = data.climateZones || {};
        data.climateZones = { ...previousClimateZones };
        for (const [key, value] of Object.entries(climateZonesFromDOM)) {
          if (value && value.trim() !== '') {
            data.climateZones[key] = value;
          }
        }
      } else if (!data.climateZones) {
        data.climateZones = null;
      }




      // ========== NETTOYAGE AUTOMATIQUE DE geometriePlansData ( c)==========
      try {
          const plansRaw = localStorage.getItem('geometriePlansData');
          if (plansRaw) {
              const plans = JSON.parse(plansRaw);
              // Récupère la liste des PV actifs depuis le formData en cours de sauvegarde
              const validPvIds = new Set(Object.keys(data.formData || {}));
              let changed = false;

              Object.keys(plans).forEach(key => {
                  // Supprime la clé 'default' ET toute clé qui n'est plus un PV actif
                  // (on conserve la clé 'savedAt' si elle existe)
                  if (key === 'default' || (key !== 'savedAt' && !validPvIds.has(key))) {
                      delete plans[key];
                      changed = true;
                  }
              });

              if (changed) {
                  localStorage.setItem('geometriePlansData', JSON.stringify(plans));
                  console.log('🧹 [StorageManager] Nettoyage de geometriePlansData effectué.');
              }
          }
      } catch (e) {
          console.warn('⚠️ [StorageManager] Erreur lors du nettoyage de geometriePlansData:', e);
      }


      // Sauvegarder dans le localStorage
      localStorage.setItem(this.storageKey, JSON.stringify(data));
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SAVE_PAGE_DATA));
      return true;
    } catch (error) {
      console.error("Erreur lors de la sauvegarde des données:", error);
      return false;
    }
  }

  /**
   * Charge les données du projet
   * @returns {Promise<Object|null>} Données chargées ou null en cas d'erreur
   */
  async loadPageData() {
    try {
      const savedData = localStorage.getItem(this.storageKey);
      if (!savedData) return null;

      // GARDE-FOU (extension du garde-fou existant, cf. CalepinageDataService.js::ownerKey /
      // saveToDatabase) : ce marqueur d'appartenance n'était vérifié jusqu'ici qu'AVANT UNE
      // SAUVEGARDE — jamais avant un AFFICHAGE. Si solarProjectData restait rempli avec les données
      // d'un projet abandonné (navigation qui ne passe pas par loadFromDatabase()/clearAllData(),
      // ex. bouton "Précédent" du navigateur, ou un 2ᵉ onglet ouvert sur un autre projet), la
      // sauvegarde était bien bloquée mais la page affichait quand même silencieusement ce
      // calepinage périmé — aucune erreur visible, juste un mauvais résultat (mauvais nombre de
      // panneaux, mauvaise production, mauvais rapport). Ce garde-fou empêche maintenant aussi
      // l'AFFICHAGE de données appartenant à un autre projet (demande explicite : fiabiliser contre
      // les oublis/mauvaises manipulations, pas seulement contre la corruption en base).
      const owner = localStorage.getItem('solarProjectData_owner_id');
      const currentProjetId = localStorage.getItem('current_projet_id');
      if (owner && currentProjetId && String(owner) !== String(currentProjetId)) {
        console.error(`🚨 [StorageManager] solarProjectData appartient au projet ${owner}, mais le projet actuellement ouvert est ${currentProjetId}. Données ignorées pour éviter d'afficher un calepinage périmé.`);
        localStorage.removeItem(this.storageKey);
        localStorage.removeItem('geometriePlansData');
        localStorage.removeItem('solarProjectData_owner_id');
        return null;
      }

      const data = JSON.parse(savedData);

      // Déclencher l'événement de chargement de données
      this.dispatchEvent("loadData", data);

      return data;
    } catch (error) {
      console.error("Erreur lors du chargement des données:", error);
      return null;
    }
  }

  /**
   * Efface les données du projet
   * @returns {Promise<boolean>} Succès de l'opération
   */
  async clearPageData() {
    try {
      localStorage.removeItem(this.storageKey);

      // Déclencher l'événement de nettoyage
      this.dispatchEvent("clearData");

      return true;
    } catch (error) {
      console.error("Erreur lors de la suppression des données:", error);
      return false;
    }
  }

  /**
   * Ouvre la base de données IndexedDB pour les données cadastrales
   * @returns {Promise<IDBDatabase>} Instance de la base de données
   */
  openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("CadastreDB", 1);

      request.onerror = (event) => {
        reject("Erreur d'ouverture de la base de données");
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("cadastre")) {
          db.createObjectStore("cadastre", { keyPath: "codeInsee" });
        }
      };
    });
  }

  /**
   * Sauvegarde les données cadastrales dans IndexedDB
   * @param {Object} data - Données à sauvegarder
   * @param {string} codeInsee - Code INSEE de la commune
   * @returns {Promise<boolean>} Succès de l'opération
   */
  async saveCadastreDataToStorage(data, codeInsee) {
    try {
      if (!codeInsee) {
        console.error(
          "Code INSEE manquant pour la sauvegarde des données cadastrales"
        );
        return false;
      }

      const db = await this.openDatabase();
      const transaction = db.transaction(["cadastre"], "readwrite");
      const store = transaction.objectStore("cadastre");

      // Stocker les données avec le code INSEE
      const cadastreItem = {
        codeInsee: codeInsee,
        data: data,
        timestamp: Date.now(),
      };

      store.put(cadastreItem);

      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
          resolve(true);
        };

        transaction.onerror = (event) => {
          console.error(
            "Erreur lors de la sauvegarde dans IndexedDB:",
            event.target.error
          );
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error(
        "Erreur lors de la sauvegarde des données cadastrales:",
        error
      );
      const errorModal = new ErrorModal();
      errorModal.show("Erreur lors de la sauvegarde des données cadastrales");
      return false;
    }
  }

  /**
   * Récupère les données cadastrales depuis IndexedDB
   * @param {string} codeInsee - Code INSEE de la commune
   * @returns {Promise<Object|null>} Données cadastrales ou null en cas d'erreur
   */
  async getCadastreDataFromStorage(codeInsee) {
    try {
      if (!codeInsee) {
        console.error(
          "Code INSEE manquant pour la récupération des données cadastrales"
        );
        return null;
      }

      const db = await this.openDatabase();
      const transaction = db.transaction(["cadastre"], "readonly");
      const store = transaction.objectStore("cadastre");

      return new Promise((resolve, reject) => {
        const request = store.get(codeInsee);

        request.onsuccess = (event) => {
          const result = event.target.result;
          if (result) {
            resolve(result.data);
          } else {
            resolve(null);
          }
        };

        request.onerror = (event) => {
          console.error(
            "Erreur lors de la récupération depuis IndexedDB:",
            event.target.error
          );
          reject(event.target.error);
        };
      });
    } catch (error) {
      console.error(
        "Erreur lors de la récupération des données cadastrales:",
        error
      );
      return null;
    }
  }

  /**
   * Charge les formes depuis le stockage
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {LineToPolygon} lineToPolygon - Instance de LineToPolygon
   * @returns {Promise<void>}
   */
  async loadShapesFromStorage(drawingControl,lineToPolygon) {
    try {
      const savedData = localStorage.getItem(this.storageKey);
      if (!savedData) return;

      const data = JSON.parse(savedData);
      const shapesData = data.shapes;
      const formData = data.formData;

      // Empêche debouncedUpdate() (FormHandler.js) de redimensionner/déplacer un rectangle pendant la
      // restauration : les 'change'/'input' dispatchés ci-dessous par _restoreFormValues() sur des
      // champs partagés non suffixés (#longueur, #largeur, #toiture_pente_type, #pente...) peuvent
      // ré-entrer les listeners d'une AUTRE forme déjà restaurée (mêmes IDs), ce qui la redimensionnait
      // avec des valeurs qui ne sont pas les siennes. La géométrie vient déjà, telle quelle, de
      // `shapeData.points` — aucun redimensionnement n'est nécessaire pendant cette phase.
      drawingControl._isRestoringShapes = true;

      for (const pvId in shapesData) {
        if (shapesData.hasOwnProperty(pvId)) {
          // C. Sécuriser l'instanciation des formes (Éviter les doublons fatals)
          if (drawingControl.drawnShapes.some(s => String(s.pvId) === String(pvId))) {
            console.warn(`[StorageManager] Forme ${pvId} déjà présente sur la carte. Instanciation ignorée.`);
            continue;
          }

          const shapeData = shapesData[pvId];
          const formValues = formData[pvId];

          // Créer la shape avec les mêmes propriétés qu'une nouvelle création
          const shape = new google.maps.Polygon({
            paths: shapeData.points.map(
              (point) => new google.maps.LatLng(point.lat, point.lng)
            ),
            fillColor: STYLES.DEFAULT_SHAPE.fillColor,
            fillOpacity: STYLES.DEFAULT_SHAPE.fillOpacity,
            strokeWeight: STYLES.DEFAULT_SHAPE.strokeWeight,
            strokeColor: STYLES.DEFAULT_SHAPE.strokeColor,
            strokeOpacity: STYLES.DEFAULT_SHAPE.strokeOpacity,
            zIndex: STYLES.DEFAULT_SHAPE.zIndex,
            editable: STYLES.DEFAULT_SHAPE.editable,
            draggable: STYLES.DEFAULT_SHAPE.draggable,
            map: drawingControl.map,
          });

          // Restaurer les propriétés
          shape.type = shapeData.type;
          // Restaurer la compatibilité sheds (shapes créées avec le bouton sheds)
          shape.shedsCapable = !!shapeData.shedsCapable;
          shape._isResizing = false;



          
          shape._originalDimensions = shapeData.dimensions;
          shape.rotation = shapeData.rotation || 0;
          shape.panelsRotation = typeof shapeData.panelsRotation === 'number' ? shapeData.panelsRotation : 0;
          shape.pvId = pvId;

          // Restaurer les indices de longueur/largeur
          if (shapeData.lengthIndices && shapeData.lengthIndices.length > 0) {
            shape._lengthIndices = shapeData.lengthIndices;
          }
          if (shapeData.widthIndices && shapeData.widthIndices.length > 0) {
            shape._widthIndices = shapeData.widthIndices;
          }

          drawingControl.drawnShapes.push(shape);
          drawingControl.usedIds.add(pvId);

          // Simuler l'événement shapeAdded pour créer le formulaire
          document.dispatchEvent(
            new CustomEvent(CUSTOM_EVENTS.SHAPE_ADDED, {
              detail: {
                shape: shape,
                pvId: pvId,
                dimensions: shapeData.dimensions,
                center: shapeData.center,
              },
            })
          );


          // Attendre que le formulaire soit créé
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Restaurer les valeurs du formulaire
          this._restoreFormValues(pvId, formValues);

          // Configurer les écouteurs d'événements pour la forme && le formulaire
          drawingControl.setupShapeListeners(shape);

          // CORRECTION: Définir l'orientation du panneau AVANT d'initialiser les listeners du formulaire
          if (formValues && formValues.modePose) {
            drawingControl.panelOrientation = formValues.modePose;
          } else {
            // Valeur par défaut si non trouvée, pour éviter les erreurs
            drawingControl.panelOrientation = 'portrait';
          }

          FormHandler.setupFormListeners(drawingControl, shape);
          // Mettre à jour les métrriques de la forme avec le flag firstLoad
          MeasurementControl.updateMetrics(drawingControl, shape, true);

          // Réactiver les capacités spécifiques LineToPolygon après rechargement
          if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && lineToPolygon) {
            try {
              // Activer le redimensionnement par côtés
              lineToPolygon.enableSideResizing(shape);

              // Recréer les panneaux à partir des valeurs du formulaire
              // (utilise la configuration courante: orientation, dimensions, espacements)
              setTimeout(() => {
                // Force la création des panneaux même s'ils n'existaient pas encore
                lineToPolygon.forceUpdatePanels(shape.pvId);
              }, 300);

              // Suivre déplacements et rotations pour maintenir les panneaux synchronisés
              const onRotated = (event) => {
                if (event.detail && event.detail.pvId === shape.pvId) {
                  lineToPolygon.updatePanelsPosition(shape);
                }
              };
              const onMoved = (event) => {
                if (event.detail && event.detail.pvId === shape.pvId) {
                  lineToPolygon.updatePanelsPosition(shape);
                }
              };

              // Attacher des écouteurs document-scoped, protégés par pvId
              document.addEventListener(drawingControl.CUSTOM_EVENTS.SHAPE_ROTATED, onRotated);
              document.addEventListener(drawingControl.CUSTOM_EVENTS.SHAPE_MOVED, onMoved);

              // Conserver des références pour un éventuel cleanup ultérieur
              if (!this._shapeListeners) this._shapeListeners = new Map();
              const listeners = this._shapeListeners.get(shape.pvId) || [];
              listeners.push({ type: drawingControl.CUSTOM_EVENTS.SHAPE_ROTATED, handler: onRotated });
              listeners.push({ type: drawingControl.CUSTOM_EVENTS.SHAPE_MOVED, handler: onMoved });
              this._shapeListeners.set(shape.pvId, listeners);
            } catch (e) {
              console.warn('Réactivation LineToPolygon après chargement: erreur ignorée', e);
            }
          } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && drawingControl.solarRectangle) {
            try {
              drawingControl.solarRectangle.bindShapeLifecycle(shape);
            } catch (e) {
              console.warn('Réactivation SolarRectangle après chargement: erreur ignorée', e);
            }
          } else if ((shape.type === SHAPE_TYPES.SHED_POLYGON || (shape.shedsCapable && shape.type == null)) && drawingControl.shedPolygon) {
            try {
              if (data.shedPolygons && data.shedPolygons[pvId] && data.shedPolygons[pvId].hiddenByToggle) {
                drawingControl.shedPolygon.hiddenByToggle.add(pvId);
              }
              setTimeout(() => {
                drawingControl.shedPolygon.refreshPanelsForShape(pvId);
              }, 300);
            } catch (e) {
              console.warn('Réactivation ShedPolygon après chargement: erreur ignorée', e);
            }
          } else if (shape.type === SHAPE_TYPES.POLYGON && shape.shedsCapable && drawingControl.polygonPanels) {
            // NOUVEAU : contrairement au workflow "bouton shed dédié" ci-dessus, ce workflow (Polygone +
            // case "Option Shed") ne recréait ses panneaux qu'après rechargement QUE si "panelsVisible"
            // avait été sauvegardé à true (cf. plus bas) — un rafraîchissement inconditionnel est
            // nécessaire ici aussi, pour que le calepinage shed soit toujours retrouvé à la recharge.
            try {
              setTimeout(() => {
                drawingControl.polygonPanels.createPanels(shape);
              }, 300);
            } catch (e) {
              console.warn('Réactivation Polygon shed après chargement: erreur ignorée', e);
            }
          }



          // Mettre à jour la résumé de la forme en forcant le calcul du nombre de panneaux, pour redéclencher l'event de mise à jour de la résumé

          // Attendre que le résumé soit créé
          await new Promise((resolve) => setTimeout(resolve, 1000));
          document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER, {
            detail: {
              pvId: shape.pvId,
              numCols: shapeData.gridInfo.numCols,
              numRows: shapeData.gridInfo.numRows,
              totalPanelLength: shapeData.gridInfo.totalPanelLength,
              totalPanelWidth: shapeData.gridInfo.totalPanelWidth,
            },
          }));

          // Restaurer l'état de visibilité des panneaux après rechargement
          if (shapeData.panelsVisible) {
            // Selon le type de forme, appeler le gestionnaire approprié
            setTimeout(() => {
              try {
          if (shape.type === SHAPE_TYPES.POLYGON && drawingControl.polygonPanels) {
                  // Créer les panneaux si nécessaire, puis les laisser visibles
                  drawingControl.polygonPanels.togglePanelsVisibility(shape);
                  const panels = drawingControl.polygonPanels.createdPanelsByShape.get(shape.pvId) || [];
                  if (panels.length === 0) {
                    drawingControl.polygonPanels.createPanels(shape);
                  }
                } else if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && lineToPolygon) {
                  // Forcer la création des panneaux
                  lineToPolygon.forceUpdatePanels(shape.pvId);
                } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && drawingControl.solarRectangle) {
            drawingControl.solarRectangle.bindShapeLifecycle(shape);
            // CORRECTIF : forceUpdatePanels() n'existe pas sur SolarRectangle (seul LineToPolygon
            // l'expose) — cet appel levait systématiquement une TypeError ici, empêchant la
            // restauration des panneaux au rechargement pour ce type de forme. createSolarPanels()
            // est la méthode réellement exposée (cf. handleSolarRectangleComplete, même appel).
            drawingControl.solarRectangle.createSolarPanels(shape);
                }
              } catch (e) {
                console.warn('Erreur lors de la restauration de la visibilité des panneaux pour', pvId, e);
              }
            }, 400);
          }
        }
      }
    } catch (error) {
      console.error("Erreur lors du chargement des shapes:", error);
    } finally {
      // Délai tampon pour laisser les rafraîchissements de panneaux différés (setTimeout 300/400/1000ms
      // plus haut dans cette boucle) et le debounce de 300ms de FormHandler.debouncedUpdate() se
      // terminer avant de réautoriser le redimensionnement du rectangle sur interaction utilisateur.
      setTimeout(() => {
        drawingControl._isRestoringShapes = false;
      }, 1500);

      // CORRECTIF (bug persistant "Inclinaison Toiture (°)" réinitialisée à sa valeur par défaut après
      // réouverture d'un projet) : toggleStructureFields() (calepinage.html) réinjecte une valeur par
      // défaut (8°/15° selon le type de structure) à CHAQUE 'change' de "type_de_structure" — y compris
      // lors de cascades tardives déclenchées par les setTimeout ci-dessus (création différée des
      // panneaux, mise à jour du résumé...), qui peuvent redéclencher ce 'change' APRÈS la fin de la
      // fenêtre window.__isRestoringFormValues. Le verrou anti-réinitialisation existant
      // (_penteWatchdogTick) ne protège que contre une chute à 0 : il ne détecte pas ce cas, puisque la
      // valeur par défaut réinjectée (8/15) est elle-même non nulle — il se contente alors de "sceller"
      // silencieusement cette valeur par défaut comme nouvelle "dernière bonne valeur". On réapplique
      // donc, une dernière fois et directement depuis les données rechargées (source de vérité = la
      // base de données, via le localStorage qu'a rempli calepinageService.loadFromDatabase()), la
      // valeur de "pente"/"pente2"/"inclinaison-top" pour chaque sous-champ, une fois tout le bruit de
      // la restauration retombé.
      setTimeout(() => {
        try {
          // Relecture indépendante du localStorage (plutôt que de fermer sur shapesData/formData
          // déclarés dans le bloc try ci-dessus, hors de portée ici) : garantit aussi de réappliquer
          // l'état le plus à jour au moment où ce correctif s'exécute, 2 secondes plus tard.
          const freshRaw = localStorage.getItem(this.storageKey);
          if (!freshRaw) return;
          const freshData = JSON.parse(freshRaw);
          const freshShapesData = freshData.shapes || {};
          const freshFormData = freshData.formData || {};

          for (const pvId in freshShapesData) {
            const formValues = freshFormData[pvId];
            if (!formValues) continue;
            ['pente', 'pente2', 'inclinaison-top'].forEach((fieldId) => {
              const savedVal = formValues[fieldId];
              if (savedVal === undefined || savedVal === null || savedVal === '') return;
              const input = document.querySelector(`#${fieldId}-${pvId}`) || document.getElementById(fieldId);
              if (input && input !== document.activeElement && String(input.value) !== String(savedVal)) {
                input.value = savedVal;
                _penteWatchdogLastGood.set(input.id, String(savedVal));
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            });
          }
        } catch (err) {
          console.warn('Réassertion finale pente/inclinaison-top après chargement impossible :', err);
        }
      }, 2000);
    }
  }

  /**
   * Restaure les valeurs du formulaire
   * @param {string} pvId - Identifiant de la forme
   * @param {Object} formValues - Valeurs du formulaire
   * @private
   */
  _restoreFormValues(pvId, formValues) {
    if (!formValues) return;

    // GARDE GLOBALE DE RESTAURATION : plusieurs fonctions de calepinage.html (toggleStructureFields,
    // updatePenteFromFabricant) réagissent au 'change' de 'type_de_structure'/'fabricant_ombriere_bois'
    // en réinitialisant 'pente' (inclinaison toiture) à des valeurs déduites de la sélection courante
    // (0/8/15/vide selon le type, ou une valeur fixe selon le fabricant) — utile en saisie normale,
    // mais destructeur ici : ces mêmes champs sont restaurés PLUS TARD dans cette fonction (via
    // FORM_FIELDS_MAPPING) avec la vraie valeur sauvegardée, qui doit avoir le dernier mot. Sans cette
    // garde, `pente` (contrairement à `pente2`/`pente_panneaux_shed`, jamais réinitialisés par ces
    // fonctions) pouvait être écrasé selon l'ordre exact d'exécution des cascades 'change' déclenchées
    // pendant la restauration — d'où un bug de "persistance" qui ne touchait que ce champ. Positionnée
    // à `true` pour toute la durée de cette fonction (voir `finally` en bas) ; calepinage.html vérifie
    // `window.__isRestoringFormValues` avant d'exécuter ces réinitialisations.
    window.__isRestoringFormValues = true;
    try {
      this._restoreFormValuesInner(pvId, formValues);
    } finally {
      window.__isRestoringFormValues = false;
    }
  }

  _restoreFormValuesInner(pvId, formValues) {
    // NOUVEAU (ordre corrigé) : restaurer le support PV (Incliné/Plat/Shed) EN PREMIER, avant les
    // champs de géométrie de toiture (FORM_FIELDS_MAPPING ci-dessous). Cocher supportPlat/supportShed
    // déclenche un handler délégué (calepinage.html, listener 'change' sur name="supportPv") qui force
    // à 0 / < 3° les champs 'pente'/'pente2'/'inclinaison-top' (règle métier : Plat 0° et "Petit champ
    // solaire" imposent une pente quasi nulle) et re-dispatch un 'change' sur 'type_de_structure', qui
    // via toggleStructureFields() peut aussi remettre 'pente'/'pente2' à 0. Si ce bloc s'exécutait APRÈS
    // la restauration de ces champs (comme c'était le cas auparavant), ces remises à zéro/valeur par
    // défaut s'exécutaient EN DERNIER et écrasaient silencieusement les vraies valeurs sauvegardées —
    // d'où le bug de "persistance" de la pente. En restaurant le support PV d'abord, ces remises à
    // zéro se produisent sur un état encore par défaut/obsolète, puis sont écrasées par les vraies
    // valeurs restaurées par le forEach FORM_FIELDS_MAPPING juste après (dernier écrivain = la bonne
    // valeur).
    if (formValues['supportPv']) {
      const supportInclineInput = document.querySelector(`#supportIncline-${pvId}`) || document.getElementById('supportIncline');
      const supportPlatInput = document.querySelector(`#supportPlat-${pvId}`) || document.getElementById('supportPlat');
      const supportShedInput = document.querySelector(`#supportShed-${pvId}`) || document.getElementById('supportShed');

      if (supportInclineInput && supportPlatInput && supportShedInput) {
        if (formValues['supportPv'] === 'incline') {
          supportInclineInput.checked = true;
          supportInclineInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (formValues['supportPv'] === 'plat') {
          supportPlatInput.checked = true;
          supportPlatInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (formValues['supportPv'] === 'shed') {
          supportShedInput.checked = true;
          supportShedInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }

    // Restaurer les valeurs du formulaire avec gestion des événements
    Object.entries(FORM_FIELDS_MAPPING).forEach(([fieldId, formValue]) => {
      // A. Fallback pour cibler l'ID racine sans suffixe (Corrige PV1 sourd aux events)
      const input = document.querySelector(`#${fieldId}-${pvId}`) || document.getElementById(fieldId);
      if (input && formValues[formValue] !== undefined) {
        // Gestion spécifique pour les checkboxes
        if (input.type === 'checkbox') {
          input.checked = formValues[formValue];
          input.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          // Définir la valeur pour les autres types d'input
          input.value = formValues[formValue];

          // Amorce le verrou anti-réinitialisation (_penteWatchdogTick, plus bas dans ce fichier)
          // pour 'pente'/'pente2'/'inclinaison-top' : sans ceci, le verrou n'a de valeur "connue
          // bonne" à réappliquer qu'après avoir lui-même OBSERVÉ une valeur non nulle lors d'un de
          // ses ticks (toutes les 150ms) — si un autre code (ex: la re-init "DOMContentLoaded" de
          // toggleStructureFields(), dont le timing par rapport à ce rechargement n'est pas garanti)
          // réinitialise le champ à 0/vide AVANT le premier tick qui aurait pu observer la valeur
          // restaurée ici, le verrou n'a rien à réappliquer et la valeur reste perdue. En amorçant
          // directement la valeur restaurée, le tout premier tick (au plus tard 150ms après) peut la
          // réappliquer même si elle a été écrasée entre-temps, quelle qu'en soit la cause exacte.
          if (fieldId === 'pente' || fieldId === 'pente2' || fieldId === 'inclinaison-top') {
            const restoredVal = parseFloat(input.value);
            if (restoredVal) {
              _penteWatchdogLastGood.set(input.id, input.value);
            }
          }

          // Déclencher "input" ET "change" (certains champs n'écoutent que l'un des deux — ex: les
          // champs "...Custom" du panneau favori n'écoutent que "change" pour recopier leur valeur
          // vers le champ principal — sans ce doublon, leur cascade ne se déclenchait pas à la
          // restauration et les données semblaient perdues au rechargement).
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });

    // NOUVEAU : Restauration spécifique du mode de pose (radios Portrait/Paysage). Ces deux champs ne
    // sont PAS dans FORM_FIELDS_MAPPING (des radios, pas des champs "value" classiques) : sans ce bloc,
    // leur état "checked" n'était jamais restauré (seule la variable drawingControl.panelOrientation
    // l'était, ailleurs, sans effet sur le DOM lu par getPanelConfigFromForm) — d'où un calepinage shed
    // qui repartait en Portrait forcé après rechargement même si "Paysage" avait été sauvegardé.
    // Placé APRÈS la restauration du support PV pour avoir le dernier mot si celle-ci a rebasculé le
    // mode de pose (ex: verrouillage "Petit champ solaire").
    if (formValues['modePose']) {
      const portraitInputRestore = document.querySelector(`#modePosePortrait-${pvId}`) || document.getElementById('modePosePortrait');
      const paysageInputRestore = document.querySelector(`#modePosePaysage-${pvId}`) || document.getElementById('modePosePaysage');
      if (portraitInputRestore && paysageInputRestore) {
        if (formValues['modePose'] === 'paysage') {
          paysageInputRestore.checked = true;
          portraitInputRestore.checked = false;
          paysageInputRestore.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          portraitInputRestore.checked = true;
          paysageInputRestore.checked = false;
          portraitInputRestore.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }

    // Restauration spécifique des champs additionnels de toiture, système et matériels
    [
      'type_toiture', 'typeToiture', 'esp_bordure', 'espBordure', 'espacement_bordure',
      'joint_dilatation', 'jointDilatation', 'long_max', 'longMax', 'longueur_max',
      'type_montage', 'typeMontage', 'perte_pourcent', 'pertePourcent', 'pertes', 'perte',
      'affectation_centrale', 'affectationCentrale', 'affectation',
      'referencePanneau', 'referenceOnduleur', 'referenceBatterie', 'panneau_ref', 'onduleur_ref', 'batterie_ref'
    ].forEach(key => {
      const val = formValues[key];
      if (val !== undefined) {
        const el = document.querySelector(`#${key}-${pvId}`) || document.getElementById(key) || document.querySelector(`[name="${key}"][data-pvid="${pvId}"]`);
        if (el) {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });

    // Restauration spécifique pour la puissance onduleur
    const puissanceOnduleurInput = document.querySelector(`#puissance_onduleur-${pvId}`) || document.getElementById('puissance_onduleur');
    if (puissanceOnduleurInput && formValues['puissance_onduleur'] !== undefined) {
      puissanceOnduleurInput.value = formValues['puissance_onduleur'];
      puissanceOnduleurInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // NOTE : les champs de géométrie de toiture ('toiture_pente_type', 'pente', 'pente2',
    // 'inclinaison-top', 'azimuth2/3/4', etc.) sont déjà restaurés ci-dessus via FORM_FIELDS_MAPPING,
    // dans l'ordre voulu (sheds en dernier). Un second bloc redondant ici re-déclenchait 'change' sur
    // 'inclinaison-top' APRÈS la restauration des champs shed, ce qui relançait syncInclinaisonPanneaux()
    // et écrasait à nouveau "pente_panneaux_shed" juste restauré — annulant l'effet de cet ordre.
  }

  /**
   * Collecte les données des formes pour la sauvegarde
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @returns {Object} Données collectées
   */
  collectShapesData(drawingControl) {
    const shapesData = {};
    const formData = {};
    // Stocker une référence vers le DrawingControl pour l'utiliser dans les closures ci‑dessus
    this.drawingControl = drawingControl;

    // Lire les données existantes pour préserver les champs non recollectés (ex: parcelleData)
    let existingShapes = {};
    let existingFormData = {};
    try {
      const saved = localStorage.getItem('solarProjectData');
      if (saved) {
        const parsed = JSON.parse(saved);
        existingShapes = parsed.shapes || {};
        existingFormData = parsed.formData || {};
      }
    } catch (e) { /* ignore */ }

    drawingControl.drawnShapes.forEach((shape) => {
      if (!shape.pvId) return;
      // Collecter les données de la forme
      const points = shape
        .getPath()
        .getArray()
        .map((point) => ({
          lat: point.lat(),
          lng: point.lng(),
        }));

      const bounds = new google.maps.LatLngBounds();
      shape.getPath().forEach((point) => bounds.extend(point));

      formData[shape.pvId] = this._collectFormValues(shape.pvId);
      let dimensionsPanneaux = null;
      let espacementPanneauxIdentiques = null;
      let espacementPanneauxX = null;
      let espacementPanneauxY = null;
      let surfaceProjetee = null;

      if (formData[shape.pvId].typeCouverture && formData[shape.pvId].dimensionsPanneaux) {
        dimensionsPanneaux = formData[shape.pvId].dimensionsPanneaux.split(",");
      }
      if (formData[shape.pvId].espacementPanneauxIdentiques) {
        espacementPanneauxIdentiques = formData[shape.pvId].espacementPanneauxIdentiques;
      }
      if (formData[shape.pvId].espacementPanneauxX) {
        espacementPanneauxX = formData[shape.pvId].espacementPanneauxX;
      }
      if (formData[shape.pvId].espacementPanneauxY) {
        espacementPanneauxY = formData[shape.pvId].espacementPanneauxY;
      }


      if (shape.type === 'LINE_TO_POLYGON') {
        // S'assurer que les données requises existent avec des valeurs par défaut
        if (!formData[shape.pvId].dimensionsPanneaux) {
          formData[shape.pvId].dimensionsPanneaux = "2000,1000";
        }
        if (!formData[shape.pvId].typeCouverture) {
          formData[shape.pvId].typeCouverture = "toiture";
        }
        if (!formData[shape.pvId].espacementPanneauxIdentiques) {
          formData[shape.pvId].espacementPanneauxIdentiques = "10";
        }
        if (!formData[shape.pvId].espacementPanneauxX) {
          formData[shape.pvId].espacementPanneauxX = "10";
        }
        if (!formData[shape.pvId].espacementPanneauxY) {
          formData[shape.pvId].espacementPanneauxY = "10";
        }
      }

      // Récupération des dimensions de base (sans les marges de sécurité)
      const dimLongEl = document.querySelector(`#dimensionsChampPVlongueur-${shape.pvId}`);
      const dimLargEl = document.querySelector(`#dimensionsChampPVlargeur-${shape.pvId}`);
      const baseLen = dimLongEl && dimLongEl.dataset.baseValue ? parseFloat(dimLongEl.dataset.baseValue) : parseFloat(formData[shape.pvId].dimensionsChampPVlongueur);
      const baseWid = dimLargEl && dimLargEl.dataset.baseValue ? parseFloat(dimLargEl.dataset.baseValue) : parseFloat(formData[shape.pvId].dimensionsChampPVlargeur);

      // Stocker les données de la forme
      shapesData[shape.pvId] = {
        shapeArea: formData[shape.pvId].largeur * formData[shape.pvId].longueur,
        points: points,
        dimensions: shape._originalDimensions,
        rotation: parseInt(shape.rotation) || 0,
        azimuth: parseInt(shape.rotation) || 0,
        inclinaison: parseInt(shape.inclinaison) || 0,
        type: shape.type,
        center: {
          lat: bounds.getCenter().lat(),
          lng: bounds.getCenter().lng(),
        },
        dimensionsPanneaux: dimensionsPanneaux,
        espacementPanneauxIdentiques: espacementPanneauxIdentiques,
        espacementPanneauxX: espacementPanneauxX,
        espacementPanneauxY: espacementPanneauxY,
        // Information sur la compatibilité sheds pour restauration de l'UI
        shedsCapable: !!shape.shedsCapable,

        gridInfo: {
          numCols: parseInt(formData[shape.pvId].colonne) || 0,
          numRows: parseInt(formData[shape.pvId].ligne) || 0,
          panelCount:
            parseInt(formData[shape.pvId].colonne) *
            parseInt(formData[shape.pvId].ligne) || 0,
          totalPanelLength: baseLen || 0,
          totalPanelWidth: baseWid || 0,
          totalPanelArea: parseFloat(formData[shape.pvId].dimensionsChampPVlargeur) * parseFloat(formData[shape.pvId].dimensionsChampPVlongueur) || 0,
          surfaceProjetee: CalculationUtils.calculateSurfaceProjetée(parseFloat(formData[shape.pvId].dimensionsChampPVlargeur) * parseFloat(formData[shape.pvId].dimensionsChampPVlongueur), parseFloat(formData[shape.pvId].inclinaison)) || 0,
        },
        lengthIndices: shape._lengthIndices || [],
        widthIndices: shape._widthIndices || [],
        panelsRotation: typeof shape.panelsRotation === 'number' ? shape.panelsRotation : 0,
        parcelleData: existingShapes[shape.pvId]?.parcelleData || null,
        // État de visibilité des panneaux pour restauration après rechargement
        panelsVisible: (() => {
          // Polygones natifs (PolygonPanelsManager)
          if (shape.type === SHAPE_TYPES.POLYGON && this.drawingControl && this.drawingControl.polygonPanels) {
            const panels = this.drawingControl.polygonPanels.createdPanelsByShape.get(shape.pvId) || [];
            return panels.length > 0 && panels.some(p => p.getMap());
          }
          // LineToPolygon
          if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && this.drawingControl && this.drawingControl.lineToPolygon) {
            const panels = this.drawingControl.lineToPolygon.createdPanelsByShape.get(shape.pvId) || [];
            return panels.length > 0 && panels.some(p => p.getMap());
          }
          // SolarRectangle
          if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && this.drawingControl && this.drawingControl.solarRectangle) {
            const panels = this.drawingControl.solarRectangle.createdPanelsByShape.get(shape.pvId) || [];
            return panels.length > 0 && panels.some(p => p.getMap());
          }
          return false;
        })(),
      };
    });

    // Préserver le formData des onglets/pvId qui existent déjà en localStorage mais qui ne sont
    // pas (ou plus) dans drawingControl.drawnShapes au moment de cette collecte (ex: un onglet
    // créé via "requestNewTab" dont la forme n'a pas encore été tracée/finalisée sur la carte).
    // Sans cette fusion, savePageData() écrase entièrement data.formData avec ce seul objet
    // `formData` (qui ne couvre que les pvId de drawnShapes) — ce qui effaçait silencieusement,
    // au prochain autosave (toutes les 3s) ou changement d'onglet, tout ce que l'utilisateur avait
    // déjà saisi dans cet onglet pas-encore-dessiné (ex: Pente des panneaux PV / Inclinaison
    // Toiture / Inclinaison Toiture 2, souvent renseignées avant de finaliser le tracé de la forme).
    Object.keys(existingFormData).forEach((pvId) => {
      if (!(pvId in formData)) {
        formData[pvId] = existingFormData[pvId];
      }
    });

    return { shapes: shapesData, formData: formData };
  }

  /**
   * Collecte les valeurs du formulaire
   * @param {string} pvId - Identifiant de la forme
   * @returns {Object} Valeurs du formulaire
   * @private
   */
  _collectFormValues(pvId) {
    const values = {};

    Object.entries(FORM_FIELDS_MAPPING).forEach(([fieldId, formValue]) => {
      // A. Fallback pour la collecte des données de l'onglet racine PV1
      const input = document.querySelector(`#${fieldId}-${pvId}`) || document.getElementById(fieldId);
      if (input) {
        // Ne pas traiter les radios ici, on le fait séparément
        if (input.type !== "radio") {
          values[formValue] = input.value;
        }
      }
    });







    
    // Collecter manuellement les champs NOT dans FORM_FIELDS_MAPPING
    // (select dynamiques avec ID suffixé par pvId)
    const structureSelect = document.querySelector(`#type_de_structure-${pvId}, select[name="type_de_structure"][data-pvid="${pvId}"]`);
    if (structureSelect) {
      values['typeDeStructure'] = structureSelect.value;
    } else {
      // Fallback : récupérer depuis le tab actif correspondant à ce pvId
      const tab = document.getElementById(`form-${pvId}`);
      if (tab) {
        const sel = tab.querySelector('select[id^="type_de_structure"], select[name="type_de_structure"]');
        if (sel) values['typeDeStructure'] = sel.value;
      }
    }

    // Gérer spécifiquement les radios pour le mode de pose
    const portraitInput = document.querySelector(`#modePosePortrait-${pvId}`) || document.getElementById('modePosePortrait');
    if (portraitInput && portraitInput.checked) {
      values['modePose'] = 'portrait';
    } else {
      values['modePose'] = 'paysage';
    }

    // Gérer spécifiquement la checkbox shedsRegular
    const shedsRegularInput = document.querySelector(`#shedsRegular-${pvId}`) || document.getElementById('shedsRegular');
    if (shedsRegularInput) {
      values['shedsRegular'] = shedsRegularInput.checked;
    }

    // Gérer spécifiquement les radios pour le support PV
    const supportIncline = document.querySelector(`#supportIncline-${pvId}`) || document.getElementById('supportIncline');
    const supportPlat = document.querySelector(`#supportPlat-${pvId}`) || document.getElementById('supportPlat');
    const supportShed = document.querySelector(`#supportShed-${pvId}`) || document.getElementById('supportShed');
    
    if (supportIncline && supportIncline.checked) {
      values['supportPv'] = 'incline';
    } else if (supportPlat && supportPlat.checked) {
      values['supportPv'] = 'plat';
    } else if (supportShed && supportShed.checked) {
      values['supportPv'] = 'shed';
    }

    // Gérer spécifiquement la puissance onduleur
    const puissanceOnduleurInput = document.querySelector(`#puissance_onduleur-${pvId}`) || document.getElementById('puissance_onduleur');
    if (puissanceOnduleurInput) {
      values['puissance_onduleur'] = puissanceOnduleurInput.value;
    }

    // NOUVEAU: Collecter TOUS les champs spécifiques à la géométrie de toiture
    ['toiture_pente_type', 'fabricant_ombriere_bois', 'largeur_faitage_mm', 'asymetrie_percent', 'nb_pentes', 'pente', 'pente2', 'inclinaison-top', 'azimuth2', 'azimuth3', 'azimuth4'].forEach(key => {
        const el = document.querySelector(`#${key}-${pvId}`) || document.getElementById(key);
        if (el) values[key] = el.value;
    });

    // Collecter les nouveaux champs de toiture, système et matériels
    [
      'type_toiture', 'typeToiture', 'esp_bordure', 'espBordure', 'espacement_bordure',
      'joint_dilatation', 'jointDilatation', 'long_max', 'longMax', 'longueur_max'
    ].forEach(key => {
        const el = document.querySelector(`#${key}-${pvId}`) || document.getElementById(key) || document.querySelector(`[name="${key}"][data-pvid="${pvId}"]`);
        if (el) values[key] = el.value;
    });

    [
      'type_montage', 'typeMontage', 'perte_pourcent', 'pertePourcent', 'pertes', 'perte',
      'affectation_centrale', 'affectationCentrale', 'affectation'
    ].forEach(key => {
        const el = document.querySelector(`#${key}-${pvId}`) || document.getElementById(key) || document.querySelector(`[name="${key}"][data-pvid="${pvId}"]`);
        if (el) values[key] = el.value;
    });

    [
      'referencePanneau', 'referenceOnduleur', 'referenceBatterie', 'panneau_ref', 'onduleur_ref', 'batterie_ref'
    ].forEach(key => {
        const el = document.querySelector(`#${key}-${pvId}`) || document.getElementById(key) || document.querySelector(`[name="${key}"][data-pvid="${pvId}"]`);
        if (el) values[key] = el.value;
    });

    // Garde-fou anti-corruption pour la pente/inclinaison de toiture : plusieurs déclencheurs
    // internes (ex. MeasurementControl.updateMetrics(..., firstLoad=true) → savePageData(),
    // appelé pendant loadShapesFromStorage() avant que TOUS les onglets ne soient créés/restaurés)
    // peuvent invoquer cette collecte alors que l'onglet de ce pvId vient tout juste d'être créé et
    // affiche encore sa valeur par défaut ("0"), pas encore la valeur restaurée. Si la valeur lue
    // ici est nulle/vide MAIS qu'une valeur non nulle existe déjà en localStorage pour ce pvId, on
    // la conserve plutôt que d'écraser silencieusement une pente valide avec 0 — une pente
    // réellement nulle (toiture plate à 0°) est un cas bien plus rare qu'un onglet pas encore
    // initialisé.
    try {
      const raw = localStorage.getItem(this.storageKey);
      const existingForPvId = raw ? (JSON.parse(raw).formData || {})[pvId] : null;
      if (existingForPvId) {
        ['inclinaison-top', 'pente', 'pente2'].forEach((key) => {
          if (parseFloat(values[key])) return;
          if (parseFloat(existingForPvId[key])) {
            values[key] = existingForPvId[key];
          }
        });
      }
    } catch (e) { /* ignore */ }

    return values;
  }

  /**
   * Récupère la production annuelle en kWh
   * @param {string} pvId - Identifiant de la forme
   * @param {Object} center - Coordonnées du centre de la forme
   * @returns {Promise<number>} Production annuelle en kWh
   */
  async getProductionAnnuelleKWh(pvId, center) {
    try {

      const savedData = localStorage.getItem(this.storageKey);
      const parsedData = savedData ? JSON.parse(savedData) : {};

      // Vérifier si les données solaires existent déjà
      if (parsedData.solarData?.[pvId]?.annuel?.productionTotale !== undefined) {
        return parsedData.solarData[pvId].annuel.productionTotale;
      }

      // Si non, déclencher la récupération et attendre que le storage se mette à jour
      if (center) {
        const tabManager = window.tabManager || window.tabsManager;
        if (tabManager) {
          tabManager.getSolarData(pvId, center);
          const production = await this._waitForSolarDataInStorage(pvId);
          if (production !== undefined) {
            return production; // en kWh
          }
          console.warn("Données solaires non récupérées après attente pour", pvId);
        } else {
          console.warn("TabManager non disponible pour", pvId);
        }
      }

      // Si on arrive ici, c'est qu'on n'a pas pu obtenir de données valides
      return 0;
    } catch (error) {
      console.error("Erreur dans getProductionAnnuelleKWh:", error);
      return 0;
    }
  }

  /**
   * Attend que solarData[pvId].annuel.productionTotale soit présent dans le localStorage
   */
  async _waitForSolarDataInStorage(pvId, maxRetries = 20, delayMs = 200) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          const prod = data?.solarData?.[pvId]?.annuel?.productionTotale;
          if (prod !== undefined) {
            return prod;
          }
        } catch (e) {
          console.warn("Lecture du storage échouée pendant l'attente PVGIS", e);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return undefined;
  }

  /**
   * Récupère la puissance PV
   * @param {string} pvId - Identifiant de la forme
   * @param {number} maxRetries - Nombre maximum de tentatives (par défaut: 5)
   * @param {number} retryDelay - Délai entre les tentatives en ms (par défaut: 300)
   * @returns {Promise<number>} Puissance PV
   */
  async getPuissancePV(pvId, maxRetries = 5, retryDelay = 100) {
    let retryCount = 0;

    const attemptFetch = async () => {
      try {
        const savedData = localStorage.getItem(this.storageKey);
        if (!savedData) return 0;

        const data = JSON.parse(savedData);

        // Vérifier si les données existent
        if (!data.shapes?.[pvId]?.gridInfo || !data.formData?.[pvId]) {
          console.warn(`Données incomplètes pour le PV ${pvId}`);

          // Si nous avons encore des tentatives, réessayer
          if (retryCount < maxRetries) {
            retryCount++;
            return new Promise(resolve => setTimeout(() => resolve(attemptFetch()), retryDelay));
          }
          return 0;
        }

        let panelCount = data.shapes[pvId].gridInfo.panelCount;
        let panelPower = parseFloat(data.formData[pvId].puissancePanneau);

        // Vérifier si les valeurs sont valides
        if (!panelCount || panelCount <= 0 || isNaN(panelCount) ||
          !panelPower || isNaN(panelPower)) {

          // Si nous avons encore des tentatives, réessayer
          if (retryCount < maxRetries) {
            retryCount++;
            return new Promise(resolve => setTimeout(() => resolve(attemptFetch()), retryDelay));
          }

          if (!panelCount || panelCount <= 0 || isNaN(panelCount)) {
            console.warn(`Nombre de panneaux invalide pour ${pvId}: ${panelCount}`);
            return 0;
          }

          if (!panelPower || isNaN(panelPower)) {
            console.warn(`Puissance de panneau invalide pour ${pvId}: ${panelPower}`);
            return 0;
          }
        }

        // Calculer et retourner la puissance totale, le nombre de panneaux et la puissance par panneau
        const puissanceKWc = CalculationUtils.calculatePuissancePVKwc(panelCount, panelPower);

        const result = {
          puissanceKWc: puissanceKWc,
          panelCount: panelCount,
          panelPower: panelPower,
        }
        return result;
      } catch (error) {
        console.error("Erreur dans getPuissancePV:", error);

        // Si nous avons encore des tentatives, réessayer même en cas d'erreur
        if (retryCount < maxRetries) {
          retryCount++;
          return new Promise(resolve => setTimeout(() => resolve(attemptFetch()), retryDelay));
        }
        return 0;
      }
    };

    return attemptFetch();
  }

  /**
   * Ajoute un écouteur d'événement
   * @param {string} event - Nom de l'événement
   * @param {Function} callback - Fonction de rappel
   */
  addEventListener(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  /**
   * Supprime un écouteur d'événement
   * @param {string} event - Nom de l'événement
   * @param {Function} callback - Fonction de rappel
   */
  removeEventListener(event, callback) {
    if (!this.eventListeners.has(event)) return;

    const listeners = this.eventListeners.get(event);
    const index = listeners.indexOf(callback);

    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * Déclenche un événement
   * @param {string} event - Nom de l'événement
   * @param {*} data - Données à passer aux écouteurs
   */
  dispatchEvent(event, data) {
    if (!this.eventListeners.has(event)) return;

    this.eventListeners.get(event).forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Erreur dans l'écouteur d'événement ${event}:`, error);
      }
    });
  }
}

// Créer une instance globale du StorageManager & activer la sauvegarde automatique
export const storageManager = new StorageManager();
storageManager.setupAutoSave();

// ─────────────────────────────────────────────────────────────────────────────────────────────
// VERROU ANTI-RÉINITIALISATION : Pente des panneaux PV / Inclinaison Toiture / Inclinaison
// Toiture 2 ("inclinaison-top", "pente", "pente2").
//
// Malgré la sauvegarde immédiate à la saisie et la préservation du formData non tracé (cf.
// plus haut dans ce fichier), ces 3 champs continuent, sur le terrain, à retomber à leur valeur
// par défaut ("0") très peu de temps après avoir été saisis ou restaurés — sans qu'un
// déclencheur unique et reproductible ait pu être identifié dans le code (aucune écriture directe
// sur ces champs, ni conflit d'ID, n'a été trouvée avec "pente_panneaux_shed" ou ailleurs).
// Plutôt que de continuer à chercher ce déclencheur, ce verrou traite le symptôme directement :
// il retient la dernière valeur non nulle connue de chaque champ, et la réapplique aussitôt que
// la valeur retombe à 0/vide — un "0" au lieu d'une valeur déjà saisie est traité comme une
// réinitialisation involontaire plutôt qu'une action utilisateur légitime (un pente réellement
// nulle est un cas extrêmement rare pour ces champs). Explicitement exclu : "pente_panneaux_shed"
// (champ shed distinct, non concerné par cette demande).
const _penteWatchdogLastGood = new Map(); // id DOM -> dernière valeur non nulle observée
const PENTE_WATCHDOG_REGEX = /^(inclinaison-top|pente2|pente)(-.+)?$/;

function _penteWatchdogTick() {
  document.querySelectorAll('input[id^="inclinaison-top"], input[id^="pente"]').forEach((el) => {
    if (!PENTE_WATCHDOG_REGEX.test(el.id)) return; // exclut notamment pente_panneaux_shed
    const current = parseFloat(el.value);
    if (current) {
      _penteWatchdogLastGood.set(el.id, el.value);
    } else if (_penteWatchdogLastGood.has(el.id) && document.activeElement !== el) {
      // document.activeElement !== el : ne jamais réécrire un champ que l'utilisateur est en
      // train de modifier (il peut légitimement passer par un état vide/0 en cours de frappe).
      el.value = _penteWatchdogLastGood.get(el.id);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}
setInterval(_penteWatchdogTick, 150);
// Exporter les fonctions pour la compatibilité avec le code existant
export const saveCadastreDataToStorage = (data, codeInsee) =>
  storageManager.saveCadastreDataToStorage(data, codeInsee);
export const getCadastreDataFromStorage = (codeInsee) =>
  storageManager.getCadastreDataFromStorage(codeInsee);