// Variables globales pour le modal Loi APER
let mapAper, drawingManagerAper, addressMarkerAper;
let plusPolygonsAper = [], minusPolygonsAper = [], helperPolygonsAper = [];
let selectedShapeAper = null;
let isPrecisionModeAper = false;

async function initMapAper() {
    // Récupérer les coordonnées depuis window.map ou localStorage
    let mapCenter = { lat: 48.8566, lng: 2.3522 };
    let mapZoom = 18;

    // Priorité 1: window.map
    if (window.map && typeof window.map.getCenter === 'function') {
        const center = window.map.getCenter();
        mapCenter = { lat: center.lat(), lng: center.lng() };
        mapZoom = window.map.getZoom() || 18;
        console.log('✅ Coordonnées Loi APER depuis window.map:', mapCenter);
    }
    // Priorité 2: localStorage
    else {
        try {
            const savedData = localStorage.getItem('solarProjectData');
            if (savedData) {
                const parsedData = JSON.parse(savedData);
                if (parsedData.mapCenter) mapCenter = parsedData.mapCenter;
                if (parsedData.mapZoom) mapZoom = parsedData.mapZoom;
                console.log('✅ Coordonnées Loi APER depuis localStorage:', mapCenter);
            }
        } catch (error) {
            console.warn('⚠️ Erreur chargement coordonnées:', error);
        }
    }

    mapAper = new google.maps.Map(document.getElementById('loi-aper-map'), {
        zoom: mapZoom,
        center: mapCenter,
        mapTypeId: 'satellite',
        tilt: 0,
        draggable: true,
        scrollwheel: true
    });

    addressMarkerAper = new google.maps.Marker({
        map: mapAper,
        draggable: true,
        position: mapAper.getCenter(),
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#3f51b5', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }
    });

    setupAutocompleteAper();
    setupDrawingAper();
    setupVisibilityTogglesAper();
    makeModalDraggableAper();
    setupKeyboardDeletionAper();
    loadFromLocalStorageAper();

    document.getElementById('delete-selected-aper').onclick = deleteSelectedShapeAper;
    document.getElementById('calculate-btn-aper').onclick = () => { detectOverlapsAper(); updateResultsAper(); saveToLocalStorageAper(); };
    document.getElementById('percent-aper-aper').oninput = () => { updateResultsAper(); saveToLocalStorageAper(); };
    document.getElementById('surface-parcelle-aper').oninput = () => { updateResultsAper(); saveToLocalStorageAper(); };
    document.getElementById('zoom-max-button-aper').onclick = togglePrecisionModeAper;
    document.getElementById('fix-overlaps-aper').onclick = mergeObstaclesAper;

    mapAper.addListener('click', clearSelectionAper);

    console.log('✅ Carte Loi APER initialisée');
}

function setupAutocompleteAper() {
    const input = document.getElementById('project-address-aper');
    const auto = new google.maps.places.Autocomplete(input);
    auto.addListener('place_changed', () => {
        const p = auto.getPlace();
        if (p && p.geometry) {
            mapAper.setCenter(p.geometry.location);
            addressMarkerAper.setPosition(p.geometry.location);
            updateCoordsAper(p.geometry.location);
            saveToLocalStorageAper();
        }
    });
}

function setupDrawingAper() {
    drawingManagerAper = new google.maps.drawing.DrawingManager({
        drawingControl: false,
        polygonOptions: { editable: true, draggable: true, zIndex: 1 }
    });
    drawingManagerAper.setMap(mapAper);

    document.getElementById('draw-plus-aper').onclick = () => startDrawAper('#4CAF50', 0.4, 'plus');
    document.getElementById('draw-minus-aper').onclick = () => startDrawAper('#f44336', 0.6, 'minus');

    google.maps.event.addListener(drawingManagerAper, 'polygoncomplete', (poly) => {
        const type = drawingManagerAper.get('type_custom');
        initPolygonAper(poly, type);
        drawingManagerAper.setDrawingMode(null);
        detectOverlapsAper();
        updateResultsAper();
        saveToLocalStorageAper();
    });
}

