// =========================================================================
// MODULE ANALYSE ÉCO-IRVE (RENTABILITÉ VÉHICULE ÉLECTRIQUE VS THERMIQUE)
// =========================================================================

window.currentBatteryGroupKey = null; // Utilisé pour savoir quel groupe est édité

// Base de données enrichie des véhicules avec données réelles par parcours
window.EV_MODELS = {
    e208: { cap: 50, conso: { mixte: 15.5, ville: 14.0, autoroute: 21.0 }, defaultType: "mixte" },
    zoe: { cap: 52, conso: { mixte: 16.0, ville: 14.5, autoroute: 22.0 }, defaultType: "mixte" },
    model3: { cap: 60, conso: { mixte: 14.4, ville: 12.0, autoroute: 17.5 }, defaultType: "mixte" },
    modely: { cap: 75, conso: { mixte: 16.9, ville: 14.5, autoroute: 20.5 }, defaultType: "mixte" },
    megane: { cap: 60, conso: { mixte: 16.1, ville: 14.0, autoroute: 21.5 }, defaultType: "mixte" },
    spring: { cap: 26.8, conso: { mixte: 13.9, ville: 10.4, autoroute: 19.0 }, defaultType: "ville" },
    kangoo: { cap: 45, conso: { mixte: 17.3, ville: 19.9, autoroute: 23.9 }, defaultType: "mixte" }
};
window.previousParcours = 'mixte'; // Permet de suivre le changement de parcours

// Base de données des profils d'autonomie (en km) par température pour l'interpolation
window.EV_AUTONOMY_PROFILES = {
    kangoo: { // Constructeur Renault Kangoo
        cap: 45,
        ville:     [{t:-10, km:190}, {t:0, km:220}, {t:10, km:280}, {t:20, km:335}, {t:25, km:275}, {t:30, km:260}, {t:35, km:240}, {t:40, km:220}],
        mixte:     [{t:-10, km:170}, {t:0, km:200}, {t:10, km:260}, {t:20, km:315}, {t:25, km:310}, {t:30, km:310}, {t:35, km:310}, {t:40, km:300}],
        autoroute: [{t:-10, km:120}, {t:0, km:150}, {t:10, km:200}, {t:20, km:240}, {t:25, km:210}, {t:30, km:210}, {t:35, km:210}, {t:40, km:200}]
    },
    e208: { // Estimations
        cap: 50,
        ville:     [{t:-10, km:210}, {t:0, km:280}, {t:10, km:340}, {t:20, km:400}, {t:30, km:360}, {t:40, km:330}],
        mixte:     [{t:-10, km:170}, {t:0, km:220}, {t:10, km:270}, {t:20, km:320}, {t:30, km:290}, {t:40, km:270}],
        autoroute: [{t:-10, km:120}, {t:0, km:160}, {t:10, km:200}, {t:20, km:240}, {t:30, km:220}, {t:40, km:200}]
    },
    zoe: { // Estimations
        cap: 52,
        ville:     [{t:-10, km:200}, {t:0, km:260}, {t:10, km:340}, {t:20, km:420}, {t:30, km:380}, {t:40, km:350}],
        mixte:     [{t:-10, km:180}, {t:0, km:230}, {t:10, km:290}, {t:20, km:340}, {t:30, km:310}, {t:40, km:280}],
        autoroute: [{t:-10, km:130}, {t:0, km:170}, {t:10, km:210}, {t:20, km:250}, {t:30, km:230}, {t:40, km:210}]
    },
    model3: { // Estimations
        cap: 60,
        ville:     [{t:-10, km:300}, {t:0, km:380}, {t:10, km:460}, {t:20, km:550}, {t:30, km:500}, {t:40, km:470}],
        mixte:     [{t:-10, km:260}, {t:0, km:320}, {t:10, km:380}, {t:20, km:430}, {t:30, km:400}, {t:40, km:380}],
        autoroute: [{t:-10, km:200}, {t:0, km:250}, {t:10, km:300}, {t:20, km:340}, {t:30, km:320}, {t:40, km:300}]
    },
    modely: { // Estimations
        cap: 75,
        ville:     [{t:-10, km:320}, {t:0, km:410}, {t:10, km:500}, {t:20, km:580}, {t:30, km:530}, {t:40, km:500}],
        mixte:     [{t:-10, km:270}, {t:0, km:340}, {t:10, km:400}, {t:20, km:450}, {t:30, km:420}, {t:40, km:400}],
        autoroute: [{t:-10, km:210}, {t:0, km:270}, {t:10, km:320}, {t:20, km:360}, {t:30, km:340}, {t:40, km:320}]
    },
    megane: { // Estimations
        cap: 60,
        ville:     [{t:-10, km:240}, {t:0, km:320}, {t:10, km:400}, {t:20, km:480}, {t:30, km:440}, {t:40, km:410}],
        mixte:     [{t:-10, km:210}, {t:0, km:280}, {t:10, km:340}, {t:20, km:400}, {t:30, km:360}, {t:40, km:340}],
        autoroute: [{t:-10, km:160}, {t:0, km:210}, {t:10, km:260}, {t:20, km:300}, {t:30, km:280}, {t:40, km:260}]
    },
    spring: { // Estimations
        cap: 26.8,
        ville:     [{t:-10, km:120}, {t:0, km:170}, {t:10, km:210}, {t:20, km:250}, {t:30, km:220}, {t:40, km:200}],
        mixte:     [{t:-10, km:90}, {t:0, km:120}, {t:10, km:160}, {t:20, km:190}, {t:30, km:170}, {t:40, km:150}],
        autoroute: [{t:-10, km:60}, {t:0, km:80}, {t:10, km:110}, {t:20, km:130}, {t:30, km:120}, {t:40, km:110}]
    },
    custom: { // Profil Générique
        cap: 50,
        ville:     [{t:-10, km:210}, {t:0, km:270}, {t:10, km:330}, {t:20, km:380}, {t:30, km:340}, {t:40, km:310}],
        mixte:     [{t:-10, km:160}, {t:0, km:210}, {t:10, km:260}, {t:20, km:300}, {t:30, km:270}, {t:40, km:250}],
        autoroute: [{t:-10, km:110}, {t:0, km:150}, {t:10, km:190}, {t:20, km:220}, {t:30, km:200}, {t:40, km:180}]
    }
};

