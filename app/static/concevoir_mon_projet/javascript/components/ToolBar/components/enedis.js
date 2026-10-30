/**
 * Composant de contrôle pour les couches Enedis
 * Gère l'affichage des lignes électriques (aériennes et souterraines) et des équipements Enedis
 */

import PointsManager from './enedis/managers/PointsManager.js';
import LinesManager from './enedis/managers/LinesManager.js';
import { ENEDIS_COLORS, ENEDIS_DATASOURCE_TYPES } from './enedis/constants.js';


class EnedisControl {
  constructor(options) {
    this.map = options.map;
    this.errorModal = options.errorModal;
    this.showSpinner = options.showSpinner;
    this.hideSpinner = options.hideSpinner;
    this.buttonIcons = options.buttonIcons;
    this.createButton = options.createButton; // Méthode createButton de MapViewsControl
    // Fonction pour obtenir la carte depuis MapViewsControl (si disponible)
    this.getMap = options.getMap || (() => this.map);
    // Ne pas utiliser _createDropdownMenu et _createSubmenuOption de MapViewsControl
    // EnedisControl utilise ses propres méthodes définies dans cette classe pour gérer les séparateurs et indicateurs

    // États des couches Enedis
    this.isLigneAerienneHTAVisible = false;
    this.isLigneAerienneBTVisible = false;
    this.isLigneSouterraineHTAVisible = false;
    this.isLigneSouterraineBTVisible = false;
    this.isPosteSourceHTAHTAVisible = false;
    this.isPosteHTABTVisible = false;
    this.isPoteauHTAouBTVisible = false;

    // Le gestionnaire de points sera initialisé de manière lazy lors du premier appel à enable()
    // Utiliser un Map pour stocker plusieurs PointsManager (un par type)
    this.pointsManagers = new Map(); // Map<type, PointsManager>
    this.linesManagers = new Map(); // Map<type, LinesManager>
  }

  /**
   * Initialise le gestionnaire de points si nécessaire pour un type donné
   * @param {string} type - Type de point (POSTE_SOURCE_POINT, POSTE_HTA_BT_POINT, POTEAU_POINT)
   * @returns {boolean} true si le gestionnaire de points a été initialisé, false sinon
   * @private
   */
  _ensurePointsManager(type) {
    // Si le gestionnaire existe déjà pour ce type, vérifier que la carte est à jour
    if (this.pointsManagers.has(type)) {
      const manager = this.pointsManagers.get(type);
      // Essayer d'obtenir la carte depuis différentes sources
      let map = this.map;
      
      if (!map && this.getMap) {
        map = this.getMap();
        if (map) {
          this.map = map;
        }
      }
      
      if (!map && typeof window !== 'undefined' && window.map) {
        map = window.map;
        this.map = map;
      }
      
      if (!map) {
        const mapElement = document.getElementById('map');
        if (mapElement && mapElement._map) {
          map = mapElement._map;
          this.map = map;
        }
      }
      
      if (map && manager.map !== map) {
        manager.map = map;
      }
      
      return true;
    }

    // Essayer d'obtenir la carte depuis différentes sources
    let map = this.map;
    
    // 1. Essayer depuis getMap() (MapViewsControl)
    if (!map && this.getMap) {
      map = this.getMap();
      if (map) {
        this.map = map; // Mettre à jour la référence pour les prochaines fois
      }
    }
    
    // 2. Si toujours pas disponible, essayer window.map (carte globale)
    if (!map && typeof window !== 'undefined' && window.map) {
      map = window.map;
      this.map = map; // Mettre à jour la référence pour les prochaines fois
    }
    
    // 3. Si toujours pas de carte, essayer de la récupérer depuis le DOM
    if (!map) {
      const mapElement = document.getElementById('map');
      if (mapElement && mapElement._map) {
        map = mapElement._map;
        this.map = map;
      }
    }
    
    if (!map) {
      console.error('EnedisControl: La carte n\'est pas disponible. Vérifiez que la carte est initialisée.');
      return false;
    }

    // Créer un nouveau PointsManager pour ce type
    const pointsManager = new PointsManager({
      map: map,
      type: type,
      showSpinner: this.showSpinner,
      hideSpinner: this.hideSpinner,
      errorModal: this.errorModal
    });
    
    this.pointsManagers.set(type, pointsManager);
    return true;
  }

