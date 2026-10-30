/**
 * Base de données "Onduleurs", partagée entre la page "Liste de matériel"
 * (Liste_de_materiel/liste_de_materiels.js) et la section "Système" du calepinage.
 *
 * Extrait de liste_de_materiels.js (qui déclarait inverterDB en local) pour permettre sa réutilisation
 * dans calepinage.html sans dupliquer les données ni créer un fichier dédié par page. Chargé AVANT
 * liste_de_materiels.js (cf. menu.html) : ce dernier référence désormais window.inverterDB au lieu de
 * déclarer sa propre copie.
 *
 * NOTE : le champ "conso" (consommation propre de l'onduleur, en W) est absent des fiches techniques
 * déjà présentes dans le fichier d'origine (qui ne portait que ref/power/rendement/type/max_injection/
 * hybride/opti). Valeur par défaut fixée à 3W ; à ajuster ligne par ligne avec la fiche technique
 * constructeur avant tout usage dans un calcul certifiant (P90, etc.) — modifiable directement dans la
 * modale "BD onduleurs" (colonnes éditables + bouton Modifier).
 *
 * Persistance : les ajouts/modifications/suppressions faits depuis la modale sont sauvegardés dans
 * localStorage (ONDULEUR_STORAGE_KEY) et rechargés au démarrage, pour survivre à un rafraîchissement de
 * page — contrairement aux onduleurs personnalisés ajoutés depuis "Liste de matériel" (saveCustomInverter),
 * qui restaient jusqu'ici en mémoire uniquement pour la session en cours.
 */
const ONDULEUR_STORAGE_KEY = 'onduleursDB_savedData';
// Incrémenter à chaque correction du catalogue par défaut ci-dessous (DEFAULT_INVERTER_DB) : sans
// ce numéro de version, un navigateur ayant déjà une BD onduleurs en localStorage (persistée par
// persistInverterDB()) restait figé indéfiniment sur l'ancienne version des valeurs par défaut,
// même après correction du code — ex. "Comp. Optimiseur" affiché "Non" pour SUN2000-50KTL-M3 à
// l'ouverture du modal alors que le catalogue courant indique "Oui". loadInverterDB() régénère les
// entrées de catalogue par défaut à partir de DEFAULT_INVERTER_DB dès que cette version change,
// tout en conservant les onduleurs personnalisés ajoutés par l'utilisateur (fab/ref absents du
// catalogue par défaut).
const ONDULEUR_DB_VERSION = 2;
const ONDULEUR_DB_VERSION_KEY = 'onduleursDB_version';

// NOTE : "power_nominal" (Puissance nominale, kVA) est distincte de "power" (Puissance Max, kVA
// déjà existante) — colonne ajoutée à la BD sans données constructeur précises pour les entrées
// par défaut ci-dessous : initialisée à la même valeur que "power" (à ajuster ligne par ligne avec
// la fiche technique constructeur, comme "conso" cf. note plus haut).
const DEFAULT_INVERTER_DB = {
  'Huawei': [
    { ref: 'SUN2000-50KTL-M3', power_nominal: 50, power: 50, rendement: 98.5, type: 'Triphasé', max_injection: 55, hybride: 'Non', opti: 'Oui', conso: 3 },
    { ref: 'SUN2000-100KTL-M2', power_nominal: 100, power: 100, rendement: 98.6, type: 'Triphasé', max_injection: 110, hybride: 'Non', opti: 'Non', conso: 3 }
  ],
  'SMA': [
    { ref: 'Sunny Tripower X25', power_nominal: 25, power: 25, rendement: 98.3, type: 'Triphasé', max_injection: 25, hybride: 'Non', opti: 'Non', conso: 3 },
    { ref: 'Sunny Tripower X60', power_nominal: 60, power: 60, rendement: 98.8, type: 'Triphasé', max_injection: 60, hybride: 'Non', opti: 'Non', conso: 3 }
  ],
  'SUNGROW': [
    { ref: 'SG50CX-P2', power_nominal: 50, power: 50, rendement: 98.6, type: 'Triphasé', max_injection: 50, hybride: 'Non', opti: 'Non', conso: 3 },
    { ref: 'SG125CX-P2', power_nominal: 125, power: 125, rendement: 98.5, type: 'Triphasé', max_injection: 125, hybride: 'Non', opti: 'Non', conso: 3 }
  ],
  'SOLAREDGE': [
    { ref: 'SE66K', power_nominal: 66.6, power: 66.6, rendement: 98.3, type: 'Triphasé', max_injection: 66.6, hybride: 'Non', opti: 'Oui', conso: 3 },
    { ref: 'SE100K', power_nominal: 100, power: 100, rendement: 98.3, type: 'Triphasé', max_injection: 100, hybride: 'Non', opti: 'Oui', conso: 3 }
  ]
};

