import { GET_CADASTRE_DATA, GET_CODE_INSEE_BY_COORDINATES } from "../../../../API/API.js";
import EnedisControl from "./enedis.js";

// Constantes pour les niveaux de zoom maximums autorisés par couche
const MAP_ZOOM_LIMITS = {
  DEFAULT_MAX_ZOOM: 25,                    // Zoom maximum par défaut (Google Maps, OSM, Fond Blanc)
  GEOPORTAIL_NATIVE_MAX_ZOOM: 19,         // Zoom maximum natif pour les tuiles WMTS Géoportail
  GEOPORTAIL_DISPLAY_MAX_ZOOM: 25,        // Zoom maximum d'affichage avec overzoom pour Géoportail
  CADASTRE_WMS_MAX_ZOOM: 20               // Zoom maximum pour le cadastre WMS cadastre.gouv.fr (INSPIRE)
};

// Mémorisation du fond de carte et de la couche cadastre le temps de la session
// de travail (survit à l'actualisation de la page, pas d'enregistrement en BD)
const MAP_LAYERS_STORAGE_KEY = "pvMapLayersState";
const BASE_LAYERS = ['googleMaps', 'geoportail', 'osm', 'blank'];
const CADASTRE_LAYERS = ['none', 'geoportail', 'wms'];

/**
 * Normalise les coordonnées de tuile pour un niveau de zoom donné
 * - Enroule X horizontalement (le monde se répète)
 * - Limite Y verticalement (en dehors du monde devient null)
 * @param {Object} coord - Coordonnées {x, y} de la tuile
 * @param {number} zoom - Niveau de zoom
 * @returns {Object|null} - Coordonnées normalisées ou null si hors limites
 */
function normalizeCoord(coord, zoom) {
  const tileRange = 1 << zoom; // 2^zoom
  const x = ((coord.x % tileRange) + tileRange) % tileRange;
  const y = coord.y;
  if (y < 0 || y >= tileRange) return null;
  return { x, y };
}

/**
 * Classe personnalisée pour gérer l'overzoom des orthophotos Géoportail (WMTS)
 * Permet d'afficher les tuiles au-delà du zoom natif maximum en agrandissant les tuiles parentes
 */
class GeoportailSatelliteOverzoomMapType {
  constructor() {
    this.tileSize = new google.maps.Size(256, 256);
    this.maxZoom = MAP_ZOOM_LIMITS.GEOPORTAIL_DISPLAY_MAX_ZOOM;
    this.minZoom = 0;
    this.name = "Satellite Géoportail";
    this.alt = "Orthophotos Géoportail avec overzoom";
  }

  /**
   * Génère l'URL WMTS pour une tuile donnée
   * @param {number} zoom - Niveau de zoom
   * @param {number} x - Colonne de la tuile
   * @param {number} y - Ligne de la tuile
   * @returns {string} - URL de la tuile WMTS
   */
  _getWMTSUrl(zoom, x, y) {
    return `https://data.geopf.fr/wmts?LAYER=ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg&SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${zoom}&TILEROW=${y}&TILECOL=${x}`;
  }

  /**
   * Génère une tuile pour l'affichage sur la carte
   * @param {Object} coord - Coordonnées {x, y} de la tuile
   * @param {number} zoom - Niveau de zoom
   * @param {Document} ownerDocument - Document propriétaire pour créer les éléments
   * @returns {HTMLElement|null} - Élément div contenant la tuile ou null
   */
  getTile(coord, zoom, ownerDocument) {
    const n = normalizeCoord(coord, zoom);
    if (!n) return null;

    const div = ownerDocument.createElement("div");
    div.style.width = "256px";
    div.style.height = "256px";
    div.style.backgroundRepeat = "no-repeat";
    div.style.backgroundSize = "256px 256px";
    // Garder les pixels nets lors de l'agrandissement
    div.style.imageRendering = "pixelated";

    if (zoom <= MAP_ZOOM_LIMITS.GEOPORTAIL_NATIVE_MAX_ZOOM) {
      // Chargement normal à ce niveau de zoom
      const url = this._getWMTSUrl(zoom, n.x, n.y);
      div.style.backgroundImage = `url("${url}")`;
      return div;
    }

    // Overzoom : utiliser la tuile parente au zoom natif maximum, recadrer et agrandir
    const dz = zoom - MAP_ZOOM_LIMITS.GEOPORTAIL_NATIVE_MAX_ZOOM;
    const scale = 1 << dz; // 2^dz
    const parentX = Math.floor(n.x / scale);
    const parentY = Math.floor(n.y / scale);
    const subX = n.x % scale; // Décalage de l'enfant dans le parent
    const subY = n.y % scale;

    const parentUrl = this._getWMTSUrl(MAP_ZOOM_LIMITS.GEOPORTAIL_NATIVE_MAX_ZOOM, parentX, parentY);

    // Agrandir la tuile parente pour couvrir toutes les tuiles enfants, puis décaler vers le bon quadrant
    div.style.backgroundImage = `url("${parentUrl}")`;
    div.style.backgroundSize = `${256 * scale}px ${256 * scale}px`;
    div.style.backgroundPosition = `${-subX * 256}px ${-subY * 256}px`;

    return div;
  }

  releaseTile(tile) {
    // Nettoyer la tuile si nécessaire
  }
}

/**
 * Classe personnalisée pour gérer l'overzoom du cadastre Géoportail (WMTS)
 * Permet d'afficher les parcelles cadastrales au-delà du zoom natif maximum
 */
class GeoportailCadastreOverzoomMapType {
  constructor() {
    this.tileSize = new google.maps.Size(256, 256);
    this.maxZoom = MAP_ZOOM_LIMITS.GEOPORTAIL_DISPLAY_MAX_ZOOM;
    this.minZoom = 0;
    this.name = "Cadastre Géoportail";
    this.alt = "Cadastre Géoportail avec overzoom";
  }

  /**
   * Génère l'URL WMTS pour une tuile cadastre donnée
   * @param {number} zoom - Niveau de zoom
   * @param {number} x - Colonne de la tuile
   * @param {number} y - Ligne de la tuile
   * @returns {string} - URL de la tuile WMTS
   */
  _getWMTSUrl(zoom, x, y) {
    return `https://data.geopf.fr/wmts?LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&FORMAT=image/png&SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${zoom}&TILEROW=${y}&TILECOL=${x}`;
  }

