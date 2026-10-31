/**
 * Câblage DC (routage des chaînes) — calepinage résidentiel uniquement.
 *
 * Nouvelle vue à l'intérieur du modal "Configuration des chaînes et perte système"
 * (chaines_pertes_modal.js), ouverte via le bouton "Câblage DC" de chaque carte de pan
 * (chainFieldCardHTML). Permet de rattacher visuellement chaque panneau d'un pan à sa chaîne
 * électrique (mode automatique ou manuel), de marquer les polarités (S1+/S1-…), de saisir les
 * longueurs de câble par chaîne dans un tableau dynamique, et d'alimenter le calcul de perte
 * ohmique DC déjà existant (perte_systeme.js) avec la longueur de câble maximale.
 *
 * Portée : résidentiel uniquement (décision explicite de l'utilisateur — le calepinage Pro/Grand-
 * projet affiche ses panneaux comme calques Google Maps indépendants, sans canvas ni overlay de
 * câblage existant ; hors périmètre). Un clic sur "Câblage DC" pour un champ PV Pro/Grand affiche un
 * message clair plutôt que d'échouer silencieusement (cf. renderCablageDcSection ci-dessous).
 *
 * Conformité brevets/PI (cf. plan validé) : le mode automatique est un simple balayage en
 * boustrophédon (zigzag raster scan) — technique de parcours de graphe/grille générique et
 * antérieure de plusieurs décennies au photovoltaïque (imprimantes matricielles, traceurs, usinage
 * CNC, tonte robotisée) — aucune optimisation, aucune fonction de coût, aucune simulation
 * d'ombrage/irradiance ne pilote le regroupement. Le mode manuel ne contient aucun algorithme :
 * l'utilisateur clique, l'outil enregistre l'ordre. Aucune nouvelle dépendance externe : JS natif +
 * API Canvas 2D du navigateur.
 *
 * Convention de fichier : script classique (pas de module ES), fonctions top-level en portée
 * globale implicite — même convention que chaines_pertes_modal.js/perte_systeme.js (chargé après
 * les deux), pour pouvoir appeler directement getChainsFieldState/computeFieldChainSizing/
 * parseUserPvConfig/window.chainesPertesMetricCard/window.ChainesPertesValidation sans dupliquer.
 *
 * Persistance : lit/écrit CM.state.cablageDc[pan.id] (CM = window.CalepinageMaisonIndiv), un objet
 * simple (pas de Map/Set) inclus dans PERSISTED_STATE_FIELDS (calepinage_maison_orchestrateur.js) —
 * round-trip déjà garanti par la route /calepinage-maison/save existante, aucune nouvelle route.
 */

// État de la vue actuellement ouverte (une seule à la fois, comme le reste de ce modal).
window.__cablageDcView = window.__cablageDcView || null;
// NOUVEAU (vue combinée multi-pans, demande explicite : "afficher tous les pans en même temps") :
// { pans, resolvedList, byId: {subPvId: view}, activeSubPvId, canvas, ctx, fit } — distinct de
// window.__cablageDcView ci-dessus pour ne jamais perturber le chemin mono-pan existant. Un seul
// canevas PARTAGÉ (byId[x].canvas n'existe pas — c'est combined.canvas), mais chaque pan garde son
// propre `view` (model/panels/showChaines...), exactement comme s'il était ouvert seul.
window.__cablageDcViewsCombined = window.__cablageDcViewsCombined || null;

const CABLAGE_DC_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be185d', '#65a30d'];

// ---------------------------------------------------------------------------------------------
// Résolution des données (pan, panneaux, tailles de chaînes) à partir du `field` du modal Chaînes.
// ---------------------------------------------------------------------------------------------

// CORRECTIF (bug connu et déjà documenté ailleurs dans ce module, cf. getAllPvFieldSummaries()
// dans calepinage_maison_orchestrateur.js) : CM.packPanelsForPan()/les fonctions de géométrie
// associées lisent CM.state EN GLOBAL (espacements, obstacles, dimensions panneau…), jamais un
// paramètre — pour une maison AUTRE que celle actuellement ouverte à l'écran, il faut basculer
// temporairement CM.state vers l'état de LA maison concernée le temps du calcul, sous peine
// d'utiliser silencieusement les réglages de la mauvaise maison.
function withHouseState(state, fn) {
  const CM = window.CalepinageMaisonIndiv;
  const previous = CM.state;
  CM.state = state;
  try {
    return fn();
  } finally {
    CM.state = previous;
  }
}

// Résout { pan, state } pour un `field` du modal Chaînes, ou null si ce field ne correspond à
// aucune maison résidentielle connue (cas Pro/Grand-projet, hors périmètre de cette fonctionnalité).
// Panneaux du champ : ceux du pan, réduits à un côté pour un champ de dôme (resolved.domeCote).
function panelsOfResolvedField(resolved) {
  const CM = window.CalepinageMaisonIndiv;
  const panels = withHouseState(resolved.state, () => CM.packPanelsForPan(resolved.pan));
  if (resolved.domeCote == null) return panels;
  return panels.filter((p) => withHouseState(resolved.state, () => CM.coteDomePanneau(p.panelIndex, resolved.state)) === resolved.domeCote);
}

function resolveFieldToPan(field) {
  const CM = window.CalepinageMaisonIndiv;
  if (!CM || typeof CM.getPanForSubPvId !== 'function' || !field) return null;
  return CM.getPanForSubPvId(field.subPvId, field.pvId);
}

// S'assure que state.cablageDc[pan.id] existe avec sa forme par défaut, et le retourne (référence
// mutable — les appelants modifient cet objet directement puis appellent CM.persistCablageDcChange).
// `cle` : clé du câblage, pan.id par défaut — un côté de dôme (champ "<pan>_Dome1/2") a la sienne,
// cf. CM.getPanForSubPvId (cleCablage).
function getOrCreateCablageModel(state, pan, cle) {
  const id = cle || pan.id;
  if (!state.cablageDc) state.cablageDc = {};
  if (!state.cablageDc[id]) {
    // startPolarity : NOUVEAU (demande explicite : "sélectionner si câble de retour est positif en
    // fonction du point de départ S+ ou S-, par défaut S+") — bascule purement visuelle (cf.
    // drawCablageCanvas) : n'affecte ni panelKeys ni les longueurs calculées (identiques aux 2
    // extrémités, cf. computeChainPathLengthM), seulement quelle extrémité de chaîne porte la
    // flèche/le label "+" et laquelle porte le cercle/le label "-".
    state.cablageDc[id] = { mode: 'auto', strings: [], lengths: [], customColumns: [], startPolarity: 'plus', removedBaseCols: [], mppt: [], mpptConfig: {} };
  }
  const m = state.cablageDc[id];
  if (!m.startPolarity) m.startPolarity = 'plus';
  // NOUVEAU : sens des chaînes en mode automatique ('libre' | 'gauche' | 'droite'), cf.
  // orientStringsHorizontally.
  if (!m.chainDirection) m.chainDirection = 'libre';
  // NOUVEAU (demande explicite : "l'utilisateur peut supprimer si besoin les colonnes Desc. Vertical
  // / Chem.") : liste des colonnes de base masquées ('descente' / 'cheminement'). N° strings,
  // Long.(S+/-) et Total(S+/-) ne sont jamais masquables.
  if (!Array.isArray(m.removedBaseCols)) m.removedBaseCols = [];
  // NOUVEAU (demande explicite : "affecter les chaînes sur les MPPT de l'onduleur") : 1 entrée par
  // chaîne { pv, mppt, manual }. Recalculée automatiquement tant que manual !== true.
  if (!Array.isArray(m.mppt)) m.mppt = [];
  // NOUVEAU : override manuel du nombre de MPPT / d'entrées PV par MPPT quand l'onduleur n'est pas
  // reconnu en base (ou pour ajuster) — { nbMppt, perMppt }.
  if (!m.mpptConfig || typeof m.mpptConfig !== 'object') m.mpptConfig = {};
  // CORRECTIF (demande explicite : "supprimer ces 2 colonnes par défaut : Descente de câble, Colonne
  // 1") : colonnes perso héritées de tests antérieurs, dans l'état sauvegardé du projet. Nettoyage
  // unique (drapeau _legacyColsCleaned) — n'empêche pas de les recréer volontairement ensuite.
  if (!m._legacyColsCleaned) {
    const legacy = ['descente de câble', 'descente de cable', 'colonne 1'];
    m.customColumns = (m.customColumns || []).filter((c) => !legacy.includes(String(c && c.label || '').trim().toLowerCase()));
    m._legacyColsCleaned = true;
  }
  return m;
}

// Nombre de panneaux par chaîne, dans l'ordre : priorité à "Config. PV utilisateur" (même règle que
// perte_systeme.js::recomputeOhmicSubCalc — cohérence garantie avec le sous-calcul dU DC existant),
// repli sur la configuration automatique (StringSizingUtils.calculateOptimalStrings) sinon.
function getStringSizesForField(field) {
  const fieldState = getChainsFieldState(field);
  // Hors réseau : une config. utilisateur au-delà de la capacité en courant des MPPT est refusée
  // (chaines_pertes_modal.js::userConfigDepasseCapacite) — repli sur la config. automatique.
  if (fieldState.userConfig && !userConfigDepasseCapacite(field, fieldState.userConfig)) {
    const sizes = window.StringSizingUtils.expandStringConfigToList(fieldState.userConfig);
    const total = sizes.reduce((a, b) => a + b, 0);
    if (sizes.length && total === field.totalPanels) return sizes;
  }
  const chainInfo = window.computeFieldChainSizing(field);
  if (chainInfo.ok && field.totalPanels > 0) {
    const optimal = autoConfigForField(field, chainInfo);
    if (optimal) {
      // Capacité dépassée même avec les chaînes les plus longues : configuration sans limite, les
      // chaînes en trop apparaissent alors « Hors capacité » (avertissement du tableau des métrés).
      const text = optimal.capaciteDepassee ? autoConfigForField(field, chainInfo, false).displayText : optimal.displayText;
      return window.StringSizingUtils.expandStringConfigToList(text);
    }
  }
  return [];
}

// Config. automatique d'un champ : hors réseau, bornée par le nombre de chaînes admis par la limite
// en courant des MPPT (capaciteChainesHorsReseau) — sauf `avecLimite === false`. null si min/max
// PV par chaîne indéterminés.
function autoConfigForField(field, chainInfo, avecLimite = true) {
  const [minPv, maxPv] = String(chainInfo.sizing.nbPvParChaine).split('/').map((s) => parseInt(s.trim(), 10));
  if (isNaN(minPv) || isNaN(maxPv)) return null;
  const cap = avecLimite ? capaciteChainesHorsReseau(field, chainInfo) : null;
  return window.StringSizingUtils.calculateOptimalStrings(field.totalPanels, minPv, maxPv, cap ? cap.max : undefined);
}

// NOUVEAU (demande explicite : "afficher dans le modal les résultats de Config. PV utilisateur et
// Config. automatique, pour comparaison") : les 2 chaînes lisibles séparément (texte brut saisi et
// texte calculé automatiquement) — même résolution que getStringSizesForField() ci-dessus
// (réutilisée, pas dupliquée), qui ne retourne qu'une liste éclatée sans exposer ces 2 textes.
function getConfigStringsForField(field) {
  const fieldState = getChainsFieldState(field);
  const userConfigText = fieldState.userConfig || '';
  let autoConfigText = 'Non déterminé';
  const chainInfo = window.computeFieldChainSizing(field);
  if (chainInfo.ok && field.totalPanels > 0) {
    const optimal = autoConfigForField(field, chainInfo);
    if (optimal) autoConfigText = optimal.displayText;
  }
  return { userConfigText, autoConfigText };
}

// ---------------------------------------------------------------------------------------------
// Mode automatique — balayage en boustrophédon (cf. note de conformité brevets/PI en en-tête).
// ---------------------------------------------------------------------------------------------
function assignStringsAutomatically(panels, stringSizes) {
  const byRow = new Map();
  panels.forEach((p) => {
    // panelIndex = "jx-jy" (ou "jx-jy-domeSide" en mode dôme — les 2 côtés d'un même jx-jy sont
    // alors simplement départagés par l'ordre de tri, simplification acceptée pour ce cas moins
    // courant plutôt que de complexifier le regroupement par ligne).
    const parts = p.panelIndex.split('-').map(Number);
    const jx = parts[0], jy = parts[1];
    if (!byRow.has(jy)) byRow.set(jy, []);
    byRow.get(jy).push(Object.assign({ jx }, p));
  });
  const rows = Array.from(byRow.keys()).sort((a, b) => a - b);
  const ordered = [];
  rows.forEach((jy, i) => {
    const rowPanels = byRow.get(jy).sort((a, b) => a.jx - b.jx);
    if (i % 2 === 1) rowPanels.reverse(); // alterne le sens à chaque ligne (boustrophédon)
    ordered.push(...rowPanels);
  });
  const strings = [];
  let cursor = 0;
  stringSizes.forEach((size) => {
    const chunk = ordered.slice(cursor, cursor + size);
    if (chunk.length) strings.push({ panelKeys: chunk.map((p) => p.panelIndex) });
    cursor += size;
  });
  return strings;
}

// NOUVEAU (demande explicite : bouton "Direction des chaînes : Gauche ou Droite", mode automatique) :
// oriente TOUTES les chaînes dans le même sens horizontal — 'gauche' = la chaîne progresse vers la
// gauche, donc son départ (1er panneau de panelKeys, qui porte "+" par défaut, cf. startPolarity)
// est à droite et sa fin à gauche ; 'droite' = l'inverse. Simple inversion de panelKeys (le
// regroupement boustrophédon est inchangé, les longueurs aussi — symétriques). 'libre' (défaut) =
// comportement historique, sens alterné d'une ligne à l'autre.
function orientStringsHorizontally(strings, panels, direction) {
  if (direction !== 'gauche' && direction !== 'droite') return strings;
  const byKey = new Map(panels.map((p) => [p.panelIndex, p]));
  strings.forEach((s) => {
    const first = byKey.get(s.panelKeys[0]);
    const last = byKey.get(s.panelKeys[s.panelKeys.length - 1]);
    if (!first || !last) return;
    const dx = last.cx - first.cx; // > 0 : la chaîne progresse vers la droite
    if ((direction === 'gauche' && dx > 1e-3) || (direction === 'droite' && dx < -1e-3)) {
      s.panelKeys.reverse();
    }
  });
  return strings;
}

// ---------------------------------------------------------------------------------------------
// Mode manuel — aucun algorithme : l'utilisateur clique, l'outil enregistre l'ordre. Un clic sur un
// panneau déjà assigné tronque sa chaîne à partir de ce panneau (annulation simple et prévisible).
// ---------------------------------------------------------------------------------------------
function handleManualPanelClick(model, stringSizes, panelIndex) {
  if (!stringSizes.length) return;

  for (let si = 0; si < model.strings.length; si++) {
    const idx = model.strings[si].panelKeys.indexOf(panelIndex);
    if (idx !== -1) {
      model.strings[si].panelKeys = model.strings[si].panelKeys.slice(0, idx);
      const keep = model.strings[si].panelKeys.length ? si + 1 : si;
      model.strings = model.strings.slice(0, keep);
      return;
    }
  }

  let current = model.strings[model.strings.length - 1];
  const currentTarget = stringSizes[model.strings.length - 1];
  if (!current || current.panelKeys.length >= currentTarget) {
    const nextTarget = stringSizes[model.strings.length];
    if (nextTarget === undefined) return; // toutes les chaînes déjà complètes
    current = { panelKeys: [] };
    model.strings.push(current);
  }
  current.panelKeys.push(panelIndex);
}

// ---------------------------------------------------------------------------------------------
// Tableau des longueurs — validation, totaux, statistiques globales.
// ---------------------------------------------------------------------------------------------

// NOUVEAU (demande explicite : "il faut calculer automatiquement les longueurs Long.(S+) et
// Long.(S-), ce sont les cheminements des chaînes sur le plan de calepinage, en utilisant les
// dimensions des panneaux") : somme des distances centre-à-centre (mètres réels, cx/cy déjà en
// mètres — même repère que le dessin du fil dans drawCablageCanvas) entre panneaux consécutifs de la
// chaîne, dans l'ordre de panelKeys — la distance entre 2 panneaux adjacents intègre déjà nativement
// leurs dimensions réelles (largeur/longueur + espacements déjà utilisés par CM.packPanelsForPan
// pour les positionner), sans dupliquer ces paramètres séparément.
function computeChainPathLengthM(s, panels) {
  const pts = s.panelKeys.map((k) => panels.find((p) => p.panelIndex === k)).filter(Boolean);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].cx - pts[i - 1].cx, pts[i].cy - pts[i - 1].cy);
  }
  return total;
}

// NOUVEAU (suite) : Long.(S+)/Long.(S-) affichent par défaut la MÊME valeur calculée (le trajet
// physique du binôme +/- est identique — seule l'extrémité qui porte "+" change, cf.
// model.startPolarity/drawCablageCanvas) — recalculée ici (donc à chaque rendu) plutôt que dans
// renderCablageTableHTML, pour que computeRowTotals/computeGlobalStats/applyCablageDcMaxLength
// (perte_systeme.js) restent alimentés par la valeur à jour SANS aucun changement de leur côté.
// CORRECTIF (demande explicite : "donner la possibilité de personnaliser la longueur du câble de
// retour S+ ou S- en fonction du départ de la chaîne — on laisse par défaut S+ = S-, c'est le cas
// existant") : `manualPlus`/`manualMinus` mémorisent qu'une valeur a été saisie manuellement pour ce
// pôle sur cette chaîne — tant qu'ils restent `false` (cas par défaut, comportement INCHANGÉ), le
// recalcul automatique continue d'écraser plus/minus à chaque rendu comme avant.
function ensureLengthsRows(model, strings, panels) {
  while (model.lengths.length < model.strings.length) {
    model.lengths.push({ plus: null, minus: null, descente: null, cheminement: null, custom: {}, manualPlus: false, manualMinus: false });
  }
  model.lengths.length = model.strings.length;
  model.lengths.forEach((row, si) => {
    if (!row.custom) row.custom = {};
    if (strings && panels) {
      const pathLength = computeChainPathLengthM(strings[si], panels);
      if (!row.manualPlus) row.plus = pathLength;
      if (!row.manualMinus) row.minus = pathLength;
    }
  });
}

