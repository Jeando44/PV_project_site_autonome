// Importation des fonctions spécifiques à l'ACC
import { renderAccConsumersInput, populateEconomicModal, updateKeysTotal, accConsFiles, resetAccDefaultPrices, restoreAccFilesFromIDB } from './main_acc.js?v=2';
import { renderEconomicAnalysis, applyDashboardVisibility } from './main_rentabilite.js';
import { verifierParametresEcoAcc, appliquerBornesAuxChamps } from './acc_eco_validation.js';
import { saveFileToIDB, getFileFromIDB, deleteFileFromIDB, saveToLS, loadFromLS, restoreConsFileFromDBIfMissing, getProjetIdActif, MARQUEUR_COURBES_MODIFIEES } from './persistence.js';
import { renderAciConsumerInput, renderPvInput, fetchSharedIrveCurve, fetchSharedPacCurve, pacCombineeChoisie } from '../Irve/irve_consumption_import.js?v=8';
import { lireEnergiesCourbeAci, comparerAuTableau } from './energie_courbe_import.js';

// Initialisation des variables globales
let monthlyChart = null;
const individualCharts = [];
let storageChart = null;
let simulationResults = null;
let pvFileObject = null; // Stocke l'objet File pour la production PV (ACI)
let consFileObject = null; // Stocke l'objet File pour la consommation (3 courbes)
// NOUVEAU: Vrai pendant qu'un calcul est en cours. refreshCalepinageDataBeforeCalc() déclenche une
// sauvegarde sur la fenêtre parente (SummaryModal.forceUpdate), qui écrit dans le localStorage et
// déclenche donc un événement 'storage' dans CETTE fenêtre (iframe) — sans ce garde-fou, le calcul
// se retrouvait "auto-invalidé" en plein milieu de son propre déroulement.
let isCalculatingResults = false;
// Restauration de l'état persisté (initPersistence(), asynchrone) : attendue par calculate().
let persistenceRestauree = Promise.resolve();
// NOUVEAU: Instance Chart.js du graphique P50/P90 (conservée pour être mise à jour en direct,
// sans réinstancier ni rappeler le backend, quand l'utilisateur modifie l'incertitude/dégradation).
let p50p90Chart = null;
// NOUVEAU: Production annuelle de base (An 1, MWh, sans dégradation ni incertitude), telle que
// calculée par le backend lors du dernier calcul — sert de point de départ au recalcul P50/P90
// côté front (cf. recomputeP50P90FromInputs()). Le calcul backend (calcul_vente_totalite.py)
// reste la source de vérité utilisée pour le rapport PDF.
let p50p90BaseProdMwh = null;

// Résultats repris par l'étude économique (puissance, productible, taux d'autoconsommation, parts
// hiver/été) : enregistrés PAR LE SERVEUR à chaque calcul (cf. app/services/resultats_prodsolaire.py).
// Un résultat en cache n'est réaffiché sans appel serveur que si ce calcul précis est déjà enregistré
// pour le projet actif (marqueurs ci-dessous) ; des résultats remis à 0 sont retirés de la base.
const MARQUEUR_SIM_ENREGISTRE = 'solar_sim_enregistre';
const MARQUEUR_STOCKAGE_ENREGISTRE = 'solar_storage_enregistre';

function empreinteCourte(texte) {
    let h = 5381;
    for (let i = 0; i < texte.length; i++) h = ((h << 5) + h + texte.charCodeAt(i)) | 0;
    return `${texte.length}:${(h >>> 0).toString(36)}`;
}

function marqueurEnregistrement(signature) {
    const projetId = getProjetIdActif();
    return projetId && signature ? `${projetId}|${empreinteCourte(signature)}` : null;
}

function calculEnregistre(cle, signature) {
    const marqueur = marqueurEnregistrement(signature);
    return !!marqueur && localStorage.getItem(cle) === marqueur;
}

function noterEnregistrement(cle, signature, enregistre) {
    const marqueur = enregistre ? marqueurEnregistrement(signature) : null;
    if (marqueur) localStorage.setItem(cle, marqueur);
    else localStorage.removeItem(cle);
}

/** Prévient la modale « Études économiques » (fenêtre parente) que les résultats ont changé. */
function signalerResultatsProSolaire() {
    const fenetres = [window];
    try { if (window.parent && window.parent !== window) fenetres.push(window.parent); } catch (e) { /* autre origine */ }
    fenetres.forEach((w) => {
        try { w.dispatchEvent(new w.CustomEvent('resultatsProSolaireModifies')); } catch (e) { /* noop */ }
    });
}

/**
 * « Intégration du stockage » Oui/Non : le stockage déjà calculé entre dans l'étude économique
 * seulement s'il est affiché dans les résultats (avant : l'étude gardait le taux PV + batterie alors
 * que les résultats affichaient le taux PV seul). Seul l'état affiché est transmis, aucune valeur.
 */
function synchroniserStockageAffiche() {
    const projetId = getProjetIdActif();
    if (!projetId || !window.storageResults?.outputs) return Promise.resolve();
    const toggle = document.querySelector('input[name="storage-toggle"]:checked');
    const affiche = !!(toggle && toggle.value === 'oui' && stockagePrisEnCompte());
    return fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/resultats-prodsolaire/stockage-affiche`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ affiche }),
    }).catch((e) => console.warn('[autoconso] État du stockage non transmis :', e))
        .finally(signalerResultatsProSolaire);
}

/** Résultats remis à 0 (partie = 'stockage' : seul le stockage est retiré). */
function retirerResultatsProSolaireEnregistres(partie) {
    localStorage.removeItem(MARQUEUR_STOCKAGE_ENREGISTRE);
    if (partie !== 'stockage') localStorage.removeItem(MARQUEUR_SIM_ENREGISTRE);
    const projetId = getProjetIdActif();
    if (!projetId) return Promise.resolve();
    const suffixe = partie === 'stockage' ? '?partie=stockage' : '';
    return fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/resultats-prodsolaire${suffixe}`, { method: 'DELETE' })
        .catch((e) => console.warn('[autoconso] Retrait des résultats enregistrés impossible :', e))
        .finally(signalerResultatsProSolaire);
}

// NOUVEAU: Synchronisation en direct du taux de dégradation avec le champ #degradation du
// module d'étude économique (etudes_economique_content.html) — ce module tourne dans la
// fenêtre parente (cette page est chargée dans un iframe), donc l'événement "storage" s'y
// déclenche dès que l'un des deux modules écrit sharedDegradationRate dans le localStorage.
window.addEventListener('storage', (e) => {
    if (e.key === 'sharedDegradationRate' && e.newValue != null) {
        const input = document.getElementById('vt_degradation');
        if (input && document.activeElement !== input) {
            input.value = e.newValue;
        }
    }
    // NOUVEAU: si le calepinage/système est modifié (autre onglet/fenêtre) pendant que des
    // résultats sont déjà affichés ici, les remettre à 0 pour signaler qu'il faut recalculer.
    // Délai court pour laisser main_prodsolaire.js (écouteur 'storage' séparé) rafraîchir
    // d'abord les .pv-field-card à partir des nouvelles données avant de comparer.
    if (e.key === 'solarProjectData') {
        setTimeout(() => {
            if (!isCalculatingResults && simulationResults && !checkPvDataStillFresh()) {
                // NOUVEAU: mise à jour "douce" (pas de reconstruction du conteneur ni de
                // destroy/recreate des graphiques) pour éviter tout clignotement visuel.
                simulationResults = zeroOutResultsForStaleData(simulationResults);
                softZeroOutDisplayedResults();
                retirerResultatsProSolaireEnregistres();
                showMessage("Le calepinage ou le système ont été modifiés depuis le dernier calcul : les résultats affichés sont remis à 0. Relancez le calcul pour les mettre à jour.", 'error', 8000);
            }
        }, 50);
    }
});

// === GESTION DE LA MODALE (DRAG & RESIZE) ===
let modal, header, resizeHandle, backdrop;
let isDragging = false, isResizing = false;
let offsetX, offsetY, startX, startY, startWidth, startHeight;

// Fonction pour assombrir/éclaircir une couleur hexadécimale
const pSBC = (p, c0, c1, l) => {
    let r, g, b, P, f, t, h, i = parseInt, m = Math.round, a = typeof (c1) == "string";
    if (typeof (p) != "number" || p < -1 || p > 1 || typeof (c0) != "string" || (c0[0] != 'r' && c0[0] != '#') || (c1 && !a)) return null;
    if (!window.pSBCr) window.pSBCr = (d) => {
        let n = d.length, x = {};
        if (n > 9) { [r, g, b, a] = d = d.split(","), n = d.length; if (n < 3 || n > 4) return null; x.r = i(r.slice(4)), x.g = i(g), x.b = i(b), x.a = a ? parseFloat(a) : -1 }
        else { if (n == 8 || n == 6 || n < 4) return null; if (n < 6) d = "#" + d[1] + d[1] + d[2] + d[2] + d[3] + d[3] + (n > 4 ? d[4] + d[4] : ""); d = i(d.slice(1), 16); if (n == 9 || n == 5) x.r = d >> 24 & 255, x.g = d >> 16 & 255, x.b = d >> 8 & 255, x.a = m((d & 255) / 0.255) / 1000; else x.r = d >> 16, x.g = d >> 8 & 255, x.b = d & 255, x.a = -1 } return x
    };
    h = c0.length > 9, h = a ? c1.length > 9 ? true : c1 == "c" ? !h : false : h, f = window.pSBCr(c0), P = p < 0, t = c1 && c1 != "c" ? window.pSBCr(c1) : P ? { r: 0, g: 0, b: 0, a: -1 } : { r: 255, g: 255, b: 255, a: -1 }, p = P ? p * -1 : p, P = 1 - p;
    if (!f || !t) return null;
    if (l) r = m(P * f.r + p * t.r), g = m(P * f.g + p * t.g), b = m(P * f.b + p * t.b);
    else r = m((P * f.r ** 2 + p * t.r ** 2) ** 0.5), g = m((P * f.g ** 2 + p * t.g ** 2) ** 0.5), b = m((P * f.b ** 2 + p * t.b ** 2) ** 0.5);
    a = f.a, t = t.a, f = a >= 0 || t >= 0, a = f ? a < 0 ? t : t < 0 ? a : a * P + t * p : 0;
    if (h) return "rgb" + (f ? "a(" : "(") + r + "," + g + "," + b + (f ? "," + m(a * 1000) / 1000 : "") + ")";
    else return "#" + (4294967296 + r * 16777216 + g * 65536 + b * 256 + (f ? m(a * 255) : 0)).toString(16).slice(1, f ? undefined : -2)
};

window.addEventListener('DOMContentLoaded', () => {
    try {
        // Configuration par défaut de Chart.js sécurisée (attend que la librairie soit chargée)
        if (typeof Chart !== 'undefined') {
            Chart.register(ChartDataLabels);
            Chart.defaults.plugins.datalabels.display = false;
            Chart.defaults.font.family = "Inter, sans-serif";
        }
    } catch (e) {
        console.warn("Avertissement Chart.js non prêt : ", e);
    }

    modal = document.getElementById('app-modal');
    backdrop = document.getElementById('modal-backdrop');

    // Détection du mode embedded (chargement dans l'iframe #universal-iframe du modal
    // universel, cf. menu.html : openModalAutoconso() / openPrestations() appellent
    // openUniversalModal(title, url, color) qui ajoute ?autoOpen=true à l'URL de l'iframe).
    // En mode embedded, l'entête et le fond propres à cette modale sont masqués (CSS
    // .embedded-mode) au profit de l'entête commune du modal universel ; le bouton de
    // fermeture interne relaie donc la fermeture au parent via postMessage.
    const urlParams = new URLSearchParams(window.location.search);
    const isEmbeddedMode = urlParams.get('autoOpen') === 'true';
    // Exposé sur window : isEmbeddedMode est local à cette closure DOMContentLoaded, mais
    // displayResults() (module top-level, hors de cette closure) en a besoin (cf. demande
    // explicite : remplacer "Export PDF (JS)" par "Stockage d'énergie" uniquement en mode embarqué).
    window.isEmbeddedMode = isEmbeddedMode;

    if (isEmbeddedMode) {
        document.body.classList.add('embedded-mode');
        if (modal) modal.classList.add('embedded-mode');
        setTimeout(() => openModal(), 100);
    }

    const closeModalBtn = document.getElementById('close-modal-btn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (isEmbeddedMode && window.parent && window.parent !== window) {
                window.parent.postMessage({ action: 'closeModal' }, '*');
            } else if (modal) {
                modal.style.display = 'none';
                if (backdrop) backdrop.style.display = 'none';
            }
        });
    }

    const resetSizeBtn = document.getElementById('reset-size-btn');
    if (resetSizeBtn) {
        resetSizeBtn.addEventListener('click', () => {
            if (!modal) return;
            modal.style.width = '';
            modal.style.height = '';
            modal.style.top = '50%';
            modal.style.left = '50%';
            modal.style.transform = 'translate(-50%, -50%)';
        });
    }

    if (modal) {
        header = modal.querySelector('.modal-header');

        // Ajout de la palette de couleurs
        const colorPickerContainer = document.createElement('div');
        colorPickerContainer.className = 'color-picker-container';
        colorPickerContainer.innerHTML = `
            <div class="color-dot" data-color="#ef4444" style="background-color: #ef4444;" title="Rouge (Défaut)"></div>
            <div class="color-dot" data-color="#3b82f6" style="background-color: #3b82f6;" title="Bleu"></div>
            <div class="color-dot" data-color="#16a34a" style="background-color: #16a34a;" title="Vert"></div>
            <div class="color-dot" data-color="#f97316" style="background-color: #f97316;" title="Orange"></div>
            <input type="color" id="custom-color-picker" value="#ef4444" title="Couleur personnalisée">
        `;
        header.insertBefore(colorPickerContainer, header.querySelector('.header-buttons'));

        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.addEventListener('click', (e) => {
                const color = e.target.dataset.color;
                document.getElementById('custom-color-picker').value = color;
                updateThemeColor(color);
            });
        });

        document.getElementById('custom-color-picker').addEventListener('input', (e) => {
            updateThemeColor(e.target.value);
        });

        const savedColor = localStorage.getItem('themeColor');
        if (savedColor) {
            document.getElementById('custom-color-picker').value = savedColor;
            updateThemeColor(savedColor);
        }

        resizeHandle = document.getElementById('resize-handle');

        // Rendre la modale déplaçable
        if (header) {
            header.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                isDragging = true;
                offsetX = e.clientX - modal.offsetLeft;
                offsetY = e.clientY - modal.offsetTop;
                document.body.style.userSelect = 'none'; // Empêcher la sélection de texte pendant le déplacement
            });
        }

        // Rendre la modale redimensionnable
        if (resizeHandle) {
            resizeHandle.addEventListener('mousedown', (e) => {
                isResizing = true;
                startX = e.clientX;
                startY = e.clientY;
                startWidth = modal.offsetWidth;
                startHeight = modal.offsetHeight;
                document.body.style.userSelect = 'none';
            });
        }
    }

    // Ajout d'un écouteur pour le type d'étude
    document.querySelectorAll('input[name="study_type"]').forEach(radio => {
        radio.addEventListener('change', handleStudyTypeChange);
    });

    // NOUVEAU WORKFLOW (demande explicite) : le "Mode de valorisation de l'électricité" choisi sur
    // la page Paramètres (#mode_de_valorisation, sauvegardé dans solarProjectData.projectInfo.
    // modeDeValorisation par StorageManager.js) doit piloter directement le type d'étude ici, plutôt
    // que de dépendre uniquement du dernier choix manuel fait DANS ce modal (localStorage.studyType,
    // qui ne reflétait jamais ce choix jusqu'ici). Règle métier : "Marché libre" est traité
    // EXACTEMENT comme "Vente en totalité" (même type d'étude, aucune option dédiée côté calcul).
    //
    // SITE AUTONOME (demande explicite : "les données de production ne s'affichent pas pour le site
    // autonome") : un projet "Site autonome ou Projet PV Hybride" choisit son option parmi Système
    // hybride / Pompage solaire / Habitation — aucune ne figurait dans cette table, `derivedStudyType`
    // restait donc null et le type d'étude retombait sur "aci" (valeur cochée par défaut dans le
    // HTML). Or l'autoconsommation individuelle EXIGE une courbe de consommation importée, qu'un
    // site isolé n'a pas : le calcul ne produisait rien. Ces projets sont donc traités comme une
    // "vente en totalité" — même type d'étude côté calcul : production pure, sans courbe de
    // consommation ni ratio d'autoconsommation.
    const MODE_DE_VALORISATION_TO_STUDY_TYPE = {
        'vente en totalité': 'vente_totalite',
        'marché libre': 'vente_totalite',
        'autoconsommation individuelle': 'aci',
        'autoconsommation collective': 'acc',
        'système hybride': 'vente_totalite',
        'pompage solaire': 'vente_totalite',
        'habitation': 'vente_totalite',
    };
    let derivedStudyType = null;
    try {
        // CORRECTIF (import multi-fichiers ACC inaccessible) : la clé lue ici, `modeDeValorisation`,
        // n'est écrite nulle part (StorageManager/ParametresProjet écrivent `mode_de_valorisation`) :
        // le type d'étude n'était jamais dérivé et un projet en autoconsommation collective s'ouvrait
        // sur l'import ACI (un seul fichier). Source autoritaire : le context processor (main.py),
        // republié par index_autoconso.html ; le localStorage reste un repli.
        const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        const projectInfo = savedData.projectInfo || {};
        const modeDeValorisation = (window.ACTIVE_PROJECT_MODE_VALORISATION
            || projectInfo.mode_de_valorisation || projectInfo.modeDeValorisation || '').toLowerCase().trim();
        derivedStudyType = MODE_DE_VALORISATION_TO_STUDY_TYPE[modeDeValorisation]
            || (modeDeValorisation.includes('collective') ? 'acc'
                : (modeDeValorisation.includes('individuelle') ? 'aci' : null));
    } catch (e) {}

    // Filet de sécurité, indépendant du libellé de l'option choisie : dès que le projet actif est
    // hors-ligne (valeur vérifiée en base, exposée par index_autoconso.html), l'étude est de type
    // "vente en totalité". Couvre aussi bien un localStorage vide (page rechargée, autre navigateur)
    // qu'un futur libellé d'option qui ne serait pas encore dans la table ci-dessus.
    if (typeof window.isSiteAutonomeProject === 'function' && window.isSiteAutonomeProject()) {
        derivedStudyType = 'vente_totalite';
    }

    // NOUVEAU: Restaurer le type d'étude — priorité au Mode de valorisation des Paramètres
    // (dérivé ci-dessus), avec repli sur le dernier choix manuel de ce modal si aucun mode de
    // valorisation reconnu n'est disponible (ex. ancien projet créé avant ce correctif).
    const savedStudyType = derivedStudyType || localStorage.getItem('studyType');
    if (savedStudyType) {
        const radioToSelect = document.querySelector(`input[name="study_type"][value="${savedStudyType}"]`);
        if (radioToSelect) radioToSelect.checked = true;
    }

    // NOUVEAU (demande explicite) : la batterie choisie dans le calepinage alimente ce modal, et le
    // calcul de stockage se déclenche seul. Ce modal étant une page séparée chargée en iframe, la
    // liaison passe par le pont partagé (batterieSelection.js) : postMessage pour le même onglet,
    // localStorage pour les autres.
    if (window.BatterieSelection) {
        // Sélection antérieure à l'ouverture de ce modal : appliquée sans relancer le calcul —
        // l'utilisateur vient d'arriver, il n'a rien changé.
        const dejaChoisie = window.BatterieSelection.lire();
        if (dejaChoisie) appliquerBatterieSelectionnee(dejaChoisie, { forcer: false });

        window.BatterieSelection.onChangement((selection) => {
            if (selection) appliquerBatterieSelectionnee(selection, { forcer: true });
        });
    }

    // Initialiser l'UI au chargement
    handleStudyTypeChange();

    // NOUVEAU: Réafficher immédiatement les derniers résultats calculés (sans appel serveur)
    // lorsque le modal est rouvert — évite de laisser le panneau de résultats vide et incite
    // moins l'utilisateur à recliquer sur "Calculer" juste pour revoir ce qui existe déjà.
    // Le bouton "Calculer et visualiser" reste lui-même protégé par buildCalcSignature() :
    // si les paramètres n'ont pas changé, il réaffichera aussi le cache sans relancer le calcul.
    try {
        const cachedResultsRaw = localStorage.getItem('solar_sim_data');
        if (cachedResultsRaw) {
            const cachedResults = JSON.parse(cachedResultsRaw);
            if (cachedResults && cachedResults.site_keys) {
                // NOUVEAU: si la configuration PV (calepinage/système) a changé depuis ce calcul,
                // ne pas réafficher les résultats tels quels : les remettre à 0 pour signaler
                // clairement qu'il faut relancer le calcul.
                const isFresh = checkPvDataStillFresh();
                simulationResults = isFresh ? cachedResults : zeroOutResultsForStaleData(cachedResults);
                displayResults(simulationResults);
                filterResults('Global');
                // Résultats d'un calcul antérieur : contrôlés contre le fichier importé actuel.
                controlerConsommationTableau(simulationResults);
                if (!isFresh) {
                    retirerResultatsProSolaireEnregistres();
                    showMessage("Le calepinage ou le système ont été modifiés depuis le dernier calcul : les résultats affichés sont remis à 0. Relancez le calcul pour les mettre à jour.", 'error', 8000);
                }

                // BUG CORRIGÉ (persistance) : ce modal est chargé dans un <iframe> dont le `src` est
                // réassigné à chaque réouverture (cf. openUniversalModal(), menu.html) — cela recharge
                // et ré-exécute entièrement ce script à chaque fois, réinitialisant TOUTES les
                // variables JS, y compris window.storageResults. Rien ne le restaurait : basculer
                // vers un autre modal (ex. Études économiques) puis revenir ici faisait donc
                // disparaître les résultats de stockage déjà calculés. Restauré ici, à l'identique de
                // simulationResults ci-dessus (et uniquement si les résultats principaux sont encore
                // à jour : un stockage calculé sur un calepinage désormais obsolète n'a plus de sens).
                if (isFresh) {
                    try {
                        const cachedStorageRaw = localStorage.getItem('solar_storage_data');
                        if (cachedStorageRaw) {
                            const cachedStorage = JSON.parse(cachedStorageRaw);
                            if (cachedStorage && cachedStorage.outputs) {
                                window.storageResults = cachedStorage;
                                displayStorageResults(cachedStorage, {});

                                // Restaure aussi l'état visuel "stockage activé" (radio + bouton),
                                // sans quoi le panneau réapparaît mais le toggle reste sur "Non".
                                const storageToggleOui = document.querySelector('input[name="storage-toggle"][value="oui"]');
                                if (storageToggleOui) {
                                    storageToggleOui.checked = true;
                                    if (typeof toggleStorageSection === 'function') toggleStorageSection(true);
                                }
                                synchroniserStockageAffiche();
                            }
                        }
                    } catch (e) {
                        console.warn("Impossible de restaurer les résultats de stockage", e);
                    }
                } else {
                    // Résultats principaux périmés : un stockage calculé dessus l'est aussi.
                    localStorage.removeItem('solar_storage_data');
                }
            }
        }
    } catch (e) {
        console.warn("Impossible de restaurer les derniers résultats", e);
    }
    // Courbes de consommation modifiées depuis une autre page (IRVE, Enedis) modal fermé.
    remettreResultatsAZeroCourbesModifiees();

    // NOUVEAU: Ajouter les icônes d'aide pour le téléchargement du modèle
    const timeStepSelect = document.getElementById('time-step-select');
    if (timeStepSelect) {
        const helpIconsHtml = `
            <span class="info-tooltip" onclick="openInfoModal()" style="cursor:pointer;">
                <i class="info-icon">i</i>
            </span>
            <a href="/static/concevoir_mon_projet/docs/tuto_version/Modele_de_CdC.xlsx" download="Modele_de_CdC.xlsx" title="Télécharger le modèle Excel" class="download-icon-link"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" style="vertical-align:middle;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#217346"/><path d="M14 2v6h6" fill="#1a5c37"/><path d="M7 12h10M7 15h10M7 18h10M12 12v9" stroke="white" stroke-width="1" stroke-linecap="round" fill="none"/></svg></a><span style="font-size:0.75rem; margin-left:0.3rem; white-space:nowrap;"><a href="/static/concevoir_mon_projet/docs/tuto_version/Modele_de_CdC_5min.xlsx" download="Modele_de_CdC_5min.xlsx" title="Modèle Excel au pas de 5 min (entrée seulement : moyenné au pas de simulation choisi)">5</a> · <a href="/static/concevoir_mon_projet/docs/tuto_version/Modele_de_CdC_10min.xlsx" download="Modele_de_CdC_10min.xlsx" title="Modèle Excel au pas de 10 min">10</a> · <a href="/static/concevoir_mon_projet/docs/tuto_version/Modele_de_CdC_15min.xlsx" download="Modele_de_CdC_15min.xlsx" title="Modèle Excel au pas de 15 min">15</a> · <a href="/static/concevoir_mon_projet/docs/tuto_version/Modele_de_CdC_30min.xlsx" download="Modele_de_CdC_30min.xlsx" title="Modèle Excel au pas de 30 min">30</a> · <a href="/static/concevoir_mon_projet/docs/tuto_version/Modele_de_CdC.xlsx" download="Modele_de_CdC.xlsx" title="Modèle Excel au pas de 60 min">60</a> min</span>
        `;
        const paramLabel = timeStepSelect.previousElementSibling;
        if (paramLabel) {
            paramLabel.insertAdjacentHTML('beforeend', helpIconsHtml);
        }
    }

    // Mettre en place l'interface d'import PV une seule fois
    renderPvInputHere();

    // Créer le modal économique une seule fois
    createEconomicModal();

    createAdvancedEconomicModal();
    createDashboardModal();
    createInfoModal();

    // « Activation de la restitution de l'énergie de la batterie » (demande explicite, 2e version) :
    // simple RÉGLAGE du flux de la batterie — Oui autorise la recharge sur le réseau pendant les
    // heures de recharge sélectionnées ; Non (défaut) : la batterie ne se charge qu'avec le surplus
    // solaire. Il n'annule JAMAIS le stockage (c'est le rôle de la case « Prendre en compte le
    // stockage », cf. plus bas) ; il faut relancer l'analyse du stockage pour l'appliquer.
    document.querySelectorAll('input[name="sto_restitution_toggle"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'oui') {
                const heures = JSON.parse(document.getElementById('sto_recharge_hours')?.value || '[]');
                if (!heures.length) {
                    showMessage("Recharge réseau activée : sélectionnez les heures de recharge (heures creuses) ci-dessous, sinon elle n'aura aucun effet.", 'info', 8000);
                    return;
                }
            }
            if (window.storageResults && window.storageResults.outputs) {
                showMessage("Réglage de recharge réseau modifié : cliquez sur « Lancer l'analyse » pour recalculer le stockage.", 'info', 6000);
            }
        });
    });

    // NOUVEAU (demande explicite) : case « Prendre en compte le stockage solaire dans le projet »,
    // cochée par défaut. Décochée : l'effet du stockage est retiré de tous les résultats (valeurs
    // exactes sans batterie) et le stockage n'est plus recalculé automatiquement. Recochée : le
    // stockage est recalculé immédiatement si l'autoconsommation est disponible.
    ['sto_cap', 'sto_charge_power', 'sto_discharge_power', 'sto_dod', 'sto_rte', 'sto_voltage', 'sto_chemistry',
        'sto_nb_batteries', 'sto_montage', 'sto_nb_serie', 'sto_couplage', 'sto_rendement_onduleur', 'sto_puissance_onduleur_kw']
        .forEach((id) => {
            const champ = document.getElementById(id);
            if (!champ) return;
            const surChangement = () => { majChampsParc(); apercuParcBatteries(); saveStorageParams(); };
            champ.addEventListener('input', surChangement);
            champ.addEventListener('change', surChangement);
        });

    document.getElementById('sto_prise_en_compte')?.addEventListener('change', (e) => {
        saveStorageParams();
        mettreAJourEtatCaseStockage();
        if (!e.target.checked) {
            const retire = invaliderResultatsStockage(
                "Stockage retiré du projet : les résultats affichés sont ceux SANS stockage.",
                "Stockage non pris en compte dans le projet — les valeurs affichées sont celles <u>sans stockage</u>."
            );
            if (!retire) showMessage("Stockage retiré du projet : il ne sera pas pris en compte dans les résultats.", 'info', 6000);
            return;
        }
        // Les tableaux n'intègrent le stockage que si « Intégration du stockage » est sur Oui.
        const toggleOui = document.querySelector('input[name="storage-toggle"][value="oui"]');
        if (toggleOui && !toggleOui.checked) {
            toggleOui.checked = true;
            toggleStorageSection(true);
        }
        if (simulationResults) {
            calculateStorage();
        } else {
            showMessage("Stockage pris en compte : il sera calculé après l'analyse d'autoconsommation.", 'info', 6000);
        }
    });

    // Écouteur pour forcer la restitution si la stratégie "Sans PV" est sélectionnée manuellement
    document.querySelectorAll('input[name="storage_strategy"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'optim_sansPV') {
                const restitutionOui = document.querySelector('input[name="sto_restitution_toggle"][value="oui"]');
                if (restitutionOui) restitutionOui.checked = true;
            }
        });
    });

    // Persistence : écouteurs de sauvegarde automatique du formulaire principal
    document.getElementById('time-step-select')?.addEventListener('change', function () {
        const s = loadFromLS('mainFormState') || {};
        s.timeStep = this.value;
        saveToLS('mainFormState', s);
    });
    document.querySelectorAll('input[name="priority"]').forEach(r => r.addEventListener('change', function () {
        const s = loadFromLS('mainFormState') || {};
        s.priority = this.value;
        saveToLS('mainFormState', s);
        majOrdrePersonnalise();
    }));
    document.querySelectorAll('.priority-ordre-select').forEach(sel => sel.addEventListener('change', () => {
        const s = loadFromLS('mainFormState') || {};
        s.ordreUsages = lireOrdreUsages();
        saveToLS('mainFormState', s);
    }));
    document.querySelectorAll('input[name="storage-toggle"]').forEach(r => r.addEventListener('change', function () {
        const s = loadFromLS('mainFormState') || {};
        s.storageToggle = this.value;
        saveToLS('mainFormState', s);
        synchroniserStockageAffiche();
    }));
    // Persistence : sauvegarde automatique du modal stockage (inputs & selects)
    document.getElementById('storage-modal-content')?.addEventListener('change', saveStorageParams);
    document.getElementById('storage-modal-content')?.addEventListener('input', saveStorageParams);

    // Restauration asynchrone de l'état persisté (ne bloque pas l'interface) ; calculate() l'attend.
    persistenceRestauree = initPersistence().catch((e) => {
        console.warn("Restauration de l'état persisté incomplète", e);
    });

    // NOUVEAU WORKFLOW (demande explicite : clic unique "Calculer et visualiser" depuis la page
    // Calepinage) : flag posé par ButtonControl.js / navigation-modales.js juste avant l'ouverture
    // de ce modal. Flag one-shot (retiré immédiatement) pour ne pas se redéclencher à chaque
    // réouverture manuelle ultérieure de ce même modal.
    // CORRECTIF (bug rapporté : au 2e clic sur "Calculer et Visualiser", les résultats ne
    // s'affichaient plus) : ce calcul partait avant la fin de initPersistence() — courbes ACC/ACI et
    // fichier PV pas encore restaurés depuis l'IndexedDB — et échouait sur « Veuillez importer au
    // moins un fichier de consommation », après avoir effacé les résultats réaffichés plus haut.
    // Lancé désormais après la création des modaux économiques et la restauration (cf. calculate()).
    if (localStorage.getItem('autoRunAutoconso') === 'true') {
        localStorage.removeItem('autoRunAutoconso');
        calculate();
    }

});

