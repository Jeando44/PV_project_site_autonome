import { CUSTOM_EVENTS, TYPE_COUVERTURE_MAP } from "../../DrawingControl/constants.js";
import ParcelleMarkerManager from "./parcelleMarkerManager.js";

class ResumeParcellesControl {
  constructor(options) {
    this.errorModal = options.errorModal;
    this.showSpinner = options.showSpinner;
    this.hideSpinner = options.hideSpinner;
    this.map = options.map;
    this.getAdvancedMarkerElement = options.getAdvancedMarkerElement;
    
    // Initialiser les références des boutons avant de créer le container
    this.addParcelleButton = null;
    this.toggleVisibilityButton = null;
    
    // Créer le container (qui va initialiser les boutons)
    this.parcellesContainer = this.createParcellesContainer();
    
    // Initialiser le ParcelleMarkerManager après que la map soit disponible
    this.parcelleMarkerManager = null;
    
    // Ajouter un système de debouncing pour éviter les appels multiples
    this.updateTimeout = null;
    this.isUpdating = false;
    // Champs PV résidentiels dont la parcelle non identifiée a déjà été redemandée (cf. updateParcellesContainer).
    this._maisonsRetentees = new Set();

    this._addEventListeners();
    // Mettre à jour avec un délai pour laisser le temps au StorageManager de charger
    setTimeout(() => {
      this.updateParcellesContainer(true);
    }, 500);
  }
  
  /**
   * Initialise le ParcelleMarkerManager une fois que la map est disponible
   * @param {google.maps.Map} map - Instance de la carte
   */
  initializeWithMap(map) {
    this.map = map;
    if (!this.parcelleMarkerManager) {
      this.parcelleMarkerManager = new ParcelleMarkerManager({
        map: this.map,
        errorModal: this.errorModal,
        getAdvancedMarkerElement: this.getAdvancedMarkerElement
      });
      
      // Mettre à jour l'icône du bouton de visibilité avec l'état chargé
      setTimeout(() => {
        const isVisible = this.parcelleMarkerManager.areMarkersVisible();
        this._updateVisibilityButtonIcon(isVisible);
      }, 100);
    }
  }

