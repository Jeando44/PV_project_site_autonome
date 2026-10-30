/**
 * Textes types de la page « Réglementation » du dossier de plans des ombrières (pré-remplissage,
 * entièrement modifiables). Rédigés au conditionnel et marqués « à compléter » / « à vérifier » :
 * ce sont des aide-mémoire, pas un avis réglementaire — le service instructeur, le SDIS et le
 * bureau de contrôle font foi. Identifiants et bornes : app/services/ombrieres_dossier/limites.json.
 */
export const SECTIONS_REGLEMENTATION = [
  { id: 'urbanisme', titre: 'Urbanisme' },
  { id: 'sdis', titre: 'SDIS & Sécurité' },
  { id: 'contraintes', titre: 'Contraintes spécifiques du site' },
];

export const TEXTES_TYPES = {
  urbanisme: [
    "Document d'urbanisme applicable : [PLU / PLUi / carte communale / RNU - à compléter], zone [à compléter].",
    '',
    "Régime d'autorisation (à vérifier auprès du service instructeur) : une ombrière photovoltaïque de parc de stationnement relève, selon sa hauteur, son emprise au sol et sa puissance crête, d'une déclaration préalable ou d'un permis de construire (Code de l'urbanisme, articles R.421-1 et suivants). Des règles plus strictes s'appliquent en site patrimonial remarquable, aux abords des monuments historiques et en site classé.",
    '',
    "Implantation : hauteur maximale, emprise au sol, reculs par rapport aux limites séparatives et à la voie publique, aspect extérieur et teinte des structures conformes au règlement de zone [à vérifier].",
    "Servitudes d'utilité publique et contraintes particulières : [à compléter].",
  ].join('\n'),
  sdis: [
    "Conception conforme à la norme NF C 15-100 et au guide UTE C 15-712-1 (installations photovoltaïques raccordées au réseau), ainsi qu'aux recommandations du SDIS pour les ombrières de parc de stationnement [à vérifier selon le règlement départemental].",
    '',
    "Dispositifs prévus : coupure d'urgence côté courant continu et côté courant alternatif, accessible aux services de secours ; signalétique réglementaire (pictogrammes, étiquetage des câbles et coffrets) ; cheminement des câbles protégé ; plan d'intervention remis au SDIS [à compléter].",
    '',
    "Accès et circulation des engins de secours sous et autour des ombrières (hauteur libre de passage, voies et aires de retournement), hydrants à proximité, distance aux façades et aux issues des bâtiments voisins : [à compléter].",
    "Sécurité des usagers : protection des poteaux contre les chocs des véhicules, éclairage sous ombrière, gestion des eaux pluviales : [à compléter].",
  ].join('\n'),
  contraintes: [
    "Charges climatiques : zones de vent et de neige et altitude du site selon les Eurocodes (NF EN 1991-1-3 et 1991-1-4) [à compléter] ; zone de sismicité [à compléter].",
    '',
    "Sol et fondations : étude géotechnique (mission G2) à réaliser ou réalisée [à compléter] ; réseaux enterrés repérés par DT-DICT avant tout terrassement [à compléter].",
    '',
    "Exploitation du parc de stationnement : nombre de places conservées, places PMR, gabarit des véhicules admis (hauteur libre), phasage des travaux sur site occupé, bornes de recharge (IRVE) éventuelles [à compléter].",
    "Autres contraintes du site (servitudes aéronautiques, éblouissement, proximité d'arbres, environnement) : [à compléter].",
  ].join('\n'),
};
