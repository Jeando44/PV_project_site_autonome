import GeometryUtils from '../utils/GeometryUtils.js';
import MeasurementControl from '../controls/MeasurementControl.js';
import FormHandler from './FormHandler.js';
import ButtonControl from '../controls/ButtonControl.js';
import { DRAWING_CONSTANTS, CUSTOM_EVENTS, METERS_PER_LAT_DEGREE, STYLES, SHAPE_TYPES } from '../constants.js';

/**
 * Gestion des formes (création, modification, suppression)
 */
export default class ShapeHandler {
  /**
   * Configure les écouteurs d'événements pour une forme
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {google.maps.Polygon} shape - Forme à configurer
   */
  static setupShapeListeners(drawingControl, shape) {

    const vertices = shape.getPath();
    let resizeTimeout;


    const shouldHandlePolygonRestore =
      shape.type === SHAPE_TYPES.POLYGON &&
      drawingControl?.polygonPanels &&
      typeof drawingControl.polygonPanels.tryRestoreDeletedPanelAt === 'function';

    const ensurePolygonRestoreListener = () => {
      if (!shouldHandlePolygonRestore || shape._hasPolygonRestoreListener) return;
      google.maps.event.addListener(shape, 'rightclick', (event) => {
        drawingControl.polygonPanels.tryRestoreDeletedPanelAt(shape, event.latLng);
      });
      shape._hasPolygonRestoreListener = true;
    };


    // Fonction utilitaire pour mettre à jour les dimensions
    const updateDimensions = () => {

      // NOUVEAU : les panneaux d'un shed (bouton dédié) sont des overlays à position FIXE, calculée à
      // partir du contour du polygone — contrairement aux polygones classiques, rien ne les redessinait
      // après un déplacement/redimensionnement, ce qui laissait une "copie" des panneaux à l'ancienne
      // position pendant que le polygone (vide) se déplaçait vers la nouvelle. On rafraîchit donc
      // systématiquement ici, qui nettoie toujours les anciens panneaux avant d'en recréer.
      if (shape.type === SHAPE_TYPES.SHED_POLYGON && drawingControl.shedPolygon) {
        drawingControl.shedPolygon.refreshPanelsForShape(shape.pvId);
      }

      // Déclencher la mise à jour des panneaux pour les polygones
      if (shape.type === SHAPE_TYPES.POLYGON) {
        // Déclencher immédiatement l'événement pour les panneaux
        document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_MODIFIED, {
          detail: { pvId: shape.pvId }
        }));
      }

