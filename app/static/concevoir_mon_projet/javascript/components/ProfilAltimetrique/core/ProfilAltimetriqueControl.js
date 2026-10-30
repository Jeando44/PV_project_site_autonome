import { PROFIL_EVENTS, RESIZE_CONFIG, ELEVATION_PROVIDERS, PROVIDER_LABELS, TAB_COLORS } from '../constants.js';
import ProfilAltimetriqueManager from './ProfilAltimetriqueManager.js';
import DOMUtils from '../utils/DOMUtils.js';
import ConfirmModal from '../../ConfirmModal.js';
import AltimetricResizeHandler from '../handlers/AltimetricResizeHandler.js';
import AffectationPlansHandler from '../handlers/AffectationPlansHandler.js';

/**
 * Contrôle principal du panneau Profil Altimétrique
 * Structure similaire à ResumeParcellesControl
 * @class ProfilAltimetriqueControl
 */
class ProfilAltimetriqueControl {
  constructor(options) {
    this.errorModal = options.errorModal;
    this.showSpinner = options.showSpinner;
    this.hideSpinner = options.hideSpinner;
    this.map = options.map;

    // Initialiser les références des boutons avant de créer le container
    this.addProfilButton = null;
    this.exportButton = null;
    this.plansButton = null;
    this.resetSizeButton = null;
    this.nameInput = null;
    this.saveNameButton = null;
    this.providerSelect = null;

    // Initialiser la modal de confirmation
    this.confirmModal = new ConfirmModal();

    // Créer le container (qui va initialiser les éléments)
    this.profilContainer = this.createProfilContainer();

    // Initialiser le ProfilAltimetriqueManager après que la map soit disponible
    this.profilManager = null;

    // Initialiser le gestionnaire de redimensionnement
    this.resizeHandler = null;

    this._addEventListeners();
  }

  /**
   * Initialise le ProfilAltimetriqueManager une fois que la map est disponible
   * @param {google.maps.Map} map - Instance de la carte
   */
  initializeWithMap(map) {
    this.map = map;
    
    // Mettre à jour le resizeHandler si la carte n'était pas disponible avant
    if (this.resizeHandler) {
      this.resizeHandler.updateMap(map);
    }
    
    if (!this.profilManager) {
      const chartContainer = this.profilContainer.querySelector('.profil-chart-container');
      
      this.profilManager = new ProfilAltimetriqueManager({
        map: this.map,
        chartContainer,
        errorModal: this.errorModal,
        showSpinner: this.showSpinner,
        hideSpinner: this.hideSpinner,
        getSelectedProvider: () => this.getSelectedProvider()
      });

      // Charger les profils existants et restaurer les éléments visuels
      setTimeout(() => {
        this._loadExistingProfiles();
        // Forcer la restauration des éléments visuels au cas où ils ne seraient pas créés
        this.profilManager.forceRestoreVisuals();
      }, 200);
    }
  }

