let charts = {};
let chartInstances = {};

// --- INITIALISATION AU CHARGEMENT ---
// C'est ce bloc qui corrige votre bug d'affichage au démarrage
window.onload = () => {
    loadEconomicData();
    rafraichirInterfaceEco();

    // Initialiser l'affichage du premier onglet
    const firstTab = document.querySelector('.tab-content');
    if (firstTab) {
        firstTab.classList.add('active');
    }

    // Ecouter les modifications pour la sauvegarde automatique
    const container = document.getElementById('etudes-economique-content');
    if (container) {
        container.addEventListener('input', debounceSaveEconomicData);
        container.addEventListener('change', saveEconomicData);
        // Toute saisie qui change une donnée du calcul rend les résultats affichés caducs.
        container.addEventListener('input', surSaisieEcoModifiee);
        container.addEventListener('change', surSaisieEcoModifiee);
    }
};

/**
 * Remet l'interface (paliers, sections affichées selon les boutons radio, totaux) en accord avec
 * les valeurs présentes dans les champs : au chargement, et après la restauration des saisies d'un
 * projet (cf. EtudesEconomiqueDB.js).
 */
function rafraichirInterfaceEco() {
    generatePaliers();
    updateCapexDisplays();
    updateFinanceCalculations();
    updateDeviseLabels(false);
    handleTypeProjetChange();

    // Mise à jour de l'interface en fonction des valeurs chargées
    const typeSys = document.querySelector('input[name="type_systeme"]:checked')?.value || 'reseau';
    if (typeof toggleSystemeFields === 'function') toggleSystemeFields();
    
    const specFrance = document.querySelector('input[name="spec_france"]:checked')?.value === 'oui';
    if (typeof toggleFranceSpec === 'function') toggleFranceSpec(specFrance);

    const capexMode = document.querySelector('input[name="capex_mode_select"]:checked')?.value || 'simple';
    if (typeof toggleCapexModeSelect === 'function') toggleCapexModeSelect(capexMode);

    const opexMode = document.querySelector('input[name="opex_mode_select"]:checked')?.value || 'simple';
    if (typeof toggleOpexModeSelect === 'function') toggleOpexModeSelect(opexMode);

    const detteMode = document.querySelector('input[name="dette_toggle"]:checked')?.value === 'oui';
    if (typeof toggleDetteFields === 'function') toggleDetteFields(detteMode);

    if (typeof toggleDeuxOptions === 'function') toggleDeuxOptions();
    majChampsStockageEco();
    checkHorizon();
}
window.rafraichirInterfaceEco = rafraichirInterfaceEco;

// Champs dont la saisie ne change pas le calcul : la modale « Calcul du tarif pondéré » (seul
// « Appliquer » compte, il modifie la facture de consommation) et la modale de sensibilité, qui
// a ses propres résultats.
const ZONES_SANS_EFFET_SUR_RESULTATS = '#Resultats, #tarifPondereModal, #sensiModal';

function surSaisieEcoModifiee(evt) {
    const champ = evt.target;
    if (!champ || !champ.matches || !champ.matches('input, select, textarea')) return;
    if (champ.closest(ZONES_SANS_EFFET_SUR_RESULTATS)) return;
    remettreResultatsEcoAZero();
}

/**
 * Résultats affichés remis à 0 : indicateurs, tableau annuel, graphiques. Les indicateurs gardés
 * pour le rapport (solarProjectData.economicData.indicators) sont retirés : le rapport redemande
 * alors un calcul, comme si aucun n'avait été lancé.
 */
function remettreResultatsEcoAZero() {
    const resultats = document.getElementById('Resultats');
    if (!resultats || resultats.dataset.resultatsCalcules !== 'oui') return;
    resultats.dataset.resultatsCalcules = '';

    resultats.querySelectorAll('td[id^="res_"]').forEach(td => { td.textContent = '0'; });
    ['results-tbody', 'results-tfoot'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    Object.keys(chartInstances).forEach(id => {
        if (chartInstances[id]) chartInstances[id].destroy();
        delete chartInstances[id];
    });

    try {
        const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        if (savedData.economicData && savedData.economicData.indicators) {
            delete savedData.economicData.indicators;
            localStorage.setItem('solarProjectData', JSON.stringify(savedData));
        }
    } catch (e) {
        console.warn('Impossible de retirer les indicateurs économiques périmés :', e);
    }
}
window.remettreResultatsEcoAZero = remettreResultatsEcoAZero;

/** true tant que les résultats affichés correspondent aux saisies (aucune modification depuis). */
window.resultatsEcoCalcules = function () {
    return document.getElementById('Resultats')?.dataset.resultatsCalcules === 'oui';
};

let ecoSaveTimeout;
function debounceSaveEconomicData() {
    clearTimeout(ecoSaveTimeout);
    ecoSaveTimeout = setTimeout(saveEconomicData, 500);
}

function saveEconomicData() {
    const data = collecterSaisiesEco();
    if (!data) return;
    // Cache commun à tous les projets du navigateur : marqué du projet auquel il appartient.
    data.projetId = projetDesSaisiesEco();
    const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
    savedData.economicStudyInputs = data;
    localStorage.setItem('solarProjectData', JSON.stringify(savedData));
}

/** Projet des saisies affichées : celui chargé par EtudesEconomiqueDB.js, sinon le projet actif. */
function projetDesSaisiesEco() {
    const charge = window.EtudesEconomiqueDB && window.EtudesEconomiqueDB.projetCharge();
    return charge || localStorage.getItem('current_projet_id') || null;
}

/** Sauvegarde locale immédiate (annule celle en attente) — avant un changement de projet. */
function saveEconomicDataNow() {
    clearTimeout(ecoSaveTimeout);
    saveEconomicData();
}

/** Saisies du formulaire (structure enregistrée en base, cf. EtudesEconomiqueDB.js), ou null. */
function collecterSaisiesEco() {
    const container = document.getElementById('etudes-economique-content');
    if (!container) return null;

    const data = {
        inputs: {},
        radios: {},
        manualFields: [],
        dynamicRows: {
            capex: [],
            opex: []
        }
    };

    const elements = container.querySelectorAll('input[id], select[id], textarea[id]');
    elements.forEach(el => {
        if (el.type === 'checkbox') {
            data.inputs[el.id] = el.checked;
        } else if (el.type !== 'radio') {
            data.inputs[el.id] = el.value;
            if (el.dataset.manual) {
                data.manualFields.push(el.id);
            }
        }
    });

    const radios = container.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => {
        if (radio.checked) {
            data.radios[radio.name] = radio.value;
        }
    });

    const capexContainer = document.getElementById('capex_autres_container');
    if (capexContainer) {
        capexContainer.querySelectorAll('.dynamic-row').forEach(row => {
            const textInput = row.querySelector('input[type="text"]');
            const numInput = row.querySelector('input[type="number"]');
            if (textInput && numInput) {
                data.dynamicRows.capex.push({ name: textInput.value, value: numInput.value });
            }
        });
    }

    const opexContainer = document.getElementById('opex_autres_container');
    if (opexContainer) {
        opexContainer.querySelectorAll('.dynamic-row').forEach(row => {
            const textInput = row.querySelector('input[type="text"]');
            const numInput = row.querySelector('input[type="number"]');
            if (textInput && numInput) {
                data.dynamicRows.opex.push({ name: textInput.value, value: numInput.value });
            }
        });
    }

    if (typeof getConversionDeviseState === 'function') {
        data.conversionDevise = getConversionDeviseState();
    }

    return data;
}
window.collecterSaisiesEco = collecterSaisiesEco;

/**
 * Champ créé APRÈS la restauration des saisies (contrôles du devis...) : reprend la valeur
 * enregistrée pour son id, s'il y en a une.
 */
function restaurerChampEco(el) {
    if (!el || !el.id) return;
    try {
        const saisies = JSON.parse(localStorage.getItem('solarProjectData') || '{}').economicStudyInputs;
        const valeur = saisies && saisies.inputs ? saisies.inputs[el.id] : undefined;
        if (valeur === undefined) return;
        if (el.type === 'checkbox') el.checked = !!valeur;
        else el.value = valeur;
    } catch (e) { /* cache illisible : valeur par défaut gardée */ }
}
window.restaurerChampEco = restaurerChampEco;
window.saveEconomicDataNow = saveEconomicDataNow;

function loadEconomicData() {
    const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
    const data = savedData.economicStudyInputs;
    if (!data) return;
    // Saisies d'un autre projet (cache commun du navigateur) : jamais affichées ici.
    if (data.projetId && String(data.projetId) !== String(projetDesSaisiesEco())) return;

    const container = document.getElementById('etudes-economique-content');
    if (!container) return;

    if (data.inputs) {
        // Case de revente du surplus : 'resi_surplus_optin' avant d'être commune à tous les projets.
        if (data.inputs.resi_surplus_optin !== undefined && data.inputs.vente_surplus_optin === undefined) {
            data.inputs.vente_surplus_optin = data.inputs.resi_surplus_optin;
        }
        for (const [id, value] of Object.entries(data.inputs)) {
            const el = document.getElementById(id);
            if (el) {
                if (el.type === 'checkbox') {
                    el.checked = value;
                } else if (el.type !== 'radio') {
                    el.value = value;
                }
            }
        }
    }

    if (data.manualFields) {
        data.manualFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.dataset.manual = 'true';
        });
    }

    if (data.radios) {
        for (const [name, value] of Object.entries(data.radios)) {
            const radio = container.querySelector(`input[type="radio"][name="${name}"][value="${value}"]`);
            if (radio) {
                radio.checked = true;
            }
        }
    }

    const capexContainer = document.getElementById('capex_autres_container');
    if (capexContainer && data.dynamicRows && data.dynamicRows.capex) {
        capexContainer.innerHTML = '';
        data.dynamicRows.capex.forEach(item => {
            if (typeof window.addDynamicRow === 'function') {
                window.addDynamicRow('capex_autres_container', 'capex-in', window.updateCapexDisplays);
                const rows = capexContainer.querySelectorAll('.dynamic-row');
                const lastRow = rows[rows.length - 1];
                if (lastRow) {
                    lastRow.querySelector('input[type="text"]').value = item.name;
                    lastRow.querySelector('input[type="number"]').value = item.value;
                }
            }
        });
    }

    const opexContainer = document.getElementById('opex_autres_container');
    if (opexContainer && data.dynamicRows && data.dynamicRows.opex) {
        opexContainer.innerHTML = '';
        data.dynamicRows.opex.forEach(item => {
            if (typeof window.addDynamicRow === 'function') {
                window.addDynamicRow('opex_autres_container', 'opex-in', window.updateCapexDisplays);
                const rows = opexContainer.querySelectorAll('.dynamic-row');
                const lastRow = rows[rows.length - 1];
                if (lastRow) {
                    lastRow.querySelector('input[type="text"]').value = item.name;
                    lastRow.querySelector('input[type="number"]').value = item.value;
                }
            }
        });
    }

    if (data.conversionDevise && typeof restaurerConversionDevise === 'function') {
        restaurerConversionDevise(data.conversionDevise);
    }
}

function openTab(evt, tabName) {
    // Vue PRO / Grand projet verticale (pro/ProEtudeEcoView.js) : toutes les sections sont
    // affichées, « ouvrir un onglet » revient à y faire défiler le modal.
    const standardView = document.getElementById('etudes-eco-standard-view');
    if (standardView && standardView.classList.contains('eco-vertical')) {
        const cible = document.getElementById(tabName);
        if (cible) cible.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    console.log('🔍 [DEBUG] openTab appelé avec tabName:', tabName);
    console.log('🔍 [DEBUG] evt:', evt);

    // Retirer la classe active de tous les contenus d'onglets dans le contexte du modal études économiques
    const modalContainer = document.querySelector('#etudes-economique-modal, #etudes-economique-content');
    console.log('🔍 [DEBUG] modalContainer trouvé:', modalContainer !== null);

    if (modalContainer) {
        const tabContents = modalContainer.querySelectorAll('.tab-content');
        const tabLinks = modalContainer.querySelectorAll('.tab-link');
        console.log('🔍 [DEBUG] Nombre de tab-content trouvés:', tabContents.length);
        console.log('🔍 [DEBUG] Nombre de tab-link trouvés:', tabLinks.length);

        tabContents.forEach(t => t.classList.remove('active'));
        tabLinks.forEach(l => l.classList.remove('active'));
    } else {
        // Fallback si le conteneur n'est pas trouvé
        console.log('⚠️ [DEBUG] modalContainer non trouvé, utilisation de document');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-link').forEach(l => l.classList.remove('active'));
    }

    // Ajouter la classe active au contenu de l'onglet sélectionné
    const tabContent = document.getElementById(tabName);
    console.log('🔍 [DEBUG] tabContent pour', tabName, ':', tabContent !== null);

    if (tabContent) {
        tabContent.classList.add('active');
        console.log('✅ [DEBUG] Classe active ajoutée au tabContent');

        // Scroll vers le haut du contenu de l'onglet
        if (modalContainer) {
            modalContainer.scrollTop = 0;
        }
    } else {
        console.error('❌ [DEBUG] Impossible de trouver le tabContent avec ID:', tabName);
    }

    // Ajouter la classe active au lien de l'onglet correspondant
    if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add('active');
        console.log('✅ [DEBUG] Classe active ajoutée au bouton via evt.currentTarget');
    } else {
        console.log('⚠️ [DEBUG] Pas d\'événement, recherche manuelle du bouton');
        // Si pas d'événement, trouver le bouton manuellement
        const buttons = modalContainer ? modalContainer.querySelectorAll('.tab-link') : document.querySelectorAll('.tab-link');
        if (tabName === 'Production' && buttons[0]) {
            buttons[0].classList.add('active');
            console.log('✅ [DEBUG] Bouton Production activé');
        } else if (tabName === 'ChiffrageFinancementTab' && buttons[1]) {
            buttons[1].classList.add('active');
            console.log('✅ [DEBUG] Bouton ChiffrageFinancementTab activé');
        } else if (tabName === 'Resultats' && buttons[2]) {
            // CORRECTIF (bug rapporté : « Gain annuel moyen » à 0) : buttons[3] (onglet inexistant,
            // il n'y en a que 3) levait une exception à la fin de chaque calcul — runSimulation()
            // échouait après l'affichage des résultats, et la mise à jour du gain annuel moyen
            // (ResidentielEtudeEcoView.js, après runSimulation) n'était jamais exécutée.
            buttons[2].classList.add('active');
            console.log('✅ [DEBUG] Bouton Resultats activé');
        }
    }

    console.log('🔍 [DEBUG] openTab terminé');
}

// Exposer openTab globalement immédiatement
window.openTab = openTab;

// Les fonctions utilitaires de l'interface
function handlePaysChange() {
    const val = document.getElementById('pays').value;
    document.getElementById('pays_autre_container').style.display = (val === 'Autre') ? 'block' : 'none';
    checkPowerLimit();
}

function checkHorizon() {
    const horizon = parseInt(document.getElementById('horizon').value) || 0;
    const ond20 = document.getElementById('ond_20_container');
    const indPal3 = document.getElementById('ind_pal3_container');
    const pal3Box = document.getElementById('pal3_box');

    if (ond20) ond20.style.display = (horizon > 20) ? 'block' : 'none';
    // Palier post-contrat sans objet avec la batterie virtuelle (un seul tarif sur tout l'horizon).
    const pal3Visible = horizon > 20 && !batterieVirtuelleActive();
    if (indPal3) indPal3.style.display = pal3Visible ? 'block' : 'none';
    if (pal3Box) pal3Box.style.display = pal3Visible ? 'block' : 'none';
}

function handleTypeProjetChange() {
    const val = document.getElementById('type_projet').value;
    document.querySelectorAll('.id-fondations').forEach(el => el.style.display = (val === 'Ombrière' || val === 'Ombrières') ? 'block' : 'none');
}

function toggleSystemeFields() {
    const isHybride = document.querySelector('input[name="type_systeme"]:checked').value === 'hybride';

    // 1. Gérer la visibilité des blocs principaux
    // '' (et non 'block') : la mise en page CSS de la section (grille Revenus & tarifs, vues PRO
    // verticale et résidentielle) n'est pas écrasée par un display en ligne.
    document.getElementById('section_revenus_globale').style.display = isHybride ? 'none' : '';
    document.getElementById('section_hybride_capex').style.display = isHybride ? 'block' : 'none';

    // 2. Masquage des 3 champs spécifiques (Hybride = Masqués)
    const displayMode = isHybride ? 'none' : 'block';
    document.getElementById('container_taux_auto').style.display = displayMode;
    document.getElementById('container_spec_tarifaire').style.display = displayMode;
    document.getElementById('prod_limite_container').style.display = displayMode;

    // 2. Gérer les champs individuels par classe
    document.querySelectorAll('.field-hybride-only').forEach(el => el.style.display = isHybride ? 'block' : 'none');
    document.querySelectorAll('.field-reseau-only').forEach(el => el.style.display = isHybride ? 'none' : 'block');
    if (typeof majChampsStockageEco === 'function') majChampsStockageEco();

    updateFinanceCalculations();
}

/**
 * @param {boolean} appliquerPrixCarburant  true au choix d'une devise par l'utilisateur : prix du
 *   carburant par défaut de cette devise. false à la restauration d'un projet : le prix saisi est gardé.
 */
// ─────────────────────────────────────────────────────────────────────────────
// CONVERTISSEUR DE DEVISES DYNAMIQUE (0 < taux < 1000)
// ─────────────────────────────────────────────────────────────────────────────
const CONVERSION_DEVISE_OPTIONS = {
    EUR_FCFA: { from: '€', to: 'FCFA', defaultRate: 655.96, label: '€ vers FCFA' },
    USD_FCFA: { from: '$', to: 'FCFA', defaultRate: 600, label: '$ vers FCFA' },
    USD_HTG:  { from: '$', to: 'HTG',  defaultRate: 132, label: '$ vers HTG' },
    EUR_HTG:  { from: '€', to: 'HTG',  defaultRate: 145, label: '€ vers HTG' },
    CUSTOM:   { from: '€', to: 'FCFA', defaultRate: 1,   label: 'Option personnalisée' }
};

const TAUX_CONVERSION_MIN_EXCLUSIF = 0;
const TAUX_CONVERSION_MAX_EXCLUSIF = 1000;

const CHAMPS_MONETAIRES_DYNAMIQUES = [
    'pal_t_1', 'pal_t_2', 'pal_t_3',
    'prix_achat_elec', 'tarif_hiver_input', 'tarif_ete_input',
    'facture_hiver_bv', 'abonnement_bv_kwc', 'prix_recharge_reseau',
    'capex_simple_val', 'opex_wc',
    'capex_etudes', 'capex_admin', 'capex_panneaux', 'capex_elec',
    'capex_integration', 'capex_fondations', 'capex_vrd', 'capex_racco',
    'capex_amo', 'capex_subvention', 'capex_batterie',
    'opex_connexion', 'opex_prev', 'opex_cura', 'opex_loyer',
    'ond_10', 'bat_10', 'ond_20'
];

function validateTauxConversion(rawVal) {
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
        return { valid: false, value: null, error: 'Le taux de conversion est obligatoire (0 < taux < 1000).' };
    }
    const num = Number(String(rawVal).replace(',', '.'));
    if (!Number.isFinite(num)) {
        return { valid: false, value: null, error: 'Veuillez saisir un taux de conversion numérique valide.' };
    }
    if (num <= TAUX_CONVERSION_MIN_EXCLUSIF || num >= TAUX_CONVERSION_MAX_EXCLUSIF) {
        return {
            valid: false,
            value: num,
            error: `Le taux de conversion doit être strictement supérieur à 0 et inférieur à 1000 (0 < taux < 1000). Valeur saisie : ${num}.`
        };
    }
    return { valid: true, value: num, error: null };
}
window.validateTauxConversion = validateTauxConversion;

