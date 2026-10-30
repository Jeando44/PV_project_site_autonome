/**
 * Modale "Configuration des chaînes et perte système" — un seul bouton pour tout le système
 * (Summary Modal), couvrant tous les champs PV du projet à la fois. La batterie est TOUJOURS
 * choisie UNE SEULE FOIS pour tout le système. L'onduleur suit le mode "Choix des onduleurs"
 * (window.__chainesOnduleurMode, cf. onduleurModeToggleHTML) : 'global' (défaut, comportement
 * historique — un seul choix partagé, window.__chainesPertesGlobal.onduleur) ou 'perField' (un
 * choix par onglet pvId, window.__chainesOnduleurByField[pvId], bouton dédié dans la carte de
 * chaque onglet — cf. pvTabCardHTML). Dans les deux cas (réutilise les modales favoris Phase 2), le
 * dimensionnement de chaînes et la perte système détaillée sont ensuite calculés et distribués À
 * CHAQUE champ PV séparément.
 *
 * Deux granularités de champs à ne pas confondre (source de bugs corrigés dans cette version) :
 * - `pvId` (ex: "PV1") : un ONGLET du calepinage, qui porte UN SEUL jeu de champs onduleur
 *   (Nbre d'onduleurs, % rép. puissance, P_max/rendement/conso — masqués dans calepinage.html mais
 *   toujours UN par onglet, jamais un par pan de toiture).
 * - `subPvId` (ex: "PV1.1", "PV1.2"...) : un PAN de toiture au sein d'un onglet, produit par
 *   CalculationUtils.getSubFieldsData() pour les géométries Bipente_symetrique/Bipente_asymetrique/
 *   Multipente (jusqu'à 4 pans) — chaque pan a son propre panneau/comptage mais PARTAGE le même
 *   onduleur (même pvId) que les autres pans du même onglet.
 * Pour un onglet Monopente, subPvId === pvId (un seul pan).
 *
 * Séparation en 2 sections distinctes pour ne pas perdre l'utilisateur (demande explicite) :
 * - "Dimensionnement des chaînes par champ PV" (CE FICHIER, #chainesPertesChainsSection) : UNE carte
 *   "onduleur de l'onglet" par pvId unique (Nbre d'onduleurs/% rép. puissance, cf. plus haut) suivie
 *   d'UNE carte par pan (subPvId) : panneau (lecture seule), résultats de chaînage, Config.
 *   automatique/utilisateur, Ratio AC/DC du pan, et — uniquement quand l'onglet a plus d'un pan
 *   (Bipente/Multipente) — un coefficient de répartition de la puissance onduleur entre les pans.
 * - "Perte système détaillée à STC" (perte_systeme.js, #chainesPertesLossesSection) : pertes
 *   globales + surcharge par champ (pan).
 *
 * Le panneau N'EST PAS modifiable depuis cette modale (demande explicite : "ce panneau est lié au
 * calepinage, il doit pouvoir le modifier uniquement dans la page calepinage") — chaque pan affiche
 * sa référence panneau telle que choisie sur sa page de calepinage (lecture seule), résolue dans le
 * catalogue DB (window.panelCatalogFromApi, cf. bd_panneaux_pv.js) pour ses caractéristiques
 * électriques.
 *
 * Réutilise les modales favoris onduleurs/batteries (Phase 2) pour la sélection partagée : les
 * boutons "Choisir" ci-dessous déclenchent un clic sur N'IMPORTE QUELLE instance déjà présente
 * dans la page (une par onglet PV, mais toutes pointent vers le même catalogue), sans ciblage par
 * pvId puisque l'équipement est désormais global. Le résultat est capté via l'évènement
 * `pvEquipementSelected` (bd_onduleurs.js/bd_batteries.js), sans tenir compte de son pvId.
 *
 * L'onduleur choisi ici est propagé (rendement/conso/puissance) vers les champs hôtes masqués de
 * CHAQUE ONGLET (pas par pan, cf. propagateOnduleurToAllFields()), pas seulement celui dont le
 * bouton "BD onduleurs" a été cliqué, pour que SummaryModal.js reste correct pour tout le projet.
 *
 * Ce fichier expose window.computeFieldChainSizing() pour que perte_systeme.js puisse afficher le
 * dimensionnement de chaînes de chaque pan dans sa propre carte sans dupliquer le calcul.
 */

window.__chainesPertesGlobal = window.__chainesPertesGlobal || { onduleur: null, batterie: null, fields: [] };
// NOUVEAU (fonctionnalité "Câblage DC") : 'default' (les 3 sections déjà existantes) ou 'cablage'
// (vue dédiée, cablage_dc.js) — même motif "flag + re-render" que __chainesOnduleurMode, cf.
// renderChainesPertesModal().
window.__chainesPertesGlobal.activeView = window.__chainesPertesGlobal.activeView || 'default';
window.__chainesPertesGlobal.activeCablageField = window.__chainesPertesGlobal.activeCablageField || null;
// NOUVEAU (demande explicite : "afficher tous les pans en même temps" pour une toiture Bipente/
// Multipente) : tableau de fields (pans) au lieu d'un seul, utilisé par la carte de dimensionnement
// FUSIONNÉE (chainMergedFieldsCardHTML) — mutuellement exclusif avec activeCablageField ci-dessus
// (jamais les deux à la fois ; renderChainesPertesModal() vérifie l'un puis l'autre).
window.__chainesPertesGlobal.activeCablagePans = window.__chainesPertesGlobal.activeCablagePans || null;
// NOUVEAU (demande explicite : "Choix des onduleurs" — par champ PV OU un seul pour tout le
// système) : 'global' (défaut, comportement historique inchangé — g.onduleur, un seul choix
// partagé) ou 'perField' (un choix par onglet pvId, cf. window.__chainesOnduleurByField).
window.__chainesOnduleurMode = window.__chainesOnduleurMode || 'global';
window.__chainesOnduleurByField = window.__chainesOnduleurByField || {};
// État "par onglet" (pvId) : Nbre d'onduleurs / % rép. puissance, un seul jeu par onglet.
window.__chainesPvTabState = window.__chainesPvTabState || {};
// État "par pan" (subPvId) : Config. PV utilisateur + coefficient de répartition entre pans.
window.__chainesFieldState = window.__chainesFieldState || {};

// NOUVEAU (demande explicite : "Nbre d'onduleurs, % rép. puissance, Config. PV utilisateur ne sont
// pas persistants — conservez-les dans le local storage à la recharge de la page") : filet de
// sécurité local, INDÉPENDANT du round-trip résidentiel déjà en place pour nbOnduleurs/
// fractionRepartition (writeHostField → CM.setMaisonFieldResult, cf. plus bas) — ce dernier peut
// échouer silencieusement (état de la maison pas encore chargé dans savedStatesBySourceId au moment
// de l'appel, ou modal ouvert sur une page où CalepinageMaisonIndiv n'est pas chargé) ; ce cache
// localStorage GARANTIT la survie au rechargement de page quel que soit l'état de ce round-trip.
// Clé scopée par projet (même convention que le reste de l'appli, cf. 'current_projet_id' déjà
// utilisé par StorageManager.js/GoogleMaps.js/etc.) pour ne jamais mélanger 2 projets différents.
const CHAINES_PERTES_LOCAL_KEY_PREFIX = 'chaines_pertes_local_v1_';
function chainesPertesLocalStorageKey() {
  const projetId = (typeof localStorage !== 'undefined' && localStorage.getItem('current_projet_id')) || 'sans_projet';
  return CHAINES_PERTES_LOCAL_KEY_PREFIX + projetId;
}
function loadChainesPertesLocalCache() {
  try {
    const raw = localStorage.getItem(chainesPertesLocalStorageKey());
    return raw ? JSON.parse(raw) : { tabState: {}, fieldState: {} };
  } catch (e) {
    return { tabState: {}, fieldState: {} };
  }
}
// Appelée après chaque modification de nbOnduleurs/fractionRepartition/userConfig/chainsPerOnduleur —
// réécrit l'intégralité du cache depuis l'état en mémoire (coût négligeable, quelques champs par
// onglet/pan).
function saveChainesPertesLocalCache() {
  try {
    const tabState = {};
    Object.keys(window.__chainesPvTabState || {}).forEach((pvId) => {
      const s = window.__chainesPvTabState[pvId];
      tabState[pvId] = { nbOnduleurs: s.nbOnduleurs, fractionRepartition: s.fractionRepartition };
    });
    const fieldState = {};
    Object.keys(window.__chainesFieldState || {}).forEach((subPvId) => {
      const s = window.__chainesFieldState[subPvId];
      fieldState[subPvId] = { userConfig: s.userConfig, userConfigRows: s.userConfigRows, chainsPerOnduleur: s.chainsPerOnduleur };
    });
    const payload = { tabState, fieldState };
    if (Number.isFinite(window.__chainesPertesGlobal.coefSurdimensionnement)) {
      payload.coefSurdimensionnement = window.__chainesPertesGlobal.coefSurdimensionnement;
    }
    localStorage.setItem(chainesPertesLocalStorageKey(), JSON.stringify(payload));
  } catch (e) {
    // Quota dépassé ou storage indisponible (navigation privée…) : dégradation silencieuse, ce cache
    // n'est qu'un filet de sécurité, jamais la seule source de vérité.
  }
}

// NOUVEAU (demande explicite : "Coef. de surdimensionnement", défaut 1,25, plage 1-2) : ratio
// DC/AC maximal admis. Au-delà, le calcul est bloqué jusqu'à ce que l'utilisateur relève lui-même ce
// coefficient (jamais de correction automatique). Persisté dans le même cache local par projet que
// Nbre d'onduleurs / % rép. puissance, pour que le contrôle reste identique après rechargement et
// puisse s'exécuter au clic sur « Calculer » sans que ce modal ait été ouvert.
const COEF_SURDIMENSIONNEMENT_DEFAUT = 1.25;
const COEF_SURDIMENSIONNEMENT_RULE = { min: 1, max: 2, label: 'Coef. de surdimensionnement' };

function getCoefSurdimensionnement() {
  const g = window.__chainesPertesGlobal;
  if (!Number.isFinite(g.coefSurdimensionnement)) {
    const cached = parseFloat(loadChainesPertesLocalCache().coefSurdimensionnement);
    g.coefSurdimensionnement = (Number.isFinite(cached)
      && cached >= COEF_SURDIMENSIONNEMENT_RULE.min && cached <= COEF_SURDIMENSIONNEMENT_RULE.max)
      ? cached : COEF_SURDIMENSIONNEMENT_DEFAUT;
  }
  return g.coefSurdimensionnement;
}

// NOUVEAU (demande explicite : "certains onduleurs acceptent une puissance DC maximale") : donnée
// facultative du catalogue (colonne puissance_max_dc_kw), absente pour une partie des onduleurs.
// null quand elle n'est pas renseignée : le contrôle correspondant ne bloque alors jamais.
function getOnduleurPuissanceMaxDcKw(onduleurEntry) {
  const data = onduleurEntry && onduleurEntry.data;
  if (!data) return null;
  let valeur = parseFloat(data.ond_puissance_max_dc_kw);
  if (!(valeur > 0) && data.ref) {
    const dbMatch = (window.onduleurCatalogFromApi || []).find((o) => o.reference === data.ref);
    valeur = dbMatch ? parseFloat(dbMatch.puissance_max_dc_kw) : NaN;
  }
  return valeur > 0 ? valeur : null;
}

// Arrondi à 2 décimales avant comparaison : le contrôle porte sur la valeur AFFICHÉE (un ratio
// affiché 1.25 ne doit jamais être déclaré hors plage pour un coefficient de 1,25).
function ratioArrondi(valeur) {
  return Math.round(valeur * 100) / 100;
}

// NOUVEAU (demande explicite : "envoyer les résultats du dimensionnement des chaînes dans le
// backend, sauvegarde robuste sans multi routes") : équivalent résidentiel de la convention "champ
// hôte -<pvId>" (Pro/Grand projet) — un pvId résidentiel (sourceId d'une maison, cf.
// CM.getPvFieldsForChainesPertes()) n'a pas de tels champs DOM ; à défaut d'en trouver un, on écrit
// directement dans l'état de la maison via CM.setMaisonFieldResult() (calepinage_maison_
// orchestrateur.js), déjà persisté par la route unique existante /calepinage-maison/save (aucune
// nouvelle route, aucun nouveau code de sauvegarde). Comportement Pro/Grand strictement inchangé :
// ce repli ne s'active jamais quand le champ DOM `-<pvId>` existe déjà.
const CHAMPS_HOTE_VERS_STATE_MAISON = {
  puissance_onduleur: 'onduleurPuissanceKva',
  rendementOnduleur: 'onduleurRendement',
  consoOnduleur: 'onduleurConso',
  nbOnduleurs: 'nbOnduleurs',
  fractionRepartitionOnduleur: 'fractionRepartitionOnduleur',
};