  /**
   * Crée le container principal (similaire à createParcellesContainer)
   * @returns {HTMLDivElement} Container créé
   */
  createProfilContainer() {
    const container = document.createElement('div');
    container.classList.add('profil-altimetrique-container');
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      padding: 0;
      border-top: 1px solid #c0c0c0;
      border-bottom: 1px solid #eee;
      background-color: rgba(255, 255, 255, 0.9);
      min-height: fit-content;
      border-radius: 2px 0 2px 0;
      z-index: 100;
      cursor: default;
      width: fit-content;
      pointer-events: auto;
      position: relative;
      overflow: hidden;
    `;

    // 1. EN-TÊTE
    const header = this._createHeader();
    container.appendChild(header);

    // 2. ONGLETS
    const tabsContainer = this._createTabsContainer();
    container.appendChild(tabsContainer);

    // 3. ZONE GRAPHIQUE
    const chartContainer = DOMUtils.createChartContainer();
    container.appendChild(chartContainer);

    // 4. RÉSUMÉ STATISTIQUES
    const summaryContainer = this._createSummaryPlaceholder();
    container.appendChild(summaryContainer);

    // 5. INPUT NOM
    const nameSection = this._createNameSection();
    container.appendChild(nameSection);

    // Initialiser le gestionnaire de redimensionnement
    this._initializeResizeHandler(container);

    return container;
  }

  /**
   * Initialise le gestionnaire de redimensionnement horizontal
   * @private
   * @param {HTMLElement} container - Container à redimensionner
   */
  _initializeResizeHandler(container) {
    this.resizeHandler = new AltimetricResizeHandler(container, {
      minWidth: RESIZE_CONFIG.MIN_WIDTH,
      defaultWidth: RESIZE_CONFIG.DEFAULT_WIDTH,
      map: this.map, // Passer la référence de la carte pour calculer maxWidth
      // maxWidth sera calculé automatiquement basé sur la largeur de la carte Google Maps
      onResize: (newWidth) => {
        // Redessiner le graphique si un profil est actif
        if (this.profilManager) {
          const activeProfile = this.profilManager.getActiveProfile();
          if (activeProfile && this.profilManager.chartHandler) {
            // Utiliser setTimeout pour laisser le temps au DOM de se mettre à jour
            setTimeout(() => {
              this.profilManager.chartHandler.drawChart(activeProfile);
            }, 50);
          }
        }
      }
    });
    
    // Stocker aussi une référence sur le container pour accès alternatif
    if (container) {
      container._resizeHandler = this.resizeHandler;
    }
  }

  /**
   * Crée l'en-tête du panneau (similaire à resuméParcelles lignes 180-285)
   * @private
   * @returns {HTMLElement} En-tête
   */
  _createHeader() {
    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
      min-height: fit-content;
      width: 100%;
      background-color: transparent;
    `;

    const headerCell = document.createElement('div');
    headerCell.style.cssText = `
      padding: 0px 5px;
      text-align: center;
      border-bottom: 1px solid #ddd;
      font-weight: bold;
      background-color: transparent;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    `;

    // Titre
    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'Profils Altimétriques';
    titleSpan.style.cssText = 'flex: 1; font-size: 12px;';

    // Conteneur des boutons (à droite)
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = `
      display: flex;
      gap: 5px;
      align-items: center;
    `;

    // Select pour le provider (utilisé uniquement pour l'affichage)
    const providerSelect = DOMUtils.createSelect(
      [
        { value: ELEVATION_PROVIDERS.GEOPORTAIL, label: PROVIDER_LABELS[ELEVATION_PROVIDERS.GEOPORTAIL] },
        { value: ELEVATION_PROVIDERS.GOOGLE, label: PROVIDER_LABELS[ELEVATION_PROVIDERS.GOOGLE] }
      ],
      ELEVATION_PROVIDERS.GEOPORTAIL,
      'Choisir les données à afficher'
    );
    providerSelect.style.fontSize = '13px';
    providerSelect.style.padding = '4px';
    providerSelect.style.height = '20px';
    providerSelect.style.width = 'fit-content';
    this.providerSelect = providerSelect;

    // Listener pour mettre à jour l'affichage quand le provider change
    providerSelect.addEventListener('change', () => {
      if (this.profilManager && this.profilManager.activeProfileId) {
        const selectedProvider = providerSelect.value;
        this.profilManager.updateProfileDisplay(this.profilManager.activeProfileId, selectedProvider);
      }
    });

    // Bouton d'export CSV
    const exportButton = DOMUtils.createButton('📥', 'Exporter en CSV', {
      backgroundColor: '#2196F3',
      color: 'white',
      width: '28px',
      height: '28px',
      fontSize: '16px',
      opacity: '0.5',
      cursor: 'not-allowed'
    }, () => {
      if (this.profilManager) {
        const activeProfile = this.profilManager.getActiveProfile();
        if (activeProfile) {
          this.profilManager.exportProfileToCSV(activeProfile.id);
        }
      }
    });
    exportButton.disabled = true;
    this.exportButton = exportButton;

    // Bouton « Utiliser ce profil pour les plans » : la ligne du profil devient celle du plan de
    // coupe ou de façade d'un champ PV (cf. handlers/AffectationPlansHandler.js).
    this.affectationPlans = new AffectationPlansHandler({ errorModal: this.errorModal });
    const plansButton = DOMUtils.createButton('📐', 'Utiliser ce profil pour les plans (coupe / façade d’un champ PV)', {
      backgroundColor: '#7c3aed',
      color: 'white',
      width: '28px',
      height: '28px',
      fontSize: '15px',
      opacity: '0.5',
      cursor: 'not-allowed'
    }, () => {
      const actif = this.profilManager && this.profilManager.getActiveProfile();
      if (actif) this.affectationPlans.ouvrir(actif);
    });
    plansButton.disabled = true;
    this.plansButton = plansButton;

    // Bouton de réinitialisation de la taille (à côté du bouton d'export)
    const resetSizeButton = DOMUtils.createButton('↔', 'Réinitialiser la taille par défaut', {
      backgroundColor: '#9E9E9E',
      color: 'white',
      width: '28px',
      height: '28px',
      fontSize: '18px',
      fontWeight: 'bold'
    }, (function() {
      const self = this;
      return function() {
        let handlerToUse = self.resizeHandler;
        
        if (!handlerToUse && self.profilContainer) {
          handlerToUse = self.profilContainer._resizeHandler || self.profilContainer.resizeHandler;
        }
        
        if (handlerToUse && typeof handlerToUse.resetWidth === 'function') {
          handlerToUse.resetWidth();
          
          if (self.profilManager) {
            const activeProfile = self.profilManager.getActiveProfile();
            if (activeProfile && self.profilManager.chartHandler) {
              setTimeout(() => {
                self.profilManager.chartHandler.drawChart(activeProfile);
              }, 100);
            }
          }
        }
      };
    }).bind(this)());
    this.resetSizeButton = resetSizeButton;

    // Bouton "+"
    const addButton = DOMUtils.createButton('+', 'Créer un nouveau profil', {
      backgroundColor: '#4CAF50',
      color: 'white',
      width: '28px',
      height: '28px',
      fontSize: '18px',
      fontWeight: 'bold'
    }, () => {  
      
      
      if (this.profilManager) {
        this.profilManager.startNewProfile();
      } else if (this.errorModal) {
        this.errorModal.show('La carte n\'est pas encore complètement chargée. Veuillez patienter.');
      }
    });
    this.addProfilButton = addButton;

    buttonsContainer.appendChild(providerSelect);
    buttonsContainer.appendChild(exportButton);
    buttonsContainer.appendChild(plansButton);
    buttonsContainer.appendChild(resetSizeButton);
    buttonsContainer.appendChild(addButton);

    headerCell.appendChild(titleSpan);
    headerCell.appendChild(buttonsContainer);
    headerRow.appendChild(headerCell);

    return headerRow;
  }

