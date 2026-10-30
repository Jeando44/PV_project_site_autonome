/**
 * Forme canonique (clés triées) pour comparer le calepinage local à celui lu en base, dont l'ordre
 * des clés n'est pas celui du navigateur.
 */
function canonique(valeur) {
    if (Array.isArray(valeur)) return valeur.map(canonique);
    if (valeur && typeof valeur === 'object') {
        const out = {};
        Object.keys(valeur).sort().forEach((k) => { out[k] = canonique(valeur[k]); });
        return out;
    }
    return valeur;
}

// Clés ignorées pour dire si le calepinage est enregistré : réinjectées depuis d'autres tables par
// la route de lecture (projectInfo, meteoData, normesElectriques, indicesRevision), enregistrées par
// leur propre module (economicStudyInputs, cf. EtudesEconomiqueDB.js), simples horodatages
// (lastSaveTime ; systemPageLoadedAt, réécrit à chaque chargement par SystemPageLoader.js), ou vue
// de la carte (mapCenter, mapZoom : réécrites toutes les 3 s par StorageManager.savePageData ; un
// déplacement ou un zoom de la carte laissait le calepinage « non enregistré » en permanence).
const CLES_HORS_COMPARAISON = ['projectInfo', 'meteoData', 'normesElectriques', 'indicesRevision', 'economicStudyInputs', 'lastSaveTime', 'systemPageLoadedAt', 'mapCenter', 'mapZoom'];

function signatureComparaison(fullPayload) {
    const copie = { ...fullPayload };
    CLES_HORS_COMPARAISON.forEach((k) => { delete copie[k]; });
    if (copie.geometriePlansData && typeof copie.geometriePlansData === 'object') {
        copie.geometriePlansData = { ...copie.geometriePlansData };
        delete copie.geometriePlansData.savedAt;
    }
    // Horodatage réécrit à chaque mise à jour du résumé (SummaryModal.saveTotalsToLocalStorage),
    // même sans changement des totaux.
    if (copie.totals && typeof copie.totals === 'object') {
        copie.totals = { ...copie.totals };
        delete copie.totals.lastUpdated;
    }
    return JSON.stringify(canonique(copie));
}

/**
 * Service pour gérer la sauvegarde et le chargement des données de calepinage
 * entre le localStorage et la base de données
 * CalepinageDataService - Service frontend pour la communication des données de calepinage avec le serveur
 */
export default class CalepinageDataService {
    constructor() {
        this.storageKey = 'solarProjectData';
        // GARDE-FOU (bug majeur "un projet hérite du calepinage d'un autre") : plusieurs points du
        // code (création de projet, édition des paramètres d'un AUTRE projet pendant qu'un projet
        // différent est activement chargé, etc.) mettent à jour `current_projet_id` en localStorage
        // AVANT que le rechargement de page ne remplace réellement `solarProjectData` par les données
        // du nouveau projet. Deux bugs distincts causés par cette désynchronisation ont déjà été
        // trouvés et corrigés au cas par cas (ex: selectAndLoadProject) — plutôt que de continuer à
        // traquer un par un chaque point d'entrée qui pourrait un jour introduire la même désynchro,
        // ce marqueur d'appartenance enregistre, à CHAQUE fois que solarProjectData est effectivement
        // rempli avec les données d'un projet précis (cf. loadFromDatabase), l'ID de ce projet. Avant
        // toute sauvegarde vers le serveur (saveToDatabase), on vérifie que ce marqueur correspond bien
        // au projet ciblé — sinon on BLOQUE la sauvegarde plutôt que de risquer d'écrire le calepinage
        // d'un projet sous l'identité d'un autre.
        this.ownerKey = 'solarProjectData_owner_id';
        this.currentProjetId = null;
        // DÉSACTIVÉ (2026-07-26) : ce minuteur de sauvegarde automatique toutes les 120s s'est avéré
        // être la source directe de plusieurs bugs de corruption croisée entre projets — il restait lié,
        // en mémoire, à l'ANCIEN projet après un changement de contexte (nouveau projet créé, purge du
        // formulaire...), et écrivait alors le contenu de solarProjectData sous l'identité de cet ancien
        // projet. Des sauvegardes explicites existent déjà à de nombreux points (bouton "Calculer et
        // visualiser", navigation entre pages, changement de projet, "Valider et sauvegarder", fermeture
        // du modal Paramètres, beforeunload) : ce filet de sécurité périodique n'est plus nécessaire et
        // supprime toute une classe de bugs de désynchronisation. Code conservé tel quel (juste
        // désactivé via ce flag) au cas où il faille le réactiver plus tard : mettre autoSaveEnabled à
        // true, ou appeler setAutoSave(true).
        this.autoSaveEnabled = false;
        this.autoSaveInterval = 120000; // 120 secondes
        this.autoSaveTimer = null;
        this.lastSavedState = null;
        // Dernier calepinage connu en base, forme canonique (cf. modificationsNonEnregistrees) :
        // { projetId, etat } ; etat '' = aucun calepinage en base.
        this.reference = null;

        // Récupérer l'ID du projet depuis le localStorage ou les paramètres
        this.initProjetId();

        // Démarrer la sauvegarde automatique si un projet est sélectionné (no-op tant que
        // autoSaveEnabled est à false, cf. startAutoSave()).
        if (this.currentProjetId) {
            this.startAutoSave();
        }
    }