// Logique mathématique de l'interpolation (Aucune régression polynomiale)
window.interpolateKm = function(profile, temp) {
    if (!profile || profile.length === 0) return 250;
    let sorted = [...profile].sort((a, b) => a.t - b.t);
    if (temp <= sorted[0].t) return sorted[0].km;
    if (temp >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].km;
    let lower = sorted[0], upper = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length; i++) { if (sorted[i].t <= temp) lower = sorted[i]; if (sorted[i].t > temp) { upper = sorted[i]; break; } }
    const tempFraction = (temp - lower.t) / (upper.t - lower.t);
    return lower.km + ((upper.km - lower.km) * tempFraction);
};

// Calcul du facteur de correction : Ratio entre l'autonomie à T° actuelle et celle à 20°C
window.getAutonomyRatio = function(modelKey, parcours, temp) {
    let profileData = window.EV_AUTONOMY_PROFILES[modelKey] || window.EV_AUTONOMY_PROFILES['custom'];
    let profile = profileData[parcours] || profileData['mixte'];
    let kmTemp = window.interpolateKm(profile, temp);
    let km20 = window.interpolateKm(profile, 20); // 20°C est la référence absolue saisie par l'utilisateur
    if (km20 === 0) return 1;
    return kmTemp / km20;
};

/**
 * Calcule l'énergie requise pour un trajet en fonction du véhicule, du parcours et de la température extérieure.
 * Cette fonction utilise une interpolation linéaire stricte et plafonne l'autonomie aux extrêmes de température (Courbe en U).
 * 
 * @param {string} vehiculeId - L'identifiant du modèle de véhicule (ex: 'kangoo', 'e208').
 * @param {string} typeTransport - Le type de parcours ('ville', 'mixte', 'autoroute').
 * @param {number} distanceKm - La distance du trajet à parcourir en kilomètres.
 * @param {number} temperatureC - La température extérieure en degrés Celsius.
 * @returns {number} L'énergie totale requise pour le trajet (en kWh).
 */
window.calculerEnergieTrajet = function(vehiculeId, typeTransport, distanceKm, temperatureC) {
    // 1. Récupération des données du véhicule ou fallback sur le profil générique
    const vehiculeData = window.EV_AUTONOMY_PROFILES[vehiculeId] || window.EV_AUTONOMY_PROFILES['custom'];
    const profilAutonomie = vehiculeData[typeTransport] || vehiculeData['mixte'];
    const capaciteBatterie = vehiculeData.cap || 50; // Capacité en kWh
    
    // 2. Interpolation linéaire avec plafonnement (bridage strict sur les bornes min/max du tableau, pas d'extrapolation)
    const autonomieReelle = window.interpolateKm(profilAutonomie, temperatureC);
    
    if (autonomieReelle <= 0) return 0; // Sécurité division par zéro

    // 3. Calcul de la consommation physique et conversion de la distance en énergie requise
    const consommationAux100km = (capaciteBatterie / autonomieReelle) * 100;
    return distanceKm * (consommationAux100km / 100);
};

window.setCustomEVPreset = function() {
    const presetEl = document.getElementById('eco_ev_preset');
    if (presetEl && presetEl.value !== 'custom') presetEl.value = 'custom';
};