function getConversionDeviseState() {
    const checkedBox = document.querySelector('.conv-devise-checkbox:checked');
    if (!checkedBox) {
        return {
            active: false,
            option: null,
            from: null,
            to: document.querySelector('input[name="devise"]:checked')?.value || '€',
            rate: 1,
            valid: true,
            error: null,
            inlineText: ''
        };
    }
    const optionKey = checkedBox.value;
    const preset = CONVERSION_DEVISE_OPTIONS[optionKey] || CONVERSION_DEVISE_OPTIONS.CUSTOM;
    const fromDev = optionKey === 'CUSTOM'
        ? (document.getElementById('conv_devise_from')?.value || '€')
        : preset.from;
    const toDev = optionKey === 'CUSTOM'
        ? (document.getElementById('conv_devise_to')?.value || 'FCFA')
        : preset.to;

    const rateInput = document.getElementById('taux_conversion_devise');
    const rawRate = rateInput ? rateInput.value : '';
    const check = validateTauxConversion(rawRate);
    const rateVal = check.valid ? check.value : 1;
    const inlineText = check.valid ? `(1${fromDev}=${check.value} ${toDev})` : '';

    return {
        active: true,
        option: optionKey,
        from: fromDev,
        to: toDev,
        rawRate: rawRate,
        rate: rateVal,
        valid: check.valid,
        error: check.error,
        inlineText: inlineText
    };
}
window.getConversionDeviseState = getConversionDeviseState;

function getFacteurConversionDevise() {
    const state = getConversionDeviseState();
    if (!state.active || !state.valid) return 1;
    return state.rate > 0 ? state.rate : 1;
}
window.getFacteurConversionDevise = getFacteurConversionDevise;

function applyDynamicCurrencyMaxAttributes() {
    const factor = getFacteurConversionDevise();
    CHAMPS_MONETAIRES_DYNAMIQUES.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        const baseRule = rules[id];
        const baseMax = el.dataset.baseMax !== undefined
            ? parseFloat(el.dataset.baseMax)
            : (baseRule ? baseRule.max : parseFloat(el.getAttribute('max')));
        if (Number.isFinite(baseMax)) {
            if (el.dataset.baseMax === undefined) {
                el.dataset.baseMax = String(baseMax);
            }
            const scaledMax = Math.round(baseMax * factor * 100) / 100;
            el.setAttribute('max', String(scaledMax));
        }
    });
}
window.applyDynamicCurrencyMaxAttributes = applyDynamicCurrencyMaxAttributes;

function setDeviseRadioValue(deviseSymbol, appliquerPrixCarburant = true) {
    const radio = document.querySelector(`input[name="devise"][value="${deviseSymbol}"]`);
    if (radio) {
        radio.checked = true;
        updateDeviseLabels(appliquerPrixCarburant);
    }
}

function updateConversionInlineInfo() {
    const state = getConversionDeviseState();
    const badge = document.getElementById('devise-conversion-active-badge');
    const inlineEl = document.getElementById('taux_conversion_inline_info');
    const errEl = document.getElementById('taux_conversion_error');
    const rateInput = document.getElementById('taux_conversion_devise');

    if (!state.active) {
        if (badge) badge.style.display = 'none';
        if (inlineEl) inlineEl.textContent = '';
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        if (rateInput) rateInput.style.border = '';
        return;
    }

    if (badge) {
        badge.style.display = 'inline-block';
        badge.textContent = state.valid ? `Actif ${state.inlineText}` : 'Taux invalide';
    }
    if (inlineEl) {
        inlineEl.textContent = state.inlineText;
    }
    if (!state.valid) {
        if (errEl) {
            errEl.style.display = 'block';
            errEl.textContent = state.error;
        }
        if (rateInput) rateInput.style.border = '2px solid #dc2626';
    } else {
        if (errEl) {
            errEl.style.display = 'none';
            errEl.textContent = '';
        }
        if (rateInput) rateInput.style.border = '';
    }
}

function onConversionCheckboxChange(checkbox) {
    const allBoxes = document.querySelectorAll('.conv-devise-checkbox');
    if (checkbox && checkbox.checked) {
        allBoxes.forEach((cb) => {
            if (cb !== checkbox) cb.checked = false;
        });
    }

    const activeBox = document.querySelector('.conv-devise-checkbox:checked');
    const customRow = document.getElementById('devise-converter-custom-currencies');
    const rateRow = document.getElementById('devise-converter-rate-row');
    const rateInput = document.getElementById('taux_conversion_devise');

    if (!activeBox) {
        if (customRow) customRow.style.display = 'none';
        if (rateRow) rateRow.style.display = 'none';
        updateConversionInlineInfo();
        applyDynamicCurrencyMaxAttributes();
        updateDeviseLabels(false);
        remettreResultatsEcoAZero();
        debounceSaveEconomicData();
        return;
    }

    const optKey = activeBox.value;
    const preset = CONVERSION_DEVISE_OPTIONS[optKey] || CONVERSION_DEVISE_OPTIONS.CUSTOM;
    if (customRow) customRow.style.display = (optKey === 'CUSTOM') ? 'flex' : 'none';
    if (rateRow) rateRow.style.display = 'block';

    if (rateInput) {
        rateInput.value = String(preset.defaultRate);
    }

    const targetDevise = (optKey === 'CUSTOM')
        ? (document.getElementById('conv_devise_to')?.value || 'FCFA')
        : preset.to;
    setDeviseRadioValue(targetDevise, true);
    updateConversionInlineInfo();
    applyDynamicCurrencyMaxAttributes();
    remettreResultatsEcoAZero();
    debounceSaveEconomicData();
}
window.onConversionCheckboxChange = onConversionCheckboxChange;

function onCustomCurrencySelectChange() {
    const toDev = document.getElementById('conv_devise_to')?.value || 'FCFA';
    setDeviseRadioValue(toDev, true);
    updateConversionInlineInfo();
    applyDynamicCurrencyMaxAttributes();
    remettreResultatsEcoAZero();
    debounceSaveEconomicData();
}
window.onCustomCurrencySelectChange = onCustomCurrencySelectChange;

function onTauxConversionInput() {
    updateConversionInlineInfo();
    applyDynamicCurrencyMaxAttributes();
    if (window.ResidentielChiffrage) {
        if (window.ResidentielChiffrage.Capex && typeof window.ResidentielChiffrage.Capex.render === 'function') {
            window.ResidentielChiffrage.Capex.render();
        }
        if (window.ResidentielChiffrage.Opex && typeof window.ResidentielChiffrage.Opex.render === 'function') {
            window.ResidentielChiffrage.Opex.render();
        }
    }
    remettreResultatsEcoAZero();
    debounceSaveEconomicData();
}
window.onTauxConversionInput = onTauxConversionInput;

function restaurerConversionDevise(savedConv) {
    const allBoxes = document.querySelectorAll('.conv-devise-checkbox');
    allBoxes.forEach((cb) => { cb.checked = false; });
    const customRow = document.getElementById('devise-converter-custom-currencies');
    const rateRow = document.getElementById('devise-converter-rate-row');
    const rateInput = document.getElementById('taux_conversion_devise');

    if (!savedConv || !savedConv.active || !savedConv.option) {
        if (customRow) customRow.style.display = 'none';
        if (rateRow) rateRow.style.display = 'none';
        updateConversionInlineInfo();
        applyDynamicCurrencyMaxAttributes();
        return;
    }

    const targetBox = document.querySelector(`.conv-devise-checkbox[value="${savedConv.option}"]`);
    if (targetBox) targetBox.checked = true;
    if (customRow) customRow.style.display = (savedConv.option === 'CUSTOM') ? 'flex' : 'none';
    if (rateRow) rateRow.style.display = 'block';

    if (savedConv.from && document.getElementById('conv_devise_from')) {
        document.getElementById('conv_devise_from').value = savedConv.from;
    }
    if (savedConv.to && document.getElementById('conv_devise_to')) {
        document.getElementById('conv_devise_to').value = savedConv.to;
    }
    if (rateInput && (savedConv.rawRate !== undefined || savedConv.rate !== undefined)) {
        rateInput.value = String(savedConv.rawRate !== undefined ? savedConv.rawRate : savedConv.rate);
    }
    if (savedConv.to) {
        setDeviseRadioValue(savedConv.to, false);
    }
    updateConversionInlineInfo();
    applyDynamicCurrencyMaxAttributes();
}
window.restaurerConversionDevise = restaurerConversionDevise;

function getNomProjetCourantEco() {
    try {
        const currentInput = document.getElementById('current_project_name') || document.getElementById('nom_projet');
        if (currentInput && currentInput.value && currentInput.value.trim()) {
            return currentInput.value.trim();
        }
        const lsName = localStorage.getItem('current_projet_nom') || localStorage.getItem('nom_projet_courant');
        if (lsName && lsName.trim()) return lsName.trim();
        const solarData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        if (solarData.projectName) return String(solarData.projectName).trim();
        if (solarData.nom_projet) return String(solarData.nom_projet).trim();
    } catch (e) { /* ignore */ }
    return '';
}
window.getNomProjetCourantEco = getNomProjetCourantEco;

function updateDeviseLabels(appliquerPrixCarburant = true) {
    const devRadio = document.querySelector('input[name="devise"]:checked');
    const dev = devRadio ? devRadio.value : '€';
    document.querySelectorAll('.symb-devise').forEach(el => el.textContent = dev);
    document.querySelectorAll('.symb-devise-unit').forEach(el => el.textContent = dev + '/l');
    document.querySelectorAll('.symb-devise-k').forEach(el => el.textContent = 'k' + dev);

    const pCarb = document.getElementById('prix_carburant');
    if (pCarb && appliquerPrixCarburant) {
        if (dev === '€') pCarb.value = 1.5;
        else if (dev === '$') pCarb.value = 1.8;
        else if (dev === 'FCFA') pCarb.value = 1000;
        // NOUVEAU (demande explicite) : Gourde haïtienne (HTG).
        else if (dev === 'HTG') pCarb.value = 300;
    }

    applyDynamicCurrencyMaxAttributes();
    generatePaliers(); // Relancer pour mettre à jour les devises dans les paliers

    // CORRECTIF (demande explicite : "si je change de devise, cela ne modifie pas les autres
    // unités") : ResidentielCapexTable.js/ResidentielOpexTable.js régénèrent leur HTML depuis un
    // gabarit qui lisait désormais la devise courante (cf. Rules.getDeviseSymbol()), mais seulement
    // au moment où ils se re-rendent d'eux-mêmes (édition d'une ligne, ajout, synchronisation...) —
    // sans ceci, choisir une autre devise ici n'avait aucun effet visible sur ces deux tableaux tant
    // que l'utilisateur ne les modifiait pas lui-même. Sans effet pour Pro/Grand projet (fonctions
    // absentes de window.ResidentielChiffrage dans ce cas).
    if (window.ResidentielChiffrage) {
        if (window.ResidentielChiffrage.Capex && typeof window.ResidentielChiffrage.Capex.render === 'function') {
            window.ResidentielChiffrage.Capex.render();
        }
        if (window.ResidentielChiffrage.Opex && typeof window.ResidentielChiffrage.Opex.render === 'function') {
            window.ResidentielChiffrage.Opex.render();
        }
    }
}

function toggleFranceSpec(show) {
    const container = document.getElementById('prod_limite_container');
    if (container) container.style.display = show ? 'block' : 'none';
    generatePaliers();
}

function toggleCapexModeSelect(mode) {
    document.getElementById('capex_simple_input_div').style.display = (mode === 'simple') ? 'block' : 'none';
    document.getElementById('capex_detaille_section').style.display = (mode === 'detaille') ? 'block' : 'none';
    updateCapexDisplays();
    updateFinanceCalculations();
}

function toggleOpexModeSelect(mode) {
    document.getElementById('opex_simple_div').style.display = (mode === 'simple') ? 'block' : 'none';
    document.getElementById('opex_detaille_div').style.display = (mode === 'detaille') ? 'block' : 'none';
    updateCapexDisplays();
}

function toggleDetteFields(show) {
    const isDual = document.getElementById('simuler_deux_options')?.checked;
    if (show || isDual) {
        document.getElementById('dette_fields').style.display = 'grid';
    } else {
        document.getElementById('dette_fields').style.display = 'none';
    }
    updateFinanceCalculations();
}

function toggleDeuxOptions() {
    const isDual = document.getElementById('simuler_deux_options')?.checked;
    const useDette = document.querySelector('input[name="dette_toggle"]:checked')?.value === 'oui';
    if (isDual || useDette) {
        document.getElementById('dette_fields').style.display = 'grid';
    } else {
        document.getElementById('dette_fields').style.display = 'none';
    }
    updateFinanceCalculations();
}

function addDynamicRow(containerId, className, callback) {
    const div = document.createElement('div');
    div.className = 'dynamic-row';
    div.innerHTML = `<input type="text" placeholder="Nom" style="flex:2">
                         <input type="number" class="${className}" value="0" style="flex:1" oninput="${callback ? callback.name + '()' : ''}; updateFinanceCalculations();">
                         <button onclick="this.parentElement.remove(); ${callback ? callback.name + '()' : ''}; updateFinanceCalculations();" style="color:red">X</button>`;
    document.getElementById(containerId).appendChild(div);
    if (callback) callback();
}

function updateCapexDisplays() {
    // CORRECTIF CRITIQUE (résidentiel) : cette fonction partagée Pro/Grand recalculait
    // inconditionnellement #total_capex_display/#total_opex_display à partir des champs CAPEX/OPEX
    // simples/détaillés du standard view (tous à 0 pour un projet résidentiel) — déclenchée entre
    // autres par l'oninput de #puissance/#degradation, déplacés dans la section Production
    // résidentielle et donc réellement atteignables par l'utilisateur, ce qui effaçait le CAPEX/OPEX
    // résidentiel tout juste saisi (piloté par ResidentielCapexTable/OpexTable.js, qui gèrent déjà
    // eux-mêmes ces deux affichages + leurs ratios). Retour immédiat sans toucher au DOM pour ce
    // cas ; comportement Pro/Grand strictement inchangé (condition fausse pour eux).
    if (window.isResidentialPath()) {
        return parseFloat(document.getElementById('total_capex_display')?.textContent) || 0;
    }

    const puiss = parseFloat(document.getElementById('puissance').value) || 0;
    let capexK = 0;
    const modeCapex = document.querySelector('input[name="capex_mode_select"]:checked').value;
    // PRO / Grand projet : CAPEX = total HT du tableau « Chiffrage CAPEX (Devis) » (TVA récupérable),
    // cf. ResidentielCapexTable.js (profil 'pro'). L'ancien CAPEX simple / détaillé est masqué.
    const capexDevis = window.ResidentielChiffrage && window.ResidentielChiffrage.Capex;
    const devisPro = !!(capexDevis && typeof capexDevis.isProActive === 'function' && capexDevis.isProActive());

    if (devisPro) {
        capexK = capexDevis.getEngineCapexK();
    } else if (modeCapex === 'simple') {
        capexK = (parseFloat(document.getElementById('capex_simple_val').value) * puiss);
    } else {
        document.querySelectorAll('.capex-in').forEach(i => {
            const val = parseFloat(i.value) || 0;
            capexK += (i.getAttribute('data-label') === 'Subvention') ? -val : val;
        });
    }

    if (document.querySelector('input[name="type_systeme"]:checked').value === 'hybride') {
        capexK += parseFloat(document.getElementById('cap_ge').value) || 0;
    }

    let opexAnK = 0;
    const modeOpex = document.querySelector('input[name="opex_mode_select"]:checked').value;
    if (modeOpex === 'simple') {
        opexAnK = (parseFloat(document.getElementById('opex_wc').value) * puiss);
    } else {
        document.querySelectorAll('.opex-in').forEach(i => opexAnK += parseFloat(i.value) || 0);
    }

    if (document.querySelector('input[name="type_systeme"]:checked').value === 'hybride') {
        opexAnK += parseFloat(document.getElementById('op_ge').value) || 0;
    }
    // Frais d'abonnement batterie virtuelle (€/an -> k€/an), quel que soit le mode OPEX.
    opexAnK += fraisAbonnementBvEuros() / 1000;
    majMontantAbonnementBv(false);

    document.getElementById('total_capex_display').textContent = capexK.toFixed(2);
    document.getElementById('ratio_capex_display').textContent = puiss > 0 ? (capexK / puiss).toFixed(2) : "0.00";
    document.getElementById('total_opex_display').textContent = opexAnK.toFixed(2);
    document.getElementById('ratio_opex_display').textContent = puiss > 0 ? (opexAnK / puiss).toFixed(2) : "0.00";
    return capexK;
}

function updateFinanceCalculations() {
    const capexK = updateCapexDisplays();
    const useDette = document.querySelector('input[name="dette_toggle"]:checked').value === 'oui';
    const fpPct = parseFloat(document.getElementById('fp_pct').value) || 0;

    // Règle N°2 : Aucune auto-correction - l'alerte et la modification automatique sont supprimées. 

    const tDette = useDette ? (parseFloat(document.getElementById('taux_dette').value) / 100) : 0;
    const mat = useDette ? (parseInt(document.getElementById('maturite_dette').value) || 0) : 0;
    const emprunt = useDette ? capexK * (1 - (fpPct / 100)) : 0;

    const intAnnuel = emprunt * tDette;
    const annuite = (emprunt > 0 && tDette > 0 && mat > 0) ? (emprunt * tDette) / (1 - Math.pow(1 + tDette, -mat)) : (emprunt / (mat || 1));

    document.getElementById('res_int_annuel').value = intAnnuel.toFixed(2);
    document.getElementById('res_annuite_est').value = (useDette ? annuite : 0).toFixed(2);
}

function generatePaliers() {
    const grid = document.getElementById('paliers_grid');
    if (!grid) return;

    const isFrance = document.querySelector('input[name="spec_france"]:checked').value === 'oui';
    const tauxAuto = parseFloat(document.getElementById('taux_autoconsommation').value) || 0;
    const dev = document.querySelector('input[name="devise"]:checked').value;

    const estFige = (tauxAuto === 100);
    const styleFige = estFige ? 'background:#eee; cursor:not-allowed;' : '';

    let labelTitre = "Tarif Vente Surplus";
    if (tauxAuto === 0) labelTitre = "Tarif Vente Totale";
    if (tauxAuto === 100) labelTitre = "Tarifs de vente (Inactifs à 100%)";

    if (grid.innerHTML.trim() === '' || !document.getElementById('pal_t_1')) {
        grid.innerHTML = `
            <div class="form-group" style="border:1px solid #ddd; padding:15px; border-radius:5px; background: #fdfdfd;">
                <label><strong id="label_pal_1">${labelTitre} (${dev}/MWh)</strong></label>
                <input type="number" id="pal_t_1" value="0" min="1" max="250" step="any">
                <label id="vente-surplus-optin-container" style="display:flex; align-items:center; gap:6px; cursor:pointer; font-weight:normal; font-size:0.8em; margin-top:6px; white-space:nowrap;">
                    <input type="checkbox" id="vente_surplus_optin" ${caseVenteSurplusCocheeParDefaut() ? 'checked' : ''} style="width:16px; height:16px; margin:0; cursor:pointer;">
                    Prendre en compte la revente du surplus
                </label>
                
                <label style="margin-top:10px">Période d'application (Années)</label>
                <div style="display:flex; gap:5px">
                    <input type="number" id="pal_s_1" value="1">
                    <input type="number" id="pal_e_1" value="20">
                </div>
            </div>

            <div class="form-group" id="pal_t_2_container" style="border:1px solid #ddd; padding:15px; border-radius:5px;">
                <label id="label_pal_2">Tarif Tranche 2 (Hors limite prod) (${dev}/MWh)</label>
                <input type="number" id="pal_t_2" value="0" min="0" max="500" step="any">
            </div>

            <div class="form-group" id="pal3_box" style="border:1px solid #ddd; padding:15px; border-radius:5px; display:none">
                <label id="label_pal_3">Tarif Post-Contrat (${dev}/MWh)</label>
                <input type="number" id="pal_t_3" value="0" min="0" max="500" step="any">
                <label style="margin-top:10px">Période d'application (Années)</label>
                <div style="display:flex; gap:5px">
                    <input type="number" id="pal_s_3" value="21">
                    <input type="number" id="pal_e_3" value="30">
                </div>
            </div>`;
    }

    const label1 = document.getElementById('label_pal_1');
    const label2 = document.getElementById('label_pal_2');
    const label3 = document.getElementById('label_pal_3');

    if (label1) label1.innerText = `${labelTitre} (${dev}/MWh)`;
    if (label2) label2.innerText = `Tarif Tranche 2 (Hors limite prod) (${dev}/MWh)`;
    if (label3) label3.innerText = `Tarif Post-Contrat (${dev}/MWh)`;

    const inputs = ['pal_t_1', 'pal_s_1', 'pal_e_1', 'pal_t_2', 'pal_t_3', 'pal_s_3', 'pal_e_3'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = estFige;
            el.style.cssText = styleFige;
        }
    });

    const palT2Container = document.getElementById('pal_t_2_container');
    if (palT2Container) {
        palT2Container.style.display = (isFrance && !estFige) ? 'block' : 'none';
    }

    // Case de revente du surplus : utile seulement s'il y a un surplus, c'est-à-dire en
    // autoconsommation partielle (à 0 % tout est vendu, à 100 % rien n'est injecté).
    const caseSurplus = document.getElementById('vente-surplus-optin-container');
    // Site autonome : pas de réseau, donc pas de revente (case masquée, cf. app/utils/parcours.py).
    const reventeMasquee = typeof window.parcoursMasque === 'function' && window.parcoursMasque('revente_surplus');
    if (caseSurplus) caseSurplus.style.display = (!reventeMasquee && tauxAuto > 0 && tauxAuto < 100) ? 'flex' : 'none';

    majBatterieVirtuelle(false);
    checkHorizon();
}