  _addEventListeners() {
    document.addEventListener(CUSTOM_EVENTS.SHAPE_REMOVED, (event) => {
      this.debouncedUpdate(false);
    });
    document.addEventListener(CUSTOM_EVENTS.SOLAR_DATA_BATCH_UPDATED, () => {
      this.debouncedUpdate(false);
    });
    document.addEventListener(CUSTOM_EVENTS.SHAPE_ADDED, (event) => {
      const { pvId, center, dimensions } = event.detail;
      
      // Si on a les données de centre dans l'événement, récupérer les infos cadastrales immédiatement
      if (center && pvId) {
        // Créer la ligne de parcelle immédiatement, sans lancer l'appel cadastral (demande
        // explicite : ne plus interroger /api/cadastre-geoportail à chaque forme dessinée/déplacée
        // — la ligne reste "(Parcelle non identifiée)" jusqu'au clic sur "Calculer et Visualiser",
        // qui appelle refreshAllParcelles() ci-dessous, cf. ButtonControl.js).
        const tbody = this.parcellesContainer.querySelector(".parcelles-tbody");
        if (tbody) {
          this._createParcelleRow(tbody, pvId, null);
        }
      }

      this.debouncedUpdate(false);
    });

    // NOUVEAU (extension au calepinage maison résidentielle, demande explicite) : événement DÉDIÉ
    // dispatché par polygon_maison.js à la fin d'un tracé de contour de maison — volontairement
    // distinct de SHAPE_ADDED ci-dessus (réservé aux formes "grands projets" : SHAPE_ADDED est
    // aussi écouté par TabsManager.js, qui créerait un onglet "Données système" + interrogerait
    // PVGIS pour ce pvId, non pertinent pour une maison). Même logique de traitement que
    // SHAPE_ADDED : ligne de parcelle immédiate + requête cadastrale sur le centre fourni,
    // réutilisées telles quelles (_createParcelleRow/_getParcelleInfo, communes aux deux flux).
    document.addEventListener('maisonShapeAdded', (event) => {
      const { pvId, center } = event.detail;
      if (center && pvId) {
        const tbody = this.parcellesContainer.querySelector(".parcelles-tbody");
        if (tbody) {
          this._createParcelleRow(tbody, pvId, null);
        }
        this._getParcelleInfo(center.lat, center.lng, pvId);
      }
      this.debouncedUpdate(false);
    });

    // Fin de la restauration des contours (chargement de page / changement de projet) : le premier
    // passage (500 ms après la construction) arrive souvent AVANT elle et ne voit alors aucun champ.
    document.addEventListener('maisonShapesRestored', () => this.debouncedUpdate(false));

    // Champ PV supprimé : sa parcelle ne doit plus figurer dans le résumé ni dans le rapport PDF.
    // Émis avant la renumérotation (différée), que l'écouteur suivant traite ensuite.
    document.addEventListener('maisonShapeRemoved', (event) => {
      const pvId = event.detail && event.detail.pvId;
      if (!pvId) return;
      try {
        const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
        if (savedData.maisonParcelles && savedData.maisonParcelles[pvId]) {
          delete savedData.maisonParcelles[pvId];
          localStorage.setItem("solarProjectData", JSON.stringify(savedData));
        }
      } catch (error) {
        console.warn("Suppression de la parcelle du champ PV impossible:", error);
      }
      const row = this.parcellesContainer && this.parcellesContainer.querySelector(`tr.parcelle-detail-row[data-shape-id="${pvId}"]`);
      if (row) row.remove();
      this._updateTotalRow();
    });

    // Champs PV du calepinage résidentiel renumérotés après une suppression (polygon_maison.js /
    // orchestrateur::renumeroterChampsPV) : les parcelles déjà identifiées suivent leur champ, et les
    // lignes du tableau sont reconstruites sous les nouveaux numéros.
    document.addEventListener('maisonShapesRenumbered', (event) => {
      const correspondance = (event.detail && event.detail.correspondance) || {};
      const anciens = Object.keys(correspondance);
      if (!anciens.length) return;
      try {
        const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
        if (savedData.maisonParcelles) {
          const renomme = {};
          Object.keys(savedData.maisonParcelles).forEach((id) => {
            const nouveau = Object.prototype.hasOwnProperty.call(correspondance, id) ? correspondance[id] : id;
            // Une entrée restée sous un n° réattribué (champ supprimé) est écrasée par celle du champ renuméroté.
            if (!renomme[nouveau] || nouveau !== id) renomme[nouveau] = savedData.maisonParcelles[id];
          });
          anciens.forEach((id) => { if (!Object.values(correspondance).includes(id)) delete renomme[id]; });
          savedData.maisonParcelles = renomme;
          localStorage.setItem("solarProjectData", JSON.stringify(savedData));
        }
      } catch (error) {
        console.warn("Renumérotation des parcelles des champs PV impossible:", error);
      }
      const tbody = this.parcellesContainer && this.parcellesContainer.querySelector(".parcelles-tbody");
      if (tbody) {
        const concernes = new Set(anciens.concat(Object.values(correspondance)));
        tbody.querySelectorAll("tr.parcelle-detail-row").forEach((row) => {
          if (concernes.has(row.dataset.shapeId)) row.remove();
        });
      }
      this.debouncedUpdate(false);
    });

    document.addEventListener(CUSTOM_EVENTS.CADASTRAL_DATA_LOADED, (event) => {
      const { shapeId, echec } = event.detail;
      let { parcelleData } = event.detail;

      localStorage.setItem("parcelleData", JSON.stringify(event.detail))

      // Sauvegarder les données cadastrales dans le localStorage
      try {
        const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
        if (savedData.shapes && savedData.shapes[shapeId]) {
          savedData.shapes[shapeId].parcelleData = parcelleData;
          localStorage.setItem("solarProjectData", JSON.stringify(savedData));
        } else {
          // NOUVEAU (maison résidentielle, polygon_maison.js) : ce shapeId n'existe pas dans
          // savedData.shapes — module volontairement découplé du calepinage "grands projets" (pas
          // de gridInfo/_originalDimensions/etc., cf. polygon_maison.js en-tête). Persistance
          // parallèle, même principe que savedData.manualParcelles (marqueurs manuels ci-dessous),
          // pour survivre à un rechargement de page sans risquer de corrompre les hypothèses du
          // pipeline "grands projets" ailleurs (StorageManager.js/PanelsExtent.js lisent
          // savedData.shapes[pvId].gridInfo, absent pour une maison).
          if (!savedData.maisonParcelles) savedData.maisonParcelles = {};
          // Un échec d'appel (réseau, session) n'efface pas une parcelle déjà identifiée.
          const connue = savedData.maisonParcelles[shapeId] && savedData.maisonParcelles[shapeId].parcelleData;
          if (!parcelleData && connue && echec) {
            parcelleData = connue;
          } else {
            savedData.maisonParcelles[shapeId] = { parcelleData };
            localStorage.setItem("solarProjectData", JSON.stringify(savedData));
          }
        }
      } catch (error) {
        console.error("Erreur lors de la sauvegarde des données cadastrales:", error);
      }
      
      // Mettre à jour l'affichage dans le tableau
      const tbody = this.parcellesContainer.querySelector(".parcelles-tbody");
      if (tbody) {
        const rowToUpdate = tbody.querySelector(`tr[data-shape-id="${shapeId}"]`);
        if (rowToUpdate) {
          this._updateParcelleRowContent(rowToUpdate, parcelleData);
        }
        // Mettre à jour le total des surfaces
        this._updateTotalRow();
      }
    });

    // Écouteurs pour les marqueurs de parcelles
    document.addEventListener(CUSTOM_EVENTS.PARCELLE_MARKER_ADDED, (event) => {
      const { markerId, markerNumber, cadastreData, isReload } = event.detail;
      const tbody = this.parcellesContainer.querySelector(".parcelles-tbody");
      if (tbody) {
        this._createManualParcelleRow(tbody, markerId, markerNumber, cadastreData);
        // Mettre à jour le total des surfaces
        this._updateTotalRow();
      }
    });

    document.addEventListener(CUSTOM_EVENTS.PARCELLE_MARKER_REMOVED, (event) => {
      const { markerId } = event.detail;
      const tbody = this.parcellesContainer.querySelector(".parcelles-tbody");
      if (tbody) {
        const rowToRemove = tbody.querySelector(`tr[data-marker-id="${markerId}"]`);
        if (rowToRemove) {
          rowToRemove.remove();
        }
        // Mettre à jour le total des surfaces
        this._updateTotalRow();
      }
    });

    // Écouteurs pour le mode d'ajout de marqueur
    document.addEventListener(CUSTOM_EVENTS.PARCELLE_MARKER_MODE_ACTIVATED, () => {
      this._updateAddButtonState(true);
    });

    document.addEventListener(CUSTOM_EVENTS.PARCELLE_MARKER_MODE_DEACTIVATED, () => {
      this._updateAddButtonState(false);
    });
  }

