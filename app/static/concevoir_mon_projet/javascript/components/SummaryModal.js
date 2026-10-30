import { GET_PVGIS_DATA } from '../../API/API.js';
import * as CalculationUtils from './DrawingControl/utils/CalculationUtils.js';
import { CUSTOM_EVENTS, TYPE_COUVERTURE_MAP, PANEL_DIMENSIONS } from './DrawingControl/constants.js';
import * as TabsManager from './TabsManager.js';

class SummaryModal {
	constructor() {
		if (window.summaryModalInstance) {
			return window.summaryModalInstance;
		}

		this.createModal();
		this.isDragging = false;
		this.startX = 0;
		this.startY = 0;
		this.initialModalX = 0;
		this.initialModalY = 0;
		this.textStyle = 'margin: 0; padding: 0;';

		// Exposer l'instance globalement pour forçage externe
		window.summaryModalInstance = this;

		// Rafraîchir automatiquement quand des panneaux sont ajoutés/supprimés/mis à jour
		try {
            const eventsToListen = [
                CUSTOM_EVENTS.LAYOUT_UPDATED,
                CUSTOM_EVENTS.UPDATE_RESUME_CONTAINER,
                CUSTOM_EVENTS.SAVE_PAGE_DATA,
                CUSTOM_EVENTS.SHAPE_REMOVED
            ].filter(Boolean);

			eventsToListen.forEach((evtName) => {
				document.addEventListener(evtName, () => {
					// Actualisation systématique en arrière-plan pour garder le cache propre
					this.refreshFromStorage();
				});
			});
		} catch (_) {}
	}

