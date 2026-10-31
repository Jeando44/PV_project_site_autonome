/**
 * Orchestrateur de la vue "Chiffrage & Devis Résidentiel" du modal Études Économiques.
 *
 * Actif uniquement quand window.ACTIVE_PROJECT_TYPOLOGIE === 'Résidentielle' (défini par
 * parametre.html, chargé avant cette page — cf. commentaire équivalent dans index.html). Pour
 * toute autre typologie, ce fichier ne fait strictement rien : #etudes-eco-standard-view (onglets
 * Production/Chiffrage & Financement/Résultats) reste affiché tel quel, comportement inchangé.
 *
 * Stratégie : masquer #etudes-eco-standard-view, construire la vue verticale dans
 * #etudes-eco-residentiel-view en enchaînant (ordre du défilement) :
 *   Autoconsommation (demande explicite : tout en haut, cf. mountAutoconsoSection() /
 *   ResidentielAutoconsoEmbed.js — iframe du modal Autoconsommation embarquée à la demande) →
 *   Production (repris) → Revenus & tarifs (repris) → CAPEX → OPEX →
 *   [Provisions & indexation | Financement | Fiscalité] (barre de boutons + zone de contenu
 *   commune, cf. mountAccordionSections) → Actions (calcul + devis PDF) → Résultats (panneau
 *   #Resultats existant, déplacé).
 * Toutes les sections "reprises" sont de VRAIS déplacements DOM (cf. ResidentielReusedSections.js)
 * — mêmes ids, mêmes écouteurs, même moteur de calcul, zéro duplication/divergence d'état. La
 * section Autoconsommation, elle, n'est PAS un déplacement DOM (le modal Autoconsommation tourne
 * dans une iframe séparée, cf. ResidentielAutoconsoEmbed.js) : seule une ancre vide est créée ici,
 * remplie à la demande (premier clic sur "Calculer et visualiser" depuis le modal Calepinage
 * Maison — voir calepinage_maison_formulaires.js).
 */
