/**
 * Poteaux d'ombrière : entraxes transversaux, excentrement, axes et ancrages sur la carte.
 *
 * Demande explicite : « afficher les axes et les points d'ancrage des poteaux d'ombrière sur les
 * rectangles des champs PV (type de structure Ombrière), avec dans le formulaire de calepinage PRO
 * les champs pour positionner les poteaux, synchronisés avec la modale Géométrie, le calepinage 2D
 * et le formulaire des ombrières en 3D ». Inspiré de DrawingControl/shapes/poteaux.js (ancien
 * calepinage rectangulaire : modale PostAxesManager), dont on reprend les positions des axes, les
 * formes d'ancrage (cercle / carré / rectangle) et leurs dimensions — mais sans sa modale ni son
 * stockage : ici tout vit dans l'état du champ PV (CM.state), comme les entraxes longitudinaux.
 *
 * Contenu :
 *  - CM.poteauxOmbriere : règles PURES (valeurs effectives, validation, positions en repère local).
 *    Source unique pour le formulaire 2D (+ son miroir PRO), la modale de géométrie
 *    (calepinage_maison_dimensions_ombriere.js), la 3D (calepinage_maison_3d_objects.js) et la carte.
 *  - CM.brancherChampsPoteaux / CM.majChampsPoteauxUI : câblage des champs de la section
 *    « Géométrie de l'ombrière » (balisage dans calepinage_maison_formulaires.js, cloné côté PRO
 *    par calepinage_maison_form_pro.js comme le reste de la section).
 *  - CM.poteauxCarte : dessin sur la carte Google, piloté par calepinage_maison_carte_plans.js
 *    (même cycle de vie que les panneaux : resynchronisation, retrait, masquage pendant les captures).
 *
 * Clés de l'état (PREMIER NIVEAU, persistées — surtout pas dans `ombriereParams`, remis à null à
 * chaque filtrage de modèles) :
 *  - ombriereEntraxeTransversalParModele : { double|linked|doubleYShape: m } — saisies explicites,
 *    PAR MODÈLE (un « Double poteaux » à 3 m n'a rien à voir avec des « Centrés liaisonnés » à 15 m,
 *    comme pour les réglages par modèle de la modale). Absent = valeur par défaut du modèle.
 *  - ombriereExcentrementM (null = 2 m, défaut de la modale) et ombriereExcentrementCote
 *    ('low' = depuis l'égout, défaut ; 'high' = depuis le faîtage — boutons « Côté Bas / Haut » de la
 *    modale, remontés depuis elle).
 *  - ombrierePoteauxAxesLong / ombrierePoteauxAxesTrans / ombrierePoteauxAncrages (booléens,
 *    masqués par défaut comme dans poteaux.js) et ombriereFormeAncrage ('circle'|'square'|'rect').
 */