	createModal() {
		const modal = document.createElement('div');
		modal.className = 'summary-modal';
		modal.style.cssText = `
            display: none;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            z-index: 10001;
            width: 90vw;
            max-width: 1600px;
            max-height: 90vh;
            overflow-y: auto;
            overflow-x: auto;
            text-align: center;
            cursor: move;
            user-select: none;
        `;

		// ---------- TITRE PRINCIPAL ----------
		const mainTitle = document.createElement('h2');
		mainTitle.textContent = 'Synthèse calepinage et géométrie';
		mainTitle.style.cssText = `
            color: white;
            background-color: #de0000;
            margin: -20px -20px 25px -20px;
            padding: 15px 20px;
            border-radius: 8px 8px 0 0;
            text-align: left;
            font-weight: bold;
            font-size: 1.5em;
            cursor: move;
            position: relative;
        `;
        
		// ---------- CROIX DE FERMETURE ----------
		const closeCross = document.createElement('span');
		closeCross.innerHTML = '&times;';
		closeCross.title = 'Fermer';
		closeCross.style.cssText = `
            position: absolute;
            top: 50%;
            right: 20px;
            transform: translateY(-50%);
            font-size: 28px;
            color: white;
            cursor: pointer;
            font-weight: bold;
            line-height: 1;
        `;
		closeCross.addEventListener('mouseenter', () => closeCross.style.opacity = '0.7');
		closeCross.addEventListener('mouseleave', () => closeCross.style.opacity = '1');
		closeCross.onclick = (e) => { e.stopPropagation(); this.hide(); };
		mainTitle.appendChild(closeCross);

		// ---------- AVERTISSEMENTS ----------
		const warningContainer = document.createElement('div');
		warningContainer.id = 'summary-warning-container';
		warningContainer.style.cssText = `
            color: #856404;
            background-color: #fff3cd;
            border: 1px solid #ffeeba;
            padding: 10px;
            margin: 0 0 20px 0;
            border-radius: 4px;
            text-align: left;
            display: none;
        `;

		// ---------- CONTROLES D'AFFICHAGE ----------
		const controlsContainer = document.createElement('div');
		controlsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
            margin-bottom: 15px;
            padding: 10px;
            background-color: #f8f9fa;
            border-radius: 6px;
            border: 1px solid #dee2e6;
            font-size: 14px;
        `;
		controlsContainer.innerHTML = `
            <span style="font-weight: bold; color: #333;">Gestion d’affichage des tableaux :</span>
            <div style="display: flex; flex-direction: row; align-items: center; gap: 20px; flex-wrap: nowrap;">
                <label style="cursor: pointer; display: flex; align-items: center; gap: 5px; margin: 0; white-space: nowrap;"><input type="checkbox" id="cb-tab3" checked> T-Système</label>
                <label style="cursor: pointer; display: flex; align-items: center; gap: 5px; margin: 0; white-space: nowrap;"><input type="checkbox" id="cb-tab1" checked> T-Calepinage</label>
                <label style="cursor: pointer; display: flex; align-items: center; gap: 5px; margin: 0; white-space: nowrap;"><input type="checkbox" id="cb-tab2" checked> T-Géométrie</label>
                <label style="cursor: pointer; display: flex; align-items: center; gap: 5px; margin: 0; white-space: nowrap;"><input type="checkbox" id="cb-tab4" checked> Paramètres Généraux de Production</label>
                <label style="cursor: pointer; display: flex; align-items: center; gap: 5px; margin: 0; white-space: nowrap;"><input type="checkbox" id="cb-tab5" checked> T-Maisons</label>
            </div>
        `;

		// ---------- TABLEAU 1 ----------
		const title1 = document.createElement('h3');
		title1.textContent = 'Tableau de synthèse de calepinage et productible';
		title1.style.cssText = `
            color: #333;
            margin-top: 25px;
            margin-bottom: 2px;
            padding-top: 8px;
            text-align: left;
            font-weight: bold;
            font-size: 1.1em;
            cursor: move;
        `;

		const tableContainer1 = document.createElement('div');
		tableContainer1.style.cssText = `
            width: 100%;
            overflow-x: auto;
            margin-bottom: 20px;
        `;

		const table1 = document.createElement('table');
		table1.style.cssText = `
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            word-wrap: break-word;
        `;

		const thead1 = document.createElement('thead');
        const theadStyle = "border: 1px solid #ddd; padding: 0.3em; background-color: #f5f5f5; height: 40px; font-weight: bold; text-align: center; "
        const headers1 = [
            "N° des sous champs",
            "Nombre de PV",
            "Disposition",
            "Mode de pose",
            "Sys. Int.",
            "Puissance PV (kWc)",
            "Production (MWh)",
            "Productible (kWh/kWc/an)"
        ];
		thead1.innerHTML = `
            <tr>
                ${headers1.map(header => `<th style="${theadStyle}">${header}</th>`).join('')}
            </tr>
        `;

		const tbody1 = document.createElement('tbody');
		tbody1.id = 'summary-table-body-1';

		table1.appendChild(thead1);
		table1.appendChild(tbody1);
		tableContainer1.appendChild(table1);

		// ---------- TABLEAU 2 ----------
		const title2 = document.createElement('h3');
		title2.textContent = 'Tableau de synthèse des dimensions et géométrie des champs PV';
		title2.style.cssText = `
            color: #333;
            margin-top: 0;
            margin-bottom: 2px;
            padding-top: 8px;
            text-align: left;
            font-weight: bold;
            font-size: 1.1em;
            cursor: move;
        `;

		const tableContainer2 = document.createElement('div');
		tableContainer2.style.cssText = `
            width: 100%;
            overflow-x: auto;
            margin-bottom: 20px;
        `;

		const table2 = document.createElement('table');
		table2.style.cssText = `
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            word-wrap: break-word;
        `;

		const thead2 = document.createElement('thead');
		const headers2 = [
            "N° des sous champs",
            "Inclinaison des panneaux (°)",
            "Azimut (°)",
            "Dimensions champ PV (Lxl, m)",
            "Surface des panneaux (m²)",
            "Surface projetée des panneaux (m²)"
        ];
		thead2.innerHTML = `
            <tr>
                ${headers2.map(header => `<th style="${theadStyle}">${header}</th>`).join('')}
            </tr>
        `;

		const tbody2 = document.createElement('tbody');
		tbody2.id = 'summary-table-body-2';

		table2.appendChild(thead2);
		table2.appendChild(tbody2);
		tableContainer2.appendChild(table2);

		// ---------- TABLEAU 3 ----------
		const title3 = document.createElement('h3');
		title3.textContent = 'Données système';
		title3.style.cssText = `
            color: #333;
            margin-top: 25px;
            margin-bottom: 2px;
            padding-top: 8px;
            text-align: left;
            font-weight: bold;
            font-size: 1.1em;
            cursor: move;
        `;

		const tableContainer3 = document.createElement('div');
		tableContainer3.style.cssText = `
            width: 100%;
            overflow-x: auto;
            margin-bottom: 20px;
        `;

		const table3 = document.createElement('table');
		table3.style.cssText = `
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            word-wrap: break-word;
        `;

		const thead3 = document.createElement('thead');
		const headers3 = [
            "N° des sous champs",
            "Centrale de production",
            "Inclinaison (°)",
            "Azimut (°)",
            "Type de montage",
            "Perte système (%)",
            "Puissance PV (kWc)",
            "Puissance onduleur (kVA)",
            "Ratio DC/AC",
            "Rendement onduleur (%)"
        ];
		thead3.innerHTML = `
            <tr>
                ${headers3.map(header => `<th style="${theadStyle}">${header}</th>`).join('')}
            </tr>
        `;

		const tbody3 = document.createElement('tbody');
		tbody3.id = 'summary-table-body-3';

		table3.appendChild(thead3);
		table3.appendChild(tbody3);
		tableContainer3.appendChild(table3);

		// CORRECTIF (demande explicite : "les dimensions des champs PV et les autres données
		// n'apparaissent pas dans le Summary modal pour les tableaux Données systèmes, synthèse de
		// calepinage, synthèse des dimensions") : ces 3 tableaux étaient masqués en projet
		// "Résidentielle" (.residential-hide-section, cf. ButtonControl.applyResidentialUIFiltering)
		// ET ne recevaient que les champs PRO. Ils sont désormais visibles quelle que soit la
		// typologie et reçoivent aussi les champs du calepinage résidentiel (cf. updateSummary).

		// ---------- TABLEAU 4 : PARAMÈTRES GÉNÉRAUX DE PRODUCTION ----------
		const title4 = document.createElement('h3');
		title4.textContent = 'Paramètres Généraux de Production';
		title4.style.cssText = `
            color: #333;
            margin-top: 25px;
            margin-bottom: 2px;
            padding-top: 8px;
            text-align: left;
            font-weight: bold;
            font-size: 1.1em;
            cursor: move;
        `;

		const tableContainer4 = document.createElement('div');
		tableContainer4.style.cssText = `
            width: 100%;
            overflow-x: auto;
            margin-bottom: 20px;
        `;

		const table4 = document.createElement('table');
		table4.style.cssText = `
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            word-wrap: break-word;
        `;

		const thead4 = document.createElement('thead');
		const headers4 = [
            "Cons. Auxiliaire Nuit/Jour (W) - Hors onduleurs",
            "Affectation prod. hors ACC (%)",
            "Coeff. Bifacialité (panneaux bifaciaux)",
            "Albédo du sol (panneaux bifaciaux)"
        ];
		thead4.innerHTML = `
            <tr>
                ${headers4.map(header => `<th style="${theadStyle}">${header}</th>`).join('')}
            </tr>
        `;

		// Récupérer d'éventuelles valeurs déjà sauvegardées pour ne pas perdre la saisie utilisateur
		let existingAuxCons = 3.5;
		// "Affectation prod. hors ACC" (ex "Pertes de transit réseau pour ACC", clé gridLossPercent
		// conservée) : part de la production retirée du partage ACC (calcul_acc.py), 0 % par défaut.
		let existingGridLoss = 0;
		let existingBifaciality = 0.8;
		let existingAlbedo = 0.2;
		try {
			const savedTotals = JSON.parse(localStorage.getItem('solarProjectData') || '{}').totals;
			if (savedTotals) {
				if (savedTotals.auxConsW !== undefined) existingAuxCons = savedTotals.auxConsW;
				if (savedTotals.gridLossPercent !== undefined) existingGridLoss = savedTotals.gridLossPercent;
				if (savedTotals.bifaciality !== undefined) existingBifaciality = savedTotals.bifaciality;
				if (savedTotals.albedo !== undefined) existingAlbedo = savedTotals.albedo;
			}
		} catch (_) {}

		const rowStyle4 = "border: 1px solid #ddd; padding: 0.3em; height: 40px; text-align: center; ";
		const inputStyle4 = "width: 100%; text-align: center; border: 1px solid #ccc; border-radius: 4px; padding: 4px; box-sizing: border-box;";
		const tbody4 = document.createElement('tbody');
		tbody4.innerHTML = `
            <tr>
                <td style="${rowStyle4}"><input type="number" id="summary-aux-cons" min="1" max="100000" step="0.1" value="${existingAuxCons}" style="${inputStyle4}"></td>
                <td style="${rowStyle4}"><input type="number" id="summary-grid-loss" min="0" max="15" step="0.1" value="${existingGridLoss}" style="${inputStyle4}"></td>
                <td style="${rowStyle4}"><input type="number" id="summary-bifaciality" min="0.7" max="0.9" step="0.01" value="${existingBifaciality}" style="${inputStyle4}"></td>
                <td style="${rowStyle4}"><input type="number" id="summary-albedo" min="0" max="1" step="0.01" value="${existingAlbedo}" style="${inputStyle4}"></td>
            </tr>
        `;

		table4.appendChild(thead4);
		table4.appendChild(tbody4);
		tableContainer4.appendChild(table4);

		// ---------- TABLEAU 5 : MAISONS (calepinage "toiture multi-typologie") ----------
		// NOUVEAU (bug rapporté : "le modal Système s'ouvre mais ne collecte pas les données de
		// calepinage de maison") : ce module reste volontairement indépendant du calepinage
		// rectangulaire/polygonale/shed (pas de shapes/formData dans solarProjectData, cf. analyse de
		// faisabilité) — ses données alimentaient déjà calculatedPvs (donc le calcul de production),
		// mais n'apparaissaient nulle part à l'écran, d'où l'impression de rien "collecté". Table
		// dédiée, construite à partir de window.CalepinageMaisonIndiv.getAllPvFieldSummaries() (cf.
		// updateSummary), plutôt que de forcer ces données dans les tableaux 1/2/3 (colonnes
		// spécifiques au calepinage rectangulaire — dispositions L x C, dimensions de toiture par
		// pente... — qui n'ont pas de sens pour un pan de toiture libre).
		const title5 = document.createElement('h3');
		title5.textContent = 'Maisons (calepinage toiture multi-typologie)';
		title5.style.cssText = `
            color: #333;
            margin-top: 25px;
            margin-bottom: 2px;
            padding-top: 8px;
            text-align: left;
            font-weight: bold;
            font-size: 1.1em;
            cursor: move;
        `;

		const tableContainer5 = document.createElement('div');
		tableContainer5.style.cssText = `
            width: 100%;
            overflow-x: auto;
            margin-bottom: 20px;
        `;

		const table5 = document.createElement('table');
		table5.style.cssText = `
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            word-wrap: break-word;
        `;

		const thead5 = document.createElement('thead');
		const headers5 = [
            "Pan de toiture",
            "Inclinaison (°)",
            "Azimut (°)",
            "Type de montage",
            "Puissance PV (kWc)",
            "Perte système (%)",
            "Puissance onduleur (kVA)",
            "Rendement onduleur (%)",
            "Conso. onduleur (W)",
            "Référence panneau",
            "Affectation centrale"
        ];
		thead5.innerHTML = `
            <tr>
                ${headers5.map(header => `<th style="${theadStyle}">${header}</th>`).join('')}
            </tr>
        `;

		const tbody5 = document.createElement('tbody');
		tbody5.id = 'summary-table-body-5';

		table5.appendChild(thead5);
		table5.appendChild(tbody5);
		tableContainer5.appendChild(table5);

		// Ajouter les écouteurs d'événements pour le déplacement
		mainTitle.addEventListener('mousedown', (e) => this.startDrag(e));
		title1.addEventListener('mousedown', (e) => this.startDrag(e));
		title2.addEventListener('mousedown', (e) => this.startDrag(e));
		title3.addEventListener('mousedown', (e) => this.startDrag(e));
		title4.addEventListener('mousedown', (e) => this.startDrag(e));
		title5.addEventListener('mousedown', (e) => this.startDrag(e));
		modal.addEventListener('mousedown', (e) => this.startDrag(e));

		// Utiliser bind pour préserver le contexte this
		document.addEventListener('mousemove', this.drag.bind(this));
		document.addEventListener('mouseup', this.endDrag.bind(this));

		// Création de la zone de texte sous la table
		const textArea = document.createElement('div');
		textArea.id = 'summary-text-area';
		textArea.style.cssText = `
            width: 100%;
            height: fit-content;
            margin-top: 20px;
            display:flex;
            flex-direction: column;
            align-items: start;
            justify-content: start;
        `;
		textArea.innerHTML = `
            <p style="${this.textStyle}">
                Fabricant des panneaux : xxx
            </p>
            <p style="${this.textStyle}">
                Référence des panneaux : xxx
            </p>
            <p style="${this.textStyle}">
                Puissance unitaire des panneaux : xxx
            </p>
            <p style="${this.textStyle}">
                Dimensions du champ PV considérées entre extrémités des panneaux
            </p>
        `;

		// Ajouter un bouton pour fermer la modale
		const button = document.createElement('button');
		button.textContent = 'Fermer';
		button.style.cssText = `
            background-color: #DE0000;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.3s;
        `;
		button.addEventListener('mouseenter', () => {
			button.style.opacity = '0.7';
		});
		button.addEventListener('mouseleave', () => {
			button.style.opacity = '1';
		});
		button.onclick = () => this.hide();

		modal.appendChild(mainTitle);
		modal.appendChild(warningContainer);
		modal.appendChild(controlsContainer);

		// Tableau "Données système" + bouton "Configuration des chaînes et perte système" en
		// PREMIER (à la place du tableau de synthèse de calepinage/productible, cf. finitions
		// demandées) : table1/table2 gardent leur ordre relatif, juste déplacés après table3.
		// NOUVEAU (demande explicite) : titre + bouton alignés sur la MÊME ligne (auparavant deux
		// blocs empilés verticalement) — regroupés dans une rangée flex commune, bouton à GAUCHE
		// (demande explicite) donc placé en premier avec justify-content: flex-start plutôt que
		// space-between (qui le poussait à droite).
		const title3Row = document.createElement('div');
		title3Row.style.cssText = `display: flex; align-items: center; justify-content: flex-start; flex-wrap: wrap; gap: 12px; margin-top: 25px; margin-bottom: 10px; width: 100%; box-sizing: border-box;`;
		title3.style.marginTop = '0';
		title3.style.marginBottom = '0';

		// Bouton unique "Configuration des chaînes et perte système" pour tout le système (plus de
		// bouton par ligne PV) : ouvre une modale couvrant l'ensemble des champs PV du projet,
		// câblée dans updateSummary() une fois la liste des champs connue. Fond jaune doré/texte
		// blanc pour le distinguer visuellement des autres actions (demande explicite).
		// NOTE : width/margin explicites en override d'une règle globale ".btn" (Entete.css) qui
		// impose width:27.5%/margin-left:10%/margin-right:10% à TOUS les boutons Bootstrap .btn du
		// site — sans cet override, ce bouton apparaît décalé/mal dimensionné malgré l'ordre DOM.
		const chainesPertesToolbar = document.createElement('div');
		chainesPertesToolbar.style.cssText = `text-align: left; flex: 0 0 auto;`;
		chainesPertesToolbar.innerHTML = `<button type="button" id="summary-chaines-pertes-btn" class="btn btn-sm" style="white-space: nowrap; background-color: #eab308; border-color: #ca8a04; color: #ffffff; width: auto; margin: 0;" title="Calculer le dimensionnement des chaînes et les pertes système détaillées pour l'ensemble des champs PV du projet"><i class="fas fa-bolt"></i> Configuration des chaînes et perte système</button>`;
		title3Row.appendChild(title3);
		title3Row.appendChild(chainesPertesToolbar);

		modal.appendChild(title3Row);
		modal.appendChild(tableContainer3);

		modal.appendChild(title1);
		modal.appendChild(tableContainer1);
		modal.appendChild(title2);
		modal.appendChild(tableContainer2);
		modal.appendChild(title5);
		modal.appendChild(tableContainer5);
		modal.appendChild(title4);
		modal.appendChild(tableContainer4);
		modal.appendChild(textArea);
		modal.appendChild(button);

		// Ajouter la logique de visibilité des tableaux
		const cbTab1 = controlsContainer.querySelector('#cb-tab1');
		const cbTab2 = controlsContainer.querySelector('#cb-tab2');
		const cbTab3 = controlsContainer.querySelector('#cb-tab3');
		const cbTab4 = controlsContainer.querySelector('#cb-tab4');
		const cbTab5 = controlsContainer.querySelector('#cb-tab5');

		cbTab1.addEventListener('change', (e) => {
			title1.style.display = e.target.checked ? 'block' : 'none';
			tableContainer1.style.display = e.target.checked ? 'block' : 'none';
		});
		cbTab2.addEventListener('change', (e) => {
			title2.style.display = e.target.checked ? 'block' : 'none';
			tableContainer2.style.display = e.target.checked ? 'block' : 'none';
		});
		cbTab3.addEventListener('change', (e) => {
			title3.style.display = e.target.checked ? 'block' : 'none';
			tableContainer3.style.display = e.target.checked ? 'block' : 'none';
		});
		cbTab4.addEventListener('change', (e) => {
			title4.style.display = e.target.checked ? 'block' : 'none';
			tableContainer4.style.display = e.target.checked ? 'block' : 'none';
		});
		cbTab5.addEventListener('change', (e) => {
			title5.style.display = e.target.checked ? 'block' : 'none';
			tableContainer5.style.display = e.target.checked ? 'block' : 'none';
		});

		// Applique immédiatement le filtrage résidentiel (cf. .residential-hide-section ci-dessus) à
		// la construction de ce modal, pour le projet actif au chargement de la page — la même
		// fonction est réappelée par selectAndLoadProject() (parametreProjetFormManager.js) si le
		// projet actif change sans rechargement de page.
		if (typeof window.applyResidentialUIFiltering === 'function') {
			window.applyResidentialUIFiltering();
		}

		// ---------- Validation & sauvegarde instantanée des paramètres généraux de production ----------
		const auxConsInput = tbody4.querySelector('#summary-aux-cons');
		const gridLossInput = tbody4.querySelector('#summary-grid-loss');
		const bifacialityInput = tbody4.querySelector('#summary-bifaciality');
		const albedoInput = tbody4.querySelector('#summary-albedo');
		auxConsInput.dataset.lastValid = auxConsInput.value;
		gridLossInput.dataset.lastValid = gridLossInput.value;
		bifacialityInput.dataset.lastValid = bifacialityInput.value;
		albedoInput.dataset.lastValid = albedoInput.value;

		const persistGeneralProductionParams = () => {
			try {
				const saved = localStorage.getItem('solarProjectData');
				if (!saved) return;
				const projectData = JSON.parse(saved);
				if (!projectData.totals) projectData.totals = {};
				projectData.totals.auxConsW = parseFloat(auxConsInput.value) || 0;
				projectData.totals.gridLossPercent = parseFloat(gridLossInput.value) || 0;
				projectData.totals.bifaciality = parseFloat(bifacialityInput.value) || 0;
				projectData.totals.albedo = parseFloat(albedoInput.value) || 0;
				localStorage.setItem('solarProjectData', JSON.stringify(projectData));
				document.dispatchEvent(new CustomEvent('solarProjectDataSaved', { detail: { totals: projectData.totals } }));
			} catch (error) {
				console.error('Erreur lors de la sauvegarde des paramètres généraux de production:', error);
			}
		};

		auxConsInput.addEventListener('change', () => {
			const val = parseFloat(auxConsInput.value);
			if (auxConsInput.value === '' || isNaN(val) || val < 1 || val > 100000) {
				if (typeof window.showValidationAlert === 'function') {
					window.showValidationAlert('La consommation auxiliaire doit être comprise entre 1 et 100 000 W.', auxConsInput);
				}
				auxConsInput.value = auxConsInput.dataset.lastValid;
				return;
			}
			auxConsInput.dataset.lastValid = auxConsInput.value;
			persistGeneralProductionParams();
		});

		gridLossInput.addEventListener('change', () => {
			const val = parseFloat(gridLossInput.value);
			if (gridLossInput.value === '' || isNaN(val) || val < 0 || val > 15) {
				if (typeof window.showValidationAlert === 'function') {
					window.showValidationAlert("L'affectation de la production hors ACC doit être comprise entre 0 % et 15 %.", gridLossInput);
				}
				gridLossInput.value = gridLossInput.dataset.lastValid;
				return;
			}
			gridLossInput.dataset.lastValid = gridLossInput.value;
			persistGeneralProductionParams();
		});

		bifacialityInput.addEventListener('change', () => {
			const val = parseFloat(bifacialityInput.value);
			if (bifacialityInput.value === '' || isNaN(val) || val < 0.7 || val > 0.9) {
				if (typeof window.showValidationAlert === 'function') {
					window.showValidationAlert('Le coefficient de bifacialité doit être compris entre 0.7 et 0.9.', bifacialityInput);
				}
				bifacialityInput.value = bifacialityInput.dataset.lastValid;
				return;
			}
			bifacialityInput.dataset.lastValid = bifacialityInput.value;
			persistGeneralProductionParams();
		});

		albedoInput.addEventListener('change', () => {
			const val = parseFloat(albedoInput.value);
			if (albedoInput.value === '' || isNaN(val) || val < 0 || val > 1) {
				if (typeof window.showValidationAlert === 'function') {
					window.showValidationAlert('L\'albédo du sol doit être compris entre 0 et 1.', albedoInput);
				}
				albedoInput.value = albedoInput.dataset.lastValid;
				return;
			}
			albedoInput.dataset.lastValid = albedoInput.value;
			persistGeneralProductionParams();
		});

		document.body.appendChild(modal);

		this.modal = modal;
		this.tbody1 = tbody1;
		this.table1 = table1;
		this.tbody2 = tbody2;
		this.table2 = table2;
		this.tbody3 = tbody3;
		this.table3 = table3;
		this.table4 = table4;
		this.tbody5 = tbody5;
		this.table5 = table5;
		this.auxConsInput = auxConsInput;
		this.gridLossInput = gridLossInput;
		this.bifacialityInput = bifacialityInput;
		this.albedoInput = albedoInput;
	}

	startDrag(e) {
		if (e.target.tagName === 'BUTTON') return;

		if (e.target === this.modal || e.target.tagName === 'H3' || e.target.tagName === 'H2') {
			this.isDragging = true;

			// Sauvegarder la position initiale du clic
			this.startX = e.clientX;
			this.startY = e.clientY;

			// Sauvegarder la position initiale de la modal
			const rect = this.modal.getBoundingClientRect();
			this.initialModalX = rect.left;
			this.initialModalY = rect.top;

			// Convertir en position absolue si ce n'est pas déjà fait
			if (this.modal.style.transform.includes('-50%')) {
				this.modal.style.transform = 'none';
				this.modal.style.top = rect.top + 'px';
				this.modal.style.left = rect.left + 'px';
			}
		}
	}

	drag(e) {
		if (!this.isDragging) return;

		e.preventDefault();

		// Calculer le déplacement depuis la position initiale du clic
		const deltaX = e.clientX - this.startX;
		const deltaY = e.clientY - this.startY;

		// Appliquer le déplacement à partir de la position initiale de la modal
        this.modal.style.left = (this.initialModalX + deltaX) + 'px';
        this.modal.style.top = (this.initialModalY + deltaY) + 'px';
	}

	endDrag() {
		this.isDragging = false;
	}

	/**
	 * Actualise les données à partir du localStorage (arrière-plan)
	 */
	refreshFromStorage() {
		try {
			const savedData = localStorage.getItem('solarProjectData');
			if (savedData) {
				const data = JSON.parse(savedData);
				this.updateSummary(data);
			}
		} catch (error) {
			console.error('Erreur lors du rafraîchissement de SummaryModal:', error);
		}
	}

	/**
	 * Force une sauvegarde puis un recalcul (appelable depuis l'extérieur)
	 */
	async forceUpdate() {
		try {
			if (window.storageManager && typeof window.storageManager.savePageData === 'function') {
				await window.storageManager.savePageData();
			}
			this.refreshFromStorage();
		} catch (error) {
			console.error('Erreur lors du forçage de la mise à jour SummaryModal:', error);
		}
	}

	/**
	 * @param {{ silent?: boolean }} [options] - silent:true exécute tout le calcul/la soumission des
	 *   données système (getSolarDataForMultiplePvIds + updateSummary(), qui persiste les totaux dans
	 *   localStorage.solarProjectData — payload lu ensuite par la page Production) SANS jamais ouvrir
	 *   la modale de synthèse (aucun appel à this.show()), y compris sur ses branches d'erreur.
	 *   CORRECTIF (demande explicite : automatiser la soumission "Système" avant "Calculer et
	 *   visualiser" SANS ouvrir sa modale) : remplace le contournement précédent (ButtonControl.js
	 *   appelait showSummary() — qui ouvre la modale — puis hide() juste après) par un vrai mode
	 *   silencieux, sans flash d'affichage ni dépendance au timing d'une éventuelle animation
	 *   d'ouverture/fermeture.
	 */
	async showSummary(options = {}) {
		const silent = options.silent === true;
		try {
			let data;

			// Cas 1 : Sur model_form.html avec storageManager
			if (window.storageManager) {
				// Sauvegarder l'état actuel
				await window.storageManager.savePageData();

				// Attendre un court instant pour s'assurer que la sauvegarde est terminée
                await new Promise(resolve => setTimeout(resolve, 150));
			}

			// Dans tous les cas, essayer de récupérer les données du localStorage
			let savedData = localStorage.getItem('solarProjectData');

			function getSolarDataForMultiplePvIds(hash) {
				return new Promise((resolve) => {
					const localdata = JSON.parse(hash);
					const pvIds = Object.keys(localdata.formData || {});

					// CORRECTIF (bug rapporté : "je clique sur Système/Calculer, rien ne se passe" —
					// pour un projet composé UNIQUEMENT de maisons du calepinage "toiture
					// multi-typologie", qui n'écrit jamais dans solarProjectData.formData) : avec
					// pvIds vide, la boucle plus bas ne demande aucune donnée solaire à aucun pvId,
					// donc l'évènement SOLAR_DATA_BATCH_UPDATED qui ferait avancer `completed` ne se
					// déclenche jamais — cette promesse restait indéfiniment en attente, bloquant tout
					// le reste de showSummary() derrière son `await`.
					if (pvIds.length === 0) { resolve(); return; }

					let completed = 0;

					const handler = (e) => {
						completed += e.detail.results.length;
						if (completed >= pvIds.length) {
							document.removeEventListener(CUSTOM_EVENTS.SOLAR_DATA_BATCH_UPDATED, handler);
							resolve();
						}
					};

					document.addEventListener(CUSTOM_EVENTS.SOLAR_DATA_BATCH_UPDATED, handler);

					Object.entries(localdata.formData).forEach(([pvId, formValues]) => {
						window.tabManager.getSolarData(pvId, localdata.shapes[pvId].center);
					});
				});
			}

			await getSolarDataForMultiplePvIds(savedData);
			// Production des champs PV du calepinage résidentiel : même interrogation PVGIS que pour
			// les champs PRO ci-dessus (window.tabManager.getSolarData), mais ces champs n'ont ni
			// onglet ni entrée dans solarProjectData.shapes — l'appel est donc fait ici, à partir de
			// leur propre résumé (puissance, pente, azimut, pertes, type de montage) et de leur
			// position sur la carte. Sans cela, les colonnes Production/Productible de ces lignes
			// restaient vides.
			// Perte d'ombrage entre sheds des petits champs au sol, recalculée si absente ou
			// périmée : elle entre dans la perte envoyée à PVGIS par getAllPvFieldSummaries.
			try {
				const sheds = window.CalepinageMaisonShedsActions;
				if (sheds && typeof sheds.actualiserOmbragesProduction === 'function') await sheds.actualiserOmbragesProduction();
			} catch (e) {
				console.warn('Ombrage entre sheds indisponible pour la production', e);
			}
			await this.chargerProductionChampsMaison();
			savedData = localStorage.getItem('solarProjectData');

			if (!savedData) {
				if (!silent) this.show('Aucune donnée disponible, veuillez sauvegarder votre calepinage !');
				return;
			}

			try {
				data = JSON.parse(savedData);

				// CORRECTIF (bug rapporté : "le summary modal ne reçoit aucune donnée" pour un projet
				// composé uniquement de maisons du calepinage "toiture multi-typologie") : ce module
				// n'écrit jamais dans solarProjectData.shapes (indépendant par conception, cf. analyse
				// de faisabilité) — data.shapes reste donc vide même quand des maisons existent bel et
				// bien, avec des panneaux à calculer. Sans ce test, le garde-fou ci-dessous empêchait
				// TOUJOURS d'atteindre updateSummary(data) (et donc le hook
				// CalepinageMaisonIndiv.getAllPvFieldSummaries() qu'il contient) dès qu'aucune forme
				// rectangulaire/polygonale/shed n'était dessinée.
				const hasMaisonData = window.CalepinageMaisonIndiv &&
					typeof window.CalepinageMaisonIndiv.getAllPvFieldSummaries === 'function' &&
					window.CalepinageMaisonIndiv.getAllPvFieldSummaries().length > 0;

				if ((!data.shapes || Object.keys(data.shapes).length === 0) && !hasMaisonData) {
					const oldTfoot1 = this.table1.querySelector('tfoot');
					if (oldTfoot1) oldTfoot1.remove();
					const oldTfoot2 = this.table2.querySelector('tfoot');
					if (oldTfoot2) oldTfoot2.remove();

					if (!silent) this.show('Aucun calepinage trouvé, commencez par dessiner des zones de panneaux solaires !');
					return;
				}
				this.updateSummary(data);
				if (!silent) this.show();
			} catch (error) {
				console.error('Erreur lors du parsing des données:', error);
				if (!silent) this.show('Erreur lors du chargement des données');
			}
		} catch (error) {
            console.error('Erreur lors de l\'affichage du résumé:', error);
			if (!silent) this.show('Une erreur est survenue');
		}
	}

	/**
	 * Interroge PVGIS pour chaque champ PV du calepinage résidentiel et range le résultat dans
	 * `solarProjectData.solarDataMaison`, indexé par identifiant de sous-champ (`PV1_Pan1`).
	 *
	 * Clé distincte de `solarData` (indexée par pvId PRO) VOLONTAIREMENT : les deux numérotations
	 * sont indépendantes, un projet peut contenir un champ PRO "PV1" et un champ résidentiel "PV1",
	 * et les écraser l'un l'autre fausserait les deux. L'identifiant de sous-champ, lui, ne peut pas
	 * entrer en collision avec un pvId.
	 *
	 * Le résultat est mis en cache sur les paramètres de l'appel : rouvrir le modal sans rien changer
	 * ne relance aucune requête. Un échec réseau laisse simplement la ligne sans production — jamais
	 * d'exception qui empêcherait le reste du résumé de s'afficher.
	 */
	async chargerProductionChampsMaison() {
		this._productionMaisons = this._productionMaisons || {};
		this._cacheProductionMaisons = this._cacheProductionMaisons || {};

		const CM = window.CalepinageMaisonIndiv;
		if (!CM || typeof CM.getAllPvFieldSummaries !== 'function') return;
		const summaries = CM.getAllPvFieldSummaries();
		if (!summaries.length) return;

		// Position de chaque champ sur la carte (lat/lng), seule donnée qui ne soit pas déjà dans le
		// résumé par pan.
		const origines = new Map();
		if (typeof CM.listerChampsCarte === 'function') {
			CM.listerChampsCarte().forEach((c) => {
				const lat = typeof c.origin?.lat === 'function' ? c.origin.lat() : c.origin?.lat;
				const lng = typeof c.origin?.lng === 'function' ? c.origin.lng() : c.origin?.lng;
				if (typeof lat === 'number' && typeof lng === 'number') origines.set(c.sourceId, { lat, lng });
			});
		}

		await Promise.all(summaries.map(async (p) => {
			const origine = origines.get(p.sourceId);
			const puissance = Number(p.peakPower) || 0;
			if (!origine || puissance <= 0) return;
			const cle = [p.id, origine.lat.toFixed(5), origine.lng.toFixed(5), puissance.toFixed(3),
				p.mount, Number(p.loss) || 0, Number(p.tilt) || 0, Number(p.azimuth) || 0].join('|');
			if (this._cacheProductionMaisons[cle]) {
				this._productionMaisons[p.id] = this._cacheProductionMaisons[cle];
				return;
			}
			try {
				const solarData = await GET_PVGIS_DATA(origine.lat, origine.lng, puissance,
					p.mount, Number(p.loss) || 0, Number(p.tilt) || 0, Number(p.azimuth) || 0);
				this._cacheProductionMaisons[cle] = solarData;
				this._productionMaisons[p.id] = solarData;
			} catch (e) {
				console.warn(`PVGIS indisponible pour le champ résidentiel ${p.id}`, e);
			}
		}));

		// Persisté pour les autres lecteurs (résumé de la barre d'outils, cf. resuméCalepinage.js),
		// qui ne peuvent pas relancer ces appels eux-mêmes.
		try {
			const brut = localStorage.getItem('solarProjectData');
			const projet = brut ? JSON.parse(brut) : {};
			projet.solarDataMaison = this._productionMaisons;
			localStorage.setItem('solarProjectData', JSON.stringify(projet));
		} catch (e) {
			// Quota/stockage indisponible : le modal reste juste, seul le résumé de la barre
			// d'outils affichera 0 pour la production.
		}
	}

	updateSummary(data) {
		const tbody1 = this.tbody1;
		const tbody2 = this.tbody2;
		const tbody3 = this.tbody3;
		const tbody5 = this.tbody5;
		tbody1.innerHTML = '';
		tbody2.innerHTML = '';
		tbody3.innerHTML = '';
		if (tbody5) tbody5.innerHTML = '';

		let totalPanels = 0;
		let totalPower = 0;
		let totalProductibleMwh = 0;
		let totalProductibleKwhPv = 0;
		let totalPvIds = [];
		let totalSurface = 0;
		let totalSurfaceProjetee = 0;
		let totalMoyenneProductibleKwh = [];
		let warnings = [];
		let totalPuissanceOnduleur = 0;
		let totalRatiosDcAc = [];
		let totalRendementsOnduleur = [];
		let totalConsoOnduleur = 0;
		let calculatedPvs = [];
		let pvFieldsForChainesPertes = [];

		// Champs PV du calepinage résidentiel : module indépendant, il n'écrit jamais dans
		// solarProjectData (shapes/formData/solarData) — d'où des tableaux vides pour un projet qui
		// n'a QUE ce type de champs. Récupérés ici pour (a) ne pas sortir prématurément ci-dessous,
		// (b) alimenter les tableaux 1 à 3 après la boucle sur les champs PRO.
		const maisonSummaries = (window.CalepinageMaisonIndiv
			&& typeof window.CalepinageMaisonIndiv.getAllPvFieldSummaries === 'function')
			? window.CalepinageMaisonIndiv.getAllPvFieldSummaries() : [];

		// Vérifier si les données sont valides
		if (!data || ((!data.formData || !data.solarData || !data.shapes) && maisonSummaries.length === 0)) {
			const msg = 'Aucune donnée disponible, veuillez sauvegarder votre calepinage !';
			this.tbody1.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; height: 60px;">${msg}</td></tr>`;
			this.tbody2.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; height: 60px;">${msg}</td></tr>`;
			this.tbody3.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 20px; height: 60px;">${msg}</td></tr>`;
			return;
		}
		// Conteneurs absents (projet 100 % résidentiel) : traités comme vides, toute la suite lit
		// data.formData / data.shapes / data.solarData sans avoir à se garder à chaque accès.
		if (!data.formData) data.formData = {};
		if (!data.solarData) data.solarData = {};
		if (!data.shapes) data.shapes = {};

