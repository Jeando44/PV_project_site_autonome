/**
 * Pont de sélection de batterie entre le calepinage et le modal de stockage.
 * ============================================================================
 * La batterie est choisie dans le formulaire de calepinage — deux points d'entrée distincts :
 * la modale « BD batteries » du calepinage PRO (bd_batteries.js) et le sélecteur de catalogue du
 * calepinage résidentiel (#cmBatteryCatalogSelect). Ses caractéristiques doivent alimenter les
 * champs « Caractéristiques techniques batterie » du modal de stockage, qui vit dans une PAGE FLASK
 * SÉPARÉE chargée en iframe (index_autoconso.html) : aucun `CustomEvent` ne franchit cette
 * frontière, et aucune variable JS n'est partagée.
 *
 * D'où ce module, chargé des DEUX côtés, qui expose :
 *   - `publier()` côté calepinage : écrit la sélection dans localStorage (scopé projet) et la
 *     pousse en `postMessage` vers les iframes ouvertes — le localStorage seul ne suffirait pas,
 *     l'évènement `storage` n'étant pas émis dans l'onglet qui écrit ;
 *   - `lire()` / `onChangement()` côté modal de stockage.
 *
 * CONTRAT D'UNITÉS, unique et explicite — c'est tout l'objet de ce module. Les trois couches
 * utilisaient des échelles différentes pour le rendement (pourcentage en base, pourcentage dans le
 * tableau, fraction dans le modal) : brancher les deux mondes sans contrat aurait injecté « 95 »
 * dans un champ borné à 1. Ici, tout est normalisé UNE fois :
 *   - `rte`               : FRACTION 0-1
 *   - `capaciteKwh`, `puissanceChargeKw`, `puissanceDechargeKw` : kWh / kW
 *   - `dodPct`            : pourcentage 0-100
 *   - `chimie`            : code PySAM ('lfpgraphite' | 'nmcgraphite' | 'leadacid')
 *   - `tensionSystemeV`   : volts, choisie selon la phase de l'onduleur
 *   - `sohFinViePct`      : pourcentage 0-100 (null si absent de la base)
 *   - `typeCouplage`      : 'AC' | 'DC' ; `rendementOnduleurPct` : pourcentage ; `puissanceOnduleurKw` : kW
 *   - `nbSerieMin/Max`, `nbParalleleMax` : entiers (null si absents) ; `courantMaxA` : ampères
 */
