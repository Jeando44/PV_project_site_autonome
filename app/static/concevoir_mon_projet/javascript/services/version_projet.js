/**
 * Version des données du projet côté navigateur (demande explicite 2026-10-17), pendant de
 * app/services/version_projet.py. Chargé tout en haut de menu_list.html, avant tout autre script.
 *
 * 1. Verrou optimiste : chaque écriture fetch vers /parametre-projet/<id>/... porte l'identifiant de
 *    cet onglet (X-Skv-Onglet) et la dernière version des données qu'il a lui-même écrite ou reçue
 *    au chargement de la page (X-Skv-Version). Le serveur refuse (409) l'écriture d'un onglet resté
 *    sur un état périmé alors qu'un autre onglet ou poste a écrit depuis : l'onglet est alors
 *    verrouillé (garde_projet_actif.js) et invite à recharger. Les lectures (GET) ne font jamais
 *    avancer la version connue : seules les écritures de CET onglet le font.
 *    Écritures pendant la fermeture de la page (beforeunload / pagehide) : sans en-tête — ni
 *    contrôlées ni comptées, pour ne jamais provoquer de faux conflit au rechargement.
 *    Adresses suivies : /parametre-projet/<id>/..., et petit champ, dossiers de plans, dossier
 *    ombrières (mêmes familles que app/services/version_projet.py::_FAMILLES).
 *    Modales intégrées (iframes : consommation / IRVE / PAC, autoconsommation, paramètres du petit
 *    champ) : ce script y reprend l'identifiant et la version de l'onglet PARENT (window.parent
 *    .SkvVersionProjet.partage) — même onglet, donc jamais de faux conflit avec la page principale ;
 *    un conflit détecté depuis la modale verrouille la page principale. Ouverte seule (sans
 *    parent), la page se comporte comme un onglet à part entière.
 *
 * 2. Cohérence des caches locaux au chargement : `skv_version_base:<id>` = version des données en
 *    base que reflètent les caches du navigateur (posée au chargement et après chaque écriture de
 *    ce navigateur). Si elle diffère de la version rendue par le serveur, un autre poste a modifié
 *    le projet depuis : les caches locaux du projet sont écartés AVANT que les modules ne les lisent,
 *    et chaque module recharge la version enregistrée en base. Une copie des caches écartés est
 *    gardée 30 jours (IndexedDB) et peut être téléchargée depuis le bandeau d'information.
 *
 * 3. Caches locaux oubliés au changement de projet, à une nouvelle session de connexion ou à la
 *    réouverture de l'application (aucun autre onglet ouvert) : cf. oublierCachesProjet.
 */
