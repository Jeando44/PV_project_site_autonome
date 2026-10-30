<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HybridSim Pro | Expert PV-Genset-BESS</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js"></script>
    <style>
        :root {
            --primary: #0f172a;
            --accent: #3b82f6;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --bg: #f8fafc;
            --card: #ffffff;
        }

        body {
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            background-color: var(--bg);
            color: var(--primary);
            margin: 0;
            display: flex;
            height: 100vh;
            overflow: hidden;
        }

        /* Sidebar avec défilement propre */
        .sidebar {
            width: 380px;
            background: var(--card);
            height: 100vh;
            padding: 24px;
            box-shadow: 4px 0 15px rgba(0,0,0,0.05);
            overflow-y: auto;
            border-left: 1px solid #e2e8f0;
            padding-bottom: 150px;
            z-index: 10;
        }

        .main-content {
            flex: 1;
            padding: 40px 50px 80px 100px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .card {
            background: var(--card);
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #e2e8f0;
        }

        h2, h3 { margin-top: 0; color: var(--primary); font-weight: 700; }
        
        .section-title {
            font-size: 0.9rem;
            letter-spacing: 1px;
            color: #ed0707;
            font-weight: 800;    /* Gras prononcé */
            margin: 20px 0 10px 0;
            border-bottom: 2px solid #eff6ff;
            padding-bottom: 5px;
        }

        .input-group { margin-bottom: 16px; }
        label { display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 6px; color: #475569; }
        
        input, select {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            font-size: 0.95rem;
            transition: border 0.2s;
        }

        input:focus { border-color: var(--accent); outline: none; ring: 2px var(--accent); }

        .btn-run {
            background: var(--accent);
            color: white;
            padding: 14px;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            margin-top: 20px;
            transition: transform 0.1s, background 0.2s;
        }

        .btn-run:hover { background: #2563eb; }
        .btn-run:active { transform: scale(0.98); }

        /* Dashboard Grid */
        .grid-stats {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
        }

        .stat-card {
            background: white;
            padding: 15px;
            border-radius: 10px;
            text-align: center;
        }

        .stats-container {
            background-color: #334155;
            padding: 20px;
            border-radius: 12px;
        }

        .stat-val { font-size: 1.4rem; font-weight: 800; display: block; }
        .stat-unit { font-size: 0.8rem; color: #64748b; }

        /* Correction du conteneur de graphique */
        .chart-container {
            position: relative;
            height: 450px;
            width: 100%;
        }

        .file-custom {
            font-size: 0.8rem;
            padding: 5px;
            background: #f1f5f9;
        }

        /* Modal Styles */
        .modal { display: none; position: fixed; z-index: 100; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); }
        .modal-content { background-color: #fefefe; margin: 5% auto; padding: 20px; border: 1px solid #888; width: 90%; max-width: 800px; border-radius: 10px; max-height: 90vh; overflow-y: auto; }
        .close { color: #aaa; float: right; font-size: 28px; font-weight: bold; cursor: pointer; }
        .close:hover { color: black; }
        .profile-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-top: 15px; }
    </style>
</head>
<body>

<main class="main-content">
    <div class="stats-container">
        <h3 style="color: white; margin-top: 0; margin-bottom: 15px;">Indicateurs clés journaliers : </h3>
        <div class="grid-stats">
            <div class="stat-card" id="cardPenSolaire">
                <span class="stat-unit" style="color: #f59e0b; font-weight: bold;">Taux de couverture solaire</span>
                <span class="stat-val" id="resPenSolaire" style="color: black;">0 %</span>
            </div>
            <div class="stat-card" id="cardFuelSave">
                <span class="stat-unit" style="color: #ef4444; font-weight: bold;">Économie de carburant</span>
                <span class="stat-val" id="resFuelSave" style="color: black;">0 l</span>
            </div>
            <div class="stat-card" id="cardCurtail">
                <span class="stat-unit" style="color: #f59e0b; font-weight: bold;">Énergie bridée (Curtailment)</span>
                <span class="stat-val" id="resCurtail" style="color: black;">0 kWh</span>
            </div>
            <div class="stat-card" id="cardProdCentrale" style="display:none;">
                <span class="stat-unit" style="color: #3b82f6; font-weight: bold;">Production centrale</span>
                <span class="stat-val" id="resProdCentrale" style="color: black;">0 MWh</span>
            </div>
            <div class="stat-card" id="cardConsoCentrale" style="display:none;">
                <span class="stat-unit" style="color: #3b82f6; font-weight: bold;">Consommation centrale</span>
                <span class="stat-val" id="resConsoCentrale" style="color: black;">0 MWh</span>
            </div>
            <div class="stat-card" id="cardAutoProd" style="display:none;">
                <span class="stat-unit" style="color: #10b981; font-weight: bold;">Taux d’autoproduction</span>
                <span class="stat-val" id="resAutoProd" style="color: black;">0 %</span>
            </div>
            <div class="stat-card" id="cardCo2">
                <span class="stat-unit" style="color: #10b981; font-weight: bold;">Émissions CO2 évitées</span>
                <span class="stat-val" id="resCo2" style="color: black;">0 t</span>
            </div>
        </div>
    </div>

    <div class="card">
        <h3>Simulation Dynamique (Pas de temps 1h)</h3>
        <div class="chart-container">
            <canvas id="mainChart"></canvas>
        </div>
    </div>

    <div class="card">
        <h3>Résultats Financiers & Optimisation</h3>
        <div id="financialReport">
            Lancer la simulation pour générer les indicateurs bancaires (LCOE, Payback).
        </div>
    </div>
</main>

<aside class="sidebar">
    <h2>Configuration</h2>
    
    <div class="input-group">
        <label>Architecture Système</label>
        <select id="systemType" onchange="toggleBESS(); startSimulation()">
            <option value="pv_inj_reseau">Système PV injection réseau</option>
            <option value="pv_autoconso">Système PV en autoconsommation</option>
            <option value="pv_gen">Hybride PV + Groupe Électrogène</option>
            <option value="pv_gen_bess">Hybride PV + Batteries (BESS) + Groupe</option>
        </select>
    </div>

    <div class="section-title">Puissances & paramètres</div>
    
    <div class="input-group">
        <label>Puissance PV Installée (kWc)</label>
        <input type="number" id="pvCap" value="200" oninput="startSimulation()">
    </div>
    <div class="input-group">
        <label>Productible spécifique (kWh/kWc/an)</label>
        <input type="number" id="specYield" value="1500" oninput="startSimulation()">
    </div>
    <div class="input-group">
        <label>Dégradation panneaux (%/an)</label>
        <input type="number" id="pvDegradation" value="0.5" step="0.1" oninput="startSimulation()">
    </div>
    <div class="input-group" id="grpAutoconso" style="display:none;">
        <label>Taux d'autoconsommation (%)</label>
        <input type="number" id="taux_autoconso" value="70" step="1" oninput="startSimulation()">
    </div>
    <div class="input-group" id="grpGen">
        <label id="lblGenCap">Puissance Groupe (kVA)</label>
        <input type="number" id="genCap" value="500" oninput="startSimulation()">
    </div>

    <div id="bessFields" style="display:none;">
        <div class="input-group">
            <label>Capacité Batterie (kWh)</label>
            <input type="number" id="batCap" value="1000" oninput="startSimulation()">
        </div>
        <div class="input-group">
            <label>Puissance Convertisseur BESS (kW)</label>
            <input type="number" id="pcsCap" value="500" oninput="startSimulation()">
        </div>
        <div class="input-group">
            <label>Dégradation calendaire batterie (%/an)</label>
            <input type="number" id="battDegradation" value="2.0" step="0.1" oninput="startSimulation()">
        </div>
    </div>

    <div class="section-title">Tarif de vente & soutirage</div>

    <div class="input-group">
        <label>Tarif injection réseau (€/MWh)</label>
        <input type="number" id="tarif_injection" value="80" oninput="startSimulation()">
    </div>
    
     <div class="input-group">
        <label>Tarif soutirage réseau (€/MWh)</label>
        <input type="number" id="tarif_soutirage" value="120" oninput="startSimulation()">
    </div>

    <div class="input-group">
        <label>Tarif vente de surplus (€/MWh)</label>
        <input type="number" id="tarif_surplus" value="120" oninput="startSimulation()">
    </div>

    <div class="section-title">Contraintes d'exploitation</div>
    
    <div class="input-group" id="grpMinGen">
        <label>Charge Min. Diesel (%)</label>
        <input type="number" id="minGenLoad" value="30" oninput="updateMaxPvRatio(); startSimulation()">
    </div>
    <div class="input-group">
        <label>Ratio Max PV/Genset (%) - Stabilité</label>
        <input type="number" id="maxPvRatio" value="70" readonly style="background-color: #e2e8f0;">
    </div>
    <div class="input-group">
        <label>Cible Taux de Couverture (%)</label>
        <input type="number" id="targetCoverage" value="30" oninput="startSimulation()">
    </div>

    <div class="section-title">Données de charge</div>
    <div class="input-group">
        <label>Importer Courbe de Charge (CSV - 1 col)</label>
        <input type="file" id="csvFile" class="file-custom" accept=".csv">
    </div>
    <div class="input-group">
        <label>Puissance Soutirage Max (kW) - Manuel</label>
        <div style="display:flex; gap:5px;">
            <input type="number" id="manualLoad" value="350" oninput="startSimulation()">
            <button onclick="openProfileModal()" style="width:auto; padding:0 10px; cursor:pointer;" title="Configurer le profil horaire">⚙️</button>
            <button onclick="openGenProfileModal()" style="width:auto; padding:0 10px; cursor:pointer;" title="Configurer l'heure de fonctionnement du GE">⚙️</button>
        </div>
    </div>

    <div class="section-title">Analyse économique</div>
    <div class="input-group">
        <label>Devise</label>
        <div style="display: flex; gap: 10px;">
            <label style="font-weight: normal;"><input type="radio" name="currency" value="$" checked onchange="updateCurrency(); startSimulation()"> $</label>
            <label style="font-weight: normal;"><input type="radio" name="currency" value="€" onchange="updateCurrency(); startSimulation()"> €</label>
            <label style="font-weight: normal;"><input type="radio" name="currency" value="CFA" onchange="updateCurrency(); startSimulation()"> CFA</label>
        </div>
    </div>
    <div class="input-group">
        <label>Prix Diesel (<span class="cur-sym">$</span>/Litre)</label>
        <input type="number" id="fuelPrice" value="1.2" step="0.1" oninput="startSimulation()">
    </div>
    <div class="input-group">
        <label>Coût Système (<span class="cur-sym">$</span>/Wc)</label>
        <input type="number" id="capexPv" value="0.9" step="0.1" oninput="startSimulation()">
    </div>
    <div class="input-group" style="background: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
        <div style="font-size: 0.8rem; margin-bottom: 4px;">CAPEX Total: <strong id="resCapexTotal">0</strong> <span class="cur-sym">$</span></div>
        <div style="font-size: 0.8rem;">OPEX Total (20 ans): <strong id="resOpexTotal">0</strong> <span class="cur-sym">$</span></div>
    </div>
    <div class="input-group">
        <label>Indexation carburant (%/an)</label>
        <input type="number" id="fuelIndex" value="5" step="0.1" oninput="startSimulation()">
    </div>
    <div class="input-group">
        <label>Indexation entretien système (%/an)</label>
        <input type="number" id="maintIndex" value="3" step="0.1" oninput="startSimulation()">
    </div>
    <div class="input-group">
        <label>Entretien (<span class="cur-sym">$</span>/Wc/an)</label>
        <input type="number" id="maintenance" value="0.01" step="0.001" oninput="startSimulation()">
    </div>
    <div class="input-group">
        <label>Remplacement onduleur/batt 10 ans (<span class="cur-sym">$</span>/Wc)</label>
        <input type="number" id="replacement" value="0.05" step="0.01" oninput="startSimulation()">
    </div>
    <div class="input-group">
        <label>Émission CO2 référence (kg/kWh)</label>
        <input type="number" id="co2Ref" value="0.8" step="0.01" oninput="startSimulation()">
    </div>

    <div class="section-title">Financement</div>
    <div class="input-group">
        <label>Mode de financement</label>
        <div style="display: flex; gap: 10px;">
            <label style="font-weight: normal;"><input type="radio" name="finMode" value="equity" onchange="toggleDebt(); startSimulation()"> Fonds propre</label>
            <label style="font-weight: normal;"><input type="radio" name="finMode" value="debt" checked onchange="toggleDebt(); startSimulation()"> Dette</label>
        </div>
    </div>
    
    <div id="debtFields">
        <div class="input-group">
            <label>Taux d'intérêt (%)</label>
            <input type="number" id="interestRate" value="4" step="0.1" oninput="startSimulation()">
        </div>
        <div class="input-group">
            <label>Fonds propre (%)</label>
            <input type="number" id="equityShare" value="20" step="1" oninput="startSimulation()">
        </div>
        <div class="input-group">
            <label>Maturité (ans)</label>
            <input type="number" id="maturity" value="20" step="1" oninput="startSimulation()">
        </div>
        <div class="input-group" style="background: #f8fafc; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
            <div style="font-size: 0.8rem; margin-bottom: 4px;">Intérêt annuel estimé: <strong id="resAnnualInterest">0</strong> k<span class="cur-sym">$</span></div>
            <div style="font-size: 0.8rem;">Annuité estimée: <strong id="resAnnuity">0</strong> k<span class="cur-sym">$</span></div>
        </div>
    </div>

    <div class="input-group">
        <label>Taux d'actualisation (%)</label>
        <input type="number" id="discountRate" value="3" step="0.1" oninput="startSimulation()">
    </div>
    <div class="input-group">
        <label>Dépréciation (100% CAPEX)</label>
        <div style="display: flex; gap: 10px;">
            <label style="font-weight: normal;"><input type="radio" name="depreciation" value="yes" onchange="toggleDepreciation(); startSimulation()"> Oui</label>
            <label style="font-weight: normal;"><input type="radio" name="depreciation" value="no" checked onchange="toggleDepreciation(); startSimulation()"> Non</label>
        </div>
    </div>
    <div id="depreciationField" style="display:none;" class="input-group">
        <label>Valeur Dépréciation (<span class="cur-sym">$</span>)</label>
        <input type="number" id="depreciationVal" value="0" oninput="startSimulation()">
    </div>

    <button class="btn-run" onclick="startSimulation()">CALCULER LA SIMULATION</button>
</aside>

<!-- Modal Profil de Charge -->
<div id="profileModal" class="modal">
    <div class="modal-content">
        <span class="close" onclick="closeProfileModal()">&times;</span>
        <h3>Profil de Charge Journalier</h3>
        <p>Définissez la répartition horaire de la puissance de soutirage (Total = 100%)</p>
        <p style="text-align:right; font-weight:bold;">Total : <span id="profileTotal">100</span> %</p>
        <div id="profileInputs" class="profile-grid"></div>
        <button class="btn-run" onclick="saveProfile()" style="margin-top:20px;">Valider le profil</button>
    </div>
</div>

<!-- Modal Profil Fonctionnement GE -->
<div id="genProfileModal" class="modal">
    <div class="modal-content">
        <span class="close" onclick="closeGenProfileModal()">&times;</span>
        <h3>Configuration Fonctionnement Groupe Électrogène</h3>
        <div class="input-group">
            <label>Puissance charges critiques (GE OFF) [kW]</label>
            <input type="number" id="criticalLoadInput" value="10">
        </div>
        <p>Définissez les plages horaires de fonctionnement (Coché = ON, Décoché = OFF)</p>
        <button onclick="toggleAllGenStatus()" style="margin-bottom:10px; padding:5px 10px; cursor:pointer; background:#e2e8f0; border:1px solid #cbd5e1; border-radius:4px;">Tout sélectionner/Désélectionner</button>
        <div id="genProfileInputs" class="profile-grid"></div>
        <button class="btn-run" onclick="saveGenProfile()" style="margin-top:20px;">Valider la configuration</button>
    </div>
</div>

<script>
    let myChart = null;
    let importedLoad = [];
    let hourlyFractions = [2.2, 2.2, 2.2, 2.2, 2.2, 2.2, 3.6, 3.6, 6.9, 6.9, 6.9, 6.9, 4.8, 4.8, 6.2, 6.2, 6.2, 4.2, 4.2, 4.2, 2.8, 2.8, 2.8, 2.8];
    let genStatus = Array(24).fill(true);
    let criticalLoad = 10;

    function toggleBESS() {
        const type = document.getElementById('systemType').value;
        
        // Gestion BESS
        document.getElementById('bessFields').style.display = (type === 'pv_gen_bess') ? 'block' : 'none';
        
        // Gestion UI selon Architecture
        const grpAutoconso = document.getElementById('grpAutoconso');
        const grpGen = document.getElementById('grpGen');
        const lblGen = document.getElementById('lblGenCap');
        const grpMinGen = document.getElementById('grpMinGen');

        // Reset visibilité par défaut
        if(grpAutoconso) grpAutoconso.style.display = 'none';
        if(grpGen) grpGen.style.display = 'block';
        if(grpMinGen) grpMinGen.style.display = 'block';
        if(lblGen) lblGen.innerText = "Puissance Groupe (kVA)";

        // Reset Stats visibilité
        document.getElementById('cardPenSolaire').style.display = 'block';
        document.getElementById('cardFuelSave').style.display = 'block';
        document.getElementById('cardCurtail').style.display = 'block';
        document.getElementById('cardProdCentrale').style.display = 'none';
        document.getElementById('cardConsoCentrale').style.display = 'none';
        document.getElementById('cardAutoProd').style.display = 'none';

        if (type === 'pv_inj_reseau') {
            if(grpGen) grpGen.style.display = 'none';
            if(grpMinGen) grpMinGen.style.display = 'none';
            document.getElementById('cardPenSolaire').style.display = 'none';
            document.getElementById('cardFuelSave').style.display = 'none';
            document.getElementById('cardProdCentrale').style.display = 'block';
        } else if (type === 'pv_autoconso') {
            if(grpAutoconso) grpAutoconso.style.display = 'block';
            if(lblGen) lblGen.innerText = "Consommation du site (MWh)";
            if(grpMinGen) grpMinGen.style.display = 'none';
            document.getElementById('cardPenSolaire').style.display = 'none';
            document.getElementById('cardFuelSave').style.display = 'none';
            document.getElementById('cardCurtail').style.display = 'none';
            document.getElementById('cardConsoCentrale').style.display = 'block';
            document.getElementById('cardAutoProd').style.display = 'block';
        }

        // Mise à jour des valeurs par défaut selon votre demande
        if(type === 'pv_gen') document.getElementById('targetCoverage').value = 30;
        else if(type === 'pv_gen_bess') document.getElementById('targetCoverage').value = 80;
    }

    function toggleDebt() {
        const isDebt = document.querySelector('input[name="finMode"]:checked').value === 'debt';
        document.getElementById('debtFields').style.display = isDebt ? 'block' : 'none';
    }

    function toggleDepreciation() {
        const use = document.querySelector('input[name="depreciation"]:checked').value === 'yes';
        document.getElementById('depreciationField').style.display = use ? 'block' : 'none';
        if (use) {
            const pv = parseFloat(document.getElementById('pvCap').value) || 0;
            const cost = parseFloat(document.getElementById('capexPv').value) || 0;
            document.getElementById('depreciationVal').value = pv * cost * 1000;
        }
    }

    function updateCurrency() {
        const sym = document.querySelector('input[name="currency"]:checked').value;
        document.querySelectorAll('.cur-sym').forEach(el => el.innerText = sym);
    }

    // Modal Functions
    function openProfileModal() {
        const container = document.getElementById('profileInputs');
        container.innerHTML = '';
        hourlyFractions.forEach((val, i) => {
            const div = document.createElement('div');
            div.innerHTML = `<label>${i}h-${i+1}h (%)</label><input type="number" class="prof-input" value="${val}" step="0.1" oninput="updateProfileTotal()">`;
            container.appendChild(div);
        });
        updateProfileTotal();
        document.getElementById('profileModal').style.display = "block";
    }

    function updateProfileTotal() {
        const inputs = document.querySelectorAll('.prof-input');
        let sum = 0;
        inputs.forEach(inp => sum += parseFloat(inp.value) || 0);
        const totalEl = document.getElementById('profileTotal');
        totalEl.innerText = sum.toFixed(1);
        totalEl.style.color = Math.abs(sum - 100) < 0.1 ? 'green' : 'red';
    }

    function closeProfileModal() {
        document.getElementById('profileModal').style.display = "none";
    }

    function saveProfile() {
        const inputs = document.querySelectorAll('.prof-input');
        let sum = 0;
        inputs.forEach((inp, i) => {
            let val = parseFloat(inp.value) || 0;
            hourlyFractions[i] = val;
            sum += val;
        });
        closeProfileModal();
        startSimulation();
    }

    // Gen Profile Modal Functions
    function openGenProfileModal() {
        const container = document.getElementById('genProfileInputs');
        container.innerHTML = '';
        genStatus.forEach((status, i) => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'space-between';
            div.style.padding = '5px';
            div.style.background = status ? '#d1fae5' : '#fee2e2';
            div.style.borderRadius = '4px';
            div.innerHTML = `<label style="margin:0; font-size:0.8rem;">${i}h-${i+1}h</label><input type="checkbox" class="gen-status-input" ${status ? 'checked' : ''} onchange="this.parentElement.style.background = this.checked ? '#d1fae5' : '#fee2e2'">`;
            container.appendChild(div);
        });
        document.getElementById('criticalLoadInput').value = criticalLoad;
        document.getElementById('genProfileModal').style.display = "block";
    }

    function closeGenProfileModal() {
        document.getElementById('genProfileModal').style.display = "none";
    }

    function saveGenProfile() {
        const inputs = document.querySelectorAll('.gen-status-input');
        inputs.forEach((inp, i) => { genStatus[i] = inp.checked; });
        criticalLoad = parseFloat(document.getElementById('criticalLoadInput').value) || 0;
        closeGenProfileModal();
        startSimulation();
    }

    function toggleAllGenStatus() {
        const inputs = document.querySelectorAll('.gen-status-input');
        const allChecked = Array.from(inputs).every(i => i.checked);
        inputs.forEach(i => {
            i.checked = !allChecked;
            i.parentElement.style.background = i.checked ? '#d1fae5' : '#fee2e2';
        });
    }

    function updateMaxPvRatio() {
        const minLoad = parseFloat(document.getElementById('minGenLoad').value) || 0;
        document.getElementById('maxPvRatio').value = 100 - minLoad;
    }

    // Gestion de l'import CSV
    document.getElementById('csvFile').addEventListener('change', function(e) {
        const file = e.target.files[0];
        Papa.parse(file, {
            header: false,
            complete: function(results) {
                // Skip 5 lines, read column B (index 1)
                const dataRows = results.data.slice(5);
                importedLoad = dataRows.map(row => parseFloat(row[1])).filter(n => !isNaN(n));
                alert("Courbe de charge importée : " + importedLoad.length + " points détectés.");
            }
        });
    });

    function startSimulation() {
        // Sécurisation des entrées
        const config = {
            systemType: document.getElementById('systemType').value,
            pvCap: parseFloat(document.getElementById('pvCap').value) || 0,
            specYield: parseFloat(document.getElementById('specYield').value) || 1500,
            genCap: parseFloat(document.getElementById('genCap').value) || 0,
            minGenLoad: (parseFloat(document.getElementById('minGenLoad').value) / 100) * (parseFloat(document.getElementById('genCap').value) || 0),
            maxPvRatio: ((100 - parseFloat(document.getElementById('minGenLoad').value)) / 100) * (parseFloat(document.getElementById('genCap').value) || 0),
            hasBess: document.getElementById('systemType').value === 'pv_gen_bess',
            batCap: parseFloat(document.getElementById('batCap').value) || 0,
            fuelPrice: parseFloat(document.getElementById('fuelPrice').value) || 0,
            manualLoad: parseFloat(document.getElementById('manualLoad').value) || 0,
            co2Ref: parseFloat(document.getElementById('co2Ref').value) || 0,
            maintenance: parseFloat(document.getElementById('maintenance').value) || 0,
            replacement: parseFloat(document.getElementById('replacement').value) || 0,
            capexPv: parseFloat(document.getElementById('capexPv').value) || 0,
            pvDegradation: parseFloat(document.getElementById('pvDegradation').value) || 0,
            battDegradation: parseFloat(document.getElementById('battDegradation').value) || 0,
            fuelIndex: parseFloat(document.getElementById('fuelIndex').value) || 0,
            maintIndex: parseFloat(document.getElementById('maintIndex').value) || 0,
            finMode: document.querySelector('input[name="finMode"]:checked').value,
            interestRate: parseFloat(document.getElementById('interestRate').value) || 0,
            equityShare: parseFloat(document.getElementById('equityShare').value) || 0,
            maturity: parseFloat(document.getElementById('maturity').value) || 20,
            discountRate: parseFloat(document.getElementById('discountRate').value) || 0,
            useDepreciation: document.querySelector('input[name="depreciation"]:checked').value === 'yes',
            depreciationVal: parseFloat(document.getElementById('depreciationVal').value) || 0
        };

        // Sauvegarde LocalStorage
        saveToLocalStorage();

        // Validation : Puissance Soutirage Max vs Groupe
        const manualLoadInput = document.getElementById('manualLoad');
        manualLoadInput.setCustomValidity("");

        if (config.systemType === 'pv_gen' || config.systemType === 'pv_gen_bess') {
            const limit = 1.10 * 0.8 * config.genCap;
            if (config.manualLoad > limit) {
                manualLoadInput.setCustomValidity("Il y a une erreur : La Puissance Soutirage Max dépasse la limite autorisée (1.10 * 0.8 * Puissance Groupe).");
                manualLoadInput.reportValidity();
                return;
            }
        }

        // Calculs spécifiques pour les nouvelles architectures
        if (config.systemType === 'pv_inj_reseau') {
            const prodMWh = config.pvCap * config.specYield / 1000;
            const co2 = prodMWh * config.co2Ref; 
            document.getElementById('resProdCentrale').innerText = Math.round(prodMWh).toLocaleString() + " MWh";
            document.getElementById('resCo2').innerText = co2.toFixed(2) + " t";
            return;
        }

        if (config.systemType === 'pv_autoconso') {
            const loadMWh = config.genCap; // Le champ genCap est utilisé pour la consommation en MWh
            const tauxAuto = parseFloat(document.getElementById('taux_autoconso').value) || 0;
            
            const prodMWh = config.pvCap * config.specYield / 1000;
            const consumedMWh = prodMWh * (tauxAuto / 100);
            const autoprod = (loadMWh > 0) ? (consumedMWh / loadMWh) * 100 : 0;
            const co2 = consumedMWh * config.co2Ref;

            document.getElementById('resConsoCentrale').innerText = Math.round(loadMWh).toLocaleString() + " MWh";
            document.getElementById('resAutoProd').innerText = autoprod.toFixed(1) + " %";
            document.getElementById('resCo2').innerText = co2.toFixed(2) + " t";
            return;
        }

        // Condition Zéro
        if (config.pvCap === 0 || config.specYield === 0 || config.genCap === 0 || config.manualLoad === 0) {
            document.getElementById('resPenSolaire').innerText = "0 %";
            document.getElementById('resFuelSave').innerText = "0 L";
            document.getElementById('resCurtail').innerText = "0 kWh";
            document.getElementById('resCo2').innerText = "0 t";
            if (myChart) { myChart.destroy(); myChart = null; }
            document.getElementById('financialReport').innerHTML = "Données insuffisantes (valeurs nulles détectées).";
            return;
        }

        if (config.systemType === 'pv_gen' && config.genCap <= 0) {
            alert("Erreur : La puissance du groupe électrogène ne peut pas être 0 dans un système Hybride PV+Groupe.");
            return;
        }

        // Gestion de la durée de simulation et du pas de temps
        let load = [];
        let points = 24;
        
        if (importedLoad.length > 0) {
            load = importedLoad;
            points = load.length;
        } else {
            // Utilisation du profil horaire
            load = [];
            const maxFraction = Math.max(...hourlyFractions) || 1;
            for(let i=0; i<points; i++) {
                let h = i % 24;
                load.push(config.manualLoad * (hourlyFractions[h] / maxFraction));
            }
        }

        // Profil solaire de base (24h)
        const baseIrradiance = [0,0,0,0,0,0, 1.2, 5, 9.5, 12.5, 15, 16.5, 16, 13, 8.5, 4, 1.5, 0.8, 0,0,0,0,0,0];
        const baseSum = 103.5; // Somme des coefficients
        
        // Adaptation du profil solaire à la durée de simulation
        let irradiance = [];
        
        for (let i = 0; i < points; i++) {
            // Mapping de l'index i vers l'heure 0-23 selon le pas de temps estimé
            let hourIndex = 0;
            if (points <= 48) hourIndex = i % 24;
            else if (points <= 9000) hourIndex = i % 24; // Pas 1h
            else if (points <= 18000) hourIndex = Math.floor(i / 2) % 24; // Pas 30m
            else hourIndex = Math.floor(i / 4) % 24; // Pas 15m

            irradiance.push(baseIrradiance[hourIndex]);
        }

        // Calcul du facteur d'échelle pour respecter le productible spécifique
        // Energie annuelle cible = specYield * pvCap
        // Energie annuelle profil base = baseSum * 365 * pvCap
        const scaleFactor = (config.specYield / 365) / baseSum;

        // Application de la dégradation (Simulation année 1 conservatrice)
        const realPvCap = config.pvCap * (1 - (config.pvDegradation / 100));
        const realBatCap = config.batCap * (1 - (config.battDegradation / 100));

        let sim = {
            pv: [], gen: [], curt: [], soc: [], crit: [],
            totalGenKwh: 0, totalPvKwh: 0, totalLoadKwh: 0, currentSoc: realBatCap * 0.6
            , totalCritDeficit: 0
        };

        for (let i = 0; i < points; i++) {
            let demand = load[i];
            let h = i % 24;
            let isGenOn = genStatus[h];

            // Logique GE ON/OFF : Si OFF, on utilise la charge critique
            if (!isGenOn) {
                demand = criticalLoad;
                sim.crit.push(demand);
            } else {
                sim.crit.push(0);
            }

            let pvPot = irradiance[i] * scaleFactor * realPvCap;
            let pvUsed = 0;
            let genP = 0;
            let curt = 0;
            let unserved = 0;

            if (!config.hasBess) {
                if (isGenOn) {
                    // LOGIQUE PV-GENSET : Priorité sécurité fréquence
                    pvUsed = Math.min(pvPot, demand - config.minGenLoad, config.maxPvRatio);
                    pvUsed = Math.max(0, pvUsed);
                    genP = demand - pvUsed;
                    curt = pvPot - pvUsed;
                } else {
                    // GE OFF : PV alimente charge critique si possible, sinon UPS (non simulé ici, genP=0)
                    genP = 0;
                    pvUsed = Math.min(pvPot, demand);
                    curt = pvPot - pvUsed;
                    unserved = demand - pvUsed;
                }
            } else {
                // LOGIQUE PV-GEN-BESS : Arbitrage stockage
                pvUsed = Math.min(pvPot, demand);
                let excess = pvPot - pvUsed;
                
                // Charge BESS
                if (excess > 0) {
                    let charge = Math.min(excess, realBatCap - sim.currentSoc);
                    sim.currentSoc += charge;
                    curt = excess - charge;
                }

                let gap = demand - pvUsed;
                // Décharge BESS
                if (gap > 0) {
                    let discharge = Math.min(gap, sim.currentSoc - (realBatCap * 0.2));
                    sim.currentSoc -= discharge;
                    gap -= discharge;
                }

                // Groupe en dernier recours
                if (gap > 0) {
                    if (isGenOn) {
                        genP = Math.max(gap, config.minGenLoad);
                        // Surplus éventuel du groupe vers batterie
                        if (genP > gap) sim.currentSoc = Math.min(realBatCap, sim.currentSoc + (genP - gap));
                    } else {
                        genP = 0; // GE forcé OFF, charge critique sur UPS si batterie vide
                        unserved = gap;
                    }
                }
            }

            sim.pv.push(pvUsed);
            sim.gen.push(genP);
            sim.curt.push(curt);
            sim.soc.push((sim.currentSoc / realBatCap) * 100);
            sim.totalGenKwh += genP;
            sim.totalPvKwh += pvUsed;
            sim.totalLoadKwh += demand;
            sim.totalCritDeficit += Math.max(0, unserved);
        }

        renderResults(sim, config, points);
    }

    function renderResults(sim, config, points) {
        // MAJ Stats
        const pen = sim.totalLoadKwh > 0 ? (sim.totalPvKwh / sim.totalLoadKwh) * 100 : 0;
        const fuelUsed = sim.totalGenKwh * 0.265; 
        // Baseline fuel: si tout était fait au groupe
        const baselineFuel = sim.totalLoadKwh * 0.265;
        const fuelSaved = Math.max(0, baselineFuel - fuelUsed);

        // Calcul CO2 évité avec la valeur de référence utilisateur
        // CO2 Reference (Grid/Base) - CO2 Système (Diesel résiduel)
        // Diesel approx 2.65 kgCO2/L. FuelUsed est en Litres.
        const co2System = fuelUsed * 2.65;
        const co2Baseline = sim.totalLoadKwh * config.co2Ref;
        const co2Avoided = Math.max(0, co2Baseline - co2System);

        // Ajustement Curtailment avec UPS
        const totalCurtailment = sim.curt.reduce((a,b)=>a+b, 0);
        const upsRecovered = Math.min(totalCurtailment, sim.totalCritDeficit);
        const displayedCurtailment = totalCurtailment - upsRecovered;

        document.getElementById('resPenSolaire').innerText = pen.toFixed(1) + " %";
        // Affichage adapté si simulation annuelle ou journalière
        const periodLabel = points > 48 ? " / période" : " / jour";
        document.getElementById('resFuelSave').innerText = Math.round(fuelSaved).toLocaleString() + " l" + periodLabel;
        document.getElementById('resCurtail').innerText = Math.round(displayedCurtailment).toLocaleString() + " kWh";
        document.getElementById('resCo2').innerText = (co2Avoided / 1000).toFixed(2) + " t";

        // MAJ Graphique - Correction du bug de superposition
        const ctx = document.getElementById('mainChart').getContext('2d');
        if (myChart) { myChart.destroy(); }

        // Limitation des points pour le graphique pour éviter le plantage si > 1 semaine
        const displayLimit = 168; // 1 semaine max affichée pour lisibilité
        const labels = Array.from({length: Math.min(points, displayLimit)}, (_, i) => i + "h");
        
        const datasets = [
            { label: 'Injection Solaire (kVA)', data: sim.pv.slice(0, displayLimit), backgroundColor: '#facc15', stack: 'A', barPercentage: 0.85, categoryPercentage: 0.85, borderRadius: 4, grouped: false },
            { label: 'Groupe Électrogène (kVA)', data: sim.gen.slice(0, displayLimit), backgroundColor: '#ef4444', stack: 'A', barPercentage: 0.85, categoryPercentage: 0.85, borderRadius: 4, grouped: false },
            { label: 'Charges Critiques (GE OFF)', data: sim.crit.slice(0, displayLimit), backgroundColor: '#93c5fd', stack: 'B', barPercentage: 0.85, categoryPercentage: 0.85, borderRadius: 4, grouped: false }
        ];

        if (config.hasBess) {
            datasets.push({ label: 'Batterie SoC (%)', data: sim.soc.slice(0, displayLimit), type: 'line', borderColor: '#10b981', yAxisID: 'y1' });
        }

        myChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { stacked: true, title: { display: true, text: 'Puissance (kW)' }, grace: '10%' },
                    y1: { 
                        display: config.hasBess,
                        position: 'right', 
                        min: 0, 
                        max: 100, 
                        title: { display: true, text: 'SoC (%)' }, 
                        grid: { display: false } 
                    }
                }
            }
        });

        // --- Analyse Financière Avancée (20 ans) ---
        const capex = config.pvCap * config.capexPv * 1000;
        
        // Mise à jour de la valeur par défaut de dépréciation si non définie
        if (config.useDepreciation && config.depreciationVal === 0) {
            document.getElementById('depreciationVal').value = capex;
        }

        const years = config.maturity; 
        const discount = config.discountRate / 100;
        const fuelIndex = config.fuelIndex / 100;
        const maintIndex = config.maintIndex / 100;

        // Calcul Dette
        let loanAmount = 0;
        let equityAmount = capex;
        let annualPayment = 0;
        let annualInterestYear1 = 0;

        if (config.finMode === 'debt') {
            const equityPct = config.equityShare / 100;
            equityAmount = capex * equityPct;
            loanAmount = capex - equityAmount;
            const r = config.interestRate / 100;
            // Formule annuité : A = P * (r / (1 - (1+r)^-n))
            if (r > 0) {
                annualPayment = loanAmount * (r / (1 - Math.pow(1 + r, -years)));
                annualInterestYear1 = loanAmount * r;
            } else {
                annualPayment = loanAmount / years;
            }
        }

        // Affichage Dette Sidebar
        document.getElementById('resAnnualInterest').innerText = (annualInterestYear1 / 1000).toFixed(1);
        document.getElementById('resAnnuity').innerText = (annualPayment / 1000).toFixed(1);

        // Flux de trésorerie
        let cashFlowsProject = [-capex]; // Pour TRI Projet
        let cashFlowsEquity = [-equityAmount]; // Pour TRI Fonds Propre
        let npvProjectSum = 0;
        let discountedEnergySum = 0;
        let discountedCostSum = capex; // Initial Capex for LCOE numerator
        let cumulativeDiscountedSavings = 0;
        let paybackYear = "> 20";

        // Extrapolation annuelle de base
        const annualFactor = points > 48 ? (8760 / (points / (points >= 35000 ? 4 : (points >= 17000 ? 2 : 1)))) : 365;
        const baseFuelSaved = fuelSaved * annualFactor; // Litres
        const baseEnergyServed = sim.totalLoadKwh * annualFactor; // kWh
        
        for (let y = 1; y <= years; y++) {
            // Dégradation
            const degFactorPV = Math.pow(1 - (config.pvDegradation/100), y-1);
            // On simplifie en appliquant la dégradation PV à l'économie carburant (approx)
            const currentFuelSaved = baseFuelSaved * degFactorPV;
            const currentEnergyServed = baseEnergyServed; // La charge reste la même, le diesel compense

            // Coûts et Revenus
            const fuelSavingsVal = currentFuelSaved * config.fuelPrice * Math.pow(1 + fuelIndex, y-1);
            const opexVal = (config.maintenance * config.pvCap * 1000) * Math.pow(1 + maintIndex, y-1);
            let replacementCost = 0;
            if (y === 10) replacementCost = config.replacement * config.pvCap * 1000;

            // Cash Flow Opérationnel (Economie Nette)
            let netSavings = fuelSavingsVal - opexVal - replacementCost;
            
            // Note: La dépréciation est une charge non décaissée qui réduit l'impôt. 
            // Sans taux d'impôt spécifié dans le prompt, elle n'impacte pas le cash flow net ici, 
            // mais la valeur est disponible via config.depreciationVal si besoin d'extension future.

            // Pour TRI Projet (sans dette)
            cashFlowsProject.push(netSavings);

            // Pour TRI Equity (avec dette)
            cashFlowsEquity.push(netSavings - annualPayment);

            // Actualisation
            const discFactor = Math.pow(1 + discount, -y);
            npvProjectSum += netSavings * discFactor;
            cumulativeDiscountedSavings += netSavings * discFactor;
            if (paybackYear === "> 20" && cumulativeDiscountedSavings >= capex) {
                paybackYear = y;
            }

            // LCOE Components
            discountedCostSum += (opexVal + replacementCost) * discFactor; // Fuel is savings, not system cost here? 
            // LCOE Hybrid System = (Capex + Sum(Opex + Fuel_Diesel_Residual)) / Energy. 
            // Mais ici on calcule souvent le LCOE du système PV/BESS ajouté.
            // Formule simplifiée demandée : LCOE ($/MWh) actualisé.
            discountedEnergySum += (sim.totalPvKwh * annualFactor * degFactorPV) * discFactor;
        }

        // Calculs Indicateurs
        const van = npvProjectSum - capex;
        const lcoe = (discountedCostSum / (discountedEnergySum / 1000)) || 0; // $/MWh
        const paybackDiscounted = paybackYear;

        // Helper TRI
        function calculateIRR(values, guess) {
            const maxIter = 1000; const tol = 0.00001;
            for (let i = 0; i < maxIter; i++) {
                let f = 0; let df = 0;
                for (let j = 0; j < values.length; j++) {
                    f += values[j] / Math.pow(1 + guess, j);
                    df -= (j * values[j]) / Math.pow(1 + guess, j + 1);
                }
                const newGuess = guess - f / df;
                if (Math.abs(newGuess - guess) < tol) return newGuess * 100;
                guess = newGuess;
            }
            return 0;
        }

        const triProject = calculateIRR(cashFlowsProject, 0.1);
        const triEquity = calculateIRR(cashFlowsEquity, 0.1);

        // Affichage CAPEX/OPEX Total dans la sidebar
        const cur = document.querySelector('input[name="currency"]:checked').value;
        document.getElementById('resCapexTotal').innerText = Math.round(capex).toLocaleString();
        document.getElementById('resOpexTotal').innerText = Math.round(discountedCostSum - capex).toLocaleString(); // Approx OPEX sum discounted

        document.getElementById('financialReport').innerHTML = `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px;">
                <div><strong>VAN (NPV):</strong> ${Math.round(van).toLocaleString()} ${cur}</div>
                <div><strong>TRI Projet:</strong> ${triProject.toFixed(1)} %</div>
                <div><strong>TRI Fonds Propre:</strong> ${triEquity.toFixed(1)} %</div>
                <div><strong>Économie nette actualisée:</strong> ${Math.round(cumulativeDiscountedSavings).toLocaleString()} ${cur}</div>
                <div><strong>Payback actualisé:</strong> ${paybackDiscounted} ${paybackDiscounted !== "> 20" ? "ans" : ""}</div>
                <div><strong>LCOE:</strong> ${lcoe.toFixed(1)} ${cur}/MWh</div>
            </div>
        `;
    }

    function saveToLocalStorage() {
        const inputs = document.querySelectorAll('input, select');
        inputs.forEach(el => {
            if (el.type === 'radio') {
                if (el.checked) localStorage.setItem(el.name, el.value);
            } else if (el.type !== 'file') {
                localStorage.setItem(el.id, el.value);
            }
        });
    }

    function loadFromLocalStorage() {
        const inputs = document.querySelectorAll('input, select');
        inputs.forEach(el => {
            if (el.type === 'radio') {
                const val = localStorage.getItem(el.name);
                if (val && el.value === val) el.checked = true;
            } else if (el.type !== 'file') {
                const val = localStorage.getItem(el.id);
                if (val !== null) el.value = val;
            }
        });
    }

    window.onload = () => { loadFromLocalStorage(); toggleBESS(); toggleDebt(); toggleDepreciation(); updateMaxPvRatio(); updateCurrency(); startSimulation(); };
</script>

</body>
</html>