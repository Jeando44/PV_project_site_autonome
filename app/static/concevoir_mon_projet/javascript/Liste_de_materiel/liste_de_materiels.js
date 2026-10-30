// Base de données Inverters : partagée avec la section "Système" du calepinage
// (cf. components/calepinage_systeme/bd_onduleurs.js, chargé avant ce fichier dans menu.html).
const inverterDB = window.inverterDB;

let isCustomRef = false;
let inverterCount = 0;

// Actions du tableau : Supprimer et Copier
function deleteRow(btn) {
    btn.closest('tr').remove();
    updateProjectSummary();
}

function duplicateRow(btn) {
    const row = btn.closest('tr');
    const clone = row.cloneNode(true);

    // Les valeurs des inputs/selects ne sont pas clonées nativement avec cloneNode(true)
    const originalInputs = row.querySelectorAll('input, select, textarea');
    const cloneInputs = clone.querySelectorAll('input, select, textarea');
    originalInputs.forEach((input, index) => {
        if (input.type === 'checkbox' || input.type === 'radio') {
            cloneInputs[index].checked = input.checked;
        } else {
            cloneInputs[index].value = input.value;
        }
    });

    row.parentNode.insertBefore(clone, row.nextSibling);
    clone.style.backgroundColor = '#e8f4fd';
    setTimeout(() => clone.style.backgroundColor = '', 1500);
    updateProjectSummary();
}

function toggleCustomRef() {
    isCustomRef = !isCustomRef;
    const selectEl = document.getElementById('ond_ref');
    const inputEl = document.getElementById('ond_ref_custom');
    const saveBtn = document.getElementById('btn_save_custom');

    if (isCustomRef) {
        selectEl.classList.add('d-none');
        inputEl.classList.remove('d-none');
        if (saveBtn) saveBtn.classList.remove('d-none');
        document.getElementById('ond_pwr').value = '';
    } else {
        selectEl.classList.remove('d-none');
        inputEl.classList.add('d-none');
        if (saveBtn) saveBtn.classList.add('d-none');
        updateInverterPower();
    }
}

function updateInverterRefs() {
    const fab = document.getElementById('ond_fab').value;
    const refSelect = document.getElementById('ond_ref');
    refSelect.innerHTML = '<option value="">Sélectionner...</option>';

    if (inverterDB[fab]) {
        inverterDB[fab].forEach(inv => {
            let opt = document.createElement('option');
            opt.value = inv.ref;
            opt.textContent = inv.ref;
            opt.dataset.power = inv.power;
            opt.dataset.rendement = inv.rendement || '';
            opt.dataset.type = inv.type || 'Triphasé';
            opt.dataset.max_injection = inv.max_injection || inv.power;
            opt.dataset.hybride = inv.hybride || 'Non';
            opt.dataset.opti = inv.opti || 'Non';
            refSelect.appendChild(opt);
        });

        // Auto-sélection de la première référence disponible du fabricant
        if (inverterDB[fab].length > 0) {
            refSelect.selectedIndex = 1; // L'index 0 est "Sélectionner..."
        }
    }
    updateInverterPower();
}

function updateInverterPower() {
    if (isCustomRef) return;
    const refSelect = document.getElementById('ond_ref');
    const selectedOpt = refSelect.options[refSelect.selectedIndex];
    if (selectedOpt && selectedOpt.dataset.power) {
        document.getElementById('ond_pwr').value = selectedOpt.dataset.power;
        if (document.getElementById('ond_rendement')) document.getElementById('ond_rendement').value = selectedOpt.dataset.rendement;
        if (document.getElementById('ond_type')) document.getElementById('ond_type').value = selectedOpt.dataset.type;
        if (document.getElementById('ond_max_injection')) document.getElementById('ond_max_injection').value = selectedOpt.dataset.max_injection;
        if (document.getElementById('ond_hybride')) document.getElementById('ond_hybride').value = selectedOpt.dataset.hybride;
        if (document.getElementById('ond_opti')) document.getElementById('ond_opti').value = selectedOpt.dataset.opti;
    } else {
        document.getElementById('ond_pwr').value = '';
        if (document.getElementById('ond_rendement')) document.getElementById('ond_rendement').value = '';
        if (document.getElementById('ond_type')) document.getElementById('ond_type').value = 'Triphasé';
        if (document.getElementById('ond_max_injection')) document.getElementById('ond_max_injection').value = '';
        if (document.getElementById('ond_hybride')) document.getElementById('ond_hybride').value = 'Non';
        if (document.getElementById('ond_opti')) document.getElementById('ond_opti').value = '';
    }
}

function saveCustomInverter() {
    const fab = document.getElementById('ond_fab').value;
    const customRef = document.getElementById('ond_ref_custom').value;
    const customPwr = document.getElementById('ond_pwr').value;
    const customRendement = document.getElementById('ond_rendement') ? document.getElementById('ond_rendement').value : '';
    const customType = document.getElementById('ond_type') ? document.getElementById('ond_type').value : 'Triphasé';
    const customMaxInj = document.getElementById('ond_max_injection') ? document.getElementById('ond_max_injection').value : customPwr;
    const customHybride = document.getElementById('ond_hybride') ? document.getElementById('ond_hybride').value : 'Non';
    const customOpti = document.getElementById('ond_opti') ? document.getElementById('ond_opti').value : 'Non';

    if (!fab) return alert("Veuillez d'abord sélectionner un fabricant.");
    if (!customRef || !customPwr) return alert("Veuillez saisir une référence et une puissance.");

    if (!inverterDB[fab]) inverterDB[fab] = [];
    inverterDB[fab].push({
        ref: customRef,
        power: parseFloat(customPwr),
        rendement: parseFloat(customRendement),
        type: customType,
        max_injection: parseFloat(customMaxInj),
        hybride: customHybride,
        opti: customOpti
    });

    toggleCustomRef(); // Repasse en mode sélection de la liste
    updateInverterRefs(); // Actualise la liste avec la nouvelle entrée
    document.getElementById('ond_ref').value = customRef; // Sélectionne la nouvelle réf automatiquement
    updateInverterPower();
}

function addTableRow(sectionId, composant, designation, reference, quantite, puRaw = 0) {
    const sectionHeader = document.getElementById(sectionId);
    if (!sectionHeader) return;

    const devise = window.getDevise ? window.getDevise() : '€';
    const numericQtyMatch = quantite.match(/([\d.]+)/);
    const qtyVal = numericQtyMatch ? parseFloat(numericQtyMatch[1]) : 0;

    let prixTotalStr = "-";
    if (puRaw > 0) {
        const total = qtyVal * puRaw;
        prixTotalStr = `${total.toFixed(2)} ${devise}`;
    }

    const rowHTML = `
        <tr style="background-color: #e8f4fd; transition: background-color 1.5s;" data-pu="${puRaw}">
            <td>${composant}</td>
            <td>${designation}</td>
            <td>${reference}</td>
            <td>${quantite}</td>
            <td class="fw-bold text-center">${prixTotalStr}</td>
            <td style="white-space: nowrap; text-align: center; vertical-align: middle; padding-left: 15px; padding-right: 15px;">
                <button class="btn btn-sm btn-outline-primary text-primary me-2" onclick="editRow(this)" title="Modifier">✏️</button>
                <button class="btn btn-sm btn-outline-dark text-black me-2" onclick="deleteRow(this)" title="Supprimer">✖</button>
                <button class="btn btn-sm btn-outline-secondary" onclick="duplicateRow(this)" title="Copier">📋</button>
            </td>
        </tr>
    `;

    // Injection à la fin de la section courante (Avant la section-divider suivante) pour garantir l'ordre 1, 2, 3...
    let nextElement = sectionHeader.nextElementSibling;
    while (nextElement && !nextElement.classList.contains('section-divider')) {
        nextElement = nextElement.nextElementSibling;
    }

    let newRow;
    if (nextElement) {
        nextElement.insertAdjacentHTML('beforebegin', rowHTML);
        newRow = nextElement.previousElementSibling;
    } else {
        sectionHeader.parentNode.insertAdjacentHTML('beforeend', rowHTML);
        newRow = sectionHeader.parentNode.lastElementChild;
    }

    // Animation visuelle d'ajout
    setTimeout(() => newRow.style.backgroundColor = '', 1500);
}