  // Nouvelle méthode pour debouncer les appels multiples
  debouncedUpdate(shouldShowSpinner = false) {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    
    this.updateTimeout = setTimeout(() => {
      this.updateParcellesContainer(shouldShowSpinner);
    }, 200); // Attendre 200ms avant de déclencher la mise à jour
  }

  createParcellesContainer() {
    const parcellesContainer = document.createElement("div");
    parcellesContainer.classList.add("parcelles-container");
    parcellesContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0;
      border-top: 1px solid #c0c0c0;
      border-bottom: 1px solid #eee;
      background-color: hsla(0, 0%, 90%, 0.5);
      min-height: fit-content;
      border-radius: 2px 0 2px 0;
      z-index: 100;
      max-width: 25vw;
      width: fit-content;
      min-width: fit-content;
      cursor: default;
      pointer-events: auto;
    `;

    const table = document.createElement("table");
    table.style.cssText = `
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      background-color: hsla(0, 0%, 100%, 0.7);
      cursor: default;
    `;

    const tbody = document.createElement("tbody");
    tbody.classList.add("parcelles-tbody");
    tbody.style.cssText = `
      min-height: fit-content;
    `;

    const addressLabelRow = document.createElement("tr");
    addressLabelRow.classList.add("address-label-row");
    addressLabelRow.style.cssText = `
      min-height: fit-content;
      width:100%;
      background-color: transparent; 
    `;

    const addressLabel = document.createElement("td");
    addressLabel.style.cssText = `
      padding: 5px;
      text-align: center;
      border-bottom: 1px solid #ddd;
      font-weight: bold;
      background-color: transparent;
      width: 200%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    `;
    
    // Créer le span pour le texte
    const addressTextSpan = document.createElement("span");
    addressTextSpan.textContent = "Adresse / Coordonnées / Hypothèses climatiques";
    
    // Créer un conteneur pour les boutons
    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.cssText = `
      display: flex;
      gap: 5px;
      align-items: center;
    `;
    
    // Créer le bouton de visibilité
    const toggleVisibilityButton = document.createElement("button");
    toggleVisibilityButton.title = "Afficher/Masquer les marqueurs de parcelles";
    toggleVisibilityButton.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 5C7 5 2.73 8.11 1 12.5C2.73 16.89 7 20 12 20C17 20 21.27 16.89 23 12.5C21.27 8.11 17 5 12 5Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="12" cy="12.5" r="3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    toggleVisibilityButton.style.cssText = `
      background-color: #2196F3;
      color: white;
      border: none;
      border-radius: 4px;
      width: 28px;
      height: 28px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    `;
    
    // Stocker la référence dans l'instance
    this.toggleVisibilityButton = toggleVisibilityButton;
    
    // Ajouter l'écouteur de clic pour la visibilité
    toggleVisibilityButton.addEventListener("click", () => {
      if (this.parcelleMarkerManager) {
        const isVisible = this.parcelleMarkerManager.toggleMarkersVisibility();
        this._updateVisibilityButtonIcon(isVisible);
      }
    });
    
    // Créer le bouton "+"
    const addButton = document.createElement("button");
    addButton.textContent = "+";
    addButton.title = "Ajouter une parcelle manuellement";
    addButton.style.cssText = `
      background-color: #4CAF50;
      color: white;
      border: none;
      border-radius: 4px;
      width: 28px;
      height: 28px;
      font-size: 18px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    // Stocker la référence dans l'instance
    this.addParcelleButton = addButton;
    
    // Ajouter l'écouteur de clic
    addButton.addEventListener("click", () => {
      if (this.parcelleMarkerManager) {
        this.parcelleMarkerManager.toggleMode();
      } else {
        if (this.errorModal) {
          this.errorModal.show("La carte n'est pas encore complètement chargée. Veuillez patienter.");
        }
      }
    });
    
    buttonsContainer.appendChild(toggleVisibilityButton);
    buttonsContainer.appendChild(addButton);
    
    addressLabel.appendChild(addressTextSpan);
    addressLabel.appendChild(buttonsContainer);
    addressLabel.colSpan = 2; // Pour occuper toute la largeur (2 colonnes maintenant)

    const addressValueRow = document.createElement("tr");
    addressValueRow.classList.add("address-value-row");
    addressValueRow.style.cssText = `
      min-height: fit-content;
      width: 100%;
      background-color: transparent;
    `;

    const addressValue = document.createElement("td");
    addressValue.textContent = "-"; // Valeur initiale
    addressValue.classList.add("address-cell");
    addressValue.colSpan = 2; // Pour occuper toute la largeur
    addressValue.style.cssText = `
      padding: 5px;
      border-bottom: 1px solid #ddd;
      text-align: center;
      width: 100%;
      background-color: transparent;
    `;

    addressLabelRow.appendChild(addressLabel);
    addressValueRow.appendChild(addressValue);
    
    tbody.appendChild(addressLabelRow);
    tbody.appendChild(addressValueRow);

    const parcelleTitleRow = document.createElement("tr");
    parcelleTitleRow.classList.add("parcelle-title-row");
    parcelleTitleRow.style.cssText = `
      min-height: fit-content;
      width: 100%;
      background-color: transparent;
    `;

    const parcelleTitle1 = document.createElement("th");
    parcelleTitle1.textContent = "Zone";
    parcelleTitle1.style.cssText = `
      padding: 5px;
      text-align: center;
      border-bottom: 1px solid #ddd;
      font-weight: bold;
      background-color: transparent;
      width: 33.33%;
    `;

    const parcelleTitle2 = document.createElement("th");
    parcelleTitle2.textContent = "N° et surface de la parcelle";
    parcelleTitle2.style.cssText = `
      padding: 5px;
      text-align: center;
      border-bottom: 1px solid #ddd;
      font-weight: bold;
      background-color: transparent;
      width: 50%;
    `;

    parcelleTitleRow.appendChild(parcelleTitle1);
    parcelleTitleRow.appendChild(parcelleTitle2);
    tbody.appendChild(parcelleTitleRow);

    // Créer la ligne de total
    const totalRow = document.createElement("tr");
    totalRow.classList.add("total-row");
    totalRow.style.cssText = `
      min-height: fit-content;
      width: 100%;
      background-color: transparent;
      border-top: 2px solid #333;
    `;

    const totalLabelCell = document.createElement("td");
    totalLabelCell.textContent = "Total surface parcelles";
    totalLabelCell.style.cssText = `
      padding: 5px;
      text-align: center;
      border-bottom: 1px solid #ddd;
      border-right: 1px solid #ddd;
      font-weight: bold;
      background-color: transparent;
      width: 50%;
      font-size: 11px;
    `;

    const totalValueCell = document.createElement("td");
    totalValueCell.classList.add("total-surface-cell");
    totalValueCell.textContent = "0 m²";
    totalValueCell.style.cssText = `
      padding: 5px;
      border-bottom: 1px solid #ddd;
      text-align: center;
      font-weight: bold;
      background-color: transparent;
      width: 50%;
      font-size: 11px;
    `;

    totalRow.appendChild(totalLabelCell);
    totalRow.appendChild(totalValueCell);
    tbody.appendChild(totalRow);

    table.appendChild(tbody);
    parcellesContainer.appendChild(table);

    return parcellesContainer;
  }

