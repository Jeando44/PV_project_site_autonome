// Fichier dédié à la gestion de la session utilisateur (sauvegarde/chargement)

const ACC_SESSION_KEY = 'acc_session_state';

/**
 * Sauvegarde l'état actuel de la configuration ACC dans le localStorage.
 * @param {object} newState - L'objet d'état à sauvegarder.
 *                         Doit contenir { repartitionMethod, participants, priorityOrder }.
 */
export function saveAccState(newState) {
    // On charge l'état existant pour ne pas écraser des clés non gérées ici (ex: investmentCost)
    const currentState = loadAccState() || {};

    // On fusionne le nouvel état dans l'état actuel
    const state = { ...currentState, ...newState };

    try {
        // CORRECTION : Nous modifions directement le localStorage. L'événement 'storage'
        // est déclenché dans les autres onglets, mais un écouteur dans main_prodsolaire.js
        // réagissait de manière incorrecte. Nous allons le corriger là-bas.
        localStorage.setItem(ACC_SESSION_KEY, JSON.stringify(state));
    } catch (e) {
        console.error("Erreur lors de la sauvegarde de l'état de la session ACC:", e);
    }
}

/**
 * Charge l'état de la configuration ACC depuis le localStorage.
 * @returns {object|null} L'état sauvegardé ou null s'il n'y en a pas.
 */
export function loadAccState() {
    try {
        const savedState = localStorage.getItem(ACC_SESSION_KEY);
        return savedState ? JSON.parse(savedState) : null;
    } catch (e) {
        console.error("Erreur lors du chargement de l'état de la session:", e);
        return null;
    }
}

/**
 * Efface l'état de la session ACC du localStorage.
 */
export function clearAccState() {
    localStorage.removeItem(ACC_SESSION_KEY);
}