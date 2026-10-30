import * as CalculationUtils from "../../DrawingControl/utils/CalculationUtils.js";
import { CUSTOM_EVENTS, TYPE_COUVERTURE_MAP } from "../../DrawingControl/constants.js";

class ResumeCalepinageControl {
  constructor(options) {
    this.errorModal = options.errorModal;
    this.résuméContainer = this.createResuméContainer();

    // CORRECTION: Ajouter un système de debouncing
    this.updateTimeout = null;
    this.isUpdating = false;

    this._addEventListeners();
  }

  _addEventListeners() {
    // CORRECTION: Utiliser un seul handler avec debouncing pour tous les événements
    const debouncedUpdate = (eventType, eventDetail) => {
      // Annuler les mises à jour précédentes en attente
      if (this.updateTimeout) {
        clearTimeout(this.updateTimeout);
      }

      // Programmer une nouvelle mise à jour avec délai
      this.updateTimeout = setTimeout(async () => {
        if (this.isUpdating) {
          return;
        }

        this.isUpdating = true;

        try {
          // Forcer une sauvegarde avant la mise à jour
          if (window.storageManager) {
            await window.storageManager.savePageData();
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          await this.updateRésuméContainer();
        } finally {
          this.isUpdating = false;
        }
      }, 300); // Délai de debounce de 300ms
    };

    // Tous les événements utilisent le même handler avec debouncing
    document.addEventListener(CUSTOM_EVENTS.SHAPE_ADDED, (event) => {
      debouncedUpdate("SHAPE_ADDED", event.detail);
    });

    document.addEventListener(
      CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER,
      (event) => {
        debouncedUpdate("UPDATE_RESUME_CONTAINER", event.detail);
      }
    );

    document.addEventListener(CUSTOM_EVENTS.SHAPE_REMOVED, (event) => {
      debouncedUpdate("SHAPE_REMOVED", event.detail);
    });

    document.addEventListener(
      CUSTOM_EVENTS.SOLAR_DATA_BATCH_UPDATED,
      (event) => {
        this.updateRésuméContainer();
      }
    );
    document.addEventListener(CUSTOM_EVENTS.SIMPLE_POLYGON_ADDED, (event) => {
      debouncedUpdate("SIMPLE_POLYGON_ADDED", event.detail);
    });
    document.addEventListener(CUSTOM_EVENTS.SIMPLE_POLYGON_REMOVED, (event) => {
      debouncedUpdate("SIMPLE_POLYGON_REMOVED", event.detail);
    });

    // CYCLE DE VIE : Forcer la mise à jour quand le SummaryModal est mis à jour
    document.addEventListener("solarProjectDataSaved", (event) => {
      debouncedUpdate("SOLAR_PROJECT_DATA_SAVED", event ? event.detail : null);
    });

    // Calepinage résidentiel : ses champs PV n'émettent aucun des événements ci-dessus (module
    // indépendant, cf. _totauxCalepinageMaison) — sans ces 3 écouteurs, le résumé ne se
    // rafraîchirait qu'au prochain événement PRO, donc jamais dans un projet 100 % résidentiel.
    ["calepinageMaisonFieldChanged", "maisonShapeAdded", "maisonShapesRenumbered"].forEach((nom) => {
      document.addEventListener(nom, (event) => {
        debouncedUpdate(nom, event ? event.detail : null);
      });
    });
  }

  createResuméContainer() {
    const résuméContainer = document.createElement("div");
    résuméContainer.classList.add("résumé-container");
    // CORRECTIF (demande explicite : "assurez-vous que le petit modal qui affiche le résumé du
    // calepinage soit alimenté pour toute typologie de projet") : ce résumé était masqué en projet
    // "Résidentielle" (via .residential-hide-section / ButtonControl.applyResidentialUIFiltering)
    // ET ne lisait que solarProjectData.shapes, où le calepinage résidentiel n'écrit jamais — d'où
    // un tableau vide. Il est désormais visible partout et alimenté par les deux sources
    // (cf. updateRésuméContainer / _totauxCalepinageMaison).
    résuméContainer.style.cssText = `
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
      cursor:default;
    `;

    const table = document.createElement("table");
    table.style.cssText = `
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      background-color: hsla(0, 0%, 100%, 0.7);
      cursor : default;
    `;

    const headers = [
      "Résumé du calepinage",
      "Nbre_PV (Qté)",
      "Pce_PV (kWc)",
      "Prod_PV (kWh/kWc)",
      "Stot_PV (m²)",
      "RC",
    ];

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headers.forEach((header) => {
      const th = document.createElement("th");
      th.setAttribute("data-header", header);
      th.textContent = header;
      th.style.cssText = `
        padding: 2px;
        text-align: center;
        border-bottom: 2px solid #ddd;
        font-weight: bold;
        border-right: 1px solid #ddd;
      `;
      if (header === "RC") {
        th.style.padding = "5px";
      }
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    tbody.style.cssText = `
      min-height: fit-content;
    `;
    const tbodyRow = document.createElement("tr");
    tbodyRow.style.cssText = `
      min-height: fit-content;
    `;

    for (let i = 0; i < headers.length; i++) {
      const td = document.createElement("td");
      td.style.cssText = `
        padding: 0px;
        border-right: 1px solid #ddd;
        text-align: center;
        height: 30px;
      `;

      if (headers[i] === "RC") {
        td.style.cursor = "pointer";
        td.title = "Cliquer pour modifier la surface";
        td.classList.add("rc-cell");
        td.addEventListener("click", () => this._handleRCClick());
      } else if (headers[i] === "Résumé du calepinage") {
        td.textContent = "Total";
      } else {
        td.textContent = "0";
      }
      tbodyRow.appendChild(td);
    }

    tbody.appendChild(tbodyRow);
    table.appendChild(tbody);
    résuméContainer.appendChild(table);
    return résuméContainer;
  }

  async updateRésuméContainer() {
    try {
      const savedData =
        JSON.parse(localStorage.getItem("solarProjectData")) || {};

      // Champs PV du calepinage résidentiel (module "toiture multi-typologie") : ils n'écrivent
      // jamais dans solarProjectData.shapes, ils sont donc agrégés à part et additionnés plus bas
      // aux champs PRO/Grand projet — un projet peut légitimement contenir les deux.
      const maison = this._totauxCalepinageMaison();

      // Si `formData` est vide ou non défini ET qu'aucun champ résidentiel n'existe : remise à zéro.
      if ((!savedData.formData || Object.keys(savedData.formData).length === 0)
        && maison.nbPanneaux === 0) {
        const tbody = this.résuméContainer.querySelector("tbody");
        if (tbody) {
          const cells = tbody.querySelector("tr").getElementsByTagName("td");
          cells[0].textContent = "Total";
          cells[1].textContent = "0";
          cells[2].textContent = "0.00";
          cells[3].textContent = "0.00";
          cells[4].textContent = "0.00";
          cells[5].textContent = "0.00";
        }
        return;
      }
  
      let totalPanelCount = 0;
      let totalPcePV = 0;
      let totalProductionKwhKwc = [];
      let totalStotalPV = 0;
      let totalPanelArea = 0;
      let totalRC = 0;
      let totalSurfaceProjetée = 0;
  
      // Utilisation des mêmes calculs que le SummaryModal pour une précision et fiabilité optimales
      if (savedData.shapes) {
        Object.entries(savedData.shapes).forEach(([pvId, shapeData]) => {
          if (
            shapeData.gridInfo &&
            savedData.formData &&
            savedData.formData[pvId]
          ) {
            const formValues = savedData.formData[pvId];
            const puissancePanneau = Number(formValues.puissancePanneau) || 0;
            const inclinaison = Number(formValues.inclinaison) || 0;
            
            let panelCount = 0;
            // Validation stricte : ne calculer que si la puissance est définie et valide
            if (puissancePanneau > 0) {
                if (typeof CalculationUtils.getAccuratePanelCount === 'function') {
                    panelCount = CalculationUtils.getAccuratePanelCount(pvId, savedData);
                } else {
                    panelCount = Number(shapeData.gridInfo?.panelCount || 0);
                }
            }
            
            // Sécurité anti-valeurs aberrantes
            if (isNaN(panelCount) || !isFinite(panelCount) || panelCount > 100000) {
                panelCount = 0;
            }

            const puissancePV = CalculationUtils.calculatePuissancePVKwc(
              panelCount,
              puissancePanneau
            );
            totalPcePV += puissancePV || 0;
  
            if (
              savedData.solarData && savedData.solarData[pvId] &&
              savedData.solarData[pvId].annuel
            ) {
              const productionTotale = Number(
                savedData.solarData[pvId].annuel.productionTotale
              );
              
              if (puissancePV > 0 && !isNaN(productionTotale)) {
                const productibleMwh = CalculationUtils.convertKWhToMWh(productionTotale) / 1000;
                const productibleKwhPv = CalculationUtils.calculateProductibleKwhKwc(productibleMwh, puissancePV);
                if (!isNaN(productibleKwhPv) && isFinite(productibleKwhPv)) {
                    totalProductionKwhKwc.push(productibleKwhPv);
                }
              }
            }
  
            totalPanelCount += panelCount;

            // Recalcul des surfaces pour correspondre exactement au SummaryModal
            const totalPanelLength = Number(shapeData.gridInfo.totalPanelLength || 0);
            const totalPanelWidth = Number(shapeData.gridInfo.totalPanelWidth || 0);
            const typeDeStructure = formValues.typeDeStructure || formValues.type_de_structure || formValues.typeCouverture;
            
            const finalDims = CalculationUtils.calculateFinalDimensionsWithMargin(
                totalPanelLength,
                totalPanelWidth,
                typeDeStructure,
                formValues.referenceSI,
                TYPE_COUVERTURE_MAP
            );
            
            const longueur = finalDims?.longueur || 0;
            const largeur = finalDims?.largeur || 0;

            const computedTotalPanelArea = (!isNaN(longueur) && !isNaN(largeur)) ? (longueur * largeur) : 0;

            let surfaceProjeteeCalc = 0;
            if (computedTotalPanelArea > 0) {
                if (typeof CalculationUtils.calculateSurfaceProjetée === 'function') {
                    surfaceProjeteeCalc = CalculationUtils.calculateSurfaceProjetée(computedTotalPanelArea, inclinaison);
                } else {
                    surfaceProjeteeCalc = Number(shapeData.gridInfo?.surfaceProjetee || 0);
                }
            }
            
            if (isNaN(surfaceProjeteeCalc) || !isFinite(surfaceProjeteeCalc)) {
                surfaceProjeteeCalc = 0;
            }

            totalStotalPV += computedTotalPanelArea;
            totalPanelArea += computedTotalPanelArea;
            totalSurfaceProjetée += surfaceProjeteeCalc;
          }
        });
      }

      // Champs PV résidentiels : mêmes colonnes, additionnées aux champs PRO ci-dessus.
      totalPanelCount += maison.nbPanneaux;
      totalPcePV += maison.puissanceKwc;
      totalStotalPV += maison.surfacePanneauxM2;
      totalPanelArea += maison.surfacePanneauxM2;
      totalSurfaceProjetée += maison.surfaceProjeteeM2;
      maison.productibles.forEach((p) => totalProductionKwhKwc.push(p));

      // Validation à Zéro : Nettoyage strict si aucun panneau n'est calculé
      if (totalPanelCount === 0) {
        totalPcePV = 0;
        totalProductionKwhKwc = [];
        totalStotalPV = 0;
        totalPanelArea = 0;
        totalSurfaceProjetée = 0;
      }
  
      let surfaceDernierPolygone = 0;
      if (
        savedData.simplePolygons &&
        Object.keys(savedData.simplePolygons).length > 0
      ) {
        const polygonIds = Object.keys(savedData.simplePolygons).sort((a, b) => {
          const numA = parseInt(a.split("-")[1], 10);
          const numB = parseInt(b.split("-")[1], 10);
          return numA - numB;
        });
        const dernierPolygonId = polygonIds[polygonIds.length - 1];
  
        if (
          savedData.simplePolygons[dernierPolygonId] &&
          typeof savedData.simplePolygons[dernierPolygonId].area === "number"
        ) {
          surfaceDernierPolygone =
            savedData.simplePolygons[dernierPolygonId].area;
        }
      }
  
      if (surfaceDernierPolygone > 0) {
        totalRC = CalculationUtils.calculateRC(
          totalSurfaceProjetée,
          surfaceDernierPolygone
        );
      } else if (totalPanelArea > 0) {
        totalRC = CalculationUtils.calculateRC(
          totalSurfaceProjetée,
          totalPanelArea
        );
      }
      
      if (isNaN(totalRC) || !isFinite(totalRC)) {
          totalRC = 0;
      }
  
      localStorage.setItem(
        "totalSurfaceProjetee",
        parseFloat(totalSurfaceProjetée)
      );
  
      const tbody = this.résuméContainer.querySelector("tbody");
      if (!tbody) {
        console.warn(
          "📊 RESUME DEBUG: Le conteneur du tableau de résumé n'existe pas encore."
        );
        return;
      }
  
      const cells = tbody.querySelector("tr").getElementsByTagName("td");

      // Contrôle de conformité puissance de licence (+ tolérance configurable)
      const compliance = (typeof window.checkPowerLicenceCompliance === 'function')
        ? window.checkPowerLicenceCompliance(totalPcePV)
        : { allowed: true };

      if (!compliance.allowed) {
        console.warn(`[Licence Control] Dépassement détecté : ${totalPcePV.toFixed(2)} kWc > ${compliance.max_allowed_kwc} kWc`);
        if (typeof window.setCalculerVisualiserDisabled === 'function') {
          window.setCalculerVisualiserDisabled(true, compliance.message);
        }
        cells[0].textContent = "Dépassement";
        cells[1].textContent = "0";
        cells[2].textContent = "0.00";
        cells[3].textContent = "0.00";
        cells[4].textContent = "0.00";
        cells[5].textContent = "0.00";
        return;
      } else {
        if (typeof window.setCalculerVisualiserDisabled === 'function') {
          window.setCalculerVisualiserDisabled(false);
        }
      }

      cells[0].textContent = "Total";
      cells[1].textContent = totalPanelCount;
      cells[2].textContent = totalPcePV.toFixed(2);
  
      // Éviter la division par zéro si `totalProductionKwhKwc` est vide
      let averageProduction =
        totalProductionKwhKwc.length > 0
          ? (totalProductionKwhKwc.reduce((prev, acc) => prev + acc, 0) /
              totalProductionKwhKwc.length)
          : 0;
      if (isNaN(averageProduction) || !isFinite(averageProduction)) {
          averageProduction = 0;
      }
      cells[3].textContent = averageProduction.toFixed(2);
  
      cells[4].textContent = totalStotalPV.toFixed(2);
      cells[5].textContent = totalRC.toFixed(2);
    } catch (error) {
      if (this.errorModal) {
        this.errorModal.show(
          "Erreur lors de la mise à jour du résumé du calepinage."
        );
      }
    }
  }

  /**
   * Totaux des champs PV du calepinage résidentiel (window.CalepinageMaisonIndiv), au format des
   * colonnes de ce résumé. Renvoie des zéros si le module n'est pas chargé ou si aucun champ n'est
   * dessiné — jamais d'exception : ce résumé ne doit pas casser la barre d'outils.
   *
   * La colonne "Prod_PV (kWh/kWc)" vient de `solarProjectData.solarDataMaison`, écrit par
   * SummaryModal.chargerProductionChampsMaison() (interrogation PVGIS par sous-champ). Elle reste
   * donc à 0 tant que le résumé "Système" n'a pas été ouvert une première fois pour ce projet :
   * c'est lui qui déclenche l'appel, ce résumé-ci ne fait jamais d'appel réseau.
   */
  _totauxCalepinageMaison() {
    const vide = {
      nbPanneaux: 0, puissanceKwc: 0, surfacePanneauxM2: 0, surfaceProjeteeM2: 0, productibles: [],
    };
    try {
      const CM = window.CalepinageMaisonIndiv;
      if (!CM || typeof CM.getAllPvFieldSummaries !== "function") return vide;

      let productionParSousChamp = {};
      try {
        productionParSousChamp =
          (JSON.parse(localStorage.getItem("solarProjectData")) || {}).solarDataMaison || {};
      } catch (e) {
        productionParSousChamp = {};
      }

      return CM.getAllPvFieldSummaries().reduce((acc, p) => {
        const puissance = Number(p.peakPower) || 0;
        const prodKwh = Number(
          productionParSousChamp[p.id] &&
          productionParSousChamp[p.id].annuel &&
          productionParSousChamp[p.id].annuel.productionTotale
        ) || 0;
        if (puissance > 0 && prodKwh > 0) {
          const productibleMwh = CalculationUtils.convertKWhToMWh(prodKwh) / 1000;
          const productible = CalculationUtils.calculateProductibleKwhKwc(productibleMwh, puissance);
          if (!isNaN(productible) && isFinite(productible)) acc.productibles.push(productible);
        }
        acc.nbPanneaux += Number(p.panelCount) || 0;
        acc.puissanceKwc += puissance;
        acc.surfacePanneauxM2 += Number(p.surfacePanneauxM2) || 0;
        acc.surfaceProjeteeM2 += Number(p.surfaceProjeteeM2) || 0;
        return acc;
      }, vide);
    } catch (e) {
      return vide;
    }
  }

  _handleRCClick() {
    const surfaceStr = prompt(
      "Veuillez entrer la surface totale du terrain (parcelle) en m² pour le calcul du RC:"
    );
    if (surfaceStr === null) {
      return;
    }
    const newSurfaceValue = parseFloat(surfaceStr);

    if (
      surfaceStr.trim() !== "" &&
      !isNaN(newSurfaceValue) &&
      newSurfaceValue > 0
    ) {
      localStorage.setItem("surfaceParcellePourRC", newSurfaceValue); // Stocker pour réutilisation

      const totalSurfaceProjetee =
        Number(JSON.parse(localStorage.getItem("totalSurfaceProjetee"))) || 0;

      let rc = CalculationUtils.calculateRC(
        Number(totalSurfaceProjetee),
        Number(newSurfaceValue)
      );
      if (isNaN(rc) || !isFinite(rc)) rc = 0;
      
      // Empecher le RC de dépasser 1
      if (rc > 1) {
        rc = 1;
      }
      const rcValueCell = this.résuméContainer.querySelector(".rc-cell");
      if (rcValueCell) {
        rcValueCell.textContent = rc.toFixed(2);
      }
      // Déclencher une mise à jour pour recalculer avec la nouvelle surface
      //  this.updateRésuméContainer();
    } else {
      alert(
        "Veuillez entrer une valeur numérique valide et positive pour la surface."
      );
    }
  }

  // Méthode pour obtenir le conteneur DOM (utilisé par ToolBar)
  getDOMElement() {
    return this.résuméContainer;
  }
}

export default ResumeCalepinageControl;