  /**
   * Génère une tuile pour l'affichage sur la carte
   * @param {Object} coord - Coordonnées {x, y} de la tuile
   * @param {number} zoom - Niveau de zoom
   * @param {Document} ownerDocument - Document propriétaire pour créer les éléments
   * @returns {HTMLElement|null} - Élément div contenant la tuile ou null
   */
  getTile(coord, zoom, ownerDocument) {
    const n = normalizeCoord(coord, zoom);
    if (!n) return null;

    const div = ownerDocument.createElement("div");
    div.style.width = "256px";
    div.style.height = "256px";
    div.style.backgroundRepeat = "no-repeat";
    div.style.backgroundSize = "256px 256px";
    // Garder les pixels nets lors de l'agrandissement
    div.style.imageRendering = "pixelated";

    if (zoom <= MAP_ZOOM_LIMITS.GEOPORTAIL_NATIVE_MAX_ZOOM) {
      // Chargement normal à ce niveau de zoom
      const url = this._getWMTSUrl(zoom, n.x, n.y);
      div.style.backgroundImage = `url("${url}")`;
      return div;
    }

    // Overzoom : utiliser la tuile parente au zoom natif maximum, recadrer et agrandir
    const dz = zoom - MAP_ZOOM_LIMITS.GEOPORTAIL_NATIVE_MAX_ZOOM;
    const scale = 1 << dz; // 2^dz
    const parentX = Math.floor(n.x / scale);
    const parentY = Math.floor(n.y / scale);
    const subX = n.x % scale; // Décalage de l'enfant dans le parent
    const subY = n.y % scale;

    const parentUrl = this._getWMTSUrl(MAP_ZOOM_LIMITS.GEOPORTAIL_NATIVE_MAX_ZOOM, parentX, parentY);

    // Agrandir la tuile parente pour couvrir toutes les tuiles enfants, puis décaler vers le bon quadrant
    div.style.backgroundImage = `url("${parentUrl}")`;
    div.style.backgroundSize = `${256 * scale}px ${256 * scale}px`;
    div.style.backgroundPosition = `${-subX * 256}px ${-subY * 256}px`;

    return div;
  }

  releaseTile(tile) {
    // Nettoyer la tuile si nécessaire
  }
}

/**
 * Classe personnalisée pour gérer l'overzoom du cadastre WMS cadastre.gouv.fr (INSPIRE)
 * Permet d'afficher le cadastre au-delà du zoom natif maximum via le proxy Flask
 */
class CadastreWMSOverzoomMapType {
  constructor(codeInsee) {
    this.codeInsee = codeInsee;
    this.tileSize = new google.maps.Size(256, 256);
    this.maxZoom = MAP_ZOOM_LIMITS.GEOPORTAIL_DISPLAY_MAX_ZOOM;
    this.minZoom = 0;
    this.name = `Cadastre ${codeInsee}`;
    this.alt = `Cadastre WMS ${codeInsee} avec overzoom`;
    
    // Couches cadastrales INSPIRE selon la documentation officielle (Guide WMS)
    this.layers = [
      'AMORCES_CAD',           // Amorces cadastrales (numéros de rues)
      'LIEUDIT',               // Lieux-dits (toponymes)
      'CP.CadastralParcel',    // Parcelles cadastrales (contours)
      'SUBFISCAL',             // Subdivisions fiscales
      'CLOTURE',               // Clôtures (murs, fossés, haies)
      'DETAIL_TOPO',           // Détails topographiques (parkings, terrains, etc.)
      'HYDRO',                 // Éléments hydrographiques (cours d'eau, plans d'eau)
      'VOIE_COMMUNICATION',    // Voies de communication (chemins, routes, ponts)
      'BU.Building',           // Bâtiments (constructions)
      'BORNE_REPERE'           // Bornes et repères géodésiques
    ].join(',');
  }

  /**
   * Calcule le bbox EPSG:3857 pour une tuile donnée
   * @param {number} x - Colonne de la tuile
   * @param {number} y - Ligne de la tuile
   * @param {number} zoom - Niveau de zoom
   * @returns {Object} - Objet contenant {minx, miny, maxx, maxy}
   */
  _calculateBbox(x, y, zoom) {
    const tileSize = 256;
    const worldSize = Math.pow(2, zoom) * tileSize;
    const pixelOrigin = worldSize / 2;
    
    // Rayon de la Terre en mètres (Web Mercator)
    const earthRadius = 6378137;
    const scale = (2 * Math.PI * earthRadius) / worldSize;
    
    // Conversion des coordonnées de pixels en coordonnées EPSG:3857
    const minx = (x * tileSize - pixelOrigin) * scale;
    const maxx = ((x + 1) * tileSize - pixelOrigin) * scale;
    const miny = (pixelOrigin - (y + 1) * tileSize) * scale;
    const maxy = (pixelOrigin - y * tileSize) * scale;
    
    return { minx, miny, maxx, maxy };
  }

  /**
   * Génère l'URL WMS pour une tuile donnée via le proxy Flask
   * @param {number} zoom - Niveau de zoom
   * @param {number} x - Colonne de la tuile
   * @param {number} y - Ligne de la tuile
   * @returns {string} - URL de la tuile WMS via le proxy
   */
  _getWMSUrl(zoom, x, y) {
    const bbox = this._calculateBbox(x, y, zoom);
    const styles = '';
    
    return `/concevoir_mon_projet/api/cadastre-proxy/${this.codeInsee}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=${this.layers}&STYLES=${styles}&CRS=EPSG:3857&BBOX=${bbox.minx},${bbox.miny},${bbox.maxx},${bbox.maxy}&WIDTH=256&HEIGHT=256`;
  }

  /**
   * Génère une tuile pour l'affichage sur la carte
   * @param {Object} coord - Coordonnées {x, y} de la tuile
   * @param {number} zoom - Niveau de zoom
   * @param {Document} ownerDocument - Document propriétaire pour créer les éléments
   * @returns {HTMLElement|null} - Élément div contenant la tuile ou null
   */
  getTile(coord, zoom, ownerDocument) {
    const n = normalizeCoord(coord, zoom);
    if (!n) return null;

    const div = ownerDocument.createElement("div");
    div.style.width = "256px";
    div.style.height = "256px";
    div.style.backgroundRepeat = "no-repeat";
    div.style.backgroundSize = "256px 256px";
    // Garder les pixels nets lors de l'agrandissement
    div.style.imageRendering = "pixelated";

    if (zoom <= MAP_ZOOM_LIMITS.CADASTRE_WMS_MAX_ZOOM) {
      // Chargement normal à ce niveau de zoom
      const url = this._getWMSUrl(zoom, n.x, n.y);
      div.style.backgroundImage = `url("${url}")`;
      return div;
    }

    // Overzoom : utiliser la tuile parente au zoom natif maximum, recadrer et agrandir
    const dz = zoom - MAP_ZOOM_LIMITS.CADASTRE_WMS_MAX_ZOOM;
    const scale = 1 << dz; // 2^dz
    const parentX = Math.floor(n.x / scale);
    const parentY = Math.floor(n.y / scale);
    const subX = n.x % scale; // Décalage de l'enfant dans le parent
    const subY = n.y % scale;

    const parentUrl = this._getWMSUrl(MAP_ZOOM_LIMITS.CADASTRE_WMS_MAX_ZOOM, parentX, parentY);

    // Agrandir la tuile parente pour couvrir toutes les tuiles enfants, puis décaler vers le bon quadrant
    div.style.backgroundImage = `url("${parentUrl}")`;
    div.style.backgroundSize = `${256 * scale}px ${256 * scale}px`;
    div.style.backgroundPosition = `${-subX * 256}px ${-subY * 256}px`;

    return div;
  }

