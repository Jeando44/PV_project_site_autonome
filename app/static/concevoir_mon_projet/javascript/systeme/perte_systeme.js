/**
 * Section "Perte système détaillée à STC" — intégrée dans la modale globale "Configuration des
 * chaînes et perte système" (chaines_pertes_modal.js), sous la section "Dimensionnement des
 * chaînes par champ PV", via le hook window.renderPerteSystemeSection() appelé par
 * renderChainesPertesModal(). Section volontairement séparée de celle des chaînes pour ne pas
 * perdre l'utilisateur (demande explicite).
 *
 * Deux niveaux de pertes :
 * - GLOBALES (une seule fois pour tout le système, valeurs par défaut) : Perte Ohmique DC, LID,
 *   Encrassement, Mismatch, Indisponibilité, Gain performance module, Perte ombrage proche, + dU2
 *   (perte AC sur la liaison principale après mise en parallèle des circuits, jusqu'au point
 *   d'injection — ne s'applique physiquement que si le système compte plusieurs onduleurs).
 * - PAR CHAMP PV (une carte par champ, cf. window.__chainesPertesGlobal.fields), car les pertes
 *   peuvent différer selon l'implantation de chaque champ (demande explicite) :
 *     - dU1 (perte AC entre l'onduleur et le jeu de barres, propre à ce champ) — déjà par champ ;
 *     - une case à cocher "Personnaliser les pertes STC pour ce champ" qui, une fois cochée,
 *       remplace pour CE champ les 7 valeurs globales par des valeurs propres au champ (initialisées
 *       à partir des valeurs globales courantes, donc aucune rupture visuelle à l'activation) — la
 *       solution la plus simple qui n'impose PAS de dupliquer 7 champs par PV en permanence : par
 *       défaut, tous les champs héritent silencieusement des valeurs globales, et seuls ceux dont
 *       l'implantation diffère (ombrage, câblage...) ont besoin d'ouvrir cette personnalisation ;
 *     - la perte système combinée qui en résulte, écrite dans #perteSysteme-<subPvId> (déjà lu par
 *       SummaryModal.js).
 *
 * Toutes les pertes sont des facteurs multiplicatifs (1 - x/100), le gain de performance un facteur
 * (1 + x/100) : combiné_champ% = 100 × (1 − (1−ohmiqueDC/100)(1−(dU1+dU2)/100)(1−lid/100)
 *   (1−encrassement/100)(1−mismatch/100)(1−indispo/100)(1+gain/100)(1−ombrage/100)), où ohmiqueDC/
 *   lid/encrassement/mismatch/indispo/gain/ombrage valent soit la valeur globale, soit la valeur
 *   personnalisée du champ si celui-ci l'a activée.
 *
 * dU total MAX (%) = dU1 max (le pire des dU1 parmi tous les champs/onduleurs) + dU2 : métrique de
 * vérification globale (limite ]0, 3]%) qui informe l'utilisateur que la chute de tension AC du
 * système est validée — ce n'est PAS ce qui alimente la perte système de chaque champ
 * individuellement (qui reste son propre dU1 + dU2, cf. fieldCombinedLoss).
 */

// ---------------------------------------------------------------------------------------------
// Sous-calculateurs de pertes ohmiques DC/AC — résistivités à 25°C (et non 70°C comme
// app/models/liste_de_materiels.py::calculate_voltage_drop, usage différent). Valeurs standard
// cuivre/aluminium recuit, à confirmer contre votre référentiel exact (NF C15-100/UTE C15-712).
// ---------------------------------------------------------------------------------------------
const RESISTIVITE_25C = { cuivre: 0.0178, aluminium: 0.0286 }; // Ω·mm²/m

const DC_SECTIONS_MM2 = [4, 6, 10, 16, 25, 35, 50];
const AC_SECTIONS_MM2 = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];

// Tensions de référence par pays (secours quand l'onduleur choisi n'a pas de tension_nominale_ac
// connue en BD, qui prime toujours quand disponible).
const COUNTRY_VOLTAGE_TABLE = {
  France: { monophase: 230, triphase: 400 },
  Haïti: { monophase: 110, biphase: 220, triphase: [220, 480] },
};

const GLOBAL_KEY = '__global__';

window.__perteOhmiqueSubState = window.__perteOhmiqueSubState || {};

function getOhmicSubState(key) {
  if (!window.__perteOhmiqueSubState[key]) {
    window.__perteOhmiqueSubState[key] = {
      dc: { open: false, longueur: 0, section: 6, materiau: 'cuivre' },
      ac: { open: false, longueur: 0, section: 6, materiau: 'cuivre', nbCablesParPhase: 1, pays: 'France', tensionHaitiTri: 220 },
    };
  }
  return window.__perteOhmiqueSubState[key];
}

// Circuit à 2 conducteurs actifs (formule monophasée) : monophasé, biphasé et sortie continue des
// régulateurs hors réseau (onduleurs_hors_reseau.js). Les types du catalogue réseau ('Monophasé' /
// 'Triphasé') donnent le même résultat qu'avant.
function estCircuitDeuxConducteurs(typeTension) {
  const t = String(typeTension || 'Triphasé').toLowerCase();
  return t.includes('mono') || t.includes('biphas') || t.includes('continu');
}

function resolveAcVoltage(ac, onduleurData) {
  if (onduleurData && onduleurData.ond_tension_nominale_ac) {
    const parsed = parseFloat(String(onduleurData.ond_tension_nominale_ac).replace(',', '.'));
    if (!isNaN(parsed) && parsed > 0) return { volts: parsed, isTriphase: !estCircuitDeuxConducteurs(onduleurData.ond_type_tension), source: "tension nominale AC de l'onduleur (BD)" };
  }
  const table = COUNTRY_VOLTAGE_TABLE[ac.pays];
  const typeTension = (onduleurData && onduleurData.ond_type_tension) || 'Triphasé';
  const isTriphase = !estCircuitDeuxConducteurs(typeTension);
  if (!isTriphase) return { volts: table.monophase, isTriphase: false, source: `tension monophasée (${ac.pays})` };
  if (Array.isArray(table.triphase)) return { volts: parseFloat(ac.tensionHaitiTri) || table.triphase[0], isTriphase: true, source: `tension triphasée (${ac.pays})` };
  return { volts: table.triphase, isTriphase: true, source: `tension triphasée (${ac.pays})` };
}

