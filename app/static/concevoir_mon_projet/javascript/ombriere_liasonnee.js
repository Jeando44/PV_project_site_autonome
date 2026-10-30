/**
 * ombriere_liasonnee.js
 * Logique de dessin et de calcul pour le modèle "Poteaux centrés liaisonnés".
 */

// Rotation (angle) + translation (cx, cy) d'un point exprimé dans le repère local de la traverse.
function transform_pt(pt, angle, cx, cy) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return { x: cx + pt.x * cos - pt.y * sin, y: cy + pt.x * sin + pt.y * cos };
}

// Largeur projetée au sol d'une ombrière (panneau), utilisée comme entraxe minimal anti-chevauchement.
function getMinLinkedSpacing(values) {
    const roofSlopeRadians = (values.roofSlope || 0) * Math.PI / 180;
    return (values.panelWidth || 0) * Math.cos(Math.abs(roofSlopeRadians));
}

// Vérifie que l'entraxe saisi ne provoque pas de chevauchement entre deux ombrières liaisonnées.
function validateLinkedSpacing(values) {
    const minSpacing = getMinLinkedSpacing(values);
    const spacing = values.postSpacing || 0;
    const valid = spacing > minSpacing;
    return {
        valid,
        minSpacing,
        message: valid ? '' : `Entraxe invalide : ${spacing.toFixed(2)} m doit être strictement supérieur à la largeur projetée d'une ombrière (${minSpacing.toFixed(2)} m) pour éviter un chevauchement.`
    };
}

