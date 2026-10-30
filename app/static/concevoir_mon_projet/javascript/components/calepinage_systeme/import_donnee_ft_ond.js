/**
 * Extraction automatique de fiches techniques PDF d'onduleurs, pour la modale "BD onduleurs"
 * (cf. #favoritesOnduleursModal dans calepinage.html / bd_onduleurs.js).
 *
 * Même technique que import_donnee_ft_pv.js (pdf.js, reconstruction des lignes de texte par
 * coordonnée Y, recherche par motifs regex) adaptée aux champs d'un onduleur : fab, ref,
 * power_nominal, power (Puissance Max), rendement, type (Mono/Triphasé), hybride, opti
 * (compatibilité optimiseurs), conso — ce sont exactement les clés déjà utilisées par
 * bd_onduleurs.js (buildOnduleurRow/readOnduleurRowInputs), aucun nouvel id n'est inventé.
 *
 * L'utilisateur renseigne d'abord la référence et/ou la puissance nominale sur la ligne (comme
 * pour les panneaux), ce qui sert d'indicateur pour sélectionner la bonne variante quand une
 * fiche technique liste plusieurs modèles d'une même gamme dans un seul tableau.
 *
 * Dépendance : pdf.js, déjà chargé globalement par index.html — ce fichier ne le recharge pas.
 */

/* --------------------------------------------------------------------------------------------
 * 1. Reconstruction des lignes de texte d'un PDF (identique au principe de import_donnee_ft_pv.js).
 * ------------------------------------------------------------------------------------------ */