// Fonction globale pour MODIFIER une ligne existante (Rétro-ingénierie vers le modal)
window.editRow = function(btn) {
    const row = btn.closest('tr');
    const cells = row.querySelectorAll('td');
    if (cells.length < 5) return;

    const composant = cells[0].innerText.trim();
    const designation = cells[1].innerText.trim();
    const reference = cells[2].innerText.trim();
    const quantiteText = cells[3].innerText.trim();
    const puRaw = parseFloat(row.getAttribute('data-pu')) || 0;

    // Extraire la quantité numérique stricte
    const numMatch = quantiteText.match(/([\d.]+)/);
    const quantite = numMatch ? parseFloat(numMatch[1]) : 0;

    let tabToOpen = null;

    // Fonction utilitaire pour repeupler le formulaire du modal et déclencher les calculs
    const setVal = (id, val) => { 
        const el = document.getElementById(id); 
        if (el) { 
            el.value = val; 
            el.dispatchEvent(new Event('input', { bubbles: true })); 
        } 
    };

    // Détermination de l'onglet source et réintégration des données
    if (composant === "Modules photovoltaïques") {
        setVal('mod_fab', designation);
        let refClean = reference;
        const pwrMatch = reference.match(/\(([\d.]+)\s*Wc\)/);
        if (pwrMatch) {
            setVal('mod_pwr_unit', pwrMatch[1]);
            refClean = reference.replace(/\s*\([\d.]+\s*Wc\)/, '').trim();
        }
        setVal('mod_ref', refClean);
        setVal('mod_qty', quantite);
        setVal('mod_pu', puRaw);
        tabToOpen = 'modules';
    } else if (composant === "Chaines PV") {
        setVal('chaines_fab', designation);
        setVal('chaines_ref', reference);
        setVal('mod_chaines', quantite);
        setVal('chaines_pu', puRaw);
        tabToOpen = 'modules';
    } else if (composant === "Connecteurs PV") {
        setVal('conn_fab', designation);
        setVal('mod_connecteurs', reference);
        setVal('conn_qty', quantite);
        setVal('conn_pu', puRaw);
        tabToOpen = 'modules';
    } else if (composant === "Optimiseurs de puissance") {
        setVal('opti_fab', designation);
        setVal('opti_ref', reference);
        setVal('opti_qty', quantite);
        setVal('opti_pu', puRaw);
        tabToOpen = 'modules';
    } else if (composant === "Système d'intégration") {
        setVal('sys_fab', designation);
        setVal('sys_ref', reference);
        setVal('sys_qty', quantite);
        setVal('sys_pu', puRaw);
        tabToOpen = 'modules';
    } else if (composant === "Coffret DC") {
        const radioOui = document.getElementById('mod_coffret_oui');
        if (radioOui) { 
            radioOui.checked = true; 
            if (typeof toggleCoffretDC === 'function') toggleCoffretDC(); 
        }
        setVal('mod_coffret_fab', designation);
        setVal('mod_coffret_ref', reference);
        setVal('mod_coffret_qty', quantite);
        setVal('mod_coffret_pu', puRaw);
        tabToOpen = 'modules';
    } else if (composant.startsWith("Onduleur")) {
        setVal('ond_fab', designation);
        if (typeof toggleCustomRef === 'function' && typeof isCustomRef !== 'undefined' && !isCustomRef) {
            toggleCustomRef();
        }
        setVal('ond_ref_custom', reference);
        setVal('ond_qty', quantite);
        setVal('ond_pu', puRaw);
        tabToOpen = 'onduleurs';
    } else if (composant === "Shelteriste/Tableautier") {
        setVal('she_fab', designation);
        setVal('she_ref', reference);
        setVal('she_qty', quantite);
        setVal('she_pu', puRaw);
        tabToOpen = 'shelter';
    } else if (composant.startsWith("Chemin de câble")) {
        setVal('cdc_type', designation);
        const largMatch = reference.match(/Largeur\s+([\d.]+)/);
        if (largMatch) setVal('cdc_largeur', largMatch[1]);
        setVal('cdc_longueur', quantite);
        setVal('cdc_pu', puRaw);
        tabToOpen = 'reseaux';
    } else if (composant === "Infrastructures") {
        setVal('infra_type', 'Autres');
        if (typeof toggleOther === 'function') toggleOther('infra_type', 'infra_type_other');
        setVal('infra_type_other', reference);
        setVal('infra_qty', quantite);
        setVal('infra_pu', puRaw);
        tabToOpen = 'reseaux';
    } else if (composant === "Fourreau") {
        setVal('fourreau_std', 'custom');
        if (typeof toggleFourreauCustom === 'function') toggleFourreauCustom();
        const extMatch = reference.match(/Ø([\d.]+)/);
        if (extMatch) setVal('fourreau_ext', extMatch[1]);
        const nbMatch = reference.match(/^([\d]+)TPC/);
        if (nbMatch) setVal('fourreau_nb', nbMatch[1]);
        setVal('fourreau_longueur', quantite);
        setVal('fourreau_pu', puRaw);
        tabToOpen = 'reseaux';
    } else if (composant === "Type de structure") {
        setVal('autre_struct_fab', designation);
        setVal('autre_struct_des', reference);
        setVal('autre_struct_qty', quantite);
        setVal('autre_struct_pu', puRaw);
        tabToOpen = 'autres';
    } else if (composant === "Structure") {
        setVal('autre_fond_fab', designation);
        setVal('autre_fond_des', 'Autres');
        const otherInput = document.getElementById('autre_fond_des_other');
        if (otherInput) otherInput.classList.remove('d-none');
        setVal('autre_fond_des_other', reference);
        setVal('autre_fond_qty', quantite);
        setVal('autre_fond_pu', puRaw);
        tabToOpen = 'autres';
    } else if (composant === "Câble") {
        tabToOpen = 'cables';
    } else {
        const isAC = ["Luminaires", "Borne de recharge", "Batterie", "Poste de transformation", "Coffret AC", "Composant AC (ex: Appareillage)"].includes(composant);
        tabToOpen = isAC ? 'autres-ac' : 'autres';
    }

    // Supprimer l'ancienne ligne (pour permettre de la recréer en validant le modal)
    row.remove();
    if (typeof updateProjectSummary === 'function') updateProjectSummary();

    // Ouvrir le modal sur le bon onglet
    if (typeof showTab === 'function') {
        showTab(tabToOpen || 'modules');
    }
};

// Ajout conditionnel des fourreaux depuis le calculateur
function addFourreauToList() {
    const nb = document.getElementById('fourreau_nb').value || 1;
    const select = document.getElementById('fourreau_std');
    let diametre = '';

    if (select.value === 'custom') {
        diametre = document.getElementById('fourreau_ext').value;
    } else if (select.selectedIndex > 0) {
        diametre = select.value;
    }

    if (!diametre) {
        alert("Veuillez sélectionner ou saisir un diamètre de fourreau.");
        return;
    }

    const longueur = document.getElementById('fourreau_longueur').value || 0;
    const reference = `${nb}TPCØ${diametre}`;
    const fourreauPu = parseFloat(document.getElementById('fourreau_pu')?.value) || 0;

    addTableRow('sec-reseaux', "Fourreau", "Fourreau TPC", reference, `${longueur} m`, fourreauPu);
}

function updateCDCBtns() {
    const cdcType = document.getElementById('cdc_type').value;
    const btnDC = document.getElementById('btn_add_cdc_dc');
    const btnAC = document.getElementById('btn_add_cdc_ac');

    if (cdcType === "Dalle Marine" || cdcType === "Cablofil") {
        btnDC.innerText = `Ajouter CDC DC (${cdcType})`;
        btnDC.setAttribute('onclick', `addCDC('DC', '${cdcType}')`);
        btnAC.innerText = `Ajouter CDC AC (${cdcType})`;
        btnAC.setAttribute('onclick', `addCDC('AC', '${cdcType}')`);
    } else if (cdcType === "Dalle Marine (AC) & Cablofil (DC)") {
        btnDC.innerText = `Ajouter CDC DC (Cablofil)`;
        btnDC.setAttribute('onclick', `addCDC('DC', 'Cablofil')`);
        btnAC.innerText = `Ajouter CDC AC (Dalle Marine)`;
        btnAC.setAttribute('onclick', `addCDC('AC', 'Dalle Marine')`);
    } else if (cdcType === "Dalle Marine (DC) & Cablofil (AC)") {
        btnDC.innerText = `Ajouter CDC DC (Dalle Marine)`;
        btnDC.setAttribute('onclick', `addCDC('DC', 'Dalle Marine')`);
        btnAC.innerText = `Ajouter CDC AC (Cablofil)`;
        btnAC.setAttribute('onclick', `addCDC('AC', 'Cablofil')`);
    }
}

function addCDC(type, supportType = "Cablofil") {
    const largeur = document.getElementById('cdc_largeur').value || "Non spécifié";
    const longueur = document.getElementById('cdc_longueur').value || "0";
    const cdcPu = parseFloat(document.getElementById('cdc_pu')?.value) || 0;
    addTableRow('sec-reseaux', `Chemin de câble ${type}`, supportType, `Largeur ${largeur} mm`, `${longueur} m`, cdcPu);
}

function addInfra() {
    const qty = document.getElementById('infra_qty').value;
    let type = document.getElementById('infra_type').value;
    if (type === "Autres") type = document.getElementById('infra_type_other').value || "Autre";
    addTableRow('sec-reseaux', "Infrastructures", "Ouvrage béton / Génie civil", type, `${qty} pcs`);
}

function toggleCableDropdowns(cb) {
    const row = cb.closest('.cable-row');
    const inputs = row.querySelectorAll('select, input[type="number"]');
    inputs.forEach(input => input.disabled = !cb.checked);
}

function toggleOther(selectId, inputId) {
    const select = document.getElementById(selectId);
    const input = document.getElementById(inputId);
    if (select.value === "Autres") {
        input.classList.remove('d-none');
        input.focus();
    } else {
        input.classList.add('d-none');
        input.value = '';
    }
}