window.onParcoursChange = function() {
    const val = document.getElementById('eco_ev_preset')?.value;
    const newParcours = document.getElementById('eco_parcours')?.value || 'mixte';
    const consoInput = document.getElementById('eco_conso_ev');
    
    if (val !== 'custom' && window.EV_MODELS[val]) {
        // Remplir dynamiquement avec les vraies données constructeur pour ce parcours
        if (consoInput) consoInput.value = window.EV_MODELS[val].conso[newParcours];
    } else if (consoInput) {
        // Si valeur personnalisée, on applique l'ajustement théorique existant pour aider l'utilisateur
        let currentVal = parseFloat(consoInput.value) || 17;
        let baseVal = window.previousParcours === 'ville' ? currentVal / 0.85 : (window.previousParcours === 'autoroute' ? currentVal / 1.30 : currentVal);
        let newVal = newParcours === 'ville' ? baseVal * 0.85 : (newParcours === 'autoroute' ? baseVal * 1.30 : baseVal);
        consoInput.value = newVal.toFixed(1);
    }
    
    window.previousParcours = newParcours;
    window.calculateBatteryDetail();
};

/**
 * Initialise l'interface utilisateur du simulateur de rentabilité 
 * en l'injectant dynamiquement dans le modal existant.
 */
function initEcoSimulatorUI() {
    const modalContent = document.getElementById('batterie-detail-modal-content');
    if (!modalContent) return;
    
    // Sécurité anti-boucle d'initialisation
    if (document.getElementById('eco-simulator-section-v2')) return;

    // Restructuration et agrandissement du modal pour une meilleure lisibilité
    modalContent.style.maxWidth = "950px";
    modalContent.style.width = "95%";
    modalContent.style.maxHeight = "95vh";
    modalContent.style.overflowY = "auto";
    modalContent.style.padding = "20px";

    modalContent.innerHTML = `
        <div id="eco-simulator-section-v2">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid var(--accent-primary); padding-bottom:10px; margin-bottom: 15px;">
                <h3 style="margin:0; color:var(--text-primary);">Configuration Batterie & Éco : <span id="batterie-modal-group-name" style="color:var(--accent-primary);"></span></h3>
                <button class="btn-base btn-secondary" onclick="window.exportEcoPDF()" style="margin-left: auto; margin-right: 15px; font-size:0.85rem; padding: 0.3rem 0.6rem;">📄 Exporter PDF</button>
                <!-- Le bouton fermer déclenche aussi la mise à jour du tableau en arrière plan -->
                <button class="btn-danger" onclick="document.getElementById('batterie-detail-modal-overlay').style.display='none'; if(typeof window.updatePlanningDetailTable === 'function') window.updatePlanningDetailTable();" style="font-size:1.2rem; padding: 0.2rem 0.6rem; line-height: 1;">&times;</button>
            </div>
            
            <div style="margin-bottom: 15px; background: var(--bg-panel); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); display:flex; align-items:center;">
                <label style="font-weight:600;">Modèle de véhicule prédéfini :</label>
                <!-- Seules les valeurs personnalisées sont proposées : les modèles prédéfinis restent listés mais non sélectionnables. -->
                <select id="eco_ev_preset" class="modern-input" style="flex:1; max-width: 400px; margin-left: 10px;" onchange="window.applyEVPreset()">
                    <option value="custom">-- Valeurs Personnalisées --</option>
                    <option value="e208" disabled>Peugeot e-208 (50 kWh)</option>
                    <option value="zoe" disabled>Renault Zoé (52 kWh)</option>
                    <option value="model3" disabled>Tesla Model 3 Propulsion (60 kWh)</option>
                    <option value="modely" disabled>Tesla Model Y Grande Autonomie (75 kWh)</option>
                    <option value="megane" disabled>Renault Mégane E-Tech (60 kWh)</option>
                    <option value="spring" disabled>Dacia Spring (26.8 kWh)</option>
                    <option value="kangoo" disabled>Renault Kangoo E-Tech (45 kWh)</option>
                </select>
            </div>

            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 15px; font-size: 0.9rem;">
                <!-- 1. Configuration Batterie EV -->
                <div style="background: var(--bg-panel); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                    <h5 style="margin:0 0 10px 0; text-align:center; color:var(--accent-primary);">1. Batterie & Recharge</h5>
                    <div class="input-group">
                        <label>Capacité Batterie (kWh)</label>
                        <input type="number" id="det_capacite_batterie" class="modern-input" value="50" oninput="window.setCustomEVPreset(); window.calculateBatteryDetail()">
                    </div>
                    <div style="display:flex; gap: 10px;">
                        <div class="input-group" style="flex:1;">
                            <label>SoC Initial (%)</label>
                            <input type="number" id="det_soc_init" class="modern-input" value="10" oninput="window.calculateBatteryDetail()">
                        </div>
                        <div class="input-group" style="flex:1;">
                            <label>SoC Final (%)</label>
                            <input type="number" id="det_soc_fin" class="modern-input" value="100" oninput="window.calculateBatteryDetail()">
                        </div>
                    </div>
                </div>

                <!-- 2. Trajet & Énergie EV -->
                <div style="background: var(--bg-panel); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                    <h5 style="margin:0 0 10px 0; text-align:center; color:var(--accent-primary);">2. Usage & Paramètres EV</h5>
                    <div style="display:flex; gap: 10px;">
                        <div class="input-group" style="flex:1;">
                            <label>Dist. journalière (km)</label>
                            <input type="number" id="eco_dist_jour" value="50" min="1" class="modern-input" oninput="window.calculateBatteryDetail()">
                        </div>
                        <div class="input-group" style="flex:1;">
                            <label>Type de parcours</label>
                            <select id="eco_parcours" class="modern-input" onchange="window.onParcoursChange()">
                                <option value="mixte">Mixte</option>
                                <option value="ville">Ville (Urbain)</option>
                                <option value="autoroute">Autoroute</option>
                            </select>
                        </div>
                    </div>
                    <div style="display:flex; gap: 10px;">
                        <div class="input-group" style="flex:1;">
                            <label title="Consommation de référence à 20°C">Conso. 20°C (kWh/100km)</label>
                            <input type="number" id="eco_conso_ev" value="17" step="0.1" min="5" class="modern-input" oninput="window.setCustomEVPreset(); window.calculateBatteryDetail()">
                        </div>
                        <div class="input-group" style="flex:1;">
                            <label title="Autonomie estimée selon la température et le parcours">Autonomie (km)</label>
                            <input type="text" id="eco_autonomie_ev" value="-" class="modern-input" style="background-color: #f3f4f6; cursor: default;" readonly>
                        </div>
                    </div>
                    <div style="display:flex; gap: 10px;">
                        <div class="input-group" style="flex:1;">
                            <label>Prix Achat EV (k€)</label>
                            <input type="number" id="eco_prix_achat_ev" value="40" step="1" min="0" class="modern-input" oninput="window.calculateBatteryDetail()">
                        </div>
                        <div class="input-group" style="flex:1;">
                            <label>Subvention (k€)</label>
                            <input type="number" id="eco_subvention_ev" value="0" step="1" min="0" class="modern-input" oninput="window.calculateBatteryDetail()">
                        </div>
                    </div>
                </div>

                <!-- 3. Comparaison Thermique -->
                <div style="background: var(--bg-panel); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                    <h5 style="margin:0 0 10px 0; text-align:center; color:var(--text-secondary);">3. Climat & Comparatif Thermique</h5>
                    <div style="display:flex; gap: 10px;">
                        <div class="input-group" style="flex:1;">
                            <label title="Influence l'efficience de la batterie EV">Temp(moy). Ext. (°C)</label>
                            <input type="number" id="eco_temp" value="20" class="modern-input" oninput="window.calculateBatteryDetail()">
                        </div>
                        <div class="input-group" style="flex:1;">
                            <label>Conso. Thermique (L/100km)</label>
                            <input type="number" id="eco_conso_th" value="6.5" step="0.1" min="2" class="modern-input" oninput="window.calculateBatteryDetail()">
                        </div>
                    </div>
                    <div style="display:flex; gap: 10px;">
                        <div class="input-group" style="flex:1;">
                            <label>Prix de l'électricité (€/kWh)</label>
                            <input type="number" id="eco_prix_elec" value="0.25" step="0.01" min="0" class="modern-input" oninput="window.calculateBatteryDetail()">
                        </div>
                        <div class="input-group" style="flex:1;">
                            <label>Prix du Carburant (€/L)</label>
                            <input type="number" id="eco_prix_carb" value="1.85" step="0.01" min="0" class="modern-input" oninput="window.calculateBatteryDetail()">
                        </div>
                    </div>
                </div>
                
                <!-- 4. Frais Entretien -->
                <div style="background: var(--bg-panel); padding: 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                    <h5 style="margin:0 0 10px 0; text-align:center; color:var(--text-secondary);">4. Entretien / Achat Thermique</h5>
                    <div style="display:flex; gap: 10px;">
                        <div class="input-group" style="flex:1;">
                            <label>Prix Achat Thermique (k€)</label>
                            <input type="number" id="eco_prix_achat_th" value="30" step="1" min="0" class="modern-input" oninput="window.calculateBatteryDetail()">
                        </div>
                    </div>
                    <div style="display:flex; gap: 10px;">
                        <div class="input-group" style="flex:1;">
                            <label>Entretien EV (€/an)</label>
                            <input type="number" id="eco_maint_ev" value="200" step="50" min="0" class="modern-input" oninput="window.calculateBatteryDetail()">
                        </div>
                        <div class="input-group" style="flex:1;">
                            <label>Entretien Thermique (€/an)</label>
                            <input type="number" id="eco_maint_th" value="500" step="50" min="0" class="modern-input" oninput="window.calculateBatteryDetail()">
                        </div>
                    </div>
                </div>
            </div>

            <!-- Section Résultats Rentabilité -->
            <div style="margin-top:15px; padding:15px; background:#f0fdf4; border: 2px solid #bbf7d0; border-radius:8px; font-size: 0.95rem;">
                <h4 style="margin:0 0 15px 0; color:var(--accent-green); border-bottom: 1px solid #bbf7d0; padding-bottom:5px;">Résultats de la Simulation</h4>
                
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
                    <!-- Infos Recharge -->
                    <div>
                        <h5 style="margin:0 0 8px 0; color:var(--text-primary);">Temps et Capacités de Recharge</h5>
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                            <span>Capacité à recharger (Cycle) :</span> <strong id="det-res-recharge-capacity">0.00 kWh</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                            <span>Énergie appelée à la borne :</span> <strong id="det-res-borne-energy">0.00 kWh</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
                            <span>Temps de recharge (Cycle complet) :</span> <strong id="det-res-recharge-time">0h 0m</strong>
                        </div>

                        <h5 style="margin:0 0 8px 0; color:var(--accent-primary);">Trajet Journalier</h5>
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                            <span>Énergie requise (Trajet jour) :</span> <strong id="res-eco-nrj-jour">0.00 kWh</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                            <span>Temps de recharge (Trajet jour) :</span> <strong id="res-eco-temps-jour">0h 0m</strong>
                        </div>
                    </div>

                    <!-- Économie Annuelle -->
                    <div>
                        <h5 style="margin:0 0 8px 0; color:var(--text-primary);">Analyse Économique (Annuelle)</h5>
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px; color:var(--text-secondary);">
                            <span>Coût Annuel (Énergie + Entretien EV) :</span> <span id="res-eco-cout-ev">0.00 €</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; margin-bottom:8px; color:var(--text-secondary);">
                            <span>Coût Annuel (Carburant + Entretien Th.) :</span> <span id="res-eco-cout-th">0.00 €</span>
                        </div>
                        <hr style="border: 1px solid #bbf7d0; margin: 8px 0;">
                        <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:1.05rem;">
                            <b style="color:var(--accent-green);">Économie Financière Annuelle :</b> 
                            <span id="res-eco-economie" style="font-weight:bold; color:var(--accent-green);">0.00 €</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; color:var(--accent-primary); font-size:1.05rem;">
                            <b>Temps de Retour sur Investissement :</b> 
                            <span id="res-eco-roi" style="font-weight:bold;">0.00 ans</span>
                        </div>
                    </div>
                </div>
                <div id="eco-verification-statut" role="status" style="font-size:0.8rem; margin-top:10px; text-align:center;"></div>
            </div>
        </div>
    `;
}

