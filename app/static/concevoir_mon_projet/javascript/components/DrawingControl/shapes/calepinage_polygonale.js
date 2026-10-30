// CORRECTIF (zone tampon "Esp. bordure" jamais affichée NI appliquée au placement des panneaux) :
// le rétrécissement du polygone dépendait entièrement de window.jsts (librairie tierce chargée par
// CDN, cf. menu.html), silencieusement absente si le CDN est bloqué/indisponible (pare-feu,
// prévention du pistage du navigateur...) — auquel cas checkPoly restait égal au polygone d'origine,
// sans aucune marge, ET sans qu'aucune erreur ne le signale. Remplacé par un rétrécissement pur JS
// (aucune dépendance externe), portage de l'algorithme déjà utilisé et éprouvé par
// PolygonPanelsManager.js pour le même besoin (marge du calepinage classique) : décalage de chaque
// sommet le long de la bissectrice de ses 2 arêtes adjacentes, distance ajustée par l'angle (jointure
// en onglet), plafonnée pour éviter les pointes extrêmes sur les angles très aigus.
export function computeInsetPolygonPath(path, marginMeters) {
    const n = path.length;
    if (n < 3 || marginMeters <= 0) return null;

    const refPoint = path[0];
    const toLocalMeters = (target) => {
        const latPoint = new google.maps.LatLng(target.lat(), refPoint.lng());
        const lngPoint = new google.maps.LatLng(refPoint.lat(), target.lng());
        const deltaY = google.maps.geometry.spherical.computeDistanceBetween(refPoint, latPoint);
        const deltaX = google.maps.geometry.spherical.computeDistanceBetween(refPoint, lngPoint);
        return {
            x: target.lng() >= refPoint.lng() ? deltaX : -deltaX,
            y: target.lat() >= refPoint.lat() ? deltaY : -deltaY
        };
    };

    // Sens de parcours du polygone (formule de l'aire signée / shoelace), nécessaire pour savoir de
    // quel côté des arêtes se trouve l'intérieur du polygone.
    const metersPath = path.map(toLocalMeters);
    let twiceArea = 0;
    for (let i = 0; i < n; i++) {
        const current = metersPath[i];
        const next = metersPath[(i + 1) % n];
        twiceArea += current.x * next.y - next.x * current.y;
    }
    const isClockwise = twiceArea < 0;

    const innerPath = [];
    for (let i = 0; i < n; i++) {
        const current = path[i];
        const prev = path[(i - 1 + n) % n];
        const next = path[(i + 1) % n];

        const toPrev = google.maps.geometry.spherical.computeHeading(current, prev);
        const toNext = google.maps.geometry.spherical.computeHeading(current, next);

        const normalOffset = isClockwise ? -90 : 90;
        const normalToPrev = toPrev + normalOffset;
        const normalToNext = toNext - normalOffset;

        let angleDiff = normalToNext - normalToPrev;
        if (angleDiff > 180) angleDiff -= 360;
        if (angleDiff < -180) angleDiff += 360;

        let bisector = normalToPrev + angleDiff / 2;
        while (bisector > 180) bisector -= 360;
        while (bisector < -180) bisector += 360;

        let segmentAngle = toNext - toPrev;
        if (segmentAngle > 180) segmentAngle -= 360;
        if (segmentAngle < -180) segmentAngle += 360;

        const halfAngleRad = Math.abs(segmentAngle) / 2 * Math.PI / 180;
        const sinHalfAngle = Math.sin(halfAngleRad);
        const offsetDistance = sinHalfAngle > 0.1
            ? Math.min(marginMeters / sinHalfAngle, marginMeters * 5)
            : marginMeters * 5;

        innerPath.push(google.maps.geometry.spherical.computeOffset(current, offsetDistance, bisector));
    }
    return innerPath;
}