  async updateParcellesContainer(shouldShowSpinner = true) {
    if (this.isUpdating) {
      return;
    }
    this.isUpdating = true;
    if (shouldShowSpinner && this.showSpinner) {
      this.showSpinner();
    }
    try {
      const tbody = this.parcellesContainer.querySelector(".parcelles-tbody");
      if (!tbody) return;

      const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
      const addressCell = tbody.querySelector(".address-cell");
      if (addressCell) {
        let address = "Non définie";
        let lat = null, lng = null, alt = "N/A";

        // Extraction des données depuis les informations du projet
        if (savedData.projectInfo) {
            const addrRaw = savedData.projectInfo.adresseProjet || savedData.projectInfo.adresse_projet || savedData.projectInfo.adresse || savedData.projectAddress;
            if (addrRaw) {
                try {
                    // Gère le cas où l'adresse est enregistrée en JSON avec les coordonnées
                    const parsedAddr = JSON.parse(addrRaw);
                    if (parsedAddr.adresse) address = parsedAddr.adresse;
                    if (parsedAddr.latitude !== undefined) lat = parsedAddr.latitude;
                    if (parsedAddr.longitude !== undefined) lng = parsedAddr.longitude;
                } catch(e) {
                    address = addrRaw; // Chaîne simple
                }
            }
            // Récupération de l'altitude si renseignée dans le projet
            if (savedData.projectInfo.altitude !== undefined && savedData.projectInfo.altitude !== "") {
                alt = parseFloat(savedData.projectInfo.altitude).toFixed(2) + " m";
            }
        } else if (savedData.projectAddress) {
            address = savedData.projectAddress;
        }

        // Fallback des coordonnées depuis la position de la carte ou d'une surface
        let coords = savedData.selectedShapeCenter || savedData.mapCenter;
        if (lat === null || lng === null) {
            if (coords && coords.lat !== undefined && coords.lng !== undefined) {
                lat = coords.lat;
                lng = coords.lng;
            } else if (savedData.shapes && Object.keys(savedData.shapes).length > 0) {
                const firstShapeId = Object.keys(savedData.shapes)[0];
                lat = savedData.shapes[firstShapeId].center.lat;
                lng = savedData.shapes[firstShapeId].center.lng;
            }
        }

        const latStr = lat !== null ? parseFloat(lat).toFixed(6) : "N/A";
        const lngStr = lng !== null ? parseFloat(lng).toFixed(6) : "N/A";

        // Appel à l'API Google Maps Elevation si l'altitude n'est pas encore connue
        if (alt === "N/A" && lat !== null && lng !== null) {
            try {
                const elevationService = new google.maps.ElevationService();
                await new Promise((resolve) => {
                    elevationService.getElevationForLocations({
                        locations: [{ lat: parseFloat(lat), lng: parseFloat(lng) }]
                    }, (results, status) => {
                        if (status === google.maps.ElevationStatus.OK && results && results[0]) {
                            alt = results[0].elevation.toFixed(2) + " m";
                            // Sauvegarder dans le cache pour limiter les requêtes API
                            if (!savedData.projectInfo) savedData.projectInfo = {};
                            savedData.projectInfo.altitude = parseFloat(results[0].elevation.toFixed(2));
                            localStorage.setItem("solarProjectData", JSON.stringify(savedData));
                        }
                        resolve();
                    });
                });
            } catch (e) {
                console.warn("Impossible de récupérer l'altitude via l'API Google Maps:", e);
            }
        }

        // Récupération des zones climatiques (hypothèses réglementaires) depuis le localStorage.
        // Repli individuel sur le DOM si un champ précis n'a pas encore été persisté, pour éviter
        // d'afficher "N/A" partout dès qu'un seul des 4 champs manque dans climateZones.
        const meteo = savedData.climateZones || {};
        const zVent = meteo.vent || document.getElementById('input_zone_de_vent')?.value || "N/A";
        const zNeige = meteo.neige || document.getElementById('input_zone_de_neige')?.value || "N/A";
        const catTerrain = meteo.terrain || document.getElementById('input_categorie_de_terrain')?.value || "N/A";
        const zSismique = meteo.sismique || document.getElementById('input_zone_sismique')?.value || "N/A";

        addressCell.innerHTML = `<strong>${address}</strong><br><span style="display: inline-block; margin-top: 6px; font-size: 13px; color: #555;">Lat: ${latStr} | Long: ${lngStr} | Alt: ${alt}</span><br><span style="display: inline-block; margin-top: 4px; font-size: 12px; color: #777;">Z-Vent : ${zVent} | Z-Neige : ${zNeige} | Cat-terrain : ${catTerrain} | Z-sismique : ${zSismique}</span>`;
      }

      const existingRowsMap = new Map();
      tbody.querySelectorAll("tr.parcelle-detail-row").forEach(row => {
        const shapeId = row.dataset.shapeId;
        if (shapeId) {
          if (existingRowsMap.has(shapeId)) {
            row.remove();
          } else {
            existingRowsMap.set(shapeId, row);
          }
        }
      });

      const shapeEntries = savedData.shapes ? Object.entries(savedData.shapes) : [];
      const processedShapeIds = new Set();

      for (const [shapeId, shapeData] of shapeEntries) {
        processedShapeIds.add(shapeId);
        if (!existingRowsMap.has(shapeId)) {
          // Utiliser les données cadastrales sauvegardées si elles existent
          const parcelleData = shapeData.parcelleData || null;
          this._createParcelleRow(tbody, shapeId, parcelleData);
        }
        // Récupérer les données cadastrales si elles ne sont pas déjà présentes
        if (shapeData.center && !shapeData.parcelleData) {
          this._getParcelleInfo(shapeData.center.lat, shapeData.center.lng, shapeId);
        }
      }

      // NOUVEAU (extension au calepinage maison résidentielle, demande explicite) : même boucle que
      // ci-dessus pour savedData.shapes, mais sur les contours de maisons (polygon_maison.js, stockés
      // à part dans calepinage_maison_polygons_v1 — module volontairement découplé du calepinage
      // "grands projets") + savedData.maisonParcelles (parallèle à savedData.shapes[id].parcelleData,
      // cf. écouteur CADASTRAL_DATA_LOADED ci-dessus) — nécessaire pour que les parcelles de maisons
      // survivent à un rechargement de page exactement comme les formes "grands projets".
      let maisonPolygons = [];
      try {
        const rawMaisons = localStorage.getItem('calepinage_maison_polygons_v1');
        maisonPolygons = rawMaisons ? JSON.parse(rawMaisons) : [];
      } catch (error) {
        maisonPolygons = [];
      }
      if (Array.isArray(maisonPolygons)) {
        const maisonParcelles = savedData.maisonParcelles || {};
        maisonPolygons.forEach((entry) => {
          if (!entry || !entry.maisonId || !entry.center) return;
          const maisonId = entry.maisonId;
          const cachedEntry = maisonParcelles[maisonId];
          const parcelleData = cachedEntry ? cachedEntry.parcelleData : null;

          processedShapeIds.add(maisonId);
          if (!existingRowsMap.has(maisonId)) {
            this._createParcelleRow(tbody, maisonId, parcelleData);
          }
          // Une entrée à null (échec d'un appel précédent, ex. avant la correction des chemins
          // /concevoir_mon_projet/api/...) était jusqu'ici définitive : on retente une fois par
          // chargement de page, sans boucler sur un point réellement hors cadastre.
          const aRetenter = cachedEntry && !cachedEntry.parcelleData && !this._maisonsRetentees.has(maisonId);
          if (!cachedEntry || aRetenter) {
            this._maisonsRetentees.add(maisonId);
            this._getParcelleInfo(entry.center.lat, entry.center.lng, maisonId);
          }
        });
      }

      existingRowsMap.forEach((row, shapeId) => {
        if (!processedShapeIds.has(shapeId)) {
          row.remove();
        }
      });

      // Mettre à jour le total des surfaces
      this._updateTotalRow();

      // NOUVEAU: Vérification de la conformité climatique (Z-vent, Z-Neige, Altitude)
      this._checkClimaticCompliance(savedData);

    } catch (error) {
      if (this.errorModal) {
        this.errorModal.show("Erreur lors de la mise à jour du résumé des parcelles.");
      }
    } finally {
      this.isUpdating = false;
      if (shouldShowSpinner && this.hideSpinner) {
        setTimeout(() => this.hideSpinner(), 200);
      }
    }
  }