/**
 * Affiche le modal de configuration de batterie et initialise l'UI éco.
 */
window.showBatteryDetailModal = function(groupKey, button) {
    window.currentBatteryGroupKey = groupKey;
    const groupData = window.irveGroups.find(g => g.key === groupKey);

    if (!groupData) return;

    // Injection de l'interface simulateur dans le modal
    initEcoSimulatorUI();

    const irveItem = window.irveData.find(i => i.id === groupData.irveIds[0]);
    // PV_project : les bornes n'ont pas toujours de batterie de référence (champ propre à Socalts).
    const batteryData = (irveItem && irveItem.battery) || (groupData.battery) || { capacity: 50, soc_init: 10, soc_fin: 100 };

    document.getElementById('batterie-modal-group-name').textContent = groupData.name;
    
    if(document.getElementById('det_capacite_batterie')) document.getElementById('det_capacite_batterie').value = batteryData.capacity;
    if(document.getElementById('det_soc_init')) document.getElementById('det_soc_init').value = batteryData.soc_init;
    if(document.getElementById('det_soc_fin')) document.getElementById('det_soc_fin').value = batteryData.soc_fin;

    // Lancer les calculs complets (Recharge + Rentabilité)
    window.calculateBatteryDetail();

    document.getElementById('batterie-detail-modal-overlay').style.display = 'block';
};

