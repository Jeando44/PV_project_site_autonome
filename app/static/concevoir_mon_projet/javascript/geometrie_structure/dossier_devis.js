import PdfUtilities from '../services/PdfUtilities.js?v=2';

/**
 * Pièce « Devis » des dossiers de plans (ombrières, petit champ solaire) — parcours Chiffrage.
 *
 * Proposée UNIQUEMENT pour un projet dont le type d'étude est « Chiffrage » (window.isChiffrageProject) :
 * hors Chiffrage, la liste des pièces et le PDF restent strictement inchangés. Cochée par défaut,
 * décochable, toujours en dernière position.
 *
 * Même trame que le bouton « Générer le devis PDF » du modal de chiffrage : le dessin est celui de
 * DevisPdfGenerator.js (window.ResidentielChiffrage.PDF.dessiner), dans le MÊME document jsPDF que
 * les plans, avec l'en-tête / pied de page du devis (PdfUtilities.addHeaderFooter) sur ses seules
 * pages. Le devis est celui saisi dans l'application (tableau CAPEX en mémoire, sinon la base).
 *
 * Avant toute impression, les totaux HT / TTC sont recalculés par la route verifier-totaux : un
 * écart bloque la génération. Le devis doit aussi être à jour du calepinage (chiffrageObsolete).
 *
 * Messages affichés : ni outil de calcul ni lieu d'exécution (serveur, navigateur) — règle de
 * confidentialité du produit.
 */
export const PIECE_DEVIS = { id: 'devis', titre: 'Devis (chiffrage CAPEX)', format: 'portrait' };

export function devisPropose() {
  return typeof window.isChiffrageProject === 'function' && window.isChiffrageProject();
}

/**
 * Titre de la page de garde des dossiers de plans : « avant-projet » dans le parcours Chiffrage
 * (demande explicite), titre habituel sinon.
 */
export function titreDossierPlans() {
  return devisPropose() ? 'Dossier plans de conception avant-projet' : 'Dossier de plans de conception';
}

/**
 * Texte du quota de génération affiché dans les modals de dossier. Parcours Chiffrage : « chiffrages »
 * (demande explicite) ; sinon, générations du dossier.
 */
export function texteQuotaDossier(limite) {
  const n = Number(limite) > 0 ? Number(limite) : 5;
  return devisPropose()
    ? `Vous disposez d’un quota de ${n} chiffrages par projet.`
    : `Vous disposez d’un quota de ${n} générations du dossier par projet.`;
}

/** Ajoute la pièce « Devis » en fin de liste (une seule fois) pour un projet Chiffrage. */
export function ajouterPieceDevis(pieces) {
  if (devisPropose() && !pieces.some((p) => p.id === PIECE_DEVIS.id)) pieces.push(PIECE_DEVIS);
  return pieces;
}

function pdfApi() {
  const api = window.ResidentielChiffrage && window.ResidentielChiffrage.PDF;
  if (!api || typeof api.dessiner !== 'function') {
    throw new Error('Générateur de devis indisponible sur cette page : rechargez la page du calepinage.');
  }
  return api;
}

function projetId() {
  if (window.calepinageService && typeof window.calepinageService.getCurrentProjetId === 'function') {
    const id = window.calepinageService.getCurrentProjetId();
    if (id) return id;
  }
  return localStorage.getItem('current_projet_id');
}

/**
 * Chiffrage courant : tableau CAPEX en mémoire (modal de chiffrage déjà initialisé), sinon le
 * chiffrage enregistré ; null si aucun.
 */
async function lireChiffrage(api) {
  const Capex = window.ResidentielChiffrage && window.ResidentielChiffrage.Capex;
  if (Capex && typeof Capex.isProActive === 'function' && document.querySelector('#resi-capex-container .resi-section-header, #pro-capex-container .resi-section-header')) {
    if (document.querySelector('#resi-capex-container .is-invalid, #pro-capex-container .is-invalid')) {
      throw new Error('Devis : corrigez les champs signalés en rouge dans le modal Chiffrage avant de générer.');
    }
    return Capex.getData();
  }
  const enregistre = await api.chargerDevisEnregistre();
  return (enregistre && enregistre.capex) || null;
}

/** Panneaux posés au calepinage (total et 1re référence), comme ResidentielCapexTable. */
function panneauxCalepinage() {
  const CM = window.CalepinageMaisonIndiv;
  let resumes = [];
  try { resumes = CM && typeof CM.getAllPvFieldSummaries === 'function' ? CM.getAllPvFieldSummaries() || [] : []; } catch (e) { resumes = []; }
  const avecRef = resumes.find((s) => s && s.panelRef);
  return {
    total: resumes.reduce((s, r) => s + (Number(r && r.panelCount) || 0), 0),
    ref: avecRef ? String(avecRef.panelRef) : '',
  };
}

