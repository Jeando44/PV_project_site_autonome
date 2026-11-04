/**
 * Tableau CAPEX résidentiel (9 postes, TVA par ligne, vue Synthétique/Détaillée).
 *
 * Écrit son total TTC (÷1000, en k€) directement dans #total_capex_display à chaque
 * modification — c'est l'unique point d'intégration avec le moteur de calcul existant
 * (EtudesEconomiqueLogic.js::collectInputs() lit ce span, jamais modifié ici).
 *
 * Vue Synthétique = tableau récapitulatif (Poste | Total HT | Total TTC), alignement automatique.
 * Vue Détaillée = les lignes éditables de chaque poste (Qté/PU HT/TVA/Désignation/Référence).
 * Les deux vues partagent la même donnée sous-jacente (this.postes) : aucun total ne peut
 * diverger entre les deux modes, le switch ne fait que replier/déplier l'affichage.
 *
 * Bouton "Synchroniser depuis le calepinage" (syncFromCalepinage()) : renseigne les quantités/
 * références Panneaux/Onduleurs/Batterie/Pompage solaire depuis window.CalepinageMaisonIndiv
 * (calepinage "toiture multi-typologie") et la quantité de Bornes de recharge depuis la
 * configuration IRVE du projet — déclenchement manuel, ne touche jamais aux lignes ajoutées par
 * l'utilisateur en dehors des désignations reconnues.
 *
 * Profil PRO / Grand projet (window.ResidentielChiffrage.profil === 'pro', posé par
 * pro/ProEtudeEcoView.js avant init()) : bornes élargies et cartes Structure / Génie civil / Gestion
 * des eaux pluviales (cf. Rules.buildDefaultPostes), lignes Structure porteuse / Pannes masquées et
 * hors totaux selon le type de structure du projet, et total HT (TVA récupérable) transmis au moteur
 * via updateCapexDisplays() (EtudesEconomiqueLogic.js) au lieu d'être écrit dans #total_capex_display.
 */
