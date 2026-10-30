/**
 * ============================================================
 * MODULE : GESTIONNAIRE DE PERSISTANCE POUR LE MODAL IRVE
 * Fichier : IrveStorageManager.js
 * ============================================================
 * 
 * Sauvegarde et restaure l'état complet du modal IRVE dans le localStorage.
 * Cela inclut les matériels, les paramètres de bilan, la planification énergétique, etc.
 */

class IrveStorageManager {
    constructor() {
        this.STORAGE_KEY_PREFIX = 'skv_irve_session_data';
        this.isRestoring = false;
    }

    /**
     * CORRECTIF (bug rapporté : fuite de données entre projets — les bornes IRVE et paramètres de
     * bilan de puissance d'un projet apparaissaient dans tous les autres projets) : la clé était
     * fixe ('skv_irve_session_data'), donc un seul et même compartiment localStorage partagé par
     * TOUS les projets ouverts sur ce navigateur. Elle inclut désormais l'identifiant du projet
     * actif — même source (localStorage.current_projet_id) que _sgGetProjectId()
     * (switchgrid_workflow.js) et getProjetId() (irve_payload_builder.js), déjà utilisée ailleurs
     * dans ce même module pour identifier le projet en cours. Calculée à chaque appel (pas une
     * seule fois au constructeur) au cas où elle ne serait pas encore disponible à l'instanciation.
     */
    _getStorageKey() {
        const projectId = localStorage.getItem('current_projet_id') || 'no-project';
        return `${this.STORAGE_KEY_PREFIX}_${projectId}`;
    }

    /**
     * Collecte toutes les données pertinentes du modal IRVE.
     * @returns {Object | null} - Un objet contenant l'état du modal, ou null.
     */
    collectData() {
        if (typeof window.irveData === 'undefined') return null;

        const data = {
            // Onglet Matériels
            irveData: window.irveData || [],
            irveCounter: window.irveCounter || 0,

            // Onglet Bilan de Puissance
            bilan: {
                ks: document.getElementById('ks')?.value,
                kmono: document.getElementById('kmono')?.value,
                ktri: document.getElementById('ktri')?.value,
                kdc: document.getElementById('kdc')?.value,
                cosphi_ac: document.getElementById('cosphi_ac')?.value,
                cosphi_dc: document.getElementById('cosphi_dc')?.value,
                puissance_aux: document.getElementById('puissance_aux')?.value,
                mode_raccordement: document.querySelector('input[name="mode_raccordement"]:checked')?.value,
                puissance_transfo: document.getElementById('puissance_transfo')?.value,
                puissance_souscrite: document.getElementById('puissance_souscrite')?.value,
                source_alim: document.querySelector('input[name="source_alim"]:checked')?.value,
                limitation_puissance: document.getElementById('limitation_puissance')?.value,
                gestion_puissance: document.querySelector('input[name="gestion_puissance"]:checked')?.value,
                dpm_type: document.querySelector('input[name="dpm_type"]:checked')?.value,
            },

            // Onglet Énergie
            energie: {
                pas_temps: document.getElementById('pas_temps')?.value,
                nb_jours_non_ouvres: document.getElementById('nb_jours_non_ouvres')?.value,
                jours_feries: document.getElementById('jours_feries')?.value,
                export_annee: document.getElementById('export_annee')?.value,
                conso_mode: document.querySelector('input[name="conso_mode"]:checked')?.value,
                rendement_borne_ac: document.getElementById('rendement_borne_ac')?.value,
                rendement_borne_dc: document.getElementById('rendement_borne_dc')?.value,
                seasonalHourlyData: window.seasonalHourlyData || {},
                irveGroups: window.irveGroups || [],
                irveChargingPlan: window.irveChargingPlan || {},
                horoConfig: window.horoConfig || {},
            },

            // État de l'application
            activeTab: window.activeTab || 'materiels',
            bilanCalculated: window.bilanCalculated || false,
            simulationResults: window.simulationResults || null,
        };
        return data;
    }

    /**
     * Sauvegarde les données dans le localStorage.
     */
    saveData() {
        if (this.isRestoring) return; // Ne pas sauvegarder pendant la restauration
        const data = this.collectData();
        if (data) {
            localStorage.setItem(this._getStorageKey(), JSON.stringify(data));
        }
    }