(function () {
    'use strict';
    if (window.SkvVersionProjet) return;

    // Modale intégrée (iframe de la même origine) : même onglet que la page parente.
    let parent = null;
    try {
        if (window.parent && window.parent !== window && window.parent.SkvVersionProjet
            && window.parent.SkvVersionProjet.partage) parent = window.parent.SkvVersionProjet.partage;
    } catch (e) { /* parent d'une autre origine : onglet à part entière */ }

    const ONGLET = parent ? parent.onglet : ((window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
    const rendu = window.SKV_PROJET_RENDU || {};
    const idRendu = rendu.id != null ? String(rendu.id) : null;
    const versionRendue = Number.isInteger(rendu.version) ? rendu.version : null;
    // Version connue par CET onglet, par projet (jamais partagée entre onglets).
    const versions = new Map();
    if (idRendu && versionRendue !== null) versions.set(idRendu, versionRendue);

    const cleVersionBase = (id) => `skv_version_base:${id}`;
    // Onglets récents de CE navigateur : une dernière écriture faite par l'un d'eux (réponse perdue
    // au rechargement de la page) ne signifie pas « modifié ailleurs ».
    const CLE_ONGLETS = 'skv_onglets_recents';
    function ongletsRecents() {
        try { return JSON.parse(localStorage.getItem(CLE_ONGLETS) || '[]'); } catch (e) { return []; }
    }
    if (!parent) {
        try {
            localStorage.setItem(CLE_ONGLETS, JSON.stringify([ONGLET, ...ongletsRecents().filter((o) => o !== ONGLET)].slice(0, 30)));
        } catch (e) { /* stockage plein : sans conséquence */ }
    }
    const CHEMINS_PROJET = [
        /^(?:\/concevoir_mon_projet)?\/parametre-projet\/(\d+)(?:\/|$)/,
        /^(?:\/concevoir_mon_projet)?\/api\/petit_champ\/(\d+)\//,
        /^(?:\/concevoir_mon_projet)?\/api\/dossier_plans\/[^/]+\/(\d+)(?:\/|$)/,
        /^(?:\/concevoir_mon_projet)?\/api\/ombrieres\/dossier\/(\d+)(?:\/|$)/,
    ];
    const CONSERVATION_COPIE_MS = 30 * 24 * 3600 * 1000;

    function lire(cle) {
        try { return localStorage.getItem(cle); } catch (e) { return null; }
    }
    function ecrire(cle, valeur) {
        try { localStorage.setItem(cle, String(valeur)); } catch (e) { /* stockage plein : sans conséquence */ }
    }

    // ------------------------------------------------------------------------------------------
    // 2. Cohérence des caches locaux (avant tout autre script)
    // ------------------------------------------------------------------------------------------
    // Même liste que purgerCachesLocauxVariante (parametreProjetFormManager.js) : caches que les
    // modules rechargent depuis la base quand ils sont absents. Consommation (IndexedDB) commune,
    // gardée.
    function clesCachesProjet(id) {
        const cles = [
            'solarProjectData', 'solarProjectData_owner_id',
            'solar_sim_data', 'solar_storage_data', 'solar_sim_signature', 'solar_sim_pv_signature',
            'sharedSolarProduction', 'geometriePlansData',
            'calepinage_maison_v1', 'calepinage_maison_polygons_v1', 'calepinage_maison_owner_id',
            `skv_geometrie_structure_data:${id}`, `skv_irve_session_data_${id}`,
            'aperPolygonsData', 'solarProjectStable',
        ];
        try {
            Object.keys(localStorage).filter((k) => k.startsWith('skv_systeme_hybride_')).forEach((k) => cles.push(k));
        } catch (e) { /* idem */ }
        return cles;
    }

    function ecarterCachesProjet(id) {
        const copie = {};
        clesCachesProjet(id).forEach((cle) => {
            const valeur = lire(cle);
            if (valeur === null) return;
            copie[cle] = valeur;
            try { localStorage.removeItem(cle); } catch (e) { /* idem */ }
        });
        ['activeAutoconsoRate', 'seasonalAutoconsoShares'].forEach((cle) => {
            try { sessionStorage.removeItem(cle); } catch (e) { /* idem */ }
        });
        return copie;
    }

    function ouvrirBaseSecours() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('IndexedDB indisponible')); return; }
            const req = indexedDB.open('skv_secours_caches', 1);
            req.onupgradeneeded = () => { req.result.createObjectStore('copies', { keyPath: 'cle' }); };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function garderCopie(enregistrement) {
        try {
            const base = await ouvrirBaseSecours();
            const tx = base.transaction('copies', 'readwrite');
            const store = tx.objectStore('copies');
            store.put(enregistrement);
            // Copies de plus de 30 jours oubliées.
            const tout = store.getAll();
            tout.onsuccess = () => {
                (tout.result || []).forEach((c) => {
                    if (Date.now() - (c.date || 0) > CONSERVATION_COPIE_MS) store.delete(c.cle);
                });
            };
        } catch (err) {
            console.warn('[VersionProjet] Copie des caches écartés non conservée :', err);
        }
    }

    // ------------------------------------------------------------------------------------------
    // 3. Caches locaux oubliés quand l'utilisateur quitte son travail (demande 2026-10-18) :
    //    seule la dernière version enregistrée en base est conservée. Pas de copie de secours ici :
    //    ces caches ne doivent plus exister (contrairement au cas « modifié ailleurs » ci-dessous).
    //    - changement de projet : oublierCachesProjet(ancien id), appelé par les parcours d'ouverture ;
    //    - nouvelle session de connexion (déconnexion, session expirée ou fermée) : identifiant
    //      opaque rendu par le serveur (window.SKV_PROJET_RENDU.session) différent du dernier vu ;
    //    - onglet rouvert alors qu'aucun autre onglet de l'application n'est encore ouvert dans ce
    //      navigateur (sessionStorage vide = nouvel onglet ; onglets vivants signalés dans
    //      localStorage). Un rechargement ou une navigation dans le même onglet garde les caches.
    // ------------------------------------------------------------------------------------------
    function oublierCachesProjet(id) {
        const ids = new Set([id, lire('current_projet_id')].filter((v) => v != null && v !== '').map(String));
        const cles = new Set();
        (ids.size ? [...ids] : ['']).forEach((i) => clesCachesProjet(i).forEach((c) => cles.add(c)));
        cles.forEach((cle) => { try { localStorage.removeItem(cle); } catch (e) { /* idem */ } });
        ['activeAutoconsoRate', 'seasonalAutoconsoShares'].forEach((cle) => {
            try { sessionStorage.removeItem(cle); } catch (e) { /* idem */ }
        });
    }

    const CLE_SESSION_CACHES = 'skv_session_caches';
    const CLE_ONGLETS_VIVANTS = 'skv_onglets_vivants';
    const MARQUE_ONGLET = 'skv_onglet_ouvert';
    // Les minuteries d'un onglet en arrière-plan peuvent n'être servies qu'une fois par minute.
    const SIGNE_DE_VIE_MS = 20000;
    const ONGLET_VIVANT_MS = 3 * 60 * 1000;

    function ongletsVivants() {
        try { return JSON.parse(localStorage.getItem(CLE_ONGLETS_VIVANTS) || '{}') || {}; } catch (e) { return {}; }
    }
    function signalerOnglet(vivant) {
        const maintenant = Date.now();
        const tous = ongletsVivants();
        Object.keys(tous).forEach((o) => { if (maintenant - Number(tous[o]) > ONGLET_VIVANT_MS) delete tous[o]; });
        if (vivant) tous[ONGLET] = maintenant; else delete tous[ONGLET];
        ecrire(CLE_ONGLETS_VIVANTS, JSON.stringify(tous));
    }

    if (!parent) {
        (function oublierCachesSessionTerminee() {
            const maintenant = Date.now();
            let ongletDejaOuvert = false;
            try { ongletDejaOuvert = sessionStorage.getItem(MARQUE_ONGLET) === '1'; } catch (e) { ongletDejaOuvert = true; }
            const autreOngletOuvert = Object.entries(ongletsVivants())
                .some(([o, t]) => o !== ONGLET && maintenant - Number(t) <= ONGLET_VIVANT_MS);
            const sessionVue = lire(CLE_SESSION_CACHES);
            const nouvelleSession = !!rendu.session && sessionVue !== null && sessionVue !== String(rendu.session);
            if (nouvelleSession || (!ongletDejaOuvert && !autreOngletOuvert)) {
                oublierCachesProjet(idRendu);
                console.info(`[VersionProjet] ${nouvelleSession ? 'Nouvelle session' : 'Application rouverte'} : caches locaux des projets oubliés, la version enregistrée en base est rechargée.`);
            }
            if (rendu.session) ecrire(CLE_SESSION_CACHES, rendu.session);
            try { sessionStorage.setItem(MARQUE_ONGLET, '1'); } catch (e) { /* idem */ }
        })();
        signalerOnglet(true);
        setInterval(() => { if (!enDechargement) signalerOnglet(true); }, SIGNE_DE_VIE_MS);
        window.addEventListener('pagehide', () => signalerOnglet(false));
        window.addEventListener('pageshow', (e) => { if (e.persisted) signalerOnglet(true); });
    }

    let cachesEcartes = null;
    (function verifierCaches() {
        // Modale intégrée : la page parente a déjà vérifié les caches au chargement.
        if (parent || !idRendu || versionRendue === null) return;
        // Projet du navigateur différent du projet de la session : réglé par la réconciliation de
        // index.html ou le parcours d'ouverture en cours, pas ici.
        if (lire('current_projet_id') !== idRendu) return;
        const versionLocale = lire(cleVersionBase(idRendu));
        const ecritParCePoste = !!rendu.dernierOnglet && ongletsRecents().includes(rendu.dernierOnglet);
        if (versionLocale !== null && Number(versionLocale) !== versionRendue && !ecritParCePoste) {
            const valeurs = ecarterCachesProjet(idRendu);
            if (Object.keys(valeurs).length) {
                cachesEcartes = {
                    cle: `${idRendu}:${Date.now()}`,
                    projetId: idRendu,
                    nomProjet: lire('current_projet_nom') || '',
                    date: Date.now(),
                    versionLocale: Number(versionLocale),
                    versionBase: versionRendue,
                    valeurs,
                };
                garderCopie(cachesEcartes);
                console.warn(`[VersionProjet] Projet ${idRendu} modifié ailleurs (version locale ${versionLocale}, en base ${versionRendue}) : caches locaux écartés, version enregistrée rechargée.`);
            }
        }
        ecrire(cleVersionBase(idRendu), versionRendue);
    })();

    function afficherBandeauCachesEcartes() {
        if (!cachesEcartes || document.getElementById('skv-bandeau-caches-ecartes')) return;
        const bandeau = document.createElement('div');
        bandeau.id = 'skv-bandeau-caches-ecartes';
        bandeau.setAttribute('role', 'status');
        bandeau.style.cssText = 'position:fixed; top:64px; left:50%; transform:translateX(-50%); z-index:99990; width:min(620px, calc(100vw - 32px)); background:#eff6ff; color:#1e3a8a; border:1px solid #93c5fd; border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,0.15); padding:12px 14px; font:13px/1.45 Arial, sans-serif;';
        const texte = document.createElement('p');
        texte.style.margin = '0 0 8px';
        texte.textContent = 'Ce projet a été modifié depuis un autre onglet ou un autre poste depuis votre '
            + 'dernier passage : la dernière version enregistrée a été chargée. Les données gardées sur '
            + 'ce poste pour ce projet ont été écartées (copie conservée 30 jours).';
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;';
        const bouton = (libelle, principal) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = libelle;
            b.style.cssText = `border-radius:6px; padding:6px 12px; font-size:12px; font-weight:600; cursor:pointer; border:1px solid #2563eb; ${principal ? 'background:#2563eb; color:#fff;' : 'background:#fff; color:#1d4ed8;'}`;
            return b;
        };
        const telecharger = bouton('Télécharger la copie écartée', false);
        const ok = bouton('Compris', true);
        telecharger.addEventListener('click', () => telechargerCopie(cachesEcartes));
        ok.addEventListener('click', () => bandeau.remove());
        actions.append(telecharger, ok);
        bandeau.append(texte, actions);
        document.body.appendChild(bandeau);
    }

    function telechargerCopie(copie) {
        const blob = new Blob([JSON.stringify(copie, null, 2)], { type: 'application/json' });
        const lien = document.createElement('a');
        lien.href = URL.createObjectURL(blob);
        const jour = new Date(copie.date).toISOString().slice(0, 10);
        lien.download = `copie-locale-projet-${copie.projetId}-${jour}.json`;
        document.body.appendChild(lien);
        lien.click();
        setTimeout(() => { URL.revokeObjectURL(lien.href); lien.remove(); }, 1000);
    }

    if (cachesEcartes) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', afficherBandeauCachesEcartes);
        else afficherBandeauCachesEcartes();
    }

    // ------------------------------------------------------------------------------------------
    // 1. Verrou optimiste : en-têtes des écritures, version suivie, conflit
    // ------------------------------------------------------------------------------------------
    let enDechargement = false;
    window.addEventListener('beforeunload', () => {
        enDechargement = true;
        // Fermeture annulée (avertissement « Quitter la page ? ») : écritures de nouveau comptées.
        setTimeout(() => { enDechargement = false; }, 1500);
    });
    window.addEventListener('pagehide', () => { enDechargement = true; });
    window.addEventListener('pageshow', () => { enDechargement = false; });

    function projetDeLUrl(url) {
        try {
            const u = new URL(url, window.location.href);
            if (u.origin !== window.location.origin) return null;
            for (const motif of CHEMINS_PROJET) {
                const m = motif.exec(u.pathname);
                if (m) return m[1];
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    let conflitSignale = false;
    function signalerConflit(message) {
        if (parent) { parent.signalerConflit(message); return; }
        if (conflitSignale) return;
        conflitSignale = true;
        const texte = message || 'Ce projet a été modifié depuis un autre onglet ou un autre poste. Rechargez la page pour repartir de la dernière version enregistrée.';
        if (typeof window.verrouillerProjet === 'function') window.verrouillerProjet('Projet modifié ailleurs', texte);
        else alert(texte);
    }

    function traiterReponse(projetId, reponse, ecriture) {
        if (ecriture && reponse.status === 409) {
            reponse.clone().json().then((corps) => {
                if (corps && corps.conflit_version) signalerConflit(corps.message);
            }).catch(() => { /* autre 409 (projet hors session...) : traité par l'appelant */ });
            return;
        }
        if (!ecriture || !reponse.ok) return;
        const brut = reponse.headers.get('X-Skv-Version');
        if (!brut || !/^\d+$/.test(brut)) return;
        noterEcriture(projetId, Number(brut));
    }

    /** Écriture réussie de CET onglet : version connue et version des caches locaux avancées. */
    function noterEcriture(projetId, version) {
        if (parent) { parent.noterEcriture(projetId, version); return; }
        versions.set(String(projetId), version);
        // Les caches de ce navigateur reflètent désormais cette version (écrite par lui).
        if (lire('current_projet_id') === String(projetId)) ecrire(cleVersionBase(projetId), version);
    }

    /** En-têtes d'une écriture : null pendant la fermeture de la page (ni contrôlée ni comptée). */
    function entetesEcriture(projetId) {
        if (enDechargement) return null;
        if (parent) return parent.entetes(projetId);
        return { onglet: ONGLET, version: versions.has(projetId) ? versions.get(projetId) : null };
    }

    const fetchOrigine = window.fetch ? window.fetch.bind(window) : null;
    if (fetchOrigine) {
        window.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
            const projetId = projetDeLUrl(url);
            if (!projetId) return fetchOrigine(input, init);
            const methode = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
            const ecriture = methode !== 'GET' && methode !== 'HEAD';
            let options = init;
            const valeurs = ecriture ? entetesEcriture(projetId) : null;
            if (valeurs) {
                const entetes = new Headers((init && init.headers) || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
                entetes.set('X-Skv-Onglet', valeurs.onglet);
                if (valeurs.version !== null && valeurs.version !== undefined) entetes.set('X-Skv-Version', String(valeurs.version));
                options = { ...(init || {}), headers: entetes };
            }
            return fetchOrigine(input, options).then((reponse) => {
                try { traiterReponse(projetId, reponse, ecriture); } catch (e) { /* jamais bloquant */ }
                return reponse;
            });
        };
    }

    window.SkvVersionProjet = {
        onglet: ONGLET,
        integre: !!parent,
        // Partagé avec les modales intégrées de cette page (cf. en-tête) : valeurs primitives
        // seulement, chaque fenêtre construit ses propres objets Headers.
        partage: {
            onglet: ONGLET,
            entetes: (projetId) => entetesEcriture(String(projetId)),
            noterEcriture: (projetId, version) => noterEcriture(String(projetId), version),
            signalerConflit: (message) => signalerConflit(message),
        },
        versionConnue: (projetId) => (parent ? (parent.entetes(projetId) || {}).version : versions.get(String(projetId))),
        cachesEcartes: () => cachesEcartes,
        /** Caches locaux du projet quitté oubliés (changement de projet, déconnexion) : cf. section 3. */
        oublierCachesProjet: (projetId) => oublierCachesProjet(projetId != null ? String(projetId) : null),
        /** Copies des caches écartés conservées dans ce navigateur (assistance). */
        copiesSecours: async () => {
            const base = await ouvrirBaseSecours();
            return new Promise((resolve) => {
                const req = base.transaction('copies').objectStore('copies').getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            });
        },
        telechargerCopie,
    };
})();
