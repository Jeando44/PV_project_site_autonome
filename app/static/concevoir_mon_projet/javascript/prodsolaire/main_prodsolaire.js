
/* =====================================================================
   ACCÈS AUX DONNÉES DU PROJET (solarProjectData)
   Source unique de vérité pour les réglages PVGIS (définis dans
   Paramètres du projet) et pour la géométrie des champs PV (calepinage).
===================================================================== */
function getProjectData() {
    try {
        return JSON.parse(localStorage.getItem('solarProjectData') || '{}');
    } catch (e) {
        console.error("Erreur lecture solarProjectData", e);
        return {};
    }
}

function getPvgisSettings(projectData) {
    const s = (projectData || getProjectData()).pvgisSettings || {};
    return {
        raddb: s.raddb || 'PVGIS-SARAH3',
        version: s.version || 'v5_3',
        usehorizon: (s.usehorizon !== undefined && s.usehorizon !== null && s.usehorizon !== '') ? s.usehorizon : '1',
        startyear: s.startyear || '2005',
        endyear: s.endyear || '2023'
    };
}

function getCalculatedPvs(projectData) {
    const data = projectData || getProjectData();
    return Array.isArray(data.calculatedPvs) ? data.calculatedPvs : [];
}

/**
 * Génère le HTML pour un champ PV à partir d'un sous-champ calculé par le calepinage.
 * Puissance, pertes, tilt, azimut, montage et onduleur sont verrouillés (issus du dessin) ;
 * les caractéristiques de fiche technique du panneau restent modifiables par l'utilisateur.
 * @param {object} pv - Entrée de solarProjectData.calculatedPvs { id, peakPower, loss, tilt, azimuth, mount, invLimit }.
 * @param {number} index - Index d'affichage (1-based).
 * @returns {string} Le code HTML du champ.
 */
function createPvFieldFromCalepinage(pv, index, totalCount) {
    const suffix = `_${index}`;
    const generalTotals = getProjectData().totals || {};
    const defaultValues = {
        cells: 60, vmp: 31.0, imp: 12.9, voc: 37.1, isc: 13.7,
        tempcoeff: 0.29, tempcoeff_voc: -0.27, tempcoeff_isc: 0.04,
        inv_cons: 0,
        // Ratio surface active / surface du module (ombrage proche) : propre au modèle de panneau s'il
        // est connu (pv.activeAreaRatio, fraction), sinon valeur usuelle des modules cristallins.
        active_ratio: (Number(pv.activeAreaRatio) > 0 && Number(pv.activeAreaRatio) <= 1) ? Math.round(pv.activeAreaRatio * 1000) / 10 : 90,
        albedo: generalTotals.albedo !== undefined ? generalTotals.albedo : 0.2,
        bifaciality: generalTotals.bifaciality !== undefined ? generalTotals.bifaciality : 0.8
    };
    const mountValue = pv.mount === 'building' ? 'building' : 'free';
    // Une "Centrale" par champ PV existant : permet d'affecter chaque champ à sa propre centrale
    // de production, ou de regrouper plusieurs champs sous la même centrale pour l'ACC.
    // La sélection par défaut reprend l'affectation choisie dans le calepinage (autoconsommation collective),
    // avec repli sur l'ancien comportement (une centrale par champ) si non renseignée.
    const selectedPlant = parseInt(pv.plantAffectation) || index;
    const plantOptions = Array.from({ length: totalCount }, (_, i) => i + 1)
        .map((n) => `<option value="${n}" ${n === selectedPlant ? 'selected' : ''}>Centrale ${n}</option>`)
        .join('');

    return `
    <div id="pv_field_${index}" class="pv-field-card" data-suffix="${suffix}" data-pv-id="${pv.id || ('PV' + index)}" data-is-shed-layout="${!!pv.isShedLayout}">
        <div class="pv-field-header">
            <h4>Champ PV ${index} — ${pv.id || ('PV' + index)} <span class="note">(calepinage)</span></h4>
        </div>

        <h5 class="pv-field-subheader">Système (issu du calepinage — verrouillé)</h5>
        <div class="grid">
            <div class="col-3 form-group"><label for="pv_plant${suffix}">Centrale de Production</label><select id="pv_plant${suffix}">${plantOptions}</select></div>
            <div class="col-3 form-group"><label for="pv_peak${suffix}">Puissance crête (kWc)</label><input id="pv_peak${suffix}" type="number" min="0" step="0.01" required value="${(pv.peakPower || 0).toFixed(2)}" readonly></div>
            <div class="col-3 form-group"><label for="pv_loss${suffix}">Pertes (%)${pv.isShedLayout ? ' <span class="note" title="Inclut la perte d\'ombrage entre sheds">(incl. ombrage shed)</span>' : ''}</label><input id="pv_loss${suffix}" type="number" min="0" max="99" step="0.1" required value="${pv.loss ? Number(pv.loss).toFixed(1) : 14}" readonly></div>
            <div class="col-3 form-group"><label for="pv_tech${suffix}">Technologie</label><select id="pv_tech${suffix}"><option value="crystSi" selected>crystSi</option><option value="crystSi2025">crystSi2025</option><option value="CIS">CIS</option><option value="CdTe">CdTe</option><option value="Unknown">Unknown</option></select></div>
            <div class="col-3 form-group"><label for="pv_mount${suffix}">Type de montage</label><select id="pv_mount${suffix}" disabled><option value="free" ${mountValue === 'free' ? 'selected' : ''}>free (Très bien ventilé)</option><option value="building" ${mountValue === 'building' ? 'selected' : ''}>building (Non ventilé)</option></select></div>
            <div class="col-3 form-group"><label for="pv_track${suffix}">Tracking</label><select id="pv_track${suffix}" onchange="toggleAngles('${suffix}')"><option value="0" selected>0 – Fixe</option><option value="1">1 – Axe horizontal N-S</option><option value="4">4 – Axe horizontal E-W</option><option value="5">5 – Axe incliné N-S</option><option value="3">3 – Axe vertical</option><option value="2">2 – Bi-axial</option></select></div>
            <div class="col-3 form-group angleWrap"><label for="pv_angle${suffix}">Inclinaison (°)</label><input id="pv_angle${suffix}" type="number" step="0.1" value="${pv.tilt || 0}" readonly></div>
            <div class="col-3 form-group aspectWrap"><label for="pv_aspect${suffix}">Azimut (°)</label><input id="pv_aspect${suffix}" type="number" step="0.1" value="${pv.azimuth || 0}" readonly></div>
        </div>

        <h5 class="pv-field-subheader">Panneaux (fiche technique — modifiable)</h5>
        <button type="button" class="btn btn-secondary" style="margin-bottom: 0.75rem;" onclick="togglePanelDatasheet(this, '${suffix}')">Voir données fiche technique du panneau</button>
        <div class="grid" id="pv_datasheet${suffix}" style="display:none;">
            <div class="col-3 form-group"><label for="pv_panel_ref${suffix}">Réf Panneau choisi (calepinage)</label><input id="pv_panel_ref${suffix}" type="text" value="${pv.panelRef || 'N/A'}" readonly></div>
            <div class="col-3 form-group"><label for="pv_type${suffix}">Type de panneau</label><select id="pv_type${suffix}" onchange="toggleBifacial(this, '${suffix}')"><option value="monofacial" selected>Monofacial</option><option value="bifacial">Bifacial</option></select></div>
            <div class="col-3 form-group"><label for="pv_cells${suffix}">Cellules (Série)</label><input id="pv_cells${suffix}" type="number" step="1" placeholder="ex. 60" value="${defaultValues.cells}"></div>
            <div class="col-3 form-group"><label for="pv_vmp${suffix}">Vmpp (V)</label><input id="pv_vmp${suffix}" type="number" min="0" step="0.1" placeholder="ex. 31.0" value="${defaultValues.vmp}"></div>
            <div class="col-3 form-group"><label for="pv_imp${suffix}">Impp (A)</label><input id="pv_imp${suffix}" type="number" min="0" step="0.1" placeholder="ex. 12.9" value="${defaultValues.imp}"></div>
            <div class="col-3 form-group"><label for="pv_voc${suffix}">Voc (V)</label><input id="pv_voc${suffix}" type="number" min="0" step="0.1" placeholder="ex. 37.1" value="${defaultValues.voc}"></div>
            <div class="col-3 form-group"><label for="pv_isc${suffix}">Isc (A)</label><input id="pv_isc${suffix}" type="number" min="0" step="0.1" placeholder="ex. 13.7" value="${defaultValues.isc}"></div>
            <div class="col-3 form-group"><label for="pv_tempcoeff${suffix}">Coeff. Temp. Pmax (%/°C)</label><input id="pv_tempcoeff${suffix}" type="number" step="0.001" placeholder="ex. 0.29" value="${defaultValues.tempcoeff}"></div>
            <div class="col-3 form-group"><label for="pv_tempcoeff_voc${suffix}">Coeff. Temp. Voc (%/°C)</label><input id="pv_tempcoeff_voc${suffix}" type="number" step="0.001" placeholder="ex. -0.27" value="${defaultValues.tempcoeff_voc}"></div>
            <div class="col-3 form-group"><label for="pv_tempcoeff_isc${suffix}">Coeff. Temp. Isc (%/°C)</label><input id="pv_tempcoeff_isc${suffix}" type="number" step="0.001" placeholder="ex. 0.04" value="${defaultValues.tempcoeff_isc}"></div>
            <div class="col-3 form-group"><label for="pv_active_ratio${suffix}" title="Part de la surface du module occupée par les cellules (hors cadre et interstices), 85 à 93 % pour les modules cristallins actuels. Sert UNIQUEMENT à l'ombrage proche : une ombre portée sur le cadre seul ne fait rien perdre. La puissance crête, elle, est déjà celle de la fiche technique.">Surface active / surface du module (%)</label><input id="pv_active_ratio${suffix}" type="number" min="50" max="100" step="0.5" value="${defaultValues.active_ratio}" onchange="validateRangeInput(this, 50, 100, 'Le ratio de surface active')"></div>
            <div class="col-3 form-group" style="display:none;"><label for="pv_albedo${suffix}">Albédo du sol</label><input id="pv_albedo${suffix}" type="number" step="0.01" min="0" max="1" value="${defaultValues.albedo}" onchange="validateRangeInput(this, 0, 1, 'Albédo du sol')"></div>
            <div class="col-3 form-group" style="display:none;"><label for="pv_bifaciality${suffix}">Fact. Bifacialité</label><input id="pv_bifaciality${suffix}" type="number" step="0.01" min="0.7" max="0.9" value="${defaultValues.bifaciality}" onchange="validateRangeInput(this, 0.7, 0.9, 'Le coefficient de bifacialité')"></div>
        </div>

        <h5 class="pv-field-subheader">Onduleur (issu du calepinage — verrouillé)</h5>
        <div class="grid">
            <div class="col-3 form-group"><label for="pv_inv_limit${suffix}">Onduleur AC max (kW)</label><input id="pv_inv_limit${suffix}" type="number" min="0" step="0.1" value="${(pv.invLimit || 0).toFixed(2)}" readonly></div>
            <div class="col-3 form-group"><label for="pv_inv_eff${suffix}">Rendement onduleur (%)</label><input id="pv_inv_eff${suffix}" type="number" min="0" max="100" step="0.1" value="${pv.invEff || 0}" readonly></div>
            <div class="col-3 form-group"><label for="pv_inv_cons${suffix}">Cons. Onduleur (W)</label><input id="pv_inv_cons${suffix}" type="number" min="0" max="1000" step="0.1" value="${pv.invCons !== undefined ? pv.invCons : defaultValues.inv_cons}" readonly></div>
        </div>
    </div>
    `;
}

