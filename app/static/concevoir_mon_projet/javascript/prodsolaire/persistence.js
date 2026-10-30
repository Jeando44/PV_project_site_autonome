// Module de persistance côté client
// - IndexedDB pour les fichiers Excel (pas de limite de 5 Mo)
// - localStorage pour les états de formulaires

const DB_NAME = 'AutoconsoFilesDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';

let _db = null;

async function getDB() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
        req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
        req.onerror = (e) => { console.error('IndexedDB ouverture échouée :', e.target.error); reject(e.target.error); };
    });
}

export async function saveFileToIDB(key, file) {
    try {
        const db = await getDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put({ key, file, name: file.name, type: file.type, lastModified: file.lastModified });
            tx.oncomplete = resolve;
            tx.onerror = (e) => reject(e.target.error);
        });
    } catch (e) { console.warn('saveFileToIDB échoué :', key, e); }
}

export async function getFileFromIDB(key) {
    try {
        const db = await getDB();
        return await new Promise((resolve, reject) => {
            const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
            req.onsuccess = (e) => {
                const rec = e.target.result;
                resolve(rec ? new File([rec.file], rec.name, { type: rec.type, lastModified: rec.lastModified }) : null);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (e) { console.warn('getFileFromIDB échoué :', key, e); return null; }
}

export async function deleteFileFromIDB(key) {
    try {
        const db = await getDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(key);
            tx.oncomplete = resolve;
            tx.onerror = (e) => reject(e.target.error);
        });
    } catch (e) { console.warn('deleteFileFromIDB échoué :', key, e); }
}

// Récupère toutes les entrées dont la clé commence par `prefix`
export async function getIDBEntriesByPrefix(prefix) {
    try {
        const db = await getDB();
        return await new Promise((resolve, reject) => {
            const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
            req.onsuccess = (e) => {
                resolve((e.target.result || [])
                    .filter(r => r.key.startsWith(prefix))
                    .map(r => ({ key: r.key, file: new File([r.file], r.name, { type: r.type, lastModified: r.lastModified }) }))
                );
            };
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (e) { console.warn('getIDBEntriesByPrefix échoué :', prefix, e); return []; }
}

// Projet actif auquel rattacher les courbes de charge en base.
// CORRECTIF : ne lisait que window.calepinageService, qui n'est chargé NI sur app_irve_v1.16.html (modal
// Enedis + section Import CdC) NI sur index_autoconso.html (pages indépendantes en iframe) — sur ces
// deux pages la sauvegarde/restauration en base sortait donc toujours sur « aucun projet actif », sans
// rien écrire. Ordre : service calepinage (page principale) > id vérifié en base côté serveur
// (window.ACTIVE_PROJECT_ID_VERIFIE, context processor main.py) > replis historiques.
export function getProjetIdActif() {
    const candidats = [
        window.calepinageService?.getCurrentProjetId?.(),
        window.ACTIVE_PROJECT_ID_VERIFIE,
        window.ACTIVE_PROJECT_ID,
        typeof window.sgGetProjectId === 'function' ? window.sgGetProjectId() : null,
        (() => { try { return localStorage.getItem('current_projet_id'); } catch (e) { return null; } })(),
    ];
    for (const c of candidats) {
        const id = parseInt(c, 10);
        if (Number.isInteger(id) && id > 0) return id;
    }
    return null;
}

// NOUVEAU (demande explicite : "assurez-vous que l'import de CDC est bien intégré dans la base de
// données") : sauvegarde la CDC à la fois dans l'IndexedDB locale (comportement inchangé) ET côté
// serveur, associée au projet actif. Point d'entrée UNIQUE adopté par les 3 endroits où l'utilisateur
// désigne explicitement une courbe de consommation pour l'étude : import manuel
// (Irve/irve_consumption_import.js, source='import') et les 2 injections de courbe Enedis/Switchgrid
// (Irve/switchgrid_data.js, source='enedis'). Isolation projet + compte utilisateur : le serveur
// retrouve/écrase toujours la CDC par le projet actif (window.calepinageService.getCurrentProjetId()),
// jamais par une clé globale partagée (contrairement à l'ancien bug IndexedDB) — l'utilisateur est
// identifié côté serveur par sa session, pas par une donnée envoyée depuis le client.
// N'annule jamais la sauvegarde IndexedDB déjà faite : si la validation serveur échoue (format/
// données invalides), un message d'erreur est affiché via `notify` mais le calcul via IndexedDB reste
// possible comme avant.
export async function saveConsFileToIDBAndDB(file, source, notify, timeStepMinutes) {
    await saveFileToIDB('consFile', file);
    signalerCourbesConsommationModifiees();

    try {
        const projetId = getProjetIdActif();
        if (!projetId) {
            console.warn('saveConsFileToIDBAndDB : aucun projet actif, sauvegarde en base ignorée.');
            return { success: false, message: 'Aucun projet actif' };
        }
        saveToLS(CONS_IDB_PROPRIETAIRE, projetId);

        const timeStep = parseInt(timeStepMinutes, 10) || window.currentTimeStep || window.timeStep || 60;

        const formData = new FormData();
        formData.append('cons_file', file, file.name);
        formData.append('source', source || 'import');
        formData.append('time_step', String(timeStep));

        const res = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/cdc`, {
            method: 'POST',
            body: formData
        });
        const result = await res.json();

        if (!res.ok || !result.success) {
            const message = result.message || "Échec de la sauvegarde de la courbe de charge en base.";
            console.warn('saveConsFileToIDBAndDB (serveur) échoué :', message);
            if (typeof notify === 'function') notify(message, 'error');
            return { success: false, message };
        }

        return { success: true, id: result.id };
    } catch (e) {
        console.warn('saveConsFileToIDBAndDB (serveur) exception :', e);
        if (typeof notify === 'function') {
            notify("Erreur réseau lors de la sauvegarde de la courbe de charge en base.", 'error');
        }
        return { success: false, message: String(e) };
    }
}

// Supprime la CDC sauvegardée en base pour le projet actif (à appeler en plus de
// deleteFileFromIDB('consFile') lors d'une suppression manuelle par l'utilisateur — cf.
// irve_consumption_import.js::cons-remove-btn).
export async function deleteConsFileFromDB() {
    signalerCourbesConsommationModifiees();
    try {
        const projetId = getProjetIdActif();
        if (!projetId) return { success: false, message: 'Aucun projet actif' };
        const res = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/cdc`, { method: 'DELETE' });
        return await res.json();
    } catch (e) {
        console.warn('deleteConsFileFromDB échoué :', e);
        return { success: false, message: String(e) };
    }
}

// Restaure la CDC depuis la base dans l'IndexedDB locale si celle-ci est vide (ex. après un vidage de
// cache navigateur ou sur une autre machine/session) — n'écrase jamais une entrée IndexedDB déjà
// présente. Retourne le File restauré, ou null si rien à restaurer/aucun projet actif.
// 'consFile' est une clé globale au navigateur : si elle appartient à un AUTRE projet que le projet
// actif (ouverture d'un projet existant — la purge de parametreProjetFormManager.js ne couvre que la
// création), elle est écartée puis remplacée par la CDC du projet actif enregistrée en base.
const CONS_IDB_PROPRIETAIRE = 'consFileProjetId';

export async function restoreConsFileFromDBIfMissing() {
    const projetId = getProjetIdActif();
    const proprietaire = loadFromLS(CONS_IDB_PROPRIETAIRE);
    if (projetId && proprietaire != null && proprietaire !== projetId) {
        await deleteFileFromIDB('consFile');
    }
    if (projetId) saveToLS(CONS_IDB_PROPRIETAIRE, projetId);

    const existing = await getFileFromIDB('consFile');
    if (existing) return null;

    try {
        if (!projetId) return null;

        const res = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/cdc`);
        if (!res.ok) return null;

        const blob = await res.blob();
        const disposition = res.headers.get('Content-Disposition') || '';
        const match = disposition.match(/filename="?([^"]+)"?/);
        const filename = match ? match[1] : 'consommation.xlsx';
        const file = new File([blob], filename, { type: res.headers.get('Content-Type') || 'application/octet-stream' });

        await saveFileToIDB('consFile', file);
        return file;
    } catch (e) {
        console.warn('restoreConsFileFromDBIfMissing échoué :', e);
        return null;
    }
}

// ------------------------------------------------------------------------------------------------ //
// Courbes des participants ACC en base (une par participant, cf. ConsommationFileAcc et les routes
// .../parametre-projet/<id>/cdc-acc). L'IndexedDB ('accFile_<nom>') reste la copie de travail lue par
// main_acc.js ; la base est la copie de référence rattachée au projet et au compte, restaurée dans
// l'IndexedDB si celle-ci est vide (cache vidé, autre navigateur/machine).
// ------------------------------------------------------------------------------------------------ //
const ACC_IDB_PROPRIETAIRE = 'accFilesProjetId';
const _accBase = (projetId) => `/concevoir_mon_projet/parametre-projet/${projetId}/cdc-acc`;

export async function saveAccFileToDB(file, { originalName, customName, source = 'import', timeStep, prm, annee } = {}, notify) {
    try {
        const projetId = getProjetIdActif();
        if (!projetId) {
            console.warn('saveAccFileToDB : aucun projet actif, sauvegarde en base ignorée.');
            return { success: false, message: 'Aucun projet actif' };
        }
        const formData = new FormData();
        formData.append('cons_file', file, file.name);
        formData.append('original_name', originalName || file.name);
        if (customName) formData.append('custom_name', customName);
        formData.append('source', source);
        formData.append('time_step', String(parseInt(timeStep, 10) || 60));
        if (prm) formData.append('prm', prm);
        if (annee) formData.append('annee', annee);

        const res = await fetch(_accBase(projetId), { method: 'POST', body: formData });
        const result = await res.json();
        if (!res.ok || !result.success) {
            const message = result.message || "Échec de la sauvegarde de la courbe du participant en base.";
            console.warn('saveAccFileToDB (serveur) échoué :', message);
            if (typeof notify === 'function') notify(`${originalName || file.name} : ${message}`, 'error');
            return { success: false, message };
        }
        saveToLS(ACC_IDB_PROPRIETAIRE, projetId);
        return { success: true, fichier: result.fichier };
    } catch (e) {
        console.warn('saveAccFileToDB exception :', e);
        if (typeof notify === 'function') notify("Erreur réseau lors de la sauvegarde de la courbe du participant en base.", 'error');
        return { success: false, message: String(e) };
    }
}

/**
 * Noms (original_name) des courbes ACC enregistrées en base pour le projet actif, ou null si la liste
 * est indisponible (pas de projet, erreur) — sert au rattrapage des courbes restées seulement dans
 * l'IndexedDB (cf. main_acc.js::restoreAccFilesFromIDB).
 */
export async function listAccFileNamesInDB() {
    try {
        const projetId = getProjetIdActif();
        if (!projetId) return null;
        const res = await fetch(_accBase(projetId));
        if (!res.ok) return null;
        const { fichiers = [] } = await res.json();
        return new Set(fichiers.map((f) => f.original_name));
    } catch (e) {
        console.warn('listAccFileNamesInDB échoué :', e);
        return null;
    }
}

export async function renameAccFileInDB(originalName, customName) {
    try {
        const projetId = getProjetIdActif();
        if (!projetId) return { success: false, message: 'Aucun projet actif' };
        const res = await fetch(_accBase(projetId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ original_name: originalName, custom_name: customName }),
        });
        return await res.json();
    } catch (e) {
        console.warn('renameAccFileInDB échoué :', e);
        return { success: false, message: String(e) };
    }
}

export async function deleteAccFileFromDB(originalName) {
    try {
        const projetId = getProjetIdActif();
        if (!projetId) return { success: false, message: 'Aucun projet actif' };
        const res = await fetch(`${_accBase(projetId)}?original_name=${encodeURIComponent(originalName)}`, { method: 'DELETE' });
        return await res.json();
    } catch (e) {
        console.warn('deleteAccFileFromDB échoué :', e);
        return { success: false, message: String(e) };
    }
}

// Si aucune courbe ACC n'est présente dans l'IndexedDB, recharge celles du projet actif depuis la base
// (fichiers + noms personnalisés dans 'accFileMeta'). N'écrase jamais une IndexedDB déjà remplie.
// Retourne le nombre de courbes restaurées.
export async function restoreAccFilesFromDBIfMissing() {
    const projetId = getProjetIdActif();
    let existants = await getIDBEntriesByPrefix('accFile_');
    // Les clés 'accFile_*' sont globales au navigateur : si elles appartiennent à un AUTRE projet que
    // le projet actif (ouverture d'un projet existant — la purge de parametreProjetFormManager.js ne
    // couvre que la création), on les écarte et on recharge les participants du projet actif.
    const proprietaire = loadFromLS(ACC_IDB_PROPRIETAIRE);
    if (projetId && existants.length > 0 && proprietaire != null && proprietaire !== projetId) {
        await Promise.all(existants.map((e) => deleteFileFromIDB(e.key)));
        removeFromLS('accFileMeta');
        removeFromLS('acc_session_state');
        existants = [];
    }
    if (projetId) saveToLS(ACC_IDB_PROPRIETAIRE, projetId);
    if (existants.length > 0) return 0;
    try {
        if (!projetId) return 0;
        const res = await fetch(_accBase(projetId));
        if (!res.ok) return 0;
        const { fichiers = [] } = await res.json();
        if (fichiers.length === 0) return 0;

        const meta = loadFromLS('accFileMeta') || {};
        meta.files = meta.files || {};
        let restaures = 0;
        for (const f of fichiers) {
            const r = await fetch(`${_accBase(projetId)}/${f.id}`);
            if (!r.ok) continue;
            const blob = await r.blob();
            const file = new File([blob], f.original_name, { type: f.content_type || blob.type });
            await saveFileToIDB('accFile_' + f.original_name, file);
            meta.files[f.original_name] = {
                ...(meta.files[f.original_name] || {}),
                customName: f.custom_name || meta.files[f.original_name]?.customName || f.original_name.replace(/\.(xlsx|csv|txt)$/i, ''),
            };
            restaures++;
        }
        saveToLS('accFileMeta', meta);
        return restaures;
    } catch (e) {
        console.warn('restoreAccFilesFromDBIfMissing échoué :', e);
        return 0;
    }
}

// Courbes de consommation modifiées (import, remplacement ou suppression par l'utilisateur, ACI ou
// ACC, depuis n'importe quelle page) : les résultats d'autoconsommation déjà calculés sont périmés.
// L'empreinte du dernier calcul est effacée (le prochain « Calculer et visualiser » repasse par le
// serveur) et un marqueur est posé, lu par main_autoconso.js pour remettre les résultats à 0 : tout
// de suite si le modal Résultats est ouvert (événement local ou 'storage'), sinon à son ouverture.
export const MARQUEUR_COURBES_MODIFIEES = 'solar_sim_courbes_modifiees';

export function signalerCourbesConsommationModifiees() {
    removeFromLS('solar_sim_signature');
    saveToLS(MARQUEUR_COURBES_MODIFIEES, Date.now());
    window.dispatchEvent(new CustomEvent('courbesConsommationModifiees'));
}

// Helpers localStorage (JSON-safe)
export function saveToLS(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.warn('localStorage écriture échouée :', key, e); }
}

export function loadFromLS(key) {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : null; } catch (e) { return null; }
}

export function removeFromLS(key) {
    try { localStorage.removeItem(key); } catch (e) {}
}
