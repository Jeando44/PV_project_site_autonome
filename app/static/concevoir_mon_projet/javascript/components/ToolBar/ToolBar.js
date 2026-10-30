import ErrorModal from "../ErrorModal.js";
// AddressSuggestions est maintenant importé par SearchAddressControl
import {
  GET_CODE_INSEE_BY_COORDINATES,
} from "../../../API/API.js";
import { CUSTOM_EVENTS } from "../DrawingControl/constants.js";
import ResumeCalepinageControl from './components/resuméCalepinage.js';
import ResumeParcellesControl from './components/resuméParcelles.js';
import MapViewsControl from './components/mapViews.js';
import SearchAddressControl from './components/searchAdress.js';
import { ProfilAltimetriqueControl } from '../ProfilAltimetrique/index.js';

class ToolBar {
  constructor(options) {
    this.map = undefined; // Sera défini dans onAdd
    this.container = undefined;
    
    // États globaux gérés par Toolbar, potentiellement modifiés/utilisés par les enfants
    this.isLayerVisible = false; // Pour la couche Cadastre (géré par MapViewsControl via getToolbarContext)
    this.selectedLocation = null; // Code INSEE (géré par Toolbar, utilisé par MapViewsControl)
    this.selectedShapeCenter = null; // Coordonnées (géré par Toolbar, utilisé par MapViewsControl & SearchAddressControl)
    this.is3DMode = false; // (géré par MapViewsControl via getToolbarContext)
    this.cadastreOverlays = []; // (géré par MapViewsControl via getToolbarContext)
    this.parcelles = [];  // (géré par MapViewsControl via getToolbarContext)
    this.parcelleLabels = []; // (géré par MapViewsControl via getToolbarContext)
    
    this.geocoder = null; // Initialisé par google.maps.importLibrary
    this.infowindow = new google.maps.InfoWindow(); // Pour la recherche d'adresse (géré par SearchAddressControl)
    this.marker = null; // Marqueur de recherche d'adresse (géré par SearchAddressControl)
    this.AdvancedMarkerElement = null; // Sera défini par google.maps.importLibrary

    this.onSelectCallback = options.onSelect; // Pour la fonction Cadastre (passé à MapViewsControl)
    
    this.loadingSpinner = this.createSpinner();
    this.errorModal = new ErrorModal();
    
    // --- Initialisation des composants enfants ---
    this.resumeCalepinageControl = new ResumeCalepinageControl({ errorModal: this.errorModal });
    this.resumeParcellesControl = new ResumeParcellesControl({
      errorModal: this.errorModal,
      showSpinner: this.showSpinner.bind(this),
      hideSpinner: this.hideSpinner.bind(this),
      map: this.map, // Sera défini dans onAdd
      getAdvancedMarkerElement: () => this.AdvancedMarkerElement
    });
    this.profilAltimetriqueControl = new ProfilAltimetriqueControl({
      errorModal: this.errorModal,
      showSpinner: this.showSpinner.bind(this),
      hideSpinner: this.hideSpinner.bind(this),
      map: this.map // Sera défini dans onAdd
    });

    const commonButtonIcons = { // Passé à MapViewsControl
      Satellite: "/static/concevoir_mon_projet/medias/icons/satellite.svg",
      Plan: "/static/concevoir_mon_projet/medias/icons/plan.svg",
      Cadastre: "/static/concevoir_mon_projet/medias/icons/cadastre.svg",
      "3D": "/static/concevoir_mon_projet/medias/icons/3D.svg",
      Enedis: "/static/concevoir_mon_projet/medias/icons/enedis.jpeg",
    };

    // Note: this.map n'est pas encore défini ici. MapViewsControl et SearchAddressControl
    // devront soit recevoir la map plus tard (via une méthode setMap ou dans leur getDOMElement),
    // soit accéder à this.map via getToolbarContext() au moment où ils en ont besoin.
    // Pour l'instant, on passe undefined, et on s'assure que this.map est défini dans onAdd avant que les DOM enfants soient créés.
    this.mapViewsControl = new MapViewsControl({
        map: this.map, 
        errorModal: this.errorModal,
        showSpinner: this.showSpinner.bind(this),
        hideSpinner: this.hideSpinner.bind(this),
        onSelectCallbackCadastre: this.onSelectCallback,
        buttonIcons: commonButtonIcons,
        getAdvancedMarkerElement: () => this.AdvancedMarkerElement,
        getToolbarContext: () => this,
    });

    this.searchAddressControl = new SearchAddressControl({
        map: this.map,
        errorModal: this.errorModal,
        getAdvancedMarkerElement: () => this.AdvancedMarkerElement,
        getToolbarContext: () => this,
    });

    // --- Chargement des bibliothèques Google Maps ---
    google.maps
      .importLibrary("geocoding")
      .then(({ Geocoder }) => {
        this.geocoder = new Geocoder();
      })
      .catch((error) => {
        console.error("Erreur lors du chargement de la bibliothèque de géocodage:", error);
      });

    google.maps.importLibrary("marker")
      .then(({ AdvancedMarkerElement }) => {
        this.AdvancedMarkerElement = AdvancedMarkerElement;
      })
      .catch((error) => {
        console.error("Erreur lors du chargement de la bibliothèque de marqueurs:", error);
      });

    // --- Écouteurs d'événements globaux gérés par Toolbar ---
    document.addEventListener(CUSTOM_EVENTS.SHAPE_ADDED, async (event) => {
      try {
        if (event.detail.center) {
          this.updateSelectedShapeCenter(event.detail.center);
          const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
          savedData.selectedShapeCenter = event.detail.center;
          localStorage.setItem("solarProjectData", JSON.stringify(savedData));
          //FIXME - besoin du code insee ??
          const codeInsee = await GET_CODE_INSEE_BY_COORDINATES(
            event.detail.center.lat,
            event.detail.center.lng
          );
          if (codeInsee) {
            this.selectedLocation = codeInsee;
          } else {
            console.warn("Toolbar: Code INSEE non trouvé (SHAPE_ADDED).");
          }
        }
      } catch (error) {
        console.error("Toolbar: Erreur MàJ code INSEE (SHAPE_ADDED):", error);
      }
    });

    document.addEventListener(CUSTOM_EVENTS.SHAPE_REMOVED, (event) => {
        const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
        if (!savedData.shapes || Object.keys(savedData.shapes).length === 0) {
            this.selectedLocation = null;
            this.selectedShapeCenter = null;
            delete savedData.selectedShapeCenter;
            localStorage.setItem("solarProjectData", JSON.stringify(savedData));
            
            if (this.isLayerVisible && this.mapViewsControl) { // Vérifier si mapViewsControl est initialisé
                // Demander à MapViewsControl de gérer la désactivation de la couche cadastre
                // Cela se fera via la logique interne de toggleCadastreLayer si appelé
                // ou en mettant à jour l'état du bouton cadastre.
                // Pour l'instant, on s'assure que l'état interne de Toolbar est correct.
                // MapViewsControl reflétera cet état.
                this.isLayerVisible = false; // Toolbar met à jour son état
                // MapViewsControl devrait refléter ce changement (par exemple, lors d'un prochain updateButtonSelection)
                // ou Toolbar pourrait explicitement appeler une méthode sur mapViewsControl pour rafraîchir l'état du bouton.
                const cadastreButton = this.mapViewsControl.getDOMElement().querySelector('button[title="Vue Cadastre"]');
                if (cadastreButton) {
                    this.mapViewsControl.updateButtonSelection(cadastreButton); // Pour forcer la mise à jour visuelle
                }
            }
        }
    });
  }

