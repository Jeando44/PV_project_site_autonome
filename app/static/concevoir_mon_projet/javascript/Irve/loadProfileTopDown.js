/**
 * Modélisation des charges du site — Méthode 2 : profil annuel global (Top-Down).
 * =================================================================================
 * Désagrégation Annuel -> Mensuel -> Journalier (jour ouvré / jour de repos) -> Courbe horaire,
 * à partir des tables de pondération de equipmentData.js (MONTHLY_WEIGHTS_BY_PROFILE,
 * WEEKDAY_WEEKEND_RATIO_BY_PROFILE, DAILY_SHAPE_BY_PROFILE).
 *
 * Limite assumée : seasonalHourlyData (calcul_irve.js) ne stocke qu'UN SEUL profil 24h par saison
 * (pas de distinction jour ouvré / jour de repos). Le profil stocké est donc le "jour moyen" de la
 * saison (énergie saisonnière / nombre de jours de la saison). Le ratio semaine/weekend est
 * néanmoins utilisé pour estimer et afficher à titre informatif l'énergie d'un jour ouvré vs d'un
 * jour de repos, sans que cela ne change l'énergie totale reconstituée (la moyenne pondérée
 * 5*ouvré + 2*repos sur 7 jours redonne exactement le jour moyen, quelle que soit la répartition
 * choisie) — ce qui garantit la conservation de l'énergie annuelle exigée par le cahier des charges.
 */

// Mois (1-12) appartenant à chaque saison météorologique (Hiver = Déc-Jan-Fév, etc.)
const SEASON_MONTHS = {
    Hiver: [12, 1, 2],
    Printemps: [3, 4, 5],
    Été: [6, 7, 8],
    Automne: [9, 10, 11]
};

// Nombre de jours par saison (année non bissextile, 365 jours au total)
const SEASON_DAYS = { Hiver: 90, Printemps: 92, Été: 92, Automne: 91 };

/**
 * Convertit le volume annuel saisi (kWh ou MWh) en kWh.
 */
function readAnnualVolumeKwh() {
    const value = parseFloat(document.getElementById('td_volume_annuel')?.value) || 0;
    const unite = document.getElementById('td_volume_unite')?.value || 'kWh';
    return unite === 'MWh' ? value * 1000 : value;
}

window.generateTopDownProfile = function () {
    const annualKwh = readAnnualVolumeKwh();
    const profil = document.getElementById('td_profil_type')?.value;

    const monthlyWeights = window.MONTHLY_WEIGHTS_BY_PROFILE && window.MONTHLY_WEIGHTS_BY_PROFILE[profil];
    const ratio = window.WEEKDAY_WEEKEND_RATIO_BY_PROFILE && window.WEEKDAY_WEEKEND_RATIO_BY_PROFILE[profil];
    const dailyShape = window.DAILY_SHAPE_BY_PROFILE && window.DAILY_SHAPE_BY_PROFILE[profil];

    if (!annualKwh || annualKwh <= 0) {
        if (typeof window.showMessage === 'function') {
            window.showMessage("Veuillez saisir un volume annuel de consommation valide.", 'error', 3000);
        }
        return;
    }
    if (!monthlyWeights || !ratio || !dailyShape) {
        if (typeof window.showMessage === 'function') {
            window.showMessage("Profil type inconnu ou données manquantes.", 'error', 3000);
        }
        return;
    }

    // Normalisation du ratio semaine/weekend pour que la moyenne pondérée sur 7 jours vaille 1
    // (5 jours ouvrés + 2 jours de repos), afin de ne jamais altérer l'énergie totale.
    const ratioNormFactor = 7 / (5 * ratio.ouvre + 2 * ratio.repos);

    const seasonalData = {};
    const summaryParts = [];

    Object.keys(SEASON_MONTHS).forEach((seasonKey) => {
        const months = SEASON_MONTHS[seasonKey];
        const seasonWeight = months.reduce((sum, m) => sum + monthlyWeights[m - 1], 0);
        const seasonEnergyKwh = annualKwh * seasonWeight;
        const nbDays = SEASON_DAYS[seasonKey];
        const avgDayEnergyKwh = seasonEnergyKwh / nbDays;

        // Estimation informative jour ouvré / jour de repos (n'affecte pas le profil stocké, cf.
        // note en tête de fichier : la moyenne pondérée redonne exactement avgDayEnergyKwh).
        const weekdayEnergyKwh = avgDayEnergyKwh * ratio.ouvre * ratioNormFactor;
        const weekendEnergyKwh = avgDayEnergyKwh * ratio.repos * ratioNormFactor;
        summaryParts.push(`${seasonKey}: jour moyen ${avgDayEnergyKwh.toFixed(1)} kWh (ouvré ≈ ${weekdayEnergyKwh.toFixed(1)}, repos ≈ ${weekendEnergyKwh.toFixed(1)})`);

        seasonalData[seasonKey] = dailyShape.map((shareOfDay) => Number((shareOfDay * avgDayEnergyKwh).toFixed(3)));
    });

    window.applyGeneratedProfileToSite(seasonalData);

    if (typeof window.showMessage === 'function') {
        window.showMessage(summaryParts.join(' | '), 'info', 6000);
    }
};
