/**
 * Extraction automatique de fiches techniques PDF de panneaux photovoltaïques.
 *
 * Refactorisé depuis un prototype qui était en réalité une page HTML complète collée dans un
 * fichier .js (avec son propre <head>/<body>/formulaire de test) : plusieurs de ses champs
 * avaient des id dupliqués par erreur de copier-coller (ex: "reference" utilisé deux fois pour
 * Fabricant ET Référence Panneau, "voc" réutilisé pour "Coef ISC", "coeff_pmax" réutilisé pour
 * "Type de panneaux" ET "Nombre de cellules" — ces trois derniers champs n'étaient donc jamais
 * réellement remplis). Ce fichier ne contient plus que la logique JS, et les clés de données
 * produites reprennent exactement celles déjà utilisées par calepinage.html / bd_panneaux_pv.js
 * pour le modal "Favoris Panneaux" et le localStorage (fab, ref, power, length, width, thickness,
 * impp, isc, vmpp, voc, coef_voc, coef_isc, coef, type, nbre_cells) — aucun nouvel id n'est inventé.
 *
 * Dépendance : pdf.js, déjà chargé globalement par index.html (cf. GlobalWorkerOptions.workerSrc
 * configuré ligne ~88 de index.html) — ce fichier ne le recharge pas pour éviter tout conflit.
 */

/* --------------------------------------------------------------------------------------------
 * 1. Reconstruction des lignes de texte d'un PDF (regroupement des items par coordonnée Y),
 *    afin de retrouver approximativement la structure en lignes/tableaux du document source.
 * ------------------------------------------------------------------------------------------ */
function _pvDatasheetExtractLines(items) {
  const lines = [];
  let currentY = null;
  let currentLine = [];

  // Tri des éléments par coordonnée Y (haut vers bas), puis par coordonnée X (gauche vers droite)
  items.sort((a, b) => {
    if (Math.abs(a.transform[5] - b.transform[5]) > 4) {
      return b.transform[5] - a.transform[5];
    }
    return a.transform[4] - b.transform[4];
  });

  items.forEach(item => {
    const text = item.str.trim();
    if (!text) return;

    if (currentY === null || Math.abs(item.transform[5] - currentY) > 4) {
      if (currentLine.length > 0) {
        lines.push(currentLine.join('  '));
      }
      currentLine = [text];
      currentY = item.transform[5];
    } else {
      currentLine.push(text);
    }
  });
  if (currentLine.length > 0) {
    lines.push(currentLine.join('  '));
  }
  return lines;
}

/* --------------------------------------------------------------------------------------------
 * 2. Détection de la colonne "STC" (Standard Test Conditions) dans un tableau de caractéristiques
 *    électriques. La plupart des fiches techniques présentent deux jeux de valeurs côte à côte
 *    (STC et NOCT) : sans détection explicite, on risque de collecter les valeurs NOCT par erreur.
 *    Retourne l'index de colonne (0-based, parmi les en-têtes reconnus sur la ligne) ou -1 si la
 *    ligne d'en-tête "STC/NOCT" n'a pas été trouvée (repli sur l'heuristique historique : la
 *    première occurrence rencontrée dans le document correspond conventionnellement à la STC).
 * ------------------------------------------------------------------------------------------ */
function _pvDatasheetFindStcColumnIndex(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\bSTC\b/i.test(line)) continue;
    // Ligne du type "... STC NOCT ..." ou "STC NMOT STC NMOT ..." (une paire par variante de
    // puissance) : on découpe en mots-clés connus pour retrouver la position de la 1ère colonne
    // STC. NOTE : si plusieurs paires STC/[NOCT|NMOT|PTC] se répètent (une par puissance), cet
    // index ne pointe que sur la 1ère d'entre elles — c'est pourquoi extractElectricalValues()
    // ne l'utilise qu'en repli, après la colonne de la puissance cible qui, elle, désambiguïse
    // correctement entre plusieurs variantes.
    const headerTokens = line.split(/\s+/).filter(tok => /^(STC|NOCT|NMOT|PTC)$/i.test(tok));
    if (headerTokens.length >= 1) {
      const idx = headerTokens.findIndex(tok => /^STC$/i.test(tok));
      if (idx !== -1) return idx;
    }
  }
  return -1; // Repli sur l'heuristique "première occurrence = STC" dans extractElectricalValue()
}

