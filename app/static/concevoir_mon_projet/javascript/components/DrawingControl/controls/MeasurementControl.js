import GeometryUtils from "../utils/GeometryUtils.js";
import * as CalculationUtils from "../utils/CalculationUtils.js";
import {
  STYLES,
  CUSTOM_EVENTS,
  MEASUREMENT_CONSTANTS,
  METERS_PER_LAT_DEGREE,
  SHAPE_TYPES
} from "../constants.js";

/**
 * Gestion des étiquettes de mesure
 */
export default class MeasurementControl {
  /**
   * Crée une étiquette de mesure
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {string} text - Texte à afficher
   * @param {google.maps.LatLng} position - Position de l'étiquette
   * @param {string} labelId - Identifiant unique pour l'étiquette
   * @returns {Promise<Object>} Objet contenant le marqueur et l'élément DOM
   */
  static async createPermanentLabel(drawingControl, text, position, labelId, showLabel) {
    if (!drawingControl.AdvancedMarkerElement) {
      const { AdvancedMarkerElement } = await google.maps.importLibrary(
        "marker"
      );
      drawingControl.AdvancedMarkerElement = AdvancedMarkerElement;
    }

    // Vérifier si une étiquette avec cet ID existe déjà
    if (!drawingControl.permanentLabels) {
      drawingControl.permanentLabels = [];
    }

    const existingLabel = drawingControl.permanentLabels.find(
      (l) => l.labelId === labelId
    );
    if (existingLabel) {
      // Mettre à jour le texte et la position
      existingLabel.element.textContent = text;
      existingLabel.marker.position = position;
      return existingLabel;
    }

    const div = document.createElement("div");
    div.className = `permanent-label-${labelId}`;
    div.textContent = text;
    // Si les labels de performance sont masqués et que le texte contient "P_ PV" ou "Prod", masquer le label
    if (showLabel === false && (text.includes("P_ PV") || text.includes("Prod"))) {
      div.style.cssText = `display:block;opacity:0;`;
    } else {
      div.style.cssText = STYLES.MEASUREMENT_LABEL;
    }

    try {
      const marker = new drawingControl.AdvancedMarkerElement({
        map: drawingControl.map,
        position: position,
        content: div,
        collisionBehavior: "REQUIRED",
      });

      const label = {
        marker: marker,
        element: div,
        content: div,
        map: marker.map,
        setMap: (map) => (marker.map = map),
        labelId: labelId,
        pvId: labelId.split("-")[0], // Extraire le pvId du labelId
      };

      drawingControl.permanentLabels.push(label);
      return label;
    } catch (error) {
      console.error("Erreur création marker permanent:", error);
      return null;
    }
  }

  /**
   * Crée ou met à jour l'étiquette d'ID d'une forme
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {string} pvId - Identifiant de la forme
   * @param {google.maps.LatLng} center - Centre de la forme
   * @param {google.maps.Polygon|google.maps.Rectangle} shape - Forme pour calculer la position intérieure
   * @returns {Promise<Object>} Étiquette créée ou mise à jour
   */

  static async createOrUpdateIdLabel(drawingControl, pvId, center, shape) {
    // Les formes LineToPolygon et SolarRectangle gèrent leurs propres labels PV via updateRoofVisuals
    // CORRECTIF (bug "double flèche et label" sur le calepinage en shed dédié) : SHAPE_TYPES.SHED_POLYGON
    // manquait de cette exclusion — ShedPolygon.js::refreshPanelsForShape appelle déjà explicitement
    // drawingControl.polygon.updateRoofVisuals(mainPolygon) pour poser SA PROPRE flèche/label (stockée
    // dans dc.polygon.roofOverlaysByShape), mais cette fonction-ci (appelée pour TOUTE forme via la
    // boucle de rafraîchissement des étiquettes, sans filtre de type en amont) en posait donc une 2e,
    // indépendante (stockée dans drawingControl.permanentLabels), jamais nettoyée par l'autre mécanisme.
    if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON || shape.type === SHAPE_TYPES.SOLAR_RECTANGLE || shape.type === SHAPE_TYPES.POLYGON || shape.type === SHAPE_TYPES.SHED_POLYGON) {
      const existingLabel = drawingControl.permanentLabels?.find(
        (label) => label.labelId === `${pvId}-id`
      );
      if (existingLabel && existingLabel.marker) {
        existingLabel.marker.map = null;
      }
      return null;
    }

