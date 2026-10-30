/**
 * Persistance SERVEUR des saisies du configurateur « Petit champ solaire » (iframe), en complément
 * du localStorage géré par GeometrieStructureStorageManager (storage_manager_geometrie_structure.js).
 *
 *  - à l'ouverture : GET /api/petit_champ/<projet>/<pv>/parametres ; si la version serveur est plus
 *    récente que la copie locale (ou si le navigateur n'en a pas : autre poste, cache vidé), elle
 *    est recopiée dans le localStorage avant la restauration du gestionnaire (ou restaurée après
 *    coup si la réponse arrive en retard) ;
 *  - à chaque modification : envoi différé (PUT), UNIQUEMENT si la validation front passe — le
 *    serveur revalide de toute façon et refuse (422) une saisie hors bornes.
 * Statut affiché sous le bouton « Dossier de plans » (#pcsSauvegardeStatut).
 */
(function () {
    'use strict';

    const TYPE = 'petit_champ_solaire';
    const DELAI_ENVOI_MS = 1500;
    const pvId = new URLSearchParams(window.location.search).get('pvId') || 'PV1';
    const projetId = localStorage.getItem('current_projet_id');
    const url = projetId ? `/concevoir_mon_projet/api/petit_champ/${encodeURIComponent(projetId)}/${encodeURIComponent(pvId)}/parametres` : null;

    let minuteur = null;
    let dernierEnvoi = null;

    function statut(texte, erreur = false) {
        const el = document.getElementById('pcsSauvegardeStatut');
        if (!el) return;
        el.textContent = texte;
        el.style.color = erreur ? '#b91c1c' : '#64748b';
    }

    function manager() {
        return window.geometrieStructureStorageManager;
    }

    // Même clé que le gestionnaire : propre au projet actif (jamais la copie d'un autre projet).
    function cleLocale() {
        const m = manager();
        return (m && m.STORAGE_KEY)
            || `skv_geometrie_structure_data:${projetId || 'sans_projet'}`;
    }

    function copieLocale() {
        try {
            const all = JSON.parse(localStorage.getItem(cleLocale()) || '{}');
            return (all[TYPE] && all[TYPE][pvId]) || null;
        } catch (e) {
            return null;
        }
    }

    function ecrireCopieLocale(donnees) {
        try {
            const all = JSON.parse(localStorage.getItem(cleLocale()) || '{}');
            all[TYPE] = all[TYPE] || {};
            all[TYPE][pvId] = donnees;
            localStorage.setItem(cleLocale(), JSON.stringify(all));
        } catch (e) {
            console.warn('[PetitChamp] Copie locale impossible :', e);
        }
    }

    function dateServeur(iso) {
        if (!iso) return 0;
        // datetime.utcnow().isoformat() : pas de fuseau, c'est de l'UTC.
        const t = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
        return Number.isFinite(t) ? t : 0;
    }

    async function chargerDepuisServeur() {
        if (!url) return;
        try {
            const res = await fetch(url, { credentials: 'same-origin' });
            if (!res.ok) return;
            const json = await res.json();
            const serveur = json && json.donnees;
            if (!serveur || !serveur.parametres || !serveur.parametres.fields) return;
            const locale = copieLocale();
            const tServeur = serveur.parametres.savedAt || dateServeur(serveur.updated_at);
            const tLocale = (locale && locale.savedAt) || 0;
            if (tServeur <= tLocale) return;
            ecrireCopieLocale(serveur.parametres);
            const m = manager();
            // Réponse arrivée après la restauration initiale : on restaure la version serveur.
            if (m && m.initialRestoreDone) {
                m.restoreData();
                // Même signal que la restauration initiale : la page parente réimpose alors le
                // modèle de poteaux / la hauteur bas PV du champ (calepinage_maison_dimensions_petit_champ.js).
                document.dispatchEvent(new CustomEvent('geometrieStructureRestauree', { detail: { pvId, source: 'serveur' } }));
            }
            statut('Saisies rechargées depuis le serveur.');
        } catch (e) {
            console.warn('[PetitChamp] Lecture serveur des saisies impossible :', e);
        }
    }

    async function envoyer({ keepalive = false } = {}) {
        minuteur = null;
        const m = manager();
        if (!url || !m || !m.initialRestoreDone) return;
        const parametres = m.collectData();
        const erreurs = window.PetitChampValidation ? window.PetitChampValidation.valider(parametres) : [];
        if (erreurs.length) {
            statut(`Non enregistré : ${erreurs[0]}`, true);
            return;
        }
        const corps = JSON.stringify({ parametres });
        const empreinte = JSON.stringify({ ...parametres, savedAt: 0 });
        if (empreinte === dernierEnvoi) return;
        try {
            const res = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: corps,
                keepalive,
            });
            if (res.ok) {
                dernierEnvoi = empreinte;
                statut(`Saisies enregistrées (${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}).`);
            } else {
                const json = await res.json().catch(() => ({}));
                statut(`Non enregistré : ${(json.erreurs && json.erreurs[0]) || json.error || `erreur ${res.status}`}`, true);
            }
        } catch (e) {
            statut('Non enregistré : serveur injoignable (la saisie reste mémorisée dans ce navigateur).', true);
        }
    }

    function planifier() {
        const m = manager();
        if (!m || !m.initialRestoreDone || m.isRestoring) return;
        clearTimeout(minuteur);
        minuteur = setTimeout(envoyer, DELAI_ENVOI_MS);
    }

    // ------------------------------------------------------------------------------------------
    // Copie locale d'origine inconnue (ancienne clé du navigateur, commune à tous les projets, cf.
    // GeometrieStructureStorageManager.reprendreAncienneCle) : jamais appliquée d'office.
    //  - déjà enregistrée dans un projet (réponse du serveur) ou identique à ce champ : oubliée ;
    //  - sinon : l'utilisateur choisit de l'appliquer à CE champ ou de l'ignorer.
    // ------------------------------------------------------------------------------------------
    const DUREE_MAX_ORPHELIN_MS = 90 * 24 * 3600 * 1000;

    function canonique(v) {
        if (Array.isArray(v)) return v.map(canonique);
        if (v && typeof v === 'object') {
            const o = {};
            Object.keys(v).sort().forEach((k) => { o[k] = canonique(v[k]); });
            return o;
        }
        return v;
    }
    function empreinte(p) {
        return JSON.stringify(canonique({
            fields: (p && p.fields) || {}, activeButtons: (p && p.activeButtons) || [], activeChoices: (p && p.activeChoices) || [],
        }));
    }

    function attendreRestaurationInitiale() {
        const m = manager();
        if (m && m.initialRestoreDone) return Promise.resolve();
        return new Promise((resolve) => document.addEventListener('geometrieStructureRestauree', () => resolve(), { once: true }));
    }

    async function appliquerCopieOrpheline(copie) {
        await attendreRestaurationInitiale();
        ecrireCopieLocale({ ...copie, savedAt: Date.now() });
        const m = manager();
        if (m) m.restoreData();
        document.dispatchEvent(new CustomEvent('geometrieStructureRestauree', { detail: { pvId, source: 'copie_locale' } }));
        await envoyer();
    }

    function proposerCopieOrpheline(copie, oublier) {
        const ancre = document.getElementById('pcsSauvegardeStatut');
        if (!ancre || document.getElementById('pcsCopieOrpheline')) return;
        const bloc = document.createElement('div');
        bloc.id = 'pcsCopieOrpheline';
        bloc.setAttribute('role', 'alert');
        bloc.style.cssText = 'margin-top:6px;padding:8px 10px;border:1px solid #f59e0b;border-radius:6px;background:#fffbeb;color:#92400e;font-size:12px;';
        const date = copie.savedAt ? new Date(copie.savedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'date inconnue';
        const texte = document.createElement('p');
        texte.style.margin = '0 0 6px';
        texte.textContent = `Des réglages de petit champ (${pvId}) saisis le ${date} ont été retrouvés dans ce navigateur. `
            + 'Ils n’ont jamais été enregistrés sur le serveur et leur projet d’origine est inconnu. '
            + 'Voulez-vous les appliquer à ce champ ?';
        const bouton = (libelle, primaire, action) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = libelle;
            b.style.cssText = `margin-right:6px;padding:3px 10px;border-radius:4px;cursor:pointer;border:1px solid #b45309;${primaire ? 'background:#b45309;color:#fff;' : 'background:#fff;color:#92400e;'}`;
            b.addEventListener('click', async () => {
                bloc.remove();
                oublier();
                await action();
            });
            return b;
        };
        bloc.append(texte,
            bouton('Appliquer à ce champ', true, () => appliquerCopieOrpheline(copie)),
            bouton('Ignorer', false, () => statut('Réglages retrouvés ignorés.')));
        ancre.insertAdjacentElement('afterend', bloc);
    }

    async function traiterCopieOrpheline() {
        const M = window.GeometrieStructureStorageManager;
        if (!M || typeof M.lireOrphelins !== 'function') return;
        const copie = (M.lireOrphelins()[TYPE] || {})[pvId];
        if (!copie || !copie.fields) return;
        const oublier = () => M.oublierOrphelin(TYPE, pvId);
        if (copie.savedAt && Date.now() - copie.savedAt > DUREE_MAX_ORPHELIN_MS) { oublier(); return; }
        const actuelle = copieLocale();
        if (actuelle && empreinte(actuelle) === empreinte(copie)) { oublier(); return; }
        let res = null;
        try {
            const r = await fetch('/concevoir_mon_projet/api/petit_champ/copie-locale/proprietaire', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ parametres: copie }),
            });
            res = r.ok ? await r.json() : null;
        } catch (e) {
            return; // serveur injoignable : la copie est gardée, nouvelle tentative à la prochaine ouverture
        }
        if (!res || !res.success) return;
        // Déjà enregistrée dans un projet (elle y est en sécurité), ou hors bornes (jamais enregistrable).
        if (res.projet_id || res.valide === false) { oublier(); return; }
        proposerCopieOrpheline(copie, oublier);
    }

    if (!url) {
        document.addEventListener('DOMContentLoaded', () => statut('Aucun projet actif : saisies non enregistrées sur le serveur.', true));
        return;
    }
    const domPret = document.readyState === 'loading'
        ? new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
        : Promise.resolve();
    Promise.all([chargerDepuisServeur(), domPret]).then(traiterCopieOrpheline)
        .catch((e) => console.warn('[PetitChamp] Copie locale retrouvée non traitée :', e));
    document.addEventListener('DOMContentLoaded', () => {
        const modal = document.getElementById('app-modal');
        if (modal) {
            modal.addEventListener('input', planifier);
            modal.addEventListener('change', planifier);
            modal.addEventListener('click', (e) => { if (e.target.closest('button')) planifier(); });
        }
    });
    window.addEventListener('pagehide', () => { if (minuteur) { clearTimeout(minuteur); envoyer({ keepalive: true }); } });

    window.PetitChampPersistance = { envoyer, chargerDepuisServeur, traiterCopieOrpheline };
})();