/* --------------------------------------------------------------------------------------------
 * 3. Recherche, sur les lignes du document, de la colonne correspondant à un panneau précis
 *    (référence et/ou puissance saisies par l'utilisateur) — une fiche technique liste souvent
 *    plusieurs variantes de puissance (ex: 405W/410W/415W/420W) pour une même gamme de référence.
 * ------------------------------------------------------------------------------------------ */
function _pvDatasheetFindTargetColumn(lines, targetRef, targetPower) {
  let powerColumnIndex = -1;
  let expectedColumns = 0;
  let matchedReference = null;

  // 3.a Colonne correspondant à la puissance cible (ligne d'en-tête typique : "405 410 415 420")
  // CORRECTIF (bug "l'algorithme choisit une autre colonne, souvent la première") : `\b` (limite de
  // mot) ne délimite JAMAIS une frontière entre un chiffre et une lettre, car les deux appartiennent
  // à la même classe \w — dans une fiche technique où la puissance est collée à son unité sans espace
  // (ex: "405W 410W 415W 420W", très fréquent), `\b[2-8]\d{2}\b` ne captait alors AUCUNE de ces
  // valeurs (aucune frontière après le dernier chiffre, suivi immédiatement de "W"). powerColumnIndex
  // restait alors à -1 pour cette ligne, et la boucle retombait finalement sur le repli "1ère colonne
  // STC détectée" ou "1ère valeur trouvée", d'où l'impression que la puissance saisie était ignorée.
  // (?<!\d) / (?!\d) interdisent seulement qu'un AUTRE CHIFFRE précède/suive immédiatement (pour ne
  // pas capturer un sous-nombre au sein d'une séquence plus longue, ex: "70" dans "4700"), tout en
  // laissant passer une lettre d'unité collée juste après ("405W" capture bien "405").
  // CORRECTIF (bug "mauvaise colonne lue" confirmé sur fiche DMEGC multi-puissances) : `(?<!\d)` seul
  // laissait aussi passer une puissance collée à une lettre AVANT le nombre, ex. "DM635M10T-B78HSW"
  // (ligne d'en-tête des noms de modèle, listés AVANT la vraie ligne de valeurs "Puissance Maximale
  // (Pmax/W) 630 474 635 478 ..." dans le document). Cette ligne de noms de modèle contient elle aussi
  // la puissance cible comme sous-chaîne ("635" dans "DM635M10T..."), et étant rencontrée en premier,
  // la boucle s'y arrêtait avec un nombre de colonnes erroné (une par variante, sans compter les
  // paires STC/NMOT), faussant tout le calcul d'offset dans extractElectricalValues() : les valeurs
  // électriques renvoyées étaient alors celles d'UNE AUTRE variante de puissance que celle demandée.
  // `(?<![\w.])` (au lieu de `(?<![\d.])`) interdit en plus qu'une LETTRE précède immédiatement le
  // nombre — ce qui exclut "635" dans "DM635M10T" (précédé de "M") sans empêcher "405W" (précédé
  // d'un espace/début de ligne), qui reste capturé normalement.
  if (targetPower) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(targetPower)) continue;
      const nums = line.match(/(?<![\w.])[2-8]\d{2}(?!\d)/g);
      if (nums && nums.includes(targetPower)) {
        powerColumnIndex = nums.indexOf(targetPower);
        expectedColumns = nums.length;
        if (expectedColumns >= 2) break; // au moins 2 puissances = ligne d'en-tête de tableau
      }
    }
  }

  // 3.b Référence correspondant à la cible utilisateur (comparaison insensible à la casse et aux
  // espaces/tirets, une fiche technique et le texte saisi par l'utilisateur ne s'écrivant pas
  // toujours à l'identique, ex: "DM-470-G12RT" vs "DM470G12RT").
  const normalize = (s) => (s || '').toUpperCase().replace(/[\s-]/g, '');
  if (targetRef) {
    const normTarget = normalize(targetRef);
    for (let i = 0; i < lines.length; i++) {
      const words = lines[i].split(/\s+/);
      for (const word of words) {
        if (word.length > 4 && normalize(word).includes(normTarget)) {
          matchedReference = word;
          break;
        }
      }
      if (matchedReference) break;
    }
  }

  // 3.c Repli : si aucune référence cible fournie, on retrouve celle associée à la puissance cible
  // (mot contenant la puissance cible et au moins une lettre), comme dans la version précédente.
  if (!matchedReference && targetPower) {
    for (let i = 0; i < lines.length; i++) {
      const words = lines[i].split(/\s+/);
      for (const word of words) {
        if (word.includes(targetPower) && /[a-zA-Z]/.test(word) && word.length > 5) {
          matchedReference = word;
          break;
        }
      }
      if (matchedReference) break;
    }
  }

  return {
    reference: matchedReference || 'Non détecté',
    powerColumnIndex,
    expectedColumns
  };
}

