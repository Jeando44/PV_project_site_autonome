
// =========================================================================
// MODULE SIMULATION DYNAMIQUE (SMART CHARGING / V1G)
// =========================================================================

window.SmartCharging = {
    MODES: {
        STANDARD: 'standard',
        DPM: 'dpm',
        ECO: 'eco'
    },

    initGroupConfig: function(group) {
        if (!group.smartMode) group.smartMode = this.MODES.STANDARD;

        if (group.targetKwh === undefined) group.targetKwh = 0;
        if (group.departureHour === undefined) group.departureHour = 8;
        if (group.autoEcoRecharge === undefined) group.autoEcoRecharge = false;
        if (group.batteryCapacity === undefined) group.batteryCapacity = 50;
    },

    /**
     * Stratégies autorisées selon le Mode de Gestion de la recharge des bornes :
     * - Dynamique -> uniquement Écrêtage strict (DPM)
     * - Statique  -> uniquement Manuel et Éco (DPM exclu)
     */
    getAllowedModes: function() {
        const gestionInput = document.querySelector('input[name="gestion_puissance"]:checked');
        const gestionMode = gestionInput ? gestionInput.value : 'statique';
        return gestionMode === 'dynamique'
            ? [this.MODES.DPM]
            : [this.MODES.STANDARD, this.MODES.ECO];
    },

    /**
     * Force la cohérence de la stratégie de chaque groupe avec le Mode de Gestion courant.
     * Bascule automatiquement les groupes dont la stratégie n'est plus autorisée.
     */
    enforceModeConstraints: function(groups) {
        const allowedModes = this.getAllowedModes();
        (groups || []).forEach(group => {
            this.initGroupConfig(group);
            if (!allowedModes.includes(group.smartMode)) {
                group.smartMode = allowedModes[0];
                if (group.smartMode === this.MODES.ECO && !group.targetKwh) group.targetKwh = 50;
            }
        });
    },

    buildHoroVisualizer: function() {
        if (!window.horoConfig || !Array.isArray(window.horoConfig.hc_hours)) return '';
        
        const segments = window.horoConfig.hc_hours.map((isHC, hour) => {
            const color = isHC ? '#3b82f6' : '#e5e7eb'; // Blue for HC, Gray for HP
            return `<div class="horo-visualizer-seg" style="background-color: ${color}; flex: 1; height: 100%; border-right: 1px solid #ffffff;" title="${hour}h-${hour+1}h: ${isHC ? 'Heure Creuse' : 'Heure Pleine'}"></div>`;
        }).join('');

        return `
            <div style="margin-top: 12px; margin-bottom: 12px; cursor: pointer; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'" onclick="if(window.openHorosaisonnierModal) window.openHorosaisonnierModal();" title="Cliquez pour configurer les heures creuses">
                <label style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                    <span>Répartition Heures Creuses / Pleines</span>
                    <span style="font-size: 0.75rem; color: var(--accent-primary);"><i class="fas fa-edit"></i> Modifier</span>
                </label>
                <div class="horo-visualizer" style="display: flex; height: 20px; border-radius: 4px; overflow: hidden; border: 1px solid var(--border-color);">
                    ${segments}
                </div>
            </div>
        `;
    },

    buildUI: function(group) {
        this.initGroupConfig(group);

        const allowedModes = this.getAllowedModes();
        if (!allowedModes.includes(group.smartMode)) {
            group.smartMode = allowedModes[0];
            if (group.smartMode === this.MODES.ECO && !group.targetKwh) group.targetKwh = 50;
        }
        const isLocked = allowedModes.length === 1;

        const isStandard = group.smartMode === this.MODES.STANDARD;
        const isDPM = group.smartMode === this.MODES.DPM;
        const isEco = group.smartMode === this.MODES.ECO;

        const modeLabels = {
            [this.MODES.STANDARD]: 'Manuel (Heures fixes)',
            [this.MODES.DPM]: 'Écrêtage strict (Plateau de lissage)',
            [this.MODES.ECO]: 'Éco (Décalage Heures Creuses)'
        };
        const optionsHtml = allowedModes.map(mode =>
            `<option value="${mode}" ${group.smartMode === mode ? 'selected' : ''}>${modeLabels[mode]}</option>`
        ).join('');

        return `
            <div class="smart-charging-module" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: var(--border-radius-md); padding: 12px; margin-bottom: 8px;">

                <!-- Header : Sélection du mode -->
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <label style="font-weight: 600; color: var(--accent-primary); display: flex; align-items: center; gap: 5px;">
                        <i class="fas fa-bolt"></i> Stratégie de charge
                    </label>
                    <select class="modern-input" style="width: 60%; max-width: 250px; font-weight: 500;" onchange="window.SmartCharging.changeMode('${group.key}', this.value)" ${isLocked ? 'disabled title="Mode de Gestion Dynamique : Écrêtage strict imposé"' : ''}>
                        ${optionsHtml}
                    </select>
                </div>

                <!-- NOUVEAU: Visualiseur Heures Creuses -->
                ${this.buildHoroVisualizer()}

                <!-- Contenu Conditionnel : Mode DPM -->
                <div id="sc-dpm-${group.key}" style="display: ${isDPM ? 'block' : 'none'}; padding-top: 10px; border-top: 1px dashed var(--border-color); margin-top: 10px;">
                    <div style="display: flex; gap: 10px; align-items: flex-start; color: var(--accent-green); background: #f0fdf4; padding: 10px; border-radius: 6px; border: 1px solid #bbf7d0;">
                        <i class="fas fa-magic" style="margin-top: 3px;"></i>
                        <span style="font-size: 0.85rem; line-height: 1.4;">
                            <strong>Plateau strict (Valley-Filling) :</strong> L'allocation s'écrête dynamiquement en fonction du bâtiment. Les courbes s'aplatissent pour former un plateau parfait et ne <b>jamais franchir</b> la Puissance Souscrite.
                        </span>
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 10px;">
                        <div class="input-group" style="flex: 1; margin: 0;">
                            <label style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 2px;" title="L'énergie totale que le simulateur tentera de distribuer. La charge s'arrêtera une fois l'objectif atteint.">Besoin d'énergie, en kWh - Optionnel</label>
                            <input type="number" id="sc-targetKwh-dpm-${group.key}" class="modern-input irve-sc-numeric" data-min="0" data-max="500" data-label="Besoin d'énergie (SmartCharging)" value="${group.targetKwh || ''}" placeholder="Aucune limite" min="0" max="500" onchange="window.SmartCharging.updateParam('${group.key}', 'targetKwh', this.value)">
                        </div>
                        <div class="input-group" style="flex: 1; margin: 0;">
                            <label style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 2px;">Capacité batterie (kWh)</label>
                            <input type="number" id="sc-batteryCapacity-dpm-${group.key}" class="modern-input irve-sc-numeric" data-min="0" data-max="1000" data-label="Capacité batterie (SmartCharging)" value="${group.batteryCapacity || ''}" placeholder="Ex: 50" min="0" max="1000" onchange="window.SmartCharging.updateParam('${group.key}', 'batteryCapacity', this.value)">
                        </div>
                    </div>
                </div>

                <!-- Contenu Conditionnel : Mode ECO -->
                <div id="sc-eco-${group.key}" style="display: ${isEco ? 'flex' : 'none'}; gap: 15px; align-items: center; padding-top: 10px; border-top: 1px dashed var(--border-color); margin-top: 10px; flex-wrap: wrap;">

                    <!-- Nouveau Toggle Auto HC -->
                    <div class="input-group" style="flex: 1; min-width: 150px; margin: 0;">
                        <label style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 2px;">Recharge véhicule</label>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <label style="position: relative; display: inline-block; width: 44px; height: 24px; margin: 0;">
                                <input type="checkbox" ${group.autoEcoRecharge ? 'checked' : ''} onchange="window.SmartCharging.toggleAutoEcoRecharge('${group.key}', this.checked)" style="opacity: 0; width: 0; height: 0; position: absolute;">
                                <span style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: ${group.autoEcoRecharge ? '#1E8449' : '#ccc'}; border-radius: 24px; transition: .4s;">
                                    <span style="position: absolute; content: ''; height: 18px; width: 18px; left: ${group.autoEcoRecharge ? '23px' : '3px'}; bottom: 3px; background-color: white; border-radius: 50%; transition: .4s;"></span>
                                </span>
                            </label>
                            <span style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">${group.autoEcoRecharge ? 'ON (Auto HC)' : 'OFF (Manuel)'}</span>
                        </div>
                    </div>

                    <div class="input-group" style="flex: 1; min-width: 120px; margin: 0;">
                        <label style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 2px;" title="L'énergie totale que le simulateur tentera de distribuer sur les HC">Besoin d'énergie, en kWh</label>
                        <input type="number" id="sc-targetKwh-eco-${group.key}" class="modern-input irve-sc-numeric" data-min="0" data-max="500" data-label="Besoin d'énergie (SmartCharging)" value="${group.targetKwh || ''}" placeholder="Ex: 50" min="1" max="500" onchange="window.SmartCharging.updateParam('${group.key}', 'targetKwh', this.value)">
                    </div>
                    <div class="input-group" style="flex: 1; min-width: 120px; margin: 0;">
                        <label style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 2px;">Capacité batterie (kWh)</label>
                        <input type="number" id="sc-batteryCapacity-eco-${group.key}" class="modern-input irve-sc-numeric" data-min="0" data-max="1000" data-label="Capacité batterie (SmartCharging)" value="${group.batteryCapacity || ''}" placeholder="Ex: 50" min="0" max="1000" onchange="window.SmartCharging.updateParam('${group.key}', 'batteryCapacity', this.value)">
                    </div>
                    <div class="input-group" style="flex: 1; min-width: 120px; margin: 0;">
                        <label style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 2px;">Heure de départ prévue</label>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <input type="number" id="sc-departureHour-eco-${group.key}" class="modern-input irve-sc-numeric" style="flex: 1;" data-min="0" data-max="24" data-label="Heure de départ prévue (SmartCharging)" value="${group.departureHour}" min="0" max="24" onchange="window.SmartCharging.updateParam('${group.key}', 'departureHour', this.value)">
                            <span style="font-weight: 600; color: var(--text-secondary);">h</span>
                        </div>
                    </div>
                    <div style="width: 100%; font-size: 0.8rem; color: #3b82f6; background: #eff6ff; padding: 8px; border-radius: 4px; border: 1px solid #bfdbfe; display: flex; gap: 8px; align-items: flex-start;">
                        <i class="fas fa-clock" style="margin-top: 2px;"></i>
                        <span>L'algorithme placera prioritairement les <b>${group.targetKwh || 50} kWh</b> durant la nuit et les Heures Creuses, avant l'heure de départ (${group.departureHour}h).</span>
                    </div>
                </div>

            </div>

            <!-- Grille de Planification (Toujours visible, rôle adapté selon le mode) -->
            <div id="manual-grid-container-${group.key}" class="time-slider-container" style="margin-top: 10px;">
                <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 5px; color: var(--text-secondary);">
                    ${isStandard ? '🕒 Plages horaires de recharge (Forcée)' : (isEco ? '🔌 Plages de présence (Heures Creuses uniquement)' : '🔌 Plages de présence du véhicule (Branchement)')}
                </div>
                <div class="time-labels">
                    <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span style="text-align: right;">24h</span>
                </div>
                <div class="hour-segment-grid" id="planning-grid-${group.key}" style="${isEco && group.autoEcoRecharge ? 'opacity: 0.6; pointer-events: none;' : ''}"></div>
                <div class="quick-plan-buttons" style="${isEco && group.autoEcoRecharge ? 'opacity: 0.6; pointer-events: none;' : ''}">
                    <button onclick="setQuickPlan('${group.key}', 'weekday', this)">jours ouvrés</button>
                    <button onclick="setQuickPlan('${group.key}', 'weekend', this)">week-end</button>
                </div>
            </div>
        `;
    },

    changeMode: function(groupKey, newMode) {
        const group = window.irveGroups.find(g => g.key === groupKey);
        if (group) {
            group.smartMode = newMode;
            if (newMode === this.MODES.ECO && (!group.targetKwh || group.targetKwh === 0)) {
                group.targetKwh = 50; // Valeur par défaut logique pour le mode Eco
            } else if (newMode === this.MODES.DPM && group.targetKwh === 50) {
                group.targetKwh = 0; // 0 = infini par défaut pour DPM (Valley-filling total)
            }
            if (typeof window.invalidateEnergie === 'function') window.invalidateEnergie();
            if (typeof window.updatePlanningDetailTable === 'function') window.updatePlanningDetailTable();
        }
    },

    updateParam: function(groupKey, paramName, value) {
        const group = window.irveGroups.find(g => g.key === groupKey);
        if (group) {
            group[paramName] = parseFloat(value) || 0;
            if (typeof window.invalidateEnergie === 'function') window.invalidateEnergie();
            // Mettre à jour le texte descriptif en temps réel
            if (typeof window.updatePlanningDetailTable === 'function') window.updatePlanningDetailTable();
            // CORRECTIF (validation) : réaction immédiate si la valeur saisie sort des bornes.
            if (typeof window.updateIrveSubmitButtonsState === 'function') window.updateIrveSubmitButtonsState();
        }
    },

    toggleAutoEcoRecharge: function(groupKey, isAuto) {
        const group = window.irveGroups.find(g => g.key === groupKey);
        if (group) {
            group.autoEcoRecharge = isAuto;
            if (isAuto) {
                const pasTempsMin = parseInt(document.getElementById('pas_temps')?.value) || 60;
                const segmentsPerHour = 60 / pasTempsMin;
                for (let h = 0; h < 24; h++) {
                    const isHC = window.horoConfig && window.horoConfig.hc_hours ? window.horoConfig.hc_hours[h] : false;
                    for (let s = 0; s < segmentsPerHour; s++) {
                        if (window.irveChargingPlan && window.irveChargingPlan[groupKey]) {
                            window.irveChargingPlan[groupKey][h * segmentsPerHour + s] = isHC;
                        }
                    }
                }
            }
            if (typeof window.invalidateEnergie === 'function') window.invalidateEnergie();
            if (typeof window.updatePlanningDetailTable === 'function') window.updatePlanningDetailTable();
        }
    }
};
/**
 * =========================================================================
 * MODULE MANAGER TURPE 7 (Heures Creuses / Pleines / Pointes)
 * Logique métier stricte de la réglementation française TURPE 7.
 * =========================================================================
 */

