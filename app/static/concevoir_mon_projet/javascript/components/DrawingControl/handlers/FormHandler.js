import { DRAWING_CONSTANTS, PANEL_DIMENSIONS, CUSTOM_EVENTS, SHAPE_TYPES, TYPE_COUVERTURE_MAP } from '../constants.js';
import GeometryUtils from '../utils/GeometryUtils.js';
import * as CalculationUtils from '../utils/CalculationUtils.js';
/**
 * Gestion des interactions avec le formulaire
 */
export default class FormHandler {
  /**
   * Configure les écouteurs d'événements pour le formulaire et update le nombre de panneaux
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {google.maps.Polygon} shape - Forme associée au formulaire
   */

  static setupFormListeners(drawingControl, shape) {
    if (!shape.pvId) return;

    // CORRECTION: Attendre que le formulaire soit prêt dans le DOM
    // Fallback à 'longueur' permet de valider la présence de l'onglet principal (ex: PV1)
    const formElement = document.querySelector(`#form-${shape.pvId}`) || document.getElementById('longueur');
    if (!formElement) {
      setTimeout(() => {
        FormHandler.setupFormListeners(drawingControl, shape);
      }, 300);
      return;
    }

    // Gestion du changement des dimensions de la forme/shape solar panel
    const longueurInput = document.querySelector(`#longueur-${shape.pvId}`) || document.getElementById('longueur');
    const largeurInput = document.querySelector(`#largeur-${shape.pvId}`) || document.getElementById('largeur');

    // Pour les polygones natifs, ces champs doivent être vides et en lecture seule
    if (shape.type === SHAPE_TYPES.POLYGON) {
      if (longueurInput) {
        longueurInput.value = '';
        longueurInput.readOnly = true;
      }
      if (largeurInput) {
        largeurInput.value = '';
        largeurInput.readOnly = true;
      }
    }
    const epaisseurPanneauInput = document.querySelector(`#epaisseurPanneau-${shape.pvId}`) || document.getElementById('epaisseurPanneau');
    const espacementPanneauxXInput = document.querySelector(`#espacementPanneauxX-${shape.pvId}`) || document.getElementById('espacementPanneauxX');
    const espacementPanneauxYInput = document.querySelector(`#espacementPanneauxY-${shape.pvId}`) || document.getElementById('espacementPanneauxY');
    const espacementBordsInput = document.querySelector(`#espacementBords-${shape.pvId}`) || document.getElementById('espacementBords');
    const dimensionsPanneauSelect = document.querySelector(`#dimensionsPanneaux-${shape.pvId}`) || document.getElementById('dimensionsPanneaux');
    const jointDilatationInput = document.querySelector(`#joint_dilatation-${shape.pvId}`) || document.getElementById('joint_dilatation');
    const limitDilatationInput = document.querySelector(`#limit_dilatation_m-${shape.pvId}`) || document.getElementById('limit_dilatation_m');
    const customDimensionsContainer = document.querySelector(`#customDimensionsContainer-${shape.pvId}`) || document.getElementById('customDimensionsContainer');
    const dimensionsChampPVlongueurInput = document.querySelector(`#dimensionsChampPVlongueur-${shape.pvId}`) || document.getElementById('dimensionsChampPVlongueur');
    const dimensionsChampPVlargeurInput = document.querySelector(`#dimensionsChampPVlargeur-${shape.pvId}`) || document.getElementById('dimensionsChampPVlargeur');
    const btnSwitchAzimuthInput = document.querySelector(`#btn-switch-azimuth-${shape.pvId}`) || document.getElementById('btn-switch-azimuth');
    const btnInvertFaitageInput = document.querySelector(`#btn-invert-faitage-${shape.pvId}`) || document.getElementById('btn-invert-faitage');
    const inclinaisonInput = document.querySelector(`#inclinaison-${shape.pvId}`) || document.getElementById('inclinaison');
    // Sheds UI
    const shedsContainer = document.querySelector(`#shedsContainer-${shape.pvId}`) || document.getElementById('shedsContainer');
    const shedsRowsInput = document.querySelector(`#shedsRows-${shape.pvId}`) || document.getElementById('shedsRows');
    const shedsRowSpacingInput = document.querySelector(`#shedsRowSpacing-${shape.pvId}`) || document.getElementById('shedsRowSpacing');
    const shedsColsInput = document.querySelector(`#shedsCols-${shape.pvId}`) || document.getElementById('shedsCols');
    const shedsColSpacingInput = document.querySelector(`#shedsColSpacing-${shape.pvId}`) || document.getElementById('shedsColSpacing');
    const shedRotationInput = document.querySelector(`#shedRotation-${shape.pvId}`) || document.getElementById('shedRotation');
    const penteShedInput = document.querySelector(`#pente_panneaux_shed-${shape.pvId}`) || document.getElementById('pente_panneaux_shed');
    const perteOmbrageShedInput = document.querySelector(`#perteOmbrageShed-${shape.pvId}`) || document.getElementById('perteOmbrageShed');
    const shedRowSelectorInput = document.querySelector(`#shedRowSelector-${shape.pvId}`) || document.getElementById('shedRowSelector');
    const shedGroupsInRowInput = document.querySelector(`#shedGroupsInRow-${shape.pvId}`) || document.getElementById('shedGroupsInRow');
    const shedsShowRowDetailsInput = document.querySelector(`#shedsShowRowDetails-${shape.pvId}`) || document.getElementById('shedsShowRowDetails');
    const shedsRegularInput = document.querySelector(`#shedsRegular-${shape.pvId}`) || document.getElementById('shedsRegular');
    const shedPenteRotationRow = document.querySelector(`#shedPenteRotationRow-${shape.pvId}`) || document.getElementById('shedPenteRotationRow');
    const shedsLongGroupRow = document.querySelector(`#shedsLongGroupRow-${shape.pvId}`) || document.getElementById('shedsLongGroupRow');
    const shedsActionsRow = document.querySelector(`#shedsActionsRow-${shape.pvId}`) || document.getElementById('shedsActionsRow');
    const shedsRegularRow = document.querySelector(`#shedsRegularRow-${shape.pvId}`) || document.getElementById('shedsRegularRow');
    const shedOptionToggleRow = document.querySelector(`#shedOptionToggleRow-${shape.pvId}`) || document.getElementById('shedOptionToggleRow');
    const shedOptionToggle = document.querySelector(`#shedOptionToggle-${shape.pvId}`) || document.getElementById('shedOptionToggle');
    let updateTimeout;

    // Update et debounce pour le calcul du nombre de panneaux
    const debouncedUpdate = () => {
      if (updateTimeout) clearTimeout(updateTimeout);

      updateTimeout = setTimeout(() => {
        // Récupérer les valeurs du formulaire
        const formLongueur = parseFloat(longueurInput.value) || 0;
        const formLargeur = parseFloat(largeurInput.value) || 0;

        // Pour LineToPolygon et SolarRectangle, longueur/largeur pilotent la mise à l'échelle. On
        // saute ce redimensionnement pendant une restauration depuis le stockage (StorageManager.
        // loadShapesFromStorage() pose drawingControl._isRestoringShapes = true) : la géométrie du
        // rectangle vient alors déjà, telle quelle, du tracé (points) sauvegardé — la ré-exécuter ici
        // via une valeur de champ restaurée (potentiellement celle d'une AUTRE forme si son onglet
        // partage les mêmes champs #longueur/#largeur non suffixés, cf. FormHandler.setupFormListeners)
        // provoquait un redimensionnement/déplacement intempestif du rectangle au rechargement de page.
        if (!drawingControl._isRestoringShapes &&
          (shape.type === SHAPE_TYPES.LINE_TO_POLYGON || shape.type === SHAPE_TYPES.SOLAR_RECTANGLE)) {
          const dimensions = { length: formLongueur, width: formLargeur };
          if (dimensions.length >= DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION &&
            dimensions.width >= DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION) {
            drawingControl.updateShapeDimensions(shape.pvId, dimensions);
          }
        }


        // Mettre à jour les informations de grille si les inputs existent
        // if (espacementPanneauxXInput && espacementPanneauxYInput && dimensionsChampPVlongueurInput && dimensionsChampPVlargeurInput) {
        //  const numberOfPanels = GeometryUtils.calculateNumberOfPanels(shape, drawingControl.panelOrientation);
        //  FormHandler.updateFormGridInputs(shape.pvId, numberOfPanels.numCols, numberOfPanels.numRows, numberOfPanels.totalPanelLength, numberOfPanels.totalPanelWidth);
        // }


        // Rafraîchir les panneaux solaires après toute modification
        if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && drawingControl.lineToPolygon) {
          drawingControl.lineToPolygon.refreshPanelsForShape(shape.pvId);
        } else if (shape.type === SHAPE_TYPES.POLYGON && drawingControl.polygonPanels) {
          // BUG 2 : Forcer la génération strictement après validation du formulaire
          if (typeof drawingControl.polygonPanels.forceUpdatePanels === 'function') {
            drawingControl.polygonPanels.forceUpdatePanels(shape.pvId);
          } else if (typeof drawingControl.polygonPanels.createPanels === 'function' && (!drawingControl.polygonPanels.createdPanelsByShape.has(shape.pvId) || drawingControl.polygonPanels.createdPanelsByShape.get(shape.pvId).length === 0)) {
            drawingControl.polygonPanels.createPanels(shape);
          } else {
            drawingControl.polygonPanels.updatePanelsPosition(shape);
          }
        } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && drawingControl.solarRectangle) {
          // CORRECTIF : refreshPanelsForShape() n'existe pas sur SolarRectangle — cet appel levait
          // systématiquement une TypeError à chaque modification de formulaire pour ce type de forme
          // (dimensions, mode de pose, espacement...), empêchant la régénération des panneaux.
          // createSolarPanels() est la méthode réellement exposée par cette classe.
          drawingControl.solarRectangle.createSolarPanels(shape);
        }

        updatePanels() // Pour la mise à jour des panneaux après la la modification des dimensions du rectangle dans le formulaire

      }, 300); // Délai de 300ms pour éviter trop d'appels
    };

    // Fonction spécifique pour les changements de panneaux (sans délai)
    const updatePanels = () => {
      // Calculer les dimensions du rectangle principal
      const path = shape.getPath();
      const corner1 = path.getAt(0);
      const corner2 = path.getAt(1);
      const corner3 = path.getAt(2);

      const lengthIndices = shape._lengthIndices || [0, 2];
      let mainLength, mainWidth;

      if (lengthIndices.includes(0) && lengthIndices.includes(2)) {
        mainLength = google.maps.geometry.spherical.computeDistanceBetween(corner1, corner2);
        mainWidth = google.maps.geometry.spherical.computeDistanceBetween(corner2, corner3);
      } else {
        mainLength = google.maps.geometry.spherical.computeDistanceBetween(corner2, corner3);
        mainWidth = google.maps.geometry.spherical.computeDistanceBetween(corner1, corner2);
      }

      // Récupérer l'orientation
      const portraitInput = document.querySelector(`#modePosePortrait-${shape.pvId}`) || document.getElementById('modePosePortrait');
      const paysageInput = document.querySelector(`#modePosePaysage-${shape.pvId}`) || document.getElementById('modePosePaysage');
      let isPortrait = portraitInput ? portraitInput.checked : false;
      let isPaysage = paysageInput ? paysageInput.checked : false;

      const typeCouvertureEl = document.querySelector(`#type_de_structure-${shape.pvId}`) || document.querySelector(`select[id^="type_de_structure"]`);
      const typeCouverture = typeCouvertureEl ? typeCouvertureEl.value : null;

      const supportShedInputUI = document.querySelector(`#supportShed-${shape.pvId}`) || document.getElementById('supportShed');
      const isShedUI = supportShedInputUI ? supportShedInputUI.checked : shape.shedsCapable;
      // Exception "Autres" : le système d'intégration ne fixe aucune pose imposée, l'utilisateur choisit
      // librement Portrait/Paysage (cf. refSIEl plus bas dans setupFormListeners).
      const refSIElUI = document.querySelector(`#referenceSI-${shape.pvId}`) || document.querySelector(`select[id^="referenceSI"]`);
      const isAutresUI = refSIElUI ? refSIElUI.value === 'Autres' : false;

      if (isShedUI && !isAutresUI) {
        isPortrait = true;
        isPaysage = false;
        if (portraitInput && !portraitInput.checked) {
          portraitInput.checked = true;
          FormHandler.updateModePoseUI(shape.pvId, 'portrait');
        }
        if (paysageInput) paysageInput.checked = false;
      }

      // Récupérer les valeurs des panneaux
      const longueurPanneauVal = longueurPanneauInput ? parseFloat(longueurPanneauInput.value) / 1000 : 0;
      const largeurPanneauVal = largeurPanneauInput ? parseFloat(largeurPanneauInput.value) / 1000 : 0;
      let spacingXVal = espacementPanneauxXInput ? parseFloat(espacementPanneauxXInput.value) / 1000 : 0.02; // 20mm par défaut
      let spacingYVal = espacementPanneauxYInput ? parseFloat(espacementPanneauxYInput.value) / 1000 : 0.02; // 20mm par défaut

      // RÈGLE 1 : Bloquer l'affichage des panneaux si "mode de pose" ou "panneau" non sélectionné pour les POLYGONES
      if (shape.type === SHAPE_TYPES.POLYGON) {
        const hasModePose = isPortrait || isPaysage;
        const hasPanelSelected = longueurPanneauVal > 0 && largeurPanneauVal > 0;
        if (!hasModePose || !hasPanelSelected) {
          if (nbColonne) nbColonne.value = 0;
          if (nbLigne) nbLigne.value = 0;
          if (dimLongueur) { dimLongueur.dataset.baseValue = "0.00"; dimLongueur.value = "0.00"; }
          if (dimLargeur) { dimLargeur.dataset.baseValue = "0.00"; dimLargeur.value = "0.00"; }

          if (drawingControl.polygonPanels && typeof drawingControl.polygonPanels.cleanupPanelsForShape === 'function') {
            drawingControl.polygonPanels.cleanupPanelsForShape(shape.pvId);
          } else if (drawingControl.polygonPanels && typeof drawingControl.polygonPanels.clearPanels === 'function') {
            drawingControl.polygonPanels.clearPanels(shape.pvId);
          }

          document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER, {
            detail: { pvId: shape.pvId }
          }));
          return;
        }
      }

      const jVal = jointDilatationInput ? parseFloat(jointDilatationInput.value) : NaN;
      const jointDilatationVal = !isNaN(jVal) ? jVal / 1000 : 0;
      const lVal = limitDilatationInput ? parseFloat(limitDilatationInput.value) : NaN;
      const limitDilatationVal = !isNaN(lVal) ? lVal : 0;

      const espBordsInput = document.querySelector(`#espacementBords-${shape.pvId}`) || document.getElementById('espacementBords');
      const marginVal = espBordsInput ? parseFloat(espBordsInput.value) / 1000 : 0;

      // Ajuster les dimensions selon l'orientation
      let panelLength, panelWidth;
      if (isPortrait) {
        panelLength = largeurPanneauVal; // l_pv (Axe X)
        panelWidth = longueurPanneauVal; // L_pv (Axe Y)
      } else if (isPaysage) {
        panelLength = longueurPanneauVal;
        panelWidth = largeurPanneauVal;
      } else {
        panelLength = largeurPanneauVal || 1.0;
        panelWidth = longueurPanneauVal || 2.0;
      }

      // SYNCHRONISATION : Réinitialisation des variables transmises avant nouveau calcul
      const nbColonne = document.querySelector(`#nbColonne-${shape.pvId}`) || document.getElementById('nbColonne');
      const nbLigne = document.querySelector(`#nbLigne-${shape.pvId}`) || document.getElementById('nbLigne');
      const dimLongueur = document.querySelector(`#dimensionsChampPVlongueur-${shape.pvId}`) || document.getElementById('dimensionsChampPVlongueur');
      const dimLargeur = document.querySelector(`#dimensionsChampPVlargeur-${shape.pvId}`) || document.getElementById('dimensionsChampPVlargeur');
      if (nbColonne) nbColonne.value = 0;
      if (nbLigne) nbLigne.value = 0;
      if (dimLongueur) dimLongueur.value = 0;
      if (dimLargeur) dimLargeur.value = 0;

      const refSIEl = document.querySelector(`#referenceSI-${shape.pvId}`) || document.querySelector(`select[id^="referenceSI"]`);
      const referenceSI = refSIEl ? refSIEl.value : null;

      let dX = 0;
      let dY = 0;
      if (typeCouverture && referenceSI && TYPE_COUVERTURE_MAP && TYPE_COUVERTURE_MAP[typeCouverture]) {
        const siData = TYPE_COUVERTURE_MAP[typeCouverture].find(s => s.id === referenceSI);
        if (siData) {
          dX = parseFloat(siData.dX || 0) / 1000;
          dY = parseFloat(siData.dY || 0) / 1000;
          // Synchronisation dynamique : prioriser l'espacement SI
          if (siData.x !== undefined && !isNaN(parseFloat(siData.x))) spacingXVal = parseFloat(siData.x) / 1000;
          if (siData.y !== undefined && !isNaN(parseFloat(siData.y))) spacingYVal = parseFloat(siData.y) / 1000;
        }
      }

      const penteTypeSelect = document.querySelector(`#toiture_pente_type-${shape.pvId}`) || document.getElementById('toiture_pente_type');
      const penteType = penteTypeSelect ? penteTypeSelect.value : 'Monopente';
      const pente1Input = document.querySelector(`#pente-${shape.pvId}`) || document.getElementById('pente') || document.querySelector(`#inclinaison-${shape.pvId}`) || document.getElementById('inclinaison');
      let pente1 = pente1Input ? parseFloat(pente1Input.value) || 0 : 0;
      const pente2Input = document.querySelector(`#pente2-${shape.pvId}`) || document.getElementById('pente2');
      let pente2 = pente2Input ? parseFloat(pente2Input.value) || pente1 : pente1;

      const supportShedInput = document.querySelector(`#supportShed-${shape.pvId}`) || document.getElementById('supportShed');
      const isShed = supportShedInput ? supportShedInput.checked : shape.shedsCapable;
      const isFlatStructure = typeCouverture === 'Toiture terasse' || typeCouverture === 'Petit champ solaire';
      const isAutres = typeCouverture === 'Autres';
      const applyTiltProjection = isFlatStructure || (isShed && (isFlatStructure || isAutres));

      if (applyTiltProjection) {
        const tiltInput = document.querySelector(`#inclinaison-top-${shape.pvId}`) || document.getElementById('inclinaison-top') || document.querySelector(`#inclinaison-${shape.pvId}`) || document.getElementById('inclinaison');
        const panelTilt = tiltInput ? parseFloat(tiltInput.value) || 0 : 0;
        pente1 = panelTilt;
        pente2 = panelTilt;
      }

      const asymInput = document.querySelector(`#asymetrie_percent-${shape.pvId}`) || document.getElementById('asymetrie_percent');
      const asymetrie = asymInput ? parseFloat(asymInput.value) / 100 : 0.4;
      const faitageInput = document.querySelector(`#largeur_faitage_mm-${shape.pvId}`) || document.getElementById('largeur_faitage_mm');
      const fVal = faitageInput ? parseFloat(faitageInput.value) : NaN;
      const faitageMeters = !isNaN(fVal) ? fVal / 1000 : 0.5;

      const indicesInverted = !(lengthIndices.includes(0) && lengthIndices.includes(2));

      let effLen = panelLength;
      let effWid = panelWidth;
      let effSpaceX = spacingXVal;
      let effSpaceY = spacingYVal;

      if (indicesInverted && effLen > 0 && effWid > 0) {
        effLen = panelWidth;
        effWid = panelLength;
        effSpaceX = spacingYVal;
        effSpaceY = spacingXVal;
        let tempD = dX; dX = dY; dY = tempD;
      }

      const panelsRotation = shape.panelsRotation || 0;
      const angleRad = Math.abs(panelsRotation) * Math.PI / 180;
      const rotEffLen = Math.abs(effLen * Math.cos(angleRad)) + Math.abs(effWid * Math.sin(angleRad));
      const rotEffWid = Math.abs(effLen * Math.sin(angleRad)) + Math.abs(effWid * Math.cos(angleRad));

      const computeCount = (available, pSize, spacing, startMargin, endMargin, limitDil, jointDil) => {
        let usable = available - startMargin - endMargin;
        if (limitDil > 0) usable -= Math.floor(usable / limitDil) * jointDil;
        return Math.max(0, Math.floor((Math.max(0, usable) + spacing) / (pSize + spacing)));
      };

      const panelsAlongLength = computeCount(mainLength, rotEffLen, effSpaceX, marginVal + dX / 2, marginVal + dX / 2, limitDilatationVal, jointDilatationVal);

      let panelsAlongWidth = 0;
      let totalRealWidth = 0;
      const pans = [];
      if (penteType === 'Monopente') pans.push({ startFrac: 0, endFrac: 1, slope: pente1, startIsEave: true, endIsEave: true });
      else if (penteType === 'Bipente_symetrique') { pans.push({ startFrac: 0, endFrac: 0.5, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: 0.5, endFrac: 1, slope: pente1, startIsEave: false, endIsEave: true }); }
      else if (penteType === 'Bipente_asymetrique') { pans.push({ startFrac: 0, endFrac: asymetrie, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: asymetrie, endFrac: 1, slope: pente2, startIsEave: false, endIsEave: true }); }
      else if (penteType === 'Multipente') { pans.push({ startFrac: 0, endFrac: 0.25, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: 0.25, endFrac: 0.5, slope: pente1, startIsEave: false, endIsEave: false }); pans.push({ startFrac: 0.5, endFrac: 0.75, slope: pente1, startIsEave: false, endIsEave: false }); pans.push({ startFrac: 0.75, endFrac: 1, slope: pente1, startIsEave: false, endIsEave: true }); }

      const _perPanRowCounts = [];
      pans.forEach(pan => {
        const panProjectedWidth = mainWidth * (pan.endFrac - pan.startFrac);
        const cosSlope = Math.max(Math.cos(pan.slope * Math.PI / 180), 0.1);

        let panRealWidth;
        let currentEffWid;

        if (applyTiltProjection) { // Pente toiture = 0° ou Shed
          panRealWidth = panProjectedWidth;
          currentEffWid = rotEffWid * cosSlope; // Formule: Lpv * cos(alpha)
        } else { // Pente toiture > 0°
          panRealWidth = panProjectedWidth / cosSlope;
          currentEffWid = rotEffWid;
        }

        totalRealWidth += panRealWidth;
        const startMargin = pan.startIsEave ? (marginVal + dY / 2) : (faitageMeters / 2);
        const endMargin = pan.endIsEave ? (marginVal + dY / 2) : (faitageMeters / 2);
        const _panRowCount = computeCount(panRealWidth, currentEffWid, effSpaceY, startMargin, endMargin, limitDilatationVal, jointDilatationVal);
        panelsAlongWidth += _panRowCount;
        _perPanRowCounts.push(_panRowCount);
      });

      // Calcul exact et Garde-Fou (Source de vérité UI en temps réel)
      const Njx = limitDilatationVal > 0 ? Math.floor(mainLength / limitDilatationVal) : 0;
      const Njy = limitDilatationVal > 0 ? Math.floor(totalRealWidth / limitDilatationVal) : 0;

      const flatCosSlope = applyTiltProjection ? Math.max(Math.cos(pente1 * Math.PI / 180), 0.1) : 1;
      const effectiveEffWid = applyTiltProjection ? effWid * flatCosSlope : effWid;
      let rawDim1 = panelsAlongWidth > 0 ? (panelsAlongWidth * effectiveEffWid) + ((panelsAlongWidth - 1) * effSpaceY) + (Njy * jointDilatationVal) + dY : 0;
      let rawDim2 = panelsAlongLength > 0 ? (panelsAlongLength * effLen) + ((panelsAlongLength - 1) * effSpaceX) + (Njx * jointDilatationVal) + dX : 0;

      let finalCols = panelsAlongLength;
      let finalRows = panelsAlongWidth;
      if (rawDim2 > mainLength && finalCols > 0) {
        finalCols--;
        const new_Njx = limitDilatationVal > 0 ? Math.floor(mainLength / limitDilatationVal) : 0;
        rawDim2 = finalCols > 0 ? (finalCols * effLen) + ((finalCols - 1) * effSpaceX) + (new_Njx * jointDilatationVal) + dX : 0;
      }
      if (rawDim1 > totalRealWidth && finalRows > 0) {
        finalRows--;
        const new_Njy = limitDilatationVal > 0 ? Math.floor(totalRealWidth / limitDilatationVal) : 0;
        rawDim1 = finalRows > 0 ? (finalRows * effectiveEffWid) + ((finalRows - 1) * effSpaceY) + (new_Njy * jointDilatationVal) + dY : 0;
      }

      const finalLength = Math.round((rawDim2 + Number.EPSILON) * 100) / 100;
      const finalWidth = Math.round((rawDim1 + Number.EPSILON) * 100) / 100;

      // Persister les comptages par versant pour la synchronisation iframe (Bipente_asymetrique)
      if (penteType === 'Bipente_asymetrique' && _perPanRowCounts.length >= 2) {
        try {
          localStorage.setItem('pvPerPanRows_' + shape.pvId, JSON.stringify(_perPanRowCounts));
        } catch (_e) {}
      }

      // Mettre à jour les inputs directement
      if (nbColonne) {
        nbColonne.value = finalCols;
      }
      if (nbLigne) {
        nbLigne.value = finalRows;
      }
      if (dimLongueur) {
        dimLongueur.dataset.baseValue = finalLength.toFixed(2);
        dimLongueur.value = finalLength.toFixed(2);
      }
      if (dimLargeur) {
        dimLargeur.dataset.baseValue = finalWidth.toFixed(2);
        dimLargeur.value = finalWidth.toFixed(2);
      }

      const surfaceProjeteeInput = document.querySelector(`#surfaceProjeteePanneaux-${shape.pvId}`);
      if (surfaceProjeteeInput) {
        const totalPanels = finalCols * finalRows;
        const totalArea = totalPanels * effLen * effWid;
        const tilt = applyTiltProjection ? pente1 : (penteType === 'Monopente' ? pente1 : 0);
        const cosTilt = Math.max(Math.cos(tilt * Math.PI / 180), 0.1);
        surfaceProjeteeInput.value = (totalArea * cosTilt).toFixed(2);
      }

      // Mettre à jour les panneaux visuels
      if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && drawingControl.lineToPolygon) {
        drawingControl.lineToPolygon.forceUpdatePanels(shape.pvId);
      } else if (shape.type === SHAPE_TYPES.POLYGON && drawingControl.polygonPanels) {
        // BUG 2 FIX : Créer les panneaux s'ils n'existent pas encore, sinon les repositionner
        if (!drawingControl.polygonPanels.createdPanelsByShape.has(shape.pvId) || drawingControl.polygonPanels.createdPanelsByShape.get(shape.pvId).length === 0) {
          drawingControl.polygonPanels.createPanels(shape);
        } else {
          drawingControl.polygonPanels.updatePanelsPosition(shape);
        }
      } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && drawingControl.solarRectangle) {
        // CORRECTIF : forceUpdatePanels() n'existe pas sur SolarRectangle (cf. commentaire équivalent
        // plus haut dans ce fichier) — createSolarPanels() est la méthode réellement exposée.
        drawingControl.solarRectangle.createSolarPanels(shape);
      } else if (shape.type === SHAPE_TYPES.SHED_POLYGON && drawingControl.shedPolygon) {
        drawingControl.shedPolygon.refreshPanelsForShape(shape.pvId);
      }

      // NOUVEAU: Forcer la sauvegarde instantanée dans le storage pour que les rapports et calculs soient précis à 100%
      if (window.storageManager && typeof window.storageManager.savePageData === 'function') {
        window.storageManager.savePageData();
      }

      // Validation calepinage ombrières : affiche une recommandation sur la carte.
      // DÉSACTIVÉ (sur demande explicite) : les suggestions de modèle ("Modèle idéal pour votre
      // projet : ...", kind 'info') ne s'affichent plus — seules les non-conformités bloquantes
      // (kind 'error', ex. calepinage invalide pour Solumbra/bois) restent affichées via ErrorModal.
      const _azEl = document.querySelector(`#azimuth-${shape.pvId}`);
      const _azVal = _azEl ? (parseFloat(_azEl.value) || 0) : 0;
      const _calepResult = FormHandler._getCalepinageResult(finalRows, typeCouverture, isPortrait, _azVal);
      if (_calepResult && _calepResult.kind === 'error') FormHandler._showCalepinageInfo(_calepResult, drawingControl);

      // Synchronisation temps réel : Purge et recalcule l'UI globale après modification
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER, {
        detail: { pvId: shape.pvId }
      }));
    };

    // Afficher/masquer Sheds UNIQUEMENT pour les polygones créés avec le bouton sheds (ou activés via
    // le bouton "Option shed" d'un rectangle, cf. shedOptionToggle plus bas) — regroupé dans une
    // fonction nommée pour pouvoir être ré-exécutée après un tel changement (à la création, cette
    // visibilité n'est calculée qu'une fois ; les écouteurs posés à l'intérieur restent protégés par
    // leurs propres gardes dataset.*Initialized, donc sûrs à ré-invoquer sans doublon).
    const applyShedsSectionVisibility = () => {
    const shedsSection = shedsContainer ? shedsContainer.closest('.form-section-container') : null;
    // En mode shed, les joints de dilatation et le tableau "Nombre de PV" (logique de grille classique,
    // sans rapport avec le calepinage shed) n'ont pas de sens et sont masqués.
    const jointDilatationSection = document.querySelector(`#joint_dilatation_section-${shape.pvId}`) || document.getElementById('joint_dilatation_section');
    const nombrePVSection = document.querySelector(`#nombrePV_section-${shape.pvId}`) || document.getElementById('nombrePV_section');
    if (jointDilatationSection) jointDilatationSection.style.display = shape.shedsCapable ? 'none' : '';
    if (nombrePVSection) nombrePVSection.style.display = shape.shedsCapable ? 'none' : '';
    // "Pente des panneaux PV (°)" (générique, non-shed) fait doublon avec "Pente des panneaux en shed" :
    // masqué dès que le shed est actif (ne force pas son affichage sinon, laissé à toggleStructureFields).
    const inclinaisonTopGroupEl = document.querySelector(`#inclinaison-panneaux-top-group-${shape.pvId}`) || document.getElementById('inclinaison-panneaux-top-group');
    if (inclinaisonTopGroupEl && shape.shedsCapable) inclinaisonTopGroupEl.style.display = 'none';

    // Déplacement dynamique de "Esp. bordure (mm)" : champ GÉNÉRAL (marge utilisée par tout type de
    // polygone/rectangle, pas seulement les sheds) — on déplace le NŒUD DOM (jamais de duplication)
    // dans la section Sheds (juste après "Nb. PV en largeur"/"Esp. entre sheds") quand ce mode est
    // actif, et on le remet à son emplacement d'origine sinon. `shedsSection` étant masquée
    // (display:none) pour les polygones non-shed, le laisser DANS cette section le rendrait invisible
    // pour eux — d'où ce déplacement réversible plutôt qu'un positionnement statique dans le HTML.
    const espacementBordsGroup = document.querySelector(`#espacementBordsGroup-${shape.pvId}`) || document.getElementById('espacementBordsGroup');
    if (espacementBordsGroup && !espacementBordsGroup.dataset.originalPositionCaptured) {
      espacementBordsGroup._originalParent = espacementBordsGroup.parentElement;
      espacementBordsGroup._originalNextSibling = espacementBordsGroup.nextElementSibling;
      espacementBordsGroup.dataset.originalPositionCaptured = 'true';
    }

    // CORRECTIF (demande explicite : "la case Sheds réguliers reste toujours cochée par défaut, il
    // faut la décocher par défaut") : SHED_POLYGON forçait auparavant cette case cochée + désactivée
    // (isRegular=true imposé côté ShedPolygon.js) — revenu en arrière : la case reste pleinement
    // modifiable et décochée par défaut (valeur HTML native), pour les deux outils.
    if (shedsRegularInput) {
      shedsRegularInput.disabled = false;
    }

    if (!shape.shedsCapable) {
      if (shedsSection) shedsSection.style.display = 'none';
      if (espacementBordsGroup && espacementBordsGroup._originalParent && espacementBordsGroup.parentElement !== espacementBordsGroup._originalParent) {
        if (espacementBordsGroup._originalNextSibling) {
          espacementBordsGroup._originalParent.insertBefore(espacementBordsGroup, espacementBordsGroup._originalNextSibling);
        } else {
          espacementBordsGroup._originalParent.appendChild(espacementBordsGroup);
        }
      }
    } else {
      // CORRECTIF (champs shed du rectangle qui ne s'affichaient jamais) : ce bloc ne faisait que
      // repositionner/dévoiler des lignes internes, sans jamais réafficher la section elle-même —
      // resté invisible jusqu'ici car un SHED_POLYGON a shedsCapable=true dès sa création (avant même
      // ce premier passage), donc la section n'était alors jamais passée par le "display:none"
      // ci-dessus. Pour un rectangle, le bouton "Option shed" fait basculer shedsCapable sur une forme
      // déjà rendue (donc déjà masquée) : sans cette ligne, rien ne levait plus jamais le display:none.
      if (shedsSection) shedsSection.style.display = '';

      // Repositionner "Esp. bordure" juste après la rangée "Nb. PV en largeur"/"Esp. entre sheds"
      const shedsColSpacingRow = shedsColSpacingInput ? shedsColSpacingInput.closest('.form-section-container-row') : null;
      if (espacementBordsGroup && shedsColSpacingRow && espacementBordsGroup.previousElementSibling !== shedsColSpacingRow) {
        shedsColSpacingRow.insertAdjacentElement('afterend', espacementBordsGroup);
      }

      // CORRECTIF (demande explicite) : pour un rectangle avec "Option shed" activée, n'exposer que
      // "Nb. PV en largeur", "Esp. entre sheds" et "Esp. bordure (mm)" — masquer le reste de la
      // section Sheds (pente/rotation, Nb. PV en longueur/Esp. groupe de shed, Calculer/Voir les
      // résultats, Sheds réguliers/Remp. maximal), propre au calepinage shed complet (polygone). Pour
      // un SHED_POLYGON, la section reste affichée intégralement, comme avant.
      const isMinimalShedUI = shape.type === SHAPE_TYPES.LINE_TO_POLYGON;
      [shedPenteRotationRow, shedsLongGroupRow, shedsActionsRow, shedsRegularRow].forEach(row => {
        if (row) row.style.display = isMinimalShedUI ? 'none' : '';
      });

      // CORRECTIF (demande explicite : "assurez-vous que le calcul des panneaux en shed soit
      // dynamique. L'utilisateur ne doit pas cliquer 2 fois sur le bouton pour voir les résultats") :
      // contrairement au shed complet (ShedPolygon.js) qui expose un bouton "Calculer" dédié, l'UI
      // minimale du rectangle ci-dessus masque ce bouton (shedsActionsRow) — sans lui, modifier
      // "Nb. PV en largeur"/"Esp. entre sheds" n'avait plus aucun déclencheur de régénération, la
      // seule façon d'en voir l'effet étant de désactiver puis réactiver "Option shed" (2 clics
      // détournés sur le même bouton). Régénération débouncée (400ms), pour ce mode minimal
      // uniquement — le shed complet garde son comportement "n'affiche rien avant Calculer".
      if (isMinimalShedUI) {
        let minimalShedUpdateTimeout;
        const debouncedMinimalShedUpdate = () => {
          clearTimeout(minimalShedUpdateTimeout);
          minimalShedUpdateTimeout = setTimeout(() => {
            if (drawingControl.lineToPolygon) {
              drawingControl.lineToPolygon.forceUpdatePanels(shape.pvId);
            }
          }, 400);
        };
        [shedsColsInput, shedsColSpacingInput].forEach(el => {
          if (!el || el.dataset.minimalShedListenerInitialized) return;
          el.addEventListener('input', debouncedMinimalShedUpdate);
          el.addEventListener('change', debouncedMinimalShedUpdate);
          el.dataset.minimalShedListenerInitialized = 'true';
        });
      }

      // Sheds listeners (uniquement si autorisé)

      // CORRECTIF (demande explicite : "les panneaux doivent rester affichés visuellement jusqu'à la
      // mise à jour en cliquant sur Calculer") : ce bloc appelait auparavant updatePanels() sur CHAQUE
      // frappe dans ces champs, régénérant/effaçant immédiatement les panneaux (parfois avec une valeur
      // transitoire invalide/incomplète pendant la saisie, ex. champ vidé avant de taper une nouvelle
      // valeur). Le calepinage shed affiché ne doit plus bouger tant que l'utilisateur n'a pas cliqué
      // sur "Calculer" (cf. btn-calculer-shed dans calepinage.html, qui relit ces mêmes champs via
      // getPanelConfigFromForm au moment du clic — aucune dépendance à un état JS local ici). On ne
      // garde donc plus qu'un simple garde-fou anti-doublon (dataset.shedListenerInitialized), sans
      // écouteur de régénération : conservé pour que d'éventuels futurs écouteurs légers (ex. validation
      // de saisie) puissent encore s'appuyer dessus sans réintroduire de doublons.
      const shedsInputs = [shedsRowsInput, shedsRowSpacingInput, shedsColsInput, shedsColSpacingInput, shedRotationInput, penteShedInput];
      shedsInputs.forEach(el => {
        if (!el || el.dataset.shedListenerInitialized) return;
        el.dataset.shedListenerInitialized = 'true';
      });

      // "Afficher les détails des rangées" : masqué par défaut, ne devient visible/utilisable que si
      // "Nb. PV en longueur" (shedsRowsInput) est strictement supérieur à 0 (cf. demande explicite,
      // corrigée — pas "Nb. PV en largeur"/shedsColsInput) — en dessous, il n'existe aucune notion de
      // "rangée" de sheds pertinente à afficher.
      const shedsShowRowDetailsRow = document.querySelector(`#shedsShowRowDetailsRow-${shape.pvId}`) || document.getElementById('shedsShowRowDetailsRow');
      const shedsShowRowDetailsCheckbox = document.querySelector(`#shedsShowRowDetails-${shape.pvId}`) || document.getElementById('shedsShowRowDetails');
      if (shedsRowsInput && shedsShowRowDetailsRow) {
        const syncRowDetailsVisibility = () => {
          const hasLength = (parseFloat(shedsRowsInput.value) || 0) > 0;
          shedsShowRowDetailsRow.style.display = hasLength ? '' : 'none';
          if (!hasLength && shedsShowRowDetailsCheckbox && shedsShowRowDetailsCheckbox.checked) {
            shedsShowRowDetailsCheckbox.checked = false;
            shedsShowRowDetailsCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
          }
        };
        syncRowDetailsVisibility();
        if (!shedsRowsInput.dataset.rowDetailsVisibilityListenerInitialized) {
          shedsRowsInput.addEventListener('input', syncRowDetailsVisibility);
          shedsRowsInput.addEventListener('change', syncRowDetailsVisibility);
          shedsRowsInput.dataset.rowDetailsVisibilityListenerInitialized = 'true';
        }
      }

      // "Rotation shed" : répercute la rotation sur la flèche/label ET, désormais, sur les panneaux
      // eux-mêmes (pivot en place autour de leur centroïde, cf. PolygonPanelsManager::
      // rotatePanelsInPlace) — sans recalcul complet du calepinage (cf. règle "les panneaux restent
      // affichés jusqu'au clic sur Calculer"). Pour SHED_POLYGON, la synchro de l'Azimut se fait DANS
      // refreshPanelsForShape (unique point d'entrée, déjà déclenché ci-dessus via shedsInputs/
      // updatePanels) plutôt qu'ici, pour éviter deux rafraîchissements concurrents sur le même
      // événement (cause probable d'un doublon visuel du shed constaté auparavant).
      if (shedRotationInput && shape.type === SHAPE_TYPES.POLYGON && drawingControl.polygon
        && typeof drawingControl.polygon.updateRoofVisuals === 'function' && !shedRotationInput.dataset.roofVisualsListenerInitialized) {
        const onShedRotationChange = () => {
          drawingControl.polygon.updateRoofVisuals(shape);
          if (drawingControl.polygonPanels && typeof drawingControl.polygonPanels.rotatePanelsInPlace === 'function') {
            const newRotation = parseFloat(shedRotationInput.value) || 0;
            drawingControl.polygonPanels.rotatePanelsInPlace(shape.pvId, newRotation);
          }
        };
        shedRotationInput.addEventListener('input', onShedRotationChange);
        shedRotationInput.addEventListener('change', onShedRotationChange);
        shedRotationInput.dataset.roofVisualsListenerInitialized = 'true';
      }

      // RÉACTIVITÉ : "Esp. entre sheds" (shedsColSpacingInput) fait déjà partie de shedsInputs
      // ci-dessus (cascade complète updatePanels() -> createPanels()), mais on ajoute ici un recalcul
      // DIRECT et instantané du seul % de perte d'ombrage — sans attendre la régénération complète du
      // calepinage — pour garantir une mise à jour dynamique immédiate à chaque saisie. Remplace
      // l'ancien écouteur manuel sur le champ "Distance optimale" (supprimé de l'UI et de la logique :
      // le % de perte ne dépend plus que de "Esp. entre sheds" et des données géométriques/solaires).
      if (shedsColSpacingInput && perteOmbrageShedInput && !shedsColSpacingInput.dataset.shadingListenerInitialized) {
        const onShedsColSpacingInput = () => {
          // CORRECTIF (demande explicite : "le calcul de la perte d'ombrage entre shed n'est pas
          // calculé") : ce chemin était câblé en dur sur drawingControl.polygonPanels (ancien moteur
          // shed, SHAPE_TYPES.POLYGON+shedsCapable) — pour un SHED_POLYGON (ShedPolygon.js), rien ne se
          // passait (aucune erreur, juste un no-op silencieux, puisque les panneaux de ce shape ne sont
          // jamais suivis par polygonPanels).
          if (shape.type === SHAPE_TYPES.SHED_POLYGON) {
            const shedMgr = drawingControl.shedPolygon;
            if (!shedMgr) return;
            const config = shedMgr._getPanelConfigFromForm(shape.pvId);
            if (!config.hasPanelSelected) return;
            const tiltInput = document.querySelector(`#pente_panneaux_shed-${shape.pvId}`) || document.getElementById('pente_panneaux_shed');
            config.shedTilt = tiltInput ? (parseFloat(tiltInput.value) || 0) : 0;
            shedMgr._updateShedShading(shape.pvId, config);
            return;
          }
          if (!drawingControl.polygonPanels) return;
          const config = drawingControl.polygonPanels.getPanelConfigFromForm(shape.pvId);
          const shading = drawingControl.polygonPanels.computeShedShadingFallback(config);
          perteOmbrageShedInput.value = shading.lossPercent !== null ? shading.lossPercent.toFixed(1) : '';
          drawingControl.polygonPanels.requestShedShadingFromBackend(shape.pvId, config);
        };
        shedsColSpacingInput.addEventListener('input', onShedsColSpacingInput);
        shedsColSpacingInput.addEventListener('change', onShedsColSpacingInput);
        shedsColSpacingInput.dataset.shadingListenerInitialized = 'true';
      }

      // CORRECTIF (demande explicite : "le calcul Nb. Groupes dans la rangée ne fonctionne pas,
      // aucun résultat ne s'affiche") : les 2 écouteurs ci-dessous ciblaient en dur
      // drawingControl.polygonPanels (PolygonPanelsManager.js, moteur de l'ANCIEN shed via
      // SHAPE_TYPES.POLYGON+shedsCapable) — pour un shed dessiné avec l'outil dédié
      // (SHAPE_TYPES.SHED_POLYGON, cf. ShedPolygon.js), les données backend étaient stockées sur
      // drawingControl.shedPolygon (cf. calepinage_correction_controller.js::getManagerForShape),
      // jamais lues ici : le sélecteur de rangée affichait donc toujours un champ vide. On
      // sélectionne désormais le manager réellement associé au type de la forme.
      const shedManagerForRowUI = shape.type === SHAPE_TYPES.SHED_POLYGON
        ? drawingControl.shedPolygon
        : drawingControl.polygonPanels;

      // "Analyse par rangée" : sélectionner une rangée affiche son nombre de groupes de sheds — depuis
      // la répartition backend vérifiée (cf. verification.py::_verify_shed -> groupes_par_rangee,
      // stockée via setShedBackendRowGroups après un clic "Calculer"), pas depuis l'agrégation JS
      // locale (qui ne reflète que l'aperçu, jamais vérifié par le backend).
      if (shedRowSelectorInput && shedGroupsInRowInput && !shedRowSelectorInput.dataset.listenerInitialized) {
        shedRowSelectorInput.addEventListener('change', () => {
          if (!shedManagerForRowUI || typeof shedManagerForRowUI.getShedBackendRowGroups !== 'function') return;
          const groupesParRangee = shedManagerForRowUI.getShedBackendRowGroups(shape.pvId);
          const count = groupesParRangee[Number(shedRowSelectorInput.value)];
          shedGroupsInRowInput.value = typeof count === 'number' ? count : '';
          // Cf. calepinage_correction_controller.js::updateShedFormFields — même événement, pour que
          // petit_champ_solaire.html se resynchronise aussi quand l'utilisateur change de rangée
          // sélectionnée dans "Analyse par rangée" (pas seulement après un nouveau "Calculer").
          document.dispatchEvent(new CustomEvent('calepinage:shedResultsUpdated', { detail: { pvId: shape.pvId } }));
        });
        shedRowSelectorInput.dataset.listenerInitialized = 'true';
      }

      // "Afficher les détails des rangées" : bascule immédiate des repères sur le plan (N° de rangée +
      // nb de groupes), sans attendre un prochain recalcul du calepinage.
      if (shedsShowRowDetailsInput && !shedsShowRowDetailsInput.dataset.listenerInitialized) {
        shedsShowRowDetailsInput.addEventListener('change', () => {
          if (!shedManagerForRowUI || typeof shedManagerForRowUI.toggleRowDetailsOverlay !== 'function') return;
          shedManagerForRowUI.toggleRowDetailsOverlay(shape.pvId, shedsShowRowDetailsInput.checked);
        });
        shedsShowRowDetailsInput.dataset.listenerInitialized = 'true';
      }
    }
    };
    applyShedsSectionVisibility();

    // "Option shed" : bascule shape.shedsCapable pour un rectangle (LINE_TO_POLYGON) — réutilise la
    // même section "Sheds" et le même moteur de calcul (drawPanelsInRect + calculateShedGridRect côté
    // LineToPolygon.js) que l'outil shed dédié, sans dupliquer le formulaire ni le calcul. N'a de sens
    // que pour un rectangle : un SHED_POLYGON a déjà shedsCapable=true en permanence (cf. ShedPolygon.js).
    if (shedOptionToggleRow) {
      shedOptionToggleRow.style.display = (shape.type === SHAPE_TYPES.LINE_TO_POLYGON) ? '' : 'none';
    }
    if (shedOptionToggle && shape.type === SHAPE_TYPES.LINE_TO_POLYGON) {
      const syncShedOptionToggleLabel = () => {
        const active = !!shape.shedsCapable;
        shedOptionToggle.classList.toggle('active', active);
        shedOptionToggle.innerHTML = active
          ? '<i class="fas fa-toggle-on" style="margin-right: 6px;"></i>Option shed : activé'
          : '<i class="fas fa-toggle-off" style="margin-right: 6px;"></i>Option shed : désactivé';
      };
      syncShedOptionToggleLabel();
      if (!shedOptionToggle.dataset.listenerInitialized) {
        shedOptionToggle.addEventListener('click', () => {
          shape.shedsCapable = !shape.shedsCapable;
          syncShedOptionToggleLabel();
          applyShedsSectionVisibility();
          if (drawingControl.lineToPolygon) {
            drawingControl.lineToPolygon.forceUpdatePanels(shape.pvId);
          }
          if (window.storageManager && typeof window.storageManager.savePageData === 'function') {
            window.storageManager.savePageData();
          }
          document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER, { detail: { pvId: shape.pvId } }));
        });
        shedOptionToggle.dataset.listenerInitialized = 'true';
      }
    }

    // Rafraîchir lors d'un changement de système d'intégration
    const typeCouvertureEl = document.querySelector(`#type_de_structure-${shape.pvId}`) || document.querySelector(`select[id^="type_de_structure"]`);
    if (typeCouvertureEl && !typeCouvertureEl.dataset.listenerInitializedDelta) {
      typeCouvertureEl.addEventListener('change', (e) => {
        // RÈGLE 2 : Verrouillage dynamique si "Petit champ solaire"
        const isPetitChamp = e.target.value === 'Petit champ solaire';
        const paysageLabel = document.querySelector(`#modePosePaysageLabel-${shape.pvId}`);
        const portraitLabel = document.querySelector(`#modePosePortraitLabel-${shape.pvId}`);

        const supportShedInp = document.querySelector(`#supportShed-${shape.pvId}`);
        const isShedActive = supportShedInp ? supportShedInp.checked : shape.shedsCapable;

        if (isShedActive || isPetitChamp) {
          FormHandler.updateModePoseUI(shape.pvId, 'portrait');
          drawingControl.panelOrientation = 'portrait';
        } else {
          if (modePosePortraitInput) modePosePortraitInput.disabled = false;
          if (modePosePaysageInput) modePosePaysageInput.disabled = false;
          if (paysageLabel) { paysageLabel.style.opacity = '1'; paysageLabel.style.cursor = 'pointer'; }
          if (portraitLabel) { portraitLabel.style.opacity = '1'; portraitLabel.style.cursor = 'pointer'; }
        }

        updatePanels();
        debouncedUpdate();
      });
      typeCouvertureEl.dataset.listenerInitializedDelta = 'true';
    }

    const refSIEl = document.querySelector(`#referenceSI-${shape.pvId}`) || document.querySelector(`select[id^="referenceSI"]`);
    if (refSIEl && !refSIEl.dataset.listenerInitializedDelta) {
      const onReferenceSIChange = () => {
        // Résout systématiquement les données système, quel que soit le mode (shed ou non) : jusqu'ici
        // seule une valeur interne (spacingXVal/spacingYVal dans GeometryUtils) était mise à jour lors
        // d'un changement de système d'intégration — les champs affichés "Esp. entre PV X, Y" ne
        // l'étaient jamais.
        const structureType = typeCouvertureEl ? typeCouvertureEl.value : null;
        const systemsList = structureType ? TYPE_COUVERTURE_MAP[structureType] : null;
        const sysData = systemsList ? systemsList.find(s => s.id === refSIEl.value || s.label === refSIEl.value) : null;

        const espXInput = document.querySelector(`#espacementPanneauxX-${shape.pvId}`) || document.getElementById('espacementPanneauxX');
        const espYInput = document.querySelector(`#espacementPanneauxY-${shape.pvId}`) || document.getElementById('espacementPanneauxY');
        const xVal = (sysData && sysData.x !== undefined && !isNaN(parseFloat(sysData.x))) ? parseFloat(sysData.x) : 20;
        const yVal = (sysData && sysData.y !== undefined && !isNaN(parseFloat(sysData.y))) ? parseFloat(sysData.y) : 20;
        if (espXInput && parseFloat(espXInput.value) !== xVal) {
          espXInput.value = xVal;
          espXInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (espYInput && parseFloat(espYInput.value) !== yVal) {
          espYInput.value = yVal;
          espYInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        updatePanels();
        debouncedUpdate();

        // NOTE : l'auto-remplissage shed (pente/Nb. PV en longueur-largeur/Esp. groupe de shed) a été
        // déplacé dans DrawingControl.js::handleSystemeChange — même point d'entrée unique et fiable
        // (lié dès l'initialisation) que les champs "Esp. entre PV X/Y" ci-dessus, au lieu de cet
        // écouteur séparé (attaché plus tardivement par formulaire, ce qui pouvait nécessiter plusieurs
        // sélections ou un rechargement de page avant de fonctionner).
      };

      // CORRECTIF (auto-remplissage Nb. PV en longueur/largeur/pente non déclenché depuis la liste
      // déroulante) : #referenceSI est un select2 — un choix fait via SON UI (pas une modification
      // programmatique du <select> natif) ne déclenche pas toujours un événement 'change' natif selon
      // la configuration/version, seulement l'événement jQuery 'select2:select' (cf. handleSystemeChange
      // dans DrawingControl.js, qui écoute déjà les deux pour cette même raison). Sans ce second
      // écouteur, addEventListener('change', ...) seul ne se déclenchait donc jamais lors d'une
      // sélection réelle par l'utilisateur dans la liste.
      refSIEl.addEventListener('change', onReferenceSIChange);
      if (typeof jQuery !== 'undefined') {
        jQuery(refSIEl).on('select2:select', onReferenceSIChange);
      }
      refSIEl.dataset.listenerInitializedDelta = 'true';
    }

    // Forcer l'état initial du bouton d'informations à l'initialisation du formulaire
    if (refSIEl) {
      setTimeout(() => {
        if (typeof jQuery !== 'undefined') {
          jQuery(refSIEl).trigger('change');
        } else {
          refSIEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, 100);
    }

    //  ÉCOUTEUR POUR LA CASE À COCHER (shedsRegularInput déjà déclaré plus haut, réutilisé ici)
    if (shedsRegularInput) {
      shedsRegularInput.addEventListener('change', () => {
        updatePanels();
        // Sauvegarder l'état de la checkbox dans le localStorage
        if (window.storageManager && typeof window.storageManager.savePageData === 'function') {
          window.storageManager.savePageData();
        }
      });
    }

    // BOUTON "Remp. maximal" : agit comme une réinitialisation — au clic, force le remplissage au
    // maximum en remettant "Nb. PV en longueur" et "Esp. groupe de shed" à 0 (0 = aucun regroupement,
    // cf. PolygonPanelsManager.getPanelConfigFromForm/createPanels). Ce n'est plus un état persistant
    // (ancienne case à cocher "shedsMaxFill", jamais lue par le calepinage réel) mais une action ponctuelle.
    const shedsMaxFillBtn = document.querySelector(`#shedsMaxFill-${shape.pvId}`) || document.getElementById('shedsMaxFill');
    if (shedsMaxFillBtn && !shedsMaxFillBtn.dataset.listenerInitialized) {
      shedsMaxFillBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const rowsInput = document.querySelector(`#shedsRows-${shape.pvId}`) || document.getElementById('shedsRows');
        const rowSpacingInput = document.querySelector(`#shedsRowSpacing-${shape.pvId}`) || document.getElementById('shedsRowSpacing');
        [rowsInput, rowSpacingInput].forEach(input => {
          if (!input) return;
          input.value = 0;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
      shedsMaxFillBtn.dataset.listenerInitialized = 'true';
    }


    //!SECTION Nettoyer et ajouter les écouteurs de longueur et de largeur
    if (longueurInput) {
      // Marquer les inputs avec un attribut data pour éviter les doublons
      if (!longueurInput.dataset.listenerInitialized) {
        longueurInput.addEventListener('change', (e) => {
          // Si la modification provient du redimensionnement sur la carte, on actualise juste les panneaux et les résultats
          if (e.target.isInternalUpdate) {
            updatePanels();
            return;
          }
          // Bloque la notation scientifique (e.g. 1.23e-10)
          if (["e", "E"].includes(e.key)) {
            e.preventDefault();
          }
          // Bloque les valeurs inférieures à la longueur / la largeur minimale
          if (e.target.value < DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION) {
            e.target.value = DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION;
            debouncedUpdate();
          }
          else {
            debouncedUpdate();
          }
        });
        longueurInput.dataset.listenerInitialized = 'true';
      }
    }

    if (largeurInput) {
      // Marquer l'input avec un attribut data pour éviter les doublons
      if (!largeurInput.dataset.listenerInitialized) {
        largeurInput.addEventListener('change', (e) => {
          // Si la modification provient du redimensionnement sur la carte, on actualise juste les panneaux et les résultats
          if (e.target.isInternalUpdate) {
            updatePanels();
            return;
          }
          // Bloque la notation scientifique (e.g. 1.23e-10)
          if (["e", "E"].includes(e.key)) {
            e.preventDefault();
          }
          // Bloque les valeurs inférieures à la longueur / la largeur minimale
          if (e.target.value < DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION) {
            e.target.value = DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION;
            debouncedUpdate();
          }
          else {
            debouncedUpdate();
          }
        });
        largeurInput.dataset.listenerInitialized = 'true';
      }
    }

    if (espacementPanneauxXInput) {
      espacementPanneauxXInput.addEventListener('input', (e) => {
        let value = parseFloat(e.target.value);
        if (!isNaN(value)) {
          if (value < 0) e.target.value = 0;
          if (value >= 30) {
            e.target.value = '';
            if (window.showValidationAlert) window.showValidationAlert("L'espacement X doit être strictement inférieur à 30 mm.", e.target);
          }
        }
        updatePanels();
      });
    }
    if (espacementPanneauxYInput) {
      espacementPanneauxYInput.addEventListener('input', (e) => {
        let value = parseFloat(e.target.value);
        if (!isNaN(value)) {
          if (value < 0) e.target.value = 0;
          if (value >= 30) {
            e.target.value = '';
            if (window.showValidationAlert) window.showValidationAlert("L'espacement Y doit être strictement inférieur à 30 mm.", e.target);
          }
        }
        updatePanels();
      });
    }
    // Listener pour les espacements sur les "Change"
    for (const espacementInput of [espacementPanneauxXInput, espacementPanneauxYInput]) {
      if (!espacementInput) continue;
      espacementInput.setAttribute('min', '0');
      espacementInput.setAttribute('max', '29');
      espacementInput.addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val) || val < 0) e.target.value = 0;
        if (val >= 30) {
          e.target.value = '';
        }
        // Mettre à jour immédiatement les panneaux
        updatePanels();
      });
    }

    // Listener pour l'espacement avec les bords
    if (espacementBordsInput) {
      espacementBordsInput.addEventListener('change', (e) => {
        if (e.target.value < 0) {
          drawingControl.errorModal.show(`L'espacement avec les bords ne peut pas être négatif`);
          e.target.value = 0;
        }
        // Mettre à jour immédiatement les panneaux
        updatePanels();
      });
    }

    // Écouteurs pour le rafraîchissement lors des changements de joints
    if (jointDilatationInput) {
      const validateJoint = (e) => {
        let val = parseFloat(e.target.value);
        if (val !== 0 && !isNaN(val)) {
          if (val < 50) {
            drawingControl.errorModal.show("La valeur du joint de dilatation doit être d'au moins 50 mm (5 cm)");
            e.target.value = 50;
          } else if (val > 500) {
            drawingControl.errorModal.show("La valeur du joint de dilatation ne doit pas dépasser 500 mm (50 cm)");
            e.target.value = 500;
          }
        }
      };
      jointDilatationInput.addEventListener('input', () => { updatePanels(); });
      jointDilatationInput.addEventListener('change', (e) => { validateJoint(e); updatePanels(); debouncedUpdate(); });
    }
    if (limitDilatationInput) {
      const validateLimit = (e) => {
        let val = parseFloat(e.target.value);
        if (val !== 0 && !isNaN(val)) {
          if (val < 30) {
            drawingControl.errorModal.show("La longueur limite avant joint doit être d'au moins 30 m");
            e.target.value = 30;
          } else if (val > 100) {
            drawingControl.errorModal.show("La longueur limite avant joint ne doit pas dépasser 100 m");
            e.target.value = 100;
          }
        }
      };
      limitDilatationInput.addEventListener('input', () => { updatePanels(); });
      limitDilatationInput.addEventListener('change', (e) => { validateLimit(e); updatePanels(); debouncedUpdate(); });
    }

    // Récupérer les inputs personnalisés (pas les cachés)
    const longueurPanneauCustomInput = document.querySelector(`#longueurPanneauCustom-${shape.pvId}`) || document.getElementById('longueurPanneauCustom');
    const largeurPanneauCustomInput = document.querySelector(`#largeurPanneauCustom-${shape.pvId}`) || document.getElementById('largeurPanneauCustom');
    const epaisseurPanneauCustomInput = document.querySelector(`#epaisseurPanneauCustom-${shape.pvId}`) || document.getElementById('epaisseurPanneauCustom');

    // Gestion du changement du select de dimensions prédéfinies
    if (dimensionsPanneauSelect) {
      dimensionsPanneauSelect.addEventListener('change', (e) => {
        const selectedValue = e.target.value;

        // Récupérer le conteneur à chaque fois (au cas où il n'existait pas avant)
        const customDimensionsContainer = document.querySelector(`#customDimensionsContainer-${shape.pvId}`);

        if (selectedValue === 'custom') {
          // Afficher les inputs personnalisés
          if (customDimensionsContainer) {
            customDimensionsContainer.style.display = 'block';
            customDimensionsContainer.classList.remove('hidden');
          }

          // Récupérer les inputs personnalisés après affichage
          setTimeout(() => { // Petit délai pour s'assurer que l'affichage est effectif
            const longueurPanneauCustomInput = document.querySelector(`#longueurPanneauCustom-${shape.pvId}`) || document.getElementById('longueurPanneauCustom');
            const largeurPanneauCustomInput = document.querySelector(`#largeurPanneauCustom-${shape.pvId}`) || document.getElementById('largeurPanneauCustom');
            const epaisseurPanneauCustomInput = document.querySelector(`#epaisseurPanneauCustom-${shape.pvId}`) || document.getElementById('epaisseurPanneauCustom');

            // Copier les valeurs
            if (longueurPanneauCustomInput && longueurPanneauInput) {
              longueurPanneauCustomInput.value = longueurPanneauInput.value;
            }
            if (largeurPanneauCustomInput && largeurPanneauInput) {
              largeurPanneauCustomInput.value = largeurPanneauInput.value;
            }
            if (epaisseurPanneauCustomInput && epaisseurPanneauInput) {
              epaisseurPanneauCustomInput.value = epaisseurPanneauInput.value;
            }
          }, 100);
        } else {
          // Cacher les inputs personnalisés et appliquer les dimensions prédéfinies
          if (customDimensionsContainer) {
            customDimensionsContainer.style.display = 'none';
            customDimensionsContainer.classList.add('hidden');
          }

          // Parser les dimensions depuis la valeur sélectionnée
          const [longueur, largeur, epaisseur] = selectedValue.split('x').map(val => parseInt(val));

          // Mettre à jour les inputs cachés (qui sont utilisés par la logique existante)
          if (longueurPanneauInput) longueurPanneauInput.value = longueur;
          if (largeurPanneauInput) largeurPanneauInput.value = largeur;
          if (epaisseurPanneauInput) epaisseurPanneauInput.value = epaisseur;

          // Déclencher la mise à jour des panneaux
          updatePanels();
        }
      });
    }

    // Ajouter les écouteurs pour les inputs personnalisés
    if (longueurPanneauCustomInput) {
      longueurPanneauCustomInput.addEventListener('change', (e) => {
        // Copier vers l'input caché
        if (longueurPanneauInput) {
          longueurPanneauInput.value = e.target.value;
        }
        updatePanels();
      });
    }

    if (largeurPanneauCustomInput) {
      largeurPanneauCustomInput.addEventListener('change', (e) => {
        // Copier vers l'input caché
        if (largeurPanneauInput) {
          largeurPanneauInput.value = e.target.value;
        }
        updatePanels();
      });
    }

    if (epaisseurPanneauCustomInput) {
      epaisseurPanneauCustomInput.addEventListener('change', (e) => {
        // Copier vers l'input caché
        if (epaisseurPanneauInput) {
          epaisseurPanneauInput.value = e.target.value;
        }
        updatePanels();
      });
    }

    // NOUVEAU: Masquer par défaut les dimensions et afficher si favori sélectionné
    const toggleDimensionsVisibility = () => {
      const refInput = document.querySelector(`#referencePanneau-${shape.pvId}`) || document.getElementById('referencePanneau');
      const hasRef = refInput && refInput.value && refInput.value.trim() !== '' && refInput.value !== 'N/A';

      const dimensionSelectors = [
        `#longueurPanneau-${shape.pvId}`,
        `#largeurPanneau-${shape.pvId}`,
        `#epaisseurPanneau-${shape.pvId}`,
        `#dimensionsPanneaux-${shape.pvId}`
      ];

      dimensionSelectors.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
          const container = el.closest('.col-md-6, .col-md-4, .col-md-3, .form-group') || el.parentElement;
          if (container) {
            container.style.display = hasRef ? '' : 'none';
          }
        }
      });
    };

    // Gestion du changement des dimensions "cachées" du panneau
    const longueurPanneauInput = document.querySelector(`#longueurPanneau-${shape.pvId}`) || document.getElementById('longueurPanneau');
    const largeurPanneauInput = document.querySelector(`#largeurPanneau-${shape.pvId}`) || document.getElementById('largeurPanneau');


    if (!longueurPanneauInput || !largeurPanneauInput || !espacementPanneauxXInput || !espacementPanneauxYInput) {
      console.error("inputs non trouvés pour PV", shape.pvId);
    } else {
      // Lier la visibilité des dimensions au choix du panneau favori
      const refPanneauInput = document.querySelector(`#referencePanneau-${shape.pvId}`) || document.getElementById('referencePanneau');
      if (refPanneauInput) {
        refPanneauInput.addEventListener('change', () => {
          toggleDimensionsVisibility();
          updatePanels();
        });
        refPanneauInput.addEventListener('input', () => {
          toggleDimensionsVisibility();
          updatePanels();
        });
      }
      setTimeout(toggleDimensionsVisibility, 100);

      longueurPanneauInput.addEventListener('change', (e) => {
        // Vérifier si on est en mode personnalisé
        if (dimensionsPanneauSelect && dimensionsPanneauSelect.value !== 'custom') {
          return; // Ne pas traiter si on n'est pas en mode personnalisé
        }
        // Bloque la notation scientifique (e.g. 1.23e-10)
        if (["e", "E"].includes(e.key)) {
          e.preventDefault();
        }
        // Bloque les valeurs inférieures à la longueur / la largeur minimale
        if (e.target.value < PANEL_DIMENSIONS.MIN_LENGTH) {
          drawingControl.errorModal.show(`La longueur du panneau doit être supérieure à ${PANEL_DIMENSIONS.MIN_LENGTH} mm`);
          e.target.value = PANEL_DIMENSIONS.MIN_LENGTH;
        }
        // Mettre à jour immédiatement les panneaux
        updatePanels();
      });

      // Ajouter aussi un écouteur sur 'input' pour la mise à jour en temps réel
      longueurPanneauInput.addEventListener('input', () => {
        // Vérifier si on est en mode personnalisé
        if (dimensionsPanneauSelect && dimensionsPanneauSelect.value !== 'custom') {
          return; // Ne pas traiter si on n'est pas en mode personnalisé
        }
        const value = parseFloat(longueurPanneauInput.value);
        if (value >= PANEL_DIMENSIONS.MIN_LENGTH) {
          updatePanels();
        }
      });

      largeurPanneauInput.addEventListener('change', (e) => {
        // Vérifier si on est en mode personnalisé
        if (dimensionsPanneauSelect && dimensionsPanneauSelect.value !== 'custom') {
          return; // Ne pas traiter si on n'est pas en mode personnalisé
        }
        // Bloque la notation scientifique (e.g. 1.23e-10)
        if (["e", "E"].includes(e.key)) {
          e.preventDefault();
        }
        // Bloque les valeurs inférieures à la longueur / la largeur minimale
        if (e.target.value < PANEL_DIMENSIONS.MIN_WIDTH) {
          drawingControl.errorModal.show(`La largeur du panneau doit être supérieure à ${PANEL_DIMENSIONS.MIN_WIDTH} mm`);
          e.target.value = PANEL_DIMENSIONS.MIN_WIDTH;
        }
        // Mettre à jour immédiatement les panneaux
        updatePanels();
      });

      // Ajouter aussi un écouteur sur 'input' pour la mise à jour en temps réel
      largeurPanneauInput.addEventListener('input', () => {
        // Vérifier si on est en mode personnalisé
        if (dimensionsPanneauSelect && dimensionsPanneauSelect.value !== 'custom') {
          return; // Ne pas traiter si on n'est pas en mode personnalisé
        }
        const value = parseFloat(largeurPanneauInput.value);
        if (value >= PANEL_DIMENSIONS.MIN_WIDTH) {
          updatePanels();
        }
      });

      epaisseurPanneauInput.addEventListener('change', (e) => {
        // Vérifier si on est en mode personnalisé
        if (dimensionsPanneauSelect && dimensionsPanneauSelect.value !== 'custom') {
          return; // Ne pas traiter si on n'est pas en mode personnalisé
        }
        // Bloque la notation scientifique (e.g. 1.23e-10)
        if (["e", "E"].includes(e.key)) {
          e.preventDefault();
        }
        // Bloque les valeurs inférieures à la longueur / la largeur minimale
        if (e.target.value < PANEL_DIMENSIONS.MIN_THICKNESS) {
          drawingControl.errorModal.show(`L'épaisseur du panneau doit être supérieure à ${PANEL_DIMENSIONS.MIN_THICKNESS} mm`);
          e.target.value = PANEL_DIMENSIONS.MIN_THICKNESS;
          debouncedUpdate();
        } else {
          debouncedUpdate();
        }
        // Note: L'épaisseur n'affecte pas la position des panneaux, donc pas de refresh nécessaire
      });
      epaisseurPanneauInput.addEventListener('change', (e) => {
        // Vérifier si on est en mode personnalisé
        if (dimensionsPanneauSelect && dimensionsPanneauSelect.value !== 'custom') {
          return; // Ne pas traiter si on n'est pas en mode personnalisé
        }
        // Bloque la notation scientifique (e.g. 1.23e-10)
        if (["e", "E"].includes(e.key)) {
          e.preventDefault();
        }
        // Bloque les valeurs inférieures à la longueur / la largeur minimale
        if (e.target.value < PANEL_DIMENSIONS.MIN_THICKNESS) {
          drawingControl.errorModal.show(`L'épaisseur du panneau doit être supérieure à ${PANEL_DIMENSIONS.MIN_THICKNESS} mm`);
          e.target.value = PANEL_DIMENSIONS.MIN_THICKNESS;
          debouncedUpdate();
        } else {
          debouncedUpdate();
        }
      });

      // Gestion du changement de l'azimuth
      if (btnSwitchAzimuthInput) {
        if (!btnSwitchAzimuthInput.dataset.listenerInitialized) {
          btnSwitchAzimuthInput.addEventListener('click', (e) => {
            e.preventDefault(); // Empêche le comportement par défaut du bouton

            // S'assurer que la forme associée à ce formulaire est sélectionnée pour la rotation
            if (!drawingControl.selectedShape || drawingControl.selectedShape.pvId !== shape.pvId) {
              drawingControl.setSelection(shape);
            }

            const azimuthInput = document.querySelector(`#azimuth-${shape.pvId}`);
            if (azimuthInput) {
              let currentValue = parseFloat(azimuthInput.value) || 0;

              let newValue = currentValue + 180;
              if (newValue > 180) newValue = newValue - 360;
              else if (newValue <= -180) newValue = newValue + 360;

              // Mettre à jour l'input et la flèche explicitement
              azimuthInput.value = newValue;

              shape.isAzimuthFlipped = !shape.isAzimuthFlipped;

              if (shape.type === SHAPE_TYPES.POLYGON && drawingControl.polygon) {
                drawingControl.polygon.updateRoofVisuals(shape);
              } else {
                if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && drawingControl.lineToPolygon) {
                  drawingControl.lineToPolygon.updateRoofVisuals(shape);
                } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && drawingControl.solarRectangle) {
                  drawingControl.solarRectangle.updateRoofVisuals(shape);
                }
              }
            } else {
              shape.isAzimuthFlipped = !shape.isAzimuthFlipped;
            }
          });
          btnSwitchAzimuthInput.dataset.listenerInitialized = 'true';
        }
      }

      // Gestion du bouton "Inversement de la pente" (bascule l'axe du faîtage de 90°) : bascule
      // _lengthIndices/_widthIndices entre [0,2] et [1,3] (la paire d'arêtes opposées considérée
      // comme "longueur" vs "largeur", cf. MeasurementControl.js).
      //
      // HISTORIQUE DES CORRECTIFS :
      // 1) Une première version redéclenchait le pipeline complet de recalcul (dispatch d'un
      //    `change` sur "Géométrie de la toiture" → updatePanels() → debouncedUpdate() →
      //    refreshPanelsForShape()) : `debouncedUpdate()`/`updatePanels()` recalculent aussi
      //    `longueur`/`largeur` à partir de _lengthIndices et redessinent donc le RECTANGLE
      //    lui-même avec ses dimensions permutées — d'où une rotation/déplacement visible.
      // 2) Pour corriger cela, on appelait ensuite UNIQUEMENT updateRoofVisuals(shape) (comme le
      //    flip d'azimut) : le rectangle restait bien figé, mais ni l'ancien tracé de faîtage
      //    n'était nettoyé pour de bon (deux caches d'overlays existent :
      //    `roofOverlaysByShape` ET `polygon.roofOverlays`, cf. cleanupPanelsForShape ci-dessous)
      //    ni la disposition des panneaux n'était régénérée.
      // 3) Fix final : appeler directement refreshPanelsForShape(pvId) (LineToPolygon/SolarRectangle)
      //    plutôt que de passer par le pipeline `change`/updatePanels/debouncedUpdate. Cette
      //    fonction ne lit que le tracé EXISTANT du polygone (aucun setPath/repositionnement),
      //    nettoie proprement panneaux ET overlays de toiture (cleanupPanelsForShape), puis
      //    régénère les panneaux — ce qui appelle updateRoofVisuals() en interne au passage. Le
      //    rectangle reste donc figé, l'ancien faîtage est supprimé, et les panneaux sont
      //    recalculés selon le nouvel axe.
      if (btnInvertFaitageInput) {
        if (!btnInvertFaitageInput.dataset.listenerInitialized) {
          btnInvertFaitageInput.addEventListener('click', (e) => {
            e.preventDefault();

            if (!drawingControl.selectedShape || drawingControl.selectedShape.pvId !== shape.pvId) {
              drawingControl.setSelection(shape);
            }

            const currentLengthIndices = shape._lengthIndices || [0, 2];
            const isCurrently02 = currentLengthIndices.includes(0) && currentLengthIndices.includes(2);
            shape._lengthIndices = isCurrently02 ? [1, 3] : [0, 2];
            shape._widthIndices = isCurrently02 ? [0, 2] : [1, 3];

            if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && drawingControl.lineToPolygon) {
              drawingControl.lineToPolygon.refreshPanelsForShape(shape.pvId);
            } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && drawingControl.solarRectangle) {
              drawingControl.solarRectangle.refreshPanelsForShape(shape.pvId);
            } else if (shape.type === SHAPE_TYPES.POLYGON && drawingControl.polygon) {
              // Pas de régénération de panneaux disponible pour ce type de forme : on redessine
              // au moins l'axe du faîtage, comme précédemment.
              drawingControl.polygon.updateRoofVisuals(shape);
            }
          });
          btnInvertFaitageInput.dataset.listenerInitialized = 'true';
        }
      }
    }

    // Gestion du changement de mode de pose portrait/paysage
    const modePosePortraitInput = document.querySelector(`#modePosePortrait-${shape.pvId}`) || document.getElementById('modePosePortrait');
    const modePosePaysageInput = document.querySelector(`#modePosePaysage-${shape.pvId}`) || document.getElementById('modePosePaysage');

    if (modePosePortraitInput) {
      modePosePortraitInput.addEventListener('change', (e) => {
        const newOrientation = e.target.checked ? 'portrait' : 'paysage';

        // Validation de conformité
        if (e.isTrusted) {
          if (!FormHandler.checkCompliance(drawingControl, shape.pvId, newOrientation)) {
            e.target.checked = false; // Annuler le changement
            if (modePosePaysageInput) modePosePaysageInput.checked = true;
            return;
          }
        }

        drawingControl.panelOrientation = newOrientation;

        // Mettre à jour le label du mode de pose
        FormHandler.updateModePoseUI(shape.pvId, newOrientation);

        // AJOUT: Mettre à jour les panneaux visuels
        updatePanels();
      });
    }

    if (modePosePaysageInput) {
      modePosePaysageInput.addEventListener('change', (e) => {
        const newOrientation = e.target.checked ? 'paysage' : 'portrait';

        // Validation de conformité
        if (e.isTrusted) {
          if (!FormHandler.checkCompliance(drawingControl, shape.pvId, newOrientation)) {
            e.target.checked = false; // Annuler le changement
            if (modePosePortraitInput) modePosePortraitInput.checked = true;
            return;
          }
        }

        drawingControl.panelOrientation = newOrientation;

        // Mettre à jour le label du mode de pose
        FormHandler.updateModePoseUI(shape.pvId, newOrientation);

        // AJOUT: Mettre à jour les panneaux visuels
        updatePanels();
      });
    }
    if (inclinaisonInput) {
      inclinaisonInput.addEventListener('focus', function () {
        this.dataset.prevValue = this.value;
      });
      inclinaisonInput.addEventListener('change', async (e) => {
        if (e.isTrusted) {
          const newSlope = parseFloat(e.target.value);
          if (!FormHandler.checkCompliance(drawingControl, shape.pvId, null, newSlope)) {
            e.target.value = e.target.dataset.prevValue || 0;
            return;
          }
        }
        e.target.dataset.prevValue = e.target.value;
        updatePanels();
        debouncedUpdate();
        document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER));
      });
      inclinaisonInput.addEventListener('input', async () => {
        updatePanels();
        document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER));
      });
    }

    // Gestion des re-générations lors d'un changement de géométrie toiture
    const toiturePenteSelect = document.querySelector(`#toiture_pente_type-${shape.pvId}`) || document.getElementById('toiture_pente_type');
    const faitageInput = document.querySelector(`#largeur_faitage_mm-${shape.pvId}`) || document.getElementById('largeur_faitage_mm');
    const asymetrieInput = document.querySelector(`#asymetrie_percent-${shape.pvId}`) || document.getElementById('asymetrie_percent');

    [toiturePenteSelect, faitageInput, asymetrieInput].forEach(el => {
      if (el && !el.dataset.roofListenerInit) {
        el.addEventListener('change', () => { updatePanels(); debouncedUpdate(); });
        el.dataset.roofListenerInit = 'true';
      }
    });

    // Désélectionner par défaut pour forcer l'utilisateur à choisir (pour les nouvelles formes)
    const dimLongueurTest = document.querySelector(`#dimensionsChampPVlongueur-${shape.pvId}`) || document.getElementById('dimensionsChampPVlongueur');
    const isNewForm = !dimLongueurTest || !dimLongueurTest.value || dimLongueurTest.value === "0" || dimLongueurTest.value === "0.00";

    // CORRECTIF : "Esp. entre PV X, Y" reste vide/à 0 pour certaines formes (ex: rectangle configuré
    // depuis un modal de géométrie, qui renseigne dimensionsChampPVlongueur immédiatement — isNewForm
    // devient donc faux avant même que ce bloc n'ait eu la chance de s'exécuter, contrairement au
    // polygone libre où ce champ reste toujours à 0). Sorti du bloc isNewForm et rendu inconditionnel :
    // le garde-fou "vide/à 0 uniquement" est déjà idempotent, donc sans risque d'écraser une valeur
    // déjà choisie par l'utilisateur, quel que soit le chemin de création de la forme (polygone, shed,
    // rectangle, LineToPolygon, restauration...). Défaut : PANEL_DIMENSIONS.DEFAULT_SPACING_MM (20mm).
    if (espacementPanneauxXInput && (!espacementPanneauxXInput.value || parseFloat(espacementPanneauxXInput.value) === 0)) {
      espacementPanneauxXInput.value = PANEL_DIMENSIONS.DEFAULT_SPACING_MM;
      espacementPanneauxXInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (espacementPanneauxYInput && (!espacementPanneauxYInput.value || parseFloat(espacementPanneauxYInput.value) === 0)) {
      espacementPanneauxYInput.value = PANEL_DIMENSIONS.DEFAULT_SPACING_MM;
      espacementPanneauxYInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (isNewForm) {
      // CORRECTIF : le polygone libre (draw-polygon-button) ne recevait aucun mode de pose par
      // défaut (Portrait/Paysage restaient tous deux décochés), contrairement à Rectangle/Shed/
      // LineToPolygon — or le calcul des panneaux pour SHAPE_TYPES.POLYGON est bloqué tant qu'aucun
      // mode de pose n'est sélectionné (cf. updatePanels(), "RÈGLE 1"), donc aucun panneau ne
      // s'affichait jamais après un simple dessin, même avec un panneau favori déjà choisi.
      // Toutes les formes démarrent maintenant en Portrait par défaut (modifiable ensuite par
      // l'utilisateur), pour un comportement cohérent et un affichage immédiat des panneaux.
      if (modePosePortraitInput) modePosePortraitInput.checked = true;
      if (modePosePaysageInput) modePosePaysageInput.checked = false;
      drawingControl.panelOrientation = 'portrait';
      FormHandler.updateModePoseUI(shape.pvId, 'portrait');

      if (shape.type === SHAPE_TYPES.POLYGON && !shape.shedsCapable) {
        // NOUVEAU: Aligner l'azimut sur le premier segment du polygone (polygone libre uniquement ;
        // conservé tel quel, indépendant du mode de pose ci-dessus)
        const azimuthInput = document.querySelector(`#azimuth-${shape.pvId}`);
        if (azimuthInput) {
          let initialAzimuth = shape.gridBaseHeading !== undefined ? shape.gridBaseHeading : 0;

          let pvgisAzimuth = initialAzimuth - 180;
          let normVal = Math.round(pvgisAzimuth);
          if (normVal <= -180) normVal += 360;
          if (normVal > 180) normVal -= 360;

          azimuthInput.value = normVal;
          shape.rotation = initialAzimuth;
          if (drawingControl.polygonPanels && typeof drawingControl.polygonPanels.updateGridBaseHeading === 'function') {
            drawingControl.polygonPanels.updateGridBaseHeading(shape);
          }
          if (drawingControl.polygon && typeof drawingControl.polygon.updateRoofVisuals === 'function') {
            drawingControl.polygon.updateRoofVisuals(shape);
          }
        }
      }

      // BUG 2 FIX: Initialiser les calculs des dimensions dès le dessin de la forme (ex: Solar Rectangle)
      setTimeout(() => updatePanels(), 150);
    }

    const paysageLabel = document.querySelector(`#modePosePaysageLabel-${shape.pvId}`) || document.getElementById('modePosePaysageLabel');
    const portraitLabel = document.querySelector(`#modePosePortraitLabel-${shape.pvId}`) || document.getElementById('modePosePortraitLabel');
    const typeCouvertureElInitial = document.querySelector(`#type_de_structure-${shape.pvId}`) || document.querySelector(`select[id^="type_de_structure"]`);
    const isPetitChamp = typeCouvertureElInitial && typeCouvertureElInitial.value === 'Petit champ solaire';
    const isToitureTerasse = typeCouvertureElInitial && typeCouvertureElInitial.value === 'Toiture terasse';
    const supportShedInitial = document.querySelector(`#supportShed-${shape.pvId}`) || document.getElementById('supportShed');
    const isShedInit = (supportShedInitial ? supportShedInitial.checked : false) || !!shape.shedsCapable;

    // NOUVEAU : Verrouiller le Mode de pose (Règle 2 : Petit champ solaire uniquement — les sheds
    // n'imposent plus Portrait, cf. logique de largeur projetée adaptée dans getPanelConfigFromForm).
    if (isPetitChamp) {
      if (modePosePortraitInput) {
        modePosePortraitInput.checked = true;
        modePosePortraitInput.disabled = true;
      }
      if (modePosePaysageInput) {
        modePosePaysageInput.checked = false;
        modePosePaysageInput.disabled = true;
      }
      if (paysageLabel) {
        paysageLabel.style.opacity = '0.5';
        paysageLabel.style.cursor = 'not-allowed';
      }
      if (portraitLabel) {
        portraitLabel.style.cursor = 'not-allowed';
      }
      FormHandler.updateModePoseUI(shape.pvId, 'portrait');
      drawingControl.panelOrientation = 'portrait';
    } else {
      // S'assurer que les deux options restent actives (calepinages normaux ET sheds)
      if (modePosePaysageInput) {
        modePosePaysageInput.disabled = false;
      }
      if (modePosePortraitInput) {
        modePosePortraitInput.disabled = false;
      }
      if (paysageLabel) {
        paysageLabel.style.opacity = '1';
        paysageLabel.style.cursor = 'pointer';
      }
      if (portraitLabel) {
        portraitLabel.style.opacity = '1';
        portraitLabel.style.cursor = 'pointer';
      }
      // Sheds : Portrait par défaut à la création, librement modifiable ensuite (Paysage autorisé).
      if (isShedInit) {
        FormHandler.updateModePoseUI(shape.pvId, 'portrait');
        drawingControl.panelOrientation = 'portrait';
      } else if (modePosePortraitInput && modePosePortraitInput.checked) {
        FormHandler.updateModePoseUI(shape.pvId, 'portrait');
        drawingControl.panelOrientation = 'portrait';
      } else if (modePosePaysageInput && modePosePaysageInput.checked) {
        FormHandler.updateModePoseUI(shape.pvId, 'paysage');
        drawingControl.panelOrientation = 'paysage';
      } else {
        FormHandler.updateModePoseUI(shape.pvId, null);
      }
    }

    // NOUVEAU : Verrouiller définitivement le Support PV selon le type de forme dessiné (Séparé pour corriger la régression conditionnelle)
    const supportInclineInput = document.querySelector(`#supportIncline-${shape.pvId}`) || document.getElementById('supportIncline');
    const supportPlatInput = document.querySelector(`#supportPlat-${shape.pvId}`) || document.getElementById('supportPlat');
    const supportShedInput = document.querySelector(`#supportShed-${shape.pvId}`) || document.getElementById('supportShed');
    const supportInclineLabel = document.querySelector(`#supportInclineLabel-${shape.pvId}`) || document.getElementById('supportInclineLabel');
    const supportPlatLabel = document.querySelector(`#supportPlatLabel-${shape.pvId}`) || document.getElementById('supportPlatLabel');
    const supportShedLabel = document.querySelector(`#supportShedLabel-${shape.pvId}`) || document.getElementById('supportShedLabel');

    if (supportInclineInput && supportPlatInput && supportShedInput) {
      if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON || shape.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
        supportPlatInput.disabled = true;
        supportShedInput.disabled = true;
        supportInclineInput.disabled = false;
        supportInclineInput.checked = true;
        if (supportPlatLabel) { supportPlatLabel.style.opacity = '0.5'; supportPlatLabel.style.cursor = 'not-allowed'; }
        if (supportShedLabel) { supportShedLabel.style.opacity = '0.5'; supportShedLabel.style.cursor = 'not-allowed'; }
        if (supportInclineLabel) { supportInclineLabel.style.opacity = '1'; supportInclineLabel.style.cursor = 'pointer'; }
        supportInclineInput.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (shape.type === SHAPE_TYPES.POLYGON) {
        if (shape.shedsCapable) {
          supportInclineInput.disabled = true;
          supportPlatInput.disabled = true;
          supportShedInput.disabled = false;
          supportShedInput.checked = true;
          if (supportInclineLabel) { supportInclineLabel.style.opacity = '0.5'; supportInclineLabel.style.cursor = 'not-allowed'; }
          if (supportPlatLabel) { supportPlatLabel.style.opacity = '0.5'; supportPlatLabel.style.cursor = 'not-allowed'; }
          if (supportShedLabel) { supportShedLabel.style.opacity = '1'; supportShedLabel.style.cursor = 'pointer'; }
          supportShedInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          supportInclineInput.disabled = true;
          supportShedInput.disabled = true;
          supportPlatInput.disabled = false;
          supportPlatInput.checked = true;
          if (supportInclineLabel) { supportInclineLabel.style.opacity = '0.5'; supportInclineLabel.style.cursor = 'not-allowed'; }
          if (supportShedLabel) { supportShedLabel.style.opacity = '0.5'; supportShedLabel.style.cursor = 'not-allowed'; }
          if (supportPlatLabel) { supportPlatLabel.style.opacity = '1'; supportPlatLabel.style.cursor = 'pointer'; }
          supportPlatInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  }

  /**
   * Met à jour les inputs de colonnes et de lignes dans le formulaire
   * @param {string} pvId - Identifiant de la forme
   * @param {number} numCols - Nombre de colonnes
   * @param {number} numRows - Nombre de lignes
   * @param {number} totalPanelLength - Longueur totale en mètres
   * @param {number} totalPanelWidth - Largeur totale en mètres
   */
  static updateFormGridInputs(pvId, numCols, numRows, totalPanelLength, totalPanelWidth) {
    const colonneInput = document.querySelector(`#nbColonne-${pvId}`) || document.getElementById('nbColonne');
    const ligneInput = document.querySelector(`#nbLigne-${pvId}`) || document.getElementById('nbLigne');
    const dimensionsChampPVlongueurInput = document.querySelector(`#dimensionsChampPVlongueur-${pvId}`) || document.getElementById('dimensionsChampPVlongueur');
    const dimensionsChampPVlargeurInput = document.querySelector(`#dimensionsChampPVlargeur-${pvId}`) || document.getElementById('dimensionsChampPVlargeur');

    if (colonneInput && ligneInput && dimensionsChampPVlongueurInput && dimensionsChampPVlargeurInput) {
      // SYNCHRONISATION : Réinitialisation avant calcul
      colonneInput.value = 0;
      ligneInput.value = 0;
      dimensionsChampPVlongueurInput.value = 0;
      dimensionsChampPVlargeurInput.value = 0;

      // Récupérer les vraies dimensions des panneaux depuis le formulaire
      const longueurPanneauInput = document.querySelector(`#longueurPanneau-${pvId}`) || document.getElementById('longueurPanneau');
      const largeurPanneauInput = document.querySelector(`#largeurPanneau-${pvId}`) || document.getElementById('largeurPanneau');
      const portraitInput = document.querySelector(`#modePosePortrait-${pvId}`) || document.getElementById('modePosePortrait');
      const paysageInput = document.querySelector(`#modePosePaysage-${pvId}`) || document.getElementById('modePosePaysage');

      // Valeurs par défaut si les inputs n'existent pas encore
      const baseLongueur = longueurPanneauInput ? parseFloat(longueurPanneauInput.value) / 1000 : 2.0;
      const baseLargeur = largeurPanneauInput ? parseFloat(largeurPanneauInput.value) / 1000 : 1.0;
      let isPortrait = portraitInput ? portraitInput.checked : false;
      let isPaysage = paysageInput ? paysageInput.checked : false;

      const supportShedInput = document.querySelector(`#supportShed-${pvId}`) || document.getElementById('supportShed');
      const isShed = supportShedInput ? supportShedInput.checked : false;
      // Exception "Autres" : pas de pose imposée, l'utilisateur choisit librement Portrait/Paysage.
      const refSIElGrid = document.querySelector(`#referenceSI-${pvId}`) || document.querySelector(`select[id^="referenceSI"]`);
      const isAutresGrid = refSIElGrid ? refSIElGrid.value === 'Autres' : false;

      if (isShed && !isAutresGrid) {
        isPortrait = true;
        isPaysage = false;
      }

      // Appliquer l'orientation pour obtenir les vraies dimensions finales
      let panelLength, panelWidth;
      if (isPortrait) {
        panelLength = baseLargeur;
        panelWidth = baseLongueur;
      } else if (isPaysage) {
        panelLength = baseLongueur;
        panelWidth = baseLargeur;
      } else {
        panelLength = baseLargeur || 1.0;
        panelWidth = baseLongueur || 2.0;
      }

      const typeCouvertureEl = document.querySelector(`#type_de_structure-${pvId}`) || document.querySelector(`select[id^="type_de_structure"]`);
      const typeCouverture = typeCouvertureEl ? typeCouvertureEl.value : null;
      const refSIEl = document.querySelector(`#referenceSI-${pvId}`) || document.querySelector(`select[id^="referenceSI"]`);
      const referenceSI = refSIEl ? refSIEl.value : null;

      const spacingXInput = document.querySelector(`#espacementPanneauxX-${pvId}`) || document.getElementById('espacementPanneauxX');
      const spacingYInput = document.querySelector(`#espacementPanneauxY-${pvId}`) || document.getElementById('espacementPanneauxY');
      const spacingXVal = spacingXInput ? parseFloat(spacingXInput.value) / 1000 : 0.01;
      const spacingYVal = spacingYInput ? parseFloat(spacingYInput.value) / 1000 : 0.01;

      const jointDilatationInput = document.querySelector(`#joint_dilatation-${pvId}`) || document.getElementById('joint_dilatation');
      const limitDilatationInput = document.querySelector(`#limit_dilatation_m-${pvId}`) || document.getElementById('limit_dilatation_m');
      const jointDilatationVal = jointDilatationInput ? parseFloat(jointDilatationInput.value) / 1000 : 0;
      const limitDilatationVal = limitDilatationInput ? parseFloat(limitDilatationInput.value) : 0;

      // Application directe de la source de vérité pour le DOM du Formulaire
      colonneInput.value = numCols;
      ligneInput.value = numRows;
      if (totalPanelLength !== undefined && totalPanelWidth !== undefined) {
        dimensionsChampPVlongueurInput.dataset.baseValue = totalPanelLength;
        dimensionsChampPVlongueurInput.value = totalPanelLength;
        dimensionsChampPVlargeurInput.dataset.baseValue = totalPanelWidth;
        dimensionsChampPVlargeurInput.value = totalPanelWidth;
      }

      // Déclencher les événements change et input
      ['change', 'input'].forEach(eventType => {
        colonneInput.dispatchEvent(new Event(eventType, { bubbles: true }));
        ligneInput.dispatchEvent(new Event(eventType, { bubbles: true }));
        dimensionsChampPVlongueurInput.dispatchEvent(new Event(eventType, { bubbles: true }));
        dimensionsChampPVlargeurInput.dispatchEvent(new Event(eventType, { bubbles: true }));
      });

      // NOUVEAU: Forcer la sauvegarde instantanée dans le storage pour l'initialisation des grilles
      if (window.storageManager && typeof window.storageManager.savePageData === 'function') {
        window.storageManager.savePageData();
      }

      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER, {
        detail: {
          pvId: pvId,
          numCols: numCols,
          numRows: numRows,
          totalPanelLength: totalPanelLength,
          totalPanelWidth: totalPanelWidth,
        },
      }));
    } else {
      console.warn(`Inputs non trouvés pour PV ${pvId}`);
    }
  }

  /**
   * Met à jour les dimensions de la forme dans le formulaire
   * @param {string} pvId - Identifiant de la forme
   * @param {Object} dimensions - Dimensions de la forme
   */
  static updateFormShapeDimensions(shape, pvId, dimensions) {

    // Ne pas mettre à jour les dimensions pour les polygones natifs
    if (shape.type === SHAPE_TYPES.POLYGON) {
      return; // Sortir sans rien faire
    }

    let longueurInput = document.querySelector(`#longueur-${pvId}`) || document.getElementById('longueur');
    let largeurInput = document.querySelector(`#largeur-${pvId}`) || document.getElementById('largeur');

    if (!longueurInput || !largeurInput) {
      // Enregistrer les dimensions dans une propriété temporaire de la forme
      shape._pendingDimensions = dimensions;

      // Réessayer après un délai raisonnable
      setTimeout(() => {
        let retryLongueur = document.querySelector(`#longueur-${pvId}`) || document.getElementById('longueur');
        let retryLargeur = document.querySelector(`#largeur-${pvId}`) || document.getElementById('largeur');

        if (retryLongueur && retryLargeur) {
          // Si le formulaire est prêt, appliquer les dimensions en attente
          const pendingDimensions = shape._pendingDimensions || dimensions;

          retryLongueur.isInternalUpdate = true;
          retryLargeur.isInternalUpdate = true;

          retryLongueur.value = pendingDimensions.length.toFixed(2);
          retryLargeur.value = pendingDimensions.width.toFixed(2);


          // Déclencher les événements de mise à jour
          retryLongueur.dispatchEvent(new Event('change', { bubbles: true }));
          retryLargeur.dispatchEvent(new Event('change', { bubbles: true }));

          retryLongueur.isInternalUpdate = false;
          retryLargeur.isInternalUpdate = false;

          // Nettoyer la propriété temporaire
          delete shape._pendingDimensions;
        } else {
          console.error(`Inputs pour ${pvId} toujours pas disponibles après délai`);
        }
      }, 500);

      return;
    }

    // Si le formulaire existe, mettre à jour directement
    longueurInput.isInternalUpdate = true;
    largeurInput.isInternalUpdate = true;

    longueurInput.value = dimensions.length.toFixed(2);
    largeurInput.value = dimensions.width.toFixed(2);

    // Déclencher les événements
    longueurInput.dispatchEvent(new Event('change', { bubbles: true }));
    largeurInput.dispatchEvent(new Event('change', { bubbles: true }));

    longueurInput.isInternalUpdate = false;
    largeurInput.isInternalUpdate = false;
  }

  /**
   * Met à jour l'interface des boutons de mode de pose (radio et labels)
   * @param {string} pvId - Identifiant de la forme
   * @param {string} orientation - "portrait" ou "paysage"
   */
  static updateModePoseUI(pvId, orientation) {
    const modePosePortraitInput = document.querySelector(`#modePosePortrait-${pvId}`) || document.getElementById('modePosePortrait');
    const modePosePaysageInput = document.querySelector(`#modePosePaysage-${pvId}`) || document.getElementById('modePosePaysage');
    const modePosePortraitLabel = document.querySelector(`#modePosePortraitLabel-${pvId}`) || document.getElementById('modePosePortraitLabel');
    const modePosePaysageLabel = document.querySelector(`#modePosePaysageLabel-${pvId}`) || document.getElementById('modePosePaysageLabel');

    if (modePosePortraitInput && modePosePaysageInput && modePosePortraitLabel && modePosePaysageLabel) {
      if (orientation === 'portrait') {
        modePosePortraitInput.checked = true;
        modePosePaysageInput.checked = false;
        modePosePortraitLabel.style.backgroundColor = "#c7c7c7";
        modePosePaysageLabel.style.backgroundColor = "white";
      } else if (orientation === 'paysage') {
        modePosePortraitInput.checked = false;
        modePosePaysageInput.checked = true;
        modePosePortraitLabel.style.backgroundColor = "white";
        modePosePaysageLabel.style.backgroundColor = "#c7c7c7";
      } else {
        modePosePortraitInput.checked = false;
        modePosePaysageInput.checked = false;
        modePosePortraitLabel.style.backgroundColor = "white";
        modePosePaysageLabel.style.backgroundColor = "white";
      }
    }
  }

  /**
   * Met à jour visuellement la flèche d'azimuth
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {string} pvId - Identifiant de la forme
   * @param {number} azimuth - Nouvel azimuth en degrés
   */
  static updateAzimuthArrow(drawingControl, pvId, azimuth) {
    // Rechercher la flèche d'azimuth dans les labels permanents
    const azimuthLabel = drawingControl.permanentLabels.find(
      label => label.labelId === `${pvId}-azimuth`
    );

    if (azimuthLabel && azimuthLabel.element) {
      // Mettre à jour la rotation de la flèche
      azimuthLabel.element.style.transform = `rotate(${azimuth}deg)`;
    } else {
      console.warn(`Flèche d'azimuth non trouvée pour ${pvId}`);
    }
  }

  /**
   * Vérifie la conformité (Pose et Inclinaison) du projet par rapport au SI
   */
  static checkCompliance(drawingControl, pvId, newPose = null, newSlope = null, newSiId = null) {
    // Le select peut être ciblé avec le fallback racine
    const typeStructureSelect = document.querySelector(`select[name^="type_de_structure"][id$="${pvId}"]`) || document.getElementById(`type_de_structure-${pvId}`) || document.getElementById('type_de_structure');
    const referenceSiSelect = document.querySelector(`select[name^="referenceSI"][id$="${pvId}"]`) || document.getElementById(`referenceSI-${pvId}`) || document.getElementById('referenceSI');
    const portraitInput = document.querySelector(`#modePosePortrait-${pvId}`) || document.getElementById('modePosePortrait');
    const paysageInput = document.querySelector(`#modePosePaysage-${pvId}`) || document.getElementById('modePosePaysage');
    const inclinaisonInput = document.querySelector(`#inclinaison-${pvId}`) || document.getElementById('inclinaison');

    if (!typeStructureSelect || !referenceSiSelect) return true;

    const structureType = typeStructureSelect.value;
    const siId = newSiId || referenceSiSelect.value;

    if (!structureType || !siId) return true;

    const systemsList = TYPE_COUVERTURE_MAP[structureType] || [];
    const siData = systemsList.find(s => s.id === siId);

    if (!siData) return true;

    // 1. Validation de la pose
    let currentPose = newPose;
    if (!currentPose) {
      if (portraitInput && portraitInput.checked) currentPose = 'portrait';
      else if (paysageInput && paysageInput.checked) currentPose = 'paysage';
    }

    if (currentPose) {
      const isPaysage = currentPose === 'paysage';
      const structLower = structureType.toLowerCase();

      if (structLower.includes('ombrière métal') || structLower.includes('ombrière bois')) {
        if (isPaysage) {
          if (siId === 'Mecosun_MVOH' || siId === 'Mecosun_MVUH') {
            drawingControl.errorModal.show("Les panneaux photovoltaïques doivent être posés obligatoirement en portrait.");
            return false;
          } else {
            drawingControl.errorModal.show("Dans le cas d’une ombrière, il est recommandé de poser les panneaux photovoltaïques en portrait. Pour une pose en paysage veuillez valider cette disposition avec le fournisseur du système d’intégration.");
          }
        }
      } else if (structLower.includes('ombrière béton') || structLower.includes('solumbra')) {
        if (isPaysage) {
          drawingControl.errorModal.show("Les panneaux doivent être posés en portrait.");
          return false;
        }
      } else {
        // Bâtiments et autres
        if (siData.pose && siData.pose !== '') {
          let allowedPoses = siData.pose.toLowerCase();

          if (!allowedPoses.includes(currentPose)) {
            drawingControl.errorModal.show(`Le mode de pose du panneau doit être conforme à la certification technique du système d'intégration (Mode de pose autorisé : ${siData.pose}).`);
            return false;
          }
        }
      }
    }

    // 2. Validation de l'inclinaison
    let currentSlope = newSlope !== null ? newSlope : (inclinaisonInput ? parseFloat(inclinaisonInput.value) : NaN);
    if (!isNaN(currentSlope) && siData.pente && siData.pente !== 'NA' && siData.pente !== '') {
      const match = siData.pente.match(/(\d+)-(\d+)°?/);
      if (match) {
        const minP = parseFloat(match[1]);
        const maxP = parseFloat(match[2]);
        if (currentSlope < minP || currentSlope > maxP) {
          drawingControl.errorModal.show(`L’inclinaison n’est pas valide par rapport à la certiication technique du système d’intégration (Inclinaison autorisé: ${siData.pente}).`);
          return false; // Force la remise à la valeur précédente
        }
      }
    }

    return true;
  }

  // ── Validation calepinage ──────────────────────────────────────────────────

  /**
   * Évalue les règles métier calepinage et retourne { kind, message } ou null.
   * Y = finalRows (nombre de panneaux sur le rampant L = nbLigne).
   */
  static _getCalepinageResult(Y, typeCouverture, isPortrait, azimuth) {
    if (!Y || Y <= 0 || Y > 50) return null;
    if (!typeCouverture) return null;

    const type = typeCouverture.toLowerCase();
    const isOmbriere = type.includes('ombrière') || type.includes('ombriere') || type.includes('solumbra');
    if (!isOmbriere) return null;

    const isEO = azimuth > 60 || azimuth < -65;

    // Règle 1 : Ombrière Solumbra
    if (type.includes('solumbra')) {
      if (!((Y === 3 || Y === 4 || Y === 6) && isPortrait)) {
        return {
          kind: 'error',
          message: "Calepinage non conforme pour les modèles d'ombrières Solumbra. " +
                   "Le nombre de panneaux en rampant doit être de 3, 4, ou 6L. " +
                   "De plus, les panneaux doivent être posés en portrait."
        };
      }
      return null;
    }

    // Règle 2 : Ombrière bois
    if (type.includes('bois')) {
      if (!isPortrait) {
        return {
          kind: 'error',
          message: "Calepinage non conforme pour les modèles d'ombrières bois. " +
                   "Les panneaux doivent être posés en portrait."
        };
      }
      if ((Y === 6 || Y === 8) && isEO) return { kind: 'info', message: "Modèle idéal pour votre projet Est-Ouest." };
      if (Y === 3) return { kind: 'info', message: "Modèle idéal pour votre projet : Simple Azélan, Simple Travolta (6m) et Simple Travolta-2 (6m)." };
      if (Y === 4) return { kind: 'info', message: "Modèle idéal pour votre projet : Simple Travolta (6m) et Simple Travolta-2 (6m)." };
      if (Y === 6 || Y === 7) return { kind: 'info', message: "Modèle pour votre projet : Gd. Monopan (12m)." };
      return null;
    }

    // Règle 3 : Ombrière métal
    if (type.includes('métal') || type.includes('metal')) {
      if ([6, 8, 10, 12, 14].includes(Y) && isEO) return { kind: 'info', message: "Modèle idéal pour votre projet Est-Ouest." };
      if (Y === 3 || Y === 4) return { kind: 'info', message: "Modèle idéal pour votre projet : Excentrés." };
      if (Y === 6 || Y === 7) return { kind: 'info', message: "Modèle idéal pour votre projet : Centrés, poteaux inclinés." };
      if (Y === 8 || Y === 15) return { kind: 'info', message: "Modèle idéal : Double poteaux." };
      return null;
    }

    return null;
  }

  /**
   * Affiche la recommandation / erreur calepinage.
   * Erreurs : via ErrorModal (déjà opérationnel).
   * Infos    : overlay discret dans #map.
   */
  static _showCalepinageInfo(result, drawingControl) {
    const MODAL_ID = 'calepinage-validation-modal';

    if (result.kind === 'error') {
      drawingControl.errorModal.show(result.message);
      return;
    }

    // ── Info toast ────────────────────────────────────────────────────────────
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = MODAL_ID;
      Object.assign(modal.style, {
        position: 'absolute', top: '38%', left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: '380px', minWidth: '300px',
        padding: '14px 42px 14px 16px',
        borderRadius: '8px',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        zIndex: '1002',
        fontFamily: 'Arial,sans-serif',
        fontSize: '15px',
        lineHeight: '1.55'
      });

      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&times;';
      Object.assign(closeBtn.style, {
        position: 'absolute', top: '6px', right: '8px',
        background: 'none', border: 'none', fontSize: '18px',
        lineHeight: '1', cursor: 'pointer', padding: '0', opacity: '0.7'
      });
      closeBtn.onclick = () => { modal.style.display = 'none'; };

      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
      header.innerHTML = '<strong style="font-size:16px">ℹ️ Suggestion</strong>';

      const body = document.createElement('p');
      body.id = MODAL_ID + '-body';
      body.style.margin = '0';

      modal.appendChild(closeBtn);
      modal.appendChild(header);
      modal.appendChild(body);

      const mapEl = document.getElementById('map');
      (mapEl || document.body).appendChild(modal);
    }

    Object.assign(modal.style, {
      display: 'block',
      backgroundColor: '#eef6ff',
      borderLeft: '4px solid #0d6efd',
      color: '#083f7c'
    });
    const bodyEl = document.getElementById(MODAL_ID + '-body');
    if (bodyEl) bodyEl.textContent = result.message;

    if (FormHandler._calepTimerId) clearTimeout(FormHandler._calepTimerId);
    FormHandler._calepTimerId = setTimeout(() => { modal.style.display = 'none'; }, 12000); // cette ligne gère le temps d'affichage du modal
  }
}

