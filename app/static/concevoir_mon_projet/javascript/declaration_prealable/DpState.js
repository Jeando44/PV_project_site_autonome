/**
 * État du dossier de Déclaration préalable (DP) de toiture résidentielle.
 *
 * Deux natures de données, deux traitements (RGPD) :
 *  - les RÉGLAGES et TEXTES (demandeur, notice DP11, options des plans, points de vue en lat/lng)
 *    sont mémorisés par projet dans le localStorage du navigateur, rien n'est envoyé au serveur ;
 *  - les IMAGES importées (photos, insertion, coupe) ne vivent QU'EN MÉMOIRE, le temps de la
 *    session : jamais en base, jamais dans le localStorage, perdues au rechargement de la page.
 *    Elles sont ré-encodées à l'import (cf. DpImages.js), ce qui supprime leurs métadonnées EXIF
 *    (coordonnées GPS de l'appareil, modèle, date...).
 */
const STORAGE_PREFIX = 'skv_dp_toiture_v1_';

export const PIECES = [
  { id: 'garde', code: '', titre: 'Page de garde et bordereau des pièces', format: 'portrait' },
  { id: 'dp1', code: 'DP1', titre: 'Plan de situation', format: 'landscape' },
  { id: 'dp2', code: 'DP2', titre: 'Plan de masse', format: 'landscape' },
  { id: 'dp3', code: 'DP3', titre: 'Plan de coupe', format: 'landscape' },
  { id: 'dp4', code: 'DP4', titre: 'Plan de toiture', format: 'landscape' },
  { id: 'dp6', code: 'DP6', titre: 'Insertion paysagère', format: 'landscape' },
  { id: 'dp78', code: 'DP7 - DP8', titre: 'Environnement proche et lointain', format: 'landscape' },
  { id: 'dp11', code: 'DP11', titre: 'Notice descriptive du projet', format: 'portrait' },
];

export const IMAGE_SLOTS = {
  proche: { label: 'Photo environnement proche (DP7)', requis: true },
  lointain: { label: 'Photo environnement lointain (DP8)', requis: true },
  insertion: { label: 'Insertion paysagère (DP6)', requis: false, aide: 'Facultatif : remplace la vue 3D isométrique.' },
  coupe: { label: 'Coupe de principe (DP3)', requis: false, aide: 'Facultatif : remplace la coupe issue du calepinage.' },
  vueX: { label: 'Vue de la maison (DP3)', requis: false, aide: 'Facultatif : remplace la vue 3D « X » de la maison.' },
};

const REGLAGES_VERSION = 2;

function defaults() {
  return {
    indice: 'A',
    adresse: '',
    typeDemandeur: 'particulier',
    civilite: 'Monsieur',
    nom: '',
    societe: '',
    // Notice DP11 (null = valeur déduite du calepinage / du projet)
    nbPanneaux: null,
    teinte: 'noire',
    orientation: '',
    couverture: 'tuiles',
    cheminsCables: false,
    valorisation: '',
    noticeTexte: '',
    noticeModifiee: false,
    // Plans
    champId: '',
    echelleMasse: 'auto',
    cotationsAvant: true,
    cotationsProjet: true,
    pointsDeVue: { proche: null, lointain: null },
    pieces: PIECES.reduce((acc, p) => { acc[p.id] = true; return acc; }, {}),
    reglagesVersion: REGLAGES_VERSION,
  };
}

function projetId() {
  return localStorage.getItem('current_projet_id') || 'sans_projet';
}

export default class DpState {
  constructor() {
    this.images = {};
    this.projet = null;
    this.data = defaults();
    this.load();
  }

  /** Recharge les réglages du projet actif ; purge les images si le projet a changé. */
  load() {
    const id = projetId();
    if (this.projet !== id) this.images = {};
    this.projet = id;
    const base = defaults();
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + id);
      const saved = raw ? JSON.parse(raw) : {};
      this.data = {
        ...base,
        ...saved,
        pointsDeVue: { ...base.pointsDeVue, ...(saved.pointsDeVue || {}) },
        pieces: { ...base.pieces, ...(saved.pieces || {}) },
      };
      // v2 : les cotations s'affichent aussi par défaut sur les plans avant travaux (l'ancien
      // défaut `false` était enregistré avec les réglages de chaque projet).
      if ((saved.reglagesVersion || 1) < 2) this.data.cotationsAvant = true;
      this.data.reglagesVersion = REGLAGES_VERSION;
    } catch (e) {
      this.data = base;
    }
    return this.data;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_PREFIX + this.projet, JSON.stringify(this.data));
    } catch (e) {
      console.warn('[DP] Sauvegarde locale des réglages impossible :', e);
    }
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  setImage(slot, image) {
    if (image) this.images[slot] = image; else delete this.images[slot];
  }
}