(function () {
    const CM = window.CalepinageMaisonIndiv = window.CalepinageMaisonIndiv || {};

    // ------------------------------------------------------------------------------------------
    // Règles
    // ------------------------------------------------------------------------------------------

    /** Modèles métal dont le portique a plusieurs files de poteaux espacées de #postSpacing. */
    const MODELES_ENTRAXE_TRANSVERSAL = ['double', 'linked', 'doubleYShape'];

    /**
     * Bornes de « Entraxes poteaux transversaux » : celles de #postSpacing dans la modale
     * ombriere_metal.html (min 0,5 posé au clic sur Double poteaux / Double toiture Y, 5 pour Centrés
     * liaisonnés, max 30). Mêmes bornes côté serveur (calepinage_dimensionnement_schemas.py).
     */
    const BORNES_ENTRAXE_TRANSVERSAL = {
        double: { min: 0.5, max: 30 },
        linked: { min: 5, max: 30 },
        doubleYShape: { min: 0.5, max: 30 },
    };
    /** #postEccentricity de la modale : 0-30 m. */
    const BORNES_EXCENTREMENT = { min: 0, max: 30 };
    const EXCENTREMENT_DEFAUT_M = 2; // valeur posée par la modale au clic sur « Poteaux excentrés »
    /** Épaisseur de poteau par défaut de la modale (#postWidth) — entre dans l'entraxe auto du Double Y. */
    const EPAISSEUR_POTEAU_DEFAUT_M = 0.3;
    const FORMES_ANCRAGE = ['circle', 'square', 'rect'];

    // Dimensions des ancrages sur la carte (m) — reprises de poteaux.js::drawShape :
    // cercle r = 0,3 ; carré 0,5 x 0,5 ; rectangle 0,4 le long de la façade x 0,8 dans la pente.
    const DIMENSIONS_ANCRAGE = {
        circle: { rayon: 0.3 },
        square: { u: 0.5, v: 0.5 },
        rect: { u: 0.4, v: 0.8 },
    };

    function nombre(v) {
        if (v === null || v === undefined || v === '') return NaN;
        return parseFloat(String(v).replace(',', '.'));
    }

    /** { famille: 'metal'|'bois'|'solumbra', modele } pour une ombrière, sinon null. */
    function familleEtModele(state) {
        if (!state || typeof CM.normalizeTypeMontage !== 'function') return null;
        const tm = CM.normalizeTypeMontage(state.typeMontage);
        if (typeof tm !== 'string' || tm.indexOf('ombriere') !== 0) return null;
        if (tm === 'ombriere_bois') return { famille: 'bois', modele: state.ombriereBoisModel || 'inclinedPost' };
        if (tm === 'ombriere_solumbra') return { famille: 'solumbra', modele: null };
        return { famille: 'metal', modele: state.ombriereMetalModel || 'single' };
    }

    /** Réglages mémorisés de la modale de géométrie (cf. REGLAGES_MODALE, dimensions_ombriere.js). */
    function reglagesModale(state, famille) {
        const r = state && state.ombriereReglagesModale;
        return (r && r[famille]) || null;
    }
    function champReglage(state, famille, modele, id) {
        const r = reglagesModale(state, famille);
        if (!r) return NaN;
        if (modele) {
            const pm = r.parModele && r.parModele[modele];
            return nombre(pm && pm.champs && pm.champs[id]);
        }
        return nombre(r.communs && r.communs.champs && r.communs.champs[id]);
    }

    /** Dimensions de la structure portée transmises à la modale (null si non mesurable). */
    function dimensionsStructure(state) {
        const service = window.CalepinageMaisonDimensionsOmbriere;
        if (!service || typeof service.dimensionsOmbriere !== 'function' || !state || !state.sourceId) return null;
        try { return service.dimensionsOmbriere(state.sourceId); } catch (e) { return null; }
    }

    /**
     * Entraxe transversal par défaut d'un modèle — ceux que la modale pose au clic sur le modèle
     * (ombriere_metal.js) : Double poteaux 3 m, Centrés liaisonnés 15 m, Double toiture Y = largeur
     * projetée d'un bras + épaisseur du poteau.
     */
    function entraxeTransversalDefaut(modele, state, geo) {
        if (modele === 'double') return 3;
        if (modele === 'linked') return 15;
        let largeurBras = geo && geo.largeurBrasM;
        let pente = geo && geo.penteDeg;
        if (!(largeurBras > 0)) {
            const d = dimensionsStructure(state);
            if (d) { largeurBras = d.panelWidth; pente = d.roofSlope; }
        }
        if (!(largeurBras > 0)) return 12.4; // repli du générateur 3D (model_double_y_shape.js)
        const v = largeurBras * Math.cos(Math.abs(Number(pente) || 0) * Math.PI / 180) + EPAISSEUR_POTEAU_DEFAUT_M;
        return Math.round(v * 100) / 100;
    }

    /**
     * Entraxe transversal EFFECTIF du champ, ou null si le modèle n'en a pas.
     * Ordre : saisie (état) > réglage mémorisé par la modale pour ce modèle > surcharge 3D
     * (`ombriereParams`, propre au modèle courant) > défaut du modèle. Les deux sources intermédiaires
     * assurent la continuité des projets antérieurs à ce champ.
     * @returns {{valeur:number, saisie:boolean, defaut:number, modele:string}|null}
     */
    function entraxeTransversal(state, geo) {
        const fm = familleEtModele(state);
        if (!fm || fm.famille !== 'metal' || MODELES_ENTRAXE_TRANSVERSAL.indexOf(fm.modele) === -1) return null;
        // Demande explicite : les poteaux restent TOUJOURS dans le rectangle du champ PV. Une valeur
        // (saisie ou défaut) devenue plus large que le champ après une modification de ses dimensions
        // est écartée : la saisie au profit du défaut, le défaut ramené à la largeur disponible.
        const largeur = largeurChamp(state, geo);
        const maxi = largeur > 0 ? Math.max(BORNES_ENTRAXE_TRANSVERSAL[fm.modele].min, largeur - EPAISSEUR_POTEAU_DEFAUT_M) : Infinity;
        const tient = (v) => isFinite(v) && v > 0 && v <= maxi + 0.001;
        let defaut = entraxeTransversalDefaut(fm.modele, state, geo);
        if (!tient(defaut) && isFinite(maxi)) defaut = Math.round(maxi * 100) / 100;
        const saisies = state.ombriereEntraxeTransversalParModele || {};
        const saisie = nombre(saisies[fm.modele]);
        if (tient(saisie)) return { valeur: saisie, saisie: true, defaut, modele: fm.modele };
        const modale = champReglage(state, 'metal', fm.modele, 'postSpacing');
        if (tient(modale)) return { valeur: modale, saisie: false, defaut, modele: fm.modele };
        const p3d = nombre(state.ombriereParams && state.ombriereParams.postSpacing);
        if (tient(p3d)) return { valeur: p3d, saisie: false, defaut, modele: fm.modele };
        return { valeur: defaut, saisie: false, defaut, modele: fm.modele };
    }

    /** Largeur (vue en plan) du champ : `geo.largeurChampM` si fournie, sinon emprise posée ; 0 si inconnue. */
    function largeurChamp(state, geo) {
        if (geo && geo.largeurChampM > 0) return geo.largeurChampM;
        try {
            const e = emprise(state);
            return e ? e.largeur : 0;
        } catch (err) { return 0; }
    }

    /**
     * Excentrement EFFECTIF (modèle métal « Poteaux excentrés »), ou null pour les autres modèles.
     * Convention de la modale : distance HORIZONTALE depuis le bord bas du champ (égout, côté 'low')
     * ou haut (faîtage, côté 'high'), vers l'intérieur.
     * @returns {{valeur:number, saisie:boolean, cote:'low'|'high'}|null}
     */
    function excentrement(state, geo) {
        const fm = familleEtModele(state);
        if (!fm || fm.famille !== 'metal' || fm.modele !== 'offset') return null;
        const cote = state.ombriereExcentrementCote === 'high' ? 'high' : 'low';
        // Même règle que l'entraxe transversal : jamais hors du rectangle (saisie écartée si elle
        // dépasse la largeur du champ, défaut ramené au milieu du champ s'il est trop étroit).
        const largeur = largeurChamp(state, geo);
        const saisie = nombre(state.ombriereExcentrementM);
        if (isFinite(saisie) && saisie > 0 && (!(largeur > 0) || saisie <= largeur + 0.001)) {
            return { valeur: saisie, saisie: true, cote };
        }
        const defaut = (largeur > 0 && EXCENTREMENT_DEFAUT_M > largeur) ? Math.round(largeur * 50) / 100 : EXCENTREMENT_DEFAUT_M;
        return { valeur: defaut, saisie: false, cote };
    }

    /**
     * Excentrement de la modale (depuis un bord) -> celui du générateur 3D (model_offset_post.js :
     * depuis le CENTRE de la traverse, positif vers le faîtage, négatif vers l'égout, sens inversé
     * par « Inverser pente »). `largeurM` = largeur au sol transmise à la 3D (panelWidth).
     */
    function excentrementVers3D(ex, largeurM, inverserPente) {
        const demi = (Number(largeurM) || 0) / 2;
        const z = ex.cote === 'high' ? demi - ex.valeur : ex.valeur - demi;
        return Math.round((inverserPente ? -z : z) * 1000) / 1000;
    }
    /** Réciproque de excentrementVers3D (valeur saisie dans la fenêtre 3D -> convention modale). */
    function excentrementDepuis3D(z3d, largeurM, inverserPente, cote) {
        const demi = (Number(largeurM) || 0) / 2;
        const z = inverserPente ? -Number(z3d) : Number(z3d);
        const v = cote === 'high' ? demi - z : z + demi;
        return Math.round(v * 1000) / 1000;
    }

    /**
     * Valide une saisie d'entraxe transversal SANS la corriger. Vide = valide (« auto »).
     * Double poteaux : les deux files doivent tenir sous la toiture (même règle que la modale,
     * entraxe <= largeur projetée - épaisseur du poteau) ; liaisonnés / Double Y peuvent dépasser la
     * largeur d'une ombrière, c'est leur principe.
     * @returns {{ok:boolean, valeur:number|null, message:string|null}}
     */
    function validerEntraxeTransversal(modele, brut, largeurChampM) {
        const net = String(brut == null ? '' : brut).trim();
        if (!net) return { ok: true, valeur: null, message: null };
        const v = nombre(net);
        const b = BORNES_ENTRAXE_TRANSVERSAL[modele] || BORNES_ENTRAXE_TRANSVERSAL.double;
        if (!isFinite(v) || v <= 0 || v < b.min || v > b.max) {
            return { ok: false, valeur: null, message: `Entraxes poteaux transversaux : valeur attendue entre ${b.min} et ${b.max} m.` };
        }
        // Demande explicite : jamais plus large que l'ombrière.
        if (largeurChampM > 0 && v > largeurChampM + 0.001) {
            return { ok: false, valeur: null, message: `Entraxes poteaux transversaux : ${v} m dépasse la largeur de l'ombrière (${largeurChampM.toFixed(2)} m).` };
        }
        if (modele === 'double' && largeurChampM > 0) {
            const max = Math.max(0, largeurChampM - EPAISSEUR_POTEAU_DEFAUT_M);
            if (v > max + 0.001) {
                return { ok: false, valeur: null, message: `Entraxes poteaux transversaux : ${v} m dépasse la largeur disponible sous la toiture (${max.toFixed(2)} m).` };
            }
        }
        return { ok: true, valeur: v, message: null };
    }

    /** Valide une saisie d'excentrement SANS la corriger. Vide = valide (défaut 2 m). */
    function validerExcentrement(brut, largeurChampM) {
        const net = String(brut == null ? '' : brut).trim();
        if (!net) return { ok: true, valeur: null, message: null };
        const v = nombre(net);
        // Demande explicite : valeur STRICTEMENT positive.
        if (!isFinite(v) || v <= BORNES_EXCENTREMENT.min || v > BORNES_EXCENTREMENT.max) {
            return { ok: false, valeur: null, message: `Excentrement poteaux : valeur strictement positive attendue, au plus ${BORNES_EXCENTREMENT.max} m.` };
        }
        if (largeurChampM > 0 && v > largeurChampM + 0.001) {
            return { ok: false, valeur: null, message: `Excentrement poteaux : ${v} m dépasse la largeur du champ (${largeurChampM.toFixed(2)} m).` };
        }
        return { ok: true, valeur: v, message: null };
    }

    /**
     * Écrit (ou efface, valeur null) l'entraxe transversal saisi pour un modèle. Nouvel objet à
     * chaque modification (les comparaisons d'état se font par référence). Renvoie true si changé.
     */
    function ecrireEntraxeTransversal(state, modele, valeur) {
        if (!state || MODELES_ENTRAXE_TRANSVERSAL.indexOf(modele) === -1) return false;
        const avant = state.ombriereEntraxeTransversalParModele || {};
        const actuel = nombre(avant[modele]);
        if (valeur === null ? !isFinite(actuel) : actuel === valeur) return false;
        const apres = Object.assign({}, avant);
        if (valeur === null) delete apres[modele]; else apres[modele] = valeur;
        state.ombriereEntraxeTransversalParModele = Object.keys(apres).length ? apres : null;
        return true;
    }

    // ------------------------------------------------------------------------------------------
    // Implantation LONGITUDINALE : entraxes le long de la façade + porte-à-faux gauche / droit
    // ------------------------------------------------------------------------------------------
    // Demande explicite (règles de calcul) :
    //  - métal : entraxe max 10 m, idéaux 10 m et 7,50 m (4 ou 3 places), 8,30 m pour une place PMR,
    //    au plus 4 places entre 2 poteaux ;
    //  - bois : entraxe max 7,50 m, au plus 3 places entre 2 poteaux ;
    //  - largeur de place : 2,50 m par défaut, 2,30 / 2,35 / 2,40 / 2,45 / 2,50 admises (elles font
    //    varier les entraxes de 10 m et 7,50 m) ;
    //  - porte-à-faux gauche par défaut entre 0,10 et 1 m, modifiable, ajusté à la somme des entraxes ;
    //  - p-à-f gauche + p-à-f droit + somme des entraxes <= longueur du champ PV.
    // Saisie : entraxes <= 12,50 m (métal) / 7,80 m (bois), tous strictement positifs.
    // Solumbra (aucune règle fournie) : travées automatiques d'environ 6 m, comme avant.
    const LARGEURS_PLACE_M = [2.30, 2.35, 2.40, 2.45, 2.50];
    const LARGEUR_PLACE_DEFAUT_M = 2.50;
    const ENTRAXE_PMR_M = 8.30; // 1 place PMR de 3,30 m + 2 places de 2,50 m (cas de référence)
    // Largeur de place personnalisée (option « Personnalisée ») : 2-5 m.
    const BORNES_LARGEUR_PLACE = { min: 2, max: 5 };
    // Places PMR (demande explicite) : largeur 3,30 m par défaut, 3-4 m ; entraxe d'une travée PMR =
    // largeur PMR x nb places PMR + largeur standard x nb places standard.
    const LARGEUR_PMR_DEFAUT_M = 3.30;
    const BORNES_LARGEUR_PMR = { min: 3, max: 4 };
    const BORNES_NB_PMR = { min: 0, max: 10 };
    // entraxeMaxM : plafond des entraxes AUTOMATIQUES (10 m métal, 7,50 m bois).
    const REGLES_LONGITUDINALES = {
        metal: { placesMax: 4, entraxeMaxM: 10, entraxeSaisieMaxM: 12.5, pmr: true },
        bois: { placesMax: 3, entraxeMaxM: 7.5, entraxeSaisieMaxM: 7.8, pmr: true },
    };
    /** Porte-à-faux automatique (chacun des deux côtés). */
    const PAF_AUTO = { min: 0.10, max: 1 };
    /** Porte-à-faux saisi : bornes de #leftOverhang de la modale métal (0-3 m), mêmes côté serveur. */
    const BORNES_PAF = { min: 0, max: 3 };

    const arrondi2 = (v) => Math.round(v * 100) / 100;

    /** Largeur de place de parking du champ (m) : prédéfinie ou personnalisée (2-5 m), sinon 2,50. */
    function largeurPlace(state) {
        const v = nombre(state && state.ombriereLargeurPlaceM);
        return (isFinite(v) && v >= BORNES_LARGEUR_PLACE.min && v <= BORNES_LARGEUR_PLACE.max) ? v : LARGEUR_PLACE_DEFAUT_M;
    }
    const estLargeurPredefinie = (v) => LARGEURS_PLACE_M.some((l) => Math.abs(l - v) < 1e-6);

    /** Valide une largeur de place personnalisée SANS la corriger (2-5 m). */
    function validerLargeurPlace(brut) {
        const v = nombre(String(brut == null ? '' : brut).trim());
        if (!isFinite(v) || v < BORNES_LARGEUR_PLACE.min || v > BORNES_LARGEUR_PLACE.max) {
            return { ok: false, valeur: null, message: `Largeur place parking : valeur attendue entre ${BORNES_LARGEUR_PLACE.min} et ${BORNES_LARGEUR_PLACE.max} m.` };
        }
        return { ok: true, valeur: v, message: null };
    }

    /**
     * Places PMR du champ : { nombre, largeur }. Compatibilité : l'ancienne case « Place PMR »
     * (ombrierePlacePmr) vaut 1 place tant que le nombre n'a pas été saisi.
     */
    function placesPmr(state) {
        const st = state || {};
        let n = nombre(st.ombrierePmrNombre);
        if (!isFinite(n)) n = st.ombrierePlacePmr ? 1 : 0;
        n = Math.max(0, Math.floor(n));
        const l = nombre(st.ombrierePmrLargeurM);
        const largeur = (isFinite(l) && l >= BORNES_LARGEUR_PMR.min && l <= BORNES_LARGEUR_PMR.max) ? l : LARGEUR_PMR_DEFAUT_M;
        return { nombre: n, largeur };
    }
    /** Largeur de place PMR saisie (3-4 m). Vide = 3,30 m. */
    function validerLargeurPmr(brut) {
        const net = String(brut == null ? '' : brut).trim();
        if (!net) return { ok: true, valeur: null, message: null };
        const v = nombre(net);
        if (!isFinite(v) || v < BORNES_LARGEUR_PMR.min || v > BORNES_LARGEUR_PMR.max) {
            return { ok: false, valeur: null, message: `Largeur place PMR : valeur attendue entre ${BORNES_LARGEUR_PMR.min} et ${BORNES_LARGEUR_PMR.max} m.` };
        }
        return { ok: true, valeur: v, message: null };
    }
    /** Nombre de places PMR saisi (entier 0-50). */
    function validerNombrePmr(brut) {
        const net = String(brut == null ? '' : brut).trim();
        if (!net) return { ok: true, valeur: null, message: null };
        const v = nombre(net);
        if (!isFinite(v) || !Number.isInteger(v) || v < BORNES_NB_PMR.min || v > BORNES_NB_PMR.max) {
            return { ok: false, valeur: null, message: `Nombre de places PMR : entier attendu entre ${BORNES_NB_PMR.min} et ${BORNES_NB_PMR.max}.` };
        }
        return { ok: true, valeur: v, message: null };
    }

    /**
     * Lecture d'une expression d'entraxes ("4*10 + 7.5", "3x7,5 2") SANS en écarter les valeurs
     * nulles (contrairement à parsePostDistancesSimple) : la validation doit pouvoir les refuser.
     * @returns {{travees:number[], nonPositif:boolean}}
     */
    function analyserTravees(expr) {
        const net = String(expr == null ? '' : expr)
            .replace(/\s*([*xX])\s*/g, '$1').replace(/\s*\+\s*/g, ' ').trim();
        const travees = [];
        let nonPositif = false;
        if (!net) return { travees, nonPositif };
        net.split(/\s+/).forEach((t) => {
            const m = t.match(/^(\d+)[*xX](\d+(?:[.,]\d+)?)$/);
            if (m) {
                const n = parseInt(m[1], 10);
                const v = parseFloat(m[2].replace(',', '.'));
                if (!(n > 0) || !(v > 0)) nonPositif = true;
                for (let i = 0; i < n; i++) travees.push(v);
            } else {
                const v = parseFloat(t.replace(',', '.'));
                if (!(v > 0)) nonPositif = true;
                else travees.push(v);
            }
        });
        return { travees, nonPositif };
    }
    const sommeTravees = (expr) => analyserTravees(expr).travees.reduce((a, b) => a + b, 0);

    /** "4*10 + 1*7.5" à partir d'une liste de travées (regroupe les valeurs consécutives égales). */
    function exprDeTravees(travees) {
        const parts = [];
        travees.forEach((v) => {
            const d = parts[parts.length - 1];
            if (d && Math.abs(d.v - v) < 1e-6) d.n += 1; else parts.push({ v, n: 1 });
        });
        return parts.map((p) => p.n + '*' + arrondi2(p.v)).join(' + ');
    }

    /**
     * Travées automatiques couvrant au mieux `dispoM` (longueur moins les porte-à-faux minimaux) :
     * nombre de places maximal, réparties sur le MOINS de travées possible et le plus régulièrement
     * possible (métal 20 places -> 5 x 10 m ; 11 places -> 10 + 10 + 7,50 ; bois 10 places ->
     * 7,50 + 7,50 + 5 + 5). Places PMR : travées en tête, chacune = largeur PMR x places PMR +
     * largeur standard x places standard (1 PMR 3,30 + 2 x 2,50 = 8,30 m en métal), sans dépasser
     * l'entraxe max (10 / 7,50 m) ni le nombre max de places par travée.
     * `pmr` = { nombre, largeur } (placesPmr) ; un booléen vaut 1 place de 3,30 m (compatibilité).
     */
    function traveesAuto(famille, dispoM, largeur, pmr) {
        if (typeof pmr === 'boolean') pmr = { nombre: pmr ? 1 : 0, largeur: LARGEUR_PMR_DEFAUT_M };
        const r = REGLES_LONGITUDINALES[famille];
        if (!r) {
            const auto = (typeof CM.entraxeOmbriereAuto === 'function') ? CM.entraxeOmbriereAuto(dispoM) : '';
            return analyserTravees(auto).travees;
        }
        const travees = [];
        let reste = dispoM;
        let pmrRestantes = (r.pmr && pmr) ? pmr.nombre : 0;
        while (pmrRestantes > 0) {
            // Places PMR regroupées dans le moins de travées possible, complétées en places standard.
            const nPmr = Math.min(pmrRestantes, r.placesMax, Math.max(1, Math.floor((r.entraxeMaxM + 1e-6) / pmr.largeur)));
            let t = nPmr * pmr.largeur;
            if (t > reste + 1e-6) break; // plus de place dans la longueur disponible
            let nStd = 0;
            while (nPmr + nStd + 1 <= r.placesMax && t + largeur <= r.entraxeMaxM + 1e-6 && t + largeur <= reste + 1e-6) {
                t += largeur;
                nStd += 1;
            }
            travees.push(arrondi2(t));
            reste -= t;
            pmrRestantes -= nPmr;
        }
        const places = Math.floor((reste + 1e-6) / largeur);
        // Places par travée : au plus placesMax ET au plus l'entraxe max (largeur personnalisée :
        // 4 x 2,60 = 10,40 m dépasserait les 10 m du métal -> 3 places).
        const placesParTravee = Math.max(1, Math.min(r.placesMax, Math.floor((r.entraxeMaxM + 1e-6) / largeur)));
        if (places >= 1) {
            const n = Math.ceil(places / placesParTravee);
            const base = Math.floor(places / n);
            const enPlus = places - base * n;
            for (let i = 0; i < n; i++) travees.push(arrondi2((base + (i < enPlus ? 1 : 0)) * largeur));
        }
        // Ombrière plus courte qu'une place : une seule travée sur la longueur disponible.
        if (!travees.length && dispoM > 0.01) travees.push(Math.floor(dispoM * 100) / 100);
        return travees;
    }

    /**
     * Implantation EFFECTIVE le long de la façade, pour une longueur de structure `longueurM` :
     * expression d'entraxes (saisie si elle tient dans la longueur, sinon automatique), porte-à-faux
     * gauche et droit. Un porte-à-faux saisi fait foi et l'autre s'en déduit (jamais les deux à la
     * fois : la longueur est imposée par le calepinage). Source unique du formulaire PRO, de la
     * modale de géométrie, de la 3D et de la carte. Pure : n'écrit rien.
     * @returns {{expr:string, travees:number[], somme:number, pafG:number, pafD:number, longueur:number,
     *            auto:boolean, saisieIgnoree:boolean, pafGSaisi:boolean, pafDSaisi:boolean, famille:string}|null}
     */
    function implantationLongitudinale(state, longueurM) {
        const fm = familleEtModele(state);
        const L = Number(longueurM);
        if (!fm || !(L > 0)) return null;
        const g = nombre(state.ombrierePorteAFauxGaucheM);
        const pafGSaisi = isFinite(g) && g >= 0;
        const dd = nombre(state.ombrierePorteAFauxDroitM);
        const pafDSaisi = !pafGSaisi && isFinite(dd) && dd >= 0;
        const v = (typeof CM.validerEntraxeOmbriere === 'function') ? CM.validerEntraxeOmbriere(state.ombriereEntraxeExpr) : { ok: false };
        let travees = null;
        let saisieIgnoree = false;
        if (v.ok && v.expr) {
            const a = analyserTravees(v.expr);
            const s = a.travees.reduce((x, y) => x + y, 0);
            const pafs = (pafGSaisi ? g : 0) + (pafDSaisi ? dd : 0);
            // Saisie qui ne tient plus dans la structure (dimensions modifiées) : écartée, les
            // poteaux doivent rester dans le rectangle du champ PV (demande explicite).
            if (!a.nonPositif && s > 0 && s + pafs <= L + 0.01) travees = a.travees;
            else saisieIgnoree = true;
        }
        const auto = !travees;
        if (auto) {
            const dispo = L - (pafGSaisi ? g : PAF_AUTO.min) - (pafDSaisi ? dd : PAF_AUTO.min);
            travees = traveesAuto(fm.famille, dispo, largeurPlace(state), placesPmr(state));
        }
        const expr = auto ? exprDeTravees(travees) : v.expr;
        const somme = travees.reduce((x, y) => x + y, 0);
        const reste = L - somme;
        let pafG;
        if (pafGSaisi) pafG = g;
        else if (pafDSaisi) pafG = reste - dd;
        else pafG = reste >= 2 * PAF_AUTO.min ? Math.min(PAF_AUTO.max, Math.max(PAF_AUTO.min, reste / 2)) : reste / 2;
        pafG = arrondi2(pafG);
        return {
            expr, travees, somme: arrondi2(somme), pafG, pafD: arrondi2(reste - pafG), longueur: L,
            auto, saisieIgnoree, pafGSaisi, pafDSaisi, famille: fm.famille,
        };
    }

    /**
     * Longueur de la structure portée, celle envoyée à la modale (en shed : UNE table) ; emprise
     * posée en repli. C'est sur elle que portent les entraxes et porte-à-faux saisis.
     */
    function longueurStructure(state) {
        const d = dimensionsStructure(state);
        if (d && d.facadeLength > 0) return d.facadeLength;
        const e = emprise(state);
        return e ? e.longueur : 0;
    }

    /**
     * Valide une saisie d'entraxes longitudinaux SANS la corriger. Vide = valide (automatique).
     * Règles : caractères et travées (CM.validerEntraxeOmbriere), valeurs strictement positives,
     * entraxe <= 12,50 m (métal) / 7,80 m (bois), somme + porte-à-faux saisis <= longueur.
     * @returns {{ok:boolean, expr:string, message:string|null}}
     */
    function validerEntraxesLongitudinaux(state, brut, longueurM) {
        const v = (typeof CM.validerEntraxeOmbriere === 'function') ? CM.validerEntraxeOmbriere(brut) : { ok: true, expr: String(brut || '').trim(), message: null };
        if (!v.ok || !v.expr) return v;
        const a = analyserTravees(v.expr);
        if (a.nonPositif) {
            return { ok: false, expr: v.expr, message: 'Entraxes poteaux longitudinaux : chaque entraxe doit être strictement positif.' };
        }
        const fm = familleEtModele(state);
        const r = fm && REGLES_LONGITUDINALES[fm.famille];
        const plusGrand = a.travees.length ? Math.max.apply(null, a.travees) : 0;
        if (r && plusGrand > r.entraxeSaisieMaxM + 1e-9) {
            return {
                ok: false, expr: v.expr,
                message: `Entraxes poteaux longitudinaux : ${plusGrand} m dépasse le maximum de ${r.entraxeSaisieMaxM} m (ombrière ${fm.famille === 'bois' ? 'bois' : 'métal'}).`,
            };
        }
        const L = Number(longueurM);
        if (L > 0) {
            const somme = a.travees.reduce((x, y) => x + y, 0);
            const g = nombre(state && state.ombrierePorteAFauxGaucheM);
            const d = nombre(state && state.ombrierePorteAFauxDroitM);
            const pafs = (isFinite(g) ? g : 0) + (!isFinite(g) && isFinite(d) ? d : 0);
            if (somme + pafs > L + 0.01) {
                return {
                    ok: false, expr: v.expr,
                    message: `Entraxes : la somme (${somme.toFixed(2)} m)${pafs > 0 ? ` + porte-à-faux (${pafs.toFixed(2)} m)` : ''} dépasse la longueur de l'ombrière (${L.toFixed(2)} m).`,
                };
            }
        }
        return v;
    }

    /**
     * Valide un porte-à-faux saisi (cote 'gauche' | 'droit') SANS le corriger. Vide = automatique.
     * Le porte-à-faux opposé s'en déduit : il doit rester entre 0 et 3 m, et la somme
     * p-à-f gauche + p-à-f droit + entraxes ne dépasse jamais la longueur du champ.
     * @returns {{ok:boolean, valeur:number|null, message:string|null}}
     */
    function validerPorteAFaux(state, cote, brut, longueurM) {
        const libelle = cote === 'droit' ? 'Porte-à-faux droit' : 'Porte-à-faux gauche';
        const net = String(brut == null ? '' : brut).trim();
        if (!net) return { ok: true, valeur: null, message: null };
        const v = nombre(net);
        if (!isFinite(v) || v < BORNES_PAF.min || v > BORNES_PAF.max) {
            return { ok: false, valeur: null, message: `${libelle} : valeur attendue entre ${BORNES_PAF.min} et ${BORNES_PAF.max} m.` };
        }
        const L = Number(longueurM);
        if (state && L > 0) {
            const essai = Object.assign({}, state, cote === 'droit'
                ? { ombrierePorteAFauxGaucheM: null, ombrierePorteAFauxDroitM: v }
                : { ombrierePorteAFauxGaucheM: v, ombrierePorteAFauxDroitM: null });
            const imp = implantationLongitudinale(essai, L);
            const oppose = imp ? (cote === 'droit' ? imp.pafG : imp.pafD) : 0;
            if (!imp || imp.saisieIgnoree || !(imp.somme > 0) || oppose < -0.005 || oppose > BORNES_PAF.max + 0.005) {
                return {
                    ok: false, valeur: null,
                    message: `${libelle} : avec ${v} m, porte-à-faux + entraxes ne tiennent pas dans la longueur de l'ombrière (${L.toFixed(2)} m).`,
                };
            }
        }
        return { ok: true, valeur: v, message: null };
    }

    /**
     * Demande explicite : quand la longueur et/ou la largeur du champ PV changent, les entraxes et
     * excentrements se recalculent pour que poteaux et axes restent dans le rectangle. Compare les
     * dimensions courantes à celles mémorisées (`ombrierePoteauxDimsRef`) :
     *  - longueur modifiée : l'entraxe longitudinal saisi et le porte-à-faux droit saisi repassent en
     *    automatique (le NOMBRE de travées s'adapte) ; le porte-à-faux gauche saisi reste s'il tient ;
     *  - largeur modifiée : les entraxes transversaux / l'excentrement saisis qui ne tiennent plus
     *    repassent en automatique.
     * Mute `state` ; renvoie true si quelque chose a changé (à persister par l'appelant).
     */
    function reconcilierDimensions(state) {
        if (!familleEtModele(state)) return false;
        const e = emprise(state);
        if (!e) return false;
        const L = arrondi2(longueurStructure(state));
        const W = arrondi2(e.largeur);
        const ref = state.ombrierePoteauxDimsRef;
        let change = false;
        if (ref && isFinite(ref.longueurM) && Math.abs(ref.longueurM - L) > 0.01) {
            if (state.ombriereEntraxeExpr != null) { state.ombriereEntraxeExpr = null; change = true; }
            if (state.ombrierePorteAFauxDroitM != null) { state.ombrierePorteAFauxDroitM = null; change = true; }
            const g = nombre(state.ombrierePorteAFauxGaucheM);
            if (isFinite(g) && !validerPorteAFaux(state, 'gauche', g, L).ok) { state.ombrierePorteAFauxGaucheM = null; change = true; }
        }
        if (ref && isFinite(ref.largeurM) && Math.abs(ref.largeurM - W) > 0.01) {
            const saisies = state.ombriereEntraxeTransversalParModele;
            if (saisies) {
                Object.keys(saisies).forEach((m) => {
                    if (!validerEntraxeTransversal(m, saisies[m], W).ok) { ecrireEntraxeTransversal(state, m, null); change = true; }
                });
            }
            if (state.ombriereExcentrementM != null && !validerExcentrement(state.ombriereExcentrementM, W).ok) {
                state.ombriereExcentrementM = null;
                change = true;
            }
        }
        if (!ref || ref.longueurM !== L || ref.largeurM !== W) {
            state.ombrierePoteauxDimsRef = { longueurM: L, largeurM: W };
            change = true;
        }
        return change;
    }

    // ------------------------------------------------------------------------------------------
    // Géométrie (repère local du champ, en mètres — vue en plan)
    // ------------------------------------------------------------------------------------------

    /** Exécute fn() avec CM.state basculé sur `state` (packPanelsForPan lit l'état global). */
    function avecEtat(state, fn) {
        const precedent = CM.state;
        CM.state = state;
        try { return fn(); } finally { CM.state = precedent; }
    }

    const tourner = (p, a) => ({
        x: p.x * Math.cos(a) - p.y * Math.sin(a),
        y: p.x * Math.sin(a) + p.y * Math.cos(a),
    });

    /**
     * Emprise au sol de la grille de panneaux réellement posée, dans le repère redressé de la grille :
     * u = le long de l'égout (façade), v = dans la pente. null sans panneau.
     */
    function emprise(state) {
        if (typeof CM.packPanelsForPan !== 'function' || typeof CM.panelCornersTrue !== 'function') return null;
        return avecEtat(state, () => {
            let angle = null;
            let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
            (state.pans || []).forEach((pan) => {
                CM.packPanelsForPan(pan).forEach((pl) => {
                    if (angle === null) angle = pl.angle || 0;
                    CM.panelCornersTrue(pl).forEach((c) => {
                        const r = tourner(c, -angle);
                        minU = Math.min(minU, r.x); maxU = Math.max(maxU, r.x);
                        minV = Math.min(minV, r.y); maxV = Math.max(maxV, r.y);
                    });
                });
            });
            if (angle === null || !isFinite(minU)) return null;
            return { angle, minU, maxU, minV, maxV, longueur: maxU - minU, largeur: maxV - minV };
        });
    }

    /** Côté de l'égout dans le repère redressé : +1 si le bord bas est en maxV, -1 s'il est en minV. */
    function sensEgout(state, angle) {
        const pan = (state.pans || [])[0];
        if (!pan || typeof pan.azimuth !== 'number' || typeof CM.vectorFromHeading !== 'function') return 1;
        // Azimut PVGIS (Sud = 0) -> cap boussole (Sud = 180) : direction vers laquelle le pan descend.
        const d = CM.vectorFromHeading(pan.azimuth + 180);
        return tourner(d, -angle).y >= 0 ? 1 : -1;
    }

    /**
     * Positions des poteaux d'un champ : abscisses le long de la façade (entraxes longitudinaux) et
     * files transversales (selon le modèle), dans le repère redressé, puis les tracés en repère local.
     * Règles reprises de poteaux.js (axes sur l'emprise réelle, centrage) et de la modale
     * (porte-à-faux gauche, files des modèles). Pure : n'écrit rien.
     * @returns {{axesLong:Array, axesTrans:Array, ancrages:Array, angle:number, avertissements:string[]}|null}
     */
    function positionsPoteaux(state) {
        const fm = familleEtModele(state);
        if (!fm) return null;
        const e = emprise(state);
        if (!e) return null;
        const avertissements = [];

        // --- le long de la façade -------------------------------------------------------------
        // Longueur de la structure = celle envoyée à la modale (rail compris), centrée sur la grille ;
        // une table de shed n'est qu'une partie du champ : on garde alors l'emprise.
        const d = dimensionsStructure(state);
        const facade = (d && !d.estShed && d.facadeLength > 0) ? d.facadeLength : e.longueur;
        const debutU = (e.minU + e.maxU) / 2 - facade / 2;
        // Implantation commune au formulaire, à la modale et à la 3D (porte-à-faux gauche compris).
        const imp = implantationLongitudinale(state, facade);
        const relatives = [0];
        (imp ? imp.travees : []).forEach((t) => relatives.push(relatives[relatives.length - 1] + t));
        const x0 = debutU + (imp ? imp.pafG : 0);
        const xs = relatives.map((r) => x0 + r);
        if (imp && imp.saisieIgnoree) {
            avertissements.push(`Les entraxes saisis ne tiennent pas dans la longueur de l'ombrière (${facade.toFixed(2)} m) : entraxes automatiques appliqués.`);
        }

        // --- files transversales ----------------------------------------------------------------
        const centreV = (e.minV + e.maxV) / 2;
        let ys = [centreV];
        if (fm.famille === 'metal') {
            const geoLargeur = { largeurChampM: e.largeur };
            const t = entraxeTransversal(state, geoLargeur);
            const ex = excentrement(state, geoLargeur);
            if (t) {
                ys = [centreV - t.valeur / 2, centreV + t.valeur / 2];
            } else if (ex) {
                const bas = sensEgout(state, e.angle) > 0 ? e.maxV : e.minV;
                const haut = bas === e.maxV ? e.minV : e.maxV;
                const bord = ex.cote === 'high' ? haut : bas;
                ys = [bord + (bord === e.maxV ? -ex.valeur : ex.valeur)];
            } else if (fm.modele === 'inclinedPost') {
                // Pieds des poteaux inclinés : #postSpacingInclined de la modale (2 m au clic).
                const s = champReglage(state, 'metal', 'inclinedPost', 'postSpacingInclined');
                const ecart = isFinite(s) ? s : 2;
                ys = [centreV - ecart / 2, centreV + ecart / 2];
            }
        }
        if (ys.some((y) => y < e.minV - 0.05 || y > e.maxV + 0.05)) {
            avertissements.push(`Des poteaux tombent hors de la largeur du champ (${e.largeur.toFixed(2)} m).`);
        }

        // --- tracés en repère local --------------------------------------------------------------
        const local = (u, v) => tourner({ x: u, y: v }, e.angle);
        return {
            angle: e.angle,
            // Axes longitudinaux : une ligne par file, sur toute la longueur de la structure.
            axesLong: ys.map((y) => [local(debutU, y), local(debutU + facade, y)]),
            // Axes transversaux : une ligne par poteau, sur toute la largeur du champ.
            axesTrans: xs.map((x) => [local(x, e.minV), local(x, e.maxV)]),
            ancrages: xs.reduce((acc, x) => acc.concat(ys.map((y) => local(x, y))), []),
            avertissements,
        };
    }

    /** Contour (repère local) d'un ancrage carré ou rectangulaire centré sur `c`. */
    function contourAncrage(c, forme, angle) {
        const dim = DIMENSIONS_ANCRAGE[forme] || DIMENSIONS_ANCRAGE.square;
        const du = dim.u / 2, dv = dim.v / 2;
        return [[-du, -dv], [du, -dv], [du, dv], [-du, dv]].map(([u, v]) => {
            const r = tourner({ x: u, y: v }, angle);
            return { x: c.x + r.x, y: c.y + r.y };
        });
    }

    CM.poteauxOmbriere = {
        MODELES_ENTRAXE_TRANSVERSAL, BORNES_ENTRAXE_TRANSVERSAL, BORNES_EXCENTREMENT, FORMES_ANCRAGE,
        EXCENTREMENT_DEFAUT_M, DIMENSIONS_ANCRAGE,
        familleEtModele, entraxeTransversal, entraxeTransversalDefaut, excentrement,
        excentrementVers3D, excentrementDepuis3D,
        validerEntraxeTransversal, validerExcentrement, ecrireEntraxeTransversal,
        emprise, positionsPoteaux, contourAncrage,
        LARGEURS_PLACE_M, LARGEUR_PLACE_DEFAUT_M, ENTRAXE_PMR_M, REGLES_LONGITUDINALES, PAF_AUTO, BORNES_PAF,
        largeurPlace, validerLargeurPlace, placesPmr, validerLargeurPmr, validerNombrePmr,
        BORNES_LARGEUR_PLACE, LARGEUR_PMR_DEFAUT_M, BORNES_LARGEUR_PMR, BORNES_NB_PMR,
        analyserTravees, traveesAuto, implantationLongitudinale, longueurStructure, largeurChamp,
        validerEntraxesLongitudinaux, validerPorteAFaux, reconcilierDimensions,
    };

    // ------------------------------------------------------------------------------------------
    // Formulaire (section « Géométrie de l'ombrière » du modal ; miroir PRO par form_pro.js)
    // ------------------------------------------------------------------------------------------

    function largeurChampCourant() {
        const e = CM.state ? emprise(CM.state) : null;
        return e ? e.largeur : 0;
    }

    function afficherErreur(input, erreurEl, message) {
        if (input) {
            input.style.borderColor = message ? '#dc3545' : '';
            // Saisie REFUSÉE : marquée (pour le champ PV courant) afin que les rafraîchissements
            // suivants ne l'effacent pas. Côté PRO, la saisie est rejouée ici puis le formulaire est
            // resynchronisé (synchroniser -> majChampsPoteauxUI) alors que le champ d'origine n'a
            // pas le focus : sans ce marqueur, le message disparaissait aussitôt (bug rapporté).
            if (message) input.dataset.cmRefus = String(CM.state && CM.state.sourceId);
            else delete input.dataset.cmRefus;
        }
        if (erreurEl) {
            erreurEl.style.display = message ? 'block' : 'none';
            erreurEl.textContent = message || '';
        }
    }

    /** Vrai si le champ affiche une saisie refusée pour ce champ PV (à ne pas écraser). */
    function saisieRefusee(el, st) {
        return !!el && el.dataset.cmRefus !== undefined && el.dataset.cmRefus === String(st && st.sourceId);
    }

    /** Remet les champs « poteaux » en accord avec CM.state (visibilité, valeurs, avertissements). */
    function majChampsPoteauxUI() {
        const body = CM.modalBody;
        if (!body || !CM.state) return;
        const st = CM.state;
        const q = (id) => body.querySelector('#' + id);
        const fm = familleEtModele(st);
        const t = entraxeTransversal(st);
        const ex = excentrement(st);

        const transW = q('cmPoteauxEntraxeTransversalWrapper');
        if (transW) transW.style.display = t ? '' : 'none';
        const transInput = q('cmPoteauxEntraxeTransversalInput');
        if (transInput && t) {
            const b = BORNES_ENTRAXE_TRANSVERSAL[t.modele];
            transInput.min = String(b.min);
            transInput.max = String(b.max);
            transInput.placeholder = `auto (${t.valeur} m)`;
            if (document.activeElement !== transInput && !saisieRefusee(transInput, st)) {
                transInput.value = t.saisie ? String(t.valeur) : '';
                afficherErreur(transInput, q('cmPoteauxEntraxeTransversalInputError'), null);
            }
        }

        const excW = q('cmPoteauxExcentrementWrapper');
        if (excW) excW.style.display = ex ? '' : 'none';
        const excInput = q('cmPoteauxExcentrementInput');
        if (excInput && ex) {
            excInput.placeholder = `auto (${ex.saisie ? EXCENTREMENT_DEFAUT_M : ex.valeur} m)`;
            excInput.title = ex.cote === 'high'
                ? 'Distance horizontale du bord haut (faîtage) à l\'axe des poteaux, en mètres'
                : 'Distance horizontale du bord bas (égout) à l\'axe des poteaux, en mètres';
            if (document.activeElement !== excInput && !saisieRefusee(excInput, st)) {
                excInput.value = ex.saisie ? String(ex.valeur) : '';
                afficherErreur(excInput, q('cmPoteauxExcentrementInputError'), null);
            }
        }

        // Implantation longitudinale : porte-à-faux, largeur de place, place PMR (métal), pannes (bois).
        let imp = null;
        try { imp = fm ? implantationLongitudinale(st, longueurStructure(st)) : null; } catch (e) { imp = null; }
        const regles = fm && REGLES_LONGITUDINALES[fm.famille];
        [['cmPoteauxPafGaucheWrapper', !!fm], ['cmPoteauxPafDroitWrapper', !!fm],
         ['cmPoteauxLargeurPlaceWrapper', !!regles], ['cmPoteauxPmrNombreWrapper', !!(regles && regles.pmr)],
         ['cmPoteauxPmrLargeurWrapper', !!(regles && regles.pmr)],
         ['cmOmbriereBoisPannesWrapper', !!(fm && fm.famille === 'bois')]].forEach(([id, visible]) => {
            const w = q(id);
            if (w) w.style.display = visible ? '' : 'none';
        });
        [['cmPoteauxPafGaucheInput', 'cmPoteauxPafGaucheInputError', imp && imp.pafGSaisi, imp && imp.pafG, imp && imp.pafDSaisi],
         ['cmPoteauxPafDroitInput', 'cmPoteauxPafDroitInputError', imp && imp.pafDSaisi, imp && imp.pafD, imp && imp.pafGSaisi]]
            .forEach(([id, idErreur, saisi, valeur, deduit]) => {
                const el = q(id);
                if (!el) return;
                el.placeholder = imp ? `${deduit ? 'déduit' : 'auto'} (${valeur.toFixed(2)} m)` : 'auto';
                if (document.activeElement !== el && !saisieRefusee(el, st)) {
                    el.value = saisi ? String(valeur) : '';
                    afficherErreur(el, q(idErreur), null);
                }
            });
        const placeSel = q('cmPoteauxLargeurPlaceSelect');
        // « Personnalisée » : valeur hors liste, ou option choisie et pas encore saisie (drapeau posé
        // sur la liste d'origine par son gestionnaire).
        const largeurCourante = largeurPlace(st);
        // Le drapeau ne vaut que pour le champ PV où l'option a été choisie.
        const perso = !estLargeurPredefinie(largeurCourante) || !!(placeSel && placeSel.dataset.cmPerso === String(st.sourceId));
        if (placeSel && document.activeElement !== placeSel) placeSel.value = perso ? 'perso' : largeurCourante.toFixed(2);
        const persoW = q('cmPoteauxLargeurPlacePersoWrapper');
        if (persoW) persoW.style.display = (regles && perso) ? '' : 'none';
        const persoEl = q('cmPoteauxLargeurPlacePersoInput');
        if (persoEl && document.activeElement !== persoEl && !saisieRefusee(persoEl, st)) {
            persoEl.value = (perso && !estLargeurPredefinie(largeurCourante)) ? String(largeurCourante) : '';
            afficherErreur(persoEl, q('cmPoteauxLargeurPlacePersoInputError'), null);
        }
        const pmr = placesPmr(st);
        const nbPmrEl = q('cmPoteauxPmrNombreInput');
        if (nbPmrEl && document.activeElement !== nbPmrEl && !saisieRefusee(nbPmrEl, st)) {
            nbPmrEl.value = String(pmr.nombre);
            afficherErreur(nbPmrEl, q('cmPoteauxPmrNombreInputError'), null);
        }
        const lPmrEl = q('cmPoteauxPmrLargeurInput');
        if (lPmrEl) {
            lPmrEl.placeholder = `auto (${LARGEUR_PMR_DEFAUT_M.toFixed(2)} m)`;
            if (document.activeElement !== lPmrEl && !saisieRefusee(lPmrEl, st)) {
                lPmrEl.value = isFinite(nombre(st.ombrierePmrLargeurM)) ? String(pmr.largeur) : '';
                afficherErreur(lPmrEl, q('cmPoteauxPmrLargeurInputError'), null);
            }
        }
        const pannesSel = q('cmOmbriereBoisPannesSelect');
        if (pannesSel && document.activeElement !== pannesSel) pannesSel.value = st.ombriereBoisPannesPosition === 'top' ? 'top' : 'side';

        const affW = q('cmPoteauxAffichageWrapper');
        if (affW) affW.style.display = fm ? '' : 'none';
        const coche = (id, v) => { const el = q(id); if (el) el.checked = !!v; };
        coche('cmPoteauxAxesLongCheckbox', st.ombrierePoteauxAxesLong);
        coche('cmPoteauxAxesTransCheckbox', st.ombrierePoteauxAxesTrans);
        coche('cmPoteauxAncragesCheckbox', st.ombrierePoteauxAncrages);
        const forme = q('cmPoteauxFormeAncrageSelect');
        if (forme && document.activeElement !== forme) {
            forme.value = FORMES_ANCRAGE.indexOf(st.ombriereFormeAncrage) !== -1 ? st.ombriereFormeAncrage : 'circle';
        }
        const hint = q('cmPoteauxCarteHint');
        if (hint) {
            const visible = fm && (st.ombrierePoteauxAxesLong || st.ombrierePoteauxAxesTrans || st.ombrierePoteauxAncrages);
            let messages = [];
            if (visible) {
                try {
                    const p = positionsPoteaux(st);
                    messages = p ? p.avertissements : ['Aucun panneau posé : rien à afficher sur la carte.'];
                } catch (e) { messages = []; }
            }
            hint.textContent = messages.join(' ');
            hint.style.display = messages.length ? 'block' : 'none';
        }
    }

    /** Câble les champs « poteaux » du modal (appelé une fois par createModal). */
    function brancherChampsPoteaux() {
        const body = CM.modalBody;
        if (!body || body.dataset.cmPoteauxBranches) return;
        body.dataset.cmPoteauxBranches = '1';
        const q = (id) => body.querySelector('#' + id);
        const appliquer = () => {
            if (typeof CM.recomputeResults === 'function') CM.recomputeResults(); // persiste + carte + 3D
            // Tout le formulaire (dont le place-holder des entraxes longitudinaux automatiques).
            if (typeof CM.remplirChampsGeometrieDepuisEtat === 'function') CM.remplirChampsGeometrieDepuisEtat();
            else majChampsPoteauxUI();
        };

        // Champs numériques : même contrat que les autres champs du formulaire — une saisie invalide
        // est REFUSÉE (message sous le champ, état inchangé), jamais corrigée en silence. Vide = auto.
        const transInput = q('cmPoteauxEntraxeTransversalInput');
        if (transInput) transInput.addEventListener('input', () => {
            const t = entraxeTransversal(CM.state);
            if (!t) return;
            const v = validerEntraxeTransversal(t.modele, transInput.value, largeurChampCourant());
            afficherErreur(transInput, q('cmPoteauxEntraxeTransversalInputError'), v.ok ? null : v.message);
            if (!v.ok) return;
            if (ecrireEntraxeTransversal(CM.state, t.modele, v.valeur)) appliquer();
        });
        const excInput = q('cmPoteauxExcentrementInput');
        if (excInput) excInput.addEventListener('input', () => {
            if (!excentrement(CM.state)) return;
            const v = validerExcentrement(excInput.value, largeurChampCourant());
            afficherErreur(excInput, q('cmPoteauxExcentrementInputError'), v.ok ? null : v.message);
            if (!v.ok) return;
            if (CM.state.ombriereExcentrementM === v.valeur) return;
            CM.state.ombriereExcentrementM = v.valeur;
            appliquer();
        });

        // Porte-à-faux gauche / droit : un seul des deux fait foi, l'autre s'en déduit (la longueur
        // est imposée par le calepinage) — saisir l'un remet l'autre en automatique.
        [['cmPoteauxPafGaucheInput', 'gauche', 'ombrierePorteAFauxGaucheM', 'ombrierePorteAFauxDroitM'],
         ['cmPoteauxPafDroitInput', 'droit', 'ombrierePorteAFauxDroitM', 'ombrierePorteAFauxGaucheM']].forEach(([id, cote, cle, autre]) => {
            const el = q(id);
            if (el) el.addEventListener('input', () => {
                if (!familleEtModele(CM.state)) return;
                const v = validerPorteAFaux(CM.state, cote, el.value, longueurStructure(CM.state));
                afficherErreur(el, q(id + 'Error'), v.ok ? null : v.message);
                if (!v.ok) return;
                if (CM.state[cle] === v.valeur && (v.valeur === null || CM.state[autre] == null)) return;
                CM.state[cle] = v.valeur;
                if (v.valeur !== null) CM.state[autre] = null;
                appliquer();
            });
        });
        const placeSel = q('cmPoteauxLargeurPlaceSelect');
        if (placeSel) placeSel.addEventListener('change', () => {
            if (!CM.state) return;
            if (placeSel.value === 'perso') {
                // La valeur se saisit dans le champ qui apparaît ; l'état ne change qu'à sa saisie.
                placeSel.dataset.cmPerso = String(CM.state.sourceId);
                majChampsPoteauxUI();
                if (typeof CM.recomputeResults === 'function') CM.recomputeResults(); // miroir PRO
                return;
            }
            delete placeSel.dataset.cmPerso;
            const v = nombre(placeSel.value);
            if (!estLargeurPredefinie(v)) return;
            // 2,50 m = défaut : rangé comme « non saisi » (null).
            const valeur = Math.abs(v - LARGEUR_PLACE_DEFAUT_M) < 1e-6 ? null : v;
            if (CM.state.ombriereLargeurPlaceM === valeur) return;
            CM.state.ombriereLargeurPlaceM = valeur;
            appliquer();
        });
        const persoEl = q('cmPoteauxLargeurPlacePersoInput');
        if (persoEl) persoEl.addEventListener('input', () => {
            if (!CM.state) return;
            // Vide : la largeur courante reste en vigueur. Hors 2-5 m : refusée (message, état inchangé).
            if (!String(persoEl.value).trim()) {
                afficherErreur(persoEl, q('cmPoteauxLargeurPlacePersoInputError'), `Largeur place parking : saisir une valeur entre ${BORNES_LARGEUR_PLACE.min} et ${BORNES_LARGEUR_PLACE.max} m.`);
                return;
            }
            const v = validerLargeurPlace(persoEl.value);
            afficherErreur(persoEl, q('cmPoteauxLargeurPlacePersoInputError'), v.ok ? null : v.message);
            if (!v.ok) return;
            const valeur = Math.abs(v.valeur - LARGEUR_PLACE_DEFAUT_M) < 1e-6 ? null : v.valeur;
            if (CM.state.ombriereLargeurPlaceM === valeur) return;
            CM.state.ombriereLargeurPlaceM = valeur;
            appliquer();
        });
        const nbPmrEl = q('cmPoteauxPmrNombreInput');
        if (nbPmrEl) nbPmrEl.addEventListener('input', () => {
            if (!CM.state) return;
            const vide = !String(nbPmrEl.value).trim();
            const v = vide ? { ok: false, message: `Nombre de places PMR : entier attendu entre ${BORNES_NB_PMR.min} et ${BORNES_NB_PMR.max}.` } : validerNombrePmr(nbPmrEl.value);
            afficherErreur(nbPmrEl, q('cmPoteauxPmrNombreInputError'), v.ok ? null : v.message);
            if (!v.ok || v.valeur === null) return;
            if (CM.state.ombrierePmrNombre === v.valeur) return;
            CM.state.ombrierePmrNombre = v.valeur;
            CM.state.ombrierePlacePmr = v.valeur > 0; // ancienne clé tenue cohérente
            appliquer();
        });
        const lPmrEl = q('cmPoteauxPmrLargeurInput');
        if (lPmrEl) lPmrEl.addEventListener('input', () => {
            if (!CM.state) return;
            const v = validerLargeurPmr(lPmrEl.value);
            afficherErreur(lPmrEl, q('cmPoteauxPmrLargeurInputError'), v.ok ? null : v.message);
            if (!v.ok) return;
            if (CM.state.ombrierePmrLargeurM === v.valeur) return;
            CM.state.ombrierePmrLargeurM = v.valeur;
            appliquer();
        });
        const pannes = q('cmOmbriereBoisPannesSelect');
        if (pannes) pannes.addEventListener('change', () => {
            const v = pannes.value === 'top' ? 'top' : 'side';
            if (!CM.state || (CM.state.ombriereBoisPannesPosition || 'side') === v) return;
            CM.state.ombriereBoisPannesPosition = v === 'top' ? 'top' : null;
            appliquer();
        });

        // Affichage sur la carte.
        [['cmPoteauxAxesLongCheckbox', 'ombrierePoteauxAxesLong'],
         ['cmPoteauxAxesTransCheckbox', 'ombrierePoteauxAxesTrans'],
         ['cmPoteauxAncragesCheckbox', 'ombrierePoteauxAncrages']].forEach(([id, cle]) => {
            const el = q(id);
            if (el) el.addEventListener('change', () => {
                if (!CM.state || !!CM.state[cle] === el.checked) return;
                CM.state[cle] = el.checked;
                appliquer();
            });
        });
        const forme = q('cmPoteauxFormeAncrageSelect');
        if (forme) forme.addEventListener('change', () => {
            if (!CM.state || FORMES_ANCRAGE.indexOf(forme.value) === -1) return;
            if (CM.state.ombriereFormeAncrage === forme.value) return;
            CM.state.ombriereFormeAncrage = forme.value;
            appliquer();
        });
    }

    CM.brancherChampsPoteaux = brancherChampsPoteaux;
    CM.majChampsPoteauxUI = majChampsPoteauxUI;

    // ------------------------------------------------------------------------------------------
    // Carte (piloté par calepinage_maison_carte_plans.js)
    // ------------------------------------------------------------------------------------------

    // Gris clair (demande explicite) : lisible sur la photo aérienne comme sur les panneaux sombres.
    const STYLE_AXES = { strokeColor: '#d1d5db', strokeOpacity: 0.95, strokeWeight: 1.5, clickable: false, zIndex: 10 };
    const STYLE_ANCRAGES = {
        fillColor: '#E74C3C', fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 1.5, clickable: false, zIndex: 11,
    };

    const overlaysParSource = new Map(); // sourceId -> [google.maps overlays]
    let masquagesTemporaires = 0;        // captures en cours (masquerTemporairement)

    function retirer(sourceId) {
        (overlaysParSource.get(sourceId) || []).forEach((o) => o.setMap(null));
        overlaysParSource.delete(sourceId);
    }

    /**
     * Redessine les axes / ancrages d'un champ sur `map`. Indépendants du bouton « Ajouter/Masquer
     * les panneaux solaires » (demande explicite) : seules les cases du formulaire les pilotent.
     * champ = { sourceId, state, origin } (listerChampsCarte).
     */
    function synchroniserChamp(champ, map) {
        if (!champ || !champ.sourceId) return;
        retirer(champ.sourceId);
        const st = champ.state;
        if (!st || !champ.origin || !window.google || !window.google.maps || typeof CM.localToLatLng !== 'function') return;
        if (!st.ombrierePoteauxAxesLong && !st.ombrierePoteauxAxesTrans && !st.ombrierePoteauxAncrages) return;
        let p = null;
        try { p = positionsPoteaux(st); } catch (e) {
            console.warn('[CalepinageMaisonPoteaux] Positions des poteaux non calculables pour', champ.sourceId, e);
        }
        if (!p) return;
        const gm = window.google.maps;
        const ll = (pt) => CM.localToLatLng(champ.origin, pt);
        const cible = masquagesTemporaires > 0 ? null : map;
        const overlays = [];
        const ligne = (seg) => {
            const o = new gm.Polyline(Object.assign({}, STYLE_AXES, { path: seg.map(ll), map: cible }));
            overlays.push(o);
        };
        if (st.ombrierePoteauxAxesLong) p.axesLong.forEach(ligne);
        if (st.ombrierePoteauxAxesTrans) p.axesTrans.forEach(ligne);
        if (st.ombrierePoteauxAncrages) {
            const forme = FORMES_ANCRAGE.indexOf(st.ombriereFormeAncrage) !== -1 ? st.ombriereFormeAncrage : 'circle';
            p.ancrages.forEach((c) => {
                const o = forme === 'circle'
                    ? new gm.Circle(Object.assign({}, STYLE_ANCRAGES, { center: ll(c), radius: DIMENSIONS_ANCRAGE.circle.rayon, map: cible }))
                    : new gm.Polygon(Object.assign({}, STYLE_ANCRAGES, { paths: contourAncrage(c, forme, p.angle).map(ll), map: cible }));
                overlays.push(o);
            });
        }
        overlays.forEach((o) => { o.__carteCible = map; });
        overlaysParSource.set(champ.sourceId, overlays);
    }

    /** Masquage / réaffichage d'un champ (bouton de la palette, cf. basculerPanneauxCarte). */
    function afficher(sourceId, map) {
        (overlaysParSource.get(sourceId) || []).forEach((o) => {
            o.__carteCible = map;
            if (masquagesTemporaires === 0) o.setMap(map);
        });
    }

    /** Retire tout de la carte le temps d'une capture ; renvoie la fonction de restauration. */
    function masquerTemporairement() {
        masquagesTemporaires += 1;
        overlaysParSource.forEach((liste) => liste.forEach((o) => o.setMap(null)));
        let restaure = false;
        return () => {
            if (restaure) return;
            restaure = true;
            masquagesTemporaires = Math.max(0, masquagesTemporaires - 1);
            if (masquagesTemporaires > 0) return;
            overlaysParSource.forEach((liste) => liste.forEach((o) => o.setMap(o.__carteCible || null)));
        };
    }

    CM.poteauxCarte = {
        synchroniserChamp, retirer, afficher, masquerTemporairement,
        ids: () => Array.from(overlaysParSource.keys()),
    };
})();