function toggleCoffretDC() {
    const isOui = document.getElementById('mod_coffret_oui').checked;
    const divDetails = document.getElementById('div_coffret_dc_details');
    if (isOui) {
        divDetails.classList.remove('d-none');
    } else {
        divDetails.classList.add('d-none');
    }
}

function setActiveTab(tabId) {
    showTab(tabId);
}

function addRowFromModal() {
    const activePane = document.querySelector('#modalConfig .tab-pane.active');
    if (!activePane) return;
    const activeTab = activePane.id;

    if (activeTab === 'modules') {
        const modFab = document.getElementById('mod_fab').value || "Non spécifié";
        const modRef = document.getElementById('mod_ref').value || "Non spécifié";
        const modPwr = document.getElementById('mod_pwr_unit').value || "470";
        const modQty = document.getElementById('mod_qty').value || "À définir";
        // Récupérer le PU effectif (Mode Wc ou Panneau) calculé par le module chiffrage
        const modPuEl = document.getElementById('mod_pu');
        const modPu = parseFloat(modPuEl.getAttribute('data-effective-pu') || modPuEl.value) || 0;

        const refWithPwr = modRef !== "Non spécifié" ? `${modRef} (${modPwr} Wc)` : `(${modPwr} Wc)`;

        const chainesFab = document.getElementById('chaines_fab').value || "Non spécifié";
        const chainesRef = document.getElementById('chaines_ref').value || "Non spécifié";
        const chainesQty = document.getElementById('mod_chaines').value || "0";

        const connFab = document.getElementById('conn_fab').value || "Non spécifié";
        const connRef = document.getElementById('mod_connecteurs').value || "Non spécifié";
        const connQty = document.getElementById('conn_qty').value || "0";

        const optiFab = document.getElementById('opti_fab').value || "Non spécifié";
        const optiRef = document.getElementById('opti_ref').value || "Non spécifié";
        const optiQty = document.getElementById('opti_qty').value || "0";

        const chainesPu = parseFloat(document.getElementById('chaines_pu')?.value) || 0;
        const connPu = parseFloat(document.getElementById('conn_pu')?.value) || 0;
        const optiPu = parseFloat(document.getElementById('opti_pu')?.value) || 0;

        const sysFab = document.getElementById('sys_fab')?.value || "Non spécifié";
        const sysRef = document.getElementById('sys_ref')?.value || "Non spécifié";
        const sysQty = document.getElementById('sys_qty')?.value || "0";
        const sysPu = parseFloat(document.getElementById('sys_pu')?.value) || 0;

        addTableRow('sec-dc', "Modules photovoltaïques", modFab, refWithPwr, `${modQty} pcs`, modPu);

        if (parseInt(chainesQty) > 0 || chainesRef !== "Non spécifié") {
            addTableRow('sec-dc', "Chaines PV", chainesFab, chainesRef, `${chainesQty} pcs`, chainesPu);
        }
        if (parseInt(connQty) > 0 || connRef !== "Non spécifié") {
            addTableRow('sec-dc', "Connecteurs PV", connFab, connRef, `${connQty} pcs`, connPu);
        }
        if (parseInt(optiQty) > 0 || optiRef !== "Non spécifié") {
            addTableRow('sec-dc', "Optimiseurs de puissance", optiFab, optiRef, `${optiQty} pcs`, optiPu);
        }
        if (parseInt(sysQty) > 0 || sysRef !== "Non spécifié") {
            addTableRow('sec-structure', "Système d'intégration", sysFab, sysRef, `${sysQty} pcs`, sysPu);
        }
        if (document.getElementById('mod_coffret_oui').checked) {
            const coffretFab = document.getElementById('mod_coffret_fab').value || "Non spécifié";
            const coffretRef = document.getElementById('mod_coffret_ref').value || "Non spécifié";
            const coffretQty = document.getElementById('mod_coffret_qty').value || "1";
            const coffretPu = parseFloat(document.getElementById('mod_coffret_pu')?.value) || 0;
            addTableRow('sec-dc', "Coffret DC", coffretFab, coffretRef, `${coffretQty} pcs`, coffretPu);
        }

        document.getElementById('mod_fab').value = '';
        document.getElementById('mod_ref').value = '';
        document.getElementById('mod_qty').value = '';
        document.getElementById('chaines_fab').value = '';
        document.getElementById('chaines_ref').value = '';
        document.getElementById('mod_chaines').value = '';
        document.getElementById('conn_fab').value = '';
        document.getElementById('mod_connecteurs').value = '';
        document.getElementById('conn_qty').value = '';
        document.getElementById('opti_fab').value = '';
        document.getElementById('opti_ref').value = '';
        document.getElementById('opti_qty').value = '';
        if(document.getElementById('sys_fab')) document.getElementById('sys_fab').value = '';
        if(document.getElementById('sys_ref')) document.getElementById('sys_ref').value = '';
        if(document.getElementById('sys_qty')) document.getElementById('sys_qty').value = '';
        document.getElementById('mod_coffret_fab').value = '';
        document.getElementById('mod_coffret_ref').value = '';
        document.getElementById('mod_coffret_qty').value = '1';
        document.getElementById('mod_coffret_non').checked = true;
        toggleCoffretDC();
    } else if (activeTab === 'onduleurs') {
        let ref = isCustomRef ? document.getElementById('ond_ref_custom').value : document.getElementById('ond_ref').value;
        inverterCount++;
        const ondPu = parseFloat(document.getElementById('ond_pu')?.value) || 0;
        addTableRow('sec-ac', `Onduleur n°${inverterCount}`, document.getElementById('ond_fab').value || "Non spécifié", ref || "Non spécifié", document.getElementById('ond_qty').value + " pcs", ondPu);
    } else if (activeTab === 'cables') {
        const checkboxes = Array.from(document.querySelectorAll('.cable-cb:checked'));
        if (checkboxes.length === 0) {
            alert("Veuillez sélectionner au moins un câble.");
            return; // Bloque l'exécution si aucun câble n'est sélectionné
        }
        checkboxes.forEach(cb => {
            const row = cb.closest('.cable-row');
            const cableType = cb.value;
            const secSelect = row.querySelector('.cable-sec');
            const optSelect = row.querySelector('.cable-opt');
            const lenInput = row.querySelector('.cable-len');
            const puCable = parseFloat(row.querySelector('.cable-pu')?.value) || 0

            let designation = cableType;
            let reference = '';

            if (optSelect) designation += ` (${optSelect.value})`;
            if (secSelect) reference = `${secSelect.value} mm²`;

            let quantite = lenInput && lenInput.value ? `${lenInput.value} m` : "À définir";

            addTableRow('sec-cables', "Câble", designation, reference, quantite, puCable);

            // Réinitialise la sélection à chaque validation
            cb.checked = false;
            toggleCableDropdowns(cb);
        });
    } else if (activeTab === 'shelter') {
        const fab = document.getElementById('she_fab').value || "Non spécifié";
        const ref = document.getElementById('she_ref').value || "Non spécifié";

        let empSelect = document.getElementById('she_emp').value;
        if (empSelect === "Autres") empSelect = document.getElementById('she_emp_other').value || "Autre";

        let envSelect = document.getElementById('she_env').value;
        if (envSelect === "Autres") envSelect = document.getElementById('she_env_other').value || "Autre";

        const sheQty = document.getElementById('she_qty')?.value || "1";
        const shePu = parseFloat(document.getElementById('she_pu')?.value) || 0;
        addTableRow('sec-ac', " - Détails de pose", "Caractéristiques", `Emplacement: ${empSelect} | Env: ${envSelect}`, "-");
        addTableRow('sec-ac', "Shelteriste/Tableautier", fab, ref, `${sheQty} pcs`, shePu);

        document.getElementById('she_fab').value = '';
        document.getElementById('she_ref').value = '';
    } else if (activeTab === 'reseaux') {
        let infraType = document.getElementById('infra_type').value;
        if (infraType === "Autres") infraType = document.getElementById('infra_type_other').value || "Autre";
        const infraQty = document.getElementById('infra_qty').value;
        const infraPu = parseFloat(document.getElementById('infra_pu')?.value) || 0;
        if (infraType && infraQty > 0) {
            addTableRow('sec-reseaux', "Infrastructures", "Ouvrage béton / Génie civil", infraType, `${infraQty} pcs`, infraPu);
        }

        const cdcLargeur = document.getElementById('cdc_largeur').value;
        const cdcLongueur = document.getElementById('cdc_longueur').value;
        const cdcType = document.getElementById('cdc_type').value;
        const cdcPu = parseFloat(document.getElementById('cdc_pu')?.value) || 0;
        if (cdcLargeur || cdcLongueur) {
            addTableRow('sec-reseaux', "Chemin de câble (Non spécifié)", cdcType, `Largeur ${cdcLargeur || 'N/A'} mm`, `${cdcLongueur || '0'} m`, cdcPu);
        }

        // Nettoyage des champs après validation
        document.getElementById('cdc_largeur').value = '';
        document.getElementById('cdc_longueur').value = '';
        document.getElementById('infra_type').selectedIndex = 0;
        document.getElementById('infra_qty').value = '1';
        toggleOther('infra_type', 'infra_type_other');
    } else if (activeTab === 'autres-ac') {
        const rows = Array.from(document.querySelectorAll('#autres-ac .autre-mat-ac-row'));
        let hasSelection = false;
        rows.forEach(row => {
            const cb = row.querySelector('.am-ac-cb');
            if (cb && cb.checked) {
                hasSelection = true;
                const comp = row.querySelector('.am-ac-composant').value || "Non spécifié";
                const des = row.querySelector('.am-ac-designation').value || "-";
                let ref = row.querySelector('.am-ac-reference').value || "-";
                const puAc = parseFloat(row.querySelector('.am-ac-pu')?.value) || 0;

                const capInput = row.querySelector('.am-ac-capacite');
                if (capInput && capInput.value && parseFloat(capInput.value) > 0) {
                    ref = ref !== "-" ? `${ref} (${capInput.value} kWh)` : `(${capInput.value} kWh)`;
                }

                let qte = row.querySelector('.am-ac-quantite').value || "1";
                if (!qte.includes("pcs")) qte += " pcs";
                addTableRow('sec-ac', comp, des, ref, qte, puAc);

                // Reset des champs après ajout
                cb.checked = false;
                row.querySelector('.am-ac-designation').value = '';
                row.querySelector('.am-ac-reference').value = '';
                row.querySelector('.am-ac-quantite').value = '';
                if (capInput) capInput.value = '';
            }
        });
        if (!hasSelection) {
            alert("Veuillez sélectionner au moins un matériel AC.");
        }
    } else if (activeTab === 'autres') {
        const container = document.getElementById('container_autres_materiels_modal');
        const sectionAutres = document.getElementById('section-autres-materiels');
        let hasSelection = false;

        const structFab = document.getElementById('autre_struct_fab')?.value;
        const structDes = document.getElementById('autre_struct_des')?.value;
        const structQty = document.getElementById('autre_struct_qty')?.value;
        const structPu = parseFloat(document.getElementById('autre_struct_pu')?.value) || 0;
        if (structDes || structFab) {
            addTableRow('sec-structure', "Type de structure", structFab || "-", structDes || "-", (structQty || "1") + " pcs", structPu);
            hasSelection = true;
        }

        const fondFab = document.getElementById('autre_fond_fab')?.value;
        let fondDes = document.getElementById('autre_fond_des')?.value;
        if (fondDes === 'Autres') {
            fondDes = document.getElementById('autre_fond_des_other')?.value;
        }
        const fondQty = document.getElementById('autre_fond_qty')?.value;
        const fondPu = parseFloat(document.getElementById('autre_fond_pu')?.value) || 0;
        if (fondDes || fondFab) {
            addTableRow('sec-fondations', "Structure", fondFab || "-", fondDes || "-", (fondQty || "1") + " pcs", fondPu);
            hasSelection = true;
        }

        if (container && sectionAutres) {
            const rows = Array.from(container.querySelectorAll('.autre-materiel-item'));
            rows.forEach(row => {
                const comp = row.querySelector('.am-composant')?.value;
                const des = row.querySelector('.am-designation')?.value;
                const ref = row.querySelector('.am-reference')?.value;
                let qty = row.querySelector('.am-quantite')?.value;
                const puAm = parseFloat(row.querySelector('.am-pu')?.value) || 0;
                if (qty && !qty.includes("pcs") && !qty.includes("m")) qty += " pcs";

                if (comp) {
                    hasSelection = true;
                    addTableRow('section-autres-materiels', comp, des || "-", ref || "-", qty || "-", puAm);
                }
            });

            if (hasSelection) {
                sectionAutres.classList.remove('d-none');
            } else {
                alert("Veuillez saisir au moins un composant.");
            }
        }
    }
    updateProjectSummary();
}

