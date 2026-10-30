import { CONFIG } from './config.js';
import { Utils } from './utils.js';
import { adresseCourteDepuisGoogle, raccourcirTexteAdresse } from './adresseCourte.js';

export class AddressSearch {
    constructor(map, coordinateManager) {
        this.map = map;
        this.coordinateManager = coordinateManager;
        this.sessionToken = null;
        this.PlacesLibrary = null;
        this.currentPredictions = {};
        this.currentMarker = null;
        this.currentCircle = null;
        this.geocoder = null;
    }

    async initialize() {
        await this.initPlacesLibrary();
        this.setupAddressInputs();
        this.geocoder = new google.maps.Geocoder();
        console.log('AddressSearch initialized');
    }

    async initPlacesLibrary() {
        try {
            this.PlacesLibrary = await google.maps.importLibrary('places');
            this.sessionToken = new this.PlacesLibrary.AutocompleteSessionToken();
        } catch (error) {
            console.error('Error initializing Places library:', error);
            throw error;
        }
    }

    setupAddressInputs() {
        this.setupAddressInput('parametreProjectSearch', 'parametreProject');
    }

    setupAddressInput(inputId, mode) {
        const input = document.getElementById(inputId);
        if (!input) return;

        const suggestionsContainer = document.getElementById('parametreProjectSuggestions');
        if (!suggestionsContainer) return;

        const debouncedSearch = Utils.debounce(query => {
            if (input._autosuggestionDisabled) return;
            this.searchAddresses(query, suggestionsContainer, input, mode);
        }, CONFIG.debounceDelay || 300);

        input.addEventListener('input', e => {
            if (input._autosuggestionDisabled) return;
            const query = e.target.value.trim();
            if (query.length < 3) {
                Utils.hideSuggestions(suggestionsContainer);
                return;
            }
            debouncedSearch(query);
        });

        input.addEventListener('blur', () => {
            setTimeout(() => Utils.hideSuggestions(suggestionsContainer), 200);
        });

        suggestionsContainer.addEventListener('click', e => {
            const suggestion = e.target.closest('.address-suggestion');
            if (suggestion) {
                const index = Array.from(suggestionsContainer.children).indexOf(suggestion);
                this.selectSuggestion(index, suggestionsContainer, input, mode);
            }
        });

        input.addEventListener('keydown', e => this.handleKeyNavigation(e, suggestionsContainer, input, mode));
    }

    async searchAddresses(query, container, input, mode) {
        try {
            const coordsMatch = query.match(/^(-?\d+\.?\d*),?\s*(-?\d+\.?\d*)$/);
            if (coordsMatch) {
                this.handleCoordinatesInput(coordsMatch, container, input, mode);
                return;
            }

            if (!this.PlacesLibrary) await this.initPlacesLibrary();

            const request = { input: query, sessionToken: this.sessionToken };

            const { suggestions } = await this.PlacesLibrary.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
            if (suggestions?.length) {
                this.currentPredictions[mode] = suggestions.map(s => s.placePrediction);
                this.displayAddressSuggestions(this.currentPredictions[mode], container, input, mode);
            } else {
                this.showNoResultsMessage(container);
            }
        } catch (error) {
            console.error('Search error:', error);
            Utils.showError("Erreur lors de la recherche d'adresse");
        }
    }

    handleCoordinatesInput(coordsMatch, container, input, mode) {
        const lat = parseFloat(coordsMatch[1]);
        const lng = parseFloat(coordsMatch[2]);
        if (Utils.isValidCoordinate(lat, lng)) {
            container.innerHTML = `
                <div class="address-suggestion coordinates-suggestion" data-lat="${lat}" data-lng="${lng}">
                    <div class="suggestion-main">Coordonnées GPS</div>
                    <div class="suggestion-secondary">Lat: ${lat}, Lng: ${lng}</div>
                    <div class="suggestion-info">(Cercle de 3 km)</div>
                </div>`;
            container.style.display = 'block';
        } else {
            this.showNoResultsMessage(container, 'Coordonnées invalides');
        }
    }

    displayAddressSuggestions(predictions, container, input, mode) {
        container.innerHTML = '';
        if (!predictions || predictions.length === 0) {
            this.showNoResultsMessage(container);
            return;
        }

        predictions.slice(0, CONFIG.maxSuggestions || 5).forEach((prediction, index) => {
            const suggestionDiv = document.createElement('div');
            suggestionDiv.className = 'address-suggestion';
            if (index === 0) suggestionDiv.classList.add('active');

            const mainText = prediction.text?.mainText || prediction.text?.toString?.() || '';
            const secondaryText = prediction.text?.secondaryText || '';

            suggestionDiv.innerHTML = `
                <div class="suggestion-main">${mainText}</div>
                <div class="suggestion-secondary">${secondaryText}</div>
                <div class="suggestion-info">(Cercle de 3 km)</div>
            `;
            container.appendChild(suggestionDiv);
        });

        container.style.display = 'block';
    }