  createHideButton(id) {
    const hideButton = document.createElement("button");
    hideButton.classList.add(`hide-style-switcher-button-${id}`); // Garder la classe pour CSS existant
    
    const isInitiallyCollapsed = id === "3" || id === "4";
    
    let titleText = "";
    switch(id) {
        case "1": titleText = "Masquer les contrôles"; break;
        case "2": titleText = "Masquer le résumé du calepinage"; break;
        case "3": titleText = isInitiallyCollapsed ? "Afficher le résumé des parcelles" : "Masquer le résumé des parcelles"; break;
        case "4": titleText = isInitiallyCollapsed ? "Afficher les profils altimétriques" : "Masquer les profils altimétriques"; break;
    }
    hideButton.title = titleText;

    // Styles initiaux avec transitions et sécurités d'affichage (protection contre la disparition)
    hideButton.style.cssText = `
        background-color: white !important; border: none !important; padding: 0 10px !important;
        z-index: 9999 !important; 
        pointer-events: auto !important; cursor: pointer !important; display: flex !important;
        align-items: center !important; justify-content: center !important; opacity: 1 !important;
        box-shadow: -2px 0 5px rgba(0,0,0,0.15) !important; transition: all 0.3s ease-in-out !important;
        position: relative !important; flex: 0 0 auto !important; min-width: 32px !important; min-height: 36px !important;
        visibility: visible !important; transform: none !important; overflow: visible !important; margin: 0 !important;
    `;
    hideButton.style.borderRadius = isInitiallyCollapsed ? "0 8px 8px 0" : "8px 0 0 8px";
    hideButton.style.height = isInitiallyCollapsed ? "80px" : "auto";
    
    const initialRotation = isInitiallyCollapsed ? "rotate(-180deg)" : "rotate(0deg)";
    hideButton.innerHTML = `<i id='hide-toolbar-button-icon-${id}' class='fas fa-chevron-left' style="font-size: 16px; transform: ${initialRotation}; transition: transform 0.3s ease-in-out;"></i>`;

    hideButton.addEventListener("click", () => {
      const containerConfig = {
        "1": { selector: ".buttons-and-search-container", hideTitle: "Masquer les contrôles", showTitle: "Afficher les contrôles" },
        "2": { selector: ".résumé-container", hideTitle: "Masquer le résumé du calepinage", showTitle: "Afficher le résumé du calepinage" },
        "3": { selector: ".parcelles-container", hideTitle: "Masquer le résumé des parcelles", showTitle: "Afficher le résumé des parcelles" },
        "4": { selector: ".profil-altimetrique-container", hideTitle: "Masquer les profils altimétriques", showTitle: "Afficher les profils altimétriques" }
      };

      const config = containerConfig[id];
      if (!config) return;
      const targetContainer = document.querySelector(config.selector);
      if (!targetContainer) return;

      // Bascule de la classe CSS pour masquer le conteneur principal (le JS ne force plus de display: none ici)
      targetContainer.classList.toggle("collapsed");
      const isCollapsed = targetContainer.classList.contains("collapsed");
      hideButton.title = isCollapsed ? config.showTitle : config.hideTitle;

      // Modification fluide de l'apparence du bouton pour accompagner la fermeture
      hideButton.style.borderRadius = isCollapsed ? "0 8px 8px 0" : "8px 0 0 8px";
      hideButton.style.height = isCollapsed ? "80px" : "auto";
      
      // Rotation ciblée de l'icône sans détruire le DOM interne du bouton
      const icon = hideButton.querySelector(`#hide-toolbar-button-icon-${id}`);
      if (icon) {
        icon.style.transform = isCollapsed ? "rotate(-180deg)" : "rotate(0deg)";
      }
    });
    return hideButton;
  }

