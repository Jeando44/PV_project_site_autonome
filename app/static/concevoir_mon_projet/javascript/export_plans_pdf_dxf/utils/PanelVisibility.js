/**
 * Masque/restaure tous les panneaux solaires dessinés sur la carte, pour les plans
 * qui ne doivent pas les montrer (ex: Plan de situation, page 1).
 *
 * Les panneaux ne sont pas stockés à un seul endroit : chaque gestionnaire de forme
 * (LineToPolygon, SolarRectangle, PolygonPanelsManager...) possède sa propre Map
 * `createdPanelsByShape` (pvId -> overlays Google Maps). On parcourt les
 * gestionnaires connus via window.drawingControl (exposé globalement par
 * DrawingControl.js) plutôt que de dupliquer leur logique de génération.
 */
export default class PanelVisibility {
  static _managers() {
    const dc = window.drawingControl;
    if (!dc) return [];
    return [dc.lineToPolygon, dc.polygonPanels, dc.solarRectangle].filter(Boolean);
  }

  /** Masque tous les panneaux actuellement visibles. Retourne la liste des overlays masqués (à repasser à restore()). */
  static hideAll() {
    const hidden = [];
    // Panneaux du calepinage sur canevas reportés sur la carte (calepinage_maison_carte_plans.js) :
    // leur fonction de restauration est rangée dans la même liste.
    const plans = window.CalepinageMaisonPlans;
    if (plans && typeof plans.masquerPanneaux === 'function') {
      try { hidden.push({ restore: plans.masquerPanneaux() }); } catch (e) { /* noop */ }
    }
    this._managers().forEach((mgr) => {
      if (!mgr.createdPanelsByShape) return;
      mgr.createdPanelsByShape.forEach((panels) => {
        (panels || []).forEach((panel) => {
          if (panel && typeof panel.getMap === 'function' && panel.getMap()) {
            panel.setMap(null);
            hidden.push(panel);
          }
        });
      });
    });
    return hidden;
  }

  static restore(hidden) {
    if (!hidden || !hidden.length) return;
    const map = window.map;
    hidden.forEach((panel) => {
      if (panel && typeof panel.restore === 'function') panel.restore();
      else if (panel && typeof panel.setMap === 'function') panel.setMap(map);
    });
  }
}