		const hasPolygon = Object.values(data.shapes).some(shape => shape.type === 'drawingControl.Polygon' || shape.type === 'POLYGON' || shape.shedsCapable);
		const theadStyle = "border: 1px solid #ddd; padding: 0.3em; background-color: #f5f5f5; height: 40px; font-weight: bold; text-align: center; ";
		
		const headers1 = [
		    "N° des sous champs",
		    "Nombre de PV",
		    hasPolygon ? null : "Disposition",
		    "Mode de pose",
		    "Sys. Int.",
		    "Puissance PV (kWc)",
		    "Production (MWh)",
		    "Productible (kWh/kWc/an)"
		].filter(Boolean);
		const thead1 = this.table1.querySelector('thead');
		if (thead1) thead1.innerHTML = `<tr>${headers1.map(h => `<th style="${theadStyle}">${h}</th>`).join('')}</tr>`;

		const headers2 = [
		    "N° des sous champs",
		    "Inclinaison des panneaux (°)",
		    "Azimut (°)",
		    hasPolygon ? null : "Dimensions toiture (m)",
		    hasPolygon ? null : "Dimensions champ PV (Lxl, m)",
		    "Surface des panneaux (m²)",
		    "Surface projetée des panneaux (m²)"
		].filter(Boolean);
		const thead2 = this.table2.querySelector('thead');
		if (thead2) thead2.innerHTML = `<tr>${headers2.map(h => `<th style="${theadStyle}">${h}</th>`).join('')}</tr>`;

