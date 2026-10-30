/**
 * Section 2 — Analyse d'autonomie énergétique du site (pré-dimensionnement off-grid).
 * ======================================================================================
 * CE MODULE NE CALCULE PLUS RIEN : il rassemble les entrées, appelle
 * POST /api/consommation/calculer_autonomie (cf. app/models/calcul_consommation/calcul_autonomie.py)
 * et affiche le résultat.
 *
 * Historiquement, les 3 formules de pré-dimensionnement étaient implémentées DEUX fois — ici en JS
 * (avec un appel direct à /calculate_pv) et côté Python, ce dernier ne servant qu'à une
 * comparaison manuelle de validation (bouton "Comparer avec Python", masqué). Deux raisons ont fait
 * du backend l'unique chemin : les deux implémentations pouvaient diverger à la moindre évolution,
 * et surtout la prise en compte à venir de l'analyse d'ombrage dans la production n'a de sens que
 * là où la production est réellement calculée, c'est-à-dire côté serveur.
 *
 * Le "Besoin d'énergie journalière" utilisé est celui du site seul, hors bornes IRVE : la variable
 * globale `existingHourlyData` (24 valeurs kW, déclarée dans calcul_irve.js) — jamais modifiée ici,
 * transmise telle quelle au backend (c'est la seule source correcte quand la consommation provient
 * d'un import de courbe de charge, cf. buildAutonomyRequestPayload).
 *
 * Le résultat est publié pour deux écrans d'une AUTRE page (cf. publishAutonomySummary) : la carte
 * "Total" du calepinage maison, qui en déduit le taux de couverture PV réel à chaque modification du
 * calepinage, et le modal Études économiques (consommation annuelle du site + ce même taux).
 *
 * Le choix de l'ensoleillement min./max. (moyenne journalière du mois le moins/plus ensoleillé,
 * plutôt qu'un min/max sur 365 jours individuels qu'un unique jour anormal fausserait) et son
 * historique de corrections sont documentés là où le calcul vit désormais : compute_autonomy(),
 * app/models/calcul_consommation/calcul_autonomie.py.
 */

/**
 * Adresse du projet actif telle que le serveur la connaît : `window.ACTIVE_PROJECT_ADRESSE`
 * (JSON stocké dans ParametreProjet.adresse_projet). Renvoie { lat, lon, libelle } ou null.
 */
