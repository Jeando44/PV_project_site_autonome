// ============================================================================================
// Modèle "Double Poteaux" — variantes de contreventement V1 (barre + bracon prolongé) et V2
// (aucun contreventement).
// ============================================================================================
// Extrait de petit_champ_solaire.js. drawDoublePostReinforcementSetV1V2 reçoit en paramètre `geo`
// (calculé par drawTheReinforcements dans le fichier principal, cf. dispatcher) : la géométrie de
// traverse déjà calculée (beamIntersectLine/beamBottomLine/beamCenterY/...) — recalculer cette
// géométrie ici aurait dupliqué une bonne partie de la logique de pente/traverse de drawCoupe,
// contrairement au préambule ci-dessous (spacing/hauteur de bracon/poteau le plus haut), volontairement
// dupliqué avec petit_champ_solaire_poteau_Double poteaux_V3_V4 .js (cf. plan). S'appuie sur
// window.intersect et window.drawDoublePostReinforcement (exposés respectivement par
// petit_champ_solaire.js et petit_champ_solaire_poteau_utilities.js). Doit être chargé APRÈS
// petit_champ_solaire_poteau_utilities.js.

// V1 uniquement : la barre de liaison horizontale entre les 2 poteaux. Code mort V6 (bouton déjà
// retiré de l'IHM) conservé tel quel.
function drawDoublePostBracingBar(ctx, scale, heightUnderBrace, p1, p2, postWidthScaled, values) {
    if (!p1 || !p2) return;

    if (appState.reinforcementType === 'jarrets') {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        return; // Ne pas dessiner le rectangle
    }

    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const perpAngle = angle + Math.PI / 2;

    let halfW = (values.braceWidth * scale) / 2;

    // CORRECTION V6: La barre horizontale remonte au niveau de la jonction des poteaux
    if (appState.doublePostBracing === 'v6') {
        const braceHeight = -heightUnderBrace * scale;
        p1 = { x: p1.x, y: braceHeight };
        p2 = { x: p2.x, y: braceHeight };
    }

    const c1 = { x: p1.x + halfW * Math.cos(perpAngle), y: p1.y + halfW * Math.sin(perpAngle) };
    const c2 = { x: p2.x + halfW * Math.cos(perpAngle), y: p2.y + halfW * Math.sin(perpAngle) };
    const c3 = { x: p2.x - halfW * Math.cos(perpAngle), y: p2.y - halfW * Math.sin(perpAngle) };
    const c4 = { x: p1.x - halfW * Math.cos(perpAngle), y: p1.y - halfW * Math.sin(perpAngle) };

    // Dessin précis
    ctx.beginPath();
    ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
}

