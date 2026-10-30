import { PROFIL_EVENTS, MESSAGES, ELEVATION_PROVIDERS } from '../constants.js';
import GeometryUtils from '../utils/GeometryUtils.js';

/**
 * Gestionnaire du mode dessin de ligne sur la carte
 * @class DrawingHandler
 */
class DrawingHandler {
  /**
   * @param {google.maps.Map} map - Instance de la carte
   */
  constructor(map) {
    this.map = map;
    this.isDrawing = false;
    this.currentPoints = [];
    this.currentPolyline = null;
    this.currentMarkers = [];
    this.temporaryLine = null;
    this.originalCursor = null;
    this.originalDraggable = null;
    this.drawingOverlay = null; // Overlay transparent pour capturer les clics
    this.profilAltimetriqueName = null;
    this.currentProvider = ELEVATION_PROVIDERS.GEOPORTAIL; // Provider par défaut
    // Listeners
    this.clickListener = null;
    this.rightClickListener = null;
    this.mouseMoveListener = null;
    this.escapeListener = null;
  }

  /**
   * Définit le provider à utiliser pour le dessin
   * @param {string} provider - Provider (geoportail ou google_maps)
   */
  setProvider(provider) {
    this.currentProvider = provider || ELEVATION_PROVIDERS.GEOPORTAIL;
  }