function lireAdresseProjetGlobale() {
    const brut = window.ACTIVE_PROJECT_ADRESSE;
    if (!brut) return null;
    try {
        const a = typeof brut === 'string' ? JSON.parse(brut) : brut;
        const lat = Number(a.latitude !== undefined ? a.latitude : a.lat);
        const lon = Number(a.longitude !== undefined ? a.longitude : a.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { lat, lon, libelle: a.adresse || a.libelle || a.formatted_address || '' };
    } catch (e) {
        return null; // adresse non structurée (texte libre) : on retombe sur les replis ci-dessous
    }
}

// Localisation (lat/lon) : réplique la logique de résolution de applyProjectLocation()
// (main_prodsolaire.js) mais en lecture seule, sans dépendance au DOM de la page principale.
function resolveProjectLatLon() {
    // Paramètres globaux du projet actif d'ABORD (window.ACTIVE_PROJECT_ADRESSE, calculée en base
    // côté serveur et exposée par app_irve_v1.16.html). localStorage n'est qu'un repli : il est
    // vide dès qu'on n'est pas passé par le formulaire « Paramètres du projet » dans la session
    // courante — projet rechargé depuis la base, autre navigateur, stockage vidé — et on tombait
    // alors sur le repli Saint-Nazaire, c'est-à-dire sur un ensoleillement sans rapport avec le
    // site. Même raisonnement que pour ACTIVE_PROJECT_TYPE_CONNEXION (cf. irve_nav_menu.js).
    const globale = lireAdresseProjetGlobale();
    if (globale) return globale;

    let projectData = {};
    try {
        projectData = JSON.parse(localStorage.getItem('solarProjectData') || '{}');
    } catch (e) {
        projectData = {};
    }

    let lat = null;
    let lon = null;
    try {
        if (projectData.projectInfo) {
            const addrRaw = projectData.projectInfo.adresseProjet || projectData.projectInfo.adresse_projet || projectData.projectInfo.adresse;
            if (addrRaw) {
                const parsedAddr = typeof addrRaw === 'string' ? JSON.parse(addrRaw) : addrRaw;
                if (parsedAddr.latitude !== undefined) lat = parsedAddr.latitude;
                if (parsedAddr.longitude !== undefined) lon = parsedAddr.longitude;
            }
        }
        if (lat === null || lon === null) {
            const coords = projectData.selectedShapeCenter || projectData.mapCenter;
            if (coords && coords.lat !== undefined && coords.lng !== undefined) {
                lat = coords.lat;
                lon = coords.lng;
            } else if (projectData.shapes && Object.keys(projectData.shapes).length > 0) {
                const firstShapeId = Object.keys(projectData.shapes)[0];
                lat = projectData.shapes[firstShapeId].center.lat;
                lon = projectData.shapes[firstShapeId].center.lng;
            }
        }
    } catch (e) {
        lat = null;
        lon = null;
    }

    if (lat === null || lon === null) {
        lat = 47.273849; // Fallback identique à applyProjectLocation() (Saint-Nazaire)
        lon = -2.213741;
    }
    return { lat: Number(lat), lon: Number(lon) };
}

/**
 * Lit un champ numérique en préservant une valeur saisie de 0 (ex. inclinaison=0° pour un panneau
 * horizontal, azimut=0° pour plein sud) — `parseFloat(x) || default` traiterait à tort 0 comme
 * "absent" (0 est falsy en JS) et retomberait silencieusement sur la valeur par défaut. C'est très
 * exactement le bug signalé : changer l'inclinaison à 0° donnait la même production qu'à 30°, car
 * la valeur 0 n'était jamais réellement envoyée à l'API.
 */
function readNumericInput(id, defaultValue) {
    const parsed = parseFloat(document.getElementById(id).value);
    return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Lit les 10 paramètres d'entrée de la section autonomie (formule + payload API).
 */
function readAutonomyFormParams() {
    return {
        cibleAutonomiePct: readNumericInput('auto_cible_autonomie', 100),
        nbJoursAutonomie: readNumericInput('auto_nb_jours', 2),
        inclinaison: readNumericInput('auto_inclinaison', 30),
        azimut: readNumericInput('auto_azimut', 0),
        mount: document.getElementById('auto_mount').value || 'free',
        pertes: readNumericInput('auto_pertes', 10),
        usehorizon: document.getElementById('auto_usehorizon').value || '1',
        coeffEvolution: readNumericInput('auto_coeff_evolution', 1.25),
        rendementBatterie: readNumericInput('auto_rendement_batterie', 0.90),
        dod: readNumericInput('auto_dod', 0.80)
    };
}

/**
 * Clé localStorage du résumé d'autonomie, scopée par projet (meme convention que
 * IrveStorageManager._getStorageKey) : ce résumé est consommé par d'AUTRES écrans que celui-ci
 * (carte "Total" du calepinage maison, modal Études économiques), qui vivent dans une autre page
 * et n'ont donc aucune variable JS en commun avec ce modal.
 */
const AUTONOMY_SUMMARY_STORAGE_PREFIX = 'skv_site_autonomy_summary';

function autonomySummaryStorageKey() {
    const projectId = localStorage.getItem('current_projet_id') || 'no-project';
    return `${AUTONOMY_SUMMARY_STORAGE_PREFIX}_${projectId}`;
}

/**
 * Publie le résultat du pré-dimensionnement pour les autres écrans :
 *   - window.SITE_AUTONOMY_SUMMARY : lecture immédiate dans CE modal (payload IRVE sauvegardé en base) ;
 *   - localStorage (clé scopée projet) : lecture synchrone et instantanée par la carte "Total" du
 *     calepinage maison, qui doit afficher le taux de couverture à chaque panneau ajouté/retiré ;
 *   - la base, via le payload IRVE (cf. irve_payload_builder.js) : seule persistance fiable d'un
 *     navigateur/poste à l'autre.
 *
 * `puissancePvNecessaireKwc` est la puissance affichée comme "Puissance PV nécessaire", c'est-à-dire
 * celle qui couvre le besoin du site À LA CIBLE D'AUTONOMIE SAISIE (100 % par défaut) : c'est bien
 * le dénominateur du taux de couverture réel (PV installée / PV nécessaire).
 */
function publishAutonomySummary(result) {
    const summary = {
        besoinJournalierKwh: result.besoin_journalier_kwh,
        consommationAnnuelleKwh: result.consommation_annuelle_kwh,
        cibleAutonomiePct: result.cible_autonomie_pct,
        puissanceMaxSimultaneeKw: result.puissance_max_simultanee_kw,
        puissancePvNecessaireKwc: result.puissance_pv_kwc,
        capaciteBatterieKwh: result.capacite_batterie_kwh,
        puissanceOnduleurKva: result.puissance_onduleur_kva,
        productibleAnnuelKwhKwc: result.productible_annuel_kwh_kwc,
        pr: result.pr,
        calculatedAt: new Date().toISOString(),
    };
    window.SITE_AUTONOMY_SUMMARY = summary;
    try {
        localStorage.setItem(autonomySummaryStorageKey(), JSON.stringify(summary));
    } catch (e) {
        console.warn('[Autonomie] Résumé non mis en cache (localStorage indisponible) :', e);
    }
    return summary;
}

/**
 * Bouton masquer/afficher générique pour les sections numérotées du modal (1, 2, 3, 4) —
 * bascule le conteneur `contentId` entre display:block/none et met à jour le libellé du bouton.
 */
window.toggleModalSection = function (contentId, btnId) {
    const content = document.getElementById(contentId);
    const btn = document.getElementById(btnId);
    if (!content) return;
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    if (btn) btn.textContent = isHidden ? 'masquer' : 'afficher';
};

let autonomyPieChartInstance = null;

/**
 * Affiche les resultats du pre-dimensionnement. `result` est la reponse BRUTE de
 * /api/consommation/calculer_autonomie (cles snake_case) : depuis le passage au calcul backend,
 * c'est la seule forme manipulee ici, plus aucune conversion intermediaire cote JS.
 */
function renderAutonomyResults(result) {
    const resultsBox = document.getElementById('autonomy-results');
    if (resultsBox) resultsBox.style.display = 'block';

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('autonomy-besoin-journalier', result.besoin_journalier_kwh.toFixed(1) + ' kWh/j');
    // Consommation annuelle du site : meme valeur que le champ "Consommation annuelle d'energie du
    // site (kWh/an)" de l'etude economique, qui la reprend telle quelle (cf. publishAutonomySummary).
    setText('autonomy-consommation-annuelle',
        (result.consommation_annuelle_kwh / 1000).toFixed(1) + ' MWh/an ('
        + Math.round(result.consommation_annuelle_kwh).toLocaleString('fr-FR') + ' kWh/an)');
    setText('autonomy-pr', result.pr.toFixed(1) + ' %');
    setText('autonomy-productible-annuel', result.productible_annuel_kwh_kwc.toFixed(0) + ' kWh/kWc/an');
    setText('autonomy-ensoleillement', result.ensoleillement_min.toFixed(2) + ' / ' + result.ensoleillement_max.toFixed(2));
    setText('autonomy-puissance-pv', result.puissance_pv_kwc.toFixed(2) + ' kWc');
    setText('autonomy-capacite-batterie', result.capacite_batterie_kwh.toFixed(1) + ' kWh');
    setText('autonomy-puissance-onduleur', result.puissance_onduleur_kva.toFixed(2) + ' kVA');

    const canvas = document.getElementById('autonomy-pie-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (autonomyPieChartInstance) autonomyPieChartInstance.destroy();

    const cible = result.cible_autonomie_pct;
    const reste = Math.max(0, 100 - cible);
    autonomyPieChartInstance = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['Solaire (PV + batterie)', 'Apport externe / groupe électrogène'],
            datasets: [{ data: [cible, reste], backgroundColor: ['#1E8449', '#dc2626'] }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
                legend: { position: 'bottom' },
                datalabels: {
                    display: true,
                    formatter: (value) => value > 0 ? value.toFixed(0) + '%' : '',
                    color: '#fff',
                    font: { weight: 'bold' }
                }
            }
        }
    });
}