/**
 * Rend les champs PV à partir du calepinage (solarProjectData.calculatedPvs).
 * Le calepinage est obligatoire : si aucune donnée n'est disponible, le calcul est bloqué
 * avec un message explicite plutôt que de proposer une saisie manuelle.
 */
function renderPvFieldsFromCalepinage() {
    const container = document.getElementById('pv-fields-container');
    if (!container) return;

    // Préserve les panneaux "fiche technique" actuellement dépliés : cette fonction est aussi
    // appelée en réaction à l'événement 'storage' (cf. écouteur plus bas), déclenché à chaque
    // sauvegarde de solarProjectData ailleurs dans l'application (carte, calepinage, etc.).
    // Sans cela, un panneau tout juste ouvert par l'utilisateur se referme instantanément dès
    // la sauvegarde suivante, donnant l'impression que le bouton "Voir données..." ne fonctionne pas.
    const openSuffixes = [];
    container.querySelectorAll('.pv-field-card').forEach(card => {
        const panel = card.querySelector('[id^="pv_datasheet"]');
        if (panel && panel.style.display !== 'none') {
            openSuffixes.push(card.dataset.suffix);
        }
    });

    const pvs = getCalculatedPvs();
    const calcBtn = document.getElementById('btn-calculate-pv');

    if (pvs.length === 0) {
        container.innerHTML = `<div class="note" style="color: var(--danger-color, #dc2626); font-weight: 600;">
            ⚠️ Aucun champ PV trouvé. Réalisez d'abord le calepinage (dessin des panneaux) avant de lancer le calcul de production.
        </div>`;
        if (calcBtn) calcBtn.disabled = true;
        return;
    }

    if (calcBtn) calcBtn.disabled = false;
    container.innerHTML = pvs.map((pv, i) => createPvFieldFromCalepinage(pv, i + 1, pvs.length)).join('');

    openSuffixes.forEach(suffix => {
        const panel = document.getElementById('pv_datasheet' + suffix);
        const toggleBtn = panel && panel.previousElementSibling;
        if (panel) panel.style.display = 'grid';
        if (toggleBtn && toggleBtn.tagName === 'BUTTON') {
            toggleBtn.textContent = 'Masquer les données fiche technique du panneau';
        }
    });

    let k = 1;
    while (document.getElementById('pv_track_' + k)) {
        toggleAngles('_' + k);
        k++;
    }
}


/* =====================================================================
   GESTION DES ONGLETS
===================================================================== */
(function () {
  const buttons = document.querySelectorAll('.tab-btn');
  const panelIds = { tmy: 'panel-tmy', pv: 'panel-pv' };

  buttons.forEach(btn => btn.addEventListener('click', () => {
    buttons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(panelIds).forEach(id => document.getElementById(id).classList.remove('active'));
    document.getElementById(panelIds[btn.dataset.tab]).classList.add('active');
  }));
})();

/* =====================================================================
   UTILITAIRES
===================================================================== */
function clampLatLon(value, isLat) {
  if (value === '' || value === null || value === undefined) return null;
  const v = Number(value);
  if (isNaN(v)) return null;
  return isLat ? Math.max(-90, Math.min(90, v)) : Math.max(-180, Math.min(180, v));
}

function setStatus(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'status ' + (type || 'ok');
  el.innerHTML = msg;
}

function setProgress(pct, label) {
  const wrap = document.getElementById('progressWrap');
  const inner = document.getElementById('progressInner');
  const lbl = document.getElementById('progressLabel');
  if (!wrap) return;
  wrap.style.display = 'block';
  inner.style.width = pct + '%';
  if (lbl) lbl.textContent = label || '';
}

function hideProgress() {
  const wrap = document.getElementById('progressWrap');
  if (wrap) wrap.style.display = 'none';
  const inner = document.getElementById('progressInner');
  if (inner) inner.style.width = '0%';
}

