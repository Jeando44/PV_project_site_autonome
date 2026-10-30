/**
 * Intègre le modal Autoconsommation existant (iframe, cf. index_autoconso.html /
 * main_autoconso.js) à l'intérieur de la vue résidentielle du modal Études économiques
 * (#resi-autoconso-anchor, créée par ResidentielEtudeEcoView.js::mountAutoconsoSection()).
 *
 * Points d'entrée, appelés depuis le modal Calepinage Maison (calepinage_maison_formulaires.js) :
 *   - window.cmOpenAutoconsoResults(hideCallerModal, showCallerModal) — bouton "Calculer et
 *     visualiser". showCallerModal est rappelé à la fermeture du modal Études économiques (cf.
 *     wrapCloseEtudesEconomiqueModal) pour revenir sur le modal Calepinage Maison.
 *   - window.cmDownloadAutoconsoRapport() — bouton "Télécharger le rapport".
 *
 * Zéro modification du moteur Autoconsommation partagé (main_autoconso.js), utilisé aussi par le
 * parcours Pro/Grand-projet : on réutilise tel quel son mode "embedded" existant (?autoOpen=true),
 * et on masque nous-mêmes le panneau de formulaire gauche (.left-panel) en injectant une feuille
 * de style DANS le document de l'iframe après chargement (accès direct autorisé : même origine,
 * même app Flask) — aucun fichier CSS/JS partagé n'est modifié. Le calcul est déclenché par un
 * appel direct iframe.contentWindow.calculate() (même origine ; cette fonction est exposée sur
 * window par main_autoconso.js) plutôt qu'un nouveau protocole postMessage à maintenir.
 *
 * window.AUTOCONSO_URL doit être défini par le template (cf. etudes_economique_content.html) —
 * un fichier JS statique ne peut pas faire {{ url_for(...) }} lui-même.
 *
 * Chargé en type="module" (contrairement au reste de ce fichier, sinon du JS classique) uniquement
 * pour l'import ES ci-dessous — nécessaire à window.cmDownloadAutoconsoRapport() (demande
 * explicite : "Télécharger le rapport" doit lancer le rapport PDF global du projet, pas seulement
 * l'export propre à l'autoconsommation), qui appelle le même service singleton que le bouton
 * "Rapport projet" du calepinage (cf. ButtonControl.js), depuis LA PAGE PARENTE (pas l'iframe).
 */
import ExportService from '../../services/ExportService.js?v=12';