/**
 * Batterie virtuelle proposée aux projets Résidentiel et PRO (Professionnelle C&I), hors Site
 * autonome — règle partagée avec la case du formulaire de calepinage (calepinage_maison_formulaires.js).
 */
function batterieVirtuelleProposee() {
    const typologie = typeof window.normaliserTypologie === 'function'
        ? window.normaliserTypologie(window.ACTIVE_PROJECT_TYPOLOGIE) : window.ACTIVE_PROJECT_TYPOLOGIE;
    const siteAutonome = typeof window.isSiteAutonomeProject === 'function' && window.isSiteAutonomeProject();
    return !siteAutonome && (typologie === 'Résidentielle' || typologie === 'Professionnelle (C&I)');
}
window.batterieVirtuelleProposee = batterieVirtuelleProposee;

/**
 * Batterie virtuelle disponible sur un système connecté au réseau, quel que soit le type d'étude.
 * CORRECTIF (bug rapporté : « case cochée au calepinage, aucun champ dans le modal économique ») :
 * elle exigeait aussi 0 < taux d'autoconsommation < 100, or ce taux reste à 0 tant que
 * l'autoconsommation n'est pas calculée (et toujours en Chiffrage) — la case cochée n'affichait
 * alors rien. Sans surplus (100 %), le gain vaut simplement 0 (énergie injectée nulle).
 * Miroir : EtudeEconomiqueService._batterie_virtuelle_active (etude_economique.py).
 */
function batterieVirtuelleDisponible() {
    const isHybride = document.querySelector('input[name="type_systeme"]:checked')?.value === 'hybride';
    return batterieVirtuelleProposee() && !isHybride;
}

/** true si le gain de la batterie virtuelle remplace la vente du surplus dans le calcul. */
function batterieVirtuelleActive() {
    return batterieVirtuelleDisponible() && !!document.getElementById('batterie_virtuelle_optin')?.checked;
}
window.batterieVirtuelleActive = batterieVirtuelleActive;

/**
 * Frais d'abonnement batterie virtuelle (€/an) = puissance du projet (kWc) x prix unitaire
 * (€/kWc/an, #abonnement_bv_kwc : TTC en résidentiel, HT en PRO), 0 si la batterie virtuelle n'est
 * pas retenue. Ajouté au total OPEX : ResidentielOpexTable.js::total() en résidentiel,
 * updateCapexDisplays() en PRO — le moteur et le contrôle serveur le reçoivent dans opexK.
 */
function fraisAbonnementBvEuros() {
    if (!batterieVirtuelleActive()) return 0;
    const puissance = parseFloat(document.getElementById('puissance')?.value) || 0;
    const prix = parseFloat(document.getElementById('abonnement_bv_kwc')?.value) || 0;
    return puissance * prix;
}
window.fraisAbonnementBvEuros = fraisAbonnementBvEuros;

/** Montant annuel affiché sous le champ « Frais d'abonnement batterie virtuelle ». */
function majMontantAbonnementBv(ttc) {
    const el = document.getElementById('montant_abonnement_bv');
    if (!el) return;
    const puissance = parseFloat(document.getElementById('puissance')?.value) || 0;
    const dev = document.querySelector('input[name="devise"]:checked')?.value || '€';
    el.textContent = batterieVirtuelleActive()
        ? `Soit ${fraisAbonnementBvEuros().toFixed(2)} ${dev} ${ttc ? 'TTC' : 'HT'}/an pour ${puissance} kWc`
        : '';
}
window.majMontantAbonnementBv = majMontantAbonnementBv;

/**
 * Affichage selon la case « Intégration d'une batterie virtuelle » :
 * cochée, le tarif du palier 1 devient le tarif de rachat du surplus stocké, la facture d'hiver
 * compensée apparaît, et les paramètres de vente sans objet (case de revente, tranche 2,
 * post-contrat, indexation de la vente) sont masqués. Décochée : affichage de vente inchangé.
 * @param {boolean} [rafraichirHorizon=true] - false quand l'appelant rappelle checkHorizon().
 */
function majBatterieVirtuelle(rafraichirHorizon) {
    const disponible = batterieVirtuelleDisponible();
    const actif = batterieVirtuelleActive();
    const afficher = (id, visible, mode) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? (mode || '') : 'none';
    };
    afficher('batterie-virtuelle-optin-container', disponible);
    afficher('groupe_facture_hiver_bv', actif);
    afficher('groupe_abonnement_bv', actif);
    afficher('groupe_indexation_vente_12', !actif);
    // Case de revente et tranche 2 : masquées ici seulement ; décochée, generatePaliers() (rappelé
    // ci-dessous) leur rend leur affichage d'origine.
    if (actif) {
        afficher('vente-surplus-optin-container', false);
        afficher('pal_t_2_container', false);
    }

    const label1 = document.getElementById('label_pal_1');
    const dev = document.querySelector('input[name="devise"]:checked')?.value || '€';
    if (label1 && actif) label1.innerText = `Tarif de rachat du surplus d’énergie stockée (${dev}/MWh)`;
    else if (label1 && rafraichirHorizon !== false) generatePaliers(); // libellé de vente d'origine

    if (rafraichirHorizon !== false) checkHorizon();
    // Frais d'abonnement compris (ou retirés) du total OPEX — PRO ici, résidentiel via l'évènement
    // ci-dessous (ResidentielOpexTable.js).
    if (typeof window.isResidentialPath === 'function' && !window.isResidentialPath()) updateCapexDisplays();
    document.dispatchEvent(new CustomEvent('batterieVirtuelleChangee', { detail: { actif } }));
}
window.majBatterieVirtuelle = majBatterieVirtuelle;

/** Tarif de rachat du surplus d'énergie stockée proposé par défaut (€/MWh, demande explicite). */
const TARIF_RACHAT_BV_DEFAUT = 100;

/**
 * Case « batterie virtuelle » cochée / décochée par l'utilisateur (ici ou depuis le calepinage, cf.
 * definirBatterieVirtuelle) — jamais à la restauration des saisies, qui garde le tarif enregistré.
 * Cochée : le tarif de vente du surplus (#pal_t_1) est mis de côté et remplacé par le tarif de rachat
 * par défaut (100 €/MWh). Décochée : le tarif de vente mis de côté est rétabli (en résidentiel
 * France ≤ 100 kWc, le verrou réglementaire le remet ensuite à 11 €/MWh).
 */
function surCaseBatterieVirtuelle() {
    const caseBv = document.getElementById('batterie_virtuelle_optin');
    const tarif = document.getElementById('pal_t_1');
    const memo = document.getElementById('tarif_vente_avant_bv');
    if (caseBv && tarif && memo) {
        if (caseBv.checked) {
            memo.value = tarif.value;
            tarif.value = String(TARIF_RACHAT_BV_DEFAUT);
        } else if (memo.value !== '') {
            tarif.value = memo.value;
            memo.value = '';
        }
        tarif.style.border = '';
    }
    majBatterieVirtuelle();
}
window.surCaseBatterieVirtuelle = surCaseBatterieVirtuelle;

/**
 * Coche initiale de la case « Prendre en compte la revente du surplus » : décochée en résidentiel
 * (demande explicite d'origine), cochée en PRO / Grand projet, où la revente a toujours été
 * comptée — un projet déjà enregistré sans cette case garde donc le même résultat.
 */
function caseVenteSurplusCocheeParDefaut() {
    return !(typeof window.isResidentialPath === 'function' && window.isResidentialPath());
}

/**
 * true si le revenu de vente d'électricité entre dans le calcul. Vente totale (0 %) : toujours ;
 * autoconsommation partielle : selon la case ; 100 % : rien n'est injecté, sans objet.
 */
function venteSurplusActive() {
    const tauxAuto = parseFloat(document.getElementById('taux_autoconsommation')?.value) || 0;
    if (typeof window.parcoursMasque === 'function' && window.parcoursMasque('revente_surplus')) return false;
    if (tauxAuto <= 0 || tauxAuto >= 100) return true;
    const caseSurplus = document.getElementById('vente_surplus_optin');
    return caseSurplus ? caseSurplus.checked : true;
}
window.venteSurplusActive = venteSurplusActive;

// ─────────────────────────────────────────────────────────────────────────────
// 1. COLLECTE DES INPUTS — remplace getBaseInputs()
//    Collecte tous les champs du formulaire et les envoie en JSON au backend.
// ─────────────────────────────────────────────────────────────────────────────

