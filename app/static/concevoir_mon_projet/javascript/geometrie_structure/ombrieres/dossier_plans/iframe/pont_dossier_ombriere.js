/**
 * Pont entre un configurateur d'ombrière (métal, bois ou Solumbra, cette iframe) et le dossier de
 * plans « Ombrières » de la page parente (ombrieres/dossier_plans/OmbriereDossierModal.js).
 *
 * Le dossier couvre toutes les ombrières du projet : la page parente charge chaque configurateur
 * dans une iframe HORS ÉCRAN (ChargeurConfigurateur.js), l'alimente comme le fait le modal de
 * géométrie, puis appelle directement window.OmbriereDossierPont (même origine) :
 *  - pret()          : attend la fin du démarrage (restauration des réglages, profil du terrain)
 *                      puis force un redessin complet ;
 *  - resume()        : libellés et valeurs lus dans le configurateur (tableau géométrie) ;
 *  - capturerPlans() : entités vectorielles {coupe, facade} (mètres, Y vers le haut), mêmes
 *                      fonctions de dessin que l'écran, rejouées par enregistreur_vectoriel.js.
 */
(function () {
    'use strict';

    const pvId = new URLSearchParams(window.location.search).get('pvId') || 'PV1';
    const TYPES = { metal: 'Ombrière métal', bois: 'Ombrière bois', solumbra: 'Ombrière Solumbra' };

    const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

    async function attendreQue(condition, delaiMaxMs, pasMs = 100) {
        const fin = Date.now() + delaiMaxMs;
        while (Date.now() < fin) {
            try { if (condition()) return true; } catch (e) { /* configurateur pas encore prêt */ }
            await attendre(pasMs);
        }
        return false;
    }

    /**
     * Prêt quand : fonctions de dessin exposées, restauration interne terminée (~1,5 s après le
     * chargement, cf. storage_manager_geometrie_structure.js), profil du terrain chargé. Puis un
     * redessin complet, pour que coupe et façade reflètent les valeurs injectées par la page.
     */
    async function pret({ delaiMaxMs = 15000 } = {}) {
        const debut = Date.now();
        const reste = () => Math.max(0, delaiMaxMs - (Date.now() - debut));
        if (!await attendreQue(() => window.__ombriereExports, reste())) return false;
        await attendreQue(() => {
            const m = window.geometrieStructureStorageManager;
            return !m || (m.initialRestoreDone && !m.isRestoring);
        }, reste());
        await attendre(150);
        await attendreQue(() => !(window.TerrainPlans && window.TerrainPlans.enChargement && window.TerrainPlans.enChargement()), reste(), 200);
        await window.__ombriereExports.redessiner();
        const exp = window.__ombriereExports;
        return !!(exp.coupeViewManager && exp.coupeViewManager._lastValues);
    }

    function texteBoutonActif(groupeId) {
        const b = document.querySelector(`#${groupeId} button.active`);
        return b ? b.textContent.replace(/\s+/g, ' ').trim() : '';
    }

    function valeur(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }

    function resume() {
        const exp = window.__ombriereExports || {};
        const st = exp.appState || {};
        const distances = Array.isArray(st.parsedDistances) ? st.parsedDistances.filter((d) => Number(d) > 0) : [];
        return {
            pvId,
            type: TYPES[exp.type] || 'Ombrière',
            modele: texteBoutonActif('model-btn-group'),
            nbTravees: distances.length || null,
            entraxes: distances.map(Number),
            valeurs: {
                roofSlope: valeur('roofSlope'),
                lowPointHeight: valeur('lowPointHeight'),
                passageHeight: valeur('passageHeight'),
                postHeight: valeur('postHeight'),
                panelWidth: valeur('panelWidth'),
                facadeLength: valeur('facadeLength'),
                pvLayout: valeur('pvLayout'),
                postDistances: valeur('postDistances'),
                leftOverhang: valeur('leftOverhang'),
                rightOverhang: valeur('rightOverhang'),
                anchorDepth: valeur('anchorDepth'),
            },
        };
    }

    function capturerPlans() {
        const vect = window.EnregistreurVectoriel;
        const exp = window.__ombriereExports;
        if (!vect || !exp) throw new Error("Plans indisponibles : le configurateur n'est pas encore chargé.");
        const plan = (dessin, gestionnaire) => {
            if (!gestionnaire || !gestionnaire._lastValues) return null;
            try {
                return vect.captureDxfEntities(dessin, gestionnaire._lastValues);
            } catch (e) {
                console.warn(`[Dossier ombrières] ${pvId} : plan indisponible`, e);
                return null;
            }
        };
        return { coupe: plan(exp.drawCoupe, exp.coupeViewManager), facade: plan(exp.drawFacade, exp.facadeViewManager) };
    }

    window.OmbriereDossierPont = { pvId, pret, resume, capturerPlans };
})();
