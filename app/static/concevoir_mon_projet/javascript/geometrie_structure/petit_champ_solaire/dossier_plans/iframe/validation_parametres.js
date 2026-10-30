/**
 * Validation front du configurateur « Petit champ solaire » — miroir de
 * app/services/petit_champ_solaire/validation.py, à partir des MÊMES bornes (limites.json, injecté
 * par le template dans window.PETIT_CHAMP_LIMITES). Script classique chargé dans l'iframe du
 * configurateur, AVANT petit_champ_solaire.js.
 *
 * Expose window.PetitChampValidation :
 *   - premiereViolation()     -> {el, message} | null : 1re saisie hors bornes du formulaire affiché
 *                               (appelée par getFieldRangeViolation(), avant tout dessin) ;
 *   - valider(parametres)     -> [messages] : contrôle complet d'un paramétrage collecté
 *                               (format GeometrieStructureStorageManager.collectData()) ;
 *   - analyserPvLayout(texte).
 * Rejet strict, jamais de correction silencieuse de la saisie.
 */
(function () {
    'use strict';

    const LIMITES = window.PETIT_CHAMP_LIMITES;
    if (!LIMITES || !LIMITES.champs) {
        console.warn('[PetitChampValidation] Limites absentes : validation front désactivée.');
        return;
    }

    // Validés par une logique dédiée de petit_champ_solaire.js (bornes dépendantes du modèle).
    const CHAMPS_LOGIQUE_DEDIEE = new Set(['postSpacing']);
    const NOMBRE = /^-?\d+(?:[.,]\d+)?$/;
    const PV_LAYOUT = /^\s*(?:(\d+)\s*L\s*[x×]\s*(\d+)\s*C|(\d+)\s*C\s*[x×]\s*(\d+)\s*L|(\d+)\s*[x×]\s*(\d+))\s*$/i;

    const calcules = Object.fromEntries(Object.entries(LIMITES.champsCalcules || {}).filter(([k]) => !k.startsWith('_')));

    function nombre(valeur) {
        if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null;
        if (typeof valeur !== 'string' || !NOMBRE.test(valeur.trim())) return null;
        return parseFloat(valeur.trim().replace(',', '.'));
    }

    const fmt = (v) => String(Math.round(v * 1000) / 1000);

    function erreurBorne(v, regle) {
        if (regle.entier && !Number.isInteger(v)) return `${regle.libelle} : un nombre entier est attendu.`;
        if (v < regle.min || v > regle.max) {
            return `${regle.libelle} : la valeur ${fmt(v)} doit être comprise entre ${fmt(regle.min)} et ${fmt(regle.max)}.`;
        }
        return null;
    }

    function analyserPvLayout(texte) {
        const f = LIMITES.formats.pvLayout;
        const m = typeof texte === 'string' && texte.length <= 40 ? PV_LAYOUT.exec(texte) : null;
        if (!m) return { erreur: `${f.libelle} : format attendu « 2L x 6C » (L = lignes, C = colonnes).` };
        const lignes = parseInt(m[1] || m[4] || m[5], 10);
        const colonnes = parseInt(m[2] || m[3] || m[6], 10);
        if (lignes < f.lignesMin || lignes > f.lignesMax) {
            return { erreur: `${f.libelle} : ${lignes} ligne(s), attendu entre ${f.lignesMin} et ${f.lignesMax}.` };
        }
        if (colonnes < f.colonnesMin || colonnes > f.colonnesMax) {
            return { erreur: `${f.libelle} : ${colonnes} colonne(s), attendu entre ${f.colonnesMin} et ${f.colonnesMax}.` };
        }
        return { lignes, colonnes };
    }

    // NB : « Entraxes poteaux » (#postDistances) n'est volontairement PAS contrôlé : champ masqué et
    // résiduel, les poteaux étant recalculés depuis #facadeEntraxe (cf. validation.py).
    function reglesCroisees(valeurs) {
        const erreurs = [];
        if (valeurs.passageHeight != null && valeurs.heightUnderBrace > 0 && valeurs.heightUnderBrace >= valeurs.passageHeight) {
            erreurs.push('La hauteur sous renfort doit être inférieure à la hauteur libre de passage.');
        }
        return erreurs;
    }

    /** Contrôle complet d'un paramétrage collecté ({fields, activeButtons}). */
    function valider(parametres) {
        const erreurs = [];
        const champs = (parametres && parametres.fields) || {};
        const valeurs = {};
        Object.entries(champs).forEach(([id, info]) => {
            if (!info || info.type === 'checkbox' || info.value === '' || info.value == null) return;
            const regle = LIMITES.champs[id] || calcules[id];
            if (regle) {
                const v = nombre(info.value);
                if (v === null) { erreurs.push(`${regle.libelle} : valeur numérique attendue.`); return; }
                const e = erreurBorne(v, regle);
                if (e) erreurs.push(e); else valeurs[id] = v;
            } else if (id === 'pvLayout') {
                const r = analyserPvLayout(info.value);
                if (r.erreur) erreurs.push(r.erreur);
            }
        });
        return erreurs.concat(reglesCroisees(valeurs));
    }

    function visible(el) {
        return el && el.offsetParent !== null;
    }

    /**
     * 1re violation du formulaire affiché, au format attendu par showFieldViolationModal(). Seuls
     * les champs SAISIS sont bloquants (un champ calculé en lecture seule ne peut pas être
     * « corrigé » par l'utilisateur) ; les champs masqués (modèle non choisi) sont ignorés.
     */
    function premiereViolation() {
        for (const [id, regle] of Object.entries(LIMITES.champs)) {
            if (CHAMPS_LOGIQUE_DEDIEE.has(id)) continue;
            const el = document.getElementById(id);
            if (!visible(el) || el.readOnly || el.value === '') continue;
            const v = nombre(el.value);
            if (v === null) return { el, message: `${regle.libelle} : valeur numérique attendue. Veuillez saisir une nouvelle valeur.` };
            const e = erreurBorne(v, regle);
            if (e) return { el, message: `${e} Veuillez saisir une nouvelle valeur.` };
        }
        const layout = document.getElementById('pvLayout');
        if (visible(layout) && !layout.readOnly && layout.value.trim() !== '') {
            const r = analyserPvLayout(layout.value);
            if (r.erreur) return { el: layout, message: `${r.erreur} Veuillez saisir une nouvelle valeur.` };
        }
        return null;
    }

    /** Aligne les attributs min/max/step des champs sur limites.json (source unique). */
    function appliquerAttributs() {
        Object.entries({ ...LIMITES.champs, ...calcules }).forEach(([id, regle]) => {
            const el = document.getElementById(id);
            if (!el || el.type !== 'number') return;
            el.min = regle.min;
            el.max = regle.max;
            if (regle.entier) el.step = 1;
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appliquerAttributs);
    else appliquerAttributs();

    window.PetitChampValidation = { premiereViolation, valider, analyserPvLayout, limites: LIMITES };
})();
