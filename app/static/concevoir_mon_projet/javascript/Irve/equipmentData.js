/**
 * Dictionnaire de données — Modélisation des charges du site (Méthode 1 : Équipements,
 * Méthode 2 : Profil global). Ne contient que des données statiques, aucune logique de calcul
 * (cf. loadProfileGenerator.js pour les algorithmes) — chargé indépendamment pour rester réutilisable
 * par d'autres modules si besoin.
 *
 * Convention : toutes les puissances sont en W, toutes les heures sont des entiers 0-23 (heure de
 * début incluse, heure de fin exclue — ex. debut:8, fin:20 = fonctionne de 8h à 19h59).
 * Les coefficients saisonniers/journaliers sont des multiplicateurs 0-1 appliqués à la puissance
 * nominale (0 = éteint sur cette période, 1 = pleine puissance).
 */

// ─────────────────────────────────────────────────────────────────────────────
// MÉTHODE 1 (BOTTOM-UP) : catalogue des équipements par défaut
// ─────────────────────────────────────────────────────────────────────────────
window.DEFAULT_EQUIPMENT_LIST = [
  {
    id: 'box_wifi', nom: 'Box Wifi / Box internet', categorie: 'veille',
    puissanceW: 15, quantiteDefaut: 1, cosPhi: 0.95,
    heureDebut: 0, heureFin: 24, // fonctionne en continu
    jours: { semaine: 1, weekend: 1 },
    saisons: { hiver: 1, printemps: 1, ete: 1, automne: 1 }
  },
  {
    id: 'frigo', nom: 'Réfrigérateur / Congélateur', categorie: 'veille',
    puissanceW: 100, quantiteDefaut: 1, cosPhi: 0.9,
    // Intermittent : cycles compresseur ~30% du temps, modélisé via un facteur de charge
    heureDebut: 0, heureFin: 24, facteurCharge: 0.3,
    jours: { semaine: 1, weekend: 1 },
    saisons: { hiver: 0.9, printemps: 1, ete: 1.15, automne: 1 } // légère hausse en été
  },
  {
    id: 'veille_globale', nom: 'Veille globale (autres appareils)', categorie: 'veille',
    puissanceW: 0, quantiteDefaut: 1, cosPhi: 0.9, energieJournaliereFixeKwh: 1.5,
    heureDebut: 0, heureFin: 24,
    jours: { semaine: 1, weekend: 1 },
    saisons: { hiver: 1, printemps: 1, ete: 1, automne: 1 }
  },
  {
    id: 'televiseur', nom: 'Téléviseur', categorie: 'electromenager',
    puissanceW: 100, quantiteDefaut: 1, cosPhi: 0.95,
    heureDebut: 19, heureFin: 23,
    jours: { semaine: 1, weekend: 1.3 },
    saisons: { hiver: 1.1, printemps: 1, ete: 0.8, automne: 1 }
  },
  {
    id: 'ordinateur', nom: 'Ordinateur', categorie: 'electromenager',
    puissanceW: 60, quantiteDefaut: 1, cosPhi: 0.95,
    heureDebut: 9, heureFin: 18,
    jours: { semaine: 1, weekend: 0.4 },
    saisons: { hiver: 1, printemps: 1, ete: 1, automne: 1 }
  },
  {
    id: 'micro_ondes', nom: 'Micro-ondes', categorie: 'electromenager',
    puissanceW: 1200, quantiteDefaut: 1, cosPhi: 0.95, facteurCharge: 0.05, // usage bref, ~3 min/jour
    heureDebut: 7, heureFin: 21,
    jours: { semaine: 1, weekend: 1 },
    saisons: { hiver: 1, printemps: 1, ete: 1, automne: 1 }
  },
  {
    id: 'lave_linge', nom: 'Lave-linge', categorie: 'electromenager',
    puissanceW: 2000, quantiteDefaut: 1, cosPhi: 0.9, facteurCharge: 0.15, // ~1 cycle/jour en moyenne
    heureDebut: 8, heureFin: 20,
    jours: { semaine: 1, weekend: 1.5 },
    saisons: { hiver: 1, printemps: 1, ete: 1, automne: 1 }
  },
  {
    id: 'four', nom: 'Four électrique', categorie: 'electromenager',
    puissanceW: 2500, quantiteDefaut: 1, cosPhi: 0.9, facteurCharge: 0.08,
    heureDebut: 11, heureFin: 21,
    jours: { semaine: 1, weekend: 1.2 },
    saisons: { hiver: 1.1, printemps: 1, ete: 0.85, automne: 1 }
  },
  {
    id: 'pac', nom: 'Climatisation', categorie: 'thermique',
    puissanceW: 3000, quantiteDefaut: 1, cosPhi: 0.85, facteurCharge: 0.5,
    heureDebut: 9, heureFin: 17,
    jours: { semaine: 1, weekend: 1 },
    // Climatisation = refroidissement estival : coefficients saisonniers inversés par rapport à
    // l'ancien libellé "Pompe à chaleur" (chauffage) — forte l'été, quasi nulle l'hiver.
    saisons: { hiver: 0.15, printemps: 0.5, ete: 1, automne: 0.6 }
  },
  {
    id: 'chauffe_eau', nom: 'Chauffe-eau (thermodynamique ou classique)', categorie: 'thermique',
    puissanceW: 2000, quantiteDefaut: 1, cosPhi: 0.95, facteurCharge: 0.25,
    heureDebut: 1, heureFin: 6, // souvent programmé en heures creuses nuit
    jours: { semaine: 1, weekend: 1 },
    saisons: { hiver: 1.2, printemps: 1, ete: 0.7, automne: 1 }
  },
  {
    id: 'eclairage_led', nom: 'Éclairage LED (par point lumineux)', categorie: 'eclairage',
    puissanceW: 5, quantiteDefaut: 10, cosPhi: 0.95,
    heureDebut: 18, heureFin: 23,
    jours: { semaine: 1, weekend: 1 },
    // Allumé plus tôt/longtemps l'hiver (nuit plus longue)
    saisons: { hiver: 1.4, printemps: 1, ete: 0.6, automne: 1.1 }
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// COEFFICIENTS GLOBAUX (Méthode 1) : modulation supplémentaire éditable par l'utilisateur,
// appliquée EN PLUS des coefficients propres à chaque équipement ci-dessus (ex. la PAC garde sa
// forte variation saisonnière propre, et ces coefficients globaux modulent en plus l'ensemble du
// site — ex. présence accrue au foyer en hiver/le week-end).
// ─────────────────────────────────────────────────────────────────────────────
window.DEFAULT_GLOBAL_SEASON_COEFF = { hiver: 1.25, printemps: 1.0, ete: 0.95, automne: 1.0 };
window.DEFAULT_GLOBAL_WEEKLY_COEFF = { semaine: 1.0, weekend: 1.3 };

// ─────────────────────────────────────────────────────────────────────────────
// MÉTHODE 2 (TOP-DOWN) : profils de désagrégation par type de site
// ─────────────────────────────────────────────────────────────────────────────

// 1) Annuel → Mensuel : poids relatifs des 12 mois (doivent sommer à 1 par profil)
// NOTE : chaque tableau est normalisé pour sommer exactement à 1 (vérifié numériquement) — ne pas
// modifier une valeur isolément sans réajuster les autres, sous peine de désaligner l'énergie
// annuelle totale reconstituée par l'algorithme de désagrégation (cf. loadProfileGenerator.js).
window.MONTHLY_WEIGHTS_BY_PROFILE = {
  residentiel: [0.115, 0.105, 0.095, 0.075, 0.06, 0.05, 0.045, 0.045, 0.06, 0.075, 0.095, 0.18],
  tertiaire:   [0.0938, 0.0885, 0.0885, 0.0833, 0.0833, 0.0781, 0.0625, 0.0521, 0.0833, 0.0885, 0.0885, 0.1096],
  industriel:  [0.0892, 0.0892, 0.0892, 0.0892, 0.0892, 0.0861, 0.0622, 0.0519, 0.0861, 0.0892, 0.0892, 0.0893],
  supermarche: [0.0891, 0.0792, 0.0792, 0.0792, 0.0792, 0.0891, 0.0891, 0.0792, 0.0792, 0.0792, 0.0792, 0.0991],
  agricole:    [0.07, 0.07, 0.08, 0.09, 0.1, 0.11, 0.11, 0.1, 0.08, 0.07, 0.06, 0.06],
  boulangerie: [0.088, 0.083, 0.086, 0.083, 0.084, 0.081, 0.079, 0.065, 0.083, 0.087, 0.087, 0.094], // creux d'août (congés)
  discount:    [0.083, 0.077, 0.081, 0.079, 0.082, 0.083, 0.087, 0.085, 0.08, 0.082, 0.087, 0.094],  // pic de fin d'année
  autres:      Array(12).fill(1 / 12)
};

// 2) Mensuel → Journalier : coefficient jours ouvrés (Lun-Ven) vs jours de repos (Sam-Dim)
//    Le total hebdomadaire pondéré doit rester cohérent : 5*ouvre + 2*repos = 7 jours "moyens".
window.WEEKDAY_WEEKEND_RATIO_BY_PROFILE = {
  residentiel: { ouvre: 0.9, repos: 1.25 },  // légèrement plus de conso le WE (présence au foyer)
  tertiaire:   { ouvre: 1.3, repos: 0.15 },  // quasi fermé le WE
  industriel:  { ouvre: 1.35, repos: 0.05 }, // arrêt de production le WE
  supermarche: { ouvre: 0.95, repos: 1.2 },  // pic de fréquentation le samedi
  agricole:    { ouvre: 1.0, repos: 1.0 },   // pas de distinction (activité continue)
  boulangerie: { ouvre: 0.97, repos: 1.075 }, // ouverte 6 à 7 jours, affluence le week-end
  discount:    { ouvre: 1.06, repos: 0.85 },  // samedi chargé, dimanche souvent fermé
  autres:      { ouvre: 1.0, repos: 1.0 }
};

// 3) Journalier → Courbe de charge : forme horaire normalisée (24 valeurs, somme = 1)
//    Résidentiel = double bosse (matin ~8h, soir ~19h) ; les autres profils suivent des rythmes
//    d'activité différents (cf. commentaires).
// NOTE : chaque tableau (24 valeurs) est normalisé pour sommer exactement à 1 (vérifié
// numériquement) — c'est ce qui garantit que l'énergie journalière reconstituée par l'algorithme
// correspond exactement à l'énergie du jour visée, quelle que soit la forme de la courbe.
window.DAILY_SHAPE_BY_PROFILE = {
  residentiel: [
    0.0220, 0.0176, 0.0154, 0.0143, 0.0154, 0.0220, // 0h-5h : creux nocturne
    0.0385, 0.0604, 0.0714, 0.0495, 0.0385, 0.0352, // 6h-11h : pic matinal ~8h
    0.0385, 0.0352, 0.0330, 0.0352, 0.0418, 0.0527, // 12h-17h : creux après-midi (léger pic déjeuner 12h-13h)
    0.0769, 0.0879, 0.0714, 0.0549, 0.0418, 0.0305  // 18h-23h : pic soirée ~19h-20h
  ],
  tertiaire: [
    0.0109, 0.0109, 0.0109, 0.0109, 0.0109, 0.0163, // nuit : quasi nul (hors serveurs/veille)
    0.0272, 0.0543, 0.0761, 0.0815, 0.0815, 0.0761, // montée en journée, pic matin bureaux
    0.0652, 0.0761, 0.0815, 0.0815, 0.0761, 0.0598, // reprise après-midi
    0.0326, 0.0163, 0.0109, 0.0109, 0.0109, 0.0107  // extinction en soirée
  ],
  industriel: [
    0.0396, 0.0396, 0.0396, 0.0396, 0.0396, 0.0396, // fonctionnement 3x8 : plateau quasi constant
    0.0446, 0.0446, 0.0446, 0.0446, 0.0446, 0.0446,
    0.0446, 0.0446, 0.0446, 0.0446, 0.0396, 0.0396,
    0.0396, 0.0396, 0.0396, 0.0396, 0.0396, 0.0392
  ],
  supermarche: [
    0.0191, 0.0172, 0.0172, 0.0172, 0.0172, 0.0191, // nuit : froid alimentaire actif
    0.0239, 0.0335, 0.0478, 0.0574, 0.0622, 0.0670, // ouverture, montée fréquentation
    0.0718, 0.0670, 0.0574, 0.0526, 0.0574, 0.0670, // pic déjeuner + reprise après-midi
    0.0718, 0.0574, 0.0383, 0.0239, 0.0191, 0.0175  // pic fin de journée puis fermeture
  ],
  agricole: [
    0.0282, 0.0282, 0.0282, 0.0282, 0.0329, 0.0469, // activité dès l'aube (traite, irrigation)
    0.0610, 0.0563, 0.0516, 0.0469, 0.0469, 0.0469,
    0.0423, 0.0423, 0.0469, 0.0469, 0.0516, 0.0563,
    0.0516, 0.0423, 0.0329, 0.0282, 0.0282, 0.0283
  ],
  // Boulangerie : production du pain le matin (fournées dès 4 h, ≈ 28 % de l'énergie du jour entre 4 h
  // et 8 h) ET en journée (fournées de midi et de fin d'après-midi), vente 8 h 30 - 19 h 30 (≈ 65 %
  // entre 8 h et 20 h).
  boulangerie: [
    0.0067, 0.0067, 0.0067, 0.0202, 0.0538, 0.0739, // nuit : froid ; pétrissage dès 3 h, fournées dès 4 h
    0.0807, 0.0739, 0.0645, 0.0605, 0.0565, 0.0618, // fournées du matin, ouverture 8 h 30, fournée de midi
    0.0591, 0.0484, 0.0457, 0.0538, 0.0618, 0.0591, // vente, creux d'après-midi, fournée du soir
    0.0484, 0.0269, 0.0108, 0.0067, 0.0067, 0.0067  // fermeture 19 h 30, nettoyage
  ],
  // Magasin discount / bazar : ouverture 8 h 30 - 19 h 30 (≈ 88 % de l'énergie du jour sur cette plage).
  discount: [
    0.0050, 0.0050, 0.0050, 0.0050, 0.0050, 0.0050, // nuit : veille
    0.0066, 0.0132, 0.0430, 0.0827, 0.0827, 0.0827, // mise en route, ouverture 8 h 30
    0.0827, 0.0827, 0.0860, 0.0860, 0.0860, 0.0860, // éclairage + ventilation en journée
    0.0827, 0.0397, 0.0099, 0.0058, 0.0058, 0.0058  // fermeture 19 h 30
  ],
  autres: Array(24).fill(1 / 24)
};
