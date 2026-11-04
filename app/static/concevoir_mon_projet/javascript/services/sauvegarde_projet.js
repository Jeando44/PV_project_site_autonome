/**
 * Sauvegarde complète du projet ouvert (demande explicite 2026-10-17 : « la base de données, et non
 * le localStorage, doit alimenter l'application »).
 *
 * Point UNIQUE qui pousse en base toutes les données vivantes du projet actif, dans l'ordre :
 * Paramètres du projet, calepinage (PRO/grand projet), calepinage résidentiel (champs PV), Loi APER,
 * devis CAPEX/OPEX, étude économique. Utilisé par :
 *   - l'icône « Sauvegarder » de la palette (ButtonControl.js) : filet de sécurité, enregistre aussi
 *     la puissance projet (source 'sauvegarder') et la variante active (A-D) si elle existe ;
 *   - UIManager.syncAllProjectDataToDatabase (rapport, variantes) et
 *     DataManager.saveCurrentProjectBeforeSwitch (changement de projet) : mêmes sources, même ordre.
 *
 * Détection des données non enregistrées (modificationsNonEnregistrees) : chaque module dit s'il
 * porte des modifications pas encore parties en base. Utilisée par :
 *   - les liens du menu « Revenir à Socalts », « Paramètres », « Consommation d'énergie » (et le
 *     logo) : fenêtre « Annuler / Continuer sans enregistrer / Enregistrer et continuer », boutons
 *     sur une seule ligne ;
 *   - la fermeture / le rechargement de l'onglet : avertissement natif du navigateur. Pas
 *     d'avertissement pendant un changement de projet (current_projet_id a changé depuis le
 *     chargement de la page) ni quand l'onglet est verrouillé (garde_projet_actif.js).
 *
 * Gardes : rien sans projet actif, rien si le projet a changé dans un autre onglet, jamais deux
 * sauvegardes complètes en même temps.
 */