		// Parcourir les données pour chaque PV
		Object.entries(data.formData).forEach(([pvId, formValues]) => {
			// Récupérer les données d'ensoleillement
			const solarData = data.solarData?.[pvId];
			if (!solarData) return;

			// Calculer les valeurs
			const panelPower = Number(formValues.puissancePanneau) || 0;
			let totalPanelCount = 0;
			
			// Ne calculer le nombre de panneaux que si le panneau est configuré
			if (panelPower > 0) {
			    totalPanelCount = CalculationUtils.getAccuratePanelCount(pvId, data);
			}
			
			// Sécurité anti-valeurs aberrantes
			if (isNaN(totalPanelCount) || !isFinite(totalPanelCount) || totalPanelCount > 100000) {
			    totalPanelCount = 0;
			}
			
			const referenceSI = formValues.referenceSI;

			let totalPanelLength = data.shapes[pvId].gridInfo?.totalPanelLength || 0;
			let totalPanelWidth = data.shapes[pvId].gridInfo?.totalPanelWidth || 0;

			let globalNumCols = data.shapes[pvId].gridInfo?.numCols || 0;
			let globalNumRows = data.shapes[pvId].gridInfo?.numRows || 0;
			
			if (globalNumCols === 0 && globalNumRows === 0) {
				const domCols = document.querySelector(`#nbColonne-${pvId}`);
				const domRows = document.querySelector(`#nbLigne-${pvId}`);
				if (domCols) globalNumCols = parseInt(domCols.value) || 0;
				if (domRows) globalNumRows = parseInt(domRows.value) || 0;
			}

			// BUG 2 FIX : Récupération des dimensions si elles ne sont pas dans gridInfo (Cas Solar Rectangle)
			if (!totalPanelLength || !totalPanelWidth) {
			    if (data.shapes[pvId].dimensions && data.shapes[pvId].dimensions.length > 0 && data.shapes[pvId].dimensions.width > 0) {
			        totalPanelLength = data.shapes[pvId].dimensions.length;
			        totalPanelWidth = data.shapes[pvId].dimensions.width;
			    } else {
			        const domLen = document.querySelector(`#dimensionsChampPVlongueur-${pvId}`);
			        const domWid = document.querySelector(`#dimensionsChampPVlargeur-${pvId}`);
			        if (domLen && domWid && parseFloat(domLen.value) > 0 && parseFloat(domWid.value) > 0) {
			            totalPanelLength = parseFloat(domLen.dataset.baseValue || domLen.value);
			            totalPanelWidth = parseFloat(domWid.dataset.baseValue || domWid.value);
			        }
			    }
			}

			// NOUVEAU FIX 1 : Calcul STRICT des dimensions réelles basées sur la disposition (Lignes x Colonnes)
			const typeDeStructure = formValues.typeDeStructure || formValues.type_de_structure || formValues.typeCouverture;
			let spacingX = (Number(formValues.espacementPanneauxX) || 0) / 1000;
			let spacingY = (Number(formValues.espacementPanneauxY) || 0) / 1000;
			let dX = 0, dY = 0;

			if (typeDeStructure && referenceSI && TYPE_COUVERTURE_MAP && TYPE_COUVERTURE_MAP[typeDeStructure]) {
			    const siData = TYPE_COUVERTURE_MAP[typeDeStructure].find(s => s.id === referenceSI);
			    if (siData) {
			        dX = parseFloat(siData.dX || 0) / 1000;
			        dY = parseFloat(siData.dY || 0) / 1000;
			        if (siData.x !== undefined && !isNaN(parseFloat(siData.x))) spacingX = parseFloat(siData.x) / 1000;
			        if (siData.y !== undefined && !isNaN(parseFloat(siData.y))) spacingY = parseFloat(siData.y) / 1000;
			    }
			}

			let panelLenMm = Number(formValues.longueurPanneau) || 2000;
			let panelWidMm = Number(formValues.largeurPanneau) || 1000;
			
			if (formValues.dimensionsPanneaux && formValues.dimensionsPanneaux !== 'custom' && formValues.dimensionsPanneaux !== 'Autres_dimensions') {
			    const parts = String(formValues.dimensionsPanneaux).replace(/mm/gi, '').split('x').map(p => p.trim());
			    if (parts.length >= 2) {
			        panelLenMm = Number(parts[0]) || panelLenMm;
			        panelWidMm = Number(parts[1]) || panelWidMm;
			    }
			}

			const isPortrait = formValues.modePose !== 'paysage';
			let effectivePanelLen = isPortrait ? (panelLenMm / 1000) : (panelWidMm / 1000);
			let effectivePanelWid = isPortrait ? (panelWidMm / 1000) : (panelLenMm / 1000);

			// Découpage par sous-champs selon la géométrie (Monopente, Bipente, Multipente)
			const panelCountByPan = CalculationUtils.getPanelCountByPan(pvId, data);
			const subFields = CalculationUtils.getSubFieldsData(pvId, formValues, panelCountByPan);
			const gridSizeByPan = CalculationUtils.getGridSizeByPan(pvId);

			subFields.forEach(subField => {
			    const subPvId = subField.subPvId;
			    const subPanelCount = subField.panelCount;

			    const totalPvPower = CalculationUtils.calculatePuissancePVKwc(subPanelCount, panelPower);
			    
			    let prodTotale = 0;
			    if (solarData.pans && solarData.pans[subField.panIndex] && solarData.pans[subField.panIndex].annuel?.productionTotale !== undefined) {
			        prodTotale = Number(solarData.pans[subField.panIndex].annuel.productionTotale);
			    } else if (solarData.annuel?.productionTotale !== undefined) {
			        const totalPanelsForCalc = totalPanelCount || 1;
			        prodTotale = Number(solarData.annuel.productionTotale) * (subPanelCount / totalPanelsForCalc);
			    }

			    const productibleMwh = CalculationUtils.convertKWhToMWh(prodTotale) / 1000;
			    const productibleKwhPv = totalPvPower > 0 ? CalculationUtils.calculateProductibleKwhKwc(productibleMwh, totalPvPower) : 0;
			    
			    const inclinaison = subField.tilt;
			    const azimuth = subField.azimuth;

			    let currentNumRows = globalNumRows;
			    let currentNumCols = globalNumCols;

			    // Demande explicite : pour une toiture à plusieurs pans (Bipente/Multipente), la
			    // Disposition de CHAQUE pan doit refléter le nombre de lignes réellement placées sur
			    // CE pan (ex: dessin 10L x 30C -> 5L x 30C par pan pour un Bipente, /4 pour un
			    // Multipente) — le nombre de colonnes reste inchangé. On utilise en priorité la VRAIE
			    // disposition par pan (gridSizeByPan, posée par calepinage_rectangulaire.js sur les
			    // panneaux réellement dessinés) : #nbLigne/#nbColonne globaux valent artificiellement
			    // 1 x <total panneaux> pour ce moteur dès qu'il y a plusieurs pans, donc diviser "1"
			    // par le nombre de pans ne donnait jamais le bon résultat.
			    const realGridForPan = gridSizeByPan[subField.panIndex];
			    if (realGridForPan) {
			        currentNumRows = realGridForPan.numRows;
			        currentNumCols = realGridForPan.numCols;
			    } else if (subFields.length > 1) {
			        currentNumRows = globalNumRows > 0 ? Math.round(globalNumRows / subFields.length) : globalNumRows;
			    } else if (currentNumRows > 0 && currentNumCols > 0 && subPanelCount > 0 && (currentNumRows * currentNumCols) !== subPanelCount) {
			        // BUG 1 FIX (Monopente uniquement) : GARDE-FOU - Cohérence Nombre de PV et
			        // Disposition quand le dessin et le comptage réel divergent (ex: panneaux
			        // supprimés individuellement).
			        if (currentNumCols > 0 && subPanelCount % currentNumCols === 0) {
			            currentNumRows = subPanelCount / currentNumCols;
			        } else if (currentNumRows > 0 && subPanelCount % currentNumRows === 0) {
			            currentNumCols = subPanelCount / currentNumRows;
			        } else {
			            currentNumRows = Math.round(subPanelCount / currentNumCols);
			        }
			    }

				// Source unique de vérité : on utilise directement les valeurs calculées par GeometryUtils et persistées
				let longueur = parseFloat(totalPanelLength) || 0;
				let largeur = parseFloat(totalPanelWidth) || 0;

				// CORRECTIF : Pour une toiture bipente symétrique, la largeur du champ PV est la moitié de la largeur totale.
				if (formValues.toiture_pente_type === 'Bipente_symetrique') {
					largeur = largeur / 2;
				}

				// Vérification du dépassement avec les dimensions dessinées
				const shapeDims = data.shapes[pvId].dimensions;
				if (shapeDims && longueur > 0 && largeur > 0) {
					const shapeMax = Math.max(shapeDims.length, shapeDims.width);
					const shapeMin = Math.min(shapeDims.length, shapeDims.width);
					if (longueur > shapeMax || largeur > shapeMin) {
						warnings.push(`Champ ${pvId} : Les dimensions finales (${longueur.toFixed(2)}x${largeur.toFixed(2)}m) sont supérieures aux dimensions du rectangle dessinées sur la carte.`);
					}
				}

			    // Calcul de la surface
			    const totalPanelAreaForShape = Number(data.shapes[pvId].gridInfo?.totalPanelArea || (longueur * largeur));
			    const computedTotalPanelArea = (totalPanelAreaForShape / (totalPanelCount || 1)) * subPanelCount;

			    let surfaceProjeteeCalc = 0;
			    if (computedTotalPanelArea > 0) {
			        surfaceProjeteeCalc = CalculationUtils.calculateSurfaceProjetée(computedTotalPanelArea, Number(inclinaison) || 0);
			    }
			    if (isNaN(surfaceProjeteeCalc) || !isFinite(surfaceProjeteeCalc)) surfaceProjeteeCalc = 0;
			    
			    const rowStyle = "border: 1px solid #ddd; padding: 0.3em; height: 40px; text-align: center; ";
			    
			    const row1 = document.createElement('tr');
			    row1.innerHTML = `
			        <td style="${rowStyle}">${subPvId}</td>
			        <td style="${rowStyle}">${subPanelCount}</td>
			        ${hasPolygon ? '' : `<td style="${rowStyle}">${currentNumRows}L x ${currentNumCols}C</td>`}
			        <td style="${rowStyle}">${formValues.modePose === 'paysage' ? 'Paysage' : 'Portrait'}</td>
			        <td style="${rowStyle}">${referenceSI}</td>
			        <td style="${rowStyle}">${totalPvPower.toFixed(2)}</td>
			        <td style="${rowStyle}">${productibleMwh.toFixed(2)}</td>
			        <td style="${rowStyle}">${productibleKwhPv.toFixed(2)}</td>
			    `;
			    tbody1.appendChild(row1);

			    // Calcul et affichage de la dimension réelle de la toiture
                let toitureDisplay = "N/A";
                const penteType = formValues.toiture_pente_type || 'Monopente';

                if (shapeDims && shapeDims.length !== undefined && shapeDims.width !== undefined) {
                    let tMax = Math.max(shapeDims.length, shapeDims.width);
                    let tMin = Math.min(shapeDims.length, shapeDims.width);
                    let inclinaisonVal = Number(inclinaison) || 0;
                    let realWidth = tMin;

                    if (penteType === 'Bipente_symetrique') {
                        // Règle spécifique: (largeur / 2) / cos(inclinaison)
                        realWidth = (tMin / 2) / Math.max(Math.cos(inclinaisonVal * Math.PI / 180), 0.1);
                    } else if (penteType === 'Bipente_asymetrique' || penteType === 'Multipente') {
                        // Pour les autres géométries complexes, on affiche la longueur du rectangle dessiné
                        // et la largeur est calculée comme pour le monopente.
                        if (inclinaisonVal > 0) {
                            realWidth = tMin / Math.max(Math.cos(inclinaisonVal * Math.PI / 180), 0.1);
                        }
                    } else { // Monopente
                        if (inclinaisonVal > 0) {
                            realWidth = tMin / Math.max(Math.cos(inclinaisonVal * Math.PI / 180), 0.1);
                        }
                    }

                    tMax = Math.round((tMax + Number.EPSILON) * 100) / 100;
                    realWidth = Math.round((realWidth + Number.EPSILON) * 100) / 100;
                    toitureDisplay = `${tMax.toFixed(2)} x ${realWidth.toFixed(2)}`;
                }

			    const row2 = document.createElement('tr');
                // Règle d'or : réutiliser la logique de Monopente pour les sous-champs
                // Le calcul de 'longueur' et 'largeur' est déjà basé sur le nombre de panneaux du sous-champ
                // via `currentNumRows` et `currentNumCols`.
                const panelLengthDisplay = `${longueur.toFixed(2)} x ${largeur.toFixed(2)}`;

                // La dimension de la toiture est affichée pour chaque sous-champ, car elle représente
                // la dimension du rampant sur lequel il est posé.
                const toitureDisplayOutput = toitureDisplay;

			    row2.innerHTML = `
			        <td style="${rowStyle}">${subPvId}</td>
			        <td style="${rowStyle}">${inclinaison}</td>
			        <td style="${rowStyle}">${azimuth}</td>
			        ${hasPolygon ? '' : `<td style="${rowStyle}">${toitureDisplayOutput}</td>`}
			        ${hasPolygon ? '' : `<td style="${rowStyle}">${panelLengthDisplay}</td>`}
			        <td style="${rowStyle}">${computedTotalPanelArea.toFixed(2)}</td>
			        <td style="${rowStyle}">${surfaceProjeteeCalc.toFixed(2)}</td>
			    `;
			    tbody2.appendChild(row2);

			    const rawPuisOnd = formValues.puissance_onduleur || document.querySelector('#puissance_onduleur-' + pvId)?.value || '0';
			    const puissanceOnduleurUnitaire = parseFloat(rawPuisOnd) || 0;

			    // Nombre d'onduleurs (entier naturel, défaut 1) et fraction de répartition de la
			    // puissance (%, défaut 100%) : Puissance onduleur affichée = P_max x Nbre x (fraction/100).
			    const rawNbOnduleurs = formValues.nbOnduleurs || document.querySelector('#nbOnduleurs-' + pvId)?.value || '1';
			    const nbOnduleurs = parseInt(rawNbOnduleurs, 10) || 1;

			    const rawFractionRepartition = formValues.fractionRepartitionOnduleur || document.querySelector('#fractionRepartitionOnduleur-' + pvId)?.value || '100';
			    const parsedFractionRepartition = parseFloat(rawFractionRepartition);
			    const fractionRepartitionOnduleur = isNaN(parsedFractionRepartition) ? 100 : parsedFractionRepartition;

			    let puissanceOnduleurTotale = puissanceOnduleurUnitaire * nbOnduleurs * (fractionRepartitionOnduleur / 100);
			    let puissanceOnduleur = puissanceOnduleurTotale * (subPanelCount / (totalPanelCount || 1));

			    const perteSysteme = formValues.perteSysteme || document.querySelector('#perteSysteme-' + pvId)?.value || '10';

			    // NOUVEAU : intègre la "perte d'ombrage entre sheds" (calculée par calcul_shed_shading.py,
			    // affichée dans #perteOmbrageShed-<pvId>) à la perte système globale du sous-champ lorsque
			    // celui-ci a été dessiné en mode shed (shape.shedsCapable). Combinaison multiplicative
			    // (rendements, pas pourcentages additifs) pour rester cohérent avec calcul_prodsolaire.py
			    // qui applique `p_dc_total * (1 - losses)`.
			    const isShedLayout = !!(data.shapes[pvId] && data.shapes[pvId].shedsCapable);
			    const perteOmbrageShed = isShedLayout
			        ? parseFloat(formValues.perteOmbrageShed || document.querySelector('#perteOmbrageShed-' + pvId)?.value || '0') || 0
			        : 0;
			    const perteSystemeCombinee = perteOmbrageShed > 0
			        ? 100 * (1 - (1 - parseFloat(perteSysteme) / 100) * (1 - perteOmbrageShed / 100))
			        : parseFloat(perteSysteme);

			    const rawRendementOnduleur = formValues.rendementOnduleur || document.querySelector('#rendementOnduleur-' + pvId)?.value || '0';
			    const rendementOnduleur = parseFloat(rawRendementOnduleur) || 0;

			    const rawConsoOnduleur = formValues.consoOnduleur || document.querySelector('#consoOnduleur-' + pvId)?.value || '0';
			    const consoOnduleur = parseFloat(rawConsoOnduleur) || 0;

			    const affectationCentrale = formValues.affectationCentrale || document.querySelector('#affectationCentrale-' + pvId)?.value || '1';
			    const centraleProduction = `Centrale ${affectationCentrale}`;

			    let typeMontageValue = formValues.typeSysteme || '';
			    if (!typeMontageValue) {
			        const selectEl = document.querySelector('#typeSysteme-' + pvId);
			        if (selectEl) typeMontageValue = selectEl.value;
			    }
			    // NOUVEAU: 4 types de montage possibles (free/terrasse/sur_imposition/building).
			    // PVGIS n'accepte que 'free' ou 'building' pour son modèle thermique : les montages
			    // peu ou pas ventilés (sur_imposition, building) sont assimilés à 'building', les
			    // autres (free, terrasse) à 'free'.
			    const typeMontageLabels = {
			        free: 'Ombrière/champ solaire',
			        terrasse: 'Toit terrasse',
			        sur_imposition: 'Sur-imposition (bac acier)',
			        building: 'En surimposition'
			    };
			    const typeMontage = typeMontageLabels[typeMontageValue] || typeMontageValue;

			    const ratioDcAc = puissanceOnduleur > 0 ? (totalPvPower / puissanceOnduleur) : 0;
			    if (puissanceOnduleur > 0) totalRatiosDcAc.push(ratioDcAc);

			    calculatedPvs.push({
			        id: subPvId,
			        peakPower: totalPvPower,
			        loss: perteSystemeCombinee,
			        isShedLayout: isShedLayout,
			        tilt: inclinaison || 0,
			        azimuth: azimuth || 0,
			        mount: (typeMontageValue === 'sur_imposition' || typeMontageValue === 'building') ? 'building' : 'free',
			        invLimit: puissanceOnduleur,
			        invEff: rendementOnduleur,
			        invCons: consoOnduleur,
			        panelRef: formValues.referencePanneau || '',
			        plantAffectation: affectationCentrale
			    });

			    if (rendementOnduleur > 0) totalRendementsOnduleur.push(rendementOnduleur);
			    totalConsoOnduleur += consoOnduleur;

			    const row3 = document.createElement('tr');
			    row3.innerHTML = `
			        <td style="${rowStyle}">${subPvId}</td>
			        <td style="${rowStyle}">${centraleProduction}</td>
			        <td style="${rowStyle}">${inclinaison || '0'}</td>
			        <td style="${rowStyle}">${azimuth || '0'}</td>
			        <td style="${rowStyle}">${typeMontage}</td>
			        <td style="${rowStyle}">${perteSysteme}</td>
			        <td style="${rowStyle}">${totalPvPower.toFixed(2)}</td>
			        <td style="${rowStyle}">${puissanceOnduleur.toFixed(2)}</td>
			        <td style="${rowStyle}">${ratioDcAc.toFixed(2)}</td>
			        <td style="${rowStyle}">${rendementOnduleur.toFixed(2)}</td>
			    `;
			    tbody3.appendChild(row3);

			    pvFieldsForChainesPertes.push({
			        subPvId,
			        pvId,
			        // subPanelCount (nombre de panneaux de CE sous-champ), pas totalPanelCount
			        // (agrégat de tous les sous-champs du pvId) : identiques pour une toiture
			        // Monopente (1 seul sous-champ), mais totalPanelCount était incorrectement
			        // dupliqué sur CHAQUE sous-champ d'une toiture Bipente/Multipente (BUG),
			        // faussant Config. automatique/Config. PV utilisateur/Ratio AC-DC par champ.
			        totalPanels: subPanelCount || 0,
			        panelReference: formValues.referencePanneau || '',
			        nbOnduleurs,
			        peakPowerKwc: totalPvPower || 0,
			        puissanceOnduleurKva: puissanceOnduleur || 0,
			        // NOUVEAU (demande explicite : label du type de toiture dans le modal Chaînes et
			        // pertes/Câblage DC) : déjà lu dans cette même portée (cf. penteType ci-dessus) —
			        // simple report, consommé par chaines_pertes_modal.js::roofTypeLabel().
			        toitureType: formValues.toiture_pente_type || 'Monopente',
			    });

			    totalPanels += subPanelCount || 0;
			    totalPower += totalPvPower || 0;
			    totalPuissanceOnduleur += puissanceOnduleur;
			    totalProductibleMwh += productibleMwh || 0;
			    totalProductibleKwhPv += productibleKwhPv || 0;
			    if (!isNaN(productibleKwhPv) && isFinite(productibleKwhPv) && totalPvPower > 0) {
			        totalMoyenneProductibleKwh.push(productibleKwhPv);
			    }
			    totalPvIds.push(subPvId);
			    totalSurface += computedTotalPanelArea || 0;
			    totalSurfaceProjetee += surfaceProjeteeCalc || 0;
			});
		});