  releaseTile(tile) {
    // Nettoyer la tuile si nécessaire
  }
}

class MapViewsControl {
  constructor(options) {
    this.map = options.map;
    this.errorModal = options.errorModal;
    this.showSpinner = options.showSpinner;
    this.hideSpinner = options.hideSpinner;
    this.buttonIcons = options.buttonIcons;
    this.getAdvancedMarkerElement = options.getAdvancedMarkerElement;
    this.toolbarContext = options.getToolbarContext(); // () => Toolbar instance (this)

    this.isGeoJsonVisible = false; // Nouvel état pour la couche GeoJSON
    this.geoJsonLayer = null; // Pour stocker la référence à la couche GeoJSON
    this.parcelLabels = []; // Pour stocker les étiquettes des parcelles
    this.markerClusterer = null; // Pour stocker l'instance du clusterer de marqueurs
    this.cadastreParcelles = null; // Pour stocker les données des parcelles GeoJSON
    this.geoJsonFeatures = []; // Pour stocker les features GeoJSON ajoutées
    this.zoomListener = null; // Pour stocker la référence à l'écouteur de zoom
    this.cadastreWMSMoveListener = null; // Pour stocker l'écouteur de déplacement pour le cadastre WMS
    this.cadastreDebounceTimeout = null; // Pour stocker le timeout de debounce du cadastre WMS
 
    // Initialisation de la couche Cadastre WMTS Géoportail avec overzoom
    this.cadastreTileLayer = new GeoportailCadastreOverzoomMapType();

    // La couche Cadastre WMS sera créée dynamiquement avec le code INSEE
    this.cadastreWMSLayer = null;
    this.currentCadastreCodeInsee = null; // Stocke le code INSEE actuel du cadastre WMS

    // Initialisation de la couche Satellite Géoportail WMTS avec overzoom
    this.geoportailSatelliteLayer = new GeoportailSatelliteOverzoomMapType();

    // Initialisation de la couche OpenStreetMap
    this.osmLayer = new google.maps.ImageMapType({
      getTileUrl: (coord, zoom) => {
        // Utiliser un sous-domaine aléatoire pour la répartition de charge
        const subdomains = ['a', 'b', 'c'];
        const subdomain = subdomains[Math.floor(Math.random() * subdomains.length)];
        return `https://${subdomain}.tile.openstreetmap.fr/osmfr/${zoom}/${coord.x}/${coord.y}.png`;
      },
      tileSize: new google.maps.Size(256, 256),
      name: "OpenStreetMap France",
      minZoom: 1,
      maxZoom: 20,
    });

    this.previousMapTypeId = null; // Pour stocker l'ID du type de carte précédent
    this.currentSatelliteView = 'googleMaps'; // État de la vue satellite actuelle ('googleMaps' ou 'geoportail')
    this.currentPlanView = 'roadmap'; // État de la vue plan actuelle ('roadmap', 'osm' ou 'blanc')
    this.isCadastreWMSVisible = false; // État de la couche Cadastre WMS cadastre.gouv.fr
    this.currentBaseLayer = 'googleMaps'; // Fond actif tous menus confondus ('googleMaps', 'geoportail', 'osm' ou 'blank')
    this.isRestoringLayers = false; // Évite d'écraser l'état mémorisé pendant sa restauration

    // Tableau pour stocker les références des menus déroulants afin de pouvoir les nettoyer
    this.dropdownMenus = [];

    this.mapViewsContainer = this._createMapViewsContainer();
  }

  initMapDependentComponents() {
    if (!this.map) {
      console.error("MapViewsControl: La carte n'est pas initialisée avant d'appeler initMapDependentComponents.");
      if (this.errorModal) {
        this.errorModal.show("Erreur interne : Échec de l'initialisation des vues de carte.");
      }
      return;
    }
    // Création d'un type de carte pour le fond blanc
    // Approche avec tuiles blanches : on génère des tuiles complètement blanches
    // au lieu d'essayer de masquer les éléments Google Maps
    const blankMapType = new google.maps.ImageMapType({
      getTileUrl: (coord, zoom) => {
        // PNG blanc pur (#FFFFFF) encodé en base64
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
      },
      tileSize: new google.maps.Size(256, 256),
      name: "Fond Blanc",
      minZoom: 1,
      maxZoom: 22
    });
    this.map.mapTypes.set('blank', blankMapType);
  }
 
  getDOMElement() {
    return this.mapViewsContainer;
  }

