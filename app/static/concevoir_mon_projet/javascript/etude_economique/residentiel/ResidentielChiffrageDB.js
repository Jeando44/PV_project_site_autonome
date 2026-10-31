/**
 * Synchronisation en base de données du chiffrage résidentiel (CAPEX + OPEX).
 *
 * Mirroir exact du pont EtudesEconomiqueDB.js (mêmes routes serveur, même debounce), mais pour
 * ResidentielChiffrageConfig.data = { capex: {postes, viewMode}, opex: {charges} } — un seul
 * blob combinant les deux tableaux (CapexTable + OpexTable), cohérent avec le modèle 1 ligne
 * JSON par projet.
 */
(function () {
    'use strict';

    window.ResidentielChiffrage = window.ResidentielChiffrage || {};

    function getCurrentProjetId() {
        if (window.calepinageService && typeof window.calepinageService.getCurrentProjetId === 'function') {
            const id = window.calepinageService.getCurrentProjetId();
            if (id) return id;
        }
        return localStorage.getItem('current_projet_id');
    }

    // Projet auquel appartiennent les tableaux affichés (null tant qu'ils ne sont pas chargés, ou
    // pendant un rechargement) : les sauvegardes ne partent que vers lui. Sans cela, après un
    // changement de projet sans rechargement de page (cf. selectAndLoadProject), les lignes de
    // l'ancien projet étaient écrites dans le nouveau.
    let projetCharge = null;
    // Tableaux montés (loadAndApply appelé au moins une fois, même sans projet à ce moment-là) et
    // chargement en cours : un projet ouvert APRÈS le montage (page arrivée sans projet, puis choix
    // dans « Mes projets » sans rechargement) laissait projetCharge à null pour toujours — sauvegardes
    // perdues et export bloqué sur « Aucun projet ouvert ».
    let tablesMontees = false;
    let chargement = null;
    let jetonChargement = 0;

    function isPro() {
        return window.ResidentielChiffrage.profil === 'pro';
    }

    function currentPayload() {
        const Capex = window.ResidentielChiffrage.Capex;
        const Opex = window.ResidentielChiffrage.Opex;
        const capex = Capex ? Capex.getData() : { postes: [], viewMode: 'synthetique' };
        const conv = (typeof window.getConversionDeviseState === 'function')
            ? window.getConversionDeviseState()
            : null;
        const devise = document.querySelector('input[name="devise"]:checked')?.value || '€';
        const tauxConversion = (conv && conv.active && conv.valid) ? conv.rate : 1;
        // PRO / Grand projet : l'OPEX reste celui du formulaire standard (EtudesEconomiqueDB.js).
        if (isPro()) return { capex, devise, tauxConversion, conversionDevise: conv };
        return { capex, opex: Opex ? Opex.getData() : {}, devise, tauxConversion, conversionDevise: conv };
    }

    /** Messages des champs invalides du devis (CAPEX, et charges OPEX hors PRO). */
    function invalides() {
        const Capex = window.ResidentielChiffrage.Capex;
        const Opex = window.ResidentielChiffrage.Opex;
        const Rules = window.ResidentielChiffrage.Rules;
        const erreurs = (Capex && typeof Capex.erreursValidation === 'function') ? Capex.erreursValidation() : [];
        if (Opex && Rules && !isPro()) {
            Object.entries(Opex.getData() || {}).forEach(([cle, valeur]) => {
                const r = Rules.validateOpexField(cle, valeur);
                if (!r.valid) erreurs.push(`Charges annuelles : ${r.message}`);
            });
        }
        return erreurs;
    }

    /**
     * @returns {Promise<{success:boolean, skipped?:boolean, message?:string}>} résultat de
     *   l'enregistrement (attendu par l'export du parcours Chiffrage ; ignoré par la sauvegarde
     *   différée).
     */
    async function pushToDatabase() {
        // Projet changé dans un autre onglet (garde_projet_actif.js) : plus rien n'est enregistré.
        if (typeof window.projetActifVerrouille === 'function' && window.projetActifVerrouille()) {
            return { success: false, bloque: true, message: 'Projet changé dans un autre onglet : rechargez la page.' };
        }
        // Chargement en cours (ouverture / changement de projet) : on l'attend. Tableaux jamais
        // rattachés alors qu'un projet est ouvert : rattachement maintenant (la base l'emporte si elle
        // contient un chiffrage ; sinon les tableaux affichés, qui ne peuvent pas appartenir à un autre
        // projet — cf. charger() — sont enregistrés pour ce projet).
        if (chargement) await chargement;
        if (!projetCharge && getCurrentProjetId()) await loadAndApply(getCurrentProjetId());
        const projetId = projetCharge;
        if (!projetId) return { success: false, message: 'Aucun projet ouvert.' };
        // Devis d'un projet, page passée sur un autre (changement en cours) : rien n'est écrit.
        const ouvert = localStorage.getItem('current_projet_id');
        if (ouvert && String(ouvert) !== projetId) {
            return { success: false, message: `Le devis affiché (projet ${projetId}) n'est pas celui du projet ouvert (${ouvert}) : rechargez la page.` };
        }

        // Validation stricte : rien n'est envoyé tant qu'un champ est invalide. Contrôle sur les
        // DONNÉES (Capex.erreursValidation, mêmes règles que le serveur), et non plus sur la classe
        // .is-invalid du DOM : celle-ci n'existe pas en vue synthétique et ne disait pas quel champ
        // bloquait (« Au moins un champ du devis est invalide » sur un modal jamais ouvert). Le
        // message nomme désormais le poste, la ligne et la plage attendue.
        const erreurs = invalides();
        if (erreurs.length) {
            console.warn('Sauvegarde du chiffrage résidentiel différée, champs invalides :', erreurs);
            const autres = erreurs.length > 1 ? ` (et ${erreurs.length - 1} autre${erreurs.length > 2 ? 's' : ''} champ${erreurs.length > 2 ? 's' : ''})` : '';
            return { success: false, message: `Champ invalide : ${erreurs[0].replace(/\.$/, '')}${autres}. Ouvrez l'étude économique pour le corriger.` };
        }

        return fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/residentiel-chiffrage/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: currentPayload() })
        }).then((r) => r.json()).then((result) => {
            if (!result || !result.success) {
                // Rejeté par la validation serveur (dernier filet de sécurité) : ne doit
                // normalement jamais arriver si la validation frontend est à jour, mais ne doit pas
                // non plus passer inaperçu silencieusement.
                console.warn('Sauvegarde du chiffrage résidentiel refusée par le serveur :', result && result.message);
                return { success: false, message: (result && result.message) || 'Enregistrement refusé.' };
            }
            return { success: true };
        }).catch((err) => {
            console.warn('Sauvegarde du chiffrage résidentiel en base impossible :', err);
            return { success: false, message: 'Enregistrement impossible (connexion interrompue ?).' };
        });
    }

    let dbSaveTimeout = null;
    // Dernier enregistrement différé refusé ou en échec : devis toujours à enregistrer (renvoyé par
    // flush, signalé par enAttente — cf. services/sauvegarde_projet.js).
    let echecEnregistrement = false;
    function envoyer() {
        return pushToDatabase().then((res) => {
            echecEnregistrement = !res || res.success === false;
            return res;
        });
    }
    function debouncedPush() {
        clearTimeout(dbSaveTimeout);
        dbSaveTimeout = setTimeout(() => { dbSaveTimeout = null; envoyer(); }, 800);
    }

    /**
     * Charge la config sauvegardée et l'applique aux deux tables déjà initialisées (avec leurs
     * valeurs par défaut) — à appeler juste après Capex.init()/Opex.init() par l'orchestrateur.
     */
    function loadAndApply(projetIdDemande, reinitialiser = false) {
        tablesMontees = true;
        const projetId = projetIdDemande || getCurrentProjetId();
        if (!projetId) return Promise.resolve();
        chargement = charger(projetId, reinitialiser, ++jetonChargement);
        return chargement;
    }

    async function charger(projetId, reinitialiser, jeton) {
        clearTimeout(dbSaveTimeout);
        projetCharge = null;
        echecEnregistrement = false;
        const Capex = window.ResidentielChiffrage.Capex;
        const Opex = window.ResidentielChiffrage.Opex;
        let lu = false;

        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/residentiel-chiffrage/load`);
            const result = await response.json();
            // Lecture refusée (projet d'un autre compte, supprimé) ou en échec : tableaux NON
            // rattachés, pour ne jamais écrire dans ce projet ce qu'il n'a pas fourni.
            if (!result || !result.success) throw new Error((result && result.message) || 'lecture refusée');
            const data = (result.config_exists && result.config && result.config.data) ? result.config.data : null;
            if (data || reinitialiser) {
                const convData = data && (data.conversionDevise || (data.capex && data.capex.conversionDevise));
                if (convData && typeof window.restaurerConversionDevise === 'function') {
                    window.restaurerConversionDevise(convData);
                } else if (data && data.devise) {
                    const radio = document.querySelector(`input[name="devise"][value="${data.devise}"]`);
                    if (radio) {
                        radio.checked = true;
                        if (typeof window.updateDeviseLabels === 'function') window.updateDeviseLabels(false);
                    }
                }
                // Projet sans chiffrage enregistré (changement de projet) : tableaux par défaut,
                // en vue détaillée comme un projet neuf (cf. Capex.init()).
                if (Capex) Capex.setData(data && data.capex ? data.capex : { viewMode: 'detaille' });
                if (Opex && !isPro()) Opex.setData(data && data.opex ? data.opex : null);
                if (data) console.log('✅ Chiffrage résidentiel restauré depuis la base de données');
            }
            lu = true;
        } catch (err) {
            console.warn('Chargement du chiffrage résidentiel depuis la base impossible :', err);
            // Changement de projet en échec : le devis de l'ANCIEN projet ne reste pas affiché (il
            // serait ensuite enregistré dans le nouveau) — tableaux remis aux valeurs par défaut.
            if (reinitialiser && jeton === jetonChargement) {
                if (Capex) Capex.setData({ viewMode: 'detaille' });
                if (Opex && !isPro()) Opex.setData(null);
            }
        } finally {
            // Re-rendu des tableaux ci-dessus : rien à renvoyer en base, c'est ce qui vient d'en sortir.
            clearTimeout(dbSaveTimeout);
            // Un chargement plus récent (changement de projet rapide) l'emporte. Rattachement
            // seulement après une lecture réussie (sinon : nouvel essai au prochain enregistrement).
            if (jeton === jetonChargement) {
                if (lu) projetCharge = String(projetId);
                chargement = null;
            }
        }
    }

    /** Sauvegarde immédiate des modifications en attente — avant un changement de projet / une variante. */
    async function flush() {
        if (!projetCharge || (!dbSaveTimeout && !echecEnregistrement)) return { success: true, skipped: true };
        clearTimeout(dbSaveTimeout);
        dbSaveTimeout = null;
        return envoyer();
    }

    /** Modification du devis en attente d'enregistrement (cf. services/sauvegarde_projet.js). */
    function enAttente() {
        return !!projetCharge && (!!dbSaveTimeout || echecEnregistrement);
    }

    /**
     * « Ouvrir le chiffrage initial » : remplace le devis affiché par celui figé en base pendant le
     * type d'étude Chiffrage (route chiffrage-initial), après confirmation, puis l'enregistre. La
     * quantité de panneaux reste celle du calepinage (Capex.setData -> syncPanneauxCalepinage).
     */
    async function importerChiffrageInitial() {
        if (chargement) await chargement;
        const projetId = projetCharge || getCurrentProjetId();
        if (!projetId) {
            alert('Aucun projet ouvert.');
            return;
        }
        let result;
        try {
            const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/residentiel-chiffrage/chiffrage-initial`);
            result = await response.json();
        } catch (err) {
            console.warn('Lecture du chiffrage initial impossible :', err);
            alert('Le chiffrage initial n\'a pas pu être lu (connexion interrompue ?).');
            return;
        }
        if (!result || !result.success) {
            alert((result && result.message) || 'Le chiffrage initial n\'a pas pu être lu.');
            return;
        }
        if (!result.disponible) {
            alert('Aucun chiffrage initial n\'est enregistré pour ce projet : il est conservé lorsque le devis est réalisé en type d\'étude « Chiffrage ».');
            return;
        }
        // Horodatage serveur en UTC sans fuseau (datetime.utcnow().isoformat()).
        const date = result.fige_le ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(result.fige_le) ? result.fige_le : result.fige_le + 'Z') : null;
        const mention = date && !isNaN(date) ? ` (enregistré le ${date.toLocaleString('fr-FR')})` : '';
        if (!window.confirm(`Remplacer le chiffrage affiché par le chiffrage initial${mention} ?\nLes quantités de panneaux restent celles du calepinage.`)) return;

        const Capex = window.ResidentielChiffrage.Capex;
        const Opex = window.ResidentielChiffrage.Opex;
        if (Capex) Capex.setData(result.capex);
        if (Opex && !isPro() && result.opex) Opex.setData(result.opex);
        clearTimeout(dbSaveTimeout);
        dbSaveTimeout = null;
        const enregistrement = await pushToDatabase();
        if (!enregistrement.success) {
            alert(`Chiffrage initial appliqué mais non enregistré : ${enregistrement.message || 'erreur inconnue'}`);
        }
    }

    function setupAutosave() {
        document.addEventListener('residentielCapexChanged', debouncedPush);
        document.addEventListener('residentielOpexChanged', debouncedPush);
    }

    // Changement de projet sans rechargement de page (parametreProjetFormManager.js) : tableaux du
    // nouveau projet. Seulement si les tableaux ont été montés (vue PRO ou résidentielle active),
    // y compris montés sans projet (page arrivée avant le choix du projet).
    window.addEventListener('projetActifCharge', (evt) => {
        const projetId = evt.detail && evt.detail.projetId;
        if (tablesMontees && projetId && String(projetId) !== projetCharge) loadAndApply(projetId, true);
    });

    window.ResidentielChiffrage.DB = {
        loadAndApply,
        setupAutosave,
        pushToDatabase,
        flush,
        enAttente,
        importerChiffrageInitial
    };
})();