      // Déclencher la mise à jour des panneaux pour les polygones
      if (shape.type === SHAPE_TYPES.POLYGON) {
        // Déclencher immédiatement l'événement pour les panneaux
        document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_MODIFIED, {
          detail: { pvId: shape.pvId }
        }));
      }

      // NOUVEAU: Mettre à jour les indicateurs visuels (flèches, labels PV) ICI, avant les sorties prématurées
      if (shape.type === SHAPE_TYPES.POLYGON && drawingControl.polygon && typeof drawingControl.polygon.updateRoofVisuals === 'function') {
          drawingControl.polygon.updateRoofVisuals(shape);
      } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && drawingControl.solarRectangle && typeof drawingControl.solarRectangle.updateRoofVisuals === 'function') {
          drawingControl.solarRectangle.updateRoofVisuals(shape);
      } else if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && drawingControl.lineToPolygon && typeof drawingControl.lineToPolygon.updateRoofVisuals === 'function') {
          drawingControl.lineToPolygon.updateRoofVisuals(shape);
      }

      // Ne pas recalculer les dimensions ici si elles ont été définies manuellement
      // et que la forme n'a été que déplacée (pas redimensionnée)

      // Si la forme a des dimensions manuelles et qu'elle est juste déplacée, 
      // conserver ces dimensions
      if (!shape._isResizing && shape._originalDimensions) {
        // IMPORTANT: il ne faut pas recalculer les dimensions, juste mettre à jour les métriques


        // CORRECTION: Forcer la préservation pour LineToPolygon
        if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON) {
          MeasurementControl.updateMetrics(drawingControl, shape);
          return;
        }

        MeasurementControl.updateMetrics(drawingControl, shape);
        return;
      }

      // Dans le cas d'un redimensionnement, recalculer les dimensions
      const bounds = new google.maps.LatLngBounds();
      vertices.forEach(point => bounds.extend(point));

      // Sauvegarder les dimensions actuelles avant recalcul pour comparaison
      const oldDimensions = shape._originalDimensions ? {
        width: shape._originalDimensions.width,
        length: shape._originalDimensions.length
      } : null;

      shape._originalDimensions = {
        width: GeometryUtils.calculateWidth(bounds),
        length: GeometryUtils.calculateLength(bounds)
      };



      if (shape.rotation && Math.abs(shape.rotation % 360) > 0.01) {
        shape._originalDimensions = GeometryUtils.calculateDimensionsForRotatedPolygon(shape);
      }

      FormHandler.updateFormShapeDimensions(shape, shape.pvId, shape._originalDimensions);
      MeasurementControl.updateMetrics(drawingControl, shape);
      

      // Réinitialiser le flag de redimensionnement
      shape._isResizing = false;
    };

    // Fonction de debounce pour les mises à jour
    const debouncedUpdate = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(updateDimensions, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT);
    };

    // Écouteurs d'événements pour les modifications de points
    ['set_at', 'insert_at'].forEach(eventName => {
      google.maps.event.addListener(vertices, eventName, () => {
        // Marquer la forme comme étant en cours de redimensionnement
        shape._isResizing = true;
        debouncedUpdate();
      });
    });

    // Écouteur pour le déplacement
    google.maps.event.addListener(shape, 'dragend', () => {
      // S'assurer que _isResizing est false lors d'un simple déplacement
      shape._isResizing = false;

      // NOUVEAU : Réattacher l'écouteur rightclick après déplacement
      if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && drawingControl.lineToPolygon) {
        google.maps.event.clearListeners(shape, 'rightclick');
        google.maps.event.addListener(shape, 'rightclick', (event) => {
          drawingControl.lineToPolygon.tryRestoreDeletedPanelAt(shape, event.latLng);
        });
      }

      // NOUVEAU: Protection spéciale pour LineToPolygon
      if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON) {
        const originalDimensions = { ...shape._originalDimensions };

        // Débounce normal
        debouncedUpdate();

        // Force restauration des dimensions APRÈS le update
        setTimeout(() => {
          shape._originalDimensions = originalDimensions;
          FormHandler.updateFormShapeDimensions(shape, shape.pvId, originalDimensions);
          MeasurementControl.updateMetrics(drawingControl, shape);
        }, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT + 50);

        // Émettre l'événement de déplacement
        document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_MOVED, {
          detail: { pvId: shape.pvId }
        }));

        return;
      }

      // IMPORTANT: S'assurer que les dimensions originales sont préservées 
      const originalDimensions = shape._originalDimensions;

      // Appeler la fonction d'update avec les dimensions préservées
      debouncedUpdate();

      // Vérifier après l'update si les dimensions ont changé
      setTimeout(() => {
        if (originalDimensions && shape._originalDimensions) {
          const dimensionsChanged =
            Math.abs(originalDimensions.width - shape._originalDimensions.width) > 0.01 ||
            Math.abs(originalDimensions.length - shape._originalDimensions.length) > 0.01;

          if (dimensionsChanged) {
            console.warn("Dimensions modifiées après déplacement! Restauration forcée.");
            shape._originalDimensions = originalDimensions;
            FormHandler.updateFormShapeDimensions(shape, shape.pvId, originalDimensions);
          }
        }
      }, 200);

      // Émettre l'événement de déplacement
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_MOVED, {
        detail: { pvId: shape.pvId }
      }));
    });

    // Ajout de l'écouteur rightclick pour la restauration des panneaux supprimés (LineToPolygon)
    if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && drawingControl.lineToPolygon) {
      google.maps.event.addListener(shape, 'rightclick', (event) => {
        drawingControl.lineToPolygon.tryRestoreDeletedPanelAt(shape, event.latLng);
      });
    }

    if (shouldHandlePolygonRestore) {
      ensurePolygonRestoreListener();
    }

    // Intercepter le mousedown pour désactiver le mode dessin avant que le relâchement ne crée une forme
    google.maps.event.addListener(shape, 'mousedown', (event) => {
      if (drawingControl.activeButton) {
        ButtonControl.clearAllActiveModes(drawingControl);
        if (typeof drawingControl.finishDrawingSession === 'function') {
          drawingControl.finishDrawingSession();
        }
      }
    });

    // Écouteur pour la sélection - S'ASSURER qu'il est correctement ajouté
    google.maps.event.addListener(shape, 'click', (event) => {
      if (event && typeof event.stop === 'function') {
        event.stop(); // Empêcher la propagation vers la carte pour éviter les conflits de dessin
      }
      try {
        if (drawingControl.activeButton) {
          ButtonControl.clearAllActiveModes(drawingControl);
          if (typeof drawingControl.finishDrawingSession === 'function') {
            drawingControl.finishDrawingSession();
          }
        }
        // Vérifier que la forme existe encore dans drawnShapes avant de la sélectionner
        const shapeExists = drawingControl.drawnShapes.some(s => s === shape);
        if (shapeExists) {
          drawingControl.setSelection(shape);
        } else {
          console.warn(`Tentative de sélection d'une forme supprimée: ${shape.pvId}`);
        }
      } catch (error) {
        console.error("Erreur lors de la sélection:", error);
      }
    });
  }

  /**
   * Gère la complétion d'une forme
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {google.maps.Polygon|google.maps.Rectangle} shape - Forme complétée
   */
  static handlePanelShapeComplete(drawingControl, shape) {
    console.log(`[ShapeHandler] handlePanelShapeComplete exécuté pour le type: ${shape.type}`);
    try {
    if (!shape.pvId) {
      // Lier la forme au formulaire pré-rempli si existant
      if (drawingControl.activePendingPvId) {
        shape.pvId = drawingControl.activePendingPvId;
        drawingControl.usedIds.add(shape.pvId);
        drawingControl.activePendingPvId = null;
      } else {
        let id = 1;
        while (drawingControl.usedIds.has(`PV${id}`)) {
          id++;
        }
        shape.pvId = `PV${id}`;
        drawingControl.usedIds.add(shape.pvId);
      }

      // Calculer le centre en fonction du type de forme
      let center;
      if (shape instanceof google.maps.Polygon) {
        // Pour un polygone, calculer le centre à partir du chemin
        const bounds = new google.maps.LatLngBounds();
        shape.getPath().forEach(point => bounds.extend(point));
        center = bounds.getCenter();

        // Initialiser les dimensions originales si elles n'existent pas
        if (!shape._originalDimensions) {
          shape._originalDimensions = {
            width: GeometryUtils.calculateWidth(bounds),
            length: GeometryUtils.calculateLength(bounds)
          };
        }
        
        // Définir des indices par défaut pour permettre l'affichage des dimensions sur un polygone classique (si c'est un quadrilatère)
        if (shape.getPath().getLength() === 4) {
            shape._lengthIndices = [0, 2];
            shape._widthIndices = [1, 3];
        }
      }


      // Vérifier que center existe avant de dispatcher

        if (typeof shape.panelsRotation !== 'number') {
          shape.panelsRotation = 0;
        }

      if (center) {
        document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_ADDED, {
          detail: {
            shape,
            pvId: shape.pvId,
            dimensions: shape._originalDimensions,
            center: {
              lat: center.lat(),
              lng: center.lng()
            }
          }
        }));
      } else {
        console.error("❌ Cannot dispatch SHAPE_ADDED: center is undefined for shape", shape.pvId);
      }
    }

    // Options de base
    shape.setOptions({
      strokeColor: STYLES.SELECTED_SHAPE.strokeColor,
      strokeWeight: STYLES.DEFAULT_SHAPE.strokeWeight,
      strokeOpacity: STYLES.DEFAULT_SHAPE.strokeOpacity,
      fillColor: STYLES.DEFAULT_SHAPE.fillColor,
      fillOpacity: STYLES.DEFAULT_SHAPE.fillOpacity,
      editable: false,
      draggable: true
    });

    // Gestionnaire d'événements avec debounce
    let updateTimeout;
    const debouncedUpdate = () => {
      if (updateTimeout) clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => {
        try {
          MeasurementControl.updateMetrics(drawingControl, shape, true);
          // Récupérer l'orientation actuelle depuis le formulaire, en utilisant le radio input modePosePortrait
              const portraitInput = document.querySelector(`#modePosePortrait-${shape.pvId}`);
              const paysageInput = document.querySelector(`#modePosePaysage-${shape.pvId}`);
              
              const supportShedInput = document.querySelector(`#supportShed-${shape.pvId}`);
              const isShed = supportShedInput ? supportShedInput.checked : shape.shedsCapable;

              let orientation = null;
              if (isShed) {
                  orientation = 'portrait';
              } else if (portraitInput && portraitInput.checked) {
                  orientation = 'portrait';
              } else if (paysageInput && paysageInput.checked) {
                  orientation = 'paysage';
              }

              if (orientation) {
                // Pour LineToPolygon et SolarRectangle, la mise à jour des panneaux est gérée
                // par leurs propres méthodes (updatePanelsPosition) qui sont plus complètes.
                // Éviter d'appeler la méthode générique qui peut être incomplète.
                if (shape.type !== SHAPE_TYPES.LINE_TO_POLYGON && shape.type !== SHAPE_TYPES.SOLAR_RECTANGLE) {
                    const numberOfPanels = GeometryUtils.calculateNumberOfPanels(shape, orientation);
                    FormHandler.updateFormGridInputs(shape.pvId, numberOfPanels.numCols, numberOfPanels.numRows, numberOfPanels.totalPanelLength, numberOfPanels.totalPanelWidth);
                }
              }
        } catch (error) {
          console.error('Erreur lors de la mise à jour:', error);
        }
      }, DRAWING_CONSTANTS.DEBOUNCE_TIMEOUT);
    };

    // Écouteurs d'événements sécurisés
    const addSafeListener = (target, event, handler) => {
      try {
        google.maps.event.addListener(target, event, () => {
          try {
            handler();
          } catch (error) {
            console.error(`Erreur dans l'événement ${event}:`, error);
          }
        });
      } catch (error) {
        console.error(`Erreur lors de l'ajout de l'écouteur ${event}:`, error);
      }
    };

    // Ajout des écouteurs avec gestion d'erreurs
    addSafeListener(shape, 'dragend', debouncedUpdate);

    // Gestion spécifique pour le polygone
    const path = shape.getPath();
    if (path) {
      ['set_at', 'insert_at', 'remove_at'].forEach(event => {
        addSafeListener(path, event, debouncedUpdate);
      });
    }

    // Ajouter l'écouteur pour le mode de pose
    drawingControl.setupFormListeners(shape);

    // Forcer une mise à jour initiale avec délai
    setTimeout(() => {
      // Lancer l'actualisation des métriques (dimensions, flèches, labels) en priorité absolue
      try {
        MeasurementControl.updateMetrics(drawingControl, shape, true);
      } catch (e) {
        console.error('Erreur updateMetrics:', e);
      }

      try {
        // Traitement secondaire du formulaire et de la grille
        if (drawingControl.panelOrientation) {
          // Pour LineToPolygon et SolarRectangle, le calcul des panneaux est géré par leur propre
          // méthode `createSolarPanels` qui est appelée juste après. On évite un calcul redondant et potentiellement erroné.
          if (shape.type !== SHAPE_TYPES.LINE_TO_POLYGON && shape.type !== SHAPE_TYPES.SOLAR_RECTANGLE) {
            const numberOfPanels = GeometryUtils.calculateNumberOfPanels(
              shape,
              drawingControl.panelOrientation
            );
            FormHandler.updateFormGridInputs(
              shape.pvId,
              numberOfPanels.numCols,
              numberOfPanels.numRows,
              numberOfPanels.totalPanelLength,
              numberOfPanels.totalPanelWidth
            );
          }
        }
        
        // Mettre à jour l'affichage lors de la création pour la flèche et le numéro de panneau
        if (shape.type === SHAPE_TYPES.POLYGON && drawingControl.polygon && typeof drawingControl.polygon.updateRoofVisuals === 'function') {
            drawingControl.polygon.updateRoofVisuals(shape);
        } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && drawingControl.solarRectangle && typeof drawingControl.solarRectangle.updateRoofVisuals === 'function') {
            drawingControl.solarRectangle.updateRoofVisuals(shape);
        } else if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && drawingControl.lineToPolygon && typeof drawingControl.lineToPolygon.updateRoofVisuals === 'function') {
            drawingControl.lineToPolygon.updateRoofVisuals(shape);
        }

        // Mettre à jour explicitement le formulaire après création
        if (shape._originalDimensions) {
          FormHandler.updateFormShapeDimensions(shape, shape.pvId, shape._originalDimensions);
        }
      } catch (error) {
        console.error('Erreur lors de la mise à jour initiale:', error);
      }
    }, 150); // Délai réduit pour plus de réactivité visuelle
    } catch (error) {
      console.error("[ShapeHandler] Erreur critique dans handlePanelShapeComplete :", error);
    }
  }

  /**
   * Met à jour les dimensions d'une forme
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {string} pvId - Identifiant de la forme
   * @param {Object} dimensions - Nouvelles dimensions
   */
  static updateShapeDimensions(drawingControl, pvId, dimensions) {
    const shape = drawingControl.drawnShapes.find(shape => shape.pvId === pvId);
    if (!shape) return;

    // Mettre à jour les dimensions originales
    shape._originalDimensions = dimensions;

    // Obtenir le centre actuel de la forme
    const bounds = new google.maps.LatLngBounds();
    shape.getPath().getArray().forEach(point => bounds.extend(point));
    const center = bounds.getCenter();

    const metersPerLng = METERS_PER_LAT_DEGREE * Math.cos(center.lat() * Math.PI / 180);

    // Créer les points du rectangle non roté
    if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON) {
      // Pour les LineToPolygon, utiliser la méthode spécialisée de redimensionnement
      if (drawingControl.lineToPolygon) {
        drawingControl.lineToPolygon.updatePolygonDimensions(shape, dimensions);
      }
      MeasurementControl.updateMetrics(drawingControl, shape);
    } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
      if (drawingControl.solarRectangle) {
        drawingControl.solarRectangle.resizeSolarRectangle(shape, dimensions);
      }
    } else {
      // Méthode standard pour les autres formes
      const deltaLat = (dimensions.width / METERS_PER_LAT_DEGREE) / 2;  // Largeur sur l'axe N-S
      const deltaLng = (dimensions.length / metersPerLng) / 2;          // Longueur sur l'axe E-O

      const points = [
        new google.maps.LatLng(center.lat() + deltaLat, center.lng() + deltaLng),
        new google.maps.LatLng(center.lat() + deltaLat, center.lng() - deltaLng),
        new google.maps.LatLng(center.lat() - deltaLat, center.lng() - deltaLng),
        new google.maps.LatLng(center.lat() - deltaLat, center.lng() + deltaLng)
      ];

      // Appliquer la rotation existante
      const currentRotation = shape.rotation || 0;
      const rotatedPoints = points.map(point =>
        GeometryUtils.rotatePoint(point, center, currentRotation)
      );

      // Mettre à jour la forme seulement pour les non-LineToPolygon
      shape.setPath(rotatedPoints);

      // Définir les indices standards
      shape._lengthIndices = [0, 2];
      shape._widthIndices = [1, 3];
    }

    // Mettre à jour les métriques dans tous les cas
    MeasurementControl.updateMetrics(drawingControl, shape);
    FormHandler.updateFormShapeDimensions(shape, shape.pvId, dimensions);

    // Repositionner visuellement la flèche et le label au nouveau centre exact
    if (shape.type === SHAPE_TYPES.POLYGON && drawingControl.polygon && typeof drawingControl.polygon.updateRoofVisuals === 'function') {
        drawingControl.polygon.updateRoofVisuals(shape);
    } else if (shape.type === SHAPE_TYPES.SOLAR_RECTANGLE && drawingControl.solarRectangle && typeof drawingControl.solarRectangle.updateRoofVisuals === 'function') {
        drawingControl.solarRectangle.updateRoofVisuals(shape);
    } else if (shape.type === SHAPE_TYPES.LINE_TO_POLYGON && drawingControl.lineToPolygon && typeof drawingControl.lineToPolygon.updateRoofVisuals === 'function') {
        drawingControl.lineToPolygon.updateRoofVisuals(shape);
    }
  }

  /**
   * Fait pivoter une forme
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {number} angle - Angle de rotation en degrés
   * @param {boolean} updatePanels - Mettre à jour les panneaux
   */
  static rotateShape(drawingControl, angle) {
    if (!drawingControl.selectedShape) return;

    let currentShape = drawingControl.selectedShape;
    let points = currentShape.getPath().getArray();

    const bounds = new google.maps.LatLngBounds();
    points.forEach(point => bounds.extend(point));
    const center = bounds.getCenter();

    // Sauvegarder l'azimuth précédent avant toute modification
    const previousAzimuth = currentShape.rotation || 0;

    const rotatedPoints = points.map(point =>
      GeometryUtils.rotatePoint(point, center, angle)
    );

    currentShape.setPath(rotatedPoints);
    // Après setPath, le MVCArray change : réattacher les écouteurs de chemin
    if (currentShape.type === SHAPE_TYPES.POLYGON && drawingControl.polygon?.refreshPathListeners) {
      drawingControl.polygon.refreshPathListeners(currentShape);
    }

    // CORRECTIF : setPath() remplace le MVCArray du chemin — les panneaux shed (overlays à position
    // fixe, calculée à partir du contour) ne se redessinaient donc jamais après une rotation, faute
    // d'un point d'entrée équivalent à refreshPathListeners ci-dessus pour ce type de forme.
    if (currentShape.type === SHAPE_TYPES.SHED_POLYGON && drawingControl.shedPolygon) {
      drawingControl.shedPolygon.refreshPanelsForShape(currentShape.pvId);
    }

    // Calculer le nouvel azimuth (entre -180 et 180 degrés)
    let newAzimuth;

    // Pour les polygones et les SolarRectangle, utiliser l'azimuth précédent + l'angle de rotation
    // pour maintenir la continuité et éviter les sauts
    // Inverser le signe de l'angle pour que la flèche tourne dans le même sens que le polygone
    if (currentShape.type === SHAPE_TYPES.POLYGON || currentShape.type === SHAPE_TYPES.SOLAR_RECTANGLE) {
      newAzimuth = previousAzimuth - angle;
      // Normaliser entre -180 et 180
      while (newAzimuth > 180) newAzimuth -= 360;
      while (newAzimuth <= -180) newAzimuth += 360;

      // Mettre à jour gridBaseHeading pour les polygones si polygonPanels est disponible
      if (currentShape.type === SHAPE_TYPES.POLYGON && drawingControl.polygonPanels) {
        drawingControl.polygonPanels.updateGridBaseHeading(currentShape);
      }
    } else {
      // Pour les autres types de formes (LineToPolygon, etc.),
      // utiliser getWidthAzimuth pour garantir la cohérence avec l'initialisation
      try {
        newAzimuth = GeometryUtils.getWidthAzimuth(currentShape);
      } catch (error) {
        console.warn('Erreur lors du calcul de l\'azimuth:', error);
        // Si getWidthAzimuth échoue, utiliser l'azimuth précédent + l'angle de rotation
        newAzimuth = previousAzimuth + angle;
        // Normaliser entre -180 et 180
        while (newAzimuth > 180) newAzimuth -= 360;
        while (newAzimuth <= -180) newAzimuth += 360;
      }
    }

    currentShape.rotation = newAzimuth;

    // Mettre à jour l'input du formulaire
    if (currentShape.pvId) {
      const formInput = document.querySelector(`#azimuth-${currentShape.pvId}`);
      if (formInput) {
        formInput.value = Math.round(newAzimuth);
        formInput.dispatchEvent(new Event('change'));

      }

      // Mettre à jour la flèche d'azimuth visuellement
      FormHandler.updateAzimuthArrow(drawingControl, currentShape.pvId, newAzimuth);
      
      // Mettre à jour la flèche et label pour TOUTES les formes PV après rotation
      if (currentShape.type === SHAPE_TYPES.POLYGON && drawingControl.polygon && typeof drawingControl.polygon.updateRoofVisuals === 'function') {
          drawingControl.polygon.updateRoofVisuals(currentShape);
      } else if (currentShape.type === SHAPE_TYPES.SOLAR_RECTANGLE && drawingControl.solarRectangle && typeof drawingControl.solarRectangle.updateRoofVisuals === 'function') {
          drawingControl.solarRectangle.updateRoofVisuals(currentShape);
      } else if (currentShape.type === SHAPE_TYPES.LINE_TO_POLYGON && drawingControl.lineToPolygon && typeof drawingControl.lineToPolygon.updateRoofVisuals === 'function') {
          drawingControl.lineToPolygon.updateRoofVisuals(currentShape);
      }
    }

    MeasurementControl.updateMetrics(drawingControl, currentShape);

    // Émettre un événement pour signaler la rotation
    document.dispatchEvent(new CustomEvent(drawingControl.CUSTOM_EVENTS.SHAPE_ROTATED, {
      detail: {
        pvId: currentShape.pvId,
        rotation: currentShape.rotation
      }
    }));
  }

  /**
   * Centre la carte sur une forme
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {google.maps.Polygon} shape - Forme à centrer
   */
  static centerOnShape(drawingControl, shape) {
    if (!shape || !drawingControl.map) return;

    // Créer un bounds pour la forme
    const bounds = new google.maps.LatLngBounds();

    // Pour un polygone, ajouter tous les points au bounds
    if (shape instanceof google.maps.Polygon) {
      shape.getPath().forEach(point => bounds.extend(point));
    }

    // Centrer la carte sur les bounds avec un petit padding
    drawingControl.map.fitBounds(bounds, {
      padding: {
        top: 50,
        right: 50,
        bottom: 50,
        left: 50
      }
    });

    // Optionnel : définir un zoom maximum pour éviter un zoom trop important
    setTimeout(() => {
      if (drawingControl.map.getZoom() > 20) {
        drawingControl.map.setZoom(20);
      }
    }, 100);
  }

  /**
   * Récupère le centre d'une forme
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   * @param {string} pvId - Identifiant de la forme
   * @returns {Object|null} Centre de la forme ou null
   */
  static getShapeCenter(drawingControl, pvId) {
    const shape = drawingControl.drawnShapes.find(s => s.pvId === pvId);

    if (!shape) return null;

    // Créer un bounds pour stocker les limites
    const bounds = new google.maps.LatLngBounds();

    if (shape instanceof google.maps.Rectangle) {
      // Pour un rectangle, utiliser getBounds()
      bounds.union(shape.getBounds());
    } else if (shape instanceof google.maps.Polygon) {
      // Pour un polygon, utiliser tous les points du chemin
      shape.getPath().forEach(point => bounds.extend(point));
    } else {
      return null;
    }

    const center = bounds.getCenter();
    return {
      lat: center.lat(),
      lng: center.lng()
    };
  }
} 