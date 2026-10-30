import { MARGIN_COLOR, SHAPE_TYPES, PANEL_DIMENSIONS, STYLES, TYPE_COUVERTURE_MAP, DRAWING_CONSTANTS } from "../constants.js";
import GeometryUtils from "../utils/GeometryUtils.js";
import DeletedPanelsStorage from "../utils/DeletedPanelsStorage.js";

class SolarRectangle {
  constructor(drawingControl) {
    this.drawingControl = drawingControl;

    // Stockage par pvId
    this.createdPanelsByShape = new Map(); // pvId -> panels[]
    this.deletedPanelIndexes = new Map(); // pvId -> Set("i-j")
    this.shapeLifecycleBindings = new Map(); // pvId -> listeners references
    this.boolShowHide = false; // mode suppression/restauration actif
    this.hiddenByToggle = new Set(); // pvId masqués via toggle global
    this.roofOverlaysByShape = new Map(); // pvId -> array of overlays (flèches, faîtage)
  }

  // Gestion du clic du bouton: activer le mode dessin rectangle
  toggleMode(button) {
    const dc = this.drawingControl;
    // Désactiver l'autre mode actif
    if (dc.activeButton && dc.activeButton !== button) {
      dc.activeButton.classList.remove("selected");
      dc.activeButton.style.backgroundColor = dc.STYLES.DEFAULT_BUTTON.backgroundColor;
    }
    if (dc.activeButton === button) {
      if (dc.drawingManager) {
        dc.drawingManager.setDrawingMode(null);
      }
      button.classList.remove("selected");
      button.style.backgroundColor = dc.STYLES.DEFAULT_BUTTON.backgroundColor;
      dc.activeButton = null;
      dc.map.setOptions({ draggableCursor: null });
      return;
    }
    // Activer
    button.classList.add("selected");
    button.style.backgroundColor = dc.STYLES.SELECTED_BUTTON.backgroundColor;
    dc.activeButton = button;
    if (dc.drawingManager) {
      dc.drawingManager.setDrawingMode(google.maps.drawing.OverlayType.RECTANGLE);
    }
    dc.map.setOptions({ draggableCursor: "crosshair" });
  }

  // Appelé depuis EventHandler overlaycomplete pour finaliser le rectangle
  handleSolarRectangleComplete(rectangle) {
    const dc = this.drawingControl;

    // Prendre les coordonnées du rectangle natif Google
    const bounds = rectangle.getBounds();
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    // 4 coins
    const nw = new google.maps.LatLng(ne.lat(), sw.lng());
    const se = new google.maps.LatLng(sw.lat(), ne.lng());
    const points = [nw, ne, se, sw];

    // Restriction géographique (cf. Config.PROJECT_RADIUS_LIMIT_KM) : rejette la forme si elle est
    // dessinée trop loin de l'adresse du projet, même logique que les rejets "trop petit/trop court"
    // déjà en place pour Line/Circle/SimpleRectangle.
    {
      const rejectBounds = new google.maps.LatLngBounds();
      points.forEach(p => rejectBounds.extend(p));
      const compliance = GeometryUtils.checkWithinProjectRadius(rejectBounds.getCenter());
      if (!compliance.allowed) {
        rectangle.setMap(null);
        const msg = `Surface trop éloignée de l'adresse du projet (${compliance.distanceKm.toFixed(2)} km, limite : ${compliance.limitKm} km). Le dessin a été annulé.`;
        if (dc.errorModal) {
          dc.errorModal.show(msg);
        } else {
          alert(msg);
        }
        return;
      }
    }

    // Créer un polygone -- pipeline PV
    const polygon = new google.maps.Polygon({
      paths: points,
      fillColor: dc.STYLES.DEFAULT_SHAPE.fillColor,
      fillOpacity: dc.STYLES.DEFAULT_SHAPE.fillOpacity,
      strokeWeight: dc.STYLES.DEFAULT_SHAPE.strokeWeight,
      strokeColor: dc.STYLES.DEFAULT_SHAPE.strokeColor,
      strokeOpacity: dc.STYLES.DEFAULT_SHAPE.strokeOpacity,
      zIndex: dc.STYLES.DEFAULT_SHAPE.zIndex,
      editable: false,
      draggable: true,
      clickable: true,
      map: dc.map,
    });

    polygon.type = SHAPE_TYPES.SOLAR_RECTANGLE;
    const horizontalSide = google.maps.geometry.spherical.computeDistanceBetween(nw, ne);
    const verticalSide = google.maps.geometry.spherical.computeDistanceBetween(nw, sw);
    const dimensions = SolarRectangle.sortDimensions(horizontalSide, verticalSide);
    polygon._originalDimensions = dimensions;
    if (horizontalSide >= verticalSide) {
      polygon._lengthIndices = [0, 2];
      polygon._widthIndices = [1, 3];
    } else {
      polygon._lengthIndices = [1, 3];
      polygon._widthIndices = [0, 2];
    }

    // Nettoyer le rectangle natif Google
    rectangle.setMap(null);

    const hadPvId = Boolean(polygon.pvId);
    // Ajouter à la collection, config pipeline PV standard
    dc.drawnShapes.push(polygon);
    dc.ShapeHandler.handlePanelShapeComplete(dc, polygon);
    if (!hadPvId) {
      this.initializeDeletedIndicesForShape(polygon.pvId);
    }
    dc.ShapeHandler.setupShapeListeners(dc, polygon);
    this.bindShapeLifecycle(polygon);

    // Créer les panneaux solaires automatiquement
    this.createSolarPanels(polygon);

    // Calculer et mettre à jour les inputs du formulaire après création
    setTimeout(() => {
      this.calculateAndUpdatePanelInputs(polygon);
    }, 600);

    return polygon;
  }

