import { buildContext, captureAll } from '../../../declaration_prealable/DpCaptures.js?v=6';
import { canvasToJpeg, dataUrlToJpeg } from '../../../declaration_prealable/DpImages.js';
import { GET_PVGIS_DATA } from '../../../../API/API.js';
import { ECHELLE_SITUATION_PROCHE } from './DossierState.js?v=8';

/**
 * Phase de CAPTURE du dossier de plans (la seule coûteuse), exécutée une fois par génération ;
 * l'assemblage (DossierPieces.js) rejoue ensuite ces résultats pour le PDF complet, le ZIP ou une
 * pièce seule, sans rien recapturer.
 *
 * Sources :
 *  - plans de situation (1/10000 OSM et 1/1000 Géoportail) et fond du plan de calepinage : captures
 *    de la Déclaration préalable (DpCaptures.captureAll), échelles garanties par ScaleAlignedCapture ;
 *  - calepinage sans la carte : canevas du calepinage (CM.captureRoofDiagramImage), avec son
 *    nombre de pixels par mètre pour le poser à une échelle exacte ;
 *  - vue 3D : module 3D du calepinage (CM.captureVue3DImage, capture utilisateur prioritaire) ;
 *  - résultats : même calcul que le bouton « Calculer » du calepinage shed
 *    (CalepinageMaisonShedsActions.resultatsPourRapport), puis productible PVGIS ;
 *  - coupe, détail de coupe, façade, fondations : entités vectorielles du configurateur (iframe, via
 *    le pont).
 */

/** Pseudo-état DP : seuls les réglages lus par buildContext/captureAll. */
function etatDp(dossier, pvId) {
  const d = dossier.data;
  return {
    data: {
      indice: d.indice || 'A',
      adresse: d.adresse || '',
      typeDemandeur: 'particulier',
      civilite: '',
      nom: d.maitreOuvrage || '',
      champId: pvId,
      echelleMasse: 'auto',
    },
    images: {},
  };
}

export async function construireContexte(dossier, pvId) {
  const ctx = await buildContext(etatDp(dossier, pvId));
  ctx.titreDemandeur = "Maître d'ouvrage";
  ctx.pvId = pvId;
  let resumes = [];
  try {
    const CM = window.CalepinageMaisonIndiv;
    resumes = CM && typeof CM.getAllPvFieldSummaries === 'function' ? CM.getAllPvFieldSummaries() : [];
  } catch (e) { resumes = []; }
  const duChamp = resumes.filter((r) => r.sourceId === pvId);
  ctx.nbPanneaux = duChamp.reduce((s, r) => s + (r.panelCount || 0), 0);
  ctx.puissanceKwc = duChamp.reduce((s, r) => s + (r.peakPower || 0), 0);
  return ctx;
}

// -------------------------------------------------------------------------------------------
// Résultats du bouton « Calculer » et productible
// -------------------------------------------------------------------------------------------

/**
 * Productible PVGIS du champ, décomposé : PVGIS est interrogé SANS perte système (loss = 0) ; les
 * pertes système puis l'ombrage entre sheds sont appliqués ensuite, comme PVGIS le fait lui-même
 * (production x (1 - pertes)) et comme le résumé du projet combine les deux pertes
 * (SummaryModal : 1 - (1 - système) x (1 - ombrage)).
 * avecTerrain (case « prendre en compte le terrain » cochée, même règle que la production du
 * projet) : la perte avec terrain REMPLACE la perte entre sheds plate, et PVGIS reçoit la pente et
 * l'azimut RÉELS des tables ; sans perte avec terrain disponible, repli sur le calcul plat.
 */