/** Ligne « Panneaux » du devis (clé panneaux_solaires, sinon désignation « Panneaux… »). */
function lignePanneaux(capexData) {
  const postes = (capexData && Array.isArray(capexData.postes)) ? capexData.postes : [];
  for (const poste of postes) {
    const l = (poste.lines || []).find((x) => x && x.key === 'panneaux_solaires');
    if (l) return l;
  }
  const materiels = postes.find((p) => p.key === 'materiels_pv');
  return materiels ? (materiels.lines || []).find((x) => /panneaux/i.test(x.designation || '')) || null : null;
}

/**
 * Chiffrage périmé par rapport au calepinage : nombre ou référence de panneaux différents (le
 * calepinage a changé depuis la dernière ouverture du modal de chiffrage). Le modal de chiffrage
 * reprend le calepinage à son ouverture : c'est l'action proposée à l'utilisateur.
 * @returns {string|null} message à afficher, ou null si le chiffrage est à jour
 */
export function chiffrageObsolete(capexData) {
  const cal = panneauxCalepinage();
  const ligne = lignePanneaux(capexData);
  if (!(cal.total > 0) || !ligne) return null;
  const qte = Number(ligne.qte) || 0;
  const refChiffrage = String(ligne.reference || '').trim();
  const autreRef = cal.ref && refChiffrage && cal.ref.trim() !== refChiffrage;
  if (qte === cal.total && !autreRef) return null;
  const detail = qte !== cal.total
    ? `${cal.total} panneau${cal.total > 1 ? 'x' : ''} au calepinage, ${qte} dans le chiffrage`
    : `panneau « ${cal.ref} » au calepinage, « ${refChiffrage} » dans le chiffrage`;
  return `Le calepinage a changé depuis le dernier chiffrage (${detail}). Actualisez le chiffrage avant d’exporter : ouvrez « Chiffrer votre projet », vérifiez les quantités et les prix, puis relancez l’export.`;
}

/** Contrôle avant l'export du dossier (parcours Chiffrage) : message si le chiffrage est périmé. */
export async function controlerChiffrageAJour() {
  const capexData = await lireChiffrage(pdfApi());
  return capexData ? chiffrageObsolete(capexData) : null;
}

/**
 * Données du devis à imprimer (lireChiffrage), vérifiées (forme, règles métier, totaux) et à jour
 * du calepinage.
 * @param {{detaille:boolean}} options
 * @returns {Promise<{capexData:object, detailed:boolean, devise:string, puissanceKwc:number|null,
 *   entete:object, totaux:{totalHt:number, totalTtc:number}}>}
 */
export async function preparerDevis({ detaille = false } = {}) {
  const api = pdfApi();
  const capexData = await lireChiffrage(api);
  if (!capexData || !Array.isArray(capexData.postes) || !capexData.postes.length) {
    throw new Error('Devis vide : saisissez le chiffrage (menu « Chiffrage ») avant de générer, ou décochez la pièce Devis.');
  }
  const obsolete = chiffrageObsolete(capexData);
  if (obsolete) throw new Error(obsolete);

  // Vérification des totaux (route verifier-totaux, aucune écriture).
  const totaux = api.totauxDevis(capexData);
  const id = projetId();
  if (!id) throw new Error('Aucun projet actif.');
  let json = null;
  try {
    const res = await fetch(`/concevoir_mon_projet/parametre-projet/${encodeURIComponent(id)}/residentiel-chiffrage/verifier-totaux`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ capex: capexData, totaux }),
    });
    json = await res.json().catch(() => null);
  } catch (e) {
    throw new Error('Vérification du devis impossible : connexion indisponible, réessayez.');
  }
  if (!json || !json.success) {
    throw new Error((json && json.message) || 'Devis refusé par la vérification.');
  }

  let entete = {};
  try { entete = (await PdfUtilities.getPersonnalisationRapport()) || {}; } catch (e) { entete = {}; }
  return {
    capexData: JSON.parse(JSON.stringify(capexData)),
    detailed: !!detaille,
    devise: api.getDeviseSymbol(),
    nomProjet: typeof api.getNomProjetCourant === 'function' ? api.getNomProjetCourant() : '',
    conversionDevise: capexData.conversionDevise || (typeof window.getConversionDeviseState === 'function' ? window.getConversionDeviseState() : null),
    puissanceKwc: api.getPuissanceProjetKwc(),
    entete,
    totaux,
  };
}