		// ---------- CHAMPS PV DU CALEPINAGE RÉSIDENTIEL (tableaux 1 à 3) ----------
		// Demande explicite : "les dimensions des champs PV et les autres données n'apparaissent pas
		// dans le Summary modal". Ces champs (module "toiture multi-typologie") n'existent pas dans
		// data.shapes/formData : leurs lignes sont construites ici, à partir du même résumé par pan
		// que celui envoyé au calcul de production (CM.getAllPvFieldSummaries), enrichi de la
		// géométrie du champ (CM.mesurerGrillePan : dimensions, disposition LxC, surfaces).
		// Production/Productible restent vides : PVGIS est interrogé depuis la page Production et ne
		// redescend pas de résultat par champ dans localStorage pour ce module.
		const rowStyleMaison = "border: 1px solid #ddd; padding: 0.3em; height: 40px; text-align: center; ";
		const libellesMontage = {
			free: 'Ombrière/champ solaire',
			terrasse: 'Toit terrasse',
			sur_imposition: 'Sur-imposition (bac acier)',
			building: 'En surimposition',
		};
		const productionMaisons = this._productionMaisons || {};
		maisonSummaries.forEach((p) => {
			const puissance = Number(p.peakPower) || 0;
			const puissanceOnduleur = Number(p.invLimit) || 0;
			const ratioDcAc = puissanceOnduleur > 0 ? (puissance / puissanceOnduleur) : 0;
			const rendementOnduleur = Number(p.invEff) || 0;
			const surfacePanneaux = Number(p.surfacePanneauxM2) || 0;
			const surfaceProjetee = Number(p.surfaceProjeteeM2) || 0;

			// Production PVGIS de ce sous-champ (cf. chargerProductionChampsMaison, appelée avant
			// updateSummary). Mêmes conversions que pour les champs PRO plus haut.
			const solarMaison = productionMaisons[p.id];
			const prodTotaleKwh = Number(solarMaison?.annuel?.productionTotale) || 0;
			const productibleMwh = CalculationUtils.convertKWhToMWh(prodTotaleKwh) / 1000;
			const productibleKwhPv = puissance > 0
				? CalculationUtils.calculateProductibleKwhKwc(productibleMwh, puissance) : 0;

			const row1 = document.createElement('tr');
			row1.innerHTML = `
			    <td style="${rowStyleMaison}">${p.id}</td>
			    <td style="${rowStyleMaison}">${p.panelCount || 0}</td>
			    ${hasPolygon ? '' : `<td style="${rowStyleMaison}">${p.disposition || '-'}</td>`}
			    <td style="${rowStyleMaison}">${p.panelOrientation === 'paysage' ? 'Paysage' : 'Portrait'}</td>
			    <td style="${rowStyleMaison}">${p.systemeIntegrationRef || '-'}</td>
			    <td style="${rowStyleMaison}">${puissance.toFixed(2)}</td>
			    <td style="${rowStyleMaison}">${productibleMwh.toFixed(2)}</td>
			    <td style="${rowStyleMaison}">${productibleKwhPv.toFixed(2)}</td>
			`;
			tbody1.appendChild(row1);

			const row2 = document.createElement('tr');
			row2.innerHTML = `
			    <td style="${rowStyleMaison}">${p.id}</td>
			    <td style="${rowStyleMaison}">${(Number(p.tilt) || 0).toFixed(0)}</td>
			    <td style="${rowStyleMaison}">${p.azimuth || 0}</td>
			    ${hasPolygon ? '' : `<td style="${rowStyleMaison}">-</td>`}
			    ${hasPolygon ? '' : `<td style="${rowStyleMaison}">${(Number(p.longueurM) || 0).toFixed(2)} x ${(Number(p.largeurM) || 0).toFixed(2)}</td>`}
			    <td style="${rowStyleMaison}">${surfacePanneaux.toFixed(2)}</td>
			    <td style="${rowStyleMaison}">${surfaceProjetee.toFixed(2)}</td>
			`;
			tbody2.appendChild(row2);

			const row3 = document.createElement('tr');
			row3.innerHTML = `
			    <td style="${rowStyleMaison}">${p.id}</td>
			    <td style="${rowStyleMaison}">Centrale ${p.plantAffectation || '1'}</td>
			    <td style="${rowStyleMaison}">${(Number(p.tilt) || 0).toFixed(0)}</td>
			    <td style="${rowStyleMaison}">${p.azimuth || 0}</td>
			    <td style="${rowStyleMaison}">${libellesMontage[p.mount] || p.mount || '-'}</td>
			    <td style="${rowStyleMaison}">${(Number(p.loss) || 0).toFixed(1)}</td>
			    <td style="${rowStyleMaison}">${puissance.toFixed(2)}</td>
			    <td style="${rowStyleMaison}">${puissanceOnduleur.toFixed(2)}</td>
			    <td style="${rowStyleMaison}">${ratioDcAc.toFixed(2)}</td>
			    <td style="${rowStyleMaison}">${rendementOnduleur.toFixed(2)}</td>
			`;
			tbody3.appendChild(row3);

			// Mêmes totaux que les champs PRO (les lignes "Total" des 3 tableaux les additionnent).
			totalPanels += Number(p.panelCount) || 0;
			totalPower += puissance;
			totalPuissanceOnduleur += puissanceOnduleur;
			totalSurface += surfacePanneaux;
			totalSurfaceProjetee += surfaceProjetee;
			totalPvIds.push(p.id);
			totalProductibleMwh += productibleMwh;
			totalProductibleKwhPv += productibleKwhPv;
			if (!isNaN(productibleKwhPv) && isFinite(productibleKwhPv) && puissance > 0 && productibleKwhPv > 0) {
				totalMoyenneProductibleKwh.push(productibleKwhPv);
			}
			if (puissanceOnduleur > 0) totalRatiosDcAc.push(ratioDcAc);
			if (rendementOnduleur > 0) totalRendementsOnduleur.push(rendementOnduleur);
			totalConsoOnduleur += Number(p.invCons) || 0;
		});

