/**
 * Section « Pompage solaire » de la modale de consommation d'énergie (app_irve_v1.16.html).
 * ======================================================================================
 * REFONTE de l'ancienne page autonome (static/.../pompage_solaire/, supprimée) : celle-ci était un
 * document HTML complet — sa propre balise <html>, Tailwind par CDN, sa propre feuille de style,
 * ses propres modales — qui ne pouvait pas cohabiter avec le reste de l'application. Son bouton de
 * menu n'ouvrait d'ailleurs qu'une modale « fonctionnalité à venir ».
 *
 * Ce qui change, et pourquoi :
 *  - le balisage est construit ici et injecté dans #pompage-section-content, avec les classes du
 *    modal (.energy-card, .input-group, .btn-base) : une seule charte, pas de second framework CSS ;
 *  - la latitude/longitude ne sont plus saisies à la main (l'ancienne page était figée sur des
 *    coordonnées du Sénégal) : elles viennent des paramètres du projet actif
 *    (window.resolveProjectLatLon, partagée avec la section Autonomie) ;
 *  - le serveur ne fournit plus que l'IRRADIATION (POST /api/pompage_solaire/irradiation, PVGIS via
 *    le modèle Python mémoïsé) ; tout le dimensionnement est fait ici, par
 *    PompageSolaireCalculs.dimensionner — miroir vérifié du Python de référence
 *    (tests/pompage_solaire/test_parite_pompage.py).
 *
 * Validation des saisies : bornes de la spec métier appliquées ICI (table REGLES, boutons grisés
 * tant qu'une valeur sort de ses bornes) ET au serveur (app/schemas/pompage_solaire_schemas.py), qui
 * reçoit toutes les saisies avec la demande d'irradiation — même principe que l'IRVE/l'Autonomie.
 * Toute évolution d'une borne se fait des deux côtés.
 *
 * Intégration du calepinage (case « Intégration du calepinage des panneaux », cochée par défaut) :
 * la puissance installée est synchronisée avec le calepinage de la carte (page principale, parente de
 * cette modale), et la production RÉELLE (ombrage proche de la scène 3D, PR, écrêtage) est calculée
 * par le module Production solaire (index_autoconso.html) intégré en iframe dans les résultats — même
 * principe que l'étude économique résidentielle (ResidentielAutoconsoEmbed.js) —, en « vente en
 * totalité ». Ses 12 valeurs mensuelles remplacent l'estimation kWc x irradiation x PR pour les
 * volumes pompés (miroir Python : process_simulation, production_mensuelle_kwh).
 *
 * Type de système (section 1 : fil du soleil, groupe électrogène d'appoint, batteries de secours) :
 * champ persisté `ps_systeme`, qui pilote le calcul (miroir Python : SYSTEMES_POMPAGE), les champs
 * affichés dans l'installation envisagée, l'analyse économique et le plan d'affaires (hybride /
 * stockage), et le schéma du circuit hydraulique (SVG dessiné ici, repris dans le rapport PDF).
 *
 * Le balisage n'est construit qu'à la première ouverture de la section : la modale de consommation
 * est déjà lourde, et cette section n'est pertinente que pour une partie des projets.
 */
(function () {
    'use strict';

    // Dossier de ce script : l'image de la page de garde du rapport est à côté.
    const DOSSIER_SCRIPT = (function () {
        const src = document.currentScript && document.currentScript.src;
        return src ? src.slice(0, src.lastIndexOf('/') + 1) : '';
    })();
    const urlImage = (nom) => DOSSIER_SCRIPT + encodeURIComponent(nom);
    const IMAGE_RAPPORT = 'image rapport.jpg';

    // Courbes de performance incluses (absentes du catalogue chargé par le reste de l'application).
    const URL_CATALOGUE_POMPES = '/concevoir_mon_projet/catalogue/pompes-solaires?avec_courbes=1';
    const URL_PRODUCTION_SOLAIRE = '/concevoir_mon_projet/index_autoconso';
    // Persistance EN BASE, par projet (GET .../load, POST .../save ; propriétaire du projet seul).
    const URL_PERSISTANCE = (projetId) => `/concevoir_mon_projet/parametre-projet/${encodeURIComponent(projetId)}/pompage-solaire`;
    // Anciennes clés localStorage GLOBALES, partagées par tous les projets du navigateur : c'est par
    // elles qu'un pompage saisi sur un projet réapparaissait dans les autres. Purgées, jamais relues
    // (impossible de savoir à quel projet elles appartenaient).
    const CLES_OBSOLETES = ['solarPumpData', 'solarPumpIntegrationCalepinage'];
    const DELAI_SAUVEGARDE_MS = 800;

    // Champs persistés (miroir de CHAMPS_*_POMPAGE, app/schemas/pompage_solaire_schemas.py). lat/lon
    // en sont volontairement ABSENTS : ils viennent de l'adresse du projet actif.
    const CHAMPS_PERSISTES = [
        'ps_systeme', 'ps_bat_autonomie', 'ps_bat_dod', 'ps_bat_rendement',
        'ps_pump_type', 'ps_h_aspiration', 'ps_h_tank', 'ps_daily_need', 'ps_losses_pipe',
        'ps_pump_efficiency', 'ps_angle', 'ps_aspect', 'ps_perte_systeme', 'ps_conso_specifique_ge',
        'ps_facteur_emission_co2', 'ps_coef_reduction_pomp', 'ps_coef_surdimensionnement', 'ps_puissance_reelle_installee_kwc',
        'ps_reference_pompe_installee', 'ps_pompe_choix', 'ps_pompe_filtre_fabricant',
        'ps_pompe_montage', 'ps_pompe_nombre',
        'ps_eco_devise', 'ps_eco_capex', 'ps_eco_opex_pv', 'ps_eco_opex_ge', 'ps_eco_remplacement_ge',
        'ps_eco_prix_carburant', 'ps_eco_inflation', 'ps_eco_taux', 'ps_eco_indexation_opex_pv',
        'ps_eco_remplacement_onduleur', 'ps_eco_evolution_besoins', 'ps_eco_degradation_pv',
        'ps_eco_capex_batterie', 'ps_eco_remplacement_batterie', 'ps_eco_duree_vie_batterie',
        'ps_m_material', 'ps_m_length', 'ps_m_diam', 'ps_m_flow', 'ps_m_acc',
        // Plan d'affaires (vente d'eau) ; les cases à cocher sont enregistrées en '1' / '0'. Hybride et
        // stockage découlent du type de système ; les batteries sont chiffrées dans l'analyse économique.
        'ps_pa_capex_materiel', 'ps_pa_capex_genie_civil', 'ps_pa_capex_transport', 'ps_pa_capex_terrain',
        'ps_pa_capex_pv', 'ps_pa_capex_ge',
        'ps_pa_entretien_ge', 'ps_pa_rempl_ge', 'ps_pa_rempl_onduleur',
        'ps_pa_entretien', 'ps_pa_indexation_entretien', 'ps_pa_tarif_m3', 'ps_pa_indexation_tarif',
        'ps_pa_part_pertes', 'ps_pa_subvention', 'ps_pa_emprunt', 'ps_pa_taux_emprunt', 'ps_pa_duree_emprunt',
        'ps_pa_impots', 'ps_pa_taux_impot', 'ps_pa_valeur_residuelle', 'ps_pa_methode_amortissement',
        'ps_pa_duree_amortissement', 'ps_pa_amortissement_annuel',
        'ps_pa_taux', 'ps_pa_horizon',
    ];
    const MOIS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
    const DEVISES = { EUR: '€', USD: '$', HTG: 'HTG', XOF: 'FCFA' };
    // Plafonds des montants selon la devise (bornes exprimées en euros, règles `monnaie: true`) —
    // MIROIR de FACTEUR_BORNES_DEVISE (app/schemas/pompage_solaire_schemas.py).
    const FACTEUR_BORNES_DEVISE = { EUR: 1, USD: 1, HTG: 150, XOF: 700 };

    // Type de système de pompage solaire (section 1) — miroir de SYSTEMES_POMPAGE (Python).
    const SYSTEMES = {
        fil_soleil: {
            libelle: 'Pompage au fil du soleil',
            description: "Les panneaux alimentent directement la pompe pendant la journée ; l'eau est stockée dans un réservoir pour la nuit et les jours couverts. Sans appoint, le déficit des mois peu ensoleillés n'est pas pompé.",
        },
        groupe: {
            libelle: 'Pompe solaire + groupe électrogène',
            description: "Le groupe électrogène prend le relais quand l'ensoleillement ne suffit pas : tout le besoin est pompé, le groupe ne pompant que le déficit du solaire.",
        },
        batteries: {
            libelle: 'Pompe solaire + batteries de secours',
            description: "Les batteries stockent l'énergie solaire pour pomper le soir ou par temps couvert. Elles déplacent l'énergie dans la journée sans en créer : le déficit des mois peu ensoleillés n'est pas pompé.",
        },
    };
    const SYSTEME_DEFAUT = 'fil_soleil';

    // ---------------------------------------------------------------------------------------
    // Bornes de saisie — MIROIR de app/schemas/pompage_solaire_schemas.py
    // ---------------------------------------------------------------------------------------

    // La hauteur « aspiration » change de sens et de bornes avec le type de pompage.
    const H_ASPIRATION = {
        forage: { min: 0.1, max: 100, defaut: 35, libelle: 'Profondeur niveau dynamique (m)' },
        surface: { min: 1, max: 7, defaut: 6, libelle: "Hauteur d'aspiration (m)" },
    };

    const systemeChoisi = () => (SYSTEMES[val('ps_systeme')] ? val('ps_systeme') : SYSTEME_DEFAUT);
    const siBatteries = () => systemeChoisi() === 'batteries';
    // Groupe électrogène : seulement en « pompe solaire + groupe ». Sans groupe, ses champs sont masqués,
    // non envoyés, et comptés à 0 par les calculs (miroir Python).
    const siGroupe = () => systemeChoisi() === 'groupe';

    // Inclinaison proposée selon le pays du projet (proche de la latitude du site : ≈ 18-20° N en
    // Haïti) ; ailleurs, 30°.
    const INCLINAISON_DEFAUT_PAYS = { 'Haïti': 20 };
    const INCLINAISON_DEFAUT = 30;

    function paysProjet() {
        const P = pageProjet();
        return String(window.ACTIVE_PROJECT_PAYS || (P && P.ACTIVE_PROJECT_PAYS) || '').trim();
    }

    // Ressource solaire : mêmes bornes que l'« Analyse d'autonomie énergétique du site ».
    // `si` : règle appliquée (et champ affiché) seulement dans ce cas.
    const REGLES = [
        {
            id: 'ps_angle', min: 0, max: 90, libelle: 'Inclinaison des panneaux (°)',
            get defaut() { return INCLINAISON_DEFAUT_PAYS[paysProjet()] || INCLINAISON_DEFAUT; },
        },
        { id: 'ps_aspect', min: -90, max: 180, defaut: 0, libelle: 'Azimut (°)' },
        { id: 'ps_perte_systeme', min: 8, max: 20, defaut: 18, libelle: 'Pertes du système (%)' },
        { id: 'ps_h_aspiration' }, // bornes selon le type de pompage, cf. reglesFormulaire()
        { id: 'ps_h_tank', min: 0, max: 2000, defaut: 10, libelle: 'Hauteur de refoulement (m)' },
        { id: 'ps_daily_need', min: 5, max: 2000, defaut: 50, libelle: 'Besoin journalier (m³/j)' },
        { id: 'ps_losses_pipe', min: 1, max: 15, defaut: 10, libelle: 'Pertes de charge (%)' },
        { id: 'ps_pump_efficiency', min: 0.3, max: 0.8, defaut: 0.6, libelle: 'Rendement global moteur + pompe' },
        { id: 'ps_puissance_reelle_installee_kwc', min: 0.1, max: 1000, defaut: 0, facultatif: true, libelle: 'Puissance PV installée (kWc)' },
        { id: 'ps_coef_surdimensionnement', min: 1, max: 2, defaut: 1.1, libelle: 'Coefficient de surdimensionnement' },
        { id: 'ps_coef_reduction_pomp', min: 0.8, max: 0.97, defaut: 0.95, si: () => !siBatteries(), libelle: 'Coefficient de réduction' },
        { id: 'ps_conso_specifique_ge', min: 0.5, max: 2, defaut: 0.5, si: siGroupe, libelle: 'Conso. spécifique du groupe (L/kWh)' },
        { id: 'ps_facteur_emission_co2', min: 0.1, max: 2, defaut: 0.58, si: siGroupe, libelle: "Facteur d'émission (kgCO₂/kWh)" },
        // Batteries de secours (système « batteries »).
        { id: 'ps_bat_autonomie', min: 0.5, max: 5, defaut: 1, si: siBatteries, libelle: 'Autonomie des batteries (jours)' },
        { id: 'ps_bat_dod', min: 30, max: 95, defaut: 80, si: siBatteries, libelle: 'Profondeur de décharge (%)' },
        { id: 'ps_bat_rendement', min: 70, max: 98, defaut: 90, si: siBatteries, libelle: 'Rendement aller-retour des batteries (%)' },
    ];
    const REGLES_CALCULATRICE = [
        { id: 'ps_m_length', min: 1, max: 5000, defaut: 100, libelle: 'Longueur de conduite (m)' },
        { id: 'ps_m_diam', min: 0.1, max: 500, defaut: 63, libelle: 'Diamètre intérieur (mm)' },
        { id: 'ps_m_flow', min: 1, max: 50, defaut: 8, libelle: 'Débit (m³/h)' },
        { id: 'ps_m_acc', min: 1.1, max: 1.7, defaut: 1.15, libelle: 'Coefficient accessoires' },
    ];
    const REGLES_ECO = [
        { id: 'ps_eco_capex', min: 1, max: 1000000, monnaie: true, libelle: 'Capex (centrale photovoltaïque + pompe)' },
        { id: 'ps_eco_opex_pv', min: 0, max: 50000, monnaie: true, libelle: 'Opex de la centrale photovoltaïque' },
        { id: 'ps_eco_indexation_opex_pv', min: 1, max: 15, defaut: 3, libelle: "Indexation de l'Opex solaire (%/an)" },
        { id: 'ps_eco_remplacement_onduleur', min: 500, max: 10000, defaut: 2000, monnaie: true, libelle: "Remplacement de l'onduleur / contrôleur de pompe" },
        { id: 'ps_eco_capex_batterie', min: 100, max: 100000, monnaie: true, si: siBatteries, libelle: 'Capex des batteries' },
        { id: 'ps_eco_remplacement_batterie', min: 100, max: 100000, monnaie: true, si: siBatteries, libelle: 'Remplacement des batteries' },
        { id: 'ps_eco_duree_vie_batterie', min: 3, max: 15, defaut: 10, entier: true, si: siBatteries, libelle: 'Durée de vie des batteries (ans)' },
        { id: 'ps_eco_opex_ge', min: 100, max: 10000, defaut: 1000, monnaie: true, si: siGroupe, libelle: 'Opex du groupe électrogène' },
        { id: 'ps_eco_remplacement_ge', min: 500, max: 15000, defaut: 7000, monnaie: true, si: siGroupe, libelle: 'Remplacement du groupe électrogène' },
        { id: 'ps_eco_prix_carburant', min: 0.1, max: 5000, defaut: 1.5, si: siGroupe, libelle: 'Prix du carburant' },
        { id: 'ps_eco_inflation', min: 1, max: 15, defaut: 3, si: siGroupe, libelle: 'Inflation du carburant (%/an)' },
        { id: 'ps_eco_taux', min: 1, max: 10, defaut: 3, libelle: "Taux d'actualisation (%)" },
        // Évolution dans le temps, commune à l'analyse économique et au plan d'affaires.
        { id: 'ps_eco_evolution_besoins', min: 1, max: 2, defaut: 1.1, libelle: 'Évolution annuelle des besoins en eau (coefficient)' },
        { id: 'ps_eco_degradation_pv', min: 0.1, max: 5, defaut: 0.3, libelle: 'Dégradation annuelle des panneaux (%/an)' },
    ];
    // Plan d'affaires (vente d'eau) — MIROIR de PlanAffairesRequest (schéma Pydantic).
    // `si` : règle appliquée seulement dans ce cas ; `entier` : nombre entier attendu.
    // Hybride = groupe électrogène d'appoint, stockage = batteries de secours : type de système (section 1).
    const siHybride = () => systemeChoisi() === 'groupe';
    const siStockage = siBatteries;
    const siFiscal = () => coche('ps_pa_impots') || coche('ps_pa_valeur_residuelle');
    const siLineaire = () => siFiscal() && val('ps_pa_methode_amortissement') !== 'constant';
    const REGLES_PLAN = [
        { id: 'ps_pa_capex_materiel', min: 1, max: 1000000, monnaie: true, libelle: 'Capex — matériel de pompage' },
        { id: 'ps_pa_capex_genie_civil', min: 0, max: 500000, monnaie: true, libelle: 'Capex — génie civil et pose' },
        { id: 'ps_pa_capex_transport', min: 0, max: 200000, monnaie: true, libelle: 'Capex — transport du matériel' },
        { id: 'ps_pa_capex_terrain', min: 0, max: 50000, defaut: 1000, monnaie: true, libelle: "Coût d'acquisition du terrain" },
        { id: 'ps_pa_capex_pv', min: 0, max: 1000000, defaut: 0, monnaie: true, si: () => siHybride() || siStockage(), libelle: "Capex de l'installation PV" },
        { id: 'ps_pa_capex_ge', min: 300, max: 100000, defaut: 750, monnaie: true, si: siHybride, libelle: 'Capex du groupe électrogène' },
        { id: 'ps_pa_entretien_ge', min: 100, max: 10000, defaut: 300, monnaie: true, si: siHybride, libelle: 'Entretien du groupe électrogène' },
        { id: 'ps_pa_rempl_ge', min: 300, max: 100000, defaut: 750, monnaie: true, si: siHybride, libelle: 'Remplacement du groupe électrogène' },
        { id: 'ps_pa_tarif_m3', min: 0.1, max: 300000, defaut: 5, libelle: "Tarif de vente de l'eau (/m³)" },
        { id: 'ps_pa_indexation_tarif', min: 1, max: 10, defaut: 3, libelle: 'Indexation annuelle du tarif de vente (%/an)' },
        { id: 'ps_pa_part_pertes', min: 2, max: 50, defaut: 10, libelle: "Part d'eau perdue ou impayée (%)" },
        { id: 'ps_pa_entretien', min: 100, max: 5000, defaut: 200, monnaie: true, libelle: "Entretien de l'installation" },
        { id: 'ps_pa_indexation_entretien', min: 1, max: 10, defaut: 3, libelle: "Indexation de l'entretien (%/an)" },
        { id: 'ps_pa_rempl_onduleur', min: 500, max: 10000, defaut: 2000, monnaie: true, libelle: "Remplacement de l'onduleur / contrôleur" },
        { id: 'ps_pa_subvention', min: 0, max: 999999.99, defaut: 0, monnaie: true, libelle: 'Subvention' },
        { id: 'ps_pa_emprunt', min: 0, max: 999999.99, defaut: 0, monnaie: true, libelle: 'Emprunt' },
        { id: 'ps_pa_taux_emprunt', min: 0, max: 20, defaut: 5, si: () => (nombre('ps_pa_emprunt') || 0) > 0, libelle: "Taux de l'emprunt (%/an)" },
        { id: 'ps_pa_duree_emprunt', min: 1, max: 30, defaut: 10, entier: true, si: () => (nombre('ps_pa_emprunt') || 0) > 0, libelle: "Durée de l'emprunt (ans)" },
        { id: 'ps_pa_taux_impot', min: 1, max: 50, defaut: 10, si: () => coche('ps_pa_impots'), libelle: "Taux d'imposition (%)" },
        { id: 'ps_pa_duree_amortissement', min: 1, max: 40, defaut: 20, entier: true, si: siLineaire, libelle: "Durée d'amortissement (ans)" },
        { id: 'ps_pa_amortissement_annuel', min: 1, max: 1000000, defaut: 1000, monnaie: true, si: () => siFiscal() && !siLineaire(), libelle: 'Amortissement annuel' },
        { id: 'ps_pa_taux', min: 1, max: 10, defaut: 3, libelle: "Taux d'actualisation du plan d'affaires (%)" },
    ];
    // Répartition proposée du Capex de la pompe solaire entre les trois lots (bouton « Répartir »).
    const REPARTITION_LOTS = { ps_pa_capex_materiel: 0.7, ps_pa_capex_genie_civil: 0.2, ps_pa_capex_transport: 0.1 };
    const TOLERANCE_SOMME_LOTS = 1; // miroir de TOLERANCE_SOMME_LOTS_CAPEX (schéma)
    const URL_PLAN_AFFAIRES = '/api/pompage_solaire/plan_affaires';
    // Référence personnalisée : lettres, chiffres, tiret (et espace), 30 caractères maximum.
    const MOTIF_REFERENCE = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9\- ]{1,30}$/;
    const CARACTERES_INTERDITS_REFERENCE = /[^A-Za-zÀ-ÖØ-öø-ÿ0-9\- ]/g;
    const CHOIX_PERSONNALISE = '__perso__';

    let construit = false;
    let graphIrradiation = null;
    let graphEau = null;
    let graphZoom = null;
    const graphsEco = {};
    let dernierResultat = null;
    let dernierInstantane = null; // saisies au moment du calcul (pour le rapport)
    let dernierEco = null;
    let dernierPlan = null;        // { resultat, params, devise, verification: {etat, ecarts} }
    let numeroCalculPlan = 0;      // ignore les réponses serveur d'un calcul dépassé
    const graphsPlan = {};
    let catalogue = null;
    let chargementCatalogue = null;
    let choixPompeRestaure = '';
    let imageRapportCache = null;
    let iframeProduction = null;
    let derniereProduction = null; // { mensuelKwh, summary, fields, champs } du dernier calcul réel
    let projetCharge = null;       // projet dont la section affiche les données
    let persistance = 'inactive';  // 'chargement' | 'active' | 'inactive' (sans projet, ou chargement en échec)
    let minuterieSauvegarde = null;
    let resultatsAEnvoyer;         // undefined : inchangés depuis la dernière sauvegarde ; objet : nouveau calcul
    let ecouteursGlobaux = false;

    const $ = (id) => document.getElementById(id);
    const val = (id) => { const el = $(id); return el ? el.value : ''; };
    const txt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    const echapper = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function nombre(id) {
        const brut = String(val(id)).trim().replace(',', '.');
        if (brut === '') return null;
        const n = Number(brut);
        return Number.isFinite(n) ? n : null;
    }

    function fr(n, dec) {
        return Number(n).toLocaleString('fr-FR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
    }

    function symboleDevise() { return DEVISES[val('ps_eco_devise')] || '€'; }
    function monnaie(v, sym) { return `${fr(Math.round(Number(v) || 0))} ${sym || symboleDevise()}`; }

    function message(texte, type, duree) {
        if (typeof window.showMessage === 'function') window.showMessage(texte, type, duree || 4000);
        else if (type === 'error') console.error(texte);
    }

    // ---------------------------------------------------------------------------------------
    // Balisage
    // ---------------------------------------------------------------------------------------

    const STYLE_AIDE = 'color: var(--text-secondary); font-size: 0.78rem; margin-top: 0.25rem; line-height: 1.3;';
    const STYLE_SOUS_TITRE = 'margin-top: 1.5rem; margin-bottom: 0.75rem; text-align: left; border-bottom: 1px dashed var(--border-color); padding-bottom: 0.5rem; font-size: 1rem; font-weight: 600;';
    const STYLE_BANDEAU = 'display:none; background:#fef2f2; color:#991b1b; border:1px solid #fecaca; border-radius:6px; padding:10px 14px; margin:0.75rem 0 0; font-size:0.85rem; font-weight:500;';

    function attrsBornes(r, step) {
        return `min="${r.min}" max="${r.max}" step="${step || 'any'}"`;
    }

    function champNombre(id, libelle, valeur, attrs, aide) {
        return `<div class="input-group">
            <label for="${id}">${libelle}</label>
            <input type="number" id="${id}" class="modern-input" value="${valeur}" ${attrs || ''}>
            ${aide ? `<small style="${STYLE_AIDE}">${aide}</small>` : ''}
        </div>`;
    }

    /** « Plage : min – max unité. » ; le maximum d'un montant suit la devise (cf. borneMax). */
    function textePlage(r, unite) {
        const max = borneMax(r);
        return `Plage : ${fr(r.min, r.min % 1 ? 2 : 0)} – ${fr(max, max % 1 ? 2 : 0)}${unite ? ' ' + unite : ''}.`;
    }

    function champRegle(regles, id, libelle, step, aide, unite) {
        const r = regles.find((x) => x.id === id);
        const plage = `<span class="ps-plage" data-regle="${id}" data-unite="${unite || ''}">${textePlage(r, unite)}</span>`;
        return champNombre(id, libelle, r.defaut === undefined ? '' : r.defaut, attrsBornes(r, step),
            aide ? `${aide} ${plage}` : plage);
    }

    // Ligne du tableau « Résultats du dimensionnement » (remplace les anciennes cartes colorées).
    // La ligne garde l'id `${id}-card` : afficher() masque celle de l'installation envisagée.
    function ligneResultat(id, titre, unite, classe) {
        return `<tr class="ps-result-ligne" id="${id}-card"${classe === 'design' ? ' style="display:none;"' : ''}>
            <td>${titre}</td>
            <td><strong id="${id}">--</strong><span id="${id}_detail" style="display:none; margin-left:0.4rem; font-size:0.75rem; color:var(--text-secondary);"></span></td>
            <td>${unite}</td>
        </tr>`;
    }

    // Carte d'indicateur économique : même charte que « Indicateurs de performance énergétique »
    // du module Production solaire (.stats-grid / .stat-card de style_autonconso.css, non chargé
    // dans cette iframe, d'où les classes ps-stat-* reprises dans le <style> de la section).
    function carteIndicateur(id, titre) {
        return `<div class="ps-stat-card" id="${id}-card">
            <div class="ps-stat-label">${titre}</div>
            <div class="ps-stat-value"><span id="${id}">--</span></div>
            <p id="${id}_detail" style="margin: 0.3rem 0 0; font-size: 0.75rem; color: var(--text-secondary); display:none;"></p>
        </div>`;
    }

    function carteGraphique(canvasId, titre, zoom) {
        return `<div class="energy-card" style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: var(--border-radius-md); padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.5rem;">
                <span id="${canvasId}_titre" style="font-size: 0.95rem; font-weight: 600; color: #1e293b;">${titre}</span>
                ${zoom ? `<button type="button" class="btn-base btn-secondary ps-btn-zoom" data-chart="${zoom}" title="Agrandir le graphique"
                    style="padding: 0.35rem 0.75rem; font-size: 0.8rem; display: flex; align-items: center; gap: 0.35rem; cursor: pointer; border-radius: 6px; text-transform: none;">
                    <span>🔍</span> <span>Zoom</span></button>` : ''}
            </div>
            <div style="position: relative; height: 320px; width: 100%;"><canvas id="${canvasId}"></canvas></div>
        </div>`;
    }

    // ---------------------------------------------------------------------------------------
    // Circuit hydraulique : schémas de principe (dessins originaux, SVG)
    // ---------------------------------------------------------------------------------------
    // Un même dessin sert aux vignettes de la section 1 (compact : sans texte ni repère), à la modale
    // « circuit hydraulique » et au rapport PDF (SVG converti en image). Repères numérotés = légende
    // de composantsCircuit().

    const COULEURS_SCHEMA = {
        dc: '#f59e0b', ac: '#dc2626', signal: '#64748b', eau: '#2563eb', eauFond: '#bfdbfe',
        ciel: '#f0f9ff', sol: '#ead9b8', solTrait: '#a16207', metal: '#475569',
    };

    /** Composants numérotés du circuit, dans l'ordre de la légende. */
    function composantsCircuit(systeme, typePompe) {
        const surface = typePompe === 'surface';
        const liste = [
            { cle: 'pv', nom: 'Générateur photovoltaïque', role: "Modules sur support fixe, orientés selon l'inclinaison et l'azimut saisis." },
            { cle: 'controleur', nom: 'Contrôleur / onduleur de pompe (MPPT)', role: 'Suivi du point de puissance maximale, protections (marche à sec, surtension), arrêt sur niveau haut du réservoir.' },
        ];
        if (systeme === 'groupe') {
            liste.push({ cle: 'appoint', nom: "Groupe électrogène d'appoint", role: "Relaie le solaire par un inverseur de source quand l'ensoleillement ne suffit pas." });
        } else if (systeme === 'batteries') {
            liste.push({ cle: 'appoint', nom: 'Batteries de secours et régulateur de charge', role: 'Stockent le surplus solaire pour pomper le soir ou par temps couvert ; protection contre la décharge profonde.' });
        }
        liste.push({ cle: 'cable', nom: "Câble d'alimentation de la pompe", role: surface ? "Enterré sous fourreau jusqu'à la pompe." : 'Câble immergeable, descendu dans le forage avec la colonne de refoulement.' });
        if (surface) {
            liste.push(
                { cle: 'aspiration', nom: "Crépine, clapet de pied et conduite d'aspiration", role: "Hauteur d'aspiration limitée à 7 m ; conduite étanche, sans point haut." },
                { cle: 'pompe', nom: 'Pompe de surface', role: "Sur socle, à l'abri, au plus près du point d'eau." },
            );
        } else {
            liste.push({ cle: 'pompe', nom: 'Pompe immergée', role: 'Sous le niveau dynamique du forage, avec protection contre la marche à sec.' });
        }
        liste.push(
            { cle: 'refoulement', nom: 'Conduite de refoulement', role: 'Diamètre choisi pour limiter les pertes de charge (vitesse de 0,5 à 2 m/s).' },
            { cle: 'clapet', nom: "Clapet anti-retour et vanne d'isolement", role: "Empêchent la vidange de la conduite et isolent la pompe pour l'entretien." },
            { cle: 'reservoir', nom: "Réservoir de stockage d'eau", role: 'Réservoir surélevé (château d’eau) : stockage pour la nuit et les jours couverts.' },
            { cle: 'niveau', nom: 'Interrupteur de niveau', role: 'Arrête la pompe quand le réservoir est plein (liaison filaire vers le contrôleur).' },
            { cle: 'distribution', nom: 'Distribution', role: 'Bornes-fontaines, abreuvoirs ou irrigation, par gravité.' },
        );
        return liste.map((c, i) => Object.assign({ n: i + 1 }, c));
    }

    /**
     * Schéma du circuit (SVG autonome, 900 x 520).
     * @param {string} systeme  fil_soleil | groupe | batteries
     * @param {string} typePompe  forage | surface
     * @param {{compact?: boolean, cotes?: string}} options  compact : vignette sans texte ni repère ;
     *   cotes : ligne de cotes (hauteurs) affichée en haut du schéma.
     */
    function schemaCircuit(systeme, typePompe, options) {
        const o = options || {};
        const compact = !!o.compact;
        const surface = typePompe === 'surface';
        const K = COULEURS_SCHEMA;
        const SOL = 300;
        const num = {};
        composantsCircuit(systeme, typePompe).forEach((c) => { num[c.cle] = c.n; });
        const out = [];
        const add = (x) => out.push(x);
        const repere = (cle, x, y) => {
            if (compact || !num[cle]) return;
            add(`<circle cx="${x}" cy="${y}" r="11" fill="#dc2626" stroke="#ffffff" stroke-width="2"/>`
                + `<text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="12" font-weight="700" fill="#ffffff">${num[cle]}</text>`);
        };
        const texte = (x, y, t, ancre, taille, couleur) => {
            if (compact) return;
            add(`<text x="${x}" y="${y}" text-anchor="${ancre || 'start'}" font-size="${taille || 12}" fill="${couleur || '#1e293b'}">${echapper(t)}</text>`);
        };
        const trait = (d, couleur, epaisseur, pointilles) => add(`<path d="${d}" fill="none" stroke="${couleur}" stroke-width="${epaisseur}"`
            + ` stroke-linejoin="round" stroke-linecap="round"${pointilles ? ` stroke-dasharray="${pointilles}"` : ''}/>`);
        const fleche = (x, y1, y2, libelle) => {
            if (compact) return;
            add(`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#0f172a" stroke-width="1.2"/>`
                + `<polygon points="${x - 4},${y1 + 7} ${x + 4},${y1 + 7} ${x},${y1}" fill="#0f172a"/>`
                + `<polygon points="${x - 4},${y2 - 7} ${x + 4},${y2 - 7} ${x},${y2}" fill="#0f172a"/>`);
            texte(x - 6, (y1 + y2) / 2 + 4, libelle, 'end', 12, '#0f172a');
        };

        // Ciel, sol, soleil
        add(`<rect x="0" y="0" width="900" height="${SOL}" fill="${K.ciel}"/>`);
        add(`<rect x="0" y="${SOL}" width="900" height="${520 - SOL}" fill="${K.sol}"/>`);
        add(`<line x1="0" y1="${SOL}" x2="900" y2="${SOL}" stroke="${K.solTrait}" stroke-width="2"/>`);
        for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4;
            add(`<line x1="${(70 + 32 * Math.cos(a)).toFixed(1)}" y1="${(62 + 32 * Math.sin(a)).toFixed(1)}" x2="${(70 + 46 * Math.cos(a)).toFixed(1)}" y2="${(62 + 46 * Math.sin(a)).toFixed(1)}" stroke="#f59e0b" stroke-width="4" stroke-linecap="round"/>`);
        }
        add('<circle cx="70" cy="62" r="25" fill="#fbbf24" stroke="#f59e0b" stroke-width="2"/>');
        if (!compact && o.cotes) {
            add(`<rect x="250" y="16" width="${Math.min(620, 40 + o.cotes.length * 6.6)}" height="30" rx="6" fill="#ffffff" stroke="#cbd5e1"/>`);
            texte(266, 36, o.cotes, 'start', 13, '#0f172a');
        }

        // 1. Générateur photovoltaïque (3 modules inclinés sur support)
        [[128, 205], [270, 205], [150, 160], [290, 160]].forEach(([x, y]) => add(`<line x1="${x}" y1="${y}" x2="${x}" y2="${SOL}" stroke="${K.metal}" stroke-width="3"/>`));
        for (let i = 0; i < 3; i++) {
            const x = 120 + i * 56;
            add(`<polygon points="${x},205 ${x + 50},205 ${x + 64},158 ${x + 14},158" fill="#1e3a8a" stroke="#0f172a" stroke-width="1.5"/>`);
            add(`<path d="M${x + 4.7} 189.3 H${x + 54.7} M${x + 9.3} 173.7 H${x + 59.3} M${x + 25} 205 L${x + 39} 158" stroke="#93c5fd" stroke-width="0.8" fill="none"/>`);
        }
        texte(208, 146, 'Générateur PV', 'middle');
        repere('pv', 106, 150);

        // 2. Contrôleur sur poteau, câble DC depuis le générateur
        trait('M270 230 H330', K.dc, 3.5);
        add(`<line x1="362" y1="261" x2="362" y2="${SOL}" stroke="${K.metal}" stroke-width="4"/>`);
        add('<rect x="330" y="205" width="64" height="56" rx="6" fill="#f8fafc" stroke="#334155" stroke-width="2"/>');
        add('<rect x="340" y="214" width="44" height="14" rx="2" fill="#22c55e"/>');
        add('<circle cx="346" cy="244" r="3.5" fill="#334155"/><circle cx="358" cy="244" r="3.5" fill="#334155"/><circle cx="370" cy="244" r="3.5" fill="#dc2626"/>');
        texte(362, 197, 'Contrôleur', 'middle');
        repere('controleur', 404, 200);

        // 3. Appoint : groupe électrogène ou batteries de secours
        if (systeme === 'groupe') {
            add('<rect x="436" y="294" width="108" height="6" fill="#334155"/>');
            add('<rect x="440" y="250" width="100" height="44" rx="5" fill="#15803d" stroke="#14532d" stroke-width="2"/>');
            add('<path d="M452 260 V284 M460 260 V284 M468 260 V284 M476 260 V284" stroke="#bbf7d0" stroke-width="2"/>');
            add('<rect x="496" y="260" width="34" height="16" rx="2" fill="#f8fafc"/><rect x="520" y="236" width="7" height="14" fill="#334155"/>');
            trait('M440 268 H412 V240 H394', K.ac, 3);
            texte(490, 240, 'Groupe électrogène', 'middle');
            repere('appoint', 556, 250);
        } else if (systeme === 'batteries') {
            add('<rect x="440" y="234" width="100" height="64" rx="5" fill="#e2e8f0" stroke="#334155" stroke-width="2"/>');
            for (let i = 0; i < 3; i++) {
                const x = 450 + i * 30;
                add(`<rect x="${x}" y="252" width="24" height="40" rx="2" fill="#1f2937"/><rect x="${x + 4}" y="247" width="5" height="5" fill="#dc2626"/><rect x="${x + 15}" y="247" width="5" height="5" fill="#0f172a"/><rect x="${x + 3}" y="262" width="18" height="6" fill="#22c55e"/>`);
            }
            trait('M440 262 H412 V240 H394', K.dc, 3);
            texte(490, 226, 'Batteries', 'middle');
            repere('appoint', 556, 240);
        }

        // Câble de la pompe (enterré), liaison de l'interrupteur de niveau (pointillés). En surface, ils
        // passent sous le fond du point d'eau.
        const yCable = surface ? 430 : 318;
        trait(surface ? `M380 261 V${yCable} H691 V290` : `M380 261 V${yCable} H575 V296 H593`, K.dc, 2.5);
        repere('cable', 470, yCable);
        trait(`M840 146 V100 H888 V${surface ? 444 : 332} H350 V261`, K.signal, 2, '6 4');

        // Point d'eau, pompe et conduites
        const tour = 'H720 V112 H768 V128';
        if (surface) {
            add('<polygon points="540,300 555,400 620,400 635,300" fill="#d6d3d1" stroke="#78716c" stroke-width="2"/>');
            add(`<polygon points="544.5,330 555,400 620,400 630.5,330" fill="${K.eauFond}"/>`);
            add(`<line x1="544.5" y1="330" x2="630.5" y2="330" stroke="${K.eau}" stroke-width="1.5" stroke-dasharray="5 3"/>`);
            texte(588, 418, "Point d'eau", 'middle', 11);
            add('<rect x="579" y="380" width="12" height="14" fill="#475569"/><path d="M579 384 H591 M579 388 H591" stroke="#cbd5e1" stroke-width="1"/>');
            trait('M585 380 V286 H650', K.eau, 5);
            add('<rect x="645" y="292" width="70" height="8" fill="#a8a29e"/>');
            add('<circle cx="662" cy="279" r="12" fill="#475569" stroke="#1f2937" stroke-width="1.5"/><rect x="674" y="268" width="34" height="22" rx="4" fill="#334155"/>');
            trait(`M662 267 V248 ${tour}`, K.eau, 5);
            add(`<circle cx="684" cy="248" r="7" fill="#ffffff" stroke="#0f172a" stroke-width="1.5"/><polygon points="680,244 680,252 689,248" fill="#0f172a"/>`);
            add('<polygon points="698,241 698,255 712,241 712,255" fill="#ffffff" stroke="#0f172a" stroke-width="1.5"/>');
            repere('aspiration', 522, 362);
            repere('pompe', 634, 262);
            repere('clapet', 694, 228);
            repere('refoulement', 706, 180);
            fleche(530, 279, 330, 'Ha');
        } else {
            add('<rect x="585" y="300" width="30" height="205" fill="#d6d3d1" stroke="#57534e" stroke-width="1.5"/>');
            add('<rect x="590" y="300" width="20" height="205" fill="#f5f5f4"/>');
            add(`<rect x="590" y="395" width="20" height="110" fill="${K.eauFond}"/>`);
            add(`<line x1="560" y1="395" x2="640" y2="395" stroke="${K.eau}" stroke-width="1.5" stroke-dasharray="5 3"/>`);
            texte(646, 399, 'Niveau dynamique', 'start', 11);
            texte(646, 500, 'Forage', 'start', 11);
            trait(`M600 455 V285 ${tour}`, K.eau, 5);
            trait('M593 296 V458', K.dc, 2.5); // câble immergeable le long de la colonne
            add('<rect x="594" y="455" width="12" height="38" rx="3" fill="#334155"/><path d="M594 463 H606 M594 471 H606" stroke="#94a3b8" stroke-width="1"/>');
            add('<rect x="582" y="290" width="36" height="10" fill="#64748b"/>');
            add(`<circle cx="650" cy="285" r="7" fill="#ffffff" stroke="#0f172a" stroke-width="1.5"/><polygon points="646,281 646,289 655,285" fill="#0f172a"/>`);
            add('<polygon points="676,278 676,292 690,278 690,292" fill="#ffffff" stroke="#0f172a" stroke-width="1.5"/>');
            repere('pompe', 626, 470);
            repere('clapet', 664, 264);
            repere('refoulement', 706, 200);
            fleche(566, SOL, 395, 'Hd');
        }

        // Réservoir surélevé, interrupteur de niveau, distribution
        add('<path d="M750 212 V300 M850 212 V300 M750 240 L850 290 M850 240 L750 290" stroke="#57534e" stroke-width="3" fill="none"/>');
        add('<polygon points="736,120 800,98 864,120" fill="#94a3b8" stroke="#334155" stroke-width="1.5"/>');
        add('<rect x="740" y="120" width="120" height="92" rx="4" fill="#e2e8f0" stroke="#334155" stroke-width="2"/>');
        add(`<rect x="742" y="150" width="116" height="60" fill="${K.eauFond}"/><line x1="742" y1="150" x2="858" y2="150" stroke="${K.eau}" stroke-width="1.5"/>`);
        add('<line x1="840" y1="124" x2="840" y2="146" stroke="#334155" stroke-width="1.5"/><circle cx="840" cy="152" r="6" fill="#f97316" stroke="#7c2d12" stroke-width="1.5"/>');
        trait('M800 212 V270 H872', K.eau, 4);
        add('<rect x="866" y="262" width="12" height="10" fill="#334155"/><path d="M872 276 q-4 7 0 10 q4 -3 0 -10" fill="#3b82f6"/>');
        texte(800, 90, 'Réservoir', 'middle');
        repere('reservoir', 724, 140);
        repere('niveau', 866, 82);
        repere('distribution', 846, 252);
        fleche(735, 116, SOL, 'Hr');

        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 520" width="900" height="520" font-family="Arial, Helvetica, sans-serif" role="img" aria-label="${echapper(`Circuit : ${SYSTEMES[systeme] ? SYSTEMES[systeme].libelle : ''}, ${surface ? 'pompe de surface' : 'pompe immergée'}`)}">${out.join('')}</svg>`;
    }

    /** Ligne de cotes du schéma (hauteurs saisies, HMT du dernier calcul). */
    function cotesCircuit() {
        const surface = val('ps_pump_type') === 'surface';
        const h1 = nombre('ps_h_aspiration');
        const h2 = nombre('ps_h_tank');
        const parts = [];
        if (h1 !== null) parts.push(`${surface ? 'Ha (aspiration)' : 'Hd (niveau dynamique)'} = ${fr(h1, 1)} m`);
        if (h2 !== null) parts.push(`Hr (refoulement) = ${fr(h2, 1)} m`);
        if (dernierResultat) parts.push(`HMT = ${fr(dernierResultat.hmt, 1)} m`);
        return parts.join('   ·   ');
    }

    function legendeCircuitHtml(systeme, typePompe) {
        return `<ol style="margin:0; padding:0; list-style:none; display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:0.4rem 1rem;">`
            + composantsCircuit(systeme, typePompe).map((c) => `<li style="display:flex; gap:0.5rem; font-size:0.82rem; line-height:1.35;">
                <span style="flex:none; width:1.4rem; height:1.4rem; border-radius:50%; background:#dc2626; color:#fff; font-weight:700; font-size:0.75rem; display:flex; align-items:center; justify-content:center;">${c.n}</span>
                <span><strong>${echapper(c.nom)}</strong><br><span style="color:var(--text-secondary);">${echapper(c.role)}</span></span></li>`).join('')
            + '</ol>';
    }

    function ouvrirCircuit() {
        const modal = $('ps_circuit_modal');
        if (!modal) return;
        const sys = systemeChoisi();
        const type = val('ps_pump_type') === 'surface' ? 'surface' : 'forage';
        txt('ps_circuit_titre', `Circuit hydraulique — ${SYSTEMES[sys].libelle} (${type === 'surface' ? 'pompe de surface' : 'pompe immergée'})`);
        $('ps_circuit_corps').innerHTML = `
            <div style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; background:#fff;">${schemaCircuit(sys, type, { cotes: cotesCircuit() }).replace('width="900" height="520"', 'style="width:100%; height:auto; display:block;"')}</div>
            <p style="margin:0.75rem 0; font-size:0.82rem; color:#1e293b;">${echapper(SYSTEMES[sys].description)}</p>
            <div style="display:flex; gap:1.25rem; flex-wrap:wrap; font-size:0.78rem; color:var(--text-secondary); margin-bottom:0.75rem;">
                <span><span style="display:inline-block; width:22px; height:0; border-top:4px solid ${COULEURS_SCHEMA.eau}; vertical-align:middle;"></span> Eau</span>
                <span><span style="display:inline-block; width:22px; height:0; border-top:3px solid ${COULEURS_SCHEMA.dc}; vertical-align:middle;"></span> Courant continu (PV, batteries, pompe)</span>
                ${sys === 'groupe' ? `<span><span style="display:inline-block; width:22px; height:0; border-top:3px solid ${COULEURS_SCHEMA.ac}; vertical-align:middle;"></span> Courant alternatif (groupe)</span>` : ''}
                <span><span style="display:inline-block; width:22px; height:0; border-top:2px dashed ${COULEURS_SCHEMA.signal}; vertical-align:middle;"></span> Commande (niveau)</span>
            </div>
            ${legendeCircuitHtml(sys, type)}
            <p style="margin:0.75rem 0 0; font-size:0.72rem; color:var(--text-secondary);">Schéma de principe, sans échelle : implantation et équipements à confirmer par l'étude d'exécution.</p>`;
        modal.style.display = 'flex';
    }

    function fermerCircuit() { const m = $('ps_circuit_modal'); if (m) m.style.display = 'none'; }

    /** SVG -> image PNG sur fond blanc (rapport PDF) ; null si le navigateur ne sait pas le rendre. */
    function svgEnImage(svg, largeur, hauteur) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const c = document.createElement('canvas');
                    c.width = largeur;
                    c.height = hauteur;
                    const ctx = c.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, largeur, hauteur);
                    ctx.drawImage(img, 0, 0, largeur, hauteur);
                    resolve({ data: c.toDataURL('image/png'), w: largeur, h: hauteur });
                } catch (e) { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
    }

    /** Section 1 : type de système, vignettes des schémas, bouton du circuit hydraulique. */
    function balisageSysteme() {
        const cartes = Object.keys(SYSTEMES).map((cle) => `
            <label class="ps-systeme-carte" data-systeme="${cle}">
                <span style="display:flex; align-items:center; gap:0.5rem; font-weight:700; color:#1e293b; font-size:0.92rem;">
                    <input type="radio" name="ps_systeme_choix" value="${cle}" style="width:16px; height:16px; margin:0; cursor:pointer;"> ${SYSTEMES[cle].libelle}</span>
                <span class="ps-schema-mini" data-schema="${cle}"></span>
                <small style="${STYLE_AIDE}">${SYSTEMES[cle].description}</small>
            </label>`).join('');
        return `
        <div id="ps_section_systeme" class="ps-section" style="background:#ffffff; border:1px solid #cbd5e1; border-radius: var(--border-radius-lg); padding: 1.25rem 1.5rem; box-shadow: 0 2px 6px rgba(0,0,0,0.04);">
            <h3 class="ps-titre-section">1. Type de système de pompage solaire</h3>
            <p style="margin:0 0 0.9rem; font-size:0.8rem; color:var(--text-secondary);">Choisissez le type de pompe puis l'architecture du système. Les schémas suivent le type de pompe choisi.</p>
            <h4 id="ps_type_pompe_label" style="${STYLE_SOUS_TITRE} margin-top:0;">Type de pompe</h4>
            <input type="hidden" id="ps_pump_type" value="forage">
            <div class="ps-types-pompe" role="radiogroup" aria-labelledby="ps_type_pompe_label">
                <button type="button" class="ps-type-pompe-btn" data-type="forage" role="radio" aria-checked="false">Forage / puits profond (pompe immergée)</button>
                <button type="button" class="ps-type-pompe-btn" data-type="surface" role="radio" aria-checked="false">Pompe de surface</button>
            </div>
            <small style="${STYLE_AIDE} display:block; margin:0.35rem 0 1rem;">Pompe immergée : forage ou puits profond. Pompe de surface : aspiration limitée à 7 m.</small>
            <h4 style="${STYLE_SOUS_TITRE} margin-top:0;">Architecture du système</h4>
            <input type="hidden" id="ps_systeme" value="${SYSTEME_DEFAUT}">
            <div class="ps-systemes" role="radiogroup" aria-label="Type de système de pompage solaire">${cartes}</div>
            <div style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top:1rem;">
                <button type="button" id="ps_btn_circuit" class="btn-base btn-secondary"
                    style="text-transform:none; font-size:0.85rem; padding:0.45rem 0.9rem;">🔧 Afficher le circuit hydraulique</button>
                <span id="ps_systeme_resume" style="font-size:0.82rem; color:#1e293b;"></span>
            </div>
        </div>`;
    }

    function balisage() {
        return `
        <h2 class="capitalize-first" style="margin: 0 0 0.5rem 0; font-size: 1.5rem; font-weight: 700; color: var(--accent-primary);">Pompage solaire</h2>
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0; margin-bottom: 1.25rem; line-height: 1.4;">
            Dimensionnement d'un système de pompage solaire : au fil du soleil, avec groupe électrogène
            d'appoint ou avec batteries de secours. L'ensoleillement est celui du site, déterminé à
            partir de l'adresse du projet.</p>

        <div style="background-color: #f8fafc; border: 1px solid var(--border-color); border-radius: var(--border-radius-md); padding: 0.75rem 1rem; margin-bottom: 1.25rem;">
            <p style="margin:0; font-size:0.85rem; color: var(--text-primary);">
                <strong style="color: var(--text-secondary);">Site :</strong>
                <span id="ps_site_libelle" style="font-weight: 600;">–</span>
                <span id="ps_site_coords" style="color: var(--text-secondary); font-size: 0.8rem;"></span></p>
            <p id="ps_site_avertissement" style="margin:0.35rem 0 0; font-size:0.75rem; color:#b45309; display:none;"></p>
        </div>

        ${balisageSysteme()}

        <div id="ps_formulaire" class="energy-card ps-section" style="background:#ffffff; border:1px solid #cbd5e1; border-radius: var(--border-radius-lg); padding: 1.25rem 1.5rem; box-shadow: 0 2px 6px rgba(0,0,0,0.04);">
            <h3 class="ps-titre-section">2. Prédimensionnement système de pompage solaire</h3>
            <p style="margin:0; font-size:0.8rem; color:var(--text-secondary);">Renseignez la ressource solaire, l'hydraulique du site et, si elle est connue, l'installation envisagée.</p>

            <h4 style="${STYLE_SOUS_TITRE} margin-top:1rem;">Ressource solaire</h4>
            <div class="input-grid-2x">
                ${champRegle(REGLES, 'ps_angle', 'Inclinaison des panneaux (°)', '1', '', '°')}
                ${champRegle(REGLES, 'ps_aspect', 'Azimut (° — 0 = plein sud)', '1', '', '°')}
                ${champRegle(REGLES, 'ps_perte_systeme', 'Pertes du système (%)', '0.1',
            'Rendement global hors pompe (PR). 18 % = valeur par défaut.', '%')}
            </div>
            <p id="ps_parametres_calepinage_statut" style="display:none; margin:0.5rem 0 0; font-size:0.8rem;"></p>

            <h4 style="${STYLE_SOUS_TITRE}">Hydraulique</h4>
            <div class="input-grid-2x">
                ${champNombre('ps_h_aspiration', H_ASPIRATION.forage.libelle, H_ASPIRATION.forage.defaut,
                'min="0.1" max="100" step="0.1"', '<span id="ps_h_aspiration_aide">Plage : 0,1 – 100 m.</span>')}
                ${champRegle(REGLES, 'ps_h_tank', 'Hauteur de refoulement (m)', '0.1', '', 'm')}
                ${champRegle(REGLES, 'ps_daily_need', 'Besoin journalier (m³/j)', '0.1', '', 'm³/j')}
                ${champRegle(REGLES, 'ps_losses_pipe', 'Pertes de charge (%)', '0.1', '', '%')}
                ${champRegle(REGLES, 'ps_pump_efficiency', 'Rendement global moteur + pompe', '0.01',
                    "0,6 = 60 % : part de l'énergie électrique reçue par la pompe qui devient énergie hydraulique. Une pompe choisie avec ses courbes indique son rendement réel.")}
            </div>
            <div style="display:flex; align-items:center; gap:1rem; margin-top:0.75rem; flex-wrap:wrap;">
                <p style="margin:0; font-size:0.875rem;">Hauteur géométrique :
                    <strong style="color: var(--text-primary);"><span id="ps_h_geo_display">45.0</span> m</strong></p>
                <button type="button" id="ps_btn_pertes" class="btn-base btn-secondary"
                    style="text-transform:none; font-size:0.85rem; padding:0.4rem 0.85rem;">Calculer les pertes de charge…</button>
            </div>
            <div id="ps_pertes_calculatrice" class="energy-card" style="display:none; padding:1rem; margin-top:1rem; background-color: #f8fafc; border: 1px solid var(--border-color);">
                <div class="input-grid-2x">
                    <div class="input-group">
                        <label for="ps_m_material">Matériau de la conduite</label>
                        <select id="ps_m_material" class="modern-input">
                            <option value="150">PVC / PEHD (C=150)</option>
                            <option value="130">Fonte (C=130)</option>
                            <option value="100">Acier (C=100)</option>
                        </select>
                    </div>
                    ${champRegle(REGLES_CALCULATRICE, 'ps_m_length', 'Longueur de conduite (m)', '1', '', 'm')}
                    ${champRegle(REGLES_CALCULATRICE, 'ps_m_diam', 'Diamètre intérieur (mm)', '0.1', '', 'mm')}
                    ${champRegle(REGLES_CALCULATRICE, 'ps_m_flow', 'Débit (m³/h)', '0.1', '', 'm³/h')}
                    ${champRegle(REGLES_CALCULATRICE, 'ps_m_acc', 'Coefficient accessoires', '0.01',
                    'Coudes, vannes, clapets selon la complexité du réseau.')}
                </div>
                <p style="margin:0.5rem 0 0; font-size:0.85rem;">Vitesse : <strong><span id="ps_m_velocity">–</span> m/s</strong>
                    <span id="ps_m_velocity_status" style="font-size:0.75rem;"></span>
                    &nbsp;|&nbsp; Pertes : <strong><span id="ps_m_res_val">–</span> m</strong></p>
                <div id="ps_calc_validation_banner" style="${STYLE_BANDEAU}"></div>
                <button type="button" id="ps_btn_apply_losses" class="btn-base btn-secondary"
                    style="text-transform:none; margin-top:0.75rem; font-size:0.85rem; padding:0.4rem 0.85rem;">Reporter dans « Pertes de charge (%) »</button>
            </div>

            <h4 style="${STYLE_SOUS_TITRE}">Installation envisagée (facultatif)</h4>
            <div class="input-grid-2x">
                ${champRegle(REGLES, 'ps_puissance_reelle_installee_kwc', 'Puissance PV installée (kWc)', '0.1',
                'Laisser vide ou à 0 pour ne voir que la puissance théorique nécessaire.', 'kWc')}
                ${champRegle(REGLES, 'ps_coef_surdimensionnement', 'Coefficient de surdimensionnement', '0.01',
                    'Puissance PV nécessaire = puissance calculée × ce coefficient.')}
                <div id="ps_grp_ps_coef_reduction_pomp">${champRegle(REGLES, 'ps_coef_reduction_pomp', 'Coefficient de réduction', '0.01',
                    'Tient compte du seuil de démarrage de la pompe (pompage au fil du soleil).')}</div>
                <div id="ps_grp_ps_conso_specifique_ge">${champRegle(REGLES, 'ps_conso_specifique_ge', "Conso. spécifique du groupe d'appoint (L/kWh)", '0.01',
                        'Carburant du déficit pompé par le groupe, et carburant économisé grâce au solaire.', 'L/kWh')}</div>
                <div id="ps_grp_ps_facteur_emission_co2">${champRegle(REGLES, 'ps_facteur_emission_co2', "Facteur d'émission du groupe (kgCO₂/kWh)", '0.01', 'Émissions du groupe électrogène par kWh produit : base du CO₂ évité.', 'kgCO₂/kWh')}</div>
            </div>

            <div id="ps_bloc_batteries" style="display:none;">
                <h4 style="${STYLE_SOUS_TITRE}">Batteries de secours</h4>
                <div class="input-grid-2x">
                    ${champRegle(REGLES, 'ps_bat_autonomie', 'Autonomie des batteries (jours)', '0.1',
                        "Jours de pompage assurés par les batteries seules (nuit, temps couvert).", 'j')}
                    ${champRegle(REGLES, 'ps_bat_dod', 'Profondeur de décharge (%)', '1',
                        'Part de la capacité utilisable : 80 à 90 % en lithium, 50 % en plomb.', '%')}
                    ${champRegle(REGLES, 'ps_bat_rendement', 'Rendement aller-retour des batteries (%)', '1',
                        "Appliqué à toute l'énergie solaire (hypothèse prudente) : remplace le coefficient de réduction.", '%')}
                </div>
            </div>

            <div id="ps_validation_banner" style="${STYLE_BANDEAU}"></div>
            <div style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top: 1.25rem;">
                <button type="button" id="ps_btn_calculate" class="btn-base btn-calculate-irve capitalize-first-letter"
                    style="margin:0;">dimensionner le système de pompage</button>
                <button type="button" id="ps_btn_extrait_calepinage" class="btn-base btn-secondary"
                    title="Ouvre un extrait du calepinage résidentiel : pente, panneau, onduleur et pertes système des champs PV"
                    style="text-transform:none; margin:0; font-size:0.85rem; padding:0.4rem 0.85rem;">Pente, matériels et pertes…</button>
                <label for="ps_integration_calepinage" style="display:flex; align-items:center; gap:0.45rem; font-size:0.9rem; font-weight:600; color:#1e293b; cursor:pointer; margin:0;">
                    <input type="checkbox" id="ps_integration_calepinage" checked style="width:17px; height:17px; margin:0; cursor:pointer;">
                    Intégration du calepinage des panneaux
                </label>
            </div>
            <p id="ps_calepinage_statut" style="margin:0.5rem 0 0; font-size:0.8rem; color:var(--text-secondary);"></p>
            <p id="ps_avis_dim" role="status" style="display:none; background:#fffbeb; color:#92400e; border:1px solid #fde68a; border-radius:6px; padding:8px 12px; margin:0.75rem 0 0; font-size:0.85rem; font-weight:500;"></p>
        </div>

        <div id="ps_resultats" style="display:none; margin-top: 1.75rem; background-color: #edf2f7; border: 1px solid #cbd5e1; border-radius: var(--border-radius-lg); padding: 1.5rem; box-shadow: 0 2px 6px rgba(0,0,0,0.04);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem; border-bottom: 1px dashed var(--border-color); padding-bottom: 0.75rem;">
                <h3 class="ps-titre-section" style="margin:0;">3. Résultats du dimensionnement</h3>
                <!-- Rapports PDF : palette « Exports » à droite de la modale (pompage_solaire_exports.js). -->
            </div>

            <p id="ps_avis_irradiation" role="status" style="display:none; background:#fef2f2; color:#991b1b; border:1px solid #fecaca; border-radius:6px; padding:8px 12px; margin:0 0 0.75rem; font-size:0.85rem; font-weight:500;"></p>
            <div style="overflow-x:auto; border:1px solid #e2e8f0; border-radius:8px;">
                <table id="ps_table_resultats" class="ps-table ps-table-dim">
                    <thead><tr><th>Grandeur</th><th>Valeur</th><th>Unité</th></tr></thead>
                    <tbody>
                        ${ligneResultat('ps_res_hmt', 'Hauteur manométrique totale (HMT)', 'm')}
                        ${ligneResultat('ps_res_pv', 'Puissance PV nécessaire', 'kWc')}
                        ${ligneResultat('ps_res_m3', 'Débit moyen', 'm³/h')}
                        ${ligneResultat('ps_res_pump', 'Puissance de la pompe', '')}
                        ${ligneResultat('ps_res_energy_pump', 'Énergie de pompage', 'MWh/an')}
                        ${ligneResultat('ps_res_energy_solar', 'Énergie solaire fournie', 'MWh/an')}
                        ${ligneResultat('ps_res_coverage', 'Taux de couverture (Théorique)', '%')}
                        <!-- Ligne « Énergie solaire (installation envisagée) » retirée à la demande : seul le taux de couverture de l'installation envisagée est affiché. -->
                        ${ligneResultat('ps_res_coverage_design', 'Taux de couverture (installation envisagée)', '%', 'design')}
                        ${ligneResultat('ps_res_annual_irradiation', 'Irradiation annuelle', 'kWh/m²/an')}
                        ${ligneResultat('ps_res_annual_need', "Besoin d'eau annuel", 'm³/an')}
                        ${ligneResultat('ps_res_fuel_savings', 'Carburant économisé', 'l/an')}
                        ${ligneResultat('ps_res_co2_avoided', 'CO₂ évité', 't/an')}
                        ${ligneResultat('ps_res_non_couvert', 'Besoin non couvert (déficit non pompé)', 'm³/an', 'design')}
                        ${ligneResultat('ps_res_groupe_volume', "Volume pompé par le groupe d'appoint", 'm³/an', 'design')}
                        ${ligneResultat('ps_res_groupe_carburant', "Carburant du groupe d'appoint", 'L/an', 'design')}
                        ${ligneResultat('ps_res_groupe_kva', "Puissance conseillée du groupe d'appoint", 'kVA', 'design')}
                        ${ligneResultat('ps_res_batt_nominale', 'Capacité nominale des batteries', 'kWh', 'design')}
                        ${ligneResultat('ps_res_batt_utile', "Énergie stockée utile (autonomie)", 'kWh', 'design')}
                        ${ligneResultat('ps_res_reservoir', "Réservoir de stockage d'eau conseillé", 'm³', 'design')}
                    </tbody>
                </table>
            </div>

            <!-- Production réelle du calepinage (case « Intégration du calepinage des panneaux ») -->
            <div id="ps_prod_card" class="energy-card" style="display:none; padding: 1rem 1.25rem; margin-top: 1.25rem; background-color: #ffffff; border: 1px solid #cbd5e1; border-left: 4px solid #f59e0b; border-radius: var(--border-radius-md);">
                <h4 style="margin:0 0 0.25rem; font-size:0.95rem; font-weight:700; color:#1e293b;">Production solaire réelle du calepinage</h4>
                <p style="margin:0 0 0.5rem; font-size:0.8rem; color:var(--text-secondary);">Calepinage de la carte, ombrage proche de la scène 3D, pertes système et onduleur. La production solaire alimente la pompe.</p>
                <p id="ps_prod_statut" style="margin:0 0 0.75rem; font-size:0.85rem; color:#1e293b;"></p>
                <div style="overflow-x:auto;"><table id="ps_prod_table" class="ps-table"></table></div>
                <div style="overflow-x:auto; margin-top:0.75rem;"><table id="ps_prod_champs" class="ps-table"></table></div>
                <h5 style="margin:1.25rem 0 0.5rem; font-size:0.9rem; font-weight:700; color:#1e293b;">Détail du module Production solaire</h5>
                <div id="ps_prod_iframe_hote" style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; background:#fff;"></div>
            </div>

            <!-- Recommandations : masquées à l'écran (toujours reprises dans le PDF), puis choix de la pompe -->
            <div class="energy-card" style="display:none; padding: 1rem 1.25rem; margin-top: 1.25rem; background-color: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; border-radius: var(--border-radius-md);">
                <h4 style="margin:0 0 0.5rem; font-size:0.95rem; font-weight:700; color: #92400e;">💡 Recommandations</h4>
                <ul id="ps_recommendations" style="font-size:0.85rem; margin:0; padding-left:1.25rem; line-height: 1.6; color: #1e293b;"></ul>
            </div>

            <!-- Choix de la pompe : masqué par défaut, affiché / masqué par ce bouton. -->
            <button type="button" id="ps_btn_pompe_toggle" class="btn-base btn-secondary" aria-expanded="false" aria-controls="ps_pompe_card"
                style="text-transform:none; font-size:0.85rem; padding:0.4rem 0.85rem; margin-top:1rem;">Afficher le choix de la pompe</button>
            <div id="ps_pompe_card" class="energy-card" style="display:none; padding: 1rem 1.25rem; margin-top: 0.75rem; background-color: #ffffff; border: 1px solid #cbd5e1; border-left: 4px solid #2563eb; border-radius: var(--border-radius-md);">
                <h4 style="margin:0 0 0.25rem; font-size:0.95rem; font-weight:700; color: #1e293b;">Choix de la pompe</h4>
                <p style="margin:0 0 0.75rem; font-size:0.8rem; color:var(--text-secondary);">Facultatif : le dimensionnement ci-dessus ne dépend pas de la pompe choisie. Les références marquées ★ couvrent le besoin : d'après leurs courbes de performance quand le catalogue les fournit (puissance PV requise indiquée, la plus sobre en tête), sinon d'après leur HMT et leur débit maximaux.</p>
                <div id="ps_pompe_suggestions" style="display:none; margin:0 0 0.75rem;"></div>
                <div class="input-grid-2x">
                    <div class="input-group">
                        <label for="ps_pompe_filtre_fabricant">Filtrer par fabricant</label>
                        <select id="ps_pompe_filtre_fabricant" class="modern-input"><option value="">Tous les fabricants</option></select>
                        <label style="display:flex; align-items:center; gap:0.4rem; font-size:0.8rem; margin-top:0.4rem; font-weight:400;">
                            <input type="checkbox" id="ps_pompe_filtre_reco" style="width:15px; height:15px; margin:0;"> Afficher uniquement les pompes recommandées</label>
                    </div>
                    <div class="input-group">
                        <label for="ps_pompe_choix">Référence de la pompe</label>
                        <select id="ps_pompe_choix" class="modern-input">
                            <option value="">Fabricant par défaut (aucune pompe imposée)</option>
                            <option value="${CHOIX_PERSONNALISE}">Référence personnalisée…</option>
                        </select>
                        <input type="text" id="ps_reference_pompe_installee" class="modern-input" maxlength="30"
                            placeholder="Ex. Lorentz PS2-1800" style="display:none; margin-top:0.4rem;">
                        <small id="ps_reference_aide" style="${STYLE_AIDE} display:none;">Lettres, chiffres et tirets uniquement, 30 caractères maximum.</small>
                    </div>
                    <div class="input-group" id="ps_montage_groupe">
                        <label for="ps_pompe_montage">Montage</label>
                        <div style="display:flex; gap:0.5rem;">
                            <select id="ps_pompe_montage" class="modern-input" style="flex:1;">
                                <option value="unique">Une seule pompe</option>
                                <option value="parallele">Pompes en parallèle</option>
                                <option value="serie">Pompes en série (étages)</option>
                            </select>
                            <label id="ps_pompe_nombre_groupe" style="display:none; align-items:center; gap:0.35rem; margin:0; font-weight:400; font-size:0.85rem; white-space:nowrap;">
                                Nombre de pompes
                                <input type="number" id="ps_pompe_nombre" class="modern-input" value="2" min="2" max="${window.PompageSolaireCalculs ? window.PompageSolaireCalculs.NB_POMPES_MAX : 4}" step="1"
                                    title="Nombre de pompes identiques (2 à ${window.PompageSolaireCalculs ? window.PompageSolaireCalculs.NB_POMPES_MAX : 4})" style="width:4.5rem;"></label>
                        </div>
                        <small style="${STYLE_AIDE}">Pompes à courbes de performance uniquement ; réglé automatiquement au choix d'une pompe ★ (seule) ou ◆ (à plusieurs). Parallèle : chaque pompe refoule à la HMT et fournit une part du besoin. Série : chaque étage relève une part de la HMT vers une bâche de reprise.</small>
                    </div>
                </div>
                <p id="ps_pompe_catalogue_etat" style="margin:0.5rem 0 0; font-size:0.78rem; color:var(--text-secondary);"></p>
                <div id="ps_pompe_details" style="display:none; margin-top:0.75rem;"></div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.25rem; margin-top: 1.5rem;">
                ${carteGraphique('ps_chart_irradiation', 'Ensoleillement moyen par mois', 'irradiation')}
                ${carteGraphique('ps_chart_eau', 'Besoins et volumes pompés par mois', 'eau')}
            </div>

            <div class="energy-card" style="padding: 1.25rem; margin-top: 1.5rem; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: var(--border-radius-md);">
                <h4 style="margin:0 0 0.5rem; font-size:0.95rem; font-weight:600; color: #1e293b;">Rapport technique</h4>
                <p id="ps_report_text" style="font-size:0.875rem; line-height:1.6; margin:0; color: var(--text-primary);"></p>
            </div>
        </div>

        ${balisageEconomie()}

        ${balisagePlan()}

        <div id="ps_dim_elec_section" style="margin-top: 1.75rem; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: var(--border-radius-lg); padding: 1.5rem; box-shadow: 0 2px 6px rgba(0,0,0,0.04);">
            <h3 class="ps-titre-section">6. Dimensionnement électrique</h3>
            <p style="margin:0 0 1rem; font-size:0.8rem; color:var(--text-secondary);">Chaînes de panneaux, onduleur et pertes du système, à partir du calepinage du projet.</p>
            <button type="button" id="ps_btn_dim_elec" class="btn-base btn-secondary"
                style="text-transform:none; font-size:0.9rem; padding:0.5rem 1rem;">Dimensionnement des chaînes PV…</button>
        </div>

        <!-- Modale de zoom des graphiques -->
        <div id="ps_chart_zoom_modal" style="display:none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(15, 23, 42, 0.7); z-index: 99999; backdrop-filter: blur(4px); align-items: center; justify-content: center; padding: 1.5rem; box-sizing: border-box;">
            <div style="background: #ffffff; border-radius: 12px; width: 95%; max-width: 1100px; height: 85vh; max-height: 750px; display: flex; flex-direction: column; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4); overflow: hidden;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                    <h4 id="ps_zoom_title" style="margin: 0; font-size: 1.1rem; font-weight: 600; color: #1e293b;">Graphique agrandi</h4>
                    <button type="button" id="ps_btn_close_zoom" class="btn-base btn-secondary" style="padding: 0.4rem 0.9rem; font-size: 0.85rem; cursor: pointer; border-radius: 6px; text-transform: none;">✕ Fermer</button>
                </div>
                <div style="padding: 1.5rem; flex: 1; position: relative; min-height: 0; display: flex;">
                    <canvas id="ps_chart_zoom_canvas" style="width: 100% !important; height: 100% !important;"></canvas>
                </div>
            </div>
        </div>

        <!-- Modale du circuit hydraulique (type de système + type de pompe) -->
        <div id="ps_circuit_modal" style="display:none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(15, 23, 42, 0.7); z-index: 99999; backdrop-filter: blur(4px); align-items: center; justify-content: center; padding: 1.5rem; box-sizing: border-box;">
            <div style="background: #ffffff; border-radius: 12px; width: 95%; max-width: 1150px; max-height: 94vh; display: flex; flex-direction: column; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4); overflow: hidden;">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 1rem 1.5rem; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
                    <h4 id="ps_circuit_titre" style="margin: 0; font-size: 1.05rem; font-weight: 600; color: #1e293b;">Circuit hydraulique</h4>
                    <button type="button" id="ps_btn_close_circuit" class="btn-base btn-secondary" style="padding: 0.4rem 0.9rem; font-size: 0.85rem; cursor: pointer; border-radius: 6px; text-transform: none; white-space: nowrap;">✕ Fermer</button>
                </div>
                <div id="ps_circuit_corps" style="padding: 1.25rem; overflow:auto;"></div>
            </div>
        </div>`;
    }

    function balisageEconomie() {
        const unite = (suffixe) => `<span class="ps-devise">€</span>${suffixe || ''}`;
        const regleEco = (id, libelle, step, aide, u) => champRegle(REGLES_ECO, id, libelle, step, aide, u);
        // Ligne de deux champs, séparés par un pointillé vertical (même présentation que le module PAC).
        const ligne = (id, gauche, droite) => `<div class="ps-eco-ligne"${id ? ` id="${id}"` : ''}>
                    <div class="ps-eco-cellule">${gauche}</div><div class="ps-eco-cellule">${droite}</div></div>`;
        return `
        <div id="ps_eco_section" style="display:none; margin-top: 1.75rem; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: var(--border-radius-lg); padding: 1.5rem; box-shadow: 0 2px 6px rgba(0,0,0,0.04);">
            <h3 class="ps-titre-section">4. Analyse économique</h3>
            <p id="ps_eco_description" style="display:none; margin:0 0 1rem; font-size:0.8rem; color:var(--text-secondary);"></p>
            <div class="ps-eco-lignes">
                ${ligne('', `<div class="input-group">
                    <label id="ps_eco_devise_label">Devise</label>
                    <input type="hidden" id="ps_eco_devise" value="EUR">
                    <div role="radiogroup" aria-labelledby="ps_eco_devise_label" style="display:flex; gap:0.4rem; flex-wrap:wrap;">
                        <button type="button" class="ps-devise-btn" role="radio" data-devise="EUR" title="Euro">€</button>
                        <button type="button" class="ps-devise-btn" role="radio" data-devise="USD" title="Dollar US">$</button>
                        <button type="button" class="ps-devise-btn" role="radio" data-devise="HTG" title="Gourde haïtienne">HTG</button>
                        <button type="button" class="ps-devise-btn" role="radio" data-devise="XOF" title="Franc CFA">FCFA</button>
                    </div>
                </div>`, regleEco('ps_eco_taux', "Taux d'actualisation (%)", '0.1', '', '%'))}
                ${ligne('', regleEco('ps_eco_capex', `Capex (centrale photovoltaïque + pompe) (${unite()})`, 'any', 'Hors batteries.'),
                    regleEco('ps_eco_opex_pv', `Opex de la centrale photovoltaïque (${unite('/an')})`, 'any', 'Nettoyage, contrôles, maintenance.', '/an'))}
                ${ligne('', regleEco('ps_eco_indexation_opex_pv', "Indexation de l'Opex solaire (%/an)", '0.1', "Hausse annuelle de l'Opex de la centrale.", '%'),
                    regleEco('ps_eco_remplacement_onduleur', `Remplacement de l'onduleur / contrôleur de pompe — année 10 (${unite()})`, 'any'))}
                ${ligne('ps_eco_ligne_batteries_1', regleEco('ps_eco_capex_batterie', `Capex des batteries (${unite()})`, 'any', 'Batteries et régulateur de charge, posés. Repris par le plan d\'affaires.'),
                    regleEco('ps_eco_remplacement_batterie', `Remplacement des batteries (${unite()})`, 'any', 'Coût de chaque remplacement.'))}
                ${ligne('ps_eco_ligne_batteries_2', regleEco('ps_eco_duree_vie_batterie', 'Durée de vie des batteries (ans)', '1', 'Remplacées tous les N ans (10 à 15 ans en lithium, 4 à 6 ans en plomb).', 'ans'), '')}
                ${ligne('ps_eco_ligne_groupe_1', regleEco('ps_eco_opex_ge', `Opex du groupe électrogène (${unite('/an')})`, 'any', 'Entretien, vidanges, filtres.', '/an'),
                    regleEco('ps_eco_remplacement_ge', `Remplacement du groupe électrogène — année 10 (${unite()})`, 'any'))}
                ${ligne('ps_eco_ligne_groupe_2', regleEco('ps_eco_prix_carburant', `Prix du carburant (${unite('/L')})`, 'any', 'Nécessaire pour chiffrer le carburant du groupe.', '/L'),
                    regleEco('ps_eco_inflation', 'Inflation du carburant (%/an)', '0.1', '', '%'))}
                ${ligne('', regleEco('ps_eco_evolution_besoins', 'Évolution annuelle des besoins en eau (coefficient)', '0.01', "Besoin multiplié par ce coefficient chaque année dès l'année 2 (1,10 = +10 %/an). Commun au plan d'affaires."),
                    regleEco('ps_eco_degradation_pv', 'Dégradation annuelle des panneaux (%/an)', '0.1', "Baisse du volume pompé au solaire chaque année. Commune au plan d'affaires.", '%'))}
            </div>
            <div id="ps_eco_validation_banner" style="${STYLE_BANDEAU}"></div>
            <p id="ps_avis_eco" role="status" style="display:none; background:#fffbeb; color:#92400e; border:1px solid #fde68a; border-radius:6px; padding:8px 12px; margin:0.75rem 0 0; font-size:0.85rem; font-weight:500;"></p>
            <button type="button" id="ps_btn_eco_calculate" class="btn-base btn-calculate-irve capitalize-first-letter" style="margin-top: 1.25rem;">calculer l'analyse économique</button>

            <div id="ps_eco_resultats" style="display:none; margin-top:1.5rem;">
                <h5 id="ps_eco_titre_indicateurs" style="margin:0 0 0.5rem; font-size:0.92rem; font-weight:700; color:#1e293b;">Indicateurs de rentabilité</h5>
                <div id="ps_eco_indicateurs" class="ps-stats-grid ps-stats-grid-4"></div>

                <h5 id="ps_eco_titre_postes" style="margin:1.5rem 0 0.5rem; font-size:0.92rem; font-weight:700; color:#1e293b;">Capex, Opex et gains : avec vs sans pompage solaire</h5>
                <div style="overflow-x:auto;"><table id="ps_eco_table_postes" class="ps-table"></table></div>

                <div style="display:flex; justify-content:space-between; align-items:center; gap:0.75rem; flex-wrap:wrap; margin:1.5rem 0 0.5rem;">
                    <h5 id="ps_eco_titre_annuel" style="margin:0; font-size:0.92rem; font-weight:700; color:#1e293b;">Coûts et gains annuels</h5>
                </div>
                <div style="overflow:auto; max-height:360px; border:1px solid #e2e8f0; border-radius:8px;"><table id="ps_eco_table_annuel" class="ps-table"></table></div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.25rem; margin-top: 1.5rem;">
                    ${carteGraphique('ps_chart_eco_cumul', 'Rentabilité : cashflow cumulé')}
                    ${carteGraphique('ps_chart_eco_couts', 'Coût annuel avec vs sans solaire')}
                    ${carteGraphique('ps_chart_eco_fcf', 'Cumul des flux actualisés')}
                </div>
            </div>
        </div>
        <style>
            .ps-table { width:100%; border-collapse:collapse; font-size:0.82rem; background:#fff; }
            .ps-table th { background:#1f2937; color:#fff; font-weight:600; padding:0.5rem 0.6rem; text-align:center; position:sticky; top:0; }
            .ps-table td { padding:0.45rem 0.6rem; border-bottom:1px solid #e2e8f0; text-align:center; white-space:nowrap; }
            .ps-devise-btn { min-width:3.5rem; padding:0.45rem 0.9rem; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#1e293b; font-weight:600; font-size:0.9rem; cursor:pointer; }
            .ps-devise-btn:hover { border-color:#2563eb; }
            .ps-devise-btn-actif, .ps-devise-btn-actif:hover { background:#2563eb; border-color:#2563eb; color:#fff; }
            .ps-table tr:nth-child(even) td { background:#f8fafc; }
            .ps-table tr.ps-total td { font-weight:700; background:#eef2ff; }
            .ps-negatif { color:#b91c1c; }
            .ps-positif { color:#15803d; }
            .ps-table-dim td:first-child { white-space:normal; }
            /* Indicateurs économiques : reprise de .stats-grid / .stat-card (Production solaire). */
            .ps-stats-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1rem; background-color:#0dcaf0; border-radius:var(--border-radius-md); padding:0.75rem; border:1px solid #14509b; }
            .ps-stats-grid-3, .ps-stats-grid-4 { background-color:#ffffff; border-color:#d1d5db; }
            .ps-stats-grid-3 { grid-template-columns:repeat(3, minmax(0, 1fr)); }
            .ps-stats-grid-4 { grid-template-columns:repeat(4, minmax(0, 1fr)); }
            @media (max-width: 768px) { .ps-stats-grid-3, .ps-stats-grid-4 { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
            .ps-stat-card { background-color:#f3f4f6; padding:1.25rem; border-radius:var(--border-radius-md); border:1px solid var(--border-color); text-align:center; }
            .ps-stat-label { font-size:0.9rem; color:orange; font-weight:700; margin-bottom:0.5rem; background-color:#eef1f3; padding:0.25rem 0.5rem; border-radius:var(--border-radius-md); }
            .ps-stat-value { font-size:1.75rem; font-weight:700; color:var(--accent-primary); }
            .ps-stat-value .ps-negatif { color:#b91c1c; }
            .ps-stat-value .ps-positif { color:#15803d; }
            /* Sections numérotées : titre rouge, séparées par une ligne grise. */
            .ps-titre-section { margin:0 0 0.35rem !important; font-size:1.2rem; font-weight:700; color:#dc2626; text-align:left; }
            .ps-section, #ps_resultats, #ps_eco_section, #ps_pa_section { position:relative; margin-top:2.75rem !important; }
            .ps-section::before, #ps_resultats::before, #ps_eco_section::before, #ps_pa_section::before {
                content:''; position:absolute; left:0; right:0; top:-1.4rem; border-top:2px solid #d1d5db; }
            /* Section 1 : cartes du type de système */
            .ps-systemes { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:0.9rem; }
            .ps-systeme-carte { display:flex; flex-direction:column; gap:0.5rem; padding:0.75rem; border:2px solid #e2e8f0; border-radius:10px; background:#f8fafc; cursor:pointer; margin:0; transition:border-color .15s, box-shadow .15s; }
            .ps-systeme-carte:hover { border-color:#93c5fd; }
            .ps-types-pompe { display:flex; gap:0.6rem; flex-wrap:wrap; }
            .ps-type-pompe-btn { flex:1 1 220px; padding:0.6rem 0.9rem; border:2px solid #e2e8f0; border-radius:10px; background:#f8fafc; color:#1e293b; font-weight:600; font-size:0.88rem; cursor:pointer; text-align:center; transition:border-color .15s, box-shadow .15s; }
            .ps-type-pompe-btn:hover { border-color:#93c5fd; }
            .ps-type-pompe-btn.ps-actif { border-color:#dc2626; background:#fff; color:#dc2626; box-shadow:0 0 0 3px rgba(220,38,38,0.12); }
            /* Analyse économique : deux champs par ligne, séparés par un pointillé vertical continu. */
            .ps-eco-lignes { display:flex; flex-direction:column; }
            .ps-eco-ligne { display:grid; grid-template-columns:1fr 1fr; }
            .ps-eco-cellule { padding:0.45rem 1.5rem 0.45rem 0; min-width:0; }
            .ps-eco-cellule + .ps-eco-cellule { border-left:2px dashed var(--border-color); padding:0.45rem 0 0.45rem 1.5rem; }
            @media (max-width: 760px) {
                .ps-eco-ligne { grid-template-columns:1fr; }
                .ps-eco-cellule + .ps-eco-cellule { border-left:0; padding-left:0; }
            }
            .ps-systeme-carte.ps-actif { border-color:#dc2626; background:#fff; box-shadow:0 0 0 3px rgba(220,38,38,0.12); }
            .ps-schema-mini { display:block; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; background:#fff; }
            .ps-schema-mini svg { display:block; width:100%; height:auto; }
        </style>`;
    }

    /**
     * Plan d'affaires : vente de l'eau, mise en regard du Capex, de l'exploitation et du financement.
     * Seconde analyse de rentabilité, distincte de l'« Analyse économique » (qui chiffre le GAIN du
     * solaire face au groupe seul) : ici la viabilité repose sur les RECETTES de la vente d'eau.
     */
    function balisagePlan() {
        const unite = (suffixe) => `<span class="ps-devise">€</span>${suffixe || ''}`;
        const caseACocher = (id, libelle) => `<label for="${id}" style="display:flex; align-items:center; gap:0.45rem; font-size:0.9rem; font-weight:600; color:#1e293b; cursor:pointer; margin:0;">
                <input type="checkbox" id="${id}" style="width:17px; height:17px; margin:0; cursor:pointer;"> ${libelle}</label>`;
        // Champ affiché ou masqué selon le cas (cf. majBlocPlan).
        const groupe = (id, contenu) => `<div id="ps_pa_groupe_${id}">${contenu}</div>`;
        const regle = (id, libelle, step, aide, u) => champRegle(REGLES_PLAN, `ps_pa_${id}`, libelle, step, aide, u);
        return `
        <div id="ps_pa_section" style="display:none; margin-top: 1.75rem; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: var(--border-radius-lg); padding: 1.5rem; box-shadow: 0 2px 6px rgba(0,0,0,0.04);">
            <h3 class="ps-titre-section">5. Plan d'affaires : vente d'eau</h3>
            <p style="display:none; margin:0 0 1rem; font-size:0.8rem; color:var(--text-secondary);">Viabilité du projet à partir des recettes de la vente d'eau, mises en regard du Capex, de l'exploitation et du financement. Tout le volume pompé est vendu (solaire, plus le groupe électrogène d'appoint qui pompe le déficit), hors part perdue ou impayée. Les équipements chiffrés suivent le type de système (section 1). Le besoin en eau évolue chaque année et le pompage solaire baisse avec la dégradation des panneaux, selon les coefficients de l'analyse économique, dont sont aussi repris le Capex de la pompe solaire, le prix et l'indexation du carburant.</p>

            <h4 style="${STYLE_SOUS_TITRE} margin-top:0.5rem;">Capex du système de pompage solaire</h4>
            <div class="input-grid-2x">
                ${regle('capex_materiel', `Matériel de pompage (${unite()})`, 'any', 'Pompe, contrôleur, panneaux, câbles.')}
                ${regle('capex_genie_civil', `Génie civil et pose (${unite()})`, 'any', "Forage, socles, réservoir, main-d'œuvre.")}
                ${regle('capex_transport', `Transport du matériel (${unite()})`, 'any')}
                ${regle('capex_terrain', `Coût d'acquisition du terrain (${unite()})`, 'any', 'En plus du Capex de la pompe solaire ; non amorti (conservé dans la valeur résiduelle).')}
            </div>
            <div style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top:0.6rem;">
                <p id="ps_pa_somme_lots" style="margin:0; font-size:0.85rem;"></p>
                <button type="button" id="ps_btn_pa_repartir" class="btn-base btn-secondary"
                    style="text-transform:none; font-size:0.82rem; padding:0.35rem 0.8rem;"
                    title="Répartit le Capex de la pompe solaire : 70 % matériel, 20 % génie civil et pose, 10 % transport">Répartir le Capex (70 / 20 / 10 %)</button>
            </div>

            <div id="ps_pa_bloc_equipements" style="display:none;">
                <h4 id="ps_pa_titre_equipements" style="${STYLE_SOUS_TITRE}">Équipements du système</h4>
                <div class="input-grid-2x">
                    ${groupe('capex_pv', regle('capex_pv', `Capex de l'installation PV (${unite()})`, 'any', 'Part du PV non comprise dans le Capex de la pompe solaire (0 si elle y est déjà).'))}
                    ${groupe('capex_ge', regle('capex_ge', `Capex du groupe électrogène (${unite()})`, 'any'))}
                    ${groupe('entretien_ge', regle('entretien_ge', `Entretien du groupe électrogène (${unite('/an')})`, 'any', "Indexé comme l'entretien de l'installation."))}
                    ${groupe('rempl_ge', regle('rempl_ge', `Remplacement du groupe — année 10 (${unite()})`, 'any'))}
                </div>
                <p id="ps_pa_info_batteries" style="display:none; margin:0.6rem 0 0; font-size:0.8rem; color:var(--text-secondary);"></p>
            </div>
            <p id="ps_pa_info_carburant" style="display:none; margin:0.6rem 0 0; font-size:0.8rem; color:var(--text-secondary);"></p>

            <h4 style="${STYLE_SOUS_TITRE}">Vente de l'eau et exploitation</h4>
            <div class="input-grid-2x">
                ${regle('tarif_m3', `Tarif de vente de l'eau (${unite('/m³')})`, 'any', 'Prix du m³ en année 1 (5 = 0,005 par litre).')}
                ${regle('indexation_tarif', 'Indexation annuelle du tarif de vente (%/an)', '0.1', '', '%')}
                ${regle('part_pertes', 'Part d\'eau perdue ou impayée (%)', '0.1', 'Volume pompé non facturé.', '%')}
                ${regle('entretien', `Entretien de l'installation (${unite('/an')})`, 'any', 'Entretien global du système.')}
                ${regle('indexation_entretien', "Indexation de l'entretien (%/an)", '0.1', '', '%')}
                ${regle('rempl_onduleur', `Remplacement de l'onduleur / contrôleur — année 10 (${unite()})`, 'any')}
            </div>
            <p id="ps_pa_info_evolution" style="margin:0.6rem 0 0; font-size:0.8rem; color:var(--text-secondary);"></p>

            <h4 style="${STYLE_SOUS_TITRE}">Financement</h4>
            <div class="input-grid-2x">
                ${regle('subvention', `Subvention (${unite()})`, 'any', "Encaissée en année 0. 0 si aucune.")}
                ${regle('emprunt', `Emprunt (${unite()})`, 'any', "Encaissé en année 0, remboursé par annuités constantes. 0 si aucun.")}
                ${groupe('taux_emprunt', regle('taux_emprunt', "Taux de l'emprunt (%/an)", '0.1', '', '%'))}
                ${groupe('duree_emprunt', regle('duree_emprunt', "Durée de l'emprunt (ans)", '1', "Capital restant dû remboursé à l'horizon s'il est plus long.", 'ans'))}
            </div>

            <h4 style="${STYLE_SOUS_TITRE}">Impôts, amortissement et valeur résiduelle</h4>
            <div style="display:flex; gap:1.5rem; flex-wrap:wrap;">
                ${caseACocher('ps_pa_impots', 'Prendre en compte les impôts')}
                ${caseACocher('ps_pa_valeur_residuelle', 'Prendre en compte la valeur résiduelle')}
            </div>
            <div class="input-grid-2x" style="margin-top:0.75rem;">
                ${groupe('taux_impot', regle('taux_impot', "Taux d'imposition (%)", '0.1', 'Appliqué au résultat (recettes - charges - amortissement - intérêts) quand il est positif.', '%'))}
                ${groupe('methode', `<div class="input-group">
                    <label for="ps_pa_methode_amortissement">Amortissement du Capex</label>
                    <select id="ps_pa_methode_amortissement" class="modern-input">
                        <option value="lineaire" selected>Linéaire sur une durée</option>
                        <option value="constant">Montant constant par an</option>
                    </select>
                    <small style="${STYLE_AIDE}">Sert au calcul de l'impôt et de la valeur résiduelle (valeur nette comptable à l'horizon).</small>
                </div>`)}
                ${groupe('duree_amortissement', regle('duree_amortissement', "Durée d'amortissement (ans)", '1', '', 'ans'))}
                ${groupe('amortissement_annuel', regle('amortissement_annuel', `Amortissement annuel (${unite('/an')})`, 'any', 'Plafonné au Capex.'))}
            </div>

            <h4 style="${STYLE_SOUS_TITRE}">Actualisation</h4>
            <div class="input-grid-2x">
                ${regle('taux', "Taux d'actualisation (%)", '0.1', '', '%')}
                <div class="input-group">
                    <label for="ps_pa_horizon">Horizon d'étude</label>
                    <select id="ps_pa_horizon" class="modern-input">
                        <option value="5">5 ans</option><option value="10">10 ans</option>
                        <option value="15">15 ans</option><option value="20" selected>20 ans</option>
                    </select>
                </div>
            </div>
            <div id="ps_pa_validation_banner" style="${STYLE_BANDEAU}"></div>
            <p id="ps_avis_pa" role="status" style="display:none; background:#fffbeb; color:#92400e; border:1px solid #fde68a; border-radius:6px; padding:8px 12px; margin:0.75rem 0 0; font-size:0.85rem; font-weight:500;"></p>
            <div style="display:flex; align-items:center; gap:1rem; flex-wrap:wrap; margin-top: 1.25rem;">
                <button type="button" id="ps_btn_pa_calculate" class="btn-base btn-calculate-irve capitalize-first-letter" style="margin:0;">calculer</button>
            </div>

            <div id="ps_pa_resultats" style="display:none; margin-top:1.5rem;">
                <p id="ps_pa_verification" style="margin:0 0 0.75rem; font-size:0.8rem;"></p>
                <h5 style="margin:0 0 0.5rem; font-size:0.92rem; font-weight:700; color:#1e293b;">Indicateurs du plan d'affaires</h5>
                <div class="ps-stats-grid ps-stats-grid-3">
                    ${carteIndicateur('ps_pa_prix_eq', "Prix de vente d'équilibre (année 1)")}
                    ${carteIndicateur('ps_pa_cout_revient', 'Coût de revient actualisé (prix constant)')}
                    ${carteIndicateur('ps_pa_van', 'VAN (valeur actuelle nette)')}
                    ${carteIndicateur('ps_pa_tri', 'TRI')}
                    ${carteIndicateur('ps_pa_retour', 'Temps de retour simple')}
                    ${carteIndicateur('ps_pa_retour_act', 'Temps de retour actualisé')}
                </div>

                <h5 style="margin:1.5rem 0 0.5rem; font-size:0.92rem; font-weight:700; color:#1e293b;">Capex, financement et synthèse d'exploitation</h5>
                <div style="overflow-x:auto;"><table id="ps_pa_table_capex" class="ps-table"></table></div>
                <div style="overflow-x:auto; margin-top:0.75rem;"><table id="ps_pa_table_synthese" class="ps-table"></table></div>

                <h5 style="margin:1.5rem 0 0.5rem; font-size:0.92rem; font-weight:700; color:#1e293b;">Tableau des flux : ventes et charges d'exploitation</h5>
                <div style="overflow:auto; max-height:380px; border:1px solid #e2e8f0; border-radius:8px;"><table id="ps_pa_table_flux" class="ps-table"></table></div>
                <h5 style="margin:1.25rem 0 0.5rem; font-size:0.92rem; font-weight:700; color:#1e293b;">Tableau des flux : investissement, financement et trésorerie</h5>
                <div style="overflow:auto; max-height:380px; border:1px solid #e2e8f0; border-radius:8px;"><table id="ps_pa_table_tresorerie" class="ps-table"></table></div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 1.25rem; margin-top: 1.5rem;">
                    ${carteGraphique('ps_chart_pa_flux', 'Flux annuels : recettes, charges et flux net')}
                    ${carteGraphique('ps_chart_pa_cumul', 'Rentabilité : flux cumulés')}
                </div>
            </div>
        </div>`;
    }

    // ---------------------------------------------------------------------------------------
    // Adresse du projet / persistance
    // ---------------------------------------------------------------------------------------

    function appliquerAdresseProjet() {
        const globale = typeof window.lireAdresseProjetGlobale === 'function'
            ? window.lireAdresseProjetGlobale() : null;
        const coords = globale || (typeof window.resolveProjectLatLon === 'function'
            ? window.resolveProjectLatLon() : null);
        if (!coords) return null;

        txt('ps_site_libelle', (globale && globale.libelle) || 'Adresse du projet');
        txt('ps_site_coords', ` (${Number(coords.lat).toFixed(5)}, ${Number(coords.lon).toFixed(5)})`);
        const avert = $('ps_site_avertissement');
        if (avert) {
            // Sans adresse enregistrée, resolveProjectLatLon retombe sur un repli géographique : le
            // dire, plutôt que de laisser croire que l'ensoleillement correspond au site.
            const sansAdresse = !globale;
            avert.style.display = sansAdresse ? 'block' : 'none';
            avert.textContent = sansAdresse
                ? "Aucune adresse enregistrée pour ce projet : coordonnées de repli. Renseignez l'adresse dans « Paramètres du projet » pour un ensoleillement représentatif du site."
                : '';
        }
        return coords;
    }

    /**
     * Projet actif : identifiant VÉRIFIÉ en base par le serveur au rendu de la page (context
     * processor main.py) ; `current_projet_id` du localStorage n'est qu'un repli. Dans les deux cas
     * le serveur revérifie que le projet appartient à l'utilisateur avant toute lecture/écriture.
     */
    function projetActifId() {
        const verifie = window.ACTIVE_PROJECT_ID_VERIFIE;
        if (verifie) return String(verifie);
        try { return localStorage.getItem('current_projet_id') || null; } catch (e) { return null; }
    }

    // Coefficient de surdimensionnement : enregistré en base avec les autres saisies ET en localStorage,
    // sous une clé PAR PROJET (une clé globale fuirait d'un projet à l'autre, cf. CLES_OBSOLETES).
    const cleCoefSurdimLocal = (projetId) => `ps_coef_surdimensionnement:${projetId}`;

    function lireCoefSurdimLocal() {
        if (!projetCharge) return null;
        let v = null;
        try { v = localStorage.getItem(cleCoefSurdimLocal(projetCharge)); } catch (e) { return null; }
        const n = Number(v);
        return v !== null && v !== '' && isFinite(n) && n >= 1 && n <= 2 ? String(n) : null;
    }

    function ecrireCoefSurdimLocal() {
        const el = $('ps_coef_surdimensionnement');
        const n = el ? Number(el.value) : NaN;
        if (!projetCharge || el.value === '' || !isFinite(n) || n < 1 || n > 2) return;
        try { localStorage.setItem(cleCoefSurdimLocal(projetCharge), String(n)); } catch (e) { /* noop */ }
    }

    function purgerAnciennesCles() {
        CLES_OBSOLETES.forEach((cle) => { try { localStorage.removeItem(cle); } catch (e) { /* noop */ } });
    }

    function collecterSaisies() {
        const champs = {};
        CHAMPS_PERSISTES.forEach((id) => {
            const el = $(id);
            if (el) champs[id] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : String(el.value);
        });
        // La référence catalogue peut ne pas encore être dans la liste (catalogue en chargement).
        if (!champs.ps_pompe_choix && choixPompeRestaure) champs.ps_pompe_choix = choixPompeRestaure;
        const caseIntegration = $('ps_integration_calepinage');
        return { champs, integration_calepinage: caseIntegration ? caseIntegration.checked : true };
    }

    /** Copie JSON « sûre » pour la base : nombres finis, textes courts sans balisage (cf. schéma serveur). */
    function nettoyerPourBase(v, profondeur) {
        const p = profondeur || 0;
        if (p > 7 || v === undefined || typeof v === 'function') return null;
        if (v === null || typeof v === 'boolean') return v;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        if (typeof v === 'string') return v.replace(/[<>\x00-\x08\x0b-\x1f]/g, '').slice(0, 500);
        if (Array.isArray(v)) return v.map((x) => nettoyerPourBase(x, p + 1));
        if (typeof v === 'object') {
            const o = {};
            Object.keys(v).forEach((k) => {
                if (k.length <= 80 && !/[<>\x00-\x1f]/.test(k)) o[k] = nettoyerPourBase(v[k], p + 1);
            });
            return o;
        }
        return null;
    }

    /** Dernier calcul, tel qu'il est réaffiché à la réouverture du projet. */
    function instantaneResultats() {
        if (!dernierResultat || !dernierInstantane) return null;
        const prod = dernierInstantane.production;
        const info = (prod && prod.champs) || {};
        const production = prod ? {
            mensuelKwh: prod.mensuelKwh,
            summary: prod.summary,
            fields: (prod.fields || []).map((f) => ({
                id: String(f.id), peak_power: f.peak_power, total_production_kwh: f.total_production_kwh,
                specific_production: f.specific_production, near_shading_loss_percent: f.near_shading_loss_percent,
                performance_ratio: f.performance_ratio,
            })),
            // Seuls les agrégats sont affichés : pas les champs PV complets (scène d'ombrage, etc.).
            champs: {
                kwc: info.kwc, panneaux: info.panneaux, refs: info.refs || [], sources: [],
                champs: (info.champs || []).map((pv) => ({ peakPower: Number(pv.peakPower) || 0, panelCount: Number(pv.panelCount) || 0 })),
            },
        } : null;
        return nettoyerPourBase({
            calcule_le: new Date().toISOString(),
            resultat: dernierResultat,
            instantane: Object.assign({}, dernierInstantane, { production }),
            eco: dernierEco,
            plan: dernierPlan,
        });
    }

    /** Programme l'enregistrement en base (regroupé : un seul envoi pour une rafale de changements). */
    function sauvegarder(options) {
        if (persistance !== 'active') return;
        clearTimeout(minuterieSauvegarde);
        minuterieSauvegarde = setTimeout(() => envoyerSauvegarde(false), (options && options.immediat) ? 0 : DELAI_SAUVEGARDE_MS);
    }

    /** @returns {Promise<boolean>} true si la base a accepté l'enregistrement. */
    async function envoyerSauvegarde(fermeture) {
        clearTimeout(minuterieSauvegarde);
        minuterieSauvegarde = null;
        const projetId = projetCharge;
        if (persistance !== 'active' || !projetId) return false;
        const envoyes = resultatsAEnvoyer;
        const corps = { saisies: collecterSaisies() };
        if (envoyes !== undefined) corps.resultats = envoyes;
        let texte = JSON.stringify(corps);
        // keepalive (page qui se ferme) est limité à 64 Ko : les résultats, déjà envoyés à la fin du
        // calcul, sont alors laissés de côté.
        if (fermeture && texte.length > 60000) { delete corps.resultats; texte = JSON.stringify(corps); }
        try {
            const reponse = await fetch(`${URL_PERSISTANCE(projetId)}/save`, {
                method: 'POST', credentials: 'same-origin', keepalive: !!fermeture,
                headers: { 'Content-Type': 'application/json' }, body: texte,
            });
            const res = await reponse.json().catch(() => ({}));
            if (!reponse.ok || !res.success) {
                console.warn('[PompageSolaire] Sauvegarde refusée :', reponse.status, res.message);
                if (reponse.status === 400 || reponse.status === 404) message(`Pompage solaire non enregistré : ${res.message || 'erreur'}`, 'error', 6000);
                return false;
            }
            if (resultatsAEnvoyer === envoyes && 'resultats' in corps) resultatsAEnvoyer = undefined;
            return true;
        } catch (e) {
            console.warn('[PompageSolaire] Sauvegarde impossible :', e);
            return false;
        }
    }

    /** Remplit le formulaire avec les saisies enregistrées du projet (null : valeurs par défaut). */
    function restaurer(saisies) {
        // Case cochée par défaut : seule une décoche explicite est mémorisée.
        const caseIntegration = $('ps_integration_calepinage');
        if (caseIntegration) caseIntegration.checked = !(saisies && saisies.integration_calepinage === false);
        const data = saisies && saisies.champs;
        // Base sans coefficient de surdimensionnement (ancienne sauvegarde, base indisponible) : repli
        // sur la copie locale du projet.
        const coefLocal = lireCoefSurdimLocal();
        const champCoef = $('ps_coef_surdimensionnement');
        if (champCoef && coefLocal !== null && !(data && data.ps_coef_surdimensionnement)) champCoef.value = coefLocal;
        if (!data || typeof data !== 'object') return;
        // Sauvegardes antérieures au type de système : il se déduit des cases « hybride » / « stockage »
        // du plan d'affaires ; les prix de batterie du plan passent dans l'analyse économique.
        if (!SYSTEMES[data.ps_systeme]) {
            data.ps_systeme = data.ps_pa_hybride === '1' ? 'groupe' : data.ps_pa_stockage === '1' ? 'batteries' : SYSTEME_DEFAUT;
        }
        if (!data.ps_eco_capex_batterie && data.ps_pa_capex_batterie) data.ps_eco_capex_batterie = data.ps_pa_capex_batterie;
        if (!data.ps_eco_remplacement_batterie && data.ps_pa_rempl_batterie) data.ps_eco_remplacement_batterie = data.ps_pa_rempl_batterie;
        Object.keys(data).forEach((id) => {
            if (!CHAMPS_PERSISTES.includes(id)) return;
            const el = $(id);
            if (!el) return;
            if (el.type === 'checkbox') { el.checked = data[id] === '1'; return; }
            el.value = data[id];
            if (id === 'ps_pompe_choix') choixPompeRestaure = data[id] || '';
        });
        const materiau = $('ps_m_material');
        if (materiau && !materiau.value && materiau.options.length) materiau.selectedIndex = 0;
        // Une ancienne sauvegarde peut contenir une valeur sortie des bornes actuelles (ex. pertes de
        // charge à 20 %, conso. spécifique à 0,35) : on la ramène à la valeur par défaut plutôt que
        // de bloquer le calcul sur une saisie que l'utilisateur n'a pas faite aujourd'hui.
        const type = $('ps_pump_type');
        if (type && !H_ASPIRATION[type.value]) type.value = 'forage';
        const montage = $('ps_pompe_montage');
        if (montage && !LIBELLES_MONTAGE[montage.value]) montage.value = 'unique';
        if (!DEVISES[val('ps_eco_devise')] && $('ps_eco_devise')) $('ps_eco_devise').value = 'EUR';
        if (!SYSTEMES[val('ps_systeme')] && $('ps_systeme')) $('ps_systeme').value = SYSTEME_DEFAUT;
        toutesRegles().forEach((r) => {
            if (r.defaut === undefined) return;
            const el = $(r.id);
            if (el && el.value !== '' && violation(r)) el.value = r.defaut;
        });
        const methode = $('ps_pa_methode_amortissement');
        if (methode && !['lineaire', 'constant'].includes(methode.value)) methode.value = 'lineaire';
        const horizon = $('ps_pa_horizon');
        if (horizon && !window.PompageSolaireCalculs.HORIZONS_PLAN_AFFAIRES.includes(Number(horizon.value))) horizon.value = '20';
        const ref = $('ps_reference_pompe_installee');
        if (ref) ref.value = ref.value.replace(CARACTERES_INTERDITS_REFERENCE, '').slice(0, 30);
    }

    /** Réaffiche le dernier calcul enregistré (sans relancer PVGIS ni la production du calepinage). */
    function restaurerResultats(res) {
        if (!res || !res.resultat || !res.instantane || !res.instantane.entrees) return;
        // Résultat d'un autre type de système : périmé. Résultat antérieur au type de système : le
        // dimensionnement reste valable, mais l'analyse économique et le plan d'affaires supposaient un
        // groupe d'appoint (modèle « groupe ») : ils ne sont réaffichés que pour ce type.
        const sysEnregistre = res.instantane.systeme;
        if (sysEnregistre && sysEnregistre !== systemeChoisi()) return;
        const ancien = !sysEnregistre;
        if (ancien && systemeChoisi() !== 'groupe') { res = Object.assign({}, res, { eco: null, plan: null }); }
        try {
            dernierInstantane = res.instantane;
            derniereProduction = res.instantane.production || null;
            afficher(res.resultat);
            const carteProd = $('ps_prod_card');
            if (carteProd) carteProd.style.display = derniereProduction ? 'block' : 'none';
            if (derniereProduction) afficherProduction(derniereProduction);
            $('ps_eco_section').style.display = 'block';
            if (res.eco && res.eco.resultat) afficherEco(res.eco.resultat);
            else masquerEco();
            $('ps_pa_section').style.display = 'block';
            majBlocPlan();
            if (res.plan && res.plan.resultat && res.plan.params
                && res.plan.resultat.version === window.PompageSolaireCalculs.VERSION_PLAN_AFFAIRES) afficherPlan(res.plan);
            else masquerPlan();
            const date = res.calcule_le ? new Date(res.calcule_le) : null;
            if (date && !isNaN(date)) {
                message(`Dernier dimensionnement du projet (${date.toLocaleString('fr-FR')}) restauré. Relancez « Dimensionner » si le calepinage ou les saisies ont changé.`, 'info', 6000);
            }
        } catch (e) {
            console.warn('[PompageSolaire] Résultats enregistrés illisibles, ignorés :', e);
            dernierResultat = null; dernierInstantane = null; dernierEco = null; derniereProduction = null;
            dernierPlan = null;
            const bloc = $('ps_resultats');
            if (bloc) bloc.style.display = 'none';
        }
    }

    /** Charge les données du projet depuis la base, puis met la section à jour. */
    async function chargerDepuisBase(projetId) {
        projetCharge = projetId || null;
        purgerAnciennesCles();
        if (!projetId) {
            persistance = 'inactive';
            restaurer(null);
            return;
        }
        persistance = 'chargement';
        let ok = false;
        let config = null;
        try {
            const reponse = await fetch(`${URL_PERSISTANCE(projetId)}/load`, { credentials: 'same-origin' });
            const res = await reponse.json().catch(() => ({}));
            ok = reponse.ok && !!res.success;
            if (ok && res.config_exists) config = res.config;
        } catch (e) {
            console.warn('[PompageSolaire] Chargement impossible :', e);
        }
        if (projetCharge !== projetId) return; // projet changé pendant le chargement
        // Chargement en échec : on n'enregistre RIEN, pour ne pas écraser les données du projet par
        // les valeurs par défaut du formulaire.
        persistance = ok ? 'active' : 'inactive';
        if (!ok) message("Données du pompage solaire de ce projet indisponibles : les modifications ne seront pas enregistrées.", 'error', 8000);
        restaurer(config && config.saisies);
        if (ok) ecrireCoefSurdimLocal();
        majAffichageSysteme();
        majLibelleTypePompe();
        majHauteurGeometrique();
        majChoixPompe();
        majDevise();
        majBlocPlan();
        majPuissanceCalepinage();
        majEtatValidation();
        if (config && config.resultats) restaurerResultats(config.resultats);
        memoriserSaisies();
        verifierCalepinageInchange();
        synchroniserParametresCalepinage();
    }

    /** Oublie l'état du projet précédent (la section est reconstruite pour le nouveau projet). */
    function reinitialiser() {
        if (minuterieSauvegarde) envoyerSauvegarde(false); // dernières saisies du projet quitté
        [graphIrradiation, graphEau, graphZoom, graphPompe].concat(Object.values(graphsEco), Object.values(graphsPlan))
            .forEach((g) => { try { if (g) g.destroy(); } catch (e) { /* noop */ } });
        Object.keys(graphsPlan).forEach((k) => { delete graphsPlan[k]; });
        dernierPlan = null;
        numeroCalculPlan += 1;
        graphIrradiation = null; graphEau = null; graphZoom = null; graphPompe = null;
        suggestionsCourbes = null;
        Object.keys(graphsEco).forEach((k) => { delete graphsEco[k]; });
        dernierResultat = null; dernierInstantane = null; dernierEco = null; derniereProduction = null;
        choixPompeRestaure = '';
        resultatsAEnvoyer = undefined;
        persistance = 'inactive';
        construit = false;
    }

    // ---------------------------------------------------------------------------------------
    // Validation des saisies (miroir du schéma Pydantic)
    // ---------------------------------------------------------------------------------------

    const applicable = (r) => !r.si || r.si();

    /** Toutes les règles du formulaire, champs masqués compris (restauration, garde-fous, écouteurs). */
    function toutesReglesFormulaire() {
        const t = H_ASPIRATION[val('ps_pump_type')] || H_ASPIRATION.forage;
        return REGLES.map((r) => (r.id === 'ps_h_aspiration'
            ? { id: r.id, min: t.min, max: t.max, defaut: t.defaut, libelle: t.libelle } : r));
    }

    /** Règles applicables au type de système choisi (champs affichés). */
    function reglesFormulaire() {
        return toutesReglesFormulaire().filter(applicable);
    }

    const toutesRegles = () => toutesReglesFormulaire().concat(REGLES_CALCULATRICE, REGLES_ECO, REGLES_PLAN);
    const reglesEco = () => REGLES_ECO.filter(applicable);

    function facteurDevise() { return FACTEUR_BORNES_DEVISE[val('ps_eco_devise')] || 1; }
    /** Maximum d'une règle : les montants sont plafonnés dans la devise choisie. */
    function borneMax(r) { return r.monnaie ? r.max * facteurDevise() : r.max; }

    function borne(n) { return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }); }

    function violation(r) {
        const el = $(r.id);
        if (!el) return null;
        if (el.validity && el.validity.badInput) return { el, message: `${r.libelle} : valeur numérique invalide.` };
        const brut = String(el.value).trim();
        if (brut === '') return r.facultatif ? null : { el, vide: true, message: `${r.libelle} : champ obligatoire.` };
        const v = Number(brut.replace(',', '.'));
        if (!Number.isFinite(v)) return { el, message: `${r.libelle} : valeur numérique invalide.` };
        if (r.facultatif && v === 0) return null;
        const max = borneMax(r);
        if (v < r.min || v > max) {
            return { el, message: `${r.libelle} doit être compris entre ${borne(r.min)} et ${borne(max)} (valeur actuelle : ${brut}).` };
        }
        if (r.entier && !Number.isInteger(v)) return { el, message: `${r.libelle} : nombre entier attendu (valeur actuelle : ${brut}).` };
        return null;
    }

    function violationReferencePompe() {
        if (val('ps_pompe_choix') !== CHOIX_PERSONNALISE) return null;
        const el = $('ps_reference_pompe_installee');
        const v = String(val('ps_reference_pompe_installee')).trim();
        if (v === '') return { el, vide: true, message: 'Référence de la pompe personnalisée : saisissez une référence ou choisissez « Fabricant par défaut ».' };
        if (!MOTIF_REFERENCE.test(v)) return { el, message: 'Référence de la pompe : lettres, chiffres et tirets uniquement, 30 caractères maximum.' };
        return null;
    }

    const lister = (regles) => regles.map(violation).filter(Boolean);
    const coche = (id) => { const el = $(id); return !!(el && el.checked); };

    /** Règles du plan d'affaires applicables au cas choisi (hybride, stockage, emprunt, fiscalité). */
    function reglesPlan() {
        return REGLES_PLAN.filter((r) => !r.si || r.si());
    }

    /** Somme des trois lots du Capex de la pompe solaire. */
    function sommeLots() {
        return Object.keys(REPARTITION_LOTS).reduce((s, id) => s + (nombre(id) || 0), 0);
    }

    /**
     * Violations propres au plan d'affaires : bornes des saisies, données reprises de l'analyse
     * économique (Capex ; prix et indexation du carburant en hybride), somme des lots = Capex.
     */
    function violationsPlan() {
        const regleEco = (id) => REGLES_ECO.find((r) => r.id === id);
        const eco = ['ps_eco_capex', 'ps_eco_evolution_besoins', 'ps_eco_degradation_pv']
            .concat(siHybride() ? ['ps_eco_prix_carburant', 'ps_eco_inflation'] : [])
            .concat(siStockage() ? ['ps_eco_capex_batterie', 'ps_eco_remplacement_batterie', 'ps_eco_duree_vie_batterie'] : [])
            .map((id) => violation(regleEco(id))).filter(Boolean)
            .map((v) => ({ el: v.el, vide: v.vide, message: `Analyse économique — ${v.message}` }));
        const v = eco.concat(lister(reglesPlan()));
        if (!v.length) {
            const capex = nombre('ps_eco_capex');
            const somme = sommeLots();
            if (Math.abs(somme - capex) > TOLERANCE_SOMME_LOTS) {
                v.push({
                    el: $('ps_pa_capex_transport'),
                    message: `La somme des trois lots (${fr(somme, 2)}) doit être égale au Capex de la pompe solaire (${fr(capex, 2)}) : écart de ${fr(somme - capex, 2)}.`,
                });
            }
            const financement = (nombre('ps_pa_subvention') || 0) + (nombre('ps_pa_emprunt') || 0);
            const total = capexTotalPlan();
            if (financement > total + TOLERANCE_SOMME_LOTS) {
                v.push({
                    el: $('ps_pa_emprunt'),
                    message: `Subvention + emprunt (${fr(financement, 2)}) ne peuvent dépasser le Capex total (${fr(total, 2)}).`,
                });
            }
        }
        return v;
    }
    const estAffiche = (id) => { const el = $(id); return !!(el && el.style.display !== 'none'); };

    function afficherBandeau(id, v) {
        const b = $(id);
        if (!b) return;
        b.style.display = v ? 'block' : 'none';
        b.textContent = v ? `⚠️ ${v.message}` : '';
    }

    function activerBouton(id, actif) {
        const b = $(id);
        if (!b) return;
        b.disabled = !actif;
        b.style.opacity = actif ? '' : '0.5';
        b.style.cursor = actif ? '' : 'not-allowed';
    }

    /** Recalcule toutes les violations, marque les champs fautifs et grise les boutons concernés. */
    function majEtatValidation() {
        const tous = toutesRegles().map((r) => r.id).concat(['ps_reference_pompe_installee']);
        tous.forEach((id) => { const el = $(id); if (el) { el.style.borderColor = ''; el.style.boxShadow = ''; } });

        const vForm = lister(reglesFormulaire());
        const vRef = violationReferencePompe();
        if (vRef) vForm.push(vRef);
        const vCalc = estAffiche('ps_pertes_calculatrice') ? lister(REGLES_CALCULATRICE) : [];
        const vEco = estAffiche('ps_eco_section') ? lister(reglesEco()) : [];
        const vPlan = estAffiche('ps_pa_section') ? violationsPlan() : [];

        // Un champ obligatoire encore vide n'est pas « faux » : message, mais pas de liseré rouge.
        vForm.concat(vCalc, vEco, vPlan).filter((v) => !v.vide && v.el).forEach((v) => {
            v.el.style.borderColor = '#dc2626';
            v.el.style.boxShadow = '0 0 0 2px rgba(220,38,38,0.15)';
        });

        afficherBandeau('ps_validation_banner', vForm[0]);
        activerBouton('ps_btn_calculate', !vForm.length);
        afficherBandeau('ps_calc_validation_banner', vCalc[0]);
        activerBouton('ps_btn_apply_losses', !vCalc.length);
        afficherBandeau('ps_eco_validation_banner', vForm[0]
            ? { message: `Corrigez d'abord le prédimensionnement — ${vForm[0].message}` } : vEco[0]);
        activerBouton('ps_btn_eco_calculate', !vForm.length && !vEco.length);
        afficherBandeau('ps_pa_validation_banner', vForm[0]
            ? { message: `Corrigez d'abord le prédimensionnement — ${vForm[0].message}` } : vPlan[0]);
        activerBouton('ps_btn_pa_calculate', !vForm.length && !vPlan.length && !!dernierResultat);
        majSommeLots();
        return { vForm, vCalc, vEco, vPlan };
    }

    // ---------------------------------------------------------------------------------------
    // Données d'entrée modifiées : résultats remis à zéro
    // ---------------------------------------------------------------------------------------
    // Un résultat affiché doit TOUJOURS correspondre aux saisies affichées : dès qu'une donnée
    // d'entrée change, les résultats qui en dépendent sont effacés (écran ET base) et un avis
    // demande de relancer le calcul. Dépendances : dimensionnement -> analyse économique et plan
    // d'affaires ; analyse économique -> plan d'affaires pour les saisies qu'il reprend.

    const AVIS_RECALCUL = {
        dim: "Données d'entrée modifiées : les résultats du dimensionnement, de l'analyse économique et du plan d'affaires ont été remis à zéro. Relancez « Dimensionner le système de pompage ».",
        eco: "Données d'entrée modifiées : les résultats de l'analyse économique ont été remis à zéro. Relancez « Calculer l'analyse économique ».",
        pa: "Données d'entrée modifiées : les résultats du plan d'affaires ont été remis à zéro. Relancez « Calculer ».",
    };
    // Saisies de l'analyse économique reprises par le plan d'affaires.
    const IDS_ECO_DU_PLAN = ['ps_eco_capex', 'ps_eco_prix_carburant', 'ps_eco_inflation', 'ps_eco_evolution_besoins', 'ps_eco_degradation_pv',
        'ps_eco_capex_batterie', 'ps_eco_remplacement_batterie', 'ps_eco_duree_vie_batterie'];
    const IDS_PLAN_HORS_REGLES = ['ps_pa_impots', 'ps_pa_valeur_residuelle', 'ps_pa_methode_amortissement', 'ps_pa_horizon'];

    function avisRecalcul(cle, visible) {
        const el = $(`ps_avis_${cle}`);
        if (!el) return;
        el.style.display = visible ? 'block' : 'none';
        el.textContent = visible ? `⟳ ${AVIS_RECALCUL[cle]}` : '';
    }

    /** Résultats concernés par la saisie `id` : 'dim', 'eco', 'eco+pa', 'pa' ou null (sans effet). */
    function portee(id) {
        if (id === 'ps_systeme' || id === 'ps_pump_type' || id === 'ps_integration_calepinage' || REGLES.some((r) => r.id === id)) return 'dim';
        if (REGLES_ECO.some((r) => r.id === id)) return IDS_ECO_DU_PLAN.includes(id) ? 'eco+pa' : 'eco';
        if (REGLES_PLAN.some((r) => r.id === id) || IDS_PLAN_HORS_REGLES.includes(id)) return 'pa';
        return null;
    }

    const valeurSaisie = (el) => (el.type === 'checkbox' ? String(el.checked) : String(el.value));

    /** Mémorise la valeur courante des saisies : seule une valeur réellement différente efface les résultats. */
    function memoriserSaisies() {
        toutesRegles().forEach((r) => {
            const el = $(r.id);
            if (el) el.dataset.precedent = el.value;
        });
        REGLES.map((r) => r.id).concat(['ps_systeme', 'ps_pump_type', 'ps_integration_calepinage'], REGLES_ECO.map((r) => r.id),
            REGLES_PLAN.map((r) => r.id), IDS_PLAN_HORS_REGLES).forEach((id) => {
            const el = $(id);
            if (el) el.dataset.vu = valeurSaisie(el);
        });
    }

    /** Efface les résultats rendus obsolètes par la modification de la saisie `id`. */
    function invaliderResultats(id, force) {
        const niveau = portee(id);
        if (!niveau) return;
        const el = $(id);
        if (el) {
            // Valeur inchangée (saisie refusée par le garde-fou, même valeur retapée) : rien à effacer.
            const v = valeurSaisie(el);
            if (el.dataset.vu === v && !force) return;
            el.dataset.vu = v;
        }
        let efface = false;
        if (niveau === 'dim' && dernierResultat) {
            dernierResultat = null;
            dernierInstantane = null;
            derniereProduction = null;
            ['ps_resultats', 'ps_prod_card'].forEach((b) => { const el = $(b); if (el) el.style.display = 'none'; });
            avisRecalcul('dim', true);
            efface = true;
        }
        if ((niveau === 'dim' || niveau.startsWith('eco')) && dernierEco) {
            masquerEco();
            avisRecalcul('eco', niveau !== 'dim');
            efface = true;
        }
        if (niveau !== 'eco' && dernierPlan) {
            masquerPlan();
            avisRecalcul('pa', niveau !== 'dim');
            efface = true;
        }
        if (!efface) return;
        majBlocPlan();
        majEtatValidation();
        // En base aussi : à la réouverture, aucun résultat périmé ne doit réapparaître.
        resultatsAEnvoyer = dernierResultat ? instantaneResultats() : null;
        sauvegarder();
    }

    /** Puissance du calepinage changée depuis le dernier dimensionnement (calepinage modifié sur la carte). */
    function verifierCalepinageInchange() {
        if (!dernierResultat || !dernierInstantane || !dernierInstantane.entrees) return;
        const avant = Number(dernierInstantane.entrees.puissance_reelle_installee_kwc || 0);
        const maintenant = Number(val('ps_puissance_reelle_installee_kwc') || 0);
        if (Math.abs(avant - maintenant) > 1e-6) invaliderResultats('ps_puissance_reelle_installee_kwc', true);
    }

    /**
     * Garde-fou de saisie : une valeur dont l'ordre de grandeur dépasse la borne (ex. un emprunt de
     * 5e21 pour un maximum de 999 999,99) est refusée dès la frappe, l'ancienne valeur est rétablie.
     * Une valeur hors bornes mais du bon ordre de grandeur reste saisissable (liseré rouge, calcul bloqué).
     */
    function limiterSaisie(el) {
        const r = toutesRegles().find((x) => x.id === el.id);
        if (!r || r.max === undefined) return;
        const max = borneMax(r);
        const limite = Math.max(Math.abs(r.min || 0), Math.abs(max));
        const plafond = Math.pow(10, String(Math.floor(limite)).length);
        const brut = String(el.value).trim();
        const v = Number(brut.replace(',', '.'));
        if (brut !== '' && Number.isFinite(v) && Math.abs(v) >= plafond) {
            const precedent = el.dataset.precedent !== undefined ? el.dataset.precedent : (r.defaut !== undefined ? String(r.defaut) : '');
            el.value = precedent;
            message(`${r.libelle} : valeur trop grande, maximum ${borne(max)}.`, 'error', 4000);
            majEtatValidation();
            return;
        }
        el.dataset.precedent = el.value;
    }

    // ---------------------------------------------------------------------------------------
    // Interactions du formulaire
    // ---------------------------------------------------------------------------------------

    /**
     * Affichage selon le type de système : carte active, vignettes (selon le type de pompe), champs
     * pertinents de l'installation envisagée, de l'analyse économique et du plan d'affaires.
     */
    function majAffichageSysteme() {
        const sys = systemeChoisi();
        const type = val('ps_pump_type') === 'surface' ? 'surface' : 'forage';
        document.querySelectorAll('.ps-type-pompe-btn').forEach((btn) => {
            const actif = btn.dataset.type === type;
            btn.classList.toggle('ps-actif', actif);
            btn.setAttribute('aria-checked', String(actif));
        });
        document.querySelectorAll('.ps-systeme-carte').forEach((carte) => {
            const actif = carte.dataset.systeme === sys;
            carte.classList.toggle('ps-actif', actif);
            const radio = carte.querySelector('input[type="radio"]');
            if (radio) radio.checked = actif;
        });
        document.querySelectorAll('.ps-schema-mini').forEach((el) => {
            const cle = `${el.dataset.schema}|${type}`;
            if (el.dataset.rendu !== cle) { el.innerHTML = schemaCircuit(el.dataset.schema, type, { compact: true }); el.dataset.rendu = cle; }
        });
        txt('ps_systeme_resume', `Système retenu : ${SYSTEMES[sys].libelle} — ${type === 'surface' ? 'pompe de surface' : 'pompe immergée (forage)'}.`);
        const montrer = (id, oui) => { const el = $(id); if (el) el.style.display = oui ? '' : 'none'; };
        montrer('ps_grp_ps_coef_reduction_pomp', sys !== 'batteries');
        montrer('ps_bloc_batteries', sys === 'batteries');
        ['ps_eco_ligne_batteries_1', 'ps_eco_ligne_batteries_2'].forEach((id) => montrer(id, sys === 'batteries'));
        ['ps_eco_ligne_groupe_1', 'ps_eco_ligne_groupe_2', 'ps_grp_ps_conso_specifique_ge', 'ps_grp_ps_facteur_emission_co2']
            .forEach((id) => montrer(id, sys === 'groupe'));
        txt('ps_eco_description', descriptionEco(sys));
        majBlocPlan();
    }

    /** Texte d'introduction de l'analyse économique, selon le type de système. */
    function descriptionEco(sys) {
        const duree = window.PompageSolaireCalculs.DUREE_ANALYSE_ANS;
        const commun = " Côté solaire, l'Opex de la centrale est indexé et l'onduleur / contrôleur de pompe est remplacé l'année 10. "
            + "Le besoin en eau croît chaque année du coefficient d'évolution (dès l'année 2) et le pompage solaire baisse avec la dégradation des panneaux.";
        if (sys === 'groupe') {
            return `Compare, sur ${duree} ans, le pompage solaire avec groupe d'appoint au pompage par groupe électrogène seul. `
                + "Avec le solaire, le groupe ne pompe plus que le déficit des mois peu ensoleillés : son Opex et son remplacement sont proratisés sur cette part résiduelle, qui augmente avec le temps." + commun;
        }
        return `Analyse des coûts du pompage solaire sur ${duree} ans. Sans groupe électrogène, il n'y a ni carburant ni groupe à comparer : `
            + "les indicateurs sont le coût global actualisé et le coût actualisé du m³ pompé. Le déficit des mois peu ensoleillés n'est pas pompé : il est indiqué à part."
            + (sys === 'batteries' ? ' Les batteries sont achetées en année 0 et remplacées au terme de leur durée de vie.' : '') + commun;
    }

    /** Choix d'un type de système par l'utilisateur : résultats périmés effacés, champs adaptés. */
    function changerSysteme(sys) {
        const el = $('ps_systeme');
        if (!el || !SYSTEMES[sys]) return;
        if (el.value !== sys) {
            el.value = sys;
            invaliderResultats('ps_systeme');
            sauvegarder();
        }
        majAffichageSysteme();
        majEtatValidation();
    }

    function majHauteurGeometrique() {
        const h = (nombre('ps_h_aspiration') || 0) + (nombre('ps_h_tank') || 0);
        txt('ps_h_geo_display', h.toFixed(1));
    }

    function majLibelleTypePompe() {
        const t = H_ASPIRATION[val('ps_pump_type')] || H_ASPIRATION.forage;
        const label = document.querySelector('label[for="ps_h_aspiration"]');
        if (label) label.textContent = t.libelle;
        const el = $('ps_h_aspiration');
        if (el) { el.min = t.min; el.max = t.max; }
        txt('ps_h_aspiration_aide', `Plage : ${borne(t.min)} – ${borne(t.max)} m.`);
    }

    /** Changement de type par l'utilisateur : on applique la valeur par défaut du nouveau type. */
    function changerTypePompe(type) {
        const sel = $('ps_pump_type');
        if (!sel) return;
        if (type) sel.value = type;
        invaliderResultats('ps_pump_type'); // champ caché : pas d'événement change, les boutons appellent cette fonction
        const t = H_ASPIRATION[sel.value] || H_ASPIRATION.forage;
        const el = $('ps_h_aspiration');
        if (el) el.value = t.defaut;
        majLibelleTypePompe();
        majHauteurGeometrique();
        majAffichageSysteme();
        majEtatValidation();
        if (dernierResultat) afficherPompes();
        sauvegarder();
    }

    function majCalculatricePertes() {
        const { vCalc } = majEtatValidation();
        const statut = $('ps_m_velocity_status');
        if (vCalc.length) {
            txt('ps_m_velocity', '–');
            txt('ps_m_res_val', '–');
            if (statut) statut.textContent = '';
            return;
        }
        const C = window.PompageSolaireCalculs;
        const r = C.pertesDeCharge(val('ps_m_material'), val('ps_m_length'), val('ps_m_diam'),
            val('ps_m_flow'), val('ps_m_acc'));
        txt('ps_m_velocity', r.vitesse.toFixed(2));
        txt('ps_m_res_val', r.pertesM.toFixed(2));
        if (statut) {
            // Plage usuelle en conduite de refoulement : 0,5 à 2 m/s.
            const ok = r.vitesse >= 0.5 && r.vitesse <= 2;
            statut.textContent = r.vitesse > 0 ? (ok ? '✓ dans la plage usuelle' : '⚠ hors plage usuelle (0,5–2 m/s)') : '';
            statut.style.color = ok ? '#15803d' : '#b45309';
        }
    }

    function reporterPertes() {
        const C = window.PompageSolaireCalculs;
        const elPertes = $('ps_m_res_val');
        const pertesM = C.nombreSur(elPertes ? elPertes.textContent : 0, 0);
        const hGeo = (nombre('ps_h_aspiration') || 0) + (nombre('ps_h_tank') || 0);
        if (!(hGeo > 0)) {
            message('Renseignez les hauteurs avant de reporter les pertes de charge.', 'error');
            return;
        }
        let pct = (pertesM / hGeo) * 100;
        const regle = REGLES.find((r) => r.id === 'ps_losses_pipe');
        if (pct > regle.max) {
            message(`Pertes calculées : ${pct.toFixed(1)} % de la hauteur géométrique, au-delà du maximum de ${regle.max} %. Augmentez le diamètre de la conduite ou réduisez sa longueur.`, 'error', 7000);
            return;
        }
        const plancher = pct < regle.min;
        if (plancher) pct = regle.min;
        const el = $('ps_losses_pipe');
        if (el) { el.value = pct.toFixed(1); el.dispatchEvent(new Event('input', { bubbles: true })); }
        sauvegarder();
        message(plancher
            ? `Pertes calculées inférieures à ${regle.min} % : valeur minimale de ${regle.min} % reportée.`
            : `Pertes de charge reportées : ${pct.toFixed(1)} % de la hauteur géométrique.`, 'info');
    }

    function lireEntrees() {
        const batteries = siBatteries();
        return {
            systeme: systemeChoisi(),
            autonomie_batterie_j: batteries ? val('ps_bat_autonomie') : null,
            dod_batterie_pct: batteries ? val('ps_bat_dod') : null,
            rendement_batterie_pct: batteries ? val('ps_bat_rendement') : null,
            daily_need: val('ps_daily_need'),
            h_aspiration: val('ps_h_aspiration'),
            h_tank: val('ps_h_tank'),
            losses_pipe: val('ps_losses_pipe'),
            pump_efficiency: val('ps_pump_efficiency'),
            puissance_reelle_installee_kwc: val('ps_puissance_reelle_installee_kwc'),
            perte_systeme: val('ps_perte_systeme'),
            conso_specifique_ge: siGroupe() ? val('ps_conso_specifique_ge') : null,
            facteur_emission_co2: siGroupe() ? val('ps_facteur_emission_co2') : null,
            coef_reduction_pomp: val('ps_coef_reduction_pomp'),
            coef_surdimensionnement: val('ps_coef_surdimensionnement'),
        };
    }

    function lireEco() {
        return {
            devise: DEVISES[val('ps_eco_devise')] ? val('ps_eco_devise') : 'EUR',
            capex: nombre('ps_eco_capex'),
            opex_pv: nombre('ps_eco_opex_pv'),
            indexation_opex_pv: nombre('ps_eco_indexation_opex_pv'),
            remplacement_onduleur: nombre('ps_eco_remplacement_onduleur'),
            opex_ge: siGroupe() ? nombre('ps_eco_opex_ge') : null,
            remplacement_ge: siGroupe() ? nombre('ps_eco_remplacement_ge') : null,
            prix_carburant: siGroupe() ? nombre('ps_eco_prix_carburant') : null,
            inflation_carburant: siGroupe() ? nombre('ps_eco_inflation') : null,
            taux_actualisation: nombre('ps_eco_taux'),
            evolution_besoins: nombre('ps_eco_evolution_besoins'),
            degradation_pv: nombre('ps_eco_degradation_pv'),
            systeme: systemeChoisi(),
            capex_batterie: siBatteries() ? nombre('ps_eco_capex_batterie') : null,
            remplacement_batterie: siBatteries() ? nombre('ps_eco_remplacement_batterie') : null,
            duree_vie_batterie: siBatteries() ? nombre('ps_eco_duree_vie_batterie') : null,
        };
    }

    // ---------------------------------------------------------------------------------------
    // Choix de la pompe (catalogue BD matériels)
    // ---------------------------------------------------------------------------------------

    function chargerCatalogue() {
        // Pas de raccourci par window.pompeSolaireCatalogFromApi (bd_pompes_solaires.js) : ce
        // catalogue-là est chargé sans les courbes de performance.
        if (!chargementCatalogue) {
            chargementCatalogue = fetch(URL_CATALOGUE_POMPES, { credentials: 'same-origin' })
                .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
                .then((d) => {
                    catalogue = (d && d.success && Array.isArray(d.pompes_solaires)) ? d.pompes_solaires : [];
                    return catalogue;
                })
                .catch((e) => {
                    console.warn('[PompageSolaire] Catalogue des pompes indisponible :', e);
                    chargementCatalogue = null; // nouvel essai au prochain affichage
                    catalogue = [];
                    return catalogue;
                });
        }
        return chargementCatalogue;
    }

    /** « 1.4 kW (…) » / « 8.5 (débit max) » -> premier nombre du texte, ou null. */
    function premierNombre(v) {
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        const m = String(v || '').match(/(\d+(?:[.,]\d+)?)/);
        return m ? parseFloat(m[1].replace(',', '.')) : null;
    }

    function categoriePompe(p) {
        const t = String(p.type_installation || '').toLowerCase();
        if (t.includes('surface')) return 'surface';
        if (/forage|enterr|submersible|immerg|puits/.test(t)) return 'forage';
        return null;
    }

    // --- Pompes à courbes de performance (gamme SQFlex) -------------------------------------
    // Leur adéquation est jugée sur les courbes Q = f(P1) du constructeur (PompageSolaireCalculs.
    // evaluerMontage, miroir de evaluer_montage côté Python) : puissance PV requise au mois le plus
    // faible, montage série / parallèle si une pompe ne suffit pas. Les autres pompes gardent le
    // contrôle simple HMT max / débit.

    const LIBELLES_MONTAGE = { unique: 'pompe unique', parallele: 'en parallèle', serie: 'en série (étages)' };
    let suggestionsCourbes = null; // { uniques, combinaisons } du dernier dimensionnement
    let jumeaux = {};              // id évalué -> ids des variantes aux mêmes courbes (ex. SQF 2.5-2 N)
    let montageConseille = {};     // id -> { montage, nombre } conseillé par le dernier dimensionnement
    let graphPompe = null;

    function courbesPompe(p) {
        const c = p && p.courbes_performance;
        return c && Array.isArray(c.courbes) && c.courbes.length ? c : null;
    }

    /** Données du dernier dimensionnement utiles aux courbes ; null sans calcul. */
    function contexteCourbes() {
        const r = dernierResultat;
        if (!r || !Array.isArray(r.daily_irradiation)) return null;
        const C = window.PompageSolaireCalculs;
        const e = (dernierInstantane && dernierInstantane.entrees) || lireEntrees();
        const kwc = C.nombreSur(e.puissance_reelle_installee_kwc, 0);
        return {
            hmt: r.hmt,
            besoin: r.annual_water_need_m3 / 365,
            irr: r.daily_irradiation,
            pr: C.prPompe(e.perte_systeme),
            pvInstalleWc: kwc > 0 ? kwc * 1000 : 0,
        };
    }

    function montageChoisi() {
        const montage = LIBELLES_MONTAGE[val('ps_pompe_montage')] ? val('ps_pompe_montage') : 'unique';
        const max = window.PompageSolaireCalculs.NB_POMPES_MAX;
        const n = montage === 'unique' ? 1 : Math.max(2, Math.min(max, parseInt(val('ps_pompe_nombre'), 10) || 2));
        return { montage, n };
    }

    /** Évaluation d'une pompe à courbes pour un montage (null : pas de courbes ou pas de calcul). */
    function evaluationPompe(p, montage, n) {
        const courbes = courbesPompe(p);
        const ctx = contexteCourbes();
        if (!courbes || !ctx) return null;
        return window.PompageSolaireCalculs.evaluerMontage(courbes.courbes, montage, n, ctx.hmt, ctx.besoin,
            ctx.irr, ctx.pr, ctx.pvInstalleWc);
    }

    function kwc(wc) { return `${fr(wc / 1000, 2)} kWc`; }

    function motifNonFaisable(ev) {
        if (ev.motif === 'hmt') {
            return `HMT ${fr(ev.hmt_par_pompe_m, 1)} m par pompe au-delà de ses courbes (${fr(ev.plage.hmt_min_m, 0)} à ${fr(ev.plage.hmt_max_m, 0)} m)`;
        }
        if (ev.motif === 'debit') {
            return `${fr(ev.volume_par_pompe_m3j, 1)} m³/j par pompe non atteints au mois le plus faible, même à pleine puissance (${fr(ev.volume_max_m3j || 0, 1)} m³/j au plus)`;
        }
        return 'courbes ou ensoleillement indisponibles';
    }

    /** Incompatibilité entre le type de la pompe et le type de pompage choisi (null : compatible ou inconnu). */
    function ecartType(p, type) {
        const cat = categoriePompe(p);
        if (!cat || cat === type) return null;
        return cat === 'surface' ? 'pompe de surface, alors que le pompage choisi est en forage' : 'pompe immergée, alors que le pompage choisi est en surface';
    }

    /** Écarts entre une pompe du catalogue et le dimensionnement calculé ([] = recommandée). */
    function ecartsPompe(p, r, type) {
        const ecarts = [];
        const eType = ecartType(p, type);
        if (eType) ecarts.push(eType);
        if (courbesPompe(p)) {
            const ev = evaluationPompe(p, 'unique', 1);
            if (ev && !ev.faisable) ecarts.push(motifNonFaisable(ev));
            return ecarts;
        }
        const hmtMax = premierNombre(p.hmt_max_m);
        if (hmtMax === null) ecarts.push('HMT maximale non renseignée');
        else if (hmtMax < r.hmt) ecarts.push(`HMT max ${fr(hmtMax, 0)} m < HMT calculée ${r.hmt.toFixed(1)} m`);
        const debit = premierNombre(p.debit_nominal_m3h);
        if (debit !== null && debit < r.debit_moyen_m3h) ecarts.push(`débit ${fr(debit, 1)} m³/h < débit moyen ${r.debit_moyen_m3h.toFixed(2)} m³/h`);
        return ecarts;
    }

    /** Suggestions sur les pompes à courbes compatibles avec le type de pompage (null sans calcul). */
    function calculerSuggestions(liste, type) {
        const ctx = contexteCourbes();
        if (!ctx) return null;
        // Les variantes « N » (inox 316) ont les mêmes courbes que la version standard : une seule
        // est évaluée (la standard, rangée en premier), l'autre est rattachée à son « jumeau ».
        jumeaux = {};
        const parCourbes = {};
        const pompes = [];
        liste.filter((p) => courbesPompe(p) && (!categoriePompe(p) || categoriePompe(p) === type))
            .sort((a, b) => `${a.fabricant} ${a.reference}`.localeCompare(`${b.fabricant} ${b.reference}`))
            .forEach((p) => {
                const cle = `${p.fabricant}|${JSON.stringify(courbesPompe(p).courbes)}`;
                if (parCourbes[cle] !== undefined) { jumeaux[parCourbes[cle]] = (jumeaux[parCourbes[cle]] || []).concat(p.id); return; }
                parCourbes[cle] = p.id;
                pompes.push({ id: p.id, courbes: courbesPompe(p).courbes });
            });
        if (!pompes.length) return null;
        return window.PompageSolaireCalculs.suggererPompes(pompes, ctx.hmt, ctx.besoin, ctx.irr, ctx.pr, ctx.pvInstalleWc);
    }

    /** Ids d'une proposition et de ses variantes aux mêmes courbes. */
    const avecJumeaux = (id) => [id].concat(jumeaux[id] || []);

    function nomPompe(id) {
        const p = (catalogue || []).find((x) => String(x.id) === String(id));
        return p ? `${p.fabricant} ${p.reference}` : String(id);
    }

    function libelleProposition(ev) {
        const variantes = (jumeaux[ev.id] || []).map((id) => nomPompe(id).split(' ').pop());
        const nom = nomPompe(ev.id) + (variantes.length ? ` (ou ${variantes.map((v) => (v === 'N' ? 'version N' : v)).join(', ')})` : '');
        const tete = ev.nombre > 1 ? `${ev.nombre} × ${nom} ${LIBELLES_MONTAGE[ev.montage]}` : nom;
        return `${tete} — ${kwc(ev.pv_totale_wc)} requis`
            + (ev.rendement_global_pct ? `, rendement ${fr(ev.rendement_global_pct, 0)} %` : '');
    }

    /** Encart des propositions automatiques (meilleure pompe seule, ou montages si aucune ne suffit). */
    function afficherSuggestions() {
        const bloc = $('ps_pompe_suggestions');
        if (!bloc) return;
        const s = suggestionsCourbes;
        if (!s) { bloc.style.display = 'none'; bloc.innerHTML = ''; return; }
        const bouton = (ev, i) => `<button type="button" class="btn-base btn-secondary ps-appliquer-proposition" data-i="${i}"
            style="text-transform:none; font-size:0.8rem; padding:0.3rem 0.7rem; margin:0.25rem 0.4rem 0 0;">${echapper(libelleProposition(ev))}</button>`;
        let html;
        if (s.uniques.length) {
            html = `<strong>Proposition :</strong> la pompe la plus sobre qui couvre seule le besoin au mois le plus faible.<br>${bouton(s.uniques[0], 0)}`;
        } else if (s.combinaisons.length) {
            html = '<strong>Aucune pompe à courbes ne couvre seule le besoin.</strong> Montages proposés (moins de pompes, puis moins de puissance PV) :<br>'
                + s.combinaisons.map((ev, i) => bouton(ev, i)).join('');
        } else {
            html = `<strong>Aucune pompe à courbes ne convient</strong>, même à ${window.PompageSolaireCalculs.NB_POMPES_MAX} pompes en série ou en parallèle : réduire le besoin journalier ou la HMT, ou choisir une autre gamme.`;
        }
        bloc.innerHTML = `<div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:0.6rem 0.85rem; font-size:0.82rem; color:#1e3a8a;">${html}</div>`;
        bloc.style.display = 'block';
        bloc.querySelectorAll('.ps-appliquer-proposition').forEach((b) => b.addEventListener('click', () => {
            const liste = s.uniques.length ? s.uniques : s.combinaisons;
            appliquerProposition(liste[Number(b.dataset.i)]);
        }));
    }

    function appliquerProposition(ev) {
        if (!ev) return;
        const select = $('ps_pompe_choix');
        if (!select) return;
        const filtre = $('ps_pompe_filtre_fabricant');
        if (filtre && filtre.value) { filtre.value = ''; }
        const appliquer = () => {
            select.value = String(ev.id);
            $('ps_pompe_montage').value = ev.montage;
            if (ev.nombre > 1) $('ps_pompe_nombre').value = ev.nombre;
            choixPompeRestaure = '';
            majChoixPompe();
            sauvegarder();
        };
        if (!Array.from(select.options).some((o) => o.value === String(ev.id))) {
            const reco = $('ps_pompe_filtre_reco');
            if (reco) reco.checked = false;
            afficherPompes().then(appliquer);
        } else {
            appliquer();
        }
    }

    async function afficherPompes() {
        const select = $('ps_pompe_choix');
        const filtre = $('ps_pompe_filtre_fabricant');
        const etat = $('ps_pompe_catalogue_etat');
        if (!select || !filtre) return;
        if (catalogue === null && etat) etat.textContent = 'Chargement du catalogue des pompes…';
        const liste = await chargerCatalogue();
        const r = dernierResultat;
        const type = val('ps_pump_type');
        suggestionsCourbes = r ? calculerSuggestions(liste, type) : null;
        const pvRequiseParId = {};
        const montageParId = {}; // pompes qui ne conviennent qu'en série / parallèle : meilleur montage
        if (suggestionsCourbes) {
            suggestionsCourbes.uniques.forEach((ev) => avecJumeaux(ev.id).forEach((id) => { pvRequiseParId[id] = ev.pv_totale_wc; }));
            suggestionsCourbes.combinaisons.forEach((ev) => avecJumeaux(ev.id).forEach((id) => { if (!montageParId[id]) montageParId[id] = ev; }));
        }

        // Filtre fabricant (conserve la sélection).
        const fabricants = Array.from(new Set(liste.map((p) => p.fabricant).filter(Boolean))).sort();
        const filtreActuel = filtre.value;
        filtre.innerHTML = '<option value="">Tous les fabricants</option>'
            + fabricants.map((f) => `<option value="${echapper(f)}">${echapper(f)}</option>`).join('');
        filtre.value = fabricants.includes(filtreActuel) ? filtreActuel : '';

        const recoSeul = !!($('ps_pompe_filtre_reco') && $('ps_pompe_filtre_reco').checked);
        const notees = liste.map((p) => ({ p, ecarts: r ? ecartsPompe(p, r, type) : ['non dimensionné'] }))
            .filter((x) => !filtre.value || x.p.fabricant === filtre.value);
        // Pompes à courbes d'abord, de la moins gourmande en PV à la plus gourmande ; puis les autres par HMT max.
        const cleReco = (x) => (pvRequiseParId[x.p.id] !== undefined ? pvRequiseParId[x.p.id] : 1e9 + (premierNombre(x.p.hmt_max_m) || 0));
        const reco = notees.filter((x) => !x.ecarts.length).sort((a, b) => cleReco(a) - cleReco(b));
        montageConseille = {};
        Object.keys(pvRequiseParId).forEach((id) => { montageConseille[id] = { montage: 'unique', nombre: 1 }; });
        Object.keys(montageParId).forEach((id) => { montageConseille[id] = { montage: montageParId[id].montage, nombre: montageParId[id].nombre }; });
        const enMontage = notees.filter((x) => x.ecarts.length && montageParId[x.p.id])
            .sort((a, b) => montageParId[a.p.id].pv_totale_wc - montageParId[b.p.id].pv_totale_wc
                || `${a.p.reference}`.localeCompare(`${b.p.reference}`));
        const autres = recoSeul ? [] : notees.filter((x) => x.ecarts.length && !montageParId[x.p.id])
            .sort((a, b) => `${a.p.fabricant} ${a.p.reference}`.localeCompare(`${b.p.fabricant} ${b.p.reference}`));
        const optionMontage = (x) => {
            const ev = montageParId[x.p.id];
            return `<option value="${x.p.id}">◆ ${echapper(x.p.fabricant)} — ${echapper(x.p.reference)} · ${ev.nombre} ${ev.montage === 'serie' ? 'en série' : 'en parallèle'}, PV ≈ ${kwc(ev.pv_totale_wc)}</option>`;
        };

        const option = (x, etoile) => {
            const pv = etoile && pvRequiseParId[x.p.id] !== undefined ? ` · PV ≈ ${kwc(pvRequiseParId[x.p.id])}` : '';
            return `<option value="${x.p.id}">${etoile ? '★ ' : ''}${echapper(x.p.fabricant)} — ${echapper(x.p.reference)}${pv}</option>`;
        };
        const actuel = select.value || choixPompeRestaure;
        select.innerHTML = '<option value="">Fabricant par défaut (aucune pompe imposée)</option>'
            + (reco.length ? `<optgroup label="Recommandées pour ce dimensionnement">${reco.map((x) => option(x, true)).join('')}</optgroup>` : '')
            + (enMontage.length ? `<optgroup label="Utilisables à plusieurs (série ou parallèle)">${enMontage.map(optionMontage).join('')}</optgroup>` : '')
            + (autres.length ? `<optgroup label="Autres références">${autres.map((x) => option(x, false)).join('')}</optgroup>` : '')
            + `<option value="${CHOIX_PERSONNALISE}">Référence personnalisée…</option>`;
        if (Array.from(select.options).some((o) => o.value === actuel)) {
            select.value = actuel;
            choixPompeRestaure = '';
        } else {
            select.value = '';
        }

        if (etat) {
            etat.textContent = !liste.length
                ? 'Catalogue des pompes indisponible : vous pouvez saisir une référence personnalisée.'
                : `${reco.length} pompe(s) recommandée(s) seule(s)`
                    + (enMontage.length ? `, ${enMontage.length} utilisable(s) à plusieurs (◆)` : '')
                    + ` sur ${notees.length} référence(s) affichée(s).`;
        }
        afficherSuggestions();
        majChoixPompe();
    }

    function pompeCatalogueChoisie() {
        const v = val('ps_pompe_choix');
        if (!v || v === CHOIX_PERSONNALISE || !Array.isArray(catalogue)) return null;
        return catalogue.find((p) => String(p.id) === v) || null;
    }

    /** Choix courant, sous la forme envoyée au serveur (null = fabricant par défaut). */
    function choixPompe() {
        const v = val('ps_pompe_choix');
        if (v === CHOIX_PERSONNALISE) return { catalogue_id: null, reference_personnalisee: String(val('ps_reference_pompe_installee')).trim() };
        const p = pompeCatalogueChoisie();
        if (p) return { catalogue_id: p.id, reference_personnalisee: null };
        return null;
    }

    /** Libellé du choix de pompe pour l'affichage et le rapport. */
    function libelleChoixPompe() {
        const v = val('ps_pompe_choix');
        if (v === CHOIX_PERSONNALISE) return `${String(val('ps_reference_pompe_installee')).trim()} (référence personnalisée)`;
        const p = pompeCatalogueChoisie();
        if (p) {
            const { montage, n } = montageChoisi();
            const nom = `${p.fabricant} — ${p.reference}`;
            return courbesPompe(p) && montage !== 'unique' ? `${n} × ${nom} ${LIBELLES_MONTAGE[montage]}` : nom;
        }
        return 'Fabricant par défaut (aucune pompe imposée)';
    }

    /**
     * Note de dimensionnement d'une pompe à courbes pour le montage choisi : texte, tableau mensuel,
     * avertissements. null sans calcul ou sans courbes.
     */
    function noteDimensionnement(p) {
        const { montage, n } = montageChoisi();
        const ev = evaluationPompe(p, montage, n);
        const ctx = contexteCourbes();
        if (!ev || !ctx) return null;
        const C = window.PompageSolaireCalculs;
        const nom = `${p.fabricant} ${p.reference}`;
        const irrMin = Math.min.apply(null, ctx.irr.map((x) => C.nombreSur(x, 0)));
        const titre = n > 1 ? `${n} × ${nom} ${LIBELLES_MONTAGE[montage]}` : `${nom}, pompe unique`;
        const avert = [];
        const paragraphes = [];
        if (montage === 'parallele') {
            paragraphes.push(`Montage en parallèle : ${n} pompes identiques, chacune alimentée par son propre générateur photovoltaïque `
                + `(une pompe SQFlex = un MPPT). Chaque pompe refoule à la HMT complète (${fr(ev.hmt_par_pompe_m, 1)} m) et fournit `
                + `${fr(ev.volume_par_pompe_m3j, 1)} m³/j. Installer chaque pompe dans son forage (ou un forage assez large et productif `
                + `pour toutes), avec un clapet anti-retour par branche avant la conduite de refoulement commune.`);
        } else if (montage === 'serie') {
            paragraphes.push(`Montage en série par étages : ${n} pompes identiques relèvent chacune ${fr(ev.hmt_par_pompe_m, 1)} m `
                + `et transfèrent tout le besoin (${fr(ev.volume_par_pompe_m3j, 1)} m³/j). Les pompes SQF étant immergées, chaque étage `
                + `refoule dans une bâche de reprise où est immergée la pompe de l'étage suivant ; un générateur photovoltaïque par pompe. `
                + `Prévoir un capteur de niveau (CU 200) pour arrêter l'étage inférieur quand la bâche est pleine ; la protection `
                + `contre la marche à sec de chaque pompe arrête l'étage supérieur quand elle est vide.`);
        } else {
            paragraphes.push(`Pompe unique : ${nom} refoulant à ${fr(ev.hmt_par_pompe_m, 1)} m pour ${fr(ev.volume_par_pompe_m3j, 1)} m³/j.`);
        }
        if (!ev.faisable) {
            avert.push(`Montage insuffisant : ${motifNonFaisable(ev)}.`);
        } else {
            paragraphes.push(`Puissance photovoltaïque requise : ${fr(ev.pv_par_pompe_wc, 0)} Wc par pompe, soit ${kwc(ev.pv_totale_wc)} au total, `
                + `pour couvrir le besoin au mois le moins ensoleillé (${fr(irrMin, 2)} kWh/m²/j). Rendement global moteur + pompe à ce `
                + `point de fonctionnement : ${ev.rendement_global_pct ? fr(ev.rendement_global_pct, 0) + ' %' : 'n.d.'} `
                + `(rendement retenu par le dimensionnement : ${fr(C.nombreSur(((dernierInstantane && dernierInstantane.entrees) || {}).pump_efficiency, 0.6) * 100, 0)} %).`);
            const installe = ctx.pvInstalleWc > 0;
            paragraphes.push(`Avec ${kwc(ev.pv_utilisee_wc)} ${installe ? 'installés (installation envisagée)' : '(puissance requise)'}, `
                + `taux de couverture annuel du besoin : ${fr(ev.couverture_pct, 1)} %.`);
            if (installe && ev.pv_utilisee_wc < ev.pv_totale_wc) {
                avert.push(`Puissance installée (${kwc(ev.pv_utilisee_wc)}) inférieure à la puissance requise par ce montage (${kwc(ev.pv_totale_wc)}).`);
            }
            // Puissance disponible à midi au mois le plus faible vs P1 max de la pompe à cette hauteur.
            const pMaxH = (C.debitPompe(courbesPompe(p).courbes, ev.hmt_par_pompe_m, 1e6) || [0, 0])[1];
            const pMidi = ev.pv_par_pompe_wc * Math.PI * irrMin / (2 * C.DUREE_JOUR_H) * ctx.pr;
            if (pMaxH > 0 && pMidi > 1.5 * pMaxH) {
                avert.push(`Générateur largement surdimensionné pour cette pompe à cette hauteur (${fr(pMidi, 0)} W disponibles à midi pour `
                    + `${fr(pMaxH, 0)} W absorbés au plus) : la pompe tourne à plein débit une grande partie de la journée. Une pompe de plus `
                    + `grand débit ou un montage à plus de pompes réduirait la puissance PV.`);
            }
        }
        paragraphes.push(`Hypothèses : courbes du constructeur (valeurs moyennes, écart type ±15 %), journée type de ${C.DUREE_JOUR_H} h `
            + `en demi-sinusoïde, PR = (1 - pertes système) × ${fr(C.FACTEUR_TEMPERATURE, 2)} (échauffement des modules, pas d'onduleur). `
            + `Le coefficient de réduction n'est pas appliqué : le seuil de démarrage est lu sur les courbes.`);
        const lignes = ev.volumes_journaliers_m3.length ? MOIS.map((m, i) => {
            const v = ev.volumes_journaliers_m3[i];
            return [m, fr(C.nombreSur(ctx.irr[i], 0), 2), fr(v, 1), fr(ctx.besoin, 1), v + 1e-9 >= ctx.besoin ? 'Oui' : `${fr(v / ctx.besoin * 100, 0)} %`];
        }) : [];
        return { ev, titre, paragraphes, avert, lignes, ctx, irrMin };
    }
    const ENTETE_NOTE = ['Mois', 'Irradiation (kWh/m²/j)', 'Volume pompé (m³/j)', 'Besoin (m³/j)', 'Besoin couvert'];

    /** Graphique Q = f(P1) : une courbe par hauteur, la hauteur par pompe du projet et le point de fonctionnement. */
    function configCourbesPompe(p, note) {
        const courbes = courbesPompe(p);
        if (!courbes) return null;
        const C = window.PompageSolaireCalculs;
        const triees = C.courbesTriees(courbes.courbes);
        const datasets = triees.map((c, i) => {
            const teinte = Math.round(210 - 150 * i / Math.max(1, triees.length - 1));
            return {
                label: `${fr(c.h, 0)} m`, data: c.pts.map((pt) => ({ x: pt[0], y: pt[1] })), showLine: true,
                borderColor: `hsl(${teinte}, 55%, 45%)`, backgroundColor: `hsl(${teinte}, 55%, 45%)`,
                borderWidth: 1.4, pointRadius: 0, tension: 0,
            };
        });
        if (note && note.ev && note.ev.plage && note.ev.hmt_par_pompe_m <= note.ev.plage.hmt_max_m) {
            const h = note.ev.hmt_par_pompe_m;
            const pl = note.ev.plage;
            const pts = [];
            for (let k = 0; k <= 60; k++) {
                const p1 = pl.p1_demarrage_min_w + (pl.p1_max_w - pl.p1_demarrage_min_w) * k / 60;
                const r = C.debitPompe(triees, h, p1);
                if (r && r[0] > 0 && (!pts.length || r[1] > pts[pts.length - 1].x)) pts.push({ x: r[1], y: r[0] });
            }
            datasets.push({
                label: `Projet : ${fr(h, 1)} m par pompe`, data: pts, showLine: true, borderColor: '#dc2626',
                backgroundColor: '#dc2626', borderWidth: 2.5, borderDash: [6, 4], pointRadius: 0,
            });
            if (note.ev.faisable) {
                // Puissance disponible à midi au mois le plus faible, avec la puissance PV retenue.
                const gMax = Math.PI * note.irrMin / (2 * C.DUREE_JOUR_H);
                const r = C.debitPompe(triees, h, note.ev.pv_utilisee_wc / note.ev.nombre * gMax * note.ctx.pr);
                if (r && r[0] > 0) {
                    datasets.push({
                        label: 'Fonctionnement à midi, mois le plus faible', data: [{ x: r[1], y: r[0] }],
                        borderColor: '#111827', backgroundColor: '#f59e0b', pointRadius: 7, pointHoverRadius: 8,
                        pointStyle: 'rectRot', borderWidth: 1.5,
                    });
                }
            }
        }
        return {
            type: 'scatter',
            data: { datasets },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                plugins: {
                    legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
                    tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} : P1 ${fr(c.parsed.x, 0)} W → Q ${fr(c.parsed.y, 2)} m³/h` } },
                },
                scales: {
                    x: { type: 'linear', min: 0, title: { display: true, text: 'Puissance absorbée P1 (W)' }, grid: { color: 'rgba(0,0,0,0.06)' } },
                    y: { min: 0, title: { display: true, text: 'Débit Q (m³/h)' }, grid: { color: 'rgba(0,0,0,0.06)' } },
                },
            },
        };
    }

    function tracerCourbesPompe(p, note) {
        if (graphPompe) { graphPompe.destroy(); graphPompe = null; }
        const canvas = $('ps_chart_pompe');
        const cfg = configCourbesPompe(p, note);
        if (!canvas || !cfg || typeof Chart === 'undefined') return;
        graphPompe = new Chart(canvas.getContext('2d'), cfg);
    }

    function appliquerRendementPompe(pct) {
        const el = $('ps_pump_efficiency');
        if (!el || !(pct > 0)) return;
        const regle = REGLES.find((x) => x.id === 'ps_pump_efficiency');
        const v = Math.min(regle.max, Math.max(regle.min, Math.round(pct) / 100));
        el.value = v.toFixed(2);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        sauvegarder();
        message(`Rendement global ${fr(v * 100, 0)} % reporté dans le formulaire : relancez « Dimensionner le système de pompage » pour en tenir compte.`, 'info', 6000);
    }

    function majChoixPompe() {
        const perso = val('ps_pompe_choix') === CHOIX_PERSONNALISE;
        const ref = $('ps_reference_pompe_installee');
        if (ref) ref.style.display = perso ? '' : 'none';
        const aide = $('ps_reference_aide');
        if (aide) aide.style.display = perso ? '' : 'none';

        const details = $('ps_pompe_details');
        const p = pompeCatalogueChoisie();
        const aCourbes = !!courbesPompe(p);
        const nombre = $('ps_pompe_nombre');
        // Le nombre de pompes n'a de sens qu'en série / parallèle : masqué en pompe unique.
        const plusieurs = LIBELLES_MONTAGE[val('ps_pompe_montage')] && val('ps_pompe_montage') !== 'unique';
        const groupeNombre = $('ps_pompe_nombre_groupe');
        if (groupeNombre) groupeNombre.style.display = plusieurs ? 'flex' : 'none';
        if (nombre) nombre.disabled = !plusieurs;
        if (graphPompe) { graphPompe.destroy(); graphPompe = null; }
        if (details) {
            if (!p) {
                details.style.display = 'none';
                details.innerHTML = '';
            } else {
                const note = aCourbes ? noteDimensionnement(p) : null;
                // Pompe à courbes : jugée sur le montage choisi (et non sur la pompe seule).
                const ecarts = !dernierResultat ? []
                    : note ? [ecartType(p, val('ps_pump_type'))].concat(note.ev.faisable ? [] : [motifNonFaisable(note.ev)]).filter(Boolean)
                        : ecartsPompe(p, dernierResultat, val('ps_pump_type'));
                const ligne = (k, v) => (v === null || v === undefined || v === '' ? ''
                    : `<tr><td style="color:var(--text-secondary); padding:0.2rem 0.75rem 0.2rem 0; vertical-align:top;">${k}</td><td style="padding:0.2rem 0; font-weight:500;">${echapper(v)}</td></tr>`);
                const plage = aCourbes ? window.PompageSolaireCalculs.plagePompe(courbesPompe(p).courbes) : null;
                const applications = Array.isArray(p.applications) && p.applications.length
                    ? `<p style="margin:0.6rem 0 0.2rem; font-size:0.8rem; font-weight:700; color:#1e293b;">Applications compatibles</p>
                       <ul style="margin:0; padding-left:1.1rem; font-size:0.78rem; line-height:1.45;">${p.applications.map((a) => `<li>${echapper(a)}</li>`).join('')}</ul>` : '';
                const blocNote = note ? `
                    <div style="margin-top:0.75rem; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:0.75rem 1rem;">
                        <p style="margin:0 0 0.4rem; font-size:0.85rem; font-weight:700; color:#1e293b;">Note de dimensionnement — ${echapper(note.titre)}</p>
                        ${note.avert.map((a) => `<p style="margin:0 0 0.4rem; font-size:0.8rem; color:#9a3412;">⚠ ${echapper(a)}</p>`).join('')}
                        ${note.paragraphes.map((t) => `<p style="margin:0 0 0.4rem; font-size:0.8rem; line-height:1.45;">${echapper(t)}</p>`).join('')}
                        ${note.lignes.length ? `<div style="overflow-x:auto; margin-top:0.4rem;"><table class="ps-table"><thead><tr>${ENTETE_NOTE.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
                            <tbody>${note.lignes.map((l) => `<tr>${l.map((c) => `<td>${echapper(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
                        ${note.ev.rendement_global_pct ? `<button type="button" id="ps_btn_rendement_pompe" class="btn-base btn-secondary"
                            style="text-transform:none; font-size:0.8rem; padding:0.35rem 0.8rem; margin-top:0.6rem;">Reporter ce rendement (${fr(note.ev.rendement_global_pct, 0)} %) dans le formulaire</button>` : ''}
                    </div>` : (aCourbes && !dernierResultat ? '<p style="margin:0.6rem 0 0; font-size:0.78rem; color:var(--text-secondary);">Dimensionnez le pompage pour obtenir la note de dimensionnement de cette pompe.</p>' : '');
                const blocCourbes = aCourbes ? `
                    <div style="margin-top:0.75rem; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:0.75rem 1rem;">
                        <p style="margin:0 0 0.4rem; font-size:0.85rem; font-weight:700; color:#1e293b;">Courbes de performance : débit selon la puissance absorbée, par hauteur manométrique</p>
                        <div style="position:relative; height:340px; width:100%;"><canvas id="ps_chart_pompe"></canvas></div>
                        <p style="margin:0.3rem 0 0; font-size:0.72rem; color:var(--text-secondary);">${echapper((courbesPompe(p).source || '') + (courbesPompe(p).validite ? ' — ' + courbesPompe(p).validite : ''))}</p>
                    </div>` : '';
                details.innerHTML = `
                    <div style="background:${ecarts.length ? '#fff7ed' : '#f0fdf4'}; border:1px solid ${ecarts.length ? '#fed7aa' : '#bbf7d0'}; border-radius:8px; padding:0.75rem 1rem;">
                        <p style="margin:0 0 0.4rem; font-size:0.85rem; font-weight:700; color:${ecarts.length ? '#9a3412' : '#166534'};">
                            ${ecarts.length ? '⚠ Pompe à vérifier : ' + echapper(ecarts.join(' ; ')) : (dernierResultat ? '✓ Pompe compatible avec le dimensionnement' : 'Fiche de la pompe')}</p>
                        <table style="font-size:0.8rem; border-collapse:collapse;">
                            ${ligne('Type d\'installation', p.type_installation)}
                            ${ligne('Technologie', p.technologie_hydraulique)}
                            ${ligne('Moteur', p.moteur)}
                            ${ligne('Puissance', p.puissance_kw !== null && p.puissance_kw !== undefined ? `${p.puissance_kw} kW` : '')}
                            ${plage ? ligne('Plage de fonctionnement', `HMT ${fr(plage.hmt_min_m, 0)} à ${fr(plage.hmt_max_m, 0)} m ; débit jusqu'à ${fr(plage.debit_max_m3h, 2)} m³/h ; P1 de ${fr(plage.p1_demarrage_min_w, 0)} W (démarrage) à ${fr(plage.p1_max_w, 0)} W`) : ligne('HMT max', p.hmt_max_m !== null && p.hmt_max_m !== undefined ? `${p.hmt_max_m} m` : '')}
                            ${plage ? '' : ligne('Débit', p.debit_nominal_m3h ? `${p.debit_nominal_m3h} m³/h` : '')}
                            ${ligne('Tension d\'entrée solaire', p.tension_entree_solaire)}
                            ${ligne('Diamètre de forage minimal', p.diametre_forage_min)}
                            ${ligne('Rendement hydraulique', p.rendement_hydraulique_pct ? `${p.rendement_hydraulique_pct} % (partie hydraulique seule, hors moteur)` : '')}
                            ${ligne('Matériaux', p.materiaux)}
                            ${ligne('Code article', p.code_article)}
                        </table>
                        ${applications}
                    </div>
                    ${blocNote}
                    ${blocCourbes}`;
                details.style.display = 'block';
                if (aCourbes) tracerCourbesPompe(p, note);
                const btn = $('ps_btn_rendement_pompe');
                if (btn && note) btn.addEventListener('click', () => appliquerRendementPompe(note.ev.rendement_global_pct));
            }
        }
        majEtatValidation();
    }

    // ---------------------------------------------------------------------------------------
    // Calcul : irradiation au serveur (qui valide aussi toutes les saisies), dimensionnement ici
    // ---------------------------------------------------------------------------------------

    // ---------------------------------------------------------------------------------------
    // Intégration du calepinage : puissance réelle et production réelle (module Production solaire)
    // ---------------------------------------------------------------------------------------

    const integrationDemandee = () => !!($('ps_integration_calepinage') && $('ps_integration_calepinage').checked);

    /** Page principale (carte + calepinage), parente de cette modale ; null hors de l'application. */
    function pageProjet() {
        try {
            return (window.parent && window.parent !== window && window.parent.document) ? window.parent : null;
        } catch (e) { return null; }
    }

    function lireProjetSolaire() {
        try { return JSON.parse(localStorage.getItem('solarProjectData') || '{}') || {}; } catch (e) { return {}; }
    }

    /** Champs PV du projet (solarProjectData.calculatedPvs) : puissance totale, panneaux, références. */
    function lireChampsPv() {
        const data = lireProjetSolaire();
        const champs = (Array.isArray(data.calculatedPvs) ? data.calculatedPvs : [])
            .filter((pv) => pv && Number(pv.peakPower) > 0);
        const kwc = champs.reduce((t, pv) => t + Number(pv.peakPower), 0);
        const panneaux = champs.reduce((t, pv) => t + (Number(pv.panelCount) || 0), 0);
        const refs = Array.from(new Set(champs.map((pv) => pv.panelRef).filter(Boolean)));
        const sources = Array.from(new Set(champs.map((pv) => pv.sourceId).filter(Boolean)));
        return { champs, kwc, panneaux, refs, sources };
    }

    /**
     * Réécrit solarProjectData.calculatedPvs à partir du calepinage ACTUEL de la page principale,
     * scène d'ombrage 3D comprise (même logique que ResidentielAutoconsoEmbed.js) : le module
     * Production solaire, imbriqué ici dans une 2e iframe, ne voit pas la page principale lui-même.
     */
    function synchroniserCalepinage() {
        const P = pageProjet();
        if (P) {
            try {
                const sm = P.summaryModalInstance;
                const CM = P.CalepinageMaisonIndiv;
                if (sm && typeof sm.refreshFromStorage === 'function') {
                    sm.refreshFromStorage();
                } else if (CM && typeof CM.getAllPvFieldSummaries === 'function') {
                    const maisons = CM.getAllPvFieldSummaries() || [];
                    const data = lireProjetSolaire();
                    const autres = (Array.isArray(data.calculatedPvs) ? data.calculatedPvs : []).filter((pv) => !(pv && pv.sourceId));
                    data.calculatedPvs = autres.concat(maisons);
                    if (typeof CM.attachShadingSceneToProjectData === 'function') CM.attachShadingSceneToProjectData(data);
                    data.totals = Object.assign({}, data.totals, { lastUpdated: new Date().toISOString() });
                    localStorage.setItem('solarProjectData', JSON.stringify(data));
                }
            } catch (e) {
                console.warn('[PompageSolaire] Synchronisation du calepinage impossible :', e);
            }
        }
        return lireChampsPv();
    }

    /** Affiche (true) ou masque (false) la carte « Choix de la pompe », masquée par défaut. */
    function afficherChoixPompe(ouvrir) {
        const carte = $('ps_pompe_card');
        const bouton = $('ps_btn_pompe_toggle');
        if (!carte) return;
        carte.style.display = ouvrir ? 'block' : 'none';
        if (bouton) {
            bouton.textContent = ouvrir ? 'Masquer le choix de la pompe' : 'Afficher le choix de la pompe';
            bouton.setAttribute('aria-expanded', String(!!ouvrir));
        }
        // Graphique des courbes créé pendant que la carte était masquée : à redimensionner.
        if (ouvrir && graphPompe) graphPompe.resize();
    }

    /** Met le focus sur un champ en erreur, en ouvrant d'abord la carte de la pompe s'il s'y trouve. */
    function focaliser(el) {
        if (!el) return;
        const carte = $('ps_pompe_card');
        if (carte && carte.contains(el) && carte.style.display === 'none') afficherChoixPompe(true);
        el.focus();
    }

    /**
     * Section 6 : ouvre la modale « Chaînes et pertes » de la page principale (au-dessus de cette
     * modale), avec les mêmes champs PV que le bouton du récapitulatif (PRO) ou du calepinage
     * résidentiel.
     */
    function ouvrirDimensionnementChaines() {
        const P = pageProjet();
        if (!P || typeof P.openChainesPertesModal !== 'function') {
            message('Dimensionnement des chaînes indisponible ici : ouvrez cette modale depuis le projet.', 'error', 5000);
            return;
        }
        let champs = [];
        try {
            const sm = P.summaryModalInstance;
            const CM = P.CalepinageMaisonIndiv;
            // refreshFromStorage -> updateSummary publie la liste complète (PRO + résidentiel).
            if (sm && typeof sm.refreshFromStorage === 'function') sm.refreshFromStorage();
            if (Array.isArray(P.__chainesPertesChampsProjet)) champs = P.__chainesPertesChampsProjet;
            else if (CM && typeof CM.getPvFieldsForChainesPertes === 'function') champs = CM.getPvFieldsForChainesPertes() || [];
        } catch (e) {
            console.warn('[PompageSolaire] Champs PV indisponibles pour les chaînes :', e);
        }
        if (!champs.length) message('Aucun champ PV calepiné : dessinez les panneaux pour dimensionner les chaînes.', 'info', 5000);
        P.openChainesPertesModal(champs);
    }

    /**
     * Section 2 : ouvre l'extrait du calepinage résidentiel (pente, panneau, onduleur, pertes système)
     * au-dessus de cette modale. C'est le formulaire du calepinage lui-même (même état, même
     * enregistrement) : rien à recopier. Ses saisies de pente / pertes reviennent ici en direct
     * (calepinageParametresPompageChanged) ; à sa fermeture, tout est resynchronisé
     * (calepinageExtraitPompageFerme, cf. cabler).
     */
    function ouvrirExtraitCalepinage() {
        const P = pageProjet();
        const CM = P && P.CalepinageMaisonIndiv;
        if (!CM || typeof CM.ouvrirExtraitPompage !== 'function') {
            message('Calepinage indisponible ici : ouvrez cette modale depuis le projet.', 'error', 5000);
            return;
        }
        let res;
        try { res = CM.ouvrirExtraitPompage(); } catch (e) {
            console.warn('[PompageSolaire] Ouverture du calepinage impossible :', e);
            res = { ok: false, message: 'Ouverture du calepinage impossible.' };
        }
        if (!res || !res.ok) message((res && res.message) || 'Ouverture du calepinage impossible.', 'info', 6000);
    }

    /** Extrait du calepinage refermé : puissance, pente et pertes relues. */
    function apresExtraitCalepinage() {
        if (!construit) return;
        majPuissanceCalepinage();
        verifierCalepinageInchange();
        synchroniserParametresCalepinage();
        majEtatValidation();
    }

    /**
     * Case cochée : « Puissance PV installée » = puissance du calepinage (lecture seule). Sans
     * calepinage, le champ redevient saisissable et le calcul se fait sur l'estimation PVGIS.
     * @returns {object|null} champs PV du calepinage si l'intégration est active et possible
     */
    function majPuissanceCalepinage() {
        const champ = $('ps_puissance_reelle_installee_kwc');
        const statut = $('ps_calepinage_statut');
        const liberer = () => { if (champ) { champ.readOnly = false; champ.style.backgroundColor = ''; champ.title = ''; } };
        if (!integrationDemandee()) {
            liberer();
            if (statut) statut.textContent = '';
            return null;
        }
        const info = synchroniserCalepinage();
        if (!(info.kwc > 0)) {
            liberer();
            if (statut) {
                statut.style.color = '#b45309';
                statut.textContent = "Aucun champ PV dans le calepinage de ce projet : le dimensionnement utilise la puissance saisie (ou la puissance théorique). Réalisez le calepinage sur la carte pour intégrer la production réelle.";
            }
            return null;
        }
        if (champ) {
            champ.value = Math.round(info.kwc * 100) / 100;
            champ.readOnly = true;
            champ.style.backgroundColor = '#f1f5f9';
            champ.title = 'Synchronisée avec le calepinage (décochez « Intégration du calepinage des panneaux » pour la saisir)';
        }
        if (statut) {
            statut.style.color = '#166534';
            statut.textContent = `Calepinage intégré : ${fr(info.kwc, 2)} kWc, ${info.champs.length} champ(s)`
                + `${info.panneaux ? `, ${info.panneaux} panneau(x)` : ''}. La production réelle (ombrage 3D compris) sera calculée au dimensionnement.`;
        }
        majHauteurGeometrique();
        return info;
    }

    // Inclinaison et pertes communes au pompage et au calepinage : champ du pompage -> paramètre des
    // champs PV (« Pente toiture 1 », « Pertes système » du calepinage résidentiel).
    const PARAMETRES_CALEPINAGE = { ps_angle: 'penteDeg', ps_perte_systeme: 'perteSysteme' };

    function calepinageMaison() {
        const P = pageProjet();
        const CM = P && P.CalepinageMaisonIndiv;
        return CM && typeof CM.lireParametresPompage === 'function' ? CM : null;
    }

    function afficherStatutParametres(texte, alerte) {
        const el = $('ps_parametres_calepinage_statut');
        if (!el) return;
        el.style.display = texte ? 'block' : 'none';
        el.style.color = alerte ? '#b45309' : '#166534';
        el.textContent = texte || '';
    }

    /** Le calepinage a changé de puissance (la pente modifie l'emprise des rangées) : report ici. */
    function apresEcritureCalepinage() {
        majPuissanceCalepinage();
        verifierCalepinageInchange();
        majEtatValidation();
    }

    /** Inclinaison et pertes saisies ici, valides, sous les noms du calepinage. */
    function valeursPourCalepinage() {
        const valeurs = {};
        Object.keys(PARAMETRES_CALEPINAGE).forEach((id) => {
            if (!violation(REGLES.find((x) => x.id === id))) valeurs[PARAMETRES_CALEPINAGE[id]] = nombre(id);
        });
        return valeurs;
    }

    /**
     * Case « Intégration du calepinage » cochée : l'inclinaison et les pertes sont communes au pompage
     * et aux champs PV liés (case « Pompage solaire » du calepinage, à défaut tous les champs).
     *  - pas encore de champ PV : les valeurs du pompage sont gardées pour le projet, et chaque champ PV
     *    créé ensuite sur la carte les reprend (calepinage_maison_parametres_pompage.js) ;
     *  - champ PV dont la valeur n'a jamais été saisie (défaut du calepinage), ou saisie AVANT la dernière
     *    saisie du pompage : il reçoit celle du pompage ;
     *  - sinon le calepinage fait foi (saisie plus récente dans le formulaire résidentiel ou « Chaînes et pertes »).
     */
    function synchroniserParametresCalepinage() {
        afficherStatutParametres('');
        if (!construit || !integrationDemandee() || persistance === 'chargement') return;
        const CM = calepinageMaison();
        if (!CM) return;
        let lu;
        try { lu = CM.lireParametresPompage(); } catch (e) {
            console.warn('[PompageSolaire] Paramètres du calepinage illisibles :', e);
            return;
        }
        if (!lu || !lu.nbChamps) {
            try { CM.memoriserParametresPompage(valeursPourCalepinage()); } catch (e) { /* noop */ }
            afficherStatutParametres('🔗 Inclinaison et pertes reprises par les champs PV que vous dessinerez sur la carte (« Pente toiture 1 », « Pertes système » du calepinage).');
            return;
        }
        const aEnvoyer = {};
        const alertes = [];
        Object.keys(PARAMETRES_CALEPINAGE).forEach((id) => {
            const p = lu[PARAMETRES_CALEPINAGE[id]];
            const r = REGLES.find((x) => x.id === id);
            const el = $(id);
            if (!p || !el) return;
            // Dates absentes (ancien calepinage) : 0 des deux côtés, le calepinage fait foi comme avant.
            if (p.parDefaut || (p.saisiLePompage || 0) > (p.saisiLe || 0)) {
                if (!violation(r)) aEnvoyer[PARAMETRES_CALEPINAGE[id]] = nombre(id);
                return;
            }
            if (!Number.isFinite(p.valeur)) return;
            // Bornes du calepinage plus larges (pertes 6-30 %) : une valeur hors de celles du pompage
            // n'est pas reprise, le calcul serait bloqué sur une saisie faite ailleurs.
            if (p.valeur < r.min || p.valeur > r.max) {
                alertes.push(`${r.libelle} du calepinage (${fr(p.valeur, 1)}) hors de la plage du pompage : non reprise.`);
                return;
            }
            if (!p.uniforme) alertes.push(`${r.libelle} : valeurs différentes selon les champs PV, celle du premier champ est reprise.`);
            if (nombre(id) !== p.valeur) {
                el.value = p.valeur;
                el.dataset.precedent = el.value;
                invaliderResultats(id);
                sauvegarder();
            }
        });
        try {
            if (Object.keys(aEnvoyer).length && CM.appliquerParametresPompage(aEnvoyer) > 0) apresEcritureCalepinage();
            // Valeurs finales (reprises ou imposées) : celles des champs PV créés ensuite.
            CM.memoriserParametresPompage(valeursPourCalepinage());
        } catch (e) {
            console.warn('[PompageSolaire] Écriture dans le calepinage impossible :', e);
        }
        majEtatValidation();
        afficherStatutParametres(alertes.length ? alertes.join(' ')
            : `🔗 Inclinaison et pertes synchronisées avec ${lu.nbChamps} champ(s) PV du calepinage (« Pente toiture 1 », « Pertes système »).`,
        alertes.length > 0);
    }

    /** Saisie de `id` en cours : gardée (et datée) pour le projet, reportée dans les champs PV après une pause. */
    const minuteriesEnvoiParametre = {};
    function memoriserParametresCalepinage(id) {
        const CM = integrationDemandee() ? calepinageMaison() : null;
        if (!CM) return;
        try { CM.memoriserParametresPompage(valeursPourCalepinage(), [PARAMETRES_CALEPINAGE[id]]); } catch (e) { /* noop */ }
        // Saisie jamais validée (pas de « change » : modale fermée champ actif) : reportée quand même.
        clearTimeout(minuteriesEnvoiParametre[id]);
        minuteriesEnvoiParametre[id] = setTimeout(() => envoyerParametreCalepinage(id), 800);
    }

    /** Saisie de l'inclinaison ou des pertes ici : reportée dans les champs PV liés. */
    function envoyerParametreCalepinage(id) {
        clearTimeout(minuteriesEnvoiParametre[id]);
        if (!integrationDemandee()) return;
        const CM = calepinageMaison();
        const r = REGLES.find((x) => x.id === id);
        if (!CM || violation(r)) return;
        try {
            if (CM.appliquerParametresPompage({ [PARAMETRES_CALEPINAGE[id]]: nombre(id) }) > 0) apresEcritureCalepinage();
        } catch (e) {
            console.warn('[PompageSolaire] Écriture dans le calepinage impossible :', e);
        }
    }

    /** Valeurs envoyées au contrôle serveur (null : pas de champ PV résidentiel lié, rien à contrôler). */
    function controleParametresPompage() {
        const CM = integrationDemandee() ? calepinageMaison() : null;
        if (!CM || typeof CM.parametresChampsPompage !== 'function') return null;
        let champs = [];
        try { champs = CM.parametresChampsPompage(); } catch (e) {
            console.warn('[PompageSolaire] Paramètres du calepinage illisibles :', e);
        }
        if (!champs.length) return null;
        return { angle: nombre('ps_angle'), perte_systeme: nombre('ps_perte_systeme'), champs };
    }

    function creerIframeProduction() {
        const hote = $('ps_prod_iframe_hote');
        if (!hote) return null;
        hote.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.id = 'ps_prod_iframe';
        iframe.title = 'Module Production solaire';
        iframe.style.cssText = 'width:100%; min-height:900px; border:none; display:block;';
        iframe.addEventListener('load', () => {
            try {
                const doc = iframe.contentDocument;
                if (doc && !doc.getElementById('ps-prod-embed-style')) {
                    const style = doc.createElement('style');
                    style.id = 'ps-prod-embed-style';
                    // Résultats seuls : le formulaire de gauche est piloté d'ici (vente en totalité).
                    style.textContent = '.left-panel { display: none !important; } .app-content { grid-template-columns: 1fr !important; }';
                    doc.head.appendChild(style);
                }
            } catch (e) { console.warn('[PompageSolaire] Style du module Production solaire non injecté :', e); }
        });
        hote.appendChild(iframe);
        const url = new URL(URL_PRODUCTION_SOLAIRE, window.location.href);
        url.searchParams.set('autoOpen', 'true');
        iframe.src = url.href;
        return iframe;
    }

    function attendreIframeProduction(delaiMs) {
        return new Promise((resolve) => {
            const debut = Date.now();
            const verifier = () => {
                try {
                    const w = iframeProduction && iframeProduction.isConnected ? iframeProduction.contentWindow : null;
                    if (w && typeof w.calculate === 'function' && w.document && w.document.readyState === 'complete') { resolve(true); return; }
                } catch (e) { /* navigation en cours */ }
                if (Date.now() - debut > delaiMs) { resolve(false); return; }
                setTimeout(verifier, 200);
            };
            verifier();
        });
    }

    /**
     * Lance le calcul « vente en totalité » du module Production solaire sur le calepinage actuel et
     * renvoie la production réelle. Lève une erreur si elle est indisponible ou incohérente.
     */
    async function calculerProductionReelle(info) {
        if (!iframeProduction || !iframeProduction.isConnected) iframeProduction = creerIframeProduction();
        if (!iframeProduction) throw new Error('zone de résultats absente');
        const prete = await attendreIframeProduction(25000);
        if (!prete) {
            if (iframeProduction.parentNode) iframeProduction.parentNode.removeChild(iframeProduction);
            iframeProduction = null;
            throw new Error("le module Production solaire ne s'est pas chargé");
        }
        // main_autoconso.js n'ouvre son panneau que 100 ms après son chargement (graphiques 0x0 sinon).
        await new Promise((r) => setTimeout(r, 300));
        const w = iframeProduction.contentWindow;
        const radio = w.document.querySelector('input[name="study_type"][value="vente_totalite"]');
        let etudeAvant = null;
        try { etudeAvant = localStorage.getItem('studyType'); } catch (e) { /* noop */ }
        if (radio && !radio.checked) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
        synchroniserCalepinage();
        // Inclinaison et pertes du pompage et des champs PV liés : comparées par le serveur au
        // lancement du calcul, un écart (synchronisation échouée) bloque l'étude.
        w.controleParametresPompage = controleParametresPompage();
        w.dernierCalculAutoconsoBlocagePompage = null;
        try {
            await w.calculate();
        } finally {
            w.controleParametresPompage = null;
            // Le choix d'étude mémorisé du module (autres parcours) n'est pas modifié par le pompage.
            try {
                if (etudeAvant === null) localStorage.removeItem('studyType');
                else localStorage.setItem('studyType', etudeAvant);
            } catch (e) { /* noop */ }
        }
        if (w.dernierCalculAutoconsoBlocagePompage) {
            const err = new Error(w.dernierCalculAutoconsoBlocagePompage);
            err.parametresPompage = true;
            throw err;
        }

        let res = null;
        try { res = JSON.parse(localStorage.getItem('solar_sim_data') || 'null'); } catch (e) { res = null; }
        const sites = (res && res.sites) || {};
        const site = sites.Global || sites[(res && res.site_keys && res.site_keys[0]) || ''];
        const mensuelMwh = site && site.monthly_data && site.monthly_data.pv_production;
        if (!Array.isArray(mensuelMwh) || mensuelMwh.length !== 12 || !mensuelMwh.some((v) => Number(v) > 0)) {
            throw new Error('production mensuelle absente des résultats');
        }
        const pv = res.pv_summary || {};
        const summary = pv.summary || null;
        // Garde-fou : un calcul échoué laisse en place le résultat précédent — il doit correspondre
        // au calepinage actuel.
        if (summary && summary.peak_power_kw > 0 && Math.abs(summary.peak_power_kw - info.kwc) > Math.max(0.05, info.kwc * 0.03)) {
            throw new Error(`la production calculée (${fr(summary.peak_power_kw, 2)} kWc) ne correspond pas au calepinage actuel (${fr(info.kwc, 2)} kWc)`);
        }
        return {
            mensuelKwh: mensuelMwh.map((v) => Math.round(Number(v) * 1000 * 100) / 100),
            summary,
            fields: Array.isArray(pv.fields) ? pv.fields : [],
            champs: info,
        };
    }

    const pct = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : `${fr(v, 2)} %`);

    /** Lignes [libellé, valeur] du tableau des résultats réels (modale et rapport). */
    function lignesProductionReelle(prod) {
        const sm = prod.summary || {};
        const info = prod.champs || {};
        const total = prod.mensuelKwh.reduce((t, v) => t + v, 0);
        const kwc = sm.peak_power_kw || info.kwc || 0;
        return [
            ['Puissance PV installée (calepinage)', `${fr(kwc, 2)} kWc`],
            ['Champs PV / panneaux', `${(info.champs || []).length} champ(s)${info.panneaux ? ` · ${info.panneaux} panneaux` : ''}`],
            ['Référence(s) des panneaux', (info.refs && info.refs.length) ? info.refs.join(', ') : '—'],
            ['Production annuelle (année 1)', `${fr(total / 1000, 2)} MWh`],
            ['Productible spécifique', `${fr(sm.specific_production || (kwc ? total / kwc : 0), 0)} kWh/kWc`],
            ['Performance ratio (PR)', sm.performance_ratio !== undefined ? pct(sm.performance_ratio) : '—'],
            ["Perte d'ombrage proche (scène 3D)", pct(sm.near_shading_loss_percent)],
            ['Perte par écrêtage onduleur', sm.clipping_loss_kwh !== undefined ? `${fr(sm.clipping_loss_kwh, 0)} kWh` : '—'],
            ['Mode de calcul', 'La production solaire alimente la pompe'],
        ];
    }

    function lignesChampsProduction(prod) {
        return (prod.fields || []).map((f) => [
            String(f.id),
            `${fr(f.peak_power, 2)} kWc`,
            `${fr((f.total_production_kwh || 0) / 1000, 2)} MWh`,
            `${fr(f.specific_production || 0, 0)} kWh/kWc`,
            pct(f.near_shading_loss_percent),
            pct(f.performance_ratio),
        ]);
    }
    const ENTETE_CHAMPS_PROD = ['Champ', 'Puissance', 'Production', 'Productible', 'Ombrage proche', 'PR'];

    function afficherProduction(prod, erreur) {
        const carte = $('ps_prod_card');
        if (!carte) return;
        const statut = $('ps_prod_statut');
        if (!prod) {
            $('ps_prod_table').innerHTML = '';
            $('ps_prod_champs').innerHTML = '';
            if (statut) {
                statut.style.color = erreur ? '#b91c1c' : '#1e293b';
                statut.textContent = erreur || '';
            }
            return;
        }
        if (statut) {
            statut.style.color = '#166534';
            statut.textContent = '✓ Dimensionnement calculé avec la production réelle du calepinage (volumes pompés, taux de couverture de l\'installation, carburant et CO₂ évités).';
        }
        $('ps_prod_table').innerHTML = '<thead><tr><th>Résultat réel</th><th>Valeur</th></tr></thead><tbody>'
            + lignesProductionReelle(prod).map((l) => `<tr><td>${echapper(l[0])}</td><td>${echapper(l[1])}</td></tr>`).join('') + '</tbody>';
        const champs = lignesChampsProduction(prod);
        $('ps_prod_champs').innerHTML = champs.length
            ? `<thead><tr>${ENTETE_CHAMPS_PROD.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>`
                + champs.map((l) => `<tr>${l.map((c) => `<td>${echapper(c)}</td>`).join('')}</tr>`).join('') + '</tbody>'
            : '';
    }

    function payloadServeur(coords, avecEco) {
        const calc = estAffiche('ps_pertes_calculatrice') && !lister(REGLES_CALCULATRICE).length;
        return {
            lat: coords.lat, lon: coords.lon,
            angle: nombre('ps_angle'), aspect: nombre('ps_aspect'), perte_systeme: nombre('ps_perte_systeme'),
            pump_type: val('ps_pump_type'),
            systeme: systemeChoisi(),
            autonomie_batterie_j: siBatteries() ? nombre('ps_bat_autonomie') : null,
            dod_batterie_pct: siBatteries() ? nombre('ps_bat_dod') : null,
            rendement_batterie_pct: siBatteries() ? nombre('ps_bat_rendement') : null,
            h_aspiration: nombre('ps_h_aspiration'), h_tank: nombre('ps_h_tank'),
            daily_need: nombre('ps_daily_need'), losses_pipe: nombre('ps_losses_pipe'),
            pump_efficiency: nombre('ps_pump_efficiency'),
            puissance_reelle_installee_kwc: nombre('ps_puissance_reelle_installee_kwc'),
            coef_reduction_pomp: siBatteries() ? null : nombre('ps_coef_reduction_pomp'),
            coef_surdimensionnement: nombre('ps_coef_surdimensionnement'),
            conso_specifique_ge: siGroupe() ? nombre('ps_conso_specifique_ge') : null,
            facteur_emission_co2: siGroupe() ? nombre('ps_facteur_emission_co2') : null,
            calculatrice_pertes: calc ? {
                longueur_m: nombre('ps_m_length'), diametre_mm: nombre('ps_m_diam'),
                debit_m3h: nombre('ps_m_flow'), coef_accessoires: nombre('ps_m_acc'),
            } : null,
            pompe: choixPompe(),
            integration_calepinage: integrationDemandee(),
            production_mensuelle_kwh: derniereProduction ? derniereProduction.mensuelKwh : null,
            economie: avecEco ? lireEco() : null,
        };
    }

    /**
     * @param {{economie?: boolean}} options  economie=true : bouton « Calculer l'analyse
     *   économique » (hypothèses exigées). Sinon l'analyse est refaite si ses hypothèses sont valides.
     */
    async function dimensionner(options) {
        const demandeEco = !!(options && options.economie);
        // Puissance du calepinage reportée AVANT la validation (elle est bornée comme une saisie).
        const infoCalepinage = majPuissanceCalepinage();
        const { vForm, vEco } = majEtatValidation();
        if (vForm.length) {
            message(vForm[0].message, 'error', 6000);
            focaliser(vForm[0].el);
            return;
        }
        if (demandeEco && vEco.length) {
            message(vEco[0].message, 'error', 6000);
            if (vEco[0].el) vEco[0].el.focus();
            return;
        }
        const avecEco = demandeEco || (estAffiche('ps_eco_section') && !vEco.length);

        const coords = appliquerAdresseProjet();
        if (!coords) {
            message("Adresse du projet introuvable : impossible de déterminer l'ensoleillement.", 'error');
            return;
        }
        const bouton = $(demandeEco ? 'ps_btn_eco_calculate' : 'ps_btn_calculate');
        const texteBouton = bouton ? bouton.textContent : '';
        if (bouton) { bouton.disabled = true; bouton.textContent = 'Calcul en cours…'; }

        const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
        const PROFIL_IRRADIATION_FALLBACK = [5.1, 5.5, 6.0, 6.2, 5.8, 5.2, 4.8, 4.5, 4.9, 5.3, 5.2, 5.0];

        try {
            // Production réelle du calepinage (module Production solaire, vente en totalité).
            derniereProduction = null;
            const carteProd = $('ps_prod_card');
            if (infoCalepinage) {
                // Résultats visibles AVANT le calcul : les graphiques de l'iframe seraient 0x0 sinon.
                $('ps_resultats').style.display = 'block';
                if (carteProd) carteProd.style.display = 'block';
                afficherProduction(null, 'Calcul de la production réelle du calepinage en cours…');
                if (bouton) bouton.textContent = 'Production du calepinage…';
                try {
                    derniereProduction = await calculerProductionReelle(infoCalepinage);
                } catch (err) {
                    if (err && err.parametresPompage) {
                        // Écart inclinaison / pertes avec le calepinage : pas de repli sur l'estimation,
                        // la pompe serait dimensionnée sur des valeurs différentes de la production.
                        // Un dimensionnement précédent n'est plus affiché.
                        ['ps_resultats', 'ps_prod_card'].forEach((b) => { const el = $(b); if (el) el.style.display = 'none'; });
                        invaliderResultats('ps_angle', true);
                        afficherStatutParametres(`⚠️ ${err.message}`, true);
                        message(err.message, 'error', 12000);
                        return;
                    }
                    console.warn('[PompageSolaire] Production réelle indisponible :', err);
                    const texte = `Production réelle indisponible (${err && err.message ? err.message : err}) : dimensionnement sur l'estimation de production de la puissance installée.`;
                    afficherProduction(null, texte);
                    message(texte, 'error', 8000);
                }
                if (bouton) bouton.textContent = 'Calcul en cours…';
            } else if (carteProd) {
                carteProd.style.display = 'none';
            }

            let donnees = {};
            let dailyIrradiation = null;
            try {
                const reponse = await fetch(`${apiPrefix}/api/pompage_solaire/irradiation`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payloadServeur(coords, avecEco)),
                });
                donnees = await reponse.json().catch(() => ({}));
                if (reponse.status === 400) {
                    // Saisie refusée par la validation serveur : on ne calcule PAS sur un profil de repli.
                    message(donnees.error || 'Saisie invalide.', 'error', 8000);
                    return;
                }
                if (reponse.ok) dailyIrradiation = donnees && donnees.daily_irradiation;
                else console.warn(`[Pompage Solaire] Erreur HTTP ${reponse.status} lors de la récupération de l'ensoleillement.`);
            } catch (err) {
                console.warn("[Pompage Solaire] Erreur réseau lors de la récupération de l'ensoleillement :", err);
            }

            // Gestion sécurisée avec repli : ne jamais bloquer le dimensionnement — mais le signaler
            // dans les résultats et le rapport (un profil par défaut n'est pas celui du site).
            let irradiationRepli = !!donnees.using_fallback;
            if (!dailyIrradiation || !Array.isArray(dailyIrradiation) || dailyIrradiation.length !== 12) {
                irradiationRepli = true;
                message("Données d'ensoleillement indisponibles : dimensionnement effectué avec le profil d'irradiation standard par défaut.", 'error', 6000);
                dailyIrradiation = PROFIL_IRRADIATION_FALLBACK;
            } else if (donnees.using_fallback) {
                message("Service d'ensoleillement injoignable : dimensionnement fait avec un profil d'irradiation par défaut.", 'error', 6000);
            }

            const C = window.PompageSolaireCalculs;
            const entreesCalcul = Object.assign(lireEntrees(),
                derniereProduction ? { production_mensuelle_kwh: derniereProduction.mensuelKwh } : {});
            const resultat = C.dimensionner(entreesCalcul, dailyIrradiation);
            if (resultat.error) { message(resultat.error, 'error'); return; }
            dernierInstantane = {
                entrees: lireEntrees(),
                systeme: systemeChoisi(),
                irradiationRepli,
                typePompe: val('ps_pump_type'),
                angle: val('ps_angle'), aspect: val('ps_aspect'),
                site: ($('ps_site_libelle') && $('ps_site_libelle').textContent) || 'Projet',
                coords: `${Number(coords.lat).toFixed(5)}, ${Number(coords.lon).toFixed(5)}`,
            };
            dernierInstantane.production = derniereProduction;
            afficher(resultat);
            if (derniereProduction) afficherProduction(derniereProduction);
            $('ps_eco_section').style.display = 'block';
            if (avecEco) afficherEco(C.analyseEconomique(resultat, lireEco()));
            else masquerEco();
            $('ps_pa_section').style.display = 'block';
            majBlocPlan();
            // Les volumes et le carburant ont pu changer : un plan déjà calculé est refait.
            if (dernierPlan && !violationsPlan().length) calculerPlan({ silencieux: true });
            else masquerPlan();
            majEtatValidation();
            resultatsAEnvoyer = instantaneResultats();
            sauvegarder({ immediat: true });
            if (demandeEco && $('ps_eco_resultats')) $('ps_eco_resultats').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } finally {
            if (bouton) bouton.textContent = texteBouton;
            majEtatValidation();
        }
    }

    function texteRapport(r, gras) {
        const b = (s) => (gras ? `<b>${s}</b>` : s);
        const s = dernierInstantane || { entrees: {} };
        return `Système dimensionné pour un pompage journalier de ${b(`${(r.annual_water_need_m3 / 365).toFixed(2)} m³/j`)}, `
            + `hauteur manométrique totale ${b(`${r.hmt.toFixed(2)} m`)} (hauteur géométrique ${r.h_geo.toFixed(2)} m, `
            + `pertes de charge ${s.entrees.losses_pipe || 0} %). `
            + `Puissance photovoltaïque nécessaire : ${b(`${(r.req_pv_w / 1000).toFixed(2)} kWc`)}, `
            + `calculée sur le mois le moins ensoleillé (${r.worst_month_rad.toFixed(2)} kWh/m²/jour). `
            + `La pompe doit fournir environ ${b(`${r.pump_power_w.toFixed(0)} W`)} pour un débit moyen de `
            + `${b(`${r.debit_moyen_m3h.toFixed(2)} m³/h`)} pendant les heures d'ensoleillement utile. `
            + `Bilan : ${r.energy_pumping_mwh_yr.toFixed(2)} MWh/an nécessaires, `
            + `${r.energy_solar_mwh_yr.toFixed(2)} MWh/an fournis, `
            + `soit un taux de couverture (théorique) de ${b(`${r.solar_coverage.toFixed(2)} %`)}.`
            + (r.production_reelle
                ? ` Installation envisagée : production réelle du calepinage (${r.energy_solar_design_mwh_yr.toFixed(2)} MWh/an, ombrage proche 3D compris), `
                    + `taux de couverture ${b(`${r.solar_coverage_design.toFixed(2)} %`)}.`
                : '')
            + texteSysteme(r, s, b);
    }

    /** Phrase du rapport propre au type de système (vide pour un ancien résultat sans type). */
    function texteSysteme(r, s, b) {
        if (!SYSTEMES[r.systeme] || r.volume_reservoir_m3 === undefined) return '';
        const e = (s && s.entrees) || {};
        const reservoir = `réservoir de stockage conseillé : ${fr(r.volume_reservoir_m3, 0)} m³ (${r.jours_reservoir} jour(s) de besoin).`;
        if (r.systeme === 'groupe') {
            return ` Système avec groupe électrogène d'appoint : le groupe pompe le déficit du solaire, soit ${b(`${fr(r.volume_groupe_m3_an, 0)} m³/an`)} `
                + `pour ${fr(r.fuel_residual_liters, 0)} L de carburant par an ; puissance conseillée du groupe : ${fr(r.puissance_groupe_kva, 1)} kVA ; ${reservoir}`;
        }
        const nonCouvert = r.besoin_non_couvert_m3 > 0
            ? `${b(`${fr(r.besoin_non_couvert_m3, 0)} m³/an`)} du besoin ne sont pas pompés (déficit des mois peu ensoleillés, sans appoint)`
            : 'le besoin est couvert chaque mois';
        if (r.systeme === 'batteries') {
            return ` Système avec batteries de secours : capacité nominale ${b(`${fr(r.capacite_batterie_nominale_kwh, 1)} kWh`)} `
                + `(${fr(r.capacite_batterie_utile_kwh, 1)} kWh utiles pour ${e.autonomie_batterie_j || '—'} jour(s) d'autonomie, profondeur de décharge ${e.dod_batterie_pct || '—'} %), `
                + `rendement aller-retour de ${fr(r.rendement_batterie_pct, 0)} % appliqué à toute l'énergie solaire (hypothèse prudente) ; ${nonCouvert} ; ${reservoir}`;
        }
        return ` Pompage au fil du soleil : ${nonCouvert} ; ${reservoir}`;
    }

    /** Lignes [libellé, valeur] propres au type de système (tableau des résultats du rapport). */
    function lignesResultatsSysteme(r) {
        if (!SYSTEMES[r.systeme] || r.volume_reservoir_m3 === undefined) return [];
        const lignes = [];
        if (r.systeme === 'groupe') {
            lignes.push(["Volume pompé par le groupe d'appoint", `${fr(r.volume_groupe_m3_an, 0)} m³/an`],
                ["Carburant du groupe d'appoint", `${fr(r.fuel_residual_liters, 0)} L/an`],
                ["Puissance conseillée du groupe d'appoint", `${fr(r.puissance_groupe_kva, 1)} kVA`]);
        } else {
            lignes.push(['Besoin non couvert (déficit non pompé)', `${fr(r.besoin_non_couvert_m3, 0)} m³/an`]);
        }
        if (r.systeme === 'batteries') {
            lignes.push(['Capacité nominale des batteries', `${fr(r.capacite_batterie_nominale_kwh, 1)} kWh`],
                ['Énergie stockée utile (autonomie)', `${fr(r.capacite_batterie_utile_kwh, 1)} kWh`]);
        }
        lignes.push(["Réservoir de stockage d'eau conseillé", `${fr(r.volume_reservoir_m3, 0)} m³ (${r.jours_reservoir} jour(s) de besoin)`]);
        return lignes;
    }

    function afficher(r) {
        dernierResultat = r;
        avisRecalcul('dim', false);
        $('ps_resultats').style.display = 'block';
        txt('ps_res_hmt', r.hmt.toFixed(2));
        txt('ps_res_pv', (r.req_pv_w / 1000).toFixed(2));
        txt('ps_res_m3', r.debit_moyen_m3h.toFixed(2));
        txt('ps_res_pump', `${r.pump_power_w.toFixed(0)} W · ${r.pump_power_kw.toFixed(2)} kW · ${r.pump_power_cv.toFixed(2)} CV`);
        txt('ps_res_energy_pump', r.energy_pumping_mwh_yr.toFixed(2));
        txt('ps_res_energy_solar', r.energy_solar_mwh_yr.toFixed(2));
        txt('ps_res_coverage', r.solar_coverage.toFixed(2));
        txt('ps_res_annual_irradiation', r.total_annual_irradiation.toFixed(2));
        txt('ps_res_annual_need', r.annual_water_need_m3.toFixed(2));
        txt('ps_res_fuel_savings', r.fuel_savings_liters.toFixed(0));
        txt('ps_res_co2_avoided', r.co2_avoided_tonnes.toFixed(2));

        const avecDesign = r.energy_solar_design_mwh_yr > 0;
        ['ps_res_coverage_design'].forEach((id) => {
            const ligne = $(id + '-card');
            if (ligne) ligne.style.display = avecDesign ? '' : 'none';
        });
        if (avecDesign) {
            txt('ps_res_coverage_design', r.solar_coverage_design.toFixed(2));
        }

        // Lignes propres au type de système (absentes d'un ancien résultat enregistré sans type).
        const ligneSysteme = (id, visible, texte) => {
            const l = $(`${id}-card`);
            if (l) l.style.display = visible ? '' : 'none';
            if (visible) txt(id, texte);
        };
        const sys = SYSTEMES[r.systeme] && r.volume_reservoir_m3 !== undefined ? r.systeme : null;
        ligneSysteme('ps_res_non_couvert', !!sys && sys !== 'groupe', fr(r.besoin_non_couvert_m3 || 0, 0));
        ligneSysteme('ps_res_groupe_volume', sys === 'groupe', fr(r.volume_groupe_m3_an || 0, 0));
        ligneSysteme('ps_res_groupe_carburant', sys === 'groupe', fr(r.fuel_residual_liters || 0, 0));
        ligneSysteme('ps_res_groupe_kva', sys === 'groupe', fr(r.puissance_groupe_kva || 0, 1));
        ligneSysteme('ps_res_batt_nominale', sys === 'batteries', fr(r.capacite_batterie_nominale_kwh || 0, 1));
        ligneSysteme('ps_res_batt_utile', sys === 'batteries', fr(r.capacite_batterie_utile_kwh || 0, 1));
        const avecGroupe = !sys || sys === 'groupe'; // ancien résultat sans type : affiché comme avant
        ['ps_res_fuel_savings', 'ps_res_co2_avoided'].forEach((id) => { const l = $(`${id}-card`); if (l) l.style.display = avecGroupe ? '' : 'none'; });
        ligneSysteme('ps_res_reservoir', !!sys, `${fr(r.volume_reservoir_m3 || 0, 0)} (${r.jours_reservoir} j de besoin)`);
        const avisIrr = $('ps_avis_irradiation');
        if (avisIrr) {
            const repli = !!(dernierInstantane && dernierInstantane.irradiationRepli);
            avisIrr.style.display = repli ? 'block' : 'none';
            avisIrr.textContent = repli ? "⚠ Ensoleillement du site indisponible lors du calcul : un profil d'irradiation par défaut a été utilisé. Les résultats sont indicatifs ; relancez le dimensionnement." : '';
        }

        $('ps_report_text').innerHTML = texteRapport(r, true);
        $('ps_recommendations').innerHTML = (r.recommendations || []).map((x) => `<li>${echapper(x)}</li>`).join('');
        tracerGraphiques(r);
        afficherPompes();
    }

    // ---------------------------------------------------------------------------------------
    // Analyse économique : affichage
    // ---------------------------------------------------------------------------------------

    function masquerEco() {
        dernierEco = null;
        const res = $('ps_eco_resultats');
        if (res) res.style.display = 'none';
    }

    function dureeAns(v) {
        return v === null || v === undefined ? `> ${window.PompageSolaireCalculs.DUREE_ANALYSE_ANS} ans` : `${fr(v, 1)} ans`;
    }

    /** Analyse sans groupe électrogène (fil du soleil, batteries) : analyse des coûts. */
    const sansGroupe = (e) => !!(e && e.systeme && e.systeme !== 'groupe');

    /** Indicateurs de l'analyse économique : cartes, rapport PDF et page de garde. */
    function indicateursEco(e, sym) {
        const m3 = { titre: 'Coût actualisé du m³ pompé', valeur: e.cout_actualise_m3 === null || e.cout_actualise_m3 === undefined ? 'n.d.' : prixM3(e.cout_actualise_m3, sym), detail: 'Capex et coûts actualisés / volumes actualisés' };
        // Effet de la dégradation des panneaux : nul si le surplus de capacité des mois ensoleillés l'absorbe.
        const degradation = e.volume_perdu_degradation_m3 === undefined ? [] : [{
            titre: `Pompage solaire perdu par la dégradation (${fr(e.degradation_pv_pct || 0, 2)} %/an)`,
            valeur: `${fr(e.volume_perdu_degradation_m3, 0)} m³`,
            detail: e.annee_effet_degradation
                ? `sur ${e.duree_ans} ans, dès l'année ${e.annee_effet_degradation}${sansGroupe(e) ? ' (besoin non couvert)' : ' (pompé au groupe)'}`
                : `aucun effet sur ${e.duree_ans} ans : la capacité solaire reste supérieure au besoin chaque mois`,
        }];
        if (sansGroupe(e)) {
            const l1 = e.tableau[1] || {};
            return [
                { titre: 'Coût global actualisé', valeur: monnaie(e.cout_global_actualise, sym), detail: `Capex et coûts sur ${e.duree_ans} ans, actualisés` },
                m3,
                { titre: `Coût total sur ${e.duree_ans} ans`, valeur: monnaie(e.cout_total_avec, sym), detail: 'Capex inclus, non actualisé' },
                { titre: `Volume pompé sur ${e.duree_ans} ans`, valeur: `${fr(e.volume_servi_total_m3 || 0, 0)} m³` },
                { titre: "Coût d'exploitation, année 1", valeur: monnaie(l1.cout_avec, sym) },
                { titre: `Besoin non couvert sur ${e.duree_ans} ans`, valeur: `${fr(e.tableau.reduce((t, l) => t + (l.non_couvert_m3 || 0), 0), 0)} m³`, detail: `non pompé, non valorisé (année 1 : ${fr(e.besoin_non_couvert_an1_m3 || 0, 0)} m³)` },
            ].concat(degradation);
        }
        return [
            { titre: 'VAN (valeur actuelle nette)', valeur: monnaie(e.van, sym), negatif: e.van < 0 },
            { titre: 'TRI', valeur: e.tri_pct === null ? 'n.d.' : `${fr(e.tri_pct, 1)} %` },
            { titre: 'Temps de retour simple', valeur: dureeAns(e.retour_simple_ans) },
            { titre: 'Temps de retour actualisé', valeur: dureeAns(e.retour_actualise_ans) },
            { titre: 'Gain la 1re année', valeur: monnaie(e.gain_annee_1, sym), negatif: e.gain_annee_1 < 0 },
            { titre: 'Gains cumulés', valeur: monnaie(e.gains_totaux, sym), negatif: e.gains_totaux < 0, detail: `sur ${e.duree_ans} ans` },
        ].concat(e.cout_actualise_m3 !== undefined ? [m3] : [], degradation);
    }

    /** Titres des blocs de résultats et des graphiques de l'analyse économique. */
    function titresEco(e) {
        return sansGroupe(e) ? {
            indicateurs: 'Indicateurs de coût', postes: 'Capex et Opex du pompage solaire', annuel: 'Coûts annuels',
            cumul: 'Coûts cumulés', couts: 'Coût annuel du pompage solaire', fcf: 'Coûts cumulés actualisés',
        } : {
            indicateurs: 'Indicateurs de rentabilité', postes: 'Capex, Opex et gains : avec vs sans pompage solaire', annuel: 'Coûts et gains annuels',
            cumul: 'Rentabilité : cashflow cumulé', couts: 'Coût annuel avec vs sans solaire', fcf: 'Cumul des flux actualisés',
        };
    }

    function entetePostes(e) {
        return sansGroupe(e) ? ['Poste', 'Montant'] : ['Poste', 'Sans solaire (groupe seul)', 'Avec pompage solaire'];
    }

    /** Lignes du tableau « Capex, Opex et gains » : [poste, sans solaire, avec solaire] ; sans groupe : [poste, montant]. */
    function lignesPostes(e, p, r, sym) {
        const part = e.part_residuelle_ge_pct / 100;
        const annee = e.annee_remplacement_ge;
        const l1 = e.tableau[1];
        if (sansGroupe(e)) {
            // Sans groupe électrogène : aucun poste de groupe ni de carburant (tous nuls).
            const batteries = e.systeme === 'batteries';
            const anneesBatt = (e.annees_remplacement_batterie || []).join(', ');
            return [
                ['Investissement initial (Capex : centrale PV + pompe)', monnaie(p.capex, sym)],
            ].concat(batteries ? [['Capex des batteries', monnaie(e.capex_batterie, sym)]] : [], [
                [`Opex centrale photovoltaïque (année 1, indexé ${fr(p.indexation_opex_pv, 1)} %/an)`, monnaie(p.opex_pv, sym)],
                [`Remplacement onduleur / contrôleur de pompe (année ${e.annee_remplacement_onduleur})`, monnaie(p.remplacement_onduleur, sym)],
            ], batteries ? [[`Remplacement des batteries (${anneesBatt ? `années ${anneesBatt}` : 'aucun sur la période'})`, monnaie(p.remplacement_batterie, sym)]] : [], [
                ['Eau pompée, année 1', `${fr((l1.besoin_m3 || 0) - (l1.non_couvert_m3 || 0), 0)} m³`],
                ['Besoin non couvert, année 1 (non pompé, non valorisé)', `${fr(e.besoin_non_couvert_an1_m3 || 0, 0)} m³`],
                ['Coût d\'exploitation, année 1', monnaie(l1.cout_avec, sym)],
                [`Coût total sur ${e.duree_ans} ans (Capex inclus)`, monnaie(e.cout_total_avec, sym)],
                [`Coût global actualisé sur ${e.duree_ans} ans`, monnaie(e.cout_global_actualise, sym)],
            ]);
        }
        return [
            ['Investissement initial (Capex : centrale PV + pompe)', monnaie(0, sym), monnaie(p.capex, sym)],
            [`Opex centrale photovoltaïque (année 1, indexé ${fr(p.indexation_opex_pv, 1)} %/an)`, '—', monnaie(p.opex_pv, sym)],
            [`Remplacement onduleur / contrôleur de pompe (année ${e.annee_remplacement_onduleur})`, '—', monnaie(p.remplacement_onduleur, sym)],
            ['Opex groupe électrogène (/an)', monnaie(p.opex_ge, sym), monnaie(p.opex_ge * part, sym)],
            [`Remplacement du groupe électrogène (année ${annee})`, monnaie(p.remplacement_ge, sym), monnaie(p.remplacement_ge * part, sym)],
            ['Carburant consommé, année 1', `${fr(l1.carburant_sans_l !== undefined ? l1.carburant_sans_l : r.fuel_without_solar_liters, 0)} L`, `${fr(l1.carburant_avec_l !== undefined ? l1.carburant_avec_l : r.fuel_residual_liters, 0)} L`],
            ['Coût du carburant, année 1', monnaie(l1.cout_carburant_sans, sym), monnaie(l1.cout_carburant_avec, sym)],
            ['Coût total d\'exploitation, année 1', monnaie(l1.cout_sans, sym), monnaie(l1.cout_avec, sym)],
            [`Coût total sur ${e.duree_ans} ans (Capex inclus)`, monnaie(e.cout_total_sans, sym), monnaie(e.cout_total_avec, sym)],
            [`Gains cumulés du pompage solaire sur ${e.duree_ans} ans`, '', monnaie(e.gains_totaux, sym)],
        ];
    }

    /** Colonnes du tableau « Coûts et gains annuels » ({titre, valeur(l), signe}) selon le type de système. */
    function colonnesAnnuelles(e, sym) {
        const annee = { titre: 'Année', valeur: (l) => (l.annee === 0 ? '0 (investissement)' : String(l.annee)) };
        const besoin = { titre: 'Besoin en eau (m³)', valeur: (l) => (l.annee === 0 || l.besoin_m3 === undefined ? '—' : fr(l.besoin_m3, 0)) };
        if (sansGroupe(e)) {
            return [annee, besoin,
                { titre: 'Pompé (m³)', valeur: (l) => (l.annee === 0 ? '—' : fr((l.besoin_m3 || 0) - (l.non_couvert_m3 || 0), 0)) },
                { titre: 'Non pompé (m³)', valeur: (l) => (l.annee === 0 ? '—' : fr(l.non_couvert_m3 || 0, 0)) },
                { titre: 'Coût annuel', valeur: (l) => monnaie(l.cout_avec, sym) },
                { titre: 'Coûts cumulés', valeur: (l) => monnaie(-l.cumul, sym) },
                { titre: 'Coûts cumulés actualisés', valeur: (l) => monnaie(-l.cumul_actualise, sym) },
            ];
        }
        return [annee, besoin].concat([
            { titre: 'Coût sans solaire', valeur: (l) => monnaie(l.cout_sans, sym) },
            { titre: 'Coût avec solaire', valeur: (l) => monnaie(l.cout_avec, sym) },
            { titre: 'Gain annuel', valeur: (l) => monnaie(l.gain, sym), signe: 'gain' },
            { titre: 'Cumul', valeur: (l) => monnaie(l.cumul, sym), signe: 'cumul' },
            { titre: 'Cumul actualisé', valeur: (l) => monnaie(l.cumul_actualise, sym), signe: 'cumul_actualise' },
        ]);
    }

    function afficherEco(e) {
        if (!e || !e.success) return;
        const p = lireEco();
        dernierEco = { resultat: e, params: p, devise: p.devise };
        avisRecalcul('eco', false);
        const sym = DEVISES[p.devise];
        const r = dernierResultat;
        $('ps_eco_resultats').style.display = 'block';

        $('ps_eco_indicateurs').innerHTML = indicateursEco(e, sym).map((c) => `<div class="ps-stat-card">
            <div class="ps-stat-label">${echapper(c.titre)}</div>
            <div class="ps-stat-value"><span class="${c.negatif ? 'ps-negatif' : 'ps-positif'}">${echapper(c.valeur)}</span></div>
            ${c.detail ? `<p style="margin: 0.3rem 0 0; font-size: 0.75rem; color: var(--text-secondary);">${echapper(c.detail)}</p>` : ''}</div>`).join('');
        const titres = titresEco(e);
        txt('ps_eco_titre_indicateurs', titres.indicateurs);
        txt('ps_eco_titre_postes', titres.postes);
        txt('ps_eco_titre_annuel', titres.annuel);
        ['cumul', 'couts', 'fcf'].forEach((k) => txt(`ps_chart_eco_${k}_titre`, titres[k]));

        const postes = lignesPostes(e, p, r, sym);
        $('ps_eco_table_postes').innerHTML = `<thead><tr>${entetePostes(e).map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>`
            + postes.map((l, i) => `<tr${i >= postes.length - 2 ? ' class="ps-total"' : ''}>${l.map((c) => `<td>${echapper(c)}</td>`).join('')}</tr>`).join('')
            + '</tbody>';
        $('ps_eco_table_annuel').innerHTML = tableHtml(colonnesAnnuelles(e, sym), e.tableau);
        tracerGraphiquesEco(e, sym);
    }

    // Mêmes graphiques que l'étude économique (EtudesEconomiqueLogic.js::renderCharts).
    function configsEco(e, sym) {
        const labels = e.tableau.map((l) => l.annee);
        const options = () => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } });
        const annees = e.tableau.slice(1);
        if (sansGroupe(e)) {
            // Analyse des coûts : montants positifs, une seule série (pas de groupe à comparer).
            return {
                cumul: {
                    type: 'bar',
                    data: { labels, datasets: [{ label: `Coûts cumulés (${sym})`, data: e.tableau.map((l) => -l.cumul), backgroundColor: '#FFC107' }] },
                    options: options(),
                },
                couts: {
                    type: 'bar',
                    data: { labels: annees.map((l) => l.annee), datasets: [{ label: `Coût annuel du pompage solaire (${sym})`, data: annees.map((l) => l.cout_avec), backgroundColor: '#FF8C00' }] },
                    options: options(),
                },
                fcf: {
                    type: 'line',
                    data: { labels, datasets: [{ label: `Coûts cumulés actualisés (${sym})`, data: e.tableau.map((l) => -l.cumul_actualise), borderColor: '#005A9E', backgroundColor: 'rgba(0, 90, 158, 0.1)', fill: true, tension: 0.1 }] },
                    options: options(),
                },
            };
        }
        return {
            cumul: {
                type: 'bar',
                data: { labels, datasets: [{ label: `Cashflow cumulé (${sym})`, data: e.tableau.map((l) => l.cumul), backgroundColor: '#FFC107' }] },
                options: options(),
            },
            couts: {
                type: 'bar',
                data: {
                    labels: annees.map((l) => l.annee),
                    datasets: [
                        { label: `Coût annuel avec pompage solaire (${sym})`, data: annees.map((l) => l.cout_avec), backgroundColor: '#FF8C00' },
                        { label: `Coût annuel sans solaire (${sym})`, data: annees.map((l) => l.cout_sans), backgroundColor: '#005A9E' },
                    ],
                },
                options: options(),
            },
            fcf: {
                type: 'line',
                data: { labels, datasets: [{ label: `Cumul des flux actualisés (${sym})`, data: e.tableau.map((l) => l.cumul_actualise), borderColor: '#005A9E', backgroundColor: 'rgba(0, 90, 158, 0.1)', fill: true, tension: 0.1 }] },
                options: Object.assign(options(), { scales: { y: { beginAtZero: false } } }),
            },
        };
    }

    function tracerGraphiquesEco(e, sym) {
        if (typeof Chart === 'undefined') return;
        Object.keys(graphsEco).forEach((k) => { if (graphsEco[k]) graphsEco[k].destroy(); });
        const configs = configsEco(e, sym);
        graphsEco.cumul = new Chart($('ps_chart_eco_cumul').getContext('2d'), configs.cumul);
        graphsEco.couts = new Chart($('ps_chart_eco_couts').getContext('2d'), configs.couts);
        graphsEco.fcf = new Chart($('ps_chart_eco_fcf').getContext('2d'), configs.fcf);
    }

    function choisirDevise(code) {
        const el = $('ps_eco_devise');
        if (!el || !DEVISES[code]) return;
        el.value = code;
        majDevise();
        sauvegarder();
    }

    function majDevise() {
        const sym = symboleDevise();
        document.querySelectorAll('#ps_eco_section .ps-devise-btn').forEach((b) => {
            const actif = b.dataset.devise === val('ps_eco_devise');
            b.classList.toggle('ps-devise-btn-actif', actif);
            b.setAttribute('aria-checked', actif ? 'true' : 'false');
        });
        document.querySelectorAll('#ps_eco_section .ps-devise, #ps_pa_section .ps-devise').forEach((el) => { el.textContent = sym; });
        // Plafonds des montants convertis dans la devise : textes « Plage » et attributs max.
        document.querySelectorAll('.ps-plage').forEach((el) => {
            const r = toutesRegles().find((x) => x.id === el.dataset.regle);
            if (r && r.monnaie) el.textContent = textePlage(r, el.dataset.unite);
        });
        REGLES_ECO.concat(REGLES_PLAN).filter((r) => r.monnaie).forEach((r) => { const el = $(r.id); if (el) el.max = borneMax(r); });
        majEtatValidation();
        if (dernierEco) afficherEco(dernierEco.resultat);
        if (dernierPlan) afficherPlan(Object.assign({}, dernierPlan, { devise: val('ps_eco_devise') }));
    }

    // ---------------------------------------------------------------------------------------
    // Plan d'affaires : vente d'eau
    // ---------------------------------------------------------------------------------------

    /** Capex total du plan (pompe solaire + PV, groupe, batterie selon le cas). */
    function capexTotalPlan() {
        const h = siHybride();
        const st = siStockage();
        return (nombre('ps_eco_capex') || 0) + (nombre('ps_pa_capex_terrain') || 0) + ((h || st) ? nombre('ps_pa_capex_pv') || 0 : 0)
            + (h ? nombre('ps_pa_capex_ge') || 0 : 0) + (st ? nombre('ps_eco_capex_batterie') || 0 : 0);
    }

    /** Champs affichés selon les cases et le financement ; rappels du carburant et de l'évolution. */
    function majBlocPlan() {
        const h = siHybride();
        const st = siStockage();
        const fiscal = coche('ps_pa_impots') || coche('ps_pa_valeur_residuelle');
        const constant = val('ps_pa_methode_amortissement') === 'constant';
        const emprunt = (nombre('ps_pa_emprunt') || 0) > 0;
        const montrer = (id, oui) => { const el = $(`ps_pa_groupe_${id}`); if (el) el.style.display = oui ? '' : 'none'; };
        const bloc = $('ps_pa_bloc_equipements');
        if (bloc) bloc.style.display = (h || st) ? 'block' : 'none';
        txt('ps_pa_titre_equipements', h ? "Groupe électrogène d'appoint" : 'Batteries de secours');
        montrer('capex_pv', h || st);
        ['capex_ge', 'entretien_ge', 'rempl_ge'].forEach((id) => montrer(id, h));
        const infoBatt = $('ps_pa_info_batteries');
        if (infoBatt) {
            infoBatt.style.display = st ? 'block' : 'none';
            const duree = nombre('ps_eco_duree_vie_batterie');
            infoBatt.textContent = st
                ? `Batteries (analyse économique) : Capex ${val('ps_eco_capex_batterie') || '—'} ${symboleDevise()}, remplacement ${val('ps_eco_remplacement_batterie') || '—'} ${symboleDevise()} tous les ${duree || '—'} ans.`
                : '';
        }
        ['taux_emprunt', 'duree_emprunt'].forEach((id) => montrer(id, emprunt));
        montrer('taux_impot', coche('ps_pa_impots'));
        montrer('methode', fiscal);
        montrer('duree_amortissement', fiscal && !constant);
        montrer('amortissement_annuel', fiscal && constant);
        const info = $('ps_pa_info_carburant');
        if (info) {
            info.style.display = h ? 'block' : 'none';
            const litres = dernierResultat ? dernierResultat.fuel_residual_liters : null;
            info.textContent = h
                ? `Carburant du groupe en année 1 : ${litres === null ? '— (dimensionnez d\'abord le pompage)' : `${fr(litres, 0)} L`} pour pomper le déficit solaire (il croît avec le besoin), `
                    + `au prix de ${val('ps_eco_prix_carburant') || '—'} ${symboleDevise()}/L indexé de ${val('ps_eco_inflation') || '—'} %/an (analyse économique).`
                : '';
        }
        txt('ps_pa_info_evolution', `Évolution des besoins en eau : x ${val('ps_eco_evolution_besoins') || '—'} par an dès l'année 2 ; `
            + `dégradation des panneaux : ${val('ps_eco_degradation_pv') || '—'} %/an (analyse économique).`);
    }

    function majSommeLots() {
        const el = $('ps_pa_somme_lots');
        if (!el) return;
        const capex = nombre('ps_eco_capex');
        const somme = sommeLots();
        const sym = symboleDevise();
        if (!(capex > 0)) {
            el.style.color = '#b45309';
            el.textContent = `Somme des lots : ${fr(somme, 2)} ${sym} — renseignez le Capex dans l'analyse économique.`;
            return;
        }
        const ok = Math.abs(somme - capex) <= TOLERANCE_SOMME_LOTS;
        el.style.color = ok ? '#15803d' : '#b91c1c';
        el.textContent = `Somme des lots : ${fr(somme, 2)} ${sym} / Capex de la pompe solaire : ${fr(capex, 2)} ${sym}`
            + (ok ? ' ✓' : ` — écart ${fr(somme - capex, 2)} ${sym}`);
    }

    /** Répartit le Capex de la pompe solaire entre les trois lots (le transport prend le reliquat). */
    function repartirLots() {
        const capex = nombre('ps_eco_capex');
        if (!(capex > 0)) { message("Renseignez d'abord le Capex dans l'analyse économique.", 'error'); return; }
        const ids = Object.keys(REPARTITION_LOTS);
        let reste = capex;
        ids.forEach((id, i) => {
            const v = i === ids.length - 1 ? reste : Math.round(capex * REPARTITION_LOTS[id] * 100) / 100;
            reste = Math.round((reste - v) * 100) / 100;
            const el = $(id);
            if (el) el.value = String(v);
        });
        ids.forEach((id) => invaliderResultats(id));
        majEtatValidation();
        sauvegarder();
    }

    /** Saisies du plan + données du dernier dimensionnement : payload du serveur ET entrée du miroir JS. */
    function lirePlan() {
        const h = siHybride();
        const st = siStockage();
        const impots = coche('ps_pa_impots');
        const vr = coche('ps_pa_valeur_residuelle');
        const emprunt = nombre('ps_pa_emprunt') || 0;
        const methode = val('ps_pa_methode_amortissement') === 'constant' ? 'constant' : 'lineaire';
        const r = dernierResultat || {};
        return {
            devise: DEVISES[val('ps_eco_devise')] ? val('ps_eco_devise') : 'EUR',
            capex_pompe: nombre('ps_eco_capex'),
            capex_materiel_pompage: nombre('ps_pa_capex_materiel'),
            capex_genie_civil_pose: nombre('ps_pa_capex_genie_civil'),
            capex_transport: nombre('ps_pa_capex_transport'),
            capex_terrain: nombre('ps_pa_capex_terrain') || 0,
            hybride: h,
            stockage: st,
            capex_pv: (h || st) ? nombre('ps_pa_capex_pv') : null,
            capex_ge: h ? nombre('ps_pa_capex_ge') : null,
            entretien_ge: h ? nombre('ps_pa_entretien_ge') : null,
            remplacement_ge: h ? nombre('ps_pa_rempl_ge') : null,
            capex_batterie: st ? nombre('ps_eco_capex_batterie') : null,
            remplacement_batterie: st ? nombre('ps_eco_remplacement_batterie') : null,
            duree_vie_batterie: st ? Math.trunc(nombre('ps_eco_duree_vie_batterie') || 10) : 10,
            carburant_sans_solaire_l: Number(r.fuel_without_solar_liters) || 0,
            prix_carburant: h ? nombre('ps_eco_prix_carburant') : null,
            inflation_carburant: h ? nombre('ps_eco_inflation') : null,
            evolution_besoins: nombre('ps_eco_evolution_besoins'),
            degradation_pv: nombre('ps_eco_degradation_pv'),
            entretien: nombre('ps_pa_entretien'),
            indexation_entretien: nombre('ps_pa_indexation_entretien'),
            remplacement_onduleur: nombre('ps_pa_rempl_onduleur'),
            tarif_m3: nombre('ps_pa_tarif_m3'),
            indexation_tarif: nombre('ps_pa_indexation_tarif'),
            part_pertes: nombre('ps_pa_part_pertes'),
            taux_actualisation: nombre('ps_pa_taux'),
            horizon: Number(val('ps_pa_horizon')) || 20,
            subvention: nombre('ps_pa_subvention') || 0,
            emprunt,
            taux_emprunt: emprunt > 0 ? nombre('ps_pa_taux_emprunt') : null,
            duree_emprunt: emprunt > 0 ? nombre('ps_pa_duree_emprunt') : null,
            impots,
            taux_impot: impots ? nombre('ps_pa_taux_impot') : null,
            valeur_residuelle: vr,
            methode_amortissement: methode,
            duree_amortissement: (impots || vr) && methode === 'lineaire' ? nombre('ps_pa_duree_amortissement') : null,
            amortissement_annuel: (impots || vr) && methode === 'constant' ? nombre('ps_pa_amortissement_annuel') : null,
            monthly_pumped: (r.monthly_pumped || []).map(Number),
            monthly_needs: (r.monthly_needs || []).map(Number),
        };
    }

    function masquerPlan() {
        dernierPlan = null;
        numeroCalculPlan += 1;
        const res = $('ps_pa_resultats');
        if (res) res.style.display = 'none';
    }

    /** Prix : 2 décimales au-delà de 1, 4 chiffres significatifs en dessous. */
    function chiffrePrix(n) {
        return Math.abs(n) >= 1 || n === 0 ? fr(n, 2) : n.toLocaleString('fr-FR', { maximumSignificantDigits: 4 });
    }
    function prixM3(v, sym) {
        if (v === null || v === undefined || !Number.isFinite(Number(v))) return 'n.d.';
        return `${chiffrePrix(Number(v))} ${sym}/m³`;
    }
    function prixLitre(vM3, sym) {
        if (vM3 === null || vM3 === undefined || !Number.isFinite(Number(vM3))) return 'n.d.';
        return `${chiffrePrix(Number(vM3) / 1000)} ${sym}/L`;
    }

    /** Temps de retour du plan : au-delà de l'horizon, ou moins d'un dixième d'année. */
    function dureePlan(v, horizon) {
        if (v === null || v === undefined) return `> ${horizon} ans`;
        return v < 0.1 ? '< 0,1 an' : `${fr(v, 1)} ans`;
    }

    const LIBELLES_LOTS = {
        materiel_pompage: 'Matériel de pompage', genie_civil_pose: 'Génie civil et pose',
        transport: 'Transport du matériel', terrain: 'Acquisition du terrain', pv: 'Installation PV', groupe_electrogene: 'Groupe électrogène',
        batterie: 'Batterie (stockage)',
    };

    /** [poste, montant, part] ; seuls les postes du cas choisi, puis le financement. */
    function lignesCapexPlan(res, sym) {
        const cles = ['materiel_pompage', 'genie_civil_pose', 'transport']
            .concat(res.capex_lots.terrain !== undefined ? ['terrain'] : [])
            .concat((res.hybride || res.stockage) ? ['pv'] : [], res.hybride ? ['groupe_electrogene'] : [], res.stockage ? ['batterie'] : []);
        const total = res.capex_total || 0;
        const part = (v) => (total > 0 ? `${fr(v / total * 100, 1)} %` : '—');
        const lignes = cles.map((k) => [LIBELLES_LOTS[k], monnaie(res.capex_lots[k], sym), part(res.capex_lots[k])])
            .concat([['Capex total (année 0)', monnaie(total, sym), total > 0 ? '100 %' : '—']]);
        if (res.subvention > 0 || res.emprunt > 0) {
            if (res.subvention > 0) lignes.push(['Subvention', `- ${monnaie(res.subvention, sym)}`, part(res.subvention)]);
            if (res.emprunt > 0) lignes.push(['Emprunt', `- ${monnaie(res.emprunt, sym)}`, part(res.emprunt)]);
            lignes.push(['Fonds propres (apport)', monnaie(res.fonds_propres, sym), part(res.fonds_propres)]);
        }
        return lignes;
    }

    /** « année 10 » ou « années 6, 10, 12, 18 » : remplacements de l'onduleur / du groupe et des batteries. */
    function libelleAnneesRemplacement(res) {
        const annees = new Set(res.horizon >= res.annee_remplacement ? [res.annee_remplacement] : []);
        (res.annees_remplacement_batterie || []).forEach((a) => annees.add(a));
        const liste = Array.from(annees).sort((a, b) => a - b);
        return liste.length > 1 ? `années ${liste.join(', ')}` : `année ${liste[0] || res.annee_remplacement}`;
    }

    function lignesSynthesePlan(res, params, sym) {
        const l1 = res.tableau[1] || {};
        const lignes = [
            ['Besoin en eau, année 1', `${fr(res.besoin_m3_an1, 0)} m³ (x ${fr(params.evolution_besoins, 2)} par an dès l'année 2)`],
            ['Volume pompé, année 1', `${fr(res.volume_pompe_m3_an1, 0)} m³${res.hybride ? ` (dont ${fr(res.volume_groupe_m3_an1, 0)} m³ au groupe)` : ''}`],
            ['Volume facturé, année 1', `${fr(res.volume_facture_m3_an1, 0)} m³ (pertes et impayés : ${fr(params.part_pertes, 1)} %)`],
            [`Volume facturé sur ${res.horizon} ans`, `${fr(res.volume_facture_total_m3, 0)} m³`],
            ['Tarif de vente, année 1', `${prixM3(params.tarif_m3, sym)} (${prixLitre(params.tarif_m3, sym)}), indexé de ${fr(params.indexation_tarif, 1)} %/an`],
            ['Recettes, année 1', monnaie(l1.recettes, sym)],
            [`Recettes sur ${res.horizon} ans`, monnaie(res.recettes_totales, sym)],
            [`Entretien sur ${res.horizon} ans${res.hybride ? ' (installation et groupe)' : ''}`, monnaie(res.entretien_total, sym)],
        ];
        if (res.hybride) {
            lignes.push(['Carburant du groupe, année 1', `${fr(res.carburant_l_an1, 0)} L — ${monnaie(l1.carburant, sym)}`],
                [`Carburant sur ${res.horizon} ans`, monnaie(res.carburant_total, sym)]);
        }
        if (res.remplacements_total > 0) lignes.push([`Remplacements (${libelleAnneesRemplacement(res)})`, monnaie(res.remplacements_total, sym)]);
        if (res.impots) lignes.push([`Impôts sur ${res.horizon} ans`, monnaie(res.impots_total, sym)]);
        if (res.emprunt > 0) lignes.push([`Service de la dette sur ${res.horizon} ans`, monnaie(res.service_dette_total, sym)]);
        if (res.valeur_residuelle_active) lignes.push([`Valeur résiduelle (année ${res.horizon})`, monnaie(res.valeur_residuelle, sym)]);
        lignes.push(['Flux net, année 1', monnaie(res.flux_annee_1, sym)]);
        return lignes;
    }

    /**
     * Colonnes des deux tableaux de flux : { titre, valeur(l), signe } ; colonnes sans objet
     * (carburant hors hybride, impôt sans option...) retirées. Montants sans unité : elle est dans l'en-tête.
     */
    function colonnesFluxPlan(res, sym) {
        const n = (v) => fr(Math.round(Number(v) || 0));
        const m = (t) => `${t} (${sym})`;
        const exploitation = [
            { titre: 'Année', valeur: (l) => String(l.annee) },
            { titre: 'Besoin (m³)', valeur: (l) => fr(l.besoin_m3, 0) },
            { titre: 'Volume facturé (m³)', valeur: (l) => fr(l.volume_facture_m3, 0) },
            { titre: `Tarif (${sym}/m³)`, valeur: (l) => chiffrePrix(Number(l.tarif_m3)) },
            { titre: m('Recettes'), valeur: (l) => n(l.recettes) },
            { titre: m('Entretien'), valeur: (l) => n(l.entretien) },
        ].concat(res.hybride ? [
            { titre: m('Entretien groupe'), valeur: (l) => n(l.entretien_ge) },
            { titre: m('Carburant'), valeur: (l) => n(l.carburant) },
        ] : [], res.remplacements_total > 0 ? [{ titre: m('Remplacements'), valeur: (l) => n(l.remplacements) }] : [],
        res.impots ? [{ titre: m('Impôt'), valeur: (l) => n(l.impot) }] : []);
        const tresorerie = [
            { titre: 'Année', valeur: (l) => (l.annee === 0 ? '0 (investissement)' : String(l.annee)) },
            { titre: m('Investissement'), valeur: (l) => n(l.investissement) },
        ].concat(res.subvention > 0 || res.emprunt > 0 ? [{ titre: m('Subvention et emprunt'), valeur: (l) => n(l.financement) }] : [],
            res.emprunt > 0 ? [
                { titre: m('Intérêts'), valeur: (l) => n(l.interets) },
                { titre: m('Capital remboursé'), valeur: (l) => n(l.principal) },
            ] : [],
            res.valeur_residuelle_active ? [{ titre: m('Valeur résiduelle'), valeur: (l) => n(l.valeur_residuelle) }] : [],
            [
                { titre: m('Flux net'), valeur: (l) => n(l.flux), signe: 'flux' },
                { titre: m('Cumul'), valeur: (l) => n(l.cumul), signe: 'cumul' },
                { titre: m('Flux actualisé'), valeur: (l) => n(l.flux_actualise), signe: 'flux_actualise' },
                { titre: m('Cumul actualisé'), valeur: (l) => n(l.cumul_actualise), signe: 'cumul_actualise' },
            ]);
        return { exploitation, tresorerie };
    }

    function tableHtml(colonnes, lignes) {
        return `<thead><tr>${colonnes.map((c) => `<th>${echapper(c.titre)}</th>`).join('')}</tr></thead><tbody>`
            + lignes.map((l) => `<tr>${colonnes.map((c) => {
                const neg = c.signe && l[c.signe] < 0;
                return `<td${neg ? ' class="ps-negatif"' : ''}>${echapper(c.valeur(l))}</td>`;
            }).join('')}</tr>`).join('') + '</tbody>';
    }

    function texteVerificationPlan(v) {
        const etat = v && v.etat;
        if (etat === 'en_cours') return { couleur: '#475569', texte: 'Vérification du calcul en cours…' };
        if (etat === 'verifie') return { couleur: '#15803d', texte: '✓ Résultats vérifiés.' };
        if (etat === 'corrige') return { couleur: '#b45309', texte: `Écart avec la vérification sur ${v.ecarts} valeur(s) : les valeurs vérifiées, qui font foi, sont affichées.` };
        if (etat === 'refuse') return { couleur: '#b91c1c', texte: `Calcul refusé par la vérification : ${v.message || 'saisie invalide'}. Résultats non vérifiés.` };
        return { couleur: '#b45309', texte: '⚠ Vérification indisponible (connexion) : résultats non vérifiés.' };
    }

    function texteTri(res) {
        if (res.tri_pct === null) return { valeur: 'n.d.', detail: 'hors de -99 % à 1 000 %, ou flux sans changement de signe' };
        return { valeur: `${fr(res.tri_pct, 1)} %`, detail: res.tri_ambigu ? 'flux changeant plusieurs fois de signe : TRI à interpréter avec prudence' : '' };
    }

    /** plan : { resultat, params, devise, verification } (aussi la forme enregistrée en base). */
    function afficherPlan(plan) {
        if (!plan || !plan.resultat || !plan.resultat.success) return;
        dernierPlan = plan;
        avisRecalcul('pa', false);
        const res = plan.resultat;
        const sym = DEVISES[plan.devise] || symboleDevise();
        $('ps_pa_resultats').style.display = 'block';

        const verif = texteVerificationPlan(plan.verification);
        const elVerif = $('ps_pa_verification');
        if (elVerif) { elVerif.style.color = verif.couleur; elVerif.textContent = verif.texte; }

        const signe = (id, v) => { const el = $(id); if (el) el.className = v < 0 ? 'ps-negatif' : 'ps-positif'; };
        const detail = (id, texte) => { const el = $(`${id}_detail`); if (el) { el.textContent = texte; el.style.display = texte ? 'block' : 'none'; } };
        txt('ps_pa_prix_eq', prixM3(res.prix_equilibre_m3, sym));
        detail('ps_pa_prix_eq', res.prix_equilibre_m3 === null ? 'aucun volume facturé, ou équilibre introuvable'
            : `${prixLitre(res.prix_equilibre_m3, sym)} — tarif saisi : ${prixM3(plan.params.tarif_m3, sym)}`);
        const prixEl = $('ps_pa_prix_eq');
        if (prixEl) prixEl.className = res.prix_equilibre_m3 !== null && plan.params.tarif_m3 >= res.prix_equilibre_m3 ? 'ps-positif' : 'ps-negatif';
        txt('ps_pa_cout_revient', prixM3(res.cout_revient_m3, sym));
        detail('ps_pa_cout_revient', res.cout_revient_m3 === null ? '' : prixLitre(res.cout_revient_m3, sym));
        txt('ps_pa_van', monnaie(res.van, sym)); signe('ps_pa_van', res.van);
        detail('ps_pa_van', `sur ${res.horizon} ans, au taux de ${fr(plan.params.taux_actualisation, 1)} %`);
        const t = texteTri(res);
        txt('ps_pa_tri', t.valeur);
        detail('ps_pa_tri', t.detail);
        txt('ps_pa_retour', dureePlan(res.retour_simple_ans, res.horizon));
        txt('ps_pa_retour_act', dureePlan(res.retour_actualise_ans, res.horizon));

        const capex = lignesCapexPlan(res, sym);
        const iTotal = capex.findIndex((l) => l[0].startsWith('Capex total'));
        $('ps_pa_table_capex').innerHTML = '<thead><tr><th>Capex et financement</th><th>Montant</th><th>Part du Capex</th></tr></thead><tbody>'
            + capex.map((l, i) => `<tr${i === iTotal || i === capex.length - 1 ? ' class="ps-total"' : ''}>${l.map((c) => `<td>${echapper(c)}</td>`).join('')}</tr>`).join('')
            + '</tbody>';
        $('ps_pa_table_synthese').innerHTML = '<thead><tr><th>Exploitation</th><th>Valeur</th></tr></thead><tbody>'
            + lignesSynthesePlan(res, plan.params, sym).map((l) => `<tr>${l.map((c) => `<td>${echapper(c)}</td>`).join('')}</tr>`).join('')
            + '</tbody>';
        const colonnes = colonnesFluxPlan(res, sym);
        $('ps_pa_table_flux').innerHTML = tableHtml(colonnes.exploitation, res.tableau.slice(1));
        $('ps_pa_table_tresorerie').innerHTML = tableHtml(colonnes.tresorerie, res.tableau);
        tracerGraphiquesPlan(res, sym);
    }

    function configsPlan(res, sym) {
        const labels = res.tableau.map((l) => l.annee);
        const options = () => ({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } });
        return {
            flux: {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: `Recettes (${sym})`, data: res.tableau.map((l) => l.recettes), backgroundColor: '#16a34a', stack: 'flux' },
                        { label: `Charges d'exploitation et remplacements (${sym})`, data: res.tableau.map((l) => -(l.entretien + l.entretien_ge + l.carburant + l.remplacements)), backgroundColor: '#f97316', stack: 'flux' },
                        { label: `Impôts et dette (${sym})`, data: res.tableau.map((l) => -(l.impot + l.interets + l.principal)), backgroundColor: '#a855f7', stack: 'flux' },
                        { label: `Investissement, financement, valeur résiduelle (${sym})`, data: res.tableau.map((l) => l.financement - l.investissement + l.valeur_residuelle), backgroundColor: '#64748b', stack: 'flux' },
                        { type: 'line', label: `Flux net (${sym})`, data: res.tableau.map((l) => l.flux), borderColor: '#1d4ed8', backgroundColor: '#1d4ed8', tension: 0.1, stack: 'net' },
                    ],
                },
                options: Object.assign(options(), { scales: { x: { stacked: true }, y: { stacked: true } } }),
            },
            cumul: {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        { label: `Flux cumulé (${sym})`, data: res.tableau.map((l) => l.cumul), borderColor: '#FFC107', backgroundColor: 'rgba(255, 193, 7, 0.15)', fill: true, tension: 0.1 },
                        { label: `Flux cumulé actualisé (${sym})`, data: res.tableau.map((l) => l.cumul_actualise), borderColor: '#005A9E', backgroundColor: 'rgba(0, 90, 158, 0.1)', fill: false, tension: 0.1 },
                    ],
                },
                options: Object.assign(options(), { scales: { y: { beginAtZero: false } } }),
            },
        };
    }

    function tracerGraphiquesPlan(res, sym) {
        if (typeof Chart === 'undefined') return;
        Object.keys(graphsPlan).forEach((k) => { if (graphsPlan[k]) graphsPlan[k].destroy(); });
        const configs = configsPlan(res, sym);
        graphsPlan.flux = new Chart($('ps_chart_pa_flux').getContext('2d'), configs.flux);
        graphsPlan.cumul = new Chart($('ps_chart_pa_cumul').getContext('2d'), configs.cumul);
    }

    /**
     * Bouton « Calculer » : calcul immédiat dans le navigateur, puis vérification par le serveur
     * (numpy-financial, seule source de vérité) ; en cas d'écart, ses valeurs remplacent celles-ci.
     * @param {{silencieux?: boolean}} options  silencieux : recalcul après un nouveau dimensionnement.
     */
    async function calculerPlan(options) {
        const silencieux = !!(options && options.silencieux);
        if (!dernierResultat) { message("Dimensionnez d'abord le pompage.", 'error'); return; }
        const { vForm, vPlan } = majEtatValidation();
        const v = vForm[0] || vPlan[0];
        if (v) {
            if (!silencieux) { message(v.message, 'error', 6000); if (v.el) v.el.focus(); }
            return;
        }
        const C = window.PompageSolaireCalculs;
        const params = lirePlan();
        const numero = ++numeroCalculPlan;
        const front = C.planAffaires(params);
        afficherPlan({ resultat: front, params, devise: params.devise, verification: { etat: 'en_cours' } });
        if (!silencieux && $('ps_pa_resultats')) $('ps_pa_resultats').scrollIntoView({ behavior: 'smooth', block: 'start' });

        const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
        let verification;
        let retenu = front;
        try {
            const reponse = await fetch(`${apiPrefix}${URL_PLAN_AFFAIRES}`, {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
            });
            const back = await reponse.json().catch(() => ({}));
            if (reponse.status === 400) {
                verification = { etat: 'refuse', message: back.error };
                if (!silencieux) message(back.error || 'Saisie refusée par la vérification.', 'error', 8000);
            } else if (reponse.ok && back && back.success && back.version === C.VERSION_PLAN_AFFAIRES) {
                const ecarts = C.ecartPlanAffaires(front, back);
                if (ecarts.length) {
                    console.warn('[PompageSolaire] Plan d\'affaires : écarts navigateur / serveur, valeurs du serveur retenues :', ecarts);
                    retenu = back;
                    verification = { etat: 'corrige', ecarts: ecarts.length };
                } else {
                    verification = { etat: 'verifie' };
                }
            } else {
                verification = { etat: 'non_verifie' };
            }
        } catch (e) {
            console.warn('[PompageSolaire] Vérification du plan d\'affaires impossible :', e);
            verification = { etat: 'non_verifie' };
        }
        if (numero !== numeroCalculPlan) return; // calcul dépassé (nouveau calcul, projet changé)
        afficherPlan({ resultat: retenu, params, devise: params.devise, verification });
        resultatsAEnvoyer = instantaneResultats();
        sauvegarder({ immediat: true });
    }

    // ---------------------------------------------------------------------------------------
    // Graphiques techniques
    // ---------------------------------------------------------------------------------------

    function donneesGraphique(type, r, zoom) {
        const a = zoom ? 0.85 : 0.75;
        if (type === 'irradiation') {
            return {
                labels: MOIS,
                datasets: [{
                    label: zoom ? 'Irradiation journalière (kWh/m²/jour)' : 'Irradiation (kWh/m²/jour)',
                    data: r.daily_irradiation, backgroundColor: `rgba(245, 158, 11, ${a})`,
                    borderColor: 'rgb(217, 119, 6)', borderWidth: zoom ? 1.5 : 1, borderRadius: 4,
                }],
            };
        }
        return {
            labels: MOIS,
            datasets: [
                { label: zoom ? 'Besoin mensuel (m³)' : 'Besoin (m³)', data: r.monthly_needs, backgroundColor: `rgba(59, 130, 246, ${a})`, borderColor: 'rgb(37, 99, 235)', borderWidth: zoom ? 1.5 : 1, borderRadius: 4 },
                { label: zoom ? 'Volume pompé (m³)' : 'Pompé (m³)', data: r.monthly_pumped, backgroundColor: `rgba(16, 185, 129, ${a})`, borderColor: 'rgb(5, 150, 105)', borderWidth: zoom ? 1.5 : 1, borderRadius: 4 },
                { label: zoom ? 'Déficit mensuel (m³)' : 'Déficit (m³)', data: r.monthly_missing, backgroundColor: `rgba(239, 68, 68, ${zoom ? 0.75 : 0.65})`, borderColor: 'rgb(220, 38, 38)', borderWidth: zoom ? 1.5 : 1, borderRadius: 4 },
            ],
        };
    }

    function optionsGraphique(titreY, zoom, tooltip) {
        const t = zoom ? 12 : 11;
        const o = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { title: { display: false }, legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: t } } } },
            scales: {
                y: { beginAtZero: true, title: { display: true, text: titreY, font: { size: t } }, grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false }, ticks: { font: { size: t - 1 } } },
            },
        };
        if (tooltip) o.plugins.tooltip = { callbacks: { label: tooltip } };
        return o;
    }

    function tracerGraphiques(r) {
        if (typeof Chart === 'undefined') return;
        if (graphIrradiation) graphIrradiation.destroy();
        if (graphEau) graphEau.destroy();
        graphIrradiation = new Chart($('ps_chart_irradiation').getContext('2d'), {
            type: 'bar', data: donneesGraphique('irradiation', r, false), options: optionsGraphique('kWh / m² / jour', false),
        });
        graphEau = new Chart($('ps_chart_eau').getContext('2d'), {
            type: 'bar', data: donneesGraphique('eau', r, false), options: optionsGraphique('Volume (m³)', false),
        });
    }

    function ouvrirZoom(type) {
        if (!dernierResultat || typeof Chart === 'undefined') return;
        const modal = $('ps_chart_zoom_modal');
        const canvas = $('ps_chart_zoom_canvas');
        if (!modal || !canvas) return;
        if (graphZoom) { graphZoom.destroy(); graphZoom = null; }
        const irr = type === 'irradiation';
        txt('ps_zoom_title', irr ? 'Ensoleillement moyen par mois (kWh/m²/jour)' : 'Besoins en eau et volumes pompés par mois (m³)');
        graphZoom = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: donneesGraphique(irr ? 'irradiation' : 'eau', dernierResultat, true),
            options: optionsGraphique(irr ? 'kWh / m² / jour' : 'Volume (m³)', true, irr
                ? (ctx) => ` Irradiation : ${Number(ctx.raw).toFixed(2)} kWh/m²/j`
                : (ctx) => ` ${ctx.dataset.label} : ${Number(ctx.raw).toFixed(1)} m³`),
        });
        modal.style.display = 'flex';
    }

    function fermerZoom() {
        const modal = $('ps_chart_zoom_modal');
        if (modal) modal.style.display = 'none';
        if (graphZoom) { graphZoom.destroy(); graphZoom = null; }
    }

    // ---------------------------------------------------------------------------------------
    // Export PDF
    // ---------------------------------------------------------------------------------------

    const PDF = {
        marge: 15, largeur: 180, bas: 278, haut: 24,
        rouge: [220, 38, 38], fonce: [31, 41, 55], gris: [100, 116, 139], bordure: [226, 232, 240],
    };

    /** Les polices standard de jsPDF (WinAnsi) ne rendent ni « ₂ » ni les espaces fines de toLocaleString. */
    function pdfTexte(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/₂/g, '2').replace(/[  ]/g, ' ').replace(/★/g, '*')
            .replace(/[⚠✓]/g, '').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[’‘]/g, "'").replace(/√/g, 'racine de ');
    }

    function assurerPlace(doc, y, h) {
        if (y + h > PDF.bas) { doc.addPage(); return PDF.haut + 4; }
        return y;
    }

    function titreSection(doc, y, texte) {
        y = assurerPlace(doc, y, 22);
        doc.setFillColor(...PDF.rouge);
        doc.rect(PDF.marge, y - 4.3, 2.2, 5.6, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(...PDF.fonce);
        doc.text(pdfTexte(texte), PDF.marge + 5, y);
        doc.setDrawColor(...PDF.bordure);
        doc.setLineWidth(0.3);
        doc.line(PDF.marge, y + 2.5, PDF.marge + PDF.largeur, y + 2.5);
        return y + 8;
    }

    function sousTitre(doc, y, texte) {
        y = assurerPlace(doc, y, 14);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...PDF.fonce);
        doc.text(pdfTexte(texte), PDF.marge, y);
        return y + 3;
    }

    function paragraphe(doc, y, texte, taille) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(taille || 9.5);
        doc.setTextColor(...PDF.fonce);
        const lignes = doc.splitTextToSize(pdfTexte(texte), PDF.largeur);
        lignes.forEach((l) => { y = assurerPlace(doc, y, 5); doc.text(l, PDF.marge, y); y += 4.8; });
        return y + 2;
    }

    function tableau(doc, y, entete, corps, opts) {
        if (typeof doc.autoTable === 'function') {
            doc.autoTable(Object.assign({
                startY: y,
                head: entete ? [entete.map(pdfTexte)] : undefined,
                body: corps.map((l) => l.map(pdfTexte)),
                theme: 'grid',
                margin: { left: PDF.marge, right: PDF.marge, top: PDF.haut + 2, bottom: 20 },
                styles: { font: 'helvetica', fontSize: 8.8, cellPadding: 1.8, textColor: PDF.fonce, lineColor: PDF.bordure, lineWidth: 0.2, halign: 'center', valign: 'middle' },
                headStyles: { fillColor: PDF.fonce, textColor: 255, fontStyle: 'bold', halign: 'center' },
                alternateRowStyles: { fillColor: [248, 250, 252] },
            }, opts || {}));
            return doc.lastAutoTable.finalY + 7;
        }
        // Repli si le plugin autotable n'est pas chargé.
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...PDF.fonce);
        (entete ? [entete] : []).concat(corps).forEach((l) => {
            y = assurerPlace(doc, y, 5.5);
            doc.text(pdfTexte(l.filter((c) => c !== '').join('   |   ')), PDF.marge, y);
            y += 5.5;
        });
        return y + 4;
    }

    /**
     * Graphique du rapport : re-rendu hors écran à un format paysage FIXE (les canvas de la page ont
     * la largeur de leur colonne, et un graphique étroit étiré sur la largeur A4 serait déformé).
     */
    function imageGraphique(doc, y, config, titre) {
        if (typeof Chart === 'undefined' || !config) return y;
        const L = 800;
        const H = 320;
        const canvas = document.createElement('canvas');
        canvas.width = L;
        canvas.height = H;
        canvas.style.cssText = `position:fixed; left:-20000px; top:0; width:${L}px; height:${H}px;`;
        document.body.appendChild(canvas);
        let data = null;
        let graphique = null;
        try {
            const cfg = Object.assign({}, config, {
                options: Object.assign({}, config.options, { responsive: false, maintainAspectRatio: false, animation: false, devicePixelRatio: 2 }),
            });
            graphique = new Chart(canvas.getContext('2d'), cfg);
            data = canvas.toDataURL('image/png', 1.0);
        } catch (e) {
            console.warn('[PompageSolaire] Graphique non exporté :', e);
        } finally {
            if (graphique) graphique.destroy();
            canvas.remove();
        }
        if (!data) return y;
        const l = PDF.largeur - 6;
        const h = l * H / L;
        y = assurerPlace(doc, y, h + 14);
        y = sousTitre(doc, y, titre);
        doc.setDrawColor(...PDF.bordure);
        doc.roundedRect(PDF.marge, y, PDF.largeur, h + 6, 2, 2, 'S');
        doc.addImage(data, 'PNG', PDF.marge + 3, y + 3, l, h, undefined, 'FAST');
        return y + h + 13;
    }

    /** Canvas -> JPEG sur fond blanc (les rendus du calepinage sont transparents par endroits). */
    function canvasEnJpeg(source) {
        const c = document.createElement('canvas');
        c.width = source.width;
        c.height = source.height;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(source, 0, 0);
        return { data: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height };
    }

    function imageDataUrlEnJpeg(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => { try { resolve(canvasEnJpeg(img)); } catch (e) { resolve(null); } };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    }

    /**
     * Captures du calepinage prises dans la page principale (mêmes fonctions que la Déclaration
     * préalable) : vue sur la carte (photo aérienne + panneaux), plan du canvas, vue 3D isométrique.
     * Premier champ du calepinage ; [] si le calepinage n'est pas disponible.
     */
    async function capturesCalepinage() {
        const P = pageProjet();
        const CM = P && P.CalepinageMaisonIndiv;
        if (!CM || typeof CM.getHouseStateById !== 'function') return [];
        const info = lireChampsPv();
        let ids = info.sources;
        if (!ids.length && typeof CM.listerChampsCarte === 'function') {
            try { ids = (CM.listerChampsCarte() || []).map((c) => c.sourceId).filter(Boolean); } catch (e) { ids = []; }
        }
        const id = ids[0];
        const state = id ? CM.getHouseStateById(id) : null;
        if (!state) return [];
        const suffixe = ids.length > 1 ? ` — ${id} (1er des ${ids.length} champs)` : '';
        const images = [];
        const cles = ['showPanels', 'showBackgroundImage', 'showOrientationCard', 'showStructure', 'showCotations'];
        const sauve = {};
        cles.forEach((k) => { sauve[k] = state[k]; });
        try {
            if (typeof CM.captureRoofDiagramImage === 'function') {
                let fond = false;
                if (typeof CM.ensureMapBackground === 'function') {
                    try { fond = await CM.ensureMapBackground(id); } catch (e) { fond = false; }
                }
                if (fond) {
                    Object.assign(state, { showPanels: true, showBackgroundImage: true, showOrientationCard: false, showStructure: false, showCotations: false });
                    const c = await CM.captureRoofDiagramImage(id, 1600, 1000, { margeMetres: 4 });
                    if (c) images.push(Object.assign({ titre: `Vue sur la carte (photo aérienne et panneaux)${suffixe}` }, canvasEnJpeg(c)));
                }
                Object.assign(state, { showPanels: true, showBackgroundImage: false, showOrientationCard: false, showStructure: false, showCotations: true });
                const c2 = await CM.captureRoofDiagramImage(id, 1600, 1000, { margeMetres: 2 });
                if (c2) images.push(Object.assign({ titre: `Plan du calepinage (canvas)${suffixe}` }, canvasEnJpeg(c2)));
            }
        } catch (e) {
            console.warn('[PompageSolaire] Capture du calepinage impossible :', e);
        } finally {
            Object.assign(state, sauve);
        }
        if (typeof CM.captureVue3DImage === 'function') {
            try {
                const url = await CM.captureVue3DImage(id, { mode: 'iso', width: 1600, height: 1000 });
                const img = url ? await imageDataUrlEnJpeg(url) : null;
                if (img) images.push(Object.assign({ titre: `Vue 3D isométrique${suffixe}` }, img));
            } catch (e) {
                console.warn('[PompageSolaire] Capture 3D impossible :', e);
            }
        }
        return images;
    }

    function imageCapture(doc, y, image) {
        const lMax = PDF.largeur - 6;
        let l = lMax;
        let h = l * image.h / image.w;
        if (h > 100) { h = 100; l = h * image.w / image.h; }
        y = assurerPlace(doc, y, h + 14);
        y = sousTitre(doc, y, image.titre);
        doc.setDrawColor(...PDF.bordure);
        doc.roundedRect(PDF.marge, y, PDF.largeur, h + 6, 2, 2, 'S');
        doc.addImage(image.data, 'JPEG', PDF.marge + 3 + (lMax - l) / 2, y + 3, l, h, undefined, 'FAST');
        return y + h + 13;
    }

    /** Image de la page de garde, réduite (l'original fait plusieurs Mo). */
    function chargerImageRapport() {
        if (imageRapportCache) return Promise.resolve(imageRapportCache);
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const echelle = Math.min(1, 1600 / img.naturalWidth);
                    const c = document.createElement('canvas');
                    c.width = Math.round(img.naturalWidth * echelle);
                    c.height = Math.round(img.naturalHeight * echelle);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    imageRapportCache = { data: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height };
                    resolve(imageRapportCache);
                } catch (e) { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = urlImage(IMAGE_RAPPORT);
        });
    }

    function tuile(doc, x, y, w, h, fond, libelle, valeur) {
        doc.setFillColor(...fond);
        doc.setDrawColor(...PDF.bordure);
        doc.roundedRect(x, y, w, h, 2, 2, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...PDF.gris);
        doc.text(pdfTexte(libelle), x + w / 2, y + 7, { align: 'center' });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(...PDF.fonce);
        doc.text(pdfTexte(valeur), x + w / 2, y + 15, { align: 'center' });
    }

    function pageDeGarde(doc, r, s, couverture, dateStr, mode, variante) {
        const plan = mode === 'plan';
        doc.setFillColor(...PDF.fonce);
        doc.rect(0, 0, 210, 20, 'F');
        doc.setFillColor(...PDF.rouge);
        doc.rect(0, 20, 210, 1.5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Solakvan BET Solar', PDF.marge, 12.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(pdfTexte(`Édité le ${dateStr}`), 195, 12.5, { align: 'right' });

        doc.setTextColor(...PDF.rouge);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(pdfTexte(plan ? "PLAN D'AFFAIRES" : 'RAPPORT DE PRÉDIMENSIONNEMENT'), PDF.marge, 36);
        doc.setTextColor(...PDF.fonce);
        doc.setFontSize(26);
        doc.text(pdfTexte(plan ? "Pompage solaire : vente d'eau" : 'Pompage solaire'), PDF.marge, 48);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.setTextColor(...PDF.gris);
        const libelleSysteme = SYSTEMES[s.systeme] ? SYSTEMES[s.systeme].libelle : SYSTEMES[SYSTEME_DEFAUT].libelle;
        doc.text(pdfTexte(plan ? "Viabilité du projet à partir des recettes de la vente d'eau"
            : `Prédimensionnement système de pompage solaire — ${libelleSysteme.toLowerCase()}`), PDF.marge, 56);

        let y = 63;
        if (couverture) {
            let w = PDF.largeur;
            let h = w * couverture.h / couverture.w;
            if (h > 98) { h = 98; w = h * couverture.w / couverture.h; }
            doc.addImage(couverture.data, 'JPEG', PDF.marge + (PDF.largeur - w) / 2, y, w, h, undefined, 'FAST');
            y += h + 7;
        } else {
            y += 4;
        }

        const infos = [
            ['Site', s.site],
            ['Coordonnées', s.coords],
            ['Type de système', libelleSysteme],
            ['Type de pompage', s.typePompe === 'surface' ? 'Pompe de surface' : 'Forage / puits profond (pompe immergée)'],
            ['Pompe retenue', libelleChoixPompe()],
        ];
        if (variante) infos.push(['Variante du projet', variante]);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(...PDF.bordure);
        doc.roundedRect(PDF.marge, y, PDF.largeur, 8 + infos.length * 6, 2, 2, 'FD');
        infos.forEach(([k, v], i) => {
            const yy = y + 7.5 + i * 6;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(...PDF.gris);
            doc.text(pdfTexte(k), PDF.marge + 5, yy);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...PDF.fonce);
            doc.text(pdfTexte(doc.splitTextToSize(pdfTexte(v), 130)[0] || ''), PDF.marge + 42, yy);
        });
        y += 8 + infos.length * 6 + 6;

        const w4 = (PDF.largeur - 3 * 4) / 4;
        const couverture1 = r.energy_solar_design_mwh_yr > 0 ? r.solar_coverage_design : r.solar_coverage;
        if (plan && dernierPlan) {
            const pa = dernierPlan.resultat;
            const symPa = DEVISES[dernierPlan.devise];
            [
                ["Prix d'équilibre", prixM3(pa.prix_equilibre_m3, symPa), [254, 252, 232]],
                ['Tarif de vente', prixM3(dernierPlan.params.tarif_m3, symPa), [236, 254, 255]],
                ['Volume facturé (an 1)', `${fr(pa.volume_facture_m3_an1, 0)} m³`, [239, 246, 255]],
                ['Capex total', monnaie(pa.capex_total, symPa), [255, 247, 237]],
            ].forEach(([k, v, c], i) => tuile(doc, PDF.marge + i * (w4 + 4), y, w4, 20, c, k, v));
            y += 24;
            [
                ['VAN', monnaie(pa.van, symPa), [245, 243, 255]],
                ['TRI', pa.tri_pct === null ? 'n.d.' : `${fr(pa.tri_pct, 1)} %`, [240, 253, 244]],
                ['Retour simple', dureePlan(pa.retour_simple_ans, pa.horizon), [255, 247, 237]],
                ["Horizon d'étude", `${pa.horizon} ans`, [236, 253, 245]],
            ].forEach(([k, v, c], i) => tuile(doc, PDF.marge + i * (w4 + 4), y, w4, 20, c, k, v));
        } else {
            [
                ['HMT', `${r.hmt.toFixed(1)} m`, [239, 246, 255]],
                ['Puissance PV nécessaire', `${(r.req_pv_w / 1000).toFixed(2)} kWc`, [254, 252, 232]],
                ['Débit moyen', `${r.debit_moyen_m3h.toFixed(2)} m³/h`, [236, 254, 255]],
                ['Taux de couverture', `${couverture1.toFixed(1)} %`, [240, 253, 244]],
            ].forEach(([k, v, c], i) => tuile(doc, PDF.marge + i * (w4 + 4), y, w4, 20, c, k, v));
            y += 24;

            if (dernierEco) {
                const couleurs = [[245, 243, 255], [240, 253, 244], [255, 247, 237], [236, 253, 245]];
                indicateursEco(dernierEco.resultat, DEVISES[dernierEco.devise]).slice(0, 4)
                    .forEach((c, i) => tuile(doc, PDF.marge + i * (w4 + 4), y, w4, 20, couleurs[i], c.titre, c.valeur));
            }
        }

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...PDF.gris);
        doc.text(pdfTexte("Document de prédimensionnement indicatif — à confirmer par une étude d'exécution."), 105, 287, { align: 'center' });
    }

    function libelleSystemeRapport(s) {
        return (SYSTEMES[s && s.systeme] || SYSTEMES[SYSTEME_DEFAUT]).libelle;
    }

    /**
     * Tableau de flux du rapport : largeur minimale de chaque colonne = sa valeur la plus longue,
     * pour que les nombres ne soient jamais coupés sur deux lignes (seuls les en-têtes peuvent l'être).
     */
    function tableauFluxPdf(doc, y, colonnes, lignes) {
        const corps = lignes.map((l) => colonnes.map((c) => c.valeur(l)));
        const taille = colonnes.length > 9 ? 6.2 : 6.9;
        const padding = 1.1;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(taille);
        const largeursMin = {};
        colonnes.forEach((_, j) => {
            largeursMin[j] = { minCellWidth: Math.max(...corps.map((ligne) => doc.getTextWidth(pdfTexte(ligne[j])))) + 2 * padding + 0.6 };
        });
        return tableau(doc, y, colonnes.map((c) => c.titre), corps, {
            columnStyles: largeursMin,
            styles: { font: 'helvetica', fontSize: taille, cellPadding: padding, textColor: PDF.fonce, lineColor: PDF.bordure, lineWidth: 0.2, halign: 'center', valign: 'middle' },
            headStyles: { fillColor: PDF.fonce, textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 6.4 },
        });
    }

    /**
     * Pages du plan d'affaires. `entete(y, texte)` place un titre de partie (section numérotée dans
     * le rapport dédié, sous-titre dans le rapport complet) et renvoie le nouveau y.
     */
    function ecrirePlanPdf(doc, y, entete) {
        const pa = dernierPlan.resultat;
        const pp = dernierPlan.params;
        const sym = DEVISES[dernierPlan.devise];
        const cas = pa.hybride ? SYSTEMES.groupe.libelle : pa.stockage ? SYSTEMES.batteries.libelle : SYSTEMES.fil_soleil.libelle;
        y = paragraphe(doc, y, "Seconde analyse de rentabilité : la viabilité du projet est évaluée à partir des recettes "
            + "de la vente d'eau, mises en regard du Capex, de l'exploitation et du financement du système de pompage solaire. "
            + 'Tout le volume pompé est vendu (solaire' + (pa.hybride ? ', plus le groupe électrogène qui pompe le déficit' : '')
            + "), hors part perdue ou impayée. Le besoin en eau évolue chaque année dès l'année 2 et le pompage solaire baisse avec la dégradation des panneaux. "
            + "Le prix de vente d'équilibre est le tarif de l'année 1 (indexé ensuite comme le tarif saisi) qui annule la VAN ; "
            + "le coût de revient actualisé est le prix constant qui l'annule.", 9);

        y = entete(y, "Hypothèses du plan d'affaires");
        const hyp = [
            ['Devise', `${sym} (${dernierPlan.devise})`],
            ['Type de système', cas],
            ['Capex de la pompe solaire (analyse économique)', monnaie(pp.capex_pompe, sym)],
            ["Coût d'acquisition du terrain (non amorti)", monnaie(pp.capex_terrain || 0, sym)],
            ['Évolution annuelle des besoins en eau', `x ${fr(pp.evolution_besoins, 2)} par an dès l'année 2`],
            ['Dégradation des panneaux', `${fr(pp.degradation_pv, 2)} %/an`],
            ["Tarif de vente de l'eau (année 1)", `${prixM3(pp.tarif_m3, sym)} (${prixLitre(pp.tarif_m3, sym)})`],
            ['Indexation annuelle du tarif de vente', `${fr(pp.indexation_tarif, 1)} %/an`],
            ["Part d'eau perdue ou impayée", `${fr(pp.part_pertes, 1)} %`],
            ["Entretien de l'installation", `${monnaie(pp.entretien, sym)} /an, indexé de ${fr(pp.indexation_entretien, 1)} %/an`],
            [`Remplacement de l'onduleur / contrôleur (année ${pa.annee_remplacement})`, monnaie(pp.remplacement_onduleur, sym)],
        ];
        if (pa.hybride) {
            hyp.push(['Entretien du groupe électrogène', `${monnaie(pp.entretien_ge, sym)} /an`],
                [`Remplacement du groupe (année ${pa.annee_remplacement})`, monnaie(pp.remplacement_ge, sym)],
                ['Carburant du groupe, année 1 (déficit solaire)', `${fr(pa.carburant_l_an1, 0)} L`],
                ['Prix du carburant', `${fr(pp.prix_carburant, 2)} ${sym}/L, indexé de ${fr(pp.inflation_carburant, 1)} %/an`]);
        }
        if (pa.stockage) {
            hyp.push(['Capex des batteries (analyse économique)', monnaie(pp.capex_batterie, sym)],
                [`Remplacement des batteries (tous les ${pp.duree_vie_batterie || 10} ans${(pa.annees_remplacement_batterie || []).length ? ` : années ${pa.annees_remplacement_batterie.join(', ')}` : ' : aucun sur l\'horizon'})`, monnaie(pp.remplacement_batterie, sym)]);
        }
        if (pa.subvention > 0) hyp.push(['Subvention', monnaie(pa.subvention, sym)]);
        if (pa.emprunt > 0) hyp.push(['Emprunt', `${monnaie(pa.emprunt, sym)} à ${fr(pp.taux_emprunt, 2)} % sur ${pp.duree_emprunt} ans (annuités constantes)`]);
        hyp.push(['Impôts', pa.impots ? `${fr(pp.taux_impot, 1)} % du résultat positif` : 'Non pris en compte']);
        if (pa.impots || pa.valeur_residuelle_active) {
            hyp.push(['Amortissement du Capex', pp.methode_amortissement === 'constant'
                ? `${monnaie(pp.amortissement_annuel, sym)} /an (plafonné au Capex)` : `Linéaire sur ${pp.duree_amortissement} ans`]);
        }
        hyp.push(['Valeur résiduelle', pa.valeur_residuelle_active ? "Valeur nette comptable à l'horizon" : 'Non prise en compte'],
            ["Taux d'actualisation", `${fr(pp.taux_actualisation, 1)} %`],
            ["Horizon d'étude", `${pa.horizon} ans`]);
        y = tableau(doc, y + 1, ['Hypothèse', 'Valeur'], hyp, { columnStyles: { 0: { cellWidth: 95 } } });

        y = entete(y, 'Capex et financement');
        const capex = lignesCapexPlan(pa, sym);
        const iTotal = capex.findIndex((l) => l[0].startsWith('Capex total'));
        y = tableau(doc, y + 1, ['Capex et financement', 'Montant', 'Part du Capex'], capex, {
            didParseCell: (d) => { if (d.section === 'body' && (d.row.index === iTotal || d.row.index === capex.length - 1)) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [238, 242, 255]; } },
        });

        y = entete(y, "Indicateurs du plan d'affaires");
        const t = texteTri(pa);
        y = tableau(doc, y + 1, ['Indicateur', 'Valeur'], [
            ["Prix de vente d'équilibre (année 1)", `${prixM3(pa.prix_equilibre_m3, sym)} (${prixLitre(pa.prix_equilibre_m3, sym)})`],
            ['Coût de revient actualisé (prix constant)', `${prixM3(pa.cout_revient_m3, sym)} (${prixLitre(pa.cout_revient_m3, sym)})`],
            ['Tarif de vente saisi (année 1)', prixM3(pp.tarif_m3, sym)],
            ['VAN (valeur actuelle nette)', monnaie(pa.van, sym)],
            ['TRI', t.detail ? `${t.valeur} (${t.detail})` : t.valeur],
            ['Temps de retour simple', dureePlan(pa.retour_simple_ans, pa.horizon)],
            ['Temps de retour actualisé', dureePlan(pa.retour_actualise_ans, pa.horizon)],
            ['Vérification', pdfTexte(texteVerificationPlan(dernierPlan.verification).texte)],
        ], { columnStyles: { 0: { cellWidth: 95 }, 1: { fontStyle: 'bold' } } });

        y = entete(y, 'Exploitation');
        y = tableau(doc, y + 1, ['Exploitation', 'Valeur'], lignesSynthesePlan(pa, pp, sym), { columnStyles: { 0: { cellWidth: 75 } } });

        const colonnes = colonnesFluxPlan(pa, sym);
        y = entete(y, "Tableau des flux : ventes et charges d'exploitation");
        y = tableauFluxPdf(doc, y + 1, colonnes.exploitation, pa.tableau.slice(1));
        y = entete(y, 'Tableau des flux : investissement, financement et trésorerie');
        y = tableauFluxPdf(doc, y + 1, colonnes.tresorerie, pa.tableau);

        const graphiques = configsPlan(pa, sym);
        y = imageGraphique(doc, y, graphiques.flux, 'Flux annuels : recettes, charges et flux net');
        y = imageGraphique(doc, y, graphiques.cumul, 'Rentabilité : flux cumulés');
        return y;
    }

    /** Fenêtre la plus haute de l'application (même origine) : la section vit dans l'iframe de la modale. */
    function fenetreHaute() {
        let w = window;
        try {
            while (w.parent && w.parent !== w && w.parent.document) w = w.parent;
        } catch (e) { /* parent d'une autre origine : on s'arrête là */ }
        return w;
    }

    /** Gestionnaire des variantes de la page projet (UIManager, ParametresProjet.js) ; null hors de l'application. */
    function gestionnaireVariantes() {
        let w = window;
        try {
            for (;;) {
                const ui = w.uiManagerInstance;
                if (ui && typeof ui.demanderVarianteRapport === 'function') return ui;
                if (!w.parent || w.parent === w) return null;
                w = w.parent;
            }
        } catch (e) { return null; }
    }

    /**
     * Variante du rapport, comme pour le rapport de projet (ExportService.exportPDF) : la configuration
     * du pompage (incluse dans les variantes) est d'abord enregistrée en base, puis la fenêtre
     * « Génération du rapport » enregistre le projet dans la variante active, ou crée une variante
     * (B, C, D) une fois A enregistrée. Renvoie {indice}, ou null si la génération est annulée.
     */
    async function choisirVarianteRapport() {
        const ui = gestionnaireVariantes();
        if (!ui) return { indice: null };
        if (persistance === 'active' && projetCharge && !(await envoyerSauvegarde(false))) {
            message("Le pompage solaire n'a pas pu être enregistré : rapport non généré.", 'error', 6000);
            return null;
        }
        return ui.demanderVarianteRapport();
    }

    /**
     * Aperçu du rapport avant téléchargement, même fenêtre que le rapport de projet
     * (ExportService.preview) : affichée sur toute la page, « Télécharger » ou « Fermer ».
     */
    function apercuPDF(doc, nomFichier) {
        const hote = fenetreHaute();
        const d = hote.document;
        const ancien = d.getElementById('ps-pdf-preview-modal');
        if (ancien) ancien.remove();
        // URL créée par la page hôte : elle reste valable si la modale (iframe) est fermée entre-temps.
        const url = hote.URL.createObjectURL(doc.output('blob'));

        const modal = d.createElement('div');
        modal.id = 'ps-pdf-preview-modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.8);'
            + ' z-index: 2147483000; display: flex; flex-direction: column; align-items: center; justify-content: center;';
        modal.innerHTML = `
            <div style="width: 90%; height: 90%; background-color: white; border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);">
                <div style="padding: 15px 20px; background-color: #f50000; color: white; display: flex; justify-content: space-between; align-items: center; border-top-left-radius: 8px; border-top-right-radius: 8px;">
                    <h3 style="margin: 0; font-size: 18px;">Prévisualisation du PDF</h3>
                    <div>
                        <a data-action="telecharger" style="display: inline-block; background-color: white; color: #f50000; border: none; padding: 8px 16px; margin-right: 10px; border-radius: 4px; cursor: pointer; font-weight: bold; text-decoration: none;"
                            onclick="const m = this.closest('#ps-pdf-preview-modal'); setTimeout(() => { m.remove(); setTimeout(() => window.URL.revokeObjectURL(m.dataset.url), 10000); }, 0);">Télécharger</a>
                        <button type="button" data-action="fermer" style="background-color: transparent; color: white; border: 2px solid white; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold;"
                            onclick="const m = this.closest('#ps-pdf-preview-modal'); m.remove(); window.URL.revokeObjectURL(m.dataset.url);">Fermer</button>
                    </div>
                </div>
                <iframe title="Prévisualisation du PDF" style="width: 100%; height: 100%; border: none; border-bottom-left-radius: 8px; border-bottom-right-radius: 8px;"></iframe>
            </div>`;
        // Lien de téléchargement natif et gestionnaires en attribut, exécutés par la page hôte : les
        // boutons restent actifs si la modale (iframe de cette section) est fermée ou rechargée.
        modal.dataset.url = url;
        const lien = modal.querySelector('[data-action="telecharger"]');
        lien.href = url;
        lien.download = nomFichier;
        modal.querySelector('iframe').src = url;
        d.body.appendChild(modal);
    }

    /** @param {{mode?: 'complet'|'plan'}} options  plan : rapport consacré au seul plan d'affaires. */
    async function genererPDF(options) {
        const mode = options && options.mode === 'plan' ? 'plan' : 'complet';
        if (!dernierResultat || !dernierInstantane) {
            message("Veuillez d'abord dimensionner le pompage avant d'exporter le rapport.", 'error');
            return;
        }
        if (mode === 'plan' && !dernierPlan) {
            message("Calculez d'abord le plan d'affaires.", 'error');
            return;
        }
        const jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
        if (!jsPDF) {
            message("Le module d'export PDF n'est pas disponible : rechargez la page.", 'error');
            return;
        }

        try {
            const choix = await choisirVarianteRapport();
            if (!choix) return; // fenêtre fermée, ou enregistrement en échec (déjà signalé)
            const variante = choix.indice || null;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
            const r = dernierResultat;
            const s = dernierInstantane;
            const e = s.entrees;
            const dateStr = new Date().toLocaleDateString('fr-FR');
            const surface = s.typePompe === 'surface';
            const installe = Number(e.puissance_reelle_installee_kwc || 0);

            pageDeGarde(doc, r, s, await chargerImageRapport(), dateStr, mode, variante);

            doc.addPage();
            let y = PDF.haut + 6;
            let n = 0;
            const section = (t) => { n += 1; y = titreSection(doc, y, `${n}. ${t}`); };

            if (mode === 'plan') {
                // Rapport dédié : rappel du contexte technique, puis le plan d'affaires seul.
                const couvertureTech = r.energy_solar_design_mwh_yr > 0 ? r.solar_coverage_design : r.solar_coverage;
                section('Contexte technique');
                y = tableau(doc, y, ['Paramètre', 'Valeur'], [
                    ['Site', s.site],
                    ['Coordonnées', s.coords],
                    ['Type de système', libelleSystemeRapport(s)],
                    ['Type de pompage', surface ? 'Pompe de surface' : 'Forage / puits profond (pompe immergée)'],
                    ['Pompe retenue', libelleChoixPompe()],
                    ['Besoin journalier', `${e.daily_need} m³/j`],
                    ["Besoin d'eau annuel", `${fr(r.annual_water_need_m3, 0)} m³/an`],
                    ['Hauteur manométrique totale (HMT)', `${r.hmt.toFixed(2)} m`],
                    ['Puissance PV nécessaire', `${(r.req_pv_w / 1000).toFixed(2)} kWc`],
                    ['Puissance PV installée', installe > 0 ? `${installe} kWc` : 'Non renseignée'],
                    ['Taux de couverture solaire', `${couvertureTech.toFixed(1)} %`],
                ], { columnStyles: { 0: { cellWidth: 75, textColor: PDF.gris } } });
                y = ecrirePlanPdf(doc, y, (yy, t) => { y = yy; section(t); return y; });
            } else {

                // Type de système et circuit hydraulique (schéma de la section 1).
                const sysRapport = SYSTEMES[s.systeme] ? s.systeme : SYSTEME_DEFAUT;
                const typeRapport = surface ? 'surface' : 'forage';
                section('Type de système et circuit hydraulique');
                y = paragraphe(doc, y, `${SYSTEMES[sysRapport].libelle}, ${surface ? 'pompe de surface' : 'pompe immergée en forage'}. ${SYSTEMES[sysRapport].description}`, 9.5);
                const cotes = [`${surface ? 'Ha (aspiration)' : 'Hd (niveau dynamique)'} = ${fr(Number(e.h_aspiration), 1)} m`,
                    `Hr (refoulement) = ${fr(Number(e.h_tank), 1)} m`, `HMT = ${fr(r.hmt, 1)} m`].join('   ·   ');
                const schema = await svgEnImage(schemaCircuit(sysRapport, typeRapport, { cotes }), 1800, 1040);
                if (schema) {
                    const h = PDF.largeur * schema.h / schema.w;
                    y = assurerPlace(doc, y, h + 6);
                    doc.setDrawColor(...PDF.bordure);
                    doc.roundedRect(PDF.marge, y, PDF.largeur, h, 2, 2, 'S');
                    doc.addImage(schema.data, 'PNG', PDF.marge, y, PDF.largeur, h, undefined, 'FAST');
                    y += h + 6;
                } else {
                    y = paragraphe(doc, y, 'Schéma du circuit indisponible.', 9);
                }
                y = tableau(doc, y, ['N°', 'Composant', 'Rôle'], composantsCircuit(sysRapport, typeRapport).map((c) => [String(c.n), c.nom, c.role]), {
                    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.4, textColor: PDF.fonce, lineColor: PDF.bordure, lineWidth: 0.2, valign: 'middle' },
                    columnStyles: { 0: { cellWidth: 10, halign: 'center', fontStyle: 'bold', textColor: PDF.rouge }, 1: { cellWidth: 58, fontStyle: 'bold' }, 2: { halign: 'left' } },
                });
                y = paragraphe(doc, y, "Schéma de principe, sans échelle : implantation et équipements à confirmer par l'étude d'exécution.", 8);

                doc.addPage();
                y = PDF.haut + 6;
                section("Données d'entrée");
                const lignesSysteme = [['Système', 'Type de système', SYSTEMES[sysRapport].libelle]];
                if (sysRapport === 'batteries') {
                    lignesSysteme.push(['Système', 'Autonomie des batteries', `${e.autonomie_batterie_j} j`],
                        ['Système', 'Profondeur de décharge', `${e.dod_batterie_pct} %`],
                        ['Système', 'Rendement aller-retour des batteries', `${e.rendement_batterie_pct} %`]);
                }
                y = tableau(doc, y, ['Rubrique', 'Paramètre', 'Valeur'], lignesSysteme.concat([
                    ['Site', 'Adresse du projet', s.site],
                    ['Site', 'Coordonnées', s.coords],
                    ['Site', 'Ensoleillement', s.irradiationRepli
                        ? "Profil d'irradiation par défaut (ensoleillement du site indisponible : résultats indicatifs)"
                        : 'Moyennes mensuelles du site (plan des panneaux)'],
                    ['Ressource solaire', 'Inclinaison des panneaux', `${s.angle}°`],
                    ['Ressource solaire', 'Azimut (0 = plein sud)', `${s.aspect}°`],
                    ['Ressource solaire', 'Pertes du système', `${e.perte_systeme} %`],
                    ['Hydraulique', 'Type de pompage', surface ? 'Pompe de surface' : 'Forage / puits profond'],
                    ['Hydraulique', surface ? "Hauteur d'aspiration" : 'Profondeur niveau dynamique', `${e.h_aspiration} m`],
                    ['Hydraulique', 'Hauteur de refoulement', `${e.h_tank} m`],
                    ['Hydraulique', 'Besoin journalier', `${e.daily_need} m³/j`],
                    ['Hydraulique', 'Pertes de charge', `${e.losses_pipe} %`],
                    ['Hydraulique', 'Rendement global moteur + pompe', `${e.pump_efficiency} (${fr(Number(e.pump_efficiency) * 100, 0)} %)`],
                    ['Installation envisagée', 'Puissance PV installée', installe > 0 ? `${installe} kWc` : 'Non renseignée'],
                    ['Installation envisagée', 'Coefficient de surdimensionnement', e.coef_surdimensionnement || '1.1'],
                ], sysRapport === 'batteries' ? [] : [['Installation envisagée', 'Coefficient de réduction', e.coef_reduction_pomp]],
                sysRapport !== 'groupe' ? [] : [
                    ['Installation envisagée', "Conso. spécifique du groupe d'appoint", `${e.conso_specifique_ge} L/kWh`],
                    ['Installation envisagée', "Facteur d'émission du groupe", `${e.facteur_emission_co2} kgCO2/kWh`],
                ]), { columnStyles: { 0: { cellWidth: 42, textColor: PDF.gris } } });

                section('Résultats du dimensionnement');
                const lignesRes = [
                    ['Hauteur manométrique totale (HMT)', `${r.hmt.toFixed(2)} m`],
                    ['Hauteur géométrique', `${r.h_geo.toFixed(2)} m`],
                    ['Puissance PV nécessaire', `${(r.req_pv_w / 1000).toFixed(2)} kWc (pire mois : ${r.worst_month_rad.toFixed(2)} kWh/m²/j)`],
                    ['Débit moyen (6 h de pompage utile)', `${r.debit_moyen_m3h.toFixed(2)} m³/h`],
                    ['Puissance de la pompe', `${r.pump_power_w.toFixed(0)} W · ${r.pump_power_kw.toFixed(2)} kW · ${r.pump_power_cv.toFixed(2)} CV`],
                    ['Énergie de pompage', `${r.energy_pumping_mwh_yr.toFixed(2)} MWh/an`],
                    ['Énergie solaire fournie', `${r.energy_solar_mwh_yr.toFixed(2)} MWh/an`],
                    ['Taux de couverture (Théorique)', `${r.solar_coverage.toFixed(2)} %`],
                ];
                if (r.energy_solar_design_mwh_yr > 0) {
                    lignesRes.push(['Énergie solaire (installation envisagée)', `${r.energy_solar_design_mwh_yr.toFixed(2)} MWh/an`]);
                    lignesRes.push(['Taux de couverture (installation envisagée)', `${r.solar_coverage_design.toFixed(2)} %`]);
                }
                lignesRes.push(
                    ['Irradiation annuelle', `${r.total_annual_irradiation.toFixed(2)} kWh/m²/an`],
                    ["Besoin d'eau annuel", `${fr(r.annual_water_need_m3, 0)} m³/an`],
                    ...(r.systeme && r.systeme !== 'groupe' ? [] : [
                        ['Carburant économisé', `${fr(r.fuel_savings_liters, 0)} L/an`],
                        ['CO2 évité', `${r.co2_avoided_tonnes.toFixed(2)} t/an`],
                    ]),
                    ...lignesResultatsSysteme(r),
                );
                y = tableau(doc, y, ['Indicateur', 'Valeur'], lignesRes, {
                    columnStyles: { 0: { cellWidth: 75 }, 1: { fontStyle: 'bold' } },
                    didParseCell: (d) => { if (d.section === 'body' && d.row.index === 0) d.cell.styles.fillColor = [239, 246, 255]; },
                });

                // Mise en page fixe : p.2 données + résultats, p.3 pompe + ensoleillement,
                // p.4 bilan hydraulique + rapport technique et recommandations.
                doc.addPage();
                y = PDF.haut + 6;
                section('Pompe retenue');
                const pompe = pompeCatalogueChoisie();
                if (pompe && courbesPompe(pompe)) {
                    const note = noteDimensionnement(pompe);
                    const plage = window.PompageSolaireCalculs.plagePompe(courbesPompe(pompe).courbes);
                    const eType = ecartType(pompe, s.typePompe);
                    const adequation = [eType].concat(note && !note.ev.faisable ? [motifNonFaisable(note.ev)] : []).filter(Boolean);
                    y = tableau(doc, y, ['Caractéristique', 'Valeur'], [
                        ['Pompe', libelleChoixPompe()],
                        ["Type d'installation", pompe.type_installation || '—'],
                        ['Technologie hydraulique', pompe.technologie_hydraulique || '—'],
                        ['Moteur', pompe.moteur || '—'],
                        ['Plage de fonctionnement', `HMT ${fr(plage.hmt_min_m, 0)} à ${fr(plage.hmt_max_m, 0)} m ; débit jusqu'à ${fr(plage.debit_max_m3h, 2)} m³/h ; P1 ${fr(plage.p1_demarrage_min_w, 0)} à ${fr(plage.p1_max_w, 0)} W`],
                        ["Tension d'entrée solaire", pompe.tension_entree_solaire || '—'],
                        ['Diamètre de forage minimal', pompe.diametre_forage_min || '—'],
                        ['Code article', pompe.code_article || '—'],
                        ['Adéquation au dimensionnement', adequation.length ? `À vérifier : ${adequation.join(' ; ')}` : 'Compatible (courbes de performance)'],
                    ], { columnStyles: { 0: { cellWidth: 55, textColor: PDF.gris } } });
                    if (Array.isArray(pompe.applications) && pompe.applications.length) {
                        y = sousTitre(doc, y, 'Applications compatibles');
                        y = paragraphe(doc, y + 2, pompe.applications.map((a) => `- ${a}`).join('\n'), 8.8);
                    }
                    if (note) {
                        y = sousTitre(doc, y, `Note de dimensionnement — ${note.titre}`);
                        y += 2;
                        note.avert.forEach((a) => { y = paragraphe(doc, y, `Attention : ${a}`, 9); });
                        note.paragraphes.forEach((t) => { y = paragraphe(doc, y, t, 9); });
                        if (note.lignes.length) y = tableau(doc, y, ENTETE_NOTE, note.lignes, { styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.3, textColor: PDF.fonce, lineColor: PDF.bordure, lineWidth: 0.2, halign: 'center' } });
                    }
                    y = imageGraphique(doc, y, configCourbesPompe(pompe, note), 'Courbes de performance : débit Q (m³/h) selon la puissance absorbée P1 (W), par hauteur');
                    doc.addPage();
                    y = PDF.haut + 6;
                } else if (pompe) {
                    const ecarts = ecartsPompe(pompe, r, s.typePompe);
                    y = tableau(doc, y, ['Caractéristique', 'Valeur'], [
                        ['Fabricant', pompe.fabricant],
                        ['Référence', pompe.reference],
                        ["Type d'installation", pompe.type_installation || '—'],
                        ['Technologie hydraulique', pompe.technologie_hydraulique || '—'],
                        ['Puissance', pompe.puissance_kw !== null && pompe.puissance_kw !== undefined ? `${pompe.puissance_kw} kW` : '—'],
                        ['HMT maximale', pompe.hmt_max_m !== null && pompe.hmt_max_m !== undefined ? `${pompe.hmt_max_m} m` : '—'],
                        ['Débit', pompe.debit_nominal_m3h ? `${pompe.debit_nominal_m3h} m³/h` : '—'],
                        ['Adéquation au dimensionnement', ecarts.length ? `À vérifier : ${ecarts.join(' ; ')}` : 'Compatible (type, HMT et débit)'],
                    ], { columnStyles: { 0: { cellWidth: 60, textColor: PDF.gris } } });
                } else if (val('ps_pompe_choix') === CHOIX_PERSONNALISE) {
                    y = paragraphe(doc, y, `Référence personnalisée saisie par l'utilisateur : ${String(val('ps_reference_pompe_installee')).trim()}. `
                        + `Vérifier auprès du fabricant qu'elle couvre une HMT d'au moins ${r.hmt.toFixed(1)} m et un débit moyen de ${r.debit_moyen_m3h.toFixed(2)} m³/h.`);
                } else {
                    y = paragraphe(doc, y, `Fabricant par défaut : aucune pompe imposée. Le dimensionnement définit le cahier des charges de la pompe : `
                        + `HMT d'au moins ${r.hmt.toFixed(1)} m, débit moyen de ${r.debit_moyen_m3h.toFixed(2)} m³/h, puissance hydraulique d'environ ${r.pump_power_kw.toFixed(2)} kW, `
                        + `${surface ? 'pompe de surface' : 'pompe immergée pour forage'}.`);
                }

                section('Graphiques');
                y = imageGraphique(doc, y, { type: 'bar', data: donneesGraphique('irradiation', r, false), options: optionsGraphique('kWh / m² / jour', false) }, 'Ensoleillement moyen par mois (kWh/m²/jour)');
                doc.addPage();
                y = PDF.haut + 6;
                y = imageGraphique(doc, y, { type: 'bar', data: donneesGraphique('eau', r, false), options: optionsGraphique('Volume (m³)', false) }, 'Bilan hydraulique mensuel : besoin, volume pompé, déficit (m³)');

                section('Rapport technique et recommandations');
                y = paragraphe(doc, y, texteRapport(r, false));
                y = sousTitre(doc, y + 1, 'Recommandations');
                y += 3;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9.5);
                (r.recommendations || []).forEach((rec) => {
                    const lignes = doc.splitTextToSize(pdfTexte(rec), PDF.largeur - 6);
                    y = assurerPlace(doc, y, lignes.length * 4.8 + 1);
                    doc.setFillColor(...PDF.rouge);
                    doc.circle(PDF.marge + 1.2, y - 1.2, 0.8, 'F');
                    doc.setTextColor(...PDF.fonce);
                    doc.text(lignes, PDF.marge + 5, y);
                    y += lignes.length * 4.8 + 1;
                });

                const production = s.production;
                if (production) {
                    doc.addPage();
                    y = PDF.haut + 6;
                    section('Calepinage et production réelle');
                    y = paragraphe(doc, y, 'Production calculée par le module Production solaire à partir du calepinage de la carte, '
                        + "de l'ombrage proche de la scène 3D, des pertes système et de l'onduleur. La production solaire "
                        + "alimente la pompe : les volumes pompés et le taux de couverture de l'installation en découlent.", 9);
                    y = tableau(doc, y, ['Résultat réel', 'Valeur'], lignesProductionReelle(production), { columnStyles: { 0: { cellWidth: 80 } } });
                    const champsProd = lignesChampsProduction(production);
                    if (champsProd.length) y = tableau(doc, y, ENTETE_CHAMPS_PROD, champsProd);
                    const captures = await capturesCalepinage();
                    if (captures.length) captures.forEach((img) => { y = imageCapture(doc, y, img); });
                    else y = paragraphe(doc, y, 'Captures du calepinage indisponibles (calepinage non chargé dans la page).', 9);
                }

                if (dernierEco) {
                    const eco = dernierEco.resultat;
                    const p = dernierEco.params;
                    const sym = DEVISES[dernierEco.devise];
                    const graphiquesPdf = configsEco(eco, sym);
                    doc.addPage();
                    y = PDF.haut + 6;
                    section('Analyse économique');
                    y = paragraphe(doc, y, eco.systeme && eco.systeme !== 'groupe'
                        ? descriptionEco(eco.systeme)
                        : `Comparaison sur ${eco.duree_ans} ans du pompage solaire et du pompage par groupe électrogène seul. `
                            + `Avec le solaire, le groupe ne pompe plus que le déficit (${fr(eco.part_residuelle_ge_pct, 1)} % du besoin) : `
                            + "son Opex et son remplacement sont proratisés sur cette part. Côté solaire, l'Opex de la centrale est indexé "
                            + `et l'onduleur / contrôleur de pompe est remplacé l'année ${eco.annee_remplacement_onduleur}.`, 9);
                    y = sousTitre(doc, y, 'Hypothèses');
                    y = tableau(doc, y + 1, ['Hypothèse', 'Valeur'], [
                        ['Devise', `${sym} (${dernierEco.devise})`],
                        ['Capex (centrale photovoltaïque + pompe)', monnaie(p.capex, sym)],
                        ['Opex de la centrale photovoltaïque', `${monnaie(p.opex_pv, sym)} /an`],
                        ["Indexation de l'Opex solaire", `${fr(p.indexation_opex_pv, 1)} %/an`],
                        [`Remplacement onduleur / contrôleur de pompe (année ${eco.annee_remplacement_onduleur})`, monnaie(p.remplacement_onduleur, sym)],
                        ...(eco.systeme === 'batteries' ? [
                            ['Capex des batteries', monnaie(eco.capex_batterie, sym)],
                            [`Remplacement des batteries (tous les ${p.duree_vie_batterie} ans${(eco.annees_remplacement_batterie || []).length ? ` : années ${eco.annees_remplacement_batterie.join(', ')}` : ''})`, monnaie(p.remplacement_batterie, sym)],
                        ] : []),
                        ...(sansGroupe(eco) ? [] : [
                            ['Opex du groupe électrogène', `${monnaie(p.opex_ge, sym)} /an`],
                            [`Remplacement du groupe électrogène (année ${eco.annee_remplacement_ge})`, monnaie(p.remplacement_ge, sym)],
                            ['Prix du carburant', `${fr(p.prix_carburant, 2)} ${sym}/L`],
                            ['Inflation du carburant', `${fr(p.inflation_carburant, 1)} %/an`],
                        ]),
                        ['Évolution annuelle des besoins en eau', `x ${fr(eco.evolution_besoins || 1, 2)} par an dès l'année 2`],
                        ['Dégradation des panneaux', `${fr(eco.degradation_pv_pct || 0, 2)} %/an`],
                        ["Taux d'actualisation", `${fr(p.taux_actualisation, 1)} %`],
                        ["Durée d'analyse", `${eco.duree_ans} ans`],
                    ], { columnStyles: { 0: { cellWidth: 95 } } });
                    const titresPdf = titresEco(eco);
                    y = sousTitre(doc, y, titresPdf.indicateurs);
                    y = tableau(doc, y + 1, ['Indicateur', 'Valeur'], indicateursEco(eco, sym).map((c) => [c.detail ? `${c.titre} (${c.detail})` : c.titre, c.valeur])
                        .concat(sansGroupe(eco) ? [] : [[`Carburant économisé sur ${eco.duree_ans} ans`, `${fr(eco.carburant_economise_total_l, 0)} L`]]),
                    { columnStyles: { 0: { cellWidth: 95 }, 1: { fontStyle: 'bold' } } });
                    y = sousTitre(doc, y, titresPdf.postes);
                    const postes = lignesPostes(eco, p, r, sym);
                    y = tableau(doc, y + 1, entetePostes(eco), postes, {
                        didParseCell: (d) => { if (d.section === 'body' && d.row.index >= postes.length - 2) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [238, 242, 255]; } },
                    });
                    y = sousTitre(doc, y, titresPdf.annuel);
                    const colonnesAn = colonnesAnnuelles(eco, sym);
                    y = tableau(doc, y + 1, colonnesAn.map((c) => c.titre), eco.tableau.map((l) => colonnesAn.map((c) => c.valeur(l))), {
                        styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.4, textColor: PDF.fonce, lineColor: PDF.bordure, lineWidth: 0.2, halign: 'center', valign: 'middle' },
                    });
                    y = imageGraphique(doc, y, graphiquesPdf.cumul, titresPdf.cumul);
                    y = imageGraphique(doc, y, graphiquesPdf.couts, titresPdf.couts);
                    y = imageGraphique(doc, y, graphiquesPdf.fcf, titresPdf.fcf);
                }

                if (dernierPlan) {
                    doc.addPage();
                    y = PDF.haut + 6;
                    section("Plan d'affaires : vente d'eau");
                    y = ecrirePlanPdf(doc, y, (yy, t) => sousTitre(doc, yy, t));
                }
            }

            const nbPagesPompage = doc.internal.getNumberOfPages();

            // Pages de Calepinage (si disponibles dans l'environnement parent) : rapport complet seul.
            if (mode === 'complet') try {
                const parentWindow = (window.parent && window.parent !== window) ? window.parent : window;
                const calepIframe = parentWindow.document.querySelector('#calepinage iframe');
                if (calepIframe && calepIframe.contentWindow && calepIframe.contentWindow.CalepinagePDF) {
                    await calepIframe.contentWindow.CalepinagePDF.exportCalepinagePDF({ doc: doc, autoSave: false });
                }
            } catch (err) {
                // Calepinage optionnel non présent
            }

            // En-tête (hors page de garde et pages de calepinage) et pied de page.
            const nbPages = doc.internal.getNumberOfPages();
            for (let i = 1; i <= nbPages; i++) {
                doc.setPage(i);
                if (i > 1 && i <= nbPagesPompage) {
                    doc.setFillColor(...PDF.fonce);
                    doc.rect(0, 0, 210, 13, 'F');
                    doc.setFillColor(...PDF.rouge);
                    doc.rect(0, 13, 210, 0.8, 'F');
                    doc.setTextColor(255, 255, 255);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(9);
                    doc.text(pdfTexte(mode === 'plan' ? "Pompage solaire — Plan d'affaires (vente d'eau)" : 'Pompage solaire — Rapport de prédimensionnement'), PDF.marge, 8.5);
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.text(pdfTexte(doc.splitTextToSize(pdfTexte(s.site), 80)[0] || ''), 195, 8.5, { align: 'right' });
                }
                if (i > 1) {
                    doc.setDrawColor(...PDF.bordure);
                    doc.setLineWidth(0.3);
                    doc.line(PDF.marge, 284, 195, 284);
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(156, 163, 175);
                    const pied = mode === 'plan' ? "Solakvan BET Solar — Plan d'affaires Pompage Solaire" : 'Solakvan BET Solar — Dimensionnement Pompage Solaire';
                    doc.text(pdfTexte(variante ? `${pied} — Variante ${variante}` : pied), PDF.marge, 289);
                    doc.text(`Page ${i} / ${nbPages}`, 195, 289, { align: 'right' });
                }
            }

            const prefixe = mode === 'plan' ? 'Plan_Affaires_Pompage_Solaire' : 'Dimensionnement_Pompage_Solaire';
            const suffixe = variante ? `_${variante}` : '';
            apercuPDF(doc, `${prefixe}${suffixe}_${new Date().toISOString().split('T')[0]}.pdf`);
            message("Rapport PDF généré : vérifiez-le dans l'aperçu avant de le télécharger.", 'info');
        } catch (err) {
            console.error('Erreur génération PDF:', err);
            message('Erreur lors de la génération du PDF : ' + err.message, 'error');
        }
    }

    // ---------------------------------------------------------------------------------------
    // Construction différée + câblage
    // ---------------------------------------------------------------------------------------

    function cabler() {
        const surEvenement = (id, evts, fn) => { const el = $(id); if (el) evts.forEach((ev) => el.addEventListener(ev, fn)); };

        ['ps_h_aspiration', 'ps_h_tank'].forEach((id) => surEvenement(id, ['input'], majHauteurGeometrique));
        toutesReglesFormulaire().concat(REGLES_ECO).forEach((r) => surEvenement(r.id, ['input', 'change'], majEtatValidation));
        // Même type recliqué : rien (la hauteur d'aspiration saisie n'est pas remise à sa valeur par défaut).
        document.querySelectorAll('.ps-type-pompe-btn').forEach((btn) => btn.addEventListener('click', () => {
            if (btn.dataset.type !== val('ps_pump_type')) changerTypePompe(btn.dataset.type);
        }));

        document.querySelectorAll('input[name="ps_systeme_choix"]').forEach((radio) => radio.addEventListener('change', () => {
            if (radio.checked) changerSysteme(radio.value);
        }));
        surEvenement('ps_btn_circuit', ['click'], ouvrirCircuit);
        surEvenement('ps_btn_close_circuit', ['click'], fermerCircuit);
        const modalCircuit = $('ps_circuit_modal');
        if (modalCircuit) modalCircuit.addEventListener('click', (e) => { if (e.target === modalCircuit) fermerCircuit(); });

        surEvenement('ps_btn_pompe_toggle', ['click'], () => afficherChoixPompe($('ps_pompe_card').style.display === 'none'));
        surEvenement('ps_btn_pertes', ['click'], () => {
            const bloc = $('ps_pertes_calculatrice');
            const ouvert = bloc.style.display !== 'none';
            bloc.style.display = ouvert ? 'none' : 'block';
            if (!ouvert) majCalculatricePertes();
            else majEtatValidation();
        });
        ['ps_m_material'].concat(REGLES_CALCULATRICE.map((r) => r.id))
            .forEach((id) => surEvenement(id, ['input', 'change'], majCalculatricePertes));
        surEvenement('ps_btn_apply_losses', ['click'], reporterPertes);

        surEvenement('ps_btn_calculate', ['click'], () => dimensionner());
        surEvenement('ps_btn_dim_elec', ['click'], ouvrirDimensionnementChaines);
        surEvenement('ps_btn_extrait_calepinage', ['click'], ouvrirExtraitCalepinage);
        surEvenement('ps_integration_calepinage', ['change'], () => {
            majPuissanceCalepinage();
            if (!integrationDemandee()) { derniereProduction = null; const c = $('ps_prod_card'); if (c) c.style.display = 'none'; }
            synchroniserParametresCalepinage();
            majEtatValidation();
            sauvegarder();
        });
        // Inclinaison / pertes : gardées pour le projet dès la frappe (champs PV dessinés ensuite),
        // reportées dans les champs PV existants à la validation de la saisie.
        Object.keys(PARAMETRES_CALEPINAGE).forEach((id) => {
            surEvenement(id, ['input'], () => memoriserParametresCalepinage(id));
            surEvenement(id, ['change'], () => envoyerParametreCalepinage(id));
        });
        surEvenement('ps_btn_eco_calculate', ['click'], () => dimensionner({ economie: true }));
        const idsSaisies = REGLES.map((r) => r.id).concat(['ps_pump_type', 'ps_integration_calepinage'],
            REGLES_ECO.map((r) => r.id), REGLES_PLAN.map((r) => r.id), IDS_PLAN_HORS_REGLES);
        toutesRegles().forEach((r) => {
            const el = $(r.id);
            if (el) el.addEventListener('input', () => limiterSaisie(el));
        });
        memoriserSaisies();
        idsSaisies.forEach((id) => surEvenement(id, ['input', 'change'], () => invaliderResultats(id)));
        REGLES_PLAN.forEach((r) => surEvenement(r.id, ['input', 'change'], majEtatValidation));
        ['ps_eco_prix_carburant', 'ps_eco_inflation', 'ps_eco_capex', 'ps_eco_evolution_besoins', 'ps_eco_degradation_pv', 'ps_pa_emprunt',
            'ps_eco_capex_batterie', 'ps_eco_remplacement_batterie', 'ps_eco_duree_vie_batterie']
            .forEach((id) => surEvenement(id, ['input', 'change'], majBlocPlan));
        ['ps_pa_impots', 'ps_pa_valeur_residuelle', 'ps_pa_methode_amortissement']
            .forEach((id) => surEvenement(id, ['change'], () => { majBlocPlan(); majEtatValidation(); }));
        surEvenement('ps_btn_pa_repartir', ['click'], repartirLots);
        surEvenement('ps_btn_pa_calculate', ['click'], () => calculerPlan());
        document.querySelectorAll('.ps-devise-btn').forEach((b) => b.addEventListener('click', () => choisirDevise(b.dataset.devise)));

        surEvenement('ps_pompe_filtre_fabricant', ['change'], afficherPompes);
        surEvenement('ps_pompe_filtre_reco', ['change'], afficherPompes);
        surEvenement('ps_pompe_choix', ['change'], () => {
            choixPompeRestaure = '';
            // Montage conseillé par le dernier dimensionnement (pompe seule ★ ou à plusieurs ◆).
            const conseil = montageConseille[val('ps_pompe_choix')];
            if (conseil) {
                $('ps_pompe_montage').value = conseil.montage;
                if (conseil.nombre > 1) $('ps_pompe_nombre').value = conseil.nombre;
            }
            majChoixPompe();
            sauvegarder();
        });
        surEvenement('ps_pompe_montage', ['change'], majChoixPompe);
        surEvenement('ps_pompe_nombre', ['change'], majChoixPompe);
        surEvenement('ps_reference_pompe_installee', ['input'], function () {
            const propre = this.value.replace(CARACTERES_INTERDITS_REFERENCE, '').slice(0, 30);
            if (propre !== this.value) this.value = propre;
            majEtatValidation();
        });

        CHAMPS_PERSISTES.forEach((id) => surEvenement(id, ['change'], sauvegarder));
        surEvenement('ps_coef_surdimensionnement', ['change'], ecrireCoefSurdimLocal);

        surEvenement('ps_btn_close_zoom', ['click'], fermerZoom);
        const modalZoom = $('ps_chart_zoom_modal');
        if (modalZoom) modalZoom.addEventListener('click', (e) => { if (e.target === modalZoom) fermerZoom(); });
        document.querySelectorAll('.ps-btn-zoom').forEach((btn) => btn.addEventListener('click', () => ouvrirZoom(btn.dataset.chart)));

        if (!ecouteursGlobaux) {
            ecouteursGlobaux = true;
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { fermerZoom(); fermerCircuit(); }
            });
            // Saisies encore en attente d'envoi quand la modale / la page se ferme.
            window.addEventListener('pagehide', () => { if (minuterieSauvegarde) envoyerSauvegarde(true); });
            // Pente / pertes saisies dans le calepinage résidentiel (page principale) pendant que
            // cette modale est chargée : reprises ici. Écouteur retiré avec l'iframe.
            const P = pageProjet();
            if (P) {
                const surParametres = () => synchroniserParametresCalepinage();
                P.document.addEventListener('calepinageParametresPompageChanged', surParametres);
                P.document.addEventListener('calepinageExtraitPompageFerme', apresExtraitCalepinage);
                window.addEventListener('pagehide', () => {
                    try {
                        P.document.removeEventListener('calepinageParametresPompageChanged', surParametres);
                        P.document.removeEventListener('calepinageExtraitPompageFerme', apresExtraitCalepinage);
                    } catch (e) { /* noop */ }
                });
            }
        }
    }

    /**
     * Construit la section si ce n'est pas déjà fait, puis remet l'adresse du projet à jour (elle
     * peut avoir changé depuis la dernière ouverture). Appelée par le bouton de menu.
     */
    function ouvrir() {
        const hote = $('pompage-section-content');
        if (!hote) return false;
        try {
            // Données rattachées au projet : un changement de projet reconstruit la section.
            const projetId = projetActifId();
            if (construit && projetId !== projetCharge) reinitialiser();
            if (!construit) {
                hote.innerHTML = balisage();
                restaurer(null);
                cabler();
                majAffichageSysteme();
                majLibelleTypePompe();
                majHauteurGeometrique();
                majChoixPompe();
                majDevise();
                majBlocPlan();
                construit = true;
                chargerDepuisBase(projetId);
            }
            appliquerAdresseProjet();
            // Le calepinage peut avoir changé depuis la dernière ouverture : résultats périmés effacés.
            majPuissanceCalepinage();
            verifierCalepinageInchange();
            synchroniserParametresCalepinage();
            majEtatValidation();
            return true;
        } catch (err) {
            console.error('[PompageSolaire] Erreur dans ouvrir():', err);
            return false;
        }
    }

    // Palette « Exports » de la page principale (pompage_solaire_exports.js) : rapports générés ici,
    // plans du calepinage et du câblage produits par la page principale elle-même.
    const API_EXPORTS = {
        rapport: () => genererPDF(),
        planAffaires: () => genererPDF({ mode: 'plan' }),
        message: (texte, type, duree) => message(texte, type, duree),
        /** Rapports exportables : dimensionnement à jour (et plan d'affaires calculé pour le second). */
        etat: () => {
            const dimensionne = !!(dernierResultat && dernierInstantane);
            return { rapport: dimensionne, planAffaires: dimensionne && !!dernierPlan };
        },
    };

    function paletteExports() {
        const P = pageProjet();
        try { return P && P.PompageSolaireExports ? P.PompageSolaireExports : null; } catch (e) { return null; }
    }

    /** Onglet Pompage solaire affiché (true) ou quitté (false) dans le menu de la modale. */
    function signalerAffichage(visible) {
        const palette = paletteExports();
        if (!palette) return;
        if (visible) palette.activer(API_EXPORTS);
        else palette.desactiver(API_EXPORTS);
    }
    // Modale fermée ou rechargée : la palette ne doit plus appeler cette iframe.
    window.addEventListener('pagehide', () => signalerAffichage(false));

    window.PompageSolaireSection = { ouvrir, signalerAffichage };
})();