    /**
     * Initialise l'ID du projet courant
     */
    initProjetId() {
        // 1. Essayer d'extraire l'ID du projet depuis l'URL de la page (ex: /projet/123)
        const urlParts = window.location.pathname.split('/');
        const projetIdx = urlParts.indexOf('projet');
        if (projetIdx !== -1 && urlParts[projetIdx + 1]) {
            const idFromUrl = parseInt(urlParts[projetIdx + 1]);
            if (!isNaN(idFromUrl)) {
                this.currentProjetId = idFromUrl;
                localStorage.setItem('current_projet_id', idFromUrl);
                console.log(`🔌 [CalepinageDataService] ID du projet extrait de l'URL: ${idFromUrl}`);
                return;
            }
        }

        // Vérifier si un ID de projet est stocké dans le localStorage
        const storedProjetId = localStorage.getItem('current_projet_id');
        if (storedProjetId) {
            this.currentProjetId = parseInt(storedProjetId);
        }
    }

    /**
     * Récupère l'ID du projet en cours
     * @returns {string|number|null} ID du projet ou null
     */
    getCurrentProjetId() {
        return this.currentProjetId || localStorage.getItem('current_projet_id');
    }

    /**
     * Définit le projet courant
     * @param {string|number} projetId 
     */
    setCurrentProjet(projetId) {
        this.currentProjetId = projetId;
        localStorage.setItem('current_projet_id', projetId);

        // Obligation de projet actif (cf. app/middleware/auth_middleware.py:active_project_required) :
        // synchronise la session serveur avec ce projet, faute de quoi l'accès aux autres pages
        // (Système, Export, Géométrie, Autoconsommation, Étude économique) resterait bloqué même après
        // sélection côté client. Best-effort (non bloquant) : la création d'un projet définit déjà la
        // session côté serveur (cf. creer_parametre_projet), ce point ne fait qu'aligner les projets
        // déjà existants sélectionnés depuis "Mes projets".
        this.activateOnServer(projetId);

        // Redémarrer la sauvegarde automatique
        this.stopAutoSave();
        this.startAutoSave();
    }

