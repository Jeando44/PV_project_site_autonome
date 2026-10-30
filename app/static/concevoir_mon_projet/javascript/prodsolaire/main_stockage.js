 let initialTauxAuto = 80;
        let storageChart = null;

        window.onload = () => {
            openStockage();
        };

        function updateInitialTaux() {
            initialTauxAuto = parseFloat(document.getElementById('sto_taux_initial').value) || 0;
            document.getElementById('sto_taux_ref').value = initialTauxAuto;
        }

        function closeModal(id) {
            document.getElementById(id).style.display = 'none';
        }

        function openStockage() {
            updateInitialTaux();
            
            const defaultNightHours = JSON.stringify([22, 23, 0, 1, 2, 3, 4, 5]);
            const rechargeInput = document.getElementById('sto_recharge_hours');
            const dechargeInput = document.getElementById('sto_decharge_hours');

            if (!rechargeInput.value || rechargeInput.value === '[]') rechargeInput.value = defaultNightHours;
            if (!dechargeInput.value || dechargeInput.value === '[]') dechargeInput.value = defaultNightHours;

            initTimeSelector('recharge');
            initTimeSelector('decharge');
            
            document.getElementById('storageModal').style.display = 'block';
            setTimeout(calcStockage, 100);
        }

        function initTimeSelector(type) {
            const container = document.getElementById(`sto_${type}_selector`);
            if (!container) return;
            container.innerHTML = '';

            const input = document.getElementById(`sto_${type}_hours`);
            const selectedHours = input ? JSON.parse(input.value) : [];

            for (let i = 0; i < 24; i++) {
                const div = document.createElement('div');
                div.className = 'time-segment';
                if (selectedHours.includes(i)) div.classList.add('selected');
                div.dataset.hour = i;
                div.title = `${i}h - ${i + 1}h`;
                div.onclick = () => {
                    div.classList.toggle('selected');
                    updateSelectedHours(type);
                    calcStockage();
                };
                container.appendChild(div);
            }
            updateDisplay(type);
        }

        function updateSelectedHours(type) {
            const container = document.getElementById(`sto_${type}_selector`);
            const selected = Array.from(container.querySelectorAll('.selected')).map(div => parseInt(div.dataset.hour));
            document.getElementById(`sto_${type}_hours`).value = JSON.stringify(selected);
            updateDisplay(type);
        }

        function updateDisplay(type) {
            const count = document.querySelectorAll(`#sto_${type}_selector .selected`).length;
            document.getElementById(`sto_${type}_display`).textContent = `${count}h sélectionnées`;
        }

        function calcStockage() {
            // Récupération des inputs techniques
            const puissance = parseFloat(document.getElementById('sto_puissance').value) || 0;
            const prod = parseFloat(document.getElementById('sto_productible').value) || 0;
            const cap = parseFloat(document.getElementById('sto_cap').value) || 0;
            const dod = parseFloat(document.getElementById('sto_dod').value) || 0;
            const rendementCharge = parseFloat(document.getElementById('sto_rendement_charge').value) || 0.95;
            const rendementDecharge = parseFloat(document.getElementById('sto_rendement_decharge').value) || 0.95;
            const cycles = parseFloat(document.getElementById('sto_cycles').value) || 0;
            const tauxDirect = parseFloat(document.getElementById('sto_taux_direct').value) || 0;
            const tauxStock = parseFloat(document.getElementById('sto_taux_stock').value) || 0;
            const degradAnnuelle = parseFloat(document.getElementById('sto_degrad_cal').value) / 100 || 0;

            // Calcul Durée de vie & Énergie
            const dureeVieAns = Math.floor(cycles / 365);
            const energieInitialeAnnuelle = cap * (dod / 100) * 365; // kWh

            let energieTotaleViekWh = 0;
            for (let i = 0; i < dureeVieAns; i++) {
                energieTotaleViekWh += energieInitialeAnnuelle * Math.pow(1 - degradAnnuelle, i);
            }

            document.getElementById('sto_energie_vie').value = (energieTotaleViekWh / 1000).toFixed(2);
            document.getElementById('sto_duree_vie').value = dureeVieAns;

            // Calcul Stockage annuel théorique
            const stoAnnuelMWh = (cap * (dod / 100) * 365) / 1000;
            document.getElementById('sto_annuel').value = stoAnnuelMWh.toFixed(2);

            // Taux Autoconso Global
            const sumTaux = tauxDirect + tauxStock;
            const prodAutoconsommee = (prod * puissance * sumTaux / 100) / 1000;
            document.getElementById('sto_prod_autoconsommee').value = prodAutoconsommee.toFixed(2);

            // Répartition de l'énergie (Graphique & Tableau)
            const prodTotaleMWh = (prod * puissance) / 1000;
            const partSolaireStockeeMWh = prodTotaleMWh * (tauxStock / 100);
            const partSolaireDirecteMWh = prodTotaleMWh * (tauxDirect / 100);

            const rechargeHoursInput = document.getElementById('sto_recharge_hours');
            const rechargeHours = (rechargeHoursInput && rechargeHoursInput.value) ? JSON.parse(rechargeHoursInput.value) : [];
            const duration = rechargeHours.length || 0;
            const chargePower = parseFloat(document.getElementById('sto_charge_power').value) || 0;
            const dischargePower = parseFloat(document.getElementById('sto_discharge_power').value) || 0;
            const maxGridRecharge = (chargePower * duration * 365) / 1000; 

            const restitutionActive = document.querySelector('input[name="sto_restitution_toggle"]:checked').value === 'oui';
            let stoReseau = 0;
            if (restitutionActive) {
                stoReseau = Math.min(Math.max(0, (stoAnnuelMWh / rendementCharge) - partSolaireStockeeMWh), maxGridRecharge);
            }
            document.getElementById('sto_reseau').value = stoReseau.toFixed(2);

            const energieSolaireRestituee = partSolaireStockeeMWh * rendementCharge * rendementDecharge;
            const energieReseauRestituee = stoReseau * rendementCharge * rendementDecharge;
            const perteSolaire = partSolaireStockeeMWh - energieSolaireRestituee;
            const perteReseau = stoReseau - energieReseauRestituee;
            const totalBilan = partSolaireDirecteMWh + energieSolaireRestituee + energieReseauRestituee + perteSolaire + perteReseau;

            const tbody = document.getElementById('bilan_energetique_body');
            tbody.innerHTML = `
                <tr><td>Énergie solaire Directe</td><td>${partSolaireDirecteMWh.toFixed(2)}</td></tr>
                <tr><td>Énergie solaire stockée</td><td>${partSolaireStockeeMWh.toFixed(2)}</td></tr>
                <tr><td>Énergie solaire restituée (Nette)</td><td>${energieSolaireRestituee.toFixed(2)}</td></tr>
                <tr><td>Perte d'énergie solaire</td><td>${perteSolaire.toFixed(2)}</td></tr>
                <tr><td>Perte Stockage réseau</td><td>${perteReseau.toFixed(2)}</td></tr>
                <tr style="font-weight:bold; background:#eee;"><td>TOTAL</td><td>${totalBilan.toFixed(2)}</td></tr>`;

            // Message d'erreur
            const errorMsg = document.getElementById('sto_error_msg');
            if (sumTaux > initialTauxAuto && initialTauxAuto > 0) {
                errorMsg.textContent = `Attention : Le nouveau taux combiné (${sumTaux}%) dépasse le taux initial (${initialTauxAuto}%).`;
            } else {
                errorMsg.textContent = '';
            }

            // Mise à jour du Chart
            const canvas = document.getElementById('storageChart');
            if (!canvas) return;
            
            if (storageChart) storageChart.destroy();
            storageChart = new Chart(canvas.getContext('2d'), {
                type: 'pie',
                data: {
                    labels: ['Énergie Réseau', 'Solaire Direct', 'Solaire Stocké'],
                    datasets: [{
                        data: [
                            parseFloat(stoReseau.toFixed(2)),
                            parseFloat(partSolaireDirecteMWh.toFixed(2)),
                            parseFloat(partSolaireStockeeMWh.toFixed(2))
                        ],
                        backgroundColor: ['#E1000F', '#FFC107', '#1E8449'],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' },
                        tooltip: {
                            callbacks: { label: (context) => context.label + ': ' + context.raw + ' MWh/an' }
                        }
                    }
                }
            });
        }