function collectInputs() {
    // CAPEX du tableau « Chiffrage CAPEX (Devis) » recalculé juste avant la lecture de
    // #total_capex_display, quel que soit le mode (Prix au Wc / CAPEX total / Chiffrage détaillé) :
    // en « Prix au Wc », il suit la puissance courante.
    const capexDevisTable = window.ResidentielChiffrage && window.ResidentielChiffrage.Capex;
    if (capexDevisTable && typeof capexDevisTable.synchroniserMoteur === 'function') capexDevisTable.synchroniserMoteur();
    const dev = document.querySelector('input[name="devise"]:checked').value;
    const useDette = document.querySelector('input[name="dette_toggle"]:checked').value === 'oui';
    const fpPct = parseFloat(document.getElementById('fp_pct').value) || 0;
    const tDette = useDette ? parseFloat(document.getElementById('taux_dette').value) : 0;
    const mat = useDette ? parseInt(document.getElementById('maturite_dette').value) : 0;
    const useDeprec = document.querySelector('input[name="deprec_toggle"]:checked').value === 'oui';
    const deprecPct = useDeprec ? parseFloat(document.getElementById('deprec_pct').value) : 0;
    const specFrance = document.querySelector('input[name="spec_france"]:checked').value === 'oui';

    const convState = getConversionDeviseState();
    return {
        // Production
        pays: document.getElementById('pays')?.value || 'France',
        devise: dev,
        tauxConversion: convState.active && convState.valid ? convState.rate : 1,
        conversionDevise: convState,
        puissance: parseFloat(document.getElementById('puissance').value) || 0,
        productible: parseFloat(document.getElementById('productible').value) || 0,
        degradation: parseFloat(document.getElementById('degradation').value) || 0,
        tauxAuto: parseFloat(document.getElementById('taux_autoconsommation').value) || 0,
        horizon: parseInt(document.getElementById('horizon').value) || 20,

        // CAPEX / OPEX
        capexK: parseFloat(document.getElementById('total_capex_display').textContent) || 0,
        opexK: parseFloat(document.getElementById('total_opex_display').textContent) || 0,
        
        // CAPEX Détaillé
        capexEtudes: parseFloat(document.getElementById('capex_etudes')?.value) || 0,
        capexAdmin: parseFloat(document.getElementById('capex_admin')?.value) || 0,
        capexPanneaux: parseFloat(document.getElementById('capex_panneaux')?.value) || 0,
        capexElec: parseFloat(document.getElementById('capex_elec')?.value) || 0,
        capexCharpente: parseFloat(document.getElementById('capex_integration')?.value) || 0,
        capexVrd: parseFloat(document.getElementById('capex_vrd')?.value) || 0,
        capexRacco: parseFloat(document.getElementById('capex_racco')?.value) || 0,
        capexAmo: parseFloat(document.getElementById('capex_amo')?.value) || 0,
        capexSubvention: parseFloat(document.getElementById('capex_subvention')?.value) || 0,
        capexBatterie: parseFloat(document.getElementById('capex_batterie')?.value) || 0,
        
        opexConnexion: parseFloat(document.getElementById('opex_connexion')?.value) || 0,
        opexPrev: parseFloat(document.getElementById('opex_prev')?.value) || 0,
        opexCura: parseFloat(document.getElementById('opex_cura')?.value) || 0,
        opexLoyer: parseFloat(document.getElementById('opex_loyer')?.value) || 0,

        // Tarifs
        prixAchatMWh: parseFloat(document.getElementById('prix_achat_elec')?.value) || 0,
        indVente12: parseFloat(document.getElementById('indexation_vente_12')?.value) || 0,
        indVente3: parseFloat(document.getElementById('indexation_vente_3')?.value) || 0,
        indAchat: parseFloat(document.getElementById('indexation_achat')?.value) || 0,
        indOpex: parseFloat(document.getElementById('index_opex')?.value) || 0,

        // Paliers tarifaires
        // Tarifs lus tels quels : un 0 n'est plus remplacé en silence par 130 / 40 / 60 €/MWh.
        palT1: parseFloat(document.getElementById('pal_t_1')?.value) || 0,
        palT2: parseFloat(document.getElementById('pal_t_2')?.value) || 0,
        palT3: parseFloat(document.getElementById('pal_t_3')?.value) || 0,
        venteSurplus: venteSurplusActive(),
        // Batterie virtuelle : son gain remplace la vente du surplus (cf. calculateEconomicData).
        batterieVirtuelle: batterieVirtuelleActive(),
        factureHiverBV: parseFloat(document.getElementById('facture_hiver_bv')?.value) || 0,
        // Déjà compris dans opexK (fraisAbonnementBvEuros) : transmis pour le contrôle des bornes.
        abonnementBV: parseFloat(document.getElementById('abonnement_bv_kwc')?.value),
        palS1: parseInt(document.getElementById('pal_s_1')?.value) || 1,
        palE1: parseInt(document.getElementById('pal_e_1')?.value) || 20,

        // Spécificité tarifaire France
        specFrance: specFrance,
        prodLimite: parseFloat(document.getElementById('prod_limite')?.value) || 0,
        checkDegradPrime: document.getElementById('check_degrad_prime')?.checked || false,
        hn_nbre: parseFloat(document.getElementById('hn_nbre')?.value) || 0,
        hn_seuil: parseFloat(document.getElementById('hn_seuil')?.value) || 15,
        hn_max: parseFloat(document.getElementById('hn_max')?.value) || 300,
        hn_appliquer_net: document.getElementById('hn_appliquer_net')?.checked ?? true,

        // Financement
        fpPct: fpPct,
        useDette: useDette,
        tauxDette: tDette,
        maturite: mat,

        // Fiscalité
        tauxActualisation: parseFloat(document.getElementById('taux_actualisation').value) || 0,
        tauxImpot: parseFloat(document.getElementById('taux_impot').value) || 0,

        // Dépréciation
        useDeprec: useDeprec,
        deprecPct: deprecPct,

        // Remplacement onduleur
        ond10: parseFloat(document.getElementById('ond_10')?.value) || 0,
        ond20: parseFloat(document.getElementById('ond_20')?.value) || 0,
        bat10: parseFloat(document.getElementById('bat_10')?.value) || 0,

        // Stockage (vieillissement batterie, cf. StockageVieillissement.js) : null = calcul historique
        // au taux d'autoconsommation global.
        stockage: lireStockagePourEco(),
        prixRechargeReseau: champStockageVisible('groupe_prix_recharge_reseau')
            ? (document.getElementById('prix_recharge_reseau')?.value === '' ? null : parseFloat(document.getElementById('prix_recharge_reseau')?.value))
            : null,
        remplacementBatterieMode: document.getElementById('remplacement_batterie_mode')?.value || 'auto',
        remplacementBatterieAnnee: parseInt(document.getElementById('remplacement_batterie_annee')?.value, 10) || null,

        // Système hybride
        typeSys: document.querySelector('input[name="type_systeme"]:checked').value,
        consoSite: parseFloat(document.getElementById('consommation_energie_site')?.value) || 0,
        tauxCouv: parseFloat(document.getElementById('taux_de_couverture_PV')?.value) || 0,
        prixCarb: parseFloat(document.getElementById('prix_carburant')?.value) || 0,
        consoGE: parseFloat(document.getElementById('consommation_ge')?.value) || 0,
        indexCarb: parseFloat(document.getElementById('indexation_carburant')?.value) || 0,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// STOCKAGE : VIEILLISSEMENT DE LA BATTERIE ET RECHARGE SUR LE RÉSEAU
// ─────────────────────────────────────────────────────────────────────────────

/** Bloc « vieillissement » exploitable, ou null. Miroir de _stockage_valide (etude_economique.py). */
function stockageValide(stockage) {
    if (!stockage || typeof stockage !== 'object' || !Array.isArray(stockage.points) || !stockage.points.length) return null;
    if (!(Number(stockage.prod_pv_mwh) > 0)) return null;
    return stockage;
}

/**
 * Vieillissement de la batterie du stockage enregistré en base avec le calcul ProSolaire (cf.
 * ReferenceProSolaire.js), seulement si ce stockage entre dans le taux d'autoconsommation repris.
 * Il venait du localStorage (solar_storage_data), commun à tous les projets.
 */
function lireStockagePourEco() {
    // Site autonome / hybride : pas de facture réseau, le stockage n'entre pas dans ce calcul.
    if ((document.querySelector('input[name="type_systeme"]:checked')?.value || 'reseau') === 'hybride') return null;
    const v = window.ReferenceProSolaire ? window.ReferenceProSolaire.vieillissementBatterie() : null;
    return stockageValide(v);
}

function champStockageVisible(id) {
    const el = document.getElementById(id);
    return !!el && el.style.display !== 'none';
}

/**
 * Affiche le prix de recharge réseau (carte « Facture consommation ») uniquement quand la recharge sur
 * le réseau est activée dans le stockage, et les options de remplacement batterie quand un stockage est
 * pris en compte.
 */
function majChampsStockageEco() {
    const sto = lireStockagePourEco();
    const actif = !!sto;
    const afficher = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? '' : 'none'; };

    afficher('groupe_prix_recharge_reseau', actif && !!sto.restitution_active);
    afficher('bloc_remplacement_batterie', actif);
    const mode = document.getElementById('remplacement_batterie_mode')?.value || 'auto';
    afficher('groupe_annee_remplacement', actif && mode === 'annee');

    const label = document.getElementById('label_bat_10');
    if (label) {
        label.innerHTML = actif
            ? 'Coût de remplacement batterie (<span class="symb-devise-k">k€</span>)'
            : 'Coût batterie an 10 (report an 11) (<span class="symb-devise-k">k€</span>)';
    }
    const info = document.getElementById('info_duree_vie_batterie');
    if (info) {
        info.textContent = actif && isFinite(Number(sto.duree_vie_ans))
            ? `Durée de vie estimée : ${Number(sto.duree_vie_ans).toFixed(1)} ans (fin de vie à ${Number(sto.soh_fin_vie_pct).toFixed(0)} % de capacité).`
            : '';
    }
}
window.majChampsStockageEco = majChampsStockageEco;

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION FRONT-END STRICTE (AJOUT)
// ─────────────────────────────────────────────────────────────────────────────

const rules = {
    productible: { min: 0, minIncl: false, max: 2500, maxIncl: false },
    degradation: { min: 0, minIncl: false, max: 5, maxIncl: true },
    horizon: { min: 0, minIncl: true, max: 30, maxIncl: true },
    prod_limite: { min: 0, minIncl: false, max: 2500, maxIncl: false },
    pal_t_1: { min: 1, minIncl: true, max: 250, maxIncl: true },
    pal_t_2: { min: 0, minIncl: true, max: 500, maxIncl: true },
    pal_t_3: { min: 0, minIncl: true, max: 500, maxIncl: true },
    prix_achat_elec: { min: 10, minIncl: true, max: 1000, maxIncl: true },
    tarif_hiver_input: { min: 10, minIncl: true, max: 1000, maxIncl: true },
    tarif_ete_input: { min: 10, minIncl: true, max: 1000, maxIncl: true },
    capex_simple_val: { min: 0, minIncl: true, max: 3, maxIncl: false },
    opex_wc: { min: 0, minIncl: true, max: 0.2, maxIncl: false },
    capex_etudes: { min: 0, minIncl: true, max: 50, maxIncl: false },
    capex_admin: { min: 0, minIncl: true, max: 100, maxIncl: false },
    capex_panneaux: { min: 0, minIncl: true, max: 500, maxIncl: false },
    capex_elec: { min: 0, minIncl: true, max: 500, maxIncl: false },
    capex_integration: { min: 0, minIncl: true, max: 500, maxIncl: false },
    capex_vrd: { min: 0, minIncl: true, max: 200, maxIncl: false },
    capex_racco: { min: 0, minIncl: true, max: 5000, maxIncl: false },
    capex_amo: { min: 0, minIncl: true, max: 200, maxIncl: false },
    capex_subvention: { min: 0, minIncl: true, max: 300, maxIncl: false },
    capex_batterie: { min: 0, minIncl: true, max: 300, maxIncl: false },
    opex_connexion: { min: 0, minIncl: true, max: 10, maxIncl: false },
    opex_prev: { min: 0, minIncl: true, max: 50, maxIncl: false },
    opex_cura: { min: 0, minIncl: true, max: 50, maxIncl: false },
    opex_loyer: { min: 0, minIncl: true, max: 100, maxIncl: false },
    indexation_vente_12: { min: 1, minIncl: true, max: 20, maxIncl: true },
    indexation_vente_3: { min: 0, minIncl: true, max: 3, maxIncl: true },
    indexation_achat: { min: 1, minIncl: true, max: 20, maxIncl: true },
    facture_hiver_bv: { min: 40, minIncl: true, max: 1000, maxIncl: true },
    abonnement_bv_kwc: { min: 0.5, minIncl: true, max: 5, maxIncl: true },
    index_opex: { min: 0, minIncl: true, max: 10, maxIncl: true },
    ond_10: { min: 0, minIncl: true, max: 100000, maxIncl: false },
    bat_10: { min: 0, minIncl: true, max: 100000, maxIncl: false },
    ond_20: { min: 0, minIncl: true, max: 100000, maxIncl: false },
    fp_pct: { min: 0, minIncl: true, max: 50, maxIncl: false },
    taux_dette: { min: 0, minIncl: true, max: 20, maxIncl: false },
    maturite_dette: { min: 0, minIncl: true, max: 30, maxIncl: false },
    taux_actualisation: { min: 0, minIncl: true, max: 10, maxIncl: false },
    taux_impot: { min: 0, minIncl: true, max: 50, maxIncl: false },
    deprec_pct: { min: 0, minIncl: true, max: 100, maxIncl: true }
};

// Tarifs et indexations (bornes 10-1000 €/MWh, 1-250 €/MWh, 1-20 %/an) : vides = erreur.
const CHAMPS_TARIFS_OBLIGATOIRES = ['prix_achat_elec', 'indexation_achat', 'pal_t_1', 'indexation_vente_12', 'facture_hiver_bv', 'abonnement_bv_kwc'];

/**
 * true si le champ n'entre pas dans le calcul, donc pas contrôlé : facture et revente masquées en
 * Site autonome/Hybride ; tarifs de vente sans objet à 100 % d'autoconsommation ou quand la case
 * « Prendre en compte la revente du surplus » est décochée. Batterie virtuelle : seuls le tarif de
 * rachat du surplus stocké (pal_t_1) et la facture d'hiver compensée entrent dans le calcul.
 */
function champHorsCalcul(id) {
    if (id === 'facture_hiver_bv' || id === 'abonnement_bv_kwc') return !batterieVirtuelleActive();
    if (batterieVirtuelleActive()) {
        return ['pal_t_2', 'pal_t_3', 'indexation_vente_12', 'indexation_vente_3'].includes(id);
    }
    const isHybride = document.querySelector('input[name="type_systeme"]:checked')?.value === 'hybride';
    if (isHybride && ['prix_achat_elec', 'indexation_achat', 'pal_t_1', 'pal_t_2', 'pal_t_3', 'indexation_vente_12', 'indexation_vente_3'].includes(id)) {
        return true;
    }
    const tauxAuto = parseFloat(document.getElementById('taux_autoconsommation')?.value) || 0;
    if (tauxAuto >= 100 && ['pal_t_1', 'pal_t_2', 'pal_t_3', 'indexation_vente_12', 'indexation_vente_3'].includes(id)) {
        return true; // tarifs de vente inactifs à 100 % d'autoconsommation
    }
    if (!venteSurplusActive() && ['pal_t_1', 'pal_t_2', 'pal_t_3', 'indexation_vente_12', 'indexation_vente_3'].includes(id)) {
        return true; // revente du surplus non retenue (case décochée)
    }
    return false;
}

function validateStrictData() {
    let isValid = true;
    let errors = [];

    const convState = getConversionDeviseState();
    if (convState.active && !convState.valid) {
        isValid = false;
        errors.push(`[Taux de conversion] ${convState.error}`);
    }
    const facteurConv = getFacteurConversionDevise();

    function checkField(id, min, max, name, minIncl, maxIncl) {
        const el = document.getElementById(id);
        if (!el || el.disabled || champHorsCalcul(id)) return;
        const effectiveMax = CHAMPS_MONETAIRES_DYNAMIQUES.includes(id)
            ? Math.round(max * facteurConv * 100) / 100
            : max;
        if (el.value === "" && CHAMPS_TARIFS_OBLIGATOIRES.includes(id)) {
            isValid = false;
            el.style.border = '2px solid red';
            errors.push(`[${name}] obligatoire, doit être >= ${min} et <= ${effectiveMax}.`);
            return;
        }
        if (el.value === "") return;
        const val = parseFloat(el.value);
        if (isNaN(val)) return;
        
        let fieldValid = true;
        if (minIncl ? val < min : val <= min) fieldValid = false;
        if (maxIncl ? val > effectiveMax : val >= effectiveMax) fieldValid = false;
        
        if (!fieldValid) {
            isValid = false;
            el.style.border = '2px solid red';
            const minTxt = minIncl ? `>= ${min}` : `> ${min}`;
            const maxTxt = maxIncl ? `<= ${effectiveMax}` : `< ${effectiveMax}`;
            errors.push(`[${name}] doit être ${minTxt} et ${maxTxt} (Saisie: ${val}).`);
        } else {
            el.style.border = ''; 
        }
    }

    checkField('productible', 0, 2500, 'Productible spécifique', false, false);
    checkField('degradation', 0, 5, 'Dégradation annuelle', false, true);
    checkField('horizon', 0, 30, "Horizon d'étude", true, true);
    checkField('prod_limite', 0, 2500, 'Productible limite', false, false);
    checkField('pal_t_1', 1, 250, batterieVirtuelleActive() ? "Tarif de rachat du surplus d'énergie stockée" : 'Tarif Vente Surplus', true, true);
    checkField('facture_hiver_bv', 40, 1000, "Facture d'hiver compensée par la batterie virtuelle", true, true);
    checkField('abonnement_bv_kwc', 0.5, 5, "Frais d'abonnement batterie virtuelle", true, true);
    checkField('pal_t_2', 0, 500, 'Tarif Vente (Tranche 2)', true, true);
    checkField('pal_t_3', 0, 500, 'Tarif Vente (Post-Contrat)', true, true);
    checkField('prix_achat_elec', 10, 1000, 'Facture de consommation HP', true, true);
    checkField('capex_simple_val', 0, 3, 'CAPEX simplifié', true, false);
    checkField('opex_wc', 0, 0.2, 'OPEX simplifié', true, false);
    
    checkField('capex_etudes', 0, 50, 'CAPEX Études', true, false);
    checkField('capex_admin', 0, 100, 'CAPEX Admin', true, false);
    checkField('capex_panneaux', 0, 500, 'CAPEX Panneaux', true, false);
    checkField('capex_elec', 0, 500, 'CAPEX Élec', true, false);
    checkField('capex_integration', 0, 500, 'CAPEX Intégration', true, false);
    checkField('capex_vrd', 0, 200, 'CAPEX VRD', true, false);
    checkField('capex_racco', 0, 5000, 'CAPEX Racco', true, false);
    checkField('capex_amo', 0, 200, 'CAPEX AMO', true, false);
    checkField('capex_subvention', 0, 300, 'CAPEX Subvention', true, false);
    checkField('capex_batterie', 0, 300, 'CAPEX Batterie', true, false);
    checkField('opex_connexion', 0, 10, 'OPEX Connexion', true, false);
    checkField('opex_prev', 0, 50, 'OPEX Préventive', true, false);
    checkField('opex_cura', 0, 50, 'OPEX Curative', true, false);
    checkField('opex_loyer', 0, 100, 'OPEX Loyer', true, false);

    checkField('indexation_vente_12', 1, 20, 'Indexation Vente Palier 1', true, true);
    checkField('indexation_vente_3', 0, 3, 'Indexation vente T3', true, true);
    checkField('indexation_achat', 1, 20, 'Indexation facture élec.', true, true);
    checkField('index_opex', 0, 10, 'Indexation OPEX', true, true);
    checkField('ond_10', 0, 100000, 'Coût onduleur an 10', true, false);
    checkField('bat_10', 0, 100000, 'Coût batterie an 10', true, false);
    checkField('ond_20', 0, 100000, 'Coût onduleur an 20', true, false);
    checkField('fp_pct', 0, 50, 'Fonds propres', true, false);
    checkField('taux_dette', 0, 20, "Taux d'intérêt", true, false);
    checkField('maturite_dette', 0, 30, 'Maturité', true, false);
    checkField('taux_actualisation', 0, 10, 'Taux actualisation', true, false);
    checkField('taux_impot', 0, 50, 'Impôt/TVA', true, false);
    checkField('deprec_pct', 0, 100, 'Fraction dépréciation', true, true);

    // Stockage : prix de recharge réseau obligatoire (0,1 à 1000 €/MWh) quand la recharge sur le
    // réseau est activée ; année de remplacement personnalisée comprise dans l'horizon.
    if (champStockageVisible('groupe_prix_recharge_reseau')) {
        const el = document.getElementById('prix_recharge_reseau');
        const v = parseFloat(el?.value);
        const maxRecharge = Math.round(1000 * facteurConv * 100) / 100;
        if (!el || el.value === '' || isNaN(v) || v < 0.1 || v > maxRecharge) {
            isValid = false;
            if (el) el.style.border = '2px solid red';
            errors.push(`[Prix de recharge sur le réseau] obligatoire, doit être >= 0.1 et <= ${maxRecharge} (Saisie: ${el ? el.value || 'vide' : 'vide'}).`);
        } else {
            el.style.border = '';
        }
    }
    if (champStockageVisible('groupe_annee_remplacement')) {
        const el = document.getElementById('remplacement_batterie_annee');
        const horizon = parseInt(document.getElementById('horizon')?.value, 10) || 20;
        const v = parseInt(el?.value, 10);
        if (!el || isNaN(v) || v < 2 || v > Math.max(2, horizon)) {
            isValid = false;
            if (el) el.style.border = '2px solid red';
            errors.push(`[Année de remplacement batterie] doit être comprise entre 2 et ${horizon} (Saisie: ${el ? el.value || 'vide' : 'vide'}).`);
        } else {
            el.style.border = '';
        }
    }

    // CAPEX en « Prix au Wc » / « CAPEX total » : saisie obligatoire et dans ses bornes (sinon le
    // moteur recevrait un CAPEX nul).
    const capexTable = window.ResidentielChiffrage && window.ResidentielChiffrage.Capex;
    if (capexTable && typeof capexTable.erreursCapexSimple === 'function') {
        capexTable.erreursCapexSimple().forEach((message) => {
            isValid = false;
            errors.push(`[Chiffrage CAPEX] ${message}`);
        });
    }

    // Règle 3 : Assainissement du texte (Champs dynamiques)
    document.querySelectorAll('.dynamic-row input[type="text"]').forEach(input => {
        const val = input.value || "";
        const regex = /^[a-zA-Z0-9À-ÿ \-]*$/;
        const spaces = (val.match(/ /g) || []).length;
        const dashes = (val.match(/-/g) || []).length;
        if (!regex.test(val) || spaces > 4 || dashes > 4) {
            isValid = false;
            input.style.border = '2px solid red';
            errors.push(`Champ nominatif invalide ("${val}"). Uniquement lettres, chiffres, max 4 espaces, max 4 tirets (-).`);
        } else {
            input.style.border = '';
        }
    });

    if (!isValid) {
        alert("Validation bloquante (Aucune auto-correction n'est permise) :\n\n" + errors.join("\n"));
    }
    return isValid;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. CALCUL ÉCONOMIQUE FRONT-END (Instantané)
// ─────────────────────────────────────────────────────────────────────────────

function calculateEconomicData(data) {
    const p = {
        pays: data.pays || "France",
        devise: data.devise || "€",
        puissance: data.puissance || 0,
        productible: data.productible || 0,
        degradation: data.degradation / 100.0 || 0,
        taux_auto: data.tauxAuto / 100.0 || 0,
        horizon: data.horizon || 20,
        capex_k: data.capexK || 0,
        opex_k: data.opexK || 0,
        prix_achat_mwh: data.prixAchatMWh || 0,
        ind_vente12: data.indVente12 / 100.0 || 0,
        ind_vente3: data.indVente3 / 100.0 || 0,
        ind_achat: data.indAchat / 100.0 || 0,
        ind_opex: data.indOpex / 100.0 || 0,
        taux_actualisation: data.tauxActualisation / 100.0 || 0,
        taux_impot: data.tauxImpot / 100.0 || 0,
        fp_pct: (data.fpPct !== undefined ? data.fpPct / 100.0 : 0.2),
        use_dette: data.useDette || false,
        taux_dette: (data.tauxDette !== undefined ? data.tauxDette / 100.0 : 0),
        maturite: data.maturite || 0,
        spec_france: data.specFrance || false,
        prod_limite: data.prodLimite || 0,
        type_sys: data.typeSys || "reseau",
        conso_site: data.consoSite || 0,
        taux_couv: data.tauxCouv / 100.0 || 0,
        prix_carb: data.prixCarb || 0,
        conso_ge: data.consoGE || 0,
        index_carb: data.indexCarb / 100.0 || 0,
        pal_t_1: data.palT1 || 0,
        pal_t_2: data.palT2 || 0,
        pal_t_3: data.palT3 || 0,
        vente_surplus: data.venteSurplus !== false,
        // Batterie virtuelle : seulement en autoconsommation partielle sur le réseau (miroir de
        // _extract_params, etude_economique.py).
        batterie_virtuelle: data.batterieVirtuelle === true && data.typeSys !== 'hybride'
            && data.tauxAuto > 0 && data.tauxAuto < 100,
        facture_hiver_bv_mwh: data.factureHiverBV || 0,
        pal_s_1: data.palS1 || 1,
        pal_e_1: data.palE1 || 20,
        ond_10: data.ond10 || 0,
        ond_20: data.ond20 || 0,
        bat_10: data.bat10 || 0,
        use_deprec: data.useDeprec || false,
        deprec_pct: data.deprecPct / 100.0 || 0,
        hn_nbre: data.hn_nbre || 0,
        hn_seuil: data.hn_seuil || 15,
        hn_max: data.hn_max || 300,
        hn_appliquer_net: data.hn_appliquer_net !== undefined ? data.hn_appliquer_net : true,
        check_degrad_prime: data.checkDegradPrime || false,
        stockage: stockageValide(data.stockage),
        prix_recharge_mwh: data.prixRechargeReseau || 0,
        remplacement_mode: data.remplacementBatterieMode || 'auto',
        remplacement_annee: data.remplacementBatterieAnnee
    };

    const is_hybride = p.type_sys === "hybride";
    const capex_k = p.capex_k;
    const use_dette = p.use_dette;

    const apport = use_dette ? capex_k * p.fp_pct : capex_k;
    const emprunt = use_dette ? (capex_k - capex_k * p.fp_pct) : 0.0;

    let annuite = 0.0;
    if (emprunt > 0 && p.taux_dette > 0 && p.maturite > 0) {
        annuite = (emprunt * p.taux_dette) / (1 - Math.pow(1 + p.taux_dette, -p.maturite));
    } else if (emprunt > 0 && p.maturite > 0) {
        annuite = emprunt / p.maturite;
    }

    const dep_annuelle = (p.use_deprec && p.horizon > 0) ? (capex_k * p.deprec_pct) / Math.max(1, p.horizon) : 0.0;

    // Le flux de trésorerie initial (t=0) dépend du point de vue :
    // - Pour le projet (TRI Projet), c'est le CAPEX total.
    // - Pour les fonds propres (TRI FP), c'est l'apport initial.
    const initial_cash_flow = use_dette ? -apport : -capex_k;

    let crd = emprunt, cum_fcf_act = initial_cash_flow, cum_gains_non_act = initial_cash_flow;
    let total_carb_residuel_act = 0.0, total_carb = 0.0, carb_an1 = 0.0;
    // Déficits fiscaux reportés : fonds propres (résultat après intérêts) et projet (avant
    // financement), chacun avec son propre stock. Miroir de _impot_avec_report (etude_economique.py).
    let deficitFp = 0.0, deficitProjet = 0.0;
    const impotAvecReport = (base, deficit) => {
        if (base <= 0) return [0.0, deficit - base];
        const imputation = Math.min(deficit, base);
        return [(base - imputation) * p.taux_impot, deficit - imputation];
    };
    const table = [];

    // Stockage : flux annuels issus du vieillissement de la batterie (état de santé, fin de vie,
    // remplacement). Miroir de EtudeEconomiqueService._build_table (etude_economique.py).
    const sto = (!is_hybride && p.stockage && window.StockageVieillissement) ? p.stockage : null;
    const trajSto = sto ? window.StockageVieillissement.trajectoire(sto, p.horizon, p.degradation, p.remplacement_mode, p.remplacement_annee) : null;
    let facteurProd = 0, tauxDirect = 0, arbitrageActif = false;
    if (sto) {
        const prodAn1Mwh = p.puissance * p.productible / 1000.0;
        // Flux solaires simulés ramenés à la production de l'étude (même principe que le taux
        // d'autoconsommation, appliqué à la production saisie ici).
        facteurProd = prodAn1Mwh / Number(sto.prod_pv_mwh);
        tauxDirect = (Number(sto.e_directe_mwh) || 0) / Number(sto.prod_pv_mwh);
        arbitrageActif = !!sto.restitution_active;
    }

    for (let t = 0; t <= p.horizon; t++) {
        if (t === 0) {
            table.push({
                t: 0, prodMWh: 0.0, rev: 0.0, eco: 0.0, ecoHyb: 0.0, opex: 0.0, ebe: 0.0, 
                dep: 0.0, int: 0.0, rai: 0.0, imp: 0.0, annuite: 0.0, 
                fcf: initial_cash_flow, fcfAct: initial_cash_flow, cumFcfAct: initial_cash_flow, cumGainsNonAct: initial_cash_flow, raiApImp: 0.0,
                impProjet: 0.0, cfProjet: -capex_k,
                autoconsoDirecteMWh: 0.0, autoconsoBatterieMWh: 0.0, sohBatterie: null, serviceBatterie: null,
                arbitrageReseau: 0.0, remplacementBatterie: false
            });
            continue;
        }

        // Application de la dégradation sur le productible brut initial
        const prod_brut_t = p.productible * Math.pow(1 - p.degradation, t - 1);
        
        let n_prix_negatifs = 0;

        if (p.pays === "France" && !is_hybride && p.spec_france && p.hn_appliquer_net) {
            // ÉTAPE 1 : GESTION DE LA FRANCHISE
            n_prix_negatifs = Math.max(0, p.hn_nbre - p.hn_seuil);
        }

        const prod_mwh_brut = (p.puissance * prod_brut_t) / 1000.0;
        let prod_mwh_nette = prod_mwh_brut;

        let eco = 0.0, rev = 0.0, eco_hyb = 0.0;
        let direct_mwh = 0.0, batterie_mwh = 0.0, arbitrage = 0.0;
        const ligneSto = trajSto ? trajSto[t - 1] : null;

        if (is_hybride) {
            const prix_carb_t = p.prix_carb * Math.pow(1 + p.index_carb, t - 1);
            eco_hyb = (p.taux_couv * p.conso_site * p.conso_ge * prix_carb_t) / 1000.0;
            const depense_carb_restante = ((1 - p.taux_couv) * p.conso_site * p.conso_ge * prix_carb_t) / 1000.0;
            total_carb_residuel_act += depense_carb_restante / Math.pow(1 + p.taux_actualisation, t);
            if (t === 1) carb_an1 = depense_carb_restante;
            total_carb += depense_carb_restante;
        } else {
            // ÉTAPE 3 : ISOLATION DU VOLUME INJECTÉ
            let vol_autoconso_mwh, energie_injectee_theorique_mwh;
            if (ligneSto) {
                // Autoconsommation = PV consommé directement (dégradation panneau) + solaire restitué
                // par la batterie (dégradation panneau × état de santé). L'injection retire le solaire
                // CHARGÉ (pertes de la batterie incluses), pas seulement le solaire restitué.
                const prix_achat_t = p.prix_achat_mwh * Math.pow(1 + p.ind_achat, t - 1);
                direct_mwh = prod_mwh_brut * tauxDirect;
                batterie_mwh = ligneSto.e_sol_restit_mwh * facteurProd;
                vol_autoconso_mwh = direct_mwh + batterie_mwh;
                eco = (vol_autoconso_mwh * prix_achat_t) / 1000.0;
                if (arbitrageActif) {
                    // Recharge sur le réseau : énergie restituée valorisée au prix de la facture (HP),
                    // énergie achetée au prix de recharge, tous deux indexés comme la facture.
                    const prix_recharge_t = p.prix_recharge_mwh * Math.pow(1 + p.ind_achat, t - 1);
                    arbitrage = (ligneSto.e_res_restit_mwh * prix_achat_t - ligneSto.e_res_charge_mwh * prix_recharge_t) / 1000.0;
                    eco += arbitrage;
                }
                energie_injectee_theorique_mwh = Math.max(0, prod_mwh_brut - direct_mwh - ligneSto.e_sol_charge_mwh * facteurProd);
            } else {
                vol_autoconso_mwh = prod_mwh_brut * p.taux_auto;
                if (p.taux_auto > 0) {
                    eco = (vol_autoconso_mwh * p.prix_achat_mwh * Math.pow(1 + p.ind_achat, t - 1)) / 1000.0;
                }
                energie_injectee_theorique_mwh = Math.max(0, prod_mwh_brut - vol_autoconso_mwh);
            }
            let energie_injectee_mwh = energie_injectee_theorique_mwh;
            
            if (p.pays === "France" && p.spec_france) {
                const perte_mwh = (p.puissance * n_prix_negatifs) / 1000.0;
                energie_injectee_mwh = Math.max(0, energie_injectee_theorique_mwh - perte_mwh);
            }

            const prod_injecte_heures = p.puissance > 0 ? (energie_injectee_mwh * 1000.0) / p.puissance : 0;

            if (p.spec_france) {
                const tarif1_act = p.pal_t_1 * Math.pow(1 + p.ind_vente12, t - 1);
                const tarif2_act = p.pal_t_2 * Math.pow(1 + p.ind_vente12, t - 1);

                // ÉTAPE 4 : AJUSTEMENT DU PLAFOND ET VENTILATION
                let plafond_ajuste_heures = p.prod_limite;
                if (p.hn_appliquer_net) {
                    plafond_ajuste_heures = p.prod_limite - (n_prix_negatifs * 0.5);
                }

                const energie_tranche_1 = Math.min(energie_injectee_mwh, (plafond_ajuste_heures * p.puissance) / 1000.0);
                const energie_tranche_2 = Math.max(0, energie_injectee_mwh - energie_tranche_1);

                const revenu_tranche_1 = energie_tranche_1 * tarif1_act;
                const revenu_tranche_2 = energie_tranche_2 * tarif2_act;
                
                rev = (revenu_tranche_1 + revenu_tranche_2) / 1000.0;

                // ÉTAPE 5 : CALCUL DE LA PRIME DE COMPENSATION (RÈGLE AOS SESSION 2)
                let prime_comp = 0.0;
                if (p.hn_appliquer_net && p.puissance >= 100) {
                    const borne_sup = Math.max(0, 2 * (p.prod_limite - prod_injecte_heures));
                    const h_compensables = Math.min(n_prix_negatifs, borne_sup);
                    const energie_non_produite_mwh = (h_compensables * p.puissance) / 1000.0;
                    prime_comp = (energie_non_produite_mwh * (tarif1_act * 0.5)) / 1000.0;
                }
                
                if (p.check_degrad_prime) prime_comp *= Math.pow(1 - p.degradation, t - 1);
                rev += prime_comp;

            } else {
                const tarif = t <= 20 ? p.pal_t_1 : p.pal_t_3;
                const ind = t <= 20 ? p.ind_vente12 : p.ind_vente3;
                const tarif_act = tarif * Math.pow(1 + ind, t - 1);
                rev = (energie_injectee_mwh * tarif_act) / 1000.0;
            }
            // Revente du surplus non retenue : l'énergie est injectée sans être valorisée.
            if (!p.vente_surplus) rev = 0.0;
            // Batterie virtuelle : le surplus injecté compense la facture d'hiver (indexée comme la
            // facture d'électricité), diminuée du tarif de rachat du surplus stocké. Ce gain prend
            // la place de la vente du surplus (tranches, prime et post-contrat sans objet).
            if (p.batterie_virtuelle) {
                const facture_hiver_t = p.facture_hiver_bv_mwh * Math.pow(1 + p.ind_achat, t - 1);
                rev = ((facture_hiver_t - p.pal_t_1) * energie_injectee_mwh) / 1000.0;
            }

            prod_mwh_nette = vol_autoconso_mwh + energie_injectee_mwh;
        }

        let opex = p.opex_k * Math.pow(1 + p.ind_opex, t - 1);
        if (t === 11) opex += p.ond_10 + (trajSto ? 0 : p.bat_10);
        // Avec le stockage, le coût batterie tombe l'année de remplacement réelle.
        if (ligneSto && ligneSto.remplacement) opex += p.bat_10;
        if (t === 21 && p.horizon > 20) opex += p.ond_20;

        const ebe = (rev + eco + eco_hyb) - opex;
        const int_val = crd * p.taux_dette;
        const rai = ebe - dep_annuelle - int_val;
        let imp, impProjet;
        [imp, deficitFp] = impotAvecReport(rai, deficitFp);
        // Flux projet (avant financement) : impôt sur le résultat sans les intérêts.
        [impProjet, deficitProjet] = impotAvecReport(ebe - dep_annuelle, deficitProjet);
        const cfProjet = ebe - impProjet;
        const cur_annuite = t <= p.maturite ? annuite : 0.0;
        const fcf = ebe - cur_annuite - imp;
        const fcf_act = fcf / Math.pow(1 + p.taux_actualisation, t);

        cum_fcf_act += fcf_act;
        cum_gains_non_act += fcf;

        table.push({
            t: t, prodMWh: prod_mwh_nette, rev: rev, eco: eco, ecoHyb: eco_hyb,
            opex: opex, ebe: ebe, dep: dep_annuelle, int: int_val, rai: rai,
            imp: imp, annuite: cur_annuite, fcf: fcf, fcfAct: fcf_act,
            cumFcfAct: cum_fcf_act, cumGainsNonAct: cum_gains_non_act,
            raiApImp: rai - imp + dep_annuelle,
            impProjet: impProjet, cfProjet: cfProjet,
            autoconsoDirecteMWh: direct_mwh, autoconsoBatterieMWh: batterie_mwh,
            sohBatterie: ligneSto ? ligneSto.soh_debut * 100 : null,
            serviceBatterie: ligneSto ? ligneSto.fraction_service : null,
            arbitrageReseau: arbitrage, remplacementBatterie: !!(ligneSto && ligneSto.remplacement)
        });

        if (t <= p.maturite) crd -= (cur_annuite - int_val);
    }

    const taux = p.taux_actualisation;
    // Flux projet avant financement, après impôt (t=0 → -capexK) ; flux fonds propres (FCF).
    const cf_prj = table.map(r => r.cfProjet);
    const cf_fp = table.map(r => r.fcf);

    const calcNPV = (r, cfs) => cfs.reduce((acc, v, i) => acc + v / Math.pow(1 + r, i), 0);
    // TRI par dichotomie (bissection) sur la VAN : garantie de converger dès qu'un changement de
    // signe existe sur l'intervalle recherché, NaN sinon (affiché « NA »). Le contrôle côté
    // serveur (etude_economique.py) utilise numpy_financial.irr, qui renvoie la même racine.
    const calcIRR = (cfs) => {
        let lo = -0.99, hi = 10.0;
        let npvLo = calcNPV(lo, cfs), npvHi = calcNPV(hi, cfs);
        if (!isFinite(npvLo) || !isFinite(npvHi) || npvLo * npvHi > 0) {
            return NaN;
        }
        let mid = (lo + hi) / 2;
        for (let i = 0; i < 200; i++) {
            mid = (lo + hi) / 2;
            const npvMid = calcNPV(mid, cfs);
            if (Math.abs(npvMid) < 1e-9 || (hi - lo) < 1e-12) break;
            if ((npvLo < 0) === (npvMid < 0)) { lo = mid; npvLo = npvMid; }
            else { hi = mid; }
        }
        return mid * 100;
    };
    // Payback interpolé dans l'année ; null si jamais atteint sur l'horizon (affiché « NA »).
    const calcPB = (cfs, discounted) => {
        let cum = cfs[0];
        if (cum >= 0) return 0.0;
        for (let i = 1; i < cfs.length; i++) {
            let val = discounted ? cfs[i] / Math.pow(1 + taux, i) : cfs[i];
            if (cum < 0 && cum + val >= 0) return (i - 1) + Math.abs(cum) / val;
            cum += val;
        }
        return null;
    };

    // LCOE : coûts et énergie actualisés tous deux à 1/(1+taux)^t, année 1 comprise.
    let lcoe = 0.0;
    const sum_opex_act = table.slice(1).reduce((acc, r) => acc + r.opex / Math.pow(1 + taux, r.t), 0);
    if (is_hybride) {
        const total_cout_act = (capex_k + sum_opex_act + total_carb_residuel_act) * 1000;
        const total_energie_mwh = table.slice(1).reduce((acc, r) => acc + (p.conso_site / 1000) / Math.pow(1 + taux, r.t), 0);
        lcoe = total_energie_mwh > 0 ? total_cout_act / total_energie_mwh : 0;
    } else {
        const sum_costs_act = (capex_k + sum_opex_act) * 1000;
        const sum_prod_act_mwh = table.slice(1).reduce((acc, r) => acc + r.prodMWh / Math.pow(1 + taux, r.t), 0);
        lcoe = sum_prod_act_mwh > 0 ? sum_costs_act / sum_prod_act_mwh : 0;
    }

    const sum_facture_act = table.slice(1).reduce((acc, r) => acc + (p.prix_achat_mwh * Math.pow(1 + p.ind_achat, r.t - 1)) / Math.pow(1 + taux, r.t), 0);
    const sum_energy_act = table.slice(1).reduce((acc, r) => acc + 1.0 / Math.pow(1 + taux, r.t), 0);
    const lcoe_facture = sum_energy_act > 0 ? sum_facture_act / sum_energy_act : 0;
    const total_opex = table.slice(1).reduce((acc, r) => acc + r.opex, 0);

    return {
        success: true,
        table: table,
        kpis: {
            van: calcNPV(taux, cf_prj),
            triP: calcIRR(cf_prj),
            triFP: calcIRR(cf_fp),
            lcoe: lcoe,
            lcoeFacture: lcoe_facture,
            // Les deux paybacks portent sur les mêmes flux (fonds propres), brut puis actualisé.
            pbBrut: calcPB(cf_fp, false),
            pbAct: calcPB(cf_fp, true),
            gainsCumAct: table[table.length - 1].cumFcfAct,
            gainsNonAct: table[table.length - 1].cumGainsNonAct,
            carbAn1: carb_an1,
            totalCarb: total_carb,
            totalOpex: total_opex
        },
        params: p
    };
}

// CORRECTIF (bug rapporté : "je calcule l'étude économique puis je clique sur Rapport, on me dit
// quand même de calculer l'étude économique d'abord") : le service censé persister les
// indicateurs calculés (services/EconomicDataSaver.js) n'est en réalité jamais chargé par aucun
// template (import mort) — ET ses IDs observés (van_display/tri_display/...) ne correspondent de
// toute façon à AUCUN élément réel de cette page (res_van/res_tri_p/res_tri_fp/res_lcoe) : même
// chargé, il n'aurait jamais rien capté. localStorage.solarProjectData.economicData.indicators
// (lu par ExportService.hasEconomicResultsCalculated(), Condition A du bouton "Rapport") restait
// donc TOUJOURS absent, quel que soit le nombre de calculs lancés. Persistance directe ici, au
// point exact où le calcul aboutit réellement (kpis déjà en mémoire, pas de dépendance à un
// MutationObserver sur le DOM).
function persistEconomicIndicators(kpis) {
    if (!kpis) return;
    try {
        const savedData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
        if (!savedData.economicData) savedData.economicData = {};
        savedData.economicData.indicators = {
            van: kpis.van,
            triP: kpis.triP,
            triFP: kpis.triFP,
            lcoe: kpis.lcoe,
            calculatedAt: new Date().toISOString(),
        };
        localStorage.setItem('solarProjectData', JSON.stringify(savedData));
    } catch (e) {
        console.warn('Impossible de persister les indicateurs économiques calculés :', e);
    }
}

/** Contrôle bloquant : formulaire conforme au calcul ProSolaire enregistré (ReferenceProSolaire.js). */
async function donneesProSolaireConformes() {
    return !window.ReferenceProSolaire || await window.ReferenceProSolaire.controler();
}

async function runSimulation(customInputs = null) {
    // Application de la barrière de validation JS Front
    if (!customInputs && !validateStrictData()) {
        return { success: false, error: "Validation constraints failed" };
    }
    // Puissance, productible, taux d'autoconsommation et parts hiver/été = calcul ProSolaire.
    if (!customInputs && !(await donneesProSolaireConformes())) {
        return { success: false, error: "Écart avec le calcul ProSolaire" };
    }

    const inputs = customInputs || collectInputs();
    const simulerDeux = document.getElementById('simuler_deux_options')?.checked && !customInputs;

    if (simulerDeux) {
        const inputsFP = { ...inputs, useDette: false, fpPct: 100, tauxDette: 0, maturite: 0 };
        const inputsDette = { ...inputs, useDette: true };
        // NOTE : fpPct/tauxDette sont des pourcentages BRUTS (ex. 20, 4) — calculateEconomicData()
        // se charge lui-même de la division par 100 (cf. ses champs p.fp_pct/p.taux_dette). Un
        // "/ 100" ici causait une double conversion (apport fonds propres ~100x trop faible),
        // d'où un TRI fonds propres non calculable (NA) et des gains cumulés faussés, mais
        // uniquement en mode "Simuler les 2 options" (le calcul isolé passe par collectInputs(),
        // qui ne divise jamais par 100, donc n'était pas affecté).
        inputsDette.fpPct = parseFloat(document.getElementById('fp_pct').value) || 20;
        inputsDette.tauxDette = parseFloat(document.getElementById('taux_dette').value) || 4;
        inputsDette.maturite = parseInt(document.getElementById('maturite_dette').value) || 20;

        const resFP = calculateEconomicData(inputsFP);
        const resDette = calculateEconomicData(inputsDette);

        if (resFP.success && resDette.success) {
            displayResults(resDette);
            persistEconomicIndicators(resDette.kpis);

            populateKPIs(resFP.kpis, resFP.params.devise, resFP.params.type_sys === 'hybride', '');
            populateKPIs(resDette.kpis, resDette.params.devise, resDette.params.type_sys === 'hybride', 'dette');

            const toggleBtns = document.getElementById('kpi-toggle-buttons');
            if(toggleBtns) toggleBtns.style.setProperty('display', 'flex', 'important');
            
            const secDette = document.getElementById('section-kpi-dette');
            if(secDette) secDette.style.display = 'block';
            
            const titleFp = document.getElementById('title-kpi-fp');
            if(titleFp) titleFp.textContent = 'Indicateurs financiers clés - Fonds propres uniquement';

            openTab(null, 'Resultats');
            return { resFP, resDette };
        }
    }

    const result = calculateEconomicData(inputs);

    if (result && result.success) {
        if (!customInputs) {
            displayResults(result);
            persistEconomicIndicators(result.kpis);
            const toggleBtns = document.getElementById('kpi-toggle-buttons');
            if(toggleBtns) toggleBtns.style.setProperty('display', 'none', 'important');
            const secDette = document.getElementById('section-kpi-dette');
            if(secDette) secDette.style.display = 'none';
            const titleFp = document.getElementById('title-kpi-fp');
            if(titleFp) titleFp.textContent = 'Indicateurs financiers clés';
            openTab(null, 'Resultats');
        }
        return result;
    }

    return result;
}

// Payback jamais atteint sur l'horizon (null) : « NA » au lieu de « 0.00 ans ».
function formatPayback(val) {
    return (val === null || val === undefined || isNaN(val)) ? 'NA' : val.toFixed(2) + ' ans';
}

function populateKPIs(kpis, devise, isHybride, suffix) {
    const s = suffix ? `_${suffix}` : '';
    const el = (id) => document.getElementById(id + (suffix ? `_${suffix}` : ''));

    const formatIRR = (val) => (isNaN(val) || val > 500 || val < -500) ? 'NA' : val.toFixed(2) + '%';

    if(el('res_van')) el('res_van').textContent = kpis.van.toFixed(2) + ' k' + devise;
    if(el('res_tri_p')) el('res_tri_p').textContent = formatIRR(kpis.triP);
    if(el('res_tri_fp')) el('res_tri_fp').textContent = formatIRR(kpis.triFP);
    if(el('res_lcoe')) el('res_lcoe').textContent = kpis.lcoe.toFixed(2);
    if(el('res_total_opex')) el('res_total_opex').textContent = (kpis.totalOpex || 0).toFixed(2) + ' k' + devise;

    const lcoeFactureEl = el('res_lcoe_facture');
    const cardLcoeFacture = el('card_lcoe_facture');
    if (lcoeFactureEl && cardLcoeFacture) {
        lcoeFactureEl.textContent = (kpis.lcoeFacture || 0).toFixed(2);
        const tauxAuto = parseFloat(document.getElementById('taux_autoconsommation').value) || 0;
        // CORRECTIF (point 7 : indicateurs clés en tableau) : #card_lcoe_facture est désormais une
        // <tr> (cf. etudes_economique_content.html) — 'flex' casserait sa mise en page de ligne de
        // tableau ; '' revient à l'affichage par défaut (table-row).
        cardLcoeFacture.style.display = tauxAuto > 0 ? '' : 'none';
    }

    if(el('res_pb_brut')) el('res_pb_brut').textContent = formatPayback(kpis.pbBrut);
    if(el('res_pb_act')) el('res_pb_act').textContent = formatPayback(kpis.pbAct);
    if(el('res_gains_act_final')) el('res_gains_act_final').textContent = kpis.gainsCumAct.toFixed(2) + ' k' + devise;
    if(el('res_gains_non_act')) el('res_gains_non_act').textContent = kpis.gainsNonAct.toFixed(2) + ' k' + devise;

    const carbAn1El = el('res_carb_an1');
    const carbTotEl = el('res_carb_total');
    if (carbAn1El) carbAn1El.textContent = (kpis.carbAn1 || 0).toFixed(2) + ' k' + devise;
    if (carbTotEl) carbTotEl.textContent = (kpis.totalCarb || 0).toFixed(2) + ' k' + devise;
    
    const hybrideRes = document.querySelectorAll(suffix ? `.hybride-res-dette` : `.hybride-res`);
    // CORRECTIF (point 7 : indicateurs clés en tableau) : ces éléments sont désormais des <tr> —
    // '' (au lieu de 'block') revient à l'affichage par défaut (table-row).
    hybrideRes.forEach(e => e.style.display = isHybride ? '' : 'none');
}


// ─────────────────────────────────────────────────────────────────────────────
// 3. AFFICHAGE DES RÉSULTATS
// ─────────────────────────────────────────────────────────────────────────────

function displayResults(result) {
    const table = result.table;
    const kpis = result.kpis;
    const params = result.params;
    const devise = params.devise || '€';
    const isHybride = params.type_sys === 'hybride';

    // Visibilité sections hybrides — CORRECTIF (point 7 : indicateurs clés en tableau) : ces
    // éléments sont désormais des <tr> — '' (au lieu de 'block') revient à l'affichage par défaut.
    document.querySelectorAll('.hybride-res').forEach(el => {
        el.style.display = isHybride ? '' : 'none';
    });

    // ── Tableau annuel des flux ──────────────────────────────────────────────
    const avecStockage = !isHybride && !!params.stockage;
    const avecArbitrage = avecStockage && !!params.stockage.restitution_active;
    const thStockage = avecStockage
        ? `<th title="PV consommé directement sur site">Autoconso directe (MWh)</th>
           <th title="Solaire restitué par la batterie, perte de capacité incluse">Autoconso batterie (MWh)</th>
           <th title="État de santé de la batterie en début d'année (↻ = remplacement)">SoH batterie (%)</th>
           ${avecArbitrage ? '<th title="Énergie réseau restituée × prix facture − énergie rechargée × prix de recharge">Arbitrage réseau (k€)</th>' : ''}`
        : '';
    const thead = document.getElementById('results-thead');
    thead.innerHTML = `<tr>
            <th>Année</th>
            <th>Prod (MWh)</th>
            ${thStockage}
            ${isHybride
            ? '<th>Éco Carb (k€)</th><th>Éco Nette PV (k€)</th>'
            : `${params.batterie_virtuelle
                ? '<th title="(Facture d’hiver compensée indexée − tarif de rachat du surplus stocké) × production injectée">Gain batterie virtuelle (k€)</th>'
                : '<th>Rev (k€)</th>'}<th>Éco (k€)</th>`}
            <th>Opex (k€)</th>
            <th>EBE (k€)</th>
            <th>Dépréc. (k€)</th>
            <th>Intérêt (k€)</th>
            <th>Rés. ap. imp. (k€)</th>
            <th>Annuité (k€)</th>
            <th>FCF (k€)</th>
            <th>FCF Act (k€)</th>
            <th>Cum FCF Act (k€)</th>
        </tr>`;

    const tbody = document.getElementById('results-tbody');
    tbody.innerHTML = '';

    // Initialisation des totaux
    let tot_prod = 0, tot_rev = 0, tot_eco = 0, tot_ecoHyb = 0, tot_ecoNettePV = 0;
    let tot_opex = 0, tot_ebe = 0, tot_dep = 0, tot_int = 0, tot_raiApImp = 0;
    let tot_annuite = 0, tot_fcf = 0, tot_fcfAct = 0;
    let tot_direct = 0, tot_batterie = 0, tot_arbitrage = 0;

    table.forEach(r => {
        const ecoNettePV = isHybride ? (r.ecoHyb - r.opex) : 0;

        // Cumul des colonnes
        tot_prod += r.prodMWh;
        tot_rev += r.rev;
        tot_eco += r.eco;
        tot_ecoHyb += r.ecoHyb;
        tot_ecoNettePV += ecoNettePV;
        tot_opex += r.opex;
        tot_ebe += r.ebe;
        tot_dep += r.dep;
        tot_int += r.int;
        tot_raiApImp += (r.raiApImp ?? (r.rai - r.imp + r.dep));
        tot_annuite += r.annuite;
        tot_fcf += r.fcf;
        tot_fcfAct += r.fcfAct;
        tot_direct += r.autoconsoDirecteMWh || 0;
        tot_batterie += r.autoconsoBatterieMWh || 0;
        tot_arbitrage += r.arbitrageReseau || 0;

        let tdStockage = '';
        if (avecStockage) {
            let soh = '-';
            if (r.t > 0 && r.sohBatterie !== null && r.sohBatterie !== undefined) {
                soh = r.serviceBatterie > 0 ? r.sohBatterie.toFixed(1) : 'Fin de vie';
                if (r.remplacementBatterie) soh = '↻ ' + soh;
            }
            tdStockage = `<td>${(r.autoconsoDirecteMWh || 0).toFixed(2)}</td>
                <td>${(r.autoconsoBatterieMWh || 0).toFixed(2)}</td>
                <td>${soh}</td>
                ${avecArbitrage ? `<td>${(r.arbitrageReseau || 0).toFixed(2)}</td>` : ''}`;
        }

        tbody.innerHTML += `<tr>
                <td>${r.t}</td>
                <td>${r.prodMWh.toFixed(2)}</td>
                ${tdStockage}
                ${isHybride
                ? `<td>${r.ecoHyb.toFixed(2)}</td><td>${ecoNettePV.toFixed(2)}</td>`
                : `<td>${r.rev.toFixed(2)}</td><td>${r.eco.toFixed(2)}</td>`}
                <td>${r.opex.toFixed(2)}</td>
                <td>${r.ebe.toFixed(2)}</td>
                <td>${r.dep.toFixed(2)}</td>
                <td>${r.int.toFixed(2)}</td>
                <td>${(r.raiApImp ?? (r.rai - r.imp + r.dep)).toFixed(2)}</td>
                <td>${r.annuite.toFixed(2)}</td>
                <td>${r.fcf.toFixed(2)}</td>
                <td>${r.fcfAct.toFixed(2)}</td>
                <td>${r.cumFcfAct.toFixed(2)}</td>
            </tr>`;
    });

    // ── Remplissage du pied de page (Totaux) ─────────────────────────────────
    const tfoot = document.getElementById('results-tfoot');
    if (tfoot) {
        tfoot.innerHTML = `<tr>
                <th>Total</th>
                <th>${tot_prod.toFixed(2)}</th>
                ${avecStockage ? `<th>${tot_direct.toFixed(2)}</th><th>${tot_batterie.toFixed(2)}</th><th>-</th>${avecArbitrage ? `<th>${tot_arbitrage.toFixed(2)}</th>` : ''}` : ''}
                ${isHybride
                ? `<th>${tot_ecoHyb.toFixed(2)}</th><th>${tot_ecoNettePV.toFixed(2)}</th>`
                : `<th>${tot_rev.toFixed(2)}</th><th>${tot_eco.toFixed(2)}</th>`}
                <th>${tot_opex.toFixed(2)}</th>
                <th>${tot_ebe.toFixed(2)}</th>
                <th>${tot_dep.toFixed(2)}</th>
                <th>${tot_int.toFixed(2)}</th>
                <th>${tot_raiApImp.toFixed(2)}</th>
                <th>${tot_annuite.toFixed(2)}</th>
                <th>${tot_fcf.toFixed(2)}</th>
                <th>${tot_fcfAct.toFixed(2)}</th>
                <th>-</th>
            </tr>`;
    }

    // ── KPIs financiers ──────────────────────────────────────────────────────
    const formatIRR = (val) => (isNaN(val) || val > 500 || val < -500) ? 'NA' : val.toFixed(2) + '%';

    document.getElementById('res_van').textContent = kpis.van.toFixed(2) + ' k' + devise;
    document.getElementById('res_tri_p').textContent = formatIRR(kpis.triP);
    document.getElementById('res_tri_fp').textContent = formatIRR(kpis.triFP);
    document.getElementById('res_lcoe').textContent = kpis.lcoe.toFixed(2);

    const resTotalOpex = document.getElementById('res_total_opex');
    if (resTotalOpex) resTotalOpex.textContent = (kpis.totalOpex || 0).toFixed(2) + ' k' + devise;

    const lcoeFactureEl = document.getElementById('res_lcoe_facture');
    const cardLcoeFacture = document.getElementById('card_lcoe_facture');
    if (lcoeFactureEl && cardLcoeFacture) {
        lcoeFactureEl.textContent = (kpis.lcoeFacture || 0).toFixed(2);
        const tauxAuto = parseFloat(document.getElementById('taux_autoconsommation').value) || 0;
        // CORRECTIF (point 7 : indicateurs clés en tableau) : #card_lcoe_facture est désormais une
        // <tr> (cf. etudes_economique_content.html) — 'flex' casserait sa mise en page de ligne de
        // tableau ; '' revient à l'affichage par défaut (table-row).
        cardLcoeFacture.style.display = tauxAuto > 0 ? '' : 'none';
    }

    document.getElementById('res_pb_brut').textContent = formatPayback(kpis.pbBrut);
    document.getElementById('res_pb_act').textContent = formatPayback(kpis.pbAct);
    document.getElementById('res_gains_act_final').textContent = kpis.gainsCumAct.toFixed(2) + ' k' + devise;
    document.getElementById('res_gains_non_act').textContent = kpis.gainsNonAct.toFixed(2) + ' k' + devise;

    // Hybride seulement
    const carbAn1El = document.getElementById('res_carb_an1');
    const carbTotEl = document.getElementById('res_carb_total');
    if (carbAn1El) carbAn1El.textContent = kpis.carbAn1.toFixed(2) + ' k' + devise;
    if (carbTotEl) carbTotEl.textContent = kpis.totalCarb.toFixed(2) + ' k' + devise;

    // ── Graphiques (Rendus en direct avec Chart.js) ─────────────────────────
    renderCharts(result);

    // Remis à '' par remettreResultatsEcoAZero() à la prochaine saisie.
    const resultatsEl = document.getElementById('Resultats');
    if (resultatsEl) resultatsEl.dataset.resultatsCalcules = 'oui';
}

function calculatePaybackHybride(table, capex) {
    let cum = -capex;
    for (let i = 1; i < table.length; i++) {
        // ACTUALISATION : Économie brute - Opex PV (qui est r.opex dans votre code)
        // On divise par le facteur d'actualisation pour être rigoureux
        let tauxActualisation = parseFloat(document.getElementById('taux_actualisation').value) / 100;
        let ecoNette = table[i].ecoHyb - table[i].opex;
        let ecoNetteAct = ecoNette / Math.pow(1 + tauxActualisation, i);

        if (cum < 0 && cum + ecoNetteAct >= 0) {
            return i - 1 + (Math.abs(cum) / ecoNetteAct);
        }
        cum += ecoNetteAct;
    }
    return 0; // Si l'investissement n'est jamais rentabilisé
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. AFFICHAGE DES GRAPHIQUES (Chart.js)
// ─────────────────────────────────────────────────────────────────────────────

function renderCharts(result) {
    const ids = ['cumFlowChart', 'factureChart', 'fcfActChart'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        // Force <canvas> s'il avait été changé en <img>
        if (el.tagName === 'IMG') {
            const canvas = document.createElement('canvas');
            canvas.id = id;
            canvas.style.cssText = 'width:100%; max-width:100%; display:block;';
            el.parentNode.replaceChild(canvas, el);
        }
    });

    const table = result.table;
    const devise = result.params.devise;
    const isHybride = result.params.type_sys === 'hybride';
    const labels = table.map(r => r.t);
    const p = result.params;

    if (document.getElementById('cumFlowChart')) {
        if (chartInstances['cumFlowChart']) chartInstances['cumFlowChart'].destroy();
        // FCF fonds propres cumulé non actualisé : passe à 0 au payback brut, finit au gain non actualisé.
        const cumFlowData = table.map(r => r.cumGainsNonAct);

        chartInstances['cumFlowChart'] = new Chart(document.getElementById('cumFlowChart').getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{ label: `FCF cumulé fonds propres (k${devise})`, data: cumFlowData, backgroundColor: '#FFC107' }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, datalabels: { display: false } } }
        });
    }

    if (document.getElementById('factureChart')) {
        if (chartInstances['factureChart']) chartInstances['factureChart'].destroy();
        const labelsFrom1 = labels.slice(1);
        let ecoData = [], depData = [];
        table.slice(1).forEach(r => {
            if (isHybride) {
                ecoData.push(r.ecoHyb);
                depData.push((p.conso_site * p.conso_ge * p.prix_carb) / 1000.0);
            } else {
                ecoData.push(r.eco + r.rev);
                depData.push((r.prodMWh * p.prix_achat_mwh * Math.pow(1 + p.ind_achat, r.t - 1)) / 1000.0);
            }
        });

        chartInstances['factureChart'] = new Chart(document.getElementById('factureChart').getContext('2d'), {
            type: 'bar',
            data: {
                labels: labelsFrom1,
                datasets: [
                    { label: `Facture d'électricité avec PV (k${devise})`, data: ecoData, backgroundColor: '#FF8C00' },
                    { label: `Facture d'électricité sans PV (k${devise})`, data: depData, backgroundColor: '#005A9E' }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, datalabels: { display: false } } }
        });
    }

    if (document.getElementById('fcfActChart')) {
        if (chartInstances['fcfActChart']) chartInstances['fcfActChart'].destroy();
        const fcfData = table.map(r => r.cumFcfAct);
        chartInstances['fcfActChart'] = new Chart(document.getElementById('fcfActChart').getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{ label: `Cumul FCF Actualisé (k${devise})`, data: fcfData, borderColor: '#005A9E', backgroundColor: 'rgba(0, 90, 158, 0.1)', fill: true, tension: 0.1 }]
            },
            options: {
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { legend: { position: 'top' }, datalabels: { display: false } },
                scales: {
                    y: {
                        // Assure que l'axe Y peut commencer en négatif et s'adapte aux données
                        beginAtZero: false 
                    }
                }
            }
        });
    }
}