/**
 * Besoin journalier (kWh, existingHourlyData) et puissance max simultanée AVANT foisonnement (kW)
 * du site, hors IRVE — pour l'onduleur, on veut le pic réel des équipements, pas le profil final
 * (potentiellement déjà réduit par le coefficient de foisonnement de la Méthode 1, cf.
 * loadProfileBottomUp.js). Si la Méthode 1 a été utilisée, `window.sitePowerMaxBeforeFoisonnementKw`
 * (le pic AVANT foisonnement) est préféré ; sinon (Méthode 2 / saisie manuelle / import, où aucun
 * foisonnement ne s'applique), le max de existingHourlyData est déjà la bonne valeur.
 */
function profilHoraireSite() {
    // Mode « Import fichier » : profil journalier moyen de la courbe importée (aggregateImportedData,
    // calcul_irve.js) — existingHourlyData n'est tenu à jour que par les saisies saisonnières et
    // restait vide (ou celui d'un ancien profil) après un import.
    if (typeof useImportedData !== 'undefined' && useImportedData
        && typeof importedData !== 'undefined' && Array.isArray(importedData) && importedData.length > 0
        && typeof aggregateImportedData === 'function') {
        return aggregateImportedData(importedData, 60);
    }
    return typeof existingHourlyData !== 'undefined' ? existingHourlyData : [];
}