async function calculerProduction(r, position, avecTerrain) {
  if (!position || !(r.puissanceKwc > 0)) return { erreur: 'adresse du projet non géolocalisée ou puissance nulle.' };
  const perteSysteme = Number.isFinite(r.perteSysteme) ? r.perteSysteme : 0;
  const terrain = !!avecTerrain && r.perteOmbrageTerrainBrute != null && r.penteReelleDeg != null;
  const perteOmbrageBrute = terrain ? r.perteOmbrageTerrainBrute : r.perteOmbrageBrute;
  const perteOmbrage = perteOmbrageBrute == null ? 0 : perteOmbrageBrute;
  const pente = terrain ? r.penteReelleDeg : (r.penteDeg || 0);
  const azimut = terrain ? r.azimutReelDeg : (r.azimutDeg || 0);
  const pvgis = await GET_PVGIS_DATA(position.lat, position.lng, r.puissanceKwc, r.montagePvgis || 'free', 0, pente, azimut);
  const brute = Number(pvgis && pvgis.annuel && pvgis.annuel.productionTotale);
  if (!Number.isFinite(brute)) return { erreur: "réponse du service d'ensoleillement invalide." };
  const nette = brute * (1 - perteSysteme / 100) * (1 - perteOmbrage / 100);
  return {
    irradiation: Number(pvgis.annuel.irradiationTotale),
    productionBrute: brute,
    perteSysteme,
    perteOmbrage,
    perteOmbrageCalculee: perteOmbrageBrute != null,
    ombrageAvecTerrain: terrain,
    penteProduction: pente,
    azimutProduction: azimut,
    perteTotale: 100 * (1 - (1 - perteSysteme / 100) * (1 - perteOmbrage / 100)),
    productionNette: nette,
    productibleNet: nette / r.puissanceKwc,
  };
}

/**
 * Résultats complets du champ pour le dossier : indicateurs du bouton « Calculer » (sans ouvrir le
 * modal) + productible net d'ombrage et de pertes système.
 * @returns {Promise<{resultat:Object|null, production:Object|null, vide:boolean, alertes:string[]}>}
 */
export async function calculerResultats(pvId) {
  const actions = window.CalepinageMaisonShedsActions;
  const alertes = [];
  const vide = { resultat: null, production: null, vide: true, alertes };
  if (!actions || typeof actions.resultatsPourRapport !== 'function') return vide;
  const calc = await actions.resultatsPourRapport(pvId);
  if (!calc || !calc.resultat) return vide;
  const r = calc.resultat;
  const avecTerrain = !!calc.terrainProduction;
  if (avecTerrain && r.perteOmbrageTerrainBrute == null) {
    alertes.push(`Perte d'ombrage avec terrain non calculée${r.erreurOmbrageTerrain ? ` (${r.erreurOmbrageTerrain})` : ''} : productible calculé sur terrain plat.`);
  }
  if (r.perteOmbrageBrute == null && !(avecTerrain && r.perteOmbrageTerrainBrute != null)) {
    alertes.push(`Perte d'ombrage entre sheds non calculée${r.erreurOmbrage ? ` (${r.erreurOmbrage})` : ''} : productible sans ombrage.`);
  }
  let production = null;
  try {
    production = await calculerProduction(r, calc.position, avecTerrain);
    if (production.erreur) {
      alertes.push(`Productible non calculé : ${production.erreur}`);
      production = null;
    }
  } catch (e) {
    alertes.push(`Productible non calculé : service d'ensoleillement indisponible (${e.message}).`);
  }
  return { resultat: r, production, vide: false, alertes };
}

// -------------------------------------------------------------------------------------------
// Canevas et 3D
// -------------------------------------------------------------------------------------------
export async function captureCanevas(sourceId) {
  const CM = window.CalepinageMaisonIndiv;
  if (!CM || typeof CM.captureRoofDiagramImage !== 'function' || typeof CM.getHouseStateById !== 'function') return null;
  const state = CM.getHouseStateById(sourceId);
  if (!state) return null;
  const cles = ['showPanels', 'showBackgroundImage', 'showOrientationCard', 'showStructure', 'showCotations'];
  const sauve = {};
  cles.forEach((k) => { sauve[k] = state[k]; });
  // Calepinage seul : panneaux et cotations, sans photo aérienne (« sans la carte »).
  Object.assign(state, { showPanels: true, showBackgroundImage: false, showOrientationCard: true, showStructure: false, showCotations: true });
  try {
    // Proportions de la zone utile A3 (~404 x 247 mm), assez de pixels pour l'impression.
    const canvas = await CM.captureRoofDiagramImage(sourceId, 2600, 1590, { margeMetres: 2 });
    if (!canvas) return null;
    // Pixels du canevas par mètre réel (repère local du calepinage) : pose à une échelle exacte.
    let pxParM = null;
    if (typeof canvas.localVersPixels === 'function') {
      const a = canvas.localVersPixels({ x: 0, y: 0 });
      const b = canvas.localVersPixels({ x: 1, y: 0 });
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (Number.isFinite(d) && d > 0) pxParM = d;
    }
    const largeurCanvas = canvas.width;
    const image = canvasToJpeg(canvas, { maxSide: 2600, quality: 0.9 });
    // canvasToJpeg peut réduire l'image : même rapport pour les pixels par mètre.
    return { ...image, pxParM: pxParM ? pxParM * (image.width / largeurCanvas) : null };
  } finally {
    Object.assign(state, sauve);
  }
}

