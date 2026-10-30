export default class LocalisationMatElec {
    constructor(drawingControl) {
        this.drawingControl = drawingControl;

        // Collections d'éléments
        this.irveMarkers = [];
        this.organeMarkers = [];
        this.cables = [];

        // État de visibilité
        this.isIrveVisible = true;
        this.showOrganes = true;
        this.areCablesVisible = true;
        this.showLabels = true; // [Tâche 4] Initialisation de l'état des labels

        // État du mode actif
        this.isActive = false;
        this.currentMode = null;

        // Listeners Google Maps
        this.mapClickListener = null;
        this.cableClickListener = null;
        this.cableDblClickListener = null;
        this.cableMoveListener = null;

        // Données temporaires pour le traçage des câbles
        this.currentCablePath = [];
        this.currentPolyline = null;
        this.tempLine = null;
        this.tempLabel = null; // [Tâche 2] Label temporaire pour la mesure
        this.clickTimeout = null; // Timeout pour empêcher le conflit clic simple / double-clic

        // Dictionnaire des types d'organes
        this.ORGANE_TYPES = {
            'TGBT_Batiment': { title: 'TGBT Bâtiment', color: '#EF4444' },
            'TGBT_PV': { title: 'TGBT PV', color: '#EAB308' },
            'TGBT_IRVE': { title: 'TGBT IRVE', color: '#3B82F6' },
            'TGBT_PV_IRVE': { title: 'TGBT PV & IRVE', color: '#8B5CF6' },
            'Poste_Soutirage': { title: 'Poste Soutirage', color: '#F97316' },
            'Poste_Production': { title: 'Poste Production', color: '#10B981' },
            'IRVE': { title: 'Borne IRVE', color: '#1E8449' },
            'PDL': { title: 'PDL', color: '#FDE047' }
        };
    }

    get map() {
        return this.drawingControl.map;
    }

    saveData() {
        if (window.storageManager && typeof window.storageManager.savePageData === 'function') {
            // Exécuter dans un micro-délai pour garantir que l'objet a bien été mis à jour
            setTimeout(() => window.storageManager.savePageData(), 50);
        }
    }

    collectData() {
        try {
            return {
                irveMarkers: this.irveMarkers.filter(m => m && typeof m.getPosition === 'function').map(m => ({
                    lat: m.getPosition().lat(),
                    lng: m.getPosition().lng(),
                    type: m.matElecType
                })),
                organeMarkers: this.organeMarkers.filter(m => m && typeof m.getPosition === 'function').map(m => ({
                    lat: m.getPosition().lat(),
                    lng: m.getPosition().lng(),
                    type: m.matElecType
                })),
                cables: this.cables.filter(c => c && typeof c.getPath === 'function').map(c => ({
                    path: c.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() }))
                })),
                showLabels: this.showLabels,
                isIrveVisible: this.isIrveVisible,
                showOrganes: this.showOrganes,
                areCablesVisible: this.areCablesVisible
            };
        } catch (error) {
            console.error("Erreur lors de la collecte du matériel électrique:", error);
            return {};
        }
    }

    loadFromData(data) {
        if (!data || typeof data !== 'object') return;

        try {
            // Nettoyage préalable pour éviter la duplication des éléments en cas de double-chargement de la carte (StorageManager vs OnAdd)
            this.irveMarkers.forEach(m => m.setMap(null));
            this.organeMarkers.forEach(m => m.setMap(null));
            this.cables.forEach(c => {
                c.setMap(null);
                if (c.lengthLabel) c.lengthLabel.setMap(null);
            });
            this.irveMarkers = [];
            this.organeMarkers = [];
            this.cables = [];

            this.showLabels = data.showLabels !== undefined ? data.showLabels : true;
            this.isIrveVisible = data.isIrveVisible !== undefined ? data.isIrveVisible : true;
            this.showOrganes = data.showOrganes !== undefined ? data.showOrganes : true;
            this.areCablesVisible = data.areCablesVisible !== undefined ? data.areCablesVisible : true;

            if (Array.isArray(data.irveMarkers)) {
                data.irveMarkers.forEach(m => {
                    if (m && m.lat !== undefined && m.lng !== undefined) {
                        this.placeMarker(new google.maps.LatLng(m.lat, m.lng), m.type, true);
                    }
                });
            }

            if (Array.isArray(data.organeMarkers)) {
                data.organeMarkers.forEach(m => {
                    if (m && m.lat !== undefined && m.lng !== undefined) {
                        this.placeMarker(new google.maps.LatLng(m.lat, m.lng), m.type, true);
                    }
                });
            }

            if (Array.isArray(data.cables)) {
                data.cables.forEach(c => {
                    if (c && Array.isArray(c.path) && c.path.length > 1) {
                        const path = c.path.map(p => new google.maps.LatLng(p.lat, p.lng));
                        this.restoreCable(path);
                    }
                });
            }
        } catch (error) {
            console.error("Erreur lors du chargement des matériels électriques:", error);
        }
    }

    startMode(mode) {
        this.stopMode();
        this.isActive = true;
        this.currentMode = mode;

        if (mode === 'CABLE') {
            this.startCableDrawing();
        } else {
            // Mode positionnement de marqueur
            this.map.setOptions({ draggableCursor: 'crosshair' });
            this.mapClickListener = google.maps.event.addListener(this.map, 'click', (e) => {
                this.placeMarker(e.latLng, mode);
            });
        }
    }

    stopMode() {
        this.isActive = false;
        this.currentMode = null;

        if (this.clickTimeout) {
            clearTimeout(this.clickTimeout);
            this.clickTimeout = null;
        }

        // Nettoyage des listeners
        if (this.mapClickListener) google.maps.event.removeListener(this.mapClickListener);
        if (this.cableClickListener) google.maps.event.removeListener(this.cableClickListener);
        if (this.cableDblClickListener) google.maps.event.removeListener(this.cableDblClickListener);
        if (this.cableMoveListener) google.maps.event.removeListener(this.cableMoveListener);

        this.mapClickListener = null;
        this.cableClickListener = null;
        this.cableDblClickListener = null;
        this.cableMoveListener = null;

        // Nettoyage des lignes temporaires (Câble)
        if (this.tempLine) {
            this.tempLine.setMap(null);
            this.tempLine = null;
        }
        if (this.tempLabel) {
            this.tempLabel.setMap(null);
            this.tempLabel = null;
        }
        if (this.currentPolyline && this.currentCablePath.length < 2) {
            this.currentPolyline.setMap(null);
        }

        this.currentPolyline = null;
        this.currentCablePath = [];
        // Restaure les options de la carte (notamment le double clic pour zoomer)
        this.map.setOptions({ draggableCursor: null, disableDoubleClickZoom: false });
    }

    placeMarker(latLng, type, isLoading = false) {
        const config = this.ORGANE_TYPES[type];
        if (!config) return;

        // [Tâche 3] Forme carrée pour les organes (sauf IRVE)
        const isSquare = type !== 'IRVE';
        const iconPath = isSquare ? "M -1 -1 L 1 -1 L 1 1 L -1 1 Z" : google.maps.SymbolPath.CIRCLE;
        // Respecter l'état de visibilité lors de la recréation
        const isVisible = type === 'IRVE' ? this.isIrveVisible : this.showOrganes;

        const marker = new google.maps.Marker({
            position: latLng,
            map: isVisible ? this.map : null,
            draggable: true,
            title: config.title,
            // [Tâche 4] Affichage dynamique du label au placement
            label: this.showLabels ? {
                text: config.title,
                color: config.color, // [Tâche 3] Couleur correspondante à l'élément
                fontSize: '14px', // [Tâche 3] Police augmentée
                fontWeight: 'bold'
            } : null,
            icon: {
                path: iconPath,
                scale: isSquare ? 8 : 10, // [Tâche 3] Échelle augmentée
                fillColor: config.color,
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: '#FFFFFF',
                labelOrigin: new google.maps.Point(0, -3.5) // [Tâche 3] Repositionnement du label au-dessus
            }
        });

        marker.matElecLabelText = config.title; // Sauvegarde du texte pour la bascule
        marker.matElecType = type;

        marker.addListener('dragend', () => {
            this.saveData();
        });

        if (type === 'IRVE') {
            this.irveMarkers.push(marker);
        } else {
            this.organeMarkers.push(marker);
        }

        // [Tâche 1] Suppression directe au clic droit sur le marqueur (sans dialogue)
        marker.addListener('rightclick', () => {
            marker.setMap(null);
            this.irveMarkers = this.irveMarkers.filter(m => m !== marker);
            this.organeMarkers = this.organeMarkers.filter(m => m !== marker);
            this.saveData();
            this.saveData(); // Correction: Ajout de la sauvegarde lors de la suppression
        });

        if (!isLoading) this.saveData();
    }



    _updateCableLabel(cable) {
        const path = cable.getPath();
        if (!path || path.getLength() < 2) return;
        const finalLength = google.maps.geometry.spherical.computeLength(path);

        let halfDist = finalLength / 2;
        let distSoFar = 0;
        let midPoint = path.getAt(0);
        let heading = 0;

        for (let i = 0; i < path.getLength() - 1; i++) {
            let p1 = path.getAt(i);
            let p2 = path.getAt(i + 1);
            let segDist = google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
            if (distSoFar + segDist >= halfDist) {
                let ratio = (halfDist - distSoFar) / segDist;
                midPoint = google.maps.geometry.spherical.interpolate(p1, p2, ratio);
                heading = google.maps.geometry.spherical.computeHeading(p1, p2);
                break;
            }
            distSoFar += segDist;
        }

        const text = finalLength > 1000 ? (finalLength / 1000).toFixed(2) + " km" : Math.round(finalLength) + " m";
        let svgRot = (heading - 90) % 360;
        if (svgRot < 0) svgRot += 360;
        if (svgRot > 90 && svgRot < 270) svgRot -= 180;

        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><g transform="rotate(${svgRot}, 50, 15)"><text x="50" y="16" font-size="14" font-family="Arial" fill="#FF0000" font-weight="bold" text-anchor="middle" dominant-baseline="middle" style="text-shadow: 1px 1px 0 #FFF, -1px -1px 0 #FFF, 1px -1px 0 #FFF, -1px 1px 0 #FFF;">${text}</text></g></svg>`;

        if (cable.lengthLabel) {
            cable.lengthLabel.setPosition(midPoint);
            cable.lengthLabel.setIcon({ url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgContent), anchor: new google.maps.Point(50, 15) });
            cable.lengthLabel.setLabel(null);
        }
    }

    startCableDrawing() {
        // Désactiver le zoom au double clic pour fiabiliser la fin du tracé
        this.map.setOptions({ draggableCursor: 'crosshair', disableDoubleClickZoom: true });
        this.currentCablePath = [];

        // Ajout de clickable: false pour empêcher les éléments en cours de tracé d'intercepter les clics
        this.currentPolyline = new google.maps.Polyline({ path: [], strokeColor: '#FF0000', strokeWeight: 4, map: this.map, clickable: false });
        this.tempLine = new google.maps.Polyline({ path: [], strokeColor: '#FF0000', strokeWeight: 4, strokeOpacity: 0.5, map: this.map, clickable: false });

        this.tempLabel = new google.maps.Marker({
            map: this.map,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
            zIndex: 1000,
            clickable: false
        });

        this.cableClickListener = google.maps.event.addListener(this.map, 'click', (e) => {
            if (this.clickTimeout) clearTimeout(this.clickTimeout);

            // Micro-délai pour s'assurer que ce n'est pas le début d'un double-clic
            this.clickTimeout = setTimeout(() => {
                this.currentCablePath.push(e.latLng);
                this.currentPolyline.setPath(this.currentCablePath);
                this._updateCableLabel(this.currentPolyline);
            }, 250);
        });

        this.cableMoveListener = google.maps.event.addListener(this.map, 'mousemove', (e) => {
            if (this.currentCablePath.length > 0) {
                const lastPoint = this.currentCablePath[this.currentCablePath.length - 1];
                this.tempLine.setPath([lastPoint, e.latLng]);

                const tempPath = [...this.currentCablePath, e.latLng];
                const length = google.maps.geometry.spherical.computeLength(tempPath);

                let halfDist = length / 2;
                let distSoFar = 0;
                let tempMidPoint = tempPath[0];
                let heading = 0;
                for (let i = 0; i < tempPath.length - 1; i++) {
                    let p1 = tempPath[i];
                    let p2 = tempPath[i + 1];
                    let segDist = google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
                    if (distSoFar + segDist >= halfDist) {
                        let ratio = (halfDist - distSoFar) / segDist;
                        tempMidPoint = google.maps.geometry.spherical.interpolate(p1, p2, ratio);
                        heading = google.maps.geometry.spherical.computeHeading(p1, p2);
                        break;
                    }
                    distSoFar += segDist;
                }

                const text = length > 1000 ? (length / 1000).toFixed(2) + " km" : Math.round(length) + " m";
                let svgRot = (heading - 90) % 360;
                if (svgRot < 0) svgRot += 360;
                if (svgRot > 90 && svgRot < 270) svgRot -= 180;

                const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><g transform="rotate(${svgRot}, 50, 15)"><text x="50" y="16" font-size="14" font-family="Arial" fill="#FF0000" font-weight="bold" text-anchor="middle" dominant-baseline="middle" style="text-shadow: 1px 1px 0 #FFF, -1px -1px 0 #FFF, 1px -1px 0 #FFF, -1px 1px 0 #FFF;">${text}</text></g></svg>`;

                this.tempLabel.setPosition(tempMidPoint);
                this.tempLabel.setIcon({ url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgContent), anchor: new google.maps.Point(50, 15) });
                this.tempLabel.setLabel(null);
            }
        });

        // [Tâche 2] Terminer avec un double clic
        this.cableDblClickListener = google.maps.event.addListener(this.map, 'dblclick', (e) => {
            // Annuler immédiatement l'événement de clic simple en attente
            if (this.clickTimeout) {
                clearTimeout(this.clickTimeout);
                this.clickTimeout = null;
            }

            // Ajouter une unique fois le point final où a eu lieu le double-clic
            this.currentCablePath.push(e.latLng);
            this.currentPolyline.setPath(this.currentCablePath);

            if (this.currentCablePath.length > 1) {
                const finishedLine = this.currentPolyline;
                finishedLine.setOptions({ clickable: true, editable: true, draggable: true });

                const lengthLabel = new google.maps.Marker({
                    position: this.currentCablePath[0],
                    map: this.showLabels ? this.map : null,
                    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
                    zIndex: 1000,
                    clickable: false
                });
                finishedLine.lengthLabel = lengthLabel;
                this._updateCableLabel(finishedLine);

                this.cables.push(finishedLine);

                // [Tâche 1] Suppression directe du câble via un clic droit (sans dialogue)
                finishedLine.addListener('rightclick', () => {
                    finishedLine.setMap(null);
                    if (finishedLine.lengthLabel) finishedLine.lengthLabel.setMap(null);
                    this.cables = this.cables.filter(c => c !== finishedLine);
                    this.saveData();
                    this.saveData(); // Correction: Ajout de la sauvegarde lors de la suppression
                });

                ['set_at', 'insert_at', 'remove_at'].forEach(eventName => {
                    google.maps.event.addListener(finishedLine.getPath(), eventName, () => {
                        this._updateCableLabel(finishedLine);
                        this.saveData();
                    });
                });
                finishedLine.addListener('dragend', () => {
                    this._updateCableLabel(finishedLine);
                    this.saveData();
                });

                this.saveData(); // Sauvegarde le câble nouvellement tracé
            } else {
                this.currentPolyline.setMap(null);
            }
            this.stopMode(); // On quitte le mode câble à la fin du tracé
        });
    }

    // Fonction isolée pour restaurer les câbles sans déclencher l'interface de dessin
    restoreCable(pathLatLngs) {
        const polyline = new google.maps.Polyline({
            path: pathLatLngs,
            strokeColor: '#FF0000',
            strokeWeight: 4,
            map: this.areCablesVisible ? this.map : null,
            clickable: true,
            editable: true,
            draggable: true
        });


        const lengthLabel = new google.maps.Marker({
            position: pathLatLngs[0],
            map: this.showLabels && this.areCablesVisible ? this.map : null,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
            zIndex: 1000,
            clickable: false
        });
        polyline.lengthLabel = lengthLabel;
        this._updateCableLabel(polyline);
        this.cables.push(polyline);

        polyline.addListener('rightclick', () => {
            polyline.setMap(null);
            if (polyline.lengthLabel) polyline.lengthLabel.setMap(null);
            this.cables = this.cables.filter(c => c !== polyline);
            this.saveData();
            this.saveData(); // Correction: Ajout de la sauvegarde lors de la suppression
        });

        ['set_at', 'insert_at', 'remove_at'].forEach(eventName => {
            google.maps.event.addListener(polyline.getPath(), eventName, () => {
                this._updateCableLabel(polyline);
                this.saveData();
            });
        });
        polyline.addListener('dragend', () => {
            this._updateCableLabel(polyline);
            this.saveData();
        });
    }

    toggleVisibility(toggleType) {
        if (toggleType === 'TOGGLE_IRVE') {
            this.isIrveVisible = !this.isIrveVisible;
            this.irveMarkers.forEach(m => m.setMap(this.isIrveVisible ? this.map : null));
        } else if (toggleType === 'TOGGLE_ORGANES') {
            this.showOrganes = !this.showOrganes;
            this.organeMarkers.forEach(m => m.setMap(this.showOrganes ? this.map : null));
        } else if (toggleType === 'TOGGLE_CABLES') {
            this.areCablesVisible = !this.areCablesVisible;
            this.cables.forEach(c => {
                c.setMap(this.areCablesVisible ? this.map : null);
                if (c.lengthLabel) c.lengthLabel.setMap(this.areCablesVisible && this.showLabels ? this.map : null);
            });
        } else if (toggleType === 'TOGGLE_LABELS') {
            this.showLabels = !this.showLabels;
            const applyLabel = (m) => {
                const labelColor = this.ORGANE_TYPES[m.matElecType] ? this.ORGANE_TYPES[m.matElecType].color : '#333';
                m.setLabel(this.showLabels ? { text: m.matElecLabelText, color: labelColor, fontSize: '14px', fontWeight: 'bold' } : null);
            };
            this.irveMarkers.forEach(applyLabel);
            this.organeMarkers.forEach(applyLabel);
            this.cables.forEach(c => {
                if (c.lengthLabel) {
                    c.lengthLabel.setMap(this.showLabels && this.areCablesVisible ? this.map : null);
                }
            });
        }
        // Sauvegarder la bascule d'affichage pour la conserver lors de l'actualisation
        this.saveData();
    }
}