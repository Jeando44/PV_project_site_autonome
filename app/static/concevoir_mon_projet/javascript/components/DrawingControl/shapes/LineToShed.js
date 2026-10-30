/**
 * @file LineToShed.js
 * @description Gère la logique de calepinage spécifique pour les structures en sheds.
 * Ce module est conçu pour être utilisé par d'autres classes de formes (LineToPolygon, SolarRectangle, etc.).
 */

/**
 * Calcule la disposition des panneaux pour une configuration en sheds.
 * @param {object} params - Les paramètres de calcul.
 * @param {number} params.availableLength - La longueur disponible pour les panneaux.
 * @param {number} params.availableWidth - La largeur disponible pour les panneaux.
 * @param {number} params.effectivePanelLength - La longueur effective du panneau (avec rotation).
 * @param {number} params.effectivePanelWidth - La largeur effective du panneau (avec rotation).
 * @param {object} params.panelConfig - La configuration des panneaux (spacingX, shedsRows, etc.).
 * @param {boolean} params.isFlat - Si la toiture est plate.
 * @param {number} params.pente1 - La pente (utilisée si la toiture est plate).
 * @param {number} params.latitude - La latitude du site pour le calcul d'ombrage.
 * @param {boolean} [params.maxFill=false] - "Remp. maximal" : ignore tout regroupement de sheds sur les
 * deux axes et remplit le polygone en continu, uniquement borné par son contour.
 * @returns {{centersAlong: number[], allWidthOffsets: object[]}} Les positions des centres des panneaux.
 */