/**
 * Calcul du modal « Configuration Batterie & Éco » à partir des valeurs EFFECTIVES du formulaire
 * (valeurs par défaut déjà appliquées). Miroir : app/models/calcul_consommation/batterie_eco_irve.py
 * (calculer_batterie_eco) — toute formule modifiée d'un côté doit l'être de l'autre.
 */
window.calculerBatterieEco = function(e) {
    const CapBatterie = e.cap_batterie;
    const SoC_init = e.soc_init_pct / 100;
    const SoC_fin = e.soc_fin_pct / 100;
    const P_act_avg = e.p_borne_kw;
    const Type = e.type;
    const Rdt_AC = e.rdt_ac;
    const Rdt_DC = e.rdt_dc;
    const CapRecharge = Math.max(0, CapBatterie * (SoC_fin - SoC_init));

    let EnergyTotal = 0, TimeTotal = 0;
    if (CapRecharge > 0 && P_act_avg > 0) {
        if (Type === 'AC') {
            EnergyTotal = CapRecharge / Rdt_AC; TimeTotal = EnergyTotal / P_act_avg;
        } else {
            const SoC_80 = 0.8;
            let Time_Stage1 = 0, Time_Stage2 = 0, Energy_Stage1 = 0, Energy_Stage2 = 0;
            const P_Stage1 = 0.80 * P_act_avg; const P_Stage2 = 0.25 * P_act_avg;
            if (SoC_init < SoC_80) {
                const Target_SoC1 = Math.min(SoC_fin, SoC_80);
                const Cap_Stage1 = CapBatterie * (Target_SoC1 - SoC_init);
                Energy_Stage1 = Cap_Stage1 / Rdt_DC; Time_Stage1 = Energy_Stage1 / P_Stage1;
            }
            if (SoC_fin > SoC_80) {
                const Start_SoC2 = Math.max(SoC_init, SoC_80);
                const Cap_Stage2 = CapBatterie * (SoC_fin - Start_SoC2);
                Energy_Stage2 = Cap_Stage2 / Rdt_DC; Time_Stage2 = Energy_Stage2 / P_Stage2;
            }
            TimeTotal = Time_Stage1 + Time_Stage2; EnergyTotal = Energy_Stage1 + Energy_Stage2;
        }
    }

    // Modificateurs Parcours (thermique)
    let thParcoursMult = 1.0;
    if (e.parcours === 'ville') { thParcoursMult = 1.20; }
    else if (e.parcours === 'autoroute') { thParcoursMult = 0.90; }

    // Ratio d'autonomie selon la température (interpolation linéaire des données réelles)
    const clampedTemp = Math.max(-10, Math.min(40, e.temp_ext));
    const ratioTemp = window.getAutonomyRatio(e.modele || 'custom', e.parcours, clampedTemp);
    // Consommation et autonomie ajustées (la consommation de base est à 20°C)
    const realConsoEv = ratioTemp > 0 ? (e.conso_ev_base / ratioTemp) : e.conso_ev_base;
    const realAutonomie = realConsoEv > 0 ? (CapBatterie / realConsoEv) * 100 : 0;

    const realConsoTh = e.conso_th_base * thParcoursMult;
    const nrjJourEv = (e.dist_jour_km / 100) * realConsoEv;
    const distAnnuelle = e.dist_jour_km * 365;

    // Temps de recharge pour le trajet journalier
    let tempsJourTotal = 0;
    if (nrjJourEv > 0 && P_act_avg > 0) {
        tempsJourTotal = Type === 'AC'
            ? (nrjJourEv / Rdt_AC) / P_act_avg
            : (nrjJourEv / Rdt_DC) / (0.80 * P_act_avg); // Approximation basée sur P_Stage1
    }
    // Calculs financiers annuels
    const totalCoutAnnuelEv = ((distAnnuelle / 100) * realConsoEv * e.prix_elec) + e.entretien_ev;
    const totalCoutAnnuelTh = ((distAnnuelle / 100) * realConsoTh * e.prix_carburant) + e.entretien_th;
    const economieAnnuelle = totalCoutAnnuelTh - totalCoutAnnuelEv;

    // Retour sur investissement
    const surcoutAchat = (e.prix_achat_ev_k * 1000 - e.subvention_ev_k * 1000) - e.prix_achat_th_k * 1000;
    let roiAns = null, roiCas;
    if (surcoutAchat > 0) {
        roiCas = economieAnnuelle > 0 ? 'annees' : 'jamais';
        if (economieAnnuelle > 0) roiAns = surcoutAchat / economieAnnuelle;
    } else if (economieAnnuelle > 0) {
        roiCas = 'immediat_econome';
    } else {
        roiCas = 'moins_cher_usage_plus_cher';
    }

    return {
        capacite_recharge_kwh: CapRecharge, energie_borne_kwh: EnergyTotal, temps_recharge_h: TimeTotal,
        conso_ev_reelle: realConsoEv, autonomie_km: realAutonomie, energie_jour_kwh: nrjJourEv, temps_jour_h: tempsJourTotal,
        cout_annuel_ev: totalCoutAnnuelEv, cout_annuel_th: totalCoutAnnuelTh, economie_annuelle: economieAnnuelle,
        surcout_achat: surcoutAchat, roi_ans: roiAns, roi_cas: roiCas,
    };
};