  /**
   * Initialise le gestionnaire de lignes si nécessaire pour un type donné
   * @param {string} type - Type de ligne (LIGNE_AERIENNE_HTA, LIGNE_AERIENNE_BT, LIGNE_SOUTERRAINE_HTA, LIGNE_SOUTERRAINE_BT)
   * @returns {boolean} true si le gestionnaire de lignes a été initialisé, false sinon
   * @private
   */
  _ensureLinesManager(type) {
    // Si le gestionnaire existe déjà pour ce type, vérifier que la carte est à jour
    if (this.linesManagers.has(type)) {
      const manager = this.linesManagers.get(type);
      // Essayer d'obtenir la carte depuis différentes sources
      let map = this.map;
      
      if (!map && this.getMap) {
        map = this.getMap();
        if (map) {
          this.map = map;
        }
      }
      
      if (!map && typeof window !== 'undefined' && window.map) {
        map = window.map;
        this.map = map;
      }
      
      if (!map) {
        const mapElement = document.getElementById('map');
        if (mapElement && mapElement._map) {
          map = mapElement._map;
          this.map = map;
        }
      }
      
      if (map && manager.map !== map) {
        manager.map = map;
      }
      
      return true;
    }

    // Essayer d'obtenir la carte depuis différentes sources
    let map = this.map;
    
    // 1. Essayer depuis getMap() (MapViewsControl)
    if (!map && this.getMap) {
      map = this.getMap();
      if (map) {
        this.map = map; // Mettre à jour la référence pour les prochaines fois
      }
    }
    
    // 2. Si toujours pas disponible, essayer window.map (carte globale)
    if (!map && typeof window !== 'undefined' && window.map) {
      map = window.map;
      this.map = map; // Mettre à jour la référence pour les prochaines fois
    }
    
    // 3. Si toujours pas de carte, essayer de la récupérer depuis le DOM
    if (!map) {
      const mapElement = document.getElementById('map');
      if (mapElement && mapElement._map) {
        map = mapElement._map;
        this.map = map;
      }
    }
    
    if (!map) {
      console.error('EnedisControl: La carte n\'est pas disponible. Vérifiez que la carte est initialisée.');
      return false;
    }

    // Créer un nouveau LinesManager pour ce type
    const linesManager = new LinesManager({
      map: map,
      type: type,
      showSpinner: this.showSpinner,
      hideSpinner: this.hideSpinner,
      errorModal: this.errorModal
    });
    
    this.linesManagers.set(type, linesManager);
    return true;
  }

  /**
   * Met à jour la référence de la carte pour tous les gestionnaires de points
   * @param {google.maps.Map} map - Instance de la carte
   */
  setMap(map) {
    this.map = map;
    // Mettre à jour la carte pour tous les gestionnaires existants
    this.pointsManagers.forEach(manager => {
      manager.map = map;
    });
    this.linesManagers.forEach(manager => {
      manager.map = map;
    });
  }

