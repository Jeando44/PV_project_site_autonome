import { MARGIN_COLOR, SHAPE_TYPES, PANEL_DIMENSIONS, STYLES, TYPE_COUVERTURE_MAP, DRAWING_CONSTANTS } from "../constants.js";
import GeometryUtils from "../utils/GeometryUtils.js";
import DeletedPanelsStorage from "../utils/DeletedPanelsStorage.js";
import { drawPanelsInRect } from "./calepinage_rectangulaire.js";
import { calculateRectPoints } from "./solar_calculations.js";
import { calculateShedGridRect } from "./calepinage_shed.js";
import { computeInsetPolygonPath } from "./calepinage_polygonale.js";
import { buildPanelEngineContext, registerGeneratedPanels } from "../utils/PanelEngineAdapter.js";
import ShapeHandler from "../handlers/ShapeHandler.js";
class LineToPolygon {
  constructor(drawingControl) {
    this.drawingControl = drawingControl;

    // Propriétés pour le mode line-to-polygon
    this.isActive = false;
    this.points = [];
    this.tempLine = null;
    this.tempPolygon = null; // Nouveau: polygone temporaire
    this.button = null;
    this._clickListener = null;
    this._mouseMoveListener = null;
    this._isProcessingClick = false;
    this.boolShowHide = false;

    this.createdPanelsByShape = new Map(); // stockage des panneaux par forme (pvId -> panels[])
    this.panelCountByShape = new Map(); // compteur de panneaux par forme 
    this.deletedPanelIndexes = new Map(); // pvId -> Set des index (i,j) des panneaux supprimés
    this.hiddenByToggle = new Set(); // pvId masqués via toggle global
    this.roofOverlaysByShape = new Map(); // pvId -> array of overlays (flèches, faîtage)
    this.marginVisuals = new Map(); // pvId -> google.maps.Polygon (zone tampon "Esp. bordure")


    // Propriétés pour la modification par les côtés
    this.sideDetectors = [];
    this.isDragging = false;
    this.draggedSide = null;
    this.initialMousePos = null;
    this.currentPolygon = null;
    this.mouseMoveListener = null;
    this.mouseUpListener = null;

    // Ajouter un écouteur pour les changements de zoom
    document.addEventListener(
      drawingControl.CUSTOM_EVENTS.MAP_ZOOM_CHANGED,
      (event) => {
        const zoom = event.detail.zoom;
        if (
          zoom < drawingControl.DRAWING_CONSTANTS.MIN_ZOOM_LEVEL &&
          this.isActive
        ) {
          // Désactiver le mode Line to Polygon si actif
          this.clearTemp();
          this.isActive = false;
          if (this.button) {
            this.button.classList.remove("selected");
            this.button.style.backgroundColor =
              drawingControl.STYLES.DEFAULT_BUTTON.backgroundColor;
            drawingControl.activeButton = null;
          }
          document.body.classList.remove("line-to-polygon-cursor");
          drawingControl.map.setOptions({ draggableCursor: null });
        }
      }
    );
  }

  /**
   * Active/désactive le mode de dessin ligne vers polygone
   * @param {HTMLElement} button - Bouton de dessin
   */
  toggleMode(button) {
    const dc = this.drawingControl;
    console.log("[LineToPolygon] Activation du mode demandée.");

    // Vérifier si le niveau de zoom est suffisant
    if (dc.map && dc.map.getZoom() < dc.DRAWING_CONSTANTS.MIN_ZOOM_LEVEL) {
      dc.errorModal.show(
        `Zoom minimum requis: ${dc.DRAWING_CONSTANTS.MIN_ZOOM_LEVEL}`
      );
      return;
    }

    // Si le même bouton est cliqué, désactiver le mode
    if (dc.activeButton === button) {
      button.classList.remove("selected");
      button.style.backgroundColor = dc.STYLES.DEFAULT_BUTTON.backgroundColor;
      dc.activeButton = null;
      this.isActive = false;

      // Réinitialiser le curseur
      document.body.classList.remove("line-to-polygon-cursor");
      dc.map.setOptions({ draggableCursor: null });

      // Nettoyer les éléments temporaires
      this.clearTemp();
    } else {
      // Désactiver le bouton précédent s'il existe
      if (dc.activeButton) {
        dc.activeButton.classList.remove("selected");
        dc.activeButton.style.backgroundColor =
          dc.STYLES.DEFAULT_BUTTON.backgroundColor;

        // Nettoyer les éléments temporaires
        this.clearTemp();

        // Désactiver les autres modes
        if (dc.drawingManager) {
          dc.drawingManager.setDrawingMode(null);
        }
        this.isActive = false;

        if (dc._textClickListener) {
          google.maps.event.removeListener(dc._textClickListener);
          dc._textClickListener = null;
        }

        // Réinitialiser le curseur
        document.body.classList.remove("line-to-polygon-cursor");
      }

      // Activer le nouveau mode
      button.classList.add("selected");
      button.style.backgroundColor = dc.STYLES.SELECTED_BUTTON.backgroundColor;
      dc.activeButton = button;
      this.isActive = true;
      if (dc.drawingManager) {
        dc.drawingManager.setDrawingMode(null);
      }

      // Appliquer le style de curseur personnalisé
      this.applyCrosshairCursor();

      // Réinitialiser les points
      this.points = [];

      // Désactiver temporairement les formes simples pour permettre le premier clic à l'intérieur
      this._disabledSimplePolygons = [];
      this._disabledSimpleRectangles = [];
      this._disabledCircles = [];
      this._disabledPolygons = [];
      this._disabledPanels = [];

      // Désactiver les polygones simples
      if (dc.simplePolygonManager && dc.simplePolygonManager.drawnSimplePolygons) {
        dc.simplePolygonManager.drawnSimplePolygons.forEach(simplePolygon => {
          if (simplePolygon.getMap()) {
            simplePolygon.setOptions({ clickable: false });
            this._disabledSimplePolygons.push(simplePolygon);
          }
        });
      }

      // Désactiver les rectangles simples
      if (dc.simpleRectangleManager && dc.simpleRectangleManager.drawnSimpleRectangles) {
        dc.simpleRectangleManager.drawnSimpleRectangles.forEach(simpleRectangle => {
          if (simpleRectangle.getMap()) {
            simpleRectangle.setOptions({ clickable: false });
            this._disabledSimpleRectangles.push(simpleRectangle);
          }
        });
      }

      // Désactiver les cercles
      if (dc.circleManager && dc.circleManager.drawnCircles) {
        dc.circleManager.drawnCircles.forEach(circle => {
          if (circle.getMap()) {
            circle.setOptions({ clickable: false });
            this._disabledCircles.push(circle);
          }
        });
      }

      // Désactiver les formes PV existantes
      if (dc.drawnShapes) {
        dc.drawnShapes.forEach(shape => {
          if (shape.getMap()) {
            shape.setOptions({ clickable: false });
            this._disabledPolygons.push(shape);
          }
        });
      }

      // Désactiver aussi tous les panneaux solaires
      if (this.createdPanelsByShape) {
        this.createdPanelsByShape.forEach((panels, pvId) => {
          panels.forEach(panel => {
            if (panel.getMap() && !panel.isMarginVisual) {
              panel.setOptions({ clickable: false });
              this._disabledPanels.push(panel);
            }
          });
        });
      }

      // Nettoyer d'abord tous les écouteurs existants
      if (this._clickListener) {
        google.maps.event.removeListener(this._clickListener);
        this._clickListener = null;
      }

      if (this._mouseMoveListener) {
        google.maps.event.removeListener(this._mouseMoveListener);
        this._mouseMoveListener = null;
      }

      // Ajouter l'écouteur de clic
      this._clickListener = google.maps.event.addListener(
        dc.map,
        "click",
        (e) => {
          console.log("[LineToPolygon] Événement 'click' natif capté sur la carte.");
          if (this.isActive) {
            // Petite temporisation pour éviter les déclenchements accidentels
            setTimeout(() => {
              this.handleClick(e.latLng);
            }, 50);
          }
        }
      );
    }

    // Stocker la référence au bouton
    this.button = button;
  }

  /**
   * Applique un curseur en croix personnalisé et plus visible
   */
  applyCrosshairCursor() {
    const dc = this.drawingControl;

    // Ajouter le style de curseur personnalisé s'il n'existe pas déjà
    if (!document.getElementById("crosshair-cursor-style")) {
      const style = document.createElement("style");
      style.id = "crosshair-cursor-style";
      style.textContent = `
        .line-to-polygon-cursor, 
        .line-to-polygon-cursor .gm-style > div {
          cursor: crosshair !important;
        }
        .gm-style {
          cursor: crosshair !important;
        }
      `;
      document.head.appendChild(style);
    }

    // Appliquer la classe au body
    document.body.classList.add("line-to-polygon-cursor");

    // Appliquer aussi le curseur directement sur la carte pour assurer la compatibilité
    dc.map.setOptions({ draggableCursor: "crosshair" });
  }

  /**
   * Nettoie les éléments temporaires du mode ligne vers polygone
   */
  clearTemp() {
    if (this.tempLine) {
      this.tempLine.setMap(null);
      this.tempLine = null;
    }

    // Nouveau: nettoyer le polygone temporaire
    if (this.tempPolygon) {
      this.tempPolygon.setMap(null);
      this.tempPolygon = null;
    }

    this.points = [];

    // Nettoyer tous les panneaux solaires temporaires seulement
    // (Les panneaux des formes finalisées restent intacts)

    if (this._clickListener) {
      google.maps.event.removeListener(this._clickListener);
      this._clickListener = null;
    }

    if (this._mouseMoveListener) {
      google.maps.event.removeListener(this._mouseMoveListener);
      this._mouseMoveListener = null;
    }

    // S'assurer que le verrouillage est réinitialisé
    this._isProcessingClick = false;

    // Nettoyer les détecteurs de côtés
    this.clearSideDetectors();
    this.endSideDrag();

    // Réactiver toutes les implantations qui avaient été désactivées
    if (this._disabledPolygons) {
      this._disabledPolygons.forEach(shape => {
        shape.setOptions({ clickable: true });
      });
      this._disabledPolygons = [];
    }

    // Réactiver tous les panneaux
    if (this._disabledPanels) {
      this._disabledPanels.forEach(panel => {
        panel.setOptions({ clickable: true });
      });
      this._disabledPanels = [];
    }

    // Réactiver les formes simples qui avaient été désactivées
    if (this._disabledSimplePolygons) {
      this._disabledSimplePolygons.forEach(simplePolygon => {
        simplePolygon.setOptions({ clickable: true });
      });
      this._disabledSimplePolygons = [];
    }

    if (this._disabledSimpleRectangles) {
      this._disabledSimpleRectangles.forEach(simpleRectangle => {
        simpleRectangle.setOptions({ clickable: true });
      });
      this._disabledSimpleRectangles = [];
    }

    if (this._disabledCircles) {
      this._disabledCircles.forEach(circle => {
        circle.setOptions({ clickable: true });
      });
      this._disabledCircles = [];
    }
  }

  /**
   * Gère les clics sur la carte pour le processus de dessin en 3 étapes
   * @param {google.maps.LatLng} latLng - Position du clic
   */
  handleClick(latLng) {
    const dc = this.drawingControl;
    console.log(`[LineToPolygon] handleClick exécuté. Nombre de points actuel: ${this.points.length}`);

    // Vérifier si le niveau de zoom est suffisant
    if (dc.map && dc.map.getZoom() < dc.DRAWING_CONSTANTS.MIN_ZOOM_LEVEL) {
      dc.errorModal.show(
        `Zoom minimum requis: ${dc.DRAWING_CONSTANTS.MIN_ZOOM_LEVEL}`
      );
      return;
    }

    // Ajouter un verrouillage pour éviter les clics multiples
    if (this._isProcessingClick) {
      return;
    }

    // Activer le verrouillage
    this._isProcessingClick = true;

    try {
      if (this.points.length === 0) {
        this.handleFirstClick(latLng);
      } else if (this.points.length === 1) {
        this.handleSecondClick(latLng);
      } else if (this.points.length === 2) {
        this.handleThirdClick(latLng);
      }
    } catch (error) {
      console.error("Erreur lors de la création line-to-polygon:", error);
      this.clearTemp();
    } finally {
      // Toujours désactiver le verrouillage à la fin
      this._isProcessingClick = false;
    }
  }

