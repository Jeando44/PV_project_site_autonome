import { STYLES, CUSTOM_EVENTS, SHAPE_TYPES } from "../constants.js";
import GeometryUtils from "../utils/GeometryUtils.js";

class Polygon {
  constructor(drawingControl) {
    this.drawingControl = drawingControl;
    this.isActive = false;
    this.button = null;
    this.roofOverlaysByShape = new Map();

    // Purge les labels PV orphelins si un polygone est supprimé
    document.addEventListener(CUSTOM_EVENTS.SHAPE_REMOVED, (e) => {
      const pvId = e.detail.pvId;
      if (this.roofOverlaysByShape.has(pvId)) {
        this.roofOverlaysByShape.get(pvId).forEach(o => {
          if (o && typeof o.setMap === 'function') o.setMap(null);
        });
        this.roofOverlaysByShape.delete(pvId);
      }
    });
  }

  /**
   * Active/désactive le mode de dessin de polygone PV (natif Google Maps)
   * @param {HTMLElement} button - Bouton de dessin
   */
  toggleMode(button) {
    console.log("[Polygon] toggleMode appelé. Demande d'activation du dessin de polygone PV.");
    try {
      this.button = button;

      // Si déjà actif, désactiver
      if (this.isActive) {
        this.isActive = false;
        if (this.drawingControl.drawingManager) {
          this.drawingControl.drawingManager.setDrawingMode(null);
        }
        if (this.button) {
          this.button.classList.remove('selected');
          this.button.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
        }
        this.drawingControl.activeButton = null;
        this.drawingControl.map.setOptions({ draggableCursor: null });
        return;
      }

      // Désactiver le bouton précédent s'il existe
      if (this.drawingControl.activeButton) {
        this.drawingControl.activeButton.classList.remove('selected');
        this.drawingControl.activeButton.style.backgroundColor = STYLES.DEFAULT_BUTTON.backgroundColor;
      }

      // Activer le mode POLYGON natif
      this.isActive = true;
      this.button.classList.add('selected');
      this.button.style.backgroundColor = STYLES.SELECTED_BUTTON.backgroundColor;
      this.drawingControl.activeButton = this.button;
      if (this.drawingControl.drawingManager) {
        this.drawingControl.drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
        console.log("[Polygon] Succès : Mode de dessin défini sur POLYGON dans le drawingManager.");
      } else {
        console.error("[Polygon] ERREUR CRITIQUE : drawingManager est manquant dans drawingControl ! L'outil de dessin Google Maps n'est pas initialisé.");
      }
      this.drawingControl.map.setOptions({ draggableCursor: 'crosshair' });
    } catch (error) {
      console.error('Erreur lors de l\'activation du mode polygone:', error);
    }
  }

