// ============================================================================================
// Fondations (Béton / Vis / Micropieux) — plan de coupe uniquement, aucune dépendance au modèle de
// poteaux sélectionné (appState.postModel).
// ============================================================================================
// Fichier isolé à la demande explicite : peut être désactivé indépendamment des autres fichiers
// (cf. petit_champ_solaire_poteau_utilities.js pour Limite parcellaire/Orientation/renfort Double
// Poteaux, qui restent séparés). Patron repris de static/js/ombriere_liasonnee.js : simples
// déclarations `function` de premier niveau (deviennent globales automatiquement, pas de module),
// recevant `ctx`/`scale`/`values` explicitement en paramètres, et s'appuyant sur `appState` (déjà
// exposé globalement par petit_champ_solaire.js via `window.appState`). Doit être chargé AVANT
// petit_champ_solaire.js.

// Petit utilitaire numérique dupliqué ici volontairement (même implémentation que numOr/numOrUtil
// ailleurs dans l'app) pour que ce fichier reste autonome, sans dépendre de l'ordre de chargement
// par rapport à petit_champ_solaire_poteau_utilities.js.
function numOrFondations(val, fallback) {
    const n = typeof val === 'number' ? val : parseFloat(val);
    return Number.isFinite(n) ? n : fallback;
}

// Béton : plot individuel (1P-Ancrage) ou longrine partagée (DP-Ancrage, lengthOverride = entraxe +
// débords, cf. computeDPFoundationLength). Position "Sur le sol" : le bloc est posé SUR le terrain
// (dessiné au-dessus de la ligne de sol, Y=0..-profondeur, poteau par-dessus). Position "Enterré(e)" :
// le bloc est abaissé sous la ligne de sol, son dessus démarrant au "Niveau d'ancrage" saisi
// (#foundationBuryLevel, 0.30m par défaut) au lieu de démarrer pile à Y=0.
function drawFoundationBeton(ctx, scale, values, postCenterX, lengthOverride) {
    ctx.save();
    const lengthM = (lengthOverride !== undefined && lengthOverride > 0) ? lengthOverride : numOrFondations(values.foundationLength, 2.0);
    const depthM = numOrFondations(values.foundationDepth, 0.5);
    const lengthScaled = lengthM * scale;
    const depthScaled = depthM * scale;
    const isBuried = appState.foundationPosition === 'enterre';
    const buryLevelScaled = numOrFondations(values.foundationBuryLevel, 0.3) * scale;
    const topY = isBuried ? buryLevelScaled : -depthScaled;
    ctx.fillStyle = '#9ca3af';
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 0.9; // Trait allégé (demande explicite, fondations)
    ctx.fillRect(postCenterX - lengthScaled / 2, topY, lengthScaled, depthScaled);
    ctx.strokeRect(postCenterX - lengthScaled / 2, topY, lengthScaled, depthScaled);
    ctx.restore();
}