function drawOmbriereLiasonee(ctx, values, scale, angle, cosA, sinA) {
    const {
        linkedPanelsCount = 2,
        postSpacing = 15.0,
        postHeight = 0,
        beamHeight = 0.2,
        postWidth = 0.4,
        beamLength = 0,
        heightUnderBrace = 2.0,
        overhangL = 0
    } = values;

    const panelCount = Math.max(2, linkedPanelsCount);
    // Sécurité anti-chevauchement : ne jamais dessiner en dessous de l'entraxe minimal, même si la validation amont a échoué.
    const minSpacing = getMinLinkedSpacing(values);
    const safePostSpacing = postSpacing > minSpacing ? postSpacing : minSpacing + 0.01;
    const spacing = safePostSpacing * scale;
    const totalWidth = (panelCount - 1) * spacing;
    const startX = -totalWidth / 2;

    const postWidthScaled = postWidth * scale;
    const beamHeightScaled = beamHeight * scale;
    const beamLengthScaled = beamLength * scale;
    const postHeightScaled = postHeight * scale;

    // Le centre Y de la traverse est le même pour toutes les structures
    const beamCenterY = (appState.traversePosition === 'top') ? -postHeightScaled - beamHeightScaled / 2 : -postHeightScaled;

    // Prolongement de traverse pour atteindre l'aplomb du bord de toiture côté égout (à partir de la 2e
    // ombrière). Le côté égout (gauche ou droite selon la pente/l'inversion) est déterminé par le signe de
    // sin(angle), même convention que "offsetPostSide === 'low'" utilisée ailleurs dans l'application.
    const eaveExtensionScaled = overhangL * scale;
    const eaveOnRight = Math.sin(angle) >= 0;

    // Sauvegarder les points de liaison
    const linkPoints = [];

    // Étape 4: Boucle pour dessiner chaque ombrière
    for (let i = 0; i < panelCount; i++) {
        const currentX = startX + i * spacing;
        ctx.save();
        ctx.translate(currentX, 0);

        // --- Dessin d'une structure "poteau centré" ---
        // 1. Poteau
        const postTopY = (appState.traversePosition === 'top') ? -postHeightScaled - beamHeightScaled : -postHeightScaled;
        ctx.fillStyle = '#f3f4f6';
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-postWidthScaled / 2, postTopY, postWidthScaled, -postTopY);
        ctx.strokeRect(-postWidthScaled / 2, postTopY, postWidthScaled, -postTopY);
        if (appState.showFoundation && typeof drawFoundation === 'function') {
            drawFoundation(0);
        }

        // 2. Renforts (bracons/jarrets) — emplacement inchangé, quel que soit le prolongement de traverse.
        if (appState.reinforcementType === 'jarrets' ? postHeight > 0.35 : postHeight > heightUnderBrace) {
            drawReinforcement('left', 0, values);
            drawReinforcement('right', 0, values);
        }

        // 3. Toiture : à partir de la 2e ombrière (i >= 1), la traverse est prolongée côté égout pour
        // arriver à l'aplomb du bord de toiture existant. Pannes, bracons, poteau et toiture elle-même
        // ne bougent pas : seule la traverse s'allonge.
        drawRoofStructure(angle, 0, beamCenterY, false, i >= 1 ? eaveExtensionScaled : 0);

        // 4. Sauvegarde des points pour la liaison
        linkPoints.push({ center: { x: currentX, y: beamCenterY } });

        ctx.restore();
    }

    // Étape 5: Ajout des traverses de liaison
    // La jonction doit se faire exactement sur les 2 lignes (haute et basse) de la traverse,
    // pas sur la panne : on relie donc les coins haut/bas de la traverse de fin de panneau i
    // aux coins haut/bas de la traverse de début de panneau i+1. Le bord côté égout d'une ombrière i+1
    // (toujours >= 1 ici) — ou celui de l'ombrière i quand i >= 1 — a été prolongé à l'étape 4 ; on adapte
    // donc la longueur de la traverse de liaison en conséquence pour qu'elle se fixe sur les extrémités réelles.
    ctx.fillStyle = '#f3f4f6';
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < panelCount - 1; i++) {
        const rightEdgeExtension = (eaveOnRight && i >= 1) ? eaveExtensionScaled : 0;
        const leftEdgeExtension = eaveOnRight ? 0 : eaveExtensionScaled; // i + 1 vaut toujours au moins 1 ici

        const p1_top = transform_pt({ x: beamLengthScaled / 2 + rightEdgeExtension, y: -beamHeightScaled / 2 }, angle, linkPoints[i].center.x, linkPoints[i].center.y);
        const p1_bottom = transform_pt({ x: beamLengthScaled / 2 + rightEdgeExtension, y: beamHeightScaled / 2 }, angle, linkPoints[i].center.x, linkPoints[i].center.y);
        const p2_top = transform_pt({ x: -beamLengthScaled / 2 - leftEdgeExtension, y: -beamHeightScaled / 2 }, angle, linkPoints[i + 1].center.x, linkPoints[i + 1].center.y);
        const p2_bottom = transform_pt({ x: -beamLengthScaled / 2 - leftEdgeExtension, y: beamHeightScaled / 2 }, angle, linkPoints[i + 1].center.x, linkPoints[i + 1].center.y);

        ctx.beginPath();
        ctx.moveTo(p1_top.x, p1_top.y);
        ctx.lineTo(p2_top.x, p2_top.y);
        ctx.lineTo(p2_bottom.x, p2_bottom.y);
        ctx.lineTo(p1_bottom.x, p1_bottom.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    // Les cotations (standard + entraxe) sont rejouées par drawCoupe APRÈS la hachure de sol,
    // pour rester au premier plan comme sur les autres modèles ; on lui renvoie donc les points nécessaires.
    return { linkPoints, safePostSpacing };
}

// Cotation de l'entraxe entre chaque paire de poteaux consécutifs (appelée par drawCoupe après la hachure de sol).
function drawLinkedEntraxeDimensions(ctx, linkPoints, postSpacingValue, scale) {
    if (typeof drawDimensionLine !== 'function') return;
    const entraxeDimY = 1.6 * scale;
    for (let i = 0; i < linkPoints.length - 1; i++) {
        drawDimensionLine(ctx, linkPoints[i].center.x, entraxeDimY, linkPoints[i + 1].center.x, entraxeDimY, `${postSpacingValue.toFixed(2)}m`, 0, false);
    }
}

/**
 * Modèle "Double toiture Y" : N structures "Toiture Y" identiques, chaînées à l'entraxe saisi par
 * l'utilisateur (values.postSpacing, champ "Entraxe (m)"). Les bras côté jonction (qui font face à un
 * poteau voisin) sont étirés jusqu'au point milieu entre les 2 poteaux (traverse + toiture, alignées —
 * cf. drawRoofStructure : sans porte-à-faux ajouté sur ces bras-là). Les bras côté extérieur (sans
 * voisin, aux 2 bouts de la chaîne) restent standards avec leur porte-à-faux normal.
 */
function drawDoubleYShapeOmbriere(ctx, values, scale, angle, cosA, sinA) {
    const {
        doubleYShapePanelsCount = 2,
        postSpacing = 0,
        postHeight = 0,
        beamHeight = 0.2,
        postWidth = 0.4,
        heightUnderBrace = 2.0,
        roofSlope = 0
    } = values;

    const invert = appState.invertSlope;
    const roofSlopeRadians = Math.abs(roofSlope) * Math.PI / 180;

    // Même convention que drawRoofStructure/drawReinforcement : "Bras 1" (= côté 'left') a pour angle
    // roofSlopeRadians*(invert?-1:1) ; "Bras 2" (= côté 'right') en est l'opposé. Dans drawRoofStructure,
    // un angle local positif correspond toujours au bras gauche (démarre au bord gauche du poteau et
    // s'étend vers la gauche) ; un angle négatif au bras droit.
    const armAngleA = roofSlopeRadians * (invert ? -1 : 1);
    const armAngleB = -armAngleA;
    const armAngleLeft = armAngleA > 0 ? armAngleA : armAngleB;
    const armAngleRight = armAngleA > 0 ? armAngleB : armAngleA;

    const postHeightScaled = postHeight * scale;
    const beamHeightScaled = beamHeight * scale;
    const postWidthScaled = postWidth * scale;

    // Formule identique à celle de drawCoupe pour le modèle "y_shape".
    const cosA_Y = Math.cos(roofSlopeRadians);
    const beamCenterY = -postHeightScaled + (beamHeightScaled / 2) * cosA_Y;

    const panelCount = Math.max(2, doubleYShapePanelsCount);
    const spacing = postSpacing * scale;
    const totalWidth = (panelCount - 1) * spacing;
    const startX = -totalWidth / 2;

    // Longueur (le long de la pente) d'un bras de jonction : il doit couvrir, horizontalement, la moitié
    // de la distance entre les bords en vis-à-vis des 2 poteaux (spacing - largeur poteau), pour que les
    // 2 bras adjacents se rejoignent pile au point milieu, sans écart ni chevauchement.
    const innerArmLengthScaled = Math.max(0, (spacing - postWidthScaled) / 2) / cosA_Y;

    const postPositions = [];

    for (let i = 0; i < panelCount; i++) {
        const currentX = startX + i * spacing;
        postPositions.push(currentX);
        ctx.save();
        ctx.translate(currentX, 0);

        // Poteau (identique au modèle "Toiture Y")
        const postTopY = -postHeightScaled;
        ctx.fillStyle = '#f3f4f6';
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-postWidthScaled / 2, postTopY, postWidthScaled, -postTopY);
        ctx.strokeRect(-postWidthScaled / 2, postTopY, postWidthScaled, -postTopY);
        if (appState.showFoundation && typeof drawFoundation === 'function') {
            drawFoundation(0);
        }

        // Renforts (bracons/jarrets) : comme "Toiture Y", toujours les deux côtés, longueur standard.
        if (appState.reinforcementType === 'jarrets' ? postHeight > 0.35 : postHeight > heightUnderBrace) {
            drawReinforcement('left', 0, values);
            drawReinforcement('right', 0, values);
        }

        // Toiture : le bras qui fait face à un poteau voisin est étiré jusqu'au point milieu (traverse et
        // toiture alignées, sans porte-à-faux) ; le bras côté extérieur (sans voisin) reste standard avec
        // son porte-à-faux normal.
        const hasLeftNeighbor = i > 0;
        const hasRightNeighbor = i < panelCount - 1;
        drawRoofStructure(armAngleLeft, 0, beamCenterY, true, 0, hasLeftNeighbor ? innerArmLengthScaled : null);
        drawRoofStructure(armAngleRight, 0, beamCenterY, true, 0, hasRightNeighbor ? innerArmLengthScaled : null);

        ctx.restore();
    }

    return { postPositions };
}