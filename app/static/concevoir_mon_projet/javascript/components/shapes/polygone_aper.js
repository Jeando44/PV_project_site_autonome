/**
 * Gestionnaire des polygones dédiés à la Loi APER (surfaces "+ Surface" et "- Exclusion").
 * Dessine directement sur la carte principale (window.drawingControl.map) — pas de carte séparée.
 * Autonome : aucune dépendance à DrawingControl.js (pas de grille de panneaux, pas de persistance solarProjectData).
 */
class AperPolygonManager {
    constructor(map, errorModal) {
        this.map = map;
        this.errorModal = errorModal;

        this.surfacePolygons = [];
        this.exclusionPolygons = [];
        this.helperPolygons = [];

        this.selected = null;
        this.copyBuffer = null;
        this.isCopying = false;

        this.onChange = null; // callback(): appelé après tout ajout/suppression/modif
        this.onOverlapChange = null; // callback(hasOverlap: boolean)

        // CORRECTIF (migration Terra Draw, google.maps.drawing.DrawingManager en fin de vie) : le
        // tracé passe désormais par le moteur Terra Draw PARTAGÉ de DrawingControl.js (modes nommés
        // 'aper-surface'/'aper-exclusion', cf. TerraDrawEngine.js), au lieu d'un DrawingManager natif
        // dédié à ce gestionnaire. La forme obtenue en sortie reste un google.maps.Polygon 100%
        // standard (TerraDrawEngine convertit systématiquement la feature GeoJSON avant de la
        // transmettre) : _initPolygon() ci-dessous, la sélection, JSTS (fusion/chevauchements) et la
        // persistance n'ont donc besoin d'AUCUNE modification, comme avant la migration.

        this._mapClickListener = this.map.addListener('click', (e) => {
            if (this.isCopying && this.copyBuffer) {
                this.pasteAt(e.latLng);
                return;
            }
            this.clearSelection();
        });
    }

    startDrawSurface() {
        this._startDrawing('aper-surface', 'surface');
    }

    startDrawExclusion() {
        this._startDrawing('aper-exclusion', 'exclusion');
    }

    /**
     * Démarre le tracé d'un polygone APER via le moteur Terra Draw partagé (window.drawingControl.
     * terraDrawEngine — même instance que le calepinage PV/les obstacles/les formes simples). Un seul
     * tracé à la fois : le mode repasse automatiquement en 'select' après chaque forme terminée
     * (TerraDrawEngine::stop(), appelé par ButtonControl.js::clearAllActiveModes au prochain clic
     * d'outil — comportement "un tracé par clic sur le bouton" identique à l'ancien polygoncomplete).
     * @param {string} modeName - 'aper-surface' ou 'aper-exclusion'
     * @param {'surface'|'exclusion'} type
     */
    _startDrawing(modeName, type) {
        const engine = window.drawingControl && window.drawingControl.terraDrawEngine;
        if (!engine) {
            if (this.errorModal && typeof this.errorModal.show === 'function') {
                this.errorModal.show("Le moteur de dessin n'est pas encore prêt. Veuillez réessayer.");
            }
            return;
        }
        engine.start(modeName, (polygon) => {
            this._initPolygon(polygon, type);
        }).catch((error) => {
            console.error('[AperPolygonManager] Échec de démarrage de Terra Draw:', error);
            if (this.errorModal && typeof this.errorModal.show === 'function') {
                this.errorModal.show("Impossible de démarrer l'outil de dessin (Terra Draw). Détail dans la console (F12).");
            }
        });
    }