// NOUVEAU (demande explicite : "le calcul de chute de tension DC doit se faire sur la Config. PV
// utilisateur saisie, ou sur la config automatique si Config. PV utilisateur = 0") — extrait le
// nombre de panneaux du PREMIER groupe de chaînes de "Config. PV utilisateur" (ex: "2 Ch x 20 PV +
// 1 Ch x 19 PV" -> 20), pour en dériver une tension de chaîne réelle, plutôt que le nombre total de
// panneaux déjà calculé par StringSizingUtils.parseUserStringConfig (utile pour la validation du
// compte total, pas pour la tension d'une chaîne).
function firstStringPanelCount(userConfigText) {
  const cleaned = String(userConfigText || '').toLowerCase().replace(/ch/g, '').replace(/pv/g, '').replace(/ /g, '');
  if (!cleaned) return 0;
  const firstPart = cleaned.split('+')[0];
  if (!firstPart.includes('x')) return 0;
  const [, panels] = firstPart.split('x').map(Number);
  return isNaN(panels) ? 0 : panels;
}

// Tension d'une chaîne de nbPvPerString panneaux à la température de fonctionnement (STC/Temp.
// fonc.) — même formule que la portion "vmpp_T_func" de StringSizingUtils.calculateStringSizing,
// mais appliquée au nombre de panneaux SAISI par l'utilisateur plutôt qu'au nombre optimal calculé.
function computeUserConfigVoltage(nbPvPerString, panelData, tempSettings) {
  if (!nbPvPerString || !panelData) return 0;
  const pv_k_p_dec = (parseFloat(panelData.coef_pmax_pct_c) || 0) / 100;
  const vmpp_T_func = (parseFloat(panelData.v_mpp) || 0) * (1 + pv_k_p_dec * ((tempSettings.tempFunc || 25) - 25));
  return nbPvPerString * vmpp_T_func;
}

function calcDcOhmicLossPct(dc, panelData, sizing) {
  if (!panelData || !sizing) return { pct: null, reason: "Aucun champ PV disponible (panneau/onduleur requis) pour calculer cette perte à partir d'un câble." };
  const rho = RESISTIVITE_25C[dc.materiau];
  const L = parseFloat(dc.longueur) || 0;
  const S = parseFloat(dc.section) || 0;
  // NOUVEAU (demande explicite) : un panneau bifacial produit un courant Impp supplémentaire côté
  // face arrière — la chute de tension DC (donc le dimensionnement de section de câble) doit être
  // calculée sur un courant majoré de 11%, pas sur l'Impp brut de la fiche technique, sous peine de
  // sous-dimensionner le câble. Coefficient modifiable UNIQUEMENT ici. Détection sur
  // panelData.type_module (catalogue BD matériels, cf. app/routes/admin_materiels.py — valeurs du
  // type "Bifacial"/"Monofacial") en sous-chaîne insensible à la casse, pour couvrir aussi un
  // libellé proche (ex. "Bifacial Bi-verre"). Aucun effet sur un panneau Monofacial (facteur = 1).
  const BIFACIAL_CURRENT_FACTOR = 1.11;
  const isBifacial = String(panelData.type_module || '').toLowerCase().includes('bifacial');
  const I = (parseFloat(panelData.i_mpp) || 0) * (isBifacial ? BIFACIAL_CURRENT_FACTOR : 1);
  const U = Number(sizing.optimalVoltage) || 0;
  if (!L || !S || !I || !U) return { pct: null, reason: 'Renseignez une longueur de câble > 0 (et vérifiez que le dimensionnement de chaîne a bien produit une tension optimale).' };
  const deltaU = (2 * rho * L * I) / S;
  return { pct: (deltaU / U) * 100, reason: null };
}

function calcAcLossPct(ac, onduleurData, currentA) {
  if (!onduleurData || !currentA) return { pct: null, reason: "Sélectionnez l'onduleur du système pour calculer cette perte à partir d'un câble." };
  const rho = RESISTIVITE_25C[ac.materiau];
  const L = parseFloat(ac.longueur) || 0;
  const S = parseFloat(ac.section) || 0;
  const n = parseInt(ac.nbCablesParPhase, 10) || 1;
  const voltageInfo = resolveAcVoltage(ac, onduleurData);
  if (!L || !S || !voltageInfo.volts) return { pct: null, reason: 'Renseignez une longueur de câble > 0.' };
  const facteur = voltageInfo.isTriphase ? Math.sqrt(3) : 2;
  const deltaU = (facteur * rho * L * currentA) / (S * n);
  return { pct: (deltaU / voltageInfo.volts) * 100, reason: null, voltageSource: voltageInfo.source };
}

// ---------------------------------------------------------------------------------------------
// Pertes GLOBALES (valeurs par défaut du système, personnalisables par champ — cf. en-tête)
// ---------------------------------------------------------------------------------------------
// Bornes métier (demande explicite de l'utilisateur — font foi ; synchronisées avec la validation
// backend, cf. app/schemas/calepinage_dimensionnement_schemas.py, qui ne revalide que le %
// "perte système" COMBINÉ final — ces sous-facteurs restent purement frontend, jamais persistés
// individuellement, cf. writePerteSystemeField() plus bas qui n'écrit que le combiné).
const GLOBAL_LOSS_FIELDS = [
  { key: 'ohmiqueDC', label: 'Perte ohmique DC (%)', default: 1, min: 0, max: 3 },
  { key: 'lid', label: 'LID (%)', default: 1, min: 0.5, max: 2 },
  { key: 'encrassement', label: 'Encrassement (%)', default: 3, min: 1, max: 10 },
  { key: 'mismatch', label: 'Mismatch (%)', default: 1, min: 0.5, max: 5 },
  { key: 'indisponibilite', label: 'Indisponibilité (%)', default: 1, min: 0.5, max: 5 },
  { key: 'gainPerformance', label: 'Gain performance module (%)', default: 0.5, min: 0.3, max: 1, isGain: true },
  { key: 'ombrageProche', label: 'Perte ombrage proche estimée (%)', default: 0, min: 0, max: 7 },
];
const DU2_FIELD = { key: 'dU2', label: 'Perte AC liaison principale — dU2 (%)', default: 0, min: 0, max: 3 };
const DU1_FIELD = { key: 'dU1', label: 'Perte AC onduleur → jeu de barres — dU1 (%)', default: 1, min: 0, max: 3 };

