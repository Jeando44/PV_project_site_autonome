import { download, loadJSZip } from '../../../declaration_prealable/DpExport.js';
import { preparerDevis } from '../../dossier_devis.js?v=5';
import { construireContexte, capturerTout } from './OmbriereDossierCaptures.js?v=10';
import { buildPdf, piecesOrdonnees, nomFichier } from './OmbriereDossierPieces.js?v=13';
import { codesPieces } from './OmbriereDossierState.js?v=9';

export { download };

function slug(value) {
  return String(value || 'projet').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'projet';
}

/**
 * Orchestration du dossier de plans « projet entier » — profil ombrières, toitures ou mixte, API et
 * quota du profil (state.profil.api) — (même déroulé que le petit champ solaire,
 * DossierExport.js) : captures une fois, validation serveur + consommation d'UNE génération, puis
 * téléchargements multiples (PDF complet, ZIP d'un PDF par pièce, pièce seule) sans quota.
 */
export default class OmbriereDossierExport {
  constructor(dossierState) {
    this.state = dossierState;
    this.result = null; // { ctx, captures, ids, generatedAt, quota }
    this._cancel = false;
  }

  cancel() {
    this._cancel = true;
  }

  async _autoriser(champs) {
    const projet = this.state.projet;
    const res = await fetch(`${this.state.profil.api}/${encodeURIComponent(projet)}/generer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ dossier: this.state.pourServeur(), champs: champs.map((c) => c.sourceId) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || `Génération refusée (erreur ${res.status}).`);
      err.details = json.erreurs || [];
      throw err;
    }
    return json.quota || null;
  }

  /** État du quota ({limite, utilisees, restantes}, limite null = illimité) ; null si indisponible. */
  async quota() {
    const projet = this.state.projet;
    if (!projet || projet === 'sans_projet') return null;
    try {
      const res = await fetch(`${this.state.profil.api}/${encodeURIComponent(projet)}/quota`, { credentials: 'same-origin' });
      return res.ok ? await res.json() : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Jamais de génération consommée pour rien : refus immédiat si aucun projet, aucun champ ou
   * quota épuisé ; captures ; puis validation serveur et consommation — le résultat n'est rendu que
   * si le serveur l'accepte.
   * @param {Object[]} champs champs retenus (listerChamps filtrée)
   */
  async generer(ids, champs, onProgress) {
    this._cancel = false;
    this.result = null;
    const projet = this.state.projet;
    if (!projet || projet === 'sans_projet') throw new Error('Aucun projet actif : ouvrez un projet avant de générer le dossier.');
    const ordre = piecesOrdonnees(this.state.pieces, ids);
    if (!ordre.length) throw new Error('Sélectionnez au moins une pièce.');
    if (!champs.length) throw new Error(`${this.state.profil.aucun} Si des champs existent, cochez-en au moins un.`);
    const q = await this.quota();
    if (q && q.limite != null && q.restantes <= 0) {
      throw new Error(`Quota atteint : ${q.limite} générations du dossier par projet.`);
    }
    // Devis vérifié AVANT les captures : un devis refusé ne coûte ni attente ni génération.
    let devis = null;
    if (ordre.includes('devis')) {
      if (onProgress) onProgress('Vérification du devis…', 0.01);
      devis = await preparerDevis({ detaille: !!this.state.data.devisDetaille });
    }
    if (onProgress) onProgress('Lecture du projet et de la parcelle cadastrale…', 0.02);
    const ctx = await construireContexte(this.state, champs);
    const captures = await capturerTout(ctx, this.state, ordre, { onProgress, isCancelled: () => this._cancel });
    captures.devis = devis;
    if (onProgress) onProgress('Vérification et enregistrement…', 1);
    const quota = await this._autoriser(champs);
    this.result = { ctx, captures, ids: ordre, generatedAt: new Date(), quota };
    return this.result;
  }

  /**
   * Parcours Chiffrage : devis repris et revérifié par le serveur, SANS refaire les plans ni
   * décompter de génération (devis modifié ou choix détaillé / synthétique changé).
   */
  async actualiserDevis() {
    if (!this.result || !this.result.ids.includes('devis')) return;
    this.result.captures.devis = await preparerDevis({ detaille: !!this.state.data.devisDetaille });
  }

  _base() {
    return `${this.state.profil.nomFichier}_${slug(this.result.ctx.cartouche.nom_projet)}`;
  }

  pdfComplet() {
    const pdf = buildPdf(this.result.ids, this.result.ctx, this.result.captures, this.state);
    return { blob: pdf.output('blob'), filename: `${this._base()}_complet.pdf` };
  }

  piece(id) {
    const pdf = buildPdf([id], this.result.ctx, this.result.captures, this.state, this.result.ids);
    return { blob: pdf.output('blob'), filename: `${this._base()}_${nomFichier(id, codesPieces(this.result.ids))}.pdf` };
  }

  async zip(onProgress) {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    const dossier = zip.folder(this._base());
    const codes = codesPieces(this.result.ids);
    for (const id of this.result.ids) {
      if (onProgress) onProgress(`Assemblage ${nomFichier(id, codes)}…`);
      const pdf = buildPdf([id], this.result.ctx, this.result.captures, this.state, this.result.ids);
      dossier.file(`${nomFichier(id, codes)}.pdf`, pdf.output('arraybuffer'));
      await new Promise((r) => setTimeout(r, 0)); // rend la main à l'interface entre deux pièces
    }
    dossier.file('dossier_complet.pdf', this.pdfComplet().blob);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    return { blob, filename: `${this._base()}.zip` };
  }
}
