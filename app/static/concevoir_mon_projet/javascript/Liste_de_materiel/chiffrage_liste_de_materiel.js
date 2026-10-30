/**
 * Module de Chiffrage Financier - Liste de Matériels
 * Gère les calculs de prix, la TVA, les devises et la prévisualisation du projet.
 */

document.addEventListener('DOMContentLoaded', () => {
    updateCurrencyLabels();
    if (typeof window.initPriceElements === 'function') window.initPriceElements();
    if (typeof window.togglePriceVisibility === 'function') window.togglePriceVisibility();
});

// ==========================================
// 1. GESTION DES DEVISES ET DE LA TVA
// ==========================================

window.updateCurrencyLabels = function() {
    const devise = document.querySelector('input[name="devise_projet"]:checked')?.value || '€';
    document.querySelectorAll('.currency-label').forEach(el => el.textContent = devise);
    
    // Mettre à jour la devise dynamiquement dans le tableau existant
    const table = document.getElementById('tableMateriels');
    if (table) {
        const rows = table.querySelectorAll('tbody tr:not(.section-divider)');
        rows.forEach(row => {
            const puRaw = parseFloat(row.getAttribute('data-pu')) || 0;
            if (puRaw > 0 && row.cells.length >= 5) {
                const qtyText = row.cells[3].innerText;
                const qtyMatch = qtyText.match(/([\d.]+)/);
                const qtyVal = qtyMatch ? parseFloat(qtyMatch[1]) : 0;
                const total = qtyVal * puRaw;
                row.cells[4].innerText = `${total.toFixed(2)} ${devise}`;
            } else if (row.cells.length >= 5 && row.cells[4].innerText !== "0.00" && row.cells[4].innerText !== "-") {
                const priceText = row.cells[4].innerText.replace(/[^0-9.-]+/g,"");
                const priceVal = parseFloat(priceText);
                if (!isNaN(priceVal)) {
                    row.cells[4].innerText = `${priceVal.toFixed(2)} ${devise}`;
                }
            }
        });
    }
    lockExport(); // Bloquer l'export s'il y a un changement après une prévisualisation
};

window.toggleCustomTVA = function() {
    const select = document.getElementById('tva_projet');
    const customDiv = document.getElementById('div_tva_custom');
    if (select && customDiv) {
        if (select.value === 'autres') {
            customDiv.classList.remove('d-none');
        } else {
            customDiv.classList.add('d-none');
            const customInput = document.getElementById('tva_custom');
            if (customInput) customInput.value = '';
        }
    }
    lockExport();
};

window.getTauxTVA = function() {
    const select = document.getElementById('tva_projet');
    if (!select) return 20; // Par défaut
    if (select.value === 'autres') {
        return parseFloat(document.getElementById('tva_custom')?.value) || 0;
    }
    return parseFloat(select.value) || 0;
};

window.getDevise = function() {
    const checked = document.querySelector('input[name="devise_projet"]:checked');
    return checked ? checked.value : '€';
};

// ==========================================
// MASQUAGE DYNAMIQUE DES PRIX (Zero-Regression)
// ==========================================
window.togglePriceVisibility = function() {
    const checkbox = document.getElementById('integration_prix');
    const modal = document.getElementById('modalConfig');
    const appContainer = document.getElementById('pv-app-container');
    
    if (checkbox) {
        if (checkbox.checked) {
            if (modal) modal.classList.remove('hide-prices');
            if (appContainer) appContainer.classList.remove('hide-prices');
        } else {
            if (modal) modal.classList.add('hide-prices');
            if (appContainer) appContainer.classList.add('hide-prices');
        }
    }
};

