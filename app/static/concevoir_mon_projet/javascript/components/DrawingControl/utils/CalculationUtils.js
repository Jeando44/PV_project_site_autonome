import GeometryUtils from "./GeometryUtils.js";
/*
    Calcul de la production en kwh/kwc
    production: production PVGIS pour 1kWc
    PuissancePVKwc: puissance du panneau en Wc
    nbrePv: nombre de panneaux */

export const calculateProductionMwh = (production, PuissancePVKwc) => {
    return (Number(production) * Number(PuissancePVKwc)) / 1000;
}
/**
 * Calcul de la puissance du panneau en Wc
 * nbrePv: nombre de panneaux
 * PuissancePVKwc: puissance d'un seul panneau en kWc
 */
export const calculatePuissancePVKwc = (nbrePv, PuissancePVKwc) => {
    return (Number(nbrePv) * Number(PuissancePVKwc)) / 1000;
}
/** ATTENTION: valable pour les champs Prod_PV (kWh/kWc), Productible (kWh/kWc), Productible_P50 (kWh/kWc)
 * Calcul de la production en kwh/kwc
 * productionMwh: production en MWh
 * PuissancePVKwc: puissance du panneau en KWc
 */
export const calculateProductibleKwhKwc = (productionMwh, PuissancePVKwc) => {
    return (Number(productionMwh) * 1000) / Number(PuissancePVKwc);
}

/**
 * Calcul du rendement de la surface projetée / surface totale de la zone à équiper en panneaux solaires
 * surfaceProjetée: Surface projetée
 * surfaceTotale: Surface totale de la zone à équiper en panneaux solaires
 */
export const calculateRC = (surfaceProjetée, surfacePolygone) => {
    if (!surfaceProjetée || !surfacePolygone || surfacePolygone === 0) {
        return 0;
    }
    
    const rc = Number(surfaceProjetée) / Number(surfacePolygone);
    // console.log("RC (Rendement de la surface projetée) :", rc, "surfaceProjetée:", surfaceProjetée, "surfacePolygone:", surfacePolygone);
    // console.log("isNaN:", isNaN(rc));
    return isNaN(rc) ? 0 : rc;
}

    /**
 * Calcule les dimensions finales du champ PV en incluant les marges de sécurité
 * dX et dY du système d'intégration.
 */
export const calculateFinalDimensionsWithMargin = (totalLength, totalWidth, typeCouverture, referenceSI, TYPE_COUVERTURE_MAP) => {
    let dX = 0;
    let dY = 0;
    if (typeCouverture && referenceSI && TYPE_COUVERTURE_MAP && TYPE_COUVERTURE_MAP[typeCouverture]) {
        const siData = TYPE_COUVERTURE_MAP[typeCouverture].find(s => s.id === referenceSI);
        if (siData) {
            dX = parseFloat(siData.dX || 0) / 1000;
            dY = parseFloat(siData.dY || 0) / 1000;
        }
    }
    const baseLength = Math.max(totalLength, totalWidth);
    const baseWidth = Math.min(totalLength, totalWidth);

    return {
        longueur: baseLength > 0 ? baseLength + dX : 0,
        largeur: baseWidth > 0 ? baseWidth + dY : 0
    };
};

/**
     * Calcul de la surface projetée : surface totale des panneaux * cos(inclinaison)
 * surfaceTotalePanneaux: surface réelle totale qu'occupent les panneaux
 * inclinaison: inclinaison du panneau, avec valeur en radian
 */
export const calculateSurfaceProjetée = (surfaceTotalePanneaux, inclinaison) => {
    return Number(surfaceTotalePanneaux) * Math.cos(GeometryUtils.degToRad(Number(inclinaison)));
}

/** Gestion nombre de panneau, Ajout YOZATI */