function updateThemeColor(color) {
    const root = document.documentElement;
    root.style.setProperty('--accent-primary', color);

    // Génère une couleur plus sombre pour le survol
    const hoverColor = pSBC(-0.25, color);
    if (hoverColor) {
        root.style.setProperty('--accent-primary-hover', hoverColor);
    }
    localStorage.setItem('themeColor', color);
}
// Rend l'interface d'import PV dans cette page (main_autoconso.js), en reliant les callbacks de
// irve_consumption_import.js à pvFileObject (lu directement par calculateInternal()/buildCalcSignature)
// et en conservant les boutons PVGIS/Sans PV spécifiques à cette page (absents côté IRVE).
function renderPvInputHere() {
    renderPvInput(document.getElementById('pv-input-group-content'), {
        onFileSelected: (file) => { pvFileObject = file; },
        onFileRemoved: () => { pvFileObject = null; },
        onPvgisClick: openPvgisModal,
        onSansPvClick: launchSansPV,
    });
}

// Idem pour l'import de consommation ACI : relie le callback à consFileObject.
function renderAciConsumerInputHere(container) {
    renderAciConsumerInput(container, {
        onFileSelected: (file) => { consFileObject = file; },
        onFileRemoved: () => { consFileObject = null; },
    });
}

// Fonction d'ouverture de la modale
function openModal() {
    if (modal) modal.style.display = 'flex';
    if (backdrop) backdrop.style.display = 'block';
}

document.addEventListener('mousemove', (e) => {
    if (isDragging && modal) {
        modal.style.left = `${e.clientX - offsetX}px`;
        modal.style.top = `${e.clientY - offsetY}px`;
    }
    if (isResizing && modal) {
        const newWidth = startWidth + (e.clientX - startX);
        const newHeight = startHeight + (e.clientY - startY);
        modal.style.width = `${Math.max(800, newWidth)}px`; // min-width
        modal.style.height = `${Math.max(600, newHeight)}px`; // min-height
    }
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    isResizing = false;
    document.body.style.userSelect = '';
});

// === LOGIQUE DE L'APPLICATION ===

// Afficher un message personnalisé au lieu d'une alerte
let _messageAreaTimeout = null;

function showMessage(text, type = 'info', duration = 3000) {
    const messageArea = document.getElementById('message-area');
    if (_messageAreaTimeout) {
        clearTimeout(_messageAreaTimeout);
        _messageAreaTimeout = null;
    }

    messageArea.innerHTML = '';
    messageArea.style.display = 'inline-flex';
    messageArea.style.alignItems = 'center';
    messageArea.style.gap = '0.75rem';

    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    messageArea.appendChild(textSpan);

    // Fermeture manuelle : certains messages (ex. erreurs) mettent du temps à disparaître
    // automatiquement. Le conteneur entier est cliquable pour le fermer immédiatement (cf.
    // règle CSS #message-area.visible { pointer-events: auto; } qui rend toute la zone —
    // pas seulement ce bouton — réactive au clic tant que le message est affiché) ; le bouton
    // ne sert qu'à signaler visuellement que le message est fermable.
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.style.cssText = 'background:none; border:none; color:inherit; font-size:1.2rem; line-height:1; cursor:pointer; padding:0;';
    messageArea.appendChild(closeBtn);

    messageArea.onclick = () => messageArea.classList.remove('visible');

    messageArea.className = type === 'error' ? 'error' : '';
    messageArea.classList.add('visible');
    _messageAreaTimeout = setTimeout(() => messageArea.classList.remove('visible'), duration);
}

/**
 * Gère et affiche les erreurs de manière centralisée et conviviale.
 * @param {Error|string} error - L'objet d'erreur ou le message d'erreur.
 * @param {string} [context=''] - Un contexte optionnel pour l'erreur (ex: 'Calcul', 'Export PDF').
 */
function handleError(error, context = '') {
    let userMessage = error instanceof Error ? error.message : error;
    const prefix = context ? `Erreur (${context})` : 'Erreur';

    // Enrichir les messages d'erreur courants avec des suggestions
    if (userMessage.includes('Failed to fetch')) {
        userMessage = "Impossible de contacter le serveur. Veuillez vérifier votre connexion internet et l'état du serveur.";
    } else if (userMessage.includes('format JSON invalide')) {
        userMessage = "Une réponse inattendue a été reçue du serveur. Il est peut-être en maintenance.";
    } else if (userMessage.includes('colonnes manquantes')) {
        userMessage += " Assurez-vous que votre fichier Excel contient les en-têtes attendus.";
    }

    // Afficher le message final à l'utilisateur
    showMessage(`${prefix}: ${userMessage}`, 'error', 5000);

    // Logguer l'erreur complète en console pour le débogage
    console.error(`[${context || 'Général'}]`, error);
}

function showLoader(show) { document.getElementById('loader').style.display = show ? 'block' : 'none'; }

/** Injecte une seule fois (idempotent) l'animation des barres utilisée par buildSkeletonHistogramHtml(). */
function ensureSkeletonHistogramStyles() {
    if (document.getElementById('skeleton-histogram-styles')) return;
    const style = document.createElement('style');
    style.id = 'skeleton-histogram-styles';
    style.textContent = `@keyframes skeleton-bar-pulse { 0%, 100% { transform: scaleY(0.35); } 50% { transform: scaleY(1); } }`;
    document.head.appendChild(style);
}

/**
 * Histogramme factice (barres de hauteurs variées, animées en boucle) affiché pendant les
 * chargements/calculs, pour donner l'impression qu'un graphique se construit plutôt que de
 * laisser une zone vide à l'utilisateur.
 */
function buildSkeletonHistogramHtml(barWidth = 22, gap = 10, containerHeight = 150) {
    ensureSkeletonHistogramStyles();
    const hauteurs = [35, 60, 45, 80, 55, 95, 40, 70, 50, 85];
    const barres = hauteurs.map((h, i) => `
        <div style="width:${barWidth}px; height:${h}%; background: var(--accent-primary, #3b82f6); border-radius:4px 4px 0 0; transform-origin:bottom; animation: skeleton-bar-pulse 1.1s ease-in-out infinite; animation-delay:${(i * 0.09).toFixed(2)}s;"></div>
    `).join('');
    return `<div aria-hidden="true" style="display:flex; align-items:flex-end; justify-content:center; gap:${gap}px; height:${containerHeight}px; margin:0 auto 1.5rem; opacity:0.35;">${barres}</div>`;
}

/**
 * Affiche une checklist de progression dans la zone de résultats pendant le calcul (Vente en
 * totalité, ACI et ACC empruntent tous ce même chemin, cf. calculateInternal()).
 */
function renderCalcProgress(container, steps) {
    container.innerHTML = `
        <div class="calc-progress" style="max-width: 460px; margin: 3rem auto; padding: 1.5rem 2rem; background: var(--bg-panel); border-radius: var(--border-radius-md); border: 1px solid var(--border-color);">
            ${buildSkeletonHistogramHtml()}
            ${steps.map((label, i) => `
                <div class="calc-progress-step" id="calc-step-${i}" style="display: flex; align-items: center; justify-content: center; gap: 0.7rem; padding: 1rem 0; font-weight: 500;">
                    <span>${label}</span><span class="calc-progress-icon"></span>
                </div>`).join('')}
        </div>
    `;
}

function markCalcStepDone(index) {
    const icon = document.querySelector(`#calc-step-${index} .calc-progress-icon`);
    if (icon) {
        icon.textContent = '✅';
        icon.style.color = 'var(--success-color)';
    }
}

// NOUVEAU: Construit une empreinte stable des paramètres d'entrée d'un calcul (FormData +
// type d'étude), afin de détecter si l'utilisateur a réellement modifié quelque chose depuis
// le dernier calcul réussi (cf. saveDataToLocalStorage / solar_sim_signature).
// CORRECTIF (demande explicite : ne pas relancer le backend si les entrées n'ont pas changé) :
//  - economic_params (ACC) exclu : /calculate_acc l'ignore (étude éco ACC calculée côté front), la
//    simple ouverture du modal des paramètres économiques changeait pourtant l'empreinte ;
//  - pv_config_json normalisé comme buildPvConfigSignature() : un écart flottant infime entre deux
//    reconstructions du calepinage suffisait à relancer le calcul serveur.
// Version du moteur de calcul d'autoconsommation, incluse dans l'empreinte du cache : à changer à
// chaque correction du calcul serveur, pour qu'un projet déjà calculé soit recalculé au prochain
// « Calculer » au lieu de réafficher le résultat de l'ancien code (2026-10-13 : lecture des courbes
// Enedis préparées à un autre pas, dates R63, moyenne par bloc, production sous-horaire).
const VERSION_MOTEUR_AUTOCONSO = '2026-10-25';
window.VERSION_MOTEUR_AUTOCONSO = VERSION_MOTEUR_AUTOCONSO;
console.info(`[Autoconsommation] version du moteur de calcul (page) : ${VERSION_MOTEUR_AUTOCONSO}`);

function buildCalcSignature(formData, studyType) {
    const entries = [];
    for (const [key, value] of formData.entries()) {
        if (studyType === 'acc' && key === 'economic_params') continue;
        if (value instanceof File) {
            entries.push([key, value.name, value.size, value.lastModified]);
        } else if (key === 'pv_config_json') {
            let normalise = String(value);
            try { normalise = buildPvConfigSignature(JSON.parse(value)); } catch (e) {}
            entries.push([key, normalise]);
        } else {
            entries.push([key, String(value)]);
        }
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return JSON.stringify({ moteur: VERSION_MOTEUR_AUTOCONSO, studyType, entries });
}

// NOUVEAU: Arrondit récursivement tous les nombres d'un objet avant sérialisation. La fenêtre
// parente ré-sauvegarde solarProjectData toutes les 3s (StorageManager.setupAutoSave), ce qui
// déclenche ici un événement 'storage' et reconstruit #pv-fields-container à partir de ces
// données à chaque fois (cf. écouteur 'storage' de main_prodsolaire.js) — un écart flottant
// infime (ex: 1e-9) entre deux reconstructions successives d'une même géométrie suffisait à
// faire échouer la comparaison de fraîcheur et à réafficher "calepinage modifié" en boucle,
// sans qu'aucune donnée n'ait réellement changé. Sans impact sur le payload réellement envoyé
// au backend pour le calcul (uniquement utilisé pour cette empreinte de comparaison).
function _roundNumbersForSignature(value, decimals = 6) {
    if (typeof value === 'number') {
        const factor = 10 ** decimals;
        return Math.round(value * factor) / factor;
    }
    if (Array.isArray(value)) {
        return value.map(v => _roundNumbersForSignature(v, decimals));
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = _roundNumbersForSignature(value[key], decimals);
        }
        return out;
    }
    return value;
}

// NOUVEAU: Sérialise une config PV (buildPvParams()) en empreinte stable, utilisée à la fois au
// moment du calcul (référence sauvegardée, cf. solar_sim_pv_signature) et lors des vérifications
// ultérieures (cf. checkPvDataStillFresh) — les deux DOIVENT passer par la même normalisation,
// sans quoi la comparaison serait faussée de façon permanente plutôt que corrigée.
function buildPvConfigSignature(pvConfig) {
    return pvConfig ? JSON.stringify(_roundNumbersForSignature(pvConfig)) : null;
}

// NOUVEAU: Empreinte de la configuration PV actuelle (champs du calepinage/système tels que
// rendus dans le panneau PVGIS, ou fichier de production importé), comparable à celle enregistrée
// lors du dernier calcul réussi (cf. solar_sim_pv_signature).
function buildCurrentPvInputSignature() {
    if (pvFileObject) {
        return JSON.stringify({ file: [pvFileObject.name, pvFileObject.size, pvFileObject.lastModified] });
    }
    const timeStepMinutes = parseInt(document.getElementById('time-step-select')?.value) || 60;
    const pvConfig = window.buildPvParams ? window.buildPvParams(timeStepMinutes) : null;
    return buildPvConfigSignature(pvConfig);
}

// NOUVEAU: Vérifie si la configuration PV actuelle correspond toujours à celle utilisée pour le
// dernier calcul affiché. Retourne true (rien à signaler) s'il n'y a aucune empreinte de calcul
// précédent à protéger — un nouveau projet en cours de calepinage, jamais encore calculé, ne doit
// jamais être considéré comme "modifié depuis le dernier calcul" puisqu'il n'y a pas eu de calcul.
// L'empreinte de référence n'est établie qu'au moment d'un calcul réussi (cf. saveDataToLocalStorage),
// jamais ici, pour éviter de figer prématurément un état intermédiaire (calepinage en cours d'édition).
function checkPvDataStillFresh() {
    const savedSignature = localStorage.getItem('solar_sim_pv_signature');
    if (!savedSignature) return true;
    const currentSignature = buildCurrentPvInputSignature();
    if (!currentSignature) return true;
    return currentSignature === savedSignature;
}

// NOUVEAU: Remet à 0 tous les indicateurs numériques des résultats affichés (sans changer leur
// structure), pour signaler visuellement que les données de calepinage/système ont changé depuis
// ce calcul et qu'il faut relancer le calcul pour obtenir des résultats à jour.
function zeroOutResultsForStaleData(results) {
    const zeroed = JSON.parse(JSON.stringify(results));
    const zeroNumbers = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        Object.keys(obj).forEach(key => {
            if (typeof obj[key] === 'number') obj[key] = 0;
        });
    };
    if (zeroed.sites) {
        Object.values(zeroed.sites).forEach(site => zeroNumbers(site.summary));
    }
    if (typeof zeroed.taux_couverture_pct === 'number') zeroed.taux_couverture_pct = 0;
    if (zeroed.pv_summary) {
        zeroNumbers(zeroed.pv_summary.summary);
        (zeroed.pv_summary.plants_summary || []).forEach(zeroNumbers);
    }
    return zeroed;
}

// NOUVEAU: Remet à 0 les résultats déjà affichés à l'écran SANS reconstruire le conteneur ni
// détruire/recréer les graphiques Chart.js (cf. renderCharts()) — évite le "clignotement" visuel
// d'un displayResults()/filterResults() complet lorsque le calepinage/système change alors que des
// résultats sont déjà visibles (cas de l'écouteur 'storage' cross-onglet).
function softZeroOutDisplayedResults() {
    const zeroText = (el) => {
        if (!el) return;
        const unitMatch = el.textContent.match(/[^\d\-,.\s][\s\S]*$/);
        const unit = unitMatch ? unitMatch[0] : '';
        el.textContent = (0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (unit ? ' ' + unit.trim() : '');
    };

    ['stat-production', 'stat-consumed', 'stat-surplus', 'stat-peak-power', 'stat-specific-yield', 'stat-pr']
        .forEach(id => zeroText(document.getElementById(id)));

    // Graphiques : mise à jour des données existantes (pas de destroy/recreate => pas de flicker)
    if (monthlyChart) {
        monthlyChart.data.datasets.forEach(ds => { ds.data = ds.data.map(() => 0); });
        monthlyChart.update('none');
    }
    individualCharts.forEach(chart => {
        chart.data.datasets.forEach(ds => { ds.data = ds.data.map(() => 0); });
        chart.update('none');
    });

    // Tableau récapitulatif : ne toucher que les colonnes de valeurs (pas la colonne "Indicateur")
    document.querySelectorAll('#results-table tbody tr').forEach(tr => {
        Array.from(tr.children).slice(1).forEach(td => zeroText(td));
    });
}

/**
 * Courbes de consommation importées, remplacées ou supprimées (cf. persistence.js::
 * signalerCourbesConsommationModifiees) : résultats affichés et en cache remis à 0, stockage
 * invalidé. L'empreinte du dernier calcul étant effacée, le prochain calcul repasse par le serveur.
 * @param {boolean} [avecMessage=true]
 */
function remettreResultatsAZeroCourbesModifiees(avecMessage = true) {
    if (!localStorage.getItem(MARQUEUR_COURBES_MODIFIEES) || isCalculatingResults) return;
    localStorage.removeItem(MARQUEUR_COURBES_MODIFIEES);
    localStorage.removeItem('solar_storage_data');
    localStorage.removeItem('solar_storage_signature');
    retirerResultatsProSolaireEnregistres();
    if (!simulationResults) return;
    simulationResults = zeroOutResultsForStaleData(simulationResults);
    try { localStorage.setItem('solar_sim_data', JSON.stringify(simulationResults)); } catch (e) {}
    softZeroOutDisplayedResults();
    persisterIndicateursEcoAcc(null); // étude éco ACC périmée : plus de rapport tant qu'on n'a pas recalculé
    window.storageResults = null;
    const stockageAffiche = document.getElementById('storage-results-container');
    if (stockageAffiche) stockageAffiche.style.display = 'none';
    if (avecMessage) {
        showMessage("Courbe(s) de consommation modifiée(s) : les résultats sont remis à 0. Relancez le calcul pour les mettre à jour.", 'error', 8000);
    }
}

window.addEventListener('courbesConsommationModifiees', () => remettreResultatsAZeroCourbesModifiees());
window.addEventListener('storage', (e) => {
    if (e.key === MARQUEUR_COURBES_MODIFIEES && e.newValue) remettreResultatsAZeroCourbesModifiees();
});

// NOUVEAU: S'assure que les données de calepinage/système sont synchronisées avant de construire
// le payload envoyé au backend. SummaryModal (composant qui calcule les totaux de calepinage —
// calculatedPvs) tourne sur la page parente, ce module étant chargé dans un iframe ; son
// forceUpdate() est justement prévu pour être "appelable depuis l'extérieur". On rafraîchit
// ensuite les champs PV affichés ici (renderPvFieldsFromCalepinage, exposé par main_prodsolaire.js)
// pour que buildPvParams() lise bien les valeurs à jour, et non celles rendues à l'ouverture du modal.
async function refreshCalepinageDataBeforeCalc() {
    try {
        const parentSummaryModal = (window.parent && window.parent !== window) ? window.parent.summaryModalInstance : null;
        if (parentSummaryModal && typeof parentSummaryModal.forceUpdate === 'function') {
            await parentSummaryModal.forceUpdate();
        }
    } catch (e) {
        console.warn("Impossible de forcer la mise à jour du résumé calepinage avant le calcul", e);
    }
    try {
        if (typeof window.renderPvFieldsFromCalepinage === 'function') {
            window.renderPvFieldsFromCalepinage();
        }
    } catch (e) {
        console.warn("Impossible de rafraîchir les champs PV depuis le calepinage", e);
    }
}

/** Case « Prendre en compte le stockage solaire dans le projet » (cochée par défaut, true si absente). */
function stockagePrisEnCompte() {
    const caseStockage = document.getElementById('sto_prise_en_compte');
    return !caseStockage || caseStockage.checked;
}

/** Libellé du bouton « Lancer l'analyse » selon la case (désactivé si le stockage est retiré). */
function mettreAJourEtatCaseStockage() {
    const btn = document.getElementById('storage-launch-btn');
    if (!btn) return;
    const actif = stockagePrisEnCompte();
    btn.disabled = !actif;
    btn.style.opacity = actif ? '' : '0.5';
    btn.title = actif ? '' : "Cochez « Prendre en compte le stockage solaire dans le projet » pour lancer l'analyse.";
}

// Vrai si le DERNIER calculateInternal() a abouti (résultats serveur ou cache affichés).
let dernierCalculAutoconsoReussi = false;

async function calculate() {
    // Contrôle strict de la puissance du projet vs licence (+ marge de tolérance)
    if (typeof window.checkPowerLicenceCompliance === 'function') {
        let totalPower = 0;
        try {
            const solarData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
            totalPower = Number(solarData?.totals?.totalPower || 0);
        } catch (_) {}
        const compliance = window.checkPowerLicenceCompliance(totalPower);
        if (!compliance.allowed) {
            showMessage(compliance.message, 'error', 8000);
            return;
        }
    }

    // NOUVEAU: bloque l'écouteur 'storage' (cf. plus haut) le temps du calcul, pour éviter que la
    // synchronisation ci-dessous (qui écrit sur la fenêtre parente) ne s'auto-invalide en plein vol.
    isCalculatingResults = true;
    try {
        // Courbes de consommation et fichier PV restaurés (IndexedDB/base) avant de lire les entrées.
        await persistenceRestauree;
        // NOUVEAU: garantit que ce sont les données de calepinage/système actuelles qui seront
        // envoyées, même si elles ont changé depuis l'ouverture de ce modal.
        await refreshCalepinageDataBeforeCalc();
        await calculateInternal();
    } finally {
        isCalculatingResults = false;
    }
    // Lancé APRÈS le finally de calculateInternal (qui masque le loader) : le calcul de stockage
    // gère son propre loader sans qu'il soit masqué prématurément.
    if (dernierCalculAutoconsoReussi) await lancerStockageSiConfigure();
}

/**
 * CORRECTIF (bug rapporté : "le calcul de stockage n'est pas lancé en même temps que l'autoconso") :
 * le stockage ne partait que via son propre bouton, ou quand une batterie était choisie ALORS que
 * des résultats d'autoconsommation existaient déjà. Or à l'ouverture de ce modal, la batterie du
 * calepinage est appliquée AVANT tout calcul (message « lancez d'abord l'analyse ») et rien ne
 * relançait le stockage ensuite — et en résidentiel le panneau de gauche (option stockage, bouton)
 * est masqué : aucun moyen de le déclencher. Désormais, après chaque calcul d'autoconsommation
 * réussi, le stockage est calculé automatiquement si :
 *  - l'option « Intégration du stockage » est sur Oui, ou
 *  - une batterie est sélectionnée (calepinage ou modal) avec une capacité renseignée.
 */
async function lancerStockageSiConfigure() {
    try {
        if (!stockagePrisEnCompte()) return; // stockage retiré du projet par l'utilisateur
        const toggleOui = document.querySelector('input[name="storage-toggle"][value="oui"]');
        const selection = window.BatterieSelection ? window.BatterieSelection.lire() : null;
        const batterieChoisie = !!(selection && selection.capaciteKwh > 0);
        if (!(toggleOui && toggleOui.checked) && !batterieChoisie) return;

        if (batterieChoisie) {
            // Caractéristiques de la batterie (sans relancer : on calcule juste après), puis
            // option stockage activée pour que tableaux et affichages en tiennent compte.
            appliquerBatterieSelectionnee(selection, { forcer: false, sansCalcul: true });
            if (toggleOui && !toggleOui.checked) {
                toggleOui.checked = true;
                if (typeof toggleStorageSection === 'function') toggleStorageSection(true);
            }
        }
        const capacite = parseFloat(document.getElementById('sto_cap')?.value) || 0;
        if (capacite <= 0) {
            showMessage("Stockage activé mais capacité de batterie nulle : renseignez la batterie pour calculer le stockage.", 'error', 6000);
            return;
        }
        await calculateStorage();
    } catch (e) {
        console.warn("[autoconso] Lancement automatique du stockage impossible :", e);
    }
}

async function calculateInternal() {
    dernierCalculAutoconsoReussi = false;
    window.dernierCalculAutoconsoErreur = null;
    window.dernierCalculAutoconsoBlocagePompage = null;
    showLoader(true);
    const resultsContainer = document.getElementById('results-container');
    const timeStepMinutes = parseInt(document.getElementById('time-step-select').value);
    renderCalcProgress(resultsContainer, [
        `Courbe de production solaire générée (${timeStepMinutes} minutes)`,
        `Affichage des résultats`
    ]);
    await new Promise(resolve => setTimeout(resolve, 50)); // Laisse le temps au loader de s'afficher
    try {
        const priorityMode = document.querySelector('input[name="priority"]:checked').value;

        const formData = new FormData();
        const studyType = document.querySelector('input[name="study_type"]:checked').value;
        const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
        let endpoint;

        // Adapter la construction du FormData et l'endpoint en fonction du type d'étude
        if (studyType === 'vente_totalite') {
            endpoint = `${apiPrefix}/calculate_vente_totalite`;
            // NOUVEAU: Ajouter les paramètres P90
            const p90Params = {
                incertitude_production: parseFloat(document.getElementById('vt_incertitude_prod')?.value) || 3.5,
                incertitude_meteo: parseFloat(document.getElementById('vt_incertitude_meteo')?.value) || 2.5,
                degradation: parseFloat(document.getElementById('vt_degradation')?.value) || 0.5,
                horizon: parseInt(document.getElementById('vt_horizon')?.value) || 20
            };
            formData.append('p90_params', JSON.stringify(p90Params));
            const projetIdVt = getProjetIdActif();
            if (projetIdVt) formData.append('projet_id', projetIdVt);
            // Calcul lancé par le pompage solaire : inclinaison et pertes du pompage et des champs PV
            // liés, comparées par le serveur (écart = étude bloquée, cf. controle_parametres_pompage.py).
            if (window.controleParametresPompage) {
                formData.append('controle_pompage', JSON.stringify(window.controleParametresPompage));
            }
            // Pas de fichier de consommation requis
        } else if (studyType === 'acc') {
            endpoint = `${apiPrefix}/calculate_acc`; // Nouvelle route pour l'ACC
            if (accConsFiles.size === 0) throw new Error("Veuillez importer au moins un fichier de consommation pour l'ACC.");

            // CORRECTION: Envoyer les fichiers et les noms personnalisés
            const customNamesMap = {};
            accConsFiles.forEach((data, originalName) => {
                // On ajoute le fichier réel à la requête, en préservant son nom original
                formData.append('cons_files[]', data.file, originalName);
                // On crée une map pour lier le nom de fichier au nom personnalisé
                customNamesMap[originalName] = data.customName;
            });
            formData.append('custom_names', JSON.stringify(customNamesMap));

            // Projet actif : clé de comptage du quota d'études ACC (un projet = une étude par mois,
            // les recalculs sont libres) — cf. app/services/acc/quota.py.
            const projetIdActif = getProjetIdActif();
            if (projetIdActif) formData.append('projet_id', projetIdActif);

            // Ajout de la méthode de répartition et des clés fixes
            const repartitionMethod = document.querySelector('input[name="acc_repartition_method"]:checked').value;
            formData.append('repartition_method', repartitionMethod);

            // Récupération des pertes de transit depuis le panneau de configuration PVGIS
            const gridLoss = parseFloat(document.getElementById('pv_grid_loss')?.value || 0);
            formData.append('grid_loss_percent', gridLoss);

            if (repartitionMethod === 'fixed') {
                const keys = {};
                let totalKeys = 0;
                document.querySelectorAll('.acc-key-input').forEach(input => {
                    const key = parseFloat(input.value) || 0;
                    keys[input.dataset.consumerKey] = key;
                    totalKeys += key;
                });
                if (Math.abs(totalKeys - 100) > 0.1) {
                    throw new Error(`La somme des clés de répartition fixes doit être égale à 100%. Actuellement : ${totalKeys.toFixed(2)}%.`);
                }
                formData.append('repartition_keys', JSON.stringify(keys));
            } else if (repartitionMethod === 'priority') {
                // NOUVEAU: Envoyer l'ordre de priorité
                const priorityOrder = [];
                document.querySelectorAll('#acc-consumer-list tbody tr').forEach(row => {
                    const customName = row.querySelector('.custom-name-input').value;
                    priorityOrder.push(customName);
                });
                formData.append('priority_order', JSON.stringify(priorityOrder));
            }

            // Même source que l'analyse éco et l'export : seuls les tarifs du mode sélectionné (profil ou personnalisé) sont transmis.
            formData.append('economic_params', JSON.stringify(getEconomicParams()));

        } else if (studyType === 'aci') {
            endpoint = `${apiPrefix}/calculate`; // Endpoint pour ACI
            if (priorityMode === 'ordre') {
                const ordre = lireOrdreUsages();
                if (new Set(ordre).size !== ordre.length) {
                    throw new Error("Ordre de priorité personnalisé : choisissez trois usages différents.");
                }
                formData.append('ordre_usages', JSON.stringify(ordre));
            }
            const combineIrveCheckbox = document.getElementById('cons-combine-irve');
            const wantsIrveCombination = !!(combineIrveCheckbox && combineIrveCheckbox.checked);

            // CORRECTIF (cohérence bilan IRVE / autoconsommation) : la courbe IRVE ne transite plus
            // par le navigateur — le serveur la lit en base pour ce projet et contrôle que la
            // consommation IRVE utilisée (courbe ou colonne IRVE d'un fichier importé) est égale au
            // bilan énergétique du module IRVE ; tout écart bloque le calcul. Seuls l'identifiant
            // du projet et l'empreinte de la courbe (pour le cache des résultats) sont envoyés.
            const sharedIrve = await fetchSharedIrveCurve();
            const projetIdActif = getProjetIdActif();
            if (projetIdActif) formData.append('projet_id', projetIdActif);
            if (sharedIrve) formData.append('irve_empreinte', `${sharedIrve.bilanIrveKwh}|${sharedIrve.enregistreLe}`);

            // Courbe du module PAC / climatiseur, lue en base par le serveur comme la courbe IRVE :
            // ajoutée si la case est cochée, ou d'office si c'est la seule consommation disponible.
            const sharedPac = await fetchSharedPacCurve();
            const pacSeule = !consFileObject && !sharedIrve && !!sharedPac;
            const avecPac = !!sharedPac && (pacSeule || pacCombineeChoisie());
            if (avecPac) {
                if (sharedPac.pasTempsMin !== timeStepMinutes) {
                    throw new Error(`La courbe PAC est au pas de ${sharedPac.pasTempsMin} min, différent du pas sélectionné ici (${timeStepMinutes} min). Alignez les deux pas de temps.`);
                }
                formData.append('pac_source', 'projet');
                formData.append('pac_empreinte', `${sharedPac.bilanPacKwh}|${sharedPac.enregistreLe}`);
            }

            const exigerCourbeIrve = () => {
                if (!sharedIrve) {
                    throw new Error(consFileObject
                        ? "Aucune courbe IRVE synchronisée disponible à combiner. Décochez la case, ou calculez d'abord l'énergie dans le module IRVE."
                        : "Veuillez importer le fichier de consommation (3 courbes), ou synchroniser une courbe IRVE depuis le module de dimensionnement électrique.");
                }
                if (sharedIrve.pasTempsMin !== timeStepMinutes) {
                    throw new Error(`La courbe IRVE synchronisée est au pas de ${sharedIrve.pasTempsMin} min, différent du pas sélectionné ici (${timeStepMinutes} min). Alignez les deux pas de temps.`);
                }
                formData.append('irve_source', 'projet');
            };

            if (consFileObject) {
                formData.append('cons_file', consFileObject);
                // Consommation lue dans le fichier (affichée dans l'onglet d'import) : le serveur la
                // compare au tableau récapitulatif et bloque l'étude en cas d'écart.
                let lecture;
                try {
                    lecture = await lireEnergiesCourbeAci(consFileObject, timeStepMinutes);
                } catch (e) {
                    throw new Error(`Lecture du fichier de consommation impossible (${e.message}) : réimportez la courbe de charge.`);
                }
                formData.append('conso_lue_kwh', JSON.stringify({ energies: lecture.energies, pas_min: lecture.pasMin }));
                optionsControleImport = { irveAjoute: wantsIrveCombination, pacAjoute: avecPac };
                // Courbe IRVE synchronisée ajoutée PAR-DESSUS une consommation existante importée.
                if (wantsIrveCombination) exigerCourbeIrve();
            } else if (!pacSeule) {
                // Pas de fichier de consommation importé : courbe IRVE (et PAC si cochée), lues en base par le serveur.
                exigerCourbeIrve();
            }
        }

        let pvInputSignature = null;
        if (pvFileObject) {
            formData.append('pv_file', pvFileObject);
            pvInputSignature = JSON.stringify({ file: [pvFileObject.name, pvFileObject.size, pvFileObject.lastModified] });
        } else {
            // Par défaut : la production solaire est calculée automatiquement par le serveur
            // (PVGIS), à partir de la configuration actuelle du panneau PV intégré ci-dessus.
            // Aucune synchronisation front-end : la configuration part directement dans la requête.
            const pvConfig = window.buildPvParams ? window.buildPvParams(timeStepMinutes) : null;
            if (!pvConfig) {
                throw new Error("Veuillez configurer la localisation et au moins un champ PV (puissance crête > 0) dans le panneau « Importer les données d'ensoleillement », ou importer un fichier de production.");
            }
            formData.append('pv_config_json', JSON.stringify(pvConfig));
            // NOUVEAU: empreinte de la configuration PV (calepinage + système), pour détecter
            // ultérieurement si elle a changé depuis ce calcul (cf. checkPvDataStillFresh()).
            // Passe par buildPvConfigSignature() (arrondi) comme la vérification ultérieure —
            // le payload envoyé au backend ci-dessus, lui, reste en pleine précision.
            pvInputSignature = buildPvConfigSignature(pvConfig);
        }
        formData.append('time_step', timeStepMinutes);
        formData.append('priority', priorityMode);

        // NOUVEAU: Si les paramètres d'entrée sont identiques à ceux du dernier calcul réussi
        // (ex: réouverture du modal sans rien modifier), réafficher directement les résultats
        // en cache plutôt que de relancer un appel serveur inutile.
        const calcSignature = buildCalcSignature(formData, studyType);
        const cachedSignature = localStorage.getItem('solar_sim_signature');
        const cachedResultsRaw = localStorage.getItem('solar_sim_data');
        if (calcSignature === cachedSignature && cachedResultsRaw && cacheAutoconsoComplet(cachedResultsRaw)
            && calculEnregistre(MARQUEUR_SIM_ENREGISTRE, calcSignature)) {
            markCalcStepDone(0);
            markCalcStepDone(1);
            await new Promise(resolve => setTimeout(resolve, 200));
            simulationResults = JSON.parse(cachedResultsRaw);
            if (!(await controlerConsommationTableau(simulationResults))) return;
            displayResults(simulationResults);
            filterResults('Global');
            dernierCalculAutoconsoReussi = true;
            return;
        }

        markCalcStepDone(0);

        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json();
            if (errData.controle_conso_import && errData.controle_conso_import.conforme === false) {
                // Écart lecture de l'import / tableau détecté par le serveur : étude bloquée.
                bloquerEtudeConsommation(errData.error);
                return;
            }
            if (errData.controle_parametres_pompage && errData.controle_parametres_pompage.conforme === false) {
                // Inclinaison / pertes du calepinage différentes de celles du pompage : étude bloquée.
                bloquerEtudeConsommation(errData.error);
                window.dernierCalculAutoconsoBlocagePompage = errData.error;
                return;
            }
            throw new Error(errData.error || "Erreur lors du calcul.");
        }

        simulationResults = await response.json();
        if (studyType === 'aci' && consFileObject) simulationResults.options_controle_import = optionsControleImport;
        if (simulationResults.version_moteur !== undefined || studyType !== 'acc') {
            const versionServeur = simulationResults.version_moteur || 'ancienne (non renseignée)';
            const log = versionServeur === VERSION_MOTEUR_AUTOCONSO ? console.info : console.warn;
            log(`[Autoconsommation] version du moteur de calcul (serveur) : ${versionServeur}`);
        }
        noterEnregistrement(MARQUEUR_SIM_ENREGISTRE, calcSignature, !!simulationResults.prosolaire_enregistre);
        signalerResultatsProSolaire();
        markCalcStepDone(1);
        await new Promise(resolve => setTimeout(resolve, 400)); // Laisse le temps de voir la checklist validée
        if (!(await controlerConsommationTableau(simulationResults))) return;
        displayResults(simulationResults);
        filterResults('Global');
        saveDataToLocalStorage(simulationResults, calcSignature, pvInputSignature);
        if (simulationResults.controle_irve?.conforme) {
            const kwh = Number(simulationResults.controle_irve.bilan_kwh).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
            showMessage(`Consommation IRVE conforme au bilan énergétique IRVE (${kwh} kWh).`, 'info', 5000);
        }
        dernierCalculAutoconsoReussi = true;
        // ACC : participants sans courbe exploitable (cf. calcul_acc.py), autrefois ignorés sans message.
        if (simulationResults.fichiers_ignores?.length) {
            showMessage(`Courbe(s) non prise(s) en compte (illisible ou nulle) : ${simulationResults.fichiers_ignores.join(', ')}`, 'error', 8000);
        }
    } catch (error) {
        window.dernierCalculAutoconsoErreur = error instanceof Error ? error.message : String(error);
        handleError(error, 'Calcul');
    } finally {
        showLoader(false);
    }
}