  _updateParcelleRowContent(shapeRow, parcelleData) {
    const parcelleCell = shapeRow.cells[1];
    if (!parcelleCell) {
      return;
    }
    parcelleCell.textContent = this._texteParcelle(parcelleData);
  }

  /**
   * « SECTION NUMERO - SURFACE m² ». La surface peut être null (contenance illisible côté serveur) :
   * surface.toFixed levait alors une TypeError et la ligne restait « (Parcelle non identifiée) ».
   */
  _texteParcelle(parcelleData) {
    if (!parcelleData || !parcelleData.numero) return `(Parcelle non identifiée)`;
    const { numero, section, surface } = parcelleData;
    const surfaceTexte = Number.isFinite(Number(surface)) && surface !== null ? `${Number(surface).toFixed(0)} m²` : 'surface N/A';
    return `${section || ''} ${numero} - ${surfaceTexte}`.trim();
  }

  /**
   * Rafraîchit le n° de parcelle de TOUTES les formes connues : formes "grands projets" ET champs PV
   * du calepinage résidentiel (calepinage_maison_polygons_v1). Point d'entrée
   * unique appelé au clic sur "Calculer et Visualiser" (ButtonControl.js) — remplace l'ancien appel
   * automatique à chaque SHAPE_ADDED. Fire-and-forget par forme : le numéro de parcelle est un
   * affichage complémentaire, jamais une dépendance bloquante du calcul de production/rapport.
   */
  refreshAllParcelles() {
    try {
      const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
      const shapes = savedData.shapes || {};
      Object.entries(shapes).forEach(([pvId, shapeData]) => {
        if (shapeData && shapeData.center) {
          this._getParcelleInfo(shapeData.center.lat, shapeData.center.lng, pvId);
        }
      });
      // Champs PV du calepinage résidentiel (seul moteur depuis l'unification) : même rafraîchissement,
      // sur le centre persisté avec le contour — sans quoi un n° de parcelle non identifié l'était
      // pour toujours, ce bouton ne visant que les anciennes formes « grands projets ».
      const maisons = JSON.parse(localStorage.getItem('calepinage_maison_polygons_v1') || '[]');
      if (Array.isArray(maisons)) {
        maisons.forEach((entry) => {
          if (entry && entry.maisonId && entry.center) {
            this._getParcelleInfo(entry.center.lat, entry.center.lng, entry.maisonId);
          }
        });
      }
    } catch (error) {
      console.error("Erreur lors du rafraîchissement groupé des parcelles :", error);
    }
  }