/* --------------------------------------------------------------------------------------------
 * 4. Extraction des valeurs électriques (Impp, Isc, Vmpp, Voc), en respectant en priorité la
 *    colonne STC détectée (§2), puis la colonne de puissance cible (§3) si le tableau en comporte
 *    plusieurs, avec repli sur la première valeur valide trouvée.
 * ------------------------------------------------------------------------------------------ */
function _pvDatasheetExtractElectricalValues(lines, stcColumnIndex, powerColumnIndex, expectedColumns) {
  const patterns = {
    impp: /(?:imp|impp|current at pmax|maximum power current|courant nominal|courant mpp|courant optimal|optimum operating current)\b/i,
    isc: /(?:isc|short circuit current|courant de court-circuit)\b/i,
    vmpp: /(?:vmp|vmpp|voltage at pmax|maximum power voltage|tension nominale|tension mpp|tension optimale|optimum operating voltage)\b/i,
    voc: /(?:voc|open circuit voltage|tension à vide|tension en circuit ouvert)\b/i
  };

  const filterNums = (numbers, currentKey) => {
    if (!numbers) return null;
    return numbers.filter(n => {
      const val = parseFloat(n.replace(',', '.'));
      if (currentKey === 'impp' || currentKey === 'isc') return val >= 3 && val <= 35; // Courant (A)
      if (currentKey === 'vmpp' || currentKey === 'voc') return val >= 20 && val <= 150; // Tension (V)
      return val > 2 && val < 150;
    });
  };

  const results = {};

  Object.keys(patterns).forEach(key => {
    results[key] = 'Non détecté';
    for (let i = 0; i < lines.length; i++) {
      if (!patterns[key].test(lines[i])) continue;

      let lineToParse = lines[i].replace(patterns[key], '');
      let nums = filterNums(lineToParse.match(/\b\d+([.,]\d+)?\b/g), key);

      // Si aucune valeur valide sur cette ligne, regarder jusqu'à 3 lignes en dessous
      let checkLine = 1;
      while ((!nums || nums.length === 0) && i + checkLine < lines.length && checkLine <= 3) {
        nums = filterNums(lines[i + checkLine].match(/\b\d+([.,]\d+)?\b/g), key);
        checkLine++;
      }

      if (nums && nums.length > 0) {
        // Priorité 1 : colonne de la puissance cible (§3). De nombreuses fiches techniques
        // répètent une paire STC/NOCT par variante de puissance (une colonne STC+NOCT par
        // référence, ex: 630W, 635W, 640W...) : dans ce cas, la position de la puissance cible
        // dans la ligne d'en-tête identifie sans ambiguïté LA BONNE colonne STC parmi plusieurs,
        // alors que "la 1ère colonne STC du tableau" (§2) correspondrait toujours à la première
        // variante (souvent la plus faible), quelle que soit la puissance réellement demandée.
        if (powerColumnIndex !== -1 && nums.length >= expectedColumns) {
          const offset = nums.length - expectedColumns;
          results[key] = nums[powerColumnIndex + offset].replace(',', '.');
        } else if (powerColumnIndex !== -1 && nums.length > powerColumnIndex) {
          results[key] = nums[powerColumnIndex].replace(',', '.');
        }
        // Priorité 2 : colonne STC explicitement détectée (§2) — utile quand la puissance cible
        // n'a pas pu être localisée dans une ligne d'en-tête (ex: fiche à une seule puissance).
        else if (stcColumnIndex !== -1 && nums.length > stcColumnIndex) {
          results[key] = nums[stcColumnIndex].replace(',', '.');
        }
        // Repli : première valeur trouvée. Conventionnellement la STC est listée avant la NOCT
        // dans la quasi-totalité des fiches techniques, d'où l'arrêt à la 1ère occurrence.
        else {
          results[key] = nums[0].replace(',', '.');
        }
        break;
      }
    }
  });

  return results;
}

