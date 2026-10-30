/**
 * Modélisation des charges du site — Méthode 1 : approche par équipements (Bottom-Up).
 * =======================================================================================
 * Tableau dynamique d'équipements (catalogue par défaut dans equipmentData.js), calcul de
 * l'énergie journalière et de la puissance min/max, puis génération d'un profil saisonnier
 * (4 x 24h) transmis à applyGeneratedProfileToSite() (cf. loadProfileCommon.js).
 *
 * Convention interne : les coefficients saisonniers de equipmentData.js utilisent des clés
 * minuscules sans accent (hiver/printemps/ete/automne) ; seasonalHourlyData (calcul_irve.js) utilise
 * les clés exactes Hiver/Printemps/Été/Automne. SEASON_KEY_MAP fait le pont entre les deux.
 */
const SEASON_KEY_MAP = { hiver: 'Hiver', printemps: 'Printemps', ete: 'Été', automne: 'Automne' };
const SEASON_KEYS_INTERNAL = ['hiver', 'printemps', 'ete', 'automne'];

let _equipmentRowSeq = 0;

/**
 * Remplit le tableau avec le catalogue par défaut, uniquement s'il est vide (idempotent — ne
 * réinitialise pas une configuration déjà en cours d'édition par l'utilisateur).
 */
window.initEquipmentTable = function () {
    const tbody = document.getElementById('equipment-table-body');
    if (!tbody || tbody.children.length > 0) return;

    (window.DEFAULT_EQUIPMENT_LIST || []).forEach((eq) => {
        tbody.appendChild(buildEquipmentRow(eq));
    });
    recalcEquipmentTable();
};

/**
 * Construit une ligne de tableau à partir d'une définition d'équipement (catalogue par défaut ou
 * ligne vierge ajoutée manuellement).
 */
function buildEquipmentRow(eq) {
    eq = eq || {};
    const rowId = 'eqrow-' + (_equipmentRowSeq++);
    const tr = document.createElement('tr');
    tr.id = rowId;
    tr.dataset.facteurCharge = eq.facteurCharge !== undefined ? eq.facteurCharge : '';
    tr.dataset.energieFixe = eq.energieJournaliereFixeKwh !== undefined ? eq.energieJournaliereFixeKwh : '';
    tr.dataset.eqId = eq.id || '';

    const saisons = eq.saisons || { hiver: 1, printemps: 1, ete: 1, automne: 1 };
    const jours = eq.jours || { semaine: 1, weekend: 1 };

    const seasonCheckboxes = SEASON_KEYS_INTERNAL.map((s) => {
        const label = s === 'ete' ? 'Été' : (s.charAt(0).toUpperCase() + s.slice(1));
        const checked = (saisons[s] || 0) > 0 ? 'checked' : '';
        return `<label style="display:inline-flex; align-items:center; gap:2px; font-size:0.75rem; margin-right:4px;">
            <input type="checkbox" class="eq-saison" data-saison="${s}" ${checked} onchange="recalcEquipmentTable()">${label}</label>`;
    }).join('');

    tr.innerHTML = `
        <td><input type="text" class="form-control form-control-sm eq-nom" value="${(eq.nom || '').replace(/"/g, '&quot;')}" oninput="recalcEquipmentTable()" /></td>
        <td><input type="number" step="1" min="0" max="50000" class="form-control form-control-sm eq-puissance" value="${eq.puissanceW !== undefined ? eq.puissanceW : ''}" oninput="recalcEquipmentTable()" /></td>
        <td><input type="number" step="1" min="1" max="20" class="form-control form-control-sm eq-quantite" value="${eq.quantiteDefaut !== undefined ? eq.quantiteDefaut : 1}" oninput="recalcEquipmentTable()" /></td>
        <td><input type="number" step="0.01" min="0.85" max="1" class="form-control form-control-sm eq-cosphi" value="${eq.cosPhi !== undefined ? eq.cosPhi : 0.95}" oninput="recalcEquipmentTable()" /></td>
        <td><input type="number" step="1" min="0" max="24" class="form-control form-control-sm eq-debut" value="${eq.heureDebut !== undefined ? eq.heureDebut : 0}" oninput="recalcEquipmentTable()" /></td>
        <td><input type="number" step="1" min="0" max="24" class="form-control form-control-sm eq-fin" value="${eq.heureFin !== undefined ? eq.heureFin : 24}" oninput="recalcEquipmentTable()" /></td>
        <td style="white-space:nowrap;">
            <label style="display:inline-flex; align-items:center; gap:2px; font-size:0.75rem; margin-right:6px;">
                <input type="checkbox" class="eq-semaine" ${jours.semaine ? 'checked' : ''} onchange="recalcEquipmentTable()">Sem.</label>
            <label style="display:inline-flex; align-items:center; gap:2px; font-size:0.75rem;">
                <input type="checkbox" class="eq-weekend" ${jours.weekend ? 'checked' : ''} onchange="recalcEquipmentTable()">WE</label>
        </td>
        <td style="white-space:nowrap;">${seasonCheckboxes}</td>
        <td class="eq-energie-jour" style="text-align:center; font-weight:600;">0.00</td>
        <td style="text-align:center;">
            <button type="button" class="btn btn-sm btn-supprimer-onduleur" onclick="removeEquipmentRow(this)">Supprimer</button>
        </td>
    `;
    return tr;
}