window.__perteGlobalState = window.__perteGlobalState || (() => {
  const state = { dU2: DU2_FIELD.default, dU1: DU1_FIELD.default };
  GLOBAL_LOSS_FIELDS.forEach((f) => { state[f.key] = f.default; });
  return state;
})();

// NOUVEAU (demande explicite : "Définir des pertes différentes par champ PV") : par défaut
// (false), dU1 est partagée par tous les champs PV (window.__perteGlobalState.dU1, une seule
// carte affichée pour le premier champ) — cochée, chaque champ retrouve sa propre valeur
// indépendante (window.__perteFieldState[subPvId].dU1, une carte par champ, comportement déjà en
// place avant ce correctif).
window.__perteDifferentiateByField = window.__perteDifferentiateByField || false;

window.__perteFieldState = window.__perteFieldState || {};
function getFieldLossState(subPvId) {
  if (!window.__perteFieldState[subPvId]) {
    window.__perteFieldState[subPvId] = { dU1: DU1_FIELD.default, customLosses: false, losses: {} };
  }
  return window.__perteFieldState[subPvId];
}

// dU1 effective pour un champ : sa propre valeur si "Définir des pertes différentes par champ PV"
// est cochée, sinon la valeur partagée par tout le système.
function getEffectiveDU1(field) {
  return window.__perteDifferentiateByField ? getFieldLossState(field.subPvId).dU1 : window.__perteGlobalState.dU1;
}

// Valeur effective d'une perte STC pour un champ : sa propre valeur personnalisée si activée,
// sinon la valeur globale du système (héritage silencieux par défaut).
function getEffectiveLossValue(fieldState, f) {
  if (fieldState.customLosses && fieldState.losses[f.key] !== undefined && fieldState.losses[f.key] !== null) {
    return fieldState.losses[f.key];
  }
  return window.__perteGlobalState[f.key];
}

function isOutOfRange(f, value) {
  return value < f.min || value > f.max;
}

// NOUVEAU (demande explicite : "valider les données dans le front et backend, éviter la collecte
// de données corrompues en base") : réutilise window.ChainesPertesValidation.validateNumericField()
// (chaines_pertes_modal.js, chargé avant ce fichier) plutôt que de dupliquer le parse/la
// comparaison de plage. Ne modifie jamais l'input, mais empêche désormais une saisie hors-plage ou
// non numérique de se propager dans le calcul combiné : `previousValue` (dernière valeur connue
// valide) est retournée à la place, si bien que la perte système combinée continue de se calculer
// sur des données correctes tant que l'utilisateur n'a pas corrigé sa saisie.
function validateLossInput(input, rule, previousValue) {
  const result = window.ChainesPertesValidation.validateNumericField(input.value, rule);
  const key = input.dataset.perteKey;
  const card = document.getElementById(`perte-card-${key}`);
  const warning = document.getElementById(`perte-warning-${key}`);
  if (card) card.style.borderColor = result.valid ? '#e9ecef' : '#dc3545';
  if (warning) {
    warning.style.color = result.valid ? '#b45309' : '#dc3545';
    warning.textContent = result.valid ? '' : result.message;
  }
  return result.valid ? result.value : previousValue;
}

function fieldCardHTML(f, value, hasSubCalc, subCalcKind, keyOverride) {
  const key = keyOverride || f.key;
  const outOfRange = isOutOfRange(f, value);
  const toggleBtn = hasSubCalc
    ? `<button type="button" class="btn btn-sm" data-ohmic-toggle="${key}" data-ohmic-kind="${subCalcKind}" style="padding: 0 5px; font-size: 0.8rem; margin-left: auto; line-height: 1.6;" title="Calculer depuis un câble (longueur, section, matériau)">🔧</button>`
    : '';
  const subPanel = hasSubCalc ? `<div id="perte-subcalc-${key}" style="margin-top: 8px;"></div>` : '';
  return `
    <div id="perte-card-${key}" style="padding: 10px 12px; background: #fff; border: 1px solid ${outOfRange ? '#ffe69c' : '#e9ecef'}; border-radius: 6px;">
      <label style="font-size: 0.75rem; color: #495057; display: flex; align-items: center; margin-bottom: 4px;">${f.label}${toggleBtn}</label>
      <input type="number" step="0.1" class="form-control form-control-sm" data-perte-key="${key}" value="${value}" style="width: 100%;" />
      <div id="perte-warning-${key}" style="font-size: 0.7rem; color: #b45309; margin-top: 2px;">${outOfRange ? `Hors plage de référence [${f.min} - ${f.max}]` : ''}</div>
      ${subPanel}
    </div>
  `;
}

// NOUVEAU (demande explicite) : avertissement affiché À DROITE dès l'ouverture du choix de
// section de câble AC/DC (bouton 🔧), et qui reste visible tant que ce panneau est ouvert (pas un
// toast temporaire — un bloc HTML statique, comme le reste de ce sous-panneau).
const CABLE_SECTION_WARNING_HTML = `
  <div style="display: flex; align-items: flex-start; gap: 10px; width: 100%; margin-top: 10px; padding: 10px 12px; background: #fff3cd; border: 1px solid #ffe69c; border-radius: 6px; font-size: 0.74rem; color: #664d03;">
    <span style="font-size: 1.2rem; line-height: 1; flex-shrink: 0;">⚠️</span>
    <div><strong>Avertissement :</strong> La section des câbles AC et DC définie dans cette simulation est employée à la seule fin de vérifier le respect des tolérances de chute de tension dans le cadre du bilan énergétique. L'outil de simulation omet volontairement les paramètres de dimensionnement normatif tels que l'application des facteurs de correction selon le mode de pose et le calcul des contraintes thermiques en court-circuit. L'utilisateur demeure le seul responsable de l'étude électrique d'exécution, qui doit garantir que la section retenue satisfait aux exigences normatives et de sécurité applicables à la construction du projet.</div>
  </div>
`;

function materialButtonsHTML(subKey, kind, current) {
  return `
    <div style="display: flex; gap: 6px;">
      <button type="button" class="btn btn-sm" data-ohmic-material="${subKey}:${kind}:cuivre" style="flex: 1; ${current === 'cuivre' ? 'background:#5d5e5f; color:#fff;' : 'background:#e9ecef; color:#495057;'}">Cuivre</button>
      <button type="button" class="btn btn-sm" data-ohmic-material="${subKey}:${kind}:aluminium" style="flex: 1; ${current === 'aluminium' ? 'background:#5d5e5f; color:#fff;' : 'background:#e9ecef; color:#495057;'}">Aluminium</button>
    </div>
  `;
}