export const getAccuratePanelCount =(pvId, data) => {
    try {
        const lineTool = window.drawingControl?.lineToPolygon;
        const polyTool = window.drawingControl?.polygonPanels;
        const solarRectangleTool = window.drawingControl?.solarRectangle;
        const shedTool = window.drawingControl?.shedPolygon;

        // Compter via LineToPolygon si présent
        if (lineTool && lineTool.createdPanelsByShape?.has(pvId)) {
            const created = (lineTool.createdPanelsByShape.get(pvId) || []).filter(
                (panel) => panel && panel.isPanelSolaire
            );
            const deletedSet = typeof lineTool.getDeletedIndexSet === "function"
                ? lineTool.getDeletedIndexSet(pvId)
                : new Set();

            const visiblePanels = created.filter((panel) => {
                if (!panel.panelIndex) return false;
                if (deletedSet.has(panel.panelIndex)) return false;
                // Ne compter que les panneaux non masqués par un obstacle
                return !panel._maskedByObstacle;
            });

            const count = visiblePanels.length;
            if (count >= 0) return count;
        }

        // Compter via PolygonPanelsManager si présent
        if (polyTool && polyTool.createdPanelsByShape?.has(pvId)) {
            const created = (polyTool.createdPanelsByShape.get(pvId) || []).filter(
                (panel) => panel && panel.isPanelSolaire
            );
            const deletedSet = typeof polyTool.getDeletedIndexSet === "function"
                ? polyTool.getDeletedIndexSet(pvId)
                : (polyTool.deletedPanelIndexes?.get(pvId) || new Set());

            const visiblePanels = created.filter((panel) => {
                if (!panel.panelIndex) return false;
                if (deletedSet && deletedSet.has && deletedSet.has(panel.panelIndex)) return false;
                return !panel._maskedByObstacle;
            });

            const count = visiblePanels.length;
            if (count >= 0) return count;
        }

        if (solarRectangleTool && solarRectangleTool.createdPanelsByShape?.has(pvId)) {
            const created = (solarRectangleTool.createdPanelsByShape.get(pvId) || []).filter(
                (panel) => panel && panel.isPanelSolaire
            );
            const deletedSet = typeof solarRectangleTool.getDeletedIndexSet === "function"
                ? solarRectangleTool.getDeletedIndexSet(pvId)
                : new Set();

            const visiblePanels = created.filter((panel) => {
                if (!panel.panelIndex) return false;
                if (deletedSet.has(panel.panelIndex)) return false;
                return !panel._maskedByObstacle;
            });

            return visiblePanels.length;
        }

        // CORRECTIF (Summary modal affichait un nombre de panneaux obsolète pour le calepinage en
        // shed dédié, càd l'outil ShedPolygon.js — distinct de "Polygone + case Option Shed" géré par
        // polyTool ci-dessus) : shedTool.createdPanelsByShape (alias de createdPanels, cf.
        // ShedPolygon.js constructeur, "pour que calepinage_correction_controller.js/payload_builder.js
        // ... lisent/écrivent createdPanelsByShape") n'était jamais consulté ici, donc ce calcul tombait
        // systématiquement dans le repli data.gridInfo.panelCount (valeur figée) au lieu du nombre réel
        // de panneaux — y compris les panneaux backend-vérifiés posés après "Calculer" (cf.
        // calepinage_correction_controller.js::applyPanelsFromBackend, qui écrit bien dans cette même
        // Map, panelIndex="backend-${idx}", via l'alias). Pas de filtrage par deletedSet ni de
        // getDeletedIndexSet ici : les sheds ne supportent pas la suppression individuelle de panneau
        // (cf. ShedPolygon.js::refreshPanelsForShape, engineCtx.getDeletedIndexSet toujours vide).
        if (shedTool && shedTool.createdPanelsByShape?.has(pvId)) {
            const created = (shedTool.createdPanelsByShape.get(pvId) || []).filter(
                (panel) => panel && panel.isPanelSolaire
            );

            const visiblePanels = created.filter((panel) => {
                if (!panel.panelIndex) return false;
                return !panel._maskedByObstacle;
            });

            return visiblePanels.length;
        }

        // Repli: valeur sauvegardée
        return Number(data?.shapes?.[pvId]?.gridInfo?.panelCount) || 0;
    } catch (_) {
        return Number(data?.shapes?.[pvId]?.gridInfo?.panelCount) || 0;
    }
}

 /** Fin ajout section YOZATI */

/**
 * Calcule le nombre de panneaux pour chaque pan de toiture.
 *
 * Deux modes bien distincts, marqués par __perPanExplicit :
 * - lineToPolygon (placement panneau par panneau) : chaque panneau porte son propre panIndex, donc
 *   le comptage par pan est réel et fiable, y compris un pan à 0 panneau (l'utilisateur n'y a
 *   simplement encore rien placé) — ne JAMAIS combler ce 0 par une autre valeur.
 * - Outil "grille" (rectangle Lignes x Colonnes, ex: SolarRectangle) : un seul comptage global est
 *   connu (counts[1]), sans notion de pan — getSubFieldsData() s'appuie sur __perPanExplicit pour
 *   savoir qu'il doit répliquer ce comptage sur chaque pan actif plutôt que de traiter les pans
 *   2/3/4 comme vides.
 */
export const getPanelCountByPan = (pvId, data) => {
    const counts = {};
    try {
        const lineTool = window.drawingControl?.lineToPolygon;
        if (lineTool && lineTool.createdPanelsByShape?.has(pvId)) {
            const created = lineTool.createdPanelsByShape.get(pvId) || [];
            const deletedSet = typeof lineTool.getDeletedIndexSet === "function"
                ? lineTool.getDeletedIndexSet(pvId)
                : new Set();

            created.forEach(panel => {
                if (panel && panel.isPanelSolaire && panel.panelIndex && !deletedSet.has(panel.panelIndex) && !panel._maskedByObstacle) {
                    const pIdx = panel.panIndex || 1;
                    counts[pIdx] = (counts[pIdx] || 0) + 1;
                }
            });
            Object.defineProperty(counts, '__perPanExplicit', { value: true, enumerable: false });
            return counts;
        }
        // Si pas LineToPolygon ou forme standard : un seul comptage global (pas de répartition par
        // pan connue à ce stade) — __perPanExplicit reste absent/false.
        counts[1] = getAccuratePanelCount(pvId, data);
    } catch (e) {
        counts[1] = Number(data?.shapes?.[pvId]?.gridInfo?.panelCount) || 0;
    }
    return counts;
};

