/**
 * Tableau des charges annuelles OPEX résidentielles (montants TTC, 4 postes fixes) + champs de
 * financement associés à l'OPEX repris tels quels du CAPEX/OPEX Pro-Grand projet (Indexation des
 * OPEX, coût onduleur/batterie an 10 — cf. point 5 des correctifs demandés).
 *
 * Écrit son total (÷1000, en k€/an) dans #total_opex_display — même point d'intégration moteur
 * que ResidentielCapexTable.js pour #total_capex_display.
 */
(function () {
    'use strict';

    window.ResidentielChiffrage = window.ResidentielChiffrage || {};
    const Rules = () => window.ResidentielChiffrage.Rules;

    // IDs des champs existants (standard Pro/Grand projet) à déplacer tels quels sous le tableau
    // OPEX résidentiel : mêmes éléments, même moteur (collectInputs() les lit déjà), simplement
    // rendus visibles/accessibles ici plutôt que dans #etudes-eco-standard-view (masqué).
    const REUSED_FIELD_IDS = ['index_opex', 'ond_10', 'bat_10'];

    const state = {
        container: null,
        chargesContainer: null,
        provisionsToggleBtn: null,
        provisionsPanel: null,
        charges: {}, // { assurances, communication, visiteTechnique, autres } (TTC €/an)
        // Bloc « Frais d'abonnement batterie virtuelle » du gabarit (#groupe_abonnement_bv), déplacé
        // dans la grille des charges à chaque rendu (renderCharges() réécrit son innerHTML).
        groupeAbonnementBv: null
    };

    /** Frais d'abonnement batterie virtuelle (TTC €/an), 0 si elle n'est pas retenue. */
    function abonnementBv() {
        return typeof window.fraisAbonnementBvEuros === 'function' ? window.fraisAbonnementBvEuros() : 0;
    }

    function total() {
        return Object.values(state.charges).reduce((sum, v) => sum + (Number(v) || 0), 0) + abonnementBv();
    }

    /**
     * @param {boolean} [sansEnregistrement] - true : affichages et moteur seulement, sans l'évènement
     *   qui déclenche l'enregistrement du chiffrage (les frais d'abonnement batterie virtuelle ne
     *   sont pas des charges du tableau : ils sont enregistrés avec les saisies de l'étude).
     */
    function pushTotalToEngine(sansEnregistrement) {
        const el = document.getElementById('total_opex_display');
        if (el) {
            el.textContent = (total() / 1000).toFixed(3);
        }
        // CORRECTIF (validation stricte OPEX passée de l'évènement 'change' à 'input', pour un
        // retour de validité en temps réel sans reconstruire tout le tableau à chaque frappe — cf.
        // renderCharges()) : "Total OPEX annuel", jusqu'ici seulement rafraîchi par le renderCharges()
        // complet qui suivait chaque 'change', doit être mis à jour ici directement pour ne pas
        // rester figé pendant la saisie.
        const totalTtcEl = document.getElementById('resi_total_opex_ttc');
        if (totalTtcEl) totalTtcEl.textContent = total().toFixed(2);
        if (typeof window.majMontantAbonnementBv === 'function') window.majMontantAbonnementBv(true);
        const ratioEl = document.getElementById('ratio_opex_display');
        const puissanceInput = document.getElementById('puissance');
        if (ratioEl && puissanceInput) {
            const puissanceWc = (parseFloat(puissanceInput.value) || 0) * 1000;
            ratioEl.textContent = puissanceWc > 0 ? (total() / puissanceWc).toFixed(4) : '0';
        }
        if (sansEnregistrement === true) return;
        document.dispatchEvent(new CustomEvent('residentielOpexChanged', { detail: { total: total() } }));
    }

    function renderCharges() {
        if (!state.chargesContainer) return;
        const rules = Rules();
        const devise = rules.getDeviseSymbol();
        const rows = Object.entries(rules.OPEX_RULES).map(([key, rule]) => {
            const value = state.charges[key];
            // NOUVEAU (demande explicite : "validation stricte des données d'entrée... message
            // d'erreur clair... affichable sous les champs respectifs") : <div> d'erreur dédié,
            // masqué par défaut, rempli/affiché par applyOpexFieldValidation() ci-dessous — même
            // convention que ResidentielCapexTable.js (pas de min/max HTML natifs : les bornes
            // réelles ne sont plus génériques, cf. OPEX_RULES par champ).
            return `<div class="form-group resi-opex-field">
                <label for="resi_opex_${key}">${rule.label} (TTC, <span class="symb-devise">${devise}</span>/an)</label>
                <input type="number" id="resi_opex_${key}" data-key="${key}" class="resi-opex-in"
                    value="${value}" step="any">
                <div class="resi-field-error" style="display:none;"></div>
            </div>`;
        }).join('');

        state.chargesContainer.innerHTML = `
            <h2>Charges annuelles (OPEX)</h2>
            <div class="grid resi-opex-grid">${rows}</div>
            <p class="resi-opex-total"><strong>Total OPEX annuel : <span id="resi_total_opex_ttc">${total().toFixed(2)}</span> ${devise} TTC/an</strong></p>`;
        placerAbonnementBv(devise);

        // CORRECTIF (demande explicite : "rejet strict... ne jamais modifier, tronquer ou corriger
        // silencieusement les données de l'utilisateur") : remplace rules.clampWithAlert() (qui
        // réécrivait silencieusement la valeur hors plage, ou la mettait à 0 sans alerte pour une
        // saisie non-numérique) — la saisie brute est conservée (sauf non-numérique : rien de
        // valide à enregistrer, la charge garde sa dernière valeur connue), un message précis est
        // affiché sous le champ, et la sauvegarde autodéclenchée est bloquée tant que l'erreur
        // n'est pas corrigée (cf. ResidentielChiffrageDB.js, garde .is-invalid déjà en place).
        state.chargesContainer.querySelectorAll('.resi-opex-in').forEach((input) => {
            const key = input.dataset.key;
            applyOpexFieldValidation(input, key, state.charges[key]);
            input.addEventListener('input', () => {
                const parsed = parseFloat(input.value);
                if (!isNaN(parsed)) state.charges[key] = parsed;
                applyOpexFieldValidation(input, key, input.value);
                pushTotalToEngine();
            });
        });
    }

    /**
     * Frais d'abonnement batterie virtuelle : même élément que le formulaire PRO (#abonnement_bv_kwc,
     * enregistré avec les saisies de l'étude économique), placé en fin de grille des charges, libellé
     * TTC. Son affichage suit la case batterie virtuelle (majBatterieVirtuelle).
     */
    function placerAbonnementBv(devise) {
        const groupe = state.groupeAbonnementBv || document.getElementById('groupe_abonnement_bv');
        const grille = state.chargesContainer.querySelector('.resi-opex-grid');
        if (!groupe || !grille) return;
        state.groupeAbonnementBv = groupe;
        groupe.classList.add('resi-opex-field');
        const label = groupe.querySelector('#label_abonnement_bv');
        if (label) label.innerHTML = `Frais d’abonnement batterie virtuelle (TTC, <span class="symb-devise">${devise}</span>/kWc/an)`;
        grille.appendChild(groupe);
    }

    /** Valide un champ OPEX et bascule .is-invalid + le message .resi-field-error associé. */
    function applyOpexFieldValidation(input, key, rawValue) {
        const rules = Rules();
        const result = rules.validateOpexField(key, rawValue);
        const errorDiv = input.parentElement ? input.parentElement.querySelector('.resi-field-error') : null;
        input.classList.toggle('is-invalid', !result.valid);
        if (errorDiv) {
            errorDiv.textContent = result.valid ? '' : result.message;
            errorDiv.style.display = result.valid ? 'none' : 'block';
        }
        return result;
    }

    /**
     * Construit le bouton d'accordéon "Provisions & indexation" + son panneau de contenu
     * (champs existants #index_opex/#ond_10/#bat_10, déplacés depuis #etudes-eco-standard-view —
     * mêmes ids, même moteur) SÉPARÉMENT l'un de l'autre — ni l'un ni l'autre n'est inséré ici.
     * ResidentielEtudeEcoView.js place le bouton dans la barre commune "Provisions & indexation /
     * Financement / Fiscalité" et le panneau dans la zone de contenu juste en dessous (demande
     * explicite : le contenu doit apparaître dans le flux normal, pas coincé dans la section OPEX
     * qui précède la barre de boutons). Ne modifie jamais state.chargesContainer.
     */
    function buildProvisionsAccordion() {
        const grid = document.createElement('div');
        grid.className = 'grid resi-opex-extra-grid';

        REUSED_FIELD_IDS.forEach((id) => {
            const input = document.getElementById(id);
            const formGroup = input && input.closest('.form-group');
            if (formGroup) grid.appendChild(formGroup);
        });

        if (!grid.children.length) return;

        const panel = document.createElement('div');
        panel.className = 'resi-reused-section';
        grid.style.display = 'none';
        panel.appendChild(grid);

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn btn-secondary resi-accordion-toggle';
        toggleBtn.textContent = '▸ Provisions & indexation';
        toggleBtn.addEventListener('click', () => {
            const isHidden = grid.style.display === 'none';
            grid.style.display = isHidden ? 'grid' : 'none';
            toggleBtn.textContent = (isHidden ? '▾' : '▸') + ' Provisions & indexation';
        });

        state.provisionsToggleBtn = toggleBtn;
        state.provisionsPanel = panel;
    }

    function init(container, initialData) {
        state.container = container;
        container.innerHTML = '<div class="resi-opex-charges"></div>';
        state.chargesContainer = container.querySelector('.resi-opex-charges');

        const rules = Rules();
        if (initialData && typeof initialData === 'object' && Object.keys(initialData).length) {
            state.charges = { ...defaultCharges(rules), ...initialData };
        } else {
            state.charges = defaultCharges(rules);
        }
        renderCharges();
        buildProvisionsAccordion();
        pushTotalToEngine();

        // Frais d'abonnement batterie virtuelle : total OPEX recalculé quand la case, le prix
        // unitaire ou la puissance changent. Écouteurs uniques (init() appelé une fois par page).
        if (!state.abonnementBvEcoute) {
            state.abonnementBvEcoute = true;
            const rafraichir = () => pushTotalToEngine(true);
            document.addEventListener('batterieVirtuelleChangee', rafraichir);
            ['abonnement_bv_kwc', 'puissance'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('input', rafraichir);
            });
        }
    }

    function defaultCharges(rules) {
        const charges = {};
        Object.entries(rules.OPEX_RULES).forEach(([key, rule]) => { charges[key] = rule.defaultValue; });
        return charges;
    }

    function getData() {
        return { ...state.charges };
    }

    function setData(data) {
        const rules = Rules();
        state.charges = (data && typeof data === 'object' && Object.keys(data).length) ? { ...defaultCharges(rules), ...data } : defaultCharges(rules);
        renderCharges();
        pushTotalToEngine();
    }

    /**
     * Bouton + panneau d'accordéon "Provisions & indexation" — récupérés par
     * ResidentielEtudeEcoView.js pour aligner le bouton horizontalement avec "Financement"/
     * "Fiscalité" et placer le panneau dans la zone de contenu commune juste en dessous (demande
     * explicite, points 3A/3B).
     */
    function getProvisionsToggleButton() {
        return state.provisionsToggleBtn;
    }
    function getProvisionsPanel() {
        return state.provisionsPanel;
    }

    window.ResidentielChiffrage.Opex = {
        init,
        getData,
        setData,
        getTotal: total,
        getProvisionsToggleButton,
        getProvisionsPanel,
        // CORRECTIF (changement de devise) : exposé pour que updateDeviseLabels()
        // (EtudesEconomiqueLogic.js) puisse forcer un re-rendu immédiat des charges quand la
        // devise change, sans attendre la prochaine édition d'un champ.
        render: renderCharges
    };
})();