function dcSubCalcHTML(subKey) {
  const sub = getOhmicSubState(subKey).dc;
  const options = DC_SECTIONS_MM2.map((s) => `<option value="${s}"${Number(sub.section) === s ? ' selected' : ''}>${s} mm²</option>`).join('');
  return `
    <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box;">
      <div style="padding: 10px; background: #f8f9fa; border: 1px dashed #ced4da; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 100px;">
            <label style="font-size: 0.7rem; color: #6c757d; display: block;">Longueur (m)</label>
            <input type="number" step="0.1" min="0" data-ohmic-input="${subKey}:dc:longueur" value="${sub.longueur}" class="form-control form-control-sm" />
          </div>
          <div style="flex: 1; min-width: 100px;">
            <label style="font-size: 0.7rem; color: #6c757d; display: block;">Section</label>
            <select data-ohmic-input="${subKey}:dc:section" class="form-select form-select-sm">${options}</select>
          </div>
        </div>
        ${materialButtonsHTML(subKey, 'dc', sub.materiau)}
        <div id="perte-subcalc-dc-result-${subKey}" style="font-size: 0.78rem; color: #495057;"></div>
      </div>
      ${CABLE_SECTION_WARNING_HTML}
    </div>
  `;
}

function acSubCalcHTML(subKey) {
  const sub = getOhmicSubState(subKey).ac;
  const options = AC_SECTIONS_MM2.map((s) => `<option value="${s}"${Number(sub.section) === s ? ' selected' : ''}>${s} mm²</option>`).join('');
  const isHaitiTri = sub.pays === 'Haïti';
  return `
    <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box;">
      <div style="padding: 10px; background: #f8f9fa; border: 1px dashed #ced4da; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box;">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 100px;">
            <label style="font-size: 0.7rem; color: #6c757d; display: block;">Longueur (m)</label>
            <input type="number" step="0.1" min="0" data-ohmic-input="${subKey}:ac:longueur" value="${sub.longueur}" class="form-control form-control-sm" />
          </div>
          <div style="flex: 1; min-width: 100px;">
            <label style="font-size: 0.7rem; color: #6c757d; display: block;">Section</label>
            <select data-ohmic-input="${subKey}:ac:section" class="form-select form-select-sm">${options}</select>
          </div>
          <div style="flex: 1; min-width: 100px;">
            <label style="font-size: 0.7rem; color: #6c757d; display: block;">Câbles / phase</label>
            <input type="number" step="1" min="1" data-ohmic-input="${subKey}:ac:nbCablesParPhase" value="${sub.nbCablesParPhase}" class="form-control form-control-sm" />
          </div>
        </div>
        ${materialButtonsHTML(subKey, 'ac', sub.materiau)}
        <div style="display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 120px;">
            <label style="font-size: 0.7rem; color: #6c757d; display: block;">Pays (tension de secours)</label>
            <select data-ohmic-input="${subKey}:ac:pays" class="form-select form-select-sm">
              <option value="France"${sub.pays === 'France' ? ' selected' : ''}>France</option>
              <option value="Haïti"${sub.pays === 'Haïti' ? ' selected' : ''}>Haïti</option>
            </select>
          </div>
          ${isHaitiTri ? `
          <div style="flex: 1; min-width: 120px;">
            <label style="font-size: 0.7rem; color: #6c757d; display: block;">Tension triphasée Haïti</label>
            <select data-ohmic-input="${subKey}:ac:tensionHaitiTri" class="form-select form-select-sm">
              <option value="220"${Number(sub.tensionHaitiTri) === 220 ? ' selected' : ''}>220V</option>
              <option value="480"${Number(sub.tensionHaitiTri) === 480 ? ' selected' : ''}>480V</option>
            </select>
          </div>` : ''}
        </div>
        <div id="perte-subcalc-ac-result-${subKey}" style="font-size: 0.78rem; color: #495057;"></div>
      </div>
      ${CABLE_SECTION_WARNING_HTML}
    </div>
  `;
}

