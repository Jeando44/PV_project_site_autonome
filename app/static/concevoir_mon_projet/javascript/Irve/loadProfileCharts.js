/**
 * Section 1 — Graphiques de consommation du site (vue journalière et mensuelle).
 * =================================================================================
 * Visualise la consommation du site (hors bornes IRVE), quelle que soit la méthode active parmi
 * les 3 modes de "Consommation du site" : Générer un profil, Saisie Manuelle, Import Fichier.
 * Ne modifie AUCUNE donnée — lecture seule des variables déjà maintenues par calcul_irve.js
 * (seasonalHourlyData, existingHourlyData, importedData/useImportedData/importedPasTemps).
 * Appelée (additif, sans toucher au calcul) depuis :
 *   - applyGeneratedProfileToSite() (mode génération, loadProfileCommon.js)
 *   - updateSeasonalData() (mode saisie manuelle, calcul_irve.js)
 *   - la fin d'un import réussi (mode import, calcul_irve.js)
 */

let siteDailyConsumptionChart = null;
let siteMonthlyConsumptionChart = null;

const CHARTS_MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

/**
 * Agrège les données importées (importedData: [{time, kva}], pas de temps importedPasTemps en
 * minutes) en profil journalier moyen (24 valeurs, kW) et en totaux mensuels (12 valeurs, kWh).
 */
function aggregateImportedDataForCharts() {
    const hourlySums = Array(24).fill(0);
    const hourlyCounts = Array(24).fill(0);
    const monthlyKwh = Array(12).fill(0);
    const energyPerPointKwh = (importedPasTemps || 60) / 60;

    importedData.forEach((point) => {
        const d = new Date(point.time);
        const h = d.getHours();
        const m = d.getMonth();
        hourlySums[h] += point.kva || 0;
        hourlyCounts[h] += 1;
        monthlyKwh[m] += (point.kva || 0) * energyPerPointKwh;
    });

    const dailyAvgKw = hourlySums.map((sum, h) => hourlyCounts[h] > 0 ? sum / hourlyCounts[h] : 0);
    return { dailyKw: dailyAvgKw, monthlyKwh };
}

/**
 * Dérive un profil mensuel (12 valeurs, kWh) à partir des 4 profils saisonniers (seasonalHourlyData)
 * — un mois hérite intégralement de l'énergie journalière moyenne de sa saison météorologique.
 */
function aggregateSeasonalDataForCharts() {
    const monthSeasonMap = ['Hiver', 'Hiver', 'Printemps', 'Printemps', 'Printemps', 'Été', 'Été', 'Été', 'Automne', 'Automne', 'Automne', 'Hiver'];
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    const monthlyKwh = monthSeasonMap.map((season, m) => {
        const seasonHourly = seasonalHourlyData[season] || Array(24).fill(0);
        const dailyKwh = seasonHourly.reduce((sum, v) => sum + v, 0);
        return dailyKwh * daysInMonth[m];
    });

    return { dailyKw: existingHourlyData.slice(), monthlyKwh };
}

window.renderSiteConsumptionCharts = function () {
    const dailyCanvas = document.getElementById('site-daily-consumption-chart');
    const monthlyCanvas = document.getElementById('site-monthly-consumption-chart');
    if (!dailyCanvas || !monthlyCanvas || typeof Chart === 'undefined') return;

    const useImports = typeof useImportedData !== 'undefined' && useImportedData && typeof importedData !== 'undefined' && importedData && importedData.length > 0;
    const aggregated = useImports ? aggregateImportedDataForCharts() : aggregateSeasonalDataForCharts();

    if (siteDailyConsumptionChart) siteDailyConsumptionChart.destroy();
    siteDailyConsumptionChart = new Chart(dailyCanvas, {
        type: 'line',
        data: {
            labels: Array.from({ length: 24 }, (_, h) => h + 'h'),
            datasets: [{
                label: 'Consommation site (kW, jour moyen)',
                data: aggregated.dailyKw,
                borderColor: '#1E8449',
                backgroundColor: 'rgba(30, 132, 73, 0.15)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { title: { display: true, text: 'Puissance (kW)' } } },
            plugins: { title: { display: true, text: 'Vue journalière' } }
        }
    });

    if (siteMonthlyConsumptionChart) siteMonthlyConsumptionChart.destroy();
    siteMonthlyConsumptionChart = new Chart(monthlyCanvas, {
        type: 'bar',
        data: {
            labels: CHARTS_MONTH_LABELS,
            datasets: [{
                label: 'Consommation site (kWh/mois)',
                data: aggregated.monthlyKwh,
                backgroundColor: '#1E8449',
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { title: { display: true, text: 'Énergie (kWh)' } } },
            plugins: { title: { display: true, text: 'Vue mensuelle' } }
        }
    });

    const dailyTotalKwh = aggregated.dailyKw.reduce((sum, v) => sum + v, 0);
    const annualTotalMwh = aggregated.monthlyKwh.reduce((sum, v) => sum + v, 0) / 1000;
    const dailyTotalEl = document.getElementById('site-daily-total');
    if (dailyTotalEl) dailyTotalEl.textContent = `Total jour moyen : ${dailyTotalKwh.toFixed(1)} kWh`;
    const monthlyTotalEl = document.getElementById('site-monthly-total');
    if (monthlyTotalEl) monthlyTotalEl.textContent = `Total annuel : ${annualTotalMwh.toFixed(2)} MWh`;
};
