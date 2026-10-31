/**
 * Synchronisation en base de données de l'étude économique.
 *
 * CORRECTIF (bug "les champs de l'étude économique ne sont pas sauvegardés") : ce fichier était
 * référencé par etudes_economique_content.html (dernier <script> du template) mais n'existait pas
 * sur le disque — aucune sauvegarde vers le serveur ne pouvait donc jamais avoir lieu. EtudesEconomiqueLogic.js
 * (saveEconomicData/loadEconomicData) ne persiste QUE dans localStorage.solarProjectData.economicStudyInputs,
 * qui reste local au navigateur : quand l'utilisateur réouvre le projet sur un autre poste/session, ou
 * après un rechargement complet ayant remplacé solarProjectData par les données serveur du calepinage
 * (lesquelles ne connaissent rien de economicStudyInputs), les champs saisis semblaient perdus.
 *
 * Ce script fait le pont avec les routes déjà existantes côté backend (jamais appelées par aucun
 * autre code) :
 *   - GET  /concevoir_mon_projet/parametre-projet/<id>/etude-economique/load
 *   - POST /concevoir_mon_projet/parametre-projet/<id>/etude-economique/save
 *
 * Le modèle EtudeEconomiqueConfig.data est explicitement documenté comme "Stockage complet des
 * valeurs du formulaire (inputs, radios, checkboxes, tableaux dynamiques)" — soit exactement la
 * structure que saveEconomicData() construit et range dans economicStudyInputs.
 */
/*
 * Changement de projet SANS rechargement de page (« Ouvrir mon projet » depuis la carte, cf.
 * selectAndLoadProject) : le formulaire gardait les saisies de l'ancien projet et ne relisait
 * jamais celles du nouveau ; la saisie suivante les écrivait même dans le nouveau projet. Les
 * saisies sont désormais rattachées au projet chargé (projetCharge) : enregistrées avant le
 * changement (flush), puis formulaire remis aux valeurs par défaut et rechargé depuis la base à
 * l'évènement 'projetActifCharge'.
 */