window.Turpe7Manager = {
    TARIFS: { HC: 'HC', HP: 'HP', POINTE: 'POINTE' },
    SAISONS: { ETE: 'ETE', HIVER: 'HIVER' },
    
    // Les plages réglementaires
    PLAGES: {
        NUIT: [20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7],
        JOUR: [11, 12, 13, 14, 15, 16],
        POINTE_MATIN: [7, 8, 9, 10],   // 07h00 - 11h00
        POINTE_SOIR: [17, 18, 19, 20]  // 17h00 - 21h00
    },

    /**
     * Vérifie si la configuration des Heures Creuses (Array de 24 booléens) est conforme au TURPE 7
     * Règles : 8h HC au total -> 5h nuit consécutives (20h-08h) + max 3h jour (11h-17h).
     */
    validateHoroConfig(hc_hours) {
        const totalHC = hc_hours.filter(h => h).length;
        if (totalHC !== 8) return { valid: false, message: `Le TURPE exige exactement 8 heures creuses. Actuellement : ${totalHC}h sélectionnées.` };

        let nightHCCount = 0;
        let dayHCCount = 0;
        let invalidHCCount = 0;

        hc_hours.forEach((isHc, h) => {
            if (isHc) {
                if (this.PLAGES.NUIT.includes(h)) nightHCCount++;
                else if (this.PLAGES.JOUR.includes(h)) dayHCCount++;
                else invalidHCCount++;
            }
        });

        if (invalidHCCount > 0) return { valid: false, message: "⚠️ Invalide : Les Heures Creuses doivent se situer uniquement entre 20h-08h et 11h-17h." };
        if (nightHCCount !== 5) return { valid: false, message: `⚠️ Le bloc nuit (20h-08h) doit contenir exactement 5 heures. Actuellement : ${nightHCCount}h.` };
        if (dayHCCount !== 3) return { valid: false, message: `⚠️ Le bloc jour (11h-17h) doit contenir exactement 3 heures. Actuellement : ${dayHCCount}h.` };

        // Vérification de la consécutivité des 5 heures de nuit (prise en compte du passage à minuit)
        let maxConsecutive = 0;
        let streak = 0;
        for (let i = 0; i < this.PLAGES.NUIT.length * 2; i++) { 
            const h = this.PLAGES.NUIT[i % this.PLAGES.NUIT.length];
            if (hc_hours[h]) {
                streak++;
                if (streak > maxConsecutive) maxConsecutive = streak;
            } else {
                streak = 0;
            }
        }

        if (maxConsecutive < 5) return { valid: false, message: "⚠️ Invalide : Les 5 heures creuses de nuit doivent être strictement consécutives." };

        return { valid: true, message: "✅ Configuration TURPE 7 Valide." };
    },

    getSaison(date) {
        const month = date.getMonth() + 1; // 1-12
        // Été : 1er Avril (4) au 31 Octobre (10)
        if (month >= 4 && month <= 10) return this.SAISONS.ETE;
        return this.SAISONS.HIVER; // Novembre à Mars
    },

    generateDefaultTurpe7Config() {
        const config = Array(24).fill(false);
        // Par défaut (profil Enedis standard TURPE 7) : Nuit 23h-04h (5h consécutives)
        [23, 0, 1, 2, 3].forEach(h => config[h] = true);
        // Jour : 12h-15h (3h)
        [12, 13, 14].forEach(h => config[h] = true);
        return config;
    }
};
// === DÉCLARATION DES VARIABLES GLOBALES ET CONSTANTES ===
// IMPORTANT : irveData, irveCounter, activeTab, simulationResults, bilanCalculated,
// seasonalHourlyData, irveGroups et irveChargingPlan sont déclarées avec `var` (et non `let`)
// car IrveStorageManager.js persiste/restaure ces mêmes variables via `window.<nom>` — au
// top-niveau d'un script classique, seul `var` crée un alias sur `window`. Avec `let`, ces deux
// scripts référençaient silencieusement des variables différentes : la sauvegarde ne
// fonctionnait jamais (window.irveData restait undefined), d'où la perte des données au reload.
var irveData = [];
var irveCounter = 0;
var activeTab = 'materiels';

let annualLoadChart = null;
let monthlyConsumptionChart = null;
var simulationResults = {};
var bilanCalculated = false;
var seasonalHourlyData = {
    'Hiver': Array(24).fill(0), 'Printemps': Array(24).fill(0),
    'Été': Array(24).fill(0), 'Automne': Array(24).fill(0)
};
let existingHourlyData = Array(24).fill(0);

// CORRECTIF (persistance de la consommation existante importée) : `var` (et non `let`), comme
// irveGroups/irveChargingPlan ci-dessous — nécessaire pour que irve_payload_builder.js (autre
// script, cf. commentaire plus haut) puisse les lire/écrire via `window.importedData` etc.
var importedData = null;
var useImportedData = false;
var importedPasTemps = 60;

var irveGroups = [];
var irveChargingPlan = {};
let currentPasTemps = 30;
let isDrawing = false;
// Sélection des créneaux horaires : on ne "peint" les créneaux voisins que si un vrai
// glissement de souris est détecté (au-delà d'un seuil), afin qu'un simple clic ne
// sélectionne/désélectionne que le créneau ciblé, sans affecter les autres.
let drawValue = null;
let dragMoved = false;
let dragStartX = 0;
let dragStartY = 0;
const DRAG_THRESHOLD_PX = 6;

const modal = document.getElementById('app-modal');

// Constantes électriques simplifiées
const CABLES_RESISTIVITY = { Cu: { mono: 0.0044, tri: 0.0075 }, Al: { mono: 0.0071, tri: 0.012 } };
const STANDARD_SECTIONS = [6, 10, 16, 25, 50, 70, 95, 120, 150, 185, 240, 300];
const I_ADMISSIBLE_TABLE = [
    { section: 6, Cu70: 38, Al70: 31, Cu31: 40, Al31: 30 }, { section: 10, Cu70: 50, Al70: 40, Cu31: 55, Al31: 45 },
    { section: 16, Cu70: 64, Al70: 50, Cu31: 70, Al31: 60 }, { section: 25, Cu70: 82, Al70: 64, Cu31: 85, Al31: 70 },
    { section: 50, Cu70: 116, Al70: 91, Cu31: 120, Al31: 95 }, { section: 70, Cu70: 143, Al70: 112, Cu31: 150, Al31: 120 },
    { section: 95, Cu70: 169, Al70: 132, Cu31: 175, Al31: 140 }, { section: 120, Cu70: 192, Al70: 150, Cu31: 200, Al31: 155 },
    { section: 150, Cu70: 217, Al70: 169, Cu31: 225, Al31: 179 }, { section: 185, Cu70: 243, Al70: 190, Cu31: 250, Al31: 200 },
    { section: 240, Cu70: 280, Al70: 218, Cu31: 290, Al31: 230 }, { section: 300, Cu70: 316, Al70: 247, Cu31: 320, Al31: 260 }
];
const TENSIONS = [
    { value: '230V_M', label: 'Monophasé / 230V' }, { value: '400V_T', label: 'Triphasé / 400V' }, { value: 'autre', label: 'Autre' }
];
const FABRICANTS = ['Alfen', 'Autel', 'Schneider Electric', 'Huawei', 'Sungrow', 'Utilisateur'];
const PUISSANCES_AC = [
    { value: 3.7, label: '3.7 kW' }, { value: 7.4, label: '7.4 kW' }, { value: 11, label: '11 kW' }, { value: 22, label: '22 kW' }
];
const PUISSANCES_DC = [24, 30, 50, 60, 90, 100, 150, 350, 400];

// --- GESTION DRAG & RESIZE MODAL ---
const header = document.getElementById('modal-header');
const resizeHandle = document.getElementById('resize-handle');
const backdrop = document.getElementById('modal-backdrop');
let isDragging = false, isResizing = false;
let offsetX, offsetY, startX, startY, startWidth, startHeight;

function openModal() {
    modal.style.display = 'flex'; backdrop.style.display = 'block';
    if (typeof window.updateIrveSubmitButtonsState === 'function') window.updateIrveSubmitButtonsState();
}

// Détecter le mode embedded avant d'ajouter les event listeners
const urlParams = new URLSearchParams(window.location.search);
const autoOpen = urlParams.get('autoOpen');
const isEmbeddedMode = autoOpen === 'true';

if (isEmbeddedMode) {
    // Mode embedded : adapter le modal pour s'intégrer dans l'iframe du modal universel
    document.body.classList.add('embedded-mode');
    modal.classList.add('embedded-mode');

    // CORRECTIF (contenu invisible tant qu'on ne clique pas n fois sur "IRVE-Autoconsommation") :
    // l'ouverture automatique se faisait via un setTimeout(100ms) totalement indépendant de
    // window.onload ci-dessous, qui force lui-même `#app-modal` à display:none à SON déclenchement
    // (cf. plus bas). Les deux s'exécutent en parallèle sans aucune garantie d'ordre : si les
    // scripts CDN (chart.js/jspdf/xlsx, chargés sans defer) et la police Google se chargent vite
    // (cache navigateur chaud), `window.onload` se déclenche APRÈS ce setTimeout et écrase
    // silencieusement le display:flex qu'il venait de poser — sans qu'aucun code ne le rétablisse
    // ensuite. L'ouverture est donc déplacée en toute fin de window.onload (voir plus bas), qui
    // s'exécute alors forcément APRÈS le display:none forcé, éliminant la course.
}

// Fermeture du modal (désactivée en mode embedded)
const closeModalBtn = document.getElementById('close-modal-btn');
if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
        if (!isEmbeddedMode) {
            modal.style.display = 'none';
            backdrop.style.display = 'none';
        }
    });
}

// Reset size (désactivé en mode embedded)
const resetSizeBtn = document.getElementById('reset-modal-btn');
if (resetSizeBtn) {
    resetSizeBtn.addEventListener('click', () => {
        if (!isEmbeddedMode) {
            modal.style.width = '95vw'; modal.style.height = '95vh';
            modal.style.top = '50%'; modal.style.left = '50%';
            modal.style.transform = 'translate(-50%, -50%)';
        }
    });
}

// Drag and Resize (désactivés en mode embedded)
if (header && !isEmbeddedMode) {
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.header-buttons') || e.target.tagName === 'BUTTON') return;
        isDragging = true;
        offsetX = e.clientX - modal.offsetLeft; offsetY = e.clientY - modal.offsetTop;
        document.body.style.userSelect = 'none';
    });
}

if (!isEmbeddedMode) {
    document.addEventListener('mousemove', (e) => {
        if (isDragging) { modal.style.left = `${e.clientX - offsetX}px`; modal.style.top = `${e.clientY - offsetY}px`; }
        if (isResizing) {
            const newWidth = startWidth + (e.clientX - startX);
            const newHeight = startHeight + (e.clientY - startY);
            modal.style.width = `${Math.max(900, newWidth)}px`; modal.style.height = `${Math.max(700, newHeight)}px`;
        }
    });
    document.addEventListener('mouseup', () => { isDragging = false; isResizing = false; document.body.style.userSelect = ''; });
}

if (resizeHandle && !isEmbeddedMode) {
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX; startY = e.clientY;
        startWidth = modal.offsetWidth; startHeight = modal.offsetHeight;
        document.body.style.userSelect = 'none';
    });
}

function showMessage(text, type = 'info', duration = 3000, targetElement = null) {
    const messageArea = document.getElementById('message-area');
    messageArea.textContent = text;
    messageArea.className = type === 'error' ? 'error' : (type === 'info' ? 'info' : '');

    if (targetElement && targetElement.closest('#app-modal')) {
        const rect = targetElement.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();

        messageArea.style.top = `${rect.bottom - modalRect.top + 5}px`;
        messageArea.style.left = `${rect.left - modalRect.left}px`;
        messageArea.style.right = 'auto';
        messageArea.style.position = 'absolute';
    } else {
        const rect = targetElement ? targetElement.getBoundingClientRect() : { bottom: 0, left: 0 };
        messageArea.style.top = `${rect.bottom + 5}px`;
        messageArea.style.left = `${rect.left}px`;
        messageArea.style.right = 'auto';
        messageArea.style.position = 'fixed';
    }

    messageArea.classList.add('visible');
    messageArea.style.display = 'block';

    setTimeout(() => {
        messageArea.classList.remove('visible');
        setTimeout(() => { messageArea.style.display = 'none'; }, 500);
    }, duration);
}

// --- GESTION DES ONGLETS ---
const tabButtons = document.querySelectorAll('.tab-button');
const tabPanes = document.querySelectorAll('.tab-pane');
const tabList = ['materiels', 'energie'];
const monthlyLabels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];


tabButtons.forEach(button => {
    button.addEventListener('click', () => { switchTab(button.getAttribute('data-tab')); });
});
const prevTabBtn = document.getElementById('prev-tab-btn');
if (prevTabBtn) prevTabBtn.addEventListener('click', () => {
    const currentIndex = tabList.indexOf(activeTab);
    if (currentIndex > 0) switchTab(tabList[currentIndex - 1]);
});
const nextTabBtn = document.getElementById('next-tab-btn');
if (nextTabBtn) nextTabBtn.addEventListener('click', () => {
    const currentIndex = tabList.indexOf(activeTab);
    if (currentIndex < tabList.length - 1) switchTab(tabList[currentIndex + 1]);
});

function switchTab(tabId) {
    console.log("🔄 switchTab appelée avec tabId:", tabId);

    // Sauvegarder l'onglet actuel avant de changer
    const previousTab = activeTab;
    activeTab = tabId;

    // Mettre à jour les panneaux et boutons
    tabPanes.forEach(pane => {
        pane.classList.remove('active');
        if (pane.id === tabId) pane.classList.add('active');
    });

    tabButtons.forEach(button => {
        button.classList.remove('active');
        if (button.getAttribute('data-tab') === tabId) button.classList.add('active');
    });

    // Gérer les boutons précédent/suivant
    const currentIndex = tabList.indexOf(activeTab);
    if (prevTabBtn) prevTabBtn.disabled = currentIndex === 0;
    if (nextTabBtn) nextTabBtn.disabled = currentIndex === tabList.length - 1;
}

// --- LOGIQUE CHOIX DE MATÉRIELS (Section 2) ---

// CORRECTIF (XSS stockée) : échappe toute valeur interpolée dans un template innerHTML.
// Aucun échappeur partagé n'est chargé sur cette page (celui de MesProjetsModal.js/
// parametreProjetFormManager.js est une méthode de classe non accessible ici).
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function generateManufacturerHtml(id, currentFab) {
    let html = `
                <select id="fab-select-${id}" class="modern-input" onchange="updateIrveFabricant(${id}, this.value)">
                    ${FABRICANTS.map(f => `<option value="${f}" ${f === currentFab ? 'selected' : ''}>${f}</option>`).join('')}
                </select>
            `;
    if (currentFab === 'Utilisateur') {
        const currentFabName = irveData.find(item => item.id === id)?.customFabricant || '';
        // CORRECTIF (XSS) : currentFabName échappé avant injection ; maxlength + filtre de saisie
        // (lettres/chiffres/espaces/tirets uniquement) contre l'injection de balises/scripts.
        html = `<input type="text" id="fab-input-${id}" class="modern-input" maxlength="30" value="${escapeHtml(currentFabName)}" placeholder="Nom fabricant" oninput="this.value = this.value.replace(/[^a-zA-Z0-9À-ÿ '-]/g, '')" onchange="updateIrveData(${id}, 'customFabricant', this.value); updateIrveData(${id}, 'fabricant', 'Utilisateur')">`;
    }
    return html;
}