function initPolygonAper(poly, type) {
    poly.set('type', type);
    if (type === 'plus') plusPolygonsAper.push(poly);
    else minusPolygonsAper.push(poly);

    google.maps.event.addListener(poly, 'click', (e) => {
        if (e) e.stop();
        setSelectionAper(poly);
    });

    const path = poly.getPath();
    const updateActions = () => { detectOverlapsAper(); updateResultsAper(); saveToLocalStorageAper(); };

    google.maps.event.addListener(path, 'set_at', updateActions);
    google.maps.event.addListener(path, 'insert_at', updateActions);
    google.maps.event.addListener(path, 'remove_at', updateActions);
    google.maps.event.addListener(poly, 'dragend', updateActions);

    setSelectionAper(poly);
}

function startDrawAper(col, op, type) {
    drawingManagerAper.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
    drawingManagerAper.setOptions({
        polygonOptions: { fillColor: col, strokeColor: col, fillOpacity: op, editable: true, draggable: true, visible: true }
    });
    drawingManagerAper.set('type_custom', type);
}

function setSelectionAper(shape) {
    clearSelectionAper();
    selectedShapeAper = shape;
    shape.setOptions({ strokeWeight: 4, strokeColor: '#000' });
}

function clearSelectionAper() {
    if (selectedShapeAper) {
        const color = selectedShapeAper.get('type') === 'plus' ? '#4CAF50' : '#f44336';
        selectedShapeAper.setOptions({ strokeWeight: 2, strokeColor: color });
        selectedShapeAper = null;
    }
}

function deleteSelectedShapeAper() {
    if (selectedShapeAper) {
        selectedShapeAper.setMap(null);
        plusPolygonsAper = plusPolygonsAper.filter(p => p !== selectedShapeAper);
        minusPolygonsAper = minusPolygonsAper.filter(p => p !== selectedShapeAper);
        selectedShapeAper = null;
        detectOverlapsAper();
        updateResultsAper();
        saveToLocalStorageAper();
    }
}

function setupKeyboardDeletionAper() {
    window.addEventListener('keydown', (e) => {
        if ((e.key === "Delete" || e.key === "Suppr") && document.getElementById('loi-aper-modal').style.display === 'flex') {
            deleteSelectedShapeAper();
        }
    });
}

function setupVisibilityTogglesAper() {
    document.getElementById('toggle-plus-aper').onclick = function() {
        const isVisible = plusPolygonsAper.length > 0 ? !plusPolygonsAper[0].getVisible() : true;
        plusPolygonsAper.forEach(p => p.setVisible(isVisible));
        this.innerText = isVisible ? "Masquer surface (+)" : "Afficher surface (+)";
        this.style.opacity = isVisible ? "1" : "0.6";
    };
    document.getElementById('toggle-minus-aper').onclick = function() {
        const isVisible = minusPolygonsAper.length > 0 ? !minusPolygonsAper[0].getVisible() : true;
        minusPolygonsAper.forEach(p => p.setVisible(isVisible));
        helperPolygonsAper.forEach(p => p.setVisible(isVisible));
        this.innerText = isVisible ? "Masquer obstacles (-)" : "Afficher obstacles (-)";
        this.style.opacity = isVisible ? "1" : "0.6";
    };
}

