/**
 * Persistance localStorage des calepinages dessinés dans le modal "Calepinage résidentiel"
 * (cf. calepinage_maison_indiv.js). Fichier dédié, volontairement séparé du moteur principal —
 * ne connaît rien de la structure interne de `state`, se contente de stocker/restituer
 * l'instantané que l'appelant lui fournit, sous une clé par sourceId.
 *
 * Ne persiste jamais l'image importée elle-même (cf. calepinage_image_source.js) : uniquement des
 * données géométriques/numériques, bien en-deçà du quota localStorage (~5-10 Mo/origine).
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'calepinage_maison_v1';

    function readStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (err) {
            console.warn('[CalepinagePersistence] lecture impossible, réinitialisation.', err);
            return {};
        }
    }

    function writeStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
            return true;
        } catch (err) {
            console.warn('[CalepinagePersistence] écriture impossible (quota ?).', err);
            return false;
        }
    }

    function projetActif() {
        try { return localStorage.getItem('current_projet_id'); } catch (err) { return null; }
    }

    // Chaque état est marqué du projet auquel il appartient (meta.projetId, sinon le projet actif) :
    // une écriture tardive de l'ancien projet juste après un changement de projet ne peut plus se
    // greffer sur le champ de même numéro (PV1...) du nouveau projet.
    function save(sourceId, meta, stateSnapshot) {
        if (!sourceId) return false;
        // Projet changé dans un autre onglet (cf. garde_projet_actif.js) : cache partagé à préserver.
        if (typeof window.projetActifVerrouille === 'function' && window.projetActifVerrouille()) return false;
        const projetId = (meta && meta.projetId) || projetActif();
        if (meta && meta.projetId && projetActif() && String(meta.projetId) !== String(projetActif())) {
            return false; // état d'un projet qui n'est plus le projet actif
        }
        const store = readStore();
        store[sourceId] = {
            sourceType: meta && meta.sourceType,
            sourceLabel: meta && meta.sourceLabel,
            savedAt: Date.now(),
            ...(projetId ? { projetId: String(projetId) } : {}),
            state: stateSnapshot,
        };
        return writeStore(store);
    }

    function load(sourceId) {
        if (!sourceId) return null;
        const entree = readStore()[sourceId] || null;
        const projet = projetActif();
        if (entree && entree.projetId && projet && String(entree.projetId) !== String(projet)) return null;
        return entree;
    }

    function remove(sourceId) {
        if (!sourceId) return;
        const store = readStore();
        if (store[sourceId]) {
            delete store[sourceId];
            writeStore(store);
        }
    }

    window.CalepinagePersistence = { save, load, remove };
})();
