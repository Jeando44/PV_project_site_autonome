// Constantes globales pour le module DrawingControl

// Constantes géographiques
export const EARTH_RADIUS = 6371000; // Rayon de la Terre en mètres
export const METERS_PER_LAT_DEGREE = 111111; // Mètres par degré de latitude
export const MARGIN_COLOR = '#FF9900'; // Couleur de la marge des bordures ( décallage du bord)

// Constantes pour les panneaux solaires
export let PANEL_DIMENSIONS = {
  DEFAULT_LENGTH: 0, // Longueur par défaut en mm - Forcer le choix utilisateur
  MIN_LENGTH: 1000, // Longueur minimale en mm
  DEFAULT_WIDTH: 0,  // Largeur par défaut en mm - Forcer le choix utilisateur
  MIN_WIDTH: 800, // Largeur minimale en mm
  DEFAULT_THICKNESS: 30, // Épaisseur par défaut en mm
  MIN_THICKNESS: 30, // Épaisseur minimale en mm
  MIN_SPACING: 0, // Espacement minimal entre les panneaux en mm
  DEFAULT_SPACING_MM: 20, // Espacement PV X/Y par défaut en mm (cf. FormHandler.setupFormListeners, LineToPolygon.getPanelConfigFromForm)
  MARGIN_VISUAL_OFFSET: 0.01  // Offset visuel pour la zone de marge (en mètres)
};

// Constantes pour le dessin
export const DRAWING_CONSTANTS = {
  MIN_ZOOM_LEVEL: 18,
  MIN_SHAPE_DIMENSION: 1.5, // Dimension minimale en mètres
  // Surface max autorisée pour une forme (polygone/rectangle) avant insertion des panneaux — au-delà,
  // le navigateur peut geler (boucles de génération de panneaux sans borne supérieure, cf.
  // PolygonPanelsManager.js::createPanels / SolarRectangle.js/LineToPolygon.js::createSolarPanels).
  MAX_SHAPE_AREA_M2: 25000,
  ROTATION_STEP: 0.5, // Pas de rotation en degrés
  PANEL_ROTATION_STEP: 1, // Pas de rotation des panneaux en degrés
  DEBOUNCE_TIMEOUT: 100, // Délai de debounce en ms
  LINE_ID_PREFIX: 'Ligne-', // Préfixe pour les IDs des lignes
  CIRCLE_ID_PREFIX: 'Cercle-', // Préfixe pour les IDs des cercles
  TEXT_ID_PREFIX: 'Texte-',
  SIMPLE_RECTANGLE_ID_PREFIX: 'Rectangle-', // Préfixe pour les IDs des rectangles
  SIMPLE_POLYGON_ID_PREFIX: 'Polygone-', // Préfixe pour les IDs des polygones simples
  DEFAULT_POLYGON_WIDTH: 10 // Largeur par défaut en mètres pour line-to-polygon
};

