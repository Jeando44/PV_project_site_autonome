/**
 * Configurateur du petit champ solaire chargé dans une iframe HORS ÉCRAN, pour produire son dossier
 * de plans sans ouvrir le modal de géométrie (export unifié du parcours Chiffrage, cf.
 * geometrie_structure/export_dossier_chiffrage.js).
 *
 * Même principe que ombrieres/dossier_plans/ChargeurConfigurateur.js : alimenté EXACTEMENT comme
 * geometrieModal.js à l'ouverture (modèle de poteaux puis dimensions du calepinage, deux passes +
 * une passe après la restauration interne du configurateur), SANS retour vers l'état du champ PV
 * (brancherRetourStructure non branché : le dossier lit, il ne modifie rien).
 *
 * Contrairement aux ombrières (plans relevés en une fois), le dossier du petit champ interroge son
 * pont pendant toute la génération (validation, paramètres, plans) : l'iframe reste donc en place
 * tant que le modal du dossier est ouvert, et `liberer()` la retire à sa fermeture.
 *
 * Expose window.PetitChampConfigurateurHorsEcran = { charger(pvId), pont(pvId), liberer() }.
 */
const URL_CONFIGURATEUR = '/concevoir_mon_projet/geometrie/petit_champ_';
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

let courant = null; // { pvId, iframe }

function liberer() {
  if (courant && courant.iframe) courant.iframe.remove();
  courant = null;
}

/** Pont du configurateur hors écran pour ce champ PV, ou null. */
function pont(pvId) {
  if (!courant || (pvId && courant.pvId !== pvId)) return null;
  try {
    const p = courant.iframe.contentWindow && courant.iframe.contentWindow.PetitChampDossierPont;
    return p && p.pvId === courant.pvId ? p : null;
  } catch (e) {
    return null;
  }
}

/**
 * Ouvre (ou réutilise) le configurateur du champ `pvId` hors écran et attend qu'il soit prêt.
 * @returns {Promise<object>} le pont PetitChampDossierPont
 */
async function charger(pvId, { delaiMaxMs = 30000 } = {}) {
  const deja = pont(pvId);
  if (deja) return deja;
  liberer();

  const iframe = document.createElement('iframe');
  iframe.src = `${URL_CONFIGURATEUR}?pvId=${encodeURIComponent(pvId)}`;
  iframe.title = 'Configurateur petit champ solaire (dossier de plans)';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.setAttribute('data-html2canvas-ignore', 'true');
  // Vraie taille : le configurateur ne dessine rien dans un canevas de taille nulle.
  Object.assign(iframe.style, {
    position: 'fixed', left: '-20000px', top: '0', width: '1400px', height: '900px',
    border: '0', visibility: 'hidden', pointerEvents: 'none',
  });
  courant = { pvId, iframe };
  document.body.appendChild(iframe);

  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('configurateur du petit champ trop long à charger')), delaiMaxMs);
      iframe.addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true });
    });
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('configurateur du petit champ inaccessible');
    const service = window.CalepinageMaisonDimensionsPetitChamp;
    const injecter = () => {
      if (!service || iframe.contentDocument !== doc) return;
      try {
        if (typeof service.injecterStructureDansModal === 'function') {
          service.injecterStructureDansModal({ racine: doc, sourceId: pvId });
        }
        service.injecterDansModal(null, { racine: doc, sourceId: pvId });
      } catch (e) {
        console.warn(`[Dossier petit champ] ${pvId} : injection du calepinage impossible`, e);
      }
    };
    // Restauration interne du configurateur (~1,5 s) : elle rejoue ses propres réglages par-dessus.
    const restaure = new Promise((resolve) => {
      doc.addEventListener('geometrieStructureRestauree', () => { injecter(); resolve(); }, { once: true });
      setTimeout(resolve, 4000);
    });
    injecter();
    setTimeout(injecter, 400);

    const fin = Date.now() + delaiMaxMs;
    while (!pont(pvId)) {
      if (Date.now() > fin) throw new Error('pont du dossier absent du configurateur du petit champ');
      await attendre(100);
    }
    await restaure;
    await attendre(600); // dernier dessin des plans après la dernière injection
    return pont(pvId);
  } catch (e) {
    liberer();
    throw e;
  }
}

window.PetitChampConfigurateurHorsEcran = { charger, pont, liberer };

export { charger, pont, liberer };