(function () {
    'use strict';

    const PREFIXE_CLE = 'skv_batterie_selection';
    const TYPE_MESSAGE = 'skv-batterie-selection';

    /** Codes de chimie acceptés par PySAM (cf. app/schemas/stockage_schemas.py). */
    const CHIMIE_LFP = 'lfpgraphite';
    const CHIMIE_NMC = 'nmcgraphite';
    const CHIMIE_PLOMB = 'leadacid';

    function cleStockage() {
        const projet = localStorage.getItem('current_projet_id') || 'no-project';
        return `${PREFIXE_CLE}_${projet}`;
    }

    /**
     * Traduit un libellé de chimie (base, catalogue ou saisie libre) en code PySAM.
     * La source écrit aussi bien 'LFP' que 'Li-ion LFP (Lithium Fer Phosphate)'.
     */
    function chimieVersCodePySam(libelle) {
        const texte = String(libelle || '').toLowerCase();
        if (texte.includes('plomb') || texte.includes('lead') || texte.includes('pb-')) return CHIMIE_PLOMB;
        if (texte.includes('nmc') || texte.includes('nickel')) return CHIMIE_NMC;
        return CHIMIE_LFP; // défaut : chimie dominante du stockage stationnaire, et des 40 références du catalogue
    }

    /**
     * Rendement aller-retour ramené en FRACTION.
     *
     * Le catalogue le stocke en pourcentage (90), le modal l'attend en fraction (0,90). Une valeur
     * supérieure à 1 ne peut être qu'un pourcentage : aucun rendement aller-retour ne dépasse 100 %.
     */
    function rteEnFraction(valeur) {
        const nombre = parseFloat(valeur);
        if (!isFinite(nombre) || nombre <= 0) return null;
        return nombre > 1 ? nombre / 100 : nombre;
    }

    /**
     * Tension système à retenir selon la phase du raccordement.
     *
     * C'est ici que servent les colonnes `tension_systeme_mono_v` / `tension_systeme_tri_v`
     * alimentées à l'import (demande explicite : « on doit considérer la tension de la batterie
     * selon qu'elle est utilisée en monophasé ou triphasé ; cela doit correspondre à l'onduleur »).
     * 13 des 40 batteries ont deux valeurs réellement distinctes — pour une LUNA2000-5-S0, 450 V en
     * monophasé contre 600 V en triphasé.
     *
     * @param {object} dbMatch entrée catalogue (peut être nulle)
     * @param {'mono'|'tri'|null} phase phase du raccordement, déduite de l'onduleur retenu
     */
    function tensionSelonPhase(dbMatch, phase) {
        if (!dbMatch) return null;
        const mono = parseFloat(dbMatch.tension_systeme_mono_v);
        const tri = parseFloat(dbMatch.tension_systeme_tri_v);
        const choisie = phase === 'mono' ? mono : (phase === 'tri' ? tri : null);
        if (isFinite(choisie) && choisie > 0) return choisie;
        // Phase inconnue, ou valeur absente pour cette phase : on prend celle qui existe.
        if (isFinite(tri) && tri > 0) return tri;
        if (isFinite(mono) && mono > 0) return mono;
        return null;
    }

    /**
     * Phase du raccordement, déduite de l'onduleur retenu s'il est connu.
     * Convention `ond_type_tension` déjà utilisée par chaines_pertes_modal.js.
     */
    function phaseDuRaccordement(onduleurData) {
        const texte = String((onduleurData && onduleurData.ond_type_tension) || '').toLowerCase();
        if (texte.includes('tri')) return 'tri';
        if (texte.includes('mono')) return 'mono';
        return null;
    }

    /**
     * Couplage de la batterie et caractéristiques de l'onduleur retenu utiles au stockage.
     *
     *   - typeCouplage : 'DC' (onduleur hybride) ou 'AC', d'après la fiche batterie
     *     ('DC (via StorEdge / HD-Wave)' compte comme DC) ;
     *   - rendementOnduleurPct : rendement EUROPÉEN de l'onduleur (plus représentatif d'une année de
     *     fonctionnement que le rendement max), repli sur le rendement max ;
     *   - puissanceOnduleurKw : puissance nominale AC, partagée entre production et décharge ;
     *   - onduleurHybride / compatibleOnduleur : null quand on ne peut pas trancher.
     */
    function couplageEtOnduleur(entree, dbMatch, onduleurData) {
        const brut = (dbMatch && dbMatch.type_couplage) || entree.typeCouplage || entree.type_couplage || '';
        const typeCouplage = /^\s*dc/i.test(String(brut)) ? 'DC' : 'AC';
        const refOnduleur = onduleurData && (onduleurData.ref || onduleurData.reference);
        const catalogue = (typeof window !== 'undefined' && window.onduleurCatalogFromApi) || [];
        const ondBd = refOnduleur ? catalogue.find((o) => o.reference === refOnduleur) : null;
        const pct = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : null; };

        const rendement = pct(ondBd && ondBd.rendement_europeen_pct)
            || pct(ondBd && ondBd.rendement_max_pct)
            || pct(onduleurData && onduleurData.ond_rendement);
        const puissance = pct(ondBd && ondBd.p_nominale_kva)
            || pct(onduleurData && onduleurData.ond_p_apparente_max_kva);
        let hybride = null;
        if (ondBd) hybride = !!ondBd.hybride || /hybride|battery ready/i.test(ondBd.technologie || '');
        else if (onduleurData && onduleurData.hasFullData) hybride = !!onduleurData.ond_hybride;
        let compatible = null;
        const refsCompatibles = dbMatch && dbMatch.compatible_onduleur_refs;
        if (refOnduleur && Array.isArray(refsCompatibles) && refsCompatibles.length) {
            compatible = refsCompatibles.includes(refOnduleur);
        }
        return {
            typeCouplage,
            onduleurReference: refOnduleur || null,
            rendementOnduleurPct: rendement,
            puissanceOnduleurKw: puissance,
            onduleurHybride: hybride,
            compatibleOnduleur: compatible,
        };
    }

    /**
     * Construit la sélection normalisée à partir d'une entrée de catalogue.
     *
     * @param {object} entree      entrée window.batteryDB (ref, capacite, puissanceCharge…)
     * @param {object} [dbMatch]   ligne brute du catalogue API, pour les champs absents de `entree`
     * @param {object} [contexte]  { onduleurData, estGenerique }
     */
    function normaliser(entree, dbMatch, contexte) {
        if (!entree) return null;
        const ctx = contexte || {};
        const phase = phaseDuRaccordement(ctx.onduleurData);
        const nombre = (v) => {
            const n = parseFloat(v);
            return isFinite(n) && n > 0 ? n : null;
        };

        return {
            reference: entree.ref || entree.reference || null,
            fabricant: entree.fabricant || null,
            capaciteKwh: nombre(entree.capacite != null ? entree.capacite : (dbMatch && dbMatch.capacite_nominale_kwh)),
            puissanceChargeKw: nombre(entree.puissanceCharge != null ? entree.puissanceCharge : (dbMatch && dbMatch.puissance_charge_kw)),
            puissanceDechargeKw: nombre(entree.puissanceDecharge != null ? entree.puissanceDecharge : (dbMatch && dbMatch.puissance_decharge_kw)),
            dodPct: nombre(entree.dod != null ? entree.dod : (dbMatch && dbMatch.dod_max_pct)),
            rte: rteEnFraction(entree.rte != null ? entree.rte : (dbMatch && dbMatch.round_trip_efficiency_pct)),
            chimie: chimieVersCodePySam(entree.chimie || (dbMatch && dbMatch.chimie)),
            tensionSystemeV: tensionSelonPhase(dbMatch, phase),
            // État de santé en fin de vie garantie (%). null = non renseigné en base : le modal de
            // stockage retient alors 60 %.
            sohFinViePct: nombre(entree.sohFinVie != null ? entree.sohFinVie : (dbMatch && dbMatch.soh_fin_vie_pct)),
            // Parc et couplage (cf. configuration_parc_batteries.py) : null = non renseigné en base.
            courantMaxA: nombre(dbMatch && dbMatch.courant_max_charge_decharge_a),
            nbSerieMin: nombre(dbMatch && dbMatch.nb_serie_min),
            nbSerieMax: nombre(dbMatch && dbMatch.nb_serie_max),
            nbParalleleMax: nombre(dbMatch && dbMatch.nb_parallele_max),
            ...couplageEtOnduleur(entree, dbMatch, ctx.onduleurData),
            phaseRaccordement: phase,
            // Seule la batterie générique autorise l'édition complète de ses caractéristiques dans
            // le modal de stockage (demande explicite) : une référence catalogue est une fiche
            // constructeur, on ne la retouche pas à la main.
            estGenerique: !!ctx.estGenerique,
            publieLe: new Date().toISOString(),
        };
    }

    /** Écrit la sélection et la notifie aux iframes ouvertes. `null` efface la sélection. */
    function publier(selection) {
        try {
            if (selection) {
                localStorage.setItem(cleStockage(), JSON.stringify(selection));
            } else {
                localStorage.removeItem(cleStockage());
            }
        } catch (e) {
            console.warn('[BatterieSelection] Écriture impossible :', e);
        }

        // `storage` n'est PAS émis dans l'onglet qui écrit : les iframes de cet onglet ne verraient
        // rien. On les notifie donc explicitement.
        const message = { type: TYPE_MESSAGE, selection: selection || null };
        try { window.postMessage(message, '*'); } catch (e) { /* ignore */ }
        document.querySelectorAll('iframe').forEach((cadre) => {
            try { cadre.contentWindow.postMessage(message, '*'); } catch (e) { /* cross-origin : ignoré */ }
        });
    }

    /** Dernière sélection connue pour le projet courant, ou null. */
    function lire() {
        try {
            const brut = localStorage.getItem(cleStockage());
            return brut ? JSON.parse(brut) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * S'abonne aux changements de sélection. Deux canaux complémentaires : `postMessage` (même
     * onglet, y compris iframes) et `storage` (autres onglets).
     * @returns {Function} fonction de désabonnement
     */
    function onChangement(rappel) {
        const surMessage = (e) => {
            const donnees = e && e.data;
            if (donnees && donnees.type === TYPE_MESSAGE) rappel(donnees.selection);
        };
        const surStockage = (e) => {
            if (e && e.key === cleStockage()) rappel(lire());
        };
        window.addEventListener('message', surMessage);
        window.addEventListener('storage', surStockage);
        return () => {
            window.removeEventListener('message', surMessage);
            window.removeEventListener('storage', surStockage);
        };
    }

    window.BatterieSelection = {
        publier, lire, onChangement, normaliser,
        chimieVersCodePySam, rteEnFraction, tensionSelonPhase, phaseDuRaccordement, couplageEtOnduleur,
        cleStockage,
    };
})();