/**
 * Ajoute une ligne vierge (équipement personnalisé, non issu du catalogue par défaut).
 */
window.addEquipmentRow = function () {
    const tbody = document.getElementById('equipment-table-body');
    if (!tbody) return;
    const row = buildEquipmentRow({ nom: '', puissanceW: 0, quantiteDefaut: 1, cosPhi: 0.95, heureDebut: 0, heureFin: 24 });
    tbody.appendChild(row);
    recalcEquipmentTable();
};

window.removeEquipmentRow = function (btn) {
    const row = btn.closest('tr');
    if (row) row.remove();
    recalcEquipmentTable();
};

/**
 * Lit les valeurs saisies d'une ligne du tableau.
 */
function readEquipmentRow(tr) {
    const saisons = {};
    tr.querySelectorAll('.eq-saison').forEach((cb) => {
        saisons[cb.dataset.saison] = cb.checked ? 1 : 0;
    });
    return {
        nom: tr.querySelector('.eq-nom').value.trim(),
        puissanceW: parseFloat(tr.querySelector('.eq-puissance').value) || 0,
        quantite: parseFloat(tr.querySelector('.eq-quantite').value) || 0,
        cosPhi: parseFloat(tr.querySelector('.eq-cosphi').value) || 0.95,
        heureDebut: Math.max(0, Math.min(24, parseInt(tr.querySelector('.eq-debut').value) || 0)),
        heureFin: Math.max(0, Math.min(24, parseInt(tr.querySelector('.eq-fin').value) || 0)),
        semaine: tr.querySelector('.eq-semaine').checked,
        weekend: tr.querySelector('.eq-weekend').checked,
        saisons,
        facteurCharge: tr.dataset.facteurCharge !== '' ? parseFloat(tr.dataset.facteurCharge) : null,
        energieJournaliereFixeKwh: tr.dataset.energieFixe !== '' ? parseFloat(tr.dataset.energieFixe) : null
    };
}

/**
 * Renvoie true si l'heure h (0-23) est dans la plage [debut, fin), en gérant le passage à minuit
 * (ex: debut=22, fin=6 pour un chauffe-eau nocturne).
 */
function isHourActive(h, debut, fin) {
    if (fin === debut) return false; // plage nulle
    if (debut < fin) return h >= debut && h < fin;
    return h >= debut || h < fin; // plage à cheval sur minuit
}

/**
 * Lit un coefficient global saisonnier/hebdomadaire depuis les inputs éditables de l'UI, avec repli
 * sur les valeurs par défaut de equipmentData.js si l'input est absent ou invalide.
 */
function getGlobalSeasonCoeff(seasonInternal) {
    const el = document.getElementById('coeff_saison_' + seasonInternal);
    const val = el ? parseFloat(el.value) : NaN;
    if (!isNaN(val) && val >= 0) return val;
    return (window.DEFAULT_GLOBAL_SEASON_COEFF && window.DEFAULT_GLOBAL_SEASON_COEFF[seasonInternal]) || 1;
}

function getGlobalWeeklyCoeff(dayType) {
    const el = document.getElementById('coeff_' + dayType); // coeff_semaine / coeff_weekend
    const val = el ? parseFloat(el.value) : NaN;
    if (!isNaN(val) && val >= 0) return val;
    return (window.DEFAULT_GLOBAL_WEEKLY_COEFF && window.DEFAULT_GLOBAL_WEEKLY_COEFF[dayType]) || 1;
}