  /**
   * Retourne le provider sélectionné
   * @returns {string} Provider sélectionné
   */
  getSelectedProvider() {
    return this.providerSelect ? this.providerSelect.value : ELEVATION_PROVIDERS.GEOPORTAIL;
  }

  /**
   * Crée le conteneur des onglets
   * @private
   * @returns {HTMLElement} Conteneur des onglets
   */
  _createTabsContainer() {
    const tabsContainer = document.createElement('div');
    tabsContainer.classList.add('profil-tabs-container');

    // Message initial
    const emptyMessage = document.createElement('div');
    emptyMessage.classList.add('tabs-empty-message');
    emptyMessage.textContent = 'Aucun profil créé';
    emptyMessage.style.cssText = `
      font-size: 11px;
      color: #999;
      font-style: italic;
      align-self: center;
    `;
    tabsContainer.appendChild(emptyMessage);

    return tabsContainer;
  }

  /**
   * Crée un placeholder pour le résumé
   * @private
   * @returns {HTMLElement} Résumé placeholder
   */
  _createSummaryPlaceholder() {
    const summaryContainer = document.createElement('div');
    summaryContainer.classList.add('profil-summary-container');
    summaryContainer.style.cssText = `
      width: 100%;
      min-height: 50px;
      background-color: hsla(0, 0%, 100%, 0.7);
      border-top: 1px solid #ddd;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      color: #999;
      font-style: italic;
    `;
    summaryContainer.textContent = 'Aucune donnée à afficher';

    return summaryContainer;
  }

