import { PROFIL_EVENTS, STORAGE_CONFIG, NAMING_CONFIG, ELEVATION_PROVIDERS, PROVIDER_LABELS, getDrawingStylesForProvider } from '../constants.js';
import AltimetrieAPIService from '../services/AltimetrieAPIService.js';
import GoogleElevationAPIService from '../services/GoogleElevationAPIService.js';
import CalculationUtils from '../utils/CalculationUtils.js';
import DrawingHandler from '../handlers/DrawingHandler.js';
import ChartHandler from '../handlers/ChartHandler.js';
import GeometryUtils from '../utils/GeometryUtils.js';

/**
 * Manager principal pour la gestion des profils altimétriques
 * @class ProfilAltimetriqueManager
 */
class ProfilAltimetriqueManager {
  /**
   * @param {Object} options - Options de configuration
   * @param {google.maps.Map} options.map - Instance de la carte
   * @param {HTMLElement} options.chartContainer - Conteneur du graphique
   * @param {Function} options.showSpinner - Fonction pour afficher le spinner
   * @param {Function} options.hideSpinner - Fonction pour masquer le spinner
   * @param {Object} options.errorModal - Modal d'erreur
   * @param {Function} options.getSelectedProvider - Fonction pour récupérer le provider sélectionné
   */
  constructor(options) {
    this.map = options.map;
    this.showSpinner = options.showSpinner;
    this.hideSpinner = options.hideSpinner;
    this.errorModal = options.errorModal;
    this.getSelectedProvider = options.getSelectedProvider || (() => ELEVATION_PROVIDERS.GEOPORTAIL);

    // Initialiser les handlers
    this.drawingHandler = new DrawingHandler(this.map);
    this.chartHandler = new ChartHandler(options.chartContainer, this.map);

    // Données
    this.profiles = [];
    this.activeProfileId = null;
    this.profileCounter = 1;
    
    // Stockage des éléments visuels pour chaque profil
    this.profileVisuals = new Map(); // profileId -> {polyline, markers}

    // Charger les profils sauvegardés
    this._loadProfilesFromStorage();

    // Écouter les événements
    this._addEventListeners();
  }

  /**
   * Démarre un nouveau profil
   */
  startNewProfile() {

    
    // Si déjà en mode dessin, annuler
    if (this.drawingHandler.isInDrawingMode()) {
      this.drawingHandler.cancelDrawing();
      return;
    }

    // Nettoyer le dernier dessin
    this.drawingHandler.clearLastDrawing();

    // Utiliser Géoportail par défaut pour la couleur de dessin (bleu)
    // Les données des deux providers seront récupérées automatiquement à la fin du dessin
    this.drawingHandler.setProvider(ELEVATION_PROVIDERS.GEOPORTAIL);

    // Démarrer le mode dessin
    this.drawingHandler.startDrawingMode();
  }

  /**
   * Gère la completion du dessin
   * @private
   * @param {CustomEvent} event - Événement de dessin complété
   */
  async _handleDrawingCompleted(event) {
    const { coordinates } = event.detail;

    // Récupérer le provider sélectionné pour l'affichage initial
    const selectedProvider = this.getSelectedProvider();

    if (this.showSpinner) {
      this.showSpinner();
    }

    try {
      // Appeler les deux APIs en parallèle
      const [geoportailResponse, googleResponse] = await Promise.allSettled([
        AltimetrieAPIService.getElevationLine(coordinates),
        GoogleElevationAPIService.getElevationLine(coordinates, this.map)
      ]);

      // Formater les données des deux providers
      const dataByProvider = {};
      
      if (geoportailResponse.status === 'fulfilled') {
        dataByProvider[ELEVATION_PROVIDERS.GEOPORTAIL] = CalculationUtils.formatProfileData(geoportailResponse.value);
      } else {
        console.warn('Erreur Géoportail:', geoportailResponse.reason);
        if (this.errorModal) {
          this.errorModal.show(`Erreur Géoportail: ${geoportailResponse.reason.message || 'Erreur inconnue'}`);
        }
      }

      if (googleResponse.status === 'fulfilled') {
        dataByProvider[ELEVATION_PROVIDERS.GOOGLE] = CalculationUtils.formatProfileData(googleResponse.value);
      } else {
        console.warn('Erreur Google Maps:', googleResponse.reason);
        if (this.errorModal) {
          this.errorModal.show(`Erreur Google Maps: ${googleResponse.reason.message || 'Erreur inconnue'}`);
        }
      }

      // Vérifier qu'au moins un provider a réussi
      if (Object.keys(dataByProvider).length === 0) {
        throw new Error('Aucune donnée altimétrique disponible. Les deux providers ont échoué.');
      }

      // Utiliser le provider sélectionné pour l'affichage initial, ou le premier disponible
      const displayProvider = dataByProvider[selectedProvider] ? selectedProvider : Object.keys(dataByProvider)[0];

      // Créer le profil avec les deux sources de données
      const profile = this._createProfile(coordinates, dataByProvider, displayProvider);

      // IMPORTANT : Nettoyer la polyline et les markers du DrawingHandler
      // avant de créer les éléments visuels du profil
      this.drawingHandler.clearLastDrawing();

      // Créer les éléments visuels du profil avec le provider d'affichage
      this._createProfileVisuals(profile, displayProvider);

      // Ajouter aux profils
      this.profiles.push(profile);
      this.activeProfileId = profile.id;

      // Masquer les autres profils et afficher le nouveau
      this._switchActiveProfileVisuals(profile.id);

      // Sauvegarder
      this._saveProfilesToStorage();

      // Dispatcher l'événement
      document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.DATA_LOADED, {
        detail: { profile }
      }));