  async _getParcelleInfo(lat, lng, shapeId) {
    try {
      const response = await fetch(`/concevoir_mon_projet/api/cadastre-geoportail?lat=${lat}&lng=${lng}`);
      if (!response.ok) {
        throw new Error(`Erreur API: ${response.status}`);
      }
      const parcelleData = await response.json();
      if (!parcelleData || !parcelleData.numero) {
        console.warn(`[Parcelles] Aucune parcelle cadastrale trouvée pour ${shapeId} (${lat}, ${lng}).`);
      }

      // Déclencher un événement personnalisé avec les données
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.CADASTRAL_DATA_LOADED, {
        detail: { shapeId, parcelleData: parcelleData && parcelleData.numero ? parcelleData : null }
      }));

    } catch (error) {
      // Jusqu'ici silencieux : impossible de distinguer un échec d'appel d'une parcelle introuvable.
      console.warn(`[Parcelles] Échec de l'appel cadastre pour ${shapeId} :`, error);
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.CADASTRAL_DATA_LOADED, {
        detail: { shapeId, parcelleData: null, echec: true }
      }));
    }
  }

  _createParcelleRow(tbody, shapeId, parcelleData) {
    const shapeRow = document.createElement("tr");
    shapeRow.classList.add("parcelle-detail-row");
    shapeRow.setAttribute("data-shape-id", shapeId);
    shapeRow.style.cssText = `
      min-height: fit-content;
      background-color: transparent; 
    `;

    const parcelleInfoText = this._texteParcelle(parcelleData);

    const zoneCell = document.createElement("td");
    zoneCell.textContent = shapeId;
    zoneCell.style.cssText = `
      padding: 5px;
      text-align: center;
      border-bottom: 1px solid #ddd;
      border-right: 1px solid #ddd;
      font-weight: bold;
      background-color: transparent;
      width: 50%;
      font-size: 11px;
    `;

    const parcelleCell = document.createElement("td");
    parcelleCell.textContent = parcelleInfoText;
    parcelleCell.style.cssText = `
      padding: 5px;
      border-bottom: 1px solid #ddd;
      text-align: center;
      width: 50%;
      font-size: 11px;
      background-color: transparent;
    `;

    shapeRow.appendChild(zoneCell);
    shapeRow.appendChild(parcelleCell);
    
    // Insérer avant la ligne de total si elle existe
    const totalRow = tbody.querySelector(".total-row");
    if (totalRow) {
      tbody.insertBefore(shapeRow, totalRow);
    } else {
      tbody.appendChild(shapeRow);
    }
    
    // Mettre à jour le total des surfaces
    this._updateTotalRow();
  }

  /**
   * Crée une ligne de parcelle manuelle (ajoutée via marqueur)
   * @param {HTMLElement} tbody - Corps du tableau
   * @param {string} markerId - ID du marqueur
   * @param {number} markerNumber - Numéro du marqueur
   * @param {Object} cadastreData - Données cadastrales
   * @private
   */
  _createManualParcelleRow(tbody, markerId, markerNumber, cadastreData) {
    // Vérifier si la ligne existe déjà (pour éviter les doublons lors du rechargement)
    const existingRow = tbody.querySelector(`tr[data-marker-id="${markerId}"]`);
    if (existingRow) {
      return; // Ne pas créer de doublon
    }
    
    const markerRow = document.createElement("tr");
    markerRow.classList.add("parcelle-detail-row", "manual-parcelle-row");
    markerRow.setAttribute("data-marker-id", markerId);
    markerRow.style.cssText = `
      min-height: fit-content;
    `;

    let parcelleInfoText;
    if (cadastreData && cadastreData.numero) {
      const { numero, section, surface } = cadastreData;
      parcelleInfoText = `${section} ${numero} - ${surface.toFixed(0)} m²`;
    } else {
      parcelleInfoText = `(Parcelle non identifiée)`;
    }

    const zoneCell = document.createElement("td");
    zoneCell.textContent = `Autre parcelle n° ${markerNumber}`;
    zoneCell.style.cssText = `
      padding: 5px;
      text-align: center;
      border-bottom: 1px solid #ddd;
      border-right: 1px solid #ddd;
      font-weight: bold;
      background-color: transparent;
      width: 50%;
      font-size: 11px;
      color: #000;
    `;

    const parcelleCell = document.createElement("td");
    parcelleCell.textContent = parcelleInfoText;
    parcelleCell.style.cssText = `
      padding: 5px;
      border-bottom: 1px solid #ddd;
      text-align: center;
      width: 50%;
      font-size: 11px;
      background-color: transparent;
      color: #000;
    `;

    markerRow.appendChild(zoneCell);
    markerRow.appendChild(parcelleCell);
    
    // Insérer avant la ligne de total si elle existe
    const totalRow = tbody.querySelector(".total-row");
    if (totalRow) {
      tbody.insertBefore(markerRow, totalRow);
    } else {
      tbody.appendChild(markerRow);
    }
    
    // Mettre à jour le total des surfaces
    this._updateTotalRow();
  }

  /**
   * Met à jour l'état visuel du bouton d'ajout de parcelle
   * @param {boolean} isActive - Si le mode est actif
   * @private
   */
  _updateAddButtonState(isActive) {
    if (!this.addParcelleButton) {
      return;
    }
    
    if (isActive) {
      // Mode actif : bouton rouge avec croix
      this.addParcelleButton.textContent = "×";
      this.addParcelleButton.style.backgroundColor = "#f44336";
      this.addParcelleButton.style.color = "white";
      this.addParcelleButton.title = "Annuler (Échap)";
    } else {
      // Mode inactif : bouton vert avec plus
      this.addParcelleButton.textContent = "+";
      this.addParcelleButton.style.backgroundColor = "#4CAF50";
      this.addParcelleButton.style.color = "white";
      this.addParcelleButton.title = "Ajouter une parcelle manuellement";
    }
  }

  /**
   * Calcule et met à jour le total des surfaces des parcelles uniques
   * @private
   */
  _updateTotalRow() {
    const tbody = this.parcellesContainer.querySelector(".parcelles-tbody");
    if (!tbody) {
      return;
    }

    const totalCell = tbody.querySelector(".total-surface-cell");
    if (!totalCell) {
      return;
    }

    // Map pour stocker les surfaces des parcelles uniques (clé: section+numero)
    const uniqueParcelles = new Map();
    
    try {
      // Récupérer les données depuis le localStorage pour les shapes
      const savedData = JSON.parse(localStorage.getItem("solarProjectData")) || {};
      const shapes = savedData.shapes || {};
      
      // Traiter les shapes (parcelles liées aux zones)
      Object.values(shapes).forEach(shapeData => {
        if (shapeData.parcelleData && shapeData.parcelleData.numero) {
          const { numero, section, surface } = shapeData.parcelleData;
          const parcelleKey = `${section}_${numero}`;

          // Ne garder que la première occurrence de chaque parcelle unique
          if (!uniqueParcelles.has(parcelleKey)) {
            uniqueParcelles.set(parcelleKey, surface);
          }
        }
      });

      // NOUVEAU (extension au calepinage maison résidentielle) : même traitement que les shapes
      // ci-dessus, pour les parcelles de maisons (savedData.maisonParcelles, cf. écouteur
      // CADASTRAL_DATA_LOADED) — sans cela, le total omettait les surfaces des maisons.
      const maisonParcelles = savedData.maisonParcelles || {};
      Object.values(maisonParcelles).forEach(entry => {
        const parcelleData = entry && entry.parcelleData;
        if (parcelleData && parcelleData.numero) {
          const { numero, section, surface } = parcelleData;
          const parcelleKey = `${section}_${numero}`;
          if (!uniqueParcelles.has(parcelleKey)) {
            uniqueParcelles.set(parcelleKey, surface);
          }
        }
      });

      // Traiter les parcelles manuelles (marqueurs) depuis les lignes du tableau
      const manualRows = tbody.querySelectorAll("tr.manual-parcelle-row");
      manualRows.forEach(row => {
        const parcelleCell = row.cells[1];
        if (!parcelleCell) {
          return;
        }
        
        const parcelleText = parcelleCell.textContent.trim();
        
        // Extraire les informations de la parcelle depuis le texte
        // Format attendu: "SECTION NUMERO - SURFACE m²" ou "(Parcelle non identifiée)"
        // Gérer les espaces optionnels au début
        const match = parcelleText.match(/^\s*([A-Z0-9]+)\s+([0-9]+)\s+-\s+([0-9.]+)\s+m²$/);
        
        if (match) {
          const section = match[1];
          const numero = match[2];
          const surface = parseFloat(match[3]);
          const parcelleKey = `${section}_${numero}`;
          
          // Ne garder que la première occurrence de chaque parcelle unique
          if (!uniqueParcelles.has(parcelleKey)) {
            uniqueParcelles.set(parcelleKey, surface);
          }
        }
      });
    } catch (error) {
      console.error("Erreur lors du calcul du total des surfaces:", error);
    }

    // Calculer le total
    let totalSurface = 0;
    uniqueParcelles.forEach(surface => {
      totalSurface += surface;
    });

    // Mettre à jour l'affichage
    totalCell.textContent = `${totalSurface.toFixed(0)} m²`;
  }

  /**
   * Vérifie la conformité des données climatiques par rapport aux limites du SI (France Uniquement)
   */
  _checkClimaticCompliance(savedData) {
    try {
      const pays = savedData.projectInfo?.pays;
      // La vérification ne s'applique qu'à la France selon la demande
      if (pays && pays.toLowerCase() !== 'france') return;

      const meteo = savedData.climateZones || {};

      const zVentUser = meteo.vent;
      const zNeigeUser = meteo.neige;
      const altitude = savedData.projectInfo?.altitude;

      let hasError = false;
      let errorMessages = new Set();

      if (savedData.formData && savedData.shapes) {
        Object.entries(savedData.shapes).forEach(([pvId, shapeData]) => {
          const formData = savedData.formData[pvId];
          if (!formData || !formData.typeDeStructure || !formData.referenceSI) return;

          const systemsList = TYPE_COUVERTURE_MAP[formData.typeDeStructure] || [];
          const siData = systemsList.find(s => s.id === formData.referenceSI);
          if (!siData) return;

          let failReasons = [];
          
          // Vérifier si des paramètres sont manquants (soit côté projet, soit côté SI)
          const isVentMissing = !zVentUser || zVentUser === 'N/A' || zVentUser === '' || !siData['Z-vent'] || siData['Z-vent'] === 'NA' || siData['Z-vent'] === '';
          const isNeigeMissing = !zNeigeUser || zNeigeUser === 'N/A' || zNeigeUser === '' || !siData['Z-Neige'] || siData['Z-Neige'] === 'NA' || siData['Z-Neige'] === '';
          const isAltMissing = altitude === undefined || altitude === null || altitude === '' || isNaN(parseFloat(altitude)) || !siData.Altitude || siData.Altitude === 'NA' || siData.Altitude === '';

          // Validation Vent
          if (!isVentMissing) {
            const zVentCode = zVentUser.startsWith('V') ? zVentUser : 'V' + zVentUser;
            if (!siData['Z-vent'].includes(zVentCode) && !siData['Z-vent'].includes(zVentUser)) {
              failReasons.push(`Vent (Zone ${zVentUser} non supportée)`);
            }
          }

          // Validation Neige
          if (!isNeigeMissing) {
            if (!siData['Z-Neige'].includes(zNeigeUser)) {
              failReasons.push(`Neige (Zone ${zNeigeUser} non supportée)`);
            }
          }

          // Validation Altitude
          if (!isAltMissing) {
            const maxAlt = parseFloat(siData.Altitude);
            const currentAlt = parseFloat(altitude);
            if (!isNaN(maxAlt) && currentAlt > maxAlt) {
              failReasons.push(`Altitude (${currentAlt.toFixed(0)}m dépasse le max autorisé de ${maxAlt}m)`);
            }
          }

          if (failReasons.length > 0) {
            hasError = true;
            errorMessages.add(`Champ ${pvId} - Système ${siData.label} non conforme : ${failReasons.join(', ')}.`);
          }
        });
      }

      if (hasError && this.errorModal && (!this._lastClimateErrorTime || (Date.now() - this._lastClimateErrorTime > 10000))) {
        let finalMsg = "";
        if (hasError) {
          finalMsg += "❌ NON-CONFORMITÉ CLIMATIQUE DÉTECTÉE :\nLe système d'intégration choisi ne supporte pas les conditions climatiques de ce projet.\n" + Array.from(errorMessages).join('\n') + "\n\n";
        }
        
        this.errorModal.show(finalMsg.trim());
        this._lastClimateErrorTime = Date.now();
      }
    } catch (e) {
      console.error("Erreur lors de la vérification de la conformité climatique:", e);
    }
  }

  /**
   * Met à jour l'icône du bouton de visibilité
   * @param {boolean} isVisible - Si les marqueurs sont visibles
   * @private
   */
  _updateVisibilityButtonIcon(isVisible) {
    if (!this.toggleVisibilityButton) {
      return;
    }
    
    if (isVisible) {
      // Œil ouvert (marqueurs visibles)
      this.toggleVisibilityButton.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 5C7 5 2.73 8.11 1 12.5C2.73 16.89 7 20 12 20C17 20 21.27 16.89 23 12.5C21.27 8.11 17 5 12 5Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="12.5" r="3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      this.toggleVisibilityButton.style.backgroundColor = "#2196F3";
      this.toggleVisibilityButton.title = "Masquer les marqueurs de parcelles";
    } else {
      // Œil barré (marqueurs cachés)
      this.toggleVisibilityButton.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 5C7 5 2.73 8.11 1 12.5C2.73 16.89 7 20 12 20C17 20 21.27 16.89 23 12.5C21.27 8.11 17 5 12 5Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="12.5" r="3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="2" y1="2" x2="22" y2="22" stroke="white" stroke-width="2" stroke-linecap="round"/>
        </svg>
      `;
      this.toggleVisibilityButton.style.backgroundColor = "#757575";
      this.toggleVisibilityButton.title = "Afficher les marqueurs de parcelles";
    }
  }
  
  // Méthode pour obtenir le conteneur DOM (utilisé par ToolBar)
  getDOMElement() {
    return this.parcellesContainer;
  }
}

export default ResumeParcellesControl;