import { calculateRectPoints } from './solar_calculations.js';

export function startRectDrawing(ctx) {
    stopRectDrawing(ctx);
    ctx.rectOverlayDiv = document.createElement('div');
    ctx.rectOverlayDiv.style.cssText = [
        'position:absolute', 'top:0', 'left:0',
        'width:100%', 'height:100%',
        'cursor:crosshair',
        'pointer-events:all',
        'z-index:999'
    ].join(';');

    ctx.rectOverlayDiv.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const latLng = ctx.clientXYtoLatLng(e.clientX, e.clientY);
        if (latLng) handleMapClick({ latLng }, ctx);
    });

    ctx.rectOverlayDiv.addEventListener('mousemove', (e) => {
        const latLng = ctx.clientXYtoLatLng(e.clientX, e.clientY);
        if (latLng) handleMapMouseMove({ latLng }, ctx);
    });

    ctx.rectOverlayDiv.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const latLng = ctx.clientXYtoLatLng(e.clientX, e.clientY);
        if (latLng) handleMapClick({ latLng }, ctx);
    });

    document.getElementById('map').appendChild(ctx.rectOverlayDiv);
}

export function stopRectDrawing(ctx) {
    if (ctx.rectOverlayDiv) {
        ctx.rectOverlayDiv.remove();
        ctx.rectOverlayDiv = null;
    }
}

export function handleMapClick(e, ctx) {
    if (!ctx.pvDrawingMode) return;
    if (ctx.pvPoints.length > 0 && google.maps.geometry.spherical.computeDistanceBetween(ctx.pvPoints[ctx.pvPoints.length - 1], e.latLng) < 0.1) return;

    ctx.pvPoints.push(e.latLng);

    if (ctx.pvPoints.length === 1) {
        ctx.tempPvLine = new google.maps.Polyline({
            map: ctx.map,
            path: [e.latLng, e.latLng],
            strokeColor: '#FF9800',
            strokeWeight: 2,
            zIndex: 10
        });
    } else if (ctx.pvPoints.length === 2) {
        ctx.tempPvLine.setPath([ctx.pvPoints[0], ctx.pvPoints[1]]);
        const initHeading = google.maps.geometry.spherical.computeHeading(ctx.pvPoints[0], ctx.pvPoints[1]);
        const initP3 = google.maps.geometry.spherical.computeOffset(ctx.pvPoints[1], 1, initHeading + 90);
        const initRect = calculateRectPoints(ctx.pvPoints[0], ctx.pvPoints[1], initP3);
        ctx.tempPvPoly = new google.maps.Polygon({
            map: ctx.map,
            paths: initRect,
            fillColor: '#FFC107',
            strokeColor: '#FF9800',
            fillOpacity: 0.35,
            clickable: false,
            zIndex: 10
        });
    } else if (ctx.pvPoints.length === 3) {
        const polyPoints = calculateRectPoints(ctx.pvPoints[0], ctx.pvPoints[1], e.latLng);
        const azimuth = ctx.calculatePVAzimuth(polyPoints[0], polyPoints[1]);

        ctx.pvDrawingMode = false;
        ctx.pvPoints = [];
        stopRectDrawing(ctx);
        if (ctx.tempPvLine) { ctx.tempPvLine.setMap(null); ctx.tempPvLine = null; }
        if (ctx.tempPvPoly) { ctx.tempPvPoly.setMap(null); ctx.tempPvPoly = null; }
        ctx.map.setOptions({ draggableCursor: null, draggable: true });

        ctx.rectFeatures.forEach(rf => {
            rf.polygon.setOptions({ editable: true, draggable: true });
        });

        ctx.createRectFeature(polyPoints, azimuth);
    }
}

export function handleMapMouseMove(e, ctx) {
    if (ctx.pvDrawingMode && ctx.pvPoints.length === 1) {
        ctx.tempPvLine.setPath([ctx.pvPoints[0], e.latLng]);
    } else if (ctx.pvDrawingMode && ctx.pvPoints.length === 2) {
        const polyPoints = calculateRectPoints(ctx.pvPoints[0], ctx.pvPoints[1], e.latLng);
        if (ctx.tempPvPoly) ctx.tempPvPoly.setPaths(polyPoints);
    }
}