function _ondDatasheetExtractLines(items) {
  const lines = [];
  let currentY = null;
  let currentLine = [];

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
 * 2. Recherche de la colonne correspondant à un onduleur précis (référence et/ou puissance
 *    nominale saisies par l'utilisateur) — une fiche technique liste souvent plusieurs modèles
 *    d'une même gamme (ex: SUN2000-33KTL / 40KTL / 50KTL-M3) dans un même tableau.
 * ------------------------------------------------------------------------------------------ */
function _ondDatasheetFindTargetColumn(lines, targetRef, targetPower) {
  let powerColumnIndex = -1;
  let expectedColumns = 0;
  let matchedReference = null;

  if (targetPower) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(targetPower)) continue;
      const nums = line.match(/\b\d{1,4}(?:[.,]\d+)?\b/g);
      if (nums && nums.includes(targetPower)) {
        powerColumnIndex = nums.indexOf(targetPower);
        expectedColumns = nums.length;
        if (expectedColumns >= 2) break;
      }
    }
  }

  const normalize = (s) => (s || '').toUpperCase().replace(/[\s-]/g, '');
  if (targetRef) {
    const normTarget = normalize(targetRef);
    for (let i = 0; i < lines.length; i++) {
      const words = lines[i].split(/\s+/);
      for (const word of words) {
        if (word.length > 3 && normalize(word).includes(normTarget)) {
          matchedReference = word;
          break;
        }
      }
      if (matchedReference) break;
    }
  }

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
 * 3. Extraction d'une valeur numérique associée à un motif regex (puissance nominale/max,
 *    rendement, conso.), avec désambiguïsation par colonne quand plusieurs modèles sont listés
 *    côte à côte (même logique que _pvDatasheetExtractElectricalValues, simplifiée : un seul
 *    label recherché à la fois plutôt qu'un lot de 4).
 * ------------------------------------------------------------------------------------------ */
function _ondDatasheetExtractValue(lines, regex, filterFn, powerColumnIndex, expectedColumns) {
  for (let i = 0; i < lines.length; i++) {
    if (!regex.test(lines[i])) continue;

    let lineToParse = lines[i].replace(regex, '');
    let nums = (lineToParse.match(/-?\b\d+(?:[.,]\d+)?\b/g) || []).filter(filterFn);

    let checkLine = 1;
    while (nums.length === 0 && i + checkLine < lines.length && checkLine <= 3) {
      nums = (lines[i + checkLine].match(/-?\b\d+(?:[.,]\d+)?\b/g) || []).filter(filterFn);
      checkLine++;
    }

    if (nums.length > 0) {
      if (powerColumnIndex !== -1 && nums.length >= expectedColumns) {
        const offset = nums.length - expectedColumns;
        const idx = powerColumnIndex + offset;
        if (idx >= 0 && idx < nums.length) return nums[idx].replace(',', '.');
      }
      return nums[0].replace(',', '.');
    }
  }
  return 'Non détecté';
}

/* --------------------------------------------------------------------------------------------
 * 4. Type (Monophasé/Triphasé), hybride (Oui/Non), compatibilité optimiseurs (Oui/Non).
 * ------------------------------------------------------------------------------------------ */
function _ondDatasheetExtractType(fullText) {
  if (/\btri(?:phas[ée]|-?phase)\b|\bthree[\s-]?phase\b/i.test(fullText)) return 'Triphasé';
  if (/\bmono(?:phas[ée]|-?phase)\b|\bsingle[\s-]?phase\b/i.test(fullText)) return 'Monophasé';
  return 'Triphasé';
}

function _ondDatasheetExtractHybride(fullText) {
  return /\bhybrid(?:e)?\b|\bstockage\b|\bbattery\b|\bbatterie\b/i.test(fullText) ? 'Oui' : 'Non';
}

function _ondDatasheetExtractOpti(fullText) {
  return /optimi[sz]eur|power optimizer|module[\s-]?level power electronics|\bMLPE\b/i.test(fullText) ? 'Oui' : 'Non';
}

/* --------------------------------------------------------------------------------------------
 * 5. Fabricant : reprend les marques connues du catalogue BD onduleurs, sinon le premier segment
 *    de la référence détectée.
 * ------------------------------------------------------------------------------------------ */
function _ondDatasheetExtractManufacturer(fullText, reference) {
  const knownBrands = ['Huawei', 'SMA', 'SUNGROW', 'SOLAREDGE', 'Fronius', 'Growatt', 'Goodwe', 'Solis', 'Delta', 'ABB', 'Ingeteam', 'Schneider'];
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
 * 6. Point d'entrée principal : lit un fichier PDF (fiche technique onduleur) et retourne les
 *    données extraites, au format exact utilisé par la BD onduleurs (fab, ref, power_nominal,
 *    power, rendement, conso, type, hybride, opti).
 *
 * @param {File} file - Fichier PDF sélectionné par l'utilisateur.
 * @param {{targetRef?: string, targetPower?: string}} options - Référence et/ou puissance
 *   nominale déjà saisies sur la ligne, utilisées pour sélectionner la bonne variante.
 * @returns {Promise<object>} Les données extraites.
 */
window.importInverterDatasheetPdf = async function (file, options) {
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
    allLines = allLines.concat(_ondDatasheetExtractLines(content.items));
  }

  const { reference, powerColumnIndex, expectedColumns } = _ondDatasheetFindTargetColumn(allLines, targetRef, targetPower);
  const resolvedRef = targetRef || reference;

  const powerNominal = _ondDatasheetExtractValue(
    allLines,
    /(?:puissance\s*nominale|nominal\s*(?:ac\s*)?power|rated\s*(?:ac\s*)?power|rated\s*output\s*power)\b/i,
    (n) => { const v = parseFloat(n.replace(',', '.')); return v > 0.5 && v < 500; },
    powerColumnIndex, expectedColumns
  );

  // Puissance apparente max (kVA) : champ prioritaire demandé — motifs FR/EN élargis pour couvrir
  // les libellés les plus courants des fiches techniques onduleurs ("Puissance apparente CA
  // maximale", "Max. AC apparent power", "Maximum apparent power output", etc.).
  const powerMax = _ondDatasheetExtractValue(
    allLines,
    /(?:puissance\s*(?:de\s*sortie\s*)?apparente\s*(?:ca\s*)?max(?:imale)?|puissance\s*(?:ca\s*|ac\s*)?max(?:imale)?|max(?:imum)?\.?\s*apparent\s*(?:ac\s*)?power|max(?:imum)?\.?\s*ac\s*apparent\s*power|max(?:imum)?\.?\s*apparent\s*power\s*output|max(?:imum)?\.?\s*output\s*(?:apparent\s*)?power)\b/i,
    (n) => { const v = parseFloat(n.replace(',', '.')); return v > 0.5 && v < 500; },
    powerColumnIndex, expectedColumns
  );

  // Rendement Max (%) : champ prioritaire demandé — motifs FR/EN élargis (rendement/efficacité
  // maximal(e), "Max./Maximum efficiency", "Peak efficiency", "European/Euro efficiency" en repli).
  const rendement = _ondDatasheetExtractValue(
    allLines,
    /(?:rendement\s*max(?:imal)?\.?|efficacit[ée]\s*max(?:imale)?\.?|max(?:imum)?\.?\s*efficiency|peak\s*efficiency|european\s*efficiency|euro(?:péen)?\s*efficiency)\b/i,
    (n) => { const v = parseFloat(n.replace(',', '.')); return v > 80 && v <= 100; },
    -1, 0
  );

  const conso = _ondDatasheetExtractValue(
    allLines,
    /(?:consommation\s*(?:nocturne|de\s*veille)|night(?:time)?\s*(?:power\s*)?consumption|standby\s*(?:power\s*)?consumption)\b/i,
    (n) => { const v = parseFloat(n.replace(',', '.')); return v >= 0 && v < 50; },
    -1, 0
  );

  const data = {
    fab: _ondDatasheetExtractManufacturer(fullText, resolvedRef),
    ref: resolvedRef,
    power_nominal: powerNominal !== 'Non détecté' ? powerNominal : (targetPower || 'Non détecté'),
    power: powerMax !== 'Non détecté' ? powerMax : (targetPower || 'Non détecté'),
    rendement,
    conso,
    type: _ondDatasheetExtractType(fullText),
    hybride: _ondDatasheetExtractHybride(fullText),
    opti: _ondDatasheetExtractOpti(fullText)
  };

  return data;
};

/* --------------------------------------------------------------------------------------------
 * 7. Câblage du bouton d'import (une icône par ligne de la modale "BD onduleurs", cf.
 *    bd_onduleurs.js:buildOnduleurRow) : ouvre un sélecteur de fichier PDF, extrait les données
 *    en se basant sur la référence et la puissance nominale déjà saisies sur CETTE ligne, remplit
 *    les champs de la ligne avec le résultat, puis laisse l'utilisateur cliquer "Modifier" comme
 *    pour toute autre édition manuelle (aucune sauvegarde silencieuse : cohérent avec le
 *    fonctionnement existant de la modale, où "Modifier" est l'action qui persiste dans la BD).
 * ------------------------------------------------------------------------------------------ */
window.triggerImportFicheTechniqueOnduleur = function (btn) {
  const row = btn.closest('tr');
  if (!row) return;

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
      const inputs = row.querySelectorAll('input');
      // inputs[1] = Référence, inputs[2] = Puissance nominale (cf. bd_onduleurs.js:buildOnduleurRow)
      const targetRef = inputs[1] ? inputs[1].value.trim() : '';
      const targetPower = inputs[2] ? inputs[2].value.trim() : '';

      const data = await window.importInverterDatasheetPdf(file, { targetRef, targetPower });

      const selects = row.querySelectorAll('select');
      const setInputValue = (index, value) => {
        if (value === undefined || value === null || value === '' || value === 'Non détecté') return;
        if (inputs[index]) inputs[index].value = value;
      };
      const setSelectValue = (select, value) => {
        if (!select || value === undefined || value === null || value === '' || value === 'Non détecté') return;
        select.value = value;
      };

      setInputValue(0, data.fab);
      setInputValue(1, data.ref);
      setInputValue(2, data.power_nominal);
      setInputValue(3, data.power);
      setInputValue(4, data.rendement);
      setInputValue(5, data.conso);
      setSelectValue(selects[0], data.type);
      setSelectValue(selects[1], data.hybride);
      setSelectValue(selects[2], data.opti);

      const missingLabels = [];
      if (data.power_nominal === 'Non détecté') missingLabels.push('Puissance nominale');
      if (data.power === 'Non détecté') missingLabels.push('Puissance Max');
      if (data.rendement === 'Non détecté') missingLabels.push('Rendement');
      if (data.conso === 'Non détecté') missingLabels.push('Conso.');

      if (missingLabels.length > 0) {
        const warning = `Import partiel : ${missingLabels.join(', ')} n'ont pas pu être lus automatiquement `
          + `(certaines fiches PDF utilisent une mise en page non standard). `
          + `Veuillez compléter ces champs manuellement, puis cliquer sur "Modifier" pour enregistrer.`;
        if (window.showValidationAlert) {
          window.showValidationAlert(warning, inputs[0]);
        } else {
          alert(warning);
        }
      } else if (window.showToastNotification) {
        window.showToastNotification('Fiche technique importée avec succès ! Cliquez sur "Modifier" pour enregistrer.');
      }
    } catch (err) {
      console.error('Erreur import fiche technique onduleur PDF', err);
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