function loadInverterDB() {
  try {
    const saved = localStorage.getItem(ONDULEUR_STORAGE_KEY);
    if (!saved) return null;

    const savedVersion = parseInt(localStorage.getItem(ONDULEUR_DB_VERSION_KEY), 10);
    if (savedVersion === ONDULEUR_DB_VERSION) {
      return JSON.parse(saved);
    }

    // Version de catalogue différente (ou absente) : repartir du catalogue par défaut courant
    // pour les entrées connues (fab/ref présents dans DEFAULT_INVERTER_DB), en conservant tels
    // quels les onduleurs personnalisés de l'utilisateur (non présents dans le catalogue par défaut).
    const oldData = JSON.parse(saved);
    const merged = JSON.parse(JSON.stringify(DEFAULT_INVERTER_DB));
    Object.keys(oldData).forEach((fab) => {
      const defaultRefs = new Set((DEFAULT_INVERTER_DB[fab] || []).map((inv) => inv.ref));
      const customEntries = (oldData[fab] || []).filter((inv) => !defaultRefs.has(inv.ref));
      if (customEntries.length > 0) {
        merged[fab] = [...(merged[fab] || []), ...customEntries];
      }
    });
    return merged;
  } catch (e) {
    console.error('Erreur lors du chargement de la BD onduleurs', e);
  }
  return null;
}

function persistInverterDB() {
  try {
    localStorage.setItem(ONDULEUR_STORAGE_KEY, JSON.stringify(window.inverterDB));
    localStorage.setItem(ONDULEUR_DB_VERSION_KEY, String(ONDULEUR_DB_VERSION));
  } catch (e) {
    console.error('Erreur lors de la sauvegarde de la BD onduleurs', e);
  }
}

window.inverterDB = loadInverterDB() || DEFAULT_INVERTER_DB;
// Stabiliser immédiatement le marqueur de version après une éventuelle réconciliation ci-dessus,
// pour ne recalculer la fusion qu'une seule fois par changement de version de catalogue.
try {
  if (parseInt(localStorage.getItem(ONDULEUR_DB_VERSION_KEY), 10) !== ONDULEUR_DB_VERSION) {
    persistInverterDB();
  }
} catch (e) { /* ignore */ }

/**
 * Construit dynamiquement les lignes de la modale à partir de window.inverterDB. Chaque cellule est un
 * champ modifiable (Fabricant/Référence/Puissance Max/Rendement/Conso.) ; data-orig-fab/data-orig-ref
 * mémorisent la clé d'origine dans la BD pour que "Modifier"/"Supprimer" ciblent la bonne entrée même
 * après renommage du fabricant ou de la référence en cours d'édition.
 */
function renderOnduleurFavorisRows(tbody) {
  tbody.innerHTML = '';
  Object.keys(window.inverterDB).forEach(fab => {
    // Appareils génériques hors réseau (onduleurs_hors_reseau.js) : projets hors réseau seulement.
    if (window.OnduleursHorsReseau && !window.OnduleursHorsReseau.groupeVisibleDansFavoris(fab)) return;
    window.inverterDB[fab].forEach(inv => {
      tbody.appendChild(buildOnduleurRow(fab, inv));
    });
  });
}

/**
 * NOUVEAU (demande explicite : "champ de filtre de recherche dans le modal onduleur") : filtre les
 * lignes déjà rendues par renderOnduleurFavorisRows() (aucun appel serveur) — sous-chaîne insensible
 * à la casse/aux accents, sur Fabricant + Référence (les 2 seules colonnes d'identification). Simple
 * masquage (display), rien n'est retiré du DOM — "Modifier"/"Supprimer" continuent de fonctionner
 * normalement sur les lignes filtrées.
 */
window.filterOnduleurFavorisRows = function (query) {
  const modal = document.querySelector('[id^="favoritesOnduleursModal"]');
  const tbody = modal && modal.querySelector('tbody');
  if (!tbody) return;
  const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = normalize(query).trim();
  Array.from(tbody.rows).forEach((row) => {
    if (!needle) { row.style.display = ''; return; }
    const haystack = normalize(row.dataset.origFab) + ' ' + normalize(row.dataset.origRef);
    row.style.display = haystack.includes(needle) ? '' : 'none';
  });
};

