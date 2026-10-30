/**
 * Résumé de pré-dimensionnement « site isolé », partagé entre écrans.
 * ============================================================================
 * Le calcul vit dans le modal de consommation d'énergie (page Flask indépendante
 * /concevoir_mon_projet/bd-materiels-irve, cf. Irve/autonomyCalculator.js) : il interroge le backend
 * (/api/consommation/calculer_autonomie) et publie son résultat. Deux écrans d'une AUTRE page en ont
 * besoin, sans partager la moindre variable JS avec lui :
 *
 *   - la carte « Total » du calepinage maison, qui affiche le taux de couverture PV réel et doit le
 *     réactualiser à chaque panneau ajouté/retiré (donc lecture SYNCHRONE, sans appel réseau) ;
 *   - le modal Études économiques, qui reprend la consommation annuelle du site et ce même taux.
 *
 * D'où deux niveaux : un cache localStorage scopé par projet (lecture instantanée) et la base
 * (via le payload IRVE), seule persistance fiable d'un navigateur/poste à l'autre.
 *
 * Chargé par parametre.html, inclus dans toutes les pages du module — les deux consommateurs y ont
 * donc accès sans import.
 */
(function () {
    const STORAGE_PREFIX = 'skv_site_autonomy_summary';

    function storageKey() {
        const projectId = localStorage.getItem('current_projet_id') || 'no-project';
        return `${STORAGE_PREFIX}_${projectId}`;
    }

    /** Lecture synchrone du cache local. Retourne null si aucun calcul d'autonomie n'a été fait. */
    function read() {
        try {
            const raw = localStorage.getItem(storageKey());
            if (!raw) return null;
            const summary = JSON.parse(raw);
            return summary && summary.puissancePvNecessaireKwc > 0 ? summary : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Lecture complète : cache local, sinon base (configuration IRVE du projet). Le résultat
     * rapatrié est remis en cache pour que les lectures synchrones suivantes l'aient sous la main.
     */
    async function load() {
        const cached = read();
        if (cached) return cached;

        const projetId = localStorage.getItem('current_projet_id');
        if (!projetId) return null;
        try {
            const res = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/irve/load`);
            const json = await res.json();
            const summary = json && json.config && json.config.data && json.config.data.autonomySummary;
            if (!summary || !(summary.puissancePvNecessaireKwc > 0)) return null;
            try {
                localStorage.setItem(storageKey(), JSON.stringify(summary));
            } catch (e) { /* cache best-effort */ }
            return summary;
        } catch (e) {
            console.warn('[SiteAutonomySummary] Lecture en base impossible :', e);
            return null;
        }
    }

    /**
     * Taux de couverture photovoltaïque (%) — base ÉNERGÉTIQUE :
     *
     *     production annuelle PV (kWh, calculée par le back-end)
     *     ──────────────────────────────────────────  × 100
     *     besoin annuel d'énergie du site (kWh)
     *
     * REMPLACE (demande explicite) un rapport de PUISSANCES (kWc installés / kWc nécessaires), qui
     * était un taux purement théorique : deux installations de même puissance ne produisent pas la
     * même énergie dès que l'orientation, l'inclinaison ou les masques diffèrent. Passer par
     * l'énergie réellement produite prépare l'intégration à venir des pertes d'ombrage : le jour où
     * le calcul de production les prendra en compte, ce taux en tiendra compte automatiquement,
     * sans rien changer ici.
     *
     * Volontairement NON plafonné à 100 % : une production supérieure au besoin annuel est une
     * information utile (surdimensionnement, excédent à valoriser ou à stocker), pas une erreur à
     * masquer. À lire comme un bilan ANNUEL : il ne dit pas que le site est autonome à chaque
     * instant — c'est le rôle du dimensionnement batterie.
     *
     * @param {number} productionAnnuelleKwh - production PV annuelle calculée par le back-end
     * @param {object} [summary] - résumé déjà lu (évite une relecture du cache)
     * @returns {number|null} le taux en %, ou null si le besoin annuel du site n'est pas connu
     */
    function coverageRateFromEnergyPct(productionAnnuelleKwh, summary) {
        const s = summary || read();
        if (!s || !(s.consommationAnnuelleKwh > 0)) return null;
        const production = Number(productionAnnuelleKwh);
        if (!isFinite(production) || production < 0) return null;
        return (production / s.consommationAnnuelleKwh) * 100;
    }

    window.SiteAutonomySummary = { read, load, coverageRateFromEnergyPct, storageKey };
})();
