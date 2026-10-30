/**
 * Section « PAC / Climatiseur » de la modale de consommation d'énergie (app_irve_v1.16.html).
 * =========================================================================================
 * Même modèle que les sections Pompage solaire et Système hybride : balisage construit à la première
 * ouverture dans #pac-section-content, calculs dans des fichiers purs (pac_modele_cop.js,
 * pac_dimensionnement.js, pac_simulation.js), données de référence dans donnees/*.json.
 *
 * Phase 1 (cf. docs/pac_climatisation_plan.md) : configuration, dimensionnement, simulation au pas de
 * la courbe de charge, affichage jour / mois / an par usage, exports. Les saisies ne sont pas encore
 * enregistrées en base : la configuration s'exporte et se réimporte en JSON.
 *
 * Phase 2 : après chaque calcul, la courbe PAC (et sa variante « ECS aux heures solaires ») est
 * transmise à l'autoconsommation PAR LA BASE (POST .../pac/save-curve), comme la courbe IRVE ; le
 * dernier résultat d'autoconsommation de la PAC est relu par GET .../pac/curve-info. Courbe de charge
 * du site (existant + IRVE + PAC), pointe et puissance souscrite.
 *
 * Phase 3 : schéma de principe SVG (pac_schema.js), redessiné à chaque changement de configuration ;
 * étude de rentabilité (pac_rentabilite.js) contre un système de référence fournissant la même
 * énergie utile, avec le PV consommé par la PAC tiré du dernier calcul d'autoconsommation de CETTE
 * courbe. Champs de l'étude préfixés « pacr_ » : ils ne relancent pas la simulation.
 *
 * Contrôle des calculs (pac_verification.js) : après chaque calcul affiché, entrées et résultats
 * sont recalculés par le calcul de référence (pac_calculs.py) ; au-delà de 0,01 d'écart, les valeurs
 * de référence remplacent celles affichées. Saisies conservées dans le navigateur, par utilisateur et
 * par projet vérifié (clé skv_pac_<utilisateur>_<projet>, nom du projet mémorisé), purgées à la
 * création d'un projet ; valeurs hors limites rejetées à la restauration et à l'import.
 *
 * Météo : POST /api/pac/meteo (même série que la production solaire, en heure murale sur la grille
 * de 365 jours de la courbe IRVE). Messages à l'écran : jamais le nom d'un outil ni le lieu du calcul.
 *
 * Un seul comptage de la climatisation : quand ce module simule du froid, l'équipement
 * « Climatisation » du profil par équipements est exclu (cf. loadProfileBottomUp.js,
 * window.PacSection.climatisationGeree()).
 */