function applyOhmicResult(kind, subKey, fieldKey, result) {
  const resultEl = document.getElementById(`perte-subcalc-${kind}-result-${subKey}`);
  if (!result.pct && result.pct !== 0) {
    if (resultEl) resultEl.innerHTML = `<span style="color:#6c757d; font-style: italic;">${result.reason}</span>`;
    return;
  }
  if (resultEl) {
    const extra = result.voltageSource ? ` (tension de référence : ${result.voltageSource})` : '';
    resultEl.innerHTML = `Perte calculée : <strong>${result.pct.toFixed(2)} %</strong>${extra}`;
  }
  const input = document.querySelector(`[data-perte-key="${fieldKey}"]`);
  if (input) {
    input.value = result.pct.toFixed(2);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// kind='dc' : subKey vaut GLOBAL_KEY (calculé à partir du 1er champ PV du système) ou l'id d'un
// champ PV précis (surcharge par champ, cf. fieldLossOverrideHTML). kind='ac' : subKey vaut
// GLOBAL_KEY pour dU2 (courant agrégé de tous les onduleurs) ou l'id d'un champ pour son propre dU1.
function recomputeOhmicSubCalc(kind, subKey, fieldKey) {
  const sub = getOhmicSubState(subKey)[kind];
  let result;
  if (kind === 'dc') {
    const fields = (window.__chainesPertesGlobal && window.__chainesPertesGlobal.fields) || [];
    const targetField = subKey === GLOBAL_KEY ? fields[0] : fields.find((f) => f.subPvId === subKey);
    const chainInfo = targetField ? window.computeFieldChainSizing(targetField) : { ok: false };
    let sizing = chainInfo.ok ? chainInfo.sizing : null;
    // NOUVEAU (demande explicite) : priorité à "Config. PV utilisateur" (nombre de panneaux du
    // 1er groupe de chaînes saisi) pour la tension de la chute de tension DC — repli sur la
    // config automatique (déjà calculée ci-dessus) si l'utilisateur n'a rien saisi (0/vide).
    if (chainInfo.ok && targetField) {
      const fieldState = getChainsFieldState(targetField);
      // Config. refusée (hors réseau, capacité en courant des MPPT dépassée) : config. automatique.
      const nbPvUserString = userConfigDepasseCapacite(targetField, fieldState.userConfig) ? 0 : firstStringPanelCount(fieldState.userConfig);
      if (nbPvUserString > 0) {
        const userVoltage = computeUserConfigVoltage(nbPvUserString, chainInfo.panelData, readGlobalTempSettings());
        if (userVoltage > 0) sizing = { ...sizing, optimalVoltage: userVoltage };
      }
    }
    result = calcDcOhmicLossPct(sub, chainInfo.ok ? chainInfo.panelData : null, sizing);
  } else {
    const g = window.__chainesPertesGlobal;
    const onduleurData = g.onduleur && g.onduleur.data;
    let currentA = onduleurData ? parseFloat(onduleurData.ond_courant_max_sortie_ac) || 0 : 0;
    if (subKey === GLOBAL_KEY) {
      // dU2 (liaison principale) : courant agrégé après mise en parallèle de tous les circuits.
      // Nbre d'onduleurs est UN par onglet (pvId), pas par pan de toiture : on doit dédupliquer par
      // pvId (getUniquePvIds/getPvTabState, cf. chaines_pertes_modal.js) sous peine de compter 2x un
      // onglet Bipente/Multipente dont les pans partagent le même onduleur.
      const totalNbOnduleurs = getUniquePvIds(g.fields).reduce((sum, pvId) => sum + (getPvTabState(pvId).nbOnduleurs || 0), 0) || 1;
      currentA *= totalNbOnduleurs;
    }
    result = calcAcLossPct(sub, onduleurData, currentA);
  }
  applyOhmicResult(kind, subKey, fieldKey, result);
}

// NOUVEAU (fonctionnalité "Câblage DC", cablage_dc.js) : point d'entrée unique par lequel la
// longueur de câble maximale calculée dans la vue Câblage DC alimente le calcul de perte DC déjà
// existant (icône "Calculer depuis un câble" de la carte "Perte ohmique DC (%)"), SANS dupliquer sa
// formule (calcDcOhmicLossPct, ci-dessus). Écrit directement dans les objets d'état déjà consommés
// par getEffectiveLossValue()/fieldCombinedLoss() — pas seulement le DOM (qui peut ne pas être
// rendu au moment de l'appel, si l'utilisateur est dans la vue Câblage DC plutôt que la section
// Pertes système) : active l'override par champ (customLosses, une longueur de câble par pan étant
// par construction une donnée propre à ce pan), écrit la longueur dans le sous-état "câble"
// existant, recalcule la perte ohmique DC avec la même résolution de tension que
// recomputeOhmicSubCalc('dc', ...), puis propage immédiatement vers la perte système combinée
// (-> writePerteSystemeField -> CM.state.perteSysteme, déjà persisté/utilisé pour la production).
function applyCablageDcMaxLength(subPvId, maxLengthM) {
  const fields = (window.__chainesPertesGlobal && window.__chainesPertesGlobal.fields) || [];
  const field = fields.find((f) => f.subPvId === subPvId);
  if (!field) return { pct: null, reason: "Champ PV introuvable pour ce pan." };

  const fieldState = getFieldLossState(subPvId);
  fieldState.customLosses = true;

  const dc = getOhmicSubState(subPvId).dc;
  dc.longueur = maxLengthM;

  const chainInfo = window.computeFieldChainSizing(field);
  let sizing = chainInfo.ok ? chainInfo.sizing : null;
  if (chainInfo.ok) {
    const userConfig = getChainsFieldState(field).userConfig;
    const nbPvUserString = userConfigDepasseCapacite(field, userConfig) ? 0 : firstStringPanelCount(userConfig);
    if (nbPvUserString > 0) {
      const userVoltage = computeUserConfigVoltage(nbPvUserString, chainInfo.panelData, readGlobalTempSettings());
      if (userVoltage > 0) sizing = { ...sizing, optimalVoltage: userVoltage };
    }
  }
  const result = calcDcOhmicLossPct(dc, chainInfo.ok ? chainInfo.panelData : null, sizing);
  if (result.pct !== null) {
    fieldState.losses.ohmiqueDC = Number(result.pct.toFixed(2));
  }
  recomputeFieldCombined(field);
  // { pct, reason } : reason non-null si le calcul n'a pas pu aboutir (ex. panneau/onduleur non
  // résolus) — à afficher tel quel par l'appelant (vue Câblage DC) plutôt que de le silencier.
  return result;
}
window.applyCablageDcMaxLength = applyCablageDcMaxLength;

function wireOhmicInputs(subKey, kind, fieldKey) {
  const panel = document.getElementById(`perte-subcalc-${fieldKey}`);
  if (!panel) return;
  const sub = getOhmicSubState(subKey)[kind];

  panel.querySelectorAll('[data-ohmic-input]').forEach((el) => {
    const [, , field] = el.dataset.ohmicInput.split(':');
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      sub[field] = el.value;
      if (field === 'pays') {
        panel.innerHTML = kind === 'dc' ? dcSubCalcHTML(subKey) : acSubCalcHTML(subKey);
        wireOhmicInputs(subKey, kind, fieldKey);
      }
      recomputeOhmicSubCalc(kind, subKey, fieldKey);
    });
  });

  panel.querySelectorAll('[data-ohmic-material]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [, , materiau] = btn.dataset.ohmicMaterial.split(':');
      sub.materiau = materiau;
      panel.innerHTML = kind === 'dc' ? dcSubCalcHTML(subKey) : acSubCalcHTML(subKey);
      wireOhmicInputs(subKey, kind, fieldKey);
      recomputeOhmicSubCalc(kind, subKey, fieldKey);
    });
  });
}

// NOUVEAU (demande explicite : "le texte de l'avertissement est disposé à la verticale, illisible")
// : #perte-card-<fieldKey> est une cellule de grille étroite (minmax(200px, 1fr), cf.
// fieldCardHTML/renderGlobalLossFields) — le sous-panneau câble (#perte-subcalc-<fieldKey>) y est
// imbriqué et se retrouve donc compressé dans ces ~200px dès qu'il s'ouvre, forçant le paragraphe
// d'avertissement à ne plus tenir qu'un mot par ligne. On fait déborder la carte sur toute la
// largeur de la grille (grid-column: 1 / -1) tant que son sous-panneau est ouvert.
function setCardSpanForOpenState(fieldKey, open) {
  const card = document.getElementById(`perte-card-${fieldKey}`);
  if (card) card.style.gridColumn = open ? '1 / -1' : '';
}

