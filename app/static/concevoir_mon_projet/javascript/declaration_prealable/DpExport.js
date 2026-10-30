import { buildContext, captureAll } from './DpCaptures.js?v=6';
import { buildPdf, piecesOrdonnees, NOMS_FICHIERS } from './DpPieces.js';
import { orientationDepuisAzimut } from './DpNotice.js';

/**
 * Orchestration du dossier DP : génération (captures, une fois) puis téléchargements multiples
 * (PDF complet, ZIP d'un PDF par pièce, pièce seule) à partir du même résultat en mémoire.
 * Tout se passe dans le navigateur : aucun appel serveur pour produire les PDF.
 */
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

let jszipPromise = null;
export function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipPromise) {
    jszipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSZIP_URL;
      s.async = true;
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => { jszipPromise = null; reject(new Error('Chargement de JSZip impossible (connexion ?).')); };
      document.head.appendChild(s);
    });
  }
  return jszipPromise;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function slug(value) {
  return String(value || 'projet').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'projet';
}

/**
 * Valeurs déduites du calepinage résidentiel : nombre total de panneaux et orientation(s) des
 * pans équipés (champ choisi, ou tous les champs).
 */
export function deduireDuCalepinage(champId) {
  const CM = window.CalepinageMaisonIndiv;
  let summaries = [];
  try { summaries = CM && typeof CM.getAllPvFieldSummaries === 'function' ? CM.getAllPvFieldSummaries() : []; } catch (e) { summaries = []; }
  const nbPanneaux = summaries.reduce((s, x) => s + (x.panelCount || 0), 0);
  const pansChamp = champId ? summaries.filter((x) => x.sourceId === champId) : summaries;
  const orientations = [...new Set((pansChamp.length ? pansChamp : summaries).map((x) => orientationDepuisAzimut(x.azimuth)))];
  const champs = [...new Set(summaries.map((x) => x.sourceId))];
  return { nbPanneaux, orientation: orientations.join(', '), champs };
}

export default class DpExport {
  constructor(dpState, viewpoints) {
    this.state = dpState;
    this.viewpoints = viewpoints;
    this.result = null; // { ctx, captures, pieceIds, generatedAt }
    this._cancel = false;
  }

  cancel() {
    this._cancel = true;
  }

  async generer(pieceIds, onProgress) {
    this._cancel = false;
    this.result = null;
    const ids = piecesOrdonnees(pieceIds);
    if (!ids.length) throw new Error('Sélectionnez au moins une pièce.');
    if (onProgress) onProgress('Lecture du projet et de la parcelle cadastrale…', 0);
    const ctx = await buildContext(this.state);
    const captures = await captureAll(ctx, this.state, ids, {
      onProgress, isCancelled: () => this._cancel, viewpoints: this.viewpoints,
    });
    this.result = { ctx, captures, pieceIds: ids, generatedAt: new Date() };
    return this.result;
  }

  _base() {
    return `DP_${slug(this.result.ctx.cartouche.nom_projet)}`;
  }

  /** Les textes/images ont pu changer depuis la génération : l'assemblage relit l'état courant. */
  pdfComplet() {
    const pdf = buildPdf(this.result.pieceIds, this.result.ctx, this.result.captures, this.state);
    return { blob: pdf.output('blob'), filename: `${this._base()}_dossier_complet.pdf` };
  }

  piece(id) {
    const pdf = buildPdf([id], this.result.ctx, this.result.captures, this.state, this.result.pieceIds);
    return { blob: pdf.output('blob'), filename: `${this._base()}_${NOMS_FICHIERS[id]}.pdf` };
  }

  async zip(onProgress) {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    const dossier = zip.folder(this._base());
    for (const id of this.result.pieceIds) {
      if (onProgress) onProgress(`Assemblage ${NOMS_FICHIERS[id]}…`);
      const pdf = buildPdf([id], this.result.ctx, this.result.captures, this.state, this.result.pieceIds);
      dossier.file(`${NOMS_FICHIERS[id]}.pdf`, pdf.output('arraybuffer'));
      await new Promise((r) => setTimeout(r, 0)); // rend la main à l'interface entre deux pièces
    }
    dossier.file(`${NOMS_FICHIERS.garde.replace('page_de_garde', 'dossier_complet')}.pdf`, this.pdfComplet().blob);
    // Les PDF contiennent déjà des JPEG compressés : STORE évite de recompresser pour rien.
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    return { blob, filename: `${this._base()}.zip` };
  }
}