    async selectSuggestion(index, suggestionsContainer, inputElement, mode) {
        const suggestions = Array.from(suggestionsContainer.querySelectorAll('.address-suggestion'));
        if (index < 0 || index >= suggestions.length) return;

        const suggestion = suggestions[index];
        Utils.hideSuggestions(suggestionsContainer);

        if (suggestion.classList.contains('coordinates-suggestion')) {
            const lat = parseFloat(suggestion.dataset.lat);
            const lng = parseFloat(suggestion.dataset.lng);
            this.selectCoordinates(lat, lng, inputElement, mode);
        } else {
            const prediction = this.currentPredictions[mode][index];
            await this.selectAddress(prediction, inputElement, mode);
        }
    }

    async selectAddress(prediction, inputElement, mode) {
        try {
            const place = prediction.toPlace();
            await place.fetchFields({
                fields: ['location', 'formattedAddress', 'addressComponents', 'displayName']
            });

            if (!place?.location) return;

            const lat = place.location.lat();
            const lng = place.location.lng();
            const formattedAddress = place.formattedAddress || prediction.text.toString();
            // Adresse COURTE pré-remplie (cf. adresseCourte.js) : c'est elle qui est affichée et
            // enregistrée ; l'adresse du géocodeur est conservée dans `adresse_complete`.
            const adresseCourte = adresseCourteDepuisGoogle(place.addressComponents) || raccourcirTexteAdresse(formattedAddress);

            // Désactiver temporairement les suggestions
            inputElement._autosuggestionDisabled = true;
            inputElement.value = adresseCourte;
            setTimeout(() => { inputElement._autosuggestionDisabled = false; }, 100);

            // Créer le marker et le cercle
            this.addOrUpdateParametreMarker(lat, lng, adresseCourte, formattedAddress);

            // Centrer la carte
            this.map.setCenter(place.location);
            this.map.setZoom(12);

            // Renouveler le token de session
            this.sessionToken = new this.PlacesLibrary.AutocompleteSessionToken();
        } catch (error) {
            console.error('Error selecting address:', error);
            Utils.showError('Erreur lors de la sélection de l\'adresse.');
        }
    }

    selectCoordinates(lat, lng, inputElement, mode) {
        const displayValue = `${lat}, ${lng}`;
        inputElement._autosuggestionDisabled = true;
        inputElement.value = displayValue;
        setTimeout(() => { inputElement._autosuggestionDisabled = false; }, 100);

        this.addOrUpdateParametreMarker(lat, lng, displayValue);

        const position = new google.maps.LatLng(lat, lng);
        this.map.setCenter(position);
        this.map.setZoom(12);
    }

    addOrUpdateParametreMarker(lat, lng, address, addressComplete) {
        // Supprimer les overlays existants
        this.clearExistingOverlays();

        const position = new google.maps.LatLng(lat, lng);
        const title = `Adresse paramètre projet: ${address}`;

        // Créer le cercle de 3km
        const circle = new google.maps.Circle({
            strokeColor: '#00AAFF',
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: '#00AAFF',
            fillOpacity: 0.2,
            map: this.map,
            center: position,
            radius: 3000,
            draggable: false,
            editable: false
        });

        // Créer le marker central
        let marker;
        try {
            marker = new google.maps.marker.AdvancedMarkerElement({
                position,
                map: this.map,
                gmpDraggable: true,
                title,
                content: this.createCenterMarkerContent()
            });

            // Événements pour AdvancedMarkerElement
            marker.addListener('dragstart', () => {
                marker.content.style.cursor = 'grabbing';
            });

            marker.addListener('drag', (event) => {
                const newPosition = event.latLng;
                circle.setCenter(newPosition);
            });

            marker.addListener('dragend', (event) => {
                marker.content.style.cursor = 'grab';
                const newPosition = event.latLng;
                this.updateParametreFromMarker(newPosition.lat(), newPosition.lng(), marker, circle);
            });

        } catch (e) {
            // Fallback pour les anciens navigateurs
            marker = new google.maps.Marker({
                position,
                map: this.map,
                draggable: true,
                title,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    fillColor: '#00AAFF',
                    fillOpacity: 1,
                    strokeColor: 'white',
                    strokeWeight: 2,
                    scale: 8
                }
            });

            marker.addListener('drag', (event) => {
                circle.setCenter(event.latLng);
            });

            marker.addListener('dragend', (event) => {
                this.updateParametreFromMarker(event.latLng.lat(), event.latLng.lng(), marker, circle);
            });
        }

        // Stocker les références
        this.currentMarker = marker;
        this.currentCircle = circle;

        // Ajouter au coordinateManager
        const coordData = {
            id: Date.now(),
            type: 'Cercle (Paramètre projet)',
            coordinates: { lat, lng },
            address: address,
            addressComplete: addressComplete || null,
            radius: 3000,
            overlay: marker,
            circle: circle
        };

        const event = new CustomEvent('parametreProjectUpdated', {
            detail: coordData
        });
        document.dispatchEvent(event);

