import { GET_CODE_INSEE_BY_NAME, GET_CODE_INSEE_BY_COORDINATES, GET_CADASTRE_DATA } from "../../API/API.js";
import ErrorModal from "./ErrorModal.js";

/**
 * Classe réutilisable pour les suggestions d'adresses avec Google Maps Places API (nouvelle version)
 * et récupération automatique du cadastre
 */
class AddressSuggestions {
  constructor(options = {}) {
    this.container = null;
    this.input = null;
    this.suggestionsList = null;
    this.currentSuggestions = [];
    this.selectedSuggestionIndex = -1;
    this.sessionToken = null;
    this.errorModal = new ErrorModal();
    
    // Callbacks
    this.onPlaceSelected = options.onPlaceSelected || (() => {});
    this.onCadastreLoaded = options.onCadastreLoaded || (() => {});
    this.onError = options.onError || (() => {});
    
    // Configuration
    this.placeholder = options.placeholder || 'Rechercher une adresse...';
    this.language = options.language || 'fr';
    this.region = 'fr';
    this.country = 'fr';
    this.includedRegionCodes = ['fr'];
    this.includedPrimaryTypes = options.includedPrimaryTypes || [
      "street_address", 
      "route", 
      "neighborhood", 
      "locality", 
      "administrative_area_level_1"
    ];
    
    // API Places
    this.Place = null;
    this.AutocompleteSessionToken = null;
    this.AutocompleteSuggestion = null;
    this.franceBounds = null;
    
    // Initialiser les APIs Google Maps
    this.initializeGoogleMapsAPIs();
  }

  /**
   * Initialise les APIs Google Maps nécessaires
   */
  async initializeGoogleMapsAPIs() {
    try {
      const { Place, AutocompleteSessionToken, AutocompleteSuggestion } = 
        await google.maps.importLibrary("places");
      
      this.Place = Place;
      this.AutocompleteSessionToken = AutocompleteSessionToken;
      this.AutocompleteSuggestion = AutocompleteSuggestion;
      
      // Définir les limites de la France
      this.franceBounds = new google.maps.LatLngBounds(
        new google.maps.LatLng(39.0, -7.0),
        new google.maps.LatLng(53.5, 12.0)
      );
      
    } catch (error) {
      console.error("Erreur lors de l'initialisation des APIs Google Maps:", error);
      this.onError(error);
    }
  }

