import { charger as chargerPetitChampHorsEcran } from './petit_champ_solaire/dossier_plans/ConfigurateurHorsEcran.js?v=1';
import { familleStructure as famille, libelleType } from './dossier_profils.js?v=1';
import { controlerChiffrageAJour } from './dossier_devis.js?v=4';

/**
 * « Exporter le rapport » (ex « Exporter le dossier plans ») du parcours Chiffrage : point d'entrée UNIQUE, appelé par le bouton
 * du modal de chiffrage (ChiffrageModeView.js) et par celui de la palette du calepinage
 * (ButtonControl.js) — window.lancerExportDossierChiffrage().
 *
 * 1. Contrôles : projet actif, au moins un panneau au calepinage, devis sans champ invalide
 *    (enregistré tout de suite, sans attendre la sauvegarde différée).
 * 2. Familles de structures relues dans le calepinage : ombrières, petits champs solaires,
 *    toitures (résidentielle, terrasse, bâtiment incliné, autres).
 * 3. Un seul dossier possible : il s'ouvre directement. Sinon, une fenêtre de choix.
 * 4. Le dossier s'ouvre dans son modal habituel (par-dessus le modal de chiffrage) avec la pièce
 *    « Devis » cochée en dernier ; le petit champ n'exige plus le modal de géométrie ouvert
 *    (configurateur chargé hors écran). La génération affiche l'aperçu avant téléchargement.
 *
 * Dossiers « Toitures » (sans coupe ni façade) et « Mixte » (toutes les structures) : modal du
 * dossier des ombrières ouvert avec le profil correspondant (dossier_profils.js), quota séparé.
 */

function numero(sourceId) {
  const m = String(sourceId).match(/(\d+)/);
  return m ? Number(m[1]) : Infinity;
}

/** Champs PV du calepinage regroupés par champ (sourceId), avec leur famille de structure. */
export function champsDuCalepinage() {
  const CM = window.CalepinageMaisonIndiv;
  let resumes = [];
  try { resumes = CM && typeof CM.getAllPvFieldSummaries === 'function' ? CM.getAllPvFieldSummaries() || [] : []; } catch (e) { resumes = []; }
  const parChamp = new Map();
  resumes.forEach((r) => {
    if (!r || !r.sourceId) return;
    let c = parChamp.get(r.sourceId);
    if (!c) {
      c = { sourceId: r.sourceId, typeMontage: r.typeMontage, famille: famille(r.typeMontage), nbPanneaux: 0 };
      parChamp.set(r.sourceId, c);
    }
    c.nbPanneaux += Number(r.panelCount) || 0;
  });
  return [...parChamp.values()].filter((c) => c.nbPanneaux > 0)
    .sort((a, b) => numero(a.sourceId) - numero(b.sourceId) || String(a.sourceId).localeCompare(String(b.sourceId)));
}

/** Dossiers proposés pour ces champs : [{id, titre, detail, disponible, ouvrir}] */
export function dossiersProposes(champs) {
  const ombrieres = champs.filter((c) => c.famille === 'ombrieres');
  const petitsChamps = champs.filter((c) => c.famille === 'petit_champ');
  const toitures = champs.filter((c) => c.famille === 'toitures');
  const familles = new Set(champs.map((c) => c.famille));
  const liste = [];
  if (ombrieres.length) {
    liste.push({
      id: 'ombrieres', disponible: true,
      titre: 'Dossier plans des ombrières',
      detail: `${ombrieres.length} ombrière(s) : ${ombrieres.map((c) => c.sourceId).join(', ')}`,
      ouvrir: () => window.ombriereDossierModal.open(),
    });
  }
  petitsChamps.forEach((c) => liste.push({
    id: `petit_champ_${c.sourceId}`, disponible: true,
    titre: `Dossier plans du petit champ solaire ${c.sourceId}`,
    detail: `${c.nbPanneaux} panneaux`,
    ouvrir: async (statut) => {
      // Configurateur du modal de géométrie déjà ouvert sur ce champ : rien à charger.
      const pontOuvert = (() => {
        try {
          const f = document.getElementById('geometrie-modal-iframe');
          const p = f && f.contentWindow && f.contentWindow.PetitChampDossierPont;
          return p && p.pvId === c.sourceId;
        } catch (e) { return false; }
      })();
      if (!pontOuvert) {
        statut(`Préparation du configurateur du petit champ ${c.sourceId}…`);
        await chargerPetitChampHorsEcran(c.sourceId);
      }
      await window.petitChampDossierModal.open(c.sourceId);
    },
  }));
  if (toitures.length) {
    liste.push({
      id: 'toitures', disponible: true,
      titre: 'Dossier plans des toitures',
      detail: `${toitures.map((c) => `${c.sourceId} (${libelleType(c.typeMontage)})`).join(', ')} - sans coupe ni façade`,
      ouvrir: () => window.ombriereDossierModal.open({ profil: 'toitures' }),
    });
  }
  if (familles.size > 1) {
    liste.push({
      id: 'mixte', disponible: true,
      titre: 'Dossier plans mixte (toutes les structures)',
      detail: `Toutes les structures du projet dans un seul dossier : ${champs.map((c) => c.sourceId).join(', ')}`,
      ouvrir: () => window.ombriereDossierModal.open({ profil: 'mixte' }),
    });
  }
  return liste;
}

