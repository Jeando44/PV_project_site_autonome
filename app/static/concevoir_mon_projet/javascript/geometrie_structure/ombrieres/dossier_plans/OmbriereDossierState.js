import { TEXTES_TYPES, SECTIONS_REGLEMENTATION } from './reglementation_modele.js?v=5';
import { nettoyerReglementation, objetSur, piecesSures, enTexte } from '../../dossier_reglementation_validation.js?v=1';
import { ajouterPieceDevis } from '../../dossier_devis.js?v=5';
import { PROFILS, FAMILLES_AVEC_PLANS, profilAvecPlans } from '../../dossier_profils.js?v=1';

/**
 * État du dossier de plans « projet entier » (profil ombrières, toitures ou mixte, cf.
 * dossier_profils.js) : un dossier par PROJET et par profil, réglages (indice, maître d'ouvrage,
 * pièces, champs exclus) et textes de la page Réglementation.
 *
 * Mémorisé par projet dans le localStorage (reprise immédiate) ET sur le serveur (PUT
 * <profil.api>/<projet>, validé côté serveur). Aucune image n'est conservée : les captures sont
 * refaites à chaque génération.
 */
const DELAI_ENVOI_MS = 1200;

/** Pièces tirées du configurateur de chaque champ : absentes du profil toitures. */
const PIECES_PLANS = new Set(['coupe', 'facade']);

/**
 * Pièces du dossier, dans l'ordre du bordereau (mêmes pages que le petit champ solaire, sauf :
 * page APER facultative après la présentation, tableau géométrie à la place des résultats, pas de
 * détail des fondations). `parChamp` : une page par champ ; `plans` : une page par champ AYANT un
 * configurateur (ombrière, petit champ). `optionnelle` : décochée par défaut. La page
 * Réglementation est pilotée par sa propre case (reglementation.inclure).
 */
export function piecesDuProfil(profil) {
  const parStructure = profil.id === 'mixte' ? 'par ombrière et par petit champ' : profil.parChamp;
  const pieces = [
    { id: 'garde', titre: 'Page de garde et bordereau des pièces', format: 'portrait' },
    { id: 'presentation', titre: 'Présentation du projet', format: 'portrait' },
    { id: 'aper', titre: 'Résultats de la loi APER', format: 'portrait', optionnelle: true },
    { id: 'reglementation', titre: 'Réglementation : urbanisme, SDIS & sécurité, contraintes du site', format: 'portrait', optionnelle: true },
    { id: 'situation', titre: 'Plan de situation (1/10000 et 1/1000)', format: 'landscape' },
    { id: 'calepinage_carte', titre: 'Plan de calepinage sur fond cadastral', format: 'landscape' },
    { id: 'calepinage_canevas', titre: `Plan de calepinage (sans la carte), ${profil.parChamp}`, format: 'a3', parChamp: true },
    { id: 'vue_3d_projet', titre: `Visualisation 3D du projet (ensemble ${profil.des})`, format: 'a3' },
    { id: 'geometrie', titre: `Tableau géométrie ${profil.des}`, format: 'landscape' },
    { id: 'coupe', titre: `Plan de coupe, ${parStructure}`, format: 'a3', parChamp: true, plans: true },
    { id: 'facade', titre: `Plan de façade, ${parStructure}`, format: 'a3', parChamp: true, plans: true },
  ].filter((p) => !PIECES_PLANS.has(p.id) || profilAvecPlans(profil));
  // Parcours Chiffrage : pièce « Devis » ajoutée en dernière position (cochée par défaut).
  return ajouterPieceDevis(pieces);
}

/** Champs du dossier qui ont une coupe et une façade (configurateur d'ombrière ou de petit champ). */
export function champsAvecPlans(champs) {
  return champs.filter((c) => FAMILLES_AVEC_PLANS.has(c.famille));
}

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

function piecesConnues(pieces, liste) {
  const ids = new Set(liste.map((p) => p.id));
  return Object.fromEntries(Object.entries(pieces || {}).filter(([k]) => ids.has(k)));
}

function defaults(liste) {
  return {
    indice: 'A',
    maitreOuvrage: '',
    adresse: '',
    pieces: liste.filter((p) => !p.optionnelle).reduce((acc, p) => { acc[p.id] = true; return acc; }, { aper: false }),
    champsExclus: [],
    reglementation: { inclure: false, sections: { ...TEXTES_TYPES } },
    // Pièce « Devis » (parcours Chiffrage) : false = synthétique (un total par poste).
    devisDetaille: false,
  };
}