  createSpinner() {
    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    spinner.style.cssText = `
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 50px; height: 50px; border: 5px solid #f3f3f3;
            border-top: 5px solid #3498db; border-radius: 50%;
            animation: spin 1s linear infinite; display: none; z-index: 1000;`;
    const style = document.createElement("style");
    style.textContent = `
            @keyframes spin { 0% { transform: translate(-50%, -50%) rotate(0deg); } 100% { transform: translate(-50%, -50%) rotate(360deg); } }
            @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }`;
    document.head.appendChild(style);
    const mapContainer = document.getElementById("map");
    if (mapContainer) mapContainer.appendChild(spinner);
    return spinner;
  }

  showSpinner() {
    this.loadingSpinner.style.display = "block";
    this.loadingSpinner.style.opacity = "1";
  }

  hideSpinner() {
    this.loadingSpinner.style.animation = "fadeOut 0.1s ease-out";
    setTimeout(() => {
      this.loadingSpinner.style.display = "none";
      this.loadingSpinner.style.animation = "";
    }, 500);
  }

  updateSelectedLocation(location) {
    this.selectedLocation = location;
  }

  updateSelectedShapeCenter(center) {
    if (center) {
      this.selectedShapeCenter = center;
    }
  }

  async onAdd(map) {
    this.map = map;
    // Mettre à jour la map pour les composants enfants qui en dépendent
    this.mapViewsControl.map = map;
    this.mapViewsControl.initMapDependentComponents(); // Initialiser les composants dépendant de la carte
    this.searchAddressControl.map = map;
    
    // Initialiser le ParcelleMarkerManager avec la map
    this.resumeParcellesControl.initializeWithMap(map);
    //this.resumeParcellesControl.map = map; // Ajout JJD temporairement
    
    // Initialiser le ProfilAltimetriqueManager avec la map
    this.profilAltimetriqueControl.initializeWithMap(map);

    this.container = document.createElement("div");
    this.container.className = "custom-map-control";
    this.container.style.cssText = `
            border-radius: 0 8px 8px 0; display: flex; flex-direction: column;
            flex-wrap: wrap; align-items: start; justify-content: start;
            margin: 2px 10px; gap: 0; z-index: 1000; background-color: transparent;
            pointer-events: none;`;


    this.buttonsAndSearchContainer = this.createButtonsAndSearchContainer(); 
    
    const mapViewsDOM = this.mapViewsControl.getDOMElement();
    // searchAddressControl._createSearchContainer est maintenant synchrone car AddressSuggestions.create() est synchrone
    const searchAddressDOMPromise = this.searchAddressControl.getDOMElement(); // Ceci est une Promesse
    const searchAddressDOM = await searchAddressDOMPromise; // Attendre que la Promesse se résolve en un nœud DOM

    //  FIX : Forcer la visibilité du champ de recherche d'adresse (ligne 286-292)
   // if (searchAddressDOM) {
   //   searchAddressDOM.classList.remove('d-none', 'hidden');
   //   searchAddressDOM.style.display = 'block';
      // Retirer aussi les classes d'invisibilité sur l'input lui-même
   //   const inputs = searchAddressDOM.querySelectorAll('input');
   //   inputs.forEach(input => input.classList.remove('d-none', 'hidden'));
   // }

    this.buttonsAndSearchContainer.appendChild(mapViewsDOM);
    this.buttonsAndSearchContainer.appendChild(searchAddressDOM);

    this.innerContainer1 = this.createInnerControlContainer("1");
    this.innerContainer1.appendChild(this.createHideButton("1"));
    this.innerContainer1.appendChild(this.buttonsAndSearchContainer);

    this.innerContainer2 = this.createInnerControlContainer("2");
    this.innerContainer2.appendChild(this.createHideButton("2"));
    this.innerContainer2.appendChild(this.resumeCalepinageControl.getDOMElement());

    this.innerContainer3 = this.createInnerControlContainer("3");
    this.innerContainer3.appendChild(this.createHideButton("3"));
    const parcellesDOM = this.resumeParcellesControl.getDOMElement();
    if (parcellesDOM) parcellesDOM.classList.add("collapsed");
    this.innerContainer3.appendChild(parcellesDOM);

    this.innerContainer4 = this.createInnerControlContainer("4");
    this.innerContainer4.appendChild(this.createHideButton("4"));
    const profilDOM = this.profilAltimetriqueControl.getDOMElement();
    if (profilDOM) profilDOM.classList.add("collapsed");
    this.innerContainer4.appendChild(profilDOM);

    this.container.appendChild(this.innerContainer1);
    this.container.appendChild(this.innerContainer2);
    this.container.appendChild(this.innerContainer3);
    this.container.appendChild(this.innerContainer4);

    this.map.controls[google.maps.ControlPosition.TOP_LEFT].push(this.container);
    
    this.map.setMapTypeId("hybrid");
    const satelliteButtonInitial = mapViewsDOM.querySelector('button[title="Vue Satellite"]');
    if (satelliteButtonInitial) {
        this.mapViewsControl.updateButtonSelection(satelliteButtonInitial);
    }
    // Réappliquer le fond de carte / cadastre choisis avant l'actualisation
    // (la carte est déjà centrée : le cadastre WMS dépend du code INSEE du centre)
    this.mapViewsControl.restoreSavedLayers();

    return this.container;
  }