export function drawPanelsInPoly(path, feature, W, L, sx, sy, ctx) {
    if (!path || path.length < 3) return; // Sécurité: on ne dessine pas de panneaux dans une forme incomplète

    const { map, manualEditMode, hiddenPanels, panelFillColor, PANEL_COLOR_STROKE, panelPolygons, getShedParams, calculateShedGridPoly, marginX, marginY, borderDistance, updatePvTable, pente, type_de_structure } = ctx;

    // L'orientation de la grille est figée sur la première arête du polygone
    const p0 = path[0];
    let p1 = path[0];
    
    // Trouve le premier point formant une arête distincte pour éviter les anomalies de calcul si p0 et p1 sont identiques (clic en double)
    for (let i = 1; i < path.length; i++) {
        if (google.maps.geometry.spherical.computeDistanceBetween(p0, path[i]) > 0.1) {
            p1 = path[i];
            break;
        }
    }

    // Par défaut, l'orientation de la grille est dérivée de la 1ère arête tracée par l'utilisateur.
    // Si ctx.fixedAzimuth est fourni (nombre), il prime et fixe un azimut indépendant du tracé (même
    // convention que le reste de l'app : 0°=Sud, 90°=Ouest, -90°=Est) — utilisé pour placer les
    // panneaux plein Sud par défaut (cf. ShedPolygon.js), tout en restant ajustable via "Rotation shed".
    const originalAzimuth = (typeof ctx.fixedAzimuth === 'number')
        ? ctx.fixedAzimuth
        : google.maps.geometry.spherical.computeHeading(p0, p1) - 90;
    const headingX = ((originalAzimuth + 180) % 360 + 360) % 360;
    const headingY = (headingX + 90) % 360;

    // --- LOGIQUE DE PENTE ---
    const allowedStructures = ['Ombrière métal', 'Ombrière bois', 'Ombrière solumbra', 'Ombrière k2system', 'Ombrière béton', 'Bâtiment incliné métal', 'Bâtiment incliné (métal/bois)', 'bâtiment incliné bois'];
    const isInclined = allowedStructures.includes(type_de_structure) || /ombri[èe]re|incliné/i.test(type_de_structure);
    const getFactor = (p) => {
        const safeP = Math.min(Math.max(p || 0, 0), 89.9);
        return isInclined && safeP > 0 ? 1 / Math.cos(safeP * Math.PI / 180) : 1;
    };
    const factor = getFactor(pente);
    // On suppose que la pente est le long de l'axe Y de la grille (perpendiculaire au premier segment)
    const L_map = L / factor;
    const sy_map = sy / factor;
    // --- FIN LOGIQUE DE PENTE ---

    // Utiliser le premier point comme ancre fixe pour la grille (empêche le calepinage de glisser lors de la rotation de l'enveloppe globale)
    const gridAnchor = p0;
    let maxDist = 0;
    path.forEach(p => {
        const d = google.maps.geometry.spherical.computeDistanceBetween(gridAnchor, p);
        if (d > maxDist) maxDist = d;
    });
    maxDist += Math.max(W, L);

    const gmPoly = new google.maps.Polygon({ paths: path });
    const border = borderDistance / 1000;
    const mX = marginX / 1000;
    const mY = marginY / 1000;
    const marginMeters = Math.max(mX, mY) + border;
    let checkPoly = gmPoly;
    let insetPathForVisual = null;

    if (marginMeters > 0) {
        const insetPath = computeInsetPolygonPath(path, marginMeters);
        if (insetPath && insetPath.length >= 3) {
            checkPoly = new google.maps.Polygon({ paths: insetPath });
            insetPathForVisual = insetPath;
        } else {
            checkPoly = new google.maps.Polygon({ paths: [] });
        }
    }

    // Demande explicite : "représenter sur le polygone la zone tampon avec la valeur Esp. bordure" —
    // le report au ctx permet à l'appelant (ShedPolygon.js) de dessiner la bande entre le tracé
    // d'origine et cette limite réelle, sans dupliquer ici le calcul de rétrécissement.
    if (typeof ctx.onMarginZoneComputed === 'function') {
        ctx.onMarginZoneComputed(path, insetPathForVisual);
    }

    let drawnPanelsCount = 0;

    const createPanelPoly = (pOrig, c1, c2, c3, panelKey) => {
        if (window.obstacleManager && window.obstacleManager.isPanelBlocked([pOrig, c1, c2, c3])) return; // Supression directe si intersection avec obstacle

        const isHidden = hiddenPanels[feature.id] && hiddenPanels[feature.id].has(panelKey);
        if (!manualEditMode && isHidden) return;
        const fillColor = isHidden ? 'transparent' : panelFillColor;
        const fillOpacity = isHidden ? 0.0 : 0.75;
        const strokeColor = isHidden ? 'transparent' : (PANEL_COLOR_STROKE[panelFillColor] || '#0D47A1');
        const strokeOpacity = isHidden ? 0.0 : 1.0;
        const strokeWeight = isHidden ? 0 : 0.5;

        const panelPoly = new google.maps.Polygon({
            map: map, paths: [pOrig, c1, c2, c3],
            visible: !ctx.isFieldHidden,
            fillColor, fillOpacity, strokeColor, strokeOpacity, strokeWeight,
            clickable: true, zIndex: 50
        });

        const _key2 = panelKey, _fid2 = feature.id, _hidden2 = isHidden;
        panelPoly.featureId = _fid2;
        // CORRECTIF : même correctif que calepinage_rectangulaire.js — CalculationUtils.
        // getAccuratePanelCount rejette tout panneau sans .panelIndex, ce qui ramenait le compte de
        // panneaux affiché à 0 (résumé calepinage, SummaryModal) pour le calepinage shed/polygonal.
        panelPoly.panelIndex = _key2;

        const togglePanelVisibility = (e) => {
            if (e && e.domEvent) e.domEvent.stopPropagation();
            if (manualEditMode) {
                if (_hidden2) {
                    hiddenPanels[_fid2].delete(_key2);
                } else {
                    if (!hiddenPanels[_fid2]) hiddenPanels[_fid2] = new Set();
                    hiddenPanels[_fid2].add(_key2);
                }
                updatePvTable();
            } else {
                if (ctx.selectFeature) ctx.selectFeature(_fid2, e);
            }
        };

        google.maps.event.addListener(panelPoly, 'click', togglePanelVisibility);
        google.maps.event.addListener(panelPoly, 'rightclick', togglePanelVisibility);

        panelPolygons.push(panelPoly);
        if (!isHidden) drawnPanelsCount++; // Actualisation précise
    };

    const shedParams = getShedParams();
    if (shedParams) {
        const { panels } = calculateShedGridPoly(checkPoly, W, L, sx, sy, shedParams, gridAnchor, maxDist, headingX, headingY);
        panels.forEach(p => createPanelPoly(p.pOrig, p.pC1, p.pC2, p.pC3, `${p.ix}_${p.iy}`));
    } else {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        const checkPath = checkPoly.getPath().getArray();
        
        if (checkPath.length > 0) {
            checkPath.forEach(p => {
                const dist = google.maps.geometry.spherical.computeDistanceBetween(gridAnchor, p);
                const heading = google.maps.geometry.spherical.computeHeading(gridAnchor, p);
                const angle = (heading - headingX) * Math.PI / 180;
                const px = dist * Math.cos(angle);
                const py = dist * Math.sin(angle);
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
            });
            
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            
            const availableW = maxX - minX;
            const availableH = maxY - minY;
            
            const nx = Math.floor((availableW + sx) / (W + sx));
            const ny = Math.floor((availableH + sy_map) / (L_map + sy_map));
            
            const totalGridW = nx * W + Math.max(0, nx - 1) * sx;
            const totalGridH = ny * L_map + Math.max(0, ny - 1) * sy_map;
            
            const gridStartX = cx - totalGridW / 2;
            const gridStartY = cy - totalGridH / 2;
            
            const pBaseX = google.maps.geometry.spherical.computeOffset(gridAnchor, Math.abs(gridStartX), gridStartX >= 0 ? headingX : (headingX + 180) % 360);
            const newAnchor = google.maps.geometry.spherical.computeOffset(pBaseX, Math.abs(gridStartY), gridStartY >= 0 ? headingY : (headingY + 180) % 360);
            
        let count = 0;
        const MAX_PANELS = 5000;
        
        for (let ix = 0; ix < nx && count < MAX_PANELS; ix++) {
            for (let iy = 0; iy < ny && count < MAX_PANELS; iy++) {
                const ox = ix * (W + sx);
                const oy = iy * (L_map + sy_map);
                
                const rowBase = google.maps.geometry.spherical.computeOffset(newAnchor, oy, headingY);
                const pOrig = google.maps.geometry.spherical.computeOffset(rowBase, ox, headingX);
                
                const pC1 = google.maps.geometry.spherical.computeOffset(pOrig, W, headingX);
                const pC2 = google.maps.geometry.spherical.computeOffset(pC1, L_map, headingY);
                const pC3 = google.maps.geometry.spherical.computeOffset(pOrig, L_map, headingY);

                // Contrôle strict des bords du polygone (Corners + Edges + Center)
                const pCenter = google.maps.geometry.spherical.interpolate(pOrig, pC2, 0.5);
                const pMid1 = google.maps.geometry.spherical.interpolate(pOrig, pC1, 0.5);
                const pMid2 = google.maps.geometry.spherical.interpolate(pC1, pC2, 0.5);
                const pMid3 = google.maps.geometry.spherical.interpolate(pC2, pC3, 0.5);
                const pMid4 = google.maps.geometry.spherical.interpolate(pC3, pOrig, 0.5);

                if (google.maps.geometry.poly.containsLocation(pOrig, checkPoly) && 
                    google.maps.geometry.poly.containsLocation(pC1, checkPoly) &&
                    google.maps.geometry.poly.containsLocation(pC2, checkPoly) && 
                    google.maps.geometry.poly.containsLocation(pC3, checkPoly) &&
                    google.maps.geometry.poly.containsLocation(pCenter, checkPoly) &&
                    google.maps.geometry.poly.containsLocation(pMid1, checkPoly) &&
                    google.maps.geometry.poly.containsLocation(pMid2, checkPoly) &&
                    google.maps.geometry.poly.containsLocation(pMid3, checkPoly) &&
                    google.maps.geometry.poly.containsLocation(pMid4, checkPoly)) {
                    createPanelPoly(pOrig, pC1, pC2, pC3, `${ix}_${iy}`);
                    count++;
                }
            }
        }
        }
    }
    
    if (!window.exactPanelCounts) window.exactPanelCounts = {};
    window.exactPanelCounts[feature.id] = drawnPanelsCount;
}