function exportCSV() {
    let csv = "Annee;Prod_MWh;EBE_kE;FCF_kE;CumFCFAct_kE\n";
    document.querySelectorAll("#results-tbody tr").forEach(tr => {
        csv += Array.from(tr.cells).map(td => td.innerText).join(";") + "\n";
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'simulation_pv.csv'; a.click();
}


// ─────────────────────────────────────────────────────────────────────────────
// VÉRIFICATION FRONTEND VS BACKEND AVANT EXPORT
// ─────────────────────────────────────────────────────────────────────────────

async function verifyWithBackend() {
    try {
        const inputs = collectInputs();
        const simulerDeux = document.getElementById('simuler_deux_options')?.checked;

        const checkDOM = (calcData, isDette) => {
            if (!calcData || !calcData.success) return false;
            const suffix = isDette ? '_dette' : '';
            
            // Extraction robuste : ignore les espaces, les lettres et gère les virgules
            const getDomValue = (id) => {
                const el = document.getElementById(id);
                if (!el) return null;
                let text = el.innerText || el.textContent || "0";
                if (text.trim() === "NA") return "NA";
                text = text.replace(/[\s\u202F\u00A0]/g, '').replace(',', '.');
                const match = text.match(/-?\d+(\.\d+)?/);
                return match ? parseFloat(match[0]) : null;
            };

            const vanDom = getDomValue('res_van' + suffix);
            const triDom = getDomValue('res_tri_p' + suffix);

            if (vanDom === null || (triDom === null && triDom !== "NA")) return false;

            const vanCalc = parseFloat(calcData.kpis.van);
            const triCalc = parseFloat(calcData.kpis.triP);

            const tol = 2.0; 
            if (isNaN(vanDom) || isNaN(vanCalc) || Math.abs(vanDom - vanCalc) > tol) {
                console.error(`⚠️ Falsification détectée (VAN) ! Affiché: ${vanDom}, Calcul réel: ${vanCalc}`);
                return false;
            }
            if (triDom === "NA") {
                if (!isNaN(triCalc) && triCalc <= 500 && triCalc >= -500) {
                    console.error(`⚠️ Falsification détectée (TRI) ! Affiché: NA, Calcul réel: ${triCalc}`);
                    return false;
                }
            } else {
                if (isNaN(triDom) || isNaN(triCalc) || Math.abs(triDom - triCalc) > tol) {
                    console.error(`⚠️ Falsification détectée (TRI) ! Affiché: ${triDom}, Calcul réel: ${triCalc}`);
                    return false;
                }
            }
            return true;
        };

        if (simulerDeux) {
            // Même correction d'unités que dans runSimulation() : fpPct/tauxDette bruts (pas de
            // "/ 100" ici, calculateEconomicData() le fait déjà), et fpPct=100 (pas 1) pour bien
            // représenter "100% fonds propres" comme son équivalent dans runSimulation().
            const inputsFP = { ...inputs, useDette: false, fpPct: 100, tauxDette: 0, maturite: 0 };
            const inputsDette = { ...inputs, useDette: true };
            inputsDette.fpPct = parseFloat(document.getElementById('fp_pct').value) || 20;
            inputsDette.tauxDette = parseFloat(document.getElementById('taux_dette').value) || 4;
            inputsDette.maturite = parseInt(document.getElementById('maturite_dette').value) || 20;

            const calcFP = calculateEconomicData(inputsFP);
            const calcDette = calculateEconomicData(inputsDette);

            return checkDOM(calcFP, false) && checkDOM(calcDette, true);
        } else {
            const calcRes = calculateEconomicData(inputs);
            return checkDOM(calcRes, false);
        }
    } catch (e) {
        console.error("Erreur de validation de sécurité:", e);
        return false;
    }
}

async function verifyAndExportPDF(btn) {
    // UX : Indiquer que la vérification est en cours
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Vérification...';
    btn.disabled = true;

    if (!(await donneesProSolaireConformes())) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
    }
    const isValid = await verifyWithBackend();
    
    // Rétablir le bouton
    btn.innerHTML = originalText;
    btn.disabled = false;

    // DÉSACTIVATION DE LA SÉCURITÉ : L'export se fait même si les données sont modifiées
    // if (isValid) {
    //     // Tout correspond, on génère le rapport
    exportPDF();
    // } else {
    //     // Échec de la sécurité
    //     alert("⚠️ Sécurité : Incohérence détectée entre les calculs d'affichage et le serveur Python.\n\nLa génération du rapport a été bloquée pour garantir l'exactitude des données financières. Veuillez vérifier vos saisies ou rafraîchir la page.");
    // }
}


// ─────────────────────────────────────────────────────────────────────────────
// ECO VERIF (BOUTON PROVISOIRE) — COMPARAISON JS (FRONT) VS PYTHON (BACKEND)
// ─────────────────────────────────────────────────────────────────────────────

function _ecoVerifBuildScenarios(inputs) {
    const simulerDeux = document.getElementById('simuler_deux_options')?.checked;
    if (simulerDeux) {
        // NB : contrairement à runSimulation(), pas besoin de forcer fpPct=100 pour le scénario
        // "Fonds propres uniquement" : côté JS (calculateEconomicData) comme côté Python
        // (_build_table), fp_pct est ignoré dès que useDette=false (apport = capexK dans les
        // deux cas). Envoyer le fpPct réel évite en plus de dépasser la borne stricte du
        // backend (fpPct < 50, cf. _validate_strict).
        return [
            { label: 'Fonds propres uniquement', inputs: { ...inputs, useDette: false } },
            { label: 'Fonds propres + Dette', inputs: { ...inputs, useDette: true } },
        ];
    }
    return [{
        label: inputs.useDette ? 'Fonds propres + Dette' : 'Fonds propres uniquement',
        inputs,
    }];
}

async function _ecoVerifCallBackend(inputs) {
    // Projet transmis : le serveur refuse le calcul si puissance, productible ou taux
    // d'autoconsommation diffèrent du calcul ProSolaire enregistré.
    const projetId = projetDesSaisiesEco();
    const response = await fetch('/concevoir_mon_projet/api/etude-economique', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projetId ? { ...inputs, projetId } : inputs),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.message || 'Réponse invalide du serveur.');
    }
    return data;
}