// Constantes pour les styles
export const STYLES = {
  SELECTED_SHAPE: {
    strokeColor: '#FF4081', // light red
  },
  DEFAULT_SHAPE: {
    fillColor: '#26619c', // blue
    fillOpacity: 0.6,
    strokeWeight: 2,
    strokeColor: '#FFEB3B', // yellow
    strokeOpacity: 1,
    zIndex: 10,
    editable: true,
    draggable: true
  },
  SOLAR_PANEL: {
    fillColor: '#1A1A1A',
    fillOpacity: 0.5,
    strokeColor: '#1A1A1A',
    strokeOpacity: 0.8,
    strokeWeight: 0.8,
    zIndex: 11
  },
  DEFAULT_LINE: {
    strokeColor: '#4CAF50', // green
    strokeWeight: 3,
    strokeOpacity: 1,
    // Au-dessus des champs PV (zIndex 5, 6 sélectionné), comme les rectangles/polygones simples :
    // sinon le clic sur une ligne posée sur un champ sélectionnait le champ, que Suppr effaçait.
    zIndex: 120,
    editable: true,
    draggable: true,
    geodesic: true
  },
  SELECTED_LINE: {
    strokeColor: '#FF4081', // light red
    strokeWeight: 4,
    zIndex: 120, // une ligne juste tracée reçoit ce style seul (cf. DEFAULT_LINE)
    // Sélection = poignées d'édition + déplacement (clearSelection ne retire que les poignées).
    editable: true,
    draggable: true
  },
  DEFAULT_CIRCLE: {
    fillColor: '#FFA726', // orange
    fillOpacity: 0.4,
    strokeColor: '#FB8C00', // dark orange
    strokeWeight: 2,
    strokeOpacity: 1,
    zIndex: 120, // cf. DEFAULT_LINE
    editable: true,
    draggable: true
  },
  DEFAULT_SIMPLE_RECTANGLE: {
    fillColor: '#FFA726', // orange
    fillOpacity: 0.4,
    strokeColor: '#FB8C00', // dark orange
    strokeWeight: 2,
    strokeOpacity: 1,
    zIndex: 120,
    editable: true,
    draggable: true
  },

  INBOUND_SIMPLE_RECTANGLE: {
    fillColor: '#0383d8',
    fillOpacity: 0.4,
    strokeColor: '#FB8C00', // dark orange
    strokeWeight: 2,
    strokeOpacity: 1,
    zIndex: 120,
    editable: true,
    draggable: true
  },

  DEFAULT_SIMPLE_POLYGON: {
    fillColor: '#FFA726', // orange
    fillOpacity: 0.4,
    strokeColor: '#FB8C00', // dark orange
    strokeWeight: 2,
    strokeOpacity: 1,
    zIndex: 120,
    editable: true,
    draggable: true
  },

  OBSTACLE_CIRCLE: {
    fillColor: '#FF5722',
    fillOpacity: 0.3,
    strokeColor: '#D32F2F',
    strokeWeight: 2,
    strokeOpacity: 1,
    zIndex: 15,
    editable: false,
    draggable: true
  },
  SELECTED_OBSTACLE_CIRCLE: {
    strokeColor: '#FF4081',
    strokeWeight: 3,
    fillOpacity: 0.5
  },
  OBSTACLE_RECTANGLE: {
    fillColor: '#FF5722',
    fillOpacity: 0.3,
    strokeColor: '#D32F2F',
    strokeWeight: 2,
    strokeOpacity: 1,
    zIndex: 15,
    editable: false,
    // Drag natif désactivé : peu fiable pour Polygon sur carte vectorielle (mapId) — remplacé par
    // un déplacement manuel (cf. GeometryUtils.attachManualPathDrag, ObstacleRectangle.js).
    draggable: false
  },
  SELECTED_OBSTACLE_RECTANGLE: {
    strokeColor: '#FF4081',
    strokeWeight: 3,
    fillOpacity: 0.5
  },
  OBSTACLE_POLYGON: {
    fillColor: '#FF5722',
    fillOpacity: 0.3,
    strokeColor: '#D32F2F',
    strokeWeight: 2,
    strokeOpacity: 1,
    zIndex: 15,
    editable: false,
    // Drag natif désactivé : peu fiable pour Polygon sur carte vectorielle (mapId) — remplacé par
    // un déplacement manuel (cf. GeometryUtils.attachManualPathDrag, ObstaclePolygon.js).
    draggable: false
  },
  SELECTED_OBSTACLE_POLYGON: {
    strokeColor: '#FF4081',
    strokeWeight: 3,
    fillOpacity: 0.5
  },
  OBSTACLE_LINE: {
    strokeColor: '#D32F2F',
    strokeWeight: 3,
    strokeOpacity: 1,
    zIndex: 15,
    editable: false,
    // Drag natif désactivé : peu fiable pour Polyline sur carte vectorielle (mapId) — remplacé par
    // un déplacement manuel (cf. GeometryUtils.attachManualPathDrag, ObstacleLine.js).
    draggable: false
  },
  SELECTED_OBSTACLE_LINE: {
    strokeColor: '#FF4081',
    strokeWeight: 4,
    strokeOpacity: 1
  },

  SELECTED_SIMPLE_RECTANGLE: {
    strokeColor: '#FF4081', // light red
    strokeWeight: 3,
    fillOpacity: 0.6,
    editable: true,
    draggable: true
  },
  SELECTED_SIMPLE_POLYGON: {
    strokeColor: '#FF4081', // light red
    strokeWeight: 3,
    fillOpacity: 0.6,
    editable: true,
    draggable: true
  },
  SELECTED_CIRCLE: {
    strokeColor: '#FF4081', // light red
    strokeWeight: 3,
    fillOpacity: 0.6,
    zIndex: 120, // un cercle juste tracé reçoit ce style seul (cf. DEFAULT_LINE)
    editable: true,
    draggable: true
  },
  CIRCLE_LABEL: `
    background-color: rgba(255, 255, 255, 0.9);
    border: 1px solid #FB8C00;
    border-radius: 4px;
    color: #333;
    font-family: Arial, sans-serif;
    font-size: 12px;
    font-weight: bold;
    padding: 4px 8px;
    text-align: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    min-width: 60px;
    pointer-events: none;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  `,
  LINE_LABEL: `
    background-color: rgba(255, 255, 255, 0.9);
    border: 1px solid #4CAF50;
    border-radius: 4px;
    color: #333;
    font-family: Arial, sans-serif;
    font-size: 12px;
    font-weight: bold;
    padding: 4px 8px;
    text-align: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    min-width: 60px;
    pointer-events: none;
  `,
  SIMPLE_RECTANGLE_LABEL: `
    background-color: rgba(255, 255, 255, 0.9);
    border: 1px solid #4CAF50;
    border-radius: 4px;
    color: #333;
    font-family: Arial, sans-serif;
    font-size: 12px;
    font-weight: bold;
    padding: 4px 8px;
    text-align: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    min-width: 60px;
    pointer-events: none;
  `,
  SIMPLE_POLYGON_LABEL: `
    background-color: rgba(255, 255, 255, 0.9);
    border: 1px solid #4CAF50;
    border-radius: 4px;
    color: #333;
    font-family: Arial, sans-serif;
    font-size: 12px;
    font-weight: bold;
    padding: 4px 8px;
    text-align: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    min-width: 60px;
    pointer-events: none;
  `,
  MEASUREMENT_LABEL: `
    color: white;
    font-size: 14px;
    font-weight: bold;
    padding: 4px 8px;
    border-radius: 4px;
    background-color: rgba(0, 0, 0, 0.7);
    white-space: nowrap;
    display: block;
    opacity: 1;
  `,
  DEFAULT_TEXT: {
    fontSize: '14px',
    fontFamily: 'Arial, sans-serif',
    color: '#333333',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: '6px 10px',
    borderRadius: '4px',
    border: '1px solid #2196F3',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    cursor: 'move',
    zIndex: 1000
  },
  SELECTED_TEXT: {
    border: '2px solid #FF4081',
    boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
  },
  DEFAULT_BUTTON: {
    backgroundColor: 'white'
  },
  SELECTED_BUTTON: {
    backgroundColor: '#a6a6a6'
  },
  PARCELLE_MARKER_LABEL: `
    background-color: rgba(33, 150, 243, 0.95);
    border: 2px solid #1976D2;
    border-radius: 6px;
    color: white;
    font-family: Arial, sans-serif;
    font-size: 11px;
    font-weight: bold;
    padding: 6px 10px;
    text-align: center;
    box-shadow: 0 3px 6px rgba(0,0,0,0.3);
    min-width: 80px;
    white-space: nowrap;
 `
};