function buildOnduleurRow(fab, inv) {
  const tr = document.createElement('tr');
  tr.dataset.origFab = fab || '';
  tr.dataset.origRef = (inv && inv.ref) || '';
  const type = (inv && inv.type) || 'Triphasé';
  const hybride = (inv && inv.hybride) || 'Non';
  const opti = (inv && inv.opti) || 'Non';
  tr.innerHTML = `
    <td><input type="text" class="form-control form-control-sm" value="${fab || ''}" /></td>
    <!-- CORRECTIF (demande explicite : "masquer le bouton d'import PDF dans le modal onduleur") :
         cellule entière masquée, en phase avec le <th> "Import" (calepinage.html) — le bouton et
         triggerImportFicheTechniqueOnduleur() restent intacts, réactivables en retirant ce style. -->
    <td style="display:none; text-align:center;">
      <button type="button" class="btn btn-sm btn-import-fiche" onclick="triggerImportFicheTechniqueOnduleur(this)"
        title="Importer une fiche technique PDF et remplir les champs automatiquement">
        <i class="fas fa-file-upload"></i>
      </button>
    </td>
    <td><input type="text" class="form-control form-control-sm" value="${(inv && inv.ref) || ''}" /></td>
    <td><input type="number" step="0.1" class="form-control form-control-sm" value="${(inv && inv.power_nominal) || ''}" /></td>
    <td><input type="number" step="0.1" class="form-control form-control-sm" value="${(inv && inv.power) || ''}" /></td>
    <td><input type="number" step="0.1" class="form-control form-control-sm" value="${(inv && inv.rendement) || ''}" /></td>
    <td><input type="number" step="0.1" class="form-control form-control-sm" value="${inv && inv.conso !== undefined ? inv.conso : 3}" /></td>
    <td>
      <select class="form-select form-select-sm">
        <option value="Triphasé"${type === 'Triphasé' ? ' selected' : ''}>Triphasé</option>
        <option value="Monophasé"${type === 'Monophasé' ? ' selected' : ''}>Monophasé</option>
      </select>
    </td>
    <td>
      <select class="form-select form-select-sm">
        <option value="Non"${hybride === 'Non' ? ' selected' : ''}>Non</option>
        <option value="Oui"${hybride === 'Oui' ? ' selected' : ''}>Oui</option>
      </select>
    </td>
    <td>
      <select class="form-select form-select-sm">
        <option value="Non"${opti === 'Non' ? ' selected' : ''}>Non</option>
        <option value="Oui"${opti === 'Oui' ? ' selected' : ''}>Oui</option>
      </select>
    </td>
    <td style="white-space: nowrap; min-width: 130px;">
      <div style="display: flex; flex-direction: column; gap: 4px; align-items: stretch;">
        <button type="button" class="btn btn-sm btn-choisir-fav" onclick="selectFavoriteOnduleur(this)">Choisir</button>
        <!-- CORRECTIF (demande explicite : l'utilisateur n'est pas autorisé à modifier ou supprimer
             un onduleur) : boutons masqués, updateOnduleurRow()/deleteOnduleurRow() restent intacts,
             réactivables en retirant ce style. -->
        <button type="button" class="btn btn-sm btn-modifier-onduleur" style="display:none;" onclick="updateOnduleurRow(this)">Modifier</button>
        <button type="button" class="btn btn-sm btn-supprimer-onduleur" style="display:none;" onclick="deleteOnduleurRow(this)">Supprimer</button>
        <button type="button" class="btn btn-sm btn-onduleur-details"
          data-details="${(JSON.stringify((inv && inv.details) || {})).replace(/"/g, '&quot;')}"
          onclick="window.toggleDetailRow(this)">+ détails</button>
      </div>
    </td>
  `;
  return tr;
}

// ---------------------------------------------------------------------------------------------
// Source de données : catalogue DB (table `onduleurs`, cf. plan "Modale Chaînes PV / Onduleur /
// Batterie + Pertes système détaillées", Phase 2). Fusionné dans window.inverterDB par référence
// (upsert), sans supprimer les onduleurs personnalisés ajoutés localement (+ Ajouter) qui restent
// absents du catalogue DB. Les champs électriques détaillés absents des colonnes déjà affichées
// dans le tableau (tension_max_dc, plage MPPT, courant max MPPT, rendement européen...) sont
// exposés via `.details`, consommé par le bouton "+ détails" (window.toggleDetailRow, cf.
// equipements_details_card.js).
// ---------------------------------------------------------------------------------------------
const ONDULEUR_CATALOG_ENDPOINT = '/concevoir_mon_projet/catalogue/onduleurs';

