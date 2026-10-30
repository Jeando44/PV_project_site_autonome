/**
 * Logique de calepinage pour les structures inclinées (Sheds)
 */

export function getShedParams() {
    const btnShedYes = document.getElementById('btn-shed-yes');
    if (!btnShedYes || !btnShedYes.classList.contains('btn-primary')) {
        return null;
    }

    const tilt = parseFloat(document.getElementById('shed-inclinaison').value) || 0;
    const pvLarge = parseInt(document.getElementById('shed-pv-large').value) || 0;
    const pvLong = parseInt(document.getElementById('shed-pv-long').value) || 0;
    if (pvLarge <= 0 || pvLong <= 0) {
        return { isRegular: false, tilt: 0, pvLarge: 0, pvLong: 0, spaceLarge: 0, spaceLong: 0, L_proj_factor: 1 };
    }

    let spaceLargeVal = parseFloat(document.getElementById('shed-space-large').value);
    let spaceLongVal = parseFloat(document.getElementById('shed-space-long').value);
    const spaceLarge = (isNaN(spaceLargeVal) ? 2500 : spaceLargeVal) / 1000;
    const spaceLong = (isNaN(spaceLongVal) ? 100 : spaceLongVal) / 1000;
    
    const shedRegulierEl = document.getElementById('shed-regulier');
    const isRegular = shedRegulierEl ? shedRegulierEl.checked : false;

    let L_proj_factor = Math.cos(tilt * Math.PI / 180);
    if (L_proj_factor < 0.1) L_proj_factor = 0.1; // Limite pour éviter une projection nulle

    return { tilt, pvLarge, pvLong, spaceLarge, spaceLong, isRegular, L_proj_factor };
}

export function calculateShedGridRect(effD1, effD2, W, L, sx, sy, params) {
    const { pvLarge, pvLong, spaceLarge, spaceLong, isRegular, L_proj_factor } = params;
    if (pvLarge <= 0 || pvLong <= 0) return { panels: [], tableCount: 0 };
    const L_proj = L * L_proj_factor;

    const Tw = pvLong * W + (pvLong - 1) * sx;
    const Th = pvLarge * L_proj + (pvLarge - 1) * sy;

    const panels = [];
    const tables = new Set();

    const maxIx = Math.ceil(effD1 / W) + 1;
    const maxIy = Math.ceil(effD2 / L_proj) + 1;
    let panelCount = 0;
    
    let minValidX = Infinity, maxValidX = -Infinity;
    let minValidY = Infinity, maxValidY = -Infinity;
    const rawPanels = [];

    for (let ix = 0; ix < maxIx; ix++) {
        for (let iy = 0; iy < maxIy; iy++) {
            if (panelCount > 3000) break; // Sécurité anti-freeze

            const tx = Math.floor(ix / pvLong);
            const ty = Math.floor(iy / pvLarge);
            const cx = ix % pvLong;
            const cy = iy % pvLarge;

            const dx = tx * (Tw + spaceLong) + cx * (W + sx);
            const dy = ty * (Th + spaceLarge) + cy * (L_proj + sy);

            const tEndX = tx * (Tw + spaceLong) + Tw;
            const tEndY = ty * (Th + spaceLarge) + Th;

            let isValid = false;

            if (isRegular) {
                if (tEndX <= effD1 && tEndY <= effD2) isValid = true;
            } else {
                if (dx + W <= effD1 && dy + L_proj <= effD2) isValid = true;
            }

            if (isValid) {
                rawPanels.push({ ix, iy, tx, ty, dx, dy, L_proj });
                tables.add(`${tx}_${ty}`);
                panelCount++;
                if (dx < minValidX) minValidX = dx;
                if (dx + W > maxValidX) maxValidX = dx + W;
                if (dy < minValidY) minValidY = dy;
                if (dy + L_proj > maxValidY) maxValidY = dy + L_proj;
            }
        }
    }

    // Auto-centrage global du bloc de sheds
    if (rawPanels.length > 0) {
        const blocWidth = maxValidX - minValidX;
        const blocHeight = maxValidY - minValidY;
        const centreOffX = Math.max(0, (effD1 - blocWidth) / 2) - minValidX;
        const centreOffY = Math.max(0, (effD2 - blocHeight) / 2) - minValidY;
        
        rawPanels.forEach(p => {
            p.dx += centreOffX;
            p.dy += centreOffY;
            panels.push(p);
        });
    }

    return { panels, tableCount: tables.size };
}