/** Affichage des résultats du modal Batterie & Éco (calcul du navigateur ou valeurs de référence). */
function afficherBatterieEco(r) {
    const txt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const duree = (h) => { const hh = Math.floor(h); const mm = Math.round((h - hh) * 60); return `${hh}h ${mm}m`; };
    txt('det-res-recharge-capacity', r.capacite_recharge_kwh.toFixed(2) + ' kWh');
    txt('det-res-borne-energy', r.energie_borne_kwh.toFixed(2) + ' kWh');
    txt('det-res-recharge-time', duree(r.temps_recharge_h));
    window.realConsoEvCache = r.conso_ev_reelle; // pour l'export PDF
    const autonomieEl = document.getElementById('eco_autonomie_ev');
    if (autonomieEl) autonomieEl.value = isNaN(r.autonomie_km) ? "-" : r.autonomie_km.toFixed(0) + " km";
    txt('res-eco-nrj-jour', r.energie_jour_kwh.toFixed(2) + " kWh / jour");
    txt('res-eco-temps-jour', duree(r.temps_jour_h));
    txt('res-eco-cout-ev', r.cout_annuel_ev.toFixed(0) + " € / an");
    txt('res-eco-cout-th', r.cout_annuel_th.toFixed(0) + " € / an");
    const ecoEl = document.getElementById('res-eco-economie');
    if (ecoEl) {
        ecoEl.textContent = r.economie_annuelle.toFixed(0) + " € / an";
        ecoEl.style.color = r.economie_annuelle > 0 ? "var(--accent-green)" : "var(--danger-color)";
    }
    const textesRoi = {
        annees: () => r.roi_ans.toFixed(1) + " ans",
        jamais: () => "Jamais (L'EV coûte plus cher à l'usage)",
        immediat_econome: () => "Immédiat (EV moins cher et plus économe)",
        moins_cher_usage_plus_cher: () => "EV moins cher, mais plus cher à l'usage",
    };
    txt('res-eco-roi', (textesRoi[r.roi_cas] || (() => "Immédiat"))());
}

