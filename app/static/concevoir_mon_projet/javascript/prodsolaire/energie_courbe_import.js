// =========================================================================
// ÉNERGIE D'UNE COURBE DE CHARGE IMPORTÉE (ACI) ET CONTRÔLE DU TABLEAU RÉCAPITULATIF
// =========================================================================
// Lecture indépendante du fichier importé, à l'image de extract_consumption côté serveur
// (calcul_autoconso.py) : 4 lignes d'en-tête, colonnes repérées comme libelles_colonnes (format à
// 5 colonnes avec PAC, sinon B/C/D = existante / IRVE / totale), pas lu sur les dates
// (pas_de_temps_courbe.js), énergie = somme des puissances x pas.
//
// Cette énergie est affichée sous le nom du fichier (onglet « Import courbe de charge »), envoyée avec
// le calcul (champ conso_lue_kwh, contrôlé par app/services/controle_conso_import.py) et comparée à
// chaque affichage du tableau récapitulatif : un écart bloque l'étude.

import { detecterPasDeTempsCourbe } from './pas_de_temps_courbe.js';

const LIBELLES_POSITIONNELS = { 1: 'Cons. existante', 2: 'Cons. IRVE', 3: 'Cons. Totale' };
export const TOTALE = 'Cons. Totale';

// Même tolérance que irve_controle.py : arrondis flottants seulement.
const TOLERANCE_ABSOLUE_KWH = 0.1;
const TOLERANCE_RELATIVE = 1e-6;

function libellesColonnes(lignesEntete) {
    for (const ligne of lignesEntete || []) {
        const cellules = (ligne || []).map(c => (c == null ? '' : String(c).trim().toUpperCase()));
        if (!cellules.slice(1).some(c => c.includes('PAC') || c.includes('CLIM'))) continue;
        const libelles = {};
        cellules.forEach((c, k) => {
            if (k === 0 || !c) return;
            if (c.includes('PAC') || c.includes('CLIM')) libelles[k] = 'Cons. PAC';
            else if (c.includes('IRVE')) libelles[k] = 'Cons. IRVE';
            else if (c.includes('TOTAL')) libelles[k] = 'Cons. Totale';
            else if (c.includes('EXIST')) libelles[k] = 'Cons. existante';
        });
        if (Object.values(libelles).includes('Cons. PAC')) return libelles;
    }
    return { ...LIBELLES_POSITIONNELS };
}

// Valeur numérique comme pd.to_numeric(errors='coerce') après remplacement des virgules ; 0 sinon.
function valeur(brut) {
    if (typeof brut === 'number') return Number.isFinite(brut) ? brut : 0;
    const s = String(brut ?? '').replaceAll(',', '.').trim();
    if (!s) return 0;
    const v = Number(s);
    return Number.isFinite(v) ? v : 0;
}

async function lignesFichier(file) {
    if (/\.csv$|\.txt$/i.test(file.name || '')) {
        const octets = new Uint8Array(await file.arrayBuffer());
        let texte;
        try { texte = new TextDecoder('utf-8', { fatal: true }).decode(octets); } catch (e) { texte = new TextDecoder('latin1').decode(octets); }
        return texte.replace(/^﻿/, '').split(/\r\n?|\n/).filter(l => l.length).map(l => l.split(';'));
    }
    if (typeof XLSX === 'undefined') throw new Error("La bibliothèque de lecture Excel n'est pas chargée.");
    const classeur = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    const feuille = classeur.Sheets[classeur.SheetNames[0]];
    return XLSX.utils.sheet_to_json(feuille, { header: 1, raw: true, defval: '' });
}

/**
 * Énergie (kWh) de chaque courbe d'un fichier de consommation ACI, telle qu'écrite dans le fichier.
 * @param {File} file
 * @param {number} pasDefaut - pas (min) retenu si ni les dates ni le nombre de lignes ne le donnent
 * @returns {Promise<{pasMin: number, energies: Object<string, number>, totaleKwh: number}>}
 */
export async function lireEnergiesCourbeAci(file, pasDefaut = 60) {
    const lignes = await lignesFichier(file);
    const libelles = libellesColonnes(lignes.slice(0, 4));
    const donnees = lignes.slice(4);
    const pasMin = detecterPasDeTempsCourbe(donnees) || pasDefaut;
    const energies = {};
    for (const [k, label] of Object.entries(libelles)) {
        let somme = 0;
        let presente = false;
        for (const ligne of donnees) {
            if (ligne.length > k) { presente = true; somme += valeur(ligne[k]); }
        }
        if (presente) energies[label] = somme * pasMin / 60;
    }
    const usages = Object.entries(energies).filter(([l, v]) => l !== TOTALE && v > 0);
    const totaleKwh = energies[TOTALE] > 0 ? energies[TOTALE] : usages.reduce((s, [, v]) => s + v, 0);
    return { pasMin, energies, totaleKwh };
}

const formatKwh = (v) => v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Texte affiché sous le nom du fichier importé. */
export function texteEnergiesLues(lecture) {
    const usages = Object.entries(lecture.energies).filter(([l, v]) => l !== TOTALE && v > 0);
    const detail = usages.length > 1 ? ` (${usages.map(([l, v]) => `${l.replace('Cons. ', '')} ${formatKwh(v)} kWh`).join(' · ')})` : '';
    return `Consommation lue : ${(lecture.totaleKwh / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MWh `
        + `(${formatKwh(lecture.totaleKwh)} kWh)${detail} — pas de ${lecture.pasMin} min`;
}

/** Courbes du tableau qui doivent sortir telles quelles du fichier (miroir de courbes_a_comparer). */
function courbesAComparer(lecture, { irveAjoute = false, pacAjoute = false } = {}) {
    const attendu = {};
    for (const [label, v] of Object.entries(lecture.energies)) {
        if (label === TOTALE || !(v > 0)) continue;
        if (irveAjoute && label === 'Cons. IRVE') continue;
        if (pacAjoute && label === 'Cons. PAC') continue;
        attendu[label] = v;
    }
    if (!irveAjoute && !pacAjoute && lecture.totaleKwh > 0) attendu.Global = lecture.totaleKwh;
    return attendu;
}

/**
 * Compare la lecture de l'import à la consommation du tableau récapitulatif (hors part des onduleurs).
 * @returns {{conforme: boolean, ecarts: string[]}}
 */
export function comparerAuTableau(lecture, results, options) {
    const ecarts = [];
    for (const [label, lue] of Object.entries(courbesAComparer(lecture, options))) {
        const resume = results?.sites?.[label]?.summary;
        const tableau = resume ? ((resume.consumption_mwh || 0) - (resume.conso_onduleur_mwh || 0)) * 1000 : 0;
        if (Math.abs(tableau - lue) > Math.max(TOLERANCE_ABSOLUE_KWH, Math.abs(lue) * TOLERANCE_RELATIVE)) {
            const nom = label === 'Global' ? 'Consommation totale' : label;
            ecarts.push(`${nom} : ${formatKwh(lue)} kWh lus à l'import, ${formatKwh(tableau)} kWh dans le tableau`);
        }
    }
    return { conforme: ecarts.length === 0, ecarts };
}