export function calculateShedGridPoly(checkPoly, W, L, sx, sy, params, center, maxDist, headingX, headingY) {
    const { pvLarge, pvLong, spaceLarge, spaceLong, isRegular, L_proj_factor } = params;
    if (pvLarge <= 0 || pvLong <= 0) return { panels: [], tableCount: 0 };
    const L_proj = L * L_proj_factor;

    const Tw = pvLong * W + (pvLong - 1) * sx;
    const Th = pvLarge * L_proj + (pvLarge - 1) * sy;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    const checkPath = checkPoly.getPath().getArray();
    if (checkPath.length === 0) return { panels: [], tableCount: 0 };
    
    checkPath.forEach(p => {
        const dist = google.maps.geometry.spherical.computeDistanceBetween(center, p);
        const heading = google.maps.geometry.spherical.computeHeading(center, p);
        const angle = (heading - headingX) * Math.PI / 180;
        const px = dist * Math.cos(angle);
        const py = dist * Math.sin(angle);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
    });

    const minTx = Math.floor(minX / (Tw + spaceLong)) - 1;
    const maxTx = Math.ceil(maxX / (Tw + spaceLong)) + 1;
    const minTy = Math.floor(minY / (Th + spaceLarge)) - 1;
    const maxTy = Math.ceil(maxY / (Th + spaceLarge)) + 1;

    const tableStatus = {};
    let panelCount = 0; // Sécurité anti-freeze (nombre de panneaux VALIDES trouvés)

    let minValidX = Infinity, maxValidX = -Infinity;
    let minValidY = Infinity, maxValidY = -Infinity;
    const rawPanels = [];

    // CORRECTIF (bug "l'écran se bloque au choix d'un panneau / clic sur Calculer") : l'ancien
    // `if (panelCount > 3000) break;` ne sortait QUE de la boucle `cy` la plus interne — les boucles
    // `cx`/`ty`/`tx` continuaient, et tant que `panelCount` (panneaux VALIDES) restait sous 3000 (ce qui
    // arrive dès qu'une bonne partie de la grille testée tombe hors du polygone — le cas normal), le
    // garde-fou ne se déclenchait jamais : la grille pouvait tester des centaines de milliers de
    // positions (`pvLong` vaut 9999 par défaut tant que "Nb. PV en longueur" n'est pas saisi, cf.
    // ShedPolygon.js), chacune avec 5 computeOffset + 1 interpolate + 5 containsLocation (opérations
    // géodésiques coûteuses), de façon synchrone sur le thread principal — d'où le gel complet de l'onglet.
    // `attempts` compte TOUTES les cellules testées (valides ou non) et un `break` étiqueté sort
    // immédiatement des 4 boucles imbriquées dès qu'une des deux limites est dépassée.
    let attempts = 0;
    const MAX_PANELS = 3000;
    const MAX_ATTEMPTS = 200000;

    gridScan:
    for (let tx = minTx; tx <= maxTx; tx++) {
        for (let ty = minTy; ty <= maxTy; ty++) {

            const tableBaseOx = tx * (Tw + spaceLong);
            const tableBaseOy = ty * (Th + spaceLarge);

            const tKey = `${tx}_${ty}`;
            tableStatus[tKey] = { panels: [], fullyInside: true };

            // CORRECTIF (bug persistant "l'écran se bloque au choix d'un panneau") : le garde-fou
            // attempts/MAX_ATTEMPTS ci-dessous bornait déjà le pire cas, mais restait bien trop coûteux
            // en pratique (pvLong=9999 par défaut tant que "Nb. PV en longueur" n'est pas saisi, cf.
            // ShedPolygon.js). ox/oy croissent strictement avec cx/cy (pas W+sx / L_proj+sy > 0) : pour
            // une table (tx,ty) donnée, aucun panneau ne peut être dans le polygone en dehors de
            // [minX,maxX]x[minY,maxY] (bornes déjà connues, mêmes repères que ox/oy). On calcule donc
            // directement le premier cx/cy dont l'offset atteint minX/minY (au lieu de partir de 0 et
            // gaspiller potentiellement des milliers d'itérations avant d'entrer dans la zone utile),
            // et on sort dès que l'offset dépasse maxX/maxY (plus aucun cx/cy suivant ne peut retomber
            // dans le polygone). Ramène le coût réel à la taille du polygone, quelle que soit la valeur
            // de pvLong/pvLarge.
            const cxStart = Math.max(0, Math.floor((minX - tableBaseOx) / (W + sx)));
            const cyStart = Math.max(0, Math.floor((minY - tableBaseOy) / (L_proj + sy)));

            for (let cx = cxStart; cx < pvLong; cx++) {
                const ox = tableBaseOx + cx * (W + sx);
                if (ox > maxX) break;
                for (let cy = cyStart; cy < pvLarge; cy++) {
                    const oy = tableBaseOy + cy * (L_proj + sy);
                    if (oy > maxY) break;

                    attempts++;
                    if (panelCount > MAX_PANELS || attempts > MAX_ATTEMPTS) break gridScan; // Sécurité anti-freeze (grille anormalement grande malgré les bornes ci-dessus)

                    const absOX = Math.abs(ox), hdgX = ox >= 0 ? headingX : (headingX + 180) % 360;
                    const absOY = Math.abs(oy), hdgY = oy >= 0 ? headingY : (headingY + 180) % 360;

                    // Correction de la distorsion de projection sphérique
                    const rowBase = google.maps.geometry.spherical.computeOffset(center, absOY, hdgY);
                    const pOrig = google.maps.geometry.spherical.computeOffset(rowBase, absOX, hdgX);
                    
                    const pC1 = google.maps.geometry.spherical.computeOffset(pOrig, W, headingX);
                    const pC2 = google.maps.geometry.spherical.computeOffset(pC1, L_proj, headingY);
                    const pC3 = google.maps.geometry.spherical.computeOffset(pOrig, L_proj, headingY);

                    const pCenter = google.maps.geometry.spherical.interpolate(pOrig, pC2, 0.5);

                    const inside = google.maps.geometry.poly.containsLocation(pOrig, checkPoly) &&
                                   google.maps.geometry.poly.containsLocation(pC1, checkPoly) &&
                                   google.maps.geometry.poly.containsLocation(pC2, checkPoly) &&
                                   google.maps.geometry.poly.containsLocation(pC3, checkPoly) &&
                                   google.maps.geometry.poly.containsLocation(pCenter, checkPoly);

                    if (!inside) {
                        tableStatus[tKey].fullyInside = false;
                    } else {
                        const ix = (tx - minTx) * pvLong + cx;
                        const iy = (ty - minTy) * pvLarge + cy;
                        tableStatus[tKey].panels.push({ ix, iy, tx, ty, cx, cy, pOrig, pC1, pC2, pC3, L_proj, ox, oy });
                        panelCount++;
                    }
                }
            }
        }
    }

    const validPanels = [];
    const tables = new Set();

    Object.keys(tableStatus).forEach(tKey => {
        const status = tableStatus[tKey];

        // CORRECTIF (demande explicite : "des sheds terminent avec un seul panneau — toutes les
        // rangées de shed doivent avoir le même nombre de panneaux défini, soit le Nb. PV en
        // largeur") : regroupe les panneaux valides de cette table par colonne (cx, axe along/
        // rampant) et ne garde que les colonnes COMPLÈTES (exactement pvLarge panneaux valides sur
        // l'axe largeur) — une colonne incomplète correspond à un shed avec moins de panneaux que
        // "Nb. PV en largeur" empilés, ce qui ne doit jamais être affiché. Le mode non-régulier
        // acceptait jusqu'ici n'importe quel panneau valide isolé (même une colonne à 1 panneau) ;
        // ce filtre s'applique désormais aussi dans ce mode, pas seulement en mode régulier.
        const countByCx = new Map();
        status.panels.forEach(p => countByCx.set(p.cx, (countByCx.get(p.cx) || 0) + 1));
        const completePanels = status.panels.filter(p => countByCx.get(p.cx) === pvLarge);

        if (isRegular) {
            if (status.fullyInside && completePanels.length === pvLarge * pvLong) {
                completePanels.forEach(p => {
                    rawPanels.push(p);
                    tables.add(tKey);
                    if (p.ox < minValidX) minValidX = p.ox;
                    if (p.ox + W > maxValidX) maxValidX = p.ox + W;
                    if (p.oy < minValidY) minValidY = p.oy;
                    if (p.oy + L_proj > maxValidY) maxValidY = p.oy + L_proj;
                });
            }
        } else {
            if (completePanels.length > 0) {
                completePanels.forEach(p => {
                    rawPanels.push(p);
                    tables.add(tKey);
                    if (p.ox < minValidX) minValidX = p.ox;
                    if (p.ox + W > maxValidX) maxValidX = p.ox + W;
                    if (p.oy < minValidY) minValidY = p.oy;
                    if (p.oy + L_proj > maxValidY) maxValidY = p.oy + L_proj;
                });
            }
        }
    });
    
    if (rawPanels.length > 0) {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        
        const blocWidth = maxValidX - minValidX;
        const blocHeight = maxValidY - minValidY;
        
        const shiftX = cx - (minValidX + blocWidth / 2);
        const shiftY = cy - (minValidY + blocHeight / 2);

        rawPanels.forEach(p => {
            const newOx = p.ox + shiftX;
            const newOy = p.oy + shiftY;

            const absOX = Math.abs(newOx), hdgX = newOx >= 0 ? headingX : (headingX + 180) % 360;
            const absOY = Math.abs(newOy), hdgY = newOy >= 0 ? headingY : (headingY + 180) % 360;
            const rowBase = google.maps.geometry.spherical.computeOffset(center, absOY, hdgY);
            const shiftedOrig = google.maps.geometry.spherical.computeOffset(rowBase, absOX, hdgX);
            const shiftedC1 = google.maps.geometry.spherical.computeOffset(shiftedOrig, W, headingX);
            const shiftedC2 = google.maps.geometry.spherical.computeOffset(shiftedC1, L_proj, headingY);
            const shiftedC3 = google.maps.geometry.spherical.computeOffset(shiftedOrig, L_proj, headingY);
            const shiftedCenter = google.maps.geometry.spherical.interpolate(shiftedOrig, shiftedC2, 0.5);

            // CORRECTIF (panneaux hors polygone en shed) : ce recentrage déplace TOUS les panneaux d'un
            // même vecteur calculé à partir du centre de la BOUNDING BOX du polygone (cx/cy ci-dessus) —
            // pour un polygone non rectangulaire (bbox différente du contour réel, ex. forme en L),
            // ce vecteur n'a aucun rapport avec le contour réel et pouvait faire ressortir un panneau
            // pourtant déjà validé à sa position d'origine, SANS second contrôle. On ne garde donc la
            // position recentrée que si elle reste bien à l'intérieur du polygone réel ; sinon on
            // conserve la position d'origine (p.pOrig/pC1/pC2/pC3, déjà validée lors du scan ci-dessus).
            const stillInside = google.maps.geometry.poly.containsLocation(shiftedOrig, checkPoly) &&
                                 google.maps.geometry.poly.containsLocation(shiftedC1, checkPoly) &&
                                 google.maps.geometry.poly.containsLocation(shiftedC2, checkPoly) &&
                                 google.maps.geometry.poly.containsLocation(shiftedC3, checkPoly) &&
                                 google.maps.geometry.poly.containsLocation(shiftedCenter, checkPoly);

            if (stillInside) {
                p.pOrig = shiftedOrig;
                p.pC1 = shiftedC1;
                p.pC2 = shiftedC2;
                p.pC3 = shiftedC3;
            }

            validPanels.push(p);
        });
    }

    return { panels: validPanels, tableCount: tables.size };
}