let minuterieVerifBatterie = null;

/**
 * Calcule le temps de recharge, les énergies ET la simulation financière VE / thermique, puis
 * vérifie le calcul (valeurs de référence appliquées au-delà d'un écart de 0,01).
 */
window.calculateBatteryDetail = function() {
    if (!window.currentBatteryGroupKey) return;
    const groupData = window.irveGroups.find(g => g.key === window.currentBatteryGroupKey);
    if (!groupData) return;

    const irveItem = window.irveData.find(i => i.id === groupData.irveIds[0]);
    if (!irveItem) return;

    const val = (id, defaut) => parseFloat(document.getElementById(id)?.value) || defaut;
    // Valeur par défaut seulement si le champ est vide ou illisible : 0 est une valeur réelle.
    const valOuDefautSiVide = (id, defaut) => {
        const v = parseFloat(document.getElementById(id)?.value);
        return Number.isFinite(v) ? v : defaut;
    };
    const entrees = {
        cap_batterie: val('det_capacite_batterie', 0),
        soc_init_pct: val('det_soc_init', 0),
        soc_fin_pct: val('det_soc_fin', 0),
        p_borne_kw: Number(irveItem.puissance), // Puissance nominale physique d'un point de charge, sans le bridage Ks (correctif Socalts)
        type: irveItem.type,
        rdt_ac: val('rendement_borne_ac', 0.90),
        rdt_dc: val('rendement_borne_dc', 0.95),
        dist_jour_km: val('eco_dist_jour', 0),
        parcours: document.getElementById('eco_parcours')?.value || 'mixte',
        conso_ev_base: val('eco_conso_ev', 17),
        temp_ext: valOuDefautSiVide('eco_temp', 20), // 0 °C n'est plus lu comme 20 °C
        prix_elec: val('eco_prix_elec', 0.25),
        conso_th_base: val('eco_conso_th', 6.5),
        prix_carburant: val('eco_prix_carb', 1.85),
        prix_achat_ev_k: val('eco_prix_achat_ev', 0),
        subvention_ev_k: val('eco_subvention_ev', 0),
        prix_achat_th_k: val('eco_prix_achat_th', 0),
        entretien_ev: val('eco_maint_ev', 0),
        entretien_th: val('eco_maint_th', 0),
        modele: document.getElementById('eco_ev_preset')?.value || 'custom',
    };

    if (groupData.battery) {
        groupData.battery.capacity = entrees.cap_batterie;
        groupData.battery.soc_init = entrees.soc_init_pct;
        groupData.battery.soc_fin = entrees.soc_fin_pct;
    }

    const r = window.calculerBatterieEco(entrees);
    afficherBatterieEco(r);

    clearTimeout(minuterieVerifBatterie);
    if (!window.VerificationIrve) return;
    minuterieVerifBatterie = setTimeout(async () => {
        const verif = await window.VerificationIrve.verifier('batterie_eco', { entrees, js: r });
        if (!verif) return;
        window.VerificationIrve.afficher(document.getElementById('eco-verification-statut'), verif);
        if (!verif.conforme && !verif.indisponible) afficherBatterieEco(verif.reference);
    }, 400);
};

/**
 * Applique les présélections des véhicules pour accélérer la saisie
 */
window.applyEVPreset = function() {
    const val = document.getElementById('eco_ev_preset')?.value;
    
    if(val !== 'custom' && window.EV_MODELS && window.EV_MODELS[val]) {
        const model = window.EV_MODELS[val];
        if(document.getElementById('det_capacite_batterie')) document.getElementById('det_capacite_batterie').value = model.cap;
        
        const parcoursEl = document.getElementById('eco_parcours');
        if(parcoursEl) {
            parcoursEl.value = model.defaultType;
            window.previousParcours = model.defaultType;
        }
        
        if(document.getElementById('eco_conso_ev')) document.getElementById('eco_conso_ev').value = model.conso[model.defaultType];
    }
    window.calculateBatteryDetail();
};

/**
 * Génère un rapport PDF stylisé côté client (impression) pour la section Éco-IRVE
 */