// Formule "trajet partagé" (confirmée) : Descente/Cheminement/colonnes perso s'ajoutent
// identiquement aux deux pôles (le binôme +/- chemine dans le même fourreau).
function computeRowTotals(row) {
  const shared = (Number(row.descente) || 0) + (Number(row.cheminement) || 0)
    + Object.values(row.custom || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
  return {
    totalPlus: (Number(row.plus) || 0) + shared,
    totalMinus: (Number(row.minus) || 0) + shared,
  };
}

function computeGlobalStats(model) {
  const totals = model.lengths.map(computeRowTotals);
  const plusVals = totals.map((t) => t.totalPlus).filter((v) => v > 0);
  const minusVals = totals.map((t) => t.totalMinus).filter((v) => v > 0);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  // NOUVEAU (demande explicite : "ajouter une ligne qui calcule les totaux : de chaînes, de câbles
  // S+, S- et ajouter une carte de longueur totale") : sommes (pas moyennes) sur TOUTES les chaînes,
  // y compris celles à 0 (contrairement à avgPlus/avgMinus ci-dessus qui filtrent les valeurs nulles
  // pour ne pas biaiser une moyenne) — un total doit refléter la longueur de câble réellement
  // nécessaire, chaînes non encore renseignées comprises (0 par défaut, n'affecte pas la somme).
  const totalPlusSum = sum(totals.map((t) => t.totalPlus));
  const totalMinusSum = sum(totals.map((t) => t.totalMinus));
  return {
    avgPlus: avg(plusVals),
    avgMinus: avg(minusVals),
    maxLength: Math.max(0, ...plusVals, ...minusVals),
    totalChains: model.strings.length,
    totalPlusSum,
    totalMinusSum,
    // Longueur totale de câble DC à prévoir : S+ et S- sont 2 conducteurs distincts (même s'ils
    // cheminent dans le même fourreau, cf. computeRowTotals) — la longueur de câble à ACHETER est
    // bien la somme des deux, pas leur moyenne ni l'un des deux seul.
    totalLength: totalPlusSum + totalMinusSum,
  };
}

// ---------------------------------------------------------------------------------------------
// Canvas dédié — redessine à partir des mêmes données géométriques réelles (CM.packPanelsForPan),
// PAS une capture d'écran figée (cf. note d'architecture du plan : interactivité + précision du
// clic > fidélité visuelle d'un raster). N'affecte jamais le canvas/rendu principal du calepinage.
// ---------------------------------------------------------------------------------------------
function computePanelsBoundingBox(panels) {
  const CM = window.CalepinageMaisonIndiv;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  panels.forEach((p) => {
    CM.panelCornersTrue(p).forEach((c) => {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    });
  });
  if (!isFinite(minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

function computeFit(bbox, canvasW, canvasH, paddingPx) {
  const w = Math.max(0.1, bbox.maxX - bbox.minX);
  const h = Math.max(0.1, bbox.maxY - bbox.minY);
  const scale = Math.max(0.001, Math.min((canvasW - 2 * paddingPx) / w, (canvasH - 2 * paddingPx) / h));
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  return {
    scale,
    toCanvas: (pt) => ({ x: canvasW / 2 + (pt.x - cx) * scale, y: canvasH / 2 - (pt.y - cy) * scale }),
    fromCanvas: (px) => ({ x: (px.x - canvasW / 2) / scale + cx, y: -(px.y - canvasH / 2) / scale + cy }),
  };
}

// Réimplémentation locale, volontairement indépendante de calepinage_maison_calculs.js::
// pointInRotatedRect() (non exposée sur CM) — même principe géométrique (~5 lignes), pour ne pas
// dépendre d'une fonction interne non exportée.
function pointInRotatedRectLocal(pt, rect) {
  const cos = Math.cos(-rect.angle), sin = Math.sin(-rect.angle);
  const dx = pt.x - rect.cx, dy = pt.y - rect.cy;
  const localX = dx * cos - dy * sin, localY = dx * sin + dy * cos;
  return Math.abs(localX) <= rect.w / 2 && Math.abs(localY) <= rect.l / 2;
}

// NOUVEAU (demande explicite : "positionner les n° des chaînes au milieu des panneaux, soit à 1/4
// de la hauteur") : point au CENTRE du panneau (déjà "au milieu" horizontalement), décalé d'1/4 de
// sa longueur (l, axe rampant) dans sa direction locale "haut", en tenant compte de sa rotation
// (angle) — même principe géométrique que CM.panelCornersTrue() (calepinage_maison_calculs.js, déjà
// utilisé plus haut dans ce fichier), réimplémenté ici en 2 lignes pour rester indépendant (même
// principe que pointInRotatedRectLocal ci-dessus). Renvoie un point en MÈTRES (repère réel, avant
// fit.toCanvas — cohérent avec le reste de ce fichier).
function panelLabelPoint(p) {
  return {
    x: p.cx - Math.sin(p.angle) * (p.l / 4),
    y: p.cy + Math.cos(p.angle) * (p.l / 4),
  };
}

// NOUVEAU (demande explicite : "une flèche à chaque début de chaîne, un point/cercle à la fin") :
// petit triangle plein orienté selon `angleRad` (direction du 1er segment de la chaîne), pointe à
// `tip` (coordonnées CANEVAS, pixels).
function drawArrowMarker(ctx, tip, angleRad, size, color) {
  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(angleRad);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.5, size * 0.6);
  ctx.lineTo(-size * 0.5, -size * 0.6);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// Petit cercle plein (fin de chaîne), même principe.
function drawDotMarker(ctx, point, radius, color) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function isPanelAssigned(model, panelIndex) {
  return model.strings.some((s) => s.panelKeys.includes(panelIndex));
}

function stringIndexForPanel(model, panelIndex) {
  return model.strings.findIndex((s) => s.panelKeys.includes(panelIndex));
}

// NOUVEAU (extraction, vue combinée multi-pans) : dessin des carrés de panneaux + fils de chaînes
// d'UN pan, isolé de drawCablageCanvas ci-dessous (bbox/fit + rose des vents restent propres à
// chaque appelant — un fit LOCAL pour drawCablageCanvas, un fit COMBINÉ partagé pour
// drawCablageCanvasCombined) pour être appelé une fois par pan sur un même canevas partagé.
// Comportement strictement identique à l'ancien corps de drawCablageCanvas — extraction pure, aucune
// logique modifiée (cf. plan : "aucune modification des fonctions existantes utilisées par le
// chemin Monopente").
function drawPanelsAndStrings(ctx, panels, model, fit, showChaines) {
  const CM = window.CalepinageMaisonIndiv;
  panels.forEach((p) => {
    const si = stringIndexForPanel(model, p.panelIndex);
    const corners = CM.panelCornersTrue(p).map(fit.toCanvas);
    ctx.beginPath();
    corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.fillStyle = si !== -1 ? `${CABLAGE_DC_COLORS[si % CABLAGE_DC_COLORS.length]}33` : '#f1f5f9';
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  if (showChaines !== false) {
    // CORRECTIF (bug rapporté : "le Câblage DC ne fonctionne pas — rien ne s'affiche, ni en auto ni
    // en manuel") : `pts` contient des panneaux BRUTS (sortie de CM.packPanelsForPan — forme
    // {cx, cy, w, l, angle, ...}, un CENTRE, jamais {x, y}). fit.toCanvas() lit pt.x/pt.y — passé un
    // objet qui n'a que cx/cy, pt.x vaut undefined, produisant des coordonnées NaN ; moveTo/lineTo/
    // fillText avec des coordonnées non finies sont silencieusement ignorés par le spec Canvas 2D
    // (aucune exception) — les fils de chaque chaîne et les libellés S{n}+/S{n}- n'étaient donc
    // JAMAIS dessinés, alors que model.strings est lui correctement peuplé. Contraste avec la boucle
    // des CARRÉS de panneaux ci-dessus (fonctionne normalement) : elle convertit bien cx/cy/angle/w/l
    // en points {x,y} via CM.panelCornersTrue() avant tout appel à fit.toCanvas — cette boucle
    // sautait cette conversion. Chaque panneau est désormais explicitement converti en son point
    // centre {x: p.cx, y: p.cy} avant fit.toCanvas.
    // CORRECTIF/NOUVEAU (demande explicite) : labels centrés sur leur panneau à 1/4 de sa hauteur
    // (point 1, cf. panelLabelPoint), flèche au début / cercle à la fin de chaque chaîne (point 2,
    // cf. drawArrowMarker/drawDotMarker), extrémité "+" pilotée par model.startPolarity (point 5) —
    // la flèche (début physique) et le cercle (fin physique) restent, eux, toujours sur le 1er/
    // dernier panneau de panelKeys : seule l'étiquette "+"/"-" (une convention électrique) se
    // déplace, pas le sens de tracé du fil lui-même.
    const startIsPlus = model.startPolarity !== 'minus';
    model.strings.forEach((s, si) => {
      const pts = s.panelKeys.map((k) => panels.find((p) => p.panelIndex === k)).filter(Boolean);
      if (!pts.length) return;
      const color = CABLAGE_DC_COLORS[si % CABLAGE_DC_COLORS.length];
      const canvasPts = pts.map((p) => fit.toCanvas({ x: p.cx, y: p.cy }));

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      canvasPts.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.stroke();

      const startPt = canvasPts[0];
      const endPt = canvasPts[canvasPts.length - 1];
      const dirPt = canvasPts.length > 1 ? canvasPts[1] : { x: startPt.x, y: startPt.y - 1 };
      const arrowAngle = Math.atan2(dirPt.y - startPt.y, dirPt.x - startPt.x);
      drawArrowMarker(ctx, startPt, arrowAngle, 7, color);
      drawDotMarker(ctx, endPt, 4, color);

      ctx.fillStyle = color;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      // CORRECTIF (demande explicite : "positionner un peu plus bas les n° des chaînes, car ils sont
      // un peu masqués par les flèches en début et les ronds en bout de chaîne") : décalage
      // supplémentaire, FIXE EN PIXELS ÉCRAN (indépendant du zoom/de la taille réelle du panneau,
      // comme PV_LABEL_ARROW_GAP_PX ailleurs dans ce module), appliqué APRÈS fit.toCanvas — dégage le
      // libellé du marqueur (flèche ou cercle) posé exactement au centre du même panneau.
      // CORRECTIF (2e passe, demande explicite : "remonter de 3px les labels S1+, S1-…") : 10 → 7.
      const LABEL_MARKER_GAP_PX = 7;
      const plusPanel = startIsPlus ? pts[0] : pts[pts.length - 1];
      const plusLabelPt = fit.toCanvas(panelLabelPoint(plusPanel));
      plusLabelPt.y += LABEL_MARKER_GAP_PX;
      ctx.fillText(`S${si + 1}+`, plusLabelPt.x, plusLabelPt.y);
      if (pts.length > 1) {
        const minusPanel = startIsPlus ? pts[pts.length - 1] : pts[0];
        const minusLabelPt = fit.toCanvas(panelLabelPoint(minusPanel));
        minusLabelPt.y += LABEL_MARKER_GAP_PX;
        ctx.fillText(`S${si + 1}-`, minusLabelPt.x, minusLabelPt.y);
      }
      ctx.textAlign = 'start';
    });
  }
}

// Rendu mono-pan : bbox/fit propres à CE pan (comportement strictement inchangé — même logique
// qu'avant l'extraction de drawPanelsAndStrings ci-dessus, seulement reformulée en délégation).
function drawCablageCanvas(view) {
  const { canvas, ctx, panels, model } = view;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const bbox = computePanelsBoundingBox(panels);
  const fit = computeFit(bbox, canvas.width, canvas.height, 28);
  view.fit = fit;

  drawPanelsAndStrings(ctx, panels, model, fit, view.showChaines);

  // NOUVEAU (demande explicite : "rose des vents visible... sur le plan de câblage") : les
  // panneaux (packPanelsForPan) sont dans le même repère mètres "vrai" (non tourné par pan.angle)
  // que pan.points/CM.state.roofLocal — même convention +Y=Nord/+X=Est établie ailleurs
  // (latLngToLocal, calepinage_maison_calculs.js) — fit.toCanvas() suffit donc pour déduire la
  // direction Nord correcte, sans dupliquer de logique de rotation propre à ce canvas dédié.
  renderWindRoseDc(ctx, canvas.width - 40, 40, 22, fit.toCanvas);
}

// NOUVEAU (vue combinée multi-pans, demande explicite : "afficher tous les pans en même temps... la
// vision entière du bâtiment") : bbox/fit COMBINÉ (union des panneaux de TOUS les pans), un seul
// dessin par pan (contour réel + drawPanelsAndStrings réutilisé tel quel) positionné à sa vraie place
// relative — c'est ce fit partagé, et lui seul, qui donne une géométrie de bâtiment correcte (cf. plan
// : pan.points de chaque pan sont déjà des sous-régions réelles non-chevauchantes du même repère).
function drawCablageCanvasCombined(combined) {
  const { canvas, ctx, resolvedList, byId } = combined;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const allPanels = resolvedList.reduce((acc, r) => acc.concat(r.panels), []);
  const bbox = computePanelsBoundingBox(allPanels);
  const fit = computeFit(bbox, canvas.width, canvas.height, 28);
  combined.fit = fit;

  resolvedList.forEach((r) => {
    // Contour réel du pan (nouveau, absent du rendu mono-pan) : distingue visuellement les N zones
    // du toit — sans lui, 2 pans adjacents dessineraient juste des grilles de panneaux flottantes,
    // sans indiquer où finit l'un et où commence l'autre.
    const contourPts = (r.pan.points || []).map(fit.toCanvas);
    if (contourPts.length > 1) {
      ctx.save();
      ctx.beginPath();
      contourPts.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.closePath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    const panView = byId[r.field.subPvId];
    drawPanelsAndStrings(ctx, r.panels, r.model, fit, panView ? panView.showChaines : true);
  });

  renderWindRoseDc(ctx, canvas.width - 40, 40, 22, fit.toCanvas);
}

function renderWindRoseDc(ctx, cx, cy, radius, toCanvasFn) {
  const origin = toCanvasFn({ x: 0, y: 0 });
  const northPt = toCanvasFn({ x: 0, y: 1 });
  const northAngle = Math.atan2(northPt.y - origin.y, northPt.x - origin.x);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 1;
  ctx.stroke();

  const dirs = [
    { label: 'N', angle: northAngle, color: '#dc2626' },
    { label: 'E', angle: northAngle + Math.PI / 2, color: '#6b7280' },
    { label: 'S', angle: northAngle + Math.PI, color: '#6b7280' },
    { label: 'O', angle: northAngle - Math.PI / 2, color: '#6b7280' },
  ];
  dirs.forEach((d) => {
    const armLen = radius - 5;
    const tipX = cx + Math.cos(d.angle) * armLen, tipY = cy + Math.sin(d.angle) * armLen;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.label === 'N' ? 2 : 1.2;
    ctx.stroke();
    const labelX = cx + Math.cos(d.angle) * (radius + 8), labelY = cy + Math.sin(d.angle) * (radius + 8);
    ctx.fillStyle = d.color;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.label, labelX, labelY);
  });
  ctx.restore();
}

function canvasEventToMeter(view, evt) {
  const rect = view.canvas.getBoundingClientRect();
  const px = (evt.clientX - rect.left) * (view.canvas.width / rect.width);
  const py = (evt.clientY - rect.top) * (view.canvas.height / rect.height);
  return view.fit.fromCanvas({ x: px, y: py });
}

// ---------------------------------------------------------------------------------------------
// Intégration : persistance BD + alimentation du calcul de perte DC existant.
// ---------------------------------------------------------------------------------------------
function persistAndPropagate(view) {
  ensureLengthsRows(view.model, view.model.strings, view.panels);
  const stats = computeGlobalStats(view.model);
  const CM = window.CalepinageMaisonIndiv;
  if (CM && typeof CM.persistCablageDcChange === 'function') {
    CM.persistCablageDcChange(view.field.pvId);
  }
  if (typeof window.applyCablageDcMaxLength === 'function') {
    window.applyCablageDcMaxLength(view.field.subPvId, stats.maxLength);
  }
  return stats;
}

// CORRECTIF (demande explicite : colonnes Total(S+)/Total(S-) + ligne de totaux + carte "Longueur
// totale") : `view` ajouté pour rafraîchir aussi ces cellules calculées SANS déclencher un re-rendu
// complet du tableau (wireLengthInputs appelle ceci sur chaque frappe clavier — un re-rendu perdrait
// le focus de l'input en cours de saisie, cf. commentaire historique de ce fichier). Les IDs
// `cablageDcTotalPlus-${si}`/`cablageDcTotalMinus-${si}`/`cablageDcFooter*` sont posés par
// renderCablageTableHTML ci-dessus.
function updateStatsDisplay(view, stats) {
  const avgPlusEl = document.getElementById('cablageDcAvgPlus');
  const avgMinusEl = document.getElementById('cablageDcAvgMinus');
  const maxEl = document.getElementById('cablageDcMaxLength');
  const totalLengthEl = document.getElementById('cablageDcTotalLength');
  if (avgPlusEl) avgPlusEl.textContent = `${stats.avgPlus.toFixed(1)} ml`;
  if (avgMinusEl) avgMinusEl.textContent = `${stats.avgMinus.toFixed(1)} ml`;
  if (maxEl) maxEl.textContent = `${stats.maxLength.toFixed(1)} ml`;
  if (totalLengthEl) totalLengthEl.textContent = `${stats.totalLength.toFixed(1)} ml`;

  const footerChainsEl = document.getElementById('cablageDcFooterChains');
  const footerPlusEl = document.getElementById('cablageDcFooterTotalPlus');
  const footerMinusEl = document.getElementById('cablageDcFooterTotalMinus');
  if (footerChainsEl) footerChainsEl.textContent = `Total (${stats.totalChains} chaîne${stats.totalChains > 1 ? 's' : ''})`;
  if (footerPlusEl) footerPlusEl.textContent = `${stats.totalPlusSum.toFixed(1)} ml`;
  if (footerMinusEl) footerMinusEl.textContent = `${stats.totalMinusSum.toFixed(1)} ml`;

  if (view && view.model) {
    view.model.lengths.forEach((row, si) => {
      const rowTotals = computeRowTotals(row);
      const plusEl = document.getElementById(`cablageDcTotalPlus-${si}`);
      const minusEl = document.getElementById(`cablageDcTotalMinus-${si}`);
      if (plusEl) plusEl.textContent = `${rowTotals.totalPlus.toFixed(1)} ml`;
      if (minusEl) minusEl.textContent = `${rowTotals.totalMinus.toFixed(1)} ml`;
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Rendu HTML
// ---------------------------------------------------------------------------------------------
// CORRECTIF (demande explicite : "saisie max par champ : 0-200 ml maximum") : borne resserrée de
// 500 à 200 (garde-fou natif) — la validation JS (wireLengthInputs) applique la même règle.
function cablageDcLengthCellHTML(id, value, label) {
  return `
    <input type="number" min="0" max="200" step="0.1" class="form-control form-control-sm" id="${id}" value="${value === null || value === undefined ? '' : value}" placeholder="ml" data-cablage-label="${label}" />
    <div id="${id}-error" style="display:none; color:#dc3545; font-size:0.7rem; margin-top:2px;"></div>
  `;
}

// NOUVEAU (demande explicite : "personnaliser la longueur du câble de retour de la chaîne S+ ou S-
// en fonction du départ de la chaîne — on laisse par défaut la longueur S+ = S-, c'est le cas
// existant") : Long.(S+)/Long.(S-) redeviennent des champs saisissables (pré-remplis par la valeur
// calculée automatiquement, cf. ensureLengthsRows) — un bouton "↺" apparaît UNIQUEMENT sur la chaîne
// et le pôle modifié manuellement, pour revenir au calcul automatique (row.manualPlus/manualMinus).
function cablageDcPlusMinusCellHTML(id, value, label, isManual) {
  const displayValue = value === null || value === undefined ? '' : Number(value).toFixed(1);
  return `
    <div style="display:flex; align-items:center; gap:2px;">
      <input type="number" min="0" max="200" step="0.1" class="form-control form-control-sm" id="${id}" value="${displayValue}" placeholder="ml" data-cablage-label="${label}" style="flex:1 1 auto; min-width:0;" />
      ${isManual ? `<button type="button" class="cablageDcResetLengthBtn" data-reset="${id}" title="Revenir au calcul automatique (trajet du plan)" aria-label="Revenir au calcul automatique">↺</button>` : ''}
    </div>
    <div id="${id}-error" style="display:none; color:#dc3545; font-size:0.7rem; margin-top:2px;"></div>
  `;
}

// CORRECTIF (demande explicite : "donner des titres aux colonnes du tableau... N° des strings,
// Long. (S+), Long. (S-), Descente verticale, Chem. Horizontal, supprimer les 2 autres colonnes,
// calculer automatiquement Long.(S+)/Long.(S-)") : Plus/Minus sont calculés par défaut
// (computeChainPathLengthM, cf. ensureLengthsRows).
// CORRECTIF (demande explicite, round suivant : "personnaliser la longueur du câble de retour de la
// chaîne S+ ou S- en fonction du départ de la chaîne, en laissant S+ = S- par défaut") : Plus/Minus
// redeviennent des <input> éditables (cf. cablageDcPlusMinusCellHTML) — le calcul automatique reste
// le comportement par défaut tant que l'utilisateur ne les modifie pas (row.manualPlus/manualMinus).
// CORRECTIF (demande explicite : "conserver les colonnes des totales pour les Long. totale de S+ et
// S-" + "ajouter une ligne qui calcule les totaux : de chaînes, de câbles S+, S-") : les colonnes
// Total+/Total- (retirées lors d'un round précédent) sont réintroduites — computeRowTotals/
// computeGlobalStats n'ont jamais cessé d'être calculées (déjà utilisées par
// applyCablageDcMaxLength) — + une ligne <tfoot> de totaux, réutilisant les mêmes sommes déjà
// exposées par computeGlobalStats (totalChains/totalPlusSum/totalMinusSum), sans dupliquer le calcul.
// CORRECTIF (demande explicite, 3e passe) :
//  - ordre des colonnes par défaut : N° strings | Long.(S+) | Long.(S-) | Desc. verticale |
//    Chem. horizontal | [colonnes perso] | Total (S+) | Total (S-).
//  - Total (S+) / Total (S-) TOUJOURS en dernier, même après les colonnes perso.
//  - Desc. verticale / Chem. horizontal / colonnes perso : supprimables (croix dans l'en-tête) ;
//    N° strings, Long.(S+/-) et Total(S+/-) ne le sont jamais. Les colonnes de base masquées sont
//    listées dans model.removedBaseCols et rétablissables via un bouton dédié.
//  - en-têtes forcés en bleu (#2563eb, couleur existante du modal = CABLAGE_DC_COLORS[0]) : la
//    règle globale `.table th { color:#fff !important }` (Tabs.css) les rendait invisibles.
function renderCablageTableHTML(view) {
  const { model } = view;
  ensureLengthsRows(model, model.strings, view.panels);
  const customCols = model.customColumns || [];
  const removed = model.removedBaseCols || [];
  const stats = computeGlobalStats(model);

  const cols = [
    { key: 'numero', label: 'N° des strings' },
    { key: 'plus', label: 'Long. (S+)' },
    { key: 'minus', label: 'Long. (S-)' },
  ];
  if (!removed.includes('descente')) cols.push({ key: 'descente', label: 'Desc. verticale', removable: 'descente' });
  if (!removed.includes('cheminement')) cols.push({ key: 'cheminement', label: 'Chem. horizontal', removable: 'cheminement' });
  customCols.forEach((c) => cols.push({ key: `custom:${c.id}`, label: c.label, removable: `custom:${c.id}`, custom: c }));
  cols.push({ key: 'totalPlus', label: 'Total (S+)' });
  cols.push({ key: 'totalMinus', label: 'Total (S-)' });

  const removeBtn = (token) => `<button type="button" class="cablageDcRemoveColBtn" data-col="${token}" title="Supprimer cette colonne" aria-label="Supprimer cette colonne">×</button>`;

  // CORRECTIF (demande explicite : "réduire la largeur des colonnes, toutes les colonnes doivent
  // avoir la MÊME largeur") : table-layout:fixed + largeur identique (100 / nb colonnes) sur chaque
  // en-tête ; les libellés longs passent à la ligne (word-break) au lieu d'élargir leur colonne.
  const colW = (100 / cols.length).toFixed(3);
  const headerCells = cols.map((c) => (
    `<th style="width:${colW}%;">${c.label}${c.removable ? ' ' + removeBtn(c.removable) : ''}</th>`
  )).join('');

  const cellFor = (c, row, si, rowTotals) => {
    switch (c.key) {
      case 'numero': return `<td style="font-weight:bold; color:${CABLAGE_DC_COLORS[si % CABLAGE_DC_COLORS.length]};">S${si + 1}</td>`;
      case 'plus': return `<td>${cablageDcPlusMinusCellHTML(`cablageDcPlus-${si}`, row.plus, 'Longueur S+', !!row.manualPlus)}</td>`;
      case 'minus': return `<td>${cablageDcPlusMinusCellHTML(`cablageDcMinus-${si}`, row.minus, 'Longueur S-', !!row.manualMinus)}</td>`;
      case 'descente': return `<td>${cablageDcLengthCellHTML(`cablageDcDescente-${si}`, row.descente, 'Descente verticale')}</td>`;
      case 'cheminement': return `<td>${cablageDcLengthCellHTML(`cablageDcCheminement-${si}`, row.cheminement, 'Cheminement horizontal')}</td>`;
      case 'totalPlus': return `<td id="cablageDcTotalPlus-${si}">${rowTotals.totalPlus.toFixed(1)} ml</td>`;
      case 'totalMinus': return `<td id="cablageDcTotalMinus-${si}">${rowTotals.totalMinus.toFixed(1)} ml</td>`;
      default: {
        const cc = c.custom;
        return `<td>${cablageDcLengthCellHTML(`cablageDcCustom-${cc.id}-${si}`, (row.custom || {})[cc.id], cc.label)}</td>`;
      }
    }
  };

  const buildRow = (si, extraStyle) => {
    const row = model.lengths[si] || { plus: 0, minus: 0, descente: null, cheminement: null, custom: {} };
    const rowTotals = computeRowTotals(row);
    return `<tr${extraStyle ? ` style="${extraStyle}"` : ''}>${cols.map((c) => cellFor(c, row, si, rowTotals)).join('')}</tr>`;
  };

  // NOUVEAU (demande explicite : "dans le tableau des métrés, mentionner la référence de l'onduleur ;
  // s'il y a plusieurs onduleurs, ajouter des sous-sections par onduleur — on garde le total pour
  // l'ensemble des onduleurs") : au-delà d'UN onduleur physique (spec.nbOnduleurs > 1), les chaînes
  // sont réparties par bloc de `spec.nbPvInputs` (capacité d'un onduleur) en sous-sections, chacune
  // précédée d'une ligne d'en-tête ; le <tfoot> plus bas (stats.totalPlusSum/totalMinusSum) reste,
  // lui, INCHANGÉ — somme de TOUTES les chaînes, tous onduleurs confondus.
  const spec = getEffectiveMpptSpec(view);
  const sectionHeaderRow = (label) => `<tr><td colspan="${cols.length}" style="background:#f1f5f9; font-weight:bold; color:#0f766e; text-align:left;">${label}</td></tr>`;

  let rows;
  if (spec.nbOnduleurs > 1 && model.strings.length) {
    const { groups, overflow } = partitionStringsByOnduleurUnit(model, spec, view.field);
    rows = groups
      .filter((g) => g.indices.length)
      .map((g) => sectionHeaderRow(`Onduleur #${g.unit}${spec.ref ? ' — ' + spec.ref : ''}`) + g.indices.map((si) => buildRow(si)).join(''))
      .join('');
    if (overflow.length) {
      rows += sectionHeaderRow('Hors capacité — capacité MPPT totale insuffisante')
        + overflow.map((si) => buildRow(si, 'background:#fff3cd;')).join('');
    }
  } else {
    rows = model.strings.map((s, si) => buildRow(si)).join('');
  }

  const onduleurRefLabel = spec.ref
    ? spec.ref
    : (spec.source === 'fallback' ? 'Non sélectionné' : 'Non reconnu dans le catalogue');
  const onduleurRefHTML = `<div style="font-size:0.78rem; color:#495057; margin-bottom:6px;">Onduleur : <strong>${onduleurRefLabel}</strong>${spec.nbOnduleurs > 1 ? ` — ${spec.nbOnduleurs} unités, ${spec.nbPvInputs} chaînes max/unité` : ''}</div>`;

  const footerCells = cols.map((c) => {
    if (c.key === 'numero') return `<td id="cablageDcFooterChains">Total (${stats.totalChains} chaîne${stats.totalChains > 1 ? 's' : ''})</td>`;
    if (c.key === 'totalPlus') return `<td id="cablageDcFooterTotalPlus">${stats.totalPlusSum.toFixed(1)} ml</td>`;
    if (c.key === 'totalMinus') return `<td id="cablageDcFooterTotalMinus">${stats.totalMinusSum.toFixed(1)} ml</td>`;
    return '<td></td>';
  }).join('');

  const restoreButtons = [
    { token: 'descente', label: 'Desc. verticale' },
    { token: 'cheminement', label: 'Chem. horizontal' },
  ].filter((b) => removed.includes(b.token))
    .map((b) => `<button type="button" class="btn btn-sm cablageDcRestoreColBtn" data-col="${b.token}" style="background:#e7f0ff; color:#2563eb; border:1px solid #2563eb;">[ + ] ${b.label}</button>`)
    .join(' ');

  return `
    <style>
      /* CORRECTIF (bug rapporté : "les labels des colonnes ne s'affichent pas — ils sont en blanc") :
         .table th { color:#fff !important } (Tabs.css) + --primary-color quasi blanc rendaient les
         en-têtes invisibles. Couleur bleue EXISTANTE du modal (#2563eb = CABLAGE_DC_COLORS[0]) sur
         fond blanc, !important pour battre la règle globale. */
      #cablageDcMetresTable { table-layout: fixed; }
      #cablageDcMetresTable thead th {
        color: #2563eb !important;
        background: #ffffff !important;
        position: static !important;
        vertical-align: bottom;
        white-space: normal;
        word-break: break-word;
      }
      /* CORRECTIF (demande explicite : "centrer les données dans le tableau des métrés"). */
      #cablageDcMetresTable td, #cablageDcMetresTable th {
        overflow: hidden; text-overflow: ellipsis;
        text-align: center; vertical-align: middle;
      }
      /* CORRECTIF (demande explicite : "réduire la largeur des colonnes... il y a plein d'espace vide
         dans les colonnes" — donner plus de place au canevas du plan de câblage) : contenu réel très
         court ("S1", "0.0 ml") — padding Bootstrap par défaut (table-sm) trop généreux pour ça. */
      #cablageDcMetresTable td, #cablageDcMetresTable th { padding: 0.25rem 0.3rem; }
      #cablageDcMetresTable td input { text-align: center; padding: 0.15rem 0.2rem; }
      #cablageDcMetresTable .cablageDcRemoveColBtn {
        border: none; background: transparent; color: #dc3545; font-weight: bold;
        cursor: pointer; padding: 0 2px; line-height: 1; font-size: 0.95rem;
      }
      #cablageDcMetresTable .cablageDcRemoveColBtn:hover { color: #a71d2a; }
      #cablageDcMetresTable .cablageDcResetLengthBtn {
        border: none; background: transparent; color: #0f766e; font-weight: bold;
        cursor: pointer; padding: 0 2px; line-height: 1; font-size: 0.9rem; flex: 0 0 auto;
      }
      #cablageDcMetresTable .cablageDcResetLengthBtn:hover { color: #0b544e; }
    </style>
    <div style="font-weight:bold; color:#212529; margin-bottom:6px;">Tableau des métrés des câbles DC</div>
    ${onduleurRefHTML}
    <div style="overflow-x:auto;">
      <table id="cablageDcMetresTable" class="table table-sm" style="width:100%; min-width:${cols.length * 46}px;">
        <thead>
          <tr style="font-size:0.78rem;">${headerCells}</tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="${cols.length}" style="color:#6c757d; font-style:italic;">Aucune chaîne assignée pour l'instant.</td></tr>`}</tbody>
        ${model.strings.length ? `
        <tfoot>
          <tr style="font-weight:bold; border-top:2px solid #495057;">${footerCells}</tr>
        </tfoot>` : ''}
      </table>
    </div>
    <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
      <button type="button" class="btn btn-sm" id="cablageDcAddColumnBtn" style="background:#0f766e; color:#fff; border-color:#0f766e;">[ + ] Ajouter une colonne de longueur</button>
      ${restoreButtons}
      <span id="cablageDcAddColumnForm" style="display:none;">
        <input type="text" id="cablageDcNewColLabel" maxlength="30" placeholder="Nom de la colonne (ex: Cheminement sous toiture)" style="width:260px;" class="form-control form-control-sm d-inline-block" />
        <button type="button" class="btn btn-sm btn-primary" id="cablageDcAddColumnConfirm">Ajouter</button>
        <div id="cablageDcNewColLabelError" style="display:none; color:#dc3545; font-size:0.72rem; margin-top:2px;"></div>
      </span>
    </div>
    <div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:14px;">
      ${window.chainesPertesMetricCard('Longueur moyenne (+)', `<span id="cablageDcAvgPlus">${stats.avgPlus.toFixed(1)} ml</span>`)}
      ${window.chainesPertesMetricCard('Longueur moyenne (-)', `<span id="cablageDcAvgMinus">${stats.avgMinus.toFixed(1)} ml</span>`)}
      ${window.chainesPertesMetricCard('Longueur maximale (dU DC)', `<span id="cablageDcMaxLength">${stats.maxLength.toFixed(1)} ml</span>`, true)}
      ${window.chainesPertesMetricCard('Longueur totale', `<span id="cablageDcTotalLength">${stats.totalLength.toFixed(1)} ml</span>`)}
    </div>
  `;
}

// ---------------------------------------------------------------------------------------------
// Affectation des chaînes aux entrées MPPT de l'onduleur (demande explicite).
// Ex. Sun2000-10KTL-M2 : 10 MPPT, 2 entrées PV par MPPT => 20 entrées PV (PV1..PV20). Chaque chaîne
// est affectée automatiquement (chaîne i -> PVi -> MPPT ⌈i / perMppt⌉), l'utilisateur pouvant
// ensuite déplacer une chaîne sur une autre entrée PV / un autre MPPT (drapeau `manual`).
// ---------------------------------------------------------------------------------------------

// Spéc. MPPT de l'onduleur SÉLECTIONNÉ (cf. chaines_pertes_modal.js : slot partagé
// window.__chainesPertesGlobal.onduleur, ou par champ window.__chainesOnduleurByField[pvId] en mode
// 'perField'). La référence (g.onduleur.data.ref) sert de clé dans le cache brut de l'API catalogue
// (window.onduleurCatalogFromApi, champs nb_entrees_mppt / nb_mppt_par_entree issus de
// equipements_pv.py::to_dict) — le payload pvEquipementSelected ne transporte pas ces 2 champs.
// `perMppt` par défaut = 2 (valeur de l'exemple métier) si la BD ne renseigne pas nb_mppt_par_entree.
// "10 / 2" (nb_entrees_mppt_affichage) -> { nbMppt:10, perMppt:2 } ; "3" -> { nbMppt:3, perMppt:0 }.
function parseMpptAffichage(s) {
  const m = String(s == null ? '' : s).match(/(\d+)\s*[/xX×]\s*(\d+)/);
  if (m) return { nbMppt: parseInt(m[1], 10) || 0, perMppt: parseInt(m[2], 10) || 0 };
  const n = parseInt(s, 10);
  return { nbMppt: Number.isFinite(n) ? n : 0, perMppt: 0 };
}

// CORRECTIF (bug rapporté : "tout reste sur MPPT1") : nb_entrees_mppt n'est PAS toujours rempli dans
// le cache brut de l'API — on tente aussi le champ d'affichage "10 / 2" (nb_entrees_mppt_affichage),
// puis window.inverterDB (fusion catalogue + BD, details['Nb entrées MPPT']) avant d'abandonner.
// CORRECTIF (demande explicite : "si on choisit un onduleur dans le formulaire calepinage, le
// retrouver dans le modal de dimensionnement") : résolution déléguée à getFieldOnduleurEntry
// (chaines_pertes_modal.js, chargé avant ce fichier — fonctions top-level en portée globale, même
// convention que le reste du module) plutôt que dupliquée ici SANS le repli résidentiel — l'ancienne
// version ignorait totalement CM.state.onduleurRef, l'affectation MPPT retombait donc systématiquement
// sur le repli générique (⌈nb chaînes / 2⌉, 2 entrées/MPPT) au lieu des vraies caractéristiques de
// l'onduleur choisi dans le calepinage résidentiel.
function resolveInverterMpptSpec(field) {
  const entry = getFieldOnduleurEntry(field && field.pvId, field);
  const data = entry && entry.data ? entry.data : entry;
  const ref = data && (data.ref || data.reference || data.ond_ref);
  if (!ref) return null;

  const db = (window.onduleurCatalogFromApi || []).find((o) => o && o.reference === ref);
  let nbMppt = db ? (parseInt(db.nb_entrees_mppt, 10) || 0) : 0;
  let perMppt = db ? (parseInt(db.nb_mppt_par_entree, 10) || 0) : 0;

  if ((!nbMppt || !perMppt) && db && db.nb_entrees_mppt_affichage) {
    const p = parseMpptAffichage(db.nb_entrees_mppt_affichage);
    nbMppt = nbMppt || p.nbMppt;
    perMppt = perMppt || p.perMppt;
  }
  if (!nbMppt && window.inverterDB) {
    const inv = Object.values(window.inverterDB).reduce((a, b) => a.concat(b || []), [])
      .find((x) => x && x.ref === ref);
    if (inv && inv.details) {
      const p = parseMpptAffichage(inv.details['Nb entrées MPPT']);
      nbMppt = p.nbMppt;
      perMppt = perMppt || p.perMppt;
    }
  }

  if (!perMppt) perMppt = 2;
  const spec = { ref, nbMppt, perMppt, nbPvInputs: nbMppt * perMppt };
  // Appareil hors réseau avec coffret de regroupement : entrées du coffret au lieu de celles de
  // l'appareil (onduleurs_hors_reseau.js). Renvoie `spec` tel quel pour tout autre onduleur.
  return window.OnduleursHorsReseau ? window.OnduleursHorsReseau.ajusterSpecMppt(field, spec) : spec;
}

// CORRECTIF (demande explicite : "le tableau MPPT ne s'affiche pas") : la 1re version se masquait
// dès que l'onduleur n'était pas reconnu en base (nb_entrees_mppt absent). Le tableau est désormais
// TOUJOURS affiché : la spéc. vient de la BD si dispo, sinon d'un override manuel (model.mpptConfig),
// sinon d'un repli calculé (⌈nb chaînes / 2⌉ MPPT, 2 entrées PV/MPPT). `source` sert au libellé.
function getEffectiveMpptSpec(view) {
  const db = resolveInverterMpptSpec(view.field); // { ref, nbMppt, perMppt, nbPvInputs } | null
  const cfg = view.model.mpptConfig || {};
  const nStrings = view.model.strings.length;

  const perMppt = parseInt(cfg.perMppt, 10) > 0 ? parseInt(cfg.perMppt, 10)
    : (db && db.perMppt) || 2;
  let nbMppt = parseInt(cfg.nbMppt, 10) > 0 ? parseInt(cfg.nbMppt, 10)
    : (db && db.nbMppt) || 0;
  let source = 'config';
  if (parseInt(cfg.nbMppt, 10) > 0 || parseInt(cfg.perMppt, 10) > 0) source = 'manual';
  else if (db && db.nbMppt) source = 'db';
  // CORRECTIF (bug rapporté : "tout reste sur MPPT1") : sans donnée onduleur, le repli à
  // ⌈nb chaînes / 2⌉ pouvait valoir 1 (≤ 2 chaînes) → une seule option "MPPT 1" dans le menu.
  // On offre au moins autant de MPPT que de chaînes, pour que l'affectation manuelle soit possible.
  if (!nbMppt) { nbMppt = Math.max(1, nStrings); source = 'fallback'; }

  const nbPvInputs = nbMppt * perMppt;
  // NOUVEAU (demande explicite : "le tableau des strings ne peut pas contenir plus de chaînes que la
  // limite acceptée par l'onduleur — ex. Sun2000-100KTL-M2 accepte 20 chaînes, si le projet en a 25,
  // il faut n'en brancher que 20 et avertir l'utilisateur") : capacité TOTALE = capacité d'UN
  // onduleur (nbMppt x perMppt) multipliée par le nombre d'onduleurs physiques de cet onglet
  // (tabState.nbOnduleurs, déjà utilisé ailleurs pour les calculs de puissance AC — jamais pour la
  // capacité MPPT jusqu'ici, c'est le vrai manque à l'origine du bug rapporté).
  const tabState = (view.field && typeof getPvTabState === 'function') ? getPvTabState(view.field.pvId) : null;
  const nbOnduleurs = Math.max(1, parseInt(tabState && tabState.nbOnduleurs, 10) || 1);

  return {
    ref: db && db.ref ? db.ref : null,
    nbMppt,
    perMppt,
    nbPvInputs,
    nbOnduleurs,
    totalCapacity: nbPvInputs * nbOnduleurs,
    source,
  };
}

// NOUVEAU (suite) : bandeau d'avertissement quand le nombre de chaînes du champ PV dépasse la
// capacité totale (tous onduleurs confondus) — même message pour l'écran et le PDF.
function cablageDcCapacityWarningMessage(spec, nbStrings) {
  if (nbStrings <= spec.totalCapacity) return null;
  const excess = nbStrings - spec.totalCapacity;
  const refPart = spec.ref ? ` (${spec.ref})` : '';
  const unitsPart = spec.nbOnduleurs > 1 ? ` au total pour ${spec.nbOnduleurs} onduleurs` : '';
  return `Capacité MPPT insuffisante : le projet compte ${nbStrings} chaînes, mais l'onduleur sélectionné${refPart} ne peut en accepter que ${spec.totalCapacity}${unitsPart}. Seules les ${spec.totalCapacity} premières chaînes seront raccordées à une entrée MPPT ; les ${excess} chaîne${excess > 1 ? 's' : ''} restante${excess > 1 ? 's' : ''} apparaissent en « Hors capacité » dans le tableau des métrés. Pensez à choisir un modèle d'onduleur avec plus d'entrées MPPT, ou à augmenter le nombre d'onduleurs.`;
}

// NOUVEAU (suite) : répartit les chaînes (dans l'ordre S1, S2…) en groupes, un groupe par onduleur
// physique — jusqu'à `spec.nbOnduleurs` groupes ; les chaînes au-delà de la capacité (totale ou
// manuellement répartie) vont dans `overflow` (non raccordables). Utilisé par le tableau des métrés
// (écran + PDF) pour les sous-sections par onduleur (demande explicite : "s'il y a plusieurs
// onduleurs, il faut ajouter des sous-sections par onduleur, on garde le total pour l'ensemble des
// onduleurs").
// CORRECTIF (demande explicite : "il manque un champ pour indiquer le nombre de chaînes affectées par
// onduleur — le remplissage auto (jusqu'à la capacité max de chaque onduleur avant de passer au
// suivant) n'est pas normal") : quand l'utilisateur a saisi une répartition manuelle
// (fieldState.chainsPerOnduleur, cf. chaines_pertes_modal.js::onduleurSplitFieldHTML/
// wireOnduleurSplit, carte "Config. PV utilisateur"), elle prime sur le repli automatique par
// capacité pleine — chaque onduleur reçoit EXACTEMENT le nombre de chaînes saisi pour lui (borné à
// 1-40 et à la capacité MPPT de l'onduleur dès la saisie, cf. wireOnduleurSplit).
function partitionStringsByOnduleurUnit(model, spec, field) {
  const perUnit = Math.max(1, spec.nbPvInputs || 1);
  const groups = Array.from({ length: spec.nbOnduleurs }, (_, k) => ({ unit: k + 1, indices: [] }));
  const overflow = [];

  const fieldState = (field && typeof getChainsFieldState === 'function') ? getChainsFieldState(field) : null;
  const customCounts = fieldState && Array.isArray(fieldState.chainsPerOnduleur) ? fieldState.chainsPerOnduleur : [];
  const hasCustom = customCounts.some((v) => Number.isFinite(v) && v > 0);

  if (hasCustom) {
    // Un onduleur sans valeur saisie se remplit avec les chaînes restantes (jusqu'à SA propre
    // capacité) plutôt que de recevoir 0 — seuls les onduleurs EXPLICITEMENT renseignés imposent un
    // nombre fixe ; les autres restent en repli automatique (cohérent avec l'indice "Auto" affiché).
    let cursor = 0;
    for (let u = 0; u < spec.nbOnduleurs && cursor < model.strings.length; u++) {
      const specified = Number.isFinite(customCounts[u]) && customCounts[u] > 0;
      const want = specified ? Math.min(perUnit, 40, Math.floor(customCounts[u])) : perUnit;
      for (let k = 0; k < want && cursor < model.strings.length; k++, cursor++) {
        groups[u].indices.push(cursor);
      }
    }
    while (cursor < model.strings.length) { overflow.push(cursor); cursor++; }
  } else {
    model.strings.forEach((s, si) => {
      const unit = Math.floor(si / perUnit);
      if (unit < spec.nbOnduleurs) groups[unit].indices.push(si);
      else overflow.push(si);
    });
  }
  return { groups, overflow };
}

function autoMpptForIndex(i, spec) {
  const per = spec.perMppt || 2;
  return { pv: i + 1, mppt: Math.floor(i / per) + 1 };
}

// Aligne model.mppt sur le nombre de chaînes courant : (ré)affectation automatique tant que
// l'entrée n'a pas été déplacée manuellement (manual !== true).
function ensureMpptAssignments(model, spec) {
  const n = model.strings.length;
  if (!Array.isArray(model.mppt)) model.mppt = [];
  model.mppt.length = n;
  for (let i = 0; i < n; i++) {
    const auto = autoMpptForIndex(i, spec);
    const cur = model.mppt[i];
    if (!cur) { model.mppt[i] = { pv: auto.pv, mppt: auto.mppt, manual: false }; continue; }
    if (!cur.manual) { cur.pv = auto.pv; cur.mppt = auto.mppt; }
  }
}

// NOUVEAU (demande explicite : "on ne peut pas affecter une chaîne à une entrée PV d'un MPPT —
// mettre en place l'affectation manuelle") : équivalent de ensureMpptAssignments/autoMpptForIndex
// ci-dessus, mais reciblé sur la position LOCALE d'une chaîne au sein d'UN groupe d'onduleur
// (group.indices, cf. partitionStringsByOnduleurUnit) plutôt qu'une numérotation continue sur tout
// le champ — pv/mppt restent dans model.mppt[si] (même champ, même drapeau `manual`), juste avec une
// portée locale à l'onduleur de cette chaîne. Pour un seul onduleur, group.indices == toutes les
// chaînes dans l'ordre, donc strictement équivalent à ensureMpptAssignments (aucun changement de
// comportement dans ce cas — c'est d'ailleurs ce dernier qui reste utilisé pour ce cas, cf.
// renderMpptTableHTML/addCablageDcOnduleurRepartitionPage).
function ensureLocalMpptAssignments(model, group, per) {
  if (!Array.isArray(model.mppt)) model.mppt = [];
  group.indices.forEach((si, k) => {
    const autoPv = k + 1;
    const autoMppt = Math.floor(k / per) + 1;
    const cur = model.mppt[si];
    if (!cur) { model.mppt[si] = { pv: autoPv, mppt: autoMppt, manual: false }; return; }
    if (!cur.manual) { cur.pv = autoPv; cur.mppt = autoMppt; }
  });
}

// NOUVEAU (demande explicite : "afficher TOUS les MPPT que possède l'onduleur, y compris dans
// l'export — noter vide pour un MPPT non utilisé, en automatique comme en personnalisé") : pour UN
// onduleur (perUnit = spec.nbPvInputs entrées PV), construit la liste COMPLÈTE des créneaux
// 1..perUnit (jamais seulement les créneaux occupés) — `si: null` = créneau vide. La chaîne qui
// occupe un créneau est déterminée par SA PROPRE valeur pv (cf. ensureLocalMpptAssignments),
// affectation automatique ou manuelle — cohérent avec les <select> qui modifient directement ce pv.
function buildOnduleurSlotRows(model, group, spec) {
  const per = spec.perMppt || 2;
  const perUnit = spec.nbPvInputs;
  ensureLocalMpptAssignments(model, group, per);
  const bySlot = {};
  group.indices.forEach((si) => {
    const a = model.mppt[si];
    if (a && a.pv) bySlot[a.pv] = si;
  });
  return Array.from({ length: perUnit }, (_, k) => {
    const slot = k + 1;
    const mpptNum = Math.floor(k / per) + 1;
    const si = bySlot[slot];
    return { slot, mpptNum, si: si !== undefined ? si : null };
  });
}

// CORRECTIF (demande explicite) :
//  - tableau placé À CÔTÉ du canevas (colonne de droite) pour concevoir plan + affectation en
//    parallèle, avec un bouton Masquer / Afficher (model.showMpptTable, affiché par défaut) ;
//  - champs "Nb MPPT" / "Entrées PV / MPPT" RETIRÉS (jugés sans intérêt) — la capacité vient de la
//    BD onduleur si connue, sinon d'un repli automatique silencieux (⌈nb chaînes / 2⌉ MPPT).
function renderMpptTableHTML(view) {
  const { model } = view;
  const spec = getEffectiveMpptSpec(view);
  // CORRECTIF (multi-onduleurs) : la synchronisation de longueur de model.mppt reste faite ici,
  // inconditionnellement — seule l'affectation FLAT (pv/mppt continus sur tout le champ,
  // ensureMpptAssignments) est désormais réservée au cas nbOnduleurs<=1 (plus bas) ; au-delà, chaque
  // groupe d'onduleur recalcule ses propres pv/mppt LOCAUX via buildOnduleurSlotRows/
  // ensureLocalMpptAssignments (branche ci-dessous et addCablageDcOnduleurRepartitionPage pour le
  // PDF) — appliquer la version FLAT d'abord serait un travail immédiatement écrasé, source de
  // confusion.
  if (!Array.isArray(model.mppt)) model.mppt = [];
  model.mppt.length = model.strings.length;
  const per = spec.perMppt;
  const nbPv = spec.nbPvInputs;
  const shown = model.showMpptTable !== false;

  const toggleBtn = `<button type="button" class="btn btn-sm" id="cablageDcMpptToggleBtn" style="background:#e2e8f0; color:#212529; border-color:#cbd5e1; font-size:0.74rem; padding:2px 8px;">${shown ? 'Masquer' : 'Afficher'} le tableau</button>`;

  if (!shown) {
    return `
      <div id="cablageDcMpptBlock" style="margin-top:4px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span style="font-weight:bold; color:#212529; font-size:0.82rem;">Affectation chaînes → MPPT</span>
          ${toggleBtn}
        </div>
      </div>`;
  }

  const sourceNote = (spec.source === 'db'
    ? `${spec.ref} — ${spec.nbMppt} MPPT × ${per} entrée${per > 1 ? 's' : ''} PV`
    : `Onduleur non reconnu — repli ${spec.nbMppt} MPPT × ${per}`)
    + (spec.nbOnduleurs > 1 ? ` × ${spec.nbOnduleurs} onduleurs = ${spec.totalCapacity} chaînes max` : '');

  const capacityWarning = cablageDcCapacityWarningMessage(spec, model.strings.length);
  const capacityWarningHTML = capacityWarning
    ? `<div style="margin-bottom:6px; padding:8px 10px; background:#fff3cd; border:1px solid #ffe69c; border-radius:6px; color:#664d03; font-size:0.76rem;">${capacityWarning}</div>`
    : '';

  const headerHTML = `
    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px;">
      <span style="font-weight:bold; color:#212529; font-size:0.82rem;">Affectation chaînes → MPPT</span>
      ${toggleBtn}
      <button type="button" class="btn btn-sm" id="cablageDcMpptResetBtn" style="background:#0f766e; color:#fff; border-color:#0f766e; font-size:0.74rem; padding:2px 8px;">Réaffecter auto</button>
    </div>
    <div style="font-size:0.74rem; color:#6c757d; margin-bottom:4px;">${sourceNote}</div>
    ${capacityWarningHTML}`;

  const tableStyle = `
    <style>
      /* CORRECTIF (demande explicite : "labels du tableau MPPT en noir" + "centrer les données des
         colonnes" + "élargir la colonne MPPT pour voir MPPT10"). */
      #cablageDcMpptTable thead th { color:#212529 !important; background:#fff !important; position:static !important; }
      #cablageDcMpptTable td, #cablageDcMpptTable th { padding:.25rem .3rem; text-align:center; vertical-align:middle; }
    </style>`;

  // CORRECTIF (demande explicite : "il faut un bouton ou une liste déroulante pour choisir/
  // visualiser l'affectation des chaînes par onduleur et par MPPT — actuellement un seul tableau
  // mélange tout" + "afficher tous les MPPT, noter vide pour un MPPT non utilisé, en auto comme en
  // personnalisé" + "on ne peut pas affecter une chaîne à une entrée PV d'un MPPT — mettre en place
  // l'affectation manuelle") : au-delà d'UN onduleur, remplace le tableau plat unique (qui mélangeait
  // toutes les chaînes sous une numérotation PV/MPPT continue, incohérente dès qu'il y a plusieurs
  // onduleurs physiques) par un sélecteur (boutons si peu d'onduleurs, sinon liste déroulante) + UN
  // tableau à la fois, celui de l'onduleur choisi — TOUJOURS les `spec.nbPvInputs` créneaux PV/MPPT
  // de cet onduleur (cf. buildOnduleurSlotRows), pas seulement les créneaux occupés — un créneau vide
  // affiche "Vide" ; un créneau occupé garde ses <select> PV/MPPT éditables (mêmes classes/gestion
  // d'évènements que le tableau mono-onduleur ci-dessous — `per` étant le même pour tous les
  // onduleurs d'un système à référence identique, aucune adaptation de wireMpptTable n'est requise).
  if (spec.nbOnduleurs > 1) {
    const { groups, overflow } = partitionStringsByOnduleurUnit(model, spec, view.field);
    const selected = Math.min(Math.max(1, parseInt(model.mpptViewOnduleur, 10) || 1), spec.nbOnduleurs);
    model.mpptViewOnduleur = selected;

    const selectorHTML = spec.nbOnduleurs <= 4
      ? `<div style="display:inline-flex; border:1px solid #0f766e; border-radius:4px; overflow:hidden; margin-bottom:6px;">
          ${groups.map((g) => `<button type="button" class="cablageDcMpptOnduleurBtn" data-onduleur="${g.unit}" style="border:none; padding:4px 10px; font-size:0.76rem; cursor:pointer; background:${g.unit === selected ? '#0f766e' : '#fff'}; color:${g.unit === selected ? '#fff' : '#0f766e'};">Ond. ${g.unit} (${g.indices.length})</button>`).join('')}
        </div>`
      : `<select id="cablageDcMpptOnduleurSelect" class="form-select form-select-sm" style="width:auto; display:inline-block; margin-bottom:6px;">
          ${groups.map((g) => `<option value="${g.unit}" ${g.unit === selected ? 'selected' : ''}>Onduleur ${g.unit} (${g.indices.length} chaîne${g.indices.length > 1 ? 's' : ''})</option>`).join('')}
        </select>`;

    const activeGroup = groups.find((g) => g.unit === selected) || { unit: selected, indices: [] };
    const slotRows = buildOnduleurSlotRows(model, activeGroup, spec);
    const localPvOptions = (sel) => Array.from({ length: nbPv }, (_, k) => k + 1)
      .map((v) => `<option value="${v}" ${v === sel ? 'selected' : ''}>PV${v}</option>`).join('');
    const localMpptOptions = (sel) => Array.from({ length: spec.nbMppt }, (_, k) => k + 1)
      .map((v) => `<option value="${v}" ${v === sel ? 'selected' : ''}>MPPT ${v}</option>`).join('');

    const bodyRows = slotRows.map(({ si }) => {
      if (si === null) return '';
      const a = model.mppt[si];
      return `
        <tr>
          <td style="font-weight:bold; color:${CABLAGE_DC_COLORS[si % CABLAGE_DC_COLORS.length]};">S${si + 1}</td>
          <td><select class="form-select form-select-sm cablageDcMpptPv" data-si="${si}" style="width:92px; display:inline-block;">${localPvOptions(a.pv)}</select></td>
          <td><select class="form-select form-select-sm cablageDcMpptMppt" data-si="${si}" style="width:108px; display:inline-block;">${localMpptOptions(a.mppt)}</select></td>
        </tr>`;
    });
    // Créneaux vides intercalés à leur place naturelle (ordre PV1..PVn) plutôt qu'à la fin — lecture
    // directe de "quel MPPT/quelle entrée PV reste libre".
    slotRows.forEach(({ slot, mpptNum, si }, idx) => {
      if (si !== null) return;
      // "Vide" porté par le n° PV (colonne String laissée vierge) — demande explicite.
      bodyRows[idx] = `<tr style="color:#adb5bd; font-style:italic;"><td></td><td>PV${slot} - Vide</td><td>MPPT ${mpptNum}</td></tr>`;
    });

    const overflowNote = overflow.length
      ? `<div style="margin-top:6px; font-size:0.72rem; color:#b45309;">${overflow.length} chaîne${overflow.length > 1 ? 's' : ''} hors capacité (${overflow.map((si) => `S${si + 1}`).join(', ')}) — non raccordée${overflow.length > 1 ? 's' : ''}.</div>`
      : '';

    return `
      ${tableStyle}
      <div id="cablageDcMpptBlock" style="margin-top:4px;">
        ${headerHTML}
        ${selectorHTML}
        <div style="overflow-x:auto;">
          <table id="cablageDcMpptTable" class="table table-sm" style="width:100%; min-width:264px;">
            <thead><tr style="font-size:0.76rem;"><th style="width:44px;">String</th><th style="width:96px;">N° PV</th><th style="width:116px;">MPPT</th></tr></thead>
            <tbody>${bodyRows.join('') || `<tr><td colspan="3" style="color:#6c757d; font-style:italic;">Aucune entrée pour cet onduleur.</td></tr>`}</tbody>
          </table>
        </div>
        ${overflowNote}
      </div>`;
  }

  ensureMpptAssignments(model, spec);

  const pvOptions = (sel) => Array.from({ length: nbPv }, (_, k) => k + 1)
    .map((v) => `<option value="${v}" ${v === sel ? 'selected' : ''}>PV${v}</option>`).join('');
  const mpptOptions = (sel) => Array.from({ length: spec.nbMppt }, (_, k) => k + 1)
    .map((v) => `<option value="${v}" ${v === sel ? 'selected' : ''}>MPPT ${v}</option>`).join('');

  const bodyRows = model.strings.map((s, si) => {
    const a = model.mppt[si] || { pv: si + 1, mppt: 1 };
    // CORRECTIF (demande explicite : "le tableau ne peut pas contenir plus de chaînes que la
    // capacité de l'onduleur ; si insuffisant, avertir l'utilisateur") : `a.pv > nbPv` ne détectait
    // le dépassement que pour UN SEUL onduleur (nbPv non multiplié par le nombre d'onduleurs) —
    // remplacé par la capacité TOTALE (spec.totalCapacity, cf. getEffectiveMpptSpec), cohérente avec
    // le bandeau d'avertissement et le regroupement par onduleur du tableau des métrés.
    const overflow = si >= spec.totalCapacity;
    return `
      <tr${overflow ? ' style="background:#fff3cd;" title="Hors capacité MPPT — cette chaîne ne peut pas être raccordée avec la configuration actuelle"' : ''}>
        <td style="font-weight:bold; color:${CABLAGE_DC_COLORS[si % CABLAGE_DC_COLORS.length]};">S${si + 1}</td>
        <td><select class="form-select form-select-sm cablageDcMpptPv" data-si="${si}" style="width:92px; display:inline-block;">${pvOptions(a.pv)}</select></td>
        <td><select class="form-select form-select-sm cablageDcMpptMppt" data-si="${si}" style="width:108px; display:inline-block;">${mpptOptions(a.mppt)}</select></td>
      </tr>`;
  }).join('');

  return `
    ${tableStyle}
    <div id="cablageDcMpptBlock" style="margin-top:4px;">
      ${headerHTML}
      <div style="overflow-x:auto;">
        <table id="cablageDcMpptTable" class="table table-sm" style="width:100%; min-width:264px;">
          <thead><tr style="font-size:0.76rem;"><th style="width:44px;">String</th><th style="width:96px;">N° PV</th><th style="width:116px;">MPPT</th></tr></thead>
          <tbody>${bodyRows || `<tr><td colspan="3" style="color:#6c757d; font-style:italic;">Aucune chaîne à affecter.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
}

// Câblage des <select> PV / MPPT, du bouton Masquer/Afficher et du bouton de réaffectation.
function wireMpptTable(view) {
  const m = view.model;
  const spec = getEffectiveMpptSpec(view);
  const per = spec.perMppt;

  const toggleBtn = document.getElementById('cablageDcMpptToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      m.showMpptTable = !(m.showMpptTable !== false);
      persistAndPropagate(view);
      window.renderCablageDcSection(view.field);
    });
  }

  // NOUVEAU (sélecteur d'onduleur, cf. renderMpptTableHTML) : boutons segmentés (≤4 onduleurs) ou
  // liste déroulante (au-delà) — bascule simplement model.mpptViewOnduleur puis re-rend.
  document.querySelectorAll('.cablageDcMpptOnduleurBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      m.mpptViewOnduleur = parseInt(btn.getAttribute('data-onduleur'), 10);
      persistAndPropagate(view);
      window.renderCablageDcSection(view.field);
    });
  });
  const onduleurSelect = document.getElementById('cablageDcMpptOnduleurSelect');
  if (onduleurSelect) {
    onduleurSelect.addEventListener('change', () => {
      m.mpptViewOnduleur = parseInt(onduleurSelect.value, 10);
      persistAndPropagate(view);
      window.renderCablageDcSection(view.field);
    });
  }

  document.querySelectorAll('.cablageDcMpptPv').forEach((sel) => {
    sel.addEventListener('change', () => {
      const si = parseInt(sel.getAttribute('data-si'), 10);
      if (!m.mppt[si]) m.mppt[si] = {};
      const pv = parseInt(sel.value, 10);
      m.mppt[si].pv = pv;
      m.mppt[si].mppt = Math.floor((pv - 1) / per) + 1; // MPPT déduit de l'entrée PV choisie
      m.mppt[si].manual = true;
      persistAndPropagate(view);
      window.renderCablageDcSection(view.field);
    });
  });

  document.querySelectorAll('.cablageDcMpptMppt').forEach((sel) => {
    sel.addEventListener('change', () => {
      const si = parseInt(sel.getAttribute('data-si'), 10);
      if (!m.mppt[si]) m.mppt[si] = {};
      m.mppt[si].mppt = parseInt(sel.value, 10);
      m.mppt[si].manual = true;
      persistAndPropagate(view);
      window.renderCablageDcSection(view.field);
    });
  });

  const resetBtn = document.getElementById('cablageDcMpptResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      (m.mppt || []).forEach((a) => { if (a) a.manual = false; });
      persistAndPropagate(view);
      window.renderCablageDcSection(view.field);
    });
  }
}

// CORRECTIF (bug rapporté à nouveau après une 1re tentative jugée insuffisante : "la couleur
// d'arrière-plan est tronquée sous les boutons Automatique/Manuel") : la tentative précédente
// (2 boutons bordés séparément, chevauchement de bordure via margin-right:-1px) restait fragile
// (artefacts de sous-pixel possibles). Remplacée par un motif robuste et standard : UN SEUL
// conteneur bordé (border-radius + overflow:hidden), les 2 <button> À L'INTÉRIEUR sans bordure
// propre (border:none) — élimine structurellement tout risque de couture/fond tronqué, plutôt que
// de simplement le limiter. Hauteur fixe explicite (height:34px, box-sizing:border-box) partagée
// avec la checkbox "Afficher les chaînes" et le bouton "Réinitialiser" (cf. renderCablageDcSection)
// pour un alignement garanti indépendant des paddings/line-height par défaut de Bootstrap.
function cablageDcModeToggleHTML(model) {
  const autoActive = model.mode !== 'manual';
  const segStyle = (active) => `flex:1; height:34px; box-sizing:border-box; border:none; padding:0 16px; font-size:0.8rem; cursor:pointer; background:${active ? '#0f766e' : '#fff'}; color:${active ? '#fff' : '#0f766e'};`;
  return `
    <div style="display:inline-flex; height:34px; border:1px solid #0f766e; border-radius:4px; overflow:hidden;">
      <button type="button" id="cablageDcModeAuto" style="${segStyle(autoActive)}">Automatique</button>
      <button type="button" id="cablageDcModeManual" style="${segStyle(!autoActive)}">Manuel</button>
    </div>
  `;
}

// NOUVEAU (demande explicite : "ajouter un bouton pour que l'utilisateur puisse sélectionner si le
// câble de retour est positif en fonction du point de départ de la chaîne S+ ou S-, par défaut S+")
// : même motif visuel que cablageDcModeToggleHTML ci-dessus (conteneur unique bordé, boutons internes
// sans bordure propre), pour rester cohérent — bascule purement visuelle (model.startPolarity, cf.
// drawCablageCanvas), n'affecte ni panelKeys ni les longueurs calculées.
function cablageDcPolarityToggleHTML(model) {
  const plusActive = model.startPolarity !== 'minus';
  const segStyle = (active) => `flex:1; height:34px; box-sizing:border-box; border:none; padding:0 14px; font-size:0.8rem; cursor:pointer; white-space:nowrap; background:${active ? '#0f766e' : '#fff'}; color:${active ? '#fff' : '#0f766e'};`;
  return `
    <div style="display:inline-flex; align-items:center; height:34px; border:1px solid #0f766e; border-radius:4px; overflow:hidden;" title="Extrémité de la chaîne considérée comme le départ (câble de retour) — par défaut S+">
      <span style="padding:0 8px; font-size:0.75rem; color:#495057; background:#f8f9fa; align-self:stretch; display:flex; align-items:center; white-space:nowrap;">Départ :</span>
      <button type="button" id="cablageDcPolarityPlus" style="${segStyle(plusActive)}">S+</button>
      <button type="button" id="cablageDcPolarityMinus" style="${segStyle(!plusActive)}">S-</button>
    </div>
  `;
}

// NOUVEAU (demande explicite : "Direction des chaînes : Gauche ou Droite") : même motif que le
// sélecteur Départ ci-dessus. Mode automatique uniquement (en manuel, l'ordre = l'ordre des clics).
function cablageDcDirectionToggleHTML(model) {
  if (model.mode === 'manual') return '';
  const dir = model.chainDirection || 'libre';
  const segStyle = (active) => `flex:1; height:34px; box-sizing:border-box; border:none; padding:0 14px; font-size:0.8rem; cursor:pointer; white-space:nowrap; background:${active ? '#0f766e' : '#fff'}; color:${active ? '#fff' : '#0f766e'};`;
  return `
    <div style="display:inline-flex; align-items:center; height:34px; border:1px solid #0f766e; border-radius:4px; overflow:hidden;" title="Sens de toutes les chaînes vers le point de descente — Gauche : départs à droite, fins à gauche. Libre : sens alterné d'une ligne à l'autre">
      <span style="padding:0 8px; font-size:0.75rem; color:#495057; background:#f8f9fa; align-self:stretch; display:flex; align-items:center; white-space:nowrap;">Direction des chaînes :</span>
      <button type="button" class="cablageDcDirectionBtn" data-dir="libre" style="${segStyle(dir === 'libre')}">Libre</button>
      <button type="button" class="cablageDcDirectionBtn" data-dir="gauche" style="${segStyle(dir === 'gauche')}">Gauche</button>
      <button type="button" class="cablageDcDirectionBtn" data-dir="droite" style="${segStyle(dir === 'droite')}">Droite</button>
    </div>
  `;
}

// Point d'entrée principal, appelé depuis chaines_pertes_modal.js::renderChainesPertesModal()
// quand window.__chainesPertesGlobal.activeView === 'cablage'.
window.renderCablageDcSection = function (field) {
  // NOUVEAU (vue combinée multi-pans) : si ce field appartient à une vue combinée actuellement
  // ouverte (window.__chainesPertesGlobal.activeCablagePans), délègue au ré-rendu combiné au lieu du
  // rendu mono-pan — permet à TOUS les points d'appel existants de
  // window.renderCablageDcSection(view.field) (wireMpptTable, wireCablageDcBodyControls) de continuer
  // à fonctionner sans aucune modification, qu'ils soient invoqués depuis le chemin mono-pan ou
  // depuis la vue combinée.
  const combinedPans = window.__chainesPertesGlobal.activeCablagePans;
  if (combinedPans && field && combinedPans.some((p) => p.subPvId === field.subPvId)) {
    window.renderCablageDcSectionCombined(combinedPans);
    return;
  }

  const container = document.getElementById('chainesPertesCablageSection');
  if (!container || !field) return;

  const resolved = resolveFieldToPan(field);
  if (!resolved) {
    container.innerHTML = `
      <div style="padding: 4px 0 20px;">
        <button type="button" class="btn btn-secondary btn-sm" id="cablageDcBackBtn"><i class="fas fa-arrow-left"></i> Retour à la configuration des chaînes</button>
        <div style="margin-top: 16px; padding: 14px; background: #fff3cd; border: 1px solid #ffe69c; border-radius: 6px; color: #664d03;">
          Le Câblage DC est disponible uniquement pour le calepinage résidentiel (toiture multi-typologie).
          Ce champ PV ne correspond à aucune maison résidentielle connue.
        </div>
      </div>`;
    const backBtn = document.getElementById('cablageDcBackBtn');
    if (backBtn) backBtn.addEventListener('click', () => {
      window.__chainesPertesGlobal.activeView = 'default';
      renderChainesPertesModal();
    });
    return;
  }

  const { pan, state } = resolved;
  const model = getOrCreateCablageModel(state, pan, resolved.cleCablage);
  const stringSizes = getStringSizesForField(field);
  const panels = panelsOfResolvedField(resolved);

  if (model.mode !== 'manual') {
    model.strings = orientStringsHorizontally(assignStringsAutomatically(panels, stringSizes), panels, model.chainDirection);
  }

  const view = window.__cablageDcView && window.__cablageDcView.field === field
    ? window.__cablageDcView
    : { showChaines: true };
  Object.assign(view, { field, pan, state, model, panels, stringSizes });
  window.__cablageDcView = view;

  const sizesLabel = stringSizes.length ? stringSizes.map((n) => `${n} PV`).join(' + ') : 'Non déterminé (renseignez le panneau/onduleur ou "Config. PV utilisateur")';
  // NOUVEAU (demande explicite : "afficher Config. PV utilisateur et Config. automatique pour
  // comparaison") : sizesLabel ci-dessus était la SEULE info affichée jusqu'ici (liste éclatée déjà
  // résolue, ex. "20 PV + 19 PV") — n'indique pas SI cette résolution vient d'une saisie manuelle ou
  // du calcul automatique, ni la valeur de l'autre. Les 2 textes bruts sont affichés côte à côte
  // dans la colonne de résultats ci-dessous.
  const { userConfigText, autoConfigText } = getConfigStringsForField(field);

  container.innerHTML = `
    <div style="padding: 4px 0 20px;">
      <button type="button" class="btn btn-secondary btn-sm" id="cablageDcBackBtn"><i class="fas fa-arrow-left"></i> Retour à la configuration des chaînes</button>
      <div style="font-weight:bold; color:#212529; margin:14px 0 4px;">Câblage DC — Pan : ${field.subPvId} (${field.totalPanels} panneaux)</div>
      <div style="font-size:0.8rem; color:#6c757d; margin-bottom:12px;">Chaînes attendues : ${sizesLabel}</div>

      <!-- CORRECTIF (2e passe, la 1re jugée insuffisante : "aligne proprement les boutons
           Automatique, Manuel, Réinitialiser") : hauteur FIXE explicite (34px, box-sizing:
           border-box) partagée par les 3 éléments (toggle, checkbox, bouton) au lieu de compter sur
           align-items:center seul pour masquer des hauteurs Bootstrap différentes — garantit un
           alignement pixel-perfect indépendant des paddings/line-height par défaut. flex-shrink:0
           sur "Réinitialiser" : demande explicite "le label Réinitialiser doit être visible par
           défaut" — évite qu'il soit repoussé hors champ par flex-wrap sur une largeur réduite. -->
      <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:12px;">
        <div>${cablageDcModeToggleHTML(model)}</div>
        <div>${cablageDcPolarityToggleHTML(model)}</div>
        <div>${cablageDcDirectionToggleHTML(model)}</div>
        <label style="font-size:0.8rem; height:34px; box-sizing:border-box; display:flex; align-items:center; gap:6px;">
          <input type="checkbox" id="cablageDcShowChainesCheckbox" ${view.showChaines !== false ? 'checked' : ''} /> Afficher les chaînes
        </label>
        <!-- CORRECTIF (demande explicite : "rendre le label Réinitialiser toujours visible") :
             flex-shrink:0 (round précédent) empêche le bouton de RÉTRÉCIR, mais sans white-space:
             nowrap son texte pouvait se répartir sur 2 lignes/être tronqué dans un conteneur flex
             étroit avant même que flex-shrink n'entre en jeu. -->
        <button type="button" class="btn btn-outline-danger" id="cablageDcResetBtn" style="height:34px; box-sizing:border-box; padding:0 14px; font-size:0.8rem; flex-shrink:0; white-space:nowrap;">Réinitialiser</button>
        <!-- NOUVEAU (demande explicite : "ajouter l'action d'export PDF dans le modal de plan de
             câblage") : même mécanique minimale que calepinage_maison_dessin.js::
             exportCanvasEtCartePdf() (canvas.toDataURL + jsPDF déjà chargé globalement), simplifiée à
             une seule page (le canevas de câblage seul, pas de capture de carte). -->
        <button type="button" class="btn btn-sm" id="cablageDcExportBtn" title="Exporter le plan de câblage" style="height:34px; box-sizing:border-box; padding:0 14px; font-size:0.8rem; flex-shrink:0; background:#1E8449; color:#fff; border-color:#1E8449; display:flex; align-items:center; gap:6px;">
          <img src="/static/concevoir_mon_projet/medias/icons/pdf-export.svg" alt="" style="width:16px; height:16px; vertical-align:middle;"> Exporter le plan de câblage
        </button>
      </div>

      <div id="cablageDcManualHint" style="display:${model.mode === 'manual' ? 'block' : 'none'}; font-size:0.8rem; color:#0f766e; margin-bottom:8px;">
        Mode manuel : cliquez les panneaux dans l'ordre de câblage. Chaque chaîne se ferme automatiquement une fois sa taille atteinte. Cliquer un panneau déjà assigné annule à partir de celui-ci.
      </div>

      <!-- CORRECTIF (demande explicite : "mettre le tableau d'affectation des strings À CÔTÉ du
           canevas, plan + tableau côte à côte") : la colonne de droite est élargie (280px) et
           contient les 2 cartes de config PUIS le tableau d'affectation MPPT (avec bouton
           Masquer/Afficher). Le canevas garde la priorité de largeur (flex 2/1). -->
      <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
        <div style="flex:2 1 480px; min-width:300px;">
          <canvas id="cablageDcCanvas" width="1100" height="620" style="width:100%; border:1px solid #dee2e6; border-radius:6px; background:#fff; cursor:${model.mode === 'manual' ? 'pointer' : 'default'};"></canvas>
        </div>
        <div style="flex:1 1 300px; min-width:290px; display:flex; flex-direction:column; gap:10px;">
          ${window.chainesPertesMetricCard('Config. PV utilisateur', userConfigText || '<em style="font-weight:400; color:#6c757d;">Non saisie</em>')}
          ${window.chainesPertesMetricCard('Config. automatique', autoConfigText)}
          ${renderMpptTableHTML(view)}
        </div>
      </div>

      <div style="margin-top:18px;">${renderCablageTableHTML(view)}</div>
    </div>
  `;

  wireCablageDcSection(view);
};

// NOUVEAU (demande explicite : "ajouter l'action d'export PDF dans le modal de plan de câblage") :
// même mécanique minimale que calepinage_maison_dessin.js::exportCanvasEtCartePdf()
// (canvas.toDataURL('image/png') + jsPDF déjà chargé globalement dans l'app, window.jspdf).
// CORRECTIF (demande explicite : "ajouter le tableau des métrés dans l'export PDF, il manque le
// tableau") : 2e page ajoutée après le plan, avec le même contenu que le tableau HTML
// (renderCablageTableHTML) — colonnes, lignes par chaîne et ligne de totaux — via jspdf-autotable,
// déjà chargé globalement par index.html (cf. doc.autoTable, même convention que les autres
// générateurs PDF de l'appli, ex. PdfSystemPageGenerator.js).
// Aperçu avant téléchargement (services/PdfPreview.js, exposé par menu.html) ; téléchargement direct
// si la visionneuse n'est pas chargée.
async function exportCablageDcPdf(view) {
  const canvas = view && view.canvas;
  if (!canvas || !window.jspdf) {
    console.warn('[exportCablageDcPdf] canvas ou jsPDF indisponible.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
  ecrirePagesCablageDc(doc, view);
  apercuPdfCablageDc(doc, `cablage-dc-${view.field.subPvId}.pdf`);
}

function apercuPdfCablageDc(doc, nomFichier) {
  if (typeof window.ouvrirApercuPdf === 'function') {
    window.ouvrirApercuPdf(doc.output('blob'), nomFichier, { titre: 'Prévisualisation — Plan de câblage DC' });
  } else {
    doc.save(nomFichier);
  }
}

// Pages d'un pan (plan, répartition par onduleur, métrés), à partir de la page courante du document.
function ecrirePagesCablageDc(doc, view) {
  const canvas = view.canvas;
  const canvasDataUrl = canvas.toDataURL('image/png');
  const canvasW = canvas.width, canvasH = canvas.height;

  const margin = 10;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - 2 * margin;
  const usableHeight = pageHeight - 2 * margin - 6;

  const mpptSpec = view.model.strings.length ? getEffectiveMpptSpec(view) : null;
  const hasMppt = !!mpptSpec;
  // CORRECTIF (demande explicite : "le tableau des strings dans le PDF est toujours sur 2 pages" +
  // "il faut une page avec la répartition des strings par onduleur dans le rapport") : le strip MPPT
  // ne partage plus la page 1 avec l'image (ancienne cause du débordement — il devait se disputer la
  // hauteur restante avec l'image, jamais assez de marge dans tous les cas) ; il devient sa PROPRE
  // page dédiée (cf. addCablageDcOnduleurRepartitionPage), juste après le plan — l'image profite donc
  // de TOUTE la hauteur de la page 1.
  const capacityMsg = mpptSpec ? cablageDcCapacityWarningMessage(mpptSpec, view.model.strings.length) : null;
  let warningLines = [];
  if (capacityMsg) {
    doc.setFontSize(7.5);
    warningLines = doc.splitTextToSize(capacityMsg, usableWidth);
  }
  const warningReserve = warningLines.length ? warningLines.length * 3.2 + 2 : 0;
  const imgAreaHeight = Math.max(60, usableHeight - warningReserve);

  // Même logique de conservation du ratio que exportCanvasEtCartePdf() ; calé en haut de la zone.
  const ratio = canvasH / canvasW;
  let drawW = usableWidth, drawH = drawW * ratio;
  if (drawH > imgAreaHeight) { drawH = imgAreaHeight; drawW = drawH / ratio; }
  const x = margin + (usableWidth - drawW) / 2;
  const y = margin + 6 + warningReserve;

  doc.setFontSize(12);
  doc.text(`Plan de câblage DC — Pan : ${view.field.subPvId}`, margin, margin);
  if (warningLines.length) {
    doc.setFontSize(7.5);
    doc.setTextColor(180, 83, 9);
    warningLines.forEach((line, i) => doc.text(line, margin, margin + 4 + i * 3.2));
    doc.setTextColor(0);
    doc.setFontSize(12);
  }
  doc.addImage(canvasDataUrl, 'PNG', x, y, drawW, drawH, undefined, 'FAST');

  if (hasMppt) {
    doc.addPage();
    addCablageDcOnduleurRepartitionPage(doc, view, margin, mpptSpec);
  }

  // CORRECTIF (demande explicite) : le tableau des métrés des strings démarre TOUJOURS sur une
  // NOUVELLE page — jamais sur la même page que le plan de câblage.
  doc.addPage();
  addCablageDcTablePage(doc, view, margin, margin);
}

/**
 * Câblage des pans du projet hors de la modale « Chaînes et pertes », dans le même contexte que son
 * ouverture (openChainesPertesModal) : modale créée sans être affichée — le calcul des chaînes lit
 * ses réglages (températures, coef. de surdimensionnement) dans ses champs —, équipements repris du
 * projet, câblage enregistré dans le calepinage (CM.state.cablageDc) et configuration des chaînes
 * enregistrée (cache local du projet). Renvoie, pour chaque pan câblé, la vue prête à dessiner : le
 * mode automatique est recalculé, le mode manuel repris tel qu'enregistré ; un pan sans aucune
 * chaîne (chaînes non dimensionnées) est écarté.
 */
function vuesCablageDcHorsModale(fields) {
  if (!Array.isArray(fields) || !fields.length) return [];
  createChainesPertesModal();
  reinitialiserSiProjetChange();
  const coefEl = document.getElementById('chainesPertesCoefSurdim');
  if (coefEl) coefEl.value = getCoefSurdimensionnement();
  // Résolution des onduleurs (MPPT) : lit __chainesPertesGlobal.fields, comme verifierAvantCalcul.
  const g = window.__chainesPertesGlobal;
  const fieldsPrecedents = g.fields;
  g.fields = fields;
  try {
    hydrateEquipmentFromHostFields();
    return fields.map((field) => {
      const resolved = resolveFieldToPan(field);
      if (!resolved) return null;
      const panels = panelsOfResolvedField(resolved);
      if (!panels.length) return null;
      const model = getOrCreateCablageModel(resolved.state, resolved.pan, resolved.cleCablage);
      const stringSizes = getStringSizesForField(field);
      if (model.mode !== 'manual') {
        model.strings = orientStringsHorizontally(assignStringsAutomatically(panels, stringSizes), panels, model.chainDirection);
      }
      if (!model.strings.length) return null;
      return { field, pan: resolved.pan, state: resolved.state, model, panels, stringSizes, showChaines: true };
    }).filter(Boolean);
  } finally {
    g.fields = fieldsPrecedents;
  }
}

/** Au moins un pan câblé (chaînes dimensionnées) : le plan de câblage peut être exporté. */
window.planCablageDcDisponible = function (fields) {
  return vuesCablageDcHorsModale(fields).length > 0;
};

/**
 * Plan de câblage de tous les pans du projet, sans ouvrir la modale « Chaînes et pertes » (palette
 * des exports du pompage solaire) : chaque pan est redessiné sur un canevas hors écran, avec le même
 * câblage que la vue mono-pan, puis ses pages sont ajoutées les unes à la suite des autres. Ouvre
 * l'aperçu ; renvoie false si aucun pan n'est câblé.
 *
 * @param {Array} fields champs PV du projet (même format qu'openChainesPertesModal)
 */
window.exporterPlanCablageDcProjet = function (fields) {
  if (!window.jspdf) return false;
  const g = window.__chainesPertesGlobal;
  const fieldsPrecedents = g.fields;
  const vues = vuesCablageDcHorsModale(fields);
  if (!vues.length) return false;
  vues.forEach((view) => {
    view.canvas = document.createElement('canvas');
    view.canvas.width = 1100;
    view.canvas.height = 620;
    view.ctx = view.canvas.getContext('2d');
    drawCablageCanvas(view);
  });
  g.fields = fields;
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });
    vues.forEach((view, i) => {
      if (i > 0) doc.addPage();
      ecrirePagesCablageDc(doc, view);
    });
    const suffixe = vues.length === 1 ? vues[0].field.subPvId : 'projet';
    apercuPdfCablageDc(doc, `cablage-dc-${suffixe}.pdf`);
    return true;
  } finally {
    g.fields = fieldsPrecedents;
  }
};

// NOUVEAU (demande explicite : "le tableau des strings de chaque onduleur doit toujours être sur une
// seule page") : jspdf-autotable ajoute silencieusement sa propre page (doc.addPage() interne) dès
// que le contenu dépasse la hauteur restante de la page courante — comportement correct en général
// mais qui casse ici la mise en page "1 page = 1 contenu" voulue (le tableau MPPT doit rester sous le
// plan, page 1 ; le tableau des métrés doit rester seul sur sa page). On calcule donc, AVANT d'appeler
// doc.autoTable, la police/le padding minimaux (par paliers décroissants) qui garantissent que le
// contenu tient dans la hauteur disponible — plutôt que de laisser autoTable décider seul.
const CABLAGE_DC_AUTOTABLE_FIT_TIERS = [
  { fontSize: 9, cellPadding: 2 },
  { fontSize: 8, cellPadding: 1.5 },
  { fontSize: 7.5, cellPadding: 1.3 },
  { fontSize: 7, cellPadding: 1.1 },
  { fontSize: 6.5, cellPadding: 0.9 },
  { fontSize: 6, cellPadding: 0.7 },
];
// `estimateHeightFn(tier)` renvoie la hauteur totale projetée (mm) pour ce palier de police/padding —
// laissé à la charge de l'appelant car la formule diffère entre un tableau à N lignes simples
// (métrés) et un tableau à plusieurs blocs de 3 lignes empilés (répartition MPPT).
function pickCablageDcAutoTableFitTier(estimateHeightFn, availableHeightMM) {
  for (const tier of CABLAGE_DC_AUTOTABLE_FIT_TIERS) {
    if (estimateHeightFn(tier) <= availableHeightMM) return tier;
  }
  return CABLAGE_DC_AUTOTABLE_FIT_TIERS[CABLAGE_DC_AUTOTABLE_FIT_TIERS.length - 1];
}
function autoTableRowHeightMM(tier) {
  return tier.fontSize * 0.3528 * 1.15 + tier.cellPadding * 2;
}

// CORRECTIF (demande explicite : "le tableau des strings dans le PDF est toujours sur 2 pages" + "il
// faut une page avec la répartition des strings par onduleur dans le rapport") : refonte complète —
// l'ancienne version (addCablageDcMpptStripPage1) partageait la page 1 avec le plan (disposition
// horizontale par entrée PV, un onduleur unique implicite) et devait constamment lutter pour sa place
// avec l'image, quel que soit le nombre d'onduleurs. Remplacée par une page DÉDIÉE (toujours appelée
// juste après un doc.addPage(), donc toujours en haut d'une page neuve — jamais mélangée au plan),
// avec UNE sous-section par onduleur physique (même répartition que le tableau des métrés, cf.
// partitionStringsByOnduleurUnit — cohérent avec l'écran, cf. renderMpptTableHTML) — numérotation
// PV/MPPT LOCALE à chaque onduleur (position dans son groupe), pas une numérotation continue qui
// n'aurait aucun sens physique au-delà d'un onduleur.
function addCablageDcOnduleurRepartitionPage(doc, view, margin, spec) {
  if (typeof doc.autoTable !== 'function' || !spec || !spec.nbMppt) return;
  const model = view.model;
  const { groups, overflow } = partitionStringsByOnduleurUnit(model, spec, view.field);
  const per = spec.perMppt || 2;

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFontSize(12);
  doc.text(`Répartition des chaînes par onduleur — Pan : ${view.field.subPvId}`, margin, margin);
  doc.setFontSize(8.5);
  doc.setTextColor(100);
  const refLabel = spec.ref ? spec.ref : 'Onduleur non reconnu';
  doc.text(`${refLabel} — ${spec.nbMppt} MPPT × ${per} entrée${per > 1 ? 's' : ''} PV, ${spec.nbOnduleurs} onduleur${spec.nbOnduleurs > 1 ? 's' : ''}, ${spec.totalCapacity} chaînes max au total`, margin, margin + 4.5);
  doc.setTextColor(0);

  // CORRECTIF (demande explicite : "afficher tous les MPPT que possède l'onduleur, y compris dans
  // l'export — noter vide pour un MPPT non utilisé, en automatique comme en personnalisé") :
  // buildOnduleurSlotRows liste TOUJOURS les `spec.nbPvInputs` créneaux PV/MPPT de chaque onduleur
  // (pas seulement les créneaux occupés) — un créneau libre devient une ligne "PVn - Vide". S'applique
  // uniformément, qu'il y ait 1 seul onduleur (cette page est désormais toujours générée, cf.
  // exportCablageDcPdf) ou plusieurs.
  const sectionRow = (label) => [{ content: label, colSpan: 3, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 118, 110], halign: 'left' } }];
  const body = [];
  groups.forEach((g) => {
    const slotRows = buildOnduleurSlotRows(model, g, spec);
    body.push(sectionRow(`Onduleur #${g.unit}${spec.ref ? ' — ' + spec.ref : ''} (${g.indices.length}/${spec.nbPvInputs} chaînes)`));
    slotRows.forEach(({ slot, mpptNum, si }) => {
      // Créneau libre : colonne String vierge, "vide" accolé au n° PV.
      body.push(si !== null
        ? [`S${si + 1}`, `PV${slot}`, `MPPT ${mpptNum}`]
        : ['', `PV${slot} - Vide`, `MPPT ${mpptNum}`]);
    });
  });
  if (overflow.length) {
    body.push(sectionRow(`Hors capacité — capacité MPPT totale insuffisante (${overflow.length} chaîne${overflow.length > 1 ? 's' : ''})`));
    overflow.forEach((si) => body.push([`S${si + 1}`, '—', '—']));
  }
  if (!body.length) return;

  const tableGap = 7;
  const startY = margin + tableGap;
  const availableHeight = pageHeight - startY - margin;
  const tier = pickCablageDcAutoTableFitTier((t) => (body.length + 1) * autoTableRowHeightMM(t), availableHeight);

  doc.autoTable({
    startY,
    head: [['String', 'N° PV', 'MPPT']],
    body,
    theme: 'grid',
    margin: { left: margin, right: margin },
    styles: { fontSize: tier.fontSize, font: 'helvetica', cellPadding: tier.cellPadding, textColor: [0, 0, 0], lineColor: [200, 200, 200], lineWidth: 0.2, halign: 'center' },
    headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
  });
}

// Construit les mêmes données que renderCablageTableHTML (colonnes de base + colonnes
// personnalisées + ligne de totaux).
// CORRECTIF (demande explicite : "l'image du plan de câblage et le tableau des strings doivent être
// chacun sur une page à eux, ne jamais les mélanger") : appelée désormais TOUJOURS juste après un
// doc.addPage() fait par l'appelant (exportCablageDcPdf) — `startY` vaut donc toujours `margin`, en
// haut d'une page neuve. Le repli ci-dessous (nouvelle page si `startY` déjà trop bas) est conservé
// comme filet de sécurité pur, mais ne devrait plus jamais se déclencher en pratique. jspdf-autotable
// continue lui-même automatiquement sur une page suivante (en-tête répété) si le tableau est trop
// long pour tenir sur une seule page — rien n'est jamais coupé.
function addCablageDcTablePage(doc, view, margin, startY) {
  if (typeof doc.autoTable !== 'function') {
    console.warn('[exportCablageDcPdf] jspdf-autotable indisponible — tableau des métrés omis du PDF.');
    return;
  }
  const { model, panels } = view;
  ensureLengthsRows(model, model.strings, panels);
  const customCols = model.customColumns || [];
  const removed = model.removedBaseCols || [];
  const stats = computeGlobalStats(model);
  const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : `${Number(v).toFixed(1)} ml`);

  // Mêmes colonnes / même ordre que renderCablageTableHTML (Total S+/S- toujours en dernier,
  // Desc./Chem. masquables via removedBaseCols).
  const cols = [
    { label: 'N° des strings', cell: (row, si) => `S${si + 1}`, foot: `Total (${stats.totalChains} chaîne${stats.totalChains > 1 ? 's' : ''})` },
    { label: 'Long. (S+)', cell: (row) => `${(Number(row.plus) || 0).toFixed(1)} ml`, foot: '' },
    { label: 'Long. (S-)', cell: (row) => `${(Number(row.minus) || 0).toFixed(1)} ml`, foot: '' },
  ];
  if (!removed.includes('descente')) cols.push({ label: 'Desc. verticale', cell: (row) => fmt(row.descente), foot: '' });
  if (!removed.includes('cheminement')) cols.push({ label: 'Chem. horizontal', cell: (row) => fmt(row.cheminement), foot: '' });
  customCols.forEach((c) => cols.push({ label: c.label, cell: (row) => fmt((row.custom || {})[c.id]), foot: '' }));
  cols.push({ label: 'Total (S+)', cell: (row, si, t) => `${t.totalPlus.toFixed(1)} ml`, foot: `${stats.totalPlusSum.toFixed(1)} ml` });
  cols.push({ label: 'Total (S-)', cell: (row, si, t) => `${t.totalMinus.toFixed(1)} ml`, foot: `${stats.totalMinusSum.toFixed(1)} ml` });

  const head = [cols.map((c) => c.label)];
  const buildBodyRow = (si) => {
    const row = model.lengths[si] || { plus: 0, minus: 0, descente: null, cheminement: null, custom: {} };
    const rowTotals = computeRowTotals(row);
    return cols.map((c) => c.cell(row, si, rowTotals));
  };
  const sectionRow = (label) => [{ content: label, colSpan: cols.length, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 118, 110], halign: 'left' } }];

  // NOUVEAU (demande explicite : "mentionner la référence de l'onduleur ; s'il y a plusieurs
  // onduleurs, ajouter des sous-sections par onduleur — on garde le total pour l'ensemble des
  // onduleurs") : même logique de répartition que renderCablageTableHTML (écran) — voir
  // partitionStringsByOnduleurUnit. La ligne de totaux, poussée APRÈS ces sous-sections, reste la
  // somme de TOUTES les chaînes, tous onduleurs confondus (stats.totalPlusSum/totalMinusSum).
  const spec = getEffectiveMpptSpec(view);
  let body;
  if (spec.nbOnduleurs > 1 && model.strings.length) {
    const { groups, overflow } = partitionStringsByOnduleurUnit(model, spec, view.field);
    body = [];
    groups.filter((g) => g.indices.length).forEach((g) => {
      body.push(sectionRow(`Onduleur #${g.unit}${spec.ref ? ' — ' + spec.ref : ''}`));
      g.indices.forEach((si) => body.push(buildBodyRow(si)));
    });
    if (overflow.length) {
      body.push(sectionRow('Hors capacité — capacité MPPT totale insuffisante'));
      overflow.forEach((si) => body.push(buildBodyRow(si)));
    }
  } else {
    body = model.strings.map((s, si) => buildBodyRow(si));
  }

  // Ligne de totaux (même contenu que le <tfoot> HTML, cf. renderCablageTableHTML).
  body.push(cols.map((c) => c.foot));

  const pageHeight = doc.internal.pageSize.getHeight();
  let tableStartY = startY;
  if (!Number.isFinite(tableStartY) || tableStartY > pageHeight - margin - 20) {
    doc.addPage();
    tableStartY = margin;
  }
  doc.setFontSize(12);
  doc.text(`Tableau des métrés des câbles DC — Pan : ${view.field.subPvId}`, margin, tableStartY);

  const onduleurRefLabel = spec.ref ? spec.ref : (spec.source === 'fallback' ? 'Non sélectionné' : 'Non reconnu dans le catalogue');
  const refLine = `Onduleur : ${onduleurRefLabel}` + (spec.nbOnduleurs > 1 ? ` — ${spec.nbOnduleurs} unités, ${spec.nbPvInputs} chaînes max/unité` : '');
  doc.setFontSize(8.5);
  doc.setTextColor(100);
  doc.text(refLine, margin, tableStartY + 4.5);
  doc.setTextColor(0);

  // CORRECTIF (demande explicite : "le tableau ... doit toujours être sur une seule page, remonter un
  // peu le tableau pour que tout soit sur la même page") : palier de police/padding choisi pour que
  // l'intégralité du corps (+ en-tête + ligne de totaux, déjà incluse dans `body`) tienne dans la
  // hauteur restante de CETTE page — évite qu'un champ PV à nombreuses chaînes ne fasse déborder le
  // tableau sur une 2e page via la pagination automatique de jspdf-autotable. tableGap élargi (3 → 7)
  // pour laisser la place à la nouvelle ligne "Onduleur : …".
  const tableGap = 7;
  const availableHeight = pageHeight - (tableStartY + tableGap) - margin;
  const tier = pickCablageDcAutoTableFitTier(
    (t) => (body.length + 1) * autoTableRowHeightMM(t),
    availableHeight,
  );

  doc.autoTable({
    startY: tableStartY + tableGap,
    head,
    body,
    theme: 'grid',
    margin: { left: margin, right: margin },
    // CORRECTIF (demande explicite : "centrer les données dans le tableau des métrés câblage DC dans
    // le rapport PDF") : halign ajouté (absent jusqu'ici — seul headStyles avait halign:'center', les
    // cellules de corps restaient alignées à gauche, comportement par défaut de jspdf-autotable).
    styles: { fontSize: tier.fontSize, font: 'helvetica', cellPadding: tier.cellPadding, textColor: [0, 0, 0], lineColor: [200, 200, 200], lineWidth: 0.2, halign: 'center' },
    headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    didParseCell: (data) => {
      // Met en évidence la ligne de totaux (dernière ligne du corps), même esprit visuel que le
      // <tfoot> HTML (font-weight:bold + bordure supérieure marquée).
      if (data.section === 'body' && data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });
}

// 2026-10-09 (demande explicite : "ajouter une icône de zoom sur le visuel du plan de câblage pour
// agrandir le graphique") : loupe en haut à droite du canevas -> le bloc du canevas passe en plein
// écran (calque fixe, proportions 1100x620 conservées, redessin net : c'est le MÊME canevas, en
// CSS). Retour à la vue normale : ✕, Échap ou clic sur le fond. Le canevas reste interactif (mode
// manuel : les clics passent par getBoundingClientRect). Comme renderCablageDcSection reconstruit
// tout le HTML à chaque clic du mode manuel, l'état est gardé ici et réappliqué à chaque câblage.
let cablageZoomActif = false;

function appliquerZoomCablage(bloc, canvas, bouton) {
  const actif = cablageZoomActif && bloc.isConnected;
  bloc.style.cssText = actif
    ? 'position:fixed; inset:0; z-index:100000; background:rgba(15,23,42,0.85); display:flex;'
      + ' align-items:center; justify-content:center; padding:2vh 2vw;'
    : 'position:relative;';
  canvas.style.width = actif
    ? `min(96vw, calc(92vh * ${(canvas.width / canvas.height).toFixed(4)}))` : '100%';
  bouton.innerHTML = actif ? '<i class="fas fa-times"></i>' : '<i class="fas fa-search-plus"></i>';
  bouton.title = actif ? 'Revenir à la vue normale (Échap)' : 'Agrandir le plan de câblage';
  bouton.style.cssText = `position:${actif ? 'fixed' : 'absolute'}; top:${actif ? '14px' : '8px'};`
    + ` right:${actif ? '18px' : '8px'}; z-index:100001; width:34px; height:34px; border-radius:6px;`
    + ' border:1px solid #cbd5e1; background:#fff; color:#334155; cursor:pointer;'
    + ' display:flex; align-items:center; justify-content:center; box-shadow:0 1px 4px rgba(0,0,0,0.25);';
}

function installerZoomCablage(canvas) {
  const bloc = canvas && canvas.parentElement;
  if (!bloc) return;
  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'cablage-dc-zoom-btn';
  bloc.appendChild(bouton);
  const basculer = (valeur) => {
    cablageZoomActif = valeur;
    appliquerZoomCablage(bloc, canvas, bouton);
  };
  bouton.addEventListener('click', (e) => { e.stopPropagation(); basculer(!cablageZoomActif); });
  // Clic sur le fond du calque (hors canevas) : retour à la vue normale.
  bloc.addEventListener('click', (e) => { if (cablageZoomActif && e.target === bloc) basculer(false); });
  bloc.__basculerZoomCablage = basculer;
  appliquerZoomCablage(bloc, canvas, bouton);
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !cablageZoomActif) return;
  const canvas = document.getElementById('cablageDcCanvas');
  const bloc = canvas && canvas.parentElement;
  if (bloc && typeof bloc.__basculerZoomCablage === 'function') {
    e.preventDefault();
    e.stopImmediatePropagation();   // Échap ne ferme que le zoom, pas le modal
    bloc.__basculerZoomCablage(false);
  } else {
    cablageZoomActif = false;
  }
}, true);

// Le modal refermé en vue agrandie ne doit pas se rouvrir en plein écran (chaines_pertes_modal.js est
// chargé avant ce fichier, cf. menu.html).
if (typeof window.closeChainesPertesModal === 'function') {
  const fermerChainesPertesModal = window.closeChainesPertesModal;
  window.closeChainesPertesModal = function (...args) {
    cablageZoomActif = false;
    return fermerChainesPertesModal.apply(this, args);
  };
}

// NOUVEAU (extraction, vue combinée multi-pans) : partie du rendu/interaction STRICTEMENT propre au
// canevas mono-pan (back button + création/dessin/clic du canevas) — séparée de
// wireCablageDcBodyControls (mode/polarité/checkbox/reset/export/colonnes/MPPT/longueurs, réutilisée
// TELLE QUELLE par la vue combinée, cf. wireCablageDcCanvasCombined qui gère son PROPRE canevas
// partagé à la place de celle-ci). wireCablageDcSection (plus bas) recombine les deux — comportement
// mono-pan strictement inchangé.
function wireCablageDcCanvas(view) {
  document.getElementById('cablageDcBackBtn').addEventListener('click', () => {
    window.__chainesPertesGlobal.activeView = 'default';
    renderChainesPertesModal();
  });

  const canvas = document.getElementById('cablageDcCanvas');
  view.canvas = canvas;
  view.ctx = canvas.getContext('2d');
  drawCablageCanvas(view);
  installerZoomCablage(canvas);

  canvas.addEventListener('click', (evt) => {
    if (view.model.mode !== 'manual') return;
    const meterPt = canvasEventToMeter(view, evt);
    const hit = view.panels.find((p) => pointInRotatedRectLocal(meterPt, p));
    if (!hit) return;
    handleManualPanelClick(view.model, view.stringSizes, hit.panelIndex);
    persistAndPropagate(view);
    window.renderCablageDcSection(view.field);
  });
}

// NOUVEAU (vue combinée multi-pans) : redessine le bon canevas selon le contexte — le canevas
// COMBINÉ (tous les pans) si `view` fait partie d'une vue combinée actuellement affichée, sinon le
// canevas mono-pan habituel (drawCablageCanvas, inchangé). Seul point d'appel modifié pour supporter
// les deux contextes : la checkbox "Afficher les chaînes" ci-dessous (wireCablageDcBodyControls),
// qui redessinait auparavant TOUJOURS drawCablageCanvas(view) directement.
function redrawCablageDcCanvas(view) {
  const combined = window.__cablageDcViewsCombined;
  if (combined && combined.byId && combined.byId[view.field.subPvId] === view) {
    drawCablageCanvasCombined(combined);
  } else {
    drawCablageCanvas(view);
  }
}

function wireCablageDcBodyControls(view) {
  document.getElementById('cablageDcModeAuto').addEventListener('click', () => {
    if (view.model.mode === 'auto') return;
    view.model.mode = 'auto';
    persistAndPropagate(view);
    window.renderCablageDcSection(view.field);
  });
  document.getElementById('cablageDcModeManual').addEventListener('click', () => {
    if (view.model.mode === 'manual') return;
    view.model.mode = 'manual';
    // On conserve les chaînes déjà calculées en auto comme point de départ (l'utilisateur peut
    // continuer à cliquer pour corriger, plutôt que de tout perdre en changeant de mode).
    persistAndPropagate(view);
    window.renderCablageDcSection(view.field);
  });

  // NOUVEAU (demande explicite : sélecteur de polarité de départ, point 5) : bascule purement
  // visuelle (cf. drawCablageCanvas) — même pattern que le toggle Automatique/Manuel ci-dessus.
  document.getElementById('cablageDcPolarityPlus').addEventListener('click', () => {
    if (view.model.startPolarity !== 'minus') return;
    view.model.startPolarity = 'plus';
    persistAndPropagate(view);
    window.renderCablageDcSection(view.field);
  });
  document.getElementById('cablageDcPolarityMinus').addEventListener('click', () => {
    if (view.model.startPolarity === 'minus') return;
    view.model.startPolarity = 'minus';
    persistAndPropagate(view);
    window.renderCablageDcSection(view.field);
  });

  // NOUVEAU : direction des chaînes (mode auto) — le rendu réapplique orientStringsHorizontally.
  document.querySelectorAll('.cablageDcDirectionBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.dir;
      if ((view.model.chainDirection || 'libre') === dir) return;
      view.model.chainDirection = dir;
      persistAndPropagate(view);
      window.renderCablageDcSection(view.field);
    });
  });

  document.getElementById('cablageDcShowChainesCheckbox').addEventListener('change', (e) => {
    view.showChaines = e.target.checked;
    redrawCablageDcCanvas(view);
  });

  document.getElementById('cablageDcResetBtn').addEventListener('click', () => {
    view.model.strings = [];
    view.model.lengths = [];
    persistAndPropagate(view);
    window.renderCablageDcSection(view.field);
  });

  const exportBtn = document.getElementById('cablageDcExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      const originalHTML = exportBtn.innerHTML;
      exportBtn.innerHTML = 'Export en cours…';
      try {
        await exportCablageDcPdf(view);
      } catch (err) {
        console.error('[cablageDcExportBtn] Échec de l\'export PDF :', err);
      } finally {
        exportBtn.disabled = false;
        exportBtn.innerHTML = originalHTML;
      }
    });
  }

  const addColBtn = document.getElementById('cablageDcAddColumnBtn');
  const addColForm = document.getElementById('cablageDcAddColumnForm');
  if (addColBtn && addColForm) {
    addColBtn.addEventListener('click', () => { addColForm.style.display = 'inline-block'; addColBtn.style.display = 'none'; });
    // CORRECTIF (demande explicite : "valider le champ de saisie 'Ajouter une colonne de longueur',
    // 5 mots max et 30 caractères") : validation dédiée (même pattern que window.ChainesPertesValidation
    // ailleurs dans ce module — pas de fonction générique adaptée à une règle "nombre de mots", donc
    // écrite ici localement) — bloque l'ajout et affiche un message clair tant que non valide.
    const validateNewColLabel = (raw) => {
      const label = (raw || '').trim();
      if (!label) return { valid: false, message: 'Le nom de la colonne est requis.' };
      if (label.length > 30) return { valid: false, message: `30 caractères maximum (${label.length} saisis).` };
      const wordCount = label.split(/\s+/).filter(Boolean).length;
      if (wordCount > 5) return { valid: false, message: `5 mots maximum (${wordCount} saisis).` };
      return { valid: true, label };
    };
    const newColLabelInput = document.getElementById('cablageDcNewColLabel');
    const newColLabelError = document.getElementById('cablageDcNewColLabelError');
    if (newColLabelInput) {
      newColLabelInput.addEventListener('input', () => {
        const result = validateNewColLabel(newColLabelInput.value);
        const showError = !result.valid && newColLabelInput.value.trim() !== '';
        newColLabelInput.style.borderColor = showError ? '#dc3545' : '';
        if (newColLabelError) {
          newColLabelError.style.display = showError ? 'block' : 'none';
          newColLabelError.textContent = showError ? result.message : '';
        }
      });
    }
    document.getElementById('cablageDcAddColumnConfirm').addEventListener('click', () => {
      const labelInput = document.getElementById('cablageDcNewColLabel');
      const errorEl = document.getElementById('cablageDcNewColLabelError');
      const result = validateNewColLabel(labelInput.value);
      if (!result.valid) {
        labelInput.style.borderColor = '#dc3545';
        if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = result.message; }
        return;
      }
      view.model.customColumns = view.model.customColumns || [];
      view.model.customColumns.push({ id: `custom_${Date.now()}`, label: result.label });
      persistAndPropagate(view);
      window.renderCablageDcSection(view.field);
    });
  }

  // NOUVEAU (demande explicite : "l'utilisateur peut supprimer si besoin les colonnes Desc. Vertical
  // / Chem. et ajouter d'autres colonnes ; prévoir aussi un bouton pour supprimer une colonne
  // ajoutée") : croix dans l'en-tête pour Desc./Chem./colonnes perso. Supprimer une colonne efface
  // aussi ses valeurs saisies (cohérent avec la suppression d'une colonne perso) — pour Desc./Chem.
  // la colonne reste rétablissable (bouton dédié), les valeurs sont alors à ressaisir.
  document.querySelectorAll('#cablageDcMetresTable .cablageDcRemoveColBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const token = btn.getAttribute('data-col');
      const m = view.model;
      if (token === 'descente' || token === 'cheminement') {
        m.removedBaseCols = m.removedBaseCols || [];
        if (!m.removedBaseCols.includes(token)) m.removedBaseCols.push(token);
        (m.lengths || []).forEach((row) => { row[token] = null; });
      } else if (token.startsWith('custom:')) {
        const id = token.slice('custom:'.length);
        m.customColumns = (m.customColumns || []).filter((c) => c.id !== id);
        (m.lengths || []).forEach((row) => { if (row.custom) delete row.custom[id]; });
      }
      persistAndPropagate(view);
      window.renderCablageDcSection(view.field);
    });
  });

  document.querySelectorAll('.cablageDcRestoreColBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const token = btn.getAttribute('data-col');
      const m = view.model;
      m.removedBaseCols = (m.removedBaseCols || []).filter((t) => t !== token);
      persistAndPropagate(view);
      window.renderCablageDcSection(view.field);
    });
  });

  wireMpptTable(view);
  wireLengthInputs(view);
}