// Identifie et tagge dynamiquement les colonnes contenant des prix pour faciliter le masquage sans casser la logique DOM
window.initPriceElements = function() {
    const priceInputs = document.querySelectorAll('#modalConfig input[id$="_pu"], #modalConfig input[id$="_pt"], #modalConfig .cable-pu, #modalConfig .cable-pt, #modalConfig .am-ac-pu, #modalConfig .am-ac-pt, #modalConfig .am-pu, #modalConfig .am-pt, #modalConfig select#mod_tarif_mode');
    priceInputs.forEach(input => {
        if (input.classList.contains('cable-pu') || input.classList.contains('cable-pt')) {
            input.classList.add('price-element'); // Les câbles n'ont pas de conteneur colonne séparé
        } else {
            const col = input.closest('[class*="col-"]');
            if (col) col.classList.add('price-element'); // Masquer toute la colonne
        }
    });
};


// ==========================================
// 2. CALCULS PAR COMPOSANT (MODAL EXPERTISE)
// ==========================================

// 2.1 Panneaux Solaires (Mode de tarification Wc ou par Panneau)
window.calculerPrixPanneaux = function() {
    const puInput = document.getElementById('mod_pu');
    const qtyInput = document.getElementById('mod_qty');
    
    // Validation stricte (rejette la valeur si hors limite, puis effectue le calcul sur la valeur corrigée)
    if (puInput) window.validateElement(puInput);
    if (qtyInput) window.validateElement(qtyInput);

    const modeSelect = document.getElementById('mod_tarif_mode');
    const mode = modeSelect ? modeSelect.value : 'panneau';
    const pu = parseFloat(puInput?.value) || 0;
    const qty = parseFloat(qtyInput?.value) || 0;
    const pwr = parseFloat(document.getElementById('mod_pwr_unit')?.value) || 0; // Puissance en Wc

    let total = 0;
    let effectivePU = pu; // PU qui sera envoyé au backend pour multiplier par la Quantité

    if (mode === 'panneau') {
        total = pu * qty;
    } else if (mode === 'wc') {
        total = pu * pwr * qty;
        effectivePU = pu * pwr; // Le prix par panneau équivalent pour le backend
    }
    
    const ptInput = document.getElementById('mod_pt');
    if (ptInput) ptInput.value = total.toFixed(2);
    
    if (puInput) puInput.setAttribute('data-effective-pu', effectivePU);
    
    // Sécurité : verrouiller l'export en cas de modification
    if (typeof window.lockExport === 'function') window.lockExport();
};

// 2.2 Fonction générique (Quantité unitaire * Prix Unitaire)
window.calculerPrixGenerique = function(qtyId, puId, ptId) {
    const qtyInput = document.getElementById(qtyId);
    const puInput = document.getElementById(puId);

    if (qtyInput) window.validateElement(qtyInput);
    if (puInput) window.validateElement(puInput);

    const qty = parseFloat(qtyInput?.value) || 0;
    const pu = parseFloat(puInput?.value) || 0;
    const ptInput = document.getElementById(ptId);
    if (ptInput) ptInput.value = (qty * pu).toFixed(2);
    
    // Sécurité : verrouiller l'export en cas de modification
    if (typeof window.lockExport === 'function') window.lockExport();
};

// 2.3 Matériels au Mètre Linéaire (Câbles, Réseaux, Fourreaux)
window.calculerPrixLineaire = function(inputEl, qtyClass, puClass, ptClass) {
    if (!inputEl) return;
    const row = inputEl.closest('.row, .cable-row, .list-group-item, .autre-mat-ac-row, .autre-materiel-item');
    if (!row) return;

    const lenInput = row.querySelector(qtyClass);
    const puInput = row.querySelector(puClass);
    
    if (lenInput) window.validateElement(lenInput);
    if (puInput) window.validateElement(puInput);

    const len = parseFloat(lenInput?.value) || 0;
    let multiplier = 1;
    
    // Cas spécial pour les fourreaux (Nombre de fourreaux * Longueur)
    const nbInput = row.querySelector('.qty-multiplier');
    if (nbInput) multiplier = parseFloat(nbInput.value) || 1;
    const pu = parseFloat(puInput?.value) || 0;
    
    const ptInput = row.querySelector(ptClass);
    if(ptInput) ptInput.value = (len * multiplier * pu).toFixed(2);
    
    // Sécurité : verrouiller l'export en cas de modification
    if (typeof window.lockExport === 'function') window.lockExport();
};

