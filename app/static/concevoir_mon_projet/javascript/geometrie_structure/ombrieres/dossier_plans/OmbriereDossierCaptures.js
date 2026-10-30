import { buildContext, captureAll } from '../../../declaration_prealable/DpCaptures.js?v=6';
import { dataUrlToJpeg } from '../../../declaration_prealable/DpImages.js';
import { captureCanevas } from '../../petit_champ_solaire/dossier_plans/DossierCaptures.js?v=9';
import { GET_PVGIS_DATA } from '../../../../API/API.js';
import { ECHELLE_SITUATION_PROCHE } from './OmbriereDossierState.js?v=9';
import { chargerChamp, urlConfigurateur } from './ChargeurConfigurateur.js?v=5';
import { charger as chargerPetitChampHorsEcran, liberer as libererPetitChampHorsEcran } from '../../petit_champ_solaire/dossier_plans/ConfigurateurHorsEcran.js?v=1';
import { PROFILS, familleStructure, libelleType } from '../../dossier_profils.js?v=1';

/**
 * Phase de CAPTURE du dossier de plans « projet entier » (profil ombrières, toitures ou mixte ; la
 * seule phase coûteuse), une fois par génération ; l'assemblage (OmbriereDossierPieces.js) rejoue
 * ensuite ces résultats pour le PDF complet, le ZIP ou une pièce seule.
 *
 * Sources :
 *  - champs du dossier : résumés du calepinage (CM.getAllPvFieldSummaries), un élément par champ PV
 *    dont la famille de structure appartient au profil, pans regroupés ;
 *  - plans de situation, plan de calepinage sur fond cadastral et vue de la page APER : captures de
 *    la Déclaration préalable (DpCaptures.captureAll) ;
 *  - calepinage sans la carte et vue 3D : mêmes captures que le dossier du petit champ, par champ ;
 *  - coupe, façade et valeurs du tableau géométrie : configurateur de chaque ombrière
 *    (ChargeurConfigurateur.js) ou petit champ (ConfigurateurHorsEcran.js), chargé hors écran ; les
 *    toitures n'ont pas de configurateur (ni coupe ni façade) ;
 *  - loi APER : calcul du calculateur APER (calcul_APER.js, resultatsPourRapport).
 */

const numeroChamp = (id) => { const m = /(\d+)/.exec(id || ''); return m ? Number(m[1]) : Infinity; };

/**
 * Champs PV du dossier : un élément par champ dont la famille de structure appartient au profil
 * (ombrières, petit champ, toitures), avec les totaux de ses pans (Y = 2 pans). Une ombrière sans
 * configurateur connu est écartée (ni coupe ni façade possibles).
 */
export function listerChamps(profil = PROFILS.ombrieres) {
  let resumes = [];
  try {
    const CM = window.CalepinageMaisonIndiv;
    resumes = CM && typeof CM.getAllPvFieldSummaries === 'function' ? CM.getAllPvFieldSummaries() : [];
  } catch (e) { resumes = []; }
  const parChamp = new Map();
  resumes.forEach((r) => {
    if (!r || !r.sourceId) return;
    const famille = familleStructure(r.typeMontage);
    if (!profil.familles.includes(famille)) return;
    let c = parChamp.get(r.sourceId);
    if (!c) {
      c = {
        sourceId: r.sourceId, typeMontage: r.typeMontage, famille, libelleType: libelleType(r.typeMontage),
        nbPanneaux: 0, puissanceKwc: 0, surfacePanneauxM2: 0, surfaceProjeteeM2: 0, pans: [],
      };
      parChamp.set(r.sourceId, c);
    }
    c.nbPanneaux += r.panelCount || 0;
    c.puissanceKwc += r.peakPower || 0;
    c.surfacePanneauxM2 += r.surfacePanneauxM2 || 0;
    c.surfaceProjeteeM2 += r.surfaceProjeteeM2 || 0;
    c.pans.push({
      id: r.id, penteDeg: r.tilt, azimutDeg: r.azimuth, disposition: r.disposition,
      puissanceKwc: r.peakPower || 0, montage: r.mount, pertesPct: Number(r.loss) || 0,
    });
  });
  return [...parChamp.values()]
    // Ombrière : comportement d'origine (configurateur requis) ; autres structures : au moins un panneau.
    .filter((c) => (c.famille === 'ombrieres' ? !!urlConfigurateur(c.typeMontage) : c.nbPanneaux > 0))
    .sort((a, b) => numeroChamp(a.sourceId) - numeroChamp(b.sourceId) || String(a.sourceId).localeCompare(String(b.sourceId)));
}