function findOnduleurGroupByRef(ref) {
  const fab = Object.keys(window.inverterDB).find(
    (f) => window.inverterDB[f].some((inv) => inv.ref === ref)
  );
  return fab || null;
}

function applyOnduleurCatalogFromApi(apiRows) {
  (apiRows || []).forEach((o) => {
    if (!o || !o.reference) return;
    // Recherche la référence dans TOUS les groupes existants avant d'en créer un nouveau, pour
    // éviter qu'une casse de fabricant différente entre la BD et le catalogue par défaut (ex:
    // "Sungrow" en BD vs "SUNGROW" dans DEFAULT_INVERTER_DB) ne crée un doublon visuel de la même
    // référence dans 2 groupes distincts.
    const existingFab = findOnduleurGroupByRef(o.reference);
    const fab = existingFab || o.fabricant || 'Autre';
    if (!window.inverterDB[fab]) window.inverterDB[fab] = [];
    const list = window.inverterDB[fab];
    const idx = list.findIndex((inv) => inv.ref === o.reference);
    const entry = {
      ref: o.reference,
      power_nominal: o.p_nominale_kva,
      power: o.p_apparente_max_kva,
      rendement: o.rendement_max_pct,
      conso: (idx >= 0 && list[idx].conso !== undefined) ? list[idx].conso : 3,
      type: o.type_tension || 'Triphasé',
      max_injection: o.courant_max_sortie_ac,
      hybride: o.hybride ? 'Oui' : 'Non',
      opti: o.compat_optimiseur ? 'Oui' : 'Non',
      // NOUVEAU (demande explicite, ajout matériels BD) : pilote le branchement du dimensionnement
      // côté chaines_pertes_modal.js (micro-onduleur vs chaîne) — lu directement depuis
      // window.onduleurCatalogFromApi (déjà complet, cf. fetchOnduleurCatalog ci-dessous), cette copie
      // sur `entry` sert surtout au filtre/affichage du tableau "favoris".
      technologie: o.technologie || null,
      type_connexion: o.type_connexion || null,
      details: {
        'Puissance max DC (kW)': o.puissance_max_dc_kw,
        'Nb entrées MPPT': o.nb_entrees_mppt_affichage,
        'Tension max DC (V)': o.tension_max_dc,
        'Tension min DC (V)': o.tension_min_dc,
        'Plage MPPT (V)': (o.plage_mppt_min != null && o.plage_mppt_max != null)
          ? `${o.plage_mppt_min} - ${o.plage_mppt_max}` : null,
        'Courant max MPPT (A)': o.courant_max_mppt,
        'Rendement européen (%)': o.rendement_europeen_pct,
        'Courant max sortie AC (A)': o.courant_max_sortie_ac,
        'Tension nominale AC': o.tension_nominale_ac,
        'Technologie': o.technologie,
        'Type de connexion': o.type_connexion,
        // Réservés aux micro-onduleurs (null pour tout autre type, cf. équipements_pv.py::Onduleur).
        'Tension de fonctionnement min/max (micro-ond.)': (o.tension_fonctionnement_min != null && o.tension_fonctionnement_max != null)
          ? `${o.tension_fonctionnement_min} - ${o.tension_fonctionnement_max} V` : null,
        'Nb max unités / circuit 20A mono (L+N) — tri (3L+N)': (o.nb_max_unites_mono_20a != null || o.nb_max_unites_tri_20a != null)
          ? `${o.nb_max_unites_mono_20a ?? '?'} / ${o.nb_max_unites_tri_20a ?? '?'}` : null,
        'Nb max unités / section câble AC mono — poly': (o.nb_max_unites_cable_mono != null || o.nb_max_unites_cable_poly != null)
          ? `${o.nb_max_unites_cable_mono ?? '?'} / ${o.nb_max_unites_cable_poly ?? '?'}` : null,
      },
    };
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], entry);
    else list.push(entry);
  });
}