  _createMapViewsContainer() {
    const viewsContainer = document.createElement("div");
    viewsContainer.className = "map-views-buttons-container"; 
    viewsContainer.style.cssText = `
            display: flex;
            flex-direction: row; /* Maintenir en ligne par défaut, Toolbar.js gère la colonne pour le conteneur parent */
            gap: 5px; /* Espacement entre les boutons de vue */
            padding: 5px; /* Un peu de padding interne */
        `;

    // Initialisation du contrôle Enedis (doit être fait après la définition de createButton)
    // On utilise une fonction fléchée pour capturer le contexte
    if (!this.enedisControl) {
      this.enedisControl = new EnedisControl({
        map: this.map,
        errorModal: this.errorModal,
        showSpinner: this.showSpinner,
        hideSpinner: this.hideSpinner,
        buttonIcons: this.buttonIcons,
        createButton: (text, onClick) => this.createButton(text, onClick),
        // Passer une référence à MapViewsControl pour permettre l'accès à la carte mise à jour
        getMap: () => this.map
        // Ne pas passer _createDropdownMenu et _createSubmenuOption car EnedisControl utilise ses propres méthodes qui gèrent les séparateurs et indicateurs
      });
    }

    const satelliteContainer = this._createSatelliteMenu();
    this.dropdownMenus.push(satelliteContainer);

    const planContainer = this._createPlanMenu();
    this.dropdownMenus.push(planContainer);

   const cadastreContainer = this._createCadastreMenu();
   this.dropdownMenus.push(cadastreContainer);

   const enedisContainer = this.enedisControl.createEnedisMenu();

   const tilt3DButton = this.createButton("3D", () => {
      const toolbar = this.toolbarContext;
      toolbar.is3DMode = !toolbar.is3DMode;
      if (toolbar.is3DMode) {
        this.map.setTilt(45);
        if (!this.map.buildings) {
          google.maps.importLibrary("maps").then(({ BuildingsLayer }) => {
            this.map.buildings = new BuildingsLayer({ map: this.map });
          }).catch(e => console.error("Failed to load BuildingsLayer", e));
        } else if (this.map.buildings.setMap) {
          this.map.buildings.setMap(this.map);
        }
        tilt3DButton.style.backgroundColor = "hsla(0, 0%, 100%, 1)"; // Actif
      } else {
        this.map.setTilt(0);
        if (this.map.buildings && this.map.buildings.setMap) {
          this.map.buildings.setMap(null);
        }
        tilt3DButton.style.backgroundColor = "hsla(0, 0%, 100%, 0.7)"; // Inactif
      }
       this.updateButtonSelection(tilt3DButton); // Mettre à jour l'état général
    });

   viewsContainer.appendChild(satelliteContainer);
   viewsContainer.appendChild(planContainer);
   viewsContainer.appendChild(cadastreContainer);
   // Site autonome : pas de raccordement au réseau, la carte Enedis est masquée (cf. app/utils/parcours.py).
   const masquerCarteEnedis = typeof window.parcoursMasque === "function" && window.parcoursMasque("carte_enedis");
   if (!masquerCarteEnedis) viewsContainer.appendChild(enedisContainer);
   viewsContainer.appendChild(tilt3DButton);

   // Sélectionner Satellite par défaut au démarrage si la map est prête
    // Cela devrait être fait après que le composant est ajouté au DOM et la map initialisée.
    // Toolbar.js peut appeler une méthode init() ou updateButtonSelection après l'ajout.
    // Pour l'instant, on suppose que Toolbar.js gère la sélection initiale.

    return viewsContainer;
  }

  createButton(text, onClick) {
    const button = document.createElement("button");
    const textSpan = document.createElement("span");
    textSpan.textContent = text;
    textSpan.className = "button-text";
    const iconSpan = document.createElement("span");
    iconSpan.className = "button-icon";

    const img = document.createElement("img");
    img.src = this.buttonIcons[text];
    img.width = 24;
    img.height = 24;
    iconSpan.appendChild(img);
    button.appendChild(iconSpan);
    button.appendChild(textSpan);

    button.style.cssText = `
            display: flex; align-items: center; justify-content: center; gap: 8px;
            background-color: hsla(0, 0%, 100%, 0.7) !important; cursor: pointer; padding: 12px;
            font-size: 14px; font-weight: bold; border-radius: 4px; width: 100%; /* Prendra la largeur du conteneur flex parent */
            z-index: 1000; border: 1px solid #D3D3D3;`;

    button.title = text === "Enedis" ? "Enedis" : "Vue " + text;
    button.addEventListener("mouseenter", () => {
      if (!button.classList.contains("selected") && !(text === "3D" && this.toolbarContext.is3DMode) && !(text === "Cadastre" && this.toolbarContext.isLayerVisible) && !(text === "Enedis")) {
        button.style.backgroundColor = "hsla(0, 0%, 100%, 0.9)";
      }
    });
    button.addEventListener("mouseleave", () => {
      if (!button.classList.contains("selected") && !(text === "3D" && this.toolbarContext.is3DMode) && !(text === "Cadastre" && this.toolbarContext.isLayerVisible) && !(text === "Enedis")) {
        button.style.backgroundColor = "hsla(0, 0%, 100%, 0.7)";
      }
    });

    button.addEventListener("click", onClick);
    return button;
  }

  /**
   * Méthode générique pour créer un menu déroulant
   * @param {string} buttonText - Texte du bouton principal
   * @param {string} menuId - ID unique pour le bouton principal
   * @param {Array} options - Tableau d'options { label: string, onClick: function, isSelected: function }
   * @returns {HTMLElement} - Le conteneur du menu avec le bouton et le sous-menu, avec une méthode destroy() pour nettoyer les listeners
   */
  _createDropdownMenu(buttonText, menuId, options) {
    const container = document.createElement("div");
    container.className = `${menuId}-menu-container`;
    container.style.position = "relative";

    const mainButton = this.createButton(buttonText, () => {
      submenu.style.display = submenu.style.display === "block" ? "none" : "block";
    });
    mainButton.id = menuId;

    const submenu = document.createElement("div");
    submenu.className = `${menuId}-submenu`;
    submenu.style.cssText = `
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            background-color: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            z-index: 1001;
            min-width: 150px;
        `;

    options.forEach(option => {
      const submenuOption = this._createSubmenuOption(
        option.label,
        () => {
          option.onClick();
          submenu.style.display = "none";
        },
        option.isSelected
      );
      submenu.appendChild(submenuOption);
    });

    container.appendChild(mainButton);
    container.appendChild(submenu);

    // Créer le handler comme une fonction nommée et stocker la référence
    const handleDocumentClick = (event) => {
      if (!container.contains(event.target)) {
        submenu.style.display = "none";
      }
    };

    // Attacher le listener au document
    document.addEventListener("click", handleDocumentClick);

    // Stocker la référence du handler sur le conteneur pour pouvoir le retirer plus tard
    container._dropdownClickHandler = handleDocumentClick;

    // Exposer une méthode destroy pour nettoyer les listeners
    container.destroy = () => {
      if (container._dropdownClickHandler) {
        document.removeEventListener("click", container._dropdownClickHandler);
        container._dropdownClickHandler = null;
      }
    };

    return container;
  }

  /**
   * Crée le menu déroulant Satellite avec les options Google Maps et Géoportail
   */
  _createSatelliteMenu() {
    return this._createDropdownMenu(
      "Satellite",
      "satellite-main-button",
      [
        {
          label: "Google Maps",
          onClick: () => this._switchSatelliteView('googleMaps'),
          isSelected: () => this.currentSatelliteView === 'googleMaps'
        },
        {
          label: "Géoportail",
          onClick: () => this._switchSatelliteView('geoportail'),
          isSelected: () => this.currentSatelliteView === 'geoportail'
        }
      ]
    );
  }

  /**
   * Crée le menu déroulant Plan avec les options OpenStreetMap et Fond Blanc
   */
  _createPlanMenu() {
    return this._createDropdownMenu(
      "Plan",
      "plan-main-button",
      [
        {
          label: "OpenStreetMap",
          onClick: () => this._switchPlanView('osm'),
          isSelected: () => this.currentPlanView === 'osm'
        },
        {
          label: "Fond Blanc",
          onClick: () => this._switchPlanView('blank'),
          isSelected: () => this.currentPlanView === 'blank'
        }
      ]
    );
  }