  /**
   * Gère la création d'un polygone et configure ses propriétés
   * @param {google.maps.Polygon} polygon - Le polygone créé
   */
  handlePolygonComplete(polygon) {
  console.log("[Polygon] handlePolygonComplete exécuté : forme finalisée par l'utilisateur.");
  try {
    // Configurer le polygone comme modifiable
    polygon.setOptions({
      fillColor: STYLES.DEFAULT_SHAPE.fillColor,
      fillOpacity: STYLES.DEFAULT_SHAPE.fillOpacity,
      strokeWeight: STYLES.DEFAULT_SHAPE.strokeWeight,
      strokeColor: STYLES.DEFAULT_SHAPE.strokeColor,
      strokeOpacity: STYLES.DEFAULT_SHAPE.strokeOpacity,
      editable: true, // Rendre le polygone modifiable avec des poignées
      draggable: true, // Permettre le déplacement
      zIndex: STYLES.DEFAULT_SHAPE.zIndex
    });

    // Définir le type de forme
    polygon.type = SHAPE_TYPES.POLYGON;

    // Restriction géographique (cf. Config.PROJECT_RADIUS_LIMIT_KM) : rejette la forme si elle est
    // dessinée trop loin de l'adresse du projet, même logique que les rejets "trop petit/trop court"
    // déjà en place pour Line/Circle/SimpleRectangle.
    {
      const rejectPath = polygon.getPath();
      const rejectBounds = new google.maps.LatLngBounds();
      rejectPath.forEach(p => rejectBounds.extend(p));
      const compliance = GeometryUtils.checkWithinProjectRadius(rejectBounds.getCenter());
      if (!compliance.allowed) {
        polygon.setMap(null);
        const msg = `Surface trop éloignée de l'adresse du projet (${compliance.distanceKm.toFixed(2)} km, limite : ${compliance.limitKm} km). Le dessin a été annulé.`;
        if (this.drawingControl.errorModal) {
          this.drawingControl.errorModal.show(msg);
        } else {
          alert(msg);
        }
        return;
      }
    }

    // Initialiser l'orientation de référence selon le type de polygone
    const path = polygon.getPath();
    if (path.getLength() >= 2) {
      const ref = path.getAt(0);
      const next = path.getAt(1);
      const polygonRealHeading = google.maps.geometry.spherical.computeHeading(ref, next);
      
      if (polygon.shedsCapable) {
        // POLYGONES AVEC SHEDS :
        // CORRECTIF (incohérence azimut/orientation visuelle) : le rampant reste orienté Sud
        // (gridBaseHeading=180, cf. PolygonPanelsManager.js::updateGridBaseHeading, même règle et même
        // commentaire) QUEL QUE SOIT le 1er segment tracé — seul le champ "Rotation shed" doit
        // réorienter les panneaux. Fixer `initialOrientation` à polygonRealHeading (comme avant ce
        // correctif) rendait par ailleurs le garde-fou de updateGridBaseHeading (`typeof
        // polygon.initialOrientation === 'undefined'`) systématiquement faux pour un shed dessiné
        // directement via l'outil dédié, empêchant cette méthode de jamais corriger gridBaseHeading
        // vers 180 — d'où un azimut de calcul (et un placement des panneaux) qui suivait à tort le 1er
        // segment du polygone au lieu de rester Sud par défaut. `polygonInitialHeading` conserve
        // l'orientation réelle du polygone pour référence, mais n'est plus utilisée comme azimut de
        // calcul ni comme heading de placement des panneaux.
        polygon.initialOrientation = 180;
        polygon.polygonInitialHeading = polygonRealHeading; // Orientation réelle du polygone (référence)
        polygon.gridBaseHeading = 180; // Grille toujours Sud par défaut
      } else {
        // POLYGONES SANS SHEDS : suivre l'orientation du polygone dès le départ
        polygon.gridBaseHeading = polygonRealHeading;
      }
      polygon.rotation = polygonRealHeading; // NOUVEAU: Initialiser la rotation du polygone (azimut) dès sa création
      polygon.panelsRotation = 0;
    }

    // Générer un ID unique
    if (this.drawingControl.activePendingPvId) {
      polygon.pvId = this.drawingControl.activePendingPvId;
      this.drawingControl.usedIds.add(polygon.pvId);
      this.drawingControl.activePendingPvId = null;
    } else {
      let id = 1;
      while (this.drawingControl.usedIds.has(`PV${id}`)) {
        id++;
      }
      polygon.pvId = `PV${id}`;
      this.drawingControl.usedIds.add(polygon.pvId);
    }
    const pvId = polygon.pvId;

    // Initialiser l'état de suppression spécifique à ce polygon
    if (this.drawingControl && this.drawingControl.polygonPanels && typeof this.drawingControl.polygonPanels.initializeDeletedIndexFor === 'function') {
      this.drawingControl.polygonPanels.initializeDeletedIndexFor(pvId);
    }

    // Ajouter à la liste des formes dessinées
    this.drawingControl.drawnShapes.push(polygon);

    // Configurer les écouteurs d'événements pour la sélection et modification
    this.setupPolygonListeners(polygon);

    // Lier le formulaire à ce polygone natif et initialiser l'UI
    this.drawingControl.setupFormListeners(polygon);

    // Mettre à jour immédiatement les champs de grille selon la forme
    this.drawingControl.calculateAndUpdatePanelInputs(polygon);

    // Déclencher l'événement de création de forme
    document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_ADDED, {
      detail: {
        shape: polygon,
        pvId: pvId,
        type: SHAPE_TYPES.POLYGON
      }
    }));