// Logique globale pour les modales d'informations du système d'intégration
if (typeof window !== 'undefined' && !window.openInfoSystemeModal) {
  window.openInfoSystemeModal = function (e, btn) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!btn || btn.disabled) return;

    const container = btn.closest('.tab-pane') || document.body;
    const modal = document.getElementById('infoSystemeModal');
    let suffix = '';
    if (btn.id && btn.id.includes('-')) {
      suffix = btn.id.substring(btn.id.indexOf('-'));
    }
    const selectStructure = container.querySelector('#type_de_structure' + suffix) || document.getElementById('type_de_structure' + suffix) || document.getElementById('type_de_structure');
    const selectSI = container.querySelector('#referenceSI' + suffix) || document.getElementById('referenceSI' + suffix) || document.getElementById('referenceSI');

    if (!selectStructure || !selectSI || !modal) return;

    const structure = selectStructure.value;
    const refSI = selectSI.value;

    const list = TYPE_COUVERTURE_MAP[structure];
    if (list) {
      const sysData = list.find(item => item.id === refSI || item.label === refSI);
      if (sysData) {
        const setText = (id, text) => {
          const el = modal.querySelector('#' + id);
          if (el) el.textContent = (text !== undefined && text !== 'undefined' && text !== '') ? text : 'N/A';
        };

        setText('info_pose', sysData.pose);
        setText('info_avis', sysData.avis);
        setText('info_broof', sysData.broof);

        const fixContainer = modal.querySelector('#info_fixation_container');
        if (sysData.fixation) {
          if (fixContainer) fixContainer.style.setProperty('display', 'flex', 'important');
          setText('info_fixation', sysData.fixation);
        } else {
          if (fixContainer) fixContainer.style.setProperty('display', 'none', 'important');
        }

        setText('info_dx', sysData.dX !== undefined ? sysData.dX + ' mm' : 'N/A');
        setText('info_dy', sysData.dY !== undefined ? sysData.dY + ' mm' : 'N/A');
        setText('info_zvent', sysData['Z-vent']);
        setText('info_zneige', sysData['Z-Neige']);
        setText('info_altitude', sysData.Altitude !== undefined && sysData.Altitude !== 'NA' ? sysData.Altitude + ' m' : sysData.Altitude || 'N/A');
        setText('info_pente', sysData.pente);

        const toggleLi = (baseId, value, valSuffix) => {
          const li = modal.querySelector('#' + baseId);
          if (li) {
            if (value !== undefined && value !== 'undefined' && value !== '' && value !== 'NA') {
              li.classList.remove('d-none');
              li.style.setProperty('display', 'flex', 'important');
              setText(baseId.replace('li_', ''), value + (valSuffix || ''));
            } else {
              li.classList.add('d-none');
              li.style.setProperty('display', 'none', 'important');
            }
          }
        };

        toggleLi('li_info_pente_terrain_max', sysData.pente_terrain_max, ' %');
        toggleLi('li_info_config_calepinage', sysData.Config_calepinage, '');

        if (modal.parentElement !== document.body) {
          document.body.appendChild(modal);
        }
        modal.style.display = 'flex';
      } else {
        alert("Les informations pour ce système d'intégration ne sont pas disponibles.");
      }
    } else {
      alert("Aucune donnée disponible pour cette structure.");
    }
  };

  document.body.addEventListener('change', function (e) {
    if (e.target.matches('select[name="referenceSI"]') || (e.target.id && e.target.id.startsWith('referenceSI'))) {
      const container = e.target.closest('.tab-pane') || document.body;
      let suffix = '';
      if (e.target.id && e.target.id.includes('-')) {
        suffix = e.target.id.substring(e.target.id.indexOf('-'));
      }

      const btnInfo = container.querySelector('#btnInfoSysteme' + suffix);
      const inputEspX = container.querySelector('#espacementPanneauxX' + suffix) || document.getElementById('espacementPanneauxX');
      const inputEspY = container.querySelector('#espacementPanneauxY' + suffix) || document.getElementById('espacementPanneauxY');
      const val = e.target.value;

      if (btnInfo) {
        if (val && val !== 'Autres') {
          btnInfo.disabled = false;
        } else {
          btnInfo.disabled = true;
        }
      }

      if (val === 'Autres') {
        if (inputEspX) {
          inputEspX.readOnly = false;
          inputEspX.style.backgroundColor = '#ffffff';
          if (!inputEspX.value || inputEspX.value === "0") {
            inputEspX.value = 15;
            inputEspX.dispatchEvent(new Event('input', { bubbles: true }));
            inputEspX.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        if (inputEspY) {
          inputEspY.readOnly = false;
          inputEspY.style.backgroundColor = '#ffffff';
          if (!inputEspY.value || inputEspY.value === "0") {
            inputEspY.value = 15;
            inputEspY.dispatchEvent(new Event('input', { bubbles: true }));
            inputEspY.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      } else {
        if (inputEspX) { inputEspX.readOnly = true; inputEspX.style.backgroundColor = '#e9ecef'; }
        if (inputEspY) { inputEspY.readOnly = true; inputEspY.style.backgroundColor = '#e9ecef'; }

        // Force la mise à jour visuelle des valeurs X et Y selon le système d'intégration choisi (BD)
        const selectStructure = container.querySelector('#type_de_structure' + suffix) || document.getElementById('type_de_structure');
        const typeStructure = selectStructure ? selectStructure.value : null;

        if (typeStructure && val && TYPE_COUVERTURE_MAP && TYPE_COUVERTURE_MAP[typeStructure]) {
          const siData = TYPE_COUVERTURE_MAP[typeStructure].find(s => s.id === val);
          if (siData) {
            if (inputEspX && siData.x !== undefined) {
              inputEspX.value = siData.x;
              inputEspX.dispatchEvent(new Event('input', { bubbles: true }));
              inputEspX.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (inputEspY && siData.y !== undefined) {
              inputEspY.value = siData.y;
              inputEspY.dispatchEvent(new Event('input', { bubbles: true }));
              inputEspY.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
      }
    }

    if (e.target.matches('select[name="type_de_structure"]') || (e.target.id && e.target.id.startsWith('type_de_structure'))) {
      const container = e.target.closest('.tab-pane') || document.body;
      let suffix = '';
      if (e.target.id && e.target.id.includes('-')) {
        suffix = e.target.id.substring(e.target.id.indexOf('-'));
      }
      const btnInfo = container.querySelector('#btnInfoSysteme' + suffix);
      if (btnInfo) {
        btnInfo.disabled = true;
      }
    }
  });
}