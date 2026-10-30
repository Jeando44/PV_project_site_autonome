/**
 * Chargement du catalogue "Optimiseurs" (NOUVEAU, demande explicite : ajout matériels BD onduleurs/
 * optimiseurs/batteries/pompage solaire). Contrairement à bd_onduleurs.js/bd_batteries.js, pas de
 * "favoris"/tableau d'édition ici : les optimiseurs sont consommés en LECTURE SEULE, filtrés par
 * compatibilité avec l'onduleur déjà choisi — cf. chaines_pertes_modal.js::computeFieldChainSizing
 * (sélecteur dans la modale Chaînes/Pertes) et calepinage_maison_formulaires.js (carte "Optimiseur"
 * du formulaire résidentiel). Même principe que window.onduleurCatalogFromApi/window.batteryCatalogFromApi :
 * cache brut de la réponse API, incluant `compatible_onduleurs` (bornes de chaîne/puissance par
 * modèle d'onduleur, cf. OptimiseurOnduleurCompat), consommé tel quel côté client.
 */
const OPTIMISEUR_CATALOG_ENDPOINT = '/concevoir_mon_projet/catalogue/optimiseurs';

function fetchOptimiseurCatalog() {
  return fetch(OPTIMISEUR_CATALOG_ENDPOINT)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((data) => {
      if (!data || !data.success || !Array.isArray(data.optimiseurs)) return;
      window.optimiseurCatalogFromApi = data.optimiseurs;
      document.dispatchEvent(new CustomEvent('optimiseurCatalogLoaded'));
    })
    .catch((e) => console.error('Erreur lors du chargement du catalogue optimiseurs (BD)', e));
}

window.fetchOptimiseurCatalog = fetchOptimiseurCatalog;

// Chargement initial best-effort, comme fetchOnduleurCatalog()/fetchBatterieCatalog() : les pages qui
// affichent des optimiseurs se raffraîchissent dès que la réponse arrive (event optimiseurCatalogLoaded).
fetchOptimiseurCatalog();
