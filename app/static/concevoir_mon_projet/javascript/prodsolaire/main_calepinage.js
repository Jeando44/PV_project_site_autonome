
        let map, draw;
        let pvOrientation = 'portrait';
        let selectedTerraDrawId = null;

        // [C] Sens du pointeur d'azimut: false = vers l'orientation du panneau, true = vers la source solaire
        let azimuthPointerReversed = false;

        // États pour dessin manuel 3-point
        let pvDrawingMode = false;
        let pvPoints = [];
        let tempPvLine = null;
        let tempPvPoly = null;

        // Rendu graphique des panneaux
        let panelPolygons = [];
        let drawPanelsTimeout = null;

        // État pour la modification manuelle des panneaux
        let manualEditMode = false;
        let hiddenPanels = {};
        let featureMarkers = {};
        let pvCounter = 1;

        // Couleur active des panneaux
        let panelFillColor = '#1565C0';
        const PANEL_COLOR_STROKE = {
            '#9E9E9E': '#616161',
            '#42A5F5': '#1565C0',
            '#212121': '#000000',
            '#66BB6A': '#2E7D32',
            '#EF5350': '#B71C1C',
            '#1565C0': '#0D47A1'
        };

        // Limite initiale de panneaux par feature
        let initialMaxPanelsMap = {};

        // ─── Rectangles gérés en dehors de TerraDraw ─────────────────────────
        // TerraDraw rejette parfois les features ajoutées manuellement via addFeatures().
        // Pour les rectangles 3-points, on les stocke nous-mêmes et on les dessine
        // avec des google.maps.Polygon natifs. TerraDraw reste utilisé uniquement
        // pour les polygones libres (pv-poly).
        let rectFeatures = [];      // Array de { id, coords: [LatLng x4], azimuth, polygon: google.maps.Polygon }

        function generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        }

        let rectOverlayDiv = null;
        let mapOverlayProjection = null;

        // États pour l'algorithme de calepinage
        let marginX = 0;
        let marginY = 0;
        let borderDistance = 0;
        let dilatationWidth = 0;
        let dilatationMaxLength = 0;

        function initMap() {
            map = new google.maps.Map(document.getElementById('map'), {
                zoom: 19,
                center: { lat: 48.8566, lng: 2.3522 },
                mapTypeId: 'satellite',
                tilt: 0
            });

            google.maps.event.addListenerOnce(map, 'idle', () => {
                setupDrawing();
                setupEvents();
                makeModalDraggable();
            });
        }

        window.initMap = initMap;

        function setupDrawing() {
            const mapContainer = document.getElementById('map');
            if (!mapContainer) return;

            const adapter = new terraDrawGoogleMapsAdapter.TerraDrawGoogleMapsAdapter({
                map: map,
                lib: google.maps
            });

            draw = new terraDraw.TerraDraw({
                adapter: adapter,
                modes: [
                    new terraDraw.TerraDrawPolygonMode({
                        modeName: 'pv-poly',
                        styles: {
                            polygonFillColor: '#FFC107',
                            polygonFillOpacity: 0.45,
                            polygonOutlineColor: '#FF9800',
                            polygonOutlineWidth: 2
                        }
                    }),
                    new terraDraw.TerraDrawSelectMode({
                        flags: {
                            'pv-poly': {
                                feature: {
                                    draggable: true,
                                    coordinates: {
                                        midpoints: true,
                                        draggable: true,
                                        deletable: true
                                    }
                                }
                            }
                        }
                    }),
                    new terraDraw.TerraDrawRenderMode({ modeName: 'render' })
                ]
            });

            draw.start();

            // Projection robuste via OverlayView
            const projHelper = new google.maps.OverlayView();
            projHelper.draw = function () {
                if (!mapOverlayProjection) {
                    mapOverlayProjection = this.getProjection();
                }
            };
            projHelper.setMap(map);

            draw.on('finish', (id) => {
                const snapshot = draw.getSnapshot();
                const feature = snapshot.find(f => f.id === id);

                if (feature && feature.properties.mode === 'pv-poly') {
                    const path = getPathFromGeoJson(feature.geometry.coordinates)[0];
                    if (path && path.length > 1) {
                        const newAzimuth = calculatePVAzimuth(path[0], path[1]);
                        const newFeature = {
                            id: generateUUID(),
                            type: 'Feature',
                            geometry: feature.geometry,
                            properties: { ...feature.properties, azimuth: newAzimuth, name: 'PV' + (pvCounter++) }
                        };
                        draw.setMode('select');
                        draw.removeFeatures([id]);
                        draw.addFeatures([newFeature]);
                        selectedTerraDrawId = newFeature.id;
                    }
                } else {
                    draw.setMode('select');
                }
                map.setOptions({ draggableCursor: null, draggable: true });
                updatePvTable();
            });

            draw.on('change', () => {
                updatePvTable();
            });

            draw.on('select', (id) => {
                selectedTerraDrawId = id;
                // Deselect any selected rect
                rectFeatures.forEach(rf => {
                    rf.polygon.setOptions({
                        strokeColor: '#FF9800',
                        strokeWeight: 2
                    });
                });
            });

            draw.on('deselect', () => {
                selectedTerraDrawId = null;
            });
        }

        // ─── Gestion des rectangles natifs (hors TerraDraw) ─────────────────

        /**
         * [B] Maintient la forme strictement rectangulaire lors du déplacement d'un coin.
         * Le coin opposé (movedIdx + 2 mod 4) est conservé fixe.
         * Les deux coins adjacents sont recalculés par projection orthogonale
         * de la diagonale (pOpp → pMoved) sur les deux axes du rectangle.
         *
         * @param {google.maps.MVCArray<google.maps.LatLng>} path - 4 sommets du polygone
         * @param {number} movedIdx - Index du sommet qui vient d'être déplacé
         */
        function constrainRectEdit(path, movedIdx) {
            if (path.getLength() !== 4) return;

            const mi   = movedIdx;
            const opp  = (mi + 2) % 4;  // coin opposé (fixe)
            const adj1 = (mi + 1) % 4;  // coin adjacent "suivant"
            const adj2 = (mi + 3) % 4;  // coin adjacent "précédent"

            const pMoved = path.getAt(mi);
            const pOpp   = path.getAt(opp);

            // Directions des deux côtés du rectangle depuis le coin fixe (pOpp)
            const hOppToAdj1 = google.maps.geometry.spherical.computeHeading(pOpp, path.getAt(adj1));
            const hOppToAdj2 = google.maps.geometry.spherical.computeHeading(pOpp, path.getAt(adj2));

            // Vecteur pOpp → pMoved (la nouvelle diagonale)
            const distOM = google.maps.geometry.spherical.computeDistanceBetween(pOpp, pMoved);
            const hOM    = google.maps.geometry.spherical.computeHeading(pOpp, pMoved);

            // Projection scalaire sur chaque axe: proj = |OM| × cos(angle entre OM et axe)
            // cos() étant pair et périodique, la soustraction directe des headings fonctionne.
            const proj1 = distOM * Math.cos((hOM - hOppToAdj1) * Math.PI / 180);
            const proj2 = distOM * Math.cos((hOM - hOppToAdj2) * Math.PI / 180);

            // Nouveaux coins adjacents = pOpp + projection sur l'axe correspondant
            const newAdj1 = google.maps.geometry.spherical.computeOffset(
                pOpp, Math.abs(proj1),
                proj1 >= 0 ? hOppToAdj1 : (hOppToAdj1 + 180 + 360) % 360
            );
            const newAdj2 = google.maps.geometry.spherical.computeOffset(
                pOpp, Math.abs(proj2),
                proj2 >= 0 ? hOppToAdj2 : (hOppToAdj2 + 180 + 360) % 360
            );

            path.setAt(adj1, newAdj1);
            path.setAt(adj2, newAdj2);
        }

        function createRectFeature(coords4, azimuth) {
            const id = generateUUID();

            const polygon = new google.maps.Polygon({
                map: map,
                paths: coords4,
                fillColor: '#FFC107',
                fillOpacity: 0.45,
                strokeColor: '#FF9800',
                strokeWeight: 2,
                draggable: true,
                editable: true,
                zIndex: 3,
                clickable: true
            });

            const rf = {
                id: id,
                name: 'PV' + (pvCounter++),
                coords: coords4.map(c => new google.maps.LatLng(c.lat(), c.lng())),
                azimuth: azimuth,
                polygon: polygon,
                subType: 'pv-rect'
            };

            rectFeatures.push(rf);

            // Sélection au clic
            google.maps.event.addListener(polygon, 'click', () => {
                selectRect(rf.id);
            });

            // Mise à jour des coordonnées et azimut depuis l'état actuel du polygone
            const updateFromPoly = () => {
                const path = polygon.getPath();
                rf.coords = [];
                for (let i = 0; i < path.getLength(); i++) {
                    rf.coords.push(path.getAt(i));
                }
                // Recalcul de l'azimut si on a au moins 2 points
                if (rf.coords.length >= 2) {
                    rf.azimuth = calculatePVAzimuth(rf.coords[0], rf.coords[1]);
                }
                updatePvTable();
            };

            google.maps.event.addListener(polygon, 'dragend', updateFromPoly);

            // [B] Flag anti-récursion pour constrainRectEdit (local à chaque rectangle)
            let _constraintActive = false;

            // [B] set_at: appliquer la contrainte rectangulaire puis mettre à jour
            google.maps.event.addListener(polygon.getPath(), 'set_at', (movedIdx) => {
                if (_constraintActive) return; // éviter la récursion des setAt internes
                _constraintActive = true;
                constrainRectEdit(polygon.getPath(), movedIdx);
                _constraintActive = false;
                updateFromPoly();
            });

            // [B] insert_at: bloquer les points milieux — annuler immédiatement tout nouveau point
            google.maps.event.addListener(polygon.getPath(), 'insert_at', (index) => {
                polygon.getPath().removeAt(index);
                // Pas de updateFromPoly nécessaire (les 4 coins n'ont pas changé)
            });

            selectRect(rf.id);
            updatePvTable();
            return rf;
        }

        function selectRect(rectId) {
            // Deselect TerraDraw
            try { draw.setMode('select'); } catch (e) { }
            selectedTerraDrawId = null;

            // Highlight selected rect
            rectFeatures.forEach(rf => {
                if (rf.id === rectId) {
                    rf.polygon.setOptions({
                        strokeColor: '#00E5FF',
                        strokeWeight: 3
                    });
                    selectedTerraDrawId = rf.id; // On réutilise la même variable pour la sélection
                } else {
                    rf.polygon.setOptions({
                        strokeColor: '#FF9800',
                        strokeWeight: 2
                    });
                }
            });
            updatePvTable();
        }

        function deleteRect(rectId) {
            const idx = rectFeatures.findIndex(rf => rf.id === rectId);
            if (idx === -1) return;
            rectFeatures[idx].polygon.setMap(null);
            rectFeatures.splice(idx, 1);
            if (hiddenPanels[rectId]) delete hiddenPanels[rectId];
            if (initialMaxPanelsMap[rectId]) delete initialMaxPanelsMap[rectId];
            if (featureMarkers[rectId]) {
                featureMarkers[rectId].setMap(null);
                delete featureMarkers[rectId];
            }
            if (selectedTerraDrawId === rectId) selectedTerraDrawId = null;
            updatePvTable();
        }

        function getRectById(id) {
            return rectFeatures.find(rf => rf.id === id);
        }

        function isRectSelected() {
            return selectedTerraDrawId && getRectById(selectedTerraDrawId);
        }

        // ─────────────────────────────────────────────────────────────────────

        function setupEvents() {
            document.getElementById('draw-pv-rect').onclick = () => {
                pvDrawingMode = true; pvPoints = [];
                try { draw.setMode('select'); } catch (e) { }
                map.setOptions({ draggable: false });
                document.getElementById('dilatation-container').style.display = 'block';
                // Désactiver l'édition des rectangles existants pendant le dessin
                rectFeatures.forEach(rf => {
                    rf.polygon.setOptions({ editable: false, draggable: false });
                });
                startRectDrawing();
            };

            document.getElementById('draw-pv-poly').onclick = () => {
                pvDrawingMode = false;
                pvPoints = [];
                stopRectDrawing();
                if (tempPvLine) { tempPvLine.setMap(null); tempPvLine = null; }
                if (tempPvPoly) { tempPvPoly.setMap(null); tempPvPoly = null; }

                draw.setMode('pv-poly');
                map.setOptions({ draggableCursor: 'crosshair', draggable: false });
                document.getElementById('dilatation-container').style.display = 'none';
            };

            document.getElementById('btn-rotate').onclick = rotateSelectedFeature;

            // [C] Basculer le sens du pointeur d'azimut
            document.getElementById('btn-azimuth-flip').onclick = () => {
                azimuthPointerReversed = !azimuthPointerReversed;
                const flipBtn = document.getElementById('btn-azimuth-flip');
                if (azimuthPointerReversed) {
                    flipBtn.classList.remove('btn-neutral');
                    flipBtn.classList.add('btn-primary');
                    flipBtn.title = 'Pointeur azimut: vers la source solaire (cliquer pour revenir à l\'orientation panneau)';
                } else {
                    flipBtn.classList.remove('btn-primary');
                    flipBtn.classList.add('btn-neutral');
                    flipBtn.title = 'Pointeur azimut: vers l\'orientation panneau (cliquer pour inverser)';
                }
                updatePvTable();
            };

            document.getElementById('btn-edit-panels').onclick = () => {
                manualEditMode = !manualEditMode;
                const btn = document.getElementById('btn-edit-panels');
                if (manualEditMode) {
                    btn.classList.remove('btn-neutral');
                    btn.classList.add('btn-primary');
                    document.body.classList.add('manual-edit-active');
                    map.setOptions({ draggableCursor: 'cell' });
                } else {
                    btn.classList.remove('btn-primary');
                    btn.classList.add('btn-neutral');
                    document.body.classList.remove('manual-edit-active');
                    map.setOptions({ draggableCursor: null });
                }
                updatePvTable();
            };

            document.getElementById('btn-reset-panels').onclick = () => {
                if (selectedTerraDrawId) {
                    if (hiddenPanels[selectedTerraDrawId]) {
                        hiddenPanels[selectedTerraDrawId].clear();
                        updatePvTable();
                    }
                } else {
                    alert("Veuillez d'abord sélectionner une zone pour rétablir ses panneaux.");
                }
            };

            document.getElementById('pv-table').addEventListener('change', (e) => {
                if (e.target.classList.contains('azimuth-input')) {
                    const id = e.target.getAttribute('data-id');
                    const newAzimuth = parseFloat(e.target.value) || 0;

                    // Vérifier si c'est un rectangle natif
                    const rf = getRectById(id);
                    if (rf) {
                        const oldAzimuth = parseFloat(rf.azimuth || 0);
                        const angleDiff = newAzimuth - oldAzimuth;

                        if (initialMaxPanelsMap[id] === undefined) {
                            initialMaxPanelsMap[id] = _computeRectPanelCount(rf);
                        }

                        // Rotation du rectangle
                        const bounds = new google.maps.LatLngBounds();
                        rf.coords.forEach(c => bounds.extend(c));
                        const centroid = bounds.getCenter();

                        const newCoords = rf.coords.map(c => {
                            const dist = google.maps.geometry.spherical.computeDistanceBetween(centroid, c);
                            const heading = google.maps.geometry.spherical.computeHeading(centroid, c);
                            return google.maps.geometry.spherical.computeOffset(centroid, dist, heading + angleDiff);
                        });

                        rf.coords = newCoords;
                        rf.azimuth = newAzimuth.toFixed(1);
                        rf.polygon.setPaths(newCoords);
                        updatePvTable();
                        return;
                    }

                    // Sinon c'est un polygone TerraDraw
                    const snapshot = draw.getSnapshot();
                    const feature = snapshot.find(f => f.id === id);
                    if (!feature) return;

                    const oldAzimuth = parseFloat(feature.properties.azimuth || 0);
                    const angleDiff = newAzimuth - oldAzimuth;

                    if (initialMaxPanelsMap[id] === undefined) {
                        const curCount = _computePanelCount(feature);
                        initialMaxPanelsMap[id] = curCount;
                    }

                    const newFeature = {
                        id: feature.id,
                        type: 'Feature',
                        geometry: feature.geometry,
                        properties: { ...feature.properties, azimuth: newAzimuth.toFixed(1) }
                    };

                    draw.removeFeatures([id]);
                    draw.addFeatures([newFeature]);
                    if (selectedTerraDrawId === id) selectedTerraDrawId = id;
                    updatePvTable();
                }
            });

            window.addEventListener('keydown', (e) => {
                if ((e.key === "Delete" || e.key === "Backspace") &&
                    document.activeElement.tagName !== 'INPUT' &&
                    document.activeElement.tagName !== 'TEXTAREA') {

                    if (selectedTerraDrawId) {
                        // Vérifier si c'est un rectangle natif
                        const rf = getRectById(selectedTerraDrawId);
                        if (rf) {
                            deleteRect(selectedTerraDrawId);
                        } else {
                            // C'est un polygone TerraDraw
                            const idToDelete = selectedTerraDrawId;
                            selectedTerraDrawId = null;
                            try { draw.removeFeatures([idToDelete]); } catch (err) { }
                            if (hiddenPanels[idToDelete]) delete hiddenPanels[idToDelete];
                            if (initialMaxPanelsMap[idToDelete]) delete initialMaxPanelsMap[idToDelete];
                            if (featureMarkers[idToDelete]) {
                                featureMarkers[idToDelete].setMap(null);
                                delete featureMarkers[idToDelete];
                            }
                        }
                        updatePvTable();
                    }
                }
                if (e.key === "Escape") {
                    if (manualEditMode) {
                        manualEditMode = false;
                        const editBtn = document.getElementById('btn-edit-panels');
                        editBtn.classList.remove('btn-primary');
                        editBtn.classList.add('btn-neutral');
                        map.setOptions({ draggableCursor: null });
                        updatePvTable();
                    }
                    if (selectedTerraDrawId) {
                        selectedTerraDrawId = null;
                        rectFeatures.forEach(rf => {
                            rf.polygon.setOptions({ strokeColor: '#FF9800', strokeWeight: 2 });
                        });
                    }
                    try { draw.setMode('select'); } catch (err) { }
                    map.setOptions({ draggableCursor: null, draggable: true });
                    if (pvDrawingMode) {
                        pvDrawingMode = false; pvPoints = [];
                        stopRectDrawing();
                        if (tempPvLine) { tempPvLine.setMap(null); tempPvLine = null; }
                        if (tempPvPoly) { tempPvPoly.setMap(null); tempPvPoly = null; }
                        // Réactiver l'édition des rectangles
                        rectFeatures.forEach(rf => {
                            rf.polygon.setOptions({ editable: true, draggable: true });
                        });
                    }
                }
            });

            // Clic sur la carte pour désélectionner les rectangles
            map.addListener('click', () => {
                if (!pvDrawingMode && !manualEditMode) {
                    rectFeatures.forEach(rf => {
                        rf.polygon.setOptions({ strokeColor: '#FF9800', strokeWeight: 2 });
                    });
                    // Ne pas effacer selectedTerraDrawId si c'est un polygone TD
                    if (isRectSelected()) {
                        selectedTerraDrawId = null;
                    }
                }
            });

            ['panel-len', 'panel-wid', 'spacing-x', 'spacing-y', 'panel-power', 'margin-x', 'margin-y', 'distance-bordure', 'dilatation-width', 'dilatation-max-length']
                .forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.addEventListener('change', () => {
                        updateStateVariables();
                        updatePvTable();
                    });
                });

            document.getElementById('btn-portrait').onclick = () => { pvOrientation = 'portrait'; updateOrientationUI(); updatePvTable(); };
            document.getElementById('btn-landscape').onclick = () => { pvOrientation = 'landscape'; updateOrientationUI(); updatePvTable(); };

            document.getElementById('btn-shed-no').onclick = () => {
                document.getElementById('btn-shed-no').className = 'btn-primary';
                document.getElementById('btn-shed-yes').className = 'btn-neutral';
                document.getElementById('shed-settings').style.display = 'none';
            };
            document.getElementById('btn-shed-yes').onclick = () => {
                document.getElementById('btn-shed-yes').className = 'btn-primary';
                document.getElementById('btn-shed-no').className = 'btn-neutral';
                document.getElementById('shed-settings').style.display = 'block';
            };

            document.querySelectorAll('.panel-color-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    panelFillColor = btn.getAttribute('data-color');
                    document.querySelectorAll('.panel-color-btn').forEach(b => b.style.border = '3px solid transparent');
                    btn.style.border = '3px solid #333';
                    debouncedDrawPanels();
                });
            });

            updateStateVariables();
        }

        function updateStateVariables() {
            marginX = parseFloat(document.getElementById('margin-x').value) || 0;
            marginY = parseFloat(document.getElementById('margin-y').value) || 0;
            borderDistance = parseFloat(document.getElementById('distance-bordure').value) || 0;
            dilatationWidth = parseFloat(document.getElementById('dilatation-width').value) || 0;
            dilatationMaxLength = parseFloat(document.getElementById('dilatation-max-length').value) || 0;
        }

        function calculatePVAzimuth(p1, p2) {
            let heading = google.maps.geometry.spherical.computeHeading(p1, p2);
            let pvAz = heading - 180;
            if (pvAz <= -180) pvAz += 360;
            return pvAz.toFixed(1);
        }

        // ─── Overlay DOM pour le dessin 3-points ────────────────────────────

        function clientXYtoLatLng(clientX, clientY) {
            const mapDiv = document.getElementById('map');
            const rect = mapDiv.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            if (mapOverlayProjection) {
                return mapOverlayProjection.fromContainerPixelToLatLng(new google.maps.Point(x, y));
            }
            const proj = map.getProjection();
            const bounds = map.getBounds();
            if (!proj || !bounds) return null;
            const nw = proj.fromLatLngToPoint(
                new google.maps.LatLng(bounds.getNorthEast().lat(), bounds.getSouthWest().lng())
            );
            const scale = Math.pow(2, map.getZoom());
            return proj.fromPointToLatLng(new google.maps.Point(nw.x + x / scale, nw.y + y / scale));
        }

        function startRectDrawing() {
            stopRectDrawing();
            rectOverlayDiv = document.createElement('div');
            rectOverlayDiv.style.cssText = [
                'position:absolute', 'top:0', 'left:0',
                'width:100%', 'height:100%',
                'cursor:crosshair',
                'pointer-events:all',
                'z-index:999'
            ].join(';');

            rectOverlayDiv.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const latLng = clientXYtoLatLng(e.clientX, e.clientY);
                if (latLng) handleMapClick({ latLng });
            });

            rectOverlayDiv.addEventListener('mousemove', (e) => {
                const latLng = clientXYtoLatLng(e.clientX, e.clientY);
                if (latLng) handleMapMouseMove({ latLng });
            });

            document.getElementById('map').appendChild(rectOverlayDiv);
        }

        function stopRectDrawing() {
            if (rectOverlayDiv) {
                rectOverlayDiv.remove();
                rectOverlayDiv = null;
            }
        }

        // ─── Dessin 3-points du rectangle ───────────────────────────────────

        function handleMapClick(e) {
            if (!pvDrawingMode) return;
            if (pvPoints.length > 0 && google.maps.geometry.spherical.computeDistanceBetween(pvPoints[pvPoints.length - 1], e.latLng) < 0.1) return;

            pvPoints.push(e.latLng);

            if (pvPoints.length === 1) {
                tempPvLine = new google.maps.Polyline({
                    map: map,
                    path: [e.latLng, e.latLng],
                    strokeColor: '#FF9800',
                    strokeWeight: 2,
                    zIndex: 10
                });
            } else if (pvPoints.length === 2) {
                tempPvLine.setPath([pvPoints[0], pvPoints[1]]);
                const initHeading = google.maps.geometry.spherical.computeHeading(pvPoints[0], pvPoints[1]);
                const initP3 = google.maps.geometry.spherical.computeOffset(pvPoints[1], 1, initHeading + 90);
                const initRect = calculateRectPoints(pvPoints[0], pvPoints[1], initP3);
                tempPvPoly = new google.maps.Polygon({
                    map: map,
                    paths: initRect,
                    fillColor: '#FFC107',
                    strokeColor: '#FF9800',
                    fillOpacity: 0.35,
                    clickable: false,
                    zIndex: 10
                });
            } else if (pvPoints.length === 3) {
                // ── Calcul final du rectangle ──
                const polyPoints = calculateRectPoints(pvPoints[0], pvPoints[1], e.latLng);
                const azimuth = calculatePVAzimuth(polyPoints[0], polyPoints[1]);

                // Nettoyage des helpers de dessin
                pvDrawingMode = false;
                pvPoints = [];
                stopRectDrawing();
                if (tempPvLine) { tempPvLine.setMap(null); tempPvLine = null; }
                if (tempPvPoly) { tempPvPoly.setMap(null); tempPvPoly = null; }
                map.setOptions({ draggableCursor: null, draggable: true });

                // Réactiver l'édition des rectangles existants
                rectFeatures.forEach(rf => {
                    rf.polygon.setOptions({ editable: true, draggable: true });
                });

                // ── Créer le rectangle comme polygone Google Maps natif ──
                createRectFeature(polyPoints, azimuth);
            }
        }

        function handleMapMouseMove(e) {
            if (pvDrawingMode && pvPoints.length === 1) {
                tempPvLine.setPath([pvPoints[0], e.latLng]);
            } else if (pvDrawingMode && pvPoints.length === 2) {
                const polyPoints = calculateRectPoints(pvPoints[0], pvPoints[1], e.latLng);
                if (tempPvPoly) tempPvPoly.setPaths(polyPoints);
            }
        }

        function calculateRectPoints(p1, p2, p3) {
            const heading = google.maps.geometry.spherical.computeHeading(p1, p2);
            const distWidth = google.maps.geometry.spherical.computeDistanceBetween(p2, p3);
            const headingWidth = google.maps.geometry.spherical.computeHeading(p2, p3);
            const angleDiff = headingWidth - heading;
            const turn = (angleDiff > 0 && angleDiff < 180) || angleDiff < -180 ? 90 : -90;

            const w = Math.abs(distWidth * Math.sin(angleDiff * Math.PI / 180));
            const p3_new = google.maps.geometry.spherical.computeOffset(p2, w, heading + turn);
            const p4_new = google.maps.geometry.spherical.computeOffset(p1, w, heading + turn);
            return [p1, p2, p3_new, p4_new];
        }

        // ─── Rotation ───────────────────────────────────────────────────────

        function rotateSelectedFeature() {
            if (!selectedTerraDrawId) return;

            // Vérifier si c'est un rectangle natif
            const rf = getRectById(selectedTerraDrawId);
            if (rf) {
                const bounds = new google.maps.LatLngBounds();
                rf.coords.forEach(c => bounds.extend(c));
                const centroid = bounds.getCenter();

                const newCoords = rf.coords.map(c => {
                    const dist = google.maps.geometry.spherical.computeDistanceBetween(centroid, c);
                    const heading = google.maps.geometry.spherical.computeHeading(centroid, c);
                    return google.maps.geometry.spherical.computeOffset(centroid, dist, heading + 90);
                });

                let newAz = (parseFloat(rf.azimuth || 0) + 90) % 360;
                if (newAz > 180) newAz -= 360;

                rf.coords = newCoords;
                rf.azimuth = newAz.toFixed(1);
                rf.polygon.setPaths(newCoords);
                updatePvTable();
                return;
            }

            // Sinon polygone TerraDraw
            const snapshot = draw.getSnapshot();
            const feature = snapshot.find(f => f.id === selectedTerraDrawId);
            if (!feature || feature.geometry.type !== 'Polygon') return;

            const coords = feature.geometry.coordinates[0];
            const paths = coords.map(c => new google.maps.LatLng(c[1], c[0]));

            const bounds = new google.maps.LatLngBounds();
            paths.forEach(p => bounds.extend(p));
            const centroid = bounds.getCenter();

            const newCoords = coords.map(c => {
                const p = new google.maps.LatLng(c[1], c[0]);
                const dist = google.maps.geometry.spherical.computeDistanceBetween(centroid, p);
                const heading = google.maps.geometry.spherical.computeHeading(centroid, p);
                const newP = google.maps.geometry.spherical.computeOffset(centroid, dist, heading + 90);
                return [newP.lng(), newP.lat()];
            });

            let newAz = (parseFloat(feature.properties.azimuth || 0) + 90) % 360;
            if (newAz > 180) newAz -= 360;

            const newFeature = {
                id: feature.id,
                type: 'Feature',
                geometry: { ...feature.geometry, coordinates: [newCoords] },
                properties: { ...feature.properties, azimuth: newAz.toFixed(1) }
            };

            draw.removeFeatures([selectedTerraDrawId]);
            draw.addFeatures([newFeature]);
            selectedTerraDrawId = feature.id;
            updatePvTable();
        }

        function getPathFromGeoJson(coords) {
            return coords.map(ring => ring.map(p => new google.maps.LatLng(p[1], p[0])));
        }

        // Calcule le nombre brut de panneaux pour un polygone TerraDraw
        function _computePanelCount(feature) {
            if (!feature || feature.geometry.type !== 'Polygon') return 0;
            const pLen = parseFloat(document.getElementById('panel-len').value) || 1762;
            const pWid = parseFloat(document.getElementById('panel-wid').value) || 1134;
            const sX = parseFloat(document.getElementById('spacing-x').value) || 20;
            const sY = parseFloat(document.getElementById('spacing-y').value) || 20;
            const dimX = (pvOrientation === 'portrait') ? pWid : pLen;
            const dimY = (pvOrientation === 'portrait') ? pLen : pWid;
            const W = dimX / 1000, L = dimY / 1000;
            const sx = sX / 1000, sy = sY / 1000;
            const path = getPathFromGeoJson(feature.geometry.coordinates)[0];

            if (feature.properties.mode === 'pv-poly') {
                const area = google.maps.geometry.spherical.computeArea(path);
                let perim = 0;
                for (let i = 0; i < path.length - 1; i++)
                    perim += google.maps.geometry.spherical.computeDistanceBetween(path[i], path[i + 1]);
                const areaEff = Math.max(0, area - perim * (borderDistance / 1000 + (marginX + marginY) / 2000));
                return Math.floor(areaEff / ((W + sx) * (L + sy)));
            }
            return 0;
        }

        // Calcule le nombre brut de panneaux pour un rectangle natif
        function _computeRectPanelCount(rf) {
            const pLen = parseFloat(document.getElementById('panel-len').value) || 1762;
            const pWid = parseFloat(document.getElementById('panel-wid').value) || 1134;
            const sX = parseFloat(document.getElementById('spacing-x').value) || 20;
            const sY = parseFloat(document.getElementById('spacing-y').value) || 20;
            const dimX = (pvOrientation === 'portrait') ? pWid : pLen;
            const dimY = (pvOrientation === 'portrait') ? pLen : pWid;
            const W = dimX / 1000, L = dimY / 1000;
            const sx = sX / 1000, sy = sY / 1000;

            if (rf.coords.length < 4) return 0;

            const D1 = google.maps.geometry.spherical.computeDistanceBetween(rf.coords[0], rf.coords[1]);
            const D2 = google.maps.geometry.spherical.computeDistanceBetween(rf.coords[1], rf.coords[2]);
            let effD1 = D1 - 2 * (marginX / 1000 + borderDistance / 1000);
            let effD2 = D2 - 2 * (marginY / 1000 + borderDistance / 1000);
            if (effD1 <= 0 || effD2 <= 0) return 0;
            if (dilatationMaxLength > 0 && effD1 > dilatationMaxLength) {
                effD1 -= Math.floor(effD1 / dilatationMaxLength) * (dilatationWidth / 1000);
            }
            return Math.max(0, Math.floor((effD1 + sx) / (W + sx)) * Math.floor((effD2 + sy) / (L + sy)));
        }

        // ─── Rendu graphique des panneaux ───────────────────────────────────

        function clearPanels() {
            panelPolygons.forEach(p => p.setMap(null));
            panelPolygons = [];
        }

        function debouncedDrawPanels() {
            clearTimeout(drawPanelsTimeout);
            drawPanelsTimeout = setTimeout(drawPanels, 200);
        }

        function drawPanels() {
            clearPanels();

            const pLen = parseFloat(document.getElementById('panel-len').value) || 1762;
            const pWid = parseFloat(document.getElementById('panel-wid').value) || 1134;
            const sX = parseFloat(document.getElementById('spacing-x').value) || 20;
            const sY = parseFloat(document.getElementById('spacing-y').value) || 20;

            const dimX = (pvOrientation === 'portrait') ? pWid : pLen;
            const dimY = (pvOrientation === 'portrait') ? pLen : pWid;
            const W = dimX / 1000;
            const L = dimY / 1000;
            const sx = sX / 1000;
            const sy = sY / 1000;

            // Dessiner les panneaux pour les rectangles natifs
            rectFeatures.forEach(rf => {
                if (rf.coords.length >= 4) {
                    drawPanelsInRect(rf.coords, rf, W, L, sx, sy);
                }
            });

            // Dessiner les panneaux pour les polygones TerraDraw
            if (draw) {
                const snapshot = draw.getSnapshot();
                snapshot.filter(f => f.properties.mode === 'pv-poly')
                    .forEach(feature => {
                        if (feature.geometry.type !== 'Polygon') return;
                        const path = getPathFromGeoJson(feature.geometry.coordinates)[0];
                        if (path.length >= 3) {
                            drawPanelsInPoly(path, feature, W, L, sx, sy);
                        }
                    });
            }
        }

        function drawPanelsInRect(path, featureOrRf, W, L, sx, sy) {
            // featureOrRf peut être un rectFeature (avec .id et .coords) 
            const featureId = featureOrRf.id;
            const p0 = path[0], p1 = path[1], p3 = path[3];

            const headingX = google.maps.geometry.spherical.computeHeading(p0, p1);
            const headingY = google.maps.geometry.spherical.computeHeading(p0, p3);

            const D1 = google.maps.geometry.spherical.computeDistanceBetween(p0, p1);
            const D2 = google.maps.geometry.spherical.computeDistanceBetween(p0, p3);

            const offsetStart = borderDistance / 1000;
            let effD1 = D1 - 2 * (marginX / 1000 + offsetStart);
            let effD2 = D2 - 2 * (marginY / 1000 + offsetStart);

            if (dilatationMaxLength > 0 && effD1 > dilatationMaxLength) {
                const joints = Math.floor(effD1 / dilatationMaxLength);
                effD1 -= joints * (dilatationWidth / 1000);
            }

            if (effD1 <= 0 || effD2 <= 0) return;

            const nx = Math.floor((effD1 + sx) / (W + sx));
            const ny = Math.floor((effD2 + sy) / (L + sy));

            // [A] Centrage automatique: répartir l'espace résiduel de chaque côté
            const totalPanelW = nx * W + (nx - 1) * sx;
            const totalPanelH = ny * L + (ny - 1) * sy;
            const centreOffX  = Math.max(0, (effD1 - totalPanelW) / 2);
            const centreOffY  = Math.max(0, (effD2 - totalPanelH) / 2);
            const startX = marginX / 1000 + offsetStart + centreOffX;
            const startY = marginY / 1000 + offsetStart + centreOffY;

            for (let ix = 0; ix < nx; ix++) {
                for (let iy = 0; iy < ny; iy++) {
                    const dx = startX + ix * (W + sx);
                    const dy = startY + iy * (L + sy);

                    const pOrig = google.maps.geometry.spherical.computeOffset(
                        google.maps.geometry.spherical.computeOffset(p0, dx, headingX),
                        dy, headingY
                    );

                    const c1 = google.maps.geometry.spherical.computeOffset(pOrig, W, headingX);
                    const c2 = google.maps.geometry.spherical.computeOffset(c1, L, headingY);
                    const c3 = google.maps.geometry.spherical.computeOffset(pOrig, L, headingY);

                    const panelKey = `${ix}_${iy}`;
                    const isHidden = hiddenPanels[featureId] && hiddenPanels[featureId].has(panelKey);
                    if (!manualEditMode && isHidden) continue;

                    const poly = new google.maps.Polygon({
                        map: map,
                        paths: [pOrig, c1, c2, c3],
                        fillColor: isHidden ? '#757575' : panelFillColor,
                        fillOpacity: isHidden ? 0.2 : 0.8,
                        strokeColor: isHidden ? '#424242' : (PANEL_COLOR_STROKE[panelFillColor] || '#000'),
                        strokeWeight: 0.5,
                        zIndex: 5,
                        clickable: manualEditMode
                    });

                    if (manualEditMode) {
                        const _key = panelKey, _fid = featureId, _hidden = isHidden;
                        google.maps.event.addListener(poly, 'click', () => {
                            if (_hidden) {
                                hiddenPanels[_fid].delete(_key);
                                updatePvTable();
                            }
                        });
                        google.maps.event.addListener(poly, 'rightclick', () => {
                            if (!_hidden) {
                                if (!hiddenPanels[_fid]) hiddenPanels[_fid] = new Set();
                                hiddenPanels[_fid].add(_key);
                                updatePvTable();
                            }
                        });
                    }
                    panelPolygons.push(poly);
                }
            }
        }

        function drawPanelsInPoly(path, feature, W, L, sx, sy) {
            const az = parseFloat(feature.properties.azimuth || 0);
            const headingX = ((az + 180) % 360 + 360) % 360;
            const headingY = (headingX + 90) % 360;

            const bounds = new google.maps.LatLngBounds();
            path.forEach(p => bounds.extend(p));
            const center = bounds.getCenter();
            let maxDist = 0;
            path.forEach(p => {
                const d = google.maps.geometry.spherical.computeDistanceBetween(center, p);
                if (d > maxDist) maxDist = d;
            });
            maxDist += Math.max(W, L);

            const gmPoly = new google.maps.Polygon({ paths: path });
            const border = borderDistance / 1000;
            const mX = marginX / 1000;
            const mY = marginY / 1000;

            const numX = Math.ceil(2 * maxDist / (W + sx)) + 1;
            const numY = Math.ceil(2 * maxDist / (L + sy)) + 1;
            const MAX_PANELS = 600;
            let count = 0;

            // [A] Centrage automatique: la grille est symétrique par rapport au centre
            // du polygone — le nœud central (ix=halfNx, iy=halfNy) est positionné sur center.
            const halfNx = Math.floor(numX / 2);
            const halfNy = Math.floor(numY / 2);

            for (let ix = 0; ix < numX && count < MAX_PANELS; ix++) {
                for (let iy = 0; iy < numY && count < MAX_PANELS; iy++) {
                    const ox = (ix - halfNx) * (W + sx);
                    const oy = (iy - halfNy) * (L + sy);

                    const absOX = Math.abs(ox), hdgX = ox >= 0 ? headingX : (headingX + 180) % 360;
                    const absOY = Math.abs(oy), hdgY = oy >= 0 ? headingY : (headingY + 180) % 360;

                    const pOrig = google.maps.geometry.spherical.computeOffset(
                        google.maps.geometry.spherical.computeOffset(center, absOX, hdgX),
                        absOY, hdgY
                    );
                    const pC1 = google.maps.geometry.spherical.computeOffset(pOrig, W, headingX);
                    const pC2 = google.maps.geometry.spherical.computeOffset(pC1, L, headingY);
                    const pC3 = google.maps.geometry.spherical.computeOffset(pOrig, L, headingY);

                    if (google.maps.geometry.poly.containsLocation(pOrig, gmPoly) &&
                        google.maps.geometry.poly.containsLocation(pC1, gmPoly) &&
                        google.maps.geometry.poly.containsLocation(pC2, gmPoly) &&
                        google.maps.geometry.poly.containsLocation(pC3, gmPoly)) {

                        const panelKey = `${ix}_${iy}`;
                        const isHidden = hiddenPanels[feature.id] && hiddenPanels[feature.id].has(panelKey);

                        if (!manualEditMode && isHidden) continue;

                        const fillColor = isHidden ? '#888888' : panelFillColor;
                        const fillOpacity = isHidden ? 0.35 : 0.75;
                        const strokeColor = isHidden ? '#555555' : (PANEL_COLOR_STROKE[panelFillColor] || '#0D47A1');

                        const panelPoly = new google.maps.Polygon({
                            map: map,
                            paths: [pOrig, pC1, pC2, pC3],
                            fillColor,
                            fillOpacity,
                            strokeColor,
                            strokeWeight: 0.5,
                            clickable: manualEditMode,
                            zIndex: 5
                        });

                        if (manualEditMode) {
                            const _key2 = panelKey, _fid2 = feature.id, _hidden2 = isHidden;
                            google.maps.event.addListener(panelPoly, 'click', () => {
                                if (_hidden2) {
                                    hiddenPanels[_fid2].delete(_key2);
                                    updatePvTable();
                                }
                            });
                            google.maps.event.addListener(panelPoly, 'rightclick', () => {
                                if (!_hidden2) {
                                    if (!hiddenPanels[_fid2]) hiddenPanels[_fid2] = new Set();
                                    hiddenPanels[_fid2].add(_key2);
                                    updatePvTable();
                                }
                            });
                        }

                        panelPolygons.push(panelPoly);
                        count++;
                    }
                }
            }
        }

        // ────────────────────────────────────────────────────────────────────

        function updateOrientationUI() {
            const pBtn = document.getElementById('btn-portrait');
            const lBtn = document.getElementById('btn-landscape');
            if (pvOrientation === 'portrait') {
                pBtn.className = 'btn-primary';
                lBtn.className = 'btn-neutral';
            } else {
                pBtn.className = 'btn-neutral';
                lBtn.className = 'btn-primary';
            }
        }

        function updatePvTable() {
            const tbody = document.querySelector('#pv-table tbody');
            if (!tbody) return;
            tbody.innerHTML = '';
            let totalArea = 0, totalPower = 0, totalCount = 0;

            const pLen = parseFloat(document.getElementById('panel-len').value) || 1762;
            const pWid = parseFloat(document.getElementById('panel-wid').value) || 1134;
            const sX = parseFloat(document.getElementById('spacing-x').value) || 20;
            const sY = parseFloat(document.getElementById('spacing-y').value) || 20;
            const uPower = parseFloat(document.getElementById('panel-power').value) || 470;

            const dimX = (pvOrientation === 'portrait') ? pWid : pLen;
            const dimY = (pvOrientation === 'portrait') ? pLen : pWid;
            const L = dimY / 1000, W = dimX / 1000, sx = sX / 1000, sy = sY / 1000;

            const activeMarkerIds = new Set();

            // ── Rectangles natifs ──
            rectFeatures.forEach((rf) => {
                if (rf.coords.length < 4) return;

                const area = google.maps.geometry.spherical.computeArea(rf.coords);

                const D1 = google.maps.geometry.spherical.computeDistanceBetween(rf.coords[0], rf.coords[1]);
                const D2 = google.maps.geometry.spherical.computeDistanceBetween(rf.coords[1], rf.coords[2]);

                let effD1 = D1 - 2 * (marginX / 1000 + borderDistance / 1000);
                let effD2 = D2 - 2 * (marginY / 1000 + borderDistance / 1000);
                let count = 0;

                if (effD1 > 0 && effD2 > 0) {
                    if (dilatationMaxLength > 0 && effD1 > dilatationMaxLength) {
                        const joints = Math.floor(effD1 / dilatationMaxLength);
                        effD1 -= joints * (dilatationWidth / 1000);
                    }
                    const nx = Math.floor((effD1 + sx) / (W + sx));
                    const ny = Math.floor((effD2 + sy) / (L + sy));
                    count = Math.max(0, nx * ny);
                }

                if (initialMaxPanelsMap[rf.id] !== undefined) {
                    count = Math.min(count, initialMaxPanelsMap[rf.id]);
                }
                const hiddenCount = hiddenPanels[rf.id] ? hiddenPanels[rf.id].size : 0;
                count = Math.max(0, count - hiddenCount);

                const power = (count * uPower) / 1000;
                totalArea += area; totalPower += power; totalCount += count;
                
                // Manage Marker & Direction Indicator
                activeMarkerIds.add(rf.id);
                const bounds = new google.maps.LatLngBounds();
                rf.coords.forEach(c => bounds.extend(c));
                const centroid = bounds.getCenter();
                // [C] Sens du pointeur: orientation panneau (défaut) ou source solaire (inversé)
                const _rawAzRect = parseFloat(rf.azimuth || 0);
                const mapHeading = azimuthPointerReversed
                    ? ((_rawAzRect % 360 + 360) % 360)         // flèche vers source solaire
                    : ((_rawAzRect + 180 + 360) % 360);        // flèche vers orientation panneau
                
                if (!featureMarkers[rf.id]) {
                    featureMarkers[rf.id] = new google.maps.Marker({
                        map: map, position: centroid, zIndex: 100,
                        icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: '#fff', strokeWeight: 1, fillColor: '#d32f2f', fillOpacity: 1, rotation: mapHeading },
                        label: { text: rf.name, color: '#fff', fontWeight: 'bold', fontSize: '11px', className: 'pv-marker-label' }
                    });
                } else {
                    featureMarkers[rf.id].setPosition(centroid);
                    const icon = featureMarkers[rf.id].getIcon();
                    icon.rotation = mapHeading;
                    featureMarkers[rf.id].setIcon(icon);
                    const label = featureMarkers[rf.id].getLabel();
                    label.text = rf.name;
                    featureMarkers[rf.id].setLabel(label);
                }

                tbody.innerHTML += `<tr>
                    <td style="padding:4px;">${rf.name}</td>
                    <td style="padding:4px;">${area.toFixed(2)}</td>
                    <td style="padding:4px;">${power.toFixed(2)}</td>
                    <td style="padding:4px;">${count}</td>
                    <td style="padding:4px;"><input type="number" step="0.1" value="${rf.azimuth || 0}" style="width:65px;" data-id="${rf.id}" class="azimuth-input"></td>
                </tr>`;
            });

            // ── Polygones TerraDraw ──
            if (draw) {
                const snapshot = draw.getSnapshot();
                const pvFeatures = snapshot.filter(f => f.properties.mode === 'pv-poly');

                pvFeatures.forEach((feature) => {
                    if (feature.geometry.type !== 'Polygon') return;

                    const path = getPathFromGeoJson(feature.geometry.coordinates)[0];
                    const area = google.maps.geometry.spherical.computeArea(path);
                    let count = 0;

                    let perim = 0;
                    for (let i = 0; i < path.length - 1; i++) perim += google.maps.geometry.spherical.computeDistanceBetween(path[i], path[i + 1]);
                    const areaEff = Math.max(0, area - perim * (borderDistance / 1000 + (marginX + marginY) / 2000));
                    count = Math.floor(areaEff / ((W + sx) * (L + sy)));

                    if (initialMaxPanelsMap[feature.id] !== undefined) {
                        count = Math.min(count, initialMaxPanelsMap[feature.id]);
                    }
                    const hiddenCount = hiddenPanels[feature.id] ? hiddenPanels[feature.id].size : 0;
                    count = Math.max(0, count - hiddenCount);

                    const power = (count * uPower) / 1000;
                    totalArea += area; totalPower += power; totalCount += count;
                    
                    // Manage Marker & Direction Indicator
                    activeMarkerIds.add(feature.id);
                    const bounds = new google.maps.LatLngBounds();
                    path.forEach(c => bounds.extend(c));
                    const centroid = bounds.getCenter();
                    // [C] Sens du pointeur: orientation panneau (défaut) ou source solaire (inversé)
                    const _rawAzPoly = parseFloat(feature.properties.azimuth || 0);
                    const mapHeading = azimuthPointerReversed
                        ? ((_rawAzPoly % 360 + 360) % 360)     // flèche vers source solaire
                        : ((_rawAzPoly + 180 + 360) % 360);    // flèche vers orientation panneau
                    const pvName = feature.properties.name || "PV?";
                    
                    if (!featureMarkers[feature.id]) {
                        featureMarkers[feature.id] = new google.maps.Marker({
                            map: map, position: centroid, zIndex: 100,
                            icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: '#fff', strokeWeight: 1, fillColor: '#d32f2f', fillOpacity: 1, rotation: mapHeading },
                            label: { text: pvName, color: '#fff', fontWeight: 'bold', fontSize: '11px', className: 'pv-marker-label' }
                        });
                    } else {
                        featureMarkers[feature.id].setPosition(centroid);
                        const icon = featureMarkers[feature.id].getIcon();
                        icon.rotation = mapHeading;
                        featureMarkers[feature.id].setIcon(icon);
                        const label = featureMarkers[feature.id].getLabel();
                        label.text = pvName;
                        featureMarkers[feature.id].setLabel(label);
                    }

                    tbody.innerHTML += `<tr>
                        <td style="padding:4px;">${pvName}</td>
                        <td style="padding:4px;">${area.toFixed(2)}</td>
                        <td style="padding:4px;">${power.toFixed(2)}</td>
                        <td style="padding:4px;">${count}</td>
                        <td style="padding:4px;"><input type="number" step="0.1" value="${feature.properties.azimuth || 0}" style="width:65px;" data-id="${feature.id}" class="azimuth-input"></td>
                    </tr>`;
                });
            }

            // Clean up deleted markers
            Object.keys(featureMarkers).forEach(id => {
                if (!activeMarkerIds.has(id)) {
                    featureMarkers[id].setMap(null);
                    delete featureMarkers[id];
                }
            });

            document.getElementById('total-pv-area').innerText = totalArea.toFixed(2);
            document.getElementById('total-pv-power').innerText = totalPower.toFixed(2);
            document.getElementById('total-pv-count').innerText = totalCount;

            debouncedDrawPanels();
        }

        function makeModalDraggable() {
            const m = document.getElementById('solar-modal'), h = document.getElementById('modal-drag');
            let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
            h.onmousedown = (e) => {
                if (e.target.tagName === 'INPUT') return;
                p3 = e.clientX; p4 = e.clientY;
                document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
                document.onmousemove = (e) => { p1 = p3 - e.clientX; p2 = p4 - e.clientY; p3 = e.clientX; p4 = e.clientY; m.style.top = (m.offsetTop - p2) + "px"; m.style.left = (m.offsetLeft - p1) + "px"; };
            };
        }
