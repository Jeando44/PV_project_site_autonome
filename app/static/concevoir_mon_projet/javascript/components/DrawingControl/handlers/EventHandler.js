import ShapeHandler from "./ShapeHandler.js";
import GeometryUtils from "../utils/GeometryUtils.js";
import { DRAWING_CONSTANTS, CUSTOM_EVENTS, STYLES , SHAPE_TYPES} from "../constants.js";

/**
 * Gestion des événements
 */
export default class EventHandler {
  /**
   * Configure les écouteurs d'événements pour le DrawingControl
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   */
  static setupEventListeners(drawingControl) {
    // Écouter l'événement de mise à jour de la carte
    document.addEventListener(CUSTOM_EVENTS.UPDATE_MAP_SHAPE, (e) => {
      const { pvId, dimensions } = e.detail;
      ShapeHandler.updateShapeDimensions(drawingControl, pvId, dimensions);
    });

    // Ajouter l'écouteur pour la sélection d'onglet
    document.addEventListener(CUSTOM_EVENTS.TAB_SELECTED, (e) => {
      if (!drawingControl.isInternalSelection) {
        const shape = drawingControl.drawnShapes.find(
          (shape) => shape.pvId === e.detail.pvId
        );
        if (shape) {
          drawingControl.isInternalSelection = true;
          drawingControl.setSelection(shape);
          drawingControl.isInternalSelection = false;
        }
      }
    });

    // Ajouter cet écouteur
    document.addEventListener(CUSTOM_EVENTS.REQUEST_SHAPE_CENTER, (e) => {
      const center = ShapeHandler.getShapeCenter(drawingControl, e.detail.pvId);
      if (center) {
        document.dispatchEvent(
          new CustomEvent(CUSTOM_EVENTS.SHAPE_CENTER_UPDATED, {
            detail: {
              pvId: e.detail.pvId,
              center,
            },
          })
        );
      }
    });

    // Ajouter cet écouteur pour les changements de dimensions depuis le formulaire
    document.addEventListener(CUSTOM_EVENTS.FORM_DIMENSIONS_CHANGED, (e) => {
      const { pvId, dimensions } = e.detail;
      ShapeHandler.updateShapeDimensions(drawingControl, pvId, dimensions);
    });

    // Écouter les changements de zoom
    document.addEventListener(CUSTOM_EVENTS.MAP_ZOOM_CHANGED, (e) => {
      drawingControl.updateDrawButtonState(e.detail.zoom);
    });

    // Ajouter l'écouteur pour le centrage sur une forme
    document.addEventListener(CUSTOM_EVENTS.CENTER_ON_SHAPE, (e) => {
      const shape = drawingControl.drawnShapes.find(
        (shape) => shape.pvId === e.detail.pvId
      );
      if (shape) {
        ShapeHandler.centerOnShape(drawingControl, shape);
      }
    });

    // Ajouter l'écouteur pour les raccourcis clavier
    document.addEventListener("keydown", (e) => {
      // Vérifier si la touche Échap est pressée
      if (e.key === "Escape" || e.key === "Esc") {
        // BUG 3: Centralisation de la désactivation mutuelle via Escape
        if (window.ButtonControl || ButtonControl) {
           (window.ButtonControl || ButtonControl).clearAllActiveModes(drawingControl);
        }
        
        // NOUVEAU: Désélectionner l'objet sur la carte et forcer la fin du mode dessin
        drawingControl.clearSelection();
        if (typeof drawingControl.finishDrawingSession === 'function') {
          drawingControl.finishDrawingSession();
        }
      }

      // Raccourcis Copier/Coller
      const isMac = navigator.userAgent.indexOf('Mac') !== -1;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;
      
      // Déterminer si l'élément actif est un champ de texte
      const activeElement = document.activeElement;
      const isTextInput = activeElement && (
        activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' || 
        activeElement.contentEditable === 'true' ||
        activeElement.contentEditable === 'plaintext-only'
      );

      // Copier avec Ctrl+C ou Cmd+C - UNIQUEMENT si aucun champ de texte n'est actif
      if (cmdKey && (e.key === 'c' || e.key === 'C') && !isTextInput) {
        if (drawingControl.selectedShape) {
          e.preventDefault();
          drawingControl.copySelectedShape();
        }
      }
      
      // Coller avec Ctrl+V ou Cmd+V - UNIQUEMENT si aucun champ de texte n'est actif
      if (cmdKey && (e.key === 'v' || e.key === 'V') && !isTextInput) {
        e.preventDefault();
        
        if (drawingControl.clipboard) {
          // Activer le mode de collage
          drawingControl.isPasteMode = true;
          drawingControl.map.setOptions({ draggableCursor: 'copy' });
          
          // Mettre en évidence le bouton de copie
          if (drawingControl.copyButton) {
            drawingControl.copyButton.classList.add("selected");
            drawingControl.copyButton.style.backgroundColor = STYLES.SELECTED_BUTTON.backgroundColor;
          }
        } else {
          drawingControl.errorModal.show("Aucune forme copiée dans le presse-papier.");
        }
      }
    });
    
    // L'écouteur pour le clic sur la carte sera configuré dans la méthode onAdd
    // pour s'assurer que la carte est correctement initialisée
  }

