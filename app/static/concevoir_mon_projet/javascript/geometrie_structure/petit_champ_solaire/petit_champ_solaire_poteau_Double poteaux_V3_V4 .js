// ============================================================================================
// Modèle "Double Poteaux" — variantes de contreventement V3 (bracon simple) et V4 (contreventement
// en W).
// ============================================================================================
// Extrait de petit_champ_solaire.js. drawDoublePostReinforcementSetV3V4 reçoit en paramètre `geo`
// (calculé par drawTheReinforcements dans le fichier principal, cf. dispatcher) : la géométrie de
// traverse déjà calculée (beamIntersectLine/beamBottomLine/beamCenterY/...) — recalculer cette
// géométrie ici aurait dupliqué une bonne partie de la logique de pente/traverse de drawCoupe,
// contrairement au préambule ci-dessous (spacing/hauteur de bracon/poteau le plus haut), volontairement
// dupliqué avec petit_champ_solaire_poteau_Double poteaux_V1_V2.js (cf. plan). S'appuie sur
// window.intersect et window.drawDoublePostReinforcement (exposés respectivement par
// petit_champ_solaire.js et petit_champ_solaire_poteau_utilities.js). Doit être chargé APRÈS
// petit_champ_solaire_poteau_utilities.js.

function drawDoublePostReinforcementSetV3V4(ctx, scale, postWidthScaled, values, geo) {
    ctx.fillStyle = '#f3f4f6'; ctx.strokeStyle = '#374151'; ctx.lineWidth = 1;
    const spacing = geo.postSpacing * scale / 2;

    // FIX (Alignement toiture coché) : chaque poteau touche son propre sol local — les points
    // d'accroche du contreventement (pieds de poteaux) doivent suivre le même niveau, sinon le
    // renfort semble décroché du poteau.
    // CORRIGÉ (fondation béton "Sur le sol") : le pied du poteau est désormais remonté du niveau du
    // sol jusqu'au dessus du plot/longrine (cf. postBottomY dans petit_champ_solaire.js) — sans ce
    // même décalage ici, les bracons/pieds de contreventement continuaient de s'accrocher à l'ancien
    // niveau du sol (Y=0), traversant visuellement la fondation au lieu de partir de son sommet.
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
    const tallSign = leftIsTaller ? -1 : 1;

    // Point milieu (bas) de la traverse, cible commune du bracon en V3.
    const beamBottomCenter_untrimmed = { x: geo.beamOffsetScaled, y: geo.beamCenterY + geo.beamHeightScaled / 2 * geo.cosA };

    if (appState.doublePostBracing === 'v3') {
        // V3 : aucune barre de liaison ; un seul bracon, fixé entre le pied (sol local) du poteau le
        // plus haut et le milieu de la traverse. Dessiné après la traverse pour être visible et
        // prolongé.
        const p_foot_tall = { x: tallSign * (spacing + postWidthScaled / 2), y: leftIsTaller ? leftGroundOffset : rightGroundOffset };
        const p_end_tall = intersect(p_foot_tall, beamBottomCenter_untrimmed, geo.beamBottomLine.p1, geo.beamBottomLine.p2);
        drawDoublePostReinforcement(ctx, scale, p_foot_tall, p_end_tall, postWidthScaled, values);
    } else if (appState.doublePostBracing === 'v4') {
        // V4 : contreventement en forme de W — 2 bracons intérieurs (pied de chaque poteau vers le
        // centre de la traverse, formant le creux central du W) + 2 bracons extérieurs, en dehors de
        // chaque poteau (de son pied extérieur vers l'extrémité de la traverse de son côté, formant
        // les 2 pics extérieurs du W). Lus de gauche à droite, les 5 points (extrémité gauche traverse
        // - pied gauche - centre traverse - pied droit - extrémité droite traverse) alternent
        // haut/bas/haut/bas/haut : la forme W recherchée.
        const p_foot_left = { x: -spacing + postWidthScaled / 2, y: leftGroundOffset };
        const p_foot_right = { x: spacing - postWidthScaled / 2, y: rightGroundOffset };
        drawDoublePostReinforcement(ctx, scale, p_foot_left, intersect(p_foot_left, beamBottomCenter_untrimmed, geo.beamBottomLine.p1, geo.beamBottomLine.p2), postWidthScaled, values);
        drawDoublePostReinforcement(ctx, scale, p_foot_right, intersect(p_foot_right, beamBottomCenter_untrimmed, geo.beamBottomLine.p1, geo.beamBottomLine.p2), postWidthScaled, values);

        // Bracons extérieurs : pied extérieur de chaque poteau vers l'extrémité de la traverse.
        const p_foot_outer_left = { x: -spacing - postWidthScaled / 2, y: leftGroundOffset };
        const p_foot_outer_right = { x: spacing + postWidthScaled / 2, y: rightGroundOffset };
        const beam_end_point_left = { x: geo.beamOffsetScaled - (geo.beamLengthScaled / 2) * geo.cosA, y: geo.beamCenterY - (geo.beamLengthScaled / 2) * geo.sinA };
        const beam_end_point_right = { x: geo.beamOffsetScaled + (geo.beamLengthScaled / 2) * geo.cosA, y: geo.beamCenterY + (geo.beamLengthScaled / 2) * geo.sinA };
        const beam_end_left = intersect(p_foot_outer_left, beam_end_point_left, geo.beamBottomLine.p1, geo.beamBottomLine.p2);
        const beam_end_right = intersect(p_foot_outer_right, beam_end_point_right, geo.beamBottomLine.p1, geo.beamBottomLine.p2);
        drawDoublePostReinforcement(ctx, scale, p_foot_outer_left, beam_end_left, postWidthScaled, values);
        drawDoublePostReinforcement(ctx, scale, p_foot_outer_right, beam_end_right, postWidthScaled, values);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    ['bracingV3', 'bracingV4'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        // Conserve le doublon de registration pré-existant (harmless, cf.
        // petit_champ_solaire_poteau_Double poteaux_V1_V2.js pour V1/V2).
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