function generateTensionHtml(id, currentTens) {
    let html = `
                <select id="tens-select-${id}" class="modern-input" onchange="updateIrveTension(${id}, this.value)">
                    ${TENSIONS.map(t => `<option value="${t.value}" ${t.value === currentTens ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}
                </select>
            `;
    if (currentTens === 'autre') {
        const currentTensValue = irveData.find(item => item.id === id)?.customTension || '';
        html = `<input type="number" id="tens-input-${id}" class="modern-input" value="${escapeHtml(currentTensValue)}" min="0" step="1" placeholder="Tension (V)" onchange="updateIrveData(${id}, 'customTension', parseFloat(this.value) || 0); updateIrveData(${id}, 'tension', 'autre')">`;
    }
    return html;
}

function addRow(button) {
    irveCounter++;
    const id = irveCounter;
    const tableBody = document.querySelector('#irve-selection-table tbody');
    const newRow = tableBody.insertRow();
    newRow.id = `irve-row-${id}`;
    newRow.setAttribute('data-id', id);

    irveData.push({
        id: id, type: 'AC', tension: '230V_M', puissance: 7.4, pdc: 1, quantite: 1, fabricant: FABRICANTS[0],
        customFabricant: '', customTension: 230,
        Pact: 0, Qrec: 0, Sapp: 0, Ib: 0,
    });

    const pwrOptions = PUISSANCES_AC.map(p => `<option value="${p.value}" ${p.value === 7.4 ? 'selected' : ''}>${p.label}</option>`).join('');

    newRow.innerHTML = `
                <td id="fab-cell-${id}">${generateManufacturerHtml(id, FABRICANTS[0])}</td>
                <td><select id="type-${id}" class="modern-input" onchange="updateIrveType(${id}, this.value)">
                    <option value="AC">AC</option>
                    <option value="DC">DC</option>
                </select></td>
                <td id="tens-cell-${id}">${generateTensionHtml(id, '230V_M')}</td>
                <td><select id="pwr-${id}" class="modern-input" onchange="updateIrvePuissance(${id}, this.value)">
                    ${pwrOptions}
                </select></td>
                <td><input type="number" id="pdc-${id}" class="modern-input" value="1" min="1" max="4" onchange="updateIrveData(${id}, 'pdc', parseInt(this.value) || 1)"></td>
                <td><input type="number" id="qty-${id}" class="modern-input" value="1" min="1" max="50" onchange="updateIrveData(${id}, 'quantite', parseInt(this.value) || 1)"></td>
                <td id="total-pwr-${id}">7.40</td>
                <td><button class="btn-danger" onclick="removeRow(${id}, this)">Suppr.</button></td>
            `;
    updateTotals();
    showMessage(`Borne IRVE ${id} ajoutée.`, 'info', 2000, button);
}

function updateIrveFabricant(id, newFab) {
    const index = irveData.findIndex(item => item.id === id);
    if (index > -1) {
        irveData[index].fabricant = newFab;
        const fabCell = document.getElementById(`fab-cell-${id}`);
        if (fabCell) fabCell.innerHTML = generateManufacturerHtml(id, newFab);
        if (newFab !== 'Utilisateur') irveData[index].customFabricant = '';
        updateRow(id);
    }
}

function updateIrveTension(id, newTens) {
    const index = irveData.findIndex(item => item.id === id);
    if (index > -1) {
        const item = irveData[index];

        // --- TÂCHE 1 : Forcer les bornes 3.7 kW et 7.4 kW en Monophasé ---
        if (item.type === 'AC' && item.puissance <= 7.4 && newTens === '400V_T') {
            showMessage("Les bornes de 3.7 kW et 7.4 kW sont structurellement en Monophasé.", "warning", 4000);
            newTens = '230V_M'; // Rejette l'action de l'utilisateur et remet à jour
        }

        irveData[index].tension = newTens;
        const tensCell = document.getElementById(`tens-cell-${id}`);
        if (tensCell) tensCell.innerHTML = generateTensionHtml(id, newTens);
        if (newTens !== 'autre') irveData[index].customTension = (newTens === '230V_M') ? 230 : 400;

        if (item.type === 'AC' && item.puissance > 7.4) {
            if (newTens !== 'autre') {
                item.tension = '400V_T';
                const currentTensCell = document.getElementById(`tens-cell-${id}`);
                if (currentTensCell) currentTensCell.innerHTML = generateTensionHtml(id, '400V_T');
            }
        }
        updateRow(id);
    }
}

function updateIrveData(id, key, value) {
    const index = irveData.findIndex(item => item.id === id);
    if (index > -1) {
        irveData[index][key] = value;
        updateRow(id);
    }
}

function updateIrveType(id, newType) {
    const index = irveData.findIndex(item => item.id === id);
    if (index > -1) {
        irveData[index].type = newType;
        const pwrSelect = document.getElementById(`pwr-${id}`);
        pwrSelect.innerHTML = '';

        if (newType === 'AC') {
            PUISSANCES_AC.forEach(p => {
                pwrSelect.innerHTML += `<option value="${p.value}" ${p.value === 7.4 ? 'selected' : ''}>${p.label}</option>`;
            });
            irveData[index].puissance = 7.4;
            irveData[index].tension = '230V_M';
            irveData[index].customTension = 230;
        } else {
            PUISSANCES_DC.forEach(p => {
                pwrSelect.innerHTML += `<option value="${p}">${p} kW</option>`;
            });
            irveData[index].puissance = PUISSANCES_DC[0];
            irveData[index].tension = '400V_T';
            irveData[index].customTension = 400;
        }

        const tensCell = document.getElementById(`tens-cell-${id}`);
        if (tensCell) tensCell.innerHTML = generateTensionHtml(id, irveData[index].tension);

        updateRow(id);
    }
}

function updateIrvePuissance(id, newPuissance) {
    const index = irveData.findIndex(item => item.id === id);
    if (index > -1) {
        const puissance = parseFloat(newPuissance);
        irveData[index].puissance = puissance;

        if (irveData[index].type === 'AC') {
            if (puissance <= 7.4) {
                irveData[index].tension = '230V_M';
                irveData[index].customTension = 230;
            } else {
                irveData[index].tension = '400V_T';
                irveData[index].customTension = 400;
            }
            const tensCell = document.getElementById(`tens-cell-${id}`);
            if (tensCell) tensCell.innerHTML = generateTensionHtml(id, irveData[index].tension);
        }
        updateRow(id);
    }
}

function updateRow(id) {
    const item = irveData.find(item => item.id === id);
    if (item) {
        const totalPwr = item.puissance * item.quantite * item.pdc;
        document.getElementById(`total-pwr-${id}`).textContent = totalPwr.toFixed(2);
        updateTotals();
    }
}

function removeRow(id, button) {
    irveData = irveData.filter(item => item.id !== id);
    document.getElementById(`irve-row-${id}`)?.remove();

    updateTotals();
    showMessage(`Borne IRVE ${id} supprimée.`, 'info', 2000, button);
    // CORRECTIF (demande explicite) : plus aucune borne -> la courbe de charge IRVE synchronisée
    // n'a plus lieu d'être ; supprimée tout de suite, sans attendre un nouveau calcul (que
    // calculateEnergie() refuse de toute façon sans matériel).
    if (irveData.length === 0) supprimerCourbeIrveSynchronisee();
}

async function supprimerCourbeIrveSynchronisee() {
    const projetId = localStorage.getItem('current_projet_id');
    if (!projetId) return;
    try {
        const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/irve/curve`, { method: 'DELETE' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const statusEl = document.getElementById('irve-aci-sync-status');
        if (statusEl) statusEl.textContent = '';
        // Prévient l'import de consommation (irve_consumption_import.js) qui affiche la courbe.
        document.dispatchEvent(new CustomEvent('irveCourbeSupprimee', { detail: { projetId } }));
    } catch (e) {
        console.error('Erreur lors de la suppression de la courbe IRVE :', e);
    }
}

function updateTotals() {
    let totalQty = 0;
    let totalPuissance = 0;
    irveData.forEach(item => {
        totalQty += item.quantite;
        totalPuissance += item.puissance * item.quantite * item.pdc;
    });
    const totalQtyElement = document.getElementById('total-qty');
    const totalPuissanceElement = document.getElementById('total-puissance');
    if (totalQtyElement) totalQtyElement.textContent = totalQty;
    if (totalPuissanceElement) totalPuissanceElement.textContent = totalPuissance.toFixed(2);

    // CORRECTIF (bilan de puissance dynamique) : updateTotals() est appelée par TOUTES les
    // mutations de la table des matériels (ajout, suppression, modification d'une borne) — point
    // d'insertion unique pour recalculer le bilan automatiquement, sans bouton dédié.
    if (irveData.length > 0) calculateBilanPuissance(null, true);

    if (typeof window.updateIrveSubmitButtonsState === 'function') window.updateIrveSubmitButtonsState();
}


// --- LOGIQUE BILAN DE PUISSANCE (Section 3) ---
function updateDPMDisplay() {
    const isDynamique = document.querySelector('input[name="gestion_puissance"]:checked').value === 'dynamique';
    const dpmGroup = document.getElementById('dpm-type-group');
    if (dpmGroup) dpmGroup.style.display = isDynamique ? 'flex' : 'none';

    // Filtre de la stratégie de recharge selon le Mode de Gestion (Statique/Dynamique)
    if (typeof window.updatePlanningDetailTable === 'function') window.updatePlanningDetailTable();
}

function updateRaccordementMode() {
    const mode = document.querySelector('input[name="mode_raccordement"]:checked').value;
    const transfoGroup = document.getElementById('puissance-transfo-group');
    if (transfoGroup) transfoGroup.style.display = mode === 'HTA' ? 'flex' : 'none';
    // CORRECTIF (validation) : la plage valide de puissance_souscrite dépend du mode (BT/HTA) —
    // redéclenche la vérification pour une réaction immédiate au changement de mode.
    if (typeof window.updateIrveSubmitButtonsState === 'function') window.updateIrveSubmitButtonsState();
}

// CORRECTIF (calcul dynamique) : `silent` évite le toast et l'erreur "choisissez d'abord les
// matériels" lors des appels automatiques (cf. updateTotals()/calculateEnergie() plus bas) — le
// bouton manuel "calculer le bilan de puissance" est masqué, ce calcul tourne désormais tout seul
// dès qu'une borne est ajoutée/modifiée, et une dernière fois avant "Calculer la consommation".
function calculateBilanPuissance(button, silent) {
    if (irveData.length === 0) {
        if (!silent) showMessage("Veuillez d'abord choisir les matériels.", 'error', 3000, button);
        return;
    }

    const Ks = parseFloat(document.getElementById('ks').value) || 1.0;
    const Kmono = parseFloat(document.getElementById('kmono').value) || 1.0;
    const Ktri = parseFloat(document.getElementById('ktri').value) || 1.0;
    const Kdc = parseFloat(document.getElementById('kdc').value) || 1.0;
    const CosPhiAC = parseFloat(document.getElementById('cosphi_ac').value) || 0.98;
    const CosPhiDC = parseFloat(document.getElementById('cosphi_dc').value) || 0.98;
    const P_aux = parseFloat(document.getElementById('puissance_aux')?.value) || 0;

            let totalP = 0;
    let totalQ = 0;
    const Kglobal = 1.0;
    const detailData = [];

    irveData.forEach((item) => {
        const P_unit = item.puissance;
        const Pdc_count = item.pdc;
        const Qty = item.quantite;

        let P_active, Q_reactive, S_apparente, K_coeff, Ib;

        const U_tension = item.tension === 'autre' ? item.customTension : (item.tension.includes('M') ? 230 : 400);
        const U = U_tension > 0 ? U_tension : (item.tension.includes('M') ? 230 : 400);

        const P_brute_tot = P_unit * Pdc_count * Qty;

        if (item.type === 'AC') {
            K_coeff = item.tension.includes('M') ? Kmono : Ktri;
            P_active = P_brute_tot;
            Q_reactive = P_active * Math.tan(Math.acos(CosPhiAC));
            S_apparente = P_active / CosPhiAC;
            Ib = (S_apparente * 1000) / (item.tension.includes('M') ? U : (Math.sqrt(3) * U));

        } else {
            K_coeff = Kdc;
            P_active = P_brute_tot;
            Q_reactive = P_active * Math.tan(Math.acos(CosPhiDC));
            S_apparente = P_active / CosPhiDC;
            Ib = (S_apparente * 1000) / (Math.sqrt(3) * 400);
        }

        const P_calc = P_active * Ks * K_coeff;
        const Q_calc = Q_reactive * Ks * K_coeff;

        totalP += P_calc;
        totalQ += Q_calc;

        item.Pact = P_calc;
        item.Qrec = Q_calc;
        item.Sapp = Math.sqrt(Math.pow(P_calc, 2) + Math.pow(Q_calc, 2));
        item.Ib = Ib;

        detailData.push({
            N: `IRVE ${item.id} (${Qty}x)`,
            TypeTension: `${item.type}/${item.tension === 'autre' ? item.customTension : (item.tension.includes('M') ? 'Mono' : 'Tri')}`,
            Punit: P_unit.toFixed(1), Pdc: Pdc_count, Pact: P_calc.toFixed(2), Qrec: Q_calc.toFixed(2),
            Sapp: item.Sapp.toFixed(2), Ib: item.Ib.toFixed(1),
        });
    });

    bilanCalculated = true;
    const totalS = Math.sqrt(Math.pow(totalP, 2) + Math.pow(totalQ, 2));
    // CORRECTIF (bilan de puissance) : P_aux (champ "Puissance auxiliaire (kW)") est une puissance
    // ACTIVE (kW), pas une puissance apparente — l'ajouter directement à totalS (déjà une
    // combinaison quadratique de totalP/totalQ, en kVA) sommait deux grandeurs de nature
    // différente. On l'ajoute désormais à la puissance active totale AVANT de recombiner avec la
    // puissance réactive totale, exactement comme pour chaque borne IRVE ci-dessus
    // (P puis Q puis S = sqrt(P²+Q²)) — cohérent avec l'hypothèse implicite d'un auxiliaire à
    // cos(phi) ≈ 1 (aucun champ cos(phi) dédié à l'auxiliaire n'existe dans le formulaire).
    const totalPAvecAux = totalP + P_aux;
    const Praccord = Math.sqrt(Math.pow(totalPAvecAux, 2) + Math.pow(totalQ, 2));
    const IbTotal = ((Praccord * 1000) / (Math.sqrt(3) * 400)) * Kglobal;

    document.getElementById('res-Ptot').textContent = totalP.toFixed(2);
    document.getElementById('res-Qtot').textContent = totalQ.toFixed(2);
    document.getElementById('res-Stot').textContent = totalS.toFixed(2);
    document.getElementById('res-Praccord').textContent = Praccord.toFixed(2);
    document.getElementById('res-Ib').textContent = IbTotal.toFixed(1);

    updateDetailTable('bilan-detail-table', detailData);

    // Vérification du calcul (valeurs de référence appliquées au-delà d'un écart de 0,01).
    verifierBilanPuissance(
        { ks: Ks, kmono: Kmono, ktri: Ktri, kdc: Kdc, cosphi_ac: CosPhiAC, cosphi_dc: CosPhiDC, puissance_aux: P_aux },
        {
            p_total_kw: totalP, q_total_kvar: totalQ, s_total_kva: totalS, praccord_kva: Praccord, ib_total_a: IbTotal,
            detail: irveData.map(it => ({ id: it.id, p_actif_kw: it.Pact, q_reactif_kvar: it.Qrec, s_apparente_kva: it.Sapp, ib_a: it.Ib })),
        }
    );

    if (!silent) showMessage("Bilan de puissance calculé et mis à jour.", 'info', 3000, button);

    // Regrouper automatiquement les bornes pour la planification dans l'onglet Energie
    groupIrveStations();

    // NOUVEAU (demande explicite) : message dynamique sur la capacité électrique du site, affiché
    // quelques secondes après le calcul du bilan de puissance — indépendant de `silent` puisqu'il
    // doit se déclencher aussi lors des recalculs automatiques déclenchés par le choix des bornes
    // (cf. updateTotals()), pas seulement sur un clic manuel. Praccord (kVA, calculé juste
    // au-dessus) est utilisé comme P_bornes : c'est la puissance apparente cumulée de toutes les
    // bornes + l'auxiliaire, dans la même unité (kVA) que puissance_souscrite/
    // puissance_raccordement_irve.
    schedulePowerCapacityCheck(Praccord);
}