(function () {
    'use strict';

    function isResidentielTypologie() {
        return window.isResidentialPath();
    }

    /**
     * CORRECTIF (bug rapporté : "le bouton Télécharger le rapport redemande de calculer alors que
     * l'étude éco est déjà calculée, résultats affichés à l'écran") : précondition du bouton
     * "Télécharger le rapport" (cf. #resi-download-rapport-btn dans init()). Une première version
     * s'appuyait sur un booléen hasRunSimulation basculé par un point d'interception unique
     * (window.runSimulation enveloppé) — en théorie robuste au fait que le calcul puisse être
     * déclenché par autre chose que le clic sur #resi-calculate-btn (cf. commentaire de
     * wrapRunSimulationForGainAnnuel ci-dessous, écrit pour EXACTEMENT cette raison), mais restait
     * malgré tout un état JS en mémoire pouvant diverger de la réalité affichée à l'écran (ex. si le
     * calcul a été effectivement lancé et affiché, mais AVANT que le wrapping n'ait eu lieu, ou par
     * un chemin qui échappe encore au point d'interception). Plutôt que de traquer tous les chemins
     * possibles, on lit directement la vérité affichée à l'écran : #res_van (case "VAN projet" du
     * tableau d'indicateurs, cf. displayResults()/EtudesEconomiqueLogic.js) reste à son placeholder
     * "-" tant qu'aucun calcul n'a abouti, et contient une vraie valeur chiffrée sitôt un calcul
     * terminé — quel que soit ce qui l'a déclenché. Aucun état à synchroniser, aucun risque de
     * désynchronisation possible.
     */
    function hasComputedResults() {
        // Résultats remis à 0 après une saisie (cf. remettreResultatsEcoAZero) : « 0 » contient un
        // chiffre mais n'est pas un calcul.
        if (typeof window.resultatsEcoCalcules === 'function') return window.resultatsEcoCalcules();
        const el = document.getElementById('res_van');
        if (!el) return false;
        const txt = (el.textContent || '').trim();
        return txt !== '' && txt !== '-' && /\d/.test(txt);
    }

    function buildResidentielDom(container) {
        container.innerHTML = `
            <h2>Chiffrage &amp; Devis</h2>
            <div id="resi-production-anchor"></div>
            <div id="resi-revenus-anchor"></div>
            <div id="resi-capex-container"></div>
            <div id="resi-opex-container" style="margin-top:30px;"></div>
            <div id="resi-accordion-buttons-bar" style="display:flex; gap:15px; align-items:center; flex-wrap:wrap; margin:20px 0 0;"></div>
            <div id="resi-accordion-content-area"></div>
            <div class="resi-actions" style="margin:25px 0; padding-top:15px; border-top:1px solid var(--border-color, #ddd); display:flex; gap:15px; align-items:center; flex-wrap:wrap;">
                <!-- CORRECTIF (demande explicite : "centrer et colorer le bouton Lancer le calcul
                     en vert, même couleur que le devis") : .btn-export, même classe que "Générer le
                     devis PDF" (var(--accent-green)) — centrage via .resi-actions{justify-content:
                     center} (etudes_economique_content.html). -->
                <button type="button" id="resi-calculate-btn" class="btn-export">Lancer le calcul</button>
                <!-- NOUVEAU (demande explicite : "Placer également le bouton Télécharger le rapport
                     dans le modal économique... à droite du bouton calculer") : réutilise le MÊME
                     service que le bouton homonyme du modal Calepinage Maison (cf.
                     ResidentielAutoconsoEmbed.js::window.cmDownloadAutoconsoRapport), bloqué tant
                     que le calcul ci-dessus n'a pas été lancé au moins une fois (cf. init() plus bas). -->
                <button type="button" id="resi-download-rapport-btn" class="btn-export" style="background:#fff; color:var(--accent-green, #16a34a); border:1px solid var(--accent-green, #16a34a);">Télécharger le rapport</button>
            </div>
            <div class="resi-export-actions" style="margin:0 0 25px; display:flex; gap:12px; align-items:center; justify-content:center; flex-wrap:wrap;">
                <button type="button" id="resi-export-cablage-btn" class="btn-export" style="background:#fff; color:#005A9E; border:1px solid #005A9E;">
                    <i class="fas fa-project-diagram"></i> Exporter le plan de câblage
                </button>
                <button type="button" id="resi-export-devis-detaille-btn" class="btn-export" style="background:#fff; color:#1E8449; border:1px solid #1E8449;">
                    <i class="fas fa-file-invoice-dollar"></i> Exporter le devis détaillé en PDF/Excel
                </button>
                <button type="button" id="resi-export-devis-synthetique-btn" class="btn-export" style="background:#fff; color:#1E8449; border:1px solid #1E8449;">
                    <i class="fas fa-file-invoice"></i> Exporter le devis synthétique en PDF/Excel
                </button>
            </div>
        `;
    }

    /**
     * Groupe "Inclure le détail des lignes dans le devis PDF" + "Générer le devis PDF" — construit
     * une seule fois puis RELOCALISÉ (déplacé, jamais recréé) sur la ligne "Total Capex" du tableau
     * CAPEX à chaque re-rendu de celui-ci (cf. écouteur 'residentielCapexChanged' dans init() :
     * ResidentielCapexTable.js réécrit entièrement son innerHTML à chaque modification, ce qui
     * détruirait ce groupe s'il y était directement inclus).
     *
     * display:contents (pas inline-flex) : le <span> conteneur disparaît de la mise en page, ses
     * enfants (label + bouton + statut) deviennent des éléments flex DIRECTS de la même ligne que
     * "Total Capex" et ses 4 valeurs (.resi-capex-grand-total) — alignement unique garanti, plutôt
     * qu'un sous-groupe qui pourrait se replier séparément (demande explicite point 3).
     */
    function buildDevisControlsGroup() {
        const group = document.createElement('span');
        group.id = 'resi-devis-controls-group';
        group.style.cssText = 'display:contents;';
        // CORRECTIF (les 4 valeurs numériques n'avaient plus la place de tenir sur une ligne à
        // côté de ce groupe) : ce groupe vit désormais sur sa PROPRE ligne, sous "Total Capex"
        // (cf. ResidentielCapexTable.js::render() — <p class="resi-devis-controls-row"> séparé de
        // <p class="resi-capex-grand-total">), qui n'a donc plus jamais à partager sa largeur.
        group.innerHTML = `
            <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:normal; font-size:0.85em; white-space:nowrap;">
                <input type="checkbox" id="resi-devis-detail-checkbox"> Inclure le détail des lignes dans le devis PDF
            </label>
            <button type="button" id="resi-devis-pdf-btn" class="btn-export">Générer le devis PDF</button>
            <span id="resi-devis-pdf-status" style="font-size:0.85em; color: var(--text-secondary, #666); white-space:nowrap;"></span>
        `;
        return group;
    }

    function mountReusedSections() {
        const RS = window.ResidentielChiffrage && window.ResidentielChiffrage.ReusedSections;
        if (!RS) return;

        const productionAnchor = document.getElementById('resi-production-anchor');
        const productionSection = RS.buildProductionSection();
        if (productionAnchor && productionSection) productionAnchor.appendChild(productionSection);

        const revenusAnchor = document.getElementById('resi-revenus-anchor');
        const revenusSection = RS.buildRevenusTarifsSection();
        if (revenusAnchor && revenusSection) revenusAnchor.appendChild(revenusSection);

        // Financement/Fiscalité sont construits (et déplacés depuis le standard view) par
        // mountAccordionSections() ci-dessous — pas ici — pour que leur bouton ET leur panneau de
        // contenu soient positionnés ensemble, au bon endroit, dans le même geste.
    }

    /**
     * Construit/positionne les 3 accordéons "Provisions & indexation" (EN PREMIER, demande
     * explicite 3A) / "Financement" / "Fiscalité" : les 3 boutons alignés horizontalement dans
     * #resi-accordion-buttons-bar, et leurs panneaux de contenu respectifs dans
     * #resi-accordion-content-area, juste en dessous de cette même barre — quel que soit le bouton
     * cliqué, son contenu apparaît donc toujours au même endroit, dans le flux normal du document
     * (demande explicite 3B), jamais "en bas du groupe de boutons" ni ailleurs.
     */
    function mountAccordionSections(RC) {
        const bar = document.getElementById('resi-accordion-buttons-bar');
        const contentArea = document.getElementById('resi-accordion-content-area');
        if (!bar || !contentArea) return;

        const sections = [];

        if (RC.Opex && typeof RC.Opex.getProvisionsToggleButton === 'function') {
            const button = RC.Opex.getProvisionsToggleButton();
            const panel = RC.Opex.getProvisionsPanel();
            if (button && panel) sections.push({ button, panel });
        }
        if (RC.ReusedSections) {
            const financementPanel = RC.ReusedSections.buildFinancementSection();
            const financementBtn = RC.ReusedSections.getFinancementToggleButton();
            if (financementBtn && financementPanel) sections.push({ button: financementBtn, panel: financementPanel });

            const fiscalitePanel = RC.ReusedSections.buildFiscaliteSection();
            const fiscaliteBtn = RC.ReusedSections.getFiscaliteToggleButton();
            if (fiscaliteBtn && fiscalitePanel) sections.push({ button: fiscaliteBtn, panel: fiscalitePanel });
        }

        sections.forEach(({ button, panel }) => {
            bar.appendChild(button);
            contentArea.appendChild(panel);
        });
    }

    /**
     * Ancre pour les résultats d'autoconsommation (Analyse mensuelle, Analyse des taux, Tableau
     * récapitulatif, etc.) — remplie à la demande par ResidentielAutoconsoEmbed.js, PAS ici (ce
     * fichier ne connaît rien du modal Autoconsommation ni de son iframe, cf. commentaire d'en-tête).
     * Insérée en TOUT PREMIER (demande explicite), avant même le titre "Chiffrage & Devis" posé par
     * buildResidentielDom() — d'où insertBefore(container.firstChild) plutôt qu'un ajout dans le
     * template statique de buildResidentielDom() (où elle apparaîtrait après coup, à la mauvaise
     * place, puisque cette fonction est appelée après buildResidentielDom() dans init()).
     */
    function mountAutoconsoSection(container) {
        if (document.getElementById('resi-autoconso-anchor')) return;

        const section = document.createElement('div');
        section.id = 'resi-autoconso-section';
        section.style.cssText = 'margin-bottom:25px; padding-bottom:15px; border-bottom:1px solid var(--border-color, #ddd);';
        section.innerHTML = `
            <h2>Autoconsommation</h2>
            <div id="resi-autoconso-anchor">
                <p style="color: var(--text-secondary, #666); font-size:0.9em;">
                    Cliquez sur « Calculer et visualiser » depuis le calepinage pour afficher vos résultats d'autoconsommation.
                </p>
            </div>
        `;
        container.insertBefore(section, container.firstChild);
    }

    function moveResultatsIntoView(container) {
        const resultatsEl = document.getElementById('Resultats');
        if (!resultatsEl) return;
        // Rendre le panneau visible AVANT toute création de graphique Chart.js (sinon les canvases
        // sont dimensionnés à 0x0 au moment de leur création, cf. risque identifié en conception).
        resultatsEl.classList.add('active');
        resultatsEl.style.display = '';
        container.appendChild(resultatsEl);
    }

    /**
     * Point 9 : la vue résidentielle n'affiche que les indicateurs "Fonds propres" — la section
     * Fonds + Dette (et son bouton de bascule) restent masqués en permanence (le calcul continue
     * de tourner normalement en arrière-plan, seul l'affichage change), et une carte "Gain annuel
     * moyen" est ajoutée à la grille des indicateurs Fonds propres.
     */
    function restrictResultsToFondsPropres() {
        const detteSection = document.getElementById('section-kpi-dette');
        const toggleButtons = document.getElementById('kpi-toggle-buttons');
        if (detteSection) detteSection.style.display = 'none';
        if (toggleButtons) toggleButtons.style.display = 'none';

        // Masque Analyse de sensibilité / Exporter CSV / Exporter PDF (non pertinents en
        // résidentiel : le devis PDF résidentiel remplace ces exports, cf. bouton déplacé sur la
        // ligne Total Capex).
        ['btn-analyse-sensibilite', 'btn-export-csv', 'btn-export-pdf'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // "#simuler_deux_options" (case restée dans #etudes-eco-standard-view, masquée) est cochée
        // par défaut — runSimulation() calcule alors AUSSI le scénario Fonds+Dette et réaffiche
        // #section-kpi-dette/#kpi-toggle-buttons (avec !important, cf. EtudesEconomiqueLogic.js)
        // après chaque calcul, ce qui écraserait le masquage ci-dessus. On la décoche une fois ici
        // pour que runSimulation() ne calcule/affiche QUE le scénario Fonds propres (point 9).
        const simulerDeuxCheckbox = document.getElementById('simuler_deux_options');
        if (simulerDeuxCheckbox) simulerDeuxCheckbox.checked = false;

        // CORRECTIF (point 7 : indicateurs clés en tableau) : #indicators-container est désormais
        // une <table class="kpi-results-table"> (Rési + Pro) — ajouter une <tr> dans son <tbody>,
        // plus une <div class="result-card"> (invalide en enfant direct d'une table).
        const indicatorsTbody = document.querySelector('#indicators-container tbody');
        console.log('[ResidentielEtudeEcoView] restrictResultsToFondsPropres() — indicatorsTbody trouvé ?', !!indicatorsTbody, 'ligne déjà présente ?', !!document.getElementById('res_gain_annuel_fp'));
        if (indicatorsTbody && !document.getElementById('res_gain_annuel_fp')) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>Gain annuel moyen (<span class="symb-devise">€</span> HT/an)</td>
                <td id="res_gain_annuel_fp">-</td>`;
            indicatorsTbody.appendChild(row);
        }
    }

    /**
     * Gain annuel moyen = Gain cumulés actualisé (k€) rapporté à l'horizon d'étude (nombre
     * d'années) — formule confirmée explicitement par l'utilisateur, alignée sur celle ajoutée au
     * rapport PDF (EtudesEconomiqueLogic.js::exportPDF()) pour rester cohérente entre écran et PDF.
     * Calculé à partir des résultats déjà affichés par le moteur existant (aucune donnée
     * recalculée en parallèle, juste une division par l'horizon).
     */
    function updateGainAnnuelCard() {
        const card = document.getElementById('res_gain_annuel_fp');
        if (!card) {
            console.warn('[ResidentielEtudeEcoView] #res_gain_annuel_fp introuvable — la ligne n\'a pas été insérée dans #indicators-container (cf. restrictResultsToFondsPropres).');
            return;
        }
        const gainsCumActRaw = document.getElementById('res_gains_act_final')?.textContent;
        const gainsCumActKEuro = parseFloat(gainsCumActRaw);
        const horizon = parseFloat(document.getElementById('horizon')?.value);
        console.log('[ResidentielEtudeEcoView] updateGainAnnuelCard()', { gainsCumActRaw, gainsCumActKEuro, horizon });
        if (isNaN(gainsCumActKEuro) || !horizon) {
            card.textContent = '-';
            return;
        }
        const gainAnnuel = (gainsCumActKEuro * 1000) / horizon;
        card.textContent = gainAnnuel.toFixed(2);
    }

    /**
     * CORRECTIF (le champ restait sur "-" malgré un calcul lancé) : au lieu de ne recalculer que
     * sur le clic du bouton #resi-calculate-btn (point de défaillance unique si quoi que ce soit
     * d'autre invoque window.runSimulation()), on enveloppe la fonction globale elle-même une
     * seule fois — TOUT appel à window.runSimulation(), d'où qu'il vienne, met désormais à jour
     * cette carte juste après.
     *
     */
    function wrapRunSimulationForGainAnnuel() {
        const original = window.runSimulation;
        if (typeof original !== 'function' || original.__residentielGainWrapped) return;
        window.runSimulation = async function (...args) {
            const result = await original.apply(this, args);
            updateGainAnnuelCard();
            return result;
        };
        window.runSimulation.__residentielGainWrapped = true;
    }

    async function handleGenerateDevisPdf(button, statusEl) {
        const Capex = window.ResidentielChiffrage.Capex;
        const detailCheckbox = document.getElementById('resi-devis-detail-checkbox');

        button.disabled = true;
        statusEl.textContent = 'Génération en cours...';
        try {
            await window.ResidentielChiffrage.PDF.previewAndExport({
                capexOverride: Capex ? Capex.getData() : undefined,
                detailed: !!(detailCheckbox && detailCheckbox.checked),
                onProgress: (msg) => { statusEl.textContent = msg; }
            });
            statusEl.textContent = 'Aperçu du devis ouvert.';
        } catch (e) {
            console.error('[ResidentielEtudeEcoView] Échec génération devis PDF :', e);
            statusEl.textContent = e.message || 'Échec de la génération du devis PDF.';
        } finally {
            button.disabled = false;
        }
    }

    /**
     * Groupe « Inclure le détail des lignes » + « Générer le devis PDF » (devis détaillé ou
     * synthétique) : construit une fois, relocalisé sous « Total Capex » à chaque re-rendu du
     * tableau CAPEX. Partagé avec la vue PRO / Grand projet (pro/ProEtudeEcoView.js) — une seule
     * des deux vues est active sur un projet.
     */
    let devisControlsMounted = false;
    function mountDevisControls() {
        if (devisControlsMounted) return;
        devisControlsMounted = true;
        const devisControlsGroup = buildDevisControlsGroup();
        const placeDevisControlsGroup = () => {
            const anchor = document.getElementById('resi-devis-controls-anchor');
            if (anchor && anchor !== devisControlsGroup.parentNode) {
                anchor.appendChild(devisControlsGroup);
            }
        };
        document.addEventListener('residentielCapexChanged', placeDevisControlsGroup);
        placeDevisControlsGroup(); // premier placement : Capex.init() a déjà rendu l'ancre.
        // Case créée après la restauration des saisies de l'étude : valeur enregistrée reprise.
        if (typeof window.restaurerChampEco === 'function') {
            window.restaurerChampEco(devisControlsGroup.querySelector('#resi-devis-detail-checkbox'));
        }

        const devisPdfBtn = devisControlsGroup.querySelector('#resi-devis-pdf-btn');
        const devisPdfStatus = devisControlsGroup.querySelector('#resi-devis-pdf-status');
        devisPdfBtn.addEventListener('click', () => handleGenerateDevisPdf(devisPdfBtn, devisPdfStatus));
    }

    // Vrai une fois la vue résidentielle construite : init() ne doit JAMAIS s'exécuter deux fois
    // (écouteurs, sections déplacées...). Cf. ensureInit() ci-dessous.
    let initDone = false;

    function init() {
        if (initDone) return;
        if (!isResidentielTypologie()) return;

        const standardView = document.getElementById('etudes-eco-standard-view');
        const residentielView = document.getElementById('etudes-eco-residentiel-view');
        if (!residentielView) return;
        initDone = true;

        if (standardView) standardView.style.display = 'none';
        residentielView.style.display = 'block';

        buildResidentielDom(residentielView);
        mountAutoconsoSection(residentielView);
        mountReusedSections();

        // CORRECTIF (demande explicite : "masquer Puissance installée (kWc) en résidentiel, déjà
        // disponible dans les résultats d'autoconsommation au-dessus") : #puissance est un champ
        // RÉEL DÉPLACÉ (pas dupliqué, cf. mountReusedSections()/RS.buildProductionSection()) depuis
        // #etudes-eco-standard-view — masquer ce même noeud n'affecte donc QUE la vue résidentielle
        // (ce code ne tourne jamais pour Pro/Grand-projet, isResidentielTypologie() ci-dessus).
        const puissanceField = document.getElementById('puissance');
        const puissanceGroup = puissanceField && puissanceField.closest('.form-group');
        if (puissanceGroup) puissanceGroup.style.display = 'none';

        const RC = window.ResidentielChiffrage || {};
        if (RC.Capex) RC.Capex.init(document.getElementById('resi-capex-container'));
        if (RC.Opex) RC.Opex.init(document.getElementById('resi-opex-container'));

        mountAccordionSections(RC);

        // Relocalise (jamais ne recrée) le groupe "Inclure le détail.../Générer le devis PDF" sur
        // la ligne "Total Capex" à chaque re-rendu du tableau CAPEX (cf. buildDevisControlsGroup).
        mountDevisControls();

        moveResultatsIntoView(residentielView);
        restrictResultsToFondsPropres();
        wrapRunSimulationForGainAnnuel();

        // Restaure les données précédemment sauvegardées (écrase les valeurs par défaut posées
        // ci-dessus par Capex.init()/Opex.init() si une config existe déjà en base), puis active
        // la sauvegarde automatique des modifications suivantes.
        if (RC.DB) {
            RC.DB.loadAndApply().finally(() => {
                RC.DB.setupAutosave();
            });
        }

        const calculateBtn = document.getElementById('resi-calculate-btn');
        if (calculateBtn) {
            calculateBtn.addEventListener('click', async () => {
                if (typeof window.runSimulation === 'function') {
                    // Case « Prendre en compte la revente du surplus » : transmise au calcul
                    // (venteSurplus, cf. collectInputs) — le tarif affiché n'est plus modifié.
                    await window.runSimulation();
                    updateGainAnnuelCard();
                    const resultatsEl = document.getElementById('Resultats');
                    if (resultatsEl && resultatsEl.scrollIntoView) {
                        resultatsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
            });
        }

        const downloadRapportBtn = document.getElementById('resi-download-rapport-btn');
        if (downloadRapportBtn) {
            downloadRapportBtn.addEventListener('click', () => {
                if (!hasComputedResults()) {
                    alert('Veuillez d\'abord cliquer sur « Lancer le calcul » avant de télécharger le rapport.');
                    return;
                }
                if (typeof window.cmDownloadAutoconsoRapport === 'function') {
                    window.cmDownloadAutoconsoRapport();
                } else {
                    console.warn('[ResidentielEtudeEcoView] cmDownloadAutoconsoRapport indisponible (ResidentielAutoconsoEmbed.js non chargé ?).');
                }
            });
        }

        const exportCablageBtn = document.getElementById('resi-export-cablage-btn');
        if (exportCablageBtn) {
            exportCablageBtn.addEventListener('click', () => {
                if (typeof window.exporterPlanCablageDcProjet !== 'function') {
                    alert("Le plan de câblage n'est pas disponible sur cette page.");
                    return;
                }
                const CM = window.CalepinageMaisonIndiv;
                const champs = CM && typeof CM.getPvFieldsForChainesPertes === 'function'
                    ? (CM.getPvFieldsForChainesPertes() || [])
                    : (Array.isArray(window.__chainesPertesChampsProjet) ? window.__chainesPertesChampsProjet : []);
                if (!champs.length) {
                    alert("Aucun champ PV calepiné : veuillez d'abord dessiner les panneaux sur la toiture.");
                    return;
                }
                if (!window.exporterPlanCablageDcProjet(champs)) {
                    alert("Aucun pan câblé : veuillez d'abord configurer les chaînes dans « Ouvrir Dimensionnement ».");
                }
            });
        }

        const exportDevisDetailleBtn = document.getElementById('resi-export-devis-detaille-btn');
        if (exportDevisDetailleBtn) {
            exportDevisDetailleBtn.addEventListener('click', async () => {
                const PDF = window.ResidentielChiffrage && window.ResidentielChiffrage.PDF;
                const Capex = window.ResidentielChiffrage && window.ResidentielChiffrage.Capex;
                if (!PDF || typeof PDF.previewAndExport !== 'function') return;
                exportDevisDetailleBtn.disabled = true;
                try {
                    await PDF.previewAndExport({
                        capexOverride: Capex ? Capex.getData() : undefined,
                        detailed: true,
                    });
                } catch (e) {
                    alert(e.message || "Échec de l'export du devis détaillé.");
                } finally {
                    exportDevisDetailleBtn.disabled = false;
                }
            });
        }

        const exportDevisSynthetiqueBtn = document.getElementById('resi-export-devis-synthetique-btn');
        if (exportDevisSynthetiqueBtn) {
            exportDevisSynthetiqueBtn.addEventListener('click', async () => {
                const PDF = window.ResidentielChiffrage && window.ResidentielChiffrage.PDF;
                const Capex = window.ResidentielChiffrage && window.ResidentielChiffrage.Capex;
                if (!PDF || typeof PDF.previewAndExport !== 'function') return;
                exportDevisSynthetiqueBtn.disabled = true;
                try {
                    await PDF.previewAndExport({
                        capexOverride: Capex ? Capex.getData() : undefined,
                        detailed: false,
                    });
                } catch (e) {
                    alert(e.message || "Échec de l'export du devis synthétique.");
                } finally {
                    exportDevisSynthetiqueBtn.disabled = false;
                }
            });
        }
    }

    window.addEventListener('load', () => {
        // Laisser EtudesEconomiqueLogic.js (window.onload) terminer son initialisation en premier
        // (généré avant dans le template) avant de déplacer/masquer quoi que ce soit.
        setTimeout(init, 650);
    });

    // CORRECTIF (bug rapporté : "Calculer et visualiser ne marche pas" sur un projet résidentiel) :
    // init() ne tournait qu'UNE fois, 650 ms après le chargement de la page, et seulement si le
    // projet actif À CE MOMENT-LÀ était résidentiel. Page chargée sur un projet Pro puis ouverture
    // d'un projet résidentiel sans rechargement (changement de projet), ou clic très rapide après le
    // chargement : l'ancre des résultats (#resi-autoconso-anchor) n'existait pas, et le bouton du
    // calepinage s'arrêtait silencieusement. ensureInit() permet à ResidentielAutoconsoEmbed.js de
    // construire la vue à la demande, au moment du clic (sans jamais la reconstruire si elle existe).
    window.ResidentielEtudeEcoView = {
        ensureInit() {
            init();
            return !!document.getElementById('resi-autoconso-anchor');
        },
        mountDevisControls,
    };
})();