function fetchOnduleurCatalog() {
  return fetch(ONDULEUR_CATALOG_ENDPOINT)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((data) => {
      if (!data || !data.success || !Array.isArray(data.onduleurs)) return;
      // Cache brut (champs électriques complets : tension_max_dc, plage_mppt_min/max,
      // courant_max_mppt...) consommé par chaines_pertes_modal.js (Phase 4) au moment de la
      // sélection, en plus de la fusion dans window.inverterDB ci-dessous (pour l'affichage tableau).
      window.onduleurCatalogFromApi = data.onduleurs;
      applyOnduleurCatalogFromApi(data.onduleurs);
      persistInverterDB();
      // Le cache brut vient d'être remplacé : y remettre les appareils génériques hors réseau
      // (catalogue virtuel, valeurs saisies par l'utilisateur, cf. onduleurs_hors_reseau.js).
      if (window.OnduleursHorsReseau) window.OnduleursHorsReseau.injecter();
      document.querySelectorAll('[id^="favoritesOnduleursModal"]').forEach((modal) => {
        if (modal.style.display === 'none') return;
        const tbody = modal.querySelector('tbody');
        if (tbody) renderOnduleurFavorisRows(tbody);
      });
    })
    .catch((e) => console.error('Erreur lors du chargement du catalogue onduleurs (BD)', e));
}

// Chargement initial best-effort : la modale s'ouvre instantanément avec le catalogue déjà en
// cache (localStorage/DEFAULT_INVERTER_DB) puis se rafraîchit dès que la BD répond.
fetchOnduleurCatalog();

function readOnduleurRowInputs(row) {
  const inputs = row.querySelectorAll('input');
  const selects = row.querySelectorAll('select');
  return {
    fab: inputs[0].value.trim(),
    ref: inputs[1].value.trim(),
    power_nominal: inputs[2].value,
    power: inputs[3].value,
    rendement: inputs[4].value,
    conso: inputs[5].value,
    type: selects[0] ? selects[0].value : 'Triphasé',
    hybride: selects[1] ? selects[1].value : 'Non',
    opti: selects[2] ? selects[2].value : 'Non'
  };
}

window.addOnduleurRow = function (btn) {
  const modal = btn.closest('[id^="favoritesOnduleursModal"]');
  const tbody = modal && modal.querySelector('tbody');
  if (!tbody) return;
  const row = buildOnduleurRow('', { ref: '', power_nominal: '', power: '', rendement: '', conso: 3, type: 'Triphasé', hybride: 'Non', opti: 'Non' });
  tbody.appendChild(row);
  row.scrollIntoView({ block: 'nearest' });
  const firstInput = row.querySelector('input');
  if (firstInput) firstInput.focus();
};

window.updateOnduleurRow = function (btn) {
  const row = btn.closest('tr');
  if (!row) return;
  const { fab, ref, power_nominal, power, rendement, conso, type, hybride, opti } = readOnduleurRowInputs(row);

  if (!fab || !ref) {
    if (window.showValidationAlert) window.showValidationAlert("Le fabricant et la référence sont requis.");
    return;
  }
  const p = parseFloat(power);
  if (isNaN(p) || p <= 0) {
    if (window.showValidationAlert) window.showValidationAlert("La puissance max doit être un nombre positif.");
    return;
  }

  // Retirer l'ancienne entrée (si la ligne provenait bien de la BD, pas d'une ligne nouvellement ajoutée)
  const origFab = row.dataset.origFab;
  const origRef = row.dataset.origRef;
  if (origFab && window.inverterDB[origFab]) {
    window.inverterDB[origFab] = window.inverterDB[origFab].filter(inv => inv.ref !== origRef);
    if (window.inverterDB[origFab].length === 0) delete window.inverterDB[origFab];
  }

  if (!window.inverterDB[fab]) window.inverterDB[fab] = [];
  window.inverterDB[fab].push({
    ref,
    power_nominal: parseFloat(power_nominal) || p,
    power: p,
    rendement: parseFloat(rendement) || 0,
    conso: parseFloat(conso) || 0,
    type,
    max_injection: p,
    hybride,
    opti
  });

  persistInverterDB();
  row.dataset.origFab = fab;
  row.dataset.origRef = ref;

  row.style.backgroundColor = '#d4edda';
  setTimeout(() => { row.style.backgroundColor = ''; }, 800);
};