// --- MESSAGE DYNAMIQUE : CAPACITÉ ÉLECTRIQUE DU SITE (demande explicite) ---

let _powerCapacityCheckTimeout = null;

/**
 * Évalue si la puissance totale (pic de consommation existant + bornes IRVE) tient dans la
 * puissance souscrite, dans la limite de raccordement Enedis, ou dépasse cette dernière.
 * Implémentation directe de la spécification fournie (3 statuts).
 */
function evaluatePowerCapacity(pSouscrite, pRaccordement, pPicExistant, pBornes) {
    const pTotale = pPicExistant + pBornes;

    if (pTotale <= pSouscrite) {
        return {
            status: 'OPTIMAL',
            severity: 'info',
            title: 'Capacité électrique suffisante',
            message: "Votre point de livraison actuel dispose de la marge nécessaire pour intégrer ces bornes sans modification contractuelle.",
            recommendations: [],
        };
    }

    if (pTotale <= pRaccordement) {
        return {
            status: 'WARNING_CONTRACT',
            severity: 'warning',
            title: 'Puissance souscrite insuffisante (modification contractuelle requise)',
            message: "La puissance totale estimée dépasse votre contrat actuel mais reste dans la limite de votre raccordement Enedis. Deux solutions possibles :",
            recommendations: [
                "Ajuster votre abonnement : demander une augmentation de puissance souscrite auprès de votre fournisseur (sans travaux Enedis).",
                "Intégrer un pilotage énergétique : installer une gestion dynamique de la charge (délestage / foisonnement) pour écrêter les pics et conserver votre contrat actuel.",
            ],
        };
    }

    return {
        status: 'CRITICAL_GRID_OVERLOAD',
        severity: 'error',
        title: 'Dépassement de la puissance de raccordement (travaux Enedis requis)',
        message: "La puissance globale demandée dépasse la capacité maximale de votre branchement électrique. Deux orientations s'offrent à vous :",
        recommendations: [
            "Conserver la puissance nominale des bornes : cela nécessite des travaux d'extension ou de renforcement de raccordement réalisés par Enedis (délais et devis à prévoir).",
            "Mettre en place un bridage dynamique : plafonner la puissance allouée aux bornes via un système de supervision/GTC pour ne jamais franchir la puissance de raccordement du site ou souscrite.",
        ],
    };
}

/**
 * Programme l'affichage du message quelques secondes après le calcul du bilan de puissance
 * (demande explicite) — un nouveau calcul pendant le délai relance le compte à rebours plutôt que
 * d'empiler plusieurs modales. Ne s'affiche que si les données nécessaires sont disponibles :
 * - pBornes > 0 : au moins une borne réellement configurée (sinon rien à évaluer) ;
 * - pRaccordement > 0 : la puissance de raccordement (cf. #puissance_raccordement_irve, synchronisée
 *   depuis Enedis, section "Enedis") n'a pas encore été renseignée tant qu'aucune courbe Enedis n'a
 *   été validée — sans elle, impossible de distinguer les cas 2 et 3 (un défaut à 0 ferait passer
 *   n'importe quelle borne pour un dépassement critique).
 */
function schedulePowerCapacityCheck(pBornes) {
    if (_powerCapacityCheckTimeout) {
        clearTimeout(_powerCapacityCheckTimeout);
        _powerCapacityCheckTimeout = null;
    }

    const pRaccordement = parseFloat(document.getElementById('puissance_raccordement_irve')?.value) || 0;
    if (pBornes <= 0 || pRaccordement <= 0) return;

    const pSouscrite = parseFloat(document.getElementById('puissance_souscrite')?.value) || 0;
    const pPicExistant = parseFloat(document.getElementById('pic_puissance_irve')?.value) || 0;

    _powerCapacityCheckTimeout = setTimeout(() => {
        _powerCapacityCheckTimeout = null;
        const result = evaluatePowerCapacity(pSouscrite, pRaccordement, pPicExistant, pBornes);
        showPowerCapacityModal(result);
    }, 3000);
}

/** Injecte une seule fois (idempotent) le squelette de la modale — même principe que
 * createEnedisPreparationModal() (switchgrid_data.js) : construite en JS, ajoutée une fois à
 * document.body, réutilisée à chaque appel plutôt que reconstruite. */
