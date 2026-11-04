import { download, loadJSZip } from '../../../declaration_prealable/DpExport.js';
import { preparerDevis } from '../../dossier_devis.js?v=5';
import { construireContexte, capturerTout } from './DossierCaptures.js?v=9';
import { buildPdf, piecesOrdonnees, nomFichier } from './DossierPieces.js?v=13';
import { codesPieces } from './DossierState.js?v=8';

export { download };

function slug(value) {
  return String(value || 'projet').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'projet';
}

/**
 * Orchestration du dossier de plans : validation serveur + quota (une génération consommée), puis
 * captures (une fois), puis téléchargements multiples à partir du même résultat en mémoire : PDF
 * complet, ZIP d'un PDF par pièce, pièce seule — ces téléchargements ne consomment pas de quota.
 */
export default class DossierExport {
  constructor(dossierState) {
    this.state = dossierState;
    this.result = null; // { ctx, captures, ids, generatedAt }
    this._cancel = false;
  }

  cancel() {
    this._cancel = true;
  }

  /**
   * Dernier contrôle serveur (paramètres + réglages, cf. petit_champ_solaire_routes.route_generer)
   * et consommation d'une génération. Lève une erreur lisible en cas de refus.
   */
  async _autoriser(pont) {
    const projet = this.state.projet;
    if (!projet || projet === 'sans_projet') throw new Error('Aucun projet actif : ouvrez un projet avant de générer le dossier.');
    const parametres = pont ? pont.instantane() : { fields: {}, activeButtons: [] };
    const res = await fetch(`/concevoir_mon_projet/api/petit_champ/${encodeURIComponent(projet)}/${encodeURIComponent(this.state.pvId)}/dossier/generer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ parametres, dossier: this.state.pourServeur() }),
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
      const res = await fetch(`/concevoir_mon_projet/api/petit_champ/${encodeURIComponent(projet)}/dossier/quota`, { credentials: 'same-origin' });
      return res.ok ? await res.json() : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Ordre voulu pour ne jamais consommer de génération pour rien : validation front (mêmes règles
   * que le serveur), refus immédiat si le quota est déjà épuisé, captures, puis validation serveur
   * et consommation d'UNE génération — le résultat n'est rendu que si le serveur l'accepte.
   */
  async generer(ids, pont, onProgress) {
    this._cancel = false;
    this.result = null;
    const ordre = piecesOrdonnees(ids);
    if (!ordre.length) throw new Error('Sélectionnez au moins une pièce.');
    if (onProgress) onProgress('Vérification des saisies…', 0);
    const erreurs = pont ? pont.valider() : [];
    if (erreurs.length) {
      const err = new Error('Saisies du configurateur invalides : corrigez-les avant de générer.');
      err.details = erreurs;
      throw err;
    }
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
    const ctx = await construireContexte(this.state, this.state.pvId);
    const captures = await capturerTout(ctx, this.state, ordre, pont, {
      onProgress, isCancelled: () => this._cancel,
    });
    captures.devis = devis;
    if (onProgress) onProgress('Vérification et enregistrement…', 1);
    const quota = await this._autoriser(pont);
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
    return `Dossier_plans_${slug(this.result.ctx.cartouche.nom_projet)}_${slug(this.state.pvId)}`;
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