// --- Synchronisation depuis SummaryModal ---
function syncSummaryData() {
    try {
        const savedData = localStorage.getItem('solarProjectData');
        if (!savedData) return;
        const projectData = JSON.parse(savedData);

        let totalPower = 0;
        let puissanceOnduleur = 0;
        let ratioDcAc = 0;

        if (projectData.totals) {
            totalPower = projectData.totals.totalPower || 0;
            puissanceOnduleur = projectData.totals.puissanceOnduleurKva || 0;
            ratioDcAc = projectData.totals.ratioDcAc || 0;
        }

        // 1. Paramètres projet
        const pProjet = document.getElementById('summary_puissance_projet');
        const pOnd = document.getElementById('summary_puissance_onduleur');
        const pRatio = document.getElementById('summary_ratio_dc_ac');

        if (pProjet) {
            pProjet.value = totalPower.toFixed(2);
            pProjet.style.textAlign = 'left';
        }
        if (pOnd) {
            pOnd.value = puissanceOnduleur.toFixed(2);
            pOnd.style.textAlign = 'left';
        }
        if (pRatio) {
            pRatio.value = ratioDcAc.toFixed(2);
            pRatio.style.textAlign = 'left';
        }

        // 2. Modules & Connectiques
        let panelFab = "";
        let panelRef = "";
        let panelPower = "";
        let totalPanels = 0;

        if (projectData.formData) {
            for (const pvId in projectData.formData) {
                const formValues = projectData.formData[pvId];
                if (!panelFab && formValues.fabricantPanneau) panelFab = formValues.fabricantPanneau;
                if (!panelRef && formValues.referencePanneau) panelRef = formValues.referencePanneau;
                if (!panelPower && formValues.puissancePanneau) panelPower = formValues.puissancePanneau;
            }
        }

        const savedConfigStr = localStorage.getItem('preferredPanelConfig');
        if (savedConfigStr) {
            const savedConfig = JSON.parse(savedConfigStr);
            if (savedConfig.fab) panelFab = savedConfig.fab;
            if (savedConfig.ref) panelRef = savedConfig.ref;
            if (savedConfig.power) panelPower = savedConfig.power;
        }

        if (panelPower && totalPower) {
            totalPanels = Math.round((totalPower * 1000) / parseFloat(panelPower));
        }

        const applyReadOnly = (id, val) => {
            const el = document.getElementById(id);
            if (el) {
                el.value = val;
                el.readOnly = true;
                el.style.backgroundColor = '#e9ecef'; // Gris indiquant le statut verrouillé
            }
        };

        // Remplissage ciblé et verrouillage
        applyReadOnly('mod_fab', panelFab || (panelRef ? panelRef.split(/[\s-]/)[0] : "Non spécifié"));
        applyReadOnly('mod_ref', panelRef || "Non spécifiée");
        applyReadOnly('mod_pwr_unit', panelPower || 0);
        applyReadOnly('mod_qty', totalPanels || 0);

    } catch (e) {
        console.error("Erreur de synchronisation des données depuis SummaryModal", e);
    }
}

// Synchronisation en direct avec le reste de l'application
document.addEventListener('solarProjectDataSaved', syncSummaryData);
window.addEventListener('storage', (e) => {
    if (e.key === 'solarProjectData' || e.key === 'preferredPanelConfig') {
        syncSummaryData();
    }
});



function updateProjectSummary() {
    const rows = document.querySelectorAll("#tableMateriels tbody tr");
    let totalKwc = 0;
    let totalBornes = 0;
    let totalBatterie = 0;

    rows.forEach(row => {
        if (row.classList.contains('section-divider') || row.classList.contains('d-none')) return;
        const cells = row.querySelectorAll('td');
        if (cells.length < 4) return;

        const composant = cells[0].innerText.trim();
        const ref = cells[2].innerText.trim();
        const qtyText = cells[3].innerText.trim();

        if (composant === "Modules photovoltaïques") {
            const qtyMatch = qtyText.match(/(\d+)/);
            const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 0;
            const pwrMatch = ref.match(/(\d+)\s*Wc/);
            const pwr = pwrMatch ? parseInt(pwrMatch[1], 10) : 0;
            totalKwc += (qty * pwr) / 1000;
        } else if (composant === "Borne de recharge") {
            const qtyMatch = qtyText.match(/(\d+)/);
            const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 0;
            totalBornes += qty;
        } else if (composant === "Batterie") {
            const qtyMatch = qtyText.match(/(\d+)/);
            const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 0;
            const capMatch = ref.match(/([\d.]+)\s*kWh/i);
            if (capMatch) {
                totalBatterie += parseFloat(capMatch[1]) * qty;
            }
        }
    });

    let summaryText = [];
    if (totalKwc > 0) summaryText.push(`Puissance projet : ${totalKwc.toFixed(2)} kWc`);
    if (totalBornes > 0) summaryText.push(`Quantité borne de recharge : ${totalBornes}`);
    if (totalBatterie > 0) summaryText.push(`Cap. batterie : ${totalBatterie.toFixed(1).replace('.0', '')} kWh`);

    const summaryStr = summaryText.join(' | ');
    const summaryEl = document.getElementById('project_summary_display');
    if (summaryEl) summaryEl.innerText = summaryStr;

    return summaryStr;
}