  /**
   * Crée le menu déroulant Enedis avec toutes les options
   * @returns {HTMLElement} - Le conteneur du menu avec le bouton et le sous-menu
   */
  createEnedisMenu() {
    const options = [
      // Lignes Aériennes
      {
        label: "Lignes Aériennes :",
        onClick: () => {}, // Séparateur, pas d'action
        isSelected: () => false,
        isSeparator: true
      },
      {
        label: "HTA",
        onClick: () => this.toggleLigneAerienneHTA(),
        isSelected: () => this.isLigneAerienneHTAVisible
      },
      {
        label: "BT",
        onClick: () => this.toggleLigneAerienneBT(),
        isSelected: () => this.isLigneAerienneBTVisible
      },
      // Lignes Souterraines
      {
        label: "Lignes souterraines :",
        onClick: () => {}, // Séparateur, pas d'action
        isSelected: () => false,
        isSeparator: true
      },
      {
        label: "HTA",
        onClick: () => this.toggleLigneSouterraineHTA(),
        isSelected: () => this.isLigneSouterraineHTAVisible
      },
      {
        label: "BT",
        onClick: () => this.toggleLigneSouterraineBT(),
        isSelected: () => this.isLigneSouterraineBTVisible
      },
      // Autres
      {
        label: "Autres :",
        onClick: () => {}, // Séparateur, pas d'action
        isSelected: () => false,
        isSeparator: true
      },
      {
        label: "Postes sources ou HTA/HTA",
        onClick: () => this.togglePosteSourceHTAHTA(),
        isSelected: () => this.isPosteSourceHTAHTAVisible
      },
      {
        label: "Postes HTA/BT",
        onClick: () => this.togglePosteHTABT(),
        isSelected: () => this.isPosteHTABTVisible
      },
      {
        label: "Poteaux HTA ou BT",
        onClick: () => this.togglePoteauHTAouBT(),
        isSelected: () => this.isPoteauHTAouBTVisible
      }
    ];

    return this._createDropdownMenu(
      "Enedis",
      "enedis-main-button",
      options
    );
  }