function ensurePowerCapacityModal() {
    if (document.getElementById('irve-power-capacity-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'irve-power-capacity-modal';
    overlay.style.cssText = `
        display:none; position:fixed; top:0; left:0; width:100%; height:100%;
        background-color: rgba(0,0,0,0.4); z-index:10000;
        justify-content:center; align-items:center; padding:1rem; box-sizing:border-box;
    `;
    overlay.innerHTML = `
        <div id="irve-power-capacity-content" style="background: var(--bg-modal, #fff); border-radius: var(--border-radius-lg, 0.75rem); box-shadow: var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.1)); max-width: 720px; width:100%; max-height: 90vh; overflow-y:auto; border-left: 8px solid var(--border-color, #e5e7eb); font-family: var(--font-family, inherit);">
            <div id="irve-power-capacity-header" style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; padding:1.5rem 2rem 1rem;">
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <span id="irve-power-capacity-icon" style="font-size:1.8rem; line-height:1;"></span>
                    <h3 id="irve-power-capacity-title" style="margin:0; font-size:1.35rem; line-height:1.3; color: var(--text-primary, #1f2937);"></h3>
                </div>
                <button type="button" id="irve-power-capacity-close" aria-label="Fermer"
                    style="background:none; border:none; font-size:1.8rem; line-height:1; cursor:pointer; color: var(--text-secondary, #6b7280); padding:0; flex-shrink:0;">&times;</button>
            </div>
            <div style="padding: 0 2rem 2rem; color: var(--text-primary, #1f2937);">
                <p id="irve-power-capacity-message" style="margin:0 0 1.1rem; font-size:1.05rem; line-height:1.65;"></p>
                <ul id="irve-power-capacity-recommendations" style="margin:0; padding-left:1.4rem; font-size:1rem; line-height:1.6;"></ul>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
    });
    document.getElementById('irve-power-capacity-close').addEventListener('click', () => {
        overlay.style.display = 'none';
    });
}

function showPowerCapacityModal(result) {
    ensurePowerCapacityModal();

    // NOUVEAU (demande explicite : messages trop serrés/difficiles à lire) : icône + fond de
    // l'en-tête teinté selon la sévérité, en plus de la taille de police déjà agrandie dans
    // ensurePowerCapacityModal() — repère visuel immédiat, cohérent avec la couleur du titre.
    const severityStyles = {
        info: { color: 'var(--success-color, #22c55e)', bg: '#f0fdf4', icon: '✅' },
        warning: { color: '#ffc107', bg: '#fffbeb', icon: '⚠️' },
        error: { color: 'var(--danger-color, #ef4444)', bg: '#fef2f2', icon: '🚨' },
    };
    const style = severityStyles[result.severity] || severityStyles.info;

    const content = document.getElementById('irve-power-capacity-content');
    content.style.borderLeftColor = style.color;

    const header = document.getElementById('irve-power-capacity-header');
    header.style.backgroundColor = style.bg;
    header.style.borderRadius = 'var(--border-radius-lg, 0.75rem) var(--border-radius-lg, 0.75rem) 0 0';

    document.getElementById('irve-power-capacity-icon').textContent = style.icon;
    document.getElementById('irve-power-capacity-title').textContent = result.title;
    document.getElementById('irve-power-capacity-title').style.color = style.color;
    document.getElementById('irve-power-capacity-message').textContent = result.message;

    const list = document.getElementById('irve-power-capacity-recommendations');
    list.innerHTML = (result.recommendations || []).map((r) => `<li style="margin-bottom:0.6rem;">${r}</li>`).join('');

    document.getElementById('irve-power-capacity-modal').style.display = 'flex';
}

/** Bornes au format des vérifications (bilan de puissance, énergie). */
function bornesPourVerification() {
    return irveData.map(it => ({
        id: it.id, puissance: Number(it.puissance), pdc: Number(it.pdc), quantite: Number(it.quantite), type: it.type,
        tension: String(it.tension), customTension: it.tension === 'autre' ? Number(it.customTension) || 0 : null,
    }));
}

/**
 * Bilan de puissance : comparé au calcul de référence ; au-delà de 0,01 d'écart, les valeurs de
 * référence remplacent celles affichées (totaux, détail par borne, puissances des groupes).
 */
async function verifierBilanPuissance(params, js) {
    if (!window.VerificationIrve || !irveData.length) return;
    const verif = await window.VerificationIrve.verifier('bilan_puissance', { bornes: bornesPourVerification(), params, js });
    if (!verif) return;
    window.VerificationIrve.afficher(window.VerificationIrve.statut(document.getElementById('bilan-detail-table') || document.getElementById('res-Ib')?.closest('table'), 'bilan-verification-statut'), verif);
    if (verif.conforme || verif.indisponible) return;
    const ref = verif.reference;
    ref.detail.forEach(d => {
        const it = irveData.find(i => i.id === d.id);
        if (it) { it.Pact = d.p_actif_kw; it.Qrec = d.q_reactif_kvar; it.Sapp = d.s_apparente_kva; it.Ib = d.ib_a; }
    });
    document.getElementById('res-Ptot').textContent = ref.p_total_kw.toFixed(2);
    document.getElementById('res-Qtot').textContent = ref.q_total_kvar.toFixed(2);
    document.getElementById('res-Stot').textContent = ref.s_total_kva.toFixed(2);
    document.getElementById('res-Praccord').textContent = ref.praccord_kva.toFixed(2);
    document.getElementById('res-Ib').textContent = ref.ib_total_a.toFixed(1);
    updateDetailTable('bilan-detail-table', irveData.map(item => ({
        N: `IRVE ${item.id} (${item.quantite}x)`,
        TypeTension: `${item.type}/${item.tension === 'autre' ? item.customTension : (item.tension.includes('M') ? 'Mono' : 'Tri')}`,
        Punit: Number(item.puissance).toFixed(1), Pdc: item.pdc, Pact: item.Pact.toFixed(2), Qrec: item.Qrec.toFixed(2),
        Sapp: item.Sapp.toFixed(2), Ib: item.Ib.toFixed(1),
    })));
    groupIrveStations();
}

function updateDetailTable(tableId, data) {
    const detailTableBody = document.querySelector(`#${tableId} tbody`);
    if (!detailTableBody) return;

    if (tableId === 'bilan-detail-table') {
        detailTableBody.innerHTML = data.map(d => `
                     <tr>
                         <td>${d.N}</td><td>${d.TypeTension}</td><td>${d.Punit}</td><td>${d.Pdc}</td>
                         <td>${d.Pact}</td><td>${d.Qrec}</td><td>${d.Sapp}</td><td>${d.Ib}</td>
                     </tr>
                 `).join('');
    }
}

// Les fonctions CT/Iadm sont présentes mais non appelées

// --- LOGIQUE ÉNERGIE CONSOMMÉE (Section 4) ---

// Modal pour la Capacité Batterie 
function showBatterieModal(button) {
    document.getElementById('batterie-modal-overlay').style.display = 'block';
    showMessage("Simulation de capacité batterie en cours de développement.", 'info', 3000, button);
}

function toggleConsoMode(mode) {
    const manualSection = document.getElementById('manual-conso-section');
    const importSection = document.getElementById('import-conso-section');
    const generateSection = document.getElementById('generate-conso-section');

    // CORRECTIF (demande explicite : "le message 'Mode Génération activé...' s'affiche par défaut dès
    // l'ouverture du modal ; il doit s'afficher uniquement dans l'onglet 'Créer un profil de charge'")
    // : toggleConsoMode() est aussi appelée silencieusement à la restauration des données sauvegardées
    // (IrveStorageManager.js) et à la construction du payload de calcul (irve_payload_builder.js), pas
    // seulement au clic direct de l'utilisateur sur un radio "conso_mode" — lequel n'est de toute façon
    // visible que dans #section1-content, donc dans l'onglet "Créer un profil de charge" (cf.
    // irve_nav_menu.js). On ne montre ce toast QUE si cet onglet est bien celui actuellement affiché,
    // plutôt que de le déclencher à chaque appel silencieux quel que soit l'onglet actif.
    const isProfilChargeTabActive = !!document.querySelector('#irve-nav-menu [data-irve-nav="profil-charge"].active');

    if (mode === 'manual') {
        useImportedData = false;
        manualSection.style.display = 'block';
        importSection.style.display = 'none';
        if (generateSection) generateSection.style.display = 'none';
        document.getElementById('import_conso_file').value = '';
        if (isProfilChargeTabActive) showMessage("Mode Saisie Manuelle activé. Le profil annuel sera calculé à partir des données saisonnières.", 'info', 4000);

    } else if (mode === 'import') {
        useImportedData = true;
        manualSection.style.display = 'none';
        importSection.style.display = 'block';
        if (generateSection) generateSection.style.display = 'none';
        if (isProfilChargeTabActive) showMessage("Mode Importation activé. Veuillez charger un fichier pour définir le profil annuel du site.", 'info', 4000);

    } else if (mode === 'generate') {
        // Le profil généré (Méthode 1 ou 2, cf. loadProfileBottomUp.js/loadProfileTopDown.js) alimente
        // les mêmes données saisonnières (seasonalHourlyData) que la saisie manuelle, mais le tableau
        // manuel reste masqué en mode génération (il ne s'affiche que si "Saisie Manuelle" est choisi).
        useImportedData = false;
        if (generateSection) generateSection.style.display = 'block';
        manualSection.style.display = 'none';
        importSection.style.display = 'none';
        document.getElementById('import_conso_file').value = '';
        if (isProfilChargeTabActive) showMessage("Mode Génération activé. Choisissez une méthode (équipements ou profil annuel) puis cliquez sur Générer.", 'info', 4000);
    }
}

function importExistingData(input) {
    // ... (logique inchangée) ...
    if (input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    const statusElement = document.getElementById('import-data-status');

    statusElement.textContent = "Statut : Lecture du fichier en cours...";
    importedData = null;

    reader.onload = function (e) {
        try {
            let values = [];
            const lignes = []; // lignes de données brutes (date, valeur) : détection du pas
            const fileExtension = file.name.split('.').pop().toLowerCase();

            if (fileExtension === 'xlsx') {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                if (json.length < 5) {
                    statusElement.textContent = "Statut : Erreur - Fichier incomplet.";
                    showMessage("Fichier vide ou données manquantes.", 'error', 3000);
                    return;
                }

                // Les données commencent à la ligne 5 (index 4)
                for (let i = 4; i < json.length; i++) {
                    if (json[i] && json[i].length > 1 && json[i][1] !== undefined) {
                        const val = parseFloat(String(json[i][1]).replace(/\s/g, '').replace(',', '.'));
                        if (!isNaN(val)) {
                            values.push(val);
                            lignes.push(json[i]);
                        }
                    }
                }
            } else {
                // Pour CSV et TXT (séparation manuelle robuste)
                const text = new TextDecoder("utf-8").decode(e.target.result);
                const lines = text.split(/\r\n?|\n/);
                if (lines.length < 5) {
                    statusElement.textContent = "Statut : Erreur - Fichier incomplet.";
                    showMessage("Fichier vide ou données manquantes.", 'error', 3000);
                    return;
                }
                // Les données commencent à la ligne 5 (index 4)
                for (let i = 4; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const separator = line.includes(';') ? ';' : ',';
                    const parts = line.split(separator);
                    if (parts.length > 1) {
                        const val = parseFloat(parts[1].replace(/\s/g, '').replace(',', '.'));
                        if (!isNaN(val)) {
                            values.push(val);
                            lignes.push(parts);
                        }
                    }
                }
            }

            // CORRECTIF (import 10 min impossible) : le pas de 10 min (52 560 valeurs/an) n'était pas
            // reconnu ici — un fichier de consommation existante à ce pas était systématiquement
            // rejeté ("Nombre de valeurs inattendu"), même si tout le reste de la chaîne (synchro
            // ACI, PVGIS, etc.) le supporte déjà.
            let pasTempsMin = 60;
            // Pas lu sur les dates du fichier (cf. prodsolaire/pas_de_temps_courbe.js), le nombre de
            // lignes ne servant qu'à défaut : une demi-année au pas de 30 min (8 760 lignes) était lue
            // comme une année horaire, son énergie doublée et étirée sur 12 mois.
            const pasFichier = typeof window.detecterPasDeTempsCourbe === 'function' ? window.detecterPasDeTempsCourbe(lignes) : null;
            if (pasFichier) {
                const parAn = 525600 / pasFichier;
                const parJour = 1440 / pasFichier;
                if (values.length < parAn || values.length > parAn + parJour) {
                    const jours = (values.length / parJour).toFixed(0);
                    statusElement.textContent = `Statut : Erreur - Le fichier couvre environ ${jours} jours au pas de ${pasFichier} min (${values.length} valeurs) : une année complète est attendue (${parAn} valeurs).`;
                    showMessage(`Année incomplète : ${jours} jours au pas de ${pasFichier} min.`, 'error', 5000);
                    return;
                }
            }
            // Courbe au pas de 5 min (R63 Enedis) : entrée seulement, ramenée par moyenne au pas de
            // simulation choisi (5 min n'est pas un pas de simulation).
            if (pasFichier === 5 || (!pasFichier && values.length >= 105120 && values.length <= 105408)) {
                const pasCible = parseInt(document.getElementById('pas_temps')?.value, 10) || 60;
                values = reechantillonnerPuissances(values.slice(0, 105120), 5, pasCible);
                showMessage(`Courbe au pas de 5 min ramenée par moyenne au pas de ${pasCible} min.`, 'info', 5000);
            }
            const pasValeurs = pasFichier && pasFichier !== 5 ? pasFichier : null;
            if (pasValeurs ? pasValeurs === 60 : (values.length >= 8760 && values.length <= 8784)) {
                pasTempsMin = 60;
                values = values.slice(0, 8760);
            } else if (pasValeurs ? pasValeurs === 30 : (values.length >= 17520 && values.length <= 17568)) {
                pasTempsMin = 30;
                values = values.slice(0, 17520);
            } else if (pasValeurs ? pasValeurs === 15 : (values.length >= 35040 && values.length <= 35136)) {
                pasTempsMin = 15;
                values = values.slice(0, 35040);
            } else if (pasValeurs ? pasValeurs === 10 : (values.length >= 52560 && values.length <= 52704)) {
                pasTempsMin = 10;
                values = values.slice(0, 52560);
            } else {
                statusElement.textContent = `Statut : Erreur - Nombre de valeurs inattendu (${values.length}). Attendu: 8760, 17520, 35040, 52560 ou 105120 (5 min).`;
                showMessage(`Nombre inattendu: ${values.length}`, 'error', 3000);
                return;
            }

            const dataPoints = [];
            const simYear = parseInt(document.getElementById('export_annee')?.value) || new Date().getFullYear();
            let currentTime = new Date(simYear, 0, 1, 0, 0, 0).getTime();

            for (let i = 0; i < values.length; i++) {
                dataPoints.push({ time: currentTime, kva: values[i] });
                currentTime += pasTempsMin * 60000;
            }

            importedData = dataPoints;
            importedPasTemps = pasTempsMin;

            statusElement.textContent = `Statut : ${values.length} points chargés. Pas de temps estimé : ${pasTempsMin} min.`;
            showMessage(`Importation réussie! ${values.length} points chargés.`, 'info', 4000);

            const pasTempsSelect = document.getElementById('pas_temps');
            if (pasTempsSelect) {
                pasTempsSelect.value = pasTempsMin.toString();
                updateTimeSlider();
            }
            if (typeof renderSiteConsumptionCharts === 'function') renderSiteConsumptionCharts();
        } catch (err) {
            statusElement.textContent = "Statut : Erreur lors de la lecture du fichier.";
            showMessage("Erreur de lecture: " + err.message, 'error', 3000);
        }
    };

    reader.readAsArrayBuffer(file);
}

function clearImportedData(button) {
    importedData = null;
    importedPasTemps = 60;
    document.getElementById('import_conso_file').value = '';
    document.getElementById('import-data-status').textContent = "Statut : Aucun fichier importé.";
    showMessage("Données importées effacées.", 'info', 2000, button);
}

function updateSeasonalData(season, hour, value) {
    if (seasonalHourlyData[season]) {
        seasonalHourlyData[season][hour] = value;
        calculateAverageExistingData();
        document.getElementById('seasonal-data-status').textContent = `Statut : Données de ${season} mises à jour. Profil annuel moyen mis à jour.`;
        if (typeof renderSiteConsumptionCharts === 'function') renderSiteConsumptionCharts();
    }
}

function calculateAverageExistingData() {
    existingHourlyData = Array(24).fill(0);
    const seasons = ['Hiver', 'Printemps', 'Été', 'Automne'];

    for (let h = 0; h < 24; h++) {
        let sum = 0;
        seasons.forEach(season => {
            sum += seasonalHourlyData[season][h];
        });
        existingHourlyData[h] = sum / seasons.length;
    }
    document.getElementById('seasonal-data-status').textContent = `Statut : ${seasons.length * 24} valeurs saisies. Profil annuel moyen mis à jour. (Moyenne à 60 min : ${existingHourlyData.map(v => v.toFixed(0)).join(', ')})`;
}

function clearSeasonalData(season, button) {
    if (seasonalHourlyData[season]) {
        seasonalHourlyData[season] = Array(24).fill(0);
        document.querySelectorAll(`#seasonal-consumption-table input[data-season="${season}"]`).forEach(input => input.value = 0);
        calculateAverageExistingData();
        showMessage(`Données de ${season} effacées.`, 'info', 2000, button);
    }
}

function clearAllSeasonalData(button) {
    Object.keys(seasonalHourlyData).forEach(season => {
        seasonalHourlyData[season] = Array(24).fill(0);
    });
    document.querySelectorAll(`#seasonal-consumption-table input`).forEach(input => input.value = 0);
    calculateAverageExistingData();
    showMessage("Toutes les données saisonnières effacées.", 'info', 2000, button);
}

const SEASONAL_COPY_LIST = ['Hiver', 'Printemps', 'Été', 'Automne'];

function showSeasonalCopyModal(button) {
    const modalOverlay = document.getElementById('copy-modal-overlay');
    const modalContent = document.getElementById('copy-modal-content');

    modalContent.innerHTML = `
                <h4 style="margin-top: 0;">Copier les données saisonnières</h4>
                <p>Copier de :
                    <select id="copy-from-season" class="modern-input" style="padding: 5px; border-radius: 4px; width: 100%;" onchange="renderSeasonalCopyTargets()">
                        ${SEASONAL_COPY_LIST.map(s => `<option value="${s}">${s}</option>`).join('')}
                    </select>
                </p>
                <p style="margin-bottom: 5px;">Vers (les 3 autres saisons), avec un coefficient multiplicateur propre à chacune :</p>
                <div id="copy-targets-container"></div>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 15px;">
                    <button class="btn-base btn-secondary capitalize-first-letter" style="text-transform: none;" onclick="document.getElementById('copy-modal-overlay').style.display='none'">annuler</button>
                    <button class="btn-base btn-primary capitalize-first-letter" style="text-transform: none;" onclick="performSeasonalCopy(this)">appliquer</button>
                </div>
            `;

    renderSeasonalCopyTargets();
    modalOverlay.style.display = 'block';
}

function renderSeasonalCopyTargets() {
    const fromSeason = document.getElementById('copy-from-season').value;
    const container = document.getElementById('copy-targets-container');
    if (!container) return;

    container.innerHTML = SEASONAL_COPY_LIST.filter(s => s !== fromSeason).map(s => `
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                    <span style="flex: 1 1 40%;">${s}</span>
                    <input type="number" class="modern-input copy-target-multiplier" data-target-season="${s}"
                        value="1.0" step="0.1" min="1" max="2" style="padding: 5px; border-radius: 4px; flex: 1 1 40%;">
                </div>
            `).join('');
}

function performSeasonalCopy(button) {
    const fromSeason = document.getElementById('copy-from-season').value;
    const targetInputs = document.querySelectorAll('.copy-target-multiplier');

    for (const input of targetInputs) {
        const multiplier = parseFloat(input.value);
        if (isNaN(multiplier) || multiplier < 1 || multiplier > 2) {
            showMessage("Chaque coefficient doit être compris entre 1 et 2.", 'error', 3000, button);
            return;
        }
    }

    const appliedTo = [];
    targetInputs.forEach((input) => {
        const toSeason = input.dataset.targetSeason;
        const multiplier = parseFloat(input.value);
        seasonalHourlyData[toSeason] = seasonalHourlyData[fromSeason].map(v => v * multiplier);

        const newValues = seasonalHourlyData[toSeason];
        document.querySelectorAll(`#seasonal-consumption-table input[data-season="${toSeason}"]`).forEach((cellInput, h) => {
            cellInput.value = newValues[h].toFixed(2);
        });
        appliedTo.push(`${toSeason} (x${multiplier})`);
    });

    calculateAverageExistingData();
    document.getElementById('copy-modal-overlay').style.display = 'none';
    showMessage(`Données de ${fromSeason} copiées vers ${appliedTo.join(', ')}.`, 'info', 4000);
}


function updateTimeSlider() {
    currentPasTemps = parseInt(document.getElementById('pas_temps').value);
    groupIrveStations();
}

function groupIrveStations(button) {
    if (irveData.length === 0) {
        if (button) showMessage("Veuillez d'abord ajouter les bornes.", 'error', 3000, button);
        irveGroups = [];
        updatePlanningDetailTable();
        return;
    }

    // Préserver la configuration de stratégie de charge déjà en place (ou restaurée depuis le
    // localStorage) pour chaque groupe, car ce tableau est reconstruit à chaque appel.
    const previousConfigByKey = {};
    (irveGroups || []).forEach(g => {
        previousConfigByKey[g.key] = {
            smartMode: g.smartMode,
            targetKwh: g.targetKwh,
            departureHour: g.departureHour,
            autoEcoRecharge: g.autoEcoRecharge,
            batteryCapacity: g.batteryCapacity,
        };
    });

    irveGroups = irveData.map(item => {
        const groupKey = `IRVE_${item.id}`;
        const tensionLabel = item.tension === 'autre' ? `${item.customTension}V` : (item.tension.includes('M') ? 'Mono' : 'Tri');
        const groupName = `IRVE ${item.id} (${item.type}/${tensionLabel}) - ${item.quantite}x${item.pdc}`;

        return {
            key: groupKey, name: groupName, irveIds: [item.id],
            totalSapp: item.Sapp || 0, totalQty: item.quantite * item.pdc,
            type: item.type,
            segments: irveChargingPlan[groupKey] || {},
            ...previousConfigByKey[groupKey],
        };
    });

    updatePlanningDetailTable();
    if (button) showMessage("Planification par borne/groupe activée.", 'info', 2000, button);
}

function updatePlanningDetailTable() {
    const tbody = document.getElementById('planning-detail-tbody');
    if (!tbody) return;

    if (irveGroups.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Aucune borne n'a été configurée. Calculez d'abord le bilan de puissance.</td></tr>`;
        return;
    }

    // Applique le filtre Statique/Dynamique avant l'affichage (Tâche 3)
    window.SmartCharging.enforceModeConstraints(irveGroups);

    tbody.innerHTML = '';
    irveGroups.forEach(group => {
        const newRow = tbody.insertRow();
        // Bouton du simulateur « Configuration Batterie & Éco » (analyse_eco_irve.js, porté de Socalts).
        newRow.innerHTML = `<td>${group.name}</td>
                            <td>${group.totalSapp.toFixed(2)} kVA</td>
                            <td>${group.totalQty}</td>
                            <td><button type="button" class="btn-base btn-secondary" style="font-size:0.8rem; padding:0.3rem 0.5rem;" onclick="window.showBatteryDetailModal('${group.key}', this)">Config. charge et Éco</button></td>
                            <td>${window.SmartCharging.buildUI(group)}</td>`;

        initGroupTimeSlider(group.key, group.segments);
    });
}

function initGroupTimeSlider(groupKey, initialSegments = {}) {
    const pasTempsMin = parseInt(document.getElementById('pas_temps').value) || 30;
    const numSegments = 24 * (60 / pasTempsMin);
    const gridContainer = document.getElementById(`planning-grid-${groupKey}`);

    if (!gridContainer) return;

    gridContainer.innerHTML = '';
    gridContainer.style.gridTemplateColumns = `repeat(${numSegments}, 1fr)`;
    gridContainer.style.gap = pasTempsMin >= 60 ? '1px' : '0.5px';

    if (!irveChargingPlan[groupKey] || Object.keys(irveChargingPlan[groupKey]).length === 0) {
        irveChargingPlan[groupKey] = {};
    }

    for (let i = 0; i < numSegments; i++) {
        const segment = document.createElement('div');
        segment.classList.add('segment');
        segment.dataset.index = i;
        segment.dataset.group = groupKey;

        const hour = Math.floor(i * pasTempsMin / 60).toString().padStart(2, '0');
        const minute = (i * pasTempsMin % 60).toString().padStart(2, '0');
        segment.title = `${hour}:${minute} (${pasTempsMin} min)`;

        if (irveChargingPlan[groupKey][i]) { segment.classList.add('selected'); }

        segment.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDrawing = true;
            dragMoved = false;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            // L'état à appliquer (sélection ou désélection) est fixé une fois pour toutes
            // sur le créneau cliqué : les créneaux survolés ensuite (uniquement en cas de
            // glissement réel) reprendront ce même état plutôt que de basculer chacun leur état.
            drawValue = !segment.classList.contains('selected');
            toggleGroupSegment(segment, i, groupKey, drawValue);
        });
        segment.addEventListener('mouseenter', () => {
            if (isDrawing && dragMoved) toggleGroupSegment(segment, i, groupKey, drawValue);
        });

        gridContainer.appendChild(segment);
    }
}

document.addEventListener('mouseup', () => { isDrawing = false; dragMoved = false; drawValue = null; });
document.addEventListener('mousemove', (e) => {
    if (!isDrawing || dragMoved) return;
    if (Math.abs(e.clientX - dragStartX) > DRAG_THRESHOLD_PX || Math.abs(e.clientY - dragStartY) > DRAG_THRESHOLD_PX) {
        dragMoved = true;
    }
});

function toggleGroupSegment(segmentElement, index, groupKey, forceValue = null) {
    const isSelected = forceValue !== null ? forceValue : !segmentElement.classList.contains('selected');
    segmentElement.classList.toggle('selected', isSelected);
    irveChargingPlan[groupKey][index] = isSelected;
}

function setQuickPlan(groupKey, type, button) {
    const pasTempsMin = parseInt(document.getElementById('pas_temps').value) || 30;
    const segmentsInHour = 60 / pasTempsMin;
    const gridContainer = document.getElementById(`planning-grid-${groupKey}`);

    if (!gridContainer) return;

    irveChargingPlan[groupKey] = {};
    let segmentsToSelect = [];

    if (type === 'weekday') {
        // 9h-11h et 14h-16h
        const startSegment1 = 9 * segmentsInHour;
        const endSegment1 = 11 * segmentsInHour;
        const startSegment2 = 14 * segmentsInHour;
        const endSegment2 = 16 * segmentsInHour;

        for (let i = startSegment1; i < endSegment1; i++) segmentsToSelect.push(i);
        for (let i = startSegment2; i < endSegment2; i++) segmentsToSelect.push(i);

        showMessage("Plage 'Jours ouvrés' (09h00-11h00 et 14h00-16h00) appliquée.", 'info', 2000, button);
    } else if (type === 'weekend') {
        // Rien par défaut pour le week-end
        showMessage("Plage 'Week-end' réinitialisée (aucune heure sélectionnée).", 'info', 2000, button);
    }

    Array.from(gridContainer.children).forEach((segment, index) => {
        const shouldBeSelected = segmentsToSelect.includes(index);
        if (shouldBeSelected) {
            segment.classList.add('selected');
            irveChargingPlan[groupKey][index] = true;
        } else {
            segment.classList.remove('selected');
            irveChargingPlan[groupKey][index] = false;
        }
    });
}

function getInactiveDays(year) {
    // ... (logique inchangée) ...
    const inactiveDays = new Set();
    const input = document.getElementById('jours_feries').value;
    const parts = input.split(',').map(s => s.trim()).filter(s => s.length > 0);

    parts.forEach(part => {
        if (part.includes('-')) {
            const [startStr, endStr] = part.split('-');
            const [dayStart, monthStart] = startStr.split('/').map(Number);
            const [dayEnd, monthEnd] = endStr.split('/').map(Number);

            let current = new Date(year, monthStart - 1, dayStart);
            const end = new Date(year, monthEnd - 1, dayEnd);
            if (monthStart > monthEnd) end.setFullYear(year + 1);

            while (current <= end) {
                const dayKey = `${current.getDate().toString().padStart(2, '0')}/${(current.getMonth() + 1).toString().padStart(2, '0')}`;
                if (current.getDay() !== 6 && current.getDay() !== 0) {
                    inactiveDays.add(dayKey);
                }
                current.setDate(current.getDate() + 1);
            }
        } else if (part.includes('/')) {
            const [day, month] = part.split('/').map(Number);
            const date = new Date(year, month - 1, day);
            const dayKey = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}`;

            if (date.getDay() !== 6 && date.getDay() !== 0) {
                inactiveDays.add(dayKey);
            }
        }
    });

    return inactiveDays;
}

async function calculateEnergie(button) {
    if (irveData.length === 0) { showMessage("Veuillez d'abord choisir les matériels.", 'error', 3000, button); return; }
    // CORRECTIF (validation stricte) : garde dure — refuse le calcul si un champ est hors bornes.
    if (typeof window.getIrveFieldViolations === 'function') {
        const violation = window.getIrveFieldViolations();
        if (violation) {
            showMessage(violation.message, 'error', 4000, button);
            if (typeof window.updateIrveSubmitButtonsState === 'function') window.updateIrveSubmitButtonsState();
            return;
        }
    }
    // CORRECTIF : garantit que le bilan de puissance (Pact/Qrec/Sapp/Ib par borne, désormais
    // recalculé automatiquement à chaque modification des matériels) est bien à jour au moment de
    // lancer la simulation, même si aucune modification n'a eu lieu depuis l'ouverture de la modale.
    calculateBilanPuissance(null, true);
    groupIrveStations();
    if (irveGroups.length === 0) return;

    const limitInput = document.getElementById('limitation_puissance');
    const pasTempsMin = parseInt(document.getElementById('pas_temps').value) || 30;
    // Champ vide = puissance souscrite non renseignée (aucun plafond). Une valeur nulle ou négative
    // n'est plus convertie en « illimitée » : elle est refusée (cf. irveValidation.js).
    const puissanceSouscriteSaisie = parseFloat(document.getElementById('puissance_souscrite').value);
    if (Number.isFinite(puissanceSouscriteSaisie) && puissanceSouscriteSaisie <= 0) {
        showMessage("La puissance souscrite doit être supérieure à 0 kVA (laissez le champ vide si elle n'est pas connue).", 'error', 5000, button);
        return;
    }
    const puissanceSouscrite = Number.isFinite(puissanceSouscriteSaisie) ? puissanceSouscriteSaisie : Infinity;
    const PuissanceMaxIRVE = (limitInput && parseFloat(limitInput.value) > 0) ? parseFloat(limitInput.value) : Infinity;

    const rendementAC = parseFloat(document.getElementById('rendement_borne_ac').value) || 0.90;
    const rendementDC = parseFloat(document.getElementById('rendement_borne_dc').value) || 0.95;

    let existingDataToUse = Array(24).fill(0);
    let effectivePasTemps = 60;

    if (useImportedData && importedData && importedData.length > 0) {
        effectivePasTemps = importedPasTemps;
        existingDataToUse = aggregateImportedData(importedData, 60);
    } else {
        effectivePasTemps = 60;
        existingDataToUse = existingHourlyData;
    }

    const existingDataHourly = existingDataToUse;

    const simulationYear = parseInt(document.getElementById('export_annee').value) || 2024;
    const isLeap = isLeapYear(simulationYear);
    const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    const inactiveDays = getInactiveDays(simulationYear);
    const nbJoursNonOuvresTotal = parseInt(document.getElementById('nb_jours_non_ouvres').value) || 0;
    const totalDaysInYear = isLeapYear(simulationYear) ? 366 : 365;
    const annualWorkingDays = totalDaysInYear - nbJoursNonOuvresTotal;
    const workingDaysRatio = annualWorkingDays / totalDaysInYear;

    const segmentsPerDay = 24 * (60 / pasTempsMin);
    let dailyTotalIRVE_kVA = Array(segmentsPerDay).fill(0);
    let dailyTotalIRVE_kW_consumed = Array(segmentsPerDay).fill(0);
    let maxPowerRef = 0;

    let totalEnergyNeededKwh = 0;
    // Calcul du profil IRVE non optimisé (SANS le Coefficient de Simultanéité Ks pour l'énergie)
    irveGroups.forEach(group => {
        const segmentsSelected = irveChargingPlan[group.key] || {};
        const item = irveData.find(i => i.id === group.irveIds[0]);
        if (!item) return;

        // Puissance active totale brute sans Ks (kW) et puissance apparente (kVA)
        const P_brute_kW = item.puissance * item.quantite * item.pdc;
        const CosPhi = item.type === 'DC' ? (parseFloat(document.getElementById('cosphi_dc').value) || 0.98) : (parseFloat(document.getElementById('cosphi_ac').value) || 0.98);
        const S_brute_kVA = P_brute_kW / CosPhi;

        const rendement = item.type === 'DC' ? rendementDC : rendementAC;
        const P_consommee_kW = P_brute_kW / rendement;

        totalEnergyNeededKwh += group.targetKwh || 0;

        for (let i = 0; i < segmentsPerDay; i++) {
            if (segmentsSelected[i]) {
                dailyTotalIRVE_kVA[i] += S_brute_kVA;
                dailyTotalIRVE_kW_consumed[i] += P_consommee_kW;
                maxPowerRef = Math.max(maxPowerRef, dailyTotalIRVE_kVA[i]);
            }
        }
    });

    // Application des stratégies de charge
    let totalEnergyDeliveredKwh = 0;
    for (let i = 0; i < segmentsPerDay; i++) {
        const hour = Math.floor(i * pasTempsMin / 60);
        const existingLoad = existingDataHourly[hour] || 0;
        
        // Limite DPM globale (bornes + site)
        let availablePowerForIrve = puissanceSouscrite - existingLoad;
        
        // Limite DPM spécifique aux bornes
        availablePowerForIrve = Math.min(availablePowerForIrve, PuissanceMaxIRVE);

        let current_kVA = dailyTotalIRVE_kVA[i];
        let current_kW_consumed = dailyTotalIRVE_kW_consumed[i];

        if (current_kVA > availablePowerForIrve) {
            const ratio = availablePowerForIrve / current_kVA;
            current_kVA = availablePowerForIrve;
            current_kW_consumed *= ratio;
        }

        // Gestion du besoin cible en kWh
        if (totalEnergyNeededKwh > 0 && totalEnergyDeliveredKwh >= totalEnergyNeededKwh) {
            current_kVA = 0;
            current_kW_consumed = 0;
        } else {
            totalEnergyDeliveredKwh += current_kW_consumed * (pasTempsMin / 60);
        }

        dailyTotalIRVE_kVA[i] = current_kVA;
        dailyTotalIRVE_kW_consumed[i] = current_kW_consumed;
    }

    let hourlyIRVE_Avg = Array(24).fill(0).map((_, h) => {
        const start = h * (60 / pasTempsMin);
        const end = start + (60 / pasTempsMin);
        const hourSegments = dailyTotalIRVE_kVA.slice(start, end);
        return hourSegments.reduce((sum, p) => sum + p, 0) / hourSegments.length;
    });

    // Calculer la moyenne IRVE par HEURE pour le graph 1 (Bornes + Site)
    let totalDailyConso_kVA_Hourly = hourlyIRVE_Avg.map((irveP, h) => irveP + existingDataHourly[h]);

    // Calcul de l'énergie mensuelle (avec rendement et limitation)
    let dailyTotalEnergy_kWh = dailyTotalIRVE_kW_consumed.reduce((sum, p) => sum + (p * (pasTempsMin / 60)), 0);

    let totalEnergy_IRVE_kWh_Annual = 0;
    let monthlyConsumptionMWh = daysInMonth.map((daysTotal) => {
        const monthlyWorkingDays = daysTotal * workingDaysRatio;
        const monthlyEnergy_kWh = dailyTotalEnergy_kWh * monthlyWorkingDays;

        totalEnergy_IRVE_kWh_Annual += monthlyEnergy_kWh;
        return monthlyEnergy_kWh / 1000; // MWh
    });

    // Vérification du calcul de l'énergie AVANT tout affichage et avant l'enregistrement de la courbe
    // annuelle : au-delà d'un écart de 0,01, les valeurs de référence remplacent celles du navigateur
    // (profils, énergie mensuelle et annuelle) et toute la suite (graphiques, bilan, courbe) en découle.
    if (window.VerificationIrve) {
        const segParJour = segmentsPerDay;
        const verifEnergie = await window.VerificationIrve.verifier('energie', {
            pas_temps_min: pasTempsMin,
            bornes: bornesPourVerification(),
            groupes: irveGroups.map(g => ({
                key: g.key, irve_id: g.irveIds[0], target_kwh: Number(g.targetKwh) || 0,
                segments: Array.from({ length: segParJour }, (_, i) => !!(irveChargingPlan[g.key] || {})[i]),
            })),
            cosphi_ac: parseFloat(document.getElementById('cosphi_ac').value) || 0.98,
            cosphi_dc: parseFloat(document.getElementById('cosphi_dc').value) || 0.98,
            rendement_ac: rendementAC, rendement_dc: rendementDC,
            puissance_souscrite: Number.isFinite(puissanceSouscrite) ? puissanceSouscrite : null,
            puissance_max_irve: Number.isFinite(PuissanceMaxIRVE) ? PuissanceMaxIRVE : null,
            existing_hourly: existingDataHourly.map(v => Number(v) || 0),
            annee: simulationYear, nb_jours_non_ouvres: nbJoursNonOuvresTotal,
            js: {
                segments_kva: dailyTotalIRVE_kVA, segments_kw: dailyTotalIRVE_kW_consumed, horaire_irve_kva: hourlyIRVE_Avg,
                energie_jour_kwh: dailyTotalEnergy_kWh, mensuel_mwh: monthlyConsumptionMWh, total_irve_kwh: totalEnergy_IRVE_kWh_Annual,
                puissance_irve_dpm_kva: dailyTotalIRVE_kVA.reduce((max, p) => Math.max(max, p), 0) || 0, puissance_ref_kva: maxPowerRef,
            },
        });
        window.VerificationIrve.afficher(window.VerificationIrve.statut(document.getElementById('irve-aci-sync-status'), 'energie-verification-statut'), verifEnergie);
        if (verifEnergie && !verifEnergie.conforme && !verifEnergie.indisponible) {
            const ref = verifEnergie.reference;
            dailyTotalIRVE_kVA = ref.segments_kva;
            dailyTotalIRVE_kW_consumed = ref.segments_kw;
            hourlyIRVE_Avg = ref.horaire_irve_kva;
            totalDailyConso_kVA_Hourly = hourlyIRVE_Avg.map((irveP, h) => irveP + existingDataHourly[h]);
            dailyTotalEnergy_kWh = ref.energie_jour_kwh;
            monthlyConsumptionMWh = ref.mensuel_mwh;
            totalEnergy_IRVE_kWh_Annual = ref.total_irve_kwh;
            maxPowerRef = ref.puissance_ref_kva;
        }
    }


    simulationResults[pasTempsMin] = {
        labels: monthlyLabels, data: monthlyConsumptionMWh, pasTemps: pasTempsMin,
        puissanceRef: maxPowerRef,
        puissanceIRVE_DPM: dailyTotalIRVE_kVA.reduce((max, p) => Math.max(max, p), 0) || 0,
        hourlyIRVE: hourlyIRVE_Avg,
        hourlyTotal: totalDailyConso_kVA_Hourly,
        hourlyExisting: existingDataHourly,
    };

    document.getElementById('charts-section').style.display = 'block';

    const hourlyLabels = Array(24).fill(0).map((_, i) => `${i}h`);

     // CORRECTION: Calculer le maximum de l'axe Y pour le graphique
    const maxPower = Math.max(...totalDailyConso_kVA_Hourly);
    const yAxisMax = Math.max(maxPower, puissanceSouscrite !== Infinity ? puissanceSouscrite : 0) * 1.1; // Ajoute une marge de 10%

    // Calcul du Bilan Énergétique (Site vs IRVE)
    const totalIrveMWh = monthlyConsumptionMWh.reduce((sum, val) => sum + val, 0);
    const totalExistingMWh = existingDataHourly.reduce((sum, val) => sum + val, 0) * totalDaysInYear / 1000;
    const totalEnergyMWh = totalIrveMWh + totalExistingMWh;

    const pctIrve = totalEnergyMWh > 0 ? (totalIrveMWh / totalEnergyMWh * 100).toFixed(1) : 0;
    const pctExisting = totalEnergyMWh > 0 ? (totalExistingMWh / totalEnergyMWh * 100).toFixed(1) : 0;

    const bilanTbody = document.querySelector('#bilan-energie-table tbody');
    if (bilanTbody) {
        bilanTbody.innerHTML = `
                    <tr><td style="text-align:left;">Consommation Site Existante</td><td>${totalExistingMWh.toFixed(2)}</td><td>${pctExisting}%</td></tr>
                    <tr><td style="text-align:left;">Consommation IRVE</td><td>${totalIrveMWh.toFixed(2)}</td><td>${pctIrve}%</td></tr>
                    <tr style="font-weight:bold; background-color:#e0e0e0;"><td style="text-align:left;">TOTAL</td><td>${totalEnergyMWh.toFixed(2)}</td><td>100%</td></tr>
                `;
    }

    if (window.bilanEnergiePieChart) window.bilanEnergiePieChart.destroy();
    const ctxPie = document.getElementById('bilan-energie-pie-chart').getContext('2d');
    window.bilanEnergiePieChart = new Chart(ctxPie, {
        type: 'pie',
        data: {
            labels: ['Site Existant', 'IRVE'],
            datasets: [{
                data: [totalExistingMWh, totalIrveMWh],
                backgroundColor: ['#1E8449', '#dc2626']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                title: { display: true, text: 'Répartition de la Consommation Annuelle' },
                datalabels: {
                    display: true,
                    formatter: (value, ctx) => {
                        let sum = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                        if (sum === 0) return '0%';
                        return (value * 100 / sum).toFixed(1) + "%";
                    },
                    color: '#fff',
                    font: { weight: 'bold' }
                }
            }
        }
    });

    // Graphique 1: Courbe de Charge Journalière (Bornes + Site)
    if (annualLoadChart) annualLoadChart.destroy();
    annualLoadChart = new Chart(document.getElementById('annual-load-chart'), {
        type: 'bar',
        data: {
            labels: hourlyLabels,
            datasets: [
                // existingDataHourly est utilisée directement (kW/h)
                { label: `Consommation Site Existante Moyenne (kW)`, data: existingDataHourly, backgroundColor: '#1E8449', stack: 'stack0', borderRadius: 5 },
                { label: `Consommation Bornes IRVE (kVA)`, data: hourlyIRVE_Avg.map(v => v > 0 ? v : 0), backgroundColor: 'rgba(220, 38, 38, 0.7)', stack: 'stack0', borderRadius: 5 },
                // CORRECTION: Ajout de la ligne de puissance souscrite
                {
                    type: 'line',
                    label: 'Puissance Souscrite (kVA)',
                    data: Array(24).fill(puissanceSouscrite !== Infinity ? puissanceSouscrite : null),
                    borderColor: 'red',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { title: { display: true, text: 'Heure (H)' } },
                y: { 
                    title: { display: true, text: 'Puissance (kVA/kW)' }, 
                    stacked: true,
                    max: yAxisMax > 0 ? yAxisMax : undefined // CORRECTION: Augmenter la valeur max de l'axe Y
                }
            },
            plugins: { title: { display: true, text: 'Courbe de Charge Journalière (Bornes + Site)' } }
        }
    });

    // Graphique 2: Énergie IRVE Consommée par Mois (IRVE seulement)
    if (monthlyConsumptionChart) monthlyConsumptionChart.destroy();
    monthlyConsumptionChart = new Chart(document.getElementById('monthly-consumption-chart'), {
        type: 'bar',
        data: {
            labels: monthlyLabels,
            datasets: [{ label: `Consommation Mensuelle IRVE (MWh)`, data: monthlyConsumptionMWh, backgroundColor: '#dc2626', borderRadius: 5 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { title: { display: true, text: 'Énergie (MWh)' } } },
            plugins: { title: { display: true, text: 'Énergie IRVE Consommée par Mois' } }
        }
    });

    // CORRECTIF : Transfert de la courbe de charge IRVE vers l'Autoconsommation individuelle, via
    // la base de données (POST .../irve/save-curve) plutôt que localStorage (stagedIrveData/
    // sharedIrveData) — canal peu fiable (perdu au changement de poste/navigateur, source d'erreurs
    // de calcul déjà rencontrées). Élargi à tout pas de temps supporté (10/15/30/60 min, au lieu de
    // 60 min imposé). Construit la courbe à la RÉSOLUTION NATIVE (dailyTotalIRVE_kW_consumed, déjà
    // calculée ci-dessus par jour type) plutôt que la moyenne horaire aplatie (hourlyIRVE_Avg), et
    // met à zéro les segments IRVE des jours dans inactiveDays (weekends + jours fériés saisis) au
    // lieu de répéter le même jour type sans distinction pour les 365/366 jours de l'année.
    //
    // CORRECTIF (total ACC/ACI ≠ bilan IRVE) : deux bugs corrigés ici —
    // 1) dailyTotalIRVE_kVA (puissance APPARENTE, utilisée pour le dimensionnement) était exportée
    //    par erreur au lieu de dailyTotalIRVE_kW_consumed (puissance ACTIVE réellement soutirée au
    //    réseau, rendement du chargeur inclus) — c'est cette dernière qui alimente la ligne
    //    "Consommation IRVE" du bilan énergétique juste au-dessus (dailyTotalEnergy_kWh).
    // 2) Le nombre de jours "inactifs" (weekends + inactiveDays) ne correspond pas forcément au
    //    nombre de jours non-ouvrés saisi par l'utilisateur (nb_jours_non_ouvres, utilisé par le
    //    bilan mensuel via workingDaysRatio) : les deux mécanismes sont indépendants. Plutôt que de
    //    tenter de les faire coïncider jour par jour, on conserve la FORME réaliste (zéro le
    //    weekend/jours fériés) mais on renormalise l'ensemble pour que la somme annuelle de la
    //    courbe exportée corresponde EXACTEMENT à totalEnergy_IRVE_kWh_Annual (= la ligne
    //    "Consommation IRVE" du bilan, en kWh) — le nombre que l'utilisateur retrouve dans l'ACI/ACC
    //    est ainsi garanti identique à celui affiché ici, quelle que soit la forme jour par jour.
    let irveSyncOk = null; // null = pas de tentative, true/false = résultat de la synchro avec l'ACI
    let irveSyncErrorDetail = '';
    const projetId = localStorage.getItem('current_projet_id');
    window.irveCourbeAnnuelle = null; // reconstruite ci-dessous s'il y a une consommation IRVE

    if (totalIrveMWh > 0) {
        const hasExisting = existingDataHourly.some(v => v > 0);
        const segmentsPerHour = segmentsPerDay / 24;
        const fullYearExisting = [];
        const fullYearIrve = [];
        const fullYearTotal = [];

        for (let day = 0; day < totalDaysInYear; day++) {
            const date = new Date(simulationYear, 0, 1 + day);
            // Grille annuelle de 365 jours (celle de l'autoconsommation) : le 29 février d'une année
            // bissextile est retiré — l'énergie annuelle reste celle du bilan grâce à la
            // renormalisation ci-dessous (avant : le 31 décembre était coupé côté autoconsommation).
            if (date.getMonth() === 1 && date.getDate() === 29) continue;
            const dayKey = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}`;
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            const isInactive = isWeekend || inactiveDays.has(dayKey);

            for (let seg = 0; seg < segmentsPerDay; seg++) {
                const hour = Math.floor(seg / segmentsPerHour);
                const existingVal = existingDataHourly[hour] || 0; // consommation du site : continue hors charge IRVE
                const irveVal = isInactive ? 0 : (dailyTotalIRVE_kW_consumed[seg] || 0);
                fullYearExisting.push(existingVal);
                fullYearIrve.push(irveVal);
                fullYearTotal.push(existingVal + irveVal);
            }
        }

        // Renormalisation : la somme annuelle de fullYearIrve doit correspondre EXACTEMENT à
        // totalEnergy_IRVE_kWh_Annual (la ligne "Consommation IRVE" du bilan ci-dessus).
        const dt = pasTempsMin / 60;
        const asBuiltIrveKwh = fullYearIrve.reduce((sum, v) => sum + v, 0) * dt;
        if (asBuiltIrveKwh > 0) {
            const scaleFactor = totalEnergy_IRVE_kWh_Annual / asBuiltIrveKwh;
            for (let i = 0; i < fullYearIrve.length; i++) {
                const scaledIrve = fullYearIrve[i] * scaleFactor;
                fullYearTotal[i] = fullYearExisting[i] + scaledIrve;
                fullYearIrve[i] = scaledIrve;
            }
        }

        // Courbe annuelle IRVE (kW, heure murale, pas natif, total = bilan) mise à disposition de
        // l'analyse horosaisonnière et de la section Rentabilité IRVE (Irve/rentabilite_irve/).
        window.irveCourbeAnnuelle = {
            annee: simulationYear, pasTempsMin, irve: fullYearIrve.slice(), existing: fullYearExisting.slice(),
            totalKwh: totalEnergy_IRVE_kWh_Annual, puissanceIRVE_DPM: simulationResults[pasTempsMin].puissanceIRVE_DPM,
        };

        if (!projetId) {
            irveSyncOk = false;
            irveSyncErrorDetail = "aucun projet identifié (current_projet_id manquant)";
        } else {
            // CORRECTIF (point 1) : sauvegarde désormais ATTENDUE (await) et son résultat vérifié —
            // auparavant "tirée et oubliée" (fetch sans await ni vérification du statut HTTP), un
            // échec côté serveur (droits d'accès, erreur 500...) passait totalement inaperçu : la
            // courbe ne parvenait jamais à l'autoconsommation, sans le moindre message à l'écran.
            try {
                const response = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/irve/save-curve`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pas_temps_min: pasTempsMin,
                        existing: fullYearExisting,
                        irve: fullYearIrve,
                        total: fullYearTotal,
                        has_existing: hasExisting,
                        // Année du calendrier ci-dessus : le serveur cale cette courbe (heure murale)
                        // en UTC+1 fixe avec les dates de changement d'heure de cette année.
                        annee: simulationYear,
                        // Consommation IRVE du bilan énergétique : le serveur refuse une courbe dont
                        // la somme en diffère, et bloque tout calcul d'autoconsommation incohérent.
                        bilan_irve_kwh: totalEnergy_IRVE_kWh_Annual
                    })
                });
                const res = await response.json();
                irveSyncOk = response.ok && res.success;
                if (!irveSyncOk) irveSyncErrorDetail = res.message || `HTTP ${response.status}`;
            } catch (e) {
                irveSyncOk = false;
                irveSyncErrorDetail = e.message || 'erreur réseau';
                console.error("Erreur lors de l'enregistrement de la courbe IRVE:", e);
            }
        }
    } else if (projetId) {
        // Pas de consommation IRVE simulée : invalide la courbe déjà sauvegardée en base pour ce
        // projet, pour éviter qu'une ancienne courbe (bornes retirées depuis) reste utilisable côté ACI.
        try {
            await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/irve/save-curve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pas_temps_min: pasTempsMin, existing: [], irve: [], total: [], has_existing: false })
            });
        } catch (e) {
            console.error("Erreur lors de l'invalidation de la courbe IRVE:", e);
        }
    }

    // CORRECTIF (point 1) : icône/message explicite sur l'écran indiquant si la courbe IRVE a bien
    // été transmise à l'autoconsommation individuelle — l'utilisateur n'avait auparavant aucun moyen
    // de savoir si la synchronisation avait réussi avant de basculer vers le module autoconsommation.
    // Courbe annuelle enregistrée (ou refusée) en base : la section Rentabilité IRVE relit ses données
    // par le serveur (cf. Irve/rentabilite_irve/rentabilite_irve_section.js).
    if (window.irveCourbeAnnuelle) {
        window.irveCourbeAnnuelle.enregistree = irveSyncOk === true;
        document.dispatchEvent(new CustomEvent('irveCourbeAnnuelleCalculee', { detail: { enregistree: irveSyncOk === true } }));
    }

    const statusEl = document.getElementById('irve-aci-sync-status');
    if (statusEl) {
        if (irveSyncOk === true) {
            statusEl.textContent = '✅ Courbe transmise à l\'autoconsommation individuelle';
            statusEl.style.color = 'var(--success-color, #16a34a)';
        } else if (irveSyncOk === false) {
            statusEl.textContent = `❌ Échec de la synchronisation avec l'autoconsommation (${irveSyncErrorDetail})`;
            statusEl.style.color = 'var(--danger-color, #dc2626)';
        } else {
            statusEl.textContent = '';
        }
    }

    if (irveSyncOk === false) {
        showMessage(`Calcul d'énergie terminé, mais la synchronisation avec l'autoconsommation a échoué (${irveSyncErrorDetail}).`, 'error', 5000, button);
    } else if (irveSyncOk === true) {
        showMessage(`Calcul d'énergie simulé pour ${pasTempsMin} min : courbe transmise à l'autoconsommation ✅`, 'info', 3000, button);
    } else {
        showMessage(`Calcul d'énergie simulé pour ${pasTempsMin} min et graphiques mis à jour.`, 'info', 3000, button);
    }
}