/* --------------------------------------------------------------------------------------------
 * 5. Dimensions, coefficients de température, type (mono/bifacial) et nombre de cellules.
 * ------------------------------------------------------------------------------------------ */
function _pvDatasheetExtractDimensions(fullText) {
  const textNoSpaces = fullText.replace(/\s+/g, '');

  // 1. Tentative stricte : capture longueur + largeur + une épaisseur fiable (exactement 2 chiffres,
  //    non suivis d'un autre chiffre). CORRECTIF (bug "épaisseur importée = 303mm") : l'ancienne
  //    capture `(\d{2,3})` était gourmande — une fois tout l'espace retiré de la fiche technique, un
  //    nombre adjacent SANS séparateur clair (ex: "...x30" immédiatement suivi d'une puissance "350W"
  //    collée juste après) pouvait absorber un 3e chiffre en trop ("30"+"3" de "350" = "303").
  //    `(?!\d)` interdit qu'un chiffre supplémentaire suive immédiatement.
  const strictMatch = textNoSpaces.match(/(\d{4})[xX*×]+(\d{3,4})[xX*×]+(\d{2})(?!\d)/i);
  if (strictMatch) {
    const thicknessVal = parseInt(strictMatch[3], 10);
    // L'épaisseur d'un panneau PV standard est comprise entre 20 et 35mm — si la valeur capturée
    // sort largement de cette plage, on ne lui fait pas confiance (cf. repli ci-dessous).
    if (thicknessVal >= 15 && thicknessVal <= 45) {
      return { length: strictMatch[1], width: strictMatch[2], thickness: strictMatch[3] };
    }
  }

  // 2. Repli : RÉGRESSION CORRIGÉE (2026-07-26) — le correctif précédent renvoyait une épaisseur
  //    vide dès que la capture stricte échouait ou sortait de la plage, mais l'appelant
  //    (importPanelDatasheetPdf) n'importe la longueur/largeur QUE si les 3 valeurs (L/l/E) sont non
  //    vides (`hasDims = data.length && data.width && data.thickness`) — un souci sur l'épaisseur
  //    seule empêchait donc aussi l'import de la longueur et de la largeur, pourtant fiables
  //    indépendamment. On retente ici une capture SANS contrainte stricte sur l'épaisseur, et on
  //    retombe sur "30" (valeur par défaut du formulaire, cf. demande utilisateur) plutôt que de
  //    tout abandonner.
  const dimsOnlyMatch = textNoSpaces.match(/(\d{4})[xX*×]+(\d{3,4})[xX*×]+(\d{2,3})/i);
  if (dimsOnlyMatch) {
    return { length: dimsOnlyMatch[1], width: dimsOnlyMatch[2], thickness: '30' };
  }

  return { length: '', width: '', thickness: '' };
}

function _pvDatasheetExtractCoeff(lines, regex) {
  for (let i = 0; i < lines.length; i++) {
    if (!regex.test(lines[i])) continue;
    let match = lines[i].match(/-?0[.,]\d+|-?\.[0-9]+/);
    if (match) return Math.abs(parseFloat(match[0].replace(',', '.')));
    if (i + 1 < lines.length) {
      match = lines[i + 1].match(/-?0[.,]\d+|-?\.[0-9]+/);
      if (match) return Math.abs(parseFloat(match[0].replace(',', '.')));
    }
  }
  return '';
}

function _pvDatasheetExtractType(fullText) {
  if (/bifacial/i.test(fullText)) return 'Bifacial';
  return 'Monofacial';
}