function _ecoVerifFormatVal(v) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return 'NA';
    return Number(v).toFixed(2);
}

function _ecoVerifRenderScenario(scenario, jsKpis, pyKpis) {
    const rows = [
        ['VAN (k€)', 'van'],
        ['TRI Projet (%)', 'triP'],
        ['TRI Fonds Propres (%)', 'triFP'],
        ['Payback brut (ans)', 'pbBrut'],
        ['Payback actualisé (ans)', 'pbAct'],
        ['Gains cumulés actualisés (k€)', 'gainsCumAct'],
        ['Gains nets non actualisés (k€)', 'gainsNonAct'],
        ['LCOE (€/MWh)', 'lcoe'],
    ];
    let html = `<h4 style="margin:10px 0 5px;">${scenario.label}</h4>
        <table style="width:100%; border-collapse:collapse;">
            <thead><tr>
                <th style="text-align:left; padding:4px;">Indicateur</th>
                <th style="text-align:right; padding:4px;">JS (front)</th>
                <th style="text-align:right; padding:4px;">Python (backend)</th>
                <th style="text-align:right; padding:4px;">Écart</th>
            </tr></thead><tbody>`;
    rows.forEach(([label, key]) => {
        const jsV = jsKpis ? jsKpis[key] : null;
        const pyV = pyKpis ? pyKpis[key] : null;
        const jsNum = Number(jsV), pyNum = Number(pyV);
        const bothFinite = Number.isFinite(jsNum) && Number.isFinite(pyNum);
        const ecart = bothFinite ? Math.abs(jsNum - pyNum) : null;
        const color = ecart === null ? '#92400e' : (ecart > 1 ? '#dc2626' : '#16a34a');
        html += `<tr>
            <td style="padding:4px;">${label}</td>
            <td style="text-align:right; padding:4px;">${_ecoVerifFormatVal(jsV)}</td>
            <td style="text-align:right; padding:4px;">${_ecoVerifFormatVal(pyV)}</td>
            <td style="text-align:right; padding:4px; color:${color};">${ecart === null ? '—' : ecart.toFixed(2)}</td>
        </tr>`;
    });
    html += '</tbody></table>';
    return html;
}