function aggregateImportedData(dataPoints, targetPasTempsMin) {
    const aggregated = Array(24).fill(0).map(() => ({ sum: 0, count: 0 }));

    dataPoints.forEach(point => {
        const date = new Date(point.time);
        const hour = date.getHours();

        if (hour >= 0 && hour < 24) {
            aggregated[hour].sum += point.kva;
            aggregated[hour].count += 1;
        }
    });

    const hourlyAverage = aggregated.map(h => h.count > 0 ? h.sum / h.count : 0);

    return hourlyAverage;
}

// --- LOGIQUE ESTIMATION TEMPS DE RECHARGE ---
const RDT_AC_DEFAULT = 0.90; // 90%
const RDT_DC_DEFAULT = 0.95; // 95%

function formatTime(totalHours) {
    const hours = Math.floor(totalHours);
    const minutes = Math.round((totalHours - hours) * 60);
    return `${hours}h ${minutes}m`;
}

function showEstimationRechargeModal(groupKey = null) {
    document.getElementById('recharge-modal-overlay').style.display = 'block';

    const borneSelect = document.getElementById('est_borne_select');
    borneSelect.innerHTML = '<option value="">Sélectionnez une borne</option>';

    const rdAcInput = document.getElementById('rendement_borne_ac');
    const rdDcInput = document.getElementById('rendement_borne_dc');
    const rdtAC = rdAcInput ? parseFloat(rdAcInput.value) : RDT_AC_DEFAULT;
    const rdtDC = rdDcInput ? parseFloat(rdDcInput.value) : RDT_DC_DEFAULT;

    document.getElementById('est_rdt_ac_display').textContent = `${(rdtAC * 100).toFixed(0)}%`;
    document.getElementById('est_rdt_dc_display').textContent = `${(rdtDC * 100).toFixed(0)}%`;

    let selectedId = null;
    if (groupKey) {
        selectedId = parseInt(groupKey.split('_')[1]);
    }

    irveData.forEach(data => {
        const optionText = `IRVE ${data.id} - ${data.puissance.toFixed(1)}kW (P Act.: ${data.Pact.toFixed(2)}kW)`;
        const isSelected = data.id === selectedId ? 'selected' : '';
        borneSelect.innerHTML += `<option value="${data.id}" data-pact="${data.Pact}" data-type="${data.type}" ${isSelected}>${optionText}</option>`;
    });

    calculateRechargeTime();
}