  createInnerControlContainer(id) {
    const innerContainer = document.createElement("div");
    innerContainer.classList.add(`style-switcher-control-inner-container-${id}`); // Garder la classe pour CSS existant
    innerContainer.style.cssText = `
      display: flex; height: auto; width: fit-content; flex-direction: row; align-items: stretch;
      gap:0; border-radius: 0 8px 8px 0; background-color: transparent; position: relative; ${id !== "1" ? "margin-top: 0.5rem;" : ""};`;
    return innerContainer;
  }

  createButtonsAndSearchContainer() {
    const container = document.createElement("div");
    container.classList.add("buttons-and-search-container"); // Garder la classe pour CSS existant
    container.style.cssText = `
      display: flex; flex-direction: row; height: 100%; min-height: fit-content;
      width: fit-content; gap: 10px; border-radius: 0 8px 8px 0; background-color: hsla(0, 0%, 90%, 0.5);
      align-items: center; /* Pour bien aligner les boutons de vue et la recherche */
      pointer-events: auto;
      `;
    // Le style responsive pour ce conteneur est maintenant géré dans sa propre feuille CSS ou globalement.
    // Si besoin spécifique ici, il peut être ajouté.
    // Pour l'instant, on assume que le CSS global gère la responsivité de .buttons-and-search-container
    // et de ses enfants .map-views-buttons-container et .search-address-container.
    // Exemple de style qui pourrait être nécessaire si les enfants ne s'adaptent pas bien :
    const responsiveStyle = document.createElement("style");
    responsiveStyle.textContent = `
        @media (max-width: 1024px) {
            .buttons-and-search-container {
                flex-direction: column !important;
                align-items: stretch !important; /* S'assurer que les enfants prennent la largeur */
            }
            .map-views-buttons-container { /* Conteneur des boutons de vue */
                 display: flex;
                 flex-direction: row; /* Garder les boutons de vue en ligne */
                 justify-content: space-around; /* Espacer les boutons de vue */
                 width: 100%; /* Prendre toute la largeur */
                 margin-bottom: 5px; /* Marge si empilé au-dessus de la recherche */
            }
            .search-address-container { /* Conteneur de la recherche */
                width: 100%; /* Prendre toute la largeur */
            }
        }
    `;
    document.head.appendChild(responsiveStyle);
    
    return container;
  }