  /**
   * Gère le changement de vue satellite entre Google Maps et Géoportail
   * @param {string} viewType - 'googleMaps' ou 'geoportail'
   */
  _switchSatelliteView(viewType) {
    // Nettoyer les couches Plan d'abord
    this._removeOSMLayer();
    
    if (viewType === 'googleMaps') {
      // Retirer la couche Géoportail si elle est active
      this._removeGeoportailLayer();
      
      // Activer la vue hybrid de Google Maps
      this.map.setMapTypeId("hybrid");
      this.currentSatelliteView = 'googleMaps';
      
      // Restaurer le zoom maximum par défaut
      this.map.setOptions({ maxZoom: MAP_ZOOM_LIMITS.DEFAULT_MAX_ZOOM });
    } else if (viewType === 'geoportail') {
      // Retirer la couche Géoportail d'abord pour éviter les doublons
      this._removeGeoportailLayer();
      
      // Passer en mode roadmap pour avoir un fond de base
      this.map.setMapTypeId("roadmap");
      
      // Ajouter la couche Géoportail
      this._addGeoportailLayer();
      
      this.currentSatelliteView = 'geoportail';
      
      // Limiter le zoom au niveau maximum d'affichage avec overzoom
      this.map.setOptions({ maxZoom: MAP_ZOOM_LIMITS.GEOPORTAIL_DISPLAY_MAX_ZOOM });
    }

    if (viewType === 'googleMaps' || viewType === 'geoportail') {
      this.currentBaseLayer = viewType;
      this._saveLayersState();
    }
    this._updateSatelliteButtonState();
  }

  /**
   * Mémorise le fond de carte et la couche cadastre actifs (sessionStorage)
   */
  _saveLayersState() {
    if (this.isRestoringLayers) return;
    const toolbar = this.toolbarContext;
    let cadastre = 'none';
    if (this.isCadastreWMSVisible) cadastre = 'wms';
    else if (toolbar && toolbar.isLayerVisible) cadastre = 'geoportail';
    try {
      sessionStorage.setItem(MAP_LAYERS_STORAGE_KEY, JSON.stringify({ base: this.currentBaseLayer, cadastre }));
    } catch (e) {
      // Stockage indisponible (navigation privée...) : pas de mémorisation
    }
  }

  /**
   * Réapplique le fond de carte et la couche cadastre mémorisés (après actualisation)
   */
  async restoreSavedLayers() {
    let state = null;
    try {
      state = JSON.parse(sessionStorage.getItem(MAP_LAYERS_STORAGE_KEY));
    } catch (e) {
      return;
    }
    if (!state || !BASE_LAYERS.includes(state.base) || !CADASTRE_LAYERS.includes(state.cadastre)) return;

    this.isRestoringLayers = true;
    try {
      if (state.base === 'geoportail') this._switchSatelliteView('geoportail');
      else if (state.base === 'osm' || state.base === 'blank') this._switchPlanView(state.base);

      if (state.cadastre === 'geoportail') this.toggleCadastreLayer(true);
      else if (state.cadastre === 'wms') await this.toggleCadastreWMS(true);
    } catch (e) {
      console.error("MapViewsControl: échec de la restauration des couches mémorisées", e);
    } finally {
      this.isRestoringLayers = false;
      this.updateButtonSelection();
    }
  }

  /**
   * Ajoute la couche satellite Géoportail
   */
  _addGeoportailLayer() {
    // Vérifier si la couche n'est pas déjà présente
    let layerExists = false;
    for (let i = 0; i < this.map.overlayMapTypes.getLength(); i++) {
      if (this.map.overlayMapTypes.getAt(i) === this.geoportailSatelliteLayer) {
        layerExists = true;
        break;
      }
    }
    
    if (!layerExists) {
      // Vérifier si une couche cadastre est déjà présente
      const cadastreIndex = this._getCadastreLayerIndex();
      
      if (cadastreIndex !== -1) {
        // Si le cadastre est présent, le réinsérer après le satellite pour qu'il reste au-dessus
        // Retirer temporairement le cadastre
        const cadastreLayer = this.map.overlayMapTypes.getAt(cadastreIndex);
        this.map.overlayMapTypes.removeAt(cadastreIndex);
        // Ajouter le satellite
        this.map.overlayMapTypes.push(this.geoportailSatelliteLayer);
        // Réinsérer le cadastre après le satellite (il sera au-dessus)
        this.map.overlayMapTypes.push(cadastreLayer);
      } else {
        // Pas de cadastre, ajouter simplement le satellite
        this.map.overlayMapTypes.push(this.geoportailSatelliteLayer);
      }
    }
  }

  /**
   * Retire la couche satellite Géoportail
   */
  _removeGeoportailLayer() {
    for (let i = 0; i < this.map.overlayMapTypes.getLength(); i++) {
      if (this.map.overlayMapTypes.getAt(i) === this.geoportailSatelliteLayer) {
        this.map.overlayMapTypes.removeAt(i);
        break;
      }
    }
  }
  /**
   * Trouve l'index de la couche cadastre (Géoportail ou WMS) dans overlayMapTypes
   * @returns {number} - L'index de la couche ou -1 si non trouvée
   */
  _getCadastreLayerIndex() {
    // Toujours scanner les couches cadastre, indépendamment des flags
   for (let i = 0; i < this.map.overlayMapTypes.getLength(); i++) {
     const layer = this.map.overlayMapTypes.getAt(i);
     if (layer === this.cadastreTileLayer || layer === this.cadastreWMSLayer) {
       return i;
     }
   }
   return -1;
  
  }
  /**
   * Met à jour l'état visuel du bouton Satellite
   */
  _updateSatelliteButtonState() {
    const satelliteButton = document.getElementById("satellite-main-button");
    if (!satelliteButton) return;

    // Le bouton est toujours actif tant qu'une vue satellite est sélectionnée
    satelliteButton.style.backgroundColor = "hsla(0, 0%, 100%, 1)";
    satelliteButton.classList.add("selected");
  }