function calculateRechargeTime() {
    const CapBatterie = parseFloat(document.getElementById('est_capacite_batterie').value) || 0;
    const SoC_init = parseFloat(document.getElementById('est_soc_init').value) / 100 || 0;
    const SoC_fin = parseFloat(document.getElementById('est_soc_fin').value) / 100 || 0;

    const borneSelect = document.getElementById('est_borne_select');
    const selectedOption = borneSelect.options[borneSelect.selectedIndex];

    const P_act = parseFloat(selectedOption?.getAttribute('data-pact')) || 0;
    const Type = selectedOption?.getAttribute('data-type');

    const rdAcInput = document.getElementById('rendement_borne_ac');
    const rdDcInput = document.getElementById('rendement_borne_dc');
    const rdtAC = rdAcInput ? parseFloat(rdAcInput.value) : RDT_AC_DEFAULT;
    const rdtDC = rdDcInput ? parseFloat(rdDcInput.value) : RDT_DC_DEFAULT;

    const CapRecharge = Math.max(0, CapBatterie * (SoC_fin - SoC_init));

    let TimeTotal = 0;
    let EnergyTotal = 0;
    let PuissanceUtiliseeDisplay = P_act.toFixed(2) + ' kW';

    if (CapRecharge <= 0 || P_act <= 0) {
        TimeTotal = 0;
        EnergyTotal = 0;
        PuissanceUtiliseeDisplay = '0.00 kW';
    } else if (Type === 'AC') {
        EnergyTotal = CapRecharge / rdtAC;
        TimeTotal = EnergyTotal / P_act;
    } else {
        const SoC_80 = 0.8;
        let Time_Stage1 = 0, Time_Stage2 = 0;
        let Energy_Stage1 = 0, Energy_Stage2 = 0;
        const P_Stage1 = 0.80 * P_act;
        const P_Stage2 = 0.25 * P_act;

        if (SoC_init < SoC_80) {
            const Target_SoC1 = Math.min(SoC_fin, SoC_80);
            const Cap_Stage1 = CapBatterie * (Target_SoC1 - SoC_init);
            Energy_Stage1 = Cap_Stage1 / rdtDC;
            Time_Stage1 = Energy_Stage1 / P_Stage1;
        }

        if (SoC_fin > SoC_80) {
            const Start_SoC2 = Math.max(SoC_init, SoC_80);
            const Cap_Stage2 = CapBatterie * (SoC_fin - Start_SoC2);
            Energy_Stage2 = Cap_Stage2 / rdtDC;
            Time_Stage2 = Energy_Stage2 / P_Stage2;
            PuissanceUtiliseeDisplay = `${P_Stage1.toFixed(2)} kW (Stage 1), ${P_Stage2.toFixed(2)} kW (Stage 2)`;
        } else {
            PuissanceUtiliseeDisplay = P_Stage1.toFixed(2) + ' kW';
        }
        TimeTotal = Time_Stage1 + Time_Stage2;
        EnergyTotal = Energy_Stage1 + Energy_Stage2;
    }

    document.getElementById('res-recharge-capacity').textContent = CapRecharge.toFixed(2) + ' kWh';
    document.getElementById('res-charge-power').textContent = PuissanceUtiliseeDisplay;
    document.getElementById('res-borne-energy').textContent = EnergyTotal.toFixed(2) + ' kWh';
    document.getElementById('res-recharge-time').textContent = formatTime(TimeTotal);
}