        this.coordinateManager.addCoordinate(coordData, 'parametreProject');
        this.updateParametreHiddenField(coordData);
    }

    clearExistingOverlays() {
        // Supprimer le marker existant
        if (this.currentMarker) {
            this.currentMarker.setMap(null);
            this.currentMarker = null;
        }

        // Supprimer le cercle existant
        if (this.currentCircle) {
            this.currentCircle.setMap(null);
            this.currentCircle = null;
        }

        // Nettoyer dans coordinateManager
        this.coordinateManager.clearCoordinates('parametreProject');
    }

    updateParametreFromMarker(lat, lng, marker, circle) {
        this.reverseGeocodeWithRetry(lat, lng, (address, error, composants) => {
            const adresseCourte = address ? (adresseCourteDepuisGoogle(composants) || raccourcirTexteAdresse(address)) : null;
            const displayAddress = adresseCourte || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

            // Mettre à jour le champ de recherche
            const searchInput = document.getElementById('parametreProjectSearch');
            if (searchInput) {
                this.safeSetInputValue(searchInput, displayAddress);
            }

            // Mettre à jour le coordinateManager
            const coords = this.coordinateManager.getCoordinates('parametreProject');
            if (coords.length > 0) {
                const c = coords[0];
                c.coordinates = { lat, lng };
                c.address = displayAddress;
                c.addressComplete = address || null;
                c.overlay = marker;
                c.circle = circle;
                this.coordinateManager.updateExistingCoordinate(c, 'parametreProject');
            }

            // Mettre à jour le titre du marker
            if (marker) {
                try {
                    marker.title = `Adresse paramètre projet: ${displayAddress}`;
                } catch (e) { }
            }

            // Mettre à jour le champ caché
            this.updateParametreHiddenField({
                type: 'Cercle (Paramètre projet)',
                coordinates: { lat, lng },
                address: displayAddress,
                addressComplete: address || null,
                radius: 3000
            });
        });
    }

    updateParametreHiddenField(coordData) {
        const hiddenInput = document.getElementById('parametre_project_hidden') ||
            document.getElementById('adresse_parametre_projet_cacher');
        if (!hiddenInput) return;

        hiddenInput.value = JSON.stringify({
            id: coordData.id || Date.now(),
            type: coordData.type,
            latitude: coordData.coordinates.lat,
            longitude: coordData.coordinates.lng,
            adresse: coordData.address,
            // Adresse d'origine du géocodeur (traçabilité) ; `adresse` porte l'adresse courte.
            ...(coordData.addressComplete ? { adresse_complete: coordData.addressComplete } : {}),
            radius: coordData.radius || 3000
        });
    }

    createCenterMarkerContent() {
        const element = document.createElement('div');
        element.style.width = '16px';
        element.style.height = '16px';
        element.style.borderRadius = '50%';
        element.style.backgroundColor = '#00AAFF';
        element.style.border = '2px solid white';
        element.style.boxShadow = '0 2px 6px rgba(0,0,0,0.3)';
        element.style.cursor = 'grab';
        return element;
    }

    reverseGeocodeWithRetry(lat, lng, callback, retries = 3) {
        if (!this.geocoder) {
            this.geocoder = new google.maps.Geocoder();
        }

        const attempt = (n = 1) => {
            this.geocoder.geocode({ location: { lat, lng } }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    callback(results[0].formatted_address, null, results[0].address_components);
                } else if (n < retries) {
                    setTimeout(() => attempt(n + 1), 1000 * n);
                } else {
                    callback(null, status);
                }
            });
        };
        attempt();
    }

    safeSetInputValue(input, value) {
        const wasFocused = document.activeElement === input;
        const selectionStart = input.selectionStart;
        const selectionEnd = input.selectionEnd;

        input._autosuggestionDisabled = true;
        input.value = value;

        input.dispatchEvent(new CustomEvent('addressUpdated', {
            detail: { value, source: 'marker-drag' }
        }));

        if (wasFocused) {
            input.setSelectionRange(selectionStart, selectionEnd);
        }

        setTimeout(() => {
            input._autosuggestionDisabled = false;
        }, 100);
    }

    handleKeyNavigation(event, suggestionsContainer, input, mode) {
        if (event.key === 'Enter') event.preventDefault();

        const suggestions = suggestionsContainer.querySelectorAll('.address-suggestion');
        if (!suggestions.length) return;

        const activeIndex = Array.from(suggestions).findIndex(s => s.classList.contains('active'));

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                const next = activeIndex < suggestions.length - 1 ? activeIndex + 1 : 0;
                Utils.setActiveSuggestion(suggestions, next);
                break;
            case 'ArrowUp':
                event.preventDefault();
                const prev = activeIndex > 0 ? activeIndex - 1 : suggestions.length - 1;
                Utils.setActiveSuggestion(suggestions, prev);
                break;
            case 'Enter':
                event.preventDefault();
                if (activeIndex >= 0) {
                    this.selectSuggestion(activeIndex, suggestionsContainer, input, mode);
                }
                break;
            case 'Escape':
                Utils.hideSuggestions(suggestionsContainer);
                break;
        }
    }

    showNoResultsMessage(container, message = 'Aucune adresse trouvée') {
        container.innerHTML = `<div class="address-suggestion no-results">${message}</div>`;
        container.style.display = 'block';
    }
}