function computeSiteConsumptionMetrics() {
    const siteHourly = profilHoraireSite();
    const maxFromProfile = siteHourly.length > 0 ? Math.max(...siteHourly) : 0;
    const maxBeforeFoisonnement = typeof window.sitePowerMaxBeforeFoisonnementKw === 'number'
        ? window.sitePowerMaxBeforeFoisonnementKw
        : maxFromProfile;
    return {
        besoinJournalierKwh: siteHourly.reduce((sum, v) => sum + v, 0),
        puissanceMaxSimultaneeKw: maxBeforeFoisonnement
    };
}

/**
 * Construit le payload de /api/consommation/calculer_autonomie.
 *
 * `existing_hourly_data` (profil journalier moyen du site, 24 valeurs kW) est transmis en plus des
 * profils saisonniers : c'est la variable que ce modal tient à jour quelle que soit la méthode de
 * saisie (équipements, saisonnier, manuel, IMPORT de courbe de charge). Sans elle, le backend
 * reconstruirait le profil à partir des seules saisies saisonnières et trouverait un besoin nul
 * pour un site dont la consommation provient d'un fichier importé.
 */
function buildAutonomyRequestPayload(formParams, lat, lon, puissanceMaxSimultaneeKw) {
    return {
        seasonal_hourly_data: typeof seasonalHourlyData !== 'undefined' ? seasonalHourlyData : {},
        existing_hourly_data: profilHoraireSite(),
        puissance_max_avant_foisonnement_kw: puissanceMaxSimultaneeKw > 0 ? puissanceMaxSimultaneeKw : null,
        autonomie_params: {
            cible_autonomie_pct: formParams.cibleAutonomiePct,
            nb_jours_autonomie: formParams.nbJoursAutonomie,
            inclinaison: formParams.inclinaison,
            azimut: formParams.azimut,
            mount: formParams.mount,
            pertes: formParams.pertes,
            usehorizon: formParams.usehorizon,
            coeff_evolution: formParams.coeffEvolution,
            rendement_batterie: formParams.rendementBatterie,
            dod: formParams.dod
        },
        lat: lat,
        lon: lon,
        // Projet (vérifié par le serveur) : le résultat y est enregistré pour l'étude économique
        // (consommation annuelle du site, taux de couverture), cf. resultats_prodsolaire.py.
        projet_id: window.ACTIVE_PROJECT_ID_VERIFIE || null
    };
}

/**
 * Pré-dimensionnement site isolé : DÉLÉGUÉ AU BACKEND (/api/consommation/calculer_autonomie).
 *
 * Ce calcul était auparavant dupliqué ici en JS (appel direct à /calculate_pv puis application des
 * 3 formules), le portage Python ne servant qu'à une comparaison manuelle via un bouton de debug.
 * Les deux implémentations pouvaient diverger à la moindre évolution, et surtout : la prise en
 * compte à venir de l'analyse d'ombrage dans la production n'a de sens que là où la production est
 * réellement calculée, côté serveur. Le backend est donc désormais l'UNIQUE chemin de calcul, et
 * cette fonction se limite à rassembler les entrées, appeler l'API et afficher le résultat.
 */
// Partagé avec la section « Pompage solaire » de cette même modale : une seule résolution
// d'adresse pour toute la modale de consommation.
window.resolveProjectLatLon = resolveProjectLatLon;
window.lireAdresseProjetGlobale = lireAdresseProjetGlobale;