function _pvDatasheetExtractCellCount(lines) {
  // Bug corrigé : l'ancien motif "cell\(?s\)?" n'avait pas de \b avant "cell", donc il
  // correspondait à n'importe quel mot CONTENANT "cell" comme sous-chaîne (ex: "excellente" dans
  // le texte marketing en page 1), ce qui arrêtait la recherche sur une ligne sans rapport avant
  // même d'atteindre la vraie ligne "Type de Cellule" / "Cell Type" en page 2. Motifs désormais
  // ancrés sur des mots entiers (\b...\b) et sur les libellés usuels des fiches techniques
  // (cf. "Cell Type" et/ou "Number"/"N°  of cells" demandés).
  const regex = /(?:number of cells|n[o°]\.?\s*of\s*cells|\bcell type\b|\btype de cellule\b|\bnombre de cellules\b|\bcell(?:s)?\b|\bcellule(?:s)?\b)/i;
  for (let i = 0; i < lines.length; i++) {
    if (!regex.test(lines[i])) continue;
    const match = lines[i].match(/\b(\d{2,3})\b/);
    if (match) return parseInt(match[1], 10);
    if (i + 1 < lines.length) {
      const nextMatch = lines[i + 1].match(/\b(\d{2,3})\b/);
      if (nextMatch) return parseInt(nextMatch[1], 10);
    }
  }
  return '';
}

/* --------------------------------------------------------------------------------------------
 * 6. Extraction de la puissance (Wc) réellement retenue et du fabricant.
 * ------------------------------------------------------------------------------------------ */
function _pvDatasheetExtractPower(lines, targetPower) {
  if (targetPower) return targetPower;
  // Repli : cherche une ligne "Pmax"/"Puissance" suivie d'un nombre plausible (100-1500 Wc)
  const regex = /(?:pmax|puissance|maximum power|power output)\b/i;
  for (let i = 0; i < lines.length; i++) {
    if (!regex.test(lines[i])) continue;
    const nums = (lines[i].match(/\b\d{2,4}([.,]\d+)?\b/g) || [])
      .map(n => parseFloat(n.replace(',', '.')))
      .filter(v => v > 100 && v < 1500);
    if (nums.length > 0) return String(nums[0]);
  }
  return '';
}

function _pvDatasheetExtractManufacturer(fullText, reference) {
  // Recherche les marques courantes présentes dans le catalogue de favoris existant ; à défaut,
  // reprend le premier segment de la référence détectée (convention très répandue chez les
  // fabricants : "AIKO-A630-MAH72Mw", "DM-470-G12RT"...) plutôt que de renvoyer "Non détecté"
  // alors que l'information est en réalité déjà visible dans la référence.
  const knownBrands = ['DMEGC', 'Longi', 'Jinko', 'JA Solar', 'Trina', 'Canadian Solar', 'REC', 'Q CELLS', 'Hanwha', 'Astronergy', 'Risen', 'AIKO'];
  for (const brand of knownBrands) {
    if (new RegExp(brand.replace(/\s/g, '\\s*'), 'i').test(fullText)) return brand;
  }
  if (reference && reference !== 'Non détecté') {
    const firstSegment = reference.split(/[-\s]/)[0];
    if (firstSegment && firstSegment.length >= 2) return firstSegment;
  }
  return 'Non détecté';
}

/* --------------------------------------------------------------------------------------------
 * 7. Point d'entrée principal : lit un fichier PDF (fiche technique panneau) et retourne les
 *    données extraites, au format exact utilisé par le modal "Favoris Panneaux"
 *    (cf. calepinage.html / bd_panneaux_pv.js) : fab, ref, power, length, width, thickness,
 *    impp, isc, vmpp, voc, coef_voc, coef_isc, coef, type, nbre_cells.
 *
 * @param {File} file - Fichier PDF sélectionné par l'utilisateur.
 * @param {{targetRef?: string, targetPower?: string}} options - Référence et/ou puissance déjà
 *   saisies par l'utilisateur dans le formulaire, utilisées pour sélectionner la bonne variante
 *   quand la fiche technique en liste plusieurs (cf. tri par référence + puissance demandé).
 * @returns {Promise<object>} Les données extraites.
 */