window.validerDevis = function() {
    const btnExportMain = document.getElementById('btn_export_pdf');
    const btnExportModal = document.getElementById('btn_export_pdf_modal');
    const btnValider = document.getElementById('btn_valider_devis');
    
    if (btnExportMain) btnExportMain.disabled = false;
    if (btnExportModal) btnExportModal.disabled = false;
    
    if (btnValider) {
        btnValider.innerHTML = '✅ Devis validé';
        btnValider.classList.remove('btn-success');
        btnValider.classList.add('btn-outline-success');
    }
};

// ==========================================
// 3. PREVISUALISATION ET SECURITE
// ==========================================

window.previewChiffrage = function() {
    let totalHT = 0;
    const table = document.getElementById('tableMateriels');
    if (!table) return;

    const showPrices = document.getElementById('integration_prix')?.checked ?? true;
    let rowsHTML = '';
    // Récupérer toutes les lignes valides du tableau (en incluant les séparateurs)
    const rows = table.querySelectorAll('tbody tr:not(.d-none)');

    rows.forEach(row => {
        if (row.classList.contains('section-divider')) {
            let clone = row.cloneNode(true);
            clone.querySelectorAll('button').forEach(b => b.remove());
            const categoryTitle = clone.innerText.trim();
            const colSpan = showPrices ? 5 : 4;
            rowsHTML += `<tr style="background-color: #ebedef;">
                <td colspan="${colSpan}" style="font-weight: bold; padding: 10px 15px; border-bottom: 1px solid #cbd5e1; color: #2c3e50; text-align: left;">${categoryTitle}</td>
            </tr>`;
        } else {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 5) {
                const prixText = cells[4].innerText.replace(/[^0-9.-]+/g,"");
                totalHT += parseFloat(prixText) || 0;
                
                let priceCellHtml = '';
                if (showPrices) {
                    priceCellHtml = `<td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: bold; white-space: nowrap;">${cells[4].innerText}</td>`;
                }

                rowsHTML += `<tr>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center;">${cells[0].innerText}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center;">${cells[1].innerText}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center;">${cells[2].innerText}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: center;">${cells[3].innerText}</td>
                    ${priceCellHtml}
                </tr>`;
            }
        }
    });

    const tva = getTauxTVA();
    const montantTVA = totalHT * (tva / 100);
    const totalTTC = totalHT + montantTVA;
    const devise = getDevise();

    // Sauvegarde du calcul global pour l'envoi au backend (Sécurité)
    window.total_ht_front_calcule = totalHT;

    const nomProjet = document.getElementById('nom_projet')?.value || 'Projet Solaire';

    let thPriceHtml = showPrices ? `<th style="padding: 10px; text-align: right; width: 140px;">Prix HT (${devise})</th>` : '';
    let summaryHtml = '';
    
    if (showPrices) {
        summaryHtml = `
        <div style="float: right; width: 320px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                <span style="color: #475569;">Total HT:</span>
                <strong style="color: #0f172a;">${totalHT.toFixed(2)} ${devise}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                <span style="color: #475569;">TVA (${tva}%):</span>
                <strong style="color: #0f172a;">${montantTVA.toFixed(2)} ${devise}</strong>
            </div>
            <div style="border-top: 2px solid #cbd5e1; padding-top: 15px; display: flex; justify-content: space-between;">
                <span style="color: #dc2626; font-weight: bold; font-size: 1.1rem;">Total TTC:</span>
                <strong style="color: #dc2626; font-size: 1.1rem;">${totalTTC.toFixed(2)} ${devise}</strong>
            </div>
        </div>`;
    }

    // Injection dans le Modal
    const modalBody = document.getElementById('previewChiffrageBody');
    if (modalBody) {
        modalBody.innerHTML = `
            <div style="margin-bottom: 20px;">
                <h4 style="color: #334155; margin-bottom: 5px;">${nomProjet}</h4>
                <p style="color: #64748b; font-size: 0.9rem;">Détail estimatif des coûts</p>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem; margin-bottom: 30px;">
                <thead>
                    <tr style="background-color: #e2e8f0; color: #334155; text-align: center;">
                        <th style="padding: 10px; text-align: center;">Composants</th>
                        <th style="padding: 10px; text-align: center;">Désignation / Fabricant</th>
                        <th style="padding: 10px; text-align: center;">Référence</th>
                        <th style="padding: 10px; text-align: center;">Quantité</th>
                        ${thPriceHtml}
                    </tr>
                </thead>
                <tbody>
                    ${rowsHTML}
                </tbody>
            </table>
            ${summaryHtml}
            <div style="clear: both;"></div>
        `;
    }

    // Ouvrir la modale
    const modalEl = document.getElementById('previewChiffrageModal');
    const backdrop = document.getElementById('previewChiffrageModal-backdrop');
    if (modalEl) {
        modalEl.style.display = 'flex';
        modalEl.classList.add('show');
        if(backdrop) backdrop.style.display = 'block';

        // Ajustement de la hauteur du modal pour un meilleur affichage
        const modalDialog = modalEl.querySelector('.modal-dialog');
        if (modalDialog) {
            modalDialog.style.maxHeight = '90vh';
            modalDialog.style.height = '90vh';
        }
        const modalContent = modalEl.querySelector('.modal-content');
        if (modalContent) {
            modalContent.style.height = '100%';
            modalContent.style.display = 'flex';
            modalContent.style.flexDirection = 'column';
        }
        if (modalBody) {
            modalBody.style.overflowY = 'auto';
            modalBody.style.flex = '1';
        }
    }

    // Réinitialiser les boutons de validation au chargement de l'aperçu
    const btnExportMain = document.getElementById('btn_export_pdf');
    const btnExportModal = document.getElementById('btn_export_pdf_modal');
    const btnValider = document.getElementById('btn_valider_devis');
    
    if (btnExportMain) btnExportMain.disabled = true;
    if (btnExportModal) btnExportModal.disabled = true;
    
    if (btnValider) {
        btnValider.innerHTML = 'Valider le devis';
        btnValider.classList.remove('btn-outline-success');
        btnValider.classList.add('btn-success');
    }
};

window.lockExport = function() {
    const btnExportMain = document.getElementById('btn_export_pdf');
    const btnExportModal = document.getElementById('btn_export_pdf_modal');
    const btnValider = document.getElementById('btn_valider_devis');
    
    if (btnExportMain) btnExportMain.disabled = true;
    if (btnExportModal) btnExportModal.disabled = true;
    
    if (btnValider) {
        btnValider.innerHTML = 'Valider le devis';
        btnValider.classList.remove('btn-outline-success');
        btnValider.classList.add('btn-success');
    }
};

// ==========================================
// 4. INTERCEPTION GLOBALE API (Sécurité Chiffrage)
// ==========================================
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const [resource, config] = args;
    if (typeof resource === 'string' && resource.includes('/concevoir_mon_projet/api/generate-pdf') && config && config.body) {
        try {
            const bodyData = JSON.parse(config.body);
            if (bodyData.total_ht_front === undefined) {
                bodyData.total_ht_front = window.total_ht_front_calcule || 0;
                config.body = JSON.stringify(bodyData);
            }
        } catch (e) {
            console.error("Erreur lors de l'injection de sécurité:", e);
        }
    }
    return originalFetch.apply(this, args);
};
