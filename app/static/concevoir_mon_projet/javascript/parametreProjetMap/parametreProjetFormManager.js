import { deleteFileFromIDB, getIDBEntriesByPrefix } from '../prodsolaire/persistence.js';

// Site autonome : valeur enregistrée de la typologie du système « Alimentation en électricité », et
// profil consommateur qui donne la typologie Résidentielle (cf. parametre.html).
const TYPOLOGIE_SYSTEME_ALIMENTATION = 'Habitation';
const PROFIL_HABITATION = 'Habitation';

// CORRECTIF (bug rapporté : "un nouveau projet hérite des courbes de charge importées dans
// Consommation d'énergie/Résultats — bug dans l'IndexedDB") : le bloc de purge déjà existant à la
// création d'un projet (cf. son appel dans submitParametreProjet() plus bas) ne vidait QUE
// localStorage/sessionStorage — jamais l'IndexedDB (base 'AutoconsoFilesDB', cf. prodsolaire/
// persistence.js), où vit le fichier de consommation importé (clé globale, fixe, 'consFile' — ainsi
// que 'pvFile' et les entrées 'accFile_*' du mode ACC) : un nouveau projet lisait donc exactement le
// même enregistrement que l'ancien. Extrait en une fonction nommée et réutilisable (au lieu d'un
// bloc inline dupliqué/oublié) : même liste localStorage/sessionStorage qu'avant, complétée des 3
// suppressions IndexedDB manquantes.
// Loi APER : saisies enregistrées en base (aper_configs / aper_polygones, relues à l'ouverture du
// projet). Anciennes clés locales purgées ; polygones et variables du projet affiché retirés de la
// carte et de la mémoire du calculateur (calcul_APER.js), qui n'enregistre plus rien avant d'avoir
// relu en base les saisies du projet qui s'ouvre.
export function purgerLoiAperLocale() {
    ['aperPolygonsData', 'solarProjectStable'].forEach((k) => localStorage.removeItem(k));
    const aper = window.calculateurAPERInstance;
    if (aper && typeof aper.viderProjet === 'function') aper.viderProjet();
}

export async function clearAllProjectLocalState() {
    // IMPORTANT : Vider le localStorage de calepinage pour que le nouveau projet soit vide
    console.log('🗑️ Vidage du localStorage solarProjectData pour créer un projet vide...');
    localStorage.removeItem('solarProjectData');
    localStorage.removeItem('solarProjectData_owner_id');
    sessionStorage.removeItem('activeAutoconsoRate');
    localStorage.removeItem('solar_sim_data');
    localStorage.removeItem('solar_storage_data');
    localStorage.removeItem('sharedIrveData');
    localStorage.removeItem('stagedIrveData');
    // Session complète du modal IRVE (matériels, bornes, bilan de puissance, planification, courbe
    // de charge saisie/importée — cf. IrveStorageManager.js).
    localStorage.removeItem('skv_irve_session_data');
    // Saisie/choix des modals de géométrie (ombrières métal/bois/solumbra, bâtiment métal — cf.
    // storage_manager_geometrie_structure.js).
    // Réglages rangés PAR PROJET (clé skv_geometrie_structure_data:<projet>) : un nouveau projet
    // n'en hérite plus ; seuls ceux saisis sans projet actif sont purgés. Ceux des autres projets,
    // l'ancienne clé commune (reprise à la 1re ouverture) et les copies orphelines sont conservés.
    localStorage.removeItem('skv_geometrie_structure_data:sans_projet');
    localStorage.removeItem('sharedSolarProduction');
    localStorage.removeItem('geometriePlansData');
    // Empreintes/paramètres de calcul du module prodsolaire (propres à chaque projet).
    localStorage.removeItem('solar_sim_pv_signature');
    localStorage.removeItem('solar_sim_signature');
    localStorage.removeItem('vente_totalite_options');
    localStorage.removeItem('sharedDegradationRate');
    localStorage.removeItem('economicParamsACC');
    localStorage.removeItem('advancedEconomicParams');
    localStorage.removeItem('studyType');
    // Clé de repli 'default' utilisée tant qu'un projet n'a pas encore d'ID réel.
    localStorage.removeItem('irve_status_default');
    localStorage.removeItem('val_status_default');
    sessionStorage.removeItem('seasonalAutoconsoShares');
    // Calepinage maison individuelle — un nouveau projet ne doit pas non plus hériter des
    // maisons/champs PV du projet précédent.
    localStorage.removeItem('calepinage_maison_v1');
    localStorage.removeItem('calepinage_maison_polygons_v1');
    localStorage.removeItem('calepinage_maison_owner_id');
    // Système hybride (modale de consommation) : saisies et courbe importée du projet précédent.
    Object.keys(localStorage).filter((k) => k.startsWith('skv_systeme_hybride_')).forEach((k) => localStorage.removeItem(k));
    // PAC / climatiseur (modale de consommation) : saisies conservées dans le navigateur, purgées à
    // la création d'un projet (clés skv_pac_<utilisateur>_<projet>, cf. pac_section.js).
    Object.keys(localStorage).filter((k) => k.startsWith('skv_pac_')).forEach((k) => localStorage.removeItem(k));
    // Pompage solaire : saisies et résultats enregistrés en base par projet (pompage_solaire_configs) ;
    // anciennes clés globales (partagées par tous les projets) et toute clé future du module purgées.
    ['solarPumpData', 'solarPumpIntegrationCalepinage'].forEach((k) => localStorage.removeItem(k));
    Object.keys(localStorage).filter((k) => k.startsWith('skv_pompage_')).forEach((k) => localStorage.removeItem(k));
    purgerLoiAperLocale();

    // NOUVEAU : purge IndexedDB — la vraie cause de la fuite rapportée. 'consFile'/'pvFile' sont des
    // clés globales fixes (import manuel de consommation/production PV) ; 'accFile_*' regroupe les
    // fichiers du mode ACC (un par centrale/consommateur, cf. main_acc.js), retirés un par un.
    try {
        await deleteFileFromIDB('consFile');
        await deleteFileFromIDB('pvFile');
        const accEntries = await getIDBEntriesByPrefix('accFile_');
        await Promise.all(accEntries.map((entry) => deleteFileFromIDB(entry.key)));
    } catch (e) {
        console.warn('Purge IndexedDB (nouveau projet) partiellement échouée :', e);
    }
}

/**
 * Caches navigateur de l'état de conception, vidés au changement de VARIANTE (même projet) : ils
 * portent l'id du projet, identique pour toutes ses variantes, et seraient donc repris (puis
 * réenregistrés en base par les sauvegardes automatiques) sur la variante qu'on vient d'ouvrir.
 * Tous se rechargent depuis la base au chargement de la page de calepinage. La consommation
 * (fichiers importés, IndexedDB) est commune aux variantes : conservée.
 */
export function purgerCachesLocauxVariante(projetId) {
    const id = String(projetId);
    [
        'solarProjectData', 'solarProjectData_owner_id',
        'solar_sim_data', 'solar_storage_data', 'solar_sim_signature', 'solar_sim_pv_signature',
        'sharedSolarProduction', 'geometriePlansData',
        'calepinage_maison_v1', 'calepinage_maison_polygons_v1', 'calepinage_maison_owner_id',
        `skv_geometrie_structure_data:${id}`, `skv_irve_session_data_${id}`,
    ].forEach((cle) => localStorage.removeItem(cle));
    Object.keys(localStorage).filter((k) => k.startsWith('skv_systeme_hybride_')).forEach((k) => localStorage.removeItem(k));
    sessionStorage.removeItem('activeAutoconsoRate');
    sessionStorage.removeItem('seasonalAutoconsoShares');
    purgerLoiAperLocale();
}

/**
 * Changement de projet (demande 2026-10-18) : caches locaux du projet quitté oubliés, enregistré
 * ou non — seule sa dernière version en base est conservée (services/version_projet.js, section 3).
 */
function oublierCachesProjetQuitte(projetId) {
    if (!projetId) return;
    if (window.SkvVersionProjet && typeof window.SkvVersionProjet.oublierCachesProjet === 'function') {
        window.SkvVersionProjet.oublierCachesProjet(projetId);
    } else {
        purgerCachesLocauxVariante(projetId);
    }
}

export class DataManager {
    constructor() {
        this.selectedProjectType = null;
        this.selectedValorisationMode = null;
        this.selectedStudyType = null;
        this.formSubmissionsSetup = false; // Flag pour éviter la duplication des event listeners
        this.isSubmitting = false; // Flag pour empêcher les doubles soumissions de paramètres projet
        this.isSubmittingNorme = false; // Flag pour empêcher les doubles soumissions de normes
        // Formulaire « Paramètres du projet » modifié par l'utilisateur depuis son ouverture en
        // modification (cf. setupSuiviParametres, services/sauvegarde_projet.js).
        this.parametresModifies = false;
        this.init();
    }

    init() {
        console.log("💾 DataManager initialisé");
        this.setupDataHandlers();
        this.setupFormSubmissions();
        this.setupRealTimeValidation();
        this.setupSuiviParametres();

        // Initialiser la gestion des projets
        this.injectIndiceBadgeStyles();
        this.loadProjects();
        // Variante enregistrée avant la génération du rapport (UIManager.enregistrerVariante,
        // ParametresProjet.js) : nouvelle pastille et variante active à jour sans recharger la page.
        document.addEventListener('varianteActiveChangee', () => {
            Promise.resolve(this.loadProjects()).catch(() => {});
        });
        this.setupSearchAndFilters();
        this.setupNormeSelector();
        console.log("Donnees du local storage au demarrage :", localStorage.getItem('solarProjectData'));
    }