  // Méthodes supprimées car déplacées vers MapViewsControl:
  // - createButton
  // - toggleCadastreLayer
  // - getLayerColor
  // - updateParcelleLabels
  // - calculatePolygonCenter
  // - calculatePolygonArea
  // - updateButtonSelection (Toolbar n'a plus ses propres boutons de vue à gérer directement)

  // Méthodes supprimées car déplacées vers SearchAddressControl:
  // - createSearchContainer
  // - handleAddressSelection

  getContainer() { // Reste utile si d'autres parties du code ont besoin du conteneur principal
    return this.container;
  }

  // getInseeByCoordinates reste car c'est une utilitaire de Toolbar pour le moment,
  // bien que sa logique principale soit aussi dans l'écouteur SHAPE_ADDED.
  async getInseeByCoordinates(lat, lng) { 
    try {
      const codeInsee = await GET_CODE_INSEE_BY_COORDINATES(lat, lng);
      if (codeInsee) {
        this.updateSelectedLocation(codeInsee);
        this.updateSelectedShapeCenter({ lat, lng });
        return true;
      }
    } catch (error) {
      console.error("Toolbar: Erreur getInseeByCoordinates:", error);
      if (this.errorModal) this.errorModal.show("Impossible de déterminer le code INSEE pour ces coordonnées");
    }
    return false;
  }
}

export default ToolBar;
