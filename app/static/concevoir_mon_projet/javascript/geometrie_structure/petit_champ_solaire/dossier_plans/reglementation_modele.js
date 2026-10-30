/**
 * Textes types de la page « Réglementation » du dossier de plans (pré-remplissage, entièrement
 * modifiables par l'utilisateur). Rédigés au conditionnel et marqués « à compléter » / « à
 * vérifier » : ce sont des aide-mémoire, pas un avis réglementaire — le service instructeur, le SDIS
 * et la DREAL/DDPP locaux font foi.
 */
export const SECTIONS_REGLEMENTATION = [
  { id: 'urbanisme', titre: 'Urbanisme' },
  { id: 'sdis', titre: 'Sécurité incendie (SDIS)' },
  { id: 'icpe', titre: 'Installations classées (ICPE)' },
];

export const TEXTES_TYPES = {
  urbanisme: [
    "Document d'urbanisme applicable : [PLU / PLUi / carte communale / RNU - à compléter], zone [à compléter].",
    '',
    "Régime d'autorisation (à vérifier auprès du service instructeur) : une installation photovoltaïque au sol relève, selon sa puissance crête et sa hauteur, d'une dispense de formalité, d'une déclaration préalable ou d'un permis de construire (Code de l'urbanisme, articles R.421-1 et suivants). Des règles plus strictes s'appliquent en site patrimonial remarquable, aux abords des monuments historiques et en site classé.",
    '',
    "Servitudes d'utilité publique et contraintes particulières : [à compléter].",
    "Implantation : hauteur maximale de la structure, reculs par rapport aux limites séparatives et à la voie publique conformes au règlement de zone [à vérifier].",
  ].join('\n'),
  sdis: [
    "Conception conforme à la norme NF C 15-100 et au guide UTE C 15-712-1 (installations photovoltaïques raccordées au réseau).",
    '',
    "Dispositifs prévus : coupure d'urgence côté courant continu et côté courant alternatif, accessible aux services de secours ; signalétique réglementaire (pictogrammes, étiquetage des câbles et coffrets) ; plan d'intervention remis au SDIS [à compléter].",
    '',
    "Accès des engins de secours, voie de circulation autour du champ et, en zone exposée au risque de feu de forêt, obligations légales de débroussaillement : [à compléter selon le règlement départemental du SDIS].",
  ].join('\n'),
  icpe: [
    "Une centrale photovoltaïque au sol ne relève pas, en tant que telle, de la nomenclature des installations classées pour la protection de l'environnement (ICPE).",
    '',
    "Le site d'implantation [est / n'est pas] une installation classée ou situé à proximité d'une ICPE : [à compléter].",
    "En cas de stockage d'énergie par batteries, la rubrique applicable de la nomenclature est à vérifier auprès de l'inspection des installations classées [à compléter].",
  ].join('\n'),
};