function detectOverlapsAper() {
    helperPolygonsAper.forEach(p => p.setMap(null));
    helperPolygonsAper = [];
    let hasOverlap = false;

    if (typeof jsts === 'undefined') {
        console.warn('JSTS non chargé');
        return;
    }

    const reader = new jsts.io.GeoJSONReader();
    const writer = new jsts.io.GeoJSONWriter();

    try {
        // 1. Chevauchements d'obstacles (Jaune)
        if (minusPolygonsAper.length >= 2) {
            const jstsMinuses = minusPolygonsAper.map(p => reader.read(polyToGeoJSONAper(p)));
            for (let i = 0; i < jstsMinuses.length; i++) {
                for (let j = i + 1; j < jstsMinuses.length; j++) {
                    if (jstsMinuses[i].intersects(jstsMinuses[j])) {
                        const inter = jstsMinuses[i].intersection(jstsMinuses[j]);
                        if (!inter.isEmpty() && inter.getArea() > 0) {
                            createHelperAper(writer.write(inter), '#ffeb3b', '#fbc02d');
                            hasOverlap = true;
                        }
                    }
                }
            }
        }

        // 2. Hors Zone (Bleu)
        if (plusPolygonsAper.length > 0 && minusPolygonsAper.length > 0) {
            let totalPlusJsts = reader.read(polyToGeoJSONAper(plusPolygonsAper[0]));
            for (let k = 1; k < plusPolygonsAper.length; k++) {
                totalPlusJsts = totalPlusJsts.union(reader.read(polyToGeoJSONAper(plusPolygonsAper[k])));
            }

            minusPolygonsAper.forEach(p => {
                const obstacleJsts = reader.read(polyToGeoJSONAper(p));
                if (!totalPlusJsts.contains(obstacleJsts)) {
                    const outside = obstacleJsts.difference(totalPlusJsts);
                    if (!outside.isEmpty() && outside.getArea() > 0) {
                        createHelperAper(writer.write(outside), '#2196F3', '#1976D2');
                    }
                }
            });
        }
    } catch (e) { console.warn("Erreur JSTS:", e); }

    document.getElementById('fix-overlaps-aper').style.display = hasOverlap ? 'block' : 'none';
}

function createHelperAper(geojson, fill, stroke) {
    const h = new google.maps.Polygon({
        paths: geojsonToPathAper(geojson),
        fillColor: fill, fillOpacity: 0.8, strokeColor: stroke, strokeWeight: 2,
        zIndex: 10, map: mapAper, clickable: false
    });
    helperPolygonsAper.push(h);
}

function mergeObstaclesAper() {
    if (minusPolygonsAper.length < 2) return;
    const reader = new jsts.io.GeoJSONReader();
    const writer = new jsts.io.GeoJSONWriter();
    try {
        let union = reader.read(polyToGeoJSONAper(minusPolygonsAper[0]));
        for (let i = 1; i < minusPolygonsAper.length; i++) {
            union = union.union(reader.read(polyToGeoJSONAper(minusPolygonsAper[i])));
        }
        minusPolygonsAper.forEach(p => p.setMap(null));
        minusPolygonsAper = [];
        const paths = geojsonToPathAper(writer.write(union));
        const newPoly = new google.maps.Polygon({
            paths: paths, fillColor: '#f44336', strokeColor: '#f44336', fillOpacity: 0.6,
            editable: true, draggable: true, map: mapAper, zIndex: 1
        });
        initPolygonAper(newPoly, 'minus');
        detectOverlapsAper();
        updateResultsAper();
        saveToLocalStorageAper();
    } catch (e) { alert("Impossible de fusionner ces formes."); }
}

function polyToGeoJSONAper(poly) {
    const coords = poly.getPath().getArray().map(p => [p.lng(), p.lat()]);
    coords.push(coords[0]);
    return { type: "Polygon", coordinates: [coords] };
}

function geojsonToPathAper(geojson) {
    if (geojson.type === "Polygon") return geojson.coordinates[0].map(c => ({ lat: c[1], lng: c[0] }));
    if (geojson.type === "MultiPolygon") return geojson.coordinates.flatMap(p => p[0].map(c => ({ lat: c[1], lng: c[0] })));
    return [];
}

function updateResultsAper() {
    let areaPlus = 0;
    plusPolygonsAper.forEach(p => areaPlus += google.maps.geometry.spherical.computeArea(p.getPath()));

    let areaMinus = 0;
    minusPolygonsAper.forEach(p => areaMinus += google.maps.geometry.spherical.computeArea(p.getPath()));

    const potSolar = Math.max(0, areaPlus - areaMinus);
    const aper = parseFloat(document.getElementById('percent-aper-aper').value) || 0;

    document.getElementById('surface-artif-aper').innerText = areaPlus.toFixed(2) + " m²";
    document.getElementById('surface-obs-aper').innerText = areaMinus.toFixed(2) + " m²";
    document.getElementById('surface-pot-solar-aper').innerText = potSolar.toFixed(2) + " m²";
    document.getElementById('surface-reglementaire-aper').innerText = (potSolar * (aper / 100)).toFixed(2) + " m²";
}