export function calculateShedLayout({
    availableLength,
    availableWidth,
    effectivePanelLength,
    effectivePanelWidth,
    panelConfig,
    isFlat,
    pente1,
    latitude,
    shedTilt = 0, // Fallback par défaut
    isShedsRegular = false,
    maxFill = false
}) {

    // groupSize/groupSpacing à 0 désactive nativement tout regroupement (isGroupBoundary ne se
    // déclenche jamais) : les panneaux s'enchaînent alors en continu avec le seul espacement technique
    // panneau->panneau, jusqu'à la borne "available".
    const buildOffsets = (available, effSize, spacing, groupSize = 0, groupSpacing = 0) => {
        const offsets = [];
        let cursor = 0;
        let idx = 0;
        if (effSize <= 0) return offsets;

        while (cursor + effSize <= available + 0.001) {
            offsets.push(cursor + effSize / 2);
            idx += 1;
            const isGroupBoundary = groupSize > 0 && idx % groupSize === 0;
            cursor += effSize + spacing + (isGroupBoundary ? groupSpacing : 0);
        }

        if (offsets.length > 0) {
            // Le curseur ajoute TOUJOURS "spacing" après chaque panneau, PLUS "groupSpacing" en plus
            // si c'est une frontière de groupe (cf. boucle ci-dessus) : les deux doivent être retranchés
            // ensemble ici (et non l'un OU l'autre), sinon le centrage sous-estime légèrement l'espace
            // réellement utilisé et décale toute la rangée d'un cran.
            const wasLastGroupBoundary = groupSize > 0 && (idx - 1) % groupSize === (groupSize - 1);
            const lastSpacing = spacing + (wasLastGroupBoundary ? groupSpacing : 0);
            const actualUsed = cursor - lastSpacing;
            const shift = (available - actualUsed) / 2;
            return offsets.map(o => o + shift);
        }
        return offsets;
    };

    // 1. Utilisation directe du paramètre passé à la fonction (Plus de requête DOM)
    const panelTiltRad = shedTilt * (Math.PI / 180);
    const shedsCosSlope = Math.cos(panelTiltRad);

    // 2. Cas particuliers "à 0" et option "Remp. maximal" (axe par axe) :
    // - *NoGrouping (Nb. PV en longueur == 0 pour l'axe largeur, ou Remp. maximal coché) : aucun
    //   regroupement de sheds, les panneaux s'enchaînent en continu (seul l'espacement technique
    //   panneau->panneau s'applique), uniquement bornés par le polygone.
    // - *NoGroupGap (Esp. groupe de shed == 0, ou Remp. maximal coché) : aucun espace supplémentaire
    //   entre groupes de sheds, ceux-ci se propagent en continu jusqu'à la bordure du polygone.
    // "Remp. maximal" force ces deux comportements simultanément SUR LES DEUX AXES, quelles que soient
    // les valeurs saisies (Nb. PV en largeur/longueur, Esp. entre sheds/groupe de shed) : seuls
    // l'espacement technique X/Y et le contour du polygone déterminent alors le remplissage.
    const alongNoGrouping = maxFill || panelConfig.shedsRows === 0;
    const alongNoGroupGap = maxFill || panelConfig.shedsRowSpacing === 0;
    const widthNoGrouping = maxFill || panelConfig.shedsCols === 0;
    const widthNoGroupGap = maxFill || panelConfig.shedsColSpacing === 0;

    // Espacement entre groupes de sheds (axe largeur / rampant) : priorité à "aucun espace" (cas
    // particulier ci-dessus) ; sinon à l'espacement automatique anti-ombrage ("Sheds réguliers") s'il
    // est actif ; sinon "shedsColSpacing" si configuré (> 0) ; sinon repli sur l'espacement technique
    // panneau->panneau (comportement historique, inchangé quand aucun regroupement n'est configuré).
    let interGroupSpacingWidth;
    if (widthNoGroupGap) {
        interGroupSpacingWidth = 0;
    } else {
        interGroupSpacingWidth = panelConfig.shedsColSpacing > 0 ? panelConfig.shedsColSpacing : panelConfig.spacingY;
        if (isShedsRegular && shedTilt > 0 && latitude) {
            const panelHeight = effectivePanelWidth * Math.sin(panelTiltRad);
            const sunAngleRad = (90 - latitude - 23.45) * (Math.PI / 180);
            if (sunAngleRad > 0) {
                interGroupSpacingWidth = panelHeight / Math.tan(sunAngleRad);
            }
        }
    }

    // Calcul en longueur : comme pour la largeur ci-dessous, on retranche la marge des DEUX côtés avant
    // de centrer, puis on la rajoute une fois pour repasser dans le repère d'origine. Sans cela, le
    // centrage s'effectuait sur la longueur totale (marge incluse) puis la marge était rajoutée par-
    // dessus, décalant tout le rang de sheds d'une marge entière hors du centre du polygone.
    const availableLengthForSheds = availableLength - (2 * panelConfig.margin);
    const alongGroupSize = alongNoGrouping ? 0 : panelConfig.shedsRows;
    const alongGroupSpacing = alongNoGroupGap ? 0 : panelConfig.shedsRowSpacing;
    const centersLen = buildOffsets(availableLengthForSheds, effectivePanelLength, panelConfig.spacingX, alongGroupSize, alongGroupSpacing);
    const centersAlong = centersLen.map(c => c + panelConfig.margin);

    // 3. Algorithme de calepinage en largeur (shed) avec regroupement : "shedsCols" panneaux serrés
    // (espacement technique panelConfig.spacingY) forment un même shed, puis "interGroupSpacingWidth"
    // sépare chaque shed du suivant. Sans configuration (shedsCols <= 1) ou en mode "sans regroupement"
    // (widthNoGrouping), ce regroupement dégénère vers un enchaînement continu (un seul espacement
    // technique uniforme entre chaque rangée, jusqu'à la bordure du polygone).
    const availableWidthForSheds = availableWidth - (2 * panelConfig.margin);
    const projectedPanelWidth = effectivePanelWidth * shedsCosSlope;
    const groupSizeWidth = widthNoGrouping ? 0 : (panelConfig.shedsCols > 1 ? Math.floor(panelConfig.shedsCols) : 1);

    const rawWidthOffsets = [];
    if (projectedPanelWidth > 0) {
        let cursor = 0;
        let idx = 0;
        while (cursor + projectedPanelWidth <= availableWidthForSheds + 0.001) {
            rawWidthOffsets.push({ offset: cursor + projectedPanelWidth / 2, groupIndex: groupSizeWidth > 0 ? Math.floor(idx / groupSizeWidth) : 0 });
            idx += 1;
            const isGroupBoundary = groupSizeWidth > 0 && idx % groupSizeWidth === 0;
            cursor += projectedPanelWidth + (isGroupBoundary ? interGroupSpacingWidth : panelConfig.spacingY);
        }
    }

    // Masque le dernier shed s'il est incomplet — UNIQUEMENT en mode "Shed régulier" (isShedsRegular) et
    // hors "sans regroupement" (widthNoGrouping), où la notion de "groupe incomplet" n'a plus de sens.
    // Par défaut (décoché), on garde le groupe partiel en bout d'axe pour maximiser le remplissage de
    // l'espace disponible : le masquer systématiquement (comme avant) pouvait laisser une large bande
    // vide dès que la largeur ne divisait pas exactement le nombre de panneaux par groupe.
    let widthOffsetsKept = rawWidthOffsets;
    if (!widthNoGrouping && isShedsRegular && groupSizeWidth > 1 && rawWidthOffsets.length > 0) {
        const lastGroupIndex = rawWidthOffsets[rawWidthOffsets.length - 1].groupIndex;
        const lastGroupCount = rawWidthOffsets.filter(o => o.groupIndex === lastGroupIndex).length;
        if (lastGroupCount < groupSizeWidth) {
            widthOffsetsKept = rawWidthOffsets.filter(o => o.groupIndex !== lastGroupIndex);
        }
    }

    // Centrage des panneaux conservés sur la largeur disponible
    let centersWid = [];
    if (widthOffsetsKept.length > 0) {
        const firstEdge = widthOffsetsKept[0].offset - projectedPanelWidth / 2;
        const lastEdge = widthOffsetsKept[widthOffsetsKept.length - 1].offset + projectedPanelWidth / 2;
        const usedWidth = lastEdge - firstEdge;
        const shift = (availableWidthForSheds - usedWidth) / 2 - firstEdge;
        centersWid = widthOffsetsKept.map(o => o.offset + shift + panelConfig.margin);
    }
    const allWidthOffsets = centersWid.map(c => ({ offset: c, cosSlope: shedsCosSlope, panIndex: 1 }));

    return { centersAlong, allWidthOffsets };
}