function wireOhmicToggle(container, subKey, kind, fieldKey) {
  const btn = container.querySelector(`[data-ohmic-toggle="${fieldKey}"]`);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const subState = getOhmicSubState(subKey)[kind];
    subState.open = !subState.open;
    setCardSpanForOpenState(fieldKey, subState.open);
    const panel = document.getElementById(`perte-subcalc-${fieldKey}`);
    if (!panel) return;
    if (subState.open) {
      panel.innerHTML = kind === 'dc' ? dcSubCalcHTML(subKey) : acSubCalcHTML(subKey);
      wireOhmicInputs(subKey, kind, fieldKey);
      recomputeOhmicSubCalc(kind, subKey, fieldKey);
    } else {
      panel.innerHTML = '';
    }
  });
  // Ré-ouvre si laissé ouvert avant un précédent re-rendu de la section.
  const subState = getOhmicSubState(subKey)[kind];
  if (subState.open) {
    setCardSpanForOpenState(fieldKey, true);
    const panel = document.getElementById(`perte-subcalc-${fieldKey}`);
    if (panel) {
      panel.innerHTML = kind === 'dc' ? dcSubCalcHTML(subKey) : acSubCalcHTML(subKey);
      wireOhmicInputs(subKey, kind, fieldKey);
      recomputeOhmicSubCalc(kind, subKey, fieldKey);
    }
  }
}

