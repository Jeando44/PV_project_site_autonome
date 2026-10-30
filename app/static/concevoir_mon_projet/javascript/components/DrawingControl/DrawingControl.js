import ErrorModal from '../ErrorModal.js';
import SummaryModal from '../SummaryModal.js';
import GraphModal from '../GraphModal.js';

import { DRAWING_CONSTANTS, STYLES, CUSTOM_EVENTS, FORM_FIELDS_MAPPING, SHAPE_TYPES, TYPE_COUVERTURE_MAP } from './constants.js';
import ButtonControl from './controls/ButtonControl.js';
import MeasurementControl from './controls/MeasurementControl.js';
import ShapeHandler from './handlers/ShapeHandler.js';
import EventHandler from './handlers/EventHandler.js';
import FormHandler from './handlers/FormHandler.js';
import Circle from './shapes/Circle.js';
import Line from './shapes/Line.js';
import CotationLine from './shapes/CotationLine.js';
import Text from './shapes/Text.js';
import Polygon from './shapes/Polygon.js';
import SimpleRectangle from './shapes/SimpleRectangle.js';
import SimplePolygon from './shapes/SimplePolygon.js';
import GeometryUtils from './utils/GeometryUtils.js';
import LineToPolygon from './shapes/LineToPolygon.js';
import * as LineToShed from './shapes/LineToShed.js';
import SolarRectangle from './shapes/SolarRectangle.js';
import ShedPolygon from './shapes/ShedPolygon.js';
import PolygonPanelsManager from './core/PolygonPanelsManager.js';
import ObstaclePanelsManager from './core/ObstaclePanelsManager.js';
import TerraDrawEngine from './core/TerraDrawEngine.js';
import OffsetModal from '../OffsetModal.js';
import DeletedPanelsStorage from './utils/DeletedPanelsStorage.js';
import ObstacleCircle from './shapes/ObstacleCircle.js';
import ObstacleRectangle from './shapes/ObstacleRectangle.js';
import ObstaclePolygon from './shapes/ObstaclePolygon.js';
import ObstacleLine from './shapes/ObstacleLine.js';
import LocalisationMatElec from './shapes/LocalisationMatElec.js';
import GeocodingMarker from './shapes/geoconding.js';
import { PostAxesManager } from './shapes/poteaux.js';

/**
 * Contrôle de dessin pour Google Maps
 */
export class DrawingControl {
  /**
   * Constructeur
   */
  constructor() {
    this.map = undefined;
    this.container = undefined;
    this.drawingManager = undefined;
    this.drawnShapes = [];
    this.activeButton = null;
    this.selectedShape = null;
    this.activePendingPvId = null; // Stocke l'ID de l'onglet actuellement affiché et rempli par l'utilisateur
    this.measurementLabels = [];
    this.permanentLabels = [];
    this.state = {
      isDrawing: false,
      isRotating: false,
      isDragging: false
    };
    this.textButton = null;
    this.rotationStep = DRAWING_CONSTANTS.ROTATION_STEP;
    this.panelOrientation = null;
    this.usedIds = new Set();
    this.isInternalSelection = false;
    this.AdvancedMarkerElement = null;
    this.drawButton = null;
    this.lineButton = null;
    this.circleButton = null;
    this.simpleRectangleButton = null;
    this.simplePolygonButton = null;
    this.minZoomLevel = DRAWING_CONSTANTS.MIN_ZOOM_LEVEL;
    this.errorModal = new ErrorModal();
    this.summaryModal = new SummaryModal();
    this.graphModal = new GraphModal();
    this.isTextMode = false;
    this.clipboard = null;
    this.isPasteMode = false;
    this.copyButton = null;
    this.areCotationsVisible = true;

    // Instancier les gestionnaires de formes
    this.circleManager = new Circle(this);
    this.lineManager = new Line(this);
    // Lignes de cotation (Déclaration préalable), persistées dans `lines` avec le drapeau cotation.
    this.cotationManager = new CotationLine(this);
    this.textManager = new Text(this);
    this.simpleRectangleManager = new SimpleRectangle(this);
    this.simplePolygonManager = new SimplePolygon(this);
    this.lineToPolygonButton = null;
    this.offsetModal = new OffsetModal();
    this.obstacleCircleManager = new ObstacleCircle(this);
    this.obstacleRectangleManager = new ObstacleRectangle(this);
    this.obstaclePolygonManager = new ObstaclePolygon(this);
    this.obstacleLineManager = new ObstacleLine(this);
    this.obstacleMode = null; // Pour savoir quel type d'obstacle dessiner
    this.obstaclePanels = new ObstaclePanelsManager(this);

    // Instanciation de la localisation du matériel électrique
    this.localisationMatElec = new LocalisationMatElec(this);

    // Instanciation du marqueur de géocodage/coordonnées
    this.geocodingMarkerManager = new GeocodingMarker(this);

    // Exposer les constantes et utilitaires à la classe LineToPolygon
    this.STYLES = STYLES;
    this.DRAWING_CONSTANTS = DRAWING_CONSTANTS;
    this.CUSTOM_EVENTS = CUSTOM_EVENTS;
    this.FormHandler = FormHandler;
    this.ShapeHandler = ShapeHandler;
    this.GeometryUtils = GeometryUtils;
    this.LineToShed = LineToShed;

    // Initialiser les gestionnaires
    this.lineToPolygon = new LineToPolygon(this);
    this.polygon = new Polygon(this);
    this.polygonPanels = new PolygonPanelsManager(this);
    this.shedPolygon = new ShedPolygon(this);
    this.solarRectangle = new SolarRectangle(this);

    // Moteur Terra Draw (remplace progressivement Google Maps Drawing Manager pour le
    // calepinage rectangulaire et en sheds — cf. plan de migration). Instancié ici, initialisé
    // dans onAdd() une fois this.map disponible.
    this.terraDrawEngine = new TerraDrawEngine(this);

    // Configurer les écouteurs d'événements
    EventHandler.setupEventListeners(this);
    this.setupSystemFilters();

    // Initialiser la bibliothèque de marqueurs
    this.initializeMarkerLibrary();

    // Configurer les écouteurs d'événements pour la collecte de données
    window.storageManager.addEventListener('collectData', (data) => {
      const shapesData = window.storageManager.collectShapesData(this);
      data.shapes = shapesData.shapes;
      data.formData = shapesData.formData;
      data.lines = { ...this.lineManager.collectLinesData(), ...this.cotationManager.collectLinesData() };
      data.circles = this.circleManager.collectCirclesData();
      data.texts = this.textManager.collectTextsData();
      data.simpleRectangles = this.simpleRectangleManager.collectSimpleRectanglesData();
      data.simplePolygons = this.simplePolygonManager.collectSimplePolygonsData();
      data.obstacleCircles = this.obstacleCircleManager.collectObstacleCirclesData();
      data.obstacleRectangles = this.obstacleRectangleManager.collectObstacleRectanglesData();
      data.obstaclePolygons = this.obstaclePolygonManager.collectObstaclePolygonsData();
      data.obstacleLines = this.obstacleLineManager.collectObstacleLinesData();

      // Ajout de la collecte du matériel électrique
      if (this.localisationMatElec) {
        data.matElec = this.localisationMatElec.collectData();
      }
      // Ajout de la collecte pour ShedPolygon
      if (this.shedPolygon && typeof this.shedPolygon.collectData === 'function') {
        const shedData = this.shedPolygon.collectData();
        data.shedPolygons = shedData;
      }
      // Collecter la liste des panneaux supprimés par forme (persistance)
      try {
        if (!data.removedPanels) data.removedPanels = {};
        if (this.lineToPolygon && this.lineToPolygon.deletedPanelIndexes) {
          this.lineToPolygon.deletedPanelIndexes.forEach((set, pvId) => {
            data.removedPanels[pvId] = Array.from(set);
          });
        }
      } catch (e) {
        console.warn('Erreur lors de la collecte des panneaux supprimés:', e);
      }
    });

    // Configurer les écouteurs d'événements pour le chargement de données
    window.storageManager.addEventListener('loadData', (data) => {
      // Restaurer d'abord la liste des panneaux supprimés, puis charger les shapes
      try {
        if (data && data.removedPanels && this.lineToPolygon) {
          this.lineToPolygon.deletedPanelIndexes = new Map(
            Object.entries(data.removedPanels).map(([pvId, arr]) => [pvId, new Set(arr)])
          );
        }
      } catch (e) {
        console.warn('Erreur lors du chargement des panneaux supprimés:', e);
      }

      if (data && data.shapes) {
        window.storageManager.loadShapesFromStorage(this, this.lineToPolygon);
      }
      // CORRECTIF : data.shedPolygons était collecté à la sauvegarde (cf. écouteur 'collectData'
      // ci-dessus) mais jamais rechargé — les shapes SHED_POLYGON réapparaissaient bien (via
      // data.shapes ci-dessus) mais sans leurs panneaux, jamais régénérés faute d'appel à
      // refreshPanelsForShape. Doit s'exécuter APRÈS data.shapes, qui recrée d'abord les polygones
      // SHED_POLYGON que loadFromData recherche par pvId dans drawnShapes.
      if (data && data.shedPolygons && this.shedPolygon) {
        this.shedPolygon.loadFromData(data.shedPolygons);
      }
      if (data && data.lines) {
        this.lineManager.loadLinesFromData(data.lines);
        this.cotationManager.loadLinesFromData(data.lines);
      }
      if (data && data.circles) {
        this.circleManager.loadCirclesFromData(data.circles);
      }
      if (data && data.texts) {
        this.textManager.loadTextsFromData(data.texts);
      }
      if (data && data.simpleRectangles) {
        this.simpleRectangleManager.loadSimpleRectanglesFromData(data.simpleRectangles);
      }
      if (data && data.simplePolygons) {
        this.simplePolygonManager.loadSimplePolygonsFromData(data.simplePolygons);
      }
      // CORRECTIF FIABILITÉ : les obstacles étaient collectés et sauvegardés (cf. écouteur
      // 'collectData' ci-dessus) mais jamais restaurés au rechargement de la page — les 4 méthodes
      // loadObstacle*FromData() existaient déjà mais n'étaient appelées nulle part. Tout obstacle
      // dessiné (et donc tout masquage de panneaux qui en dépendait) disparaissait silencieusement
      // dès qu'on rechargeait la page.
      if (data && data.obstacleCircles) {
        this.obstacleCircleManager.loadObstacleCirclesFromData(data.obstacleCircles);
      }
      if (data && data.obstacleRectangles) {
        this.obstacleRectangleManager.loadObstacleRectanglesFromData(data.obstacleRectangles);
      }
      if (data && data.obstaclePolygons) {
        this.obstaclePolygonManager.loadObstaclePolygonsFromData(data.obstaclePolygons);
      }
      if (data && data.obstacleLines) {
        this.obstacleLineManager.loadObstacleLinesFromData(data.obstacleLines);
      }

      // Chargement du matériel électrique
      if (data && data.matElec && this.localisationMatElec) {
        this.localisationMatElec.loadFromData(data.matElec);
      }

    });

    // Configurer les écouteurs d'événements pour le nettoyage
    window.storageManager.addEventListener('clearData', () => {
      this.clearAllShapes();
      this.lineManager.clearAllLines();
      this.circleManager.clearAllCircles();
      this.textManager.clearAllTexts();
      this.simpleRectangleManager.clearAllSimpleRectangles();
      this.simplePolygonManager.clearAllSimplePolygons();
    });

    // Exposer l'instance à window pour permettre l'accès depuis storageManager
    window.drawingControl = this;
  }

  /**
   * Initialise la bibliothèque de marqueurs avancés
   */
  async initializeMarkerLibrary() {
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
    this.AdvancedMarkerElement = AdvancedMarkerElement;
  }