		// Supprimer les anciens tfoots s'ils existent
		const oldTfoot1 = this.table1.querySelector('tfoot');
		if (oldTfoot1) oldTfoot1.remove();
		const oldTfoot2 = this.table2.querySelector('tfoot');
		if (oldTfoot2) oldTfoot2.remove();
		const oldTfoot3 = this.table3.querySelector('tfoot');
		if (oldTfoot3) oldTfoot3.remove();

        const tfootStyle = "border: 1px solid #ddd; padding: 0.3em; height: 45px; font-weight: bold; background-color: #f5f5f5; text-align: center; "
		let avgProductible = totalMoyenneProductibleKwh.length > 0 ? (totalMoyenneProductibleKwh.reduce((prev, acc) => prev + acc, 0) / totalMoyenneProductibleKwh.length) : 0;
		if (isNaN(avgProductible) || !isFinite(avgProductible)) avgProductible = 0;
		
		let avgRatioDcAc = totalRatiosDcAc.length > 0 ? (totalRatiosDcAc.reduce((prev, acc) => prev + acc, 0) / totalRatiosDcAc.length) : 0;
		if (isNaN(avgRatioDcAc) || !isFinite(avgRatioDcAc)) avgRatioDcAc = 0;

		let avgRendementOnduleur = totalRendementsOnduleur.length > 0 ? (totalRendementsOnduleur.reduce((prev, acc) => prev + acc, 0) / totalRendementsOnduleur.length) : 0;
		if (isNaN(avgRendementOnduleur) || !isFinite(avgRendementOnduleur)) avgRendementOnduleur = 0;

