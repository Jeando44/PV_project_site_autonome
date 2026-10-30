/**
 * Base de données "Batteries" du calepinage — génère et gère la modale #batteriesModal
 * (bouton "Batterie" à côté de la config. onduleur AC dans calepinage.html).
 *
 * Repris depuis une ébauche valide oubliée dans app/templates/concevoir_mon_projet/pages/bd_batteries.js
 * (jamais chargée : mauvais emplacement) — le fichier réellement chargé ici contenait un fragment HTML
 * cassé collé par erreur dans un .js, ce qui provoquait un SyntaxError bloquant l'ouverture du modal.
 *
 * Même principe que bd_onduleurs.js : modal généré dynamiquement, favoris persistés en localStorage
 * (aucune table backend dédiée pour l'instant — prévu dans le plan "Matériels" à venir).
 */
const BATTERIE_STORAGE_KEY = 'batteriesDB_savedData';

const DEFAULT_BATTERY_DB = {
  'Générique': [
    { 
        ref: 'Batterie 200 kWh', 
        chimie: 'Li-ion LFP (Lithium Fer Phosphate)',
        compatibilite: 'triphase', 
        capacite: 200, 
        puissanceCharge: 100, 
        puissanceDecharge: 100, 
        tensionNominale: 600,
        dod: 80, 
        // Rendement ALLER-RETOUR (et non plus une paire charge/décharge identique) : 90,25 %
        // est exactement ce que valait l'ancien couple 0,95 / 0,95 une fois multiplié — la
        // batterie générique conserve donc rigoureusement le même comportement qu'avant.
        rte: 90.25
    }
  ]
};

