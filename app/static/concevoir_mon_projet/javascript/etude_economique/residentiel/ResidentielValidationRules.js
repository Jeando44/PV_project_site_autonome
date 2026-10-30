/**
 * Règles de validation + définition des postes CAPEX/OPEX du Chiffrage & Devis Résidentiel.
 *
 * Même esprit que le moteur RULES/LIMITS de Liste_de_materiel/liste_de_materiels.js (bornes
 * min/max, message d'erreur bloquant via une modale) mais bornes propres au résidentiel et
 * indépendantes de la table #tableMateriels des grands projets (cf. plan approuvé — pas de
 * réutilisation littérale du module BOM pour éviter toute régression sur cette fonctionnalité
 * déjà en production).
 *
 * Namespace partagé par tous les fichiers du dossier residentiel/.
 */
(function () {
    'use strict';

    window.ResidentielChiffrage = window.ResidentielChiffrage || {};

    // Taux de TVA autorisés par ligne (identiques aux options déjà utilisées par le sélecteur
    // TVA global de la Liste de matériels : getTauxTVA()/#tva_projet).
    const TVA_RATES = [0, 5.5, 10, 20];

    // Bornes génériques pour toute ligne CAPEX (Qté / PU HT) : volontairement larges (un devis
    // résidentiel réel reste très en-deçà) mais bloquent les saisies aberrantes/négatives.
    const CAPEX_QTE_RULE = { min: 0, max: 999, label: 'Quantité' };
    const CAPEX_PU_HT_RULE = { min: 0, max: 99999, label: 'Prix unitaire HT' };

    // CORRECTIF (demande explicite : "validation stricte des données d'entrée pour les Charges
    // annuelles (OPEX)") : bornes + valeurs par défaut mises à jour (toutes à 0 par défaut). DOIT
    // rester identique à OPEX_RULES dans app/schemas/residentiel_chiffrage_schemas.py.
    const OPEX_RULES = {
        assurances: { label: 'Assurances', min: 0, max: 100, defaultValue: 0 },
        communication: { label: 'Communication et pilotage', min: 0, max: 200, defaultValue: 0 },
        visiteTechnique: { label: 'Visite technique annuelle', min: 0, max: 200, defaultValue: 0 },
        autres: { label: 'Autres', min: 0, max: 200, defaultValue: 0 }
    };

    // NOUVEAU (demande explicite : "validation stricte des données d'entrée") : règle de texte
    // globale pour tout champ Désignation (ligne freeform uniquement, cf. lockedDesignation)/
    // Référence — chaîne, max 30 caractères ET max 5 mots. DOIT rester identique à
    // TEXTE_MAX_CARACTERES/TEXTE_MAX_MOTS dans app/schemas/residentiel_chiffrage_schemas.py
    // (double-vérifié à la main, pas de génération de schéma partagée entre les deux langages).
    const TEXTE_MAX_CARACTERES = 30;
    const TEXTE_MAX_MOTS = 5;

    // Règle par sous-type (line.key) : {qte:[min,max], puHt:[min,max]} — GLOBALE, pas dupliquée par
    // poste : un même sous-type (ex. "onduleurs") a la même règle où qu'il apparaisse (cf. spec
    // métier : "Onduleurs" cité à la fois pour Matériels photovoltaïques et Matériels électriques,
    // avec la même plage 1-10). DOIT rester identique à SUBTYPE_RULES côté backend.
    const SUBTYPE_RULES = {
        offre_commerciale: { qte: [1, 1], puHt: [0, 5000] },
        dp_mairie: { qte: [1, 1], puHt: [0, 5000] },
        demande_raccordement: { qte: [1, 1], puHt: [0, 5000] },
        consuel_mise_service: { qte: [1, 1], puHt: [0, 5000] },

        systeme_integration: { qte: [1, 1], puHt: [0, 20000] },
        onduleurs: { qte: [0, 10], puHt: [0, 20000] },
        // Quantité imposée par le calepinage (QTE_DEPUIS_CALEPINAGE, champ en lecture seule) : même
        // plafond qu'en PRO. Une borne de 250 bloquait l'enregistrement de tout le projet (Site
        // autonome d'une typologie PRO, profil résidentiel) sans que l'utilisateur puisse corriger.
        panneaux_solaires: { qte: [1, 50000], puHt: [0, 20000] },
        optimiseurs: { qte: [0, 100], puHt: [0, 20000] },
        micro_onduleurs: { qte: [0, 100], puHt: [0, 20000] },

        coffret_dc: { qte: [0, 2], puHt: [0, 20000] },
        coffret_ac: { qte: [1, 2], puHt: [0, 20000] },
        coffret_consuel: { qte: [1, 1], puHt: [0, 20000] },
        // Câbles : quantité en mètres, PU HT au mètre linéaire (0-200 €/ml) — override du PU HT
        // "général" (0-20000) du poste materiels_elec.
        cable_dc: { qte: [0, 2000], puHt: [0, 200] },
        cable_ac: { qte: [0, 100], puHt: [0, 200] },
        cable_terre: { qte: [0, 500], puHt: [0, 200] },

        batterie: { qte: [0, 10], puHt: [0, 20000] },
        // Quantité 1 si la batterie virtuelle est retenue, 0 sinon (cf. LIGNE_ACTIVATION_BV).
        frais_activation_bv: { qte: [0, 1], puHt: [50, 500] },
        borne_recharge: { qte: [0, 10], puHt: [0, 20000] },

        pilotage: { qte: [1, 1], puHt: [0, 3000] },

        main_oeuvre: { qte: [1, 1], puHt: [0, 50000] },

        pompage_solaire: { qte: [0, 20], puHt: [0, 3000] },
        autres_generaux: { qte: [0, 20], puHt: [0, 3000] },

        aides_primes: { qte: [1, 1], puHt: [0, 50000] }
    };

    // Repli par poste (ligne freeform sans key, ou clé de sous-type non reconnue — ex. "autres" du
    // poste materiels_elec, pour lequel le spec métier ne donne pas de plage de quantité explicite :
    // repli sur le garde-fou générique déjà en place, CAPEX_QTE_RULE). DOIT rester identique à
    // POSTE_DEFAULT_RULES côté backend.
    const POSTE_DEFAULT_RULES = {
        etudes: { qte: [1, 1], puHt: [0, 5000] },
        materiels_pv: { qte: [0, 999], puHt: [0, 20000] },
        materiels_elec: { qte: [0, 999], puHt: [0, 20000] },
        stockage: { qte: [0, 10], puHt: [0, 20000] },
        borne: { qte: [0, 10], puHt: [0, 20000] },
        pilotage: { qte: [1, 1], puHt: [0, 3000] },
        main_oeuvre: { qte: [1, 1], puHt: [0, 50000] },
        autres: { qte: [0, 20], puHt: [0, 3000] },
        aides: { qte: [1, 1], puHt: [0, 50000] }
    };

    // Profil PRO / Grand projet (même tableau de chiffrage, cf. pro/ProEtudeEcoView.js) : installations
    // de 100 kWc à plusieurs MWc, bornes résidentielles trop étroites (250 panneaux, 10 onduleurs,
    // 2000 m de câble DC...) donc élargies, plus les lignes des cartes Structure / Génie civil /
    // Gestion des eaux pluviales. `zero: true` : 0 est aussi accepté (« non concerné ») pour la
    // quantité comme pour le PU HT, sinon la valeur doit tenir dans la plage — sans cela, un projet
    // en toiture se verrait imposer un coût de fondations ou d'eaux pluviales (minimums de 100 à
    // 1000 € demandés). DOIT rester identique à SUBTYPE_RULES_PRO / POSTE_DEFAULT_RULES_PRO dans
    // app/schemas/residentiel_chiffrage_schemas.py.
    const SUBTYPE_RULES_PRO = {
        offre_commerciale: { qte: [1, 1], puHt: [0, 50000] },
        dp_mairie: { qte: [1, 1], puHt: [0, 50000] },
        demande_raccordement: { qte: [1, 1], puHt: [0, 50000] },
        consuel_mise_service: { qte: [1, 1], puHt: [0, 50000] },

        panneaux_solaires: { qte: [1, 50000], puHt: [0, 20000] },
        onduleurs: { qte: [0, 500], puHt: [0, 200000] },
        micro_onduleurs: { qte: [0, 50000], puHt: [0, 20000] },
        optimiseurs: { qte: [0, 50000], puHt: [0, 20000] },

        coffret_dc: { qte: [0, 200], puHt: [0, 200000] },
        coffret_ac: { qte: [1, 50], puHt: [0, 200000] },
        coffret_consuel: { qte: [1, 10], puHt: [0, 20000] },
        cable_dc: { qte: [0, 100000], puHt: [0, 500] },
        cable_ac: { qte: [0, 20000], puHt: [0, 500] },
        cable_terre: { qte: [0, 50000], puHt: [0, 500] },

        // Carte Structure. Le système d'intégration quitte « Matériels photovoltaïques » en PRO.
        structure_porteuse: { qte: [1, 100], puHt: [200, 1000000], zero: true },
        pannes: { qte: [1, 500], puHt: [200, 500000], zero: true },
        systeme_integration: { qte: [1, 100], puHt: [100, 500000], zero: true },

        // Carte Génie civil.
        fondations: { qte: [1, 500], puHt: [500, 1000000], zero: true },
        fourreaux: { qte: [1, 5000], puHt: [500, 1000000], zero: true },
        regard: { qte: [1, 100], puHt: [100, 1000000], zero: true },
        chambre_tirage: { qte: [1, 100], puHt: [100, 1000000], zero: true },
        autres_genie_civil: { qte: [1, 100], puHt: [1000, 1000000], zero: true },
        reprise_enrobe: { qte: [1, 500], puHt: [100, 1000000], zero: true },

        // Carte Gestion des eaux pluviales.
        ouvrage_ep: { qte: [1, 50], puHt: [1000, 1000000], zero: true },
        regard_grille_ep: { qte: [1, 200], puHt: [100, 1000000], zero: true },
        tranchee_ep: { qte: [1, 1000], puHt: [100, 1000000], zero: true },
        tuyau_pvc: { qte: [1, 5000], puHt: [100, 1000000], zero: true },

        batterie: { qte: [0, 100], puHt: [0, 1000000] },
        frais_activation_bv: { qte: [0, 1], puHt: [50, 500] },
        borne_recharge: { qte: [0, 500], puHt: [0, 100000] },
        pilotage: { qte: [1, 1], puHt: [0, 100000] },
        main_oeuvre: { qte: [1, 1], puHt: [0, 2000000] },
        pompage_solaire: { qte: [0, 50], puHt: [0, 200000] },
        autres_generaux: { qte: [0, 50], puHt: [0, 500000] },
        aides_primes: { qte: [1, 1], puHt: [0, 2000000] }
    };
    const POSTE_DEFAULT_RULES_PRO = {
        etudes: { qte: [1, 1], puHt: [0, 50000] },
        materiels_pv: { qte: [0, 50000], puHt: [0, 200000] },
        materiels_elec: { qte: [0, 9999], puHt: [0, 200000] },
        structure: { qte: [0, 500], puHt: [0, 1000000] },
        genie_civil: { qte: [0, 5000], puHt: [0, 1000000] },
        eaux_pluviales: { qte: [0, 5000], puHt: [0, 1000000] },
        stockage: { qte: [0, 100], puHt: [0, 1000000] },
        borne: { qte: [0, 500], puHt: [0, 100000] },
        pilotage: { qte: [1, 1], puHt: [0, 100000] },
        main_oeuvre: { qte: [1, 1], puHt: [0, 2000000] },
        autres: { qte: [0, 50], puHt: [0, 500000] },
        aides: { qte: [1, 1], puHt: [0, 2000000] }
    };

    // Lignes PRO affichées selon le type de structure du projet (sinon masquées et hors totaux) :
    // structure porteuse pour les ombrières métal et les petits champs solaires, pannes pour les
    // ombrières métal seulement. DOIT rester identique à LIGNES_CONDITIONNELLES côté Python.
    const LIGNES_CONDITIONNELLES = {
        structure_porteuse: ['ombriere_metal', 'champ_solaire'],
        pannes: ['ombriere_metal']
    };

    /** Vrai si la ligne `lineKey` est à afficher pour les types de structure `typesStructure`. */
    function isLigneApplicable(lineKey, typesStructure) {
        const types = LIGNES_CONDITIONNELLES[lineKey];
        if (!types) return true;
        return (typesStructure || []).some((t) => types.includes(t));
    }

    /** Profil du chiffrage : 'pro' une fois la vue PRO / Grand projet initialisée, sinon 'residentiel'. */
    function getProfil() {
        return window.ResidentielChiffrage.profil === 'pro' ? 'pro' : 'residentiel';
    }

    function rulesFor(profil) {
        return (profil || getProfil()) === 'pro'
            ? { subtype: SUBTYPE_RULES_PRO, poste: POSTE_DEFAULT_RULES_PRO }
            : { subtype: SUBTYPE_RULES, poste: POSTE_DEFAULT_RULES };
    }

    // Type de matériel de conversion du projet (sélecteur du poste "Matériels photovoltaïques") et
    // lignes dont la quantité est alors figée à 0, pour éviter qu'une quantité par défaut ne soit
    // multipliée par un prix sur un matériel absent de l'installation :
    //   - onduleur de chaîne / central (hybride compris) : ni micro-onduleurs ni optimiseurs ;
    //   - onduleur + optimiseurs : pas de micro-onduleurs (le coffret DC reste, le câblage DC
    //     jusqu'à l'onduleur existe toujours) ;
    //   - micro-onduleurs : conversion au pied de chaque panneau, donc ni onduleur central, ni
    //     optimiseurs, ni coffret DC.
    // Les quantités minimales correspondantes sont à 0 dans SUBTYPE_RULES. DOIT rester identique à
    // CONVERSION_LOCKS dans app/schemas/residentiel_chiffrage_schemas.py.
    const CONVERSION_TYPES = [
        { value: 'chaine', label: 'Onduleur de chaîne / central' },
        { value: 'optimiseurs', label: 'Onduleur + optimiseurs' },
        { value: 'micro', label: 'Micro-onduleurs' }
    ];
    const CONVERSION_LOCKS = {
        chaine: ['micro_onduleurs', 'optimiseurs'],
        optimiseurs: ['micro_onduleurs'],
        micro: ['onduleurs', 'optimiseurs', 'coffret_dc']
    };

    /**
     * Modes de saisie de la TVA du chiffrage : 'par_ligne' (défaut, chaque taux modifiable) ou
     * 'unique' (une TVA globale appliquée à toutes les lignes). Miroir de TVA_MODES dans
     * residentiel_chiffrage_schemas.py.
     */
    const TVA_MODES = ['par_ligne', 'unique'];

    /**
     * Prix cible et marge (ResidentielCapexTable.js::renderMarge) — miroir de PRIX_CIBLE_BORNES et
     * MARGE_CIBLE_BORNES dans residentiel_chiffrage_schemas.py. Prix cible en €/Wc (multiplié par
     * la puissance du projet) ou prix de vente fixe ; marge cible en %.
     */
    const PRIX_CIBLE_RULES = {
        wc: { min: 0.3, max: 10, label: 'Prix cible (€/Wc)' },
        fixe: { min: 500, max: 15000000, label: 'Prix cible (€)' }
    };
    const MARGE_CIBLE_RULE = { min: 1, max: 100, defaut: 30, label: 'Marge cible (%)' };

    /** Contrôle d'une valeur de prix cible / marge cible (vide accepté : pas encore saisie). */
    function validerBorne(rule, valeur, videAccepte) {
        if (valeur === null || valeur === undefined || valeur === '') {
            return videAccepte ? { valid: true, message: '' } : { valid: false, message: `${rule.label} : valeur requise.` };
        }
        const n = Number(valeur);
        if (!Number.isFinite(n)) return { valid: false, message: `${rule.label} : nombre attendu.` };
        if (n < rule.min || n > rule.max) {
            return { valid: false, message: `${rule.label} : entre ${rule.min.toLocaleString('fr-FR')} et ${rule.max.toLocaleString('fr-FR')}.` };
        }
        return { valid: true, message: '' };
    }
    function validatePrixCible(mode, valeur) {
        const rule = PRIX_CIBLE_RULES[mode];
        return rule ? validerBorne(rule, valeur, true) : { valid: false, message: 'Mode de prix cible inconnu.' };
    }
    function validateMargeCible(valeur) {
        return validerBorne(MARGE_CIBLE_RULE, valeur, false);
    }

    /**
     * Lignes dont la quantité vient TOUJOURS du calepinage (nombre de panneaux posés), pour tous les
     * types d'étude : jamais saisie dans les Favoris chiffrage ni appliquée depuis eux, et en lecture
     * seule dans le tableau CAPEX dès que le calepinage compte au moins un panneau.
     */
    const QTE_DEPUIS_CALEPINAGE = ['panneaux_solaires'];
    function isQteDepuisCalepinage(lineKey) {
        return !!lineKey && QTE_DEPUIS_CALEPINAGE.includes(lineKey);
    }

    /**
     * Ligne « Frais d'activation batterie virtuelle » du poste « Système de stockage par batterie »
     * (résidentiel et PRO) : prix par défaut 300 € (50-500 €, cf. SUBTYPE_RULES), quantité figée à 1
     * quand la batterie virtuelle est retenue (case du calepinage / de l'étude économique), à 0 sinon
     * (cf. ResidentielCapexTable.js::syncActivationBv). Miroir Python : SUBTYPE_RULES(_PRO).
     */
    const LIGNE_ACTIVATION_BV = {
        key: 'frais_activation_bv',
        posteKey: 'stockage',
        designation: "Frais d'activation batterie virtuelle",
        puHtDefaut: 300
    };
    function ligneActivationBv(tvaPct) {
        const ligne = freshLine(LIGNE_ACTIVATION_BV.designation, typeof tvaPct === 'number' ? tvaPct : 20, true, LIGNE_ACTIVATION_BV.key);
        ligne.qte = 0;
        ligne.puHt = LIGNE_ACTIVATION_BV.puHtDefaut;
        return ligne;
    }
    function isQteDepuisBatterieVirtuelle(lineKey) {
        return lineKey === LIGNE_ACTIVATION_BV.key;
    }

    /** Vrai si la quantité de la ligne `lineKey` est figée à 0 pour ce type de conversion. */
    function isQteLockedForConversion(conversionType, lineKey) {
        return !!(lineKey && CONVERSION_LOCKS[conversionType] && CONVERSION_LOCKS[conversionType].includes(lineKey));
    }

    // Règle TVA par défaut (résidentiel, France) : ≤9 kWc → 5.5%, >9 kWc → 20%. Le poste
    // "Système de stockage par batterie" déroge toujours à 20% quelle que soit la puissance
    // (appliqué explicitement par l'appelant, pas ici).
    // Profil PRO : toujours 20 %.
    function getDefaultTvaRate(puissanceKwc, profil) {
        if ((profil || getProfil()) === 'pro') return 20;
        return (Number(puissanceKwc) || 0) <= 9 ? 5.5 : 20;
    }

    // 9 postes CAPEX, chacun pré-rempli avec ses sous-équipements nommés (Qté/PU HT/TVA/Référence
    // restent éditables, lignes supprimables, et de nouvelles lignes peuvent être ajoutées dans
    // chaque poste). "Aides et primes" est un poste déductif (même convention que le champ
    // existant "Subvention (à déduire)" du CAPEX détaillé Pro/Grand projet, cf. #capex_subvention).
    // `lockedDesignation` : CORRECTIF (demande explicite : "figer la modification de tous les
    // labels de désignations par défaut") — TOUTE ligne "seed" créée ici a désormais sa désignation
    // verrouillée (concept fixe, ex. "Batterie"), jamais modifiable par l'utilisateur ; seules
    // Qté/PU HT/TVA/Référence le restent. Ne s'applique jamais aux lignes ajoutées ensuite via
    // "+ Ajouter une ligne" (cf. ResidentielCapexTable.js, freshLine(..., false) explicite).
    function freshLine(designation, tvaPct, lockedDesignation, key) {
        return {
            designation: designation || '',
            reference: '',
            qte: 1,
            puHt: 0,
            tvaPct: (typeof tvaPct === 'number') ? tvaPct : 20,
            lockedDesignation: !!lockedDesignation,
            // false tant que l'utilisateur n'a jamais changé la TVA lui-même : permet de continuer à
            // appliquer la règle par défaut (TVA selon puissance) de façon réactive si la puissance
            // n'était pas encore connue à la création de la ligne — cf.
            // ResidentielCapexTable.js::reapplyDefaultTvaRates().
            tvaManual: false,
            // NOUVEAU (demande explicite : "validation stricte des données d'entrée") : identifiant
            // stable de sous-type (ex. "panneaux_solaires"), utilisé par validateLigneField()/le
            // backend (residentiel_chiffrage_schemas.py) pour résoudre la règle de quantité/PU HT
            // applicable — INDÉPENDANT de la désignation (texte libre, potentiellement traduit/
            // modifié un jour). `null` pour une ligne freeform ajoutée via "+ Ajouter une ligne" :
            // validée par la règle de repli du poste (cf. POSTE_DEFAULT_RULES plus bas).
            key: key || null
        };
    }

    /**
     * @param {number} [puissanceKwc] - puissance du projet (kWc), utilisée pour déterminer le taux
     *   de TVA par défaut de chaque ligne (cf. getDefaultTvaRate) ; 20% par défaut si omise.
     * @param {string} [profil] - 'residentiel' | 'pro' (profil courant si omis). En PRO, le système
     *   d'intégration passe dans la carte Structure, et les cartes Structure / Génie civil / Gestion
     *   des eaux pluviales s'insèrent juste sous « Matériels électriques ».
     */
    function buildDefaultPostes(puissanceKwc, profil) {
        const pro = (profil || getProfil()) === 'pro';
        const tva = getDefaultTvaRate(puissanceKwc, pro ? 'pro' : 'residentiel');
        // CORRECTIF (demande explicite : "figer la modification de tous les labels de désignations
        // par défaut") : toute ligne "seed" construite via ce helper est désormais TOUJOURS
        // verrouillée (lockedDesignation: true), quel que soit l'appelant — le 2ᵉ paramètre
        // `locked` n'a donc plus d'utilité ici (conservé côté freshLine() pour les cas d'appel
        // direct ci-dessous, ex. "Pompage solaire"/"Batterie"). NOUVEAU (validation stricte) :
        // `line(designation, key)` transmet désormais aussi l'identifiant stable de sous-type.
        const line = (designation, key) => freshLine(designation, tva, true, key);
        return [
            {
                key: 'etudes',
                label: 'Études et démarches administratives',
                deduction: false,
                hideReference: true,
                lines: [
                    line('Offre commerciale', 'offre_commerciale'),
                    line('DP en mairie', 'dp_mairie'),
                    line('Demande de raccordement', 'demande_raccordement'),
                    line('Consuel & mise en service', 'consuel_mise_service'),
                ]
            },
            {
                key: 'materiels_pv',
                label: 'Matériels photovoltaïques',
                deduction: false,
                // CORRECTIF (demande explicite : "séparer onduleurs de micro-onduleurs") : la ligne
                // combinée "Onduleurs/Micro-onduleurs" est éclatée en 2 lignes distinctes (chacune
                // avec sa propre Qté/PU HT/TVA), et "Optimiseurs" est ajouté comme 3ᵉ ligne de
                // matériel de conversion — cf. syncFromCalepinage() plus bas dans
                // ResidentielCapexTable.js pour la synchronisation depuis le calepinage (limitée à
                // "Onduleurs", le calepinage ne distinguant pas onduleur centralisé/micro-onduleur/
                // optimiseur).
                lines: [
                    line('Panneaux solaires', 'panneaux_solaires'),
                    line('Onduleurs', 'onduleurs'),
                    line('Micro-onduleurs', 'micro_onduleurs'),
                    line('Optimiseurs', 'optimiseurs'),
                ].concat(pro ? [] : [line("Système d'intégration", 'systeme_integration')])
            },
            {
                key: 'materiels_elec',
                label: 'Matériels électriques',
                deduction: false,
                lines: [
                    line('Coffret DC', 'coffret_dc'),
                    line('Coffret AC', 'coffret_ac'),
                    line('Coffret Consuel', 'coffret_consuel'),
                    line('Câbles DC', 'cable_dc'),
                    line('Câbles AC', 'cable_ac'),
                    line('Câbles Terre', 'cable_terre'),
                    line('Autres', 'autres'),
                ]
            },
            ...(pro ? [
                {
                    key: 'structure',
                    label: 'Structure',
                    deduction: false,
                    lines: [
                        line('Structure porteuse', 'structure_porteuse'),
                        line('Pannes', 'pannes'),
                        line("Système d'intégration", 'systeme_integration'),
                    ]
                },
                {
                    key: 'genie_civil',
                    label: 'Génie civil',
                    deduction: false,
                    lines: [
                        line('Fondations', 'fondations'),
                        line('Fourreaux (ml)', 'fourreaux'),
                        line('Regard', 'regard'),
                        line('Chambre de tirage', 'chambre_tirage'),
                        line('Autres', 'autres_genie_civil'),
                        line('Reprise enrobée (m²)', 'reprise_enrobe'),
                    ]
                },
                {
                    key: 'eaux_pluviales',
                    label: 'Gestion des eaux pluviales',
                    deduction: false,
                    lines: [
                        line('Ouvrage de gestion des EP', 'ouvrage_ep'),
                        line('Regard / grille EP', 'regard_grille_ep'),
                        line('Tranchée (ml)', 'tranchee_ep'),
                        line('Tuyau PVC', 'tuyau_pvc'),
                    ]
                },
            ] : []),
            {
                key: 'stockage',
                label: 'Système de stockage par batterie',
                deduction: false,
                // Exception métier : toujours 20% de TVA, quelle que soit la puissance du projet.
                lines: [freshLine('Batterie', 20, true, 'batterie'), ligneActivationBv(20)]
            },
            {
                key: 'borne',
                label: 'Borne de recharge',
                deduction: false,
                lines: [line('Borne de recharge', 'borne_recharge')]
            },
            {
                key: 'pilotage',
                label: 'Pilotage énergétique et Domotique',
                deduction: false,
                lines: [line('Pilotage énergétique / Domotique', 'pilotage')]
            },
            {
                key: 'main_oeuvre',
                label: "Main-d'œuvre",
                deduction: false,
                hideReference: true,
                lines: [line("Main-d'œuvre", 'main_oeuvre')]
            },
            {
                key: 'autres',
                label: 'Autres généraux',
                deduction: false,
                // "Pompage solaire" : synchronisée depuis le calepinage multi-typologie (cf.
                // ResidentielCapexTable.js::syncFromCalepinage()) — TVA fixée à 20% par défaut
                // (demande explicite), indépendamment de la puissance : tvaManual=true dès la
                // création empêche reapplyDefaultTvaRates() de la recalculer selon la puissance
                // (même mécanisme que pour une ligne modifiée manuellement par l'utilisateur).
                lines: (() => {
                    const pompage = freshLine('Pompage solaire', 20, true, 'pompage_solaire');
                    pompage.tvaManual = true;
                    return [pompage, line('Autres', 'autres_generaux')];
                })()
            },
            {
                key: 'aides',
                label: 'Aides et primes (à déduire)',
                deduction: true,
                lines: [line('Aides et primes', 'aides_primes')]
            }
        ];
    }

    /** Affiche une erreur bloquante via la modale déjà présente dans etudes_economique_content.html. */
    function showAlert(message) {
        if (typeof window.showCustomValidationModal === 'function') {
            window.showCustomValidationModal(message);
        } else {
            alert(message);
        }
    }

    /** Valide/écrête une valeur numérique selon une règle {min,max,label}. Retourne la valeur validée. */
    function clampWithAlert(rawValue, rule, previousValue) {
        const value = parseFloat(rawValue);
        if (isNaN(value)) return 0;
        if (value < rule.min || value > rule.max) {
            showAlert(`${rule.label} : la valeur saisie (${rawValue}) doit être comprise entre ${rule.min} et ${rule.max}.`);
            return (typeof previousValue === 'number') ? previousValue : rule.min;
        }
        return value;
    }

    /**
     * NOUVEAU (demande explicite : "validation stricte des données d'entrée... rejet strict...
     * jamais de correction silencieuse") : remplace clampWithAlert() pour les champs CAPEX qte/
     * puHt/désignation(freeform)/référence — ne modifie JAMAIS la valeur saisie, se contente de
     * signaler si elle est valide ou non (message précis, affiché sous le champ concerné par
     * l'appelant, cf. ResidentielCapexTable.js::attachEvents()).
     *
     * @param {string} field - 'designation' | 'reference' | 'qte' | 'puHt'
     * @param {object} context - { posteKey, lineKey, designation, rawValue, profil? } (profil courant si omis)
     * @returns {{valid: boolean, message: string}}
     */
    function validateLigneField(field, context) {
        const { posteKey, lineKey, designation, rawValue } = context;

        if (field === 'designation' || field === 'reference') {
            const label = field === 'designation' ? 'Désignation' : 'Référence';
            const value = String(rawValue == null ? '' : rawValue);
            // Une Référence vide reste valide (colonne masquée pour certains postes, ou simplement
            // pas encore renseignée) — seul un texte réellement saisi est contraint.
            if (field === 'reference' && !value) return { valid: true, message: '' };
            if (value.length > TEXTE_MAX_CARACTERES) {
                return { valid: false, message: `${label} : ${value.length} caractères saisis, maximum ${TEXTE_MAX_CARACTERES} autorisés.` };
            }
            const nbMots = value.split(/\s+/).filter(Boolean).length;
            if (nbMots > TEXTE_MAX_MOTS) {
                return { valid: false, message: `${label} : ${nbMots} mots saisis, maximum ${TEXTE_MAX_MOTS} autorisés.` };
            }
            return { valid: true, message: '' };
        }

        if (field === 'qte' || field === 'puHt') {
            const label = field === 'qte' ? 'Quantité' : 'Prix unitaire HT';
            const value = parseFloat(rawValue);
            if (isNaN(value)) {
                return { valid: false, message: `${label} : "${rawValue}" n'est pas un nombre valide.` };
            }
            // Repli ultime (poste inconnu) : garde-fou générique déjà en place, CAPEX_QTE_RULE/
            // CAPEX_PU_HT_RULE (réutilisés ici plutôt que dupliqués en dur).
            const tables = rulesFor(context.profil);
            const regle = (lineKey && tables.subtype[lineKey]) || tables.poste[posteKey]
                || { qte: [CAPEX_QTE_RULE.min, CAPEX_QTE_RULE.max], puHt: [CAPEX_PU_HT_RULE.min, CAPEX_PU_HT_RULE.max] };
            const [min, max] = regle[field];
            if (regle.zero && value === 0) return { valid: true, message: '' };
            if (value < min || value > max) {
                const zero = regle.zero ? ' (ou 0 si non concerné)' : '';
                return { valid: false, message: `${label} (${designation || '?'}) : doit être compris(e) entre ${min} et ${max}${zero}.` };
            }
            return { valid: true, message: '' };
        }

        return { valid: true, message: '' };
    }

    /**
     * NOUVEAU (demande explicite : "validation stricte des données d'entrée pour les Charges
     * annuelles (OPEX)") : même esprit que validateLigneField() — ne modifie JAMAIS la valeur
     * saisie, signale uniquement (message précis, affiché sous le champ par l'appelant, cf.
     * ResidentielOpexTable.js::renderCharges()). Remplace clampWithAlert() pour ces 4 champs.
     *
     * @param {string} key - 'assurances' | 'communication' | 'visiteTechnique' | 'autres'
     * @param {*} rawValue
     * @returns {{valid: boolean, message: string}}
     */
    function validateOpexField(key, rawValue) {
        const rule = OPEX_RULES[key];
        if (!rule) return { valid: true, message: '' };
        const value = parseFloat(rawValue);
        if (isNaN(value)) {
            return { valid: false, message: `${rule.label} : "${rawValue}" n'est pas un nombre valide.` };
        }
        if (value < rule.min || value > rule.max) {
            return { valid: false, message: `${rule.label} : doit être compris entre ${rule.min} et ${rule.max}.` };
        }
        return { valid: true, message: '' };
    }

    /**
     * CORRECTIF (demande explicite : "le changement de devise ne modifie pas les autres unités") :
     * ResidentielCapexTable.js/ResidentielOpexTable.js régénèrent entièrement leur HTML à chaque
     * rendu (state.postes/state.charges → innerHTML) et affichaient jusqu'ici un "€" écrit en dur
     * dans ces gabarits — resélectionner "$"/"FCFA"/"HTG" ne changeait donc jamais ces tableaux, et
     * même les libellés déjà mis à jour par updateDeviseLabels() (via la classe .symb-devise)
     * revenaient à "€" au prochain re-rendu (ajout/édition d'une ligne). Fonction partagée, même
     * source que celle déjà utilisée par DevisPdfGenerator.js (radio #devise, Production — champ du
     * moteur de calcul partagé) : "€"/"$"/"FCFA"/"HTG". Repli sur "€" si absent.
     */
    function getDeviseSymbol() {
        const checked = document.querySelector('input[name="devise"]:checked');
        return (checked && checked.value) || '€';
    }

    window.ResidentielChiffrage.Rules = {
        TVA_RATES,
        CAPEX_QTE_RULE,
        CAPEX_PU_HT_RULE,
        OPEX_RULES,
        CONVERSION_TYPES,
        CONVERSION_LOCKS,
        LIGNES_CONDITIONNELLES,
        isQteLockedForConversion,
        QTE_DEPUIS_CALEPINAGE,
        isQteDepuisCalepinage,
        LIGNE_ACTIVATION_BV,
        ligneActivationBv,
        isQteDepuisBatterieVirtuelle,
        TVA_MODES,
        PRIX_CIBLE_RULES,
        MARGE_CIBLE_RULE,
        validatePrixCible,
        validateMargeCible,
        isLigneApplicable,
        getProfil,
        getDefaultTvaRate,
        buildDefaultPostes,
        freshLine,
        showAlert,
        clampWithAlert,
        getDeviseSymbol,
        validateLigneField,
        validateOpexField
    };
})();
