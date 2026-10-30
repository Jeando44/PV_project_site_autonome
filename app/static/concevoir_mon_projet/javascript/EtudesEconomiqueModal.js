/**
 * Modal Etudes Economiques
 * Gestion du modal d'études économiques avec récupération automatique des données
 */

class EtudesEconomiqueModal {
    constructor() {
        this.modalId = 'etudes-economique-modal';
        this.init();
    }

    /**
     * Initialisation du modal
     */
    init() {
        // Charger les données au chargement de la page
        this.loadDataFromLocalStorage();

        // Configurer les événements
        this.setupEventListeners();
    }

    /**
     * Récupère les données du localStorage
     */
    loadDataFromLocalStorage() {
        // Puissance installée et productible : lus EN BASE (calcul ProSolaire enregistré, cf.
        // etude_economique/ReferenceProSolaire.js ; calepinage enregistré en mode Chiffrage, cf.
        // ChiffrageModeView.js). Ce chargement les écrivait depuis le localStorage (commun à tous
        // les projets) à chaque ouverture et à chaque modification du calepinage : il ne reprend
        // plus que la dégradation. La base n'est PAS relue ici : cette méthode suit chaque
        // écriture de solarProjectData (sauvegarde automatique de la page toutes les 3 s ->
        // savePageData -> SummaryModal -> solarProjectDataSaved), ce qui relançait
        // GET resultats-prodsolaire en boucle. Relecture : open() et les écouteurs de
        // ReferenceProSolaire.js (nouveau calcul, changement de projet).
        try {
            const savedData = localStorage.getItem('solarProjectData');
            if (!savedData) {
                console.warn('Aucune donnée trouvée dans localStorage');
                return;
            }

            const data = JSON.parse(savedData);

            // Calculer la puissance totale, le productible et la dégradation
            const { totalPower, totalProductible, degradation } = this.calculateTotals(data);

            // Mettre à jour les champs
            this.updateFields(totalPower, totalProductible, degradation);

        } catch (error) {
            console.error('Erreur lors du chargement des données:', error);
        }
    }

    /**
     * Calcule la puissance totale et le productible depuis les données
     * @param {Object} data - Données du projet solaire
     * @returns {Object} - {totalPower, totalProductible, degradation}
     */
    calculateTotals(data) {
        let totalPower = 0;
        let totalProductible = 0;
        let degradation = 0.3; // Valeur par défaut
        let pvgisFound = false;

        // PRIORITÉ 1 : Récupération du productible exact calculé par le backend Python
        try {
            const sharedSolarStr = localStorage.getItem('sharedSolarProduction');
            if (sharedSolarStr) {
                const sharedSolar = JSON.parse(sharedSolarStr);
                if (sharedSolar && sharedSolar.summary) {
                    totalProductible = parseFloat(sharedSolar.summary.specific_production) || 0;
                    totalPower = parseFloat(sharedSolar.summary.peak_power_kw) || 0;
                    pvgisFound = (totalProductible > 0);
                    if (pvgisFound) console.log('✅ Productible calculé par le Backend Python récupéré avec succès dans EtudesEconomiqueModal');
                }
            }
        } catch(e) {}

        // Méthode 2: Utiliser les totaux pré-calculés par SummaryModal (si backend introuvable)
        if (!pvgisFound && data.totals && data.totals.totalPower && data.totals.avgProductible) {
            totalPower = parseFloat(data.totals.totalPower) || 0;
            totalProductible = parseFloat(data.totals.avgProductible) || 0;
            console.log('✅ Utilisation des totaux pré-calculés depuis localStorage.totals');
        } else if (!pvgisFound) {
            // Méthode 3: Calculer depuis formData et solarData (comme dans SummaryModal)
            console.log('⚠️ Totaux non trouvés, calcul manuel...');

            if (data.formData && data.solarData && data.shapes) {
                let totalMoyenneProductibleKwh = [];

                Object.entries(data.formData).forEach(([pvId, formValues]) => {
                    const solarData = data.solarData?.[pvId];
                    if (!solarData) return;

                    // Récupérer le nombre de panneaux
                    let panelCount = 0;
                    try {
                        const lineTool = window.drawingControl?.lineToPolygon;
                        const polyTool = window.drawingControl?.polygonPanels;

                        if (lineTool && lineTool.createdPanelsByShape?.has(pvId)) {
                            const created = lineTool.createdPanelsByShape.get(pvId) || [];
                            panelCount = created.length;
                        } else if (polyTool && polyTool.createdPanelsByShape?.has(pvId)) {
                            const created = polyTool.createdPanelsByShape.get(pvId) || [];
                            const deletedSize = polyTool.deletedPanelIndexes?.get(pvId)?.size || 0;
                            panelCount = Math.max(0, created.length - deletedSize);
                        } else {
                            panelCount = Number(data.shapes?.[pvId]?.gridInfo?.panelCount) || 0;
                        }
                    } catch (_) {
                        panelCount = Number(data.shapes?.[pvId]?.gridInfo?.panelCount) || 0;
                    }

                    const panelPower = Number(formValues.puissancePanneau) || 0;
                    const totalPvPower = (panelCount * panelPower) / 1000; // Conversion en kWc

                    // Calculer le productible
                    const productionTotale = Number(solarData.annuel.productionTotale) || 0;
                    const productibleMwh = (productionTotale / 1000) / 1000; // Conversion en MWh
                    const productibleKwhPv = totalPvPower > 0 ? (productibleMwh * 1000) / totalPvPower : 0;

                    totalPower += totalPvPower;
                    totalMoyenneProductibleKwh.push(productibleKwhPv);
                });

                // Calculer la moyenne du productible
                if (totalMoyenneProductibleKwh.length > 0) {
                    totalProductible = totalMoyenneProductibleKwh.reduce((prev, acc) => prev + acc, 0) / totalMoyenneProductibleKwh.length;
                }
            }
        }

        // Récupérer la dégradation depuis projectInfo
        if (data.projectInfo && data.projectInfo.coefficientDegradation) {
            degradation = parseFloat(data.projectInfo.coefficientDegradation) || 0.3;
        }

        return {
            totalPower: totalPower.toFixed(2),
            totalProductible: totalProductible.toFixed(2),
            degradation: degradation.toFixed(1)
        };
    }