  /**
   * Gère le premier clic - création de la ligne temporaire
   * @param {google.maps.LatLng} latLng - Position du premier clic
   */
  handleFirstClick(latLng) {
    const dc = this.drawingControl;
    console.log("[LineToPolygon] handleFirstClick: Enregistrement du premier point.");

    // Stocker le premier point
    this.points.push(latLng);

    // Style aligné sur ./calepinage_rectangulaire.js (tempPvLine) pour une expérience de
    // tracé visuellement cohérente avec le moteur Terra Draw.
    this.tempLine = new google.maps.Polyline({
      path: [latLng, latLng], // Deux points identiques au début
      strokeColor: "#FF9800",
      strokeWeight: 2,
      strokeOpacity: 1,
      map: dc.map,
      zIndex: 1000,
      clickable: false,
    });

    // Les formes simples sont déjà désactivées dès l'activation du mode dans toggleMode()
    // Pas besoin de les désactiver à nouveau ici

    // Nettoyer l'écouteur de mouvement précédent s'il existe
    if (this._mouseMoveListener) {
      google.maps.event.removeListener(this._mouseMoveListener);
    }

    // Utiliser l'API Google Maps native pour une précision géographique parfaite
    this._mouseMoveListener = google.maps.event.addListener(dc.map, 'mousemove', (e) => {
      if (this.tempLine && this.points.length === 1) {
        const path = this.tempLine.getPath();
        path.setAt(1, e.latLng);
      }
    });
  }

  /**
   * Gère le deuxième clic - fixation de la ligne et début du rectangle
   * @param {google.maps.LatLng} latLng - Position du deuxième clic
   */
  handleSecondClick(latLng) {
    const dc = this.drawingControl;
    console.log("[LineToPolygon] handleSecondClick: Enregistrement du deuxième point.");

    // Calculer la distance
    const distance = google.maps.geometry.spherical.computeDistanceBetween(
      this.points[0],
      latLng
    );

    // Vérifier que la distance est suffisante
    if (distance < dc.DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION) {
      dc.errorModal.show(
        "La ligne doit être d'au moins " +
        dc.DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION +
        " mètres."
      );
      return;
    }

    // Stocker le deuxième point
    this.points.push(latLng);

    // Fixer la ligne temporaire
    this.tempLine.setPath([this.points[0], this.points[1]]);

    // Créer le polygone temporaire — style aligné sur ./calepinage_rectangulaire.js (tempPvPoly)
    this.tempPolygon = new google.maps.Polygon({
      paths: [this.points[0], this.points[1], this.points[1], this.points[0]], // Rectangle dégénéré au début
      fillColor: "#FFC107",
      fillOpacity: 0.35,
      strokeWeight: 2,
      strokeColor: "#FF9800",
      strokeOpacity: 1,
      map: dc.map,
      zIndex: 1000,
      clickable: false,
    });

    // Désactiver temporairement toutes les implantations existantes ET leurs panneaux
    this._disabledPolygons = [];
    this._disabledPanels = [];

    dc.drawnShapes.forEach(shape => {
      if (shape.getMap()) {
        shape.setOptions({ clickable: false });
        this._disabledPolygons.push(shape);
      }
    });

    // Désactiver aussi tous les panneaux solaires
    this.createdPanelsByShape.forEach((panels, pvId) => {
      panels.forEach(panel => {
        if (panel.getMap() && !panel.isMarginVisual) {
          panel.setOptions({ clickable: false });
          this._disabledPanels.push(panel);
        }
      });
    });

    // Mettre à jour l'écouteur de mouvement pour le rectangle
    if (this._mouseMoveListener) {
      google.maps.event.removeListener(this._mouseMoveListener);
    }

    // Remplacer par un écouteur de mouvement natif Google Maps pour la précision
    this._mouseMoveListener = google.maps.event.addListener(dc.map, 'mousemove', (e) => {
      this.updateTempPolygon(e.latLng);
    });

    // NOTA: On ne supprime PAS this._clickListener ici car il va naturellement capter le 3ème clic finalisant la forme.
  }

  /**
 * Met à jour le polygone temporaire pendant le mouvement de la souris
 * @param {google.maps.LatLng} mousePos - Position actuelle de la souris
 */
  updateTempPolygon(mousePos) {
    if (!this.tempPolygon || this.points.length !== 2) return;

    // Même calcul que ./calepinage_rectangulaire.js (calculateRectPoints), pour un rendu
    // du rectangle en cours de tracé identique à celui du moteur Terra Draw.
    const point1 = this.points[0];
    const point2 = this.points[1];
    const rectPoints = calculateRectPoints(point1, point2, mousePos);
    this.tempPolygon.setPath(rectPoints);
  }

  /**
   * Gère le troisième clic - finalisation du rectangle
   * @param {google.maps.LatLng} latLng - Position du troisième clic
   */
  handleThirdClick(latLng) {
    const dc = this.drawingControl;
    console.log("[LineToPolygon] handleThirdClick: Finalisation du rectangle.");

    // Calculer les dimensions finales du rectangle
    const point1 = this.points[0];
    const point2 = this.points[1];

    // Utiliser la position actuelle du polygone temporaire pour les dimensions finales
    const tempPath = this.tempPolygon.getPath();
    const corner3 = tempPath.getAt(2);
    const corner4 = tempPath.getAt(3);

    // Calculer la largeur finale
    const width = google.maps.geometry.spherical.computeDistanceBetween(point2, corner3);

    // Vérifier que la largeur est suffisante
    if (width < dc.DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION) {
      dc.errorModal.show(
        "La largeur doit être d'au moins " +
        dc.DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION +
        " mètres."
      );
      return;
    }

    // Désactiver tous les écouteurs
    if (this._mouseMoveListener) {
      google.maps.event.removeListener(this._mouseMoveListener);
      this._mouseMoveListener = null;
    }

    if (this._clickListener) {
      google.maps.event.removeListener(this._clickListener);
      this._clickListener = null;
    }

    // Supprimer les éléments temporaires
    if (this.tempLine) {
      this.tempLine.setMap(null);
      this.tempLine = null;
    }

    if (this.tempPolygon) {
      this.tempPolygon.setMap(null);
      this.tempPolygon = null;
    }

    // Réactiver toutes les implantations qui avaient été désactivées
    if (this._disabledPolygons) {
      this._disabledPolygons.forEach(shape => {
        shape.setOptions({ clickable: true });
      });
      this._disabledPolygons = [];
    }

    // Réactiver tous les panneaux
    if (this._disabledPanels) {
      this._disabledPanels.forEach(panel => {
        panel.setOptions({ clickable: true });
      });
      this._disabledPanels = [];
    }

    // Réactiver les formes simples qui avaient été désactivées
    if (this._disabledSimplePolygons) {
      this._disabledSimplePolygons.forEach(simplePolygon => {
        simplePolygon.setOptions({ clickable: true });
      });
      this._disabledSimplePolygons = [];
    }

    if (this._disabledSimpleRectangles) {
      this._disabledSimpleRectangles.forEach(simpleRectangle => {
        simpleRectangle.setOptions({ clickable: true });
      });
      this._disabledSimpleRectangles = [];
    }

    if (this._disabledCircles) {
      this._disabledCircles.forEach(circle => {
        circle.setOptions({ clickable: true });
      });
      this._disabledCircles = [];
    }

    // Créer le polygone final
    const polygon = this.createFinalPolygon(point1, point2, corner3, corner4);

    // Préparer un nouveau tracé si le mode est toujours actif
    this.points = [];
    if (this.isActive) {
      // S'assurer que le curseur reste en mode dessin
      this.applyCrosshairCursor();

      // Réactiver l'écouteur de clic sur la carte pour enchaîner les implantations
      this._clickListener = google.maps.event.addListener(
        dc.map,
        "click",
        (e) => {
          if (this.isActive) {
            setTimeout(() => {
              this.handleClick(e.latLng);
            }, 50);
          }
        }
      );
    } else {
      // Si le mode a été désactivé ailleurs (ex: ESC), nettoyer le curseur
      document.body.classList.remove("line-to-polygon-cursor");
      dc.map.setOptions({ draggableCursor: null });
      if (this.button) {
        this.button.classList.remove("selected");
        this.button.style.backgroundColor = dc.STYLES.DEFAULT_BUTTON.backgroundColor;
        dc.activeButton = null;
      }
    }

    // Mettre à jour l'input d'azimuth dans le formulaire
    setTimeout(() => {
      try {
        const azimuth = GeometryUtils.getWidthAzimuth(polygon);
        polygon.rotation = azimuth;
        const formInput = document.querySelector(`#azimuth-${polygon.pvId}`);
        if (formInput) {
          formInput.value = Math.round(azimuth);
          formInput.dispatchEvent(new Event("change"));
        }
      } catch (error) {
        console.error("Erreur lors de la mise à jour de l'azimuth:", error);
      }
    }, 500);
  }

  /**
* Normalise l'ordre des points du rectangle pour garantir un ordre cohérent
* Ordre final : [bas-gauche, bas-droite, haut-droite, haut-gauche] (sens horaire depuis le bas-gauche)
* @param {Array<google.maps.LatLng>} corners - Les 4 coins du rectangle
* @returns {Array<google.maps.LatLng>} Points réordonnés
*/
  normalizePointOrder(corners) {
    if (corners.length !== 4) return corners;

    // Calculer le centroïde du rectangle
    let centerLat = 0, centerLng = 0;
    corners.forEach(corner => {
      centerLat += corner.lat();
      centerLng += corner.lng();
    });
    centerLat /= 4;
    centerLng /= 4;
    const center = new google.maps.LatLng(centerLat, centerLng);

    // Classer chaque point selon sa position par rapport au centre
    const classifiedPoints = corners.map(corner => {
      const isNorth = corner.lat() > center.lat();
      const isEast = corner.lng() > center.lng();

      let position;
      if (!isNorth && !isEast) position = 'bottom-left';    // Sud-Ouest
      else if (!isNorth && isEast) position = 'bottom-right'; // Sud-Est  
      else if (isNorth && isEast) position = 'top-right';     // Nord-Est
      else position = 'top-left';                             // Nord-Ouest

      return { point: corner, position };
    });

    // Réordonner dans l'ordre : bas-gauche, bas-droite, haut-droite, haut-gauche
    const orderedPositions = ['bottom-left', 'bottom-right', 'top-right', 'top-left'];
    const orderedPoints = [];

    orderedPositions.forEach(targetPosition => {
      const found = classifiedPoints.find(cp => cp.position === targetPosition);
      if (found) {
        orderedPoints.push(found.point);
      }
    });

    return orderedPoints.length === 4 ? orderedPoints : corners;
  }