// Recombine les deux parties ci-dessus — comportement mono-pan strictement inchangé par rapport à
// l'ancien wireCablageDcSection (extraction pure, cf. wireCablageDcCanvas plus haut).
function wireCablageDcSection(view) {
  wireCablageDcCanvas(view);
  wireCablageDcBodyControls(view);
}

// ---------------------------------------------------------------------------------------------
// Vue combinée multi-pans (NOUVEAU, demande explicite : "afficher tous les pans en même temps... la
// vision entière du bâtiment", pour une toiture Bipente symétrique/asymétrique/4 pans). Le schéma
// (canevas) montre TOUS les pans à la fois, positionnés selon leur géométrie réelle (cf.
// drawCablageCanvasCombined). En dessous, un onglet par pan bascule quel tableau de
// métrés/MPPT/contrôles (mode/polarité/export/colonnes) est affiché — réutilise TEL QUEL
// wireCablageDcBodyControls/renderCablageTableHTML/renderMpptTableHTML/wireMpptTable/
// wireLengthInputs (un seul jeu d'identifiants dans le DOM à la fois, comme le mode mono-pan —
// aucune collision d'id, cf. décision actée avec l'utilisateur). Un clic sur un panneau du schéma
// combiné (mode manuel) bascule automatiquement l'onglet actif sur le pan cliqué.
// ---------------------------------------------------------------------------------------------

