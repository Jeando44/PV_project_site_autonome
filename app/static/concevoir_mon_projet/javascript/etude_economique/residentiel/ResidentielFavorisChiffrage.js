/**
 * Favoris chiffrage (résidentiel) : grilles de prix personnelles (Qté / PU HT / TVA par ligne du
 * CAPEX), une colonne par gamme de puissance (3, 6, 9 kWc par défaut, colonnes libres ajoutables),
 * enregistrées dans le navigateur (localStorage) et applicables au tableau de chiffrage détaillé.
 *
 * - Les lignes sont identifiées par leur clé de sous-type (line.key, cf.
 *   ResidentielValidationRules.js::buildDefaultPostes()), jamais par leur libellé.
 * - Toute valeur est validée avec les mêmes bornes que le tableau (Rules.validateLigneField()) :
 *   une grille invalide ne peut être ni sauvegardée, ni importée, ni appliquée.
 * - Import/export Excel via SheetJS, chargé à la demande (même version que le module IRVE).
 * - « Appliquer » délègue à ResidentielCapexTable.js::applyFavori() (PU HT + TVA, quantités en
 *   option, inclusion batterie/borne).
 *
 * Limite connue : localStorage est propre au navigateur, les favoris ne suivent pas le compte.
 *
 * Deux modèles indépendants selon le profil du chiffrage (Rules.getProfil()) : résidentiel
 * (3/6/9 kWc) et PRO / Grand projet (100/250/500 kWc, cartes Structure / Génie civil / Eaux
 * pluviales en plus), chacun avec sa grille, sa clé de stockage et ses cases d'inclusion.
 */