  /**
   * Crée et retourne l'élément DOM complet pour les suggestions
   * @param {HTMLElement} parentContainer - Conteneur parent où insérer le composant
   * @returns {HTMLElement} Le conteneur du composant
   */
  create(parentContainer) {
    this.container = document.createElement("div");
    this.container.className = "address-suggestions-container";
    this.container.style.cssText = `
      position: relative;
      width: 100%;
    `;

    // Créer l'input
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.placeholder = this.placeholder;
    this.input.className = "address-suggestions-input";
    this.input.style.cssText = `
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e1e5e9;
      border-radius: 8px;
      font-size: 16px;
      outline: none;
      transition: border-color 0.3s ease;
    `;

    // Créer la liste des suggestions
    this.suggestionsList = document.createElement("div");
    this.suggestionsList.className = "address-suggestions-list";
    this.suggestionsList.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      background: white;
      border: 1px solid #ddd;
      border-top: none;
      border-radius: 0 0 8px 8px;
      max-height: 200px;
      overflow-y: auto;
      z-index: 9999;
      display: none;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    `;

    this.container.appendChild(this.input);
    this.container.appendChild(this.suggestionsList);

    if (parentContainer) {
      parentContainer.appendChild(this.container);
    }

    this.initializeEventListeners();
    return this.container;
  }

  /**
   * Initialise les écouteurs d'événements
   */
  initializeEventListeners() {
    let debounceTimer;
    
    // Écouteur pour la saisie utilisateur
    this.input.addEventListener("input", async (event) => {
      const query = event.target.value.trim();
      
      clearTimeout(debounceTimer);
      
      if (query.length < 3) {
        this.hideSuggestions();
        return;
      }

      // Vérifier si c'est un format de coordonnées
      const coordsPattern = /^["']?(?:(?:(?<lat>\d{1,2})°(?<latMin>\d{1,2})'(?<latSec>\d{1,2})"(?<latDir>[NS]))\s*(?:(?<lng>\d{1,2})°(?<lngMin>\d{1,2})'(?<lngSec>\d{1,2})"(?<lngDir>[EW]))|(?<decLat>-?\d+(\.\d+)?)\s*,\s*(?<decLng>-?\d+(\.\d+)?))["']?$/;
      
      if (query.match(coordsPattern)) {
        this.hideSuggestions();
        await this.handleCoordinateInput(query);
        return;
      }

      // Debounce pour éviter trop d'appels API
      debounceTimer = setTimeout(async () => {
        await this.fetchSuggestions(query);
      }, 300);
    });

    // Gestion des touches du clavier
    this.input.addEventListener("keydown", async (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.navigateSuggestions(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        this.navigateSuggestions(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        await this.handleEnterKey();
      } else if (event.key === "Escape") {
        this.hideSuggestions();
      }
    });

    // Focus et blur
    this.input.addEventListener("focus", () => {
      this.input.style.borderColor = "#007bff";
    });

    this.input.addEventListener("blur", () => {
      this.input.style.borderColor = "#e1e5e9";
      // Retarder la fermeture pour permettre le clic sur les suggestions
      setTimeout(() => this.hideSuggestions(), 150);
    });

    // Masquer les suggestions quand on clique ailleurs
    document.addEventListener("click", (event) => {
      if (!this.container.contains(event.target)) {
        this.hideSuggestions();
      }
    });
  }

  /**
   * Récupère les suggestions depuis l'API Places
   */
  async fetchSuggestions(query) {
    try {
      if (!this.AutocompleteSuggestion) {
        await this.initializeGoogleMapsAPIs();
      }

      // Créer un nouveau token de session si nécessaire
      if (!this.sessionToken) {
        this.sessionToken = new this.AutocompleteSessionToken();
      }

      // Créer la requête d'autocomplétion
      const request = {
        input: query,
        sessionToken: this.sessionToken,
        includedRegionCodes: this.includedRegionCodes,
        region: this.region,
        includedPrimaryTypes: this.includedPrimaryTypes,
        language: this.language,
      
      };

      // Récupérer les suggestions
      const { suggestions } = await this.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
      
      this.currentSuggestions = suggestions || [];
      this.displaySuggestions();
      
    } catch (error) {
      console.error("Erreur lors de la récupération des suggestions:", error);
      this.hideSuggestions();
      this.onError(error);
    }
  }

  /**
   * Affiche les suggestions dans la liste
   */
  displaySuggestions() {
    this.suggestionsList.innerHTML = "";
    
    if (this.currentSuggestions.length === 0) {
      this.hideSuggestions();
      return;
    }

    this.currentSuggestions.forEach((suggestion, index) => {
      const suggestionElement = document.createElement("div");
      suggestionElement.className = "suggestion-item";
      suggestionElement.style.cssText = `
        padding: 12px 16px;
        cursor: pointer;
        border-bottom: 1px solid #f0f0f0;
        font-size: 14px;
        transition: background-color 0.2s ease;
      `;
      
      // Formatage du texte de suggestion
      const placePrediction = suggestion.placePrediction;
      const mainText = placePrediction.text.text;
      const secondaryText = placePrediction.structuredFormat?.secondaryText?.text || "";
      
      suggestionElement.innerHTML = `
        <div style="font-weight: 600; color: #333; margin-bottom: 2px;">${mainText}</div>
        ${secondaryText ? `<div style="font-size: 12px; color: #666;">${secondaryText}</div>` : ''}
      `;

      // Gestion du survol
      suggestionElement.addEventListener("mouseenter", () => {
        this.highlightSuggestion(index);
      });

      // Gestion du clic
      suggestionElement.addEventListener("click", async () => {
        await this.selectSuggestion(index);
      });

      this.suggestionsList.appendChild(suggestionElement);
    });

    this.selectedSuggestionIndex = -1;
    this.suggestionsList.style.display = "block";
  }

  /**
   * Masque les suggestions
   */
  hideSuggestions() {
    this.suggestionsList.style.display = "none";
    this.selectedSuggestionIndex = -1;
  }

  /**
   * Navigue dans les suggestions avec les flèches
   */
  navigateSuggestions(direction) {
    if (this.currentSuggestions.length === 0) return;

    this.selectedSuggestionIndex += direction;
    
    if (this.selectedSuggestionIndex < 0) {
      this.selectedSuggestionIndex = this.currentSuggestions.length - 1;
    } else if (this.selectedSuggestionIndex >= this.currentSuggestions.length) {
      this.selectedSuggestionIndex = 0;
    }
    
    this.highlightSuggestion(this.selectedSuggestionIndex);
  }

  /**
   * Met en surbrillance une suggestion
   */
  highlightSuggestion(index) {
    // Retirer la sélection précédente
    const previousSelected = this.suggestionsList.querySelector(".selected");
    if (previousSelected) {
      previousSelected.classList.remove("selected");
      previousSelected.style.backgroundColor = "";
    }

    // Ajouter la nouvelle sélection
    if (index >= 0 && index < this.suggestionsList.children.length) {
      const suggestionElement = this.suggestionsList.children[index];
      suggestionElement.classList.add("selected");
      suggestionElement.style.backgroundColor = "#f8f9fa";
      this.selectedSuggestionIndex = index;
    }
  }

  /**
   * Gère la touche Entrée
   */
  async handleEnterKey() {
    const value = this.input.value.trim();
    
    // Vérifier si c'est un format de coordonnées
    const coordsPattern = /^["']?(?:(?:(?<lat>\d{1,2})°(?<latMin>\d{1,2})'(?<latSec>\d{1,2})"(?<latDir>[NS]))\s*(?:(?<lng>\d{1,2})°(?<lngMin>\d{1,2})'(?<lngSec>\d{1,2})"(?<lngDir>[EW]))|(?<decLat>-?\d+(\.\d+)?)\s*,\s*(?<decLng>-?\d+(\.\d+)?))["']?$/;
    
    if (value.match(coordsPattern)) {
      await this.handleCoordinateInput(value);
      return;
    }

    // Si une suggestion est sélectionnée, l'utiliser
    if (this.selectedSuggestionIndex >= 0 && this.selectedSuggestionIndex < this.currentSuggestions.length) {
      await this.selectSuggestion(this.selectedSuggestionIndex);
    } else if (this.currentSuggestions.length > 0) {
      // Sinon, utiliser la première suggestion
      await this.selectSuggestion(0);
    }
  }

  /**
   * Sélectionne une suggestion
   */
  async selectSuggestion(index) {
    try {
      const suggestion = this.currentSuggestions[index];
      if (!suggestion) return;

      // Convertir la prédiction en objet Place
      const place = suggestion.placePrediction.toPlace();
      
      // Récupérer les détails du lieu
      await place.fetchFields({
        fields: ["displayName", "formattedAddress", "location", "addressComponents"]
      });

      // Mettre à jour l'input
      this.input.value = place.formattedAddress;

      // Masquer les suggestions
      this.hideSuggestions();
      
      // Réinitialiser le token de session après utilisation
      this.sessionToken = null;

      // Traiter le lieu sélectionné et récupérer le cadastre
      await this.handlePlaceSelection(place);
      
    } catch (error) {
      console.error("Erreur lors de la sélection de la suggestion:", error);
      this.errorModal.show("Erreur lors de la récupération des détails du lieu");
      this.onError(error);
    }
  }

  /**
   * Traite le lieu sélectionné et récupère le cadastre
   */
  async handlePlaceSelection(place) {
    try {
      // Récupérer la ville pour le code INSEE
      let ville = "";
      if (place.addressComponents) {
        place.addressComponents.forEach((component) => {
          if (component.types.includes("locality")) {
            ville = component.longText;
          }
        });
      }

      let codeInsee = null;
      
      if (ville) {
        try {
          codeInsee = await GET_CODE_INSEE_BY_NAME(ville);
        } catch (error) {
          console.error("Erreur lors de la récupération du code INSEE par nom:", error);
          // Fallback vers les coordonnées
          codeInsee = await GET_CODE_INSEE_BY_COORDINATES(
            place.location.lat(), 
            place.location.lng()
          );
        }
      } else {
        // Si aucune ville n'est trouvée, utiliser directement les coordonnées
        codeInsee = await GET_CODE_INSEE_BY_COORDINATES(
          place.location.lat(), 
          place.location.lng()
        );
      }

      // Récupérer le cadastre si on a un code INSEE
      let cadastreData = null;
      if (codeInsee) {
        try {
          cadastreData = await GET_CADASTRE_DATA(codeInsee);
        } catch (error) {
          console.error("Erreur lors de la récupération du cadastre:", error);
        }
      }

      // Callback avec toutes les informations
      this.onPlaceSelected({
        place,
        ville,
        codeInsee,
        coordinates: {
          lat: place.location.lat(),
          lng: place.location.lng()
        }
      });

      // Callback spécifique pour le cadastre
      if (cadastreData) {
        this.onCadastreLoaded(cadastreData, codeInsee);
      }

    } catch (error) {
      console.error("Erreur lors du traitement du lieu sélectionné:", error);
      this.errorModal.show("Erreur lors du traitement du lieu sélectionné");
      this.onError(error);
    }
  }

  /**
   * Gère l'entrée de coordonnées
   */
  async handleCoordinateInput(value) {
    const coordsPattern = /^["']?(?:(?:(?<lat>\d{1,2})°(?<latMin>\d{1,2})'(?<latSec>\d{1,2})"(?<latDir>[NS]))\s*(?:(?<lng>\d{1,2})°(?<lngMin>\d{1,2})'(?<lngSec>\d{1,2})"(?<lngDir>[EW]))|(?<decLat>-?\d+(\.\d+)?)\s*,\s*(?<decLng>-?\d+(\.\d+)?))["']?$/;
    
    const match = value.match(coordsPattern);
    if (!match) return;

    let lat, lng;

    // Vérifier si c'est le format DMS
    if (match.groups.lat) {
      lat = this.convertDMSToDecimal(
        parseInt(match.groups.lat),
        parseInt(match.groups.latMin),
        parseInt(match.groups.latSec),
        match.groups.latDir
      );

      lng = this.convertDMSToDecimal(
        parseInt(match.groups.lng),
        parseInt(match.groups.lngMin),
        parseInt(match.groups.lngSec),
        match.groups.lngDir
      );
    } else {
      // Format décimal
      lat = parseFloat(match.groups.decLat);
      lng = parseFloat(match.groups.decLng);
    }

    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      try {
        // Récupérer le code INSEE
        const codeInsee = await GET_CODE_INSEE_BY_COORDINATES(lat, lng);
        
        // Récupérer le cadastre
        let cadastreData = null;
        if (codeInsee) {
          cadastreData = await GET_CADASTRE_DATA(codeInsee);
        }

        // Callback avec les informations
        this.onPlaceSelected({
          place: null,
          ville: null,
          codeInsee,
          coordinates: { lat, lng }
        });

        // Callback pour le cadastre
        if (cadastreData) {
          this.onCadastreLoaded(cadastreData, codeInsee);
        }

      } catch (error) {
        console.error("Erreur lors du traitement des coordonnées:", error);
        this.onError(error);
      }
    } else {
      this.errorModal.show("Coordonnées invalides. Format attendu: latitude (-90 à 90), longitude (-180 à 180)");
    }
  }

  /**
   * Convertit les coordonnées DMS en décimal
   */
  convertDMSToDecimal(degrees, minutes, seconds, direction) {
    let decimal = degrees + minutes / 60 + seconds / 3600;
    if (direction === "S" || direction === "W") {
      decimal = -decimal;
    }
    return decimal;
  }

  /**
   * Définit la valeur de l'input
   */
  setValue(value) {
    if (this.input) {
      this.input.value = value;
    }
  }

  /**
   * Récupère la valeur de l'input
   */
  getValue() {
    return this.input ? this.input.value : '';
  }

  /**
   * Nettoie l'input et masque les suggestions
   */
  clear() {
    if (this.input) {
      this.input.value = '';
    }
    this.hideSuggestions();
    this.currentSuggestions = [];
    this.sessionToken = null;
  }

  /**
   * Détruit le composant
   */
  destroy() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.input = null;
    this.suggestionsList = null;
    this.currentSuggestions = [];
    this.sessionToken = null;
  }
}

export default AddressSuggestions;
