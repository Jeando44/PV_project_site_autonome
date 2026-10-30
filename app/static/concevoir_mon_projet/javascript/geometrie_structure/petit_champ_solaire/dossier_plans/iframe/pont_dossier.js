/**
 * Pont entre le configurateur « Petit champ solaire » (cette iframe) et le modal « Dossier de plans »
 * qui vit dans la page parente (dossier_plans/PetitChampDossierModal.js).
 *
 * Le modal ne peut pas vivre ici : les pièces du dossier dépendent de la carte, du module 3D, du
 * calepinage et des résultats « Calculer », tous dans la page parente. L'iframe est de même
 * origine : la page parente appelle directement window.PetitChampDossierPont (via
 * iframe.contentWindow) pour lire les saisies et capturer les plans vectoriels.
 *
 *  - #openDossierPlansBtn : demande l'ouverture du modal (postMessage, action 'ouvrirDossierPetitChamp') ;
 *  - #exportPlanMasseDxfBtn : demande l'export DXF du plan de masse (postMessage, action
 *                          'exporterPlanDeMasseDxf'), généré et téléchargé par la page parente
 *                          (export_plans_pdf_dxf/PlanDeMassePont.js) ;
 *  - instantane()        : TOUTES les saisies courantes (y compris les champs recopiés du calepinage,
 *                          que la persistance exclut), validées côté serveur avant génération ;
 *  - resume()            : libellés lisibles (modèle, ancrage...) pour la page de présentation ;
 *  - capturerPlans()     : entités vectorielles {coupe, facade, coupeDetail, fondation} (mètres,
 *                          Y vers le haut).
 */