  /**
   * Crée le polygone final à partir des quatre coins calculés
   * @param {google.maps.LatLng} corner1 - Premier coin
   * @param {google.maps.LatLng} corner2 - Deuxième coin  
   * @param {google.maps.LatLng} corner3 - Troisième coin
   * @param {google.maps.LatLng} corner4 - Quatrième coin
   * @returns {google.maps.Polygon} Le polygone créé
   */
  createFinalPolygon(corner1, corner2, corner3, corner4) {
    const dc = this.drawingControl;
    console.log("[LineToPolygon] createFinalPolygon: Génération de la forme finale Google Maps.");
    try {

      // *** NORMALISER L'ORDRE DES POINTS AVANT CRÉATION ***
      const normalizedCorners = this.normalizePointOrder([corner1, corner2, corner3, corner4]);

      // Maintenant utiliser les points normalisés
      const [nCorner1, nCorner2, nCorner3, nCorner4] = normalizedCorners;

      // Calculer les dimensions réelles
      const side1 = google.maps.geometry.spherical.computeDistanceBetween(nCorner1, nCorner2);
      const side2 = google.maps.geometry.spherical.computeDistanceBetween(nCorner2, nCorner3);

      // Assigner longueur/largeur selon la taille
      let length, width, lengthIndices, widthIndices;
      if (side1 >= side2) {
        length = side1;
        width = side2;
        lengthIndices = [0, 2]; // côtés corner1-corner2 et corner3-corner4
        widthIndices = [1, 3];  // côtés corner2-corner3 et corner4-corner1
      } else {
        length = side2;
        width = side1;
        lengthIndices = [1, 3]; // côtés corner2-corner3 et corner4-corner1
        widthIndices = [0, 2];  // côtés corner1-corner2 et corner3-corner4
      }

      // Calculer l'angle de la largeur du polygon
      const widthHeading = google.maps.geometry.spherical.computeHeading(nCorner2, nCorner3);

      // Créer le polygone avec les quatre coins
      const polygon = new google.maps.Polygon({
        paths: [nCorner1, nCorner2, nCorner3, nCorner4],
        fillColor: dc.STYLES.DEFAULT_SHAPE.fillColor,
        fillOpacity: dc.STYLES.DEFAULT_SHAPE.fillOpacity,
        strokeWeight: dc.STYLES.DEFAULT_SHAPE.strokeWeight,
        strokeColor: dc.STYLES.DEFAULT_SHAPE.strokeColor,
        strokeOpacity: dc.STYLES.DEFAULT_SHAPE.strokeOpacity,
        zIndex: dc.STYLES.DEFAULT_SHAPE.zIndex,
        editable: false,
        draggable: true,
        map: dc.map,
        clickable: true,
      });

      // Identifier cette forme comme un LineToPolygon en utilisant exactement la constante
      polygon.type = SHAPE_TYPES.LINE_TO_POLYGON;

      polygon._originalDimensions = {
        width: width,
        length: length,
      };

      // Stocker les indices de longueur/largeur pour les labels
      polygon._lengthIndices = lengthIndices;
      polygon._widthIndices = widthIndices;

      // Gérer l'angle de rotation
      polygon.rotation = widthHeading;

      const hadPvId = Boolean(polygon.pvId);
      // Ajouter à la liste des formes dessinées
      dc.drawnShapes.push(polygon);

      // Appeler handlePanelShapeComplete (qui gère désormais la liaison avec le formulaire pré-rempli)
      dc.ShapeHandler.handlePanelShapeComplete(dc, polygon);

      if (!hadPvId) {
        this.initializeDeletedIndicesForShape(polygon.pvId);
      }

      // IMPORTANT: Configurer explicitement les écouteurs d'événements
      dc.ShapeHandler.setupShapeListeners(dc, polygon);

      // Écouteurs pour mettre à jour les panneaux lors des transformations
      document.addEventListener(dc.CUSTOM_EVENTS.SHAPE_ROTATED, (event) => {
        if (event.detail.pvId === polygon.pvId && this.createdPanelsByShape.has(polygon.pvId)) {
          this.updatePanelsPosition(polygon);
        }
      });

      document.addEventListener(dc.CUSTOM_EVENTS.SHAPE_MOVED, (event) => {
        if (event.detail.pvId === polygon.pvId && this.createdPanelsByShape.has(polygon.pvId)) {
          this.updatePanelsPosition(polygon);
        }
      });

      google.maps.event.addListener(polygon, 'dragstart', () => {
        const bounds = new google.maps.LatLngBounds();
        polygon.getPath().forEach(p => bounds.extend(p));
        polygon._lastDragCenter = bounds.getCenter();
      });

      google.maps.event.addListener(polygon, 'drag', () => {
        if (!polygon._lastDragCenter) return;
        const bounds = new google.maps.LatLngBounds();
        polygon.getPath().forEach(p => bounds.extend(p));
        const newCenter = bounds.getCenter();

        const dLat = newCenter.lat() - polygon._lastDragCenter.lat();
        const dLng = newCenter.lng() - polygon._lastDragCenter.lng();
        polygon._lastDragCenter = newCenter;

        this.translateShapeElements(polygon.pvId, dLat, dLng);
        this.updateSideDetectors(polygon);
      });

      google.maps.event.addListener(polygon, 'dragend', () => {
        this.updateSideDetectors(polygon);
      });

      // Sélectionner la forme
      dc.setSelection(polygon);

      // Ajout : permettre la sélection et le redimensionnement de n'importe quel PV
      google.maps.event.addListener(polygon, 'click', () => {
        dc.setSelection(polygon);
        // Mettre à jour le currentPolygon et les détecteurs de côtés pour ce polygone
        this.currentPolygon = polygon;
        this.clearSideDetectors();
        this.createSideDetectors(polygon);
      });

      // Mettre à jour l'azimuth dans le formulaire
      setTimeout(() => {
        try {
          const formInput = document.querySelector(`#azimuth-${polygon.pvId}`);
          if (formInput) {
            formInput.value = Math.round(widthHeading);
            formInput.dispatchEvent(new Event("change"));
          }
        } catch (error) {
          console.error("Erreur lors de la mise à jour de l'azimuth:", error);
        }
      }, 500);

      // Mettre à jour les inputs du formulaire dès la création
      setTimeout(() => {
        dc.calculateAndUpdatePanelInputs(polygon);
      }, 600);

      // inverser les dimensions dans l'événement
      document.dispatchEvent(
        new CustomEvent(dc.CUSTOM_EVENTS.LINE_TO_POLYGON_CREATED, {
          detail: {
            pvId: polygon.pvId,
            length: length,
            width: width,
            rotation: widthHeading,
          },
        })
      );


      // Créer les panneaux solaires automatiquement
      console.log("[LineToPolygon] Appel de createSolarPanels()");
      this.createSolarPanels(polygon);

      this.enableSideResizing(polygon);
      return polygon;
    } catch (error) {
      console.error("[LineToPolygon] Erreur critique dans createFinalPolygon :", error);
      dc.errorModal.show("Erreur lors de la finalisation de la forme. Consultez la console.");
    }
  }

  /**
 * Met à jour les détecteurs pour un polygone spécifique (appelé lors de la sélection)
 * @param {google.maps.Polygon} polygon - Le polygone sélectionné
 */
  updateDetectorsForPolygon(polygon) {
    if (polygon.type === SHAPE_TYPES.LINE_TO_POLYGON) {
      this.currentPolygon = polygon;
      this.clearSideDetectors();
      this.createSideDetectors(polygon);
    }
  }

  /**
   * Tente de restaurer un panneau supprimé à la position donnée sur le polygone parent
   * @param {google.maps.Polygon} parentPolygon
   * @param {google.maps.LatLng} latLng
   */
  tryRestoreDeletedPanelAt(parentPolygon, latLng) {
    if (!this.boolShowHide) {
      return;
    }

    const pvId = parentPolygon.pvId;
    const deletedPanels = DeletedPanelsStorage.load().filter(
      (panel) =>
        panel.pvId === pvId &&
        (!panel.shapeType || panel.shapeType === SHAPE_TYPES.LINE_TO_POLYGON)
    );
    if (!deletedPanels.length) return;

    // Récupérer la configuration et la géométrie actuelle du polygone parent
    const panelConfig = this.getPanelConfigFromForm(pvId);

    const typeCouvertureEl = document.querySelector(`#type_de_structure-${pvId}`) || document.querySelector(`select[id^="type_de_structure"]`);
    const referenceSIEl = document.querySelector(`#referenceSI-${pvId}`) || document.querySelector(`select[id^="referenceSI"]`);
    const typeCouverture = typeCouvertureEl ? typeCouvertureEl.value : null;
    const referenceSI = referenceSIEl ? referenceSIEl.value : null;
    let dX = 0, dY = 0;
    if (typeCouverture && referenceSI && TYPE_COUVERTURE_MAP && TYPE_COUVERTURE_MAP[typeCouverture]) {
      const siData = TYPE_COUVERTURE_MAP[typeCouverture].find(s => s.id === referenceSI);
      if (siData) {
        dX = parseFloat(siData.dX || 0) / 1000;
        dY = parseFloat(siData.dY || 0) / 1000;
        if (siData.x !== undefined && !isNaN(parseFloat(siData.x))) panelConfig.spacingX = parseFloat(siData.x) / 1000;
        if (siData.y !== undefined && !isNaN(parseFloat(siData.y))) panelConfig.spacingY = parseFloat(siData.y) / 1000;
      }
    }

    const jointDilatationInput = document.querySelector(`#joint_dilatation-${pvId}`);
    const limitDilatationInput = document.querySelector(`#limit_dilatation_m-${pvId}`);
    const jointDilatationVal = jointDilatationInput ? parseFloat(jointDilatationInput.value) / 1000 : 0;
    const limitDilatationVal = limitDilatationInput ? parseFloat(limitDilatationInput.value) : 0;

    const penteTypeSelect = document.querySelector(`#toiture_pente_type-${pvId}`) || document.getElementById('toiture_pente_type');
    const penteType = penteTypeSelect ? penteTypeSelect.value : 'Monopente';

    const pente1Input = document.querySelector(`#pente-${pvId}`) || document.getElementById('pente') || document.querySelector(`#inclinaison-${pvId}`) || document.getElementById('inclinaison');
    let pente1 = pente1Input ? parseFloat(pente1Input.value) : 0;
    const pente2Input = document.querySelector(`#pente2-${pvId}`) || document.getElementById('pente2');
    let pente2 = pente2Input ? parseFloat(pente2Input.value) : pente1;

    const isFlat = typeCouverture === 'Toiture terasse' || typeCouverture === 'Petit champ solaire';
    if (isFlat) {
      const tiltInput = document.querySelector(`#inclinaison-top-${pvId}`) || document.getElementById('inclinaison-top') || document.querySelector(`#inclinaison-${pvId}`) || document.getElementById('inclinaison');
      pente1 = tiltInput ? parseFloat(tiltInput.value) || 0 : 0;
      pente2 = pente1;
    }

    const faitageInput = document.querySelector(`#largeur_faitage_mm-${pvId}`) || document.getElementById('largeur_faitage_mm');
    const fValRestore = faitageInput ? parseFloat(faitageInput.value) : NaN;
    const faitageBuffer = !isNaN(fValRestore) ? fValRestore / 1000 : 0.5;
    const asymInput = document.querySelector(`#asymetrie_percent-${pvId}`) || document.getElementById('asymetrie_percent');
    const aValRestore = asymInput ? parseFloat(asymInput.value) : NaN;
    const asymetrie = !isNaN(aValRestore) ? aValRestore / 100 : 0.4;

    const path = parentPolygon.getPath();
    const corner1 = path.getAt(0);
    const corner2 = path.getAt(1);
    const corner3 = path.getAt(2);
    const corner4 = path.getAt(3);

    const lengthIndices = parentPolygon._lengthIndices || [0, 2];
    const indicesInverted = !(lengthIndices.includes(0) && lengthIndices.includes(2));

    let mainLength, mainWidth, startCorner, targetCornerForWidth;
    if (!indicesInverted) {
      mainLength = google.maps.geometry.spherical.computeDistanceBetween(corner1, corner2);
      mainWidth = google.maps.geometry.spherical.computeDistanceBetween(corner2, corner3);
      startCorner = corner1;
      targetCornerForWidth = corner4;
    } else {
      mainLength = google.maps.geometry.spherical.computeDistanceBetween(corner2, corner3);
      mainWidth = google.maps.geometry.spherical.computeDistanceBetween(corner1, corner2);
      startCorner = corner2;
      targetCornerForWidth = corner1;
    }

    // Récupérer l'angle de rotation des panneaux
    const panelsRotation = parentPolygon.panelsRotation || 0;

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

    const angleRad = Math.abs(panelsRotation) * Math.PI / 180;
    const effectivePanelLength = Math.abs(panelLength * Math.cos(angleRad)) + Math.abs(panelWidth * Math.sin(angleRad));
    const effectivePanelWidth = Math.abs(panelLength * Math.sin(angleRad)) + Math.abs(panelWidth * Math.cos(angleRad));

    const heading = google.maps.geometry.spherical.computeHeading(startCorner, !indicesInverted ? corner2 : corner3);
    const headingToWidth = google.maps.geometry.spherical.computeHeading(startCorner, targetCornerForWidth);

    let angleDiff = headingToWidth - heading;
    if (angleDiff > 180) angleDiff -= 360;
    if (angleDiff < -180) angleDiff += 360;

    const perpHeading = angleDiff > 0 ? heading + 90 : heading - 90;

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
      return offsets;
    };

    const effMarginLen = panelConfig.margin + dX / 2;
    const centersAlong = computeOffsets(mainLength, effectivePanelLength, spacingX, effMarginLen, effMarginLen, limitDilatationVal, jointDilatationVal);

    let allWidthOffsets = [];
    const pans = [];
    if (penteType === 'Monopente') pans.push({ startFrac: 0, endFrac: 1, slope: pente1, startIsEave: true, endIsEave: true });
    else if (penteType === 'Bipente_symetrique') { pans.push({ startFrac: 0, endFrac: 0.5, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: 0.5, endFrac: 1, slope: pente1, startIsEave: false, endIsEave: true }); }
    else if (penteType === 'Bipente_asymetrique') { pans.push({ startFrac: 0, endFrac: asymetrie, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: asymetrie, endFrac: 1, slope: pente2, startIsEave: false, endIsEave: true }); }
    else if (penteType === 'Multipente') { pans.push({ startFrac: 0, endFrac: 0.25, slope: pente1, startIsEave: true, endIsEave: false }); pans.push({ startFrac: 0.25, endFrac: 0.5, slope: pente1, startIsEave: false, endIsEave: false }); pans.push({ startFrac: 0.5, endFrac: 0.75, slope: pente1, startIsEave: false, endIsEave: false }); pans.push({ startFrac: 0.75, endFrac: 1, slope: pente1, startIsEave: false, endIsEave: true }); }