// Courbes ajoutées par-dessus le fichier lors du calcul en cours (courbe IRVE / PAC du projet) :
// elles remplacent la colonne correspondante du fichier et changent la totale.
let optionsControleImport = { irveAjoute: false, pacAjoute: false };

/**
 * Contrôle (ACI, fichier importé) : la consommation du tableau récapitulatif doit être celle lue dans
 * le fichier de l'onglet « Import courbe de charge » (cf. energie_courbe_import.js). En cas d'écart —
 * résultats d'un autre fichier restés en cache, lecture divergente —, l'étude est bloquée : rien
 * n'est affiché ni conservé, les résultats enregistrés pour l'étude économique sont retirés.
 * @returns {Promise<boolean>} true si le tableau peut être affiché
 */
async function controlerConsommationTableau(results) {
    const studyType = document.querySelector('input[name="study_type"]:checked')?.value;
    if (studyType !== 'aci' || !results?.sites?.Global) return true;
    if (!((results.sites.Global.summary?.consumption_mwh || 0) > 0)) return true; // résultats remis à 0
    let fichier = consFileObject || await getFileFromIDB('consFile');
    if (!fichier) {
        // Au chargement, la CDC du projet peut ne pas encore être restaurée de la base dans l'IndexedDB.
        await restoreConsFileFromDBIfMissing();
        fichier = await getFileFromIDB('consFile');
    }
    let motif = null;
    if (!fichier) {
        // Courbe IRVE / PAC seules : contrôlées par le serveur. Un résultat issu d'un fichier qui
        // n'est plus importé ne correspond plus à rien.
        if (!results.controle_conso_import) return true;
        motif = "le fichier de consommation utilisé pour ces résultats n'est plus importé";
    } else {
        try {
            const pas = parseInt(document.getElementById('time-step-select')?.value, 10) || 60;
            const lecture = await lireEnergiesCourbeAci(fichier, pas);
            const keys = results.site_keys || [];
            const options = results.options_controle_import || {
                irveAjoute: keys.includes('Cons. IRVE') && !(lecture.energies['Cons. IRVE'] > 0),
                pacAjoute: keys.includes('Cons. PAC') && !(lecture.energies['Cons. PAC'] > 0),
            };
            const { conforme, ecarts } = comparerAuTableau(lecture, results, options);
            if (conforme) return true;
            motif = ecarts.join(' ; ');
        } catch (e) {
            motif = `lecture du fichier importé impossible (${e.message})`;
        }
    }
    bloquerEtudeConsommation(`Étude bloquée : la consommation du tableau récapitulatif ne correspond pas à celle lue dans le fichier importé (${motif}). Relancez le calcul.`);
    return false;
}

function bloquerEtudeConsommation(message) {
    simulationResults = null;
    dernierCalculAutoconsoReussi = false;
    window.dernierCalculAutoconsoErreur = message;
    localStorage.removeItem('solar_sim_data');
    localStorage.removeItem('solar_sim_signature');
    localStorage.removeItem('solar_storage_data');
    localStorage.removeItem('solar_storage_signature');
    retirerResultatsProSolaireEnregistres();
    window.storageResults = null;
    const stockageAffiche = document.getElementById('storage-results-container');
    if (stockageAffiche) stockageAffiche.style.display = 'none';
    const container = document.getElementById('results-container');
    if (container) {
        container.innerHTML = '';
        const encart = document.createElement('div');
        encart.style.cssText = 'padding: 1rem; border: 2px solid var(--danger-color); border-radius: var(--border-radius-md); color: var(--danger-color); font-weight: 600;';
        encart.textContent = message;
        container.appendChild(encart);
    }
    showMessage(message, 'error', 12000);
}

/**
 * Un résultat qui contient la consommation des bornes IRVE n'est JAMAIS réaffiché depuis le cache
 * local : le calcul serveur contrôle à chaque fois la consommation IRVE contre le bilan énergétique
 * et mémorise en base la part PV des bornes, relue par la section Rentabilité IRVE (sans appel
 * serveur, cette mémorisation manquait et « Actualiser les résultats PV » ne trouvait rien).
 */
function cacheAutoconsoComplet(cachedResultsRaw) {
    try {
        const cache = JSON.parse(cachedResultsRaw);
        // Idem pour la PAC : le calcul serveur contrôle la courbe PAC et mémorise sa part PV.
        return !(Array.isArray(cache?.site_keys) && (cache.site_keys.includes('Cons. IRVE') || cache.site_keys.includes('Cons. PAC')));
    } catch (e) {
        return false;
    }
}

function saveDataToLocalStorage(data, signature, pvInputSignature) {
    try {
        localStorage.setItem('solar_sim_data', JSON.stringify(data));
        // NOUVEAU: Empreinte des paramètres d'entrée de ce calcul (cf. buildCalcSignature),
        // utilisée pour éviter de relancer un calcul serveur identique au prochain déclenchement.
        if (signature) {
            localStorage.setItem('solar_sim_signature', signature);
        }
        // NOUVEAU: Empreinte de la configuration PV (calepinage + système) utilisée pour CE calcul,
        // pour détecter si elle a changé depuis (cf. checkPvDataStillFresh()).
        if (pvInputSignature) {
            localStorage.setItem('solar_sim_pv_signature', pvInputSignature);
        }
        localStorage.removeItem(MARQUEUR_COURBES_MODIFIEES); // résultats à jour des courbes actuelles
    } catch (e) {
        console.warn("Impossible de sauvegarder les résultats dans le localStorage", e);
    }
    // NOUVEAU: Transférer directement le productible (P50) et la puissance calculés par le
    // backend (PVGIS) vers le module d'étude économique, qui les consomme en priorité via
    // localStorage.sharedSolarProduction (cf. injectProjectDataToEconomicStudy dans
    // etudes_economique_content.html). L'écriture ici déclenche l'événement "storage" dans la
    // fenêtre parente (le module autoconso tourne dans un iframe), donc la mise à jour du champ
    // "Productible" du modal économique est immédiate, sans action de l'utilisateur.
    try {
        if (data.pv_summary && data.pv_summary.summary) {
            localStorage.setItem('sharedSolarProduction', JSON.stringify({ summary: data.pv_summary.summary }));
        }
    } catch (e) {
        console.warn("Impossible de partager le productible calculé", e);
    }
    // NOUVEAU: Sauvegarder les options de vente en totalité
    try {
        if (data.p90_params) {
            localStorage.setItem('vente_totalite_options', JSON.stringify(data.p90_params));
        } else {
            localStorage.removeItem('vente_totalite_options');
        }
    } catch (e) {
        console.warn("Impossible de sauvegarder dans le localStorage", e);
    }
}

