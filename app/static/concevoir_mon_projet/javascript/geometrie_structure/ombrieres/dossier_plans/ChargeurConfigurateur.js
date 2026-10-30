/**
 * Charge le configurateur d'une ombrière (métal, bois ou Solumbra) dans une iframe HORS ÉCRAN, pour
 * un champ PV donné, et en relève le résumé et les plans vectoriels (coupe, façade).
 *
 * Le dossier couvre toutes les ombrières du projet alors que le modal de géométrie n'en affiche
 * qu'une à la fois : chaque configurateur est donc ouvert tour à tour, alimenté EXACTEMENT comme le
 * fait geometrieModal.js à l'ouverture (modèle et réglages mémorisés dans l'état du champ PV, puis
 * dimensions du calepinage), en deux passes + une passe après sa restauration interne. Aucun retour
 * vers l'état du champ n'est branché : le dossier lit, il ne modifie rien.
 *
 * L'iframe garde une vraie taille (1400 x 900) : les configurateurs ne dessinent rien dans un canevas
 * de taille nulle. Elle porte data-html2canvas-ignore (captures de la carte faites en parallèle).
 */

// Même correspondance que STRUCTURE_MODAL_MAPPING (geometrieModal.js), clé = type de montage du
// calepinage (CM.normalizeTypeMontage).
const URLS = {
  ombriere: '/concevoir_mon_projet/geometrie/ombriere',
  ombriere_metal: '/concevoir_mon_projet/geometrie/ombriere',
  ombriere_bois: '/concevoir_mon_projet/modal/ombriere_bois',
  ombriere_solumbra: '/concevoir_mon_projet/geometrie/ombriere_solumbra',
};

export function urlConfigurateur(typeMontage) {
  return URLS[typeMontage] || null;
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function creerIframe(url) {
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.title = 'Configurateur (dossier de plans)';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.setAttribute('data-html2canvas-ignore', 'true');
  Object.assign(iframe.style, {
    position: 'fixed', left: '-20000px', top: '0', width: '1400px', height: '900px',
    border: '0', visibility: 'hidden', pointerEvents: 'none',
  });
  document.body.appendChild(iframe);
  return iframe;
}

/**
 * @param {string} pvId          champ PV (sourceId du calepinage)
 * @param {string} typeMontage   ombriere_metal | ombriere_bois | ombriere_solumbra (| ombriere)
 * @returns {Promise<{resume:Object, plans:{coupe, facade}}>}
 */
export async function chargerChamp(pvId, typeMontage, { delaiMaxMs = 30000, isCancelled } = {}) {
  const base = urlConfigurateur(typeMontage);
  if (!base) throw new Error(`type de structure « ${typeMontage} » sans configurateur`);
  const service = window.CalepinageMaisonDimensionsOmbriere;
  const iframe = creerIframe(`${base}?pvId=${encodeURIComponent(pvId)}`);
  const minuteries = [];
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('configurateur trop long à charger')), delaiMaxMs);
      iframe.addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true });
    });
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('configurateur inaccessible');
    const injecter = () => {
      if (!service || iframe.contentDocument !== doc) return;
      try {
        if (typeof service.imposerReglagesModale === 'function') {
          service.imposerReglagesModale({ racine: doc, sourceId: pvId, complet: true });
        }
        service.injecterDansModal(null, { racine: doc, sourceId: pvId });
      } catch (e) {
        console.warn(`[Dossier ombrières] ${pvId} : injection des dimensions impossible`, e);
      }
    };
    injecter();
    minuteries.push(setTimeout(injecter, 400));
    // Restauration interne du configurateur (~1,5 s) : elle rejoue ses propres réglages par-dessus.
    doc.addEventListener('geometrieStructureRestauree', injecter);

    const fin = Date.now() + delaiMaxMs;
    while (!(iframe.contentWindow && iframe.contentWindow.OmbriereDossierPont)) {
      if (Date.now() > fin) throw new Error('pont du dossier absent du configurateur');
      if (isCancelled && isCancelled()) throw new Error('Génération annulée.');
      await attendre(100);
    }
    const pont = iframe.contentWindow.OmbriereDossierPont;
    const pret = await pont.pret({ delaiMaxMs: Math.max(3000, fin - Date.now()) });
    if (!pret) throw new Error('plans non calculés par le configurateur');
    return { resume: pont.resume(), plans: pont.capturerPlans() };
  } finally {
    minuteries.forEach(clearTimeout);
    iframe.remove();
  }
}