function writeHostField(id, value, pvId) {
  if (value === undefined || value === null || value === '') return;
  const el = document.getElementById(id);
  if (el) {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (pvId && window.CalepinageMaisonIndiv && typeof window.CalepinageMaisonIndiv.setMaisonFieldResult === 'function') {
    const champ = id.slice(0, id.length - String(pvId).length - 1); // retire le suffixe "-<pvId>"
    const stateKey = CHAMPS_HOTE_VERS_STATE_MAISON[champ] || champ;
    window.CalepinageMaisonIndiv.setMaisonFieldResult(pvId, stateKey, value);
  }
}

// NOUVEAU (demande explicite : "valider les données dans le front et backend, éviter la collecte
// de données corrompues en base") : validation numérique partagée par tous les champs de ce modal
// (Nbre d'onduleurs, % répartition, températures) ET par perte_systeme.js (pertes système),
// exposée via window pour éviter toute duplication entre les deux fichiers. Ne modifie JAMAIS la
// valeur brute affichée dans l'input — se contente de dire si elle est exploitable, à charge de
// l'appelant de ne pas la propager (état interne, champ hôte, calcul) si `valid` est faux, et
// d'afficher `message` à l'utilisateur. Mêmes bornes que la validation backend
// (app/schemas/calepinage_dimensionnement_schemas.py) — à maintenir synchronisées.
function validateNumericField(rawValue, rule) {
  const parsed = parseFloat(rawValue);
  if (rawValue === '' || rawValue === null || rawValue === undefined || isNaN(parsed)) {
    return { valid: false, value: null, message: `${rule.label} : "${rawValue}" n'est pas un nombre valide.` };
  }
  const value = rule.integer ? Math.round(parsed) : parsed;
  if (value < rule.min || value > rule.max) {
    return { valid: false, value: null, message: `${rule.label} : doit être compris entre ${rule.min} et ${rule.max}.` };
  }
  return { valid: true, value, message: '' };
}

// Bascule l'affichage d'erreur d'un champ : `errorEl` est le petit <div> placé juste après l'input
// dans le HTML (cf. gabarits ci-dessous), jamais l'input lui-même qui reste tel que saisi.
function showFieldValidation(input, errorEl, result) {
  if (input) input.style.borderColor = result.valid ? '' : '#dc3545';
  if (errorEl) {
    errorEl.textContent = result.valid ? '' : result.message;
    errorEl.style.display = result.valid ? 'none' : 'block';
  }
}

window.ChainesPertesValidation = { validateNumericField, showFieldValidation };

// window.StringSizingUtils.parseUserStringConfig() attend un format numérique nu ("2x20+1x19") —
// le format demandé pour "Config. PV utilisateur" inclut les mots "Ch"/"PV" ("2 Ch x 20 PV + ...").
// On retire ces mots avant de déléguer au parseur existant plutôt que d'en dupliquer la logique.
function parseUserPvConfig(text) {
  const cleaned = String(text || '').replace(/ch/gi, '').replace(/pv/gi, '');
  return window.StringSizingUtils.parseUserStringConfig(cleaned);
}

function getUniquePvIds(fields) {
  const seen = [];
  (fields || []).forEach((f) => { if (!seen.includes(f.pvId)) seen.push(f.pvId); });
  return seen;
}

function getPansForPvId(pvId) {
  return (window.__chainesPertesGlobal.fields || []).filter((f) => f.pvId === pvId);
}

function getPvTabState(pvId) {
  if (!window.__chainesPvTabState[pvId]) {
    // CORRECTIF (demande explicite : "Nbre d'onduleurs, % rép. puissance... ne sont pas persistants
    // à la recharge de la page") : priorité au cache localStorage (filet de sécurité fiable, cf.
    // loadChainesPertesLocalCache) — repli sur les champs hôtes (masqués) SEULEMENT s'il n'y a rien
    // en cache, pour ne pas revenir silencieusement aux défauts.
    const cached = loadChainesPertesLocalCache().tabState[pvId];
    if (cached) {
      window.__chainesPvTabState[pvId] = {
        nbOnduleurs: cached.nbOnduleurs || 1,
        fractionRepartition: cached.fractionRepartition != null ? cached.fractionRepartition : 100,
      };
      return window.__chainesPvTabState[pvId];
    }
    const nbEl = document.getElementById('nbOnduleurs-' + pvId);
    const fracEl = document.getElementById('fractionRepartitionOnduleur-' + pvId);
    window.__chainesPvTabState[pvId] = {
      nbOnduleurs: (nbEl && nbEl.value) ? (parseInt(nbEl.value, 10) || 1) : 1,
      fractionRepartition: (fracEl && fracEl.value) ? (parseFloat(fracEl.value) || 100) : 100,
    };
  }
  return window.__chainesPvTabState[pvId];
}

function getChainsFieldState(field) {
  const subPvId = field.subPvId;
  if (!window.__chainesFieldState[subPvId]) {
    const nbPans = getPansForPvId(field.pvId).length || 1;
    // CORRECTIF (demande explicite : "Config. PV utilisateur ne persiste pas à la recharge de la
    // page") : amorce depuis le cache localStorage quand il existe (cf. loadChainesPertesLocalCache).
    const cached = loadChainesPertesLocalCache().fieldState[subPvId];
    window.__chainesFieldState[subPvId] = {
      userConfig: (cached && cached.userConfig) || '',
      userConfigRows: (cached && cached.userConfigRows) || [{ count: '', panels: '' }],
      // Répartition de la puissance onduleur de l'onglet entre ses pans (Bipente/Multipente
      // uniquement) : 100/N% par défaut (50% pour un Bipente, ce qui couvre à la fois le cas
      // symétrique — valeur par défaut demandée — et asymétrique — champ personnalisable).
      coefficient: nbPans > 1 ? Math.round((100 / nbPans) * 100) / 100 : 100,
      // NOUVEAU (demande explicite : sélecteur optimiseur par pan, cf. computeFieldChainSizing) —
      // jamais persisté en base (même statut que userConfig/coefficient, session uniquement).
      optimiseurRef: null,
      // NOUVEAU (demande explicite : "il manque un champ pour indiquer le nombre de chaînes affectées
      // par onduleur — le remplissage automatique [jusqu'à la capacité max de chaque onduleur avant
      // de passer au suivant] n'est pas normal") : répartition manuelle des chaînes entre les
      // onduleurs physiques de l'onglet (1 entrée par onduleur, cf. onduleurSplitFieldHTML) — vide par
      // défaut (repli sur la répartition automatique existante dans cablage_dc.js).
      chainsPerOnduleur: (cached && cached.chainsPerOnduleur) || [],
    };
  }
  const state = window.__chainesFieldState[subPvId];
  // CORRECTIF (bug rapporté : impossible de taper "+" pour saisir plusieurs chaînes de tailles
  // différentes) : garantit un tableau de lignes structurées même pour un état créé avant ce
  // correctif — reconstruit à partir du texte déjà saisi le cas échéant (compatibilité ascendante).
  if (!state.userConfigRows) state.userConfigRows = parseUserConfigToRows(state.userConfig);
  return state;
}

// CORRECTIF (bug rapporté : impossible de taper "+") : "Config. PV utilisateur" est désormais
// saisi via une liste de lignes structurées (2 champs numériques par ligne) plutôt qu'un texte
// libre au format "N Ch x M PV + ..." — ce texte reste néanmoins le format de stockage interne
// (fieldState.userConfig), reconstruit à chaque changement, pour ne rien changer en aval
// (parseUserPvConfig / StringSizingUtils.expandStringConfigToList / Câblage DC).
function parseUserConfigToRows(text) {
  const raw = String(text || '').trim();
  if (!raw) return [{ count: '', panels: '' }];
  const cleaned = raw.toLowerCase().replace(/ch/g, '').replace(/pv/g, '').replace(/ /g, '');
  const rows = [];
  cleaned.split('+').forEach((part) => {
    if (!part.includes('x')) return;
    const [countStr, panelsStr] = part.split('x');
    const count = parseInt(countStr, 10);
    const panels = parseInt(panelsStr, 10);
    if (!isNaN(count) && !isNaN(panels)) rows.push({ count, panels });
  });
  return rows.length ? rows : [{ count: '', panels: '' }];
}

function rowsToUserConfigString(rows) {
  return (rows || [])
    .filter((r) => r.count !== '' && r.panels !== '' && !isNaN(r.count) && !isNaN(r.panels))
    .map((r) => `${r.count} Ch x ${r.panels} PV`)
    .join(' + ');
}

// CORRECTIF (demande explicite, capture d'écran à l'appui : "les 2 champs Nb qui s'affichent par
// défaut doivent être forcés à gauche, en dessous de 'Config. PV utilisateur' — actuellement ils sont
// à droite ; augmenter la largeur des champs de saisie") : 1re tentative (flex-wrap + inputs réduits
// à 56px) jugée insuffisante — la ligne continuait d'apparaître décalée à droite. Cette 2e passe force
// EXPLICITEMENT chaque niveau (conteneur englobant, ligne, inputs) en flux normal AUCUNE mise en page
// externe ne peut plus la repositionner : `position:static !important; float:none !important` sur
// toute la chaîne d'ancêtres immédiats, `width:100% !important` + `justify-content:flex-start` sur le
// conteneur, et des inputs élargis (56px → 90px, demande explicite).
function userConfigRowsHTML(field, fieldState) {
  const rows = fieldState.userConfigRows;
  const rowStyle = 'display:flex !important; flex-wrap:wrap; align-items:center; justify-content:flex-start; gap:6px; margin-bottom:4px; width:100% !important; max-width:100%; position:static !important; float:none !important; text-align:left;';
  const rowsHTML = rows.map((row, idx) => `
    <div style="${rowStyle}">
      <input type="number" min="1" step="1" class="form-control form-control-sm" data-row-count="${idx}" value="${row.count}" placeholder="Nb" style="width:90px !important; flex:0 0 auto; position:static !important;" />
      <span style="font-size:0.72rem; color:#6c757d; white-space:nowrap;">Ch x</span>
      <input type="number" min="1" step="1" class="form-control form-control-sm" data-row-panels="${idx}" value="${row.panels}" placeholder="Nb" style="width:90px !important; flex:0 0 auto; position:static !important;" />
      <span style="font-size:0.72rem; color:#6c757d; white-space:nowrap;">PV</span>
      ${rows.length > 1 ? `<button type="button" class="btn btn-sm" data-row-remove="${idx}" style="color:#dc3545; padding:0 6px; line-height:1; border:none; background:transparent; flex:0 0 auto;" title="Supprimer cette ligne">&times;</button>` : ''}
    </div>
  `).join('');
  return `
    <div style="display:block !important; position:static !important; float:none !important; width:100% !important; max-width:100%; overflow:visible; text-align:left;">
      ${rowsHTML}
      <button type="button" class="btn btn-sm" data-add-config-row="${field.subPvId}" style="margin-top:2px; color:#0f766e; padding:2px 4px; font-size:0.75rem; border:none; background:transparent; white-space:nowrap; position:static !important; float:none !important;">
        <i class="fas fa-plus"></i> Ajouter une chaîne différente
      </button>
    </div>
  `;
}

// syncTargets (NOUVEAU, optionnel — carte fusionnée multi-pans, chainMergedFieldsCardHTML) : autres
// fields dont le fieldState doit recevoir la MÊME config à chaque modification (demande explicite :
// "Config. PV utilisateur" partagée entre pans d'une même toiture) — []  par défaut, donc AUCUN
// changement de comportement pour tous les appels existants (Monopente, un seul field).
function wireUserConfigRows(field, block, fieldState, syncTargets = []) {
  const container = block.querySelector(`[data-user-config-container="${field.subPvId}"]`);
  if (!container) return;

  const refreshValidation = () => {
    fieldState.userConfig = rowsToUserConfigString(fieldState.userConfigRows);
    const el = document.getElementById(`chains-config-validation-${field.subPvId}`);
    if (el) el.innerHTML = userConfigValidationHTML(field, fieldState);
    syncTargets.forEach((otherField) => {
      const otherState = getChainsFieldState(otherField);
      otherState.userConfig = fieldState.userConfig;
      otherState.userConfigRows = fieldState.userConfigRows.map((row) => ({ ...row }));
      const otherEl = document.getElementById(`chains-config-validation-${otherField.subPvId}`);
      if (otherEl) otherEl.innerHTML = userConfigValidationHTML(otherField, otherState);
    });
    // CORRECTIF (demande explicite : "Config. PV utilisateur ne persiste pas") : filet de sécurité
    // localStorage (garanti) + même round-trip résidentiel que nbOnduleurs/fractionRepartition
    // (writeHostField → CM.setMaisonFieldResult → localStorage immédiat + BD debouncée) quand
    // disponible — "Config. PV utilisateur" est déjà partagée pour TOUS les pans d'une même toiture
    // (syncTargets ci-dessus), donc une seule valeur par pvId (comme nbOnduleurs) suffit ici.
    saveChainesPertesLocalCache();
    writeHostField('userConfigChaines-' + field.pvId, fieldState.userConfig, field.pvId);
  };

  const render = () => {
    container.innerHTML = userConfigRowsHTML(field, fieldState);

    container.querySelectorAll('[data-row-count]').forEach((input) => {
      input.addEventListener('input', () => {
        const idx = parseInt(input.getAttribute('data-row-count'), 10);
        fieldState.userConfigRows[idx].count = input.value === '' ? '' : parseInt(input.value, 10);
        refreshValidation();
      });
    });
    container.querySelectorAll('[data-row-panels]').forEach((input) => {
      input.addEventListener('input', () => {
        const idx = parseInt(input.getAttribute('data-row-panels'), 10);
        fieldState.userConfigRows[idx].panels = input.value === '' ? '' : parseInt(input.value, 10);
        refreshValidation();
      });
    });
    container.querySelectorAll('[data-row-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-row-remove'), 10);
        fieldState.userConfigRows.splice(idx, 1);
        render();
        refreshValidation();
      });
    });
    const addBtn = container.querySelector(`[data-add-config-row="${field.subPvId}"]`);
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        fieldState.userConfigRows.push({ count: '', panels: '' });
        render();
        refreshValidation();
      });
    }
  };

  render();
}

// NOUVEAU (demande explicite : "il manque une fonctionnalité pour affecter un nombre de chaîne par
// onduleur pour le tableau des strings lorsque le Choix des onduleurs est défini sur onduleur pour
// tout le système — le remplissage automatique [jusqu'à la capacité max de chaque onduleur avant de
// passer au suivant] n'est pas normal") : 1 champ de saisie par onduleur physique de l'onglet
// (getPvTabState(field.pvId).nbOnduleurs), affiché UNIQUEMENT quand il y en a plus d'un — sinon rien
// à répartir. Consommé par cablage_dc.js::partitionStringsByOnduleurUnit (tableau des métrés, écran +
// PDF) : une répartition manuelle prime sur le remplissage automatique par capacité pleine.
function onduleurCapacityForField(field) {
  // resolveInverterMpptSpec vit dans cablage_dc.js (chargé après ce fichier, mais résolu au moment de
  // l'appel — cf. convention déjà en place ailleurs dans ce fichier pour les fonctions cross-module).
  if (typeof resolveInverterMpptSpec !== 'function') return null;
  const spec = resolveInverterMpptSpec(field);
  if (!spec || !spec.nbMppt || !spec.perMppt) return null;
  return spec.nbMppt * spec.perMppt;
}

function onduleurSplitFieldHTML(field, fieldState) {
  const nbOnduleurs = Math.max(1, parseInt(getPvTabState(field.pvId).nbOnduleurs, 10) || 1);
  if (nbOnduleurs <= 1) return '';

  const perUnitCap = onduleurCapacityForField(field);
  const effectiveMax = perUnitCap ? Math.min(40, perUnitCap) : 40;
  const rows = fieldState.chainsPerOnduleur || [];

  const inputs = Array.from({ length: nbOnduleurs }, (_, k) => {
    const val = Number.isFinite(rows[k]) ? rows[k] : '';
    return `
      <div style="display:flex; flex-direction:column; align-items:flex-start; gap:2px;">
        <span style="font-size:0.68rem; color:#6c757d; white-space:nowrap;">Ond. ${k + 1}</span>
        <input type="number" min="1" max="${effectiveMax}" step="1" class="form-control form-control-sm" data-onduleur-split="${k}" value="${val}" placeholder="Auto" title="Onduleur #${k + 1} — 1 à ${effectiveMax} chaînes" style="width:72px;" />
      </div>`;
  }).join('');

  return `
    <div style="padding: 10px 12px; background: #fff; border: 1px solid #e9ecef; border-radius: 6px; flex: 1 1 200px; min-width: 180px;">
      <label style="font-size: 0.75rem; color: #495057; display: block; margin-bottom: 4px;">Chaînes par onduleur (${nbOnduleurs} onduleurs, max ${effectiveMax}/onduleur)</label>
      <div data-onduleur-split-container="${field.subPvId}" style="display:flex; flex-wrap:wrap; gap:8px;">${inputs}</div>
      <div style="font-size:0.68rem; color:#6c757d; margin-top:4px;">Un champ laissé vide se remplit automatiquement avec les chaînes restantes (jusqu'à sa capacité max).</div>
      <div id="chains-onduleur-split-error-${field.subPvId}" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
    </div>`;
}

// CORRECTIF (bug rapporté : "vos derniers correctifs ne fonctionnent pas") : root cause trouvée —
// la carte "Chaînes par onduleur" (onduleurSplitFieldHTML) n'apparaît/disparaît QUE lors du
// PROCHAIN rendu complet de la carte du champ PV (chainFieldCardHTML/chainMergedFieldsCardHTML,
// construite une seule fois en chaîne de caractères) ; or, passer "Nbre d'onduleurs" de 1 à 2 ne
// déclenchait qu'un renderGlobalResults() — jamais un nouveau rendu de CETTE carte — la carte de
// répartition manuelle ne s'affichait donc jamais tant que l'utilisateur ne rouvrait pas le modal.
// Reconstruit uniquement le(s) bloc(s) "carte du champ PV" concerné(s) par ce pvId (outerHTML sur
// chains-field-block[-merged]-*, réutilise tel quel chainFieldCardHTML/chainMergedFieldsCardHTML +
// leur wire*) — SANS toucher à chains-tab-block-${pvId} (la carte "Nbre d'onduleurs" elle-même),
// donc sans jamais faire perdre le focus de l'input en cours de frappe.
function refreshOnduleurSplitCard(pvId) {
  const pans = getPansForPvId(pvId);
  if (!pans.length) return;
  if (pans.length > 1) {
    const primary = pans[0];
    const el = document.getElementById(`chains-field-block-merged-${primary.pvId}`);
    if (!el) return;
    el.outerHTML = chainMergedFieldsCardHTML(pans, pans.length);
    wireMergedFieldsCard(pans);
  } else {
    const field = pans[0];
    const el = document.getElementById(`chains-field-block-${field.subPvId}`);
    if (!el) return;
    el.outerHTML = chainFieldCardHTML(field, pans.length);
    wireChainFieldCard(field);
  }
}

function wireOnduleurSplit(field, block, fieldState, syncTargets = []) {
  const container = block.querySelector(`[data-onduleur-split-container="${field.subPvId}"]`);
  if (!container) return;
  const errorEl = block.querySelector(`#chains-onduleur-split-error-${field.subPvId}`);
  const perUnitCap = onduleurCapacityForField(field);
  const effectiveMax = perUnitCap ? Math.min(40, perUnitCap) : 40;

  container.querySelectorAll('[data-onduleur-split]').forEach((input) => {
    input.addEventListener('input', () => {
      const k = parseInt(input.getAttribute('data-onduleur-split'), 10);
      if (input.value === '') {
        fieldState.chainsPerOnduleur[k] = null;
        showFieldValidation(input, errorEl, { valid: true });
      } else {
        const result = validateNumericField(input.value, { min: 1, max: effectiveMax, integer: true, label: `Onduleur #${k + 1}` });
        showFieldValidation(input, errorEl, result);
        if (!result.valid) return;
        fieldState.chainsPerOnduleur[k] = result.value;
      }
      saveChainesPertesLocalCache();
      syncTargets.forEach((otherField) => {
        const otherState = getChainsFieldState(otherField);
        otherState.chainsPerOnduleur = fieldState.chainsPerOnduleur.slice();
      });
    });
  });
}