(function () {
    'use strict';

    const pvId = new URLSearchParams(window.location.search).get('pvId') || 'PV1';

    function texteBoutonActif(groupeId) {
        const b = document.querySelector(`#${groupeId} button.active`);
        return b ? b.textContent.replace(/\s+/g, ' ').trim() : '';
    }

    function valeur(id) {
        const el = document.getElementById(id);
        return el ? el.value : '';
    }

    function instantane() {
        const m = window.geometrieStructureStorageManager;
        const base = m ? m.collectData() : { fields: {}, activeButtons: [] };
        document.querySelectorAll('.all-inputs').forEach((el) => {
            if (!el.id || base.fields[el.id]) return;
            base.fields[el.id] = el.type === 'checkbox'
                ? { type: 'checkbox', value: el.checked }
                : { type: el.type || 'text', value: el.value };
        });
        return base;
    }

    function resume() {
        const exp = window.__petitChampSolaireExports;
        const st = exp && exp.appState ? exp.appState : {};
        return {
            pvId,
            modele: texteBoutonActif('model-btn-group'),
            ancrage: texteBoutonActif('anchor-system-group') || 'Béton',
            configurationBeton: texteBoutonActif('foundation-config-group'),
            positionBeton: texteBoutonActif('foundation-position-group'),
            orientationPanneaux: texteBoutonActif('panelOrientationGroup'),
            anchorSystem: st.anchorSystem || 'beton',
            valeurs: {
                roofSlope: valeur('roofSlope'),
                lowPointHeight: valeur('lowPointHeight'),
                postHeight: valeur('postHeight'),
                passageHeight: valeur('passageHeight'),
                panelWidth: valeur('panelWidth'),
                facadeLength: valeur('facadeLength'),
                pvLayout: valeur('pvLayout'),
                nbShed: valeur('nbShed'),
                nbShedGroups: valeur('nbShedGroups'),
                nbPanelsRampant: valeur('nbPanelsRampant'),
                shedSpacing: valeur('shedSpacing'),
                facadeEntraxe: valeur('facadeEntraxe'),
                petitPanelLengthMm: valeur('petitPanelLengthMm'),
                petitPanelWidthMm: valeur('petitPanelWidthMm'),
                petitPanelThicknessMm: valeur('petitPanelThicknessMm'),
                anchorDepth: valeur('anchorDepth'),
                foundationLength: valeur('foundationLength'),
                foundationWidth: valeur('foundationWidth'),
                foundationDepth: valeur('foundationDepth'),
                foundationOverhang: valeur('foundationOverhang'),
                foundationBuryLevel: valeur('foundationBuryLevel'),
                visDepth: valeur('visDepth'),
            },
        };
    }

    /** Emprise (mètres) des entités [debut, fin[ — celles d'un ancrage. */
    function emprise(entites, debut, fin) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = debut; i < fin; i++) {
            const e = entites[i];
            const pts = e.type === 'LWPOLYLINE' ? e.points : [{ x: e.x, y: e.y }];
            pts.forEach((p) => {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            });
        }
        return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    }

    /**
     * Coupe capturée une seconde fois, fondations forcées visibles, en repérant les entités émises
     * par chaque appel de drawAnchor (fonction globale de petit_champ_solaire_poteau_fondations.js,
     * appelée par son nom depuis drawAnchorBehindPost/InFrontOfPost) : l'emprise du PREMIER ancrage
     * donne la fenêtre du zoom « fondations ». Le dessin lui-même n'est pas dupliqué.
     */
    function capturerFondation(exp, vect) {
        const original = window.drawAnchor;
        if (typeof original !== 'function' || !exp.coupeViewManager || !exp.coupeViewManager._lastValues) return null;
        const marques = [];
        const etatAvant = exp.appState.showFoundation;
        window.drawAnchor = function (ctx, ...rest) {
            const debut = ctx && Array.isArray(ctx.entities) ? ctx.entities.length : -1;
            const r = original.call(this, ctx, ...rest);
            if (debut >= 0) marques.push([debut, ctx.entities.length]);
            return r;
        };
        exp.appState.showFoundation = true;
        try {
            const entites = vect.withDimensionsForced(exp.appState,
                () => vect.captureDxfEntities(exp.drawCoupe, exp.coupeViewManager._lastValues));
            const marque = marques.find(([d, f]) => f > d);
            const fenetre = marque ? emprise(entites, marque[0], marque[1]) : null;
            return fenetre ? { entites, ancrage: fenetre } : null;
        } finally {
            window.drawAnchor = original;
            exp.appState.showFoundation = etatAvant;
        }
    }

    // Cadrage du détail autour d'un shed (m) : place des cotes verticales à gauche/droite, du repère
    // de pente au-dessus, de l'ancrage et d'un peu de terrain en dessous.
    const MARGE_DETAIL = { x: 0.9, bas: 0.35, haut: 0.9 };

    function empriseCalques(entites, calques) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        entites.forEach((e) => {
            if (e.type !== 'LWPOLYLINE' || !calques.includes(e.layer)) return;
            e.points.forEach((p) => {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            });
        });
        return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    }

    /**
     * Détail de la coupe (demande explicite : « un plan de coupe plus grand avec une autre échelle
     * afin de voir les détails », au 1/20 ou 1/30) : la coupe rejouée pour UN SEUL shed, fondations
     * visibles, toutes les cotes du shed forcées sauf les limites de parcelle (placées loin du shed,
     * elles imposeraient une petite échelle). Renvoie aussi la fenêtre (mètres) à dessiner :
     * structure + panneaux + premier ancrage, avec leurs marges ; les cotes générales placées plus
     * haut (largeur projetée, espacement) restent sur la coupe d'ensemble.
     */
    function capturerCoupeDetail(exp, vect) {
        if (!exp.coupeViewManager || !exp.coupeViewManager._lastValues) return null;
        const st = exp.appState;
        const drapeaux = { showDimensions: true, showHeightHelperDims: true, showAltimetryDims: true, showParcelLimitDims: false, showFoundation: true };
        const sauve = {};
        Object.keys(drapeaux).forEach((k) => { sauve[k] = st[k]; st[k] = drapeaux[k]; });
        const original = window.drawAnchor;
        const marques = [];
        if (typeof original === 'function') {
            window.drawAnchor = function (ctx, ...rest) {
                const debut = ctx && Array.isArray(ctx.entities) ? ctx.entities.length : -1;
                const r = original.call(this, ctx, ...rest);
                if (debut >= 0) marques.push([debut, ctx.entities.length]);
                return r;
            };
        }
        let entites;
        try {
            entites = vect.captureDxfEntities(exp.drawCoupe, { ...exp.coupeViewManager._lastValues, nbShed: 1 });
        } finally {
            if (typeof original === 'function') window.drawAnchor = original;
            Object.keys(drapeaux).forEach((k) => { st[k] = sauve[k]; });
        }
        const coeur = empriseCalques(entites, ['STRUCTURE', 'PANNEAUX']);
        if (!coeur) return null;
        marques.filter(([d, f]) => f > d).forEach(([d, f]) => {
            const a = emprise(entites, d, f);
            if (!a) return;
            coeur.minX = Math.min(coeur.minX, a.minX); coeur.maxX = Math.max(coeur.maxX, a.maxX);
            coeur.minY = Math.min(coeur.minY, a.minY); coeur.maxY = Math.max(coeur.maxY, a.maxY);
        });
        return {
            entites,
            fenetre: {
                minX: coeur.minX - MARGE_DETAIL.x, maxX: coeur.maxX + MARGE_DETAIL.x,
                minY: coeur.minY - MARGE_DETAIL.bas, maxY: coeur.maxY + MARGE_DETAIL.haut,
            },
        };
    }

    function capturerPlans() {
        const vect = window.PetitChampExportVectoriel;
        const exp = window.__petitChampSolaireExports;
        if (!vect || !exp) throw new Error("Plans indisponibles : le configurateur n'est pas encore chargé.");
        const violation = window.PetitChampValidation && window.PetitChampValidation.premiereViolation();
        if (violation) throw new Error(`Saisie invalide dans le configurateur : ${violation.message}`);
        const { coupe, facade } = vect.captureEntities();
        let coupeDetail = null;
        try {
            coupeDetail = capturerCoupeDetail(exp, vect);
        } catch (e) {
            console.warn('[Dossier petit champ] Détail de coupe indisponible :', e);
        }
        return { coupe: coupe || null, facade: facade || null, coupeDetail, fondation: capturerFondation(exp, vect) };
    }

    /** Contrôle complet des saisies (mêmes règles que le serveur) : liste de messages. */
    function valider() {
        const v = window.PetitChampValidation;
        if (!v) return [];
        const violation = v.premiereViolation();
        const erreurs = v.valider(instantane());
        // Mêmes messages de part et d'autre (même fonction de borne) : dédoublonnage exact.
        if (violation) erreurs.unshift(violation.message.replace(/ Veuillez saisir une nouvelle valeur\.$/, ''));
        return [...new Set(erreurs)];
    }

    function ouvrirDossier() {
        window.parent.postMessage({ action: 'ouvrirDossierPetitChamp', pvId }, window.location.origin);
    }

    // ------------------------------------------------------------------------------------------
    // Export DXF du plan de masse (bouton #exportPlanMasseDxfBtn)
    //
    // Même plan que l'onglet « Plan de masse » du modal « Exporter les plans en PDF et DXF » : la
    // génération a lieu dans la page parente (elle seule a la carte, drawingControl et
    // CalepinageMaisonPlans), qui télécharge le ZIP et renvoie ici l'avancement — cf.
    // export_plans_pdf_dxf/PlanDeMassePont.js. Le configurateur peut être ouvert depuis une page
    // sans ce pont : l'absence d'accusé de réception le signale au lieu de laisser tourner.
    // ------------------------------------------------------------------------------------------
    const ACTION_MASSE = 'exporterPlanDeMasseDxf';
    const ACTION_MASSE_RETOUR = 'exporterPlanDeMasseDxfRetour';
    const DELAI_ACCUSE_MS = 8000;

    function exporterPlanDeMasse(btn, statutEl) {
        const afficher = (message, erreur) => {
            if (!statutEl) return;
            statutEl.textContent = message;
            statutEl.style.color = erreur ? '#dc2626' : '#64748b';
        };
        const terminer = (message, erreur) => {
            window.removeEventListener('message', surRetour);
            clearTimeout(minuterie);
            btn.disabled = false;
            afficher(message, erreur);
        };

        function surRetour(event) {
            if (event.origin !== window.location.origin || event.source !== window.parent) return;
            const d = event.data;
            if (!d || d.action !== ACTION_MASSE_RETOUR) return;
            if (d.etat === 'demarre') { clearTimeout(minuterie); return; }
            if (d.etat === 'progression') { afficher(d.message, false); return; }
            terminer(d.message, d.etat === 'erreur');
        }

        btn.disabled = true;
        afficher('Génération du DXF en cours...', false);
        const minuterie = setTimeout(
            () => terminer("Export indisponible ici : ouvrez le configurateur depuis la page de la carte.", true),
            DELAI_ACCUSE_MS,
        );
        window.addEventListener('message', surRetour);
        // Pas de pvId : le plan de masse couvre TOUT le projet, pas le champ en cours de configuration.
        window.parent.postMessage({ action: ACTION_MASSE, indice: 'A' }, window.location.origin);
    }

    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('openDossierPlansBtn');
        if (btn) btn.addEventListener('click', ouvrirDossier);

        const btnMasse = document.getElementById('exportPlanMasseDxfBtn');
        if (btnMasse) {
            const statutEl = document.getElementById('exportPlanMasseDxfStatut');
            btnMasse.addEventListener('click', () => exporterPlanDeMasse(btnMasse, statutEl));
        }
    });

    window.PetitChampDossierPont = { pvId, instantane, resume, capturerPlans, valider };
})();