(function () {
    'use strict';

    window.ResidentielChiffrage = window.ResidentielChiffrage || {};
    const RC = window.ResidentielChiffrage;
    const Rules = () => RC.Rules;

    const STORAGE_KEY = 'pv_favoris_chiffrage_v1';
    const STORAGE_KEY_PRO = 'pv_favoris_chiffrage_pro_v1';
    const STORE_VERSION = 1;
    const MAX_COLONNES = 8;
    const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    const FEUILLE_GRILLE = 'Chiffrage';
    const FEUILLE_COLONNES = 'Colonnes';
    const CHAMPS = [
        { field: 'qte', suffixe: 'Qté' },
        { field: 'puHt', suffixe: 'PU HT' },
        { field: 'tvaPct', suffixe: 'TVA %' }
    ];

    // Grille par défaut : installations de 3, 6 et 9 kWc (panneaux 500 Wc), batterie 7 kWh, borne
    // 7,4 kW. [Qté, PU HT, TVA] pour chaque colonne, dans l'ordre de COLONNES_PAR_DEFAUT. TVA 5,5 %
    // (≤ 9 kWc), sauf batterie et borne (20 %) et aides, déduites du total (0 %). Micro-onduleurs
    // et optimiseurs : un par panneau (quantités bloquées à 0 dans le tableau si non utilisés).
    const COLONNES_PAR_DEFAUT = [
        { id: 'c3', label: '3 kWc', puissanceKwc: 3 },
        { id: 'c6', label: '6 kWc', puissanceKwc: 6 },
        { id: 'c9', label: '9 kWc', puissanceKwc: 9 }
    ];
    const T = 5.5;
    const PRIX_PAR_DEFAUT_RESI = {
        offre_commerciale: [[1, 0, T], [1, 0, T], [1, 0, T]],
        dp_mairie: [[1, 300, T], [1, 300, T], [1, 300, T]],
        demande_raccordement: [[1, 150, T], [1, 150, T], [1, 150, T]],
        consuel_mise_service: [[1, 200, T], [1, 200, T], [1, 200, T]],

        panneaux_solaires: [[6, 120, T], [12, 120, T], [18, 120, T]],
        onduleurs: [[1, 800, T], [1, 1100, T], [1, 1500, T]],
        micro_onduleurs: [[6, 150, T], [12, 150, T], [18, 150, T]],
        optimiseurs: [[6, 55, T], [12, 55, T], [18, 55, T]],
        systeme_integration: [[1, 600, T], [1, 1100, T], [1, 1600, T]],

        coffret_dc: [[1, 250, T], [1, 300, T], [1, 400, T]],
        coffret_ac: [[1, 250, T], [1, 300, T], [1, 450, T]],
        coffret_consuel: [[1, 150, T], [1, 150, T], [1, 150, T]],
        cable_dc: [[30, 2.5, T], [40, 2.5, T], [50, 2.5, T]],
        cable_ac: [[15, 6, T], [15, 6, T], [15, 9, T]],
        cable_terre: [[20, 1.5, T], [20, 1.5, T], [20, 1.5, T]],
        autres: [[1, 100, T], [1, 150, T], [1, 200, T]],

        batterie: [[1, 3800, 20], [1, 3800, 20], [1, 3800, 20]],
        frais_activation_bv: [[1, 300, 20], [1, 300, 20], [1, 300, 20]],
        borne_recharge: [[1, 1200, 20], [1, 1200, 20], [1, 1200, 20]],
        pilotage: [[1, 300, T], [1, 300, T], [1, 400, T]],
        main_oeuvre: [[1, 1200, T], [1, 1800, T], [1, 2400, T]],
        pompage_solaire: [[0, 0, 20], [0, 0, 20], [0, 0, 20]],
        autres_generaux: [[0, 0, T], [0, 0, T], [0, 0, T]],
        aides_primes: [[1, 240, 0], [1, 480, 0], [1, 720, 0]]
    };

    // Grille PRO / Grand projet : 100, 250 et 500 kWc HT (panneaux 500 Wc : 200 / 500 / 1000),
    // onduleurs de chaîne ~110 kW, TVA 20 % (aides 0 %). Génie civil et eaux pluviales chiffrés au
    // forfait (quantité 1) : les PU minimaux imposés (100 à 1000 €) excluent un prix au mètre.
    // Structure porteuse / pannes : ombrière métal (~0,45 €/Wc pour la structure).
    const V = 20;
    const COLONNES_PAR_DEFAUT_PRO = [
        { id: 'c100', label: '100 kWc', puissanceKwc: 100 },
        { id: 'c250', label: '250 kWc', puissanceKwc: 250 },
        { id: 'c500', label: '500 kWc', puissanceKwc: 500 }
    ];
    const PRIX_PAR_DEFAUT_PRO = {
        offre_commerciale: [[1, 0, V], [1, 0, V], [1, 0, V]],
        dp_mairie: [[1, 1500, V], [1, 2000, V], [1, 2500, V]],
        demande_raccordement: [[1, 1000, V], [1, 1500, V], [1, 2000, V]],
        consuel_mise_service: [[1, 800, V], [1, 1200, V], [1, 1800, V]],

        panneaux_solaires: [[200, 95, V], [500, 90, V], [1000, 85, V]],
        onduleurs: [[1, 5500, V], [2, 6000, V], [4, 6000, V]],
        micro_onduleurs: [[200, 120, V], [500, 115, V], [1000, 110, V]],
        optimiseurs: [[200, 45, V], [500, 42, V], [1000, 40, V]],

        coffret_dc: [[1, 800, V], [2, 800, V], [4, 800, V]],
        coffret_ac: [[1, 2500, V], [1, 4000, V], [2, 4000, V]],
        coffret_consuel: [[1, 300, V], [1, 300, V], [1, 300, V]],
        cable_dc: [[800, 1.8, V], [2000, 1.8, V], [4000, 1.8, V]],
        cable_ac: [[50, 35, V], [80, 60, V], [120, 90, V]],
        cable_terre: [[200, 2.5, V], [400, 2.5, V], [700, 2.5, V]],
        autres: [[1, 1500, V], [1, 3000, V], [1, 5000, V]],

        structure_porteuse: [[1, 45000, V], [1, 105000, V], [1, 200000, V]],
        pannes: [[1, 8000, V], [1, 18000, V], [1, 35000, V]],
        systeme_integration: [[1, 10000, V], [1, 23000, V], [1, 45000, V]],

        fondations: [[1, 12000, V], [1, 28000, V], [1, 55000, V]],
        fourreaux: [[1, 3000, V], [1, 6000, V], [1, 10000, V]],
        regard: [[1, 1500, V], [1, 3000, V], [1, 5000, V]],
        chambre_tirage: [[1, 2500, V], [1, 2500, V], [1, 5000, V]],
        autres_genie_civil: [[1, 2000, V], [1, 4000, V], [1, 6000, V]],
        reprise_enrobe: [[1, 3000, V], [1, 6000, V], [1, 12000, V]],

        ouvrage_ep: [[1, 8000, V], [1, 15000, V], [1, 25000, V]],
        regard_grille_ep: [[1, 1000, V], [1, 2000, V], [1, 3000, V]],
        tranchee_ep: [[1, 1500, V], [1, 3000, V], [1, 5000, V]],
        tuyau_pvc: [[1, 800, V], [1, 1500, V], [1, 2500, V]],

        batterie: [[1, 25000, V], [1, 50000, V], [1, 90000, V]],
        frais_activation_bv: [[1, 300, V], [1, 300, V], [1, 300, V]],
        borne_recharge: [[2, 1500, V], [4, 1500, V], [6, 1500, V]],
        pilotage: [[1, 2000, V], [1, 3000, V], [1, 4000, V]],
        main_oeuvre: [[1, 15000, V], [1, 32000, V], [1, 60000, V]],
        pompage_solaire: [[0, 0, V], [0, 0, V], [0, 0, V]],
        autres_generaux: [[1, 2500, V], [1, 5000, V], [1, 8000, V]],
        aides_primes: [[1, 0, 0], [1, 0, 0], [1, 0, 0]]
    };

    const INCLUSIONS_RESI = [
        { option: 'includeBatterie', label: 'Inclure la batterie', detection: 'batterie' },
        { option: 'includeBorne', label: 'Inclure la borne de recharge', detection: 'borne' }
    ];
    const CONFIGS = {
        residentiel: {
            titre: 'Favoris chiffrage',
            storageKey: STORAGE_KEY,
            colonnes: COLONNES_PAR_DEFAUT,
            prix: PRIX_PAR_DEFAUT_RESI,
            puissanceColonne: { min: 0.1, max: 36 },
            exempleNom: '4,5 kWc',
            fichier: 'favoris_chiffrage.xlsx',
            inclusions: INCLUSIONS_RESI
        },
        pro: {
            titre: 'Favoris chiffrage — grands projets',
            storageKey: STORAGE_KEY_PRO,
            colonnes: COLONNES_PAR_DEFAUT_PRO,
            prix: PRIX_PAR_DEFAUT_PRO,
            puissanceColonne: { min: 1, max: 100000 },
            exempleNom: '1 MWc',
            fichier: 'favoris_chiffrage_grands_projets.xlsx',
            inclusions: INCLUSIONS_RESI.concat([
                { option: 'includeGenieCivil', label: 'Inclure le génie civil', detection: 'genieCivil' },
                { option: 'includeEauxPluviales', label: 'Inclure la gestion des eaux pluviales', detection: 'eauxPluviales' }
            ])
        }
    };

    /** Modèle de favoris du profil de chiffrage courant (résidentiel ou PRO). */
    function cfg() {
        return CONFIGS[Rules().getProfil()] || CONFIGS.residentiel;
    }

    function optionsParDefaut() {
        const options = { withQuantities: false };
        cfg().inclusions.forEach((inc) => { options[inc.option] = false; });
        return options;
    }

    // ------------------------------------------------------------------ Données et validation

    /**
     * Quantités jamais saisies dans les favoris ni appliquées depuis eux : panneaux (calepinage) et
     * frais d'activation batterie virtuelle (1 si la case est cochée, 0 sinon).
     * @returns {{texte: string, excel: string, titre: string}|null}
     */
    function qteAutomatique(key) {
        if (Rules().isQteDepuisCalepinage(key)) {
            return { texte: 'Calepinage', excel: 'calepinage', titre: 'Quantité reprise du calepinage (nombre de panneaux posés)' };
        }
        if (Rules().isQteDepuisBatterieVirtuelle(key)) {
            return { texte: 'Batterie virtuelle', excel: 'batterie virtuelle', titre: '1 si la case « Intégration d’une batterie virtuelle » est cochée, 0 sinon' };
        }
        return null;
    }

    // Lignes ajoutées au chiffrage après la diffusion du modèle Excel : absentes d'un fichier exporté
    // auparavant, elles reçoivent les prix par défaut au lieu de faire refuser l'import.
    const LIGNES_AJOUTEES_DEPUIS = ['frais_activation_bv'];

    const clone = (obj) => JSON.parse(JSON.stringify(obj));

    function esc(str) {
        return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /** Postes et lignes du CAPEX par défaut (seules les lignes à clé stable sont concernées). */
    function lignesReference() {
        return Rules().buildDefaultPostes(0).map((poste) => ({
            key: poste.key,
            label: poste.label,
            lines: poste.lines.filter((l) => l.key).map((l) => ({ key: l.key, designation: l.designation }))
        }));
    }

    function indexLignes() {
        const index = {};
        lignesReference().forEach((poste) => poste.lines.forEach((l) => {
            index[l.key] = { posteKey: poste.key, designation: l.designation };
        }));
        return index;
    }

    function valeursParDefaut(indexColonne) {
        const values = {};
        Object.entries(cfg().prix).forEach(([key, triplets]) => {
            const [qte, puHt, tvaPct] = triplets[indexColonne];
            values[key] = { qte, puHt, tvaPct };
        });
        return values;
    }

    function storeParDefaut() {
        const values = {};
        const colonnes = cfg().colonnes;
        colonnes.forEach((col, i) => { values[col.id] = valeursParDefaut(i); });
        return { version: STORE_VERSION, columns: colonnes.map((c) => ({ ...c })), values };
    }

    function nouvelIdColonne() {
        return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    /** Nom de colonne : non vide, unique, même règle de texte que les désignations (30 car., 5 mots). */
    function validerNomColonne(label, autresLabels) {
        const value = String(label == null ? '' : label).trim();
        if (!value) return 'Nom de colonne : obligatoire.';
        const texte = Rules().validateLigneField('reference', { rawValue: value });
        if (!texte.valid) return texte.message.replace('Référence', 'Nom de colonne');
        if ((autresLabels || []).some((l) => String(l).trim().toLowerCase() === value.toLowerCase())) {
            return `Nom de colonne : « ${value} » existe déjà.`;
        }
        return '';
    }

    function validerPuissanceColonne(puissance) {
        if (puissance === null || puissance === undefined || puissance === '') return '';
        const value = Number(puissance);
        const bornes = cfg().puissanceColonne;
        if (!Number.isFinite(value) || value < bornes.min || value > bornes.max) {
            return `Puissance : doit être comprise entre ${bornes.min} et ${bornes.max} kWc.`;
        }
        return '';
    }

    /** Valide une cellule de la grille. `valeur` est le nombre saisi (ou la saisie brute invalide). */
    function validerCellule(key, field, valeur) {
        const ligne = indexLignes()[key];
        if (!ligne) return `Ligne « ${key} » inconnue.`;
        // Quantité de panneaux (calepinage) ou d'activation batterie virtuelle (case) : ni saisie ni
        // appliquée depuis un favori.
        if (field === 'qte' && qteAutomatique(key)) return '';
        if (valeur === undefined || valeur === null || valeur === '') {
            return `${ligne.designation} : valeur manquante.`;
        }
        if (field === 'tvaPct') {
            const tva = Number(valeur);
            return Rules().TVA_RATES.includes(tva) ? '' : `TVA (${ligne.designation}) : ${valeur} % n'est pas un taux autorisé (${Rules().TVA_RATES.join(', ')}).`;
        }
        if (typeof valeur !== 'number' || !Number.isFinite(valeur)) {
            return `${field === 'qte' ? 'Quantité' : 'Prix unitaire HT'} (${ligne.designation}) : « ${valeur} » n'est pas un nombre valide.`;
        }
        const res = Rules().validateLigneField(field, {
            posteKey: ligne.posteKey, lineKey: key, designation: ligne.designation, rawValue: valeur
        });
        return res.valid ? '' : res.message;
    }

    /** Valide toute la grille : liste d'erreurs {colId, key, field, message} (vide si valide). */
    function validerGrille(store) {
        const erreurs = [];
        const columns = (store && Array.isArray(store.columns)) ? store.columns : [];
        if (!columns.length) erreurs.push({ message: 'Au moins une colonne de prix est requise.' });
        if (columns.length > MAX_COLONNES) erreurs.push({ message: `${MAX_COLONNES} colonnes de prix au maximum.` });
        const index = indexLignes();
        columns.forEach((col, i) => {
            const autres = columns.filter((_, j) => j !== i).map((c) => c.label);
            const errNom = validerNomColonne(col.label, autres);
            if (errNom) erreurs.push({ colId: col.id, message: errNom });
            const errPuissance = validerPuissanceColonne(col.puissanceKwc);
            if (errPuissance) erreurs.push({ colId: col.id, message: `« ${col.label} » – ${errPuissance}` });
            const values = (store.values && store.values[col.id]) || {};
            Object.keys(index).forEach((key) => {
                CHAMPS.forEach(({ field }) => {
                    const message = validerCellule(key, field, values[key] ? values[key][field] : undefined);
                    if (message) erreurs.push({ colId: col.id, key, field, message: `« ${col.label} » – ${message}` });
                });
            });
        });
        return erreurs;
    }

    /** Colonne dont la puissance est la plus proche de celle du projet (1ʳᵉ colonne à défaut). */
    function colonneLaPlusProche(columns, puissanceKwc) {
        if (!columns || !columns.length) return null;
        let meilleure = columns[0];
        let ecart = Infinity;
        if (puissanceKwc > 0) {
            columns.forEach((col) => {
                if (!(Number(col.puissanceKwc) > 0)) return;
                const d = Math.abs(Number(col.puissanceKwc) - puissanceKwc);
                if (d < ecart) { ecart = d; meilleure = col; }
            });
        }
        return meilleure.id;
    }

    /**
     * Grille enregistrée, ou grille par défaut si absente/illisible. Une ligne ajoutée au CAPEX
     * depuis l'enregistrement reçoit les prix par défaut de la colonne de puissance la plus proche ;
     * les valeurs existantes ne sont jamais modifiées (une valeur invalide reste signalée).
     */
    function chargerStore() {
        let store = null;
        try {
            const raw = localStorage.getItem(cfg().storageKey);
            if (raw) store = JSON.parse(raw);
        } catch (e) {
            console.warn('[Favoris chiffrage] Lecture impossible, grille par défaut utilisée :', e);
        }
        if (!store || store.version !== STORE_VERSION || !Array.isArray(store.columns) || !store.columns.length || !store.values) {
            return storeParDefaut();
        }
        const index = indexLignes();
        const colonnes = cfg().colonnes;
        store.columns.forEach((col) => {
            const values = store.values[col.id] = store.values[col.id] || {};
            const puissance = Number(col.puissanceKwc) || colonnes[1].puissanceKwc;
            const defauts = valeursParDefaut(colonnes.findIndex((c) => c.id === colonneLaPlusProche(colonnes, puissance)));
            Object.keys(index).forEach((key) => {
                if (!values[key]) values[key] = { ...defauts[key] };
            });
        });
        return store;
    }

    function sauverStore(store) {
        try {
            localStorage.setItem(cfg().storageKey, JSON.stringify(store));
            return true;
        } catch (e) {
            Rules().showAlert("Impossible d'enregistrer les favoris dans ce navigateur (stockage local indisponible ou plein).");
            return false;
        }
    }

    // ------------------------------------------------------------------ Excel

    /** Tableaux (lignes × colonnes) des deux feuilles du modèle Excel. */
    function versFeuillesExcel(store) {
        const entete = ['Poste', 'Clé', 'Désignation'];
        store.columns.forEach((col) => CHAMPS.forEach(({ suffixe }) => entete.push(`${col.label} | ${suffixe}`)));
        const grille = [entete];
        lignesReference().forEach((poste) => poste.lines.forEach((ligne) => {
            const row = [poste.label, ligne.key, ligne.designation];
            store.columns.forEach((col) => {
                const v = (store.values[col.id] || {})[ligne.key] || {};
                CHAMPS.forEach(({ field }) => {
                    if (field === 'qte' && qteAutomatique(ligne.key)) { row.push(qteAutomatique(ligne.key).excel); return; }
                    row.push(v[field] === undefined ? '' : v[field]);
                });
            });
            grille.push(row);
        }));
        const colonnes = [['Nom', 'Puissance (kWc)']].concat(store.columns.map((c) => [c.label, c.puissanceKwc == null ? '' : c.puissanceKwc]));
        return { grille, colonnes };
    }

    /** Cellule Excel → nombre ; une saisie non numérique est renvoyée telle quelle (signalée ensuite). */
    function lireNombre(cellule) {
        if (typeof cellule === 'number') return cellule;
        const texte = String(cellule == null ? '' : cellule).trim().replace(/\s/g, '').replace(',', '.');
        if (texte === '') return '';
        return /^-?\d+(\.\d+)?$/.test(texte) ? Number(texte) : String(cellule).trim();
    }

    /**
     * Lit les feuilles d'un classeur importé (tableaux lignes × colonnes). Toute anomalie est
     * collectée : l'import est entièrement refusé s'il y en a au moins une.
     * @returns {{store: object|null, erreurs: string[]}}
     */
    function parserClasseur(grille, colonnesFeuille) {
        const erreurs = [];
        if (!Array.isArray(grille) || grille.length < 2) {
            return { store: null, erreurs: [`Feuille « ${FEUILLE_GRILLE} » vide ou absente.`] };
        }
        const entete = grille[0].map((h) => String(h == null ? '' : h).trim());
        if (entete[0] !== 'Poste' || entete[1] !== 'Clé' || entete[2] !== 'Désignation') {
            return { store: null, erreurs: ['En-têtes attendus en colonnes A à C : « Poste », « Clé », « Désignation » (utilisez le modèle téléchargeable).'] };
        }
        while (entete.length > 3 && entete[entete.length - 1] === '') entete.pop();
        const nbGroupes = (entete.length - 3) / 3;
        if (!Number.isInteger(nbGroupes) || nbGroupes < 1) {
            return { store: null, erreurs: ['Chaque colonne de prix doit avoir 3 colonnes : « <nom> | Qté », « <nom> | PU HT », « <nom> | TVA % ».'] };
        }
        if (nbGroupes > MAX_COLONNES) {
            return { store: null, erreurs: [`${nbGroupes} colonnes de prix dans le fichier, ${MAX_COLONNES} au maximum.`] };
        }

        const puissances = {};
        (colonnesFeuille || []).slice(1).forEach((row) => {
            const nom = String((row && row[0]) == null ? '' : row[0]).trim();
            if (nom) puissances[nom.toLowerCase()] = lireNombre(row[1]);
        });

        const columns = [];
        for (let g = 0; g < nbGroupes; g++) {
            const base = 3 + g * 3;
            const labels = CHAMPS.map(({ suffixe }, k) => {
                const m = entete[base + k].match(/^(.*?)\s*\|\s*(.+)$/);
                return (m && m[2].trim().toLowerCase() === suffixe.toLowerCase()) ? m[1].trim() : null;
            });
            if (labels.some((l) => l === null) || labels[0] !== labels[1] || labels[1] !== labels[2]) {
                erreurs.push(`Colonnes ${base + 1} à ${base + 3} : en-têtes attendus « <nom> | Qté », « <nom> | PU HT », « <nom> | TVA % ».`);
                continue;
            }
            const label = labels[0];
            let puissance = Object.prototype.hasOwnProperty.call(puissances, label.toLowerCase()) ? puissances[label.toLowerCase()] : '';
            if (puissance === '') {
                const m = label.match(/(\d+(?:[.,]\d+)?)\s*kwc/i);
                puissance = m ? Number(m[1].replace(',', '.')) : '';
            }
            columns.push({ id: nouvelIdColonne() + g, label, puissanceKwc: puissance === '' ? null : puissance, base });
        }
        if (erreurs.length) return { store: null, erreurs };

        const index = indexLignes();
        const values = {};
        columns.forEach((c) => { values[c.id] = {}; });
        const vues = new Set();
        grille.slice(1).forEach((row, i) => {
            const numLigne = i + 2;
            if (!row || row.every((c) => String(c == null ? '' : c).trim() === '')) return;
            const key = String(row[1] == null ? '' : row[1]).trim();
            if (!index[key]) { erreurs.push(`Ligne ${numLigne} : clé « ${key} » inconnue (ne modifiez pas la colonne « Clé »).`); return; }
            if (vues.has(key)) { erreurs.push(`Ligne ${numLigne} : « ${index[key].designation} » apparaît plusieurs fois.`); return; }
            vues.add(key);
            columns.forEach((col) => {
                values[col.id][key] = {};
                CHAMPS.forEach(({ field }, k) => { values[col.id][key][field] = lireNombre(row[col.base + k]); });
            });
        });
        Object.keys(index).forEach((key) => {
            if (vues.has(key)) return;
            if (LIGNES_AJOUTEES_DEPUIS.includes(key)) {
                const defauts = valeursParDefaut(0)[key];
                columns.forEach((col) => { values[col.id][key] = { ...defauts }; });
                return;
            }
            erreurs.push(`Ligne manquante : « ${index[key].designation} » (clé ${key}).`);
        });
        if (erreurs.length) return { store: null, erreurs };

        const store = {
            version: STORE_VERSION,
            columns: columns.map(({ id, label, puissanceKwc }) => ({ id, label, puissanceKwc })),
            values
        };
        validerGrille(store).forEach((e) => erreurs.push(e.message));
        return erreurs.length ? { store: null, erreurs } : { store, erreurs: [] };
    }

    let xlsxPromise = null;
    function chargerXlsx() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        if (!xlsxPromise) {
            xlsxPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = XLSX_URL;
                script.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('SheetJS indisponible')));
                script.onerror = () => { xlsxPromise = null; reject(new Error('Chargement de SheetJS impossible')); };
                document.head.appendChild(script);
            });
        }
        return xlsxPromise;
    }

    async function exporterExcel() {
        try {
            const XLSX = await chargerXlsx();
            const { grille, colonnes } = versFeuillesExcel(ui.draft || ui.store);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grille), FEUILLE_GRILLE);
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(colonnes), FEUILLE_COLONNES);
            XLSX.writeFile(wb, cfg().fichier);
        } catch (e) {
            Rules().showAlert("Export Excel impossible : la bibliothèque de lecture Excel n'a pas pu être chargée.");
        }
    }

    async function importerExcel(fichier) {
        let XLSX;
        try {
            XLSX = await chargerXlsx();
        } catch (e) {
            Rules().showAlert("Import Excel impossible : la bibliothèque de lecture Excel n'a pas pu être chargée.");
            return;
        }
        let resultat;
        try {
            const wb = XLSX.read(await fichier.arrayBuffer(), { type: 'array' });
            const feuille = wb.Sheets[FEUILLE_GRILLE] || wb.Sheets[wb.SheetNames[0]];
            const feuilleColonnes = wb.Sheets[FEUILLE_COLONNES];
            const versTableau = (ws) => (ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) : null);
            resultat = parserClasseur(versTableau(feuille), versTableau(feuilleColonnes));
        } catch (e) {
            resultat = { store: null, erreurs: [`Fichier illisible (${fichier.name}) : utilisez un classeur .xlsx issu du modèle.`] };
        }
        if (!resultat.store) {
            ui.notice = { type: 'erreur', titre: `Import refusé : ${resultat.erreurs.length} anomalie(s). Aucune donnée n'a été modifiée.`, lignes: resultat.erreurs };
        } else {
            ui.draft = resultat.store;
            ui.editing = true;
            ui.notice = { type: 'succes', titre: `Import réussi (${resultat.store.columns.length} colonne(s)). Vérifiez puis cliquez sur « Sauvegarder ».`, lignes: [] };
        }
        render();
    }

    // ------------------------------------------------------------------ Interface

    const ui = {
        overlay: null,
        store: null,
        draft: null,        // copie en cours de modification (null en lecture)
        editing: false,
        selectedColId: null,
        options: { withQuantities: false },
        optionsTouchees: false,
        confirmApply: false,
        notice: null
    };

    function puissanceProjet() {
        return parseFloat(document.getElementById('puissance')?.value) || 0;
    }

    function grilleAffichee() {
        return ui.editing ? ui.draft : ui.store;
    }

    function modifie() {
        return ui.editing && JSON.stringify(ui.draft) !== JSON.stringify(ui.store);
    }

    function renderNotice() {
        if (!ui.notice) return '';
        const max = 15;
        const lignes = ui.notice.lignes.slice(0, max).map((l) => `<li>${esc(l)}</li>`).join('');
        const reste = ui.notice.lignes.length > max ? `<li>… et ${ui.notice.lignes.length - max} autre(s).</li>` : '';
        return `<div class="resi-fav-notice resi-fav-notice-${ui.notice.type}" role="status">
                <strong>${esc(ui.notice.titre)}</strong>${lignes ? `<ul>${lignes}${reste}</ul>` : ''}
            </div>`;
    }

    function renderTable(store) {
        const rules = Rules();
        const devise = rules.getDeviseSymbol();
        const disabled = ui.editing ? '' : 'disabled';
        const nbCols = store.columns.length;
        let html = `<table class="resi-fav-table"><thead><tr><th rowspan="2" class="resi-fav-designation">Désignation</th>`;
        store.columns.forEach((col) => {
            const puissance = Number(col.puissanceKwc) > 0 && !/kwc/i.test(col.label) ? ` <small>(${col.puissanceKwc} kWc)</small>` : '';
            const supprimer = ui.editing && nbCols > 1
                ? ` <button type="button" class="resi-fav-col-remove" data-action="supprimer-colonne" data-col="${esc(col.id)}" title="Supprimer la colonne « ${esc(col.label)} »" aria-label="Supprimer la colonne ${esc(col.label)}">&times;</button>` : '';
            html += `<th colspan="3" class="resi-fav-col-head">${esc(col.label)}${puissance}${supprimer}</th>`;
        });
        html += '</tr><tr>';
        // resi-fav-grp : 1re sous-colonne de chaque puissance, porte le séparateur vertical du groupe.
        store.columns.forEach(() => { html += `<th class="resi-fav-grp">Qté</th><th>PU HT (${esc(devise)})</th><th>TVA</th>`; });
        html += '</tr></thead><tbody>';

        lignesReference().forEach((poste) => {
            html += `<tr class="resi-fav-poste"><td class="resi-fav-designation">${esc(poste.label)}</td>${store.columns.map(() => '<td colspan="3" class="resi-fav-grp"></td>').join('')}</tr>`;
            poste.lines.forEach((ligne) => {
                html += `<tr><td class="resi-fav-designation">${esc(ligne.designation)}</td>`;
                store.columns.forEach((col) => {
                    const v = (store.values[col.id] || {})[ligne.key] || {};
                    const attrs = `data-col="${esc(col.id)}" data-key="${ligne.key}"`;
                    const tvaOptions = rules.TVA_RATES.map((r) => `<option value="${r}"${Number(v.tvaPct) === r ? ' selected' : ''}>${r}%</option>`).join('');
                    const auto = qteAutomatique(ligne.key);
                    const celluleQte = auto
                        ? `<td class="resi-fav-grp resi-fav-qte-calepinage" title="${esc(auto.titre)}"><em>${esc(auto.texte)}</em></td>`
                        : `<td class="resi-fav-grp"><input type="number" step="any" class="resi-fav-in" data-field="qte" ${attrs} value="${esc(v.qte)}" ${disabled}><div class="resi-fav-err"></div></td>`;
                    html += `${celluleQte}
                        <td><input type="number" step="any" class="resi-fav-in" data-field="puHt" ${attrs} value="${esc(v.puHt)}" ${disabled}><div class="resi-fav-err"></div></td>
                        <td><select class="resi-fav-in" data-field="tvaPct" ${attrs} ${disabled}>${tvaOptions}</select><div class="resi-fav-err"></div></td>`;
                });
                html += '</tr>';
            });
        });
        return html + '</tbody></table>';
    }

    function renderToolbar(store) {
        if (!ui.editing) {
            return `<button type="button" class="btn btn-primary" data-action="modifier">Modifier</button>
                <button type="button" class="btn btn-secondary" data-action="exporter">Télécharger le modèle Excel</button>
                <button type="button" class="btn btn-secondary" data-action="importer">Importer un fichier Excel</button>`;
        }
        const copierOptions = store.columns.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');
        const ajoutPossible = store.columns.length < MAX_COLONNES;
        return `<button type="button" class="btn btn-primary" data-action="sauvegarder">Sauvegarder</button>
            <button type="button" class="btn btn-secondary" data-action="annuler">Annuler</button>
            <button type="button" class="btn btn-secondary" data-action="reinitialiser">Réinitialiser aux valeurs par défaut</button>
            <button type="button" class="btn btn-secondary" data-action="importer">Importer un fichier Excel</button>
            <span class="resi-fav-add">
                <input type="text" class="resi-fav-add-nom" placeholder="Nom (ex. ${esc(cfg().exempleNom)})" aria-label="Nom de la nouvelle colonne" ${ajoutPossible ? '' : 'disabled'}>
                <input type="number" step="any" class="resi-fav-add-puissance" placeholder="kWc" aria-label="Puissance de la nouvelle colonne (kWc, facultatif)" ${ajoutPossible ? '' : 'disabled'}>
                <label>copier <select class="resi-fav-add-source" ${ajoutPossible ? '' : 'disabled'}>${copierOptions}</select></label>
                <button type="button" class="btn btn-secondary" data-action="ajouter-colonne" ${ajoutPossible ? '' : `disabled title="${MAX_COLONNES} colonnes au maximum"`}>+ Colonne</button>
            </span>`;
    }

    function renderApply() {
        const store = ui.store;
        if (!store.columns.some((c) => c.id === ui.selectedColId)) ui.selectedColId = colonneLaPlusProche(store.columns, puissanceProjet());
        const options = store.columns.map((c) => `<option value="${esc(c.id)}"${c.id === ui.selectedColId ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
        const bloque = ui.editing;
        const check = (name, label) => `<label><input type="checkbox" data-option="${name}" ${ui.options[name] ? 'checked' : ''} ${bloque ? 'disabled' : ''}> ${label}</label>`;
        const confirmation = ui.confirmApply ? `<div class="resi-fav-confirm" role="alert">
                Les PU HT et TVA${ui.options.withQuantities ? ', ainsi que les quantités,' : ''} des lignes par défaut du chiffrage vont être remplacés par la colonne « ${esc((store.columns.find((c) => c.id === ui.selectedColId) || {}).label)} ». Les lignes ajoutées à la main ne sont pas modifiées.
                <button type="button" class="btn btn-primary" data-action="confirmer-appliquer">Confirmer</button>
                <button type="button" class="btn btn-secondary" data-action="annuler-appliquer">Annuler</button>
            </div>` : '';
        return `<div class="resi-fav-apply-row">
                <label>Colonne de prix : <select class="resi-fav-col-select" ${bloque ? 'disabled' : ''}>${options}</select></label>
                ${check('withQuantities', 'Appliquer aussi les quantités (sauf panneaux : calepinage)')}
                ${cfg().inclusions.map((inc) => check(inc.option, inc.label)).join('')}
                <button type="button" class="btn btn-primary" data-action="appliquer" ${bloque ? 'disabled' : ''}>Appliquer</button>
            </div>
            ${bloque ? '<p class="resi-fav-hint">Sauvegardez ou annulez vos modifications avant d\'appliquer.</p>' : ''}
            ${confirmation}`;
    }

    function render() {
        if (!ui.overlay) return;
        const store = grilleAffichee();
        const body = ui.overlay.querySelector('.resi-fav-body');
        body.innerHTML = `
            <p class="resi-fav-intro">Prix enregistrés dans ce navigateur uniquement. Les valeurs hors des plages autorisées du chiffrage sont refusées.${ui.editing ? ' <strong>Mode modification.</strong>' : ''}</p>
            <div class="resi-fav-toolbar">${renderToolbar(store)}</div>
            ${renderNotice()}
            <div class="resi-fav-table-wrap">${renderTable(store)}</div>
            <div class="resi-fav-apply">${renderApply()}</div>`;
        afficherErreurs(store);
    }

    /** Affiche sous chaque champ l'erreur de sa valeur actuelle (recalculée, jamais mémorisée). */
    function afficherErreurs(store) {
        ui.overlay.querySelectorAll('.resi-fav-in').forEach((el) => afficherErreurCellule(el, store));
    }

    function afficherErreurCellule(el, store) {
        const v = ((store.values[el.dataset.col] || {})[el.dataset.key] || {})[el.dataset.field];
        const message = validerCellule(el.dataset.key, el.dataset.field, v);
        el.classList.toggle('is-invalid', !!message);
        const div = el.parentElement.querySelector('.resi-fav-err');
        div.textContent = message;
        div.style.display = message ? 'block' : 'none';
    }

    function creerOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'resi-favoris-overlay';
        overlay.innerHTML = `<div class="resi-fav-modal" role="dialog" aria-modal="true" aria-labelledby="resi-fav-title">
                <div class="resi-fav-header">
                    <h3 id="resi-fav-title">&#9733; Favoris chiffrage</h3>
                    <button type="button" class="resi-fav-close" data-action="fermer" aria-label="Fermer">&times;</button>
                </div>
                <div class="resi-fav-body"></div>
                <input type="file" class="resi-fav-file" accept=".xlsx,.xls" hidden>
            </div>`;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { close(); return; }
            const btn = e.target.closest('[data-action]');
            if (btn && !btn.disabled) onAction(btn.dataset.action, btn);
        });
        overlay.addEventListener('input', (e) => {
            const el = e.target;
            if (!el.classList.contains('resi-fav-in') || !ui.editing) return;
            const values = ui.draft.values[el.dataset.col] = ui.draft.values[el.dataset.col] || {};
            const cellule = values[el.dataset.key] = values[el.dataset.key] || {};
            // Saisie conservée telle quelle : un champ vide ou non numérique reste signalé.
            cellule[el.dataset.field] = el.value === '' ? '' : Number(el.value);
            afficherErreurCellule(el, ui.draft);
        });
        overlay.addEventListener('change', (e) => {
            const el = e.target;
            if (el.classList.contains('resi-fav-in') && el.tagName === 'SELECT' && ui.editing) {
                ui.draft.values[el.dataset.col][el.dataset.key].tvaPct = Number(el.value);
                afficherErreurCellule(el, ui.draft);
            } else if (el.classList.contains('resi-fav-col-select')) {
                ui.selectedColId = el.value;
                ui.confirmApply = false;
                render();
            } else if (el.dataset.option) {
                ui.options[el.dataset.option] = el.checked;
                ui.optionsTouchees = true;
                ui.confirmApply = false;
                render();
            } else if (el.classList.contains('resi-fav-file') && el.files && el.files[0]) {
                const fichier = el.files[0];
                el.value = '';
                importerExcel(fichier);
            }
        });
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
        });
        return overlay;
    }

    function onAction(action, btn) {
        switch (action) {
        case 'fermer':
            close();
            break;
        case 'modifier':
            ui.draft = clone(ui.store);
            ui.editing = true;
            ui.notice = null;
            ui.confirmApply = false;
            render();
            break;
        case 'annuler':
            ui.draft = null;
            ui.editing = false;
            ui.notice = null;
            render();
            break;
        case 'reinitialiser':
            if (window.confirm(`Remplacer toute la grille par les valeurs par défaut (${cfg().colonnes.map((c) => c.label).join(', ')}) ? Rien n'est enregistré avant « Sauvegarder ».`)) {
                ui.draft = storeParDefaut();
                ui.notice = null;
                render();
            }
            break;
        case 'sauvegarder': {
            const erreurs = validerGrille(ui.draft);
            if (erreurs.length) {
                ui.notice = { type: 'erreur', titre: `Sauvegarde refusée : ${erreurs.length} valeur(s) hors des plages autorisées.`, lignes: erreurs.map((e) => e.message) };
                render();
                return;
            }
            if (sauverStore(ui.draft)) {
                ui.store = ui.draft;
                ui.draft = null;
                ui.editing = false;
                ui.notice = { type: 'succes', titre: 'Favoris enregistrés dans ce navigateur.', lignes: [] };
                render();
            }
            break;
        }
        case 'ajouter-colonne':
            ajouterColonne();
            break;
        case 'supprimer-colonne': {
            const col = ui.draft.columns.find((c) => c.id === btn.dataset.col);
            if (col && window.confirm(`Supprimer la colonne « ${col.label} » ?`)) {
                ui.draft.columns = ui.draft.columns.filter((c) => c.id !== col.id);
                delete ui.draft.values[col.id];
                render();
            }
            break;
        }
        case 'exporter':
            exporterExcel();
            break;
        case 'importer':
            if (modifie() && !window.confirm('Les modifications non sauvegardées seront remplacées par le contenu du fichier. Continuer ?')) return;
            ui.overlay.querySelector('.resi-fav-file').click();
            break;
        case 'appliquer': {
            const erreurs = validerGrille(ui.store).filter((e) => !e.colId || e.colId === ui.selectedColId);
            if (erreurs.length) {
                ui.notice = { type: 'erreur', titre: `Application refusée : la colonne contient ${erreurs.length} valeur(s) hors des plages autorisées. Corrigez-la via « Modifier ».`, lignes: erreurs.map((e) => e.message) };
                render();
                return;
            }
            ui.confirmApply = true;
            render();
            break;
        }
        case 'annuler-appliquer':
            ui.confirmApply = false;
            render();
            break;
        case 'confirmer-appliquer': {
            const Capex = RC.Capex;
            if (!Capex || typeof Capex.applyFavori !== 'function') return;
            Capex.applyFavori(clone(ui.store.values[ui.selectedColId]), { ...ui.options });
            fermer();
            break;
        }
        default:
            break;
        }
    }

    function ajouterColonne() {
        const nomInput = ui.overlay.querySelector('.resi-fav-add-nom');
        const puissanceInput = ui.overlay.querySelector('.resi-fav-add-puissance');
        const source = ui.overlay.querySelector('.resi-fav-add-source').value;
        const label = nomInput.value.trim();
        const puissance = puissanceInput.value === '' ? null : Number(puissanceInput.value);
        const erreurs = [validerNomColonne(label, ui.draft.columns.map((c) => c.label)), validerPuissanceColonne(puissance)].filter(Boolean);
        if (erreurs.length) {
            ui.notice = { type: 'erreur', titre: 'Colonne non ajoutée.', lignes: erreurs };
            render();
            return;
        }
        const id = nouvelIdColonne();
        ui.draft.columns.push({ id, label, puissanceKwc: puissance });
        ui.draft.values[id] = clone(ui.draft.values[source] || {});
        ui.notice = null;
        render();
    }

    function fermer() {
        ui.overlay.style.display = 'none';
        ui.draft = null;
        ui.editing = false;
        ui.confirmApply = false;
    }

    function close() {
        if (!ui.overlay || ui.overlay.style.display === 'none') return;
        if (modifie() && !window.confirm('Fermer sans sauvegarder vos modifications ?')) return;
        fermer();
    }

    function open() {
        if (!ui.overlay) ui.overlay = creerOverlay();
        ui.overlay.querySelector('#resi-fav-title').innerHTML = '&#9733; ' + esc(cfg().titre);
        ui.store = chargerStore();
        ui.draft = null;
        ui.editing = false;
        ui.confirmApply = false;
        ui.notice = null;
        ui.optionsTouchees = false;
        ui.options = optionsParDefaut();
        ui.selectedColId = colonneLaPlusProche(ui.store.columns, puissanceProjet());
        render();
        ui.overlay.style.display = 'flex';
        ui.overlay.querySelector('.resi-fav-close').focus();

        // Présélection batterie/borne d'après le calepinage et l'IRVE (asynchrone) : ne remplace pas
        // un choix déjà fait entre-temps par l'utilisateur.
        const Capex = RC.Capex;
        if (Capex && typeof Capex.detecterEquipements === 'function') {
            Capex.detecterEquipements().then((eq) => {
                if (ui.optionsTouchees) return;
                cfg().inclusions.forEach((inc) => { ui.options[inc.option] = !!eq[inc.detection]; });
                ui.overlay.querySelectorAll('input[data-option]').forEach((el) => { el.checked = !!ui.options[el.dataset.option]; });
            }).catch((e) => console.warn('[Favoris chiffrage] Détection batterie/borne impossible :', e));
        }
    }

    RC.Favoris = {
        open,
        close,
        // Exposés pour les tests (tests/etude_economique/test_favoris_chiffrage.js).
        _internes: { storeParDefaut, validerGrille, parserClasseur, versFeuillesExcel, colonneLaPlusProche, chargerStore, STORAGE_KEY, STORAGE_KEY_PRO }
    };
})();
