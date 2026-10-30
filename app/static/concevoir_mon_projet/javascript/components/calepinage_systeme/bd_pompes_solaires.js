/**
 * Chargement du catalogue "Pompes solaires" (NOUVEAU, demande explicite : "ajouter les données de
 * pompage solaire aussi"). Même principe minimal que bd_optimiseurs.js : pas de "favoris"/tableau
 * d'édition, lecture seule, consommée par calepinage_maison_formulaires.js (carte "Pompage solaire" du
 * formulaire résidentiel, #cmPompageSolaireCatalogSelect).
 */
const POMPE_SOLAIRE_CATALOG_ENDPOINT = '/concevoir_mon_projet/catalogue/pompes-solaires';

function fetchPompeSolaireCatalog() {
  return fetch(POMPE_SOLAIRE_CATALOG_ENDPOINT)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((data) => {
      if (!data || !data.success || !Array.isArray(data.pompes_solaires)) return;
      window.pompeSolaireCatalogFromApi = data.pompes_solaires;
      document.dispatchEvent(new CustomEvent('pompeSolaireCatalogLoaded'));
    })
    .catch((e) => console.error('Erreur lors du chargement du catalogue pompes solaires (BD)', e));
}

window.fetchPompeSolaireCatalog = fetchPompeSolaireCatalog;

fetchPompeSolaireCatalog();