async function generatePDF() {
    const table = document.getElementById("tableMateriels");
    const rows = table.querySelectorAll("tbody tr");
    const data = [];

    let currentSection = "";
    rows.forEach(row => {
        if (row.classList.contains("d-none")) return; // Exclut les sections/lignes masquées (Fondations, etc.)

        if (row.classList.contains("section-divider")) {
            let clone = row.cloneNode(true);
            let btns = clone.querySelectorAll('button');
            btns.forEach(b => b.remove()); // Supprime le texte "Configurer DC", etc.
            currentSection = clone.innerText.trim();
        } else {
            const cells = row.querySelectorAll("td");
            if (cells.length >= 4) {
                // Fonction pour extraire le texte brut ou la valeur d'un élément de formulaire interactif
                const extractValue = (cell) => {
                    const select = cell.querySelector('select');
                    if (select) return select.options[select.selectedIndex].text;

                    const checkedRadio = cell.querySelector('input[type="radio"]:checked');
                    if (checkedRadio) {
                        const label = cell.querySelector(`label[for="${checkedRadio.id}"]`);
                        return label ? label.innerText.trim() : checkedRadio.value;
                    }

                    return cell.innerText.trim();
                };

                const puBrut = parseFloat(row.getAttribute('data-pu')) || 0;

                data.push({
                    section: currentSection,
                    composant: extractValue(cells[0]),
                    designation: extractValue(cells[1]),
                    reference: extractValue(cells[2]),
                    quantite: extractValue(cells[3]),
                    pu: puBrut
                });
            }
        }
    });

    const indiceVal = document.getElementById('indice_projet').value === 'Autres'
        ? document.getElementById('autre_indice_projet').value
        : document.getElementById('indice_projet').value;
    const isPvReadyVisible = !document.getElementById('div_pv_ready').classList.contains('d-none');

    // Extraction des données techniques précises pour le cartouche A3
    let panelRefCartouche = "Non spécifiée";
    let panelCountCartouche = 0;
    let totalPowerCartouche = 0;

    data.forEach(item => {
        if (item.composant === "Modules photovoltaïques") {
            panelRefCartouche = item.reference;
            const qtyMatch = item.quantite.match(/(\d+)/);
            const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 0;
            panelCountCartouche += qty;

            const pwrMatch = item.reference.match(/(\d+)\s*Wc/);
            const pwr = pwrMatch ? parseInt(pwrMatch[1], 10) : 0;
            totalPowerCartouche += (qty * pwr) / 1000;
        }
    });

    const projetParams = {
        nom: document.getElementById('nom_projet').value || 'Non spécifié',
        adresse: document.getElementById('adresse_projet').value || 'Non spécifiée',
        date: document.getElementById('date_projet').value || new Date().toLocaleDateString('fr-FR'),
        pv_ready: isPvReadyVisible ? (document.getElementById('batiment_pv_ready').checked ? 'Oui' : 'Non') : 'Non applicable',
        indice: indiceVal || 'Indice A',
        summary: updateProjectSummary(),
        type: document.getElementById('type_projet_select').value === 'Autres' ? document.getElementById('autre_type_projet_select').value : document.getElementById('type_projet_select').value,
        panel_ref: panelRefCartouche,
        panel_count: panelCountCartouche,
        total_power: totalPowerCartouche,
        devise: window.getDevise ? window.getDevise() : '€',
        tva: window.getTauxTVA ? window.getTauxTVA() : 20,
        show_prices: document.getElementById('integration_prix') ? document.getElementById('integration_prix').checked : true
    };

    // Bouton de chargement (UX)
    const eventButton = event ? event.currentTarget : null;
    const originalBtnText = eventButton ? eventButton.innerHTML : '📄 Exporter PDF A4';
    if (eventButton) { eventButton.disabled = true; eventButton.innerHTML = '⏳ Capture carte...'; }

    // 2. Capture de la carte (Calepinage)
    let mapImageBase64 = null;
    try {
        const mapElement = document.getElementById('map');
        const formContainer = document.querySelector('.form-container');

        let cropX = 0;
        let captureWidth = mapElement ? mapElement.offsetWidth : 0;

        // Si le formulaire est visible à gauche, on décale la capture pour supprimer la zone grise
        if (formContainer && !formContainer.classList.contains('hidden')) {
            cropX = formContainer.offsetWidth;
            captureWidth = mapElement.offsetWidth - cropX;
        }

        if (mapElement && typeof html2canvas !== 'undefined') {
            const canvasMap = await html2canvas(mapElement, {
                x: mapElement.getBoundingClientRect().left + cropX + window.scrollX,
                y: mapElement.getBoundingClientRect().top + window.scrollY,
                width: captureWidth,
                height: mapElement.offsetHeight,
                useCORS: true,
                allowTaint: true,
                scale: 2, // Résolution suffisante pour impression
                ignoreElements: (node) => {
                    // Masquer systématiquement tous les boutons et la navigation flottante
                    if (node.tagName === "BUTTON" || node.name === "BUTTON" || node.id === "page-navigator") return true;

                    // Récupération sécurisée de la classe (gère aussi les éléments SVG)
                    let className = "";
                    if (typeof node.className === 'string') {
                        className = node.className;
                    } else if (node.className && typeof node.className.baseVal === 'string') {
                        className = node.className.baseVal;
                    }

                    if (!className) return false;

                    // Liste des classes d'éléments UI à masquer sur la carte
                    return className.includes("form-container") || className.includes("sidebar") ||
                        className.includes("demo-nav") || className.includes("custom-map-control") ||
                        className.includes("map-toolbar-vertical") || className.includes("coordinates-display") ||
                        className.includes("suggestions-dropdown") || className.includes("style-switcher-control-inner-container") ||
                        className.includes("buttons-and-search-container") || className.includes("gmnoprint") ||
                        className.includes("gm-bundled-control") || className.includes("gm-style-mtc") ||
                        className.includes("custom-map-control-button") || className.includes("gm-fullscreen-control") ||
                        className.includes("drawing-control") || className.includes("resize-handle") ||
                        className.includes("loading-spinner") || className.includes("loading-indicator") ||
                        className.includes("page-navigator");
                }
            });
            mapImageBase64 = canvasMap.toDataURL('image/jpeg', 0.85);
        }
    } catch (e) { console.warn("Erreur capture map:", e); }

    // 3. Récupération du Logo Entreprise
    let companyLogoBase64 = null;
    try {
        const info = JSON.parse(localStorage.getItem('skv_company_info') || '{}');
        if (info.logo) companyLogoBase64 = info.logo;
    } catch (e) { }

    if (eventButton) { eventButton.innerHTML = '⏳ Génération PDF...'; }

    try {
        const response = await fetch('/concevoir_mon_projet/api/generate-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: data,
                projet_nom: projetParams.nom,
                parametres: projetParams,
                map_image: mapImageBase64,
                company_logo: companyLogoBase64
            })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Liste_Materiel_${projetParams.nom}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } else {
            alert("Erreur lors de la génération du PDF.");
        }
    } catch (error) {
        console.error(error);
        alert("Erreur réseau.");
    } finally {
        // Restauration du bouton
        if (eventButton) { eventButton.disabled = false; eventButton.innerHTML = originalBtnText; }
    }
}

function showTab(id) {
    const configModal = document.getElementById('modalConfig');
    if (!configModal) return;

    // Ouverture manuelle robuste (Bypass Bootstrap)
    configModal.style.setProperty('display', 'block', 'important');
    configModal.style.setProperty('opacity', '1', 'important');
    configModal.style.setProperty('visibility', 'visible', 'important');

    setTimeout(() => {
        configModal.classList.add('show');

        // Bascule manuelle stricte des onglets (tab-pane) pour réparer l'invisibilité
        document.querySelectorAll('#modalTabs .nav-link').forEach(link => link.classList.remove('active'));
        document.querySelectorAll('#modalConfig .tab-pane').forEach(pane => {
            pane.classList.remove('show', 'active', 'd-none', 'fade'); // Nettoyer les classes conflictuelles
            pane.style.setProperty('display', 'none', 'important');
            pane.style.setProperty('visibility', 'hidden', 'important');
            pane.style.setProperty('opacity', '0', 'important');
            pane.style.setProperty('height', '0', 'important');
        });

        const trigger = document.querySelector('#tab-' + id);
        if (trigger) trigger.classList.add('active');

        const targetPane = configModal.querySelector('#' + id);
        if (targetPane) {
            targetPane.classList.remove('d-none');
            targetPane.classList.add('active', 'show');
            targetPane.style.setProperty('display', 'block', 'important');
            targetPane.style.setProperty('visibility', 'visible', 'important');
            targetPane.style.setProperty('opacity', '1', 'important');
            targetPane.style.setProperty('height', 'auto', 'important');
        }
    }, 50); // Délai optimisé pour éviter le clignotement
}