/**
 * Récupère, pour chaque pan, la VRAIE disposition (lignes x colonnes) telle que réellement
 * placée par calepinage_rectangulaire.js (poly.zoneNumRows/zoneNumCols), plutôt que de déduire
 * une valeur approximative en divisant #nbLigne/#nbColonne globaux par le nombre de pans — ces
 * derniers valent 1 x <total panneaux> pour ce moteur (LineToPolygon.js ne peut pas reporter une
 * vraie décomposition lignes/colonnes globale quand la toiture a plusieurs pans), donc diviser
 * "1" par le nombre de pans ne changeait rien. N'est renseigné que pour le moteur lineToPolygon
 * (seul à poser zoneNumRows/zoneNumCols) ; retourne {} sinon, laissant l'appelant retomber sur
 * son ancienne logique (SolarRectangle, etc.).
 */
export const getGridSizeByPan = (pvId) => {
    const sizes = {};
    try {
        const lineTool = window.drawingControl?.lineToPolygon;
        if (lineTool && lineTool.createdPanelsByShape?.has(pvId)) {
            const created = lineTool.createdPanelsByShape.get(pvId) || [];
            created.forEach(panel => {
                if (panel && panel.isPanelSolaire && panel.panIndex !== undefined
                    && panel.zoneNumRows > 0 && panel.zoneNumCols > 0
                    && sizes[panel.panIndex] === undefined) {
                    sizes[panel.panIndex] = { numRows: panel.zoneNumRows, numCols: panel.zoneNumCols };
                }
            });
        }
    } catch (_) {
        // Repli silencieux : l'appelant garde son ancienne logique si rien n'est disponible ici.
    }
    return sizes;
};

/**
 * Subdivise les données d'un champ PV en sous-champs selon la géométrie
 */
export const getSubFieldsData = (pvId, formValues, panelCountByPan) => {
    const type = formValues.toiture_pente_type || 'Monopente';
    const pente1 = parseFloat(formValues.inclinaison || formValues.pente) || 0;
    const pente2 = parseFloat(formValues.pente2) || pente1;

    const fields = [];
    const addField = (panIndex, azimuthKey, tilt) => {
        // Demande explicite (avec exemple chiffré) : pour une toiture Bipente/Multipente dessinée
        // avec l'outil "grille" (ex: 10 Lignes x 30 Colonnes = 300 panneaux), CHAQUE pan reproduit
        // la même disposition — 300 panneaux sur PV1.1 ET 300 sur PV1.2, pas 300 répartis entre les
        // deux. panelCountByPan[panIndex] n'est alors renseigné que pour le pan 1 (aucune notion de
        // pan dans cet outil de dessin) : on réplique sa valeur sur les autres pans. Avec
        // lineToPolygon (comptage réel par pan, __perPanExplicit), un pan à 0 panneau reste à 0.
        const explicitCount = panelCountByPan[panIndex];
        const count = (explicitCount !== undefined)
            ? explicitCount
            : (panelCountByPan.__perPanExplicit ? 0 : (panelCountByPan[1] || 0));
        // Conserver le champ PV s'il y a des panneaux, ou si c'est le pan 1 par sécurité
        if (count > 0 || type === 'Monopente' || panIndex === 1) {
            const subPvId = type === 'Monopente' ? pvId : `${pvId}.${panIndex}`;
            
            let azVal = formValues[azimuthKey];
            if (azVal === undefined) azVal = formValues[azimuthKey.toLowerCase()];
            if (azVal === undefined && azimuthKey === 'Azimuth') azVal = formValues['azimuth'];

            fields.push({
                panIndex,
                subPvId,
                panelCount: count,
                azimuth: parseFloat(azVal) || 0,
                tilt: tilt
            });
        }
    };

    if (type === 'Monopente') {
        addField(1, 'Azimuth', pente1);
    } else if (type === 'Bipente_symetrique') {
        addField(1, 'Azimuth', pente1);
        addField(2, 'azimuth2', pente1);
    } else if (type === 'Bipente_asymetrique') {
        addField(1, 'Azimuth', pente1);
        addField(2, 'azimuth2', pente2);
    } else if (type === 'Multipente') {
        addField(1, 'Azimuth', pente1);
        addField(2, 'azimuth2', pente1);
        addField(3, 'azimuth3', pente1);
        addField(4, 'azimuth4', pente1);
    }

    return fields;
};

/**
 * Calcul de la moyenne du productible en kwh/kwc
 * productibleKwhKwc: productible en kwh/kwc
 * nbrePv: nombre de panneaux
 */



export const convertKWhToMWh = (kwh) => {
    return Number(kwh) / 1000;
}

export const convertMWhToKWh = (mwh) => {
    return Number(mwh) * 1000;
}