    // Forcer le rendu graphique des overlays immédiatement après le dessin (Bug 1)
    this.updateRoofVisuals(polygon);

    // Sélectionner automatiquement le polygone créé
    setTimeout(() => {
      this.drawingControl.setSelection(polygon);
    }, 100);

  } catch (error) {
    console.error('Erreur lors de la configuration du polygone:', error);
  }
}

  /**
   * Configure les écouteurs d'événements pour un polygone
   * @param {google.maps.Polygon} polygon - Le polygone à configurer
   */
  setupPolygonListeners(polygon) {
    // Écouteur pour la sélection du polygone
    google.maps.event.addListener(polygon, 'click', (event) => {
      event.stop(); // Empêcher la propagation vers la carte
      this.drawingControl.setSelection(polygon);
    });

    // Écouteurs corrects sur le chemin pour les modifications de forme (redimensionnement)
    this._attachPathListeners(polygon);

    // NOUVEAU: Mettre à jour les labels en temps réel durant le déplacement de la surface
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
      
      this.translateShapeElements(polygon, dLat, dLng);
    });

    // Écouteur pour le déplacement du polygone
    google.maps.event.addListener(polygon, 'dragend', () => {
      this.onPolygonMoved(polygon);
    });

    // Écouteur clic droit sur le polygone pour tenter de restaurer un panneau supprimé
    google.maps.event.addListener(polygon, 'rightclick', (event) => {
      if (this.drawingControl && this.drawingControl.polygonPanels) {
        this.drawingControl.polygonPanels.tryRestoreDeletedPanelAt(polygon, event.latLng);
      }
    });
    polygon._hasPolygonRestoreListener = true;
  }

  /**
   * Déplace les indicateurs visuels du polygone lors d'un "drag"
   */
  translateShapeElements(polygon, dLat, dLng) {
    const shiftLatLng = (lat, lng) => new google.maps.LatLng(lat + dLat, lng + dLng);
    const overlays = polygon.roofOverlays || [];
    overlays.forEach(o => {
      if (o && o.marker && o.marker.position) {
        const pos = o.marker.position;
        const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
        const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
        o.marker.position = shiftLatLng(lat, lng);
      }
    });
  }

  /**
   * Nettoie et recrée les écouteurs du chemin après un setPath (ex: rotation)
   * @param {google.maps.Polygon} polygon - Le polygone cible
   */
  refreshPathListeners(polygon) {
    this._removePathListeners(polygon);
    this._attachPathListeners(polygon);
  }

  /**
   * Supprime les écouteurs existants du chemin
   * @param {google.maps.Polygon} polygon - Le polygone cible
   */
  _removePathListeners(polygon) {
    if (!polygon || !polygon._pathListeners) return;
    polygon._pathListeners.forEach((listener) => {
      if (listener?.remove) {
        listener.remove();
      } else {
        google.maps.event.removeListener(listener);
      }
    });
    polygon._pathListeners = [];
  }

  /**
   * Attache les écouteurs de modification sur le chemin du polygone
   * @param {google.maps.Polygon} polygon - Le polygone cible
   */
  _attachPathListeners(polygon) {
    if (!polygon) return;
    this._removePathListeners(polygon);
    const path = polygon.getPath();
    if (path && path.addListener) {
      const listeners = [
        path.addListener('set_at', () => this.onPolygonModified(polygon)),
        path.addListener('insert_at', () => this.onPolygonModified(polygon)),
        path.addListener('remove_at', () => this.onPolygonModified(polygon)),
      ];
      polygon._pathListeners = listeners;
    }
  }

  /**
   * Gère les modifications du polygone (redimensionnement)
   * @param {google.maps.Polygon} polygon - Le polygone modifié
   */
  onPolygonModified(polygon) {
    if (polygon.pvId) {
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_MODIFIED, {
        detail: { pvId: polygon.pvId }
      }));
    }
  }

  /**
   * Gère le déplacement du polygone
   * @param {google.maps.Polygon} polygon - Le polygone déplacé
   */
  onPolygonMoved(polygon) {
    if (polygon.pvId) {
      document.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.SHAPE_MOVED, {
        detail: { pvId: polygon.pvId }
      }));
    }
  }

  /**
   * Dessine et met à jour les indicateurs visuels (flèche, label PV) pour les polygones natifs
   * @param {google.maps.Polygon} polygon 
   */
  async updateRoofVisuals(polygon) {
    const pvId = polygon.pvId;
    const dc = this.drawingControl;
    if (!pvId) return;

    if (!dc.AdvancedMarkerElement) {
      const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
      dc.AdvancedMarkerElement = AdvancedMarkerElement;
    }

    if (this.roofOverlaysByShape.has(pvId)) {
      this.roofOverlaysByShape.get(pvId).forEach(overlay => {
        if (overlay && typeof overlay.setMap === 'function') overlay.setMap(null);
      });
    }
    const overlays = [];
    this.roofOverlaysByShape.set(pvId, overlays);
    polygon.roofOverlays = overlays; // Pour compatibilité

    const path = polygon.getPath();
    if (!path || path.getLength() < 3) return;

    const bounds = new google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    const center = bounds.getCenter();

    let azimuth;
    if (polygon.shedsCapable) {
      // Rotation dissociée du polygone (cf. PolygonPanelsManager.createPanels) : la flèche et le label
      // suivent "Rotation shed" plutôt que la rotation du polygone lui-même.
      const shedRotationInput = document.querySelector(`#shedRotation-${pvId}`);
      azimuth = shedRotationInput ? (parseFloat(shedRotationInput.value) || 0) : 0;
    } else {
      azimuth = polygon.rotation || 0;
      if (polygon.isAzimuthFlipped) {
        azimuth = (azimuth + 180) % 360;
      }
    }
    const visualAzimuth = azimuth; // INCHANGÉ : pilote uniquement la rotation visuelle de la flèche/du label

    // CORRECTIF (incohérence azimut de calcul / orientation visuelle réelle des panneaux) :
    // - `gridBaseHeading` est désormais fiablement 180° par défaut pour un shed, quel que soit le 1er
    //   segment tracé (cf. correctif à la création du polygone plus haut dans ce fichier ET
    //   PolygonPanelsManager.js::updateGridBaseHeading, même règle) : c'est CETTE valeur, pas
    //   l'orientation réelle du segment, qui pilote aussi le placement des panneaux (heading =
    //   gridBaseHeading + shedRotation, cf. PolygonPanelsManager.js). Rotation shed = 0 correspond donc
    //   bien à des panneaux visuellement orientés Sud.
    // - `gridBaseHeading` est exprimé en cap compas (0=Nord, 180=Sud, cf. computeHeading), alors que le
    //   champ Azimut / "Rotation shed" utilise le référentiel PVGIS (0=Sud, ±180=Nord, -90=Est/+90=Ouest,
    //   cf. commentaire "Sud = 0" plus bas et calculate_shed_shading.py) — d'où la conversion `- 180`
    //   ci-dessous UNIQUEMENT sur cette valeur de repli, "Rotation shed" étant déjà dans le bon
    //   référentiel quand l'utilisateur le renseigne directement.
    // - Par défaut ("Rotation shed" = 0, valeur non modifiée par l'utilisateur) : azimut de calcul =
    //   gridBaseHeading converti en référentiel PVGIS (180 - 180 = 0° = Sud, cohérent avec l'affichage).
    // - Si l'utilisateur saisit une valeur dans "Rotation shed" (≠ 0) : cette valeur DÉFINIT
    //   directement le nouvel azimut de calcul (remplace gridBaseHeading, ne s'y ajoute pas).
    // On ne touche pas à `visualAzimuth` (flèche/label, comportement inchangé).
    const pvgisSourceAzimuth = polygon.shedsCapable
      ? (azimuth !== 0 ? azimuth : ((typeof polygon.gridBaseHeading === 'number' ? polygon.gridBaseHeading : 180) - 180))
      : visualAzimuth;

    // NOUVEAU: Synchroniser l'input Azimut avec le référentiel PVGIS (Sud = 0)
    const azimuthInput = document.querySelector(`#azimuth-${pvId}`);
    if (azimuthInput) {
      let pvgisAzimuth = pvgisSourceAzimuth;
      let normVal = Math.round(pvgisAzimuth);
      if (normVal <= -180) normVal += 360;
      if (normVal > 180) normVal -= 360;
      if (parseFloat(azimuthInput.value) !== normVal) {
        azimuthInput.value = normVal;
        azimuthInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // Conteneur global combinant Label et Flèche en position absolue
    const containerDiv = document.createElement("div");
    containerDiv.style.cssText = `position: absolute; display: flex; align-items: center; justify-content: center; pointer-events: none; overflow: visible;`;

    const labelDiv = document.createElement("div");
    const baseStyle = (STYLES && STYLES.MEASUREMENT_LABEL) ? STYLES.MEASUREMENT_LABEL : "background-color: white; border: 1px solid #1A73E8; color: #333;";
    labelDiv.style.cssText = `${baseStyle} position: absolute; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.3); z-index: 1010; white-space: nowrap; transform: translate(-50%, -50%) rotate(${visualAzimuth}deg) translateY(-18px);`;
    labelDiv.textContent = pvId;

    const arrowDiv = document.createElement("div");
    arrowDiv.style.cssText = `position: absolute; transform-origin: center center; transform: translate(-50%, -50%) rotate(${visualAzimuth}deg) translateY(18px); width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;`;
    arrowDiv.innerHTML = `<img src="/static/concevoir_mon_projet/medias/icons/arrow.svg" style="width:100%; height:100%; opacity:0.8;">`;

    containerDiv.appendChild(labelDiv);
    containerDiv.appendChild(arrowDiv);

    try {
      const marker = new dc.AdvancedMarkerElement({ map: dc.map, position: center, content: containerDiv, zIndex: 10000 });
      overlays.push({ setMap: (m) => { marker.map = m; }, marker: marker });
    } catch(err) {
      console.error("Erreur lors de l'ajout des visuels de toiture (Polygon):", err);
    }
  }

  /**
   * Bascule la visibilité du label PV + de la flèche d'azimut de toutes les formes gérées ici
   * (cf. updateRoofVisuals/roofOverlaysByShape) — appelé par DrawingControl::updateCotationsVisibility.
   * CORRECTIF (bug "le label PV et la flèche ne suivent pas Afficher/masquer les cotations") :
   * ces overlays sont stockés dans roofOverlaysByShape, jamais dans drawingControl.permanentLabels
   * (contrairement aux labels -id/-azimuth des formes "simples"), donc invisibles pour le mécanisme
   * générique de bascule tant que cette méthode n'existe pas.
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

  /**
   * Réinitialise le compteur de polygones (utile pour le nettoyage)
   */
  resetPolygonCount() {
    // Conservé pour compatibilité, mais ne fait plus rien :
    // on autorise désormais le dessin successif de polygones PV.
  }
}

export default Polygon;