async function runCalcul(type) {
    let params = {};
    if (type === 'chute_tension') {
        const calcMat = document.getElementById('calc_materiau');
        params = {
            longueur: document.getElementById('calc_L').value,
            courant: document.getElementById('calc_I').value,
            section: 6, // Valeur par défaut ou récupérée
            materiau: calcMat ? calcMat.value : 'Cu'
        };
    } else if (type === 'fourreaux') {
        const stdSelect = document.getElementById('fourreau_std');
        const isCustom = stdSelect.value === 'custom';
        let d_ext = 0, d_int = 0;

        if (isCustom) {
            d_ext = document.getElementById('fourreau_ext').value;
            // d_int sera calculé par python (estimé à 80% du diamètre ext) pour la confidentialité
        } else if (stdSelect.selectedIndex > 0) {
            d_ext = stdSelect.value;
            d_int = stdSelect.options[stdSelect.selectedIndex].getAttribute('data-int');
        }

        params = {
            diametre_fourreau: d_ext,
            diametre_int: d_int,
            type_cable: document.getElementById('fourreau_type_cable').value,
            ext_cable: document.getElementById('fourreau_ext_cable').value,
            nb_cables: document.getElementById('fourreau_nb_cables').value,
            nb_circuits: document.getElementById('fourreau_nb_circuits').value,
            inc_cu_nu: document.getElementById('fourreau_inc_cu_nu').checked,
            inc_pe_vj: document.getElementById('fourreau_inc_pe_vj').checked
        };
    }

    const response = await fetch('/concevoir_mon_projet/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: type, params: params })
    });
    const result = await response.json();

    if (type === 'chute_tension') {
        document.getElementById('res_chute').value = `${result.pourcentage}% (${result.delta_u}V)`;
    } else if (type === 'fourreaux') {
        const resDiv = document.getElementById('res_fourreaux');
        if (!params.ext_cable || !params.diametre_fourreau) {
            resDiv.innerHTML = `<span class="text-warning">⚠️ Remplissez toutes les données</span>`;
        } else if (result.conforme) {
            resDiv.innerHTML = `<span class="text-success">✅ Conforme (Taux: ${result.taux}%)</span>`;
        } else {
            resDiv.innerHTML = `<span class="text-danger">❌ Non conforme (Taux: ${result.taux}% > 33.3%)</span>`;
        }
    }
}

function toggleFourreauType() {
    const type = document.getElementById('fourreau_type_cable').value;
    const divMono = document.getElementById('div_fourreau_mono');
    const divMulti = document.getElementById('div_fourreau_multi');
    if (type === 'mono') {
        divMono.classList.remove('d-none');
        divMulti.classList.add('d-none');
    } else {
        divMono.classList.add('d-none');
        divMulti.classList.remove('d-none');
    }
}

function toggleFourreauCustom() {
    const select = document.getElementById('fourreau_std');
    const customDiv = document.getElementById('fourreau_custom_div');
    if (select.value === 'custom') {
        customDiv.classList.remove('d-none');
    } else {
        customDiv.classList.add('d-none');
    }
}

function toggleAutreIndice() {
    const select = document.getElementById('indice_projet');
    const input = document.getElementById('autre_indice_projet');
    if (select.value === 'Autres') {
        input.classList.remove('d-none');
    } else {
        input.classList.add('d-none');
    }
}

function updateProjectLogic() {
    const select = document.getElementById('type_projet_select');
    const divAutre = document.getElementById('div_autre_type_projet');
    const divPvReady = document.getElementById('div_pv_ready');
    const type = select.value;

    // Option "Autres"
    if (type === 'Autres') {
        divAutre.style.display = 'block';
    } else {
        divAutre.style.display = 'none';
    }

    // Logique PV Ready (uniquement Toiture)
    if (type === 'Toiture inclinée' || type === 'Toiture terrasse') {
        divPvReady.classList.remove('d-none');
    } else {
        divPvReady.classList.add('d-none');
        document.getElementById('batiment_pv_ready').checked = false;
    }

    toggleFondations();
}

function toggleFondations() {
    const type = document.getElementById('type_projet_select').value;
    const isPvReady = document.getElementById('batiment_pv_ready').checked;
    const hideFondations = (type === 'Toiture inclinée' || type === 'Toiture terrasse') && isPvReady;

    const secFondations = document.getElementById('sec-fondations');
    if (secFondations) {
        let nextRow = secFondations;
        while (nextRow && (!nextRow.classList.contains('section-divider') || nextRow === secFondations)) {
            if (hideFondations) nextRow.classList.add('d-none');
            else nextRow.classList.remove('d-none');
            nextRow = nextRow.nextElementSibling;
        }
    }
}

function addAutreMaterielModalField() {
    const container = document.getElementById('container_autres_materiels_modal');
    const div = document.createElement('div');
    div.className = 'row g-2 align-items-center autre-materiel-item';
    div.innerHTML = `
        <div class="col-md-2">
            <input type="text" class="form-control form-control-sm am-composant" placeholder="Composant (ex: Parafoudre)">
        </div>
        <div class="col-md-2">
            <input type="text" class="form-control form-control-sm am-designation" placeholder="Désignation / Fab.">
        </div>
        <div class="col-md-2">
            <input type="text" class="form-control form-control-sm am-reference" placeholder="Référence">
        </div>
        <div class="col-md-2">
            <input type="number" class="form-control form-control-sm am-quantite" placeholder="Qté" min="1" oninput="calculerPrixLineaire(this, '.am-quantite', '.am-pu', '.am-pt')">
        </div>
        <div class="col-md-1 price-element">
            <input type="number" class="form-control form-control-sm am-pu" placeholder="PU" oninput="calculerPrixLineaire(this, '.am-quantite', '.am-pu', '.am-pt')">
        </div>
        <div class="col-md-2 price-element">
            <input type="text" class="form-control form-control-sm bg-light am-pt" placeholder="Total" readonly>
        </div>
        <div class="col-md-1 text-center">
            <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.parentElement.parentElement.remove()" title="Supprimer">❌</button>
        </div>
    `;
    container.appendChild(div);
}

function addAutreMaterielACRow() {
    const container = document.getElementById('container_autres_materiels_ac');
    const div = document.createElement('div');
    div.className = 'row g-2 align-items-center autre-mat-ac-row mt-1';
    div.innerHTML = `
        <div class="col-md-2 d-flex align-items-center">
            <input class="form-check-input me-2 am-ac-cb" type="checkbox" checked>
            <input type="text" class="form-control form-control-sm am-ac-composant" placeholder="Composant AC (ex: Appareillage)">
        </div>
        <div class="col-md-2">
            <input type="text" class="form-control form-control-sm am-ac-designation" placeholder="Désignation / Fab.">
        </div>
        <div class="col-md-2">
            <input type="text" class="form-control form-control-sm am-ac-reference" placeholder="Référence">
        </div>
        <div class="col-md-1">
            <input type="number" class="form-control form-control-sm am-ac-quantite" placeholder="Qté" min="1" oninput="calculerPrixLineaire(this, '.am-ac-quantite', '.am-ac-pu', '.am-ac-pt')">
        </div>
        <div class="col-md-2 price-element">
            <input type="number" class="form-control form-control-sm am-ac-pu" placeholder="PU" oninput="calculerPrixLineaire(this, '.am-ac-quantite', '.am-ac-pu', '.am-ac-pt')">
        </div>
        <div class="col-md-2 price-element">
            <input type="text" class="form-control form-control-sm bg-light am-ac-pt" placeholder="Total" readonly>
        </div>
        <div class="col-md-1 text-center">
            <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.parentElement.parentElement.remove()" title="Supprimer">❌</button>
        </div>
    `;
    container.appendChild(div);
}


