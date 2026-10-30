/**
 * Modélisation des charges du site — module commun.
 * ==================================================
 * Bascule entre les 2 méthodes de génération (Bottom-Up / Top-Down, cf. loadProfileBottomUp.js et
 * loadProfileTopDown.js) et point d'intégration UNIQUE vers le calcul IRVE existant.
 *
 * RÈGLE D'OR (zéro régression) : ce fichier ne réimplémente RIEN du calcul existant. Il se contente
 * d'écrire dans `window.seasonalHourlyData` (4 saisons x 24h, déjà déclaré dans calcul_irve.js) puis
 * d'appeler deux fonctions déjà existantes et non modifiées :
 *   - calculateAverageExistingData() : recalcule existingHourlyData à partir de seasonalHourlyData.
 *   - initSeasonalTable() : reconstruit le tableau HTML visible à partir de seasonalHourlyData.
 * Tout le reste de calcul_irve.js (bilan de puissance, calculateEnergie, export...) reste inchangé
 * et continue de lire exactement les mêmes variables qu'avant.
 */

/**
 * Affiche le panneau de la méthode choisie (équipements ou profil annuel) et masque l'autre.
 * @param {'bottomup'|'topdown'} method
 */
window.selectGenerationMethod = function (method) {
    const bottomupPanel = document.getElementById('bottomup-panel');
    const topdownPanel = document.getElementById('topdown-panel');
    if (!bottomupPanel || !topdownPanel) return;

    const isBottomUp = method === 'bottomup';
    bottomupPanel.style.display = isBottomUp ? 'block' : 'none';
    topdownPanel.style.display = isBottomUp ? 'none' : 'block';

    // Initialise le tableau d'équipements avec le catalogue par défaut la première fois qu'on
    // affiche la méthode 1 (idempotent : ne recrée pas les lignes si déjà présentes).
    if (isBottomUp && typeof window.initEquipmentTable === 'function') {
        window.initEquipmentTable();
    }
};

/**
 * Point d'intégration unique : injecte un profil saisonnier généré (Méthode 1 ou 2) dans les
 * données du site déjà utilisées par le calcul IRVE existant, puis rafraîchit l'affichage.
 * @param {{Hiver:number[], Printemps:number[], Été:number[], Automne:number[]}} seasonalData
 *   Chaque tableau doit contenir exactement 24 valeurs (puissance moyenne horaire, kW).
 */
window.applyGeneratedProfileToSite = function (seasonalData) {
    if (!seasonalData || typeof window.seasonalHourlyData !== 'object') return;

    Object.keys(seasonalData).forEach((season) => {
        if (window.seasonalHourlyData[season] && Array.isArray(seasonalData[season]) && seasonalData[season].length === 24) {
            window.seasonalHourlyData[season] = seasonalData[season].slice();
        }
    });

    if (typeof window.calculateAverageExistingData === 'function') {
        window.calculateAverageExistingData();
    }
    if (typeof window.initSeasonalTable === 'function') {
        window.initSeasonalTable();
    }

    const statusEl = document.getElementById('seasonal-data-status');
    if (statusEl) {
        statusEl.textContent = 'Statut : profil généré injecté dans les données saisonnières (modifiable ci-dessous).';
    }
    if (typeof window.showMessage === 'function') {
        window.showMessage('Profil de charge du site généré et appliqué.', 'info', 4000);
    }
    if (typeof window.renderSiteConsumptionCharts === 'function') {
        window.renderSiteConsumptionCharts();
    }
};

/**
 * Petit utilitaire partagé : construit un tableau de 24 zéros (calque du format attendu par
 * seasonalHourlyData), pour éviter de le répéter dans les deux algorithmes de génération.
 */
window.zeroHourlyArray = function () {
    return Array(24).fill(0);
};