// Vis de fondation : tige verticale descendant sur "visDepth", avec un pas de vis (hélice) dessiné à
// son extrémité inférieure. Toujours enterrée, SAUF la variante "avec renfort" (#visReinforced) qui
// peut être basculée "Enterré(e)" (défaut, comportement inchangé) ou "Sur le sol" (#vis-position-group)
// : dans ce dernier cas, la tige est remontée au-dessus du sol (même logique de topY que le cas béton
// standard), les jambes de force restant ancrées au sol jusqu'au poteau.
function drawFoundationVis(ctx, scale, values, postCenterX) {
    ctx.save();
    const depthM = numOrFondations(values.visDepth, 1.0);
    const depthScaled = Math.max(1, depthM * scale);
    const shaftWidth = Math.max(4, 0.08 * scale);
    const isSurfaceReinforced = appState.visReinforced && appState.visPosition === 'surface';
    const topY = isSurfaceReinforced ? -depthScaled : 0;
    ctx.fillStyle = '#9ca3af';
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 0.9; // Trait allégé (demande explicite, fondations)
    ctx.fillRect(postCenterX - shaftWidth / 2, topY, shaftWidth, depthScaled);
    ctx.strokeRect(postCenterX - shaftWidth / 2, topY, shaftWidth, depthScaled);

    // Pas de vis : zigzag régulier sur le dernier tiers de la profondeur, plus large que la tige.
    const threadSegments = 5;
    const threadHeight = Math.min(depthScaled * 0.4, 0.35 * scale);
    const threadStartY = topY + depthScaled - threadHeight;
    const threadHalfWidth = shaftWidth * 1.3;
    ctx.beginPath();
    for (let i = 0; i <= threadSegments; i++) {
        const y = threadStartY + (i / threadSegments) * threadHeight;
        const x = postCenterX + (i % 2 === 0 ? -threadHalfWidth : threadHalfWidth);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (appState.visReinforced) drawAnchorReinforcementLegs(ctx, scale, postCenterX);
    ctx.restore();
}

// Micropieu : tige verticale similaire à la vis (toujours enterrée, même profondeur "visDepth"), mais
// SANS pas de vis — remplacé par une plaque d'appui plate à l'extrémité inférieure (patte d'ancrage),
// la distinction visuelle usuelle entre un micropieu battu/foré et une vis à hélice. Plaque masquable
// (#micropieuShowPlate). Partage la même variante "avec renfort" que la vis (toujours enterrée pour le
// micropieu : pas de bascule sol/enterré ici).
function drawFoundationMicropieu(ctx, scale, values, postCenterX) {
    ctx.save();
    const depthM = numOrFondations(values.visDepth, 1.0);
    const depthScaled = Math.max(1, depthM * scale);
    const shaftWidth = Math.max(4, 0.08 * scale);
    ctx.fillStyle = '#9ca3af';
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 0.9; // Trait allégé (demande explicite, fondations)
    ctx.fillRect(postCenterX - shaftWidth / 2, 0, shaftWidth, depthScaled);
    ctx.strokeRect(postCenterX - shaftWidth / 2, 0, shaftWidth, depthScaled);

    if (appState.micropieuShowPlate) {
        // Plaque d'appui (semelle) à l'extrémité inférieure, plus large que la tige.
        const plateWidth = shaftWidth * 2.2;
        const plateHeight = Math.max(2, 0.05 * scale);
        ctx.fillRect(postCenterX - plateWidth / 2, depthScaled - plateHeight, plateWidth, plateHeight);
        ctx.strokeRect(postCenterX - plateWidth / 2, depthScaled - plateHeight, plateWidth, plateHeight);
    }

    if (appState.visReinforced) drawAnchorReinforcementLegs(ctx, scale, postCenterX);
    ctx.restore();
}

// Jambes de force diagonales (vis/micropieu "avec renfort") : du sol jusqu'à un point sur la partie
// hors-sol du poteau. Factorisé (identique pour vis et micropieu).
function drawAnchorReinforcementLegs(ctx, scale, postCenterX) {
    const legDepth = 0.4 * scale; // Profondeur d'ancrage de la jambe de force
    const legSpread = 0.5 * scale;
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.2; // Trait allégé (demande explicite, fondations)
    [-1, 1].forEach(sign => {
        ctx.beginPath();
        ctx.moveTo(postCenterX, 0); // Départ à la base du poteau, au niveau du sol
        ctx.lineTo(postCenterX + sign * legSpread, legDepth); // Arrivée en diagonale sous le sol
        ctx.stroke();
    });
}

// Longueur réelle de la longrine DP-Ancrage : entraxe entre les 2 poteaux + débord de chaque côté
// (cf. demande explicite : entraxe 2m + 2x0.3m de débord = 2.6m).
function computeDPFoundationLength(values) {
    return numOrFondations(values.postSpacing, 0) + 2 * numOrFondations(values.foundationOverhang, 0);
}

// Dispatcher unique appelé depuis drawThePosts (petit_champ_solaire.js) : bascule entre
// Béton/Vis/Micropieux selon appState.anchorSystem. lengthOverride (optionnel) : longueur de longrine
// DP-Ancrage, ignoré en mode Vis/Micropieux (chaque poteau garde son propre ancrage, pas de longrine
// partagée).
function drawAnchor(ctx, scale, values, postCenterX, lengthOverride) {
    if (appState.anchorSystem === 'vis') {
        drawFoundationVis(ctx, scale, values, postCenterX);
    } else if (appState.anchorSystem === 'micropieu') {
        drawFoundationMicropieu(ctx, scale, values, postCenterX);
    } else {
        drawFoundationBeton(ctx, scale, values, postCenterX, lengthOverride);
    }
}

// Ordre de dessin poteau/fondation : par défaut la fondation est dessinée AVANT le poteau (poteau au
// premier plan). Exception demandée : le plot béton "Sur le sol" doit au contraire apparaître DEVANT
// le poteau (dessiné après), car il s'agit d'un massif de surface qui vient envelopper visuellement le
// pied du poteau plutôt que l'inverse.
function isAnchorInFrontOfPost() {
    return appState.anchorSystem === 'beton' && appState.foundationPosition === 'surface';
}
function drawAnchorBehindPost(ctx, scale, values, postCenterX, lengthOverride) {
    if (appState.showFoundation && !isAnchorInFrontOfPost()) drawAnchor(ctx, scale, values, postCenterX, lengthOverride);
}
function drawAnchorInFrontOfPost(ctx, scale, values, postCenterX, lengthOverride) {
    if (appState.showFoundation && isAnchorInFrontOfPost()) drawAnchor(ctx, scale, values, postCenterX, lengthOverride);
}
