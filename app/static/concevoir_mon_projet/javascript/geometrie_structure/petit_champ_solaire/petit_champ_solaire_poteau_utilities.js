// ============================================================================================
// Utilitaires partagés "petit champ solaire" : Limite parcellaire, Orientation façade, renfort
// Double Poteaux
// ============================================================================================
// Fonctions communes à TOUS les modèles de poteaux (Centrés/Excentrés/Double Poteaux/Bipente),
// extraites de petit_champ_solaire.js pour isoler ce qui ne dépend pas du modèle sélectionné.
// (Les Fondations, également communes à tous les modèles, ont leur propre fichier isolé :
// petit_champ_solaire_poteau_fondations.js — demande explicite pour pouvoir les gérer/désactiver
// indépendamment du reste.)
// Patron repris de static/js/ombriere_liasonnee.js (déjà en place dans ce projet) : simples
// déclarations `function` de premier niveau (deviennent globales automatiquement, pas de module),
// recevant `ctx`/`scale`/`values` explicitement en paramètres au lieu de la closure de drawCoupe/
// drawFacade, et s'appuyant sur `appState` (déjà exposé globalement par petit_champ_solaire.js via
// `window.appState`). Doit être chargé AVANT petit_champ_solaire.js.

// --- Petit utilitaire numérique (même implémentation que numOr, dupliquée dans drawCoupe/drawFacade
// et dans petit_champ_solaire_poteau_fondations.js, pour la même raison : pas de closure partagée
// entre fichiers/fonctions distincts). ---
function numOrUtil(val, fallback) {
    const n = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(n) ? n : fallback;
}

// ============================================================================================
// LIMITE PARCELLAIRE (gauche/droite) — plan de coupe et plan de façade. Aucune dépendance au
// modèle de poteaux sélectionné.
// ============================================================================================

// Plan de coupe. `geo` = { parcelPanelCorners, nbShedCount, shedSpacingScaled, topDimY, groundRectDepth }
// (valeurs déjà calculées par drawCoupe, propres à la géométrie de pente/traverse — pas de sens à les
// recalculer ici). Retourne `lineX` (position de la ligne, utile pour ancrer le label d'orientation
// côté gauche) ou `null` si aucune limite n'est saisie pour ce côté.
function drawParcelLimitCoupe(ctx, scale, values, side, geo) {
    const isLeft = side === 'left';
    const limitM = numOrUtil(isLeft ? values.parcelLimitLeftCoupe : values.parcelLimitRightCoupe, 0);
    if (!(limitM > 0)) return null;
    const shedOffset = isLeft ? 0 : (geo.nbShedCount - 1) * geo.shedSpacingScaled;
    const panelEdgeAbsX = (isLeft ? geo.parcelPanelCorners[0].x : geo.parcelPanelCorners[1].x) + shedOffset;
    const limitScaled = limitM * scale;
    const lineX = isLeft ? (panelEdgeAbsX - limitScaled) : (panelEdgeAbsX + limitScaled);
    // La ligne s'arrête juste au-dessus de la cotation "limite de parcelle" (topDimY).
    const lineTopY = geo.topDimY - 0.3 * scale;
    // Même formule que getCoupeGroundY(lineX) dans drawCoupe (recalculée localement, cf. patron
    // ombriere_liasonnee.js — pas de closure partagée entre fichiers).
    const groundSlopeRatioCoupe = (values.facadeLength > 0) ? (-numOrUtil(values.groundSlopeFacade, 0) / values.facadeLength) : 0;
    // Terrain automatique : drawCoupe transmet sa fonction de sol (profil réel) dans geo.solY.
    const lineBottomY = (typeof geo.solY === 'function' ? geo.solY(lineX) : lineX * groundSlopeRatioCoupe) + geo.groundRectDepth;

    if (appState.showParcelLimitDims) {
        ctx.save();
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(lineX, lineBottomY);
        ctx.lineTo(lineX, lineTopY);
        ctx.stroke();

        ctx.fillStyle = '#dc2626';
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelX = isLeft ? lineX - 12 : lineX + 12;
        const labelY = (lineTopY + lineBottomY) / 2;
        ctx.translate(labelX, labelY);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(`Limite parcellaire ${isLeft ? '' : ''}`, 0, 0);
        ctx.restore();
    }

    if (isLeft) {
        drawDimensionLine(ctx, lineX, geo.topDimY, panelEdgeAbsX, geo.topDimY, `${limitM.toFixed(2)}m`, 0, false);
    } else {
        drawDimensionLine(ctx, panelEdgeAbsX, geo.topDimY, lineX, geo.topDimY, `${limitM.toFixed(2)}m`, 0, false);
    }
    return lineX;
}