// NOUVEAU (demande explicite : "envoyer les résultats du dimensionnement des chaînes dans le
// backend, sauvegarde robuste") : même repli que writeHostField() (chaines_pertes_modal.js) — un
// pvId résidentiel n'a pas de champ hôte `#perteSysteme-<subPvId>` ; à défaut, écrit directement
// dans CM.state.perteSysteme de la maison (pvId reçu explicitement par l'appelant, cf.
// recomputeFieldCombined() ci-dessous — jamais reconstruit depuis subPvId, qui n'a pas ce rôle ici).
// Comportement Pro/Grand strictement inchangé : ce repli ne s'active jamais quand le champ DOM existe.
function writePerteSystemeField(subPvId, combinedPct, pvId) {
  const el = document.getElementById('perteSysteme-' + subPvId);
  if (el) {
    el.value = combinedPct.toFixed(2);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (pvId && window.CalepinageMaisonIndiv && typeof window.CalepinageMaisonIndiv.setMaisonFieldResult === 'function') {
    window.CalepinageMaisonIndiv.setMaisonFieldResult(pvId, 'perteSysteme', Number(combinedPct.toFixed(2)));
  }
}

// ---------------------------------------------------------------------------------------------
// Rendu : section globale (défauts + dU2 + dU total max) + une carte de pertes par champ PV
// ---------------------------------------------------------------------------------------------
function renderGlobalLossFields() {
  return GLOBAL_LOSS_FIELDS.map((f) => fieldCardHTML(f, window.__perteGlobalState[f.key], f.key === 'ohmiqueDC', 'dc')).join('');
}

function computeDuTotalMax() {
  const fields = window.__chainesPertesGlobal.fields || [];
  const dU2 = parseFloat(window.__perteGlobalState.dU2) || 0;
  if (fields.length === 0) return { dUTotalMax: dU2, dU1Max: 0 };
  const dU1Max = Math.max(...fields.map((f) => parseFloat(getEffectiveDU1(f)) || 0));
  return { dUTotalMax: dU1Max + dU2, dU1Max };
}

function duTotalMaxCardHTML() {
  const { dUTotalMax } = computeDuTotalMax();
  const invalid = dUTotalMax <= 0 || dUTotalMax > 3;
  return `
    <div id="perte-dutotalmax-card" style="padding: 10px 12px; background: #fff; border: 1px solid ${invalid ? '#f5c2c7' : '#e9ecef'}; border-radius: 6px;">
      <label style="font-size: 0.75rem; color: #495057; display: block; margin-bottom: 4px;">dU total max = dU1 max + dU2 (%)</label>
      <div id="perte-dutotalmax-value" style="font-weight: 700; font-size: 1.1rem; color: ${invalid ? '#b02a37' : '#212529'};">${dUTotalMax.toFixed(2)} %</div>
      <div id="perte-dutotalmax-status" style="font-size: 0.7rem; color: ${invalid ? '#b02a37' : '#6c757d'}; margin-top: 2px;">${invalid ? 'Doit être > 0 et ≤ 3 %' : 'OK (limite ]0, 3])'}</div>
    </div>
  `;
}

function recomputeDuTotalMax() {
  const card = document.getElementById('perte-dutotalmax-card');
  if (!card) return;
  const { dUTotalMax } = computeDuTotalMax();
  const invalid = dUTotalMax <= 0 || dUTotalMax > 3;
  card.style.borderColor = invalid ? '#f5c2c7' : '#e9ecef';
  const valueEl = document.getElementById('perte-dutotalmax-value');
  const statusEl = document.getElementById('perte-dutotalmax-status');
  if (valueEl) {
    valueEl.textContent = `${dUTotalMax.toFixed(2)} %`;
    valueEl.style.color = invalid ? '#b02a37' : '#212529';
  }
  if (statusEl) {
    statusEl.textContent = invalid ? 'Doit être > 0 et ≤ 3 %' : 'OK (limite ]0, 3])';
    statusEl.style.color = invalid ? '#b02a37' : '#6c757d';
  }
}

function fieldLossFactor(field) {
  const fieldState = getFieldLossState(field.subPvId);
  let factor = 1;
  GLOBAL_LOSS_FIELDS.forEach((f) => {
    const val = parseFloat(getEffectiveLossValue(fieldState, f));
    const v = isNaN(val) ? 0 : val;
    factor *= f.isGain ? (1 + v / 100) : (1 - v / 100);
  });
  return factor;
}

function fieldCombinedLoss(field) {
  // Perte AC de CE champ = son propre dU1 (câble onduleur -> jeu de barres, ou la valeur partagée
  // par tout le système si "Définir des pertes différentes par champ PV" n'est pas cochée) + le
  // dU2 global (liaison principale, courant agrégé de tous les onduleurs) — physiquement, chaque
  // champ ne subit que sa propre liaison dU1, pas le dU1 des autres champs.
  const dU1 = parseFloat(getEffectiveDU1(field)) || 0;
  const dU2 = parseFloat(window.__perteGlobalState.dU2) || 0;
  const dUTotal = dU1 + dU2;
  const factor = fieldLossFactor(field) * (1 - dUTotal / 100);
  return { combined: 100 * (1 - factor), dUTotal };
}

function fieldLossOverrideHTML(field) {
  const fieldState = getFieldLossState(field.subPvId);
  const checked = fieldState.customLosses ? 'checked' : '';
  const overrideFieldsHTML = GLOBAL_LOSS_FIELDS.map((f) => {
    const val = getEffectiveLossValue(fieldState, f);
    const keyOverride = `${f.key}-${field.subPvId}`;
    return fieldCardHTML(f, val, f.key === 'ohmiqueDC', 'dc', keyOverride);
  }).join('');

  return `
    <div style="margin-top: 14px; width: 100%; box-sizing: border-box;">
      <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer; width: 100%; box-sizing: border-box; text-align: left;">
        <input type="checkbox" data-custom-losses-toggle="${field.subPvId}" ${checked} />
        Personnaliser les pertes STC pour ce champ (sinon valeurs globales appliquées)
      </label>
      <div id="perte-field-overrides-${field.subPvId}" style="display: ${fieldState.customLosses ? 'grid' : 'none'}; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px; width: 100%; box-sizing: border-box;">
        ${overrideFieldsHTML}
      </div>
    </div>
  `;
}

function fieldCardHTMLBlock(field) {
  const { combined } = fieldCombinedLoss(field);

  return `
    <div id="perte-field-block-${field.subPvId}" style="border: 1px solid #dee2e6; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: #fff;">
      <div style="font-weight: bold; color: #212529; margin-bottom: 4px;">Champ PV : ${field.subPvId}</div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;">
        ${fieldCardHTML(DU1_FIELD, getEffectiveDU1(field), true, 'ac', `dU1-${field.subPvId}`)}

        <div style="padding: 10px 12px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px;">
          <div style="font-size: 0.72rem; color: #6c757d;">Perte système combinée (${field.subPvId})</div>
          <div id="perte-combined-${field.subPvId}" style="font-weight: 700; font-size: 1.2rem;">${combined.toFixed(2)} %</div>
        </div>
      </div>

      ${fieldLossOverrideHTML(field)}
    </div>
  `;
}

function recomputeFieldCombined(field) {
  const { combined } = fieldCombinedLoss(field);
  const combinedEl = document.getElementById(`perte-combined-${field.subPvId}`);
  if (combinedEl) combinedEl.textContent = `${combined.toFixed(2)} %`;
  writePerteSystemeField(field.subPvId, combined, field.pvId);
  recomputeDuTotalMax();
}

function recomputeAllFields() {
  (window.__chainesPertesGlobal.fields || []).forEach((field) => recomputeFieldCombined(field));
  recomputeDuTotalMax();
}

function wireGlobalFieldInputs(container) {
  // IMPORTANT : container est #chainesPertesLossesSection, qui contient AUSSI les cartes dU1/
  // surcharges par champ PV (mêmes attributs data-perte-key) — ne traiter ici que les clés
  // réellement globales, sinon GLOBAL_LOSS_FIELDS.find() renvoie undefined pour "dU1-<subPvId>" ou
  // "ohmiqueDC-<subPvId>" et isOutOfRange() plante (en plus de faire doublon avec les listeners
  // dédiés posés par wireFieldCard()/wireFieldLossOverrides()).
  const globalKeys = new Set([...GLOBAL_LOSS_FIELDS.map((f) => f.key), 'dU2']);
  container.querySelectorAll('[data-perte-key]').forEach((input) => {
    if (!globalKeys.has(input.dataset.perteKey)) return;
    input.addEventListener('input', () => {
      const key = input.dataset.perteKey;
      if (key === 'dU2') {
        window.__perteGlobalState.dU2 = validateLossInput(input, DU2_FIELD, window.__perteGlobalState.dU2);
      } else {
        const f = GLOBAL_LOSS_FIELDS.find((x) => x.key === key);
        window.__perteGlobalState[key] = validateLossInput(input, f, window.__perteGlobalState[key]);
      }
      recomputeAllFields();
    });
  });

  wireOhmicToggle(container, GLOBAL_KEY, 'dc', 'ohmiqueDC');
  wireOhmicToggle(container, GLOBAL_KEY, 'ac', 'dU2');
}

function wireFieldCard(field) {
  const block = document.getElementById(`perte-field-block-${field.subPvId}`);
  if (!block) return;
  const fieldKey = `dU1-${field.subPvId}`;

  const dU1Input = block.querySelector(`[data-perte-key="${fieldKey}"]`);
  if (dU1Input) {
    dU1Input.addEventListener('input', () => {
      // "Définir des pertes différentes par champ PV" décochée : la seule carte affichée (celle
      // du 1er champ) pilote la valeur PARTAGÉE par tous les champs — cochée : chaque champ garde
      // sa propre valeur indépendante (comportement déjà en place avant ce correctif).
      const previous = window.__perteDifferentiateByField ? getFieldLossState(field.subPvId).dU1 : window.__perteGlobalState.dU1;
      const val = validateLossInput(dU1Input, DU1_FIELD, previous);
      if (window.__perteDifferentiateByField) {
        getFieldLossState(field.subPvId).dU1 = val;
      } else {
        window.__perteGlobalState.dU1 = val;
      }
      // Partagée : la valeur affecte TOUS les champs (dont les cartes masquées), pas seulement
      // celui dont la carte est visible — recomputeAllFields() recalcule chaque champ.
      recomputeAllFields();
    });
  }
  wireOhmicToggle(block, field.subPvId, 'ac', fieldKey);

  wireFieldLossOverrides(field, block);
}

function wireFieldLossOverrides(field, block) {
  const fieldState = getFieldLossState(field.subPvId);

  const toggle = block.querySelector(`[data-custom-losses-toggle="${field.subPvId}"]`);
  if (toggle) {
    toggle.addEventListener('change', () => {
      fieldState.customLosses = toggle.checked;
      const overridesEl = document.getElementById(`perte-field-overrides-${field.subPvId}`);
      if (fieldState.customLosses) {
        // Initialise à partir des valeurs globales COURANTES (seulement si pas déjà personnalisé
        // auparavant) pour qu'activer la case ne provoque aucune rupture visuelle des résultats.
        GLOBAL_LOSS_FIELDS.forEach((f) => {
          if (fieldState.losses[f.key] === undefined || fieldState.losses[f.key] === null) {
            fieldState.losses[f.key] = window.__perteGlobalState[f.key];
          }
        });
        GLOBAL_LOSS_FIELDS.forEach((f) => {
          const input = document.querySelector(`[data-perte-key="${f.key}-${field.subPvId}"]`);
          if (input) input.value = fieldState.losses[f.key];
        });
        if (overridesEl) overridesEl.style.display = 'grid';
      } else if (overridesEl) {
        overridesEl.style.display = 'none';
      }
      recomputeFieldCombined(field);
    });
  }

  GLOBAL_LOSS_FIELDS.forEach((f) => {
    const keyOverride = `${f.key}-${field.subPvId}`;
    const input = block.querySelector(`[data-perte-key="${keyOverride}"]`);
    if (input) {
      input.addEventListener('input', () => {
        fieldState.losses[f.key] = validateLossInput(input, f, fieldState.losses[f.key]);
        recomputeFieldCombined(field);
      });
    }
  });

  wireOhmicToggle(block, field.subPvId, 'dc', `ohmiqueDC-${field.subPvId}`);
}

window.renderPerteSystemeSection = function () {
  const container = document.getElementById('chainesPertesLossesSection');
  if (!container) return;
  const fields = window.__chainesPertesGlobal.fields || [];

  // NOUVEAU (demande explicite : "masquer par défaut la carte dU2 si un seul onduleur, prévoir un
  // bouton pour l'afficher/la masquer") : visible par défaut uniquement si plusieurs onduleurs
  // (dU2 n'a de sens physique que dans ce cas, cf. note ci-dessous) — mais une fois l'utilisateur
  // basculé manuellement, on respecte son choix plutôt que de re-décider à chaque re-rendu.
  const totalNbOnduleurs = getUniquePvIds(window.__chainesPertesGlobal.fields || [])
    .reduce((sum, pvId) => sum + (getPvTabState(pvId).nbOnduleurs || 0), 0);
  if (window.__perteDu2SectionVisible === undefined) {
    window.__perteDu2SectionVisible = totalNbOnduleurs > 1;
  }

  container.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 10px; color: #212529;">Perte système détaillée à STC (globale)</div>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 20px;">
      ${renderGlobalLossFields()}
    </div>

    <label style="display: flex; align-items: center; gap: 6px; font-size: 0.85rem; cursor: pointer; margin-bottom: 10px; width: 100%; box-sizing: border-box; text-align: left;">
      <input type="checkbox" id="perte-differentiate-toggle" ${window.__perteDifferentiateByField ? 'checked' : ''} />
      Définir des pertes différentes par champ PV
    </label>
    <div style="font-size: 0.78rem; color: #6c757d; margin-bottom: 10px;">
      Chaque champ hérite par défaut des valeurs globales ci-dessus ; cochez "Personnaliser" sur un
      champ dont l'implantation diffère (ombrage, câblage...) pour lui affecter des pertes propres.
    </div>
    ${fields.length === 0
      ? '<div style="padding: 14px; color: #6c757d; font-style: italic;">Aucun champ PV trouvé dans le résumé du projet.</div>'
      : (window.__perteDifferentiateByField ? fields : fields.slice(0, 1)).map((field) => fieldCardHTMLBlock(field)).join('')
    }

    <!-- NOUVEAU (demande explicite) : dU2 déplacée après dU1 (ci-dessus, une carte par champ PV),
         masquable/affichable via ce bouton — masquée par défaut pour un seul onduleur. -->
    <div style="display: flex; align-items: center; justify-content: flex-start; gap: 10px; margin-top: 6px; margin-bottom: 10px; width: 100%; box-sizing: border-box;">
      <button type="button" id="perte-du2-toggle-btn" class="btn btn-sm btn-outline-secondary" style="flex: 0 0 auto; width: auto; margin: 0;">${window.__perteDu2SectionVisible ? 'Masquer' : 'Afficher'}</button>
      <div style="font-weight: bold; color: #212529; flex: 0 0 auto;">Perte AC liaison principale (dU2)</div>
    </div>
    <div id="perte-du2-section" style="display: ${window.__perteDu2SectionVisible ? 'block' : 'none'};">
      <div style="font-size: 0.78rem; color: #6c757d; margin-bottom: 8px;">
        dU2 (liaison AC principale) ne s'applique physiquement que si le système compte plusieurs
        onduleurs (mise en parallèle des circuits) ; le courant utilisé pour son calcul par câble est
        la somme des courants de sortie de tous les onduleurs des champs PV ci-dessus.
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;">
        ${fieldCardHTML(DU2_FIELD, window.__perteGlobalState.dU2, true, 'ac')}
        ${duTotalMaxCardHTML()}
      </div>
    </div>
  `;

  wireGlobalFieldInputs(container);
  fields.forEach((field) => wireFieldCard(field));
  recomputeAllFields();

  const differentiateToggle = document.getElementById('perte-differentiate-toggle');
  if (differentiateToggle) {
    differentiateToggle.addEventListener('change', () => {
      if (differentiateToggle.checked && fields.length > 0) {
        // Bascule vers "une carte par champ" : initialise chaque champ à partir de la valeur
        // PARTAGÉE courante, pour ne provoquer aucune rupture visuelle des résultats déjà affichés.
        fields.forEach((field) => { getFieldLossState(field.subPvId).dU1 = window.__perteGlobalState.dU1; });
      } else if (!differentiateToggle.checked && fields.length > 0) {
        // Retour à "une seule carte partagée" : reprend la valeur du 1er champ (celui qui reste
        // affiché), pour la même raison.
        window.__perteGlobalState.dU1 = getFieldLossState(fields[0].subPvId).dU1;
      }
      window.__perteDifferentiateByField = differentiateToggle.checked;
      window.renderPerteSystemeSection();
    });
  }

  const du2ToggleBtn = document.getElementById('perte-du2-toggle-btn');
  if (du2ToggleBtn) {
    du2ToggleBtn.addEventListener('click', () => {
      window.__perteDu2SectionVisible = !window.__perteDu2SectionVisible;
      const sectionEl = document.getElementById('perte-du2-section');
      if (sectionEl) sectionEl.style.display = window.__perteDu2SectionVisible ? 'block' : 'none';
      du2ToggleBtn.textContent = window.__perteDu2SectionVisible ? 'Masquer' : 'Afficher';
    });
  }
};