(function () {
    'use strict';

    let autoconsoIframe = null;
    let autoconsoIframeReady = false;
    // Rappelée par wrapCloseEtudesEconomiqueModal() quand l'utilisateur ferme le modal Études
    // économiques — remet le modal Calepinage Maison à l'écran (demande explicite : "en fermant le
    // modal on doit revenir sur le modal principal du calepinage").
    let pendingRestoreCallerModal = null;

    function isResidentielTypologie() {
        return window.isResidentialPath();
    }

    /**
     * Enveloppe UNE SEULE FOIS la MÉTHODE window.etudesEconomiqueModal.close() (l'instance
     * singleton créée par EtudesEconomiqueModal.js, non modifiée) — PAS la fonction libre
     * window.closeEtudesEconomiqueModal(). CORRECTIF (bug rapporté : "la fermeture du modal Études
     * économiques ne ramène pas sur le calepinage") : le bouton "×" et le clic sur le fond
     * (menu.html) sont attachés via addEventListener(closeEtudesEconomiqueModal) AU CHARGEMENT DE
     * LA PAGE — ils capturent cette fonction PAR RÉFÉRENCE à ce moment-là. Réaffecter
     * window.closeEtudesEconomiqueModal plus tard (comme le faisait l'ancienne version de ce
     * correctif) ne change donc RIEN pour ces écouteurs déjà enregistrés, qui continuent d'appeler
     * l'ancienne fonction. instance.close() est en revanche un appel de méthode (obj.method()) :
     * la propriété est relue sur l'objet à CHAQUE appel, donc écraser cette propriété une seule
     * fois ici est vu par TOUS les appelants (bouton, fond, la fonction libre elle-même, qui
     * appelle instance.close() en interne), quel que soit le moment où ils ont été enregistrés.
     */
    function wrapCloseEtudesEconomiqueModal() {
        const instance = window.etudesEconomiqueModal;
        if (!instance || typeof instance.close !== 'function' || instance.close.__autoconsoEmbedWrapped) return;
        const originalClose = instance.close.bind(instance);
        instance.close = function (...args) {
            const result = originalClose(...args);
            if (typeof pendingRestoreCallerModal === 'function') {
                const restore = pendingRestoreCallerModal;
                pendingRestoreCallerModal = null;
                restore();
            }
            return result;
        };
        instance.close.__autoconsoEmbedWrapped = true;
    }

    /** Masque le panneau de formulaire gauche du modal Autoconsommation embarqué — ne garde que les résultats. */
    function injectResultsOnlyStyle(iframeDoc) {
        if (iframeDoc.getElementById('resi-autoconso-embed-style')) return;
        const style = iframeDoc.createElement('style');
        style.id = 'resi-autoconso-embed-style';
        style.textContent = `
            .left-panel { display: none !important; }
            .app-content { grid-template-columns: 1fr !important; }
        `;
        iframeDoc.head.appendChild(style);
    }

    // =============================================================================================
    // CORRECTIF (bug rapporté : "je modifie le calepinage résidentiel, je clique sur Calculer et
    // visualiser, cela ne marche pas — et je n'ai pas d'autre bouton pour lancer le calcul").
    // Causes identifiées, toutes SILENCIEUSES (aucun message à l'écran) :
    //  1. Vue résidentielle absente : ResidentielEtudeEcoView.init() ne tournait qu'une fois au
    //     chargement de la page, si le projet actif était déjà résidentiel -> #resi-autoconso-anchor
    //     introuvable, simple console.warn, alors que le modal Calepinage était déjà masqué.
    //  2. Iframe « fantôme » : la référence mémorisée n'était jamais revérifiée ; une iframe
    //     détachée du document (ou pas encore prête : `calculate` non exposé) ignorait l'appel.
    //  3. Clic pendant le chargement de l'iframe (autoconsoIframeReady=false) : ignoré ; seul le
    //     calcul automatique au 'load' partait, sans garantie de refléter le dernier calepinage.
    //  4. Champs PV périmés : avant de calculer, l'iframe relit solarProjectData.calculatedPvs, que
    //     SEUL le résumé "Système" (SummaryModal) réécrit à partir du calepinage résidentiel — et
    //     cette instance n'existe que sur la page Calepinage (carte). Depuis Géométrie, Système,
    //     Export, APER..., le calcul partait donc sur l'ancien calepinage ; son cache (empreinte
    //     identique) réaffichait l'ancien résultat : « rien ne se passe ».
    // Désormais : chaque clic resynchronise les champs PV, attend que l'iframe soit prête (délai
    // borné), lance UN calcul (des clics pendant un calcul sont regroupés en une relance à la fin),
    // et affiche un message clair si quelque chose l'en empêche.
    // =============================================================================================

    const DELAI_MAX_IFRAME_MS = 20000;
    let calculEnCours = false;
    let relanceDemandee = false;

    function iframeUtilisable() {
        return !!(autoconsoIframe && autoconsoIframe.isConnected && autoconsoIframe.contentWindow);
    }

    // Attend que main_autoconso.js ait exposé window.calculate dans l'iframe (document chargé).
    function attendreIframePrete() {
        return new Promise((resolve) => {
            const debut = Date.now();
            const verifier = () => {
                try {
                    const w = iframeUtilisable() ? autoconsoIframe.contentWindow : null;
                    if (w && typeof w.calculate === 'function' && w.document && w.document.readyState === 'complete') {
                        resolve(true);
                        return;
                    }
                } catch (e) { /* iframe en cours de navigation : on réessaie */ }
                if (Date.now() - debut > DELAI_MAX_IFRAME_MS) { resolve(false); return; }
                setTimeout(verifier, 200);
            };
            verifier();
        });
    }

    /**
     * Réécrit solarProjectData.calculatedPvs à partir du calepinage résidentiel ACTUEL, dans la page
     * parente, juste avant le calcul (cf. cause 4 ci-dessus).
     *  - Page Calepinage : le résumé "Système" existe -> sa propre méthode (même calcul que le bouton
     *    Système, totaux compris).
     *  - Autres pages : remplacement ciblé des seules entrées résidentielles (reconnaissables à leur
     *    `sourceId`, cf. CM.getAllPvFieldSummaries) ; les champs Pro/Grand-projet éventuels sont
     *    conservés tels quels.
     */
    function synchroniserChampsPvDepuisCalepinage() {
        try {
            const sm = window.summaryModalInstance;
            if (sm && typeof sm.refreshFromStorage === 'function') {
                sm.refreshFromStorage();
                return;
            }
            const CM = window.CalepinageMaisonIndiv;
            if (!CM || typeof CM.getAllPvFieldSummaries !== 'function') return;
            const maisons = CM.getAllPvFieldSummaries() || [];
            const data = JSON.parse(localStorage.getItem('solarProjectData') || '{}') || {};
            const autres = (Array.isArray(data.calculatedPvs) ? data.calculatedPvs : []).filter((pv) => !(pv && pv.sourceId));
            data.calculatedPvs = autres.concat(maisons);
            if (typeof CM.attachShadingSceneToProjectData === 'function') CM.attachShadingSceneToProjectData(data);
            data.totals = Object.assign({}, data.totals, { lastUpdated: new Date().toISOString() });
            localStorage.setItem('solarProjectData', JSON.stringify(data));
        } catch (e) {
            console.warn('[ResidentielAutoconsoEmbed] Synchronisation des champs PV impossible :', e);
        }
    }

    function afficherMessageAncre(texte, estErreur) {
        const section = document.getElementById('resi-autoconso-section');
        if (!section) return;
        let el = document.getElementById('resi-autoconso-status');
        if (!el) {
            el = document.createElement('div');
            el.id = 'resi-autoconso-status';
            el.style.cssText = 'margin:6px 0 10px; font-size:0.9em;';
            const anchor = document.getElementById('resi-autoconso-anchor');
            section.insertBefore(el, anchor || null);
        }
        el.style.color = estErreur ? '#b91c1c' : 'var(--text-secondary, #666)';
        el.textContent = texte || '';
        el.style.display = texte ? 'block' : 'none';
    }

    async function runCalculation() {
        if (calculEnCours) {
            // Clic pendant un calcul : une seule relance, avec l'état du calepinage à ce moment-là.
            relanceDemandee = true;
            afficherMessageAncre('Calcul en cours… il sera relancé avec vos dernières modifications.', false);
            return;
        }
        calculEnCours = true;
        try {
            do {
                relanceDemandee = false;
                afficherMessageAncre("Préparation du calcul d'autoconsommation…", false);
                const prete = await attendreIframePrete();
                if (!prete) {
                    afficherMessageAncre("Le module d'autoconsommation ne s'est pas chargé (réseau ?). Fermez cette fenêtre puis recliquez sur « Calculer et visualiser ».", true);
                    // Iframe défaillante : elle sera recréée au prochain clic.
                    if (autoconsoIframe && autoconsoIframe.parentNode) autoconsoIframe.parentNode.removeChild(autoconsoIframe);
                    autoconsoIframe = null;
                    autoconsoIframeReady = false;
                    return;
                }
                // Même marge que l'ancien lancement au 'load' : main_autoconso.js n'affiche son panneau
                // (openModal) que 100 ms après son chargement ; des graphiques créés avant seraient 0x0.
                await new Promise((r) => setTimeout(r, 300));
                synchroniserChampsPvDepuisCalepinage();
                afficherMessageAncre('', false);
                watchForSharedSolarProduction();
                await autoconsoIframe.contentWindow.calculate();
            } while (relanceDemandee);
        } catch (e) {
            console.warn("[ResidentielAutoconsoEmbed] Impossible de déclencher le calcul dans l'iframe Autoconsommation :", e);
            afficherMessageAncre("Le calcul n'a pas pu être lancé : " + (e && e.message ? e.message : e), true);
        } finally {
            calculEnCours = false;
        }
    }

    /**
     * CORRECTIF (analyse demandée : "le champ Productible ne s'affiche toujours pas, donc le
     * calcul étude éco ne peut pas être lancé") : main_autoconso.js écrit
     * localStorage.sharedSolarProduction une fois SON calcul terminé (appel réseau asynchrone,
     * durée variable) et compte sur l'évènement 'storage' pour rafraîchir automatiquement
     * EtudesEconomiqueModal dans la fenêtre parente. Deux problèmes concrets avec ce seul
     * mécanisme dans ce nouveau parcours embarqué : (1) pure question de timing — si l'utilisateur
     * clique sur "Lancer le calcul" (étude éco) avant que le calcul d'autoconsommation dans
     * l'iframe n'ait fini de répondre, Productible est encore vide/à 0 à ce moment précis ; (2) le
     * calepinage résidentiel n'alimente jamais solarProjectData.shapes/formData (stockage
     * CalepinageMaison séparé), donc AUCUN repli n'existe si le calcul de l'iframe n'a jamais
     * abouti — contrairement au Pro/Grand-projet, où d'autres sources peuvent compenser un
     * évènement 'storage' manqué. On appelle donc ICI, en plus (pas à la place) du mécanisme
     * existant, updateFields() de façon déterministe dès que sharedSolarProduction apparaît/change
     * — pas d'attente aveugle d'une durée fixe.
     */
    function watchForSharedSolarProduction() {
        const previousValue = localStorage.getItem('sharedSolarProduction');
        let attempts = 0;
        const maxAttempts = 40; // 40 x 500ms = 20s max — au-delà, le calcul a probablement échoué.
        const intervalId = setInterval(() => {
            attempts++;
            const currentValue = localStorage.getItem('sharedSolarProduction');
            const changed = currentValue && currentValue !== previousValue;
            if (changed || attempts >= maxAttempts) {
                clearInterval(intervalId);
                if (changed && window.ReferenceProSolaire) window.ReferenceProSolaire.charger();
                if (changed && window.etudesEconomiqueModal
                    && typeof window.etudesEconomiqueModal.loadDataFromLocalStorage === 'function') {
                    window.etudesEconomiqueModal.loadDataFromLocalStorage();
                }
            }
        }, 500);
    }

    // NOUVEAU (demande explicite : "fermer le modal Calepinage Maison avant de générer le rapport
    // résidentiel — actuellement il est capturé en capture d'écran dans le rapport —, laisser voir
    // la progression, puis revenir dessus quand l'utilisateur ferme le viewer du rapport") :
    // ExportService.exportPDF() capture document.body en entier (html2canvas) sans exclure le
    // modal Calepinage Maison (contrairement à d'autres modals qu'il exclut déjà explicitement) —
    // le fermer avant l'appel est donc la seule option, sans toucher à ExportService.js (partagé
    // avec le bouton "Rapport projet" Pro/Grand-projet, cf. ButtonControl.js — CE bouton-ci ne doit
    // rien changer à ce workflow). ExportService n'a pas de hook dédié pour "l'utilisateur a fermé
    // le viewer du rapport" (preview() construit son propre modal PDF, fermé via #close-preview-btn
    // qui appelle this.reset() dans tous les cas de sortie, Fermer ET Télécharger) — on enveloppe
    // donc cette méthode UNE SEULE FOIS, exactement comme wrapCloseEtudesEconomiqueModal() plus
    // haut, et on ne réagit que si CE bouton a effectivement déclenché la génération en cours.
    //
    // ÉTENDU (demande explicite : "Placer également le bouton Télécharger le rapport dans le modal
    // éco... assurez-vous que le modal eco soit fermé afin que la capture d'écran ne prenne pas le
    // modal éco y compris le modal de calepinage") : le rapport peut désormais être déclenché
    // depuis DEUX endroits (bouton dans Calepinage Maison OU nouveau bouton dans le modal Études
    // économiques résidentiel, cf. ResidentielEtudeEcoView.js). Les DEUX modals sont donc masqués
    // avant la capture, mais seulement s'ils sont RÉELLEMENT visibles au moment du clic (sinon on
    // rouvrirait après coup un modal que l'utilisateur n'avait jamais ouvert). Le modal Études
    // économiques est masqué par simple bascule de display (PAS instance.close()) pour ne pas
    // déclencher le rappel pendingRestoreCallerModal de wrapCloseEtudesEconomiqueModal() ci-dessus
    // (qui ramènerait à tort sur Calepinage Maison au lieu de rouvrir Études économiques).
    let pendingReopenCalepinageMaison = false;
    let pendingReopenEtudesEco = false;

    function isCalepinageMaisonVisible() {
        const modal = window.CalepinageMaisonIndiv && window.CalepinageMaisonIndiv.modal;
        return !!(modal && modal.style.display !== 'none');
    }

    function isEtudesEconomiqueModalVisible() {
        const modal = document.getElementById('etudes-economique-modal');
        return !!(modal && modal.style.display && modal.style.display !== 'none');
    }

    function hideEtudesEconomiqueModalForScreenshot() {
        const modal = document.getElementById('etudes-economique-modal');
        const backdrop = document.getElementById('etudes-economique-backdrop');
        if (modal) modal.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
    }

    function wrapExportServiceReset(exportServiceInstance) {
        if (typeof exportServiceInstance.reset !== 'function' || exportServiceInstance.reset.__cmReopenWrapped) return;
        const originalReset = exportServiceInstance.reset.bind(exportServiceInstance);
        exportServiceInstance.reset = function (...args) {
            const result = originalReset(...args);
            if (pendingReopenEtudesEco) {
                pendingReopenEtudesEco = false;
                if (window.etudesEconomiqueModal && typeof window.etudesEconomiqueModal.open === 'function') {
                    window.etudesEconomiqueModal.open();
                }
            }
            if (pendingReopenCalepinageMaison) {
                pendingReopenCalepinageMaison = false;
                if (window.CalepinageMaisonIndiv && typeof window.CalepinageMaisonIndiv.showModalAfterHide === 'function') {
                    window.CalepinageMaisonIndiv.showModalAfterHide();
                }
            }
            return result;
        };
        exportServiceInstance.reset.__cmReopenWrapped = true;
    }

    /**
     * CORRECTIF (demande explicite : "le bouton Télécharger le rapport doit lancer la génération
     * du rapport global pour les projets résidentiels") : appelait auparavant exportToPDFJS() DANS
     * l'iframe Autoconsommation (export limité aux graphiques d'autoconsommation). Appelle
     * désormais ExportService.getInstance().exportPDF() — le MÊME service singleton que le bouton
     * "Rapport projet" du calepinage (cf. ButtonControl.js), qui compose le rapport complet
     * (infos projet, système, calepinage, graphiques, production, autoconsommation, étude
     * économique, glossaire + pages résidentielles dédiées via PdfResidentialReportGenerator).
     * Appelé depuis LA PAGE PARENTE (pas l'iframe) — ExportService tourne côté page principale.
     * Partagée par les deux boutons "Télécharger le rapport" (Calepinage Maison ET Études
     * économiques, cf. commentaire ci-dessus) — chacun peut être visible sans l'autre.
     */
    window.cmDownloadAutoconsoRapport = function () {
        try {
            const exportServiceInstance = ExportService.getInstance();

            if (isResidentielTypologie()) {
                wrapExportServiceReset(exportServiceInstance);

                if (isEtudesEconomiqueModalVisible()) {
                    hideEtudesEconomiqueModalForScreenshot();
                    pendingReopenEtudesEco = true;
                }

                if (isCalepinageMaisonVisible() && typeof window.CalepinageMaisonIndiv.closeModal === 'function') {
                    window.CalepinageMaisonIndiv.closeModal();
                    pendingReopenCalepinageMaison = true;
                }
            }

            exportServiceInstance.exportPDF();
        } catch (e) {
            console.warn('[ResidentielAutoconsoEmbed] Échec du téléchargement du rapport :', e);
        }
    };

    function createAutoconsoIframe(anchor) {
        anchor.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.id = 'resi-autoconso-iframe';
        iframe.style.cssText = 'width:100%; min-height:1000px; border:none; display:block;';

        iframe.addEventListener('load', () => {
            try {
                injectResultsOnlyStyle(iframe.contentDocument);
            } catch (e) {
                console.warn("[ResidentielAutoconsoEmbed] Injection du style échouée :", e);
            }
            autoconsoIframeReady = true;
            // Le calcul n'est plus lancé ici avec un délai fixe : runCalculation() (appelé par
            // cmOpenAutoconsoResults à CHAQUE clic) attend lui-même que l'iframe soit prête.
        });

        anchor.appendChild(iframe);

        if (!window.AUTOCONSO_URL) {
            console.warn('[ResidentielAutoconsoEmbed] window.AUTOCONSO_URL non défini (cf. etudes_economique_content.html).');
            return iframe;
        }
        const url = new URL(window.AUTOCONSO_URL, window.location.href);
        url.searchParams.set('autoOpen', 'true');
        iframe.src = url.href;
        return iframe;
    }

    /**
     * @param {Function} [hideCallerModal] callback synchrone masquant le modal appelant (ex.
     *   closeModal() de calepinage_maison_formulaires.js) — nécessaire car le modal Études
     *   économiques a un z-index plus bas que le modal Calepinage Maison et s'afficherait donc
     *   dessous sans ça.
     * @param {Function} [showCallerModal] callback symétrique, rappelé quand l'utilisateur ferme le
     *   modal Études économiques (cf. wrapCloseEtudesEconomiqueModal ci-dessus).
     */
    window.cmOpenAutoconsoResults = function (hideCallerModal, showCallerModal) {
        if (!isResidentielTypologie()) {
            alert('« Calculer et visualiser » est réservé aux projets de typologie résidentielle.');
            return;
        }
        // Prérequis vérifiés AVANT de masquer le modal Calepinage (auparavant masqué d'abord : en
        // cas d'échec, l'utilisateur se retrouvait sans résultat ni retour possible).
        if (typeof window.openEtudesEconomiqueModal !== 'function') {
            console.warn('[ResidentielAutoconsoEmbed] openEtudesEconomiqueModal() indisponible.');
            alert("Le module Études économiques n'est pas chargé sur cette page : rechargez la page (F5) puis relancez le calcul.");
            return;
        }
        // Vue résidentielle construite à la demande si elle ne l'a pas été au chargement (cause 1).
        if (!document.getElementById('resi-autoconso-anchor')
            && window.ResidentielEtudeEcoView && typeof window.ResidentielEtudeEcoView.ensureInit === 'function') {
            window.ResidentielEtudeEcoView.ensureInit();
        }

        if (typeof hideCallerModal === 'function') hideCallerModal();
        if (typeof showCallerModal === 'function') {
            wrapCloseEtudesEconomiqueModal();
            pendingRestoreCallerModal = showCallerModal;
        }

        window.openEtudesEconomiqueModal();

        const anchor = document.getElementById('resi-autoconso-anchor');
        if (!anchor) {
            console.warn('[ResidentielAutoconsoEmbed] #resi-autoconso-anchor introuvable (ResidentielEtudeEcoView.js pas encore initialisé ?).');
            alert("La vue résidentielle des Études économiques n'a pas pu être préparée : rechargez la page (F5) puis relancez le calcul.");
            return;
        }

        // Iframe absente, détachée du document ou rattachée à une autre ancre : recréée (cause 2).
        if (!iframeUtilisable() || !anchor.contains(autoconsoIframe)) {
            autoconsoIframeReady = false;
            autoconsoIframe = createAutoconsoIframe(anchor);
        }
        // Dans TOUS les cas (iframe neuve, en chargement ou prête) le calcul est lancé, après attente
        // de la disponibilité de l'iframe et resynchronisation des champs PV (causes 3 et 4).
        runCalculation();

        const section = document.getElementById('resi-autoconso-section');
        if (section && section.scrollIntoView) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };
})();