    pans.forEach((pan) => {
      const panProjectedWidth = mainWidth * (pan.endFrac - pan.startFrac);
      const cosSlope = Math.max(Math.cos(pan.slope * Math.PI / 180), 0.1);

      let panRealWidth, currentEffWid, actualCosSlopeForProjection;
      if (isFlat) { // Pente toiture = 0°
        panRealWidth = panProjectedWidth;
        currentEffWid = effectivePanelWidth * cosSlope;
        actualCosSlopeForProjection = 1;
      } else { // Pente toiture > 0°
        panRealWidth = panProjectedWidth / cosSlope;
        currentEffWid = effectivePanelWidth;
        actualCosSlopeForProjection = cosSlope;
      }

      const startMargin = pan.startIsEave ? (panelConfig.margin + dY / 2) : (faitageBuffer / 2);
      const endMargin = pan.endIsEave ? (panelConfig.margin + dY / 2) : (faitageBuffer / 2);
      const offsets = computeOffsets(panRealWidth, currentEffWid, spacingY, startMargin, endMargin, limitDilatationVal, jointDilatationVal);
      const projectedOffsets = offsets.map(rOff => rOff * actualCosSlopeForProjection);
      const panStartProjectedOffset = mainWidth * pan.startFrac;
      const finalProjectedOffsets = projectedOffsets.map(pOff => panStartProjectedOffset + pOff);
      finalProjectedOffsets.forEach(off => allWidthOffsets.push(off));
    });

    // Pour chaque panneau supprimé, recalculer sa position actuelle (centre avec rotation)
    let minDist = Infinity;
    let closestPanel = null;

    deletedPanels.forEach(panel => {
      const [i, j] = panel.panelIndex.split('-').map(Number);

      // Calculer le centre du panneau (comme dans createSolarPanels)
      const lengthOffset = centersAlong[i];
      const widthOffset = allWidthOffsets[j];

      if (lengthOffset === undefined || widthOffset === undefined) return;

      const panelCenter = google.maps.geometry.spherical.computeOffset(
        google.maps.geometry.spherical.computeOffset(startCorner, lengthOffset, heading),
        widthOffset,
        perpHeading
      );

      const dist = google.maps.geometry.spherical.computeDistanceBetween(latLng, panelCenter);
      if (dist < minDist && dist < 2) { // 2 mètres de tolérance
        minDist = dist;
        closestPanel = panel;
      }
    });

    if (!closestPanel) return;

    const panelIndex = closestPanel.panelIndex;

    this.getDeletedIndexSet(pvId).delete(panelIndex);

    DeletedPanelsStorage.remove(
      (panel) =>
        panel.pvId === pvId &&
        panel.panelIndex === panelIndex &&
        (!panel.shapeType || panel.shapeType === SHAPE_TYPES.LINE_TO_POLYGON)
    );