/** Pseudo-état DP : seuls les réglages lus par buildContext/captureAll. */
function etatDp(dossier, pvId) {
  const d = dossier.data;
  return {
    data: {
      indice: d.indice || 'A', adresse: d.adresse || '', typeDemandeur: 'particulier', civilite: '',
      nom: d.maitreOuvrage || '', champId: pvId, echelleMasse: 'auto',
    },
    images: {},
  };
}

export async function construireContexte(dossier, champsDossier) {
  const premier = champsDossier[0] ? champsDossier[0].sourceId : null;
  const ctx = await buildContext(etatDp(dossier, premier));
  ctx.titreDemandeur = "Maître d'ouvrage";
  ctx.champsDossier = champsDossier;
  ctx.nbPanneaux = champsDossier.reduce((s, c) => s + c.nbPanneaux, 0);
  ctx.puissanceKwc = champsDossier.reduce((s, c) => s + c.puissanceKwc, 0);
  ctx.surfaceProjeteeM2 = champsDossier.reduce((s, c) => s + c.surfaceProjeteeM2, 0);
  ctx.surfacePanneauxM2 = champsDossier.reduce((s, c) => s + c.surfacePanneauxM2, 0);
  return ctx;
}

/** Position (lat/lng) de chaque champ PV sur la carte, comme le résumé « Système » (SummaryModal). */
function originesChamps() {
  const origines = new Map();
  try {
    const CM = window.CalepinageMaisonIndiv;
    if (CM && typeof CM.listerChampsCarte === 'function') {
      CM.listerChampsCarte().forEach((c) => {
        const lat = c.origin && (typeof c.origin.lat === 'function' ? c.origin.lat() : c.origin.lat);
        const lng = c.origin && (typeof c.origin.lng === 'function' ? c.origin.lng() : c.origin.lng);
        if (typeof lat === 'number' && typeof lng === 'number') origines.set(c.sourceId, { lat, lng });
      });
    }
  } catch (e) { /* production non calculée */ }
  return origines;
}

/**
 * Production annuelle d'une ombrière : PVGIS PVcalc (JRC, via /api/pvgis) interrogé pan par pan avec
 * les MÊMES paramètres que le résumé « Système » (SummaryModal.chargerProductionChampsMaison) :
 * puissance, montage, pertes système du champ, pente et azimut du pan. Production nette de pertes
 * système ; aucun ombrage ajouté.
 * @returns {Promise<{productionKwhAn:number, productibleKwhKwc:number}|null>}
 */
export async function calculerProductionChamp(champ, origine) {
  if (!origine || !(champ.puissanceKwc > 0)) return null;
  let total = 0;
  for (const pan of champ.pans) {
    if (!(pan.puissanceKwc > 0)) continue;
    const pvgis = await GET_PVGIS_DATA(origine.lat, origine.lng, pan.puissanceKwc, pan.montage || 'free',
      pan.pertesPct, Number(pan.penteDeg) || 0, Number(pan.azimutDeg) || 0);
    const annuel = Number(pvgis && pvgis.annuel && pvgis.annuel.productionTotale);
    if (!Number.isFinite(annuel)) throw new Error("réponse du service d'ensoleillement invalide");
    total += annuel;
  }
  return { productionKwhAn: total, productibleKwhKwc: total / champ.puissanceKwc };
}

/**
 * Productible du bouton « Calculer et visualiser » (calcul d'autoconsommation, modal Études
 * économiques) : pvlib côté serveur (calculate_pv_data), AVEC la perte d'ombrage proche de la scène
 * 3D. Sa réponse est mise en cache par main_autoconso.js dans localStorage['solar_sim_data']
 * (pv_summary.fields : un élément par pan, id « PV1_Pan1 »). C'est lui qui fait foi dans le dossier
 * (demande explicite) ; PVGIS PVcalc sans ombrage n'est plus qu'un repli.
 *
 * Contrôle de fraîcheur : la puissance des pans calculés doit être celle du calepinage actuel (à 2 %
 * près) — sinon le calcul date d'avant une modification (ou d'un autre projet) et il est écarté.
 * @returns {{productionKwhAn, productibleKwhKwc, perteOmbragePct, source:'pvlib'}|null}
 */