function escapeHtmlAutoconso(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Résout l'adresse et les coordonnées géographiques du projet actif,
 * avec la même logique de priorisation que pompage solaire :
 * 1. window.ACTIVE_PROJECT_ADRESSE (ou window.parent.ACTIVE_PROJECT_ADRESSE)
 * 2. Repli localStorage('solarProjectData')
 */
function resolveProjectAddressAndCoords() {
    let brut = window.ACTIVE_PROJECT_ADRESSE;
    if (!brut && window.parent && window.parent.ACTIVE_PROJECT_ADRESSE) {
        brut = window.parent.ACTIVE_PROJECT_ADRESSE;
    }

    let libelle = '';
    let lat = null;
    let lon = null;

    if (brut) {
        let parsed = brut;
        if (typeof parsed === 'string') {
            try {
                parsed = JSON.parse(parsed);
                if (typeof parsed === 'string') {
                    try { parsed = JSON.parse(parsed); } catch (e) {}
                }
            } catch (e) {
                if (typeof brut === 'string' && brut.trim() && !brut.trim().startsWith('{')) {
                    libelle = brut.trim();
                }
            }
        }
        if (parsed && typeof parsed === 'object') {
            libelle = parsed.adresse || parsed.libelle || parsed.formatted_address || parsed.name || '';
            const pLat = parsed.latitude !== undefined ? parsed.latitude : (parsed.lat !== undefined ? parsed.lat : null);
            const pLon = parsed.longitude !== undefined ? parsed.longitude : (parsed.lon !== undefined ? parsed.lon : (parsed.lng !== undefined ? parsed.lng : null));
            if (pLat !== null && Number.isFinite(Number(pLat))) lat = Number(pLat);
            if (pLon !== null && Number.isFinite(Number(pLon))) lon = Number(pLon);
        }
    }

    // Repli localStorage solarProjectData
    if (!libelle || lat === null || lon === null) {
        try {
            const saved = localStorage.getItem('solarProjectData');
            if (saved) {
                const projectData = JSON.parse(saved);
                if (projectData.projectInfo) {
                    const addrRaw = projectData.projectInfo.adresseProjet || projectData.projectInfo.adresse_projet || projectData.projectInfo.adresse;
                    if (addrRaw) {
                        let pAddr = addrRaw;
                        if (typeof pAddr === 'string') {
                            try { pAddr = JSON.parse(pAddr); } catch (e) {}
                        }
                        if (typeof pAddr === 'object' && pAddr !== null) {
                            if (!libelle) libelle = pAddr.adresse || pAddr.libelle || pAddr.formatted_address || '';
                            if (lat === null) {
                                const l = pAddr.latitude !== undefined ? pAddr.latitude : pAddr.lat;
                                if (l !== null && Number.isFinite(Number(l))) lat = Number(l);
                            }
                            if (lon === null) {
                                const l = pAddr.longitude !== undefined ? pAddr.longitude : (pAddr.lon !== undefined ? pAddr.lon : pAddr.lng);
                                if (l !== null && Number.isFinite(Number(l))) lon = Number(l);
                            }
                        } else if (typeof pAddr === 'string' && !libelle) {
                            libelle = pAddr;
                        }
                    }
                }
                if (lat === null || lon === null) {
                    const coords = projectData.selectedShapeCenter || projectData.mapCenter;
                    if (coords && coords.lat !== undefined && (coords.lng !== undefined || coords.lon !== undefined)) {
                        lat = Number(coords.lat);
                        lon = Number(coords.lng !== undefined ? coords.lng : coords.lon);
                    } else if (projectData.shapes && Object.keys(projectData.shapes).length > 0) {
                        const firstShapeId = Object.keys(projectData.shapes)[0];
                        const firstShape = projectData.shapes[firstShapeId];
                        if (firstShape && firstShape.center) {
                            lat = Number(firstShape.center.lat);
                            lon = Number(firstShape.center.lng !== undefined ? firstShape.center.lng : firstShape.center.lon);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("Erreur repli solarProjectData pour l'adresse", e);
        }
    }

    return {
        libelle: libelle || 'Adresse du projet',
        lat: (lat !== null && Number.isFinite(lat)) ? lat : null,
        lon: (lon !== null && Number.isFinite(lon)) ? lon : null
    };
}


// Afficher les résultats dans le panneau de droite et initialiser les contrôles
function displayResults(results) {
    // Sécurité : Vérifier que les données ont la structure attendue (avec 'site_keys').
    // Cela évite les erreurs si d'anciennes données sont chargées depuis le localStorage.
    if (!results || !results.site_keys) {
        console.warn("Données de simulation invalides ou dans un ancien format. Les résultats ne seront pas affichés.", results);
        localStorage.removeItem('solar_sim_data'); // Nettoyer les données invalides
        return;
    }
    const container = document.getElementById('results-container');

    // Vérification s'il y a plusieurs sites pour afficher ou masquer les filtres
    // Vue détaillée proposée dès que la consommation se décompose en au moins deux usages.
    const nbUsages = ['Cons. existante', 'Cons. IRVE', 'Cons. PAC'].filter(k => results.site_keys.includes(k)).length;
    const filterDisplay = nbUsages >= 2 ? 'flex' : 'none';

    // NOUVEAU: Récupérer le type d'étude pour affichage conditionnel
    const studyType = document.querySelector('input[name="study_type"]:checked').value;

    const globalSummary = results.sites['Global'].summary;

    // NOUVEAU: Cartes agrégées (somme/moyenne pondérée sur l'ensemble des champs PV) —
    // Puissance projet, Productible (P50) et PR global, avec le même style que les
    // cartes de résultats existantes (Production PV totale, Énergie autoconsommée, Excédent).
    let pvAggregateStatsHtml = '';
    if (results.pv_summary && results.pv_summary.summary && results.pv_summary.summary.peak_power_kw != null) {
        const pvAgg = results.pv_summary.summary;
        pvAggregateStatsHtml = `
            <div class="stat-card">
                <div class="label">Puissance projet</div>
                <div class="value" id="stat-peak-power">${pvAgg.peak_power_kw.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} kWc</div>
            </div>
            <div class="stat-card">
                <div class="label">Productible (P50)</div>
                <div class="value" id="stat-specific-yield">${Math.round(pvAgg.specific_production).toLocaleString('fr-FR')} kWh/kWc/an</div>
            </div>
            <div class="stat-card">
                <div class="label">PR</div>
                <div class="value" id="stat-pr">${pvAgg.performance_ratio.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</div>
            </div>
        `;
    }

    // NOUVEAU: HTML conditionnel pour le tableau et les camemberts
    const summaryTableHtml = studyType !== 'vente_totalite' ? `
        <div>
            <div class="table-header-controls">
                <h3>Tableau récapitulatif</h3>
                <div class="site-filter-container" style="display: ${filterDisplay}">
                     <label for="site-filter-dropdown" style="margin: 0; font-size: 0.95rem;">Vue détaillée :</label>
                     <select id="site-filter-dropdown" onchange="filterResults(this.value)"></select>
                </div>
            </div>
            <table id="results-table">
                <thead></thead>
                <tbody></tbody>
            </table>
        </div>
    ` : '';

    const pieChartsHtml = studyType !== 'vente_totalite' ? `
        <div id="pie-charts-wrapper">
            <div id="pie-charts-header">
                <h3>Analyse des taux (Autoproduction / Autoconsommation)</h3>
                <div class="site-filter-container" style="display: ${filterDisplay}">
                    <label for="site-filter-dropdown-pie" style="margin: 0; font-size: 0.95rem;">Vue détaillée :</label>
                    <select id="site-filter-dropdown-pie" onchange="filterResults(this.value)"></select>
                </div>
            </div>
            <div class="pie-charts-grid" id="individual-pie-charts"></div>
        </div>
    ` : '';

    // NOUVEAU: Ajustement du titre de l'histogramme pour la vente en totalité
    const monthlyChartTitle = studyType === 'vente_totalite' ? 'Production PV mensuelle (Année 1)' : 'Analyse mensuelle (MWh)';
    const monthlyChartSiteSpan = studyType !== 'vente_totalite' ? `- <span id="monthly-chart-title">Global</span>` : '';

    // NOUVEAU: Conteneurs pour les graphiques P50/P90
    const controlsSectionHtml = `
    <div class="controls-section">
        <div class="filter-group">
            ${studyType !== 'vente_totalite' ? `
                <label><input type="checkbox" id="show-pie-charts" checked> Afficher les camemberts</label>
                <label><input type="checkbox" id="show-bar-chart" checked> Afficher l'histogramme</label>
            ` : ''}
        </div>
        <div class="export-group">
            ${window.isEmbeddedMode
                ? `<button onclick="openStorageModal()" class="btn-secondary">🔋 Stockage d'énergie</button>`
                : `<button onclick="exportToPDFJS()" class="btn-secondary">📄 Export PDF (JS)</button>`}
            <button onclick="exportToExcel()" class="btn-secondary">💹 Exporter Excel</button>
            <button onclick="toggleSeasonalAnalysis()" class="btn-secondary">📅 Analyses Saisonnières</button>
            <button onclick="toggleDetailedPvResults()" class="btn-secondary">🔍 Résultats détaillés</button>
        </div>
    </div>
    `;

    // NOUVEAU (demande explicite) : taux de couverture photovoltaïque des projets « Site autonome »,
    // affiché avec les autres indicateurs de performance énergétique — c'est le seul endroit du
    // parcours où la production annuelle et le besoin annuel du site sont tous deux disponibles.
    //
    // Base ÉNERGÉTIQUE : production annuelle calculée par le back-end / besoin annuel d'énergie du
    // site (issu du pré-dimensionnement, modal « Consommation d'énergie »). Remplace un rapport de
    // puissances purement théorique, et prendra automatiquement en compte les pertes d'ombrage le
    // jour où le calcul de production les intégrera.
    // Valeur calculée et enregistrée par le serveur avec ce calcul (production annuelle / consommation
    // du pré-dimensionnement enregistré) : la même que celle reprise par l'étude économique — plus
    // de calcul ici à partir du résumé gardé dans le localStorage.
    let tauxCouvertureStatHtml = '';
    if (typeof window.isSiteAutonomeProject === 'function' && window.isSiteAutonomeProject()) {
        const tauxCouverture = Number.isFinite(Number(results.taux_couverture_pct)) && results.taux_couverture_pct !== null
            ? Number(results.taux_couverture_pct) : null;
        if (tauxCouverture !== null) {
            // Au-delà de 100 %, la production annuelle dépasse le besoin : signalé en orange, sans
            // plafonnement — c'est un surdimensionnement, pas une erreur.
            const couleur = tauxCouverture > 100 ? '#b45309' : '#15803d';
            tauxCouvertureStatHtml = `
            <div class="stat-card">
                <div class="label" title="Production PV annuelle rapportée au besoin annuel d'énergie du site (pré-dimensionnement enregistré, hors IRVE).">Taux de couverture photovoltaïque</div>
                <div class="value" id="stat-taux-couverture-pv" style="color:${couleur};">${tauxCouverture.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</div>
            </div>`;
        }
    }

    // NOUVEAU: Bloc unique "Indicateurs de performance énergétique" — pour l'ACI/ACC il reprend
    // les 3 cartes historiques + les 3 cartes agrégées PV ; pour la vente en totalité, seules les
    // 3 cartes agrégées PV ont un sens (pas de notion d'autoconsommation/excédent).
    const performanceStatsHtml = studyType === 'vente_totalite' ? (
        (pvAggregateStatsHtml || tauxCouvertureStatHtml) ? `
            <h3>Indicateurs de performance énergétique</h3>
            <div class="stats-grid">${pvAggregateStatsHtml}${tauxCouvertureStatHtml}</div>
        ` : ''
    ) : `
        <h3>Indicateurs de performance énergétique</h3>
        <div class="stats-grid">${pvAggregateStatsHtml}${tauxCouvertureStatHtml}</div>
        <div class="stats-grid" style="margin-top: 1rem;">
            <div class="stat-card">
                <div class="label">Production PV totale</div>
                <div class="value" id="stat-production">${globalSummary.production_mwh.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MWh</div>
            </div>
            <div class="stat-card">
                <div class="label">Énergie PV autoconsommée</div>
                <div class="value" id="stat-consumed">${globalSummary.pv_consumed_mwh.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MWh</div>
            </div>
            <div class="stat-card">
                <div class="label">Excédent d'énergie (Global)</div>
                <div class="value" id="stat-surplus">${globalSummary.surplus_mwh.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MWh</div>
            </div>
        </div>
    `;

    const venteTotaliteChartsHtml = studyType === 'vente_totalite' ? `
        <div id="monthly-p50-chart-container" class="chart-item-full" style="display: none;">
            <h3>Production PV mensuelle (P50 - Année 1)</h3>
            <div class="main-chart-container" style="height: 300px;"><canvas id="monthly-p50-chart"></canvas></div>
        </div>
        <div id="p50-p90-charts-container" class="p50-p90-charts-grid"></div>
    ` : '';

    // NOUVEAU: Adresse du projet (même mise en forme que dans pompage solaire, placée au-dessus de la première carte de contrôle)
    const siteInfo = resolveProjectAddressAndCoords();
    const siteLibelle = (siteInfo && siteInfo.libelle) ? siteInfo.libelle : 'Adresse du projet';
    const siteCoordsText = (siteInfo && siteInfo.lat !== null && siteInfo.lon !== null)
        ? ` (${Number(siteInfo.lat).toFixed(5)}, ${Number(siteInfo.lon).toFixed(5)})`
        : '';
    const siteAddressHtml = `
    <div style="background-color: #f8fafc; border: 1px solid var(--border-color); border-radius: var(--border-radius-md); padding: 0.75rem 1rem; margin-bottom: 1.25rem;">
        <p style="margin:0; font-size:0.85rem; color: var(--text-primary);">
            <strong style="color: var(--text-secondary);">Site :</strong>
            <span id="autoconso_site_libelle" style="font-weight: 600;">${escapeHtmlAutoconso(siteLibelle)}</span>
            <span id="autoconso_site_coords" style="color: var(--text-secondary); font-size: 0.8rem;">${siteCoordsText}</span>
        </p>
    </div>
    `;

    container.innerHTML = `
                ${siteAddressHtml}
                ${controlsSectionHtml}
                ${performanceStatsHtml}
                ${venteTotaliteChartsHtml}

                <div class="charts-container">
                    ${studyType !== 'vente_totalite' ? pieChartsHtml : ''}
                    <div id="bar-charts-wrapper">
                         <div style="${studyType === 'vente_totalite' ? 'display: none;' : ''}">
                             <h3>${monthlyChartTitle} ${monthlyChartSiteSpan}</h3>
                            <div class="main-chart-container">
                                <canvas id="monthly-chart"></canvas>
                            </div>
                        </div>
                    </div>
                </div>

                ${summaryTableHtml}

                <!-- Le conteneur pour l'analyse de rentabilité est maintenant ici -->
                <div id="pac-gain-ecs-container"></div>
                <div id="economic-results-container"></div>
                
                <div id="seasonal-analysis-section" style="display: none;"></div>
                <div id="detailed-pv-results-section" style="display: none;"></div>
                <div id="storage-results-container" style="display: none;"></div>
            `;

    afficherGainEcsSolaire(results);

    // Remplissage des listes déroulantes du filtre (Tableau et Graphiques)
    const dropdownTable = document.getElementById('site-filter-dropdown');
    const dropdownPie = document.getElementById('site-filter-dropdown-pie');

    // NOUVEAU: N'exécuter cette logique que si les éléments existent
    if (dropdownTable && dropdownPie) {
        const dropdownOptions = results.site_keys.map(key => {
            const consumerData = accConsFiles.get(key);
            const label = key === 'Global' ? 'Total' : (consumerData?.customName || key);
            return `<option value="${key}">${label}</option>`;
        }).join('');

        dropdownTable.innerHTML = dropdownOptions;
        dropdownPie.innerHTML = dropdownOptions;

        // Synchronisation des deux dropdowns
        dropdownTable.addEventListener('change', (e) => {
            dropdownPie.value = e.target.value;
            filterResults(e.target.value);
        });
        dropdownPie.addEventListener('change', (e) => {
            dropdownTable.value = e.target.value;
            filterResults(e.target.value);
        });
    }

    // Ajouter les écouteurs pour les filtres d'affichage
    const showPieCheckbox = document.getElementById('show-pie-charts');
    if (showPieCheckbox) {
        showPieCheckbox.addEventListener('change', () => filterResults(dropdownTable.value));
    }
    const showBarCheckbox = document.getElementById('show-bar-chart');
    if (showBarCheckbox) {
        showBarCheckbox.addEventListener('change', () => filterResults(dropdownTable.value));
    }

    // NOUVEAU: Rendu des graphiques économiques
    if (studyType === 'acc') {
        rerunEconomicAnalysis();
    }

    // NOUVEAU: Rendu des graphiques P50/P90 si les données existent
    if (results.p50_p90_data) {
        renderP50P90Charts(results.p50_p90_data);
        // NOUVEAU: Afficher le graphique mensuel P50 pour la vente en totalité
        if (studyType === 'vente_totalite') {
            renderMonthlyP50Chart(results.sites['Global'].charts.monthly_bar, results.sites['Global'].summary.production_mwh);
        }
    }
}

/**
 * NOUVEAU: Affiche les graphiques d'évolution P50 et P90.
 * @param {object} data - Les données contenant les séries P50 et P90.
 */
function renderP50P90Charts(data) {
    const container = document.getElementById('p50-p90-charts-container');
    if (!container) return;

    container.innerHTML = `
        <div class="chart-item-full">
            <h3>Évolution de la production annuelle (P50 vs P90)</h3>
            <div class="main-chart-container" style="height: 300px;"><canvas id="p50-p90-chart"></canvas></div>
            <div id="p50-p90-totals" style="text-align: center; margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-secondary, #555);"></div>
        </div>
    `;

    // L'An 1 (indice 0) n'a par définition aucune dégradation appliquée (facteur (1-d)^0 = 1) :
    // c'est donc directement la production P50 de base, réutilisée par recomputeP50P90FromInputs()
    // pour recalculer les séries dans le navigateur sans rappeler le serveur.
    p50p90BaseProdMwh = Array.isArray(data.p50) && data.p50.length > 0 ? data.p50[0] : null;

    if (p50p90Chart) {
        p50p90Chart.destroy();
        p50p90Chart = null;
    }

    p50p90Chart = new Chart(document.getElementById('p50-p90-chart'), {
        type: 'bar', // MODIFIÉ: 'line' -> 'bar'
        data: {
            labels: data.labels, // ['An 1', 'An 2', ...]
            datasets: [
                { label: 'Production P50 (MWh)', data: data.p50, backgroundColor: 'rgba(54, 162, 235, 0.7)', borderRadius: 4 },
                { label: 'Production P90 (MWh)', data: data.p90, backgroundColor: 'rgba(255, 159, 64, 0.7)', borderRadius: 4 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Production (MWh)' } } } }
    });

    updateP50P90Totals(data.p50, data.p90);
    setupP50P90LiveUpdate();
}

/**
 * NOUVEAU: Affiche, sous le graphique (après la légende), la somme de la production P50 et P90
 * cumulée sur tout l'horizon d'étude (20 ou 30 ans selon data.p50/data.p90).
 * @param {number[]} p50Series - Série annuelle P50 (MWh).
 * @param {number[]} p90Series - Série annuelle P90 (MWh).
 */
function updateP50P90Totals(p50Series, p90Series) {
    const el = document.getElementById('p50-p90-totals');
    if (!el || !Array.isArray(p50Series) || !Array.isArray(p90Series)) return;

    const horizon = p50Series.length;
    const totalP50 = p50Series.reduce((sum, v) => sum + v, 0);
    const totalP90 = p90Series.reduce((sum, v) => sum + v, 0);
    const fmt = (v) => v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    el.innerHTML = `<strong>Somme sur ${horizon} ans</strong> — Production P50 : ${fmt(totalP50)} MWh &nbsp;|&nbsp; Production P90 : ${fmt(totalP90)} MWh`;
}

/**
 * NOUVEAU: Reproduit côté front le calcul P50/P90 du backend (cf.
 * calcul_vente_totalite.py::process_vente_totalite_data), à partir de la production de base
 * (P50 An 1) déjà calculée par le serveur. Le calcul backend reste la source de vérité utilisée
 * pour le rapport PDF ; celui-ci ne sert qu'à une prévisualisation instantanée dans le graphique.
 * @param {number} baseProdMwh - Production P50 de l'An 1 (MWh, sans dégradation ni incertitude).
 * @param {number} incertitudeProdPercent - Incertitude totale sur la production (%).
 * @param {number} incertitudeMeteoPercent - Incertitude météo (%).
 * @param {number} degradationPercent - Dégradation annuelle des panneaux (%).
 * @param {number} horizon - Nombre d'années.
 * @returns {{labels: string[], p50: number[], p90: number[]}}
 */
function computeP50P90Series(baseProdMwh, incertitudeProdPercent, incertitudeMeteoPercent, degradationPercent, horizon) {
    const zScoreP90 = 1.282; // Z-score pour une probabilité de 90%
    const degradationRate = (degradationPercent || 0) / 100;
    const incertitudeProdRate = (incertitudeProdPercent || 0) / 100;
    const incertitudeMeteoRate = (incertitudeMeteoPercent || 0) / 100;
    const totalIncertitudeRate = Math.sqrt(incertitudeProdRate ** 2 + incertitudeMeteoRate ** 2);

    const labels = [];
    const p50 = [];
    const p90 = [];
    for (let year = 0; year < horizon; year++) {
        const p50Year = baseProdMwh * ((1 - degradationRate) ** year);
        const p90Year = p50Year * (1 - zScoreP90 * totalIncertitudeRate);
        labels.push(`An ${year + 1}`);
        p50.push(p50Year);
        p90.push(p90Year);
    }
    return { labels, p50, p90 };
}

/**
 * NOUVEAU: Recalcule et met à jour instantanément le graphique P50/P90 à partir des champs de
 * saisie actuels, sans appel serveur. Appelé par les écouteurs mis en place dans
 * setupP50P90LiveUpdate() dès que l'utilisateur modifie un des paramètres d'incertitude/dégradation.
 */
function recomputeP50P90FromInputs() {
    if (p50p90BaseProdMwh === null || !p50p90Chart) return;

    const incertitudeProd = parseFloat(document.getElementById('vt_incertitude_prod')?.value);
    const incertitudeMeteo = parseFloat(document.getElementById('vt_incertitude_meteo')?.value);
    const degradation = parseFloat(document.getElementById('vt_degradation')?.value);
    const horizon = parseInt(document.getElementById('vt_horizon')?.value);
    if (isNaN(incertitudeProd) || isNaN(incertitudeMeteo) || isNaN(degradation) || isNaN(horizon)) return;

    const { labels, p50, p90 } = computeP50P90Series(p50p90BaseProdMwh, incertitudeProd, incertitudeMeteo, degradation, horizon);

    p50p90Chart.data.labels = labels;
    p50p90Chart.data.datasets[0].data = p50;
    p50p90Chart.data.datasets[1].data = p90;
    p50p90Chart.update();
    updateP50P90Totals(p50, p90);
}

// NOUVEAU: Évite d'attacher plusieurs fois les mêmes écouteurs (setupP50P90LiveUpdate() est
// rappelée à chaque nouveau calcul, car les champs #vt_* sont régénérés par handleStudyTypeChange()).
let p50p90LiveUpdateInputsBound = null;
function setupP50P90LiveUpdate() {
    const ids = ['vt_incertitude_prod', 'vt_incertitude_meteo', 'vt_degradation', 'vt_horizon'];
    const inputs = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (p50p90LiveUpdateInputsBound) {
        p50p90LiveUpdateInputsBound.forEach(el => {
            el.removeEventListener('input', recomputeP50P90FromInputs);
            el.removeEventListener('change', recomputeP50P90FromInputs);
        });
    }
    inputs.forEach(el => {
        el.addEventListener('input', recomputeP50P90FromInputs);
        el.addEventListener('change', recomputeP50P90FromInputs);
    });
    p50p90LiveUpdateInputsBound = inputs;
}

/**
 * NOUVEAU: Affiche le graphique de production mensuelle P50 pour la vente en totalité.
 * @param {object} data - Les données du graphique mensuel.
 */
function renderMonthlyP50Chart(data, totalP50MWh) {
    const container = document.getElementById('monthly-p50-chart-container');
    const canvas = document.getElementById('monthly-p50-chart');
    if (!container || !canvas) return;

    container.style.display = 'block';

    const titleElement = container.querySelector('h3');
    titleElement.innerHTML = `Production PV mensuelle (P50 - Année 1) <span style="font-weight: normal; color: var(--text-secondary);">- Total: ${totalP50MWh.toFixed(2)} MWh</span>`;

    new Chart(canvas, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: data.datasets
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Production (MWh)' } } } }
    });
}

// Fonction pour filtrer et afficher les résultats
/**
 * Le stockage (calculateStorage()) ne modifie jamais `simulationResults` — il calcule un taux
 * d'autoconsommation COMBINÉ (PV + batterie) séparément (window.storageResults.outputs). Sans ce
 * correctif, les KPI globaux et le tableau récapitulatif continuaient d'afficher indéfiniment le
 * taux PV SEUL (bug détecté à l'audit), même après un calcul de stockage réussi. Cette fonction
 * ne mute rien : elle renvoie un résumé enrichi (copie) à utiliser pour l'AFFICHAGE uniquement.
 *
 * `siteKey` détermine QUEL taux combiné backend s'applique à cette colonne : "Global"/"Cons.
 * Totale" utilisent le taux combiné global (taux_combine), "Cons. existante"/"Cons. IRVE"
 * utilisent leur taux combiné respectif (taux_ext/taux_irve, déjà décomposés côté backend — cf.
 * calcul_stockage.py). Les sites individuels ACC ne sont pas concernés (le stockage est un
 * dispositif de site global, non attribuable à un consommateur ACC en particulier) et restent
 * inchangés.
 *
 * Taux d'autoproduction (avec stockage) = énergie PV+stockage consommée / consommation totale du
 * site (et non plus seulement la production PV consommée directement) — la présence de stockage
 * réduit le soutirage réseau, donc augmente ce taux à consommation égale.
 */
function getStorageOverriddenSummary(site, siteKey) {
    const storageToggle = document.querySelector('input[name="storage-toggle"]:checked');
    const storageActive = storageToggle && storageToggle.value === 'oui' && stockagePrisEnCompte();
    if (!storageActive || !window.storageResults?.outputs || !site?.summary) {
        return site?.summary || {};
    }
    const o = window.storageResults.outputs;
    const productionMwh = site.summary.production_mwh || 0;
    const consumptionMwh = site.summary.consumption_mwh || 0;

    let autoconsumptionRate;
    let pvConsumedMwh;
    if (siteKey === 'Global' || siteKey === 'Cons. Totale') {
        autoconsumptionRate = o.taux_combine;
        pvConsumedMwh = o.sto_prod_autoconsommee;
    } else if (siteKey === 'Cons. existante') {
        autoconsumptionRate = o.taux_ext;
        pvConsumedMwh = productionMwh * (o.taux_ext / 100);
    } else if (siteKey === 'Cons. IRVE') {
        autoconsumptionRate = o.taux_irve;
        pvConsumedMwh = productionMwh * (o.taux_irve / 100);
    } else if (siteKey === 'Cons. PAC' && o.taux_pac != null) {
        autoconsumptionRate = o.taux_pac;
        pvConsumedMwh = productionMwh * (o.taux_pac / 100);
    } else {
        // Consommateur ACC individuel, ou clé non reconnue : pas de contribution stockage attribuable.
        return site.summary;
    }
    if (autoconsumptionRate == null || pvConsumedMwh == null) return site.summary;

    const autoproductionRate = consumptionMwh > 0 ? (pvConsumedMwh / consumptionMwh) * 100 : site.summary.autoproduction_rate;

    return {
        ...site.summary,
        autoconsumption_rate: autoconsumptionRate,
        autoproduction_rate: autoproductionRate,
        pv_consumed_mwh: pvConsumedMwh,
        surplus_mwh: Math.max(0, productionMwh - pvConsumedMwh)
    };
}

/**
 * Camemberts autoproduction/autoconsommation avec le stockage : le backend les construit à partir
 * du taux PV SEUL ; sans cette substitution, le camembert d'autoproduction restait figé après l'ajout
 * d'une batterie alors que le tableau récapitulatif, lui, augmentait. L'ordre des parts diffère
 * selon le calcul (ACI : [excédent, autoconso] ; ACC : [autoconso, reste]) : la part à remplacer est
 * repérée par sa valeur d'origine (taux du résumé backend), l'autre part devient le complément à 100.
 */
function camembertAvecTaux(pie, tauxOrigine, nouveauTaux) {
    if (!pie || !Array.isArray(pie.data) || pie.data.length !== 2 || nouveauTaux == null || tauxOrigine == null) return pie;
    const idx = Math.abs(pie.data[0] - tauxOrigine) <= Math.abs(pie.data[1] - tauxOrigine) ? 0 : 1;
    const data = [...pie.data];
    data[idx] = nouveauTaux;
    data[1 - idx] = Math.max(0, 100 - nouveauTaux);
    return { ...pie, data };
}

function camembertsAvecStockage(siteData, siteLabel) {
    const charts = siteData?.charts || {};
    const resume = siteData?.summary;
    const affiche = getStorageOverriddenSummary(siteData, siteLabel);
    if (!resume || affiche === resume) return { pie_autoprod: charts.pie_autoprod, pie_autocons: charts.pie_autocons };
    return {
        pie_autoprod: camembertAvecTaux(charts.pie_autoprod, resume.autoproduction_rate, affiche.autoproduction_rate),
        pie_autocons: camembertAvecTaux(charts.pie_autocons, resume.autoconsumption_rate, affiche.autoconsumption_rate),
    };
}

function filterResults(siteLabel) {
    if (!simulationResults) return;

    const results = simulationResults;
    const showPies = document.getElementById('show-pie-charts')?.checked ?? true;
    const showBar = document.getElementById('show-bar-chart')?.checked ?? true;

    const siteData = results.sites[siteLabel];
    if (!siteData) {
        console.error("Données manquantes pour", siteLabel);
        return;
    }

    // 1. Mise à jour des KPIs (taux combiné PV+stockage si le stockage est actif et calculé)
    const displaySummary = getStorageOverriddenSummary(siteData, siteLabel);
    const statProd = document.getElementById('stat-production');
    if (statProd) {
        statProd.textContent = siteData.summary.production_mwh.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MWh';
        document.getElementById('stat-consumed').textContent = displaySummary.pv_consumed_mwh.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MWh';
        document.getElementById('stat-surplus').textContent = displaySummary.surplus_mwh.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MWh';
    }

    // 2. Mise à jour du Tableau Récapitulatif
    updateTable(results, siteLabel);

    // 3. Mise à jour des Graphiques
    renderCharts(results, siteLabel, showPies, showBar);

    // 4. Mise à jour Analyses Saisonnières (si visible)
    const seasonalSection = document.getElementById('seasonal-analysis-section');
    if (seasonalSection && seasonalSection.style.display !== 'none') {
        renderSeasonalAnalysis(siteLabel);
    }
}

function updateTable(results, siteLabel) {
    const tableHead = document.querySelector('#results-table thead');
    const tableBody = document.querySelector('#results-table tbody');
    // Le tableau récapitulatif n'est pas rendu en vente en totalité (summaryTableHtml vide) : rien à mettre à jour.
    if (!tableHead || !tableBody) return;
    const isGlobal = siteLabel === 'Global';

    const studyType = document.querySelector('input[name="study_type"]:checked').value;
    const headers = ['Indicateur'];
    let sitesToDisplay = [];
    // Clés de site en parallèle de sitesToDisplay (même index) — nécessaires pour appliquer le bon
    // taux combiné stockage par colonne (cf. getStorageOverriddenSummary), puisque plusieurs
    // colonnes peuvent représenter des flux différents (existante/IRVE/global) dans un même tableau.
    let keysToDisplay = [];

    if (isGlobal) {
        // En ACI, on exclut 'Cons. Totale'. En ACC, on affiche tous les consommateurs.
        const filteredKeys = results.site_keys.filter(key => key !== 'Global' && (studyType === 'acc' || key !== 'Cons. Totale'));
        const headerLabels = filteredKeys.map(key => {
            return accConsFiles.get(key)?.customName || key;
        });
        headers.push(...headerLabels, 'Res. Globaux');
        sitesToDisplay = filteredKeys.map(key => results.sites[key]);
        keysToDisplay = [...filteredKeys];

        // On ajoute les données globales à la fin pour la nouvelle colonne
        sitesToDisplay.push(results.sites['Global']);
        keysToDisplay.push('Global');

    } else if (siteLabel === 'Cons. Totale') {
        const colsToAdd = ['Cons. existante', 'Cons. IRVE', 'Cons. PAC', 'Cons. Totale'].filter(k => results.site_keys.includes(k));
        headers.push(...colsToAdd);
        sitesToDisplay = colsToAdd.map(k => results.sites[k]);
        keysToDisplay = [...colsToAdd];

    } else {
        headers.push(siteLabel);
        sitesToDisplay = [results.sites[siteLabel]];
        keysToDisplay = [siteLabel];
    }

    tableHead.innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;

    const formatNum = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MWh';
    const formatPercent = (n) => n.toFixed(2) + ' %';

    const rows = [
        { label: "Taux d'autoconsommation", key: 'autoconsumption_rate', formatter: formatPercent },
        { label: "Taux d'autoproduction", key: 'autoproduction_rate', formatter: formatPercent },
        { label: "Consommation totale", key: 'consumption_mwh', formatter: formatNum },
        { label: "Énergie PV consommée", key: 'pv_consumed_mwh', formatter: formatNum },
        { label: "Excédent d'énergie non consommé", key: 'surplus_mwh', formatter: formatNum },
    ];

    let tableBodyHtml = '';
    rows.forEach(rowData => {
        let rowHtml = `<td>${rowData.label}</td>`;
        sitesToDisplay.forEach((res, idx) => {
            // Chaque colonne (Cons. existante / Cons. IRVE / Global / Cons. Totale) affiche le taux
            // combiné PV+stockage qui lui correspond si le stockage a été calculé — cf.
            // getStorageOverriddenSummary(). Les consommateurs ACC individuels ne sont pas
            // concernés : le stockage est un dispositif de site, pas par consommateur.
            const summary = getStorageOverriddenSummary(res, keysToDisplay[idx]);
            // Vérifie explicitement la présence de la donnée (gère null et undefined)
            const value = summary && summary[rowData.key] != null ? summary[rowData.key] : 0;
            rowHtml += `<td>${rowData.formatter(value)}</td>`;
        });
        tableBodyHtml += `<tr>${rowHtml}</tr>`;
    });
    tableBody.innerHTML = tableBodyHtml;
}

// Fonction pour générer/mettre à jour les graphiques en fonction des filtres
function renderCharts(results, siteLabel, showPies, showBar) {
    const studyType = document.querySelector('input[name="study_type"]:checked').value;
    const pieWrapper = document.getElementById('pie-charts-wrapper');
    const barWrapper = document.getElementById('bar-charts-wrapper');

    // Masquer les camemberts si l'option est décochée OU si on est en vente en totalité
    if (pieWrapper) pieWrapper.style.display = (showPies && studyType !== 'vente_totalite') ? '' : 'none';
    barWrapper.style.display = showBar ? '' : 'none';

    if (monthlyChart) monthlyChart.destroy();
    individualCharts.forEach(c => c.destroy());
    individualCharts.length = 0;

    const siteData = results.sites[siteLabel];
    if (!siteData) return;

    // 1. Graphiques Camemberts
    if (showPies && studyType !== 'vente_totalite') {
        const pieContainer = document.getElementById('individual-pie-charts');
        pieContainer.innerHTML = '';

        // Mettre à jour les sélecteurs
        document.getElementById('site-filter-dropdown').value = siteLabel;
        document.getElementById('site-filter-dropdown-pie').value = siteLabel;

        // Taux PV + stockage si une batterie est prise en compte (cf. camembertsAvecStockage).
        const { pie_autoprod: pieAutoprod, pie_autocons: pieAutocons } = camembertsAvecStockage(siteData, siteLabel);
        createPieChart(pieContainer, pieAutoprod.title, pieAutoprod);
        createPieChart(pieContainer, pieAutocons.title, pieAutocons);
    }

    // 2. Histogramme Mensuel
    if (showBar && studyType !== 'vente_totalite') {
        document.getElementById('monthly-chart-title').textContent = siteLabel;
        const barData = siteData.charts.monthly_bar;

        monthlyChart = new Chart(document.getElementById('monthly-chart'), {
            type: 'bar',
            data: {
                labels: barData.labels,
                datasets: barData.datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 0 }, // Correction affichage initial et export PDF
                plugins: {
                    legend: { display: true, position: 'top' },
                    tooltip: { mode: 'index', intersect: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Énergie (MWh)' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
    }
}

function createPieChart(container, title, chartData) {
    const chartDiv = document.createElement('div');
    chartDiv.classList.add('chart-item');
    chartDiv.innerHTML = `<h3>${title}</h3><canvas></canvas>`;
    container.appendChild(chartDiv);

    const formattedLabels = chartData.data.map((val, index) => `${chartData.labels[index]} (${val.toFixed(2)}%)`);

    const chart = new Chart(chartDiv.querySelector('canvas'), {
        type: 'doughnut',
        data: {
            labels: formattedLabels,
            datasets: [{
                data: chartData.data,
                backgroundColor: chartData.colors,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            cutout: '60%',
            animation: { duration: 0 }, // Correction affichage initial et export PDF
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-primary'),
                        font: {
                            size: 10,
                        }
                    }
                },
                datalabels: {
                    display: true,
                    formatter: (value) => value > 5 ? value.toFixed(2) + '%' : '',
                    color: '#fff',
                    font: { weight: 'bold' }
                }
            }
        }
    });
    individualCharts.push(chart);
}


/**
 * Retire l'effet du dernier calcul de stockage et réaffiche les valeurs EXACTES sans batterie :
 * KPI globaux, tableau récapitulatif, analyses mensuelle/saisonnière (qui ne combinent le stockage
 * que si window.storageResults existe, cf. getStorageOverriddenSummary), taux transmis à l'étude
 * économique (solar_storage_data effacé -> repli sur le taux PV seul de solar_sim_data), PR du
 * rapport. Les résultats d'autoconsommation eux-mêmes (simulationResults) ne sont jamais modifiés :
 * ils ne dépendent pas de la batterie. Sans effet s'il n'y a aucun résultat de stockage.
 *
 * @param {string} message texte affiché à l'utilisateur
 * @returns {boolean} true si des résultats de stockage ont effectivement été retirés
 */
function invaliderResultatsStockage(message, textePanneau) {
    const avaitResultats = !!(window.storageResults && window.storageResults.outputs
        && Object.keys(window.storageResults.outputs).length);
    const avaitEnregistrement = !!localStorage.getItem('solar_storage_data');
    if (!avaitResultats && !avaitEnregistrement) return false;

    window.storageResults = null;
    localStorage.removeItem('solar_storage_data');
    retirerResultatsProSolaireEnregistres('stockage');
    if (storageChart) { try { storageChart.destroy(); } catch (e) { /* noop */ } storageChart = null; }

    // Taux d'autoconsommation de référence = taux PV seul, calculé par le serveur (pas d'estimation).
    const tauxSansStockage = parseFloat(simulationResults?.sites?.['Global']?.summary?.autoconsumption_rate);
    if (isFinite(tauxSansStockage)) {
        window.currentSessionAutoconsoRate = tauxSansStockage;
        sessionStorage.setItem('activeAutoconsoRate', tauxSansStockage);
    } else {
        window.currentSessionAutoconsoRate = null;
        sessionStorage.removeItem('activeAutoconsoRate');
    }
    window.dispatchEvent(new CustomEvent('autoconsommationUpdated'));
    window.dispatchEvent(new CustomEvent('autoconsommationCalculated', {
        detail: { rate: isFinite(tauxSansStockage) ? tauxSansStockage : null }
    }));

    // Panneau "Analyse du Stockage" : plus aucun chiffre périmé, remplacé par une invitation claire.
    const container = document.getElementById('storage-results-container');
    if (container) {
        container.innerHTML = `
            <div class="seasonal-analysis-container">
                <h3>Analyse du Stockage</h3>
                <div style="text-align:center; font-weight:600; color:#b45309; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:0.75rem;">
                    ${textePanneau || 'Résultats du stockage à recalculer — les valeurs affichées ci-dessus sont celles <u>sans stockage</u>.'}
                </div>
            </div>`;
    }

    // KPI, tableau récapitulatif et analyses : ré-affichés à partir des résultats d'autoconsommation
    // (inchangés), désormais sans la surcouche stockage.
    if (simulationResults) {
        const dropdownTable = document.getElementById('site-filter-dropdown');
        filterResults(dropdownTable?.value || 'Global');
    }

    // Mise en évidence du bouton qui relance le stockage seul.
    const btn = document.getElementById('storage-launch-btn');
    if (btn) {
        btn.style.boxShadow = '0 0 0 3px rgba(245, 158, 11, 0.6)';
        btn.title = "Recalculer le stockage avec l'option de restitution choisie";
    }

    if (message) showMessage(message, 'error', 9000);
    return true;
}

function resetApp() {
    document.getElementById('results-container').innerHTML = '';
    simulationResults = null;
    window.storageResults = null;
    if (monthlyChart) monthlyChart.destroy();
    individualCharts.forEach(c => c.destroy());
    individualCharts.length = 0;

    // Nettoyage du localStorage (isolation inter-pages) : sans cela, un ancien taux d'autoconsommation
    // combiné (stockage) resterait injecté dans l'étude économique après une réinitialisation, alors
    // qu'aucun résultat n'est plus affiché ici — cf. correctif de calculateStorage() ci-dessus.
    localStorage.removeItem('solar_sim_data');
    localStorage.removeItem('solar_storage_data');
    window.currentSessionAutoconsoRate = null;
    sessionStorage.removeItem('activeAutoconsoRate');
    window.dispatchEvent(new CustomEvent('autoconsommationCalculated', { detail: { rate: null } }));

    showMessage("Les résultats ont été réinitialisés.");
}

// Export PDF coté serveur
async function exportToPDFServer() {
    if (!simulationResults) {
        showMessage("Aucune donnée à exporter.", 'error');
        return;
    }

    // Contrôle strict de la puissance du projet vs licence (+ marge de tolérance)
    if (typeof window.checkPowerLicenceCompliance === 'function') {
        const peakPower = simulationResults?.summary?.peak_power_kw || simulationResults?.sites?.Global?.summary?.peak_power_kw || 0;
        const compliance = window.checkPowerLicenceCompliance(peakPower);
        if (!compliance.allowed) {
            showMessage(compliance.message, 'error', 8000);
            return;
        }
    }

    // S'assurer que les graphiques globaux sont bien rendus avant l'export
    const currentFilter = document.getElementById('site-filter-dropdown').value;
    if (currentFilter !== 'Global') {
        filterResults('Global');
        // Laisser un court instant pour que Chart.js redessine les graphiques
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    const studyType = document.querySelector('input[name="study_type"]:checked').value;
    // Créer la charge utile
    let payload = {
        ...simulationResults,
        storage_results: window.storageResults || null,
        study_type: studyType, // NOUVEAU: Ajouter le type d'étude
        theme_color: localStorage.getItem('themeColor') || '#ef4444' // Ajout de la couleur
    };

    // NOUVEAU: Pour l'ACC, on ajoute les paramètres économiques pour que le backend puisse recalculer
    if (studyType === 'acc') {
        const erreursEco = validerParamsEcoAcc('tout');
        if (erreursEco.length) {
            showMessage('Paramètres économiques invalides : ' + erreursEco.join(' '), 'error', 10000);
            showLoader(false);
            return;
        }
        payload.economic_params = getEconomicParams();
    }

    // NOUVEAU: Ajouter les paramètres P90 si c'est une vente en totalité
    if (studyType === 'vente_totalite') {
        payload.p90_params = {
            incertitude_production: parseFloat(document.getElementById('vt_incertitude_prod')?.value) || 3.5,
            incertitude_meteo: parseFloat(document.getElementById('vt_incertitude_meteo')?.value) || 2.5,
            degradation: parseFloat(document.getElementById('vt_degradation')?.value) || 0.5,
            horizon: parseInt(document.getElementById('vt_horizon')?.value) || 20
        };
    }

    // Récupérer les images des graphiques en Base64
    const pieCanvases = document.querySelectorAll('#individual-pie-charts .chart-item canvas');
    const barCanvas = document.getElementById('monthly-chart');
    const ecoBarCanvas = document.getElementById('eco-comparison-chart');
    const ecoProducerPieCanvas = document.getElementById('eco-producer-chart');

    payload.chartImages = {};
    const p50p90Canvas = document.getElementById('p50-p90-chart');
    const monthlyP50Canvas = document.getElementById('monthly-p50-chart');
    // NOUVEAU: N'envoyer les images des camemberts que si ce n'est pas la vente en totalité
    if (studyType !== 'vente_totalite') {
        if (pieCanvases.length >= 2) {
            payload.chartImages.pie_autoprod = pieCanvases[0].toDataURL('image/png', 1.0);
            payload.chartImages.pie_autocons = pieCanvases[1].toDataURL('image/png', 1.0);
        }
    }
    // NOUVEAU: Envoyer les bons graphiques mensuels et P50/P90
    if (studyType === 'vente_totalite') {
        if (monthlyP50Canvas) {
            payload.chartImages.monthly_bar = monthlyP50Canvas.toDataURL('image/png', 1.0);
        }
        if (p50p90Canvas) {
            payload.chartImages.p50_p90_bar = p50p90Canvas.toDataURL('image/png', 1.0);
        }
    } else if (barCanvas) {
        payload.chartImages.monthly_bar = barCanvas.toDataURL('image/png', 1.0); // Comportement ACI/ACC
    }
    // Ajout des graphiques économiques
    if (ecoBarCanvas) {
        payload.chartImages.eco_comparison_bar = ecoBarCanvas.toDataURL('image/png', 1.0);
    }
    if (ecoProducerPieCanvas) {
        payload.chartImages.eco_producer_pie = ecoProducerPieCanvas.toDataURL('image/png', 1.0);
    }

    showLoader(true);
    try {
        const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
        const response = await fetch(`${apiPrefix}/generate-autoconso-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            let errorMessage = "Erreur lors de la génération du PDF.";
            try {
                const errData = await response.json();
                if (errData && errData.error) {
                    errorMessage += ` Détail : ${errData.error}`;
                }
            } catch (jsonError) { /* La réponse n'était pas JSON */ }
            throw new Error(errorMessage);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "Rapport_Analyse_Photovoltaique_Serveur.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showMessage("Export PDF généré avec succès !");
    } catch (e) {
        handleError(e, 'Export PDF');
    } finally {
        showLoader(false);
        if (currentFilter !== 'Global') filterResults(currentFilter); // Rétablir la vue initiale
    }
}

// Export PDF coté client (JS) avec jsPDF et jspdf-autotable
function exportToPDFJS() {
    // Contrôle strict de la puissance du projet vs licence (+ marge de tolérance)
    if (typeof window.checkPowerLicenceCompliance === 'function') {
        const peakPower = simulationResults?.summary?.peak_power_kw || simulationResults?.sites?.Global?.summary?.peak_power_kw || 0;
        const compliance = window.checkPowerLicenceCompliance(peakPower);
        if (!compliance.allowed) {
            showMessage(compliance.message, 'error', 8000);
            return;
        }
    }

    showMessage("Préparation de l'export PDF côté client...");

    const generatePDFWithAutoTable = () => {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');
            const marginTop = 40; // 1. Décalage vers le bas du rapport
            // Récupération de la couleur active depuis la variable CSS
            const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim();
            const headerColor = hexToRgb(themeColor);
            let currentY = marginTop;

            doc.setFontSize(16);
            doc.setTextColor(...headerColor); // Correction: Utilisation de la couleur du thème
            doc.text("Rapport d'Autoconsommation", 105, currentY, { align: 'center' });
            currentY += 15;

            // Tableau récapitulatif
            const resultsTable = document.getElementById('results-table');
            if (resultsTable) {
                if (currentY > 200) { doc.addPage(); currentY = marginTop; }
                doc.setFontSize(12);
                doc.setTextColor(0, 0, 0);
                doc.text("Tableau récapitulatif", 105, currentY, { align: 'center' });
                doc.autoTable({
                    html: '#results-table',
                    startY: currentY + 5,
                    theme: 'striped',
                    headStyles: { fillColor: headerColor, halign: 'center' },
                    styles: { fontSize: 9, halign: 'center' },
                    pageBreak: 'avoid'
                });
                currentY = doc.lastAutoTable.finalY + 15;
            }

            // 1. Ajout des Camemberts (Analyse des taux)
            const pieItems = document.querySelectorAll('#individual-pie-charts .chart-item');
            if (pieItems.length >= 2) {
                if (currentY > 180) { doc.addPage(); currentY = 15; }
                doc.setFontSize(12);
                doc.setTextColor(0, 0, 0);
                doc.text("Analyse des taux (Autoproduction / Autoconsommation)", 14, currentY);
                currentY += 10;

                const title1 = pieItems[0].querySelector('h3') ? pieItems[0].querySelector('h3').innerText : "Autoproduction";
                const canvas1 = pieItems[0].querySelector('canvas');
                const title2 = pieItems[1].querySelector('h3') ? pieItems[1].querySelector('h3').innerText : "Autoconsommation";
                const canvas2 = pieItems[1].querySelector('canvas');

                doc.setFontSize(10);
                doc.text(title1, 55, currentY, { align: "center" });
                doc.text(title2, 145, currentY, { align: "center" });
                currentY += 5;

                if (canvas1 && canvas2) {
                    doc.addImage(canvas1.toDataURL('image/png', 1.0), 'PNG', 20, currentY, 70, 70);
                    doc.addImage(canvas2.toDataURL('image/png', 1.0), 'PNG', 110, currentY, 70, 70);
                    currentY += 80;
                }
            }

            // 2. Graphique Analyse mensuelle (sur une nouvelle page)
            const barCanvas = document.getElementById('monthly-chart');
            if (barCanvas) {
                doc.addPage();
                currentY = marginTop;
                doc.setFontSize(12);
                doc.setTextColor(0, 0, 0);
                const barTitleRaw = document.querySelector('#bar-charts-wrapper h3') ? document.querySelector('#bar-charts-wrapper h3').innerText : "Analyse mensuelle (MWh) - Global";
                const barTitle = barTitleRaw.replace(/🟡/g, '').trim();
                doc.text(barTitle, 105, currentY, { align: 'center' });
                currentY += 10;
                doc.addImage(barCanvas.toDataURL('image/png', 1.0), 'PNG', 14, currentY, 180, 80);
                currentY += 90;
            }

            // Tableaux saisonniers
            const seasonalSection = document.getElementById('seasonal-analysis-section');
            if (seasonalSection && seasonalSection.style.display !== 'none') {
                const seasonalTables = seasonalSection.querySelectorAll('.seasonal-table');
                const titles = ["Analyse mensuelle", "Analyse saisonnière consommation", "Analyse saisonnière production"];

                seasonalTables.forEach((table, index) => {
                    // On force la nouvelle page uniquement pour "Analyse saisonnière consommation" (index 1)
                    // Le tableau suivant "Analyse saisonnière production" (index 2) restera sur la même page
                    if (currentY > 160 || index === 1) {
                        doc.addPage();
                        currentY = marginTop; // Positionne à la même valeur Y
                    }
                    doc.setFontSize(12);
                    doc.setTextColor(0, 0, 0);
                    doc.text(titles[index] || "Analyse", 105, currentY, { align: 'center' }); // Centre les titres des tableaux saisonniers

                    doc.autoTable({
                        html: table,
                        startY: currentY + 5,
                        theme: 'striped',
                        headStyles: { fillColor: headerColor, halign: 'center' },
                        styles: { fontSize: 9, halign: 'center' }, // Centre les données
                        pageBreak: 'avoid'
                    });
                    currentY = doc.lastAutoTable.finalY + 15;
                });
            }

            // 3. Intégration des données du stockage (si visibles et activées)
            const storageContainer = document.getElementById('storage-results-container');
            if (storageContainer && storageContainer.style.display !== 'none') {
                doc.addPage();
                currentY = marginTop;
                doc.setFontSize(16);
                doc.setTextColor(...headerColor); // Correction: Utilisation de la couleur du thème
                doc.text("Analyse du Stockage", 105, currentY, { align: 'center' });
                currentY += 10;
                doc.setTextColor(0, 0, 0);

                // Récupération des indicateurs clés (Inputs)
                const grids = storageContainer.querySelectorAll('.grid.section-box');
                grids.forEach((grid) => {
                    const titleEl = grid.previousElementSibling;
                    if (titleEl && titleEl.tagName === 'H4') {
                        if (currentY > 200) { doc.addPage(); currentY = marginTop; }
                        doc.setFontSize(12);
                        doc.text(titleEl.innerText, 105, currentY, { align: 'center' });
                        currentY += 5;
                    }

                    const storageGroups = grid.querySelectorAll('.form-group');
                    if (storageGroups.length > 0) {
                        const storageData = [];
                        storageGroups.forEach(group => {
                            const label = group.querySelector('label').innerText;
                            const val = group.querySelector('input').value;
                            storageData.push([label, val]);
                        });
                        doc.autoTable({
                            head: [['Caractéristique', 'Valeur']], // Ajout d'une entête pour harmoniser le style avec les autres tableaux
                            body: storageData,
                            startY: currentY,
                            theme: 'striped',
                            headStyles: { fillColor: headerColor, halign: 'center' },
                            styles: { fontSize: 9, halign: 'center' },
                            pageBreak: 'avoid'
                        });
                        currentY = doc.lastAutoTable.finalY + 10;
                    }
                });

                // Bilan énergétique et Graphique Camembert Stockage
                const storageTable = storageContainer.querySelector('.results-table');
                const stoChart = document.getElementById('storageResultChart');

                // Assurer que le bloc Bilan + Graphique reste sur la même page
                if (currentY > 150) {
                    doc.addPage();
                    currentY = marginTop;
                }

                if (storageTable) {
                    doc.setFontSize(12);
                    doc.text("Bilan énergétique", 105, currentY, { align: 'center' });
                    currentY += 5;
                    doc.autoTable({
                        html: storageTable,
                        startY: currentY,
                        theme: 'striped',
                        headStyles: { fillColor: headerColor, halign: 'center' },
                        styles: { fontSize: 9, halign: 'center' },
                        pageBreak: 'avoid'
                    });
                    currentY = doc.lastAutoTable.finalY + 10;
                }

                if (stoChart) {
                    doc.addImage(stoChart.toDataURL('image/png', 1.0), 'PNG', 65, currentY, 80, 80);
                    currentY += 85;
                }
            }

            doc.save('Rapport_Autoconsommation_Client.pdf');
            showMessage("Export PDF terminé avec succès !");
        } catch (err) {
            handleError(err, 'Génération PDF Client');
        }
    };

    if (typeof window.jspdf === 'undefined') {
        const scriptJsPdf = document.createElement('script');
        scriptJsPdf.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        scriptJsPdf.onload = () => {
            // jsPDF chargé à la volée : brancher la mention période d'essai (services/trial_watermark.js).
            if (window.installTrialWatermark) window.installTrialWatermark();
            const scriptAutoTable = document.createElement('script');
            scriptAutoTable.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
            scriptAutoTable.onload = generatePDFWithAutoTable;
            document.head.appendChild(scriptAutoTable);
        };
        document.head.appendChild(scriptJsPdf);
    } else {
        generatePDFWithAutoTable();
    }
}

// Utilitaire pour convertir une couleur hexadécimale en tableau RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ?
        [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] :
        [239, 68, 68]; // Couleur par défaut si la conversion échoue
}

// Afficher/Masquer le panneau "Résultats détaillés" (production PV par champ,
// équivalent du tableau du panneau PVGIS, mais alimenté par les données déjà
// renvoyées par le calcul autoconsommation/vente en totalité — results.pv_summary).
function toggleDetailedPvResults() {
    const section = document.getElementById('detailed-pv-results-section');
    if (!section) return;

    if (section.style.display === 'none') {
        if (!simulationResults || !simulationResults.pv_summary || !simulationResults.pv_summary.fields) {
            showMessage("Résultats détaillés indisponibles : la production PV provient d'un fichier importé (non calculée par l'application).", 'error');
            return;
        }
        renderDetailedPvResults(simulationResults.pv_summary);
        section.style.display = 'block';
        section.scrollIntoView({ behavior: 'smooth' });
    } else {
        section.style.display = 'none';
    }
}

// Avertissements de l'ombrage proche 3D renvoyés par le serveur (scène refusée : autre projet/compte,
// trop volumineuse ; éléments de géométrie écartés ; objets sans volume d'ombrage).
function nearShadingWarningsHtml(summary) {
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lignes = (summary && Array.isArray(summary.near_shading_warnings)) ? summary.near_shading_warnings.slice() : [];
  const ignores = (summary && Array.isArray(summary.near_shading_ignored_objects)) ? summary.near_shading_ignored_objects : [];
  if (ignores.length) {
    lignes.push(`Objets 3D non pris en compte dans l'ombrage (volume non défini) : ${[...new Set(ignores.map((o) => o.label || o.typeKey))].join(', ')}.`);
  }
  if (!lignes.length) return '';
  return `<div style="margin-top: 1rem; padding: 10px; background: #fff7ed; border-left: 4px solid #f97316; border-radius: 4px; font-size: 0.95rem;">
    ⚠️ <strong>Ombrage proche 3D :</strong><br>${lignes.map(esc).join('<br>')}
  </div>`;
}

// Perte d'ombrage proche (scène 3D) : null = champ absent de la scène 3D, affiché « — » (et non 0 %).
function formatPerteOmbrageProche(value) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    return `${Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

// Rendu du tableau détaillé de production PV (par champ + ligne TOTAL/MOYENNE)
function renderDetailedPvResults(pvSummary) {
    const section = document.getElementById('detailed-pv-results-section');
    if (!section || !pvSummary || !pvSummary.summary) return;

    const summary = pvSummary.summary;
    const fields = pvSummary.fields || [];

    let rowsHtml = '';
    fields.forEach(f => {
        rowsHtml += `<tr>
            <td>${f.id}</td>
            <td>${f.peak_power.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</td>
            <td>${(f.total_production_kwh / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${f.specific_production.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</td>
            <td>${formatPerteOmbrageProche(f.near_shading_loss_percent)}</td>
            <td>${f.performance_ratio.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</td>
        </tr>`;
    });

    rowsHtml += `<tr class="total-row">
        <td>TOTAL / MOYENNE</td>
        <td>${summary.peak_power_kw.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</td>
        <td>${(summary.total_production_kwh / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td>${summary.specific_production.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</td>
        <td>${formatPerteOmbrageProche(summary.near_shading_loss_percent)}</td>
        <td>${summary.performance_ratio.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</td>
    </tr>`;

    const warningHtml = summary.clipping_loss_kwh > 0 ?
        `<div style="color: var(--danger-color, #ef4444); margin-top: 1rem; font-weight: 600; padding: 10px; background: #fee2e2; border-radius: 4px;">
            ⚠️ Perte par écrêtage onduleur estimée : ${summary.clipping_loss_kwh.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh
        </div>` : '';

    const cacheInfoHtml = (typeof window.formatMeteoSourceHtml === 'function')
        ? window.formatMeteoSourceHtml(summary)
        : (summary.used_cache
            ? `<div style="margin-top: 1rem; padding: 10px; background: #e0f2fe; border-left: 4px solid #3b82f6; border-radius: 4px; font-size: 0.95rem;">
            ℹ️ <strong>Source des données :</strong> Base météorologique locale en cache (PVGIS non sollicité).
        </div>`
            : `<div style="margin-top: 1rem; padding: 10px; background: #fef9c3; border-left: 4px solid #eab308; border-radius: 4px; font-size: 0.95rem;">
            🌐 <strong>Source des données :</strong> Téléchargement direct depuis l'API européenne PVGIS.
        </div>`);

    section.innerHTML = `
        <div class="seasonal-analysis-container">
            <h3>Résultats détaillés de la production PV (par champ)</h3>
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>Champ PV</th>
                            <th>Puissance (kWc)</th>
                            <th>Prod (MWh)</th>
                            <th>Productible (kWh/kWc/an)</th>
                            <th title="Perte d'irradiance due aux ombres de la scène 3D (arbres, blocs, bâtiments, acrotères, autres champs PV). Déjà déduite de la production et du PR. « — » : champ absent de la scène 3D.">Perte d'ombrage proche (%)</th>
                            <th>PR (%)</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
            ${warningHtml}
            ${nearShadingWarningsHtml(summary)}
            ${cacheInfoHtml}
            <div class="export-group" style="margin-top: 1rem;">
                <button type="button" class="btn-secondary" id="detail-btn-excel-60" onclick="exportPvExcel(60)">📊 Excel (60 min)</button>
                <button type="button" class="btn-secondary" id="detail-btn-excel-30" onclick="exportPvExcel(30)">📊 Excel (30 min)</button>
                <button type="button" class="btn-secondary" id="detail-btn-excel-15" onclick="exportPvExcel(15)">📊 Excel (15 min)</button>
                <button type="button" class="btn-secondary" id="detail-btn-excel-10" onclick="exportPvExcel(10)">📊 Excel (10 min)</button>
            </div>
        </div>
    `;
}

// Afficher/Masquer le module Analyses Saisonnières
function toggleSeasonalAnalysis() {
    const section = document.getElementById('seasonal-analysis-section');
    const dropdown = document.getElementById('site-filter-dropdown');

    if (!section || !dropdown) {
        showMessage("Erreur critique : Composants d'interface manquants.", 'error');
        return;
    }

    if (section.style.display === 'none') {
        const siteLabel = dropdown.value;
        if (!siteLabel) {
            showMessage("Aucun site sélectionné pour l'analyse.", 'error');
            return;
        }
        section.style.display = 'block';
        renderSeasonalAnalysis(siteLabel);
        section.scrollIntoView({ behavior: 'smooth' });
    } else {
        section.style.display = 'none';
    }
}

// Rendu des tableaux d'Analyses Saisonnières
function renderSeasonalAnalysis(siteLabel) {
    const section = document.getElementById('seasonal-analysis-section');
    if (!section) return;

    if (!simulationResults || !simulationResults.sites) {
        section.innerHTML = `<div class="seasonal-analysis-container"><h3>Erreur</h3><p>Les données de simulation sont indisponibles pour l'analyse.</p></div>`;
        return;
    }

    const siteData = simulationResults.sites[siteLabel];
    if (!siteData || !siteData.monthly_data) {
        section.innerHTML = `<div class="seasonal-analysis-container"><h3>Données Manquantes</h3><p>Les données d'analyse mensuelle pour le site '${siteLabel}' sont introuvables.</p></div>`;
        return;
    }

    // Copie profonde pour ne pas altérer les données de base
    let mData = JSON.parse(JSON.stringify(siteData.monthly_data));

    const storageToggle = document.querySelector('input[name="storage-toggle"]:checked');
    const storageActive = storageToggle && storageToggle.value === 'oui' && stockagePrisEnCompte();

    // Intégration chirurgicale : substitution par les données de stockage si applicables
    if (siteLabel === 'Global' && storageActive && window.storageResults?.outputs?.hourly_pv_consumed?.length > 0) {
        const timeStepMinutes = parseInt(document.getElementById('time-step-select')?.value) || 60;
        const stepDuration = timeStepMinutes / 60;
        const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        const stepsPerHour = 60 / timeStepMinutes;

        mData.pv_consumed = new Array(12).fill(0);
        mData.total_consumption = new Array(12).fill(0);

        let hourOfYear = 0;
        const hourlyPvCons = window.storageResults.outputs.hourly_pv_consumed;
        const hourlyTotCons = window.storageResults.outputs.hourly_total_consumption;

        for (let m = 0; m < 12; m++) {
            for (let d = 0; d < daysInMonth[m]; d++) {
                for (let h = 0; h < 24; h++) {
                    for (let s = 0; s < stepsPerHour; s++) {
                        if (hourOfYear < hourlyPvCons.length) {
                            mData.pv_consumed[m] += (hourlyPvCons[hourOfYear] * stepDuration) / 1000;
                            mData.total_consumption[m] += (hourlyTotCons[hourOfYear] * stepDuration) / 1000;
                            hourOfYear++;
                        }
                    }
                }
            }
        }
    }

    const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

    let table1Html = `
                <h4>Analyse mensuelle</h4>
                <div class="table-responsive">
                <table class="seasonal-table">
                    <thead>
                        <tr>
                            <th>Mois</th>
                            <th>Production (MWh)</th>
                            <th>Consommation (MWh)</th>
                            <th>Taux d'autoconsommation (%)</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

    let annProd = 0, annCons = 0, sumAutoRate = 0, annPvCons = 0;
    let sumHiverCons = 0, sumHiverProd = 0, sumHiverPvCons = 0;
    let sumEteCons = 0, sumEteProd = 0, sumEtePvCons = 0;

    for (let i = 0; i < 12; i++) {
        const prod = mData.pv_production[i];
        const cons = mData.total_consumption[i];
        const pvCons = mData.pv_consumed[i];
        const autoRate = prod > 0 ? (pvCons / prod) * 100 : 0;

        annProd += prod;
        annCons += cons;
        annPvCons += pvCons;
        sumAutoRate += autoRate; // Pour la moyenne arithmétique

        // Hiver (Nov-Mars = indices 10, 11, 0, 1, 2)
        if ([0, 1, 2, 10, 11].includes(i)) {
            sumHiverCons += cons;
            sumHiverProd += prod;
            sumHiverPvCons += pvCons;
        } else {
            sumEteCons += cons;
            sumEteProd += prod;
            sumEtePvCons += pvCons;
        }

        table1Html += `
                    <tr>
                        <td>${months[i]}</td>
                        <td>${prod.toFixed(2)}</td>
                        <td>${cons.toFixed(2)}</td>
                        <td>${(Math.round(autoRate * 100) / 100).toFixed(2)} %</td>
                    </tr>
                `;
    }

    // Calcul du taux moyen pondéré exact (valeur 1 = valeur 2 entre les tableaux)
    const avgAutoRate = annProd > 0 ? (annPvCons / annProd) * 100 : 0;
    table1Html += `
                    <tr class="total-row">
                        <td>Total / Moyenne</td>
                        <td>${annProd.toFixed(2)}</td>
                        <td>${annCons.toFixed(2)}</td>
                        <td>${(Math.round(avgAutoRate * 100) / 100).toFixed(2)} %</td>
                    </tr>
                </tbody></table></div>
            `;

    const pctHiverProd = annProd > 0 ? (sumHiverProd / annProd) * 100 : 0;
    const pctHiverCons = annCons > 0 ? (sumHiverCons / annCons) * 100 : 0;
    const pctEteProd = annProd > 0 ? (sumEteProd / annProd) * 100 : 0;
    const pctEteCons = annCons > 0 ? (sumEteCons / annCons) * 100 : 0;

    const pctHiverPvCons = annPvCons > 0 ? (sumHiverPvCons / annPvCons) * 100 : 0;
    const pctEtePvCons = annPvCons > 0 ? (sumEtePvCons / annPvCons) * 100 : 0;

    let table2aHtml = `
                <h4>Analyse saisonnière consommation</h4>
                <div class="table-responsive">
                <table class="seasonal-table">
                    <thead>
                        <tr>
                            <th>Saison</th>
                            <th>Somme Consommation (MWh)</th>
                            <th>Part Consommation Annuelle (%)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Hiver (Nov à Mars)</td>
                            <td>${sumHiverCons.toFixed(2)}</td>
                            <td>${pctHiverCons.toFixed(2)} %</td>
                        </tr>
                        <tr>
                            <td>Été (Avril à Oct)</td>
                            <td>${sumEteCons.toFixed(2)}</td>
                            <td>${pctEteCons.toFixed(2)} %</td>
                        </tr>
                    </tbody>
                </table>
                </div>
            `;

    let table2bHtml = `
                <h4>Analyse saisonnière production</h4>
                <div class="table-responsive">
                <table class="seasonal-table">
                    <thead>
                        <tr>
                            <th>Saison</th>
                            <th>Somme Prod. Autoconsommée (MWh)</th>
                            <th>Part Prod. Autoconsommée Annuelle (%)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Hiver (Nov à Mars)</td>
                            <td>${sumHiverPvCons.toFixed(2)}</td>
                            <td>${pctHiverPvCons.toFixed(2)} %</td>
                        </tr>
                        <tr>
                            <td>Été (Avril à Oct)</td>
                            <td>${sumEtePvCons.toFixed(2)}</td>
                            <td>${pctEtePvCons.toFixed(2)} %</td>
                        </tr>
                    </tbody>
                </table>
                </div>
            `;

    section.innerHTML = `
                <div class="seasonal-analysis-container">
                    <h3>Analyses saisonnières et mensuelles - ${siteLabel}</h3>
                    <div class="table-card mb-2">${table1Html}</div>
                    <div class="seasonal-tables-grid">
                        <div class="table-card">${table2aHtml}</div>
                        <div class="table-card">${table2bHtml}</div>
                    </div>
                </div>
            `;
}

function exportToExcel() {
    if (!simulationResults) {
        showMessage("Aucune donnée à exporter.", 'error');
        return;
    }

    showLoader(true);

    setTimeout(() => {
        try {
            const wb = XLSX.utils.book_new();
            const studyType = document.querySelector('input[name="study_type"]:checked').value;

            // Onglet 1: Résumé (commun à ACI et ACC)
            const wsSummary = XLSX.utils.table_to_sheet(document.getElementById('results-table'));
            XLSX.utils.book_append_sheet(wb, wsSummary, "Résumé");

            const tsSelect = document.getElementById('time-step-select');
            const timeStepMinutes = tsSelect ? parseInt(tsSelect.value) : 60;
            // CORRECTIF : pas de 10 min manquant (retombait sur 8760, tronquant l'export détaillé).
            const expectedLength = 8760 * (60 / timeStepMinutes);

            if (studyType === 'aci') {
                // --- LOGIQUE POUR L'AUTOCONSOMMATION INDIVIDUELLE (ACI) ---
                const hourlyData = simulationResults.hourly_data || {};
                const pvData = hourlyData.pv || [];
                const consExt = hourlyData.cons_existante || [];
                const consIrve = hourlyData.cons_irve || [];
                const consPac = hourlyData.cons_pac || null;
                const consTotale = hourlyData.cons_totale || [];

                const storageOutputs = window.storageResults?.outputs || {};
                const hourlySoc = storageOutputs.hourly_soc || [];
                const hourlyBattFlux = storageOutputs.hourly_batt_flux || [];
                const prFinal = storageOutputs.pr_final !== undefined ? storageOutputs.pr_final : (simulationResults.sites['Global']?.summary?.performance_ratio || 0);
                // Rendement aller-retour unique (cf. #sto_rte) : une fiche technique n'en publie
                // qu'un, et c'est la seule grandeur stockee en base. Le RTE REELLEMENT obtenu par la
                // simulation est prefere quand il est disponible — il inclut la resistance interne
                // de cellule que PySAM ajoute aux rendements de conversion, donc il decrit le
                // comportement reel de la batterie, pas la consigne.
                const rteDemande = parseFloat(document.getElementById('sto_rte')?.value) || 0.90;
                const rteRealisePct = storageOutputs.rte_realise_pct;
                const rteAffiche = (typeof rteRealisePct === 'number')
                    ? (rteRealisePct / 100) : rteDemande;

                // Colonne PAC / climatiseur seulement quand le calcul l'a intégrée.
                const detailedRows = [
                    ["Pas (Index)", "Production Solaire (kW)", "Consommation Existante (kW)", "Consommation IRVE (kW)",
                        ...(consPac ? ["Consommation PAC / climatisation (kW)"] : []),
                        "Consommation Totale (kW)", "Stockage - État de charge (kWh)", "Stockage - Flux Batterie (kW)", "PR Final (%)", "Rendement aller-retour (RTE)"]
                ];

                for (let i = 0; i < expectedLength; i++) {
                    const pv = Number(pvData[i]) || 0;
                    const ext = Number(consExt[i]) || 0;
                    const irve = Number(consIrve[i]) || 0;
                    const pac = consPac ? (Number(consPac[i]) || 0) : 0;
                    const tot = consTotale.length > i ? Number(consTotale[i]) : (ext + irve + pac);
                    const soc = Number(hourlySoc[i]) || 0;
                    const flux = Number(hourlyBattFlux[i]) || 0;
                    detailedRows.push([i + 1, pv, ext, irve, ...(consPac ? [pac] : []), tot, soc, flux, prFinal, rteAffiche]);
                }

                const wsDetailed = XLSX.utils.aoa_to_sheet(detailedRows);
                wsDetailed['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 25 }, { wch: 22 }, { wch: 25 }, { wch: 28 }, { wch: 25 }, { wch: 15 }, { wch: 25 }, { wch: 28 }];
                XLSX.utils.book_append_sheet(wb, wsDetailed, "Séries Temporelles ACI");

            } else {
                // --- NOUVELLE LOGIQUE POUR L'AUTOCONSOMMATION COLLECTIVE (ACC) ---
                const hourlyData = simulationResults.hourly_data || {};
                if (!hourlyData.consumers) {
                    throw new Error("Les données horaires pour l'ACC sont manquantes ou mal formatées.");
                }

                // Onglet 2: Données Globales ACC
                const globalRows = [
                    ["Pas (Index)", "Production PV (kW)", "Consommation Totale (kW)", "Surplus Global (kW)"]
                ];
                for (let i = 0; i < expectedLength; i++) {
                    globalRows.push([
                        i + 1,
                        Number(hourlyData.pv_production?.[i]) || 0,
                        Number(hourlyData.total_consumption?.[i]) || 0,
                        Number(hourlyData.global_surplus?.[i]) || 0
                    ]);
                }
                const wsGlobal = XLSX.utils.aoa_to_sheet(globalRows);
                wsGlobal['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 25 }, { wch: 22 }];
                XLSX.utils.book_append_sheet(wb, wsGlobal, "Global ACC");

                // Onglets suivants: Un par consommateur
                Object.keys(hourlyData.consumers).forEach(consumerName => {
                    const consumerData = hourlyData.consumers[consumerName];
                    const consumerRows = [
                        ["Pas (Index)", "Consommation (kW)", "PV Autoconsommé (kW)", "Import Réseau (kW)"]
                    ];
                    for (let i = 0; i < expectedLength; i++) {
                        consumerRows.push([
                            i + 1,
                            Number(consumerData.consumption?.[i]) || 0,
                            Number(consumerData.pv_consumed?.[i]) || 0,
                            Number(consumerData.grid_import?.[i]) || 0
                        ]);
                    }
                    const wsConsumer = XLSX.utils.aoa_to_sheet(consumerRows);
                    wsConsumer['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 25 }, { wch: 22 }];

                    // Nettoyage du nom de l'onglet (limite de 31 caractères, pas de caractères spéciaux)
                    const sanitizedSheetName = consumerName.replace(/[\\/*?:"<>|]/g, "").substring(0, 30);
                    XLSX.utils.book_append_sheet(wb, wsConsumer, sanitizedSheetName);
                });
            }

            XLSX.writeFile(wb, "resultats_photovoltaique_detaille.xlsx");
            showMessage("Export Excel généré avec succès !", 'info');
        } catch (error) {
            // Utilisation de notre nouveau gestionnaire d'erreurs
            handleError(error, 'Export Excel');
        } finally {
            showLoader(false);
        }
    }, 100);
}


/**
  * Gère le changement de type d'étude (ACI vs ACC) et met à jour l'interface.
  */
function handleStudyTypeChange() {
    const studyType = document.querySelector('input[name="study_type"]:checked').value;
    // NOUVEAU: Charger les options sauvegardées pour la vente en totalité
    const savedOptionsRaw = localStorage.getItem('vente_totalite_options');
    const savedVenteTotaliteOptions = savedOptionsRaw && savedOptionsRaw !== 'undefined' ? JSON.parse(savedOptionsRaw) : {};
    // NOUVEAU: Le taux de dégradation est partagé avec le module d'étude économique
    // (localStorage.sharedDegradationRate, cf. #degradation dans etudes_economique_content.html) ;
    // s'il a été renseigné depuis ce module, il prend la priorité sur la valeur sauvegardée ici.
    const sharedDegradationRaw = localStorage.getItem('sharedDegradationRate');
    const sharedDegradation = sharedDegradationRaw !== null && !isNaN(parseFloat(sharedDegradationRaw))
        ? parseFloat(sharedDegradationRaw)
        : null;

    // NOUVEAU: Sauvegarder le choix dans le localStorage
    localStorage.setItem('studyType', studyType);

    const consContainer = document.getElementById('cons-input-container');
    const priorityGroup = document.querySelector('input[name="priority"]').closest('.input-group');

    // CORRECTION : S'assurer que le conteneur pour les paramètres spécifiques existe.
    if (!document.getElementById('study-specific-params')) {
        consContainer.insertAdjacentHTML('afterend', '<div id="study-specific-params"></div>');
    }

    if (studyType === 'vente_totalite') {
        // Mode Vente en totalité : Masquer la priorité et désactiver l'import de consommation
        priorityGroup.style.display = 'none';
        consContainer.innerHTML = `
            <div class="file-buttons">
                <label class="btn-primary" style="background-color: var(--text-secondary); border-color: var(--text-secondary); cursor: not-allowed; display: flex; align-items: center; justify-content: center; width: 100%;">Import de consommation désactivé</label>
            </div>
            <p style="font-size: 0.85rem; color: var(--text-secondary); text-align: center; margin-top: 0.5rem;">L'analyse en vente en totalité ne nécessite pas de courbe de consommation.</p>
        `;
        // CORRECTION: Afficher les paramètres P90 dans le panneau de gauche avec la bonne mise en page
        document.getElementById('study-specific-params').innerHTML = `
            <div class="input-group">
                <h4>Paramètres P50 / P90</h4>
                <div class="section-box grid" style="grid-template-columns: 1fr 1fr; gap: 1rem 1.5rem;">
                    <div class="form-group">
                        <label for="vt_incertitude_prod">Incertitude totale sur la production (%)</label>
                        <input id="vt_incertitude_prod" type="number" class="eco-input" value="${savedVenteTotaliteOptions.incertitude_production || 3.5}" min="0.1" max="10" step="0.1" title="Incertitude globale du modèle (pertes, modèle, etc.)">
                    </div>
                    <div class="form-group">
                        <label for="vt_incertitude_meteo">Incertitude météo (%)</label>
                        <input id="vt_incertitude_meteo" type="number" class="eco-input" value="${savedVenteTotaliteOptions.incertitude_meteo || 2.5}" min="0.1" max="10" step="0.1" title="Incertitude liée à la variabilité inter-annuelle de l'ensoleillement.">
                    </div>
                    <div class="form-group">
                        <label for="vt_degradation">Dégradation annuelle des panneaux (%)</label>
                        <input id="vt_degradation" type="number" class="eco-input" value="${sharedDegradation != null ? sharedDegradation : (savedVenteTotaliteOptions.degradation || 0.5)}" min="0.1" max="3" step="0.05">
                    </div>
                    <div class="form-group">
                        <label for="vt_horizon">Horizon d'étude</label>
                        <select id="vt_horizon" class="eco-input" style="text-align: left; padding-left: 1rem;"><option value="20" ${savedVenteTotaliteOptions.horizon == 20 ? 'selected' : ''}>20 ans</option><option value="30" ${savedVenteTotaliteOptions.horizon == 30 ? 'selected' : ''}>30 ans</option></select>
                    </div>
                </div>
            </div>
        `;
        // NOUVEAU: Propager toute modification manuelle de la dégradation vers le module
        // d'étude économique (cf. sharedDegradationRate ci-dessus).
        const vtDegradationInput = document.getElementById('vt_degradation');
        if (vtDegradationInput) {
            vtDegradationInput.addEventListener('input', () => {
                try { localStorage.setItem('sharedDegradationRate', vtDegradationInput.value); } catch (e) {}
            });
        }
        // NOUVEAU: ces champs #vt_* étant régénérés à chaque appel de handleStudyTypeChange(), on
        // rebranche systématiquement la mise à jour live du graphique P50/P90 (si un calcul a déjà
        // été lancé au moins une fois, cf. p50p90BaseProdMwh/p50p90Chart).
        setupP50P90LiveUpdate();
        consFileObject = null; // S'assurer qu'aucun fichier de conso n'est conservé
        renderPvInputHere();

    } else if (studyType === 'aci') {
        // Mode ACI : Afficher les options de priorité et l'import de fichier unique
        priorityGroup.style.display = 'block';
        renderAciConsumerInputHere(consContainer);
        document.getElementById('study-specific-params').innerHTML = ''; // Vider les paramètres spécifiques

    } else { // Mode ACC
        // Mode ACC : Masquer la priorité ACI et afficher l'import de fichiers multiples
        priorityGroup.style.display = 'none';
        // Appel de la fonction importée depuis main_acc.js
        const timeStepSelect = document.getElementById('time-step-select');
        document.getElementById('study-specific-params').innerHTML = ''; // Vider les paramètres spécifiques
        renderAccConsumersInput(consContainer, showMessage, timeStepSelect);
        // Fichiers ACC déjà importés (IndexedDB, y compris depuis la section Import CdC de l'IRVE) :
        // réaffichés aussi quand on bascule sur ACC après le chargement — initPersistence() ne les
        // restaure qu'au démarrage, et seulement si ACC était déjà le type d'étude.
        restoreAccFilesFromIDB(showMessage);
        renderPvInputHere(); // Correction: Toujours rafraîchir l'UI PV
    }
}


/**
 * Crée et injecte le modal de gestion des paramètres économiques dans le DOM.
 */
function createInfoModal() {
    if (document.getElementById('info-hint-modal')) return;
    const modalHtml = `
        <div id="info-hint-modal" class="info-modal-overlay" style="display:none;">
            <div class="info-modal-box">
                <button class="info-modal-close" aria-label="Fermer" onclick="closeInfoModal()">&times;</button>
                <div class="info-modal-body">
                    <span class="info-modal-icon">i</span>
                    <div id="info-modal-text-content"></div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const overlay = document.getElementById('info-hint-modal');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
}

window.openInfoModal = function (topic) {
    const content = {
        'default': "Nous vous recommandons de télécharger le modèle Excel pour préparer votre courbe de charge au format attendu. Le fichier doit contenir les données d’une année complète de 365 jours : les années bissextiles ne sont pas prises en compte, le 29 février doit donc être exclu.",
        'amortissement_degressif': "Le coefficient dépend de la durée d'amortissement : <br> • 3-4 ans : <b>1.25</b> <br> • 5-6 ans : <b>1.75</b> <br> • > 6 ans : <b>2.25</b>"
    };
    document.getElementById('info-modal-text-content').innerHTML = content[topic] || content['default'];
    const modal = document.getElementById('info-hint-modal');
    if (modal) modal.style.display = 'flex';
};

function createEconomicModal() {
    const modalHtml = `
       <div id="economic-params-modal" class="modal-overlay" style="display: none;">
            <div id="economic-params-modal-content" class="storage-modal-content">
                <div class="storage-modal-header">
                    <h2>Paramètres Économiques Détaillés (ACC)</h2>
                    <button class="close-btn" onclick="document.getElementById('economic-params-modal').style.display='none'">&times;</button>
                </div>
                <div class="storage-modal-body">
                    <div class="input-group">
                        <label>Prix de vente global du surplus au réseau (€/kWh)</label>
                        <input type="number" id="global_prix_vente_surplus" class="eco-input" value="0.10" step="0.01" style="max-width: 250px; text-align: left; padding-left: 1rem;">
                    </div>
                    
                    <div class="modal-category-title">Mode de Tarification</div>
                    <div class="section-box" style="background-color: var(--bg-panel);">
                        <div class="radio-group">
                            <label><input type="radio" name="eco_tariff_mode" value="profile" checked> Utiliser les tarifs par profil (recommandé)</label>
                            <label><input type="radio" name="eco_tariff_mode" value="custom"> Définir des tarifs personnalisés par participant</label>
                        </div>
                        <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0.5rem 0 0;">
                            Par défaut, les tarifs sont basés sur les profils. Choisissez 'personnalisé' pour ajuster manuellement les prix pour chaque participant.
                        </p>
                    </div>

                    <style>
                        /* Mode « tarifs par profil » : le tableau ne sert qu'à choisir le profil de chaque participant. */
                        #eco-participants-table.eco-mode-profil th:nth-child(n+3),
                        #eco-participants-table.eco-mode-profil td:nth-child(n+3) { display: none; }
                    </style>
                    <div id="eco-profiles-section">
                        <div class="modal-category-title">Tarifs par Profil de Participant (€/kWh)</div>
                        <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0 0 0.5rem;">
                            Pour chaque profil : prix d'achat réseau, puis prix de vente interne ACC.
                        </p>
                        <div id="eco-profiles-container" class="grid section-box"></div>
                    </div>

                    <div class="modal-category-title" id="eco-participants-title">Tarifs par Participant</div>
                    <div class="table-card">
                        <div class="table-responsive">
                            <table id="eco-participants-table" class="seasonal-table">
                                <thead>
                                    <tr>
                                        <th>Participant</th>
                                        <th>Profil</th>
                                        <th>Prix d'achat réseau (€/kWh)</th>
                                        <th>Prix de vente interne ACC (€/kWh)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <!-- Les lignes seront injectées dynamiquement -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="storage-modal-footer">
                    <button class="btn-primary" id="validate-eco-params-btn">Valider et Fermer</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Logique pour ouvrir le modal
    document.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'open-eco-modal-btn') {
            remplirModalEco();
            document.getElementById('economic-params-modal').style.display = 'flex';
        }
    });

    document.querySelectorAll('input[name="eco_tariff_mode"]').forEach((radio) => {
        radio.addEventListener('change', majAffichageModeTarif);
    });

    // Logique pour le bouton "Valider et Fermer" du modal économique
    document.getElementById('validate-eco-params-btn').addEventListener('click', () => {
        // Validation : bornes du modal Études économiques Grand projet (eco_bornes.json).
        const erreurs = validerParamsEcoAcc('eco');
        if (erreurs.length) {
            showMessage(erreurs.join(' '), 'error', 10000);
            return; // Bloquer la fermeture du modal
        }

        saveEconomicParams();
        document.getElementById('economic-params-modal').style.display = 'none';
        rerunEconomicAnalysis();
    });

}

/**
 * Mode de tarification : seuls les champs du mode choisi sont affichés. Tarifs par profil -> grille
 * des profils + tableau réduit au choix du profil de chaque participant ; personnalisés -> tableau
 * complet des prix par participant, grille des profils masquée.
 */
function majAffichageModeTarif() {
    const perso = document.querySelector('input[name="eco_tariff_mode"]:checked')?.value === 'custom';
    const sectionProfils = document.getElementById('eco-profiles-section');
    if (sectionProfils) sectionProfils.style.display = perso ? 'none' : '';
    document.getElementById('eco-participants-table')?.classList.toggle('eco-mode-profil', !perso);
    const titre = document.getElementById('eco-participants-title');
    if (titre) titre.textContent = perso ? 'Tarifs par Participant (€/kWh)' : 'Profil de chaque participant';
}

/**
 * Remplit le modal « Paramètres économiques détaillés (ACC) » depuis les saisies enregistrées
 * (economicParamsACC) et les participants actuels. Appelé à l'ouverture du modal et, modal fermé,
 * avant toute lecture des paramètres (getEconomicParams) : sans cela, tant que le modal n'avait pas
 * été ouvert depuis le chargement, l'analyse partait sans tarifs (valeurs codées en dur).
 */
function remplirModalEco() {
    const champSurplus = document.getElementById('global_prix_vente_surplus');
    if (!champSurplus) return;
    const saved = lireSaisiesEcoAcc('tarifs');
    const surplus = saved.global_prix_vente_surplus;
    champSurplus.value = (surplus !== undefined && surplus !== null && surplus !== '') ? surplus : '0.10';
    populateEconomicModal();
    appliquerBornesAuxChamps(); // lignes de prix recréées par populateEconomicModal()
    majAffichageModeTarif();
}

// Saisies des modales « Paramètres économiques détaillés (ACC) » ('tarifs') et « Analyse financière
// avancée (Producteur) » ('avance') : localStorage (marqué du projet) + base (route
// acc-parametres-eco). Au chargement, la base fait foi, sauf saisie locale de ce projet pas encore
// parvenue en base (enAttente), qui y est alors envoyée.
const CLES_LS_ECO_ACC = { tarifs: 'economicParamsACC', avance: 'advancedEconomicParams' };

function lireSaisiesEcoAcc(partie) {
    try {
        const v = JSON.parse(localStorage.getItem(CLES_LS_ECO_ACC[partie]) || '{}');
        return (v && typeof v === 'object') ? v : {};
    } catch (e) {
        return {};
    }
}

function ecrireSaisiesEcoAcc(partie, valeurs) {
    try { localStorage.setItem(CLES_LS_ECO_ACC[partie], JSON.stringify(valeurs)); } catch (e) { /* quota */ }
}

async function envoyerSaisiesEcoAcc(partie, valeurs, projetId) {
    const r = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/acc-parametres-eco`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partie, valeurs }),
    });
    const res = await r.json().catch(() => ({ success: r.ok }));
    if (!r.ok || !res || res.success === false) throw new Error(res?.message || `HTTP ${r.status}`);
}

/** Enregistre une partie des saisies : localStorage immédiatement, puis base. */
async function enregistrerSaisiesEcoAcc(partie, valeurs) {
    const projetId = getProjetIdActif();
    ecrireSaisiesEcoAcc(partie, { ...valeurs, projetId: projetId ? String(projetId) : null, enAttente: !!projetId });
    if (!projetId) return;
    try {
        await envoyerSaisiesEcoAcc(partie, valeurs, projetId);
        // Le projet a pu changer pendant l'envoi : ne marquer enregistrées que les saisies envoyées.
        const actuel = lireSaisiesEcoAcc(partie);
        if (String(actuel.projetId) === String(projetId)) ecrireSaisiesEcoAcc(partie, { ...actuel, enAttente: false });
    } catch (e) {
        console.warn(`Enregistrement en base des paramètres économiques ACC (${partie}) impossible`, e);
        showMessage("Paramètres économiques gardés sur ce poste mais pas encore enregistrés dans le projet (nouvel essai au prochain chargement).", 'error', 8000);
    }
}

/**
 * Restaure les saisies des deux modales éco ACC depuis la base pour le projet actif (appelé par
 * initPersistence). Les saisies locales d'un autre projet sont écartées.
 */
async function restaurerSaisiesEcoAccDepuisBase() {
    const projetId = getProjetIdActif();
    if (!projetId) return;
    let base = null;
    try {
        const r = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/acc-parametres-eco`);
        const res = await r.json();
        if (r.ok && res.success) base = res.parametres || {};
    } catch (e) {
        console.warn('Lecture en base des paramètres économiques ACC impossible', e);
    }

    let modifie = false;
    for (const partie of Object.keys(CLES_LS_ECO_ACC)) {
        let { projetId: proprietaire, enAttente, ...local } = lireSaisiesEcoAcc(partie);
        if (proprietaire && String(proprietaire) !== String(projetId)) {
            localStorage.removeItem(CLES_LS_ECO_ACC[partie]);
            local = {};
            modifie = true;
        }
        if (!base) continue; // base injoignable : saisies locales de ce projet conservées

        const enBase = base[partie];
        // Saisie locale de ce projet pas encore en base (envoi échoué, ou cache antérieur à
        // l'enregistrement en base) : envoyée. Sinon la base fait foi.
        if (Object.keys(local).length && (enAttente || !enBase)) {
            await enregistrerSaisiesEcoAcc(partie, local);
        } else if (enBase) {
            if (JSON.stringify(enBase) !== JSON.stringify(local)) modifie = true;
            ecrireSaisiesEcoAcc(partie, { ...enBase, projetId: String(projetId), enAttente: false });
        }
    }

    // Champs recréés avec les saisies restaurées. Analyse refaite si des résultats sont affichés :
    // réaffichés depuis le cache avant la fin de la restauration (saisies et participants ACC).
    if (modifie) createAdvancedEconomicModal();
    remplirModalEco();
    if (simulationResults && document.querySelector('input[name="study_type"]:checked')?.value === 'acc') {
        rerunEconomicAnalysis();
    }
}

/**
 * Sauvegarde les paramètres du modal économique ACC (localStorage + base).
 */
function saveEconomicParams() {
    const params = {
        global_prix_vente_surplus: document.getElementById('global_prix_vente_surplus').value,
        tariff_mode: document.querySelector('input[name="eco_tariff_mode"]:checked')?.value,
        profile_prices: {},
        custom_prices: {}
    };

    // Sauvegarder les prix des profils
    document.querySelectorAll('#eco-profiles-container .profil-prix-achat').forEach(input => {
        const profil = input.dataset.profil;
        params.profile_prices[profil] = {
            achat: input.value,
            vente: document.querySelector(`.profil-prix-vente[data-profil="${profil}"]`).value
        };
    });

    // Sauvegarder les prix personnalisés
    document.querySelectorAll('#eco-participants-table tbody tr').forEach(row => {
        const participantName = row.dataset.participantName;
        params.custom_prices[participantName] = {
            profil: row.querySelector('.profil-select').value,
            prix_achat: row.querySelector('.prix-achat-input').value,
            prix_vente_interne: row.querySelector('.prix-vente-interne-input').value
        };
    });

    enregistrerSaisiesEcoAcc('tarifs', params);
}


/**
 * Crée et injecte le modal de gestion de l'analyse financière avancée.
 */
function createAdvancedEconomicModal() {
    // Recréé (réinitialisation, restauration depuis la base) : l'ancien modal est retiré, sinon les
    // champs en double (mêmes id) restaient ceux lus par getEconomicParams().
    document.getElementById('advanced-economic-modal')?.remove();
    const savedParams = lireSaisiesEcoAcc('avance');

    const getValue = (id, defaultValue) => {
        const key = id.replace('eco_', ''); // 'eco_capex' -> 'capex'
        return savedParams[key] !== undefined ? savedParams[key] : defaultValue;
    };

    const getInflationValue = (profile, defaultValue) => {
        if (savedParams.inflation_grid_price && savedParams.inflation_grid_price[profile] !== undefined) {
            return savedParams.inflation_grid_price[profile];
        }
        return defaultValue;
    };


    const modalHtml = `
       <div id="advanced-economic-modal" class="modal-overlay" style="display: none;">
            <div class="storage-modal-content">
                <div class="storage-modal-header">
                    <h2>Analyse Financière Avancée (Producteur)</h2>
                    <button class="close-btn" onclick="document.getElementById('advanced-economic-modal').style.display='none'">&times;</button>
                </div>
                <div class="storage-modal-body">
                    <div class="advanced-eco-grid">
                        <div> <!-- Colonne 1 -->
                            <h4 class="modal-category-title">Paramètres Généraux</h4>
                            <div class="grid section-box">
                                <div class="form-group"><label for="eco_horizon">Horizon d'étude (ans)</label><input id="eco_horizon" type="number" class="eco-input" value="${getValue('horizon', 20)}"></div>
                                <div class="form-group"><label for="eco_discount_rate">Taux d'actualisation (%)</label><input id="eco_discount_rate" type="number" class="eco-input" value="${getValue('discount_rate', 4)}" step="0.1"></div>
                                <div class="form-group"><label for="eco_tax_rate">Taux d'imposition sur les sociétés (%)</label><input id="eco_tax_rate" type="number" class="eco-input" value="${getValue('tax_rate', 25)}" step="0.1"></div>
                                <div class="form-group"><label for="eco_pv_degradation">Dégradation des panneaux (%/an)</label><input id="eco_pv_degradation" type="number" class="eco-input" value="${getValue('pv_degradation_rate', 0.2)}" step="0.05"></div>
                            </div>

                            <h4 class="modal-category-title">Investissement & Coûts</h4>
                            <div class="grid section-box">
                                <div class="form-group"><label for="eco_capex_wc">CAPEX - Coût du projet (€/Wc)</label><input id="eco_capex_wc" type="number" class="eco-input" value="${getValue('capex_wc', 1.2)}" step="0.01"></div>
                                <div class="form-group"><label for="eco_investment_subsidy">Subvention d'investissement (€)</label><input id="eco_investment_subsidy" type="number" class="eco-input" value="${getValue('investment_subsidy', 0)}" step="1000"></div>
                                <div class="form-group"><label for="eco_opex_projet_wc">OPEX projet (€/Wc/an)</label><input id="eco_opex_projet_wc" type="number" class="eco-input" value="${getValue('opex_projet_wc', 0.015)}" step="0.001"></div>
                                <div class="form-group"><label for="eco_opex_gestion_acc_wc">OPEX gestion ACC (€/Wc/an)</label><input id="eco_opex_gestion_acc_wc" type="number" class="eco-input" value="${getValue('opex_gestion_acc_wc', 0.005)}" step="0.001"></div>
                                <div class="form-group"><label for="eco_loyer">Loyer annuel (€)</label><input id="eco_loyer" type="number" class="eco-input" value="${getValue('loyer', 0)}" step="100"></div>
                                <div class="form-group" style="grid-column: 1 / -1; background: #f8f9fa; padding: 12px; border-radius: 6px;">
                                    <label>Méthode d'amortissement</label>
                                    <div class="radio-group" style="gap: 1.5rem;">
                                        <label><input type="radio" name="eco_depreciation_method" value="linear" class="eco-input" ${getValue('depreciation_method', 'linear') === 'linear' ? 'checked' : ''}> Linéaire</label>
                                        <label><input type="radio" name="eco_depreciation_method" value="declining" class="eco-input" ${getValue('depreciation_method', 'linear') === 'declining' ? 'checked' : ''}> Dégressif</label>
                                    </div>
                                    <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 10px;">
                                        <div class="form-group" style="margin-bottom: 0;"><label for="eco_depreciation_period">Durée d'amortissement (ans)</label><input id="eco_depreciation_period" type="number" class="eco-input" value="${getValue('depreciation_period', 10)}"></div>
                                        <div class="form-group" id="declining-coeff-group" style="margin-bottom: 0;"><label for="eco_declining_coefficient">Coefficient dégressif <span class="info-tooltip" onclick="openInfoModal('amortissement_degressif')" style="cursor:pointer;"><i class="info-icon">i</i></span></label><input id="eco_declining_coefficient" type="number" class="eco-input" value="${getValue('declining_coefficient', 1.75)}" step="0.01"></div>
                                    </div>
                                </div>
                                <div class="form-group" style="grid-column: 1 / -1; background: #f8f9fa; padding: 8px; border-radius: 6px; margin-top: 10px;"><label for="eco_inverter_replacement_toggle" style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;"><input type="checkbox" id="eco_inverter_replacement_toggle" class="eco-input" style="width: auto;" ${getValue('inverter_replacement_enabled', false) ? 'checked' : ''}> Inclure le remplacement de l'onduleur</label></div>
                                <div class="form-group inverter-replacement-field"><label for="eco_inverter_replacement_year">Année de remplacement</label><input id="eco_inverter_replacement_year" type="number" class="eco-input" value="${getValue('inverter_replacement_year', 11)}"></div>
                                <div class="form-group inverter-replacement-field"><label for="eco_inverter_replacement_cost_wc">Coût de remplacement (€/Wc)</label><input id="eco_inverter_replacement_cost_wc" type="number" class="eco-input" value="${getValue('inverter_replacement_cost_wc', 0.15)}" step="0.01"></div>
                            </div>
                        </div>
                        <div> <!-- Colonne 2 -->
                            <h4 class="modal-category-title">Financement</h4>
                            <div class="grid section-box">
                                <div class="form-group"><label for="eco_equity_share">Part de fonds propres (%)</label><input id="eco_equity_share" type="number" class="eco-input" value="${getValue('equity_share', 20)}" min="0" max="100"></div>
                                <div class="form-group"><label for="eco_loan_interest">Taux d'intérêt du prêt (%)</label><input id="eco_loan_interest" type="number" class="eco-input" value="${getValue('loan_interest', 3.5)}" step="0.1"></div>
                                <div class="form-group"><label for="eco_loan_maturity">Maturité du prêt (ans)</label><input id="eco_loan_maturity" type="number" class="eco-input" value="${getValue('loan_maturity', 15)}"></div>
                            </div>

                            <h4 class="modal-category-title">Hypothèses d'Évolution Annuelle</h4>
                            <div class="grid section-box">
                                <div class="form-group"><label for="eco_inflation_opex">Indexation OPEX (%)</label><input id="eco_inflation_opex" type="number" class="eco-input" value="${getValue('inflation_opex', 2)}" step="0.1"></div>
                                <div class="form-group"><label for="eco_inflation_acc_price">Indexation prix vente interne ACC (%)</label><input id="eco_inflation_acc_price" type="number" class="eco-input" value="${getValue('inflation_acc_price', 1.5)}" step="0.1"></div>
                                <div class="form-group"><label for="eco_inflation_surplus_price">Indexation prix vente surplus (%)</label><input id="eco_inflation_surplus_price" type="number" class="eco-input" value="${getValue('inflation_surplus_price', 1)}" step="0.1"></div>
                                <div class="form-group"><label for="eco_inflation_grid_price_residentiel">Indexation prix réseau - Résidentiel (%)</label><input id="eco_inflation_grid_price_residentiel" type="number" class="eco-input" value="${getInflationValue('Résidentiel', 2.5)}" step="0.1"></div>
                                <div class="form-group"><label for="eco_inflation_grid_price_tertiaire_collectivite">Indexation prix réseau - Tertiaire & Collectivité (%)</label><input id="eco_inflation_grid_price_tertiaire_collectivite" type="number" class="eco-input" value="${getInflationValue('Tertiaire', 2.5)}" step="0.1"></div>
                                <div class="form-group"><label for="eco_inflation_grid_price_industriel">Indexation prix réseau - Industriel (%)</label><input id="eco_inflation_grid_price_industriel" type="number" class="eco-input" value="${getInflationValue('Industriel', 2.5)}" step="0.1"></div>
                                <div class="form-group"><label for="eco_inflation_grid_price_agriculteur">Indexation prix réseau - Agriculteur (%)</label><input id="eco_inflation_grid_price_agriculteur" type="number" class="eco-input" value="${getInflationValue('Agriculteur', 2.5)}" step="0.1"></div>
                            </div>
                        </div>
                    </div>

                </div>
                <div class="storage-modal-footer">
                    <button class="btn-secondary" id="reset-advanced-eco-params-btn">Réinitialiser</button>
                    <button class="btn-primary" id="validate-advanced-eco-params-btn">Valider et Fermer</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Logique pour ouvrir le modal
    const toggleDecliningCoeff = () => {
        const isDeclining = document.querySelector('input[name="eco_depreciation_method"][value="declining"]').checked;
        document.getElementById('declining-coeff-group').style.display = isDeclining ? 'block' : 'none';
    };

    document.querySelectorAll('input[name="eco_depreciation_method"]').forEach(radio => {
        radio.addEventListener('change', toggleDecliningCoeff);
    });

    document.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'open-advanced-eco-modal-btn') { // Correction: l'id du bouton est dans main_acc.js
            document.getElementById('advanced-economic-modal').style.display = 'flex';
        }
    });

    // Logique pour afficher/masquer les champs de remplacement de l'onduleur
    const toggleInverterFields = () => {
        const isChecked = document.getElementById('eco_inverter_replacement_toggle').checked;
        document.querySelectorAll('.inverter-replacement-field').forEach(el => {
            el.style.display = isChecked ? 'block' : 'none';
        });
    };

    document.getElementById('eco_inverter_replacement_toggle').addEventListener('change', toggleInverterFields);

    // Appel initial pour définir l'état correct au chargement du modal
    toggleInverterFields();
    toggleDecliningCoeff();
    appliquerBornesAuxChamps();

    // Logique pour le bouton "Valider et Fermer"
    document.getElementById('validate-advanced-eco-params-btn').addEventListener('click', () => {
        // Validation : bornes du modal Études économiques Grand projet (eco_bornes.json).
        const erreurs = validerParamsEcoAcc('avance');
        if (erreurs.length) {
            showMessage(erreurs.join(' '), 'error', 10000);
            return; // Bloquer la fermeture du modal
        }

        saveAdvancedEconomicParams();
        document.getElementById('advanced-economic-modal').style.display = 'none';
        rerunEconomicAnalysis();
    });

    // Logique pour le bouton "Réinitialiser" du modal avancé
    document.getElementById('reset-advanced-eco-params-btn').addEventListener('click', () => {
        if (confirm("Voulez-vous vraiment réinitialiser tous les paramètres de l'analyse financière à leurs valeurs par défaut ?")) {
            localStorage.removeItem('advancedEconomicParams');
            createAdvancedEconomicModal(); // Recrée le modal avec les valeurs par défaut
            document.getElementById('advanced-economic-modal').style.display = 'flex';
            saveAdvancedEconomicParams(); // valeurs par défaut enregistrées (localStorage + base)
            showMessage("Paramètres de l'analyse financière réinitialisés.", 'info');
        }
    });
}

/**
 * Crée et injecte le modal de personnalisation du tableau de bord ACC.
 */
function createDashboardModal() {
    const existing = document.getElementById('dashboard-modal');
    if (existing) existing.remove();

    const DEFAULTS = {
        'eco-section-assumptions': false,
        'eco-section-bilan': true,
        'eco-section-indicators': true,
        'eco-section-comparison': true,
        'eco-section-producer-doughnut': true,
        'eco-section-financial-table': true,
        'eco-section-cashflows': true,
        'eco-section-debt-equity': false,
        'eco-section-revenue-breakdown': false,
    };
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('dashboardVisibility') || '{}'); } catch (e) {}
    const config = { ...DEFAULTS, ...stored };
    const chk = (key) => config[key] ? 'checked' : '';

    const modalHtml = `
        <div id="dashboard-modal" class="modal-overlay" style="display: none;">
            <div class="storage-modal-content" style="max-width: 520px;">
                <div class="storage-modal-header">
                    <h2>Personnaliser le Tableau de Bord</h2>
                    <button class="close-btn" id="dashboard-modal-close-btn">&times;</button>
                </div>
                <div class="storage-modal-body">
                    <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1.5rem;">
                        Cochez les éléments à afficher dans le tableau de bord de l'analyse économique ACC.
                    </p>
                    <p style="font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 0.75rem;">Affichés par défaut</p>
                    <div style="display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1rem;">
                        <label style="display: flex; align-items: center; gap: 0.6rem; cursor: pointer;">
                            <input type="checkbox" data-section="eco-section-bilan" ${chk('eco-section-bilan')}> Bilan Économique des Consommateurs
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.6rem; cursor: pointer;">
                            <input type="checkbox" data-section="eco-section-indicators" ${chk('eco-section-indicators')}> Indicateurs Financiers
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.6rem; cursor: pointer;">
                            <input type="checkbox" data-section="eco-section-comparison" ${chk('eco-section-comparison')}> Comparaison des factures annuelles (€)
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.6rem; cursor: pointer;">
                            <input type="checkbox" data-section="eco-section-producer-doughnut" ${chk('eco-section-producer-doughnut')}> Répartition des revenus du producteur
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.6rem; cursor: pointer;">
                            <input type="checkbox" data-section="eco-section-financial-table" ${chk('eco-section-financial-table')}> Tableau des Flux Financiers Annuels
                        </label>
                                        <label style="display: flex; align-items: center; gap: 0.6rem; cursor: pointer;">
                            <input type="checkbox" data-section="eco-section-cashflows" ${chk('eco-section-cashflows')}> Évolution des Flux de Trésorerie Cumulés du Projet (€)
                        </label>
                    </div>
                    <hr style="border: none; border-top: 1px solid var(--border-color); margin: 0.5rem 0 1rem;">
                    <p style="font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 0.75rem;">Masqués par défaut</p>
                    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
                        <label style="display: flex; align-items: center; gap: 0.6rem; cursor: pointer;">
                            <input type="checkbox" data-section="eco-section-assumptions" ${chk('eco-section-assumptions')}> Hypothèses Financières Utilisées
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.6rem; cursor: pointer;">
                            <input type="checkbox" data-section="eco-section-debt-equity" ${chk('eco-section-debt-equity')}> Évolution de la Dette et des Fonds Propres (€)
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.6rem; cursor: pointer;">
                            <input type="checkbox" data-section="eco-section-revenue-breakdown" ${chk('eco-section-revenue-breakdown')}> Répartition des Revenus Annuels du Producteur (€)
                        </label>
                    </div>
                </div>
                <div class="storage-modal-footer">
                    <button class="btn-secondary" id="dashboard-modal-close-footer-btn">Fermer</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('dashboard-modal');
    document.getElementById('dashboard-modal-close-btn').addEventListener('click', () => { modal.style.display = 'none'; });
    document.getElementById('dashboard-modal-close-footer-btn').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

    modal.querySelectorAll('input[type="checkbox"][data-section]').forEach(cb => {
        cb.addEventListener('change', function () {
            let s = {};
            try { s = JSON.parse(localStorage.getItem('dashboardVisibility') || '{}'); } catch (e) {}
            s[this.dataset.section] = this.checked;
            localStorage.setItem('dashboardVisibility', JSON.stringify(s));
            applyDashboardVisibility();
        });
    });

    document.addEventListener('click', function (e) {
        if (e.target && e.target.id === 'open-dashboard-modal-btn') {
            document.getElementById('dashboard-modal').style.display = 'flex';
        }
    });
}

/**
 * Sauvegarde les paramètres du modal d'analyse financière avancée.
 */
function saveAdvancedEconomicParams() {
    const params = {
        horizon: document.getElementById('eco_horizon').value,
        discount_rate: document.getElementById('eco_discount_rate').value,
        tax_rate: document.getElementById('eco_tax_rate').value,
        capex_wc: document.getElementById('eco_capex_wc').value,
        investment_subsidy: document.getElementById('eco_investment_subsidy').value,
        opex_projet_wc: document.getElementById('eco_opex_projet_wc').value,
        opex_gestion_acc_wc: document.getElementById('eco_opex_gestion_acc_wc').value,
        loyer: document.getElementById('eco_loyer').value,
        depreciation_period: document.getElementById('eco_depreciation_period').value,
        inverter_replacement_enabled: document.getElementById('eco_inverter_replacement_toggle').checked,
        inverter_replacement_year: document.getElementById('eco_inverter_replacement_year').value,
        inverter_replacement_cost_wc: document.getElementById('eco_inverter_replacement_cost_wc').value,
        equity_share: document.getElementById('eco_equity_share').value,
        loan_interest: document.getElementById('eco_loan_interest').value,
        loan_maturity: document.getElementById('eco_loan_maturity').value,
        inflation_opex: document.getElementById('eco_inflation_opex').value,
        depreciation_method: document.querySelector('input[name="eco_depreciation_method"]:checked').value,
        declining_coefficient: document.getElementById('eco_declining_coefficient').value,
        inflation_acc_price: document.getElementById('eco_inflation_acc_price').value,
        inflation_surplus_price: document.getElementById('eco_inflation_surplus_price').value,
        pv_degradation_rate: document.getElementById('eco_pv_degradation').value, // Nom de clé conservé pour la compatibilité
        inflation_grid_price: {
            'Résidentiel': document.getElementById('eco_inflation_grid_price_residentiel').value,
            'Tertiaire': document.getElementById('eco_inflation_grid_price_tertiaire_collectivite').value,
            'Industriel': document.getElementById('eco_inflation_grid_price_industriel').value,
            'Agriculteur': document.getElementById('eco_inflation_grid_price_agriculteur').value,
        }
    };
    enregistrerSaisiesEcoAcc('avance', params);
}

/**
 * Raccourci pour configurer et lancer une analyse de stockage sans production PV.
 */
function launchSansPV() {
    // Sélectionne la stratégie "Sans PV"
    const strategyRadio = document.querySelector('input[name="storage_strategy"][value="optim_sansPV"]');
    if (strategyRadio) {
        strategyRadio.checked = true;
    }
    // Ouvre le modal de configuration du stockage
    openStorageModal();
}

/**
 * NOUVEAU: Récupère tous les paramètres économiques depuis le DOM.
 * Centralise la lecture des valeurs pour les calculs et les exports.
 * @returns {object} Un objet contenant tous les paramètres économiques.
 */
function getEconomicParams() {
    // Modal fermé : champs remis aux saisies enregistrées et aux participants actuels (une saisie
    // fermée par la croix sans « Valider » n'est pas prise en compte).
    if (document.getElementById('economic-params-modal')?.style.display !== 'flex') remplirModalEco();
    const params = {
        participants: {},
        // Paramètres globaux
        prix_vente_surplus: parseFloat(document.getElementById('global_prix_vente_surplus').value) || 0.10,
        // Paramètres financiers avancés
        horizon: parseInt(document.getElementById('eco_horizon')?.value) || 20,
        discount_rate: parseFloat(document.getElementById('eco_discount_rate')?.value) || 0,
        tax_rate: parseFloat(document.getElementById('eco_tax_rate')?.value) || 0,
        capex_wc: parseFloat(document.getElementById('eco_capex_wc')?.value) || 1.2,
        investment_subsidy: parseFloat(document.getElementById('eco_investment_subsidy')?.value) || 0,
        opex_projet_wc: parseFloat(document.getElementById('eco_opex_projet_wc')?.value) || 0.015,
        opex_gestion_acc_wc: parseFloat(document.getElementById('eco_opex_gestion_acc_wc')?.value) || 0.005,
        loyer: parseFloat(document.getElementById('eco_loyer')?.value) || 0,
        depreciation_period: parseInt(document.getElementById('eco_depreciation_period')?.value) || 10,
        inverter_replacement_enabled: document.getElementById('eco_inverter_replacement_toggle')?.checked || false,
        inverter_replacement_year: parseInt(document.getElementById('eco_inverter_replacement_year')?.value) || 11,
        inverter_replacement_cost_wc: parseFloat(document.getElementById('eco_inverter_replacement_cost_wc')?.value) || 0.15,
        equity_share: parseFloat(document.getElementById('eco_equity_share')?.value) || 20,
        loan_interest: parseFloat(document.getElementById('eco_loan_interest')?.value) || 3.5,
        loan_maturity: parseInt(document.getElementById('eco_loan_maturity')?.value) || 15,
        inflation_opex: parseFloat(document.getElementById('eco_inflation_opex')?.value) || 2.0,
        depreciation_method: document.querySelector('input[name="eco_depreciation_method"]:checked')?.value || 'linear',
        declining_coefficient: parseFloat(document.getElementById('eco_declining_coefficient')?.value) || 1.75,
        inflation_acc_price: parseFloat(document.getElementById('eco_inflation_acc_price')?.value) || 1.5,
        inflation_surplus_price: parseFloat(document.getElementById('eco_inflation_surplus_price')?.value) || 1.0,
        pv_degradation_rate: parseFloat(document.getElementById('eco_pv_degradation')?.value) || 0.2,
        inflation_grid_price: {
            'Résidentiel': parseFloat(document.getElementById('eco_inflation_grid_price_residentiel')?.value) || 2.5,
            'Tertiaire': parseFloat(document.getElementById('eco_inflation_grid_price_tertiaire_collectivite')?.value) || 2.5,
            'Collectivité': parseFloat(document.getElementById('eco_inflation_grid_price_tertiaire_collectivite')?.value) || 2.5,
            'Industriel': parseFloat(document.getElementById('eco_inflation_grid_price_industriel')?.value) || 2.5,
            'Agriculteur': parseFloat(document.getElementById('eco_inflation_grid_price_agriculteur')?.value) || 2.5,
        }
    };

    // Logique pour les tarifs par participant
    const tariffMode = document.querySelector('input[name="eco_tariff_mode"]:checked')?.value;
    document.querySelectorAll('#eco-participants-table tbody tr').forEach(row => {
        const participantName = row.dataset.participantName;
        const profil = row.querySelector('.profil-select').value;
        if (tariffMode === 'custom') {
            params.participants[participantName] = {
                profil: profil,
                prix_achat: parseFloat(row.querySelector('.prix-achat-input').value) || 0,
                prix_vente_interne: parseFloat(row.querySelector('.prix-vente-interne-input').value) || 0
            };
        } else {
            // En mode profil, on recalcule à partir des valeurs par défaut du modal
            const defaultPriceAchat = parseFloat(document.querySelector(`.profil-prix-achat[data-profil="${profil}"]`)?.value) || 0;
            const defaultPriceVente = parseFloat(document.querySelector(`.profil-prix-vente[data-profil="${profil}"]`)?.value) || 0;
            params.participants[participantName] = { profil, prix_achat: defaultPriceAchat, prix_vente_interne: defaultPriceVente };
        }
    });
    return params;
}

/**
 * Paramètres économiques ACC tels que SAISIS (valeurs brutes des champs), pour la validation :
 * getEconomicParams() remplace une saisie vide ou nulle par la valeur par défaut (`|| 20`...), ce qui
 * masquerait une saisie invalide. Bornes : window.ACC_ECO_BORNES (app/services/acc/eco_bornes.json).
 */
function lireParamsBrutsEco() {
    const params = getEconomicParams();
    const bornes = window.ACC_ECO_BORNES;
    if (bornes?.champs) {
        Object.entries(bornes.champs).forEach(([cle, regle]) => {
            const el = regle.inputId && document.getElementById(regle.inputId);
            if (el) params[cle] = el.value;
        });
    }
    const inflation = {
        'Résidentiel': 'eco_inflation_grid_price_residentiel',
        'Tertiaire & Collectivité': 'eco_inflation_grid_price_tertiaire_collectivite',
        'Industriel': 'eco_inflation_grid_price_industriel',
        'Agriculteur': 'eco_inflation_grid_price_agriculteur',
    };
    params.inflation_grid_price = {};
    Object.entries(inflation).forEach(([profil, id]) => {
        const el = document.getElementById(id);
        if (el) params.inflation_grid_price[profil] = el.value;
    });
    // Prix : seuls ceux du mode de tarification choisi (les autres sont masqués et non utilisés).
    params.participants = {};
    if (document.querySelector('input[name="eco_tariff_mode"]:checked')?.value !== 'custom') {
        document.querySelectorAll('#eco-profiles-container .profil-prix-achat').forEach((input) => {
            const profil = input.dataset.profil;
            const vente = document.querySelector(`.profil-prix-vente[data-profil="${profil}"]`);
            params.participants[`profil ${profil}`] = { prix_achat: input.value, prix_vente_interne: vente ? vente.value : '' };
        });
    } else {
        document.querySelectorAll('#eco-participants-table tbody tr').forEach((row) => {
            params.participants[row.dataset.participantName] = {
                prix_achat: row.querySelector('.prix-achat-input')?.value ?? '',
                prix_vente_interne: row.querySelector('.prix-vente-interne-input')?.value ?? '',
            };
        });
    }
    return params;
}

const _CLES_MODAL_ECO = (cle) => cle === 'prix_vente_surplus' || cle.startsWith('participants');

/**
 * Valide les paramètres économiques ACC (bornes du modal Études économiques Grand projet).
 * @param {'eco'|'avance'|'tout'} portee - champs du modal "Paramètres économiques", du modal
 *   "Analyse financière avancée", ou les deux.
 * @returns {string[]} messages d'erreur (vide si tout est valide) ; les champs fautifs sont encadrés.
 */
function validerParamsEcoAcc(portee = 'tout') {
    const puissanceKw = simulationResults?.sites?.Global?.summary?.peak_power_kw;
    let erreurs = verifierParametresEcoAcc(lireParamsBrutsEco(), puissanceKw ? puissanceKw * 1000 : null);
    if (portee === 'eco') erreurs = erreurs.filter((e) => _CLES_MODAL_ECO(e.cle));
    else if (portee === 'avance') erreurs = erreurs.filter((e) => !_CLES_MODAL_ECO(e.cle));

    const selecteur = portee === 'eco' ? '#economic-params-modal' : portee === 'avance' ? '#advanced-economic-modal' : '#economic-params-modal, #advanced-economic-modal';
    document.querySelectorAll(`${selecteur.split(', ').map((s) => `${s} input`).join(', ')}`).forEach((input) => { input.style.borderColor = ''; });
    // Champs à bornes fixes non rattachés à un inputId (inflation par profil, prix) : encadrés un à un.
    const horsBornes = (el, regle) => {
        const v = parseFloat(String(el.value).replace(',', '.'));
        return el.value === '' || !Number.isFinite(v) || v < regle.min || v > regle.max;
    };
    const bornes = window.ACC_ECO_BORNES || {};
    erreurs.forEach((e) => {
        if (e.inputId) {
            const el = document.getElementById(e.inputId);
            if (el) el.style.borderColor = 'var(--danger-color)';
        } else if (e.cle.startsWith('inflation_grid_price') && bornes.inflation_grid_price) {
            document.querySelectorAll('[id^="eco_inflation_grid_price_"]').forEach((el) => {
                if (horsBornes(el, bornes.inflation_grid_price)) el.style.borderColor = 'var(--danger-color)';
            });
        } else if (e.cle.startsWith('participants') && bornes.prix_participant) {
            document.querySelectorAll('#economic-params-modal .profil-prix-achat, #economic-params-modal .profil-prix-vente, #economic-params-modal .prix-achat-input, #economic-params-modal .prix-vente-interne-input').forEach((el) => {
                if (horsBornes(el, bornes.prix_participant)) el.style.borderColor = 'var(--danger-color)';
            });
        }
    });
    return erreurs.map((e) => e.message);
}

/**
 * NOUVEAU: Relance uniquement l'analyse économique côté client sans solliciter le serveur.
 */
function rerunEconomicAnalysis() {
    if (!simulationResults) return;
    // Paramètres hors bornes (ex. valeurs enregistrées avant l'ajout des bornes) : pas d'analyse
    // calculée avec, donc pas de rapport ACC tant qu'ils ne sont pas corrigés.
    const erreurs = validerParamsEcoAcc('tout');
    if (erreurs.length) {
        delete simulationResults.economic_results;
        persisterIndicateursEcoAcc(null);
        const container = document.getElementById('economic-results-container');
        if (container) {
            container.innerHTML = `<div class="seasonal-analysis-container"><h3>Analyse de Rentabilité (ACC)</h3>`
                + `<p style="color: var(--danger-color);">Analyse non calculée : corrigez les paramètres économiques `
                + `(boutons « Gérer les paramètres économiques » / « Gérer l'analyse financière avancée »).</p></div>`;
        }
        showMessage('Paramètres économiques invalides : ' + erreurs.join(' '), 'error', 10000);
        return;
    }
    const params = getEconomicParams();
    renderEconomicAnalysis(simulationResults, params);
    persisterIndicateursEcoAcc(simulationResults.economic_results || null, params);
}

/**
 * Étude économique ACC réalisée : enregistrée dans solarProjectData.economicDataACC —
 *  - indicators : condition d'accès au rapport pour un projet en autoconsommation collective
 *    (services/ExportService.js::hasEconomicResultsCalculated) ;
 *  - resultats/parametres/energie : section éco ACC du rapport projet
 *    (services/PdfAccEconomicGenerator.js), qui remplace l'étude éco Grand projet, non utilisée en ACC.
 * `null` efface (analyse invalidée).
 */
function persisterIndicateursEcoAcc(ecoResults, params = null) {
    try {
        const data = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        const producteur = ecoResults?.producteur;
        if (producteur) {
            const { assumptions, ...producteurSansHypotheses } = producteur;
            const participants = {};
            Object.entries(ecoResults).forEach(([nom, r]) => {
                if (nom === 'producteur') return;
                const resume = simulationResults?.sites?.[nom]?.summary || {};
                participants[nom] = {
                    cout_sans_acc: r.cout_sans_acc,
                    cout_avec_acc: r.cout_avec_acc,
                    economie_annuelle: r.economie_annuelle,
                    economie_totale_horizon: r.economie_totale_horizon,
                    consommation_mwh: resume.consumption_mwh,
                    pv_consomme_mwh: resume.pv_consumed_mwh,
                    taux_autoproduction: resume.autoproduction_rate,
                    profil: params?.participants?.[nom]?.profil,
                    prix_achat: params?.participants?.[nom]?.prix_achat,
                    prix_vente_interne: params?.participants?.[nom]?.prix_vente_interne,
                };
            });
            const global = simulationResults?.sites?.Global?.summary || {};
            data.economicDataACC = {
                indicators: {
                    van: producteur.van_projet,
                    triP: producteur.tri_projet,
                    triFP: producteur.tri_equity,
                    lcoe: producteur.lcoe_production,
                    calculatedAt: new Date().toISOString(),
                },
                resultats: { producteur: producteurSansHypotheses, participants },
                parametres: params || assumptions || null,
                energie: {
                    production_mwh: global.production_mwh,
                    consommation_mwh: global.consumption_mwh,
                    pv_consomme_mwh: global.pv_consumed_mwh,
                    surplus_mwh: global.surplus_mwh,
                    taux_autoconsommation: global.autoconsumption_rate,
                    taux_autoproduction: global.autoproduction_rate,
                    puissance_kwc: global.peak_power_kw,
                },
            };
        } else if (data.economicDataACC) {
            delete data.economicDataACC;
        } else {
            return;
        }
        localStorage.setItem('solarProjectData', JSON.stringify(data));
    } catch (e) {
        console.warn("Indicateurs économiques ACC non enregistrés :", e);
    }
}

// === EXPOSITION GLOBALE DES FONCTIONS ===




// NOUVEAU: Fonctions pour gérer le modal PVGIS
let pvgisModalDragInitialized = false;
let pvgisModalDragX = 0;
let pvgisModalDragY = 0;

// Rend le modal PVGIS déplaçable via son en-tête (même technique que les autres modaux de l'app)
function setupPvgisModalDrag() {
    if (pvgisModalDragInitialized) return;
    const header = document.getElementById('pvgis-modal-header');
    const content = document.getElementById('pvgis-modal-content');
    if (!header || !content) return;
    pvgisModalDragInitialized = true;

    let isDragging = false, startX = 0, startY = 0;
    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - pvgisModalDragX;
        startY = e.clientY - pvgisModalDragY;
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        pvgisModalDragX = e.clientX - startX;
        pvgisModalDragY = e.clientY - startY;
        content.style.transform = `translate(${pvgisModalDragX}px, ${pvgisModalDragY}px)`;
    });
    document.addEventListener('mouseup', () => { isDragging = false; });
}

function openPvgisModal() {
    document.getElementById('pvgis-modal-overlay').style.display = 'flex';
    setupPvgisModalDrag();
}

function closePvgisModal() {
    document.getElementById('pvgis-modal-overlay').style.display = 'none';
}

// On s'assure que le navigateur peut trouver les fonctions appelées depuis le HTML
// (removePvFile/removeConsFile n'ont plus besoin d'être exposées ici : leurs boutons sont désormais
// câblés directement par addEventListener dans irve_consumption_import.js, pas via onclick="".)
window.calculate = calculate;
// Issue du dernier calcul, pour un module qui pilote ce modal en iframe (section Rentabilité IRVE).
window.calculAutoconsoReussi = () => dernierCalculAutoconsoReussi;
window.openModal = openModal;
window.exportToPDFServer = exportToPDFServer;
window.exportToExcel = exportToExcel;
window.launchSansPV = launchSansPV;
window.filterResults = filterResults;
window.resetApp = resetApp;
window.exportToPDFJS = exportToPDFJS;
window.toggleSeasonalAnalysis = toggleSeasonalAnalysis;
window.toggleDetailedPvResults = toggleDetailedPvResults;
window.updateKeysTotal = updateKeysTotal; // Exposition correcte de la fonction
window.openPvgisModal = openPvgisModal;
window.closePvgisModal = closePvgisModal;
function toggleStorageSection(show) {
    // Gère la visibilité du bouton de lancement de l'analyse de stockage
    const storageBtn = document.getElementById('storage-analysis-btn');
    if (storageBtn) storageBtn.style.display = show ? 'inline-flex' : 'none';

    // Restauration du bouton "Sans PV"
    const sansPvBtn = document.getElementById('launch-sans-pv-btn');
    if (sansPvBtn) sansPvBtn.style.display = 'inline-flex';


    // Si on sélectionne "Non", on cache aussi les résultats de stockage existants
    if (!show) {
        const storageResults = document.getElementById('storage-results-container');
        if (storageResults) {
            storageResults.style.display = 'none';
        }
    }

    // Actualiser les tableaux et graphiques pour refléter le changement de mode
    const dropdownTable = document.getElementById('site-filter-dropdown');
    if (dropdownTable && dropdownTable.value) {
        filterResults(dropdownTable.value);
    }
}

/**
 * Resserre les bornes de saisie qui dépendent de la CHIMIE choisie, et corrige la valeur courante
 * si elle sort de la nouvelle plage.
 *
 * Miroir côté client de app/schemas/stockage_schemas.py, qui reste l'autorité : le navigateur guide
 * la saisie, le serveur tranche. Sans ce resserrement, un rendement aller-retour de 0,90 pouvait
 * être saisi sur une batterie plomb-acide — physiquement impossible (un plomb plafonne vers 0,60) —
 * et n'était rejeté qu'après l'aller-retour réseau.
 *
 * Exposée globalement : appelée par l'attribut onchange du sélecteur de chimie.
 */
/**
 * Pré-remplit les « Caractéristiques techniques batterie » depuis la batterie choisie dans le
 * calepinage, puis relance le calcul de stockage (demande explicite : « supprimer l'obligation de
 * cliquer sur le bouton de stockage ; le calcul doit se déclencher dès qu'une batterie est
 * sélectionnée »).
 *
 * RÈGLE MÉTIER IMPÉRATIVE : l'autoconsommation de base doit être calculée AVANT d'ajouter la
 * batterie. `simulationResults` en est la preuve — sans lui, le dispatch n'a ni production ni
 * consommation horaire à traiter et le serveur rejette la demande. On pré-remplit alors les champs
 * malgré tout (l'information est utile), mais on ne lance rien et on le dit.
 *
 * Une valeur saisie à la main n'est JAMAIS écrasée : convention `dataset.manual`, déjà utilisée
 * pour #puissance et #productible dans l'étude économique.
 */
function appliquerBatterieSelectionnee(selection, options) {
    if (!selection) return;
    const opts = options || {};

    const renseigner = (id, valeur, decimales) => {
        const champ = document.getElementById(id);
        if (!champ || valeur === null || valeur === undefined) return false;
        if (champ.dataset.manual === 'true') return false; // saisie utilisateur : intouchable
        const nouvelle = typeof valeur === 'number' ? valeur.toFixed(decimales === undefined ? 2 : decimales) : String(valeur);
        if (champ.value === nouvelle) return false;
        champ.value = nouvelle;
        return true;
    };

    let modifie = false;
    modifie = renseigner('sto_cap', selection.capaciteKwh, 1) || modifie;
    modifie = renseigner('sto_charge_power', selection.puissanceChargeKw, 1) || modifie;
    modifie = renseigner('sto_discharge_power', selection.puissanceDechargeKw, 1) || modifie;
    modifie = renseigner('sto_dod', selection.dodPct, 0) || modifie;
    modifie = renseigner('sto_rte', selection.rte, 2) || modifie;
    modifie = renseigner('sto_chemistry', selection.chimie) || modifie;
    // Fin de vie : fiche batterie si renseignée, sinon 60 % (demande explicite).
    modifie = renseigner('sto_soh_fin_vie', selection.sohFinViePct || 60, 0) || modifie;
    // Couplage et onduleur hybride (catalogue) ; évolutivité et courant max (contrôles du parc).
    modifie = renseigner('sto_couplage', selection.typeCouplage || 'AC') || modifie;
    if (selection.rendementOnduleurPct) modifie = renseigner('sto_rendement_onduleur', selection.rendementOnduleurPct, 1) || modifie;
    if (selection.puissanceOnduleurKw) modifie = renseigner('sto_puissance_onduleur_kw', selection.puissanceOnduleurKw, 2) || modifie;
    const cache = (id, valeur) => {
        const champ = document.getElementById(id);
        const texte = (valeur === null || valeur === undefined) ? '' : String(valeur);
        if (champ && champ.value !== texte) { champ.value = texte; return true; }
        return false;
    };
    modifie = cache('sto_nb_serie_min', selection.nbSerieMin) || modifie;
    modifie = cache('sto_nb_serie_max', selection.nbSerieMax) || modifie;
    modifie = cache('sto_nb_parallele_max', selection.nbParalleleMax) || modifie;
    modifie = cache('sto_courant_max_a', selection.courantMaxA) || modifie;
    modifie = cache('sto_onduleur_hybride', selection.onduleurHybride) || modifie;
    modifie = cache('sto_onduleur_compatible', selection.compatibleOnduleur) || modifie;
    majChampsParc();
    apercuParcBatteries();
    if (selection.tensionSystemeV) {
        modifie = renseigner('sto_voltage', selection.tensionSystemeV, 0) || modifie;
    }

    // Les bornes du rendement dépendent de la chimie qui vient d'être posée.
    if (typeof window.appliquerContraintesChimie === 'function') window.appliquerContraintesChimie();

    // Seule la batterie générique reste entièrement modifiable (demande explicite) : une référence
    // catalogue est une fiche constructeur, pas un jeu de paramètres à retoucher.
    verrouillerChampsBatterie(!selection.estGenerique);

    if (opts.sansCalcul) return; // l'appelant lance lui-même le calcul (cf. lancerStockageSiConfigure)
    if (!stockagePrisEnCompte()) return; // stockage retiré du projet : caractéristiques mémorisées, sans calcul
    if (!modifie && !opts.forcer) return;

    if (!simulationResults) {
        showMessage("Batterie « " + (selection.reference || '') + " » prise en compte. "
            + "Lancez d'abord l'analyse d'autoconsommation : le stockage se calculera ensuite automatiquement.",
            'info', 6000);
        return;
    }
    calculateStorage();
}

/**
 * Verrouille (ou libère) les caractéristiques issues d'une fiche constructeur. La batterie
 * générique/personnalisable garde tous ses champs éditables.
 */
function verrouillerChampsBatterie(verrouiller) {
    ['sto_cap', 'sto_charge_power', 'sto_discharge_power', 'sto_dod', 'sto_rte', 'sto_chemistry', 'sto_voltage', 'sto_couplage']
        .forEach((id) => {
            const champ = document.getElementById(id);
            if (!champ || champ.dataset.manual === 'true') return;
            champ.readOnly = verrouiller && champ.tagName === 'INPUT';
            if (champ.tagName === 'SELECT') champ.disabled = verrouiller;
            champ.title = verrouiller
                ? "Valeur issue de la fiche constructeur. Pour la modifier, choisissez la batterie générique dans le calepinage."
                : (champ.dataset.titreOrigine || champ.title);
        });
}

window.appliquerContraintesChimie = function () {
    const chimie = document.getElementById('sto_chemistry')?.value || 'lfpgraphite';
    const estPlomb = chimie === 'leadacid';

    // Rendement aller-retour : 0,30-0,60 pour le plomb, 0,70-0,95 pour le lithium.
    const rte = document.getElementById('sto_rte');
    if (rte) {
        const min = estPlomb ? 0.30 : 0.70;
        const max = estPlomb ? 0.60 : 0.95;
        rte.min = String(min);
        rte.max = String(max);
        rte.title = estPlomb
            ? 'Plomb-acide : rendement aller-retour de 0,30 à 0,60.'
            : 'Lithium : rendement aller-retour de 0,70 à 0,95.';
        const valeur = parseFloat(rte.value);
        // Ramené dans la plage plutôt que laissé invalide : changer de chimie ne doit pas bloquer
        // le calcul sur une valeur héritée de la chimie précédente.
        if (!isFinite(valeur) || valeur < min || valeur > max) {
            rte.value = estPlomb ? '0.50' : '0.90';
        }
    }

    // Tension système : les installations plomb hors réseau utilisent des bus normalisés.
    const tension = document.getElementById('sto_voltage');
    if (tension) {
        tension.title = estPlomb
            ? "Plomb-acide hors réseau : 12, 24, 48 ou 96 V. Au-delà de 100 V, la plage générale 12-1500 V s'applique."
            : 'De 12 à 1500 V.';
    }
};

function openStorageModal() {
    if (!simulationResults) {
        showMessage("Veuillez d'abord lancer une analyse d'autoconsommation.", 'error');
        return;
    }
    // Initialiser les sélecteurs d'heures si ce n'est pas déjà fait
    if (!document.getElementById('sto_recharge_selector').hasChildNodes()) {
        initTimeSelector('recharge');
        initTimeSelector('decharge');
    }
    document.getElementById('storage-modal-overlay').style.display = 'flex';
    majChampsParc();
    apercuParcBatteries();
}

// ─── Parc de batteries et couplage ───────────────────────────────────────────
// Règles de calcul et contrôles : UNIQUEMENT côté serveur (configuration_parc_batteries.py). Le modal
// affiche l'aperçu renvoyé par /storage_parc, le calcul de stockage applique exactement le même.
// Fonction (et non constante) : saveStorageParams/restoreStorageParams peuvent s'exécuter avant
// l'évaluation de cette ligne du module.
function champsParcPersistes() {
    return ['sto_nb_serie', 'sto_couplage', 'sto_rendement_onduleur', 'sto_puissance_onduleur_kw',
        'sto_nb_serie_min', 'sto_nb_serie_max', 'sto_nb_parallele_max', 'sto_courant_max_a',
        'sto_onduleur_hybride', 'sto_onduleur_compatible'];
}

function lireParametresParc() {
    const val = (id) => document.getElementById(id)?.value;
    const nombre = (id) => { const n = parseFloat(val(id)); return isFinite(n) && n > 0 ? n : null; };
    const booleen = (id) => (val(id) === 'true' ? true : (val(id) === 'false' ? false : null));
    const montage = val('sto_montage') || 'serie';
    const nb = parseInt(val('sto_nb_batteries'), 10);
    return {
        sto_nb_batteries: isNaN(nb) ? 1 : nb,
        sto_montage: montage,
        sto_nb_serie: montage === 'serie-parallele' ? nombre('sto_nb_serie') : null,
        sto_couplage: val('sto_couplage') || 'AC',
        sto_rendement_onduleur: nombre('sto_rendement_onduleur') || 97,
        sto_puissance_onduleur_kw: nombre('sto_puissance_onduleur_kw'),
        sto_nb_serie_min: nombre('sto_nb_serie_min'),
        sto_nb_serie_max: nombre('sto_nb_serie_max'),
        sto_nb_parallele_max: nombre('sto_nb_parallele_max'),
        sto_courant_max_a: nombre('sto_courant_max_a'),
        sto_onduleur_hybride: booleen('sto_onduleur_hybride'),
        sto_onduleur_compatible: booleen('sto_onduleur_compatible'),
    };
}

function majChampsParc() {
    const montage = document.getElementById('sto_montage')?.value;
    const groupeSerie = document.getElementById('groupe_sto_nb_serie');
    if (groupeSerie) groupeSerie.style.display = montage === 'serie-parallele' ? '' : 'none';
    const dc = document.getElementById('sto_couplage')?.value === 'DC';
    document.querySelectorAll('.champ-couplage-dc').forEach((el) => { el.style.display = dc ? '' : 'none'; });
}

function formaterNombre(v, decimales, unite) {
    return (v === null || v === undefined || !isFinite(v)) ? 'NA' : `${Number(v).toFixed(decimales)}${unite ? ' ' + unite : ''}`;
}

function htmlParc(parc) {
    if (!parc) return '';
    const couleurs = { erreur: '#b91c1c', avertissement: '#b45309', info: '#475569' };
    const icones = { erreur: '⛔', avertissement: '⚠️', info: 'ℹ️' };
    const rendement = parc.rendement_systeme_pct
        ? `<div><strong>Rendement de bout en bout :</strong> charge solaire ${formaterNombre(parc.rendement_systeme_pct.solaire, 1, '%')}, recharge réseau ${formaterNombre(parc.rendement_systeme_pct.reseau, 1, '%')}</div>`
        : '';
    const alertes = (parc.alertes || []).map((a) =>
        `<div style="color:${couleurs[a.niveau] || '#475569'}; margin-top:0.25rem;">${icones[a.niveau] || ''} ${a.message}</div>`).join('');
    const config = parc.nb_total
        ? `${parc.nb_total} batterie(s) — ${parc.serie} en série × ${parc.parallele} en parallèle`
        : 'Configuration invalide';
    return `
        <div><strong>Parc :</strong> ${config} — couplage ${parc.couplage}</div>
        <div><strong>Tension du bus :</strong> ${formaterNombre(parc.tension_bus_v, 0, 'V')} · <strong>Capacité :</strong> ${formaterNombre(parc.capacite_ah, 0, 'Ah')}
            · ${formaterNombre(parc.capacite_nominale_kwh, 2, 'kWh')} nominale / ${formaterNombre(parc.capacite_utile_kwh, 2, 'kWh')} utile</div>
        <div><strong>Puissance :</strong> charge ${formaterNombre(parc.puissance_charge_kw, 2, 'kW')} / décharge ${formaterNombre(parc.puissance_decharge_kw, 2, 'kW')}
            · <strong>Courant max :</strong> ${formaterNombre(parc.courant_max_a, 0, 'A')} · <strong>C-rate :</strong> ${formaterNombre(parc.c_rate, 2, 'C')}
            · <strong>Autonomie à pleine puissance :</strong> ${formaterNombre(parc.autonomie_h, 1, 'h')}</div>
        ${rendement}${alertes}`;
}

function apercuParcBatteries() {
    // État porté par window : la fonction peut être appelée avant l'évaluation de ce bloc du module.
    const etat = window.__apercuParc || (window.__apercuParc = { timer: null, requete: 0 });
    clearTimeout(etat.timer);
    etat.timer = setTimeout(async () => {
        const zone = document.getElementById('sto_parc_resume');
        if (!zone) return;
        const numero = ++etat.requete;
        const corps = {
            sto_cap: parseFloat(document.getElementById('sto_cap')?.value) || 1,
            sto_charge_power: parseFloat(document.getElementById('sto_charge_power')?.value) || 0.5,
            sto_discharge_power: parseFloat(document.getElementById('sto_discharge_power')?.value) || 0.5,
            sto_dod: parseFloat(document.getElementById('sto_dod')?.value) || 100,
            sto_rte: parseFloat(document.getElementById('sto_rte')?.value) || 0.9,
            sto_chemistry: document.getElementById('sto_chemistry')?.value || 'lfpgraphite',
            sto_voltage: parseFloat(document.getElementById('sto_voltage')?.value) || null,
            ...lireParametresParc(),
        };
        try {
            const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
            const reponse = await fetch(`${apiPrefix}/storage_parc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
            const donnees = await reponse.json();
            if (numero !== etat.requete) return; // une saisie plus récente a déjà relancé l'aperçu
            zone.innerHTML = reponse.ok ? htmlParc(donnees) : `<div style="color:#b91c1c;">⛔ ${donnees.error || 'Saisie invalide.'}</div>`;
        } catch (e) {
            if (numero === etat.requete) zone.innerHTML = '';
        }
    }, 250);
}

window.majChampsParc = majChampsParc;
window.apercuParcBatteries = apercuParcBatteries;

function closeStorageModal() {
    document.getElementById('storage-modal-overlay').style.display = 'none';
}

// Fonctions portées depuis main_stockage.js
function initTimeSelector(type) {
    const container = document.getElementById(`sto_${type}_selector`);
    if (!container) return;
    container.innerHTML = '';

    const input = document.getElementById(`sto_${type}_hours`);
    // Recharge réseau : aucune heure sélectionnée par défaut (l'utilisateur doit choisir
    // explicitement les heures creuses concernées — la recharge réseau a un coût économique non
    // encore pris en compte, cf. disclaimer). Décharge : conserve un défaut nocturne tant qu'aucun
    // profil type n'a été choisi (cf. applyDischargeProfile()). Une sélection explicitement vide
    // ("[]", déjà présente dans input.value) est respectée telle quelle, sans retomber sur un
    // défaut — seule l'ABSENCE de valeur déclenche le défaut.
    const defaultHours = type === 'recharge' ? [] : [22, 23, 0, 1, 2, 3, 4, 5];
    const selectedHours = (input && input.value) ? JSON.parse(input.value) : defaultHours;
    if (!input.value) input.value = JSON.stringify(defaultHours);

    for (let i = 0; i < 24; i++) {
        const div = document.createElement('div');
        div.className = 'time-segment';
        if (selectedHours.includes(i)) div.classList.add('selected');
        div.dataset.hour = i;
        div.title = `${i}h - ${i + 1}h`;
        div.onclick = () => {
            div.classList.toggle('selected');
            updateSelectedHours(type);
        };
        container.appendChild(div);
    }
    updateDisplay(type);
}

function updateSelectedHours(type) {
    const container = document.getElementById(`sto_${type}_selector`);
    const selected = Array.from(container.querySelectorAll('.selected')).map(div => parseInt(div.dataset.hour));
    document.getElementById(`sto_${type}_hours`).value = JSON.stringify(selected);
    updateDisplay(type);
    saveStorageParams();
}

function updateDisplay(type) {
    const count = document.querySelectorAll(`#sto_${type}_selector .selected`).length;
    document.getElementById(`sto_${type}_display`).textContent = `${count}h sélectionnées`;
}

// Formes horaires journalières par profil type (24 valeurs, somme = 1) — même référence que
// window.DAILY_SHAPE_BY_PROFILE dans app/static/concevoir_mon_projet/javascript/Irve/equipmentData.js
// (module IRVE, page séparée, non chargée ici : la table est dupliquée plutôt que partagée via un
// script cross-page). Sert uniquement à identifier les heures de plus forte consommation pour
// pré-remplir la plage de décharge — à tenir synchronisée si les profils IRVE sont ajustés.
const DISCHARGE_PROFILE_SHAPES = {
    residentiel: [
        0.0220, 0.0176, 0.0154, 0.0143, 0.0154, 0.0220,
        0.0385, 0.0604, 0.0714, 0.0495, 0.0385, 0.0352,
        0.0385, 0.0352, 0.0330, 0.0352, 0.0418, 0.0527,
        0.0769, 0.0879, 0.0714, 0.0549, 0.0418, 0.0305
    ],
    tertiaire: [
        0.0109, 0.0109, 0.0109, 0.0109, 0.0109, 0.0163,
        0.0272, 0.0543, 0.0761, 0.0815, 0.0815, 0.0761,
        0.0652, 0.0761, 0.0815, 0.0815, 0.0761, 0.0598,
        0.0326, 0.0163, 0.0109, 0.0109, 0.0109, 0.0107
    ],
    industriel: [
        0.0396, 0.0396, 0.0396, 0.0396, 0.0396, 0.0396,
        0.0446, 0.0446, 0.0446, 0.0446, 0.0446, 0.0446,
        0.0446, 0.0446, 0.0446, 0.0446, 0.0396, 0.0396,
        0.0396, 0.0396, 0.0396, 0.0396, 0.0396, 0.0392
    ],
    supermarche: [
        0.0191, 0.0172, 0.0172, 0.0172, 0.0172, 0.0191,
        0.0239, 0.0335, 0.0478, 0.0574, 0.0622, 0.0670,
        0.0718, 0.0670, 0.0574, 0.0526, 0.0574, 0.0670,
        0.0718, 0.0574, 0.0383, 0.0239, 0.0191, 0.0175
    ],
    agricole: [
        0.0282, 0.0282, 0.0282, 0.0282, 0.0329, 0.0469,
        0.0610, 0.0563, 0.0516, 0.0469, 0.0469, 0.0469,
        0.0423, 0.0423, 0.0469, 0.0469, 0.0516, 0.0563,
        0.0516, 0.0423, 0.0329, 0.0282, 0.0282, 0.0283
    ],
    boulangerie: [
        0.0067, 0.0067, 0.0067, 0.0202, 0.0538, 0.0739,
        0.0807, 0.0739, 0.0645, 0.0605, 0.0565, 0.0618,
        0.0591, 0.0484, 0.0457, 0.0538, 0.0618, 0.0591,
        0.0484, 0.0269, 0.0108, 0.0067, 0.0067, 0.0067
    ],
    discount: [
        0.0050, 0.0050, 0.0050, 0.0050, 0.0050, 0.0050,
        0.0066, 0.0132, 0.0430, 0.0827, 0.0827, 0.0827,
        0.0827, 0.0827, 0.0860, 0.0860, 0.0860, 0.0860,
        0.0827, 0.0397, 0.0099, 0.0058, 0.0058, 0.0058
    ],
    autres: Array(24).fill(1 / 24)
};

/**
 * Auto-remplit la plage de décharge de la batterie avec les 8 heures de plus forte consommation
 * du profil type sélectionné, tout en laissant la sélection modifiable ensuite (initTimeSelector
 * reconstruit simplement les segments à partir de la nouvelle valeur, comme pour une sélection
 * manuelle classique).
 */
function applyDischargeProfile() {
    const profileKey = document.getElementById('sto_profil_decharge').value;
    if (!profileKey) return; // "— Sélection manuelle —" : ne rien changer
    const shape = DISCHARGE_PROFILE_SHAPES[profileKey];
    if (!shape) return;

    const topHours = shape
        .map((value, hour) => ({ hour, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)
        .map((entry) => entry.hour)
        .sort((a, b) => a - b);

    document.getElementById('sto_decharge_hours').value = JSON.stringify(topHours);
    initTimeSelector('decharge');
    saveStorageParams();
    if (typeof showMessage === 'function') {
        showMessage(`Plage de décharge pré-remplie selon le profil "${profileKey}" — toujours modifiable manuellement.`, 'info');
    }
}

function saveStorageParams() {
    const params = {
        sto_cap: document.getElementById('sto_cap')?.value,
        sto_charge_power: document.getElementById('sto_charge_power')?.value,
        sto_discharge_power: document.getElementById('sto_discharge_power')?.value,
        sto_dod: document.getElementById('sto_dod')?.value,
        sto_rte: document.getElementById('sto_rte')?.value,
        sto_voltage: document.getElementById('sto_voltage')?.value,
        sto_nb_batteries: document.getElementById('sto_nb_batteries')?.value,
        sto_montage: document.getElementById('sto_montage')?.value,
        ...Object.fromEntries(champsParcPersistes().map((id) => [id, document.getElementById(id)?.value])),
        sto_cycles: document.getElementById('sto_cycles')?.value,
        sto_degrad_cal: document.getElementById('sto_degrad_cal')?.value,
        sto_soh_fin_vie: document.getElementById('sto_soh_fin_vie')?.value,
        sto_chemistry: document.getElementById('sto_chemistry')?.value,
        stockagePrisEnCompte: stockagePrisEnCompte(),
        rechargeHours: document.getElementById('sto_recharge_hours')?.value,
        dechargeHours: document.getElementById('sto_decharge_hours')?.value,
        storageStrategy: document.querySelector('input[name="storage_strategy"]:checked')?.value,
    };
    saveToLS('storageParams', params);
}

function restoreStorageParams() {
    const params = loadFromLS('storageParams');
    if (!params) return;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
    setVal('sto_cap', params.sto_cap);
    setVal('sto_charge_power', params.sto_charge_power);
    setVal('sto_discharge_power', params.sto_discharge_power);
    setVal('sto_dod', params.sto_dod);
    // Rétro-compatibilité : une configuration enregistrée avant le passage au rendement unique porte
    // l'ancien couple charge/décharge, dont le PRODUIT est précisément le rendement aller-retour.
    if (params.sto_rte !== undefined && params.sto_rte !== '') {
        setVal('sto_rte', params.sto_rte);
    } else if (params.sto_rendement_charge && params.sto_rendement_decharge) {
        const ancienRte = parseFloat(params.sto_rendement_charge) * parseFloat(params.sto_rendement_decharge);
        if (isFinite(ancienRte) && ancienRte > 0) setVal('sto_rte', ancienRte.toFixed(2));
    }
    setVal('sto_cycles', params.sto_cycles);
    setVal('sto_degrad_cal', params.sto_degrad_cal);
    if (params.sto_soh_fin_vie) setVal('sto_soh_fin_vie', params.sto_soh_fin_vie);
    setVal('sto_chemistry', params.sto_chemistry);
    setVal('sto_voltage', params.sto_voltage);
    setVal('sto_nb_batteries', params.sto_nb_batteries);
    setVal('sto_montage', params.sto_montage);
    champsParcPersistes().forEach((id) => setVal(id, params[id]));
    majChampsParc();
    // Les bornes du RTE et de la tension dépendent de la chimie restaurée ci-dessus.
    if (typeof appliquerContraintesChimie === 'function') appliquerContraintesChimie();
    // Option de restitution : volontairement NON restaurée (demande explicite) — toujours « Non » à
    // l'ouverture, la recharge réseau devant être un choix explicite de la session en cours.
    // Case « Prendre en compte le stockage » : restaurée, cochée par défaut si jamais enregistrée.
    const caseStockage = document.getElementById('sto_prise_en_compte');
    if (caseStockage) caseStockage.checked = params.stockagePrisEnCompte !== false;
    mettreAJourEtatCaseStockage();
    if (params.rechargeHours) setVal('sto_recharge_hours', params.rechargeHours);
    if (params.dechargeHours) setVal('sto_decharge_hours', params.dechargeHours);
    if (params.storageStrategy) {
        const r = document.querySelector(`input[name="storage_strategy"][value="${params.storageStrategy}"]`);
        if (r) r.checked = true;
    }
}

/**
 * Module PAC / climatiseur : gain du décalage de la production d'ECS sur les heures solaires (même
 * production PV, mêmes autres usages, même règle d'affectation — cf. _gain_ecs_solaire côté serveur).
 */
function afficherGainEcsSolaire(results) {
    const conteneur = document.getElementById('pac-gain-ecs-container');
    const g = results && results.gain_ecs_solaire;
    if (!conteneur) return;
    if (!g) { conteneur.innerHTML = ''; return; }
    const kwh = (v) => `${Math.round(v || 0).toLocaleString('fr-FR')} kWh`;
    const pct = (v) => (v == null ? '--' : `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`);
    const libellesPlage = { permanente: 'permanente', nuit: 'la nuit', perso: 'personnalisée', solaire: 'aux heures solaires' };
    const plage = libellesPlage[g.plage_base] || 'actuelle';
    conteneur.innerHTML = `
        <div class="stats-grid" style="margin-top: 1rem;">
            <div class="stat-card"><div class="label">ECS aux heures solaires : PV consommé par la PAC</div>
                <div class="value">${g.gain_pv_pac_kwh >= 0 ? '+' : ''}${kwh(g.gain_pv_pac_kwh)}</div>
                <p style="margin:0.3rem 0 0; font-size:0.8rem;">${kwh(g.pac_base.pv_kwh)} (production ${plage}) → ${kwh(g.pac_solaire.pv_kwh)}</p></div>
            <div class="stat-card"><div class="label">Achat au réseau évité (PAC)</div>
                <div class="value">${kwh(g.gain_reseau_kwh)}</div>
                <p style="margin:0.3rem 0 0; font-size:0.8rem;">Réseau PAC : ${kwh(g.pac_base.reseau_kwh)} → ${kwh(g.pac_solaire.reseau_kwh)}</p></div>
            <div class="stat-card"><div class="label">Taux d'autoconsommation global</div>
                <div class="value">${pct(g.autoconsommation_solaire)}</div>
                <p style="margin:0.3rem 0 0; font-size:0.8rem;">au lieu de ${pct(g.autoconsommation_base)} avec la production ${plage}</p></div>
        </div>`;
}

/** Ordre personnalisé d'affectation du PV (du plus prioritaire au moins prioritaire). */
function lireOrdreUsages() {
    return Array.from(document.querySelectorAll('.priority-ordre-select')).map(sel => sel.value);
}

function majOrdrePersonnalise() {
    const bloc = document.getElementById('priority-ordre-container');
    const choisi = document.querySelector('input[name="priority"]:checked')?.value;
    if (bloc) bloc.style.display = choisi === 'ordre' ? 'flex' : 'none';
}

async function initPersistence() {
    // 1. Formulaire principal (time-step, priority)
    const formState = loadFromLS('mainFormState');
    if (formState) {
        const tsSelect = document.getElementById('time-step-select');
        if (tsSelect && formState.timeStep) tsSelect.value = formState.timeStep;
        if (formState.priority) {
            const pr = document.querySelector(`input[name="priority"][value="${formState.priority}"]`);
            if (pr) pr.checked = true;
        }
        if (Array.isArray(formState.ordreUsages)) {
            document.querySelectorAll('.priority-ordre-select').forEach((sel, i) => {
                if (formState.ordreUsages[i]) sel.value = formState.ordreUsages[i];
            });
        }
        majOrdrePersonnalise();
        // storage-toggle : intentionnellement NON restauré depuis le stockage local — l'activation
        // du stockage doit toujours démarrer sur "Non" par défaut à l'ouverture (défaut sécurisant,
        // cohérent avec la réinitialisation des heures de recharge réseau), même si une session
        // précédente l'avait laissé sur "Oui".
    }

    // 2. Paramètres du modal stockage (les hidden inputs sto_recharge_hours / sto_decharge_hours
    //    sont restaurés ici pour que initTimeSelector() les lise à la première ouverture du modal)
    restoreStorageParams();

    // 3. Fichier PV (restauré depuis IndexedDB si présent) — l'affichage est déjà géré par
    // renderPvInputHere() elle-même (relit IndexedDB à chaque rendu) ; on ne fait ici que remettre à
    // jour pvFileObject, lu directement par calculateInternal()/buildCalcSignature().
    const pvFile = await getFileFromIDB('pvFile');
    if (pvFile && !pvFileObject) {
        pvFileObject = pvFile;
    }

    // 4. Fichier de consommation ACI — même principe : l'affichage est déjà géré par
    // renderAciConsumerInputHere() elle-même, on ne restaure ici que consFileObject.
    const studyType = document.querySelector('input[name="study_type"]:checked')?.value;
    if (studyType === 'aci') {
        // NOUVEAU (persistance CDC en base) : si l'IndexedDB locale est vide (vidage de cache
        // navigateur, autre machine/session) mais qu'une CDC a été sauvegardée en base pour ce
        // projet, elle est restaurée ici dans l'IndexedDB avant la lecture normale — sans dupliquer
        // la logique de lecture existante (getFileFromIDB('consFile') reste l'unique point de lecture
        // pour le reste du code, y compris renderAciConsumerInputHere()).
        await restoreConsFileFromDBIfMissing();
        const consFile = await getFileFromIDB('consFile');
        if (consFile && !consFileObject) {
            consFileObject = consFile;
        }
    }

    // 5. Fichiers ACC
    if (studyType === 'acc') {
        await restoreAccFilesFromIDB(showMessage);
    }

    // 6. Saisies des modales éco ACC (tarifs + analyse financière avancée) : la base fait foi.
    await restaurerSaisiesEcoAccDepuisBase();
}

async function calculateStorage() {
    if (!stockagePrisEnCompte()) {
        showMessage("Le stockage n'est pas pris en compte : cochez « Prendre en compte le stockage solaire dans le projet ».", 'error', 6000);
        return;
    }
    if (!simulationResults) {
        showMessage("Veuillez d'abord lancer une analyse d'autoconsommation.", 'error');
        return;
    }

    saveStorageParams();
    showLoader(true);
    showMessage("Simulation PySAM en cours (le calcul du stockage peut prendre quelques secondes)...", 'info');

    const globalSummary = simulationResults.sites['Global'].summary;

    // Puissance/PR issus de results.pv_summary (renvoyé par le backend lorsque la production
    // a été calculée automatiquement via PVGIS). Reste à 0 si un fichier PV a été importé manuellement.
    const pvSummary = simulationResults.pv_summary;
    let stoPuissance = 0;
    let stoPrInit = 0;
    if (pvSummary?.plants_summary && pvSummary.plants_summary.length > 0) {
        stoPuissance = pvSummary.plants_summary.reduce((sum, plant) => sum + plant.peak_power, 0);
        // Pour le PR, on peut prendre la moyenne ou le premier, selon la logique métier. Prenons le premier pour l'instant.
        stoPrInit = pvSummary.plants_summary[0].performance_ratio;
    }

    const params = {
        sto_puissance: stoPuissance,
        sto_productible: pvSummary?.summary?.specific_production || 0,
        sto_pr_init: stoPrInit,
        sto_prod_totale_mwh: globalSummary.production_mwh || 0,
        sto_pv_consommee_mwh: globalSummary.pv_consumed_mwh || 0,
        sto_surplus_mwh: globalSummary.surplus_mwh || 0,
        sto_cap: parseFloat(document.getElementById('sto_cap').value) || 0,
        sto_dod: parseFloat(document.getElementById('sto_dod').value) || 0,
        // Chimie/tension batterie (module PySAM) : lecture défensive, ces champs sont ajoutés à
        // l'étape 4 (HTML) — la valeur par défaut du backend (LFP, 400V) s'applique tant qu'absents.
        sto_chemistry: document.getElementById('sto_chemistry')?.value || 'lfpgraphite',
        sto_voltage: parseFloat(document.getElementById('sto_voltage')?.value) || 400,
        // Un seul rendement : le serveur le décompose en √RTE pour les deux entrées de PySAM
        // (cf. rendements_depuis_rte, calcul_stockage.py).
        sto_rte: parseFloat(document.getElementById('sto_rte').value) || 0.90,
        // Transmis et conservés, mais sans effet sur le dimensionnement pour l'instant (demande
        // explicite : calcul figé sur une batterie).
        ...lireParametresParc(),
        sto_cycles: parseFloat(document.getElementById('sto_cycles').value) || 0,
        sto_degrad_cal: parseFloat(document.getElementById('sto_degrad_cal').value) || 0,
        sto_soh_fin_vie: parseFloat(document.getElementById('sto_soh_fin_vie')?.value) || 60,
        sto_charge_power: parseFloat(document.getElementById('sto_charge_power').value) || 0,
        sto_discharge_power: parseFloat(document.getElementById('sto_discharge_power').value) || 0,
        sto_restitution_toggle: document.querySelector('input[name="sto_restitution_toggle"]:checked').value,
        sto_recharge_hours: JSON.parse(document.getElementById('sto_recharge_hours').value),
        sto_decharge_hours: JSON.parse(document.getElementById('sto_decharge_hours')?.value || '[]'),
        sto_strategy: document.querySelector('input[name="storage_strategy"]:checked').value,
        time_step: parseInt(document.getElementById('time-step-select').value) || 60
    };

    // La courbe horaire PV est renvoyée dans hourly_data.pv (ACI/Vente totalité) ou
    // hourly_data.pv_production (ACC), quelle que soit la source de la production.
    const hourlyPv = simulationResults.hourly_data?.pv || simulationResults.hourly_data?.pv_production;
    if (hourlyPv) {
        params.hourly_pv = hourlyPv;
    }
    if (simulationResults && simulationResults.hourly_data) {
        const hd = simulationResults.hourly_data;
        // ACC : pas de cons_existante/cons_irve, seulement la consommation cumulée des participants
        // (total_consumption, kW par pas comme en ACI). Sans ce repli, le serveur ne recevait aucune
        // courbe de consommation et refusait le calcul (« données horaires manquantes ») : la
        // batterie, placée chez le producteur, se décharge sur la consommation de l'opération.
        params.hourly_cons_existante = hd.cons_existante || hd.total_consumption || [];
        params.hourly_cons_irve = hd.cons_irve || [];
        // Module PAC / climatiseur : 3e flux de charge de la batterie.
        params.hourly_cons_pac = hd.cons_pac || [];
    }

    closeStorageModal(); // Fermer le modal après avoir récupéré les valeurs

    // Pas de nouvel appel serveur si ni le calcul d'autoconsommation (même empreinte d'entrées,
    // solar_sim_signature) ni les paramètres de stockage n'ont changé depuis le dernier stockage
    // calculé : relancé automatiquement après chaque « Calculer et visualiser » (cf.
    // lancerStockageSiConfigure), même quand l'autoconsommation sort du cache. Les courbes horaires
    // découlent de simulationResults, déjà couvert par solar_sim_signature.
    const signatureSim = localStorage.getItem('solar_sim_signature');
    const { hourly_pv, hourly_cons_existante, hourly_cons_irve, hourly_cons_pac, ...paramsSansCourbes } = params;
    const signatureStockage = signatureSim ? JSON.stringify({ sim: signatureSim, params: paramsSansCourbes }) : null;

    try {
        let storageResultsData = null;
        if (signatureStockage && signatureStockage === localStorage.getItem('solar_storage_signature')
            && calculEnregistre(MARQUEUR_STOCKAGE_ENREGISTRE, signatureStockage)) {
            try {
                const enCache = JSON.parse(localStorage.getItem('solar_storage_data') || 'null');
                if (enCache && enCache.outputs) storageResultsData = enCache;
            } catch (e) {}
        }
        if (!storageResultsData) {
            const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
            const projetIdStockage = getProjetIdActif();
            const response = await fetch(`${apiPrefix}/calculate_storage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, projet_id: projetIdStockage }) });
            if (!response.ok) { const err = await response.json(); throw new Error(err.error || "Erreur serveur."); }
            storageResultsData = await response.json();
            noterEnregistrement(MARQUEUR_STOCKAGE_ENREGISTRE, signatureStockage, !!storageResultsData.prosolaire_enregistre);
            signalerResultatsProSolaire();
            if (signatureStockage) localStorage.setItem('solar_storage_signature', signatureStockage);
            else localStorage.removeItem('solar_storage_signature');
        }
        window.storageResults = storageResultsData; // Stockage global pour export PDF

        // BUG CORRIGÉ (audit localStorage) : le modal "Études économiques" (etudes_economique_content.html,
        // injectAutoconsoDataToEconomicStudy()) lit le taux combiné depuis localStorage.solar_storage_data
        // et ne se rafraîchit qu'en réaction aux événements 'autoconsommationUpdated'/'autoconsommationCalculated'
        // — ni l'un ni l'autre n'étaient produits ici. Cette écriture existait dans l'ancienne version de ce
        // fichier (main_autoconso_Old_A_Supprimer.js) mais a été perdue lors d'un refactor précédent : le champ
        // "Taux d'autoconsommation initial (récupéré automatiquement)" restait donc bloqué sur le taux PV seul
        // (solar_sim_data, jamais modifié par le stockage), même après un calcul de stockage réussi.
        localStorage.setItem('solar_storage_data', JSON.stringify(storageResultsData));
        window.dispatchEvent(new CustomEvent('autoconsommationUpdated'));

        const rate = parseFloat(storageResultsData?.outputs?.taux_combine);
        if (isFinite(rate) && !isNaN(rate) && rate >= 0 && rate <= 100) {
            window.currentSessionAutoconsoRate = rate;
            sessionStorage.setItem('activeAutoconsoRate', rate);
            window.dispatchEvent(new CustomEvent('autoconsommationCalculated', { detail: { rate: rate } }));
        }

        displayStorageResults(storageResultsData, params);
        synchroniserStockageAffiche();
        const btnLancer = document.getElementById('storage-launch-btn');
        if (btnLancer) btnLancer.style.boxShadow = '';

        // Rafraîchir les KPI globaux, le tableau récapitulatif et l'analyse saisonnière/mensuelle
        // pour refléter le nouveau taux d'autoconsommation combiné (PV + stockage) — appelé
        // inconditionnellement (repli sur 'Global' si aucun site n'est explicitement sélectionné)
        // car ces tableaux ne se mettaient auparavant JAMAIS à jour après un calcul de stockage.
        const dropdownTable = document.getElementById('site-filter-dropdown');
        filterResults(dropdownTable?.value || 'Global');

    } catch (error) { handleError(error, 'Calcul Stockage'); } finally { showLoader(false); }
}

function displayStorageResults(data, params) {
    const container = document.getElementById('storage-results-container');
    if (!container) return;
    const { outputs, bilanEnergetique, chartData, errorMessage } = data;

    // La simulation PySAM peut échouer (données horaires manquantes, non-convergence) sans que la
    // requête HTTP échoue elle-même : le backend renvoie alors outputs/bilanEnergetique vides avec
    // errorMessage renseigné. Il faut le détecter AVANT de tenter le rendu (sinon .toFixed() sur
    // des champs absents lève une exception).
    if (errorMessage) {
        container.innerHTML = `
                    <div class="seasonal-analysis-container">
                        <h3>Analyse du Stockage</h3>
                        <div style="color: red; text-align: center; min-height: 20px; font-weight: bold;">${errorMessage}</div>
                        ${outputs && outputs.parc ? `<div class="section-box" style="font-size:0.9rem;">${htmlParc(outputs.parc)}</div>` : ''}
                    </div>`;
        container.style.display = 'block';
        container.scrollIntoView({ behavior: 'smooth' });
        return;
    }

    let bilanHtml = bilanEnergetique.rows.map(row => `<tr><td>${row.label}</td><td>${row.value.toFixed(2)}</td></tr>`).join('');
    bilanHtml += `<tr style="font-weight:bold; background:#eee;"><td>TOTAL</td><td>${bilanEnergetique.total.toFixed(2)}</td></tr>`;

    // Parts DIRECTES seules : taux_ext/taux_irve sont des taux COMBINÉS par flux (PV direct +
    // restitution batterie) — les afficher ici à côté de "Taux Autoconso Stockage PV" et du
    // "Nouveau Taux Combiné" donnait un panneau qui ne s'additionnait pas (taux combiné égal au
    // taux "Conso. Existante" quand il n'y a pas d'IRVE), comme si la batterie n'était pas comptée
    // dans le total alors qu'elle l'était déjà dans les deux. Avec les taux directs, la lecture est
    // exacte : direct existante + direct IRVE + stockage = nouveau taux combiné.
    const tauxExt = data.outputs ? (data.outputs.taux_ext_direct ?? data.outputs.taux_ext) : 0.0;
    const tauxIrve = data.outputs ? (data.outputs.taux_irve_direct ?? data.outputs.taux_irve) : 0.0;
    const tauxPac = data.outputs ? (data.outputs.taux_pac_direct ?? data.outputs.taux_pac ?? 0) : 0.0;
    const avecPac = !!(simulationResults?.site_keys || []).includes('Cons. PAC');
    const tauxAutoconsoStockagePV = data.outputs ? data.outputs.taux_stock : 0.0;
    const nouveauTauxCombine = data.outputs ? data.outputs.taux_combine : 0.0;
    const prInit = data.outputs ? data.outputs.pr_init : 0.0;
    const prFinal = data.outputs ? data.outputs.pr_final : 0.0;
    // ACC : toute la consommation des participants passe par le flux « existante » (cf. calculateStorage).
    const estAcc = document.querySelector('input[name="study_type"]:checked')?.value === 'acc';
    const champsDirects = estAcc
        ? `<div class="form-group"><label title="Part du PV consommée directement par les participants de l'opération, hors batterie">Taux Autoconso Directe Participants ACC (%)</label><input value="${tauxExt.toFixed(2)}" readonly placeholder="0.00"></div>`
        : `<div class="form-group"><label title="Part du PV consommée directement par la consommation existante, hors batterie">Taux Autoconso Directe Conso. Existante (%)</label><input value="${tauxExt.toFixed(2)}" readonly placeholder="0.00"></div>
                    <div class="form-group"><label title="Part du PV consommée directement par l'IRVE, hors batterie">Taux Autoconso Directe IRVE (%)</label><input value="${tauxIrve.toFixed(2)}" readonly placeholder="0.00"></div>${avecPac ? `
                    <div class="form-group"><label title="Part du PV consommée directement par la PAC / climatisation, hors batterie">Taux Autoconso Directe PAC (%)</label><input value="${tauxPac.toFixed(2)}" readonly placeholder="0.00"></div>` : ''}`;

    const hypothesesHtml = data.outputs ? `
                <h4 class="modal-category-title" style="font-size: 1em; margin-top: 20px;">Analyse des Taux d'Autoconsommation & Performance</h4>
                <div class="grid section-box" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                    ${champsDirects}
                    <div class="form-group"><label title="Part du PV stockée puis restituée par la batterie (hors énergie rechargée depuis le réseau)">Taux Autoconso Stockage PV (%)</label><input value="${tauxAutoconsoStockagePV.toFixed(2)}" readonly placeholder="0.00"></div>
                    <div class="form-group"><label title="Somme des taux directs et du taux de stockage">Nouveau Taux Combiné (%)</label><input value="${nouveauTauxCombine.toFixed(2)}" readonly placeholder="0.00" style="color: var(--accent-primary); font-weight: bold; background-color: #eef2ff;"></div>
                </div>
                <h4 class="modal-category-title" style="font-size: 1em; margin-top: 20px;">Ajustement du Performance Ratio (PR)</h4>
                <div class="grid section-box" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                    <div class="form-group"><label>PR Initial (Sans stockage) (%)</label><input value="${prInit.toFixed(2)}" readonly></div>
                    <div class="form-group"><label>Pertes Stockage (Impact PR) (%)</label><input value="${(prInit - prFinal).toFixed(2)}" readonly></div>
                    <div class="form-group"><label>PR Final du Projet (%)</label><input value="${prFinal.toFixed(2)}" readonly style="color: var(--accent-primary); font-weight: bold; background-color: #eef2ff;"></div>
                </div>
            ` : '';

    const parcHtml = data.outputs && data.outputs.parc ? `
                <h4 class="modal-category-title" style="font-size: 1em; margin-top: 20px;">Parc de batteries et couplage</h4>
                <div class="section-box" style="font-size:0.9rem;">${htmlParc({ ...data.outputs.parc, rendement_systeme_pct: data.outputs.rendement_systeme_theorique_pct })}
                    ${typeof data.outputs.rte_realise_pct === 'number' ? `<div><strong>Rendement aller-retour simulé :</strong> ${data.outputs.rte_realise_pct.toFixed(1)} % (égal au rendement de bout en bout attendu, à quelques dixièmes près)</div>` : ''}
                </div>` : '';

    container.innerHTML = `
                <div class="seasonal-analysis-container">
                    <h3>Analyse du Stockage</h3>
                    ${parcHtml}
                    ${hypothesesHtml}

                    <h4 class="modal-category-title" style="font-size: 1em; margin-top: 10px;">Indicateurs Clés du Stockage</h4>
                    <div class="grid section-box">
                        <div class="form-group"><label title="Années avant d'atteindre l'état de santé de fin de vie, selon les cycles réellement simulés et la dégradation calendaire (sans remplacement)">Durée d'utilisation batterie (ans)</label><input value="${Number(outputs.sto_duree_vie).toFixed(1)}" readonly></div>
                        ${typeof outputs.cycles_an === 'number' ? `<div class="form-group"><label title="Énergie déchargée sur l'année / capacité utile">Cycles équivalents complets (par an)</label><input value="${outputs.cycles_an.toFixed(0)}" readonly></div>` : ''}
                        <div class="form-group"><label>Capacité de stockage annuel (MWh/an)</label><input value="${outputs.sto_annuel.toFixed(2)}" readonly></div>
                        <div class="form-group"><label>Prod. solaire autocons. (MWh)</label><input value="${outputs.sto_prod_autoconsommee.toFixed(2)}" readonly></div>
                        <div class="form-group"><label>Stockage réseau et restitution (MWh/an)</label><input value="${outputs.sto_reseau.toFixed(2)}" readonly></div>
                        <div class="form-group"><label title="Énergie restituée par la batterie jusqu'à sa fin de vie, perte de capacité incluse">Énergie restituée sur la durée de vie (MWh)</label><input value="${outputs.sto_energie_vie.toFixed(2)}" readonly></div>
                        ${typeof outputs.capacite_simulee_kwh === 'number' ? `<div class="form-group"><label title="Capacité nominale du parc réellement simulé (calée sur la capacité saisie) et part utilisable selon la profondeur de décharge">Capacité simulée / utile (kWh)</label><input value="${outputs.capacite_simulee_kwh.toFixed(2)} / ${outputs.capacite_utile_kwh.toFixed(2)}" readonly></div>` : ''}
                        ${typeof outputs.rte_realise_pct === 'number' ? `<div class="form-group"><label title="Énergie restituée par la batterie / énergie chargée, obtenue par la simulation">Rendement aller-retour simulé (%)</label><input value="${outputs.rte_realise_pct.toFixed(1)}" readonly></div>` : ''}
                    </div>
                    <div style="color: red; text-align: center; min-height: 20px; font-weight: bold;">${errorMessage}</div>
                    <div style="display: flex; align-items: center; gap: 20px; margin-top: 20px; flex-wrap: wrap;">
                        <table class="results-table" style="flex: 1; min-width: 300px;">
                            <thead><tr><th>Bilan énergétique</th><th>Énergie (MWh/an)</th></tr></thead>
                            <tbody>${bilanHtml}</tbody>
                        </table>
                        <div style="width:300px; height:300px; margin: 0 auto;"><canvas id="storageResultChart"></canvas></div>
                    </div>
                </div>`;
    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth' });

    const canvas = document.getElementById('storageResultChart');
    if (storageChart) storageChart.destroy();
    storageChart = new Chart(canvas.getContext('2d'), {
        type: 'pie', data: chartData,
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => c.label + ': ' + c.raw + ' MWh/an' } } } }
    });
}

window.toggleStorageSection = toggleStorageSection;
window.openStorageModal = openStorageModal;
window.closeStorageModal = closeStorageModal;
window.calculateStorage = calculateStorage;
window.launchSansPV = launchSansPV; // Correction: Exposer la fonction