window.deleteOnduleurRow = function (btn) {
  const row = btn.closest('tr');
  if (!row) return;

  const origFab = row.dataset.origFab;
  const origRef = row.dataset.origRef;
  if (origFab && window.inverterDB[origFab]) {
    window.inverterDB[origFab] = window.inverterDB[origFab].filter(inv => inv.ref !== origRef);
    if (window.inverterDB[origFab].length === 0) delete window.inverterDB[origFab];
    persistInverterDB();
  }

  row.remove();
};

window.openFavoritesOnduleurModal = function (btn) {
  fetchOnduleurCatalog();
  let suffix = '';
  const container = btn && btn.closest('.tab-content, .tab-pane, form, .form-container') || document.body;

  const puissanceInput = container.querySelector('[id^="puissance_onduleur"]');
  if (puissanceInput && puissanceInput.id.includes('-')) {
    suffix = puissanceInput.id.substring(puissanceInput.id.indexOf('-'));
  }

  let modal = document.getElementById('favoritesOnduleursModal' + suffix);
  if (!modal) {
    modal = container.querySelector('[id^="favoritesOnduleursModal"]');
  }
  if (!modal) {
    const allModals = document.querySelectorAll('[id^="favoritesOnduleursModal"]');
    modal = Array.from(allModals).find(m => m.id.endsWith(suffix)) || allModals[0];
  }
  if (!modal) {
    console.error("La modale favoritesOnduleursModal est introuvable.");
    return;
  }
  // CORRECTIF (bug rapporté : sélection d'un onduleur ne renseigne jamais
  // window.__chainesPertesGlobal.onduleur) : #favoritesOnduleursModal est un singleton (un seul
  // élément dans calepinage.html, pas de clonage par suffixe) — cette réassertion était auparavant
  // limitée au 1er fallback (ligne container.querySelector ci-dessus) et ne s'exécutait donc
  // jamais en pratique, puisque le modal est toujours résolu via le 2e fallback
  // (document.querySelectorAll ci-dessus) qui ne renommait pas modal.id. Or selectFavoriteOnduleur()
  // dérive son propre suffixe UNIQUEMENT depuis modal.id (`modal.id.includes('-')`), qui restait
  // donc toujours vide, bloquant le dispatch de l'event pvEquipementSelected sur toute sélection.
  if (suffix && !modal.id.endsWith(suffix)) {
    modal.id = 'favoritesOnduleursModal' + suffix;
  }

  if (modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  const tbody = modal.querySelector('tbody');
  if (tbody) renderOnduleurFavorisRows(tbody);
  // Repart sans filtre à chaque ouverture (une recherche laissée en cours la dernière fois ne doit
  // pas masquer silencieusement des lignes à la prochaine ouverture).
  const searchInput = modal.querySelector('#ondFavorisSearchInput');
  if (searchInput) searchInput.value = '';

  const modalContent = modal.querySelector('.modal-content');
  const modalHeader = modal.querySelector('.modal-header');

  if (modalContent) {
    modalContent.style.transform = 'translate(0px, 0px)';
    modalContent.dataset.currentX = 0;
    modalContent.dataset.currentY = 0;
  }

  if (modalContent && modalHeader && !modalContent.dataset.draggableInit) {
    modalContent.dataset.draggableInit = 'true';

    let isDragging = false;
    let initialX;
    let initialY;

    modalHeader.addEventListener('mousedown', (e) => {
      // CORRECTIF (nouveau champ de recherche dans l'entête) : sans cette exclusion, un clic pour
      // placer le curseur dans le champ de recherche démarrait le glissé-déplacé du modal entier au
      // lieu de donner le focus au champ.
      if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'INPUT') return;
      isDragging = true;
      let currentX = parseFloat(modalContent.dataset.currentX || 0);
      let currentY = parseFloat(modalContent.dataset.currentY || 0);
      initialX = e.clientX - currentX;
      initialY = e.clientY - currentY;
      modalHeader.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      let currentX = e.clientX - initialX;
      let currentY = e.clientY - initialY;
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

  modal.style.setProperty('display', 'flex', 'important');
  // CORRECTIF (bug rapporté : "le modal onduleur s'ouvre en arrière-plan de Configuration de
  // chaînes et pertes") : #chainesPertesModal (chaines_pertes_modal.js) utilise déjà z-index
  // 999999 — cette réassertion forçait justement CE modal à la même valeur à chaque ouverture,
  // le replaçant systématiquement derrière lui (à z-index égal, l'ordre DOM tranche). Valeur
  // strictement supérieure pour garantir l'affichage au-dessus, y compris lorsqu'il est rouvert
  // depuis l'intérieur de cette autre modale.
  modal.style.setProperty('z-index', '1000001', 'important');
};

window.closeFavoritesOnduleurModal = function (arg) {
  if (arg && arg.nodeType) {
    const modal = arg.closest('[id^="favoritesOnduleursModal"]');
    if (modal) modal.style.setProperty('display', 'none', 'important');
  }
};

window.selectFavoriteOnduleur = function (btn) {
  const row = btn.closest('tr');
  if (!row) return;

  // Lire les valeurs directement depuis les champs de la ligne (modifiables) plutôt que depuis la BD,
  // pour que le choix reflète une éventuelle édition non encore enregistrée via "Modifier".
  const { fab, ref, power, rendement, conso, type, hybride, opti } = readOnduleurRowInputs(row);

  const modal = btn.closest('[id^="favoritesOnduleursModal"]');
  let suffix = '';
  if (modal && modal.id.includes('-')) {
    suffix = modal.id.substring(modal.id.indexOf('-'));
  }

  const formContainer = btn.closest('.tab-pane') || (modal ? modal.parentElement : document.body);
  const getField = (baseId) => {
    return document.getElementById(baseId + suffix) || formContainer.querySelector('[id^="' + baseId + '"]');
  };

  const updateAndLockField = (baseId, val) => {
    const el = getField(baseId);
    if (!el || val === '' || val === undefined) return;
    el.value = val;
    el.readOnly = true;
    el.style.backgroundColor = '#e9ecef';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  updateAndLockField('puissance_onduleur', power);
  updateAndLockField('rendementOnduleur', rendement);
  updateAndLockField('consoOnduleur', conso);

  syncOnduleurToListeDeMateriel(fab, ref);

  // Notifie la modale "Chaînes / Onduleur / Batterie" (chaines_pertes_modal.js, Phase 4) de
  // l'onduleur choisi, avec ses champs électriques MPPT complets (absents du tableau/des champs
  // hôte ci-dessus) quand la référence est connue en base (window.onduleurCatalogFromApi).
  if (suffix) {
    const dbMatch = (window.onduleurCatalogFromApi || []).find((o) => o.reference === ref);
    document.dispatchEvent(new CustomEvent('pvEquipementSelected', {
      detail: {
        type: 'onduleur',
        pvId: suffix.substring(1),
        data: {
          fab, ref,
          ond_tension_max_dc: dbMatch ? dbMatch.tension_max_dc : 0,
          ond_tension_min_dc: dbMatch ? dbMatch.tension_min_dc : 0,
          ond_plage_mppt_min: dbMatch ? dbMatch.plage_mppt_min : 0,
          ond_plage_mppt_max: dbMatch ? dbMatch.plage_mppt_max : 0,
          ond_imax_mppt: dbMatch ? dbMatch.courant_max_mppt : 0,
          // CORRECTIF (bug rapporté : nombre de chaînes/MPPT erroné) : courant de court-circuit max
          // par MPPT, distinct de ond_imax_mppt ci-dessus (courant d'entrée/fonctionnement) — cf.
          // string_sizing_utils.js::calculateStringSizing.
          ond_courant_cc_max_mppt: dbMatch ? dbMatch.courant_cc_max_mppt : 0,
          // Nécessaires au sous-calculateur de perte ohmique AC (chaines_pertes_modal.js/
          // perte_systeme.js, Phase 6) : courant de dimensionnement du câble AC et tension de
          // référence (prioritaire sur le sélecteur pays quand connue).
          ond_courant_max_sortie_ac: dbMatch ? dbMatch.courant_max_sortie_ac : 0,
          ond_tension_nominale_ac: dbMatch ? dbMatch.tension_nominale_ac : null,
          ond_type_tension: dbMatch ? dbMatch.type_tension : null,
          // Puissance apparente max (kVA) : nécessaire au ratio AC/DC système (chaines_pertes_modal.js).
          // Colonne "Puissance Max" déjà affichée dans le tableau (mappée depuis p_apparente_max_kva,
          // cf. applyOnduleurCatalogFromApi ci-dessus), donc directement disponible via `power`.
          ond_p_apparente_max_kva: parseFloat(power) || 0,
          // Puissance DC max admise par l'onduleur (facultative en base) : contrôle bloquant du
          // modal Chaînes et pertes quand elle est renseignée.
          ond_puissance_max_dc_kw: dbMatch ? dbMatch.puissance_max_dc_kw : null,
          // Rendement/consommation : nécessaires pour propager l'onduleur partagé à TOUS les champs
          // PV du système (chaines_pertes_modal.js::propagateOnduleurToAllFields), pas seulement au
          // champ dont le bouton "BD onduleurs" a été cliqué (updateAndLockField ci-dessus ne
          // verrouille que ce champ-là).
          ond_rendement: parseFloat(rendement) || 0,
          ond_conso: parseFloat(conso) || 0,
          // NOUVEAU (demande explicite : dimensionnement selon le type d'onduleur — micro-onduleur/
          // optimiseur) : technologie pilote le branchement (chaîne classique vs micro-onduleur),
          // compat_optimiseur/hybride pilotent l'affichage du sélecteur optimiseur/batterie, les 4
          // nb_max_unites_* alimentent calculateMicroOnduleurSizing (string_sizing_utils.js).
          ond_technologie: dbMatch ? dbMatch.technologie : null,
          ond_compat_optimiseur: dbMatch ? !!dbMatch.compat_optimiseur : false,
          ond_hybride: dbMatch ? !!dbMatch.hybride : false,
          ond_nb_max_unites_mono_20a: dbMatch ? dbMatch.nb_max_unites_mono_20a : null,
          ond_nb_max_unites_tri_20a: dbMatch ? dbMatch.nb_max_unites_tri_20a : null,
          ond_nb_max_unites_cable_mono: dbMatch ? dbMatch.nb_max_unites_cable_mono : null,
          ond_nb_max_unites_cable_poly: dbMatch ? dbMatch.nb_max_unites_cable_poly : null,
          hasFullData: !!dbMatch,
        },
      },
    }));
  }

  setTimeout(() => closeFavoritesOnduleurModal(btn), 250);
};

/**
 * Déverrouille et vide les champs verrouillés par selectFavoriteOnduleur() (puissance_onduleur,
 * rendementOnduleur, consoOnduleur), pour permettre de choisir un autre onduleur ou de ressaisir
 * manuellement ces valeurs.
 */
window.clearOnduleurSelection = function (btn) {
  const container = btn.closest('.tab-pane') || btn.closest('.form-container') || document.body;

  const puissanceInput = container.querySelector('[id^="puissance_onduleur"]');
  let suffix = '';
  if (puissanceInput && puissanceInput.id.includes('-')) {
    suffix = puissanceInput.id.substring(puissanceInput.id.indexOf('-'));
  }

  const getField = (baseId) => document.getElementById(baseId + suffix) || container.querySelector('[id^="' + baseId + '"]');

  ['puissance_onduleur', 'rendementOnduleur', 'consoOnduleur'].forEach((baseId) => {
    const el = getField(baseId);
    if (!el) return;
    el.value = '';
    el.readOnly = false;
    el.style.backgroundColor = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

/**
 * Répercute l'onduleur choisi dans le calepinage vers la section "Configuration Onduleur AC" de la
 * modale "Liste de matériel" (#ond_fab/#ond_ref/...), déjà présente sur la même page (menu.html).
 * Réutilise updateInverterRefs()/updateInverterPower() de liste_de_materiels.js (toutes deux exposées
 * globalement en tant que déclarations `function` de script classique) plutôt que de dupliquer leur
 * logique de remplissage (puissance/rendement/type/hybride/opti/injection max sont déjà tous dérivés par
 * updateInverterPower() depuis le dataset de l'<option> #ond_ref sélectionnée) — garantit que "Liste de
 * matériel" reste exactement fonctionnel comme avant, que l'utilisateur y accède directement ou via
 * cette synchronisation.
 */
function syncOnduleurToListeDeMateriel(fab, ref) {
  const fabSelect = document.getElementById('ond_fab');
  const refSelect = document.getElementById('ond_ref');
  if (!fabSelect || !refSelect || !fab || !ref) return;

  // Un onduleur ajouté depuis la BD calepinage peut porter un fabricant absent des <option> figées de
  // "Liste de matériel" : on l'ajoute dynamiquement plutôt que d'échouer silencieusement.
  if (!Array.from(fabSelect.options).some(o => o.value === fab)) {
    const opt = document.createElement('option');
    opt.value = fab;
    opt.textContent = fab;
    fabSelect.appendChild(opt);
  }
  fabSelect.value = fab;
  if (typeof window.updateInverterRefs === 'function') window.updateInverterRefs();

  refSelect.value = ref;
  if (typeof window.updateInverterPower === 'function') window.updateInverterPower();
}