  /**
   * Crée la section du nom de profil
   * @private
   * @returns {HTMLElement} Section du nom
   */
  _createNameSection() {
    const nameSection = document.createElement('div');
    nameSection.style.cssText = `
      padding: 8px;
      width: 100%;
      background-color: hsla(0, 0%, 100%, 0.7);
      border-top: 1px solid #ddd;
      display: flex;
      align-items: center;
      gap: 8px;
    `;

    const label = document.createElement('span');
    label.textContent = 'Nom:';
    label.style.cssText = 'font-size: 11px; font-weight: bold; white-space: nowrap;';

    const input = DOMUtils.createInput('Nom du profil', '');
    input.disabled = true;
    input.style.flex = '1';
    input.style.fontSize = '11px';
    this.nameInput = input;

    // Sauvegarder au blur
    input.addEventListener('blur', () => {
      if (this.profilManager && this.profilManager.activeProfileId) {
        const newName = input.value.trim();
        if (newName) {
          this.profilManager.renameProfile(this.profilManager.activeProfileId, newName);
        }
      }
    });

    // Sauvegarder sur Entrée
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      }
    });

    nameSection.appendChild(label);
    nameSection.appendChild(input);

    return nameSection;
  }

  /**
   * Charge les profils existants depuis le storage
   * @private
   */
  _loadExistingProfiles() {
    if (!this.profilManager) return;

    const profiles = this.profilManager.getProfiles();
    
    if (profiles.length > 0) {
      // Recréer les onglets
      profiles.forEach(profile => {
        this._createTab(profile);
      });

      // Charger le profil actif
      const activeProfile = this.profilManager.getActiveProfile();
      if (activeProfile) {
        this._displayProfile(activeProfile);
      }
    }
  }

  /**
   * Crée un onglet pour un profil
   * @private
   * @param {Object} profile - Profil
   */
  _createTab(profile) {
    const tabsContainer = this.profilContainer.querySelector('.profil-tabs-container');
    if (!tabsContainer) return;

    // Supprimer le message vide
    const emptyMessage = tabsContainer.querySelector('.tabs-empty-message');
    if (emptyMessage) {
      emptyMessage.remove();
    }

    // Vérifier si l'onglet existe déjà
    const existingTab = tabsContainer.querySelector(`[data-profile-id="${profile.id}"]`);
    if (existingTab) return;

    const isActive = this.profilManager && this.profilManager.activeProfileId === profile.id;
    const provider = profile.provider || ELEVATION_PROVIDERS.GEOPORTAIL;
    
    const tab = DOMUtils.createTabElement(profile.name, isActive, null, provider);
    tab.setAttribute('data-profile-id', profile.id);
    tab.setAttribute('data-provider', provider);

    // Clic sur l'onglet
    tab.addEventListener('click', () => {
      if (this.profilManager) {
        this.profilManager.loadProfile(profile.id);
      }
    });

    // Fermeture de l'onglet
    tab.addEventListener('tab:close', () => {
      this.confirmModal.show(
        'Êtes-vous sûr de vouloir supprimer ce profil ?',
        () => {
          // Callback de confirmation
          if (this.profilManager) {
            this.profilManager.deleteProfile(profile.id);
          }
        }
      );
    });

    tabsContainer.appendChild(tab);
  }

  /**
   * Affiche un profil dans le panneau
   * @private
   * @param {Object} profile - Profil à afficher
   */
  _displayProfile(profile) {
    // Mettre à jour le select avec le provider actuel du profil
    if (this.providerSelect && profile.provider) {
      this.providerSelect.value = profile.provider;
    }

    // Mettre à jour le graphique avec les données du provider sélectionné
    const chartContainer = this.profilContainer.querySelector('.profil-chart-container');
    if (chartContainer && this.profilManager) {
      // Obtenir les données du provider actuellement sélectionné
      const selectedProvider = this.getSelectedProvider();
      const displayData = this.profilManager.getProfileDataForProvider(profile.id, selectedProvider);
      
      if (displayData) {
        // Créer un objet profil temporaire avec les données du provider sélectionné
        const displayProfile = {
          ...profile,
          points: displayData.points,
          stats: displayData.stats,
          provider: selectedProvider
        };
        this.profilManager.chartHandler.drawChart(displayProfile);
      } else {
        // Fallback sur les données du profil si le provider n'est pas disponible
        this.profilManager.chartHandler.drawChart(profile);
      }
    }

    // Mettre à jour le résumé avec le provider sélectionné et les points
    const selectedProvider = this.getSelectedProvider();
    const displayData = this.profilManager.getProfileDataForProvider(profile.id, selectedProvider);
    if (displayData) {
      this._updateSummary(displayData.stats, selectedProvider, displayData.points);
    } else {
      this._updateSummary(profile.stats, profile.provider, profile.points);
    }

    // Mettre à jour le nom
    if (this.nameInput) {
      this.nameInput.value = profile.name;
      this.nameInput.disabled = false;
    }

    // Activer le bouton d'export et le bouton « plans »
    [this.exportButton, this.plansButton].forEach((bouton) => {
      if (!bouton) return;
      bouton.disabled = false;
      bouton.style.opacity = '1';
      bouton.style.cursor = 'pointer';
    });

    // Mettre à jour l'onglet actif
    this._updateActiveTab(profile.id);
  }

  /**
   * Met à jour le résumé des statistiques
   * @private
   * @param {Object} stats - Statistiques
   * @param {string} provider - Provider de données altimétriques
   * @param {Array<Object>} points - Points du profil (pour afficher premier et dernier point)
   */
  _updateSummary(stats, provider = null, points = null) {
    const summaryContainer = this.profilContainer.querySelector('.profil-summary-container');
    if (!summaryContainer) return;

    // Remplacer le contenu
    const newSummary = DOMUtils.createSummarySection(stats, provider, points);
    summaryContainer.replaceWith(newSummary);
    newSummary.classList.add('profil-summary-container');
  }

  /**
   * Met à jour l'onglet actif
   * @private
   * @param {string} profileId - ID du profil actif
   */
  _updateActiveTab(profileId) {
    const tabsContainer = this.profilContainer.querySelector('.profil-tabs-container');
    if (!tabsContainer) return;

    const tabs = tabsContainer.querySelectorAll('[data-profile-id]');
    tabs.forEach(tab => {
      const isActive = tab.getAttribute('data-profile-id') === profileId;
      
      // Toujours utiliser les couleurs bleues (Géoportail) pour les onglets
      const colors = TAB_COLORS[ELEVATION_PROVIDERS.GEOPORTAIL];
      
      if (isActive) {
        tab.classList.add('active');
        tab.style.backgroundColor = colors.active;
        tab.style.color = 'white';
      } else {
        tab.classList.remove('active');
        tab.style.backgroundColor = colors.inactive;
        tab.style.color = colors.text;
      }
    });
  }

  /**
   * Supprime un onglet
   * @private
   * @param {string} profileId - ID du profil
   */
  _removeTab(profileId) {
    const tabsContainer = this.profilContainer.querySelector('.profil-tabs-container');
    if (!tabsContainer) return;

    const tab = tabsContainer.querySelector(`[data-profile-id="${profileId}"]`);
    if (tab) {
      tab.remove();
    }

    // Si plus d'onglets, afficher le message vide
    const tabs = tabsContainer.querySelectorAll('[data-profile-id]');
    if (tabs.length === 0) {
      const emptyMessage = document.createElement('div');
      emptyMessage.classList.add('tabs-empty-message');
      emptyMessage.textContent = 'Aucun profil créé';
      emptyMessage.style.cssText = `
        font-size: 11px;
        color: #999;
        font-style: italic;
        align-self: center;
      `;
      tabsContainer.appendChild(emptyMessage);

      // Réinitialiser l'affichage
      this._resetDisplay();
    }
  }

  /**
   * Réinitialise l'affichage
   * @private
   */
  _resetDisplay() {
    // Vider le graphique
    if (this.profilManager) {
      this.profilManager.chartHandler.clearChart();
    }

    // Réinitialiser le résumé
    const summaryContainer = this.profilContainer.querySelector('.profil-summary-container');
    if (summaryContainer) {
      summaryContainer.innerHTML = 'Aucune donnée à afficher';
      summaryContainer.style.display = 'flex';
      summaryContainer.style.alignItems = 'center';
      summaryContainer.style.justifyContent = 'center';
    }

    // Désactiver l'input de nom
    if (this.nameInput) {
      this.nameInput.value = '';
      this.nameInput.disabled = true;
    }

    // Désactiver le bouton d'export et le bouton « plans »
    [this.exportButton, this.plansButton].forEach((bouton) => {
      if (!bouton) return;
      bouton.disabled = true;
      bouton.style.opacity = '0.5';
      bouton.style.cursor = 'not-allowed';
    });
  }

  /**
   * Met à jour l'état du bouton d'ajout (similaire à resuméParcelles)
   * @private
   * @param {boolean} isActive - Si le mode est actif
   */
  _updateAddButtonState(isActive) {
    if (!this.addProfilButton) return;

    if (isActive) {
      // Mode actif : bouton rouge avec croix
      this.addProfilButton.textContent = '×';
      this.addProfilButton.style.backgroundColor = '#f44336';
      this.addProfilButton.title = 'Annuler (Échap)';
    } else {
      // Mode inactif : bouton vert avec plus
      this.addProfilButton.textContent = '+';
      this.addProfilButton.style.backgroundColor = '#4CAF50';
      this.addProfilButton.title = 'Créer un nouveau profil';
    }
  }

  /**
   * Ajoute les écouteurs d'événements
   * @private
   */
  _addEventListeners() {
    // Mode dessin activé/désactivé
    document.addEventListener(PROFIL_EVENTS.MODE_ACTIVATED, () => {
      this._updateAddButtonState(true);
    });

    document.addEventListener(PROFIL_EVENTS.MODE_DEACTIVATED, () => {
      this._updateAddButtonState(false);
    });

    // Profil sauvegardé
    document.addEventListener(PROFIL_EVENTS.SAVED, (event) => {
      const { profile } = event.detail;
      this._createTab(profile);
      this._displayProfile(profile);
    });

    // Profil sélectionné (y compris lors du changement de provider)
    document.addEventListener(PROFIL_EVENTS.SELECTED, (event) => {
      const { profile } = event.detail;
      this._displayProfile(profile);
    });

    // Profil supprimé
    document.addEventListener(PROFIL_EVENTS.DELETED, (event) => {
      const { profileId } = event.detail;
      this._removeTab(profileId);
    });

    // Profil renommé
    document.addEventListener(PROFIL_EVENTS.RENAMED, (event) => {
      const { profileId, newName } = event.detail;
      const tab = this.profilContainer.querySelector(`[data-profile-id="${profileId}"]`);
      if (tab) {
        const nameSpan = tab.querySelector('span');
        if (nameSpan) {
          nameSpan.textContent = newName;
        }
      }
    });
  }

  /**
   * Retourne le conteneur DOM (utilisé par ToolBar)
   * @returns {HTMLElement} Conteneur principal
   */
  getDOMElement() {
    return this.profilContainer;
  }
}

export default ProfilAltimetriqueControl;