function createChainesPertesModal() {
  if (document.getElementById('chainesPertesModal')) return;

  // CORRECTIF (bug rapporté à 2 reprises, capture d'écran à l'appui : des <input class="form-control">
  // s'affichaient "flottés" hors de leur carte, en haut à droite de l'écran — d'abord "Config. PV
  // utilisateur", puis "Chaînes par onduleur") : VRAIE cause racine trouvée — app/static/
  // concevoir_mon_projet/CSS/Modele.css définit .form-control { float: right; ... } et
  // label { float: left; width: 100%; ... } de façon GLOBALE (non scopée à un composant précis),
  // pensé pour un tout autre formulaire de l'appli. `float` sur un <input>/<label> le retire du flux
  // normal ; sans clearfix sur son conteneur, il "s'échappe" visuellement de sa carte. Les correctifs
  // précédents (position:static !important sur les DIV englobantes) neutralisaient l'effet par
  // endroits mais pas la cause : tout NOUVEAU .form-control ajouté dans ce modal (ex. "Chaînes par
  // onduleur") reproduisait le bug. Neutralisé ICI, une fois pour toutes, pour tout .form-control/
  // .form-select DANS ce modal (recalcul, câblage DC compris) — ne touche ni width ni les autres
  // propriétés (plusieurs champs existants comptent sur width:100% pour leur mise en page).
  const modalScopedStyle = `
    <style>
      #chainesPertesModal .form-control,
      #chainesPertesModal .form-select {
        float: none !important;
        align-self: auto !important;
      }
      #chainesPertesModal label {
        float: none !important;
      }
    </style>`;

  const modalHTML = `
    ${modalScopedStyle}
    <div id="chainesPertesModal" style="display: none; align-items: center; justify-content: center; position: fixed; z-index: 999999; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); pointer-events: auto;">
      <!-- CORRECTIF (demande explicite : "élargir le modal pour placer le tableau des strings à côté
           du plan de câblage") : 1300 -> 1600px — profite à la vue Câblage DC (combinée), sans effet
           négatif sur la vue par défaut (grilles auto-fit, s'étalent simplement un peu plus). -->
      <div class="modal-content" style="background: white; border-radius: 8px; width: 97%; max-width: 1600px; padding: 0; position: relative; overflow: hidden; pointer-events: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border: 1px solid #ddd; max-height: 92vh; display: flex; flex-direction: column;">
        <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; background-color: #5d5e5f; border-bottom: 1px solid #ddd; color: #fff; padding: 15px 20px; cursor: move; flex-shrink: 0;">
          <h5 style="margin: 0; color: #fff; font-weight: bold;"><i class="fas fa-bolt"></i> Configuration des chaînes et perte système</h5>
          <button type="button" style="background: transparent; border: none; font-size: 1.2em; cursor: pointer; color: #fff;" onclick="closeChainesPertesModal(this)"><i class="fas fa-times"></i></button>
        </div>
        <div style="padding: 20px; overflow-y: auto;">
        <!-- NOUVEAU (fonctionnalité "Câblage DC") : ce modal n'a pas de système d'onglets — même
             motif "flag + re-render" que le reste du fichier (window.__chainesOnduleurMode), pas un
             second modal empilé. #chainesPertesDefaultView regroupe tout le contenu déjà existant ;
             #chainesPertesCablageSection (masqué par défaut, rendu par cablage_dc.js) le remplace
             visuellement quand window.__chainesPertesGlobal.activeView === 'cablage'. Bascule gérée
             dans renderChainesPertesModal() ci-dessous. -->
        <div id="chainesPertesDefaultView">
          <div style="font-size: 0.82rem; color: #6c757d; margin-bottom: 14px;">
            L'onduleur et la batterie ci-dessous sont partagés par tous les champs PV du projet. Le
            panneau de chaque champ n'est pas modifiable ici : il provient de sa page de calepinage.
          </div>

          <div id="chainesPertesEquipementSection" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; width: 100%; box-sizing: border-box;"></div>

          <div style="margin-bottom: 20px; padding: 14px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px;">
            <div style="font-weight: bold; color: #212529; margin-bottom: 10px;">Paramètres de conception</div>
            <div style="display: flex; gap: 16px; flex-wrap: wrap;">
              <div style="display: flex; flex-direction: column;">
                <label style="font-size: 0.78rem; color: #495057; display: block; margin-bottom: 4px;">Temp. min (°C) — saisir une valeur positive, le signe négatif est appliqué automatiquement</label>
                <input type="number" id="chainesPertesTempMin" class="form-control form-control-sm" value="-10" min="-20" max="0" step="1" style="width: 100px;" />
                <div id="chainesPertesTempMinError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
              </div>
              <div style="display: flex; flex-direction: column;">
                <label style="font-size: 0.78rem; color: #495057; display: block; margin-bottom: 4px;">STC (°C)</label>
                <input type="number" id="chainesPertesTempFunc" class="form-control form-control-sm" value="25" min="-20" max="80" step="1" style="width: 130px;" />
                <div id="chainesPertesTempFuncError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
              </div>
              <div style="display: flex; flex-direction: column;">
                <label style="font-size: 0.78rem; color: #495057; display: block; margin-bottom: 4px;">Temp. max (°C)</label>
                <input type="number" id="chainesPertesTempMax" class="form-control form-control-sm" value="70" min="-20" max="80" step="1" style="width: 100px;" />
                <div id="chainesPertesTempMaxError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
              </div>
              <div style="display: flex; flex-direction: column;">
                <label style="font-size: 0.78rem; color: #495057; display: block; margin-bottom: 4px;" title="Ratio DC/AC maximal admis : au-delà, le calcul est bloqué.">Coef. de surdimensionnement</label>
                <input type="number" id="chainesPertesCoefSurdim" class="form-control form-control-sm" value="${COEF_SURDIMENSIONNEMENT_DEFAUT}" min="${COEF_SURDIMENSIONNEMENT_RULE.min}" max="${COEF_SURDIMENSIONNEMENT_RULE.max}" step="0.01" style="width: 110px;" />
                <div id="chainesPertesCoefSurdimError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
              </div>
            </div>
          </div>

          <div id="chainesPertesGlobalResults" style="margin-bottom: 20px;"></div>

          <!-- Section 1/2 : dimensionnement des chaînes, un onglet PV = 1 carte onduleur + 1 carte par pan (CE FICHIER). -->
          <div id="chainesPertesChainsSection" style="margin-bottom: 28px;"></div>

          <!-- Section 2/2 : perte système détaillée (perte_systeme.js). -->
          <div id="chainesPertesLossesSection" style="margin-top: 8px;"></div>
        </div>

        <div id="chainesPertesCablageSection" style="display: none;"></div>
        </div>
        <div style="padding: 12px 20px; border-top: 1px solid #ddd; text-align: right; flex-shrink: 0;">
          <button type="button" class="btn btn-secondary" onclick="closeChainesPertesModal(this)">Fermer</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // Validation (demande explicite : bornes -20/80°C, magnitude 0-20 pour Temp. min cf.
  // readGlobalTempSettings()) : un re-rendu n'a lieu que si la saisie est valide — sinon on affiche
  // l'erreur et on laisse StringSizingUtils continuer de travailler sur la dernière valeur connue
  // (readGlobalTempSettings() retombe alors sur son repli par défaut tant que l'input reste invalide
  // aux yeux du navigateur, ce qui n'arrive que si la valeur est non numérique).
  // CORRECTIF (demande explicite : "faire apparaître le signe (-) devant le chiffre positif saisi
  // dans Temp. min") : chainesPertesTempMin retiré de la boucle générique ci-dessous — sa valeur
  // interne est déjà rendue négative par readGlobalTempSettings(), mais ne s'affichait jamais dans
  // le champ lui-même. Câblage dédié plus bas : valide la MAGNITUDE saisie (règle inchangée, 0-20)
  // puis réécrit el.value avec le signe "-" explicite — la boucle générique, elle, validerait la
  // valeur AFFICHÉE (donc déjà négative après coup) contre une règle 0-20 et la rejetterait à tort.
  const TEMP_MIN_RULE = { min: 0, max: 20, label: 'Température min (magnitude)' };
  const TEMP_FIELD_RULES = {
    chainesPertesTempFunc: { min: -20, max: 80, label: 'Température STC' },
    chainesPertesTempMax: { min: -20, max: 80, label: 'Température max' },
  };
  Object.keys(TEMP_FIELD_RULES).forEach((id) => {
    const el = document.getElementById(id);
    const errorEl = document.getElementById(id + 'Error');
    if (!el) return;
    el.addEventListener('input', () => {
      const result = validateNumericField(el.value, TEMP_FIELD_RULES[id]);
      showFieldValidation(el, errorEl, result);
      if (result.valid) renderChainesPertesModal();
    });
  });

  const tempMinEl = document.getElementById('chainesPertesTempMin');
  const tempMinErrorEl = document.getElementById('chainesPertesTempMinError');
  if (tempMinEl) {
    tempMinEl.addEventListener('input', () => {
      const magnitude = Math.abs(parseFloat(tempMinEl.value)); // ignore un signe déjà présent
      const result = validateNumericField(isNaN(magnitude) ? tempMinEl.value : String(magnitude), TEMP_MIN_RULE);
      showFieldValidation(tempMinEl, tempMinErrorEl, result);
      if (result.valid) {
        tempMinEl.value = result.value === 0 ? '0' : `-${result.value}`;
        renderChainesPertesModal();
      }
    });
  }

  // Coef. de surdimensionnement : même validation bloquante que les températures — une saisie hors
  // 1-2 n'est jamais retenue, le contrôle continue d'utiliser la dernière valeur valide.
  const coefEl = document.getElementById('chainesPertesCoefSurdim');
  const coefErrorEl = document.getElementById('chainesPertesCoefSurdimError');
  if (coefEl) {
    coefEl.addEventListener('input', () => {
      const result = validateNumericField(coefEl.value, COEF_SURDIMENSIONNEMENT_RULE);
      showFieldValidation(coefEl, coefErrorEl, result);
      if (!result.valid) return;
      window.__chainesPertesGlobal.coefSurdimensionnement = result.value;
      saveChainesPertesLocalCache();
      renderChainesPertesModal();
    });
  }

  // Modal déplaçable, même pattern que bd_batteries.js::createBatteriesModal.
  const modal = document.getElementById('chainesPertesModal');
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

function triggerEquipSelection(type) {
  // Équipement global : n'importe quelle instance de modale favoris déjà présente dans la page
  // convient (elles pointent toutes vers le même catalogue DB), pas de ciblage par pvId.
  const selectors = {
    onduleur: '[onclick*="openFavoritesOnduleurModal"]',
    batterie: '[onclick*="openBatteriesModal"]',
  };
  const btn = document.querySelector(selectors[type]);
  if (btn) {
    btn.click();
  } else if (window.showValidationAlert) {
    window.showValidationAlert("Impossible d'ouvrir le sélecteur : aucun champ PV disponible sur cette page.");
  }
}

// NOUVEAU (demande explicite : "Choix des onduleurs" — Par champ PV) : contrairement à
// triggerEquipSelection() ci-dessus (n'importe quelle instance, choix partagé), on cible ICI
// précisément le bouton "BD onduleurs" de l'onglet pvId demandé, pour que
// openFavoritesOnduleurModal() calcule le bon suffixe (-<pvId>) et que le pvEquipementSelected
// dispatché par bd_onduleurs.js porte le bon detail.pvId.
function triggerEquipSelectionForPv(type, pvId) {
  const selectors = { onduleur: '[onclick*="openFavoritesOnduleurModal"]' };
  const btns = Array.from(document.querySelectorAll(selectors[type] || ''));
  const target = btns.find((b) => {
    const container = b.closest('.tab-content, .tab-pane, form, .form-container') || document.body;
    const puissanceInput = container.querySelector('[id^="puissance_onduleur"]');
    return puissanceInput && puissanceInput.id === `puissance_onduleur-${pvId}`;
  }) || btns[0];
  if (target) {
    target.click();
  } else if (window.showValidationAlert) {
    window.showValidationAlert("Impossible d'ouvrir le sélecteur : aucun champ PV disponible sur cette page.");
  }
}

// NOUVEAU (demande explicite) : "Choix des onduleurs" — segmented control "Par champ PV" /
// "Onduleur pour tout le système" (défaut, comportement historique). En mode "Par champ PV",
// l'onduleur n'est plus choisi ici (partagé) mais depuis un bouton dédié dans la carte de chaque
// onglet PV (cf. pvTabCardHTML) — la ligne "Onduleur" ci-dessous disparaît alors, seule la
// batterie (toujours partagée, non concernée par cette demande) reste affichée ici.
function onduleurModeToggleHTML() {
  const mode = window.__chainesOnduleurMode;
  const btnStyle = (active) => `width: auto; margin: 0; ${active ? 'background:#5d5e5f; color:#fff; border-color:#5d5e5f;' : 'background:#e9ecef; color:#495057; border-color:#e9ecef;'}`;
  return `
    <div style="padding: 10px 14px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; width: 100%; box-sizing: border-box;">
      <div style="font-size: 0.72rem; color: #6c757d; margin-bottom: 6px;">Choix des onduleurs</div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button type="button" class="btn btn-sm" data-onduleur-mode="perField" style="${btnStyle(mode === 'perField')}">Par champ PV</button>
        <button type="button" class="btn btn-sm" data-onduleur-mode="global" style="${btnStyle(mode === 'global')}">Onduleur pour tout le système</button>
      </div>
    </div>
  `;
}

/**
 * Dimensionnement de la batterie retenue, affiché sous sa ligne de sélection.
 *
 * Demande explicite : « on doit faire le dimensionnement de la batterie depuis le modal
 * dimensionnement Configuration des chaînes et pertes ». C'est le bon endroit : c'est ici que
 * l'onduleur est choisi, or les deux grandeurs qui lient la batterie à l'installation en dépendent
 * — la TENSION SYSTÈME (monophasé ou triphasé, deux valeurs réellement distinctes pour 13 des 40
 * références) et la COMPATIBILITÉ avec le modèle d'onduleur.
 *
 * Lecture seule : le choix de la batterie reste au formulaire de calepinage, conformément au même
 * principe que le panneau (cf. en-tête de fichier).
 *
 * @param {object} batterieEntry window.__chainesPertesGlobal.batterie ({ data: { fab, ref, dbMatch } })
 */
function batterieDimensionnementHTML(batterieEntry) {
  const data = batterieEntry && batterieEntry.data;
  if (!data) return '';

  // Le catalogue complet porte les grandeurs de dimensionnement ; la sélection n'en transporte
  // qu'un extrait. On repart donc du catalogue chaque fois qu'il est disponible.
  const cat = data.dbMatch
    || (window.batteryCatalogFromApi || []).find((b) => b.reference === data.ref)
    || null;
  if (!cat) {
    return `
      <div style="padding: 10px 14px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px;
                  font-size: 0.8rem; color: #92400e;">
        Batterie « ${data.ref || ''} » absente du catalogue : caractéristiques de dimensionnement
        indisponibles. Choisissez une référence du catalogue depuis la page Calepinage.
      </div>`;
  }

  const onduleurData = (window.__chainesPertesGlobal.onduleur
    && window.__chainesPertesGlobal.onduleur.data) || null;
  const phase = window.BatterieSelection
    ? window.BatterieSelection.phaseDuRaccordement(onduleurData) : null;
  const tension = window.BatterieSelection
    ? window.BatterieSelection.tensionSelonPhase(cat, phase) : null;

  const NA = '<span style="color:#adb5bd;">NA</span>';
  const nombre = (v, unite, dec) => {
    const n = parseFloat(v);
    return isFinite(n) ? `${n.toFixed(dec === undefined ? 1 : dec)} ${unite}` : NA;
  };

  const capacite = parseFloat(cat.capacite_nominale_kwh);
  const dod = parseFloat(cat.dod_max_pct);
  // Énergie réellement exploitable : c'est elle qui dimensionne, pas la capacité nominale.
  const utile = (isFinite(capacite) && isFinite(dod)) ? capacite * dod / 100 : null;

  const pDecharge = parseFloat(cat.puissance_decharge_kw);
  const cRate = (isFinite(pDecharge) && isFinite(capacite) && capacite > 0) ? pDecharge / capacite : null;
  // Au-delà de 10 C le serveur refuse le dimensionnement (règle de cohérence, cf.
  // stockage_schemas.py) : on le signale ici plutôt que d'attendre le rejet.
  const cRateExcessif = cRate !== null && cRate > 10;

  // Compatibilité avec le modèle d'onduleur retenu — la table de compatibilité est exposée par
  // l'API du catalogue (compatible_onduleur_refs).
  let compatibiliteHTML = '';
  // `ref` est la clé posée par bd_onduleurs.js à la sélection (cf. son dispatch pvEquipementSelected).
  const refOnduleur = onduleurData && onduleurData.ref;
  if (refOnduleur) {
    const refs = cat.compatible_onduleur_refs || [];
    // Une liste VIDE signifie « compatibilités non renseignées », pas « incompatible » : on ne
    // décourage pas un choix légitime sur une absence de donnée.
    const inconnu = refs.length === 0;
    const compatible = refs.some((r) => String(r).toUpperCase() === String(refOnduleur).toUpperCase());
    const couleur = inconnu ? '#6c757d' : (compatible ? '#15803d' : '#b45309');
    const texte = inconnu
      ? `Compatibilité non renseignée pour cette référence`
      : (compatible
        ? `Compatible avec ${refOnduleur}`
        : `Non référencée comme compatible avec ${refOnduleur}`);
    compatibiliteHTML = `
      <div style="margin-top: 8px; font-size: 0.8rem; color: ${couleur};">
        ${inconnu ? '•' : (compatible ? '✓' : '⚠')} ${texte}
      </div>`;
  }

  const phaseLabel = phase === 'tri' ? 'Triphasé' : (phase === 'mono' ? 'Monophasé' : 'Phase non déterminée');
  const titreTension = phase
    ? `Tension retenue pour un raccordement ${phaseLabel.toLowerCase()}, d'après la fiche constructeur.`
    : "Aucun onduleur retenu : la tension affichée est celle disponible dans la fiche. Choisissez un onduleur pour départager monophasé et triphasé.";

  return `
    <div style="margin-top: 10px; padding: 12px 14px; background: #fff; border: 1px solid #e9ecef;
                border-radius: 6px;">
      <div style="font-size: 0.75rem; font-weight: 600; color: #495057; margin-bottom: 8px;">
        Dimensionnement batterie
        <span style="font-weight: 400; color: #6c757d;">— lecture seule, le choix se fait depuis la page Calepinage</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px;">
        ${window.chainesPertesMetricCard('Capacité nominale', nombre(capacite, 'kWh'))}
        ${window.chainesPertesMetricCard('Énergie utile', utile === null ? NA : nombre(utile, 'kWh'))}
        ${window.chainesPertesMetricCard('P. charge', nombre(cat.puissance_charge_kw, 'kW'))}
        ${window.chainesPertesMetricCard('P. décharge', nombre(pDecharge, 'kW'), cRateExcessif)}
        ${window.chainesPertesMetricCard('Rendement (RTE)', nombre(cat.round_trip_efficiency_pct, '%', 0))}
        ${window.chainesPertesMetricCard('DoD max', nombre(dod, '%', 0))}
        ${window.chainesPertesMetricCard('Régime (C)', cRate === null ? NA : `${cRate.toFixed(2)} C`, cRateExcessif)}
        <div title="${titreTension}">
          ${window.chainesPertesMetricCard('Tension système — ' + phaseLabel,
            tension === null ? NA : `${tension} V`)}
        </div>
        ${window.chainesPertesMetricCard('Couplage', cat.type_couplage || NA)}
      </div>
      ${cRateExcessif ? `
        <div style="margin-top: 8px; font-size: 0.8rem; color: #b45309;">
          ⚠ Régime de décharge supérieur à 10 C : le calcul de stockage refusera ce dimensionnement.
        </div>` : ''}
      ${compatibiliteHTML}
    </div>`;
}