      document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.SAVED, {
        detail: { profile }
      }));

    } catch (error) {
      console.error('Erreur lors de la récupération du profil:', error);
      
      // Nettoyer le dessin en cas d'erreur
      this.drawingHandler.clearLastDrawing();

      if (this.errorModal) {
        this.errorModal.show(error.message);
      }
    } finally {
      if (this.hideSpinner) {
        this.hideSpinner();
      }
    }
  }

  /**
   * Crée un objet profil
   * @private
   * @param {Array} coordinates - Coordonnées d'origine
   * @param {Object} dataByProvider - Données formatées par provider {geoportail: {...}, google_maps: {...}}
   * @param {string} displayProvider - Fournisseur de données pour l'affichage initial (geoportail ou google_maps)
   * @returns {Object} Profil créé
   */
  _createProfile(coordinates, dataByProvider, displayProvider = ELEVATION_PROVIDERS.GEOPORTAIL) {
    const name = this._generateDefaultName();
    
    // Obtenir les données du provider d'affichage
    const displayData = dataByProvider[displayProvider];
    
    return {
      id: `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      created: new Date().toISOString(),
      coordinates,
      provider: displayProvider, // Provider actuellement affiché
      dataByProvider, // Toutes les données par provider
      ...displayData // Données du provider d'affichage pour compatibilité
    };
  }

  /**
   * Génère un nom par défaut pour le profil
   * @private
   * @returns {string} Nom généré
   */
  _generateDefaultName() {
    const existingNumbers = this.profiles
      .map(p => p.name)
      .filter(name => name.startsWith(NAMING_CONFIG.PREFIX))
      .map(name => {
        const match = name.match(/\d+$/);
        return match ? parseInt(match[0]) : 0;
      });

    let number = this.profileCounter;
    while (existingNumbers.includes(number)) {
      number++;
    }

    this.profileCounter = number + 1;
    return `${NAMING_CONFIG.PREFIX}${number}`;
  }

  /**
   * Charge un profil existant
   * @param {string} profileId - ID du profil
   */
  loadProfile(profileId) {
    const profile = this.profiles.find(p => p.id === profileId);
    
    if (!profile) {
      console.error('Profil non trouvé:', profileId);
      return;
    }

    if (this.chartHandler && this.chartHandler.hoverInfoWindow) {
      this.chartHandler._hideHoverTooltip();
    }

    this.activeProfileId = profileId;

    // Basculer les éléments visuels vers ce profil
    this._switchActiveProfileVisuals(profileId);

    // Dispatcher l'événement
    document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.SELECTED, {
      detail: { profile }
    }));
  }

  /**
   * Renomme un profil
   * @param {string} profileId - ID du profil
   * @param {string} newName - Nouveau nom
   */
  renameProfile(profileId, newName) {
    // Validation
    if (!newName || newName.trim().length === 0) {
      if (this.errorModal) {
        this.errorModal.show('Le nom ne peut pas être vide.');
      }
      return false;
    }

    if (newName.length > NAMING_CONFIG.MAX_LENGTH) {
      if (this.errorModal) {
        this.errorModal.show(`Le nom ne peut pas dépasser ${NAMING_CONFIG.MAX_LENGTH} caractères.`);
      }
      return false;
    }

    const profile = this.profiles.find(p => p.id === profileId);
    if (!profile) return false;

    profile.name = newName.trim();
    this._saveProfilesToStorage();

    // Dispatcher l'événement
    document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.RENAMED, {
      detail: { profileId, newName: profile.name }
    }));

    return true;
  }

  /**
   * Supprime un profil
   * @param {string} profileId - ID du profil
   */
  deleteProfile(profileId) {
    const index = this.profiles.findIndex(p => p.id === profileId);
    if (index === -1) return;

    if (this.chartHandler && this.chartHandler.hoverInfoWindow) {
      this.chartHandler._hideHoverTooltip();
    }

    // Supprimer les éléments visuels
    this._removeProfileVisuals(profileId);

    // Supprimer du tableau
    this.profiles.splice(index, 1);

    // Si tous les profils sont supprimés, remettre le compteur à 1
    if (this.profiles.length === 0) {
      this.profileCounter = 1;
    }

    // Si c'était le profil actif, sélectionner un autre
    if (this.activeProfileId === profileId) {
      this.activeProfileId = this.profiles.length > 0 ? this.profiles[0].id : null;
      
      if (this.activeProfileId) {
        this.loadProfile(this.activeProfileId);
      }
    }

    this._saveProfilesToStorage();

    // Dispatcher l'événement
    document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.DELETED, {
      detail: { profileId }
    }));
  }

  /**
   * Exporte un profil en CSV
   * @param {string} profileId - ID du profil
   */
  exportProfileToCSV(profileId) {
    const profile = this.profiles.find(p => p.id === profileId);
    if (!profile) return;

    // Récupérer le provider actuellement sélectionné pour l'affichage
    const selectedProvider = this.getSelectedProvider();
    const displayData = this._getProfileDataForProvider(profile, selectedProvider);
    
    if (!displayData) {
      if (this.errorModal) {
        this.errorModal.show('Données non disponibles pour le provider sélectionné.');
      }
      return;
    }

    // Récupérer le label du provider
    const providerLabel = PROVIDER_LABELS[selectedProvider] || selectedProvider || 'Inconnu';

    // Créer le contenu CSV
    let csv = 'Distance (m);Altitude (m);Latitude;Longitude;Pente (%)\n';

    displayData.points.forEach(point => {
      csv += `${point.distance.toFixed(2)};${point.altitude.toFixed(2)};${point.lat.toFixed(6)};${point.lon.toFixed(6)};${point.slope.toFixed(2)}\n`;
    });

    csv += '\n--- Résumé ---\n';
    csv += `Fournisseur de données;${providerLabel}\n`;
    csv += `Distance totale;${displayData.stats.totalDistance.toFixed(0)} m\n`;
    csv += `Dénivelé positif;+${displayData.stats.positiveElevation.toFixed(1)} m\n`;
    csv += `Dénivelé négatif;-${displayData.stats.negativeElevation.toFixed(1)} m\n`;
    csv += `Pente moyenne;${displayData.stats.averageSlope.toFixed(1)} %\n`;
    csv += `Plus forte pente;${displayData.stats.maxSlope.toFixed(1)} %\n`;

    // Télécharger
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const date = new Date().toISOString().split('T')[0];
    const filename = `profil_altimetrique_${profile.name}_${date}.csv`;
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Dispatcher l'événement
    document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.EXPORTED, {
      detail: { profileId, filename }
    }));
  }

  /**
   * Obtient les données d'un profil pour un provider spécifique
   * @param {Object} profile - Profil
   * @param {string} provider - Provider (geoportail ou google_maps)
   * @returns {Object|null} Données formatées ou null si non disponibles
   */
  _getProfileDataForProvider(profile, provider) {
    // Si le profil a la nouvelle structure avec dataByProvider
    if (profile.dataByProvider && profile.dataByProvider[provider]) {
      return profile.dataByProvider[provider];
    }
    
    // Compatibilité avec les anciens profils : si le provider correspond, utiliser les données directes
    if (profile.provider === provider && profile.points) {
      return {
        points: profile.points,
        stats: profile.stats
      };
    }
    
    return null;
  }

  /**
   * Obtient les données d'un profil pour un provider spécifique (méthode publique)
   * @param {string} profileId - ID du profil
   * @param {string} provider - Provider (geoportail ou google_maps)
   * @returns {Object|null} Données formatées ou null si non disponibles
   */
  getProfileDataForProvider(profileId, provider) {
    const profile = this.profiles.find(p => p.id === profileId);
    if (!profile) return null;
    return this._getProfileDataForProvider(profile, provider);
  }

  /**
   * Met à jour les données d'affichage d'un profil selon le provider sélectionné
   * @param {string} profileId - ID du profil
   * @param {string} provider - Provider à utiliser pour l'affichage
   */
  updateProfileDisplay(profileId, provider) {
    const profile = this.profiles.find(p => p.id === profileId);
    if (!profile) return;

    const displayData = this._getProfileDataForProvider(profile, provider);
    if (!displayData) {
      console.warn(`Données non disponibles pour le provider ${provider} sur le profil ${profileId}`);
      return;
    }

    // Mettre à jour le provider d'affichage et les données
    profile.provider = provider;
    profile.points = displayData.points;
    profile.stats = displayData.stats;

    // Mettre à jour les éléments visuels avec la nouvelle couleur
    this._updateProfileVisualsProvider(profileId, provider);

    // Mettre à jour le graphique avec les nouvelles données
    if (this.chartHandler) {
      const displayProfile = {
        ...profile,
        points: displayData.points,
        stats: displayData.stats,
        provider: provider
      };
      this.chartHandler.drawChart(displayProfile);
    }

    // Sauvegarder
    this._saveProfilesToStorage();

    // Dispatcher l'événement pour mettre à jour l'affichage
    document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.SELECTED, {
      detail: { profile }
    }));
  }

  /**
   * Met à jour la couleur des éléments visuels selon le provider
   * @private
   * @param {string} profileId - ID du profil
   * @param {string} provider - Provider à utiliser pour les couleurs
   */
  _updateProfileVisualsProvider(profileId, provider) {
    const visuals = this.profileVisuals.get(profileId);
    if (!visuals) return;

    // Mettre à jour la couleur de la polyline
    if (visuals.polyline) {
      const colors = provider === ELEVATION_PROVIDERS.GOOGLE 
        ? { strokeColor: '#4CAF50' }
        : { strokeColor: '#2196F3' };
      
      visuals.polyline.setOptions(colors);
    }

    // Mettre à jour la couleur des markers
    if (visuals.markers && visuals.markers.length > 0) {
      // Obtenir les styles selon le provider
      const providerStyles = getDrawingStylesForProvider(provider);
      const markerStyle = providerStyles.MARKER;
      
      visuals.markers.forEach(marker => {
        if (marker.setIcon) {
          // Récupérer le label actuel pour le préserver
          const currentLabel = marker.getLabel();
          
          // Créer un nouvel icon avec la nouvelle couleur
          const newIcon = {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: markerStyle.fillColor,
            fillOpacity: markerStyle.fillOpacity,
            strokeColor: markerStyle.strokeColor,
            strokeWeight: markerStyle.strokeWeight,
            scale: markerStyle.scale
          };
          
          marker.setIcon(newIcon);
          
          // Restaurer le label s'il existait
          if (currentLabel) {
            marker.setLabel(currentLabel);
          }
        }
      });
    }
  }

  /**
   * Crée les éléments visuels pour un profil (polyline + markers)
   * @private
   * @param {Object} profile - Profil à visualiser
   * @param {string} provider - Provider à utiliser pour les couleurs
   */
  _createProfileVisuals(profile, provider = null) {
    // Utiliser le provider passé en paramètre ou celui du profil
    const visualProvider = provider || profile.provider || ELEVATION_PROVIDERS.GEOPORTAIL;
    
    // Créer la polyline avec les données du profil pour le tooltip
    const coordinates = profile.coordinates || profile.points.map(p => ({lat: p.lat, lng: p.lon}));
    
    const polylineData = GeometryUtils.createPolyline(
      coordinates, 
      this.map, 
      false, 
      profile.points, 
      profile.name, 
      visualProvider
    );
    
    // Créer les markers pour chaque point avec la couleur du provider
    const markers = coordinates.map((coord, index) => {
      return GeometryUtils.createMarker(
        {lat: coord.lat, lng: coord.lng || coord.lon},
        this.map,
        index + 1,
        visualProvider
      );
    });
    
    // Stocker les éléments visuels (y compris le handler de tooltip)
    this.profileVisuals.set(profile.id, {
      polyline: polylineData.polyline,
      tooltipHandler: polylineData.tooltipHandler,
      markers
    });
    

  }

  /**
   * Bascule vers un profil actif (masque les autres, affiche le sélectionné)
   * @private
   * @param {string} profileId - ID du profil à rendre actif
   */
  _switchActiveProfileVisuals(profileId) {
    // Masquer tous les profils
    this.profileVisuals.forEach((visuals, id) => {
      const isActive = (id === profileId);
      GeometryUtils.setPolylineVisibility(visuals.polyline, isActive);
      GeometryUtils.setMarkersVisibility(visuals.markers, isActive);
    });
    

  }

  /**
   * Supprime les éléments visuels d'un profil
   * @private
   * @param {string} profileId - ID du profil
   */
  _removeProfileVisuals(profileId) {
    const visuals = this.profileVisuals.get(profileId);
    if (visuals) {
      // Nettoyer le tooltip handler
      if (visuals.tooltipHandler && visuals.tooltipHandler.cleanup) {
        visuals.tooltipHandler.cleanup();
      }
      
      // Nettoyer la polyline et les markers
      GeometryUtils.clearDrawing(visuals.polyline, visuals.markers);
      this.profileVisuals.delete(profileId);

    }
  }

  /**
   * Restaure les éléments visuels pour tous les profils chargés
   * @private
   */
  _restoreAllProfileVisuals() {
    this.profiles.forEach(profile => {
      // Ne créer les visuels que s'ils n'existent pas déjà
      if (!this.profileVisuals.has(profile.id)) {
        // Utiliser le provider d'affichage du profil
        const visualProvider = profile.provider || ELEVATION_PROVIDERS.GEOPORTAIL;
        this._createProfileVisuals(profile, visualProvider);
      }
    });
    
    // Afficher seulement le profil actif
    if (this.activeProfileId) {
      this._switchActiveProfileVisuals(this.activeProfileId);
    }
    

  }

  /**
   * Charge les profils depuis le localStorage
   * @private
   */
  _loadProfilesFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_CONFIG.KEY);
      if (stored) {
        const data = JSON.parse(stored);
        this.profiles = data.profiles || [];
        this.activeProfileId = data.activeProfileId || null;
        
        // Migrer les anciens profils vers la nouvelle structure si nécessaire
        this.profiles.forEach(profile => {
          if (!profile.dataByProvider && profile.points) {
            // Ancien format : créer dataByProvider avec les données existantes
            profile.dataByProvider = {
              [profile.provider]: {
                points: profile.points,
                stats: profile.stats
              }
            };
          }
        });
        
        // Mettre à jour le compteur
        if (this.profiles.length > 0) {
          const maxNumber = Math.max(...this.profiles.map(p => {
            const match = p.name.match(/\d+$/);
            return match ? parseInt(match[0]) : 0;
          }));
          this.profileCounter = maxNumber + 1;
        }
        
        // Restaurer les éléments visuels si la carte est prête
        if (this.map) {
          setTimeout(() => {
            this._restoreAllProfileVisuals();
          }, 100);
        }
      }
    } catch (error) {
      console.error('Erreur lors du chargement des profils:', error);
    }
  }

  /**
   * Sauvegarde les profils dans le localStorage
   * @private
   */
  _saveProfilesToStorage() {
    try {
      // Limiter le nombre de profils
      if (this.profiles.length > STORAGE_CONFIG.MAX_PROFILES) {
        this.profiles = this.profiles.slice(-STORAGE_CONFIG.MAX_PROFILES);
      }

      const data = {
        profiles: this.profiles,
        activeProfileId: this.activeProfileId
      };

      localStorage.setItem(STORAGE_CONFIG.KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Erreur lors de la sauvegarde des profils:', error);
      
      if (error.name === 'QuotaExceededError' && this.errorModal) {
        this.errorModal.show('Espace de stockage saturé. Supprimez des profils anciens.');
      }
    }
  }

  /**
   * Ajoute les écouteurs d'événements
   * @private
   */
  _addEventListeners() {
    document.addEventListener(PROFIL_EVENTS.DRAWING_COMPLETED, (e) => {
      this._handleDrawingCompleted(e);
    });
  }

  /**
   * Retourne tous les profils
   * @returns {Array<Object>} Liste des profils
   */
  getProfiles() {
    return [...this.profiles];
  }

  /**
   * Retourne le profil actif
   * @returns {Object|null} Profil actif
   */
  getActiveProfile() {
    if (!this.activeProfileId) return null;
    return this.profiles.find(p => p.id === this.activeProfileId);
  }

  /**
   * Force la restauration de tous les éléments visuels
   * Utile quand la carte est initialisée après le chargement des profils
   */
  forceRestoreVisuals() {
    if (this.profiles.length > 0) {

      this._restoreAllProfileVisuals();
    }
  }
}

export default ProfilAltimetriqueManager;