export function productionPvlibChamp(champ) {
  let champs = [];
  try {
    const brut = JSON.parse(localStorage.getItem('solar_sim_data') || 'null');
    champs = (brut && brut.pv_summary && Array.isArray(brut.pv_summary.fields)) ? brut.pv_summary.fields : [];
  } catch (e) { return null; }
  const id = String(champ.sourceId);
  const pans = champs.filter((f) => f && (String(f.id) === id || String(f.id).startsWith(`${id}_`)));
  if (!pans.length) return null;
  const puissance = pans.reduce((s, f) => s + (Number(f.peak_power) || 0), 0);
  const production = pans.reduce((s, f) => s + (Number(f.total_production_kwh) || 0), 0);
  if (!(puissance > 0) || !(champ.puissanceKwc > 0) || Math.abs(puissance / champ.puissanceKwc - 1) > 0.02) return null;
  // Perte d'ombrage proche : moyenne pondérée par la puissance des pans pour lesquels elle est calculée.
  const avecOmbrage = pans.filter((f) => f.near_shading_loss_percent != null);
  const poids = avecOmbrage.reduce((s, f) => s + (Number(f.peak_power) || 0), 0);
  const perteOmbragePct = poids > 0
    ? avecOmbrage.reduce((s, f) => s + Number(f.near_shading_loss_percent) * (Number(f.peak_power) || 0), 0) / poids
    : null;
  return { productionKwhAn: production, productibleKwhKwc: production / puissance, perteOmbragePct, source: 'pvlib' };
}

/**
 * Avertissement « productible sans ombrage » (texte demandé par l'utilisateur, sans outil de calcul
 * cité) ; les champs restent dynamiques.
 */
export function messageSansOmbrage(ids) {
  const champs = ids.length > 1 ? `des champs ${ids.join(', ')}` : `du champ ${ids[0]}`;
  return `Aucune scène d’ombrage n’a été modélisée pour évaluer le productible ${champs}. Le rapport s’appuie donc sur une estimation sans ombrage. Ce résultat est une estimation brute qui n’engage pas Solakvan. Si besoin, cliquez sur « Calculer et visualiser », puis regénérez le rapport.`;
}

/** État du calcul pvlib pour l'affichage du modal : ombrières couvertes / manquantes. */
export function etatProductionPvlib(champsDossier) {
  const couverts = [];
  const manquants = [];
  champsDossier.forEach((c) => (productionPvlibChamp(c) ? couverts : manquants).push(c.sourceId));
  return { couverts, manquants };
}

function ordreCaptures(CM, champsDossier) {
  const actif = CM.state && CM.state.sourceId;
  const reference = (champsDossier.find((c) => c.sourceId === actif) || champsDossier[0]).sourceId;
  return [reference, ...champsDossier.map((c) => c.sourceId).filter((id) => id !== reference)];
}

/**
 * Capture de la vue 3D prise par l'utilisateur (appareil photo de la barre 3D), ou null : celle du
 * champ affiché d'abord, puis celles des autres ombrières. Seule une capture fidèle au plan 2D est
 * retenue (CM.getCapture3DUtilisateurAJour : implantation inchangée depuis la prise de vue, tous les
 * champs affichés) — bug rapporté : ombrières mal placées dans la vue 3D du dossier, la capture datant
 * d'avant un déplacement ou un ajout d'ombrière.
 * @returns {{sourceId:string, dataUrl:string}|null}
 */
export function captureUtilisateurProjet(champsDossier) {
  const CM = window.CalepinageMaisonIndiv;
  if (!CM || typeof CM.getCapture3DUtilisateurAJour !== 'function' || !champsDossier.length) return null;
  for (const id of ordreCaptures(CM, champsDossier)) {
    try {
      const capture = CM.getCapture3DUtilisateurAJour(id);
      if (capture && typeof capture.dataUrl === 'string' && capture.dataUrl.startsWith('data:image/')) {
        return { sourceId: id, dataUrl: capture.dataUrl };
      }
    } catch (e) { /* capture illisible : champ suivant */ }
  }
  return null;
}

/** Champ dont la capture utilisateur est écartée car périmée (pour l'information du modal), ou null. */
export function captureUtilisateurPerimee(champsDossier) {
  const CM = window.CalepinageMaisonIndiv;
  if (!CM || typeof CM.getCapture3DUtilisateur !== 'function' || !champsDossier.length) return null;
  if (captureUtilisateurProjet(champsDossier)) return null;
  return ordreCaptures(CM, champsDossier).find((id) => {
    try { return !!CM.getCapture3DUtilisateur(id); } catch (e) { return false; }
  }) || null;
}