window.exportEcoPDF = function() {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Rapport de Rentabilité Éco-IRVE</title>
            <style>
                body { font-family: 'Helvetica', 'Arial', sans-serif; color: #1f2937; margin: 30px; }
                h3 { color: #dc2626; border-bottom: 2px solid #dc2626; padding-bottom: 8px; font-size: 20px;}
                h4 { color: #1E8449; margin-top: 25px; font-size: 18px; border-bottom: 1px solid #1E8449; padding-bottom: 5px;}
                h5 { color: #dc2626; margin-bottom: 10px; font-size: 14px;}
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 10px; }
                .box { border: 1px solid #e5e7eb; padding: 15px; border-radius: 8px; background: #f8f9fa; }
                .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e5e7eb; font-size: 13px;}
                .row:last-child { border-bottom: none; }
                .val { font-weight: bold; }
                .green { color: #1E8449; }
                .footer { font-size: 10px; color: #6b7280; text-align: center; margin-top: 40px; border-top: 1px solid #e5e7eb; padding-top:10px;}
            </style>
        </head>
        <body>
            <h3>Simulation : Rentabilité Véhicule Électrique vs Thermique</h3>
            
            <div class="grid">
                <div class="box">
                    <h5>1. Batterie & Recharge</h5>
                    <div class="row"><span>Capacité Batterie:</span><span class="val">${document.getElementById('det_capacite_batterie').value} kWh</span></div>
                    <div class="row"><span>SoC Initial / Final:</span><span class="val">${document.getElementById('det_soc_init').value}% -> ${document.getElementById('det_soc_fin').value}%</span></div>
                    <div class="row"><span>Capacité à recharger:</span><span class="val">${document.getElementById('det-res-recharge-capacity').textContent}</span></div>
                    <div class="row"><span>Temps de recharge estimé:</span><span class="val">${document.getElementById('det-res-recharge-time').textContent}</span></div>
                </div>
                <div class="box">
                    <h5>2. Paramètres VE & Financiers</h5>
                    <div class="row"><span>Distance journalière:</span><span class="val">${document.getElementById('eco_dist_jour').value} km</span></div>
                    <div class="row"><span>Conso. base 20°C:</span><span class="val">${document.getElementById('eco_conso_ev').value} kWh/100km</span></div>
                    <div class="row"><span>Autonomie & Conso. réelles (${document.getElementById('eco_temp').value}°C):</span><span class="val">${document.getElementById('eco_autonomie_ev').value} - ${window.realConsoEvCache ? window.realConsoEvCache.toFixed(2) : '-'} kWh/100km</span></div>
                    <div class="row"><span>Prix Électricité:</span><span class="val">${document.getElementById('eco_prix_elec').value} €/kWh</span></div>
                    <div class="row"><span>Prix Achat VE:</span><span class="val">${document.getElementById('eco_prix_achat_ev').value} k€</span></div>
                    <div class="row"><span>Subvention Déduite:</span><span class="val">${document.getElementById('eco_subvention_ev').value} k€</span></div>
                </div>
            </div>
            
            <div class="grid">
                <div class="box">
                    <h5>3. Comparatif Thermique</h5>
                    <div class="row"><span>Conso. Thermique:</span><span class="val">${document.getElementById('eco_conso_th').value} L/100km</span></div>
                    <div class="row"><span>Prix Carburant:</span><span class="val">${document.getElementById('eco_prix_carb').value} €/L</span></div>
                    <div class="row"><span>Prix Achat Thermique:</span><span class="val">${document.getElementById('eco_prix_achat_th').value} k€</span></div>
                </div>
                <div class="box">
                    <h5>4. Entretien Annuel</h5>
                    <div class="row"><span>Entretien VE:</span><span class="val">${document.getElementById('eco_maint_ev').value} €/an</span></div>
                    <div class="row"><span>Entretien Thermique:</span><span class="val">${document.getElementById('eco_maint_th').value} €/an</span></div>
                </div>
            </div>
            
            <h4>Bilan Économique Annuel</h4>
            <div class="box" style="border: 2px solid #bbf7d0; background: #f0fdf4;">
                <div class="row"><span>Coût Annuel Usage + Entretien (VE):</span><span class="val">${document.getElementById('res-eco-cout-ev').textContent}</span></div>
                <div class="row"><span>Coût Annuel Usage + Entretien (Thermique):</span><span class="val">${document.getElementById('res-eco-cout-th').textContent}</span></div>
                <div class="row" style="margin-top:10px; border-top:1px solid #bbf7d0; padding-top:10px;">
                    <span class="green val" style="font-size:14px;">Économie Financière Annuelle:</span><span class="val green" style="font-size:14px;">${document.getElementById('res-eco-economie').textContent}</span>
                </div>
                <div class="row">
                    <span class="val" style="color:#dc2626; font-size:14px;">Retour sur Investissement (ROI):</span><span class="val" style="font-size:14px;">${document.getElementById('res-eco-roi').textContent}</span>
                </div>
            </div>
            
            <div class="footer">Généré par Solakvan</div>
            ${window.trialWatermarkPrintHtml ? window.trialWatermarkPrintHtml() : ''}
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
};