    _initPolygon(poly, type) {
        poly.set('type', type);
        const color = (type === 'exclusion') ? '#f44336' : '#4CAF50';
        const zIndex = (type === 'exclusion') ? 2 : 1;

        poly.setOptions({
            fillColor: color, strokeColor: color, fillOpacity: 0.45,
            zIndex, editable: true, draggable: true
        });

        if (type === 'exclusion') this.exclusionPolygons.push(poly);
        else this.surfacePolygons.push(poly);

        const notify = () => { this.detectOverlaps(); this._notifyChange(); };
        google.maps.event.addListener(poly.getPath(), 'set_at', notify);
        google.maps.event.addListener(poly.getPath(), 'insert_at', notify);
        google.maps.event.addListener(poly, 'dragend', notify);

        google.maps.event.addListener(poly, 'click', (e) => {
            if (this.isCopying) return;
            // Si un autre outil de dessin est actif (ex: calepinage PV en polygone/ligne), on laisse le
            // clic remonter à la carte au lieu de le capter ici : sinon impossible de dessiner un
            // calepinage par-dessus une zone APER (le clic de sélection l'interceptait avant la carte).
            if (AperPolygonManager._isOtherDrawingModeActive()) return;
            // Si NOTRE propre mode de dessin (+ Surface / - Exclusion) était resté armé sans qu'aucune
            // forme n'ait été complétée, un clic sur une forme EXISTANTE signifie qu'on veut la
            // sélectionner/déplacer, pas continuer à dessiner : on annule ce mode résiduel avant de
            // sélectionner, sinon la forme reste bloquée (non déplaçable) tant que le mode est actif.
            const engine = window.drawingControl && window.drawingControl.terraDrawEngine;
            if (engine && engine.isActive &&
                (engine.activeModeName === 'aper-surface' || engine.activeModeName === 'aper-exclusion')) {
                engine.stop();
            }
            this.selectPolygon(poly);
            if (e) e.stop();
        });

        this.selectPolygon(poly);
        notify();
        return poly;
    }

    selectPolygon(poly) {
        this.clearSelection();
        this.selected = poly;
        poly.setOptions({ strokeWeight: 5, strokeColor: '#000000' });
    }

    clearSelection() {
        if (this.selected) {
            const color = (this.selected.get('type') === 'exclusion') ? '#f44336' : '#4CAF50';
            this.selected.setOptions({ strokeWeight: 2, strokeColor: color });
            this.selected = null;
        }
    }

    deleteSelected() {
        if (!this.selected) return;
        const target = this.selected;
        target.setMap(null);
        this.surfacePolygons = this.surfacePolygons.filter((p) => p !== target);
        this.exclusionPolygons = this.exclusionPolygons.filter((p) => p !== target);
        this.selected = null;
        this.detectOverlaps();
        this._notifyChange();
    }

    toggleVisibility(type) {
        const list = (type === 'exclusion') ? this.exclusionPolygons : this.surfacePolygons;
        if (list.length === 0) return;
        const isVisible = list[0].getVisible();
        list.forEach((p) => p.setVisible(!isVisible));
    }

    startCopySelected() {
        if (!this.selected) {
            if (this.errorModal && typeof this.errorModal.show === 'function') {
                this.errorModal.show("Sélectionnez d'abord une surface à copier.");
            }
            return;
        }
        this.copyBuffer = {
            path: this.selected.getPath().getArray().map((p) => ({ lat: p.lat(), lng: p.lng() })),
            type: this.selected.get('type')
        };
        this.isCopying = true;
        this.map.getDiv().style.cursor = 'crosshair';
    }

    pasteAt(latLng) {
        if (!this.copyBuffer) return;
        const origin = this.copyBuffer.path[0];
        const offsetLat = latLng.lat() - origin.lat;
        const offsetLng = latLng.lng() - origin.lng;

        const newPath = this.copyBuffer.path.map((p) => ({
            lat: p.lat + offsetLat,
            lng: p.lng + offsetLng
        }));

        const newPoly = new google.maps.Polygon({ paths: newPath, map: this.map });
        this._initPolygon(newPoly, this.copyBuffer.type);

        this.isCopying = false;
        this.map.getDiv().style.cursor = '';
    }

    _polyToGeoJSON(poly) {
        const coords = poly.getPath().getArray().map((pt) => [pt.lng(), pt.lat()]);
        coords.push(coords[0]);
        return { type: 'Polygon', coordinates: [coords] };
    }

    _createHelper(geojson, fill, stroke) {
        const helper = new google.maps.Polygon({
            paths: geojson.coordinates[0].map((c) => ({ lat: c[1], lng: c[0] })),
            fillColor: fill, fillOpacity: 0.7, strokeColor: stroke, strokeWeight: 2,
            zIndex: 10, map: this.map, clickable: false
        });
        this.helperPolygons.push(helper);
    }