    this.updatePanelsPosition(parentPolygon);
  }



  /**
 * Active la modification par les côtés pour un polygone LineToPolygon
 * @param {google.maps.Polygon} polygon - Le polygone à rendre modifiable
 */
  enableSideResizing(polygon) {

    // Nettoyer les anciens détecteurs
    this.clearSideDetectors();

    this.currentPolygon = polygon;
    this.createSideDetectors(polygon);

    // Écouteur pour les déplacements futurs
    google.maps.event.addListener(polygon, 'dragend', () => {
      this.updateSideDetectors(polygon);
    });

    // Désactiver l'édition native du polygone
    polygon.setOptions({ editable: false });
  }

  /**
   * Met à jour la position des panneaux lors du déplacement/rotation du polygone
   * @param {google.maps.Polygon} polygon - Le polygone principal
   */
  updatePanelsPosition(polygon) {

    const pvId = polygon.pvId;
    if (!this.createdPanelsByShape.has(pvId)) return;

    const panels = this.createdPanelsByShape.get(pvId);

    // Vérifier si les panneaux étaient visibles avant la transformation
    const panelsWereVisible = panels.length > 0 && panels.some(panel => panel.getMap());
    const hadPanels = panels.length > 0;

    // Supprimer les anciens panneaux
    panels.forEach(panel => panel.setMap(null));

    // Vider la liste des panneaux
    this.createdPanelsByShape.set(pvId, []);
    this.panelCountByShape.set(pvId, 0);

    // Recréer les panneaux si la forme possède déjà une grille
    if (hadPanels) {
      this.createSolarPanels(polygon);
      if (!panelsWereVisible) {
        const recreatedPanels = this.createdPanelsByShape.get(pvId) || [];
        recreatedPanels.forEach(panel => panel.setMap(null));
      }
    }

    // Mettre à jour les inputs après transformation
    setTimeout(() => {
      this.drawingControl.calculateAndUpdatePanelInputs(polygon);
    }, 150);

    setTimeout(() => {
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }
    }, 150);
  }

  /**
   * Crée les détecteurs invisibles pour chaque côté
   * @param {google.maps.Polygon} polygon - Le polygone source
   */
  createSideDetectors(polygon) {
    const path = polygon.getPath();
    const points = [
      path.getAt(0), path.getAt(1), path.getAt(2), path.getAt(3)
    ];

    // Créer 4 détecteurs pour les 4 côtés
    const sides = [
      { start: points[0], end: points[1], type: 'bottom' },
      { start: points[1], end: points[2], type: 'right' },
      { start: points[2], end: points[3], type: 'top' },
      { start: points[3], end: points[0], type: 'left' }
    ];

    sides.forEach(side => {
      const detector = new google.maps.Polyline({
        path: [side.start, side.end],
        strokeWeight: 12,
        strokeOpacity: 0, // Invisible
        map: this.drawingControl.map,
        zIndex: 1003,
        clickable: true
      });

      detector.sideType = side.type;
      detector.parentPolygon = polygon;

      // Événements de survol
      google.maps.event.addListener(detector, 'mouseover', () => {
        this.highlightSide(polygon, side.type, true);
        this.drawingControl.map.setOptions({ draggableCursor: side.type === 'left' || side.type === 'right' ? 'ew-resize' : 'ns-resize' });
        polygon.setOptions({ clickable: false });
      });

      google.maps.event.addListener(detector, 'mouseout', () => {
        if (!this.isDragging) {
          this.highlightSide(polygon, side.type, false);
          this.drawingControl.map.setOptions({ draggableCursor: null });
          polygon.setOptions({ clickable: true });
        }
      });

      // Événement de début de glissement
      google.maps.event.addListener(detector, 'mousedown', (event) => {
        // Si on clique sur le côté en cours de modification, arrêter
        if (this.isDragging && this.draggedSide === side.type) {
          this.endSideDrag();
          event.stop();
          return;
        }

        // Sinon, démarrer la modification normalement
        if (!this.isDragging) {
          this.startSideDrag(side.type, event);
        }
      });

      this.sideDetectors.push(detector);
    });
  }

  /**
   * Met en surbrillance un côté spécifique
   * @param {google.maps.Polygon} polygon - Le polygone
   * @param {string} sideType - Type de côté (top, right, bottom, left)
   * @param {boolean} highlight - Activer/désactiver la surbrillance
   */
  highlightSide(polygon, sideType, highlight) {
    const strokeColor = highlight ? '#FF4081' : this.drawingControl.STYLES.DEFAULT_SHAPE.strokeColor;
    const strokeWeight = highlight ? 4 : this.drawingControl.STYLES.DEFAULT_SHAPE.strokeWeight;

    polygon.setOptions({
      strokeColor: strokeColor,
      strokeWeight: strokeWeight
    });
  }

  /**
   * Démarre le processus de glissement d'un côté
   * @param {string} sideType - Type de côté
   * @param {google.maps.MouseEvent} event - Événement de la souris
   */
  startSideDrag(sideType, event) {
    this.isDragging = true;
    this.draggedSide = sideType;
    this.initialMousePos = event.latLng;

    // Écouteurs globaux pour le glissement
    this.mouseMoveListener = google.maps.event.addListener(this.drawingControl.map, 'mousemove', (e) => {
      this.handleSideDrag(e);
    });

    this.mouseUpListener = google.maps.event.addListener(this.drawingControl.map, 'mouseup', () => {
      this.endSideDrag();
    });

    // Empêcher la propagation
    event.stop();
  }

  /**
   * Gère le glissement en cours
   * @param {google.maps.MouseEvent} event - Événement de mouvement
   */
  handleSideDrag(event) {
    if (!this.isDragging || !this.currentPolygon) return;

    const currentPos = event.latLng;
    const path = this.currentPolygon.getPath();
    const points = [
      path.getAt(0), path.getAt(1), path.getAt(2), path.getAt(3)
    ];

    let newDimensions = this.calculateNewDimensions(points, currentPos);

    if (newDimensions.width >= this.drawingControl.DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION &&
      newDimensions.length >= this.drawingControl.DRAWING_CONSTANTS.MIN_SHAPE_DIMENSION) {

      this.updatePolygonDimensions(this.currentPolygon, newDimensions);
      this.updateSideDetectors(this.currentPolygon);
    }
  }

  /**
   * Calcule les nouvelles dimensions basées sur la position de la souris
   * @param {Array} points - Points actuels du polygone
   * @param {google.maps.LatLng} mousePos - Position actuelle de la souris
   * @returns {Object} Nouvelles dimensions {width, length}
   */
  calculateNewDimensions(points, mousePos) {
    // Figer l'orientation pour éviter l'inversion longueur/largeur
    const lengthEdge = google.maps.geometry.spherical.computeDistanceBetween(points[0], points[1]);
    const widthEdge = google.maps.geometry.spherical.computeDistanceBetween(points[0], points[3]);
    const currentLength = lengthEdge;
    const currentWidth = widthEdge;

    let newLength = currentLength;
    let newWidth = currentWidth;

    if (this.draggedSide === 'left' || this.draggedSide === 'right') {
      // Modifier la longueur
      const baseLine = this.draggedSide === 'right' ? [points[0], points[3]] : [points[1], points[2]];
      const distance = this.calculatePerpendicularDistance(mousePos, baseLine[0], baseLine[1]);
      newLength = Math.abs(distance);
    }

    else if (this.draggedSide === 'bottom' || this.draggedSide === 'top') {
      // Modifier la largeur
      const baseLine = this.draggedSide === 'top' ? [points[0], points[1]] : [points[2], points[3]];
      const distance = this.calculatePerpendicularDistance(mousePos, baseLine[0], baseLine[1]);
      newWidth = Math.abs(distance);
    }

    return { width: newWidth, length: newLength };
  }

  /**
   * Calcule la distance perpendiculaire d'un point à une ligne
   * @param {google.maps.LatLng} point - Point à mesurer
   * @param {google.maps.LatLng} lineStart - Début de la ligne
   * @param {google.maps.LatLng} lineEnd - Fin de la ligne
   * @returns {number} Distance perpendiculaire en mètres
   */
  calculatePerpendicularDistance(point, lineStart, lineEnd) {
    const heading = google.maps.geometry.spherical.computeHeading(lineStart, lineEnd);
    const distanceToStart = google.maps.geometry.spherical.computeDistanceBetween(lineStart, point);
    const headingToPoint = google.maps.geometry.spherical.computeHeading(lineStart, point);

    const relativeAngle = headingToPoint - heading;
    const perpDistance = distanceToStart * Math.sin(relativeAngle * Math.PI / 180);

    return perpDistance;
  }

  /**
   * Met à jour les dimensions du polygone
   * @param {google.maps.Polygon} polygon - Polygone à modifier
   * @param {Object} dimensions - Nouvelles dimensions
   */
  updatePolygonDimensions(polygon, dimensions) {
    // Utiliser la méthode existante
    this.resizeLineToPolygon(polygon, dimensions);

    // Mettre à jour les dimensions stockées
    polygon._originalDimensions = dimensions;
  }

  /**
   * Met à jour la position des détecteurs de côtés
   * @param {google.maps.Polygon} polygon - Polygone source
   */
  updateSideDetectors(polygon) {
    const path = polygon.getPath();
    const points = [
      path.getAt(0), path.getAt(1), path.getAt(2), path.getAt(3)
    ];

    const sides = [
      [points[0], points[1]], // bottom
      [points[1], points[2]], // right
      [points[2], points[3]], // top
      [points[3], points[0]]  // left
    ];

    this.sideDetectors.forEach((detector, index) => {
      detector.setPath(sides[index]);
    });
  }

  /**
   * Termine le processus de glissement
   */
  endSideDrag() {
    this.isDragging = false;
    this.draggedSide = null;

    // Nettoyer les écouteurs
    if (this.mouseMoveListener) {
      google.maps.event.removeListener(this.mouseMoveListener);
      this.mouseMoveListener = null;
    }

    if (this.mouseUpListener) {
      google.maps.event.removeListener(this.mouseUpListener);
      this.mouseUpListener = null;
    }

    // Restaurer l'apparence normale
    if (this.currentPolygon) {
      this.highlightSide(this.currentPolygon, '', false);

      // AJOUT : Déclencher l'événement dragend pour simuler un déplacement
      setTimeout(() => {
        google.maps.event.trigger(this.currentPolygon, 'dragend');
      }, 50);

    }

    this.drawingControl.map.setOptions({ draggableCursor: null });
  }

  /**
   * Nettoie les détecteurs de côtés
   */
  clearSideDetectors() {
    this.sideDetectors.forEach(detector => {
      detector.setMap(null);
    });
    this.sideDetectors = [];
  }

  /**
 * Récupère la configuration des panneaux depuis le formulaire
 * @param {string} pvId - ID de la forme
 * @returns {Object} Configuration des panneaux
 */
  getPanelConfigFromForm(pvId) {
    const longueurPanneauInput = document.querySelector(`#longueurPanneau-${pvId}`);
    const largeurPanneauInput = document.querySelector(`#largeurPanneau-${pvId}`);
    const espacementXInput = document.querySelector(`#espacementPanneauxX-${pvId}`);
    const espacementYInput = document.querySelector(`#espacementPanneauxY-${pvId}`);
    const espacementBordsInput = document.querySelector(`#espacementBords-${pvId}`);
    const portraitInput = document.querySelector(`#modePosePortrait-${pvId}`);
    const paysageInput = document.querySelector(`#modePosePaysage-${pvId}`);
    const shedsRowsInput = document.querySelector(`#shedsRows-${pvId}`);
    const shedsRowSpacingInput = document.querySelector(`#shedsRowSpacing-${pvId}`);
    const shedsColsInput = document.querySelector(`#shedsCols-${pvId}`);
    const shedsColSpacingInput = document.querySelector(`#shedsColSpacing-${pvId}`);

    // Valeurs par défaut
    const defaultConfig = {
      length: 2.0,
      width: 1.0,
      spacingX: PANEL_DIMENSIONS.DEFAULT_SPACING_MM / 1000,
      spacingY: PANEL_DIMENSIONS.DEFAULT_SPACING_MM / 1000,
      margin: 0.0
    };

    if (!longueurPanneauInput || !largeurPanneauInput || !espacementXInput || !espacementYInput) {
      return defaultConfig;
    }

    const baseLongueur = parseFloat(longueurPanneauInput.value) / 1000;
    const baseLargeur = parseFloat(largeurPanneauInput.value) / 1000;
    const isPortrait = portraitInput ? portraitInput.checked : false;
    const isPaysage = paysageInput ? paysageInput.checked : false;

    // Inverser les dimensions selon l'orientation
    let finalLength, finalWidth;
    if (isPortrait) {
      finalLength = baseLargeur; // l_pv sur l'axe X (largeur du panneau)
      finalWidth = baseLongueur; // L_pv sur l'axe Y (hauteur du panneau)
    } else if (isPaysage) {
      finalLength = baseLongueur;
      finalWidth = baseLargeur;
    } else {
      finalLength = baseLargeur || 1.0;
      finalWidth = baseLongueur || 2.0;
    }

    return {
      length: isNaN(finalLength) ? 0 : finalLength,
      width: isNaN(finalWidth) ? 0 : finalWidth,
      spacingX: parseFloat(espacementXInput.value) / 1000 || defaultConfig.spacingX,
      spacingY: parseFloat(espacementYInput.value) / 1000 || defaultConfig.spacingY,
      margin: parseFloat(espacementBordsInput?.value || 0) / 1000 || defaultConfig.margin,
      shedsEnabled: !!(shedsRowsInput || shedsColsInput || shedsRowSpacingInput || shedsColSpacingInput),
      shedsRows: Math.max(0, parseInt(shedsRowsInput?.value || '0', 10) || 0),
      shedsRowSpacing: Math.max(0, parseFloat(shedsRowSpacingInput?.value || '0') / 1000 || 0),
      shedsCols: Math.max(0, parseInt(shedsColsInput?.value || '0', 10) || 0),
      shedsColSpacing: Math.max(0, parseFloat(shedsColSpacingInput?.value || '0') / 1000 || 0)
    };
  }

  /**
   * Rafraîchit les panneaux solaires d'une forme avec la nouvelle configuration
   * @param {string} pvId - ID de la forme
   */
  refreshPanelsForShape(pvId) {
    // Trouver le polygone correspondant
    const polygon = this.drawingControl.drawnShapes.find(shape => shape.pvId === pvId);
    if (!polygon) return;

    // Vérifier si des panneaux existent déjà (visibles ou non)
    const hasExistingPanels = this.createdPanelsByShape.has(pvId) &&
      this.createdPanelsByShape.get(pvId).length > 0;

    // Supprimer les anciens panneaux s'ils existent
    if (hasExistingPanels) {
      this.cleanupPanelsForShape(pvId);
      // Recréer les panneaux avec la nouvelle configuration
      this.createSolarPanels(polygon);
    }
  }

  /**
   * Force l'affichage/mise à jour des panneaux solaires même s'ils n'existaient pas
   * @param {string} pvId - ID de la forme
   */
  forceUpdatePanels(pvId) {
    // Trouver le polygone correspondant
    const polygon = this.drawingControl.drawnShapes.find(shape => shape.pvId === pvId);
    if (!polygon) return;

    // Supprimer les anciens panneaux s'ils existent
    this.cleanupPanelsForShape(pvId);

    // Toujours créer de nouveaux panneaux
    this.createSolarPanels(polygon);
  }


  /**
   * Crée des panneaux solaires à l'intérieur du rectangle principal
   * @param {google.maps.Polygon} mainPolygon - Le rectangle principal
   */
  createSolarPanels(mainPolygon) {
    console.log("[LineToPolygon] createSolarPanels: Début du calcul et du tracé des panneaux.");
    try {
      const dc = this.drawingControl;
      const path = mainPolygon.getPath();
      const pvId = mainPolygon.pvId;
      const deletedIndexes = this.getDeletedIndexSet(pvId);
      const isGloballyHidden = this.hiddenByToggle.has(pvId);

      // CORRECTIF (crash navigateur sur grande surface) : au-delà de MAX_SHAPE_AREA_M2, les boucles
      // imbriquées plus bas peuvent générer des milliers de google.maps.Polygon (un par panneau,
      // chacun avec son propre listener) et geler le navigateur. Vérification AVANT toute
      // génération — les anciens panneaux ont déjà été nettoyés par l'appelant (refreshPanelsForShape/
      // forceUpdatePanels appellent systématiquement cleanupPanelsForShape() avant createSolarPanels()),
      // donc rien n'est laissé orphelin en sortant ici.
      const areaM2 = GeometryUtils.calculateArea(path.getArray());
      if (areaM2 > DRAWING_CONSTANTS.MAX_SHAPE_AREA_M2) {
        const msg = `Surface trop vaste (${Math.round(areaM2)} m², limite : ${DRAWING_CONSTANTS.MAX_SHAPE_AREA_M2} m²). Réduisez la taille de la forme avant de continuer.`;
        if (dc.errorModal) { dc.errorModal.show(msg); } else { alert(msg); }
        this.createdPanelsByShape.set(pvId, []);
        return;
      }

      // Récupérer la configuration des panneaux depuis le formulaire
      const panelConfig = this.getPanelConfigFromForm(pvId);

      // NOUVEAU: Extraction des deltas (dX, dY) et Joints de Dilatation
      const typeCouvertureEl = document.querySelector(`#type_de_structure-${pvId}`) || document.querySelector(`select[id^="type_de_structure"]`);
      const referenceSIEl = document.querySelector(`#referenceSI-${pvId}`) || document.querySelector(`select[id^="referenceSI"]`);
      const typeCouverture = typeCouvertureEl ? typeCouvertureEl.value : null;
      const referenceSI = referenceSIEl ? referenceSIEl.value : null;
      let dX = 0, dY = 0;
      if (typeCouverture && referenceSI && TYPE_COUVERTURE_MAP && TYPE_COUVERTURE_MAP[typeCouverture]) {
        const siData = TYPE_COUVERTURE_MAP[typeCouverture].find(s => s.id === referenceSI);
        if (siData) {
          dX = parseFloat(siData.dX || 0) / 1000;
          dY = parseFloat(siData.dY || 0) / 1000;
          // Lier de force les espacements X et Y à la référence SI lors du déclenchement
          if (siData.x !== undefined && !isNaN(parseFloat(siData.x))) panelConfig.spacingX = parseFloat(siData.x) / 1000;
          if (siData.y !== undefined && !isNaN(parseFloat(siData.y))) panelConfig.spacingY = parseFloat(siData.y) / 1000;
        }
      }

      // Récupérer les données de la toiture pour les exclusions du faîtage
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

      const faitageInput = document.querySelector(`#largeur_faitage_mm-${pvId}`) || document.getElementById('largeur_faitage_mm');
      const fVal = faitageInput ? parseFloat(faitageInput.value) : NaN;
      const faitageBuffer = !isNaN(fVal) ? fVal / 1000 : 0.5;
      const asymInput = document.querySelector(`#asymetrie_percent-${pvId}`) || document.getElementById('asymetrie_percent');
      const aVal = asymInput ? parseFloat(asymInput.value) : NaN;
      const asymetrie = !isNaN(aVal) ? aVal / 100 : 0.4;

      // Si aucune dimension de panneau n'est définie, ne rien faire.
      if (!panelConfig.length || !panelConfig.width) {
        // Nettoyer les panneaux existants et mettre à jour le formulaire pour afficher 0.
        this.cleanupPanelsForShape(pvId);
        if (dc && dc.FormHandler) {
          dc.FormHandler.updateFormGridInputs(pvId, 0, 0, 0, 0);
        }
        this.updateRoofVisuals(mainPolygon);
        return;
      }

      // Récupérer les coins du rectangle principal
      const corner1 = path.getAt(0);
      const corner2 = path.getAt(1);
      const corner3 = path.getAt(2);
      const corner4 = path.getAt(3);
      void corner3; void corner4; // conservés pour compatibilité avec le code existant plus bas (indices)

      // Utiliser les indices pour déterminer correctement les dimensions
      const lengthIndices = mainPolygon._lengthIndices || [0, 2];
      const widthIndices = mainPolygon._widthIndices || [1, 3];

      // Calculer les dimensions du rectangle principal selon les indices
      let mainLength, mainWidth;
      if (lengthIndices.includes(0) && lengthIndices.includes(2)) {
        // La longueur est sur les côtés 0->1 et 2->3
        mainLength = google.maps.geometry.spherical.computeDistanceBetween(corner1, corner2);
      } else {
        // La longueur est sur les côtés 1->2 et 3->0
        mainLength = google.maps.geometry.spherical.computeDistanceBetween(corner2, corner3);
      }

      if (widthIndices.includes(1) && widthIndices.includes(3)) {
        // La largeur est sur les côtés 1->2 et 3->0
        mainWidth = google.maps.geometry.spherical.computeDistanceBetween(corner2, corner3);
      } else {
        // La largeur est sur les côtés 0->1 et 2->3
        mainWidth = google.maps.geometry.spherical.computeDistanceBetween(corner1, corner2);
      }

      // Calculer l'orientation du rectangle principal selon les indices
      let heading;
      if (lengthIndices.includes(0) && lengthIndices.includes(2)) {
        // La longueur est sur les côtés 0->1 et 2->3
        heading = google.maps.geometry.spherical.computeHeading(corner1, corner2);
      } else {
        // La longueur est sur les côtés 1->2 et 3->0
        heading = google.maps.geometry.spherical.computeHeading(corner2, corner3);
      }

      // Calculer la direction perpendiculaire correcte (vers l'intérieur du rectangle)
      // Utiliser les indices pour déterminer le bon côté de largeur
      // Déterminer le point de départ pour la longueur et la largeur
      let startCorner, targetCornerForWidth;

      if (lengthIndices.includes(0) && lengthIndices.includes(2)) {
        // La longueur est sur les côtés 0->1 et 2->3, startCorner = corner1
        startCorner = corner1;
        if (widthIndices.includes(1) && widthIndices.includes(3)) {
          // La largeur est sur les côtés 1->2 et 3->0, donc depuis corner1, la largeur va vers corner4
          targetCornerForWidth = corner4;
        } else {
          // La largeur est sur les côtés 0->1 et 2->3, ce cas ne devrait pas arriver normalement
          targetCornerForWidth = corner2;
        }
      } else {
        // La longueur est sur les côtés 1->2 et 3->0, startCorner = corner2
        startCorner = corner2;
        if (widthIndices.includes(1) && widthIndices.includes(3)) {
          // La largeur est sur les côtés 1->2 et 3->0, ce cas ne devrait pas arriver normalement
          targetCornerForWidth = corner3;
        } else {
          // La largeur est sur les côtés 0->1 et 2->3, donc depuis corner2, la largeur va vers corner1
          targetCornerForWidth = corner1;
        }
      }

      const headingToWidth = google.maps.geometry.spherical.computeHeading(startCorner, targetCornerForWidth);
      let angleDiff = headingToWidth - heading;

      // Normaliser l'angle entre -180 et 180
      if (angleDiff > 180) angleDiff -= 360;
      if (angleDiff < -180) angleDiff += 360;

      // Déterminer la direction perpendiculaire correcte
      const perpHeading = angleDiff > 0 ? heading + 90 : heading - 90;

      // Récupérer l'angle de rotation des panneaux
      const panelsRotation = mainPolygon.panelsRotation || 0;

      const jointDilatationInput = document.querySelector(`#joint_dilatation-${pvId}`);
      const limitDilatationInput = document.querySelector(`#limit_dilatation_m-${pvId}`);
      const jointDilatationVal = jointDilatationInput ? parseFloat(jointDilatationInput.value) / 1000 : 0;
      const limitDilatationVal = limitDilatationInput ? parseFloat(limitDilatationInput.value) : 0;

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

      const angleRad = Math.abs(panelsRotation) * Math.PI / 180;
      const effectivePanelLength = Math.abs(panelLength * Math.cos(angleRad)) + Math.abs(panelWidth * Math.sin(angleRad));
      const effectivePanelWidth = Math.abs(panelLength * Math.sin(angleRad)) + Math.abs(panelWidth * Math.cos(angleRad));

      // Moteur de calepinage : ./calepinage_rectangulaire.js::drawPanelsInRect (zones de
      // pente, faîtages, joints de dilatation). On construit un chemin canonique [p0,p1,p2,p3]
      // aligné sur heading/perpHeading déjà résolus ci-dessus (gère l'inversion _lengthIndices),
      // pour que la convention d'axes du moteur (headingX = heading(p0,p1)) corresponde à la nôtre.
      const enginePathP0 = startCorner;
      const enginePathP1 = google.maps.geometry.spherical.computeOffset(enginePathP0, mainLength, heading);
      const enginePathP2 = google.maps.geometry.spherical.computeOffset(enginePathP1, mainWidth, perpHeading);
      const enginePathP3 = google.maps.geometry.spherical.computeOffset(enginePathP0, mainWidth, perpHeading);
      const enginePath = [enginePathP0, enginePathP1, enginePathP2, enginePathP3];

      const panelPolygonsOut = [];
      const engineCtx = buildPanelEngineContext(dc, pvId, {
        getDeletedIndexSet: (id) => this.getDeletedIndexSet(id),
        panelPolygons: panelPolygonsOut
      });
      // Remplacer par les valeurs déjà résolues plus haut (gèrent notamment le cas isFlat pour
      // pente1/pente2) plutôt que de relire le formulaire une seconde fois dans l'adaptateur.
      engineCtx.type_de_structure = typeCouverture || engineCtx.type_de_structure;
      engineCtx.pente = pente1;
      engineCtx.pente2 = pente2;
      engineCtx.toiture_pente_type = penteType;
      engineCtx.largeur_faitage_mm = faitageBuffer * 1000;
      engineCtx.asymetrie_percent = asymetrie * 100;
      engineCtx.marginX = panelConfig.margin * 1000;
      engineCtx.marginY = panelConfig.margin * 1000;
      engineCtx.dilatationMaxLength = limitDilatationVal;
      engineCtx.dilatationWidth = jointDilatationVal * 1000;
      engineCtx.isFieldHidden = isGloballyHidden;

      // "Option shed" (bouton du formulaire, cf. FormHandler.js) : quand activée sur ce rectangle,
      // on active le sous-mode shed interne de drawPanelsInRect (ctx.getShedParams/
      // calculateShedGridRect), désactivé par défaut via le stub de PanelEngineAdapter.js. Mêmes
      // champs/mapping que ShedPolygon.js::refreshPanelsForShape, partagés par la section "Sheds" du
      // formulaire (réutilisée telle quelle pour les deux outils).
      if (mainPolygon.shedsCapable) {
        const shedTilt = Math.max(0, Math.min(90, parseFloat(document.getElementById(`pente_panneaux_shed-${pvId}`)?.value) || 0));
        const L_proj_factor = Math.max(0.1, Math.cos(shedTilt * Math.PI / 180));
        const shedsColsInput = document.getElementById(`shedsCols-${pvId}`);
        const shedsRowsInput = document.getElementById(`shedsRows-${pvId}`);
        const shedsColSpacingInput = document.getElementById(`shedsColSpacing-${pvId}`);
        const shedsRowSpacingInput = document.getElementById(`shedsRowSpacing-${pvId}`);
        // CORRECTIF (demande explicite : "assurez-vous que le rectangle soit toujours rempli au
        // maximum lorsque le bouton shed est activé") : "Nb. PV en longueur"/"Esp. groupe de shed"
        // valent "0" par défaut dans le HTML, et leurs aria-label documentent explicitement "0 =
        // remplissage maximal (aucun regroupement)" — mais `valeur || repli` traite un "0" saisi
        // comme une valeur absente (0 est falsy en JS) et retombait donc silencieusement sur 12/100,
        // limitant le remplissage à des groupes de 12 espacés au lieu de remplir tout le rectangle.
        // calculateShedGridRect exige pvLong >= 1 (aucune notion de "continu" en interne) : "0" saisi
        // est donc traduit en une valeur très supérieure à ce qu'un rectangle réel peut contenir
        // (jamais assez de panneaux pour former un 2e groupe), simulant l'absence de regroupement.
        const shedsRowsRaw = shedsRowsInput && shedsRowsInput.value !== '' ? parseInt(shedsRowsInput.value, 10) : NaN;
        const pvLong = (!isNaN(shedsRowsRaw) && shedsRowsRaw > 0) ? Math.min(40, shedsRowsRaw) : 9999;
        const shedsRowSpacingRaw = shedsRowSpacingInput && shedsRowSpacingInput.value !== '' ? parseFloat(shedsRowSpacingInput.value) : NaN;
        const spaceLong = (!isNaN(shedsRowSpacingRaw) && shedsRowSpacingRaw >= 0) ? Math.max(0, Math.min(5, shedsRowSpacingRaw / 1000)) : 0;
        const shedParams = {
          tilt: shedTilt,
          pvLarge: Math.max(1, Math.min(15, parseInt(shedsColsInput?.value, 10) || 2)),
          pvLong,
          spaceLarge: Math.max(0.001, Math.min(10, (parseFloat(shedsColSpacingInput?.value) || 2500) / 1000)),
          spaceLong,
          isRegular: document.getElementById(`shedsRegular-${pvId}`)?.checked || false,
          L_proj_factor
        };
        engineCtx.getShedParams = () => shedParams;
        engineCtx.calculateShedGridRect = calculateShedGridRect;
      }

      drawPanelsInRect(
        enginePath,
        { id: pvId, azimuth: mainPolygon.rotation || 0 },
        panelLength,
        panelWidth,
        spacingX,
        spacingY,
        engineCtx
      );

      registerGeneratedPanels(this, pvId, mainPolygon, panelPolygonsOut);

      // CORRECTIF : drawPanelsInRect ne renvoie pas de décomposition colonnes/lignes (zones de
      // pente multiples), contrairement à l'ancien calcul — sans cet appel, #nbColonne/#nbLigne
      // restaient à leur valeur précédente (obsolète ou 0), ce qui invalidait le nombre de
      // panneaux affiché ailleurs dans l'app (TabsManager, résumé, etc.). On reporte le nombre
      // total de panneaux réellement tracés (numCols × numRows = total, même si la répartition
      // colonnes/lignes n'est pas géométriquement représentative des zones de pente).
      if (dc.FormHandler) {
        dc.FormHandler.updateFormGridInputs(pvId, panelPolygonsOut.length, panelPolygonsOut.length > 0 ? 1 : 0, mainLength, mainWidth);
      }

      // CORRECTIF : DrawingControl.calculateAndUpdatePanelInputs() est appelé automatiquement
      // 600ms après le dessin (cf. createFinalPolygon) et lit _calculatedPanelsLength/Width pour
      // éviter d'écraser un calcul déjà exact par une estimation naïve (2m×1m). Sans ces deux
      // champs (jamais renseignés par le nouveau moteur), il retombait sur cette estimation
      // naïve — voire remettait le nombre de panneaux à 0 si l'orientation Portrait/Paysage
      // n'était pas encore cochée — écrasant peu après le bon compte défini juste au-dessus.
      mainPolygon._calculatedPanelsLength = panelPolygonsOut.length;
      mainPolygon._calculatedPanelsWidth = panelPolygonsOut.length > 0 ? 1 : 0;

      // Appliquer immédiatement le masquage obstacle si nécessaire
      if (this.drawingControl.obstaclePanels) {
        this.drawingControl.obstaclePanels.requestRefresh();
      }

      // CORRECTIF (demande explicite : "la zone tampon buffer zone n'apparaît pas lorsque je rentre
      // une valeur esp. bordure") : drawPanelsInRect tient déjà compte de la marge pour PLACER les
      // panneaux (engineCtx.marginX/marginY), mais rien n'en montrait le résultat sur la carte. Réutilise
      // le même rétrécissement pur JS que ShedPolygon.js (calepinage_polygonale.js::
      // computeInsetPolygonPath, valable pour tout polygone convexe donc aussi un rectangle).
      this._updateMarginVisual(pvId, mainPolygon.getPath().getArray(), panelConfig.margin);

      // Mettre à jour et dessiner les éléments visuels de toiture
      this.updateRoofVisuals(mainPolygon);

      // Mettre à jour l'ancrage et dessiner les axes de poteaux si activé
      this.updatePostAxes(mainPolygon);
      console.log("[LineToPolygon] createSolarPanels: Terminé avec succès. Panneaux tracés.");
    } catch (error) {

      console.error("[LineToPolygon] Erreur critique dans createSolarPanels :", error);
      if (this.drawingControl && this.drawingControl.errorModal) {
        this.drawingControl.errorModal.show("Erreur lors du calcul des panneaux. Consultez la console pour plus de détails.");
      }
    }
  }

  /**
   * Met à jour l'ancrage et les poteaux associés à la forme
   * @param {google.maps.Polygon} polygon - Le rectangle principal
   */
  updatePostAxes(polygon) {
    if (!window.postAxesManager) return;

    const pvId = polygon.pvId;
    const coords = this._getOrderedCoords(polygon);
    if (!coords) return;

    const rf = { id: pvId, coords: coords };
    const typeCouvertureEl = document.querySelector(`#type_de_structure-${pvId}`) || document.querySelector(`select[id^="type_de_structure"]`);
    const config = {
      type_de_structure: typeCouvertureEl ? typeCouvertureEl.value.toLowerCase() : ''
    };

    // CORRECTIF (demande explicite : "Supprimer le bouton... Configurer les axes des poteaux. A la
    // place... placer le bouton de rotation") : postAxesManager.updateHandle sert désormais de
    // poignée de rotation (icons/sync.svg) pour TOUT rectangle — plus seulement les structures
    // ombrière/bâtiment incliné (qui conservent, elles, le dessin optionnel des poteaux eux-mêmes).
    window.postAxesManager.updateHandle(rf, config);
    this._attachRotationHandleDrag(polygon, window.postAxesManager.handles[pvId]);

    if (config.type_de_structure.includes('ombrière') || config.type_de_structure.includes('bâtiment incliné')) {
      window.postAxesManager.drawPosts(rf, config);
    }
  }

  /**
   * Réordonne les 4 coins du rectangle selon _lengthIndices : Vecteur X (Longueur) = [0]->[1],
   * Vecteur Y (Largeur) = [0]->[3]. Factorisé depuis updatePostAxes pour être réutilisé par la
   * poignée de rotation (position d'ancrage recalculée à chaque incrément de rotation).
   * @param {google.maps.Polygon} polygon
   * @returns {Array<google.maps.LatLng>|null}
   */
  _getOrderedCoords(polygon) {
    const path = polygon.getPath();
    if (!path || path.getLength() < 4) return null;
    const lengthIndices = polygon._lengthIndices || [0, 2];
    if (!lengthIndices.includes(0)) {
      return [path.getAt(1), path.getAt(2), path.getAt(3), path.getAt(0)];
    }
    return [path.getAt(0), path.getAt(1), path.getAt(2), path.getAt(3)];
  }

  /**
   * Position canonique de la poignée de rotation : milieu de l'arête "largeur" du rectangle (même
   * point que postAxesManager.updateHandle). Recalculée à partir du contour courant du polygone.
   * @param {google.maps.Polygon} polygon
   * @returns {google.maps.LatLng|null}
   */
  _getRotationHandleAnchorPosition(polygon) {
    const coords = this._getOrderedCoords(polygon);
    if (!coords) return null;
    return google.maps.geometry.spherical.interpolate(coords[1], coords[2], 0.5);
  }

  /**
   * Attache le glisser-déposer de la poignée de rotation (postAxesManager.handles[pvId],
   * icons/sync.svg) pour faire pivoter ce rectangle directement sur la carte, sans passer par les
   * boutons de rotation de la barre d'outils. Pendant le glissement, seul le contour est pivoté
   * (léger, aucune régénération de panneaux à chaque déplacement de souris — coûteux pour un grand
   * calepinage) ; au relâchement, une seule passe complète (azimut, panneaux, flèches de toiture) est
   * déclenchée via ShapeHandler.rotateShape(dc, 0) — angle nul car la rotation a déjà été appliquée en
   * direct, cet appel ne fait que rejouer le post-traitement habituel sur la position finale.
   *
   * Deux correctifs par rapport à la 1ère version :
   * - Sens de rotation inversé : google.maps.geometry.spherical.computeHeading est horaire-positif
   *   (0°=Nord, 90°=Est...) alors que GeometryUtils.rotatePoint suit la convention mathématique
   *   standard, antihoraire-positive (cf. sa matrice de rotation) — il faut donc lui passer l'opposé
   *   du delta de heading, sans quoi un glissement horaire de la poignée pivotait le rectangle dans
   *   le sens antihoraire.
   * - La poignée reste ancrée sur l'arête du rectangle (recalculée après chaque incrément de
   *   rotation) au lieu de suivre librement le curseur comme le ferait un marqueur draggable
   *   classique : l'angle de rotation est calculé à partir de la position du CURSEUR
   *   (event.latLng, fournie par Maps à chaque évènement 'drag'), indépendamment de la position
   *   affichée du marqueur, que l'on réimpose nous-mêmes à sa position canonique juste après.
   * @param {google.maps.Polygon} polygon
   * @param {google.maps.Marker} marker
   */
  _attachRotationHandleDrag(polygon, marker) {
    if (!marker || marker._rotationDragAttached) return;
    marker._rotationDragAttached = true;
    const dc = this.drawingControl;

    let center = null;
    let lastHeading = null;

    marker.addListener('dragstart', (event) => {
      if (dc.selectedShape !== polygon && typeof dc.setSelection === 'function') {
        dc.setSelection(polygon);
      }
      const bounds = new google.maps.LatLngBounds();
      polygon.getPath().forEach(p => bounds.extend(p));
      center = bounds.getCenter();
      const cursorPos = (event && event.latLng) ? event.latLng : marker.getPosition();
      lastHeading = google.maps.geometry.spherical.computeHeading(center, cursorPos);
    });

    marker.addListener('drag', (event) => {
      if (!center || lastHeading === null || !event || !event.latLng) return;
      const newHeading = google.maps.geometry.spherical.computeHeading(center, event.latLng);
      let delta = newHeading - lastHeading;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      lastHeading = newHeading;
      if (Math.abs(delta) < 0.01) return;

      // -delta : computeHeading (horaire+) -> rotatePoint (antihoraire+), cf. commentaire ci-dessus.
      const rotateAll = (point) => GeometryUtils.rotatePoint(point, center, -delta);

      polygon.setPath(polygon.getPath().getArray().map(rotateAll));

      // CORRECTIF (demande explicite : "les panneaux et le rectangle doivent rester fixes, ils ne
      // doivent pas se séparer") : seul le contour du rectangle pivotait en direct pendant le
      // glissement (la rotation des panneaux, coûteuse pour un grand calepinage, n'était appliquée
      // qu'au relâchement via une régénération complète) — les panneaux restaient donc visuellement
      // figés à leur ancienne position pendant tout le geste, donnant l'impression que rectangle et
      // panneaux se désolidarisaient. On pivote maintenant aussi, en direct, les panneaux déjà tracés
      // (translation géométrique de leurs sommets, pas une régénération du moteur) et la zone tampon,
      // pour qu'ils suivent le rectangle sans latence visuelle ; le relâchement (dragend) déclenche
      // toujours la régénération complète et précise via le moteur.
      const pvId = polygon.pvId;
      const panels = this.createdPanelsByShape.get(pvId);
      if (panels) {
        panels.forEach(panel => {
          if (typeof panel.getPath !== 'function') return;
          panel.setPath(panel.getPath().getArray().map(rotateAll));
        });
      }
      const marginVisual = this.marginVisuals.get(pvId);
      if (marginVisual && typeof marginVisual.getPaths === 'function') {
        const rotatedRings = marginVisual.getPaths().getArray().map(ring => ring.getArray().map(rotateAll));
        marginVisual.setPaths(rotatedRings);
      }

      // Réancre la poignée sur l'arête du rectangle plutôt que de la laisser suivre le curseur.
      const anchorPos = this._getRotationHandleAnchorPosition(polygon);
      if (anchorPos) marker.setPosition(anchorPos);
    });

    marker.addListener('dragend', () => {
      center = null;
      lastHeading = null;
      ShapeHandler.rotateShape(dc, 0);
      // Recale la poignée à sa position canonique (milieu de l'arête) sur le rectangle pivoté.
      this.updatePostAxes(polygon);
    });
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
  const aValVis = asymInput ? parseFloat(asymInput.value) : NaN;
  const asymetrie = !isNaN(aValVis) ? aValVis / 100 : 0.4;

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
      console.error("Erreur lors de l'ajout des visuels de toiture:", err);
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

  // Application des indicateurs visuels et de l'azimut selon le type de pente
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

      google.maps.event.addListener(line, 'dragend', () => {
        const newPos = line.getPath().getAt(0);
        const distToStart = google.maps.geometry.spherical.computeDistanceBetween(c0, newPos);
        const headToStart = google.maps.geometry.spherical.computeHeading(c0, newPos);
        const perpDist = Math.abs(distToStart * Math.sin((headToStart - hLen) * Math.PI / 180));
        if (asymInput) {
          asymInput.value = Math.max(1, Math.min(99, Math.round((perpDist / wid) * 100)));
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

    // Flèches et étiquettes correctement attribuées
    const offsets = [
      { label: `${pvId}.1`, widthFactor: 0.125, heading: hWid + 180, rotateText: false },
      { label: `${pvId}.2`, widthFactor: 0.375, heading: hWid, rotateText: true },
      { label: `${pvId}.3`, widthFactor: 0.625, heading: hWid + 180, rotateText: false },
      { label: `${pvId}.4`, widthFactor: 0.875, heading: hWid, rotateText: true }
    ];

    offsets.forEach((conf, idx) => {
      const pvPos = google.maps.geometry.spherical.computeOffset(c0, wid * conf.widthFactor, geometryHWid);
      const pvCenter = google.maps.geometry.spherical.computeOffset(pvPos, len * 0.5, hLen);
      addLabelAndArrow(pvCenter, conf.label, conf.heading, conf.rotateText);
      setAzimuth(idx + 1, conf.heading);
    });
  }
}



/**
 * Supprime un panneau solaire
 * @param {google.maps.Polygon} panel - Le panneau à supprimer
 */
removeSolarPanel(panel) {
  if (panel && panel.isMarginVisual) {
    return; // Ne pas permettre la suppression de la visualisation de la marge
  }
  if (panel && panel.isPanelSolaire) {
    // Sauvegarder l'index du panneau supprimé
    const pvId = panel.parentPolygon.pvId;
    const deletedIndexes = this.getDeletedIndexSet(pvId);
    // Ajouter l'index du panneau (stocké dans panel.panelIndex)
    if (panel.panelIndex) {
      deletedIndexes.add(panel.panelIndex);
      // Sauvegarder dans le localStorage via DeletedPanelsStorage (index logique uniquement)
      const panelData = {
        pvId,
        panelIndex: panel.panelIndex,
        shapeType: SHAPE_TYPES.LINE_TO_POLYGON,
      };
      DeletedPanelsStorage.add(panelData);
    }
    panel.setMap(null);

    // Retirer de la liste des panneaux de la forme concernée
    if (this.createdPanelsByShape.has(pvId)) {
      const panels = this.createdPanelsByShape.get(pvId);
      const index = panels.indexOf(panel);
      if (index > -1) {
        panels.splice(index, 1);
        this.panelCountByShape.set(pvId, this.panelCountByShape.get(pvId) - 1);

        // Recréer tous les panneaux (et la marge) après suppression
        const parentPolygon = panel.parentPolygon;
        if (parentPolygon) {
          this.updatePanelsPosition(parentPolygon);
        }


        console.log(`Panneau supprimé. Nombre restant pour ${pvId} : ${this.panelCountByShape.get(pvId)}`);

        // Émettre des événements de mise à jour pour synchroniser les résumés/compteurs
        try {
          document.dispatchEvent(new CustomEvent(this.drawingControl.CUSTOM_EVENTS.LAYOUT_UPDATED, {
            detail: { pvId }
          }));
          document.dispatchEvent(new Event(this.drawingControl.CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER));

          // Optionnel: persister rapidement l'état courant pour les vues basées sur le localStorage
          if (window.storageManager && typeof window.storageManager.savePageData === 'function') {
            // Appel non bloquant
            Promise.resolve().then(() => window.storageManager.savePageData()).catch(() => { });
          }
        } catch (e) {
          // Ignorer silencieusement les erreurs d'événement
        }
      }
    }
  }
}


/**
 * Déplace tous les éléments associés à la forme (panneaux, flèches, étiquettes)
 * proportionnellement au déplacement de la forme parente lors d'un "drag".
 */
translateShapeElements(pvId, dLat, dLng) {
  const shiftLatLng = (lat, lng) => new google.maps.LatLng(lat + dLat, lng + dLng);

  // 1. Déplacer les panneaux et la marge visuelle
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
 * Active/désactive le mode suppression/restauration des panneaux
 * @param {HTMLElement} button - Le bouton cliqué
 */
toggleBoolShowHide(button) {
  // Inverser la valeur
  this.boolShowHide = !this.boolShowHide;

  // Mettre à jour l'apparence du bouton
  if (this.boolShowHide) {
    // Mode actif - assombrir le bouton et désactiver temporairement les événements de survol
    button.style.cssText = "background-color: #B5B5B5 !important; border: none; cursor: pointer; padding: 8px; margin: 2px; border-radius: 4px; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px;";
    button.classList.add("active");

    // Marquer le bouton comme "locked" pour ignorer les événements de survol
    button.dataset.colorLocked = "true";
  } else {
    // Mode inactif - couleur normale
    button.style.cssText = "background-color: white !important; border: none; cursor: pointer; padding: 8px; margin: 2px; border-radius: 4px; display: flex; align-items: center; justify-content: center; width: 40px; height: 40px;";
    button.classList.remove("active");

    // Retirer le verrou
    button.dataset.colorLocked = "false";
  }
}

/**
 * Crée un polygone à partir d'une ligne
 * @param {google.maps.LatLng} point1 - Premier point de la ligne
 * @param {google.maps.LatLng} point2 - Deuxième point de la ligne
 * @returns {google.maps.Polygon} Le polygone créé
 */

/**
 * Nettoyage des ressources lors de la suppression
 */
onRemove() {
  this.clearTemp();

  // Nettoyer les détecteurs de côtés
  this.clearSideDetectors();

  // Supprimer l'écouteur d'événement de zoom
  document.removeEventListener(
    this.drawingControl.CUSTOM_EVENTS.MAP_ZOOM_CHANGED,
    () => { }
  );
}


/**
 * Redimensionne spécifiquement un LineToPolygon en préservant son orientation exacte
 * @param {google.maps.Polygon} polygon - Polygone à redimensionner
 * @param {Object} dimensions - Nouvelles dimensions {width, length}
 */
resizeLineToPolygon(polygon, dimensions) {
  if (!polygon || !dimensions) return;

  const path = polygon.getPath();
  if (path.getLength() !== 4) return;

  const points = [
    path.getAt(0), path.getAt(1), path.getAt(2), path.getAt(3)
  ];

  // Calculer les orientations actuelles des côtés (utilisées dans les deux cas)
  // Pour le CAS 2 (drag), on utilise directement les points actuels
  // Pour le CAS 1 (formulaire), on utilise les indices pour déterminer les bons côtés
  let headingLength, headingWidth;

  // CAS 1: Redimensionnement depuis le formulaire (draggedSide undefined)
  if (!this.draggedSide) {
    // Utiliser les indices stockés pour déterminer quels côtés sont la longueur et la largeur
    const lengthIndices = polygon._lengthIndices || [0, 2];
    const widthIndices = polygon._widthIndices || [1, 3];

    // Déterminer les headings corrects selon les indices
    // Les indices indiquent quels côtés du rectangle sont la longueur/largeur :
    //   lengthIndices = [0, 2] signifie que les côtés 0->1 et 2->3 sont la longueur
    //   lengthIndices = [1, 3] signifie que les côtés 1->2 et 3->0 sont la longueur
    //   widthIndices = [1, 3] signifie que les côtés 1->2 et 3->0 sont la largeur
    //   widthIndices = [0, 2] signifie que les côtés 0->1 et 2->3 sont la largeur

    // Calculer le heading de la longueur
    if (lengthIndices.includes(0) && lengthIndices.includes(2)) {
      // La longueur est sur les côtés 0->1 et 2->3
      // Utiliser le côté 0->1 pour le heading
      headingLength = google.maps.geometry.spherical.computeHeading(points[0], points[1]);
    } else {
      // La longueur est sur les côtés 1->2 et 3->0
      // Utiliser le côté 1->2 pour le heading (qui va de points[1] vers points[2])
      headingLength = google.maps.geometry.spherical.computeHeading(points[1], points[2]);
    }

    // Calculer le heading de la largeur
    if (widthIndices.includes(1) && widthIndices.includes(3)) {
      // La largeur est sur les côtés 1->2 et 3->0
      // Utiliser le côté 1->2 pour le heading (qui va de points[1] vers points[2])
      headingWidth = google.maps.geometry.spherical.computeHeading(points[1], points[2]);
    } else {
      // La largeur est sur les côtés 0->1 et 2->3
      // Utiliser le côté 0->1 pour le heading
      headingWidth = google.maps.geometry.spherical.computeHeading(points[0], points[1]);
    }

    // Reconstruire le rectangle en préservant les indices initiaux, mais recentré sur le CENTRE
    // actuel du rectangle plutôt qu'ancré sur un coin fixe (points[0] ou points[1]) : ancrer sur un
    // coin fait "glisser" tout le rectangle (et donc tous les panneaux à l'intérieur) à chaque
    // changement de dimensions, même minime (ex: arrondi renvoyé par une vérification backend) — ce
    // qui donnait l'impression que les panneaux se décentraient. Recalculer un "coin virtuel" décalé
    // du centre reproduit exactement la même géométrie relative qu'avant (mêmes indices, même sens de
    // parcours), simplement recentrée.
    const centerBounds = new google.maps.LatLngBounds();
    points.forEach((p) => centerBounds.extend(p));
    const center = centerBounds.getCenter();
    const halfLength = dimensions.length / 2;
    const halfWidth = dimensions.width / 2;

    let newPoints;
    if (lengthIndices.includes(0) && lengthIndices.includes(2)) {
      // La longueur est sur les côtés 0->1 et 2->3, reconstruire depuis un coin virtuel équivalent à
      // points[0] mais positionné pour que le rectangle résultant soit centré sur "center".
      const virtualPoint0 = google.maps.geometry.spherical.computeOffset(
        google.maps.geometry.spherical.computeOffset(center, halfLength, (headingLength + 180) % 360),
        halfWidth, (headingWidth + 180) % 360
      );
      const newPoint1 = google.maps.geometry.spherical.computeOffset(virtualPoint0, dimensions.length, headingLength);
      const newPoint3 = google.maps.geometry.spherical.computeOffset(virtualPoint0, dimensions.width, headingWidth);
      const newPoint2 = google.maps.geometry.spherical.computeOffset(newPoint1, dimensions.width, headingWidth);
      newPoints = [virtualPoint0, newPoint1, newPoint2, newPoint3];
    } else {
      // La longueur est sur les côtés 1->2 et 3->0, reconstruire depuis un coin virtuel équivalent à
      // points[1], positionné de la même façon pour centrer le résultat sur "center".
      // headingLength va de points[1] vers points[2] (vers le haut)
      // headingWidth va de points[0] vers points[1] (vers la droite), donc depuis points[1] vers points[0] c'est l'inverse
      const headingWidthFrom1 = (headingWidth + 180) % 360;
      const virtualPoint1 = google.maps.geometry.spherical.computeOffset(
        google.maps.geometry.spherical.computeOffset(center, halfLength, (headingLength + 180) % 360),
        halfWidth, headingWidth
      );
      const newPoint2 = google.maps.geometry.spherical.computeOffset(virtualPoint1, dimensions.length, headingLength);
      const newPoint0 = google.maps.geometry.spherical.computeOffset(virtualPoint1, dimensions.width, headingWidthFrom1);
      const newPoint3 = google.maps.geometry.spherical.computeOffset(newPoint0, dimensions.length, headingLength);
      newPoints = [newPoint0, virtualPoint1, newPoint2, newPoint3];
    }

    polygon.setPath(newPoints);

    // Préserver les indices initiaux au lieu de les standardiser
    // Cela permet de maintenir la correspondance entre les dimensions du formulaire
    // et les côtés du rectangle, même si le premier côté dessiné était la largeur
    // Les indices sont déjà corrects, pas besoin de les modifier
  } else {
    // CAS 2: Pour le drag, utiliser les orientations actuelles des côtés
    // On suppose que points[0]->points[1] est la longueur et points[0]->points[3] est la largeur
    headingLength = google.maps.geometry.spherical.computeHeading(points[0], points[1]);
    headingWidth = google.maps.geometry.spherical.computeHeading(points[0], points[3]);

    // CAS 2: Redimensionnement par drag de côté (logique existante)
    let newPoints;

    if (this.draggedSide === 'bottom' || !this.draggedSide) {
      // Déplacer le côté bas le long de la largeur en direction opposée
      const newPoint0 = google.maps.geometry.spherical.computeOffset(points[3], dimensions.width, headingWidth + 180);
      const newPoint1 = google.maps.geometry.spherical.computeOffset(points[2], dimensions.width, headingWidth + 180);
      newPoints = [newPoint0, newPoint1, points[2], points[3]];

    } else if (this.draggedSide === 'right') {
      const newPoint1 = google.maps.geometry.spherical.computeOffset(points[0], dimensions.length, headingLength);
      const newPoint3 = google.maps.geometry.spherical.computeOffset(points[0], dimensions.width, headingWidth);
      const newPoint2 = google.maps.geometry.spherical.computeOffset(newPoint1, dimensions.width, headingWidth);
      newPoints = [points[0], newPoint1, newPoint2, newPoint3];

    } else if (this.draggedSide === 'top') {
      const newPoint3 = google.maps.geometry.spherical.computeOffset(points[0], dimensions.width, headingWidth);
      const newPoint2 = google.maps.geometry.spherical.computeOffset(points[1], dimensions.width, headingWidth);
      newPoints = [points[0], points[1], newPoint2, newPoint3];

    } else if (this.draggedSide === 'left') {
      const newPoint0 = google.maps.geometry.spherical.computeOffset(points[1], dimensions.length, headingLength + 180);
      const newPoint3 = google.maps.geometry.spherical.computeOffset(newPoint0, dimensions.width, headingWidth);
      newPoints = [newPoint0, points[1], points[2], newPoint3];
    }

    polygon.setPath(newPoints);
  }

  // Mettre à jour les dimensions stockées
  polygon._originalDimensions = {
    width: dimensions.width,
    length: dimensions.length,
  };

  return polygon;
}

/**
 * Dessine (ou retire, si aucune marge active) la zone tampon "Esp. bordure" entre le contour du
 * rectangle et la limite réelle de calepinage — même rendu que ShedPolygon.js/PolygonPanelsManager.js
 * (bande orange MARGIN_COLOR, "trou" via un 2e anneau inversé).
 * @param {string} pvId
 * @param {Array<google.maps.LatLng>} outerPath - contour du rectangle tel que dessiné
 * @param {number} marginMeters - "Esp. bordure", en mètres
 */
_updateMarginVisual(pvId, outerPath, marginMeters) {
  this._removeMarginVisual(pvId);
  if (!marginMeters || marginMeters <= 0) return;

  const innerPath = computeInsetPolygonPath(outerPath, marginMeters);
  if (!innerPath || innerPath.length < 3) return;

  const marginPolygon = new google.maps.Polygon({
    paths: [outerPath, [...innerPath].reverse()],
    fillColor: MARGIN_COLOR,
    fillOpacity: 0.3,
    strokeWeight: 0,
    zIndex: 20,
    map: this.drawingControl.map,
    clickable: false
  });
  marginPolygon.isMarginVisual = true;
  marginPolygon.parentPvId = pvId;
  this.marginVisuals.set(pvId, marginPolygon);
}

/**
 * Supprime la zone tampon affichée pour un pvId donné, s'il y en a une.
 * @param {string} pvId
 */
_removeMarginVisual(pvId) {
  if (this.marginVisuals.has(pvId)) {
    this.marginVisuals.get(pvId).setMap(null);
    this.marginVisuals.delete(pvId);
  }
}

/**
 * Nettoie les panneaux d'une forme spécifique
 * @param {string} pvId - ID de la forme
 */
cleanupPanelsForShape(pvId, options = {}) {
  this._removeMarginVisual(pvId);
  const { resetDeleted = false } = options;
  if (this.createdPanelsByShape.has(pvId)) {
    const panels = this.createdPanelsByShape.get(pvId);
    panels.forEach(panel => {
      panel.setMap(null);
    });
    this.createdPanelsByShape.delete(pvId);
    this.panelCountByShape.delete(pvId);
    if (resetDeleted) {
      this.clearDeletedIndicesForShape(pvId);

      if (window.postAxesManager) {
        window.postAxesManager.removeRect(pvId);
      }
    }
  }

  // Nettoyer les éléments visuels de la toiture (faîtage, noue, flèches)
  if (this.roofOverlaysByShape.has(pvId)) {
    this.roofOverlaysByShape.get(pvId).forEach(o => {
      if (typeof o.setMap === 'function') o.setMap(null);
    });
    this.roofOverlaysByShape.delete(pvId);
  }

  // Fallback de sécurité
  const polygon = this.drawingControl?.drawnShapes?.find(s => s.pvId === pvId);
  if (polygon && polygon.roofOverlays) {
    polygon.roofOverlays.forEach(o => { if (typeof o.setMap === 'function') o.setMap(null); });
    polygon.roofOverlays = [];
  }
}

initializeDeletedIndicesForShape(pvId) {
  if (!pvId) return;
  this.deletedPanelIndexes.set(pvId, new Set());
  DeletedPanelsStorage.remove(
    panel =>
      panel.pvId === pvId &&
      (!panel.shapeType || panel.shapeType === SHAPE_TYPES.LINE_TO_POLYGON)
  );
}

clearDeletedIndicesForShape(pvId) {
  if (!pvId) return;
  if (this.deletedPanelIndexes.has(pvId)) {
    this.deletedPanelIndexes.delete(pvId);
  }
  DeletedPanelsStorage.remove(
    panel =>
      panel.pvId === pvId &&
      (!panel.shapeType || panel.shapeType === SHAPE_TYPES.LINE_TO_POLYGON)
  );
}

getDeletedIndexSet(pvId) {
  if (!pvId) return new Set();
  if (this.deletedPanelIndexes.has(pvId)) {
    return this.deletedPanelIndexes.get(pvId);
  }
  const persisted = DeletedPanelsStorage
    .load()
    .filter(panel => panel.pvId === pvId && panel.shapeType === SHAPE_TYPES.LINE_TO_POLYGON);
  const storedSet = new Set(persisted.map(panel => panel.panelIndex));
  this.deletedPanelIndexes.set(pvId, storedSet);
  return storedSet;
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
}

export default LineToPolygon;