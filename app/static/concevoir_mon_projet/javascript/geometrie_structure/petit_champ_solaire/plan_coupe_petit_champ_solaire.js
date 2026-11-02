// ============================================================================================
// Export PDF (A3 vectoriel) et DXF des plans de coupe et de façade (petit champ solaire)
// ============================================================================================
// Principe : plutôt que dupliquer la géométrie (déjà calculée dans drawCoupe/drawFacade, dans
// petit_champ_solaire.js, et qui évolue régulièrement), on rejoue ces MÊMES fonctions de dessin
// avec un faux "contexte canvas" qui, au lieu de peindre des pixels, enregistre chaque primitive
// (ligne, rectangle, texte) avec ses coordonnées absolues déjà transformées (translate/rotate/
// scale/save-restore appliqués comme le ferait un vrai canvas). Le résultat (une liste de
// primitives vectorielles, en mètres réels) est envoyé au backend Flask (/api/export_dxf/petit_champ_solaire
// ou /api/export_pdf/petit_champ_solaire selon le bouton cliqué), qui se contente de le mettre en
// page (cadre/cartouche/échelle) et de le formater (ezdxf ou ReportLab) — aucune géométrie n'est
// recalculée côté serveur, dans les deux cas.
//
// Fichier autonome : ne modifie ni ne redéfinit rien de petit_champ_solaire.js. Ce dernier
// expose uniquement `window.__petitChampSolaireExports = { drawCoupe, drawFacade,
// coupeViewManager, facadeViewManager }` (les variables de ce fichier vivent dans une closure
// DOMContentLoaded distincte, inaccessibles autrement) et, ligne par ligne à l'intérieur de
// drawCoupe/drawFacade, `if (window.__dxfCapture) window.__dxfCapture.scale = scale;` — seul
// moyen de récupérer le facteur d'échelle interne (px/mètre) sans redupliquer sa formule.

(function () {
    'use strict';

    // Enregistreur vectoriel (contexte canvas factice, conversion en mètres) : extrait dans
    // geometrie_structure/enregistreur_vectoriel.js, partagé avec les configurateurs d'ombrière.
    const { captureDxfEntities } = window.EnregistreurVectoriel;

    function triggerBlobDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Un export CAO doit toujours montrer TOUTES les cotations (verticales, horizontales, hauteurs,
    // repères altimétriques, limite de propriété), indépendamment des boutons "Masquer/Afficher"
    // de l'aperçu écran (item 1/2) — ces boutons servent à désencombrer l'aperçu interactif, pas à
    // décider ce qui doit figurer dans un livrable technique. On force ces indicateurs à `true` le
    // temps de la capture, puis on restaure exactement l'état précédent (aucun effet de bord sur
    // l'aperçu affiché après l'export).
    const DXF_FORCE_DIM_FLAGS = ['showDimensions', 'showHeightHelperDims', 'showAltimetryDims', 'showParcelLimitDims'];

    function withDimensionsForced(appState, fn) {
        const saved = {};
        DXF_FORCE_DIM_FLAGS.forEach(k => { saved[k] = appState[k]; appState[k] = true; });
        try {
            return fn();
        } finally {
            DXF_FORCE_DIM_FLAGS.forEach(k => { appState[k] = saved[k]; });
        }
    }

    /** Rejoue coupe+façade et retourne {coupe, facade} (entités déjà en mètres réels, Y vers le haut). */
    function captureEntities() {
        const exportsObj = window.__petitChampSolaireExports;
        if (!exportsObj) {
            throw new Error("Export indisponible : le plan principal n'est pas chargé.");
        }
        const { drawCoupe, drawFacade, coupeViewManager, facadeViewManager, appState } = exportsObj;
        const payload = withDimensionsForced(appState, () => {
            const out = {};
            if (coupeViewManager && coupeViewManager._lastValues) {
                out.coupe = captureDxfEntities(drawCoupe, coupeViewManager._lastValues);
            }
            if (facadeViewManager && facadeViewManager._lastValues) {
                out.facade = captureDxfEntities(drawFacade, facadeViewManager._lastValues);
            }
            return out;
        });
        if (!payload.coupe && !payload.facade) {
            throw new Error("Aucun plan calculé pour le moment.");
        }
        return payload;
    }

    /**
     * Assemble le cartouche (nom projet/entreprise/logo...) via CartoucheData.js -
     * import dynamique par chemin ABSOLU : ce fichier est un script classique (pas
     * type="module"), et import() y résout les chemins relatifs contre l'URL de la
     * PAGE, pas celle du script - un chemin relatif serait donc faux ici.
     */
    async function gatherCartouche(nomPlan, indice) {
        const { default: CartoucheData } = await import('/concevoir_mon_projet/static/concevoir_mon_projet/javascript/export_plans_pdf_dxf/utils/CartoucheData.js');
        const cartouche = await CartoucheData.build({ nomPlan, indice, scale: null });
        if (!cartouche) {
            throw new Error("Projet introuvable. Sélectionnez un projet avant l'export.");
        }
        return {
            nom_projet: cartouche.nom_projet,
            nom_plan: cartouche.nom_plan,
            indice: cartouche.indice,
            date: cartouche.date,
            adresse: cartouche.adresse,
            company_name: cartouche.company_name,
            company_logo: cartouche.company_logo,
        };
    }

    async function runExport(btn, { url, filename, kind }) {
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `Génération ${kind}...`;
        try {
            const entities = captureEntities();
            const cartouche = await gatherCartouche('Petit champ solaire', 'A');
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entities, cartouche }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Échec de la génération ${kind} (HTTP ${res.status})`);
            }
            const blob = await res.blob();
            triggerBlobDownload(blob, filename);
        } catch (e) {
            console.error(`[PetitChampSolaire] Export ${kind} échoué:`, e);
            alert(`Erreur lors de l'export ${kind} : ` + e.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    // Réutilisé par le dossier de plans (dossier_plans/iframe/pont_dossier.js) : mêmes entités
    // vectorielles que les exports PDF/DXF ci-dessous.
    window.PetitChampExportVectoriel = { captureEntities, captureDxfEntities, withDimensionsForced };

    document.addEventListener('DOMContentLoaded', () => {
        const dxfBtn = document.getElementById('exportDxfBtn');
        if (dxfBtn) {
            dxfBtn.addEventListener('click', () => runExport(dxfBtn, {
                url: '/concevoir_mon_projet/api/export_dxf/petit_champ_solaire', filename: 'petit_champ_solaire_dxf.zip', kind: 'DXF',
            }));
        }

        const pdfBtn = document.getElementById('exportVectorPdfBtn');
        if (pdfBtn) {
            pdfBtn.addEventListener('click', () => runExport(pdfBtn, {
                url: '/concevoir_mon_projet/api/export_pdf/petit_champ_solaire', filename: 'petit_champ_solaire.pdf', kind: 'PDF',
            }));
        }
    });
})();