  setupRectangleListeners(rectangle) {
    // Écouter les modifications du rectangle pour mettre à jour le formulaire
    google.maps.event.addListener(rectangle, 'bounds_changed', () => {
      const bounds = rectangle.getBounds();
      const width = GeometryUtils.calculateWidth(bounds);
      const height = GeometryUtils.calculateLength(bounds);

      // Mettre à jour le formulaire avec les nouvelles dimensions
      const longueurInput = document.querySelector(`#longueur-${rectangle.pvId}`);
      const largeurInput = document.querySelector(`#largeur-${rectangle.pvId}`);

      if (longueurInput && largeurInput) {
        longueurInput.isInternalUpdate = true;
        largeurInput.isInternalUpdate = true;

        longueurInput.value = width.toFixed(2);
        largeurInput.value = height.toFixed(2);

        longueurInput.isInternalUpdate = false;
        largeurInput.isInternalUpdate = false;

        // Déclencher les événements pour mettre à jour les panneaux
        longueurInput.dispatchEvent(new Event('change', { bubbles: true }));
        largeurInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Mettre à jour les panneaux
      this.refreshPanelsForShape(rectangle.pvId);
    });
  }

  // Nettoyer les panneaux orphelins pour un pvId donné
  cleanupOrphanedPanels(pvId) {
    if (!this.drawingControl || !this.drawingControl.map) return;

    // Parcourir tous les overlays de la carte pour trouver les panneaux orphelins
    // Note: Google Maps ne fournit pas d'API directe pour lister tous les overlays,
    // donc on nettoie uniquement ceux qui sont dans createdPanelsByShape mais qui
    // ne sont plus référencés correctement
    if (this.createdPanelsByShape.has(pvId)) {
      const panels = this.createdPanelsByShape.get(pvId);
      const validPanels = panels.filter(panel => {
        // Vérifier si le panneau a toujours le bon parentPolygon
        if (!panel.parentPolygon || !panel.parentPolygon.pvId || panel.parentPolygon.pvId !== pvId) {
          panel.setMap(null);
          return false;
        }
        return true;
      });
      this.createdPanelsByShape.set(pvId, validPanels);
    }
  }

  // Création des panneaux (similaire LineToPolygon mais rectangle parfait)
  createSolarPanels(mainPolygon) {
    const dc = this.drawingControl;
    const path = mainPolygon.getPath();

    // 4 coins, l'ordre est crucial
    const corner1 = path.getAt(0);
    const corner2 = path.getAt(1);
    const corner3 = path.getAt(2);
    const corner4 = path.getAt(3);

    // Récupérer la configuration actuelle des panneaux depuis le formulaire
    const pvId = mainPolygon.pvId;

    // Nettoyer les panneaux existants avant de créer de nouveaux
    if (this.createdPanelsByShape.has(pvId)) {
      const existingPanels = this.createdPanelsByShape.get(pvId);
      existingPanels.forEach(panel => panel.setMap(null));
      this.createdPanelsByShape.delete(pvId);
    }

    // Nettoyer les panneaux orphelins
    this.cleanupOrphanedPanels(pvId);

    // CORRECTIF (crash navigateur sur grande surface) : au-delà de MAX_SHAPE_AREA_M2, les boucles
    // imbriquées ci-dessous peuvent générer des milliers de google.maps.Polygon (un par panneau,
    // chacun avec son propre listener) et geler le navigateur. Vérification AVANT toute génération
    // (les anciens panneaux viennent d'être nettoyés ci-dessus, donc rien n'est laissé orphelin).
    const areaM2 = GeometryUtils.calculateArea(path.getArray());
    if (areaM2 > DRAWING_CONSTANTS.MAX_SHAPE_AREA_M2) {
      const msg = `Surface trop vaste (${Math.round(areaM2)} m², limite : ${DRAWING_CONSTANTS.MAX_SHAPE_AREA_M2} m²). Réduisez la taille de la forme avant de continuer.`;
      if (dc.errorModal) { dc.errorModal.show(msg); } else { alert(msg); }
      this.createdPanelsByShape.set(pvId, []);
      return;
    }

    const panelConfig = this.getPanelConfigFromForm(pvId);
    const deletedIndexes = this.getDeletedIndexSet(pvId);
    const isHiddenByToggle = this.hiddenByToggle.has(pvId);

    // Longueur = c1-c2 ; largeur = c2-c3
    const mainLength = google.maps.geometry.spherical.computeDistanceBetween(corner1, corner2);
    const mainWidth = google.maps.geometry.spherical.computeDistanceBetween(corner2, corner3);
    const heading = google.maps.geometry.spherical.computeHeading(corner1, corner2);
    const headingToCorner4 = google.maps.geometry.spherical.computeHeading(corner1, corner4);
    let angleDiff = headingToCorner4 - heading;
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;
    const perpHeading = angleDiff > 0 ? heading + 90 : heading - 90;

    // Prendre en compte la rotation panneaux
    const panelsRotation = mainPolygon.panelsRotation || 0;
    const angleRad = Math.abs(panelsRotation) * Math.PI / 180;
    const effLen = Math.abs(panelConfig.length * Math.cos(angleRad)) + Math.abs(panelConfig.width * Math.sin(angleRad));
    const effWid = Math.abs(panelConfig.length * Math.sin(angleRad)) + Math.abs(panelConfig.width * Math.cos(angleRad));

    const margin = panelConfig.margin || 0;
    const availableLength = Math.max(0, mainLength - 2 * margin);
    const availableWidth = Math.max(0, mainWidth - 2 * margin);

    // Désactiver sheds si la forme n'est pas compatible
    if (!mainPolygon.shedsCapable) {
      panelConfig.shedsEnabled = false;
    }

    // NOUVEAU: Extraction des deltas (dX, dY), Pentes et Joints de Dilatation pour la projection 3D
    const typeCouvertureEl = document.querySelector(`#type_de_structure-${pvId}`) || document.querySelector(`select[id^="type_de_structure"]`);
    const referenceSIEl = document.querySelector(`#referenceSI-${pvId}`) || document.querySelector(`select[id^="referenceSI"]`);
    const typeCouverture = typeCouvertureEl ? typeCouvertureEl.value : null;
    const referenceSI = referenceSIEl ? referenceSIEl.value : null;
    let dX = 0, dY = 0;
    if (typeCouverture && referenceSI && TYPE_COUVERTURE_MAP && TYPE_COUVERTURE_MAP[typeCouverture]) {
      const siData = TYPE_COUVERTURE_MAP[typeCouverture].find(s => s.id === referenceSI);
      if (siData) {
        const pdX = parseFloat(siData.dX);
        const pdY = parseFloat(siData.dY);
        dX = !isNaN(pdX) ? pdX / 1000 : 0;
        dY = !isNaN(pdY) ? pdY / 1000 : 0;
        // Synchronisation dynamique
        if (siData.x !== undefined && !isNaN(parseFloat(siData.x))) panelConfig.spacingX = parseFloat(siData.x) / 1000;
        if (siData.y !== undefined && !isNaN(parseFloat(siData.y))) panelConfig.spacingY = parseFloat(siData.y) / 1000;
      }
    }

    const jointDilatationInput = document.querySelector(`#joint_dilatation-${pvId}`);
    const limitDilatationInput = document.querySelector(`#limit_dilatation_m-${pvId}`);
    const jVal = jointDilatationInput ? parseFloat(jointDilatationInput.value) : NaN;
    const jointDilatationVal = !isNaN(jVal) ? jVal / 1000 : 0;
    const lVal = limitDilatationInput ? parseFloat(limitDilatationInput.value) : NaN;
    const limitDilatationVal = !isNaN(lVal) ? lVal : 0;

    const penteTypeSelect = document.querySelector(`#toiture_pente_type-${pvId}`) || document.getElementById('toiture_pente_type');
    const penteType = penteTypeSelect ? penteTypeSelect.value : 'Monopente';
    const pente1Input = document.querySelector(`#pente-${pvId}`) || document.getElementById('pente') || document.querySelector(`#inclinaison-${pvId}`) || document.getElementById('inclinaison');
    const p1Val = pente1Input ? parseFloat(pente1Input.value) : NaN;
    let pente1 = !isNaN(p1Val) ? p1Val : 0;
    const pente2Input = document.querySelector(`#pente2-${pvId}`) || document.getElementById('pente2');
    const p2Val = pente2Input ? parseFloat(pente2Input.value) : NaN;
    let pente2 = !isNaN(p2Val) ? p2Val : pente1;

    const isFlat = typeCouverture === 'Toiture terasse' || typeCouverture === 'Petit champ solaire';
    if (isFlat) {
      const tiltInput = document.querySelector(`#inclinaison-top-${pvId}`) || document.getElementById('inclinaison-top') || document.querySelector(`#inclinaison-${pvId}`) || document.getElementById('inclinaison');
      const panelTilt = tiltInput ? parseFloat(tiltInput.value) || 0 : 0;
      pente1 = panelTilt;
      pente2 = panelTilt;
    }
    const asymInput = document.querySelector(`#asymetrie_percent-${pvId}`) || document.getElementById('asymetrie_percent');
    const aVal = asymInput ? parseFloat(asymInput.value) : NaN;
    const asymetrie = !isNaN(aVal) ? aVal / 100 : 0.4;
    const faitageInput = document.querySelector(`#largeur_faitage_mm-${pvId}`) || document.getElementById('largeur_faitage_mm');
    const fVal = faitageInput ? parseFloat(faitageInput.value) : NaN;
    const faitageBuffer = !isNaN(fVal) ? fVal / 1000 : 0.5;

    const lengthIndices = mainPolygon._lengthIndices || [0, 2];
    const indicesInverted = !(lengthIndices.includes(0) && lengthIndices.includes(2));
    let panelLength = panelConfig.length;
    let panelWidth = panelConfig.width;
    let spacingX = panelConfig.spacingX;
    let spacingY = panelConfig.spacingY;

    if (indicesInverted && panelLength > 0 && panelWidth > 0) {
      panelLength = panelConfig.width;
      panelWidth = panelConfig.length;
      spacingX = panelConfig.spacingY;
      spacingY = panelConfig.spacingX;
      let tempD = dX; dX = dY; dY = tempD;
    }

    const computeOffsets = (available, effSize, spacing, startMargin, endMargin, limitDil, jointDil) => {
      let usable = available - startMargin - endMargin;
      if (limitDil > 0) usable -= Math.floor(usable / limitDil) * jointDil;
      usable = Math.max(0, usable);
      const count = Math.floor((usable + spacing) / (effSize + spacing));
      const used = count > 0 ? count * effSize + (count - 1) * spacing : 0;
      const startOff = startMargin + (usable - used) / 2;
      const offsets = [];
      for (let i = 0; i < count; i++) {
        let offset = startOff + i * (effSize + spacing) + effSize / 2;
        if (limitDil > 0) offset += Math.floor(offset / limitDil) * jointDil;
        offsets.push(offset);
      }
      return { count, offsets };
    };

    let centersLen = [];
    let allWidthOffsets = [];

    if (panelConfig.shedsEnabled) {

      let shedsCosSlope = 1;
      if (isFlat) {
        shedsCosSlope = Math.max(Math.cos(pente1 * Math.PI / 180), 0.1);
      }

      const buildOffsets = (available, effSize, spacing, groupSize, groupSpacing) => {
        const offsets = [];
        let cursor = 0;
        let idx = 0;
        while (true) {
          if (cursor + effSize > available + 0.001) break;
          offsets.push(cursor + effSize / 2);
          idx += 1;
          const isGroupBoundary = groupSize > 0 && idx % groupSize === 0;
          cursor += effSize + spacing + (isGroupBoundary ? groupSpacing : 0);
        }
        return offsets;
      };
      centersLen = buildOffsets(availableLength, effLen, panelConfig.spacingX, panelConfig.shedsRows, panelConfig.shedsRowSpacing);
      const centersWid = buildOffsets(availableWidth / shedsCosSlope, effWid, panelConfig.spacingY, panelConfig.shedsCols, panelConfig.shedsColSpacing);
      const usedLen = centersLen.length > 0
        ? (centersLen.length * effLen +
          (centersLen.length - 1) * panelConfig.spacingX +
          Math.max(
            0,
            Math.floor(centersLen.length / Math.max(1, panelConfig.shedsRows)) -
            (centersLen.length % Math.max(1, panelConfig.shedsRows) === 0 ? 1 : 0)
          ) * panelConfig.shedsRowSpacing)
        : 0;
      const usedWid = centersWid.length > 0
        ? (centersWid.length * effWid +
          (centersWid.length - 1) * panelConfig.spacingY +
          Math.max(
            0,
            Math.floor(centersWid.length / Math.max(1, panelConfig.shedsCols)) -
            (centersWid.length % Math.max(1, panelConfig.shedsCols) === 0 ? 1 : 0)
          ) * panelConfig.shedsColSpacing)
        : 0;
      const startLen = margin + (availableLength - usedLen) / 2;
      const startWid = margin + (availableWidth - usedWid * shedsCosSlope) / 2;
      centersLen = centersLen.map(c => c + startLen);
      allWidthOffsets = centersWid.map(c => ({ offset: (c * shedsCosSlope) + startWid, cosSlope: shedsCosSlope, panIndex: 1 }));
    } else {
      const effMarginLen = margin + dX / 2;
      const lengthData = computeOffsets(mainLength, effLen, panelConfig.spacingX, effMarginLen, effMarginLen, limitDilatationVal, jointDilatationVal);
      centersLen = lengthData.offsets;

      const centersWidthByPan = [];
      const pans = [];
      if (penteType === 'Monopente') pans.push({ startFrac: 0, endFrac: 1, slope: pente1, startIsEave: true, endIsEave: true });
      else if (penteType === 'Bipente_symetrique') { pans.push({ startFrac: 0, endFrac: 0.5, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: 0.5, endFrac: 1, slope: pente1, startIsEave: false, endIsEave: true }); }
      else if (penteType === 'Bipente_asymetrique') { pans.push({ startFrac: 0, endFrac: asymetrie, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: asymetrie, endFrac: 1, slope: pente2, startIsEave: false, endIsEave: true }); }
      else if (penteType === 'Multipente') { pans.push({ startFrac: 0, endFrac: 0.25, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: 0.25, endFrac: 0.5, slope: pente1, startIsEave: false, endIsEave: false }); pans.push({ startFrac: 0.5, endFrac: 0.75, slope: pente1, startIsEave: false, endIsEave: false }); pans.push({ startFrac: 0.75, endFrac: 1, slope: pente1, startIsEave: false, endIsEave: true }); }

      pans.forEach((pan, idx) => {
        const panProjectedWidth = mainWidth * (pan.endFrac - pan.startFrac);
        const cosSlope = Math.max(Math.cos(pan.slope * Math.PI / 180), 0.1);

        let panRealWidth, currentEffWid, actualCosSlopeForProjection;
        if (isFlat) { // Pente toiture = 0°
          panRealWidth = panProjectedWidth;
          currentEffWid = effWid * cosSlope;
          actualCosSlopeForProjection = 1;
        } else { // Pente toiture > 0°
          panRealWidth = panProjectedWidth / cosSlope;
          currentEffWid = effWid;
          actualCosSlopeForProjection = cosSlope;
        }

        const startMargin = pan.startIsEave ? (margin + dY / 2) : (faitageBuffer / 2);
        const endMargin = pan.endIsEave ? (margin + dY / 2) : (faitageBuffer / 2);
        const panData = computeOffsets(panRealWidth, currentEffWid, panelConfig.spacingY, startMargin, endMargin, limitDilatationVal, jointDilatationVal);
        const projectedOffsets = panData.offsets.map(rOff => rOff * actualCosSlopeForProjection);
        const panStartProjectedOffset = mainWidth * pan.startFrac;
        const finalProjectedOffsets = projectedOffsets.map(pOff => panStartProjectedOffset + pOff);
        centersWidthByPan.push({ panIndex: idx + 1, offsets: finalProjectedOffsets, cosSlope: cosSlope });
      });

      centersWidthByPan.forEach(pan => {
        pan.offsets.forEach(off => allWidthOffsets.push({ offset: off, cosSlope: pan.cosSlope, panIndex: pan.panIndex }));
      });
    }

    const panels = [];


    // Créer un polygone pour visualiser la marge intérieure
    if (margin > 0 && centersLen.length > 0 && allWidthOffsets.length > 0) {
      // Calculer les positions des bords RÉELS des panneaux externes
      const firstPanelCenterLen = centersLen[0];
      const lastPanelCenterLen = centersLen[centersLen.length - 1];
      const firstPanelCenterWid = allWidthOffsets[0].offset;
      const lastPanelCenterWid = allWidthOffsets[allWidthOffsets.length - 1].offset;

      // Distance du bord du rectangle au bord du premier/dernier panneau + offset visuel
      const actualMarginStartLength = firstPanelCenterLen - (effLen / 2) - PANEL_DIMENSIONS.MARGIN_VISUAL_OFFSET;
      const actualMarginEndLength = mainLength - (lastPanelCenterLen + effLen / 2) - PANEL_DIMENSIONS.MARGIN_VISUAL_OFFSET;
      const actualMarginStartWidth = firstPanelCenterWid - (effWid * allWidthOffsets[0].cosSlope / 2) - PANEL_DIMENSIONS.MARGIN_VISUAL_OFFSET;
      const actualMarginEndWidth = mainWidth - (lastPanelCenterWid + effWid * allWidthOffsets[allWidthOffsets.length - 1].cosSlope / 2) - PANEL_DIMENSIONS.MARGIN_VISUAL_OFFSET;

      // Coins du rectangle intérieur (bords des panneaux externes)
      const innerCorner1 = google.maps.geometry.spherical.computeOffset(
        google.maps.geometry.spherical.computeOffset(corner1, Math.max(0, actualMarginStartLength), heading),
        Math.max(0, actualMarginStartWidth),
        perpHeading
      );
      const innerCorner2 = google.maps.geometry.spherical.computeOffset(
        google.maps.geometry.spherical.computeOffset(corner1, Math.max(0, mainLength - actualMarginEndLength), heading),
        Math.max(0, actualMarginStartWidth),
        perpHeading
      );
      const innerCorner3 = google.maps.geometry.spherical.computeOffset(
        google.maps.geometry.spherical.computeOffset(corner1, Math.max(0, mainLength - actualMarginEndLength), heading),
        Math.max(0, mainWidth - actualMarginEndWidth),
        perpHeading
      );
      const innerCorner4 = google.maps.geometry.spherical.computeOffset(
        google.maps.geometry.spherical.computeOffset(corner1, Math.max(0, actualMarginStartLength), heading),
        Math.max(0, mainWidth - actualMarginEndWidth),
        perpHeading
      );

      // Créer le polygone de la marge (zone orange entre le rectangle principal et les bords des panneaux)
      const marginPolygon = new google.maps.Polygon({
        paths: [
          // Contour extérieur (rectangle principal)
          [corner1, corner2, corner3, corner4],
          // Contour intérieur (bords des panneaux externes) - dans le sens inverse pour créer un "trou"
          [innerCorner1, innerCorner4, innerCorner3, innerCorner2]
        ],
        fillColor: MARGIN_COLOR,
        fillOpacity: 0.3,
        strokeWeight: 0,
        zIndex: 1000,
        map: dc.map,
        clickable: false
      });

      // Marquer comme élément de marge et l'associer au polygon parent
      marginPolygon.isMarginVisual = true;
      marginPolygon.parentPolygon = mainPolygon;

      // L'ajouter à la liste panels pour qu'il soit supprimé lors du nettoyage
      panels.push(marginPolygon);
    }


    for (let i = 0; i < centersLen.length; i++) {
      for (let j = 0; j < allWidthOffsets.length; j++) {
        const idx = `${i}-${j}`;
        if (deletedIndexes.has(idx)) continue;

        const lenOffset = centersLen[i];
        const widthData = allWidthOffsets[j];
        const widOffsetProj = widthData.offset;
        const cosSlope = widthData.cosSlope;

        const center = google.maps.geometry.spherical.computeOffset(
          google.maps.geometry.spherical.computeOffset(corner1, lenOffset, heading),
          widOffsetProj,
          perpHeading
        );

        const halfLen = panelLength / 2;
        const halfWid = panelWidth / 2;
        const localCorners = [
          { x: -halfLen, y: -halfWid },
          { x: halfLen, y: -halfWid },
          { x: halfLen, y: halfWid },
          { x: -halfLen, y: halfWid }
        ];

        const corners = localCorners.map(c => {
          const rad = angleRad;
          const xRot = c.x * Math.cos(rad) - c.y * Math.sin(rad);
          const yRot = c.x * Math.sin(rad) + c.y * Math.cos(rad);
          const yProj = yRot * cosSlope;
          return google.maps.geometry.spherical.computeOffset(
            google.maps.geometry.spherical.computeOffset(center, xRot, heading),
            yProj,
            perpHeading
          );
        });

        const panel = new google.maps.Polygon({
          paths: corners,
          fillColor: "#1A1A1A",
          fillOpacity: 0.5,
          strokeWeight: 1,
          strokeColor: "#1A1A1A",
          strokeOpacity: 0.8,
          zIndex: 1001,
          map: isHiddenByToggle ? null : dc.map,
          // CORRECTIF (bug rapporté : "impossible de sélectionner/déplacer la géométrie une fois les
          // panneaux ajoutés") : un panneau clickable:true intercepte TOUS les évènements souris
          // (click ET mousedown, donc aussi l'amorce d'un glissé natif) de la zone qu'il recouvre —
          // seul le mode suppression/restauration (boolShowHide, cf. son propre listener 'click'
          // juste en dessous) a réellement besoin que les panneaux soient cliquables ; sinon,
          // clickable:false les rend transparents aux évènements souris (même principe déjà utilisé
          // par ShedPolygon.js) et laisse le clic/glissé atteindre le rectangle parent en dessous.
          // Réajusté en direct sur tous les panneaux existants par toggleBoolShowHide() ci-dessous.
          clickable: this.boolShowHide,
        });
        panel.isPanelSolaire = true;
        panel.parentPolygon = mainPolygon;
        panel.panelIndex = idx;
        google.maps.event.addListener(panel, "click", () => {
          if (this.boolShowHide) this.removeSolarPanel(panel);
        });
        panels.push(panel);
      }
    }

    mainPolygon._calculatedPanelsLength = centersLen.length;
    mainPolygon._calculatedPanelsWidth = allWidthOffsets.length;

    // Contrôle strict de la puissance maximale de licence (+ tolérance configurable)
    let pPanneauW = 400;
    try {
      const pInput = document.querySelector(`#puissancePanneau-${pvId}`) || document.getElementById('puissancePanneau');
      if (pInput && parseFloat(pInput.value) > 0) {
        pPanneauW = parseFloat(pInput.value);
      }
    } catch (_) {}

    const shapeKwc = (panels.length * pPanneauW) / 1000.0;
    let otherShapesKwc = 0;
    try {
      const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
      if (savedData.shapes) {
        Object.keys(savedData.shapes).forEach(id => {
          if (id !== pvId && savedData.shapes[id]?.gridInfo) {
            const count = Number(savedData.shapes[id].gridInfo.totalPanels || 0);
            const p = Number(savedData.formData?.[id]?.puissancePanneau || 400);
            otherShapesKwc += (count * p) / 1000.0;
          }
        });
      }
    } catch (_) {}

    const totalProjectedKwc = otherShapesKwc + shapeKwc;
    if (typeof window.checkPowerLicenceCompliance === 'function') {
      const compliance = window.checkPowerLicenceCompliance(totalProjectedKwc);
      if (!compliance.allowed) {
        // Bloquer immédiatement le calcul du calepinage
        // Ne rien afficher du tout (pas de résultats / indicateurs)
        // Supprimer / annuler la géométrie et les panneaux sur la carte
        panels.forEach(p => { if (p && typeof p.setMap === 'function') p.setMap(null); });
        this.createdPanelsByShape.delete(pvId);
        mainPolygon.setMap(null);
        if (dc.drawnShapes) {
          const idx = dc.drawnShapes.indexOf(mainPolygon);
          if (idx > -1) dc.drawnShapes.splice(idx, 1);
        }
        if (dc.usedIds) dc.usedIds.delete(pvId);

        // Figer / désactiver le bouton « Calculer et visualiser »
        if (typeof window.setCalculerVisualiserDisabled === 'function') {
          window.setCalculerVisualiserDisabled(true, compliance.message);
        }

        const msg = `${compliance.message}\nLe calepinage et le tracé ont été annulés.`;
        if (dc.errorModal) {
          dc.errorModal.show(msg);
        } else {
          alert(msg);
        }
        return;
      }
    }

    this.createdPanelsByShape.set(pvId, panels);
    setTimeout(() => { this.calculateAndUpdatePanelInputs(mainPolygon); }, 150);

    // Réappliquer le masquage obstacle après création
    if (this.drawingControl.obstaclePanels) {
      this.drawingControl.obstaclePanels.requestRefresh();
    }

    // Mettre à jour et dessiner les éléments visuels de toiture
    this.updateRoofVisuals(mainPolygon);

    // Mettre à jour l'ancrage et dessiner les axes de poteaux si activé
    this.updatePostAxes(mainPolygon);
  }

  /**
   * Met à jour l'ancrage et les poteaux associés à la forme
   * @param {google.maps.Polygon} polygon - Le rectangle principal
   */
  updatePostAxes(polygon) {
    if (!window.postAxesManager) return;

    const pvId = polygon.pvId;
    const path = polygon.getPath();
    if (!path || path.getLength() < 4) return;

    const lengthIndices = polygon._lengthIndices || [0, 2];
    let coords = [path.getAt(0), path.getAt(1), path.getAt(2), path.getAt(3)];

    // Assure l'ordre : Vector X (Longueur) = [0] -> [1], Vector Y (Largeur) = [0] -> [3]
    if (!lengthIndices.includes(0)) {
      coords = [path.getAt(1), path.getAt(2), path.getAt(3), path.getAt(0)];
    }

    const rf = { id: pvId, coords: coords };
    const typeCouvertureEl = document.querySelector(`#type_de_structure-${pvId}`) || document.querySelector(`select[id^="type_de_structure"]`);
    const config = {
      type_de_structure: typeCouvertureEl ? typeCouvertureEl.value.toLowerCase() : ''
    };

    if (config.type_de_structure.includes('ombrière') || config.type_de_structure.includes('bâtiment incliné')) {
      window.postAxesManager.updateHandle(rf, config);
      window.postAxesManager.drawPosts(rf, config);
    } else {
      window.postAxesManager.removeHandle(pvId);
    }
  }


  /**

   * Dessine et met à jour les indicateurs visuels du toit (faîtage, noue, flèches d'orientation)
   */
  async updateRoofVisuals(polygon) {
    const pvId = polygon.pvId;
    const dc = this.drawingControl;

    if (!dc.AdvancedMarkerElement) {
      const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
      dc.AdvancedMarkerElement = AdvancedMarkerElement;
    }

    // Nettoyage sécurisé via le Map
    if (this.roofOverlaysByShape.has(pvId)) {
      this.roofOverlaysByShape.get(pvId).forEach(overlay => {
        if (typeof overlay.setMap === 'function') overlay.setMap(null);
      });
    }
    const overlays = [];
    this.roofOverlaysByShape.set(pvId, overlays);

    if (polygon.roofOverlays) {
      polygon.roofOverlays.forEach(overlay => {
        if (typeof overlay.setMap === 'function') overlay.setMap(null);
      });
    }
    polygon.roofOverlays = overlays; // Pour compatibilité

    const penteTypeSelect = document.querySelector(`#toiture_pente_type-${pvId}`) || document.getElementById('toiture_pente_type');
    const penteType = penteTypeSelect ? penteTypeSelect.value : 'Monopente';

    const asymInput = document.querySelector(`#asymetrie_percent-${pvId}`) || document.getElementById('asymetrie_percent');
    const aVal = asymInput ? parseFloat(asymInput.value) : NaN;
    const asymetrie = !isNaN(aVal) ? aVal / 100 : 0.4;

    const path = polygon.getPath();
    if (path.getLength() < 4) return;

    const c0 = path.getAt(0), c1 = path.getAt(1), c3 = path.getAt(3);
    const lengthIndices = polygon._lengthIndices || [0, 2];
    const is01Length = lengthIndices.includes(0);

    const h01 = google.maps.geometry.spherical.computeHeading(c0, c1);
    const h03 = google.maps.geometry.spherical.computeHeading(c0, c3);
    const d01 = google.maps.geometry.spherical.computeDistanceBetween(c0, c1);
    const d03 = google.maps.geometry.spherical.computeDistanceBetween(c0, c3);

    let hLen, hWid, len, wid;
    if (is01Length) {
      hLen = h01; hWid = h03; len = d01; wid = d03;
    } else {
      hLen = h03; hWid = h01; len = d03; wid = d01;
    }

    const geometryHWid = hWid; // On mémorise l'angle pour centrer l'élément DANS la géométrie

    if (polygon.isAzimuthFlipped) {
      hWid = (hWid + 180) % 360;
    }

    // Centrage dynamique selon les panneaux générés
    const getCenterForPan = (panIndex, fallbackCenter) => {
      const panels = this.createdPanelsByShape.get(pvId) || [];
      const panPanels = panels.filter(p => p.panIndex === panIndex && p.isPanelSolaire);
      if (panPanels.length > 0) {
        const bounds = new google.maps.LatLngBounds();
        panPanels.forEach(p => {
          if (p.getPath) p.getPath().forEach(pt => bounds.extend(pt));
        });
        return bounds.getCenter();
      }
      return fallbackCenter;
    };

    const addLine = (p1, p2, color, isDraggable = false) => {
      const line = new google.maps.Polyline({
        path: [p1, p2], strokeColor: color, strokeWeight: 4, zIndex: 1005, map: dc.map, draggable: isDraggable
      });
      overlays.push(line);
      return line;
    };

    const addLabelAndArrow = (pos, text, azimuth, rotateText180 = false) => {
      if (!dc.AdvancedMarkerElement) return;
      const visualAzimuth = azimuth + 180;
      const textAzimuth = rotateText180 ? visualAzimuth + 180 : visualAzimuth;
      const textY = rotateText180 ? 15 : -15;

      const containerDiv = document.createElement("div");
      containerDiv.style.cssText = `position: absolute; display: flex; align-items: center; justify-content: center; pointer-events: none; overflow: visible;`;

      const labelDiv = document.createElement("div");
      const baseStyle = (STYLES && STYLES.MEASUREMENT_LABEL) ? STYLES.MEASUREMENT_LABEL : "background-color: white; border: 1px solid #1A73E8; color: #333;";
      labelDiv.style.cssText = `${baseStyle} position: absolute; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.3); z-index: 1010; white-space: nowrap; transform: translate(-50%, -50%) rotate(${textAzimuth}deg) translateY(${textY}px);`;
      labelDiv.textContent = text;

      const arrowDiv = document.createElement("div");
      arrowDiv.style.cssText = `position: absolute; transform-origin: center center; transform: translate(-50%, -50%) rotate(${visualAzimuth}deg) translateY(12px); width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;`;
      arrowDiv.innerHTML = `<img src="/static/concevoir_mon_projet/medias/icons/arrow.svg" style="width:100%; height:100%; opacity:0.8;">`;

      containerDiv.appendChild(labelDiv);
      containerDiv.appendChild(arrowDiv);

      try {
        const marker = new dc.AdvancedMarkerElement({ map: dc.map, position: pos, content: containerDiv, zIndex: 10000 });
        overlays.push({ setMap: (m) => { marker.map = m; }, marker: marker });
      } catch (err) {
        console.error("Erreur ajout visuels toiture (SolarRectangle):", err);
      }
    };

    const setAzimuth = (idx, val) => {
      const inputId = idx === 1 ? `#azimuth-${pvId}` : `#azimuth${idx}-${pvId}`;
      let input = document.querySelector(inputId) || document.getElementById(idx === 1 ? 'azimuth' : `azimuth${idx}`);
      if (input) {
        let pvgisAzimuth = val - 180;
        let normVal = Math.round(pvgisAzimuth);
        if (normVal <= -180) normVal += 360;
        if (normVal > 180) normVal -= 360;

        input.value = normVal;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };

    if (penteType === 'Monopente') {
      const pvCenter = google.maps.geometry.spherical.computeOffset(google.maps.geometry.spherical.computeOffset(c0, wid * 0.5, geometryHWid), len * 0.5, hLen);
      addLabelAndArrow(pvCenter, pvId, hWid + 180);
      setAzimuth(1, hWid + 180);
    } else if (penteType === 'Bipente_symetrique' || penteType === 'Bipente_asymetrique') {
      const asymRatio = penteType === 'Bipente_asymetrique' ? asymetrie : 0.5;
      const ridgeStart = google.maps.geometry.spherical.computeOffset(c0, wid * asymRatio, geometryHWid);
      const ridgeEnd = google.maps.geometry.spherical.computeOffset(ridgeStart, len, hLen);

      if (penteType === 'Bipente_asymetrique') {
        const p1 = google.maps.geometry.spherical.computeOffset(ridgeStart, 1, hLen + 180);
        const p2 = google.maps.geometry.spherical.computeOffset(ridgeEnd, 1, hLen);
        const line = addLine(p1, p2, '#FF0000', true); // Faîtage déplaçable

        google.maps.event.addListener(line, 'drag', () => {
          const newPos = line.getPath().getAt(0);
          const distToStart = google.maps.geometry.spherical.computeDistanceBetween(c0, newPos);
          const headToStart = google.maps.geometry.spherical.computeHeading(c0, newPos);
          const perpDist = Math.abs(distToStart * Math.sin((headToStart - hLen) * Math.PI / 180));
          if (asymInput && wid > 0) {
            asymInput.value = Math.max(1, Math.min(99, Math.round((perpDist / wid) * 100)));
          }
        });
        google.maps.event.addListener(line, 'dragend', () => {
          if (asymInput) {
            asymInput.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      } else {
        addLine(ridgeStart, ridgeEnd, '#FF0000');
      }

      const pos1 = google.maps.geometry.spherical.computeOffset(c0, wid * asymRatio / 2, geometryHWid);
      const center1 = google.maps.geometry.spherical.computeOffset(pos1, len / 2, hLen);
      addLabelAndArrow(center1, `${pvId}.1`, hWid + 180);
      setAzimuth(1, hWid + 180);

      const pos2 = google.maps.geometry.spherical.computeOffset(c0, wid * asymRatio + wid * (1 - asymRatio) / 2, geometryHWid);
      const center2 = google.maps.geometry.spherical.computeOffset(pos2, len / 2, hLen);
      addLabelAndArrow(center2, `${pvId}.2`, hWid, true);
      setAzimuth(2, hWid);
    } else if (penteType === 'Multipente') {
      // Faîtage 1 (Rouge) à 25%
      const ridge1Start = google.maps.geometry.spherical.computeOffset(c0, wid * 0.25, geometryHWid);
      const ridge1End = google.maps.geometry.spherical.computeOffset(ridge1Start, len, hLen);
      addLine(ridge1Start, ridge1End, '#FF0000');
      // Noue (Vert) à 50%
      const valleyStart = google.maps.geometry.spherical.computeOffset(c0, wid * 0.50, geometryHWid);
      const valleyEnd = google.maps.geometry.spherical.computeOffset(valleyStart, len, hLen);
      addLine(valleyStart, valleyEnd, '#00FF00');
      // Faîtage 2 (Rouge) à 75%
      const ridge2Start = google.maps.geometry.spherical.computeOffset(c0, wid * 0.75, geometryHWid);
      const ridge2End = google.maps.geometry.spherical.computeOffset(ridge2Start, len, hLen);
      addLine(ridge2Start, ridge2End, '#FF0000');

      const offsets = [
        { label: `${pvId}.1`, widthFactor: 0.125, heading: hWid + 180, rotateText: false },
        { label: `${pvId}.2`, widthFactor: 0.375, heading: hWid, rotateText: true },
        { label: `${pvId}.3`, widthFactor: 0.625, heading: hWid + 180, rotateText: false },
        { label: `${pvId}.4`, widthFactor: 0.875, heading: hWid, rotateText: true }
      ];

      offsets.forEach((conf, idx) => {
        const pvCenter = google.maps.geometry.spherical.computeOffset(google.maps.geometry.spherical.computeOffset(c0, wid * conf.widthFactor, geometryHWid), len * 0.5, hLen);
        addLabelAndArrow(pvCenter, conf.label, conf.heading, conf.rotateText);
        setAzimuth(idx + 1, conf.heading);
      });
    }
  }

  // Calcule et met à jour les inputs du formulaire avec les vraies valeurs
  calculateAndUpdatePanelInputs(polygon) {
    const dc = this.drawingControl;
    const pvId = polygon.pvId;

    // Attendre que le formulaire soit prêt
    setTimeout(() => {
      dc.calculateAndUpdatePanelInputs(polygon);
    }, 100);
  }

  resizeSolarRectangle(rectangle, dimensions) {
    const path = rectangle.getPath();
    const points = [
      path.getAt(0),
      path.getAt(1),
      path.getAt(2),
      path.getAt(3)
    ];

    const headingHorizontal = google.maps.geometry.spherical.computeHeading(points[0], points[1]);
    const headingVertical = google.maps.geometry.spherical.computeHeading(points[0], points[3]);

    const lengthIndices = rectangle._lengthIndices || [0, 2];
    const isLengthHorizontal = lengthIndices.includes(0);

    const lengthHeading = isLengthHorizontal ? headingHorizontal : headingVertical;
    const widthHeading = isLengthHorizontal ? headingVertical : headingHorizontal;

    const newPoint1 = google.maps.geometry.spherical.computeOffset(points[0], dimensions.length, lengthHeading);
    const newPoint3 = google.maps.geometry.spherical.computeOffset(points[0], dimensions.width, widthHeading);
    const newPoint2 = google.maps.geometry.spherical.computeOffset(newPoint1, dimensions.width, widthHeading);

    rectangle.setPath([points[0], newPoint1, newPoint2, newPoint3]);
    rectangle._originalDimensions = {
      length: dimensions.length,
      width: dimensions.width
    };
  }

  getPanelConfigFromForm(pvId) {
    const longueurPanneauInput = document.querySelector(`#longueurPanneau-${pvId}`);
    const largeurPanneauInput = document.querySelector(`#largeurPanneau-${pvId}`);
    const espXInput = document.querySelector(`#espacementPanneauxX-${pvId}`);
    const espYInput = document.querySelector(`#espacementPanneauxY-${pvId}`);
    const espBordsInput = document.querySelector(`#espacementBords-${pvId}`);
    const portraitInput = document.querySelector(`#modePosePortrait-${pvId}`);
    const paysageInput = document.querySelector(`#modePosePaysage-${pvId}`);
    const shedsRowsInput = document.querySelector(`#shedsRows-${pvId}`);
    const shedsRowSpacingInput = document.querySelector(`#shedsRowSpacing-${pvId}`);
    const shedsColsInput = document.querySelector(`#shedsCols-${pvId}`);
    const shedsColSpacingInput = document.querySelector(`#shedsColSpacing-${pvId}`);

    // spacingX/Y : repli aligné sur PANEL_DIMENSIONS.DEFAULT_SPACING_MM (20mm), cf. même défaut appliqué
    // pour le calepinage polygonal dans FormHandler.setupFormListeners.
    const defaults = { length: 2.0, width: 1.0, spacingX: PANEL_DIMENSIONS.DEFAULT_SPACING_MM / 1000, spacingY: PANEL_DIMENSIONS.DEFAULT_SPACING_MM / 1000, margin: 0 };
    if (!longueurPanneauInput || !largeurPanneauInput || !espXInput || !espYInput) return defaults;

    const baseLen = parseFloat(longueurPanneauInput.value) / 1000 || defaults.length;
    const baseWid = parseFloat(largeurPanneauInput.value) / 1000 || defaults.width;
    const isPortrait = portraitInput ? portraitInput.checked : false;
    const isPaysage = paysageInput ? paysageInput.checked : false;

    let length = 0, width = 0;
    if (isPortrait) {
      length = baseWid;  // l_pv sur l'axe X (largeur du panneau)
      width = baseLen;   // L_pv sur l'axe Y (hauteur du panneau)
    } else if (isPaysage) {
      length = baseLen;
      width = baseWid;
    } else {
      length = baseWid || 1.0;
      width = baseLen || 2.0;
    }

    const marginMeters = parseFloat(espBordsInput?.value || '0') / 1000;
    const safeMargin = Number.isFinite(marginMeters) && marginMeters >= 0 ? marginMeters : 0;

    return {
      length,
      width,
      spacingX: parseFloat(espXInput.value) / 1000 || defaults.spacingX,
      spacingY: parseFloat(espYInput.value) / 1000 || defaults.spacingY,
      margin: safeMargin,
      shedsEnabled: !!(shedsRowsInput || shedsColsInput || shedsRowSpacingInput || shedsColSpacingInput),
      shedsRows: Math.max(0, parseInt(shedsRowsInput?.value || '0', 10) || 0),
      shedsRowSpacing: Math.max(0, parseFloat(shedsRowSpacingInput?.value || '0') / 1000 || 0),
      shedsCols: Math.max(0, parseInt(shedsColsInput?.value || '0', 10) || 0),
      shedsColSpacing: Math.max(0, parseFloat(shedsColSpacingInput?.value || '0') / 1000 || 0),
    };
  }

  removeSolarPanel(panel) {
    if (panel && panel.isMarginVisual) {
      return; // Ne pas permettre la suppression de la visualisation de la marge
    }
    if (!panel || !panel.isPanelSolaire) return;
    const pvId = panel.parentPolygon.pvId;
    const deletedIndexes = this.getDeletedIndexSet(pvId);
    if (panel.panelIndex) {
      deletedIndexes.add(panel.panelIndex);
      DeletedPanelsStorage.add({
        pvId,
        panelIndex: panel.panelIndex,
        shapeType: SHAPE_TYPES.SOLAR_RECTANGLE,
      });
    }
    panel.setMap(null);
    if (this.createdPanelsByShape.has(pvId)) {
      const list = this.createdPanelsByShape.get(pvId);
      const idx = list.indexOf(panel);
      if (idx > -1) list.splice(idx, 1);

      // Recréer tous les panneaux (et la marge) après suppression
      const parentPolygon = panel.parentPolygon;
      if (parentPolygon) {
        this.updatePanelsPosition(parentPolygon);
      }


    }

    // Réappliquer le masquage obstacle après suppression manuelle
    if (this.drawingControl.obstaclePanels) {
      this.drawingControl.obstaclePanels.requestRefresh();
    }
  }

  tryRestoreDeletedPanelAt(parentRectangle, latLng) {
    if (!this.boolShowHide || !parentRectangle?.getPath) return;

    const pvId = parentRectangle.pvId;
    const deletedPanels = DeletedPanelsStorage.load().filter(
      (panel) =>
        panel.pvId === pvId &&
        (!panel.shapeType || panel.shapeType === SHAPE_TYPES.SOLAR_RECTANGLE)
    );
    if (!deletedPanels.length) return;

    const path = parentRectangle.getPath();
    if (!path || path.getLength() < 4) return;

    const corner1 = path.getAt(0);
    const corner2 = path.getAt(1);
    const corner3 = path.getAt(2);
    const corner4 = path.getAt(3);

    const mainLength = google.maps.geometry.spherical.computeDistanceBetween(corner1, corner2);
    const mainWidth = google.maps.geometry.spherical.computeDistanceBetween(corner2, corner3);

    const heading = google.maps.geometry.spherical.computeHeading(corner1, corner2);
    const headingToCorner4 = google.maps.geometry.spherical.computeHeading(corner1, corner4);
    let angleDiff = headingToCorner4 - heading;
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;
    const perpHeading = angleDiff > 0 ? heading + 90 : heading - 90;

    const cfg = this.getPanelConfigFromForm(pvId);
    const panelsRotation = parentRectangle.panelsRotation || 0;
    const angleRad = Math.abs(panelsRotation) * Math.PI / 180;
    const effLen = Math.abs(cfg.length * Math.cos(angleRad)) + Math.abs(cfg.width * Math.sin(angleRad));
    const effWid = Math.abs(cfg.length * Math.sin(angleRad)) + Math.abs(cfg.width * Math.cos(angleRad));

    const countLen = Math.floor(mainLength / (effLen + cfg.spacingX));
    const countWid = Math.floor(mainWidth / (effWid + cfg.spacingY));
    const usedLen = countLen * effLen + (countLen - 1) * cfg.spacingX;
    const usedWid = countWid * effWid + (countWid - 1) * cfg.spacingY;
    const startLen = (mainLength - usedLen) / 2;
    const startWid = (mainWidth - usedWid) / 2;

    let closestPanel = null;
    let minDist = Infinity;

    for (const item of deletedPanels) {
      const [iStr, jStr] = item.panelIndex.split("-");
      const i = parseInt(iStr, 10);
      const j = parseInt(jStr, 10);
      if (Number.isNaN(i) || Number.isNaN(j)) continue;

      const lenOffset = startLen + i * (effLen + cfg.spacingX) + effLen / 2;
      const widOffset = startWid + j * (effWid + cfg.spacingY) + effWid / 2;

      const center = google.maps.geometry.spherical.computeOffset(
        google.maps.geometry.spherical.computeOffset(corner1, lenOffset, heading),
        widOffset,
        perpHeading
      );

      const distanceToClick = google.maps.geometry.spherical.computeDistanceBetween(center, latLng);
      if (distanceToClick < minDist && distanceToClick < 2) {
        minDist = distanceToClick;
        closestPanel = { data: item, center };
      }
    }

    if (!closestPanel) return;

    this.getDeletedIndexSet(pvId).delete(closestPanel.data.panelIndex);

    DeletedPanelsStorage.remove(
      (panel) =>
        panel.pvId === pvId &&
        panel.panelIndex === closestPanel.data.panelIndex &&
        (!panel.shapeType || panel.shapeType === SHAPE_TYPES.SOLAR_RECTANGLE)
    );

    this.updatePanelsPosition(parentRectangle);
  }

  toggleBoolShowHide(button) {
    this.boolShowHide = !this.boolShowHide;
    if (button) {
      if (this.boolShowHide) button.classList.add('selected'); else button.classList.remove('selected');
    }
    // CORRECTIF (suite) : réaligne le clickable de TOUS les panneaux déjà sur la carte sur le
    // nouvel état — sans ça, les panneaux créés avant ce basculement restaient clickable:true
    // (ou false) indéfiniment, indépendamment du mode courant.
    this.createdPanelsByShape.forEach((panels) => {
      panels.forEach((panel) => {
        if (panel && panel.isPanelSolaire && typeof panel.setOptions === 'function') {
          panel.setOptions({ clickable: this.boolShowHide });
        }
      });
    });
  }

  cleanupPanelsForShape(pvId, options = {}) {
    const { resetDeleted = false } = options;
    if (this.createdPanelsByShape.has(pvId)) {
      this.createdPanelsByShape.get(pvId).forEach(p => p.setMap(null));
      this.createdPanelsByShape.delete(pvId);
    }
    if (resetDeleted) {
      this.clearDeletedIndicesForShape(pvId);
      this.detachShapeLifecycle(pvId);

      if (window.postAxesManager) {
        window.postAxesManager.removeRect(pvId);
      }
    }

    // NOUVEAU: Nettoyer les éléments visuels de la toiture (faîtage, noue, flèches)
    if (this.roofOverlaysByShape.has(pvId)) {
      this.roofOverlaysByShape.get(pvId).forEach(o => {
        if (typeof o.setMap === 'function') o.setMap(null);
      });
      this.roofOverlaysByShape.delete(pvId);
    }
    const polygon = this.drawingControl?.drawnShapes?.find(s => s.pvId === pvId);
    if (polygon && polygon.roofOverlays) {
      polygon.roofOverlays.forEach(o => { if (typeof o.setMap === 'function') o.setMap(null); });
      polygon.roofOverlays = [];
    }
  }

  initializeDeletedIndicesForShape(pvId) {
    if (!pvId) return;
    this.deletedPanelIndexes.set(pvId, new Set());
    DeletedPanelsStorage.remove(panel =>
      panel.pvId === pvId &&
      (!panel.shapeType || panel.shapeType === SHAPE_TYPES.SOLAR_RECTANGLE)
    );
  }

  clearDeletedIndicesForShape(pvId) {
    if (!pvId) return;
    if (this.deletedPanelIndexes.has(pvId)) {
      this.deletedPanelIndexes.delete(pvId);
    }
    DeletedPanelsStorage.remove(panel =>
      panel.pvId === pvId &&
      (!panel.shapeType || panel.shapeType === SHAPE_TYPES.SOLAR_RECTANGLE)
    );
  }

  getDeletedIndexSet(pvId) {
    if (!pvId) return new Set();
    if (this.deletedPanelIndexes.has(pvId)) {
      return this.deletedPanelIndexes.get(pvId);
    }
    const persisted = DeletedPanelsStorage
      .load()
      .filter(panel => panel.pvId === pvId && (!panel.shapeType || panel.shapeType === SHAPE_TYPES.SOLAR_RECTANGLE));
    const storedSet = new Set(persisted.map(panel => panel.panelIndex));
    this.deletedPanelIndexes.set(pvId, storedSet);
    return storedSet;
  }

  bindShapeLifecycle(polygon) {
    if (!polygon || !polygon.pvId || this.shapeLifecycleBindings.has(polygon.pvId)) return;
    const { CUSTOM_EVENTS } = this.drawingControl;

    const onRightClick = google.maps.event.addListener(polygon, "rightclick", (event) => {
      if (this.boolShowHide) this.tryRestoreDeletedPanelAt(polygon, event.latLng);
    });

    const onDragStart = google.maps.event.addListener(polygon, 'dragstart', () => {
      const bounds = new google.maps.LatLngBounds();
      polygon.getPath().forEach(p => bounds.extend(p));
      polygon._lastDragCenter = bounds.getCenter();
    });

    const onDrag = google.maps.event.addListener(polygon, 'drag', () => {
      if (!polygon._lastDragCenter) return;
      const bounds = new google.maps.LatLngBounds();
      polygon.getPath().forEach(p => bounds.extend(p));
      const newCenter = bounds.getCenter();

      const dLat = newCenter.lat() - polygon._lastDragCenter.lat();
      const dLng = newCenter.lng() - polygon._lastDragCenter.lng();
      polygon._lastDragCenter = newCenter;

      this.translateShapeElements(polygon.pvId, dLat, dLng);
    });

    const onShapeRotated = (evt) => {
      if (evt.detail?.pvId === polygon.pvId && this.createdPanelsByShape.has(polygon.pvId)) {
        this.updatePanelsPosition(polygon);
      }
    };

    const onShapeMoved = (evt) => {
      if (evt.detail?.pvId === polygon.pvId && this.createdPanelsByShape.has(polygon.pvId)) {
        this.updatePanelsPosition(polygon);
      }
    };

    document.addEventListener(CUSTOM_EVENTS.SHAPE_ROTATED, onShapeRotated);
    document.addEventListener(CUSTOM_EVENTS.SHAPE_MOVED, onShapeMoved);

    this.shapeLifecycleBindings.set(polygon.pvId, {
      onRightClick,
      onDragStart,
      onDrag,
      onShapeRotated,
      onShapeMoved,
    });
  }

  detachShapeLifecycle(pvId) {
    const bindings = this.shapeLifecycleBindings.get(pvId);
    if (!bindings) return;
    const { CUSTOM_EVENTS } = this.drawingControl;
    if (bindings.onRightClick) {
      google.maps.event.removeListener(bindings.onRightClick);
    }
    if (bindings.onDragStart) {
      google.maps.event.removeListener(bindings.onDragStart);
    }
    if (bindings.onDrag) {
      google.maps.event.removeListener(bindings.onDrag);
    }
    if (bindings.onShapeRotated) {
      document.removeEventListener(CUSTOM_EVENTS.SHAPE_ROTATED, bindings.onShapeRotated);
    }
    if (bindings.onShapeMoved) {
      document.removeEventListener(CUSTOM_EVENTS.SHAPE_MOVED, bindings.onShapeMoved);
    }
    this.shapeLifecycleBindings.delete(pvId);
  }

  /**
   * Déplace tous les éléments associés à la forme (panneaux, flèches, étiquettes)
   * proportionnellement au déplacement de la forme parente lors d'un "drag".
   */
  translateShapeElements(pvId, dLat, dLng) {
    const shiftLatLng = (lat, lng) => new google.maps.LatLng(lat + dLat, lng + dLng);

    // 1. Déplacer les panneaux et la marge
    const panels = this.createdPanelsByShape.get(pvId) || [];
    panels.forEach(p => {
      if (p.getPath) {
        const path = p.getPath();
        const newPath = [];
        for (let i = 0; i < path.getLength(); i++) {
          const pt = path.getAt(i);
          newPath.push(shiftLatLng(pt.lat(), pt.lng()));
        }
        p.setPath(newPath);
      }
    });

    // 2. Déplacer les éléments visuels de toiture (faîtage, flèches, labels PV)
    const overlays = this.roofOverlaysByShape.get(pvId) || [];
    overlays.forEach(o => {
      if (o.getPath && typeof o.getPath === 'function') {
        const path = o.getPath();
        const newPath = [];
        for (let i = 0; i < path.getLength(); i++) {
          const pt = path.getAt(i);
          newPath.push(shiftLatLng(pt.lat(), pt.lng()));
        }
        o.setPath(newPath);
      } else if (o.marker && o.marker.position) {
        const pos = o.marker.position;
        const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
        const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
        o.marker.position = shiftLatLng(lat, lng);
      }
    });

    // 3. Déplacer les étiquettes permanentes (Mesures, cotations de MeasurementControl)
    if (this.drawingControl && this.drawingControl.permanentLabels) {
      this.drawingControl.permanentLabels.forEach(label => {
        if (label.pvId === pvId && label.marker && label.marker.position) {
          const pos = label.marker.position;
          const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
          const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
          label.marker.position = shiftLatLng(lat, lng);
        }
      });
    }

    // 4. Déplacer les éléments visuels postAxesManager lors du Drag
    if (window.postAxesManager) {
      const shiftLatLng = (lat, lng) => new google.maps.LatLng(lat + dLat, lng + dLng);

      if (window.postAxesManager.handles[pvId]) {
        const pos = window.postAxesManager.handles[pvId].getPosition();
        window.postAxesManager.handles[pvId].setPosition(shiftLatLng(pos.lat(), pos.lng()));
      }
      if (window.postAxesManager.posts[pvId]) {
        window.postAxesManager.posts[pvId].forEach(shape => {
          if (shape.getPath) {
            const path = shape.getPath();
            const newPath = [];
            for (let i = 0; i < path.getLength(); i++) {
              newPath.push(shiftLatLng(path.getAt(i).lat(), path.getAt(i).lng()));
            }
            shape.setPath(newPath);
          } else if (shape.getPosition) {
            shape.setPosition(shiftLatLng(shape.getPosition().lat(), shape.getPosition().lng()));
          } else if (shape.getCenter) {
            shape.setCenter(shiftLatLng(shape.getCenter().lat(), shape.getCenter().lng()));
          }
        });
      }
    }
  }

  /**
   * Bascule la visibilité du label PV + de la flèche d'azimut de toutes les formes gérées ici
   * (cf. updateRoofVisuals/roofOverlaysByShape) — appelé par DrawingControl::updateCotationsVisibility.
   * CORRECTIF (bug "le label PV et la flèche ne suivent pas Afficher/masquer les cotations") : ces
   * overlays sont stockés dans roofOverlaysByShape, jamais dans drawingControl.permanentLabels.
   * @param {boolean} show
   */
  setLabelsVisibility(show) {
    this.roofOverlaysByShape.forEach((overlays) => {
      overlays.forEach((overlay) => {
        if (overlay && typeof overlay.setMap === 'function') {
          overlay.setMap(show ? this.drawingControl.map : null);
        }
      });
    });
  }

  static sortDimensions(sideA, sideB) {
    if (Number.isNaN(sideA) || Number.isNaN(sideB)) {
      return { length: 0, width: 0 };
    }
    if (sideA >= sideB) {
      return { length: sideA, width: sideB };
    }
    return { length: sideB, width: sideA };
  }
}

export default SolarRectangle;