		// Tfoot Tableau 1
		const tfoot1 = document.createElement('tfoot');
		tfoot1.innerHTML = `
            <tr>
                <td style="${tfootStyle}">Total</td>
                <td style="${tfootStyle}">${totalPanels}</td>
                ${hasPolygon ? '' : `<td style="${tfootStyle}"></td>`}
                <td style="${tfootStyle}"></td>
                <td style="${tfootStyle}"></td>
                <td style="${tfootStyle}">${totalPower.toFixed(2)}</td>
                <td style="${tfootStyle}">${totalProductibleMwh.toFixed(2)}</td>
                <td style="${tfootStyle}">${avgProductible.toFixed(2)}</td>
            </tr>
        `;
        this.table1.appendChild(tfoot1);
        
		// Tfoot Tableau 2
		const tfoot2 = document.createElement('tfoot');
		tfoot2.innerHTML = `
            <tr>
                <td style="${tfootStyle}">Total</td>
                <td style="${tfootStyle}"></td>
                <td style="${tfootStyle}"></td>
                ${hasPolygon ? '' : `<td style="${tfootStyle}"></td>`}
                ${hasPolygon ? '' : `<td style="${tfootStyle}"></td>`}
                <td style="${tfootStyle}">${totalSurface.toFixed(2)}</td>
                <td style="${tfootStyle}">${totalSurfaceProjetee.toFixed(2)}</td>
            </tr>
        `;
        this.table2.appendChild(tfoot2);

		// Tfoot Tableau 3
		const tfoot3 = document.createElement('tfoot');
		tfoot3.innerHTML = `
            <tr>
                <td style="${tfootStyle}">Total</td>
                <td style="${tfootStyle}"></td>
                <td style="${tfootStyle}"></td>
                <td style="${tfootStyle}"></td>
                <td style="${tfootStyle}"></td>
                <td style="${tfootStyle}"></td>
                <td style="${tfootStyle}">${totalPower.toFixed(2)}</td>
                <td style="${tfootStyle}">${totalPuissanceOnduleur.toFixed(2)}</td>
                <td style="${tfootStyle}">${avgRatioDcAc.toFixed(2)}</td>
                <td style="${tfootStyle}">${avgRendementOnduleur.toFixed(2)}</td>
            </tr>
        `;
        this.table3.appendChild(tfoot3);

        // Câble le bouton unique "Chaînes/Pertes" avec la liste à jour des champs PV du projet
        // (recalculée à chaque updateSummary, la modale globale l'utilise pour répartir chaînage et
        // pertes système sur chaque champ, cf. finitions demandées).
        // CORRECTIF (demande explicite : "tout doit être fonctionnel et correct comme avant") : cette
        // liste ne contenait que les champs PRO, alors que le modal Chaînes/Pertes sait déjà traiter
        // les champs résidentiels (il est ouvert avec eux depuis le formulaire résidentiel, et sait
        // écrire ses résultats dans leur état, cf. CHAMPS_HOTE_VERS_STATE_MAISON dans
        // chaines_pertes_modal.js). Ouvert depuis CE bouton, il s'affichait donc vide pour un projet
        // composé uniquement de champs résidentiels.
        const champsMaisonChaines = (window.CalepinageMaisonIndiv
            && typeof window.CalepinageMaisonIndiv.getPvFieldsForChainesPertes === 'function')
            ? window.CalepinageMaisonIndiv.getPvFieldsForChainesPertes() : [];
        // Liste publiée pour le contrôle bloquant ratio DC/AC / P. max DC exécuté au clic sur
        // « Calculer et Visualiser » (chaines_pertes_modal.js::verifierAvantCalcul).
        window.__chainesPertesChampsProjet = pvFieldsForChainesPertes.concat(champsMaisonChaines);
        const chainesPertesBtn = this.modal.querySelector('#summary-chaines-pertes-btn');
        if (chainesPertesBtn) {
            chainesPertesBtn.onclick = () => {
                if (typeof window.openChainesPertesModal === 'function') {
                    window.openChainesPertesModal(pvFieldsForChainesPertes.concat(champsMaisonChaines));
                }
            };
        }

        // NOUVEAU (branchement du calepinage "toiture multi-typologie" au calcul global de
        // production, module volontairement indépendant du calepinage rectangulaire/polygonale
        // ci-dessus : pas de shapes/formData dans solarProjectData pour ce module) : chaque maison
        // dessinée expose un résumé par pan déjà au format attendu ici (contrat PvFieldSummary), il
        // suffit de les ajouter à calculatedPvs — main_prodsolaire.js les affichera comme n'importe
        // quel autre champ PV, sans modification de ce dernier. Volontairement absent des tableaux
        // tbody1/2/3 ci-dessus et de pvFieldsForChainesPertes (Chaînes/Pertes) : ce module n'a pas
        // encore de champs hôte -<pvId> pour recevoir leur écriture (cf. analyse de faisabilité).
        if (window.CalepinageMaisonIndiv && typeof window.CalepinageMaisonIndiv.getAllPvFieldSummaries === 'function') {
            // Réutilise la liste déjà récupérée en début de fonction (pour les tableaux 1 à 3) :
            // getAllPvFieldSummaries() recalcule la pose de TOUS les champs, inutile de le refaire,
            // et deux appels pourraient diverger si l'utilisateur modifie le calepinage entre-temps.
            calculatedPvs.push(...maisonSummaries);

            // NOUVEAU (bug rapporté : "le modal Système s'ouvre mais ne collecte pas les données de
            // calepinage de maison") : rend ces données VISIBLES dans le tableau 5 dédié (cf.
            // createModal) — jusqu'ici elles alimentaient calculatedPvs sans jamais apparaître à
            // l'écran, d'où l'impression pour l'utilisateur que rien n'était "collecté".
            if (this.tbody5) {
                const oldTfoot5 = this.table5.querySelector('tfoot');
                if (oldTfoot5) oldTfoot5.remove();

                const rowStyle5 = "border: 1px solid #ddd; padding: 0.3em; height: 40px; text-align: center; ";
                let totalMaisonCount = maisonSummaries.length;
                let totalMaisonPower = 0;

                this.tbody5.innerHTML = maisonSummaries.map((p) => {
                    totalMaisonPower += p.peakPower || 0;
                    const mountLabel = p.mount === 'building' ? 'Bâtiment (surimposition)' : 'Libre (ombrière/champ)';
                    // Ombrage entre sheds (petit champ au sol en sheds) : perte combinée, et avec
                    // terrain (case cochée) orientation réelle ; valeurs saisies rappelées dessous.
                    const saisie = (txt) => `<br><span style="font-size:0.75em; color:#6b7280;">${txt}</span>`;
                    const alerte = (txt) => `<br><span style="font-size:0.75em; color:#b45309;">${txt}</span>`;
                    const terrain = !!p.ombrageAvecTerrain;
                    const avecOmbrage = typeof p.perteOmbrageSheds === 'number';
                    const tiltTxt = terrain ? `${Number(p.tilt).toFixed(1)}${saisie(`saisie : ${Number(p.tiltSaisi || 0).toFixed(0)}`)}` : (p.tilt || 0).toFixed(0);
                    const azTxt = terrain ? `${Number(p.azimuth).toFixed(1)}${saisie(`saisi : ${p.azimuthSaisi || 0}`)}` : (p.azimuth || 0);
                    let perteTxt = (Number(p.loss) || 0).toFixed(1);
                    if (avecOmbrage) {
                        perteTxt += saisie(`${Number(p.perteSystemeSaisie || 0).toFixed(1)} système + ${Number(p.perteOmbrageSheds).toFixed(1)} ombrage sheds${terrain ? ' (avec terrain)' : ''}`);
                        if (p.ombrageTerrainIndisponible) perteTxt += alerte('ombrage avec terrain indisponible : terrain plat retenu');
                    } else if (p.ombrageShedsAbsent) {
                        perteTxt += alerte(`ombrage entre sheds non inclus${p.erreurOmbrageSheds ? ` (${p.erreurOmbrageSheds})` : ''}`);
                    }
                    return `
                        <tr>
                            <td style="${rowStyle5}">${p.id}</td>
                            <td style="${rowStyle5}">${tiltTxt}</td>
                            <td style="${rowStyle5}">${azTxt}</td>
                            <td style="${rowStyle5}">${mountLabel}</td>
                            <td style="${rowStyle5}">${(p.peakPower || 0).toFixed(2)}</td>
                            <td style="${rowStyle5}">${perteTxt}</td>
                            <td style="${rowStyle5}">${(p.invLimit || 0).toFixed(2)}</td>
                            <td style="${rowStyle5}">${(p.invEff || 0).toFixed(1)}</td>
                            <td style="${rowStyle5}">${(p.invCons || 0).toFixed(1)}</td>
                            <td style="${rowStyle5}">${p.panelRef || ''}</td>
                            <td style="${rowStyle5}">${p.plantAffectation || ''}</td>
                        </tr>
                    `;
                }).join('') || `<tr><td colspan="11" style="${rowStyle5}">Aucune maison dessinée pour l'instant.</td></tr>`;

                if (totalMaisonCount > 0) {
                    const tfootStyle5 = "border: 1px solid #ddd; padding: 0.3em; height: 45px; font-weight: bold; background-color: #f5f5f5; text-align: center; ";
                    const tfoot5 = document.createElement('tfoot');
                    tfoot5.innerHTML = `
                        <tr>
                            <td style="${tfootStyle5}">Total (${totalMaisonCount} pan(s))</td>
                            <td style="${tfootStyle5}"></td>
                            <td style="${tfootStyle5}"></td>
                            <td style="${tfootStyle5}"></td>
                            <td style="${tfootStyle5}">${totalMaisonPower.toFixed(2)}</td>
                            <td style="${tfootStyle5}"></td>
                            <td style="${tfootStyle5}"></td>
                            <td style="${tfootStyle5}"></td>
                            <td style="${tfootStyle5}"></td>
                            <td style="${tfootStyle5}"></td>
                            <td style="${tfootStyle5}"></td>
                        </tr>
                    `;
                    this.table5.appendChild(tfoot5);
                }
            }
        } else if (this.tbody5) {
            this.tbody5.innerHTML = `<tr><td colspan="11" style="border: 1px solid #ddd; padding: 0.3em; height: 40px; text-align: center;">Module calepinage maison non chargé.</td></tr>`;
        }