  /**
   * Gère le changement de vue plan entre OpenStreetMap et Fond Blanc
   * @param {string} viewType - 'osm' ou 'blank'
   */
  _switchPlanView(viewType) {
    // Nettoyer les couches Satellite d'abord
    this._removeGeoportailLayer();
    
    // Retirer toutes les couches overlay de plan
    this._removeOSMLayer();
    
    if (viewType === 'osm') {
      // Passer en mode roadmap comme base et ajouter OSM par-dessus
      this.map.setMapTypeId("roadmap");
      this._addOSMLayer();
      this.currentPlanView = 'osm';
      // Restaurer le zoom maximum par défaut
      this.map.setOptions({ maxZoom: MAP_ZOOM_LIMITS.DEFAULT_MAX_ZOOM });
    } else if (viewType === 'blank') {
      // Activer le fond blanc
      this.map.setMapTypeId("blank");
      this.currentPlanView = 'blank';
      // Restaurer le zoom maximum par défaut
      this.map.setOptions({ maxZoom: MAP_ZOOM_LIMITS.DEFAULT_MAX_ZOOM });
    }

    if (viewType === 'osm' || viewType === 'blank') {
      this.currentBaseLayer = viewType;
      this._saveLayersState();
    }
    this._updatePlanButtonState();
  }

  /**
   * Ajoute la couche OpenStreetMap
   */
  _addOSMLayer() {
    // Vérifier si la couche n'est pas déjà présente
    let layerExists = false;
    for (let i = 0; i < this.map.overlayMapTypes.getLength(); i++) {
      if (this.map.overlayMapTypes.getAt(i) === this.osmLayer) {
        layerExists = true;
        break;
      }
    }
    
    if (!layerExists) {
      this.map.overlayMapTypes.push(this.osmLayer);
    }
  }

  /**
   * Retire la couche OpenStreetMap
   */
  _removeOSMLayer() {
    for (let i = 0; i < this.map.overlayMapTypes.getLength(); i++) {
      if (this.map.overlayMapTypes.getAt(i) === this.osmLayer) {
        this.map.overlayMapTypes.removeAt(i);
        break;
      }
    }
  }

  /**
   * Met à jour l'état visuel du bouton Plan
   */
  _updatePlanButtonState() {
    const planButton = document.getElementById("plan-main-button");
    if (!planButton) return;

    // Le bouton est toujours actif tant qu'une vue plan est sélectionnée
    planButton.style.backgroundColor = "hsla(0, 0%, 100%, 1)";
    planButton.classList.add("selected");
  }

  updateButtonSelection(selectedButton) {
    const buttons = this.mapViewsContainer.querySelectorAll("button");
    const toolbar = this.toolbarContext;

    if (selectedButton) {
        // Gérer la sélection du bouton 3D
        if (selectedButton.title === "Vue 3D") {
            // La logique du 3D est déjà gérée dans son propre bouton
        }
    }

    // Mettre à jour l'état visuel de tous les boutons "à état" (3D, Cadastre, Satellite, Plan)
    buttons.forEach(btn => {
        if (btn.title === "Vue 3D") {
            const isActive = toolbar.is3DMode;
            btn.style.backgroundColor = isActive ? "hsla(0, 0%, 100%, 1)" : "hsla(0, 0%, 100%, 0.7)";
            if (isActive) btn.classList.add("selected");
            else btn.classList.remove("selected");
        }
    });
    
    // Mettre à jour l'état de tous les menus déroulants
    this._updateCadastreButtonState();
    this._updateSatelliteButtonState();
    this._updatePlanButtonState();
    if (this.enedisControl) {
      this.enedisControl.updateEnedisButtonState();
    }
  }

/**
   * Crée le menu déroulant Cadastre avec les options Géoportail et cadastre.gouv.fr
   */
  _createCadastreMenu() {
    const toolbar = this.toolbarContext;
    return this._createDropdownMenu(
      "Cadastre",
      "cadastre-main-button",
      [
        {
          label: "Cadastre Géoportail",
          onClick: () => this.toggleCadastreLayer(),
          isSelected: () => toolbar.isLayerVisible
        },
        {
          label: "Cadastre",
          onClick: () => this.toggleCadastreWMS(),
          isSelected: () => this.isCadastreWMSVisible
        }
      ]
    );
  }

  /**
   * Crée une option de sous-menu avec styles visuels pour la sélection
   * @param {string} text - Texte de l'option
   * @param {Function} onClick - Fonction callback au clic
   * @param {Function} isSelected - Fonction qui retourne true si l'option est sélectionnée
   * @returns {HTMLElement} - L'élément div de l'option
   */
  _createSubmenuOption(text, onClick, isSelected) {
    const option = document.createElement("div");
    option.textContent = text;
    
    // Fonction pour mettre à jour les styles en fonction de l'état de sélection
    const updateStyles = () => {
      const selected = isSelected && isSelected();
      option.style.cssText = `
              padding: 10px;
              cursor: pointer;
              font-weight: ${selected ? 'bold' : 'normal'};
              background-color: ${selected ? '#e0e0e0' : 'white'};
          `;
    };
    
    // Initialiser les styles
    updateStyles();
    
    option.addEventListener("mouseenter", () => {
      const selected = isSelected && isSelected();
      option.style.backgroundColor = selected ? "#d0d0d0" : "#f0f0f0";
    });
    
    option.addEventListener("mouseleave", () => {
      updateStyles();
    });
    
    option.addEventListener("click", () => {
      onClick();
      // Petite temporisation pour permettre au state de se mettre à jour avant de rafraîchir les styles
      setTimeout(() => updateStyles(), 50);
    });
    
    return option;
  }

 _updateCadastreButtonState() {
   const toolbar = this.toolbarContext;
   const cadastreButton = document.getElementById("cadastre-main-button");
   if (!cadastreButton) return;

   const isActive = toolbar.isLayerVisible || this.isCadastreWMSVisible;
   cadastreButton.style.backgroundColor = isActive ? "hsla(0, 0%, 100%, 1)" : "hsla(0, 0%, 100%, 0.7)";
   if (isActive) {
     cadastreButton.classList.add("selected");
   } else {
     cadastreButton.classList.remove("selected");
   }
 }

 toggleCadastreLayer(show) {
  const toolbar = this.toolbarContext;
  const shouldShow = show !== undefined ? show : !toolbar.isLayerVisible;

  if (shouldShow) {
    this._removeCadastreWMSLayer(); // Nettoyer l'autre couche cadastre
    this.map.overlayMapTypes.push(this.cadastreTileLayer);
    toolbar.isLayerVisible = true;
    this.map.setOptions({ maxZoom: MAP_ZOOM_LIMITS.GEOPORTAIL_DISPLAY_MAX_ZOOM }); // Limiter le zoom au niveau maximum avec overzoom
  } else {
    if (toolbar.isLayerVisible) {
      let foundAndRemoved = false;
      for (let i = 0; i < this.map.overlayMapTypes.getLength(); i++) {
        if (this.map.overlayMapTypes.getAt(i) === this.cadastreTileLayer) {
          this.map.overlayMapTypes.removeAt(i);
          foundAndRemoved = true;
          break;
        }
      }
      if (foundAndRemoved) {
        this.map.setOptions({ maxZoom: MAP_ZOOM_LIMITS.DEFAULT_MAX_ZOOM });
      }
      toolbar.isLayerVisible = false;
    }
  }
  this._saveLayersState();
  this._updateCadastreButtonState();
}