    /**
     * Injecte le CSS de surlignage de l'indice actif (badge .indice-badge-active), indépendamment
     * de MesProjetsModal.js (qui définit la même règle mais uniquement quand sa modale a déjà été
     * ouverte au moins une fois) : ce tableau "Mes Projets" peut s'afficher avant tout premier
     * affichage de cette modale.
     */
    injectIndiceBadgeStyles() {
        if (document.getElementById('parametre-projet-indice-badge-styles')) return;
        const style = document.createElement('style');
        style.id = 'parametre-projet-indice-badge-styles';
        style.textContent = `
            .indice-badge-active {
                outline: 3px solid #22c55e;
                outline-offset: 1px;
                box-shadow: 0 0 6px rgba(34, 197, 94, 0.7);
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // GESTION DES PARAMÈTRES ET CONFIGURATION
    // ==========================================

    setupDataHandlers() {
        this.setupCountryHandler();
        this.setupClimateZones();
        this.setupProjectSelections();
    }

    setupCountryHandler() {
        const paysSelect = document.getElementById('pays');
        if (paysSelect) {
            paysSelect.addEventListener('change', (e) => {
                this.handleCountryChange(e.target.value);
            });
        }
    }

    handleCountryChange(pays) {
        // Reset values
        ['tension_photovoltaique', 'tension_soutirage', 'temperature_minimale',
            'temperature_maximale', 'ration_surdimensionnement', 'coefficient_performance'].forEach(id => {
                const field = document.getElementById(id);
                if (field) field.value = '';
            });

        if (pays === "France") {
            $('#climat_france').show();
            $('#climat_haiti').hide();
            $('#climat_autres').hide();
            this.setFieldValue('tension_photovoltaique', '3');
            this.setFieldValue('tension_soutirage', '8');
            this.setFieldValue('temperature_minimale', '-10');
            this.setFieldValue('temperature_maximale', '50');
            this.setFieldValue('ration_surdimensionnement', '0.80');
            this.setFieldValue('coefficient_performance', '0.25');
        } else if (pays === "Haïti") {
            $('#climat_france').hide();
            $('#climat_haiti').show();
            $('#climat_autres').hide();
            this.setFieldValue('tension_photovoltaique', '3');
            this.setFieldValue('tension_soutirage', '8');
            this.setFieldValue('temperature_minimale', '10');
            this.setFieldValue('temperature_maximale', '45');
            this.setFieldValue('ration_surdimensionnement', '0.75');
            this.setFieldValue('coefficient_performance', '0.25');
        } else {
            // Autres pays
            $('#climat_france').hide();
            $('#climat_haiti').hide();
            $('#climat_autres').show();
            // Valeurs par défaut pour les autres pays
            this.setFieldValue('tension_photovoltaique', '3');
            this.setFieldValue('tension_soutirage', '8');
            this.setFieldValue('temperature_minimale', '-10');
            this.setFieldValue('temperature_maximale', '50');
            this.setFieldValue('ration_surdimensionnement', '0.80');
            this.setFieldValue('coefficient_performance', '0.25');
        }

        $('#connecte-illustration').attr('src', '/static/concevoir_mon_projet/medias/img/whychoosus.jpg');
    }

    setupClimateZones() {
        // Zone de vent
        const ventZones = [
            { id: 'btn_zone_de_vent_1', value: '1', pays: 'France', img: 'zone-vent-1.png' },
            { id: 'btn_zone_de_vent_2', value: '2', pays: 'France', img: 'zone-vent-2.png' },
            { id: 'btn_zone_de_vent_3', value: '3', pays: 'France', img: 'zone-vent-3.png' },
            { id: 'btn_zone_de_vent_4', value: '4', pays: 'France', img: 'zone-vent-4.png' },
            { id: 'btn_zone_de_vent_h_1', value: '1', pays: 'Haïti', img: 'zone-de-vent-haiti.png' },
            { id: 'btn_zone_de_vent_h_2', value: '2', pays: 'Haïti', img: 'zone-de-vent-haiti.png' },
            { id: 'btn_zone_de_vent_h_3', value: '3', pays: 'Haïti', img: 'zone-de-vent-haiti.png' },
            { id: 'btn_zone_de_vent_h_4', value: '4', pays: 'Haïti', img: 'zone-de-vent-haiti.png' }
        ];

        ventZones.forEach(zone => {
            $(`#${zone.id}`).on('click', () => {
                if ($('#pays').val() !== zone.pays) return;
                this.setFieldValue('input_zone_de_vent', zone.value);
                this.updateButtonStates(zone.id, zone.pays === 'France' ?
                    ['btn_zone_de_vent_1', 'btn_zone_de_vent_2', 'btn_zone_de_vent_3', 'btn_zone_de_vent_4'] :
                    ['btn_zone_de_vent_h_1', 'btn_zone_de_vent_h_2', 'btn_zone_de_vent_h_3', 'btn_zone_de_vent_h_4']
                );
                $('#connecte-illustration').attr('src', `static/concevoir_mon_projet/medias/paramètres_Images/${zone.img}`);
            });
        });

        // Catégorie de terrain
        ['0', 'II', 'IIIa', 'IIIb', 'IV'].forEach(cat => {
            $(`#btn_categorie_terrain_${cat}`).on('click', () => {
                if ($('#pays').val() !== 'France') return;
                this.setFieldValue('input_categorie_de_terrain', cat);
                this.updateButtonStates(`btn_categorie_terrain_${cat}`,
                    ['btn_categorie_terrain_0', 'btn_categorie_terrain_II', 'btn_categorie_terrain_IIIa', 'btn_categorie_terrain_IIIb', 'btn_categorie_terrain_IV']
                );
                $('#connecte-illustration').attr('src', `/static/concevoir_mon_projet/medias/paramètres_Images/categorie-de-terrain-${cat}.png`);
            });
        });

        // Zone de neige
        ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'F'].forEach(zone => {
            $(`#btn_zone_de_neige_${zone}`).on('click', () => {
                if ($('#pays').val() !== 'France') return;
                this.setFieldValue('input_zone_de_neige', zone);
                this.updateButtonStates(`btn_zone_de_neige_${zone}`,
                    ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'F'].map(z => `btn_zone_de_neige_${z}`)
                );
                $('#connecte-illustration').attr('src', `/static/concevoir_mon_projet/medias/paramètres_Images/zone-de-neige-${zone}.png`);
            });
        });

        // Zone sismique France
        const sismiqueFrance = [
            { id: 'btn_zone_sismique_1', value: 'Très faible' },
            { id: 'btn_zone_sismique_2', value: 'Faible' },
            { id: 'btn_zone_sismique_3', value: 'Modérée' },
            { id: 'btn_zone_sismique_4', value: 'Moyenne' },
            { id: 'btn_zone_sismique_5', value: 'Forte' }
        ];

        sismiqueFrance.forEach(zone => {
            $(`#${zone.id}`).on('click', () => {
                if ($('#pays').val() !== 'France') return;
                this.setFieldValue('input_zone_sismique', zone.value);
                this.updateButtonStates(zone.id, sismiqueFrance.map(z => z.id));
                $('#connecte-illustration').attr('src', '/static/concevoir_mon_projet/medias/paramètres_Images/zone-sismique-tres-faible.png');
            });
        });

        // Zone sismique Haïti
        const sismiqueHaiti = [
            { id: 'btn_zone_sismique_h_1', value: 'Faible' },
            { id: 'btn_zone_sismique_h_2', value: 'Modérée' },
            { id: 'btn_zone_sismique_h_3', value: 'Elevée' },
            { id: 'btn_zone_sismique_h_4', value: 'Moyenne' }
        ];

        sismiqueHaiti.forEach(zone => {
            $(`#${zone.id}`).on('click', () => {
                if ($('#pays').val() !== 'Haïti') return;
                this.setFieldValue('input_zone_sismique', zone.value);
                this.updateButtonStates(zone.id, sismiqueHaiti.map(z => z.id));
                $('#connecte-illustration').attr('src', '/static/concevoir_mon_projet/medias/paramètres_Images/zone-sismique-tres-faible.png');
            });
        });
    }

    setupProjectSelections() {

        console.log('🔍 setupProjectSelections appelé');

        // Vérifier si les éléments existent
        const optionCards = $('.option-card');
        console.log('Nombre de .option-card trouvés:', optionCards.length);
        console.log('Éléments .option-card:', optionCards);

        // Test simple pour voir si les clics sont capturés
        $(document).on('click', function (e) {
            console.log('Clic sur:', e.target);
            console.log('Classe de l\'élément cliqué:', e.target.className);
        });
        // Type de projet
        $('#id_projet_connecter, #id_projet_non_connecter').on('click', (e) => {
            const carte = e.currentTarget;
            const nouveauType = carte.id === 'id_projet_connecter' ? 'connecte' : 'hors-ligne';
            const ancienType = $('#type_de_projet').val();

            $('#id_projet_connecter, #id_projet_non_connecter').removeClass('selected');
            $(carte).addClass('selected');
            $('#type_de_projet').val(nouveauType);

            // Bascule des sections d'options + typologies proposées : passe par la méthode partagée
            // avec selectProjectTypeCard() (restauration d'un projet existant), pour que les deux
            // chemins ne divergent plus (cf. le bug corrigé : l'un basculait `.active`, l'autre
            // posait un style.display inline, et la section hors-ligne restait invisible).
            this.applyConnexionProjetToUi(nouveauType);

            // Les deux sections d'options écrivent dans le MÊME champ caché #mode_de_valorisation
            // (même classe .mode-de-valorisation, cf. singleSelections ci-dessous) : sans purge, un
            // "Autoconsommation individuelle" choisi avant de basculer sur "Site autonome" restait
            // enregistré tel quel — c'est précisément ce qui permettait d'enregistrer un projet
            // hors-ligne avec un mode de valorisation réseau qui n'a aucun sens pour lui.
            if (ancienType && ancienType !== nouveauType) {
                this.resetModeDeValorisation();
            }
        });

        // Sélections uniques
        const singleSelections = {
            '.etude-option': 'type_etude',
            '.mode-de-valorisation': 'mode_de_valorisation',
            '.mode-de-tension': 'mode_de_tension',
            '.option-reseau-card': 'option_reseau',
            '.typologie-projet': 'typologie_projet'
        };

        // Valeur enregistrée : data-value de la carte si présent (libellé affiché différent de la valeur,
        // ex. « Alimentation en électricité » enregistrée « Habitation »), sinon le texte de son <h5>.
        Object.entries(singleSelections).forEach(([selector, inputId]) => {
            $(selector).on('click', function () {
                $(selector).removeClass('selected');
                $(this).addClass('selected');
                $(`#${inputId}`).val(this.dataset.value || $(this).find('h5').text());

                if (inputId === 'mode_de_tension') {
                    $('#div_autre_tension').toggleClass('active', $(this).find('h5').text() === 'Autres');
                }
            });
        });

        // Site autonome : la typologie du système affiche ou masque le profil consommateur, qui fixe
        // la typologie de projet (cartes de typologie masquées, cf. parametre.html).
        $('.mode-de-valorisation').on('click', () => {
            this.appliquerTypologieSysteme(this.lireModeDeValorisation());
        });
        $('.profil-consommateur').on('click', (e) => {
            const profil = $(e.currentTarget).find('h5').text().trim();
            this.selectProfilConsommateurCard(profil);
            $(profil === PROFIL_HABITATION ? '#id_typologie_residentielle' : '#id_typologie_ci').trigger('click');
        });

        // Typologie "Résidentielle" : pré-remplit (sans les verrouiller, l'utilisateur peut ensuite
        // les modifier) le mode de valorisation, la classification de l'ouvrage, la nature des
        // travaux et le type de projet avec les valeurs les plus courantes pour ce type de projet.
        $('#id_typologie_residentielle').on('click', () => {
            this.applyResidentialDefaults();
            this.updateModeDeValorisationVisibilityForTypologie(window.TYPOLOGIE_RESIDENTIELLE);
        });
        // Demande explicite : "Autoconsommation collective" et "Marché libre" n'ont pas de sens pour
        // un projet Résidentielle (masqués ci-dessus) — les réafficher si l'utilisateur change d'avis
        // et choisit une autre typologie après avoir sélectionné Résidentielle.
        $('#id_typologie_ci, #id_typologie_grand_projet').on('click', () => {
            this.updateModeDeValorisationVisibilityForTypologie('');
        });
        // NOUVEAU (demande explicite) : typologie "Professionnelle (C&I)" -> mode de valorisation
        // "Autoconsommation individuelle" par défaut (modifiable ensuite, rien n'est verrouillé).
        // Uniquement pour un projet connecté au réseau : les options "Site autonome" partagent la
        // même classe de carte et le même champ caché, ce libellé n'y existe pas.
        $('#id_typologie_ci').on('click', () => {
            const typeDeProjet = $('#form_parametre_projet #type_de_projet').val() || $('#type_de_projet').val();
            if (typeDeProjet === 'hors-ligne') return;
            const ancienMode = this.lireModeDeValorisation();
            this.selectValorisationCard('Autoconsommation individuelle');
            this.notifierChangementModeValorisation(ancienMode);
        });

        $('.option-card').each(function () {
            $(this).css({
                'border': '2px solid #dee2e6',
                'background-color': '#f8f9fa',
                'padding': '15px',
                'border-radius': '8px',
                'cursor': 'pointer',
                'margin-bottom': '10px',
                'transition': 'all 0.3s ease'
            });
        });

        // Puis gérer les clics
        $(document).off('click', '.option-card').on('click', '.option-card', function (e) {
            const $card = $(this);

            if ($card.hasClass('selected')) {
                $card.removeClass('selected');
                $card.css({
                    'border': '2px solid #dee2e6',
                    'background-color': '#f8f9fa',
                    'box-shadow': 'none'
                });
            } else if ($('.option-card.selected').length < 3) {
                $card.addClass('selected');
                $card.css({
                    'border': '3px solid #de0000',
                    'background-color': '#d4edda',
                    'box-shadow': '0 0 10px #de0000'
                });
            } else {
                alert('Maximum 3 options !');
            }
        });
        // Gestion "Autres"
        $('#type_projet_select').on('change', function () {
            $('#div_autre_type_projet').toggleClass('active', $(this).val() === 'Autres')
        });
    }

    updateButtonStates(activeId, allIds) {
        allIds.forEach(id => $(`#${id}`).removeClass('btn_reset_parametre_js'));
        $(`#${activeId}`).addClass('btn_reset_parametre_js');
    }

    setFieldValue(fieldId, value) {
        const field = document.getElementById(fieldId);
        if (field) field.value = value;
    }

    // ==========================================
    // GESTION DES PROJETS - LISTE ET AFFICHAGE
    // ==========================================

    /**
     * État de la liste (recherche, page, taille de page, filtre admin « Créé(e) par ») conservé
     * entre deux rechargements : les nombreux appels loadProjects() sans argument (après
     * suppression, changement de statut...) rafraîchissent la page courante au lieu de revenir
     * à la page 1 sans recherche. Un argument `search` explicite repart de la page 1.
     */
    get projectListState() {
        if (!this._projectListState) {
            // perPage 'auto' (par défaut) : autant de lignes que la hauteur libre de la fenêtre en
            // contient (cf. calculerProjetsParPageAuto) ; sinon un nombre choisi dans « Afficher ».
            this._projectListState = { search: '', page: 1, perPage: 'auto', createdBy: '' };
        }
        return this._projectListState;
    }

    /**
     * Nombre de projets qui tiennent entre l'en-tête du tableau et la barre de pagination.
     * Fenêtre masquée ou onglet non affiché : dernier résultat connu (10 au premier chargement).
     */
    calculerProjetsParPageAuto() {
        const body = document.getElementById('modal-body');
        const tbody = document.getElementById('projects-table-body');
        const repli = this._projetsParPageAuto || 10;
        if (!body || !tbody || body.clientHeight === 0 || tbody.offsetParent === null) return repli;

        const ligne = tbody.querySelector('tr[data-projet-id]');
        const hauteurLigne = ligne && ligne.offsetHeight > 0 ? ligne.offsetHeight : 33;
        const bar = document.getElementById('projects-list-controls');
        const hauteurBarre = bar && bar.offsetHeight > 0 ? bar.offsetHeight : 60;
        const hautTableau = tbody.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
        const disponible = body.clientHeight - hautTableau - hauteurBarre - 12;
        return Math.max(5, Math.min(200, Math.floor(disponible / hauteurLigne)));
    }

    /**
     * Mode « Auto » : recharge la liste quand la fenêtre change de taille (ouverture du modal,
     * poignée de redimensionnement, fenêtre du navigateur), en gardant le premier projet affiché.
     */
    observerHauteurListeProjets() {
        const body = document.getElementById('modal-body');
        if (!body || this._observateurHauteurProjets || typeof ResizeObserver === 'undefined') return;
        let minuteur = null;
        this._observateurHauteurProjets = new ResizeObserver(() => {
            clearTimeout(minuteur);
            minuteur = setTimeout(() => {
                const state = this.projectListState;
                if (state.perPage !== 'auto' || !this._projetsParPageAuto) return;
                const ancien = this._projetsParPageAuto;
                const nouveau = this.calculerProjetsParPageAuto();
                if (nouveau === ancien) return;
                this.loadProjects(undefined, { page: Math.floor(((state.page || 1) - 1) * ancien / nouveau) + 1 });
            }, 200);
        });
        this._observateurHauteurProjets.observe(body);
    }

    async loadProjects(search = undefined, options = {}) {
        const state = this.projectListState;
        if (search !== undefined && search !== state.search) {
            state.search = search;
            state.page = 1;
        }
        const { _correctionAuto, ...optionsListe } = options;
        Object.assign(state, optionsListe);
        let perPage = state.perPage;
        if (perPage === 'auto') {
            perPage = this.calculerProjetsParPageAuto();
            this._projetsParPageAuto = perPage;
        }
        try {
            const params = new URLSearchParams({
                search: state.search,
                page: String(state.page),
                per_page: String(perPage)
            });
            if (state.createdBy) params.set('created_by', state.createdBy);
            const response = await fetch(`/concevoir_mon_projet/parametres-projets?${params.toString()}`);
            const data = await response.json();

            if (data.success) {
                try {
                    // Le backend peut ramener la page à la dernière page existante
                    state.page = data.current_page || 1;
                    if (data.per_page && state.perPage !== 'auto') state.perPage = data.per_page;
                    this.displayProjects(data.projets, data.total, data.current_page, state.search, data.is_admin, data.per_page);
                    this.renderProjectListControls(data);
                    // Mode « Auto » : le 1er calcul a pu se faire sans ligne à mesurer (hauteur
                    // estimée) ; un seul rechargement correctif une fois les vraies lignes affichées.
                    if (state.perPage === 'auto' && !_correctionAuto) {
                        const recalcul = this.calculerProjetsParPageAuto();
                        if (recalcul !== perPage) {
                            this.loadProjects(undefined, { _correctionAuto: true, page: Math.floor(((state.page || 1) - 1) * perPage / recalcul) + 1 });
                        }
                    }
                } catch (renderError) {
                    console.error('Erreur lors de l\'affichage des projets:', renderError);
                    this.showError('Erreur d\'affichage des projets: ' + renderError.message);
                }
            } else {
                this.showError(data.message || 'Erreur lors du chargement des projets');
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Erreur de connexion');
        }
    }

    displayProjects(projets, total, currentPage, search = '', isAdminFromServer = undefined, perPage = undefined) {
        const tbody = document.getElementById('projects-table-body');
        if (!tbody) return;

        // CORRECTIF (numérotation "N° projet" décroissante) : la liste est triée par date de création
        // décroissante (le plus récent en premier, cf. backend: order_by(created_at.desc())). Un simple
        // `index + 1` donnait donc TOUJOURS le n°1 au projet le plus récent — ce qui change à chaque
        // création — alors que l'utilisateur attend l'inverse : un compteur stable qui ne fait
        // qu'augmenter, où le dernier projet créé porte le numéro le plus élevé (N+1). Avec `total` (le
        // nombre total de projets, toutes pages confondues) et `currentPage`, le numéro global du
        // projet le plus ancien de la liste est 1 et celui du plus récent est `total`.
        const projectsListTotal = typeof total === 'number' ? total : projets.length;
        const projectsListPerPage = perPage || this.projectListState.perPage || 10;
        const projectsListPageOffset = ((currentPage || 1) - 1) * projectsListPerPage;

        // Ajouter ou mettre à jour le message d'information — se base sur projectsListTotal (toutes
        // pages confondues) plutôt que projets.length seul, pour ne pas afficher à tort l'état "vide"
        // quand une recherche/filtre ne retourne aucun résultat sur la page courante alors que des
        // projets existent bel et bien. `total` reflète le filtre de recherche courant : avec une
        // recherche active, un total à 0 signifie juste "aucun résultat pour cette recherche", pas
        // "aucun projet n'a jamais été créé" — on ne déclenche donc l'état vide que sans recherche.
        // Idem pour le filtre admin « Créé(e) par » : un filtre actif sans résultat n'est pas l'état vide.
        this.addInfoMessage((search || this.projectListState.createdBy) ? true : projectsListTotal > 0);

        // Récupérer le projet actuellement sélectionné
        const currentProjetId = localStorage.getItem('current_projet_id');
        const isAdmin = isAdminFromServer !== undefined ? Boolean(isAdminFromServer) : Boolean(
            (window.USER_LICENCE && window.USER_LICENCE.is_admin) ||
            (window.parent && window.parent.USER_LICENCE && window.parent.USER_LICENCE.is_admin) ||
            document.querySelector('[data-is-admin="true"]')
        );
        const createdByStyle = isAdmin ? '' : 'display: none;';

        // Dynamically ensure "Indices" is in the table header if not already present
        const table = tbody.closest('table');
        if (table) {
            const thead = table.querySelector('thead');
            if (thead && !thead.querySelector('.indices-header')) {
                const headerRow = thead.querySelector('tr');
                if (headerRow) {
                    const ths = headerRow.querySelectorAll('th');
                    // Position 3 (et non 2) car la colonne "Actif" (case à cocher) a été ajoutée
                    // en tête de tableau, décalant "N° projet"/"Nom du Projet" d'un cran.
                    if (ths.length > 3) {
                        const indicesTh = document.createElement('th');
                        indicesTh.className = 'text-center indices-header';
                        // Largeur réduite (cohérente avec les largeurs fixées sur les <th> statiques du
                        // template, cf. parametre.html) et nowrap pour garder le titre sur une seule
                        // ligne. NOUVEAU (demande explicite) : élargie (8% -> 12%) avec la largeur
                        // libérée par le masquage de la colonne "Créé(e) par".
                        indicesTh.style.width = isAdmin ? '10%' : '12%';
                        indicesTh.style.whiteSpace = 'nowrap';
                        // CORRECTIF (en-tête "Indices" invisible) : Tabs.css définit une règle
                        // globale ".table th { color: white !important; }" — un !important d'une
                        // feuille de style externe l'emporte TOUJOURS sur un style inline sans
                        // !important, quelle que soit sa spécificité. Un simple `.style.color = ...`
                        // était donc silencieusement ignoré. Utiliser setProperty(..., 'important')
                        // pour poser, nous aussi, un !important inline (qui l'emporte alors sur la
                        // règle externe, à spécificité égale un style inline !important gagne toujours).
                        indicesTh.style.setProperty('color', '#232323', 'important');
                        indicesTh.textContent = 'Indices';
                        headerRow.insertBefore(indicesTh, ths[3]); // Insérer juste après "Nom du Projet"
                    }
                }
            }
        }

        if (projets.length === 0) {
            tbody.innerHTML = `
        <tr>
            <td colspan="9" class="text-center py-4">
                <i class="fas fa-inbox fa-3x text-muted mb-3"></i>
                <p>Aucun projet trouvé</p>
            </td>
        </tr>
    `;
            return;
        }

        tbody.innerHTML = projets.map((projet, index) => {
            const puissanceKwc = this.computeProjectKwc(projet);

            // Priorité au champ direct type_etude (choix utilisateur dans l'onglet "Mode de
            // calcul et Normes"), indépendant de toute norme de calcul associée. Repli sur
            // norme_calcul pour compatibilité avec d'anciens projets.
            const typeEtude = projet.type_etude || projet.norme_calcul?.type_etude || 'Non défini';
            // Libellé d'AFFICHAGE (cf. getTypeEtudeDisplayLabel()) ; la couleur du badge en découle :
            // une couleur par type (Chiffrage / Étude technico-économique / Étude de conception).
            const typeEtudeDisplay = this.getTypeEtudeDisplayLabel(typeEtude);
            const statusBadgeClass = this.getStatusBadgeClass(typeEtudeDisplay);

            // Ajouter une classe si c'est le projet sélectionné
            const isSelected = currentProjetId && parseInt(currentProjetId) === projet.id;
            const selectedClass = isSelected ? 'projet-selected' : '';
            const selectedIcon = isSelected ? '<i class="fas fa-check-circle text-success" style="margin-left: 8px;"></i>' : '';

            // "N° projet" : compteur visuel séquentiel décroissant par ancienneté (le plus ancien = 1,
            // le plus récent = total), indépendant de l'ID technique en base — l'ID réel reste
            // disponible via data-projet-id sur la <tr> pour toutes les actions (éditer/supprimer/
            // sélectionner/partager) et n'est jamais envoyé au serveur depuis cette colonne.
            const numeroProjet = projectsListTotal - (projectsListPageOffset + index);

            // Générer les badges d'indices interactifs
            const indicesHtml = (projet.revisions && projet.revisions.length > 0)
                ? projet.revisions.map(rev => {
                    // CORRECTIF (bug "les indices sont en surbrillance pour des projets inactifs") :
                    // active_indice signifie "indice actuellement chargé POUR CE PROJET", pas "ce projet
                    // est le projet actif de l'application" — chaque projet déjà sauvegardé a son propre
                    // active_indice (presque toujours 'A' tant que le multi-indices est désactivé, cf.
                    // ParametresProjet.js: VERSIONING_INDICES_UI_ENABLED), donc toutes les lignes
                    // affichaient leur indice A en surbrillance. On restreint désormais ce marquage à la
                    // ligne du projet réellement actif (isSelected, déjà calculé plus haut).
                    const isActive = isSelected && projet.active_indice && rev.indice === projet.active_indice;
                    // Indice A = variante de référence du projet, permanente : sa suppression n'est
                    // possible qu'en supprimant le projet dans sa globalité (bouton masqué pour ce cas).
                    const isIndiceA = rev.indice === 'A';
                    // Ouverture d'un clic (cf. ouvrirVariante) : seulement sur le projet ouvert.
                    const titre = isActive ? `Variante ${rev.indice} ouverte`
                        : !isSelected ? `Variante ${rev.indice} — ouvrez d'abord ce projet (case « Actif »)`
                        : rev.restaurable === false ? `Variante ${rev.indice} — ancienne version, ne peut pas être ouverte`
                        : `Ouvrir la variante ${rev.indice}`;
                    return `
                <span class="badge bg-danger indice-badge${isActive ? ' indice-badge-active' : ''}"
                      data-projet-id="${projet.id}"
                      data-indice="${rev.indice}"
                      data-active-indice="${projet.active_indice || ''}"
                      title="${titre}"
                      style="position: relative; cursor: ${isActive || !isSelected ? 'default' : 'pointer'}; padding: 6px 10px; font-size: 0.85rem; user-select: none; margin-right: 5px;">
                    ${rev.indice}
                    ${isIndiceA || isActive ? '' : `
                    <span class="delete-indice-btn"
                          data-projet-id="${projet.id}"
                          data-indice="${rev.indice}"
                          title="Supprimer la variante Indice ${rev.indice}"
                          style="position: absolute; top: -5px; right: -5px; background: #374151; color: white; border-radius: 50%; width: 14px; height: 14px; font-size: 8px; line-height: 14px; text-align: center; cursor: pointer; display: none;">
                        &times;
                    </span>
                    `}
                </span>
              `;
                }).join('')
                : '<span class="text-muted" style="font-size: 0.85rem;">Aucun</span>';




            return `
    <tr data-projet-id="${projet.id}" class="${selectedClass}">
        <td class="text-center">
            <input type="checkbox" class="project-active-checkbox" data-projet-id="${projet.id}"
                   data-projet-nom="${this.escapeHtml(projet.nom_projet)}"
                   ${isSelected ? 'checked' : ''} title="Sélectionner ce projet comme actif">
        </td>
        <td class="text-center">${numeroProjet}</td>
        <td>${this.escapeHtml(projet.nom_projet)}${selectedIcon}</td>
                    <td>
                <div class="d-flex align-items-center justify-content-center">
                    ${indicesHtml}
                </div>
            </td>
        ${this.renderPuissanceProjetCell(projet, puissanceKwc)}
        <td class="text-center">${this.formatDate(projet.updated_at)}</td>
        <td class="text-center col-created-by" style="${createdByStyle}">${this.renderCreatedByCell(projet)}</td>
        <td class="text-center col-masquee" style="display: none;">
            <span class="badge ${statusBadgeClass}" style="white-space: normal; line-height: 1.3;">
                ${typeEtudeDisplay}
            </span>
        </td>
        <td class="text-center bouton_mes_projets col-masquee" style="display: none;">
            <!-- NOUVEAU (demande explicite : "masquer pour le moment") : conservée dans le DOM
                 (pas supprimée) pour pouvoir la réactiver facilement plus tard — viewProjectDetails()
                 reste intacte et fonctionnelle. -->
            <i class="fas fa-eye text-secondary" title="Voir les détails"
               onclick="window.dataManager.viewProjectDetails(${projet.id})"
               style="cursor: pointer; margin: 0 5px; display: none;"></i>
            <!-- NOUVEAU (demande explicite) : titre reformulé pour plus de clarté — comportement
                 (editProject) inchangé. Copier/Supprimer/Partager déplacés hors du tableau, regroupés
                 sous "Action d'édition" après le bouton "Ouvrir mon projet" (cf. parametre.html /
                 addInfoMessage() ci-dessous) — ils opèrent désormais sur le projet coché "Actif",
                 plus sur une ligne cliquée. -->
            <img src="/static/concevoir_mon_projet/medias/icons/settings-svgrepo-com.svg"
                 alt="Modifier les paramètres du projet" title="Modifier les paramètres du projet"
                 onclick="window.dataManager.editProject(${projet.id})"
                 style="cursor: pointer; margin: 0 5px; width: 16px; height: 16px; vertical-align: middle;">
        </td>
    </tr>
    `;
        }).join('');
        this.attachDeleteEvents();
        this.attachActiveProjectCheckboxEvents();
        this.attachCreatorNameEvents();
        this.attachIndiceBadgeEvents();
        this.appliquerVisibiliteColonneCreePar();

        // Mettre à jour l'affichage visuel du projet sélectionné (si un projet est déjà sélectionné)
        this.highlightSelectedProject();
    }

    /**
     * Barre de contrôle de la liste des projets, sous le tableau : compteur, taille de page,
     * pagination et — pour l'administrateur — filtre « Créé(e) par » + bouton de réinitialisation.
     * Sans elle, seuls les 10 projets les plus récents étaient visibles (le backend pagine).
     */
    renderProjectListControls(data) {
        const mesProjets = document.getElementById('mes_projets');
        if (!mesProjets) return;

        let bar = document.getElementById('projects-list-controls');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'projects-list-controls';
            // Grille à 3 colonnes (cf. ParametresProjet.css) : compteur/filtres à gauche, « Suivant »
            // centré dans la page, pagination à droite.
            // Dernier enfant de #mes_projets (flex colonne) : collé en bas de la fenêtre, et non
            // plus juste sous le tableau, pour laisser toute la hauteur à la liste (cf. ParametresProjet.css).
            mesProjets.appendChild(bar);
            this.observerHauteurListeProjets();

            // Délégation : un seul jeu de listeners, le contenu est réécrit à chaque chargement
            bar.addEventListener('click', (e) => {
                const pageBtn = e.target.closest('[data-page]');
                if (pageBtn && !pageBtn.disabled) {
                    e.preventDefault();
                    this.loadProjects(undefined, { page: parseInt(pageBtn.dataset.page, 10) });
                    return;
                }
                if (e.target.closest('#projects-filter-reset')) {
                    e.preventDefault();
                    this.resetProjectListFilters();
                }
                // Parcours (demande explicite) : Mes projets -> Paramètres projet du projet ouvert.
                const boutonSuivant = e.target.closest('#projects-next-btn');
                if (boutonSuivant) {
                    e.preventDefault();
                    this.majBoutonSuivantMesProjets();
                    if (!boutonSuivant.disabled && typeof window.openParametresProjet === 'function') {
                        window.openParametresProjet();
                    }
                    return;
                }
                const boutonCreePar = e.target.closest('#projects-toggle-created-by');
                if (boutonCreePar) {
                    e.preventDefault();
                    this._afficherColonneCreePar = !this._afficherColonneCreePar;
                    this.appliquerVisibiliteColonneCreePar();
                    const affichee = this._afficherColonneCreePar;
                    boutonCreePar.title = `${affichee ? 'Masquer' : 'Afficher'} la colonne « Créé(e) par »`;
                    boutonCreePar.innerHTML = `<i class="fas ${affichee ? 'fa-eye-slash' : 'fa-eye'}"></i> ${affichee ? 'Masquer la colonne' : 'Afficher la colonne'}`;
                }
            });
            bar.addEventListener('change', (e) => {
                if (e.target.id === 'projects-per-page') {
                    const valeur = e.target.value === 'auto' ? 'auto' : parseInt(e.target.value, 10);
                    this.loadProjects(undefined, { perPage: valeur, page: 1 });
                } else if (e.target.id === 'projects-created-by-filter') {
                    this.loadProjects(undefined, { createdBy: e.target.value, page: 1 });
                }
            });
        }

        const state = this.projectListState;
        const total = data.total || 0;
        const pages = Math.max(1, data.pages || 1);
        const page = Math.min(Math.max(1, data.current_page || 1), pages);
        const perPage = data.per_page || state.perPage;
        const first = total === 0 ? 0 : (page - 1) * perPage + 1;
        const last = Math.min(page * perPage, total);

        // Numéros de pages : première, dernière, et 2 autour de la page courante
        const pageNumbers = [];
        for (let i = 1; i <= pages; i++) {
            if (i === 1 || i === pages || Math.abs(i - page) <= 2) pageNumbers.push(i);
            else if (pageNumbers[pageNumbers.length - 1] !== '…') pageNumbers.push('…');
        }
        const pageItem = (label, target, { disabled = false, active = false, title = '' } = {}) => `
            <li class="page-item${disabled ? ' disabled' : ''}${active ? ' active' : ''}">
                <button type="button" class="page-link" ${disabled || active ? 'disabled' : `data-page="${target}"`}
                        ${title ? `title="${title}"` : ''}>${label}</button>
            </li>`;
        const paginationHtml = pages > 1 ? `
            <ul class="pagination pagination-sm mb-0">
                ${pageItem('&laquo;', page - 1, { disabled: page <= 1, title: 'Page précédente' })}
                ${pageNumbers.map(n => n === '…'
                    ? '<li class="page-item disabled"><span class="page-link">…</span></li>'
                    : pageItem(n, n, { active: n === page })).join('')}
                ${pageItem('&raquo;', page + 1, { disabled: page >= pages, title: 'Page suivante' })}
            </ul>` : '';

        const modeAuto = state.perPage === 'auto';
        const perPageOptions = [10, 25, 50, 100, 200];
        if (!modeAuto && !perPageOptions.includes(perPage)) perPageOptions.push(perPage);
        const perPageHtml = `
            <label class="d-flex align-items-center mb-0" style="gap: 6px; white-space: nowrap;">
                <span>Afficher</span>
                <select id="projects-per-page" class="form-select form-select-sm" style="width: auto;"
                        title="Auto : autant de projets que la hauteur de la fenêtre en contient">
                    <option value="auto" ${modeAuto ? 'selected' : ''}>Auto (${perPage})</option>
                    ${perPageOptions.sort((a, b) => a - b).map(n => `<option value="${n}" ${!modeAuto && n === perPage ? 'selected' : ''}>${n}</option>`).join('')}
                </select>
                <span>par page</span>
            </label>`;

        let adminFilterHtml = '';
        if (data.is_admin) {
            const createurs = Array.isArray(data.createurs) ? data.createurs : [];
            const totalTous = createurs.reduce((acc, c) => acc + (c.nb_projets || 0), 0);
            const hasFilter = Boolean(state.search || state.createdBy);
            // Filtre et boutons dans un même bloc sans retour à la ligne : le flex-wrap de la barre
            // renvoyait « Afficher la colonne » sous « Créé(e) par » quand la place manquait.
            adminFilterHtml = `
                <div class="d-flex align-items-center" style="gap: 10px; flex-wrap: nowrap;">
                <label class="d-flex align-items-center mb-0" style="gap: 6px; white-space: nowrap;">
                    <i class="fas fa-user text-secondary"></i>
                    <span>Créé(e) par</span>
                    <select id="projects-created-by-filter" class="form-select form-select-sm" style="width: auto; max-width: 260px;">
                        <option value="">Tous les utilisateurs (${totalTous})</option>
                        ${createurs.map(c => `
                            <option value="${this.escapeHtml(String(c.id))}" ${String(c.id) === state.createdBy ? 'selected' : ''}
                                    title="${this.escapeHtml(c.email || '')}">
                                ${this.escapeHtml(c.nom || c.email || String(c.id))} (${c.nb_projets})
                            </option>`).join('')}
                    </select>
                </label>
                <!-- Style en ligne : la règle globale .btn d'Entete.css (largeur 27,5 %, marges 10 %) renvoyait
                     le bouton à la ligne sous « Créé(e) par », avec un texte gris illisible sur fond rouge. -->
                <button type="button" id="projects-toggle-created-by" class="btn btn-sm btn-outline-secondary"
                        style="width:auto; margin:0; padding:3px 10px; flex:0 0 auto; white-space:nowrap;
                               background:#de0000; background-image:none; color:#fff; border:none; border-radius:5px;"
                        title="${this._afficherColonneCreePar ? 'Masquer' : 'Afficher'} la colonne « Créé(e) par »">
                    <i class="fas ${this._afficherColonneCreePar ? 'fa-eye-slash' : 'fa-eye'}"></i>
                    ${this._afficherColonneCreePar ? 'Masquer la colonne' : 'Afficher la colonne'}
                </button>
                ${hasFilter ? `
                <button type="button" id="projects-filter-reset" class="btn btn-sm btn-outline-secondary"
                        style="width:auto; margin:0; padding:3px 10px; flex:0 0 auto; white-space:nowrap;
                               background:#de0000; background-image:none; color:#fff; border:none; border-radius:5px;"
                        title="Afficher tous les projets">
                    <i class="fas fa-times"></i> Réinitialiser
                </button>` : ''}
                </div>`;
        }

        bar.innerHTML = `
            <div class="d-flex align-items-center flex-wrap" style="gap: 14px;">
                <span style="white-space: nowrap;">
                    ${total === 0 ? 'Aucun projet' : `Projets <strong>${first}–${last}</strong> sur <strong>${total}</strong>`}
                </span>
                ${adminFilterHtml}
            </div>
            <!-- Style en ligne : même raison que « Afficher la colonne » (règle globale .btn d'Entete.css). -->
            <button type="button" id="projects-next-btn" class="btn btn-sm"
                    style="width:auto; margin:0; padding:5px 22px; white-space:nowrap; font-weight:600;
                           background:#de0000; background-image:none; color:#fff; border:none; border-radius:5px;">
                Suivant →
            </button>
            <div class="d-flex align-items-center" style="gap: 14px; flex-wrap: nowrap;">
                ${perPageHtml}
                ${paginationHtml}
            </div>`;
        this.majBoutonSuivantMesProjets();
    }

    /**
     * « Suivant » de « Mes projets » : actif seulement lorsqu'un projet est ouvert (projet actif),
     * puisqu'il mène aux « Paramètres projet » de ce projet.
     */
    majBoutonSuivantMesProjets() {
        const bouton = document.getElementById('projects-next-btn');
        if (!bouton) return;
        const projetOuvert = Boolean(localStorage.getItem('current_projet_id'));
        bouton.disabled = !projetOuvert;
        bouton.style.opacity = projetOuvert ? '' : '0.5';
        bouton.style.cursor = projetOuvert ? 'pointer' : 'not-allowed';
        bouton.title = projetOuvert
            ? 'Paramètres du projet ouvert'
            : 'Ouvrez un projet (case « Actif ») pour continuer';
    }

    /**
     * Colonne « Créé(e) par » (administrateur seulement) : masquée par défaut, affichée à la demande
     * par le bouton du pied de la liste. Réappliqué après chaque rendu des lignes (pagination,
     * recherche). Seul l'administrateur peut l'afficher : pour les autres, l'état reste « masqué »
     * et les styles inline de la colonne la masquent déjà.
     */
    appliquerVisibiliteColonneCreePar() {
        document.querySelectorAll('#mes_projets .col-created-by').forEach((cellule) => {
            if (this._afficherColonneCreePar) cellule.style.removeProperty('display');
            else cellule.style.setProperty('display', 'none', 'important');
        });
    }

    /**
     * Réinitialise recherche + filtre « Créé(e) par » et revient à la page 1 : utilisé par le
     * bouton « Tous les projets (Admin) » / « Mes projets » et par « Réinitialiser ».
     */
    resetProjectListFilters() {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        this.loadProjects('', { createdBy: '', page: 1 });
    }

    /**
     * Ouvre une variante du projet ouvert : la variante active est d'abord enregistrée (avec les
     * modifications en cours), puis le serveur réécrit les tables de travail depuis la variante
     * demandée, et la page de calepinage est rechargée sans les caches de l'ancienne variante.
     * Pendant l'opération, toutes les sauvegardes du navigateur sont bloquées (même verrou que
     * garde_projet_actif.js) : une sauvegarde automatique ou de fermeture de page réécrirait sinon
     * l'ancienne variante dans la nouvelle.
     */
    async ouvrirVariante(projetId, indice, indiceActif) {
        const id = String(projetId);
        if (id !== String(localStorage.getItem('current_projet_id'))) {
            this.showInfo("Ouvrez d'abord ce projet (case « Actif » puis « Ouvrir mon projet »), puis choisissez sa variante.");
            return;
        }
        if (this.ouvertureVarianteEnCours || !indice || indice === indiceActif) return;
        const libelleActif = indiceActif ? `La variante ${indiceActif} ouverte sera d'abord enregistrée avec vos modifications.` : '';
        if (!confirm(`Ouvrir la variante ${indice} ?\n\n${libelleActif}`)) return;

        this.ouvertureVarianteEnCours = true;
        const verrouInitial = window.projetActifVerrouille;
        const base = `/concevoir_mon_projet/parametre-projet/${encodeURIComponent(id)}`;
        try {
            // 1. Enregistrer la variante ouverte (décision utilisateur : jamais de perte silencieuse)
            if (indiceActif) {
                this.showInfo(`Enregistrement de la variante ${indiceActif}...`);
                const ui = window.uiManagerInstance;
                if (ui && typeof ui.syncAllProjectDataToDatabase === 'function') {
                    const synchro = await ui.syncAllProjectDataToDatabase(id);
                    if (synchro && synchro.ok === false) throw new Error(synchro.message);
                }
                const enreg = await (await fetch(`${base}/revision/save`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'enregistrer' })
                })).json();
                if (!enreg.success) throw new Error(enreg.message || `La variante ${indiceActif} n'a pas pu être enregistrée.`);
            }

            // 2. Plus aucune sauvegarde du navigateur jusqu'au rechargement
            window.projetActifVerrouille = () => true;

            // 3. Ouvrir la variante (le serveur réécrit tout en une transaction)
            const ouverture = await (await fetch(`${base}/revision/${encodeURIComponent(indice)}/load`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }
            })).json();
            if (!ouverture.success) throw new Error(ouverture.message || `La variante ${indice} n'a pas pu être ouverte.`);

            // 4. Recharger la page de calepinage sans les caches de l'ancienne variante
            purgerCachesLocauxVariante(id);
            this.showSuccess(`Variante ${indice} ouverte.`);
            if (window.estPageAccueil()) window.location.reload();
            else window.location.assign(window.SKV_URL_ACCUEIL);
        } catch (err) {
            // Variante non ouverte : rien n'a changé en base (transaction), les sauvegardes reprennent.
            window.projetActifVerrouille = verrouInitial;
            this.ouvertureVarianteEnCours = false;
            console.error("Ouverture de variante impossible :", err);
            this.showError(err && err.message ? err.message : "Erreur de connexion : la variante n'a pas été ouverte.");
        }
    }

    /**
     * Attache les event listeners de survol, suppression et clic d'ouverture sur les indices
     */
    attachIndiceBadgeEvents() {
        const tbody = document.getElementById('projects-table-body');
        if (!tbody) return;

        tbody.querySelectorAll('.indice-badge').forEach(badge => {
            badge.addEventListener('mouseenter', () => {
                const deleteBtn = badge.querySelector('.delete-indice-btn');
                if (deleteBtn) deleteBtn.style.display = 'block';
            });
            badge.addEventListener('mouseleave', () => {
                const deleteBtn = badge.querySelector('.delete-indice-btn');
                if (deleteBtn) deleteBtn.style.display = 'none';
            });

            badge.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.ouvrirVariante(badge.dataset.projetId, badge.dataset.indice, badge.dataset.activeIndice);
            });
        });

        tbody.querySelectorAll('.delete-indice-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const projetId = parseInt(btn.dataset.projetId);
                const indice = btn.dataset.indice;

                if (confirm(`Voulez-vous vraiment supprimer définitivement la variante Indice ${indice} ?`)) {
                    try {
                        const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/revision/${indice}`, {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' }
                        });
                        const result = await response.json();
                        if (result.success) {
                            this.showSuccess(`La variante Indice ${indice} a été supprimée.`);
                            this.loadProjects();
                        } else { this.showError(result.message); }
                    } catch (err) { this.showError('Erreur de connexion lors de la suppression'); }
                }
            });
        });
    }
    /**
     * Ajoute un message d'information pour guider l'utilisateur, et gère le bouton "Ouvrir mon
     * projet" (rendu séparément, dans #open-project-btn-container — sur la même ligne que le champ
     * de recherche, PAS dans cette section d'information, cf. parametre.html).
     * @param {boolean} hasProjects - true dès qu'au moins un projet existe (tous, pas seulement ceux
     *   affichés sur la page courante) — détermine l'état vide ("premier login, aucun projet créé")
     *   vs. les instructions normales d'ouverture. Le bouton "Ouvrir mon projet" n'a de sens que s'il
     *   existe au moins un projet à ouvrir : il ne doit donc apparaître dans le DOM QUE dans ce cas.
     */
    addInfoMessage(hasProjects = true) {
        // Vérifier si le message existe déjà
        let infoContainer = document.getElementById('projet-info-message');

        if (!infoContainer) {
            // Créer le message s'il n'existe pas
            infoContainer = document.createElement('div');
            infoContainer.id = 'projet-info-message';
            infoContainer.className = 'alert alert-info';
            infoContainer.style.cssText = 'margin: 15px 0; padding: 12px 15px; border-left: 4px solid #0dcaf0;';

            // Trouver l'emplacement pour insérer le message (avant le tableau)
            const tableContainer = document.querySelector('.table-responsive-md');
            if (tableContainer && tableContainer.parentNode) {
                tableContainer.parentNode.insertBefore(infoContainer, tableContainer);
            }
        }

        const btnContainer = document.getElementById('open-project-btn-container');
        const editActionContainer = document.getElementById('edit-action-btn-container');
        const mesProjetsBtn = document.getElementById('mes-projets-btn');
        const createBtnLabel = document.getElementById('create-project-btn-label');

        // État vide (aucun projet créé, ex. première connexion) : pas de bouton "Ouvrir mon projet"
        // ni "Mes projets" (rien à ouvrir/lister), le message oriente directement vers la création
        // plutôt que vers des instructions d'ouverture qui n'ont pas encore de sens, et le bouton de
        // création affiche "Créer un projet" (premier projet). Idem pour le groupe "Action d'édition"
        // (Copier/Supprimer/Partager) : rien à éditer tant qu'aucun projet n'existe.
        if (!hasProjects) {
            infoContainer.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-lightbulb" style="font-size: 20px; color: #ffc107;"></i>
                    <div>
                        <small style="color: #666;">
                            Vous n'avez aucun projet. Cliquez sur "Créer un projet" pour créer votre premier projet.
                        </small>
                    </div>
                </div>
            `;
            if (btnContainer) btnContainer.innerHTML = '';
            if (editActionContainer) editActionContainer.innerHTML = '';
            if (mesProjetsBtn) mesProjetsBtn.style.display = 'none';
            if (createBtnLabel) createBtnLabel.textContent = 'Créer un projet';
            return;
        }

        if (mesProjetsBtn) mesProjetsBtn.style.display = '';
        if (createBtnLabel) createBtnLabel.textContent = 'Créer un nouveau projet';

        // Vérifier si un projet est sélectionné
        const currentProjetId = localStorage.getItem('current_projet_id');
        const currentProjetNom = localStorage.getItem('current_projet_nom');

        const openProjectInstructionsHtml = `
            <i class="fas fa-check-square"></i> Pour ouvrir un projet, on coche d'abord la case "Actif" et on clique sur le bouton "Ouvrir mon projet"
        `;

        if (currentProjetId && currentProjetNom) {
            infoContainer.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-info-circle" style="font-size: 20px; color: #0dcaf0;"></i>
                    <div>
                        <strong>Projet actif :</strong> ${this.escapeHtml(currentProjetNom)} (ID: ${currentProjetId})
                        <br>
                        <small style="color: #666;">
                            ${openProjectInstructionsHtml}
                        </small>
                    </div>
                </div>
            `;
        } else {
            infoContainer.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-lightbulb" style="font-size: 20px; color: #ffc107;"></i>
                    <div>
                        <strong>Comment ouvrir un projet :</strong>
                        <br>
                        <small style="color: #666;">
                            ${openProjectInstructionsHtml}
                            <br>
                            <i class="fas fa-plus-circle"></i> Ou cliquez sur "Créer un nouveau projet" pour en créer un autre
                        </small>
                    </div>
                </div>
            `;
        }

        // Bouton d'action (cf. classes .btn-nav / .btn-nav-cta déjà utilisées pour le bandeau de
        // guidage de l'onglet "Créer un nouveau projet", réutilisées ici pour rester cohérent) :
        // déclenche explicitement l'ouverture du projet actuellement coché "Actif", plutôt que de
        // compter uniquement sur la case à cocher elle-même. Rendu dans #open-project-btn-container
        // (même ligne que le champ de recherche), hors de la section d'information ci-dessus.
        // .mp-toolbar-btn* : même classe que "Mes projets"/"Créer un projet" (cf. parametre.html) pour
        // un espacement rigoureusement identique entre les 3 boutons de cette rangée.
        if (btnContainer) {
            btnContainer.innerHTML = `
                <button type="button" id="open-selected-project-btn" class="mp-toolbar-btn mp-toolbar-btn-red">
                    <i class="fas fa-folder-open"></i> Ouvrir mon projet
                </button>
            `;
        }

        const openBtn = document.getElementById('open-selected-project-btn');
        if (openBtn) {
            openBtn.addEventListener('click', () => this.openSelectedActiveProject());
        }

        // NOUVEAU (demande explicite) : groupe "Action d'édition" (Copier/Supprimer/Partager),
        // déplacé hors du tableau (retiré de la colonne "Param. Projet"), juste après "Ouvrir mon
        // projet" — icônes placées juste devant le label. Comme "Ouvrir mon projet" ci-dessus, agit
        // sur le projet actuellement coché "Actif" dans le tableau (#projects-table-body
        // .project-active-checkbox:checked), pas sur une ligne cliquée : l'utilisateur sélectionne
        // d'abord un projet, puis clique sur une icône (demande explicite, point 2).
        if (editActionContainer) {
            editActionContainer.innerHTML = `
                <div class="mp-toolbar-btn mp-toolbar-btn-grey" style="cursor: default;">
                    <!-- NOUVEAU (demande explicite : "augmenter l'espace entre les 3 boutons pour ne
                         pas cliquer sur le mauvais") : marge horizontale explicite sur chaque icône,
                         en plus du gap:6px déjà posé par .mp-toolbar-btn (classe partagée avec
                         "Mes projets"/"Créer un projet"/"Ouvrir mon projet" — volontairement non
                         modifiée ici pour ne pas affecter leur propre espacement). -->
                    <!-- CORRECTIF (demande explicite : "placer Supprimer avant Copier") : ordre
                         d'affichage inversé — fa-trash-alt (pas fa-trash) : attachDeleteEvents()
                         ci-dessous sélectionne ".fa-trash" GLOBALEMENT dans tout le document (pas
                         scopé au tableau) et y attache son propre écouteur, lisant
                         data-project-id/-name (absents ici, volontairement — cf.
                         getSelectedProjectForEditAction ci-dessus) — même classe que fa-trash
                         aurait donc déclenché un second écouteur concurrent appelant
                         deleteProjectWithConfirmation(null, null), court-circuitant la garde
                         "aucun projet sélectionné". -->
                    <i class="fa fa-trash-alt" id="edit-action-delete-btn" title="Supprimer le projet"
                       style="cursor: pointer; margin: 0 10px;"></i>
                    <!-- Icône « Copier le projet » masquée (demande explicite) ; son écouteur reste branché. -->
                    <i class="fa fa-copy" id="edit-action-copy-btn" title="Copier le projet"
                       style="cursor: pointer; margin: 0 10px; display: none;"></i>
                    <i class="fa fa-share" id="edit-action-share-btn" title="Partager le projet"
                       style="cursor: pointer; margin: 0 10px;"></i>
                    <span style="margin-left: 4px;">Action d'édition</span>
                </div>
            `;
        }

        const getSelectedProjectForEditAction = () => {
            const checkedBox = document.querySelector('#projects-table-body .project-active-checkbox:checked');
            if (!checkedBox) {
                this.showMessage('Sélectionnez d\'abord un projet (case "Actif") avant d\'utiliser une action d\'édition', 'warning');
                return null;
            }
            return { id: checkedBox.dataset.projetId, nom: checkedBox.dataset.projetNom };
        };

        const copyBtn = document.getElementById('edit-action-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const selected = getSelectedProjectForEditAction();
                if (!selected) return;
                if (window.shareManager2) window.shareManager2.showCopyProjectModal(selected.id);
            });
        }

        const deleteBtn = document.getElementById('edit-action-delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                const selected = getSelectedProjectForEditAction();
                if (!selected) return;
                this.deleteProjectWithConfirmation(selected.id, selected.nom);
            });
        }

        const shareBtn = document.getElementById('edit-action-share-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', () => {
                const selected = getSelectedProjectForEditAction();
                if (!selected) return;
                if (window.shareManager2) window.shareManager2.openShareModal(selected.id);
            });
        }
    }

    /**
     * Ouvre le projet actuellement coché "Actif" dans le tableau (bouton "Ouvrir mon projet") — action
     * explicite plutôt que de déclencher la navigation directement depuis la case à cocher.
     */
    async openSelectedActiveProject() {
        const checkedBox = document.querySelector('#projects-table-body .project-active-checkbox:checked');
        if (!checkedBox) {
            this.showMessage('Cochez d\'abord la case "Actif" du projet à ouvrir', 'warning');
            return;
        }
        const projectId = checkedBox.dataset.projetId;
        const projectName = checkedBox.dataset.projetNom;

        // Un clic explicite sur ce bouton couvre déjà l'intention "ouvrir le projet tout juste créé"
        // (cf. pendingProjectOpen, posé par submitParametreProjet()) — inutile de redéclencher quoi
        // que ce soit à la fermeture du modal juste après.
        this.pendingProjectOpen = null;

        // Empêcher tout double-clic pendant l'ouverture (qui déclenche une navigation plein page).
        const openBtn = document.getElementById('open-selected-project-btn');
        if (openBtn) openBtn.disabled = true;

        try {
            await this.selectAndLoadProject(projectId, projectName);
        } finally {
            // CORRECTIF (bug rapporté : "le bouton reste grisé après avoir ouvert un projet puis en
            // avoir sélectionné un autre, oblige à rafraîchir la page") : quand le modal reste ouvert
            // sans rechargement de page (cf. la branche onCalepinagePage de selectAndLoadProject(),
            // le cas le plus courant puisque ce modal vit déjà sur la page Calepinage), ce même bouton
            // DOM restait désactivé indéfiniment — rien ne le réactivait jamais après ce point. On le
            // réactive systématiquement ici une fois l'ouverture terminée (succès ou échec), pour
            // qu'il soit de nouveau immédiatement utilisable dès qu'un autre projet est coché.
            if (openBtn) openBtn.disabled = false;
        }
    }

    /**
     * Met en évidence le projet actuellement sélectionné (au chargement de la liste)
     */
    highlightSelectedProject() {
        if (window.calepinageService) {
            const currentProjetId = window.calepinageService.getCurrentProjetId();
            if (currentProjetId) {
                this.updateSelectedProjectDisplay(currentProjetId);
                console.log(`ℹ️ Projet ${currentProjetId} est actuellement sélectionné`);
            }
        }
    }

    attachDeleteEvents() {
        document.querySelectorAll('.fa-trash').forEach(icon => {
            icon.addEventListener('click', (e) => {
                const projectId = e.target.getAttribute('data-project-id');
                const projectName = e.target.getAttribute('data-project-name');
                this.deleteProjectWithConfirmation(projectId, projectName);
            });
        });
    }
    deleteProjectWithConfirmation(projectId, projectName) {
        if (window.shareManager2) {
            window.shareManager2.showDeleteConfirmation(projectId, projectName);
        } else {
            this.deleteProject(projectId);
        }
    }

    /**
     * Attache les événements de sélection du projet actif via la case à cocher "Actif".
     * REMPLACE l'ancien mécanisme de double-clic sur la ligne : un double-clic est facilement
     * déclenché par erreur (ex. en essayant de sélectionner du texte dans une cellule), ce qui
     * pouvait faire basculer le projet actif sans intention claire de l'utilisateur. La case à
     * cocher exige une action explicite et délibérée sur un contrôle dédié.
     */
    attachActiveProjectCheckboxEvents() {
        document.querySelectorAll('#projects-table-body .project-active-checkbox').forEach(checkbox => {
            // CORRIGÉ (2026-08-07) : cocher la case ne déclenche plus l'ouverture directement — elle se
            // contente désormais de désigner le projet visé (case exclusive : cocher une ligne décoche
            // les autres). L'ouverture effective (fermeture du modal + navigation) se fait par une
            // action explicite et fiable, le bouton "Ouvrir mon projet" (cf. addInfoMessage() /
            // openSelectedActiveProject()), plutôt que de dépendre d'un évènement 'change' asynchrone.
            checkbox.addEventListener('change', () => {
                if (!checkbox.checked) {
                    // Un projet actif doit toujours rester sélectionné par simple clic gauche :
                    // décocher sans en choisir un autre à la place n'a pas de sens ici, on annule le
                    // décochage. La désélection volontaire se fait par clic DROIT (cf. contextmenu
                    // ci-dessous), un geste suffisamment distinct pour ne jamais être déclenché par
                    // erreur.
                    checkbox.checked = true;
                    return;
                }

                // Un seul projet visé à la fois : décocher les autres lignes.
                document.querySelectorAll('#projects-table-body .project-active-checkbox').forEach(cb => {
                    if (cb !== checkbox) cb.checked = false;
                });
                this.marquerProjetAOuvrir(checkbox);

                console.log(`☑️ Projet ${checkbox.dataset.projetId} - "${checkbox.dataset.projetNom}" coché — cliquez sur "Ouvrir mon projet" pour l'ouvrir`);
            });

            // Clic droit sur la case du projet ACTIF = désélection volontaire (cf. bug "le projet
            // actif se désélectionne tout seul" : la vraie cause était ailleurs — cf.
            // page_navigation.js — mais l'utilisateur doit aussi disposer d'un moyen explicite et
            // délibéré de désélectionner, plutôt que de dépendre d'un effet de bord accidentel).
            checkbox.addEventListener('contextmenu', async (e) => {
                e.preventDefault();
                if (!checkbox.checked) return; // seul le projet actif peut être désélectionné ainsi
                const projectName = checkbox.dataset.projetNom;
                const confirmed = confirm(
                    `Voulez-vous désélectionner le projet actif "${projectName}" ?\n` +
                    `Les données en cours seront d'abord sauvegardées.`
                );
                if (!confirmed) return;
                await this.deselectActiveProject();
            });
        });
    }

    /**
     * Bug rapporté : « la case cochée est sur un projet, la coche verte sur un autre — confusion à
     * l'ouverture ». Seul le projet OUVERT (current_projet_id) porte la coche verte ; une case cochée
     * sur un autre projet est une sélection en attente d'« Ouvrir mon projet » : ligne et case en
     * orange + badge « à ouvrir », jamais confondues avec le projet ouvert.
     * @param {HTMLInputElement} checkbox - case cochée
     */
    marquerProjetAOuvrir(checkbox) {
        const actif = localStorage.getItem('current_projet_id');
        document.querySelectorAll('#projects-table-body tr.projet-a-ouvrir').forEach((tr) => tr.classList.remove('projet-a-ouvrir'));
        document.querySelectorAll('#projects-table-body .projet-a-ouvrir-badge').forEach((b) => b.remove());
        const ligne = checkbox.closest('tr');
        if (!ligne || String(checkbox.dataset.projetId) === String(actif)) return;
        ligne.classList.add('projet-a-ouvrir');
        const cellNom = ligne.children[2];
        if (cellNom) {
            const badge = document.createElement('span');
            badge.className = 'projet-a-ouvrir-badge';
            badge.textContent = 'à ouvrir : cliquez sur « Ouvrir mon projet »';
            cellNom.appendChild(badge);
        }
    }

    /**
     * Désélectionne explicitement le projet actif (sauvegarde préalable puis nettoyage de l'état
     * local), déclenché uniquement par un clic droit délibéré sur la case "Actif" du projet en cours.
     */
    async deselectActiveProject() {
        try {
            if (window.calepinageService) {
                if (typeof window.calepinageService.saveToDatabase === 'function') {
                    try {
                        await window.calepinageService.saveToDatabase();
                    } catch (err) {
                        console.warn('Sauvegarde avant désélection impossible :', err);
                    }
                }
                if (typeof window.calepinageService.clearAllData === 'function') {
                    await window.calepinageService.clearAllData();
                }
            } else {
                localStorage.removeItem('current_projet_id');
                localStorage.removeItem('solarProjectData');
                localStorage.removeItem('solarProjectData_owner_id');
            }
            this.showMessage('Projet désélectionné.', 'success');
            setTimeout(() => window.location.reload(), 800);
        } catch (error) {
            console.error('Erreur lors de la désélection du projet:', error);
            this.showError('Erreur lors de la désélection du projet');
        }
    }

    /**
     * Attache les event listeners pour l'édition du nom du créateur
     */
    attachCreatorNameEvents() {
        // Event listener pour les inputs (sauvegarde au blur)
        document.querySelectorAll('.creator-name-input').forEach(input => {
            // Sauvegarde lors de la perte de focus
            input.addEventListener('blur', async (e) => {
                const projetId = parseInt(e.target.dataset.projetId);
                const newName = e.target.value.trim();

                if (newName && newName.length > 0) {
                    const success = await this.saveCreatorName(projetId, newName);
                    if (success) {
                        // Recharger la liste des projets pour afficher le nom mis à jour
                        this.loadProjects();
                    }
                }
            });

            // Sauvegarde lors de l'appui sur Enter
            input.addEventListener('keypress', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur(); // Déclenche l'événement blur
                }
            });
        });

        // Event listener pour les noms affichés (double-clic pour éditer)
        document.querySelectorAll('.creator-name-display').forEach(display => {
            display.addEventListener('dblclick', async (e) => {
                e.stopPropagation(); // Empêcher le double-clic de sélectionner le projet
                const projetId = parseInt(display.dataset.projetId);
                const currentName = display.querySelector('.creator-name-text').textContent.trim();

                // Transformer l'affichage en input
                const inputHtml = `
                    <input type="text"
                           class="form-control form-control-sm creator-name-input-inline"
                           value="${this.escapeHtml(currentName)}"
                           data-projet-id="${projetId}"
                           style="font-size: 0.85rem; padding: 4px 8px; text-align: center;"
                           autofocus>
                `;

                const td = display.closest('td');
                td.innerHTML = inputHtml;

                const input = td.querySelector('.creator-name-input-inline');
                input.focus();
                input.select();

                // Sauvegarde au blur
                input.addEventListener('blur', async () => {
                    const newName = input.value.trim();
                    if (newName && newName !== currentName) {
                        const success = await this.saveCreatorName(projetId, newName);
                        if (success) {
                            // Recharger la liste des projets
                            this.loadProjects();
                        }
                    } else {
                        // Restaurer l'affichage original
                        this.loadProjects();
                    }
                });

                // Sauvegarde sur Enter
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        input.blur();
                    }
                });
            });
        });
    }

    /**
     * Sélectionne un projet et charge ses données de calepinage
     * @param {number} projectId - ID du projet
     * @param {string} projectName - Nom du projet
     */
    async selectAndLoadProject(projectId, projectName) {
        try {
            console.log(`📦 Sélection du projet ${projectId} - "${projectName}"`);

            // ÉTAPE 1 : Sauvegarder les données du projet actuel (si existant). Échec : l'utilisateur
            // choisit (rester et réessayer, ou ouvrir quand même en perdant ces modifications).
            const enregistrement = await this.saveCurrentProjectBeforeSwitch();
            if (!this.confirmerMalgreEchecEnregistrement(enregistrement, `ouvrir le projet « ${projectName} »`)) {
                this.showMessage('Ouverture annulée : le projet en cours reste ouvert. Réessayez avec l\'icône « Sauvegarder ».', 'warning');
                return;
            }

            // CORRECTIF (bug rapporté : « le projet ouvert n'est pas celui sélectionné ») : le serveur
            // n'enregistre le calepinage que dans le projet actif de SA session
            // (_refus_projet_hors_session). Le projet est donc activé côté serveur AVANT de basculer
            // le navigateur ; en cas d'échec, rien n'est basculé (pas de page « à moitié » sur le
            // nouveau projet dont les sauvegardes partiraient ailleurs).
            if (window.calepinageService) {
                const activation = await window.calepinageService.activateOnServer(projectId);
                if (!activation || activation.success === false) {
                    this.showMessage(`Impossible d'ouvrir le projet "${projectName}" : activation refusée par le serveur. Aucune donnée n'a été modifiée.`, 'error');
                    return;
                }
            }
            // Le projet ouvert sera chargé dans la page : ses données s'enregistrent de nouveau.
            this.projetQuitteEnregistre = null;

            // ÉTAPE 2 : caches locaux du projet quitté oubliés (seule la base fait foi), puis ID et
            // nom du nouveau projet dans le localStorage
            oublierCachesProjetQuitte(localStorage.getItem('current_projet_id'));
            localStorage.setItem('current_projet_id', projectId);
            localStorage.setItem('current_projet_nom', projectName);
            console.log(`✅ Projet ${projectId} - "${projectName}" stocké dans localStorage`);

            // RÉGRESSION CORRIGÉE (2026-07-26) : une tentative précédente de fermer une fenêtre de
            // course ("beforeunload" ciblant l'ancien projet") avait ajouté ici une mise à jour
            // immédiate de calepinageService.currentProjetId vers le NOUVEAU projet — mais
            // localStorage.solarProjectData contient ENCORE les données de l'ANCIEN projet à cet
            // instant (rien ne le vide/remplace avant le rechargement de page ci-dessous). Si
            // 'beforeunload' se déclenchait pendant les ~500ms avant le reload, calepinageService
            // sauvegardait alors les données de l'ANCIEN projet, mais SOUS L'IDENTITÉ DU NOUVEAU
            // projet (currentProjetId déjà basculé) — copiant ainsi le calepinage d'un projet vers un
            // autre. C'est très exactement le bug "tous les projets ont les mêmes données" observé.
            // Ne JAMAIS désynchroniser currentProjetId de solarProjectData : les deux doivent changer
            // ensemble, ce qui n'arrive qu'au prochain chargement de page (initProjetId() +
            // loadFromDatabase(), qui remplace solarProjectData AVANT de mettre à jour currentProjetId).

            // (Projet déjà activé côté serveur juste avant l'ÉTAPE 2, cf. correctif ci-dessus.)

            // Nettoyer la session d'autoconsommation de l'ancien projet
            sessionStorage.removeItem('activeAutoconsoRate');
            localStorage.removeItem('solar_sim_data');
            localStorage.removeItem('solar_storage_data');

            // CORRECTIF (bug rapporté : "fuite de données — les maisons/champs PV du calepinage
            // résidentiel d'un projet apparaissent dans un autre projet") : contrairement à
            // solarProjectData (calepinage grands-projets, remplacé plus bas par
            // loadProjectCalepinage()), calepinage_maison_v1/calepinage_maison_polygons_v1 n'étaient
            // JAMAIS vidées lors d'un changement de projet actif (ni ici, ni dans le script de
            // réconciliation de index.html, qui ne se déclenche que si current_projet_id est encore
            // celui de l'ANCIEN projet — déjà remplacé par le NOUVEAU juste au-dessus). hydrateFrom-
            // DatabaseIfEmpty() (calepinage_maison_persistence_db.js) ne recharge la BD que si ces
            // clés sont VIDES : sans ce nettoyage, les maisons de l'ancien projet restaient donc en
            // cache et étaient redessinées telles quelles sur le nouveau projet par restorePolygons().
            localStorage.removeItem('calepinage_maison_v1');
            localStorage.removeItem('calepinage_maison_polygons_v1');
            localStorage.removeItem('calepinage_maison_owner_id');
            // CORRECTIF (bugs rapportés : "un PV2 vide en trop dans le formulaire" et "panneaux absents,
            // flèche mal orientée à l'ouverture d'un projet") : contours, onglets et états mémoire de
            // l'ANCIEN projet retirés DÈS la bascule, avant toute requête. Jusqu'ici, ils restaient en
            // place pendant les requêtes qui suivent : toute lecture faite entre-temps (totaux, report
            // des panneaux, sauvegarde automatique) reconstruisait pour ces anciens contours des états
            // par défaut, rangés sous l'id du nouveau projet et relus ensuite à la place de sa
            // sauvegarde ; et les onglets de l'ancien projet n'étaient jamais retirés.
            if (window.MaisonPolygonManagerInstance) window.MaisonPolygonManagerInstance.clearAllPolygons();
            const CMPurge = window.CalepinageMaisonIndiv;
            if (CMPurge && typeof CMPurge.purgerCachesProjet === 'function') CMPurge.purgerCachesProjet();
            if (window.tabManager && typeof window.tabManager.viderOnglets === 'function') window.tabManager.viderOnglets();
            // Loi APER : polygones/variables de l'ancien projet retirés, relus en base pour le nouveau
            // (évènement 'projetActifCharge' ci-dessous, ou chargement de la page).
            purgerLoiAperLocale();
            // Système hybride : on repart de zéro sur le projet sélectionné (pas de mélange de calculs).
            Object.keys(localStorage).filter((k) => k.startsWith('skv_systeme_hybride_')).forEach((k) => localStorage.removeItem(k));

            // ÉTAPE 3 : Fermer le modal pour révéler la carte de calepinage. CORRIGÉ (2026-08-07,
            // bug "flash de la carte puis retour au modal Paramètres") : ce modal est inclus sur
            // TOUTES les pages du parcours (cf. {% include %} dans index.html, systeme.html, etc.) en
            // tant que simple overlay — quand on est déjà sur '/concevoir_mon_projet/' (la carte de
            // calepinage), il n'y a donc RIEN à recharger : fermer le modal suffit à révéler la carte
            // en dessous. Un rechargement de page plein écran n'est nécessaire QUE si le modal a été
            // ouvert depuis une AUTRE page (Système, Export...), pour atteindre la carte.
            const modal = document.getElementById('parametres-modal');
            const onCalepinagePage = window.estPageAccueil();

            if (onCalepinagePage) {
                console.log('🔄 Chargement du projet sélectionné sur la carte (sans rechargement de page)...');

                // CORRECTIF (bug rapporté : "après création d'un projet Résidentielle, je dois
                // actualiser la page pour que la palette d'outils s'affiche correctement") :
                // window.ACTIVE_PROJECT_TYPOLOGIE n'est défini qu'au rendu serveur de la page (cf.
                // index.html) — sans rechargement de page, il reste sur la valeur de l'ANCIEN projet
                // actif. On le met à jour ici avec la typologie du projet qui vient de devenir actif,
                // puis on ré-applique le filtrage (boutons/panneau) en conséquence.
                try {
                    const projetResp = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}`);
                    const projetData = await projetResp.json();
                    if (projetData && projetData.success && projetData.projet) {
                        // Comparaison sur le PARCOURS (résidentiel vs Pro/Grand), pas sur la seule
                        // typologie : un projet "Site autonome" emprunte le parcours résidentiel quelle
                        // que soit sa typologie (demande explicite). Sans ça, passer d'un projet
                        // Professionnel connecté à un projet Professionnel site autonome ne déclenchait
                        // aucun rechargement, et l'UI restait sur la disposition Pro.
                        const etaitResidentiel = window.isResidentialPath();
                        const nouvelleTypologie = typeof window.normaliserTypologie === 'function'
                            ? window.normaliserTypologie(projetData.projet.typologie_projet)
                            : (projetData.projet.typologie_projet || '');
                        const nouveauTypeConnexion = projetData.projet.type_de_projet || '';
                        // Type d'étude (parcours Chiffrage) : même mise à jour sans rechargement.
                        const etaitChiffrage = typeof window.isChiffrageProject === 'function' && window.isChiffrageProject();
                        window.ACTIVE_PROJECT_TYPE_ETUDE = projetData.projet.type_etude || '';
                        const estChiffrage = typeof window.isChiffrageProject === 'function' && window.isChiffrageProject();
                        if (typeof window.appliquerParcoursChiffrage === 'function') window.appliquerParcoursChiffrage();
                        // Parcours mémorisé AVANT l'éventuel rechargement ci-dessous : la page rechargée
                        // affiche la bonne palette même si la session serveur n'a pas encore suivi.
                        if (typeof window.memoriserParcoursProjet === 'function') {
                            window.memoriserParcoursProjet(projectId, nouvelleTypologie, nouveauTypeConnexion, window.ACTIVE_PROJECT_TYPE_ETUDE);
                        }
                        const estResidentiel = nouvelleTypologie === window.TYPOLOGIE_RESIDENTIELLE
                            || nouveauTypeConnexion === window.TYPE_CONNEXION_HORS_LIGNE;

                        // CORRECTIF (bug rapporté : "l'UI Pro/Grand projet s'affiche pour un projet
                        // Résidentielle à l'ouverture") : le modal Études Économiques
                        // (ResidentielEtudeEcoView.js) ne bascule sa disposition standard <-> résidentielle
                        // qu'une seule fois, à window.onload, via de vrais déplacements DOM + attachement
                        // d'écouteurs, sans garde d'idempotence — le rejouer ici casserait le modal
                        // (doublons d'écouteurs). Un simple rafraîchissement de
                        // window.ACTIVE_PROJECT_TYPOLOGIE + de la palette d'outils ci-dessous ne suffit
                        // donc pas quand on CHANGE DE CATÉGORIE de typologie sans recharger la page : on
                        // force alors un rechargement complet (même mécanisme que la branche "pas déjà
                        // sur la carte" plus bas), qui repart d'un état JS propre pour les deux UI.
                        // Idem en entrant / sortant du parcours Chiffrage (modal éco en mode chiffrage).
                        if (etaitResidentiel !== estResidentiel || etaitChiffrage !== estChiffrage) {
                            sessionStorage.setItem('autoOpenParametresProjet', 'true');
                            window.location.href = `${window.SKV_URL_ACCUEIL}?activated_project=${encodeURIComponent(projectId)}`;
                            return;
                        }

                        window.ACTIVE_PROJECT_TYPOLOGIE = nouvelleTypologie;
                        // Maintenue en phase avec la typologie : elle est lue par window.isResidentialPath()
                        // (donc par la palette d'outils, le résumé de calepinage, l'étude économique et le
                        // rapport) et par le masquage de la section "Demande de courbe de charge".
                        window.ACTIVE_PROJECT_TYPE_CONNEXION = nouveauTypeConnexion;
                        // Lue par window.isPompageSolaireProject() (section Pompage solaire du calepinage).
                        window.ACTIVE_PROJECT_MODE_VALORISATION = projetData.projet.mode_de_valorisation || '';
                        // Boutons de retour de la carte (à la place de Système / Calculer et Visualiser).
                        if (typeof window.appliquerParcoursRetour === 'function') window.appliquerParcoursRetour();
                        if (typeof window.applyResidentialUIFiltering === 'function') {
                            window.applyResidentialUIFiltering();
                        }
                    }
                } catch (err) {
                    console.warn('Impossible de récupérer la typologie du projet actif pour rafraîchir la palette.', err);
                }
                // loadProjectCalepinage() vide déjà les formes visuelles de l'ANCIEN projet (cf.
                // calepinageService.loadFromDatabase(), dispatch "clearData") et remplace
                // localStorage.solarProjectData par les données du NOUVEAU projet — mais sans
                // rechargement de page, personne ne redessine les formes à partir de ces nouvelles
                // données : normalement, ce redessin est déclenché par storageManager.loadPageData()
                // au chargement de la page suivante (cf. GoogleMaps.js:initMap()). On le redéclenche
                // donc ici manuellement (même mécanisme, dispatch de l'évènement "loadData" écouté par
                // DrawingControl pour redessiner formes/lignes/cercles/textes), et on recentre la
                // carte sur le centre/zoom sauvegardés du nouveau projet.
                await this.loadProjectCalepinage(projectId);
                // Modules qui gardent en mémoire les saisies du projet précédent (étude économique,
                // cf. EtudesEconomiqueDB.js) : rechargement pour le nouveau projet.
                window.dispatchEvent(new CustomEvent('projetActifCharge', { detail: { projetId: projectId } }));

                // CORRECTIF (fuite de données calepinage maison entre projets) : même principe que
                // loadProjectCalepinage() ci-dessus pour le calepinage grands-projets — sans
                // rechargement de page, il faut retirer explicitement les contours de l'ANCIEN
                // projet affichés sur la carte, puis recharger/redessiner ceux du NOUVEAU projet
                // depuis la base (calepinage_maison_v1/calepinage_maison_polygons_v1 viennent d'être
                // vidées ci-dessus, donc hydrateFromDatabaseIfEmpty() ira bien chercher les données du
                // nouveau projet en base au lieu de sauter cette étape).
                const mgrMaison = window.MaisonPolygonManagerInstance;
                if (mgrMaison) {
                    mgrMaison.clearAllPolygons();
                    if (window.CalepinageMaisonPersistenceDB && typeof window.CalepinageMaisonPersistenceDB.hydrateFromDatabaseIfEmpty === 'function') {
                        await window.CalepinageMaisonPersistenceDB.hydrateFromDatabaseIfEmpty();
                    }
                    // États mémoire reconstruits pendant l'hydratation : purgés, relus depuis la
                    // sauvegarde du projet par restorePolygons (étiquettes et flèches comprises).
                    const CMRecharge = window.CalepinageMaisonIndiv;
                    if (CMRecharge && typeof CMRecharge.purgerCachesProjet === 'function') CMRecharge.purgerCachesProjet();
                    mgrMaison.restorePolygons();
                }

                if (window.storageManager && typeof window.storageManager.loadPageData === 'function') {
                    const pageData = await window.storageManager.loadPageData();
                    if (pageData && window.map) {
                        if (pageData.mapCenter) window.map.setCenter(pageData.mapCenter);
                        if (pageData.mapZoom) window.map.setZoom(pageData.mapZoom);
                    }
                }
                // Fin de restauration signalée comme au chargement de la page (cf. polygon_maison.js) :
                // onglets du formulaire, synchronisation du formulaire PRO, report des panneaux sur la
                // carte et onglet vide d'un projet sans champ s'y accrochent.
                if (mgrMaison) {
                    document.dispatchEvent(new CustomEvent('maisonShapesRestored', {
                        detail: { pvIds: mgrMaison.polygons.map((p) => p.maisonId).filter(Boolean) },
                    }));
                }
                // Zoome ensuite sur l'ADRESSE du projet (prioritaire sur le centre/zoom sauvegardé
                // ci-dessus, qui peut être une vue de travail quelconque sans rapport avec le site) à
                // un niveau proche du maximum (maxZoom:25 dans GoogleMaps.js) pour amener l'utilisateur
                // directement sur le site du projet.
                await this.zoomToProjectAddress(projectId);
                if (modal) modal.style.display = 'none';
                // Liste « Mes projets » rafraîchie : coche verte et case « Actif » sur le projet
                // désormais ouvert (plus de case cochée restée sur l'ancien).
                Promise.resolve(this.loadProjects()).catch(() => {});

                // CORRECTIF (bug rapporté : "après avoir fermé Consommation d'énergie, c'est
                // Paramètres qui reste en évidence dans le menu au lieu de Calepinage") : ce modal
                // Paramètres est masqué directement ci-dessus (modal.style.display = 'none'), sans
                // passer par la fermeture habituelle qui appelle restorePreviousMainNavStep() —
                // l'étape "mes-projets" restait donc active. L'étape suivante ouverte ci-dessous
                // l'aurait alors mémorisée comme étape précédente au lieu de "calepinage". On
                // restaure donc explicitement ici, AVANT de l'ouvrir.
                if (typeof window.restorePreviousMainNavStep === 'function') {
                    window.restorePreviousMainNavStep();
                }

                // Parcours (demande explicite) : Mes projets -> Paramètres projet -> Profil de
                // consommation -> Calepinage. Le projet ouvert enchaîne donc d'abord sur « Paramètres
                // projet » (sans rechargement : ce modal vit déjà sur cette page) ; son enregistrement
                // mène ensuite au Profil de consommation (cf. submitParametreProjet()).
                if (typeof window.openParametresProjet === 'function') {
                    window.openParametresProjet();
                } else if (typeof window.setActiveMainNavStep === 'function') {
                    window.setActiveMainNavStep('calepinage');
                }
            } else {
                console.log('🔄 Ouverture du projet sélectionné sur la carte...');
                this.showMessage(`Chargement du projet "${projectName}"...`, 'info');
                if (modal) modal.style.display = 'none';
                // Parcours (demande explicite) : l'ouverture d'un projet enchaîne sur « Paramètres
                // projet » — flag one-shot consommé par navigation-modales.js au prochain
                // DOMContentLoaded.
                sessionStorage.setItem('autoOpenParametresProjet', 'true');
                window.location.href = `${window.SKV_URL_ACCUEIL}?activated_project=${encodeURIComponent(projectId)}`;
            }

        } catch (error) {
            console.error('Erreur lors de la sélection du projet:', error);
            this.showMessage('Erreur lors de la sélection du projet', 'error');
        }
    }

    /**
     * Centre la carte principale sur l'adresse du projet donné, à un niveau de zoom proche du
     * maximum — même logique de parsing d'adresse que GoogleMaps.js (restauration du marqueur
     * d'adresse au chargement de page), réutilisée ici pour le flux "Ouvrir mon projet" qui ne
     * recharge pas la page.
     * @param {number} projectId
     */
    async zoomToProjectAddress(projectId) {
        if (!window.map) return;
        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}`);
            if (!response.ok) return;
            const data = await response.json();
            if (!data.success || !data.projet?.adresse_projet) return;

            // Parser robuste : gère les doubles sérialisations (cf. GoogleMaps.js)
            let d = data.projet.adresse_projet;
            for (let i = 0; i < 3 && typeof d === 'string'; i++) {
                try { d = JSON.parse(d); } catch (e) { break; }
            }
            if (d && typeof d === 'object' && !d.latitude && typeof d.adresse === 'string' && d.adresse.trim().startsWith('{')) {
                try { d = JSON.parse(d.adresse); } catch (e) { }
            }
            if (!d || typeof d !== 'object' || !d.latitude || !d.longitude) return;

            // Niveau de zoom proche du maximum (maxZoom: 25 défini sur la carte dans GoogleMaps.js).
            window.map.setCenter({ lat: d.latitude, lng: d.longitude });
            window.map.setZoom(21);
        } catch (error) {
            console.warn('Zoom sur l\'adresse du projet impossible :', error);
        }
    }

    /**
     * Enregistrement du projet quitté en échec : demande s'il faut continuer quand même.
     * @param {{ok?: boolean, message?: string}|undefined} enregistrement - résultat de saveCurrentProjectBeforeSwitch
     * @returns {boolean} true : continuer
     */
    confirmerMalgreEchecEnregistrement(enregistrement, action) {
        if (!enregistrement || enregistrement.ok !== false) return true;
        const nom = localStorage.getItem('current_projet_nom');
        return window.confirm(
            `Le projet en cours${nom ? ` « ${nom} »` : ''} n'a pas pu être enregistré entièrement.\n`
            + `${enregistrement.message || ''}\n\n`
            + `OK : ${action} quand même — les modifications non enregistrées seront perdues.\n`
            + 'Annuler : rester sur le projet en cours pour réessayer.');
    }

    /**
     * Sauvegarde les données du projet actuel avant de changer de projet
     */
    async saveCurrentProjectBeforeSwitch() {
        const currentProjetId = localStorage.getItem('current_projet_id');

        // Si aucun projet actuel, rien à sauvegarder
        if (!currentProjetId) {
            console.log('ℹ️ Aucun projet actuel à sauvegarder');
            return;
        }

        // Après création/modification d'un autre projet (submitParametreProjet) : le projet quitté a
        // été enregistré avant la bascule de session ; current_projet_id désigne déjà le nouveau projet,
        // pas encore chargé dans la page. Rien à renvoyer (sinon 409 « n'est plus le projet actif »).
        if (this.projetQuitteEnregistre && this.projetQuitteEnregistre === String(currentProjetId)) {
            console.log('ℹ️ Projet quitté déjà enregistré avant la création/modification du projet ' + currentProjetId);
            return { ok: true, skipped: true };
        }

        // Toutes les données du projet quitté (calepinages, Loi APER, devis, étude économique) :
        // même liste que l'icône « Sauvegarder » (services/sauvegarde_projet.js). Le formulaire
        // Paramètres n'est pas renvoyé ici (il peut déjà décrire le projet qu'on ouvre). Le résultat
        // est rendu à l'appelant ; un échec ne bloque pas le changement de projet (comportement
        // inchangé), il est signalé.
        if (window.SauvegardeProjet && typeof window.SauvegardeProjet.enregistrerDonnees === 'function') {
            // Bug rapporté (2026-10-24, « le projet ouvert dans cette page (59) n'est plus le projet
            // actif (62) ») : la session serveur peut déjà avoir basculé sur un autre projet (création,
            // modification d'un autre projet, chargement d'un calepinage...) avant cet enregistrement,
            // et toutes les écritures du projet quitté étaient refusées (409). On remet d'abord la
            // session sur le projet de la page ; l'appelant activera ensuite le projet ouvert.
            if (window.calepinageService && typeof window.calepinageService.activateOnServer === 'function') {
                const activation = await window.calepinageService.activateOnServer(currentProjetId);
                if (!activation || activation.success === false) {
                    console.warn(`⚠️ Session non remise sur le projet ${currentProjetId} avant enregistrement :`, activation && activation.message);
                }
            }
            const res = await window.SauvegardeProjet.enregistrerDonnees({ parametres: false });
            if (!res.ok) console.warn(`⚠️ Projet ${currentProjetId} enregistré partiellement avant changement :`, res.message);
            return res;
        }
        console.warn('⚠️ services/sauvegarde_projet.js absent : projet non enregistré avant changement');
        return { ok: false, message: 'Enregistrement indisponible.' };
    }

    /**
     * Charge les données de calepinage d'un projet
     * @param {number} projectId - ID du projet
     */
    async loadProjectCalepinage(projectId) {
        try {
            console.log(`🔄 Chargement des données de calepinage pour le projet ${projectId}...`);

            // Charger les données de calepinage depuis la base de données
            // Le CalepinageDataService se charge de tout :
            // - Nettoyer les formes visuelles
            // - Vider le localStorage
            // - Charger les nouvelles données
            // - Définir le projet courant
            if (window.calepinageService) {
                const result = await window.calepinageService.loadFromDatabase(projectId);
                if (result.success) {
                    console.log(`✅ Données de calepinage chargées pour le projet ${projectId}`);
                } else {
                    console.log(`ℹ️ Pas de données de calepinage existantes pour le projet ${projectId} (projet vide)`);
                }
            } else {
                console.warn('⚠️ CalepinageService non disponible');
            }
        } catch (error) {
            console.error('Erreur lors du chargement du calepinage:', error);
        }
    }

    /**
     * Ferme le modal si un projet est sélectionné
     */
    closeModalIfProjectSelected() {
        const currentProjetId = localStorage.getItem('current_projet_id');

        if (currentProjetId) {
            const modal = document.getElementById('parametres-modal');
            if (modal) {
                modal.style.display = 'none';
                console.log('✅ Modal fermé - Projet sélectionné');
            }
        } else {
            this.showMessage('Il faut créer un projet pour accéder au reste de l\'application', 'warning');
        }
    }

    /**
     * Voir les détails d'un projet
     * @param {number} projectId - ID du projet
     */
    async viewProjectDetails(projectId) {
        if (window.shareManager2 && typeof window.shareManager2.viewProjectDetails === 'function') {
            window.shareManager2.viewProjectDetails(projectId);
        } else {
            console.error('ShareManager2 non disponible');
        }
    }

    /**
     * Puissance projet (kWc) de la colonne « Puissance projet (kWc) » : valeur FIGÉE en base au
     * dernier « Calculer et visualiser », export ou « Sauvegarder le projet » (cf.
     * puissance_projet_sync.js, route .../puissance-projet), recalculée par le serveur depuis le
     * calepinage enregistré. Jamais calculé ni exporté -> null (tiret). Le localStorage n'est jamais lu.
     * @param {object} projet
     * @returns {number|null}
     */
    computeProjectKwc(projet) {
        const kwc = Number(projet && projet.puissance_projet_kwc);
        return projet && projet.puissance_projet_kwc != null && Number.isFinite(kwc) && kwc > 0
            ? Math.round(kwc * 100) / 100 : null;
    }

    /**
     * true si le calepinage a changé depuis que la puissance a été figée : écart avec la puissance du
     * calepinage enregistré (puissance_calepinage_kwc, calculée par le serveur), ou, pour le projet
     * actif, modifications locales pas encore enregistrées (module de calepinage résidentiel).
     */
    isPuissanceProjetPerimee(projet, puissanceKwc) {
        if (puissanceKwc === null) return false;
        const enBase = Number(projet.puissance_calepinage_kwc) || 0;
        if (Math.abs(enBase - puissanceKwc) > 0.01) return true;
        const persistance = window.CalepinageMaisonPersistenceDB;
        return String(projet.id) === String(localStorage.getItem('current_projet_id'))
            && !!persistance && typeof persistance.modificationsNonEnregistreesConnues === 'function'
            && persistance.modificationsNonEnregistreesConnues();
    }

    renderPuissanceProjetCell(projet, puissanceKwc) {
        if (puissanceKwc === null) {
            return `<td class="text-center" title="Puissance non calculée : cliquez sur « Calculer et visualiser » ou exportez un rapport">—</td>`;
        }
        const valeur = puissanceKwc.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' kWc';
        const date = projet.puissance_projet_maj_le ? this.formatDate(projet.puissance_projet_maj_le) : '';
        if (!this.isPuissanceProjetPerimee(projet, puissanceKwc)) {
            return `<td class="text-center" title="Puissance du calepinage au dernier calcul ou export${date ? ' (' + date + ')' : ''}">${valeur}</td>`;
        }
        return `<td class="text-center" title="Le calepinage a été modifié depuis le dernier calcul${date ? ' (' + date + ')' : ''} : cliquez sur « Calculer et visualiser » pour actualiser la puissance">
            ${valeur}<br><span class="badge bg-warning text-dark" style="font-weight: 500; white-space: normal;">Modifié : cliquez sur Calculer</span>
        </td>`;
    }

    parseAdresseSimple(adresseProjet) {
        if (!adresseProjet) return 'Non renseignée';

        let current = adresseProjet;
        let attempts = 0;
        const maxAttempts = 5;

        // Parser récursivement jusqu'à trouver l'adresse ou atteindre la limite
        while (attempts < maxAttempts) {
            attempts++;

            // Si c'est une chaîne JSON, la parser
            if (typeof current === 'string' && current.trim().startsWith('{')) {
                try {
                    current = JSON.parse(current);
                } catch (e) {
                    break;
                }
            }
            // Si c'est une chaîne normale (adresse finale)
            else if (typeof current === 'string') {
                return current.replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
            }
            // Si c'est un objet, chercher la clé "adresse"
            else if (typeof current === 'object' && current !== null) {
                if (current.adresse) {
                    current = current.adresse;
                } else if (current.adresse_projet) {
                    current = current.adresse_projet;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        return 'Adresse non spécifiée';
    }

    setupSearchAndFilters() {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            let debounceTimer;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    this.loadProjects(e.target.value);
                }, 300);
            });
        }
    }

    async viewProject(projectId) {
        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}`);
            const data = await response.json();

            if (data.success) {
                this.showProjectDetails(data.projet);
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Impossible de charger le projet');
        }
    }

    showProjectDetails(projet) {
        const typeProjetData = this.resolveSelectCustomValue('type_projet_select', projet.type_projet_select || projet.type_projet, 'Ombrière');
        const typeOuvrageData = this.resolveSelectCustomValue('type_ouvrage', projet.type_ouvrage, '');
        const natureTravauxData = this.resolveSelectCustomValue('nature_des_traveaux', projet.nature_des_traveaux, '');

        const fields = {
            'nom_projet': projet.nom_projet || projet.nom || '',
            'charge_etudes': projet.charge_etudes || '',
            'type_de_projet': projet.type_de_projet,
            'mode_de_valorisation': projet.mode_de_valorisation,
            'type_projet_select': typeProjetData.value,
            'autre_type_projet_select': typeProjetData.customValue,
            'type_ouvrage': typeOuvrageData.value,
            'autre_type_ouvrage': typeOuvrageData.customValue,
            'nature_des_traveaux': natureTravauxData.value,
            'autre_nature_des_traveaux': natureTravauxData.customValue,
            'date_livrable': projet.date_livrable,
            'parametreProjectSearch': projet.adresse_projet,
            'pays': projet.pays,
            'input_zone_de_vent': projet.zone_de_vent,
            'input_categorie_de_terrain': projet.categorie_de_terrain,
            'input_zone_de_neige': projet.zone_de_neige,
            'input_zone_sismique': projet.zone_sismique,
            'niv_keraunique': projet.niveau_keraunique
        };

        Object.entries(fields).forEach(([fieldId, value]) => {
            const element = document.querySelector('#form_parametre_projet #' + fieldId) || document.getElementById(fieldId);
            if (element && value !== undefined && value !== null) {
                element.value = value;
            }
        });

        const button = document.getElementById('button_parametre_projet');
        if (button) button.click();
    }

    async editProject(projectId) {
        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}`);
            const data = await response.json();

            if (data.success) {
                const projet = data.projet;

                // Fermer le modal de détails s'il est ouvert
                if (window.shareManager2) {
                    window.shareManager2.closeDetailModal();
                }

                // IMPORTANT : marquer le mode édition AVANT de changer d'onglet. Sinon, toute
                // logique déclenchée par le changement d'onglet (ex: UIManager.switchToSection,
                // qui purge le calepinage si aucune édition n'est en cours) lit #projet_id_edit
                // alors qu'il n'existe pas encore, et le confond avec la création d'un nouveau
                // projet — supprimant les panneaux du projet qu'on vient d'ouvrir pour modification.
                let hiddenInput = document.getElementById('projet_id_edit');
                if (!hiddenInput) {
                    hiddenInput = document.createElement('input');
                    hiddenInput.type = 'hidden';
                    hiddenInput.id = 'projet_id_edit';
                    hiddenInput.name = 'projet_id';
                    const form = document.getElementById('form_parametre_projet');
                    if (form) form.appendChild(hiddenInput);
                }
                hiddenInput.value = projectId;

                // NOUVEAU (demande explicite) : affiche "Sauvegarder" (onglet "Informations projet"),
                // masqué par défaut puisque réservé au mode édition — cf. resetForm() qui le remasque.
                this.updateSauvegarderInformationsProjetVisibility();

                // Passer à l'onglet "Paramètres projet"
                this.switchToParametreProjetTab();

                // Un délai permet de s'assurer qu'aucun événement asynchrone de transition d'onglet
                // ne videra le formulaire avant qu'il ne soit rempli.
                setTimeout(() => {
                    this.fillFormWithProjectData(projet);
                    this.parametresModifies = false;
                    this.showSuccess('Projet chargé pour modification');
                }, 150);
            } else {
                this.showError('Impossible de charger le projet');
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Erreur de connexion');
        }
    }

    switchToParametreProjetTab() {
        // ✅ Utiliser la méthode de navigation propre de UIManager
        if (window.uiManagerInstance && typeof window.uiManagerInstance.switchToSection === 'function') {
            window.uiManagerInstance.switchToSection('button_parametre_projet');
            console.log('✅ Navigation vers "Paramètres projet" pour édition');
        } else {
            // Fallback : manipulation directe si UIManager non disponible
            const paramBtn = document.getElementById('button_parametre_projet');
            if (paramBtn) {
                paramBtn.click();
            }

            // Alternative : manipulation directe
            const tabButtons = document.querySelectorAll('.nav-link');
            const tabContents = ['mes_projets', 'parametre_projet'];

            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(contentId => {
                const content = document.getElementById(contentId);
                if (content) content.style.display = 'none';
            });

            // Activer l'onglet paramètres
            if (tabButtons[1]) tabButtons[1].classList.add('active');
            const paramContent = document.getElementById('parametre_projet');
            if (paramContent) paramContent.style.display = 'block';
        }
    }

    fillFormWithProjectData(projet) {
        const typeProjetData = this.resolveSelectCustomValue('type_projet_select', projet.type_projet_select || projet.type_projet, 'Ombrière');
        const typeOuvrageData = this.resolveSelectCustomValue('type_ouvrage', projet.type_ouvrage, '');
        const natureTravauxData = this.resolveSelectCustomValue('nature_des_traveaux', projet.nature_des_traveaux, '');

        // Mapper les champs du projet vers les inputs du formulaire
        const fieldMapping = {
            'nom_projet': projet.nom_projet || projet.nom || '',
            'charge_etudes': projet.charge_etudes || '',
            'type_de_projet': projet.type_de_projet,
            'mode_de_valorisation': projet.mode_de_valorisation,
            'option_reseau': projet.option_reseau,
            'type_projet_select': typeProjetData.value,
            'autre_type_projet_select': typeProjetData.customValue || projet.autre_type_projet_select,
            'type_ouvrage': typeOuvrageData.value,
            'autre_type_ouvrage': typeOuvrageData.customValue || projet.autre_type_ouvrage,
            'nature_des_traveaux': natureTravauxData.value,
            'autre_nature_des_traveaux': natureTravauxData.customValue || projet.autre_nature_des_traveaux,
            'date_livrable': projet.date_livrable,
            'pays': projet.pays,
            'input_zone_de_vent': projet.zone_de_vent,
            'input_categorie_de_terrain': projet.categorie_de_terrain,
            'input_zone_de_neige': projet.zone_de_neige,
            'input_zone_sismique': projet.zone_sismique,
            'niv_keraunique': projet.niveau_keraunique
        };

        // Remplir les champs simples (scoped au formulaire pour éviter les collisions d'ID avec d'autres modales)
        Object.entries(fieldMapping).forEach(([fieldId, value]) => {
            const element = document.querySelector('#form_parametre_projet #' + fieldId) || document.getElementById(fieldId);
            if (element && value !== undefined && value !== null) {
                element.value = value;

                if (element.tagName === 'SELECT') {
                    element.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (element.tagName === 'INPUT') {
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        });

        if (projet.adresse_projet) {
            const adresseInput = document.getElementById('parametreProjectSearch');
            const adresseHidden = document.getElementById('parametre_project_hidden');

            if (adresseInput) {
                const adresse = this.parseAdresseSimple(projet.adresse_projet);
                adresseInput.value = adresse;
            }
            if (adresseHidden) {
                adresseHidden.value = projet.adresse_projet;
            }

            // Restaurer le marker sur la carte modale (si déjà initialisée)
            try {
                let d = projet.adresse_projet;
                for (let i = 0; i < 3 && typeof d === 'string'; i++) {
                    try { d = JSON.parse(d); } catch (e) { break; }
                }
                // Cas du bug historique : {"adresse": "<json string avec lat/lng>"}
                if (d && typeof d === 'object' && !d.latitude && typeof d.adresse === 'string' && d.adresse.trim().startsWith('{')) {
                    try { d = JSON.parse(d.adresse); } catch (e) { }
                }
                if (d && typeof d === 'object' && d.latitude && d.longitude) {
                    const addressSearch = window.parametreProjetManager?.addressSearch;
                    if (addressSearch) {
                        addressSearch.addOrUpdateParametreMarker(d.latitude, d.longitude, d.adresse || '', d.adresse_complete);
                    }
                }
            } catch (e) {
                console.warn('Impossible de restaurer le marker adresse:', e);
            }
        }

        if (projet.environnement_salin) {
            const salinCheckbox = document.getElementById('environnementSalin');
            if (salinCheckbox) {
                salinCheckbox.checked = true;
            }
        }

        this.selectProjectTypeCard(projet.type_de_projet);
        this.selectValorisationCard(projet.mode_de_valorisation);
        this.selectEtudeCard(projet.type_etude);
        this.selectTypologieCard(projet.typologie_projet);
        // Site autonome : profil consommateur enregistré ; un projet antérieur (sans profil) en
        // « Alimentation en électricité » et Résidentielle reçoit Habitation, son équivalent.
        // Autre typologie du système : aucun profil (il ne fixe la typologie qu'en Alimentation).
        if (document.getElementById('step_profil_consommateur')) {
            const alimentation = projet.mode_de_valorisation === TYPOLOGIE_SYSTEME_ALIMENTATION;
            const habitationParDefaut = alimentation && projet.typologie_projet === window.TYPOLOGIE_RESIDENTIELLE;
            this.selectProfilConsommateurCard(alimentation ? (projet.option_reseau || (habitationParDefaut ? PROFIL_HABITATION : '')) : '');
            this.updateProfilConsommateurVisibility(projet.mode_de_valorisation);
        }
        // Re-appliqué APRÈS selectTypologieCard() : celle-ci vient de restaurer la typologie
        // enregistrée, qui peut être "Grand projet" sur un projet hors-ligne créé avant que cette
        // combinaison ne soit interdite. La carte serait alors masquée mais toujours sélectionnée
        // (et donc resauvegardée telle quelle) — ce second passage la désélectionne et force
        // l'utilisateur à choisir l'une des deux typologies proposées pour un site autonome.
        this.updateTypologieVisibilityForConnexion(projet.type_de_projet);

        this.updateClimateButtons(projet);
    }

    async deleteProject(projectId) {
        if (!confirm('Êtes-vous sûr de vouloir supprimer ce projet ?')) {
            return;
        }

        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccess('Projet supprimé avec succès');

                // CORRECTIF (bug rapporté : "le projet supprimé reste ouvert/affiché même après
                // actualisation de la page", cas du calepinage maison résidentielle) : le calepinage
                // résidentiel (calepinage_maison_v1/calepinage_maison_polygons_v1) et le calepinage
                // grands-projets (solarProjectData...) vivent dans des clés localStorage GLOBALES,
                // jamais scopées par projet — les supprimer côté serveur (DB) ne les efface donc
                // jamais côté client. Un simple rechargement de page ne change rien : le navigateur
                // redessine toujours ce qui traîne dans ces clés, quel que soit le projet réellement
                // actif côté serveur. Si le projet supprimé était le projet actif localement, on vide
                // tout ici et on recharge pour repartir d'un état propre.
                // Saisies PAC / climatiseur du projet supprimé (clés skv_pac_<utilisateur>_<projet>).
                Object.keys(localStorage).filter((k) => k.startsWith('skv_pac_') && k.endsWith(`_${String(projectId).replace(/[^A-Za-z0-9-]/g, '')}`))
                    .forEach((k) => localStorage.removeItem(k));
                const currentProjetId = localStorage.getItem('current_projet_id');
                if (currentProjetId && String(currentProjetId) === String(projectId)) {
                    localStorage.removeItem('current_projet_id');
                    localStorage.removeItem('current_projet_nom');
                    localStorage.removeItem('solarProjectData');
                    localStorage.removeItem('solarProjectData_owner_id');
                    localStorage.removeItem('solar_sim_data');
                    localStorage.removeItem('solar_storage_data');
                    localStorage.removeItem('calepinage_maison_v1');
                    localStorage.removeItem('calepinage_maison_polygons_v1');
                    localStorage.removeItem('calepinage_maison_owner_id');
                    Object.keys(localStorage).filter((k) => k.startsWith('skv_systeme_hybride_')).forEach((k) => localStorage.removeItem(k));
                    sessionStorage.removeItem('activeAutoconsoRate');
                    purgerLoiAperLocale();
                    window.location.reload();
                    return;
                }

                this.loadProjects();
            } else {
                this.showError(data.message || 'Erreur lors de la suppression');
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Erreur de connexion');
        }
    }

    /**
     * Sélectionne un projet pour associer automatiquement les calepinages futurs
     */
    async selectProjectForCalepinage(projectId, projectName) {
        try {
            // Vérifier si le service est disponible
            if (!window.calepinageService) {
                this.showError('Service de calepinage non disponible');
                console.error('CalepinageDataService non chargé');
                return;
            }

            // Vérifier s'il y a un projet déjà sélectionné
            const currentProjetId = window.calepinageService.getCurrentProjetId();

            if (currentProjetId && currentProjetId !== projectId) {
                // Un autre projet est déjà sélectionné, demander confirmation
                const confirmed = confirm(
                    `⚠️ Attention !\n\n` +
                    `Un projet est déjà sélectionné.\n` +
                    `En sélectionnant "${projectName}", les données de calepinage actuelles seront effacées ` +
                    `et remplacées par celles de ce projet.\n\n` +
                    `Voulez-vous continuer ?`
                );

                if (!confirmed) {
                    console.log('❌ Sélection annulée par l\'utilisateur');
                    return;
                }

                // Effacer les données du localStorage
                console.log('🗑️ Effacement des données de calepinage actuelles...');
                localStorage.removeItem('solarProjectData');
                localStorage.removeItem('solarProjectData_owner_id');
                sessionStorage.removeItem('activeAutoconsoRate');
                localStorage.removeItem('solar_sim_data');
                localStorage.removeItem('solar_storage_data');
            }

            // Définir le projet courant
            window.calepinageService.setCurrentProjet(projectId);

            // Charger les données du projet depuis la base de données
            this.showInfo(`Chargement des données du projet "${projectName}"...`);

            const result = await window.calepinageService.loadFromDatabase(projectId);

            if (result.success) {
                // Mettre à jour l'affichage visuel
                this.updateSelectedProjectDisplay(projectId);

                // Notification de succès
                this.showSuccess(
                    `✅ Projet "${projectName}" sélectionné et chargé avec succès.\n` +
                    `Les nouveaux calepinages seront sauvegardés dans ce projet.`
                );

                console.log(`✅ Projet ${projectId} sélectionné et données chargées`);

                // Recharger la page pour afficher les données
                setTimeout(() => {
                    window.location.reload();
                }, 1500);

            } else {
                // Pas de données existantes, juste sélectionner le projet
                this.updateSelectedProjectDisplay(projectId);

                this.showSuccess(
                    `✅ Projet "${projectName}" sélectionné.\n` +
                    `Aucune donnée de calepinage existante. Vous pouvez commencer à dessiner.`
                );

                console.log(`✅ Projet ${projectId} sélectionné (pas de données existantes)`);

                // Recharger la page pour nettoyer la carte
                if (currentProjetId && currentProjetId !== projectId) {
                    setTimeout(() => {
                        window.location.reload();
                    }, 1500);
                }
            }

        } catch (error) {
            console.error('Erreur lors de la sélection du projet:', error);
            this.showError('Erreur lors de la sélection du projet');
        }
    }

    /**
     * Met à jour l'affichage visuel du projet sélectionné
     */
    updateSelectedProjectDisplay(selectedProjectId) {
        // Réinitialiser toutes les lignes du tableau
        document.querySelectorAll('#projects-table-body tr').forEach(row => {
            row.classList.remove('projet-selected');
        });

        // Mettre en évidence la ligne du projet sélectionné
        const selectedRow = document.querySelector(`#projects-table-body tr[data-projet-id="${selectedProjectId}"]`);
        if (selectedRow) {
            selectedRow.classList.add('projet-selected');
            console.log(`✅ Ligne du projet ${selectedProjectId} mise en évidence`);
        }
        this.majBoutonSuivantMesProjets();
    }

    /**
     * Charge les données de calepinage depuis la base de données
     */
    async loadCalepinageData(projectId) {
        try {
            // Vérifier si le service est disponible
            if (!window.calepinageService) {
                this.showError('Service de calepinage non disponible');
                console.error('CalepinageDataService non chargé');
                return;
            }

            // Afficher notification de chargement
            this.showInfo('Chargement des données de calepinage...');

            // Charger les données depuis la base de données
            const result = await window.calepinageService.loadFromDatabase(projectId);

            if (result.success) {
                this.showSuccess(`Données de calepinage chargées avec succès`);

                // Parcours (demande explicite) : cette ouverture de projet (bouton "Charger le
                // calepinage" du détail projet, cf. shareManager.js) enchaîne elle aussi sur
                // « Paramètres projet », comme les autres points d'entrée d'ouverture de projet
                // (selectAndLoadProject()). On réutilise le paramètre d'URL 'activated_project'
                // plutôt qu'un simple reload() : loadFromDatabase() ci-dessus a déjà positionné
                // current_projet_id via setCurrentProjet(), mais ce paramètre reste la façon fiable de
                // le confirmer au prochain chargement (cf. race déjà documentée ailleurs dans ce fichier).
                sessionStorage.setItem('autoOpenParametresProjet', 'true');
                setTimeout(() => {
                    window.location.href = `${window.SKV_URL_ACCUEIL}?activated_project=${encodeURIComponent(projectId)}`;
                }, 1000);
            } else {
                this.showError(result.message || 'Aucune donnée de calepinage trouvée pour ce projet');
            }

        } catch (error) {
            console.error('Erreur lors du chargement du calepinage:', error);
            this.showError('Erreur lors du chargement des données de calepinage');
        }
    }

    async changeProjectStatus(projectId, newStatus) {
        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}/statut`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ statut: newStatus })
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccess('Statut mis à jour');
                this.loadProjects();
            } else {
                this.showError(data.message);
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Erreur lors de la mise à jour du statut');
        }
    }
    selectProjectTypeCard(typeProjet) {
        if (!typeProjet) return;

        const cardId = typeProjet === 'connecte' ? 'id_projet_connecter' : 'id_projet_non_connecter';
        const card = document.getElementById(cardId);

        if (card) {
            document.querySelectorAll('.connexion-projet').forEach(c => {
                c.classList.remove('selected', 'active');
            });

            card.classList.add('selected', 'active');

            // CORRECTIF (bug rapporté : "les options pour site autonome ne s'affichent pas tout le
            // temps") : cette méthode posait un `style.display` inline, sans effet tant que
            // #options_hors_ligne portait `d-none` (display:none !important) — et surtout en
            // concurrence avec la classe `.active` basculée par le handler de clic. Une seule et
            // même méthode pilote désormais les deux chemins.
            this.applyConnexionProjetToUi(typeProjet);

            // Mettre à jour la valeur du champ caché (nécessaire en mode édition)
            const hiddenInput = document.querySelector('#form_parametre_projet #type_de_projet') || document.getElementById('type_de_projet');
            if (hiddenInput) hiddenInput.value = typeProjet;
        }
    }
    /**
     * Valeurs par défaut d'un NOUVEAU projet, posées à la remise à zéro du formulaire (clic sur
     * « Créer un projet », cf. ParametresProjet.js::switchToSection), d'après le parcours ouvert depuis
     * Solakvan (window.SKV_PARCOURS, cf. app/utils/parcours.py) :
     *  - type de connexion : connecté au réseau (PRO, Résidentiel) ou site autonome ;
     *  - typologie : Résidentielle (avec ses valeurs par défaut : Autoconsommation individuelle,
     *    Maison résidentielle, bâtiment existant, Toiture — cf. applyResidentialDefaults) ou
     *    Professionnelle (C&I) (Autoconsommation individuelle, comme au clic sur sa carte) ;
     *  - type d'étude : Chiffrage (PRO) ou Étude technico-économique.
     * Mêmes méthodes que la sélection manuelle et que la restauration d'un projet existant : champs
     * cachés, cartes surlignées et sections affichées restent cohérents.
     */
    applyNewProjectDefaults() {
        const parcours = window.SKV_PARCOURS || {};
        const typeDeProjet = parcours.type_de_projet || 'connecte';
        const typologie = parcours.typologie_defaut || window.TYPOLOGIE_RESIDENTIELLE || 'Résidentielle';
        const ancienMode = this.lireModeDeValorisation();
        this.selectProjectTypeCard(typeDeProjet);
        if (parcours.type_etude_defaut) this.selectEtudeCard(parcours.type_etude_defaut);
        this.selectTypologieCard(typologie);
        if (typologie === window.TYPOLOGIE_RESIDENTIELLE) {
            this.applyResidentialDefaults();
        } else if (typeDeProjet !== 'hors-ligne') {
            this.selectValorisationCard('Autoconsommation individuelle');
        }
        this.notifierChangementModeValorisation(ancienMode);
    }

    /**
     * Applique applyNewProjectDefaults() UNIQUEMENT si le formulaire est celui d'un nouveau projet
     * encore vierge : pas de projet en cours d'édition (#projet_id_edit vide) et aucun type de
     * connexion choisi. Ne remplace donc jamais une saisie en cours ni les valeurs d'un projet
     * existant. Appelée au clic sur « Créer un projet » (parametre.html), indépendamment de la
     * purge de switchToSection() — qui peut ne pas s'exécuter (onglet considéré déjà affiché).
     * @returns {boolean} true si les valeurs par défaut ont été posées
     */
    appliquerDefautsNouveauProjetSiVierge() {
        const idEdition = document.getElementById('projet_id_edit');
        if (idEdition && idEdition.value) {
            console.info("[Nouveau projet] Valeurs par défaut non appliquées : projet en cours d'édition (id " + idEdition.value + ").");
            return false;
        }
        // Formulaire vierge = aucune carte de type de connexion sélectionnée. Le champ caché #type_de_projet
        // n'est PAS un indicateur fiable : form.reset() ne vide pas un champ caché dont la valeur a été posée
        // par script (sa valeur par défaut suit la valeur écrite). Après « Annuler » ou une fermeture du
        // modal, il gardait « connecte » : les valeurs par défaut (dont type de projet « Toiture ») n'étaient
        // plus posées et le formulaire restait sur « Ombrière », première option de la liste.
        const carteChoisie = document.querySelector('.connexion-projet.selected');
        if (carteChoisie) {
            console.info('[Nouveau projet] Valeurs par défaut non appliquées : type de connexion déjà choisi (' + (carteChoisie.dataset.type || '?') + ').');
            return false;
        }
        this.applyNewProjectDefaults();
        console.info('[Nouveau projet] Valeurs par défaut du parcours appliquées :', (window.SKV_PARCOURS || {}).code || 'pro');
        return true;
    }

    lireModeDeValorisation() {
        const hidden = document.querySelector('#form_parametre_projet #mode_de_valorisation') || document.getElementById('mode_de_valorisation');
        return hidden ? hidden.value : '';
    }

    /**
     * Mode de valorisation posé PAR PROGRAMME (et non par un clic de carte) : prévient la section
     * « demande de courbe de charge » (Switchgrid, parametre.html::_sgOnModeChange), qui ne réagit
     * sinon qu'au clic sur une carte — elle resterait masquée alors que le mode est
     * "Autoconsommation individuelle". Uniquement si le mode a RÉELLEMENT changé : _sgOnModeChange
     * recrée les lignes client et effacerait une saisie en cours.
     */
    notifierChangementModeValorisation(ancienMode) {
        const nouveauMode = this.lireModeDeValorisation();
        if (nouveauMode === ancienMode) return;
        if (typeof window._sgOnModeChange === 'function') window._sgOnModeChange(nouveauMode);
    }

    /**
     * Applique les valeurs par défaut d'un projet "Résidentielle" (demande explicite) : mode de
     * valorisation = Autoconsommation individuelle, classification de l'ouvrage = Maison
     * résidentielle, nature des travaux = Installation sur bâtiment existant, type de projet =
     * Toiture. Purement indicatif — l'utilisateur reste libre de modifier chacun de ces champs
     * ensuite, rien n'est verrouillé/désactivé.
     */
    applyResidentialDefaults() {
        // #type_projet_select (et par prudence les 3 autres) : id partagé avec un <select> du même
        // nom dans un AUTRE modal (Liste de matériel, cf. liste_de_materiels.html) — même précaution
        // que le reste de ce fichier (cf. buildParametreProjetFormData()) : toujours privilégier
        // l'élément scopé à #form_parametre_projet pour éviter de cibler le mauvais élément.
        const getField = (id) => document.querySelector('#form_parametre_projet #' + id) || document.getElementById(id);

        // Site autonome : les options hors ligne (Habitation, Système hybride, Pompage solaire)
        // partagent #mode_de_valorisation ; « Autoconsommation individuelle » y écraserait le choix.
        const typeConnexion = getField('type_de_projet');
        const modeDeValorisation = getField('mode_de_valorisation');
        if (modeDeValorisation && !(typeConnexion && typeConnexion.value === 'hors-ligne')) {
            modeDeValorisation.value = 'Autoconsommation individuelle';
            this.selectValorisationCard('Autoconsommation individuelle');
        }

        const typeOuvrage = getField('type_ouvrage');
        if (typeOuvrage) {
            typeOuvrage.value = 'Maison Résidentielle';
            typeOuvrage.dispatchEvent(new Event('change'));
        }

        const natureDesTraveaux = getField('nature_des_traveaux');
        if (natureDesTraveaux) {
            natureDesTraveaux.value = 'existante';
            natureDesTraveaux.dispatchEvent(new Event('change'));
        }

        const typeProjetSelect = getField('type_projet_select');
        if (typeProjetSelect) {
            typeProjetSelect.value = 'Toiture';
            typeProjetSelect.dispatchEvent(new Event('change'));
        }
    }

    /**
     * Applique un type de connexion (connecte / hors-ligne) à l'interface : bascule les deux
     * sections d'options — `.step_projet_connecter` ("Mode de valorisation de l'électricité") et
     * `.step_projet_non_connecter` ("Options pour projet hors ligne") — via la SEULE classe
     * `.active` (cf. .step/.step.active dans menu_list.css), et ajuste les typologies proposées.
     *
     * Point d'entrée unique, partagé par le clic utilisateur (setupProjectSelections) et par la
     * restauration d'un projet existant (selectProjectTypeCard) : ces deux chemins utilisaient
     * auparavant des mécanismes différents et incompatibles (classe `.active` d'un côté,
     * `style.display` inline de l'autre, le tout neutralisé par un `d-none` !important jamais
     * retiré), d'où une section "Options pour projet hors ligne" invisible en permanence.
     */
    applyConnexionProjetToUi(typeDeProjet) {
        const isConnecte = typeDeProjet !== 'hors-ligne';
        $('.step_projet_connecter').toggleClass('active', isConnecte);
        $('.step_projet_non_connecter').toggleClass('active', !isConnecte);
        this.updateTypologieVisibilityForConnexion(typeDeProjet);
    }

    /**
     * Demande explicite : un projet "Site autonome ou Projet PV Hybride" ne propose que DEUX
     * typologies — Résidentielle et Professionnelle (C&I). "Grand projet" n'a pas de sens sans
     * raccordement au réseau. Masquée (jamais supprimée du DOM), même convention que
     * updateModeDeValorisationVisibilityForTypologie() juste en dessous.
     */
    updateTypologieVisibilityForConnexion(typeDeProjet) {
        const isHorsLigne = typeDeProjet === 'hors-ligne';
        const carteGrandProjet = document.getElementById('id_typologie_grand_projet');
        if (!carteGrandProjet) return;

        const wrapper = carteGrandProjet.closest('.col-md-4') || carteGrandProjet;
        wrapper.style.display = isHorsLigne ? 'none' : '';

        // Une typologie "Grand projet" déjà sélectionnée deviendrait invisible tout en restant
        // enregistrée dans le champ caché (donc sauvegardée en base) : on la purge pour forcer un
        // choix explicite parmi les deux typologies effectivement proposées.
        if (isHorsLigne && carteGrandProjet.classList.contains('selected')) {
            carteGrandProjet.classList.remove('selected', 'active');
            const hidden = document.querySelector('#form_parametre_projet #typologie_projet') || document.getElementById('typologie_projet');
            if (hidden) hidden.value = '';
        }
    }

    /**
     * Désélectionne toute carte de mode de valorisation / d'option hors ligne et vide le champ
     * caché #mode_de_valorisation. Appelée au CHANGEMENT de type de connexion uniquement (jamais à
     * la restauration d'un projet existant) : les deux jeux de cartes partagent ce champ, une
     * valeur héritée de l'autre mode n'aurait aucun sens pour le projet.
     */
    resetModeDeValorisation() {
        document.querySelectorAll('.mode-de-valorisation').forEach((card) => {
            card.classList.remove('selected', 'active');
        });
        const hidden = document.querySelector('#form_parametre_projet #mode_de_valorisation') || document.getElementById('mode_de_valorisation');
        if (hidden) hidden.value = '';
        this.updateProfilConsommateurVisibility('');
    }

    /**
     * Site autonome : affiche le profil consommateur pour la typologie du système « Alimentation en
     * électricité » (valeur enregistrée « Habitation »), le masque sinon. Sans effet ailleurs : la
     * section n'existe que dans l'application Site autonome (parametre.html).
     */
    updateProfilConsommateurVisibility(modeValo) {
        const section = document.getElementById('step_profil_consommateur');
        // Classe .active et non style.display : une .step sans .active reste masquée (menu_list.css).
        if (section) section.classList.toggle('active', modeValo === TYPOLOGIE_SYSTEME_ALIMENTATION);
    }

    /**
     * Choix d'une typologie du système par l'utilisateur (Site autonome). Hors « Alimentation en
     * électricité », aucune typologie de projet n'est nécessaire : profil vidé et typologie remise à
     * celle du parcours, sans ses valeurs par défaut (classification, type de projet...).
     */
    appliquerTypologieSysteme(modeValo) {
        if (!document.getElementById('step_profil_consommateur')) return;
        this.updateProfilConsommateurVisibility(modeValo);
        if (modeValo === TYPOLOGIE_SYSTEME_ALIMENTATION) return;
        this.selectProfilConsommateurCard('');
        const typologieDefaut = (window.SKV_PARCOURS && window.SKV_PARCOURS.typologie_defaut) || window.TYPOLOGIE_RESIDENTIELLE;
        this.selectTypologieCard(typologieDefaut);
    }

    /** Carte de profil consommateur surlignée et champ caché #option_reseau ('' : aucun profil). */
    selectProfilConsommateurCard(profil) {
        const hidden = document.querySelector('#form_parametre_projet #option_reseau') || document.getElementById('option_reseau');
        if (!hidden) return;
        const valeur = (profil || '').trim();
        document.querySelectorAll('.profil-consommateur').forEach((card) => {
            const h5 = card.querySelector('h5');
            const choisie = !!valeur && !!h5 && h5.textContent.trim() === valeur;
            card.classList.toggle('selected', choisie);
            card.classList.toggle('active', choisie);
        });
        hidden.value = valeur;
    }

    /**
     * Masque les cartes "Autoconsommation collective" et "Marché libre" du mode de valorisation
     * pour un projet Résidentielle (demande explicite, non pertinentes pour ce type de projet) — les
     * réaffiche sinon. Appelée au clic sur une carte de typologie (setupProjectSelections()) et lors
     * du pré-remplissage en mode édition (selectTypologieCard()).
     */
    updateModeDeValorisationVisibilityForTypologie(typologie) {
        const isResidential = typologie === window.TYPOLOGIE_RESIDENTIELLE;
        document.querySelectorAll('.mode-de-valorisation').forEach((card) => {
            const h5 = card.querySelector('h5');
            const text = h5 ? h5.textContent.trim() : '';
            if (text === 'Autoconsommation collective' || text === 'Marché libre') {
                const wrapper = card.closest('.col-md-5') || card;
                wrapper.style.display = isResidential ? 'none' : '';
            }
        });
    }
    selectValorisationCard(modeValo) {
        if (!modeValo) return;

        // Chercher la carte avec la bonne valeur (data-value, sinon texte du <h5>)
        document.querySelectorAll('.mode-de-valorisation').forEach(card => {
            const h5 = card.querySelector('h5');
            const valeur = card.dataset.value || (h5 ? h5.textContent.trim() : '');
            if (valeur && valeur === modeValo.trim()) {
                card.classList.add('selected', 'active');
            } else {
                card.classList.remove('selected', 'active');
            }
        });

        // CORRECTIF (même bug que selectTypologieCard() : cette méthode ne mettait à jour que
        // l'état visuel des cartes, jamais le champ caché #mode_de_valorisation — lu par
        // PdfUtilities.getFormData() en repli quand solarProjectData n'a pas encore ce champ,
        // et par les gardes PdfAutoconsoGenerator.shouldAddReport()/
        // PdfUtilities.shouldIncludeProductionReport() qui décident d'afficher ou non "Synthèse
        // des Taux"/"Tableaux d'Analyse" selon ce mode. Un champ cachë resté vide/périmé en mode
        // édition pouvait donc laisser apparaître ces pages même pour un projet "Vente en
        // totalité"/"Marché libre".
        const hiddenInput = document.querySelector('#form_parametre_projet #mode_de_valorisation') || document.getElementById('mode_de_valorisation');
        if (hiddenInput) hiddenInput.value = modeValo.trim();
    }
    // Correspond au fonctionnement de .typologie-projet dans singleSelections (setupProjectSelections) :
    // la valeur enregistrée est le texte du <h5> de la carte, pas son data-type — la restauration doit
    // donc matcher sur ce même texte (même convention que selectValorisationCard ci-dessus).
    selectTypologieCard(typologie) {
        if (!typologie) return;

        document.querySelectorAll('.typologie-projet').forEach(card => {
            const h5 = card.querySelector('h5');
            if (h5 && h5.textContent.trim() === typologie.trim()) {
                card.classList.add('selected', 'active');
            } else {
                card.classList.remove('selected', 'active');
            }
        });

        // CORRECTIF (bug rapporté : "en modifiant un projet existant, la sauvegarde redemande la
        // typologie alors qu'elle est déjà sélectionnée") : cette méthode ne mettait à jour que
        // l'état visuel (.selected/.active) des cartes, jamais le champ caché #typologie_projet
        // que validateParametreProjetForm() vérifie avant sauvegarde — contrairement à
        // selectEtudeCard() juste en dessous, qui le fait déjà pour le même besoin ("nécessaire en
        // mode édition"). Sans ce champ repeuplé, rouvrir un projet existant pour le modifier
        // laissait la carte visuellement sélectionnée mais la valeur réellement validée vide, tant
        // que l'utilisateur ne recliquait pas manuellement sur une carte.
        const hiddenInput = document.querySelector('#form_parametre_projet #typologie_projet') || document.getElementById('typologie_projet');
        if (hiddenInput) hiddenInput.value = typologie.trim();

        this.updateModeDeValorisationVisibilityForTypologie(typologie.trim());
    }
    selectEtudeCard(typeEtude) {
        if (!typeEtude) return;
        // Ancienne valeur (« Pré-étude de faisabilité ») -> carte « Étude technico-économique »
        if (/pr[ée]-?[ée]tude/i.test(typeEtude)) typeEtude = 'Étude technico-économique';

        document.querySelectorAll('.etude-option').forEach(card => {
            if (card.dataset.value === typeEtude) {
                card.classList.add('selected', 'active');
            } else {
                card.classList.remove('selected', 'active');
            }
        });

        // Mettre à jour la valeur du champ caché (nécessaire en mode édition)
        const hiddenInput = document.querySelector('#form_parametre_projet #type_etude') || document.getElementById('type_etude');
        if (hiddenInput) hiddenInput.value = typeEtude;
    }
    updateClimateButtons(projet) {
        // Si le pays n'est ni France ni Haïti, remplir les champs de saisie libre
        if (projet.pays && projet.pays !== 'France' && projet.pays !== 'Haïti') {
            if (projet.zone_de_vent) {
                const field = document.getElementById('autre_zone_vent');
                if (field) field.value = projet.zone_de_vent;
            }
            if (projet.categorie_de_terrain) {
                const field = document.getElementById('autre_categorie_terrain');
                if (field) field.value = projet.categorie_de_terrain;
            }
            if (projet.zone_de_neige) {
                const field = document.getElementById('autre_zone_neige');
                if (field) field.value = projet.zone_de_neige;
            }
            if (projet.zone_sismique) {
                const field = document.getElementById('autre_zone_sismique');
                if (field) field.value = projet.zone_sismique;
            }
        } else {
            // Pour France et Haïti, activer les boutons correspondants
            if (projet.zone_de_vent) {
                const btnClass = projet.pays === 'Haïti' ?
                    `.btn_zone_de_vent_h_${projet.zone_de_vent}` :
                    `.btn_zone_de_vent_${projet.zone_de_vent}`;
                const btn = document.querySelector(btnClass);
                if (btn) {
                    btn.classList.add('btn_reset_parametre_js', 'active');
                }
            }
            if (projet.categorie_de_terrain && projet.pays === 'France') {
                const btn = document.querySelector(`.btn_categorie_de_terrain_${projet.categorie_de_terrain}`);
                if (btn) {
                    btn.classList.add('btn_reset_parametre_js', 'active');
                }
            }

            if (projet.zone_de_neige && projet.pays === 'France') {
                const btn = document.querySelector(`.btn_zone_de_neige_${projet.zone_de_neige}`);
                if (btn) {
                    btn.classList.add('btn_reset_parametre_js', 'active');
                }
            }

            // Zone sismique
            if (projet.zone_sismique) {
                document.querySelectorAll('[class*="btn_zone_sismique"]').forEach(btn => {
                    if (btn.textContent.includes(projet.zone_sismique)) {
                        btn.classList.add('btn_reset_parametre_js', 'active');
                    }
                });
            }
        }
    }

    truncateText(text, maxLength = 50) {
        if (!text || text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + '...';
    }
    // ==========================================
    // GESTION DES NORMES
    // ==========================================

    setupNormeSelector() {
        const btn = document.getElementById('select-norme-btn');
        if (btn) {
            btn.addEventListener('click', () => this.openNormeModal());
        }
    }

    createNormeSelectorButton() {
        // Attendre que le DOM soit prêt
        const container = document.querySelector('#parametre_projet');
        if (!container) {
            console.warn('Container #parametre_projet non trouvé');
            return;
        }

        // Vérifier si le bouton existe déjà
        if (document.getElementById('select-norme-btn')) {
            console.log('Bouton norme déjà créé');
            return;
        }

        const buttonHtml = `
        <div class="row mt-4" style="display:flex;">
            <div class="col-md-12">
                <button type="button" id="select-norme-btn" class="btn w-50" style="background-color: #f50000; color: #ffffff; font-weight: 500; border-radius: 6px; padding: 10px 20px; border: 2px solid #f50000;">
                    <i class="fas fa-cogs"></i> Sélectionner une norme de calcul
                </button>
                <div id="selected-norme-info" class="mt-2" style="display: none;">
                    <div class="alert alert-info">
                        <strong>Norme sélectionnée :</strong> <span id="norme-name"></span>
                        <button type="button" class="btn btn-sm float-end" style="background-color: #f50000; color: #ffffff; font-weight: 500; border-radius: 4px; border: 2px solid #f50000;"
                                onclick="window.dataManager.removeNormeSelection()">
                            <i class="fas fa-times"></i> Retirer
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

        // Chercher un meilleur point d'insertion
        // Option 1 : Avant les boutons de navigation
        const navButtons = container.querySelector('.modal-nav-buttons');
        if (navButtons) {
            navButtons.insertAdjacentHTML('beforebegin', buttonHtml);
            console.log('Bouton norme inséré avant les boutons de navigation');
        } else {
            // Option 2 : À la fin du formulaire
            const form = container.querySelector('#form_parametre_projet');
            if (form) {
                form.insertAdjacentHTML('beforeend', buttonHtml);
                console.log('Bouton norme inséré à la fin du formulaire');
            } else {
                console.warn('Impossible de trouver un point d\'insertion approprié');
                return;
            }
        }

        // Attacher l'événement
        const btn = document.getElementById('select-norme-btn');
        if (btn) {
            btn.addEventListener('click', () => this.openNormeModal());
            console.log('Événement attaché au bouton norme');
        }
    }

    async openNormeModal() {
        try {
            const response = await fetch('/concevoir_mon_projet/normes-calcul');
            const data = await response.json();

            if (data.success) {
                this.showNormeSelectionModal(data.normes);
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Impossible de charger les normes');
        }
    }

    showNormeSelectionModal(normes) {

        const style = document.createElement('style');
        style.textContent = `
        .norme-modal th {
            color: #de0000 !important;
            font-weight: bold !important;
            text-align: center;
        }
        .norme-modal .action-cell {
            padding: 0 !important;
        }
             .norme-modal-fullscreen {
            width: 95vw !important;
            height: 90vh !important;
            max-width: none !important;
            max-height: none !important;
            margin: 1vh 1vw !important;
        }
        .norme-modal-fullscreen th {
            color: #de0000 !important;
            font-weight: bold !important;
            white-space: nowrap;
            font-size: 0.82em;
            padding: 10px 6px;
        }
        .norme-modal-fullscreen td {
            font-size: 0.82em;
            padding: 8px 5px;
            vertical-align: middle;
        }
        .norme-modal-fullscreen .table-container {
            overflow: hidden !important;
        }
        .norme-modal-fullscreen table {
            width: 100% !important;
            table-layout: fixed;
        }
        /* Ajustements des colonnes spécifiques */
        .norme-modal-fullscreen th:nth-child(1) { width: 10%; }  /* Type étude */
        .norme-modal-fullscreen th:nth-child(2) { width: 8%; } /* Caractéristique */
        .norme-modal-fullscreen th:nth-child(3) { width: 14%; } /* Normes */
        .norme-modal-fullscreen th:nth-child(4) { width: 8%; }  /* Chute tension PV */
        .norme-modal-fullscreen th:nth-child(5) { width: 7%; }  /* Temp max */
        .norme-modal-fullscreen th:nth-child(6) { width: 7%; }  /* Temp min */
        .norme-modal-fullscreen th:nth-child(7) { width: 8%; }  /* Chute soutirage */
        .norme-modal-fullscreen th:nth-child(8) { width: 8%; }  /* Ratio */
        .norme-modal-fullscreen th:nth-child(9) { width: 8%; }
        .norme-modal-fullscreen th:nth-child(10) { width: 7%; }
        .norme-modal-fullscreen th:nth-child(11) { width: 8%; }
        .norme-modal-fullscreen th:nth-child(12) { width: 12%; } /* Actions */

        .norme-modal th {
            color: #de0000 !important;
            font-weight: bold !important;
            white-space: normal !important;  /* ✅ Permettre le retour à la ligne */
            word-wrap: break-word !important;
            line-height: 1.2 !important;
            padding: 10px 6px !important;
            font-size: 0.85em !important;
            height: auto !important;  /* ✅ Hauteur automatique */
        }
        .norme-modal td {
            white-space: normal !important;  /* ✅ Permettre le retour à la ligne */
            word-wrap: break-word !important;
            line-height: 1.3 !important;
            padding: 8px 6px !important;
            font-size: 0.85em !important;
            vertical-align: top !important;  /* ✅ Alignement en haut pour multi-lignes */
            height: auto !important;  /* ✅ Hauteur automatique */
        }
        .norme-modal .action-cell {
            padding: 0 !important;
            vertical-align: middle !important;  /* ✅ Garder l'alignement au centre pour les boutons */
        }
        .norme-modal .full-height-btn {
            width: 100%;
            height: 100%;
            white-space: nowrap;
            margin:0;
            padding:0;
        }
        .norme-modal .table-container {
            overflow-x: hidden !important;
            overflow-y: auto;
        }
        .norme-modal table {
            width: 100% !important;
            table-layout: auto;  /* ✅ Layout automatique pour s'adapter au contenu */
        }
        .norme-modal .badge {
            font-size: 0.75em;
            margin: 1px;
            white-space: normal !important;  /* ✅ Badges sur plusieurs lignes si besoin */
            display: inline-block;
            max-width: 100%;
        }
        .norme-modal tr {
            height: auto !important;
        } 
        .norme-modal td:nth-child(12){ 
            min-width: 200px;
            max-width: 300px;
        }
        .norme-modal td:nth-child(1) { 
            min-width: 30px;
            max-width: 60px;
        }
    `;
        document.head.appendChild(style);
        const normesCount = normes.length;
        const limitReached = normesCount >= 5;
        const limitWarning = limitReached
            ? `<div class="alert alert-warning"><i class="fas fa-exclamation-triangle"></i> Limite atteinte : Vous avez ${normesCount}/5 normes. Supprimez une norme pour en créer une nouvelle.</div>`
            : `<div class="alert alert-info"><i class="fas fa-info-circle"></i> Normes créées : ${normesCount}/5</div>`;

        const modalHtml = `
        <div id="norme-selection-modal" class="modal-backdrop" style="display: flex;">
            <div class="modal-content norme-modal norme-modal-fullscreen" style="max-width: 1200px;">
                <div class="modal-headerr">
                    <h4><i class="fas fa-cogs"></i> Sélectionner une norme de calcul</h4>
                    <button type="button" class="close-button" data-action="close-norme-modal">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                ${limitWarning}
                <div class="table-container" style="max-height: 90vh; overflow-y: auto;">
                    <table class="table table-bordered table-hover">
                        <thead>
                            <tr>
                                <th class="text-center">Type d'étude</th>
                                <th class="text-center">Caracteristique réseau</th>
                                <th class="text-center">Normes électriques</th>
                                <th class="text-center">Chute de tension maximale admissible</th>
                                <th class="text-center">Température ambiante maximale</th>
                                <th class="text-center">Température ambiante minimale</th>
                                <th class="text-center">Chute de tension admissible</th>
                                <th class="text-center">Ratio de surdimensionnement maximal</th>
                                <th class="text-center">Coefficient de dégradation annuelle</th>
                                <th class="text-center">Cos(phi) paramétrage onduleur</th>
                                <th class="text-center">Pourcentage d'incertitude totale estimée</th>
                                <th class="text-center">Actions sur les normes</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${normes.map(norme => `
                                <tr>
                                    <td class="text-center">${this.escapeHtml(norme.type_etude || 'Non défini')}</td>
                                    <td class="text-center">${this.escapeHtml(norme.type_tension || 'Non défini')}</td>
                                    <td class="text-center">
                                        ${norme.normes_electriques && norme.normes_electriques.length > 0
                ? norme.normes_electriques.map(n => `<span class="badge bg-secondary">${this.escapeHtml(n)}</span>`).join(' ')
                : '<span class="text-muted">Aucune</span>'}
                                    </td>
                                    <td class="text-center">${this.escapeHtml(norme.chute_tension_pv || 'Non défini')}</td>
                                    <td class="text-center">${this.escapeHtml(norme.temperature_maximale || 'Non défini')}</td>
                                    <td class="text-center">${this.escapeHtml(norme.temperature_minimale || 'Non défini')}</td>
                                    <td class="text-center">${this.escapeHtml(norme.chute_tension_soutirage || 'Non défini')}</td>
                                    <td class="text-center">${this.escapeHtml(norme.ratio_surdimensionnement || 'Non défini')}</td>
                                    <td class="text-center">${this.escapeHtml(norme.coefficient_degradation || 'Non défini')}</td>
                                    <td class="text-center">${this.escapeHtml(norme.cosinus_phi || 'Non défini')}</td>
                                    <td class="text-center">${this.escapeHtml(norme.incertitude_p90 || 'Non défini')}</td>
                                    <td class="text-center">
                                        <button class="btn btn-sm"
                                                data-action="select-norme"
                                                data-norme-id="${norme.id}"
                                                data-norme-name="${this.escapeHtml(norme.nom).replace(/"/g, '&quot;')}"
                                                title="Sélectionner cette norme"
                                                style="margin: 0 2px; background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 500; border-radius: 4px;">
                                            <i class="fas fa-check"></i>
                                        </button>
                                        <button class="btn btn-sm"
                                                data-action="delete-norme"
                                                data-norme-id="${norme.id}"
                                                title="Supprimer cette norme"
                                                style="margin: 0 2px; background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 500; border-radius: 4px;">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ${normes.length === 0 ? `
                        <div class="text-center py-4">
                            <i class="fas fa-inbox fa-3x text-muted mb-3"></i>
                            <p>Aucune norme disponible</p>
                            <button class="btn" data-action="create-norme" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 500; border-radius: 6px; padding: 10px 20px;">
                                <i class="fas fa-plus"></i> Créer une norme
                            </button>
                        </div>
                    ` : ''}
                </div>
                <div class="modal-footerr">

                    <button type="button" class="btn" data-action="close-norme-modal" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 500; border-radius: 6px; padding: 10px 20px;">
                        Annuler
                    </button>
                </div>
            </div>
        </div>
    `;

        //   <button type="button" class="btn btn-info" data-action="select-projet-calepinage"
        //                         style="margin-right: auto;">
        //                     <i class="fas fa-folder-open"></i> Charger un projet
        //                 </button>


        const existingModal = document.getElementById('norme-selection-modal');
        if (existingModal) existingModal.remove();

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = document.getElementById('norme-selection-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal || e.target.closest('[data-action="close-norme-modal"]')) {
                    setTimeout(() => {
                        if (style.parentNode) {
                            style.remove();
                        }
                    }, 100);
                }
            });
        }

        this.attachNormeModalEvents();
    }

    attachNormeModalEvents() {
        const modal = document.getElementById('norme-selection-modal');
        if (!modal) return;

        modal.querySelectorAll('[data-action="close-norme-modal"]').forEach(btn => {
            btn.addEventListener('click', () => this.closeNormeModal());
        });

        modal.querySelectorAll('[data-action="select-norme"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const normeId = parseInt(e.currentTarget.dataset.normeId);
                const normeName = e.currentTarget.dataset.normeName;
                this.selectNorme(normeId, normeName);
            });
        });

        // Bouton supprimer une norme
        modal.querySelectorAll('[data-action="delete-norme"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const normeId = parseInt(e.currentTarget.dataset.normeId);
                this.deleteNorme(normeId);
            });
        });

        // Bouton créer une norme
        const createBtn = modal.querySelector('[data-action="create-norme"]');
        if (createBtn) {
            createBtn.addEventListener('click', () => {
                this.closeNormeModal();

                const event = new CustomEvent('navigateToNormes', {
                    bubbles: true,
                    detail: { source: 'norme-modal' }
                });
                document.dispatchEvent(event);
            });
        }

        // Bouton sélectionner un projet de calepinage
        const selectProjetBtn = modal.querySelector('[data-action="select-projet-calepinage"]');
        if (selectProjetBtn) {
            selectProjetBtn.addEventListener('click', () => {
                this.openProjetCalepinageModal();
            });
        }

        // Fermeture en cliquant sur le backdrop
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeNormeModal();
            }
        });
    }

    async openProjetCalepinageModal() {
        // Fermer la modal de normes
        this.closeNormeModal();

        // Importer et afficher la modal de projets
        try {
            const { mesProjetsModal } = await import('../components/MesProjetsModal.js?v=5');
            mesProjetsModal.show();
        } catch (error) {
            console.error('Erreur lors du chargement de la modal:', error);
            this.showError('Erreur lors de l\'ouverture de la modal des projets');
        }
    }

    selectNorme(normeId, normeName) {
        let hiddenInput = document.getElementById('norme_calcul_id_selected');
        if (!hiddenInput) {
            hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = 'norme_calcul_id_selected';
            hiddenInput.name = 'norme_calcul_id';
            const form = document.getElementById('form_parametre_projet');
            if (form) form.appendChild(hiddenInput);
        }
        if (hiddenInput) hiddenInput.value = normeId;

        const nameEl = document.getElementById('norme-name');
        const infoEl = document.getElementById('selected-norme-info');
        if (nameEl) nameEl.textContent = normeName;
        if (infoEl) infoEl.style.display = 'block';

        this.closeNormeModal();
        this.showSuccess('Norme sélectionnée');
    }

    removeNormeSelection() {
        const hiddenInput = document.getElementById('norme_calcul_id_selected');
        if (hiddenInput) hiddenInput.value = '';
        const infoEl = document.getElementById('selected-norme-info');
        if (infoEl) infoEl.style.display = 'none';
    }

    async deleteNorme(normeId) {
        if (!confirm('Êtes-vous sûr de vouloir supprimer cette norme ?')) {
            return;
        }

        try {
            const csrfToken = document.querySelector('input[name="csrf_token"]')?.value;
            const response = await fetch(`/concevoir_mon_projet/norme-calcul/${normeId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    // Ajout du token CSRF pour que la requête soit acceptée par le serveur
                    'X-CSRF-TOKEN': csrfToken
                }

            });

            const data = await response.json();

            if (data.success) {
                this.showSuccess('Norme supprimée avec succès');
                // Rafraîchir le modal avec les normes mises à jour
                this.closeNormeModal();
                this.openNormeModal();
            } else {
                this.showError(data.message || 'Erreur lors de la suppression');
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Erreur de connexion');
        }
    }

    async selectNormeForProject(projectId) {
        try {
            const response = await fetch('/concevoir_mon_projet/normes-calcul');
            const data = await response.json();

            if (data.success) {
                this.showNormeSelectionModalForProject(projectId, data.normes);
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Impossible de charger les normes');
        }
    }
    showNormeSelectionModalForProject(projectId, normes) {
        const modalHtml = `
        <div id="norme-project-modal" class="modal-backdrop" style="display: flex;">
            <div class="modal-content" style="max-width: 900px;">
                <div class="modal-headerr">
                    <h4><i class="fas fa-link"></i> Associer une norme au projet</h4>
                    <button type="button" class="close-button" data-action="close-norme-project-modal">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="table-container" style="max-height: 500px; overflow-y: auto;">
                    <table class="table table-bordered table-hover">
                        <thead>
                            <tr>
                                <th>Nom</th>
                                <th>Type d'étude</th>
                                <th>Normes</th>
                                <th class="text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${normes.map(norme => `
                                <tr>
                                    <td><strong>${this.escapeHtml(norme.nom)}</strong></td>
                                    <td>${this.escapeHtml(norme.type_etude || 'Non défini')}</td>
                                    <td>
                                        ${norme.normes_electriques && norme.normes_electriques.length > 0
                ? norme.normes_electriques.slice(0, 2).map(n => this.escapeHtml(n)).join(', ')
                : 'Aucune'}
                                    </td>
                                    <td class="text-center">
                                        <button class="btn btn-sm"
                                                data-action="associate-norme"
                                                data-project-id="${projectId}"
                                                data-norme-id="${norme.id}"
                                                style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 500; border-radius: 4px;">
                                            <i class="fas fa-link"></i> Associer
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="modal-footerr">
                    <button type="button" class="btn" data-action="close-norme-project-modal" style="background-color: #f50000; border: 2px solid #f50000; color: #ffffff; font-weight: 500; border-radius: 6px; padding: 10px 20px;">
                        Fermer
                    </button>
                </div>
            </div>
        </div>
    `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // ✅ Attacher les événements
        this.attachNormeProjectModalEvents();
    }

    // ✅ Nouvelle méthode pour attacher les événements du modal projet
    attachNormeProjectModalEvents() {
        const modal = document.getElementById('norme-project-modal');
        if (!modal) return;

        // Boutons de fermeture
        modal.querySelectorAll('[data-action="close-norme-project-modal"]').forEach(btn => {
            btn.addEventListener('click', () => this.closeNormeProjectModal());
        });

        // Boutons d'association
        modal.querySelectorAll('[data-action="associate-norme"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const projectId = parseInt(e.currentTarget.dataset.projectId);
                const normeId = parseInt(e.currentTarget.dataset.normeId);
                this.associateNormeToProject(projectId, normeId);
            });
        });

        // Fermeture en cliquant sur le backdrop
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeNormeProjectModal();
            }
        });
    }

    async associateNormeToProject(projectId, normeId) {
        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}/associer-norme`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ norme_id: normeId })
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccess('Norme associée au projet');
                this.closeNormeProjectModal();
                this.loadProjects();
            } else {
                this.showError(data.message);
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showError('Erreur lors de l\'association');
        }
    }

    closeNormeModal() {
        const modal = document.getElementById('norme-selection-modal');
        if (modal) modal.remove();
    }

    closeNormeProjectModal() {
        const modal = document.getElementById('norme-project-modal');
        if (modal) modal.remove();
    }

    // ==========================================
    // SOUMISSION DES FORMULAIRES
    // ==========================================

    setupFormSubmissions() {
        // ✅ FIX: Vérifier si les listeners ont déjà été attachés
        if (this.formSubmissionsSetup) {
            console.log('⚠️ Form submissions déjà configurés, skip pour éviter les duplications');
            return;
        }

        setTimeout(() => {
            const formProjet = document.querySelector('#form_parametre_projet');
            if (formProjet) {
                // ✅ FIX: Supprimer d'abord tout listener existant avant d'en ajouter un nouveau
                const oldListener = formProjet._submitListener;
                if (oldListener) {
                    formProjet.removeEventListener('submit', oldListener);
                }

                // Créer le nouveau listener
                const newListener = (e) => {
                    e.preventDefault();
                    e.stopImmediatePropagation(); // ✅ FIX: Empêcher la propagation aux autres listeners
                    console.log('📋 Paramètre projet soumis');
                    this.submitParametreProjet();
                };

                // Stocker la référence pour pouvoir le supprimer plus tard si nécessaire
                formProjet._submitListener = newListener;
                formProjet.addEventListener('submit', newListener);

                // ✅ FIX : empêcher la soumission implicite du formulaire lorsqu'on appuie sur
                // Entrée dans un champ texte (ex: recherche d'adresse) — le projet ne doit être
                // créé/modifié qu'au clic explicite sur le bouton "Sauvegarder".
                const oldKeydownListener = formProjet._preventEnterSubmitListener;
                if (oldKeydownListener) {
                    formProjet.removeEventListener('keydown', oldKeydownListener);
                }
                const preventEnterSubmit = (e) => {
                    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'submit') {
                        e.preventDefault();
                    }
                };
                formProjet._preventEnterSubmitListener = preventEnterSubmit;
                formProjet.addEventListener('keydown', preventEnterSubmit);

                // CORRECTIF (bug rapporté : le clic sur "Sauvegarder" ne déclenche AUCUN évènement
                // 'submit', diagnostiqué en direct sur la page — le bouton est pourtant bien
                // type="submit", non désactivé, et retrouvé par closest('form'), mais son
                // .form (propriété réelle d'appartenance à un formulaire, fixée par le navigateur à
                // l'insertion dans le document) ne pointe plus vers form_parametre_projet — un résidu
                // du bug historique de <form> imbriqués corrigé par ailleurs dans ce fichier HTML, que
                // certains navigateurs ne réévaluent pas après coup même une fois la structure HTML
                // corrigée. Pour ne plus jamais dépendre de cette association implicite et fragile,
                // chaque bouton type="submit" de ce formulaire déclenche désormais aussi
                // submitParametreProjet() directement au clic, sans passer par l'évènement 'submit'.
                formProjet.querySelectorAll('button[type="submit"]').forEach((btn) => {
                    const oldClick = btn._directSubmitClickListener;
                    if (oldClick) {
                        btn.removeEventListener('click', oldClick);
                    }
                    const directClick = (e) => {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        console.log('📋 Paramètre projet soumis (clic direct sur bouton submit)');
                        this.submitParametreProjet();
                    };
                    btn._directSubmitClickListener = directClick;
                    btn.addEventListener('click', directClick);
                });
            }

            const formNormes = document.querySelector('#form_mode_et_normes');
            if (formNormes) {
                // ✅ FIX: Supprimer d'abord tout listener existant avant d'en ajouter un nouveau
                const oldListener = formNormes._submitListener;
                if (oldListener) {
                    formNormes.removeEventListener('submit', oldListener);
                }

                // Créer le nouveau listener
                const newListener = (e) => {
                    e.preventDefault();
                    e.stopImmediatePropagation(); // ✅ FIX: Empêcher la propagation aux autres listeners
                    console.log('📋 Norme de calcul soumise');
                    this.submitModeCalculNorme();
                };

                // Stocker la référence pour pouvoir le supprimer plus tard si nécessaire
                formNormes._submitListener = newListener;
                formNormes.addEventListener('submit', newListener);

                // CORRECTIF (même filet de sécurité que pour form_parametre_projet ci-dessus, par
                // cohérence) : déclenche aussi directement au clic, sans dépendre du seul évènement
                // 'submit' natif du bouton.
                formNormes.querySelectorAll('button[type="submit"]').forEach((btn) => {
                    const oldClick = btn._directSubmitClickListener;
                    if (oldClick) {
                        btn.removeEventListener('click', oldClick);
                    }
                    const directClick = (e) => {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        console.log('📋 Norme de calcul soumise (clic direct sur bouton submit)');
                        this.submitModeCalculNorme();
                    };
                    btn._directSubmitClickListener = directClick;
                    btn.addEventListener('click', directClick);
                });
            }

            // ✅ Marquer comme configuré — UNIQUEMENT si le formulaire principal a bien été trouvé.
            // CORRECTIF (fiabilité) : ce drapeau était auparavant posé inconditionnellement, y compris
            // quand #form_parametre_projet n'existait pas encore au moment de cet appel — bloquant
            // alors DÉFINITIVEMENT tout nouvel essai d'attachement (le garde-fou en tête de fonction
            // empêche tout appel ultérieur dès que ce drapeau est à true), sans jamais produire ni
            // erreur ni message, pour le reste de la durée de vie de la page.
            if (formProjet) {
                this.formSubmissionsSetup = true;
                console.log('✅ Form submissions configurés avec succès');
            } else {
                console.warn('⚠️ #form_parametre_projet introuvable au moment de setupFormSubmissions() — nouvel essai au prochain appel.');
            }
        }, 0);
    }

    setupRealTimeValidation() {
        // Validation en temps réel pour le nom du projet
        const nomProjet = document.querySelector('#form_parametre_projet #nom_projet') || document.getElementById('nom_projet');
        if (nomProjet) {
            nomProjet.addEventListener('input', (e) => {
                const value = e.target.value.trim();
                if (value.length === 0) {
                    nomProjet.classList.add('is-invalid');
                    nomProjet.classList.remove('is-valid');
                } else if (value.length < 3 || value.length > 200) {
                    nomProjet.classList.add('is-invalid');
                    nomProjet.classList.remove('is-valid');
                } else {
                    nomProjet.classList.remove('is-invalid');
                    nomProjet.classList.add('is-valid');
                }
            });
        }

        // Validation pour les champs "Autres"
        const autreTypeProjet = document.getElementById('autre_type_projet_select');
        if (autreTypeProjet) {
            autreTypeProjet.addEventListener('input', (e) => {
                const value = e.target.value.trim();
                if (value.length > 0 && value.length >= 3) {
                    autreTypeProjet.classList.remove('is-invalid');
                    autreTypeProjet.classList.add('is-valid');
                }
            });
        }

        const autreNature = document.getElementById('autre_nature_des_traveaux');
        if (autreNature) {
            autreNature.addEventListener('input', (e) => {
                const value = e.target.value.trim();
                if (value.length > 0 && value.length >= 3) {
                    autreNature.classList.remove('is-invalid');
                    autreNature.classList.add('is-valid');
                }
            });
        }

        // Validation pour la date
        const dateLivrable = document.getElementById('date_livrable');
        if (dateLivrable) {
            // Initialiser avec la date du jour si le champ est vide
            if (!dateLivrable.value) {
                const today = new Date();
                const yyyy = today.getFullYear();
                const mm = String(today.getMonth() + 1).padStart(2, '0');
                const dd = String(today.getDate()).padStart(2, '0');
                dateLivrable.value = `${yyyy}-${mm}-${dd}`;
                dateLivrable.classList.add('is-valid');
            }

            // Champ facultatif : vidé, il redevient neutre (ni valide ni invalide).
            dateLivrable.addEventListener('change', (e) => {
                dateLivrable.classList.remove('is-invalid');
                dateLivrable.classList.toggle('is-valid', !!e.target.value);
            });
        }

        // Gestion dynamique du champ "Autre type de projet"
        const typeProjet = document.querySelector('#form_parametre_projet #type_projet_select') || document.getElementById('type_projet_select');
        if (typeProjet) {
            typeProjet.addEventListener('change', (e) => {
                const divAutre = document.querySelector('#form_parametre_projet #div_autre_type_projet') || document.getElementById('div_autre_type_projet');
                const inputAutre = document.querySelector('#form_parametre_projet #autre_type_projet_select') || document.getElementById('autre_type_projet_select');

                if (e.target.value === 'Autres') {
                    if (divAutre) divAutre.style.display = 'block';
                    if (inputAutre) inputAutre.setAttribute('required', 'required');
                } else {
                    if (divAutre) divAutre.style.display = 'none';
                    if (inputAutre) {
                        inputAutre.removeAttribute('required');
                        inputAutre.classList.remove('is-invalid', 'is-valid');
                    }
                }
            });
        }

        // Gestion dynamique du champ "Autre nature des travaux"
        const natureTravaux = document.getElementById('nature_des_traveaux');
        if (natureTravaux) {
            natureTravaux.addEventListener('change', (e) => {
                const divAutre = document.getElementById('div_autre_nature_des_traveaux');
                const inputAutre = document.getElementById('autre_nature_des_traveaux');

                if (e.target.value === 'Autres') {
                    if (divAutre) divAutre.style.display = 'block';
                    if (inputAutre) inputAutre.setAttribute('required', 'required');
                } else {
                    if (divAutre) divAutre.style.display = 'none';
                    if (inputAutre) {
                        inputAutre.removeAttribute('required');
                        inputAutre.classList.remove('is-invalid', 'is-valid');
                    }
                }
            });
        }
    }

    validateParametreProjetForm() {
        const errors = [];

        // 1. Validation du nom du projet (obligatoire et longueur)
        const nomProjet = document.querySelector('#form_parametre_projet #nom_projet') || document.getElementById('nom_projet');
        if (!nomProjet || !nomProjet.value.trim()) {
            errors.push('Le nom du projet est obligatoire.');
            if (nomProjet) nomProjet.classList.add('is-invalid');
        } else if (nomProjet.value.trim().length < 3) {
            errors.push('Le nom du projet doit contenir au moins 3 caractères.');
            nomProjet.classList.add('is-invalid');
        } else if (nomProjet.value.trim().length > 35) {
            errors.push('Le nom du projet ne peut pas dépasser 35 caractères.');
            nomProjet.classList.add('is-invalid');
        } else {
            nomProjet.classList.remove('is-invalid');
            nomProjet.classList.add('is-valid');
        }

        // 1bis. Validation de la typologie de projet (Résidentielle/Professionnelle (C&I)/Grand projet)
        const typologieProjet = document.getElementById('typologie_projet');
        if (!typologieProjet || !typologieProjet.value) {
            errors.push('Veuillez sélectionner la typologie de projet (Résidentielle, Professionnelle ou Grand projet).');
        }

        // 2. Validation du type de projet (connecté/hors-ligne)
        const typeDeProjet = document.getElementById('type_de_projet');
        if (!typeDeProjet || !typeDeProjet.value) {
            errors.push('Veuillez sélectionner le type de connexion (connecté au réseau ou hors-ligne).');
        }

        // 3. Validation du mode de valorisation — ou, pour un projet "Site autonome ou Projet PV
        // Hybride", de l'option hors ligne (Système hybride / Pompage solaire / Habitation) : les
        // deux jeux de cartes alimentent le même champ caché, le message doit donc désigner celui
        // que l'utilisateur a réellement sous les yeux.
        const modeDeValorisation = document.getElementById('mode_de_valorisation');
        if (!modeDeValorisation || !modeDeValorisation.value) {
            const estHorsLigne = typeDeProjet && typeDeProjet.value === 'hors-ligne';
            errors.push(estHorsLigne
                ? (document.getElementById('step_profil_consommateur')
                    ? 'Veuillez sélectionner la typologie du système.'
                    : 'Veuillez sélectionner une option pour le projet hors ligne (Système hybride, Pompage solaire ou Habitation).')
                : "Veuillez sélectionner le mode de valorisation de l'électricité.");
        } else if (modeDeValorisation.value === TYPOLOGIE_SYSTEME_ALIMENTATION
            && document.getElementById('step_profil_consommateur')) {
            const profil = document.querySelector('#form_parametre_projet #option_reseau') || document.getElementById('option_reseau');
            if (!profil || !profil.value) errors.push('Veuillez sélectionner le profil consommateur.');
        }

        // 4. Validation du type de projet (Ombrière, Toiture, etc.)
        const typeProjet = document.querySelector('#form_parametre_projet #type_projet_select') || document.getElementById('type_projet_select');
        if (!typeProjet || !typeProjet.value) {
            errors.push('Veuillez sélectionner le type de projet.');
        } else if (typeProjet.value === 'Autres') {
            const autreTypeProjet = document.querySelector('#form_parametre_projet #autre_type_projet_select') || document.getElementById('autre_type_projet_select');
            if (!autreTypeProjet || !autreTypeProjet.value.trim()) {
                errors.push('Veuillez préciser le type de projet (champ "Autre type de projet").');
                if (autreTypeProjet) autreTypeProjet.classList.add('is-invalid');
            } else if (autreTypeProjet.value.trim().length < 3) {
                errors.push('Le type de projet personnalisé doit contenir au moins 3 caractères.');
                autreTypeProjet.classList.add('is-invalid');
            } else {
                autreTypeProjet.classList.remove('is-invalid');
                autreTypeProjet.classList.add('is-valid');
            }
        }

        // 5. Validation de la classification de l'ouvrage
        const typeOuvrage = document.getElementById('type_ouvrage');
        if (!typeOuvrage || !typeOuvrage.value) {
            errors.push('Veuillez sélectionner la classification de l\'ouvrage.');
        }
        // "Autres" n'exige plus de précision : le champ "Autre classification" n'est plus affiché.

        // 6. Validation de la nature des travaux
        const natureTravaux = document.getElementById('nature_des_traveaux');
        if (!natureTravaux || !natureTravaux.value) {
            errors.push('Veuillez sélectionner la nature des travaux.');
        } else if (natureTravaux.value === 'Autres') {
            const autreNature = document.getElementById('autre_nature_des_traveaux');
            if (!autreNature || !autreNature.value.trim()) {
                errors.push('Veuillez préciser la nature des travaux (champ "Autre nature à préciser").');
                if (autreNature) autreNature.classList.add('is-invalid');
            } else if (autreNature.value.trim().length < 3) {
                errors.push('La nature des travaux personnalisée doit contenir au moins 3 caractères.');
                autreNature.classList.add('is-invalid');
            } else {
                autreNature.classList.remove('is-invalid');
                autreNature.classList.add('is-valid');
            }
        }

        // 7. Échéance de réalisation : FACULTATIVE (demande explicite). Aucune erreur si le champ est
        // vide ; on se contente de refléter l'état visuel (valide si renseignée, neutre sinon).
        const dateLivrable = document.getElementById('date_livrable');
        if (dateLivrable) {
            dateLivrable.classList.remove('is-invalid');
            dateLivrable.classList.toggle('is-valid', !!dateLivrable.value);
        }

        // 8. Validation du pays
        const pays = document.getElementById('pays');
        if (!pays || !pays.value) {
            errors.push('Veuillez sélectionner un pays.');
        }

        // 9. Validation de l'adresse projet et des coordonnées GPS (CORRECTIF demande explicite :
        // "réfuser les données corrompues" — cette validation était jusqu'ici un simple
        // console.warn non bloquant : un utilisateur pouvait saisir du texte dans le champ de
        // recherche SANS jamais sélectionner de suggestion (#parametre_project_hidden reste alors
        // vide, ou garde la valeur d'une adresse précédente si le champ visible est modifié après
        // coup sans resélectionner), ou saisir des coordonnées GPS hors plage — la fiche projet se
        // retrouvait alors avec une adresse texte et des coordonnées incohérentes entre elles, ou
        // carrément invalides (cf. addressSearch.js/coordinateManager.js, qui ne valident que côté
        // UI la saisie manuelle de coordonnées, jamais au moment de la soumission du formulaire).
        const adresseProjetInput = document.getElementById('parametreProjectSearch');
        const adresseProjetHidden = document.getElementById('parametre_project_hidden');
        const hasAdresseTexteSaisie = !!(adresseProjetInput && adresseProjetInput.value.trim());
        // Dépliage récursif (même logique que fillFormWithProjectData() plus haut, qui restaure le
        // marker à partir de projet.adresse_projet) : nécessaire pour rester compatible avec le
        // format historique doublement sérialisé {"adresse": "<json string avec lat/lng>"} que
        // peuvent encore porter d'anciens projets déjà enregistrés — un simple JSON.parse() unique
        // aurait fait échouer à tort la validation de ces projets à la moindre modification.
        let adresseHiddenData = null;
        if (adresseProjetHidden && adresseProjetHidden.value.trim()) {
            try {
                let d = adresseProjetHidden.value;
                for (let i = 0; i < 3 && typeof d === 'string'; i++) {
                    try { d = JSON.parse(d); } catch (e) { break; }
                }
                if (d && typeof d === 'object' && !d.latitude && typeof d.adresse === 'string' && d.adresse.trim().startsWith('{')) {
                    try { d = JSON.parse(d.adresse); } catch (e) { /* garde le niveau précédent */ }
                }
                if (d && typeof d === 'object') adresseHiddenData = d;
            } catch (e) {
                adresseHiddenData = null;
            }
        }

        if (!hasAdresseTexteSaisie && (!adresseProjetHidden || !adresseProjetHidden.value.trim())) {
            errors.push('La localisation du projet (adresse ou coordonnées géographiques) est obligatoire.');
            if (adresseProjetInput) adresseProjetInput.classList.add('is-invalid');
        } else if (hasAdresseTexteSaisie || (adresseProjetHidden && adresseProjetHidden.value.trim())) {
            const lat = adresseHiddenData ? parseFloat(adresseHiddenData.latitude) : NaN;
            const lng = adresseHiddenData ? parseFloat(adresseHiddenData.longitude) : NaN;
            const adresseTexte = adresseHiddenData && typeof adresseHiddenData.adresse === 'string'
                ? adresseHiddenData.adresse.trim() : '';
            const coordsValides = !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

            if (!adresseHiddenData || !coordsValides || adresseTexte.length < 3) {
                errors.push('Adresse invalide : choisissez d\'abord une adresse dans la liste de suggestions pour localiser le site (vous pourrez ensuite modifier librement le texte affiché), ou saisissez des coordonnées GPS valides (latitude entre -90 et 90, longitude entre -180 et 180).');
                if (adresseProjetInput) adresseProjetInput.classList.add('is-invalid');
            } else if (hasAdresseTexteSaisie && adresseProjetInput.value.trim() !== adresseTexte) {
                // Le texte visible a été modifié après la sélection sans resélectionner de suggestion
                // (ou de coordonnées) : les coordonnées enregistrées ne correspondent plus au texte
                // affiché — donnée incohérente, on la rejette plutôt que de l'enregistrer telle quelle.
                errors.push('Adresse invalide : le texte saisi ne correspond plus à l\'adresse sélectionnée. Veuillez resélectionner une suggestion ou valider de nouvelles coordonnées GPS.');
                adresseProjetInput.classList.add('is-invalid');
            } else if (adresseProjetInput) {
                adresseProjetInput.classList.remove('is-invalid');
            }
        }

        // 10. Validation des zones climatiques pour la France - CHAMPS NON OBLIGATOIRES
        // Les champs zone de vent, zone de neige, categorie de terrain et zone sismique ne sont plus obligatoires
        /*
        if (pays && pays.value === 'France') {
            const zoneVent = document.getElementById('input_zone_de_vent');
            const categorieTerrain = document.getElementById('input_categorie_de_terrain');
            const zoneNeige = document.getElementById('input_zone_de_neige');
            const zoneSismique = document.getElementById('input_zone_sismique');

            if (!zoneVent || !zoneVent.value) {
                errors.push('Veuillez sélectionner la zone de vent (France).');
            }
            if (!categorieTerrain || !categorieTerrain.value) {
                errors.push('Veuillez sélectionner la catégorie de terrain (France).');
            }
            if (!zoneNeige || !zoneNeige.value) {
                errors.push('Veuillez sélectionner la zone de neige (France).');
            }
            if (!zoneSismique || !zoneSismique.value) {
                errors.push('Veuillez sélectionner la zone sismique (France).');
            }
        }

        // 11. Validation des zones climatiques pour Haïti
        if (pays && pays.value === 'Haïti') {
            const zoneVent = document.getElementById('input_zone_de_vent');
            const zoneSismique = document.getElementById('input_zone_sismique');

            if (!zoneVent || !zoneVent.value) {
                errors.push('Veuillez sélectionner la zone de vent (Haïti).');
            }
            if (!zoneSismique || !zoneSismique.value) {
                errors.push('Veuillez sélectionner la zone sismique (Haïti).');
            }
        }
        */

        // Afficher les erreurs s'il y en a (demande explicite : « signaler ce qui manque avant la
        // sauvegarde, avec un lien vers chaque champ »). Le décompte évite de compter les puces, et chaque
        // ligne est cliquable : elle déplie la section concernée si besoin, amène le champ à l'écran, le met
        // en évidence et y place le curseur.
        if (errors.length > 0) {
            const pluriel = errors.length > 1 ? 's' : '';
            const errorMessage = `
                <div style="text-align: left;">
                    <strong>Il reste ${errors.length} point${pluriel} à corriger :</strong>
                    <ul style="margin-top: 10px; padding-left: 20px;">
                        ${errors.map((err) => DataManager.ligneErreurCliquable(err)).join('')}
                    </ul>
                    <div style="margin-top: 8px; font-weight: 400; font-size: 0.85em; opacity: 0.9;">
                        Cliquez une ligne pour aller au champ concerné.
                    </div>
                </div>
            `;
            DataManager.activerLiensErreurs();
            this.showMessage(errorMessage, 'error');

            // Scroll vers le premier champ en erreur
            const firstInvalidField = document.querySelector('.is-invalid');
            if (firstInvalidField) {
                firstInvalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                firstInvalidField.focus();
            }

            return false;
        }

        return true;
    }

    /**
     * Champ (ou section) visé par un message de validation. Table de correspondance plutôt qu'un identifiant
     * passé à chaque `errors.push(...)` : les messages existants restent inchangés, et un message non reconnu
     * s'affiche simplement sans lien.
     */
    static get ANCRES_ERREURS() {
        return [
            [/nom du projet/i, 'nom_projet'],
            [/typologie de projet/i, 'step_typologie'],
            [/type de connexion/i, 'id_projet_connecter'],
            [/mode de valorisation|option pour le projet hors ligne|typologie du système/i, 'mode_de_valorisation'],
            [/profil consommateur/i, 'step_profil_consommateur'],
            [/type de projet personnalisé|Autre type de projet/i, 'autre_type_projet_select'],
            [/type de projet/i, 'type_projet_select'],
            [/classification personnalisée|Autre classification/i, 'autre_type_ouvrage'],
            [/classification de l'ouvrage/i, 'type_ouvrage'],
            [/nature des travaux personnalisée|Autre nature/i, 'autre_nature_des_traveaux'],
            [/nature des travaux/i, 'nature_des_traveaux'],
            [/pays/i, 'pays'],
            [/adresse/i, 'parametreProjectSearch'],
            [/zone de vent/i, 'input_zone_de_vent'],
            [/zone de neige/i, 'input_zone_de_neige'],
            [/zone sismique/i, 'input_zone_sismique'],
        ];
    }

    static ligneErreurCliquable(message) {
        const regle = DataManager.ANCRES_ERREURS.find(([motif]) => motif.test(message));
        const cible = regle && document.getElementById(regle[1]) ? regle[1] : null;
        if (!cible) return `<li>${message}</li>`;
        return `<li><a href="#" data-ancre-champ="${cible}" style="color:inherit; text-decoration:underline; cursor:pointer;">${message}</a></li>`;
    }

    /** Clic sur une ligne d'erreur : déplie la section si elle est repliée, puis met le champ en évidence. */
    static activerLiensErreurs() {
        if (DataManager._liensErreursActifs) return;
        DataManager._liensErreursActifs = true;
        document.addEventListener('click', (e) => {
            const lien = e.target.closest('[data-ancre-champ]');
            if (!lien) return;
            e.preventDefault();
            const champ = document.getElementById(lien.getAttribute('data-ancre-champ'));
            if (!champ) return;
            // Sections repliables : un champ masqué ne peut ni défiler ni recevoir le curseur.
            if (champ.closest('#company-settings-content') && typeof window.afficherPersonnalisationRapport === 'function') {
                window.afficherPersonnalisationRapport(true);
            }
            if (champ.closest('#irradiation-contenu') && typeof window.afficherReglagesIrradiation === 'function') {
                window.afficherReglagesIrradiation(true);
            }
            const details = champ.closest('details');
            if (details) details.open = true;
            // Champ caché (les cartes cliquables alimentent des <input type="hidden">) : on vise alors la
            // section qui le contient, seule chose réellement visible à l'écran.
            const visible = champ.offsetParent !== null ? champ : (champ.closest('.step') || champ.parentElement || champ);
            visible.scrollIntoView({ behavior: 'smooth', block: 'center' });
            visible.classList.add('champ-a-completer');
            setTimeout(() => visible.classList.remove('champ-a-completer'), 2500);
            champ.classList.add('champ-a-completer');
            setTimeout(() => champ.classList.remove('champ-a-completer'), 2500);
            if (typeof champ.focus === 'function') {
                try { champ.focus({ preventScroll: true }); } catch (err) { champ.focus(); }
            }
        });
    }

    /**
     * Construit le FormData du formulaire "Paramètre Projet" à partir de l'état actuel du DOM.
     * Factorisé hors de submitParametreProjet() pour être réutilisable par syncParametreProjetSilently()
     * (sauvegarde silencieuse en arrière-plan, cf. bug "les données de Paramètre Projet ne sont pas
     * sauvegardées si l'utilisateur ne clique pas sur le bouton dédié de cet onglet").
     */
    buildParametreProjetFormData() {
        const formData = new FormData();
        const csrfToken = document.querySelector('input[name="csrf_token"]');
        if (csrfToken) formData.append('csrf_token', csrfToken.value);

        const fields = {
            'type_de_projet': 'type_de_projet',
            'typologie_projet': 'typologie_projet',
            'mode_de_valorisation': 'mode_de_valorisation',
            'option_reseau': 'option_reseau',
            'type_etude': 'type_etude',
            'nom_projet': 'nom_projet',
            'type_projet_select': 'type_projet_select',
            'autre_type_projet_select': 'autre_type_projet_select',
            'type_ouvrage': 'type_ouvrage',
            'autre_type_ouvrage': 'autre_type_ouvrage',
            'nature_des_traveaux': 'nature_des_traveaux',
            'autre_nature_des_traveaux': 'autre_nature_des_traveaux',
            'date_livrable': 'date_livrable',
            'parametre_project_hidden': 'adresse_projet',
            'pays': 'pays',
            'input_zone_de_vent': 'zone_de_vent',
            'input_categorie_de_terrain': 'categorie_de_terrain',
            'input_zone_de_neige': 'zone_de_neige',
            'input_zone_sismique': 'zone_sismique',
            'niv_keraunique': 'niveau_keraunique'
        };

        Object.entries(fields).forEach(([fieldId, formKey]) => {
            const element = document.querySelector('#form_parametre_projet #' + fieldId) || document.getElementById(fieldId);
            if (element && element.value) {
                let valueToAppend = element.value;

                // Résolution correcte des champs avec "Autres" pour que la valeur
                // personnalisée soit directement envoyée au backend (surtout utile pour l'update).
                if (formKey === 'type_projet_select') {
                    if (valueToAppend === 'Autres') {
                        const autreEl = document.querySelector('#form_parametre_projet #autre_type_projet_select') || document.getElementById('autre_type_projet_select');
                        if (autreEl && autreEl.value) valueToAppend = autreEl.value;
                    }
                    formData.append('type_projet', valueToAppend);
                } else if (formKey === 'type_ouvrage') {
                    if (valueToAppend === 'Autres') {
                        const autreEl = document.getElementById('autre_type_ouvrage');
                        if (autreEl && autreEl.value) valueToAppend = autreEl.value;
                    }
                } else if (formKey === 'nature_des_traveaux') {
                    if (valueToAppend === 'Autres') {
                        const autreEl = document.getElementById('autre_nature_des_traveaux');
                        if (autreEl && autreEl.value) valueToAppend = autreEl.value;
                    }
                }

                formData.append(formKey, valueToAppend);
            }
        });

        // Chargé(e) d'études : toujours envoyé (même vide) pour pouvoir effacer la valeur en base,
        // contrairement aux champs ci-dessus qui ne partent que s'ils sont renseignés.
        const chargeEtudes = document.querySelector('#form_parametre_projet #charge_etudes');
        if (chargeEtudes) {
            formData.append('charge_etudes', chargeEtudes.value.trim().slice(0, 30));
        }

        // Environnement salin
        const environnementSalin = document.getElementById('environnementSalin');
        if (environnementSalin) {
            formData.append('environnement_salin', environnementSalin.checked);
        }

        // Ajouter l'ID du projet si en mode édition
        const projetIdEdit = document.getElementById('projet_id_edit');
        if (projetIdEdit && projetIdEdit.value) {
            formData.append('projet_id', projetIdEdit.value);
        }

        // Ajout de la norme sélectionnée lors de la création/modification du projet
        const normeId = document.getElementById('norme_calcul_id_selected');
        if (normeId && normeId.value) {
            formData.append('norme_calcul_id', normeId.value);
        }

        return formData;
    }

    /**
     * Sauvegarde silencieuse (best-effort, sans validation/reset/reload) des champs "Paramètre Projet"
     * actuellement dans le DOM, pour un projet déjà existant. Appelée en arrière-plan depuis
     * ParametresProjet.js (syncAllProjectDataToDatabase) avant de figer/mettre à jour le rapport —
     * contrairement à submitParametreProjet(), elle ne modifie ni ne réinitialise l'UI et ne recharge
     * jamais la page, pour ne pas perturber le flux de fermeture du rapport.
     */
    async syncParametreProjetSilently({ projetId } = {}) {
        const projetIdEdit = document.getElementById('projet_id_edit');
        if (!projetIdEdit || !projetIdEdit.value) return { success: true, skipped: true };
        if (!document.querySelector('#form_parametre_projet')) return { success: true, skipped: true };
        // Formulaire d'un AUTRE projet que celui qu'on enregistre : jamais envoyé ici.
        if (projetId && String(projetIdEdit.value) !== String(projetId)) return { success: true, skipped: true };

        try {
            const formData = this.buildParametreProjetFormData();
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetIdEdit.value}/update`, {
                method: 'POST',
                body: formData
            });
            let result = null;
            try { result = await response.json(); } catch (e) { /* réponse non JSON */ }
            if (!response.ok || (result && result.success === false)) {
                return { success: false, message: (result && (result.message || result.error)) || `erreur ${response.status}` };
            }
            this.parametresModifies = false;
            return { success: true };
        } catch (error) {
            console.warn('Synchronisation silencieuse de Paramètre Projet impossible :', error);
            return { success: false, message: 'connexion interrompue ?' };
        }
    }

    /** Le formulaire est-il ouvert en modification sur le projet actif ? */
    _formulaireDuProjetActif() {
        const projetIdEdit = document.getElementById('projet_id_edit');
        const actif = localStorage.getItem('current_projet_id');
        return !!(projetIdEdit && projetIdEdit.value && actif && String(projetIdEdit.value) === String(actif));
    }

    /** Modifications du formulaire « Paramètres du projet » (projet actif) pas encore enregistrées. */
    parametresNonEnregistres() {
        return this.parametresModifies && this._formulaireDuProjetActif();
    }

    /**
     * Suit les saisies de l'utilisateur dans le formulaire « Paramètres du projet » (événements
     * réels seulement : le remplissage du formulaire par script ne compte pas).
     */
    setupSuiviParametres() {
        if (this._suiviParametresInstalle) return;
        this._suiviParametresInstalle = true;
        const marquer = (event) => {
            if (!event.isTrusted || !event.target || !event.target.closest) return;
            if (!event.target.closest('#form_parametre_projet')) return;
            if (event.type === 'click' && !event.target.closest('.project-type-card, .option-card, .mode-de-valorisation')) return;
            if (this._formulaireDuProjetActif()) this.parametresModifies = true;
        };
        ['input', 'change', 'click'].forEach((type) => document.addEventListener(type, marquer, true));
    }

    async submitParametreProjet() {
        // ✅ PROTECTION CONTRE LES DOUBLES SOUMISSIONS
        if (this.isSubmitting) {
            console.log('⚠️ Soumission déjà en cours, requête ignorée');
            this.showMessage('Une soumission est déjà en cours, veuillez patienter...', 'warning');
            return;
        }

        // Valider le formulaire avant soumission
        if (!this.validateParametreProjetForm()) {
            return;
        }

        const pays = $('#pays').val();
        if (!pays) {
            this.showMessage('Veuillez sélectionner un pays.', 'error');
            return;
        }

        // ✅ Marquer la soumission comme en cours
        this.isSubmitting = true;

        const formData = this.buildParametreProjetFormData();
        const projetIdEdit = document.getElementById('projet_id_edit');

        try {
            // Bug rapporté (2026-10-24, « Enregistrement refusé : le projet ouvert dans cette page (59)
            // n'est plus le projet actif (61) » après création puis « Ouvrir mon projet ») : /creer et
            // /update font du projet enregistré le projet actif de la session. Le projet en cours doit
            // donc être enregistré AVANT, sinon toutes ses écritures sont refusées (409) ensuite.
            const projetEnCours = localStorage.getItem('current_projet_id');
            const basculeProjet = !!projetEnCours
                && (!(projetIdEdit && projetIdEdit.value) || String(projetIdEdit.value) !== String(projetEnCours));
            if (basculeProjet) {
                this.showMessage('Enregistrement du projet en cours...', 'info');
                const enregistrement = await this.saveCurrentProjectBeforeSwitch();
                const action = projetIdEdit && projetIdEdit.value ? 'enregistrer ce projet' : 'créer le nouveau projet';
                if (!this.confirmerMalgreEchecEnregistrement(enregistrement, action)) {
                    this.showMessage('Opération annulée : le projet en cours reste ouvert. Réessayez avec l\'icône « Sauvegarder ».', 'warning');
                    return;
                }
            }

            this.showMessage('Sauvegarde en cours...', 'info');

            const url = projetIdEdit && projetIdEdit.value ?
                `/concevoir_mon_projet/parametre-projet/${projetIdEdit.value}/update` :
                '/concevoir_mon_projet/parametre-projet/creer';

            const response = await fetch(url, {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const result = await response.json();
                if (result && result.success !== false) this.parametresModifies = false;

                // ✅ Vérifier si c'est une duplication détectée
                if (result.duplicate_detected) {
                    console.log('⚠️ Duplication détectée par le serveur');
                }

                this.showMessage(
                    projetIdEdit && projetIdEdit.value ?
                        'Projet modifié avec succès!' :
                        'Projet créé avec succès!',
                    'success'
                );

                // Lire le nom AVANT de réinitialiser le formulaire
                const projectId = result.projet_id || (projetIdEdit && projetIdEdit.value);

                // Chargé(e) d'études : reporté tout de suite dans solarProjectData.projectInfo du
                // projet actif (lu par la page de garde du rapport, cf. ExportService.addCoverPage).
                const chargeEtudesSaisi = formData.get('charge_etudes');
                if (chargeEtudesSaisi !== null && projectId && String(projectId) === localStorage.getItem('current_projet_id')) {
                    try {
                        const sd = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                        sd.projectInfo = { ...(sd.projectInfo || {}), chargeEtudes: chargeEtudesSaisi };
                        localStorage.setItem('solarProjectData', JSON.stringify(sd));
                    } catch (e) { /* ignoré */ }
                }
                const projectName = result.nom_projet ||
                    (result.projet && result.projet.nom_projet) ||
                    document.querySelector('#form_parametre_projet #nom_projet')?.value || '';

                // Réinitialiser le formulaire
                this.resetForm();

                if (projectId) {
                    // CORRECTION : ce bloc s'exécute aussi bien après une création qu'après une
                    // MODIFICATION (update) d'un projet existant. Le vidage du localStorage de
                    // calepinage ne doit avoir lieu que pour une véritable création de projet,
                    // sinon les panneaux du projet qu'on vient de modifier sont supprimés.
                    const isNewProject = !(projetIdEdit && projetIdEdit.value);

                    // Projet en cours déjà enregistré avant la requête (cf. basculeProjet ci-dessus).
                    // Modification du projet en cours lui-même : la session ne change pas, il est
                    // enregistré ici comme avant.
                    if (!basculeProjet) {
                        const enregistrement = await this.saveCurrentProjectBeforeSwitch();
                        if (!this.confirmerMalgreEchecEnregistrement(enregistrement, 'recharger ce projet')) {
                            this.showMessage('Projet enregistré, mais la page n\'est pas rechargée : enregistrez le projet (icône « Sauvegarder »).', 'warning');
                            return;
                        }
                    }

                    // Autre projet ouvert : caches locaux de celui qu'on quitte oubliés.
                    const projetQuitte = localStorage.getItem('current_projet_id');
                    if (projetQuitte && String(projetQuitte) !== String(projectId)) {
                        oublierCachesProjetQuitte(projetQuitte);
                        // Les modules de la page gardent l'état du projet quitté jusqu'à l'ouverture du
                        // nouveau : il ne doit plus être renvoyé (session déjà sur le nouveau projet).
                        this.projetQuitteEnregistre = String(projectId);
                    }

                    if (isNewProject) {
                        // CORRECTIF (bug rapporté : "un nouveau projet hérite des courbes de charge du
                        // projet précédent — bug dans l'IndexedDB") : bloc inline remplacé par un appel
                        // à clearAllProjectLocalState() (définie en tête de ce fichier), qui vide
                        // désormais aussi l'IndexedDB (consFile/pvFile/accFile_*), pas seulement
                        // localStorage/sessionStorage comme avant.
                        await clearAllProjectLocalState();
                    }

                    // CORRECTIF (bug majeur "un nouveau projet écrase les données d'un autre projet
                    // existant") : un simple localStorage.setItem('current_projet_id', ...) ne suffit
                    // pas — CalepinageDataService.getCurrentProjetId() priorise this.currentProjetId
                    // (propriété EN MÉMOIRE), qui restait ici sur l'ANCIEN projet. Le minuteur de
                    // sauvegarde automatique (120s), toujours lié à cette propriété périmée, pouvait
                    // alors se déclencher pendant la fenêtre avant rechargement et écrire — sous
                    // l'identité de l'ANCIEN projet — le contenu de solarProjectData à ce moment-là.
                    // setCurrentProjet() met à jour la propriété en mémoire ET relance le minuteur
                    // correctement lié au NOUVEAU projet.
                    if (window.calepinageService && typeof window.calepinageService.setCurrentProjet === 'function') {
                        window.calepinageService.setCurrentProjet(projectId);
                    } else {
                        localStorage.setItem('current_projet_id', projectId);
                    }
                    localStorage.setItem('current_projet_nom', projectName);
                    console.log(`✅ Projet ${projectId} - "${projectName}" stocké dans localStorage`);

                    // Recharger la liste des projets MAINTENANT que current_projet_id pointe vers CE
                    // projet, pour que sa ligne s'affiche cochée "Actif" (cf. isSelected, dans le
                    // rendu du tableau) — ce qui active du même coup le bouton "Ouvrir mon projet"
                    // (openSelectedActiveProject() lit la case cochée pour savoir quel projet ouvrir).
                    this.loadProjects();

                    if (isNewProject) {
                        // NOUVEAU WORKFLOW (demande explicite) : après création, on ne navigue plus
                        // automatiquement vers "Consommation d'énergie" — l'utilisateur doit d'abord
                        // voir, sur CE modal Paramètres (onglet "Mes projets", déjà coché "Actif" sur
                        // sa ligne grâce au rechargement ci-dessus), la confirmation visuelle que la
                        // création a réussi. La redirection ne se déclenche plus qu'explicitement, au
                        // clic sur "Ouvrir mon projet" OU à la fermeture du modal — cf.
                        // pendingProjectOpen, consommé par openSelectedActiveProject() (qui l'efface
                        // sans redirection supplémentaire puisqu'il ouvre déjà lui-même le projet
                        // coché) et par closeModal() dans initialisationMap.js (qui délègue alors à
                        // selectAndLoadProject(), point d'entrée unique "ouverture de projet" —
                        // sauvegarde, activation serveur, fermeture du modal, auto-ouverture de
                        // "Consommation d'énergie").
                        this.pendingProjectOpen = { id: projectId, name: projectName };
                        if (window.uiManagerInstance && typeof window.uiManagerInstance.switchToSection === 'function') {
                            window.uiManagerInstance.switchToSection('button_mes_projets');
                        }
                    } else {
                        // Modification d'un projet existant : rechargement direct, puis étape suivante
                        // du parcours (demande explicite : Paramètres projet -> Profil de
                        // consommation ; Calepinage pour le parcours Chiffrage, cf. navigation-modales.js).
                        sessionStorage.setItem('autoOpenConsEnergie', 'true');
                        console.log('🔄 Rafraîchissement de la page...');
                        setTimeout(() => {
                            // CORRECTIF (bug rapporté : "après création, en fermant le modal Cons. Énergie
                            // on retombe sur le modal Paramètres") : un simple reload() re-vérifie
                            // current_projet_id en localStorage au DOMContentLoaded suivant
                            // (ParametresProjet.js), mais cette lecture peut s'exécuter avant que la valeur
                            // tout juste écrite ci-dessus (setCurrentProjet/setItem) ne soit synchrone pour ce
                            // guard — même race déjà documentée et déjà corrigée pour l'ouverture d'un projet
                            // EXISTANT (cf. selectAndLoadProject() ci-dessus). On réutilise donc le même
                            // mécanisme fiable : le paramètre d'URL 'activated_project', qu'aucune race de
                            // timing localStorage ne peut affecter.
                            window.location.href = `${window.SKV_URL_ACCUEIL}?activated_project=${encodeURIComponent(projectId)}`;
                        }, 1000);
                    }
                } else {
                    // Recharger la liste des projets
                    this.loadProjects();
                    // Si pas de projectId, comportement par défaut
                    setTimeout(() => {
                        if (window.uiManagerInstance && typeof window.uiManagerInstance.switchToSection === 'function') {
                            window.uiManagerInstance.switchToSection('button_mes_projets');
                        } else {
                            const mesProjetBtn = document.getElementById('button_mes_projets');
                            if (mesProjetBtn) mesProjetBtn.click();
                        }
                    }, 1500);
                }

            } else {
                // CORRECTIF (bug rapporté : "impossible de créer un projet, message 'erreur de
                // connexion'") : une réponse d'erreur non-JSON (ex. page HTML 400 renvoyée par la
                // protection CSRF si le jeton est devenu invalide — page restée ouverte trop
                // longtemps, redémarrage serveur...) faisait échouer response.json() ici, ce qui
                // tombait dans le catch ci-dessous et affichait le message générique et trompeur
                // "Erreur de connexion" même quand la requête avait bien atteint le serveur.
                let errorMessage = `Erreur lors de la sauvegarde (code ${response.status})`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.message || errorMessage;
                } catch (parseError) {
                    if (response.status === 400 || response.status === 403) {
                        errorMessage = 'Votre session a peut-être expiré. Veuillez recharger la page et réessayer.';
                    }
                }
                this.showMessage(errorMessage, 'error');
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showMessage('Erreur de connexion. Veuillez réessayer.', 'error');
        } finally {
            // ✅ TOUJOURS réinitialiser le flag de soumission
            this.isSubmitting = false;
        }
    }

    async submitModeCalculNorme() {
        // ✅ PROTECTION CONTRE LES DOUBLES SOUMISSIONS
        if (this.isSubmittingNorme) {
            console.log('⚠️ Soumission de norme déjà en cours, requête ignorée');
            this.showMessage('Une soumission est déjà en cours, veuillez patienter...', 'warning');
            return;
        }

        const typeEtude = $('#type_etude').val();
        if (!typeEtude) {
            this.showMessage('Veuillez sélectionner un type d\'étude.', 'error');
            return;
        }

        // ✅ Vérifier la limite de 5 normes
        try {
            const response = await fetch('/concevoir_mon_projet/normes-calcul');
            const data = await response.json();

            if (data.success && data.normes && data.normes.length >= 5) {
                this.showMessage('Vous avez atteint la limite de 5 normes. Veuillez supprimer une norme existante avant d\'en créer une nouvelle.', 'error');
                return;
            }
        } catch (error) {
            console.error('Erreur lors de la vérification du nombre de normes:', error);
        }

        // ✅ Marquer la soumission comme en cours
        this.isSubmittingNorme = true;

        const formData = new FormData();
        const csrfToken = document.querySelector('input[name="csrf_token"]');
        if (csrfToken) formData.append('csrf_token', csrfToken.value);

        formData.append('type_etude', typeEtude);
        formData.append('type_tension', $('#mode_de_tension').val() || '');

        const tensionAutre = $('#autre_tension').val();
        if (tensionAutre && $('#mode_de_tension').val() === 'Autres') {
            formData.append('tension_personnalisee', tensionAutre);
        }

        // Normes sélectionnées
        const normes = [];
        $('.option-card.selected').each(function () {
            normes.push($(this).find('h5').text());
        });
        formData.append('norme_electrique', normes.join(','));

        // Paramètres techniques
        const parametres = {
            'tension_photovoltaique': 'chute_tension_pv',
            'tension_soutirage': 'chute_tension_soutirage',
            'temperature_minimale': 'temperature_minimale',
            'temperature_maximale': 'temperature_maximale',
            'cosinus_paramètre_onduleur': 'cosinus_phi',
            'ration_surdimensionnement': 'ratio_surdimensionnement',
            'coefficient_performance': 'coefficient_degradation',
            'incertitude_P90': 'incertitude_P90'
        };

        Object.entries(parametres).forEach(([fieldId, formKey]) => {
            const value = $(`#${fieldId}`).val();
            if (value) formData.append(formKey, value);
        });

        try {
            this.showMessage('Sauvegarde en cours...', 'info');

            const response = await fetch('/concevoir_mon_projet/concevoir-mon-projet/mode-de-calcul-norme/creer', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                const result = await response.json();

                // ✅ Vérifier si c'est une duplication détectée
                if (result.duplicate_detected) {
                    console.log('⚠️ Duplication de norme détectée par le serveur');
                }

                this.showMessage('Configuration sauvegardée avec succès!', 'success');

                // ✅ Rediriger vers l'onglet "Paramètres projet" après sauvegarde de norme
                setTimeout(() => {
                    if (window.uiManagerInstance && typeof window.uiManagerInstance.switchToSection === 'function') {
                        window.uiManagerInstance.switchToSection('button_parametre_projet');
                        console.log('✅ Navigation vers "Paramètres projet" après sauvegarde de norme');
                    } else {
                        // Fallback : méthode classique
                        const paramProjetBtn = document.getElementById('button_parametre_projet');
                        if (paramProjetBtn) paramProjetBtn.click();
                    }
                }, 1500);

            } else {
                const errorData = await response.json();
                this.showMessage(errorData.message || 'Erreur lors de la sauvegarde', 'error');
            }
        } catch (error) {
            console.error('Erreur:', error);
            this.showMessage('Erreur de connexion. Veuillez réessayer.', 'error');
        } finally {
            // ✅ TOUJOURS réinitialiser le flag de soumission
            this.isSubmittingNorme = false;
        }
    }

    // ==========================================
    // UTILITAIRES
    // ==========================================

    // Utilitaire pour résoudre les valeurs des selects qui possèdent une option "Autres"
    resolveSelectCustomValue(selectId, dbValue, defaultVal) {
        let val = dbValue || defaultVal;
        let customVal = '';
        const selectEl = document.querySelector('#form_parametre_projet #' + selectId) || document.getElementById(selectId);
        if (selectEl && val) {
            let isCustom = true;
            for (let i = 0; i < selectEl.options.length; i++) {
                if (selectEl.options[i].value === val) {
                    isCustom = false;
                    break;
                }
            }
            if (isCustom) {
                customVal = val;
                val = 'Autres';
            }
        }
        return { value: val, customValue: customVal };
    }

    escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.toString().replace(/[&<>"']/g, m => map[m]);
    }

    /**
     * Vérifie si une valeur ressemble à un email
     */
    isEmail(value) {
        if (!value || typeof value !== 'string') return false;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(value);
    }

    /**
     * Génère le HTML de la cellule "Créé par" avec input éditable ou texte
     */
    renderCreatedByCell(projet) {
        const createdBy = projet.created_by_name || projet.created_by_email || '';
        const isEmailValue = this.isEmail(createdBy);
        const isEmpty = !createdBy || createdBy.trim() === '';

        // Si c'est vide ou un email, afficher un input éditable avec notice
        if (isEmpty || isEmailValue) {
            const displayValue = isEmpty ? '' : createdBy;
            const placeholder = isEmpty ? 'Entrez le nom du créateur' : 'Modifier le nom';
            const noticeClass = isEmpty ? 'text-warning' : '';
            const noticeIcon = isEmpty ? '<i class="fas fa-exclamation-triangle"></i> ' : '';

            return `
                <div class="creator-name-edit" style="position: relative;">
                    <input type="text"
                           class="form-control form-control-sm creator-name-input"
                           data-projet-id="${projet.id}"
                           value="${this.escapeHtml(displayValue)}"
                           placeholder="${placeholder}"
                           title="Cliquez pour modifier le nom du créateur"
                           style="font-size: 0.85rem; padding: 4px 8px; text-align: center; border: 1px solid ${isEmpty ? '#ffc107' : '#ced4da'};">
                    ${isEmpty ? `<small class="${noticeClass}" style="display: block; font-size: 0.7rem; margin-top: 2px;">${noticeIcon}Veuillez remplir ce champ</small>` : ''}
                </div>
            `;
        }

        // Sinon, afficher le nom avec possibilité de cliquer pour modifier
        return `
            <div class="creator-name-display" style="cursor: pointer; position: relative;"
                 data-projet-id="${projet.id}"
                 title="Double-cliquez pour modifier">
                <span class="creator-name-text">${this.escapeHtml(createdBy)}</span>
                <i class="fas fa-edit" style="font-size: 0.7rem; margin-left: 5px; opacity: 0.5;"></i>
            </div>
        `;
    }

    /**
     * Sauvegarde le nom du créateur dans la base de données
     */
    async saveCreatorName(projetId, creatorName) {
        try {
            const response = await fetch('/concevoir_mon_projet/update_project_creator', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    projet_id: projetId,
                    creator_name: creatorName
                })
            });

            const data = await response.json();

            if (data.success) {
                console.log(`✅ Nom du créateur mis à jour pour le projet ${projetId}`);

                // Mettre à jour localStorage si c'est le projet actuel
                const currentProjetId = localStorage.getItem('current_projet_id');
                if (currentProjetId && parseInt(currentProjetId) === projetId) {
                    const savedData = localStorage.getItem('solarProjectData');
                    if (savedData) {
                        const projectData = JSON.parse(savedData);
                        if (!projectData.projectInfo) {
                            projectData.projectInfo = {};
                        }
                        projectData.projectInfo.createdBy = creatorName;
                        localStorage.setItem('solarProjectData', JSON.stringify(projectData));
                        console.log('✅ localStorage mis à jour avec le nom du créateur');
                    }
                }

                return true;
            } else {
                console.error('❌ Erreur lors de la mise à jour du nom du créateur:', data.message);
                this.showError(data.message || 'Erreur lors de la mise à jour');
                return false;
            }
        } catch (error) {
            console.error('❌ Erreur réseau:', error);
            this.showError('Erreur de connexion lors de la mise à jour');
            return false;
        }
    }

    formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('fr-FR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    }

    getStatusBadgeClass(status) {
        const classes = {
            'En cours': 'bg-primary',
            'Terminé': 'bg-success',
            'Archivé': 'bg-secondary',
            // Types d'étude (libellés de getTypeEtudeDisplayLabel) : jaune / bleu clair / vert
            'Chiffrage': 'bg-warning text-dark',
            'Étude technico-économique': 'bg-info text-dark',
            'Étude de conception': 'bg-success'
        };
        return classes[status] || 'bg-info';
    }

    /**
     * Libellé du type d'étude affiché dans « Mes projets » (affichage seulement, jamais pour une
     * comparaison) : Chiffrage / Étude technico-économique / Étude de conception. Reconnaît aussi
     * l'ancienne valeur « Pré-étude de faisabilité » (ex-« Offre commerciale »), migrée en base
     * vers « Étude technico-économique » (migration d4a7e2c9f150), et la valeur stockée
     * « Étude de faisabilité détaillée ».
     * @param {string} rawTypeEtude - Valeur brute telle que stockée (projet.type_etude)
     * @returns {string} Libellé à afficher à l'utilisateur
     */
    getTypeEtudeDisplayLabel(rawTypeEtude) {
        if (typeof rawTypeEtude !== 'string') return rawTypeEtude;
        const valeur = rawTypeEtude.toLowerCase();
        if (valeur.includes('chiffrage')) return 'Chiffrage';
        if (valeur.includes('pré-étude') || valeur.includes('préétude') || valeur.includes('technico')) {
            return 'Étude technico-économique';
        }
        if (valeur.includes('détaillée') || valeur.includes('conception')) return 'Étude de conception';
        return rawTypeEtude;
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showInfo(message) {
        this.showNotification(message, 'info');
    }

    showNotification(message, type) {
        const notification = document.createElement('div');
        const alertClass = type === 'success' ? 'success' : type === 'info' ? 'info' : 'danger';
        notification.className = `alert alert-${alertClass} alert-dismissible fade show`;
        notification.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
        notification.innerHTML = `
            ${message}
            <button type="button" class="btn-close" onclick="this.parentElement.remove()"></button>
        `;
        document.body.appendChild(notification);

        setTimeout(() => notification.remove(), 5000);
    }

    showMessage(message, type) {
        let messageElement = document.getElementById('form-message');
        if (!messageElement) {
            messageElement = document.createElement('div');
            messageElement.id = 'form-message';
            messageElement.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 20px;
                border-radius: 5px;
                color: white;
                font-weight: bold;
                z-index: 9999;
                max-width: 500px;
                max-height: 80vh;
                overflow-y: auto;
                transition: opacity 0.3s ease;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            `;
            document.body.appendChild(messageElement);
        }

        const colors = {
            success: '#28a745',
            error: '#dc3545',
            info: '#17a2b8',
            warning: '#ffc107'
        };

        messageElement.style.backgroundColor = colors[type] || colors.info;
        // Utiliser innerHTML au lieu de textContent pour supporter le HTML
        messageElement.innerHTML = message;
        messageElement.style.opacity = '1';

        // Augmenter le délai pour les messages d'erreur avec plusieurs items
        const timeout = type === 'error' ? 8000 : 5000;

        setTimeout(() => {
            messageElement.style.opacity = '0';
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.parentNode.removeChild(messageElement);
                }
            }, 300);
        }, timeout);
    }
    resetForm() {
        this.parametresModifies = false;
        // Réinitialiser le formulaire
        const form = document.getElementById('form_parametre_projet');
        if (form) {
            form.reset();
        }
        // Champs cachés des cartes (connexion, typologie, valorisation) : non vidés par form.reset() quand
        // leur valeur a été posée par script — vidés explicitement, cohérents avec les cartes désélectionnées
        // ci-dessous.
        ['type_de_projet', 'typologie_projet', 'mode_de_valorisation', 'option_reseau'].forEach((id) => {
            const champ = document.querySelector('#form_parametre_projet #' + id);
            if (champ) {
                champ.value = '';
                champ.defaultValue = '';
            }
        });
        this.updateProfilConsommateurVisibility('');

        // Supprimer l'ID d'édition
        const projetIdEdit = document.getElementById('projet_id_edit');
        if (projetIdEdit) {
            projetIdEdit.remove();
        }

        // Désélectionner toutes les cartes
        document.querySelectorAll('.project-type-card, .option-card, .mode-de-valorisation').forEach(card => {
            card.classList.remove('selected', 'active');
        });

        // « Étude technico-économique » reste présélectionnée par défaut pour un
        // nouveau projet — form.reset() ci-dessus restaure déjà #type_etude à sa valeur HTML par
        // défaut (« Étude technico-économique », cf. parametre.html), mais ne touche pas les classes
        // CSS ; on ré-applique donc `selected` sur la carte correspondante, désélectionnée par la
        // boucle ci-dessus comme toutes les autres.
        // Type d'étude par défaut du parcours (Chiffrage en PRO), comme la valeur HTML de #type_etude.
        const etudeParDefaut = (window.SKV_PARCOURS && window.SKV_PARCOURS.type_etude_defaut) || 'Étude technico-économique';
        const defaultEtudeCard = document.querySelector('.etude-option[data-value="' + etudeParDefaut + '"]');
        if (defaultEtudeCard) defaultEtudeCard.classList.add('selected');

        // Réinitialiser les boutons climatiques
        document.querySelectorAll('[class*="btn_reset_parametre"]').forEach(btn => {
            btn.classList.remove('btn_reset_parametre_js', 'active');
        });

        // NOUVEAU (demande explicite) : "Sauvegarder" (onglet "Informations projet") ne doit être
        // visible qu'en mode édition — projet_id_edit vient d'être retiré ci-dessus, donc masqué ici.
        this.updateSauvegarderInformationsProjetVisibility();
    }

    // Historique : affichait « Sauvegarder » de l'onglet « Informations projet » en édition seulement.
    // Depuis la fusion des onglets, le bouton unique « Sauvegarder le projet » (#save-btn-projet) est
    // TOUJOURS visible : #save-btn-informations-projet n'existe plus, cette méthode est donc sans effet
    // (conservée pour ses appelants, editProject()/resetForm()).
    updateSauvegarderInformationsProjetVisibility() {
        const btn = document.getElementById('save-btn-informations-projet');
        if (!btn) return;
        const projetIdEdit = document.getElementById('projet_id_edit');
        btn.style.display = (projetIdEdit && projetIdEdit.value) ? '' : 'none';
    }

    // NOUVEAU (demande explicite : bouton "Annuler les modifications") : décharge tout état
    // d'édition/création en cours (formulaire + marqueur d'édition, cf. resetForm()) et re-masque
    // les onglets "Créer un projet"/"Données d'irradiation" — révélés par switchToSection()
    // (ParametresProjet.js) mais jamais re-masqués à la fermeture jusqu'ici, ce qui les laissait
    // affichés par-dessus "Mes projets"/"Créer un nouveau projet" à la prochaine ouverture du modal
    // (jusqu'à un rechargement complet de la page). Appelée depuis closeMainModal()
    // (ParametresProjet.js), point de fermeture unique de ce modal (bouton X, "Fermer" de l'onglet
    // "Données d'irradiation", et le nouveau bouton "Annuler les modifications" qui déclenche ce
    // même bouton X).
    cancelEditAndReturnToMesProjets() {
        this.resetForm();

        const tabsList = document.getElementById('myTab');
        if (tabsList) tabsList.style.display = 'none';
        ['tab-item-parametre-projet', 'tab-item-mode-et-normes'].forEach((id) => {
            const tabItem = document.getElementById(id);
            if (tabItem) tabItem.style.display = 'none';
        });

        if (window.uiManagerInstance && typeof window.uiManagerInstance.switchToSection === 'function') {
            window.uiManagerInstance.switchToSection('button_mes_projets', true);
        } else {
            const tabLink = document.getElementById('button_mes_projets');
            if (tabLink) tabLink.click();
        }
    }

}
// Export par défaut
export default DataManager;