  /**
   * Active le mode dessin
   */
  startDrawingMode() {
    if (this.isDrawing) return;

    
    if (!this.map) {
      console.error('[ProfilAltimetrique] ERREUR: La carte n\'est pas initialisée !');
      return;
    }

    this.isDrawing = true;
    this.currentPoints = [];
    
    // Sauvegarder le curseur AVANT de créer l'overlay
    this.originalCursor = this.map.getDiv().style.cursor || '';
    
    // Créer un overlay transparent pour capturer les clics de manière fiable
    this._createDrawingOverlay();
    
    // Changer le curseur sur le div de la carte
    this.map.getDiv().style.cursor = 'crosshair';
    
    // Désactiver le dragging pour plus de précision
    this.originalDraggable = this.map.get('draggable');
    this.map.setOptions({ 
      draggable: false,
      disableDoubleClickZoom: true
    });

    // Ajouter les listeners de clavier
    this._addKeyboardListeners();

    // Dispatcher l'événement
    document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.DRAWING_STARTED));
    document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.MODE_ACTIVATED));

  }

  /**
   * Crée un overlay transparent pour capturer les clics
   * @private
   */
  _createDrawingOverlay() {
    // Créer un div qui couvre toute la carte
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      cursor: crosshair;
      z-index: 1000;
      background: transparent;
    `;

    // Ajouter les événements de clic directement sur l'overlay
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      const bounds = this.map.getDiv().getBoundingClientRect();
      const x = e.clientX - bounds.left;
      const y = e.clientY - bounds.top;
      
      // Convertir les coordonnées pixel en LatLng
      const projection = this.map.getProjection();
      const topRight = this.map.getBounds().getNorthEast();
      const bottomLeft = this.map.getBounds().getSouthWest();
      const scale = Math.pow(2, this.map.getZoom());
      
      const worldCoordinateCenter = projection.fromLatLngToPoint(this.map.getCenter());
      const pixelOffset = new google.maps.Point(
        (x - bounds.width / 2) / scale,
        (y - bounds.height / 2) / scale
      );
      
      const worldCoordinateNewCenter = new google.maps.Point(
        worldCoordinateCenter.x + pixelOffset.x,
        worldCoordinateCenter.y + pixelOffset.y
      );
      
      const latLng = projection.fromPointToLatLng(worldCoordinateNewCenter);
      
      // Créer un objet événement similaire à Google Maps
      const fakeEvent = {
        latLng: latLng,
        pixel: { x, y }
      };
      
      this._handleMapClick(fakeEvent);
    });

    overlay.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Créer un faux événement pour le clic droit
      const fakeEvent = {
        stop: () => {}
      };
      
      this._handleMapRightClick(fakeEvent);
    });

    // Ajouter l'overlay à la carte
    this.map.getDiv().appendChild(overlay);
    this.drawingOverlay = overlay;
    
  }

  /**
   * Supprime l'overlay de dessin
   * @private
   */
  _removeDrawingOverlay() {
    if (this.drawingOverlay && this.drawingOverlay.parentNode) {
      this.drawingOverlay.parentNode.removeChild(this.drawingOverlay);
      this.drawingOverlay = null;
    }
    
    // Forcer la restauration du curseur sur le div de la carte
    if (this.map && this.map.getDiv()) {
      this.map.getDiv().style.cursor = this.originalCursor || '';
    }
  }

  /**
   * Désactive le mode dessin
   */
  stopDrawingMode() {
    if (!this.isDrawing) return;

    this.isDrawing = false;

    // Supprimer l'overlay de dessin (cela restaure aussi le curseur)
    this._removeDrawingOverlay();

    // Double vérification : restaurer le curseur sur le div de la carte
    if (this.map && this.map.getDiv()) {
      const cursor = this.originalCursor || '';
      this.map.getDiv().style.cursor = cursor;    
    }

    // Restaurer les options de la carte
    if (this.originalDraggable !== null) {
      this.map.setOptions({ 
        draggable: this.originalDraggable,
        disableDoubleClickZoom: false
      });
    }

    // Retirer les listeners
    this._removeKeyboardListeners();

    // Nettoyer la ligne temporaire
    if (this.temporaryLine) {
      GeometryUtils.clearDrawing(this.temporaryLine, []);
      this.temporaryLine = null;
    }

    // Dispatcher l'événement
    document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.MODE_DEACTIVATED));
  }

  /**
   * Annule le dessin en cours
   */
  cancelDrawing() {
    this.stopDrawingMode();
    
    // Nettoyer complètement
    this.clearLastDrawing();
    this.currentPoints = [];

    // Dispatcher l'événement d'annulation
    document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.DRAWING_CANCELLED));
  }

  /**
   * Nettoie le dernier dessin
   */
  clearLastDrawing() {
    GeometryUtils.clearDrawing(this.currentPolyline, this.currentMarkers);
    this.currentPolyline = null;
    this.currentMarkers = [];
  }

  /**
   * Ajoute les listeners de clavier
   * @private
   */
  _addKeyboardListeners() {
    // Listener pour la touche Échap
    this.escapeListener = (e) => {
      if (e.key === 'Escape' && this.isDrawing) {
        this.cancelDrawing();
      }
    };
    document.addEventListener('keydown', this.escapeListener);
  }

  /**
   * Retire les listeners de clavier
   * @private
   */
  _removeKeyboardListeners() {
    if (this.escapeListener) {
      document.removeEventListener('keydown', this.escapeListener);
      this.escapeListener = null;
    }
  }

  /**
   * Gère le clic sur la carte
   * @private
   * @param {Object} event - Événement Google Maps
   */
  _handleMapClick(event) {
    
    if (!this.isDrawing) {
      return;
    }

    const latLng = event.latLng;
    const point = {
      lat: latLng.lat(),
      lng: latLng.lng()
    };


    // Ajouter le point
    this.currentPoints.push(point);

    // Créer un marker avec la couleur du provider actuel
    const marker = GeometryUtils.createMarker(
      point,
      this.map,
      this.currentPoints.length,
      this.currentProvider
    );
    this.currentMarkers.push(marker);

    // Créer ou mettre à jour la polyline
    if (this.currentPoints.length === 1) {
      // Premier point : initialiser la polyline (temporaire, pas de tooltip) avec la couleur du provider
      const polylineData = GeometryUtils.createPolyline(
        [point], 
        this.map, 
        true, 
        null, 
        this.profilAltimetriqueName, 
        this.currentProvider
      );
      this.currentPolyline = polylineData.polyline || polylineData;
    } else {
      // Points suivants : mettre à jour le chemin
      GeometryUtils.updatePolylinePath(this.currentPolyline, this.currentPoints);
    }

    // Dispatcher l'événement
    document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.POINT_ADDED, {
      detail: { 
        point,
        totalPoints: this.currentPoints.length
      }
    }));
  }

  /**
   * Gère le mouvement de la souris (ligne temporaire)
   * @private
   * @param {Object} event - Événement Google Maps
   */
  _handleMapMouseMove(event) {
    if (!this.isDrawing || this.currentPoints.length === 0) return;

    const latLng = event.latLng;
    const currentPoint = {
      lat: latLng.lat(),
      lng: latLng.lng()
    };

    // Créer/mettre à jour la ligne temporaire avec la couleur du provider
    const tempPath = [...this.currentPoints, currentPoint];
    
    if (this.temporaryLine) {
      GeometryUtils.updatePolylinePath(this.temporaryLine, tempPath);
    } else {
      const polylineData = GeometryUtils.createPolyline(
        tempPath, 
        this.map, 
        true, 
        null, 
        null, 
        this.currentProvider
      );
      this.temporaryLine = polylineData.polyline || polylineData;
    }
  }

  /**
   * Gère le clic droit sur la carte (finalisation)
   * @private
   * @param {Object} event - Événement Google Maps
   */
  _handleMapRightClick(event) {
    if (!this.isDrawing) return;

    // Empêcher le menu contextuel
    event.stop();

    // Vérifier le nombre minimum de points
    if (this.currentPoints.length < 2) {
      // Dispatcher un événement d'erreur
      document.dispatchEvent(new CustomEvent('error:show', {
        detail: { message: MESSAGES.MIN_POINTS_ERROR }
      }));
      this.cancelDrawing();
      return;
    }

    // Finaliser le dessin
    const coordinates = [...this.currentPoints];
    this.stopDrawingMode();

    // Dispatcher l'événement de completion
    document.dispatchEvent(new CustomEvent(PROFIL_EVENTS.DRAWING_COMPLETED, {
      detail: { coordinates }
    }));
  }

  /**
   * Retourne les points actuels
   * @returns {Array<{lat: number, lng: number}>} Points dessinés
   */
  getCurrentPoints() {
    return [...this.currentPoints];
  }

  /**
   * Retourne l'état du mode dessin
   * @returns {boolean} True si en mode dessin
   */
  isInDrawingMode() {
    return this.isDrawing;
  }
}

export default DrawingHandler;