  /**
   * Configure les écouteurs globaux (délégation d'événements) pour le filtrage des systèmes d'intégration
   * du Système d'Intégration et l'auto-remplissage des champs X et Y
   */
  setupSystemFilters() {
    const handleStructureChange = (e) => {
      const target = e.target;
      const idParts = target.id ? target.id.split('-') : [];
      const suffix = idParts.length > 1 ? `-${idParts[1]}` : '';

      let refSystemeSelect = document.getElementById(`referenceSI${suffix}`) || document.getElementById(`refSysteme${suffix}`);

      // Recherche robuste dans le conteneur parent (corrige le bug si l'ID est perdu dans les onglets dynamiques)
      if (!refSystemeSelect && target) {
        const container = target.closest('.tab-content') || target.closest('.form-section-details') || document.body;
        refSystemeSelect = container.querySelector('select[name^="referenceSI"], select[name^="refSysteme"]');
      }

      if (refSystemeSelect) {
        const structureType = target.value;
        let systemsList = TYPE_COUVERTURE_MAP[structureType] || [];

        // NOUVEAU: Filtrer la liste en fonction du support (Plat/Shed)
        const container = target.closest('.tab-pane') || document.body;
        const supportPlatInput = container.querySelector(`[id^="supportPlat"]`);
        const supportShedInput = container.querySelector(`[id^="supportShed"]`);

        if (structureType === 'Toiture terasse') {
            if (supportPlatInput && supportPlatInput.checked) {
                const allowedIds = ['SopraFixEvo', 'RoofSolarBitume', 'InovaPVLite', 'Autres'];
                systemsList = systemsList.filter(sys => allowedIds.includes(sys.id));
            } else if (supportShedInput && supportShedInput.checked) {
                const allowedIds = ['SopraFixEvoTilt', 'RoofSolarBitumeTilt', 'InovaPVLiteTilt', 'Autres'];
                systemsList = systemsList.filter(sys => allowedIds.includes(sys.id));
            }
        } else if (structureType === 'Petit champ solaire') {
            // Demande explicite : verrouiller le Système d'intégration sur "Autres" pour le
            // calepinage polygonal en sheds (ShedPolygon.js) — ce type de structure est désormais
            // celui utilisé par cet outil (cf. ShedPolygon.js::handlePolygonComplete), mais les
            // fabricants listés dans TYPE_COUVERTURE_MAP['Petit champ solaire'] visent des structures
            // au sol prédéfinies, pas le calepinage libre en polygone : seule l'option générique
            // "Autres" est pertinente ici.
            systemsList = systemsList.filter(sys => sys.id === 'Autres');
        }

        // Sauvegarder la valeur actuelle si possible pour la restaurer
        const currentValue = refSystemeSelect.value;

        refSystemeSelect.innerHTML = '<option value="" disabled selected>Sélectionnez un système...</option>';
        let valueExists = false;

        systemsList.forEach(sys => {
          const option = document.createElement('option');
          option.value = sys.id;
          option.textContent = sys.label;
          option.dataset.x = sys.x !== undefined ? sys.x : '';
          option.dataset.y = sys.y !== undefined ? sys.y : '';
          option.dataset.pose = sys.pose || '';
          option.dataset.avis = sys.avis || '';
          option.dataset.broof = sys.broof || '';
          option.dataset.fixation = sys.fixation || '';
          option.dataset.dx = sys.dX !== undefined ? sys.dX : '';
          option.dataset.dy = sys.dY !== undefined ? sys.dY : '';
          option.dataset.zVent = sys['Z-vent'] !== undefined ? sys['Z-vent'] : '';
          option.dataset.zNeige = sys['Z-Neige'] !== undefined ? sys['Z-Neige'] : '';
          option.dataset.altitude = sys.Altitude !== undefined ? sys.Altitude : '';
          option.dataset.pente = sys.pente !== undefined ? sys.pente : '';
          option.dataset.penteTerrainMax = sys.pente_terrain_max !== undefined ? sys.pente_terrain_max : '';
          option.dataset.configCalepinage = sys.Config_calepinage !== undefined ? sys.Config_calepinage : '';
          option.dataset.espGroupeShed = sys.Esp_groupe_shed !== undefined ? sys.Esp_groupe_shed : '';
          refSystemeSelect.appendChild(option);

          if (sys.id === currentValue) {
            valueExists = true;
          }
        });

        if (valueExists) {
          refSystemeSelect.value = currentValue;
        } else if (structureType === 'Ombrière solumbra' && systemsList.length > 0) {
          // Ombrière solumbra n'a qu'un seul système d'intégration : le sélectionner par
          // défaut plutôt que de laisser le placeholder "Sélectionnez un système..." affiché.
          refSystemeSelect.value = systemsList[0].id;
        } else if (structureType === 'Petit champ solaire' && systemsList.length > 0) {
          refSystemeSelect.value = systemsList[0].id; // 'Autres', seule option restante ci-dessus
        }

        // Verrouille le select : une seule option ("Autres") a un sens pour "Petit champ solaire"
        // (cf. filtre ci-dessus) — le désactiver rend ce choix visuellement non-modifiable plutôt que
        // de laisser un select fonctionnel avec une seule option, ambigu pour l'utilisateur.
        refSystemeSelect.disabled = (structureType === 'Petit champ solaire');

        // Déclencher le rafraîchissement pour Select2
        if (typeof jQuery !== 'undefined' && jQuery(refSystemeSelect).hasClass('select2-hidden-accessible')) {
          jQuery(refSystemeSelect).trigger('change.select2');
        } else {
          refSystemeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    };

    const handleSystemeChange = (e) => {
      const target = e.target;
      const idParts = target.id ? target.id.split('-') : [];
      const suffix = idParts.length > 1 ? `-${idParts[1]}` : '';
      const pvId = idParts.length > 1 ? idParts[1] : null;

      const espacementXInput = document.getElementById(`espacementPanneauxX${suffix}`) || document.getElementById(`intermodule_x${suffix}`);
      const espacementYInput = document.getElementById(`espacementPanneauxY${suffix}`) || document.getElementById(`intermodule_y${suffix}`);
      let btnInfoSysteme = document.getElementById(`btnInfoSysteme${suffix}`);

      // Recherche robuste du bouton (cas où l'ID n'a pas été suffixé par le gestionnaire d'onglets)
      if (!btnInfoSysteme && target) {
        const container = target.closest('.tab-content') || target.closest('.form-section-details') || document.body;
        btnInfoSysteme = container.querySelector('[id^="btnInfoSysteme"]');
      }

      const selectedOption = target.options[target.selectedIndex];

      if (selectedOption && selectedOption.value) {
        // NOUVEAU: Validation de conformité au changement de Système
        const isUserAction = e.type === 'select2:select' || (e.originalEvent ? e.originalEvent.isTrusted : e.isTrusted);
        if (isUserAction && pvId && this.FormHandler && typeof this.FormHandler.checkCompliance === 'function') {
          this.FormHandler.checkCompliance(this, pvId, null, null, selectedOption.value);
        }

        if (espacementXInput && selectedOption.dataset.x !== undefined && selectedOption.dataset.x !== '') {
          espacementXInput.value = selectedOption.dataset.x;
          espacementXInput.dispatchEvent(new Event('input', { bubbles: true }));
          espacementXInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (espacementYInput && selectedOption.dataset.y !== undefined && selectedOption.dataset.y !== '') {
          espacementYInput.value = selectedOption.dataset.y;
          espacementYInput.dispatchEvent(new Event('input', { bubbles: true }));
          espacementYInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // CORRECTIF (auto-remplissage shed non fiable — nécessitait plusieurs sélections ou un
        // rechargement de page) : cette logique vivait auparavant dans FormHandler.js, sur un écouteur
        // attaché séparément (et plus tardivement, potentiellement avant que jQuery/select2 ne soient
        // prêts) à chaque forme — ici, dans handleSystemeChange, elle bénéficie du même point d'entrée
        // unique et déjà fiable (lié dès l'initialisation de DrawingControl) que les champs Esp. entre
        // PV X/Y ci-dessus, et lit directement les données déjà posées sur l'<option> par
        // handleStructureChange (pas de nouvelle recherche dans TYPE_COUVERTURE_MAP nécessaire).
        const supportShedInputAuto = document.getElementById(`supportShed${suffix}`)
          || (target.closest('.tab-content') || target.closest('.form-section-details') || document.body).querySelector(`[id^="supportShed"]`);
        if (supportShedInputAuto && supportShedInputAuto.checked && selectedOption.value !== 'Autres') {
          const penteShedInputAuto = document.getElementById(`pente_panneaux_shed${suffix}`);
          if (penteShedInputAuto && selectedOption.dataset.pente) {
            const penteMatch = String(selectedOption.dataset.pente).match(/\d+(\.\d+)?/);
            if (penteMatch) {
              penteShedInputAuto.value = Math.max(0, Math.min(90, parseFloat(penteMatch[0])));
              penteShedInputAuto.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }

          // "Config. Calepinage" (ex: "2Lx12C") : 1er nombre -> Nb. PV en largeur (#shedsCols), 2e ->
          // Nb. PV en longueur (#shedsRows) — cf. libellés HTML actuels.
          if (selectedOption.dataset.configCalepinage) {
            const nums = String(selectedOption.dataset.configCalepinage).match(/\d+/g);
            if (nums && nums.length >= 2) {
              const shedsColsInputAuto = document.getElementById(`shedsCols${suffix}`);
              const shedsRowsInputAuto = document.getElementById(`shedsRows${suffix}`);
              if (shedsColsInputAuto) {
                shedsColsInputAuto.value = parseInt(nums[0], 10);
                shedsColsInputAuto.dispatchEvent(new Event('change', { bubbles: true }));
              }
              if (shedsRowsInputAuto) {
                shedsRowsInputAuto.value = parseInt(nums[1], 10);
                shedsRowsInputAuto.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          }

          // "Esp. groupe de shed" (#shedsRowSpacing, en mm) : pré-remplissage modifiable ensuite.
          if (selectedOption.dataset.espGroupeShed) {
            const shedsRowSpacingInputAuto = document.getElementById(`shedsRowSpacing${suffix}`);
            if (shedsRowSpacingInputAuto) {
              shedsRowSpacingInputAuto.value = parseFloat(selectedOption.dataset.espGroupeShed);
              shedsRowSpacingInputAuto.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }

        if (btnInfoSysteme) {
          btnInfoSysteme.disabled = false;
          btnInfoSysteme.classList.remove('btn-secondary');
          btnInfoSysteme.classList.add('btn-info');
          btnInfoSysteme.dataset.pose = selectedOption.dataset.pose;
          btnInfoSysteme.dataset.avis = selectedOption.dataset.avis;
          btnInfoSysteme.dataset.broof = selectedOption.dataset.broof;
          btnInfoSysteme.dataset.fixation = selectedOption.dataset.fixation;

          btnInfoSysteme.dataset.dx = selectedOption.dataset.dx;
          btnInfoSysteme.dataset.dy = selectedOption.dataset.dy;
          btnInfoSysteme.dataset.zVent = selectedOption.dataset.zVent;
          btnInfoSysteme.dataset.zNeige = selectedOption.dataset.zNeige;
          btnInfoSysteme.dataset.altitude = selectedOption.dataset.altitude;
          btnInfoSysteme.dataset.pente = selectedOption.dataset.pente;
          btnInfoSysteme.dataset.penteTerrainMax = selectedOption.dataset.penteTerrainMax;
          btnInfoSysteme.dataset.configCalepinage = selectedOption.dataset.configCalepinage;
        }
      } else {
        if (btnInfoSysteme) {
          btnInfoSysteme.disabled = true;
          btnInfoSysteme.classList.add('btn-secondary');
          btnInfoSysteme.classList.remove('btn-info');
        }
      }
    };

    // 1. Écouteurs jQuery (Compatibilité parfaite avec Select2)
    if (typeof jQuery !== 'undefined') {
      jQuery(document).on('select2:select change', 'select[id^="type_de_structure"], select[name^="type_de_structure"]', function (e) {
        handleStructureChange(e);
        if (typeof window.toggleStructureFields === 'function') {
          window.toggleStructureFields(e.target);
        }
      });
      jQuery(document).on('select2:select change', 'select[id^="referenceSI"], select[name^="referenceSI"], select[id^="refSysteme"], select[name^="refSysteme"]', handleSystemeChange);
    }

    // 2. Écouteur Natif (Phase de capture = true pour éviter que stopImmediatePropagation le bloque)
    document.addEventListener('change', (e) => {
      if (!e.target) return;
      const id = e.target.id || '';
      const name = e.target.name || '';

      if (id.startsWith('type_de_structure') || name.startsWith('type_de_structure')) {
        // Bloquer l'ouverture automatique du Modal en stoppant l'événement pour les autres écouteurs
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
        handleStructureChange(e);
        if (typeof window.toggleStructureFields === 'function') {
          window.toggleStructureFields(e.target);
        }
      } else if (id.startsWith('referenceSI') || name.startsWith('referenceSI') || id.startsWith('refSysteme') || name.startsWith('refSysteme')) {
        handleSystemeChange(e);
      }
    }, true);
  }

  /**
   * Méthode appelée lors de l'ajout du contrôle à la carte
   * @param {google.maps.Map} map - Carte Google Maps
   * @returns {HTMLElement} Conteneur du contrôle
   */
  onAdd(map) {
    this.map = map;
    
    // Initialisation globale du gestionnaire d'axes de poteaux
    if (!window.postAxesManager) {
      window.postAxesManager = new PostAxesManager(this.map);
    }

    this.initializeContainer();
    this.initializeDrawingManager();
    this.terraDrawEngine.init(this.map).catch((error) => {
      console.error('[DrawingControl] Échec d\'initialisation de Terra Draw:', error);
    });
    ButtonControl.createControls(this);

    // Ajouter l'écouteur de zoom sur la carte
    google.maps.event.addListener(map, 'zoom_changed', () => {
      const zoom = map.getZoom();
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.MAP_ZOOM_CHANGED, {
        detail: { zoom }
      }));
    });

    // Ajouter l'écouteur pour le clic sur la carte pour le collage
    google.maps.event.addListener(map, 'click', (e) => {
      if (this.isPasteMode && this.clipboard) {
        this.pasteShape(e.latLng);

        // Désactiver le mode de collage après avoir collé
        this.isPasteMode = false;
        this.map.setOptions({ draggableCursor: null });

        if (this.copyButton) {
          this.copyButton.classList.remove("selected");
          this.copyButton.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
        }
      }
    });

    return this.container;
  }

  /**
   * Initialise le conteneur du contrôle
   */
  initializeContainer() {
    this.container = ButtonControl.createControlContainer();
    this.innerContainer = ButtonControl.createInnerControlContainer();
  }

  /**
   * Initialise le gestionnaire de dessin
   */
  async initializeDrawingManager() {
    const { DrawingManager } = await google.maps.importLibrary("drawing");
    this.drawingManager = new DrawingManager({
      drawingMode: null,
      drawingControl: false,
      polylineOptions: {
        ...STYLES.DEFAULT_LINE
      },
      circleOptions: {
        ...STYLES.DEFAULT_CIRCLE
      },
      polygonOptions: {
        fillColor: STYLES.DEFAULT_SHAPE.fillColor,
        fillOpacity: STYLES.DEFAULT_SHAPE.fillOpacity,
        strokeWeight: STYLES.DEFAULT_SHAPE.strokeWeight,
        strokeColor: STYLES.DEFAULT_SHAPE.strokeColor,
        strokeOpacity: STYLES.DEFAULT_SHAPE.strokeOpacity,
        editable: STYLES.DEFAULT_SHAPE.editable,
        draggable: STYLES.DEFAULT_SHAPE.draggable,
      },
      rectangleOptions: {
        fillColor: STYLES.DEFAULT_SHAPE.fillColor,
        fillOpacity: STYLES.DEFAULT_SHAPE.fillOpacity,
        strokeWeight: STYLES.DEFAULT_SHAPE.strokeWeight,
        strokeColor: STYLES.DEFAULT_SHAPE.strokeColor,
        strokeOpacity: STYLES.DEFAULT_SHAPE.strokeOpacity,
        editable: false,
        draggable: STYLES.DEFAULT_SHAPE.draggable,
      },
      simpleRectangleOptions: {
        ...STYLES.DEFAULT_SIMPLE_RECTANGLE,
        editable: true,
        draggable: true,
      },
      simplePolygonOptions: {
        ...STYLES.DEFAULT_SIMPLE_POLYGON,
        editable: true,
        draggable: true,
      }
    });

    this.drawingManager.setMap(this.map);
    EventHandler.setupDrawingListeners(this);

  }

  /**
   * Active/désactive le mode de dessin
   * @param {HTMLElement} button - Bouton de dessin
   * @param {string} drawingMode - Mode de dessin à activer
   */
  toggleDrawingMode(button, drawingMode) {
    // Cas spécial pour les rectangles simples - traitement terminé
    if (this.simpleRectangleMode && !drawingMode && button === this.simpleRectangleButton) {
      this.simpleRectangleMode = false;
      this.drawingManager.setDrawingMode(null);
      button.classList.remove('selected');
      button.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      this.activeButton = null;
      this.map.setOptions({ draggableCursor: null });

      // Important: sortir immédiatement pour éviter tout traitement supplémentaire
      return;
    }

    // Si le même bouton est cliqué, désactiver le mode dessin
    if (this.activeButton === button) {
      this.drawingManager.setDrawingMode(null);
      button.classList.remove('selected');
      button.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      this.activeButton = null;
      this.map.setOptions({ draggableCursor: null });

      // Supprimer l'écouteur de texte si présent
      if (this._textClickListener) {
        google.maps.event.removeListener(this._textClickListener);
        this._textClickListener = null;
      }
    } else {
      // Désactiver le bouton précédent s'il existe
      if (this.activeButton) {
        this.activeButton.classList.remove('selected');
        this.activeButton.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;

        // Supprimer l'écouteur de texte si présent
        if (this._textClickListener) {
          google.maps.event.removeListener(this._textClickListener);
          this._textClickListener = null;
        }
      }

      // Activer le nouveau mode
      button.classList.add('selected');
      button.style.backgroundColor = STYLES.SELECTED_BUTTON.backgroundColor;
      this.activeButton = button;
      // Désactiver le mode SimpleRectangle si on active un autre mode
      this.simpleRectangleMode = false;
      if (drawingMode === 'text') {
        // Mode texte spécial
        this.drawingManager.setDrawingMode(null);
        this.map.setOptions({ draggableCursor: 'text' });

        // Ajouter l'écouteur de clic pour le texte
        this._textClickListener = google.maps.event.addListener(this.map, 'click', (e) => {
          this.textManager.createText(e.latLng);
          // Désactiver le mode texte après création
          this.toggleDrawingMode(button, null);
        });
      } else {
        // Autres modes de dessin standard
        this.drawingManager.setDrawingMode(drawingMode);
      }
    }
  }

  /**
   * Bascule la visibilité des cotations (labels, azimuts, noms)
   * @param {HTMLElement} button - Bouton déclencheur
   */
  toggleCotationsVisibility(button) {
    this.areCotationsVisible = !this.areCotationsVisible;

    if (button) {
      if (this.areCotationsVisible) {
        button.classList.remove('selected');
        button.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      } else {
        button.classList.add('selected');
        button.style.backgroundColor = STYLES.SELECTED_BUTTON.backgroundColor;
      }
    }

    this.updateCotationsVisibility();
  }

  /**
   * Applique l'état de visibilité des cotations à l'ensemble des labels concernés
   */
  updateCotationsVisibility() {
    const showCotations = this.areCotationsVisible;

    if (Array.isArray(this.permanentLabels)) {
      this.permanentLabels.forEach((label) => {
        if (label && this.shouldHideWithCotations(label.labelId) && typeof label.setMap === 'function') {
          try {
            label.setMap(showCotations ? this.map : null);
          } catch (error) {
            console.error('Erreur lors du changement de visibilité des cotations:', error);
          }
        }
      });
    }

    this.applySimpleShapeLabelsVisibility();
    // CORRECTIF (label PV + flèche d'azimut ne suivaient pas "Afficher/masquer les cotations") :
    // ces 3 managers gèrent leur propre label/flèche via roofOverlaysByShape (cf. updateRoofVisuals),
    // jamais enregistré dans this.permanentLabels — il faut donc les basculer explicitement ici.
    if (this.polygon?.setLabelsVisibility) {
      this.polygon.setLabelsVisibility(showCotations);
    }
    if (this.lineToPolygon?.setLabelsVisibility) {
      this.lineToPolygon.setLabelsVisibility(showCotations);
    }
    if (this.solarRectangle?.setLabelsVisibility) {
      this.solarRectangle.setLabelsVisibility(showCotations);
    }
  }

  /**
   * Étiquettes des formes simples (ligne, cercle, rectangle, polygone) : affichées seulement si les
   * cotations sont visibles ET que le bouton « œil » de la palette des formes simples ne les masque
   * pas. Les lignes de cotation gardent toujours leur valeur (elles ne sont que ça).
   */
  applySimpleShapeLabelsVisibility() {
    const show = this.areCotationsVisible !== false && this.simpleShapeLabelsVisible !== false;
    [this.lineManager, this.simpleRectangleManager, this.circleManager, this.simplePolygonManager]
      .forEach((manager) => manager?.setLabelsVisibility?.(show));
  }

  /** Bascule du bouton « Masquer les étiquettes » de la palette des formes simples. */
  toggleSimpleShapeLabels() {
    this.simpleShapeLabelsVisible = this.simpleShapeLabelsVisible === false;
    this.applySimpleShapeLabelsVisibility();
    return this.simpleShapeLabelsVisible;
  }

  /**
   * Détermine si un label permanent doit suivre la visibilité des cotations
   * @param {string} labelId - Identifiant du label
   * @returns {boolean}
   */
  shouldHideWithCotations(labelId) {
    if (!labelId) return false;
    return (
      labelId.endsWith('-id') ||
      labelId.endsWith('-azimuth') ||
      labelId.includes('-dimension-') ||
      labelId.includes('-length-') ||
      labelId.includes('-width-')
    );
  }

  /**
   * Réinitialise l'état du bouton actif et du DrawingManager
   * lorsqu'une forme vient d'être dessinée.
   */
  finishDrawingSession() {
    if (this.drawingManager) {
      this.drawingManager.setDrawingMode(null);
    }

    if (this.terraDrawEngine) {
      this.terraDrawEngine.stop();
    }

    if (this.map) {
      this.map.setOptions({ draggableCursor: null });
    }

    if (this.activeButton) {
      this.activeButton.classList.remove('selected');
      this.activeButton.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      this.activeButton = null;
    }

    if (this._textClickListener) {
      google.maps.event.removeListener(this._textClickListener);
      this._textClickListener = null;
    }

    this.simpleRectangleMode = false;
    this.simplePolygonMode = false;
  }

  /**
   * Définit la forme sélectionnée
   * @param {google.maps.Polygon|google.maps.Rectangle} shape - Forme à sélectionner
   */
  setSelection(shape) {

    // Réinitialiser la forme précédemment sélectionnée
    if (this.selectedShape) {
      try {
        this.selectedShape.setOptions({
          strokeColor: STYLES.DEFAULT_SHAPE.strokeColor,
          fillOpacity: STYLES.DEFAULT_SHAPE.fillOpacity,
          fillColor: STYLES.DEFAULT_SHAPE.fillColor,
              editable: false,
              draggable: false
        });
            if (this.selectedShape.type === SHAPE_TYPES.LINE_TO_POLYGON && this.lineToPolygon) {
              this.lineToPolygon.clearSideDetectors();
            }
      } catch (error) {
        console.error("Erreur lors de la réinitialisation de la forme précédente:", error);
      }
    }

    // Désélectionner les autres types d'éléments
    if (this.lineManager.selectedLine) {
      this.lineManager.setLineSelection(null);
    }

    if (this.circleManager.selectedCircle) {
      this.circleManager.setCircleSelection(null);
    }

    if (this.textManager.selectedText) {
      this.textManager.setTextSelection(null);
    }
    if (this.simpleRectangleManager.selectedSimpleRectangle) {
      this.simpleRectangleManager.setSimpleRectangleSelection(null);
    }
    if (this.simplePolygonManager.selectedSimplePolygon) {
      this.simplePolygonManager.setSimplePolygonSelection(null);
    }

    // Mettre à jour la forme sélectionnée
    this.selectedShape = shape;

    // Mettre à jour les détecteurs de côtés pour LineToPolygon
    if (shape && shape.type === SHAPE_TYPES.LINE_TO_POLYGON) {
      this.lineToPolygon.updateDetectorsForPolygon(shape);
    }

    if (shape) {
      // Vérifier que la forme existe encore dans drawnShapes
      const shapeExists = this.drawnShapes.some(s => s === shape);
      if (!shapeExists) {
        console.warn(`La forme ${shape.pvId || 'sans ID'} n'existe pas dans drawnShapes`);
        this.selectedShape = null;
        return;
      }

      try {
        // Ne pas ajouter de poignées de modification pour les polygones LineToPolygon
        const shouldBeEditable =
          shape.type !== SHAPE_TYPES.LINE_TO_POLYGON &&
          shape.type !== SHAPE_TYPES.SOLAR_RECTANGLE;

        shape.setOptions({
          strokeColor: STYLES.SELECTED_SHAPE.strokeColor,
          editable: shouldBeEditable, // Affiche les poignées seulement pour les polygones Polygon.js
          draggable: true, // Permet le déplacement pour la forme sélectionnée
        });
      } catch (error) {
        console.error("Erreur lors de la mise à jour du style de la forme sélectionnée:", error);
        this.selectedShape = null;

        return;
      }

      if (shape.pvId && !this.isInternalSelection) {
        document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_SELECTED, {
          detail: { pvId: shape.pvId }
        }));
      }
    }
  }

  /**
  //  * Supprime la forme sélectionnée ( ancien code, Add jjd)
  //  */
  // deleteSelectedShape() {
  //   if (this.selectedShape) {
  //     const pvId = this.selectedShape.pvId;

  //     // Conserver une référence à la forme sélectionnée avant de la modifier
  //     const shapeToDelete = this.selectedShape;

  //     // Réinitialiser la sélection AVANT de supprimer la forme
  //     this.selectedShape = null;

  //     // Supprimer de la liste des formes dessinées
  //     this.drawnShapes = this.drawnShapes.filter(shape => shape.pvId !== pvId);

  //     // 1. Supprimer la forme de la carte EN PREMIER (avant de clear les listeners, sinon l'API Google Maps échoue à retirer le SVG)
  //     if (typeof shapeToDelete.setEditable === 'function') {
  //       shapeToDelete.setEditable(false);
  //     }
  //     shapeToDelete.setMap(null);

  //     // 2. Nettoyer TOUS les listeners d'événements Google Maps APRES suppression
  //     if (google && google.maps && google.maps.event) {
  //       setTimeout(() => {
  //         google.maps.event.clearInstanceListeners(shapeToDelete);
  //       }, 100);
  //     }

  //     // Forcer le rafraîchissement de la carte pour éviter les contours persistants ( ajout de JRC, desac temporaire par JJD)
  //     if (this.map) {
  //       google.maps.event.trigger(this.map, 'resize');
  //       // Forcer un léger zoom pour rafraîchir l'affichage
  //       const currentZoom = this.map.getZoom();
  //       this.map.setZoom(currentZoom);
  //     }

  //     // Supprimer l'ID de la liste des IDs utilisés
  //     this.usedIds.delete(pvId);

  //     // Supprimer l'étiquette permanente
  //     MeasurementControl.removePermanentLabels(this, pvId);

  //     // Nettoyer les panneaux solaires associés à cette forme
  //     if (shapeToDelete.type === SHAPE_TYPES.LINE_TO_POLYGON) {
  //       this.lineToPolygon.cleanupPanelsForShape(pvId, { resetDeleted: true });
  //     }
  //     else if (shapeToDelete.type === SHAPE_TYPES.POLYGON) {
  //       this.polygonPanels.cleanupPanelsForShape(pvId);
  //       if (this.polygonPanels && typeof this.polygonPanels.clearDeletedIndicesForShape === 'function') {
  //         this.polygonPanels.clearDeletedIndicesForShape(pvId);
  //       }
  //     }
  //     else if (shapeToDelete.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
  //       this.solarRectangle.cleanupPanelsForShape(pvId, { resetDeleted: true });
  //     }

  //     // Émettre l'événement de suppression
  //     document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_REMOVED, {
  //       detail: { pvId: pvId }
  //     }));
  //   }
  // }


  // Suppresion forme rectangle sur la carte (JJD)

  /**
   * Supprime la forme sélectionnée de manière sécurisée et anti-crash
   */
  deleteSelectedShape() {
    if (!this.selectedShape) return; // Sécurité : si aucune forme, on arrête tout de suite

    try {
      const originalId = this.selectedShape.pvId;
      const pvIdString = String(originalId);

      // D. Renforcer la méthode de suppression (aspirateur de polygones fantômes)
      const shapesToDelete = this.drawnShapes.filter(shape => String(shape.pvId) === pvIdString);
      // Sécurité : s'assurer que l'instance actuellement sélectionnée y est bien incluse
      if (!shapesToDelete.includes(this.selectedShape)) {
        shapesToDelete.push(this.selectedShape);
      }

      // 1. Réinitialiser la sélection locale instantanément
      this.selectedShape = null;

      // 2. Retirer de la liste des formes dessinées de manière stricte
      if (Array.isArray(this.drawnShapes)) {
        this.drawnShapes = this.drawnShapes.filter(shape => String(shape.pvId) !== pvIdString);
      }

      // 3. Désactiver l'édition PROPREMENT (Évite le plantage des "poignées" Google Maps)
      shapesToDelete.forEach(shape => {
        if (typeof shape.setEditable === 'function') shape.setEditable(false);
        if (typeof shape.setDraggable === 'function') shape.setDraggable(false);
      });

      // 4. SUPPRESSION ASYNCHRONE DE LA CARTE (LA CLÉ DU CORRECTIF)
      setTimeout(() => {
        shapesToDelete.forEach(shape => {
          if (typeof shape.setMap === 'function') shape.setMap(null);
          if (window.google && window.google.maps && window.google.maps.event) {
            window.google.maps.event.clearInstanceListeners(shape);
          }
        });
      }, 50);

      // 5. Nettoyage des données (IDs, étiquettes permanentes)
      if (this.usedIds && typeof this.usedIds.delete === 'function') {
        this.usedIds.delete(pvIdString);
        this.usedIds.delete(Number(originalId));
        this.usedIds.delete(originalId);
      }

      if (typeof MeasurementControl !== 'undefined' && typeof MeasurementControl.removePermanentLabels === 'function') {
        MeasurementControl.removePermanentLabels(this, originalId);
      }

      // 6. Nettoyer les panneaux solaires associés (avec vérifications de sécurité)
      if (shapesToDelete.length > 0 && shapesToDelete[0].type === SHAPE_TYPES.LINE_TO_POLYGON && this.lineToPolygon) {
        this.lineToPolygon.cleanupPanelsForShape(originalId, { resetDeleted: true });
      } 
      else if (shapesToDelete.length > 0 && shapesToDelete[0].type === SHAPE_TYPES.POLYGON && this.polygonPanels) {
        this.polygonPanels.cleanupPanelsForShape(originalId);
        if (typeof this.polygonPanels.clearDeletedIndicesForShape === 'function') {
          this.polygonPanels.clearDeletedIndicesForShape(originalId);
        }
      } 
      else if (shapesToDelete.length > 0 && shapesToDelete[0].type === SHAPE_TYPES.SOLAR_RECTANGLE && this.solarRectangle) {
        this.solarRectangle.cleanupPanelsForShape(originalId, { resetDeleted: true });
      }
      else if (
        shapesToDelete.length > 0 &&
        (shapesToDelete[0].type === SHAPE_TYPES.SHED_POLYGON || (shapesToDelete[0].shedsCapable && shapesToDelete[0].type == null)) &&
        this.shedPolygon
      ) {
        // NOUVEAU : sans ce nettoyage, les panneaux d'un shed supprimé restaient affichés sur la carte
        // (seul le contour du polygone disparaissait). Le repli sur "shedsCapable && type == null"
        // couvre les formes restaurées via un ancien format de sauvegarde où "type" n'était pas encore
        // fiablement renseigné (cf. même repli déjà utilisé dans StorageManager.js) — sans lui, ces
        // formes échappaient silencieusement au nettoyage, d'où un bug seulement intermittent.
        this.shedPolygon.cleanupPanelsForShape(originalId);
      }

      // 7. Émettre l'événement de suppression pour fermer l'onglet du formulaire
      if (typeof CUSTOM_EVENTS !== 'undefined' && CUSTOM_EVENTS.SHAPE_REMOVED) {
        document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_REMOVED, {
          detail: { pvId: originalId }
        }));
      }

      // 8. Forcer la sauvegarde locale pour garantir la synchronisation, PUIS la sauvegarde en base
      // (étape 9) — enchaînées explicitement, savePageData() étant asynchrone : sans attendre sa fin,
      // saveToDatabase() risquerait de relire un localStorage pas encore à jour avec la suppression.
      const localSavePromise = (window.storageManager && typeof window.storageManager.savePageData === 'function')
        ? window.storageManager.savePageData()
        : Promise.resolve();

      // 9. CORRECTIF (bug "polygone supprimé qui réapparaît après rechargement/réouverture du projet") :
      // sans ceci, la suppression n'était persistée qu'en localStorage (étape 8) — la base de données
      // n'était mise à jour qu'au prochain "Calculer"/beforeunload, ce dernier étant peu fiable (le
      // fetch asynchrone peut être interrompu par la navigation avant d'aboutir). On sauvegarde donc
      // immédiatement en base ici. `explicitShapeDeletion: true` autorise en plus le backend à accepter
      // un calepinage devenu vide (dernière forme supprimée) sans quoi son garde-fou anti-perte-de-
      // données ignorerait silencieusement cette suppression pourtant délibérée.
      Promise.resolve(localSavePromise).then(() => {
        if (window.calepinageService && typeof window.calepinageService.saveToDatabase === 'function') {
          return window.calepinageService.saveToDatabase({ explicitShapeDeletion: true });
        }
      }).catch((err) => {
        console.warn("Sauvegarde en base après suppression de forme impossible :", err);
      });

    } catch (error) {
      console.error("Erreur bloquée lors de la suppression du champ PV :", error);
    }
  }


  /**
   * Bascule l'orientation des panneaux
   */
  togglePanelOrientation() {
    if (!this.selectedShape) return;

    const pvId = this.selectedShape.pvId;
    if (!pvId) return;

    const modePosePortraitInput = document.querySelector(`#modePosePortrait-${pvId}`);
    const modePosePaysageInput = document.querySelector(`#modePosePaysage-${pvId}`);

    if (!modePosePortraitInput || !modePosePaysageInput) {
      return;
    }

    const isCurrentlyPortrait = modePosePortraitInput.checked;
    const newOrientation = isCurrentlyPortrait ? 'paysage' : 'portrait';

    // Validation de conformité avant le basculement programmatique
    if (this.FormHandler && typeof this.FormHandler.checkCompliance === 'function') {
      if (!this.FormHandler.checkCompliance(this, pvId, newOrientation)) {
        return;
      }
    }

    // Mettre à jour les radios comme si l'utilisateur cliquait sur l'un des boutons
    if (newOrientation === 'portrait') {
      modePosePortraitInput.checked = true;
      modePosePaysageInput.checked = false;
      // Déclencher le même handler que pour le bouton Portrait
      modePosePortraitInput.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      modePosePortraitInput.checked = false;
      modePosePaysageInput.checked = true;
      // Déclencher le même handler que pour le bouton Paysage
      modePosePaysageInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Mettre à jour l'état interne pour rester cohérent
    this.panelOrientation = newOrientation;
  }

  /**
   * Met à jour l'état du bouton de dessin
   * @param {number} zoomLevel - Niveau de zoom actuel
   */
  updateDrawButtonState(zoomLevel) {
    ButtonControl.updateDrawButtonState(this, zoomLevel);
  }

  /**
   * Met à jour les dimensions d'une forme
   * @param {string} pvId - Identifiant de la forme
   * @param {Object} dimensions - Nouvelles dimensions
   */
  updateShapeDimensions(pvId, dimensions) {
    ShapeHandler.updateShapeDimensions(this, pvId, dimensions);
  }

  /**
   * Fait pivoter la forme sélectionnée
   * @param {number} angle - Angle de rotation en degrés
   * @param {boolean} updatePanels - Mettre à jour les panneaux
   */
  rotateShape(angle, updatePanels = true) {
    ShapeHandler.rotateShape(this, angle, updatePanels);
  }

  /**
    * Fait pivoter l'élément actuellement sélectionné (PV ou forme simple)
    * @param {number} angle - Angle de rotation en degrés
    * @param {boolean} updatePanels - Indicateur (réservé pour les PV, ignoré pour les formes simples)
    */

  /**
   * Vérifie que toutes les surfaces PV dessinées (Polygon, LineToPolygon, SolarRectangle,
   * ShedPolygon) restent dans le rayon d'action maximal autorisé autour de l'adresse du projet
   * (cf. Config.PROJECT_RADIUS_LIMIT_KM, GeometryUtils.checkWithinProjectRadius). Utilisé pour
   * bloquer le bouton "Calculer et Visualiser" (cf. ButtonControl.js) et le rejet des nouvelles
   * formes trop éloignées (cf. Polygon.js / SolarRectangle.js).
   * @returns {{ok: boolean, violations: Array<{pvId: string, distanceKm: number, limitKm: number}>}}
   */
  checkProjectRadiusCompliance() {
    const pvShapeTypes = new Set([
      SHAPE_TYPES.POLYGON,
      SHAPE_TYPES.LINE_TO_POLYGON,
      SHAPE_TYPES.SOLAR_RECTANGLE,
      SHAPE_TYPES.SHED_POLYGON
    ]);
    const violations = [];

    (this.drawnShapes || []).forEach(shape => {
      if (!shape || !pvShapeTypes.has(shape.type) || typeof shape.getPath !== 'function') return;
      const path = shape.getPath();
      if (!path || path.getLength() === 0) return;

      const bounds = new google.maps.LatLngBounds();
      for (let i = 0; i < path.getLength(); i += 1) bounds.extend(path.getAt(i));
      const center = bounds.getCenter();

      const result = this.GeometryUtils.checkWithinProjectRadius(center);
      if (!result.allowed) {
        violations.push({ pvId: shape.pvId || '?', distanceKm: result.distanceKm, limitKm: result.limitKm });
      }
    });

    return { ok: violations.length === 0, violations };
  }

  rotateSelectedElement(angle, updatePanels = true) {
    // Priorité : formes PV (LineToPolygon, Polygon, SolarRectangle, etc.)
    if (this.selectedShape) {
      this.rotateShape(angle, updatePanels);
      return;
    }

    // Lignes simples
    if (this.lineManager?.selectedLine) {
      const line = this.lineManager.selectedLine;
      const path = line.getPath();
      if (!path || path.getLength() === 0) return;

      const bounds = new google.maps.LatLngBounds();
      for (let i = 0; i < path.getLength(); i += 1) {
        bounds.extend(path.getAt(i));
      }
      const center = bounds.getCenter();

      const rotatedPath = [];
      for (let i = 0; i < path.getLength(); i += 1) {
        const point = path.getAt(i);
        rotatedPath.push(this.GeometryUtils.rotatePoint(point, center, angle));
      }

      line.setPath(rotatedPath);
      // Les listeners existants sur la ligne se chargeront de mettre à jour labels et sauvegarde
      return;
    }

    // Cercles : une rotation n'a pas d'effet visible, on ignore silencieusement
    if (this.circleManager?.selectedCircle) {
      return;
    }

    // Polygones simples
    if (this.simplePolygonManager?.selectedSimplePolygon) {
      const polygon = this.simplePolygonManager.selectedSimplePolygon;
      const path = polygon.getPath();
      if (!path || path.getLength() === 0) return;

      const bounds = new google.maps.LatLngBounds();
      for (let i = 0; i < path.getLength(); i += 1) {
        bounds.extend(path.getAt(i));
      }
      const center = bounds.getCenter();

      const rotatedPath = [];
      for (let i = 0; i < path.getLength(); i += 1) {
        const point = path.getAt(i);
        rotatedPath.push(this.GeometryUtils.rotatePoint(point, center, angle));
      }

      polygon.setPath(rotatedPath);
      // Les listeners du SimplePolygonManager se chargeront des labels / sauvegarde
      return;
    }

    // Rectangles simples : polygone à 4 sommets (cf. SimpleRectangle.js), sommets modifiés en
    // place pour garder les écouteurs du chemin.
    if (this.simpleRectangleManager?.selectedSimpleRectangle) {
      const rectangle = this.simpleRectangleManager.selectedSimpleRectangle;
      const center = this.simpleRectangleManager.getCenter(rectangle);
      const rotatedPath = rectangle.getPath().getArray()
        .map((point) => this.GeometryUtils.rotatePoint(point, center, angle));
      this.simpleRectangleManager.setRectanglePath(rectangle, rotatedPath);
      return;
    }

    // Obstacles rectangles : représentés en interne par un google.maps.Polygon à 4 points
    // (cf. ObstacleRectangle.js) précisément pour permettre cette rotation — même mécanisme que
    // les obstacles polygones/lignes ci-dessous.
    if (this.obstacleRectangleManager?.selectedObstacleRectangle) {
      const polygon = this.obstacleRectangleManager.selectedObstacleRectangle;
      const path = polygon.getPath();
      if (!path || path.getLength() === 0) return;

      const bounds = new google.maps.LatLngBounds();
      for (let i = 0; i < path.getLength(); i += 1) {
        bounds.extend(path.getAt(i));
      }
      const center = bounds.getCenter();

      const rotatedPath = [];
      for (let i = 0; i < path.getLength(); i += 1) {
        const point = path.getAt(i);
        rotatedPath.push(this.GeometryUtils.rotatePoint(point, center, angle));
      }

      polygon.setPath(rotatedPath);

      if (typeof this.obstacleRectangleManager.updateBufferVisual === 'function') {
        this.obstacleRectangleManager.updateBufferVisual(polygon);
      }
      if (this.obstaclePanels) {
        this.obstaclePanels.requestRefresh();
      }

      return;
    }

    // Obstacles cercles : rotation sans effet
    if (this.obstacleCircleManager?.selectedObstacleCircle) {
      return;
    }

    // Obstacles lignes
    if (this.obstacleLineManager?.selectedObstacleLine) {
      const line = this.obstacleLineManager.selectedObstacleLine;
      const path = line.getPath();
      if (!path || path.getLength() === 0) return;

      const bounds = new google.maps.LatLngBounds();
      for (let i = 0; i < path.getLength(); i += 1) {
        bounds.extend(path.getAt(i));
      }
      const center = bounds.getCenter();

      const rotatedPath = [];
      for (let i = 0; i < path.getLength(); i += 1) {
        const point = path.getAt(i);
        rotatedPath.push(this.GeometryUtils.rotatePoint(point, center, angle));
      }

      line.setPath(rotatedPath);

      if (typeof this.obstacleLineManager.updateBufferVisual === 'function') {
        this.obstacleLineManager.updateBufferVisual(line);
      }
      // Rafraîchir les panneaux sous l'obstacle après rotation
      if (this.obstaclePanels) {
        this.obstaclePanels.requestRefresh();
      }

      return;
    }

    // Obstacles polygones
    if (this.obstaclePolygonManager?.selectedObstaclePolygon) {
      const polygon = this.obstaclePolygonManager.selectedObstaclePolygon;
      const path = polygon.getPath();
      if (!path || path.getLength() === 0) return;

      const bounds = new google.maps.LatLngBounds();
      for (let i = 0; i < path.getLength(); i += 1) {
        bounds.extend(path.getAt(i));
      }
      const center = bounds.getCenter();

      const rotatedPath = [];
      for (let i = 0; i < path.getLength(); i += 1) {
        const point = path.getAt(i);
        rotatedPath.push(this.GeometryUtils.rotatePoint(point, center, angle));
      }

      polygon.setPath(rotatedPath);

      if (typeof this.obstaclePolygonManager.updateBufferVisual === 'function') {
        this.obstaclePolygonManager.updateBufferVisual(polygon);
      }
      // CORRECTIF : la rotation d'un polygone obstacle ne rafraîchissait jamais le masquage des
      // panneaux (contrairement aux obstacles lignes ci-dessus) — un panneau pouvait donc rester
      // masqué/visible à tort après une rotation tant qu'aucun autre événement (drag, etc.) ne
      // déclenchait un recalcul.
      if (this.obstaclePanels) {
        this.obstaclePanels.requestRefresh();
      }
      return;
    }

    // Textes : rotation via un transform CSS sur le contenu
    if (this.textManager?.selectedText) {
      const marker = this.textManager.selectedText;
      const div = marker.content;
      if (!div) return;

      const currentRotation =
        typeof marker._rotation === "number" ? marker._rotation : 0;
      const newRotation = currentRotation + angle;
      marker._rotation = newRotation;

      // Préserver d'autres styles éventuels en ajoutant la rotation
      const existingTransform = div.style.transform || "";
      const withoutRotate = existingTransform.replace(/rotate\([^)]*\)/g, "").trim();
      div.style.transform = `${withoutRotate} rotate(${newRotation}deg)`.trim();
    }
  }


  /**
   * Met à jour les inputs de grille
   * @param {string} pvId - Identifiant de la forme
   * @param {number} numCols - Nombre de colonnes
   * @param {number} numRows - Nombre de lignes
   */
  updateFormGridInputs(pvId, numCols, numRows, totalPanelLength, totalPanelWidth) {
    FormHandler.updateFormGridInputs(this, pvId, numCols, numRows, totalPanelLength, totalPanelWidth);
  }

  /**
   * Configure les écouteurs d'événements pour une forme
   * @param {google.maps.Polygon} shape - Forme à configurer
   */
  setupShapeListeners(shape) {
    ShapeHandler.setupShapeListeners(this, shape);
  }

  /**
   * Configure les écouteurs d'événements pour le formulaire
   * @param {google.maps.Polygon} shape - Forme associée au formulaire
   */
  setupFormListeners(shape) {
    FormHandler.setupFormListeners(this, shape);
  }

  /**
   * Méthode appelée lors de la suppression du contrôle de la carte
   */
  onRemove() {
    MeasurementControl.clearMeasurements(this);

    // Nettoyer les étiquettes permanentes
    if (this.permanentLabels && this.permanentLabels.length > 0) {
      this.permanentLabels.forEach(label => {
        if (label.marker) {
          label.marker.setMap(null);
        }
      });
      this.permanentLabels = [];
    }

    // Nettoyer les gestionnaires de formes
    this.lineManager.onRemove();
    this.circleManager.onRemove();
    this.textManager.onRemove();
    this.simpleRectangleManager.onRemove();
    this.simplePolygonManager.onRemove();
    this.lineToPolygon.onRemove();

    // Nettoyer les matériels électriques
    if (this.localisationMatElec) {
      this.localisationMatElec.stopMode();
      this.localisationMatElec.irveMarkers.forEach(m => m.setMap(null));
      this.localisationMatElec.organeMarkers.forEach(m => m.setMap(null));
      this.localisationMatElec.cables.forEach(c => c.setMap(null));
      this.localisationMatElec.irveMarkers = [];
      this.localisationMatElec.organeMarkers = [];
      this.localisationMatElec.cables = [];
    }

    // Nettoyer le gestionnaire de géocodage
    if (this.geocodingMarkerManager) {
      this.geocodingMarkerManager.stopMode();
      this.geocodingMarkerManager.clearAll();
    }

    this.drawnShapes.forEach(shape => shape.setMap(null));
    this.container.remove();
  }

  // Ajouter cette méthode pour nettoyer toutes les formes
  clearAllShapes() {
    // CORRECTIF (bug rapporté : "panneaux fantômes" du calepinage du projet précédent visibles sur
    // la carte en créant un nouveau projet, jusqu'à une actualisation manuelle de la page) : cette
    // méthode ne supprimait que le CONTOUR de chaque forme (shape.setMap(null)) — jamais la grille
    // de panneaux elle-même, qui vit dans 4 gestionnaires séparés selon l'outil de dessin utilisé
    // (lineToPolygon/polygonPanels/solarRectangle/shedPolygon, chacun avec son propre
    // createdPanelsByShape/pvId — même jeu d'appels que handleShapeDeleted() plus haut dans ce
    // fichier pour UNE forme supprimée individuellement, ici étendu à un nettoyage global : on
    // appelle les 4 gestionnaires pour chaque pvId sans distinguer le type de forme, chaque
    // cleanupPanelsForShape() étant déjà un no-op sûr si ce pvId ne lui appartient pas
    // (if (this.createdPanelsByShape.has(pvId))).
    this.drawnShapes.forEach(shape => {
      if (shape.pvId) {
        if (this.lineToPolygon && typeof this.lineToPolygon.cleanupPanelsForShape === 'function') {
          this.lineToPolygon.cleanupPanelsForShape(shape.pvId, { resetDeleted: true });
        }
        if (this.polygonPanels && typeof this.polygonPanels.cleanupPanelsForShape === 'function') {
          this.polygonPanels.cleanupPanelsForShape(shape.pvId);
        }
        if (this.solarRectangle && typeof this.solarRectangle.cleanupPanelsForShape === 'function') {
          this.solarRectangle.cleanupPanelsForShape(shape.pvId, { resetDeleted: true });
        }
        if (this.shedPolygon && typeof this.shedPolygon.cleanupPanelsForShape === 'function') {
          this.shedPolygon.cleanupPanelsForShape(shape.pvId);
        }
      }
    });

    // Supprimer toutes les formes
    this.drawnShapes.forEach(shape => {
      // Supprimer la forme
      shape.setMap(null);

      // Supprimer l'étiquette permanente
      if (shape.pvId) {
        MeasurementControl.removePermanentLabels(this, shape.pvId);
      }
    });

    this.drawnShapes = [];
    this.usedIds.clear();
    this.setSelection(null);

    // Purge des matériels électriques
    if (this.localisationMatElec) {
      this.localisationMatElec.irveMarkers.forEach(m => m.setMap(null));
      this.localisationMatElec.organeMarkers.forEach(m => m.setMap(null));
      this.localisationMatElec.cables.forEach(c => c.setMap(null));
      this.localisationMatElec.irveMarkers = [];
      this.localisationMatElec.organeMarkers = [];
      this.localisationMatElec.cables = [];
    }

    // Nettoyer le gestionnaire de géocodage
    if (this.geocodingMarkerManager) {
      this.geocodingMarkerManager.clearAll();
    }
  }

  /**
   * Efface la sélection actuelle
   */
  clearSelection() {
    if (this.cotationManager) this.cotationManager.deselect();
    // Champ PV du calepinage résidentiel : n'est plus la cible de Suppr (cf. polygon_maison.js).
    if (window.MaisonPolygonManagerInstance) window.MaisonPolygonManagerInstance.selectionActive = false;
    if (this.selectedShape) {
      this.selectedShape.setOptions({
        strokeColor: STYLES.DEFAULT_SHAPE.strokeColor,
        editable: false,
        draggable: false
      });
      
      if (this.selectedShape.type === SHAPE_TYPES.LINE_TO_POLYGON && this.lineToPolygon) {
        this.lineToPolygon.clearSideDetectors();
      }

      this.selectedShape = null;
    }

    // Formes simples (ligne, cercle, rectangle, polygone) : la désélection retire les poignées
    // d'édition mais les laisse déplaçables. Un glissé natif doit être autorisé AVANT le mousedown :
    // avec draggable:false, une forme désélectionnée ne pouvait plus jamais être déplacée (le clic
    // de re-sélection arrive après le mousedown, et les styles SELECTED_* ne le rétablissaient pas).
    if (this.lineManager.selectedLine) {
      this.lineManager.selectedLine.setOptions({
        strokeColor: STYLES.DEFAULT_LINE.strokeColor,
        strokeWeight: STYLES.DEFAULT_LINE.strokeWeight,
        editable: false,
        draggable: true
      });
      this.lineManager.selectedLine = null;
    }

    if (this.circleManager.selectedCircle) {
      this.circleManager.selectedCircle.setOptions({
        strokeColor: STYLES.DEFAULT_CIRCLE.strokeColor,
        strokeWeight: STYLES.DEFAULT_CIRCLE.strokeWeight,
        fillOpacity: STYLES.DEFAULT_CIRCLE.fillOpacity,
        editable: false,
        draggable: true
      });
      this.circleManager.selectedCircle = null;
    }

    if (this.textManager.selectedText) {
      Object.assign(this.textManager.selectedText.content.style, STYLES.DEFAULT_TEXT);
      this.textManager.selectedText = null;
    }
    if (this.simpleRectangleManager.selectedSimpleRectangle) {
      // Retire aussi la poignée de rotation du rectangle.
      this.simpleRectangleManager.deselect();
    }
    if (this.simplePolygonManager.selectedSimplePolygon) {
      this.simplePolygonManager.selectedSimplePolygon.setOptions({
        ...STYLES.DEFAULT_SIMPLE_POLYGON,
        editable: false,
        draggable: true
      });
      this.simplePolygonManager.selectedSimplePolygon = null;
    }
    if (this.obstacleCircleManager.selectedObstacleCircle) {
      this.obstacleCircleManager.selectedObstacleCircle.setOptions(STYLES.OBSTACLE_CIRCLE);
      this.obstacleCircleManager.selectedObstacleCircle = null;
    }

    if (this.obstacleRectangleManager.selectedObstacleRectangle) {
      this.obstacleRectangleManager.selectedObstacleRectangle.setOptions(STYLES.OBSTACLE_RECTANGLE);
      this.obstacleRectangleManager.selectedObstacleRectangle = null;
    }

    if (this.obstaclePolygonManager.selectedObstaclePolygon) {
      this.obstaclePolygonManager.selectedObstaclePolygon.setOptions(STYLES.OBSTACLE_POLYGON);
      this.obstaclePolygonManager.selectedObstaclePolygon = null;
    }

    if (this.obstacleLineManager?.selectedObstacleLine) {
      this.obstacleLineManager.selectedObstacleLine.setOptions(STYLES.OBSTACLE_LINE);
      this.obstacleLineManager.selectedObstacleLine = null;
    }
  }

  /**
   * Copie la forme sélectionnée
   */
  togglePasteMode() {
    if (this.isPasteMode) {
      // Désactiver le mode collage
      this.isPasteMode = false;
      this.map.setOptions({ draggableCursor: null });
      if (this.copyButton) {
        this.copyButton.classList.remove("selected");
        this.copyButton.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      }
      if (this.activeButton === this.copyButton) {
        this.activeButton = null;
      }
    } else {
      // Activer le mode collage si une forme est sélectionnée
      if (this.selectedShape) {
        // Désactiver le mode de dessin
        this.drawingManager.setDrawingMode(null);
        // Copier la forme sélectionnée dans le presse-papier
        this.copySelectedShape();
        this.isPasteMode = true;
        this.map.setOptions({ draggableCursor: 'copy' });
        if (this.copyButton) {
          this.copyButton.classList.add("selected");
          this.copyButton.style.backgroundColor = STYLES.SELECTED_BUTTON.backgroundColor;
        }
        // Désactiver les autres modes
        if (this.activeButton && this.activeButton !== this.copyButton) {
          this.activeButton.classList.remove('selected');
          this.activeButton.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
        }
        this.activeButton = this.copyButton;
      } else {
        this.errorModal.show("Veuillez d'abord sélectionner une forme à copier.");
      }
    }
  }

  copySelectedShape() {
    if (!this.selectedShape) return;

    try {
      // Stocker une copie profonde des données de la forme
      const path = this.selectedShape.getPath();
      const points = [];
      for (let i = 0; i < path.getLength(); i++) {
        const point = path.getAt(i);
        points.push({
          lat: point.lat(),
          lng: point.lng()
        });
      }

      // Obtenir les données du formulaire
      const pvId = this.selectedShape.pvId;
      const formValues = window.storageManager._collectFormValues(pvId);

      // Déterminer si les panneaux étaient visibles et copier l'état des panneaux supprimés
      let panelsWereVisible = false;
      let deletedPanelIndexes = new Set();

      if (this.selectedShape.type === SHAPE_TYPES.LINE_TO_POLYGON) {
        const panels = this.lineToPolygon.createdPanelsByShape.get(pvId) || [];
        panelsWereVisible = panels.length > 0 && panels.some(panel => panel.getMap());
        // Copier les panneaux supprimés
        if (this.lineToPolygon.deletedPanelIndexes.has(pvId)) {
          deletedPanelIndexes = new Set(this.lineToPolygon.deletedPanelIndexes.get(pvId));
        }
      } else if (this.selectedShape.type === SHAPE_TYPES.POLYGON) {
        const panels = this.polygonPanels.createdPanelsByShape.get(pvId) || [];
        panelsWereVisible = panels.length > 0 && panels.some(panel => panel.getMap());
        // Copier les panneaux supprimés
        if (this.polygonPanels.deletedPanelIndexes.has(pvId)) {
          deletedPanelIndexes = new Set(this.polygonPanels.deletedPanelIndexes.get(pvId));
        }
      } else if (this.selectedShape.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
        const panels = this.solarRectangle.createdPanelsByShape.get(pvId) || [];
        panelsWereVisible = panels.length > 0 && panels.some(panel => panel.getMap());
        // Copier les panneaux supprimés
        if (this.solarRectangle.deletedPanelIndexes.has(pvId)) {
          deletedPanelIndexes = new Set(this.solarRectangle.deletedPanelIndexes.get(pvId));
        }
      }


      // Stocker dans le presse-papier
      this.clipboard = {
        points: points,
        originalDimensions: { ...this.selectedShape._originalDimensions },
        rotation: this.selectedShape.rotation || 0,
        formValues: formValues,
        type: this.selectedShape.type,
        lengthIndices: this.selectedShape._lengthIndices || [],
        widthIndices: this.selectedShape._widthIndices || [],
        panelsWereVisible: panelsWereVisible, // Sauvegarder l'état de visibilité des panneaux
        deletedPanelIndexes: Array.from(deletedPanelIndexes), // Sauvegarder les panneaux supprimés
      };

      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_COPIED, {
        detail: { pvId: pvId }
      }));

    } catch (error) {
      console.error("Erreur lors de la copie de la forme:", error);
      this.errorModal.show("Erreur lors de la copie de la forme.");
    }
  }

  /**
   * Colle la forme copiée à une position donnée
   * @param {google.maps.LatLng} position - Position où coller la forme
   */
  pasteShape(position) {
    if (!this.clipboard) {
      this.errorModal.show("Aucune forme copiée dans le presse-papier.");
      return;
    }
    // AJOUT: Vérification du niveau de zoom
    if (this.map && this.map.getZoom() < DRAWING_CONSTANTS.MIN_ZOOM_LEVEL) {
      this.errorModal.show(`Le niveau de zoom est insuffisant pour coller une forme. Veuillez zoomer sur la carte.`);
      return;
    }
    try {
      // Calculer le déplacement nécessaire
      const bounds = new google.maps.LatLngBounds();
      this.clipboard.points.forEach(point => {
        bounds.extend(new google.maps.LatLng(point.lat, point.lng));
      });
      const oldCenter = bounds.getCenter();
      const deltaLat = position.lat() - oldCenter.lat();
      const deltaLng = position.lng() - oldCenter.lng();

      // Créer les nouveaux points déplacés
      const newPoints = this.clipboard.points.map(point => {
        return new google.maps.LatLng(
          point.lat + deltaLat,
          point.lng + deltaLng
        );
      });

      // Créer la nouvelle forme
      const isSolarRectangle = this.clipboard.type === SHAPE_TYPES.SOLAR_RECTANGLE;
      const shape = new google.maps.Polygon({
        paths: newPoints,
        fillColor: STYLES.DEFAULT_SHAPE.fillColor,
        fillOpacity: STYLES.DEFAULT_SHAPE.fillOpacity,
        strokeWeight: STYLES.DEFAULT_SHAPE.strokeWeight,
        strokeColor: STYLES.DEFAULT_SHAPE.strokeColor,
        strokeOpacity: STYLES.DEFAULT_SHAPE.strokeOpacity,
        zIndex: STYLES.DEFAULT_SHAPE.zIndex,
        editable: isSolarRectangle ? false : STYLES.DEFAULT_SHAPE.editable,
        draggable: STYLES.DEFAULT_SHAPE.draggable,
        map: this.map
      });

      // Générer un nouvel ID unique
      let id = 1;
      while (this.usedIds.has(`PV${id}`)) {
        id++;
      }
      const newPvId = `PV${id}`;
      shape.pvId = newPvId;
      this.usedIds.add(newPvId);

      // NOUVEAU : Si c'est un LineToPolygon, configurer les spécificités
      if (this.clipboard.type === SHAPE_TYPES.LINE_TO_POLYGON) {
        // Copier les indices de longueur/largeur pour les labels
        shape._lengthIndices = [...this.clipboard.lengthIndices];
        shape._widthIndices = [...this.clipboard.widthIndices];



        // Configurer les écouteurs pour la mise à jour des panneaux
        document.addEventListener(this.CUSTOM_EVENTS.SHAPE_ROTATED, (event) => {
          if (event.detail.pvId === shape.pvId && this.lineToPolygon.createdPanelsByShape.has(shape.pvId)) {
            this.lineToPolygon.updatePanelsPosition(shape);
          }
        });

        document.addEventListener(this.CUSTOM_EVENTS.SHAPE_MOVED, (event) => {
          if (event.detail.pvId === shape.pvId && this.lineToPolygon.createdPanelsByShape.has(shape.pvId)) {
            this.lineToPolygon.updatePanelsPosition(shape);
          }
        });


      }

      // NOUVEAU : Si c'est un SolarRectangle, configurer les spécificités
      if (this.clipboard.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
        // Configurer les écouteurs pour la mise à jour des panneaux
        document.addEventListener(this.CUSTOM_EVENTS.SHAPE_ROTATED, (event) => {
          if (event.detail.pvId === shape.pvId && this.solarRectangle.createdPanelsByShape.has(shape.pvId)) {
            this.solarRectangle.updatePanelsPosition(shape);
          }
        });

        document.addEventListener(this.CUSTOM_EVENTS.SHAPE_MOVED, (event) => {
          if (event.detail.pvId === shape.pvId && this.solarRectangle.createdPanelsByShape.has(shape.pvId)) {
            this.solarRectangle.updatePanelsPosition(shape);
          }
        });
      }


      // Copier les dimensions, rotation et type de la forme
      shape._originalDimensions = { ...this.clipboard.originalDimensions };
      shape.rotation = this.clipboard.rotation || 0;
      shape.type = this.clipboard.type;

      // Marquer comme étant en cours de collage pour éviter la création prématurée de panneaux
      shape._isBeingPasted = true;

      // Ajouter la forme à la liste des formes dessinées
      this.drawnShapes.push(shape);

      // Calculer le nouveau centre
      const newBounds = new google.maps.LatLngBounds();
      shape.getPath().forEach(point => newBounds.extend(point));
      const newCenter = newBounds.getCenter();

      // Déclencher SHAPE_ADDED DÈS MAINTENANT pour que le Tab et le formulaire existent
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_ADDED, {
        detail: {
          pvId: newPvId,
          dimensions: shape._originalDimensions,
          center: {
            lat: newCenter.lat(),
            lng: newCenter.lng()
          },
          shape
        }
      }));

      // Configurer les écouteurs d'événements
      this.setupShapeListeners(shape);

      // CORRECTION: Configurer les écouteurs spécifiques aux polygones
      if (this.clipboard.type === SHAPE_TYPES.POLYGON) {
        this.polygon.setupPolygonListeners(shape);
      }

      // NOUVEAU : Si c'est un SolarRectangle, appeler handlePanelShapeComplete pour initialiser correctement
      if (this.clipboard.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
        this.ShapeHandler.handlePanelShapeComplete(this, shape);
      }

      // CORRECTION: Configurer les écouteurs du formulaire immédiatement
      this.setupFormListeners(shape);

      // NOUVEAU : Si c'est un LineToPolygon, activer le redimensionnement par les côtés
      if (this.clipboard.type === SHAPE_TYPES.LINE_TO_POLYGON) {
        this.lineToPolygon.enableSideResizing(shape);
      }

      // Copier les valeurs du formulaire après création du Tab/Form
      setTimeout(async () => {
        try {
          // Restaurer les valeurs du formulaire
          Object.entries(FORM_FIELDS_MAPPING).forEach(([fieldId, formValue]) => {
            const input = document.querySelector(`#${fieldId}-${newPvId}`);
            if (input && this.clipboard.formValues[formValue] !== undefined) {
              // Ne PAS déclencher de changement pour longueur/largeur afin d'éviter la conversion en rectangle
              if (fieldId === 'longueur' || fieldId === 'largeur') {
                input.value = this.clipboard.formValues[formValue];
                // aucune émission d'événement ici
              } else if (fieldId !== 'modePosePortrait' && fieldId !== 'modePosePaysage') {
                input.value = this.clipboard.formValues[formValue];
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          });

          // Gérer spécifiquement les boutons radio pour l'orientation
          const portraitInput = document.querySelector(`#modePosePortrait-${newPvId}`);
          const paysageInput = document.querySelector(`#modePosePaysage-${newPvId}`);

          if (portraitInput && paysageInput) {
            if (this.clipboard.formValues.modePosePortrait) {
              portraitInput.checked = true;
              paysageInput.checked = false;
              portraitInput.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (this.clipboard.formValues.modePosePaysage) {
              paysageInput.checked = true;
              portraitInput.checked = false;
              paysageInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }

          // Calculer et renseigner nbColonne/nbLigne pour que TabsManager ait des valeurs valides
          try {
            const numberOfPanels = this.GeometryUtils.calculateNumberOfPanels(shape, this.panelOrientation);
            this.FormHandler.updateFormGridInputs(
              newPvId,
              numberOfPanels.numCols,
              numberOfPanels.numRows,
              numberOfPanels.totalPanelLength,
              numberOfPanels.totalPanelWidth
            );
          } catch (e) {
            console.warn('Impossible de calculer le nombre de panneaux pour', newPvId, e);
          }

          // Sauvegarder pour rendre les données disponibles immédiatement
          try { await window.storageManager.savePageData(); } catch (e) { }


          // Gérer spécifiquement les boutons radio pour le support PV
          const supportInclineInput = document.querySelector(`#supportIncline-${newPvId}`);
          const supportPlatInput = document.querySelector(`#supportPlat-${newPvId}`);
          const supportShedInput = document.querySelector(`#supportShed-${newPvId}`);

          if (supportInclineInput && supportPlatInput && supportShedInput && this.clipboard.formValues.supportPv) {
            if (this.clipboard.formValues.supportPv === 'incline') {
              supportInclineInput.checked = true;
              supportInclineInput.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (this.clipboard.formValues.supportPv === 'plat') {
              supportPlatInput.checked = true;
              supportPlatInput.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (this.clipboard.formValues.supportPv === 'shed') {
              supportShedInput.checked = true;
              supportShedInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }



          // Mettre à jour les métriques (créera les labels et lira la puissance depuis le stockage)
          MeasurementControl.updateMetrics(this, shape, true);

          // Déclencher l'événement de collage
          document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_PASTED, {
            detail: { pvId: newPvId }
          }));


          // Retirer le flag de collage pour permettre la création de panneaux lors des futures transformations
          shape._isBeingPasted = false;

          // Appliquer l'état de visibilité des panneaux de l'original
          if (this.clipboard.panelsWereVisible) {
            // Attendre un peu que les écouteurs soient configurés
            setTimeout(() => {
              if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON) {
                this.lineToPolygon.createSolarPanels(shape);
              } else if (shape.type === SHAPE_TYPES.POLYGON) {
                this.polygonPanels.createPanels(shape);
              } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
                // Initialiser les indices supprimés pour la nouvelle forme
                this.solarRectangle.initializeDeletedIndicesForShape(shape.pvId);
                this.solarRectangle.createSolarPanels(shape);
                // Configurer les écouteurs de cycle de vie
                this.solarRectangle.bindShapeLifecycle(shape);
              }

              // Appliquer l'état des panneaux supprimés
              if (this.clipboard.deletedPanelIndexes && this.clipboard.deletedPanelIndexes.length > 0) {
                const deletedIndexes = new Set(this.clipboard.deletedPanelIndexes);
                if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON) {
                  this.lineToPolygon.deletedPanelIndexes.set(shape.pvId, deletedIndexes);
                } else if (shape.type === SHAPE_TYPES.POLYGON) {
                  this.polygonPanels.deletedPanelIndexes.set(shape.pvId, deletedIndexes);
                } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
                  this.solarRectangle.deletedPanelIndexes.set(shape.pvId, deletedIndexes);
                  // Sauvegarder les panneaux supprimés dans le stockage
                  deletedIndexes.forEach(panelIndex => {
                    DeletedPanelsStorage.add({
                      pvId: shape.pvId,
                      panelIndex: panelIndex,
                      shapeType: SHAPE_TYPES.SOLAR_RECTANGLE,
                    });
                  });
                }

                // Recréer les panneaux pour appliquer les suppressions
                setTimeout(() => {
                  if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON) {
                    this.lineToPolygon.updatePanelsPosition(shape);
                  } else if (shape.type === SHAPE_TYPES.POLYGON) {
                    this.polygonPanels.updatePanelsPosition(shape);
                  } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
                    this.solarRectangle.updatePanelsPosition(shape);
                  }
                }, 50);
              }
            }, 100);
          }

          // Sélectionner la nouvelle forme
          this.setSelection(shape);
        } catch (error) {
          console.error("Erreur lors de la restauration des valeurs du formulaire:", error);
        }
      }, 300);
    } catch (error) {
      console.error("Erreur lors du collage de la forme:", error);
      this.errorModal.show("Erreur lors du collage de la forme.");
    } finally {
      // Désactiver le mode collage après la tentative
      this.togglePasteMode();
    }
  }

  /**
   * Active/désactive le mode de dessin ligne vers polygone
   * @param {HTMLElement} button - Bouton de dessin
   */
  toggleLineToPolygonMode(button) {
    this.lineToPolygon.toggleMode(button);
  }

  /**
   * Active/désactive le mode de dessin de polygone pour sheds.
   * @param {HTMLElement} button - Le bouton qui active le mode.
   */
  toggleShedPolygonMode(button) {
    if (this.shedPolygon) {
      this.shedPolygon.toggleMode(button);
    }
  }

  /**
     * Active/désactive le mode de dessin SolarRectangle (rectangles PV)
     * @param {HTMLElement} button - Bouton de dessin
     */
  toggleSolarRectangleMode(button) {
    this.solarRectangle.toggleMode(button);
  }

  /**
* Active/désactive le mode de dessin de polygone
* @param {HTMLElement} button - Bouton de dessin
*/
  togglePolygonMode(button) {
    this.polygon.toggleMode(button);
  }

  /**
  /**
   * Active/désactive le mode dessin de rectangle simple
   * @param {HTMLElement} button - Bouton de dessin
   */
  toggleSimpleRectangleMode(button) {
    // Si le mode est déjà actif, le désactiver
    if (this.activeButton === button) {
      this.simpleRectangleMode = false;
      if (this.terraDrawEngine) this.terraDrawEngine.stop();
      button.classList.remove('selected');
      button.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      this.activeButton = null;
      this.map.setOptions({ draggableCursor: null });
    } else {
      // Désactiver le bouton précédent
      if (this.activeButton) {
        this.activeButton.classList.remove('selected');
        this.activeButton.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;

        if (this._textClickListener) {
          google.maps.event.removeListener(this._textClickListener);
          this._textClickListener = null;
        }
      }

      // Activer le mode rectangle simple
      button.classList.add('selected');
      button.style.backgroundColor = STYLES.SELECTED_BUTTON.backgroundColor;
      this.activeButton = button;
      this.simpleRectangleMode = true;
      if (this.terraDrawEngine) {
        this.terraDrawEngine.start('simple-rectangle', (rectangle) => {
          const shape = this.simpleRectangleManager.handleSimpleRectangleComplete(rectangle);
          shape.type = SHAPE_TYPES.SIMPLE_RECTANGLE;
          this.finishDrawingSession();
        });
      }
      this.map.setOptions({ draggableCursor: 'crosshair' });
    }
  }

  /**
   * Active/désactive le mode de dessin de polygone simple
   * @param {HTMLElement} button - Bouton du polygone simple
   */
  toggleSimplePolygonMode(button) {
    // Si le bouton est déjà actif, le désactiver
    if (this.simplePolygonMode) {
      this.simplePolygonMode = false;
      if (this.terraDrawEngine) this.terraDrawEngine.stop();
      button.classList.remove('selected');
      button.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      this.activeButton = null;
      this.map.setOptions({ draggableCursor: null });
      return;
    }

    // Désactiver tous les autres boutons actifs
    if (this.activeButton) {
      this.activeButton.classList.remove('selected');
      this.activeButton.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      this.activeButton = null;
    }

    // Activer le mode polygone simple
    this.simplePolygonMode = true;
    button.classList.add('selected');
    button.style.backgroundColor = STYLES.SELECTED_BUTTON.backgroundColor;
    this.activeButton = button;
    if (this.terraDrawEngine) {
      this.terraDrawEngine.start('simple-polygon', (polygon) => {
        const shape = this.simplePolygonManager.handleSimplePolygonComplete(polygon);
        shape.type = SHAPE_TYPES.SIMPLE_POLYGON;
        this.finishDrawingSession();
      });
    }
    this.map.setOptions({ draggableCursor: 'crosshair' });
  }

  /**
   * Active/désactive le mode de dessin de ligne simple
   * @param {HTMLElement} button - Bouton de la ligne simple
   */
  toggleSimpleLineMode(button) {
    if (this.activeButton === button) {
      if (this.terraDrawEngine) this.terraDrawEngine.stop();
      button.classList.remove('selected');
      button.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      this.activeButton = null;
      this.map.setOptions({ draggableCursor: null });
      return;
    }

    if (this.activeButton) {
      this.activeButton.classList.remove('selected');
      this.activeButton.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      if (this._textClickListener) {
        google.maps.event.removeListener(this._textClickListener);
        this._textClickListener = null;
      }
    }

    button.classList.add('selected');
    button.style.backgroundColor = STYLES.SELECTED_BUTTON.backgroundColor;
    this.activeButton = button;
    if (this.terraDrawEngine) {
      this.terraDrawEngine.start('simple-line', (polyline) => {
        polyline.type = SHAPE_TYPES.POLYLINE;
        this.lineManager.handleLineComplete(polyline);
        this.drawnShapes.push(polyline);
        this.finishDrawingSession();
      });
    }
    this.map.setOptions({ draggableCursor: 'crosshair' });
  }

  /**
   * Active/désactive le tracé d'une ligne de cotation (flèches aux deux extrémités). Même moteur
   * que la ligne simple (Terra Draw, mode 'simple-line') : cliquer le point de départ puis le point
   * d'arrivée, double-clic pour terminer. Seuls le premier et le dernier point sont gardés.
   * @param {HTMLElement} button - Bouton de la palette (ou du modal DP) qui déclenche le mode
   * @param {Function} [onComplete] - rappel optionnel après création de la cotation
   */
  toggleCotationMode(button, onComplete) {
    if (this.activeButton === button) {
      if (this.terraDrawEngine) this.terraDrawEngine.stop();
      button.classList.remove('selected');
      button.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      this.activeButton = null;
      this.map.setOptions({ draggableCursor: null });
      return;
    }

    if (this.activeButton) {
      this.activeButton.classList.remove('selected');
      this.activeButton.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      if (this._textClickListener) {
        google.maps.event.removeListener(this._textClickListener);
        this._textClickListener = null;
      }
    }

    button.classList.add('selected');
    button.style.backgroundColor = STYLES.SELECTED_BUTTON.backgroundColor;
    this.activeButton = button;
    if (this.terraDrawEngine) {
      this.terraDrawEngine.start('simple-line', (polyline) => {
        polyline.type = SHAPE_TYPES.POLYLINE;
        this.cotationManager.handleLineComplete(polyline);
        this.finishDrawingSession();
        if (typeof onComplete === 'function') onComplete(polyline);
      });
    }
    this.map.setOptions({ draggableCursor: 'crosshair' });
  }

  /**
   * Active/désactive le mode de dessin de cercle simple
   * @param {HTMLElement} button - Bouton du cercle simple
   */
  toggleSimpleCircleMode(button) {
    if (this.activeButton === button) {
      if (this.terraDrawEngine) this.terraDrawEngine.stop();
      button.classList.remove('selected');
      button.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      this.activeButton = null;
      this.map.setOptions({ draggableCursor: null });
      return;
    }

    if (this.activeButton) {
      this.activeButton.classList.remove('selected');
      this.activeButton.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      if (this._textClickListener) {
        google.maps.event.removeListener(this._textClickListener);
        this._textClickListener = null;
      }
    }

    button.classList.add('selected');
    button.style.backgroundColor = STYLES.SELECTED_BUTTON.backgroundColor;
    this.activeButton = button;
    if (this.terraDrawEngine) {
      this.terraDrawEngine.start('simple-circle', (circle) => {
        circle.type = SHAPE_TYPES.CIRCLE;
        this.circleManager.handleCircleComplete(circle);
        this.drawnShapes.push(circle);
        this.finishDrawingSession();
      });
    }
    this.map.setOptions({ draggableCursor: 'crosshair' });
  }

  /**
  * Crée une forme de décalage à partir de la forme sélectionnée
  * @param {number} offsetDistance - Distance de décalage en mètres (positive = intérieur, négative = extérieur)
  */
  createOffsetShape(offsetDistance) {
    // Vérifier qu'une forme simple est sélectionnée
    if (this.simpleRectangleManager.selectedSimpleRectangle) {
      this.createOffsetRectangle(this.simpleRectangleManager.selectedSimpleRectangle, offsetDistance);
    } else if (this.lineManager.selectedLine) {
      this.createOffsetLine(this.lineManager.selectedLine, offsetDistance);
    } else if (this.circleManager.selectedCircle) {
      this.createOffsetCircle(this.circleManager.selectedCircle, offsetDistance);
    } else if (this.simplePolygonManager.selectedSimplePolygon) {
      this.createOffsetPolygon(this.simplePolygonManager.selectedSimplePolygon, offsetDistance);
    } else {
      this.errorModal.show('Veuillez sélectionner une forme simple (ligne, cercle, rectangle ou polygone)');
    }
  }

  /**
   * Crée un rectangle décalé à partir d'un rectangle existant
   * @param {google.maps.Rectangle} rectangle - Rectangle source
   * @param {number} offsetDistance - Distance de décalage en mètres
   */
  createOffsetRectangle(rectangle, offsetDistance) {
    try {
      // Même centre et même orientation que le rectangle source (qui peut être pivoté).
      const { center, width, height, heading } = this.simpleRectangleManager.measure(rectangle);

      // Positif = intérieur (plus petit), négatif = extérieur (plus grand)
      const newWidth = width - (2 * offsetDistance);
      const newHeight = height - (2 * offsetDistance);

      if (newWidth <= 0 || newHeight <= 0) {
        this.errorModal.show('Le décalage est trop important. La forme résultante serait invalide.');
        return;
      }

      const newRectangle = new google.maps.Polygon({
        paths: SimpleRectangle.rectanglePoints(center, newWidth, newHeight, heading),
        ...STYLES.INBOUND_SIMPLE_RECTANGLE,
        map: this.map
      });
      newRectangle.solak_isInbound = true;
      this.simpleRectangleManager.handleSimpleRectangleComplete(newRectangle, true);

      window.storageManager.savePageData();

    } catch (error) {
      console.error('Erreur lors de la création du rectangle décalé:', error);
      this.errorModal.show('Erreur lors de la création du rectangle décalé.');
    }
  }

  /**
   * Crée un cercle décalé à partir d'un cercle existant
   * @param {google.maps.Circle} circle - Cercle source
   * @param {number} offsetDistance - Distance de décalage en mètres
   */
  createOffsetCircle(circle, offsetDistance) {
    try {
      const center = circle.getCenter();
      const currentRadius = circle.getRadius(); // en mètres

      // Calculer le nouveau rayon
      // Positif = intérieur (plus petit), donc on soustrait
      // Négatif = extérieur (plus grand), donc on ajoute
      const newRadius = currentRadius - offsetDistance;

      // Vérifier que le rayon reste positif
      if (newRadius <= 0) {
        this.errorModal.show('Le décalage est trop important. Le cercle résultant serait invalide.');
        return;
      }

      // Créer le nouveau cercle
      const newCircle = new google.maps.Circle({
        center: center,
        radius: newRadius,
        ...STYLES.DEFAULT_CIRCLE,
        map: this.map
      });

      // Le handleCircleComplete s'occupera du reste
      this.circleManager.handleCircleComplete(newCircle);

      // Sauvegarder
      window.storageManager.savePageData();

    } catch (error) {
      console.error('Erreur lors de la création du cercle décalé:', error);
      this.errorModal.show('Erreur lors de la création du cercle décalé.');
    }
  }

  /**
   * Crée un polygone décalé à partir d'un polygone existant
   * @param {google.maps.Polygon} polygon - Polygone source
   * @param {number} offsetDistance - Distance de décalage en mètres
   */
  createOffsetPolygon(polygon, offsetDistance) {
    try {
      const path = polygon.getPath();
      const points = [];

      // Récupérer tous les points du polygone
      for (let i = 0; i < path.getLength(); i++) {
        points.push(path.getAt(i));
      }

      if (points.length < 3) {
        this.errorModal.show('Le polygone doit avoir au moins 3 points.');
        return;
      }

      // Calculer le centre du polygone (centroïde)
      let centerLat = 0;
      let centerLng = 0;

      points.forEach(point => {
        centerLat += point.lat();
        centerLng += point.lng();
      });

      centerLat /= points.length;
      centerLng /= points.length;

      const center = new google.maps.LatLng(centerLat, centerLng);

      // Calculer les nouveaux points décalés
      const offsetPoints = [];

      for (let i = 0; i < points.length; i++) {
        const point = points[i];

        // Calculer la distance actuelle entre le centre et le point
        const currentDistance = google.maps.geometry.spherical.computeDistanceBetween(center, point);

        // Calculer le bearing (direction) du centre vers le point
        const bearing = google.maps.geometry.spherical.computeHeading(center, point);

        // Calculer la nouvelle distance
        // Positif = intérieur (plus petit), donc on soustrait
        // Négatif = extérieur (plus grand), donc on ajoute
        const newDistance = currentDistance - offsetDistance;

        // Vérifier que la distance reste positive
        if (newDistance <= 0) {
          this.errorModal.show('Le décalage est trop important. Le polygone résultant serait invalide.');
          return;
        }

        // Créer le nouveau point à la nouvelle distance dans la même direction
        const newPoint = google.maps.geometry.spherical.computeOffset(
          center,
          newDistance,
          bearing
        );

        offsetPoints.push(newPoint);
      }

      // Vérifier que le polygone résultant a une aire valide
      const newPath = new google.maps.MVCArray(offsetPoints);
      const area = google.maps.geometry.spherical.computeArea(newPath);

      if (area < 1) {
        this.errorModal.show('Le décalage est trop important. Le polygone résultant serait invalide.');
        return;
      }

      // Créer le nouveau polygone
      const newPolygon = new google.maps.Polygon({
        paths: offsetPoints,
        ...STYLES.DEFAULT_SIMPLE_POLYGON,
        map: this.map
      });

      // Le handleSimplePolygonComplete s'occupera du reste
      this.simplePolygonManager.handleSimplePolygonComplete(newPolygon);

      // Sauvegarder
      window.storageManager.savePageData();

    } catch (error) {
      console.error('Erreur lors de la création du polygone décalé:', error);
      this.errorModal.show('Erreur lors de la création du polygone décalé.');
    }
  }

  /**
   * Crée une ligne décalée à partir d'une ligne existante
   * @param {google.maps.Polyline} line - Ligne source
   * @param {number} offsetDistance - Distance de décalage en mètres
   */
  createOffsetLine(line, offsetDistance) {
    try {
      const path = line.getPath();
      const points = [];

      // Récupérer tous les points de la ligne
      for (let i = 0; i < path.getLength(); i++) {
        points.push(path.getAt(i));
      }

      if (points.length < 2) {
        this.errorModal.show('La ligne doit avoir au moins 2 points.');
        return;
      }

      // Calculer les nouveaux points décalés perpendiculairement
      const offsetPoints = [];

      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        let bearing;

        if (i === 0) {
          // Premier point : utiliser la direction vers le point suivant
          bearing = google.maps.geometry.spherical.computeHeading(point, points[i + 1]);
        } else if (i === points.length - 1) {
          // Dernier point : utiliser la direction depuis le point précédent
          bearing = google.maps.geometry.spherical.computeHeading(points[i - 1], point);
        } else {
          // Points intermédiaires : utiliser la moyenne des directions
          const bearing1 = google.maps.geometry.spherical.computeHeading(points[i - 1], point);
          const bearing2 = google.maps.geometry.spherical.computeHeading(point, points[i + 1]);
          bearing = (bearing1 + bearing2) / 2;
        }

        // Calculer le bearing perpendiculaire
        // Pour un décalage "vers la droite" (positif), on ajoute 90°
        // Pour un décalage "vers la gauche" (négatif), on soustrait 90°
        const perpendicularBearing = bearing + (offsetDistance > 0 ? 90 : -90);

        // Créer le nouveau point décalé perpendiculairement
        const newPoint = google.maps.geometry.spherical.computeOffset(
          point,
          Math.abs(offsetDistance),
          perpendicularBearing
        );

        offsetPoints.push(newPoint);
      }

      // Créer la nouvelle ligne
      const newLine = new google.maps.Polyline({
        path: offsetPoints,
        ...STYLES.DEFAULT_LINE,
        map: this.map
      });

      // Le handleLineComplete s'occupera du reste
      this.lineManager.handleLineComplete(newLine);

      // Sauvegarder
      window.storageManager.savePageData();

    } catch (error) {
      console.error('Erreur lors de la création de la ligne décalée:', error);
      this.errorModal.show('Erreur lors de la création de la ligne décalée.');
    }
  }


  /**
* Affiche ou masque les panneaux solaires pour une forme sélectionnée
* @param {google.maps.Polygon} shape - La forme sélectionnée
*/
  toggleSolarPanelsVisibility(shape) {
    if (!shape || !shape.pvId) return;

    // Vérifier si c'est un LineToPolygon
    if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON) {
      const pvId = shape.pvId;
      const panels = this.lineToPolygon.createdPanelsByShape.get(pvId) || [];

      // Vérifier s'il y a déjà des panneaux visibles pour cette forme
      const hasVisiblePanels = panels.some(panel => panel.getMap());

      if (hasVisiblePanels) {
        // Masquer les panneaux de cette forme uniquement
        panels.forEach(panel => {
          panel.setMap(null);
        });
        this.lineToPolygon.hiddenByToggle.add(pvId);
      } else {
        // Afficher les panneaux de
        //  cette forme
        if (panels.length === 0) {
          // Créer les panneaux s'ils n'existent pas pour cette forme
          this.lineToPolygon.createSolarPanels(shape);
        } else {
          // Réafficher les panneaux existants de cette forme
          panels.forEach(panel => {
            panel.setMap(this.map);
          });
        }
        this.lineToPolygon.hiddenByToggle.delete(pvId);
      }
      // Toujours réappliquer le masquage obstacle pour les LineToPolygon
      if (this.obstaclePanels) {
        this.obstaclePanels.requestRefresh();
      }
    }
    // Gérer les polygones natifs via le gestionnaire dédié (polymorphisme)
    else if (shape.type === SHAPE_TYPES.POLYGON) {
      this.polygonPanels.togglePanelsVisibility(shape);
    } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
      const pvId = shape.pvId;
      const panels = this.solarRectangle.createdPanelsByShape.get(pvId) || [];
      const hasVisiblePanels = panels.some(panel => panel.getMap());
      if (hasVisiblePanels) {
        panels.forEach(panel => panel.setMap(null));
        if (this.solarRectangle?.hiddenByToggle) {
          this.solarRectangle.hiddenByToggle.add(pvId);
        }
      } else {
        if (panels.length === 0) {
          this.solarRectangle.createSolarPanels(shape);
        } else {
          panels.forEach(panel => panel.setMap(this.map));
        }
        if (this.solarRectangle?.hiddenByToggle) {
          this.solarRectangle.hiddenByToggle.delete(pvId);
        }
      }

      // Toujours réappliquer le masquage obstacle pour les SolarRectangle
      if (this.obstaclePanels) {
        this.obstaclePanels.requestRefresh();
      }
    }
  }


  /**
   * Ajuste l'orientation des panneaux d'une forme sélectionnée
   * @param {number} rotationDeltaDegrees - Variation en degrés (positive = droite)
   */
  rotatePanelsOrientation(rotationDeltaDegrees) {
    const shape = this.selectedShape;
    const supportedTypes = [
      SHAPE_TYPES.LINE_TO_POLYGON,
      SHAPE_TYPES.POLYGON,
      SHAPE_TYPES.SOLAR_RECTANGLE,
    ];

    if (!shape || !shape.pvId) {
      this.errorModal.show("Veuillez sélectionner une surface avant de faire pivoter les panneaux.");
      return;
    }

    if (!supportedTypes.includes(shape.type)) {
      console.warn("Rotation des panneaux non disponible pour ce type de forme.");
      return;
    }

    const delta = typeof rotationDeltaDegrees === "number" ? rotationDeltaDegrees : 0;
    if (delta === 0) return;

    const currentRotation = typeof shape.panelsRotation === "number" ? shape.panelsRotation : 0;
    let updatedRotation = currentRotation + delta;
    if (!Number.isFinite(updatedRotation)) {
      updatedRotation = 0;
    }

    const normalized = ((updatedRotation % 360) + 360) % 360;
    shape.panelsRotation = normalized > 180 ? normalized - 360 : normalized;

    if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && this.lineToPolygon) {
      this.lineToPolygon.updatePanelsPosition(shape);
    } else if (shape.type === SHAPE_TYPES.POLYGON && this.polygonPanels) {
      this.polygonPanels.updatePanelsPosition(shape);
    } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && this.solarRectangle) {
      this.solarRectangle.updatePanelsPosition(shape);
    }

    document.dispatchEvent(
      new CustomEvent(CUSTOM_EVENTS.PANEL_ORIENTATION_CHANGED, {
        detail: {
          pvId: shape.pvId,
          rotation: shape.panelsRotation,
        },
      })
    );

    if (window.storageManager && typeof window.storageManager.savePageData === "function") {
      Promise.resolve()
        .then(() => window.storageManager.savePageData())
        .catch(() => { });
    }
  }


  /**
   * Calcule et met à jour les inputs sans créer de panneaux
   * @param {google.maps.Polygon} shape - La forme
   */
  calculateAndUpdatePanelInputs(shape) {
    const pvId = shape.pvId;

    // Calculer les dimensions du rectangle principal
    const path = shape.getPath();
    const corner1 = path.getAt(0);
    const corner2 = path.getAt(1);
    const corner3 = path.getAt(2);

    const mainLength = google.maps.geometry.spherical.computeDistanceBetween(corner1, corner2);
    const mainWidth = google.maps.geometry.spherical.computeDistanceBetween(corner2, corner3);

    const portraitInput = document.querySelector(`#modePosePortrait-${pvId}`);
    const paysageInput = document.querySelector(`#modePosePaysage-${pvId}`);
    const isPortrait = portraitInput ? portraitInput.checked : false;
    const isPaysage = paysageInput ? paysageInput.checked : false;

    // CORRECTIF : ce garde-fou (pas de calcul avant sélection explicite de l'orientation) coupait
    // court AVANT même d'atteindre le bloc "accurateCols/accurateRows" plus bas — qui sait pourtant
    // déjà lire un compte exact déjà calculé par le moteur de panneaux (_calculatedPanelsLength/
    // Width, posé par LineToPolygon::createSolarPanels dès la fin du tracé, indépendamment de
    // l'orientation Portrait/Paysage). Résultat : le nombre de panneaux repassait à 0 ~600ms après
    // un dessin, avant que l'utilisateur n'ait eu le temps de cocher Portrait/Paysage. On ne
    // retourne donc désormais que si aucun compte exact n'est encore disponible.
    if (!isPortrait && !isPaysage && shape._calculatedPanelsLength === undefined) {
      // Aucun calcul avant que l'orientation ne soit sélectionnée
      if (document.querySelector(`#nbColonne-${pvId}`)) document.querySelector(`#nbColonne-${pvId}`).value = 0;
      if (document.querySelector(`#nbLigne-${pvId}`)) document.querySelector(`#nbLigne-${pvId}`).value = 0;
      return;
    }

    // Récupérer la config des panneaux (avec valeurs par défaut)
    const defaultConfig = {
      length: 2.0,    // 2000mm en mètres
      width: 1.0,     // 1000mm en mètres
      spacingX: 0.0, // 10mm en mètres
      spacingY: 0.0  // 10mm en mètres
    };

    // FIX: Récupérer les valeurs exactes calculées par la grille de panneaux si disponibles
    // Cela évite d'écraser les calculs complexes (Sheds, rampants) par un calcul naïf de 2x1m
    let accurateCols = shape._calculatedPanelsLength;
    let accurateRows = shape._calculatedPanelsWidth;

    if (accurateCols === undefined || accurateRows === undefined) {
      // Fallback au calcul naïf uniquement si les données exactes ne sont pas encore disponibles
      accurateCols = Math.floor(mainLength / (defaultConfig.length + defaultConfig.spacingX));
      accurateRows = Math.floor(mainWidth / (defaultConfig.width + defaultConfig.spacingY));
    }

    // Mettre à jour les inputs
    const nbColonne = document.querySelector(`#nbColonne-${pvId}`);
    const nbLigne = document.querySelector(`#nbLigne-${pvId}`);
    const dimLongueur = document.querySelector(`#dimensionsChampPVlongueur-${pvId}`);
    const dimLargeur = document.querySelector(`#dimensionsChampPVlargeur-${pvId}`);

    if (nbColonne) {
      nbColonne.value = accurateCols;
    }
    if (nbLigne) {
      nbLigne.value = accurateRows;
    }
    if (dimLongueur) {
      dimLongueur.value = mainLength.toFixed(2);
    }
    if (dimLargeur) {
      dimLargeur.value = mainWidth.toFixed(2);
    }

      // Forcer la sauvegarde et le rafraîchissement du modal de résumé avec les valeurs corrigées
      if (window.storageManager && typeof window.storageManager.savePageData === 'function') {
        window.storageManager.savePageData();
      }
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER, {
        detail: { pvId: pvId }
      }));
  }
}

export default DrawingControl; 