// Plan de façade. `geo` = { totalGroupsWidthMeters, totalDrawingHeight, groundDepth, facadeFlatTopY,
// facadeDimFontSize }. Retourne `lineX` (utile pour ancrer le label d'orientation côté gauche) ou
// `null` si aucune limite n'est saisie pour ce côté.
function drawParcelLimitFacade(ctx, scale, values, side, geo) {
    const isLeft = side === 'left';
    const limitM = numOrUtil(isLeft ? values.parcelLimitLeftFacade : values.parcelLimitRightFacade, 0);
    if (!(limitM > 0)) return null;

    // Même formule que getScaledGroundY dans drawFacade (recalculée localement).
    const facadeLength = values.facadeLength;
    const groundSlopeFacade = values.facadeGroundSlope;
    const getScaledGroundY = (xAbsScaled) => (facadeLength > 0 ? (xAbsScaled / (facadeLength * scale)) * (-groundSlopeFacade * scale) : 0);

    const totalWidthScaled = geo.totalGroupsWidthMeters * scale;
    const edgeX = isLeft ? 0 : totalWidthScaled;
    const limitScaled = limitM * scale;
    const lineX = isLeft ? edgeX - limitScaled : edgeX + limitScaled;

    const lineTopY = -geo.totalDrawingHeight * scale / 2;
    const lineBottomY = getScaledGroundY(lineX) + geo.groundDepth;

    if (appState.showParcelLimitDims) {
        ctx.save();
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(lineX, lineBottomY);
        ctx.lineTo(lineX, lineTopY);
        ctx.stroke();

        ctx.fillStyle = '#dc2626';
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelX = isLeft ? lineX - 12 : lineX + 12;
        const labelY = (lineTopY + getScaledGroundY(lineX)) / 2;
        ctx.translate(labelX, labelY);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(`Limite parcellaire`, 0, 0);
        ctx.restore();
    }

    const dimY = geo.facadeFlatTopY - 60;
    drawDimensionLine(ctx, isLeft ? lineX : edgeX, dimY, isLeft ? edgeX : lineX, dimY, `${limitM.toFixed(2)}m`, 0, false, geo.facadeDimFontSize);
    return lineX;
}

// ============================================================================================
// ORIENTATION FAÇADE — libellé dessiné sur le plan de coupe et sur le plan de façade.
// ============================================================================================