function loadBatteryDB() {
  try {
    const saved = localStorage.getItem(BATTERIE_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Erreur lors du chargement de la BD batteries', e);
  }
  return null;
}

function persistBatteryDB() {
  try {
    localStorage.setItem(BATTERIE_STORAGE_KEY, JSON.stringify(window.batteryDB));
  } catch (e) {
    console.error('Erreur lors de la sauvegarde de la BD batteries', e);
  }
}

window.batteryDB = loadBatteryDB() || DEFAULT_BATTERY_DB;

// Masquage TEMPORAIRE du catalogue (demande du 2026-10-06) : seule la batterie personnalisable
// (fabricant « Générique ») est proposée, dans la BD Batteries comme dans la liste du formulaire
// résidentiel/PRO. Les autres références restent en base et dans window.batteryDB (projets déjà
// enregistrés) : repasser ce drapeau à false suffit pour les réafficher.
const BATTERIE_PERSONNALISABLE_SEULE = true;

/** Batterie personnalisable = fabricant « Générique » (insensible à la casse et aux accents). */
window.estBatteriePersonnalisable = function (fab) {
    return String(fab || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'generique';
};

/** Vrai si la batterie de ce fabricant doit apparaître dans les listes de choix. */
window.batterieVisibleDansListes = function (fab) {
    return !BATTERIE_PERSONNALISABLE_SEULE || window.estBatteriePersonnalisable(fab);
};
window.BATTERIE_PERSONNALISABLE_SEULE = BATTERIE_PERSONNALISABLE_SEULE;

// La liste ne doit jamais être vide : une batterie générique supprimée auparavant (BD locale) est
// remise à partir du modèle par défaut (le catalogue serveur la réécrit ensuite s'il la contient).
if (BATTERIE_PERSONNALISABLE_SEULE && !Object.keys(window.batteryDB).some((fab) =>
    window.estBatteriePersonnalisable(fab) && (window.batteryDB[fab] || []).length)) {
    window.batteryDB['Générique'] = DEFAULT_BATTERY_DB['Générique'].map((b) => Object.assign({}, b));
}

/**
 * Crée et injecte le HTML du modal des batteries dans le corps du document.
 * Idempotent : ne crée le modal que s'il n'existe pas déjà.
 */
function createBatteriesModal() {
    if (document.getElementById('batteriesModal')) {
        return;
    }

    const modalHTML = `
        <div id="batteriesModal" style="display: none; align-items: center; justify-content: center; position: fixed; z-index: 1000001; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); pointer-events: auto;">
            <div class="modal-content" style="background: white; border-radius: 8px; width: 98%; max-width: 1800px; padding: 0; position: relative; overflow: hidden; pointer-events: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border: 1px solid #ddd;">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; background-color: #5d5e5f; border-bottom: 1px solid #ddd; color: #fff; padding: 15px 20px; cursor: move;">
                    <h5 style="margin: 0; color: #fff; font-weight: bold; display: flex; align-items: center; gap: 8px;"><img src="/static/concevoir_mon_projet/medias/icons/battery-svgrepo-com.svg" alt="Batteries" style="height: 20px; width: 20px;" /> BD Batteries</h5>
                    <button type="button" style="background: transparent; border: none; font-size: 1.2em; cursor: pointer; color: #fff;" onclick="closeBatteriesModal(this)"><i class="fas fa-times"></i></button>
                </div>
                <div style="padding: 0 20px 20px 20px;">
                    <div class="table-responsive" style="max-height: 450px; overflow-y: auto;">
                        <table class="table table-striped table-hover align-middle" style="table-layout: fixed; width: 100%;">
                            <thead style="position: sticky; top: 0; z-index: 10; background-color: #f8f9fa;">
                                <tr>
                                    <th style="position: sticky; top: 0; background-color: #5d5e5f; color: #fff; z-index: 11; width: 9%;">Fabricant</th>
                                    <th style="position: sticky; top: 0; background-color: #5d5e5f; color: #fff; z-index: 11; width: 11%;">Référence</th>
                                    <th style="position: sticky; top: 0; background-color: #5d5e5f; color: #fff; z-index: 11; width: 12%;">Chimie bat.</th>
                                    <th style="position: sticky; top: 0; background-color: #5d5e5f; color: #fff; z-index: 11; width: 10%;">Compat. système</th>
                                    <th style="position: sticky; top: 0; background-color: #5d5e5f; color: #fff; z-index: 11; width: 7%;">Capacité (kWh)</th>
                                    <th style="position: sticky; top: 0; background-color: #5d5e5f; color: #fff; z-index: 11; width: 7%;">P. Charge (kW)</th>
                                    <th style="position: sticky; top: 0; background-color: #5d5e5f; color: #fff; z-index: 11; width: 7%;">P. Décharge (kW)</th>
                                    <th style="position: sticky; top: 0; background-color: #5d5e5f; color: #fff; z-index: 11; width: 8%;">Tension nom. (V)</th>
                                    <th style="position: sticky; top: 0; background-color: #5d5e5f; color: #fff; z-index: 11; width: 6%;">DoD (%)</th>
                                    <th style="position: sticky; top: 0; background-color: #5d5e5f; color: #fff; z-index: 11; width: 8%;" title="Rendement aller-retour (Round Trip Efficiency) : seule grandeur publiée par les fiches techniques, et seule stockée en base.">RTE (%)</th>
                                    <th style="position: sticky; top: 0; background-color: #5d5e5f; color: #fff; z-index: 11; width: 130px;">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                <!-- Lignes générées dynamiquement par renderBatteryRows() -->
                            </tbody>
                        </table>
                    </div>
                    <div style="text-align: right; margin-top: 15px; display: flex; justify-content: flex-end; gap: 10px;">
                        ${BATTERIE_PERSONNALISABLE_SEULE ? '' : '<button type="button" class="btn btn-success" style="background-color: #28a745; border-color: #28a745; color: white;" onclick="addBatteryRow(this)">+ Ajouter une batterie</button>'}
                        <button type="button" class="btn btn-secondary" onclick="closeBatteriesModal(this)">Fermer</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Rendre le modal déplaçable
    const modal = document.getElementById('batteriesModal');
    const modalContent = modal.querySelector('.modal-content');
    const modalHeader = modal.querySelector('.modal-header');
    let isDragging = false;
    let initialX, initialY;

    modalHeader.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        isDragging = true;
        const currentX = parseFloat(modalContent.dataset.currentX || 0);
        const currentY = parseFloat(modalContent.dataset.currentY || 0);
        initialX = e.clientX - currentX;
        initialY = e.clientY - currentY;
        modalHeader.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const currentX = e.clientX - initialX;
        const currentY = e.clientY - initialY;
        modalContent.dataset.currentX = currentX;
        modalContent.dataset.currentY = currentY;
        modalContent.style.transform = `translate(${currentX}px, ${currentY}px)`;
    });
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            modalHeader.style.cursor = 'move';
        }
    });
}

/**
 * Fonction de mise à jour conditionnelle de la tension nominale
 */
window.updateDefaultTension = function(rowElement) {
    if (!rowElement) return;
    const chimie = rowElement.querySelector('.in-chimie').value;
    const compatibilite = rowElement.querySelector('.in-compat').value;
    const tensionInput = rowElement.querySelector('.in-tension');

    if (chimie === 'Plomb-acide') {
        tensionInput.value = 48;
    } else if (chimie === 'Li-ion LFP (Lithium Fer Phosphate)' || chimie === 'Li-ion NMC (Nickel Manganèse Cobalt)') {
        if (compatibilite === 'triphase') {
            tensionInput.value = 600;
        } else if (compatibilite === 'monophase') {
            tensionInput.value = 400;
        }
    }
};

/**
 * Construit une ligne du tableau à partir d'une entrée de window.batteryDB.
 */
function buildBatteryRow(fab, bat) {
    const tr = document.createElement('tr');
    tr.dataset.origFab = fab || '';
    tr.dataset.origRef = (bat && bat.ref) || '';
    const compat = (bat && bat.compatibilite) || 'triphase';
    const chimie = (bat && bat.chimie) || 'Li-ion LFP (Lithium Fer Phosphate)';
    // Mode « batterie personnalisable seule » : fabricant figé (le renommer la ferait disparaître
    // de la liste) et suppression masquée (la liste resterait vide).
    const seule = BATTERIE_PERSONNALISABLE_SEULE;

    tr.innerHTML = `
        <td><input type="text" class="form-control form-control-sm in-fab" value="${fab || ''}"${seule ? ' readonly' : ''} /></td>
        <td><input type="text" class="form-control form-control-sm in-ref" value="${(bat && bat.ref) || ''}" /></td>
        <td>
            <select class="form-select form-select-sm in-chimie" onchange="updateDefaultTension(this.closest('tr'))">
                <option value="Plomb-acide"${chimie === 'Plomb-acide' ? ' selected' : ''}>Plomb-acide</option>
                <option value="Li-ion LFP (Lithium Fer Phosphate)"${chimie === 'Li-ion LFP (Lithium Fer Phosphate)' ? ' selected' : ''}>Li-ion LFP (Lithium Fer Phosphate)</option>
                <option value="Li-ion NMC (Nickel Manganèse Cobalt)"${chimie === 'Li-ion NMC (Nickel Manganèse Cobalt)' ? ' selected' : ''}>Li-ion NMC (Nickel Manganèse Cobalt)</option>
            </select>
        </td>
        <td>
            <select class="form-select form-select-sm in-compat" onchange="updateDefaultTension(this.closest('tr'))">
                <option value="monophase"${compat === 'monophase' ? ' selected' : ''}>Monophasé</option>
                <option value="triphase"${compat === 'triphase' ? ' selected' : ''}>Triphasé</option>
            </select>
        </td>
        <td><input type="number" step="0.1" class="form-control form-control-sm in-cap" value="${(bat && bat.capacite) || ''}" /></td>
        <td><input type="number" step="0.1" class="form-control form-control-sm in-pcharge" value="${(bat && bat.puissanceCharge) || ''}" /></td>
        <td><input type="number" step="0.1" class="form-control form-control-sm in-pdecharge" value="${(bat && bat.puissanceDecharge) || ''}" /></td>
        <td><input type="number" step="0.1" class="form-control form-control-sm in-tension" value="${(bat && bat.tensionNominale) || ''}" /></td>
        <td><input type="number" step="0.1" class="form-control form-control-sm in-dod" value="${(bat && bat.dod) || ''}" /></td>
        <td><input type="number" step="0.1" min="30" max="100" class="form-control form-control-sm in-rte" value="${(bat && bat.rte) || ''}" title="Rendement aller-retour en %. Lithium : 70 à 95. Plomb-acide : 30 à 60." /></td>
        <td style="white-space: nowrap; min-width: 130px;">
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: stretch;">
                <button type="button" class="btn btn-sm btn-choisir-fav" onclick="selectBattery(this)">Choisir</button>
                <button type="button" class="btn btn-sm btn-modifier-onduleur" onclick="updateBatteryRow(this)">Modifier</button>
                ${seule ? '' : '<button type="button" class="btn btn-sm btn-supprimer-onduleur" onclick="deleteBatteryRow(this)">Supprimer</button>'}
                <button type="button" class="btn btn-sm btn-batterie-details"
                    data-details="${(JSON.stringify((bat && bat.details) || {})).replace(/"/g, '&quot;')}"
                    onclick="window.toggleDetailRow(this)">+ détails</button>
            </div>
        </td>
    `;
    return tr;
}

// ---------------------------------------------------------------------------------------------
// Source de données : catalogue DB (table `batteries`, cf. plan "Modale Chaînes PV / Onduleur /
// Batterie + Pertes système détaillées", Phase 2). Même principe que bd_onduleurs.js : fusion par
// référence dans window.batteryDB, champs additionnels exposés via `.details` pour le bouton
// "+ détails". La colonne "Compat. système" du tableau n'accepte que monophase/triphase (un seul
// choix) : compatibilite_systeme ("Monophasé et Triphasé" pour les LUNA2000-5/7-S1) est ramenée à
// 'triphase' par défaut quand les deux sont supportés, la valeur brute restant visible en détail.
// Le rendement est désormais une SEULE colonne « RTE (%) », alimentée par round_trip_efficiency_pct.
// Auparavant, deux colonnes « Rdt Charge » / « Rdt Décharge » recevaient toutes deux cette même
// valeur globale, faute d'équivalent séparé en base — ce qui, une fois repris par le modal de
// stockage, revenait à appliquer RTE² : un RTE de 90 % ne produisait que 80,4 % réels
// (cf. tests/materiels/banc_mesure_rte_pysam.py). Une seule colonne, une seule signification.
// ---------------------------------------------------------------------------------------------
const BATTERIE_CATALOG_ENDPOINT = '/concevoir_mon_projet/catalogue/batteries';

function compatibiliteFromApi(compatibiliteSysteme) {
    const v = (compatibiliteSysteme || '').toLowerCase();
    const hasMono = v.includes('mono');
    const hasTri = v.includes('tri');
    if (hasTri) return 'triphase';
    if (hasMono) return 'monophase';
    return 'triphase';
}

/**
 * Ramène le type de couplage d'une batterie à 'DC' ou 'AC' (ou null si indéterminé). La colonne
 * "Type_Couplage" de Materiels_BD.xlsx contient des variantes de formulation, et la colonne de la
 * base les tronque à 20 caractères : seul le préfixe est fiable.
 */
function normaliserTypeCouplage(valeur) {
    const v = String(valeur == null ? '' : valeur).trim().toUpperCase();
    if (!v) return null;
    if (v.indexOf('DC') === 0) return 'DC';
    if (v.indexOf('AC') === 0) return 'AC';
    if (v.indexOf('DC') !== -1) return 'DC';
    if (v.indexOf('AC') !== -1) return 'AC';
    return null;
}
window.normaliserTypeCouplageBatterie = normaliserTypeCouplage;

function applyBatteryCatalogFromApi(apiRows) {
    (apiRows || []).forEach((b) => {
        if (!b || !b.reference) return;
        const fab = b.fabricant || 'Autre';
        if (!window.batteryDB[fab]) window.batteryDB[fab] = [];
        const list = window.batteryDB[fab];
        const idx = list.findIndex((bat) => bat.ref === b.reference);
        // CORRECTIF : cette colonne lisait `tension_nominale_ac`, que l'import ne renseigne PAS
        // (1 batterie sur 40 en base, la générique) — elle était donc vide pour tout le catalogue.
        // La tension exploitable est la TENSION SYSTÈME par phase, alimentée depuis les colonnes
        // de tension de la source : on prend celle qui correspond à la compatibilité de la ligne.
        const compatibilite = compatibiliteFromApi(b.compatibilite_systeme);
        const tensionSysteme = compatibilite === 'monophase'
            ? b.tension_systeme_mono_v : b.tension_systeme_tri_v;
        const tensionParsed = parseFloat(
            tensionSysteme != null ? tensionSysteme
                : (b.tension_systeme_mono_v != null ? b.tension_systeme_mono_v : b.tension_nominale_ac)
        );
        const dod = (b.capacite_nominale_kwh && b.capacite_utilisable_kwh)
            ? Math.round((b.capacite_utilisable_kwh / b.capacite_nominale_kwh) * 100)
            : ((b.soc_max_pct != null && b.soc_min_pct != null) ? (b.soc_max_pct - b.soc_min_pct) : undefined);
        const entry = {
            ref: b.reference,
            fabricant: b.fabricant || fab,
            // NOUVEAU (demande explicite : filtrer les batteries selon le type d'onduleur) : le type
            // de couplage n'existait que dans `details` (affichage du tableau), donc inexploitable
            // pour un filtre. Exposé ici en champ de premier niveau et NORMALISÉ à 'DC' / 'AC' : la
            // source Excel contient des variantes ("DC (via StorEdge / Home Network)"), en plus
            // tronquées à 20 caractères par la colonne de la base.
            type_couplage: normaliserTypeCouplage(b.type_couplage),
            chimie: b.chimie || 'Li-ion LFP (Lithium Fer Phosphate)',
            compatibilite,
            capacite: b.capacite_nominale_kwh,
            puissanceCharge: b.puissance_charge_kw,
            puissanceDecharge: b.puissance_decharge_kw,
            tensionNominale: isNaN(tensionParsed) ? undefined : tensionParsed,
            dod,
            rte: b.round_trip_efficiency_pct,
            details: {
                'Chimie': b.chimie,
                'Capacité utilisable (kWh)': b.capacite_utilisable_kwh,
                'Compatibilité système': b.compatibilite_systeme,
                'Type de couplage': b.type_couplage,
                'SoC / DoD (%)': (b.soc_min_pct != null && b.soc_max_pct != null) ? `${b.soc_min_pct} - ${b.soc_max_pct}` : null,
                'Round Trip Efficiency (%)': b.round_trip_efficiency_pct,
                'Courant max sortie triphasé AC (A)': b.courant_max_sortie_triphase_ac,
                'Tension nominale AC': b.tension_nominale_ac,
                'Tension nominale DC': b.tension_nominale_dc,
                'Tension système monophasé (V)': b.tension_systeme_mono_v,
                'Tension système triphasé (V)': b.tension_systeme_tri_v,
                'DoD max (%)': b.dod_max_pct,
                'Évolutivité max': b.evolutivite_max,
                'Tension fonct. triphasé': b.tension_fonctionnement_triphase,
                'Tension fonct. monophasé': b.tension_fonctionnement_monophase,
                'Conso. aux. monophasé (kW)': b.conso_aux_monophase_kw,
                'Conso. veille (W)': b.conso_veille_w,
                'Dimensions (mm)': b.dimensions_mm,
            },
        };
        if (idx >= 0) list[idx] = Object.assign({}, list[idx], entry);
        else list.push(entry);
    });
}

function fetchBatteryCatalog() {
    return fetch(BATTERIE_CATALOG_ENDPOINT)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((data) => {
            if (!data || !data.success || !Array.isArray(data.batteries)) return;
            // Cache brut consommé par chaines_pertes_modal.js (Phase 4) au moment de la sélection.
            window.batteryCatalogFromApi = data.batteries;
            applyBatteryCatalogFromApi(data.batteries);
            persistBatteryDB();
            const modal = document.getElementById('batteriesModal');
            if (modal && modal.style.display !== 'none') {
                const tbody = modal.querySelector('tbody');
                if (tbody) renderBatteryRows(tbody);
            }
        })
        .catch((e) => console.error('Erreur lors du chargement du catalogue batteries (BD)', e));
}

fetchBatteryCatalog();

function readBatteryRowInputs(row) {
    // Utilisation des classes pour une extraction robuste insensible à l'ordre des colonnes
    return {
        fab: row.querySelector('.in-fab').value.trim(),
        ref: row.querySelector('.in-ref').value.trim(),
        chimie: row.querySelector('.in-chimie').value,
        compatibilite: row.querySelector('.in-compat').value,
        capacite: row.querySelector('.in-cap').value,
        puissanceCharge: row.querySelector('.in-pcharge').value,
        puissanceDecharge: row.querySelector('.in-pdecharge').value,
        tensionNominale: row.querySelector('.in-tension').value,
        dod: row.querySelector('.in-dod').value,
        rte: row.querySelector('.in-rte').value
    };
}

function renderBatteryRows(tbody) {
    tbody.innerHTML = '';
    Object.keys(window.batteryDB).forEach(fab => {
        if (!window.batterieVisibleDansListes(fab)) return; // cf. BATTERIE_PERSONNALISABLE_SEULE
        window.batteryDB[fab].forEach(bat => {
            tbody.appendChild(buildBatteryRow(fab, bat));
        });
    });
}

/**
 * Ouvre le modal de la base de données des batteries.
 */
window.openBatteriesModal = function (btn) {
    createBatteriesModal();
    const modal = document.getElementById('batteriesModal');
    if (!modal) {
        console.error("Le modal des batteries est introuvable.");
        return;
    }

    // #batteriesModal est un singleton partagé par tous les champs PV (pas de clonage par suffixe
    // comme pour les favoris panneaux/onduleurs) : on mémorise ici le suffixe (-pvId) du formulaire
    // hôte qui a ouvert la modale, pour que selectBattery()/clearBatterieSelection() ciblent les
    // bons champs referenceBatterie-<pvId>/capaciteBatterie-<pvId> plutôt que les premiers trouvés.
    let suffix = '';
    if (btn) {
        const container = btn.closest('.tab-content, .tab-pane, form, .form-container') || document.body;
        const puissanceInput = container.querySelector('[id^="puissance_onduleur"]');
        if (puissanceInput && puissanceInput.id.includes('-')) {
            suffix = puissanceInput.id.substring(puissanceInput.id.indexOf('-'));
        }
    }
    modal.dataset.activeSuffix = suffix;

    fetchBatteryCatalog();
    const tbody = modal.querySelector('tbody');
    if (tbody) renderBatteryRows(tbody);
    modal.style.display = 'flex';
};

/**
 * Ferme le modal de la base de données des batteries.
 */
window.closeBatteriesModal = function (arg) {
    if (arg && arg.nodeType) {
        const modal = arg.closest('#batteriesModal') || document.getElementById('batteriesModal');
        if (modal) modal.style.display = 'none';
    } else {
        const modal = document.getElementById('batteriesModal');
        if (modal) modal.style.display = 'none';
    }
};

/**
 * Ajoute une nouvelle ligne vide au tableau pour la saisie.
 */
window.addBatteryRow = function (btn) {
    const modal = btn.closest('#batteriesModal');
    const tbody = modal && modal.querySelector('tbody');
    if (!tbody) return;
    
    // Initialisation avec des valeurs par défaut pertinentes (Li-ion, triphasé, 600V)
    const row = buildBatteryRow('', { 
        ref: '', 
        chimie: 'Li-ion LFP (Lithium Fer Phosphate)', 
        compatibilite: 'triphase', 
        capacite: '', 
        puissanceCharge: '', 
        puissanceDecharge: '', 
        tensionNominale: '600', 
        dod: '', 
        rte: ''
    });
    
    tbody.appendChild(row);
    row.scrollIntoView({ block: 'nearest' });
    const firstInput = row.querySelector('input');
    if (firstInput) firstInput.focus();
};

/**
 * Enregistre (ajout ou modification) la ligne dans window.batteryDB + localStorage.
 */
window.updateBatteryRow = function (btn) {
    const row = btn.closest('tr');
    if (!row) return;
    const { fab, ref, chimie, compatibilite, capacite, puissanceCharge, puissanceDecharge, tensionNominale, dod, rte } = readBatteryRowInputs(row);

    if (!fab || !ref) {
        if (window.showValidationAlert) window.showValidationAlert("Le fabricant et la référence sont requis.");
        return;
    }
    const cap = parseFloat(capacite);
    if (isNaN(cap) || cap <= 0) {
        if (window.showValidationAlert) window.showValidationAlert("La capacité doit être un nombre positif.");
        return;
    }

    const origFab = row.dataset.origFab;
    const origRef = row.dataset.origRef;
    if (origFab && window.batteryDB[origFab]) {
        window.batteryDB[origFab] = window.batteryDB[origFab].filter(bat => bat.ref !== origRef);
        if (window.batteryDB[origFab].length === 0) delete window.batteryDB[origFab];
    }

    if (!window.batteryDB[fab]) window.batteryDB[fab] = [];
    window.batteryDB[fab].push({
        ref,
        chimie: chimie || 'Li-ion LFP (Lithium Fer Phosphate)',
        compatibilite: compatibilite || 'triphase',
        capacite: cap,
        puissanceCharge: parseFloat(puissanceCharge) || 0,
        puissanceDecharge: parseFloat(puissanceDecharge) || 0,
        tensionNominale: parseFloat(tensionNominale) || 0,
        dod: parseFloat(dod) || 0,
        rte: parseFloat(rte) || 0
    });

    persistBatteryDB();
    row.dataset.origFab = fab;
    row.dataset.origRef = ref;

    row.style.backgroundColor = '#d4edda';
    setTimeout(() => { row.style.backgroundColor = ''; }, 800);
};

/**
 * Supprime la ligne de batterie (DOM + BD + localStorage).
 */
window.deleteBatteryRow = function (btn) {
    const row = btn.closest('tr');
    if (!row) return;

    const origFab = row.dataset.origFab;
    const origRef = row.dataset.origRef;
    if (origFab && window.batteryDB[origFab]) {
        window.batteryDB[origFab] = window.batteryDB[origFab].filter(bat => bat.ref !== origRef);
        if (window.batteryDB[origFab].length === 0) delete window.batteryDB[origFab];
        persistBatteryDB();
    }
    row.remove();
};

/**
 * Sélectionne une batterie et remplit/verrouille les champs referenceBatterie/capaciteBatterie du
 * formulaire hôte (jusqu'ici absent : cette fonction ne faisait que persister en localStorage,
 * contrairement à selectFavoritePanel()/selectFavoriteOnduleur() qui remplissent bien leur
 * formulaire — cf. plan Phase 2).
 */
window.selectBattery = function (btn) {
    const row = btn.closest('tr');
    if (!row) return;
    const data = readBatteryRowInputs(row);

    const modal = btn.closest('#batteriesModal') || document.getElementById('batteriesModal');
    const suffix = (modal && modal.dataset.activeSuffix) || '';
    const getField = (baseId) => document.getElementById(baseId + suffix) || document.querySelector('[id^="' + baseId + '"]');

    const updateAndLockField = (baseId, val) => {
        const el = getField(baseId);
        if (!el || val === '' || val === undefined || val === null) return;
        el.value = val;
        el.readOnly = true;
        el.style.backgroundColor = '#e9ecef';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    updateAndLockField('referenceBatterie', `${data.fab} ${data.ref}`.trim());
    updateAndLockField('capaciteBatterie', data.capacite);

    try {
        localStorage.setItem('preferredBatteryConfig', JSON.stringify(data));
    } catch (e) { /* ignore */ }

    // Notifie la modale "Chaînes / Onduleur / Batterie" (chaines_pertes_modal.js, Phase 4) de la
    // batterie choisie pour ce PV (déduit du suffixe mémorisé par openBatteriesModal, seule façon
    // fiable de connaître le pvId puisque #batteriesModal est un singleton partagé par tous les PV).
    if (suffix) {
        const dbMatch = (window.batteryCatalogFromApi || []).find((b) => b.reference === data.ref);
        document.dispatchEvent(new CustomEvent('pvEquipementSelected', {
            detail: {
                type: 'batterie',
                pvId: suffix.substring(1),
                data: { fab: data.fab, ref: data.ref, capacite: parseFloat(data.capacite) || 0, dbMatch: dbMatch || null },
            },
        }));
    }

    // NOUVEAU (demande explicite) : publie la sélection vers le modal de stockage, qui vit dans une
    // PAGE SÉPARÉE chargée en iframe — l'évènement `pvEquipementSelected` ci-dessus ne franchit pas
    // cette frontière. Les caractéristiques y sont pré-remplies et le calcul de stockage se
    // déclenche seul (cf. batterieSelection.js et main_autoconso.js).
    publierSelectionVersStockage(data);

    if (window.showToastNotification) {
        window.showToastNotification(`Batterie "${data.fab} ${data.ref}" sélectionnée.`);
    }
    closeBatteriesModal(btn);
};

/**
 * Normalise la batterie retenue puis la publie sur le pont partagé (batterieSelection.js).
 *
 * La ligne du tableau (`data`) porte les valeurs éventuellement retouchées par l'utilisateur ; le
 * catalogue (`dbMatch`) fournit ce qui n'y figure pas — notamment les tensions système par phase,
 * qui décident de la tension retenue selon l'onduleur.
 */
function publierSelectionVersStockage(data) {
    if (!window.BatterieSelection || !data) return;
    const dbMatch = (window.batteryCatalogFromApi || []).find((b) => b.reference === data.ref) || null;
    const onduleurData = (window.__chainesPertesGlobal
        && window.__chainesPertesGlobal.onduleur
        && window.__chainesPertesGlobal.onduleur.data) || null;
    // Batterie personnalisée : absente du catalogue, ou la batterie « Générique » (présente en base
    // mais modifiable dans le modal de stockage — sans quoi ses champs y restaient verrouillés).
    const estGenerique = !dbMatch || window.estBatteriePersonnalisable(data.fab || dbMatch.fabricant);
    const selection = window.BatterieSelection.normaliser(data, dbMatch, { onduleurData, estGenerique });
    window.BatterieSelection.publier(selection);
}

/**
 * Déverrouille et vide les champs referenceBatterie/capaciteBatterie verrouillés par
 * selectBattery(), même principe que clearOnduleurSelection() dans bd_onduleurs.js.
 */
window.clearBatterieSelection = function (btn) {
    const container = btn.closest('.tab-pane') || btn.closest('.form-container') || document.body;
    const puissanceInput = container.querySelector('[id^="puissance_onduleur"]');
    let suffix = '';
    if (puissanceInput && puissanceInput.id.includes('-')) {
        suffix = puissanceInput.id.substring(puissanceInput.id.indexOf('-'));
    }
    const getField = (baseId) => document.getElementById(baseId + suffix) || container.querySelector('[id^="' + baseId + '"]');

    ['referenceBatterie', 'capaciteBatterie'].forEach((baseId) => {
        const el = getField(baseId);
        if (!el) return;
        el.value = '';
        el.readOnly = false;
        el.style.backgroundColor = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    try { localStorage.removeItem('preferredBatteryConfig'); } catch (e) { /* ignore */ }
};

// Créer le modal dès que possible
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createBatteriesModal);
} else {
    createBatteriesModal();
}