 /**
  * Toggle la couche Cadastre WMS de cadastre.gouv.fr (INSPIRE)
  * @param {boolean} show - Force l'affichage (true) ou le masquage (false), ou toggle si undefined
  */
 async toggleCadastreWMS(show) {
   const shouldShow = show !== undefined ? show : !this.isCadastreWMSVisible;

   if (shouldShow) {
     this.showSpinner();
     try {
       // Nettoyer l'autre couche cadastre (Géoportail)
       const toolbar = this.toolbarContext;
       if (toolbar.isLayerVisible) {
         this.toggleCadastreLayer(false);
       }
       
       // Obtenir le code INSEE du centre de la carte
       const center = this.map.getCenter();
       const codeInsee = await GET_CODE_INSEE_BY_COORDINATES(center.lat(), center.lng());
       
       if (!codeInsee) {
         this.errorModal.show("Impossible de déterminer le code INSEE pour cette localisation. Le cadastre n'est peut-être pas disponible ici.");
         this.hideSpinner();
         return;
       }
       
      // Créer la couche WMS avec le code INSEE
      this._createCadastreWMSLayer(codeInsee);
      this._addCadastreWMSLayer();
      this.isCadastreWMSVisible = true;
      
      // Limiter le zoom au niveau maximum avec overzoom
      this.map.setOptions({ maxZoom: MAP_ZOOM_LIMITS.GEOPORTAIL_DISPLAY_MAX_ZOOM });
       
       // Ajouter un écouteur pour détecter les changements de localisation
       this._setupCadastreWMSLocationListener();
       
     } catch (error) {
       console.error("Erreur lors de l'activation du cadastre WMS:", error);
       this.errorModal.show("Une erreur est survenue lors du chargement du cadastre.");
     } finally {
       this.hideSpinner();
       this._saveLayersState();
       this._updateCadastreButtonState();
     }
   } else {
     this._removeCadastreWMSLayer();
     this._removeCadastreWMSLocationListener();
     this.isCadastreWMSVisible = false;
     // Restaurer le zoom maximum par défaut
     this.map.setOptions({ maxZoom: MAP_ZOOM_LIMITS.DEFAULT_MAX_ZOOM });
     this._saveLayersState();
     this._updateCadastreButtonState();
   }
 }

 /**
  * Crée la couche Cadastre WMS pour une commune donnée
  * @param {string} codeInsee - Le code INSEE de la commune
  */
 _createCadastreWMSLayer(codeInsee) {
   // Stocker le code INSEE actuel
   this.currentCadastreCodeInsee = codeInsee;
   
   // Créer la couche WMS avec overzoom via le proxy Flask
   this.cadastreWMSLayer = new CadastreWMSOverzoomMapType(codeInsee);
 }

 /**
  * Ajoute la couche Cadastre WMS de cadastre.gouv.fr
  */
 _addCadastreWMSLayer() {
   if (!this.cadastreWMSLayer) {
     console.error("La couche Cadastre WMS n'a pas été créée.");
     return;
   }
   
   // Vérifier si la couche n'est pas déjà présente
   let layerExists = false;
   for (let i = 0; i < this.map.overlayMapTypes.getLength(); i++) {
     if (this.map.overlayMapTypes.getAt(i) === this.cadastreWMSLayer) {
       layerExists = true;
       break;
     }
   }
   
   if (!layerExists) {
     this.map.overlayMapTypes.push(this.cadastreWMSLayer);
   }
 }

 /**
  * Retire la couche Cadastre WMS de cadastre.gouv.fr
  */
 _removeCadastreWMSLayer() {
   if (!this.cadastreWMSLayer) return;
   
   for (let i = 0; i < this.map.overlayMapTypes.getLength(); i++) {
     if (this.map.overlayMapTypes.getAt(i) === this.cadastreWMSLayer) {
       this.map.overlayMapTypes.removeAt(i);
       break;
     }
   }
   
   // Réinitialiser la couche et le code INSEE
   this.cadastreWMSLayer = null;
   this.currentCadastreCodeInsee = null;
   this.isCadastreWMSVisible = false;
 }

 /**
  * Configure l'écouteur de déplacement pour le cadastre WMS
  * Détecte automatiquement les changements de localisation et recharge le cadastre si nécessaire
  */
 _setupCadastreWMSLocationListener() {
   // Éviter les doublons
   this._removeCadastreWMSLocationListener();
   
   this.cadastreWMSMoveListener = this.map.addListener('idle', async () => {
     // Ne rien faire si le cadastre WMS n'est plus visible
     if (!this.isCadastreWMSVisible) {
       return;
     }
     
     // Debounce de 500ms
     if (this.cadastreDebounceTimeout) {
       clearTimeout(this.cadastreDebounceTimeout);
     }
     
     this.cadastreDebounceTimeout = setTimeout(async () => {
       try {
         const newCenter = this.map.getCenter();
         const newCodeInsee = await GET_CODE_INSEE_BY_COORDINATES(newCenter.lat(), newCenter.lng());
         
         // Si le code INSEE a changé, recharger la couche
         if (newCodeInsee && newCodeInsee !== this.currentCadastreCodeInsee) {
           await this._updateCadastreWMSForNewLocation(newCodeInsee);
         }
       } catch (error) {
         console.error("Erreur lors de la vérification du code INSEE:", error);
         // Ne pas afficher d'erreur à l'utilisateur pour ne pas perturber la navigation
       }
     }, 500);
   });
 }

 /**
  * Supprime l'écouteur de déplacement pour le cadastre WMS
  */
 _removeCadastreWMSLocationListener() {
   if (this.cadastreWMSMoveListener) {
     google.maps.event.removeListener(this.cadastreWMSMoveListener);
     this.cadastreWMSMoveListener = null;
   }
   if (this.cadastreDebounceTimeout) {
     clearTimeout(this.cadastreDebounceTimeout);
     this.cadastreDebounceTimeout = null;
   }
 }