export default class OmbriereDossierState {
  constructor(profil = PROFILS.ombrieres) {
    this.projet = null;
    this._minuteur = null;
    this.onStatutServeur = null;
    this.choisirProfil(profil);
  }

  /** Change de profil (ombrières, toitures, mixte) : pièces et réglages repartent des défauts. */
  choisirProfil(profil) {
    if (this._minuteur && this.profil && this.profil !== profil) {
      // Réglages du profil précédent pas encore envoyés : envoi immédiat, avant de changer d'API.
      clearTimeout(this._minuteur);
      this._minuteur = null;
      this._envoyer();
    }
    this.profil = profil;
    this.pieces = piecesDuProfil(profil);
    this.data = defaults(this.pieces);
  }

  _cle() {
    return `${this.profil.stockage}${this.projet}`;
  }

  /** Recharge les réglages du projet actif ; reprend la version serveur si ce navigateur n'a rien. */
  async load() {
    this.projet = localStorage.getItem('current_projet_id') || 'sans_projet';
    // Liste recalculée : la pièce « Devis » dépend du type d'étude du projet ouvert.
    this.pieces = piecesDuProfil(this.profil);
    const base = defaults(this.pieces);
    let saved = {};
    try { saved = objetSur(JSON.parse(localStorage.getItem(this._cle()) || '{}')); } catch (e) { saved = {}; }
    if (!saved.savedAt && this.projet !== 'sans_projet') {
      try {
        const res = await fetch(`${this.profil.api}/${encodeURIComponent(this.projet)}`, { credentials: 'same-origin' });
        const json = res.ok ? await res.json() : null;
        if (json && json.dossier) saved = objetSur(json.dossier);
      } catch (e) { /* hors ligne : valeurs par défaut */ }
    }
    // Données relues du stockage : types contrôlés (un texte non textuel faisait planter le modal).
    this.data = {
      ...base,
      ...saved,
      indice: typeof saved.indice === 'string' ? saved.indice : base.indice,
      maitreOuvrage: enTexte(saved.maitreOuvrage),
      adresse: enTexte(saved.adresse),
      // Pièces retirées depuis (ex. « vue 3D par ombrière ») : écartées, le serveur refuse une clé inconnue.
      pieces: { ...base.pieces, ...piecesSures(piecesConnues(saved.pieces, this.pieces), this.pieces.map((p) => p.id)) },
      champsExclus: Array.isArray(saved.champsExclus) ? saved.champsExclus.filter((id) => typeof id === 'string') : [],
      reglementation: nettoyerReglementation(saved.reglementation, SECTIONS_REGLEMENTATION, TEXTES_TYPES),
      devisDetaille: saved.devisDetaille === true,
    };
    return this.data;
  }

  /** Données envoyées au serveur (format attendu par validation.valider_dossier). */
  pourServeur() {
    const d = this.data;
    return {
      indice: d.indice,
      maitreOuvrage: d.maitreOuvrage,
      adresse: d.adresse,
      pieces: d.pieces,
      champsExclus: d.champsExclus,
      reglementation: d.reglementation,
      devisDetaille: !!d.devisDetaille,
    };
  }

  save() {
    try {
      localStorage.setItem(this._cle(), JSON.stringify({ ...this.data, savedAt: Date.now() }));
    } catch (e) {
      console.warn('[Dossier de plans] Sauvegarde locale impossible :', e);
    }
    clearTimeout(this._minuteur);
    this._minuteur = setTimeout(() => { this._minuteur = null; this._envoyer(); }, DELAI_ENVOI_MS);
  }

  async _envoyer() {
    if (!this.projet || this.projet === 'sans_projet') return;
    // Profil et réglages figés à l'appel : un changement de profil pendant l'envoi ne les mélange pas.
    const url = `${this.profil.api}/${encodeURIComponent(this.projet)}`;
    const corps = JSON.stringify({ dossier: this.pourServeur() });
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: corps,
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

  /**
   * Ids des pièces à produire, dans l'ordre du bordereau.
   * @param {Object[]} [champs] champs retenus : si aucun n'a de configurateur, ni coupe ni façade.
   */
  piecesChoisies(champs) {
    const d = this.data;
    const sansPlans = Array.isArray(champs) && !champsAvecPlans(champs).length;
    return this.pieces
      .filter((p) => (p.id === 'reglementation' ? d.reglementation.inclure : d.pieces[p.id]))
      .filter((p) => !(sansPlans && p.plans))
      .map((p) => p.id);
  }

  /** Champs PV retenus parmi les champs disponibles (ordre conservé). */
  champsRetenus(champs) {
    const exclus = new Set(this.data.champsExclus || []);
    return champs.filter((c) => !exclus.has(c.sourceId));
  }
}