// Point d'entrée principal (symétrique de window.renderCablageDcSection ci-dessus), appelé depuis
// chaines_pertes_modal.js quand window.__chainesPertesGlobal.activeCablagePans est défini.
window.renderCablageDcSectionCombined = function (pans) {
  const container = document.getElementById('chainesPertesCablageSection');
  if (!container || !pans || !pans.length) return;

  const resolvedList = pans.map((field) => {
    const resolved = resolveFieldToPan(field);
    return resolved ? { field, pan: resolved.pan, state: resolved.state, domeCote: resolved.domeCote, cleCablage: resolved.cleCablage } : null;
  }).filter(Boolean);

  if (!resolvedList.length) {
    container.innerHTML = `
      <div style="padding: 4px 0 20px;">
        <button type="button" class="btn btn-secondary btn-sm" id="cablageDcBackBtn"><i class="fas fa-arrow-left"></i> Retour à la configuration des chaînes</button>
        <div style="margin-top: 16px; padding: 14px; background: #fff3cd; border: 1px solid #ffe69c; border-radius: 6px; color: #664d03;">
          Le Câblage DC est disponible uniquement pour le calepinage résidentiel (toiture multi-typologie).
          Aucun de ces champs PV ne correspond à une maison résidentielle connue.
        </div>
      </div>`;
    const backBtn = document.getElementById('cablageDcBackBtn');
    if (backBtn) backBtn.addEventListener('click', () => {
      window.__chainesPertesGlobal.activeView = 'default';
      window.__chainesPertesGlobal.activeCablagePans = null;
      renderChainesPertesModal();
    });
    return;
  }

  // Tous les pans d'un même pvId partagent la même maison (état) — résolu une fois via le 1er.
  const state = resolvedList[0].state;
  resolvedList.forEach((r) => {
    r.model = getOrCreateCablageModel(state, r.pan, r.cleCablage);
    r.stringSizes = getStringSizesForField(r.field);
    r.panels = panelsOfResolvedField(r);
    if (r.model.mode !== 'manual') {
      r.model.strings = orientStringsHorizontally(assignStringsAutomatically(r.panels, r.stringSizes), r.panels, r.model.chainDirection);
    }
  });

  // Onglet actif : conserve la sélection précédente si toujours valide (même toiture rouverte),
  // sinon le 1er pan par défaut. Chaque pan garde son PROPRE objet `view` d'une ouverture à l'autre
  // (showChaines...), exactement comme window.__cablageDcView le fait pour le mono-pan.
  const prev = window.__cablageDcViewsCombined;
  const prevById = (prev && prev.byId) || {};
  const activeSubPvId = (prev && prev.activeSubPvId && resolvedList.some((r) => r.field.subPvId === prev.activeSubPvId))
    ? prev.activeSubPvId
    : resolvedList[0].field.subPvId;

  const byId = {};
  resolvedList.forEach((r) => {
    byId[r.field.subPvId] = Object.assign(prevById[r.field.subPvId] || { showChaines: true }, {
      field: r.field, pan: r.pan, state: r.state, model: r.model, panels: r.panels, stringSizes: r.stringSizes,
    });
  });

  const combined = { pans, resolvedList, byId, activeSubPvId, canvas: null, ctx: null, fit: null };
  window.__cablageDcViewsCombined = combined;

  const activeView = byId[activeSubPvId];
  const { userConfigText, autoConfigText } = getConfigStringsForField(activeView.field);
  const totalPanelsAll = resolvedList.reduce((sum, r) => sum + (r.field.totalPanels || 0), 0);
  const sizesLabel = activeView.stringSizes.length
    ? activeView.stringSizes.map((n) => `${n} PV`).join(' + ')
    : 'Non déterminé (renseignez le panneau/onduleur ou "Config. PV utilisateur")';

  const tabsHTML = resolvedList.map((r) => {
    const isActive = r.field.subPvId === activeSubPvId;
    return `<button type="button" class="btn btn-sm cablageDcPanTabBtn" data-pan-tab="${r.field.subPvId}"
      style="background:${isActive ? '#0f766e' : '#fff'}; color:${isActive ? '#fff' : '#0f766e'}; border:1px solid #0f766e;">
      ${r.field.subPvId} (${r.field.totalPanels} PV)
    </button>`;
  }).join('');

  container.innerHTML = `
    <div style="padding: 4px 0 20px;">
      <button type="button" class="btn btn-secondary btn-sm" id="cablageDcBackBtn"><i class="fas fa-arrow-left"></i> Retour à la configuration des chaînes</button>
      <div style="font-weight:bold; color:#212529; margin:14px 0 4px;">Câblage DC — Bâtiment ${activeView.field.pvId} (${resolvedList.length} pans, ${totalPanelsAll} panneaux)</div>
      <div style="font-size:0.8rem; color:#6c757d; margin-bottom:12px;">
        Schéma combiné : tous les pans sont représentés selon leur position réelle sur le toit.
        Cliquez un onglet ci-dessous — ou directement un panneau du schéma — pour éditer le tableau de
        métrés/MPPT de ce pan.
      </div>

      <div style="margin-bottom:14px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <span style="font-size:0.78rem; color:#495057; font-weight:600;">Pan actif :</span>
        ${tabsHTML}
      </div>

      <!-- CORRECTIF (demande explicite : "placer les labels Pan: et Chaînes attendues:, boutons
           inclus, avant le plan de câblage — remets les boutons comme à l'initial") : même ordre et
           mêmes libellés de boutons que la vue mono-pan d'origine (window.renderCablageDcSection). -->
      <div style="font-weight:bold; color:#212529; margin-bottom:4px;">Pan : ${activeView.field.subPvId} (${activeView.field.totalPanels} panneaux)</div>
      <div style="font-size:0.8rem; color:#6c757d; margin-bottom:12px;">Chaînes attendues : ${sizesLabel}</div>

      <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:12px;">
        <div>${cablageDcModeToggleHTML(activeView.model)}</div>
        <div>${cablageDcPolarityToggleHTML(activeView.model)}</div>
        <div>${cablageDcDirectionToggleHTML(activeView.model)}</div>
        <label style="font-size:0.8rem; height:34px; box-sizing:border-box; display:flex; align-items:center; gap:6px;">
          <input type="checkbox" id="cablageDcShowChainesCheckbox" ${activeView.showChaines !== false ? 'checked' : ''} /> Afficher les chaînes
        </label>
        <button type="button" class="btn btn-outline-danger" id="cablageDcResetBtn" style="height:34px; box-sizing:border-box; padding:0 14px; font-size:0.8rem; flex-shrink:0; white-space:nowrap;">Réinitialiser</button>
        <button type="button" class="btn btn-sm" id="cablageDcExportBtn" title="Exporter le plan de câblage" style="height:34px; box-sizing:border-box; padding:0 14px; font-size:0.8rem; flex-shrink:0; background:#1E8449; color:#fff; border-color:#1E8449; display:flex; align-items:center; gap:6px;">
          <img src="/static/concevoir_mon_projet/medias/icons/pdf-export.svg" alt="" style="width:16px; height:16px; vertical-align:middle;"> Exporter le plan de câblage
        </button>
      </div>

      <div id="cablageDcManualHint" style="display:${activeView.model.mode === 'manual' ? 'block' : 'none'}; font-size:0.8rem; color:#0f766e; margin-bottom:8px;">
        Mode manuel : cliquez les panneaux du pan actif directement dans le schéma ci-dessous, dans l'ordre de câblage. Chaque chaîne se ferme automatiquement une fois sa taille atteinte. Cliquer un panneau déjà assigné annule à partir de celui-ci. Cliquer un panneau d'un AUTRE pan bascule automatiquement l'onglet actif sur ce pan.
      </div>

      <!-- CORRECTIF (demande explicite : "placer le tableau des n° de strings à DROITE du plan de
           câblage") : canevas en premier (colonne de gauche, plus large), tableau des strings
           (config + MPPT) en colonne de droite, plus étroite — modal élargi conservé (cf.
           createChainesPertesModal). -->
      <div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
        <div style="flex:1.6 1 520px; min-width:340px;">
          <canvas id="cablageDcCanvas" width="1100" height="620" style="width:100%; border:1px solid #dee2e6; border-radius:6px; background:#fff;"></canvas>
        </div>
        <div style="flex:1 1 340px; min-width:300px; max-width:420px;">
          <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:14px;">
            ${window.chainesPertesMetricCard('Config. PV utilisateur', userConfigText || '<em style="font-weight:400; color:#6c757d;">Non saisie</em>')}
            ${window.chainesPertesMetricCard('Config. automatique', autoConfigText)}
          </div>
          ${renderMpptTableHTML(activeView)}
        </div>
      </div>

      <!-- CORRECTIF (demande explicite : "placer le tableau des métrés en dessous du plan de
           câblage, dans sa propre section") : section pleine largeur, centrée (max-width alignée sur
           la largeur du canevas), placée APRÈS la rangée canevas/MPPT ci-dessus. -->
      <div style="max-width:900px; margin:18px auto 0 auto;">
        ${renderCablageTableHTML(activeView)}
      </div>
    </div>
  `;

  wireCablageDcCanvasCombined(combined, pans);
  wireCablageDcBodyControls(activeView);
};

