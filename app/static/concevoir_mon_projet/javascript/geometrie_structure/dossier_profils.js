/**
 * Profils du dossier de plans de conception « projet entier » : un seul modal
 * (ombrieres/dossier_plans/OmbriereDossierModal.js) et une seule trame de pièces, déclinés en :
 *  - ombrieres : toutes les ombrières (coupe + façade par ombrière) — le dossier d'origine ;
 *  - toitures  : toiture résidentielle, toiture terrasse, bâtiment incliné… — mêmes plans, SANS
 *                coupe ni façade (aucun configurateur de structure) ;
 *  - mixte     : toutes les structures du projet (coupe + façade des ombrières et des petits champs).
 *
 * Chaque profil a ses réglages et son quota sur le serveur (toitures et mixte : quota séparé,
 * /api/dossier_plans/<type>), sa clé de stockage local et ses libellés.
 */

/** Famille de structure d'un champ PV, d'après son type de montage du calepinage. */
export function familleStructure(typeMontage) {
  const t = String(typeMontage || '');
  if (t.startsWith('ombriere')) return 'ombrieres';
  if (t === 'champ_solaire') return 'petit_champ';
  return 'toitures';
}

export const LIBELLES_TYPE = {
  ombriere: 'Ombrière métal', ombriere_metal: 'Ombrière métal', ombriere_bois: 'Ombrière bois',
  ombriere_solumbra: 'Ombrière Solumbra', champ_solaire: 'Petit champ solaire',
  toiture_residentielle: 'Toiture résidentielle', toiture_terrasse: 'Toiture terrasse',
  toiture_inclinee: 'Bâtiment incliné',
};

export function libelleType(typeMontage) {
  return LIBELLES_TYPE[typeMontage] || (familleStructure(typeMontage) === 'toitures' ? 'Toiture' : 'Structure');
}

/** Familles dont chaque champ a un configurateur (coupe, façade, valeurs du tableau géométrie). */
export const FAMILLES_AVEC_PLANS = new Set(['ombrieres', 'petit_champ']);

export const PROFILS = {
  ombrieres: {
    id: 'ombrieres',
    api: '/concevoir_mon_projet/api/ombrieres/dossier',
    stockage: 'skv_ombrieres_dossier_v1_',
    familles: ['ombrieres'],
    titreModal: 'Dossier de plans de conception - ombrières',
    sousTitre: 'Ombrières photovoltaïques',
    nomFichier: 'Dossier_plans_ombrieres',
    // Libellés : « les ombrières », « par ombrière »…
    champs: 'Ombrières',
    des: 'des ombrières',
    parChamp: 'par ombrière',
    nombre: "Nombre d'ombrières",
    aucun: 'Aucune ombrière dans ce projet : tracez un champ PV et choisissez un type de structure « Ombrière ».',
  },
  toitures: {
    id: 'toitures',
    api: '/concevoir_mon_projet/api/dossier_plans/toitures',
    stockage: 'skv_dossier_plans_toitures_v1_',
    familles: ['toitures'],
    titreModal: 'Dossier de plans de conception - toitures',
    sousTitre: 'Centrale photovoltaïque en toiture',
    nomFichier: 'Dossier_plans_toitures',
    champs: 'Toitures',
    des: 'des toitures',
    parChamp: 'par toiture',
    nombre: 'Nombre de toitures',
    aucun: 'Aucune toiture dans ce projet : tracez un champ PV de type toiture (résidentielle, terrasse, bâtiment incliné).',
  },
  mixte: {
    id: 'mixte',
    api: '/concevoir_mon_projet/api/dossier_plans/mixte',
    stockage: 'skv_dossier_plans_mixte_v1_',
    familles: ['ombrieres', 'petit_champ', 'toitures'],
    titreModal: 'Dossier de plans de conception - toutes les structures',
    sousTitre: 'Centrale photovoltaïque',
    nomFichier: 'Dossier_plans_mixte',
    champs: 'Champs PV',
    des: 'des champs PV',
    parChamp: 'par champ PV',
    nombre: 'Nombre de champs PV',
    aucun: 'Aucun champ PV dans ce projet : tracez au moins un champ PV.',
  },
};

/** Le profil a-t-il des coupes et façades (au moins une famille avec configurateur) ? */
export function profilAvecPlans(profil) {
  return profil.familles.some((f) => FAMILLES_AVEC_PLANS.has(f));
}