window.calculateAutonomy = async function () {
    const formParams = readAutonomyFormParams();

    const { besoinJournalierKwh, puissanceMaxSimultaneeKw } = computeSiteConsumptionMetrics();
    if (!besoinJournalierKwh || besoinJournalierKwh <= 0) {
        if (typeof showMessage === 'function') {
            showMessage("Aucune consommation du site définie (section 1) — impossible de calculer l'autonomie.", 'error', 4000);
        }
        return;
    }

    const { lat, lon } = resolveProjectLatLon();

    if (typeof showMessage === 'function') {
        showMessage("Calcul du pré-dimensionnement en cours...", 'info', 3000);
    }

    const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
    let response;
    try {
        response = await fetch(`${apiPrefix}/api/consommation/calculer_autonomie`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildAutonomyRequestPayload(formParams, lat, lon, puissanceMaxSimultaneeKw))
        });
    } catch (err) {
        if (typeof showMessage === 'function') {
            showMessage("Erreur réseau lors du calcul d'autonomie : " + err.message, 'error', 5000);
        }
        return;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (typeof showMessage === 'function') {
            showMessage("Erreur du calcul d'autonomie : " + (data.error || ('HTTP ' + response.status)), 'error', 5000);
        }
        return;
    }

    renderAutonomyResults(data);
    publishAutonomySummary(data);

    // Sauvegarde immédiate en base (payload IRVE) : sans ça, le résumé ne serait persisté qu'au
    // prochain autosave de la modale, et l'étude économique ouverte entre-temps ne verrait rien.
    if (typeof window.saveIrveDataToServer === 'function') {
        try {
            window.saveIrveDataToServer();
        } catch (e) {
            console.warn('[Autonomie] Sauvegarde du résumé en base impossible :', e);
        }
    }

    if (typeof showMessage === 'function') {
        showMessage("Analyse d'autonomie calculée.", 'info', 3000);
    }
};

/**
 * Bouton temporaire de comparaison : recalcule les mêmes résultats côté Python (indépendant du JS,
 * cf. app/models/calcul_consommation/) pour validation croisée, via /api/consommation/calculer_autonomie.
 */
window.compareWithPython = async function () {
    const formParams = readAutonomyFormParams();
    const { lat, lon } = resolveProjectLatLon();

    if (typeof showMessage === 'function') {
        showMessage("Calcul de vérification en cours...", 'info', 3000);
    }

    const payload = {
        seasonal_hourly_data: typeof seasonalHourlyData !== 'undefined' ? seasonalHourlyData : {},
        puissance_max_avant_foisonnement_kw: typeof window.sitePowerMaxBeforeFoisonnementKw === 'number'
            ? window.sitePowerMaxBeforeFoisonnementKw : null,
        autonomie_params: {
            cible_autonomie_pct: formParams.cibleAutonomiePct,
            nb_jours_autonomie: formParams.nbJoursAutonomie,
            inclinaison: formParams.inclinaison,
            azimut: formParams.azimut,
            mount: formParams.mount,
            pertes: formParams.pertes,
            usehorizon: formParams.usehorizon,
            coeff_evolution: formParams.coeffEvolution,
            rendement_batterie: formParams.rendementBatterie,
            dod: formParams.dod
        },
        lat: lat,
        lon: lon
    };

    const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
    let response;
    try {
        response = await fetch(`${apiPrefix}/api/consommation/calculer_autonomie`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        if (typeof showMessage === 'function') {
            showMessage("Erreur réseau lors de la vérification : " + err.message, 'error', 5000);
        }
        return;
    }
    if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        if (typeof showMessage === 'function') {
            showMessage("Erreur de la vérification : " + (errBody.error || response.status), 'error', 5000);
        }
        return;
    }

    const data = await response.json();
    const box = document.getElementById('python-comparison-results');
    if (box) box.style.display = 'block';

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('python-besoin-journalier', data.besoin_journalier_kwh.toFixed(1) + ' kWh/j');
    setText('python-pr', data.pr.toFixed(1) + ' %');
    setText('python-productible-annuel', data.productible_annuel_kwh_kwc.toFixed(0) + ' kWh/kWc/an');
    setText('python-ensoleillement', data.ensoleillement_min.toFixed(2) + ' / ' + data.ensoleillement_max.toFixed(2));
    setText('python-puissance-pv', data.puissance_pv_kwc.toFixed(2) + ' kWc');
    setText('python-capacite-batterie', data.capacite_batterie_kwh.toFixed(1) + ' kWh');
    setText('python-puissance-onduleur', data.puissance_onduleur_kva.toFixed(2) + ' kVA');

    if (typeof showMessage === 'function') {
        showMessage("Vérification calculée.", 'info', 3000);
    }
};