(function () {
    'use strict';
    if (window.SauvegardeProjet) return;

    // Projet de la page, relevé après les scripts de réconciliation du <head> (index.html).
    let projetAuChargement = localStorage.getItem('current_projet_id');
    document.addEventListener('DOMContentLoaded', () => { projetAuChargement = localStorage.getItem('current_projet_id'); });

    function projetActif() {
        return localStorage.getItem('current_projet_id');
    }

    const MESSAGE_VERROU = 'Cet onglet n\'enregistre plus rien (projet modifié ailleurs ou changé dans un autre onglet) : rechargez la page.';

    // Projet tout juste créé (ou autre projet modifié) mais pas encore ouvert dans cette page
    // (DataManager.projetQuitteEnregistre, parametreProjetFormManager.js) : les modules de la page
    // portent encore l'état du projet quitté, déjà enregistré. Rien ne doit partir vers le nouveau
    // projet avant son ouverture (demande 2026-11-04 : le formulaire reste affiché après la création).
    function projetPasEncoreCharge(projetId) {
        const dm = window.dataManager;
        return !!(dm && dm.projetQuitteEnregistre && projetId && String(dm.projetQuitteEnregistre) === String(projetId));
    }

    function verrouille() {
        return typeof window.projetActifVerrouille === 'function' && window.projetActifVerrouille();
    }

    function appeler(objet, methode) {
        try {
            return !!objet && typeof objet[methode] === 'function' ? objet[methode]() : undefined;
        } catch (err) {
            console.warn(`[SauvegardeProjet] ${methode} a échoué :`, err);
            return undefined;
        }
    }

    /**
     * Sources de données du projet, dans l'ordre d'enregistrement.
     * - nonEnregistre(lireBase) : true si des modifications ne sont pas encore en base (peut être
     *   une promesse si lireBase : référence du calepinage PRO lue en base au premier besoin).
     * - enregistrer() : promesse du résultat ({success:false, message} = échec).
     * Tout échec est bloquant (rapport, variante) : un PDF ne doit jamais décrire un état qui
     * n'est pas en base (décision 2026-10-17).
     */
    function sources(options) {
        const maison = window.CalepinageMaisonPersistenceDB;
        const pro = window.calepinageService;
        const dm = window.dataManager;
        const aper = window.calculateurAPERInstance;
        const chiffrage = window.ResidentielChiffrage && window.ResidentielChiffrage.DB;
        const eco = window.EtudesEconomiqueDB;
        return [
            {
                // Formulaire ouvert en modification sur le projet actif et modifié depuis : envoyé.
                // Jamais celui d'un autre projet, jamais un formulaire non modifié.
                libelle: 'Paramètres du projet',
                actif: options.parametres !== false && !!dm
                    && typeof dm.parametresNonEnregistres === 'function'
                    && typeof dm.syncParametreProjetSilently === 'function',
                nonEnregistre: () => appeler(dm, 'parametresNonEnregistres') === true,
                enregistrer: () => (dm.parametresNonEnregistres()
                    ? dm.syncParametreProjetSilently({ projetId: options.projetId })
                    : { success: true, skipped: true }),
            },
            {
                libelle: 'Calepinage',
                actif: !!pro && typeof pro.saveToDatabase === 'function',
                nonEnregistre: (lireBase) => {
                    const etat = appeler(pro, 'modificationsNonEnregistrees');
                    if (etat !== null || !lireBase || typeof pro.chargerReference !== 'function') return etat === true;
                    return pro.chargerReference()
                        .then(() => appeler(pro, 'modificationsNonEnregistrees') === true)
                        .catch(() => false);
                },
                enregistrer: () => pro.saveToDatabase(),
            },
            {
                libelle: 'Calepinage des champs PV',
                actif: !!maison && typeof maison.saveToDatabase === 'function',
                nonEnregistre: () => appeler(maison, 'modificationsNonEnregistreesConnues') === true,
                enregistrer: () => maison.saveToDatabase(),
            },
            {
                libelle: 'Loi APER',
                actif: !!aper && typeof aper.flush === 'function',
                nonEnregistre: () => appeler(aper, 'modificationsEnAttente') === true,
                enregistrer: () => aper.flush(),
            },
            {
                libelle: 'Devis (CAPEX / OPEX)',
                actif: !!chiffrage && typeof chiffrage.flush === 'function',
                nonEnregistre: () => appeler(chiffrage, 'enAttente') === true,
                enregistrer: () => chiffrage.flush(),
            },
            {
                libelle: 'Étude économique',
                actif: true,
                nonEnregistre: () => appeler(eco, 'enAttente') === true,
                enregistrer: () => enregistrerEtudeEconomique(eco, options.projetId),
            },
        ];
    }

    // Module de l'étude économique absent de la page : saisies du cache local envoyées seulement si
    // elles appartiennent à CE projet (economicStudyInputs.projetId), jamais celles d'un autre.
    async function enregistrerEtudeEconomique(eco, projetId) {
        if (eco && typeof eco.flush === 'function') return eco.flush();
        let saisies = null;
        try {
            saisies = JSON.parse(localStorage.getItem('solarProjectData') || '{}').economicStudyInputs || null;
        } catch (e) { /* cache illisible : rien à envoyer */ }
        if (!saisies || !projetId || String(saisies.projetId) !== String(projetId)) return { success: true, skipped: true };
        const r = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/etude-economique/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: saisies }),
        });
        return r.json().catch(() => ({ success: r.ok }));
    }

    /**
     * Libellés des données du projet actif pas encore enregistrées (vide : tout est en base).
     * Version synchrone : seulement les écarts déjà connus (fermeture de l'onglet).
     */
    function modificationsNonEnregistreesConnues() {
        if (!projetActif() || verrouille() || projetPasEncoreCharge(projetActif())) return [];
        return sources({}).filter((s) => s.actif && s.nonEnregistre(false) === true).map((s) => s.libelle);
    }

    /** Idem, en lisant au besoin la référence en base (liens du menu). */
    async function modificationsNonEnregistrees() {
        if (!projetActif() || verrouille() || projetPasEncoreCharge(projetActif())) return [];
        const actives = sources({}).filter((s) => s.actif);
        const etats = await Promise.all(actives.map((s) => Promise.resolve(s.nonEnregistre(true)).catch(() => false)));
        return actives.filter((s, i) => etats[i] === true).map((s) => s.libelle);
    }

    /**
     * Enregistre en base toutes les sources (sans puissance ni variante).
     * @param {{parametres?: boolean}} [options] - parametres:false : formulaire Paramètres non envoyé.
     * @returns {Promise<{ok: boolean, bloquant: boolean, echecs: Array<{libelle, message}>, message?: string}>}
     */
    async function enregistrerDonnees(options = {}) {
        if (verrouille()) {
            return { ok: false, bloquant: true, echecs: [], message: MESSAGE_VERROU };
        }
        const projetId = projetActif();
        if (!projetId) return { ok: false, bloquant: true, echecs: [], message: 'Aucun projet ouvert.' };
        if (projetPasEncoreCharge(projetId)) return { ok: true, bloquant: false, echecs: [], skipped: true };

        const echecs = [];
        for (const source of sources({ ...options, projetId })) {
            if (!source.actif) continue;
            let res;
            try {
                res = await source.enregistrer();
            } catch (err) {
                res = { success: false, message: (err && err.message) || String(err) };
            }
            if (res && res.success === false && !res.skipped) {
                console.warn(`[SauvegardeProjet] ${source.libelle} non enregistré :`, res.message || res);
                echecs.push({ libelle: source.libelle, message: res.message || '' });
            }
            // Onglet verrouillé en cours de route (version périmée, autre onglet) : on s'arrête.
            if (verrouille()) break;
        }
        const message = echecs.length
            ? `Enregistrement impossible : ${echecs.map((e) => e.libelle + (e.message ? ` (${e.message})` : '')).join(' ; ')}.`
            : undefined;
        return { ok: echecs.length === 0, bloquant: echecs.length > 0, echecs, message };
    }

    const baseProjet = (projetId) => `/concevoir_mon_projet/parametre-projet/${encodeURIComponent(projetId)}`;

    async function lireVariantes(projetId) {
        return (await fetch(`${baseProjet(projetId)}/revisions`)).json();
    }

    /**
     * Enregistre l'état en base dans une variante.
     * Sans `choix` : met à jour la variante ouverte (A-D) ; aucune variante : rien n'est créé.
     * Avec `choix` ({action, indice, libelle}, fenêtre de l'icône « Sauvegarder ») : variante choisie.
     */
    async function enregistrerVarianteActive(projetId, choix) {
        const base = baseProjet(projetId);
        if (!choix) {
            const etat = await lireVariantes(projetId);
            if (!etat || !etat.success) return { success: false, message: (etat && etat.message) || 'Variantes illisibles.' };
            if (!etat.active_indice) return { success: true, skipped: true };
        }
        if (String(projetActif()) !== String(projetId)) return { success: false, message: 'Projet changé pendant l\'enregistrement.' };
        const corps = { action: (choix && choix.action) || 'enregistrer' };
        if (choix && choix.action === 'ecraser') corps.indice = choix.indice;
        if (choix && typeof choix.libelle === 'string') corps.libelle = choix.libelle;
        const res = await (await fetch(`${base}/revision/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(corps),
        })).json();
        if (res && res.success) {
            document.dispatchEvent(new CustomEvent('varianteActiveChangee', {
                detail: { projetId: String(projetId), indice: res.active_indice },
            }));
        }
        return res || { success: false };
    }

    let sauvegardeEnCours = null;
    let dernierClicIcone = 0;
    document.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('#save-projet-button')) dernierClicIcone = Date.now();
    }, true);

    /**
     * Sauvegarde complète du projet ouvert : données, puissance projet, variante active.
     * @param {{silencieux?: boolean, choisirVariante?: boolean}} [options] - silencieux : pas de message
     *   de réussite ; choisirVariante (clic sur l'icône « Sauvegarder ») : si le projet a déjà une
     *   variante, fenêtre de choix (mettre à jour l'ouverte, en écraser une autre, en créer une) AVANT
     *   tout enregistrement — annuler n'enregistre rien. Les autres appels (fenêtre « Modifications non
     *   enregistrées »…) mettent toujours à jour la variante ouverte, sans question.
     * @returns {Promise<{ok: boolean, message?: string, indice?: string}>}
     */
    function sauvegarderProjet(options = {}) {
        if (sauvegardeEnCours) return sauvegardeEnCours;
        // Clic sur l'icône juste avant (ButtonControl.js pouvant rester en cache sans l'option).
        if (!options.silencieux && Date.now() - dernierClicIcone < 1500) options = { ...options, choisirVariante: true };
        sauvegardeEnCours = executerSauvegarde(options).finally(() => { sauvegardeEnCours = null; });
        return sauvegardeEnCours;
    }

    async function executerSauvegarde(options) {
        const projetId = projetActif();
        if (verrouille()) {
            notifier(MESSAGE_VERROU, true);
            return { ok: false };
        }
        if (!projetId) {
            notifier('Aucun projet ouvert : rien à enregistrer.', true);
            return { ok: false };
        }

        let choixVariante = null;
        const ui = window.uiManagerInstance;
        if (options.choisirVariante && ui && typeof ui.choisirVarianteSauvegarde === 'function') {
            let etat = null;
            try { etat = await lireVariantes(projetId); } catch (err) { console.warn('[SauvegardeProjet] variantes :', err); }
            if (!etat || !etat.success) {
                notifier(`Projet non enregistré : ${(etat && etat.message) || 'variantes du projet illisibles (connexion interrompue ?)'}.`, true);
                return { ok: false };
            }
            const choix = await ui.choisirVarianteSauvegarde(etat);
            if (!choix) {
                notifier('Enregistrement annulé : rien n\'a été modifié.', false);
                return { ok: false, annule: true };
            }
            if (!choix.aucune) choixVariante = choix;
        }
        notifier('Enregistrement du projet…', false, true);

        // Formulaires de la page recopiés dans le cache local avant l'envoi (comportement historique
        // du bouton : sans cela, la dernière saisie du formulaire de champ PV pouvait manquer).
        if (window.storageManager && typeof window.storageManager.savePageData === 'function') {
            try { await window.storageManager.savePageData(); } catch (err) { console.warn('[SauvegardeProjet] savePageData :', err); }
        }

        const donnees = await enregistrerDonnees();
        if (!donnees.ok) {
            notifier(`Projet non enregistré entièrement. ${donnees.message || ''}`, true);
            return { ok: false, message: donnees.message };
        }
        if (String(projetActif()) !== String(projetId)) return { ok: false, message: 'Projet changé pendant l\'enregistrement.' };

        // Puissance projet de « Mes projets » (recalculée depuis le calepinage enregistré).
        if (typeof window.synchroniserPuissanceProjet === 'function') {
            try { await window.synchroniserPuissanceProjet('sauvegarder'); } catch (err) { console.warn('[SauvegardeProjet] puissance projet :', err); }
        }

        let indice = null;
        try {
            const variante = await enregistrerVarianteActive(projetId, choixVariante);
            if (variante && variante.success === false) {
                notifier(`Données enregistrées, mais la variante n'a pas été mise à jour : ${variante.message || 'erreur'}.`, true);
                return { ok: false, message: variante.message };
            }
            indice = variante && variante.active_indice;
        } catch (err) {
            console.warn('[SauvegardeProjet] variante active :', err);
            notifier('Données enregistrées, mais la variante n\'a pas été mise à jour (connexion interrompue ?).', true);
            return { ok: false };
        }

        const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        if (!options.silencieux) notifier(`Projet enregistré${indice ? ` (variante ${indice})` : ''} à ${heure}`, false);
        else masquerNotification();
        document.dispatchEvent(new CustomEvent('projetSauvegarde', { detail: { projetId: String(projetId), indice } }));
        return { ok: true, indice };
    }

    // ------------------------------------------------------------------------------------------
    // Messages
    // ------------------------------------------------------------------------------------------
    function notifier(texte, erreur, persistant) {
        let el = document.getElementById('sauvegarde-projet-notif');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sauvegarde-projet-notif';
            el.setAttribute('role', 'status');
            el.style.cssText = 'position:fixed; left:50%; bottom:24px; transform:translateX(-50%); z-index:100001; max-width:min(560px, calc(100vw - 32px)); padding:10px 16px; border-radius:8px; font:600 13px Arial, sans-serif; box-shadow:0 4px 14px rgba(0,0,0,0.25); pointer-events:none; transition:opacity 0.3s;';
            (document.body || document.documentElement).appendChild(el);
        }
        el.textContent = texte;
        el.style.background = erreur ? '#fee2e2' : '#dcfce7';
        el.style.color = erreur ? '#991b1b' : '#166534';
        el.style.opacity = '1';
        clearTimeout(el._masquage);
        if (!persistant) el._masquage = setTimeout(() => { el.style.opacity = '0'; }, erreur ? 9000 : 3500);
    }

    function masquerNotification() {
        const el = document.getElementById('sauvegarde-projet-notif');
        if (el) el.style.opacity = '0';
    }

    /**
     * Fenêtre « Modifications non enregistrées ».
     * @returns {Promise<'enregistrer'|'continuer'|'annuler'>}
     */
    function demanderChoix(libelles, destination) {
        return new Promise((resolve) => {
            const precedente = document.getElementById('sauvegarde-projet-fenetre');
            if (precedente) precedente.remove();
            const overlay = document.createElement('div');
            overlay.id = 'sauvegarde-projet-fenetre';
            overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.55); z-index:100000; display:flex; align-items:center; justify-content:center; padding:16px;';
            const boite = document.createElement('div');
            boite.setAttribute('role', 'dialog');
            boite.setAttribute('aria-modal', 'true');
            boite.setAttribute('aria-labelledby', 'sauvegarde-projet-titre');
            boite.style.cssText = 'background:#fff; width:100%; max-width:540px; padding:22px 24px; border-radius:10px; box-shadow:0 20px 50px rgba(0,0,0,0.3); font-family:Arial, sans-serif; color:#1f2937;';

            const titre = document.createElement('h3');
            titre.id = 'sauvegarde-projet-titre';
            titre.style.cssText = 'margin:0 0 10px; font-size:17px; color:#b45309;';
            titre.textContent = 'Modifications non enregistrées';
            const texte = document.createElement('p');
            texte.style.cssText = 'margin:0 0 8px; font-size:14px; line-height:1.5;';
            const nom = localStorage.getItem('current_projet_nom');
            texte.textContent = `Certaines données du projet${nom ? ` « ${nom} »` : ''} ne sont pas encore enregistrées. `
                + `Enregistrez-les avant ${destination} pour retrouver le projet tel que vous l'avez laissé.`;
            const liste = document.createElement('ul');
            liste.style.cssText = 'margin:0 0 12px 18px; padding:0; font-size:13px; color:#374151;';
            libelles.forEach((l) => {
                const li = document.createElement('li');
                li.textContent = l;
                liste.appendChild(li);
            });
            const erreur = document.createElement('p');
            erreur.style.cssText = 'display:none; margin:0 0 12px; padding:8px 10px; font-size:13px; color:#991b1b; background:#fee2e2; border-radius:6px;';

            const actions = document.createElement('div');
            // Trois boutons sur une seule ligne (fenêtre élargie à 540 px) ; repli sur deux lignes
            // seulement sur un écran étroit.
            actions.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; align-items:center;';
            const bouton = (libelle, style) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = libelle;
                b.style.cssText = `border-radius:6px; padding:9px 14px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; ${style}`;
                return b;
            };
            const annuler = bouton('Annuler', 'background:#fff; color:#374151; border:1px solid #d1d5db;');
            const continuer = bouton('Continuer sans enregistrer', 'background:#fff; color:#b91c1c; border:1px solid #fca5a5;');
            const enregistrer = bouton('Enregistrer et continuer', 'background:#16a34a; color:#fff; border:1px solid #16a34a;');
            actions.append(annuler, continuer, enregistrer);
            boite.append(titre, texte, liste, erreur, actions);
            overlay.appendChild(boite);
            (document.body || document.documentElement).appendChild(overlay);
            enregistrer.focus();

            const fermer = (choix) => {
                document.removeEventListener('keydown', clavier, true);
                overlay.remove();
                resolve(choix);
            };
            const clavier = (e) => { if (e.key === 'Escape') { e.preventDefault(); fermer('annuler'); } };
            document.addEventListener('keydown', clavier, true);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) fermer('annuler'); });
            annuler.addEventListener('click', () => fermer('annuler'));
            continuer.addEventListener('click', () => fermer('continuer'));
            enregistrer.addEventListener('click', async () => {
                [annuler, continuer, enregistrer].forEach((b) => { b.disabled = true; });
                enregistrer.textContent = 'Enregistrement…';
                const res = await sauvegarderProjet({ silencieux: true });
                if (res && res.ok) { fermer('enregistrer'); return; }
                // Échec : l'utilisateur décide (rien n'est perdu tant qu'il reste sur la page).
                erreur.textContent = `L'enregistrement a échoué${res && res.message ? ` : ${res.message}` : '.'} Vous pouvez réessayer ou continuer sans enregistrer.`;
                erreur.style.display = 'block';
                [annuler, continuer, enregistrer].forEach((b) => { b.disabled = false; });
                enregistrer.textContent = 'Réessayer';
            });
        });
    }

    // ------------------------------------------------------------------------------------------
    // Liens du menu qui quittent le projet ou ouvrent une étape relue depuis la base.
    // Capture sur document : la fenêtre s'intercale AVANT les gestionnaires du lien (onclick inline,
    // écouteurs de #open-modal...). Le clic est ensuite rejoué avec `contournement`.
    // ------------------------------------------------------------------------------------------
    const LIENS_SURVEILLES = [
        { selecteur: 'a[href*="solakvan.com/socalts"], a[aria-label="Accueil Socalts"]', destination: 'de quitter l\'application', sortie: true },
        { selecteur: '#open-modal, a[onclick*="open-modal"]', destination: 'd\'ouvrir Mes projets' },
        { selecteur: 'a[data-nav-step="parametres"]', destination: 'd\'ouvrir les paramètres du projet' },
        { selecteur: 'a[data-nav-step="cons-energie"], #bd-materiels-link', destination: 'd\'ouvrir la consommation d\'énergie' },
    ];
    let contournement = false;
    let sortieAutorisee = false;

    document.addEventListener('click', async (event) => {
        if (contournement || !event.isTrusted || !event.target || !event.target.closest) return;
        let lien = null;
        let regle = null;
        for (const r of LIENS_SURVEILLES) {
            lien = event.target.closest(r.selecteur);
            if (lien) { regle = r; break; }
        }
        if (!lien) return;
        // Ouverture dans un nouvel onglet : la page actuelle reste ouverte, rien à protéger.
        if (regle.sortie && (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0)) return;
        if (!projetActif() || verrouille()) return;

        // Clic retenu le temps de la vérification (référence du calepinage lue en base au besoin),
        // puis rejoué tel quel si tout est déjà enregistré.
        event.preventDefault();
        event.stopImmediatePropagation();
        const libelles = await modificationsNonEnregistrees();
        const choix = libelles.length ? await demanderChoix(libelles, regle.destination) : 'continuer';
        if (choix === 'annuler') return;

        if (regle.sortie) {
            sortieAutorisee = true;
            window.location.href = lien.href;
            return;
        }
        contournement = true;
        try {
            lien.click();
        } finally {
            contournement = false;
        }
    }, true);

    // Fermeture / rechargement de l'onglet avec des données non enregistrées : avertissement natif.
    window.addEventListener('beforeunload', (event) => {
        if (sortieAutorisee || verrouille()) return;
        // Changement / création / suppression de projet en cours : ces parcours enregistrent l'ancien
        // projet avant de basculer current_projet_id puis rechargent la page.
        if (projetActif() !== projetAuChargement) return;
        if (!modificationsNonEnregistreesConnues().length) return;
        event.preventDefault();
        event.returnValue = '';
    });

    // ------------------------------------------------------------------------------------------
    // Point orange sur l'icône « Sauvegarder » tant qu'il reste des données non enregistrées ; point
    // vert une fois le projet enregistré depuis cette page (icône ou « Enregistrer et continuer »),
    // jusqu'à la prochaine modification. Recalculé après les gestes de l'utilisateur (au plus toutes
    // les 2 s), toutes les 15 s, et aussitôt après une sauvegarde complète réussie.
    // ------------------------------------------------------------------------------------------
    const ID_BOUTON = 'save-projet-button';
    const TITRE_BOUTON = 'Sauvegarder le projet';
    let dernierCalcul = 0;
    let minuterieIndicateur = null;
    let enregistreSurCettePage = false;

    function poserStyleIndicateur() {
        if (document.getElementById('sauvegarde-projet-style')) return;
        const style = document.createElement('style');
        style.id = 'sauvegarde-projet-style';
        style.textContent = `#${ID_BOUTON} { position: relative; }
#${ID_BOUTON}.skv-non-enregistre::after, #${ID_BOUTON}.skv-enregistre::after { content: ''; position: absolute; top: 3px; right: 3px; width: 9px; height: 9px; border-radius: 50%; background: #f97316; box-shadow: 0 0 0 2px #fff; pointer-events: none; }
#${ID_BOUTON}.skv-enregistre::after { background: #16a34a; }`;
        (document.head || document.documentElement).appendChild(style);
    }

    function majIndicateur() {
        minuterieIndicateur = null;
        const bouton = document.getElementById(ID_BOUTON);
        if (!bouton || document.hidden) return;
        dernierCalcul = Date.now();
        let libelles = [];
        try { libelles = modificationsNonEnregistreesConnues(); } catch (e) { /* module en cours de chargement */ }
        poserStyleIndicateur();
        bouton.classList.toggle('skv-non-enregistre', libelles.length > 0);
        bouton.classList.toggle('skv-enregistre', !libelles.length && enregistreSurCettePage);
        const titre = libelles.length ? `${TITRE_BOUTON} — non enregistré : ${libelles.join(', ')}`
            : (enregistreSurCettePage ? `${TITRE_BOUTON} — projet enregistré` : TITRE_BOUTON);
        if (bouton.title !== titre) {
            bouton.title = titre;
            bouton.setAttribute('aria-label', titre);
        }
    }

    function planifierIndicateur() {
        if (minuterieIndicateur) return;
        const attente = Math.max(800, 2000 - (Date.now() - dernierCalcul));
        minuterieIndicateur = setTimeout(majIndicateur, attente);
    }

    ['input', 'change', 'mouseup', 'keyup', 'touchend'].forEach((type) => {
        document.addEventListener(type, planifierIndicateur, { capture: true, passive: true });
    });
    ['calepinage-saved', 'varianteActiveChangee'].forEach((type) => {
        document.addEventListener(type, planifierIndicateur);
    });
    document.addEventListener('projetSauvegarde', () => {
        enregistreSurCettePage = true;
        majIndicateur();
    });
    setInterval(majIndicateur, 15000);

    window.SauvegardeProjet = {
        majIndicateur,
        sauvegarderProjet,
        enregistrerDonnees,
        modificationsNonEnregistrees,
        modificationsNonEnregistreesConnues,
        /** Prochaine sortie de page sans avertissement (navigation décidée par le code). */
        autoriserSortie: () => { sortieAutorisee = true; },
    };
})();