/**
 * Construit le profil horaire (24 valeurs, kW) d'UN équipement pour UNE saison donnée.
 * Applique DEUX couches de modulation, multiplicatives et indépendantes :
 *  - le coefficient propre à l'équipement (eqData.saisons, ex. PAC quasi éteinte l'été) ;
 *  - le coefficient GLOBAL éditable par l'utilisateur (getGlobalSeasonCoeff/getGlobalWeeklyCoeff,
 *    ex. +25% en hiver pour toute la maison, +30% le week-end) — cf. equipmentData.js.
 * seasonalHourlyData ne distingue pas jour ouvré / week-end, donc on les fond en un coefficient de
 * "jour moyen" pondéré en énergie (5 jours ouvrés + 2 jours de week-end sur 7), chaque type de jour
 * étant lui-même pondéré par son coefficient global.
 */
function computeEquipmentHourlyKw(eqData, seasonInternal) {
    const hourly = window.zeroHourlyArray ? window.zeroHourlyArray() : Array(24).fill(0);
    const seasonCoeff = eqData.saisons[seasonInternal] !== undefined ? eqData.saisons[seasonInternal] : 1;
    if (seasonCoeff <= 0) return hourly;

    const globalSeasonCoeff = getGlobalSeasonCoeff(seasonInternal);
    const coeffSemaine = getGlobalWeeklyCoeff('semaine');
    const coeffWeekend = getGlobalWeeklyCoeff('weekend');
    const avgDayFactor = ((eqData.semaine ? 5 * coeffSemaine : 0) + (eqData.weekend ? 2 * coeffWeekend : 0)) / 7;
    if (avgDayFactor <= 0) return hourly;

    const totalSeasonCoeff = seasonCoeff * globalSeasonCoeff;

    // Cas particulier : énergie journalière fixe (ex. "Veille globale"), répartie uniformément.
    if (eqData.energieJournaliereFixeKwh) {
        const kwConstant = eqData.energieJournaliereFixeKwh / 24; // kWh/jour -> kW constant équivalent
        for (let h = 0; h < 24; h++) {
            hourly[h] = kwConstant * totalSeasonCoeff * avgDayFactor;
        }
        return hourly;
    }

    const chargeFactor = eqData.facteurCharge !== null && eqData.facteurCharge !== undefined ? eqData.facteurCharge : 1;
    const powerKw = (eqData.puissanceW / 1000) * eqData.quantite * chargeFactor;

    for (let h = 0; h < 24; h++) {
        if (isHourActive(h, eqData.heureDebut, eqData.heureFin)) {
            hourly[h] = powerKw * totalSeasonCoeff * avgDayFactor;
        }
    }
    return hourly;
}

/**
 * Un seul comptage de la climatisation : quand le module PAC / climatiseur (Irve/pac_climatisation/)
 * simule du froid, la ligne « Climatisation » du catalogue est exclue du profil. Une ligne restaurée
 * depuis la base perd son identifiant de catalogue (cf. irve_payload_builder.js) : on la reconnaît
 * aussi à son nom.
 */
function estLigneClimatisation(tr) {
    const nom = (tr.querySelector('.eq-nom')?.value || '').trim().toLowerCase();
    return tr.dataset.eqId === 'pac' || nom === 'climatisation';
}
window.estLigneClimatisation = estLigneClimatisation;

function climatisationExclue(tr) {
    return estLigneClimatisation(tr) && !!(window.PacSection && typeof window.PacSection.climatisationGeree === 'function'
        && window.PacSection.climatisationGeree());
}

/**
 * Additionne les profils horaires de TOUS les équipements du tableau pour une saison donnée
 * (avant application du coefficient de foisonnement).
 */
function computeAggregateHourlyKw(seasonInternal) {
    const total = Array(24).fill(0);
    document.querySelectorAll('#equipment-table-body tr').forEach((tr) => {
        if (climatisationExclue(tr)) return;
        const eqData = readEquipmentRow(tr);
        const hourly = computeEquipmentHourlyKw(eqData, seasonInternal);
        for (let h = 0; h < 24; h++) total[h] += hourly[h];
    });
    return total;
}