/**
 * Vue 3D de TOUT le projet (une seule image dans le dossier), du meilleur au repli :
 *  1. capture prise par l'utilisateur (appareil photo de la vue 3D), si elle existe (demande
 *     explicite : sa vue remplace le rendu automatique) ;
 *  2. rendu automatique de tous les champs PV AVEC la vue aérienne, zoom quasi maximal sur les
 *     ombrières ; la carte est recapturée en couvrant tous les champs ;
 *  3. même rendu sans sol aérien.
 */
async function captureVue3DProjet(champsDossier, avertir) {
  const utilisateur = captureUtilisateurProjet(champsDossier);
  const perimee = utilisateur ? null : captureUtilisateurPerimee(champsDossier);
  if (perimee) {
    avertir(`Vue 3D du projet : votre capture (${perimee}) ne correspond plus à l'implantation des ombrières, rendu automatique utilisé.`);
  }
  if (utilisateur) {
    try {
      return await dataUrlToJpeg(utilisateur.dataUrl, { maxSide: 2400 });
    } catch (e) {
      console.warn('[Dossier de plans] Capture 3D utilisateur illisible, rendu automatique :', e);
      avertir(`Vue 3D du projet : votre capture (${utilisateur.sourceId}) est illisible, rendu automatique utilisé.`);
    }
  }
  const CM = window.CalepinageMaisonIndiv;
  if (!CM || typeof CM.captureVue3DImage !== 'function') return null;
  const base = { mode: 'iso', width: 2400, height: 1470, entier: true, tousLesChamps: true, ignorerCaptureUtilisateur: true };
  const actif = CM.state && CM.state.sourceId;
  const reference = (champsDossier.find((c) => c.sourceId === actif) || champsDossier[0]).sourceId;
  for (const options of [base, { ...base, sansSol: true }]) {
    try {
      const url = await CM.captureVue3DImage(reference, options);
      if (url) return await dataUrlToJpeg(url, { maxSide: 2400 });
    } catch (e) {
      console.warn('[Dossier de plans] Vue 3D du projet :', e);
    }
  }
  return null;
}

/**
 * Petit champ solaire (dossier mixte) : configurateur chargé hors écran comme pour son propre
 * dossier, puis résumé et plans relevés en une fois et iframe libérée. Seules la coupe d'ensemble
 * et la façade sont reprises (le détail de coupe et les fondations restent propres à son dossier).
 */
async function chargerPetitChamp(pvId) {
  try {
    const pont = await chargerPetitChampHorsEcran(pvId);
    const plans = pont.capturerPlans();
    return { resume: { ...pont.resume(), type: 'Petit champ solaire' }, plans: { coupe: plans.coupe, facade: plans.facade } };
  } finally {
    libererPetitChampHorsEcran();
  }
}

/** Résultats APER (null si le calculateur n'est pas chargé ou la carte pas prête). */
export function resultatsAper() {
  const calc = window.calculateurAPERInstance;
  if (!calc || typeof calc.resultatsPourRapport !== 'function') return null;
  try { return calc.resultatsPourRapport(); } catch (e) { console.warn('[Dossier de plans] APER :', e); return null; }
}

/**
 * @param {Object} ctx      construireContexte()
 * @param {Object} dossier  OmbriereDossierState
 * @param {string[]} ids    pièces à produire
 * @param {Object} opts     {onProgress(msg, ratio), isCancelled()}
 */