    /**
     * Met à jour les champs de puissance, productible et dégradation
     * @param {number} power - Puissance en kWc
     * @param {number} productible - Productible en kWh/kWc/an
     * @param {number} degradation - Dégradation annuelle en %
     */
    updateFields(power, productible, degradation) {
        // power / productible ignorés : jamais repris du localStorage (cf. loadDataFromLocalStorage).
        const degradationField = document.getElementById('degradation');
        if (degradationField && !degradationField.dataset.manual) {
            degradationField.value = degradation;
        }
    }

    /**
     * Configuration des événements
     */
    setupEventListeners() {
        // Écouter les changements dans le localStorage pour mettre à jour automatiquement
        window.addEventListener('storage', (e) => {
            if (e.key === 'solarProjectData') {
                this.loadDataFromLocalStorage();
            }
        });

        // Écouter les événements personnalisés de sauvegarde
        document.addEventListener('solarProjectDataSaved', () => {
            this.loadDataFromLocalStorage();
        });
    }

    /**
     * Ouvrir le modal
     */
    open() {
        const modal = document.getElementById(this.modalId);
        const backdrop = document.getElementById('etudes-economique-backdrop');

        if (modal && backdrop) {
            modal.style.display = 'flex';
            backdrop.style.display = 'block';

            // Recharger les données au cas où elles auraient changé
            if (window.ReferenceProSolaire) window.ReferenceProSolaire.charger();
            this.loadDataFromLocalStorage();

            // Sauvegarder l'état pour persistance au refresh
            sessionStorage.setItem('openModalState', JSON.stringify({ type: 'etudes-economique' }));
        }
    }

    /**
     * Fermer le modal
     */
    close() {
        const modal = document.getElementById(this.modalId);
        const backdrop = document.getElementById('etudes-economique-backdrop');

        if (modal && backdrop) {
            modal.style.display = 'none';
            backdrop.style.display = 'none';
        }

        // Supprimer l'état de persistance
        sessionStorage.removeItem('openModalState');
    }
}

// Fonctions globales pour l'ouverture et fermeture du modal
function openEtudesEconomiqueModal() {
    // Obligation de projet actif (cf. app/middleware/auth_middleware.py:active_project_required) :
    // ce modal est un simple toggle CSS côté client (pas de route serveur), donc non couvert par le
    // guard de navigation — on le bloque ici explicitement.
    if (!localStorage.getItem('current_projet_id')) {
        if (typeof window.showActiveProjectRequiredMessage === 'function') {
            window.showActiveProjectRequiredMessage();
        } else {
            alert('Vous devez créer ou sélectionner un projet avant de continuer.');
        }
        return;
    }

    // CORRECTIF (bug rapporté : "bloque la génération du rapport, ne reconnaît pas le calepinage
    // de maison individuelle") : cette condition n'acceptait que le calepinage grands-projets
    // (solarProjectData.shapes) et bloquait donc systématiquement l'accès aux études économiques
    // pour tout projet fait uniquement en calepinage maison résidentiel (stockage totalement
    // distinct, cf. Calepinage_mainson/). Supprimée plutôt qu'étendue : le seul pré-requis réel
    // reste d'avoir un projet actif (déjà vérifié ci-dessus). Doublon de la même suppression dans
    // menu_list.js (les deux fichiers définissent une fonction globale du même nom).

    if (window.etudesEconomiqueModal) {
        window.etudesEconomiqueModal.open();
    }
}

function closeEtudesEconomiqueModal() {
    if (window.etudesEconomiqueModal) {
        window.etudesEconomiqueModal.close();
    }
}

// Initialiser le modal au chargement de la page
function initEtudesEconomiqueModal() {
    if (!window.etudesEconomiqueModal) {
        window.etudesEconomiqueModal = new EtudesEconomiqueModal();
        console.log('✅ EtudesEconomiqueModal initialisé');
    }
}

// Initialiser immédiatement si le DOM est déjà chargé, sinon attendre DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEtudesEconomiqueModal);
} else {
    // DOM déjà chargé, initialiser immédiatement
    initEtudesEconomiqueModal();
}