/* =====================================================================
   GÉOLOCALISATION
===================================================================== */
function geoLocate(tab) {
  if (!navigator.geolocation) {
    setStatus('status', 'Géolocalisation non supportée par ce navigateur.', 'warn');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      const lt = pos.coords.latitude.toFixed(6);
      const lg = pos.coords.longitude.toFixed(6);

      if (tab === 'tmy' || tab === undefined) {
        document.getElementById('lat').value = lt;
        document.getElementById('lon').value = lg;
        updateUrlBox();
        setStatus('status', 'Coordonnées remplies ✅', 'ok');
      }
      if (tab === 'pv') {
        document.getElementById('pv_lat').value = lt;
        document.getElementById('pv_lon').value = lg;
        updatePVBox();
        setStatus('pv_status', 'Coordonnées remplies ✅', 'ok');
      }
    },
    function (err) {
      const msg = 'Échec géolocalisation : ' + err.message;
      if (tab === 'pv') setStatus('pv_status', msg, 'warn');
      else if (tab === 'excel') setStatus('excel_status', msg, 'warn');
      else setStatus('status', msg, 'warn');
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

/* =====================================================================
   ONGLET TMY – Construction URL & actions
===================================================================== */
function buildTmyUrl(overrides) {
  overrides = overrides || {};
  var lat = clampLatLon(document.getElementById('lat').value, true);
  var lon = clampLatLon(document.getElementById('lon').value, false);
  if (lat === null || lon === null) throw new Error('Latitude / Longitude invalides ou manquantes.');

  var apiVer = document.getElementById('v53').value;
  var base = 'https://re.jrc.ec.europa.eu/api/' + apiVer + '/tmy';
  var params = new URLSearchParams({
    lat: lat.toFixed(6),
    lon: lon.toFixed(6),
    usehorizon: document.getElementById('usehorizon').value,
    outputformat: ('outputformat' in overrides) ? overrides.outputformat : document.getElementById('outputformat').value,
    browser: ('browser' in overrides) ? overrides.browser : document.getElementById('browser').value
  });
  var sy = document.getElementById('startyear').value.trim();
  var ey = document.getElementById('endyear').value.trim();
  if (sy) params.set('startyear', sy);
  if (ey) params.set('endyear', ey);
  return base + '?' + params.toString();
}

function updateUrlBox() {
  try {
    document.getElementById('urlBox').textContent = buildTmyUrl();
    var lon = clampLatLon(document.getElementById('lon').value, false);
    if (lon !== null && lon >= -170 && lon <= -20) {
      setStatus('status', 'Coordonnées situées en zone Amériques : Veuillez sélectionner la base d\'irradiance PVGIS-NSRDB pour une précision optimale.', 'warn');
    } else {
      setStatus('status', 'URL prête ✅', 'ok');
    }
  } catch (e) {
    document.getElementById('urlBox').textContent = '';
    setStatus('status', e.message, 'warn');
  }
}

function openTmy() {
  try {
    window.open(buildTmyUrl(), '_blank', 'noopener');
    setStatus('status', 'Téléchargement lancé.', 'ok');
  } catch (e) {
    setStatus('status', e.message, 'error');
  }
}

function copyUrl(which) {
  try {
    var url = buildTmyUrl();
    navigator.clipboard.writeText(url).then(function () {
      setStatus('status', 'URL copiée ✅', 'ok');
    });
  } catch (e) {
    setStatus('status', e.message, 'error');
  }
}

/* =====================================================================
   GESTION DU CACHE MÉTÉO (FRONTEND)
   Le serveur ne renvoie que les bases situées à 10 km au plus du site (rayon_max_km) ; sans choix,
   le calcul utilise la plus proche à 5 km au plus (rayon_auto_km), sinon télécharge PVGIS.
   Choix persistés dans solarProjectData.pvgisSettings (cachedDbId, forceApi), partagés entre
   Paramètres du projet et le modal de production.
===================================================================== */
let cachedDbRequestSeq = 0;
let cachedDbReloadTimer = null;
// Paramètres (lat/lon/horizon/version) de la dernière liste chargée avec succès : la liste n'en dépend
// que d'eux. Sans ce filtre, chaque écriture de solarProjectData par une autre fenêtre (événement
// 'storage' — ex. sauvegarde automatique de la page parente toutes les 3 s) relançait
// GET /api/tmy_cache en boucle.
let lastCachedDbQuery = null;

function cachedDbQueryParams() {
  const lat = clampLatLon(document.getElementById('pv_lat')?.value, true);
  const lon = clampLatLon(document.getElementById('pv_lon')?.value, false);
  const usehorizon = document.getElementById('pv_usehorizon')?.value || '1';
  const pvVersion = document.getElementById('pv_version')?.value || 'v5_3';
  return { lat, lon, usehorizon, pvVersion, key: [lat, lon, usehorizon, pvVersion].join('|') };
}

function savePvgisCacheSettings(changes) {
  try {
    const projectData = getProjectData();
    projectData.pvgisSettings = Object.assign({}, projectData.pvgisSettings || {}, changes);
    localStorage.setItem('solarProjectData', JSON.stringify(projectData));
  } catch (e) {
    console.warn("Choix de la base météo locale non enregistré.", e);
  }
}

function setCachedDbNote(msg) {
  const note = document.getElementById('pv_cached_db_note');
  if (note) note.textContent = msg || '';
}

/** Coupe la liste (et le bouton admin) quand le téléchargement PVGIS est forcé. */
function syncCachedDbControls() {
  const select = document.getElementById('pv_cached_db');
  const force = document.getElementById('pv_force_api');
  const delBtn = document.getElementById('pv_cached_db_delete');
  const forced = !!(force && force.checked);
  if (select) select.disabled = forced;
  if (delBtn) delBtn.disabled = forced || !(select && select.value);
}

function formatDistanceKm(km) {
  return Number(km).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' km';
}

async function loadCachedDatabases() {
  const select = document.getElementById('pv_cached_db');
  if (!select) return;
  const { lat, lon, usehorizon, pvVersion, key } = cachedDbQueryParams();
  const seq = ++cachedDbRequestSeq;

  let data = { bases: [], rayon_auto_km: 5, rayon_max_km: 10 };
  let fetched = false;
  if (lat !== null && lon !== null) {
    try {
      const qs = new URLSearchParams({ lat, lon, usehorizon, pv_version: pvVersion });
      const response = await fetch(`/concevoir_mon_projet/api/tmy_cache?${qs}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
      fetched = true;
      if (seq === cachedDbRequestSeq) lastCachedDbQuery = key;
    } catch (e) {
      console.warn("Le cache météo n'a pas pu être chargé.", e);
    }
  }
  if (seq !== cachedDbRequestSeq) return; // une requête plus récente (site/réglages modifiés) prime

  const bases = Array.isArray(data.bases) ? data.bases : [];
  const autoBase = bases.find(b => b.auto);
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = autoBase
    ? `-- Automatique : base locale à ${formatDistanceKm(autoBase.distance_km)} --`
    : `-- Automatique : téléchargement PVGIS (aucune base locale à ${formatDistanceKm(data.rayon_auto_km)} au plus) --`;
  const options = [auto];
  bases.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    const horizon = b.usehorizon === '1' ? 'avec horizon' : 'sans horizon';
    const version = String(b.pv_version || '').replace('_', '.');
    opt.textContent = `Base locale à ${formatDistanceKm(b.distance_km)} (${horizon}, ${version})`
      + (b.auto ? ' — utilisée par défaut' : '');
    options.push(opt);
  });
  select.replaceChildren(...options);

  // Restaure le choix enregistré s'il est toujours proposé ; sinon retour à l'automatique.
  const saved = getProjectData().pvgisSettings || {};
  if (saved.cachedDbId && bases.some(b => b.id === saved.cachedDbId)) {
    select.value = saved.cachedDbId;
    setCachedDbNote('');
  } else {
    select.value = '';
    if (saved.cachedDbId && fetched) {
      savePvgisCacheSettings({ cachedDbId: '' });
      setCachedDbNote("La base locale choisie précédemment n'est plus disponible : sélection automatique.");
    } else if (!fetched && lat !== null && lon !== null) {
      setCachedDbNote('Liste des bases météo locales indisponible pour le moment.');
    } else {
      setCachedDbNote(bases.length
        ? `${bases.length} base(s) locale(s) à ${formatDistanceKm(data.rayon_max_km)} au plus du projet.`
        : `Aucune base locale à ${formatDistanceKm(data.rayon_max_km)} au plus du projet.`);
    }
  }
  syncCachedDbControls();
}

/** Recharge la liste après un changement de site ou de réglages PVGIS (regroupe les rafales). */
function scheduleCachedDbReload() {
  clearTimeout(cachedDbReloadTimer);
  cachedDbReloadTimer = setTimeout(() => {
    // Site et réglages inchangés : liste déjà à jour, le choix enregistré est réappliqué par
    // applyPvgisCacheSettings() (appelé par l'écouteur 'storage').
    if (cachedDbQueryParams().key === lastCachedDbQuery) return;
    loadCachedDatabases();
  }, 300);
}

function onCachedDbChange() {
  const select = document.getElementById('pv_cached_db');
  if (!select) return;
  const force = document.getElementById('pv_force_api');
  if (select.value && force) force.checked = false;
  savePvgisCacheSettings({ cachedDbId: select.value, forceApi: !!(force && force.checked) });
  setCachedDbNote(select.value ? 'Base locale imposée pour le calcul.' : '');
  syncCachedDbControls();
}

function onForceApiChange() {
  const force = document.getElementById('pv_force_api');
  const select = document.getElementById('pv_cached_db');
  if (!force) return;
  if (force.checked && select) select.value = '';
  savePvgisCacheSettings({ forceApi: force.checked, cachedDbId: select ? select.value : '' });
  syncCachedDbControls();
}

/** Applique les choix enregistrés (case « Forcer ») ; la liste est restaurée par loadCachedDatabases(). */
function applyPvgisCacheSettings(projectData) {
  const s = (projectData || getProjectData()).pvgisSettings || {};
  const force = document.getElementById('pv_force_api');
  if (force) force.checked = s.forceApi === true;
  const select = document.getElementById('pv_cached_db');
  if (select && s.cachedDbId !== undefined && [...select.options].some(o => o.value === (s.cachedDbId || ''))) {
    select.value = s.cachedDbId || '';
  }
  syncCachedDbControls();
}

/** Suppression (administrateur) de la base sélectionnée ; le serveur revérifie le droit. */
async function deleteSelectedCachedDb() {
  const select = document.getElementById('pv_cached_db');
  if (!select || !select.value) return;
  const label = select.options[select.selectedIndex]?.textContent || '';
  if (!confirm(`Supprimer définitivement cette base météo locale ?\n${label}`)) return;
  try {
    const response = await fetch(`/concevoir_mon_projet/api/tmy_cache/${encodeURIComponent(select.value)}`, {
      method: 'DELETE', credentials: 'same-origin'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 404) throw new Error(body.error || `HTTP ${response.status}`);
    savePvgisCacheSettings({ cachedDbId: '' });
    await loadCachedDatabases();
    setCachedDbNote(response.status === 404 ? 'Base déjà supprimée.' : 'Base météo locale supprimée.');
  } catch (e) {
    setCachedDbNote(`Suppression impossible : ${e.message}`);
  }
}

/** Encadré « Source des données » des résultats (production et autoconsommation). */
function formatMeteoSourceHtml(summary) {
  const src = summary.meteo_source || {};
  const warning = src.warning ? `<br>⚠️ ${src.warning}` : '';
  if (summary.used_cache) {
    const dist = (src.distance_km !== null && src.distance_km !== undefined) ? ` située à ${formatDistanceKm(src.distance_km)} du site` : '';
    const how = src.mode === 'selection' ? ', choisie par l\'utilisateur' : (src.mode === 'auto' ? ', sélection automatique' : '');
    return `<div style="margin-top: 1rem; padding: 10px; background: #e0f2fe; border-left: 4px solid #3b82f6; border-radius: 4px; font-size: 0.95rem;">
                ℹ️ <strong>Source des données :</strong> Base météorologique locale en cache${dist}${how} (PVGIS non sollicité).${warning}
            </div>`;
  }
  const forced = src.forced ? ' (téléchargement forcé)' : '';
  return `<div style="margin-top: 1rem; padding: 10px; background: #fef9c3; border-left: 4px solid #eab308; border-radius: 4px; font-size: 0.95rem;">
                🌐 <strong>Source des données :</strong> Téléchargement direct depuis l'API européenne PVGIS${forced}.${warning}
            </div>`;
}

function toggleBifacial(selectEl, suffix) {
  // CONTRAT D'INTERFACE : Les champs albedo et bifaciality ne sont pertinents
  // et ne doivent être exposés à l'utilisateur que si pv_type == 'bifacial'
  const isBifacial = selectEl.value === 'bifacial';
  const displayStyle = isBifacial ? 'block' : 'none';
  const albedoGroup = document.getElementById('pv_albedo' + suffix)?.closest('.form-group');
  const bifiGroup = document.getElementById('pv_bifaciality' + suffix)?.closest('.form-group');
  if (albedoGroup) albedoGroup.style.display = displayStyle;
  if (bifiGroup) bifiGroup.style.display = displayStyle;
}

/** Rejette les valeurs hors intervalle pour un champ numérique (ex. albédo, bifacialité). */
function validateRangeInput(inputEl, min, max, label) {
  const val = parseFloat(inputEl.value);
  if (inputEl.value === '' || isNaN(val) || val < min || val > max) {
    setStatus('pv_status', `${label} doit être compris entre ${min} et ${max}.`, 'error');
    inputEl.value = inputEl.defaultValue;
  }
}

/** Affiche/masque la fiche technique du panneau (masquée par défaut pour alléger la vue). */
function togglePanelDatasheet(btnEl, suffix) {
  const panel = document.getElementById('pv_datasheet' + suffix);
  if (!panel) return;
  const isHidden = (panel.style.display === 'none' || getComputedStyle(panel).display === 'none');
  panel.style.display = isHidden ? 'grid' : 'none';
  if (btnEl) btnEl.textContent = isHidden ? 'Masquer les données fiche technique du panneau' : 'Voir données fiche technique du panneau';
}

/* =====================================================================
   ONGLET PV HORAIRE (seriescalc) – URL & actions
===================================================================== */
function toggleAngles(suffix) {
  var track = document.getElementById('pv_track' + suffix).value;
  var disabled = (track === '2'); // bi-axial : angle/aspect non pertinents
  document.querySelectorAll(`#pv_field_${suffix.replace('_','')} .angleWrap input, #pv_field_${suffix.replace('_','')} .aspectWrap input`).forEach(function (el) {
    el.disabled = disabled;
    el.placeholder = disabled ? '—' : (el.id === 'pv_angle' ? 'ex. 30' : 'ex. 0');
  });
}

function updatePVBox() {
  // Fonction conservée vide pour éviter les erreurs si appelée par les listeners, 
  // mais l'affichage de l'URL est supprimé.
  var lat = clampLatLon(document.getElementById('pv_lat').value, true);
  var lon = clampLatLon(document.getElementById('pv_lon').value, false);

  if (lon !== null && lon >= -170 && lon <= -20) {
    setStatus('pv_status', 'Coordonnées situées en zone Amériques : Veuillez sélectionner la base d\'irradiance PVGIS-NSRDB pour une précision optimale.', 'warn');
  }
}

// Variable globale pour stocker les résultats (utile pour le rapport PDF)
let pvSimulationResults = null;

/**
 * Construit l'objet de configuration PV à partir du formulaire (lat/lon + champs PV).
 * Réutilisé par calculatePV(), exportPvExcel() et par main_autoconso.js (calcul automatique
 * de la production en arrière-plan lors du clic sur "Calculer et visualiser").
 * @param {number} timeStep - Pas de temps souhaité (minutes).
 * @returns {object|null} Les paramètres PV, ou null si la configuration est invalide.
 */
function buildPvParams(timeStep) {
  var lat = clampLatLon(document.getElementById('pv_lat').value, true);
  var lon = clampLatLon(document.getElementById('pv_lon').value, false);
  if (lat === null || lon === null) {
    return null;
  }

  // Collecte dynamique des champs PV rendus depuis le calepinage (solarProjectData.calculatedPvs)
  var fields = [];
  document.querySelectorAll('#pv-fields-container .pv-field-card').forEach((card) => {
    const suffix = card.dataset.suffix;
    let peakEl = document.getElementById('pv_peak' + suffix);
    if (peakEl && parseFloat(peakEl.value) > 0) {
      const plantId = document.getElementById('pv_plant' + suffix)?.value || '1';
      fields.push({
        id: card.dataset.pvId || ('PV' + suffix.replace('_', '')),
        panel_ref: document.getElementById('pv_panel_ref' + suffix)?.value || 'N/A',
        peak_power: parseFloat(peakEl.value),
        losses: parseFloat(document.getElementById('pv_loss' + suffix)?.value || 14),
        // NOUVEAU: indicateur transmis au backend — la perte d'ombrage entre sheds est déjà intégrée
        // ci-dessus dans `losses` (cf. SummaryModal.js::updateSummary, perteSystemeCombinee) ; ce flag
        // sert uniquement de traçabilité (affichage/rapport), aucun recalcul backend n'y est conditionné.
        is_shed_layout: card.dataset.isShedLayout === 'true',
        tech: document.getElementById('pv_tech' + suffix)?.value || 'crystSi',
        pv_type: document.getElementById('pv_type' + suffix)?.value || 'monofacial',
        albedo: parseFloat(document.getElementById('pv_albedo' + suffix)?.value || 0.2),
        bifaciality: parseFloat(document.getElementById('pv_bifaciality' + suffix)?.value || 0.7),
        cells_in_series: parseInt(document.getElementById('pv_cells' + suffix)?.value || 60),
        mount: document.getElementById('pv_mount' + suffix)?.value || 'free',
        track: document.getElementById('pv_track' + suffix)?.value || '0',
        angle: document.getElementById('pv_angle' + suffix)?.value || '30',
        aspect: document.getElementById('pv_aspect' + suffix)?.value || '0',
        tempcoeff: document.getElementById('pv_tempcoeff' + suffix)?.value || '0.29',
        tempcoeff_voc: parseFloat(document.getElementById('pv_tempcoeff_voc' + suffix)?.value || -0.27),
        tempcoeff_isc: parseFloat(document.getElementById('pv_tempcoeff_isc' + suffix)?.value || 0.04),
        inv_limit: parseFloat(document.getElementById('pv_inv_limit' + suffix)?.value || 0),
        inv_cons: parseFloat(document.getElementById('pv_inv_cons' + suffix)?.value || 0),
        inv_eff: parseFloat(document.getElementById('pv_inv_eff' + suffix)?.value || 0),
        vmp: parseFloat(document.getElementById('pv_vmp' + suffix)?.value || 31.0),
        imp: parseFloat(document.getElementById('pv_imp' + suffix)?.value || 12.9),
        voc: parseFloat(document.getElementById('pv_voc' + suffix)?.value || 37.1),
        isc: parseFloat(document.getElementById('pv_isc' + suffix)?.value || 13.7),
        active_area_ratio: (parseFloat(document.getElementById('pv_active_ratio' + suffix)?.value) || 90) / 100,
        plant_id: plantId
      });
    }
  });

  if (fields.length === 0) {
    return null;
  }

  // NOTE : les pertes de transit réseau ACC (#pv_grid_loss) ne sont volontairement PAS incluses
  // ici : ce paramètre n'est pertinent que pour le calcul d'Autoconsommation Collective, qui
  // l'envoie séparément au backend (cf. main_autoconso.js, formData 'grid_loss_percent',
  // uniquement lorsque studyType === 'acc'). Les inclure ici enverrait une donnée non utilisée
  // (et potentiellement trompeuse) à /calculate_pv pour tous les autres types de calcul.
  const params = {
    lat: lat,
    lon: lon,
    fields: fields,
    pv_version: document.getElementById('pv_version').value,
    aux_cons: parseFloat(document.getElementById('pv_aux_cons')?.value || 3.5),
    usehorizon: document.getElementById('pv_usehorizon').value,
    raddb: document.getElementById('pv_raddb').value,
    startyear: document.getElementById('pv_start').value.trim(),
    endyear: document.getElementById('pv_end').value.trim(),
    time_step: timeStep || 60,
    force_api: document.getElementById('pv_force_api')?.checked || false,
    // Base locale imposée (liste « Bases météo en cache ») ; vide = sélection automatique (≤ 5 km).
    tmy_cache_id: (document.getElementById('pv_force_api')?.checked ? '' : document.getElementById('pv_cached_db')?.value) || null,
    advanced_sim: buildAdvancedSimParams(),
    // Scène 3D d'ombrage proche (panneaux, bâtiments, arbres, blocs...) écrite avec les champs PV par
    // le calepinage (cf. calepinage_maison_ombrage_scene.js) ; null = calcul sans ombrage proche.
    shading_scene: getShadingScene()
  };

  renderPvSummary(params);
  return params;
}

/** Scène d'ombrage proche enregistrée avec les champs PV (solarProjectData.shadingScene), ou null. */
function getShadingScene() {
  const scene = getProjectData().shadingScene;
  if (!(scene && scene.receivers && Object.keys(scene.receivers).length)) return null;
  // Scène rattachée à un projet : jamais celle d'un autre projet (reste d'une session précédente,
  // autre onglet...). Le serveur refait la vérification, avec l'appartenance du projet au compte.
  let projetActif = null;
  try { projetActif = localStorage.getItem('current_projet_id'); } catch (e) { projetActif = null; }
  if (!scene.projet_id || !projetActif || String(scene.projet_id) !== String(projetActif)) {
    console.warn(`[Ombrage proche] Scène 3D ignorée : elle appartient au projet ${scene.projet_id || '(inconnu)'}, projet actif ${projetActif || '(aucun)'}.`);
    return null;
  }
  return scene;
}

/** Ligne de synthèse de la scène d'ombrage proche (contrôle avant calcul). */
function renderShadingSceneSummary(params) {
  const scene = params.shading_scene;
  if (!scene) {
    return `<div style="margin-top: 0.5rem;"><strong>Ombrage proche 3D :</strong> aucune scène 3D — calcul sans ombrage proche.</div>`;
  }
  const ids = params.fields.map((f) => String(f.id));
  const couverts = ids.filter((id) => scene.receivers[id]).length;
  const objets = new Set((scene.occluders || []).map((o) => o.label)).size;
  const ignores = (scene.ignored_objects || []).map((o) => o.label);
  const ignoresHtml = ignores.length
    ? `<br><span style="color: var(--warning-color, #b45309);">⚠️ Non pris en compte (volume d'ombrage non défini) : ${[...new Set(ignores)].join(', ')}</span>`
    : '';
  return `<div style="margin-top: 0.5rem;"><strong>Ombrage proche 3D :</strong> ${couverts}/${ids.length} champ(s) modélisé(s), ${objets} volume(s) masquant(s) (bâtiments, acrotères, obstacles, objets 3D), plus les panneaux des autres champs.${ignoresHtml}</div>`;
}

/**
 * Carte "Simulations avancées" : bridage onduleur mensuel (0% = aucune limitation, 100% =
 * onduleur totalement éteint — production nulle — ce mois-là) + un coefficient de température
 * Pmax UNIQUE (pas une valeur par mois) appliqué à toute l'année. Le tableau/le coefficient ne
 * sont lus (et n'entrent dans le payload envoyé au backend) que si la case "Appliquer ces
 * paramètres avancés" est cochée : sinon on renvoie {enabled:false} sans détail, pour ne pas
 * faire varier inutilement la config envoyée/le calcul quand ce mode est inactif (cf.
 * checkPvDataStillFresh() côté main_autoconso.js, qui compare cette configuration à celle du
 * dernier calcul pour détecter un calepinage modifié).
 */
function buildAdvancedSimParams() {
  const enabled = document.getElementById('pv_advanced_sim_enabled')?.checked || false;
  if (!enabled) {
    return { enabled: false };
  }
  const tempcoeffPmax = parseFloat(document.getElementById('pv_advanced_tempcoeff')?.value) || -0.29;
  const monthly = [];
  for (let month = 1; month <= 12; month++) {
    monthly.push({
      month: month,
      bridage_percent: parseFloat(document.getElementById('adv_bridage_' + month)?.value) || 0
    });
  }
  return { enabled: enabled, tempcoeff_pmax: tempcoeffPmax, monthly: monthly };
}

/** Affiche/masque le tableau mensuel de la carte "Simulations avancées" (fermé par défaut). */
function toggleAdvancedSimTable() {
  const wrap = document.getElementById('advanced-sim-table-wrap');
  const btn = document.getElementById('btn-toggle-advanced-sim');
  if (!wrap) return;
  const nowVisible = wrap.style.display === 'none' || !wrap.style.display;
  wrap.style.display = nowVisible ? 'block' : 'none';
  if (btn) btn.textContent = nowVisible ? '📅 Masquer le tableau mensuel' : '📅 Afficher le tableau mensuel';
}

/** Force une valeur numérique d'entrée dans [min, max] (carte "Simulations avancées"). */
function clampAdvancedInput(el, min, max) {
  if (!el || el.value === '') return;
  const v = parseFloat(el.value);
  if (isNaN(v)) return;
  el.value = Math.min(max, Math.max(min, v));
}
window.toggleAdvancedSimTable = toggleAdvancedSimTable;
window.clampAdvancedInput = clampAdvancedInput;

/**
 * Affiche la synthèse lisible des données qui seront envoyées à /calculate_pv,
 * pour vérification par l'utilisateur avant de lancer (ou relancer) le calcul.
 * @param {object|null} params - Objet retourné par buildPvParams(), ou null si invalide.
 */
function renderPvSummary(params) {
  const el = document.getElementById('pv-summary-content');
  if (!el) return;

  if (!params) {
    el.innerHTML = `<em style="color: var(--danger-color, #dc2626);">Configuration incomplète : vérifiez la localisation et le calepinage.</em>`;
    return;
  }

  const fieldsRows = params.fields.map(f => `
    <tr>
      <td>${f.id}</td>
      <td>${f.panel_ref || 'N/A'}</td>
      <td>${f.peak_power.toFixed(2)} kWc</td>
      <td>${f.angle}°</td>
      <td>${f.aspect}°</td>
      <td>${f.losses}%</td>
      <td>${f.inv_limit.toFixed(2)} kW</td>
      <td>${f.tech}${f.pv_type === 'bifacial' ? ' (bifacial)' : ''}</td>
      <td>${f.pv_type === 'bifacial' ? f.bifaciality : '—'}</td>
      <td>${f.pv_type === 'bifacial' ? f.albedo : '—'}</td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="grid" style="margin-bottom: 0.75rem;">
      <div class="col-4"><strong>Localisation :</strong> ${params.lat.toFixed(6)}, ${params.lon.toFixed(6)}</div>
      <div class="col-4"><strong>Version API :</strong> ${params.pv_version} — <strong>Horizon :</strong> ${params.usehorizon === '1' ? 'Oui' : 'Non'}</div>
      <div class="col-4"><span title="Indicatif : PVGIS sélectionne automatiquement sa source et construit le TMY sur cette période historique fixe, non modifiable"><strong>Base d'irradiance (indicatif) :</strong> ${params.raddb} — TMY ${params.startyear}-${params.endyear}</span></div>
    </div>
    <table class="seasonal-table" style="width:100%; border-collapse: collapse; text-align:center; font-size: 0.85rem;">
      <thead>
        <tr><th>Champ</th><th>Réf Panneau choisi</th><th>Puissance</th><th>Tilt</th><th>Azimut</th><th>Pertes</th><th>Onduleur</th><th>Technologie</th><th>Bifacialité</th><th>Albédo</th></tr>
      </thead>
      <tbody>${fieldsRows}</tbody>
    </table>
    <div class="grid" style="margin-top: 0.75rem;">
      <div class="col-6"><strong>Conso. auxiliaire :</strong> ${params.aux_cons} W</div>
      <div class="col-6"><strong>Affectation prod. hors ACC (si Autoconsommation Collective) :</strong> ${document.getElementById('pv_grid_loss')?.value || 0}%</div>
    </div>
    ${renderShadingSceneSummary(params)}
  `;
}

async function calculatePV() {
  var resultsSection = document.getElementById('results-section');
  var calcBtn = document.querySelector('button[onclick="calculatePV()"]');

  // Calcul global standardisé sur 60 min pour les KPIs
  var params = buildPvParams(60);
  if (!params) {
    setStatus('pv_status', 'Latitude / Longitude invalides, ou aucun champ PV configuré avec une puissance crête > 0.', 'error');
    return;
  }

  /* --- UI : démarrage --- */
  if (calcBtn) calcBtn.disabled = true;
  if (resultsSection) resultsSection.style.display = 'none';
  setProgress(20, 'Calcul en cours…');
  setStatus('pv_status', 'Calcul de la production en cours…', 'ok');

  try {
    const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
    const response = await fetch(`${apiPrefix}/calculate_pv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Erreur lors du calcul.");
    }

    pvSimulationResults = await response.json();
    pvSimulationResults.params = params;
    window.dispatchEvent(new CustomEvent('solarDataUpdated'));

    setProgress(100, 'Calcul terminé.');
    setStatus('pv_status',
      '✅ Calcul terminé avec succès.',
      'ok');
    if (resultsSection) resultsSection.style.display = 'block';
    updateResultsDisplay(); // Mettre à jour automatiquement les résultats

  } catch (err) {
    setStatus('pv_status', '❌ ' + (err.message || 'Erreur inattendue.'), 'error');
    hideProgress();
  } finally {
    if (calcBtn) calcBtn.disabled = false;
    setTimeout(function () { hideProgress(); }, 3000);
  }
}

async function exportPvExcel(timeStep = 60) {
  var btn = document.getElementById('btn_' + timeStep);

  /* --- Validation des entrées (réutilisation) --- */
  var params = buildPvParams(timeStep);
  if (!params) {
    setStatus('pv_status', 'Latitude / Longitude invalides, ou aucun champ PV configuré avec une puissance crête > 0.', 'error');
    return;
  }
  var lat = params.lat;
  var lon = params.lon;

  /* --- Vérification SheetJS --- */
  if (typeof XLSX === 'undefined') {
    setStatus('pv_status', 'La bibliothèque SheetJS (XLSX) n\'est pas chargée.', 'error');
    return;
  }

  if (btn) btn.disabled = true;
  setProgress(20, `Génération des données d'ensoleillement (${timeStep} min)…`);
  setStatus('pv_status', `Génération Excel en cours (${timeStep} min)…`, 'ok');

  try {
    const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
    const response = await fetch(`${apiPrefix}/calculate_pv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Erreur lors du calcul.");
    }

    const data = await response.json();
    setProgress(70, 'Création du fichier Excel…');

    var prodRows = [
      ['Longitude', parseFloat(lon.toFixed(6))],
      ['Latitude', parseFloat(lat.toFixed(6))],
      [],
      ['Horodatage (UTC)', 'Production Totale Somme (kW)']
    ];

    var hourlyData = data.hourly;
    for (var i = 0, len = hourlyData.length; i < len; i++) {
      prodRows.push([new Date(hourlyData[i].time), hourlyData[i].P_kW]);
    }

    var wb = XLSX.utils.book_new();
    var wsProd = XLSX.utils.aoa_to_sheet(prodRows, { cellDates: true });

    for (var r = 4; r < prodRows.length; r++) {
      var rowNum = r + 1;
      if (wsProd['A' + rowNum]) wsProd['A' + rowNum].z = 'yyyy-mm-dd hh:mm';
      if (wsProd['B' + rowNum]) wsProd['B' + rowNum].z = '0.0000';
    }
    wsProd['!cols'] = [{ wch: 22 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsProd, 'Production');

    var latStr = (lat >= 0 ? lat.toFixed(4) + 'N' : Math.abs(lat).toFixed(4) + 'S');
    var lonStr = (lon >= 0 ? lon.toFixed(4) + 'E' : Math.abs(lon).toFixed(4) + 'W');
    var totalPeak = params.fields.reduce((sum, f) => sum + f.peak_power, 0);
    var fileName = `PV_Horaire_Consolide_${latStr}_${lonStr}_${totalPeak}kWp_${timeStep}min.xlsx`;

    XLSX.writeFile(wb, fileName);

    setProgress(100, 'Export terminé.');
    setStatus('pv_status', `✅ Fichier exporté : <strong>${fileName}</strong>`, 'ok');

  } catch (err) {
    setStatus('pv_status', '❌ ' + (err.message || 'Erreur inattendue.'), 'error');
    hideProgress();
  } finally {
    if (btn) btn.disabled = false;
    setTimeout(function () { hideProgress(); }, 3000);
  }
}

async function exportPvPDF() {
  if (!pvSimulationResults) return;
  // On récupère aussi les données de l'onglet autoconso si elles existent
  const autoconsoResults = JSON.parse(localStorage.getItem('solar_sim_data') || 'null');

  try {
    // Préparation de la charge utile avec les résultats et la couleur du thème
    const payload = {
      ...pvSimulationResults, // Données de production
      // Ajout des données de consommation pour enrichir le graphique
      hourly_data: autoconsoResults ? autoconsoResults.hourly_data : null,
      theme_color: localStorage.getItem('themeColor') || '#3b82f6'
    };
    setStatus('pv_status', 'Génération du PDF...', 'ok');
    const apiPrefix = window.location.pathname.startsWith('/concevoir_mon_projet') ? '/concevoir_mon_projet' : '';
    const response = await fetch(`${apiPrefix}/generate_pv_pdf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      let errorMessage = "Erreur lors de la génération du PDF.";
      try {
        const errData = await response.json();
        if (errData && errData.error) {
          errorMessage += ` Détail : ${errData.error}`;
        }
      } catch (jsonError) { /* La réponse n'était pas JSON */ }
      throw new Error(errorMessage);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "Rapport_Production_PV.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    setStatus('pv_status', '✅ Rapport PDF téléchargé.', 'ok');
  } catch (e) {
    setStatus('pv_status', `❌ ${e.message}`, 'error');
  }
}

/**
 * Perte d'ombrage proche (scène 3D) d'un champ ou de la synthèse. null/undefined = champ absent de la
 * scène 3D (non calculé), affiché « — » pour ne pas le confondre avec une perte nulle.
 */
// Avertissements de l'ombrage proche 3D renvoyés par le serveur (scène refusée : autre projet/compte,
// trop volumineuse ; éléments de géométrie écartés ; objets sans volume d'ombrage).
function nearShadingWarningsHtml(summary) {
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lignes = (summary && Array.isArray(summary.near_shading_warnings)) ? summary.near_shading_warnings.slice() : [];
  const ignores = (summary && Array.isArray(summary.near_shading_ignored_objects)) ? summary.near_shading_ignored_objects : [];
  if (ignores.length) {
    lignes.push(`Objets 3D non pris en compte dans l'ombrage (volume non défini) : ${[...new Set(ignores.map((o) => o.label || o.typeKey))].join(', ')}.`);
  }
  if (!lignes.length) return '';
  return `<div style="margin-top: 1rem; padding: 10px; background: #fff7ed; border-left: 4px solid #f97316; border-radius: 4px; font-size: 0.95rem;">
    ⚠️ <strong>Ombrage proche 3D :</strong><br>${lignes.map(esc).join('<br>')}
  </div>`;
}

function formatNearShadingLoss(value) {
  if (value === null || value === undefined || !isFinite(value)) return '—';
  return `${Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}
window.formatNearShadingLoss = formatNearShadingLoss;

function updateResultsDisplay() {
  if (!pvSimulationResults || !pvSimulationResults.summary) {
    setStatus('pv_status', 'Veuillez d\'abord générer une courbe de charge pour voir les indicateurs.', 'warn');
    return;
  }
  const summary = pvSimulationResults.summary;
  const fields = pvSimulationResults.fields || [];

  let rowsHtml = '';
  fields.forEach(f => {
    rowsHtml += `<tr>
                <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb); font-weight: 600;">${f.id}</td>
                <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">${f.peak_power.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</td>
                <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">${(f.total_production_kwh / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">${f.specific_production.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</td>
                <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">${formatNearShadingLoss(f.near_shading_loss_percent)}</td>
                <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">${f.performance_ratio.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</td>
            </tr>`;
  });

  rowsHtml += `<tr class="total-row" style="background-color: #f1f5f9; font-weight: 700;">
            <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">TOTAL / MOYENNE</td>
            <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">${summary.peak_power_kw.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</td>
            <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">${(summary.total_production_kwh / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">${summary.specific_production.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</td>
            <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">${formatNearShadingLoss(summary.near_shading_loss_percent)}</td>
            <td style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">${summary.performance_ratio.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</td>
        </tr>`;

  let tableHeader = `
            <thead style="background-color: var(--accent-primary, #ef4444); color: white;">
                <tr>
                    <th style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">Champ PV</th>
                    <th style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">Puissance (kWc)</th>
                    <th style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">Prod (MWh)</th>
                    <th style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">Productible (kWh/kWc/an)</th>
                    <th style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);" title="Perte d'irradiance due aux ombres de la scène 3D (arbres, blocs, bâtiments, acrotères, autres champs PV). Déjà déduite de la production et du PR. « — » : champ absent de la scène 3D.">Perte d'ombrage proche (%)</th>
                    <th style="padding: 8px; border: 1px solid var(--border-color, #e5e7eb);">PR (%)</th>
                </tr>
            </thead>
        `;

  let warningHtml = summary.clipping_loss_kwh > 0 ?
    `<div style="color: var(--danger-color, #ef4444); margin-top: 1rem; font-weight: 600; padding: 10px; background: #fee2e2; border-radius: 4px;">
                ⚠️ Perte par écrêtage onduleur estimée : ${summary.clipping_loss_kwh.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh
            </div>` : '';
  warningHtml += nearShadingWarningsHtml(summary);

  let variabilityHtml = '';
  if (summary.irradiation_variability_kwh !== undefined && summary.irradiation_variability_kwh > 0) {
    variabilityHtml = `
            <div style="margin-top: 1rem; padding: 10px; background: #f8fafc; border-left: 4px solid var(--accent-primary); border-radius: 4px; font-size: 0.95rem;">
                <strong>Variabilité d'irradiation estimée (Base TMY) :</strong> 
                ${summary.irradiation_variability_kwh.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kWh/m² 
                (± ${summary.irradiation_variability_percent.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %)
            </div>`;
  }

  let cacheInfoHtml = formatMeteoSourceHtml(summary);

  const resultsContainer = document.getElementById('multi-pv-results');
  if (resultsContainer) {
    const tagName = resultsContainer.tagName.toUpperCase();

    if (tagName === 'TBODY') {
      // Si l'utilisateur a mis l'id sur un <tbody>, on met à jour les lignes et on insère le <thead> dans la table parente
      resultsContainer.innerHTML = rowsHtml;
      const table = resultsContainer.closest('table');
      if (table && !table.querySelector('thead')) {
        table.insertAdjacentHTML('afterbegin', tableHeader);
      }
      if (warningHtml && table && !document.getElementById('clipping-warn')) {
        table.insertAdjacentHTML('afterend', `<div id="clipping-warn">${warningHtml}</div>`);
      }
      if (variabilityHtml && table && !document.getElementById('variability-info')) {
        table.insertAdjacentHTML('afterend', `<div id="variability-info">${variabilityHtml}</div>`);
      }
      if (cacheInfoHtml && table && !document.getElementById('cache-info')) {
        table.insertAdjacentHTML('afterend', `<div id="cache-info">${cacheInfoHtml}</div>`);
      }
    } else if (tagName === 'TABLE') {
      // Si l'id est sur la <table> elle-même
      resultsContainer.innerHTML = tableHeader + `<tbody>${rowsHtml}</tbody>`;
      if (warningHtml && !document.getElementById('clipping-warn')) {
        resultsContainer.insertAdjacentHTML('afterend', `<div id="clipping-warn">${warningHtml}</div>`);
      }
      if (variabilityHtml && !document.getElementById('variability-info')) {
        resultsContainer.insertAdjacentHTML('afterend', `<div id="variability-info">${variabilityHtml}</div>`);
      }
      if (cacheInfoHtml && !document.getElementById('cache-info')) {
        resultsContainer.insertAdjacentHTML('afterend', `<div id="cache-info">${cacheInfoHtml}</div>`);
      }
    } else {
      // Fonctionnement classique si l'id est sur une <div>
      resultsContainer.innerHTML = `
                    <table class="seasonal-table" style="width:100%; border-collapse: collapse; text-align: center;">
                        ${tableHeader}
                        <tbody>${rowsHtml}</tbody>
                    </table>
                    ${warningHtml}
                    ${variabilityHtml}
                    ${cacheInfoHtml}
                `;
    }
  }

  renderPvCharts(pvSimulationResults);
}

let pvProductionCurveChart = null;
let pvMonthlyProdChart = null;

/**
 * Graphiques du panneau "Résultats de Simulation" : courbe de production (journées types
 * été/hiver, déjà agrégées côté backend pour le rapport PDF) et histogramme des 12 mois.
 */
function renderPvCharts(results) {
  if (typeof Chart === 'undefined' || !results) return;

  const typicalDays = results.typical_days || {};
  const hours = typicalDays.hours || Array.from({ length: 24 }, (_, i) => i);
  const curveCanvas = document.getElementById('pv-production-curve-chart');
  if (curveCanvas) {
    if (pvProductionCurveChart) { pvProductionCurveChart.destroy(); pvProductionCurveChart = null; }
    pvProductionCurveChart = new Chart(curveCanvas, {
      type: 'line',
      data: {
        labels: hours.map(h => `${String(h).padStart(2, '0')}h`),
        datasets: [
          { label: 'Journée type été', data: typicalDays.summer || [], borderColor: '#ef4444', backgroundColor: 'transparent', tension: 0.3, pointRadius: 0 },
          { label: 'Journée type hiver', data: typicalDays.winter || [], borderColor: '#3b82f6', backgroundColor: 'transparent', tension: 0.3, pointRadius: 0 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Puissance (kW)' } } }
      }
    });
  }

  const monthlyCanvas = document.getElementById('pv-monthly-chart');
  if (monthlyCanvas) {
    if (pvMonthlyProdChart) { pvMonthlyProdChart.destroy(); pvMonthlyProdChart = null; }
    const monthLabels = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'];
    pvMonthlyProdChart = new Chart(monthlyCanvas, {
      type: 'bar',
      data: {
        labels: monthLabels,
        datasets: [{
          label: 'Production mensuelle (kWh)',
          data: results.monthly_production_kwh || [],
          backgroundColor: 'rgba(239, 68, 68, 0.7)',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Énergie (kWh)' } } }
      }
    });
  }
}

/* =====================================================================
   LISTENERS & VALEURS PAR DÉFAUT
===================================================================== */
/* 1. Synchronisation des Données (Data Binding) */
function syncInputs() {
  const pairs = [
    ['lat', 'pv_lat'],
    ['lon', 'pv_lon'],
    ['usehorizon', 'pv_usehorizon'],
    ['startyear', 'pv_start'],
    ['endyear', 'pv_end'],
    ['v53', 'pv_version']
  ];
  pairs.forEach(function (pair) {
    var el1 = document.getElementById(pair[0]);
    var el2 = document.getElementById(pair[1]);
    if (!el1 || !el2) return;
    el1.addEventListener('input', function () { el2.value = el1.value; });
    el2.addEventListener('input', function () { el1.value = el2.value; });
  });
}

document.querySelectorAll('#tmyForm input, #tmyForm select').forEach(function (el) {
  el.addEventListener('input', updateUrlBox);
});
document.querySelectorAll('#pvForm input, #pvForm select').forEach(function (el) {
  el.addEventListener('input', updatePVBox);
});

/**
 * Remplit et verrouille les champs de localisation (pv_lat/pv_lon) depuis le projet
 * (adresse ou centre des formes dessinées), avec repli sur des valeurs par défaut si
 * aucune localisation n'est trouvée (auquel cas les champs restent modifiables).
 */
/**
 * Applique une latitude/longitude aux champs PV et verrouille l'UI en conséquence.
 * Utilisé au chargement (applyProjectLocation) et en direct (voir écouteur
 * 'projectLocationUpdated' plus bas) dès qu'une adresse/un marqueur est choisi
 * dans l'onglet "Créer un nouveau projet".
 */
function setPvLocation(lat, lon) {
  const latEl = document.getElementById('pv_lat');
  const lonEl = document.getElementById('pv_lon');
  if (!latEl || !lonEl) return;
  const lockNote = document.getElementById('pv_location_lock_note');
  const geoBtn = document.querySelector('button[onclick="geoLocate(\'pv\')"]');

  latEl.value = Number(lat).toFixed(6);
  lonEl.value = Number(lon).toFixed(6);
  latEl.readOnly = true;
  lonEl.readOnly = true;
  if (lockNote) lockNote.style.display = 'inline';
  if (geoBtn) { geoBtn.disabled = true; geoBtn.style.opacity = '0.5'; }
  scheduleCachedDbReload(); // bases locales proposées = celles à 10 km au plus du nouveau site
}

function applyProjectLocation(projectData) {
  let lat = null, lon = null;
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
        lat = coords.lat; lon = coords.lng;
      } else if (projectData.shapes && Object.keys(projectData.shapes).length > 0) {
        const firstShapeId = Object.keys(projectData.shapes)[0];
        lat = projectData.shapes[firstShapeId].center.lat;
        lon = projectData.shapes[firstShapeId].center.lng;
      }
    }
  } catch (e) { console.warn("Erreur récupération localisation du projet", e); }

  if (lat !== null && lon !== null) {
    setPvLocation(lat, lon);
  } else {
    const latEl = document.getElementById('pv_lat');
    const lonEl = document.getElementById('pv_lon');
    if (latEl) latEl.value = '47.273849';
    if (lonEl) lonEl.value = '-2.213741';
  }
}

/** Remplit les champs PVGIS (lecture seule) depuis solarProjectData.pvgisSettings. */
function applyPvgisSettings(projectData) {
  const s = getPvgisSettings(projectData);
  document.getElementById('pv_raddb').value = s.raddb;
  document.getElementById('pv_version').value = s.version;
  document.getElementById('pv_usehorizon').value = String(s.usehorizon);
  document.getElementById('pv_start').value = s.startyear;
  document.getElementById('pv_end').value = s.endyear;
  applyPvgisCacheSettings(projectData);
}

/**
 * Remplit Cons. Auxiliaire / Pertes de transit réseau (lecture seule) depuis
 * solarProjectData.totals, saisis dans le tableau "Paramètres Généraux de
 * Production" du résumé calepinage (SummaryModal).
 */
function applyGeneralProductionParams(projectData) {
  const totals = (projectData || getProjectData()).totals || {};
  const auxEl = document.getElementById('pv_aux_cons');
  const gridLossEl = document.getElementById('pv_grid_loss');
  if (auxEl && totals.auxConsW !== undefined) auxEl.value = totals.auxConsW;
  if (gridLossEl && totals.gridLossPercent !== undefined) gridLossEl.value = totals.gridLossPercent;
}

window.addEventListener('DOMContentLoaded', function () {
  syncInputs();

  // Onglet TMY (indépendant du calcul de production, valeurs par défaut classiques)
  document.getElementById('lat').value = '47.273849';
  document.getElementById('lon').value = '-2.213741';
  document.getElementById('startyear').value = '2005';
  document.getElementById('endyear').value = '2023';
  updateUrlBox();

  const projectData = getProjectData();

  applyPvgisSettings(projectData);
  applyGeneralProductionParams(projectData);
  applyProjectLocation(projectData);
  renderPvFieldsFromCalepinage();

  updatePVBox();
  loadCachedDatabases(); // Bases locales à 10 km au plus du site, choix enregistré restauré
  document.getElementById('pv_force_api')?.addEventListener('change', onForceApiChange);
  // Bases compatibles = même horizon et même version PVGIS (Paramètres du projet)
  ['pv_usehorizon', 'pv_version', 'pv_lat', 'pv_lon'].forEach(id =>
    document.getElementById(id)?.addEventListener('change', scheduleCachedDbReload));
  buildPvParams(60); // Peuple la synthèse dès l'ouverture, sans lancer de calcul

  // Rafraîchir la synthèse en direct dès qu'un champ éditable change
  document.getElementById('pvForm')?.addEventListener('input', () => buildPvParams(60));
  document.getElementById('pvForm')?.addEventListener('change', () => buildPvParams(60));

  // Réagir si les réglages PVGIS ou le calepinage sont modifiés dans un autre onglet/fenêtre
  window.addEventListener('storage', (e) => {
    if (e.key === 'solarProjectData') {
      const fresh = getProjectData();
      applyPvgisSettings(fresh);
      applyGeneralProductionParams(fresh);
      renderPvFieldsFromCalepinage();
      scheduleCachedDbReload();
      buildPvParams(60);
    }
  });

});

// Synchronisation en direct : dès qu'une adresse est choisie (autocomplétion) ou qu'un
// marqueur est placé/déplacé sur la carte dans l'onglet "Créer un nouveau projet", on
// répercute immédiatement la position sur Latitude/Longitude ici (onglet "Mode de calcul
// et Normes"), sans attendre une sauvegarde ni un rechargement de page.
// Événement émis par parametreProjetMap/initialisationMap.js:addOrUpdateParametreMarker().
// Enregistré au niveau module (et non dans DOMContentLoaded) pour ne pas dépendre de l'ordre
// d'exécution relatif entre les deux scripts : initialisationMap.js peut restaurer un marqueur
// existant (et donc émettre cet événement) dès son propre DOMContentLoaded.
document.addEventListener('projectLocationUpdated', (e) => {
  const { lat, lng } = e.detail || {};
  if (lat === undefined || lng === undefined || lat === null || lng === null) return;
  setPvLocation(lat, lng);
  buildPvParams(60);
});

window.calculatePV = calculatePV;
window.buildPvParams = buildPvParams;
window.exportPvExcel = exportPvExcel;
window.exportPvPDF = exportPvPDF;

// Exposition au Scope Global pour les actions 'onclick'
window.openTmy = openTmy;
window.copyUrl = copyUrl;
window.geoLocate = geoLocate;
window.toggleAngles = toggleAngles;
window.toggleBifacial = toggleBifacial;
window.validateRangeInput = validateRangeInput;
window.togglePanelDatasheet = togglePanelDatasheet;
window.onCachedDbChange = onCachedDbChange;
window.onForceApiChange = onForceApiChange;
window.deleteSelectedCachedDb = deleteSelectedCachedDb;
window.formatMeteoSourceHtml = formatMeteoSourceHtml;
// Ancien nom (l'option remplaçait à tort les coordonnées du site par celles de la base) : alias conservé.
window.loadCachedCoordinates = onCachedDbChange;
window.updateResultsDisplay = updateResultsDisplay;