    /**
     * Synchronise le projet actif avec la session serveur (cf. setCurrentProjet ci-dessus).
     * @param {string|number} projectId
     */
    async activateOnServer(projectId) {
        if (!projectId) return { success: false, message: "ID de projet manquant" };
        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}/activer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            return await response.json();
        } catch (error) {
            console.error("Erreur d'activation de session projet:", error);
            return { success: false, message: error.message };
        }
    }

    /** Payload envoyé en base pour le cache local actuel (sans la scène d'ombrage, dérivée). */
    _payloadLocal(localDataRaw) {
        const payload = JSON.parse(localDataRaw);
        delete payload.shadingScene;
        return {
            ...payload,
            geometriePlansData: JSON.parse(localStorage.getItem('geometriePlansData') || '{}')
        };
    }

    _noterReference(projectId, fullPayload) {
        this.reference = { projetId: String(projectId), etat: fullPayload ? signatureComparaison(fullPayload) : '' };
    }

    /**
     * Le calepinage local diffère-t-il du dernier connu en base ? (sauvegarde complète,
     * services/sauvegarde_projet.js)
     * @returns {boolean|null} null : dernier enregistrement inconnu (cf. chargerReference).
     */
    modificationsNonEnregistrees() {
        const projectId = this.getCurrentProjetId();
        if (!projectId) return false;
        const localDataRaw = localStorage.getItem(this.storageKey);
        if (!localDataRaw) return false;
        // Cache d'un autre projet : jamais envoyé (cf. garde-fou de _saveToDatabase).
        const owner = localStorage.getItem(this.ownerKey);
        if (owner && String(owner) !== String(projectId)) return false;
        if (!this.reference || this.reference.projetId !== String(projectId)) return null;
        // Calcul coûteux sur un gros calepinage : refait seulement si le cache local ou la
        // référence ont changé depuis le dernier appel (point orange recalculé régulièrement).
        const geometrieRaw = localStorage.getItem('geometriePlansData') || '';
        const memo = this._memoEcart;
        if (memo && memo.raw === localDataRaw && memo.geometrie === geometrieRaw && memo.reference === this.reference) {
            return memo.resultat;
        }
        try {
            const resultat = signatureComparaison(this._payloadLocal(localDataRaw)) !== this.reference.etat;
            this._memoEcart = { raw: localDataRaw, geometrie: geometrieRaw, reference: this.reference, resultat };
            return resultat;
        } catch (e) {
            return null;
        }
    }

    /**
     * Diagnostic (console) : clés de premier niveau du calepinage local qui diffèrent du dernier
     * état connu en base. Ex. : calepinageService.ecartsNonEnregistres()
     * @returns {string[]|null} null : dernier enregistrement inconnu ou cache illisible.
     */
    ecartsNonEnregistres(details = false) {
        const localDataRaw = localStorage.getItem(this.storageKey);
        if (!localDataRaw || !this.reference || !this.reference.etat) return null;
        try {
            const local = JSON.parse(signatureComparaison(this._payloadLocal(localDataRaw)));
            const base = JSON.parse(this.reference.etat);
            if (!details) {
                const cles = new Set([...Object.keys(local), ...Object.keys(base)]);
                return [...cles].filter((k) => JSON.stringify(local[k]) !== JSON.stringify(base[k]));
            }
            // details : chemins complets des 30 premières différences, avec les deux valeurs.
            const ecarts = [];
            const parcourir = (a, b, chemin) => {
                if (ecarts.length >= 30 || JSON.stringify(a) === JSON.stringify(b)) return;
                const objets = a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b);
                if (!objets) {
                    ecarts.push({ chemin, local: a, base: b });
                    return;
                }
                new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => parcourir(a[k], b[k], `${chemin}.${k}`));
            };
            parcourir(local, base, 'calepinage');
            return ecarts;
        } catch (e) {
            return null;
        }
    }

    /** Lit en base le dernier calepinage enregistré, sans toucher au cache local. */
    async chargerReference() {
        const projectId = this.getCurrentProjetId();
        if (!projectId) return;
        const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}/calepinage/load`);
        const result = await response.json();
        if (String(this.getCurrentProjetId()) !== String(projectId)) return;
        if (result && result.success && result.calepinage_data && typeof result.calepinage_data === 'object') {
            const data = { ...result.calepinage_data };
            delete data.shadingScene;
            this._noterReference(projectId, { ...data, geometriePlansData: result.geometrie_plans_data || {} });
        } else if (result && (result.success || response.status === 404)) {
            this._noterReference(projectId, null);
        }
    }

    /**
     * Sauvegarde les données du localStorage vers la base de données
     * @param {{explicitShapeDeletion?: boolean}} [options] - explicitShapeDeletion: à passer UNIQUEMENT
     *   par une action de suppression de forme délibérée (cf. DrawingControl.js::deleteSelectedShape).
     *   Envoyé au serveur pour ce seul appel (jamais écrit dans solarProjectData/localStorage), il
     *   autorise le backend à accepter un calepinage devenu vide (dernière forme supprimée) sans quoi
     *   son garde-fou anti-perte-de-données ignorerait silencieusement cette suppression légitime
     *   (cf. concevoir_mon_projet.py::save_calepinage_data).
     * @returns {Promise<{success: boolean, message: string}>}
     */
    saveToDatabase(options = {}) {
        // Sauvegarde en cours exposée (sauvegardeEnCours) : la mise à jour de la puissance projet
        // (puissance_projet_sync.js) l'attend au lieu d'envoyer une seconde sauvegarde concurrente.
        const promesse = this._saveToDatabase(options);
        this.sauvegardeEnCours = promesse;
        promesse.finally(() => { if (this.sauvegardeEnCours === promesse) this.sauvegardeEnCours = null; });
        return promesse;
    }

    async _saveToDatabase(options = {}) {
        // Projet changé dans un autre onglet (cf. garde_projet_actif.js) : rien n'est enregistré.
        if (typeof window.projetActifVerrouille === 'function' && window.projetActifVerrouille()) {
            return { success: false, bloque: true, message: "Projet changé dans un autre onglet : rechargez la page" };
        }
        const projectId = this.getCurrentProjetId();
        if (!projectId) {
            return { success: false, message: "Aucun projet sélectionné" };
        }

        const localDataRaw = localStorage.getItem(this.storageKey);
        if (!localDataRaw) {
            // Rien à sauvegarder n'est pas un échec (projet fait uniquement avec le calepinage
            // multi-typologie) : sans `skipped`, la puissance projet n'était jamais figée après la
            // sauvegarde de ce dernier (cf. puissance_projet_sync.js, sauvegarde automatique).
            return { success: true, skipped: true, message: "Aucune donnée locale à sauvegarder" };
        }

        // GARDE-FOU CROISÉ (cf. commentaire du constructeur) : si solarProjectData a été rempli pour
        // un AUTRE projet que celui actuellement ciblé (désynchronisation entre current_projet_id et
        // le contenu réel de solarProjectData, quelle qu'en soit la cause), on refuse d'écrire ce
        // calepinage sous l'identité du projet ciblé plutôt que de risquer une corruption croisée.
        const owner = localStorage.getItem(this.ownerKey);
        if (owner && String(owner) !== String(projectId)) {
            console.error(`🚨 [CalepinageDataService] Incohérence détectée : solarProjectData appartient au projet ${owner}, mais la sauvegarde était ciblée sur le projet ${projectId}. Sauvegarde bloquée pour éviter une corruption croisée entre projets.`);
            return { success: false, message: `Incohérence de projet actif détectée (données du projet ${owner} vs cible ${projectId})`, blocked: true };
        }

        try {
            // Scène d'ombrage proche : donnée DÉRIVÉE du calepinage (reconstruite à chaque écriture des
            // champs PV, cf. calepinage_maison_ombrage_scene.js), propre au navigateur et au projet
            // actif — jamais enregistrée en base (volume inutile, risque de réintroduire une scène
            // périmée au rechargement d'un projet). Retirée par _payloadLocal.
            const fullPayload = this._payloadLocal(localDataRaw);
            const currentStateStr = JSON.stringify(fullPayload);

            // Un calepinage devenu vide via suppression explicite doit toujours être envoyé (et
            // persisté), même si son contenu est par ailleurs identique à un état déjà "vide" mémorisé —
            // ne pas court-circuiter cet appel sur la simple comparaison de contenu.
            if (!options.explicitShapeDeletion && this.lastSavedState === currentStateStr) {
                console.log("💾 [CalepinageDataService] Pas de modification détectée. Sauvegarde réseau ignorée.");
                this._noterReference(projectId, fullPayload);
                return { success: true, message: "Données identiques, sauvegarde ignorée", omitted: true };
            }

            // Le marqueur ne part que sur le réseau (fullPayload), jamais dans currentStateStr utilisé
            // pour comparer/mémoriser l'état local — il ne doit donc être ajouté qu'après ce calcul.
            const networkPayload = options.explicitShapeDeletion
                ? { ...fullPayload, explicitShapeDeletion: true }
                : fullPayload;
            const networkBody = JSON.stringify(networkPayload);

            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projectId}/calepinage/save`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: networkBody
            });

            if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
            }

            const result = await response.json();

            if (result.success) {
                this.lastSavedState = currentStateStr;
                this._noterReference(projectId, fullPayload);
                // Confirme/pose le marqueur d'appartenance (cf. garde-fou plus haut) : couvre le cas où
                // solarProjectData aurait été rempli par un autre chemin que loadFromDatabase() sans
                // jamais poser ce marqueur (ex: tout premier calepinage d'un projet neuf).
                localStorage.setItem(this.ownerKey, String(projectId));
                console.log('✅ Données de calepinage sauvegardées en base de données');
                // Émettre un événement pour notifier la sauvegarde
                document.dispatchEvent(new CustomEvent('calepinage-saved', {
                    detail: { projetId: projectId }
                }));
            }

            return result;
        } catch (error) {
            console.error("Erreur lors de la sauvegarde du calepinage en base de données:", error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Charge les données depuis la base de données vers le localStorage
     */
    async loadFromDatabase(projetId) {
        try {
            // CORRECTIF (bug majeur "perte de données lors du changement de projet actif") : cette
            // méthode écrasait immédiatement localStorage.solarProjectData — l'état du projet
            // ACTUELLEMENT actif, potentiellement pas encore persisté en base (calepinage dessiné,
            // calculs effectués mais pas de sauvegarde explicite depuis) — par les données du NOUVEAU
            // projet demandé. Le bouton "Charger" de MesProjetsModal.js appelait loadFromDatabase()
            // directement, sans jamais sauvegarder l'ancien projet au préalable (contrairement à
            // parametreProjetFormManager.js, qui appelait sa propre sauvegarde manuellement avant) —
            // cette incohérence entre les deux points d'entrée pouvait faire disparaître silencieusement
            // tout le calepinage/calculs du projet quitté. En centralisant la sauvegarde ICI, TOUT
            // appelant de loadFromDatabase() en bénéficie désormais automatiquement, quel que soit le
            // point d'entrée UI (bouton "Charger", case à cocher "Actif", etc.).
            const previousProjetId = this.getCurrentProjetId();
            if (previousProjetId && String(previousProjetId) !== String(projetId)) {
                console.log(`💾 Sauvegarde du projet ${previousProjetId} avant de charger le projet ${projetId}...`);
                try {
                    await this.saveToDatabase();
                } catch (err) {
                    console.warn('Sauvegarde du projet précédent avant changement impossible :', err);
                }
            }

            // IMPORTANT: Nettoyer seulement la page (formes visuelles), pas le localStorage encore
            console.log('🧹 Nettoyage des formes visuelles...');
            if (window.storageManager) {
                // Nettoyer seulement la page, pas le localStorage
                window.storageManager.dispatchEvent("clearData");
            }

            console.log(`📡 Chargement des données du projet ${projetId}...`);
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/calepinage/load`);
            const result = await response.json();
            console.log('📨 Réponse reçue:', result.success , 'donnees calepinage', result.calepinage_data);

            if (result.success && result.calepinage_data) {
                console.log('📦 Données reçues:', result.calepinage_data);

                // Stocker dans le localStorage (écrase les anciennes données). Une scène d'ombrage
                // enregistrée par une version précédente est retirée : elle sera reconstruite depuis le
                // calepinage de CE projet (cf. saveToDatabase).
                if (result.calepinage_data && typeof result.calepinage_data === 'object') delete result.calepinage_data.shadingScene;
                localStorage.setItem(this.storageKey, JSON.stringify(result.calepinage_data));
                console.log('✅ Données stockées dans localStorage');

                // Marquer solarProjectData comme appartenant désormais à CE projet (cf. garde-fou dans
                // saveToDatabase, constructeur) — ce marqueur ne doit être posé qu'ICI, au moment exact
                // où le contenu réel de solarProjectData correspond bien au projet chargé.
                localStorage.setItem(this.ownerKey, String(projetId));

                // Charger les informations du projet dans les formulaires HTML
                if (window.storageManager && typeof window.storageManager.loadProjectInfoToForm === 'function') {
                    console.log('📋 Chargement des informations du projet dans les formulaires...');
                    window.storageManager.loadProjectInfoToForm();
                } else {
                    console.warn('⚠️ StorageManager non disponible pour charger les formulaires');
                }

                // Charger les indices de révision dans la table HTML
                if (window.storageManager && typeof window.storageManager.loadIndicesRevisionToTable === 'function') {
                    console.log('📋 Chargement des indices de révision dans la table...');
                    window.storageManager.loadIndicesRevisionToTable();
                } else {
                    console.warn('⚠️ StorageManager non disponible pour charger les indices de révision');
                }

                // Restaurer les données géométriques dans le localStorage
                if (result.geometrie_plans_data) {
                    localStorage.setItem('geometriePlansData', JSON.stringify(result.geometrie_plans_data));
                    console.log('✅ Données géométriques restaurées dans le localStorage');
                } else {
                    localStorage.removeItem('geometriePlansData');
                }

                // RETIRÉ (a causé une régression : "le champ Productible n'est plus alimenté,
                // les calculs ne s'opèrent plus" — bloquant pour le résidentiel, qui n'a pas
                // d'autre source pour ce champ). sharedSolarProduction est une clé localStorage
                // GLOBALE écrite par main_autoconso.js, lue en PRIORITÉ 1 par
                // EtudesEconomiqueModal.js pour pré-remplir puissance/productible — la vider
                // systématiquement à chaque chargement de projet (avant que l'utilisateur ait eu
                // l'occasion de relancer un calcul d'autoconsommation pour CE projet) rendait le
                // champ vide en permanence, pas seulement lors d'un changement de projet. Un vrai
                // correctif de la fuite cross-projet sur cette clé nécessiterait de la
                // scoper par project_id à la fois en écriture (main_autoconso.js) et en lecture
                // (EtudesEconomiqueModal.js), pas juste la vider ici — laissé de côté pour l'instant
                // (la clé est déjà réinitialisée dans certains flux existants, cf.
                // ParametresProjet.js/parametreProjetFormManager.js) au profit de la restauration
                // du fonctionnement normal.

            // Mettre à jour l'état de référence sauvegardé
            const fullPayload = {
                ...result.calepinage_data,
                geometriePlansData: result.geometrie_plans_data || {}
            };
            this.lastSavedState = JSON.stringify(fullPayload);
            this._noterReference(projetId, fullPayload);

                // Définir comme projet courant
                this.setCurrentProjet(projetId);
                console.log(`✅ Projet ${projetId} défini comme projet courant`);

                // Émettre un événement pour notifier le chargement
                document.dispatchEvent(new CustomEvent('calepinage-loaded', {
                    detail: {
                        projetId: result.projet_id,
                        nomProjet: result.nom_projet,
                        data: result.calepinage_data
                    }
                }));

                return { success: true, data: result.calepinage_data };
            } else {
                console.warn('❌ Pas de données de calepinage pour ce projet');
                return result;
            }
        } catch (error) {
            console.error('❌ Erreur lors du chargement:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Liste tous les projets avec des données de calepinage
     */
    async listProjetsWithCalepinage() {
        try {
            const response = await fetch('/concevoir_mon_projet/parametres-projets/with-calepinage');
            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Erreur lors du chargement de la liste:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Démarre la sauvegarde automatique
     */
    startAutoSave() {
        if (!this.autoSaveEnabled || !this.currentProjetId) {
            return;
        }

        this.stopAutoSave(); // Arrêter le timer précédent

        this.autoSaveTimer = setInterval(() => {
            this.saveToDatabase();
        }, this.autoSaveInterval);

        console.log(`🔄 Sauvegarde automatique activée (toutes les ${this.autoSaveInterval / 1000}s)`);
    }

    /**
     * Arrête la sauvegarde automatique
     */
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
            console.log('⏸️ Sauvegarde automatique désactivée');
        }
    }

    /**
     * Active/désactive la sauvegarde automatique
     */
    setAutoSave(enabled) {
        this.autoSaveEnabled = enabled;
        if (enabled) {
            this.startAutoSave();
        } else {
            this.stopAutoSave();
        }
    }

    /**
     * Efface les données du projet courant
     */
    clearCurrentProjet() {
        this.currentProjetId = null;
        localStorage.removeItem('current_projet_id');
        this.stopAutoSave();
    }

    /**
     * Efface toutes les données de calepinage (localStorage + page)
     */
    async clearAllData() {
        try {
            // Effacer le localStorage
            localStorage.removeItem(this.storageKey);
            localStorage.removeItem('current_projet_id');

            // Déclencher l'événement de nettoyage pour effacer la page
            if (window.storageManager) {
                await window.storageManager.clearPageData();
            }

            console.log('✅ Données de calepinage effacées');

            // Émettre un événement pour notifier le nettoyage
            document.dispatchEvent(new CustomEvent('calepinage-cleared'));

            return { success: true };
        } catch (error) {
            console.error('Erreur lors du nettoyage des données:', error);
            return { success: false, message: error.message };
        }
    }
}

// Créer une instance globale
export const calepinageService = new CalepinageDataService();

// Exporter pour utilisation dans window
window.calepinageService = calepinageService;

// Sauvegarder avant de quitter la page
window.addEventListener('beforeunload', () => {
    if (calepinageService.currentProjetId) {
        calepinageService.saveToDatabase();
    }
});

// Intercepter automatiquement le clic sur le bouton "Calculer et visualiser" pour forcer la sauvegarde en base
document.addEventListener('click', async (event) => {
    const target = event.target;
    
    // Sécurité : ignorer les clics sur les boutons de calcul du module IRVE pour éviter les interférences
    if (target.closest('.btn-calculate-irve, [onclick*="calculateEnergie"], [onclick*="calculateBilanPuissance"], [id*="bilan-calculate-btn"]')) {
        return;
    }

    const btn = target.closest('#btn-calculer, .btn-calculer, #btn-calculer-visualiser, .btn-calculer-visualiser, #btn-open-results')
        || (target.closest('button, a') && (
            target.closest('button, a').textContent.includes('Calculer et visualiser') || 
            target.closest('button, a').textContent.includes('Calculer')
        ));
    
    if (btn) {
        console.log("💾 [CalepinageDataService] Bouton de calcul détecté, déclenchement de la sauvegarde en base de données...");
        try {
            await calepinageService.saveToDatabase();
        } catch (err) {
            console.error("❌ Erreur lors de la sauvegarde forcée avant calcul:", err);
        }
    }
});