export function drawPanelsInRect(path, featureOrRf, W, L, sx, sy, ctx) {
    const { map, manualEditMode, hiddenPanels, panelFillColor, PANEL_COLOR_STROKE, panelPolygons, getShedParams, calculateShedGridRect, marginX, marginY, borderDistance, dilatationMaxLength, dilatationWidth, updatePvTable, type_de_structure, pente, pente2, toiture_pente_type, largeur_faitage_mm, asymetrie_percent, nb_pentes } = ctx;
    const featureId = featureOrRf.id;
    const p0 = path[0], p1 = path[1], p3 = path[3];

    const headingX = google.maps.geometry.spherical.computeHeading(p0, p1);
    const headingY = google.maps.geometry.spherical.computeHeading(p0, p3);

    const D1 = google.maps.geometry.spherical.computeDistanceBetween(p0, p1);
    const D2 = google.maps.geometry.spherical.computeDistanceBetween(p0, p3);

    const offsetStart = borderDistance / 1000;

    // --- LOGIQUE DE CORRECTION DE LA PENTE ET AXE ---
    const allowedStructures = ['Ombrière métal', 'Ombrière bois', 'Ombrière solumbra', 'Ombrière k2system', 'Ombrière béton', 'Bâtiment incliné métal', 'Bâtiment incliné (métal/bois)', 'bâtiment incliné bois'];
    let isInclined = false;
    if (allowedStructures.includes(type_de_structure) || /ombri[èe]re|incliné/i.test(type_de_structure)) {
        isInclined = true;
    }

    let isXParallelToSlope = false;
    let isYParallelToSlope = false;

    const azimuth = parseFloat(featureOrRf.azimuth || 0);
    
    // Utiliser l'azimut de base de la géométrie pour déterminer le mode de dépose (l'axe de la grille)
    // Cela empêche la rotation des panneaux lorsqu'on modifie uniquement l'input d'azimut (la flèche).
    const baseAzimuth = headingX - 90;
    const azRad = baseAzimuth * Math.PI / 180;
    const hXRad = headingX * Math.PI / 180;
    const hYRad = headingY * Math.PI / 180;
    
    const dotX = Math.abs(Math.cos(azRad - hXRad));
    const dotY = Math.abs(Math.cos(azRad - hYRad));
    
    if (dotX > dotY) {
        isXParallelToSlope = true;
    } else {
        isYParallelToSlope = true;
    }

    const getFactor = (p) => {
        const safeP = Math.min(Math.max(p || 0, 0), 89.9);
        return isInclined && safeP > 0 ? 1 / Math.cos(safeP * Math.PI / 180) : 1;
    };

    const factor1 = getFactor(pente);
    const factor2 = getFactor(pente2);
    const tType = toiture_pente_type || 'Monopente';

    let zones = [];
    const D_slope = isXParallelToSlope ? D1 : D2;
    const D_ridge = isXParallelToSlope ? D2 : D1;
    const F = largeur_faitage_mm ? largeur_faitage_mm / 1000 : 0.5;

    if (tType === 'Monopente') {
        zones.push({ offset: 0, length: D_slope, factor: factor1 });
    } else if (tType === 'Bipente_symetrique') {
        const half = D_slope / 2;
        zones.push({ offset: 0, length: half - F/2, factor: factor1 });
        zones.push({ offset: half + F/2, length: half - F/2, factor: factor1 });
    } else if (tType === 'Bipente_asymetrique') {
        const split = D_slope * ((asymetrie_percent || 50) / 100);
        zones.push({ offset: 0, length: split - F/2, factor: factor1 });
        zones.push({ offset: split + F/2, length: D_slope - split - F/2, factor: factor2 });
    } else if (tType === 'Multipente') {
        const n = Math.min(4, Math.max(2, nb_pentes || 2));
        const sectionLen = D_slope / n;
        for (let i = 0; i < n; i++) {
            let start = i * sectionLen;
            let end = (i + 1) * sectionLen;
            if (i % 2 === 0) end -= F/2; // Montée : faîtage à la fin
            else start += F/2; // Descente : faîtage au début
            zones.push({ offset: start, length: end - start, factor: factor1 });
        }
    }

    // --- FAÎTAGES (RIDGE LINES) ---
    let boundaries = [];
    if (tType === 'Bipente_symetrique') {
        boundaries.push({ dist: D_slope / 2, draggable: false });
    } else if (tType === 'Bipente_asymetrique') {
        boundaries.push({ dist: D_slope * ((asymetrie_percent || 50) / 100), draggable: true });
    } else if (tType === 'Multipente') {
        const n = Math.min(4, Math.max(2, nb_pentes || 2));
        const sectionLen = D_slope / n;
        for (let i = 1; i < n; i++) {
            boundaries.push({ dist: i * sectionLen, draggable: false });
        }
    }

    // CORRECTIF (demande explicite : "j'ai supprimé un rectangle avec la géométrie de toiture=bipente,
    // le faîtage reste") : LineToPolygon.js::updateRoofVisuals dessine déjà son propre faîtage/noue par
    // pan (suivi dans roofOverlaysByShape, correctement nettoyé à la suppression de la forme) — sans ce
    // garde, ce moteur créait EN PLUS ses propres lignes ici, stockées dans window.ridgePolylines,
    // jamais nettoyées à la suppression (seulement remplacées au prochain redessin du MÊME featureId) :
    // elles restaient donc orphelines sur la carte après suppression du rectangle. Même correctif que
    // ctx.disableZoneMarkers ci-dessus (flèches PV en double), posé par PanelEngineAdapter.js.
    if (!ctx.disableRidgeLines) {
        if (!window.ridgePolylines) window.ridgePolylines = {};
        if (window.ridgePolylines[featureId]) {
            if (Array.isArray(window.ridgePolylines[featureId])) {
                window.ridgePolylines[featureId].forEach(p => p.setMap(null));
            } else {
                window.ridgePolylines[featureId].setMap(null);
            }
        }
        window.ridgePolylines[featureId] = [];

        boundaries.forEach((boundary) => {
            let poly = new google.maps.Polyline({
                map: map,
                strokeColor: '#FF0000',
                strokeWeight: boundary.draggable ? 4 : 2,
                draggable: boundary.draggable,
                zIndex: 100
            });
            window.ridgePolylines[featureId].push(poly);

            let extension = boundary.draggable ? 1.0 : 0;
            const rStart_x = isXParallelToSlope ? boundary.dist : -extension;
            const rStart_y = isXParallelToSlope ? -extension : boundary.dist;
            const pStart = google.maps.geometry.spherical.computeOffset(
                google.maps.geometry.spherical.computeOffset(p0, rStart_x, headingX),
                rStart_y, headingY
            );

            const rEnd_x = isXParallelToSlope ? boundary.dist : D1 + extension;
            const rEnd_y = isXParallelToSlope ? D2 + extension : boundary.dist;
            const pEnd = google.maps.geometry.spherical.computeOffset(
                google.maps.geometry.spherical.computeOffset(p0, rEnd_x, headingX),
                rEnd_y, headingY
            );

            poly.setPath([pStart, pEnd]);

            if (boundary.draggable) {
                google.maps.event.addListener(poly, 'drag', () => {
                    const pNew = poly.getPath().getAt(0);

                    const distP0 = google.maps.geometry.spherical.computeDistanceBetween(p0, pNew);
                    const headingP0 = google.maps.geometry.spherical.computeHeading(p0, pNew);
                    const slopeHeading = isXParallelToSlope ? headingX : headingY;

                    const angleDiff = (headingP0 - slopeHeading) * Math.PI / 180;
                    const proj = distP0 * Math.cos(angleDiff);

                    let newPercent = (proj / D_slope) * 100;
                    newPercent = Math.max(1, Math.min(99, newPercent));

                    if(ctx.setAsymmetry) ctx.setAsymmetry(newPercent);
                });
            }
        });
    }

    // --- MARKERS (PV ZONES) ---
    if (!window.zoneMarkers) window.zoneMarkers = {};
    if (window.zoneMarkers[featureId]) {
        window.zoneMarkers[featureId].forEach(m => m.setMap(null));
    }
    window.zoneMarkers[featureId] = [];

    let drawnPanelsCount = 0;

    const createPanelPoly = (pOrig, c1, c2, c3, panelKey, panIndex, zoneNumRows, zoneNumCols) => {
        if (window.obstacleManager && window.obstacleManager.isPanelBlocked([pOrig, c1, c2, c3])) return; // Supprime le panneau s'il heurte un obstacle

        const isHidden = hiddenPanels[featureId] && hiddenPanels[featureId].has(panelKey);
        if (!manualEditMode && isHidden) return;

        const poly = new google.maps.Polygon({
            map: map,
            paths: [pOrig, c1, c2, c3],
            visible: !ctx.isFieldHidden,
            fillColor: isHidden ? 'transparent' : panelFillColor,
            fillOpacity: isHidden ? 0.0 : 0.8,
            strokeColor: isHidden ? 'transparent' : (PANEL_COLOR_STROKE[panelFillColor] || '#000'),
            strokeOpacity: isHidden ? 0.0 : 1.0,
            strokeWeight: isHidden ? 0 : 0.5,
            zIndex: 5,
            clickable: true // Modifié: Toujours cliquable pour capter l'évènement de Hitbox
        });

        const _key = panelKey, _fid = featureId, _hidden = isHidden;
        poly.featureId = _fid;
        // CORRECTIF : CalculationUtils.getAccuratePanelCount (résumé calepinage, SummaryModal,
        // ExportService) rejette tout panneau sans .panelIndex — jamais posé jusqu'ici par ce moteur,
        // ce qui ramenait systématiquement le compte de panneaux affiché à 0 pour le calepinage
        // rectangulaire. Réutilise directement la clé déjà unique par panneau (panelKey), aussi
        // nécessaire pour que la suppression/restauration (LineToPolygon.js::removeSolarPanel) se
        // recale correctement sur les mêmes clés que hiddenPanels ci-dessus.
        poly.panelIndex = _key;
        // CORRECTIF (demande explicite, toitures Bipente/Multipente : "on n'a qu'un label PV1.1,
        // disposition égale à 1x le total") : contrairement à .panelIndex (clé de suivi
        // suppression/restauration ci-dessus), .panIndex (numérique, 1/2/3/4) n'était JAMAIS posé
        // par ce moteur — CalculationUtils.getPanelCountByPan (qui alimente SummaryModal.js/
        // ExportService) lit `panel.panIndex || 1` pour compter les panneaux PAR PAN, donc TOUS les
        // panneaux de TOUS les pans retombaient sur le pan 1 : PV1.2/1.3/1.4 n'étaient jamais créés
        // et la disposition affichait le total du champ sur une seule ligne. `zIdx` (index de zone/
        // pan, déjà utilisé juste au-dessus pour la clé panelKey et pour ctx.setZoneAzimuth) est
        // directement le numéro de pan (1-based).
        poly.panIndex = panIndex;
        // CORRECTIF (demande explicite : "si le total est 10L, il faut représenter 5L pour le
        // bipente... on divise par 2 pour le bipente et par 4 pour le multipente") : la Disposition
        // affichée par SummaryModal.js se basait jusqu'ici sur #nbLigne/#nbColonne (gridInfo), qui
        // valent artificiellement 1 x <total panneaux> pour CE moteur (cf. LineToPolygon.js, qui ne
        // peut pas reporter une vraie décomposition lignes/colonnes globale quand la toiture a
        // plusieurs pans) — diviser "1" par le nombre de pans ne changeait donc rien. On expose ici
        // la VRAIE disposition par pan (nx/ny déjà calculés ci-dessous pour le placement réel des
        // panneaux), lue ensuite par CalculationUtils.getGridSizeByPan.
        poly.zoneNumRows = zoneNumRows;
        poly.zoneNumCols = zoneNumCols;

        const togglePanelVisibility = (e) => {
            if (e && e.domEvent) e.domEvent.stopPropagation();
            if (manualEditMode) {
                if (_hidden) {
                    hiddenPanels[_fid].delete(_key);
                } else {
                    if (!hiddenPanels[_fid]) hiddenPanels[_fid] = new Set();
                    hiddenPanels[_fid].add(_key);
                }
                updatePvTable();
            } else {
                if (ctx.selectFeature) ctx.selectFeature(_fid, e);
            }
        };
        
        google.maps.event.addListener(poly, 'click', togglePanelVisibility);
        google.maps.event.addListener(poly, 'rightclick', togglePanelVisibility);
        
        panelPolygons.push(poly);
        if (!isHidden) drawnPanelsCount++; // Enregistre uniquement les panneaux dessinés en compte exact
    };

    const shedParams = getShedParams();

    zones.forEach((zone, zIdx) => {
        const margin_slope_axis = isXParallelToSlope ? marginX / 1000 : marginY / 1000;
        const margin_ridge_axis = isXParallelToSlope ? marginY / 1000 : marginX / 1000;
        const total_margin_slope = offsetStart + margin_slope_axis;
        const total_margin_ridge = offsetStart + margin_ridge_axis;

        let hasMarginStart = (tType === 'Monopente') || (zIdx % 2 === 0);
        let hasMarginEnd = (tType === 'Monopente') || (zIdx % 2 === 1);

        let effD_slope = zone.length;
        if (hasMarginStart) effD_slope -= total_margin_slope;
        if (hasMarginEnd) effD_slope -= total_margin_slope;

        // La dimension le long du faîtage a toujours des marges des deux côtés.
        let effD_ridge = D_ridge - 2 * total_margin_ridge;

        if (effD_slope <= 0 || effD_ridge <= 0) return;

        // SYNC AZIMUTH & MARKERS
        let zoneAzimuth = (azimuth + (zIdx % 2 === 1 ? 180 : 0)) % 360;
        if (zoneAzimuth < 0) zoneAzimuth += 360;
        if (ctx.setZoneAzimuth) {
            ctx.setZoneAzimuth(featureId, zIdx + 1, zoneAzimuth);
        }

        // CORRECTIF (demande explicite : "il y a les anciennes flèches du fichier
        // calepinage_rectangulaire.js et celles de LineToPolygon.js... conserver celles de
        // LineToPolygon.js. Masquer les autres.") : LineToPolygon.js::updateRoofVisuals dessine déjà
        // ses propres flèches/labels par pan (AdvancedMarkerElement + arrow.svg), appelé juste après
        // ce moteur pour chaque tracé — les marqueurs SVG créés ici faisaient doublon (4 flèches/
        // labels au lieu de 2 en Bipente symétrique). ctx.disableZoneMarkers désactive uniquement leur
        // création (le nettoyage des anciens marqueurs juste au-dessus reste actif).
        if (tType !== 'Monopente' && !ctx.disableZoneMarkers) {
            const zoneDistCenter = zone.offset + zone.length / 2;
            const ridgeCenter = D_ridge / 2;
            const cx = isXParallelToSlope ? zoneDistCenter : ridgeCenter;
            const cy = isXParallelToSlope ? ridgeCenter : zoneDistCenter;
            const pCenter = google.maps.geometry.spherical.computeOffset(
                google.maps.geometry.spherical.computeOffset(p0, cx, headingX), 
                cy, headingY
            );

            const slopeHeading = isXParallelToSlope ? headingX : headingY;
            const mapArrowHeading = (slopeHeading + (zIdx % 2 === 0 ? 180 : 0)) % 360;
            let mapArrowHeadingMod = mapArrowHeading % 360;
            if (mapArrowHeadingMod < 0) mapArrowHeadingMod += 360;
            
            let textFlip = (mapArrowHeadingMod > 90 && mapArrowHeadingMod < 270) ? 180 : 0;

            const text = `PV${zIdx + 1}`;
            const svg = `
                <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
                    <g transform="rotate(${mapArrowHeadingMod}, 50, 50)">
                        <path d="M50 20 L50 80 M42 72 L50 80 L58 72" stroke="#FFFFFF" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M50 20 L50 80 M42 72 L50 80 L58 72" stroke="#000000" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                        <g transform="rotate(${textFlip}, 20, 50)">
                            <text x="20" y="55" font-family="Arial" font-size="16" font-weight="bold" fill="#FFF" stroke="#000" stroke-width="3" paint-order="stroke" text-anchor="middle">${text}</text>
                            <text x="20" y="55" font-family="Arial" font-size="16" font-weight="bold" fill="#FFF" text-anchor="middle">${text}</text>
                        </g>
                    </g>
                </svg>
            `;
            const marker = new google.maps.Marker({
                position: pCenter,
                map: map,
                icon: {
                    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg.trim()),
                    anchor: new google.maps.Point(50, 50)
                },
                zIndex: 110,
                clickable: false
            });
            window.zoneMarkers[featureId].push(marker);
        }

        let effD1 = isXParallelToSlope ? effD_slope : effD_ridge;
        let effD2 = isXParallelToSlope ? effD_ridge : effD_slope;

        let effD1_real = effD1 * (isXParallelToSlope ? zone.factor : 1);
        let effD2_real = effD2 * (isYParallelToSlope ? zone.factor : 1);

        if (dilatationMaxLength > 0 && effD1_real > dilatationMaxLength) {
            const joints = Math.floor(effD1_real / dilatationMaxLength);
            effD1_real -= joints * (dilatationWidth / 1000);
        }

        if (effD1_real <= 0 || effD2_real <= 0) return;

        let start_offset_slope = zone.offset + (hasMarginStart ? total_margin_slope : 0);
        let start_offset_ridge = total_margin_ridge;

        const startX = isXParallelToSlope ? start_offset_slope : start_offset_ridge;
        const startY = isYParallelToSlope ? start_offset_slope : start_offset_ridge;

        if (shedParams) {
            const { panels } = calculateShedGridRect(effD1, effD2, W, L, sx, sy, shedParams);
            let maxIx = -1, maxIy = -1;
            panels.forEach(p => {
                if (p.ix > maxIx) maxIx = p.ix;
                if (p.iy > maxIy) maxIy = p.iy;
            });
            const shedNx = maxIx + 1, shedNy = maxIy + 1;
            // Axe de pente (rétrécit par pan, ex: nombre de "Lignes") vs axe du faîtage (identique
            // pour tous les pans, ex: nombre de "Colonnes") — même convention que effD1/effD2 ci-dessus.
            const zoneNumRows = isXParallelToSlope ? shedNx : shedNy;
            const zoneNumCols = isXParallelToSlope ? shedNy : shedNx;
            panels.forEach(p => {
                const dx = startX + p.dx, dy = startY + p.dy;
                const pOrig = google.maps.geometry.spherical.computeOffset(google.maps.geometry.spherical.computeOffset(p0, dx, headingX), dy, headingY);
                const c1 = google.maps.geometry.spherical.computeOffset(pOrig, W, headingX);
                const c2 = google.maps.geometry.spherical.computeOffset(c1, p.L_proj, headingY);
                const c3 = google.maps.geometry.spherical.computeOffset(pOrig, p.L_proj, headingY);
                createPanelPoly(pOrig, c1, c2, c3, `z${zIdx}_${p.ix}_${p.iy}`, zIdx + 1, zoneNumRows, zoneNumCols);
            });
        } else {
            const nx = Math.floor((effD1_real + sx) / (W + sx));
            const ny = Math.floor((effD2_real + sy) / (L + sy));
            // Même convention que ci-dessus (mode shed) : nx/ny comptent respectivement le long de
            // effD1/effD2, isXParallelToSlope indique lequel des deux suit l'axe de pente (Lignes,
            // rétrécit par pan) vs l'axe du faîtage (Colonnes, identique pour tous les pans).
            const zoneNumRows = isXParallelToSlope ? nx : ny;
            const zoneNumCols = isXParallelToSlope ? ny : nx;
            const totalPanelW_real = nx * W + (nx - 1) * sx;
            const totalPanelH_real = ny * L + (ny - 1) * sy;
            
            const centreOffX_real = Math.max(0, (effD1_real - totalPanelW_real) / 2);
            const centreOffY_real = Math.max(0, (effD2_real - totalPanelH_real) / 2);

            const W_map = isXParallelToSlope ? W / zone.factor : W;
            const L_map = isYParallelToSlope ? L / zone.factor : L;
            const sx_map = isXParallelToSlope ? sx / zone.factor : sx;
            const sy_map = isYParallelToSlope ? sy / zone.factor : sy;
            const centreOffX_map = isXParallelToSlope ? centreOffX_real / zone.factor : centreOffX_real;
            const centreOffY_map = isYParallelToSlope ? centreOffY_real / zone.factor : centreOffY_real;

            for (let ix = 0; ix < nx; ix++) {
                for (let iy = 0; iy < ny; iy++) {
                    const dx = startX + centreOffX_map + ix * (W_map + sx_map);
                    const dy = startY + centreOffY_map + iy * (L_map + sy_map);
                    const pOrig = google.maps.geometry.spherical.computeOffset(google.maps.geometry.spherical.computeOffset(p0, dx, headingX), dy, headingY);
                    const c1 = google.maps.geometry.spherical.computeOffset(pOrig, W_map, headingX);
                    const c2 = google.maps.geometry.spherical.computeOffset(c1, L_map, headingY);
                    const c3 = google.maps.geometry.spherical.computeOffset(pOrig, L_map, headingY);
                    createPanelPoly(pOrig, c1, c2, c3, `z${zIdx}_${ix}_${iy}`, zIdx + 1, zoneNumRows, zoneNumCols);
                }
            }
        }
    });

    if (!window.exactPanelCounts) window.exactPanelCounts = {};
    window.exactPanelCounts[featureId] = drawnPanelsCount;
}