  /**
   * Méthode générique pour créer un menu déroulant avec support des séparateurs
   * @param {string} buttonText - Texte du bouton principal
   * @param {string} menuId - ID unique pour le bouton principal
   * @param {Array} options - Tableau d'options { label: string, onClick: function, isSelected: function, isSeparator?: boolean }
   * @returns {HTMLElement} - Le conteneur du menu avec le bouton et le sous-menu
   */
  _createDropdownMenu(buttonText, menuId, options) {
    const container = document.createElement("div");
    const controller = new AbortController();
    container.className = `${menuId}-menu-container`;
    container.style.position = "relative";

    let isMenuOpen = false;
    let menuItems = [];
    let focusedItemIndex = -1;

    const openMenu = () => {
      isMenuOpen = true;
      submenu.style.display = "block";
      mainButton.setAttribute("aria-expanded", "true");
      
      // Trouver le premier item interactif (non séparateur)
      const firstItem = menuItems.find(item => item && item.getAttribute("role") === "menuitemcheckbox");
      if (firstItem) {
        focusedItemIndex = menuItems.indexOf(firstItem);
        firstItem.focus();
      }
    };

    const closeMenu = () => {
      isMenuOpen = false;
      submenu.style.display = "none";
      mainButton.setAttribute("aria-expanded", "false");
      focusedItemIndex = -1;
      mainButton.focus();
    };

    const mainButton = this.createButton(buttonText, () => {
      if (isMenuOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    });
    mainButton.id = menuId;
    mainButton.setAttribute("aria-haspopup", "true");
    mainButton.setAttribute("aria-expanded", "false");
    mainButton.setAttribute("tabindex", "0");

    const submenu = document.createElement("div");
    submenu.className = `${menuId}-submenu`;
    submenu.setAttribute("role", "menu");
    submenu.style.cssText = `
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      background-color: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      z-index: 1001;
      min-width: 200px;
    `;

    // Gestionnaire de navigation clavier pour le menu
    const handleMenuKeyDown = (event) => {
      if (!isMenuOpen) return;

      const interactiveItems = menuItems.filter(item => 
        item && item.getAttribute("role") === "menuitemcheckbox"
      );

      // Trouver l'index actuel de l'item focusé dans interactiveItems
      const currentFocusedItem = interactiveItems.find(item => 
        item === document.activeElement
      );
      let currentIndex = currentFocusedItem 
        ? interactiveItems.indexOf(currentFocusedItem)
        : (focusedItemIndex >= 0 ? focusedItemIndex : 0);

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          currentIndex = currentIndex < interactiveItems.length - 1 
            ? currentIndex + 1 
            : 0; // Wrap to first
          focusedItemIndex = menuItems.indexOf(interactiveItems[currentIndex]);
          interactiveItems[currentIndex]?.focus();
          break;

        case "ArrowUp":
          event.preventDefault();
          currentIndex = currentIndex > 0 
            ? currentIndex - 1 
            : interactiveItems.length - 1; // Wrap to last
          focusedItemIndex = menuItems.indexOf(interactiveItems[currentIndex]);
          interactiveItems[currentIndex]?.focus();
          break;

        case "Home":
          event.preventDefault();
          currentIndex = 0;
          focusedItemIndex = menuItems.indexOf(interactiveItems[0]);
          interactiveItems[0]?.focus();
          break;

        case "End":
          event.preventDefault();
          currentIndex = interactiveItems.length - 1;
          focusedItemIndex = menuItems.indexOf(interactiveItems[currentIndex]);
          interactiveItems[currentIndex]?.focus();
          break;

        case "Escape":
          event.preventDefault();
          closeMenu();
          break;

        case "Tab":
          // Focus trap : empêcher la sortie du menu avec Tab
          event.preventDefault();
          if (event.shiftKey) {
            // Shift+Tab : aller au dernier item
            currentIndex = interactiveItems.length - 1;
          } else {
            // Tab : aller au premier item
            currentIndex = 0;
          }
          focusedItemIndex = menuItems.indexOf(interactiveItems[currentIndex]);
          interactiveItems[currentIndex]?.focus();
          break;

        case "Enter":
        case " ":
          event.preventDefault();
          if (interactiveItems[currentIndex]) {
            interactiveItems[currentIndex].click();
          }
          break;
      }
    };

    submenu.addEventListener("keydown", handleMenuKeyDown, { signal: controller.signal });

    options.forEach((option, index) => {
      if (option.isSeparator) {
        // Créer un titre de catégorie (non cliquable)
        const categoryTitle = document.createElement("div");
        categoryTitle.className = "enedis-category-title";
        categoryTitle.textContent = option.label;
        categoryTitle.setAttribute("role", "presentation");
        const titleStyle = `
          padding: 10px 12px 6px 12px;
          font-weight: bold;
          font-size: 11px;
          color: #333;
          background-color: #f8f8f8;
          border-bottom: 1px solid #e0e0e0;
          cursor: default !important;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          user-select: none;
          pointer-events: none;
        `;
        categoryTitle.style.cssText = titleStyle;
        
        // Empêcher tout changement de style au survol
        categoryTitle.addEventListener("mouseenter", () => {
          categoryTitle.style.cssText = titleStyle;
        }, { signal: controller.signal });
        categoryTitle.addEventListener("mouseleave", () => {
          categoryTitle.style.cssText = titleStyle;
        }, { signal: controller.signal });
        
        submenu.appendChild(categoryTitle);
        menuItems.push(null); // Placeholder pour garder l'index synchronisé
      } else {
        // Créer une option normale avec indicateur visuel si nécessaire
        const submenuOption = this._createSubmenuOption(
          option.label,
          () => {
            option.onClick();
            // Ne pas fermer le menu automatiquement - il se fermera uniquement si l'utilisateur clique ailleurs
          },
          option.isSelected,
          index,
          options
        );
        submenu.appendChild(submenuOption);
        menuItems.push(submenuOption);
      }
    });

    container.appendChild(mainButton);
    container.appendChild(submenu);

    // Cacher le sous-menu si on clique ailleurs
    document.addEventListener("click", (event) => {
      if (!container.contains(event.target) && isMenuOpen) {
        closeMenu();
      }
    }, { signal: controller.signal });

    // Gestionnaire clavier pour le bouton principal
    mainButton.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (isMenuOpen) {
          closeMenu();
        } else {
          openMenu();
        }
      } else if (event.key === "ArrowDown" && !isMenuOpen) {
        event.preventDefault();
        openMenu();
      }
    }, { signal: controller.signal });

    container._cleanup = () => controller.abort();

    return container;
  }

  /**
   * Détermine le type d'indicateur visuel à afficher selon le label de l'option
   * @param {string} label - Le label de l'option
   * @param {number} index - L'index de l'option dans le tableau
   * @param {Array} options - Le tableau complet des options pour déterminer le contexte
   * @returns {Object|null} - { type: 'line'|'point', color: string } ou null
   */
  _getIndicatorForOption(label, index, options) {
    // Trouver la catégorie précédente pour déterminer le contexte
    let currentCategory = null;
    for (let i = index - 1; i >= 0; i--) {
      if (options[i].isSeparator) {
        currentCategory = options[i].label;
        break;
      }
    }

    // Lignes Aériennes
    if (currentCategory === "Lignes Aériennes :") {
      if (label === "HTA") {
        return { type: 'line', color: ENEDIS_COLORS.LIGNE_AERIENNE_HTA };
      } else if (label === "BT") {
        return { type: 'line', color: ENEDIS_COLORS.LIGNE_AERIENNE_BT };
      }
    }
    
    // Lignes souterraines
    if (currentCategory === "Lignes souterraines :") {
      if (label === "HTA") {
        return { type: 'line', color: ENEDIS_COLORS.LIGNE_SOUTERRAINE_HTA };
      } else if (label === "BT") {
        return { type: 'line', color: ENEDIS_COLORS.LIGNE_SOUTERRAINE_BT };
      }
    }
    
    // Autres
    if (currentCategory === "Autres :") {
      if (label === "Postes sources ou HTA/HTA") {
        return { type: 'point', color: ENEDIS_COLORS.POSTE_SOURCE_POINT };
      } else if (label === "Postes HTA/BT") {
        return { type: 'point', color: ENEDIS_COLORS.POSTE_HTA_BT_POINT };
      } else if (label === "Poteaux HTA ou BT") {
        return { type: 'point', color: ENEDIS_COLORS.POTEAU_POINT };
      }
    }
    
    return null;
  }

  /**
   * Crée une option de sous-menu avec styles visuels pour la sélection
   * @param {string} text - Texte de l'option
   * @param {Function} onClick - Fonction callback au clic
   * @param {Function} isSelected - Fonction qui retourne true si l'option est sélectionnée
   * @param {number} index - Index de l'option dans le tableau (pour déterminer le contexte)
   * @param {Array} allOptions - Tableau complet des options (pour déterminer le contexte)
   * @returns {HTMLElement} - L'élément div de l'option
   */
  _createSubmenuOption(text, onClick, isSelected, index = null, allOptions = null) {
    const option = document.createElement("div");
    option.setAttribute("role", "menuitemcheckbox");
    option.setAttribute("tabindex", "-1");
    option.style.display = "flex";
    option.style.alignItems = "center";
    option.style.gap = "8px";
    
    // Déterminer l'indicateur visuel si disponible
    let indicator = null;
    if (index !== null && allOptions !== null) {
      indicator = this._getIndicatorForOption(text, index, allOptions);
    }
    
    // Créer l'indicateur visuel si nécessaire
    if (indicator) {
      const indicatorElement = document.createElement("div");
      indicatorElement.setAttribute("aria-hidden", "true");
      if (indicator.type === 'line') {
        // Trait horizontal
        indicatorElement.style.cssText = `
          width: 16px;
          height: 4px;
          background-color: ${indicator.color};
          flex-shrink: 0;
        `;
      } else if (indicator.type === 'point') {
        // Point circulaire
        indicatorElement.style.cssText = `
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: ${indicator.color};
          flex-shrink: 0;
        `;
      }
      option.appendChild(indicatorElement);
    }
    
    // Créer le texte de l'option
    const textElement = document.createElement("span");
    textElement.textContent = text;
    option.appendChild(textElement);
    
    // Fonction pour mettre à jour les styles et attributs ARIA en fonction de l'état de sélection
    const updateStyles = () => {
      const selected = isSelected && isSelected();
      option.setAttribute("aria-checked", selected ? "true" : "false");
      option.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px;
        cursor: pointer;
        font-weight: ${selected ? 'bold' : 'normal'};
        background-color: ${selected ? '#e0e0e0' : 'white'};
        padding-left: 20px; /* Indentation pour les sous-options */
        outline: none;
      `;
      // Réappliquer les styles de l'indicateur si présent
      if (indicator && option.firstChild) {
        if (indicator.type === 'line') {
          option.firstChild.style.cssText = `
            width: 16px;
            height: 4px;
            background-color: ${indicator.color};
            flex-shrink: 0;
          `;
        } else if (indicator.type === 'point') {
          option.firstChild.style.cssText = `
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: ${indicator.color};
            flex-shrink: 0;
          `;
        }
      }
    };
    
    // Initialiser les styles et attributs ARIA
    updateStyles();
    
    // Gestionnaire de focus pour l'accessibilité
    option.addEventListener("focus", () => {
      const selected = isSelected && isSelected();
      option.style.backgroundColor = selected ? "#d0d0d0" : "#f0f0f0";
      option.style.outline = "2px solid #0066cc";
      option.style.outlineOffset = "-2px";
    });
    
    option.addEventListener("blur", () => {
      updateStyles();
    });
    
    option.addEventListener("mouseenter", () => {
      const selected = isSelected && isSelected();
      option.style.backgroundColor = selected ? "#d0d0d0" : "#f0f0f0";
      // Donner le focus au survol pour la navigation clavier
      option.focus();
    });
    
    option.addEventListener("mouseleave", () => {
      updateStyles();
    });
    
    // Gestionnaire de clic (souris et clavier)
    const handleActivation = () => {
      onClick();
      // Petite temporisation pour permettre au state de se mettre à jour avant de rafraîchir les styles
      setTimeout(() => updateStyles(), 50);
    };
    
    option.addEventListener("click", handleActivation);
    
    // Gestionnaire clavier pour Enter et Space
    option.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleActivation();
      }
    });
    
    return option;
  }

  /**
   * Met à jour l'état visuel du bouton Enedis
   */
  updateEnedisButtonState() {
    const enedisButton = document.getElementById("enedis-main-button");
    if (!enedisButton) return;

    const isActive = this.isLigneAerienneHTAVisible || 
                     this.isLigneAerienneBTVisible ||
                     this.isLigneSouterraineHTAVisible ||
                     this.isLigneSouterraineBTVisible ||
                     this.isPosteSourceHTAHTAVisible ||
                     this.isPosteHTABTVisible ||
                     this.isPoteauHTAouBTVisible;

    enedisButton.style.backgroundColor = isActive ? "hsla(0, 0%, 100%, 1)" : "hsla(0, 0%, 100%, 0.7)";
    if (isActive) {
      enedisButton.classList.add("selected");
    } else {
      enedisButton.classList.remove("selected");
    }
  }

  /**
   * Toggle la couche Lignes Aériennes HTA
   */
  async toggleLigneAerienneHTA() {
    this.isLigneAerienneHTAVisible = !this.isLigneAerienneHTAVisible;
    const type = ENEDIS_DATASOURCE_TYPES.LIGNE_AERIENNE_HTA;
    
    if (this.isLigneAerienneHTAVisible) {
      // Initialiser le gestionnaire si nécessaire
      if (!this._ensureLinesManager(type)) {
        this.isLigneAerienneHTAVisible = false; // Annuler l'activation si la carte n'est pas disponible
        this.updateEnedisButtonState();
        return;
      }
      // Activer l'affichage des lignes (async)
      try {
        const manager = this.linesManagers.get(type);
        await manager.enable();
      } catch (error) {
        console.error('EnedisControl: Erreur lors de l\'activation des lignes:', error);
        this.isLigneAerienneHTAVisible = false;
        this.updateEnedisButtonState();
      }
    } else {
      // Désactiver l'affichage des lignes pour ce type
      const manager = this.linesManagers.get(type);
      if (manager) {
        manager.disable();
      }
    }
    this.updateEnedisButtonState();
  }

  /**
   * Toggle la couche Lignes Aériennes BT
   */
  async toggleLigneAerienneBT() {
    this.isLigneAerienneBTVisible = !this.isLigneAerienneBTVisible;
    const type = ENEDIS_DATASOURCE_TYPES.LIGNE_AERIENNE_BT;
    
    if (this.isLigneAerienneBTVisible) {
      // Initialiser le gestionnaire si nécessaire
      if (!this._ensureLinesManager(type)) {
        this.isLigneAerienneBTVisible = false; // Annuler l'activation si la carte n'est pas disponible
        this.updateEnedisButtonState();
        return;
      }
      // Activer l'affichage des lignes (async)
      try {
        const manager = this.linesManagers.get(type);
        await manager.enable();
      } catch (error) {
        console.error('EnedisControl: Erreur lors de l\'activation des lignes:', error);
        this.isLigneAerienneBTVisible = false;
        this.updateEnedisButtonState();
      }
    } else {
      // Désactiver l'affichage des lignes pour ce type
      const manager = this.linesManagers.get(type);
      if (manager) {
        manager.disable();
      }
    }
    this.updateEnedisButtonState();
  }

  /**
   * Toggle la couche Lignes Souterraines HTA
   */
  async toggleLigneSouterraineHTA() {
    this.isLigneSouterraineHTAVisible = !this.isLigneSouterraineHTAVisible;
    const type = ENEDIS_DATASOURCE_TYPES.LIGNE_SOUTERRAINE_HTA;
    
    if (this.isLigneSouterraineHTAVisible) {
      // Initialiser le gestionnaire si nécessaire
      if (!this._ensureLinesManager(type)) {
        this.isLigneSouterraineHTAVisible = false; // Annuler l'activation si la carte n'est pas disponible
        this.updateEnedisButtonState();
        return;
      }
      // Activer l'affichage des lignes (async)
      try {
        const manager = this.linesManagers.get(type);
        await manager.enable();
      } catch (error) {
        console.error('EnedisControl: Erreur lors de l\'activation des lignes:', error);
        this.isLigneSouterraineHTAVisible = false;
        this.updateEnedisButtonState();
      }
    } else {
      // Désactiver l'affichage des lignes pour ce type
      const manager = this.linesManagers.get(type);
      if (manager) {
        manager.disable();
      }
    }
    this.updateEnedisButtonState();
  }

  /**
   * Toggle la couche Lignes Souterraines BT
   */
  async toggleLigneSouterraineBT() {
    this.isLigneSouterraineBTVisible = !this.isLigneSouterraineBTVisible;
    const type = ENEDIS_DATASOURCE_TYPES.LIGNE_SOUTERRAINE_BT;
    
    if (this.isLigneSouterraineBTVisible) {
      // Initialiser le gestionnaire si nécessaire
      if (!this._ensureLinesManager(type)) {
        this.isLigneSouterraineBTVisible = false; // Annuler l'activation si la carte n'est pas disponible
        this.updateEnedisButtonState();
        return;
      }
      // Activer l'affichage des lignes (async)
      try {
        const manager = this.linesManagers.get(type);
        await manager.enable();
      } catch (error) {
        console.error('EnedisControl: Erreur lors de l\'activation des lignes:', error);
        this.isLigneSouterraineBTVisible = false;
        this.updateEnedisButtonState();
      }
    } else {
      // Désactiver l'affichage des lignes pour ce type
      const manager = this.linesManagers.get(type);
      if (manager) {
        manager.disable();
      }
    }
    this.updateEnedisButtonState();
  }

  /**
   * Toggle la couche Postes sources ou HTA/HTA
   */
  async togglePosteSourceHTAHTA() {
    this.isPosteSourceHTAHTAVisible = !this.isPosteSourceHTAHTAVisible;
    const type = ENEDIS_DATASOURCE_TYPES.POSTE_SOURCE_POINT;
    
    if (this.isPosteSourceHTAHTAVisible) {
      // Initialiser le gestionnaire si nécessaire
      if (!this._ensurePointsManager(type)) {
        this.isPosteSourceHTAHTAVisible = false; // Annuler l'activation si la carte n'est pas disponible
        this.updateEnedisButtonState();
        return;
      }
      // Activer l'affichage des points (async)
      try {
        const manager = this.pointsManagers.get(type);
        await manager.enable();
      } catch (error) {
        console.error('EnedisControl: Erreur lors de l\'activation des points:', error);
        this.isPosteSourceHTAHTAVisible = false;
        this.updateEnedisButtonState();
      }
    } else {
      // Désactiver l'affichage des points pour ce type
      const manager = this.pointsManagers.get(type);
      if (manager) {
        manager.disable();
      }
    }
    this.updateEnedisButtonState();
  }

  /**
   * Toggle la couche Postes HTA/BT
   */
  async togglePosteHTABT() {
    this.isPosteHTABTVisible = !this.isPosteHTABTVisible;
    const type = ENEDIS_DATASOURCE_TYPES.POSTE_HTA_BT_POINT;
    
    if (this.isPosteHTABTVisible) {
      // Initialiser le gestionnaire si nécessaire
      if (!this._ensurePointsManager(type)) {
        this.isPosteHTABTVisible = false; // Annuler l'activation si la carte n'est pas disponible
        this.updateEnedisButtonState();
        return;
      }
      // Activer l'affichage des points (async)
      try {
        const manager = this.pointsManagers.get(type);
        await manager.enable();
      } catch (error) {
        console.error('EnedisControl: Erreur lors de l\'activation des points:', error);
        this.isPosteHTABTVisible = false;
        this.updateEnedisButtonState();
      }
    } else {
      // Désactiver l'affichage des points pour ce type
      const manager = this.pointsManagers.get(type);
      if (manager) {
        manager.disable();
      }
    }
    this.updateEnedisButtonState();
  }

  /**
   * Toggle la couche Poteaux HTA ou BT
   */
  async togglePoteauHTAouBT() {
    this.isPoteauHTAouBTVisible = !this.isPoteauHTAouBTVisible;
    const type = ENEDIS_DATASOURCE_TYPES.POTEAU_POINT;
    
    if (this.isPoteauHTAouBTVisible) {
      // Initialiser le gestionnaire si nécessaire
      if (!this._ensurePointsManager(type)) {
        this.isPoteauHTAouBTVisible = false; // Annuler l'activation si la carte n'est pas disponible
        this.updateEnedisButtonState();
        return;
      }
      // Activer l'affichage des points (async)
      try {
        const manager = this.pointsManagers.get(type);
        await manager.enable();
      } catch (error) {
        console.error('EnedisControl: Erreur lors de l\'activation des points:', error);
        this.isPoteauHTAouBTVisible = false;
        this.updateEnedisButtonState();
      }
    } else {
      // Désactiver l'affichage des points pour ce type
      const manager = this.pointsManagers.get(type);
      if (manager) {
        manager.disable();
      }
    }
    
    this.updateEnedisButtonState();
  }

  /**
   * Nettoie toutes les ressources (méthode utile pour le cleanup)
   */
  destroy() {
    // Désactiver tous les gestionnaires de points
    this.pointsManagers.forEach(manager => {
      manager.destroy();
    });
    this.pointsManagers.clear();
  }
}

export default EnedisControl;