async function runEcoVerif(btn) {
    const panel = document.getElementById('eco-verif-panel');
    if (!panel) return;

    const originalText = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = 'Vérification...'; btn.disabled = true; }
    panel.style.display = 'block';
    panel.innerHTML = '<em>Calcul en cours…</em>';

    try {
        const inputs = collectInputs();
        const scenarios = _ecoVerifBuildScenarios(inputs);

        let html = `<div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>Eco verif — comparaison JS (front) vs Python (backend)</strong>
            <span id="eco-verif-close" style="cursor:pointer; font-weight:bold;">✕</span>
        </div>`;

        for (const scenario of scenarios) {
            const jsRes = calculateEconomicData(scenario.inputs);
            const pyRes = await _ecoVerifCallBackend(scenario.inputs);
            html += _ecoVerifRenderScenario(scenario, jsRes && jsRes.kpis, pyRes && pyRes.kpis);
        }

        panel.innerHTML = html;
        const closeBtn = document.getElementById('eco-verif-close');
        if (closeBtn) closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
    } catch (err) {
        panel.innerHTML = `<strong style="color:#dc2626;">Erreur</strong><div>${err.message}</div>`;
    } finally {
        if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
    }
}

window.runEcoVerif = runEcoVerif;

// Fonction utilitaire PDF, doit être placé avant la fonction export PDF
/* =========================
  UTILITAIRES EXPORT PDF
========================= */

// Récupère la valeur d'un champ par ID
function val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

// Ajoute un titre de page
function addPageTitle(doc, text, y = 20) {
    doc.setFontSize(18);
    doc.text(text, 15, y);
}

// FONCTION DE SÉCURITÉ : Vérifie si le titre ET le tableau tiennent sur la page
function checkSpace(doc, yNeeded) {
    const pageHeight = doc.internal.pageSize.height;
    const currentY = doc.lastAutoTable ? doc.lastAutoTable.finalY : 35;

    if (currentY + yNeeded > pageHeight - 15) {
        doc.addPage();
        return 20;
    }
    return currentY + 12;
}

// Style commun des tableaux
const tableStyle = {
    styles: {
        fontSize: 10,
        halign: 'center',
        valign: 'middle',
        cellPadding: 3
    },
    headStyles: {
        fillColor: [240, 240, 240],
        textColor: [0, 0, 0],
        halign: 'center',
        fontStyle: 'bold'
    },
    columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' } },
    theme: 'grid',
    margin: { left: 15, right: 15 },
    pageBreak: 'avoid'
};


// ─────────────────────────────────────────────────────────────────────────────
// UTILITAIRE — Récupère la data-URL d'un graphique (canvas OU img)
// ─────────────────────────────────────────────────────────────────────────────

function getChartImageData(id) {
    const el = document.getElementById(id);
    if (!el) return null;

    // Cas 1 : ancienne version Chart.js → <canvas>
    if (el.tagName === 'CANVAS') {
        return el.toDataURL('image/png', 1.0);
    }

    // Cas 2 : nouvelle version Python/matplotlib → <img src="data:image/png;base64,...">
    if (el.tagName === 'IMG' && el.src && el.src.startsWith('data:image')) {
        return el.src;
    }

    // Cas 3 : <img> avec URL relative (ex: /static/...png) → on la retourne telle quelle
    // jsPDF accepte les URLs mais préfère les data-URL ; on tente quand même
    if (el.tagName === 'IMG' && el.src) {
        return el.src;
    }

    return null;
}

/** Lignes du tableau de facturation des rapports PDF quand la batterie virtuelle est retenue. */
function lignesBatterieVirtuellePdf() {
    if (!batterieVirtuelleActive()) return [];
    const dev = document.querySelector('input[name="devise"]:checked')?.value || '€';
    return [
        ["Valorisation du surplus", "Batterie virtuelle"],
        [`Facture d'hiver compensée par la batterie virtuelle (${dev}/MWh)`, val('facture_hiver_bv') || "0"],
        [`Tarif de rachat du surplus d'énergie stockée (${dev}/MWh)`, val('pal_t_1') || "0"],
        [`Frais d'abonnement batterie virtuelle (${dev}/kWc/an)`, val('abonnement_bv_kwc') || "0"]
    ];
}
window.lignesBatterieVirtuellePdf = lignesBatterieVirtuellePdf;

function exportPDF() {
    const convState = getConversionDeviseState();
    if (convState.active && !convState.valid) {
        showCustomValidationModal(convState.error || 'Taux de conversion invalide (0 < taux < 1000).');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');

    // ── PAGE 1 : INFORMATIONS PROJET ────────────────────────────────────────
    addPageTitle(doc, "Informations projet");
    doc.setFontSize(11);

    const nomProjet = getNomProjetCourantEco();
    const dev = document.querySelector('input[name="devise"]:checked')?.value || '€';
    const typeProjet = val('type_projet');
    const typeSysteme = document.querySelector('input[name="type_systeme"]:checked').nextSibling.textContent.trim();
    const pays = val('pays') === 'Autre' ? val('pays_autre') : val('pays');
    const puissance = val('puissance');
    const productible = val('productible');
    const tauxAuto = val('taux_autoconsommation');

    let y = 32;
    if (nomProjet) {
        doc.setFont(undefined, 'bold');
        doc.text(`Nom du projet : ${nomProjet}`, 15, y);
        doc.setFont(undefined, 'normal');
        y += 8;
    }
    const deviseLine = (convState.active && convState.valid && convState.inlineText)
        ? `Devise : ${dev} ${convState.inlineText} — Taux de conversion : 1${convState.from}=${convState.rate} ${convState.to}`
        : `Devise : ${dev}`;
    doc.text(deviseLine, 15, y);
    y += 8;

    doc.text(
        `C'est un projet de type "${typeProjet}" photovoltaïque et de système "${typeSysteme}". \nLe projet est localisé en "${pays}".`,
        15, y, { maxWidth: 180 }
    );
    y += 20;
    doc.text(
        `La puissance installée du projet est de ${puissance} kWc.\nLe productible spécifique année 1 est de ${productible} kWh/kWc/an.\nLe taux d'autoconsommation est de ${tauxAuto} %.`,
        15, y, { maxWidth: 180 }
    );

    // ── PAGE 2 : RÉSULTATS ──────────────────────────────────────────────────
    doc.addPage('a4', 'p');
    addPageTitle(doc, "Résultats");
    doc.setFontSize(11);
    doc.text(`La modélisation financière du projet est réalisée sur une durée de ${val('horizon')} ans.`, 15, 30);

    // 1. CAPEX
    let yCapex = 40;
    doc.text("Tableau du CAPEX (Coûts d'investissement)", 15, yCapex);
    const capexMode = document.querySelector('input[name="capex_mode_select"]:checked').value;
    const capexRows = [];
    const capexDevis = window.ResidentielChiffrage && window.ResidentielChiffrage.Capex;
    const capexSimple = capexDevis && typeof capexDevis.getCapexSimple === 'function' ? capexDevis.getCapexSimple() : null;
    if (capexSimple && (capexSimple.mode === 'wc' || capexSimple.mode === 'fixe') && typeof capexDevis.isProActive === 'function' && capexDevis.isProActive()) {
        // PRO, mode simplifié : une ligne (prix au Wc x puissance, ou CAPEX total saisi), en k€ HT.
        const devPdf = document.querySelector('input[name="devise"]:checked')?.value || '€';
        capexRows.push([capexSimple.mode === 'wc'
            ? `CAPEX au prix de ${capexSimple.prixWc} ${devPdf}/Wc HT`
            : 'CAPEX total (forfait HT)', (capexSimple.capexK || 0).toFixed(2)]);
        const typeSystemeSimple = document.querySelector('input[name="type_systeme"]:checked');
        if (typeSystemeSimple && typeSystemeSimple.value === 'hybride') {
            capexRows.push(['Groupe électrogène', (parseFloat(document.getElementById('cap_ge').value) || 0).toFixed(2)]);
        }
        capexRows.push(["Total HT", document.getElementById('total_capex_display').textContent]);
    } else if (capexDevis && typeof capexDevis.isProActive === 'function' && capexDevis.isProActive()) {
        // PRO : un poste du devis par ligne, en k€ HT (lignes masquées exclues, aides déduites).
        capexDevis.getData().postes.forEach((poste) => {
            const totalHt = capexDevis.getPosteTotals(poste).totalHt;
            if (!totalHt) return;
            capexRows.push([poste.label, ((poste.deduction ? -totalHt : totalHt) / 1000).toFixed(2)]);
        });
        const typeSysteme = document.querySelector('input[name="type_systeme"]:checked');
        if (typeSysteme && typeSysteme.value === 'hybride') {
            capexRows.push(['Groupe électrogène', (parseFloat(document.getElementById('cap_ge').value) || 0).toFixed(2)]);
        }
        capexRows.push(["Total HT", document.getElementById('total_capex_display').textContent]);
    } else if (capexMode === 'detaille') {
        document.querySelectorAll('.capex-in').forEach(i => {
            capexRows.push([i.parentElement.querySelector('label').innerText, i.value]);
        });
        capexRows.push(["Total", document.getElementById('total_capex_display').textContent]);
    } else {
        capexRows.push(
            ["Total CAPEX", document.getElementById('total_capex_display').textContent],
            ["Ratio €/Wc", document.getElementById('ratio_capex_display').textContent]
        );
    }
    doc.autoTable({ startY: yCapex + 5, head: [["Désignation", "Montant (k€)"]], body: capexRows, ...tableStyle });

    // 2. OPEX
    let yOpex = checkSpace(doc, 60);
    doc.text("Tableau des OPEX (Charges d'exploitations)", 15, yOpex);
    const opexRows = [];
    if (document.querySelector('input[name="opex_mode_select"]:checked').value === 'detaille') {
        document.querySelectorAll('.opex-in').forEach(i => {
            opexRows.push([i.parentElement.querySelector('label').innerText, i.value]);
        });
        opexRows.push(["Total", document.getElementById('total_opex_display').textContent]);
    } else {
        opexRows.push(
            ["Total OPEX", document.getElementById('total_opex_display').textContent],
            ["Ratio €/Wc/an", document.getElementById('ratio_opex_display').textContent]
        );
    }
    doc.autoTable({ startY: yOpex + 5, head: [["Désignation", "Montant (k€/an)"]], body: opexRows, ...tableStyle });

    // --- NOUVEAU TABLEAU: FACTURATION OU REVENTE ---
    let yFacturation = checkSpace(doc, 60);
    const tauxAutoValue = parseFloat(tauxAuto) || 0;

    if (tauxAutoValue > 0) {
        doc.text("Tableau donnée de facturation d’électricité réseau", 15, yFacturation);
        const facturationRows = [
            ["Tarif de soutirage HP Hiver (€/MWh)", val('tarif_hiver_input') || "0"],
            ["Tarif de soutirage HP Été (€/MWh)", val('tarif_ete_input') || "0"],
            ["Tarif pondéré calculé (€/MWh)", document.getElementById('resultat_tarif_pondere') ? document.getElementById('resultat_tarif_pondere').innerText : val('prix_achat_elec')],
            ["Indexation facture élec. (%/an)", val('indexation_achat') || "0"]
        ];
        facturationRows.push(...lignesBatterieVirtuellePdf());
        doc.autoTable({ startY: yFacturation + 5, head: [["Indicateurs", "Valeur/Montant"]], body: facturationRows, ...tableStyle });
    } else {
        doc.text("Tableau donnée de revente en injection réseau", 15, yFacturation);
        const reventeRows = [
            ["Tarif Vente Totale (€/MWh)", val('pal_t_1') || "0"]
        ];
        doc.autoTable({ startY: yFacturation + 5, head: [["Indicateurs", "Valeur/Montant"]], body: reventeRows, ...tableStyle });
    }

    // --- PAGE 2 : RÉSULTATS (FINANCEMENT ET KPI) ---
    doc.addPage('a4', 'p');
    let yFin = 20;

    // 3. FINANCEMENT
    doc.text("Tableau du financement du projet", 15, yFin);
    const financeRows = [["Fonds propres (%)", val('fp_pct')]];
    if (document.querySelector('input[name="dette_toggle"]:checked').value === 'oui') {
        financeRows.push(
            ["Taux d'intérêt (%)", val('taux_dette')],
            ["Maturité (ans)", val('maturite_dette')],
            ["Intérêt annuel estimé (k€)", val('res_int_annuel')],
            ["Annuité estimée (k€)", val('res_annuite_est')]
        );
    }
    doc.autoTable({ startY: yFin + 5, head: [["Indicateur", "Valeur"]], body: financeRows, ...tableStyle });

    // 4. KPI
    let yRes = checkSpace(doc, 85);
    doc.text("Données clés des résultats du projet", 15, yRes);

    let lcoeVal = document.getElementById('res_lcoe').innerText.trim();
    if (lcoeVal !== '-' && !lcoeVal.includes('€/MWh')) lcoeVal += ' €/MWh';

    const kpiBody = [
        ["VAN projet", document.getElementById('res_van').innerText],
        ["TRI projet", document.getElementById('res_tri_p').innerText],
        ["TRI fonds propres", document.getElementById('res_tri_fp').innerText],
        ["Total OPEX", document.getElementById('res_total_opex') ? document.getElementById('res_total_opex').innerText : "-"],
        ["LCOE production", lcoeVal]
    ];

    const cardLcoeFacture = document.getElementById('card_lcoe_facture');
    if (cardLcoeFacture && cardLcoeFacture.style.display !== 'none') {
        let val = document.getElementById('res_lcoe_facture').innerText.trim();
        if (val !== '-' && !val.includes('€/MWh')) val += ' €/MWh';
        kpiBody.push(["LCOE Soutirage", val]);
    } else if (tauxAutoValue > 0) {
        let val = document.getElementById('res_lcoe_facture') ? document.getElementById('res_lcoe_facture').innerText.trim() : '-';
        if (val !== '-' && !val.includes('€/MWh')) val += ' €/MWh';
        kpiBody.push(["LCOE Soutirage", val]);
    }

    // NOUVEAU (demande explicite, non calculé jusqu'ici dans le rapport) :
    // Gain annuel moyen (€ HT/an) = Gain cumulés actualisé / Horizon du projet (nombre d'années).
    const gainsCumActNum = parseFloat(document.getElementById('res_gains_act_final').innerText) || 0;
    const horizonAns = parseFloat(val('horizon')) || 0;
    const gainAnnuelMoyen = horizonAns > 0 ? ((gainsCumActNum * 1000) / horizonAns).toFixed(2) + ' €' : '-';

    kpiBody.push(
        ["Payback brut fonds propres", document.getElementById('res_pb_brut').innerText],
        ["Payback actualisé fonds propre", document.getElementById('res_pb_act').innerText],
        ["Gain cumulés actualisé", document.getElementById('res_gains_act_final').innerText],
        ["Gains nets non actualisés", document.getElementById('res_gains_non_act').innerText],
        ["Gain annuel moyen (€ HT/an)", gainAnnuelMoyen]
    );

    doc.autoTable({
        startY: yRes + 5,
        head: [["Indicateur", "Valeur"]],
        body: kpiBody,
        ...tableStyle
    });

    // ── PAGE 3 : GRAPHIQUES ET FLUX (A3 paysage) ────────────────────────────
    doc.addPage('a3', 'l');
    doc.setFontSize(22);
    doc.setTextColor(0, 90, 158);
    doc.text("Graphique et tableau annuel des flux financiers", 15, 15);
    doc.setTextColor(0, 0, 0);

    let xImg = 15;
    const imgFcf = getChartImageData('fcfActChart');
    if (imgFcf) doc.addImage(imgFcf, 'PNG', xImg, 25, 190, 85);

    if (tauxAutoValue > 0) {
        const imgFact = getChartImageData('factureChart');
        if (imgFact) doc.addImage(imgFact, 'PNG', xImg + 200, 25, 190, 85);
    }

    const imgCum = getChartImageData('cumFlowChart');
    if (imgCum) doc.addImage(imgCum, 'PNG', 115, 115, 190, 85);

    // Tableau annuel des flux
    let tableY = 215;
    if (tableY + 60 > doc.internal.pageSize.height - 15) {
        doc.addPage('a3', 'l');
        tableY = 20;
    }

    doc.setFontSize(16);
    doc.text("Tableau annuel des flux (k€)", 15, tableY);
    doc.autoTable({
        html: '#results-table',
        startY: tableY + 5,
        styles: { fontSize: 8, halign: 'center' },
        headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0] },
        margin: { left: 15, right: 15, bottom: 5 },
        pageBreak: 'avoid'
    });

    doc.save('rapport_rentabilite_pv.pdf');
}
// Exposer globalement 
window.exportPDF = exportPDF;
window.getChartImageData = getChartImageData;
window.verifyAndExportPDF = verifyAndExportPDF;
window.verifyWithBackend = verifyWithBackend;

