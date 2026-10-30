/**
 * Sections reprises telles quelles du modal Pro/Grand projet pour la vue Chiffrage & Devis
 * Résidentiel : Production (type de système, devise, puissance, productible, taux
 * d'autoconsommation, dégradation, horizon), Revenus & tarifs (tarif d'achat électricité,
 * indexation, paliers de revente — avec verrouillage du tarif de surplus résidentiel), Financement
 * (dette/fonds propres, par défaut Fonds propres en résidentiel), Fiscalité (dépréciation masquée).
 *
 * Technique : DÉPLACEMENT réel des éléments existants (appendChild, jamais de clonage) depuis
 * #etudes-eco-standard-view (masqué pour un projet Résidentielle) vers la vue résidentielle —
 * mêmes ids, mêmes écouteurs, même moteur de calcul (collectInputs()), aucune divergence d'état
 * possible entre les deux vues. Sans effet pour Professionnelle/Grand projet : ce fichier n'agit
 * que sous le même garde-fou typologie que ResidentielEtudeEcoView.js (jamais appelé sinon).
 */
(function () {
    'use strict';

    window.ResidentielChiffrage = window.ResidentielChiffrage || {};

    // Même style que le champ #productible (readonly Pro/Grand) — convention déjà en place.
    const LOCKED_FIELD_STYLE = 'background-color:#e9ecef; cursor:not-allowed;';

    // Boutons d'accordéon Financement/Fiscalité, remplis par buildFinancementSection()/
    // buildFiscaliteSection() — cf. getAccordionToggleButtons() plus bas.
    let financementToggleBtn = null;
    let fiscaliteToggleBtn = null;

    function formGroupOf(selector) {
        const el = document.querySelector(selector);
        return el ? el.closest('.form-group') : null;
    }

    /**
     * Enveloppe `contentEl` dans un panneau masqué par défaut (`.resi-reused-section`) et construit
     * son bouton d'accordéon SÉPARÉMENT (jamais inséré ici) — le bouton est destiné à rejoindre la
     * barre commune "Financement / Fiscalité / Provisions & Indexation" alignée horizontalement
     * (cf. ResidentielEtudeEcoView.js::mountAccordionButtonsBar, demande explicite point 4),
     * pendant que le panneau de contenu reste à son emplacement d'origine dans le flux.
     * Retourne { button, panel }.
     */
    function wrapInAccordion(label, contentEl) {
        const panel = document.createElement('div');
        panel.className = 'resi-reused-section';
        contentEl.style.display = 'none';
        panel.appendChild(contentEl);

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn btn-secondary resi-accordion-toggle';
        toggleBtn.style.cssText = 'white-space:nowrap; flex-shrink:0;';
        toggleBtn.textContent = '▸ ' + label;

        toggleBtn.addEventListener('click', () => {
            const isHidden = contentEl.style.display === 'none';
            contentEl.style.display = isHidden ? 'block' : 'none';
            toggleBtn.textContent = (isHidden ? '▾ ' : '▸ ') + label;
        });

        return { button: toggleBtn, panel };
    }

    /** Construit la section "Production" et la retourne (non insérée dans le DOM). */
    function buildProductionSection() {
        const section = document.createElement('div');
        section.id = 'resi-production-container';

        const title = document.createElement('h2');
        title.textContent = 'Production';
        section.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'grid';

        const fieldSelectors = [
            'input[name="type_systeme"]',
            'input[name="devise"]',
            '#puissance',
            '#productible',
            '#taux_autoconsommation',
            // Demande explicite : ces deux champs doivent être visibles pour un projet "Site
            // autonome ou Projet PV Hybride" — lequel emprunte désormais ce parcours résidentiel
            // quelle que soit sa typologie. Restés dans #etudes-eco-standard-view (masqué ici), ils
            // étaient inatteignables. Les déplacer est sans effet pour un projet connecté au réseau :
            // ils portent la classe .field-hybride-only, que toggleSystemeFields() garde en
            // display:none tant que le type de système n'est pas "Site autonome/Hybride".
            '#consommation_energie_site',
            '#taux_de_couverture_PV',
            '#degradation',
            '#horizon'
        ];

        fieldSelectors.forEach((sel) => {
            const fg = formGroupOf(sel);
            if (fg) grid.appendChild(fg);
        });

        section.appendChild(grid);
        return section.querySelector('.grid').children.length ? section : null;
    }

    /**
     * Règle métier (France, ≤100 kWc) : tarif de vente de surplus (#pal_t_1, généré par
     * generatePaliers()) et indexation (#indexation_vente_12) verrouillés à 11 €/MWh et 2%/an,
     * réévalués si puissance/pays changent. Hors de ce périmètre (résidentiel exporté hors
     * France, ou >100 kWc — cas rare), champs laissés éditables (comportement Pro standard).
     */
    function setupSurplusTariffLock() {
        function eligible() {
            // Batterie virtuelle : #pal_t_1 devient le tarif de rachat du surplus stocké, propre à
            // l'offre choisie — plus le tarif réglementé de vente du surplus. La case suffit (hors
            // hybride), quel que soit le taux d'autoconsommation (même règle que
            // batterieVirtuelleDisponible, EtudesEconomiqueLogic.js) : le tarif de rachat enregistré
            // ou proposé (100 €/MWh) n'est jamais remplacé par 11 €/MWh.
            const caseBV = document.getElementById('batterie_virtuelle_optin');
            if (caseBV && caseBV.checked) {
                const isHybride = document.querySelector('input[name="type_systeme"]:checked')?.value === 'hybride';
                if (!isHybride) return false;
            }
            const pays = document.getElementById('pays')?.value || 'France';
            const puissance = parseFloat(document.getElementById('puissance')?.value) || 0;
            return pays === 'France' && puissance <= 100;
        }

        function applyLock() {
            const palT1 = document.getElementById('pal_t_1');
            const indexVente = document.getElementById('indexation_vente_12');
            const locked = eligible();

            if (palT1) {
                if (locked) {
                    palT1.value = '11';
                    palT1.readOnly = true;
                    palT1.style.cssText = LOCKED_FIELD_STYLE;
                } else {
                    palT1.readOnly = false;
                    palT1.style.cssText = '';
                }
            }
            if (indexVente) {
                if (locked) {
                    indexVente.value = '2';
                    indexVente.readOnly = true;
                    indexVente.style.cssText = LOCKED_FIELD_STYLE;
                } else {
                    indexVente.readOnly = false;
                    indexVente.style.cssText = '';
                }
            }
        }

        const puissanceInput = document.getElementById('puissance');
        const paysSelect = document.getElementById('pays');
        if (puissanceInput) puissanceInput.addEventListener('input', applyLock);
        if (paysSelect) paysSelect.addEventListener('change', applyLock);
        document.addEventListener('batterieVirtuelleChangee', applyLock);

        // #pal_t_1 n'existe qu'après generatePaliers() (déjà exécuté à ce stade, cf. window.onload
        // de EtudesEconomiqueLogic.js, qui précède l'init résidentiel) — sinon on retente une fois
        // après un court délai (le temps que le premier rendu des paliers se termine).
        if (document.getElementById('pal_t_1')) {
            applyLock();
        } else {
            setTimeout(applyLock, 200);
        }
    }

    /**
     * Case "Prendre en compte la revente du surplus" (visible seulement si taux d'autoconsommation
     * < 100%, décochée par défaut) — placée à DROITE du champ #pal_t_1 (tarif de surplus), dans une
     * ligne flex commune, plutôt qu'en bas de carte (demande explicite).
     */
    function setupSurplusOptIn() {
        // La case est commune à tous les projets (générée avec #pal_t_1 par generatePaliers(),
        // EtudesEconomiqueLogic.js, qui gère aussi sa visibilité) : elle est seulement placée ici
        // sur la même ligne que le tarif.
        const palT1 = document.getElementById('pal_t_1');
        const container = document.getElementById('vente-surplus-optin-container');
        if (!palT1 || !container || palT1.parentNode.classList.contains('resi-surplus-row')) return;

        const row = document.createElement('div');
        row.className = 'resi-surplus-row';
        row.style.cssText = 'display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:6px;';
        palT1.parentNode.insertBefore(row, palT1);
        row.appendChild(palT1);
        container.style.marginTop = '0';
        row.appendChild(container);
    }

    /** true si le revenu de revente du surplus est pris en compte au calcul (cf. venteSurplusActive). */
    function isSurplusRevenueEnabled() {
        return typeof window.venteSurplusActive === 'function' ? window.venteSurplusActive() : true;
    }

    /**
     * Construit la carte "Revenus & tarifs" : reprend #section_facture_consommation (tarif d'achat
     * élec., indexation...) et #section_revenus_globale (paliers de vente), affichées côte à côte
     * (cf. CSS #resi-revenus-tarifs-wrapper, demande explicite) ; masque le bouton "Calcul de
     * revenu année 1" (non pertinent, tarif fixe résidentiel), verrouille le tarif de surplus et
     * ajoute la case d'opt-in revente surplus.
     */
    function buildRevenusTarifsSection() {
        const wrapper = document.createElement('div');
        wrapper.className = 'resi-reused-section';
        wrapper.id = 'resi-revenus-tarifs-wrapper';

        const revenusGlobale = document.getElementById('section_revenus_globale');
        const factureConso = document.getElementById('section_facture_consommation');

        // CORRECTIF (demande explicite : "afficher les labels de Facture consommation à la
        // verticale et en face de la carte contenant les labels de tarif de vente surplus") :
        // #section_facture_consommation (Facture de consommation HP + son bouton "Calculer",
        // Indexation facture élec.) est déplacée EN PREMIER — la mise en page CSS
        // (#resi-revenus-tarifs-wrapper, etudes_economique_content.html) place les deux sections
        // côte à côte, celle-ci empilée verticalement à gauche, #section_revenus_globale (Tarif
        // Vente Surplus, Période d'application, case "Prendre en compte la revente du surplus",
        // Indexation Vente Palier 1) à droite.
        let moved = false;
        if (factureConso) { wrapper.appendChild(factureConso); moved = true; }
        if (revenusGlobale) { wrapper.appendChild(revenusGlobale); moved = true; }
        if (!moved) return null;

        const calcRevenuBtn = document.getElementById('btn_calcul_revenu_annee1');
        if (calcRevenuBtn) calcRevenuBtn.style.display = 'none';

        setupSurplusTariffLock();
        // #pal_t_1 n'existe pas forcément encore si generatePaliers() n'a pas terminé (même
        // condition que setupSurplusTariffLock ci-dessus) — même repli.
        if (document.getElementById('pal_t_1')) {
            setupSurplusOptIn();
        } else {
            setTimeout(setupSurplusOptIn, 200);
        }

        return wrapper;
    }

    /**
     * Construit la section "Financement" : reprend #section_financement (carte Pro existante,
     * dette/fonds propres), forcée sur "Fonds propres" par défaut pour un projet résidentiel, dans
     * un accordéon masqué par défaut (demande explicite, point 6 — raccourcit le formulaire).
     * "Simuler les 2 options" reste dans le bloc déplacé mais masqué (un seul panneau de résultats
     * est affiché, cf. ResidentielEtudeEcoView.js::restrictResultsToFondsPropres, qui la décoche).
     */
    function buildFinancementSection() {
        const wrapper = document.createElement('div');
        wrapper.id = 'resi-financement-wrapper';

        const financement = document.getElementById('section_financement');
        if (!financement) return null;
        wrapper.appendChild(financement);

        // Décocher AVANT d'appeler toggleDetteFields() ci-dessous : cette fonction affiche
        // #dette_fields dès que #simuler_deux_options est coché (isDual), quel que soit l'argument
        // passé — décocher après aurait laissé le panneau Dette visible malgré le choix "non".
        const simulerDeuxCheckbox = document.getElementById('simuler_deux_options');
        if (simulerDeuxCheckbox) simulerDeuxCheckbox.checked = false;
        const simulerDeuxContainer = document.getElementById('simuler_deux_options_container');
        if (simulerDeuxContainer) simulerDeuxContainer.style.display = 'none';

        const detteOui = document.querySelector('input[name="dette_toggle"][value="oui"]');
        const detteNon = document.querySelector('input[name="dette_toggle"][value="non"]');
        if (detteOui && detteNon) {
            detteOui.checked = false;
            detteNon.checked = true;
            if (typeof window.toggleDetteFields === 'function') window.toggleDetteFields(false);
        }

        const { button, panel } = wrapInAccordion('Financement', wrapper);
        financementToggleBtn = button;
        return panel;
    }

    /**
     * Construit la section "Fiscalité" : reprend #section_fiscalite, en masquant le choix
     * "Dépréciation" (non pertinent pour un particulier), dans un accordéon masqué par défaut
     * (demande explicite, point 6).
     */
    function buildFiscaliteSection() {
        const wrapper = document.createElement('div');
        wrapper.id = 'resi-fiscalite-wrapper';

        const fiscalite = document.getElementById('section_fiscalite');
        if (!fiscalite) return null;

        wrapper.appendChild(fiscalite);

        const deprecToggle = document.getElementById('deprec_toggle_container');
        const deprecField = document.getElementById('deprec_field');
        if (deprecToggle) deprecToggle.style.display = 'none';
        if (deprecField) deprecField.style.display = 'none';

        const { button, panel } = wrapInAccordion('Fiscalité', wrapper);
        fiscaliteToggleBtn = button;
        return panel;
    }

    /**
     * Boutons d'accordéon "Financement"/"Fiscalité" construits par buildFinancementSection()/
     * buildFiscaliteSection() ci-dessus — récupérés SÉPARÉMENT (plutôt qu'un tableau filtré, plus
     * sûr : pas de décalage d'index possible si l'un des deux est absent) par
     * ResidentielEtudeEcoView.js pour les aligner horizontalement avec celui de "Provisions &
     * indexation" (ResidentielOpexTable.js) et placer leurs panneaux dans la même zone de contenu
     * commune (demande explicite, points 3A/3B/4). null tant que la section correspondante n'a pas
     * encore été construite.
     */
    function getFinancementToggleButton() {
        return financementToggleBtn;
    }
    function getFiscaliteToggleButton() {
        return fiscaliteToggleBtn;
    }

    window.ResidentielChiffrage.ReusedSections = {
        buildProductionSection,
        buildRevenusTarifsSection,
        buildFinancementSection,
        buildFiscaliteSection,
        getFinancementToggleButton,
        getFiscaliteToggleButton,
        isSurplusRevenueEnabled
    };
})();