window.importPanelDatasheetPdf = async function (file, options) {
  options = options || {};
  const targetRef = (options.targetRef || '').trim();
  const targetPower = (options.targetPower || '').trim();

  if (!file) throw new Error('Aucun fichier PDF fourni.');
  if (typeof pdfjsLib === 'undefined') {
    throw new Error("La bibliothèque pdf.js n'est pas chargée sur cette page.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument(new Uint8Array(arrayBuffer)).promise;

  let fullText = '';
  let allLines = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(item => item.str).join(' ') + '\n';
    allLines = allLines.concat(_pvDatasheetExtractLines(content.items));
  }

  const stcColumnIndex = _pvDatasheetFindStcColumnIndex(allLines);
  const { reference, powerColumnIndex, expectedColumns } = _pvDatasheetFindTargetColumn(allLines, targetRef, targetPower);
  const electrical = _pvDatasheetExtractElectricalValues(allLines, stcColumnIndex, powerColumnIndex, expectedColumns);
  const dims = _pvDatasheetExtractDimensions(fullText);

  // La référence saisie par l'utilisateur prévaut sur celle détectée automatiquement : c'est
  // elle qui garantit qu'on sélectionne la bonne variante dans une fiche multi-références.
  const resolvedRef = targetRef || reference;

  const data = {
    fab: _pvDatasheetExtractManufacturer(fullText, resolvedRef),
    ref: resolvedRef,
    power: _pvDatasheetExtractPower(allLines, targetPower),
    length: dims.length,
    width: dims.width,
    thickness: dims.thickness,
    impp: electrical.impp,
    isc: electrical.isc,
    vmpp: electrical.vmpp,
    voc: electrical.voc,
    coef_voc: _pvDatasheetExtractCoeff(allLines, /(?:temperature coefficient of voc|coeff.*temp.*voc|voc.*temp.*coeff|voc.*coefficient)/i),
    coef_isc: _pvDatasheetExtractCoeff(allLines, /(?:temperature coefficient of isc|coeff.*temp.*isc|isc.*temp.*coeff|isc.*coefficient)/i),
    coef: _pvDatasheetExtractCoeff(allLines, /(?:temperature coefficient of pmax|coeff.*temp.*pmax|pmax.*temp.*coeff|pmax.*coefficient|temp.*coeff.*pmax)/i),
    type: _pvDatasheetExtractType(fullText),
    nbre_cells: _pvDatasheetExtractCellCount(allLines)
  };

  return data;
};

/* --------------------------------------------------------------------------------------------
 * 8. Sauvegarde des données extraites dans le localStorage utilisateur, sous la clé déjà lue par
 *    calepinage.html au chargement du formulaire ("Restaurer le panneau favori sauvegardé") —
 *    aucune autre modification n'est nécessaire pour que les champs se préremplissent.
 * ------------------------------------------------------------------------------------------ */
window.savePanelDatasheetToLocalStorage = function (data) {
  if (!data) return;
  localStorage.setItem('preferredPanelConfig', JSON.stringify(data));
};

/* --------------------------------------------------------------------------------------------
 * 9. Câblage du bouton d'import (une icône par ligne du modal "Favoris Panneaux", cf.
 *    calepinage.html) : ouvre un sélecteur de fichier PDF, extrait les données en se basant sur
 *    la référence et la puissance déjà saisies sur CETTE ligne (colonnes Réf. PV / Puis.(Wc), cf.
 *    tri par référence + puissance demandé), remplit les champs de la ligne avec le résultat, puis
 *    sauvegarde immédiatement dans le localStorage (window.savePanelDatasheetToLocalStorage) —
 *    la ligne reste éditable et peut ensuite être incluse dans "Enregistrer" comme n'importe
 *    quelle autre ligne du tableau des favoris.
 * ------------------------------------------------------------------------------------------ */
window.triggerImportFicheTechnique = function (btn) {
  const row = btn.closest('tr');
  if (!row) return;

  // Réf. PV et Puissance sont désormais obligatoires AVANT l'import PDF : ce sont ces deux valeurs
  // qui permettent à _pvDatasheetFindTargetColumn() de sélectionner la bonne colonne dans une fiche
  // technique listant plusieurs variantes de puissance côte à côte (cf. fiche DMEGC de référence,
  // 5 puissances dans le même tableau) — sans elles, l'algorithme retombe sur des heuristiques qui
  // peuvent pointer sur la mauvaise variante.
  const targetRefEl = row.cells[2].querySelector('input');
  const targetPowerEl = row.cells[3].querySelector('input');
  if (!targetRefEl.value.trim() || !targetPowerEl.value.trim()) {
    const message = "Veuillez d'abord renseigner la Réf. PV et la Puissance (Wc) de cette ligne avant "
      + "d'importer la fiche technique : ces deux valeurs sont nécessaires pour repérer la bonne "
      + 'colonne dans les fiches qui listent plusieurs puissances.';
    if (window.showValidationAlert) {
      window.showValidationAlert(message, !targetRefEl.value.trim() ? targetRefEl : targetPowerEl);
    } else {
      alert(message);
    }
    return;
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.pdf,application/pdf';
  fileInput.style.display = 'none';

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    fileInput.remove();
    if (!file) return;

    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
      // Réf. PV et Puissance (obligatoires, vérifiées plus haut) servent à sélectionner la bonne
      // variante dans une fiche technique multi-références/puissances.
      const targetRef = targetRefEl.value;
      const targetPower = targetPowerEl.value;

      const data = await window.importPanelDatasheetPdf(file, { targetRef, targetPower });

      // N'écrase un champ que si une valeur exploitable a été trouvée : laisse la saisie
      // existante de l'utilisateur intacte plutôt que d'y inscrire "Non détecté".
      const setValue = (cellIndex, selector, value) => {
        if (value === undefined || value === null || value === '' || value === 'Non détecté') return;
        const el = row.cells[cellIndex].querySelector(selector);
        if (el) el.value = value;
      };

      setValue(1, 'input', data.fab);
      setValue(2, 'input', data.ref);
      setValue(3, 'input', data.power);
      const hasDims = data.length && data.width && data.thickness;
      if (hasDims) {
        setValue(4, 'input', `${data.length}x${data.width}x${data.thickness}`);
      }
      setValue(5, 'input', data.impp);
      setValue(6, 'input', data.isc);
      setValue(7, 'input', data.vmpp);
      setValue(8, 'input', data.voc);
      setValue(9, 'input', data.coef_voc);
      setValue(10, 'input', data.coef_isc);
      setValue(11, 'input', data.coef);
      setValue(12, 'select', data.type);
      setValue(13, 'input', data.nbre_cells);

      window.savePanelDatasheetToLocalStorage(data);

      // Certaines fiches techniques utilisent une police non standard pour leur tableau de
      // caractéristiques électriques (texte visuellement correct mais non extractible
      // programmatiquement, quel que soit l'outil utilisé) : dans ce cas, ne pas prétendre à un
      // succès complet — lister les champs manquants pour que l'utilisateur les complète
      // manuellement, plutôt que de laisser des champs vides sans explication.
      const missingLabels = [];
      if (data.impp === 'Non détecté') missingLabels.push('Impp');
      if (data.isc === 'Non détecté') missingLabels.push('Isc');
      if (data.vmpp === 'Non détecté') missingLabels.push('Vmpp');
      if (data.voc === 'Non détecté') missingLabels.push('Voc');
      if (!hasDims) missingLabels.push('Dimensions');
      if (data.coef_voc === '') missingLabels.push('Coef Voc');
      if (data.coef_isc === '') missingLabels.push('Coef Isc');
      if (data.coef === '') missingLabels.push('Coef Pmax');

      if (missingLabels.length > 0) {
        const warning = `Import partiel : ${missingLabels.join(', ')} n'ont pas pu être lus automatiquement `
          + `(certaines fiches PDF utilisent une police non standard pour leur tableau de caractéristiques). `
          + `Veuillez compléter ces champs manuellement.`;
        if (window.showValidationAlert) {
          window.showValidationAlert(warning, row.cells[1].querySelector('input'));
        } else {
          alert(warning);
        }
      } else if (window.showToastNotification) {
        window.showToastNotification('Fiche technique importée avec succès !');
      }
    } catch (err) {
      console.error('Erreur import fiche technique PDF', err);
      const message = 'Erreur lors de la lecture du PDF : ' + (err && err.message ? err.message : err);
      if (window.showValidationAlert) {
        window.showValidationAlert(message, btn);
      } else {
        alert(message);
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  });

  document.body.appendChild(fileInput);
  fileInput.click();
};
