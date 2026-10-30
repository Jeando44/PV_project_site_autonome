// Importer les composants
import ErrorModal from './ErrorModal.js';
import SummaryModal from './SummaryModal.js';
import GraphModal from './GraphModal.js';
import DrawingControl from './DrawingControl/DrawingControl.js';
import ScaleControl from './ScaleControl/ScaleControl.js';

// Exporter les composants nommés
export {
  ErrorModal,
  SummaryModal,
  DrawingControl,
  GraphModal,
  ScaleControl
};

// Ajouter un export par défaut si nécessaire
export default {
  ErrorModal,
  SummaryModal,
  DrawingControl,
  GraphModal,
  ScaleControl
};

// Forcer la création du premier onglet du formulaire au chargement si le projet est vide.
//
// CORRECTIF (bug rapporté : « il y a ce message — "Ce champ PV n'a pas encore de calepinage" — or
// il y a un rectangle qui est tracé ») : cet onglet forcé était créé DÈS QUE tabs.size === 0, donc
// aussi quand le projet ne contient que des champs PV du module résidentiel (dont les contours sont
// restaurés plus tard, cf. polygon_maison.js). On obtenait alors un "PV1" vide, sans contour ni
// calepinage, affichant ce message — tandis que le rectangle réellement tracé portait un autre
// numéro. On n'ouvre donc cet onglet que si le projet n'a RIEN : ni forme "grands projets", ni champ
// PV résidentiel. Sinon, TabsManager.synchroniserOngletsAvecChampsMaison() crée les bons onglets.
//
// CORRECTIF (demande explicite : "comportement stable dès le premier chargement") : la décision était
// prise 800 ms après 'load', alors que les contours ne sont restaurés qu'APRÈS l'hydratation depuis la
// base — un projet dont les champs n'étaient pas encore restaurés recevait donc un "PV1" vide en trop.
// Elle est prise à la fin RÉELLE de la restauration ('maisonShapesRestored', cf. polygon_maison.js).
function ouvrirOngletSiProjetVide() {
  if (!window.tabManager || window.tabManager.tabs.size > 0) return;
  const mgr = window.MaisonPolygonManagerInstance;
  if (!mgr || (Array.isArray(mgr.polygons) && mgr.polygons.length > 0)) return;
  const formesProjet = window.drawingControl && window.drawingControl.drawnShapes;
  if (formesProjet && formesProjet.length > 0) return;
  document.dispatchEvent(new CustomEvent('requestNewTab'));
}
// Pas `once` : l'événement est réémis à chaque ouverture de projet sans rechargement de page
// (cf. selectAndLoadProject), dont les onglets ont été vidés ; la fonction est sans effet sinon.
if (window.__maisonShapesRestored) ouvrirOngletSiProjetVide();
document.addEventListener('maisonShapesRestored', ouvrirOngletSiProjetVide);