// Partie STRICTEMENT propre à la vue combinée : back button (nettoie activeCablagePans en plus
// d'activeView), canevas PARTAGÉ (dessin + clic, routé vers le bon pan par géométrie réelle), et les
// onglets de sélection du pan actif. Tout le reste (mode/polarité/checkbox/reset/export/colonnes/
// MPPT/longueurs) est câblé par wireCablageDcBodyControls, réutilisée sans modification.
function wireCablageDcCanvasCombined(combined, pans) {
  document.getElementById('cablageDcBackBtn').addEventListener('click', () => {
    window.__chainesPertesGlobal.activeView = 'default';
    window.__chainesPertesGlobal.activeCablagePans = null;
    renderChainesPertesModal();
  });

  const canvas = document.getElementById('cablageDcCanvas');
  combined.canvas = canvas;
  combined.ctx = canvas.getContext('2d');
  drawCablageCanvasCombined(combined);
  installerZoomCablage(canvas);

  // NOUVEAU : le bouton "Exporter PDF" du pan actif (câblé par wireCablageDcBodyControls, réutilisée
  // telle quelle) lit view.canvas — pointe ici vers le canevas COMBINÉ partagé (schéma du bâtiment
  // entier), donc l'export embarque le schéma complet + le tableau du pan actif, plutôt qu'un canevas
  // manquant.
  Object.values(combined.byId).forEach((v) => { v.canvas = canvas; });

  canvas.addEventListener('click', (evt) => {
    const rect = canvas.getBoundingClientRect();
    const px = (evt.clientX - rect.left) * (canvas.width / rect.width);
    const py = (evt.clientY - rect.top) * (canvas.height / rect.height);
    const meterPt = combined.fit.fromCanvas({ x: px, y: py });

    const CM = window.CalepinageMaisonIndiv;
    // Les 2 côtés d'un dôme partagent le contour du pan : départagés par le panneau cliqué.
    const hitResolved = combined.resolvedList.find((r) => CM.pointInPolygon(meterPt, r.pan.points)
      && (r.domeCote == null || r.panels.some((p) => pointInRotatedRectLocal(meterPt, p))));
    if (!hitResolved) return;
    const view = combined.byId[hitResolved.field.subPvId];
    if (view.model.mode !== 'manual') return;
    const hitPanel = view.panels.find((p) => pointInRotatedRectLocal(meterPt, p));
    if (!hitPanel) return;
    handleManualPanelClick(view.model, view.stringSizes, hitPanel.panelIndex);
    persistAndPropagate(view);
    // Bascule l'onglet actif sur le pan cliqué, pour que le tableau affiché sous le schéma
    // corresponde immédiatement au pan qu'on vient de modifier.
    combined.activeSubPvId = hitResolved.field.subPvId;
    window.renderCablageDcSectionCombined(pans);
  });

  document.querySelectorAll('.cablageDcPanTabBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      combined.activeSubPvId = btn.getAttribute('data-pan-tab');
      window.renderCablageDcSectionCombined(pans);
    });
  });
}