  /**
   * Configure les écouteurs d'événements pour le dessin
   * @param {DrawingControl} drawingControl - Instance de DrawingControl
   */
  static setupDrawingListeners(drawingControl) {
    console.log("[EventHandler] Initialisation des écouteurs de dessin (setupDrawingListeners).");
    if (!drawingControl.drawingManager) {
      console.error("[EventHandler] ERREUR : drawingControl.drawingManager n'est pas défini au moment d'ajouter les écouteurs !");
    }

    const finalizeDrawing = () => {
      if (typeof drawingControl.finishDrawingSession === 'function') {
        drawingControl.finishDrawingSession();
      }
    };

    google.maps.event.addListener(
      drawingControl.drawingManager,
      "overlaycomplete",
      (event) => {
        console.log(`[EventHandler] Événement natif 'overlaycomplete' capté. Type de forme dessinée : ${event.type}`);
        try {
          // Identification du type d'overlay
          const overlayType = event.type;
          let shape = null;

          // 1. Traitement spécifique selon le type d'overlay
          switch (overlayType) {
            // Cas des rectangles
            case google.maps.drawing.OverlayType.RECTANGLE:
              // Vérifier si c'est un obstacle rectangle
              if (drawingControl.obstacleMode === 'rectangle') {
                shape = event.overlay;
                drawingControl.obstacleRectangleManager.handleObstacleRectangleComplete(shape);
                drawingControl.obstacleMode = null;
                finalizeDrawing();
                return;
              }
              
              // Vérifier si c'est un rectangle simple
              if (drawingControl.simpleRectangleMode) {
                shape = drawingControl.simpleRectangleManager.handleSimpleRectangleComplete(event.overlay);
                shape.type = SHAPE_TYPES.SIMPLE_RECTANGLE;
                // Ne pas ajouter à drawnShapes car handleSimpleRectangleComplete le fait déjà
                finalizeDrawing();
                return; // Sortie anticipée
              }
              
              // Nouveau pipeline: déléguer au gestionnaire SolarRectangle
              shape = drawingControl.solarRectangle.handleSolarRectangleComplete(event.overlay);
              if (!shape) return;
              break;
              
            // Cas des cercles
            case google.maps.drawing.OverlayType.CIRCLE:
              // Vérifier si c'est un obstacle cercle
              if (drawingControl.obstacleMode === 'circle') {
                shape = event.overlay;
                drawingControl.obstacleCircleManager.handleObstacleCircleComplete(shape);
                drawingControl.obstacleMode = null;
                finalizeDrawing();
                return;
              }
              
              // Cercle normal
              shape = event.overlay;
              shape.type = SHAPE_TYPES.CIRCLE;
              drawingControl.circleManager.handleCircleComplete(shape);
              // Ajouter à drawnShapes pour la sélection
              drawingControl.drawnShapes.push(shape);
              finalizeDrawing();
              return;
              
            // Cas des polylignes
            case google.maps.drawing.OverlayType.POLYLINE:
              // Les obstacles lignes sont maintenant gérés par un système de dessin personnalisé
              // Ne pas traiter les obstacles lignes ici
              if (drawingControl.obstacleMode === 'line') {
                // Ce cas ne devrait plus se produire car on utilise le dessin personnalisé
                // Mais on le garde pour sécurité
                return;
              }
              
              // Ligne normale
              shape = event.overlay;
              shape.type = SHAPE_TYPES.POLYLINE;
              drawingControl.lineManager.handleLineComplete(shape);
              // Ajouter à drawnShapes pour la sélection
              drawingControl.drawnShapes.push(shape);
              finalizeDrawing();
              return;
              
            // Cas des textes
            case google.maps.drawing.OverlayType.TEXT:
              shape = event.overlay;
              shape.type = SHAPE_TYPES.TEXT;
              setupBaseOverlayOptions(shape);
              drawingControl.drawnShapes.push(shape);
              drawingControl.textManager.drawnTexts.push(shape);
              finalizeDrawing();
              return;
              
            // Cas des polygones
            case google.maps.drawing.OverlayType.POLYGON:
              // Vérifier si c'est un obstacle polygone
              if (drawingControl.obstacleMode === 'polygon') {
                shape = event.overlay;
                drawingControl.obstaclePolygonManager.handleObstaclePolygonComplete(shape);
                drawingControl.obstacleMode = null;
                finalizeDrawing();
                return;
              }
              
              // Vérifier si c'est un polygone simple
              if (drawingControl.simplePolygonMode) {
                shape = drawingControl.simplePolygonManager.handleSimplePolygonComplete(event.overlay);
                shape.type = SHAPE_TYPES.SIMPLE_POLYGON;
                finalizeDrawing();
                return; // Sortie anticipée
              }
              
              // Traitement standard pour les polygones avec panneaux solaires
              shape = event.overlay;
              shape.type = SHAPE_TYPES.POLYGON;
              // Transférer le flag de compatibilité Sheds
              // Si le mode Sheds continu est actif, tous les polygones créés pendant ce mode sont shedsCapable.
              if (drawingControl.isShedsPolygonModeActive) {
                shape.shedsCapable = true;
              } else if (drawingControl.nextPolygonShedsCapable) {
                // Fallback : compatibilité avec l'ancien comportement "un seul polygone"
                shape.shedsCapable = true;
                drawingControl.nextPolygonShedsCapable = false;
              } else {
                shape.shedsCapable = false;
              }
              setupBaseOverlayOptions(shape);
              
              // Initialiser l'orientation du polygone/de la grille de panneaux.
              const path = shape.getPath();
              if (path && path.getLength() >= 2) {
                const ref = path.getAt(0);
                const next = path.getAt(1);
                const polygonRealHeading = google.maps.geometry.spherical.computeHeading(ref, next);
                shape.rotation = polygonRealHeading;
                shape.panelsRotation = 0;

                if (shape.shedsCapable) {
                  // CORRECTIF (référentiel d'orientation absolu pour le calepinage en shed) : le tracé du
                  // polygone ne définit QUE la zone, jamais l'azimut. gridBaseHeading reste fixé à 180°
                  // (Sud, cap compas) quel que soit le 1er segment tracé — même règle que Polygon.js
                  // (createPolygon) et PolygonPanelsManager.js::updateGridBaseHeading. Fixer
                  // initialOrientation à polygonRealHeading (comme avant ce correctif) rendait par
                  // ailleurs le garde-fou de updateGridBaseHeading (`typeof polygon.initialOrientation
                  // === 'undefined'`) systématiquement faux pour un shed dessiné via l'outil dédié,
                  // empêchant cette méthode de jamais recorriger gridBaseHeading vers 180.
                  shape.initialOrientation = 180;
                  shape.polygonInitialHeading = polygonRealHeading; // Orientation réelle du polygone (référence)
                  shape.gridBaseHeading = 180;
                } else {
                  shape.initialOrientation = polygonRealHeading;
                  shape.polygonInitialHeading = polygonRealHeading;
                  shape.gridBaseHeading = polygonRealHeading;
                }
              }
              
              drawingControl.drawnShapes.push(shape);
              break;
              
            default:
              console.warn("Type d'overlay non pris en charge:", overlayType);
              return;
          }
          
          if (!shape) return;
          
          // 2. Traitements spécifiques aux formes avec panneaux solaires
          if (
            (overlayType === google.maps.drawing.OverlayType.POLYGON && !drawingControl.simplePolygonMode) ||
            (overlayType === google.maps.drawing.OverlayType.RECTANGLE && !drawingControl.simpleRectangleMode)
          ) {
            // CORRECTIF (bug rapporté : "sélection/déplacement d'un rectangle de panneaux solaires
            // cesse de fonctionner après quelques manipulations") : pour SHAPE_TYPES.SOLAR_RECTANGLE,
            // solarRectangle.handleSolarRectangleComplete() (déjà appelée ci-dessus dans le cas
            // RECTANGLE) exécute ELLE-MÊME ShapeHandler.handlePanelShapeComplete (cf. SolarRectangle.js).
            // Le rappeler ici l'exécutait une SECONDE fois sur la même forme, ce qui attachait deux
            // fois chaque écouteur qu'il pose (click, mousedown, dragend, set_at/insert_at...) — aucune
            // garde anti-doublon dans ShapeHandler.js — avec deux chaînes de debounce indépendantes
            // concurrentes réagissant aux mêmes évènements. Pour POLYGON, ce chemin reste le SEUL
            // appelant (Polygon.handlePolygonComplete ne le fait pas lui-même), donc inchangé.
            if (shape.type !== SHAPE_TYPES.SOLAR_RECTANGLE) {
              ShapeHandler.handlePanelShapeComplete(drawingControl, shape);
            }
            // Signal au module de validation calepinage (gestion_calepinage.js)
            if (shape.pvId) {
              document.dispatchEvent(new CustomEvent('calepinage:shapeDrawn', { detail: { pvId: shape.pvId } }));
            }
          }

          // 3. Finalisations communes
          // drawingControl.setSelection(shape);
          window.storageManager.collectShapesData(drawingControl);

          // 4. Configuration des écouteurs d'événements
          // Appliquer uniquement aux types appropriés — SOLAR_RECTANGLE exclu : déjà fait par
          // solarRectangle.handleSolarRectangleComplete() (cf. commentaire ci-dessus).
          if (shape.getPath && shape.type !== SHAPE_TYPES.SOLAR_RECTANGLE) {
            ShapeHandler.setupShapeListeners(drawingControl, shape);
            // Attacher également le rightclick pour restaurer les panneaux sur les polygones natifs
            if (shape.type === SHAPE_TYPES.POLYGON) {
              try {
                google.maps.event.addListener(shape, 'rightclick', (event) => {
                  try {
                    drawingControl.polygonPanels.tryRestoreDeletedPanelAt(shape, event.latLng);
                  } catch (e) {
                    console.error('[EventHandler] Error in polygon right-click handler', e);
                  }
                });
                shape._hasPolygonRestoreListener = true;
              } catch (e) {
                console.error('[EventHandler] Failed to attach rightclick on polygon', e);
              }
            }
          }

          // BUG 2: Mode de dessin continu (Multi-dessin)
          // Forcer le maintien du mode de dessin actif pour pouvoir enchaîner les formes 
          // sans que le gestionnaire par défaut de Google ne coupe l'action après chaque forme.
          setTimeout(() => {
            if (drawingControl.activeButton && drawingControl.drawingManager) {
              drawingControl.drawingManager.setDrawingMode(overlayType);
            }
          }, 0);
        } catch (error) {
          console.error("Erreur dans overlaycomplete:", error);
        }
      }
    );
    
    // Écouteur pour désélectionner sur clic en dehors
    google.maps.event.addListener(drawingControl.map, "click", () => {
      drawingControl.setSelection(null);
    });
    
    // Fonctions utilitaires locales
    function setupBaseOverlayOptions(shape) {
      shape.setEditable(STYLES.DEFAULT_SHAPE.editable);
      shape.setOptions({
        fillColor: STYLES.DEFAULT_SHAPE.fillColor,
        fillOpacity: STYLES.DEFAULT_SHAPE.fillOpacity,
        strokeWeight: STYLES.SELECTED_SHAPE.strokeWeight,
        strokeColor: STYLES.DEFAULT_SHAPE.strokeColor,
        strokeOpacity: STYLES.DEFAULT_SHAPE.strokeOpacity,
      });
    }
    
    function handleSolarPanelRectangle(drawingControl, rectangle) {
      // Vérification des dimensions minimales
      const bounds = rectangle.getBounds();
      const width = GeometryUtils.calculateWidth(bounds);
      const length = GeometryUtils.calculateLength(bounds);
      
      if (width < DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION || 
          length < DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION) {
        rectangle.setMap(null);
        drawingControl.errorModal.show(
          "Les dimensions de la surface doivent être supérieures à 1.5 mètres de côté."
        );
        return null;
      }
      
      // Création du polygone à partir du rectangle
      const points = GeometryUtils.getRectanglePoints(rectangle);
      const polygon = new google.maps.Polygon({
        paths: points,
        fillColor: STYLES.DEFAULT_SHAPE.fillColor,
        fillOpacity: STYLES.DEFAULT_SHAPE.fillOpacity,
        strokeWeight: STYLES.DEFAULT_SHAPE.strokeWeight,
        strokeColor: STYLES.SELECTED_SHAPE.strokeColor,
        strokeOpacity: STYLES.DEFAULT_SHAPE.strokeOpacity,
        zIndex: STYLES.DEFAULT_SHAPE.zIndex,
        editable: STYLES.DEFAULT_SHAPE.editable,
        draggable: STYLES.DEFAULT_SHAPE.draggable,
        map: drawingControl.map,
      });
      
      // Stockage des dimensions originales
      polygon._originalDimensions = { width, length };
      
      // Supprimer le rectangle original
      rectangle.setMap(null);
      
      // Ajouter à la liste des formes
      drawingControl.drawnShapes.push(polygon);
      
      return polygon;
    }
  }
}
