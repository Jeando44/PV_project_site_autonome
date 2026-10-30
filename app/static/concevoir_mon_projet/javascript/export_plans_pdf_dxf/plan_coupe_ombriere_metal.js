import CartoucheData from './utils/CartoucheData.js';

/**
 * Correspondance clé Python (calculate_ombriere) -> id de champ DOM (camelCase,
 * même convention que updateAppLogic() dans ombriere_metal.js:1929-1964).
 */
const FIELD_MAP = {
  beam_height: 'beamHeight',
  purlin_height: 'purlinHeight',
  integration_system_height: 'integrationSystemHeight',
  panel_thickness: 'panelThickness',
  panel_width: 'panelWidth',
  roof_slope: 'roofSlope',
  overhang_sym_value: 'overhangSymValue',
  overhang_asym_high: 'overhangAsymHigh',
  overhang_asym_low: 'overhangAsymLow',
  post_eccentricity: 'postEccentricity',
  post_width: 'postWidth',
  post_spacing: 'postSpacing',
  post_spacing_inclined: 'postSpacingInclined',
  post_inclination_inclined: 'postInclinationInclined',
  height_under_brace: 'heightUnderBrace',
  brace_fix_percentage: 'braceFixPercentage',
  purlin_count: 'purlinCount',
  facade_length: 'facadeLength',
  left_overhang: 'leftOverhang',
  right_overhang: 'rightOverhang',
  ground_slope_facade: 'groundSlopeFacade',
  base_altimetry: 'baseAltimetry',
  passage_height: 'passageHeight',
  pv_layout: 'pvLayout',
  linked_panels_count: 'linkedPanelsCount',
  double_y_shape_panels_count: 'doubleYShapePanelsCount',
};

function readFieldValue(id) {
  const el = document.getElementById(id);
  if (!el) return undefined;
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return parseFloat(el.value) || 0;
  return el.value;
}

/**
 * Reconstruit le payload attendu par calculate_ombriere() (Python) directement
 * depuis le formulaire actuellement affiché à l'écran. Aucune donnée d'ombrière
 * n'est aujourd'hui persistée ailleurs (ni en base, ni en localStorage : seules
 * des captures d'écran des canevas le sont) - c'est donc la seule source
 * disponible, et elle a l'avantage de refléter exactement ce que l'utilisateur
 * voit au moment de l'export.
 */
function collectOmbriereData() {
  const appState = window.appState || {};
  const data = {
    post_model: appState.postModel,
    traverse_position: appState.traversePosition,
    overhang_type: appState.overhangType,
    invert_slope: appState.invertSlope,
    offset_post_side: appState.offsetPostSide,
    reinforcement_type: appState.reinforcementType,
    double_post_bracing: appState.doublePostBracing,
    show_double_bracing: appState.showDoubleBracing,
    align_roof: readFieldValue('alignRoof'),
    post_distances_expr: readFieldValue('postDistances') || '',
  };
  Object.entries(FIELD_MAP).forEach(([pyKey, domId]) => {
    data[pyKey] = readFieldValue(domId);
  });
  data.terrain = collectTerrain(data);
  return data;
}

/**
 * Terrain automatique (geometrie_structure/terrain_plans.js) : on envoie le profil DÉJÀ échantillonné
 * dans le repère du dessin (x en m, y du sol en m, positif vers le BAS, comme les générateurs
 * Python). Le serveur rejoue ce sol tel quel : le PDF/DXF montre donc le même terrain que l'écran.
 * null = terrain décoché / indisponible -> le serveur garde son dessin historique.
 */
function collectTerrain(data) {
  const TP = window.TerrainPlans;
  if (!TP || typeof TP.actif !== 'function' || !TP.actif()) return null;
  const pas = 0.5;
  const echantillonner = (sol, xDebut, xFin, ref) => {
    const points = [];
    for (let x = xDebut; x <= xFin + 1e-9; x += pas) {
      points.push([Number(x.toFixed(3)), Number((-(sol.zRel(x) - ref)).toFixed(4))]);
    }
    return points;
  };
  const terrain = { altitudes_ngf: !!(TP.altitudesNGF && TP.altitudesNGF()) };
  try {
    const panelWidth = Number(data.panel_width) || 0;
    const solCoupe = TP.solCoupe({ invertSlope: !!data.invert_slope });
    if (solCoupe) {
      // Même référence que le dessin à l'écran : sol ramené à son point le plus haut sous l'emprise.
      const demi = Math.max(1, panelWidth / 2 + 1);
      const ref = TP.niveauSolStructure ? TP.niveauSolStructure(solCoupe, demi) : 0;
      terrain.coupe = echantillonner(solCoupe, -(demi + 5), demi + 5, ref);
    }
    const facadeLength = Number(data.facade_length) || 0;
    const solFacade = TP.solFacade({ orientation: 'Sud', longueurDessinM: facadeLength });
    if (solFacade && facadeLength > 0) {
      terrain.facade = echantillonner(solFacade, -3, facadeLength + 3, 0);
    }
  } catch (e) {
    return null;
  }
  return (terrain.coupe || terrain.facade) ? terrain : null;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export PDF/DXF (coupe + façade, + implantation des poteaux pour le DXF) de
 * l'ombrière métal actuellement ouverte dans ce modal - une instance à la fois
 * (cf. plan : pas de source de données permettant d'exporter toutes les
 * ombrières d'un coup sans les rouvrir une à une).
 */
export default class PlanCoupeOmbriereMetalExporter {
  static async _buildPayload(indice) {
    const pvId = new URLSearchParams(window.location.search).get('pvId') || 'PV1';
    const cartoucheBase = await CartoucheData.build({ nomPlan: `Ombrière métal ${pvId}`, indice, scale: null });
    if (!cartoucheBase) {
      throw new Error("Projet introuvable. Sélectionnez un projet avant l'export.");
    }
    return {
      data: collectOmbriereData(),
      cartouche: {
        nom_projet: cartoucheBase.nom_projet,
        nom_plan: cartoucheBase.nom_plan,
        indice: cartoucheBase.indice,
        date: cartoucheBase.date,
        adresse: cartoucheBase.adresse,
        company_name: cartoucheBase.company_name,
        company_logo: cartoucheBase.company_logo,
      },
    };
  }

  static async exportPdf({ indice = 'A', onProgress } = {}) {
    if (onProgress) onProgress('Génération du PDF...');
    const payload = await this._buildPayload(indice);
    const res = await fetch('/concevoir_mon_projet/api/export_pdf/ombriere_metal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Échec de la génération PDF (HTTP ${res.status})`);
    }
    return { blob: await res.blob(), filename: 'ombriere_metal.pdf' };
  }

  static async exportDxf({ indice = 'A', onProgress } = {}) {
    if (onProgress) onProgress('Génération du DXF...');
    const payload = await this._buildPayload(indice);
    const res = await fetch('/concevoir_mon_projet/api/export_dxf/ombriere_metal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Échec de la génération DXF (HTTP ${res.status})`);
    }
    return { blob: await res.blob(), filename: 'ombriere_metal_dxf.zip' };
  }

  static async downloadPdf(indice = 'A') {
    const { blob, filename } = await this.exportPdf({ indice });
    triggerBlobDownload(blob, filename);
  }

  static async downloadDxf(indice = 'A') {
    const { blob, filename } = await this.exportDxf({ indice });
    triggerBlobDownload(blob, filename);
  }
}
