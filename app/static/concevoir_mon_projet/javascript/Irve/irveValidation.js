/**
 * Validation stricte front-end du modal IRVE-Autoconsommation.
 * Deux rôles : filtrer la saisie de caractères invalides sur les champs numériques,
 * et détecter toute violation de bornes pour griser les boutons de calcul tant qu'elle persiste.
 */
(function () {
    'use strict';

    // Table déclarative des champs à id fixe : [id, min, max, label]
    const IRVE_FIELD_RULES = [
        ['bu_foisonnement', 50.0001, 100, 'Coefficient de foisonnement global (%)'],
        ['coeff_saison_hiver', 0, 2, 'Coefficient saisonnier Hiver'],
        ['coeff_saison_printemps', 0, 2, 'Coefficient saisonnier Printemps'],
        ['coeff_saison_ete', 0, 2, 'Coefficient saisonnier Été'],
        ['coeff_saison_automne', 0, 2, 'Coefficient saisonnier Automne'],
        ['coeff_semaine', 1, 2, 'Coefficient Semaine'],
        ['coeff_weekend', 1, 2, 'Coefficient Weekend'],
        ['td_volume_annuel', 0.0001, 3650000, 'Volume total annuel (kWh)'],
        ['auto_cible_autonomie', 1, 100, "Cible d'autonomie (%)"],
        ['auto_nb_jours', 1, 5, "Nombre de jours d'autonomie"],
        ['auto_inclinaison', 0, 90, 'Inclinaison (°)'],
        ['auto_azimut', -90, 180, 'Azimut (°)'],
        ['auto_pertes', 8, 20, 'Pertes système (%)'],
        ['auto_coeff_evolution', 1, 2, "Coefficient d'évolution des besoins"],
        ['auto_rendement_batterie', 0.4, 1, 'Rendement batterie Li-ion'],
        ['auto_dod', 0.5, 1, 'DoD (profondeur de décharge)'],
        ['limitation_puissance', 0, 5000, 'Limitation de puissance des bornes (kVA)'],
        ['ks', 0, 1, 'Coefficient Ks'],
        ['kmono', 0, 1, 'Coefficient Kmono'],
        ['ktri', 0, 1, 'Coefficient Ktri'],
        ['kdc', 0, 1, 'Coefficient Kdc'],
        ['cosphi_ac', 0, 1, 'Cos phi AC'],
        ['cosphi_dc', 0, 1, 'Cos phi DC'],
        ['puissance_aux', 0, 10, 'Puissance auxiliaire (kW)'],
        ['nb_jours_non_ouvres', 0, 200, 'Jours non ouvrés total'],
    ];

    // Format attendu : "01/01, 01/05, 15/12-30/12" (jours seuls ou plages JJ/MM-JJ/MM, séparés par des virgules)
    const JOURS_FERIES_PATTERN = /^\s*(\d{2}\/\d{2}(-\d{2}\/\d{2})?)(\s*,\s*\d{2}\/\d{2}(-\d{2}\/\d{2})?)*\s*$/;

    function isVisible(el) {
        return !!(el && el.offsetParent !== null);
    }

    function fieldViolation(el, min, max, label) {
        if (!el || !isVisible(el)) return null;
        if (el.value === '' || el.value === null) return null;
        const value = parseFloat(el.value);
        if (isNaN(value)) return { el: el, message: `${label} : valeur numérique invalide.` };
        if (value < min || value > max) {
            return { el: el, message: `${label} doit être compris entre ${min} et ${max} (valeur actuelle : ${el.value}).` };
        }
        return null;
    }

    function validateNumberField(id, min, max, label) {
        return fieldViolation(document.getElementById(id), min, max, label);
    }

    function attachNumericInputFilter(id) {
        const el = document.getElementById(id);
        if (!el || el.dataset.irveFilterAttached) return;
        el.dataset.irveFilterAttached = '1';
        el.addEventListener('input', function () {
            this.value = this.value.replace(/[^0-9.\-]/g, '');
            updateIrveSubmitButtonsState();
        });
    }

    function checkGenericNumericInputs(selector, min, max, label) {
        let violation = null;
        document.querySelectorAll(selector).forEach((el) => {
            if (violation) return;
            violation = fieldViolation(el, min, max, label);
        });
        return violation;
    }

    function checkFabricantLength() {
        let violation = null;
        document.querySelectorAll('input[id^="fab-input-"]').forEach((el) => {
            if (violation || !isVisible(el)) return;
            if (el.value.length > 30) {
                violation = { el: el, message: `Nom fabricant : 30 caractères maximum (actuellement ${el.value.length}).` };
            }
        });
        return violation;
    }

    function checkPuissanceSouscrite() {
        const el = document.getElementById('puissance_souscrite');
        if (!el || el.value === '') return null;
        const modeInput = document.querySelector('input[name="mode_raccordement"]:checked');
        const mode = modeInput ? modeInput.value : 'BT';
        const value = parseFloat(el.value);
        if (isNaN(value)) return { el: el, message: 'Puissance souscrite : valeur numérique invalide.' };
        if (mode === 'HTA') {
            if (value <= 250 || value > 5000) {
                return { el: el, message: `Puissance souscrite HTA (kVA) doit être strictement supérieure à 250 et inférieure ou égale à 5000 (valeur actuelle : ${el.value}).` };
            }
        } else if (value <= 0 || value > 250) {
            // 0 kVA n'a pas de sens physique (autrefois converti en « puissance illimitée » par la
            // simulation) : refusé. Un champ vide reste « non renseignée » (aucun plafond).
            return { el: el, message: `Puissance souscrite BT (kVA) doit être strictement supérieure à 0 et inférieure ou égale à 250 (valeur actuelle : ${el.value}).` };
        }
        return null;
    }

    function checkJoursFeries() {
        const el = document.getElementById('jours_feries');
        if (!el || el.value.trim() === '') return null;
        if (!JOURS_FERIES_PATTERN.test(el.value)) {
            return { el: el, message: 'Jours/Plages fériés : format invalide. Exemple attendu : "01/01, 01/05, 15/12-30/12".' };
        }
        return null;
    }

    function checkSmartChargingFields() {
        let violation = null;
        document.querySelectorAll('.irve-sc-numeric').forEach((el) => {
            if (violation || !isVisible(el)) return;
            violation = fieldViolation(el, parseFloat(el.dataset.min), parseFloat(el.dataset.max), el.dataset.label || 'Champ SmartCharging');
        });
        return violation;
    }

    /**
     * Agrège les règles statiques (IRVE_FIELD_RULES) et tous les cas dynamiques (équipements,
     * bornes, tableau saisonnier, copie saisonnière, puissance souscrite conditionnelle,
     * SmartCharging). Retourne la PREMIÈRE violation trouvée, ou null si le formulaire est valide.
     */
    function getIrveFieldViolations() {
        for (const rule of IRVE_FIELD_RULES) {
            const v = validateNumberField(rule[0], rule[1], rule[2], rule[3]);
            if (v) return v;
        }

        return (
            checkGenericNumericInputs('#equipment-table-body .eq-puissance', 0, 50000, 'Puissance unitaire (W)') ||
            checkGenericNumericInputs('#equipment-table-body .eq-quantite', 1, 20, 'Quantité (équipement)') ||
            checkGenericNumericInputs('#equipment-table-body .eq-cosphi', 0.85, 1, 'Cos phi (équipement)') ||
            checkGenericNumericInputs('#equipment-table-body .eq-debut', 0, 24, 'Heure de début (équipement)') ||
            checkGenericNumericInputs('#equipment-table-body .eq-fin', 0, 24, 'Heure de fin (équipement)') ||
            checkGenericNumericInputs('input[id^="pdc-"]', 1, 4, 'Nombre de Pdc par borne') ||
            checkGenericNumericInputs('input[id^="qty-"]', 1, 50, 'Quantité (borne)') ||
            checkFabricantLength() ||
            checkGenericNumericInputs('#seasonal-table-body input[data-season][data-hour]', 0, 50, 'Puissance saisonnière (kW)') ||
            checkGenericNumericInputs('.copy-target-multiplier', 1, 2, 'Coefficient de copie saisonnière') ||
            checkPuissanceSouscrite() ||
            checkJoursFeries() ||
            checkSmartChargingFields() ||
            null
        );
    }

    function updateIrveSubmitButtonsState() {
        const violation = getIrveFieldViolations();
        const banner = document.getElementById('irve-validation-banner');
        const buttons = document.querySelectorAll(
            '[onclick*="calculateBilanPuissance"], [onclick*="calculateEnergie"]'
        );

        if (violation) {
            if (banner) {
                banner.textContent = `⚠️ ${violation.message}`;
                banner.style.display = 'block';
            }
            buttons.forEach((btn) => { btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed'; });
        } else {
            if (banner) banner.style.display = 'none';
            buttons.forEach((btn) => { btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = ''; });
        }
    }

    window.getIrveFieldViolations = getIrveFieldViolations;
    window.updateIrveSubmitButtonsState = updateIrveSubmitButtonsState;

    document.addEventListener('DOMContentLoaded', function () {
        IRVE_FIELD_RULES.forEach((rule) => attachNumericInputFilter(rule[0]));
        updateIrveSubmitButtonsState();
    });
})();