function renderEquipementRows() {
  const section = document.getElementById('chainesPertesEquipementSection');
  if (!section) return;
  const g = window.__chainesPertesGlobal;
  const mode = window.__chainesOnduleurMode;

  const rows = [];
  if (mode === 'global') {
    rows.push({ key: 'onduleur', label: 'Onduleur (partagé, tout le système)', item: g.onduleur });
  }
  rows.push({ key: 'batterie', label: 'Batterie (optionnel, partagée)', item: g.batterie });

  section.innerHTML = onduleurModeToggleHTML() + rows.map(({ key, label, item }) => {
    const summary = item ? `${item.data.fab || ''} ${item.data.ref || ''}`.trim() : 'Aucun sélectionné';
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; width: 100%; box-sizing: border-box;">
        <div>
          <div style="font-size: 0.72rem; color: #6c757d;">${label}</div>
          <div style="font-weight: 600; color: ${item ? '#212529' : '#adb5bd'};">${summary}</div>
        </div>
        <button type="button" class="btn btn-sm btn-choisir-fav" data-equip="${key}" style="width: auto; margin: 0;">Choisir</button>
      </div>
      ${key === 'batterie' ? batterieDimensionnementHTML(item) : ''}
    `;
  }).join('');

  section.querySelectorAll('[data-equip]').forEach((btn) => {
    btn.addEventListener('click', () => triggerEquipSelection(btn.dataset.equip));
  });

  section.querySelectorAll('[data-onduleur-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.__chainesOnduleurMode = btn.dataset.onduleurMode;
      renderChainesPertesModal();
    });
  });
}

// NOUVEAU (demande explicite : "Choix des onduleurs" par champ PV) : résout l'onduleur applicable
// à un onglet pvId selon le mode actif — window.__chainesPertesGlobal.onduleur (partagé, mode
// 'global', comportement historique) ou window.__chainesOnduleurByField[pvId] (mode 'perField').
// Centralisé ici pour que computeAllocatedOnduleurKva/renderGlobalResults/pvTabCardHTML/
// computeFieldChainSizing restent cohérents entre eux.
// CORRECTIF (bug rapporté : "l'onduleur choisi disparaît après actualisation de la page" + demande
// explicite : "si on choisit un onduleur dans le formulaire calepinage, le retrouver dans le modal de
// dimensionnement") : `field` (optionnel, 2e paramètre) permet un repli sur
// getResidentialOnduleurEntry(field) — jusqu'ici réservé au seul calcul de dimensionnement
// (computeFieldChainSizing) — désormais partagé par TOUS les appelants qui ont un `field` sous la
// main (affichage de la carte d'onglet, propagation, calcul de puissance allouée). Root cause du bug
// signalé : un choix fait DANS ce modal (window.__chainesPertesGlobal.onduleur/
// __chainesOnduleurByField) n'est qu'en mémoire (jamais persisté) — un rechargement de page le perd
// TOUJOURS, qu'il s'agisse d'un projet résidentiel ou Pro/Grand ; ce repli fait au moins retrouver
// automatiquement l'onduleur si l'utilisateur en a déjà choisi un dans le formulaire de calepinage
// résidentiel lui-même (CM.state.onduleurRef, qui LUI est bien persisté).
function getFieldOnduleurEntry(pvId, field) {
  const direct = window.__chainesOnduleurMode === 'perField'
    ? window.__chainesOnduleurByField[pvId] || null
    : window.__chainesPertesGlobal.onduleur;
  return direct || (field ? getResidentialOnduleurEntry(field) : null);
}

// CORRECTIF (bug rapporté : "le Câblage DC ne fonctionne pas — rien ne s'affiche, ni en auto ni en
// manuel" — vraie cause racine, le correctif précédent de coordonnées canvas était réel mais
// insuffisant) : getFieldOnduleurEntry() ci-dessus ne lit QUE le circuit Pro/Grand-projet
// (window.__chainesPertesGlobal.onduleur / __chainesOnduleurByField, alimentés par
// hydrateEquipmentFromHostFields()/l'évènement pvEquipementSelected — tous deux inaccessibles pour
// un projet 100% résidentiel). Le calepinage résidentiel a son PROPRE sélecteur d'onduleur
// (calepinage_maison_formulaires.js), qui écrit CM.state.onduleurRef/onduleurPuissanceKva/
// onduleurRendement/onduleurConso — jamais bridé vers ce circuit. Repli utilisé UNIQUEMENT par
// computeFieldChainSizing() (ci-dessous) quand getFieldOnduleurEntry() échoue : résout le pan/état
// résidentiel du champ, puis complète les champs électriques (tension/MPPT/courant) manquants du
// catalogue léger résidentiel (window.inverterDB) en les cherchant dans window.onduleurCatalogFromApi
// — construits à partir de la MÊME réponse API (data.onduleurs, cf. bd_onduleurs.js::
// applyOnduleurCatalogFromApi/fetchOnduleurCatalog) : CM.state.onduleurRef (copié depuis
// inverterDB[fab][idx].ref, lui-même = o.reference) et onduleurCatalogFromApi[i].reference désignent
// donc exactement le même onduleur — la jointure par référence est fiable.
function getResidentialOnduleurEntry(field) {
  const CM = window.CalepinageMaisonIndiv;
  if (!CM || typeof CM.getPanForSubPvId !== 'function') return null;
  const resolved = CM.getPanForSubPvId(field.subPvId, field.pvId);
  const state = resolved && resolved.state;
  if (!state || !state.onduleurRef) return null;
  const dbMatch = (window.onduleurCatalogFromApi || []).find((o) => o.reference === state.onduleurRef);
  return {
    data: {
      fab: '', ref: state.onduleurRef,
      ond_tension_max_dc: dbMatch ? dbMatch.tension_max_dc : 0,
      ond_tension_min_dc: dbMatch ? dbMatch.tension_min_dc : 0,
      ond_plage_mppt_min: dbMatch ? dbMatch.plage_mppt_min : 0,
      ond_plage_mppt_max: dbMatch ? dbMatch.plage_mppt_max : 0,
      ond_imax_mppt: dbMatch ? dbMatch.courant_max_mppt : 0,
      // CORRECTIF (bug rapporté : nombre de chaînes/MPPT erroné, cf. string_sizing_utils.js).
      ond_courant_cc_max_mppt: dbMatch ? dbMatch.courant_cc_max_mppt : 0,
      ond_courant_max_sortie_ac: dbMatch ? dbMatch.courant_max_sortie_ac : 0,
      ond_tension_nominale_ac: dbMatch ? dbMatch.tension_nominale_ac : null,
      ond_type_tension: dbMatch ? dbMatch.type_tension : null,
      ond_p_apparente_max_kva: state.onduleurPuissanceKva || 0,
      ond_puissance_max_dc_kw: dbMatch ? dbMatch.puissance_max_dc_kw : null,
      ond_rendement: state.onduleurRendement || 0,
      ond_conso: state.onduleurConso || 0,
      // NOUVEAU (demande explicite, cf. bd_onduleurs.js::selectFavoriteOnduleur / hydrateEquipmentFromHostFields).
      ond_technologie: dbMatch ? dbMatch.technologie : null,
      ond_compat_optimiseur: dbMatch ? !!dbMatch.compat_optimiseur : false,
      ond_hybride: dbMatch ? !!dbMatch.hybride : false,
      ond_nb_max_unites_mono_20a: dbMatch ? dbMatch.nb_max_unites_mono_20a : null,
      ond_nb_max_unites_tri_20a: dbMatch ? dbMatch.nb_max_unites_tri_20a : null,
      ond_nb_max_unites_cable_mono: dbMatch ? dbMatch.nb_max_unites_cable_mono : null,
      ond_nb_max_unites_cable_poly: dbMatch ? dbMatch.nb_max_unites_cable_poly : null,
      hasFullData: !!dbMatch,
    },
  };
}

// NOUVEAU (demande explicite : "utiliser une couleur pour mettre en évidence les résultats de chaque
// valeur : jaune doré, rouge, gris et vert clair") : `theme` (optionnel, 5e usage inchangé pour tous
// les appels existants — `warn` seul continue de fonctionner comme avant) sélectionne un fond/bordure/
// couleur de valeur parmi 4 thèmes prédéfinis, sans toucher au comportement par défaut.
const CHAINES_PERTES_CARD_THEMES = {
  gold: { bg: '#fdf6e3', border: '#d4a017', text: '#8a6d00' },
  red: { bg: '#fdecea', border: '#e74c3c', text: '#a93226' },
  gray: { bg: '#f1f3f5', border: '#9ca3af', text: '#495057' },
  green: { bg: '#eafaf1', border: '#4caf50', text: '#1e7e34' },
};
// `center` (NOUVEAU, demande explicite : "centrer les labels et résultats dans les cartes Nb.
// panneaux projet, Puissance PV..., fais ça pour les 4 cartes") : optionnel, `false` par défaut —
// ne change RIEN aux dizaines d'appels existants ailleurs (cartes par pan, stats câblage DC…),
// scopé aux 4 cartes de renderGlobalResults qui le passent explicitement à `true`.
window.chainesPertesMetricCard = function (label, value, warn, theme, center) {
  const t = theme && CHAINES_PERTES_CARD_THEMES[theme];
  const bg = t ? t.bg : '#fff';
  const border = t ? t.border : (warn ? '#ffe69c' : '#e9ecef');
  const color = t ? t.text : (warn ? '#b45309' : '#212529');
  const align = center ? ' text-align:center;' : '';
  return `
    <div style="padding: 12px 14px; background: ${bg}; border: 1px solid ${border}; border-radius: 6px;${align}">
      <div style="font-size: 0.72rem; color: #6c757d;">${label}</div>
      <div style="font-weight: 700; font-size: 1.15rem; color: ${color};">${value}</div>
    </div>
  `;
};

// Puissance onduleur (kVA) allouée à UN pan : puissance totale de l'onglet (P_apparente x
// nbOnduleurs x %rép.) multipliée par le coefficient de répartition de ce pan entre pans (100%
// pour un onglet Monopente à un seul pan).
function computeAllocatedOnduleurKva(field) {
  const onduleurEntry = getFieldOnduleurEntry(field.pvId, field);
  if (!onduleurEntry) return 0;
  const tabState = getPvTabState(field.pvId);
  const fieldState = getChainsFieldState(field);
  const tabTotalKva = (onduleurEntry.data.ond_p_apparente_max_kva || 0) * (tabState.nbOnduleurs || 1) * ((tabState.fractionRepartition || 0) / 100);
  return tabTotalKva * ((fieldState.coefficient || 100) / 100);
}

// NOUVEAU (demande explicite : ratio DC/AC borné par le « Coef. de surdimensionnement » + puissance
// DC maximale de l'onduleur) : puissances d'UN onglet (pvId). La puissance AC retenue est la part de
// l'onduleur réellement affectée à l'onglet (P_apparente x Nbre d'onduleurs x % rép. puissance), même
// convention que computeAllocatedOnduleurKva. La P. max DC admissible suit la même part.
function computeTabPuissances(pvId, pans) {
  const representative = pans[0];
  const entry = getFieldOnduleurEntry(pvId, representative);
  const tabState = getPvTabState(pvId);
  const nbOnduleurs = tabState.nbOnduleurs || 1;
  const part = (tabState.fractionRepartition != null ? tabState.fractionRepartition : 100) / 100;
  const dcKwc = pans.reduce((sum, f) => sum + (f.peakPowerKwc || 0), 0);
  const pApparente = entry && entry.data ? (entry.data.ond_p_apparente_max_kva || 0) : 0;
  const acKva = pApparente * nbOnduleurs * part;
  const pMaxDcUnitaire = getOnduleurPuissanceMaxDcKw(entry);
  return {
    pvId,
    hasOnduleur: !!entry,
    dcKwc,
    acKva,
    ratioDcAc: acKva > 0 && dcKwc > 0 ? dcKwc / acKva : null,
    nbOnduleurs,
    pMaxDcUnitaire,
    pMaxDcAdmissible: pMaxDcUnitaire !== null ? pMaxDcUnitaire * nbOnduleurs * part : null,
  };
}

// Contrôle bloquant (demande explicite) : ratio DC/AC du système et de chaque onglet comparé au
// coefficient de surdimensionnement, puissance DC de chaque onglet comparée à la P. max DC de
// l'onduleur quand elle est renseignée. Sans onduleur choisi ou sans P. max DC en base, rien ne
// bloque. Retourne { ok, erreurs[], coef, systeme }.
// Le ratio PAR PAN n'est pas bloquant : il dépend du coefficient de répartition entre pans, une aide
// de saisie non enregistrée — le bloquer ferait réapparaître l'erreur à chaque rechargement.
function controlerDimensionnementOnduleurs(fields) {
  const coef = getCoefSurdimensionnement();
  const pvIds = getUniquePvIds(fields);
  const onglets = pvIds.map((pvId) => computeTabPuissances(pvId, fields.filter((f) => f.pvId === pvId)));
  const erreurs = [];

  // Système : même puissance AC que la carte « Ratio AC/DC (système) » (P_apparente x Nbre
  // d'onduleurs), pour que les deux cartes restent exactement inverses l'une de l'autre.
  const totalDcKwc = fields.reduce((sum, f) => sum + (f.peakPowerKwc || 0), 0);
  let totalAcKva = 0;
  onglets.forEach((o) => {
    if (!o.hasOnduleur) return;
    const entry = getFieldOnduleurEntry(o.pvId, fields.find((f) => f.pvId === o.pvId));
    totalAcKva += (entry.data.ond_p_apparente_max_kva || 0) * o.nbOnduleurs;
  });
  const ratioSysteme = totalAcKva > 0 && totalDcKwc > 0 ? totalDcKwc / totalAcKva : null;
  if (ratioSysteme !== null && ratioArrondi(ratioSysteme) > coef) {
    erreurs.push(`Ratio DC/AC (système) hors plage : ${ratioSysteme.toFixed(2)} est supérieur au coef. de surdimensionnement (${coef.toFixed(2)}).`);
  }

  onglets.forEach((o) => {
    // Un seul onglet à 100 % : son ratio est celui du système, déjà signalé ci-dessus.
    const doublonSysteme = onglets.length === 1 && ratioSysteme !== null && o.ratioDcAc !== null
      && ratioArrondi(o.ratioDcAc) === ratioArrondi(ratioSysteme);
    if (o.ratioDcAc !== null && !doublonSysteme && ratioArrondi(o.ratioDcAc) > coef) {
      erreurs.push(`Ratio DC/AC du champ ${o.pvId} hors plage : ${o.ratioDcAc.toFixed(2)} est supérieur au coef. de surdimensionnement (${coef.toFixed(2)}).`);
    }
    if (o.pMaxDcAdmissible !== null && o.dcKwc > o.pMaxDcAdmissible + 1e-6) {
      erreurs.push(`Champ ${o.pvId} : puissance DC de ${o.dcKwc.toFixed(2)} kWc supérieure à la puissance DC maximale admise par l'onduleur (${o.pMaxDcUnitaire.toFixed(2)} kW x ${o.nbOnduleurs} onduleur(s)${o.pMaxDcAdmissible !== o.pMaxDcUnitaire * o.nbOnduleurs ? ' x % rép. puissance' : ''} = ${o.pMaxDcAdmissible.toFixed(2)} kW).`);
    }
  });

  return { ok: erreurs.length === 0, erreurs, coef, onglets, systeme: { totalDcKwc, totalAcKva, ratioDcAc: ratioSysteme } };
}

function controleBloquantHTML(controle) {
  if (controle.ok) return '';
  return `
    <div style="margin-top: 12px; padding: 10px 14px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; color: #b91c1c; font-size: 0.82rem;">
      <div style="font-weight: 700; margin-bottom: 4px;"><i class="fas fa-ban" style="margin-right:6px;"></i>Calcul bloqué</div>
      ${controle.erreurs.map((m) => `<div>• ${m}</div>`).join('')}
      <div style="margin-top: 6px; color: #7f1d1d;">Pour relancer les calculs, modifiez le « Coef. de surdimensionnement » (Paramètres de conception), le choix ou le nombre d'onduleurs.</div>
    </div>`;
}