/**
 * Capture de la vue 3D prise par l'utilisateur (appareil photo de la barre 3D) pour ce champ, ou
 * null. Elle a la priorité sur le rendu automatique dans le dossier (demande explicite), à condition
 * d'être fidèle au plan 2D (CM.getCapture3DUtilisateurAJour : implantation inchangée depuis la prise
 * de vue, tous les champs affichés) — bug rapporté : structures mal placées dans la vue 3D du dossier,
 * la capture datant d'avant un déplacement ou un ajout de champ.
 */
export function captureUtilisateur3D(sourceId) {
  const CM = window.CalepinageMaisonIndiv;
  if (!CM || typeof CM.getCapture3DUtilisateurAJour !== 'function' || !sourceId) return null;
  try {
    const capture = CM.getCapture3DUtilisateurAJour(sourceId);
    return capture && typeof capture.dataUrl === 'string' && capture.dataUrl.startsWith('data:image/') ? capture : null;
  } catch (e) {
    return null;
  }
}

/** Vrai si une capture utilisateur existe pour ce champ mais ne correspond plus au plan 2D. */
export function captureUtilisateur3DPerimee(sourceId) {
  const CM = window.CalepinageMaisonIndiv;
  if (!CM || typeof CM.getCapture3DUtilisateur !== 'function' || !sourceId) return false;
  try {
    return !!CM.getCapture3DUtilisateur(sourceId) && !captureUtilisateur3D(sourceId);
  } catch (e) {
    return false;
  }
}

/**
 * Vue 3D du dossier : capture de l'utilisateur si elle est à jour, sinon rendu automatique (zoom
 * quasi maximal), puis le même rendu sans vue aérienne en dernier repli. Le rendu montre tous les
 * champs de la carte, comme la vue 2D, et non le seul champ du dossier.
 */
export async function capture3D(sourceId, avertir) {
  const CM = window.CalepinageMaisonIndiv;
  const utilisateur = captureUtilisateur3D(sourceId);
  if (!utilisateur && captureUtilisateur3DPerimee(sourceId) && avertir) {
    avertir("Vue 3D : votre capture ne correspond plus à l'implantation des champs PV, rendu automatique utilisé.");
  }
  if (utilisateur) {
    try {
      return await dataUrlToJpeg(utilisateur.dataUrl, { maxSide: 2400 });
    } catch (e) {
      console.warn('[Dossier petit champ] Capture 3D utilisateur illisible, rendu automatique :', e);
      if (avertir) avertir('Vue 3D : votre capture est illisible, rendu automatique utilisé.');
    }
  }
  if (!CM || typeof CM.captureVue3DImage !== 'function') return null;
  let nbChamps = 0;
  try { nbChamps = typeof CM.listerChampsCarte === 'function' ? CM.listerChampsCarte().length : 0; } catch (e) { nbChamps = 0; }
  const options = { mode: 'iso', width: 2400, height: 1470, entier: true, ignorerCaptureUtilisateur: true, tousLesChamps: nbChamps > 1 };
  // entier : le champ complet dans l'image (un grand champ vu en perspective était coupé sur ses
  // bords par le rognage « rectangle plein » de la vue Iso du rapport résidentiel).
  let url = await CM.captureVue3DImage(sourceId, options);
  if (!url) {
    // Repli : une vue sans la vue aérienne vaut mieux qu'aucune vue.
    url = await CM.captureVue3DImage(sourceId, { ...options, sansSol: true });
    if (url && avertir) avertir('Vue 3D : vue aérienne indisponible sous les panneaux, vue produite sans elle.');
  }
  return url ? dataUrlToJpeg(url, { maxSide: 2400 }) : null;
}

