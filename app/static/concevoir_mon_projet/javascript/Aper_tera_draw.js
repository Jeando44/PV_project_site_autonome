
    <script>
        let map, draw, selectionRectangle;
        let helperPolygons = [], pvPolygons = [];
        let pvDrawingMode = false, pvPoints = [], tempPvLine = null, tempPvPoly = null;
        let selectedShape = null;
        let capturedImageData = null;
        let capturedImageWidth = 0;
        let capturedImageHeight = 0;
        let isCopying = false;
        let copyBuffer = null;
        let pvOrientation = 'portrait';
        let selectedTerraDrawId = null;

        function initMap() {
            map = new google.maps.Map(document.getElementById('map'), {
                zoom: 19,
                center: { lat: 48.8566, lng: 2.3522 },
                mapTypeId: 'satellite',
                tilt: 0
            });

            google.maps.event.addListenerOnce(map, 'idle', () => {
                setupDrawing();     // ✅ DOM Google Maps prêt
                setupEvents();
                makeModalDraggable();
                loadFromLocalStorage();
            });

            map.addListener('click', () => clearSelection());
        }

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
                        modeName: 'plus',
                        styles: { fillColor: '#4CAF50', fillOpacity: 0.45, outlineColor: '#4CAF50', outlineWidth: 2 }
                    }),
                    new terraDraw.TerraDrawPolygonMode({
                        modeName: 'minus',
                        styles: { fillColor: '#f44336', fillOpacity: 0.45, outlineColor: '#f44336', outlineWidth: 2 }
                    }),
                    new terraDraw.TerraDrawSelectMode({
                        flags: {
                            plus: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
                            minus: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } }
                        }
                    }),
                    new terraDraw.TerraDrawRenderMode({ modeName: 'render' })
                ]
            });

            draw.start();

            draw.on('finish', () => {
                updateResults();
                detectOverlaps();
                saveToLocalStorage();
                draw.setMode('select');
            });

            draw.on('change', () => {
                updateResults();
                detectOverlaps();
                saveToLocalStorage();
            });

            draw.on('select', (id) => {
                selectedTerraDrawId = id;
                clearSelection();
            });

            draw.on('deselect', () => {
                selectedTerraDrawId = null;
            });
        }

        // PV Polygons kept as Google Maps Polygons for specific business logic (3-point rect)
        function initPvPolygon(poly) {
            poly.set('type', 'pv');
            poly.setOptions({
                fillColor: '#FFC107', strokeColor: '#FF9800', fillOpacity: 0.45,
                editable: false, draggable: true, zIndex: 3
            });
            poly.labels = [];
            poly.handles = [];
            pvPolygons.push(poly);

            const updateFn = () => { updatePvTable(); updatePvLabels(poly); saveToLocalStorage(); if (selectedShape === poly) createResizeHandles(poly); };

            google.maps.event.addListener(poly, 'dragstart', () => clearResizeHandles(poly));
            google.maps.event.addListener(poly, 'dragend', updateFn);

            google.maps.event.addListener(poly, 'click', (e) => {
                if (pvDrawingMode) { handleMapClick(e); return; }
                if (isCopying) return;
                setSelection(poly);
                if (draw) draw.setMode('render'); // Deselect TerraDraw
                if (e) e.stop();
            });
            setSelection(poly);
            updatePvLabels(poly);
            updateFn();
        }

        function createResizeHandles(poly) {
            clearResizeHandles(poly);
            const path = poly.getPath();
            const points = path.getArray();
            if (points.length < 4) return;

            for (let i = 0; i < 4; i++) {
                const p1 = points[i];
                const p2 = points[(i + 1) % 4];
                const mid = google.maps.geometry.spherical.interpolate(p1, p2, 0.5);

                const handle = new google.maps.Marker({
                    position: mid,
                    map: map,
                    draggable: true,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 5,
                        fillColor: 'white',
                        fillOpacity: 1,
                        strokeWeight: 2,
                        strokeColor: '#FF9800'
                    },
                    zIndex: 100
                });

                google.maps.event.addListener(handle, 'drag', (e) => {
                    const newPos = e.latLng;
                    const p_fixed_1 = points[(i + 2) % 4];
                    const p_fixed_2 = points[(i + 3) % 4];

                    const b1 = google.maps.geometry.spherical.computeHeading(p_fixed_2, points[i]);
                    const b2 = google.maps.geometry.spherical.computeHeading(p_fixed_1, points[(i + 1) % 4]);

                    const new_p1 = getProjectedPoint(p_fixed_2, b1, newPos);
                    const new_p2 = getProjectedPoint(p_fixed_1, b2, newPos);

                    const newPath = [...points];
                    newPath[i] = new_p1;
                    newPath[(i + 1) % 4] = new_p2;
                    poly.setPaths(newPath);
                    updatePvLabels(poly);
                    updatePvTable();
                });

                google.maps.event.addListener(handle, 'dragend', () => { createResizeHandles(poly); saveToLocalStorage(); });
                poly.handles.push(handle);
            }
        }

        function clearResizeHandles(poly) {
            if (poly.handles) {
                poly.handles.forEach(h => h.setMap(null));
                poly.handles = [];
            }
        }

        function getProjectedPoint(origin, bearing, target) {
            const dist = google.maps.geometry.spherical.computeDistanceBetween(origin, target);
            const heading = google.maps.geometry.spherical.computeHeading(origin, target);
            const angle = heading - bearing;
            const projDist = dist * Math.cos(angle * Math.PI / 180);
            return google.maps.geometry.spherical.computeOffset(origin, projDist, bearing);
        }

        function updatePvLabels(poly) {
            if (poly.labels) poly.labels.forEach(l => l.setMap(null));
            poly.labels = [];
            const path = poly.getPath();
            if (path.getLength() < 3) return;
            const p0 = path.getAt(0), p1 = path.getAt(1), p2 = path.getAt(2);

            // Longueur (Bas: P0-P1)
            const len = google.maps.geometry.spherical.computeDistanceBetween(p0, p1);
            const midLen = google.maps.geometry.spherical.interpolate(p0, p1, 0.5);
            poly.labels.push(new google.maps.Marker({
                position: midLen, map: map,
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
                label: { text: len.toFixed(2) + " m", color: "black", fontWeight: "bold", className: "gm-label-outline" }
            }));

            // Largeur (Droite: P1-P2)
            const wid = google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
            const midWid = google.maps.geometry.spherical.interpolate(p1, p2, 0.5);
            poly.labels.push(new google.maps.Marker({
                position: midWid, map: map,
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
                label: { text: wid.toFixed(2) + " m", color: "black", fontWeight: "bold", className: "gm-label-outline" }
            }));
        }

        // --- RECHERCHE ADRESSE / COORDONNÉES ---
        function setupAddressSearch() {
            const input = document.getElementById('project-address');
            const autocomplete = new google.maps.places.Autocomplete(input);

            autocomplete.addListener('place_changed', () => {
                const place = autocomplete.getPlace();
                if (place.geometry) {
                    map.setCenter(place.geometry.location);
                    map.setZoom(20);
                }
            });

            input.addEventListener('change', () => {
                const val = input.value;
                const latLngMatch = val.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
                if (latLngMatch) {
                    const pos = { lat: parseFloat(latLngMatch[1]), lng: parseFloat(latLngMatch[2]) };
                    map.setCenter(pos);
                    map.setZoom(21);
                }
            });
        }

        // --- COPIER / COLLER INSTANTANÉ ---
        function startCopy() {
            if (selectedShape) {
                // Copy PV Polygon
                copyBuffer = {
                    path: selectedShape.getPath().getArray().map(p => ({ lat: p.lat(), lng: p.lng() })),
                    type: 'pv'
                };
                isCopying = true;
                document.getElementById('map').classList.add('copy-cursor');
            } else if (selectedTerraDrawId) {
                // Copy Terra Draw Feature
                const snapshot = draw.getSnapshot();
                const feature = snapshot.find(f => f.id === selectedTerraDrawId);
                if (feature) {
                    copyBuffer = {
                        feature: feature,
                        type: 'terra'
                    };
                    isCopying = true;
                    document.getElementById('map').classList.add('copy-cursor');
                }
            } else {
                alert("Sélectionnez une surface à copier.");
            }
        }

        function pastePolygon(latLng) {
            if (copyBuffer.type === 'pv') {
                const center = copyBuffer.path[0];
                const offsetLat = latLng.lat() - center.lat;
                const offsetLng = latLng.lng() - center.lng;
                const newPath = copyBuffer.path.map(p => ({
                    lat: p.lat + offsetLat,
                    lng: p.lng + offsetLng
                }));
                const newPoly = new google.maps.Polygon({ paths: newPath, map: map });
                initPvPolygon(newPoly);
            } else if (copyBuffer.type === 'terra') {
                // Clone feature and move
                const feature = copyBuffer.feature;
                // Simple centroid approx for offset
                const coords = feature.geometry.coordinates[0];
                const centerLng = coords[0][0];
                const centerLat = coords[0][1];
                const offsetLng = latLng.lng() - centerLng;
                const offsetLat = latLng.lat() - centerLat;

                const newCoords = feature.geometry.coordinates.map(ring => ring.map(c => [c[0] + offsetLng, c[1] + offsetLat]));

                const newFeature = {
                    ...feature,
                    id: undefined, // Let TerraDraw assign ID
                    geometry: { ...feature.geometry, coordinates: newCoords }
                };
                draw.addFeatures([newFeature]);
                updateResults();
                saveToLocalStorage();
            }
            isCopying = false;
            document.getElementById('map').classList.remove('copy-cursor');
        }

        // --- JSTS OVERLAPS ---
        function detectOverlaps() {
            helperPolygons.forEach(p => p.setMap(null));
            helperPolygons = [];
            const reader = new jsts.io.GeoJSONReader();
            const writer = new jsts.io.GeoJSONWriter();
            let overlapFound = false;

            const snapshot = draw.getSnapshot();
            const plusFeatures = snapshot.filter(f => f.properties.mode === 'plus');
            const minusFeatures = snapshot.filter(f => f.properties.mode === 'minus');

            try {
                const checkIntra = (list) => {
                    for (let i = 0; i < list.length; i++) {
                        for (let j = i + 1; j < list.length; j++) {
                            const g1 = reader.read(list[i].geometry);
                            const g2 = reader.read(list[j].geometry);
                            if (g1.intersects(g2)) {
                                const intersection = g1.intersection(g2);
                                if (!intersection.isEmpty()) {
                                    createHelper(writer.write(intersection), '#ffeb3b', '#fbc02d');
                                    overlapFound = true;
                                }
                            }
                        }
                    }
                };
                checkIntra(plusFeatures); checkIntra(minusFeatures);

                if (plusFeatures.length > 0 && minusFeatures.length > 0) {
                    let unionPlus = reader.read(plusFeatures[0].geometry);
                    for (let k = 1; k < plusFeatures.length; k++) unionPlus = unionPlus.union(reader.read(plusFeatures[k].geometry));
                    minusFeatures.forEach(mp => {
                        const gM = reader.read(mp.geometry);
                        if (!unionPlus.contains(gM)) {
                            const diff = gM.difference(unionPlus);
                            if (!diff.isEmpty()) createHelper(writer.write(diff), '#2196F3', '#0D47A1');
                        }
                    });
                }
            } catch (e) { }
            document.getElementById('fix-overlaps').style.display = overlapFound ? 'block' : 'none';
        }

        // --- CAPTURES ---
        async function executeCapture(isManual) {
            if (isManual && selectionRectangle) map.fitBounds(selectionRectangle.getBounds());
            if (selectionRectangle) selectionRectangle.setMap(null);

            setTimeout(async () => {
                const canvas = await html2canvas(document.getElementById('map'), { useCORS: true });
                capturedImageData = canvas.toDataURL('image/jpeg', 0.9);
                capturedImageWidth = canvas.width;
                capturedImageHeight = canvas.height;
                document.getElementById('preview-capture').src = capturedImageData;
                document.getElementById('preview-capture').style.display = 'block';
            }, 500);
        }

        // --- PDF ---
        async function exportToPDF() {
            if (!capturedImageData) return;
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');

            const offset = 45;
            pdf.setFontSize(20);
            pdf.text("Rapport d’analyse de surface solarisable – Loi APER", 105, offset, { align: 'center' });
            pdf.setFontSize(14);
            pdf.text(`Projet : ${document.getElementById('input-nom-projet').value}`, 105, offset + 12, { align: 'center' });
            pdf.text(`Adresse : ${document.getElementById('project-address').value}`, 105, offset + 20, { align: 'center' });

            pdf.setDrawColor(220);
            pdf.rect(25, offset + 35, 160, 90);
            pdf.text("[ Illustration projet ]", 105, offset + 80, { align: 'center' });


            pdf.autoTable({
                startY: offset + 160, // Ajustez la hauteur selon la taille de votre image
                head: [['Projet créé par', 'Date', 'Indice']],
                body: [[
                    document.getElementById('input-auteur').value,
                    new Date().toLocaleDateString('fr-FR'),
                    document.getElementById('input-indice').value
                ]],
                theme: 'grid',
                headStyles: {
                    fillColor: [63, 81, 181],
                    halign: 'center' // Centre le texte de l'en-tête
                },
                styles: {
                    halign: 'center', // Centre le texte du corps du tableau
                    valign: 'middle'  // Centre verticalement
                },
                columnStyles: {
                    0: { cellWidth: 60 }, // Optionnel : définir des largeurs fixes pour aider au centrage
                    1: { cellWidth: 50 },
                    2: { cellWidth: 30 }
                },
                margin: { left: 35 } // Centre le tableau lui-même sur la page (A4 fait 210mm de large)
            });

            pdf.addPage('a3', 'l');
            const m = 3;
            pdf.setLineWidth(0.5); pdf.rect(m, m, 414, 291);
            const resText = `Le parking : ${document.getElementById('surface-artif').innerText}. Exclusion : ${document.getElementById('surface-obs').innerText}. Surface réglementaire : ${document.getElementById('surface-reglementaire').innerText}. Puissance projet : ${document.getElementById('total-pv-power').innerText} kWc.`;
            pdf.setFontSize(14); pdf.text(resText, 15, 20);

            if (capturedImageWidth && capturedImageHeight) {
                const maxW = 404, maxH = 255;
                const ratio = Math.min(maxW / capturedImageWidth, maxH / capturedImageHeight);
                const newW = capturedImageWidth * ratio;
                const newH = capturedImageHeight * ratio;
                const cX = (m + 5) + (maxW - newW) / 2;
                const cY = 30 + (maxH - newH) / 2;
                pdf.addImage(capturedImageData, 'JPEG', cX, cY, newW, newH);
            } else {
                pdf.addImage(capturedImageData, 'JPEG', m + 5, 30, 404, 255);
            }

            pdf.save("Rapport_APER_v54.pdf");
        }

        // --- GESTION ÉVÉNEMENTS ---
        function setupEvents() {
            setupAddressSearch();
            document.getElementById('draw-plus').onclick = () => { draw.setMode('plus'); };
            document.getElementById('draw-minus').onclick = () => { draw.setMode('minus'); };
            document.getElementById('btn-duplicate-action').onclick = startCopy;
            document.getElementById('draw-pv-rect').onclick = () => { pvDrawingMode = true; pvPoints = []; map.setOptions({ draggableCursor: 'crosshair' }); draw.setMode('render'); };
            document.getElementById('delete-selected').onclick = deleteSelectedShape;
            // document.getElementById('toggle-plus').onclick = () => toggleVisibility('plus');
            // document.getElementById('toggle-minus').onclick = () => toggleVisibility('minus');
            document.getElementById('calculate-btn').onclick = () => { updateResults(); saveToLocalStorage(); };
            document.getElementById('btn-export-pdf').onclick = exportToPDF;
            document.getElementById('fix-overlaps').onclick = mergePolygons;

            map.addListener('click', handleMapClick);

            map.addListener('mousemove', (e) => {
                if (pvDrawingMode && pvPoints.length === 1) {
                    tempPvLine.setPath([pvPoints[0], e.latLng]);
                } else if (pvDrawingMode && pvPoints.length === 2) {
                    const polyPoints = calculateRectPoints(pvPoints[0], pvPoints[1], e.latLng);
                    if (tempPvPoly) tempPvPoly.setPaths(polyPoints);
                }
            });

            window.addEventListener('keydown', (e) => {
                if (e.key === "Delete" || e.key === "Backspace") {
                    if (selectedShape && document.activeElement.tagName !== 'INPUT') deleteSelectedShape();
                    // Terra Draw handles delete in SelectMode automatically
                }
                if (e.key === "Escape") {
                    clearSelection();
                    isCopying = false;
                    draw.setMode('select');
                    document.getElementById('map').classList.remove('copy-cursor');
                    if (selectionRectangle) selectionRectangle.setMap(null);
                    if (tempPvLine) { tempPvLine.setMap(null); tempPvLine = null; }
                    if (tempPvPoly) { tempPvPoly.setMap(null); tempPvPoly = null; }
                    pvPoints = [];
                }
            });

            document.getElementById('btn-manual-capture').onclick = () => {
                selectionRectangle = new google.maps.Rectangle({ map: map, editable: true, draggable: true, bounds: map.getBounds(), fillColor: '#2196F3', fillOpacity: 0.2 });
                const vBtn = document.createElement('button'); vBtn.innerText = "Valider la zone"; vBtn.style = "position:fixed; top:20px; left:50%; z-index:2000; padding:10px; background:#4CAF50; color:white; border-radius:5px;";
                vBtn.onclick = () => { executeCapture(true); vBtn.remove(); }; document.body.appendChild(vBtn);
            };

            document.getElementById('btn-auto-capture').onclick = () => executeCapture(false);
            ['panel-len', 'panel-wid', 'spacing-x', 'spacing-y', 'panel-power']
                .forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.addEventListener('change', updatePvTable);
                });

            document.getElementById('btn-portrait').onclick = () => { pvOrientation = 'portrait'; updateOrientationUI(); updatePvTable(); };
            document.getElementById('btn-landscape').onclick = () => { pvOrientation = 'landscape'; updateOrientationUI(); updatePvTable(); };
        }

        function handleMapClick(e) {
            if (isCopying && copyBuffer) {
                pastePolygon(e.latLng);
                return;
            }

            if (!pvDrawingMode) {
                clearSelection();
                return;
            }

            // Robustesse : ignorer les clics trop proches
            if (pvPoints.length > 0 && google.maps.geometry.spherical.computeDistanceBetween(pvPoints[pvPoints.length - 1], e.latLng) < 0.5) return;

            pvPoints.push(e.latLng);
            if (pvPoints.length === 1) {
                tempPvLine = new google.maps.Polyline({ map: map, path: [e.latLng, e.latLng], strokeColor: '#FF9800' });
            } else if (pvPoints.length === 2) {
                tempPvLine.setPath([pvPoints[0], pvPoints[1]]);
                tempPvPoly = new google.maps.Polygon({ map: map, paths: [pvPoints[0], pvPoints[1], pvPoints[1], pvPoints[0]], fillColor: '#FFC107', strokeColor: '#FF9800', fillOpacity: 0.2, clickable: false, zIndex: 10 });
            } else if (pvPoints.length === 3) {
                const polyPoints = calculateRectPoints(pvPoints[0], pvPoints[1], e.latLng);
                initPvPolygon(new google.maps.Polygon({ paths: polyPoints, map: map }));

                pvDrawingMode = false; pvPoints = [];
                if (tempPvLine) { tempPvLine.setMap(null); tempPvLine = null; }
                if (tempPvPoly) { tempPvPoly.setMap(null); tempPvPoly = null; }
                map.setOptions({ draggableCursor: null });
                draw.setMode('select');
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

        function getPathFromGeoJson(coords) {
            // GeoJSON Polygon: array of rings. First is outer.
            // Google Maps computeArea takes array of LatLng for outer loop, or array of paths for holes.
            // We map all rings.
            return coords.map(ring => ring.map(p => ({ lat: p[1], lng: p[0] })));
        }

        function updateResults() {
            if (!draw || typeof jsts === 'undefined') return; // Sécurité si draw n'est pas encore prêt
            let aP = 0, aM = 0;

            const snapshot = draw.getSnapshot();
            snapshot.forEach(f => {
                if (f.geometry.type === 'Polygon') {
                    const area = google.maps.geometry.spherical.computeArea(getPathFromGeoJson(f.geometry.coordinates));
                    if (f.properties.mode === 'plus') aP += area;
                    else if (f.properties.mode === 'minus') aM += area;
                }
            });

            const net = Math.max(0, aP - aM);
            const reg = net * (parseFloat(document.getElementById('percent-aper').value) / 100 || 0);
            const reg2 = net * (parseFloat(document.getElementById('percent-aper-2').value) / 100 || 0);
            document.getElementById('surface-artif').innerText = aP.toFixed(2) + " m²";
            document.getElementById('surface-obs').innerText = aM.toFixed(2) + " m²";
            document.getElementById('surface-reglementaire').innerText = reg.toFixed(2) + " m²";
            document.getElementById('surface-reglementaire-2').innerText = reg2.toFixed(2) + " m²";
            document.getElementById('ratio-couverture').innerText = ((reg / (parseFloat(document.getElementById('surface-parcelle').value) || 1)) * 100).toFixed(2) + " %";
        }

        function setSelection(s) { clearSelection(); selectedShape = s; s.setOptions({ strokeWeight: 5, strokeColor: '#000' }); }
        function clearSelection() { if (selectedShape) { const c = (selectedShape.get('type') === 'pv') ? '#FF9800' : ((selectedShape.get('type') === 'plus') ? '#4CAF50' : '#f44336'); selectedShape.setOptions({ strokeWeight: 2, strokeColor: c }); selectedShape = null; } }
        function setSelection(s) { clearSelection(); selectedShape = s; s.setOptions({ strokeWeight: 5, strokeColor: '#000' }); if (s.get('type') === 'pv') createResizeHandles(s); }
        function clearSelection() { if (selectedShape) { const c = (selectedShape.get('type') === 'pv') ? '#FF9800' : ((selectedShape.get('type') === 'plus') ? '#4CAF50' : '#f44336'); selectedShape.setOptions({ strokeWeight: 2, strokeColor: c }); if (selectedShape.get('type') === 'pv') clearResizeHandles(selectedShape); selectedShape = null; } }

        function deleteSelectedShape() {
            if (selectedShape) {
                selectedShape.setMap(null);
                if (selectedShape.get('type') === 'pv') {
                    if (selectedShape.labels) selectedShape.labels.forEach(l => l.setMap(null));
                    clearResizeHandles(selectedShape);
                    pvPolygons = pvPolygons.filter(p => p !== selectedShape);
                    updatePvTable();
                }
                // Plus/Minus are now handled by Terra Draw
                selectedShape = null;
                saveToLocalStorage();
            } else if (selectedTerraDrawId) {
                // Delete from Terra Draw
                // Terra Draw SelectMode handles delete via key, but we can force it by removing feature
                // However, SelectMode might hold state.
                // Simplest is to remove from store.
                // draw.removeFeatures([selectedTerraDrawId]); // Not directly exposed in all versions
                // We can use setMode('select') and let user press delete, or:
                // Re-implement delete logic if needed, but 'Delete' key works.
                // If we really want the button to work:
                const snapshot = draw.getSnapshot();
                const newFeatures = snapshot.filter(f => f.id !== selectedTerraDrawId);
                // draw.clear(); draw.addFeatures(newFeatures); // Brute force
                // Better:

                if (selectedTerraDrawId) {
                    // Méthode universelle pour supprimer une entité par son ID dans Terra Draw
                    draw.removeFeatures([selectedTerraDrawId]);
                    selectedTerraDrawId = null;
                    updateResults();
                    saveToLocalStorage();
                }
            } else {
                // Fallback
                alert("Veuillez appuyer sur la touche 'Suppr' de votre clavier pour supprimer la forme sélectionnée.");
            }
        }


        function createHelper(geojson, fill, stroke) {
            const h = new google.maps.Polygon({ paths: geojson.coordinates[0].map(c => ({ lat: c[1], lng: c[0] })), fillColor: fill, fillOpacity: 0.7, strokeColor: stroke, strokeWeight: 2, zIndex: 10, map: map, clickable: false });
            helperPolygons.push(h);
        }

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

        function saveToLocalStorage() {
            const data = {
                nom: document.getElementById('input-nom-projet').value,
                auteur: document.getElementById('input-auteur').value,
                addr: document.getElementById('project-address').value,
                orientation: pvOrientation,
                terraFeatures: draw.getSnapshot(),
                pv: pvPolygons.map(p => p.getPath().getArray().map(l => ({ lat: l.lat(), lng: l.lng() })))
            };
            localStorage.setItem('aper_expert_v55', JSON.stringify(data));
        }

        function loadFromLocalStorage() {
            const s = localStorage.getItem('aper_expert_v55');
            if (!s) return;
            const d = JSON.parse(s);
            document.getElementById('input-nom-projet').value = d.nom || "";
            document.getElementById('input-auteur').value = d.auteur || "";
            document.getElementById('project-address').value = d.addr || "";
            if (d.orientation) { pvOrientation = d.orientation; updateOrientationUI(); }

            if (d.terraFeatures) {
                draw.addFeatures(d.terraFeatures);
            } else {
                const cleanPath = (path) => {
                    const coords = path.map(p => [p.lng, p.lat]);
                    if (coords.length > 0) {
                        const first = coords[0];
                        const last = coords[coords.length - 1];
                        // Vérifie si le polygone est déjà fermé pour éviter de doubler le dernier point
                        if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
                            return coords;
                        }
                        coords.push(first);
                    }
                    return coords;
                };
                // Migration from old format
                if (d.plus) {
                    const feats = d.plus.map(path => ({
                        type: 'Feature', geometry: { type: 'Polygon', coordinates: [cleanPath(path)] },
                        properties: { mode: 'plus' }
                    }));
                    draw.addFeatures(feats);
                }
                if (d.minus) {
                    const feats = d.minus.map(path => ({
                        type: 'Feature', geometry: { type: 'Polygon', coordinates: [cleanPath(path)] },
                        properties: { mode: 'minus' }
                    }));
                    draw.addFeatures(feats);
                }
            }

            if (d.pv) d.pv.forEach(pData => {
                if (Array.isArray(pData)) {
                    initPvPolygon(new google.maps.Polygon({ paths: pData, map: map }));
                } else { // Support ancien format (bounds)
                    initPvPolygon(new google.maps.Polygon({ paths: [{ lat: pData.north, lng: pData.west }, { lat: pData.north, lng: pData.east }, { lat: pData.south, lng: pData.east }, { lat: pData.south, lng: pData.west }], map: map }));
                }
            });
            updateResults();
        }

        function updatePvTable() {
            const tbody = document.querySelector('#pv-table tbody');
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

            pvPolygons.forEach((poly, index) => {
                const path = poly.getPath();
                if (path.getLength() < 3) return;
                const p0 = path.getAt(0), p1 = path.getAt(1), p2 = path.getAt(2);

                const width = google.maps.geometry.spherical.computeDistanceBetween(p0, p1); // Longueur (P0-P1)
                const height = google.maps.geometry.spherical.computeDistanceBetween(p1, p2); // Largeur (P1-P2)

                const nx = Math.floor((width + sx) / (W + sx));
                const ny = Math.floor((height + sy) / (L + sy));
                const count = Math.max(0, nx * ny);
                const area = width * height;
                const power = (count * uPower) / 1000;

                totalArea += area; totalPower += power; totalCount += count;

                tbody.innerHTML += `<tr><td style="padding:4px;">${index + 1}</td><td style="padding:4px;">${area.toFixed(2)}</td><td style="padding:4px;">${power.toFixed(2)}</td><td style="padding:4px;">${count}</td></tr>`;
            });

            document.getElementById('total-pv-area').innerText = totalArea.toFixed(2);
            document.getElementById('total-pv-power').innerText = totalPower.toFixed(2);
            document.getElementById('total-pv-count').innerText = totalCount;
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

        function mergePolygons() {
            const reader = new jsts.io.GeoJSONReader();
            const writer = new jsts.io.GeoJSONWriter();

            const snapshot = draw.getSnapshot();
            const plusFeatures = snapshot.filter(f => f.properties.mode === 'plus');
            const minusFeatures = snapshot.filter(f => f.properties.mode === 'minus');

            const mergeList = (list, mode) => {
                if (list.length < 2) return;

                let merged = reader.read(list[0].geometry);

                for (let i = 1; i < list.length; i++) {
                    merged = merged.union(reader.read(list[i].geometry));
                }

                // Remove old features
                // draw.removeFeatures(list.map(f => f.id)); // Not always available
                // We can filter snapshot and re-add
                // For now, let's assume we can just clear and re-add everything? No.
                // We will construct the new feature list.

                const geo = writer.write(merged);
                let newFeatures = [];

                if (geo.type === "Polygon") {
                    newFeatures.push({
                        type: 'Feature', geometry: geo, properties: { mode: mode }
                    });
                }
                else if (geo.type === "MultiPolygon") {
                    geo.coordinates.forEach(coords => {
                        newFeatures.push({
                            type: 'Feature', geometry: { type: 'Polygon', coordinates: coords }, properties: { mode: mode }
                        });
                    });
                }
                return newFeatures;
            };

            const newPlus = mergeList(plusFeatures, 'plus') || plusFeatures;
            const newMinus = mergeList(minusFeatures, 'minus') || minusFeatures;

            // Rebuild store
            // Filter out old plus/minus
            const others = snapshot.filter(f => f.properties.mode !== 'plus' && f.properties.mode !== 'minus');

            // Clear and add
            // draw.clear(); // If available
            // draw.addFeatures([...others, ...newPlus, ...newMinus]);
            // Since clear() might not be exposed on instance directly in alpha, we can try to rely on overwriting or just accept that this feature might need robust ID handling.
            // Assuming we can just reload:
            draw.clear();
            draw.addFeatures([...others, ...newPlus, ...newMinus]);

            helperPolygons.forEach(p => p.setMap(null));
            helperPolygons = [];

            updateResults();
            saveToLocalStorage();
            detectOverlaps();
        }