export async function capturerTout(ctx, dossier, ids, { onProgress, isCancelled } = {}) {
  const want = new Set(ids);
  const champsDossier = ctx.champsDossier;
  const captures = { warnings: [], carte: {}, aper: null, vue3dProjet: null, parChamp: {} };
  champsDossier.forEach((c) => { captures.parChamp[c.sourceId] = { canevas: null, resume: null, plans: null, production: null }; });
  const annule = () => { if (isCancelled && isCancelled()) throw new Error('Génération annulée.'); };
  const etapes = [];

  if (want.has('aper')) {
    captures.aper = resultatsAper();
    if (!captures.aper) captures.warnings.push('Loi APER : calcul indisponible (carte non prête).');
    else if (!captures.aper.aDesSurfaces) captures.warnings.push('Loi APER : aucune surface APER tracée sur la carte (outils « Loi APER » de la barre d\'outils).');
  }

  const piecesDp = [];
  if (want.has('situation')) piecesDp.push('dp1');
  if (want.has('calepinage_carte')) piecesDp.push('dp2');
  const vueAper = captures.aper && captures.aper.aDesSurfaces
    ? [{ key: 'aper', label: 'Vue des surfaces APER', layer: 'geoportail', pointLists: [...captures.aper.surfaces, ...captures.aper.exclusions] }]
    : [];
  if (piecesDp.length || vueAper.length) {
    etapes.push(['Captures de la carte', async () => {
      const cap = await captureAll(ctx, etatDp(dossier, champsDossier[0] && champsDossier[0].sourceId), piecesDp, {
        onProgress: (m) => onProgress && onProgress(m),
        isCancelled,
        echelleSituationProche: ECHELLE_SITUATION_PROCHE,
        vuesSupplementaires: vueAper,
      });
      captures.carte = cap;
      captures.warnings.push(...cap.warnings);
    }]);
  }

  if (want.has('vue_3d_projet') && champsDossier.length) {
    etapes.push(['Vue 3D du projet (tous les champs du dossier)', async () => {
      captures.vue3dProjet = await captureVue3DProjet(champsDossier, (m) => captures.warnings.push(m));
    }]);
  }

  if (want.has('geometrie') || want.has('presentation')) {
    // Productible pvlib avec ombrage (« Calculer et visualiser ») en priorité ; PVGIS en repli.
    const origines = originesChamps();
    const sansPvlib = [];
    champsDossier.forEach((c) => {
      const pvlib = productionPvlibChamp(c);
      if (pvlib) { captures.parChamp[c.sourceId].production = pvlib; return; }
      sansPvlib.push(c.sourceId);
      etapes.push([`Estimation de la production ${c.sourceId}`, async () => {
        const p = await calculerProductionChamp(c, origines.get(c.sourceId));
        captures.parChamp[c.sourceId].production = p ? { ...p, perteOmbragePct: null, source: 'pvgis' } : null;
      }]);
    });
    if (sansPvlib.length) captures.warnings.push(messageSansOmbrage(sansPvlib));
  }

  const besoinConfigurateur = ['coupe', 'facade', 'geometrie', 'presentation'].some((id) => want.has(id));
  champsDossier.forEach((c) => {
    const pc = captures.parChamp[c.sourceId];
    if (want.has('calepinage_canevas')) {
      etapes.push([`Plan de calepinage ${c.sourceId}`, async () => { pc.canevas = await captureCanevas(c.sourceId); }]);
    }
    // Toitures : aucun configurateur de structure (ni coupe ni façade, tableau tiré du calepinage).
    const charger = { ombrieres: () => chargerChamp(c.sourceId, c.typeMontage, { isCancelled }), petit_champ: () => chargerPetitChamp(c.sourceId) }[c.famille];
    if (besoinConfigurateur && charger) {
      etapes.push([`Configurateur ${c.libelleType.toLowerCase()} ${c.sourceId}`, async () => {
        const r = await charger();
        pc.resume = r.resume;
        pc.plans = r.plans;
      }]);
    }
  });

  let fait = 0;
  for (const [libelle, run] of etapes) {
    annule();
    if (onProgress) onProgress(libelle, fait / (etapes.length || 1));
    try {
      await run();
    } catch (e) {
      if (/annulée/.test(e.message)) throw e;
      console.warn(`[Dossier de plans] ${libelle} :`, e);
      captures.warnings.push(`${libelle} : capture impossible (${e.message}).`);
    }
    fait += 1;
  }

  if (want.has('vue_3d_projet') && !captures.vue3dProjet) {
    captures.warnings.push("Vue 3D du projet indisponible : ouvrez la vue 3D (bouton 3D de la carte), prenez une capture avec l'appareil photo, puis regénérez.");
  }
  champsDossier.forEach((c) => {
    const pc = captures.parChamp[c.sourceId];
    if ((want.has('geometrie') || want.has('presentation')) && !pc.production) {
      captures.warnings.push(`Production ${c.sourceId} non calculée (service d'ensoleillement indisponible ou champ non géolocalisé).`);
    }
    if (want.has('calepinage_canevas') && !pc.canevas) captures.warnings.push(`Plan de calepinage ${c.sourceId} : canevas indisponible.`);
    if (want.has('coupe') && pc.resume && !(pc.plans && pc.plans.coupe)) captures.warnings.push(`Plan de coupe ${c.sourceId} indisponible.`);
    if (want.has('facade') && pc.resume && !(pc.plans && pc.plans.facade)) captures.warnings.push(`Plan de façade ${c.sourceId} indisponible.`);
  });
  if (onProgress) onProgress('Captures terminées', 1);
  return captures;
}