/**
 * Recalcule les colonnes "Énergie/jour" de chaque ligne, le total, et les indicateurs de puissance
 * min/max — appelé à chaque modification d'une ligne. Il n'y a pas de sélecteur de "saison de
 * référence" dans l'UI : l'énergie/jour affichée est la moyenne des 4 saisons (vision globale), et
 * la puissance min/max est le pire cas observé sur l'ensemble des 4 saisons (dimensionnement).
 */
window.recalcEquipmentTable = function () {
    let totalEnergyKwh = 0;
    document.querySelectorAll('#equipment-table-body tr').forEach((tr) => {
        const exclue = climatisationExclue(tr);
        tr.style.opacity = exclue ? '0.5' : '';
        tr.title = exclue ? 'Climatisation simulée par le module PAC / Climatiseur : exclue de ce profil.' : '';
        if (exclue) {
            const cellule = tr.querySelector('.eq-energie-jour');
            if (cellule) cellule.textContent = '0.00';
            return;
        }
        const eqData = readEquipmentRow(tr);
        const seasonalEnergies = SEASON_KEYS_INTERNAL.map((s) =>
            computeEquipmentHourlyKw(eqData, s).reduce((sum, kw) => sum + kw, 0) // kW constant sur 1h = kWh
        );
        const avgEnergyKwh = seasonalEnergies.reduce((a, b) => a + b, 0) / SEASON_KEYS_INTERNAL.length;
        const cell = tr.querySelector('.eq-energie-jour');
        if (cell) cell.textContent = avgEnergyKwh.toFixed(2);
        totalEnergyKwh += avgEnergyKwh;
    });

    const totalCell = document.getElementById('equipment-total-energy');
    if (totalCell) totalCell.textContent = totalEnergyKwh.toFixed(2);

    const foisonnementPct = parseFloat(document.getElementById('bu_foisonnement')?.value) || 100;
    const foisonnementCoeff = Math.max(0, Math.min(1, foisonnementPct / 100));

    let powerMinKw = Infinity;
    let powerMaxKw = 0;
    SEASON_KEYS_INTERNAL.forEach((s) => {
        const aggregateKw = computeAggregateHourlyKw(s);
        powerMinKw = Math.min(powerMinKw, Math.min(...aggregateKw));
        powerMaxKw = Math.max(powerMaxKw, Math.max(...aggregateKw));
    });
    if (!isFinite(powerMinKw)) powerMinKw = 0;
    const powerMaxFoisonneKw = powerMaxKw * foisonnementCoeff;

    // Exposé globalement pour la section Autonomie (item "Puissance onduleur nécessaire") : le pic
    // AVANT foisonnement, pas le profil final post-foisonnement écrit dans seasonalHourlyData.
    window.sitePowerMaxBeforeFoisonnementKw = powerMaxKw;

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('equipment-power-min', (powerMinKw * 1000).toFixed(0) + ' W');
    setText('equipment-power-max', (powerMaxKw * 1000).toFixed(0) + ' W');
    setText('equipment-power-max-foisonne', (powerMaxFoisonneKw * 1000).toFixed(0) + ' W');
};

/**
 * Génère le profil saisonnier complet (4 x 24h) à partir du tableau d'équipements, applique le
 * coefficient de foisonnement, puis le transmet au point d'intégration commun.
 */
window.generateBottomUpProfile = function () {
    const tbody = document.getElementById('equipment-table-body');
    if (!tbody || tbody.children.length === 0) {
        if (typeof window.showMessage === 'function') {
            window.showMessage("Ajoutez au moins un équipement avant de générer le profil.", 'error', 3000);
        }
        return;
    }

    const foisonnementPct = parseFloat(document.getElementById('bu_foisonnement')?.value) || 100;
    const foisonnementCoeff = Math.max(0, Math.min(1, foisonnementPct / 100));

    const seasonalData = {};
    SEASON_KEYS_INTERNAL.forEach((seasonInternal) => {
        const aggregateKw = computeAggregateHourlyKw(seasonInternal);
        seasonalData[SEASON_KEY_MAP[seasonInternal]] = aggregateKw.map((kw) => Number((kw * foisonnementCoeff).toFixed(3)));
    });

    window.applyGeneratedProfileToSite(seasonalData);
    recalcEquipmentTable();
};

// Le module PAC vient de (re)calculer : la ligne « Climatisation » peut changer de statut.
document.addEventListener('pacSimulationCalculee', () => {
    if (document.querySelector('#equipment-table-body tr')) window.recalcEquipmentTable();
});
