export function calculateRectPoints(p1, p2, p3) {
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

export function _computeRectPanelCount(rf, config) {
    const { 
        pLen, pWid, sX, sY, pvOrientation, 
        marginX, marginY, borderDistance, 
        dilatationMaxLength, dilatationWidth, 
        getShedParams, calculateShedGridRect,
        // Paramètres de pente
        type_de_structure, pente, pente2, toiture_pente_type, 
        largeur_faitage_mm, asymetrie_percent, nb_pentes
    } = config;
    
    if (!pLen || !pWid || pLen === 0 || pWid === 0) return { count: 0, tableCount: 0 };

    const dimX = (pvOrientation === 'portrait') ? pWid : pLen;
    const dimY = (pvOrientation === 'portrait') ? pLen : pWid;
    const W = dimX / 1000, L = dimY / 1000;
    const sx = sX / 1000, sy = sY / 1000;

    let tableCount = 0;

    if (rf.coords.length < 4) return { count: 0, tableCount };

    const p0 = rf.coords[0], p1 = rf.coords[1], p3 = rf.coords[3];
    const headingX = google.maps.geometry.spherical.computeHeading(p0, p1);
    const headingY = google.maps.geometry.spherical.computeHeading(p0, p3);

    const D1 = google.maps.geometry.spherical.computeDistanceBetween(p0, p1);
    const D2 = google.maps.geometry.spherical.computeDistanceBetween(p0, p3);

    const offsetStart = borderDistance / 1000;

    const allowedStructures = ['Ombrière métal', 'Ombrière bois', 'Ombrière solumbra', 'Ombrière k2system', 'Ombrière béton', 'Bâtiment incliné métal', 'Bâtiment incliné (métal/bois)', 'bâtiment incliné bois'];
    const isInclined = allowedStructures.includes(type_de_structure) || /ombri[èe]re|incliné/i.test(type_de_structure);

    const baseAzimuth = headingX - 90;
    const azRad = baseAzimuth * Math.PI / 180;
    const hXRad = headingX * Math.PI / 180;
    const hYRad = headingY * Math.PI / 180;
    const dotX = Math.abs(Math.cos(azRad - hXRad));
    const dotY = Math.abs(Math.cos(azRad - hYRad));
    const isXParallelToSlope = dotX > dotY;
    const isYParallelToSlope = !isXParallelToSlope;

    const getFactor = (p) => {
        const safeP = Math.min(Math.max(p || 0, 0), 89.9);
        return isInclined && safeP > 0 ? 1 / Math.cos(safeP * Math.PI / 180) : 1;
    };

    const factor1 = getFactor(pente);
    const factor2 = getFactor(pente2);
    const tType = toiture_pente_type || 'Monopente';

    const D_slope = isXParallelToSlope ? D1 : D2;
    const D_ridge = isXParallelToSlope ? D2 : D1;
    const F = largeur_faitage_mm ? largeur_faitage_mm / 1000 : 0.5;

    let zones = [];
    if (tType === 'Monopente') {
        zones.push({ length: D_slope, factor: factor1 });
    } else if (tType === 'Bipente_symetrique') {
        const half = D_slope / 2;
        zones.push({ length: half - F/2, factor: factor1 });
        zones.push({ length: half - F/2, factor: factor1 });
    } else if (tType === 'Bipente_asymetrique') {
        const split = D_slope * ((asymetrie_percent || 50) / 100);
        zones.push({ length: split - F/2, factor: factor1 });
        zones.push({ length: D_slope - split - F/2, factor: factor2 });
    } else if (tType === 'Multipente') {
        const n = Math.min(4, Math.max(2, nb_pentes || 2));
        const sectionLen = D_slope / n;
        for (let i = 0; i < n; i++) {
            let start = i * sectionLen;
            let end = (i + 1) * sectionLen;
            if (i % 2 === 0 && i < n - 1) end -= F/2;
            if (i % 2 === 1) start += F/2;
            zones.push({ length: end - start, factor: factor1 });
        }
    }

    let totalCount = 0;

    const shedParams = getShedParams();
    if (shedParams) {
        let effD1 = D1 - 2 * (marginX / 1000 + borderDistance / 1000);
        let effD2 = D2 - 2 * (marginY / 1000 + borderDistance / 1000);
        if (effD1 <= 0 || effD2 <= 0) return { count: 0, tableCount: 0 };

        if (dilatationMaxLength > 0 && effD1 > dilatationMaxLength) {
            const joints = Math.floor(effD1 / dilatationMaxLength);
            effD1 -= joints * (dilatationWidth / 1000);
        }

        const result = calculateShedGridRect(effD1, effD2, W, L, sx, sy, shedParams);
        totalCount = result.panels.length;
        tableCount = result.tableCount;
    } else {
        const margin_slope_axis = isXParallelToSlope ? marginX / 1000 : marginY / 1000;
        const margin_ridge_axis = isXParallelToSlope ? marginY / 1000 : marginX / 1000;
        const effD_ridge = D_ridge - 2 * (offsetStart + margin_ridge_axis);

        zones.forEach((zone, zIdx) => {
            let effD_slope;
            const total_margin_slope = offsetStart + margin_slope_axis;
            if (tType === 'Monopente') {
                effD_slope = zone.length - 2 * total_margin_slope;
            } else {
                effD_slope = zone.length;
                if (zIdx === 0) effD_slope -= total_margin_slope;
                if (zIdx === zones.length - 1) effD_slope -= total_margin_slope;
            }

            if (effD_slope <= 0 || effD_ridge <= 0) return;

            const effD1 = isXParallelToSlope ? effD_slope : effD_ridge;
            const effD2 = isXParallelToSlope ? effD_ridge : effD_slope;
            let effD1_real = effD1 * (isXParallelToSlope ? zone.factor : 1);
            let effD2_real = effD2 * (isYParallelToSlope ? zone.factor : 1);

            if (dilatationMaxLength > 0 && effD1_real > dilatationMaxLength) {
                const joints = Math.floor(effD1_real / dilatationMaxLength);
                effD1_real -= joints * (dilatationWidth / 1000);
            }
            
            if (effD1_real <= 0 || effD2_real <= 0) return;

            const nx = Math.floor((effD1_real + sx) / (W + sx));
            const ny = Math.floor((effD2_real + sy) / (L + sy));
            totalCount += Math.max(0, nx * ny);
        });
    }
    
    return { count: totalCount, tableCount };
}

export function calculateRectArea(coords) {
    return google.maps.geometry.spherical.computeArea(coords);
}

export function calculateRectPower(count, uPower) {
    return (count * uPower) / 1000;
}