function openSensibilite() {
    const isHybride = document.querySelector('input[name="type_systeme"]:checked').value === 'hybride';
    const labels = document.querySelectorAll('.label-auto-sensi');

    // 1. Mise à jour dynamique des noms des labels
    labels.forEach(l => {
        l.textContent = isHybride ? "Taux couv. PV (%)" : "Taux auto (%)";
    });

    // 2. Synchronisation des valeurs initiales
    const currentVal = isHybride ?
        document.getElementById('taux_de_couverture_PV').value :
        document.getElementById('taux_autoconsommation').value;

    document.getElementById('s1_auto').value = currentVal;
    document.getElementById('s2_auto').value = currentVal;

    document.getElementById('sensiModal').style.display = 'block';
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

// --- GESTION HEURES NEGATIVES ET REVENUS ---
function openHeuresNeg() {
    const modal = document.getElementById('heuresNegModal');
    if (modal) modal.style.display = 'flex';
    const prodInit = document.getElementById('hn_prod_init');
    const prod = document.getElementById('productible');
    if (prodInit && prod) {
        prodInit.textContent = prod.value;
    }
    calcHeuresNeg();
}

function calcHeuresNeg() {
    const prodEl = document.getElementById('hn_prod_init');
    const nbreEl = document.getElementById('hn_nbre');
    const limiteEl = document.getElementById('hn_prod_limite');
    const maxEl = document.getElementById('hn_max');
    const seuilEl = document.getElementById('hn_seuil');
    const optionNetEl = document.getElementById('hn_appliquer_net');
    
    const prod_brut = parseFloat(prodEl ? prodEl.textContent : 0) || 0;
    let h_neg = parseFloat(nbreEl ? nbreEl.value : 0) || 0;
    const limite = parseFloat(limiteEl ? limiteEl.value : 1600) || 1600;
    const maxLimit = parseFloat(maxEl ? maxEl.value : 300) || 300;
    const seuil = parseFloat(seuilEl ? seuilEl.value : 15) || 15;
    const appliquer_net = optionNetEl ? optionNetEl.checked : true;
    // Libellé « Productible tranche 2 (> limite) » : suit la limite saisie (était figé à 1600).
    const libelleLimite = document.getElementById('hn_libelle_limite');
    if (libelleLimite) libelleLimite.textContent = String(limite);

    // Condition : le nombre d'heures négatives ne peut pas dépasser le seuil maximal
    // Règle 2 : Auto-correction supprimée

    const p_c = parseFloat(document.getElementById('puissance')?.value || 100);
    const taux_auto = parseFloat(document.getElementById('taux_autoconsommation')?.value || 0) / 100;

    const pays = document.getElementById('pays')?.value || 'France';
    const isFrance = pays === 'France';
    const specFrance = document.getElementById('spec_oui')?.checked ?? true;

    // ÉTAPE 1 : GESTION DE LA FRANCHISE
    let n_prix_negatifs = 0;
    if (isFrance && specFrance && appliquer_net) {
        n_prix_negatifs = Math.max(0, h_neg - seuil);
    }

    const energie_totale_brute_mwh = (p_c * prod_brut) / 1000;

    // ÉTAPE 2 : ISOLATION DU VOLUME INJECTÉ
    const vol_autoconso_mwh = energie_totale_brute_mwh * taux_auto;
    const energie_injectee_theorique_mwh = Math.max(0, energie_totale_brute_mwh - vol_autoconso_mwh);

    // ÉTAPE 3 : CALCUL DES PERTES LIÉES AUX COUPURES SUR L'INJECTION
    let perte_mwh = 0;
    if (isFrance && specFrance) {
        perte_mwh = (p_c * n_prix_negatifs) / 1000;
    }
    const energie_injectee_mwh = Math.max(0, energie_injectee_theorique_mwh - perte_mwh);

    // ÉTAPE 4 : AJUSTEMENT DU PLAFOND ET VENTILATION DES TRANCHES
    let plafond_ajuste_heures = limite;
    if (isFrance && specFrance && appliquer_net && option_prime) {
        plafond_ajuste_heures = limite - (n_prix_negatifs * 0.5);
    }
    
    let energie_tranche_1 = energie_injectee_mwh;
    if (isFrance && specFrance) {
        energie_tranche_1 = Math.min(energie_injectee_mwh, (plafond_ajuste_heures * p_c) / 1000);
    }
    const energie_tranche_2 = Math.max(0, energie_injectee_mwh - energie_tranche_1);
    
    const tranche2_heures = p_c > 0 ? (energie_tranche_2 * 1000) / p_c : 0;

    const tranche2El = document.getElementById('hn_prod_tranche2');
    if (tranche2El) tranche2El.textContent = tranche2_heures.toFixed(2);

    const pctEl = document.getElementById('hn_pct');
    if (pctEl) pctEl.textContent = prod_brut > 0 ? ((h_neg / prod_brut) * 100).toFixed(2) : 0;
    
    const energie_totale_nette_mwh = vol_autoconso_mwh + energie_injectee_mwh;
    const prod_reel_global = p_c > 0 ? (energie_totale_nette_mwh * 1000) / p_c : 0;

    const prodNetEl = document.getElementById('hn_prod_net');
    if (prodNetEl) {
        prodNetEl.value = prod_reel_global.toFixed(2);
        prodNetEl.textContent = prod_reel_global.toFixed(2);
    }
    
    updateFinanceCalculations();
}

function openRevenus() { 
    const modal = document.getElementById('revenusModal');
    if (modal) modal.style.display = 'flex';
    calcRevenus(); 
}

function calcRevenus() {
    const prodBrut = parseFloat(document.getElementById('productible')?.value) || 0;
    const puissance = parseFloat(document.getElementById('puissance')?.value) || 0;
    const tarif1 = parseFloat(document.getElementById('rev_tarif')?.value) || 0;
    const tarif2 = parseFloat(document.getElementById('pal_t_2')?.value) || 40;
    const limite = parseFloat(document.getElementById('prod_limite')?.value) || 1600;
    const h_neg = parseFloat(document.getElementById('hn_nbre')?.value) || 0;
    const seuil = parseFloat(document.getElementById('hn_seuil')?.value) || 15;
    const appliquerNet = document.getElementById('hn_appliquer_net')?.checked ?? true;
    const tauxAuto = parseFloat(document.getElementById('taux_autoconsommation')?.value || 0) / 100;

    const pays = document.getElementById('pays')?.value || 'France';
    const isFrance = pays === 'France';
    const specFrance = document.getElementById('spec_oui')?.checked ?? true;

    let n_prix_negatifs = 0;

    if (isFrance && specFrance && appliquerNet) {
        n_prix_negatifs = Math.max(0, h_neg - seuil);
    }

    const energie_totale_brute_mwh = (puissance * prodBrut) / 1000;
    const vol_autoconso_mwh = energie_totale_brute_mwh * tauxAuto;
    const energie_injectee_theorique_mwh = Math.max(0, energie_totale_brute_mwh - vol_autoconso_mwh);

    let energie_injectee_mwh = energie_injectee_theorique_mwh;
    let perte_mwh = 0;
    if (isFrance && specFrance) {
        perte_mwh = (puissance * n_prix_negatifs) / 1000;
        energie_injectee_mwh = Math.max(0, energie_injectee_theorique_mwh - perte_mwh);
    }
    const prod_injecte_heures = puissance > 0 ? (energie_injectee_mwh * 1000) / puissance : 0;

    let plafond_ajuste_heures = limite;
    if (isFrance && specFrance && appliquerNet && optionPrime) {
        plafond_ajuste_heures = limite - (n_prix_negatifs * 0.5);
    }

    let energie_tranche_1 = energie_injectee_mwh;
    if (isFrance && specFrance) {
        energie_tranche_1 = Math.min(energie_injectee_mwh, (plafond_ajuste_heures * puissance) / 1000);
    }
    const energie_tranche_2 = Math.max(0, energie_injectee_mwh - energie_tranche_1);

    const revenu_tranche_1 = energie_tranche_1 * tarif1;
    const revenu_tranche_2 = energie_tranche_2 * tarif2;
    const venteReseau = revenu_tranche_1 + revenu_tranche_2;
    
    const revVenteEl = document.getElementById('rev_vente');
    if (revVenteEl) revVenteEl.value = venteReseau.toFixed(2);
    
    let primeComp = 0;
    if (isFrance && specFrance && puissance >= 100 && appliquerNet && optionPrime) {
        const borne_sup = Math.max(0, 2 * (limite - prod_injecte_heures));
        const h_compensables = Math.min(n_prix_negatifs, borne_sup);
        const energie_non_produite_mwh = (h_compensables * puissance) / 1000;
        primeComp = energie_non_produite_mwh * (tarif1 * 0.5);
    }
    
    const revPrimeEl = document.getElementById('rev_prime');
    if (revPrimeEl) revPrimeEl.value = primeComp.toFixed(2);
    
    const revTotalEl = document.getElementById('rev_total');
    if (revTotalEl) revTotalEl.value = (venteReseau + primeComp).toFixed(2);
}


// ─────────────────────────────────────────────────────────────────────────────
// 5. ANALYSE DE SENSIBILITÉ (Exécutée instantanément en front-end)
// ─────────────────────────────────────────────────────────────────────────────

async function runSensibilite() {
    if (!(await donneesProSolaireConformes())) return;
    const baseInput = collectInputs();
    const isHybride = baseInput.typeSys === 'hybride';

    function getScenarioOverrides(idPrefix) {
        const multCapex = parseFloat(document.getElementById(idPrefix + '_capex').value) || 1;
        const multOpex = parseFloat(document.getElementById(idPrefix + '_opex').value) || 1;
        const multPuiss = parseFloat(document.getElementById(idPrefix + '_puiss').value) || 1;
        const multProd = parseFloat(document.getElementById(idPrefix + '_prod').value) || 1;
        const inputTaux = parseFloat(document.getElementById(idPrefix + '_auto').value) || 0;

        const overrides = {
            capexK: baseInput.capexK * multCapex,
            opexK: baseInput.opexK * multOpex,
            puissance: baseInput.puissance * multPuiss,
            productible: baseInput.productible * multProd,
        };
        if (isHybride) {
            overrides.tauxCouv = inputTaux;
            overrides.tauxAuto = 0;
        } else {
            overrides.tauxAuto = inputTaux;
            overrides.tauxCouv = 0;
        }
        return { ...baseInput, ...overrides };
    }

    // Les 3 appels s'exécutent de façon synchrone en local
    const resB = await runSimulation(baseInput);
    const res1 = await runSimulation(getScenarioOverrides('s1'));
    const res2 = await runSimulation(getScenarioOverrides('s2'));

    if (!resB || !res1 || !res2) return;

    const devise = baseInput.devise || '€';
    const iB = resB.kpis, i1 = res1.kpis, i2 = res2.kpis;

    const formatVal = (val) => isNaN(val) ? '0.00' : val.toFixed(2);
    const formatPB = (val) => (val === null || val === undefined || isNaN(val)) ? 'NA' : val.toFixed(2);
    const formatIRR = (val) => (isNaN(val) || val > 500 || val < -500) ? 'NA' : val.toFixed(2);

    let html = `<table><tr>
            <th>Indicateur</th><th>Projet Initial</th><th>Scénario 1</th><th>Scénario 2</th>
        </tr>`;
    const rows = [
        [`VAN (k${devise})`, formatVal(iB.van), formatVal(i1.van), formatVal(i2.van)],
        ["TRI Projet (%)", formatIRR(iB.triP), formatIRR(i1.triP), formatIRR(i2.triP)],
        ["TRI Fonds Propres (%)", formatIRR(iB.triFP), formatIRR(i1.triFP), formatIRR(i2.triFP)],
        [`LCOE (${devise}/MWh)`, formatVal(iB.lcoe), formatVal(i1.lcoe), formatVal(i2.lcoe)],
        ["Payback Brut FP (ans)", formatPB(iB.pbBrut), formatPB(i1.pbBrut), formatPB(i2.pbBrut)],
        ["Payback Actualisé FP (ans)", formatPB(iB.pbAct), formatPB(i1.pbAct), formatPB(i2.pbAct)],
        [`Gain Cumul. Actualisé (k${devise})`, formatVal(iB.gainsCumAct), formatVal(i1.gainsCumAct), formatVal(i2.gainsCumAct)],
        [`Gain Cumul. Non Actualisé (k${devise})`, formatVal(iB.gainsNonAct), formatVal(i1.gainsNonAct), formatVal(i2.gainsNonAct)],
    ];
    rows.forEach(r => {
        html += `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`;
    });
    document.getElementById('sensi_results').innerHTML = html + '</table>';
}
// Exposer globalement 
window.runSimulation = runSimulation;
window.runSensibilite = runSensibilite;
window.collectInputs = collectInputs;
window.displayResults = displayResults;
window.renderCharts = renderCharts;

function resetSensibilite() {
    const isHybride = document.querySelector('input[name="type_systeme"]:checked').value === 'hybride';
    const currentVal = isHybride ?
        document.getElementById('taux_de_couverture_PV').value :
        document.getElementById('taux_autoconsommation').value;

    ['s1', 's2'].forEach(prefix => {
        document.getElementById(prefix + '_capex').value = "1.00";
        document.getElementById(prefix + '_opex').value = "1.00";
        document.getElementById(prefix + '_puiss').value = "1.00";
        document.getElementById(prefix + '_prod').value = "1.00";
        document.getElementById(prefix + '_auto').value = currentVal;
    });
    document.getElementById('sensi_results').innerHTML = "";
}


function handleTauxAutoChange() {
    const tauxAuto = parseFloat(document.getElementById('taux_autoconsommation').value) || 0;
    const champImpot = document.getElementById('taux_impot');

    if (tauxAuto === 100) {
        champImpot.value = 0;
    } else if (tauxAuto < 100 && (champImpot.value == 0 || champImpot.value == "")) {
        champImpot.value = 25;
    }
    generatePaliers();
}

function checkPowerLimit() {
    const isHybride = document.querySelector('input[name="type_systeme"]:checked').value === 'hybride';
    if (isHybride) return; // Si on est en hybride, on ne touche à rien
    const power = parseFloat(document.getElementById('puissance').value) || 0;
    const pays = document.getElementById('pays').value;

    const specOui = document.getElementById('spec_oui');
    const specNon = document.getElementById('spec_non');

    if (pays === 'France') {
        // NOUVEAU: la spécificité tarifaire est désormais "Non" par défaut (cf. HTML), quelle que
        // soit la puissance ; on ne force plus automatiquement "Oui" pour les installations <500 kWc.
        // Au-delà de 500 kWc, "Non" reste forcé (sauf choix manuel de l'utilisateur).
        if (power >= 500 && specNon && !specNon.dataset.manual) {
            specNon.checked = true;
            toggleFranceSpec(false);
        }
    }

    const hnCb = document.getElementById('hn_appliquer_net');
    if (hnCb && !hnCb.dataset.manual) {
        hnCb.checked = (power >= 100);
    }
}


// Exposer les fonctions nécessaires globalement pour les onclick
window.openTab = openTab;
window.handlePaysChange = handlePaysChange;
window.checkHorizon = checkHorizon;
window.handleTypeProjetChange = handleTypeProjetChange;
window.checkPowerLimit = checkPowerLimit;
window.updateDeviseLabels = updateDeviseLabels;
window.toggleFranceSpec = toggleFranceSpec;
window.generatePaliers = generatePaliers;
window.updateCapexDisplays = updateCapexDisplays;
window.updateFinanceCalculations = updateFinanceCalculations;
window.runSimulation = runSimulation;
window.runSensibilite = runSensibilite;
window.resetSensibilite = resetSensibilite;
window.closeModal = closeModal;
window.exportPDF = exportPDF;

window.openHeuresNeg = openHeuresNeg;
window.calcHeuresNeg = calcHeuresNeg;
window.openRevenus = openRevenus;
window.calcRevenus = calcRevenus;

window.toggleDeuxOptions = toggleDeuxOptions;
window.toggleKpiSection = function(section) {
    const el = document.getElementById('section-kpi-' + section);
    if(el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

// À placer tout à la fin de votre script
window.addEventListener('DOMContentLoaded', (event) => {
    generatePaliers(); // Génère les champs de tarifs
    updateCapexDisplays(); // Calcule les totaux initiaux
    updateFinanceCalculations(); // Initialise la dette
    updateDeviseLabels(); // Met les bonnes devises
});

// Exposer aussi les fonctions pour les autres modules
window.openSensibilite = openSensibilite;
window.exportCSV = exportCSV;
window.toggleDetteFields = toggleDetteFields;
window.toggleCapexModeSelect = toggleCapexModeSelect;
window.toggleOpexModeSelect = toggleOpexModeSelect;
window.addDynamicRow = addDynamicRow;
window.handleTauxAutoChange = handleTauxAutoChange;
window.toggleSystemeFields = toggleSystemeFields;

// ─────────────────────────────────────────────────────────────────────────────
// NIVEAU 2 : Validation JavaScript (Sécurité Dynamique)
// ─────────────────────────────────────────────────────────────────────────────

function showCustomValidationModal(message) {
    const overlay = document.getElementById('custom-validation-alert-overlay');
    if (!overlay) return alert(message); // Repli de sécurité si l'HTML n'a pas chargé
    // Déplacer la modale à la racine du DOM pour empêcher les problèmes de Z-index ou de transformations CSS du parent
    if (overlay.parentNode !== document.body) {
        document.body.appendChild(overlay);
    }
    document.getElementById('custom-validation-alert-message').textContent = message;
    overlay.style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', () => {
    // 2. Fonction de validation unitaire
    // afficherAlerte : à la sortie du champ seulement — pendant la frappe, « 1 » en route vers
    // « 150 » est sous le minimum de 10 €/MWh ; seule la bordure rouge le signale alors.
    function validateNumericField(input, afficherAlerte = true) {
        const id = input.id;
        const rule = rules[id];
        if (!rule || input.value === "") {
            input.setCustomValidity("");
            input.style.border = "";
            return true;
        }

        const val = parseFloat(input.value);
        let isValid = true;
        let errorMessage = "";

        const effectiveMax = CHAMPS_MONETAIRES_DYNAMIQUES.includes(id)
            ? Math.round(rule.max * getFacteurConversionDevise() * 100) / 100
            : rule.max;

        if (isNaN(val)) {
            isValid = false;
            errorMessage = "Veuillez entrer une valeur numérique.";
        } else {
            // Respect de la règle stricte (>, >=, <, <=) sans faire d'auto-correction
            if (rule.minIncl ? val < rule.min : val <= rule.min) {
                isValid = false;
                errorMessage = `La valeur doit être ${rule.minIncl ? '>=' : '>'} à ${rule.min}.`;
            }
            if (rule.maxIncl ? val > effectiveMax : val >= effectiveMax) {
                isValid = false;
                errorMessage = `La valeur doit être ${rule.maxIncl ? '<=' : '<'} à ${effectiveMax}.`;
            }
        }

        if (!isValid) {
            input.setCustomValidity(errorMessage);
            input.style.border = "2px solid red"; // Feedback visuel (ou une classe CSS existante)
            
            // Erreur bloquante immédiate (Affichage d'alerte une seule fois par modification pour ne pas spammer)
            if (afficherAlerte && input.dataset.lastErrorValue !== input.value) {
                input.dataset.lastErrorValue = input.value;
                setTimeout(() => {
                    const msg = `Erreur de validation sur le champ:\n${errorMessage}\nSaisie actuelle: ${val}\nAucune correction automatique ne sera appliquée. Veuillez modifier cette valeur.`;
                    showCustomValidationModal(msg);
                }, 10);
            }
            
        } else {
            input.setCustomValidity("");
            input.style.border = "";
            input.dataset.lastErrorValue = "";
        }
        
        return isValid;
    }

    // 3. Application des validateurs au changement et à l'entrée
    Object.keys(rules).forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', () => validateNumericField(input, false));
            input.addEventListener('blur', () => validateNumericField(input, true));
        }
    });

    // 4. Validation très stricte des champs textuels (Maximum 4 espaces, 4 tirets)
    const textInputs = document.querySelectorAll('input[type="text"].dynamic-row-name');
    textInputs.forEach(input => {
        ['input', 'blur'].forEach(evt => {
            input.addEventListener(evt, () => {
                const val = input.value;
                let isValid = true;
                let msg = "";

                if (!/^[a-zA-Z0-9À-ÿ\s\-]*$/.test(val)) {
                    isValid = false;
                    msg = "Caractères spéciaux interdits.";
                } else if ((val.match(/ /g) || []).length > 4) {
                    isValid = false;
                    msg = "Vous avez dépassé la limite de 4 espaces.";
                } else if ((val.match(/-/g) || []).length > 4) {
                    isValid = false;
                    msg = "Vous avez dépassé la limite de 4 tirets.";
                }

                if (!isValid) {
                    input.setCustomValidity(msg);
                    input.style.border = "2px solid red";
                } else {
                    input.setCustomValidity("");
                    input.style.border = "";
                }
            });
        });
    });

    // 5. Blocage global de la soumission si des champs sont en erreur
    const form = document.querySelector('form'); // Remplace par l'ID de ton formulaire
    if (form) {
        form.addEventListener('submit', function(e) {
            let hasError = false;
            Object.keys(rules).forEach(id => {
                const input = document.getElementById(id);
                if (input && !validateNumericField(input)) hasError = true;
            });
            if (hasError) {
                e.preventDefault(); // Annule le calcul Python si l'utilisateur a contourné HTML
                showCustomValidationModal("Veuillez corriger les valeurs en rouge, vous avez dépassé les limites autorisées.");
            }
        });
    }
});