(function () {
    'use strict';

    const DOSSIER_SCRIPT = (function () {
        const src = document.currentScript && document.currentScript.src;
        return src ? src.slice(0, src.lastIndexOf('/') + 1) : '';
    })();
    const FICHIERS_DONNEES = { bat: 'batiment.json', emetteurs: 'emetteurs.json', ecs: 'ecs.json', equip: 'equipements.json', deps: 'departements.json', eco: 'rentabilite.json' };
    const VERSION_CONFIG = 1;
    // Plage « heures solaires » de la variante ECS (identique au choix « Heures solaires » de la plage).
    const PLAGE_ECS_SOLAIRE = { debut: 11, fin: 16 };
    const URL_PROJET = (projetId) => `/concevoir_mon_projet/parametre-projet/${encodeURIComponent(projetId)}`;
    const COULEURS_SITE = { existant: '#1E8449', irve: '#dc2626', pac: '#f59e0b' };
    const ORIENTATIONS = ['N', 'E', 'S', 'O'];
    const LIBELLES_ORIENT = { N: 'Nord', E: 'Est', S: 'Sud', O: 'Ouest' };
    const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    const MOIS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
    const COULEURS = { eChauffage: '#dc2626', eFroid: '#2563eb', eEcs: '#f59e0b', eAppoint: '#7c3aed', eAuxiliaires: '#64748b' };
    const LIBELLES_USAGES = { eChauffage: 'Chauffage (PAC)', eFroid: 'Climatisation', eEcs: 'ECS (PAC)', eAppoint: 'Appoint électrique', eAuxiliaires: 'Auxiliaires' };

    const C = window.PacModeleCop;
    const B = window.PacDimensionnement;
    const S = window.PacSimulation;
    const P = window.PacRentabilite;
    const SCH = window.PacSchema;
    const V = window.PacVerification;

    let ref = null;
    let chargementRef = null;
    let construit = false;
    let meteo = null;
    let meteoCle = '';
    let resultat = null;
    let calculEnCours = false;
    const graphs = {};

    const $ = (id) => document.getElementById(id);
    const val = (id) => { const el = $(id); return el ? el.value : ''; };
    const coche = (id) => { const el = $(id); return !!(el && el.checked); };
    const txt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const echapper = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function lireNombre(brut) {
        const s = String(brut == null ? '' : brut).trim().replace(',', '.');
        if (s === '') return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    }
    const nombre = (id) => lireNombre(val(id));
    function fr(n, dec) {
        if (n === null || n === undefined || !Number.isFinite(Number(n))) return '--';
        return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
    }
    function message(texte, type, duree) {
        if (typeof window.showMessage === 'function') window.showMessage(texte, type, duree || 4000);
        else if (type === 'error') console.error(texte);
    }

    // ---------------------------------------------------------------------------------------
    // Données de référence
    // ---------------------------------------------------------------------------------------
    function chargerReferences() {
        if (ref) return Promise.resolve(ref);
        if (!chargementRef) {
            const entrees = Object.entries(FICHIERS_DONNEES);
            chargementRef = Promise.all(entrees.map(([, f]) => fetch(DOSSIER_SCRIPT + 'donnees/' + f, { credentials: 'same-origin' })
                .then((r) => { if (!r.ok) throw new Error(f); return r.json(); })))
                .then((jsons) => {
                    ref = {};
                    entrees.forEach(([cle], i) => { ref[cle] = jsons[i]; });
                    return ref;
                })
                .catch((e) => { chargementRef = null; throw e; });
        }
        return chargementRef;
    }

    // ---------------------------------------------------------------------------------------
    // État de la configuration (pilote les champs affichés et les bornes)
    // ---------------------------------------------------------------------------------------
    function etat() {
        const type = val('pac_type') || 'air_eau';
        const typeRef = ref ? B.trouver(ref.equip.types, type) : null;
        const reversible = type === 'clim' ? false : coche('pac_reversible');
        const usage = ref ? B.trouver(ref.equip.usages, val('pac_usage')) : null;
        return {
            type,
            systeme: typeRef ? typeRef.systeme_emetteurs : 'air_eau',
            reversible,
            usages: usage ? { chauffage: usage.chauffage, froid: usage.froid, ecs: usage.ecs } : { chauffage: true, froid: false, ecs: false },
            split: val('pac_unite') === 'split',
            appoint: coche('pac_appoint') && type !== 'clim',
            mode: val('pac_mode') || 'dimensionnement',
            option: val('pac_option') || 'simplifiee',
            // Déduire le bâtiment de la puissance n'a de sens qu'en chauffage : en été l'écart
            // intérieur/extérieur est faible et la charge de froid vient surtout des apports.
            sourceBat: usage && usage.chauffage ? (val('pac_source_bat') || 'decrit') : 'decrit',
            plageEcs: val('pac_ecs_plage') || 'permanente',
        };
    }

    /** Usages compatibles avec le type et la réversibilité (cf. donnees/equipements.json). */
    function usagesCompatibles(type, reversible) {
        const typeRef = B.trouver(ref.equip.types, type);
        return ref.equip.usages.filter((u) => {
            if (type === 'clim') return u.froid && !u.chauffage && !u.ecs;
            if (u.ecs && !typeRef.ecs_possible) return false;
            if (u.froid && !reversible) return false;
            if (u.id === 'froid') return false; // PAC : la climatisation seule relève du climatiseur
            return true;
        });
    }

    const batimentDecrit = (s) => s.mode === 'dimensionnement' || s.sourceBat === 'decrit';
    const besoinChauffage = (s) => s.usages.chauffage;
    const besoinFroid = (s) => s.usages.froid;
    const avecEau = (s) => s.systeme === 'air_eau';
    const avecEspace = (s) => s.usages.chauffage || s.usages.froid;

    // Bornes de saisie : { id, min, max, defaut, libelle, unite, quand(état), facultatif }.
    const REGLES = [
        { id: 'pac_annee', min: 2020, max: 2050, defaut: 2024, libelle: 'Année de simulation', entier: true },
        { id: 'pac_nb_unites', min: 1, max: 12, defaut: 1, libelle: "Nombre d'unités intérieures", entier: true, quand: (s) => s.systeme === 'air_air' },
        { id: 'pac_dep_base', min: 25, max: 75, defaut: 35, libelle: 'Départ à la température de base', unite: '°C', quand: (s) => avecEau(s) && besoinChauffage(s) },
        { id: 'pac_dep_doux', min: 20, max: 60, defaut: 25, libelle: 'Départ à la température de non-chauffage', unite: '°C', quand: (s) => avecEau(s) && besoinChauffage(s) },
        { id: 'pac_t_non_chauffage', min: 10, max: 22, defaut: 18, libelle: 'Température extérieure de non-chauffage', unite: '°C', quand: (s) => avecEau(s) && besoinChauffage(s) },
        { id: 'pac_dep_froid', min: 5, max: 22, defaut: 18, libelle: "Départ d'eau en froid", unite: '°C', quand: (s) => avecEau(s) && besoinFroid(s) },
        { id: 'pac_liaison_long', min: 0, max: 100, defaut: 5, libelle: 'Longueur des liaisons', unite: 'm', quand: (s) => s.split },
        { id: 'pac_liaison_deniv', min: 0, max: 30, defaut: 0, libelle: 'Dénivelé', unite: 'm', quand: (s) => s.split },
        { id: 'pac_liaison_c90', min: 0, max: 30, defaut: 2, libelle: 'Coudes à 90°', entier: true, quand: (s) => s.split },
        { id: 'pac_liaison_c180', min: 0, max: 10, defaut: 0, libelle: 'Coudes à 180°', entier: true, quand: (s) => s.split },
        { id: 'pac_liaison_perte', min: 0, max: 30, facultatif: true, libelle: 'Perte de puissance des liaisons', unite: '%', quand: (s) => s.split },
        { id: 'pac_appoint_kw', min: 0.5, max: 18, defaut: 3, libelle: "Puissance de l'appoint", unite: 'kW', quand: (s) => s.appoint },
        { id: 'pac_t_biv', min: -20, max: 10, defaut: -3, libelle: 'Température de bivalence', unite: '°C', quand: (s) => s.appoint },
        { id: 'pac_altitude', min: -50, max: 3500, facultatif: true, libelle: 'Altitude du site', unite: 'm' },
        { id: 'pac_tbase_hiver', min: -35, max: 15, facultatif: true, libelle: 'Température de base hiver', unite: '°C', quand: (s) => besoinChauffage(s) || s.usages.ecs },
        { id: 'pac_tbase_ete', min: 20, max: 50, facultatif: true, libelle: 'Température de base été', unite: '°C', quand: besoinFroid },
        { id: 'pac_cons_ch', min: 16, max: 24, defaut: 20, libelle: 'Consigne de chauffage', unite: '°C', quand: besoinChauffage },
        { id: 'pac_cons_reduit', min: 10, max: 22, defaut: 17, libelle: 'Consigne réduite', unite: '°C', quand: besoinChauffage },
        { id: 'pac_reduit_debut', min: 0, max: 23, defaut: 22, libelle: 'Début du réduit', unite: 'h', entier: true, quand: besoinChauffage },
        { id: 'pac_reduit_fin', min: 0, max: 23, defaut: 6, libelle: 'Fin du réduit', unite: 'h', entier: true, quand: besoinChauffage },
        { id: 'pac_cons_froid', min: 20, max: 30, defaut: 26, libelle: 'Consigne de rafraîchissement', unite: '°C', quand: besoinFroid },
        { id: 'pac_abs_debut', min: 0, max: 23, defaut: 8, libelle: "Début de l'absence", unite: 'h', entier: true, quand: (s) => coche('pac_absence') },
        { id: 'pac_abs_fin', min: 0, max: 23, defaut: 18, libelle: "Fin de l'absence", unite: 'h', entier: true, quand: (s) => coche('pac_absence') },
        { id: 'pac_occupants', min: 0, max: 50, defaut: 3, libelle: "Nombre d'occupants", entier: true },
        { id: 'pac_surface', min: 10, max: 2000, defaut: 100, libelle: 'Surface chauffée', unite: 'm²', quand: (s) => !(batimentDecrit(s) && s.option === 'detaillee') && avecEspace(s) },
        { id: 'pac_hauteur', min: 2, max: 6, defaut: 2.5, libelle: 'Hauteur sous plafond', unite: 'm', quand: (s) => !(batimentDecrit(s) && s.option === 'detaillee') && avecEspace(s) },
        { id: 'pac_apports_wm2', min: 0, max: 20, defaut: 3, libelle: 'Apports internes des appareils', unite: 'W/m²', quand: avecEspace },
        { id: 'pac_g', min: 0.1, max: 4, facultatif: true, libelle: 'Coefficient G', unite: 'W/(m³·K)', quand: (s) => batimentDecrit(s) && s.option === 'simplifiee' && avecEspace(s) },
        { id: 'pac_vitrage_pct', min: 0, max: 60, defaut: 15, libelle: 'Surface vitrée (en % de la surface)', unite: '%', quand: (s) => !(batimentDecrit(s) && s.option === 'detaillee') && avecEspace(s) },
        { id: 'pac_g_fenetre', min: 0.2, max: 0.9, defaut: 0.6, libelle: 'Facteur solaire des vitrages', quand: avecEspace },
        { id: 'pac_u_mur', min: 0.08, max: 3, defaut: 0.36, libelle: 'U des murs', unite: 'W/(m²·K)', quand: (s) => batimentDecrit(s) && s.option === 'detaillee' && avecEspace(s) },
        { id: 'pac_u_toit', min: 0.08, max: 4, defaut: 0.2, libelle: 'U de la toiture', unite: 'W/(m²·K)', quand: (s) => batimentDecrit(s) && s.option === 'detaillee' && avecEspace(s) },
        { id: 'pac_u_sol', min: 0.08, max: 3, defaut: 0.27, libelle: 'U du plancher bas', unite: 'W/(m²·K)', quand: (s) => batimentDecrit(s) && s.option === 'detaillee' && avecEspace(s) },
        { id: 'pac_u_fen', min: 0.5, max: 6, defaut: 1.8, libelle: 'U des fenêtres', unite: 'W/(m²·K)', quand: (s) => batimentDecrit(s) && s.option === 'detaillee' && avecEspace(s) },
        { id: 'pac_pt', min: 0, max: 40, defaut: 20, libelle: 'Majoration ponts thermiques', unite: '%', quand: (s) => batimentDecrit(s) && s.option === 'detaillee' && avecEspace(s) },
        { id: 'pac_n50', min: 0.3, max: 20, defaut: 4, libelle: "Perméabilité à l'air n50", unite: 'vol/h', quand: (s) => batimentDecrit(s) && s.option === 'detaillee' && avecEspace(s) },
        { id: 'pac_vent_n', min: 0, max: 3, defaut: 0.35, libelle: 'Renouvellement par la ventilation', unite: 'vol/h', quand: (s) => batimentDecrit(s) && s.option === 'detaillee' && avecEspace(s) },
        { id: 'pac_vent_eta', min: 0, max: 0.95, defaut: 0, libelle: 'Rendement de récupération', quand: (s) => batimentDecrit(s) && s.option === 'detaillee' && avecEspace(s) },
        { id: 'pac_taux_dim', min: 50, max: 150, defaut: 100, libelle: 'Couverture du besoin à la température de base', unite: '%', quand: (s) => !batimentDecrit(s) && avecEspace(s) },
        { id: 'pac_ecs_litres', min: 10, max: 150, defaut: 50, libelle: 'Consommation par personne (à 40 °C)', unite: 'L/j', quand: (s) => s.usages.ecs },
        { id: 'pac_ecs_tusage', min: 35, max: 45, defaut: 40, libelle: "Température d'usage", unite: '°C', quand: (s) => s.usages.ecs },
        { id: 'pac_ecs_volume', min: 50, max: 1000, defaut: 200, libelle: 'Volume du ballon', unite: 'L', quand: (s) => s.usages.ecs },
        { id: 'pac_ecs_consigne', min: 45, max: 65, defaut: 55, libelle: 'Consigne du ballon', unite: '°C', quand: (s) => s.usages.ecs },
        { id: 'pac_ecs_hyst', min: 2, max: 15, defaut: 5, libelle: 'Écart de relance', unite: 'K', quand: (s) => s.usages.ecs },
        { id: 'pac_ecs_pertes', min: 0.2, max: 6, facultatif: true, libelle: 'Pertes du ballon (étiquette)', unite: 'kWh/24 h', quand: (s) => s.usages.ecs },
        { id: 'pac_ecs_tamb', min: 5, max: 25, defaut: 15, libelle: 'Température du local du ballon', unite: '°C', quand: (s) => s.usages.ecs },
        { id: 'pac_ecs_res', min: 0, max: 6, defaut: 1.5, libelle: 'Résistance du ballon', unite: 'kW', quand: (s) => s.usages.ecs },
        { id: 'pac_ecs_debut', min: 0, max: 23, defaut: 11, libelle: 'Début de la plage ECS', unite: 'h', entier: true, quand: (s) => s.usages.ecs && s.plageEcs === 'perso' },
        { id: 'pac_ecs_fin', min: 0, max: 23, defaut: 16, libelle: 'Fin de la plage ECS', unite: 'h', entier: true, quand: (s) => s.usages.ecs && s.plageEcs === 'perso' },
        { id: 'pac_al_heure', min: 0, max: 23, defaut: 14, libelle: 'Heure du cycle anti-légionelle', unite: 'h', entier: true, quand: (s) => s.usages.ecs && coche('pac_al_actif') },
        { id: 'pac_tmin_ch', min: -30, max: 10, defaut: -20, libelle: 'Température extérieure minimale (chaud)', unite: '°C', quand: (s) => s.type !== 'clim' },
        { id: 'pac_tmax_ch', min: 15, max: 45, defaut: 35, libelle: 'Température extérieure maximale (chaud)', unite: '°C', quand: (s) => s.type !== 'clim' },
        { id: 'pac_tdep_max', min: 35, max: 80, defaut: 60, libelle: "Température d'eau maximale", unite: '°C', quand: avecEau },
        { id: 'pac_tmin_fr', min: -15, max: 30, defaut: 10, libelle: 'Température extérieure minimale (froid)', unite: '°C', quand: besoinFroid },
        { id: 'pac_tmax_fr', min: 30, max: 55, defaut: 46, libelle: 'Température extérieure maximale (froid)', unite: '°C', quand: besoinFroid },
        { id: 'pac_scop', min: 1, max: 8, facultatif: true, libelle: 'SCOP (fiche technique)', quand: (s) => s.type !== 'clim' },
        { id: 'pac_seer', min: 1, max: 15, facultatif: true, libelle: 'SEER (fiche technique)', quand: besoinFroid },
        { id: 'pac_p_abs', min: 0.1, max: 60, facultatif: true, libelle: 'Puissance électrique absorbée nominale', unite: 'kW' },
        { id: 'pac_i_nom', min: 0.5, max: 150, facultatif: true, libelle: 'Intensité nominale', unite: 'A' },
        { id: 'pac_i_dem', min: 0.5, max: 300, facultatif: true, libelle: 'Intensité de démarrage', unite: 'A' },
        { id: 'pac_mod_min', min: 5, max: 100, defaut: 30, libelle: 'Taux de modulation minimal', unite: '%' },
        { id: 'pac_cd', min: 0.5, max: 1, defaut: 0.9, libelle: 'Coefficient de dégradation au cyclage' },
        { id: 'pac_aux_circ', min: 0, max: 300, defaut: 40, libelle: 'Circulateur', unite: 'W', quand: avecEau },
        { id: 'pac_aux_veille', min: 0, max: 100, defaut: 12, libelle: 'Veille', unite: 'W' },
        { id: 'pac_aux_carter', min: 0, max: 150, defaut: 30, libelle: 'Résistance de carter', unite: 'W' },
        { id: 'pac_aux_carter_seuil', min: -10, max: 20, defaut: 10, libelle: 'Seuil de la résistance de carter', unite: '°C' },
        { id: 'pac_aux_vent', min: 0, max: 200, defaut: 25, libelle: 'Ventilateur par unité intérieure', unite: 'W', quand: (s) => s.systeme === 'air_air' },
    ];
    const REGLE = Object.fromEntries(REGLES.map((r) => [r.id, r]));
    const BORNES_POINTS = {
        chaud: { a: [-30, 45], w_eau: [20, 80], w_air: [15, 30], p_kw: [0.3, 200], r: [1, 10] },
        froid: { a: [15, 55], w_eau: [4, 30], w_air: [18, 35], p_kw: [0.3, 200], r: [1, 12] },
    };
    const BORNES_PIECE = { surface: [1, 500], hauteur: [2, 8], longueur: [0, 60], vitrage: [0, 90] };

    // Étude de rentabilité (phase 3) : même format que REGLES ; `def()` = valeur par défaut tirée de
    // donnees/rentabilite.json, `quand(e)` reçoit etatEco().
    const PLAGES_TARIF = { C5_BASE: ['BASE'], C5_HPHC: ['HP', 'HC'] };
    const LIB_PLAGES = { BASE: 'Base (tarif unique)', HP: 'Heures pleines', HC: 'Heures creuses' };
    const hyp = (cle) => () => ref.eco.hypotheses_financieres[cle];
    const REGLES_ECO = [
        { id: 'pacr_ref_rdt', min: 0.5, max: 1.1, libelle: 'Rendement saisonnier de la génération (PCI)', def: () => systemeReference().rendement, quand: (e) => e.s.usages.chauffage },
        { id: 'pacr_ref_ecs_rdt', min: 0.3, max: 1.1, libelle: "Rendement de production d'ECS", def: () => B.trouver(ref.eco.systemes_ecs, 'chaudiere').rendement, quand: (e) => e.ecsChaudiere },
        { id: 'pacr_ref_seer', min: 1.5, max: 10, libelle: 'SEER du climatiseur existant', def: () => ref.eco.froid_reference.seer_defaut, quand: (e) => e.froid === 'clim' },
        ...['BASE', 'HP', 'HC'].map((k) => ({ id: `pacr_prix_${k}`, min: 0.01, max: 1.5, libelle: `Électricité – ${LIB_PLAGES[k]}`, unite: '€/kWh', def: () => ref.eco.prix_defaut.elec[k], quand: (e) => PLAGES_TARIF[e.tarif].includes(k) })),
        { id: 'pacr_prix_gaz', min: 0.01, max: 0.6, libelle: 'Prix du gaz (kWh PCS facturé)', unite: '€/kWh', def: () => ref.eco.prix_defaut.gaz_eur_kwh_pcs, quand: (e) => e.gaz },
        { id: 'pacr_abo_gaz', min: 0, max: 3000, libelle: 'Abonnement gaz supprimé', unite: '€/an', def: () => ref.eco.prix_defaut.abonnement_gaz_eur_an, quand: (e) => e.gaz && coche('pacr_resil_gaz') },
        { id: 'pacr_prix_fioul', min: 0.3, max: 4, libelle: 'Prix du fioul', unite: '€/L', def: () => ref.eco.prix_defaut.fioul_eur_litre, quand: (e) => e.fioul },
        { id: 'pacr_surcout_abo', min: 0, max: 5000, libelle: "Supplément d'abonnement électrique", unite: '€/an', def: () => 0 },
        { id: 'pacr_prix_surplus', min: 0, max: 1, libelle: 'Prix de vente du surplus PV (0 s\'il n\'est pas vendu)', unite: '€/kWh', def: () => 0, quand: (e) => e.pv },
        { id: 'pacr_capex_materiel', min: 0, max: 1000000, libelle: 'Équipement posé (PAC, ballon, mise en service)', unite: '€', def: () => P.investissementDefaut(val('pac_type'), nombre('pac_nb_unites'), ref.eco) },
        { id: 'pacr_capex_travaux', min: 0, max: 1000000, libelle: 'Travaux annexes (émetteurs, électricité, dépose)', unite: '€', def: () => 0 },
        { id: 'pacr_aides', min: 0, max: 1000000, libelle: 'Aides et primes', unite: '€', def: () => 0 },
        { id: 'pacr_cout_evite', min: 0, max: 1000000, libelle: 'Remplacement évité du système existant', unite: '€', def: () => 0 },
        { id: 'pacr_entretien_pac', min: 0, max: 5000, libelle: 'Entretien de la PAC', unite: '€/an', def: () => ref.eco.investissement_defaut.entretien_pac_eur_an },
        { id: 'pacr_entretien_ref', min: 0, max: 5000, libelle: 'Entretien du système de référence', unite: '€/an', def: () => systemeReference().entretien_eur_an, quand: (e) => e.chaleur },
        { id: 'pacr_horizon', min: 5, max: 30, entier: true, libelle: "Durée de l'étude", unite: 'ans', def: hyp('horizon_ans') },
        { id: 'pacr_duree_vie', min: 5, max: 30, entier: true, libelle: 'Durée de vie de la PAC', unite: 'ans', def: hyp('duree_vie_pac_ans') },
        { id: 'pacr_remplacement', min: 0, max: 150, libelle: "Coût de remplacement (en % de l'équipement)", unite: '%', def: hyp('remplacement_pct') },
        { id: 'pacr_evol_elec', min: -5, max: 15, libelle: "Évolution du prix de l'électricité", unite: '%/an', def: hyp('evol_elec_pct') },
        { id: 'pacr_evol_gaz', min: -5, max: 15, libelle: 'Évolution du prix du gaz', unite: '%/an', def: hyp('evol_gaz_pct'), quand: (e) => e.gaz },
        { id: 'pacr_evol_fioul', min: -5, max: 15, libelle: 'Évolution du prix du fioul', unite: '%/an', def: hyp('evol_fioul_pct'), quand: (e) => e.fioul },
        { id: 'pacr_inflation', min: 0, max: 10, libelle: 'Inflation des charges', unite: '%/an', def: hyp('inflation_pct') },
        { id: 'pacr_actualisation', min: 0, max: 15, libelle: "Taux d'actualisation", unite: '%', def: hyp('actualisation_pct') },
        { id: 'pacr_degradation', min: 0, max: 2, libelle: 'Dégradation annuelle de la production PV', unite: '%', def: hyp('degradation_pv_pct'), quand: (e) => e.pv },
    ];
    const REGLE_ECO = Object.fromEntries(REGLES_ECO.map((r) => [r.id, r]));

    // ---------------------------------------------------------------------------------------
    // Balisage
    // ---------------------------------------------------------------------------------------
    const STYLE_AIDE = 'color: var(--text-secondary); font-size: 0.78rem; margin-top: 0.25rem; line-height: 1.3;';
    const STYLE_SOUS_TITRE = 'margin-top: 1.25rem; margin-bottom: 0.75rem; text-align: left; border-bottom: 1px dashed var(--border-color); padding-bottom: 0.5rem; font-size: 1rem; font-weight: 600;';
    const STYLE_BANDEAU = 'display:none; background:#fef2f2; color:#991b1b; border:1px solid #fecaca; border-radius:6px; padding:10px 14px; margin:0.75rem 0 0; font-size:0.85rem; font-weight:500;';
    const STYLE_INFO = 'background:#eff6ff; color:#1e3a8a; border:1px solid #bfdbfe; border-radius:6px; padding:10px 14px; margin:0.75rem 0; font-size:0.82rem; line-height:1.4;';

    function plage(r) {
        const d = (x) => fr(x, Math.abs(x % 1) > 0 ? 2 : 0);
        return `Plage : ${d(r.min)} – ${d(r.max)}${r.unite ? ' ' + r.unite : ''}${r.facultatif ? ' (facultatif)' : ''}.`;
    }

    function champ(id, aide, step) {
        const r = REGLE[id] || REGLE_ECO[id];
        return `<div class="input-group" data-pac-champ="${id}">
            <label for="${id}">${r.libelle}${r.unite ? ` (${r.unite})` : ''}</label>
            <input type="number" id="${id}" class="modern-input" value="${r.defaut === undefined ? '' : r.defaut}"
                min="${r.min}" max="${r.max}" step="${step || (r.entier ? '1' : 'any')}">
            <small style="${STYLE_AIDE}">${aide ? aide + ' ' : ''}${plage(r)}</small>
        </div>`;
    }

    function selecteur(id, libelle, options, aide) {
        return `<div class="input-group" data-pac-champ="${id}">
            <label for="${id}">${libelle}</label>
            <select id="${id}" class="modern-input">${options.map((o) => `<option value="${echapper(o[0])}">${echapper(o[1])}</option>`).join('')}</select>
            ${aide ? `<small style="${STYLE_AIDE}">${aide}</small>` : ''}
        </div>`;
    }

    function caseACocher(id, libelle, cochee, aide) {
        return `<div class="input-group" data-pac-champ="${id}">
            <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
                <input type="checkbox" id="${id}" ${cochee ? 'checked' : ''}> ${libelle}</label>
            ${aide ? `<small style="${STYLE_AIDE}">${aide}</small>` : ''}
        </div>`;
    }

    function texte(id, libelle, aide) {
        return `<div class="input-group" data-pac-champ="${id}">
            <label for="${id}">${libelle}</label>
            <input type="text" id="${id}" class="modern-input" maxlength="80">
            ${aide ? `<small style="${STYLE_AIDE}">${aide}</small>` : ''}
        </div>`;
    }

    const grille = (contenu) => `<div class="pac-grille">${contenu}</div>`;
    // Peu de champs aux libellés longs : les colonnes se partagent toute la largeur.
    const grilleLarge = (contenu) => `<div class="pac-grille" style="grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));">${contenu}</div>`;
    const bloc = (id, titre, contenu) => `<div id="${id}"><h4 style="${STYLE_SOUS_TITRE}">${titre}</h4>${contenu}</div>`;

    function balisage() {
        const optsTypes = ref.equip.types.map((t) => [t.id, t.libelle]);
        const optsDeps = [['', '— Choisir —']].concat(ref.deps.departements.map((d) => [d.code, `${d.code} – ${d.nom}`]));
        const optsNiveaux = ref.bat.niveaux_isolation.map((n) => [n.id, n.libelle]);
        const optsVent = ref.bat.ventilations.map((v) => [v.id, v.libelle]);
        const optsInertie = ref.bat.inerties.classes.map((c) => [c.id, c.libelle]);
        const optsProfils = Object.entries(ref.ecs.profils_puisage).filter(([k]) => k !== '_source').map(([k, p]) => [k, p.libelle]);
        return `
        <style>
            #pac-section-content { container-type: inline-size; }
            /* Au plus 3 champs par ligne : chaque colonne fait au moins le tiers de la largeur disponible. */
            .pac-grille { display:grid; grid-template-columns:repeat(auto-fill, minmax(max(170px, calc((100% - 2rem) / 3)), 1fr)); gap:0.75rem 1rem; }
            .pac-table { width:100%; border-collapse:collapse; font-size:0.82rem; background:#fff; }
            .pac-table th { background:#1f2937; color:#fff; font-weight:600; padding:0.45rem 0.5rem; text-align:center; }
            .pac-table td { padding:0.35rem 0.45rem; border-bottom:1px solid #e2e8f0; text-align:center; }
            .pac-table td input, .pac-table td select { width:100%; min-width:4.2rem; padding:0.3rem; font-size:0.82rem; }
            .pac-table tr:nth-child(even) td { background:#f8fafc; }
            .pac-table td:first-child { text-align:left; }
            .pac-stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:0.75rem; margin:0.75rem 0; }
            .pac-stat { background:#f3f4f6; border:1px solid var(--border-color); border-radius:var(--border-radius-md); padding:0.9rem; text-align:center; }
            .pac-stat-label { font-size:0.82rem; color:var(--text-secondary); font-weight:600; margin-bottom:0.35rem; }
            .pac-stat-valeur { font-size:1.4rem; font-weight:700; color:var(--accent-primary); }
            .pac-graph { position:relative; height:320px; width:100%; }
            .pac-boutons { display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:0.75rem; }
            .pac-boutons .btn-base { text-transform:none; }
            .pac-alerte { background:#fffbeb; color:#92400e; border:1px solid #fde68a; border-radius:6px; padding:8px 12px; margin:0.5rem 0; font-size:0.82rem; }
            /* Mise en page */
            .pac-entete { display:flex; align-items:center; flex-wrap:wrap; gap:0.5rem 1rem; margin-bottom:0.5rem; }
            .pac-entete h2 { margin:0; font-size:1.5rem; font-weight:700; color:var(--accent-primary); }
            .pac-entete-badge { flex:1; text-align:center; }
            .pac-entete-badge span { display:inline-block; background:#fffbeb; color:#92400e; border:1px solid #fcd34d; border-radius:999px; padding:0.25rem 0.9rem; font-size:0.82rem; font-weight:600; }
            #pac-section-content .energy-card { padding:1rem; margin-bottom:0; }
            #pac-section-content .energy-card > h3 { margin:0 0 0.75rem 0; font-size:1.1rem; color:#c0392b; border-bottom:2px solid #c0392b; padding-bottom:0.4rem; }
            .pac-sep { border:0; border-top:1px solid var(--border-color); margin:1.25rem 0; }
            .pac-haut { display:grid; grid-template-columns:1fr 1fr; gap:1rem; align-items:stretch; }
            .pac-colonne { display:flex; flex-direction:column; gap:1rem; }
            .pac-colonne > .energy-card:last-child { flex:1; }
            .pac-table td.pac-pt-libelle { white-space:nowrap; }
            .pac-boutons + .pac-grille { margin-top:0.75rem; }
            /* Deux parties côte à côte, séparées par un trait vertical en pointillés. */
            .pac-parties { display:grid; grid-template-columns:1fr 1fr; gap:0 1.5rem; }
            .pac-parties > .pac-partie + .pac-partie { border-left:2px dashed var(--border-color); padding-left:1.5rem; }
            .pac-parties:has(> .pac-partie[style*="none"]) { grid-template-columns:1fr; }
            .pac-parties:has(> .pac-partie[style*="none"]) > .pac-partie { border-left:0; padding-left:0; }
            .pac-partie > h4:first-child { margin-top:0 !important; }
            @container (max-width: 860px) {
                .pac-haut, .pac-parties { grid-template-columns:1fr; }
                .pac-parties > .pac-partie + .pac-partie { border-left:0; padding-left:0; border-top:2px dashed var(--border-color); margin-top:1rem; padding-top:0.5rem; }
            }
        </style>

        <div class="pac-entete">
            <h2>PAC / Climatiseur</h2>
            <div class="pac-entete-badge"><span>Module expérimental – résultats à titre indicatif</span></div>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0; margin-bottom: 1rem; line-height: 1.4;">
            Dimensionnement d'une pompe à chaleur ou d'un climatiseur et simulation de sa consommation électrique
            sur une année, au pas de la courbe de charge. Les saisies sont conservées dans ce navigateur pour ce
            projet, mais pas encore enregistrées avec le projet : utilisez « Exporter la configuration » pour les
            transmettre.</p>
        <p id="pac_stockage_statut" style="${STYLE_AIDE} margin-top:-0.5rem; margin-bottom:0.75rem;"></p>
        <div id="pac_alerte_clim" class="pac-alerte" style="display:none;"></div>

        <div class="pac-haut">
            <div class="pac-colonne">
                <div class="energy-card">
                    <h3>1. Localisation, climat et consignes</h3>
                    <p style="margin:0 0 0.5rem; font-size:0.85rem;"><strong style="color:var(--text-secondary);">Site :</strong> <span id="pac_site">--</span></p>
                    ${grille(
                        selecteur('pac_departement', 'Département', optsDeps, 'Proposé d\'après l\'adresse du projet. Hors de France, laissez vide.')
                        + `<div class="input-group"><label>Zone climatique</label><div id="pac_zone" style="padding:0.5rem 0; font-weight:600;">--</div><small style="${STYLE_AIDE}">Indicative.</small></div>`
                        + champ('pac_altitude', 'Reprise de l\'adresse du projet ; modifiable. Vide : altitude de la donnée météo.')
                        + selecteur('pac_pas', 'Pas de temps de la simulation', [['10', '10 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '60 minutes']], 'Même pas que la courbe de charge.')
                        + champ('pac_annee', 'Calendrier (jours de semaine, changement d\'heure).'))}
                    <p id="pac_altitude_source" style="${STYLE_AIDE}"></p>
                    <div class="pac-boutons"><button type="button" id="pac_btn_meteo" class="btn-base btn-secondary">Charger la météo du site</button>
                        <span id="pac_meteo_statut" style="font-size:0.82rem; color:var(--text-secondary); align-self:center;"></span></div>
                    <h4 style="${STYLE_SOUS_TITRE}">Températures de base</h4>
                    ${grille(champ('pac_tbase_hiver', 'Calculée depuis la météo du site, corrigée de l\'altitude ; modifiable.')
                        + champ('pac_tbase_ete', 'Calculée depuis la météo du site ; modifiable.'))}
                    <p id="pac_tbase_detail" style="${STYLE_AIDE}"></p>
                </div>
                <div class="energy-card">
                    <h3>2. Mode de dimensionnement et méthode de calcul</h3>
                    ${grilleLarge(
                        selecteur('pac_mode', 'Mode', [['dimensionnement', 'Dimensionnement : calculer les puissances nécessaires'], ['connue', 'Puissance connue : simuler l\'équipement saisi']])
                        + selecteur('pac_source_bat', 'Bâtiment', [['decrit', 'Décrire le bâtiment'], ['deduit', 'Déduire de la puissance de l\'équipement']],
                            'Sans description, le bâtiment est supposé dimensionné pour l\'équipement à la température de base.')
                        + selecteur('pac_option', 'Méthode de calcul', [['simplifiee', 'Simplifiée (rapide)'], ['detaillee', 'Détaillée (par pièce)']],
                            'Simplifiée : coefficient G, surface vitrée et inertie. Détaillée : parois, vitrages orientés et ventilation pièce par pièce. Même modèle dynamique dans les deux cas.'))}
                </div>
            </div>

            <div class="energy-card">
                <h3>3. Configuration du système</h3>
                ${grille(
                    selecteur('pac_type', "Type d'équipement", optsTypes)
                    + caseACocher('pac_reversible', 'PAC réversible (produit aussi du froid)', false)
                    + selecteur('pac_usage', 'Usages', [])
                    + selecteur('pac_unite', 'Unité', [['split', 'Split (unité extérieure + unité intérieure)'], ['monobloc', 'Monobloc']])
                    + selecteur('pac_alim', 'Alimentation', [['mono', 'Monophasée (230 V)'], ['tri', 'Triphasée (400 V)']])
                    + champ('pac_nb_unites'))}
                ${bloc('pac_bloc_emetteurs', 'Émetteurs', grille(
                    selecteur('pac_emetteur_chaud', 'Émetteur de chaleur', [])
                    + selecteur('pac_emetteur_froid', 'Émetteur de froid', [])
                    + champ('pac_dep_base', 'Le COP en dépend directement.')
                    + champ('pac_dep_doux', 'Loi d\'eau : départ linéaire entre ces deux points.')
                    + champ('pac_t_non_chauffage')
                    + champ('pac_dep_froid', 'Au-dessus du point de rosée pour un plancher ou un plafond.')))}
                ${bloc('pac_bloc_liaisons', 'Liaisons frigorifiques (split)', grille(
                    champ('pac_liaison_long') + champ('pac_liaison_deniv') + champ('pac_liaison_c90') + champ('pac_liaison_c180')
                    + selecteur('pac_liaison_diam', 'Diamètres (liquide / gaz)', [['1/4-3/8', '1/4" – 3/8"'], ['1/4-1/2', '1/4" – 1/2"'], ['3/8-5/8', '3/8" – 5/8"'], ['1/2-3/4', '1/2" – 3/4"']], 'Information reportée dans les exports.')
                    + champ('pac_liaison_perte', 'Valeur du constructeur. Vide : estimation affichée ci-dessous.')))}
                <p id="pac_liaison_estimation" style="${STYLE_AIDE}"></p>
                ${bloc('pac_bloc_appoint', 'Appoint', grille(
                    caseACocher('pac_appoint', 'Appoint électrique intégré', true, "Se déclenche sous la température de bivalence, ou quand la PAC est hors de sa plage de fonctionnement.")
                    + champ('pac_appoint_kw') + champ('pac_t_biv')))}
                <h4 style="${STYLE_SOUS_TITRE}">Schéma de principe</h4>
                <div class="pac-boutons" style="margin-top:0;">
                    <button type="button" id="pac_btn_schema_afficher" class="btn-base btn-secondary" aria-expanded="false" aria-controls="pac_schema_zone">Afficher le schéma de principe</button>
                    <button type="button" id="pac_btn_schema" class="btn-base btn-secondary">Télécharger le schéma (SVG)</button>
                </div>
                <div id="pac_schema_zone" style="display:none; margin-top:0.75rem;">
                    <div id="pac_schema" style="overflow-x:auto; border:1px solid var(--border-color); border-radius:6px; background:#fff;"></div>
                    <p style="${STYLE_AIDE}">Schéma de principe d'après la configuration saisie : ni implantation, ni cotes, ni organes de sécurité.</p>
                </div>
            </div>
        </div>

        <hr class="pac-sep">

        <div class="energy-card">
            <h3>4. Bâtiment et besoins</h3>
            <div class="pac-parties">
                <div class="pac-partie" id="pac_bloc_batiment">
                    <h4 style="${STYLE_SOUS_TITRE}">Bâtiment</h4>
                    ${grille(
                        selecteur('pac_niveau', "Niveau d'isolation", optsNiveaux, 'Préremplit G, les coefficients U et la ventilation.')
                        + selecteur('pac_ventilation', 'Ventilation', optsVent)
                        + selecteur('pac_inertie', 'Inertie du bâtiment', optsInertie, 'Indispensable aux pas de 10 à 30 minutes (relance après le réduit).')
                        + champ('pac_surface') + champ('pac_hauteur') + champ('pac_g', 'Vide : calculé d\'après le niveau d\'isolation et la ventilation.')
                        + champ('pac_vitrage_pct') + champ('pac_g_fenetre') + champ('pac_apports_wm2') + champ('pac_taux_dim', '100 % : l\'équipement couvre exactement le besoin à la température de base.'))}
                    <p id="pac_g_detail" style="${STYLE_AIDE}"></p>
                </div>
                <div class="pac-partie" id="pac_bloc_consignes">
                    <h4 style="${STYLE_SOUS_TITRE}">Consignes et occupation</h4>
                    ${grille(
                        champ('pac_cons_ch') + champ('pac_cons_reduit') + champ('pac_cons_froid')
                        + champ('pac_reduit_debut') + champ('pac_reduit_fin') + champ('pac_occupants')
                        + caseACocher('pac_absence', 'Logement inoccupé en journée en semaine', false)
                        + champ('pac_abs_debut') + champ('pac_abs_fin')
                        + caseACocher('pac_reduit_absence', 'Chauffage réduit pendant l\'absence', true)
                        + caseACocher('pac_froid_presence', 'Climatisation seulement en présence', true))}
                </div>
            </div>
            <div id="pac_bloc_detaille">
                <h4 style="${STYLE_SOUS_TITRE}">Enveloppe et ventilation (méthode détaillée)</h4>
                ${grille(champ('pac_u_mur') + champ('pac_u_toit') + champ('pac_u_sol') + champ('pac_u_fen') + champ('pac_pt')
                    + champ('pac_n50', 'Infiltrations prises égales à n50 / 20.') + champ('pac_vent_n') + champ('pac_vent_eta'))}
                <h4 style="${STYLE_SOUS_TITRE}">Pièces</h4>
                <div style="overflow-x:auto;"><table class="pac-table"><thead><tr>
                    <th>Pièce</th><th>Surface (m²)</th><th>HSP (m)</th><th>Façade 1</th><th>Longueur (m)</th><th>Façade 2</th><th>Longueur (m)</th>
                    <th>Vitrage (% façade)</th><th>Sous toiture</th><th>Sur sol</th><th></th></tr></thead>
                    <tbody id="pac_pieces"></tbody></table></div>
                <div class="pac-boutons"><button type="button" id="pac_btn_piece" class="btn-base btn-secondary">Ajouter une pièce</button></div>
            </div>
            <div id="pac_bloc_ecs">
                <h4 style="${STYLE_SOUS_TITRE}">Eau chaude sanitaire</h4>
                <div class="pac-parties">
                    <div class="pac-partie">
                        ${grille(champ('pac_ecs_litres') + champ('pac_ecs_tusage') + champ('pac_ecs_volume')
                            + champ('pac_ecs_consigne') + champ('pac_ecs_hyst') + champ('pac_ecs_pertes', 'Vide : valeur usuelle selon le volume.')
                            + champ('pac_ecs_tamb') + champ('pac_ecs_res', 'Assure la part au-delà de la température maximale de la PAC (anti-légionelle).'))}
                    </div>
                    <div class="pac-partie">
                        ${grille(selecteur('pac_ecs_profil', 'Profil de puisage', optsProfils)
                            + selecteur('pac_ecs_plage', 'Plage de production', [['permanente', 'Permanente'], ['nuit', 'Nuit (22 h – 6 h)'], ['solaire', 'Heures solaires (11 h – 16 h)'], ['perso', 'Personnalisée']])
                            + champ('pac_ecs_debut') + champ('pac_ecs_fin')
                            + caseACocher('pac_ecs_priorite', 'Priorité ECS (le chauffage s\'interrompt pendant la production)', true)
                            + caseACocher('pac_ecs_gain', 'Mesurer le gain d\'une production d\'ECS aux heures solaires (11 h – 16 h)', true,
                                "Une variante est simulée et transmise avec la courbe ; l'autoconsommation compare les deux avec la même production.")
                            + caseACocher('pac_al_actif', 'Cycle anti-légionelle hebdomadaire (60 °C)', true)
                            + selecteur('pac_al_jour', 'Jour du cycle', JOURS.map((j, i) => [String(i), j]))
                            + champ('pac_al_heure'))}
                    </div>
                </div>
                <p id="pac_ecs_detail" style="${STYLE_AIDE}"></p>
            </div>
        </div>

        <hr class="pac-sep">

        <div class="energy-card">
            <h3>5. Caractéristiques de l'équipement</h3>
            <p style="${STYLE_AIDE}">Reportez les valeurs de la fiche technique. A = air extérieur (°C) ; W = départ d'eau (°C) ou, en air-air, air intérieur.
                Les valeurs proposées sont génériques : remplacez-les.</p>
            <div class="pac-parties">
                <div class="pac-partie">
                    <div id="pac_bloc_chaud">
                        <h4 style="${STYLE_SOUS_TITRE}">Performances en chauffage</h4>
                        <div style="overflow-x:auto;"><table class="pac-table"><thead><tr><th>Point</th><th>A (°C)</th><th id="pac_th_w_chaud">W (°C)</th><th>Puissance calorifique (kW)</th><th>COP</th><th></th></tr></thead>
                            <tbody id="pac_points_chaud"></tbody></table></div>
                        <div class="pac-boutons"><button type="button" class="btn-base btn-secondary" data-pac-ajout-point="chaud">Ajouter un point</button></div>
                        ${grille(champ('pac_scop', 'Comparé au SCOP simulé.') + champ('pac_tmin_ch') + champ('pac_tmax_ch') + champ('pac_tdep_max')
                            + caseACocher('pac_degivrage_inclus', 'Les performances saisies incluent le dégivrage', true, 'Cas des mesures normalisées à +2 °C. Sinon une perte de dégivrage est appliquée entre −7 et +7 °C.'))}
                    </div>
                    <div id="pac_bloc_froid">
                        <h4 style="${STYLE_SOUS_TITRE}">Performances en froid</h4>
                        <div style="overflow-x:auto;"><table class="pac-table"><thead><tr><th>Point</th><th>A (°C)</th><th id="pac_th_w_froid">W (°C)</th><th>Puissance frigorifique (kW)</th><th>EER</th><th></th></tr></thead>
                            <tbody id="pac_points_froid"></tbody></table></div>
                        <div class="pac-boutons"><button type="button" class="btn-base btn-secondary" data-pac-ajout-point="froid">Ajouter un point</button></div>
                        ${grille(champ('pac_seer') + champ('pac_tmin_fr') + champ('pac_tmax_fr'))}
                    </div>
                </div>
                <div class="pac-partie">
                    <h4 style="${STYLE_SOUS_TITRE}">Identification</h4>
                    ${grille(texte('pac_reference', 'Référence') + texte('pac_marque', 'Marque') + texte('pac_modele', 'Modèle'))}
                    <h4 style="${STYLE_SOUS_TITRE}">Électrique et régulation</h4>
                    ${grille(champ('pac_p_abs') + champ('pac_i_nom') + champ('pac_i_dem', 'Utile en monophasé.')
                        + champ('pac_mod_min', 'Sous ce taux, le compresseur fonctionne par cycles marche/arrêt.') + champ('pac_cd'))}
                    <h4 style="${STYLE_SOUS_TITRE}">Auxiliaires</h4>
                    ${grille(champ('pac_aux_circ', 'En marche quand le chauffage, le froid ou l\'ECS fonctionnent.') + champ('pac_aux_veille')
                        + champ('pac_aux_carter', 'Compresseur à l\'arrêt, sous le seuil ci-contre.') + champ('pac_aux_carter_seuil') + champ('pac_aux_vent')
                        + caseACocher('pac_aux_hors_saison', 'Mise hors tension les mois sans usage', true, "Veille et résistance de carter ne sont alors comptées que les mois où l'équipement sert."))}
                </div>
            </div>
            <div class="pac-boutons">
                <button type="button" id="pac_btn_generique" class="btn-base btn-secondary">Valeurs génériques</button>
                <button type="button" id="pac_btn_export_config" class="btn-base btn-secondary">Exporter la configuration</button>
                <button type="button" id="pac_btn_import_config" class="btn-base btn-secondary">Importer une configuration</button>
                <input type="file" id="pac_fichier_config" accept=".json,application/json" style="display:none;">
            </div>
            ${grille(caseACocher('pac_ajuster', 'Ajuster les puissances à la gamme recommandée avant la simulation', true,
                'Mode dimensionnement : les puissances des points sont mises à l\'échelle, COP et EER conservés.'))}
        </div>

        <hr class="pac-sep">

        <div id="pac_validation" style="${STYLE_BANDEAU}"></div>
        <div class="pac-boutons" style="margin-bottom:1rem;">
            <button type="button" id="pac_btn_calculer" class="btn-base btn-primary">Calculer</button>
            <span id="pac_calcul_statut" style="font-size:0.85rem; color:var(--text-secondary); align-self:center;"></span>
            <span id="pac_verif_statut" style="font-size:0.85rem; align-self:center;"></span>
        </div>

        <div id="pac_resultats" style="display:none;">
            <div class="energy-card" style="padding:1rem; margin-bottom:1rem;">
                <h3 style="margin:0 0 0.5rem 0; font-size:1.1rem;">Dimensionnement</h3>
                <div style="overflow-x:auto;"><table class="pac-table"><thead><tr><th>Grandeur</th><th>Valeur</th><th>Détail</th></tr></thead><tbody id="pac_dim_table"></tbody></table></div>
                <div id="pac_pieces_resultat"></div>
                <div id="pac_dim_alertes"></div>
            </div>
            <div class="energy-card" style="padding:1rem; margin-bottom:1rem;">
                <h3 style="margin:0 0 0.5rem 0; font-size:1.1rem;">Consommation électrique simulée</h3>
                <div class="pac-stats" id="pac_tuiles"></div>
                <div style="overflow-x:auto;"><table class="pac-table"><thead><tr><th>Usage</th><th>Énergie (kWh/an)</th><th>Part</th></tr></thead><tbody id="pac_annuel_table"></tbody></table></div>
                <h4 style="${STYLE_SOUS_TITRE}">Par mois</h4>
                <div class="pac-graph"><canvas id="pac_graph_mensuel"></canvas></div>
                <h4 style="${STYLE_SOUS_TITRE}">Journée</h4>
                <div class="pac-boutons" style="margin-top:0;">
                    <input type="date" id="pac_jour" class="modern-input" style="max-width:12rem;">
                    <button type="button" id="pac_btn_jour_froid" class="btn-base btn-secondary">Jour le plus froid</button>
                    <button type="button" id="pac_btn_jour_chaud" class="btn-base btn-secondary">Jour le plus chaud</button>
                    <span id="pac_jour_total" style="font-size:0.85rem; align-self:center;"></span>
                </div>
                <div class="pac-graph" style="height:340px;"><canvas id="pac_graph_jour"></canvas></div>
                <h4 style="${STYLE_SOUS_TITRE}">Exporter la courbe simulée</h4>
                <div class="pac-boutons" style="margin-top:0;">
                    <button type="button" class="btn-base btn-secondary" data-pac-export="10">10 min</button>
                    <button type="button" class="btn-base btn-secondary" data-pac-export="15">15 min</button>
                    <button type="button" class="btn-base btn-secondary" data-pac-export="30">30 min</button>
                    <button type="button" class="btn-base btn-secondary" data-pac-export="60">60 min</button>
                </div>
                <p style="${STYLE_AIDE}">Heure murale, 365 jours (29 février retiré), puissances moyennes sur le pas — même grille que la courbe des bornes de recharge.</p>
            </div>
            <div class="energy-card" style="padding:1rem; margin-bottom:1rem;">
                <h3 style="margin:0 0 0.5rem 0; font-size:1.1rem;">Courbe de charge du site</h3>
                <p id="pac_site_source" style="${STYLE_AIDE}"></p>
                <div class="pac-stats" id="pac_site_tuiles"></div>
                <div class="pac-graph" style="height:340px;"><canvas id="pac_graph_site"></canvas></div>
                <p style="${STYLE_AIDE}">Journée choisie ci-dessus. Consommation existante et recharge IRVE : courbe enregistrée par la section « Borne de recharge ».</p>
                <div class="pac-boutons">
                    <button type="button" class="btn-base btn-secondary" data-pac-export-site="60">Exporter existant + IRVE + PAC (60 min)</button>
                    <button type="button" class="btn-base btn-secondary" data-pac-export-site="natif">Exporter au pas de la simulation</button>
                </div>
                <p style="${STYLE_AIDE}">Format d'import de l'autoconsommation (colonnes existant, IRVE, PAC, total).</p>
            </div>
        </div>
        <div class="energy-card" style="padding:1rem; margin-bottom:1rem;">
            <h3 style="margin:0 0 0.5rem 0; font-size:1.1rem;">Couplage avec l'autoconsommation</h3>
            <p id="pac_sync_statut" style="font-size:0.88rem; margin:0.25rem 0;">Aucune courbe transmise.</p>
            <div id="pac_autoconso_resume"></div>
            <p style="${STYLE_AIDE}">La courbe est transmise après chaque calcul. Dans l'autoconsommation individuelle, cochez
                « Ajouter la consommation PAC / climatiseur » et choisissez la règle d'affectation du PV entre usages.</p>
            <div class="pac-boutons">
                <button type="button" id="pac_btn_actualiser_couplage" class="btn-base btn-secondary">Actualiser</button>
                <button type="button" id="pac_btn_supprimer_courbe" class="btn-base btn-secondary">Supprimer la courbe transmise</button>
            </div>
        </div>
        ${balisageEco()}`;
    }

    function balisageEco() {
        const optsRef = ref.eco.systemes_chauffage.map((x) => [x.id, x.libelle]);
        const optsEcs = ref.eco.systemes_ecs.map((x) => [x.id, x.libelle]);
        const sousTitre = (t) => `<h4 style="${STYLE_SOUS_TITRE}">${t}</h4>`;
        return `
        <div class="energy-card" id="pac_eco" style="padding:1rem; margin-bottom:1rem;">
            <h3 style="margin:0 0 0.5rem 0; font-size:1.1rem;">Étude de rentabilité</h3>
            <p style="${STYLE_AIDE}">Comparaison avec un système de référence qui fournirait la même chaleur, la même eau chaude et le même
                froid que l'équipement simulé. Prix TTC pour un particulier, HT pour une entreprise : les valeurs proposées sont des
                ordres de grandeur, à remplacer par vos factures et devis. Ces saisies ne relancent pas la simulation.</p>
            <div id="pac_eco_attente" class="pac-alerte">Lancez le calcul pour obtenir l'étude de rentabilité.</div>
            <div id="pac_eco_contenu" style="display:none;">
                ${sousTitre('Système de référence')}
                ${grille(selecteur('pacr_ref_ch', 'Chauffage existant ou alternatif', optsRef, 'Pré-remplit le rendement et l\'entretien.')
                    + champ('pacr_ref_rdt', 'Modifiable.')
                    + selecteur('pacr_ref_ecs', 'Eau chaude sanitaire de référence', optsEcs)
                    + champ('pacr_ref_ecs_rdt')
                    + selecteur('pacr_ref_froid', 'Climatisation', [['exclu', 'Hors comparaison (confort ajouté)'], ['clim', 'Remplace un climatiseur existant']],
                        'Hors comparaison : la consommation de froid est retirée des deux côtés et chiffrée à part.')
                    + champ('pacr_ref_seer'))}
                ${sousTitre("Prix de l'énergie")}
                ${grille(selecteur('pacr_tarif', 'Option tarifaire', [['C5_HPHC', 'Heures pleines / heures creuses'], ['C5_BASE', 'Base']])
                    + champ('pacr_prix_BASE') + champ('pacr_prix_HP') + champ('pacr_prix_HC')
                    + champ('pacr_prix_gaz') + caseACocher('pacr_resil_gaz', "L'abonnement gaz est résilié (plus aucun usage du gaz)", true) + champ('pacr_abo_gaz')
                    + champ('pacr_prix_fioul') + champ('pacr_surcout_abo', 'Si la puissance souscrite doit être relevée.'))}
                <p id="pacr_hc_info" style="${STYLE_AIDE}"></p>
                ${sousTitre('Production photovoltaïque')}
                ${grille(caseACocher('pacr_pv', 'Déduire le PV consommé par la PAC', true) + champ('pacr_prix_surplus', 'Le kWh consommé n\'est plus vendu.'))}
                <p id="pacr_pv_statut" style="${STYLE_AIDE}"></p>
                ${sousTitre('Investissement et charges')}
                ${grille(champ('pacr_capex_materiel', 'Ordre de grandeur selon le type : remplacez-le par le devis.') + champ('pacr_capex_travaux')
                    + champ('pacr_aides') + champ('pacr_cout_evite', 'Chaudière en fin de vie qu\'il aurait fallu remplacer.')
                    + champ('pacr_entretien_pac') + champ('pacr_entretien_ref'))}
                ${sousTitre('Hypothèses financières')}
                ${grille(champ('pacr_horizon') + champ('pacr_duree_vie') + champ('pacr_remplacement') + champ('pacr_evol_elec')
                    + champ('pacr_evol_gaz') + champ('pacr_evol_fioul') + champ('pacr_inflation') + champ('pacr_actualisation') + champ('pacr_degradation'))}
                <div class="pac-boutons"><button type="button" id="pacr_btn_defauts" class="btn-base btn-secondary">Valeurs par défaut</button></div>
                <div id="pacr_validation" style="${STYLE_BANDEAU}"></div>
                <p id="pacr_verif_statut" style="font-size:0.85rem; margin:0.5rem 0 0;"></p>
                <div id="pacr_resultats" style="display:none;">
                    ${sousTitre('Résultats')}
                    <div class="pac-stats" id="pacr_tuiles"></div>
                    <div id="pacr_alertes"></div>
                    <p id="pacr_utile" style="${STYLE_AIDE}"></p>
                    <div style="overflow-x:auto;"><table class="pac-table"><thead><tr><th>Année 1</th><th>Système de référence</th><th>PAC / climatiseur</th></tr></thead><tbody id="pacr_comparatif"></tbody></table></div>
                    <p id="pacr_froid_exclu" style="${STYLE_AIDE}"></p>
                    <div class="pac-graph" style="margin-top:0.75rem;"><canvas id="pacr_graph"></canvas></div>
                    <details style="margin-top:0.75rem;"><summary style="cursor:pointer; font-weight:600; font-size:0.9rem;">Flux annuels</summary>
                        <div style="overflow-x:auto; margin-top:0.5rem;"><table class="pac-table"><thead><tr><th>Année</th><th>Coût référence (€)</th><th>Coût PAC (€)</th><th>Remplacement (€)</th><th>Flux (€)</th><th>Cumul (€)</th><th>Cumul actualisé (€)</th></tr></thead><tbody id="pacr_flux"></tbody></table></div>
                    </details>
                    <div class="pac-boutons"><button type="button" id="pacr_btn_export" class="btn-base btn-secondary">Exporter l'étude (XLSX)</button></div>
                    <p style="${STYLE_AIDE}">CO2 : facteurs d'émission par énergie et par usage de la méthode publique du diagnostic de performance
                        énergétique ; électricité de la PAC comptée sur la part achetée au réseau. Le PV consommé par la PAC est valorisé
                        au prix moyen de son kWh.</p>
                </div>
            </div>
        </div>`;
    }

    // ---------------------------------------------------------------------------------------
    // Tableaux (pièces, points de fonctionnement)
    // ---------------------------------------------------------------------------------------
    function optionsOrient(choisie) {
        return [['', '—']].concat(ORIENTATIONS.map((o) => [o, LIBELLES_ORIENT[o]]))
            .map(([v, l]) => `<option value="${v}" ${v === choisie ? 'selected' : ''}>${l}</option>`).join('');
    }

    function ajouterPiece(p) {
        const tb = $('pac_pieces');
        if (!tb) return;
        const f = (p && p.facades) || [];
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" class="modern-input pac-pc-nom" maxlength="40" value="${echapper(p ? p.nom : `Pièce ${tb.children.length + 1}`)}"></td>
            <td><input type="number" class="modern-input pac-pc-surface" min="1" max="500" step="any" value="${p ? p.surface : 20}"></td>
            <td><input type="number" class="modern-input pac-pc-hauteur" min="2" max="8" step="any" value="${p ? p.hauteur : 2.5}"></td>
            <td><select class="modern-input pac-pc-o1">${optionsOrient(f[0] ? f[0].orientation : 'S')}</select></td>
            <td><input type="number" class="modern-input pac-pc-l1" min="0" max="60" step="any" value="${f[0] ? f[0].longueur : 4}"></td>
            <td><select class="modern-input pac-pc-o2">${optionsOrient(f[1] ? f[1].orientation : '')}</select></td>
            <td><input type="number" class="modern-input pac-pc-l2" min="0" max="60" step="any" value="${f[1] ? f[1].longueur : 0}"></td>
            <td><input type="number" class="modern-input pac-pc-vitrage" min="0" max="90" step="any" value="${p ? p.vitragePct : 20}"></td>
            <td><input type="checkbox" class="pac-pc-toit" ${!p || p.sousToiture ? 'checked' : ''}></td>
            <td><input type="checkbox" class="pac-pc-sol" ${!p || p.surSol ? 'checked' : ''}></td>
            <td><button type="button" class="btn-base btn-secondary pac-suppr" title="Supprimer" style="padding:0.2rem 0.5rem;">✕</button></td>`;
        tb.appendChild(tr);
    }

    function lirePieces() {
        return Array.from(document.querySelectorAll('#pac_pieces tr')).map((tr) => {
            const q = (c) => tr.querySelector(c);
            return {
                nom: q('.pac-pc-nom').value.trim(),
                surface: lireNombre(q('.pac-pc-surface').value),
                hauteur: lireNombre(q('.pac-pc-hauteur').value),
                facades: [
                    { orientation: q('.pac-pc-o1').value, longueur: lireNombre(q('.pac-pc-l1').value) || 0 },
                    { orientation: q('.pac-pc-o2').value, longueur: lireNombre(q('.pac-pc-l2').value) || 0 },
                ],
                vitragePct: lireNombre(q('.pac-pc-vitrage').value),
                sousToiture: q('.pac-pc-toit').checked,
                surSol: q('.pac-pc-sol').checked,
            };
        });
    }

    function ajouterPoint(mode, p) {
        const tb = $(mode === 'chaud' ? 'pac_points_chaud' : 'pac_points_froid');
        if (!tb) return;
        const cle = mode === 'chaud' ? 'cop' : 'eer';
        const tr = document.createElement('tr');
        const v = (x) => (x === undefined || x === null ? '' : x);
        tr.innerHTML = `
            <td class="pac-pt-libelle"></td>
            <td><input type="number" class="modern-input pac-pt-a" step="any" value="${v(p && p.a)}"></td>
            <td><input type="number" class="modern-input pac-pt-w" step="any" value="${v(p && p.w)}"></td>
            <td><input type="number" class="modern-input pac-pt-p" step="any" value="${v(p && p.p_kw)}"></td>
            <td><input type="number" class="modern-input pac-pt-r" step="any" value="${v(p && p[cle])}"></td>
            <td><button type="button" class="btn-base btn-secondary pac-suppr" title="Supprimer" style="padding:0.2rem 0.5rem;">✕</button></td>`;
        tb.appendChild(tr);
        majLibellesPoints();
    }

    function majLibellesPoints() {
        const s = ref ? etat() : null;
        ['chaud', 'froid'].forEach((mode) => {
            document.querySelectorAll(`#pac_points_${mode} tr`).forEach((tr) => {
                const a = lireNombre(tr.querySelector('.pac-pt-a').value);
                const w = lireNombre(tr.querySelector('.pac-pt-w').value);
                const lettre = s && s.systeme === 'air_air' ? 'A' : 'W';
                tr.querySelector('.pac-pt-libelle').textContent = a !== null && w !== null ? `A${fr(a, a % 1 ? 1 : 0)}/${lettre}${fr(w, w % 1 ? 1 : 0)}` : '—';
            });
        });
        const lib = s && s.systeme === 'air_air' ? 'Air intérieur (°C)' : 'W (°C)';
        txt('pac_th_w_chaud', lib);
        txt('pac_th_w_froid', lib);
    }

    function lirePoints(mode) {
        const cle = mode === 'chaud' ? 'cop' : 'eer';
        return Array.from(document.querySelectorAll(`#pac_points_${mode} tr`)).map((tr) => ({
            a: lireNombre(tr.querySelector('.pac-pt-a').value),
            w: lireNombre(tr.querySelector('.pac-pt-w').value),
            p_kw: lireNombre(tr.querySelector('.pac-pt-p').value),
            [cle]: lireNombre(tr.querySelector('.pac-pt-r').value),
        }));
    }

    function remplirPoints(mode, points) {
        const tb = $(mode === 'chaud' ? 'pac_points_chaud' : 'pac_points_froid');
        if (!tb) return;
        tb.innerHTML = '';
        (points || []).forEach((p) => ajouterPoint(mode, p));
    }

    function valeursGeneriques() {
        const s = etat();
        const cle = s.systeme === 'air_air' ? 'air_air' : 'air_eau';
        remplirPoints('chaud', s.type === 'clim' ? [] : ref.equip.points_chaud_generiques[cle]);
        remplirPoints('froid', ref.equip.points_froid_generiques[cle]);
        const a = ref.equip.auxiliaires_defaut;
        $('pac_aux_circ').value = a.circulateur_w;
        $('pac_aux_veille').value = a.veille_w;
        $('pac_aux_carter').value = a.carter_w;
        $('pac_aux_carter_seuil').value = a.carter_seuil_c;
        $('pac_aux_vent').value = a.ventilateur_interieur_w;
        $('pac_mod_min').value = ref.equip.charge_partielle.modulation_min_pct;
        $('pac_cd').value = ref.equip.charge_partielle.cd;
        invaliderResultats();
    }

    // ---------------------------------------------------------------------------------------
    // Visibilité, listes dépendantes
    // ---------------------------------------------------------------------------------------
    function afficher(id, visible) {
        const el = $(id);
        if (el) el.style.display = visible ? '' : 'none';
    }
    function afficherChamp(id, visible) {
        const el = document.querySelector(`[data-pac-champ="${id}"]`);
        if (el) el.style.display = visible ? '' : 'none';
    }

    function remplirSelect(id, options, valeurPreferee) {
        const sel = $(id);
        if (!sel) return;
        const actuelle = valeurPreferee !== undefined ? valeurPreferee : sel.value;
        sel.innerHTML = options.map(([v, l]) => `<option value="${echapper(v)}">${echapper(l)}</option>`).join('');
        if (options.some(([v]) => v === actuelle)) sel.value = actuelle;
    }

    function majListes() {
        const type = val('pac_type');
        if (type === 'clim') $('pac_reversible').checked = false;
        const s0 = etat();
        remplirSelect('pac_usage', usagesCompatibles(type, s0.reversible).map((u) => [u.id, u.libelle]));
        const emetteurs = ref.emetteurs.emetteurs.filter((e) => e.systeme === s0.systeme);
        remplirSelect('pac_emetteur_chaud', emetteurs.filter((e) => e.chaud).map((e) => [e.id, e.libelle]));
        remplirSelect('pac_emetteur_froid', emetteurs.filter((e) => e.froid).map((e) => [e.id, e.libelle]));
    }

    function majVisibilite() {
        const s = etat();
        afficherChamp('pac_reversible', s.type !== 'clim');
        afficher('pac_bloc_emetteurs', s.usages.chauffage || s.usages.froid);
        afficherChamp('pac_emetteur_chaud', s.usages.chauffage);
        afficherChamp('pac_emetteur_froid', s.usages.froid);
        afficher('pac_bloc_liaisons', s.split);
        afficher('pac_liaison_estimation', s.split);
        afficher('pac_bloc_appoint', s.type !== 'clim' && s.usages.chauffage);
        afficher('pac_bloc_consignes', true);
        afficherChamp('pac_absence', true);
        afficherChamp('pac_reduit_absence', s.usages.chauffage && coche('pac_absence'));
        afficherChamp('pac_froid_presence', s.usages.froid && coche('pac_absence'));
        afficherChamp('pac_source_bat', s.mode === 'connue' && s.usages.chauffage);
        afficherChamp('pac_option', batimentDecrit(s));
        afficher('pac_bloc_batiment', avecEspace(s));
        const decritSimplifie = batimentDecrit(s) && s.option === 'simplifiee';
        afficherChamp('pac_niveau', batimentDecrit(s));
        afficherChamp('pac_ventilation', batimentDecrit(s));
        afficher('pac_g_detail', decritSimplifie);
        afficher('pac_bloc_detaille', avecEspace(s) && batimentDecrit(s) && s.option === 'detaillee');
        afficher('pac_bloc_ecs', s.usages.ecs);
        afficherChamp('pac_al_jour', s.usages.ecs && coche('pac_al_actif'));
        afficherChamp('pac_ecs_gain', s.usages.ecs && s.plageEcs !== 'solaire');
        afficherChamp('pac_ecs_priorite', s.usages.ecs && (s.usages.chauffage || s.usages.froid));
        afficher('pac_bloc_chaud', s.type !== 'clim' && (s.usages.chauffage || s.usages.ecs));
        afficher('pac_bloc_froid', s.usages.froid);
        afficherChamp('pac_ajuster', s.mode === 'dimensionnement');
        afficherChamp('pac_degivrage_inclus', s.type !== 'clim');
        REGLES.forEach((r) => { if (r.quand) afficherChamp(r.id, !!r.quand(s)); });
        majLibellesPoints();
        majSchema();
    }

    /** Valeurs par défaut liées au niveau d'isolation (U, n50, ventilation, facteur solaire). */
    function appliquerNiveau() {
        const n = B.trouver(ref.bat.niveaux_isolation, val('pac_niveau'));
        if (!n) return;
        $('pac_ventilation').value = n.ventilation;
        $('pac_u_mur').value = n.u_mur;
        $('pac_u_toit').value = n.u_toit;
        $('pac_u_sol').value = n.u_sol;
        $('pac_u_fen').value = n.u_fenetre;
        $('pac_pt').value = n.ponts_thermiques_pct;
        $('pac_n50').value = n.n50;
        $('pac_g_fenetre').value = n.g_fenetre;
        $('pac_g').value = '';
        appliquerVentilation();
    }

    function appliquerVentilation() {
        const v = B.trouver(ref.bat.ventilations, val('pac_ventilation'));
        if (!v) return;
        $('pac_vent_n').value = v.renouvellement_vol_h;
        $('pac_vent_eta').value = v.rendement_recuperation;
        majDetailG();
    }

    function gCalcule() {
        const n = B.trouver(ref.bat.niveaux_isolation, val('pac_niveau'));
        const v = B.trouver(ref.bat.ventilations, val('pac_ventilation'));
        return n ? B.gDepuisNiveau(n, v, ref.bat) : null;
    }

    function majDetailG() {
        const g = gCalcule();
        if (!g) return;
        txt('pac_g_detail', `G calculé pour ce niveau : ${fr(g.G, 2)} W/(m³·K) (transmission ${fr(g.hTr / g.volume, 2)} + renouvellement d'air ${fr(g.hVe / g.volume, 2)}, maison de référence de plain-pied de 100 m²).`);
    }

    function appliquerEmetteurs() {
        const s = etat();
        const ec = B.trouver(ref.emetteurs.emetteurs, val('pac_emetteur_chaud'));
        if (ec && ec.chaud && s.systeme === 'air_eau') {
            $('pac_dep_base').value = ec.chaud.depart_base;
            $('pac_dep_doux').value = ec.chaud.depart_doux;
        }
        const ef = B.trouver(ref.emetteurs.emetteurs, val('pac_emetteur_froid'));
        if (ef && ef.froid && s.systeme === 'air_eau') $('pac_dep_froid').value = ef.froid.depart;
    }

    function majEstimationLiaisons() {
        const pct = C.perteLiaisonsDefaut({ longueur: nombre('pac_liaison_long'), denivele: nombre('pac_liaison_deniv'), coudes90: nombre('pac_liaison_c90'), coudes180: nombre('pac_liaison_c180') }, ref.equip);
        const saisie = nombre('pac_liaison_perte');
        txt('pac_liaison_estimation', saisie !== null
            ? `Perte retenue : ${fr(saisie, 1)} % (valeur saisie). Estimation par défaut : ${fr(pct, 1)} %.`
            : `Perte retenue : ${fr(pct, 1)} % (estimation par défaut : au-delà de ${fr(ref.equip.liaisons_frigorifiques.longueur_reference_m, 1)} m, dénivelé et coudes).`);
        return saisie !== null ? saisie : pct;
    }

    // ---------------------------------------------------------------------------------------
    // Validation
    // ---------------------------------------------------------------------------------------
    function violations() {
        const s = etat();
        const liste = [];
        const ajouter = (el, msg) => liste.push({ el, message: msg });
        REGLES.forEach((r) => {
            if (r.quand && !r.quand(s)) return;
            const el = $(r.id);
            if (!el) return;
            const v = lireNombre(el.value);
            if (v === null) {
                if (!r.facultatif) ajouter(el, `${r.libelle} : valeur obligatoire. ${plage(r)}`);
                return;
            }
            if (v < r.min || v > r.max) ajouter(el, `${r.libelle} : ${fr(v, 2)} hors plage. ${plage(r)}`);
            else if (r.entier && !Number.isInteger(v)) ajouter(el, `${r.libelle} : nombre entier attendu.`);
        });
        if (avecEau(s) && s.usages.chauffage) {
            if (nombre('pac_dep_doux') > nombre('pac_dep_base')) ajouter($('pac_dep_doux'), 'Le départ à la température de non-chauffage doit être inférieur ou égal au départ à la température de base.');
            if (nombre('pac_dep_base') > nombre('pac_tdep_max')) ajouter($('pac_dep_base'), "Le départ à la température de base dépasse la température d'eau maximale de la PAC : l'appoint ou un autre émetteur sera nécessaire.");
        }
        if (s.usages.chauffage && nombre('pac_cons_reduit') > nombre('pac_cons_ch')) ajouter($('pac_cons_reduit'), 'La consigne réduite doit être inférieure ou égale à la consigne de chauffage.');
        if (s.usages.chauffage && s.usages.froid && nombre('pac_cons_froid') < nombre('pac_cons_ch') + 2) ajouter($('pac_cons_froid'), 'Laissez au moins 2 °C entre la consigne de chauffage et celle de rafraîchissement.');
        if (s.usages.ecs && nombre('pac_ecs_consigne') < nombre('pac_ecs_tusage') + 5) ajouter($('pac_ecs_consigne'), "La consigne du ballon doit dépasser d'au moins 5 °C la température d'usage.");
        if (nombre('pac_tmax_ch') !== null && nombre('pac_tmin_ch') !== null && nombre('pac_tmin_ch') >= nombre('pac_tmax_ch')) ajouter($('pac_tmin_ch'), 'La plage de fonctionnement en chaud est vide.');
        if (s.usages.froid && nombre('pac_tmax_fr') !== null && nombre('pac_tmin_fr') !== null && nombre('pac_tmin_fr') >= nombre('pac_tmax_fr')) ajouter($('pac_tmin_fr'), 'La plage de fonctionnement en froid est vide.');
        if (s.usages.ecs && (nombre('pac_occupants') ?? 0) < 1) ajouter($('pac_occupants'), "Nombre d'occupants : au moins 1 avec l'eau chaude sanitaire.");
        if (avecEau(s) && s.usages.chauffage && nombre('pac_tbase_hiver') !== null && nombre('pac_t_non_chauffage') !== null
            && nombre('pac_t_non_chauffage') <= nombre('pac_tbase_hiver')) ajouter($('pac_t_non_chauffage'), 'La température de non-chauffage doit dépasser la température de base hiver.');
        if (avecEspace(s) && batimentDecrit(s) && s.option === 'detaillee') {
            const totale = lirePieces().reduce((a, x) => a + (x.surface || 0), 0);
            if (totale > REGLE.pac_surface.max) ajouter($('pac_btn_piece'), `Surface totale des pièces supérieure à ${fr(REGLE.pac_surface.max)} m².`);
        }

        // Points de fonctionnement
        const verifierPoints = (mode, requis) => {
            const bornes = BORNES_POINTS[mode];
            const bw = s.systeme === 'air_air' ? bornes.w_air : bornes.w_eau;
            const cle = mode === 'chaud' ? 'COP' : 'EER';
            const lignes = Array.from(document.querySelectorAll(`#pac_points_${mode} tr`));
            let complets = 0;
            lignes.forEach((tr, i) => {
                const champs = [['.pac-pt-a', 'A', bornes.a], ['.pac-pt-w', s.systeme === 'air_air' ? 'air intérieur' : 'W', bw], ['.pac-pt-p', 'puissance', bornes.p_kw], ['.pac-pt-r', cle, bornes.r]];
                let complet = true;
                champs.forEach(([sel, nom, [mn, mx]]) => {
                    const el = tr.querySelector(sel);
                    const v = lireNombre(el.value);
                    if (v === null) { complet = false; ajouter(el, `${mode === 'chaud' ? 'Chauffage' : 'Froid'}, point ${i + 1} : ${nom} manquant.`); }
                    else if (v < mn || v > mx) ajouter(el, `${mode === 'chaud' ? 'Chauffage' : 'Froid'}, point ${i + 1} : ${nom} hors plage (${fr(mn)} – ${fr(mx)}).`);
                });
                if (complet) complets++;
            });
            if (requis && complets === 0) liste.push({ el: null, message: `${mode === 'chaud' ? 'Chauffage' : 'Froid'} : saisissez au moins un point de fonctionnement (puissance et ${cle}).` });
        };
        if (s.type !== 'clim' && (s.usages.chauffage || s.usages.ecs)) verifierPoints('chaud', true);
        if (s.usages.froid) verifierPoints('froid', true);

        // Pièces
        if (avecEspace(s) && batimentDecrit(s) && s.option === 'detaillee') {
            const lignes = Array.from(document.querySelectorAll('#pac_pieces tr'));
            if (!lignes.length) liste.push({ el: $('pac_btn_piece'), message: 'Méthode détaillée : ajoutez au moins une pièce.' });
            lignes.forEach((tr, i) => {
                [['.pac-pc-surface', 'surface', BORNES_PIECE.surface, 'm²'], ['.pac-pc-hauteur', 'hauteur', BORNES_PIECE.hauteur, 'm'],
                    ['.pac-pc-l1', 'longueur de façade 1', BORNES_PIECE.longueur, 'm'], ['.pac-pc-l2', 'longueur de façade 2', BORNES_PIECE.longueur, 'm'],
                    ['.pac-pc-vitrage', 'vitrage', BORNES_PIECE.vitrage, '%']].forEach(([sel, nom, [mn, mx], u]) => {
                    const el = tr.querySelector(sel);
                    const v = lireNombre(el.value);
                    if (v === null || v < mn || v > mx) ajouter(el, `Pièce ${i + 1} : ${nom} hors plage (${fr(mn)} – ${fr(mx)} ${u}).`);
                });
            });
        }
        return liste;
    }

    function majEtatValidation() {
        if (!construit) return [];
        document.querySelectorAll('#pac-section-content input, #pac-section-content select').forEach((el) => {
            el.style.borderColor = ''; el.style.boxShadow = '';
        });
        const v = violations();
        v.filter((x) => x.el).forEach((x) => {
            x.el.style.borderColor = '#dc2626';
            x.el.style.boxShadow = '0 0 0 2px rgba(220,38,38,0.15)';
        });
        const bandeau = $('pac_validation');
        if (bandeau) {
            bandeau.style.display = v.length ? 'block' : 'none';
            bandeau.textContent = v.length ? `${v[0].message}${v.length > 1 ? ` (et ${v.length - 1} autre${v.length > 2 ? 's' : ''} correction${v.length > 2 ? 's' : ''})` : ''}` : '';
        }
        const btn = $('pac_btn_calculer');
        if (btn) { btn.disabled = !!v.length || calculEnCours; btn.style.opacity = btn.disabled ? '0.55' : ''; }
        return v;
    }

    // ---------------------------------------------------------------------------------------
    // Localisation et météo
    // ---------------------------------------------------------------------------------------
    function adresseProjet() {
        if (typeof window.resolveProjectLatLon === 'function') {
            const r = window.resolveProjectLatLon();
            if (r && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon))) return { lat: Number(r.lat), lon: Number(r.lon), libelle: r.libelle || '' };
        }
        return null;
    }

    /** Département déduit du code postal de l'adresse du projet (Corse : 2A sous 20200, 2B au-delà). */
    function departementDepuisAdresse() {
        let brut = window.ACTIVE_PROJECT_ADRESSE;
        try { if (typeof brut === 'string') brut = JSON.parse(brut); } catch (e) { /* adresse en texte libre */ }
        const textes = brut && typeof brut === 'object'
            ? [brut.code_postal, brut.codePostal, brut.postcode, brut.adresse, brut.libelle, brut.formatted_address]
            : [brut];
        const m = textes.filter(Boolean).map(String).map((t) => t.match(/\b(\d{5})\b/)).find(Boolean);
        if (!m) return '';
        const cp = m[1];
        if (cp.startsWith('97')) return cp.slice(0, 3);
        if (cp.startsWith('20')) return Number(cp) < 20200 ? '2A' : '2B';
        return cp.slice(0, 2);
    }

    /**
     * Altitude mémorisée par le résumé « Adresse / Coordonnées / Hypothèses climatiques »
     * (solarProjectData.projectInfo.altitude), retenue seulement si l'adresse mémorisée avec elle a
     * les mêmes coordonnées que le projet actif (le localStorage est commun à tous les projets).
     */
    function altitudeMemorisee(site) {
        try {
            const info = (JSON.parse(localStorage.getItem('solarProjectData') || '{}') || {}).projectInfo || {};
            const alt = lireNombre(info.altitude);
            if (alt === null) return null;
            const brut = info.adresseProjet || info.adresse_projet || info.adresse;
            const a = typeof brut === 'string' ? JSON.parse(brut) : brut;
            const lat = Number(a && a.latitude);
            const lon = Number(a && a.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            return Math.abs(lat - site.lat) < 1e-4 && Math.abs(lon - site.lon) < 1e-4 ? alt : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Pré-remplit « Altitude du site » d'après l'adresse du projet : valeur du résumé de l'adresse si
     * elle correspond, sinon altitude du terrain au point de l'adresse (POST /api/pac/altitude).
     * Jamais par-dessus une saisie (ni une configuration importée avec une altitude).
     */
    async function remplirAltitude() {
        const el = $('pac_altitude');
        const site = adresseProjet();
        if (!el || !site || el.dataset.saisi) return;
        const cle = `${site.lat.toFixed(5)}|${site.lon.toFixed(5)}`;
        if (el.dataset.auto === cle && el.value !== '') return;
        let alt = altitudeMemorisee(site);
        if (alt === null) {
            try {
                const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
                const rep = await fetch(`${apiPrefix}/api/pac/altitude`, {
                    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lat: site.lat, lon: site.lon }),
                });
                const json = rep.ok ? await rep.json() : null;
                alt = json ? lireNombre(json.altitude_m) : null;
            } catch (e) {
                alt = null;
            }
        }
        if (el.dataset.saisi) return; // saisie pendant la requête
        if (alt === null) {
            txt('pac_altitude_source', "Altitude introuvable pour l'adresse du projet : saisissez-la (sinon l'altitude de la donnée météo est retenue).");
            return;
        }
        el.value = Math.round(alt);
        el.dataset.auto = cle;
        txt('pac_altitude_source', `Altitude reprise de l'adresse du projet : ${fr(alt, 0)} m.`);
        if (meteo) majTemperaturesBase(true);
        invaliderResultats();
        majEtatValidation();
    }

    function majZone() {
        const d = B.trouver((ref.deps.departements || []).map((x) => ({ ...x, id: x.code })), val('pac_departement'));
        txt('pac_zone', d ? (d.zone === 'DOM' ? 'Outre-mer' : d.zone) : '--');
    }

    function correctionAltitude() {
        if (!meteo) return 0;
        return B.correctionAltitude(nombre('pac_altitude'), meteo.altitude_meteo_m);
    }

    async function chargerMeteo(forcer) {
        const site = adresseProjet();
        if (!site) throw new Error("Adresse du projet introuvable : renseignez-la dans les paramètres du projet.");
        const pas = Number(val('pac_pas'));
        const annee = nombre('pac_annee');
        const cle = `${site.lat.toFixed(4)}|${site.lon.toFixed(4)}|${pas}|${annee}`;
        if (meteo && meteoCle === cle && !forcer) return meteo;
        txt('pac_meteo_statut', 'Chargement de la météo du site…');
        const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
        const rep = await fetch(`${apiPrefix}/api/pac/meteo`, {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat: site.lat, lon: site.lon, pas_minutes: pas, annee }),
        });
        const json = await rep.json().catch(() => ({}));
        if (!rep.ok) { txt('pac_meteo_statut', ''); throw new Error(json.error || 'Données météo indisponibles.'); }
        meteo = json;
        meteoCle = cle;
        majTemperaturesBase(true);
        txt('pac_meteo_statut', `Météo chargée (${pas} min, année type${meteo.altitude_meteo_m != null ? `, altitude de la donnée ${fr(meteo.altitude_meteo_m)} m` : ''}).`);
        if (meteo.avertissement) message(meteo.avertissement, 'info', 6000);
        return meteo;
    }

    /** Remplit les températures de base (si vides ou si `remplacer`) depuis la météo corrigée. */
    function majTemperaturesBase(remplacer) {
        if (!meteo) return;
        const dT = correctionAltitude();
        const tb = meteo.temperatures_base;
        const hiver = Math.round((tb.hiver_min_3h + dT) * 10) / 10;
        const ete = Math.round((tb.ete_max_3h + dT) * 10) / 10;
        if (remplacer || nombre('pac_tbase_hiver') === null) $('pac_tbase_hiver').value = hiver;
        if (remplacer || nombre('pac_tbase_ete') === null) $('pac_tbase_ete').value = ete;
        txt('pac_tbase_detail', `Météo du site : minimum de la moyenne sur 3 h ${fr(hiver, 1)} °C (centile 0,4 % : ${fr(tb.hiver_centile_0_4 + dT, 1)} °C), `
            + `maximum ${fr(ete, 1)} °C (centile 99,6 % : ${fr(tb.ete_centile_99_6 + dT, 1)} °C)`
            + `${dT ? `, correction d'altitude ${dT > 0 ? '+' : ''}${fr(dT, 1)} °C` : ''}. Une année type lisse les extrêmes : vérifiez ces valeurs.`);
        majEtatValidation();
    }

    // ---------------------------------------------------------------------------------------
    // Construction des entrées de calcul
    // ---------------------------------------------------------------------------------------
    function capaciteKjM2K() {
        const c = B.trouver(ref.bat.inerties.classes, val('pac_inertie'));
        return c ? c.capacite_kj_m2k : 130;
    }

    function emetteur(id) { return B.trouver(ref.emetteurs.emetteurs, id); }

    function construireModeles(s, perteLiaisons, facteurChaud, facteurFroid) {
        const echelle = (pts, f) => pts.filter((p) => p.a !== null && p.w !== null).map((p) => ({ ...p, p_kw: p.p_kw * (f || 1) }));
        const commun = { systeme: s.systeme, perteLiaisonsPct: s.split ? perteLiaisons : 0, modulationMinPct: nombre('pac_mod_min'), cd: nombre('pac_cd') };
        const cfg = {
            chaud: s.type !== 'clim' && (s.usages.chauffage || s.usages.ecs)
                ? { ...commun, mode: 'chaud', points: echelle(lirePoints('chaud'), facteurChaud), inclutDegivrage: coche('pac_degivrage_inclus'), tExtMin: nombre('pac_tmin_ch'), tExtMax: nombre('pac_tmax_ch') }
                : null,
            froid: s.usages.froid
                ? { ...commun, mode: 'froid', inclutDegivrage: false, points: echelle(lirePoints('froid'), facteurFroid), tExtMin: nombre('pac_tmin_fr'), tExtMax: nombre('pac_tmax_fr') }
                : null,
        };
        return {
            chaud: cfg.chaud ? C.creerModele(cfg.chaud, ref.equip) : null,
            froid: cfg.froid ? C.creerModele(cfg.froid, ref.equip) : null,
            cfg, // description des modèles, envoyée au contrôle des calculs
        };
    }

    function temperaturesDepart(s, tBase) {
        const ec = emetteur(val('pac_emetteur_chaud'));
        const ef = emetteur(val('pac_emetteur_froid'));
        const loi = s.systeme === 'air_eau' && s.usages.chauffage
            ? { tBase, departBase: nombre('pac_dep_base'), tNonChauffage: nombre('pac_t_non_chauffage'), departDoux: nombre('pac_dep_doux'), departMax: nombre('pac_tdep_max') }
            : null;
        return {
            loi,
            twBase: loi ? C.loiDeau(tBase, loi) : ((ec && ec.chaud && ec.chaud.puits) || 20),
            puitsChaud: (ec && ec.chaud && ec.chaud.puits) || 20,
            departFroid: s.systeme === 'air_eau' ? nombre('pac_dep_froid') : ((ef && ef.froid && ef.froid.puits) || 27),
        };
    }

    function apportsSimulation() {
        return {
            appareilsWm2: nombre('pac_apports_wm2') ?? 0,
            occupantSensibleW: ref.bat.apports_internes.occupant_sensible_w,
            facteurEte: ref.bat.vitrages.facteur_protection_ete / ref.bat.vitrages.facteur_ombrage_hiver,
        };
    }

    function consignesSimulation(s) {
        return {
            chauffage: nombre('pac_cons_ch') ?? 20,
            reduit: nombre('pac_cons_reduit') ?? 20,
            reduitDebut: nombre('pac_reduit_debut') ?? 0,
            reduitFin: nombre('pac_reduit_fin') ?? 0,
            froid: s.usages.froid ? nombre('pac_cons_froid') : 99,
            occupants: nombre('pac_occupants') ?? 0,
            absenceSemaine: coche('pac_absence'),
            absenceDebut: nombre('pac_abs_debut') ?? 8,
            absenceFin: nombre('pac_abs_fin') ?? 18,
            reduitEnAbsence: coche('pac_reduit_absence'),
            froidSeulementPresence: coche('pac_froid_presence'),
        };
    }

    function ecsSimulation(s, tMoyMens, tAn) {
        if (!s.usages.ecs) return null;
        const profil = ref.ecs.profils_puisage[val('pac_ecs_profil')] || ref.ecs.profils_puisage.standard;
        const plages = { permanente: null, nuit: { debut: 22, fin: 6 }, solaire: { debut: 11, fin: 16 }, perso: { debut: nombre('pac_ecs_debut'), fin: nombre('pac_ecs_fin') } };
        const volume = nombre('pac_ecs_volume');
        return {
            litresJour: (nombre('pac_occupants') || 0) * nombre('pac_ecs_litres'),
            profil: profil.fractions,
            tUsage: nombre('pac_ecs_tusage'),
            consigne: nombre('pac_ecs_consigne'),
            hysteresis: nombre('pac_ecs_hyst'),
            volume,
            pertesKwh24h: nombre('pac_ecs_pertes') ?? B.pertesBallonDefaut(volume, ref.ecs),
            tAmbiance: nombre('pac_ecs_tamb'),
            eauFroideMensuelle: C.eauFroideMensuelle(tMoyMens, tAn, ref.ecs),
            resistanceKw: nombre('pac_ecs_res'),
            tEauMaxPac: (nombre('pac_tdep_max') ?? 60) - 5,
            plage: plages[s.plageEcs],
            antilegionelle: { actif: coche('pac_al_actif'), jourSemaine: Number(val('pac_al_jour')), heure: nombre('pac_al_heure'), temperature: ref.ecs.antilegionelle.temperature_c },
            priorite: coche('pac_ecs_priorite'),
        };
    }

    /** Bâtiment décrit (simplifié ou détaillé), ou déduit de la puissance de l'équipement. */
    function construireBatiment(s, modeles, tBase, dep) {
        const inertie = capaciteKjM2K();
        if (!avecEspace(s)) {
            // ECS seule : bâtiment fictif sans besoin (aucun usage d'espace simulé).
            return { modele: '1r1c', surface: 1, volume: 1, H: 1, C: 1e6, vitrages: { N: 0, E: 0, S: 0, O: 0 } };
        }
        if (batimentDecrit(s) && s.option === 'detaillee') {
            const env = {
                u_mur: nombre('pac_u_mur'), u_toit: nombre('pac_u_toit'), u_sol: nombre('pac_u_sol'), u_fenetre: nombre('pac_u_fen'),
                g_fenetre: nombre('pac_g_fenetre'), ponts_thermiques_pct: nombre('pac_pt'), n50: nombre('pac_n50'),
            };
            const vent = { renouvellement_vol_h: nombre('pac_vent_n'), rendement_recuperation: nombre('pac_vent_eta') };
            return B.batimentDetaille(lirePieces(), env, vent, inertie, ref.bat);
        }
        let G;
        let uFenetre; let renouvellementVolH;
        if (batimentDecrit(s)) {
            G = nombre('pac_g') ?? gCalcule().G;
            const niveau = B.trouver(ref.bat.niveaux_isolation, val('pac_niveau'));
            uFenetre = niveau.u_fenetre;
            renouvellementVolH = B.renouvellementEquivalent(B.trouver(ref.bat.ventilations, val('pac_ventilation')), niveau.n50, ref.bat);
        } else {
            // Bâtiment déduit : déperditions telles que l'équipement couvre `taux` % du besoin à la base.
            const taux = nombre('pac_taux_dim') / 100;
            const volume = nombre('pac_surface') * nombre('pac_hauteur');
            const cap = modeles.chaud.capaciteKw(tBase, dep.twBase, 80) * 1000;
            const H = cap / taux / Math.max(1, (nombre('pac_cons_ch') ?? 20) - tBase);
            G = H / volume;
        }
        return B.batimentSimplifie({
            surface: nombre('pac_surface'), hauteur: nombre('pac_hauteur'), G, capaciteKjM2K: inertie,
            partVitreePct: nombre('pac_vitrage_pct'), gFenetre: nombre('pac_g_fenetre'), uFenetre, renouvellementVolH,
        }, ref.bat);
    }

    // ---------------------------------------------------------------------------------------
    // Calcul
    // ---------------------------------------------------------------------------------------
    async function calculer() {
        if (calculEnCours) return;
        const v = majEtatValidation();
        if (v.length) { message(v[0].message, 'error', 5000); return; }
        calculEnCours = true;
        majEtatValidation();
        txt('pac_calcul_statut', 'Calcul en cours…');
        try {
            const met0 = await chargerMeteo(false);
            const s = etat();
            const dT = correctionAltitude();
            const met = { ...met0, temperature: dT ? met0.temperature.map((t) => t + dT) : met0.temperature };
            if (nombre('pac_tbase_hiver') === null || nombre('pac_tbase_ete') === null) majTemperaturesBase(false);
            const tBase = nombre('pac_tbase_hiver');
            const tBaseEte = nombre('pac_tbase_ete');
            const perteLiaisons = majEstimationLiaisons();
            const dep = temperaturesDepart(s, tBase);
            const pas = Number(val('pac_pas'));
            const annee = nombre('pac_annee');
            const tMoyMens = met0.temperatures_moyennes_mensuelles.map((t) => t + dT);
            const tAn = met0.temperature_moyenne_annuelle + dT;

            let modeles = construireModeles(s, perteLiaisons, 1, 1);
            const b = construireBatiment(s, modeles, tBase, dep);
            const commun = {
                pasMin: pas, annee, meteo: met, batiment: b, apports: apportsSimulation(), consignes: consignesSimulation(s),
                systeme: s.systeme, loiDeau: dep.loi, puitsChaud: dep.puitsChaud, departFroid: dep.departFroid,
            };

            // 1. Besoins du bâtiment (puissances illimitées), consigne constante : la pointe mesurée
            //    exclut la relance après un réduit (sinon elle exigerait de remonter toute la masse du
            //    bâtiment en un seul pas de temps).
            const consignesConstantes = { ...commun.consignes, reduit: commun.consignes.chauffage, reduitEnAbsence: false };
            const simBesoins = avecEspace(s) ? S.simuler({ ...commun, consignes: consignesConstantes, usages: { chauffage: s.usages.chauffage, froid: s.usages.froid, ecs: false }, ideal: true }) : null;
            const synBesoins = simBesoins ? S.synthese(simBesoins) : null;
            const pointe = (arr) => (arr ? arr.reduce((m, x) => (x > m ? x : m), 0) : 0);
            const tInt = nombre('pac_cons_ch') ?? 20;
            const besoinBaseKw = s.usages.chauffage ? B.puissanceChauffageBase(b.H, tInt, tBase) / 1000 : 0;
            const pointeChaudDynKw = simBesoins ? pointe(simBesoins.qChauffagePac) : 0;
            const pointeFroidKw = simBesoins ? pointe(simBesoins.qFroid) : 0;
            const gammeCh = s.usages.chauffage ? B.gammeChauffage(besoinBaseKw, s.appoint) : null;
            const gammeFr = s.usages.froid ? B.gammeFroid(pointeFroidKw) : null;

            // 2. Ajustement des puissances (mode dimensionnement) : cible au milieu de la gamme.
            let facteurChaud = 1; let facteurFroid = 1;
            if (s.mode === 'dimensionnement' && coche('pac_ajuster')) {
                if (gammeCh && modeles.chaud) {
                    const cap = modeles.chaud.capaciteKw(tBase, dep.twBase, 80);
                    if (cap > 0) facteurChaud = ((gammeCh.min + gammeCh.max) / 2) / cap;
                }
                if (gammeFr && modeles.froid && pointeFroidKw > 0) {
                    const cap = modeles.froid.capaciteKw(tBaseEte, dep.departFroid, 50);
                    if (cap > 0) facteurFroid = ((gammeFr.min + gammeFr.max) / 2) / cap;
                }
                // PAC réversible : chaud et froid viennent de la MÊME machine — un seul facteur, celui
                // du chauffage, relevé si besoin pour couvrir aussi la pointe de froid.
                if (modeles.chaud && modeles.froid && gammeCh) {
                    const fFroidMin = gammeFr && pointeFroidKw > 0 ? gammeFr.min / Math.max(1e-9, modeles.froid.capaciteKw(tBaseEte, dep.departFroid, 50)) : 0;
                    facteurChaud = Math.max(facteurChaud, fFroidMin);
                    facteurFroid = facteurChaud;
                }
                if (facteurChaud !== 1 || facteurFroid !== 1) {
                    ['chaud', 'froid'].forEach((mode) => {
                        const f = mode === 'chaud' ? facteurChaud : facteurFroid;
                        if (f === 1) return;
                        document.querySelectorAll(`#pac_points_${mode} .pac-pt-p`).forEach((el) => {
                            const x = lireNombre(el.value);
                            if (x !== null) el.value = Math.round(x * f * 100) / 100;
                        });
                    });
                    modeles = construireModeles(s, perteLiaisons, 1, 1);
                }
            }

            // 3. Simulation avec l'équipement.
            const entree = {
                ...commun, usages: s.usages, chaud: modeles.chaud, froid: modeles.froid,
                appoint: { puissanceKw: s.appoint ? nombre('pac_appoint_kw') : 0, tBivalence: s.appoint ? nombre('pac_t_biv') : -99 },
                ecs: ecsSimulation(s, tMoyMens, tAn),
                aux: {
                    circulateurW: nombre('pac_aux_circ') ?? 0, veilleW: nombre('pac_aux_veille') ?? 0, carterW: nombre('pac_aux_carter') ?? 0,
                    carterSeuilC: nombre('pac_aux_carter_seuil') ?? 10, ventilateurW: nombre('pac_aux_vent') ?? 0, nbUnitesInterieures: nombre('pac_nb_unites') ?? 1,
                    horsTensionHorsSaison: coche('pac_aux_hors_saison'),
                },
            };
            const sim = S.simuler(entree);
            const syn = S.synthese(sim);

            resultat = {
                s, b, sim, syn, synBesoins, met, dep, tBase, tBaseEte, besoinBaseKw, pointeChaudDynKw, pointeFroidKw, gammeCh, gammeFr,
                modeles, perteLiaisons, facteurChaud, facteurFroid, ecs: entree.ecs, pas, annee, entree,
                site: adresseProjet(), altitudeSite: nombre('pac_altitude'),
            };
            resultat.entreesControle = entreesControleSimulation(resultat);
            afficherResultats();
            await transmettreCourbe();
            afficherCourbeSite();
            majSchema();
            majRentabilite();
            txt('pac_calcul_statut', `Calcul terminé (${fr(sim.eChauffage.length)} pas de ${pas} min).`);
            planifierSauvegarde();
            verifierSimulation(resultat);
            document.dispatchEvent(new CustomEvent('pacSimulationCalculee', { detail: { froid: !!s.usages.froid } }));
            majAlerteClimatisation();
        } catch (err) {
            console.error('[PAC] Erreur de calcul :', err);
            txt('pac_calcul_statut', '');
            message(err.message || 'Le calcul a échoué.', 'error', 6000);
        } finally {
            calculEnCours = false;
            majEtatValidation();
        }
    }

    function invaliderResultats() {
        if (!resultat) return;
        resultat = null;
        jetonControle++;
        txt('pac_verif_statut', '');
        afficher('pac_resultats', false);
        txt('pac_calcul_statut', 'Saisies modifiées : relancez le calcul.');
        majSchema();
        chargerInfoCouplage();
        document.dispatchEvent(new CustomEvent('pacSimulationCalculee', { detail: { froid: false } }));
        majAlerteClimatisation();
    }

    // ---------------------------------------------------------------------------------------
    // Affichage des résultats
    // ---------------------------------------------------------------------------------------
    function ligne(grandeur, valeur, detail) {
        return `<tr><td>${grandeur}</td><td><strong>${valeur}</strong></td><td style="text-align:left; white-space:normal;">${detail || ''}</td></tr>`;
    }

    function afficherResultats() {
        const r = resultat;
        const s = r.s;
        afficher('pac_resultats', true);
        const lignes = [];
        const alertes = [];
        if (avecEspace(s)) {
            lignes.push(ligne('Coefficient de déperdition H', `${fr(r.b.H, 0)} W/K`, `Volume ${fr(r.b.volume, 0)} m³ — G = ${fr(r.b.H / r.b.volume, 2)} W/(m³·K) — parois opaques ${fr(r.b.hTrOp, 0)} W/K, vitrages ${fr(r.b.hTrW, 0)} W/K, renouvellement d'air ${fr(r.b.hVe, 0)} W/K.`));
            lignes.push(ligne('Modèle thermique', 'Dynamique 5R1C', `Air, parois et masse ; température ressentie régulée. Inertie : ${echapper(B.trouver(ref.bat.inerties.classes, val('pac_inertie'))?.libelle || '')}${r.b.pieces ? '' : ' ; déperditions réparties à partir de G'}.`));
        }
        if (s.usages.chauffage) {
            lignes.push(ligne('Puissance calorifique nécessaire à la température de base', `${fr(r.besoinBaseKw, 2)} kW`, `T base ${fr(r.tBase, 1)} °C, consigne ${fr(nombre('pac_cons_ch'), 1)} °C, sans apports (méthode conventionnelle).`));
            lignes.push(ligne('Pointe de chauffage simulée', `${fr(r.pointeChaudDynKw, 2)} kW`, 'Année type, apports et inertie compris, consigne constante (hors relance après le réduit).'));
            lignes.push(ligne('Gamme calorifique recommandée', `${fr(r.gammeCh.min, 1)} – ${fr(r.gammeCh.max, 1)} kW`, s.appoint ? "Avec appoint : 80 à 110 % du besoin à la température de base." : 'Sans appoint : 100 à 120 % du besoin à la température de base.'));
            if (r.modeles.chaud) {
                const cap = r.modeles.chaud.capaciteKw(r.tBase, r.dep.twBase, 80);
                const cop = r.modeles.chaud.rendement(r.tBase, r.dep.twBase, 80, 1);
                const pel = cop > 0 ? cap / cop : 0;
                const couv = r.besoinBaseKw > 0 ? cap / r.besoinBaseKw : null;
                lignes.push(ligne("Puissance de l'équipement à la température de base", `${fr(cap, 2)} kW`, `${s.systeme === 'air_air' ? 'Air intérieur' : 'Départ'} ${fr(r.dep.twBase, 1)} °C — COP ${fr(cop, 2)} — couverture ${couv !== null ? fr(100 * couv, 0) + ' %' : '--'}${r.facteurChaud !== 1 ? ` — puissances ajustées ×${fr(r.facteurChaud, 2)}` : ''}${s.split ? ` — liaisons −${fr(r.perteLiaisons, 1)} %` : ''}.`));
                lignes.push(ligne('Puissance électrique absorbée à la température de base', `${fr(pel, 2)} kW`, intensite(pel)));
                if (couv !== null && couv < 0.8 && !s.appoint) alertes.push("L'équipement couvre moins de 80 % du besoin à la température de base, sans appoint : risque d'inconfort par grand froid.");
            }
        }
        if (s.usages.froid) {
            lignes.push(ligne('Pointe de froid simulée', `${fr(r.pointeFroidKw, 2)} kW`, `Consigne ${fr(nombre('pac_cons_froid'), 1)} °C, apports solaires et internes compris (T base été ${fr(r.tBaseEte, 1)} °C).`));
            lignes.push(ligne('Gamme frigorifique recommandée', `${fr(r.gammeFr.min, 1)} – ${fr(r.gammeFr.max, 1)} kW`, '100 à 120 % de la pointe de froid simulée.'));
            if (r.modeles.froid) {
                const cap = r.modeles.froid.capaciteKw(r.tBaseEte, r.dep.departFroid, 50);
                const eer = r.modeles.froid.rendement(r.tBaseEte, r.dep.departFroid, 50, 1);
                lignes.push(ligne("Puissance frigorifique de l'équipement à la température de base été", `${fr(cap, 2)} kW`, `EER ${fr(eer, 2)} — puissance électrique ${fr(eer > 0 ? cap / eer : 0, 2)} kW${r.facteurFroid !== 1 ? ` — puissances ajustées ×${fr(r.facteurFroid, 2)}` : ''}.`));
            }
        }
        if (s.usages.ecs && r.ecs) {
            const tEf = r.ecs.eauFroideMensuelle;
            const jourMoy = tEf.reduce((acc, t) => acc + B.besoinEcsJourKwh(1, r.ecs.litresJour, r.ecs.tUsage, t, ref.ecs), 0) / 12;
            lignes.push(ligne("Besoin d'ECS", `${fr(jourMoy, 2)} kWh/j`, `${fr(r.ecs.litresJour, 0)} L/j à ${fr(r.ecs.tUsage)} °C, eau froide ${fr(Math.min(...tEf), 1)} à ${fr(Math.max(...tEf), 1)} °C — pertes du ballon ${fr(r.ecs.pertesKwh24h, 2)} kWh/24 h.`));
        }
        $('pac_dim_table').innerHTML = lignes.join('');

        // Déperditions par pièce (méthode détaillée)
        const piecesHtml = r.b.pieces ? `<h4 style="${STYLE_SOUS_TITRE}">Déperditions par pièce (température de base)</h4>
            <div style="overflow-x:auto;"><table class="pac-table"><thead><tr><th>Pièce</th><th>Surface (m²)</th><th>Transmission (W/K)</th><th>Renouvellement d'air (W/K)</th><th>Puissance (W)</th><th>W/m²</th></tr></thead><tbody>
            ${r.b.pieces.map((p) => { const w = p.H * ((nombre('pac_cons_ch') ?? 20) - r.tBase); return `<tr><td>${echapper(p.nom)}</td><td>${fr(p.surface, 1)}</td><td>${fr(p.hTr, 1)}</td><td>${fr(p.hVe, 1)}</td><td>${fr(w, 0)}</td><td>${fr(w / p.surface, 0)}</td></tr>`; }).join('')}
            </tbody></table></div>` : '';
        $('pac_pieces_resultat').innerHTML = piecesHtml;

        const y = r.syn;
        if (y.heuresInconfortChaud >= 1) alertes.push(`Température intérieure à plus de 1 °C sous la consigne pendant ${fr(y.heuresInconfortChaud, 0)} h dans l'année (hors 2 h de relance après un réduit) : puissance ou appoint insuffisants.`);
        if (y.heuresInconfortFroid >= 1) alertes.push(`Température intérieure à plus de 1 °C au-dessus de la consigne de rafraîchissement pendant ${fr(y.heuresInconfortFroid, 0)} h.`);
        if (y.heuresEcsInconfort > 0) alertes.push(`Eau chaude sous la température d'usage pendant ${fr(y.heuresEcsInconfort, 1)} h : augmentez le volume, la consigne ou la plage de production.`);
        if (s.usages.chauffage && r.dep.loi && nombre('pac_dep_base') > nombre('pac_tdep_max')) alertes.push("Départ demandé supérieur à la température d'eau maximale : départ plafonné.");
        const iDem = nombre('pac_i_dem'); const iNom = nombre('pac_i_nom');
        if (val('pac_alim') === 'mono' && iDem !== null && iNom !== null && iDem > 2 * iNom) alertes.push(`Intensité de démarrage ${fr(iDem, 1)} A, plus du double de l'intensité nominale : vérifiez le calibre de protection et le démarrage progressif.`);
        $('pac_dim_alertes').innerHTML = alertes.map((a) => `<div class="pac-alerte">${echapper(a)}</div>`).join('');

        // Tuiles et tableau annuel
        const tuiles = [
            ['Consommation annuelle', `${fr(y.eTotal, 0)} kWh`],
            ['Pointe électrique', `${fr(y.pointeKw, 2)} kW`],
        ];
        if (y.scopChauffage) tuiles.push(['SCOP simulé (chauffage)', `${fr(y.scopChauffage, 2)}${nombre('pac_scop') ? ` <span style="font-size:0.8rem; color:var(--text-secondary);">fiche : ${fr(nombre('pac_scop'), 2)}</span>` : ''}`]);
        if (y.seerSimule) tuiles.push(['SEER simulé', `${fr(y.seerSimule, 2)}${nombre('pac_seer') ? ` <span style="font-size:0.8rem; color:var(--text-secondary);">fiche : ${fr(nombre('pac_seer'), 2)}</span>` : ''}`]);
        if (y.couverturePac !== null) tuiles.push(['Chaleur fournie par la PAC', `${fr(100 * y.couverturePac, 1)} %`]);
        if (y.performanceGlobaleChaud) tuiles.push(['Performance globale (appoint et auxiliaires compris)', fr(y.performanceGlobaleChaud, 2)]);
        $('pac_tuiles').innerHTML = tuiles.map(([l, v]) => `<div class="pac-stat"><div class="pac-stat-label">${l}</div><div class="pac-stat-valeur">${v}</div></div>`).join('');
        const usages = Object.keys(LIBELLES_USAGES).filter((k) => y.annuel[k] > 0.05);
        $('pac_annuel_table').innerHTML = usages.map((k) => `<tr><td>${LIBELLES_USAGES[k]}</td><td>${fr(y.annuel[k], 0)}</td><td>${fr(y.eTotal > 0 ? 100 * y.annuel[k] / y.eTotal : 0, 1)} %</td></tr>`).join('')
            + `<tr style="font-weight:700;"><td>Total</td><td>${fr(y.eTotal, 0)}</td><td>100 %</td></tr>`;

        dessinerMensuel();
        const jourInput = $('pac_jour');
        jourInput.min = `${r.annee}-01-01`;
        jourInput.max = `${r.annee}-12-31`;
        if (!jourInput.value || !jourInput.value.startsWith(String(r.annee))) jourInput.value = dateDuJour(indiceJourExtreme('froid'));
        dessinerJour();
    }

    function intensite(pElecKw) {
        const tri = val('pac_alim') === 'tri';
        const cosPhi = 0.95; // hypothèse : compresseur à vitesse variable (correction du facteur de puissance)
        const i = tri ? pElecKw * 1000 / (Math.sqrt(3) * 400 * cosPhi) : pElecKw * 1000 / (230 * cosPhi);
        const iNom = nombre('pac_i_nom');
        return `Intensité estimée ${fr(i, 1)} A ${tri ? 'par phase (400 V)' : '(230 V)'}, cos φ ${fr(cosPhi, 2)}${iNom ? ` — fiche : ${fr(iNom, 1)} A` : ''}${nombre('pac_p_abs') ? ` — puissance absorbée nominale de la fiche : ${fr(nombre('pac_p_abs'), 2)} kW` : ''}.`;
    }

    function detruireGraph(cle) { if (graphs[cle]) { graphs[cle].destroy(); graphs[cle] = null; } }

    function dessinerMensuel() {
        if (typeof Chart === 'undefined') return;
        const y = resultat.syn;
        detruireGraph('mensuel');
        const usages = Object.keys(LIBELLES_USAGES).filter((k) => y.annuel[k] > 0.05);
        graphs.mensuel = new Chart($('pac_graph_mensuel'), {
            type: 'bar',
            data: { labels: MOIS, datasets: usages.map((k) => ({ label: LIBELLES_USAGES[k], data: y.mensuel[k].map((x) => Math.round(x * 10) / 10), backgroundColor: COULEURS[k], stack: 'u', borderRadius: 3 })) },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { datalabels: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label} : ${fr(c.parsed.y, 0)} kWh` } } },
                scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'kWh' } } },
            },
        });
    }

    function joursGrille() { return S.calendrier(resultat.annee); }
    function dateDuJour(d) {
        const j = joursGrille()[d];
        const p = (x) => String(x).padStart(2, '0');
        return `${resultat.annee}-${p(j.mois + 1)}-${p(j.jour)}`;
    }
    function indiceDepuisDate(iso) {
        const [, m, j] = iso.split('-').map(Number);
        const idx = joursGrille().findIndex((x) => x.mois === m - 1 && x.jour === j);
        return idx >= 0 ? idx : 0;
    }
    function indiceJourExtreme(sens) {
        const t = resultat.met.temperature;
        const parJour = 1440 / resultat.pas;
        let meilleur = 0; let valeur = sens === 'froid' ? Infinity : -Infinity;
        for (let d = 0; d < 365; d++) {
            let s = 0;
            for (let k = 0; k < parJour; k++) s += t[d * parJour + k];
            const m = s / parJour;
            if (sens === 'froid' ? m < valeur : m > valeur) { valeur = m; meilleur = d; }
        }
        return meilleur;
    }

    function dessinerJour() {
        if (!resultat || typeof Chart === 'undefined') return;
        const r = resultat;
        const d = indiceDepuisDate(val('pac_jour'));
        const parJour = 1440 / r.pas;
        const debut = d * parJour;
        const etiquettes = Array.from({ length: parJour }, (_, k) => { const m = k * r.pas; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });
        const usages = Object.keys(LIBELLES_USAGES).filter((k) => r.syn.annuel[k] > 0.05);
        const tranche = (arr) => Array.from(arr.slice(debut, debut + parJour)).map((x) => Math.round(x * 1000) / 1000);
        const totalJour = usages.reduce((acc, k) => acc + tranche(r.sim[k]).reduce((a, x) => a + x, 0) * r.pas / 60, 0);
        txt('pac_jour_total', `Consommation du jour : ${fr(totalJour, 2)} kWh`);
        detruireGraph('jour');
        graphs.jour = new Chart($('pac_graph_jour'), {
            type: 'bar',
            data: {
                labels: etiquettes,
                datasets: usages.map((k) => ({ label: LIBELLES_USAGES[k], data: tranche(r.sim[k]), backgroundColor: COULEURS[k], stack: 'u', yAxisID: 'y' }))
                    .concat([
                        { type: 'line', label: 'Température extérieure (°C)', data: tranche(r.met.temperature), borderColor: '#0891b2', borderWidth: 2, pointRadius: 0, yAxisID: 'y2' },
                        { type: 'line', label: 'Température intérieure (°C)', data: tranche(r.sim.tAir), borderColor: '#16a34a', borderWidth: 2, pointRadius: 0, borderDash: [4, 3], yAxisID: 'y2' },
                    ]),
            },
            options: {
                responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                plugins: { datalabels: { display: false } },
                scales: {
                    x: { stacked: true, ticks: { maxTicksLimit: 12 } },
                    y: { stacked: true, title: { display: true, text: 'Puissance électrique (kW)' } },
                    y2: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '°C' } },
                },
            },
        });
    }

    // ---------------------------------------------------------------------------------------
    // Exports
    // ---------------------------------------------------------------------------------------
    function reechantillonner(valeurs, pasSource, pasCible) {
        if (typeof window.reechantillonnerPuissances === 'function') return window.reechantillonnerPuissances(Array.from(valeurs), pasSource, pasCible);
        if (pasSource === pasCible) return Array.from(valeurs);
        return null;
    }

    function exporterCourbe(pasCible) {
        if (!resultat) return;
        if (typeof XLSX === 'undefined') { message("Export indisponible : bibliothèque de tableur non chargée.", 'error'); return; }
        const r = resultat;
        const cols = ['eChauffage', 'eFroid', 'eEcs', 'eAppoint', 'eAuxiliaires'];
        const series = cols.map((k) => reechantillonner(r.sim[k], r.pas, pasCible));
        if (series.some((x) => !x)) { message("Rééchantillonnage indisponible pour ce pas.", 'error'); return; }
        const tExt = reechantillonner(r.met.temperature, r.pas, pasCible);
        const tInt = reechantillonner(r.sim.tAir, r.pas, pasCible);
        const nb = series[0].length;
        const dates = typeof window.datesCourbeAnnuelle === 'function' ? window.datesCourbeAnnuelle(r.annee, pasCible, nb) : Array.from({ length: nb }, (_, i) => i);
        const id = [val('pac_marque'), val('pac_modele'), val('pac_reference')].filter(Boolean).join(' ');
        const lignes = [
            ['Consommation électrique simulée PAC / climatiseur'],
            ['Année :', r.annee, 'Pas de temps :', `${pasCible} minutes`, 'Heure murale, 365 jours'],
            ['Équipement :', id || '—', 'Consommation annuelle (kWh) :', Math.round(r.syn.eTotal * 10) / 10],
            ['Date', 'Chauffage PAC (kW)', 'Climatisation (kW)', 'ECS PAC (kW)', 'Appoint électrique (kW)', 'Auxiliaires (kW)', 'Total PAC (kW)', 'T extérieure (°C)', 'T intérieure (°C)'],
        ];
        for (let i = 0; i < nb; i++) {
            const v = series.map((sr) => sr[i]);
            lignes.push([dates[i], ...v, v.reduce((a, x) => a + x, 0), tExt[i], tInt[i]]);
        }
        const ws = XLSX.utils.aoa_to_sheet(lignes);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Conso_PAC_${pasCible}min`);
        XLSX.writeFile(wb, `Consommation_PAC_${pasCible}min.xlsx`);
        message(`Export de la courbe PAC au pas de ${pasCible} min (${fr(nb)} points).`, 'info', 3000);
    }

    function lireConfiguration() {
        const champs = {};
        document.querySelectorAll('#pac-section-content input[id^="pac_"], #pac-section-content select[id^="pac_"], #pac-section-content input[id^="pacr_"], #pac-section-content select[id^="pacr_"]').forEach((el) => {
            if (el.type === 'file') return;
            champs[el.id] = el.type === 'checkbox' ? el.checked : el.value;
        });
        return { format: 'pac_climatisation', version: VERSION_CONFIG, champs, pieces: lirePieces(), points_chaud: lirePoints('chaud'), points_froid: lirePoints('froid') };
    }

    function exporterConfiguration() {
        const blob = new Blob([JSON.stringify(lireConfiguration(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `configuration_pac_${(val('pac_modele') || 'equipement').replace(/[^\w-]+/g, '_')}.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    }

    /**
     * Retire d'une configuration (import ou restauration) les valeurs hors limites : nombre hors des
     * bornes de REGLES / REGLES_ECO, champ obligatoire vide, pièce hors BORNES_PIECE. Le champ garde
     * alors sa valeur actuelle. Renvoie la configuration nettoyée et les libellés rejetés.
     */
    function assainirConfiguration(cfg) {
        const rejetes = [];
        const champs = { ...cfg.champs };
        Object.keys(champs).forEach((id) => {
            const r = REGLE[id] || REGLE_ECO[id];
            if (!r) return;
            const brut = champs[id];
            if (brut === '' || brut === null || brut === undefined) {
                if (!r.facultatif) delete champs[id];
                return;
            }
            const v = lireNombre(brut);
            if (v === null || v < r.min || v > r.max || (r.entier && !Number.isInteger(v))) {
                rejetes.push(r.libelle);
                delete champs[id];
            }
        });
        const dans = (v, [mn, mx]) => Number.isFinite(v) && v >= mn && v <= mx;
        const pieces = (Array.isArray(cfg.pieces) ? cfg.pieces : []).filter((pc) => {
            const ok = pc && dans(pc.surface, BORNES_PIECE.surface) && dans(pc.hauteur, BORNES_PIECE.hauteur)
                && dans(pc.vitragePct, BORNES_PIECE.vitrage)
                && (pc.facades || []).every((f) => !f || !f.longueur || dans(f.longueur, BORNES_PIECE.longueur));
            if (!ok) rejetes.push(`pièce « ${pc && pc.nom ? String(pc.nom).slice(0, 40) : '?'} »`);
            return ok;
        }).slice(0, 50);
        const points = (liste) => (Array.isArray(liste) ? liste : []).filter((pt) => pt && typeof pt === 'object').slice(0, 20);
        return { cfg: { ...cfg, champs, pieces, points_chaud: points(cfg.points_chaud), points_froid: points(cfg.points_froid) }, rejetes };
    }

    function appliquerConfiguration(cfgBrute) {
        if (!cfgBrute || cfgBrute.format !== 'pac_climatisation' || !cfgBrute.champs) throw new Error("Ce fichier n'est pas une configuration PAC.");
        const { cfg, rejetes } = assainirConfiguration(cfgBrute);
        const ordre = ['pac_type', 'pac_reversible'];
        const appliquer = (id) => {
            const el = $(id); if (!el || !(id in cfg.champs)) return;
            if (el.type === 'checkbox') { el.checked = !!cfg.champs[id]; return; }
            // Liste : seulement une option existante (sinon la liste resterait vide).
            if (el.tagName === 'SELECT' && !Array.from(el.options).some((o) => o.value === String(cfg.champs[id]))) { rejetes.push(id); return; }
            el.value = cfg.champs[id];
        };
        ordre.forEach(appliquer);
        majListes();
        appliquer('pac_usage');
        majListes();
        Object.keys(cfg.champs).filter((id) => !ordre.includes(id)).forEach(appliquer);
        if ('pacr_capex_materiel' in cfg.champs && $('pacr_capex_materiel')) $('pacr_capex_materiel').dataset.saisi = '1';
        const alt = $('pac_altitude');
        if (lireNombre(cfg.champs.pac_altitude) !== null) { alt.dataset.saisi = '1'; delete alt.dataset.auto; txt('pac_altitude_source', 'Altitude de la configuration importée.'); }
        else { delete alt.dataset.saisi; delete alt.dataset.auto; remplirAltitude(); }
        $('pac_pieces').innerHTML = '';
        (cfg.pieces || []).forEach((p) => ajouterPiece(p));
        remplirPoints('chaud', cfg.points_chaud || []);
        remplirPoints('froid', cfg.points_froid || []);
        majZone();
        majDetailG();
        majEstimationLiaisons();
        majVisibilite();
        invaliderResultats();
        majEtatValidation();
        planifierSauvegarde();
        return rejetes;
    }

    // ---------------------------------------------------------------------------------------
    // Phase 2 : transmission à l'autoconsommation, courbe de charge du site
    // ---------------------------------------------------------------------------------------
    const projetActifId = () => localStorage.getItem('current_projet_id');
    const USAGES_ELEC = ['eChauffage', 'eFroid', 'eEcs', 'eAppoint', 'eAuxiliaires'];

    /** Puissance électrique totale de la PAC par pas (kW), arrondie au dix-millième. */
    function seriePac(sim) {
        const n = sim.eChauffage.length;
        const sortie = new Array(n);
        for (let i = 0; i < n; i++) {
            let t = 0;
            USAGES_ELEC.forEach((k) => { t += sim[k][i]; });
            sortie[i] = Math.round(t * 10000) / 10000;
        }
        return sortie;
    }
    const energieKwh = (serie, pas) => serie.reduce((a, v) => a + v, 0) * pas / 60;

    async function transmettreCourbe() {
        const r = resultat;
        const projetId = projetActifId();
        if (!r) return;
        if (!projetId) { txt('pac_sync_statut', '❌ Aucun projet actif : la courbe ne peut pas être transmise à l\'autoconsommation.'); return; }
        const pac = seriePac(r.sim);
        const corps = {
            pas_temps_min: r.pas,
            annee: r.annee,
            pac,
            bilan_pac_kwh: energieKwh(pac, r.pas),
            resume: {
                equipement: [val('pac_marque'), val('pac_modele'), val('pac_reference')].filter(Boolean).join(' ').slice(0, 200),
                type: r.s.type,
                usages_kwh: Object.fromEntries(USAGES_ELEC.map((k) => [k, Math.round(r.syn.annuel[k] * 100) / 100])),
                pointe_kw: Math.round(r.syn.pointeKw * 1000) / 1000,
                plage_ecs: r.s.usages.ecs ? r.s.plageEcs : null,
                froid: !!r.s.usages.froid,
            },
        };
        // Variante « ECS aux heures solaires » : même configuration, seule la plage ECS change.
        if (r.s.usages.ecs && r.s.plageEcs !== 'solaire' && coche('pac_ecs_gain')) {
            const variante = seriePac(S.simuler({ ...r.entree, ecs: { ...r.entree.ecs, plage: PLAGE_ECS_SOLAIRE } }));
            corps.pac_ecs_solaire = variante;
            corps.bilan_pac_ecs_solaire_kwh = energieKwh(variante, r.pas);
        }
        txt('pac_sync_statut', 'Transmission de la courbe à l\'autoconsommation…');
        try {
            const rep = await fetch(`${URL_PROJET(projetId)}/pac/save-curve`, {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
            });
            const json = await rep.json().catch(() => ({}));
            if (!rep.ok || !json.success) throw new Error(json.message || `HTTP ${rep.status}`);
            document.dispatchEvent(new CustomEvent('pacCourbeEnregistree', { detail: { bilanKwh: corps.bilan_pac_kwh } }));
        } catch (err) {
            const el = $('pac_sync_statut');
            if (el) { el.textContent = `❌ Échec de la transmission à l'autoconsommation (${err.message}).`; el.style.color = '#dc2626'; }
            return;
        }
        await chargerInfoCouplage();
    }

    async function chargerInfoCouplage() {
        await lireInfoCouplage();
        majRentabilite();
    }

    async function lireInfoCouplage() {
        const projetId = projetActifId();
        const statut = $('pac_sync_statut');
        const resume = $('pac_autoconso_resume');
        if (!statut || !projetId) return;
        try {
            const rep = await fetch(`${URL_PROJET(projetId)}/pac/curve-info`, { credentials: 'same-origin' });
            const json = await rep.json();
            const c = json.success ? json.courbe : null;
            infoCouplage = c;
            if (!c) {
                statut.textContent = 'Aucune courbe transmise à l\'autoconsommation.';
                statut.style.color = '';
                resume.innerHTML = '';
                return;
            }
            const date = c.enregistre_le ? new Date(c.enregistre_le).toLocaleString('fr-FR') : '--';
            statut.textContent = `✅ Courbe transmise le ${date} : ${fr(c.bilan_pac_kwh, 0)} kWh/an au pas de ${c.pas_temps_min} min${c.variante_ecs_solaire ? ', avec la variante « ECS aux heures solaires »' : ''}.`
                + (resultat ? '' : ' Les saisies ont changé depuis : relancez le calcul pour la mettre à jour.');
            statut.style.color = resultat ? 'var(--success-color, #16a34a)' : '#b45309';
            const a = c.autoconso_pac;
            if (!a) {
                resume.innerHTML = `<p style="${STYLE_AIDE}">Pas encore de calcul d'autoconsommation avec cette courbe.</p>`;
                return;
            }
            const regles = { existante: 'priorité à la consommation existante', irve: 'priorité à la recharge IRVE', pac: 'priorité à la PAC', none: 'partage au prorata', ordre: 'ordre personnalisé' };
            const tuiles = [
                ['PV consommé par la PAC', `${fr(a.pv_pac_kwh, 0)} kWh`],
                ['Autoproduction de la PAC', a.autoproduction_pac == null ? '--' : `${fr(a.autoproduction_pac, 1)} %`],
                ['Achat au réseau (PAC)', `${fr(a.reseau_pac_kwh, 0)} kWh`],
            ];
            const g = a.gain_ecs_solaire;
            if (g) tuiles.push(['ECS aux heures solaires : achat réseau évité', `${fr(g.gain_reseau_kwh, 0)} kWh`]);
            resume.innerHTML = `<div class="pac-stats">${tuiles.map(([l, v]) => `<div class="pac-stat"><div class="pac-stat-label">${l}</div><div class="pac-stat-valeur">${v}</div></div>`).join('')}</div>
                <p style="${STYLE_AIDE}">Calcul du ${a.calcule_le ? new Date(a.calcule_le).toLocaleString('fr-FR') : '--'}${a.kwc ? `, ${fr(a.kwc, 2)} kWc` : ''}, ${regles[a.regle] || a.regle}.
                ${g ? `Variante ECS 11 h – 16 h : PV consommé par la PAC ${fr(g.pac_base.pv_kwh, 0)} → ${fr(g.pac_solaire.pv_kwh, 0)} kWh, autoconsommation globale ${fr(g.autoconsommation_base, 1)} → ${fr(g.autoconsommation_solaire, 1)} %.` : ''}</p>`;
        } catch (err) {
            infoCouplage = null;
            statut.textContent = 'Lecture de la courbe transmise impossible.';
        }
    }

    async function supprimerCourbeTransmise() {
        const projetId = projetActifId();
        if (!projetId) return;
        try {
            const rep = await fetch(`${URL_PROJET(projetId)}/pac/curve`, { method: 'DELETE', credentials: 'same-origin' });
            const json = await rep.json().catch(() => ({}));
            if (!rep.ok || !json.success) throw new Error(json.message || `HTTP ${rep.status}`);
            message('Courbe PAC retirée de l\'autoconsommation.', 'info', 3000);
        } catch (err) {
            message(`Suppression impossible (${err.message}).`, 'error', 5000);
        }
        await chargerInfoCouplage();
    }

    /**
     * Consommation existante et IRVE au pas et sur la grille de la simulation PAC : courbe calculée
     * dans cette session (window.irveCourbeAnnuelle) ou, à défaut, enregistrée en base.
     */
    async function courbeIrveSite() {
        let c = window.irveCourbeAnnuelle && Array.isArray(window.irveCourbeAnnuelle.irve)
            ? { existing: window.irveCourbeAnnuelle.existing, irve: window.irveCourbeAnnuelle.irve, pas: window.irveCourbeAnnuelle.pasTempsMin, annee: window.irveCourbeAnnuelle.annee, source: 'session' }
            : null;
        const projetId = projetActifId();
        if (!c && projetId) {
            try {
                const rep = await fetch(`${URL_PROJET(projetId)}/irve/load`, { credentials: 'same-origin' });
                const json = await rep.json();
                const lc = json.success && json.config_exists ? json.config.load_curve : null;
                if (lc && Array.isArray(lc.irve) && lc.irve.length) c = { existing: lc.existing, irve: lc.irve, pas: lc.pas_temps_min || 60, annee: lc.annee, source: 'base' };
            } catch (e) { /* pas de courbe IRVE */ }
        }
        if (!c) return null;
        const existing = reechantillonner(c.existing || [], c.pas, resultat.pas);
        const irve = reechantillonner(c.irve, c.pas, resultat.pas);
        if (!existing || !irve) return null;
        return { existing, irve, annee: c.annee, source: c.source };
    }

    let courbeSite = null;

    async function afficherCourbeSite() {
        if (!resultat) return;
        const pac = seriePac(resultat.sim);
        const ir = await courbeIrveSite();
        const n = pac.length;
        const existing = ir ? ir.existing : new Array(n).fill(0);
        const irve = ir ? ir.irve : new Array(n).fill(0);
        const total = pac.map((v, i) => v + (existing[i] || 0) + (irve[i] || 0));
        courbeSite = { pac, existing, irve, total, avecIrve: !!ir };
        let iMax = 0;
        total.forEach((v, i) => { if (v > total[iMax]) iMax = i; });
        const parJour = 1440 / resultat.pas;
        const jour = S.calendrier(resultat.annee)[Math.floor(iMax / parJour)];
        const minute = (iMax % parJour) * resultat.pas;
        const quand = `${String(jour.jour).padStart(2, '0')}/${String(jour.mois + 1).padStart(2, '0')} à ${String(Math.floor(minute / 60)).padStart(2, '0')}h${String(minute % 60).padStart(2, '0')}`;
        const souscrite = lireNombre(document.getElementById('puissance_souscrite')?.value);
        const cosPhi = 0.95; // hypothèse pour convertir la pointe active (kW) en puissance apparente (kVA)
        const pointeKva = total[iMax] / cosPhi;
        txt('pac_site_source', ir
            ? `Consommation existante et IRVE : courbe ${ir.source === 'session' ? 'calculée dans cette session' : 'enregistrée'} par la section « Borne de recharge »${ir.annee && ir.annee !== resultat.annee ? ` (année ${ir.annee}, différente de l'année de la simulation PAC ${resultat.annee})` : ''}.`
            : 'Aucune courbe IRVE / consommation existante enregistrée : seule la PAC est représentée. Lancez « calculer la consommation » dans « Borne de recharge » pour l\'ajouter.');
        const tuiles = [
            ['Pointe simultanée du site', `${fr(total[iMax], 2)} kW`, `le ${quand}`],
            ['Part de la PAC à cette pointe', `${fr(pac[iMax], 2)} kW`, ''],
        ];
        if (souscrite) {
            const depasse = pointeKva > souscrite;
            tuiles.push(['Puissance souscrite', `${fr(souscrite, 1)} kVA`, depasse
                ? `<span style="color:#dc2626;">Dépassée : pointe ≈ ${fr(pointeKva, 1)} kVA (cos φ ${fr(cosPhi, 2)})</span>`
                : `Respectée : pointe ≈ ${fr(pointeKva, 1)} kVA (cos φ ${fr(cosPhi, 2)})`]);
        }
        $('pac_site_tuiles').innerHTML = tuiles.map(([l, v, d]) => `<div class="pac-stat"><div class="pac-stat-label">${l}</div><div class="pac-stat-valeur">${v}</div>${d ? `<div style="font-size:0.78rem; margin-top:0.25rem;">${d}</div>` : ''}</div>`).join('');
        dessinerSite();
    }

    function dessinerSite() {
        if (!resultat || !courbeSite || typeof Chart === 'undefined') return;
        const parJour = 1440 / resultat.pas;
        const debut = indiceDepuisDate(val('pac_jour')) * parJour;
        const tranche = (arr) => arr.slice(debut, debut + parJour).map((x) => Math.round(x * 1000) / 1000);
        const etiquettes = Array.from({ length: parJour }, (_, k) => { const m = k * resultat.pas; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });
        const souscrite = lireNombre(document.getElementById('puissance_souscrite')?.value);
        const jeux = [
            { label: 'Consommation existante (kW)', data: tranche(courbeSite.existing), backgroundColor: COULEURS_SITE.existant, stack: 's' },
            { label: 'Recharge IRVE (kW)', data: tranche(courbeSite.irve), backgroundColor: COULEURS_SITE.irve, stack: 's' },
            { label: 'PAC / climatisation (kW)', data: tranche(courbeSite.pac), backgroundColor: COULEURS_SITE.pac, stack: 's' },
            { type: 'line', label: 'Consommation totale (kW)', data: tranche(courbeSite.total), borderColor: '#111827', borderWidth: 2, pointRadius: 0 },
        ];
        if (souscrite) jeux.push({ type: 'line', label: 'Puissance souscrite (kVA)', data: new Array(parJour).fill(souscrite), borderColor: 'red', borderDash: [5, 5], borderWidth: 2, pointRadius: 0 });
        detruireGraph('site');
        graphs.site = new Chart($('pac_graph_site'), {
            type: 'bar',
            data: { labels: etiquettes, datasets: jeux },
            options: {
                responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                plugins: { datalabels: { display: false } },
                scales: { x: { stacked: true, ticks: { maxTicksLimit: 12 } }, y: { stacked: true, title: { display: true, text: 'Puissance (kW)' } } },
            },
        });
    }

    /** Export au format d'import de l'autoconsommation : existant, IRVE, PAC, total (heure murale). */
    function exporterCourbeSite(pasCible) {
        if (!resultat || !courbeSite) return;
        if (typeof XLSX === 'undefined') { message("Export indisponible : bibliothèque de tableur non chargée.", 'error'); return; }
        const pas = pasCible === 'natif' ? resultat.pas : Number(pasCible);
        const series = ['existing', 'irve', 'pac'].map((k) => reechantillonner(courbeSite[k], resultat.pas, pas));
        if (series.some((x) => !x)) { message("Rééchantillonnage indisponible pour ce pas.", 'error'); return; }
        const nb = series[0].length;
        const dates = typeof window.datesCourbeAnnuelle === 'function' ? window.datesCourbeAnnuelle(resultat.annee, pas, nb) : Array.from({ length: nb }, (_, i) => i);
        const lignes = [
            ['Courbe de charge du site : consommation existante, recharge IRVE, PAC / climatisation'],
            ['Année de simulation:', resultat.annee, 'Pas de temps:', `${pas} minutes`],
            ['Consommation PAC annuelle (bilan du module PAC, kWh):', energieKwh(seriePac(resultat.sim), resultat.pas)],
            ['Date', 'Conso. Existant (kW)', 'Conso. IRVE (kW)', 'Conso. PAC / climatisation (kW)', 'Conso. Totale (kW)'],
        ];
        for (let i = 0; i < nb; i++) {
            const [e, r, p] = series.map((sr) => sr[i]);
            lignes.push([dates[i], e, r, p, e + r + p]);
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lignes), `Site_${pas}min`);
        XLSX.writeFile(wb, `Courbe_charge_site_PAC_${pas}min.xlsx`);
        message(`Export de la courbe du site au pas de ${pas} min (${fr(nb)} points).`, 'info', 3000);
    }

    // ---------------------------------------------------------------------------------------
    // Phase 3 : schéma de principe
    // ---------------------------------------------------------------------------------------
    function configurationSchema() {
        const s = etat();
        const em = (id) => { const e = emetteur(val(id)); return e ? { id: e.id, libelle: e.libelle } : null; };
        let capaciteKw = null;
        if (resultat && resultat.modeles.chaud && s.usages.chauffage) capaciteKw = resultat.modeles.chaud.capaciteKw(resultat.tBase, resultat.dep.twBase, 80);
        return {
            type: s.type,
            libelleType: (B.trouver(ref.equip.types, s.type) || {}).libelle,
            split: s.split,
            usages: s.usages,
            emetteurChaud: s.usages.chauffage ? em('pac_emetteur_chaud') : null,
            emetteurFroid: s.usages.froid ? em('pac_emetteur_froid') : null,
            nbUnites: nombre('pac_nb_unites'),
            appoint: { actif: s.appoint, kw: nombre('pac_appoint_kw'), tBiv: nombre('pac_t_biv') },
            liaison: { longueur: nombre('pac_liaison_long'), denivele: nombre('pac_liaison_deniv'), diametres: val('pac_liaison_diam') },
            ecs: { volume: nombre('pac_ecs_volume'), consigne: nombre('pac_ecs_consigne'), resistanceKw: nombre('pac_ecs_res') },
            departBase: avecEau(s) ? nombre('pac_dep_base') : null,
            departFroid: avecEau(s) ? nombre('pac_dep_froid') : null,
            alim: val('pac_alim'),
            capaciteKw,
        };
    }

    function majSchema() {
        const hote = $('pac_schema');
        if (!hote || !SCH) return;
        try {
            hote.innerHTML = SCH.svg(configurationSchema());
        } catch (err) {
            console.error('[PAC] Schéma :', err);
            hote.innerHTML = '';
        }
    }

    function telechargerSchema() {
        const svg = SCH.svg(configurationSchema());
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        a.download = `schema_principe_${val('pac_type') || 'pac'}.svg`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    }

    // ---------------------------------------------------------------------------------------
    // Phase 3 : étude de rentabilité
    // ---------------------------------------------------------------------------------------
    let infoCouplage = null;
    let rentabilite = null;
    let minuterieEco = null;

    function systemeReference() {
        return B.trouver(ref.eco.systemes_chauffage, val('pacr_ref_ch')) || ref.eco.systemes_chauffage[0];
    }

    function etatEco() {
        const s = etat();
        const chaleur = s.usages.chauffage || s.usages.ecs;
        const sys = systemeReference();
        const energie = chaleur ? sys.energie : 'elec';
        return {
            s, sys, chaleur,
            gaz: energie === 'gaz',
            fioul: energie === 'fioul',
            ecsChaudiere: s.usages.ecs && energie !== 'elec' && val('pacr_ref_ecs') !== 'electrique',
            froid: s.usages.froid ? (val('pacr_ref_froid') || 'exclu') : 'exclu',
            tarif: PLAGES_TARIF[val('pacr_tarif')] ? val('pacr_tarif') : 'C5_HPHC',
            pv: coche('pacr_pv') && pvCouplage().pvKwh !== null,
        };
    }

    const formatDefaut = (v) => (Number.isFinite(Number(v)) ? String(Math.round(Number(v) * 1000) / 1000) : '');

    /** Remplit les champs de l'étude par leurs valeurs par défaut (tous, ou seulement `ids`). */
    function appliquerDefautsEco(ids) {
        REGLES_ECO.forEach((r) => {
            if (ids && !ids.includes(r.id)) return;
            const el = $(r.id);
            if (el) { el.value = formatDefaut(r.def()); delete el.dataset.saisi; }
        });
    }

    /**
     * PV consommé par la PAC d'après le dernier calcul d'autoconsommation, seulement s'il porte sur la
     * courbe du calcul affiché (bilan identique) ; sinon null et la raison.
     */
    function pvCouplage() {
        if (!resultat) return { pvKwh: null, raison: '' };
        const c = infoCouplage;
        const a = c && c.autoconso_pac;
        if (!a) return { pvKwh: null, raison: "Pas encore de calcul d'autoconsommation avec cette courbe : dans l'autoconsommation individuelle, cochez « Ajouter la consommation PAC / climatiseur » puis calculez, et cliquez sur « Actualiser » ci-dessus." };
        const bilan = energieKwh(seriePac(resultat.sim), resultat.pas);
        const memeCourbe = Math.abs(Number(c.bilan_pac_kwh) - bilan) <= Math.max(0.5, bilan * 1e-4)
            && Math.abs(Number(a.conso_pac_kwh) - bilan) <= Math.max(1, bilan * 0.01);
        if (!memeCourbe) return { pvKwh: null, raison: "Le dernier calcul d'autoconsommation porte sur une autre courbe PAC : relancez-le." };
        return { pvKwh: Math.max(0, Number(a.pv_pac_kwh) || 0), raison: '', kwc: a.kwc, le: a.calcule_le };
    }

    function majVisibiliteEco() {
        const e = etatEco();
        afficherChamp('pacr_ref_ch', e.chaleur);
        afficherChamp('pacr_ref_ecs', e.s.usages.ecs && e.sys.energie !== 'elec');
        afficherChamp('pacr_ref_froid', !!e.s.usages.froid);
        afficherChamp('pacr_resil_gaz', e.gaz);
        REGLES_ECO.forEach((r) => { if (r.quand) afficherChamp(r.id, !!r.quand(e)); });
        const pv = pvCouplage();
        const casePv = $('pacr_pv');
        if (casePv) casePv.disabled = pv.pvKwh === null;
        txt('pacr_pv_statut', pv.pvKwh === null ? pv.raison
            : `PV consommé par la PAC : ${fr(pv.pvKwh, 0)} kWh/an (calcul d'autoconsommation du ${pv.le ? new Date(pv.le).toLocaleString('fr-FR') : '--'}${pv.kwc ? `, ${fr(pv.kwc, 2)} kWc` : ''}).`);
        const R = window.RentabiliteIrveCalculs;
        const config = configHoraire();
        const hc = config ? config.hc_hours.map((x, h) => (x ? h : null)).filter((h) => h !== null) : [];
        txt('pacr_hc_info', e.tarif === 'C5_HPHC'
            ? (R && hc.length ? `Heures creuses retenues : ${hc.map((h) => `${h} h`).join(', ')} (réglage de la rentabilité IRVE, sinon plages par défaut). Le chauffe-eau électrique de référence chauffe en heures creuses.` : 'Heures creuses indisponibles : choisissez l\'option Base.')
            : '');
        return e;
    }

    function configHoraire() {
        const R = window.RentabiliteIrveCalculs;
        if (!R) return null;
        const h = window.horoConfig;
        return h && Array.isArray(h.hc_hours) && h.hc_hours.length === 24
            ? h : { hc_hours: R.friseHcDefaut(), pointe_hours: R.frisePointeDefaut() };
    }

    function violationsEco(e) {
        const liste = [];
        REGLES_ECO.forEach((r) => {
            if (r.quand && !r.quand(e)) return;
            const el = $(r.id);
            if (!el) return;
            const v = lireNombre(el.value);
            if (v === null) liste.push({ el, message: `${r.libelle} : valeur obligatoire. ${plage(r)}` });
            else if (v < r.min || v > r.max) liste.push({ el, message: `${r.libelle} : ${fr(v, 2)} hors plage. ${plage(r)}` });
            else if (r.entier && !Number.isInteger(v)) liste.push({ el, message: `${r.libelle} : nombre entier attendu.` });
        });
        if (e.tarif === 'C5_HPHC' && !window.RentabiliteIrveCalculs) liste.push({ el: $('pacr_tarif'), message: 'Heures creuses indisponibles : choisissez l\'option Base.' });
        const a = lireNombre(val('pacr_aides')) || 0;
        const c = (lireNombre(val('pacr_capex_materiel')) || 0) + (lireNombre(val('pacr_capex_travaux')) || 0);
        if (a > c) liste.push({ el: $('pacr_aides'), message: "Les aides dépassent l'investissement." });
        return liste;
    }

    /** kWh par plage tarifaire de chaque série (kW, grille de la simulation, heure murale). */
    function ventilerEco(series, tarif) {
        const plages = PLAGES_TARIF[tarif];
        const dt = resultat.pas / 60;
        const noms = Object.keys(series);
        if (tarif === 'C5_BASE') {
            return Object.fromEntries(noms.map((n) => [n, { BASE: series[n].reduce((s, v) => s + v, 0) * dt }]));
        }
        const v = window.RentabiliteIrveCalculs.ventiler(series, { annee: resultat.annee, pasMin: resultat.pas, utc1: false, tarif, config: configHoraire() });
        return Object.fromEntries(noms.map((n) => [n, Object.fromEntries(plages.map((p) => [p, v.kwh[p][n]]))]));
    }

    function calculerEtudeEco(e) {
        const r = resultat;
        const froidCompare = e.froid === 'clim';
        const choix = {
            chauffage: e.sys.id, ecs: e.ecsChaudiere ? 'chaudiere' : 'electrique', froid: e.froid,
            seer: nombre('pacr_ref_seer'), rendementChauffage: nombre('pacr_ref_rdt'), rendementEcs: nombre('pacr_ref_ecs_rdt'),
        };
        const cr = P.consommationReference(r.sim, r.pas, choix, ref.eco);
        const pac = P.seriePac(r.sim, froidCompare);
        const plages = PLAGES_TARIF[e.tarif];
        const v = ventilerEco({ pac, refElec: cr.elecSerie }, e.tarif);
        const refElec = { ...v.refElec };
        refElec[plages.includes('HC') ? 'HC' : 'BASE'] += cr.elecEcsKwh;
        // PV de la PAC entière, ramené au périmètre comparé au prorata de l'énergie.
        const pacTotal = energieKwh(seriePac(r.sim), r.pas);
        const pacCompare = plages.reduce((s, k) => s + v.pac[k], 0);
        const pvKwh = e.pv ? pvCouplage().pvKwh * (pacTotal > 0 ? Math.min(1, pacCompare / pacTotal) : 0) : 0;
        // Champ masqué (sans objet pour la configuration) : 0, comme dans le calcul de référence.
        const n = (id) => { const r = REGLE_ECO[id]; return r && r.quand && !r.quand(e) ? 0 : (nombre(id) ?? 0); };
        const params = {
            prix: Object.fromEntries(plages.map((k) => [k, n(`pacr_prix_${k}`)])),
            prix_gaz: n('pacr_prix_gaz'), abonnement_gaz: n('pacr_abo_gaz'), resiliation_gaz: coche('pacr_resil_gaz'),
            prix_fioul: n('pacr_prix_fioul'), prix_surplus: e.pv ? n('pacr_prix_surplus') : 0, surcout_abonnement: n('pacr_surcout_abo'),
            entretien_pac: n('pacr_entretien_pac'), entretien_ref: e.chaleur ? n('pacr_entretien_ref') : 0,
            capex_materiel: n('pacr_capex_materiel'), capex_travaux: n('pacr_capex_travaux'), aides: n('pacr_aides'), cout_evite: n('pacr_cout_evite'),
            horizon: n('pacr_horizon'), duree_vie: n('pacr_duree_vie'), remplacement: n('pacr_remplacement'),
            evol_elec: n('pacr_evol_elec'), evol_gaz: n('pacr_evol_gaz'), evol_fioul: n('pacr_evol_fioul'),
            inflation: n('pacr_inflation'), actualisation: n('pacr_actualisation'), degradation: e.pv ? n('pacr_degradation') : 0,
        };
        const energies = {
            plages, pac: v.pac, ref_elec: refElec, pv_kwh: pvKwh, gaz_pcs_kwh: cr.gazPcsKwh, fioul_litres: cr.fioulLitres, gaz: e.gaz,
        };
        const res = P.calculerRentabilite(params, energies);
        const ind = res.indicateurs;
        const partReseau = ind.pac_kwh > 0 ? ind.reseau_kwh / ind.pac_kwh : 1;
        const co2 = P.emissions(r.syn.annuel, cr, froidCompare, partReseau, ref.eco.emissions_kgco2_kwh);
        // Climatisation hors comparaison : chiffrée à part au prix moyen du kWh PAC.
        const froidExcluKwh = !froidCompare && e.s.usages.froid ? r.syn.annuel.eFroid : 0;
        return { e, cr, res, co2, params, energies, froidCompare, froidExcluKwh, froidExcluEur: froidExcluKwh * ind.prix_moyen_pac };
    }

    function majRentabilite() {
        if (!construit || !ref) return;
        clearTimeout(minuterieEco);
        afficher('pac_eco_attente', !resultat);
        afficher('pac_eco_contenu', !!resultat);
        document.querySelectorAll('#pac_eco input, #pac_eco select').forEach((el) => { el.style.borderColor = ''; el.style.boxShadow = ''; });
        if (!resultat) { rentabilite = null; return; }
        const e = majVisibiliteEco();
        const v = violationsEco(e);
        v.filter((x) => x.el).forEach((x) => { x.el.style.borderColor = '#dc2626'; x.el.style.boxShadow = '0 0 0 2px rgba(220,38,38,0.15)'; });
        const bandeau = $('pacr_validation');
        bandeau.style.display = v.length ? 'block' : 'none';
        bandeau.textContent = v.length ? `${v[0].message}${v.length > 1 ? ` (et ${v.length - 1} autre${v.length > 2 ? 's' : ''} correction${v.length > 2 ? 's' : ''})` : ''}` : '';
        if (v.length) { rentabilite = null; afficher('pacr_resultats', false); return; }
        try {
            rentabilite = calculerEtudeEco(e);
            afficher('pacr_resultats', true);
            afficherRentabilite();
            planifierControleEco();
        } catch (err) {
            console.error('[PAC] Rentabilité :', err);
            rentabilite = null;
            afficher('pacr_resultats', false);
            bandeau.style.display = 'block';
            bandeau.textContent = "L'étude de rentabilité n'a pas pu être calculée.";
        }
    }

    function afficherRentabilite() {
        const { e, cr, res, co2, froidExcluKwh, froidExcluEur } = rentabilite;
        const ind = res.indicateurs;
        const a1 = res.lignes[1];
        const eur = (x) => `${fr(x, 0)} €`;
        const ans = (x) => (x === null ? `> ${ind.horizon} ans` : `${fr(x, 1)} ans`);
        const tuiles = [
            ['Investissement net', eur(ind.investissement)],
            ['Économie la 1re année', eur(ind.economie_an1)],
            ['Temps de retour', ans(ind.retour_ans)],
            ['Temps de retour actualisé', ans(ind.retour_actualise_ans)],
            [`VAN sur ${ind.horizon} ans`, eur(ind.van)],
            ['TRI', ind.tri_pct === null ? '--' : `${fr(ind.tri_pct, 1)} %`],
            ['CO2 évité', `${fr(co2.evite / 1000, 2)} t/an`],
        ];
        $('pacr_tuiles').innerHTML = tuiles.map(([l, v]) => `<div class="pac-stat"><div class="pac-stat-label">${l}</div><div class="pac-stat-valeur">${v}</div></div>`).join('');
        const alertes = [];
        if (!e.chaleur && e.froid !== 'clim') alertes.push("Climatisation sans équipement remplacé : il n'y a rien à comparer, l'étude chiffre seulement le coût de ce confort ajouté. Choisissez « Remplace un climatiseur existant » pour comparer.");
        else if (ind.economie_an1 <= 0) alertes.push("Avec ces prix, l'équipement coûte plus cher à l'usage que le système de référence : pas de retour sur investissement.");
        else if (ind.retour_ans === null) alertes.push(`L'investissement n'est pas remboursé sur les ${ind.horizon} ans de l'étude.`);
        if (e.froid === 'clim' && e.s.usages.froid && !(e.s.usages.chauffage || e.s.usages.ecs)) alertes.push('Climatiseur seul : seule la différence de performance avec le climatiseur existant est valorisée.');
        $('pacr_alertes').innerHTML = alertes.map((a) => `<div class="pac-alerte">${echapper(a)}</div>`).join('');

        const u = cr.utile;
        txt('pacr_utile', `Énergie utile fournie dans les deux cas : chauffage ${fr(u.chauffage, 0)} kWh, ECS ${fr(u.ecs, 0)} kWh${e.s.usages.froid ? `, froid ${fr(u.froid, 0)} kWh${e.froid === 'clim' ? '' : ' (hors comparaison)'}` : ''}.`
            + ` Référence : ${cr.systeme.libelle.toLowerCase()} (rendement ${fr(cr.rendements.chauffage, 2)})${e.s.usages.ecs ? `, ECS ${cr.ecsElectrique ? 'par chauffe-eau électrique' : `par la chaudière (rendement ${fr(cr.rendements.ecs, 2)})`}` : ''}${cr.rendements.seer ? `, climatiseur SEER ${fr(cr.rendements.seer, 1)}` : ''}.`);
        const lignes = [
            ['Électricité achetée au réseau', `${fr(ind.ref_elec_kwh, 0)} kWh`, `${fr(ind.reseau_kwh, 0)} kWh`],
        ];
        if (ind.pv_kwh > 0) lignes.push(['Électricité photovoltaïque consommée', '—', `${fr(ind.pv_kwh, 0)} kWh`]);
        if (e.gaz) lignes.push(['Gaz (PCS facturé)', `${fr(ind.ref_gaz_pcs_kwh, 0)} kWh`, '—']);
        if (e.fioul) lignes.push(['Fioul', `${fr(ind.ref_fioul_litres, 0)} L`, '—']);
        lignes.push(
            ["Coût de l'énergie", eur(a1.ref_energie), eur(a1.pac_energie + a1.pac_surplus)],
            ['Abonnement', a1.ref_abonnement ? `${eur(a1.ref_abonnement)} (gaz)` : '—', a1.pac_abonnement ? `${eur(a1.pac_abonnement)} (supplément)` : '—'],
            ['Entretien', eur(a1.ref_entretien), eur(a1.pac_entretien)],
            ['<strong>Total</strong>', `<strong>${eur(a1.cout_ref)}</strong>`, `<strong>${eur(a1.cout_pac)}</strong>`],
            [`Coût global actualisé sur ${ind.horizon} ans (investissement compris)`, eur(ind.cout_global_ref), eur(ind.cout_global_pac)],
            ['Émissions de CO2', `${fr(co2.ref, 0)} kg`, `${fr(co2.pac, 0)} kg`],
        );
        $('pacr_comparatif').innerHTML = lignes.map(([l, a, b]) => `<tr><td>${l}</td><td>${a}</td><td>${b}</td></tr>`).join('');
        txt('pacr_froid_exclu', froidExcluKwh > 0
            ? `Climatisation hors comparaison : ${fr(froidExcluKwh, 0)} kWh/an d'électricité, soit environ ${fr(froidExcluEur, 0)} €/an au prix moyen du kWh de l'équipement.` : '');

        $('pacr_flux').innerHTML = res.lignes.map((l) => `<tr><td>${l.annee}</td><td>${fr(l.cout_ref, 0)}</td><td>${fr(l.cout_pac, 0)}</td><td>${fr(l.remplacement, 0)}</td><td>${fr(l.flux, 0)}</td><td>${fr(l.cumul, 0)}</td><td>${fr(l.cumul_actualise, 0)}</td></tr>`).join('');
        dessinerRentabilite();
    }

    function dessinerRentabilite() {
        if (!rentabilite || typeof Chart === 'undefined') return;
        const l = rentabilite.res.lignes;
        detruireGraph('eco');
        graphs.eco = new Chart($('pacr_graph'), {
            type: 'bar',
            data: {
                labels: l.map((x) => String(x.annee)),
                datasets: [
                    { label: 'Flux annuel (€)', data: l.map((x) => Math.round(x.flux)), backgroundColor: l.map((x) => (x.flux >= 0 ? '#16a34a' : '#dc2626')), order: 2 },
                    { type: 'line', label: 'Cumul (€)', data: l.map((x) => Math.round(x.cumul)), borderColor: '#111827', borderWidth: 2, pointRadius: 2, order: 1 },
                    { type: 'line', label: 'Cumul actualisé (€)', data: l.map((x) => Math.round(x.cumul_actualise)), borderColor: '#2563eb', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, order: 1 },
                ],
            },
            options: {
                responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                plugins: { datalabels: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label} : ${fr(c.parsed.y, 0)}` } } },
                scales: { x: { title: { display: true, text: 'Année' } }, y: { title: { display: true, text: '€' } } },
            },
        });
    }

    function exporterRentabilite() {
        if (!rentabilite) return;
        if (typeof XLSX === 'undefined') { message("Export indisponible : bibliothèque de tableur non chargée.", 'error'); return; }
        const { res, co2, params, cr } = rentabilite;
        const ind = res.indicateurs;
        const lignes = [
            ['Étude de rentabilité PAC / climatiseur'],
            ['Équipement :', [val('pac_marque'), val('pac_modele'), val('pac_reference')].filter(Boolean).join(' ') || '—'],
            ['Référence :', cr.systeme.libelle],
            [],
            ['Indicateur', 'Valeur'],
            ['Investissement net (€)', ind.investissement],
            ['Économie année 1 (€)', ind.economie_an1],
            ['Temps de retour (ans)', ind.retour_ans],
            ['Temps de retour actualisé (ans)', ind.retour_actualise_ans],
            [`VAN ${ind.horizon} ans (€)`, ind.van],
            ['TRI (%)', ind.tri_pct],
            ['CO2 référence (kg/an)', co2.ref],
            ['CO2 PAC (kg/an)', co2.pac],
            [],
            ['Paramètre', 'Valeur'],
            ...Object.entries(params).filter(([k]) => k !== 'prix').map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 'oui' : 'non') : v]),
            ...Object.entries(params.prix).map(([k, v]) => [`prix ${LIB_PLAGES[k]} (€/kWh)`, v]),
            [],
            ['Année', 'Coût référence (€)', 'Coût PAC (€)', 'Remplacement (€)', 'Flux (€)', 'Cumul (€)', 'Cumul actualisé (€)'],
            ...res.lignes.map((l) => [l.annee, l.cout_ref, l.cout_pac, l.remplacement, l.flux, l.cumul, l.cumul_actualise]),
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lignes), 'Rentabilite_PAC');
        XLSX.writeFile(wb, 'Rentabilite_PAC.xlsx');
    }

    /** Changement d'un champ de l'étude : défauts liés, puis recalcul (différé pendant la frappe). */
    function surChangementEco(e) {
        const id = e.target.id || '';
        if (id === 'pacr_ref_ch') appliquerDefautsEco(['pacr_ref_rdt', 'pacr_entretien_ref']);
        if (e.type === 'input' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
            e.target.dataset.saisi = '1';
            clearTimeout(minuterieEco);
            minuterieEco = setTimeout(majRentabilite, 300);
            return;
        }
        majRentabilite();
    }

    // ---------------------------------------------------------------------------------------
    // Contrôle des calculs (calcul de référence, pac_verification.js)
    // ---------------------------------------------------------------------------------------
    let jetonControle = 0;
    let jetonControleEco = 0;
    let minuterieControleEco = null;

    function statutControle(id, texte, couleur) {
        const el = $(id);
        if (!el) return;
        el.textContent = texte;
        el.style.color = couleur || '';
    }

    /** Bâtiment tel que saisi (le calcul de référence le reconstruit avec les mêmes formules). */
    function batimentControle(s) {
        if (!avecEspace(s)) return { methode: 'aucun' };
        const inertie = val('pac_inertie');
        if (batimentDecrit(s) && s.option === 'detaillee') {
            return {
                methode: 'detaille', inertie_id: inertie, pieces: lirePieces(),
                env: {
                    u_mur: nombre('pac_u_mur'), u_toit: nombre('pac_u_toit'), u_sol: nombre('pac_u_sol'), u_fenetre: nombre('pac_u_fen'),
                    g_fenetre: nombre('pac_g_fenetre'), ponts_thermiques_pct: nombre('pac_pt'), n50: nombre('pac_n50'),
                },
                ventilation: { renouvellement_vol_h: nombre('pac_vent_n'), rendement_recuperation: nombre('pac_vent_eta') },
            };
        }
        const base = { inertie_id: inertie, surface: nombre('pac_surface'), hauteur: nombre('pac_hauteur'), vitrage_pct: nombre('pac_vitrage_pct'), g_fenetre: nombre('pac_g_fenetre') };
        if (batimentDecrit(s)) return { methode: 'simplifie', ...base, g: nombre('pac_g'), niveau_id: val('pac_niveau'), ventilation_id: val('pac_ventilation') };
        return { methode: 'deduit', ...base, taux_dim: nombre('pac_taux_dim'), consigne_chauffage: nombre('pac_cons_ch') };
    }

    /** Entrées du contrôle, figées au moment du calcul (mêmes valeurs que la simulation affichée). */
    function entreesControleSimulation(r) {
        const s = r.s;
        const e = r.entree;
        const ecs = e.ecs;
        const profil = ref.ecs.profils_puisage[val('pac_ecs_profil')] ? val('pac_ecs_profil') : 'standard';
        return {
            meteo: { lat: r.site ? r.site.lat : null, lon: r.site ? r.site.lon : null, pas_minutes: r.pas, annee: r.annee },
            altitude_site_m: r.altitudeSite,
            type: s.type, systeme: s.systeme, usages: { ...s.usages },
            tbase_hiver: r.tBase, tbase_ete: s.usages.froid ? r.tBaseEte : null,
            batiment: batimentControle(s),
            modeles: r.modeles.cfg,
            loi_deau: e.loiDeau, puits_chaud: e.puitsChaud, depart_froid: e.departFroid ?? 18,
            apports: { appareilsWm2: e.apports.appareilsWm2 },
            consignes: { ...e.consignes },
            appoint: { ...e.appoint },
            aux: { ...e.aux },
            ecs: ecs ? {
                litresJour: ecs.litresJour, profil_id: profil, tUsage: ecs.tUsage, consigne: ecs.consigne, hysteresis: ecs.hysteresis,
                volume: ecs.volume, pertesKwh24h: nombre('pac_ecs_pertes'), tAmbiance: ecs.tAmbiance, resistanceKw: ecs.resistanceKw,
                tEauMaxPac: ecs.tEauMaxPac, plage: ecs.plage,
                antilegionelle: { actif: !!ecs.antilegionelle.actif, jourSemaine: ecs.antilegionelle.jourSemaine, heure: ecs.antilegionelle.heure ?? 0 },
                priorite: !!ecs.priorite,
            } : null,
        };
    }

    function resultatsControleSimulation(r) {
        const y = r.syn;
        return {
            synthese: {
                annuel: y.annuel, mensuel: y.mensuel, eTotal: y.eTotal, pointeKw: y.pointeKw, scopChauffage: y.scopChauffage,
                seerSimule: y.seerSimule, performanceGlobaleChaud: y.performanceGlobaleChaud, couverturePac: y.couverturePac,
                heuresInconfortChaud: y.heuresInconfortChaud, heuresInconfortFroid: y.heuresInconfortFroid, heuresEcsInconfort: y.heuresEcsInconfort,
            },
            dimensionnement: {
                H: r.b.H, volume: r.b.volume, besoinBaseKw: r.besoinBaseKw, pointeChaudDynKw: r.pointeChaudDynKw,
                pointeFroidKw: r.pointeFroidKw, gammeCh: r.gammeCh, gammeFr: r.gammeFr,
            },
            bilan_pac_kwh: energieKwh(seriePac(r.sim), r.pas),
        };
    }

    async function verifierSimulation(r) {
        if (!V || !r || !r.site) return;
        const jeton = ++jetonControle;
        statutControle('pac_verif_statut', 'Contrôle des calculs…', 'var(--text-secondary)');
        const rep = await V.verifier('simulation', r.entreesControle, resultatsControleSimulation(r));
        if (jeton !== jetonControle || r !== resultat) return; // calcul relancé ou saisies modifiées entre-temps
        if (rep.statut === 'conforme') { statutControle('pac_verif_statut', '✅ Calculs contrôlés.', 'var(--success-color, #16a34a)'); return; }
        if (rep.statut === 'refus') { statutControle('pac_verif_statut', `❌ ${rep.message}`, '#dc2626'); message(rep.message, 'error', 7000); return; }
        if (rep.statut === 'indisponible') { statutControle('pac_verif_statut', 'Contrôle des calculs reporté (service indisponible).', '#b45309'); return; }
        // Écart : les séries et indicateurs de référence remplacent ceux affichés.
        if (rep.series) {
            Object.keys(rep.series).forEach((k) => { r.sim[k] = Float64Array.from(rep.series[k], (x) => Number(x) || 0); });
        }
        const ref = rep.reference;
        r.sim.heuresInconfortChaud = ref.synthese.heuresInconfortChaud;
        r.sim.heuresInconfortFroid = ref.synthese.heuresInconfortFroid;
        r.sim.heuresEcsInconfort = ref.synthese.heuresEcsInconfort;
        r.syn = S.synthese(r.sim);
        const d = ref.dimensionnement;
        Object.assign(r, { besoinBaseKw: d.besoinBaseKw, pointeChaudDynKw: d.pointeChaudDynKw, pointeFroidKw: d.pointeFroidKw, gammeCh: d.gammeCh, gammeFr: d.gammeFr });
        r.b.H = d.H;
        r.b.volume = d.volume;
        afficherResultats();
        await transmettreCourbe();
        afficherCourbeSite();
        majRentabilite();
        statutControle('pac_verif_statut', `Contrôle des calculs : ${rep.nbEcarts} écart(s) corrigé(s), valeurs de référence affichées.`, '#b45309');
    }

    function planifierControleEco() {
        clearTimeout(minuterieControleEco);
        jetonControleEco++;
        statutControle('pacr_verif_statut', '');
        minuterieControleEco = setTimeout(verifierRentabilite, 500);
    }

    async function verifierRentabilite() {
        const etude = rentabilite;
        if (!V || !etude || !resultat) return;
        const jeton = ++jetonControleEco;
        const cr = etude.cr;
        const a = resultat.syn.annuel;
        const entrees = {
            p: etude.params, e: etude.energies,
            annuel: Object.fromEntries(['eChauffage', 'eFroid', 'eEcs', 'eAppoint', 'eAuxiliaires', 'qChauffagePac', 'qChauffageAppoint', 'qFroid', 'qEcsPac', 'qEcsResistance'].map((k) => [k, a[k]])),
            conso_ref: { energie: cr.energie, elecChKwh: cr.elecChKwh, elecEcsKwh: cr.elecEcsKwh, elecFroidKwh: cr.elecFroidKwh, combustiblePciKwh: cr.combustiblePciKwh.total },
            froid_compare: etude.froidCompare,
        };
        const rep = await V.verifier('rentabilite', entrees, { indicateurs: etude.res.indicateurs, lignes: etude.res.lignes, co2: etude.co2 });
        if (jeton !== jetonControleEco || etude !== rentabilite) return;
        if (rep.statut === 'conforme') { statutControle('pacr_verif_statut', '✅ Calculs contrôlés.', 'var(--success-color, #16a34a)'); return; }
        if (rep.statut === 'refus') { statutControle('pacr_verif_statut', `❌ ${rep.message}`, '#dc2626'); return; }
        if (rep.statut === 'indisponible') { statutControle('pacr_verif_statut', 'Contrôle des calculs reporté (service indisponible).', '#b45309'); return; }
        etude.res = { lignes: rep.reference.lignes, indicateurs: rep.reference.indicateurs };
        etude.co2 = rep.reference.co2;
        afficherRentabilite();
        statutControle('pacr_verif_statut', `Contrôle des calculs : ${rep.nbEcarts} écart(s) corrigé(s), valeurs de référence affichées.`, '#b45309');
    }

    // ---------------------------------------------------------------------------------------
    // Saisies conservées dans le navigateur (par utilisateur et par projet vérifié)
    // ---------------------------------------------------------------------------------------
    const PREFIXE_STOCKAGE = 'skv_pac_';
    const FORMAT_STOCKAGE = 'pac_climatisation_local';
    let restaurationFaite = false;
    let minuterieSauvegarde = null;
    const nettoyerId = (x) => String(x).replace(/[^A-Za-z0-9-]/g, '');

    /** Projet vérifié en base et utilisateur connecté (contexte serveur) ; null sans projet vérifié. */
    function identiteStockage() {
        const projet = window.ACTIVE_PROJECT_ID_VERIFIE;
        if (projet === null || projet === undefined || projet === '') return null;
        const u = window.ACTIVE_USER_ID;
        const utilisateur = u === null || u === undefined || u === '' ? 'anonyme' : nettoyerId(u);
        return { projet: nettoyerId(projet), utilisateur, cle: `${PREFIXE_STOCKAGE}${utilisateur}_${nettoyerId(projet)}`, nom: String(window.ACTIVE_PROJECT_NOM || '') };
    }

    function lireStockage(cle) {
        try { return JSON.parse(localStorage.getItem(cle) || 'null'); } catch (e) { return null; }
    }

    /** Les saisies d'un autre utilisateur n'ont rien à faire dans ce navigateur pour cette session. */
    function purgerAutresUtilisateurs(id) {
        try {
            Object.keys(localStorage).filter((k) => k.startsWith(PREFIXE_STOCKAGE) && !k.startsWith(`${PREFIXE_STOCKAGE}${id.utilisateur}_`))
                .forEach((k) => localStorage.removeItem(k));
        } catch (e) { /* stockage indisponible */ }
    }

    function sauvegarderSaisies() {
        const id = identiteStockage();
        if (!id || !restaurationFaite || !construit) return;
        const alt = $('pac_altitude');
        const donnees = {
            format: FORMAT_STOCKAGE, version: 1,
            projet_id: id.projet, projet_nom: id.nom, utilisateur_id: id.utilisateur,
            enregistre_le: new Date().toISOString(),
            config: lireConfiguration(),
            drapeaux: { altitude_auto: alt && alt.dataset.auto ? alt.dataset.auto : null, capex_saisi: !!($('pacr_capex_materiel') && $('pacr_capex_materiel').dataset.saisi) },
        };
        try {
            localStorage.setItem(id.cle, JSON.stringify(donnees));
        } catch (e) {
            txt('pac_stockage_statut', 'Saisies non conservées : stockage du navigateur plein ou indisponible.');
        }
    }

    function planifierSauvegarde() {
        clearTimeout(minuterieSauvegarde);
        minuterieSauvegarde = setTimeout(sauvegarderSaisies, 400);
    }

    /** Restaure les saisies du projet actif (même utilisateur, même projet) ; valeurs hors limites ignorées. */
    function restaurerSaisies() {
        restaurationFaite = true;
        const id = identiteStockage();
        if (!id) { txt('pac_stockage_statut', 'Projet actif non vérifié : les saisies ne seront pas conservées.'); return; }
        purgerAutresUtilisateurs(id);
        const d = lireStockage(id.cle);
        if (!d) return;
        if (d.format !== FORMAT_STOCKAGE || String(d.projet_id) !== id.projet || String(d.utilisateur_id) !== id.utilisateur || !d.config) {
            try { localStorage.removeItem(id.cle); } catch (e) { /* stockage indisponible */ }
            return;
        }
        let rejetes = [];
        try {
            rejetes = appliquerConfiguration(d.config);
        } catch (e) {
            console.warn('[PAC] Saisies conservées illisibles :', e);
            return;
        }
        const alt = $('pac_altitude');
        if (alt && d.drapeaux) {
            if (d.drapeaux.altitude_auto) { delete alt.dataset.saisi; alt.dataset.auto = d.drapeaux.altitude_auto; }
            if (d.drapeaux.capex_saisi && $('pacr_capex_materiel')) $('pacr_capex_materiel').dataset.saisi = '1';
            else if ($('pacr_capex_materiel')) delete $('pacr_capex_materiel').dataset.saisi;
        }
        const quand = d.enregistre_le ? new Date(d.enregistre_le).toLocaleString('fr-FR') : '--';
        txt('pac_stockage_statut', `Saisies du projet « ${id.nom || d.projet_nom || id.projet} » restaurées (dernière modification le ${quand}) : relancez le calcul.`
            + (rejetes.length ? ` Valeurs hors limites ignorées : ${rejetes.slice(0, 5).join(', ')}${rejetes.length > 5 ? '…' : ''}.` : ''));
    }

    // ---------------------------------------------------------------------------------------
    // Un seul comptage de la climatisation (profil par équipements)
    // ---------------------------------------------------------------------------------------
    function climatisationGeree() {
        return !!(resultat && resultat.s.usages.froid);
    }

    function majAlerteClimatisation() {
        const el = $('pac_alerte_clim');
        if (!el) return;
        const ligneClim = typeof window.estLigneClimatisation === 'function'
            && Array.from(document.querySelectorAll('#equipment-table-body tr')).some(window.estLigneClimatisation);
        el.style.display = climatisationGeree() && ligneClim ? 'block' : 'none';
        el.textContent = "La climatisation est simulée ici : l'équipement « Climatisation » du profil par équipements est exclu de ce profil pour ne pas la compter deux fois. Régénérez le profil par équipements si vous l'aviez déjà appliqué.";
    }

    // ---------------------------------------------------------------------------------------
    // Câblage
    // ---------------------------------------------------------------------------------------
    function cabler() {
        const hote = $('pac-section-content');
        const surChangement = (e) => {
            if (e.target.closest('#pac_eco')) { surChangementEco(e); return; }
            const id = e.target.id || '';
            if ((id === 'pac_type' || id === 'pac_nb_unites') && $('pacr_capex_materiel') && !$('pacr_capex_materiel').dataset.saisi) appliquerDefautsEco(['pacr_capex_materiel']);
            if (id === 'pac_type' || id === 'pac_reversible') { majListes(); if (id === 'pac_type') valeursGeneriques(); appliquerEmetteurs(); }
            if (id === 'pac_emetteur_chaud' || id === 'pac_emetteur_froid' || id === 'pac_usage') appliquerEmetteurs();
            if (id === 'pac_niveau') appliquerNiveau();
            if (id === 'pac_ventilation') appliquerVentilation();
            if (id === 'pac_departement') majZone();
            if (id === 'pac_altitude') majTemperaturesBase(true);
            if (id === 'pac_pas' || id === 'pac_annee') { meteo = null; meteoCle = ''; }
            if (id.startsWith('pac_liaison')) majEstimationLiaisons();
            if (id === 'pac_jour') { dessinerJour(); dessinerSite(); return; }
            majVisibilite();
            if (id !== 'pac_jour') invaliderResultats();
            majEtatValidation();
        };
        hote.addEventListener('change', surChangement);
        ['change', 'input', 'click'].forEach((type) => hote.addEventListener(type, (e) => {
            if (type !== 'click' || e.target.closest('.pac-suppr, [data-pac-ajout-point], #pac_btn_piece, #pac_btn_generique, #pacr_btn_defauts')) planifierSauvegarde();
        }));
        hote.addEventListener('input', (e) => {
            if (e.target.id === 'pac_jour') return;
            if (e.target.closest('#pac_eco')) { surChangementEco(e); return; }
            if (e.target.closest('#pac_points_chaud, #pac_points_froid')) majLibellesPoints();
            if ((e.target.id || '').startsWith('pac_liaison')) majEstimationLiaisons();
            if (e.target.id === 'pac_altitude') { e.target.dataset.saisi = '1'; txt('pac_altitude_source', ''); }
            majEtatValidation();
        });
        hote.addEventListener('click', (e) => {
            const suppr = e.target.closest('.pac-suppr');
            if (suppr) { suppr.closest('tr').remove(); invaliderResultats(); majEtatValidation(); return; }
            const ajoutPoint = e.target.closest('[data-pac-ajout-point]');
            if (ajoutPoint) { ajouterPoint(ajoutPoint.dataset.pacAjoutPoint, null); majEtatValidation(); return; }
            const exp = e.target.closest('[data-pac-export]');
            if (exp) { exporterCourbe(Number(exp.dataset.pacExport)); }
            const expSite = e.target.closest('[data-pac-export-site]');
            if (expSite) { exporterCourbeSite(expSite.dataset.pacExportSite); }
        });
        $('pac_btn_piece').addEventListener('click', () => { ajouterPiece(null); invaliderResultats(); majEtatValidation(); });
        $('pac_btn_generique').addEventListener('click', () => { valeursGeneriques(); majEtatValidation(); });
        $('pac_btn_calculer').addEventListener('click', calculer);
        $('pac_btn_meteo').addEventListener('click', () => chargerMeteo(true).catch((err) => message(err.message, 'error', 6000)));
        $('pac_btn_jour_froid').addEventListener('click', () => { if (resultat) { $('pac_jour').value = dateDuJour(indiceJourExtreme('froid')); dessinerJour(); dessinerSite(); } });
        $('pac_btn_jour_chaud').addEventListener('click', () => { if (resultat) { $('pac_jour').value = dateDuJour(indiceJourExtreme('chaud')); dessinerJour(); dessinerSite(); } });
        $('pac_btn_actualiser_couplage').addEventListener('click', chargerInfoCouplage);
        $('pac_btn_supprimer_courbe').addEventListener('click', supprimerCourbeTransmise);
        $('pac_btn_schema').addEventListener('click', telechargerSchema);
        $('pac_btn_schema_afficher').addEventListener('click', (e) => {
            const zone = $('pac_schema_zone');
            const visible = zone.style.display === 'none';
            zone.style.display = visible ? '' : 'none';
            e.currentTarget.textContent = visible ? 'Masquer le schéma de principe' : 'Afficher le schéma de principe';
            e.currentTarget.setAttribute('aria-expanded', String(visible));
            if (visible) majSchema();
        });
        $('pacr_btn_defauts').addEventListener('click', () => { appliquerDefautsEco(); majRentabilite(); });
        $('pacr_btn_export').addEventListener('click', exporterRentabilite);
        $('pac_btn_export_config').addEventListener('click', exporterConfiguration);
        $('pac_btn_import_config').addEventListener('click', () => $('pac_fichier_config').click());
        $('pac_fichier_config').addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (!f) return;
            f.text().then((t) => {
                const rejetes = appliquerConfiguration(JSON.parse(t));
                message(rejetes.length ? `Configuration importée. Valeurs hors limites ignorées : ${rejetes.slice(0, 5).join(', ')}${rejetes.length > 5 ? '…' : ''}.` : 'Configuration importée.',
                    'info', rejetes.length ? 7000 : 3000);
            })
                .catch((err) => message(err.message || 'Fichier de configuration illisible.', 'error', 5000))
                .finally(() => { e.target.value = ''; });
        });
    }

    function initialiserValeurs() {
        $('pac_type').value = 'air_eau';
        $('pac_niveau').value = 'rt2005';
        $('pac_inertie').value = 'moyenne';
        $('pac_al_jour').value = '0';
        const pasIrve = document.getElementById('pas_temps');
        if (pasIrve && ['10', '15', '30', '60'].includes(pasIrve.value)) $('pac_pas').value = pasIrve.value;
        const anneeIrve = Number(document.getElementById('export_annee')?.value);
        if (anneeIrve >= 2020 && anneeIrve <= 2050) $('pac_annee').value = anneeIrve;
        $('pac_departement').value = departementDepuisAdresse();
        majListes();
        appliquerNiveau();
        appliquerEmetteurs();
        valeursGeneriques();
        [{ nom: 'Séjour', surface: 35, hauteur: 2.5, facades: [{ orientation: 'S', longueur: 7 }, { orientation: 'O', longueur: 5 }], vitragePct: 25, sousToiture: true, surSol: true },
            { nom: 'Cuisine', surface: 12, hauteur: 2.5, facades: [{ orientation: 'E', longueur: 4 }], vitragePct: 15, sousToiture: true, surSol: true },
            { nom: 'Chambre 1', surface: 13, hauteur: 2.5, facades: [{ orientation: 'N', longueur: 4 }], vitragePct: 15, sousToiture: true, surSol: true },
            { nom: 'Chambre 2', surface: 12, hauteur: 2.5, facades: [{ orientation: 'N', longueur: 4 }, { orientation: 'E', longueur: 3 }], vitragePct: 15, sousToiture: true, surSol: true }]
            .forEach((p) => ajouterPiece(p));
        majZone();
        majEstimationLiaisons();
        appliquerDefautsEco();
    }

    function appliquerAdresseProjet() {
        const site = adresseProjet();
        txt('pac_site', site ? `${site.libelle ? site.libelle + ' — ' : ''}${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}` : 'adresse du projet non renseignée');
    }

    /** Construit la section à la première ouverture. Appelée par le bouton de menu. */
    async function ouvrir() {
        const hote = $('pac-section-content');
        if (!hote) return false;
        try {
            if (!construit) {
                hote.innerHTML = '<p style="font-size:0.9rem; color:var(--text-secondary);">Chargement…</p>';
                await chargerReferences();
                hote.innerHTML = balisage();
                cabler();
                construit = true;
                initialiserValeurs();
                restaurerSaisies();
                majVisibilite();
            }
            appliquerAdresseProjet();
            remplirAltitude();
            majAlerteClimatisation();
            majEtatValidation();
            chargerInfoCouplage();
            return true;
        } catch (err) {
            console.error('[PAC] Erreur dans ouvrir() :', err);
            hote.innerHTML = '<div class="pac-alerte">Les données de référence du module PAC n\'ont pas pu être chargées. Rechargez la page.</div>';
            return false;
        }
    }

    window.PacSection = { ouvrir, climatisationGeree };
})();