// Plan de coupe : `geo` = { angle, cosA, sinA, beamCenterY, panelY, beamLengthScaled, beamOffsetScaled }.
function drawCoupeOrientationLabel(ctx, scale, values, geo, facadeLabelAnchorX) {
    let currentOrientation = appState.coupeOrientation;
    if (appState.invertSlope) {
        const opposite = { 'Est': 'Ouest', 'Ouest': 'Est', 'Nord': 'Sud', 'Sud': 'Nord' };
        currentOrientation = opposite[currentOrientation];
    }
    const orientationText = `Façade ${currentOrientation}`;

    let labelX = 0, labelY = 0;
    if (appState.postModel === 'y_shape' || appState.postModel === 'doubleYShape') {
        labelX = 0;
        labelY = geo.beamCenterY + geo.panelY - 15;
    } else {
        const oL_dim = (values.overhangL || 0) * scale;
        const oH_dim = (values.overhangH || 0) * scale;
        const eaveOnRight_dim = Math.sin(geo.angle) >= 0;
        const oLeft_dim = eaveOnRight_dim ? oH_dim : oL_dim;
        const oRight_dim = eaveOnRight_dim ? oL_dim : oH_dim;
        const corners = [
            { x: -geo.beamLengthScaled / 2 - oLeft_dim, y: geo.panelY },
            { x: geo.beamLengthScaled / 2 + oRight_dim, y: geo.panelY }
        ].map(p => ({
            x: p.x * geo.cosA - p.y * geo.sinA + geo.beamOffsetScaled,
            y: geo.beamCenterY + p.x * geo.sinA + p.y * geo.cosA
        }));
        const highestPt = corners.reduce((min, p) => p.y < min.y ? p : min, corners[0]);
        labelX = highestPt.x;
        labelY = highestPt.y - 15;
    }

    ctx.save();
    ctx.fillStyle = '#4b5563';
    ctx.font = 'bold 12px Arial';
    if (facadeLabelAnchorX !== null) {
        ctx.textAlign = 'left';
        ctx.fillText(orientationText, facadeLabelAnchorX + 16, labelY);
    } else {
        ctx.textAlign = 'center';
        ctx.fillText(orientationText, labelX, labelY);
    }
    ctx.restore();
}

// Plan de façade : un seul label, ancré à droite de la ligne "Limite parcellaire gauche" si elle
// existe (repli sur le bord gauche du dessin sinon).
function drawFacadeOrientationLabel(ctx, values, facadeFlatTopY, facadeLabelAnchorX) {
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const facadeOrientationLabelX = (facadeLabelAnchorX !== null ? facadeLabelAnchorX : 0) + 16;
    ctx.fillText(`Façade ${appState.facadeOrientation}`, facadeOrientationLabelX, facadeFlatTopY - 10);
    ctx.restore();
}

// ============================================================================================
// DOUBLE POTEAUX — primitif de dessin du bracon, partagé par V1/V3/V4 (V2 n'en dessine pas). Reste
// ici plutôt que dupliqué dans les fichiers V1_V2/V3_V4 : aucune branche par variante à part le cas
// mort V6 (bouton déjà retiré de l'IHM), conservé tel quel.
// ============================================================================================
function drawDoublePostReinforcement(ctx, scale, start, end, postWidthScaled, values, isV2Inner = false) {
    if (!start || !end) return;

    if (appState.reinforcementType === 'jarrets') {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
        return; // Ne pas dessiner le rectangle
    }

    let braceWidthScaled;
    if (appState.doublePostBracing === 'v6') {
        braceWidthScaled = values.postWidth * scale; // Épaisseur poteau
    } else {
        braceWidthScaled = values.braceWidth * scale; // Épaisseur bracon par défaut
    }

    // Prolongement du bracon de 5cm pour V1/V3/V4
    if (['v1', 'v3', 'v4'].includes(appState.doublePostBracing)) {
        const angleBrace = Math.atan2(end.y - start.y, end.x - start.x);
        const extension = 0.05 * scale;
        end.x += extension * Math.cos(angleBrace);
        end.y += extension * Math.sin(angleBrace);
    }

    // Barre RECTANGULAIRE (angles en extrémités à 90°) entre start et end, de largeur
    // braceWidthScaled, bouts perpendiculaires à l'axe du bracon.
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const perpAngle = angle + Math.PI / 2;
    const halfW = braceWidthScaled / 2;
    const cosP = Math.cos(perpAngle), sinP = Math.sin(perpAngle);

    const p1 = { x: start.x + halfW * cosP, y: start.y + halfW * sinP };
    const p2 = { x: end.x + halfW * cosP, y: end.y + halfW * sinP };
    const p3 = { x: end.x - halfW * cosP, y: end.y - halfW * sinP };
    const p4 = { x: start.x - halfW * cosP, y: start.y - halfW * sinP };

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
}