function renderGlobalResults() {
  const el = document.getElementById('chainesPertesGlobalResults');
  if (!el) return;
  const g = window.__chainesPertesGlobal;

  const totalDcKwc = g.fields.reduce((sum, f) => sum + (f.peakPowerKwc || 0), 0);
  // Nbre d'onduleurs est UN par onglet (pvId), pas par pan : sommer par pvId unique pour ne pas
  // compter 2x un onglet Bipente/Multipente qui a plusieurs pans partageant le même onduleur.
  const pvIds = getUniquePvIds(g.fields);
  const totalNbOnduleurs = pvIds.reduce((sum, pvId) => sum + (getPvTabState(pvId).nbOnduleurs || 0), 0);
  const totalPanelsProjet = g.fields.reduce((sum, f) => sum + (f.totalPanels || 0), 0);
  const controle = controlerDimensionnementOnduleurs(g.fields);

  // CORRECTIF (demande explicite : "replacer la carte Ratio AC/DC (système), assurez-vous que le
  // calcul fonctionne car l'utilisateur choisira la référence de l'onduleur depuis le formulaire") :
  // la carte n'avait pas disparu par erreur (retrait explicite d'une demande précédente), mais le
  // calcul source (totalAcKva) ne lisait QUE window.__chainesPertesGlobal.onduleur / le mode
  // 'perField' — jamais le choix fait dans le formulaire de calepinage résidentiel lui-même
  // (CM.state.onduleurRef). Remplacé par getFieldOnduleurEntry(pvId, field) PAR onglet — cette
  // fonction sait déjà retomber sur le choix résidentiel (getResidentialOnduleurEntry, cf. plus haut
  // dans ce fichier), donc le ratio se calcule maintenant correctement quelle que soit la façon dont
  // l'onduleur a été choisi.
  let totalAcKva = 0;
  let hasAnyOnduleur = false;
  pvIds.forEach((pvId) => {
    const representative = getPansForPvId(pvId)[0];
    const entry = getFieldOnduleurEntry(pvId, representative);
    if (entry && entry.data && entry.data.ond_p_apparente_max_kva) {
      hasAnyOnduleur = true;
      totalAcKva += entry.data.ond_p_apparente_max_kva * (getPvTabState(pvId).nbOnduleurs || 1);
    }
  });

  let ratioCard;
  let ratioDcAcCard;
  if (hasAnyOnduleur && totalDcKwc > 0) {
    const ratioAcDc = totalAcKva / totalDcKwc;
    ratioCard = window.chainesPertesMetricCard('Ratio AC/DC (système)', ratioAcDc.toFixed(2), ratioAcDc >= 1, 'green', true);
    // NOUVEAU (demande explicite : carte « Ratio DC/AC (système) » juste après la carte AC/DC) :
    // rouge quand le ratio dépasse le coefficient de surdimensionnement.
    const ratioDcAc = totalDcKwc / totalAcKva;
    const horsPlage = ratioArrondi(ratioDcAc) > controle.coef;
    ratioDcAcCard = window.chainesPertesMetricCard(
      `Ratio DC/AC (système)${horsPlage ? ' — hors plage' : ''}`,
      `${ratioDcAc.toFixed(2)} <span style="font-size:0.72rem; font-weight:400;">(max ${controle.coef.toFixed(2)})</span>`,
      false, horsPlage ? 'red' : 'green', true);
  } else {
    ratioCard = window.chainesPertesMetricCard('Ratio AC/DC (système)', 'Sélectionnez un onduleur', false, 'green', true);
    ratioDcAcCard = window.chainesPertesMetricCard('Ratio DC/AC (système)', 'Sélectionnez un onduleur', false, 'green', true);
  }

  // CORRECTIF (demande explicite : "placer les cartes dans cet ordre : Nb. panneaux projet, Puissance
  // PV totale (kWc), Nb. onduleurs (total système), Ratio AC/DC (système), avec une couleur par
  // carte : jaune doré, rouge, gris et vert clair" + "centrer les labels et résultats... fais ça pour
  // les 4 cartes").
  el.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
      ${window.chainesPertesMetricCard('Nb. panneaux projet', totalPanelsProjet, false, 'gold', true)}
      ${window.chainesPertesMetricCard('Puissance PV totale (kWc)', totalDcKwc.toFixed(2), false, 'red', true)}
      ${window.chainesPertesMetricCard('Nb. onduleurs (total système)', totalNbOnduleurs || 0, false, 'gray', true)}
      ${ratioCard}
      ${ratioDcAcCard}
    </div>
    ${controleBloquantHTML(controle)}
  `;
}

function readGlobalTempSettings() {
  // Champs absents tant que la modale n'a pas été créée : valeurs par défaut ci-dessous.
  const lire = (id) => { const el = document.getElementById(id); return el ? parseFloat(el.value) : NaN; };
  const tempMinRaw = lire('chainesPertesTempMin');
  const tempFunc = lire('chainesPertesTempFunc');
  const tempMax = lire('chainesPertesTempMax');
  // Temp. min : champ saisi en valeur positive (magnitude), signe négatif appliqué par défaut
  // (demande explicite : "la température minimale doit être entrée comme une valeur positive, le
  // signe moins doit être défini par défaut") — une saisie déjà négative (edge case, le clavier ne
  // l'empêche pas malgré l'attribut min="0") n'est pas re-signée une seconde fois.
  const tempMin = isNaN(tempMinRaw) ? -10 : (tempMinRaw > 0 ? -tempMinRaw : tempMinRaw);
  return {
    tempMin,
    tempFunc: isNaN(tempFunc) ? 25 : tempFunc,
    tempMax: isNaN(tempMax) ? 70 : tempMax,
  };
}

/**
 * Résout une référence panneau du calepinage dans le catalogue BD (window.panelCatalogFromApi).
 *
 * CORRECTIF (bug rapporté : "Câblage DC ne fonctionne pas" — cause réelle : des maisons
 * enregistrées AVANT le correctif du doublon de marque, cf. calepinage_maison_formulaires.js,
 * gardent encore en base un panelRef corrompu du type "Longi Longi LR7-54HVH" au lieu de
 * "Longi LR7-54HVH") : ce correctif n'était pas rétroactif — auto-guérison ici via un repli en
 * suffixe (la référence catalogue correcte est toujours la FIN de la valeur enregistrée, quel que
 * soit le nombre de fois où la marque a été préfixée) plutôt que d'exiger une migration de base de
 * données ou une re-sélection manuelle de chaque panneau déjà configuré.
 *
 * Extrait ici (il vivait dans le calcul de chaînage) pour servir AUSSI à la fiche technique
 * consultable depuis chaque carte de pan : les deux doivent viser exactement le même panneau, y
 * compris pour une référence héritée.
 *
 * @param {string} panelReference
 * @returns {object|null} l'entrée catalogue, ou null si la référence reste introuvable
 */
function resolvePanelFromCatalog(panelReference) {
  if (!panelReference) return null;
  const catalog = window.panelCatalogFromApi || [];
  return catalog.find((p) => p.reference === panelReference)
    || catalog.find((p) => p.reference && panelReference.endsWith(p.reference))
    || null;
}

/**
 * Fiche technique d'un panneau, sous forme « libellé -> valeur » prête pour renderDetailCard().
 * Les valeurs absentes du catalogue sont omises (renderDetailCard filtre déjà null/undefined/'').
 */
function panelTechnicalDetails(panelData) {
  const mm = (v) => (typeof v === 'number' ? `${v} mm` : null);
  const coef = (v) => (typeof v === 'number' ? `${v} %/°C` : null);
  return {
    'Fabricant': panelData.fabricant,
    'Référence': panelData.reference,
    'Puissance crête': typeof panelData.puissance_wc === 'number' ? `${panelData.puissance_wc} Wc` : null,
    'Type de module': panelData.type_module,
    'Nb. de cellules': panelData.nb_cellules,
    'Longueur': mm(panelData.longueur_mm),
    'Largeur': mm(panelData.largeur_mm),
    'Épaisseur': mm(panelData.epaisseur_mm),
    'Vmpp': typeof panelData.v_mpp === 'number' ? `${panelData.v_mpp} V` : null,
    'Impp': typeof panelData.i_mpp === 'number' ? `${panelData.i_mpp} A` : null,
    'Voc': typeof panelData.v_oc === 'number' ? `${panelData.v_oc} V` : null,
    'Isc': typeof panelData.i_sc === 'number' ? `${panelData.i_sc} A` : null,
    'Coef. Voc': coef(panelData.coef_voc_pct_c),
    'Coef. Isc': coef(panelData.coef_isc_pct_c),
    'Coef. Pmax': coef(panelData.coef_pmax_pct_c),
    'Tension système max': typeof panelData.tension_systeme_max === 'number' ? `${panelData.tension_systeme_max} V` : null,
    'Éligible TVA 5,5 %': panelData.eligible_tva === true ? 'Oui' : (panelData.eligible_tva === false ? 'Non' : null),
    'Distributeurs': panelData.distributeurs,
  };
}

/**
 * Ligne « Panneau (calepinage) : … » d'une carte de pan, avec son bouton de consultation.
 *
 * NOUVEAU (demande explicite : "ajouter un bouton pour que l'utilisateur puisse voir les détails
 * techniques du panneau choisi — il doit SEULEMENT afficher les détails, le choix reste dans le
 * formulaire calepinage") : la modale n'offrait aucun moyen de consulter les caractéristiques du
 * panneau sur lequel tout le chaînage est calculé. Le bouton est aligné sur le libellé (même ligne
 * flex) et n'ouvre qu'un panneau de lecture seule.
 *
 * @param {string} panelReference - référence telle qu'enregistrée par le calepinage
 * @param {string} cleBloc - identifiant unique du bloc (subPvId ou pvId), pour l'ancre d'affichage
 */
function panelLineHTML(panelReference, cleBloc) {
  const panelData = resolvePanelFromCatalog(panelReference);
  // Sans référence ou sans correspondance catalogue, il n'y a rien à montrer : on n'affiche pas un
  // bouton qui ouvrirait un panneau vide (le message de chaînage explique déjà le problème).
  // Style en ligne explicite (demande explicite : libellé toujours lisible, sans espaces rouges vides) :
  // la règle globale `.btn` d'Entete.css (fond rouge, largeur 27,5 %, marges 10 %, padding 2 %) se
  // combinait à `btn-outline-secondary` (texte gris) — texte gris illisible sur rouge tant que le bouton
  // n'était pas survolé/cliqué, et grand bloc rouge vide autour.
  const bouton = panelData ? `
        <button type="button" class="btn btn-sm btn-outline-secondary chains-panel-details-btn"
                style="font-size:0.72rem; line-height:1.3; padding:3px 10px; white-space:nowrap; width:auto; margin:0;
                       background:#de0000; background-image:none; color:#fff; border:none; border-radius:5px; flex:0 0 auto;"
                data-panel-details="${cleBloc}"
                onclick="window.chainesTogglePanelDetails(this)">Voir les données techniques du panneau</button>` : '';

  return `
      <div style="font-size: 0.82rem; color: #495057; margin-bottom: 10px; display:flex; flex-wrap:wrap;
                  align-items:center; gap:8px;">
        <span>Panneau (calepinage) : <strong>${panelReference || 'Non défini'}</strong>
          <span style="font-size: 0.72rem; color: #6c757d;"> — modifiable uniquement depuis la page Calepinage</span>
        </span>${bouton}
      </div>
      <div id="chains-panel-details-${cleBloc}" style="display:none; margin-bottom:10px;"></div>`;
}

/**
 * Affiche/masque la fiche technique sous la ligne « Panneau (calepinage) ». Lecture seule : aucun
 * champ modifiable, conformément à la demande (le choix du panneau reste au calepinage).
 * Exposée globalement : appelée par l'attribut onclick du bouton ci-dessus.
 */
window.chainesTogglePanelDetails = function (btn) {
  const cleBloc = btn.dataset.panelDetails;
  const conteneur = document.getElementById(`chains-panel-details-${cleBloc}`);
  if (!conteneur) return;

  if (conteneur.style.display !== 'none') {
    conteneur.style.display = 'none';
    btn.textContent = 'Voir les données techniques du panneau';
    return;
  }

  const bloc = btn.closest('[id^="chains-field-block-"]');
  const reference = bloc ? bloc.dataset.panelReference : null;
  const panelData = resolvePanelFromCatalog(reference);
  if (!panelData) return;

  const details = panelTechnicalDetails(panelData);
  // renderDetailCard (equipements_details_card.js) est le rendu déjà utilisé par les modales
  // favoris panneaux/onduleurs/batteries — même présentation partout. Repli minimal si ce script
  // n'est pas chargé sur la page hôte.
  conteneur.innerHTML = typeof window.renderDetailCard === 'function'
    ? window.renderDetailCard(details)
    : `<pre style="font-size:0.75rem;">${JSON.stringify(details, null, 2)}</pre>`;
  conteneur.style.display = 'block';
  btn.textContent = 'Masquer les données techniques du panneau';
};

/**
 * Dimensionnement de chaînes pour UN pan de toiture (son propre panneau, résolu dans le catalogue
 * DB par référence, + l'onduleur partagé du système). Utilisé par perte_systeme.js (sous-
 * calculateur DC) et par ce fichier pour afficher les résultats de chaînage de chaque pan.
 * Retourne { ok:false, reason } si le panneau ou l'onduleur ne sont pas disponibles.
 */
window.computeFieldChainSizing = function (field) {
  // CORRECTIF (vraie cause racine du Câblage DC non fonctionnel, cf. getResidentialOnduleurEntry
  // ci-dessus) : essaie d'abord le circuit Pro/Grand-projet existant (inchangé), puis se replie sur
  // l'onduleur choisi directement dans le calepinage résidentiel du champ concerné — désormais géré
  // DANS getFieldOnduleurEntry elle-même (2e paramètre `field`), pour que ce même repli profite aussi
  // à l'affichage (pvTabCardHTML) et à computeAllocatedOnduleurKva, pas seulement à ce calcul.
  const onduleurEntry = getFieldOnduleurEntry(field.pvId, field);
  if (!onduleurEntry) {
    const reason = window.__chainesOnduleurMode === 'perField'
      ? "Choisissez un onduleur pour ce champ PV pour calculer le chaînage."
      : "Choisissez un onduleur (partagé pour le système) pour calculer le chaînage.";
    return { ok: false, reason };
  }

  if (!field.panelReference) return { ok: false, reason: 'Aucun panneau choisi pour ce champ PV dans le calepinage.' };
  const panelData = resolvePanelFromCatalog(field.panelReference);
  if (!panelData) return { ok: false, reason: `Référence panneau "${field.panelReference}" introuvable dans le catalogue BD — modifiez-la depuis la page Calepinage.` };

  const panel = {
    pv_voc: panelData.v_oc,
    pv_k_voc: panelData.coef_voc_pct_c,
    pv_vmpp: panelData.v_mpp,
    pv_k_p: panelData.coef_pmax_pct_c,
    pv_isc: panelData.i_sc,
    pv_tension_systeme: panelData.tension_systeme_max,
  };
  // Appareil générique hors réseau (onduleurs_hors_reseau.js) : ses valeurs sont relues À CHAQUE
  // calcul depuis le module, pour qu'une saisie modifiée après le choix soit prise en compte
  // (l'entrée mémorisée au moment du choix n'en est qu'une copie). Sans effet pour un onduleur réseau.
  const horsReseauModele = window.OnduleursHorsReseau && window.OnduleursHorsReseau.trouver(onduleurEntry.data && onduleurEntry.data.ref);
  let onduleurData = onduleurEntry.data;
  if (horsReseauModele) {
    const ligne = window.OnduleursHorsReseau.versLigneCatalogue(horsReseauModele);
    onduleurData = Object.assign({}, onduleurData, {
      ond_tension_max_dc: ligne.tension_max_dc,
      ond_tension_min_dc: ligne.tension_min_dc,
      ond_plage_mppt_min: ligne.plage_mppt_min,
      ond_plage_mppt_max: ligne.plage_mppt_max,
      ond_imax_mppt: ligne.courant_max_mppt,
      ond_courant_cc_max_mppt: ligne.courant_cc_max_mppt,
      ond_tension_mpp_recommandee: ligne.tension_mpp_recommandee,
      ond_courant_max_sortie_ac: ligne.courant_max_sortie_ac,
      ond_tension_nominale_ac: ligne.tension_nominale_ac,
      ond_type_tension: ligne.type_tension,
      ond_puissance_max_dc_kw: ligne.puissance_max_dc_kw,
      ond_technologie: ligne.technologie,
      hasFullData: true,
    });
  }
  const hasFullOnduleurData = onduleurData.hasFullData !== false;

  // NOUVEAU (demande explicite : "dimensionnement des chaînes en fonction du type du choix
  // d'onduleurs ... micro-onduleurs") : un micro-onduleur n'a pas de dimensionnement MPPT/chaîne
  // (1 module = 1 micro-onduleur) — sa contrainte est le nb d'UNITÉS admissible par phase (mono/tri)
  // sur un même circuit 20A / une même section de câble AC, cf. calculateMicroOnduleurSizing.
  if (onduleurData.ond_technologie === 'Micro-onduleur') {
    const phase = (onduleurData.ond_type_tension || '').toLowerCase().includes('tri') ? 'tri' : 'mono';
    const microSizing = window.StringSizingUtils.calculateMicroOnduleurSizing(
      {
        nb_max_unites_mono_20a: onduleurData.ond_nb_max_unites_mono_20a,
        nb_max_unites_tri_20a: onduleurData.ond_nb_max_unites_tri_20a,
        nb_max_unites_cable_mono: onduleurData.ond_nb_max_unites_cable_mono,
        nb_max_unites_cable_poly: onduleurData.ond_nb_max_unites_cable_poly,
      },
      phase,
    );
    return { ok: true, isMicroOnduleur: true, microSizing, phase, panelData, onduleurData, hasFullOnduleurData };
  }

  const inverter = {
    ond_tension_max_dc: onduleurData.ond_tension_max_dc,
    ond_tension_min_dc: onduleurData.ond_tension_min_dc,
    ond_plage_mppt_min: onduleurData.ond_plage_mppt_min,
    ond_plage_mppt_max: onduleurData.ond_plage_mppt_max,
    ond_imax_mppt: onduleurData.ond_imax_mppt,
    // CORRECTIF (bug rapporté : nombre de chaînes/MPPT erroné, cf. string_sizing_utils.js).
    ond_courant_cc_max_mppt: onduleurData.ond_courant_cc_max_mppt,
    // Renseignée pour les seuls appareils hors réseau (cf. string_sizing_utils.js).
    ond_tension_mpp_recommandee: onduleurData.ond_tension_mpp_recommandee,
  };
  const sizing = window.StringSizingUtils.calculateStringSizing(panel, inverter, readGlobalTempSettings());

  // Hors réseau : le nombre de chaînes par MPPT tient compte des entrées DC de l'appareil et du
  // coffret de regroupement (OnduleursHorsReseau.analyserChainage). Même formule de limite en
  // courant que ci-dessus ; onduleurs réseau non concernés.
  if (horsReseauModele) {
    const horsReseau = window.OnduleursHorsReseau.analyserChainage(horsReseauModele, sizing.nbChaineMaxParMppt, panel.pv_isc);
    sizing.nbChaineMaxParMppt = horsReseau.nbMaxParMppt;
    return { ok: true, sizing, panelData, onduleurData, hasFullOnduleurData, optimiseurInfo: null, horsReseau };
  }

  // NOUVEAU (demande explicite : "tenir compte du type d'optimiseur par modèle d'onduleur ... le
  // nombre d'optimiseurs MIN_MAX par chaine et la puissance PV") : quand l'onduleur est compatible
  // optimiseur/hybride ET qu'un optimiseur a été choisi pour CE pan (fieldState.optimiseurRef, cf.
  // wireOptimiseurSelect), les bornes de chaîne affichées/utilisées pour la config. automatique
  // deviennent celles de LA PAIRE optimiseur/onduleur (jamais une borne générique) — sizing MPPT brut
  // conservé tel quel en repli si aucun optimiseur n'est sélectionné.
  const compatOptimiseur = onduleurData.ond_compat_optimiseur || onduleurData.ond_hybride;
  let optimiseurInfo = null;
  if (compatOptimiseur) {
    const catalog = window.optimiseurCatalogFromApi || [];
    const compatibles = catalog.filter((o) => (o.compatible_onduleurs || []).some((c) => c.reference === onduleurData.ref));
    const fieldState = getChainsFieldState(field);
    let bornes = null;
    if (fieldState.optimiseurRef) {
      const opt = catalog.find((o) => o.reference === fieldState.optimiseurRef);
      if (opt) {
        bornes = window.StringSizingUtils.getOptimiseurBornesPourOnduleur(opt.compatible_onduleurs, onduleurData.ref);
      }
    }
    optimiseurInfo = { compatibles, selectedRef: fieldState.optimiseurRef || '', bornes };
    if (bornes && (bornes.chaineMin != null || bornes.chaineMax != null)) {
      sizing.nbPvParChaine = `${bornes.chaineMin != null ? bornes.chaineMin : '?'} / ${bornes.chaineMax != null ? bornes.chaineMax : '?'}`;
    }
  }

  return { ok: true, sizing, panelData, onduleurData, hasFullOnduleurData, optimiseurInfo };
};

// Propage l'onduleur partagé (rendement/conso/puissance) vers les champs hôtes masqués de CHAQUE
// ONGLET (pvId) du système — UNE fois par onglet, pas par pan (les pans d'un même onglet partagent
// les mêmes champs hôtes #puissance_onduleur-<pvId>/etc., qui n'existent qu'au niveau onglet) —
// pour que SummaryModal.js reste correct pour l'ensemble du projet sans configuration répétée.
function propagateOnduleurToAllFields() {
  const g = window.__chainesPertesGlobal;
  getUniquePvIds(g.fields).forEach((pvId) => {
    const representativeField = g.fields.find((f) => f.pvId === pvId);
    const entry = getFieldOnduleurEntry(pvId, representativeField);
    if (!entry) return;
    const data = entry.data;
    writeHostField('puissance_onduleur-' + pvId, data.ond_p_apparente_max_kva, pvId);
    writeHostField('rendementOnduleur-' + pvId, data.ond_rendement, pvId);
    writeHostField('consoOnduleur-' + pvId, data.ond_conso, pvId);
  });
}

// Onduleurs hors réseau (onduleurs_hors_reseau.js) : nombre de chaînes au plus raccordables au
// champ — chaînes en parallèle par MPPT (limite en courant Icc max MPPT / (1,25 x Isc), coffret ou
// non) x nb MPPT x nb d'onduleurs de l'onglet. null pour un onduleur réseau (pas de limite ici).
// Demande explicite : "anticiper le courant total par rapport au nombre de chaînes en parallèle —
// suggérer 3 chaînes en dimensionnement automatique, refuser 4 si cela dépasse le courant d'entrée".
function capaciteChainesHorsReseau(field, chainInfo) {
  const info = chainInfo || window.computeFieldChainSizing(field);
  if (!info || !info.ok || !info.horsReseau) return null;
  const nbOnduleurs = Math.max(1, parseInt(getPvTabState(field.pvId).nbOnduleurs, 10) || 1);
  return {
    max: info.horsReseau.capaciteTotale * nbOnduleurs,
    parMppt: info.horsReseau.nbMaxParMppt,
    nbMppt: info.horsReseau.nbMppt,
    nbOnduleurs,
  };
}

// Config. PV utilisateur refusée (non utilisée par le câblage DC) quand elle dépasse la capacité.
function userConfigDepasseCapacite(field, userConfig) {
  if (!userConfig) return null;
  const cap = capaciteChainesHorsReseau(field);
  if (!cap) return null;
  const nbChaines = window.StringSizingUtils.expandStringConfigToList(userConfig).length;
  return nbChaines > cap.max ? { nbChaines, cap } : null;
}

function userConfigValidationHTML(field, fieldState) {
  if (!fieldState.userConfig) return '';
  const total = parseUserPvConfig(fieldState.userConfig);
  const match = total === field.totalPanels;
  const color = match ? '#146c43' : '#b02a37';
  const msg = match
    ? `✓ Total : ${total} panneaux (correspond au champ)`
    : `✗ Total saisi : ${total} panneaux — attendu : ${field.totalPanels} (champ ${field.subPvId})`;
  const depasse = userConfigDepasseCapacite(field, fieldState.userConfig);
  const msgCapacite = depasse
    ? `<div style="font-size: 0.78rem; color: #b02a37; margin-top: 4px;">✗ Configuration refusée : ${depasse.nbChaines} chaînes saisies, mais au plus ${depasse.cap.max} admise${depasse.cap.max > 1 ? 's' : ''} (${depasse.cap.parMppt} chaîne${depasse.cap.parMppt > 1 ? 's' : ''} en parallèle par MPPT, limite en courant d'entrée du MPPT, × ${depasse.cap.nbMppt} MPPT${depasse.cap.nbOnduleurs > 1 ? ` × ${depasse.cap.nbOnduleurs} onduleurs` : ''}). Réduisez le nombre de chaînes — la config. automatique est utilisée en attendant.</div>`
    : '';
  return `<div style="font-size: 0.78rem; color: ${color}; margin-top: 4px;">${msg}</div>${msgCapacite}`;
}

function remainingCapacityHTML(tabState) {
  const frac = parseFloat(tabState.fractionRepartition);
  const remaining = 100 - (isNaN(frac) ? 0 : frac);
  if (remaining <= 0) return '';
  return `<div style="font-size: 0.76rem; color: #146c43; margin-top: 4px;">Il reste ${remaining}% de cet onduleur à utiliser.</div>`;
}

// Carte "onduleur de l'onglet" : Nbre d'onduleurs / % rép. puissance, UNE fois par onglet (pvId),
// pas par pan (cf. en-tête de fichier). Référence onduleur + puissance du champ PV ajoutées au
// titre (demande explicite : "savoir dans quel champ PV il travaille"), en complément des champs
// déjà existants (Nbre d'onduleurs, % rép. puissance), sans les remplacer.
function pvTabCardHTML(pvId, nbPans) {
  const tabState = getPvTabState(pvId);
  const perField = window.__chainesOnduleurMode === 'perField';
  const pansForTab = getPansForPvId(pvId);
  // CORRECTIF (bug rapporté : "l'onduleur choisi disparaît après actualisation" + demande explicite :
  // "retrouver dans le modal de dimensionnement l'onduleur choisi dans le formulaire calepinage") :
  // un field représentatif de l'onglet (n'importe lequel des pans, ils partagent le même onduleur de
  // toiture résidentielle) permet à getFieldOnduleurEntry de se replier sur le choix fait dans le
  // formulaire de calepinage résidentiel (CM.state.onduleurRef) si aucun choix n'a encore été fait
  // dans ce modal — jusqu'ici cet affichage ignorait totalement ce repli.
  const onduleurEntry = getFieldOnduleurEntry(pvId, pansForTab[0]);
  const onduleurRef = onduleurEntry ? `${onduleurEntry.data.fab || ''} ${onduleurEntry.data.ref || ''}`.trim() : null;
  const tabPowerKwc = pansForTab.reduce((sum, f) => sum + (f.peakPowerKwc || 0), 0);
  const subtitleParts = [
    onduleurRef ? `Onduleur : ${onduleurRef}` : (perField ? 'Aucun onduleur choisi pour ce champ' : null),
    `Puissance champ : ${tabPowerKwc.toFixed(2)} kWc`,
  ].filter(Boolean);
  // NOUVEAU (demande explicite : "Choix des onduleurs" — Par champ PV) : en mode 'perField', la
  // ligne "Onduleur" partagée n'apparaît plus dans #chainesPertesEquipementSection (cf.
  // renderEquipementRows) — le choix se fait ici, directement dans la carte de cet onglet.
  // Appareil générique hors réseau : rappel des données de l'architecture transmises au calcul,
  // modifiables depuis la modale « Architecture élec. système PV » (onduleurs_hors_reseau.js).
  const horsReseauResume = onduleurEntry && window.OnduleursHorsReseau
    ? window.OnduleursHorsReseau.resumeChainesHTML(onduleurEntry.data.ref) : '';
  const perFieldChoiceBtn = perField
    ? `<button type="button" class="btn btn-sm" data-pv-choisir-onduleur="${pvId}" style="width: auto; margin: 4px 0 8px 0; background:#5d5e5f; color:#fff; border-color:#5d5e5f;">${onduleurEntry ? 'Changer' : 'Choisir'} l'onduleur de ce champ</button>`
    : '';
  return `
    <div id="chains-tab-block-${pvId}" style="border: 1px solid #cfd8e3; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; background: #f8f9fa;">
      <div style="font-weight: bold; color: #212529; margin-bottom: 2px;">Onduleur de l'onglet ${pvId}${nbPans > 1 ? ` (partagé entre ${nbPans} pans de toiture)` : ''}</div>
      <div style="font-size: 0.78rem; color: #495057; margin-bottom: 8px;">${subtitleParts.join(' — ')}</div>
      ${horsReseauResume}
      <div id="chains-pmaxdc-${pvId}">${tabPuissanceMaxDcHTML(pvId)}</div>
      ${perFieldChoiceBtn}
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
        <div style="padding: 10px 12px; background: #fff; border: 1px solid #e9ecef; border-radius: 6px;">
          <label style="font-size: 0.75rem; color: #495057; display: block; margin-bottom: 4px;">Nbre d'onduleurs</label>
          <input type="number" min="1" max="50" step="1" class="form-control form-control-sm" data-tab-input="${pvId}:nbOnduleurs" value="${tabState.nbOnduleurs}" />
          <div data-tab-error="${pvId}:nbOnduleurs" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
        </div>
        <div style="padding: 10px 12px; background: #fff; border: 1px solid #e9ecef; border-radius: 6px;">
          <label style="font-size: 0.75rem; color: #495057; display: block; margin-bottom: 4px;">% rép. puissance</label>
          <input type="number" min="0" max="100" step="1" class="form-control form-control-sm" data-tab-input="${pvId}:fractionRepartition" value="${tabState.fractionRepartition}" />
          <div data-tab-error="${pvId}:fractionRepartition" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
          <div id="chains-remaining-${pvId}">${remainingCapacityHTML(tabState)}</div>
        </div>
      </div>
    </div>
  `;
}

function wirePvTabCard(pvId) {
  const block = document.getElementById(`chains-tab-block-${pvId}`);
  if (!block) return;
  const tabState = getPvTabState(pvId);

  const choiceBtn = block.querySelector(`[data-pv-choisir-onduleur="${pvId}"]`);
  if (choiceBtn) {
    choiceBtn.addEventListener('click', () => triggerEquipSelectionForPv('onduleur', pvId));
  }
  const horsReseauBtn = block.querySelector('[data-hr-ouvrir-architecture]');
  if (horsReseauBtn && window.OnduleursHorsReseau) {
    horsReseauBtn.addEventListener('click', () => window.OnduleursHorsReseau.ouvrirModale(horsReseauBtn.getAttribute('data-hr-ouvrir-architecture')));
  }

  const nbOndInput = block.querySelector(`[data-tab-input="${pvId}:nbOnduleurs"]`);
  if (nbOndInput) {
    const nbOndError = block.querySelector(`[data-tab-error="${pvId}:nbOnduleurs"]`);
    nbOndInput.addEventListener('input', () => {
      // Validation bloquante (demande explicite, plage 1-50) : une saisie invalide n'écrase jamais
      // tabState/le champ hôte — la dernière valeur connue valide continue d'alimenter les calculs.
      const result = validateNumericField(nbOndInput.value, { min: 1, max: 50, integer: true, label: "Nbre d'onduleurs" });
      showFieldValidation(nbOndInput, nbOndError, result);
      if (!result.valid) return;
      tabState.nbOnduleurs = result.value;
      writeHostField('nbOnduleurs-' + pvId, tabState.nbOnduleurs, pvId);
      saveChainesPertesLocalCache();
      refreshTabControls(pvId);
      // CORRECTIF (cf. refreshOnduleurSplitCard) : la carte "Chaînes par onduleur" (masquée/affichée
      // selon nbOnduleurs > 1) doit réagir IMMÉDIATEMENT à ce changement, pas seulement au prochain
      // rendu complet du modal.
      refreshOnduleurSplitCard(pvId);
    });
  }

  const fracInput = block.querySelector(`[data-tab-input="${pvId}:fractionRepartition"]`);
  if (fracInput) {
    const fracError = block.querySelector(`[data-tab-error="${pvId}:fractionRepartition"]`);
    fracInput.addEventListener('input', () => {
      const result = validateNumericField(fracInput.value, { min: 0, max: 100, label: '% répartition puissance' });
      showFieldValidation(fracInput, fracError, result);
      if (!result.valid) return;
      tabState.fractionRepartition = result.value;
      writeHostField('fractionRepartitionOnduleur-' + pvId, tabState.fractionRepartition, pvId);
      saveChainesPertesLocalCache();
      const msgEl = document.getElementById(`chains-remaining-${pvId}`);
      if (msgEl) msgEl.innerHTML = remainingCapacityHTML(tabState);
      // % rép. puissance entre désormais dans le ratio DC/AC de l'onglet et la P. max DC admissible.
      refreshTabControls(pvId);
    });
  }
}

function fieldRatioAcDcHTML(field) {
  const allocatedKva = computeAllocatedOnduleurKva(field);
  if (!allocatedKva || !field.peakPowerKwc) {
    return window.chainesPertesMetricCard('Ratio AC/DC (pan)', 'N/A', false);
  }
  const ratio = allocatedKva / field.peakPowerKwc;
  return window.chainesPertesMetricCard('Ratio AC/DC (pan)', ratio.toFixed(2), ratio >= 1);
}

// NOUVEAU (demande explicite : « Ratio DC/AC (pan) » juste après « Ratio AC/DC (pan) ») : inverse
// du ratio AC/DC du pan, signalé quand il dépasse le coefficient de surdimensionnement (indicatif —
// le blocage se fait par onglet et pour le système, cf. controlerDimensionnementOnduleurs).
function fieldRatioDcAcHTML(field) {
  const allocatedKva = computeAllocatedOnduleurKva(field);
  if (!allocatedKva || !field.peakPowerKwc) {
    return window.chainesPertesMetricCard('Ratio DC/AC (pan)', 'N/A', false);
  }
  const ratio = field.peakPowerKwc / allocatedKva;
  const coef = getCoefSurdimensionnement();
  const horsPlage = ratioArrondi(ratio) > coef;
  return window.chainesPertesMetricCard(
    `Ratio DC/AC (pan)${horsPlage ? ' — hors plage' : ''}`,
    `${ratio.toFixed(2)} <span style="font-size:0.7rem; font-weight:400;">(max ${coef.toFixed(2)})</span>`,
    false, horsPlage ? 'red' : undefined);
}

function recomputeFieldRatio(field) {
  const card = document.getElementById(`chains-ratio-${field.subPvId}`);
  if (card) card.innerHTML = fieldRatioAcDcHTML(field);
  const cardDcAc = document.getElementById(`chains-ratio-dcac-${field.subPvId}`);
  if (cardDcAc) cardDcAc.innerHTML = fieldRatioDcAcHTML(field);
}

// NOUVEAU (demande explicite : afficher la puissance DC maximale de l'onduleur quand elle est
// renseignée en base, et signaler son dépassement) : ligne de la carte « Onduleur de l'onglet ».
// Rien n'est affiché quand la donnée est absente du catalogue.
function tabPuissanceMaxDcHTML(pvId) {
  const o = computeTabPuissances(pvId, getPansForPvId(pvId));
  if (o.pMaxDcUnitaire === null) return '';
  const depasse = o.dcKwc > o.pMaxDcAdmissible + 1e-6;
  const couleur = depasse ? '#b91c1c' : '#146c43';
  const detail = o.nbOnduleurs > 1 || o.pMaxDcAdmissible !== o.pMaxDcUnitaire
    ? ` — admissible pour ce champ : ${o.pMaxDcAdmissible.toFixed(2)} kW`
    : '';
  return `
    <div style="font-size: 0.78rem; color: ${couleur}; margin-bottom: 8px;">
      ${depasse ? '✗' : '✓'} P. max DC onduleur : ${o.pMaxDcUnitaire.toFixed(2)} kW${detail}
      (puissance DC du champ : ${o.dcKwc.toFixed(2)} kWc)${depasse ? ' — dépassement, calcul bloqué' : ''}
    </div>`;
}

// Rafraîchit ce qui dépend de Nbre d'onduleurs / % rép. puissance sans reconstruire la carte de
// l'onglet (l'input en cours de frappe garderait sinon mal son focus).
function refreshTabControls(pvId) {
  const el = document.getElementById(`chains-pmaxdc-${pvId}`);
  if (el) el.innerHTML = tabPuissanceMaxDcHTML(pvId);
  renderGlobalResults();
  getPansForPvId(pvId).forEach((field) => recomputeFieldRatio(field));
}

// NOUVEAU (demande explicite : "faire apparaître un label du type de toiture", visible uniquement
// pour les toitures à plusieurs pans) : field.toitureType est renseigné pour le Pro/Grand-projet
// (cf. SummaryModal.js::pvFieldsForChainesPertes.push) avec les valeurs de formValues.
// toiture_pente_type (CalculationUtils.getSubFieldsData) — absent côté résidentiel (pans = polygones
// libres, sans notion de type figé Bipente/Multipente), d'où le repli générique "Toiture à N pans".
function roofTypeLabel(field, nbPans) {
  const map = {
    Bipente_symetrique: 'Toiture Bipente symétrique',
    Bipente_asymetrique: 'Toiture Bipente asymétrique',
    Multipente: 'Toiture 4 pans (Multipente)',
  };
  return (field && map[field.toitureType]) || `Toiture à ${nbPans} pans`;
}

// NOUVEAU (demande explicite : dimensionnement micro-onduleurs/optimiseurs) : bloc HTML partagé entre
// chainFieldCardHTML (1 pan) et chainMergedFieldsCardHTML (pans fusionnés) — soit le panneau "Micro-
// onduleurs" (nb max d'unités par phase), soit le sélecteur "Optimiseur compatible" quand l'onduleur
// choisi le permet. Retourne '' si aucun des deux ne s'applique (onduleur de chaîne classique sans
// optimiseur), pour ne rien changer à l'affichage existant dans ce cas.
function chainExtrasHTML(chainInfo, subPvId) {
  if (chainInfo.isMicroOnduleur) {
    const { microSizing, phase } = chainInfo;
    const phaseLabel = phase === 'tri' ? 'Triphasé (3L+N)' : 'Monophasé (L+N)';
    if (!microSizing || microSizing.nbMaxUnites == null) {
      return `<div style="margin-top: 8px; padding: 8px 10px; background: #fff3cd; border: 1px solid #ffe69c; border-radius: 6px; color: #664d03; font-size: 0.8rem;">Micro-onduleur hors catalogue BD ou données de phase manquantes — nombre max d'unités par circuit inconnu.</div>`;
    }
    return `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
        ${window.chainesPertesMetricCard('Raccordement', phaseLabel)}
        ${window.chainesPertesMetricCard(`Nb. max micro-onduleurs / circuit`, microSizing.nbMaxUnites)}
      </div>
      <div style="margin-top: 6px; font-size: 0.76rem; color: #6c757d;">Limite la plus contraignante : ${microSizing.limitant}${microSizing.details && microSizing.details.length > 1 ? ` (${microSizing.details.map((d) => `${d.label} : ${d.val}`).join(', ')})` : ''}.</div>
    `;
  }
  if (chainInfo.horsReseau && window.OnduleursHorsReseau) {
    return window.OnduleursHorsReseau.chainageHTML(chainInfo.horsReseau);
  }
  if (chainInfo.optimiseurInfo) {
    const { compatibles, selectedRef, bornes } = chainInfo.optimiseurInfo;
    if (compatibles.length === 0) {
      return `<div style="margin-top: 8px; padding: 8px 10px; background: #f1f3f5; border: 1px solid #dee2e6; border-radius: 6px; color: #495057; font-size: 0.8rem;">Aucun optimiseur compatible avec cet onduleur n'est encore renseigné dans la BD matériels.</div>`;
    }
    const options = compatibles.map((o) => `<option value="${o.reference}" ${o.reference === selectedRef ? 'selected' : ''}>${o.fabricant} — ${o.reference}</option>`).join('');
    const bornesHTML = bornes
      ? `<div style="margin-top: 4px; font-size: 0.76rem; color: #146c43;">Chaîne compatible : ${bornes.chaineMin ?? '?'}–${bornes.chaineMax ?? '?'} PV${bornes.puissanceMaxW != null ? ` · Puissance PV max : ${bornes.puissanceMaxW} W` : ''}</div>`
      : '';
    return `
      <div style="margin-top: 10px; padding: 10px 12px; background: #fff; border: 1px solid #e9ecef; border-radius: 6px; max-width: 420px;">
        <label style="font-size: 0.75rem; color: #495057; display: block; margin-bottom: 4px;">Optimiseur (compatible avec cet onduleur)</label>
        <select class="form-select form-select-sm" data-optimiseur-select="${subPvId}">
          <option value="">— Aucun —</option>
          ${options}
        </select>
        ${bornesHTML}
      </div>
    `;
  }
  return '';
}

// Écouteur délégué (une seule fois) pour tous les sélecteurs "Optimiseur" — nouveaux blocs ajoutés à
// chaque re-rendu, un listener direct par <select> serait réattaché/perdu à chaque fois.
if (!window.__chainesOptimiseurListenerAttached) {
  window.__chainesOptimiseurListenerAttached = true;
  document.addEventListener('change', (e) => {
    const select = e.target.closest('[data-optimiseur-select]');
    if (!select) return;
    const subPvId = select.getAttribute('data-optimiseur-select');
    const field = (window.__chainesPertesGlobal.fields || []).find((f) => f.subPvId === subPvId);
    if (!field) return;
    getChainsFieldState(field).optimiseurRef = select.value || null;
    renderChainesPertesModal();
  });
}

function chainFieldCardHTML(field, nbPans) {
  const chainInfo = window.computeFieldChainSizing(field);
  const fieldState = getChainsFieldState(field);

  let chainMetricsHTML;
  if (!chainInfo.ok) {
    chainMetricsHTML = `<div style="padding: 10px; color: #6c757d; font-style: italic; font-size: 0.85rem;">${chainInfo.reason}</div>`;
  } else if (chainInfo.isMicroOnduleur) {
    // NOUVEAU (demande explicite) : pas de dimensionnement MPPT/chaîne pour un micro-onduleur —
    // remplace entièrement les métriques de chaîne classiques par le panneau "Micro-onduleurs".
    chainMetricsHTML = chainExtrasHTML(chainInfo, field.subPvId);
  } else {
    const { sizing } = chainInfo;
    const warning = chainInfo.hasFullOnduleurData === false
      ? '<div style="margin-top: 8px; padding: 8px 10px; background: #fff3cd; border: 1px solid #ffe69c; border-radius: 6px; color: #664d03; font-size: 0.8rem;">Onduleur hors catalogue BD : caractéristiques MPPT inconnues (résultats à 0).</div>'
      : '';

    // Config. automatique : configuration de chaînage optimale calculée à partir du nombre de PV/
    // chaîne (min/max, "Nbre PV Min/Max") et du nombre total de panneaux de ce pan
    // (StringSizingUtils.calculateOptimalStrings), affichée à côté de "Config. PV utilisateur".
    const [minPv, maxPv] = String(sizing.nbPvParChaine).split('/').map((s) => parseInt(s.trim(), 10));
    let autoConfigCard = '';
    if (field.totalPanels > 0 && !isNaN(minPv) && !isNaN(maxPv)) {
      const cap = capaciteChainesHorsReseau(field, chainInfo);
      const optimal = window.StringSizingUtils.calculateOptimalStrings(field.totalPanels, minPv, maxPv, cap ? cap.max : undefined);
      autoConfigCard = window.chainesPertesMetricCard(`Config. automatique (${field.totalPanels} panneaux)`, optimal.displayText);
    }

    chainMetricsHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
        ${window.chainesPertesMetricCard('Nb. max chaînes / MPPT', sizing.nbChaineMaxParMppt)}
        ${window.chainesPertesMetricCard('Nb. PV / chaîne (min / max)', sizing.nbPvParChaine)}
        ${window.chainesPertesMetricCard('Nb. PV rendement optimal à STC', sizing.nbPvRendOptimal)}
        ${window.chainesPertesMetricCard('Tension optimale (V)', Number(sizing.optimalVoltage || 0).toFixed(1))}
        ${autoConfigCard}
        <div id="chains-ratio-${field.subPvId}">${fieldRatioAcDcHTML(field)}</div>
        <div id="chains-ratio-dcac-${field.subPvId}">${fieldRatioDcAcHTML(field)}</div>
      </div>
      ${warning}
      ${chainExtrasHTML(chainInfo, field.subPvId)}
    `;
  }

  const coefficientHTML = nbPans > 1 ? `
    <div style="padding: 10px 12px; background: #fff; border: 1px solid #e9ecef; border-radius: 6px;">
      <span style="display:inline-block; font-size: 0.7rem; font-weight: 600; color: #0f766e; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 4px; padding: 2px 6px; margin-bottom: 6px;">${roofTypeLabel(field, nbPans)}</span>
      <label style="font-size: 0.75rem; color: #495057; display: block; margin-bottom: 4px;">Coefficient puissance onduleur (%) — répartition entre pans</label>
      <input type="number" min="0" max="100" step="0.1" class="form-control form-control-sm" data-chain-input="coefficient" value="${fieldState.coefficient}" />
      <div data-chain-error="coefficient-${field.subPvId}" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
    </div>
  ` : '';

  return `
    <div id="chains-field-block-${field.subPvId}" data-panel-reference="${field.panelReference || ''}" style="border: 1px solid #dee2e6; border-radius: 8px; padding: 16px 16px 16px 28px; margin-bottom: 16px; background: #fff;">
      <div style="font-weight: bold; color: #212529; margin-bottom: 4px;">Pan : ${field.subPvId} (${field.totalPanels} panneaux)</div>
      ${panelLineHTML(field.panelReference, field.subPvId)}

      ${chainMetricsHTML}

      <div style="margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
        ${coefficientHTML}
        <div style="padding: 10px 12px; background: #fff; border: 1px solid #e9ecef; border-radius: 6px;">
          <label style="font-size: 0.75rem; color: #495057; display: block; margin-bottom: 4px;">Config. PV utilisateur (ex: 2 Ch x 20 PV + 1 Ch x 19 PV)</label>
          <div data-user-config-container="${field.subPvId}" style="display:block; position:static; float:none; width:100%; text-align:left;"></div>
          <div id="chains-config-validation-${field.subPvId}">${userConfigValidationHTML(field, fieldState)}</div>
        </div>
        ${onduleurSplitFieldHTML(field, fieldState)}
      </div>

      <button type="button" class="btn btn-sm" data-cablage-dc-btn="${field.subPvId}" style="margin-top: 12px; background:#0f766e; color:#fff; border-color:#0f766e;">
        <i class="fas fa-network-wired"></i> Câblage DC
      </button>
    </div>
  `;
}

function wireChainFieldCard(field) {
  const block = document.getElementById(`chains-field-block-${field.subPvId}`);
  if (!block) return;
  const fieldState = getChainsFieldState(field);

  const coefInput = block.querySelector('[data-chain-input="coefficient"]');
  if (coefInput) {
    const coefError = block.querySelector(`[data-chain-error="coefficient-${field.subPvId}"]`);
    coefInput.addEventListener('input', () => {
      const result = validateNumericField(coefInput.value, { min: 0, max: 100, label: 'Coefficient de répartition entre pans' });
      showFieldValidation(coefInput, coefError, result);
      if (!result.valid) return;
      fieldState.coefficient = result.value;
      recomputeFieldRatio(field);
    });
  }

  // Config. PV utilisateur : jamais persisté en base (ni pour Pro/Grand ni pour le résidentiel,
  // confirmé par lecture de code — aide de saisie en session uniquement). Saisie par lignes
  // structurées (bug rapporté : impossible de taper "+") — voir wireUserConfigRows.
  wireUserConfigRows(field, block, fieldState);
  wireOnduleurSplit(field, block, fieldState);

  const cablageBtn = block.querySelector(`[data-cablage-dc-btn="${field.subPvId}"]`);
  if (cablageBtn) {
    cablageBtn.addEventListener('click', () => {
      window.__chainesPertesGlobal.activeView = 'cablage';
      window.__chainesPertesGlobal.activeCablageField = field;
      renderChainesPertesModal();
    });
  }
}

// NOUVEAU (demande explicite : "une seule carte fusionnée" pour une toiture à plusieurs pans — les
// pans sont identiques, redondant de répéter la même carte N fois) : remplace N appels à
// chainFieldCardHTML/wireChainFieldCard quand nbPans > 1. Décisions actées avec l'utilisateur :
// - "Config. PV utilisateur" : UNE saisie partagée, propagée à tous les pans (cf. wireUserConfigRows
//   syncTargets ci-dessus) — tout le reste (computeFieldChainSizing, cablage_dc.js) continue de lire
//   un fieldState par pan pleinement rempli, donc aucun changement en aval.
// - Coefficient de répartition (%) et Ratio AC/DC : restent PAR PAN (nécessaire pour le cas
//   asymétrique, où la répartition n'est pas 50/50) — affichés côte à côte dans la même carte.
// Le chemin Monopente (1 seul pan, chainFieldCardHTML/wireChainFieldCard) reste strictement inchangé.
function chainMergedFieldsCardHTML(pans, nbPans) {
  const primary = pans[0];
  const chainInfo = window.computeFieldChainSizing(primary);
  const primaryState = getChainsFieldState(primary);

  // Amorce : la config partagée fait foi depuis le pan primaire, propagée aux autres AVANT le rendu
  // (au cas où ils divergeraient d'un état antérieur à cette fonctionnalité).
  pans.slice(1).forEach((p) => {
    const s = getChainsFieldState(p);
    s.userConfig = primaryState.userConfig;
    s.userConfigRows = primaryState.userConfigRows.map((row) => ({ ...row }));
    s.chainsPerOnduleur = primaryState.chainsPerOnduleur.slice();
  });

  let chainMetricsHTML;
  if (!chainInfo.ok) {
    chainMetricsHTML = `<div style="padding: 10px; color: #6c757d; font-style: italic; font-size: 0.85rem;">${chainInfo.reason}</div>`;
  } else if (chainInfo.isMicroOnduleur) {
    chainMetricsHTML = chainExtrasHTML(chainInfo, primary.subPvId);
  } else {
    const { sizing } = chainInfo;
    const warning = chainInfo.hasFullOnduleurData === false
      ? '<div style="margin-top: 8px; padding: 8px 10px; background: #fff3cd; border: 1px solid #ffe69c; border-radius: 6px; color: #664d03; font-size: 0.8rem;">Onduleur hors catalogue BD : caractéristiques MPPT inconnues (résultats à 0).</div>'
      : '';

    const totalPanelsAll = pans.reduce((sum, p) => sum + (p.totalPanels || 0), 0);
    const [minPv, maxPv] = String(sizing.nbPvParChaine).split('/').map((s) => parseInt(s.trim(), 10));
    let autoConfigCard = '';
    if (totalPanelsAll > 0 && !isNaN(minPv) && !isNaN(maxPv)) {
      const cap = capaciteChainesHorsReseau(primary, chainInfo);
      const optimal = window.StringSizingUtils.calculateOptimalStrings(totalPanelsAll, minPv, maxPv, cap ? cap.max : undefined);
      autoConfigCard = window.chainesPertesMetricCard(`Config. automatique (${totalPanelsAll} panneaux, ${nbPans} pans)`, optimal.displayText);
    }

    chainMetricsHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px;">
        ${window.chainesPertesMetricCard('Nb. max chaînes / MPPT', sizing.nbChaineMaxParMppt)}
        ${window.chainesPertesMetricCard('Nb. PV / chaîne (min / max)', sizing.nbPvParChaine)}
        ${window.chainesPertesMetricCard('Nb. PV rendement optimal à STC', sizing.nbPvRendOptimal)}
        ${window.chainesPertesMetricCard('Tension optimale (V)', Number(sizing.optimalVoltage || 0).toFixed(1))}
        ${autoConfigCard}
      </div>
      ${warning}
      ${chainExtrasHTML(chainInfo, primary.subPvId)}
    `;
  }

  const perPanBlocksHTML = pans.map((p) => {
    const s = getChainsFieldState(p);
    return `
      <div style="padding: 10px 12px; background: #fff; border: 1px solid #e9ecef; border-radius: 6px;">
        <div style="font-size: 0.75rem; font-weight: 600; color: #495057; margin-bottom: 6px;">${p.subPvId} (${p.totalPanels} panneaux)</div>
        <label style="font-size: 0.75rem; color: #495057; display: block; margin-bottom: 4px;">Coefficient puissance onduleur (%)</label>
        <input type="number" min="0" max="100" step="0.1" class="form-control form-control-sm" data-chain-input="coefficient" data-chain-pan="${p.subPvId}" value="${s.coefficient}" />
        <div data-chain-error="coefficient-${p.subPvId}" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
        <div id="chains-ratio-${p.subPvId}" style="margin-top:6px;">${fieldRatioAcDcHTML(p)}</div>
        <div id="chains-ratio-dcac-${p.subPvId}" style="margin-top:6px;">${fieldRatioDcAcHTML(p)}</div>
        <div id="chains-config-validation-${p.subPvId}" style="margin-top:4px;">${userConfigValidationHTML(p, s)}</div>
      </div>
    `;
  }).join('');

  return `
    <div id="chains-field-block-merged-${primary.pvId}" data-panel-reference="${primary.panelReference || ''}" style="border: 1px solid #dee2e6; border-radius: 8px; padding: 16px 16px 16px 28px; margin-bottom: 16px; background: #fff;">
      <span style="display:inline-block; font-size: 0.7rem; font-weight: 600; color: #0f766e; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 4px; padding: 2px 6px; margin-bottom: 6px;">${roofTypeLabel(primary, nbPans)}</span>
      <div style="font-weight: bold; color: #212529; margin: 4px 0 10px 0;">Toiture ${primary.pvId} — ${nbPans} pans (${pans.map((p) => p.subPvId).join(', ')})</div>
      ${panelLineHTML(primary.panelReference, `merged-${primary.pvId}`)}

      ${chainMetricsHTML}

      <div style="margin-top: 14px; display: flex; flex-wrap: wrap; gap: 10px;">
        <div style="padding: 10px 12px; background: #fff; border: 1px solid #e9ecef; border-radius: 6px; flex: 2 1 260px; max-width: 460px;">
          <label style="font-size: 0.75rem; color: #495057; display: block; margin-bottom: 4px;">Config. PV utilisateur (partagée entre les ${nbPans} pans) — ex: 2 Ch x 20 PV + 1 Ch x 19 PV</label>
          <div data-user-config-container="${primary.subPvId}" style="display:block; position:static; float:none; width:100%; text-align:left;"></div>
        </div>
        ${onduleurSplitFieldHTML(primary, primaryState)}
      </div>

      <div style="margin-top: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
        ${perPanBlocksHTML}
      </div>

      <button type="button" class="btn btn-sm" data-cablage-dc-merged-btn="${primary.pvId}" style="margin-top: 12px; background:#0f766e; color:#fff; border-color:#0f766e;">
        <i class="fas fa-network-wired"></i> Câblage DC (bâtiment entier)
      </button>
    </div>
  `;
}

function wireMergedFieldsCard(pans) {
  const primary = pans[0];
  const block = document.getElementById(`chains-field-block-merged-${primary.pvId}`);
  if (!block) return;

  block.querySelectorAll('[data-chain-input="coefficient"]').forEach((coefInput) => {
    const subPvId = coefInput.getAttribute('data-chain-pan');
    const p = pans.find((pp) => pp.subPvId === subPvId);
    if (!p) return;
    const fieldState = getChainsFieldState(p);
    const coefError = block.querySelector(`[data-chain-error="coefficient-${subPvId}"]`);
    coefInput.addEventListener('input', () => {
      const result = validateNumericField(coefInput.value, { min: 0, max: 100, label: 'Coefficient de répartition entre pans' });
      showFieldValidation(coefInput, coefError, result);
      if (!result.valid) return;
      fieldState.coefficient = result.value;
      recomputeFieldRatio(p);
    });
  });

  wireUserConfigRows(primary, block, getChainsFieldState(primary), pans.slice(1));
  wireOnduleurSplit(primary, block, getChainsFieldState(primary), pans.slice(1));

  const cablageBtn = block.querySelector(`[data-cablage-dc-merged-btn="${primary.pvId}"]`);
  if (cablageBtn) {
    cablageBtn.addEventListener('click', () => {
      window.__chainesPertesGlobal.activeView = 'cablage';
      window.__chainesPertesGlobal.activeCablagePans = pans;
      window.__chainesPertesGlobal.activeCablageField = null;
      renderChainesPertesModal();
    });
  }
}

function renderChainsPerFieldSection() {
  const container = document.getElementById('chainesPertesChainsSection');
  if (!container) return;
  const fields = window.__chainesPertesGlobal.fields || [];
  const pvIds = getUniquePvIds(fields);

  if (fields.length === 0) {
    container.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 10px; color: #212529;">Dimensionnement des chaînes par champ PV</div>
      <div style="padding: 14px; color: #6c757d; font-style: italic;">Aucun champ PV trouvé dans le résumé du projet.</div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 10px; color: #212529;">Dimensionnement des chaînes par champ PV</div>
    ${pvIds.map((pvId) => {
      const pans = getPansForPvId(pvId);
      // NOUVEAU (demande explicite : "une seule carte fusionnée" pour une toiture à plusieurs pans,
      // au lieu d'une carte par pan) : chainMergedFieldsCardHTML remplace N appels à
      // chainFieldCardHTML quand nbPans > 1 ; le chemin Monopente (1 seul pan) est strictement
      // inchangé (chainFieldCardHTML, comme avant).
      const fieldsHTML = pans.length > 1
        ? chainMergedFieldsCardHTML(pans, pans.length)
        : chainFieldCardHTML(pans[0], pans.length);
      return pvTabCardHTML(pvId, pans.length) + fieldsHTML;
    }).join('')}
  `;

  pvIds.forEach((pvId) => wirePvTabCard(pvId));
  pvIds.forEach((pvId) => {
    const pans = getPansForPvId(pvId);
    if (pans.length > 1) wireMergedFieldsCard(pans);
    else wireChainFieldCard(pans[0]);
  });
}

function renderChainesPertesModal() {
  const modal = document.getElementById('chainesPertesModal');
  if (!modal) return;

  const defaultView = document.getElementById('chainesPertesDefaultView');
  const cablageView = document.getElementById('chainesPertesCablageSection');
  const showCablage = window.__chainesPertesGlobal.activeView === 'cablage';
  if (defaultView) defaultView.style.display = showCablage ? 'none' : '';
  if (cablageView) cablageView.style.display = showCablage ? '' : 'none';

  if (showCablage) {
    // Vue Câblage DC : ne recalcule/re-rend rien des 3 sections par défaut (évite un travail
    // inutile et, surtout, de perdre le focus d'un champ en cours de saisie côté câblage à cause
    // d'un re-render non lié). renderCablageDcSection()/renderCablageDcSectionCombined() vivent
    // dans cablage_dc.js. NOUVEAU (toiture multi-pans) : activeCablagePans (tableau, carte
    // fusionnée) est prioritaire sur activeCablageField (single, Monopente) — les deux sont
    // mutuellement exclusifs (cf. wireMergedFieldsCard/wireChainFieldCard, jamais les deux définis
    // à la fois).
    const pans = window.__chainesPertesGlobal.activeCablagePans;
    if (pans && typeof window.renderCablageDcSectionCombined === 'function') {
      window.renderCablageDcSectionCombined(pans);
    } else if (typeof window.renderCablageDcSection === 'function') {
      window.renderCablageDcSection(window.__chainesPertesGlobal.activeCablageField);
    }
    return;
  }

  renderEquipementRows();
  propagateOnduleurToAllFields();
  renderGlobalResults();
  renderChainsPerFieldSection();
  if (typeof window.renderPerteSystemeSection === 'function') {
    window.renderPerteSystemeSection();
  }
}

/**
 * @param {Array<{subPvId, pvId, totalPanels, panelReference, nbOnduleurs, peakPowerKwc, puissanceOnduleurKva}>} fields
 *   Liste des pans PV du projet, fournie par SummaryModal.js (recalculée à chaque ouverture du
 *   Summary Modal, donc toujours à jour au moment où l'utilisateur clique sur le bouton unique).
 *   Plusieurs entrées peuvent partager le même `pvId` (pans d'un même onglet Bipente/Multipente).
 */
// NOUVEAU (demande explicite : "conserver et afficher les choix d'onduleurs et batteries faits
// depuis la page Calepinage") : window.__chainesPertesGlobal.onduleur/.batterie ne sont sinon
// remplis QUE par l'event pvEquipementSelected (une nouvelle sélection faite pendant que ce modal
// est ouvert) — une sélection faite plus tôt depuis la page Calepinage (avant l'ouverture de cette
// modale) reste donc invisible ici tant qu'aucun re-choix n'est fait. On tente ici de la
// reconstituer au mieux depuis les champs hôtes déjà remplis par bd_onduleurs.js/bd_batteries.js :
// - Onduleur : #ond_fab/#ond_ref (section "Liste de matériel", synchronisée par
//   syncOnduleurToListeDeMateriel() à CHAQUE sélection, y compris quand le dispatch de l'event est
//   bloqué) + #puissance_onduleur-*/#rendementOnduleur-*/#consoOnduleur-* pour la puissance
//   apparente/rendement/conso, + window.onduleurCatalogFromApi pour les champs MPPT détaillés.
// - Batterie : #referenceBatterie-* (rempli en "fab ref") comparé à window.batteryDB (source des
//   favoris, structurée fabricant -> références) pour retrouver fab/ref séparément.
function hydrateEquipmentFromHostFields() {
  const g = window.__chainesPertesGlobal;

  if (!g.onduleur) {
    const fabSelect = document.getElementById('ond_fab');
    const refSelect = document.getElementById('ond_ref');
    const fab = fabSelect && fabSelect.value;
    const ref = refSelect && refSelect.value;
    if (fab && ref) {
      const dbMatch = (window.onduleurCatalogFromApi || []).find((o) => o.reference === ref);
      const powerField = document.querySelector('[id^="puissance_onduleur"]');
      const rendementField = document.querySelector('[id^="rendementOnduleur"]');
      const consoField = document.querySelector('[id^="consoOnduleur"]');
      g.onduleur = {
        data: {
          fab, ref,
          ond_tension_max_dc: dbMatch ? dbMatch.tension_max_dc : 0,
          ond_tension_min_dc: dbMatch ? dbMatch.tension_min_dc : 0,
          ond_plage_mppt_min: dbMatch ? dbMatch.plage_mppt_min : 0,
          ond_plage_mppt_max: dbMatch ? dbMatch.plage_mppt_max : 0,
          ond_imax_mppt: dbMatch ? dbMatch.courant_max_mppt : 0,
          // CORRECTIF (bug rapporté : nombre de chaînes/MPPT erroné, cf. string_sizing_utils.js).
          ond_courant_cc_max_mppt: dbMatch ? dbMatch.courant_cc_max_mppt : 0,
          ond_courant_max_sortie_ac: dbMatch ? dbMatch.courant_max_sortie_ac : 0,
          ond_tension_nominale_ac: dbMatch ? dbMatch.tension_nominale_ac : null,
          ond_type_tension: dbMatch ? dbMatch.type_tension : null,
          ond_p_apparente_max_kva: parseFloat(powerField && powerField.value) || 0,
          ond_puissance_max_dc_kw: dbMatch ? dbMatch.puissance_max_dc_kw : null,
          ond_rendement: parseFloat(rendementField && rendementField.value) || 0,
          ond_conso: parseFloat(consoField && consoField.value) || 0,
          // NOUVEAU (demande explicite, cf. bd_onduleurs.js::selectFavoriteOnduleur pour le chemin
          // principal — ce repli reconstitue les mêmes champs depuis window.onduleurCatalogFromApi).
          ond_technologie: dbMatch ? dbMatch.technologie : null,
          ond_compat_optimiseur: dbMatch ? !!dbMatch.compat_optimiseur : false,
          ond_hybride: dbMatch ? !!dbMatch.hybride : false,
          ond_nb_max_unites_mono_20a: dbMatch ? dbMatch.nb_max_unites_mono_20a : null,
          ond_nb_max_unites_tri_20a: dbMatch ? dbMatch.nb_max_unites_tri_20a : null,
          ond_nb_max_unites_cable_mono: dbMatch ? dbMatch.nb_max_unites_cable_mono : null,
          ond_nb_max_unites_cable_poly: dbMatch ? dbMatch.nb_max_unites_cable_poly : null,
          hasFullData: !!dbMatch,
        },
      };
    }
  }

  if (!g.batterie) {
    const refField = document.querySelector('[id^="referenceBatterie"]');
    const capField = document.querySelector('[id^="capaciteBatterie"]');
    const hostVal = refField && refField.value && refField.value.trim();
    if (hostVal && window.batteryDB) {
      let found = null;
      Object.keys(window.batteryDB).forEach((fab) => {
        (window.batteryDB[fab] || []).forEach((entry) => {
          if (!found && `${fab} ${entry.ref}`.trim() === hostVal) found = { fab, ref: entry.ref };
        });
      });
      if (found) {
        const dbMatch = (window.batteryCatalogFromApi || []).find((b) => b.reference === found.ref);
        g.batterie = {
          data: {
            fab: found.fab, ref: found.ref,
            capacite: parseFloat(capField && capField.value) || 0,
            dbMatch: dbMatch || null,
          },
        };
      }
    }
  }
}

// Extrait d'openChainesPertesModal (même logique) pour servir aussi au contrôle avant calcul
// (verifierAvantCalcul), qui peut s'exécuter sans que ce modal ait jamais été ouvert.
function reinitialiserSiProjetChange() {
  const currentProjectId = localStorage.getItem('current_projet_id');
  if (window.__chainesPertesGlobal.lastProjectId !== currentProjectId) {
    window.__chainesPertesGlobal.onduleur = null;
    window.__chainesPertesGlobal.batterie = null;
    window.__chainesPertesGlobal.coefSurdimensionnement = undefined;
    window.__chainesOnduleurByField = {};
    window.__chainesPvTabState = {};
    window.__chainesFieldState = {};
    window.__chainesPertesGlobal.lastProjectId = currentProjectId;
  }
}

/**
 * NOUVEAU (demande explicite : bloquer le calcul quand le ratio DC/AC dépasse le coefficient de
 * surdimensionnement, ou quand la puissance DC dépasse la P. max DC de l'onduleur) : contrôle appelé
 * par les boutons « Calculer et Visualiser » (PRO/Grand projet : ButtonControl.js ; résidentiel :
 * calepinage_maison_formulaires.js) avant tout lancement.
 *
 * @param {Array} [fields] champs PV du projet (même format qu'openChainesPertesModal) ; à défaut, la
 *   dernière liste publiée par SummaryModal.js, puis celle du calepinage résidentiel.
 * @returns {{ok: boolean, erreurs: string[], message: string}}
 */
function verifierAvantCalcul(fields) {
  reinitialiserSiProjetChange();
  let liste = Array.isArray(fields) ? fields : null;
  if (!liste && Array.isArray(window.__chainesPertesChampsProjet)) liste = window.__chainesPertesChampsProjet;
  if (!liste && window.CalepinageMaisonIndiv && typeof window.CalepinageMaisonIndiv.getPvFieldsForChainesPertes === 'function') {
    liste = window.CalepinageMaisonIndiv.getPvFieldsForChainesPertes();
  }
  if (!liste || !liste.length) return { ok: true, erreurs: [], message: '' };

  // Les fonctions de résolution d'onduleur lisent __chainesPertesGlobal.fields (pans d'un onglet).
  const g = window.__chainesPertesGlobal;
  const fieldsPrecedents = g.fields;
  g.fields = liste;
  try {
    hydrateEquipmentFromHostFields();
    const controle = controlerDimensionnementOnduleurs(liste);
    const message = controle.ok ? '' : `Calcul impossible. ${controle.erreurs.join(' ')} Modifiez le « Coef. de surdimensionnement » (Paramètres de conception du modal Configuration des chaînes et perte système), le choix ou le nombre d'onduleurs pour relancer les calculs.`;
    return { ok: controle.ok, erreurs: controle.erreurs, message };
  } catch (e) {
    console.warn('[Chaînes et pertes] Contrôle du ratio DC/AC impossible :', e);
    return { ok: true, erreurs: [], message: '' };
  } finally {
    // Liste du modal restaurée : son prochain rendu partiel ne doit pas afficher d'autres champs.
    g.fields = fieldsPrecedents;
  }
}

window.ChainesPertesControle = { verifierAvantCalcul, getCoefSurdimensionnement };

window.openChainesPertesModal = function (fields) {
  createChainesPertesModal();
  const modal = document.getElementById('chainesPertesModal');

  // CORRECTIF (vérification demandée : isolation par projet) : window.__chainesPertesGlobal.onduleur
  // / .batterie / __chainesOnduleurByField / __chainesPvTabState / __chainesFieldState sont des
  // caches en mémoire clés par pvId/subPvId (ex. "PV1") SANS l'identifiant du projet — si l'app
  // ouvre ce modal pour un AUTRE projet sans rechargement complet de page, les choix
  // d'équipement du projet précédent restaient affichés (même pvId réutilisé d'un projet à
  // l'autre). Réinitialisés uniquement quand le projet actif a changé depuis la dernière
  // ouverture, pour ne pas perdre les choix de l'utilisateur en cours de session sur un même projet.
  reinitialiserSiProjetChange();

  window.__chainesPertesGlobal.fields = Array.isArray(fields) ? fields : [];
  // Coef. de surdimensionnement : l'input est créé une seule fois, sa valeur suit le projet actif.
  const coefEl = document.getElementById('chainesPertesCoefSurdim');
  if (coefEl) {
    coefEl.value = getCoefSurdimensionnement();
    showFieldValidation(coefEl, document.getElementById('chainesPertesCoefSurdimError'), { valid: true });
  }
  // Toujours rouvrir sur la vue par défaut (jamais coincé sur la vue Câblage DC d'une session
  // d'ouverture précédente, potentiellement pour un autre pan).
  window.__chainesPertesGlobal.activeView = 'default';
  window.__chainesPertesGlobal.activeCablageField = null;
  window.__chainesPertesGlobal.activeCablagePans = null;
  hydrateEquipmentFromHostFields();
  renderChainesPertesModal();
  modal.style.display = 'flex';
};

window.closeChainesPertesModal = function (arg) {
  const modal = (arg && arg.nodeType) ? (arg.closest('#chainesPertesModal') || document.getElementById('chainesPertesModal')) : document.getElementById('chainesPertesModal');
  if (modal) modal.style.display = 'none';
};

// Écoute globale (une seule fois) des sélections onduleur/batterie faites depuis les modales
// favoris réutilisées (Phase 2). Le panneau n'est volontairement PAS écouté ici : il n'est plus
// sélectionnable depuis cette modale (cf. en-tête de fichier).
if (!window.__chainesPertesListenerAttached) {
  window.__chainesPertesListenerAttached = true;
  document.addEventListener('pvEquipementSelected', (e) => {
    const detail = e.detail || {};
    const { type, data, pvId } = detail;
    if (type === 'onduleur') {
      // NOUVEAU (demande explicite : "Choix des onduleurs" — Par champ PV) : en mode 'perField',
      // range la sélection sous son propre pvId plutôt que dans le slot partagé.
      if (window.__chainesOnduleurMode === 'perField' && pvId) {
        window.__chainesOnduleurByField[pvId] = { data };
      } else {
        window.__chainesPertesGlobal.onduleur = { data };
      }
    } else if (type === 'batterie') {
      window.__chainesPertesGlobal.batterie = { data };
    } else return;

    const modal = document.getElementById('chainesPertesModal');
    if (modal && modal.style.display !== 'none') {
      renderChainesPertesModal();
    }
  });
}