/**
 * Dessine la pièce « Devis » (synchrone, données préparées par preparerDevis()).
 * @param {{pdf:object|null}} builder - assembleur du dossier (pdf créé ici s'il n'existe pas encore)
 * @param {Function} addPage - DpLayout.addPage
 * @param {object} devis - résultat de preparerDevis()
 */
export function dessinerPieceDevis(builder, addPage, devis) {
  if (!devis) return;
  const pdf = addPage(builder, 'portrait');
  // Les sauts de page du tableau (autoTable) et du bloc signature appellent addPage() sans format :
  // jsPDF reprendrait celui de la 1re page du dossier (A3 paysage possible). Forcé en A4 portrait.
  const addPageOrigine = pdf.addPage;
  pdf.addPage = function (...args) { return addPageOrigine.apply(this, args.length ? args : ['a4', 'portrait']); };
  let pages;
  try {
    pages = pdfApi().dessiner(pdf, devis);
  } finally {
    pdf.addPage = addPageOrigine;
  }
  const { premierePage, dernierePage } = pages;
  PdfUtilities.addHeaderFooter(pdf, devis.entete, { depuisPage: premierePage, jusquaPage: dernierePage });
  pdf.setPage(pdf.getNumberOfPages());
}

// ---------------------------------------------------------------------------------------------
// Interface commune aux deux modals de dossier (parcours Chiffrage seulement).
// ---------------------------------------------------------------------------------------------

/** Étape « Pièces » : choix devis synthétique (postes) / détaillé (lignes). */
export function optionDevisHtml(data) {
  if (!devisPropose()) return '';
  const detaille = !!(data && data.devisDetaille);
  return `<div class="dp-help pcs-devis-option">
      <strong>Devis :</strong>
      <label><input type="radio" name="dossier-devis-detail" value="synthetique"${detaille ? '' : ' checked'}> synthétique (un total par poste)</label>
      <label><input type="radio" name="dossier-devis-detail" value="detaille"${detaille ? ' checked' : ''}> détaillé (toutes les lignes)</label>
      <br><small>Le devis est celui saisi dans le modal « Chiffrage » ; il est vérifié avant d'être ajouté en dernière page.</small>
    </div>`;
}

/**
 * Branche le choix détaillé / synthétique. Il ne rend pas le dossier périmé (aucune génération
 * décomptée) : seul le devis du résultat courant est recalculé.
 */
export function brancherOptionDevis(panel, state, exporter, onStatut) {
  panel.querySelectorAll('input[name="dossier-devis-detail"]').forEach((radio) => radio.addEventListener('change', async () => {
    state.set('devisDetaille', radio.value === 'detaille');
    if (exporter.result && exporter.result.ids.includes(PIECE_DEVIS.id)) {
      try {
        await exporter.actualiserDevis();
        if (onStatut) onStatut('Devis mis à jour dans le dossier (aucune génération décomptée).');
      } catch (e) {
        if (onStatut) onStatut(e.message || 'Mise à jour du devis impossible.', true);
      }
    }
  }));
}

/** Étape « Export » : boutons Aperçu et Mettre à jour le devis. */
export function boutonsDevisHtml(pret, result) {
  if (!devisPropose()) return '';
  const avecDevis = result && result.ids.includes(PIECE_DEVIS.id);
  return `<button type="button" class="dp-btn pcs-apercu"${pret ? '' : ' disabled'}><i class="bi bi-eye"></i> Aperçu</button>
    ${avecDevis ? `<button type="button" class="dp-btn pcs-maj-devis"${pret ? '' : ' disabled'} title="Reprend le devis actuel sans refaire les plans ni décompter de génération"><i class="bi bi-arrow-repeat"></i> Mettre à jour le devis</button>` : ''}`;
}

/**
 * @param {HTMLElement} panel
 * @param {{exporter, safe:Function, status:Function, apercu:Function}} actions
 */
export function brancherBoutonsDevis(panel, { exporter, safe, status, apercu }) {
  const btnApercu = panel.querySelector('.pcs-apercu');
  if (btnApercu) btnApercu.addEventListener('click', () => safe(() => apercu()));
  const btnMaj = panel.querySelector('.pcs-maj-devis');
  if (btnMaj) btnMaj.addEventListener('click', () => safe(async () => {
    status('Vérification et mise à jour du devis…');
    await exporter.actualiserDevis();
    status('Devis mis à jour (aucune génération décomptée) : ouvrez l’aperçu ou téléchargez.');
  }));
}