export const MEASUREMENT_CONSTANTS = {
  DIMENSION_LABEL_OFFSET_METERS: 1.5,
  ID_LABEL_OFFSET_METERS: 3
};


// Constantes pour les événements personnalisés
export let CUSTOM_EVENTS = {
  SHAPE_ADDED: 'shapeAdded',
  SHAPE_SELECTED: 'shapeSelected',
  SHAPE_REMOVED: 'shapeRemoved',
  SHAPE_COPIED: 'shapeCopied',
  SHAPE_PASTED: 'shapePasted',
  SHAPE_ROTATED: 'shapeRotated',
  SHAPE_MOVED: 'shapeMoved',
  LINE_TO_POLYGON_CREATED: 'lineToPolygonCreated',
  UPDATE_MAP_SHAPE: 'updateMapShape',
  TAB_SELECTED: 'tabSelected',
  TAB_REMOVED: 'tabRemoved',
  REQUEST_SHAPE_CENTER: 'requestShapeCenter',
  SHAPE_CENTER_UPDATED: 'shapeCenterUpdated',
  FORM_DIMENSIONS_CHANGED: 'formDimensionsChanged',
  SOLAR_DATA_UPDATED: 'solarDataUpdated',
  SOLAR_DATA_BATCH_UPDATED: 'solarDataBatchUpdated',
  CADASTRAL_DATA_LOADED: 'cadastralDataLoaded',
  MAP_ZOOM_CHANGED: 'mapZoomChanged',
  CENTER_ON_SHAPE: 'centerOnShape',
  LAYOUT_UPDATED: 'layoutUpdated',
  RECTANGLE_DIMENSIONS_CHANGED: 'rectangleDimensionsChanged',
  PANEL_ORIENTATION_CHANGED: 'panelOrientationChanged',
  LINE_ADDED: 'lineAdded',
  LINE_SELECTED: 'lineSelected',
  LINE_REMOVED: 'lineRemoved',
  CIRCLE_ADDED: 'circleAdded',
  CIRCLE_SELECTED: 'circleSelected',
  CIRCLE_REMOVED: 'circleRemoved',
  TEXT_ADDED: 'textAdded',
  TEXT_SELECTED: 'textSelected',
  TEXT_REMOVED: 'textRemoved',
  SIMPLE_RECTANGLE_ADDED: 'simpleRectangleAdded',
  SIMPLE_RECTANGLE_SELECTED: 'simpleRectangleSelected',
  SIMPLE_RECTANGLE_REMOVED: 'simpleRectangleRemoved',
  SIMPLE_RECTANGLE_COMPLETE: 'simpleRectangleComplete',
  SIMPLE_POLYGON_ADDED: 'simplePolygonAdded',
  SIMPLE_POLYGON_SELECTED: 'simplePolygonSelected',
  SIMPLE_POLYGON_REMOVED: 'simplePolygonRemoved',
  SIMPLE_POLYGON_COMPLETE: 'simplePolygonComplete',
  METRICS_UPDATED: 'metricsUpdated',
  SAVE_PAGE_DATA: 'savePageData',
  LOAD_PAGE_DATA: 'loadPageData',
  CLEAR_PAGE_DATA: 'clearPageData',
  SHOW_PERFORMANCE_LABELS: false,
  UPDATE_RESUME_CONTAINER: 'updateRésuméContainer',
  PARCELLE_MARKER_ADDED: 'parcelleMarkerAdded',
  PARCELLE_MARKER_REMOVED: 'parcelleMarkerRemoved',
  PARCELLE_MARKER_MODE_ACTIVATED: 'parcelleMarkerModeActivated',
  PARCELLE_MARKER_MODE_DEACTIVATED: 'parcelleMarkerModeDeactivated',
  // NOUVEAU (extension de la collecte de parcelles cadastrales au calepinage maison résidentielle) :
  // volontairement DISTINCT de SHAPE_ADDED — un contour de maison (polygon_maison.js) n'est PAS une
  // forme PV "grands projets" et ne doit PAS déclencher les effets de bord attachés à SHAPE_ADDED
  // (TabsManager.js crée un onglet "Données système" + interroge PVGIS pour tout pvId reçu via cet
  // événement). Écouté uniquement par resuméParcelles.js pour réutiliser sa logique
  // _getParcelleInfo/_createParcelleRow telle quelle, sans dupliquer l'appel à l'API cadastre.
  MAISON_SHAPE_ADDED: 'maisonShapeAdded',
};