    const { position, heading } = MeasurementControl.computeInteriorIdPosition(center, shape);

    // Correction de l'ordre des arguments
    const label = await MeasurementControl.createPermanentLabel(
      drawingControl,
      pvId,           // text : l'ID affiché
      position,       // position : la position calculée (au centre)
      `${pvId}-id`,   // labelId : l'identifiant unique (String)
      true            // showLabel : par défaut true
    );

    if (label?.element) {
      const rotation = MeasurementControl.normalizeHeadingForLabel(heading);
      label.element.style.transformOrigin = 'center';
      label.element.style.display = 'inline-flex';
      label.element.style.alignItems = 'center';
      label.element.style.justifyContent = 'center';
      label.element.style.whiteSpace = 'nowrap';
      label.element.style.transform = `rotate(${rotation}deg)`;
    }

    return label;
  }


  /** Crée ou met à jour l'étiquette d'azimut
   * Positionne la flèche juste en dessous du label PV, centrée horizontalement
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {string} pvId - Identifiant de la forme
   * @param {google.maps.LatLng} center - Centre de la forme
   * @param {google.maps.Polygon|google.maps.Rectangle} shape - Forme pour calculer la position
   * @returns {Promise<Object>} Étiquette créée ou mise à jour
   */
  static async createOrUpdateAzimuthArrow(drawingControl, pvId, center, shape) {
    if (!drawingControl.AdvancedMarkerElement) {
      const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
      drawingControl.AdvancedMarkerElement = AdvancedMarkerElement;
    }

    // Les formes LineToPolygon, SolarRectangle et Polygon natif gèrent leurs propres flèches d'azimut via updateRoofVisuals
    // CORRECTIF (bug "double flèche et label" sur le calepinage en shed dédié) : même exclusion
    // manquante que createOrUpdateIdLabel ci-dessus, pour SHAPE_TYPES.SHED_POLYGON — voir son
    // commentaire pour le détail (2 mécanismes indépendants posaient chacun leur flèche d'azimut).
    if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON || shape.type === SHAPE_TYPES.SOLAR_RECTANGLE || shape.type === SHAPE_TYPES.POLYGON || shape.type === SHAPE_TYPES.SHED_POLYGON) {
      // Supprimer l'ancienne flèche centrale
      const existingArrow = drawingControl.permanentLabels?.find(
        (label) => label.labelId === `${pvId}-azimuth`
      );
      if (existingArrow && existingArrow.marker) {
        existingArrow.marker.map = null;
      }
      return null;
    }

    // Utiliser la même logique de positionnement que pour le label PV
    const computedPosition = MeasurementControl.computeInteriorIdPosition(center, shape);
    const labelPosition = computedPosition.position;

    // Position ancrée exactement sur le label PV pour éviter les décalages liés au zoom
    const arrowPosition = labelPosition;

    // Récupérer l'azimut de la forme
    const azimuth = shape.rotation || 0;
    // Vérifier si une flèche existe déjà pour la mettre à jour
    const existingArrow = drawingControl.permanentLabels?.find(
      (label) => label.labelId === `${pvId}-azimuth`
    );

    if (existingArrow) {
      // Mettre à jour la position et la rotation de la flèche existante
      existingArrow.marker.position = arrowPosition;
      if (existingArrow.element) {
        existingArrow.element.style.transform = `rotate(${azimuth}deg)`;
      }
      return existingArrow;
    }

    // Créer la nouvelle flèche

    const azimuthArrow = document.createElement("div");
    azimuthArrow.className = `azimuth-arrow-${pvId}`;
    azimuthArrow.style.cssText = `
          position: absolute;
          left: 50%;
          transform: translate(-50%, 1px) rotate(${azimuth}deg); // cette ligne gère l'emplacement de la flèche par rapport au texte, c'est la valeur 1px qui positionne le label par rapport au texte.
          transform-origin: center center;
          width: 30px;
          height: 30px;
          background-color: transparent;
          display: flex;
          justify-content: center;
          align-items: center;
        `;
    azimuthArrow.innerHTML = `
      <img src="/static/concevoir_mon_projet/medias/icons/arrow.svg" alt="azimuth" style="width: 30px; height: 30px;">
    `;

    const azimuthArrowMarker = new drawingControl.AdvancedMarkerElement({
      map: drawingControl.map,
      position: arrowPosition,
      content: azimuthArrow,
      collisionBehavior: "REQUIRED",
    });

    const azimuthArrowLabel = {
      marker: azimuthArrowMarker,
      element: azimuthArrow,
      content: azimuthArrow,
      map: azimuthArrowMarker.map,
      setMap: (map) => (azimuthArrowMarker.map = map),
      labelId: `${pvId}-azimuth`,
      pvId: pvId,
    };
    if (!drawingControl.permanentLabels) {
      drawingControl.permanentLabels = [];
    }
    drawingControl.permanentLabels.push(azimuthArrowLabel);
    return azimuthArrowLabel;
  }

  /** Crée ou met à jour l'étiquette de performances solaires
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {string} pvId - Identifiant de la forme
   * @param {number} performance - Performance en W/m²
   * @param {google.maps.LatLng} position - Position de l'étiquette
   * @returns {Promise<Object>} Étiquette créée ou mise à jour
   */
  static async createOrUpdatePuissancePVLabel(
    drawingControl,
    pvId,
    puissancePV,
    position,
    showLabel
  ) {
    const offset = 0.00005; // Ajuster cette valeur selon vos besoins
    const offsetPosition = new google.maps.LatLng(
      position.lat() - offset,
      position.lng()
    );
    return await MeasurementControl.createPermanentLabel(
      drawingControl,
      `P_ PV: ${puissancePV.toFixed(2)} kWc`,
      offsetPosition,
      `${pvId}-puissancePV`,
      showLabel
    );
  }
  /**Crée ou met à jour l'étiquette de Productible MWh
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {string} pvId - Identifiant de la forme
   * @param {number} productibleMWh - Productible MWh
   * @param {google.maps.LatLng} position - Position de l'étiquette
   * @returns {Promise<Object>} Étiquette créée ou mise à jour
   */
  static async createOrUpdateProductionAnnuelleMWhLabel(
    drawingControl,
    pvId,
    productionAnnuelleKWh,
    position,
    showLabel
  ) {
    const offset = 0.0001; // Ajuster cette valeur selon vos besoins
    const offsetPosition = new google.maps.LatLng(
      position.lat() - offset,
      position.lng()
    );
    return await MeasurementControl.createPermanentLabel(
      drawingControl,
      `Prod: ${CalculationUtils.convertKWhToMWh(productionAnnuelleKWh / 1000).toFixed(2)} MWh`,
      offsetPosition,
      `${pvId}-productionAnnuelleMWh`,
      showLabel
    );
  }
  /**
   * Crée ou met à jour l'étiquette de calcul de surface
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {string} pvId - Identifiant de la forme
   * @param {number} area - Surface en mètres carrés
   * @param {google.maps.LatLng} position - Position de l'étiquette
   * @returns {Promise<Object>} Étiquette créée ou mise à jour
   */
  static async createOrUpdateAreaLabel(drawingControl, pvId, area, position) {
    const offset = 0.00002; // Ajuster cette valeur selon vos besoins
    const offsetPosition = new google.maps.LatLng(
      position.lat() - offset,
      position.lng()
    );

    return await MeasurementControl.createPermanentLabel(
      drawingControl,
      `Surface: ${area.toFixed(2)} m²`,
      offsetPosition,
      `${pvId}-area`
    );
  }

  /**
   * Crée ou met à jour l'étiquette de dimension d'un côté
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {string} pvId - Identifiant de la forme
   * @param {number} dimension - Dimension en mètres
   * @param {google.maps.LatLng} position - Position de l'étiquette
   * @param {number} sideIndex - Index du côté (0-3)
   * @param {boolean} isLengthSide - Si c'est un côté de longueur ou de largeur
   * @returns {Promise<Object>} Étiquette créée ou mise à jour
   */

  static async createOrUpdateDimensionLabel(
    drawingControl,
    pvId,
    dimension,
    position,
    sideIndex,
    heading = 0
  ) {
    const formattedDimension = MeasurementControl.formatDistanceLabel(dimension);
    const label = await MeasurementControl.createPermanentLabel(
      drawingControl,
      formattedDimension,
      position,
      `${pvId}-dimension-${sideIndex}`
    );

    if (label && label.element) {
      const rotation = MeasurementControl.normalizeHeadingForLabel(heading);
      label.element.style.transformOrigin = 'center';
      label.element.style.display = 'inline-flex';
      label.element.style.alignItems = 'center';
      label.element.style.justifyContent = 'center';
      label.element.style.whiteSpace = 'nowrap';
      label.element.style.transform = `translateY(50%) rotate(${rotation}deg)`;
    }

    return label;
  }

  /**
   * Crée un bouton de paramétrage interactif ancré sur le côté non étiqueté
   */
  static async createOrUpdateSettingsLabel(drawingControl, pvId, position, heading) {
    const labelId = `${pvId}-settings-btn`;

    if (!drawingControl.AdvancedMarkerElement) {
      const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
      drawingControl.AdvancedMarkerElement = AdvancedMarkerElement;
    }

    if (!drawingControl.permanentLabels) {
      drawingControl.permanentLabels = [];
    }

    let existingLabel = drawingControl.permanentLabels.find(l => l.labelId === labelId);
    if (existingLabel) {
      existingLabel.marker.position = position;
      return existingLabel;
    }

    const div = document.createElement("div");
    div.className = `permanent-label-${labelId}`;
    div.innerHTML = `
      <button type="button" class="map-pv-settings-btn" title="Configuration de la géométrie" style="background: #28a745; border: 2px solid #1e7e34; padding: 4px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.4); pointer-events: auto; outline: none; transition: transform 0.2s;">
          <img src="/static/concevoir_mon_projet/medias/icons/solar-panel.svg" style="width: 24px; height: 24px; pointer-events: none; filter: brightness(0) invert(1);">
      </button>
    `;
    div.style.cssText = `display: inline-flex; align-items: center; justify-content: center; transform-origin: center; z-index: 1020;`;

    const btn = div.querySelector('button');

    // Isoler complètement l'interaction du bouton pour éviter de déclencher le redimensionnement de la géométrie sous-jacente
    ['mousedown', 'mouseup', 'dblclick', 'touchstart', 'touchend', 'pointerdown', 'pointerup'].forEach(evt => {
      btn.addEventListener(evt, (e) => e.stopPropagation());
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const targetBtn = document.getElementById(`btn-open-geometrie-modal-${pvId}`) || document.getElementById('btn-open-geometrie-modal');
      if (targetBtn) targetBtn.click();
    });

    try {
      const marker = new drawingControl.AdvancedMarkerElement({ map: drawingControl.map, position: position, content: div, collisionBehavior: "REQUIRED" });
      const label = { marker, element: div, content: div, map: marker.map, setMap: (m) => (marker.map = m), labelId, pvId };
      drawingControl.permanentLabels.push(label);
      return label;
    } catch (error) {
      return null;
    }
  }

  /**
   * Supprime toutes les étiquettes permanentes associées à une forme
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {string} pvId - Identifiant de la forme
   */
  static removePermanentLabels(drawingControl, pvId) {
    if (!drawingControl.permanentLabels) return;

    const labelsToRemove = drawingControl.permanentLabels.filter(
      (label) => label.pvId === pvId
    );

    for (const label of labelsToRemove) {
      if (label.marker) {
        label.marker.setMap(null);
      }
      if (label.element && label.element.parentNode) {
        label.element.remove();
      }

      // Supprimer du tableau
      const index = drawingControl.permanentLabels.indexOf(label);
      if (index !== -1) {
        drawingControl.permanentLabels.splice(index, 1);
      }
    }
  }

  /**
   * Détermine dynamiquement les indices des côtés bas et gauche d'un polygone
   * en fonction de leur position géographique réelle
   * @param {Array<google.maps.LatLng>} points - Points du polygone
   * @param {google.maps.LatLng} center - Centre du polygone
   * @returns {Array<number>} Indices des côtés à afficher [bas, gauche]
   */
  static getBottomAndLeftSides(points, center) {
    if (!points || points.length < 4) {
      return [0, 3]; // Valeur par défaut si les points ne sont pas valides
    }

    // Calculer le point médian de chaque côté et déterminer sa position relative au centre
    const sides = [];
    for (let i = 0; i < points.length; i++) {
      const start = points[i];
      const end = points[(i + 1) % points.length];
      const midPoint = new google.maps.LatLng(
        (start.lat() + end.lat()) / 2,
        (start.lng() + end.lng()) / 2
      );

      // Calculer la position relative au centre
      const deltaLat = midPoint.lat() - center.lat();
      const deltaLng = midPoint.lng() - center.lng();

      sides.push({
        index: i,
        midPoint: midPoint,
        deltaLat: deltaLat, // Positif = nord, négatif = sud
        deltaLng: deltaLng, // Positif = est, négatif = ouest
        // Distance au centre pour déterminer la position absolue
        distanceFromCenter: google.maps.geometry.spherical.computeDistanceBetween(midPoint, center)
      });
    }

    // Trouver le côté le plus au sud (bas) - deltaLat le plus négatif
    const bottomSide = sides.reduce((min, side) =>
      side.deltaLat < min.deltaLat ? side : min
    );

    // Trouver le côté le plus à l'ouest (gauche) - deltaLng le plus négatif
    const leftSide = sides.reduce((min, side) =>
      side.deltaLng < min.deltaLng ? side : min
    );

    return [bottomSide.index, leftSide.index];
  }


  /**
   * Met à jour les métriques d'une forme avec des étiquettes permanentes
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {google.maps.Polygon|google.maps.Rectangle} shape - Forme à mesurer
   */
  static async updateMetrics(drawingControl, shape, firstLoad = false) {
    if (drawingControl._metricsTimeout) {
      clearTimeout(drawingControl._metricsTimeout);
    }

    drawingControl._metricsTimeout = setTimeout(async () => {
      try {
        if (!shape || !shape.pvId) return;
        // Récupérer les nouvelles coordonnées du centre de la forme pour mettre à jour les datas solaires via l'API PVGIS
        // Supprimer d'abord tous les labels existants
        MeasurementControl.removePermanentLabels(drawingControl, shape.pvId);

        let points;
        let center;

        // Pour les formes rotées ou existantes
        const path =
          shape instanceof google.maps.Rectangle
            ? GeometryUtils.getRectanglePoints(shape)
            : shape.getPath().getArray();

        points = path;
        const bounds = new google.maps.LatLngBounds();
        path.forEach((point) => bounds.extend(point));
        center = bounds.getCenter();

        // Utiliser les dimensions stockées
        const width = shape._originalDimensions.width;
        const length = shape._originalDimensions.length;

        // Mesurer les distances réelles entre les points pour déterminer quels côtés sont longueur/largeur
        const sides = [];
        for (let i = 0; i < points.length; i++) {
          const start = points[i];
          const end = points[(i + 1) % points.length];
          const distance =
            google.maps.geometry.spherical.computeDistanceBetween(start, end);

          // Calculer aussi l'orientation du côté (N-S vs E-O)
          const dLat = Math.abs(end.lat() - start.lat());
          const dLng = Math.abs(end.lng() - start.lng());
          const isMoreNorthSouth = dLat > dLng;

          sides.push({
            index: i,
            distance,
            isMoreNorthSouth,
          });
        }

        // Détecter si la forme a une rotation (azimuth)
        const hasRotation =
          shape.rotation && Math.abs(shape.rotation % 360) > 0.01;

        let lengthIndices = [];
        let widthIndices = [];
        let topLengthIndex = -1;

        // Utiliser une approche cohérente pour toutes les formes, rotées ou non
        // Si la forme a déjà des indices de longueur/largeur stockés, les réutiliser
        if (shape._lengthIndices && shape._widthIndices) {
          lengthIndices = shape._lengthIndices;
          widthIndices = shape._widthIndices;
        } else {
          // Première attribution des indices - utiliser l'orientation géographique
          sides.forEach((side) => {
            if (side.isMoreNorthSouth) {
              widthIndices.push(side.index);
            } else {
              lengthIndices.push(side.index);
            }
          });

          // Stocker ces indices pour les réutiliser après rotation
          shape._lengthIndices = lengthIndices;
          shape._widthIndices = widthIndices;
        }


        // Mettre à jour les étiquettes de dimensions pour chaque côté (tous les côtés par défaut pour les polygones complexes/sheds)
        let sidesToShow = points.map((_, i) => i);

        if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON || shape.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
          if (lengthIndices.length > 0 && widthIndices.length > 0) {
            // Trouver dynamiquement le côté de longueur le plus au Sud (lat minimum)
            const bottomLengthIndex = lengthIndices.reduce((a, b) => {
              const midA = points[a].lat() + points[(a + 1) % points.length].lat();
              const midB = points[b].lat() + points[(b + 1) % points.length].lat();
              return midA < midB ? a : b;
            });

            // Trouver dynamiquement le côté de largeur le plus à l'Ouest (lng minimum)
            const leftWidthIndex = widthIndices.reduce((a, b) => {
              const midA = points[a].lng() + points[(a + 1) % points.length].lng();
              const midB = points[b].lng() + points[(b + 1) % points.length].lng();
              return midA < midB ? a : b;
            });

            sidesToShow = [bottomLengthIndex, leftWidthIndex];
            topLengthIndex = lengthIndices.find(idx => idx !== bottomLengthIndex);
          }
        }

        // Mettre à jour les étiquettes de dimensions pour chaque côté
        for (let i = 0; i < points.length; i++) {
          // Filtrer les côtés à afficher pour les rectangles
          if (!sidesToShow.includes(i)) {
            // Supprimer l'étiquette existante si elle existe
            const existingLabel = drawingControl.permanentLabels?.find(
              (label) => label.labelId === `${shape.pvId}-dimension-${i}`
            );
            if (existingLabel) {
              existingLabel.marker?.setMap(null);
              const index = drawingControl.permanentLabels.indexOf(existingLabel);
              if (index !== -1) {
                drawingControl.permanentLabels.splice(index, 1);
              }
            }

            // Ajouter l'icône de paramétrage au milieu de l'arête longueur secondaire
            if (i === topLengthIndex) {
              const start = points[i];
              const end = points[(i + 1) % points.length];
              const midPoint = new google.maps.LatLng((start.lat() + end.lat()) / 2, (start.lng() + end.lng()) / 2);
              const heading = google.maps.geometry.spherical.computeHeading(start, end);
              const label = await MeasurementControl.createOrUpdateSettingsLabel(drawingControl, shape.pvId, midPoint, heading);
              if (label && label.element) {
                const rotation = MeasurementControl.normalizeHeadingForLabel(heading);
                // Positionnement exact sur la ligne et au centre (on supprime la translation Y secondaire)
                label.element.style.transform = `translateY(50%) rotate(${rotation}deg)`;
              }
            }
            continue;
          }

          const start = points[i];
          const end = points[(i + 1) % points.length];
          const midPoint = new google.maps.LatLng(
            (start.lat() + end.lat()) / 2,
            (start.lng() + end.lng()) / 2
          );

          // Déterminer si ce côté est une longueur ou une largeur en fonction de son index
          const sideLength = google.maps.geometry.spherical.computeDistanceBetween(start, end);
          const heading = google.maps.geometry.spherical.computeHeading(start, end);
          const labelPosition = midPoint;

          const label = await MeasurementControl.createOrUpdateDimensionLabel(
            drawingControl,
            shape.pvId,
            sideLength,
            labelPosition,
            i,
            heading
          );

          // Ajustement en pixels pour décaler le label en dehors du rectangle, ce block de code gère le positionnement des labels.
          if (label && label.element) {
            const rotation = MeasurementControl.normalizeHeadingForLabel(heading);
            const testPointUp = google.maps.geometry.spherical.computeOffset(midPoint, 1, rotation);
            const distUp = google.maps.geometry.spherical.computeDistanceBetween(center, testPointUp);
            const distMid = google.maps.geometry.spherical.computeDistanceBetween(center, midPoint);

            const offsetPixels = 14; // Distance vers l'extérieur, cette ligne gère l'emplacement des labels par rapport au bord
            const translateY = distUp > distMid ? -offsetPixels : offsetPixels;

            // CORRECTIF (demande explicite : "tourner de -90° les cotations de la largeur du
            // rectangle") : ajustement purement visuel (le calcul de décalage ci-dessus doit rester
            // basé sur le cap réel de l'arête pour pousser le label vers l'extérieur du bon côté,
            // donc pas touché) — uniquement le côté identifié comme largeur (widthIndices) est
            // concerné, la longueur garde sa rotation actuelle.
            const displayRotation = widthIndices.includes(i) ? rotation - 90 : rotation;

            label.element.style.transform = `translateY(50%) rotate(${displayRotation}deg) translateY(${translateY}px)`;
          }
        }

        // Créer ou mettre à jour l'étiquette d'ID
        await MeasurementControl.createOrUpdateIdLabel(
          drawingControl,
          shape.pvId,
          center,
          shape
        );


        // Créer ou mettre à jour l'étiquette d'azimut
        await MeasurementControl.createOrUpdateAzimuthArrow(
          drawingControl,
          shape.pvId,
          center,
          shape
        );

        // Repositionner systématiquement les indicateurs visuels AVANT l'attente des requêtes serveur
        if (shape.type === SHAPE_TYPES.POLYGON && drawingControl.polygon && typeof drawingControl.polygon.updateRoofVisuals === 'function') {
          drawingControl.polygon.updateRoofVisuals(shape);
        } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && drawingControl.solarRectangle && typeof drawingControl.solarRectangle.updateRoofVisuals === 'function') {
          drawingControl.solarRectangle.updateRoofVisuals(shape);
        } else if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && drawingControl.lineToPolygon && typeof drawingControl.lineToPolygon.updateRoofVisuals === 'function') {
          drawingControl.lineToPolygon.updateRoofVisuals(shape);
        }

        if (drawingControl && drawingControl.areCotationsVisible === false && typeof drawingControl.updateCotationsVisibility === 'function') {
          drawingControl.updateCotationsVisibility();
        }

        if (firstLoad && window.storageManager) {
          await window.storageManager.savePageData();
        }

        // Lancer la récupération asynchrone non-bloquante pour la puissance et production en tâche de fond
        if (window.storageManager) {
            window.storageManager.getPuissancePV(shape.pvId).then(result => {
                const puissanceKWc = (result && typeof result === 'object') ? (result.puissanceKWc || 0) : (Number(result) || 0);
                MeasurementControl.createOrUpdatePuissancePVLabel(drawingControl, shape.pvId, puissanceKWc, center, CUSTOM_EVENTS.SHOW_PERFORMANCE_LABELS);
            }).catch(e => console.warn(e));

            window.storageManager.getProductionAnnuelleKWh(shape.pvId, center).then(prod => {
                MeasurementControl.createOrUpdateProductionAnnuelleMWhLabel(drawingControl, shape.pvId, prod, center, CUSTOM_EVENTS.SHOW_PERFORMANCE_LABELS);
            }).catch(e => console.warn(e));
        }

        // Émettre l'événement seulement si c'est une nouvelle forme
        if (!shape._dimensionsEmitted) {
          document.dispatchEvent(
            new CustomEvent("rectangleDimensionsChanged", {
              detail: {
                pvId: shape.pvId,
                dimensions: {
                  length: length,
                  width: width,
                },
              },
            })
          );
          shape._dimensionsEmitted = true;
        }

        if (firstLoad) {
          // Attendre un peu avant d'émettre l'événement pour s'assurer que les données sont bien sauvegardées
          setTimeout(() => {
            document.dispatchEvent(
              new CustomEvent(CUSTOM_EVENTS.METRICS_UPDATED, {
                detail: { pvId: shape.pvId },
              })
            );
          }, 100);
        }
      } catch (error) {
        console.error("Erreur dans updateMetrics:", error);
      }
    }, 50);
  }
  /**
   * Bascule la visibilité des labels de performance
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {boolean} show - État de visibilité à appliquer, en fonction de la valeur de CUSTOM_EVENTS.SHOW_PERFORMANCE_LABELS
   */
  static togglePerformanceLabelsVisibility() {
    const drawingControl = window.drawingControl;
    if (!drawingControl || !drawingControl.permanentLabels) {
      console.warn("drawingControl ou permanentLabels non disponible");
      return;
    }
    CUSTOM_EVENTS.SHOW_PERFORMANCE_LABELS = !CUSTOM_EVENTS.SHOW_PERFORMANCE_LABELS;

    document.querySelectorAll("div").forEach((label) => {
      if (
        (label.className.includes("puissancePV") || label.className.includes("productionAnnuelleMWh"))
      ) {

        label.style.cssText = CUSTOM_EVENTS.SHOW_PERFORMANCE_LABELS ? STYLES.MEASUREMENT_LABEL : "display:block;opacity:0;";

      }
    });
  }

  static formatDistanceLabel(distance) {
    if (distance >= 1000) {
      return `${(distance / 1000).toFixed(2)} km`;
    }
    return `${distance.toFixed(2)} m`;
  }

  static normalizeHeadingForLabel(heading = 0) {
    let rotation = heading - 90;
    if (rotation > 180) {
      rotation -= 360;
    }
    if (rotation > 90) {
      rotation -= 180;
    } else if (rotation < -90) {
      rotation += 180;
    }
    return rotation;
  }

  static getOffsetLabelPosition(midPoint, center, offsetMeters, sideHeading = 0) {
    if (
      !midPoint ||
      !center ||
      !google?.maps?.geometry?.spherical ||
      typeof offsetMeters !== 'number'
    ) {
      return midPoint;
    }

    const geometry = google.maps.geometry.spherical;
    const effectiveOffset = Math.max(offsetMeters, 0);
    const normalizedHeading = ((sideHeading % 360) + 360) % 360;
    const perpendicularHeadingA = normalizedHeading + 90;
    const perpendicularHeadingB = normalizedHeading - 90;

    const candidateA = geometry.computeOffset(
      midPoint,
      effectiveOffset,
      perpendicularHeadingA
    );
    const candidateB = geometry.computeOffset(
      midPoint,
      effectiveOffset,
      perpendicularHeadingB
    );

    const distanceA = geometry.computeDistanceBetween(center, candidateA);
    const distanceB = geometry.computeDistanceBetween(center, candidateB);

    if (!Number.isFinite(distanceA) || !Number.isFinite(distanceB)) {
      return candidateA;
    }

    return distanceA > distanceB ? candidateA : candidateB;
  }

  /**
   * Calcule une position intérieure pour afficher l'identifiant PV.
   * L'ID est positionné :
   * - à l'intérieur de l'implantation
   * - au-dessus de la flèche d'azimuth
   * - parallèle à la longueur
   * @param {google.maps.LatLng} center - Centre de la forme
   * @param {google.maps.Polygon|google.maps.Rectangle} shape - Forme
   * @returns {Object} Position et heading pour l'étiquette
   */
  /**
   * Calcule une position intérieure pour afficher l'identifiant PV.
   * L'ID est positionné au centre de la forme, parallèle à la longueur
   * @param {google.maps.LatLng} center - Centre de la forme
   * @param {google.maps.Polygon|google.maps.Rectangle} shape - Forme
   * @returns {Object} Position et heading pour l'étiquette
   */
  static computeInteriorIdPosition(center, shape) {
    if (!center || !shape || !google?.maps?.geometry?.spherical) {
      return { position: center, heading: 0 };
    }

    try {
      const geometry = google.maps.geometry.spherical;
      let points = [];

      // Récupérer les points selon le type de forme
      if (shape instanceof google.maps.Rectangle) {
        points = GeometryUtils.getRectanglePoints(shape);
      } else if (shape instanceof google.maps.Polygon) {
        points = shape.getPath().getArray();
      } else {
        return { position: center, heading: 0 };
      }

      if (!points || points.length < 2) {
        return { position: center, heading: 0 };
      }

      // Déterminer le heading de la longueur
      let lengthHeading = 0;

      if (Array.isArray(shape._lengthIndices) && shape._lengthIndices.length > 0) {
        // Utiliser le premier côté de longueur pour déterminer le heading
        const lengthSideIndex = shape._lengthIndices[0];
        const start = points[lengthSideIndex];
        const end = points[(lengthSideIndex + 1) % points.length];
        if (start && end) {
          lengthHeading = geometry.computeHeading(start, end);
        }
      } else {
        // Recalculer si les indices n'ont pas encore été définis
        const sides = [];
        for (let i = 0; i < points.length; i++) {
          const start = points[i];
          const end = points[(i + 1) % points.length];
          const distance = geometry.computeDistanceBetween(start, end);
          sides.push({
            index: i,
            distance,
            start,
            end
          });
        }
        // Trouver le côté le plus long (longueur)
        const longestSide = sides.reduce((max, side) =>
          side.distance > max.distance ? side : max
        );
        if (longestSide.start && longestSide.end) {
          lengthHeading = geometry.computeHeading(longestSide.start, longestSide.end);
        }
      }

      // MODIFICATION PRINCIPALE : Utiliser directement le centre de la forme
      // au lieu de calculer une position complexe
      return { position: center, heading: lengthHeading };

    } catch (error) {
      console.warn("Impossible de calculer la position intérieure de l'ID:", error);
      return { position: center, heading: 0 };
    }
  }
}

document.addEventListener(CUSTOM_EVENTS.SOLAR_DATA_BATCH_UPDATED, (event) => {
  const { results } = event.detail;
  if (window.drawingControl?.drawnShapes) {
    results.forEach(({ pvId, solarData, error }) => {
      if (!error && solarData) {
        const shape = window.drawingControl.drawnShapes.find(s => s.pvId === pvId);
        if (shape) {
          MeasurementControl.updateMetrics(
            window.drawingControl,
            shape,
            false,
          );
        }
      }
    });
  } else {
    console.warn("drawingControl ou drawnShapes non disponible");
  }
});