        // Sauvegarder les totaux dans localStorage pour l'étude économique
        this.saveTotalsToLocalStorage(totalPower, totalMoyenneProductibleKwh, totalPuissanceOnduleur, avgRatioDcAc, calculatedPvs, avgRendementOnduleur);

		// Mettre à jour la zone de texte
		const textArea = this.modal.querySelector('#summary-text-area');
		//FIXME - Récupérer la référence et la puissance des panneaux pour chaque zone de pv ?
		// Selectionne la première zone de pv pour récupérer la référence et la puissance des panneaux

		const firstKey = Object.keys(data.formData || {})[0];
		const firstFormData = firstKey ? data.formData[firstKey] : {};
		const fabricantPanneau = firstFormData.fabricantPanneau || 'Non défini';
		const referencePanneau = firstFormData.referencePanneau || 'Non définie';
		const puissancePanneau = firstFormData.puissancePanneau || 'Non définie';

		let prefConfig = {};
		try {
			const savedPref = localStorage.getItem('preferredPanelConfig');
			if (savedPref) prefConfig = JSON.parse(savedPref);
		} catch(e) {}

		let longueurPanneau = (firstFormData.longueurPanneau && String(firstFormData.longueurPanneau) !== "0") ? firstFormData.longueurPanneau : (firstFormData.longueurPanneauCustom || prefConfig.length);
		let largeurPanneau = (firstFormData.largeurPanneau && String(firstFormData.largeurPanneau) !== "0") ? firstFormData.largeurPanneau : (firstFormData.largeurPanneauCustom || prefConfig.width);
		let epaisseurPanneau = (firstFormData.epaisseurPanneau && String(firstFormData.epaisseurPanneau) !== "0") ? firstFormData.epaisseurPanneau : (firstFormData.epaisseurPanneauCustom || prefConfig.thickness);

		// Si l'épaisseur n'est pas trouvée, on tente de l'extraire du menu déroulant (ex: "1790x1134x30")
		if ((!longueurPanneau || !largeurPanneau || !epaisseurPanneau) && firstFormData.dimensionsPanneaux && firstFormData.dimensionsPanneaux !== 'custom' && firstFormData.dimensionsPanneaux !== 'Autres_dimensions') {
			const parts = String(firstFormData.dimensionsPanneaux).replace(/mm/gi, '').split('x').map(p => p.trim());
			if (parts.length >= 3) {
				longueurPanneau = longueurPanneau || parts[0];
				largeurPanneau = largeurPanneau || parts[1];
				epaisseurPanneau = epaisseurPanneau || parts[2];
			}
		}

		longueurPanneau = longueurPanneau || 'xxx';
		largeurPanneau = largeurPanneau || 'xxx';
		epaisseurPanneau = epaisseurPanneau || 'xxx';
		textArea.innerHTML = `
            <p style="${this.textStyle}">
                Fabricant des panneaux : ${fabricantPanneau !== 'Non défini' ? fabricantPanneau : (prefConfig.fab || 'Non défini')}
            </p>
            <p style="${this.textStyle}">
                Référence des panneaux : ${referencePanneau}
            </p>
            <p style="${this.textStyle}">
                Puissance unitaire des panneaux : ${puissancePanneau} Wc  
            </p>
            <p style="${this.textStyle}" >
                Dimensions des panneaux : ${longueurPanneau} mm x ${largeurPanneau} mm x ${epaisseurPanneau} mm
            </p>
        `;

		// Affichage de l'avertissement global et des avertissements de dimensions
		//const warningContainer = this.modal.querySelector('#summary-warning-container');
		//if (warningContainer) {
		//	let warningHtml = "<strong>⚠️ AVERTISSEMENT :</strong> Tous les paramètres n'ont pas été vérifiés. Donc, pensez à vérifier la conformité de votre système d'intégration avec le fabricant.";
		//	if (warnings.length > 0) {
		//		warningHtml += "<br><br>" + warnings.join('<br>');
		//	}
		//	warningContainer.innerHTML = warningHtml;
		//	warningContainer.style.display = 'block';
		//}
	}

	show(message) {
		if (message) {
			this.tbody1.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; height: 60px;">${message}</td></tr>`;
			this.tbody2.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; height: 60px;">${message}</td></tr>`;
			this.tbody3.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 20px; height: 60px;">${message}</td></tr>`;
		}

		// "Affectation prod. hors ACC" est aussi modifiable depuis les résultats ACC (main_acc.js) :
		// resynchroniser le champ, ce modal n'étant construit qu'une fois.
		try {
			const t = JSON.parse(localStorage.getItem('solarProjectData') || '{}').totals;
			if (this.gridLossInput && t && t.gridLossPercent !== undefined) {
				this.gridLossInput.value = t.gridLossPercent;
				this.gridLossInput.dataset.lastValid = this.gridLossInput.value;
			}
		} catch (_) {}

		// Centrer la modale à l'ouverture
		this.modal.style.transform = 'translate(-50%, -50%)';
		this.modal.style.top = '50%';
		this.modal.style.left = '50%';

		// Afficher la modale
		this.modal.style.display = 'block';
	}

    hide() {
        this.modal.style.display = 'none';

        // NOUVEAU WORKFLOW (demande explicite) : ce modal ("Dimensionnement" dans le menu
        // horizontal, cf. openDimensionnementModal() dans menu_list.html) fermé révèle la page
        // Calepinage en dessous — on y revient dans la mise en évidence du menu horizontal.
        // CORRECTIF (bug rapporté : mise en évidence figée sur l'étape qu'on quitte) :
        // restorePreviousMainNavStep() rétablit l'étape réellement quittée avant l'ouverture, pas
        // toujours 'calepinage' (cf. menu_list.html).
        if (typeof window.restorePreviousMainNavStep === 'function') window.restorePreviousMainNavStep();
        else if (typeof window.setActiveMainNavStep === 'function') window.setActiveMainNavStep('calepinage');
    }

    /**
     * Sauvegarde les totaux calculés dans localStorage pour l'étude économique
     */
    saveTotalsToLocalStorage(totalPower, totalMoyenneProductibleKwh, totalPuissanceOnduleur, avgRatioDcAc, calculatedPvs, avgRendementOnduleur) {
        try {
            // Calculer la moyenne du productible
            let avgProductible = totalMoyenneProductibleKwh.length > 0
                ? totalMoyenneProductibleKwh.reduce((prev, acc) => prev + acc, 0) / totalMoyenneProductibleKwh.length
                : 0;
            if (isNaN(avgProductible) || !isFinite(avgProductible)) avgProductible = 0;

            // Récupérer les données existantes du localStorage
            const savedData = localStorage.getItem('solarProjectData');
            if (savedData) {
                const projectData = JSON.parse(savedData);

                // Ajouter ou mettre à jour les totaux
                if (!projectData.totals) {
                    projectData.totals = {};
                }

                projectData.totals.totalPower = parseFloat(totalPower.toFixed(2));
                projectData.totals.avgProductible = parseFloat(avgProductible.toFixed(2));
                projectData.totals.puissanceOnduleurKva = parseFloat((totalPuissanceOnduleur || 0).toFixed(2));
                projectData.totals.ratioDcAc = parseFloat((avgRatioDcAc || 0).toFixed(2));
                projectData.totals.rendementOnduleur = parseFloat((avgRendementOnduleur || 0).toFixed(2));
                projectData.totals.lastUpdated = new Date().toISOString();
                projectData.calculatedPvs = calculatedPvs || [];
                // Scène 3D d'ombrage proche (panneaux, bâtiments, arbres, blocs...) des mêmes champs,
                // envoyée avec eux au calcul de production (cf. calepinage_maison_ombrage_scene.js).
                const CM = window.CalepinageMaisonIndiv;
                if (CM && typeof CM.attachShadingSceneToProjectData === 'function') {
                    CM.attachShadingSceneToProjectData(projectData);
                } else {
                    delete projectData.shadingScene;
                }

                // Sauvegarder dans localStorage
                localStorage.setItem('puissanceOnduleurKva', parseFloat((totalPuissanceOnduleur || 0).toFixed(2)));
                localStorage.setItem('ratioDcAc', parseFloat((avgRatioDcAc || 0).toFixed(2)));
                try {
                    localStorage.setItem('solarProjectData', JSON.stringify(projectData));
                } catch (quotaError) {
                    // Quota dépassé : la scène d'ombrage est la seule donnée volumineuse et facultative.
                    if (!projectData.shadingScene) throw quotaError;
                    console.warn("⚠️ Scène d'ombrage proche non enregistrée (quota localStorage) : calcul sans ombrage proche.");
                    delete projectData.shadingScene;
                    localStorage.setItem('solarProjectData', JSON.stringify(projectData));
                }

                console.log('✅ Totaux sauvegardés dans localStorage:', {
                    totalPower: projectData.totals.totalPower,
                    avgProductible: projectData.totals.avgProductible,
                    puissanceOnduleurKva: projectData.totals.puissanceOnduleurKva,
                    ratioDcAc: projectData.totals.ratioDcAc
                });

                // Déclencher un événement pour notifier les autres composants
                document.dispatchEvent(new CustomEvent('solarProjectDataSaved', {
                    detail: { totals: projectData.totals }
                }));
            }
        } catch (error) {
            console.error('❌ Erreur lors de la sauvegarde des totaux:', error);
        }
    }
}

export default SummaryModal;  