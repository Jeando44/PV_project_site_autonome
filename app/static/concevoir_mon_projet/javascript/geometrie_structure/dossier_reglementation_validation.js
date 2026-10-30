/**
 * Validation de la page « Réglementation » des dossiers de plans (petit champ solaire et ombrières).
 *
 * Miroir des contrôles serveur (app/services/petit_champ_solaire/validation.py et
 * app/services/ombrieres_dossier/validation.py, valider_reglementation) : le serveur revalide tout ;
 * ce module protège l'interface contre les données qui la feraient planter ou qui donneraient un
 * PDF faux, et prévient l'utilisateur avant la génération.
 *
 *  - données relues du stockage (localStorage, serveur) : type quelconque -> texte, sections
 *    inconnues écartées (le serveur les refuse) ;
 *  - bornes servies par le serveur : une borne absente ou non numérique reprend la valeur par défaut ;
 *  - longueur, nombre de lignes, caractères de contrôle ;
 *  - caractères que les polices standard de jsPDF (codage WinAnsi / cp1252) ne savent pas imprimer :
 *    émojis, symboles mathématiques, alphabets non latins, demi-paires UTF-16 isolées (ces
 *    dernières font aussi échouer l'enregistrement en base) ;
 *  - texte qui déborde de la page A4 (sinon coupé sans prévenir dans le PDF).
 */

// Caractères imprimables par jsPDF (WinAnsi) : ASCII, Latin-1 et les 27 ajouts de cp1252, plus les
// espaces fines que texteImprimable (DpLayout.js) remplace par une espace simple.
// eslint-disable-next-line no-control-regex
const NON_IMPRIMABLE = /[^\t\n\r -~ -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ     ]/gu;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const LIGNES_MAX_DEFAUT = 80;

/** Objet simple relu du stockage, sinon {} (JSON.parse peut rendre null, un tableau, un nombre...). */
export function objetSur(valeur) {
  return valeur && typeof valeur === 'object' && !Array.isArray(valeur) ? valeur : {};
}

/** Cases des pièces relues du stockage : pièces connues seulement, valeurs booléennes seulement. */
export function piecesSures(pieces, idsConnus) {
  const ids = new Set(idsConnus);
  return Object.fromEntries(Object.entries(objetSur(pieces)).filter(([k, v]) => ids.has(k) && typeof v === 'boolean'));
}

/** Texte sûr : toute valeur non textuelle devient '' (null, nombre, objet relu du stockage...). */
export function enTexte(valeur) {
  return typeof valeur === 'string' ? valeur : '';
}

/** Caractères que le PDF ne sait pas imprimer (distincts, 5 au plus, pour le message). */
export function caracteresNonImprimables(texte) {
  const trouves = [];
  for (const m of enTexte(texte).matchAll(NON_IMPRIMABLE)) {
    const c = m[0];
    // Demi-paire UTF-16 isolée : invisible, décrite par son code.
    const libelle = /[\uD800-\uDFFF]/.test(c) && c.length === 1 ? `U+${c.charCodeAt(0).toString(16).toUpperCase()}` : c;
    if (!trouves.includes(libelle)) trouves.push(libelle);
    if (trouves.length >= 5) break;
  }
  return trouves;
}

/**
 * Réglages de la page relus du stockage -> forme sûre : {inclure: bool, sections: {id: texte}},
 * sections connues seulement, texte type pour une section absente ou d'un type inattendu.
 */
export function nettoyerReglementation(saved, sections, textesTypes) {
  const src = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const brutes = src.sections && typeof src.sections === 'object' && !Array.isArray(src.sections) ? src.sections : {};
  const propres = {};
  sections.forEach((s) => {
    propres[s.id] = typeof brutes[s.id] === 'string' ? brutes[s.id] : enTexte(textesTypes[s.id]);
  });
  return { inclure: src.inclure === true, sections: propres };
}

/** Bornes du serveur fusionnées avec celles par défaut : jamais de borne manquante ou non numérique. */
export function bornesReglementation(limites, defaut, sections) {
  const serveur = (limites && limites.reglementation && limites.reglementation.sections) || {};
  const base = (defaut && defaut.reglementation && defaut.reglementation.sections) || {};
  const entier = (v, repli) => (Number.isInteger(v) && v >= 0 ? v : repli);
  const bornes = {};
  sections.forEach((s) => {
    const d = base[s.id] || { min: 20, max: 3000 };
    const r = serveur[s.id] && typeof serveur[s.id] === 'object' ? serveur[s.id] : {};
    const max = entier(r.max, d.max);
    bornes[s.id] = {
      min: Math.min(entier(r.min, d.min), max),
      max,
      lignesMax: entier(r.lignesMax, d.lignesMax || LIGNES_MAX_DEFAUT),
    };
  });
  return bornes;
}

/**
 * Erreurs de la page, par section ({`reg_${id}`: message}), plus `reg_page` si le texte déborde de
 * la page A4.
 * @param {Object} reg          {inclure, sections}
 * @param {Array}  sections     [{id, titre}]
 * @param {Object} bornes       bornesReglementation()
 * @param {Function} [deborde]  (sections, textes) -> true | false | null (mesure de la page)
 */
export function erreursReglementation(reg, sections, bornes, deborde) {
  const erreurs = {};
  const inclure = !!(reg && reg.inclure);
  const textes = (reg && reg.sections) || {};
  sections.forEach((s) => {
    const b = bornes[s.id];
    const brut = enTexte(textes[s.id]);
    const t = brut.replace(/\r\n/g, '\n').trim();
    const lignes = t ? t.split('\n').length : 0;
    const horsPdf = caracteresNonImprimables(t);
    let msg = null;
    if (inclure && t.length < b.min) msg = `Au moins ${b.min} caractères (actuellement ${t.length}).`;
    else if (t.length > b.max) msg = `Au plus ${b.max} caractères (actuellement ${t.length}).`;
    else if (lignes > b.lignesMax) msg = `Au plus ${b.lignesMax} lignes (actuellement ${lignes}).`;
    else if (CONTROLE.test(t)) msg = 'Caractères de contrôle interdits.';
    else if (horsPdf.length) msg = `Caractères impossibles à imprimer dans le PDF : ${horsPdf.join(' ')}. Remplacez-les (ex. « >= » pour « ≥ »).`;
    if (msg) erreurs[`reg_${s.id}`] = msg;
  });
  // Débordement : seulement si la page est incluse et les sections valides (sinon message inutile).
  if (inclure && !Object.keys(erreurs).length && typeof deborde === 'function') {
    let d = null;
    try { d = deborde(sections, textes); } catch (e) { d = null; }
    if (d === true) erreurs.reg_page = 'Le texte dépasse la page A4 : la fin serait coupée dans le PDF. Raccourcissez une ou plusieurs sections.';
  }
  return erreurs;
}