// Mapping des champs du formulaire pour le chargement
export const FORM_FIELDS_MAPPING = {
  'noPanneau': 'noPanneau',
  'longueur': 'longueur',
  'largeur': 'largeur',
  'typeCouverture': 'typeCouverture',
  'referenceSI': 'referenceSI',
  'avisCertification': 'avisCertification',
  'espacementPanneauxX': 'espacementPanneauxX',
  'espacementPanneauxY': 'espacementPanneauxY',
  'espacementBords': 'espacementBords',
  // NOTE ORDRE : longueurPanneau/largeurPanneau/epaisseurPanneau doivent être restaurés AVANT
  // dimensionsPanneaux, car repasser dimensionsPanneaux à "custom" déclenche une recopie de leur valeur
  // COURANTE vers les champs "...Custom" affichés — s'ils n'ont pas encore été restaurés à ce moment,
  // cette recopie utilise des valeurs par défaut/périmées au lieu des valeurs sauvegardées.
  'longueurPanneau': 'longueurPanneau',
  'largeurPanneau': 'largeurPanneau',
  'epaisseurPanneau': 'epaisseurPanneau',
  'referencePanneau': 'referencePanneau',
  'fabricantPanneau': 'fabricantPanneau',
  'puissancePanneau': 'puissancePanneau',
  'dimensionsPanneaux': 'dimensionsPanneaux',
  // Champs "dimensions personnalisées" affichés lors du choix d'un panneau favori (cf. selectFavoritePanel) :
  // sauvegardés/restaurés indépendamment de la recopie ci-dessus, pour rester corrects même si l'ordre
  // de restauration changeait à l'avenir.
  'longueurPanneauCustom': 'longueurPanneauCustom',
  'largeurPanneauCustom': 'largeurPanneauCustom',
  'epaisseurPanneauCustom': 'epaisseurPanneauCustom',
  'nbColonne': 'colonne',
  'nbLigne': 'ligne',
  'dimensionsChampPVlongueur': 'dimensionsChampPVlongueur',
  'dimensionsChampPVlargeur': 'dimensionsChampPVlargeur',
  'gestionLongueur': 'gestionLongueur',
  'inclinaison': 'inclinaison',
  'azimuth': 'azimuth',
  'typeSysteme': 'typeSysteme',
  'perteSysteme': 'perteSysteme',
  'rendementOnduleur': 'rendementOnduleur',
  'consoOnduleur': 'consoOnduleur',
  'nbOnduleurs': 'nbOnduleurs',
  'fractionRepartitionOnduleur': 'fractionRepartitionOnduleur',
  'affectationCentrale': 'affectationCentrale',
  // Nouveaux champs persistants
  'type_de_structure': 'type_de_structure',
  'fabricant_ombriere_bois': 'fabricant_ombriere_bois',
  'toiture_pente_type': 'toiture_pente_type',
  'inclinaison-top': 'inclinaison-top',
  'pente': 'pente',
  'pente2': 'pente2',
  'largeur_faitage_mm': 'largeur_faitage_mm',
  'asymetrie_percent': 'asymetrie_percent',
  'nb_pentes': 'nb_pentes',
  'supportPv': 'supportPv',
  'modePose': 'modePose',
  'azimuth2': 'azimuth2',
  'azimuth3': 'azimuth3',
  'azimuth4': 'azimuth4',
  'joint_dilatation': 'joint_dilatation',
  'limit_dilatation_m': 'limit_dilatation_m',
  // Paramètres spécifiques aux sheds — restaurés APRÈS "inclinaison-top" (ligne plus haut) : la
  // restauration de ce dernier déclenche syncInclinaisonPanneaux(), qui injecte sa valeur dans
  // "pente_panneaux_shed" (comportement voulu à la saisie normale). Placés ici, en dernier, la valeur
  // propre du shed "a le dernier mot" et n'est plus écrasée par cette injection lors du rechargement.
  'shedsRows': 'shedsRows',
  'shedsRowSpacing': 'shedsRowSpacing',
  'shedsCols': 'shedsCols',
  'shedsColSpacing': 'shedsColSpacing',
  'pente_panneaux_shed': 'pente_panneaux_shed',
  'shedRotation': 'shedRotation',
  'shedsRegular': 'shedsRegular',
  // Résultats backend du panneau "Résultats" shed (cf. calepinage_correction_controller.js
  // ::updateShedFormFields) — persistés pour survivre à un rechargement de page tant qu'aucune
  // modification réelle n'a invalidé ces valeurs (cf. PolygonPanelsManager.js
  // ::clearShedResultFields, gardé par _isRestoringShapes au chargement).
  'nombreSheds': 'nombreSheds',
  'ratioCouverture': 'ratioCouverture',
  'shedsNbLargeur': 'shedsNbLargeur',
  'perteOmbrageShed': 'perteOmbrageShed',
  'surfacePolygoneShed': 'surfacePolygoneShed',
  'surfacePanneauxInclineShed': 'surfacePanneauxInclineShed',
  'surfacePanneauxProjeteeShed': 'surfacePanneauxProjeteeShed',
  'nombrePanneauxShed': 'nombrePanneauxShed',
  'puissanceShedKwc': 'puissanceShedKwc',
  'shedDimensions': 'shedDimensions',
  'shedGroupSurface': 'shedGroupSurface',
  'shedNbPvCalepinage': 'shedNbPvCalepinage'
};