(function () {
    'use strict';

    window.ResidentielChiffrage = window.ResidentielChiffrage || {};
    const Rules = () => window.ResidentielChiffrage.Rules;

    const state = {
        postes: [],
        viewMode: 'synthetique', // 'synthetique' | 'detaille'
        // Type de matériel de conversion ('chaine' | 'optimiseurs' | 'micro'), null tant qu'il n'a
        // pas pu être déduit d'un ancien chiffrage (cf. inferConversionType()) : rien n'est alors
        // verrouillé. Cf. Rules.CONVERSION_LOCKS pour les lignes figées à 0 selon le type.
        conversionType: 'chaine',
        container: null,
        profil: 'residentiel',
        // Profil PRO : 'ombriere_metal' / 'champ_solaire' présents dans le projet (cf.
        // detecterTypesStructure()), pilotent les lignes de Rules.LIGNES_CONDITIONNELLES.
        typesStructure: [],
        // Nombre de panneaux posés au calepinage (0 = calepinage vide ou non chargé) : quand il est
        // connu, la quantité de la ligne Panneaux en est une copie en lecture seule.
        panneauxCalepinage: 0,
        // TVA : 'par_ligne' (comportement historique) ou 'unique' (tvaGlobale appliquée à toutes les
        // lignes, sélecteurs de ligne grisés). Persistés avec le chiffrage (getData / setData).
        tvaMode: 'par_ligne',
        tvaGlobale: null,
        // Prix cible ('wc' : €/Wc x puissance du projet ; 'fixe' : prix de vente) et marge cible (%).
        // Persistés avec le chiffrage (getData / setData), cf. renderMarge().
        prixCible: { mode: 'wc', valeur: null },
        margeCible: 30,
        // Poste « Main-d'œuvre » compté dans le devis (case décochée par défaut : certaines
        // entreprises n'affichent pas ce prix). Décoché, le poste vaut 0 partout (totaux, marge,
        // moteur, devis imprimé) ; persisté avec le chiffrage (getData / setData).
        inclureMainOeuvre: false,
        // Mode de chiffrage du CAPEX : 'wc' (prix au Wc x puissance), 'fixe' (CAPEX total en k€) ou
        // 'detaille' (tableau du devis, défaut et chiffrages existants). Les deux saisies simples
        // sont sur la base du moteur (HT en PRO, TTC en résidentiel) et persistées avec le
        // chiffrage (getData / setData) ; les lignes du devis sont conservées, hors totaux.
        capexMode: 'detaille',
        capexPrixWc: null,
        capexFixeK: null
    };

    const POSTE_MAIN_OEUVRE = 'main_oeuvre';

    // ---------------------------------------------------------------------------------------------
    // Modes de chiffrage simplifiés (« Prix au Wc » / « CAPEX total »)
    // ---------------------------------------------------------------------------------------------

    function modeSimple() {
        return state.capexMode === 'wc' || state.capexMode === 'fixe';
    }

    /** Lit le mode et les deux saisies simples d'un chiffrage enregistré (absents = détaillé). */
    function lireModeCapex(data) {
        const mode = data && data.capexMode;
        state.capexMode = Rules().CAPEX_MODES.includes(mode) ? mode : 'detaille';
        const nombre = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
        state.capexPrixWc = data ? nombre(data.capexPrixWc) : null;
        state.capexFixeK = data ? nombre(data.capexFixeK) : null;
    }

    /** Validation de la saisie du mode simple courant (vide accepté : pas encore saisie). */
    function validationCapexSimple() {
        const rules = Rules();
        if (state.capexMode === 'wc') return rules.validateCapexPrixWc(state.capexPrixWc);
        if (state.capexMode === 'fixe') return rules.validateCapexFixe(state.capexFixeK, currentPuissanceKwc());
        return { valid: true, message: '' };
    }

    /**
     * CAPEX total (k€, base du moteur : HT en PRO, TTC en résidentiel) du mode simple courant, ou
     * null si la saisie est vide / invalide ou la puissance inconnue en mode « Prix au Wc ».
     * €/Wc x kWc x 1000 Wc / 1000 = k€ : CAPEX (k€) = prix au Wc x puissance (kWc).
     */
    function capexSimpleK() {
        if (!modeSimple() || !validationCapexSimple().valid) return null;
        if (state.capexMode === 'fixe') return state.capexFixeK;
        const puissance = currentPuissanceKwc();
        return state.capexPrixWc != null && puissance > 0 ? state.capexPrixWc * puissance : null;
    }

    /**
     * Saisie manquante ou invalide du mode simple, pour le contrôle bloquant avant le calcul de
     * rentabilité (EtudesEconomiqueLogic.js::validateStrictData). Vide en mode détaillé.
     */
    function erreursCapexSimple() {
        if (!modeSimple()) return [];
        const v = validationCapexSimple();
        if (!v.valid) return [v.message];
        const devise = Rules().getDeviseSymbol();
        if (state.capexMode === 'wc' && state.capexPrixWc == null) return [`Prix au Wc (${devise}/Wc) : valeur requise (mode de chiffrage « Prix au Wc »).`];
        if (state.capexMode === 'fixe' && state.capexFixeK == null) return [`CAPEX total (k${devise}) : valeur requise (mode de chiffrage « CAPEX total »).`];
        if (capexSimpleK() == null) return ['Puissance du projet inconnue : lancez d’abord le calcul de production.'];
        return [];
    }

    function changerModeCapex(mode) {
        if (!Rules().CAPEX_MODES.includes(mode) || mode === state.capexMode) return;
        state.capexMode = mode;
        render();
        pushTotalToEngine();
    }

    /** Poste hors devis : « Main-d'œuvre » quand la case n'est pas cochée. */
    function posteExclu(poste) {
        return poste.key === POSTE_MAIN_OEUVRE && !state.inclureMainOeuvre;
    }

    /**
     * Lit la case « Inclure la main-d'œuvre » d'un chiffrage enregistré. Absente (chiffrage antérieur
     * à la case) : cochée si le poste est déjà chiffré, pour ne pas changer le Capex d'un projet
     * existant sans action de l'utilisateur ; décochée sinon.
     */
    function lireMainOeuvre(data) {
        if (data && typeof data.inclureMainOeuvre === 'boolean') {
            state.inclureMainOeuvre = data.inclureMainOeuvre;
            return;
        }
        const poste = state.postes.find((p) => p.key === POSTE_MAIN_OEUVRE);
        state.inclureMainOeuvre = !!(data && poste && poste.lines.some((l) => lineTotals(l).totalHt > 0));
    }

    function changerInclureMainOeuvre(inclure) {
        state.inclureMainOeuvre = !!inclure;
        render();
        pushTotalToEngine();
    }

    /**
     * Types de structure du projet pour les lignes conditionnelles PRO : lus dans le calepinage
     * (typeMontage de chaque champ PV) ; s'il est vide, repli sur le type de projet vérifié en base
     * (une ombrière est alors supposée métallique, type proposé par défaut au calepinage).
     */
    function detecterTypesStructure() {
        const CM = window.CalepinageMaisonIndiv;
        let montages = [];
        if (CM && typeof CM.getTypesMontage === 'function') {
            try { montages = CM.getTypesMontage() || []; } catch (e) { montages = []; }
        }
        const types = new Set(montages.filter((t) => t === 'ombriere_metal' || t === 'champ_solaire'));
        if (!montages.length) {
            const typeProjet = String(window.ACTIVE_PROJECT_TYPE_PROJET || '');
            if (/^ombri/i.test(typeProjet)) types.add('ombriere_metal');
            if (typeProjet === 'Petit champ solaire') types.add('champ_solaire');
        }
        return Array.from(types);
    }

    function estExclue(line) {
        return state.profil === 'pro' && !Rules().isLigneApplicable(line.key, state.typesStructure);
    }

    /** Clés des lignes conditionnelles masquées (et hors totaux) pour le projet courant. */
    function lignesExclues() {
        if (state.profil !== 'pro') return [];
        return Object.keys(Rules().LIGNES_CONDITIONNELLES).filter((key) => !Rules().isLigneApplicable(key, state.typesStructure));
    }

    /**
     * Chiffrage PRO enregistré sans une carte du modèle courant (ex. cartes ajoutées depuis) : la
     * carte manquante est insérée à sa place, après le poste qui la précède dans le modèle.
     */
    function completerPostes(postes) {
        if (state.profil !== 'pro') return postes;
        const defauts = Rules().buildDefaultPostes(currentPuissanceKwc(), 'pro');
        const result = postes.slice();
        defauts.forEach((poste, i) => {
            if (result.some((p) => p.key === poste.key)) return;
            let pos = 0;
            for (let j = i - 1; j >= 0; j--) {
                const k = result.findIndex((p) => p.key === defauts[j].key);
                if (k !== -1) { pos = k + 1; break; }
            }
            result.splice(pos, 0, poste);
        });
        return result;
    }

    // --------------------------------------------------------------------------------------------
    // Frais d'activation batterie virtuelle (poste « Système de stockage par batterie »)
    // --------------------------------------------------------------------------------------------

    /** Prix mémorisé dans le navigateur pour ce projet (repli d'un devis enregistré sans la ligne). */
    function cleActivationBv() {
        const projetId = getCurrentProjetId();
        return projetId ? `skv_bv_activation_${projetId}` : null;
    }
    function prixActivationBvValide(valeur) {
        return Rules().validateLigneField('puHt', {
            posteKey: 'stockage', lineKey: Rules().LIGNE_ACTIVATION_BV.key, designation: '', rawValue: valeur
        }).valid;
    }
    function lirePrixActivationBvLocal() {
        const cle = cleActivationBv();
        if (!cle) return null;
        try {
            const brut = localStorage.getItem(cle);
            return (brut !== null && prixActivationBvValide(Number(brut))) ? Number(brut) : null;
        } catch (e) { return null; }
    }
    function memoriserPrixActivationBv() {
        const cle = cleActivationBv();
        const ligne = findLineByKey(Rules().LIGNE_ACTIVATION_BV.key);
        if (!cle || !ligne || !prixActivationBvValide(ligne.puHt)) return;
        try { localStorage.setItem(cle, String(ligne.puHt)); } catch (e) { /* stockage plein ou bloqué */ }
    }

    /**
     * Devis enregistré avant l'ajout de la ligne (projets existants) : elle est insérée sous
     * « Batterie », au prix mémorisé pour ce projet ou au prix par défaut (300 €).
     */
    function completerLigneActivationBv(postes) {
        const rules = Rules();
        const cle = rules.LIGNE_ACTIVATION_BV.key;
        if (postes.some((p) => (p.lines || []).some((l) => l.key === cle))) return postes;
        const stockage = postes.find((p) => p.key === rules.LIGNE_ACTIVATION_BV.posteKey);
        if (!stockage) return postes;
        const ligne = rules.ligneActivationBv(defaultTvaForPoste('stockage'));
        const prixLocal = lirePrixActivationBvLocal();
        if (prixLocal !== null) ligne.puHt = prixLocal;
        const lignes = (stockage.lines || []).slice();
        const iBatterie = lignes.findIndex((l) => l.key === 'batterie');
        lignes.splice(iBatterie + 1, 0, ligne);
        stockage.lines = lignes;
        return postes;
    }

    /** Batterie virtuelle retenue (case du calepinage / de l'étude économique). */
    function batterieVirtuelleRetenue() {
        return typeof window.batterieVirtuelleActive === 'function' && !!window.batterieVirtuelleActive();
    }

    /**
     * Quantité de la ligne d'activation : 1 si la batterie virtuelle est retenue, 0 sinon.
     * @returns {boolean} true si la quantité a changé
     */
    function syncActivationBv() {
        const ligne = findLineByKey(Rules().LIGNE_ACTIVATION_BV.key);
        if (!ligne) return false;
        const qte = batterieVirtuelleRetenue() ? 1 : 0;
        if (Number(ligne.qte) === qte) return false;
        ligne.qte = qte;
        return true;
    }

    function currentPuissanceKwc() {
        return parseFloat(document.getElementById('puissance')?.value) || 0;
    }

    /** Taux de TVA par défaut d'une NOUVELLE ligne pour un poste donné (règle métier résidentiel). */
    function defaultTvaForPoste(posteKey) {
        const rules = Rules();
        // Exception métier : le poste "Système de stockage par batterie" reste toujours à 20%.
        if (state.tvaMode === 'unique' && state.tvaGlobale != null) return state.tvaGlobale;
        return posteKey === 'stockage' ? 20 : rules.getDefaultTvaRate(currentPuissanceKwc());
    }

    /** Mode TVA unique : la TVA globale écrase le taux de toutes les lignes. */
    function appliquerTvaGlobale() {
        if (state.tvaMode !== 'unique' || state.tvaGlobale == null) return;
        state.postes.forEach((poste) => poste.lines.forEach((line) => {
            line.tvaPct = state.tvaGlobale;
            line.tvaManual = true;
        }));
    }

    /** Taux le plus fréquent des lignes (valeur initiale de la TVA globale), sinon taux par défaut. */
    function tvaMajoritaire() {
        const compte = new Map();
        state.postes.forEach((poste) => poste.lines.forEach((line) => {
            const t = Number(line.tvaPct);
            if (Rules().TVA_RATES.includes(t)) compte.set(t, (compte.get(t) || 0) + 1);
        }));
        let meilleur = null;
        compte.forEach((n, t) => { if (meilleur === null || n > compte.get(meilleur)) meilleur = t; });
        return meilleur !== null ? meilleur : Rules().getDefaultTvaRate(currentPuissanceKwc());
    }

    /** Lit le mode TVA d'un chiffrage enregistré (absent = 'par_ligne' : projets existants). */
    function lireModeTva(data) {
        const mode = data && data.tvaMode;
        state.tvaMode = Rules().TVA_MODES.includes(mode) ? mode : 'par_ligne';
        const globale = data ? Number(data.tvaGlobale) : NaN;
        state.tvaGlobale = (data && data.tvaGlobale != null && Rules().TVA_RATES.includes(globale)) ? globale : null;
        if (state.tvaMode === 'unique' && state.tvaGlobale == null) state.tvaGlobale = tvaMajoritaire();
        appliquerTvaGlobale();
    }

    function changerModeTva(mode) {
        if (!Rules().TVA_MODES.includes(mode) || mode === state.tvaMode) return;
        state.tvaMode = mode;
        // Passage en TVA unique : taux dominant des lignes (ou dernière TVA globale) ; retour en TVA
        // par ligne : chaque ligne garde la dernière valeur globale et redevient modifiable.
        if (mode === 'unique' && state.tvaGlobale == null) state.tvaGlobale = tvaMajoritaire();
        appliquerTvaGlobale();
        render();
        pushTotalToEngine();
    }

    function changerTvaGlobale(valeur) {
        const taux = Number(valeur);
        if (valeur === '' || !Rules().TVA_RATES.includes(taux)) return;
        state.tvaGlobale = taux;
        appliquerTvaGlobale();
        render();
        pushTotalToEngine();
    }

    // ---------------------------------------------------------------------------------------------
    // Prix cible et marge
    //
    // Marge sur coût (demande explicite : Capex 100 € + marge 25 % = prix de vente 125 €) :
    //   marge de vente = (prix cible - base) / base
    // base = Capex hors aides (une aide n'est pas un coût), main-d'œuvre comprise seulement si la case
    // « Inclure la main-d'œuvre » est cochée (sinon le poste vaut 0) ; HT en PRO / Grand projet, TTC
    // en résidentiel (un particulier ne récupère pas la TVA). Le prix cible saisi suit la même base.
    // ---------------------------------------------------------------------------------------------

    /** Lit prix cible et marge cible d'un chiffrage enregistré (absents = valeurs par défaut). */
    function lireCibles(data) {
        const rules = Rules();
        const p = data && data.prixCible;
        const mode = p && rules.PRIX_CIBLE_RULES[p.mode] ? p.mode : 'wc';
        const valeur = p && p.valeur != null && Number.isFinite(Number(p.valeur)) ? Number(p.valeur) : null;
        state.prixCible = { mode, valeur };
        const marge = data ? Number(data.margeCible) : NaN;
        state.margeCible = data && data.margeCible != null && Number.isFinite(marge) ? marge : rules.MARGE_CIBLE_RULE.defaut;
    }

    function suffixeTaxe() {
        return state.profil === 'pro' ? 'HT' : 'TTC';
    }

    /** Capex hors aides, sur la base HT (PRO) ou TTC (résidentiel) ; main-d'œuvre selon la case. */
    function baseMarge() {
        // Mode simplifié : la saisie est déjà sur la base HT (PRO) / TTC (résidentiel).
        if (modeSimple()) return (capexSimpleK() || 0) * 1000;
        const cle = state.profil === 'pro' ? 'totalHt' : 'totalTtc';
        return state.postes.reduce((s, poste) => (poste.deduction ? s : s + posteTotals(poste)[cle]), 0);
    }

    /** Prix cible en devise (null si non saisi, invalide ou puissance inconnue en mode €/Wc). */
    function prixCibleEuros() {
        const { mode, valeur } = state.prixCible;
        if (valeur == null || !Rules().validatePrixCible(mode, valeur).valid) return null;
        if (mode === 'fixe') return valeur;
        const wc = currentPuissanceKwc() * 1000;
        return wc > 0 ? valeur * wc : null;
    }

    const fmtEuros = (v) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 });

    /** Bloc « Prix de vente cible / Marge de vente / Marge cible », sur la ligne de la TVA. */
    function renderMarge() {
        const devise = Rules().getDeviseSymbol();
        const { mode, valeur } = state.prixCible;
        const regle = Rules().PRIX_CIBLE_RULES[mode];
        const mc = Rules().MARGE_CIBLE_RULE;
        return `<div class="resi-marge">
                <div class="resi-marge-ligne">
                <label class="resi-marge-champ">Prix de vente cible
                    <select class="resi-prix-cible-mode" title="Prix en ${devise}/Wc (multiplié par la puissance du projet) ou prix de vente fixe">
                        <option value="wc"${mode === 'wc' ? ' selected' : ''}>${devise}/Wc</option>
                        <option value="fixe"${mode === 'fixe' ? ' selected' : ''}>${devise} fixe</option>
                    </select>
                    <input type="number" class="resi-prix-cible" step="any" min="${regle.min}" max="${regle.max}" value="${valeur == null ? '' : valeur}" placeholder="${regle.min.toLocaleString('fr-FR')} à ${regle.max.toLocaleString('fr-FR')}">
                    <span class="resi-prix-cible-unite"></span>
                    <span class="resi-prix-cible-euros"></span>
                </label>
                <span class="resi-marge-champ">Marge de vente : <strong class="resi-marge-vente">–</strong></span>
                <label class="resi-marge-champ">Marge cible
                    <input type="number" class="resi-marge-cible" step="any" min="${mc.min}" max="${mc.max}" value="${state.margeCible == null ? '' : state.margeCible}"> %
                </label>
                </div>
                <div class="resi-field-error resi-marge-erreur" style="display:none;"></div>
            </div>`;
    }

    /**
     * Met à jour le résultat du bloc marge (sans re-rendu des champs : la saisie en cours garde le
     * focus). Valeurs hors bornes : champ en rouge et message ; la sauvegarde est alors bloquée
     * (.is-invalid, cf. ResidentielChiffrageDB.js), comme pour les lignes du devis.
     */
    function majMarge() {
        const bloc = state.container && state.container.querySelector('.resi-marge');
        if (!bloc) return;
        const rules = Rules();
        const devise = rules.getDeviseSymbol();
        const taxe = suffixeTaxe();
        const prixInput = bloc.querySelector('.resi-prix-cible');
        const margeInput = bloc.querySelector('.resi-marge-cible');
        const regle = rules.PRIX_CIBLE_RULES[state.prixCible.mode];
        prixInput.min = regle.min;
        prixInput.max = regle.max;
        prixInput.placeholder = `${regle.min.toLocaleString('fr-FR')} à ${regle.max.toLocaleString('fr-FR')}`;
        bloc.querySelector('.resi-prix-cible-unite').textContent = state.prixCible.mode === 'wc' ? `${devise}/Wc ${taxe}` : `${devise} ${taxe}`;

        const vPrix = rules.validatePrixCible(state.prixCible.mode, state.prixCible.valeur);
        const vMarge = rules.validateMargeCible(state.margeCible);
        prixInput.classList.toggle('is-invalid', !vPrix.valid);
        margeInput.classList.toggle('is-invalid', !vMarge.valid);
        const erreur = bloc.querySelector('.resi-marge-erreur');
        const messages = [vPrix.message, vMarge.message].filter(Boolean);
        erreur.textContent = messages.join(' ');
        erreur.style.display = messages.length ? 'block' : 'none';

        const base = baseMarge();
        const prix = prixCibleEuros();
        // Mode €/Wc : prix de vente correspondant en devise (puissance du projet).
        let enEuros = '';
        if (state.prixCible.mode === 'wc' && prix != null) enEuros = `= ${fmtEuros(prix)} ${devise} ${taxe}`;
        else if (state.prixCible.mode === 'wc' && vPrix.valid && state.prixCible.valeur != null) enEuros = '(puissance du projet inconnue)';
        bloc.querySelector('.resi-prix-cible-euros').textContent = enEuros;
        const venteEl = bloc.querySelector('.resi-marge-vente');
        let marge = null;
        if (prix != null && base > 0) marge = ((prix - base) / base) * 100;
        venteEl.textContent = marge == null ? '–' : `${marge.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
        // Marge cible en vert si la marge de vente l'atteint, en rouge sinon (rien sans marge calculée).
        const atteinte = marge != null && vMarge.valid ? marge >= state.margeCible : null;
        const couleur = atteinte == null ? '' : (atteinte ? '#15803d' : '#dc2626');
        margeInput.style.color = vMarge.valid ? couleur : '';
        margeInput.style.borderColor = vMarge.valid ? couleur : '';
        margeInput.style.fontWeight = couleur ? '700' : '';
        venteEl.style.color = couleur;
        // Mêmes valeurs sur la ligne « Total Capex », pour comparer au Capex sans remonter.
        const totalPrixEl = state.container.querySelector('.resi-total-prix-cible');
        const totalMargeEl = state.container.querySelector('.resi-total-marge-vente');
        if (totalPrixEl) totalPrixEl.textContent = prix == null ? '–' : `${fmtEuros(prix)} ${devise} ${taxe}`;
        if (totalMargeEl) {
            totalMargeEl.textContent = venteEl.textContent;
            totalMargeEl.style.color = couleur;
        }
        // Infobulle seulement (plus de note sous le bloc) : prix de vente qui atteint la marge cible.
        margeInput.title = base > 0 && vMarge.valid
            ? `Prix de vente pour la marge cible : ${fmtEuros(base * (1 + state.margeCible / 100))} ${devise} ${taxe}` : '';
    }

    function brancherMarge() {
        const bloc = state.container && state.container.querySelector('.resi-marge');
        if (!bloc) return;
        const enregistrer = () => {
            majMarge();
            // Même déclencheur que les lignes : sauvegarde différée (ResidentielChiffrageDB.js).
            document.dispatchEvent(new CustomEvent('residentielCapexChanged', { detail: grandTotals() }));
        };
        bloc.querySelector('.resi-prix-cible-mode').addEventListener('change', (e) => {
            state.prixCible = { mode: e.target.value, valeur: null };
            bloc.querySelector('.resi-prix-cible').value = '';
            enregistrer();
        });
        bloc.querySelector('.resi-prix-cible').addEventListener('input', (e) => {
            const v = e.target.value.trim();
            state.prixCible.valeur = v === '' ? null : Number(v);
            enregistrer();
        });
        bloc.querySelector('.resi-marge-cible').addEventListener('input', (e) => {
            const v = e.target.value.trim();
            state.margeCible = v === '' ? null : Number(v);
            enregistrer();
        });
        majMarge();
    }

    /**
     * Ligne « TVA unique / TVA par ligne » + « TVA globale », en tête du chiffrage CAPEX, avec le
     * bloc prix de vente cible / marge aligné à droite.
     */
    function renderTvaGlobale() {
        const unique = state.tvaMode === 'unique';
        const options = Rules().TVA_RATES.map((r) => `<option value="${r}"${r === state.tvaGlobale ? ' selected' : ''}>${r}%</option>`).join('');
        const vide = state.tvaGlobale == null ? '<option value="" selected>—</option>' : '';
        const inactif = unique ? '' : 'disabled title="Choisissez « TVA unique » pour appliquer un même taux à toutes les lignes"';
        return `<div class="resi-tva-globale-row">
                <span class="resi-tva-groupe">
                <span class="radio-group resi-tva-mode">
                    <label><input type="radio" name="resi_tva_mode" value="unique" ${unique ? 'checked' : ''}> TVA unique</label>
                    <label><input type="radio" name="resi_tva_mode" value="par_ligne" ${unique ? '' : 'checked'}> TVA par ligne</label>
                </span>
                <label class="resi-tva-globale-label">TVA globale :
                    <select class="resi-tva-globale" ${inactif}>${vide}${options}</select>
                </label>
                </span>
                ${renderMarge()}
            </div>`;
    }

    /**
     * Réapplique le taux de TVA par défaut (règle puissance) à toutes les lignes qui n'ont jamais
     * été modifiées manuellement par l'utilisateur (line.tvaManual === false) — corrige le cas où
     * la puissance du projet n'était pas encore connue au moment de la création des lignes par
     * défaut (Capex.init() appelé avant l'injection de la puissance depuis le calepinage).
     * N'affecte jamais le poste "stockage" (toujours 20%, indépendant de la puissance).
     */
    function reapplyDefaultTvaRates() {
        if (state.tvaMode === 'unique') return; // la TVA globale fait foi
        const rules = Rules();
        const tva = rules.getDefaultTvaRate(currentPuissanceKwc());
        let changed = false;
        state.postes.forEach((poste) => {
            if (poste.key === 'stockage') return;
            poste.lines.forEach((line) => {
                if (!line.tvaManual && line.tvaPct !== tva) {
                    line.tvaPct = tva;
                    changed = true;
                }
            });
        });
        if (changed) {
            render();
            pushTotalToEngine();
        }
    }

    /** Trouve, dans un poste donné, la première ligne dont la désignation contient `needle` (insensible à la casse). */
    /**
     * @param {boolean} [exact] - CORRECTIF (demande explicite : "séparer onduleurs de
     *   micro-onduleurs") : depuis l'éclatement de "Onduleurs/Micro-onduleurs" en 2 lignes
     *   distinctes, un simple `includes('onduleur')` matcherait indifféremment "Onduleurs" ET
     *   "Micro-onduleurs" (sous-chaîne commune) — `exact` permet de cibler une désignation précise
     *   (comparaison stricte, insensible à la casse) plutôt que la première ligne trouvée.
     */
    function findLineByDesignation(posteKey, needle, exact) {
        const poste = state.postes.find((p) => p.key === posteKey);
        if (!poste) return null;
        const lower = needle.toLowerCase();
        return poste.lines.find((l) => {
            const d = (l.designation || '').toLowerCase();
            return exact ? d === lower : d.includes(lower);
        }) || null;
    }

    function findLineByKey(lineKey) {
        for (const poste of state.postes) {
            const line = poste.lines.find((l) => l.key === lineKey);
            if (line) return line;
        }
        return null;
    }

    /** Total des panneaux posés et 1re référence de panneau, lus dans le calepinage. */
    function lirePanneauxCalepinage() {
        const CM = window.CalepinageMaisonIndiv;
        if (!CM || typeof CM.getAllPvFieldSummaries !== 'function') return { total: 0, ref: '' };
        let summaries = [];
        try { summaries = CM.getAllPvFieldSummaries() || []; } catch (e) { summaries = []; }
        const total = summaries.reduce((sum, s) => sum + (Number(s.panelCount) || 0), 0);
        const avecRef = summaries.find((s) => s.panelRef);
        return { total, ref: avecRef ? avecRef.panelRef : '' };
    }

    /**
     * Quantité de panneaux = calepinage, pour tous les types d'étude (demande explicite : elle ne
     * vient jamais des Favoris chiffrage). Appelée à l'initialisation, au rechargement des données
     * et à chaque ouverture du modal ; sans effet tant que le calepinage ne compte aucun panneau.
     * @param {boolean} [rendre=true] - re-rendre et transmettre le total au moteur.
     */
    function syncPanneauxCalepinage(rendre) {
        const { total, ref } = lirePanneauxCalepinage();
        state.panneauxCalepinage = total;
        const line = findLineByKey('panneaux_solaires') || findLineByDesignation('materiels_pv', 'Panneaux');
        if (line && total > 0) {
            line.qte = total;
            if (ref) line.reference = ref;
        }
        if (rendre !== false && state.container) {
            render();
            pushTotalToEngine();
        }
    }

    /** Remet à 0 la quantité des lignes que le type de conversion courant rend inutilisées. */
    function applyConversionLocks() {
        const rules = Rules();
        state.postes.forEach((poste) => poste.lines.forEach((line) => {
            if (rules.isQteLockedForConversion(state.conversionType, line.key)) line.qte = 0;
        }));
    }

    /**
     * Change le type de conversion. Un matériel qui redevient utilisé et dont la quantité est à 0
     * (verrou précédent) reprend une quantité plausible : un par panneau pour les micro-onduleurs et
     * les optimiseurs, 1 pour l'onduleur central et le coffret DC.
     */
    function changeConversionType(newType) {
        const rules = Rules();
        const oldType = state.conversionType;
        state.conversionType = newType;
        const panneaux = findLineByKey('panneaux_solaires');
        const nbPanneaux = panneaux ? Number(panneaux.qte) || 0 : 0;
        state.postes.forEach((poste) => poste.lines.forEach((line) => {
            const deverrouillee = rules.isQteLockedForConversion(oldType, line.key)
                && !rules.isQteLockedForConversion(newType, line.key);
            if (deverrouillee && !(Number(line.qte) > 0)) {
                const parPanneau = line.key === 'micro_onduleurs' || line.key === 'optimiseurs';
                line.qte = (parPanneau && nbPanneaux > 0) ? nbPanneaux : 1;
            }
        }));
        applyConversionLocks();
    }

    /**
     * Chiffrage enregistré avant l'ajout du sélecteur (pas de conversionType) : déduit le type des
     * lignes réellement chiffrées (quantité ET prix non nuls). En cas d'ambiguïté (micro-onduleurs
     * chiffrés en même temps qu'un onduleur central, des optimiseurs ou un coffret DC), aucun type
     * n'est retenu : rien n'est verrouillé, aucune donnée chiffrée n'est remise à 0 sans choix
     * explicite de l'utilisateur.
     */
    function inferConversionType(postes) {
        const chiffree = (key) => postes.some((p) => (p.lines || []).some((l) => l.key === key && Number(l.qte) > 0 && Number(l.puHt) > 0));
        if (chiffree('micro_onduleurs')) {
            return (chiffree('onduleurs') || chiffree('optimiseurs') || chiffree('coffret_dc')) ? null : 'micro';
        }
        return chiffree('optimiseurs') ? 'optimiseurs' : 'chaine';
    }

    function resolveConversionType(data) {
        if (data && Object.prototype.hasOwnProperty.call(data, 'conversionType')) {
            return Rules().CONVERSION_LOCKS[data.conversionType] ? data.conversionType : null;
        }
        return inferConversionType((data && data.postes) || []);
    }

    /** Type de conversion lu dans le résumé du calepinage (une entrée par maison), ou null. */
    function conversionTypeFromCalepinage(houses) {
        const CM = window.CalepinageMaisonIndiv || {};
        const typeMicro = CM.TYPE_ONDULEUR_MICRO || 'Micro-onduleur';
        if (houses.some((h) => h.onduleurType === typeMicro)) return 'micro';
        if (houses.some((h) => h.optimiseurRef)) return 'optimiseurs';
        if (houses.some((h) => h.hasOnduleur)) return 'chaine';
        return null;
    }

    function getCurrentProjetId() {
        if (window.calepinageService && typeof window.calepinageService.getCurrentProjetId === 'function') {
            const id = window.calepinageService.getCurrentProjetId();
            if (id) return id;
        }
        return localStorage.getItem('current_projet_id');
    }

    /**
     * Synchronise les quantités (et références quand disponibles) des lignes Panneaux, Onduleurs,
     * Batterie, Borne de recharge et Pompage solaire depuis le calepinage "toiture multi-typologie"
     * (window.CalepinageMaisonIndiv, cf. calepinage_maison_orchestrateur.js) + la configuration IRVE
     * du projet (bornes de recharge). Déclenchement manuel (bouton) plutôt qu'automatique/réactif :
     * plus prévisible, l'utilisateur choisit quand écraser ses éventuelles saisies manuelles.
     *
     * Le type de conversion (chaîne / optimiseurs / micro-onduleurs) est déduit du type d'onduleur
     * et de l'optimiseur choisis dans le calepinage (cf. getAllHousesEquipmentSummary()), puis les
     * lignes non utilisées sont remises à 0 (cf. applyConversionLocks()).
     */
    /**
     * Bornes de recharge : configuration IRVE du projet (project-wide, pas par maison — cf.
     * calepinage_maison_formulaires.js::updateBorneEquipmentAvailability(), même route).
     */
    async function fetchBorneQtyIrve() {
        let borneQty = 0;
        try {
            const projetId = getCurrentProjetId();
            if (projetId) {
                const res = await fetch(`/concevoir_mon_projet/parametre-projet/${projetId}/irve/load`);
                const json = await res.json();
                const simpleInputs = json && json.config && json.config.data && json.config.data.simpleInputs;
                if (simpleInputs) {
                    Object.entries(simpleInputs).forEach(([k, v]) => {
                        if (/^qty-\d+$/.test(k)) borneQty += parseFloat(v) || 0;
                    });
                }
            }
        } catch (e) {
            console.warn('[ResidentielCapexTable] Lecture des bornes IRVE impossible :', e);
        }
        return borneQty;
    }

    /**
     * Présence d'une batterie / d'une borne dans le projet, pour présélectionner les cases
     * « Inclure » des Favoris chiffrage : calepinage (batterie) et configuration IRVE (borne), avec
     * repli sur le tableau lui-même (ligne chiffrée : quantité et prix non nuls).
     */
    async function detecterEquipements() {
        const CM = window.CalepinageMaisonIndiv;
        const houses = (CM && typeof CM.getAllHousesEquipmentSummary === 'function') ? (CM.getAllHousesEquipmentSummary() || []) : [];
        const chiffree = (key) => {
            const line = findLineByKey(key);
            return !!line && Number(line.qte) > 0 && Number(line.puHt) > 0;
        };
        const borneQty = await fetchBorneQtyIrve();
        // PRO : génie civil et eaux pluviales présélectionnés pour une ombrière ou un petit champ
        // (ouvrages au sol), pas pour une toiture.
        const typeProjet = String(window.ACTIVE_PROJECT_TYPE_PROJET || '');
        const auSol = state.typesStructure.length > 0 || /^ombri/i.test(typeProjet) || typeProjet === 'Petit champ solaire';
        return {
            batterie: houses.some((h) => h.batteryRef) || chiffree('batterie'),
            borne: borneQty > 0 || chiffree('borne_recharge'),
            genieCivil: auSol,
            eauxPluviales: auSol
        };
    }

    async function syncFromCalepinage() {
        const rules = Rules();
        const CM = window.CalepinageMaisonIndiv;
        if (!CM || typeof CM.getAllPvFieldSummaries !== 'function') {
            rules.showAlert("Aucune donnée de calepinage \"toiture multi-typologie\" disponible pour cette synchronisation.");
            return;
        }

        const pvSummaries = CM.getAllPvFieldSummaries() || [];
        const houses = (typeof CM.getAllHousesEquipmentSummary === 'function') ? CM.getAllHousesEquipmentSummary() : [];
        if (state.profil === 'pro') state.typesStructure = detecterTypesStructure();

        const totalPanels = pvSummaries.reduce((sum, s) => sum + (Number(s.panelCount) || 0), 0);
        syncPanneauxCalepinage(false);

        // Type de conversion lu dans le calepinage (reste modifiable ensuite via le sélecteur), puis
        // un micro-onduleur / un optimiseur par panneau.
        const conversionType = conversionTypeFromCalepinage(houses);
        if (conversionType) changeConversionType(conversionType);
        const ligneParPanneau = { micro: 'micro_onduleurs', optimiseurs: 'optimiseurs' }[state.conversionType];
        const parPanneauLine = ligneParPanneau ? findLineByKey(ligneParPanneau) : null;
        if (parPanneauLine && totalPanels > 0) {
            parPanneauLine.qte = totalPanels;
        }

        const onduleurCount = houses.filter((h) => h.hasOnduleur).length;
        const onduleurLine = findLineByDesignation('materiels_pv', 'Onduleurs', true);
        if (onduleurLine && onduleurCount > 0) {
            onduleurLine.qte = onduleurCount;
        }

        const batteryHouses = houses.filter((h) => h.batteryRef);
        // Exact : « Frais d'activation batterie virtuelle » contient aussi « batterie ».
        const batteryLine = findLineByKey('batterie') || findLineByDesignation('stockage', 'Batterie', true);
        if (batteryLine && batteryHouses.length > 0) {
            batteryLine.qte = batteryHouses.length;
            batteryLine.reference = batteryHouses[0].batteryRef;
        }

        const pompageHouses = houses.filter((h) => h.pompageSolaireActif);
        const pompageLine = findLineByDesignation('autres', 'Pompage solaire');
        if (pompageLine && pompageHouses.length > 0) {
            pompageLine.qte = pompageHouses.length;
            if (pompageHouses[0].pompageSolaireRef) pompageLine.reference = pompageHouses[0].pompageSolaireRef;
        }

        const borneQty = await fetchBorneQtyIrve();
        const borneLine = findLineByDesignation('borne', 'Borne');
        if (borneLine && borneQty > 0) {
            borneLine.qte = borneQty;
        }

        applyConversionLocks();
        render();
        pushTotalToEngine();
    }

    /**
     * Applique une colonne des Favoris chiffrage (cf. ResidentielFavorisChiffrage.js) : PU HT et TVA
     * de chaque ligne par défaut, reconnue par sa clé ; quantités seulement si demandé. Les lignes
     * ajoutées par l'utilisateur (sans clé) et les quantités verrouillées ne sont jamais touchées.
     * Batterie et borne : quantité 0 si non incluses, au moins 1 sinon. Idem en PRO pour toutes les
     * lignes des cartes Génie civil / Gestion des eaux pluviales (0 = « non concerné », accepté).
     * @param {Object<string, {qte:number, puHt:number, tvaPct:number}>} values - par clé de ligne
     * @param {{withQuantities:boolean, includeBatterie:boolean, includeBorne:boolean,
     *          includeGenieCivil?:boolean, includeEauxPluviales?:boolean}} options
     * @returns {number} nombre de lignes mises à jour
     */
    function applyFavori(values, options) {
        const rules = Rules();
        const opts = options || {};
        const inclusion = { batterie: !!opts.includeBatterie, borne_recharge: !!opts.includeBorne };
        const inclusionPoste = state.profil === 'pro'
            ? { genie_civil: !!opts.includeGenieCivil, eaux_pluviales: !!opts.includeEauxPluviales } : {};
        let count = 0;
        state.postes.forEach((poste) => poste.lines.forEach((line) => {
            const v = line.key ? values[line.key] : null;
            if (!v) return;
            line.puHt = v.puHt;
            line.tvaPct = v.tvaPct;
            // TVA choisie explicitement via le favori : ne plus la recalculer selon la puissance.
            line.tvaManual = true;
            const inclue = Object.prototype.hasOwnProperty.call(inclusion, line.key) ? inclusion[line.key]
                : (Object.prototype.hasOwnProperty.call(inclusionPoste, poste.key) ? inclusionPoste[poste.key] : null);
            if (inclue !== null) {
                const qteVoulue = opts.withQuantities ? v.qte : Number(line.qte) || 0;
                line.qte = inclue ? Math.max(1, qteVoulue) : 0;
            } else if (opts.withQuantities && !rules.isQteLockedForConversion(state.conversionType, line.key)
                && !rules.isQteDepuisCalepinage(line.key) && !rules.isQteDepuisBatterieVirtuelle(line.key)) {
                // Quantité de panneaux : jamais depuis un favori (elle vient du calepinage).
                line.qte = v.qte;
            }
            count++;
        }));
        // TVA unique : la TVA globale l'emporte sur celle du favori (décision utilisateur).
        appliquerTvaGlobale();
        applyConversionLocks();
        syncActivationBv();
        render();
        pushTotalToEngine();
        return count;
    }

    function lineTotals(line) {
        const qte = Number(line.qte) || 0;
        const puHt = Number(line.puHt) || 0;
        const tva = Number(line.tvaPct) || 0;
        const totalHt = qte * puHt;
        const totalTtc = totalHt * (1 + tva / 100);
        return { totalHt, totalTtc };
    }

    function posteTotals(poste) {
        if (posteExclu(poste)) return { totalHt: 0, totalTtc: 0 };
        return poste.lines.reduce((acc, line) => {
            if (estExclue(line)) return acc;
            const t = lineTotals(line);
            acc.totalHt += t.totalHt;
            acc.totalTtc += t.totalTtc;
            return acc;
        }, { totalHt: 0, totalTtc: 0 });
    }

    function grandTotals() {
        return state.postes.reduce((acc, poste) => {
            const t = posteTotals(poste);
            if (poste.deduction) {
                acc.totalHt -= t.totalHt;
                acc.totalTtc -= t.totalTtc;
            } else {
                acc.totalHt += t.totalHt;
                acc.totalTtc += t.totalTtc;
            }
            return acc;
        }, { totalHt: 0, totalTtc: 0 });
    }

    /** Point d'intégration moteur : pousse le total CAPEX TTC (k€) dans #total_capex_display. */
    /**
     * @param {boolean} [silencieux] - écrire le CAPEX du moteur sans signaler de modification (pas
     *   d'enregistrement différé) : resynchronisation avant la collecte des saisies du calcul.
     */
    function pushTotalToEngine(silencieux) {
        if (!silencieux) memoriserPrixActivationBv();
        const totals = grandTotals();
        if (state.profil === 'pro') {
            // PRO : updateCapexDisplays() lit getEngineCapexK() (HT), y ajoute le groupe électrogène
            // en mode hybride et écrit total/ratio ; updateFinanceCalculations() la rappelle et met
            // à jour la dette.
            if (typeof window.updateFinanceCalculations === 'function') window.updateFinanceCalculations();
            else if (typeof window.updateCapexDisplays === 'function') window.updateCapexDisplays();
            if (!silencieux) document.dispatchEvent(new CustomEvent('residentielCapexChanged', { detail: totals }));
            return;
        }
        // Mode « Prix au Wc » / « CAPEX total » : la saisie (TTC) remplace le total du devis ; 0
        // tant qu'elle manque (le calcul est alors bloqué par validateStrictData).
        const totalTtcMoteur = modeSimple() ? (capexSimpleK() || 0) * 1000 : totals.totalTtc;
        const el = document.getElementById('total_capex_display');
        if (el) {
            el.textContent = (totalTtcMoteur / 1000).toFixed(2);
        }
        // Ratio CAPEX (€/Wc) consommé par le moteur/l'affichage Pro-Grand — jamais de suffixe unité
        // ici (déjà fourni par le template autour de #ratio_capex_display).
        const ratioEl = document.getElementById('ratio_capex_display');
        const puissanceKwc = currentPuissanceKwc();
        const puissanceWc = puissanceKwc * 1000;
        if (ratioEl) {
            ratioEl.textContent = puissanceWc > 0 ? (totalTtcMoteur / puissanceWc).toFixed(2) : '0';
        }
        // CORRECTIF (unité €/kWc disparaissait) : #resi_ratio_capex_kwc est un élément propre à la
        // vue résidentielle dont le texte INCLUT déjà l'unité (posé par render(), toujours appelé
        // juste avant pushTotalToEngine() dans ce fichier) — ne plus l'écraser ici avec la valeur
        // brute sans unité.
        if (!silencieux) document.dispatchEvent(new CustomEvent('residentielCapexChanged', { detail: totals }));
    }

    function inverterDatalistOptions() {
        try {
            if (Array.isArray(window.inverterDB)) {
                return window.inverterDB.map((o) => o.reference || o.ref || o.nom || '').filter(Boolean);
            }
        } catch (e) { /* catalogue non chargé, tant pis */ }
        return [];
    }

    function escapeAttr(str) {
        return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function renderSynthTable() {
        const devise = Rules().getDeviseSymbol();
        const rows = state.postes.map((poste) => {
            const t = posteTotals(poste);
            return `<tr${posteExclu(poste) ? ' class="resi-poste-exclu"' : ''}>
                <td class="resi-synth-label">${poste.label}${poste.deduction ? ' <em>(déduit)</em>' : ''}${posteExclu(poste) ? ' <em>(non incluse au devis)</em>' : ''}</td>
                <td class="resi-synth-val">${t.totalHt.toFixed(2)} ${devise}</td>
                <td class="resi-synth-val">${t.totalTtc.toFixed(2)} ${devise}</td>
            </tr>`;
        }).join('');
        return `<table class="resi-synth-table">
            <thead><tr><th>Poste</th><th>Total HT</th><th>Total TTC</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    function renderConversionSelect() {
        const types = Rules().CONVERSION_TYPES;
        // Parcours Chiffrage : pas de dimensionnement, ces quantités sont saisies à la main.
        const chiffrage = typeof window.isChiffrageProject === 'function' && window.isChiffrageProject();
        const options = (state.conversionType ? '' : '<option value="" selected>— À choisir —</option>')
            + types.map((t) => `<option value="${t.value}"${t.value === state.conversionType ? ' selected' : ''}>${t.label}</option>`).join('');
        return `<div class="resi-conversion-row">
                <label>Type de conversion : <select class="resi-conversion-select">${options}</select></label>
                <span class="resi-conversion-hint">Quantités des matériels non utilisés bloquées à 0.${chiffrage ? ' Saisissez le nombre d’onduleurs / micro-onduleurs et d’optimiseurs.' : ''}</span>
            </div>`;
    }

    function renderDetailBlocks() {
        const rules = Rules();
        const devise = rules.getDeviseSymbol();
        const tvaOptions = rules.TVA_RATES.map((r) => `<option value="${r}">${r}%</option>`).join('');
        const invOptions = inverterDatalistOptions();

        let html = `<datalist id="resi_inverter_datalist">${invOptions.map((r) => `<option value="${r}">`).join('')}</datalist>`;

        state.postes.forEach((poste, posteIdx) => {
            const totals = posteTotals(poste);
            const showReference = !poste.hideReference;
            // Main-d'œuvre non incluse : lignes visibles mais grisées, non saisissables, hors totaux.
            const exclu = posteExclu(poste);
            const inactif = exclu ? ' disabled' : '';
            const totalPoste = exclu ? 'Non incluse au devis'
                : `Total HT : ${totals.totalHt.toFixed(2)} ${devise} | Total TTC : ${totals.totalTtc.toFixed(2)} ${devise}${poste.deduction ? ' (déduit)' : ''}`;

            html += `<div class="resi-poste-block${exclu ? ' resi-poste-exclu' : ''}" data-poste-idx="${posteIdx}">
                <div class="resi-poste-title">
                    <strong>${poste.label}</strong>
                    <span class="resi-poste-total">${totalPoste}</span>
                </div>
                ${poste.key === 'materiels_pv' ? renderConversionSelect() : ''}
                <table class="resi-lines-table ${showReference ? 'has-ref' : 'no-ref'}"><thead><tr>
                    <th>Désignation</th>${showReference ? '<th>Référence</th>' : ''}<th>Qté</th><th>PU HT (${devise})</th><th>TVA</th>
                    <th>Total HT (${devise})</th><th>Total TTC (${devise})</th><th></th>
                </tr></thead><tbody>`;

            poste.lines.forEach((line, lineIdx) => {
                if (estExclue(line)) return;
                const t = lineTotals(line);
                const isInverterLine = /onduleur/i.test(line.designation);
                const lockedAttrs = line.lockedDesignation ? 'readonly title="Désignation non modifiable"' : '';
                const qteLockedAttrs = rules.isQteLockedForConversion(state.conversionType, line.key)
                    ? 'readonly title="Non utilisé avec ce type de conversion : quantité bloquée à 0"'
                    : ((rules.isQteDepuisCalepinage(line.key) && state.panneauxCalepinage > 0)
                        ? 'readonly title="Quantité issue du calepinage (nombre de panneaux posés)"'
                        : (rules.isQteDepuisBatterieVirtuelle(line.key)
                            ? 'readonly title="1 si la case « Intégration d’une batterie virtuelle » est cochée, 0 sinon"' : ''));
                // NOUVEAU (demande explicite : "validation stricte des données d'entrée... message
                // d'erreur clair... affichable sous les champs respectifs") : un <div> d'erreur par
                // champ concerné, masqué par défaut, rempli/affiché par attachEvents() au besoin —
                // ne casse pas l'alignement des colonnes du tableau (une ligne s'agrandit simplement
                // si une erreur est affichée, comme n'importe quel contenu multi-ligne de cellule).
                html += `<tr data-line-idx="${lineIdx}">
                    <td><input type="text" class="resi-in resi-designation" value="${escapeAttr(line.designation)}" ${lockedAttrs}${inactif}><div class="resi-field-error" style="display:none;"></div></td>
                    ${showReference ? `<td><input type="text" class="resi-in resi-reference" value="${escapeAttr(line.reference)}" ${isInverterLine ? 'list="resi_inverter_datalist"' : ''}${inactif}><div class="resi-field-error" style="display:none;"></div></td>` : ''}
                    <td><input type="number" class="resi-in resi-qte" value="${line.qte}" step="any" ${qteLockedAttrs}${inactif}><div class="resi-field-error" style="display:none;"></div></td>
                    <td><input type="number" class="resi-in resi-puht" value="${line.puHt}" step="any"${inactif}><div class="resi-field-error" style="display:none;"></div></td>
                    <td><select class="resi-in resi-tva" ${exclu ? 'disabled' : (state.tvaMode === 'unique' ? 'disabled title="TVA globale appliquée (mode TVA unique)"' : '')}>${tvaOptions.replace(`value="${line.tvaPct}"`, `value="${line.tvaPct}" selected`)}</select></td>
                    <td class="resi-line-total-ht">${exclu ? '–' : t.totalHt.toFixed(2)}</td>
                    <td class="resi-line-total-ttc">${exclu ? '–' : t.totalTtc.toFixed(2)}</td>
                    <td>${exclu ? '' : '<button type="button" class="resi-remove-line btn btn-secondary" title="Supprimer la ligne">&times;</button>'}</td>
                </tr>`;
            });

            html += `</tbody></table>
                ${exclu ? '' : '<button type="button" class="btn btn-secondary resi-add-line">+ Ajouter une ligne</button>'}
            </div>`;
        });

        return html;
    }

    /** Boutons « Prix au Wc » / « CAPEX total » / « Chiffrage détaillé » (choix exclusif). */
    function renderModeCapex() {
        const boutons = [
            ['wc', 'Prix au Wc', 'CAPEX = prix au Wc x puissance du projet'],
            ['fixe', 'CAPEX total', 'CAPEX total saisi directement en k' + Rules().getDeviseSymbol()],
            ['detaille', 'Chiffrage détaillé', 'CAPEX = total du devis détaillé (postes et lignes)']
        ];
        return `<div class="resi-capex-mode" role="group" aria-label="Mode de chiffrage du CAPEX">
                ${boutons.map(([mode, libelle, aide]) => `<button type="button" class="resi-capex-mode-btn${state.capexMode === mode ? ' active' : ''}" data-mode="${mode}" aria-pressed="${state.capexMode === mode}" title="${aide}">${libelle}</button>`).join('')}
            </div>`;
    }

    /** Bloc de saisie du mode « Prix au Wc » ou « CAPEX total » (résultat mis à jour par majCapexSimple). */
    function renderCapexSimple() {
        const rules = Rules();
        const devise = rules.getDeviseSymbol();
        const taxe = suffixeTaxe();
        const wc = state.capexMode === 'wc';
        const valeur = wc ? state.capexPrixWc : state.capexFixeK;
        const libelle = wc ? `Prix au Wc (${devise}/Wc ${taxe})` : `CAPEX total (k${devise} ${taxe})`;
        return `<div class="resi-capex-simple">
                <label class="resi-capex-simple-champ">${libelle}
                    <input type="number" class="resi-capex-simple-input" step="any" value="${valeur == null ? '' : valeur}">
                </label>
                <div class="resi-field-error resi-capex-simple-erreur" style="display:none;"></div>
                <div class="resi-capex-simple-info"></div>
            </div>`;
    }

    /** Ratios et chips du total : base HT (PRO) ou TTC (résidentiel), mode simple ou devis. */
    function chiffresTotal() {
        const totals = grandTotals();
        const puissanceKwc = currentPuissanceKwc();
        const baseDevis = state.profil === 'pro' ? totals.totalHt : totals.totalTtc;
        const base = modeSimple() ? (capexSimpleK() || 0) * 1000 : baseDevis;
        return {
            totals,
            base,
            ratioWc: puissanceKwc > 0 ? (base / (puissanceKwc * 1000)).toFixed(2) : '0',
            ratioKwc: puissanceKwc > 0 ? (base / puissanceKwc).toFixed(2) : '0'
        };
    }

    /**
     * Met à jour le bloc de saisie simple et la ligne « Total Capex » sans re-rendu (la saisie en
     * cours garde le focus) : bornes, message d'erreur sous le champ, CAPEX et ratios.
     */
    function majCapexSimple() {
        if (!state.container || !modeSimple()) return;
        const bloc = state.container.querySelector('.resi-capex-simple');
        if (!bloc) return;
        const rules = Rules();
        const devise = rules.getDeviseSymbol();
        const taxe = suffixeTaxe();
        const puissance = currentPuissanceKwc();
        const fmt = (v, d = 2) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d });
        const input = bloc.querySelector('.resi-capex-simple-input');
        let bornes = null;
        if (state.capexMode === 'wc') {
            bornes = { min: rules.CAPEX_PRIX_WC_RULE.min, max: rules.CAPEX_PRIX_WC_RULE.max, unite: `${devise}/Wc` };
        } else {
            const t = rules.trancheCapexFixe(puissance);
            if (t) bornes = { min: t.min, max: t.max, unite: `k${devise}`, libelle: t.libelle };
        }
        if (bornes) {
            input.min = bornes.min;
            input.max = bornes.max;
            input.placeholder = `${fmt(bornes.min)} à ${fmt(bornes.max)}`;
        } else {
            input.removeAttribute('min');
            input.removeAttribute('max');
            input.placeholder = '';
        }

        const v = validationCapexSimple();
        input.classList.toggle('is-invalid', !v.valid);
        const erreur = bloc.querySelector('.resi-capex-simple-erreur');
        erreur.textContent = v.message;
        erreur.style.display = v.valid ? 'none' : 'block';

        const k = capexSimpleK();
        const pTxt = puissance > 0 ? `${fmt(puissance)} kWc` : 'inconnue';
        let info = `Puissance du projet : ${pTxt}`;
        if (bornes) info += ` — saisie autorisée : ${fmt(bornes.min)} à ${fmt(bornes.max)} ${bornes.unite}${bornes.libelle ? ` (${bornes.libelle})` : ''}`;
        if (k != null) {
            info += state.capexMode === 'wc'
                ? ` — CAPEX total : ${fmt(k)} k${devise} ${taxe}`
                : ` — soit ${fmt(k / puissance, 3)} ${devise}/Wc ${taxe}`;
        }
        bloc.querySelector('.resi-capex-simple-info').textContent = info;

        const c = chiffresTotal();
        const chipTotal = state.container.querySelector('#resi_total_capex_simple');
        if (chipTotal) chipTotal.textContent = `${c.base.toFixed(2)} ${devise} ${taxe}`;
        const chipWc = state.container.querySelector('#resi_ratio_capex_wc');
        if (chipWc) chipWc.textContent = `${c.ratioWc} ${devise}/Wc${state.profil === 'pro' ? ' HT' : ''}`;
        const chipKwc = state.container.querySelector('#resi_ratio_capex_kwc');
        if (chipKwc) chipKwc.textContent = `${c.ratioKwc} ${devise}/kWc${state.profil === 'pro' ? ' HT' : ''}`;
        majMarge();
    }

    function render() {
        if (!state.container) return;

        const devise = Rules().getDeviseSymbol();
        const { totals, ratioWc, ratioKwc, base } = chiffresTotal();
        // PRO : ratios sur le HT, base du calcul de rentabilité (TVA récupérable).
        const suffixeRatio = state.profil === 'pro' ? ' HT' : '';
        const simple = modeSimple();
        // Parcours Chiffrage (avant-projet) : le devis détaillé est le livrable, les boutons de mode ne
        // sont proposés que pour revenir au détaillé d'un chiffrage déjà passé en mode simplifié.
        const chiffrage = typeof window.isChiffrageProject === 'function' && window.isChiffrageProject();
        const boutonsMode = (chiffrage && !simple) ? '' : renderModeCapex();
        const masque = simple ? ' style="display:none;"' : '';

        const chipsTotal = simple
            ? `<span class="resi-total-chip" id="resi_total_capex_simple">${base.toFixed(2)} ${devise} ${suffixeTaxe()}</span>`
            : `<span class="resi-total-chip" id="resi_total_capex_ht">${totals.totalHt.toFixed(2)} ${devise} HT</span>
                <span class="resi-total-chip" id="resi_total_capex_ttc">${totals.totalTtc.toFixed(2)} ${devise} TTC</span>`;

        let html = `
            <div class="resi-section-header">
                <div id="resi-capex-title-row" style="display:flex; align-items:center; justify-content:space-between; gap:15px; flex-wrap:wrap; width:100%;">
                    <h2 style="margin:0; flex:0 1 auto;">Chiffrage CAPEX (Devis)</h2>
                    <div class="resi-capex-actions"${masque}>
                        <button type="button" class="btn btn-secondary resi-favoris-btn" title="Prix enregistrés dans ce navigateur, à appliquer au chiffrage">&#9733; Favoris chiffrage</button>
                        <button type="button" class="btn btn-secondary resi-chiffrage-initial-btn" title="Reprendre le chiffrage réalisé en type d'étude Chiffrage (enregistré en base)">Ouvrir le chiffrage initial</button>
                        <button type="button" class="btn btn-secondary resi-sync-calepinage-btn">Synchroniser depuis le calepinage</button>
                    </div>
                </div>
                ${boutonsMode}
                ${simple ? renderCapexSimple() : `<div class="radio-group resi-view-toggle" style="display:flex; gap:15px;">
                    <label><input type="radio" name="resi_capex_view" value="synthetique" ${state.viewMode === 'synthetique' ? 'checked' : ''}> Vue synthétique</label>
                    <label><input type="radio" name="resi_capex_view" value="detaille" ${state.viewMode === 'detaille' ? 'checked' : ''}> Vue détaillée</label>
                    <label class="resi-inclure-mo" title="Décoché : le poste Main-d'œuvre vaut 0 et n'apparaît pas sur le devis"><input type="checkbox" class="resi-inclure-mo-case" ${state.inclureMainOeuvre ? 'checked' : ''}> Inclure la main-d’œuvre dans le devis</label>
                </div>`}
                ${simple ? `<div class="resi-tva-globale-row">${renderMarge()}</div>` : renderTvaGlobale()}
            </div>
            ${simple ? '' : `<div class="resi-postes-list">
                ${state.viewMode === 'synthetique' ? renderSynthTable() : renderDetailBlocks()}
            </div>`}
            <p class="resi-capex-grand-total">
                <strong>Total Capex :</strong>
                ${chipsTotal}
                <span class="resi-total-chip resi-total-chip-ratio" id="resi_ratio_capex_wc">${ratioWc} ${devise}/Wc${suffixeRatio}</span>
                <span class="resi-total-chip resi-total-chip-ratio" id="resi_ratio_capex_kwc">${ratioKwc} ${devise}/kWc${suffixeRatio}</span>
                <span class="resi-total-marge">
                    <span class="resi-total-chip resi-total-chip-cible" title="Prix de vente cible (ligne TVA)">Prix de vente cible : <strong class="resi-total-prix-cible">–</strong></span>
                    <span class="resi-total-chip resi-total-chip-cible" title="Marge de vente calculée sur ce Capex">Marge de vente : <strong class="resi-total-marge-vente">–</strong></span>
                </span>
            </p>
            <p class="resi-devis-controls-row"${masque}>
                <span id="resi-devis-controls-anchor" style="display:contents;"></span>
            </p>`;

        state.container.innerHTML = html;
        attachEvents();
        majCapexSimple();
    }

    /**
     * NOUVEAU (demande explicite : "validation stricte des données d'entrée... rejet strict...
     * message d'erreur clair... affichable sous les champs respectifs") : valide un champ via
     * Rules.validateLigneField(), bascule la classe `.is-invalid` sur l'input et affiche/masque le
     * message précis dans le `.resi-field-error` associé (rendu juste à côté de l'input dans
     * renderDetailBlocks()). Ne modifie JAMAIS la valeur de l'input ni du modèle — signale
     * uniquement. Rejouée systématiquement après chaque rendu (cf. appels dans attachEvents()
     * ci-dessous) pour rester déterministe : la validité affichée est toujours recalculée depuis la
     * valeur ACTUELLE de la ligne, jamais un état mémorisé séparément.
     */
    function applyFieldValidation(input, field, context) {
        if (!input) return { valid: true, message: '' };
        const rules = Rules();
        const result = rules.validateLigneField(field, context);
        const errorDiv = input.parentElement ? input.parentElement.querySelector('.resi-field-error') : null;
        input.classList.toggle('is-invalid', !result.valid);
        if (errorDiv) {
            errorDiv.textContent = result.valid ? '' : result.message;
            errorDiv.style.display = result.valid ? 'none' : 'block';
        }
        return result;
    }

    function attachEvents() {
        const rules = Rules();

        state.container.querySelectorAll('input[name="resi_capex_view"]').forEach((radio) => {
            radio.addEventListener('change', (e) => {
                state.viewMode = e.target.value;
                render();
                pushTotalToEngine();
            });
        });
        state.container.querySelectorAll('input[name="resi_tva_mode"]').forEach((radio) => {
            radio.addEventListener('change', (e) => changerModeTva(e.target.value));
        });
        const tvaGlobaleSelect = state.container.querySelector('.resi-tva-globale');
        if (tvaGlobaleSelect) tvaGlobaleSelect.addEventListener('change', () => changerTvaGlobale(tvaGlobaleSelect.value));
        const inclureMoCase = state.container.querySelector('.resi-inclure-mo-case');
        if (inclureMoCase) inclureMoCase.addEventListener('change', () => changerInclureMainOeuvre(inclureMoCase.checked));
        state.container.querySelectorAll('.resi-capex-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => changerModeCapex(btn.dataset.mode));
        });
        const simpleInput = state.container.querySelector('.resi-capex-simple-input');
        if (simpleInput) {
            simpleInput.addEventListener('input', () => {
                const brut = simpleInput.value.trim();
                // Saisie brute conservée (jamais corrigée) ; hors bornes : champ en rouge, message
                // dessous et enregistrement bloqué (erreursValidation), CAPEX moteur à 0.
                const valeur = brut === '' || !Number.isFinite(Number(brut)) ? null : Number(brut);
                if (state.capexMode === 'wc') state.capexPrixWc = valeur;
                else state.capexFixeK = valeur;
                majCapexSimple();
                pushTotalToEngine();
            });
        }
        brancherMarge();

        const syncBtn = state.container.querySelector('.resi-sync-calepinage-btn');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => {
                syncBtn.disabled = true;
                const originalText = syncBtn.textContent;
                syncBtn.textContent = 'Synchronisation...';
                syncFromCalepinage().finally(() => {
                    // Le bouton est recréé par render() suite à la synchronisation — rien à
                    // restaurer si l'élément a déjà été remplacé (pas d'erreur silencieuse ici).
                    if (document.body.contains(syncBtn)) {
                        syncBtn.disabled = false;
                        syncBtn.textContent = originalText;
                    }
                });
            });
        }

        const initialBtn = state.container.querySelector('.resi-chiffrage-initial-btn');
        if (initialBtn) {
            initialBtn.addEventListener('click', () => {
                const DB = window.ResidentielChiffrage.DB;
                if (!DB || typeof DB.importerChiffrageInitial !== 'function') return;
                initialBtn.disabled = true;
                DB.importerChiffrageInitial().finally(() => {
                    if (document.body.contains(initialBtn)) initialBtn.disabled = false;
                });
            });
        }

        const favorisBtn = state.container.querySelector('.resi-favoris-btn');
        if (favorisBtn) {
            favorisBtn.addEventListener('click', () => {
                const Favoris = window.ResidentielChiffrage.Favoris;
                if (Favoris) Favoris.open();
            });
        }

        if (state.viewMode !== 'detaille') return;

        const conversionSelect = state.container.querySelector('.resi-conversion-select');
        if (conversionSelect) {
            conversionSelect.addEventListener('change', () => {
                changeConversionType(conversionSelect.value || null);
                render();
                pushTotalToEngine();
            });
        }

        state.container.querySelectorAll('.resi-poste-block').forEach((block) => {
            const posteIdx = Number(block.dataset.posteIdx);
            const poste = state.postes[posteIdx];
            // Main-d'œuvre non incluse : champs inactifs, ni validation (hors devis) ni saisie.
            if (posteExclu(poste)) return;

            block.querySelectorAll('tbody tr').forEach((row) => {
                const lineIdx = Number(row.dataset.lineIdx);
                const line = poste.lines[lineIdx];

                const designationInput = row.querySelector('.resi-designation');
                const referenceInput = row.querySelector('.resi-reference');
                const qteInput = row.querySelector('.resi-qte');
                const puHtInput = row.querySelector('.resi-puht');
                const tvaSelect = row.querySelector('.resi-tva');
                const removeBtn = row.querySelector('.resi-remove-line');

                // NOUVEAU (validation stricte) : contexte partagé passé à Rules.validateLigneField()
                // pour résoudre la règle applicable (sous-type line.key, sinon repli du poste).
                const validationContext = () => ({ posteKey: poste.key, lineKey: line.key, designation: line.designation });

                // Affiche l'état de validité ACTUEL (recalculé depuis la valeur déjà en mémoire) dès
                // le rendu — pas seulement à la prochaine saisie — pour qu'une valeur invalide déjà
                // présente (ex. après un re-rendu suite à l'édition d'une autre ligne, ou une
                // ancienne donnée chargée en base) reste visiblement signalée.
                // CORRECTIF : une désignation verrouillée (lockedDesignation) n'est jamais validée
                // (même exemption que côté backend, cf. residentiel_chiffrage_schemas.py) — sinon un
                // libellé système fixe dépassant 30 caractères ("Pilotage énergétique / Domotique",
                // 32 car.) se retrouverait signalé en erreur sur un champ non éditable, sans que
                // l'utilisateur ne puisse jamais le corriger.
                if (designationInput && !line.lockedDesignation) applyFieldValidation(designationInput, 'designation', { ...validationContext(), rawValue: line.designation });
                if (referenceInput) applyFieldValidation(referenceInput, 'reference', { ...validationContext(), rawValue: line.reference });
                if (qteInput) applyFieldValidation(qteInput, 'qte', { ...validationContext(), rawValue: line.qte });
                if (puHtInput) applyFieldValidation(puHtInput, 'puHt', { ...validationContext(), rawValue: line.puHt });

                // CORRECTIF (demande explicite : "rejet strict... ne jamais modifier, tronquer ou
                // corriger silencieusement les données de l'utilisateur") : remplace
                // rules.clampWithAlert() (qui réécrivait silencieusement la valeur en cas de saisie
                // hors plage, ou la mettait à 0 sans même alerte pour une saisie non-numérique) —
                // la saisie brute est conservée telle quelle dans le modèle (sauf non-numérique :
                // rien de valide à enregistrer, la ligne garde alors sa dernière valeur connue), un
                // message précis est affiché sous le champ, et la sauvegarde autodéclenchée est
                // bloquée tant que l'erreur n'est pas corrigée (cf. ResidentielChiffrageDB.js).
                if (designationInput && !line.lockedDesignation) {
                    designationInput.addEventListener('input', () => {
                        line.designation = designationInput.value;
                        applyFieldValidation(designationInput, 'designation', { ...validationContext(), rawValue: designationInput.value });
                    });
                }
                if (referenceInput) {
                    referenceInput.addEventListener('input', () => {
                        line.reference = referenceInput.value;
                        applyFieldValidation(referenceInput, 'reference', { ...validationContext(), rawValue: referenceInput.value });
                    });
                }

                if (qteInput && !qteInput.readOnly) qteInput.addEventListener('change', () => {
                    const parsed = parseFloat(qteInput.value);
                    if (!isNaN(parsed)) line.qte = parsed;
                    render();
                    pushTotalToEngine();
                });
                if (puHtInput) puHtInput.addEventListener('change', () => {
                    const parsed = parseFloat(puHtInput.value);
                    if (!isNaN(parsed)) line.puHt = parsed;
                    render();
                    pushTotalToEngine();
                });
                if (tvaSelect) tvaSelect.addEventListener('change', () => {
                    line.tvaPct = Number(tvaSelect.value);
                    // L'utilisateur a choisi explicitement : ne plus jamais réappliquer la TVA par
                    // défaut automatique sur cette ligne (cf. reapplyDefaultTvaRates()).
                    line.tvaManual = true;
                    render();
                    pushTotalToEngine();
                });
                if (removeBtn) removeBtn.addEventListener('click', () => {
                    poste.lines.splice(lineIdx, 1);
                    render();
                    pushTotalToEngine();
                });
            });

            const addBtn = block.querySelector('.resi-add-line');
            if (addBtn) addBtn.addEventListener('click', () => {
                poste.lines.push(rules.freshLine('', defaultTvaForPoste(poste.key), false));
                render();
                pushTotalToEngine();
            });
        });
    }

    function init(container, initialData) {
        state.container = container;
        const rules = Rules();
        state.profil = rules.getProfil();
        if (state.profil === 'pro') state.typesStructure = detecterTypesStructure();
        if (initialData && Array.isArray(initialData.postes) && initialData.postes.length) {
            state.postes = completerLigneActivationBv(completerPostes(initialData.postes));
            state.viewMode = initialData.viewMode === 'detaille' ? 'detaille' : 'synthetique';
            state.conversionType = resolveConversionType(initialData);
            lireModeTva(initialData);
            lireCibles(initialData);
            lireMainOeuvre(initialData);
            lireModeCapex(initialData);
        } else {
            lireCibles(null);
            lireModeCapex(null);
            state.inclureMainOeuvre = false;
            state.postes = rules.buildDefaultPostes(currentPuissanceKwc());
            // Détaillée par défaut sur un projet neuf : la vue Synthétique n'affiche que des
            // totaux en lecture seule (aucun champ de saisie) — un premier chiffrage doit
            // commencer en détaillé, l'utilisateur peut ensuite basculer en Synthétique une fois
            // les lignes renseignées.
            state.viewMode = 'detaille';
            state.conversionType = 'chaine';
        }
        applyConversionLocks();
        syncActivationBv();
        syncPanneauxCalepinage(false);
        render();
        pushTotalToEngine();

        // Batterie virtuelle cochée / décochée (calepinage ou étude économique) : quantité de la
        // ligne d'activation suivie, devis ré-enregistré. Écouteur unique.
        if (!state.batterieVirtuelleEcoutee) {
            state.batterieVirtuelleEcoutee = true;
            document.addEventListener('batterieVirtuelleChangee', () => {
                if (!state.container || !syncActivationBv()) return;
                render();
                pushTotalToEngine();
            });
        }

        // Quantité de panneaux relue dans le calepinage à chaque ouverture du modal (le calepinage
        // évolue pendant que le modal est fermé). Observateur unique.
        if (!state.ouvertureObservee) {
            const modal = document.getElementById('etudes-economique-modal');
            if (modal) {
                state.ouvertureObservee = true;
                new MutationObserver(() => {
                    if (modal.style.display !== 'none') syncPanneauxCalepinage();
                }).observe(modal, { attributes: true, attributeFilter: ['style'] });
            }
        }

        // CORRECTIF (TVA par défaut non initialisée sur un projet neuf) : la puissance peut ne pas
        // encore être connue au moment de cet appel (injection depuis le calepinage pas terminée) —
        // réapplique la règle de TVA par défaut (non intrusif : ignore les lignes déjà modifiées
        // manuellement, cf. line.tvaManual) à chaque changement de puissance. Écouteur unique
        // (init() n'est appelé qu'une fois par chargement de page).
        if (!state.puissanceListenerAttached) {
            state.puissanceListenerAttached = true;
            const puissanceInput = document.getElementById('puissance');
            if (puissanceInput) {
                puissanceInput.addEventListener('input', reapplyDefaultTvaRates);
                puissanceInput.addEventListener('change', reapplyDefaultTvaRates);
                puissanceInput.addEventListener('input', majMarge);
                puissanceInput.addEventListener('change', majMarge);
                // Mode « Prix au Wc » : CAPEX = prix x puissance ; « CAPEX total » : bornes selon la
                // puissance. Recalculés et transmis au moteur à chaque changement de puissance.
                const suivrePuissance = () => {
                    if (!modeSimple()) return;
                    majCapexSimple();
                    pushTotalToEngine();
                };
                puissanceInput.addEventListener('input', suivrePuissance);
                puissanceInput.addEventListener('change', suivrePuissance);
            }
        }
    }

    /**
     * Champs invalides du devis, lus dans les données (pas dans le DOM : la vue synthétique n'affiche
     * aucun champ, et le contrôle ne doit dépendre ni de l'affichage ni de l'ouverture du modal).
     * Mêmes exclusions que le serveur (validate_capex_business_rules) : poste Main-d'œuvre non inclus,
     * lignes conditionnelles masquées, désignations verrouillées.
     * @returns {string[]} messages précis (poste, ligne, champ, plage), vide si tout est valide
     */
    function erreursValidation() {
        const rules = Rules();
        const erreurs = [];
        if (typeof window.getConversionDeviseState === 'function') {
            const conv = window.getConversionDeviseState();
            if (conv && conv.active && !conv.valid) {
                erreurs.push(conv.error || 'Taux de conversion invalide (0 < taux < 1000).');
            }
        }
        // Saisies simples contrôlées dans tous les modes (enregistrées même inactives), comme le
        // serveur (valider_capex_simple) : CAPEX total selon la puissance seulement s'il est actif.
        // Mode simplifié : lignes du devis conservées, hors totaux et hors contrôle.
        const vWc = rules.validateCapexPrixWc(state.capexPrixWc);
        if (!vWc.valid) erreurs.push(vWc.message);
        const vFixe = rules.validateCapexFixe(state.capexFixeK, currentPuissanceKwc(), state.capexMode === 'fixe');
        if (!vFixe.valid) erreurs.push(vFixe.message);
        if (!modeSimple()) state.postes.forEach((poste) => {
            if (posteExclu(poste)) return;
            (poste.lines || []).forEach((line) => {
                if (estExclue(line)) return;
                const ctx = { posteKey: poste.key, lineKey: line.key, designation: line.designation, profil: state.profil };
                const champs = [['qte', line.qte], ['puHt', line.puHt], ['reference', line.reference]];
                if (!line.lockedDesignation) champs.push(['designation', line.designation]);
                champs.forEach(([champ, valeur]) => {
                    const r = rules.validateLigneField(champ, { ...ctx, rawValue: valeur });
                    if (!r.valid) erreurs.push(`${poste.label} : ${r.message}`);
                });
                if (rules.isQteLockedForConversion(state.conversionType, line.key) && Number(line.qte) !== 0) {
                    erreurs.push(`${poste.label} : quantité (${line.designation}) à 0 avec ce type de conversion.`);
                }
            });
        });
        const vPrix = rules.validatePrixCible(state.prixCible.mode, state.prixCible.valeur);
        if (!vPrix.valid) erreurs.push(vPrix.message);
        const vMarge = rules.validateMargeCible(state.margeCible);
        if (!vMarge.valid) erreurs.push(vMarge.message);
        return erreurs;
    }

    function getData() {
        const conv = (typeof window.getConversionDeviseState === 'function') ? window.getConversionDeviseState() : null;
        const data = {
            postes: state.postes, viewMode: state.viewMode, conversionType: state.conversionType,
            tvaMode: state.tvaMode, tvaGlobale: state.tvaGlobale,
            prixCible: { mode: state.prixCible.mode, valeur: state.prixCible.valeur },
            margeCible: state.margeCible,
            // Lu par DevisPdfGenerator.js (poste retiré du devis) et par le recalcul serveur des totaux.
            inclureMainOeuvre: state.inclureMainOeuvre,
            // Mode de chiffrage et saisies simples (validés par le serveur avant enregistrement).
            capexMode: state.capexMode,
            capexPrixWc: state.capexPrixWc,
            capexFixeK: state.capexFixeK,
            tauxConversion: (conv && conv.active && conv.valid) ? conv.rate : 1,
            conversionDevise: conv
        };
        if (state.profil === 'pro') {
            data.profil = 'pro';
            // Lu par DevisPdfGenerator.js et par la validation serveur : lignes masquées, hors totaux.
            data.lignesExclues = lignesExclues();
        }
        return data;
    }

    function setData(data) {
        const rules = Rules();
        state.profil = rules.getProfil();
        if (state.profil === 'pro') state.typesStructure = detecterTypesStructure();
        state.postes = (data && Array.isArray(data.postes) && data.postes.length)
            ? completerLigneActivationBv(completerPostes(data.postes)) : rules.buildDefaultPostes(currentPuissanceKwc());
        state.viewMode = (data && data.viewMode === 'detaille') ? 'detaille' : 'synthetique';
        state.conversionType = (data && Array.isArray(data.postes) && data.postes.length) ? resolveConversionType(data) : 'chaine';
        lireModeTva(data);
        lireCibles(data);
        lireMainOeuvre(data && Array.isArray(data.postes) && data.postes.length ? data : null);
        lireModeCapex(data);
        applyConversionLocks();
        syncActivationBv();
        syncPanneauxCalepinage(false);
        render();
        pushTotalToEngine();
    }

    window.ResidentielChiffrage.Capex = {
        init,
        getData,
        setData,
        getGrandTotals: grandTotals,
        getPosteTotals: posteTotals,
        getLineTotals: lineTotals,
        getConversionType: () => state.conversionType,
        // Contrôle avant enregistrement (ResidentielChiffrageDB.js::pushToDatabase).
        erreursValidation,
        // Profil PRO (EtudesEconomiqueLogic.js::updateCapexDisplays, pro/ProEtudeEcoView.js).
        isProActive: () => !!state.container && state.profil === 'pro',
        // Mode simplifié : saisie (HT en PRO) ; 0 tant qu'elle manque (calcul bloqué par
        // erreursCapexSimple dans validateStrictData).
        getEngineCapexK: () => (modeSimple() ? (capexSimpleK() || 0) : grandTotals().totalHt / 1000),
        // Mode de chiffrage du CAPEX (EtudesEconomiqueLogic.js : contrôle avant calcul, rapport PDF).
        getModeCapex: () => state.capexMode,
        getCapexSimple: () => ({ mode: state.capexMode, prixWc: state.capexPrixWc, fixeK: state.capexFixeK, capexK: capexSimpleK() }),
        erreursCapexSimple,
        changerModeCapex,
        /** Recalcule et transmet le CAPEX au moteur (appelé avant chaque collecte des saisies). */
        synchroniserMoteur() {
            if (!state.container) return;
            pushTotalToEngine(true);
        },
        /** Relit les types de structure (calepinage ou type de projet) ; re-rendu si changement. */
        refreshTypesStructure() {
            if (state.profil !== 'pro') return;
            const types = detecterTypesStructure();
            if (JSON.stringify(types) === JSON.stringify(state.typesStructure)) return;
            state.typesStructure = types;
            render();
            pushTotalToEngine();
        },
        // Favoris chiffrage (ResidentielFavorisChiffrage.js).
        applyFavori,
        detecterEquipements,
        syncPanneauxCalepinage,
        getPanneauxCalepinage: () => state.panneauxCalepinage,
        changerModeTva,
        changerTvaGlobale,
        getModeTva: () => ({ mode: state.tvaMode, globale: state.tvaGlobale }),
        // CORRECTIF (changement de devise) : exposé pour que updateDeviseLabels()
        // (EtudesEconomiqueLogic.js) puisse forcer un re-rendu immédiat du tableau quand la devise
        // change, sans attendre la prochaine édition d'une ligne.
        render
    };
})();