// ---------------------------------------------------------------------------------------------
// Fenêtre de choix / message (au-dessus du modal de chiffrage, sous les modals de dossier).
// ---------------------------------------------------------------------------------------------
function esc(texte) {
  return String(texte == null ? '' : texte).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fenetre(contenuHtml) {
  const voile = document.createElement('div');
  voile.className = 'chiffrage-export-fenetre';
  voile.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:1000050; display:flex; align-items:center; justify-content:center;';
  voile.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Exporter le rapport"
      style="background:#fff; border-radius:10px; width:min(560px, calc(100vw - 32px)); max-height:85vh; overflow:auto; padding:20px 22px; box-shadow:0 10px 30px rgba(0,0,0,0.25); font-size:0.95rem;">
      <h3 style="margin:0 0 12px; font-size:1.15rem;"><i class="fas fa-file-pdf"></i> Exporter le rapport</h3>
      ${contenuHtml}
      <div style="display:flex; justify-content:flex-end; margin-top:16px;">
        <button type="button" data-fermer class="btn btn-secondary">Fermer</button>
      </div>
    </div>`;
  const fermer = () => { document.removeEventListener('keydown', surTouche); voile.remove(); };
  const surTouche = (e) => { if (e.key === 'Escape') fermer(); };
  voile.addEventListener('click', (e) => { if (e.target === voile) fermer(); });
  voile.querySelector('[data-fermer]').addEventListener('click', fermer);
  document.addEventListener('keydown', surTouche);
  document.body.appendChild(voile);
  return { voile, fermer };
}

function message(texte) {
  fenetre(`<p style="margin:0;">${esc(texte)}</p>`);
}

/** Chiffrage périmé par rapport au calepinage : invitation à l'actualiser avant d'exporter. */
function inviterAActualiser(texte) {
  const { voile, fermer } = fenetre(`
    <p style="margin:0 0 14px;"><i class="fas fa-exclamation-triangle" style="color:#b45309;"></i> ${esc(texte)}</p>
    <button type="button" data-actualiser class="btn btn-success"><i class="fas fa-euro-sign"></i> Chiffrer votre projet</button>`);
  voile.querySelector('[data-actualiser]').addEventListener('click', () => {
    fermer();
    if (typeof window.openChiffrageModal === 'function') window.openChiffrageModal();
  });
}

async function ouvrirDossier(dossier, statut) {
  try {
    await dossier.ouvrir(statut);
    statut('');
  } catch (e) {
    console.error('[Export dossier chiffrage]', e);
    statut('');
    message(`Ouverture du dossier impossible : ${e.message || e}`);
  }
}

function choisir(dossiers, statut) {
  const { voile, fermer } = fenetre(`
    <p style="margin:0 0 10px;">Plusieurs dossiers sont possibles pour ce projet. Le devis est ajouté en dernière page.</p>
    <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:8px;">
      ${dossiers.map((d) => `<li>
        <button type="button" data-dossier="${esc(d.id)}" ${d.disponible ? '' : 'disabled'}
          style="width:100%; text-align:left; padding:10px 12px; border:1px solid #d1d5db; border-radius:8px; background:${d.disponible ? '#fff' : '#f3f4f6'}; cursor:${d.disponible ? 'pointer' : 'not-allowed'};">
          <strong>${esc(d.titre)}</strong>${d.disponible ? '' : ' <em style="color:#b45309;">— Bientôt disponible</em>'}
          <br><small style="color:#6b7280;">${esc(d.detail)}</small>
        </button>
      </li>`).join('')}
    </ul>`);
  voile.querySelectorAll('[data-dossier]').forEach((b) => b.addEventListener('click', () => {
    const d = dossiers.find((x) => x.id === b.dataset.dossier);
    if (!d || !d.disponible) return;
    fermer();
    ouvrirDossier(d, statut);
  }));
}

/**
 * Enregistre le projet en base avant l'export : calepinage (services PRO et toiture, sans réécriture
 * s'il n'a pas changé) et chiffrage (s'il a été ouvert). Les pièces du dossier et le recalcul des
 * totaux du devis lisent la base : un projet non enregistré donnerait un rapport faux.
 * @returns {Promise<string|null>} message d'échec, ou null si tout est enregistré
 */
export async function enregistrerProjet() {
  if (typeof window.projetActifVerrouille === 'function' && window.projetActifVerrouille()) {
    return 'Le projet a changé dans un autre onglet : rechargez la page.';
  }
  const enregistrements = [];
  const pro = window.calepinageService;
  if (pro && typeof pro.saveToDatabase === 'function') enregistrements.push(pro.saveToDatabase());
  const maison = window.CalepinageMaisonPersistenceDB;
  if (maison && typeof maison.saveToDatabase === 'function') {
    // Sauvegarde déjà en cours (automatique ou « Calculer ») : on l'attend au lieu d'en relancer une.
    const enCours = typeof maison.sauvegardeEnCours === 'function' && maison.sauvegardeEnCours();
    enregistrements.push(enCours || maison.saveToDatabase());
  }
  const RC = window.ResidentielChiffrage || {};
  const capexOuvert = RC.Capex && typeof RC.Capex.getData === 'function' && (RC.Capex.getData().postes || []).length > 0;
  if (capexOuvert && RC.DB && typeof RC.DB.pushToDatabase === 'function') enregistrements.push(RC.DB.pushToDatabase());

  const resultats = await Promise.allSettled(enregistrements);
  const echec = resultats.find((r) => r.status === 'rejected'
    || (r.value && r.value.success === false && !r.value.skipped));
  if (!echec) return null;
  const detail = echec.status === 'rejected' ? (echec.reason && echec.reason.message) : echec.value.message;
  return detail || 'erreur inconnue';
}

/** Projet non enregistré : l'utilisateur est invité à le sauvegarder avant de relancer l'export. */
// Pas de bouton « Sauvegarder » ici : window.sauvegarder() (menu) vide la page après l'enregistrement.
function demanderSauvegarde(detail) {
  fenetre(`
    <p style="margin:0 0 10px;"><i class="fas fa-exclamation-triangle" style="color:#b45309;"></i>
      Le projet n’a pas pu être enregistré avant l’export (${esc(detail)}).</p>
    <p style="margin:0;">Sauvegardez le projet (« Sauvegarder les paramètres du projet » dans Paramètres projet), puis cliquez de nouveau sur « Exporter le rapport ».</p>`);
}

/**
 * @param {{onStatut?: Function}} [options] - onStatut(message) : ligne d'état de l'appelant
 */
export async function lancerExportDossierChiffrage(options = {}) {
  const statut = (m) => { if (typeof options.onStatut === 'function') options.onStatut(m || ''); };
  if (!localStorage.getItem('current_projet_id')) {
    message('Ouvrez un projet avant d’exporter le rapport.');
    return;
  }
  if (document.querySelector('#resi-capex-container .is-invalid, #pro-capex-container .is-invalid')) {
    message('Corrigez les champs du devis signalés en rouge (menu « Chiffrage ») avant d’exporter.');
    return;
  }
  statut('Enregistrement du projet…');
  const echecEnregistrement = await enregistrerProjet();
  statut('');
  if (echecEnregistrement) {
    demanderSauvegarde(echecEnregistrement);
    return;
  }
  // Calepinage enregistré : la puissance du serveur (bandeau, #puissance, devis) est à jour.
  if (window.ChiffrageModeView && typeof window.ChiffrageModeView.rafraichir === 'function') {
    try { await window.ChiffrageModeView.rafraichir(); } catch (e) { /* bandeau seulement */ }
  }

  // Calepinage modifié depuis le dernier chiffrage : le devis du dossier serait faux.
  let perime = null;
  try { perime = await controlerChiffrageAJour(); } catch (e) { perime = null; /* revérifié à la génération */ }
  if (perime) {
    inviterAActualiser(perime);
    return;
  }

  const champs = champsDuCalepinage();
  if (!champs.length) {
    message('Aucun panneau au calepinage : tracez au moins un champ PV avant d’exporter le rapport.');
    return;
  }
  const dossiers = dossiersProposes(champs);
  const disponibles = dossiers.filter((d) => d.disponible);
  if (disponibles.length === 1 && dossiers.length === 1) {
    await ouvrirDossier(disponibles[0], statut);
    return;
  }
  // Plusieurs dossiers, ou seulement des dossiers à venir : la fenêtre de choix l'indique.
  choisir(dossiers, statut);
}

window.lancerExportDossierChiffrage = lancerExportDossierChiffrage;