export const TYPE_COUVERTURE_MAP = {
  'Ombrière métal': [
    { id: 'Evolution', label: 'Adiwatt_Profil Evolution', x: 7, y: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '3-45°' },
    { id: 'SolarRC3', label: 'Dome Solar_RC3', x: 27, y: 3, pose: 'Portrait', avis: 'ETN', rail: '140mm', broof: 'Non', dX: 150, dY: 0, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Joriside_RSPARK', label: 'Jorissolar_RS-Park2', x: 12, y: 1.5, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 191, dY: 0, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Mecosun_MVOH', label: 'Mecosun_MVOH', x: 8, y: 1, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 170, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D/F/E', Altitude: 900, pente: '5-40°' },
    { id: 'Mecosun_MVUH', label: 'Mecosun_MVUH', x: 8, y: 1, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 170, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D/F/E', Altitude: 900, pente: '5-40°' },
    { id: 'SopraPark', label: 'Soprasolar_Park', x: 2, y: 4, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Triangle', label: 'Le Triangle', x: 7, y: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    // CORRECTIF : x/y=0 était interprété par DrawingControl.js (handleSystemeChange) comme un
    // espacement PV valide de 0mm (le test `dataset.x !== ''` laisse passer la chaîne "0"), écrasant
    // le défaut de 20mm dès que ce type de structure était sélectionné avec SI="Autres". Voir la même
    // correction déjà faite pour 'Toiture terasse'/'Petit champ solaire' ci-dessous.
    { id: 'Autres', label: 'Autres', x: 20, y: 20, pose: '', avis: '', broof: '', dX: 0, dY: 0, 'Z-vent': '', 'Z-Neige': '', Altitude: 0, pente: '' }
  ],


  'Ombrière bois': [
    { id: 'Evolution', label: 'Adiwatt_Profil Evolution', x: 7, y: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'SolarRC3', label: 'Dome Solar_RC3', x: 27, y: 3, pose: 'Portrait', avis: 'ETN', rail: '140mm', broof: 'Non', dX: 150, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Joriside_RSPARK', label: 'Jorissolar_RS-Park2', x: 12, y: 1.5, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 191, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Mecosun_MVOH', label: 'Mecosun_MVOH', x: 5, y: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Mecosun_MVUH', label: 'Mecosun_MVUH', x: 5, y: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'SopraPark', label: 'Soprasolar_Park', x: 2, y: 4, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Triangle', label: 'Le Triangle', x: 7, y: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    // CORRECTIF : x/y=0 était interprété par DrawingControl.js (handleSystemeChange) comme un
    // espacement PV valide de 0mm (le test `dataset.x !== ''` laisse passer la chaîne "0"), écrasant
    // le défaut de 20mm dès que ce type de structure était sélectionné avec SI="Autres". Voir la même
    // correction déjà faite pour 'Toiture terasse'/'Petit champ solaire' ci-dessous.
    { id: 'Autres', label: 'Autres', x: 20, y: 20, pose: '', avis: '', broof: '', dX: 0, dY: 0, 'Z-vent': '', 'Z-Neige': '', Altitude: 0, pente: '' }
  ],


  'Ombrière solumbra': [
    { id: 'fabricant', label: 'Système d\'intégration fabricant', x: 22, y: 0, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 160, dY: 0, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '8°' }
  ],


  'Ombrière béton': [
    { id: 'Mecosun_MVOH', label: 'Mecosun_MVOH', x: 5, y: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Mecosun_MVUH', label: 'Mecosun_MVUH', x: 5, y: 3, pose: 'Portrait', avis: 'ETN', broof: 'Non', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' }
  ],


  'Bâtiment incliné métal': [
    { id: 'Helios', label: 'Dome solar Helios B²', x: 10, y: 10, pose: 'Paysage', avis: 'ETN', broof: 'Oui', fixation: 'Panne', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Joriside_Optiroof', label: 'Jorissolar_Opti’Roof', x: 9.5, y: 19, pose: 'Paysage', avis: 'ETN', broof: 'Oui', fixation: 'Onde bac-acier', dX: 0, dY: 50, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Joriside_RSR', label: 'Jorissolar_RS-R', x: 19, y: 9.5, pose: 'Portrait', avis: 'ETN', broof: 'Oui', fixation: 'Onde bac-acier', dX: 50, dY: 0, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Joriside_RSEVO', label: 'JorisSolar_RS-EVO', x: 9.5, y: 25, pose: 'Paysage', avis: 'ETN', broof: 'Oui', fixation: 'Panne', dX: 0, dY: 50, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'rail_K2system', label: 'K2_Système', x: 10, y: 10, pose: 'Portrait', avis: 'ETN', broof: 'Oui', fixation: 'Bac', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'mini_rails', label: 'Novotegra Mini Rails', x: 10, y: 10, pose: 'Portrait/Paysage', avis: 'Avis Technique', broof: 'Oui', fixation: 'Bac', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 'NA', pente: 'NA' },
    // CORRECTIF : x/y=0 était interprété par DrawingControl.js (handleSystemeChange) comme un
    // espacement PV valide de 0mm (le test `dataset.x !== ''` laisse passer la chaîne "0"), écrasant
    // le défaut de 20mm dès que ce type de structure était sélectionné avec SI="Autres". Voir la même
    // correction déjà faite pour 'Toiture terasse'/'Petit champ solaire' ci-dessous.
    { id: 'Autres', label: 'Autres', x: 20, y: 20, pose: '', avis: '', broof: '', dX: 0, dY: 0, 'Z-vent': '', 'Z-Neige': '', Altitude: 0, pente: '' }
  ],


  'bâtiment incliné bois': [
    { id: 'Helios', label: 'Dome solar Helios B²', x: 10, y: 10, pose: 'Portrait', avis: 'ETN', broof: 'Oui', fixation: 'Panne', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Joriside_Optiroof', label: 'Jorissolar_Opti’Roof', x: 5, y: 3, pose: 'Paysage', avis: 'ETN', broof: 'Oui', fixation: 'Panne', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Joriside_RSR', label: 'Jorissolar_RS-R', x: 10, y: 20, pose: 'Portrait', avis: 'ETN', broof: 'Oui', fixation: 'Panne', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'Joriside_RSEVO', label: 'JorisSolar_RS-EVO', x: 10, y: 10, pose: 'Portrait', avis: 'ETN', broof: 'Oui', fixation: 'Panne', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'rail_K2system', label: 'K2_Système', x: 10, y: 10, pose: 'Portrait', avis: 'ETN', broof: 'Oui', fixation: 'Bac', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    { id: 'rail_novotegra', label: 'Novotegra', x: 10, y: 10, pose: 'Portrait/Paysage', avis: 'Avis Technique', broof: 'Oui', fixation: 'Bac', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '4-45°' },
    // CORRECTIF : x/y=0 était interprété par DrawingControl.js (handleSystemeChange) comme un
    // espacement PV valide de 0mm (le test `dataset.x !== ''` laisse passer la chaîne "0"), écrasant
    // le défaut de 20mm dès que ce type de structure était sélectionné avec SI="Autres". Voir la même
    // correction déjà faite pour 'Toiture terasse'/'Petit champ solaire' ci-dessous.
    { id: 'Autres', label: 'Autres', x: 20, y: 20, pose: '', avis: '', broof: '', dX: 0, dY: 0, 'Z-vent': '', 'Z-Neige': '', Altitude: 0, pente: '' }
  ],


  'Toiture terasse': [
    { id: 'SopraFixEvo', label: 'Soprasolar_Fix Evo', x: 20, y: 20, pose: 'Portrait', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'À plat', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '0-3°' },
    { id: 'SopraFixEvoTilt', label: 'Soprasolar_Fix Evo Tilt', x: 20, y: 20, pose: 'Paysage', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'Incliné', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '10°' },
    { id: 'RoofSolarBitume', label: 'Dome_Solar Roof Solar Bitume', x: 20, y: 20, pose: 'Portrait', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'À plat', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '0-3°' },
    { id: 'RoofSolarBitumeTilt', label: 'Dome_Solar Roof Solar Bitume_Tilt', x: 20, y: 20, pose: 'Paysage', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'Incliné', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '10°' },
    { id: 'InovaPVLite', label: 'EPC_Solar_Inova PV lite', x: 20, y: 20, pose: 'Portrait', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'À plat', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '0-3°' },
    { id: 'InovaPVLiteTilt', label: 'EPC_Solar_Inova PV lite Tilt', x: 20, y: 20, pose: 'Paysage', avis: 'ATEC', broof: 'Oui', fixation: 'Thermosoudé', typePose: 'Incliné', dX: 160, dY: 3, 'Z-vent': 'V1/V2/V3/V4', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 1000, pente: '10°' },
    // CORRECTIF : x/y=0 était interprété par DrawingControl.js (handleSystemeChange) comme un
    // espacement PV valide de 0mm (le test `dataset.x !== ''` laisse passer la chaîne "0"), écrasant
    // le défaut de 20mm dès que "Système d'intégration" = Autres était sélectionné (cas du support
    // Plat 0°/bouton "draw-polygon-button", qui force type_de_structure="Toiture terasse" + SI="Autres").
    // Aligné sur "Petit champ solaire" ci-dessous, qui utilisait déjà x:20/y:20 pour son "Autres".
    { id: 'Autres', label: 'Autres', x: 20, y: 20, pose: '', avis: '', broof: '', dX: 0, dY: 0, 'Z-vent': '', 'Z-Neige': '', Altitude: 0, pente: '' }
  ],


  // Esp_groupe_shed (mm) : valeur par défaut du champ "Esp. groupe de shed" (shedsRowSpacing),
  // appliquée automatiquement au choix d'un système d'intégration (cf. FormHandler.js), sauf "Autres"
  // (laissé vide : l'utilisateur saisit alors tout manuellement). Reste modifiable ensuite par
  // l'utilisateur — cette valeur n'est qu'un pré-remplissage, pas une contrainte.
  'Petit champ solaire': [
    { id: 'Mecosun_Optisol', label: 'Mecosun_Optisol', x: 20, y: 10, pose: 'Portrait', avis: 'N/A', broof: 'Non', dX: 100, dY: 3, 'Z-vent': 'V1/V2/V3', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 200, pente: '10°', pente_terrain_max: 2, Config_calepinage: '2Lx8C', Esp_groupe_shed: 100 },
    { id: 'Dome_solar_1', label: 'DomeSolar_2V6', x: 8.5, y: 20, pose: 'Portrait', avis: 'N/A', broof: 'Non', dX: 100, dY: 3, 'Z-vent': 'V1/V2/V3', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 200, pente: '15°', pente_terrain_max: 2, Config_calepinage: '2Lx6C', Esp_groupe_shed: 100 },
    { id: 'Dome_solar_2', label: 'DomeSolar_2V12', x: 8.5, y: 20, pose: 'Portrait', avis: 'N/A', broof: 'Non', dX: 100, dY: 3, 'Z-vent': 'V1/V2/V3', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 200, pente: '15°', pente_terrain_max: 2, Config_calepinage: '2Lx12C', Esp_groupe_shed: 100 },
    { id: 'Dome_solar_3', label: 'DomeSolar_3V6', x: 8.5, y: 20, pose: 'Portrait', avis: 'N/A', broof: 'Non', dX: 100, dY: 3, 'Z-vent': 'V1/V2/V3', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 200, pente: '15°', pente_terrain_max: 2, Config_calepinage: '3Lx6C', Esp_groupe_shed: 100 },
    { id: 'Dome_solar_4', label: 'DomeSolar_3V18', x: 8.5, y: 20, pose: 'Portrait', avis: 'N/A', broof: 'Non', dX: 100, dY: 3, 'Z-vent': 'V1/V2/V3', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 200, pente: '15°', pente_terrain_max: 2, Config_calepinage: '3Lx18C', Esp_groupe_shed: 100 },
    { id: 'Adiwatt_Xground', label: 'Adiwatt_Xground_V3 / 5V2-8p', x: 20, y: 20, pose: 'Portrait', avis: 'N/A', broof: 'Non', dX: 100, dY: 3, 'Z-vent': 'V1/V2/V3', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 200, pente: '14-17°', pente_terrain_max: 2, Config_calepinage: '2Lx8C', Esp_groupe_shed: 100 },
    { id: 'Adiwatt_Lground', label: 'Adiwatt_Lground_V4 / 5V2-8p', x: 20, y: 10, pose: 'Portrait', avis: 'N/A', broof: 'Non', dX: 100, dY: 3, 'Z-vent': 'V1/V2/V3', 'Z-Neige': 'A1/A2/B1/B2/C1/C2/D', Altitude: 200, pente: '14-17°', pente_terrain_max: 2, Config_calepinage: '2Lx8C', Esp_groupe_shed: 100 },
    { id: 'Autres', label: 'Autres', x: 20, y: 20, pose: '', avis: '', broof: '', dX: 0, dY: 0, 'Z-vent': '', 'Z-Neige': '', Altitude: 0, pente: '', pente_terrain_max: '', Config_calepinage: '' }

  ]

};

export const SHAPE_TYPES = {
  POLYGON: 'drawingControl.Polygon',
  CIRCLE: 'drawingControl.Circle',
  SIMPLE_RECTANGLE: 'drawingControl.SimpleRectangle',
  SIMPLE_POLYGON: 'drawingControl.SimplePolygon',
  POLYLINE: 'drawingControl.Polyline',
  TEXT: 'drawingControl.Text',
  LINE_TO_POLYGON: 'drawingControl.LineToPolygon' || 'LineToPolygon',
  SOLAR_PANEL: 'drawingControl.SolarPanel',
  SOLAR_RECTANGLE: 'drawingControl.SolarRectangle',
  SHED_POLYGON: 'drawingControl.ShedPolygon',
  OBSTACLE_CIRCLE: 'drawingControl.ObstacleCircle',
  OBSTACLE_RECTANGLE: 'drawingControl.ObstacleRectangle',
  OBSTACLE_POLYGON: 'drawingControl.ObstaclePolygon',
  OBSTACLE_LINE: 'drawingControl.ObstacleLine',
};
