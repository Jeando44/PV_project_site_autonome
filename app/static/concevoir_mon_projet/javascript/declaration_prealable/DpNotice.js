/**
 * Notice descriptive du projet (DP11) — texte du modèle DP11docx.pdf, dont les passages en rouge
 * deviennent des champs (nombre de panneaux, demandeur, adresse, teinte, orientation, couverture,
 * phrase optionnelle des chemins de câbles, mode de valorisation).
 * Pur (aucun DOM) : testable sous Node.
 */

export const TEINTES = ['noire', 'gris anthracite', 'bleu nuit'];

export const COUVERTURES = {
  tuiles: 'de tuiles',
  tuiles_mecaniques: 'de tuiles mécaniques',
  ardoises: "d'ardoises",
  bac_acier: 'de bac acier',
  zinc: 'de zinc',
  fibrociment: 'de plaques de fibrociment',
};

export const COUVERTURE_LABELS = {
  tuiles: 'Tuiles', tuiles_mecaniques: 'Tuiles mécaniques', ardoises: 'Ardoises',
  bac_acier: 'Bac acier', zinc: 'Zinc', fibrociment: 'Fibrociment',
};

export const VALORISATIONS = {
  aci: 'en autoconsommation individuelle',
  aci_surplus: 'en autoconsommation individuelle avec vente du surplus',
  acc: 'en autoconsommation collective',
  vente_totale: 'en vente en totalité',
};

export const VALORISATION_LABELS = {
  aci: 'Autoconsommation individuelle',
  aci_surplus: 'Autoconsommation avec vente du surplus',
  acc: 'Autoconsommation collective',
  vente_totale: 'Vente en totalité',
};

const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const DIZAINES = { 20: 'vingt', 30: 'trente', 40: 'quarante', 50: 'cinquante', 60: 'soixante' };

function moinsDeCent(n) {
  if (n <= 16) return UNITES[n];
  if (n < 20) return `dix-${UNITES[n - 10]}`;
  if (n < 70) {
    const d = Math.floor(n / 10) * 10;
    const u = n % 10;
    if (u === 0) return DIZAINES[d];
    return u === 1 ? `${DIZAINES[d]} et un` : `${DIZAINES[d]}-${UNITES[u]}`;
  }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${moinsDeCent(n - 60)}`;
  if (n === 80) return 'quatre-vingts';
  return `quatre-vingt-${moinsDeCent(n - 80)}`;
}

/** Nombre en toutes lettres (0 à 999), orthographe traditionnelle. */
export function nombreEnLettres(n) {
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (n >= 1000) return String(n);
  if (n < 100) return moinsDeCent(n);
  const c = Math.floor(n / 100);
  const reste = n % 100;
  const centaines = c === 1 ? 'cent' : `${UNITES[c]} cent${reste === 0 ? 's' : ''}`;
  return reste === 0 ? centaines : `${centaines} ${moinsDeCent(reste)}`;
}

/**
 * Azimut PVGIS (Sud = 0°, Ouest = +90°, Est = -90°) -> orientation en toutes lettres.
 */
export function orientationDepuisAzimut(azimutPvgis) {
  const noms = ['sud', 'sud-ouest', 'ouest', 'nord-ouest', 'nord', 'nord-est', 'est', 'sud-est'];
  const a = ((Number(azimutPvgis) || 0) % 360 + 360) % 360;
  return noms[Math.round(a / 45) % 8];
}

/** Mode de valorisation du projet (libellé libre de la base) -> clé de VALORISATIONS. */
export function valorisationDepuisProjet(libelle) {
  const s = String(libelle || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!s) return 'aci';
  if (s.includes('collectiv')) return 'acc';
  if (s.includes('surplus')) return 'aci_surplus';
  if (s.includes('totalit') || s.includes('vente')) return 'vente_totale';
  return 'aci';
}

function listeFrancaise(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/**
 * @param {Object} f champs de la notice
 * @returns {string} paragraphes séparés par une ligne vide
 */
export function genererNotice(f) {
  const nb = Math.max(0, parseInt(f.nbPanneaux, 10) || 0);
  const nbTexte = `${nombreEnLettres(nb)} (${nb})`;
  const pluriel = nb > 1 ? 's' : '';

  const nom = String(f.nom || '').trim() || 'XXX';
  const lieu = f.typeDemandeur === 'societe'
    ? `sur le bâtiment de la société ${String(f.societe || '').trim() || 'XXX'}`
    : `sur la résidence de ${f.civilite ? `${f.civilite} ` : ''}${nom}`;
  const adresse = String(f.adresse || '').trim() || 'XXXXXXXX (adresse du projet)';

  const orientations = String(f.orientation || '').split(/\s*,\s*/).filter(Boolean);
  const implantation = orientations.length > 1
    ? `sur les pans de toiture orientés ${listeFrancaise(orientations)}`
    : `sur le pan de toiture orienté ${orientations[0] || 'sud'}`;

  const couverture = COUVERTURES[f.couverture] || COUVERTURES.tuiles;
  const valorisation = VALORISATIONS[f.valorisation] || VALORISATIONS.aci;

  const paragraphes = [
    `Le présent projet concerne l'installation de ${nbTexte} panneau${pluriel === 's' ? 'x' : ''} solaire${pluriel} photovoltaïque${pluriel} en toiture ${lieu}, située ${adresse}.`,
    `Les panneaux seront de teinte ${f.teinte || 'noire'} uniforme, incluant les cadres en aluminium, afin de garantir une intégration visuelle harmonieuse avec la couverture existante et de limiter l'impact esthétique de l'installation.`,
    `L'implantation est prévue ${implantation} tout en préservant l'aspect principal de la construction depuis l'espace public.`,
    `Les panneaux seront posés en surimposition à la couverture existante, sans modification structurelle de la charpente ni dépose des éléments en place. La toiture actuelle est constituée ${couverture} qui seront intégralement conservé${f.couverture === 'bac_acier' || f.couverture === 'zinc' ? 's' : 'es'}. Le système de fixation sera adapté au type de couverture afin d'assurer l'étanchéité et la pérennité de l'ouvrage.`,
    "L'installation sera réalisée de manière à être la plus discrète possible, avec un positionnement aligné et regroupé des panneaux, respectant les lignes de la toiture.",
    `Les câbles électriques nécessaires au raccordement des panneaux seront intégrés de façon discrète et passeront sous les panneaux pour pénétrer directement dans le bâtiment, limitant ainsi toute visibilité extérieure des réseaux.${f.cheminsCables ? ' Des chemins de câbles seront installés sur la toiture pour le cheminement des câbles électriques.' : ''}`,
    "Le projet ne modifie ni l'emprise au sol, ni le volume du bâtiment existant, et n'entraîne aucune création de surface de plancher.",
    `L'électricité produite sera valorisée ${valorisation}.`,
  ];
  return paragraphes.join('\n\n');
}
