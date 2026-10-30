// Validation front des paramètres économiques ACC (modales "Paramètres économiques" et "Analyse
// financière avancée"). Bornes : window.ACC_ECO_BORNES, injectées par index_autoconso.html depuis
// app/services/acc/eco_bornes.json — même fichier et même algorithme que la validation serveur
// (app/services/acc/eco_validation.py), cf. tests/prodsolaire/test_acc_eco_validation.py.
// Un champ absent n'est pas une erreur ; un champ présent doit être un nombre fini dans ses bornes.

const MAX_PARTICIPANTS = 100;

function _nombre(valeur) {
    if (typeof valeur === 'boolean' || valeur === null || valeur === undefined) return null;
    let v;
    if (typeof valeur === 'number') v = valeur;
    else if (typeof valeur === 'string') {
        const s = valeur.trim().replace(',', '.');
        if (s === '' || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
        v = Number(s);
    } else return null;
    return Number.isFinite(v) ? v : null;
}

function _verifier(valeur, regle, libelle, maxEffectif) {
    const v = _nombre(valeur);
    if (v === null) return `[${libelle}] doit être un nombre (saisie : ${valeur === '' ? 'vide' : valeur}).`;
    if (regle.entier && !Number.isInteger(v)) return `[${libelle}] doit être un nombre entier (saisie : ${v}).`;
    const minIncl = regle.minIncl !== false;
    const maxIncl = regle.maxIncl !== false;
    const tropBas = regle.min !== undefined && regle.min !== null && (minIncl ? v < regle.min : v <= regle.min);
    const tropHaut = maxEffectif !== null && maxEffectif !== undefined && (maxIncl ? v > maxEffectif : v >= maxEffectif);
    if (!tropBas && !tropHaut) return null;
    const bornes = [];
    if (regle.min !== undefined && regle.min !== null) bornes.push(`${minIncl ? '>=' : '>'} ${regle.min}`);
    if (maxEffectif !== null && maxEffectif !== undefined) bornes.push(`${maxIncl ? '<=' : '<'} ${+maxEffectif.toFixed(6)}`);
    return `[${libelle}] doit être ${bornes.join(' et ')} (saisie : ${v}).`;
}

/**
 * @param {object} params - paramètres économiques (cf. getEconomicParams() de main_autoconso.js).
 * @param {number|null} [puissanceWc] - puissance crête (Wc), pour les bornes relatives (subvention,
 *   loyer) ; ignorées si inconnue.
 * @param {object} [bornes] - défaut : window.ACC_ECO_BORNES.
 * @returns {{cle: string, message: string, inputId?: string}[]}
 */
export function verifierParametresEcoAcc(params, puissanceWc = null, bornes = (typeof window !== 'undefined' ? window.ACC_ECO_BORNES : null)) {
    if (!bornes || !bornes.champs) return []; // bornes non injectées : pas de blocage (le serveur revérifie)
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        return [{ cle: 'params', message: 'Paramètres économiques ACC invalides.' }];
    }
    const erreurs = [];
    let puissance = _nombre(puissanceWc);
    if (puissance === null || puissance <= 0) puissance = null;

    for (const [cle, regle] of Object.entries(bornes.champs)) {
        if (!(cle in params)) continue;
        if ('siChamp' in regle && params[regle.siChamp] !== regle.siValeur) continue;
        let maxEffectif = regle.max ?? null;
        if ('maxChamp' in regle) {
            maxEffectif = _nombre(params[regle.maxChamp]);
        } else if ('maxParWc' in regle) {
            if (puissance === null) maxEffectif = null;
            else {
                const facteur = typeof regle.maxParWc === 'string' ? _nombre(params[regle.maxParWc]) : _nombre(regle.maxParWc);
                maxEffectif = facteur !== null ? facteur * puissance : null;
            }
        }
        const message = _verifier(params[cle], regle, regle.libelle, maxEffectif);
        if (message) erreurs.push({ cle, message, inputId: regle.inputId });
    }

    const inflation = params.inflation_grid_price;
    if (inflation !== undefined && inflation !== null) {
        const regle = bornes.inflation_grid_price;
        if (typeof inflation !== 'object' || Array.isArray(inflation)) {
            erreurs.push({ cle: 'inflation_grid_price', message: `[${regle.libelle}] format invalide.` });
        } else {
            for (const [profil, valeur] of Object.entries(inflation)) {
                const message = _verifier(valeur, regle, `${regle.libelle} - ${profil} (%)`, regle.max);
                if (message) erreurs.push({ cle: `inflation_grid_price.${profil}`, message });
            }
        }
    }

    const participants = params.participants;
    if (participants !== undefined && participants !== null) {
        const regle = bornes.prix_participant;
        if (typeof participants !== 'object' || Array.isArray(participants) || Object.keys(participants).length > MAX_PARTICIPANTS) {
            erreurs.push({ cle: 'participants', message: '[Participants] format invalide.' });
        } else {
            for (const [nom, prix] of Object.entries(participants)) {
                if (!prix || typeof prix !== 'object' || Array.isArray(prix)) {
                    erreurs.push({ cle: `participants.${nom}`, message: `[Participant ${nom}] format invalide.` });
                    continue;
                }
                for (const [cle, intitule] of [['prix_achat', "Prix d'achat réseau"], ['prix_vente_interne', 'Prix de vente interne ACC']]) {
                    if (cle in prix) {
                        const message = _verifier(prix[cle], regle, `${intitule} - ${nom} (€/kWh)`, regle.max);
                        if (message) erreurs.push({ cle: `participants.${nom}.${cle}`, message });
                    }
                }
            }
        }
    }
    return erreurs;
}

/**
 * Pose les attributs min/max des champs des modales (aide à la saisie : flèches du navigateur).
 * Les bornes relatives (maxChamp, maxParWc) ne sont contrôlées qu'à la validation.
 */
export function appliquerBornesAuxChamps(bornes = (typeof window !== 'undefined' ? window.ACC_ECO_BORNES : null)) {
    if (!bornes || !bornes.champs) return;
    const poser = (input, regle) => {
        if (!input) return;
        if (regle.min !== undefined && regle.min !== null) input.min = String(regle.min);
        if (regle.max !== undefined && regle.max !== null) input.max = String(regle.max);
    };
    Object.values(bornes.champs).forEach((regle) => poser(regle.inputId && document.getElementById(regle.inputId), regle));
    document.querySelectorAll('[id^="eco_inflation_grid_price_"]').forEach((input) => poser(input, bornes.inflation_grid_price));
    document.querySelectorAll('#economic-params-modal .profil-prix-achat, #economic-params-modal .profil-prix-vente, '
        + '#economic-params-modal .prix-achat-input, #economic-params-modal .prix-vente-interne-input')
        .forEach((input) => poser(input, bornes.prix_participant));
}
