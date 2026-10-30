import { STYLES } from "../constants.js";

/**
 * Construit le contexte (`ctx`) attendu par les fonctions de calepinage (drawPanelsInRect,
 * drawPanelsInPoly, cf. shapes/calepinage_rectangulaire.js et shapes/calepinage_polygonale.js),
 * à partir des données réelles de l'application (formulaire par pvId) — pour réutiliser ce moteur
 * de calcul sans dupliquer la persistance/le formulaire, qui restent ceux de
 * StorageManager.js/FormHandler.js/DeletedPanelsStorage.js.
 *
 * Le masquage par obstacles n'est PAS branché ici via `window.obstacleManager.isPanelBlocked`
 * (absent/non défini => ignoré par drawPanelsInRect/drawPanelsInPoly, tous les panneaux de la
 * grille sont créés) : il reste géré après coup par ObstaclePanelsManager.refreshPanelsMask(),
 * déjà câblé sur `createdPanelsByShape`/`getDeletedIndexSet`/`hiddenByToggle` du gestionnaire
 * appelant — exactement comme avant cette intégration.
 *
 * @param {DrawingControl} drawingControl
 * @param {string} pvId
 * @param {{getDeletedIndexSet: (pvId: string) => Set<string>, panelPolygons: google.maps.Polygon[]}} deps
 * @returns {Object} ctx à passer à drawPanelsInRect/drawPanelsInPoly
 */
export function buildPanelEngineContext(drawingControl, pvId, { getDeletedIndexSet, panelPolygons }) {
  const q = (id) => document.querySelector(`#${id}-${pvId}`) || document.getElementById(id);
  const num = (el, def = 0) => {
    if (!el) return def;
    const v = parseFloat(el.value);
    return isNaN(v) ? def : v;
  };

  const espacementBordsMm = num(q('espacementBords'), 0);
  const jointDilatationMm = num(q('joint_dilatation'), 0);
  const limitDilatationM = num(q('limit_dilatation_m'), 0);
  const typeCouvertureEl = q('type_de_structure');
  const penteEl = q('pente') || q('inclinaison');
  const pente2El = q('pente2');
  const toitureTypeEl = q('toiture_pente_type');
  const faitageEl = q('largeur_faitage_mm');
  const asymEl = q('asymetrie_percent');
  const nbPentesEl = q('nb_pentes');
  const pente1Val = num(penteEl, 0);

  return {
    map: drawingControl.map,
    // Les panneaux masqués/supprimés ne sont jamais recréés (pas de mode "édition temporaire" à la
    // Terra Draw ici) : la restauration passe par le clic droit existant (tryRestoreDeletedPanelAt).
    manualEditMode: false,
    hiddenPanels: { [pvId]: getDeletedIndexSet(pvId) },
    panelFillColor: STYLES.SOLAR_PANEL.fillColor,
    PANEL_COLOR_STROKE: { [STYLES.SOLAR_PANEL.fillColor]: STYLES.SOLAR_PANEL.strokeColor },
    panelPolygons,
    // LineToPolygon.js::updateRoofVisuals dessine déjà ses propres flèches/labels par pan de toiture
    // (AdvancedMarkerElement) juste après l'appel à drawPanelsInRect — sans ce flag, ce moteur créait
    // ses propres marqueurs SVG en doublon (ex: 4 flèches/labels au lieu de 2 en Bipente symétrique).
    disableZoneMarkers: true,
    // Même correctif que ci-dessus, pour le faîtage/noue (updateRoofVisuals en dessine déjà, suivis et
    // nettoyés via roofOverlaysByShape) : sans ce flag, ce moteur créait EN PLUS son propre faîtage
    // (window.ridgePolylines), jamais nettoyé à la suppression de la forme (seulement remplacé au
    // prochain redessin) — d'où un faîtage orphelin restant sur la carte après suppression du rectangle.
    disableRidgeLines: true,
    // Mode shed interne au moteur rectangulaire non activé ici : l'outil shed dédié
    // (draw-polygon-sheds-button / ShedPolygon.js) couvre déjà ce cas séparément.
    getShedParams: () => null,
    calculateShedGridRect: () => ({ panels: [], tableCount: 0 }),
    calculateShedGridPoly: () => ({ panels: [] }),
    marginX: espacementBordsMm,
    marginY: espacementBordsMm,
    borderDistance: 0,
    dilatationMaxLength: limitDilatationM,
    dilatationWidth: jointDilatationMm,
    updatePvTable: () => {},
    isFieldHidden: false,
    type_de_structure: typeCouvertureEl ? typeCouvertureEl.value : '',
    pente: pente1Val,
    pente2: num(pente2El, pente1Val),
    toiture_pente_type: toitureTypeEl ? toitureTypeEl.value : 'Monopente',
    largeur_faitage_mm: num(faitageEl, 500),
    asymetrie_percent: num(asymEl, 50),
    nb_pentes: num(nbPentesEl, 2),
  };
}

/**
 * Enregistre les panneaux fraîchement générés par drawPanelsInRect/drawPanelsInPoly dans la
 * comptabilité du gestionnaire appelant (createdPanelsByShape/panelCountByShape), en remplaçant
 * leurs propres écouteurs de clic (spécifiques au prototype : hiddenPanels/updatePvTable) par le
 * comportement réel de l'app (removeSolarPanel via boolShowHide).
 *
 * @param {Object} manager - LineToPolygon ou ShedPolygon (this)
 * @param {string} pvId
 * @param {google.maps.Polygon} parentPolygon
 * @param {google.maps.Polygon[]} panelPolygons - rempli par drawPanelsInRect/drawPanelsInPoly
 */
export function registerGeneratedPanels(manager, pvId, parentPolygon, panelPolygons) {
  if (!manager.createdPanelsByShape.has(pvId)) {
    manager.createdPanelsByShape.set(pvId, []);
  }
  const bucket = manager.createdPanelsByShape.get(pvId);

  panelPolygons.forEach((panel) => {
    panel.isPanelSolaire = true;
    panel.parentPolygon = parentPolygon;
    // panel.panelIndex est déjà posé par drawPanelsInRect/drawPanelsInPoly via panelKey (ex: "z0_1_2")

    // CORRECTIF (panneaux peu visibles) : drawPanelsInRect/drawPanelsInPoly appliquent chacun leur
    // propre style/zIndex interne (respectivement 5 et 50) — celui du rectangle (5) est INFÉRIEUR
    // au zIndex de la forme parente (STYLES.DEFAULT_SHAPE.zIndex = 10), donc les panneaux
    // s'affichaient sous le remplissage semi-transparent du polygone, délavés. On réapplique ici
    // le style/zIndex historique des panneaux solaires (identique pour les deux moteurs), pour un
    // rendu cohérent et bien visible au-dessus de la forme parente.
    panel.setOptions({ ...STYLES.SOLAR_PANEL });

    google.maps.event.clearInstanceListeners(panel);
    google.maps.event.addListener(panel, 'click', () => {
      if (manager.boolShowHide && typeof manager.removeSolarPanel === 'function') {
        manager.removeSolarPanel(panel);
      }
    });

    bucket.push(panel);
  });

  if (manager.panelCountByShape) {
    manager.panelCountByShape.set(pvId, bucket.filter((p) => p.isPanelSolaire).length);
  }
}