function saveToLocalStorageAper() {
    const data = {
        address: document.getElementById('project-address-aper').value,
        aper: document.getElementById('percent-aper-aper').value,
        surfaceParcelle: document.getElementById('surface-parcelle-aper').value,
        plusShapes: plusPolygonsAper.map(p => p.getPath().getArray().map(l => ({ lat: l.lat(), lng: l.lng() }))),
        minusShapes: minusPolygonsAper.map(p => p.getPath().getArray().map(l => ({ lat: l.lat(), lng: l.lng() })))
    };
    localStorage.setItem('solarProjectStable', JSON.stringify(data));
}

function loadFromLocalStorageAper() {
    // Charger d'abord les données spécifiques au modal (solarProjectStable)
    const saved = localStorage.getItem('solarProjectStable');
    if (saved) {
        const d = JSON.parse(saved);
        document.getElementById('project-address-aper').value = d.address || '';
        document.getElementById('percent-aper-aper').value = d.aper || 100;
        document.getElementById('surface-parcelle-aper').value = d.surfaceParcelle || 1000;
        if (d.plusShapes) d.plusShapes.forEach(path => initPolygonAper(new google.maps.Polygon({ paths: path, map: mapAper, fillColor: '#4CAF50', strokeColor: '#4CAF50', fillOpacity: 0.4, editable: true, draggable: true }), 'plus'));
        if (d.minusShapes) d.minusShapes.forEach(path => initPolygonAper(new google.maps.Polygon({ paths: path, map: mapAper, fillColor: '#f44336', strokeColor: '#f44336', fillOpacity: 0.6, editable: true, draggable: true }), 'minus'));
    }

    // Charger et afficher les formes de la carte principale (solarProjectData) en lecture seule
    const mainMapData = localStorage.getItem('solarProjectData');
    if (mainMapData) {
        try {
            const projectData = JSON.parse(mainMapData);
            if (projectData.shapes) {
                Object.values(projectData.shapes).forEach(shape => {
                    if (shape.points && shape.points.length > 0) {
                        // Créer un polygone en lecture seule pour visualiser la forme de la carte principale
                        new google.maps.Polygon({
                            paths: shape.points,
                            map: mapAper,
                            fillColor: '#2196F3',  // Couleur bleue pour distinguer des formes éditables
                            strokeColor: '#1976D2',
                            fillOpacity: 0.2,
                            strokeOpacity: 0.8,
                            strokeWeight: 2,
                            editable: false,
                            draggable: false,
                            clickable: false,
                            zIndex: 0  // En arrière-plan
                        });
                    }
                });
                console.log('✅ Formes de la carte principale affichées sur la carte Loi APER');
            }
        } catch (error) {
            console.warn('⚠️ Erreur lors du chargement des formes de la carte principale:', error);
        }
    }

    detectOverlapsAper();
    updateResultsAper();
}

function togglePrecisionModeAper() {
    isPrecisionModeAper = !isPrecisionModeAper;
    mapAper.setOptions({ zoom: isPrecisionModeAper ? 21 : 18, draggable: !isPrecisionModeAper });
    this.innerText = isPrecisionModeAper ? "Mode normal" : "Mode précision (Zoom max)";
    this.className = isPrecisionModeAper ? "btn-success" : "btn-warning";
}

function updateCoordsAper(loc) {
    document.getElementById('coords-display-aper').innerText = `Coordonnées : ${loc.lat().toFixed(5)}, ${loc.lng().toFixed(5)}`;
}

function makeModalDraggableAper() {
    const m = document.getElementById('solar-modal-aper');
    const h = document.getElementById('modal-drag-aper');
    let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    h.onmousedown = (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        e.preventDefault(); p3 = e.clientX; p4 = e.clientY;
        document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
        document.onmousemove = (e) => {
            p1 = p3 - e.clientX; p2 = p4 - e.clientY; p3 = e.clientX; p4 = e.clientY;
            m.style.top = (m.offsetTop - p2) + "px"; m.style.left = (m.offsetLeft - p1) + "px";
        };
    };
}