(function () {
    'use strict';

    // Tableaux CAPEX / OPEX (résidentiel et PRO) : état et sauvegarde propres
    // (ResidentielChiffrageDB.js), jamais remis à zéro ici.
    const ZONES_NON_REINITIALISEES = '#pro-capex-container, #resi-capex-container, #resi-opex-container';

    // Projet auquel appartiennent les saisies affichées ; null pendant un chargement (aucune
    // sauvegarde en base tant que le formulaire n'est pas celui d'un projet connu).
    let projetCharge = null;
    let dbSaveTimeout;

    function getCurrentProjetId() {
        if (window.calepinageService && typeof window.calepinageService.getCurrentProjetId === 'function') {
            const id = window.calepinageService.getCurrentProjetId();
            if (id) return id;
        }
        return localStorage.getItem('current_projet_id');
    }

    /** Envoie en base les saisies affichées, pour le projet auquel elles appartiennent. */
    function pushEconomicDataToDatabase() {
        const projetId = projetCharge;
        if (!projetId || typeof window.collecterSaisiesEco !== 'function') return Promise.resolve();

        if (typeof window.getConversionDeviseState === 'function') {
            const conv = window.getConversionDeviseState();
            if (conv && conv.active && !conv.valid) {
                echecEnregistrement = true;
                return Promise.resolve({ success: false, message: conv.error || 'Taux de conversion invalide.' });
            }
        }

        const data = window.collecterSaisiesEco();
        if (!data) return Promise.resolve();

        const envoi = fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/etude-economique/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data })
        }).then((r) => r.json().catch(() => ({ success: r.ok }))).then((res) => {
            // Refus (validation, projet hors session) : saisies toujours à enregistrer.
            echecEnregistrement = !res || res.success === false;
            return res;
        }).catch((err) => {
            echecEnregistrement = true;
            console.warn('Sauvegarde de l\'étude économique en base impossible :', err);
            return { success: false, message: 'Enregistrement impossible (connexion interrompue ?).' };
        });
        envoiEnCours = envoi;
        envoi.finally(() => { if (envoiEnCours === envoi) envoiEnCours = null; });
        return envoi;
    }

    function debouncedPushEconomicData() {
        clearTimeout(dbSaveTimeout);
        dbSaveTimeout = setTimeout(() => { dbSaveTimeout = null; pushEconomicDataToDatabase(); }, 800);
    }

    // Saisies pas encore parvenues en base (sauvegarde différée, envoi en cours ou refusé) — cf.
    // services/sauvegarde_projet.js.
    let envoiEnCours = null;
    let echecEnregistrement = false;
    function enAttente() {
        return !!projetCharge && (!!dbSaveTimeout || !!envoiEnCours || echecEnregistrement);
    }

    /** Sauvegarde immédiate (locale + base) des saisies en cours — avant un changement de projet. */
    async function flush() {
        clearTimeout(dbSaveTimeout);
        dbSaveTimeout = null;
        if (!projetCharge) return;
        if (typeof window.saveEconomicDataNow === 'function') window.saveEconomicDataNow();
        return pushEconomicDataToDatabase();
    }

    /** Champs du formulaire remis à leur valeur initiale (attribut value / checked / selected). */
    function reinitialiserFormulaire() {
        const container = document.getElementById('etudes-economique-content');
        if (!container) return;
        container.querySelectorAll('input, select, textarea').forEach((el) => {
            if (el.closest(ZONES_NON_REINITIALISEES)) return;
            if (el.type === 'checkbox' || el.type === 'radio') {
                el.checked = el.defaultChecked;
            } else if (el.tagName === 'SELECT') {
                Array.from(el.options).forEach((opt) => { opt.selected = opt.defaultSelected; });
            } else if (el.type !== 'button' && el.type !== 'submit') {
                el.value = el.defaultValue;
            }
            delete el.dataset.manual;
            el.style.border = '';
        });
        ['capex_autres_container', 'opex_autres_container'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });
    }

    /**
     * Restaure les saisies enregistrées en base pour projetId — source de vérité prioritaire sur
     * un éventuel cache localStorage périmé (autre poste, ou solarProjectData remplacé entre-temps
     * par le rechargement du calepinage).
     */
    async function loadEconomicDataFromDatabase(projetId) {
        if (!projetId) return 'erreur';
        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/etude-economique/load`);
            const result = await response.json();

            if (result.success && result.config_exists && result.config && result.config.data) {
                const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
                savedData.economicStudyInputs = { ...result.config.data, projetId: String(projetId) };
                localStorage.setItem('solarProjectData', JSON.stringify(savedData));

                if (typeof window.loadEconomicData === 'function') {
                    window.loadEconomicData();
                }
                console.log('✅ Étude économique restaurée depuis la base de données');
                return 'restaure';
            }
            return result.success ? 'absent' : 'erreur';
        } catch (err) {
            console.warn('Chargement de l\'étude économique depuis la base impossible :', err);
            return 'erreur';
        }
    }

    /** Projet marqué sur le cache local des saisies (undefined : cache ancien, non marqué). */
    function projetDuCacheLocal() {
        try {
            const saisies = JSON.parse(localStorage.getItem('solarProjectData') || '{}').economicStudyInputs;
            return saisies ? saisies.projetId : undefined;
        } catch (e) {
            return undefined;
        }
    }

    /** Valeurs reprises du projet (puissance, productible, autoconsommation...) et affichage. */
    function rafraichirApresChargement(projetId) {
        if (typeof window.rafraichirInterfaceEco === 'function') window.rafraichirInterfaceEco();
        // Puissance, productible, taux et parts hiver/été : relus en base (calcul ProSolaire du
        // projet), prioritaires sur les saisies restaurées et sur le cache local.
        if (window.ReferenceProSolaire) window.ReferenceProSolaire.charger(projetId);
        if (typeof window.injectProjectDataToEconomicStudy === 'function') window.injectProjectDataToEconomicStudy();
        if (typeof window.injectAutoconsoDataToEconomicStudy === 'function') window.injectAutoconsoDataToEconomicStudy();
        // Évènement non propagé : réapplique les verrous qui suivent la puissance (tarif de surplus
        // résidentiel...) sans déclencher de sauvegarde ni de remise à zéro des résultats.
        const puissance = document.getElementById('puissance');
        if (puissance) puissance.dispatchEvent(new Event('input'));
    }

    /** Formulaire du projet projetId : valeurs par défaut, puis saisies enregistrées en base. */
    async function rechargerPourProjet(projetId) {
        clearTimeout(dbSaveTimeout);
        dbSaveTimeout = null;
        echecEnregistrement = false;
        projetCharge = null;
        reinitialiserFormulaire();
        if (typeof window.remettreResultatsEcoAZero === 'function') window.remettreResultatsEcoAZero();
        try {
            await loadEconomicDataFromDatabase(projetId);
            rafraichirApresChargement(projetId);
        } finally {
            projetCharge = projetId ? String(projetId) : null;
        }
    }

    async function setup() {
        const projetId = getCurrentProjetId();
        let etat = 'erreur';
        try {
            etat = await loadEconomicDataFromDatabase(projetId);
            // Rien en base : le cache local ne vaut que s'il est celui de CE projet (saisies jamais
            // parvenues au serveur, envoyées ci-dessous) ; celui d'un autre projet est écarté.
            const cache = projetDuCacheLocal();
            if (etat === 'absent' && cache && String(cache) !== String(projetId)) {
                reinitialiserFormulaire();
                etat = 'reinitialise';
            }
            rafraichirApresChargement(projetId);
        } finally {
            projetCharge = projetId ? String(projetId) : null;
        }
        if (etat === 'absent' && String(projetDuCacheLocal()) === projetCharge) pushEconomicDataToDatabase();

        const container = document.getElementById('etudes-economique-content');
        if (container) {
            // Après ceux d'EtudesEconomiqueLogic.js (window.onload) : le cache local est déjà à jour.
            container.addEventListener('input', debouncedPushEconomicData);
            container.addEventListener('change', () => { pushEconomicDataToDatabase(); });
        }
    }

    window.addEventListener('projetActifCharge', (evt) => {
        const projetId = evt.detail && evt.detail.projetId;
        if (projetId && String(projetId) !== projetCharge) rechargerPourProjet(projetId);
    });

    window.addEventListener('load', () => {
        // Laisser le temps à EtudesEconomiqueLogic.js de terminer son initialisation (generatePaliers,
        // toggle*, loadEconomicData local) avant de tenter de restaurer/écraser avec les données serveur.
        setTimeout(setup, 600);
    });

    window.EtudesEconomiqueDB = { flush, enAttente, rechargerPourProjet, projetCharge: () => projetCharge };
})();
