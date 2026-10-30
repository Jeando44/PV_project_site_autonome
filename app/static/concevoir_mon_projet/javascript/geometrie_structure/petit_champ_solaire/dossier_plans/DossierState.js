import { TEXTES_TYPES, SECTIONS_REGLEMENTATION } from './reglementation_modele.js';
import { nettoyerReglementation, objetSur, piecesSures, enTexte } from '../../dossier_reglementation_validation.js?v=1';
import { ajouterPieceDevis } from '../../dossier_devis.js?v=4';

/**
 * État du dossier de plans « Petit champ solaire » : réglages (indice, maître d'ouvrage, pièces
 * choisies) et textes de la page Réglementation.
 *
 * Mémorisé par projet et par champ PV dans le localStorage (reprise immédiate) ET sur le serveur
 * (PUT /api/petit_champ/<projet>/<pv>/dossier, validé côté serveur) : le dossier se retrouve sur
 * un autre poste. Aucune image n'est conservée : les captures sont refaites à chaque génération.
 */
const STORAGE_PREFIX = 'skv_petit_champ_dossier_v1_';
const DELAI_ENVOI_MS = 1200;

/**
 * Pièces du dossier, dans l'ordre du bordereau. `format` : 'portrait' / 'landscape' (A4) ou 'a3'
 * (A3 paysage). La page Réglementation est pilotée par sa propre case (reglementation.inclure),
 * décochée par défaut.
 */
export const PIECES = [
  { id: 'garde', titre: 'Page de garde et bordereau des pièces', format: 'portrait' },
  { id: 'presentation', titre: 'Présentation du projet', format: 'portrait' },
  { id: 'reglementation', titre: 'Réglementation : urbanisme, SDIS, ICPE', format: 'portrait', optionnelle: true },
  { id: 'situation', titre: 'Plan de situation (1/10000 et 1/1000)', format: 'landscape' },
  { id: 'calepinage_carte', titre: 'Plan de calepinage sur fond cadastral', format: 'landscape' },
  { id: 'calepinage_canevas', titre: 'Plan de calepinage (sans la carte)', format: 'a3' },
  { id: 'vue_3d', titre: 'Visualisation 3D du calepinage', format: 'a3' },
  { id: 'resultats', titre: 'Résultats et optimisation', format: 'portrait' },
  { id: 'coupe', titre: 'Plan de coupe', format: 'a3' },
  { id: 'facade', titre: 'Plan de façade', format: 'a3' },
  { id: 'fondations', titre: 'Détail des fondations', format: 'portrait' },
];

// Parcours Chiffrage : pièce « Devis » ajoutée en dernière position (cochée par défaut).
ajouterPieceDevis(PIECES);

/** Vue rapprochée Géoportail du plan de situation (la vue d'ensemble OSM reste au 1/10000). */
export const ECHELLE_SITUATION_PROCHE = 1000;

export const LIBELLES_FORMAT = { portrait: 'A4 portrait', landscape: 'A4 paysage', a3: 'A3 paysage' };

/** Code de pièce (« PC01 », « PC02 »...) : rang dans le dossier choisi, page de garde exclue. */
export function codesPieces(ids) {
  const codes = {};
  let n = 0;
  ids.forEach((id) => { codes[id] = id === 'garde' ? '' : `PC${String(++n).padStart(2, '0')}`; });
  return codes;
}

function defaults() {
  return {
    indice: 'A',
    maitreOuvrage: '',
    adresse: '',
    pieces: PIECES.filter((p) => !p.optionnelle).reduce((acc, p) => { acc[p.id] = true; return acc; }, {}),
    reglementation: { inclure: false, sections: { ...TEXTES_TYPES } },
    // Pièce « Devis » (parcours Chiffrage) : false = synthétique (un total par poste).
    devisDetaille: false,
  };
}

export default class DossierState {
  constructor() {
    this.projet = null;
    this.pvId = null;
    this.data = defaults();
    this._minuteur = null;
    this.onStatutServeur = null;
  }

  _cle() {
    return `${STORAGE_PREFIX}${this.projet}_${this.pvId}`;
  }

  /** Recharge les réglages du projet actif et du champ PV ; complète avec la version serveur. */
  async load(pvId) {
    this.projet = localStorage.getItem('current_projet_id') || 'sans_projet';
    this.pvId = pvId || 'PV1';
    const base = defaults();
    let saved = {};
    try { saved = objetSur(JSON.parse(localStorage.getItem(this._cle()) || '{}')); } catch (e) { saved = {}; }
    if (!saved.savedAt && this.projet !== 'sans_projet') {
      // Rien dans ce navigateur : reprise de la version enregistrée sur le serveur.
      try {
        const res = await fetch(`/concevoir_mon_projet/api/petit_champ/${encodeURIComponent(this.projet)}/${encodeURIComponent(this.pvId)}/parametres`, { credentials: 'same-origin' });
        const json = res.ok ? await res.json() : null;
        if (json && json.donnees && json.donnees.dossier) saved = objetSur(json.donnees.dossier);
      } catch (e) { /* hors ligne : valeurs par défaut */ }
    }
    // Données relues du stockage : types contrôlés (un texte non textuel faisait planter le modal).
    this.data = {
      ...base,
      ...saved,
      indice: typeof saved.indice === 'string' ? saved.indice : base.indice,
      maitreOuvrage: enTexte(saved.maitreOuvrage),
      adresse: enTexte(saved.adresse),
      pieces: { ...base.pieces, ...piecesSures(saved.pieces, PIECES.map((p) => p.id)) },
      reglementation: nettoyerReglementation(saved.reglementation, SECTIONS_REGLEMENTATION, TEXTES_TYPES),
      devisDetaille: saved.devisDetaille === true,
    };
    return this.data;
  }

  /** Données envoyées au serveur (format attendu par _valider_dossier). */
  pourServeur() {
    const d = this.data;
    return {
      indice: d.indice,
      maitreOuvrage: d.maitreOuvrage,
      adresse: d.adresse,
      pieces: d.pieces,
      reglementation: d.reglementation,
      devisDetaille: !!d.devisDetaille,
    };
  }

  save() {
    try {
      localStorage.setItem(this._cle(), JSON.stringify({ ...this.data, savedAt: Date.now() }));
    } catch (e) {
      console.warn('[Dossier petit champ] Sauvegarde locale impossible :', e);
    }
    clearTimeout(this._minuteur);
    this._minuteur = setTimeout(() => this._envoyer(), DELAI_ENVOI_MS);
  }

  async _envoyer() {
    if (this.projet === 'sans_projet') return;
    try {
      const res = await fetch(`/concevoir_mon_projet/api/petit_champ/${encodeURIComponent(this.projet)}/${encodeURIComponent(this.pvId)}/dossier`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ dossier: this.pourServeur() }),
      });
      const json = await res.json().catch(() => ({}));
      if (this.onStatutServeur) this.onStatutServeur(res.ok ? null : ((json.erreurs && json.erreurs[0]) || json.error || `Erreur ${res.status}`));
    } catch (e) {
      if (this.onStatutServeur) this.onStatutServeur('connexion indisponible, réglages gardés sur cet appareil.');
    }
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  /** Ids des pièces à produire, dans l'ordre du bordereau. */
  piecesChoisies() {
    const d = this.data;
    return PIECES.filter((p) => (p.id === 'reglementation' ? d.reglementation.inclure : d.pieces[p.id])).map((p) => p.id);
  }
}