/**
 * @param {Object} ctx      construireContexte()
 * @param {Object} dossier  DossierState
 * @param {string[]} ids    pièces à produire
 * @param {Object} pont     window.PetitChampDossierPont de l'iframe du configurateur
 * @param {Object} opts     {onProgress(msg, ratio), isCancelled()}
 */
export async function capturerTout(ctx, dossier, ids, pont, { onProgress, isCancelled } = {}) {
  const want = new Set(ids);
  const pvId = ctx.pvId;
  const captures = { warnings: [], carte: {}, canevas: null, vue3d: null, plans: null, resume: null, resultats: null };
  const annule = () => { if (isCancelled && isCancelled()) throw new Error('Génération annulée.'); };
  const etapes = [];

  // Plans du configurateur (instantané, sans effet de bord) : d'abord, pour échouer tôt.
  if (pont) {
    captures.resume = pont.resume();
    if (['coupe', 'facade', 'fondations'].some((id) => want.has(id))) {
      etapes.push(['Plans de coupe, façade et fondations', async () => { captures.plans = pont.capturerPlans(); }]);
    }
  } else if (['coupe', 'facade', 'fondations', 'presentation'].some((id) => want.has(id))) {
    captures.warnings.push('Configurateur fermé : coupe, façade et fondations indisponibles.');
  }
  // Résultats et productible : aussi repris sur la page de présentation (chiffres clés).
  if (want.has('resultats') || want.has('presentation')) {
    etapes.push(['Résultats du calepinage et productible', async () => {
      captures.resultats = await calculerResultats(pvId);
      captures.warnings.push(...captures.resultats.alertes);
    }]);
  }
  const piecesDp = [];
  if (want.has('situation')) piecesDp.push('dp1');
  if (want.has('calepinage_carte')) piecesDp.push('dp2');
  if (piecesDp.length) {
    etapes.push(['Captures de la carte', async () => {
      const cap = await captureAll(ctx, etatDp(dossier, pvId), piecesDp, {
        onProgress: (m) => onProgress && onProgress(m),
        isCancelled,
        echelleSituationProche: ECHELLE_SITUATION_PROCHE,
      });
      captures.carte = cap;
      captures.warnings.push(...cap.warnings);
    }]);
  }
  if (want.has('calepinage_canevas')) etapes.push(['Plan de calepinage (canevas)', async () => { captures.canevas = await captureCanevas(pvId); }]);
  if (want.has('vue_3d')) etapes.push(['Vue 3D du calepinage', async () => { captures.vue3d = await capture3D(pvId, (m) => captures.warnings.push(m)); }]);

  let fait = 0;
  for (const [libelle, run] of etapes) {
    annule();
    if (onProgress) onProgress(libelle, fait / (etapes.length || 1));
    try {
      await run();
    } catch (e) {
      if (/annulée/.test(e.message)) throw e;
      // Saisie invalide : on arrête tout (un plan faux ne doit pas partir dans le dossier).
      if (/Saisie invalide/.test(e.message)) throw e;
      console.warn(`[Dossier petit champ] ${libelle} :`, e);
      captures.warnings.push(`${libelle} : capture impossible (${e.message}).`);
    }
    fait += 1;
  }

  if (want.has('calepinage_canevas') && !captures.canevas) captures.warnings.push('Plan de calepinage : canevas indisponible.');
  if (want.has('vue_3d') && !captures.vue3d) captures.warnings.push('Vue 3D indisponible : ouvrez la vue 3D du calepinage une fois.');
  if (want.has('resultats') && (!captures.resultats || captures.resultats.vide)) {
    captures.warnings.push('Résultats : aucun calepinage shed exploitable pour ce champ (type « Shed » et panneaux posés requis).');
  }
  if (want.has('coupe') && captures.plans && !captures.plans.coupeDetail) {
    captures.warnings.push("Plan de coupe : détail d'un shed indisponible.");
  }
  if (want.has('fondations') && captures.plans && !captures.plans.fondation) {
    captures.warnings.push('Détail des fondations : aucun ancrage dessiné sur le plan de coupe.');
  }
  if (onProgress) onProgress('Captures terminées', 1);
  return captures;
}
