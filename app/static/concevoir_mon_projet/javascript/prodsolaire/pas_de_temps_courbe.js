// =========================================================================
// PAS DE TEMPS D'UNE COURBE DE CHARGE IMPORTÉE (5 / 10 / 15 / 30 / 60 min)
// =========================================================================
// Détection unique partagée par tous les imports navigateur (consommation ACI, consommateurs ACC,
// consommation existante du module IRVE) : même règle que _pas_fichier_minutes côté serveur
// (calcul_autoconso.py) — écart entre les horodatages de la 1re colonne d'abord, nombre de lignes
// d'une année seulement si les dates sont illisibles. Déduire le pas du seul nombre de lignes
// confondait une demi-année au pas de 30 min (8 760 lignes) avec une année horaire (énergie × 2) et
// ignorait les courbes R63 à 5 min (énergie × 12 avec un sélecteur à 60 min).
//
// Module sans dépendance : importé par main_acc.js et irve_consumption_import.js, et exposé sur
// window pour calcul_irve.js (script classique).

// Pas reconnus dans un fichier importé. 5 min (courbe R63 Enedis) est une entrée seulement : ce
// n'est pas un pas de simulation, il est ramené par moyenne au pas choisi (10/15/30/60).
export const PAS_SUPPORTES_MIN = [5, 10, 15, 30, 60];

function horodatageEnMinutes(valeur) {
    if (typeof valeur === 'number' && isFinite(valeur)) {
        return valeur * 1440; // date Excel : jours depuis 1900
    }
    if (valeur instanceof Date) return valeur.getTime() / 60000;
    const m = String(valeur ?? '').trim()
        .match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    let [jour, mois, annee] = [+m[1], +m[2], +m[3]];
    if (m[1].length === 4) [annee, jour] = [+m[1], +m[3]]; // AAAA-MM-JJ
    const t = Date.UTC(annee, mois - 1, jour, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return isNaN(t) ? null : t / 60000;
}

/**
 * Pas de temps (minutes, parmi 5/10/15/30/60) d'une courbe tabulaire : écart médian entre les
 * horodatages de la 1re colonne, ou à défaut nombre de lignes d'une année. null si indéterminable.
 * @param {Array<Array<*>>} lignes - lignes de données (en-têtes déjà retirés)
 */
export function detecterPasDeTempsCourbe(lignes) {
    const temps = [];
    for (const ligne of (lignes || []).slice(0, 500)) {
        const t = horodatageEnMinutes(Array.isArray(ligne) ? ligne[0] : null);
        if (t !== null) temps.push(t);
    }
    const ecarts = [];
    for (let i = 1; i < temps.length; i++) {
        const e = Math.round(temps[i] - temps[i - 1]);
        if (e > 0) ecarts.push(e);
    }
    if (ecarts.length >= 10) {
        ecarts.sort((a, b) => a - b);
        const mediane = ecarts[Math.floor(ecarts.length / 2)];
        if (PAS_SUPPORTES_MIN.includes(mediane)) return mediane;
    }
    const n = (lignes || []).filter(l => Array.isArray(l) && l.length > 1 && l[1] !== '' && l[1] != null).length;
    for (const pas of PAS_SUPPORTES_MIN) {
        const attendu = 8760 * 60 / pas;
        if (Math.abs(n - attendu) <= 2 * 60 / pas * 25) return pas; // tolérance : année bissextile / changements d'heure
    }
    return null;
}

window.detecterPasDeTempsCourbe = detecterPasDeTempsCourbe;