 /**
  * Met à jour la couche cadastre WMS pour une nouvelle localisation
  * @param {string} newCodeInsee - Le nouveau code INSEE
  */
 async _updateCadastreWMSForNewLocation(newCodeInsee) {
   try {
     // Retirer l'ancienne couche
     this._removeCadastreWMSLayer();
     
     // Créer et ajouter la nouvelle couche
     this._createCadastreWMSLayer(newCodeInsee);
     this._addCadastreWMSLayer();
     
     // Restaurer l'état visible
     this.isCadastreWMSVisible = true;
     
   } catch (error) {
     console.error("Erreur lors de la mise à jour du cadastre WMS:", error);
     // En cas d'erreur, on garde l'ancien cadastre visible plutôt que de tout casser
   }
 }

 async toggleCadastreGeoJson() {
   if (this.isGeoJsonVisible) {
     this.clearCadastreGeoJson();
   } else {
     this.showSpinner();
     try {
       this.toggleCadastreLayer(false); // Assurer que la couche WMTS est masquée

       const center = this.map.getCenter();
       const codeInsee = await GET_CODE_INSEE_BY_COORDINATES(center.lat(), center.lng());
       if (!codeInsee) {
         this.errorModal.show("Impossible de déterminer le code INSEE pour cette localisation.");
         this.hideSpinner();
         return;
       }

       const cadastreData = await GET_CADASTRE_DATA(codeInsee);
       this.clearCadastreGeoJson(); // Nettoyer au cas où

       // Stocker les données des parcelles pour un usage ultérieur par le listener de zoom
       this.cadastreParcelles = cadastreData.parcelles;

       // Ajouter les polygones à la carte
       this.geoJsonLayer = this.map.data.addGeoJson(this.cadastreParcelles);
       this.map.data.addGeoJson(cadastreData.batiments);

       // Appliquer le style
       this.map.data.setStyle(feature => {
         const isParcel = feature.getProperty('section') !== undefined;
         return ({
           fillColor: isParcel ? 'transparent' : 'rgba(255, 192, 0, 0.5)',
           strokeColor: isParcel ? 'black' : 'rgb(255, 192, 0)',
           strokeWeight: isParcel ? 1 : 3,
         });
       });

       this.isGeoJsonVisible = true;

       // Mettre à jour les étiquettes pour la vue initiale
       this.updateCadastreLabels();

       // Ajouter l'écouteur de zoom et de déplacement pour mettre à jour les étiquettes
       // On utilise 'idle' pour ne pas surcharger le navigateur pendant le mouvement
       if (!this.zoomListener) {
         this.zoomListener = this.map.addListener('idle', () => this.updateCadastreLabels());
       }

     } catch (error) {
       console.error("Erreur lors de l'affichage du cadastre GeoJSON:", error);
       this.errorModal.show("Une erreur est survenue lors du chargement des données du cadastre.");
     } finally {
       this.hideSpinner();
       this._updateCadastreButtonState();
     }
   }
 }

 updateCadastreLabels() {
   if (!this.map || !this.isGeoJsonVisible) {
     return;
   }

   const zoom = this.map.getZoom();
   
   // Nettoyer les anciennes étiquettes
   this.parcelLabels.forEach(label => label.map = null);
   this.parcelLabels = [];

   // Ne rien afficher si le zoom est trop faible
   if (zoom < 18) {
     return;
   }

   // Obtenir les limites de la carte visible
   const bounds = this.map.getBounds();
   if (!bounds || !this.cadastreParcelles) {
     return;
   }

   // Itérer sur les parcelles stockées et afficher uniquement celles qui sont visibles
   this.cadastreParcelles.features.forEach(feature => {
     if (feature.geometry && feature.geometry.type === 'Polygon' && feature.properties.section && feature.properties.numero) {
       const center = this._getPolygonCenter(feature.geometry);
       
       // Vérifier si le centre de la parcelle est dans les limites de la carte
       if (bounds.contains(center)) {
         const labelText = `${feature.properties.section}${feature.properties.numero}`;
         
         const labelDiv = document.createElement('div');
         labelDiv.textContent = labelText;
         labelDiv.style.cssText = `
           color: black;
           font-weight: bold;
           font-size: 16px;
           text-shadow: -1px -1px 0 #FFF, 1px -1px 0 #FFF, -1px 1px 0 #FFF, 1px 1px 0 #FFF;
         `;

         const parcelLabel = new google.maps.marker.AdvancedMarkerElement({
             position: center,
             content: labelDiv,
             map: this.map
         });
         this.parcelLabels.push(parcelLabel);
       }
     }
   });
 }

 clearCadastreGeoJson() {
   if (this.isGeoJsonVisible) {
     // Supprimer les features de la carte
     this.map.data.forEach(feature => {
       this.map.data.remove(feature);
     });
     
     // Nettoyer les étiquettes
     this.parcelLabels.forEach(label => label.map = null);
     this.parcelLabels = [];

     // Supprimer l'écouteur pour éviter les fuites de mémoire
     if (this.zoomListener) {
       google.maps.event.removeListener(this.zoomListener);
       this.zoomListener = null;
     }

     this.isGeoJsonVisible = false;
     this.geoJsonLayer = null;
     this.cadastreParcelles = null; // Réinitialiser les données des parcelles
     this._updateCadastreButtonState();
   }
 }

  _getPolygonCenter(geometry) {
    let latSum = 0;
    let lngSum = 0;
    let pointCount = 0;

    geometry.coordinates[0].forEach(coord => {
      lngSum += coord[0];
      latSum += coord[1];
      pointCount++;
    });

    return { lat: latSum / pointCount, lng: lngSum / pointCount };
  }

  /**
   * Nettoie tous les listeners et ressources du contrôle
   * À appeler lors de la destruction du contrôle pour éviter les fuites mémoire
   */
  destroy() {
    // Nettoyer tous les menus déroulants
    this.dropdownMenus.forEach(menu => {
      if (menu && typeof menu.destroy === 'function') {
        menu.destroy();
      }
    });
    this.dropdownMenus = [];

    // Nettoyer les listeners Google Maps
    if (this.zoomListener) {
      google.maps.event.removeListener(this.zoomListener);
      this.zoomListener = null;
    }

    if (this.cadastreWMSMoveListener) {
      google.maps.event.removeListener(this.cadastreWMSMoveListener);
      this.cadastreWMSMoveListener = null;
    }

    if (this.cadastreDebounceTimeout) {
      clearTimeout(this.cadastreDebounceTimeout);
      this.cadastreDebounceTimeout = null;
    }

    // Nettoyer le contrôle Enedis s'il existe
    if (this.enedisControl && typeof this.enedisControl.destroy === 'function') {
      this.enedisControl.destroy();
    }

    // Nettoyer les couches GeoJSON
    this.clearCadastreGeoJson();

    // Nettoyer les couches overlay
    this._removeGeoportailLayer();
    this._removeOSMLayer();
    this._removeCadastreWMSLayer();
  }
}

export default MapViewsControl;