function drawDoublePostReinforcementSetV1V2(ctx, scale, postWidthScaled, values, geo) {
    ctx.fillStyle = '#f3f4f6'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
    const spacing = geo.postSpacing * scale / 2;
    const braceHeight = -geo.heightUnderBrace * scale;

    // FIX (Alignement toiture coché) : chaque poteau touche son propre sol local — les points
    // d'accroche du contreventement (pieds de poteaux, barre de liaison) doivent suivre le même
    // niveau, sinon le renfort semble décroché du poteau.
    // CORRIGÉ (fondation béton "Sur le sol") : même décalage que dans petit_champ_solaire.js
    // (postBottomY) — le pied du poteau est remonté au-dessus du plot/longrine plutôt que de rester
    // au niveau du sol, sinon les points d'accroche du contreventement traversent visuellement la
    // fondation.
    let foundationOffsetScaled = 0;
    if (appState.showFoundation && appState.anchorSystem === 'beton' && appState.foundationPosition === 'surface') {
        foundationOffsetScaled = -numOrFondations(values.foundationDepth, 0.5) * scale;
    }
    const leftGroundOffset = (geo.coupeAlignRoofOn ? geo.getCoupeGroundY(-spacing) : 0) + foundationOffsetScaled;
    const rightGroundOffset = (geo.coupeAlignRoofOn ? geo.getCoupeGroundY(spacing) : 0) + foundationOffsetScaled;

    // Détermine quel poteau (gauche ou droit) est le plus haut, via l'intersection réelle de chacun
    // avec la traverse (dépend du sens de la pente / invertSlope, donc non fixe).
    const postLineLeft = { p1: { x: -spacing, y: leftGroundOffset }, p2: { x: -spacing, y: -geo.lineLength } };
    const postLineRight = { p1: { x: spacing, y: rightGroundOffset }, p2: { x: spacing, y: -geo.lineLength } };
    const topLeft = intersect(postLineLeft.p1, postLineLeft.p2, geo.beamIntersectLine.p1, geo.beamIntersectLine.p2);
    const topRight = intersect(postLineRight.p1, postLineRight.p2, geo.beamIntersectLine.p1, geo.beamIntersectLine.p2);
    const leftIsTaller = !!(topLeft && topRight && topLeft.y < topRight.y);

    // Points de départ sur le bord intérieur des poteaux (barre de liaison horizontale)
    const p_start_left = { x: -spacing + postWidthScaled / 2, y: braceHeight + leftGroundOffset };
    const p_start_right = { x: spacing - postWidthScaled / 2, y: braceHeight + rightGroundOffset };
    // Points de départ sur le bord extérieur des poteaux (bracons)
    const p_outer_start_left = { x: -spacing - postWidthScaled / 2, y: braceHeight + leftGroundOffset };
    const p_outer_start_right = { x: spacing + postWidthScaled / 2, y: braceHeight + rightGroundOffset };
    const p_outer_start_tall = leftIsTaller ? p_outer_start_left : p_outer_start_right;

    // Point milieu (bas) de la traverse, cible du bracon conservé en V1.
    const beamBottomCenter_untrimmed = { x: geo.beamOffsetScaled, y: geo.beamCenterY + geo.beamHeightScaled / 2 * geo.cosA };

    if (appState.doublePostBracing === 'v1') {
        // V1 : barre de liaison horizontale conservée ; le bracon du petit poteau est supprimé, seul
        // celui du poteau le plus haut est conservé, réorienté vers le milieu de la traverse (au lieu
        // du point braceFixPercentage près du bord). Le bracon est dessiné APRÈS la barre pour
        // apparaître par-dessus. Il est prolongé.
        drawDoublePostBracingBar(ctx, scale, geo.heightUnderBrace, p_start_left, p_start_right, postWidthScaled, values);
        const p_end_tall = intersect(p_outer_start_tall, beamBottomCenter_untrimmed, geo.beamBottomLine.p1, geo.beamBottomLine.p2);
        drawDoublePostReinforcement(ctx, scale, p_outer_start_tall, p_end_tall, postWidthScaled, values);
    }
    // V2 : aucun contreventement (ni barre, ni bracon) — rien à dessiner.
}

document.addEventListener('DOMContentLoaded', () => {
    ['bracingV1', 'bracingV2'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        // Conserve le doublon de registration pré-existant (harmless, cf.
        // petit_champ_solaire_poteau_Double poteaux_V3_V4 .js pour V3/V4).
        for (let i = 0; i < 2; i++) {
            btn.addEventListener('click', e => {
                const shared = window.__petitChampSolaireModelSwitch;
                appState.doublePostBracing = e.currentTarget.id.replace('bracing', '').toLowerCase();
                const group = document.querySelectorAll('#bracing-variant-group button');
                if (shared) {
                    shared.setupToggleButton(e.currentTarget, group);
                    shared.scheduleUpdate();
                } else if (typeof setupToggleButton === 'function') {
                    setupToggleButton(e.currentTarget, group);
                    if (typeof scheduleUpdate === 'function') scheduleUpdate();
                }
            });
        }
    });
});
