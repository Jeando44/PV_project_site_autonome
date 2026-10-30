/**
 * Persistance de la Loi APER EN BASE (routes /parametre-projet/<id>/loi-aper/load|save,
 * app/routes/loi_aper_routes.py) : polygones (surfaces + / exclusions -) et variables
 * « % Solarisable APER / Huwart » (valeur + libellé), par projet et variante active.
 *
 * Remplace l'ancienne clé localStorage "aperPolygonsData" (et "solarProjectStable" de l'ancienne
 * fenêtre loiAperModal.js) : à l'ouverture d'un projet, c'est la base qui fournit les données
 * affichées ; ces clés ne sont plus que purgées (viderCacheLocal), jamais relues.
 * L'orchestration (quand charger, quand enregistrer, garde de projet) est dans calcul_APER.js.
 */
(function () {
    const CLES_LOCALES_OBSOLETES = ['aperPolygonsData', 'solarProjectStable'];
    const base = (projetId) => `/concevoir_mon_projet/parametre-projet/${encodeURIComponent(projetId)}/loi-aper`;

    async function lireJson(reponse) {
        try {
            return await reponse.json();
        } catch (e) {
            return { success: false, message: `Réponse invalide du serveur (HTTP ${reponse.status})` };
        }
    }

    /** Saisies APER enregistrées du projet : {success, config, polygones, surfaceProjetee, ...}. */
    async function charger(projetId) {
        try {
            const reponse = await fetch(`${base(projetId)}/load`, { cache: 'no-store' });
            return await lireJson(reponse);
        } catch (e) {
            console.warn('AperPersistence: lecture impossible', e);
            return { success: false, message: String(e) };
        }
    }

    /** payload : {polygones: {surface, exclusion}, variables: {solarisableAper, solarisableHuwart}}. */
    async function enregistrer(projetId, payload) {
        try {
            const reponse = await fetch(`${base(projetId)}/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const res = await lireJson(reponse);
            return { ...res, status: reponse.status };
        } catch (e) {
            console.warn('AperPersistence: enregistrement impossible', e);
            return { success: false, message: String(e) };
        }
    }

    function contour(poly) {
        return poly.getPath().getArray().map((p) => ({ lat: p.lat(), lng: p.lng() }));
    }

    function extrairePolygones(manager) {
        if (!manager) return { surface: [], exclusion: [] };
        return {
            surface: manager.surfacePolygons.map(contour),
            exclusion: manager.exclusionPolygons.map(contour),
        };
    }

    function poserPolygones(manager, polygones) {
        if (!manager || !polygones) return;
        ['surface', 'exclusion'].forEach((type) => {
            (polygones[type] || []).forEach((points) => {
                if (!Array.isArray(points) || points.length < 3) return;
                const poly = new google.maps.Polygon({ paths: points, map: manager.map });
                manager._initPolygon(poly, type);
            });
        });
        manager.clearSelection();
        manager.detectOverlaps();
    }

    function viderCacheLocal() {
        CLES_LOCALES_OBSOLETES.forEach((cle) => {
            try { localStorage.removeItem(cle); } catch (e) { /* stockage indisponible */ }
        });
    }

    window.AperPersistence = {
        charger, enregistrer, extrairePolygones, poserPolygones, viderCacheLocal,
        CLES_LOCALES_OBSOLETES,
    };
})();
