/**
 * Vérification des calculs IRVE (bilan de puissance, énergie consommée, Batterie & Éco, rentabilité).
 * ======================================================================================
 * Le calcul du navigateur est affiché immédiatement ; ses entrées et ses résultats sont ensuite
 * envoyés à .../api/irve/verification/<calcul> qui refait le calcul de référence et compare chaque
 * valeur. Au-delà d'un écart de 0,01, l'appelant remplace ses valeurs par `reference`.
 * Messages affichés : sans nom d'outil ni lieu de calcul.
 *
 * Point d'entrée : window.VerificationIrve
 */
(function () {
    'use strict';

    const URL_BASE = '/concevoir_mon_projet/api/irve/verification/';
    const sequences = {};

    /**
     * Vérifie un calcul. Renvoie { conforme, reference, nbEcarts } ou null (vérification
     * indisponible, ou réponse périmée car un calcul plus récent du même type a été lancé).
     */
    async function verifier(calcul, corps) {
        const numero = (sequences[calcul] = (sequences[calcul] || 0) + 1);
        try {
            const r = await fetch(URL_BASE + calcul, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(corps),
            });
            const d = await r.json();
            if (numero !== sequences[calcul]) return null;
            if (!r.ok || !d.success) {
                console.warn(`[VerificationIrve] ${calcul} :`, d.message || r.status);
                return { indisponible: true, message: d.message || '' };
            }
            if (d.verifiable === false) return { indisponible: true, message: d.message || '' };
            if (!d.conforme) console.warn(`[VerificationIrve] ${calcul} : ${d.nb_ecarts} écart(s)`, d.ecarts);
            return { conforme: !!d.conforme, reference: d.reference, nbEcarts: d.nb_ecarts || 0 };
        } catch (e) {
            if (numero !== sequences[calcul]) return null;
            console.warn(`[VerificationIrve] ${calcul} :`, e);
            return { indisponible: true, message: '' };
        }
    }

    /** Élément de statut (créé au besoin) placé juste après `ancre`. */
    function statut(ancre, id) {
        let el = document.getElementById(id);
        if (!el && ancre && ancre.parentNode) {
            el = document.createElement('div');
            el.id = id;
            el.setAttribute('role', 'status');
            el.style.cssText = 'font-size:0.8rem; margin:6px 0; text-align:center;';
            ancre.parentNode.insertBefore(el, ancre.nextSibling);
        }
        return el;
    }

    /** Affiche l'issue d'une vérification dans l'élément de statut. */
    function afficher(el, verif) {
        if (!el || !verif) return;
        if (verif.indisponible) {
            el.style.color = '#b45309';
            el.textContent = `Vérification des résultats indisponible${verif.message ? ` (${verif.message})` : ''} : résultats non vérifiés.`;
        } else if (verif.conforme) {
            el.style.color = 'var(--accent-green, #15803d)';
            el.textContent = '✔ Résultats vérifiés.';
        } else {
            el.style.color = 'var(--danger-color, #b91c1c)';
            el.textContent = `⚠ Écart de calcul détecté (${verif.nbEcarts} valeur${verif.nbEcarts > 1 ? 's' : ''}) : valeurs de référence appliquées.`;
        }
    }

    window.VerificationIrve = { verifier, statut, afficher };
})();
