import PlanDeMasseExporter from './plan_de_masse.js?v=6';
import triggerBlobDownload from './utils/BlobDownload.js';

/**
 * Pont « Exporter le plan de masse en DXF » entre le configurateur Petit champ solaire (iframe du
 * modal Géométrie) et cette page.
 *
 * L'export ne peut PAS tourner dans l'iframe : il lit la carte, window.drawingControl et
 * window.CalepinageMaisonPlans, qui vivent tous ici. Le bouton du configurateur envoie donc un
 * postMessage (cf. dossier_plans/iframe/pont_dossier.js), cette page génère le ZIP, le télécharge,
 * et renvoie l'avancement à l'iframe pour qu'elle affiche son statut. Même idiome et mêmes gardes
 * (origine + source = l'iframe du modal géométrie) que PetitChampDossierModal.
 *
 * Il s'agit exactement du plan produit par l'onglet « Plan de masse » du modal « Exporter les plans
 * en PDF et DXF » : le même exporteur est appelé, aucun tracé n'est dupliqué.
 */
const ACTION = 'exporterPlanDeMasseDxf';
const ACTION_RETOUR = 'exporterPlanDeMasseDxfRetour';

let enCours = false;

function fenetreIframeGeometrie() {
  const el = document.getElementById('geometrie-modal-iframe');
  return el ? el.contentWindow : null;
}

function repondre(source, charge) {
  if (source) source.postMessage({ action: ACTION_RETOUR, ...charge }, window.location.origin);
}

async function exporter(source, indice) {
  // Accusé de réception immédiat : c'est lui que l'iframe attend pour savoir que cette page sait
  // répondre (le configurateur peut être ouvert depuis une page sans carte ni exporteur).
  repondre(source, { etat: 'demarre' });
  if (enCours) {
    repondre(source, { etat: 'erreur', message: 'Un export de plan de masse est déjà en cours.' });
    return;
  }
  enCours = true;
  try {
    const { blob, filename } = await PlanDeMasseExporter.exportDxf({
      indice,
      onProgress: (message) => repondre(source, { etat: 'progression', message }),
    });
    triggerBlobDownload(blob, filename);
    repondre(source, { etat: 'termine', message: `DXF généré : ${filename}`, filename });
  } catch (e) {
    console.error('[PlanDeMassePont] Échec de l\'export DXF du plan de masse :', e);
    repondre(source, { etat: 'erreur', message: e.message || 'Échec de la génération du DXF.' });
  } finally {
    enCours = false;
  }
}

export default function installerPontPlanDeMasse() {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.action !== ACTION) return;
    if (event.source !== fenetreIframeGeometrie()) return;
    exporter(event.source, event.data.indice || 'A');
  });
}