    detectOverlaps() {
        this.helperPolygons.forEach((p) => p.setMap(null));
        this.helperPolygons = [];

        if (typeof jsts === 'undefined') return;

        const reader = new jsts.io.GeoJSONReader();
        const writer = new jsts.io.GeoJSONWriter();
        let overlapFound = false;

        try {
            const checkIntra = (list) => {
                for (let i = 0; i < list.length; i++) {
                    for (let j = i + 1; j < list.length; j++) {
                        const g1 = reader.read(this._polyToGeoJSON(list[i]));
                        const g2 = reader.read(this._polyToGeoJSON(list[j]));
                        if (g1.intersects(g2)) {
                            const intersection = g1.intersection(g2);
                            if (!intersection.isEmpty()) {
                                this._createHelper(writer.write(intersection), '#ffeb3b', '#fbc02d');
                                overlapFound = true;
                            }
                        }
                    }
                }
            };
            checkIntra(this.surfacePolygons);
            checkIntra(this.exclusionPolygons);
        } catch (e) {
            console.warn('AperPolygonManager: erreur détection chevauchements', e);
        }

        if (typeof this.onOverlapChange === 'function') this.onOverlapChange(overlapFound);
        return overlapFound;
    }

    _createMergedPolygon(coords, type) {
        const paths = coords.map((ring) => ring.map((c) => ({ lat: c[1], lng: c[0] })));
        const poly = new google.maps.Polygon({ paths, map: this.map });
        this._initPolygon(poly, type);
    }

    mergePolygons(type) {
        if (typeof jsts === 'undefined') return;
        const list = (type === 'exclusion') ? this.exclusionPolygons : this.surfacePolygons;
        if (list.length < 2) return;

        const reader = new jsts.io.GeoJSONReader();
        const writer = new jsts.io.GeoJSONWriter();

        let merged = reader.read(this._polyToGeoJSON(list[0]));
        for (let i = 1; i < list.length; i++) {
            merged = merged.union(reader.read(this._polyToGeoJSON(list[i])));
        }

        list.forEach((p) => p.setMap(null));
        if (type === 'exclusion') this.exclusionPolygons = [];
        else this.surfacePolygons = [];

        const geo = writer.write(merged);
        if (geo.type === 'Polygon') {
            this._createMergedPolygon(geo.coordinates, type);
        } else if (geo.type === 'MultiPolygon') {
            geo.coordinates.forEach((c) => this._createMergedPolygon(c, type));
        }

        this.detectOverlaps();
        this._notifyChange();
    }

    getTotalSurfaceArea() {
        return this.surfacePolygons.reduce((sum, p) => sum + google.maps.geometry.spherical.computeArea(p.getPath()), 0);
    }

    getTotalExclusionArea() {
        return this.exclusionPolygons.reduce((sum, p) => sum + google.maps.geometry.spherical.computeArea(p.getPath()), 0);
    }

    _notifyChange() {
        if (typeof this.onChange === 'function') this.onChange();
    }

    // Vrai si un outil de dessin PV (ou autre) de DrawingControl est actuellement actif — permet
    // aux polygones APER de ne pas intercepter les clics destinés à un dessin de calepinage.
    static _isOtherDrawingModeActive() {
        const dc = window.drawingControl;
        if (!dc) return false;
        if (dc.drawingManager && typeof dc.drawingManager.getDrawingMode === 'function' && dc.drawingManager.getDrawingMode() !== null) {
            return true;
        }
        // Le moteur Terra Draw est PARTAGÉ entre tous les outils (calepinage PV, obstacles, formes
        // simples, et désormais APER) : un mode actif ne signifie "un AUTRE outil dessine" que s'il ne
        // s'agit pas de l'un des 2 modes propres à APER lui-même.
        if (dc.terraDrawEngine && dc.terraDrawEngine.isActive &&
            dc.terraDrawEngine.activeModeName !== 'aper-surface' && dc.terraDrawEngine.activeModeName !== 'aper-exclusion') {
            return true;
        }
        return !!(dc.isPasteMode || dc.simpleRectangleMode || dc.simplePolygonMode || dc.isShedsPolygonModeActive);
    }
}

window.AperPolygonManager = AperPolygonManager;