    /**
     * Charge les données depuis le localStorage et restaure l'état de l'interface.
     */
    restoreData() {
        const savedData = localStorage.getItem(this._getStorageKey());
        if (!savedData) return;

        this.isRestoring = true;
        try {
            const data = JSON.parse(savedData);

            // Fonctions utilitaires pour la restauration
            const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
            const setRadio = (name, val) => { if (val) { const el = document.querySelector(`input[name="${name}"][value="${val}"]`); if (el) el.checked = true; } };

            // Restauration Onglet Matériels
            window.irveData = data.irveData || [];
            window.irveCounter = data.irveCounter || 0;

            // Restauration Onglet Bilan
            if (data.bilan) {
                Object.keys(data.bilan).forEach(key => {
                    if (key.startsWith('mode_') || key.startsWith('source_') || key.startsWith('gestion_') || key.startsWith('dpm_')) {
                        setRadio(key, data.bilan[key]);
                    } else {
                        setVal(key, data.bilan[key]);
                    }
                });
            }

            // Restauration Onglet Énergie
            if (data.energie) {
                Object.keys(data.energie).forEach(key => {
                    if (key === 'conso_mode') {
                        setRadio(key, data.energie[key]);
                    } else if (typeof data.energie[key] === 'object') {
                        window[key] = data.energie[key];
                    } else {
                        setVal(key, data.energie[key]);
                    }
                });
            }

            // Restauration de l'état de l'application
            window.bilanCalculated = data.bilanCalculated || false;
            window.simulationResults = data.simulationResults || null;

            // Mise à jour de l'UI après restauration
            if (typeof window.updateTotals === 'function') window.updateTotals();
            if (typeof window.updateDPMDisplay === 'function') window.updateDPMDisplay();
            if (typeof window.updateRaccordementMode === 'function') window.updateRaccordementMode();
            if (typeof window.toggleConsoMode === 'function') window.toggleConsoMode(data.energie?.conso_mode || 'manual');
            if (typeof window.updateTimeSlider === 'function') window.updateTimeSlider();
            if (typeof window.calculateAverageExistingData === 'function') calculateAverageExistingData();
            
            // Recréer les tables et graphiques
            const materielsTbody = document.querySelector('#irve-selection-table tbody');
            if (materielsTbody) {
                materielsTbody.innerHTML = '';
                window.irveData.forEach(item => this.restoreIrveRow(item));
            }
            if (typeof window.updatePlanningDetailTable === 'function') updatePlanningDetailTable();
            // CORRECTIF (ouverture du modal déclenchant un recalcul/une sauvegarde automatique) :
            // ce recalcul automatique de calculateEnergie() à la simple restauration de l'état
            // (donc à CHAQUE ouverture du modal) déclenche à son tour l'enregistrement de la courbe
            // IRVE en base (cf. calcul_irve.js) — l'utilisateur perçoit cela comme "l'ouverture
            // sauvegarde toute seule". simulationResults reste restauré (pour tout ce qui le lit
            // sans redessiner les graphiques) ; l'utilisateur reclique sur "Calculer" pour les
            // régénérer, comme lorsque des données deviennent obsolètes ailleurs dans l'application.
            if (typeof window.switchTab === 'function') window.switchTab(data.activeTab || 'materiels');

            console.log('✅ Données du modal IRVE restaurées depuis le localStorage.');

        } catch (error) {
            console.error("Erreur lors de la restauration des données IRVE:", error);
            localStorage.removeItem(this._getStorageKey()); // Nettoyer les données corrompues
        } finally {
            this.isRestoring = false;
        }
    }

    /**
     * Recrée une ligne dans la table des matériels.
     * @param {Object} item - L'objet de données pour une borne.
     */
    restoreIrveRow(item) {
        const tableBody = document.querySelector('#irve-selection-table tbody');
        const newRow = tableBody.insertRow();
        newRow.id = `irve-row-${item.id}`;
        newRow.setAttribute('data-id', item.id);

        const pwrOptions = (item.type === 'AC' ? PUISSANCES_AC.map(p => `<option value="${p.value}" ${p.value == item.puissance ? 'selected' : ''}>${p.label}</option>`) : PUISSANCES_DC.map(p => `<option value="${p}" ${p == item.puissance ? 'selected' : ''}>${p} kW</option>`)).join('');

        newRow.innerHTML = `
            <td id="fab-cell-${item.id}">${generateManufacturerHtml(item.id, item.fabricant)}</td>
            <td><select id="type-${item.id}" class="modern-input" onchange="updateIrveType(${item.id}, this.value)"><option value="AC" ${item.type === 'AC' ? 'selected' : ''}>AC</option><option value="DC" ${item.type === 'DC' ? 'selected' : ''}>DC</option></select></td>
            <td id="tens-cell-${item.id}">${generateTensionHtml(item.id, item.tension)}</td>
            <td><select id="pwr-${item.id}" class="modern-input" onchange="updateIrvePuissance(${item.id}, this.value)">${pwrOptions}</select></td>
            <td><input type="number" id="pdc-${item.id}" class="modern-input" value="${item.pdc}" min="1" max="3" onchange="updateIrveData(${item.id}, 'pdc', parseInt(this.value) || 1)"></td>
            <td><input type="number" id="qty-${item.id}" class="modern-input" value="${item.quantite}" min="1" onchange="updateIrveData(${item.id}, 'quantite', parseInt(this.value) || 1)"></td>
            <td id="total-pwr-${item.id}">${(item.puissance * item.quantite * item.pdc).toFixed(2)}</td>
            <td><button class="btn-danger" onclick="removeRow(${item.id}, this)">Suppr.</button></td>
        `;
    }
}

// Initialisation du gestionnaire de stockage
window.irveStorageManager = new IrveStorageManager();

document.addEventListener('DOMContentLoaded', () => {
    window.irveStorageManager.restoreData();

    // Sauvegarde automatique sur les changements
    const modal = document.getElementById('app-modal');
    if (modal) {
        modal.addEventListener('input', () => window.irveStorageManager.saveData());
        modal.addEventListener('change', () => window.irveStorageManager.saveData());
    }
});

window.addEventListener('beforeunload', () => {
    window.irveStorageManager.saveData();
});