// CORRECTIF (demande explicite : "saisie max par champ : 0-200 ml maximum" + "calculer
// automatiquement Long.(S+)/Long.(S-)") : borne resserrée à 200.
// CORRECTIF (demande explicite : "la valeur saisie dans Desc./Chem. doit être dupliquée dans toutes
// les autres cellules de la colonne") : Descente verticale et Cheminement horizontal sont, en
// pratique, quasi toujours identiques pour toutes les chaînes d'un même champ PV — `bind` propage
// désormais la valeur saisie à TOUTES les autres lignes de la même colonne (pas aux colonnes
// personnalisées, ni à Long.(S+)/Long.(S-), non concernées par cette demande — cf. bindPlusMinus
// ci-dessous pour ces 2 dernières).
// CORRECTIF (demande explicite, round suivant : "personnaliser la longueur du câble de retour S+ ou
// S- en fonction du départ de la chaîne, S+ = S- par défaut") : Long.(S+)/Long.(S-) redeviennent
// éditables (bindPlusMinus) — saisir une valeur bascule row.manualPlus/manualMinus à `true` pour CETTE
// chaîne et CE pôle uniquement (pas de duplication aux autres lignes, contrairement à Desc./Chem. :
// le trajet de retour dépend du positionnement propre à chaque chaîne) ; le bouton "↺" ramène ce pôle
// au calcul automatique (ensureLengthsRows recalcule alors row.plus/minus au prochain rendu).
function wireLengthInputs(view) {
  const { model } = view;
  model.strings.forEach((s, si) => {
    const row = model.lengths[si];
    const bind = (id, field, label, isCustom, colId) => {
      const input = document.getElementById(id);
      const errorEl = document.getElementById(`${id}-error`);
      if (!input) return;
      input.addEventListener('input', () => {
        const result = window.ChainesPertesValidation.validateNumericField(input.value, { min: 0, max: 200, label });
        window.ChainesPertesValidation.showFieldValidation(input, errorEl, result);
        if (!result.valid) return;
        if (isCustom) row.custom[colId] = result.value;
        else row[field] = result.value;

        if (!isCustom && (field === 'descente' || field === 'cheminement')) {
          model.lengths.forEach((otherRow, otherSi) => {
            if (otherSi === si) return;
            otherRow[field] = result.value;
            const otherInput = document.getElementById(field === 'descente' ? `cablageDcDescente-${otherSi}` : `cablageDcCheminement-${otherSi}`);
            if (otherInput) otherInput.value = result.value;
          });
        }

        const stats = persistAndPropagate(view);
        updateStatsDisplay(view, stats);
      });
    };
    bind(`cablageDcDescente-${si}`, 'descente', 'Descente verticale', false);
    bind(`cablageDcCheminement-${si}`, 'cheminement', 'Cheminement horizontal', false);
    (model.customColumns || []).forEach((c) => {
      bind(`cablageDcCustom-${c.id}-${si}`, null, c.label, true, c.id);
    });

    const bindPlusMinus = (id, field, manualField, label) => {
      const input = document.getElementById(id);
      const errorEl = document.getElementById(`${id}-error`);
      if (input) {
        input.addEventListener('input', () => {
          const result = window.ChainesPertesValidation.validateNumericField(input.value, { min: 0, max: 200, label });
          window.ChainesPertesValidation.showFieldValidation(input, errorEl, result);
          if (!result.valid) return;
          row[field] = result.value;
          row[manualField] = true;
          const stats = persistAndPropagate(view);
          updateStatsDisplay(view, stats);
        });
      }
      const resetBtn = document.querySelector(`[data-reset="${id}"]`);
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          row[manualField] = false;
          persistAndPropagate(view);
          window.renderCablageDcSection(view.field);
        });
      }
    };
    bindPlusMinus(`cablageDcPlus-${si}`, 'plus', 'manualPlus', 'Longueur S+');
    bindPlusMinus(`cablageDcMinus-${si}`, 'minus', 'manualMinus', 'Longueur S-');
  });
}
