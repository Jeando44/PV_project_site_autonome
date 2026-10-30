/**
 * Module PAC / climatiseur — contrôle des calculs (même principe que Irve/verification_irve.js).
 * ============================================================================================
 * Après chaque calcul affiché, ses ENTRÉES et ses RÉSULTATS sont envoyés au calcul de référence
 * (POST .../api/pac/verification/simulation | rentabilite) qui le refait et compare valeur par
 * valeur. Au-delà d'un écart de 0,01, l'appelant remplace ses valeurs par `reference` (et, pour la
 * simulation, par les séries `series`). Une saisie incohérente est refusée (400, message en clair).
 *
 * Point d'entrée : window.PacVerification
 *   verifier(calcul, entrees, navigateur) -> Promise<{ statut: 'conforme'|'ecart'|'refus'|'indisponible',
 *                                                     reference?, series?, nbEcarts?, message? }>
 */
(function (racine) {
    'use strict';

    function prefixeApi() {
        return racine.location && racine.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
    }

    /** Remplace NaN / ±Infinity (non sérialisables en JSON) par null, Float64Array par des tableaux. */
    function enJson(v) {
        return JSON.stringify(v, (k, x) => {
            if (typeof x === 'number' && !Number.isFinite(x)) return null;
            if (ArrayBuffer.isView(x)) return Array.from(x);
            return x;
        });
    }

    async function verifier(calcul, entrees, navigateur) {
        let rep;
        try {
            rep = await fetch(`${prefixeApi()}/api/pac/verification/${calcul}`, {
                method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                body: enJson({ entrees, navigateur }),
            });
        } catch (e) {
            return { statut: 'indisponible', message: 'Contrôle des calculs momentanément indisponible.' };
        }
        const d = await rep.json().catch(() => ({}));
        if (rep.status === 400) return { statut: 'refus', message: d.error || 'Saisie incohérente.' };
        if (!rep.ok || !d.success) return { statut: 'indisponible', message: d.error || 'Contrôle des calculs momentanément indisponible.' };
        if (!d.conforme) console.warn(`[PacVerification] ${calcul} : ${d.nb_ecarts} écart(s)`, d.ecarts);
        return d.conforme
            ? { statut: 'conforme', reference: d.reference }
            : { statut: 'ecart', reference: d.reference, series: d.series || null, nbEcarts: d.nb_ecarts || 0 };
    }

    const api = { verifier, enJson };
    racine.PacVerification = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