// --- LOGIQUE EXPORT / IMPORT ---
// CORRECTIF (cohérence bilan / autoconsommation) : les exports reprennent la courbe annuelle du
// bilan énergétique (window.irveCourbeAnnuelle : kW réellement consommés, jours inactifs à zéro,
// 365 jours, somme = « Consommation IRVE » du bilan) au lieu du profil horaire moyen en kVA répété
// 365 jours — dont la somme différait du bilan (ex. 238 925 kWh contre 92 048 kWh). Valeurs en
// pleine précision : réimporté dans l'autoconsommation, le fichier passe le contrôle de cohérence
// (somme de la colonne IRVE = bilan, cf. app/services/irve_controle.py).

/** Rééchantillonne une série de puissances (kW) d'un pas à un autre en conservant l'énergie. */
function reechantillonnerPuissances(valeurs, pasSource, pasCible) {
    if (pasSource === pasCible) return valeurs.slice();
    const base = 5; // tous les pas supportés (10/15/30/60 min) sont multiples de 5 min
    const fin = [];
    const rep = pasSource / base;
    valeurs.forEach(v => { for (let k = 0; k < rep; k++) fin.push(v); });
    const groupe = pasCible / base;
    const sortie = [];
    for (let i = 0; i + groupe <= fin.length; i += groupe) {
        let s = 0;
        for (let k = 0; k < groupe; k++) s += fin[i + k];
        sortie.push(s / groupe);
    }
    return sortie;
}

/** Libellés de date (heure murale) des 365 jours de la courbe annuelle (29 février exclu). */
function datesCourbeAnnuelle(annee, pasMin, n) {
    const pad = (x) => x.toString().padStart(2, '0');
    const parJour = 24 * 60 / pasMin;
    const jours = [];
    for (let d = 0; jours.length < 365; d++) {
        const date = new Date(Date.UTC(annee, 0, 1 + d));
        if (date.getUTCMonth() === 1 && date.getUTCDate() === 29) continue;
        jours.push(date);
    }
    const libelles = [];
    for (let i = 0; i < n; i++) {
        const jour = jours[Math.floor(i / parJour)];
        const minutes = (i % parJour) * pasMin;
        libelles.push(`${pad(jour.getUTCDate())}.${pad(jour.getUTCMonth() + 1)}.${jour.getUTCFullYear()} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
    }
    return libelles;
}

function courbeAnnuellePourExport(button) {
    const courbe = window.irveCourbeAnnuelle;
    if (!courbe || !Array.isArray(courbe.irve) || !courbe.irve.length) {
        showMessage("Lancez d'abord « calculer la consommation » : l'export reprend la courbe du bilan énergétique.", 'error', 4000, button);
        return null;
    }
    return courbe;
}

function exportEnergyData(pasTemps, button) {
    const courbe = courbeAnnuellePourExport(button);
    if (!courbe) return;
    const irve = reechantillonnerPuissances(courbe.irve, courbe.pasTempsMin, pasTemps);
    const dates = datesCourbeAnnuelle(courbe.annee, pasTemps, irve.length);

    const ws_data = [
        ["Rapport de Consommation Annuelle Détaillée IRVE (Simulé)"],
        ["Année de simulation:", courbe.annee, "Pas de temps:", `${pasTemps} minutes`],
        ["Consommation IRVE annuelle (bilan énergétique, kWh):", courbe.totalKwh, "Puissance Max IRVE (DPM appliqué) (kVA):", courbe.puissanceIRVE_DPM || 0],
        ["Date", "Puissance IRVE consommée (kW)"]
    ];
    irve.forEach((v, i) => ws_data.push([dates[i], v]));

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Conso_IRVE_${pasTemps}min`);
    XLSX.writeFile(wb, `Consommation_IRVE_Detail_${pasTemps}min.xlsx`);

    showMessage(`Export Excel détaillé IRVE pour ${pasTemps} minutes généré (${irve.length} points).`, 'info', 3000, button);
}

function exportTotalConsumption(button) {
    const courbe = courbeAnnuellePourExport(button);
    if (!courbe) return;
    const irve = reechantillonnerPuissances(courbe.irve, courbe.pasTempsMin, 60);
    const existant = reechantillonnerPuissances(courbe.existing || [], courbe.pasTempsMin, 60);
    const dates = datesCourbeAnnuelle(courbe.annee, 60, irve.length);

    // Colonnes B, C, D = existant, IRVE, total : format d'import de l'autoconsommation (3 courbes).
    const ws_data = [
        ["Rapport de Consommation Annuelle Détaillée (60 min)"],
        ["Année de simulation:", courbe.annee, "Pas de temps:", "60 minutes"],
        ["Consommation IRVE annuelle (bilan énergétique, kWh):", courbe.totalKwh, "Puissance Max IRVE (DPM appliqué) (kVA):", courbe.puissanceIRVE_DPM || 0],
        ["Date", "Conso. Existant (kW)", "Conso. IRVE (kW)", "Conso. Totale (kW)"]
    ];
    irve.forEach((v, i) => {
        const e = existant[i] || 0;
        ws_data.push([dates[i], e, v, e + v]);
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Conso_Totale_Site_60min`);
    XLSX.writeFile(wb, `Consommation_IRVE_Totale_Site.xlsx`);

    showMessage(`Export Excel total généré (${irve.length} points).`, 'info', 3000, button);
}

function exportPDF(button) {
    showMessage("Fonction d'export PDF non implémentée dans cette version.", 'error', 3000, button);
}

// --- Fonctions utilitaires ---
function isLeapYear(year) { return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0); }
function formatDateTime(date) {
    const pad = (num) => num.toString().padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    return `${day}.${month}.${year} ${hour}:${minute}`;
}

// Fonction pour générer le tableau saisonnier dynamiquement
function initSeasonalTable() {
    const tableHeader = document.getElementById('seasonal-table-header');
    const tableBody = document.getElementById('seasonal-table-body');

    let headerHTML = '<tr><th style="width: 80px; background-color: #6b7280; color: white; border-top-left-radius: 6px;">Saison</th>';
    for (let h = 0; h < 24; h++) {
        headerHTML += `<th style="width: 3.8%; font-size: 0.7rem; padding: 0.2rem; background-color: #6b7280; color: white;">${h}h</th>`;
    }
    headerHTML += '<th style="width: 20px; background-color: #6b7280; color: white; border-top-right-radius: 6px; padding: 0.2rem;"></th></tr>';
    tableHeader.innerHTML = headerHTML;

    const seasons = ['Hiver', 'Printemps', 'Été', 'Automne'];
    let bodyHTML = '';
    seasons.forEach(season => {
        bodyHTML += `<tr data-season="${season}" class="season-data-row">`;
        bodyHTML += `<td style="background-color: #f3f4f6; font-weight: 600; text-align: left; padding-left: 0.5rem; border-right: 2px solid #ccc;">${season}</td>`;

        for (let h = 0; h < 24; h++) {
            // Réutilise la valeur déjà restaurée par IrveStorageManager.js (window.seasonalHourlyData)
            // au lieu de toujours repartir de 0 : cette fonction est appelée sur window.onload, donc
            // après la restauration (sur DOMContentLoaded), et écrasait silencieusement la courbe de
            // charge saisie/restaurée à chaque rechargement de page.
            const existingValue = (seasonalHourlyData[season] && seasonalHourlyData[season][h] !== undefined) ? seasonalHourlyData[season][h] : 0;
            bodyHTML += `<td style="padding: 0; border: 1px solid #f0f0f0;">
                        <input type="number" data-hour="${h}" data-season="${season}" class="modern-input" value="${existingValue}" step="1" min="0" max="50"
                            style="width: 100%; height: 100%; padding: 4px 2px; text-align: center; border: none; background: transparent; font-size: 0.8rem; border-radius: 0;"
                            onchange="updateSeasonalData('${season}', ${h}, parseFloat(this.value))">
                    </td>`;
        }

        bodyHTML += `<td style="padding: 0; border: none; text-align: center; vertical-align: middle;">
                    <button class="btn-danger" style="padding: 0.2rem 0.4rem; font-size: 0.7rem;" onclick="clearSeasonalData('${season}', this)">X</button>
                </td></tr>`;
    });
    tableBody.innerHTML = bodyHTML;
}

// --- Initialisation ---
// Lancée après TOUS les gestionnaires DOMContentLoaded de la page (setTimeout 0 dans le premier
// d'entre eux), soit dans le même ordre qu'avec window.onload, mais sans attendre la fin du
// chargement des polices et autres ressources : la modale s'affiche plus tôt.
function initialiserModaleIrve() {
    document.getElementById('app-modal').style.display = 'none';
    // CORRECTIF (demande explicite : "l'utilisateur doit cliquer sur le bouton ajouter pour faire
    // apparaître la première borne") : une borne par défaut était auto-ajoutée au premier chargement
    // (tant qu'IrveStorageManager.js n'avait rien restauré) — le tableau doit désormais rester
    // vide tant qu'aucune borne n'a été explicitement ajoutée via "➕ ajouter une borne".

    initSeasonalTable();

    updateTimeSlider();
    updateDPMDisplay();
    updateRaccordementMode();
    calculateAverageExistingData();

    const gestionPuissanceInput = document.querySelector('input[name="gestion_puissance"]');
    if (gestionPuissanceInput) gestionPuissanceInput.addEventListener('change', updateDPMDisplay);

    const modeRaccordementInput = document.querySelector('input[name="mode_raccordement"]');
    if (modeRaccordementInput) modeRaccordementInput.addEventListener('change', updateRaccordementMode);

    ['est_capacite_batterie', 'est_soc_init', 'est_soc_fin', 'est_borne_select'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', calculateRechargeTime);
            el.addEventListener('input', calculateRechargeTime);
        }
    });

    switchTab('materiels');

    // CORRECTIF (cf. commentaire détaillé plus haut, bloc `if (isEmbeddedMode)`) : ouverture du
    // modal déplacée ici (fin de window.onload, après le display:none forcé ci-dessus et toute
    // l'initialisation) au lieu d'un setTimeout(100ms) indépendant — garantit que le modal
    // s'affiche APRÈS ce display:none, quelle que soit la vitesse de chargement des scripts
    // CDN/polices, au lieu de dépendre d'une course entre les deux.
    if (isEmbeddedMode) openModal();
    document.dispatchEvent(new CustomEvent('irveModaleInitialisee'));
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initialiserModaleIrve, 0));
} else {
    setTimeout(initialiserModaleIrve, 0);
}
