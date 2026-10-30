import AddressSuggestions from "../../AddressSuggestions.js";
import { CUSTOM_EVENTS } from "../../DrawingControl/constants.js";

class SearchAddressControl {
  constructor(options) {
    this.map = options.map;
    this.errorModal = options.errorModal;
    this.getAdvancedMarkerElement = options.getAdvancedMarkerElement;
    this.toolbarContext = options.getToolbarContext(); // () => Toolbar instance (this)
    
    this.addressSuggestions = null; // Sera initialisé dans createSearchContainer
    this.searchContainer = this._createSearchContainer();
  }

  getDOMElement() {
    return this.searchContainer;
  }

  async _createSearchContainer() {
    const container = document.createElement("div");
    container.className = "search-address-container"; // Classe spécifique
    container.style.cssText = `
      position: relative; display: none; align-items: center; padding: 5px;
      border-bottom: 1px solid #eee; background-color: hsla(0, 0%, 100%, 0.7);
      height: 100%; width: 100%; border-radius: 4px; z-index: 1000;
      flex-grow: 1; /* Permet au conteneur de recherche de prendre plus de place si nécessaire */
      min-width:25vw; /* Assure que le conteneur de recherche a une largeur minimale */
    `;

    const searchIcon = document.createElement("img");
    searchIcon.src = "/static/concevoir_mon_projet/medias/icons/search.svg";
    searchIcon.style.cssText = `width: 18px; height: 18px; margin-right: 8px;`;

    this.addressSuggestions = new AddressSuggestions({
      placeholder: 'Rechercher un lieu ou latitude, longitude au format "48.8566, 2.3522" ....',
      onPlaceSelected: async (placeData) => {
        await this._handleAddressSelection(placeData);
      },
      onError: (error) => {
        console.error("❌ Erreur dans les suggestions d'adresses:", error);
        if (this.errorModal) this.errorModal.show("Erreur lors de la recherche d'adresse");
      }
    });

    const suggestionComponent = this.addressSuggestions.create();
    const input = suggestionComponent.querySelector('input');
    if (input) {
      input.style.cssText = `
        border: none; padding: 5px; width: 100%; /* Prend toute la largeur du composant de suggestion */
        font-size: 14px; outline: none; text-align: left; /* Changé pour left pour une meilleure UX */
        background-color: hsla(0, 0%, 100%, 0.5); flex-grow: 1;
      `;
    }
    
    // Style pour le conteneur de suggestion lui-même pour qu'il s'étende
    suggestionComponent.style.flexGrow = "1";


    container.appendChild(searchIcon);
    container.appendChild(suggestionComponent);
    return container;
  }

  async _handleAddressSelection(placeData) {
    const toolbar = this.toolbarContext;
    const AdvancedMarkerElement = this.getAdvancedMarkerElement();
    if (!AdvancedMarkerElement) {
        console.error("AdvancedMarkerElement n'est pas disponible.");
        if (this.errorModal) this.errorModal.show("Erreur interne: Le composant de marqueur n'est pas chargé.");
        return;
    }

    try {
      const { place, coordinates, codeInsee, formattedAddress: providedFormattedAddress } = placeData;
      let addressToStore = providedFormattedAddress;
      let currentCoordinates = coordinates;

      if (place && place.location) {
        currentCoordinates = { lat: place.location.lat(), lng: place.location.lng() };
        this.map.setCenter(place.location);
        this.map.setZoom(17);
        if (toolbar.marker && toolbar.marker.setMap) toolbar.marker.setMap(null);
        toolbar.marker = new AdvancedMarkerElement({ position: place.location, map: this.map });
        addressToStore = place.formattedAddress || addressToStore;
        toolbar.infowindow.setContent(addressToStore);
        toolbar.infowindow.open(this.map, toolbar.marker);
      } else if (currentCoordinates) {
        const latLng = new google.maps.LatLng(currentCoordinates.lat, currentCoordinates.lng);
        this.map.setCenter(latLng);
        this.map.setZoom(17);
        if (toolbar.marker && toolbar.marker.setMap) toolbar.marker.setMap(null);
        toolbar.marker = new AdvancedMarkerElement({ position: latLng, map: this.map });
        if (toolbar.geocoder) {
          try {
            const response = await toolbar.geocoder.geocode({ location: latLng });
            if (response.results && response.results.length > 0) {
              addressToStore = response.results[0].formatted_address;
              toolbar.infowindow.setContent(addressToStore);
              toolbar.infowindow.open(this.map, toolbar.marker);
            }
          } catch (error) {
            console.error("Erreur de géocodage inversé:", error);
          }
        }
      }

      if (codeInsee) toolbar.updateSelectedLocation(codeInsee);
      if (currentCoordinates) toolbar.updateSelectedShapeCenter(currentCoordinates);

      const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
      // if (addressToStore) savedData.projectAddress = addressToStore;
      // if (currentCoordinates) savedData.selectedShapeCenter = currentCoordinates; // Assurer que le centre est aussi stocké
      localStorage.setItem("solarProjectData", JSON.stringify(savedData));
      
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER));

    } catch (error) {
      console.error("Erreur lors de la gestion de la sélection d'adresse:", error);
      if (this.errorModal) this.errorModal.show("Erreur lors du traitement de l'adresse sélectionnée");
    }
  }
}

export default SearchAddressControl;