// Correctif Bug : Focus et Superposition de Modales
document.addEventListener("DOMContentLoaded", function () {

    // --- 1. MODAL D'ERREUR PERSONNALISÉ (Importé de batiment_metal) ---
    window.showCustomModal = function(titleText, message) {
        let existingModal = document.getElementById('custom-validation-error-modal');
        if (existingModal) {
            if (document.getElementById('custom-validation-msg')?.textContent === message) return;
            existingModal.remove();
        }
        const modalBox = document.createElement('div');
        modalBox.id = 'custom-validation-error-modal';
        modalBox.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: #fff; border-radius: 8px; padding: 20px 25px;
            max-width: 450px; width: 90%; box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            text-align: left; font-family: 'Segoe UI', Arial, sans-serif;
            border-left: 6px solid #e74c3c; animation: slideDown 0.3s ease-out;
            z-index: 2147483647; display: flex; align-items: flex-start; gap: 15px;
        `;
        if (!document.getElementById('custom-validation-styles')) {
            const style = document.createElement('style');
            style.id = 'custom-validation-styles';
            style.innerHTML = `@keyframes slideDown { from { transform: translate(-50%, -30px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }`;
            document.head.appendChild(style);
        }
        const icon = document.createElement('div'); icon.innerHTML = '⚠️'; icon.style.cssText = 'font-size: 24px; line-height: 1;';
        const content = document.createElement('div'); content.style.flex = '1';
        const title = document.createElement('h3'); title.textContent = titleText; title.style.cssText = 'margin: 0 0 10px 0; color: #2c3e50; font-size: 18px; font-weight: bold;';
        const msg = document.createElement('p'); msg.id = 'custom-validation-msg'; msg.textContent = message; msg.style.cssText = 'margin: 0 0 15px 0; color: #555; font-size: 14px; line-height: 1.5; word-wrap: break-word;';
        const btn = document.createElement('button'); btn.textContent = 'OK';
        btn.style.cssText = `background: #e74c3c; color: #fff; border: none; padding: 8px 25px; border-radius: 6px; font-size: 14px; cursor: pointer; font-weight: bold; transition: opacity 0.2s; float: right;`;
        const closeModal = () => { modalBox.remove(); document.removeEventListener('keydown', escapeHandler); };
        const escapeHandler = (e) => { if (e.key === 'Escape' || e.key === 'Enter') closeModal(); };
        btn.onclick = closeModal;
        document.addEventListener('keydown', escapeHandler);
        content.appendChild(title); content.appendChild(msg); content.appendChild(btn);
        modalBox.appendChild(icon); modalBox.appendChild(content); document.body.appendChild(modalBox);
        setTimeout(() => btn.focus(), 10);
    };

    // --- 2. MOTEUR DE RÈGLES DE VALIDATION ---
    const RULES = {
        'mod_pu': { type: 'float', getMin: () => 0.01, getMax: () => document.getElementById('mod_tarif_mode').value === 'wc' ? 0.65 : 400.00, label: "Tarification panneaux" },
        'mod_qty': { type: 'int', min: 1, max: 10000, label: "Quantité (Panneaux)" },
        'mod_chaines': { type: 'int', min: 1, max: 200, label: "Quantité (Chaînes PV)" },
        'chaines_pu': { type: 'float', min: 0.01, max: 200.00, label: "PU (Chaînes PV)" },
        'conn_qty': { type: 'int', min: 1, max: 200, label: "Quantité (Connecteurs)" },
        'conn_pu': { type: 'float', min: 0.01, max: 200.00, label: "PU (Connecteurs)" },
        'opti_qty': { type: 'int', min: 1, max: 200, label: "Quantité (Optimiseurs)" },
        'opti_pu': { type: 'float', min: 0.01, max: 300.00, label: "PU (Optimiseurs)" },
        'sys_qty': { type: 'int', min: 1, max: 1, label: "Quantité (Système d'intégration)" },
        'sys_pu': { type: 'float', min: 0.01, max: 100000.00, label: "PU (Système d'intégration)" },
        'ond_pwr': { type: 'float', min: 0.01, max: Infinity, label: "Puissance Onduleur" },
        'ond_rendement': { type: 'float', min: 0.01, max: Infinity, label: "Rendement Onduleur" },
        'ond_qty': { type: 'int', min: 1, max: 50, label: "Quantité Onduleur" },
        'ond_pu': { type: 'float', min: 0.01, max: 10000.00, label: "PU Onduleur" },
        'she_qty': { type: 'int', min: 1, max: 10, label: "Quantité Shelter/TGBT" },
        'she_pu': { type: 'float', min: 0.01, max: 10000.00, label: "PU Shelter/TGBT" },
        'cdc_largeur': { type: 'float', min: 0.01, max: 500, label: "Largeur CDC" },
        'cdc_longueur': { type: 'float', min: 0.01, max: 1000, label: "Longueur CDC" },
        'cdc_pu': { type: 'float', min: 0.01, max: 200.00, label: "PU CDC" },
        'infra_qty': { type: 'int', min: 1, max: 100, label: "Quantité Chambres & Regards" },
        'infra_pu': { type: 'float', min: 0.01, max: 1000.00, label: "PU Chambres & Regards" },
        'fourreau_nb': { type: 'int', min: 1, max: 29, label: "Nbre de fourreaux" },
        'fourreau_longueur': { type: 'float', min: 0.01, max: 5000, label: "Longueur fourreaux" },
        'fourreau_pu': { type: 'float', min: 0.01, max: 500.00, label: "PU fourreaux" },
        '.cable-len': { type: 'float', min: 0.01, max: 50000, label: "Longueur Câble" },
        '.cable-pu': { type: 'float', min: 0.01, max: 500.00, label: "PU Câble" },
        '.am-ac-quantite': { type: 'int', min: 1, max: 50, label: "Quantité (Matériel AC)" },
        '.am-ac-pu': { type: 'float', min: 0.01, max: 10000.00, label: "PU (Matériel AC)" }, // Gérer l'exception "Poste transfo" dynamiquement
        '.am-quantite': { type: 'int', min: 1, max: 50, label: "Quantité (Matériel Divers)" },
        '.am-pu': { type: 'float', min: 0.01, max: 100000.00, label: "PU (Matériel Divers)" }
    };

    window.validateElement = function(element) {
        // Ne pas bloquer la saisie d'un champ momentanément vide
        if (!element.value || element.value.trim() === '') return true;

        // Trouve la règle par ID ou par Classe
        let rule = RULES[element.id];
        if (!rule) {
            for (let className of element.classList) {
                if (RULES['.' + className]) { rule = RULES['.' + className]; break; }
            }
        }
        if (!rule) return true; // Pas de règle stricte pour ce champ

        let value = rule.type === 'int' ? parseInt(element.value, 10) : parseFloat(element.value);
        let min = rule.getMin ? rule.getMin() : rule.min;
        let max = rule.getMax ? rule.getMax() : rule.max;

        // Exception dynamique Poste de transfo
        if (element.classList.contains('am-ac-pu')) {
            const row = element.closest('.autre-mat-ac-row');
            if (row && row.querySelector('.am-ac-composant')?.value === 'Poste de transformation') {
                max = 70000.00;
            }
        }

        if (isNaN(value) || value < min || value > max) {
            window.showCustomModal("Valeur hors limite", `${rule.label} : La valeur saisie (${element.value}) n'est pas autorisée. Elle doit être comprise entre ${min} et ${max}.`);
            
            // Restauration de l'ancienne valeur ou effacement
            element.value = element.dataset.prevVal || '';
            return false;
        }
        return true;
    };

    // Sauvegarde de l'ancienne valeur au focus pour restauration
    document.body.addEventListener('focusin', function(e) {
        if (e.target.tagName === 'INPUT') {
            e.target.dataset.prevVal = e.target.value;
        }
    });

    // Rejet des caractères spéciaux dynamiquement sur tous les champs texte (Strict Défense)
    //
    // CORRECTIF (bug rapporté : « impossible de passer les entraxes sous la forme 4*5+7 dans le
    // formulaire de géométrie 3D, alors que cela fonctionne dans ombriere_metal.html ») : ce filtre
    // est posé sur document.body, donc sur TOUS les champs texte de la page — y compris ceux créés
    // ensuite par d'autres modules. Il effaçait au fil de la frappe « * » et « + » des expressions
    // d'entraxes (« 4*5+7 » devenait « 457 »), sans le moindre message. Les modales de géométrie,
    // elles, vivent dans une IFRAME : leur propre #postDistances échappait à ce listener — d'où la
    // différence de comportement entre les deux formulaires.
    //
    // Un champ dont la syntaxe légitime sort de ce jeu de caractères porte donc désormais
    // `data-saisie-libre` et s'exclut du filtre : il lui revient de valider sa propre saisie
    // (cf. CM.validerEntraxeOmbriere pour les entraxes d'ombrière). Le filtre reste la règle par
    // défaut partout ailleurs.
    document.body.addEventListener('input', function (e) {
        if (e.target.tagName === 'INPUT' && e.target.type === 'text' && !e.target.hasAttribute('data-saisie-libre')) {
            const originalValue = e.target.value;
            // NOUVEAU: Strictement alphanumérique, espaces, tirets et points
            const sanitizedValue = originalValue.replace(/[^a-zA-Z0-9\s\-.]/g, '');
            if (originalValue !== sanitizedValue) {
                e.target.value = sanitizedValue;
            }
        }
    });

    const configModalEl = document.getElementById('modalConfig');
    if (configModalEl) {
        // Force un z-index plus élevé pour la seconde modale et son fond (backdrop)
        configModalEl.addEventListener('show.bs.modal', function () {
            setTimeout(() => {
                const zIndex = 1060;
                configModalEl.style.zIndex = zIndex;
                const backdrops = document.querySelectorAll('.modal-backdrop');
                if (backdrops.length > 1) {
                    backdrops[backdrops.length - 1].style.zIndex = zIndex - 1;
                }
            }, 10);
        });

        configModalEl.addEventListener('hidden.bs.modal', function () {
            const mainAppModal = document.getElementById('mainAppModal');
            if (mainAppModal && mainAppModal.classList.contains('show')) {
                document.body.classList.add('modal-open'); // Restaure le scroll sur l'arrière-plan principal
            }
        });
    }

    // Logique d'ouverture/fermeture pour la nouvelle modale personnalisée
    const appModal = document.getElementById('mainAppModal');
    const backdrop = document.getElementById('liste-materiels-backdrop');
    const modalHeader = document.getElementById('mainAppModal-header');

    // Rendre la modale déplaçable (Désactivé selon demande)
    if (modalHeader && appModal) {
        /*
        let isDragging = false;
        let offsetX, offsetY;
        modalHeader.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetX = e.clientX - appModal.offsetLeft;
            offsetY = e.clientY - appModal.offsetTop;
            document.onmousemove = (e) => {
                if (isDragging) { appModal.style.left = `${e.clientX - offsetX}px`; appModal.style.top = `${e.clientY - offsetY}px`; appModal.style.transform = 'none'; }
            };
            document.onmouseup = () => { isDragging = false; document.onmousemove = null; document.onmouseup = null; };
        });
        */
    }

    // Fonction de fermeture dédiée et infaillible pour le modal Expertise
    window.closeModalConfig = function (e) {
        if (e) e.preventDefault();
        const configModal = document.getElementById('modalConfig');
        if (configModal) {
            configModal.classList.remove('show');
            setTimeout(() => {
                configModal.style.setProperty('display', 'none', 'important');
            }, 150);
        }
    };

    // Attacher explicitement aux boutons du modal Expertise
    const closeBtnExpertise = document.getElementById('close-modalConfig-btn');
    const cancelBtnExpertise = document.getElementById('cancel-modalConfig-btn');
    if (closeBtnExpertise) closeBtnExpertise.onclick = window.closeModalConfig;
    if (cancelBtnExpertise) cancelBtnExpertise.onclick = window.closeModalConfig;

    // Forcer la fermeture manuelle pour les autres boutons
    document.querySelectorAll('[data-bs-dismiss="modal"], #close-mainAppModal').forEach(btn => {
        btn.onclick = function (e) {
            if (e) e.preventDefault();
            const modal = this.closest('.modal') || this.closest('#mainAppModal');
            if (modal && modal.id !== 'modalConfig') {
                modal.classList.remove('show');
                setTimeout(() => {
                    modal.style.setProperty('display', 'none', 'important');
                    if (modal.id === 'mainAppModal') {
                        document.body.style.overflow = '';
                        if (backdrop) backdrop.style.display = 'none';
                    }
                }, 150);
            }
        };
    });

    // Si on clique sur le fond sombre principal, déclencher le bouton de fermeture principal
    if (backdrop) {
        backdrop.onclick = function () {
            const btn = document.getElementById('close-mainAppModal');
            if (btn) btn.click();
        };
    }

    // Navigation manuelle entre les onglets pour modalConfig
    const modalTabs = document.querySelector('#modalTabs');
    if (modalTabs) {
        modalTabs.addEventListener('click', function (event) {
            if (event.target.matches('.nav-link[data-bs-toggle="tab"]')) {
                event.preventDefault();
                event.stopPropagation();
                const targetId = event.target.getAttribute('data-bs-target').replace('#', '');
                showTab(targetId);
            }
        });
    }

    // Initialisation
    document.getElementById('date_projet').valueAsDate = new Date();
    updateProjectLogic();
    updateProjectSummary();

    // Synchronisation au démarrage
    syncSummaryData();
});

// =======================================================
// Application des correctifs d'interface demandés (UI/UX)
// =======================================================
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        // 0. Élargir le modal "Expertise Matériel et Calculs"
        const modalConfigDialog = document.querySelector('#modalConfig .modal-dialog');
        if (modalConfigDialog) {
            modalConfigDialog.style.setProperty('max-width', '90vw', 'important');
            modalConfigDialog.style.setProperty('width', '90vw', 'important');
        }

        // 1. Onglet Câbles : Ajuster largeurs et hauteur
        const cablesTab = document.getElementById('cables');
        if (cablesTab) {
            const row = cablesTab.querySelector('.row');
            if (row) {
                // 1. Forcer l'affichage horizontal STRICT (Côte à côte) de la ligne parente
                row.style.setProperty('display', 'flex', 'important');
                row.style.setProperty('flex-direction', 'row', 'important');
                row.style.setProperty('flex-wrap', 'nowrap', 'important'); // Interdit le passage à la ligne
                
                const cols = Array.from(row.children);
                cols.forEach(col => {
                    if (col.textContent.includes('Calculateur de chute de tension')) {
                        // Nettoyer les éventuelles classes col-12 ou col-lg-12 forçant la verticalité
                        Array.from(col.classList).forEach(c => { if(c.startsWith('col')) col.classList.remove(c); });
                        col.style.setProperty('width', '33.33%', 'important');
                        col.style.setProperty('flex', '0 0 33.33%', 'important');
                        col.style.setProperty('max-width', '33.33%', 'important');
                        col.style.setProperty('padding-left', '20px', 'important');
                        row.appendChild(col); // Force le placement à droite (dernier élément de la ligne)
                        
                        // Ajouter la liste déroulante Type de câble si absente
                        if (!document.getElementById('calc_materiau')) {
                            const btnCalc = col.querySelector('button[onclick*="chute_tension"]');
                            if (btnCalc) {
                                const fg = document.createElement('div');
                                fg.className = 'mb-2';
                                fg.innerHTML = `
                                    <label class="form-label" style="font-size: 0.85rem; font-weight: bold;">Type de câble</label>
                                    <select id="calc_materiau" class="form-select form-select-sm">
                                        <option value="Cu">Cuivre</option>
                                        <option value="Alu">Aluminium</option>
                                    </select>
                                `;
                                btnCalc.parentNode.insertBefore(fg, btnCalc);
                            }
                        }
                        
                        // Réduire la largeur des champs de saisie pour ce bloc
                        const calcInputs = col.querySelectorAll('input:not([type="checkbox"]), select');
                        calcInputs.forEach(input => {
                            input.style.setProperty('max-width', '160px', 'important');
                        });
                    } else if (col.textContent.includes('Sélection des câbles')) {
                        // Nettoyer les éventuelles classes col-12 ou col-lg-12 forçant la verticalité
                        Array.from(col.classList).forEach(c => { if(c.startsWith('col')) col.classList.remove(c); });
                        col.style.setProperty('width', '66.66%', 'important');
                        col.style.setProperty('flex', '0 0 66.66%', 'important');
                        col.style.setProperty('max-width', '66.66%', 'important');
                        col.style.setProperty('padding-right', '15px', 'important');
                        
                        // 3. Extension de la hauteur de la section pour occuper presque tout le modal
                        const listContainer = col.querySelector('.card-body') || col.querySelector('.list-group') || col;
                        if (listContainer) {
                            listContainer.style.setProperty('min-height', '65vh', 'important');
                            listContainer.style.setProperty('max-height', '75vh', 'important');
                            listContainer.style.setProperty('overflow-y', 'auto', 'important');
                        }
                        
                        // 2. Ajustement majeur de la hauteur des cellules et espacements
                        const rows = col.querySelectorAll('.cable-row, .list-group-item');
                        rows.forEach(r => {
                            r.style.setProperty('min-height', '95px', 'important');
                            r.style.setProperty('margin-bottom', '15px', 'important');
                            r.style.setProperty('padding', '15px 0', 'important');
                            r.style.setProperty('align-items', 'center', 'important');
                            r.style.setProperty('border-bottom', '1px solid #eee', 'important');
                            
                            const labels = r.querySelectorAll('label, .form-check-label');
                            labels.forEach(lbl => {
                                lbl.style.setProperty('white-space', 'normal', 'important');
                                lbl.style.setProperty('word-break', 'break-word', 'important');
                                lbl.style.setProperty('display', 'inline-block', 'important');
                                lbl.style.setProperty('min-width', '280px', 'important'); // Force l'espacement initial
                                lbl.style.setProperty('margin-right', '40px', 'important'); // Éloigne les champs de saisie
                            });
                        });
                        
                        // Élargir les champs de saisie de la section
                        const inputs = col.querySelectorAll('input:not([type="checkbox"]), select');
                        inputs.forEach(input => {
                            input.style.setProperty('width', '100%', 'important');
                            input.style.setProperty('max-width', '200px', 'important');
                        });
                    }
                });
            }
        }

        // 2. Onglet Autres matériels : Bouton blanc pour l'ajout
        const autresTab = document.getElementById('autres');
        if (autresTab) {
            const btns = autresTab.querySelectorAll('button');
            btns.forEach(btn => {
                if (btn.textContent.includes('+ Ajouter un champ')) {
                    btn.style.setProperty('color', '#ffffff', 'important');
                }
            });
        }

        // 3. Bouton "Choisir la structure et fondations" dans le tableau "Matériel projet"
        const secStructure = document.getElementById('sec-structure');
        if (secStructure && !secStructure.querySelector('button')) {
            const td = secStructure.querySelector('td');
            if (td) {
                td.style.fontWeight = 'bold'; // Mettre le titre en gras
                
                const btn = document.createElement('button');
                btn.className = 'btn ms-3 d-inline-flex align-items-center justify-content-center'; // Centrage interne
                btn.style.cssText = 'background-color: #de0000; color: #ffffff; border: 1px solid #de0000; padding: 4px 10px; font-size: 0.875rem; border-radius: 4px; font-weight: 500; height: 38px; min-width: max-content; white-space: nowrap;';
                btn.innerHTML = '<i class="fas fa-cogs me-2"></i> Choisir structure & fondations'; // Ajout icône + texte ajusté
                btn.onclick = () => { if(typeof showTab === 'function') showTab('autres'); };
                td.appendChild(btn); // Place après le texte (Titre à gauche, bouton à droite)
            }
        }
        
        // Mettre en gras le titre de la section Fondations
        const secFondations = document.getElementById('sec-fondations');
        if (secFondations) {
            const td = secFondations.querySelector('td');
            if (td) td.style.fontWeight = 'bold';
        }
        
        // 4. Marges (padding) globales du tableau pour sécuriser l'affichage de la corbeille
        const tableMateriels = document.getElementById('tableMateriels');
        if (tableMateriels) {
            const cells = tableMateriels.querySelectorAll('th, td');
            cells.forEach(cell => {
                cell.style.setProperty('padding-left', '12px', 'important');
                cell.style.setProperty('padding-right', '12px', 'important');
            });
        }
    }, 1500); // Exécuté après le rendu complet de la modale
});